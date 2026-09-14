/**
 * Unit tests for src/tool.ts (P1.M1.T3.S6).
 *
 * Covers: (a) the h2.24 resident text byte-exactly (description + both
 * guideline bullets, ≤120-word convention), (b)–(h) every executor route
 * (read/upsert/reopen/record × TUI/non-TUI, state bootstrap, parse-error and
 * stale-guard throws), (i)–(j) the h2.25 render rows against a stub theme,
 * (k) state side effects (epoch/rev/events), (l) the registration shape, and
 * (m) the source-level non-blocking hygiene guard (no user-input blocking, no
 * UI surface, no send channel inside the executor).
 *
 * No pi runtime is started: the registered render hooks are called directly
 * with a stub theme (todo.ts pattern), and the executor receives the minimal
 * ExecutorContext stub ({ mode, hasUI, model.contextWindow }).
 */
import * as fs from "node:fs";
import { beforeEach, describe, expect, test } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { attemptCompletion } from "./completion.js";
import { DEFAULT_CONFIG, type InterrogatorConfig } from "./config.js";
import { evaluateDependsOn } from "./depends-on.js";
import { RELAY_INSTRUCTION } from "./fallback.js";
import { StaleError } from "./guards.js";
import { closeSubmitted, markAnswered, markSubmitted } from "./merge.js";
import { buildReadResult } from "./results.js";
import {
  createInterrogationState,
  getState,
  resetState,
  setState,
  InterrogationState,
} from "./state.js";
import { InterrogateParams, type QuestionInput } from "./tool-schema.js";
import {
  createInterrogateTool,
  executeInterrogate,
  INTERROGATE_PROMPT_GUIDELINES,
  INTERROGATE_PROMPT_SNIPPET,
  INTERROGATE_TOOL_DESCRIPTION,
  type ExecutorContext,
} from "./tool.js";

// ------------------------------------------------------------------ fixtures

/** The h2.24 tool description, copied byte-for-byte from prd_snapshot.md. */
const PRD_H2_24_DESCRIPTION =
  "Structured interrogation: plan by asking the user questions they answer in a persistent panel. Upsert `questions[]` (stable ids; existing questions require their current `rev`; omitting an id withdraws it). Call with `{}` to read current state, goal, and epoch. Answers arrive as submission messages — consider how they affect your other questions and re-ask only those materially affected (upsert with new rev). First round: few broad foundational questions with key ramifications; refine in later rounds; send the full set up front. The question set is the plan: when it completes, the full record is injected — derive the spec from it, don't re-plan. If unsure your view is current, read before upserting.";

/** The two h2.24 guideline bullets, byte-for-byte. */
const PRD_H2_24_GUIDELINES = [
  "Use interrogate for structured planning questions instead of plain-text question blocks; send the full set in one call.",
  "After answers arrive, re-ask only questions materially affected by the new answers, then let the interrogation complete.",
];

/** Minimal wire question; overrides win (caps.test.ts pattern). */
function qi(id: string, overrides: Partial<QuestionInput> = {}): QuestionInput {
  return { id, prompt: `prompt ${id}`, type: "text", ...overrides };
}

/** Fresh registered singleton with the given goal. */
function seedState(goal = "g"): InterrogationState {
  const st = createInterrogationState(goal);
  setState(st);
  return st;
}

/** Seed one stored question (rev 1, open) via the raw primitive. */
function seedQ(st: InterrogationState, id: string): void {
  st.upsertQuestion({ id, prompt: `prompt ${id}`, type: "text", rev: 1, status: "open" });
}

/** TUI executor stub: panel-capable. */
function tuiCtx(): ExecutorContext {
  return { mode: "tui", hasUI: true, model: { contextWindow: 200_000 } };
}

/** Non-TUI executor stub (h2.26 fallback): print mode, no UI. */
function printCtx(): ExecutorContext {
  return { mode: "print", hasUI: false, model: { contextWindow: 200_000 } };
}

/** Identity theme for renderer assertions (stub per PRP). */
const stubTheme = {
  fg: (_name: string, s: string) => s,
  bold: (s: string) => s,
} as unknown as Theme;

// ------------------------------------------------- BUG-002 completed-swap

const AT = "2025-01-01T00:00:00.000Z";

/** Bare pi stand-in for attemptCompletion (completion.test.ts makeMockPi pattern). */
function completionPi(): Pick<ExtensionAPI, "sendMessage"> {
  return { sendMessage: () => {} } as unknown as Pick<ExtensionAPI, "sendMessage">;
}

/**
 * Drive one full interrogation through answer → submit → close pass →
 * attemptCompletion, state-level (completion.test.ts seeding pattern). The
 * singleton is read via the same opts.getState seam the real wiring uses.
 */
function completeInterrogation(
  st: InterrogationState,
  ids: string[],
): { fired: boolean; reason?: string } {
  for (const id of ids) markAnswered(st, id, { value: "a", at: AT });
  markSubmitted(st, ids);
  closeSubmitted(st, ids);
  return attemptCompletion(
    completionPi(),
    { lifecycle: { dismissPanel: () => {} }, getState: () => st },
    { closed: ids, reasked: [], remainingActive: [] },
  );
}

beforeEach(() => {
  resetState();
});

// ------------------------------------------------------- resident text (h2.24)

describe("h2.24 resident text", () => {
  test("description is byte-identical to the h2.24 text and within the 120-word convention", () => {
    expect(INTERROGATE_TOOL_DESCRIPTION).toBe(PRD_H2_24_DESCRIPTION);
    expect(PRD_H2_24_DESCRIPTION.trim().split(/\s+/).length).toBeLessThanOrEqual(120);
  });

  test("promptGuidelines are the two h2.24 bullets, byte-identical, in order", () => {
    expect(INTERROGATE_PROMPT_GUIDELINES).toEqual(PRD_H2_24_GUIDELINES);
    expect(INTERROGATE_PROMPT_GUIDELINES).toHaveLength(2);
  });

  test("promptSnippet is the one-liner (ours, not PRD-verbatim)", () => {
    expect(INTERROGATE_PROMPT_SNIPPET).toBe(
      "Ask structured planning questions via the interrogate tool; users answer in a persistent panel.",
    );
  });
});

// ------------------------------------------------------------------- executor

describe("executeInterrogate: read", () => {
  test("with no state: synthesized empty view at epoch 0, NOT persisted", () => {
    const r = executeInterrogate({}, tuiCtx());
    expect(r.content).toBe("0/0 answered · 0 re-asked · 0 moot · epoch 0");
    expect(r.details.action).toBe("read");
    expect(r.details.epoch).toBe(0);
    expect(getState()).toBeUndefined();
  });

  test("with existing state: full summary with Goal line and post-call envelope", () => {
    const st = seedState("Ship it");
    seedQ(st, "q1");
    const r = executeInterrogate({}, tuiCtx());
    const lines = r.content.split("\n");
    expect(lines[0]).toBe("Goal: Ship it");
    expect(lines[1]).toBe("0/1 answered · 0 re-asked · 0 moot · epoch 1");
    expect(r.details.action).toBe("read");
    expect(r.details.state.questions.q1).toBeDefined();
  });
});

describe("executeInterrogate: upsert (TUI)", () => {
  test("fresh upsert creates + registers state, returns the compact h2.20 result", () => {
    const r = executeInterrogate({ goal: "Ship it", questions: [qi("q1"), qi("q2")] }, tuiCtx());
    const lines = r.content.split("\n");
    expect(lines[0]).toBe("0/2 answered · 0 re-asked · 0 moot · epoch 1");
    expect(lines[1]).toBe("Questions visible to the user.");
    expect(lines[2]).toBe("End your turn with a one-line note; do not call further tools.");
    expect(r.details.action).toBe("upsert");
    expect(r.details.epoch).toBe(1);
    expect(r.details.statusLine).toBe(lines[0]);
    expect(r.details.state.questions.q1?.rev).toBe(1);
    expect(r.details.state.goal).toBe("Ship it");
    expect(getState()).toBeDefined();
    expect(getState()!.goal).toBe("Ship it");
  });

  test("existing state: goal on upsert REPLACES the stored goal (FR-30)", () => {
    const st = seedState("first goal");
    seedQ(st, "q1");
    const r = executeInterrogate(
      { goal: "second goal", epoch: 1, questions: [qi("q1", { rev: 1 })] },
      tuiCtx(),
    );
    expect(getState()!.goal).toBe("second goal");
    expect(r.details.state.goal).toBe("second goal");
  });

  test("existing state: goal OMITTED on upsert leaves goal unchanged", () => {
    const st = seedState("first goal");
    seedQ(st, "q1");
    executeInterrogate({ epoch: 1, questions: [qi("q1", { rev: 1 })] }, tuiCtx());
    expect(getState()!.goal).toBe("first goal");
  });

  test("create upsert stores the CAPPED goal, with truncation warning (BUG-009)", () => {
    const r = executeInterrogate({ goal: "x".repeat(500), questions: [qi("q1")] }, tuiCtx());
    expect(getState()!.goal).toHaveLength(400);
    expect(r.details.state.goal).toHaveLength(400);
    expect(r.content).toContain("goal truncated at 500 chars");
  });

  test("reuse upsert caps an over-budget goal and surfaces the warning", () => {
    const st = seedState("first goal");
    seedQ(st, "q1");
    const r = executeInterrogate(
      { goal: "y".repeat(500), epoch: 1, questions: [qi("q1", { rev: 1 })] },
      tuiCtx(),
    );
    expect(getState()!.goal).toHaveLength(400);
    expect(r.details.state.goal).toHaveLength(400);
    expect(r.content).toContain("goal truncated at 500 chars");
  });

  test("stale upsert carrying a goal throws StaleError and leaves goal untouched", () => {
    const st = seedState("first goal");
    seedQ(st, "q1");
    expect(() =>
      executeInterrogate({ goal: "evil", epoch: 999, questions: [qi("q1", { rev: 1 })] }, tuiCtx()),
    ).toThrow(StaleError);
    expect(getState()!.goal).toBe("first goal");
  });

  test("existing state: matching rev merges and bumps rev (merge rule 1)", () => {
    const st = seedState();
    seedQ(st, "q1");
    executeInterrogate({ epoch: 1, questions: [qi("q1", { rev: 1, prompt: "revised" })] }, tuiCtx());
    expect(getState()!.getQuestion("q1")!.rev).toBe(2);
    expect(getState()!.getQuestion("q1")!.prompt).toBe("revised");
  });

  test("warnings: parse truncation prepended before caps truncation, in order", () => {
    const cfg: InterrogatorConfig = {
      ...DEFAULT_CONFIG,
      caps: { ...DEFAULT_CONFIG.caps, questions: 2, description: 10, contextBudgetPct: 0.0001 },
    };
    const r = executeInterrogate(
      { questions: [qi("q0", { description: "x".repeat(50) }), qi("q1"), qi("q2")] },
      tuiCtx(),
      cfg,
    );
    const lines = r.content.split("\n");
    expect(lines[3]).toBe("questions truncated at 2 — restructure if essential");
    expect(lines[4]).toBe("q0 description truncated at 50 chars — restructure if essential");
    expect(lines).toHaveLength(5);
  });

  test("h2.23 warnings are unconditional: gateWarnings=false still warns in the tool result", () => {
    const cfg: InterrogatorConfig = {
      ...DEFAULT_CONFIG,
      gateWarnings: false,
      caps: { ...DEFAULT_CONFIG.caps, questions: 2, description: 10, contextBudgetPct: 0.0001 },
    };
    createInterrogateTool(cfg); // seam: sets the executor's default config
    const r = executeInterrogate(
      { questions: [qi("q0", { description: "x".repeat(50) }), qi("q1"), qi("q2")] },
      tuiCtx(),
    );
    // Truncation warnings always reach the model (h2.23 self-correction path);
    // gateWarnings only gates the FR-9 panel submit warning.
    const lines = r.content.split("\n");
    expect(lines[3]).toBe("questions truncated at 2 — restructure if essential");
    expect(lines[4]).toBe("q0 description truncated at 50 chars — restructure if essential");
    expect(lines).toHaveLength(5);
  });

  // BUG-002 / PRD h2.2-h3.1: a NEW-question upsert on a completed singleton
  // must start a fresh interrogation (epoch 1, completed=false) instead of
  // reusing the completed state whose one-time guard blocks every future
  // completion record.
  test("second interrogation after completion completes (BUG-002, PRD h3.1)", () => {
    const st = seedState("first goal");
    seedQ(st, "q1");
    const first = completeInterrogation(st, ["q1"]);
    expect(first).toEqual({ fired: true });

    // NEW-question upsert on the completed singleton — no epoch needed:
    // nothing exists on the fresh state to be stale (BUG-010 scope).
    executeInterrogate({ questions: [qi("n1")] }, tuiCtx());

    const second = completeInterrogation(getState()!, ["n1"]);
    expect(second).toEqual({ fired: true }); // failed pre-fix: 'already-completed'
  });

  test("upsert on completed state swaps in a FRESH singleton (epoch 1, completed=false, empty snapshots)", () => {
    const st = seedState("first goal");
    seedQ(st, "q1");
    expect(completeInterrogation(st, ["q1"])).toEqual({ fired: true });

    const r = executeInterrogate({ questions: [qi("n1")] }, tuiCtx());
    const s = getState()!;
    expect(s).not.toBe(st); // a NEW instance, installed via setState
    expect(s.epoch).toBe(1);
    expect(s.completed).toBe(false);
    expect(s.snapshots).toHaveLength(0);
    expect(s.getQuestion("n1")!.status).toBe("open");
    expect(s.orderedQuestions().map((q) => q.id)).toEqual(["n1"]);
    expect(r.details.state.epoch).toBe(1);
    expect(r.details.state.completed).toBe(false);
  });

  test("swap RETAINS the prior goal when the upsert omits goal (FR-30 anchors re-asks)", () => {
    const st = seedState("first goal");
    seedQ(st, "q1");
    expect(completeInterrogation(st, ["q1"])).toEqual({ fired: true });

    executeInterrogate({ questions: [qi("n1")] }, tuiCtx());
    expect(getState()!.goal).toBe("first goal");
  });

  test("swap applies the CAPPED goal when the upsert supplies one", () => {
    const st = seedState("first goal");
    seedQ(st, "q1");
    expect(completeInterrogation(st, ["q1"])).toEqual({ fired: true });

    const r = executeInterrogate(
      { goal: "x".repeat(500), questions: [qi("n1")] },
      tuiCtx(),
    );
    expect(getState()!.goal).toHaveLength(400);
    expect(r.details.state.goal).toHaveLength(400);
    expect(r.content).toContain("goal truncated at 500 chars");
  });

  test("NON-completed existing state is NOT swapped (same instance, q1 intact)", () => {
    const st = seedState("first goal");
    seedQ(st, "q1");
    executeInterrogate({ questions: [qi("q2")] }, tuiCtx());
    const s = getState()!;
    expect(s).toBe(st); // same instance — no swap on the normal path
    expect(s.epoch).toBe(1); // epoch unchanged
    expect(s.getQuestion("q1")).toBeDefined();
    expect(s.getQuestion("q2")).toBeDefined();
  });

  test("guard untouched: deserialize restores completed=true (exactly-once across restart)", () => {
    const st = seedState("first goal");
    seedQ(st, "q1");
    expect(completeInterrogation(st, ["q1"])).toEqual({ fired: true });
    const json = JSON.parse(JSON.stringify(st.serialize()));
    expect(InterrogationState.deserialize(json).completed).toBe(true);
  });

  test("stale upsert on a NON-completed state still throws StaleError (state unchanged)", () => {
    const st = seedState("first goal");
    seedQ(st, "q1");
    expect(() =>
      executeInterrogate({ epoch: 999, questions: [qi("q1", { rev: 1 })] }, tuiCtx()),
    ).toThrow(StaleError);
    expect(getState()).toBe(st);
    expect(getState()!.completed).toBe(false);
  });
});

describe("executeInterrogate: upsert (non-TUI)", () => {
  test("composite: status line + digest header + relay sentence, envelope inline", () => {
    const r = executeInterrogate({ goal: "Ship it", questions: [qi("q1")] }, printCtx());
    const lines = r.content.split("\n");
    expect(lines[0]).toBe("0/1 answered · 0 re-asked · 0 moot · epoch 1");
    expect(lines[1]).toBe("INTERROGATION — Ship it (epoch 1)");
    expect(lines.at(-1)).toBe(RELAY_INSTRUCTION);
    expect(r.details.action).toBe("upsert");
    expect(r.details.epoch).toBe(1);
    expect(r.details.statusLine).toBe(lines[0]);
    expect(r.details.state.questions.q1).toBeDefined();
  });

  test("warnings land after the digest in the composite", () => {
    const cfg: InterrogatorConfig = {
      ...DEFAULT_CONFIG,
      caps: { ...DEFAULT_CONFIG.caps, description: 10, contextBudgetPct: 0.0001 },
    };
    const r = executeInterrogate(
      { goal: "Ship it", questions: [qi("q1", { description: "x".repeat(50) })] },
      printCtx(),
      cfg,
    );
    expect(r.content.split("\n").at(-1)).toBe("q1 description truncated at 50 chars — restructure if essential");
  });
});

// --------------------- BUG-006(a) upsert dependsOn evaluation (FR-17)

describe("executeInterrogate: upsert dependsOn evaluation (BUG-006a)", () => {
  /** The PRD repro's choice dep: answered "pg" makes dep=sqlite unmet. */
  function depQ(): QuestionInput {
    return qi("dep", {
      type: "choice",
      options: [
        { label: "Postgres", value: "pg" },
        { label: "SQLite", value: "sqlite" },
      ],
    });
  }

  /** Re-upsert the stored child with its CURRENT rev + the live epoch. */
  function childReupsert(child: Partial<QuestionInput> = {}): Record<string, unknown> {
    const s = getState()!;
    return {
      epoch: s.serialize().epoch,
      questions: [qi("child", { rev: s.getQuestion("child")!.rev, ...child })],
    };
  }

  test("removed dependsOn reopens the moot child in the SAME upsert result (PRD repro, TUI, BUG-006a)", () => {
    executeInterrogate(
      { goal: "g", questions: [depQ(), qi("child", { dependsOn: [{ id: "dep", equals: "sqlite" }] })] },
      tuiCtx(),
    );
    const st = getState()!;
    markAnswered(st, "dep", { value: "pg", at: AT });
    evaluateDependsOn(st);
    expect(st.getQuestion("child")!.status).toBe("moot");

    // Re-upsert WITHOUT dependsOn (same options → merge rule 1 keeps the
    // moot status); evaluation inside the upsert must reopen it — no manual
    // evaluateDependsOn in the test after this call. dep is omitted from the
    // batch, so merge rule 4 withdraws it (answer retained for audit) — the
    // child's reopen must still fire.
    const r = executeInterrogate(childReupsert(), tuiCtx());

    expect(r.details.state.questions.child?.status).toBe("open"); // post-evaluation in the SAME result
    expect(r.content.split("\n")[0]).toBe("0/2 answered · 0 re-asked · 0 moot · epoch 1");
    expect(getState()!.getQuestion("child")!.status).toBe("open");
  });

  test("new dependsOn condition mutes the open child instantly in the same result (BUG-006a)", () => {
    executeInterrogate({ goal: "g", questions: [depQ(), qi("child")] }, tuiCtx());
    const st = getState()!;
    markAnswered(st, "dep", { value: "pg", at: AT });
    evaluateDependsOn(st); // no dependsOn yet — child stays open
    expect(st.getQuestion("child")!.status).toBe("open");

    const r = executeInterrogate(
      childReupsert({ dependsOn: [{ id: "dep", equals: "sqlite" }] }),
      tuiCtx(),
    );

    expect(r.details.state.questions.child?.status).toBe("moot"); // unmet pg ≠ sqlite, same result
    expect(r.content.split("\n")[0]).toBe("0/2 answered · 0 re-asked · 1 moot · epoch 1");
    expect(getState()!.getQuestion("child")!.status).toBe("moot");
  });

  test("completed-swap fresh interrogation evaluates too (shared post-applyUpsert path, BUG-006a)", () => {
    const st = seedState("first goal");
    seedQ(st, "q1");
    expect(completeInterrogation(st, ["q1"])).toEqual({ fired: true });

    // All-new-id batch on the completed singleton → fresh swap (BUG-002).
    executeInterrogate(
      { goal: "second goal", questions: [depQ(), qi("child", { dependsOn: [{ id: "dep", equals: "sqlite" }] })] },
      tuiCtx(),
    );
    const fresh = getState()!;
    expect(fresh).not.toBe(st); // the swap really happened
    expect(fresh.epoch).toBe(1);
    markAnswered(fresh, "dep", { value: "pg", at: AT });
    evaluateDependsOn(fresh);
    expect(fresh.getQuestion("child")!.status).toBe("moot");

    // The SAME applyUpsert→evaluateDependsOn seam must serve the swap branch.
    const r = executeInterrogate(childReupsert(), tuiCtx());

    expect(r.details.state.questions.child?.status).toBe("open");
    expect(getState()!.getQuestion("child")!.status).toBe("open");
  });

  test("non-TUI composite digest reflects post-evaluation statuses in the same result (BUG-006a)", () => {
    executeInterrogate(
      { goal: "g", questions: [depQ(), qi("child", { dependsOn: [{ id: "dep", equals: "sqlite" }] })] },
      printCtx(),
    );
    const st = getState()!;
    markAnswered(st, "dep", { value: "pg", at: AT });
    evaluateDependsOn(st);

    const r = executeInterrogate(childReupsert(), printCtx());

    const lines = r.content.split("\n");
    expect(lines[0]).toBe("0/2 answered · 0 re-asked · 0 moot · epoch 1");
    // The reopened child renders in the digest again (moot AND withdrawn
    // questions are skipped — dep was withdrawn by the child-only batch) —
    // both the digest and the envelope carry post-evaluation state.
    expect(lines).toContain("**1. prompt child** (`child`)");
    expect(r.details.state.questions.child?.status).toBe("open");
  });
});

describe("executeInterrogate: record", () => {
  test("no state throws — in both modes", () => {
    for (const ctx of [tuiCtx(), printCtx()]) {
      expect(() => executeInterrogate({ epoch: 1, answers: [{ id: "q1", value: "a" }] }, ctx)).toThrowError(
        "no interrogation in progress — call interrogate with questions[] first",
      );
    }
  });

  test("TUI: IGNORED per h2.20 — ack note only, zero state change", () => {
    const st = seedState();
    seedQ(st, "q1");
    const r = executeInterrogate({ epoch: 1, answers: [{ id: "q1", value: "yes" }] }, tuiCtx());
    const lines = r.content.split("\n");
    expect(lines[0]).toBe("0/1 answered · 0 re-asked · 0 moot · epoch 1");
    expect(lines[1]).toBe("answers ignored in TUI — answers arrive via the panel.");
    expect(r.details.action).toBe("record");
    expect(r.details.epoch).toBe(1);
    expect(st.getQuestion("q1")!.answer).toBeUndefined();
    expect(st.epoch).toBe(1);
  });

  test("non-TUI: records answers, bumps epoch, reports unknown ids", () => {
    const st = seedState();
    seedQ(st, "q1");
    seedQ(st, "q2");
    const r = executeInterrogate(
      { epoch: 1, answers: [{ id: "q1", value: "yes" }, { id: "zz", value: "x" }] },
      printCtx(),
    );
    const lines = r.content.split("\n");
    expect(lines[0]).toBe("0/2 answered · 0 re-asked · 0 moot · epoch 2"); // q1 is submitted (BUG-004), not counted as answered
    expect(lines[1]).toBe("unknown ids: zz");
    expect(lines).toHaveLength(2);
    expect(r.details.action).toBe("record");
    expect(r.details.epoch).toBe(2);
    expect(st.getQuestion("q1")!.answer?.value).toBe("yes");
    expect(st.getQuestion("q1")!.status).toBe("submitted");
  });

  test("non-TUI: all-unknown batch has zero side effects and says nothing was recorded", () => {
    const st = seedState();
    seedQ(st, "q1");
    const r = executeInterrogate({ epoch: 1, answers: [{ id: "nope", value: "x" }] }, printCtx());
    const lines = r.content.split("\n");
    expect(lines[0]).toBe("0/1 answered · 0 re-asked · 0 moot · epoch 1"); // epoch NOT burned
    expect(lines[1]).toBe("unknown ids: nope");
    expect(lines[2]).toBe("no answers recorded");
    expect(r.details.epoch).toBe(1);
    expect(st.epoch).toBe(1);
    expect(st.snapshots).toHaveLength(0);
  });

  test("non-TUI: withdrawn id is not resurrected — ignored line + untouched state (BUG-012)", () => {
    const st = seedState();
    seedQ(st, "q1");
    seedQ(st, "q2");
    st.setStatus("q2", "withdrawn");
    const r = executeInterrogate(
      { epoch: 1, answers: [{ id: "q2", value: "resurrect me" }, { id: "q1", value: "yes" }] },
      printCtx(),
    );
    const lines = r.content.split("\n");
    expect(lines[0]).toBe("0/2 answered · 0 re-asked · 0 moot · epoch 2"); // q1 submitted (BUG-004), not answered
    expect(lines[1]).toBe("not recordable (moot/withdrawn/closed): q2");
    // Only q1 recorded → exactly one epoch bump; q2 untouched.
    expect(lines).toHaveLength(2);
    expect(r.details.action).toBe("record");
    expect(r.details.epoch).toBe(2);
    expect(st.getQuestion("q2")!.status).toBe("withdrawn");
    expect(st.getQuestion("q2")!.answer).toBeUndefined();
    expect(st.getQuestion("q1")!.answer?.value).toBe("yes");
  });
});

describe("executeInterrogate: reopen", () => {
  test("no state throws — state existence is the only guard (FR-6 bans recency/epoch checks)", () => {
    expect(() => executeInterrogate({ reopen: true }, tuiCtx())).toThrowError("no interrogation state to reopen");
    expect(() => executeInterrogate({ reopen: true }, printCtx())).toThrowError("no interrogation state to reopen");
  });

  test("TUI + suspended: resume hook invoked once, Panel reopened + inline reopen envelope (P1.M6.T2.S1)", () => {
    const st = seedState();
    seedQ(st, "q1");
    const calls: string[] = [];
    const r = executeInterrogate({ reopen: true }, tuiCtx(), DEFAULT_CONFIG, {
      onReopen: () => {
        calls.push("reopened");
        return "reopened";
      },
    });
    expect(calls).toEqual(["reopened"]); // hook fired exactly once, synchronously
    expect(r.content).toBe("0/1 answered · 0 re-asked · 0 moot · epoch 1\nPanel reopened.");
    expect(r.details.action).toBe("reopen");
    expect(r.details.statusLine).toBe("0/1 answered · 0 re-asked · 0 moot · epoch 1");
    expect(r.details.state.questions.q1).toBeDefined();
  });

  test("TUI + already-open: hook's already-open ack, no throw", () => {
    const st = seedState();
    seedQ(st, "q1");
    const r = executeInterrogate({ reopen: true }, tuiCtx(), DEFAULT_CONFIG, { onReopen: () => "already-open" });
    expect(r.content).toBe("0/1 answered · 0 re-asked · 0 moot · epoch 1\nPanel already open.");
    expect(r.details.action).toBe("reopen");
  });

  test("TUI + zero-open / dead panel: hook's no-state ack, no throw", () => {
    const st = seedState();
    seedQ(st, "q1");
    const r = executeInterrogate({ reopen: true }, tuiCtx(), DEFAULT_CONFIG, { onReopen: () => "no-state" });
    expect(r.content).toBe("0/1 answered · 0 re-asked · 0 moot · epoch 1\nNo open questions to reopen.");
    expect(r.details.action).toBe("reopen");
  });

  test("TUI without deps: defaults to the reopened confirmation (executor callers predate the wiring)", () => {
    const st = seedState();
    seedQ(st, "q1");
    const r = executeInterrogate({ reopen: true }, tuiCtx());
    expect(r.content).toBe("0/1 answered · 0 re-asked · 0 moot · epoch 1\nPanel reopened.");
    expect(r.details.action).toBe("reopen");
  });

  test("non-TUI: identical to a read (nothing to resurface); hook never invoked", () => {
    const st = seedState();
    seedQ(st, "q1");
    let calls = 0;
    const r = executeInterrogate({ reopen: true }, printCtx(), DEFAULT_CONFIG, {
      onReopen: () => {
        calls += 1;
        return "reopened";
      },
    });
    expect(calls).toBe(0);
    expect(r.details.action).toBe("read");
    expect(r.content).toBe(buildReadResult(st.serialize()).content);
  });
});

describe("executeInterrogate: error contracts", () => {
  test("parse errors throw with the - path: message format (never look like success)", () => {
    expect(() =>
      executeInterrogate({ questions: [{ id: "q1", prompt: "p", type: "choice" }] }, tuiCtx()),
    ).toThrowError(
      'invalid interrogate params:\n- questions[0].options: type "choice" requires at least one option (question "q1")',
    );
    // Malformed input also never creates state.
    expect(getState()).toBeUndefined();
  });

  test("non-object args throw too", () => {
    expect(() => executeInterrogate("nope", tuiCtx())).toThrowError(/invalid interrogate params:/);
  });

  test("stale rev on upsert propagates StaleError UNCAUGHT and leaves state untouched", () => {
    const st = seedState();
    seedQ(st, "q1");
    expect(() =>
      executeInterrogate({ questions: [qi("q1", { rev: 9, prompt: "stale" })] }, tuiCtx()),
    ).toThrow(StaleError);
    expect(st.getQuestion("q1")!.prompt).toBe("prompt q1");
    expect(st.getQuestion("q1")!.rev).toBe(1);
  });

  test("record: missing epoch is a plain Error; wrong epoch is StaleError", () => {
    const st = seedState();
    seedQ(st, "q1");
    expect(() => executeInterrogate({ answers: [{ id: "q1", value: "a" }] }, printCtx())).toThrowError(
      /answers requires epoch/,
    );
    expect(() =>
      executeInterrogate({ epoch: 7, answers: [{ id: "q1", value: "a" }] }, printCtx()),
    ).toThrow(StaleError);
  });

  test("BUG-010: epoch-less upsert touching an existing id throws with the self-heal message", () => {
    const st = seedState();
    seedQ(st, "q1");
    // The executor propagates thrown guard errors uncaught — pi sets isError
    // on the tool result ONLY when execute throws (same surface as the
    // StaleError cases above).
    expect(() =>
      executeInterrogate({ questions: [qi("q1", { rev: 1 })] }, tuiCtx()),
    ).toThrowError(
      "STALE: upsert touching existing questions requires the session epoch (current 1). Re-send with epoch.",
    );
    expect(getState()!.getQuestion("q1")!.rev).toBe(1); // state untouched by the rejection
    // Self-heal round-trip: the message's current epoch makes the retry succeed.
    expect(() =>
      executeInterrogate({ epoch: 1, questions: [qi("q1", { rev: 1 })] }, tuiCtx()),
    ).not.toThrow();
    expect(getState()!.getQuestion("q1")!.rev).toBe(2);
  });
});

describe("executeInterrogate: state side effects", () => {
  test("upsert fires questions-upserted per applied question (the panel trigger)", () => {
    const st = seedState();
    const events: string[][] = [];
    st.on("questions-upserted", (ids) => events.push([...ids]));
    executeInterrogate({ questions: [qi("q1"), qi("q2")] }, tuiCtx());
    expect(events).toEqual([["q1"], ["q2"]]);
  });
});

// ---------------------------------------------------------------- renderers

describe("renderCall rows (h2.25)", () => {
  const tool = createInterrogateTool(DEFAULT_CONFIG);

  function row(args: unknown): string {
    // Text.render pads each line to the given width with display-only trailing
    // spaces — compare visible content via trimEnd.
    return (tool.renderCall!(args as never, stubTheme, {} as never) as Text)
      .render(300)
      .map((l) => l.trimEnd())
      .join("\n");
  }

  test("upsert: all-new batch renders n questions +m new", () => {
    expect(row({ questions: [qi("a"), qi("b")] })).toBe("interrogate 2 questions +2 new");
  });

  test("upsert: mixed batch renders +new ~updated counts from the rev field", () => {
    expect(row({ questions: [qi("a"), qi("b", { rev: 3 })] })).toBe("interrogate 2 questions +1 new ~1 updated");
    expect(row({ questions: [qi("a", { rev: 1 }), qi("b", { rev: 2 })] })).toBe("interrogate 2 questions ~2 updated");
  });

  test("read args render the bare label", () => {
    expect(row({})).toBe("interrogate");
    expect(row({ questions: [] })).toBe("interrogate");
  });

  test("record/reopen args render the compact action suffix", () => {
    expect(row({ answers: [{ id: "q1", value: "a" }] })).toBe("interrogate record answers");
    expect(row({ reopen: true })).toBe("interrogate reopen panel");
  });
});

describe("renderResult rows (h2.25)", () => {
  const tool = createInterrogateTool(DEFAULT_CONFIG);
  const fakeRenderCtx = {} as never;

  test("collapsed: the envelope status line only", () => {
    const r = executeInterrogate({ questions: [qi("q1")] }, tuiCtx());
    const out = tool.renderResult!(
      { content: [{ type: "text", text: r.content }], details: r.details },
      { expanded: false, isPartial: false },
      stubTheme,
      fakeRenderCtx,
    ) as Text;
    expect(out.render(300).map((l) => l.trimEnd()).join("\n")).toBe(r.details.statusLine);
  });

  test("expanded: the full state summary, one Text child per read-result line", () => {
    const st = seedState("Ship it");
    seedQ(st, "q1");
    const r = executeInterrogate({}, tuiCtx());
    const out = tool.renderResult!(
      { content: [{ type: "text", text: r.content }], details: r.details },
      { expanded: true, isPartial: false },
      stubTheme,
      fakeRenderCtx,
    ) as Box;
    const expected = buildReadResult(r.details.state).content.split("\n");
    expect(out.children).toHaveLength(expected.length);
    const rendered = out.children.map((c: unknown) => (c as Text).render(300).map((l) => l.trimEnd()).join("\n"));
    expect(rendered).toEqual(expected);
  });

  test("details-less results fall back to the raw content text (defensive)", () => {
    const out = tool.renderResult!(
      { content: [{ type: "text", text: "boom" }], details: undefined as unknown as ReturnType<typeof buildReadResult>["details"] },
      { expanded: true, isPartial: false },
      stubTheme,
      fakeRenderCtx,
    ) as Text;
    expect(out.render(300).map((l) => l.trimEnd()).join("\n")).toBe("boom");
  });
});

// ----------------------------------------------------------- registration

describe("extension factory wiring (index.ts)", () => {
  test("factory loads config once and registers ping + interrogate tool", async () => {
    const mod = await import("./index.js");
    const commands: unknown[] = [];
    const tools: unknown[] = [];
    const shortcuts: unknown[] = [];
    const renderers: unknown[] = [];
    const entries: unknown[] = [];
    const fakePi = {
      registerCommand: (name: string, _opts: unknown) => commands.push(name),
      registerTool: (tool: unknown) => tools.push(tool),
      registerShortcut: (key: string, _opts: unknown) => shortcuts.push(key), // P1.M6.T1.S2
      registerMessageRenderer: (customType: string, _renderer: unknown) => renderers.push(customType), // P1.M7.T3.S1+S2
      registerEntryRenderer: (customType: string, _renderer: unknown) => entries.push(customType), // P1.M7.T3.S2
      on: (_event: string, _handler: unknown) => undefined, // lifecycle subscriptions (P1.M2.T2.S1)
    } as unknown as ExtensionAPI;
    await mod.default(fakePi);
    // T1 contract preserved (ping first), plus the P1.M2.T3.S1 debug
    // commands registered after the lifecycle wiring (h2.50), plus the
    // P1.M6.T1.S2 /interrogate toggle (last — inside the factory closure).
    expect(commands).toEqual([
      "interrogate-ping",
      "interrogate-debug-upsert",
      "interrogate-debug-submit",
      "interrogate-debug-state",
      "interrogate",
    ]);
    // Global break-out/resume shortcut registered with the RAW config value.
    expect(shortcuts).toEqual([DEFAULT_CONFIG.keys.breakOut]);
    // P1.M7.T3.S1+S2 — user-only renderers registered for the EXACT
    // customTypes the delivery message / persistence entry ship (h2.36);
    // the interrogation-state mirror lands via registerEntryRenderer.
    expect(renderers).toEqual(["interrogation-submission", "interrogation-completion"]);
    expect(entries).toEqual(["interrogation-state"]);
    expect(tools).toHaveLength(1);
    expect((tools[0] as { name: string }).name).toBe("interrogate");
    expect((tools[0] as { description: string }).description).toBe(INTERROGATE_TOOL_DESCRIPTION);
  });
});

describe("registration shape", () => {
  test("the tool object carries name/label/description/snippet/guidelines/schema", () => {
    const tool = createInterrogateTool(DEFAULT_CONFIG);
    expect(tool.name).toBe("interrogate");
    expect(tool.label).toBe("interrogate");
    expect(tool.description).toBe(INTERROGATE_TOOL_DESCRIPTION);
    expect(tool.promptSnippet).toBe(INTERROGATE_PROMPT_SNIPPET);
    expect(tool.promptGuidelines).toBe(INTERROGATE_PROMPT_GUIDELINES);
    expect(tool.parameters).toBe(InterrogateParams);
    expect(typeof tool.execute).toBe("function");
    expect(typeof tool.renderCall).toBe("function");
    expect(typeof tool.renderResult).toBe("function");
  });

  test("execute maps the executor result into the pi content/details shape", async () => {
    const tool = createInterrogateTool(DEFAULT_CONFIG);
    const out = await tool.execute!("t1", { questions: [qi("q1")] }, undefined, undefined, tuiCtx() as unknown as ExtensionContext);
    expect(out.content).toHaveLength(1);
    expect(out.content[0].type).toBe("text");
    expect(out.content[0].type === "text" && out.content[0].text.split("\n")).toEqual([
      "0/1 answered · 0 re-asked · 0 moot · epoch 1",
      "Questions visible to the user.",
      "End your turn with a one-line note; do not call further tools.",
    ]);
    expect(out.details.action).toBe("upsert");
    expect(out.details.state.questions.q1).toBeDefined();
  });
});

// ------------------------------------------------------------------- hygiene

describe("module hygiene", () => {
  test("executor is non-blocking by construction: no user-input blocking, no UI surface, no send channel", () => {
    const src = fs.readFileSync(new URL("./tool.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/await/); // fully synchronous body (h2.0 §1)
    expect(src).not.toMatch(/ctx\.ui/); // no UI dependency beyond mode flags
    expect(src).not.toMatch(/sendMessage/); // state events are the only side channel
    expect(src).not.toMatch(/custom\s*\(/); // never opens the panel itself
  });
});

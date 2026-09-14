/**
 * src/ac-scripted.test.ts — scripted acceptance criteria over the SAME
 * production code paths (P1.M7.T6.S1; h2.10 ACs, h2.50 same-path rule,
 * plan/001_0d6760db6bc5/AUTOMATION-POLICY.md — BINDING: no live TUI, no real
 * interrogate call, no turn ever waits on a user).
 *
 * Every test drives the production modules exactly as a real session would:
 * `executeInterrogate` (the tool executor), the `/interrogate-debug-*`
 * handlers (h2.50 same-path drivers), the merge/state primitives the panel
 * uses, `buildSubmission`/`buildCompletion` delivery, the h2.44 lifecycle
 * engine, and the completion trigger. No panel is ever opened.
 *
 * [Mode A] PER-AC RESULTS TABLE (full details + defect log:
 * plan/001_0d6760db6bc5/P1M7T6S1/research/AC-RESULTS.md)
 *
 * | AC  | verdict | FR proven | evidence (test)                                            |
 * |-----|---------|-----------|------------------------------------------------------------|
 * | AC-2| PASS    | FR-3      | AC-2_submission_delta_three_lines_reminder_epoch_28_open    |
 * | AC-3| PASS*   | FR-4/FR-21| AC-3a_agent_settled_without_upsert_closes_submitted         |
 * |     |         |           | AC-3b_reask_resets_answer_and_preserves_draft               |
 * | AC-8| PASS    | FR-22     | AC-8_stale_upsert_rejected_then_self_heals (+ debug variant)|
 * | AC-11| PASS   | FR-25     | AC-11_print_mode_digest_answers_and_consistent_read         |
 * | AC-13| PASS   | FR-2/Q24=B| AC-13_editing_archived_answer_re_pends_and_flags_changed    |
 * | AC-14| PASS*  | FR-5      | AC-14_completion_record_fires_exactly_once                  |
 *
 * * PASS only after the P1.M7.T6.S1 defect fix: the ctrl+s submit flush
 *   (panel `submit()` + `/interrogate-debug-submit`) never performed the
 *   h2.38 `answered(pending) → submitted` transition, so the h2.44 close
 *   pass had nothing to archive and completion could never fire. Fixed in
 *   the owning modules (src/panel/actions.ts, src/debug-commands.ts); the
 *   AC tests below drive the FIXED production path end-to-end. Neither the
 *   close pass nor completion is reachable in a test that hand-seeds
 *   `markSubmitted`, so both ACs run through the real submit handler.
 *
 * Interactive-only leftovers (never attempted here, human-only):
 * MANUAL-TUI-AC-RUNBOOK.md — AC-1, AC-4, AC-5, AC-6, AC-7, AC-9, AC-10,
 * AC-12 (config-surface assertions live in config-surface.test.ts /
 * no-hardcoded-keys.test.ts from P1.M7.T5.S2; the live panel pass is
 * P1.M7.T6.S2's re-scoped human runbook).
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG } from "./config.js";
import { createCompletionTrigger, attemptCompletion } from "./completion.js";
import { buildSubmission, SUBMISSION_REMINDER, type CompletionMessage } from "./delivery.js";
import { registerDebugCommands } from "./debug-commands.js";
import { DraftStore } from "./draft-store.js";
import { RELAY_INSTRUCTION } from "./fallback.js";
import { StaleError } from "./guards.js";
import { createLifecycle, type Lifecycle } from "./lifecycle.js";
import { markSubmitted } from "./merge.js";
import { buildSubmissionCard } from "./renderers.js";
import { buildStatusLine } from "./results.js";
import { computeDiff } from "./snapshots.js";
import {
  createInterrogationState,
  getState,
  resetState,
  type SerializedState,
} from "./state.js";
import { executeInterrogate, type ExecutorContext } from "./tool.js";

// ------------------------------------------------------------------ fixtures

/** The h2.10 AC-1 group layout: 30 questions across 4 groups, one gate group. */
const GROUPS = ["scope", "data", "delivery", "process"] as const;
const GOAL = "Ship the 001 pilot";

/**
 * 30 questions (q01..q30; 8/8/8/6 per group). q09 marks the "data" group as
 * THE gate group (gate: true); q10 declares a dependsOn edge on q09 for the
 * later ACs (nothing in these state-level flows evaluates it — the instant
 * moot evaluator is panel-side). All choice questions share the
 * alpha/beta option pair so answer labels are uniform.
 */
function fixtureQuestions(): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (let i = 1; i <= 30; i++) {
    const id = `q${String(i).padStart(2, "0")}`;
    const group = GROUPS[Math.min(GROUPS.length - 1, Math.floor((i - 1) / 8))];
    const q: Record<string, unknown> = {
      id,
      title: `Question ${id}`,
      prompt: `Decide ${id}`,
      type: "choice",
      group,
      options: [
        { value: "alpha", label: "Alpha" },
        { value: "beta", label: "Beta" },
      ],
    };
    if (id === "q01") q.recommendation = "alpha";
    if (id === "q09") q.gate = true;
    if (id === "q10") q.dependsOn = [{ id: "q09", equals: "alpha" }];
    out.push(q);
  }
  return out;
}

/** Full-set upsert args in the wire shape the model would send. */
function fixtureUpsert(): { goal: string; epoch: number; questions: Array<Record<string, unknown>> } {
  return { goal: GOAL, epoch: 1, questions: fixtureQuestions() };
}

const ts = (): string => new Date().toISOString();

/** TUI executor stub: panel-capable session (tool.test.ts convention). */
function tuiCtx(): ExecutorContext {
  return { mode: "tui", hasUI: true, model: { contextWindow: 200_000 } };
}

/** Non-TUI executor stub (h2.26 fallback): print mode, no UI. */
function printCtx(): ExecutorContext {
  return { mode: "print", hasUI: false, model: { contextWindow: 200_000 } };
}

// -------------------------------------------------------------------- stubs

interface CmdCtx {
  ui: { notify: ReturnType<typeof vi.fn> };
}

/**
 * One mock pi standing in for BOTH surfaces the AC flows need: event
 * subscriptions (lifecycle) and command registration + transport (debug
 * commands, completion delivery). Handlers are captured by name and driven
 * via `emit` (lifecycle.test.ts convention); commands via `invoke`
 * (debug-commands.test.ts convention).
 */
function makePiHarness() {
  const commands = new Map<string, { handler: (args: string, ctx: CmdCtx) => Promise<void> }>();
  const sendMessage = vi.fn();
  const registerCommand = vi.fn((name: string, def: { handler: (args: string, ctx: CmdCtx) => Promise<void> }) => {
    commands.set(name, def);
  });
  const handlers = new Map<string, Array<(event: unknown) => void>>();
  const on = vi.fn((event: string, handler: (event: unknown) => void) => {
    const list = handlers.get(event) ?? [];
    list.push(handler);
    handlers.set(event, list);
    return () => {};
  });
  const pi = { on, registerCommand, sendMessage } as unknown as Pick<
    ExtensionAPI,
    "on" | "registerCommand" | "sendMessage"
  >;
  const emit = (event: string, payload: Record<string, unknown> = {}): void => {
    for (const handler of [...(handlers.get(event) ?? [])]) handler({ type: event, ...payload });
  };
  const ctx: CmdCtx = { ui: { notify: vi.fn() } };
  const invoke = async (name: string, args = ""): Promise<void> => {
    const def = commands.get(name);
    if (def === undefined) throw new Error(`command not registered: ${name}`);
    await def.handler(args, ctx);
  };
  return { pi, sendMessage, emit, ctx, invoke };
}

/**
 * Wire the h2.44 lifecycle + h3.9 completion trigger exactly like index.ts:
 * late-binding dismissPanel shim, completion trigger on the
 * onAfterClosePass seam, idle delivery probe.
 */
function wireLifecycle(h: ReturnType<typeof makePiHarness>): Lifecycle {
  let lifecycle: Lifecycle;
  lifecycle = createLifecycle(h.pi, {
    onAfterClosePass: createCompletionTrigger(h.pi, {
      lifecycle: {
        dismissPanel: () => lifecycle.dismissPanel(),
      },
      ctx: { isIdle: () => true },
    }),
  });
  return lifecycle;
}

/** Identity theme for renderer assertions (stub per renderers.test.ts). */
const stubTheme = {
  fg: (_name: string, s: string) => s,
  bold: (s: string) => s,
} as unknown as Theme;

type TextLike = { render(width: number): string[] };

/** Render a built component to trimmed display lines (wide → no wrap). */
function renderLines(component: TextLike): string[] {
  return component.render(500).map((l) => l.trimEnd());
}

beforeEach(() => {
  resetState(); // state is a MODULE SINGLETON — never share between tests
});

// ----------------------------------------------------------------- AC-2 (FR-3)

describe("AC-2 — submission delta, reminder, open count, epoch (FR-3)", () => {
  test("AC-2_submission_delta_three_lines_reminder_epoch_28_open", () => {
    // Model upserts the 30-question set through THE production executor.
    executeInterrogate(fixtureUpsert(), tuiCtx(), DEFAULT_CONFIG);
    const state = getState()!;
    expect(state.orderedQuestions()).toHaveLength(30);

    // User answers 2 of 30 — the h2.10 "answer 2 of 30, ctrl+s" pending set,
    // applied through the same raw primitive the panel commit path uses.
    const pre = state.serialize(); // PRE-flush baseline (submissionBaseline contract)
    state.applyAnswer("q01", { value: "alpha", at: ts() });
    state.applyAnswer("q02", { value: "beta", at: ts() });

    const diff = computeDiff(pre, state.serialize());
    expect(diff.changed.map((e) => e.id)).toEqual(["q01", "q02"]);
    expect(diff.remainOpen).toBe(28); // 28 remain open

    const epochBefore = state.epoch; // 1
    const msg = buildSubmission(state, diff); // does takeSnapshot + bumpEpoch ITSELF

    // ≤3-line delta with the byte-exact reminder line (h3.6).
    const lines = msg.content.split("\n");
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines[0]).toBe("Submitted 2: q01: Alpha; q02: Beta");
    expect(lines[1]).toBe(SUBMISSION_REMINDER);

    // Epoch bumps EXACTLY once — by buildSubmission, never by the caller
    // (double-bump anti-pattern). One call = one snapshot + one bump.
    expect(state.epoch).toBe(epochBefore + 1);
    expect(state.snapshots).toHaveLength(1);
    expect(state.snapshots[0]?.epoch).toBe(epochBefore); // pre-bump label
    expect(msg.details.epoch).toBe(epochBefore); // envelope carries the pre-bump epoch

    // The h2.28 status line the model sees afterwards: 2 answered of 30, epoch 2.
    expect(buildStatusLine(state.serialize())).toBe("2/30 answered · 0 re-asked · 0 moot · epoch 2");

    // The user-only card (rendered from details, h2.36) shows both answers
    // and the "28 remain open" footer.
    const cardLines = renderLines(buildSubmissionCard(msg, { expanded: false, outputPad: 0 }, stubTheme));
    expect(cardLines.some((l) => l.includes("Question q01: (unanswered) → Alpha"))).toBe(true);
    expect(cardLines.some((l) => l.includes("Question q02: (unanswered) → Beta"))).toBe(true);
    expect(cardLines.some((l) => l.endsWith("28 remain open"))).toBe(true);
  });
});

// ----------------------------------------------------------------- AC-3 (FR-4 / FR-21)

describe("AC-3 — auto-close vs re-ask; draft preserved (FR-4, FR-21, R4)", () => {
  /** Seed via the REAL flow: executor upsert → debug submit → agent settles. */
  async function seedSettledPair(): Promise<ReturnType<typeof makePiHarness>> {
    const h = makePiHarness();
    const lifecycle = wireLifecycle(h);
    registerDebugCommands(h.pi, DEFAULT_CONFIG, lifecycle);
    executeInterrogate(fixtureUpsert(), tuiCtx(), DEFAULT_CONFIG);
    await h.invoke("interrogate-debug-submit", "q01=alpha,q02=beta");
    h.emit("agent_settled"); // the agent reply to the submission
    return h;
  }

  test("AC-3a_agent_settled_without_upsert_closes_submitted", async () => {
    const h = await seedSettledPair();
    const state = getState()!;

    // The (fixed) ctrl+s flush left both in "submitted" at settle time.
    expect(state.getQuestion("q01")!.status).toBe("closed"); // archived
    expect(state.getQuestion("q02")!.status).toBe("closed"); // archived
    expect(state.getQuestion("q03")!.status).toBe("open"); // untouched

    // No re-ask happened and 28 questions are still active → completion
    // must NOT have fired: the only message so far is the submission delta.
    expect(h.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.sendMessage.mock.calls[0][0]).toMatchObject({
      customType: "interrogation-submission",
    });
  });

  test("AC-3b_reask_resets_answer_and_preserves_draft", async () => {
    await seedSettledPair();
    const state = getState()!;

    // R4: the panel-side draft slot for q01 (draft-store is extension
    // memory, separate from state answers — merge never sees it).
    const drafts = new DraftStore();
    drafts.setDraftEntry("q01", { value: "alpha", text: "leaning alpha for cost" });

    const closed = state.getQuestion("q01")!;
    expect(closed.status).toBe("closed");

    // The agent re-asks q01 with CHANGED options, echoing its current rev
    // (h2.38 reopen path: closed + changed options → rule 2 semantics).
    const res = executeInterrogate(
      {
        epoch: state.epoch,
        questions: [
          {
            id: "q01",
            title: "Question q01",
            prompt: "Decide q01",
            type: "choice",
            rev: closed.rev,
            options: [
              { value: "gamma", label: "Gamma" },
              { value: "delta", label: "Delta" },
            ],
          },
        ],
      },
      tuiCtx(),
      DEFAULT_CONFIG,
    );
    expect(res.details.action).toBe("upsert");

    const reasked = state.getQuestion("q01")!;
    expect(reasked.status).toBe("reasked"); // re-ask marker (⟳)
    expect(reasked.answer).toBeUndefined(); // answer reset — DELETE, not empty
    expect(reasked.rev).toBe(closed.rev + 1); // content mutation bumps rev

    // Draft-store slot UNCHANGED by the merge (h2.45 survival matrix:
    // upserts preserve drafts — rule 2 "surfaces when the user revisits").
    expect(drafts.getDraft("q01")).toBe("leaning alpha for cost");
    expect(drafts.hasDraft("q01")).toBe(true);
  });
});

// ----------------------------------------------------------------- AC-8 (FR-22)

describe("AC-8 — stale upsert rejected, self-heals (FR-22)", () => {
  /**
   * Build a genuinely stale caller: the model's round-1 view (q01 @ rev 1,
   * epoch 1) vs a state where q01 was text-updated (rev 2, rule 1) and TWO
   * submissions bumped the epoch to 3 (two submissions since the caller's
   * epoch also exercise a non-empty digestSince chain — with a single
   * submission the ring's first snapshot already contains the answer and
   * the digest degrades to "(none)", its documented behavior).
   */
  async function seedStaleWorld(h: ReturnType<typeof makePiHarness>): Promise<void> {
    executeInterrogate(fixtureUpsert(), tuiCtx(), DEFAULT_CONFIG); // epoch 1, q01 rev 1
    const state = getState()!;
    // Round-2 agent upsert: same options → rule 1 silent text update, rev → 2.
    executeInterrogate(
      {
        epoch: 1,
        questions: [
          {
            id: "q01",
            title: "Question q01",
            prompt: "Decide q01 (revised)",
            type: "choice",
            rev: 1,
            options: [
              { value: "alpha", label: "Alpha" },
              { value: "beta", label: "Beta" },
            ],
          },
        ],
      },
      tuiCtx(),
      DEFAULT_CONFIG,
    );
    expect(state.getQuestion("q01")!.rev).toBe(2);
    // Two submissions through the debug submit flow → epoch 3.
    await h.invoke("interrogate-debug-submit", "q02=beta");
    await h.invoke("interrogate-debug-submit", "q03=beta");
    expect(state.epoch).toBe(3);
  }

  /** The stale round-1 view re-applied verbatim: q01 @ rev 1, epoch 1. */
  function staleArgs(): { epoch: number; questions: Array<Record<string, unknown>> } {
    return {
      epoch: 1,
      questions: [
        {
          id: "q01",
          title: "Question q01",
          prompt: "Decide q01",
          type: "choice",
          rev: 1,
          options: [
            { value: "gamma", label: "Gamma" },
            { value: "delta", label: "Delta" },
          ],
        },
      ],
    };
  }

  test("AC-8_stale_upsert_rejected_then_self_heals", async () => {
    const h = makePiHarness();
    const lifecycle = wireLifecycle(h);
    registerDebugCommands(h.pi, DEFAULT_CONFIG, lifecycle);
    await seedStaleWorld(h);
    const state = getState()!;

    // Stale upsert through THE executor → StaleError propagates UNCAUGHT
    // (pi sets isError from the throw — guards.ts Mode A contract).
    let thrown: unknown;
    try {
      executeInterrogate(staleArgs(), tuiCtx(), DEFAULT_CONFIG);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(StaleError);
    const message = (thrown as StaleError).message;
    // Current rev + sent rev, current text, delta digest, heal instruction.
    expect(message).toContain("STALE: q01 is at rev 2 (you sent 1)");
    expect(message).toContain("session epoch is 3 (you sent 1)");
    expect(message).toContain("Current q01: Decide q01 (revised).");
    expect(message).toContain("Changes since epoch 1: q03: (unanswered)→Beta.");
    expect(message.endsWith("Re-apply against current state.")).toBe(true);

    // The guard fired BEFORE any mutation: q01 untouched (FR-22).
    expect(state.getQuestion("q01")!.rev).toBe(2);
    expect(state.getQuestion("q01")!.status).toBe("open");
    expect(state.getQuestion("q01")!.answer).toBeUndefined();

    // SELF-HEAL: the model re-applies against current state (fresh rev +
    // fresh epoch parsed from state / the STALE message) → success.
    const current = state.getQuestion("q01")!;
    const healed = executeInterrogate(
      {
        epoch: state.epoch,
        questions: [{ ...staleArgs().questions[0], rev: current.rev }],
      },
      tuiCtx(),
      DEFAULT_CONFIG,
    );
    expect(healed.details.action).toBe("upsert");
    const healedQ = state.getQuestion("q01")!;
    expect(healedQ.status).toBe("reasked"); // changed options → rule 2
    expect(healedQ.answer).toBeUndefined(); // (there was no answer to reset)
    expect(healedQ.rev).toBe(3); // exactly one more bump
  });

  test("AC-8_debug_upsert_surfaces_the_verbatim_stale_message", async () => {
    const h = makePiHarness();
    const lifecycle = wireLifecycle(h);
    registerDebugCommands(h.pi, DEFAULT_CONFIG, lifecycle);
    await seedStaleWorld(h);
    h.ctx.ui.notify.mockClear(); // ignore the seeding submits' notifies

    // Canonical message captured from the SAME throw the model would see.
    let canonical = "";
    try {
      executeInterrogate(staleArgs(), tuiCtx(), DEFAULT_CONFIG);
    } catch (e) {
      canonical = (e as StaleError).message;
    }

    // The debug command surfaces it VERBATIM (prefixed), at error level.
    await h.invoke("interrogate-debug-upsert", JSON.stringify(staleArgs()));
    expect(h.ctx.ui.notify).toHaveBeenCalledTimes(1);
    const [text, level] = h.ctx.ui.notify.mock.calls[0] as [string, string];
    expect(level).toBe("error");
    expect(text).toBe(`interrogate-debug-upsert: ${canonical}`);
    // State still untouched by the refused batch.
    expect(getState()!.getQuestion("q01")!.rev).toBe(2);
  });
});

// ---------------------------------------------------------------- AC-11 (FR-25)

describe("AC-11 — pi -p print mode: digest, answers[], consistent read (FR-25)", () => {
  test("AC-11_print_mode_digest_answers_and_consistent_read", () => {
    // Non-TUI upsert → status line + numbered markdown digest + relay line.
    const res = executeInterrogate(fixtureUpsert(), printCtx(), DEFAULT_CONFIG);
    expect(res.details.action).toBe("upsert");
    const content = res.content;
    const lines = content.split("\n");
    expect(lines[0]).toBe("0/30 answered · 0 re-asked · 0 moot · epoch 1");
    expect(content).toContain("INTERROGATION — Ship the 001 pilot (epoch 1)");
    expect(content).toContain("**1. Question q01** (`q01`)");
    expect(content).toContain("1) Alpha (`alpha`) ★"); // ★ marks the recommendation
    expect(content).toContain("Recommendation: Alpha");
    expect(content).toContain("**30. Question q30** (`q30`)"); // all 30 numbered
    expect(content.trimEnd().endsWith(RELAY_INSTRUCTION)).toBe(true);

    // The user answers in chat; the model records via answers[] (record
    // route, epoch-guarded). One unknown id proves tolerant collection.
    const rec = executeInterrogate(
      {
        epoch: 1,
        answers: [
          { id: "q01", value: "alpha" },
          { id: "q02", value: "beta" },
          { id: "zz", value: "bogus" },
        ],
      },
      printCtx(),
      DEFAULT_CONFIG,
    );
    expect(rec.details.action).toBe("record");
    expect(rec.content).toContain("unknown ids: zz");

    // State consistency: answers recorded (never touching rev), exactly one
    // submission bump, statuses answered.
    const state = getState()!;
    expect(state.getQuestion("q01")!.answer?.value).toBe("alpha");
    expect(state.getQuestion("q02")!.answer?.value).toBe("beta");
    expect(state.getQuestion("q01")!.status).toBe("answered");
    expect(state.getQuestion("q01")!.rev).toBe(1); // answers never bump rev
    expect(state.epoch).toBe(2); // one record call = one submission

    // Subsequent read reflects the recording — the model re-orients from it.
    const read = executeInterrogate({}, printCtx(), DEFAULT_CONFIG);
    expect(read.details.action).toBe("read");
    expect(read.details.epoch).toBe(2);
    expect(read.content).toContain("2/30 answered · 0 re-asked · 0 moot · epoch 2");
    expect(read.content).toContain("q01: Question q01 — answered (rev 1) · answered: alpha");
    expect(read.content).toContain("q02: Question q02 — answered (rev 1) · answered: beta");
  });
});

// ---------------------------------------------------------------- AC-13 (FR-2 / Q24=B)

describe("AC-13 — editing an archived answer re-pends and flags (changed)", () => {
  test("AC-13_editing_archived_answer_re_pends_and_flags_changed", async () => {
    // Drive one question to closed through the REAL flow.
    const h = makePiHarness();
    const lifecycle = wireLifecycle(h);
    registerDebugCommands(h.pi, DEFAULT_CONFIG, lifecycle);
    executeInterrogate(
      {
        goal: "Pick the store",
        epoch: 1,
        questions: [
          {
            id: "q1",
            title: "Database",
            prompt: "Which database?",
            type: "choice",
            recommendation: "sqlite",
            options: [
              { value: "sqlite", label: "SQLite" },
              { value: "postgres", label: "Postgres" },
            ],
          },
          // Never answered — stays open so the close pass after the settle
          // does NOT trigger completion (which would clear the state from
          // under this test's archived-edit assertions).
          {
            id: "q2",
            title: "Timeline",
            prompt: "When?",
            type: "text",
          },
        ],
      },
      tuiCtx(),
      DEFAULT_CONFIG,
    );
    await h.invoke("interrogate-debug-submit", "q1=sqlite");
    h.emit("agent_settled");
    const state = getState()!;
    expect(state.getQuestion("q1")!.status).toBe("closed"); // archived
    expect(state.getQuestion("q1")!.rev).toBe(1);
    expect(state.getQuestion("q2")!.status).toBe("open"); // completion blocker
    const pre: SerializedState = state.serialize(); // closed + answered baseline

    // The user edits the ARCHIVED answer (panel commit path primitive;
    // actions.ts acceptOptionIndex calls state.applyAnswer). FR-2: archived
    // means "not pending", not "immutable".
    state.applyAnswer("q1", { value: "postgres", at: ts() });
    const edited = state.getQuestion("q1")!;
    expect(edited.status).toBe("answered"); // re-marked pending
    expect(edited.answer?.value).toBe("postgres");
    expect(edited.rev).toBe(1); // rev untouched by answers

    // The next submission diff flags the archived edit (Q24=B marker data).
    const diff = computeDiff(pre, state.serialize());
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]).toEqual({
      id: "q1",
      title: "Database",
      from: "SQLite",
      to: "Postgres",
      editedArchived: true,
    });

    // ctrl+s flush (the FIXED production transition) → buildSubmission:
    // the model-visible delta carries the "(changed)" suffix.
    markSubmitted(state, ["q1"]);
    const msg = buildSubmission(state, diff);
    const lines = msg.content.split("\n");
    expect(lines[0]).toBe("Submitted 1: q1: Postgres (changed)");
    expect(lines[1]).toBe(SUBMISSION_REMINDER);

    // The user-only card renders "(changed)" (renderers.ts submission card).
    const cardLines = renderLines(buildSubmissionCard(msg, { expanded: false, outputPad: 0 }, stubTheme));
    expect(cardLines.some((l) => l.includes("Database: SQLite → Postgres (changed)"))).toBe(true);
  });
});

// ---------------------------------------------------------------- AC-14 (FR-5)

describe("AC-14 (state side) — completion record built once, exactly once (FR-5)", () => {
  test("AC-14_completion_record_fires_exactly_once", async () => {
    // Real wiring: lifecycle engine + completion trigger, index.ts style.
    const h = makePiHarness();
    const lifecycle = wireLifecycle(h);
    registerDebugCommands(h.pi, DEFAULT_CONFIG, lifecycle);

    executeInterrogate(
      {
        goal: GOAL,
        epoch: 1,
        questions: [
          {
            id: "q1",
            title: "Question q1",
            prompt: "Decide q1",
            type: "choice",
            group: "scope",
            recommendation: "alpha",
            options: [
              { value: "alpha", label: "Alpha" },
              { value: "beta", label: "Beta" },
            ],
          },
          {
            id: "q2",
            title: "Question q2",
            prompt: "Decide q2",
            type: "choice",
            group: "scope",
            options: [
              { value: "alpha", label: "Alpha" },
              { value: "beta", label: "Beta" },
            ],
          },
        ],
      },
      tuiCtx(),
      DEFAULT_CONFIG,
    );

    // Answer + submit BOTH questions → the settle's close pass closes both →
    // nothing active remains → the completion flow fires.
    await h.invoke("interrogate-debug-submit", "q1=alpha,q2=beta");
    expect(h.sendMessage).toHaveBeenCalledTimes(1); // submission delta only, so far
    h.emit("agent_settled");

    // EXACTLY one more message: the interrogation-completion record.
    expect(h.sendMessage).toHaveBeenCalledTimes(2);
    const [completionMsg, deliveryOptions] = h.sendMessage.mock.calls[1] as [
      CompletionMessage,
      Record<string, unknown>,
    ];
    expect(completionMsg.customType).toBe("interrogation-completion");

    // buildCompletion content (h2.46 record): goal header, grouped Q&A lines
    // with label-preferred answers + ★ on followed recommendations, NOTES
    // and Withdrawn/moot trailers.
    const content = completionMsg.content;
    expect(content.split("\n")[0]).toBe(`INTERROGATION COMPLETE — ${GOAL}`);
    expect(content).toContain("[scope] q1 Question q1: Alpha ★");
    expect(content).toContain("[scope] q2 Question q2: Beta");
    expect(content).toContain("NOTES: (none)");
    expect(content).toContain("Withdrawn/moot: (none)");
    expect(completionMsg.details.groups).toHaveLength(1);
    expect(completionMsg.details.groups[0]?.questions.map((q) => q.id)).toEqual(["q1", "q2"]);
    expect(completionMsg.details.epoch).toBe(2);
    // Delivery matrix idle branch (deliverSubmission contract).
    expect(deliveryOptions).toEqual({ triggerTurn: true, deliverAs: "followUp" });

    // State side: questions cleared, audit trail + flag retained.
    const state = getState()!;
    expect(state.completed).toBe(true); // the one-time guard, set by clearForCompletion
    expect(state.orderedQuestions()).toHaveLength(0);
    expect(state.goal).toBe(GOAL); // retained
    expect(state.epoch).toBe(2); // retained
    expect(state.snapshots).toHaveLength(1); // retained

    // Once-only: a re-trigger attempt injects NOTHING.
    h.emit("agent_settled"); // second settle → close pass no-op → trigger blocked
    expect(h.sendMessage).toHaveBeenCalledTimes(2);
    expect(
      attemptCompletion(
        h.pi,
        { lifecycle, ctx: { isIdle: () => true } },
        { closed: [], reasked: [], remainingActive: [] },
      ),
    ).toEqual({ fired: false, reason: "already-completed" });
    expect(h.sendMessage).toHaveBeenCalledTimes(2);

    // A fresh state (new interrogation) re-arms the flag — the guard is per
    // interrogation instance, not process-global (completion.ts contract).
    const fresh = createInterrogationState("again");
    expect(fresh.completed).toBe(false);
  });
});

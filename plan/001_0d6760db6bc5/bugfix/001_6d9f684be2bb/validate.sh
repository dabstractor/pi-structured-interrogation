#!/usr/bin/env bash
# ============================================================================
# validate.sh — comprehensive validation for pi-interrogator
#
# Phases (only what exists in this codebase):
#   0. Preflight        — toolchain + dependency checks
#   1. Type checking    — tsc --noEmit (package.json "typecheck")
#   2. Unit testing     — vitest run (package.json "test")
#   3. Style/keymap     — scripts/verify-keymap-conflicts.sh (repo's own guard)
#   4. Behavioral probes— round-1 bug-report reproduction steps re-run against
#                         the real code paths (executor/lifecycle/panel/
#                         reconstruction), plus production-wiring probes that
                         # drive the panel exactly as index.ts wires it.
#   5. E2E (real pi)    — headless real-pi load smoke + real interrogate tool
#                         execution in print mode (the documented user journey)
#   6. Summary          — pass/fail table; nonzero exit on any failure
#
# The probe suite is emitted to a scratch dir and removed afterwards; the
# repo tree is left untouched.
# ============================================================================
set -u
cd "$(dirname "$0")"

SCRATCH=".validation-scratch"
PASS=0
FAIL=0
FAILED_PHASES=()
PROBE_FAIL_DETAILS=""

# Category tags: [OK] expected-pass assertions (regression guard for the 12
# round-1 fixes), [BUG] probes that reproduce NEW defects (they fail loudly —
# each failing [BUG] probe is a validated finding, not a script error).

note()  { printf '%s\n' "$*"; }
phase() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
ok()    { printf '  \033[32mPASS\033[0m  %s\n' "$*"; PASS=$((PASS+1)); }
bad()   { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; FAIL=$((FAIL+1)); FAILED_PHASES+=("$*"); }

# ---------------------------------------------------------------------------
# Phase 0 — preflight
# ---------------------------------------------------------------------------
phase "Phase 0: preflight"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${NODE_MAJOR:-0}" -ge 22 ]; then
  ok "node $(node --version) (>= 22 required)"
else
  bad "node ${NODE_MAJOR}.x too old (>= 22 required)"
fi
[ -d node_modules ] && ok "node_modules present" || bad "node_modules missing — run npm install"
command -v npx >/dev/null && ok "npx available" || bad "npx missing"
if command -v pi >/dev/null; then ok "pi $(pi --version 2>/dev/null | head -1) available for E2E"; else
  note "  (pi not on PATH — Phase 5 will be skipped)"; fi

# ---------------------------------------------------------------------------
# Phase 1 — type checking
# ---------------------------------------------------------------------------
phase "Phase 1: type checking (tsc --noEmit)"
if npm run --silent typecheck >/tmp/validate-tsc.log 2>&1; then
  ok "typecheck clean"
else
  bad "typecheck failed"; sed -n '1,20p' /tmp/validate-tsc.log
fi

# ---------------------------------------------------------------------------
# Phase 2 — unit tests
# ---------------------------------------------------------------------------
phase "Phase 2: unit tests (vitest run)"
if npx vitest run --reporter=dot >/tmp/validate-vitest.log 2>&1; then
  ok "unit tests: $(grep -oE 'Tests  [0-9]+ passed' /tmp/validate-vitest.log | tail -1)"
else
  bad "unit tests failed"; tail -30 /tmp/validate-vitest.log
fi

# ---------------------------------------------------------------------------
# Phase 3 — repo's own keymap conflict guard
# ---------------------------------------------------------------------------
phase "Phase 3: keymap conflict guard"
if [ -x scripts/verify-keymap-conflicts.sh ]; then
  if bash scripts/verify-keymap-conflicts.sh >/tmp/validate-keymap.log 2>&1; then
    ok "keymap conflict guard clean"
  else
    bad "keymap conflict guard failed"; tail -20 /tmp/validate-keymap.log
  fi
else
  note "  (scripts/verify-keymap-conflicts.sh not found — skipped)"
fi

# ---------------------------------------------------------------------------
# Phase 4 — behavioral probes (round-1 repro steps + production wiring)
# ---------------------------------------------------------------------------
phase "Phase 4: behavioral probes"
mkdir -p "$SCRATCH"
cat > "$SCRATCH/probes.test.ts" <<'PROBES_EOF'
/**
 * Behavioral regression probes — pi-interrogator validation round 2.
 *
 * Two probe classes:
 *  - [OK]  Reproductions of the 12 round-1 bug-report repro steps, now
 *          expected to PASS (each verifies a fix end-to-end through real
 *          code paths: executor, lifecycle, panel actions, key router,
 *          reconstruction). Plus regression guards around the fixes.
 *  - [BUG] Probes reproducing NEW defects found this round. They are written
 *          as assertions of the SPECIFIED behavior, so they FAIL while the
 *          defect exists. Each failing [BUG] probe is a validated finding.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { DraftStore } from "../src/draft-store.js";
import { attemptCompletion } from "../src/completion.js";
import { interrogateToggleAction } from "../src/command.js";
import { buildSubmission } from "../src/delivery.js";
import { hasResumableQuestions } from "../src/panel/suspend.js";
import { buildKeyRouter, type RoutedActions } from "../src/panel/keys.js";
import { accept, submit, type SubmitDeps } from "../src/panel/actions.js";
import { InterrogationPanel, maybeAutoOpen } from "../src/panel/panel.js";
import { closeSubmitted, markSubmitted } from "../src/merge.js";
import { computeDiff } from "../src/snapshots.js";
import { reconstructFromBranch, type ReconstructionContext } from "../src/reconstruct.js";
import {
  createInterrogationState,
  getState,
  resetState,
  setState,
  type Question,
} from "../src/state.js";
import { executeInterrogate } from "../src/tool.js";

// ------------------------------------------------------------------ helpers

const T0 = "2025-01-01T00:00:00.000Z";
const TUI = { mode: "tui", hasUI: true };
const PRINT = { mode: "print", hasUI: false };
const OPTS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];

function q(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, prompt: `prompt:${id}`, type: "choice", options: OPTS.map((o) => ({ ...o })), ...extra };
}
function seedQuestion(id: string, extra: Partial<Question> = {}): Question {
  return { id, prompt: `prompt:${id}`, type: "choice", rev: 1, status: "open", options: OPTS.map((o) => ({ ...o })), ...extra };
}
const stubTheme = {
  fg: (_n: string, s: string) => s,
  bold: (s: string) => s,
} as never;

function makePanel(state: ReturnType<typeof createInterrogationState>, drafts: DraftStore) {
  return new InterrogationPanel({
    tui: { requestRender: vi.fn() } as never,
    theme: stubTheme,
    done: () => {},
    state,
    config: DEFAULT_CONFIG,
    drafts,
  } as never);
}
function makeDeps() {
  const sendMessage = vi.fn();
  return { deps: { sendMessage, isIdle: () => true } as unknown as SubmitDeps, sendMessage };
}

beforeEach(() => resetState());
afterEach(() => { resetState(); vi.restoreAllMocks(); });

// =====================================================================
// [OK] Round-1 bugs — each probe is the report's exact repro, now passing.
// =====================================================================

describe("[OK] BUG-001 goal mutability", () => {
  test("goal sent on a later upsert replaces the stored goal and reaches the read result", () => {
    executeInterrogate({ goal: "original goal", questions: [q("q1")] }, TUI);
    const rev = getState()!.getQuestion("q1")!.rev;
    const res = executeInterrogate({ goal: "UPDATED goal", epoch: 1, questions: [{ ...q("q1"), rev }] }, TUI);
    expect(getState()!.serialize().goal).toBe("UPDATED goal");
    expect(res.details.state.goal).toBe("UPDATED goal");
    expect(executeInterrogate({}, TUI).content).toContain("UPDATED goal");
  });
  test("goal omitted on a later upsert leaves the stored goal unchanged", () => {
    executeInterrogate({ goal: "keep me", questions: [q("q1")] }, TUI);
    const rev = getState()!.getQuestion("q1")!.rev;
    executeInterrogate({ epoch: 1, questions: [{ ...q("q1"), rev }] }, TUI);
    expect(getState()!.serialize().goal).toBe("keep me");
  });
});

describe("[OK] BUG-002 second-interrogation completion", () => {
  test("after a completed interrogation, a new interrogation completes too (fresh epoch, retained goal)", () => {
    const sendMessage = vi.fn();
    const pi = { on: () => () => {}, sendMessage };
    const lifecycle = { dismissPanel: vi.fn() };

    executeInterrogate({ goal: "first interrogation", questions: [q("q1")] }, TUI);
    let st = getState()!;
    st.applyAnswer("q1", { value: "a", at: T0 });
    markSubmitted(st, ["q1"]);
    closeSubmitted(st, ["q1"]);
    expect(attemptCompletion(pi, { lifecycle, getState: () => getState() }, { closed: ["q1"], reasked: [], remainingActive: [] })).toEqual({ fired: true });

    executeInterrogate({ questions: [q("n1")] }, TUI); // second interrogation
    st = getState()!;
    expect(st.serialize().epoch).toBe(1);
    expect(st.serialize().goal).toBe("first interrogation");
    expect(st.serialize().completed).toBe(false);
    st.applyAnswer("n1", { value: "b", at: T0 });
    markSubmitted(st, ["n1"]);
    closeSubmitted(st, ["n1"]);
    expect(attemptCompletion(pi, { lifecycle, getState: () => getState() }, { closed: ["n1"], reasked: [], remainingActive: [] })).toEqual({ fired: true });
    const sent = sendMessage.mock.calls.at(-1)![0] as { customType: string; content: string };
    expect(sent.customType).toBe("interrogation-completion");
    expect(sent.content).toContain("INTERROGATION COMPLETE — first interrogation");
    expect(sent.content).toContain("n1");
  });
});

describe("[OK] BUG-003 submission epoch contract", () => {
  test("submission content ends with the POST-bump epoch; echoing it passes assertFresh", () => {
    const st = createInterrogationState("g");
    setState(st);
    st.upsertQuestion(seedQuestion("q1"));
    const pre = st.serialize();
    st.applyAnswer("q1", { value: "b", at: T0 });
    const msg = buildSubmission(st, computeDiff(pre, st.serialize()));
    expect(msg.content).toMatch(/Submitted 1: q1: Beta \(state epoch 2\)\nConsider how these affect your other questions\./);
    expect(st.epoch).toBe(2);
    expect(() =>
      executeInterrogate({ questions: [{ ...q("q1"), prompt: "changed?", rev: 1 }], epoch: 2 }, TUI),
    ).not.toThrow();
  });
});

describe("[OK] BUG-004 non-TUI close + completion", () => {
  test("print-mode: upsert digest → answers[] → submitted → close → completion fires", () => {
    const sendMessage = vi.fn();
    const pi = { on: () => () => {}, sendMessage };
    const up = executeInterrogate({ goal: "print goal", questions: [q("q1")] }, PRINT);
    expect(up.content).toContain("1)");
    expect(up.content).toMatch(/relay/i);

    executeInterrogate({ answers: [{ id: "q1", value: "b" }], epoch: 1 }, PRINT);
    const st = getState()!;
    expect(st.getQuestion("q1")!.status).toBe("submitted");

    closeSubmitted(st, ["q1"]);
    expect(attemptCompletion(pi, { lifecycle: { dismissPanel: vi.fn() }, getState: () => getState() }, { closed: ["q1"], reasked: [], remainingActive: [] })).toEqual({ fired: true });
    expect((sendMessage.mock.calls.at(-1)![0] as { customType: string }).customType).toBe("interrogation-completion");
  });
});

describe("[OK] BUG-005 answered-pending resume", () => {
  test("suspended panel with 0 open but answered-pending questions resumes (not 'empty')", async () => {
    const suspendMod = await import("../src/panel/suspend.js");
    const resumeSpy = vi.spyOn(suspendMod, "resumePanel").mockReturnValue(true);
    const st = createInterrogationState("g");
    st.upsertQuestion(seedQuestion("q1"));
    st.applyAnswer("q1", { value: "a", at: T0 });
    setState(st);
    expect(hasResumableQuestions(st)).toBe(true);
    const host = { isOpen: () => false, isSuspended: () => true } as never;
    expect(interrogateToggleAction(host, {} as never, st)).toBe("resumed");
    expect(resumeSpy).toHaveBeenCalledTimes(1);

    const dead = createInterrogationState("g");
    dead.upsertQuestion(seedQuestion("q1"));
    dead.setStatus("q1", "closed");
    setState(dead);
    expect(interrogateToggleAction(host, {} as never, dead)).toBe("empty");
  });
});

describe("[OK] BUG-006 dependsOn re-evaluation", () => {
  test("agent upsert re-derives moot-ness instantly (no user action needed)", () => {
    executeInterrogate({ goal: "g", questions: [q("dep"), q("child", { dependsOn: [{ id: "dep", equals: "a" }] })] }, TUI);
    const st = getState()!;
    st.applyAnswer("dep", { value: "b", at: T0 });
    const res = executeInterrogate({ epoch: 1, questions: [{ ...q("dep"), rev: st.getQuestion("dep")!.rev }] }, TUI);
    expect(res.details.state.questions.child.status).toBe("moot");
  });
  test("re-upsert that REMOVES dependsOn reopens a moot question", () => {
    executeInterrogate({ goal: "g", questions: [q("dep"), q("child", { dependsOn: [{ id: "dep", equals: "a" }] })] }, TUI);
    const st = getState()!;
    st.applyAnswer("dep", { value: "b", at: T0 });
    executeInterrogate({ epoch: 1, questions: [{ ...q("dep"), rev: st.getQuestion("dep")!.rev }] }, TUI);
    const res2 = executeInterrogate({ epoch: 1, questions: [{ ...q("child"), rev: st.getQuestion("child")!.rev }] }, TUI);
    expect(res2.details.state.questions.child.status).toBe("open");
  });
});

describe("[OK] BUG-007 reconstruction value fidelity", () => {
  test("submission replay restores RAW answer values (not labels) and keeps dependents open", () => {
    const base = {
      goal: "g", epoch: 1, completed: false, order: ["q1", "q2"],
      questions: {
        q1: { ...seedQuestion("q1") },
        q2: { ...seedQuestion("q2", { dependsOn: [{ id: "q1", equals: "b" }] }) },
      },
    };
    const branch = [
      { type: "message", message: { role: "toolResult", toolName: "interrogate", details: { state: base } } },
      {
        type: "custom_message", customType: "interrogation-submission",
        content: "Submitted 1: q1: Beta (state epoch 2)", display: true,
        details: {
          changed: [{ id: "q1", title: "q1", from: "(unanswered)", to: "Beta", editedArchived: false, value: "b" }],
          epoch: 1, card: { changed: [], epoch: 1, remainOpen: 1 },
        },
      },
    ] as never[];
    const ctx = {
      mode: "tui", hasUI: true,
      sessionManager: { getBranch: () => branch },
      ui: { custom: () => new Promise(() => {}) },
    } as unknown as ReconstructionContext;
    reconstructFromBranch(ctx, { config: DEFAULT_CONFIG, host: {} as never, drafts: new DraftStore() });
    const st = getState()!;
    expect(st.getQuestion("q1")!.answer?.value).toBe("b");
    expect(st.getQuestion("q2")!.status).toBe("open");
    expect(st.epoch).toBe(2);
  });
});

describe("[OK] BUG-008 submit flush scope", () => {
  test("submit ships only user shipments; the re-asked question's draft survives and is never shown retracted", () => {
    executeInterrogate({ goal: "g", questions: [q("q1"), q("q2")] }, TUI);
    const st = getState()!;
    const drafts = new DraftStore();
    const panel = makePanel(st, drafts);
    const { deps, sendMessage } = makeDeps();

    st.applyAnswer("q1", { value: "a", at: T0 });
    drafts.setDraft("q1", "first draft");
    expect(submit(panel, deps)).toBe(true);
    expect(st.epoch).toBe(2);

    executeInterrogate({ epoch: 2, questions: [{ id: "q1", prompt: "changed?", type: "choice", rev: 1, options: [{ value: "a", label: "Alpha2" }, { value: "c", label: "Gamma" }] }] }, TUI);
    expect(st.getQuestion("q1")!.status).toBe("reasked");
    expect(st.getQuestion("q1")!.answer).toBeUndefined();

    drafts.setDraft("q1", "my elaboration draft");
    st.applyAnswer("q2", { value: "b", at: T0 });
    expect(submit(panel, deps)).toBe(true);
    const sent = sendMessage.mock.calls.at(-1)![0] as { content: string };
    expect(sent.content).toContain("q2");
    expect(sent.content).not.toContain("(unanswered)");
    expect(drafts.getDraft("q1")).toBe("my elaboration draft");
    expect(st.epoch).toBe(3);
  });
  test("submit with only agent-caused resets is a no-op (no delivery, no epoch burn, note held)", () => {
    executeInterrogate({ goal: "g", questions: [q("q1")] }, TUI);
    const st = getState()!;
    const drafts = new DraftStore();
    const panel = makePanel(st, drafts);
    const { deps, sendMessage } = makeDeps();
    st.applyAnswer("q1", { value: "a", at: T0 });
    submit(panel, deps);
    executeInterrogate({ epoch: 2, questions: [{ id: "q1", prompt: "changed?", type: "choice", rev: 1, options: [{ value: "a", label: "Alpha2" }, { value: "c", label: "Gamma" }] }] }, TUI);
    drafts.setNote("hold me");
    sendMessage.mockClear();
    expect(submit(panel, deps)).toBe(true);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(st.epoch).toBe(2);
    expect(drafts.getNote()).toBe("hold me");
  });
});

describe("[OK] BUG-009 goal cap enforcement", () => {
  test("create-path goal over 400 chars is truncated in state AND warned in the result", () => {
    const res = executeInterrogate({ goal: "G".repeat(1000), questions: [q("q1")] }, TUI);
    expect(getState()!.serialize().goal.length).toBe(400);
    expect(res.content).toContain("goal truncated at 1000 chars");
  });
  test("update-path goal over 400 chars is truncated in state too", () => {
    executeInterrogate({ goal: "short", questions: [q("q1")] }, TUI);
    const rev = getState()!.getQuestion("q1")!.rev;
    const res = executeInterrogate({ goal: "U".repeat(500), epoch: 1, questions: [{ ...q("q1"), rev }] }, TUI);
    expect(getState()!.serialize().goal.length).toBe(400);
    expect(res.content).toContain("goal truncated at 500 chars");
  });
});

describe("[OK] BUG-010 epoch presence guard", () => {
  test("upsert touching an existing id with NO epoch is rejected with the current epoch", () => {
    executeInterrogate({ questions: [q("q1")] }, TUI);
    expect(() => executeInterrogate({ questions: [{ ...q("q1"), rev: 1 }] }, TUI)).toThrow(/requires the session epoch \(current 1\)/);
  });
});

describe("[OK] BUG-011 focusText view gating", () => {
  test("ctrl+t is inert in deep and overview views, live in short view", () => {
    const fn = () => vi.fn() as never;
    const actions = {
      optionUp: fn(), optionDown: fn(), digit: fn(), accept: fn(),
      prevQuestion: fn(), nextQuestion: fn(), submit: fn(),
      onDeep: fn(), onOverview: fn(), onFocusText: fn(), onBatchNote: fn(),
      onBreakOut: fn(), onDiscuss: fn(), onExternalEditor: fn(),
    } as unknown as RoutedActions;
    const route = buildKeyRouter(DEFAULT_CONFIG, actions);
    const deep = { view: "deep", focus: "options", isResolved: () => false } as never;
    expect(route("\u0014", deep)).toBe(false);
    expect(actions.onFocusText).not.toHaveBeenCalled();
    const overview = { view: "overview", focus: "options", isResolved: () => false } as never;
    route("\u0014", overview);
    expect(actions.onFocusText).not.toHaveBeenCalled();
    const short = { view: "short", focus: "options", isResolved: () => false } as never;
    expect(route("\u0014", short)).toBe(true);
    expect(actions.onFocusText).toHaveBeenCalledTimes(1);
  });
});

describe("[OK] BUG-012 terminal-status answer gate", () => {
  test("recording an answer against a withdrawn question is ignored, not resurrected", () => {
    executeInterrogate({ goal: "g", questions: [q("q1"), q("q2")] }, PRINT);
    executeInterrogate({ epoch: 1, questions: [{ ...q("q2"), rev: 1 }] }, PRINT);
    expect(getState()!.getQuestion("q1")!.status).toBe("withdrawn");
    const res = executeInterrogate({ answers: [{ id: "q1", value: "x" }], epoch: 1 }, PRINT);
    expect(getState()!.getQuestion("q1")!.status).toBe("withdrawn");
    expect(res.content).toContain("not recordable");
    expect(res.details.state.epoch).toBe(1);
  });
});

// =====================================================================
// [OK] Regression guards around the fixes
// =====================================================================

describe("[OK] regression guards", () => {
  test("stale epoch on a touch-upsert is still rejected (guard not weakened)", () => {
    executeInterrogate({ goal: "g", questions: [q("q1")] }, TUI);
    const st = getState()!;
    st.applyAnswer("q1", { value: "a", at: T0 });
    const pre = st.serialize();
    st.applyAnswer("q1", { value: "b", at: T0 });
    buildSubmission(st, computeDiff(pre, st.serialize()));
    expect(() => executeInterrogate({ questions: [{ ...q("q1"), rev: 1 }], epoch: 1 }, TUI)).toThrow(/STALE: session epoch is 2/);
  });

  test("integrated TUI happy path: upsert → panel answer → submit → close → completion exactly once", () => {
    const sendMessage = vi.fn();
    const pi = { on: () => () => {}, sendMessage };
    executeInterrogate({
      goal: "migration plan",
      questions: [q("q1", { group: "gate", gate: true, recommendation: "a" }), q("q2", { group: "gate" })],
    }, TUI);
    const st = getState()!;
    const panel = makePanel(st, new DraftStore());
    const { deps, sendMessage: submitSend } = makeDeps();

    panel.currentId = "q1";
    expect(accept(panel)).toBe(true);
    panel.currentId = "q2";
    expect(accept(panel)).toBe(true);
    expect(submit(panel, deps)).toBe(true);
    expect(st.epoch).toBe(2);
    const delta = submitSend.mock.calls.at(-1)![0] as { customType: string; content: string };
    expect(delta.customType).toBe("interrogation-submission");
    expect(delta.content).toContain("(state epoch 2)");

    closeSubmitted(st, ["q1", "q2"]);
    const lifecycle = { dismissPanel: vi.fn() };
    expect(attemptCompletion(pi, { lifecycle, getState: () => getState() }, { closed: ["q1", "q2"], reasked: [], remainingActive: [] })).toEqual({ fired: true });
    expect(attemptCompletion(pi, { lifecycle, getState: () => getState() }, { closed: [], reasked: [], remainingActive: [] })).toEqual({ fired: false, reason: "already-completed" });
    const completions = sendMessage.mock.calls.filter((c) => (c[0] as { customType: string }).customType === "interrogation-completion");
    expect(completions).toHaveLength(1);
    const record = completions[0][0] as { content: string };
    expect(record.content).toContain("INTERROGATION COMPLETE — migration plan");
    expect(record.content).toContain("★");
    expect(record.content).toContain("NOTES: (none)");
    expect(record.content).toContain("Withdrawn/moot: (none)");
    expect(st.completed).toBe(true);
    expect(st.orderedQuestions()).toHaveLength(0);
  });

  test("answers[] epoch guard still enforced in print mode", () => {
    executeInterrogate({ goal: "g", questions: [q("q1")] }, PRINT);
    expect(() => executeInterrogate({ answers: [{ id: "q1", value: "a" }] }, PRINT)).toThrow(/answers requires epoch/);
  });
});

// =====================================================================
// [BUG] NEW defects found this round — these probes FAIL while the defect
// exists; each failure is a validated finding (see validation_report.md).
// =====================================================================

describe("[BUG] NEW-1: ctrl+s is inert in production (no SubmitDeps ever wired)", () => {
  test("production wiring: upsert → maybeAutoOpen panel → answer → ctrl+s — a submission is delivered", () => {
    const handlers: Record<string, unknown> = {};
    const sent: unknown[] = [];
    let panelFactory: unknown;
    const surface = {
      mode: "tui",
      ui: {
        custom: (factory: unknown) => { panelFactory = factory; return new Promise<null>(() => {}); },
        setWidget: vi.fn(),
        getEditorComponent: () => undefined,
      },
      on: (ev: string, cb: unknown) => { handlers[ev] = cb; return () => {}; },
      sendMessage: (m: unknown) => { sent.push(m); },
    };

    // Exactly what index.ts wires at factory time.
    maybeAutoOpen(surface as never, DEFAULT_CONFIG, { isOpen: () => false } as never, new DraftStore());

    // Model upserts via the real executor.
    executeInterrogate(
      { goal: "prod wiring", questions: [{ id: "q1", prompt: "pick", type: "choice", options: OPTS.map((o) => ({ ...o })) }] },
      TUI,
    );

    // pi fires tool_execution_end with the run ctx — the production open path.
    (handlers["tool_execution_end"] as (e: unknown, c: unknown) => void)({ toolName: "interrogate", isError: false }, surface);
    expect(panelFactory).toBeTruthy();

    const panel = (panelFactory as (t: unknown, th: unknown, k: unknown, d: unknown) => InterrogationPanel)(
      { requestRender: () => {} }, stubTheme, undefined, () => {},
    );

    // User answers, then presses ctrl+s (default submit accelerator).
    panel.currentId = "q1";
    panel.handleInput("\r");
    expect(getState()!.getQuestion("q1")!.status).toBe("answered");
    panel.handleInput("\x13");

    // SPECIFIED (FR-3): the submission fires — epoch bumps, delta delivered.
    expect(sent.length).toBeGreaterThan(0);              // ← fails: 0 messages ever sent
    expect(getState()!.epoch).toBe(2);                   // ← fails: epoch stays 1
    expect(getState()!.getQuestion("q1")!.status).toBe("submitted"); // ← fails: stays 'answered'
  });
});

describe("[BUG] NEW-2: type:'text' questions cannot be answered from the panel", () => {
  test("type a text answer, stage-1 enter, ctrl+s — the answer reaches the model", () => {
    const st = createInterrogationState("g");
    setState(st);
    st.upsertQuestion({ id: "t1", prompt: "describe", type: "text", rev: 1, status: "open" });
    const drafts = new DraftStore();
    const panel = makePanel(st, drafts);

    panel.focusTextField();
    panel.handleInput("my detailed answer");
    panel.handleInput("\r"); // stage-1 enter saves the draft
    expect(drafts.getDraft("t1")).toBe("my detailed answer");

    const { deps, sendMessage } = makeDeps();
    submit(panel, deps);

    // SPECIFIED (FR-12/Q16/h2.45 "text answers ship"):
    expect(st.getQuestion("t1")!.answer?.value).toBe("my detailed answer"); // ← fails: answer undefined
    expect(st.getQuestion("t1")!.status).toBe("submitted");                 // ← fails: stays 'open'
    const sent = sendMessage.mock.calls.at(-1)?.[0] as { content: string } | undefined;
    expect(sent?.content).toContain("my detailed answer");                  // ← fails: nothing sent
  });
});

describe("[BUG] NEW-3: typed elaborations (✎ drafts) are silently discarded at submit", () => {
  test("choice answer + typed elaboration — the elaboration ships with the answer", () => {
    const st = createInterrogationState("g");
    setState(st);
    st.upsertQuestion(seedQuestion("q1"));
    const drafts = new DraftStore();
    const panel = makePanel(st, drafts);

    panel.currentId = "q1";
    accept(panel);
    panel.focusTextField();
    panel.handleInput("because of latency");
    panel.handleInput("\r");
    expect(drafts.getDraft("q1")).toBe("because of latency");

    const { deps, sendMessage } = makeDeps();
    submit(panel, deps);

    // SPECIFIED (R4 "destroyed only by submission — text answers ship";
    // completion record grammar `{— free text}`):
    expect(st.getQuestion("q1")!.answer?.text).toBe("because of latency");  // ← fails: text undefined
    const sent = sendMessage.mock.calls.at(-1)?.[0] as { content: string } | undefined;
    expect(sent?.content).toContain("because of latency");                   // ← fails: never delivered
  });
});
PROBES_EOF

if npx vitest run "$SCRATCH/probes.test.ts" > /tmp/validate-probes.log 2>&1; then
  ok "behavioral probes: all green ($(grep -oE 'Tests  [0-9]+ passed' /tmp/validate-probes.log | tail -1))"
else
  # Distinguish [OK] regressions (must pass) from [BUG] findings (expected fail).
  ok_tests=$(grep -oE '[0-9]+ passed' /tmp/validate-probes.log | tail -1 || true)
  bug_fails=$(grep -E 'FAIL.*\[BUG\]' /tmp/validate-probes.log | sed 's/.*> //' | sort -u)
  ok_fails=$(grep -E 'FAIL' /tmp/validate-probes.log | grep -v '\[BUG\]' | head -5)
  note "  probe results: ${ok_tests:-unknown}"
  if [ -n "$ok_fails" ]; then
    bad "[OK] regression probe failed (round-1 fix may have regressed): $(echo "$ok_fails" | head -2)"
    tail -40 /tmp/validate-probes.log
  fi
  if [ -n "$bug_fails" ]; then
    note "  [BUG] probes failing as expected (validated findings):"
    echo "$bug_fails" | sed 's/^/    - /'
    # Findings found — report as a failed phase so the exit code is nonzero.
    bad "new-defect probes reproduced: $(echo "$bug_fails" | wc -l) finding(s)"
    PROBE_FAIL_DETAILS="$bug_fails"
  fi
fi

# ---------------------------------------------------------------------------
# Phase 5 — E2E with the REAL pi runtime (documented user journeys)
# ---------------------------------------------------------------------------
phase "Phase 5: E2E — real pi runtime"
if command -v pi >/dev/null; then
  # Journey 1: extension loads cleanly in a real headless session (install path:
  # "pi -e src/index.ts" per README) and the model replies normally.
  if timeout 150 pi -p -e ./src/index.ts "Reply with the single word: ok" >/tmp/validate-pi-load.log 2>&1 \
     && grep -qi "ok" /tmp/validate-pi-load.log; then
    ok "real pi: extension loads headless and session completes"
  else
    bad "real pi: load smoke failed"; tail -15 /tmp/validate-pi-load.log
  fi

  # Journey 2: the model drives the interrogate tool for real in print mode
  # (non-TUI digest flow, FR-25) — upsert → numbered digest → epoch result.
  if timeout 180 pi -p -e ./src/index.ts "Use the interrogate tool: upsert exactly one question {id:'q1', prompt:'Pick one', type:'choice', options:[{value:'a',label:'Alpha'},{value:'b',label:'Beta'}]} with goal 'e2e smoke'. Then reply with just the epoch number shown in the tool result." >/tmp/validate-pi-tool.log 2>&1 \
     && grep -q "1" /tmp/validate-pi-tool.log; then
    ok "real pi: interrogate tool executed in print mode (epoch returned)"
  else
    bad "real pi: tool-execution journey failed"; tail -15 /tmp/validate-pi-tool.log
  fi
else
  note "  (pi not on PATH — E2E skipped)"
fi

# ---------------------------------------------------------------------------
# Phase 6 — summary
# ---------------------------------------------------------------------------
phase "Summary"
printf '  checks passed : %d\n  checks failed : %d\n' "$PASS" "$FAIL"
if [ -n "$PROBE_FAIL_DETAILS" ]; then
  note "  validated defect findings (see validation_report.md):"
  echo "$PROBE_FAIL_DETAILS" | sed 's/^/    * /'
fi
rm -rf "$SCRATCH"

if [ "$FAIL" -eq 0 ]; then
  note "RESULT: PASS — all validation phases green."
  exit 0
else
  note "RESULT: FAIL — ${#FAILED_PHASES[@]} check(s) failed:"
  printf '    - %s\n' "${FAILED_PHASES[@]}"
  exit 1
fi

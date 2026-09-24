#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# validate.sh — comprehensive validation for pi-interrogator
#
# Phases (only those that exist in this codebase):
#   1. Type checking        (tsc --noEmit — package.json "typecheck")
#   2. Unit testing         (vitest run — package.json "test"; 1278 tests)
#   3. E2E validation       (journey harness driving the REAL modules:
#                           panel key routing, write-in editor duties,
#                           auto-submit/gate hold, lifecycle close pass +
#                           completion, remote bridge submit/nack parity,
#                          draft sacredness across every editor exit)
#
# No linter/formatter configs exist in this repo (no eslint/prettier/biome),
# so those phases are intentionally absent.
#
# The E2E file is materialized at runtime as .validate-e2e.tmp.test.ts
# (matched by vitest's default include) and always removed afterwards.
# ---------------------------------------------------------------------------
set -uo pipefail
cd "$(dirname "$0")"

E2E_FILE=".validate-e2e.tmp.test.ts"
PASS=()
FAIL=()

cleanup() { rm -f "$E2E_FILE"; }
trap cleanup EXIT

phase() { echo ""; echo "=============================================================="; echo "== $1"; echo "=============================================================="; }

# --------------------------------------------------------------- Phase 1
phase "PHASE 1: Type checking (tsc --noEmit)"
if npx tsc --noEmit; then
  PASS+=("typecheck")
  echo "[PASS] typecheck"
else
  FAIL+=("typecheck")
  echo "[FAIL] typecheck"
fi

# --------------------------------------------------------------- Phase 2
phase "PHASE 2: Unit tests (vitest run)"
if npx vitest run 2>&1 | tail -25; then
  PASS+=("unit-tests")
  echo "[PASS] unit-tests"
else
  FAIL+=("unit-tests")
  echo "[FAIL] unit-tests"
fi

# --------------------------------------------------------------- Phase 3
phase "PHASE 3: E2E journey validation"
mkdir -p . && cat > "$E2E_FILE" <<'E2E_EOF'
/**
 * Runtime-materialized E2E validation harness (deleted by validate.sh).
 *
 * Drives COMPLETE user journeys from the README through the REAL modules —
 * no reimplementation: real InterrogationPanel with the config-driven key
 * router fed raw terminal bytes, real InterrogationState, real DraftStore,
 * real lifecycle close pass (agent_settled), real completion trigger, and
 * the real remote bridge on a fake events bus. Scenarios mirror the PRD's
 * acceptance criteria (WRITEIN-001/002, AUTOSUBMIT-001/002, SURFACE-001/002,
 * AC-2/AC-13, R4 draft sacredness, remote bridge parity) end to end.
 */
import { describe, test, expect, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG } from "./src/config.js";
import {
  createInterrogationState,
  type InterrogationState,
  type Question,
  type QuestionAnswer,
} from "./src/state.js";
import { InterrogationPanel } from "./src/panel/panel.js";
import { DraftStore } from "./src/draft-store.js";
import { createLifecycle, type ClosePassResult } from "./src/lifecycle.js";
import { createCompletionTrigger } from "./src/completion.js";
import { digit } from "./src/panel/actions.js";
import { discussInChat } from "./src/panel/discuss.js";
import {
  createRemoteBridge,
  PI_ASK_STARTED,
  PI_ASK_SUBMIT,
  PI_ASK_SUBMIT_RESULT,
  PI_ASK_COMPLETED,
} from "./src/remote-bridge.js";

// ---------------------------------------------------------------- fixtures

const T0 = "2025-01-01T00:00:00.000Z";
const stubTheme = {
  fg: (_name: string, s: string) => s,
  bold: (s: string) => s,
} as unknown as Theme;

const OPTS_AB = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];

function choiceQ(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    prompt: `prompt:${id}`,
    type: "choice",
    rev: 1,
    status: "open",
    options: OPTS_AB.map((o) => ({ ...o })),
    ...overrides,
  };
}
function textQ(id: string, overrides: Partial<Question> = {}): Question {
  return { id, prompt: `prompt:${id}`, type: "text", rev: 1, status: "open", ...overrides };
}

interface Spec {
  id: string;
  overrides?: Partial<Question>;
}

function seedState(specs: Spec[]): InterrogationState {
  const state = createInterrogationState("validation goal");
  for (const { id, overrides = {} } of specs) {
    state.upsertQuestion(overrides.type === "text" ? textQ(id, overrides) : choiceQ(id, overrides));
    const status = overrides.status ?? "open";
    if (status === "answered" && overrides.answer !== undefined) {
      state.applyAnswer(id, { at: T0, ...overrides.answer } as QuestionAnswer);
    } else if (status !== "open") {
      state.setStatus(id, status);
    }
  }
  return state;
}

function makeHarness(specs: Spec[], sharedSent?: any[]) {
  const state = seedState(specs);
  const drafts = new DraftStore();
  const sent: any[] = sharedSent ?? [];
  const delivery = {
    sendMessage: (m: unknown) => sent.push(m),
    isIdle: () => true,
  };
  const requestRender = vi.fn();
  const done = vi.fn();
  const panel = new InterrogationPanel({
    tui: { requestRender, terminal: { rows: 40 } } as unknown as TUI,
    theme: stubTheme,
    done,
    state,
    config: DEFAULT_CONFIG,
    drafts,
    delivery,
  });
  return { state, panel, drafts, sent, delivery, requestRender, done };
}

/** Fake pi with a record/replay event stream + sendMessage. */
function makeEventPi(sent: any[] = []) {
  const handlers = new Map<string, Array<(data?: unknown) => void>>();
  const pi: any = {
    sent,
    on: (ev: string, cb: (data?: unknown) => void) => {
      if (!handlers.has(ev)) handlers.set(ev, []);
      handlers.get(ev)!.push(cb);
      return () => {};
    },
    sendMessage: (m: unknown) => sent.push(m),
    emit: (ev: string, data?: unknown) => {
      for (const cb of handlers.get(ev) ?? []) cb(data);
    },
  };
  return pi;
}

/** Fake events bus recording every emission. */
function fakeBus() {
  const handlers = new Map<string, Array<(d: unknown) => void>>();
  const emitted: Array<{ event: string; data: any }> = [];
  return {
    on(ev: string, cb: (d: unknown) => void) {
      if (!handlers.has(ev)) handlers.set(ev, []);
      handlers.get(ev)!.push(cb);
      return () => {};
    },
    emit(ev: string, data: unknown) {
      emitted.push({ event: ev, data });
      for (const cb of handlers.get(ev) ?? []) cb(data);
    },
    emitted,
  };
}

/** Open the write-in editor on a choice question's ✎ Other row. */
function openWriteIn(panel: InterrogationPanel, id: string) {
  panel.currentId = id;
  const q = panel.state.getQuestion(id)!;
  panel.cursorIndex = (q.options?.length ?? 0); // ✎ Other row
  expect(panel.handleInput("\r")).toBe(true);
}

const line1 = (msg: any): string => String(msg.content).split("\n")[0];

// ================================================================ journeys

describe("E2E — full user journeys (README workflows)", () => {
  test("journey: answer all → auto-submit → agent settles → close pass → completion record", () => {
    const sent: any[] = [];
    const pi = makeEventPi(sent);
    const { state, panel } = makeHarness([{ id: "q1" }, { id: "q2" }], sent);
    let trigger: (r: ClosePassResult) => void = () => {};
    const lifecycle = createLifecycle(pi, {
      getState: () => state,
      onAfterClosePass: (r) => trigger(r),
    });
    trigger = createCompletionTrigger(pi, { getState: () => state, lifecycle });
    lifecycle.onPanelDismiss(() => panel.suspend());

    expect(panel.currentId).toBe("q1");
    panel.handleInput("\r"); // accept Alpha on q1 → advance to q2 (no submit yet)
    expect(sent).toHaveLength(0);
    panel.handleInput("\r"); // accept Alpha on q2 → completeness auto-submit
    expect(sent).toHaveLength(1);
    expect(sent[0].customType).toBe("interrogation-submission");
    expect(line1(sent[0])).toBe("Submitted 2: q1: Alpha; q2: Alpha (state epoch 2)");
    expect(panel.footerFlash?.text).toBe("submitted — 2 answer(s)");

    pi.emit("agent_settled"); // close pass: q1/q2 → closed, then completion
    // (state is cleared by completion — closure is proven by the surviving
    //  close-pass snapshot + the completion record below)
    expect(state.snapshots.at(-1)?.state.questions.q1?.status).toBe("closed");
    // all closed → completion record delivered, panel dismissed, state cleared
    expect(sent).toHaveLength(2);
    expect(sent[1].customType).toBe("interrogation-completion");
    expect(sent[1].content).toContain("Alpha");
    expect(state.completed).toBe(true);
    expect(state.orderedQuestions()).toHaveLength(0);
    expect(panel.isResolved()).toBe(true);
  });

  test("journey: elaboration drafts and batch note ride the submission (NEW-003 / R3)", async () => {
    const { state, panel, drafts, sent } = makeHarness([{ id: "q1" }, { id: "q2" }]);
    panel.handleInput("\r"); // q1 = Alpha → advance q2
    panel.currentId = "q1";
    panel.handleInput("\x14"); // ctrl+t → elaboration editor
    expect(panel.focus).toBe("text");
    expect(panel.textDuty).toBe("elaboration");
    panel.textField.setText("because reasons");
    panel.handleInput("\r"); // enter saves + blurs (never answers)
    expect(state.getQuestion("q1")?.status).toBe("answered");

    panel.enterNoteMode();
    panel.textField.setText("ship this note");
    panel.handleInput("\r"); // note-mode enter → exitNoteMode write-through
    expect(panel.batchNote).toBe("ship this note");

    panel.currentId = "q2";
    panel.handleInput("\r"); // q2 = Alpha → completeness auto-submit
    expect(sent).toHaveLength(1);
    expect(line1(sent[0])).toContain("q1: Alpha — because reasons");
    expect(sent[0].content).toContain("NOTE: ship this note");
    expect(sent[0].details.note).toBe("ship this note");
    expect(drafts.getNote()).toBe(""); // cleared after shipping
  });

  test("journey: digit quick-select answers real options; ✎ Other row is never digit-selectable", () => {
    const { state, panel } = makeHarness([{ id: "q1" }, { id: "q2" }]);
    expect(panel.handleInput("1")).toBe(true);
    expect(state.getQuestion("q1")?.answer?.value).toBe("a");
    expect(digit(panel, 3)).toBe(false); // 3rd option does not exist → fall-through
  });
});

// ==================================================== PRD bug-fix regression

describe("E2E — PRD BUG-001 (gate hold renders in the canonical flow)", () => {
  test("committing later-group answers while the gate is open arms the ⚠ hold and withholds; answering the gate ships", () => {
    const { state, panel, sent } = makeHarness([
      { id: "g1", overrides: { group: "foundation", gate: true } },
      { id: "n1", overrides: { group: "later" } },
      { id: "n2", overrides: { group: "later" } },
    ]);
    expect(panel.currentId).toBe("g1"); // FR-1: gate group focus

    panel.currentId = "n1";
    panel.handleInput("\r"); // answer n1 while g1 unanswered
    expect(sent).toHaveLength(0); // auto-submit WITHHELD
    expect(panel.gateWarning).toMatchObject({ count: 1, kind: "hold" });
    const lines = panel.render(100).join("\n");
    expect(lines).toContain("foundational unanswered");
    expect(lines).toContain("answer them or");
    expect(lines).toContain("to submit now");
    expect(panel.footerFlash).toBeUndefined(); // no flash on the hold path

    panel.currentId = "n2";
    panel.handleInput("\r"); // answer n2 — still held
    expect(sent).toHaveLength(0);

    panel.handleInput("\t"); // any key dismisses the hold; tab → prevQuestion → g1
    expect(panel.currentId).toBe("g1");
    expect(panel.gateWarning).toBeNull();
    panel.handleInput("\r"); // answer the gate → completeness fires
    expect(sent).toHaveLength(1);
    expect(line1(sent[0])).toBe("Submitted 3: g1: Alpha; n1: Alpha; n2: Alpha (state epoch 2)");
    expect(panel.footerFlash?.text).toBe("submitted — 3 answer(s)");
  });

  test("ctrl+s remains the deliberate override while the gate is held", () => {
    const { state, panel, sent } = makeHarness([
      { id: "g1", overrides: { group: "foundation", gate: true } },
      { id: "n1", overrides: { group: "later" } },
    ]);
    panel.currentId = "n1";
    panel.handleInput("\r");
    expect(panel.gateWarning?.kind).toBe("hold");
    panel.handleInput("\x13"); // ctrl+s override
    expect(sent).toHaveLength(1);
    expect(line1(sent[0])).toContain("Submitted 1: n1: Alpha");
    // delivered partial re-arms the legacy submit-time warning
    expect(panel.gateWarning).toMatchObject({ count: 1, kind: "submit" });
  });
});

describe("E2E — PRD BUG-002 (draft sacredness on every editor exit)", () => {
  test("ctrl+c from a focused write-in editor stages the draft before suspending", () => {
    const { panel, drafts, done } = makeHarness([{ id: "q1" }]);
    openWriteIn(panel, "q1");
    panel.textField.setText("precious unsaved typing");
    panel.handleInput("\x03"); // ctrl+c
    expect(done).toHaveBeenCalledWith(null);
    expect(drafts.getDraft("q1")).toBe("precious unsaved typing");
    expect(panel.draftTextFor("q1")).toBe("precious unsaved typing");
  });

  test("discuss-in-chat (ctrl+shift+e) preserves the in-flight draft", async () => {
    const { panel, drafts } = makeHarness([{ id: "q1" }]);
    openWriteIn(panel, "q1");
    panel.textField.setText("precious elaboration in flight");
    const fakePi = { ui: { setEditorText: vi.fn() }, mode: "tui" };
    discussInChat(fakePi as any, panel);
    expect(panel.isResolved()).toBe(true);
    expect(drafts.getDraft("q1")).toBe("precious elaboration in flight");
    await vi.waitFor(() => expect(fakePi.ui.setEditorText).toHaveBeenCalled());
  });

  test("note-mode swap (ctrl+shift+m) stages the question draft and restores it on exit", () => {
    const { panel, drafts } = makeHarness([{ id: "q1" }, { id: "q2" }]);
    openWriteIn(panel, "q1");
    panel.textField.setText("precious elaboration");
    panel.enterNoteMode();
    expect(drafts.getDraft("q1")).toBe("precious elaboration"); // staged BEFORE the note seed
    expect(panel.textField.getText()).toBe(""); // editor now holds the note
    panel.textField.setText("a note");
    panel.exitNoteMode();
    expect(panel.batchNote).toBe("a note");
    // re-open the editor on q1 → the question draft re-seeds
    panel.handleInput("\x14");
    expect(panel.textField.getText()).toBe("precious elaboration");
  });

  test("esc-esc editor exit saves the draft (ESC-002)", () => {
    const { panel, drafts } = makeHarness([{ id: "q1" }]);
    openWriteIn(panel, "q1");
    panel.textField.setText("half done");
    panel.handleInput("\x1b");
    panel.handleInput("\x1b");
    expect(panel.focus).toBe("options");
    expect(drafts.getDraft("q1")).toBe("half done");
  });

  test("drafts survive suspend into a FRESH panel instance (reopen re-seeds from the store)", () => {
    const { state, panel, drafts, sent } = makeHarness([{ id: "q1" }, { id: "q2" }]);
    openWriteIn(panel, "q1");
    panel.textField.setText("kept across suspend");
    panel.suspend();
    expect(drafts.getDraft("q1")).toBe("kept across suspend");

    const panel2 = new InterrogationPanel({
      tui: { requestRender: vi.fn(), terminal: { rows: 40 } } as unknown as TUI,
      theme: stubTheme,
      done: vi.fn(),
      state,
      config: DEFAULT_CONFIG,
      drafts,
      delivery: { sendMessage: (m: unknown) => sent.push(m), isIdle: () => true },
    });
    openWriteIn(panel2, "q1");
    expect(panel2.textField.getText()).toBe("kept across suspend");
  });
});

describe("E2E — PRD BUG-003 (AC-13 archived-edit (changed) marker through the real pipeline)", () => {
  test("submit → settle close → edit the closed answer → resubmit flags (changed); completion carries the edit", () => {
    const sent: any[] = [];
    const pi = makeEventPi(sent);
    const { state, panel } = makeHarness([{ id: "q1" }, { id: "q2" }], sent);
    let trigger: (r: ClosePassResult) => void = () => {};
    const lifecycle = createLifecycle(pi, {
      getState: () => state,
      onAfterClosePass: (r) => trigger(r),
    });
    trigger = createCompletionTrigger(pi, { getState: () => state, lifecycle });
    // (the first settle keeps q3 open → no completion; the final settle
    //  completes — the trigger is live for both.)

    panel.handleInput("\r"); // q1 = Alpha
    panel.handleInput("\r"); // q2 = Alpha → auto-submit
    expect(sent).toHaveLength(1);

    state.upsertQuestion(choiceQ("q3")); // agent follow-up keeps it alive
    pi.emit("agent_settled"); // close pass: q1/q2 → closed (+ close snapshot)
    expect(state.getQuestion("q1")?.status).toBe("closed");
    expect(sent).toHaveLength(1); // q3 open → no completion

    openWriteIn(panel, "q1"); // edit the ARCHIVED answer
    panel.textField.setText("edited archived answer");
    panel.handleInput("\r"); // commit the write-in edit
    expect(state.getQuestion("q1")?.status).toBe("answered");
    panel.handleInput("\x13"); // q3 still open → deliberate ctrl+s
    expect(sent).toHaveLength(2);
    expect(line1(sent[1])).toContain("q1: ✎ edited archived answer (changed)");
    expect(sent[1].details.changed.some((e: any) => e.id === "q1" && e.editedArchived === true)).toBe(true);

    panel.currentId = "q3";
    panel.handleInput("\r"); // answer q3 → completeness auto-submit
    pi.emit("agent_settled"); // final close → completion
    expect(sent).toHaveLength(4);
    expect(sent[3].customType).toBe("interrogation-completion");
    expect(sent[3].content).toContain("edited archived answer");
    expect(state.completed).toBe(true);
  });
});

describe("E2E — PRD BUG-004 (write-in duty re-derives on navigation)", () => {
  test("navigating from a write-in session to a ★ option cursor downgrades to elaboration; enter never commits", () => {
    const { state, panel, drafts } = makeHarness([
      { id: "q1", overrides: { recommendation: "a" } },
      { id: "q2", overrides: { recommendation: "b" } },
    ]);
    openWriteIn(panel, "q1");
    expect(panel.textDuty).toBe("writein");
    panel.textField.setText("half typed"); // in-flight buffer for q1
    panel.handleInput("\x1b[Z"); // shift+tab → nextQuestion (q2)
    expect(panel.currentId).toBe("q2");
    expect(panel.cursorIndex).toBe(1); // ★ Beta preselect
    expect(panel.textDuty).toBe("elaboration"); // re-derived from the cursor
    expect(panel.draftTextFor("q1")).toBe("half typed"); // write-through on switch
    panel.textField.setText("x");
    panel.handleInput("\r"); // elaboration enter → save + blur, NEVER answers
    expect(state.getQuestion("q2")?.status).toBe("open");
    expect(state.getQuestion("q2")?.answer).toBeUndefined();
    expect(panel.draftTextFor("q2")).toBe("x");
    expect(panel.focus).toBe("options");
  });
});

describe("E2E — PRD BUG-005 (recorded write-ins are visible on revisit)", () => {
  test("choice write-in shows ✎ on the question line + preview; text answer previews; overview agrees", () => {
    const { panel } = makeHarness([
      { id: "q1", overrides: { status: "answered", answer: { value: "my write-in", custom: true } } },
      { id: "q2", overrides: { type: "text", status: "answered", answer: { value: "text answer" } } },
    ]);
    panel.currentId = "q1";
    const lines = panel.render(100).join("\n");
    expect(lines).toContain("✎ text answer"); // question-line marker
    expect(lines).toContain("my write-in"); // revisit preview (first line of value)
    panel.currentId = "q2";
    expect(panel.render(100).join("\n")).toContain("text answer");
    panel.setView("overview");
    expect(panel.render(100).join("\n")).toContain("✎"); // overview marker agrees
  });
});

describe("E2E — PRD BUG-006 (bounded, single-line model delta)", () => {
  test("a 3000-char write-in is capped on the content line; the card keeps the full text", () => {
    const { state, panel, sent } = makeHarness([{ id: "q1" }, { id: "q2" }]);
    openWriteIn(panel, "q1");
    panel.textField.setText("X".repeat(3000));
    panel.handleInput("\r");
    panel.handleInput("\r"); // q2 → auto-submit
    expect(sent).toHaveLength(1);
    expect(line1(sent[0]).length).toBeLessThanOrEqual(240);
    expect(line1(sent[0])).toContain("…");
    expect(sent[0].details.changed[0].to.length).toBeGreaterThan(3000); // card untruncated
  });

  test("multi-line write-in flattens to a single content line (≤3-line delta)", () => {
    const { panel, sent } = makeHarness([{ id: "q1" }, { id: "q2" }]);
    openWriteIn(panel, "q1");
    panel.textField.setText("line one\nline two 🚀");
    panel.handleInput("\r");
    panel.handleInput("\r");
    expect(sent).toHaveLength(1);
    const contentLines = String(sent[0].content).split("\n");
    expect(contentLines).toHaveLength(2); // 1 content + 1 reminder (no note)
    expect(contentLines[0]).toContain("line one / line two");
  });

  test("emoji-only write-ins never split a surrogate pair in the capped line", () => {
    const { panel, sent } = makeHarness([{ id: "q1" }, { id: "q2" }]);
    openWriteIn(panel, "q1");
    panel.textField.setText("x" + "🚀".repeat(300));
    panel.handleInput("\r");
    panel.handleInput("\r");
    expect(sent).toHaveLength(1);
    const l = line1(sent[0]);
    // lone (unpaired) UTF-16 surrogate ⇒ broken character emitted to the model
    expect(l.match(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/)).toBeNull();
  });
});

describe("E2E — PRD BUG-007 (remote bridge acks internal errors)", () => {
  test("an internal throw mid-pipeline nacks internal_error and completes the flow (client never hangs)", () => {
    const { state } = makeHarness([{ id: "q1" }, { id: "q2" }]);
    const bus = fakeBus();
    const modelSent: any[] = [];
    const pi = { events: bus, sendMessage: (m: unknown) => modelSent.push(m) };
    const bridge = createRemoteBridge(pi as any, { config: DEFAULT_CONFIG, getState: () => state });
    const flowId = bridge.emitFlow(state, "tool");
    expect(flowId).toBeTruthy();
    expect(bus.emitted.filter((e) => e.event === PI_ASK_STARTED)).toHaveLength(1);

    const boom = () => {
      throw new Error("listener exploded");
    };
    state.on("changed", boom);
    bus.emit(PI_ASK_SUBMIT, {
      version: 1,
      requestId: "r1",
      flowId,
      response: { kind: "answer", answers: { q1: { values: ["a"] } } },
    });
    state.off("changed", boom);

    const nack = bus.emitted.find((e) => e.event === PI_ASK_SUBMIT_RESULT);
    expect(nack).toBeDefined();
    expect(nack!.data.ok).toBe(false);
    expect(nack!.data.error).toBe("internal_error");
    expect(bus.emitted.some((e) => e.event === PI_ASK_COMPLETED)).toBe(true);
    expect(modelSent).toHaveLength(0);
    expect(state.getQuestion("q1")?.status).toBe("answered"); // documented half-mutation
  });

  test("bridge parity: valid submits ack ok, ship one delta with write-in shapes, and resurface", () => {
    const { state } = makeHarness([
      { id: "q1" },
      { id: "q2", overrides: { type: "text" } },
      { id: "q3" },
    ]);
    const bus = fakeBus();
    const modelSent: any[] = [];
    const pi = { events: bus, sendMessage: (m: unknown) => modelSent.push(m) };
    const bridge = createRemoteBridge(pi as any, { config: DEFAULT_CONFIG, getState: () => state });
    const flowId = bridge.emitFlow(state, "tool")!;

    bus.emit(PI_ASK_SUBMIT, {
      version: 1,
      requestId: "r2",
      flowId,
      response: {
        kind: "answer",
        answers: {
          q1: { values: ["a"] },
          q2: { customText: "remote free text" },
        },
      },
    });
    const ack = bus.emitted.find((e) => e.event === PI_ASK_SUBMIT_RESULT)!;
    expect(ack.data.ok).toBe(true);
    expect(modelSent).toHaveLength(1);
    expect(line1(modelSent[0])).toContain("Submitted 2:");
    expect(line1(modelSent[0])).toContain("q2: ✎ remote free text");
    expect(state.getQuestion("q2")?.answer?.custom).toBe(true);
    expect(bus.emitted.some((e) => e.event === PI_ASK_COMPLETED)).toBe(true);
    // q3 still live → resurface re-emits a fresh flow
    expect(bus.emitted.filter((e) => e.event === PI_ASK_STARTED)).toHaveLength(2);
  });

  test("invalid bridge answers nack invalid_answer and re-render the client", () => {
    const { state } = makeHarness([{ id: "q1" }]);
    const bus = fakeBus();
    const pi = { events: bus, sendMessage: () => {} };
    const bridge = createRemoteBridge(pi as any, { config: DEFAULT_CONFIG, getState: () => state });
    const flowId = bridge.emitFlow(state, "tool")!;
    bus.emit(PI_ASK_SUBMIT, {
      version: 1,
      requestId: "r3",
      flowId,
      response: { kind: "answer", answers: { q1: { values: ["zzz"] } } },
    });
    const nack = bus.emitted.find((e) => e.event === PI_ASK_SUBMIT_RESULT)!;
    expect(nack.data.ok).toBe(false);
    expect(nack.data.error).toBe("invalid_answer");
    expect(bus.emitted.filter((e) => e.event === PI_ASK_STARTED)).toHaveLength(2); // replay
  });
});

describe("E2E — PRD BUG-008 (enter opens the write-in editor on text questions)", () => {
  test("enter on the ✎ affordance opens the write-in duty and enter commits the answer", () => {
    const { state, panel, sent } = makeHarness([{ id: "q1", overrides: { type: "text" } }]);
    expect(panel.currentId).toBe("q1");
    expect(panel.cursorIndex).toBe(0);
    panel.handleInput("\r"); // enter on the affordance → editor
    expect(panel.focus).toBe("text");
    expect(panel.textDuty).toBe("writein");
    expect(panel.render(100).join("\n")).toContain("OTHER"); // duty label
    panel.textField.setText("free text answer");
    panel.handleInput("\r"); // write-in enter commits
    expect(state.getQuestion("q1")?.answer).toMatchObject({ value: "free text answer", custom: true });
    expect(sent).toHaveLength(1); // completeness auto-submitted the set
  });

  test("empty write-in enter saves the draft and blurs without committing (h2.32)", () => {
    const { state, panel, sent } = makeHarness([{ id: "q1" }, { id: "q2" }]);
    openWriteIn(panel, "q1");
    panel.handleInput("\r"); // empty buffer
    expect(state.getQuestion("q1")?.status).toBe("open");
    expect(panel.focus).toBe("options");
    expect(sent).toHaveLength(0);
  });
});

describe("E2E — NEW findings (open issues; these FAIL until fixed)", () => {
  test("ISSUE A: the per-entry cap must never split a UTF-16 surrogate pair (emoji write-ins)", () => {
    const { panel, sent } = makeHarness([{ id: "q1" }, { id: "q2" }]);
    openWriteIn(panel, "q1");
    panel.textField.setText("🚀".repeat(300)); // boundary lands mid-pair
    panel.handleInput("\r");
    panel.handleInput("\r");
    expect(sent).toHaveLength(1);
    const l = line1(sent[0]);
    expect(l.length).toBeLessThanOrEqual(240);
    // Lone-surrogate detector: lone high surrogate (not followed by a low)
    // OR lone low surrogate (at string start or after a non-high unit).
    expect(l.match(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/)).toBeNull();
  });

  test("ISSUE B: superseding a committed write-in with an option must not ship the stale write-in as elaboration", () => {
    const { state, panel, sent } = makeHarness([{ id: "q1" }, { id: "q2" }]);
    openWriteIn(panel, "q1");
    panel.textField.setText("my custom answer");
    panel.handleInput("\r"); // commit the write-in → advance writes it into q1's draft slot too
    panel.handleInput("\r"); // q2 → auto-submit ships the store slot
    // user changes their mind: supersede the write-in with option accept
    panel.currentId = "q1";
    panel.handleInput("\r"); // accept Alpha (set already complete → edit ships immediately)
    expect(sent).toHaveLength(2);
    expect(line1(sent[1])).toBe("Submitted 1: q1: Alpha (state epoch 3)");
    expect(state.getQuestion("q1")?.answer?.value).toBe("a");
  });
});
E2E_EOF

echo "--- running E2E journeys (vitest) ---"
if npx vitest run "$E2E_FILE" 2>&1 | tail -40; then
  PASS+=("e2e-journeys")
  echo "[PASS] e2e-journeys"
else
  FAIL+=("e2e-journeys")
  echo "[FAIL] e2e-journeys"
fi

# ------------------------------------------------------------------ verdict
echo ""
phase "VALIDATION SUMMARY"
echo "Passed phases: ${PASS[*]:-none}"
echo "Failed phases: ${FAIL[*]:-none}"
if [ ${#FAIL[@]} -gt 0 ]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: PASS"
exit 0

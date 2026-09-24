/**
 * src/panel/ripple-confirm.test.ts — FR-18 / Q39=B invalidation confirm
 * tests (P1.M5.T4.S1).
 *
 * Conventions follow two-stage.test.ts (AUTOMATION-POLICY: no live pi
 * session): identity theme stub + bare TUI stub, real InterrogationStates
 * seeded through the raw primitives (upsertQuestion → applyAnswer →
 * setStatus for submitted/reasked/moot), vi.fn() spies for the DraftStore
 * seam, and keys driven as RAW terminal bytes through panel.handleInput
 * with the REAL config router — the modal interception must beat the
 * router's fixed enter/esc, not a test double.
 *
 * Mode A fixture (h2.57): Q1(choice, answered) ← Q2(choice, answered,
 * dependsOn Q1 equals a) ← Q3(choice, submitted, dependsOn Q1 equals a +
 * Q2 equals a) plus an unrelated open Q4 as the advance target. Q3 carries
 * BOTH conjuncts because moot is audit-trailed (answers are never cleared):
 * a purely Q2-conditioned Q3 would stay dependency-met after Q2 mootered.
 * With the dual conjunct, re-answering Q1 a→b mootered BOTH victims
 * (FR-17) while computeRipple still reports the transitive chain [Q2, Q3].
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type EditorComponent, type TUI } from "@earendil-works/pi-tui";
import { describe, expect, test, vi, type Mock } from "vitest";
import { DEFAULT_CONFIG } from "../config.js";
import { dependencyMet } from "../depends-on.js";
import { createInterrogationState, type InterrogationState, type Question } from "../state.js";
import { renderConfirmFooter } from "./layout.js";
import type { DraftStore, InterrogationPanelArgs } from "./panel.js";
import { InterrogationPanel } from "./panel.js";

// ------------------------------------------------------------------ fixtures

const stubTheme = {
  fg: (_name: string, s: string) => s,
  bold: (s: string) => s,
} as unknown as Theme;

const T0 = "2025-01-01T00:00:00.000Z";

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

/**
 * The Mode A ripple chain: q1 ← q2 ← q3 (all answered/submitted) + q4
 * (open, no deps) as the accept-advance target. Ripple of q1 = [q2, q3]
 * (BFS order); victims = [q2, q3].
 */
function seedRippleChain(): InterrogationState {
  const state = createInterrogationState("goal");
  state.upsertQuestion(choiceQ("q1"));
  state.upsertQuestion(choiceQ("q2", { dependsOn: [{ id: "q1", equals: "a" }] }));
  state.upsertQuestion(
    choiceQ("q3", { dependsOn: [{ id: "q1", equals: "a" }, { id: "q2", equals: "a" }] }),
  );
  state.upsertQuestion(choiceQ("q4"));
  state.applyAnswer("q1", { value: "a", at: T0 });
  state.applyAnswer("q2", { value: "a", at: T0 });
  state.applyAnswer("q3", { value: "a", at: T0 });
  state.setStatus("q3", "submitted");
  return state;
}

/** Text chain: t1 (text, answered "recorded text") ← c2 (answered, dependsOn t1); c3 open. */
function seedTextChain(): InterrogationState {
  const state = createInterrogationState("goal");
  state.upsertQuestion(textQ("t1"));
  state.upsertQuestion(choiceQ("c2", { dependsOn: [{ id: "t1" }] }));
  state.upsertQuestion(choiceQ("c3"));
  state.applyAnswer("t1", { value: "recorded text", at: T0 });
  state.applyAnswer("c2", { value: "a", at: T0 });
  return state;
}

/** Fresh DraftStore seam spy (two-stage.test.ts pattern). */
function draftsSpy(): DraftStore & {
  getDraft: Mock;
  setDraft: Mock;
  getNote: Mock;
  setNote: Mock;
} {
  return {
    getDraft: vi.fn(),
    setDraft: vi.fn(),
    getNote: vi.fn(() => ""),
    setNote: vi.fn(),
  };
}

/** Stateful fake composed editor (two-stage.test.ts pattern, trimmed). */
function fakeEditor(): EditorComponent & { handleInput: Mock } {
  let lines: string[] = [""];
  return {
    getText: vi.fn(() => lines.join("\n")),
    getExpandedText: vi.fn(() => lines.join("\n")),
    setText: vi.fn((t: string) => {
      lines = t.split("\n");
    }),
    handleInput: vi.fn((data: string) => {
      // A lone ESC is a parsed-but-unbound key for the stock Editor — never
      // inserted (ESC-002 forwards single escs to the editor; the fake
      // mirrors real semantics instead of naively appending the byte).
      if (data === "\u001b") return;
      const cur = lines[0] ?? "";
      lines[0] = cur + data;
    }),
    render: vi.fn(() => lines.map((l) => `|${l}`)),
    focused: false,
  } as unknown as EditorComponent & { handleInput: Mock };
}

interface Handle {
  panel: InterrogationPanel;
  editor: ReturnType<typeof fakeEditor>;
  drafts: ReturnType<typeof draftsSpy>;
}

/** Panel with full seams (real config router); `opts` overrides panel args. */
function makePanel(state: InterrogationState, opts: Partial<InterrogationPanelArgs> = {}): Handle {
  const editor = fakeEditor();
  const drafts = draftsSpy();
  const panel = new InterrogationPanel({
    tui: { requestRender: vi.fn() } as unknown as TUI,
    theme: stubTheme,
    done: () => {},
    state,
    config: DEFAULT_CONFIG,
    drafts,
    editorFactory: () => editor,
    ...opts,
  });
  return { panel, editor, drafts };
}

/**
 * Trigger the choice confirm on q1: park the cursor on option "b"
 * (recorded answer "a" sits at index 0) and press enter. Fails loudly if
 * the confirm mode did not engage.
 */
function triggerChoiceConfirm(panel: InterrogationPanel): void {
  panel.currentId = "q1";
  panel.cursorIndex = 1; // propose "b"
  panel.handleInput("\r");
  if (panel.confirmMode === null) throw new Error("confirm mode did not engage");
}

// ------------------------------------------------------------------- tests

describe("ripple confirm — choice gate (FR-18)", () => {
  test("test_edit_answered_with_victims_swaps_footer_and_defers_commit", () => {
    const state = seedRippleChain();
    const { panel } = makePanel(state);
    triggerChoiceConfirm(panel);

    // Modal stashed with the FULL victim closure in BFS order.
    expect(panel.confirmMode?.kind).toBe("choice");
    expect(panel.confirmMode?.questionId).toBe("q1");
    expect(panel.confirmMode?.victims).toEqual(["q2", "q3"]);
    expect(panel.confirmMode?.proposed?.value).toBe("b");

    // NOTHING committed: answer, statuses, cursor, current question.
    expect(state.getQuestion("q1")?.answer?.value).toBe("a");
    expect(state.getQuestion("q1")?.status).toBe("answered");
    expect(state.getQuestion("q2")?.status).toBe("answered");
    expect(state.getQuestion("q3")?.status).toBe("submitted");
    expect(panel.currentId).toBe("q1");
    expect(panel.cursorIndex).toBe(1); // still on the proposal, not yet applied

    // Footer REPLACED (exactly one ⚠ line, no standard ⏎ footer), and the
    // confirm line is the exact copy.
    const lines = panel.render(120);
    const confirm = lines.filter((l) => l.includes("⚠ Invalidates"));
    expect(confirm).toHaveLength(1);
    expect(confirm[0]).toContain("⚠ Invalidates 2 answered questions (q2, q3)");
    expect(confirm[0]).toContain("— enter=keep, esc=cancel");
    expect(lines.some((l) => l.includes("⏎"))).toBe(false);
  });

  test("test_esc_cancels_with_zero_state_change", () => {
    const state = seedRippleChain();
    const { panel, drafts } = makePanel(state);
    triggerChoiceConfirm(panel);

    // Capture EVERYTHING the AC-7 byte-identical contract protects.
    const serialized = JSON.stringify(state.serialize());
    const answerRefs = ["q1", "q2", "q3", "q4"].map((id) => state.getQuestion(id)?.answer);
    const snapshots = state.snapshots.length;
    const epoch = state.epoch;

    expect(panel.handleInput("\u001b")).toBe(true); // esc

    expect(panel.confirmMode).toBeNull();
    expect(JSON.stringify(state.serialize())).toBe(serialized); // byte-identical
    // Same answer OBJECT references — applyAnswer never ran (it assigns a
    // fresh object; deep-view's veto detection relies on that identity).
    expect(state.getQuestion("q1")?.answer).toBe(answerRefs[0]);
    expect(state.getQuestion("q2")?.answer).toBe(answerRefs[1]);
    expect(state.getQuestion("q3")?.answer).toBe(answerRefs[2]);
    expect(state.snapshots.length).toBe(snapshots);
    expect(state.epoch).toBe(epoch);
    // Cursor restored to the recorded answer's option ("a" → index 0),
    // NOT the proposal index — and the user stays on q1 (AC-7).
    expect(panel.cursorIndex).toBe(0);
    expect(panel.currentId).toBe("q1");
    expect(drafts.setDraft).not.toHaveBeenCalled();
    // Footer back to the standard render (no confirm line).
    const lines = panel.render(80);
    expect(lines.some((l) => l.includes("⚠ Invalidates"))).toBe(false);
    expect(lines.some((l) => l.includes("⏎"))).toBe(true);
  });

  test("test_esc_restores_prior_cursor_when_recorded_value_not_an_option", () => {
    const state = seedRippleChain();
    const { panel } = makePanel(state);
    // Recorded answer whose value matches NO option (agent upsert origin).
    state.applyAnswer("q1", { value: "zzz", at: T0 });
    triggerChoiceConfirm(panel);
    panel.handleInput("\u001b");
    expect(panel.confirmMode).toBeNull();
    // Not findable → the stashed priorCursorIndex (the proposal index) wins.
    expect(panel.cursorIndex).toBe(1);
  });

  test("test_enter_applies_and_victims_go_moot_with_reasons_instantly", () => {
    const state = seedRippleChain();
    const { panel } = makePanel(state);
    triggerChoiceConfirm(panel);

    expect(panel.handleInput("\r")).toBe(true); // keep
    expect(panel.confirmMode).toBeNull();

    // The deferred commit ran exactly as acceptOptionIndex would have.
    const q1 = state.getQuestion("q1");
    expect(q1?.answer?.value).toBe("b");
    expect(q1?.status).toBe("answered");
    // FR-17/AC-6: evaluateDependsOn ran immediately after applyAnswer —
    // both victims flipped moot in the SAME synchronous pass.
    expect(state.getQuestion("q2")?.status).toBe("moot");
    expect(state.getQuestion("q3")?.status).toBe("moot");
    // h2.29 reasons: the unmet conjunct re-derives with the recorded format.
    expect(dependencyMet(state, state.getQuestion("q2")!)).toEqual({
      met: false,
      reason: "moot: q1=b",
    });
    // Standard accept-advance: q4 is the only remaining open question.
    expect(panel.currentId).toBe("q4");
  });

  test("test_enter_applies_exactly_once_no_seam_reinvocation", () => {
    // The deferred commit must never re-invoke the seam (infinite-loop
    // anti-pattern): after keep, a SECOND enter is a normal stage-flow
    // keypress, not another confirm decision.
    const state = seedRippleChain();
    const { panel } = makePanel(state);
    triggerChoiceConfirm(panel);
    panel.handleInput("\r"); // keep → applied, advanced to q4
    const second = panel.handleInput("\r"); // normal accept on q4 (open)
    expect(second).toBe(true);
    expect(state.getQuestion("q4")?.status).toBe("answered"); // plain accept
    expect(state.getQuestion("q4")?.answer?.value).toBe("a");
    expect(panel.confirmMode).toBeNull();
  });

  test("test_zero_victims_applies_directly_no_confirm", () => {
    // Ripple exists but every victim is OPEN → filter empties → direct
    // apply, no confirm mode. FR-17 still runs on the direct path (the
    // P1.M5.T4.S1 actions change), so open dependents silently go moot.
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    state.upsertQuestion(choiceQ("q2", { dependsOn: [{ id: "q1", equals: "a" }] }));
    state.upsertQuestion(choiceQ("q3", { dependsOn: [{ id: "q2", equals: "a" }] }));
    state.applyAnswer("q1", { value: "a", at: T0 });
    const { panel } = makePanel(state);
    panel.currentId = "q1";
    panel.cursorIndex = 1;
    panel.handleInput("\r");
    expect(panel.confirmMode).toBeNull();
    expect(state.getQuestion("q1")?.answer?.value).toBe("b");
    expect(state.getQuestion("q2")?.status).toBe("moot");
    expect(state.getQuestion("q3")?.status).toBe("moot");
    expect(panel.currentId).toBe("q1"); // nothing unanswered left → stays
  });

  test("test_zero_victims_when_ripple_hits_only_moot_questions", () => {
    const state = seedRippleChain();
    state.setStatus("q2", "moot");
    state.setStatus("q3", "moot");
    const { panel } = makePanel(state);
    panel.currentId = "q1";
    panel.cursorIndex = 1;
    panel.handleInput("\r");
    expect(panel.confirmMode).toBeNull(); // moot ids are not victims
    expect(state.getQuestion("q1")?.answer?.value).toBe("b");
  });

  test("test_open_or_reasked_edit_never_confirms", () => {
    // OPEN current question: the accept path never even calls the seam.
    const open = createInterrogationState("goal");
    open.upsertQuestion(choiceQ("q1"));
    open.upsertQuestion(choiceQ("q2", { dependsOn: [{ id: "q1", equals: "a" }] }));
    const openHandle = makePanel(open);
    openHandle.panel.currentId = "q1";
    openHandle.panel.cursorIndex = 1;
    openHandle.panel.handleInput("\r");
    expect(openHandle.panel.confirmMode).toBeNull();
    expect(open.getQuestion("q1")?.status).toBe("answered");

    // REASKED: same status gate — no confirm, direct apply.
    const reasked = createInterrogationState("goal");
    reasked.upsertQuestion(choiceQ("q1"));
    reasked.setStatus("q1", "reasked");
    reasked.upsertQuestion(choiceQ("q2", { dependsOn: [{ id: "q1", equals: "a" }] }));
    reasked.applyAnswer("q2", { value: "a", at: T0 });
    const reaskedHandle = makePanel(reasked);
    reaskedHandle.panel.currentId = "q1";
    reaskedHandle.panel.cursorIndex = 1;
    reaskedHandle.panel.handleInput("\r");
    expect(reaskedHandle.panel.confirmMode).toBeNull();
    expect(reasked.getQuestion("q1")?.answer?.value).toBe("b");
  });

  test("test_confirm_mode_modal_only_enter_esc_act", () => {
    const state = seedRippleChain();
    const { panel } = makePanel(state); // REAL router — the modal must beat it
    triggerChoiceConfirm(panel);
    const serialized = JSON.stringify(state.serialize());
    const cursor = panel.cursorIndex;
    const id = panel.currentId;

    // Arrows, digits, ctrl+s (submit), typing, tab, shift+enter: consumed
    // no-ops — the modal returns BEFORE the gate-warning dismissal, the
    // disarm check, the armed stage-2, and the keys seam. A digit must NOT
    // quick-select and tab must NOT navigate while the modal is open.
    for (const data of ["\x1b[A", "\x1b[B", "2", "x", "\x13", "\t", "\x1b[13;2u", "\n"]) {
      expect(panel.handleInput(data)).toBe(true);
      expect(panel.confirmMode).not.toBeNull();
      expect(JSON.stringify(state.serialize())).toBe(serialized);
      expect(panel.cursorIndex).toBe(cursor);
      expect(panel.currentId).toBe(id);
    }

    // Then esc still cancels cleanly.
    expect(panel.handleInput("\u001b")).toBe(true);
    expect(panel.confirmMode).toBeNull();
    expect(JSON.stringify(state.serialize())).toBe(serialized);
  });

  test("test_digit_quick_select_on_answered_uses_same_gate", () => {
    const state = seedRippleChain();
    const { panel } = makePanel(state);
    panel.currentId = "q1";
    panel.handleInput("2"); // digit quick-select → option index 1 ("b")
    expect(panel.confirmMode).not.toBeNull();
    expect(panel.confirmMode?.proposed?.value).toBe("b");
    expect(panel.confirmMode?.victims).toEqual(["q2", "q3"]);
    expect(state.getQuestion("q1")?.answer?.value).toBe("a"); // deferred
    panel.handleInput("\r"); // keep
    expect(state.getQuestion("q1")?.answer?.value).toBe("b");
  });

  test("test_flash_and_gate_warning_suppressed_during_confirm_mode", () => {
    const state = seedRippleChain();
    const { panel } = makePanel(state);
    panel.flash("nothing to submit"); // live flash
    panel.gateWarning = { count: 3 }; // live soft-gate warning
    triggerChoiceConfirm(panel);
    const lines = panel.render(120);
    expect(lines.some((l) => l.includes("nothing to submit"))).toBe(false);
    expect(lines.some((l) => l.includes("foundational"))).toBe(false);
    expect(lines.some((l) => l.includes("⚠ Invalidates"))).toBe(true);
  });
});

describe("ripple confirm — text stage-1 gate", () => {
  function triggerTextConfirm(handle: Handle): void {
    handle.panel.currentId = "t1";
    handle.panel.focusTextField(); // seeds "" (no draft slots yet)
    handle.panel.handleInput("new text");
    handle.panel.handleInput("\r"); // stage-1 enter → gate
  }

  test("test_text_stage1_gate_defers_save", () => {
    const state = seedTextChain();
    const handle = makePanel(state);
    triggerTextConfirm(handle);
    expect(handle.panel.confirmMode?.kind).toBe("text");
    expect(handle.panel.confirmMode?.text).toBe("new text");
    expect(handle.panel.confirmMode?.victims).toEqual(["c2"]);
    // NOTHING written: no slot setDraft, no blur (the save is deferred
    // until the user decides).
    expect(handle.drafts.setDraft).not.toHaveBeenCalled();
    expect(handle.panel.focus).toBe("text");
    expect(state.getQuestion("t1")?.answer?.value).toBe("recorded text"); // untouched
  });

  test("test_text_stage1_gate_esc_restores_recorded_answer_text_keeps_focus", () => {
    const state = seedTextChain();
    const handle = makePanel(state);
    triggerTextConfirm(handle);
    expect(handle.panel.handleInput("\u001b")).toBe(true);
    expect(handle.panel.confirmMode).toBeNull();
    // Editor re-seeded to the RECORDED answer's text; text focus KEPT.
    expect(handle.panel.textField.getText()).toBe("recorded text");
    expect(handle.panel.focus).toBe("text");
    expect(handle.panel.textField.focused).toBe(true);
    expect(handle.drafts.setDraft).not.toHaveBeenCalled(); // no draft write
    expect(state.getQuestion("t1")?.answer?.value).toBe("recorded text");
  });

  test("test_text_stage1_gate_enter_completes_deferred_save", () => {
    const state = seedTextChain();
    const handle = makePanel(state);
    triggerTextConfirm(handle);
    expect(handle.panel.handleInput("\r")).toBe(true); // keep
    expect(handle.panel.confirmMode).toBeNull();
    // The deferred save ran: one setDraft of the STASHED text, blur —
    // never an applyAnswer.
    expect(handle.drafts.setDraft).toHaveBeenCalledTimes(1);
    expect(handle.drafts.setDraft).toHaveBeenCalledWith("t1", "new text");
    expect(handle.panel.focus).toBe("options");
    expect(handle.panel.textField.focused).toBe(false);
    expect(state.getQuestion("t1")?.answer?.value).toBe("recorded text"); // save ≠ apply
    // No advance side effect: a text save never moves the question
    // (P1.M2.T4.S1 removed the armed stage-2 enter).
    expect(handle.panel.currentId).toBe("t1");
  });

  test("test_editor_exit_gate_defers_save_and_completes_on_confirm_enter", () => {
    // ESC-002: the editor-exit gestures (ctrl+t toggle / double-esc) run
    // the SAME FR-18 text gate — a back-out's deferred commit saves +
    // blurs like any text save (P1.M2.T4.S1 removed the arm differentiator).
    const state = seedTextChain();
    const handle = makePanel(state);
    handle.panel.currentId = "t1";
    handle.panel.focusTextField();
    handle.panel.handleInput("new text");

    // Double-esc exit: first esc forwards to the editor, second exits — but
    // the ripple gate defers the write into the modal (victims: ["c2"]).
    expect(handle.panel.handleInput("\u001b")).toBe(true);
    expect(handle.panel.focus).toBe("text"); // still editing after one esc
    expect(handle.panel.handleInput("\u001b")).toBe(true);
    expect(handle.panel.confirmMode?.kind).toBe("text");
    expect(handle.drafts.setDraft).not.toHaveBeenCalled(); // nothing written yet

    // Confirm-enter keeps: deferred save runs, blur.
    expect(handle.panel.handleInput("\r")).toBe(true);
    expect(handle.panel.confirmMode).toBeNull();
    expect(handle.drafts.setDraft).toHaveBeenCalledWith("t1", "new text");
    expect(handle.panel.focus).toBe("options");
    expect(state.getQuestion("t1")?.answer?.value).toBe("recorded text"); // save ≠ apply
  });
});

describe("ripple confirm — footer + seams", () => {
  test("test_confirm_footer_exact_copy_and_width_truncation", () => {
    // Pure renderer: exact copy at roomy width.
    expect(renderConfirmFooter(["q2", "q3"], stubTheme, 80)).toBe(
      "  ⚠ Invalidates 2 answered questions (q2, q3) — enter=keep, esc=cancel",
    );
    // Through the panel render: replaced footer is ONE width-bounded line
    // at every tested width (1-line guarantee, single ⚠ line).
    const state = seedRippleChain();
    const { panel } = makePanel(state);
    triggerChoiceConfirm(panel);
    for (const width of [40, 60, 80, 120]) {
      const lines = panel.render(width);
      const confirm = lines.filter((l) => l.includes("⚠ Invalidates"));
      expect(confirm).toHaveLength(1);
      expect(confirm[0]?.includes("\n")).toBe(false); // never wraps
      expect(visibleWidth(confirm[0]!)).toBeLessThanOrEqual(width);
      expect(lines.some((l) => l.includes("⏎"))).toBe(false); // no double footer
      // Narrow widths must truncate (with the ellipsis); roomy widths fit whole.
      if (width < 80) expect(confirm[0]).toContain("…");
      else expect(confirm[0]).not.toContain("…");
    }
  });

  test("test_deep_view_accept_defers_then_applies_in_place", () => {
    const state = seedRippleChain();
    const { panel } = makePanel(state);
    panel.currentId = "q1";
    panel.setView("deep"); // deep cursor seeds to the recommendation (0)
    panel.cursorIndex = 1; // propose "b" (deep domain excludes the ✎ index)
    expect(panel.handleInput("\r")).toBe(true); // acceptFromDeep → seam veto
    expect(panel.confirmMode).not.toBeNull();
    expect(panel.view).toBe("deep"); // veto branch: user stays in deep view
    expect(state.getQuestion("q1")?.answer?.value).toBe("a"); // nothing applied
    expect(panel.handleInput("\r")).toBe(true); // confirm-enter → keep
    expect(panel.confirmMode).toBeNull();
    expect(state.getQuestion("q1")?.answer?.value).toBe("b");
    expect(state.getQuestion("q2")?.status).toBe("moot");
    // Documented v1: the deferred apply happens IN PLACE — view stays deep;
    // the accept-advance still moves currentId.
    expect(panel.view).toBe("deep");
    expect(panel.currentId).toBe("q4");
  });

  test("test_confirm_ripple_override_still_wins", () => {
    const state = seedRippleChain();
    const veto = vi.fn(() => false);
    const { panel } = makePanel(state, { confirmRipple: veto });
    panel.currentId = "q1";
    panel.cursorIndex = 1;
    panel.handleInput("\r");
    expect(veto).toHaveBeenCalledTimes(1);
    expect(veto).toHaveBeenCalledWith(panel, "q1", expect.objectContaining({ value: "b" }));
    expect(panel.confirmMode).toBeNull(); // the override owns the decision
    expect(state.getQuestion("q1")?.answer?.value).toBe("a"); // vetoed, no modal

    // A true-returning override applies directly, still with no modal.
    const always = vi.fn(() => true);
    const second = makePanel(state, { confirmRipple: always });
    second.panel.currentId = "q1";
    second.panel.cursorIndex = 1;
    second.panel.handleInput("\r");
    expect(always).toHaveBeenCalledTimes(1);
    expect(second.panel.confirmMode).toBeNull();
    expect(state.getQuestion("q1")?.answer?.value).toBe("b");
  });
});

// --------------------------------------------------------- write-in gate

/**
 * Drive the panel into write-in duty on the CURRENT question (Other row =
 * cursor index options.length; the Other-row accept bypasses the choice
 * ripple seam — entering duty commits nothing) and stage `text` in the
 * editor. The next enter reaches writeInEnter, i.e. the write-in commit
 * gate under test.
 */
function enterWriteInDuty(handle: Handle, text: string): void {
  const { panel, editor } = handle;
  panel.currentId = "q1";
  panel.cursorIndex = 2; // past the 2 options = the ✎ Other row
  panel.handleInput("\r"); // → writein duty, text focus
  editor.setText(text);
}

describe("ripple confirm — write-in commit gate (h2.35, P1.M2.T2.S2)", () => {
  test("test_wi_commit_on_answered_with_victims_defers_into_modal", () => {
    const state = seedRippleChain();
    const handle = makePanel(state);
    enterWriteInDuty(handle, "cockroachdb");

    expect(handle.panel.handleInput("\r")).toBe(true); // write-in enter → GATE

    // Modal stashed with the buffer + FULL victim closure (BFS order).
    expect(handle.panel.confirmMode?.kind).toBe("writein");
    expect(handle.panel.confirmMode?.questionId).toBe("q1");
    expect(handle.panel.confirmMode?.text).toBe("cockroachdb");
    expect(handle.panel.confirmMode?.victims).toEqual(["q2", "q3"]);
    expect(handle.panel.confirmMode?.priorCursorIndex).toBe(2);

    // NOTHING applied, NOTHING blurred: answer untouched (still the option
    // value, no custom marker), statuses/currentId/duty/focus unchanged.
    expect(state.getQuestion("q1")?.answer?.value).toBe("a");
    expect(state.getQuestion("q1")?.answer?.custom).toBeUndefined();
    expect(state.getQuestion("q1")?.status).toBe("answered");
    expect(state.getQuestion("q2")?.status).toBe("answered");
    expect(state.getQuestion("q3")?.status).toBe("submitted");
    expect(handle.panel.currentId).toBe("q1");
    expect(handle.panel.focus).toBe("text"); // editor stays focused behind the modal
    expect(handle.panel.textDuty).toBe("writein");
    expect(handle.drafts.setDraft).not.toHaveBeenCalled(); // no draft write either

    // Footer REPLACED with the verbatim modal line (byte-exact: em-dash
    // U+2014, comma+space id list — victims-only renderer, kind-agnostic).
    const lines = handle.panel.render(120);
    const confirm = lines.filter((l) => l.includes("⚠ Invalidates"));
    expect(confirm).toHaveLength(1);
    expect(confirm[0]?.trim()).toBe(
      "⚠ Invalidates 2 answered questions (q2, q3) — enter=keep, esc=cancel",
    );
  });

  test("test_wi_confirm_enter_applies_custom_moots_victims_advances_blurs", () => {
    const state = seedRippleChain();
    const handle = makePanel(state);
    enterWriteInDuty(handle, "cockroachdb");
    handle.panel.handleInput("\r"); // → modal

    expect(handle.panel.handleInput("\r")).toBe(true); // modal enter = keep

    expect(handle.panel.confirmMode).toBeNull();
    const q1 = state.getQuestion("q1");
    expect(q1?.answer).toEqual({ value: "cockroachdb", custom: true, at: expect.any(String) });
    expect(new Date(q1?.answer?.at ?? "").toISOString()).toBe(q1?.answer?.at); // ISO
    expect(q1?.status).toBe("answered");
    // FR-17/AC-6: victims moot instantly.
    expect(state.getQuestion("q2")?.status).toBe("moot");
    expect(state.getQuestion("q3")?.status).toBe("moot");
    // Accept-advance past the fresh moots to the open target, THEN blur.
    expect(handle.panel.currentId).toBe("q4");
    expect(handle.panel.focus).toBe("options");
    expect(handle.panel.textDuty).toBe("elaboration"); // blurTextField reset the duty
  });

  test("test_wi_confirm_esc_reverts_zero_state_change_prior_option_answer", () => {
    const state = seedRippleChain();
    const handle = makePanel(state);
    enterWriteInDuty(handle, "cockroachdb");
    handle.panel.handleInput("\r"); // → modal

    // Capture EVERYTHING the AC-7 zero-state-change contract protects.
    const serialized = JSON.stringify(state.serialize());
    const answerRefs = ["q1", "q2", "q3", "q4"].map((id) => state.getQuestion(id)?.answer);
    const snapshots = state.snapshots.length;
    const epoch = state.epoch;

    expect(handle.panel.handleInput("\u001b")).toBe(true); // modal esc = cancel

    expect(handle.panel.confirmMode).toBeNull();
    expect(JSON.stringify(state.serialize())).toBe(serialized); // byte-identical
    expect(state.getQuestion("q1")?.answer).toBe(answerRefs[0]); // same object refs
    expect(state.getQuestion("q2")?.answer).toBe(answerRefs[1]);
    expect(state.getQuestion("q3")?.answer).toBe(answerRefs[2]);
    expect(state.snapshots.length).toBe(snapshots);
    expect(state.epoch).toBe(epoch);
    expect(handle.drafts.setDraft).not.toHaveBeenCalled(); // no draft write
    // Prior OPTION answer (no custom, no elaboration text) → seed "" — and
    // the user STAYS in the write-in editor they were typing in.
    expect(handle.panel.textField.getText()).toBe("");
    expect(handle.panel.focus).toBe("text");
    expect(handle.panel.textDuty).toBe("writein");
    expect(handle.panel.currentId).toBe("q1"); // still on the question (AC-7)
  });

  test("test_wi_confirm_esc_reseeds_prior_custom_writein_from_answer_value", () => {
    const state = seedRippleChain();
    state.applyAnswer("q1", { value: "prior writein", custom: true, at: T0 });
    const handle = makePanel(state);
    enterWriteInDuty(handle, "cockroachdb");
    handle.panel.handleInput("\r"); // → modal

    handle.panel.handleInput("\u001b"); // esc

    // Prior CUSTOM write-in → re-seed from answer.value (not answer.text).
    expect(handle.panel.textField.getText()).toBe("prior writein");
    expect(state.getQuestion("q1")?.answer?.value).toBe("prior writein"); // untouched
    expect(handle.panel.focus).toBe("text");
    expect(handle.panel.textDuty).toBe("writein");
  });

  test("test_wi_commit_zero_victims_applies_directly_no_modal", () => {
    // q1 answered, its only dependent still open → ripple has no victims.
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    state.upsertQuestion(choiceQ("q2", { dependsOn: [{ id: "q1", equals: "a" }] }));
    state.applyAnswer("q1", { value: "a", at: T0 });
    const handle = makePanel(state);
    enterWriteInDuty(handle, "cockroachdb");

    expect(handle.panel.handleInput("\r")).toBe(true);

    // Direct commit — S1 behavior byte-identical, no modal, no deferral.
    expect(handle.panel.confirmMode).toBeNull();
    expect(state.getQuestion("q1")?.answer?.value).toBe("cockroachdb");
    expect(state.getQuestion("q1")?.answer?.custom).toBe(true);
    expect(handle.panel.focus).toBe("options");
    expect(handle.panel.textDuty).toBe("elaboration");
  });

  test("test_wi_commit_open_question_applies_directly_even_with_victims", () => {
    // q1 OPEN with an ANSWERED dependent (a real victim set) — the gate is
    // status-gated on the EDITED question: no edit of an existing answer,
    // nothing to confirm.
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    state.upsertQuestion(choiceQ("q2", { dependsOn: [{ id: "q1", equals: "a" }] }));
    state.applyAnswer("q2", { value: "a", at: T0 });
    const handle = makePanel(state);
    enterWriteInDuty(handle, "cockroachdb");

    expect(handle.panel.handleInput("\r")).toBe(true);

    expect(handle.panel.confirmMode).toBeNull();
    expect(state.getQuestion("q1")?.answer?.value).toBe("cockroachdb");
    expect(state.getQuestion("q1")?.answer?.custom).toBe(true);
  });

  test("test_wi_commit_submitted_question_gates_same_as_answered", () => {
    const state = seedRippleChain();
    state.setStatus("q1", "submitted"); // h2.35: answered OR submitted
    const handle = makePanel(state);
    enterWriteInDuty(handle, "cockroachdb");

    expect(handle.panel.handleInput("\r")).toBe(true);

    expect(handle.panel.confirmMode?.kind).toBe("writein");
    expect(handle.panel.confirmMode?.victims).toEqual(["q2", "q3"]);
    expect(state.getQuestion("q1")?.answer?.custom).toBeUndefined(); // deferred
  });
});

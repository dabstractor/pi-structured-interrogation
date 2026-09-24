/**
 * src/panel/actions.test.ts — named panel action tests (P1.M3.T2.S2).
 *
 * Conventions follow panel.test.ts / debug-commands.test.ts: a bare stub
 * theme + TUI, real InterrogationStates seeded through the raw primitives
 * (upsertQuestion forces new ids to status "open", so non-open statuses are
 * applied AFTER the upsert via applyAnswer/setStatus), and the submit path
 * asserted through the snapshot ring + epoch + a mocked sendMessage —
 * exactly the debug-commands.test.ts precedent (AUTOMATION-POLICY: no live
 * pi session).
 *
 * Panels are constructed directly (not via openPanel) so each scenario owns
 * its instance; dispose() is called where flash timers are armed.
 */
import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import { DEFAULT_CONFIG, type InterrogatorConfig } from "../config.js";
import { renderDutyLabel } from "./layout.js";
import {
  createInterrogationState,
  type InterrogationState,
  type Question,
} from "../state.js";
import {
  accept,
  cursorDomainSize,
  digit,
  maybeAutoSubmit,
  nextUnanswered,
  nextQuestion,
  optionDown,
  optionUp,
  panelActions,
  prevQuestion,
  submit,
  type SubmitDeps,
} from "./actions.js";
import { InterrogationPanel, type InterrogationPanelArgs } from "./panel.js";
import { DraftStore } from "../draft-store.js";

// ------------------------------------------------------------------ fixtures

const T0 = "2025-01-01T00:00:00.000Z";

/** Identity theme so renderers run in tests (stub per panel.test.ts). */
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

/**
 * Seed a state from specs. upsertQuestion forces NEW ids to status "open"
 * (state.ts raw primitive contract), so answer/status is applied after the
 * upsert: an `answerValue` routes through applyAnswer (status → answered),
 * any other non-open status through setStatus.
 */
function seed(specs: Array<{ id: string; overrides?: Partial<Question> }>): InterrogationState {
  const state = createInterrogationState("goal");
  for (const { id, overrides = {} } of specs) {
    state.upsertQuestion(choiceQ(id, overrides));
    const status = overrides.status ?? "open";
    if (status === "answered") {
      state.applyAnswer(id, { value: overrides.answer?.value ?? "a", at: T0 });
    } else if (status !== "open") {
      state.setStatus(id, status);
    }
  }
  return state;
}

/** Typed ripple-seam mock so call args are fully checked. */
function seamMock(result: boolean): Mock {
  return vi.fn(
    (_panel: unknown, _questionId: string, _proposed: { value: string; at: string }) => result,
  );
}

interface PanelHandle {
  panel: InterrogationPanel;
  requestRender: Mock;
}

function makePanel(
  state: InterrogationState,
  extra: Partial<InterrogationPanelArgs> = {},
  config: InterrogatorConfig = DEFAULT_CONFIG,
): PanelHandle {
  const requestRender = vi.fn();
  const panel = new InterrogationPanel({
    tui: { requestRender } as unknown as TUI,
    theme: stubTheme,
    done: () => {},
    state,
    config,
    ...extra,
  });
  return { panel, requestRender };
}

function makeDeps(isIdle = true): { deps: SubmitDeps; sendMessage: Mock } {
  const sendMessage = vi.fn();
  return { deps: { sendMessage, isIdle: () => isIdle }, sendMessage };
}

/** Q1 open with recommendation "a" → initialCursorIndex preselects option 0. */
const BASIC: Array<{ id: string; overrides?: Partial<Question> }> = [
  { id: "q1", overrides: { recommendation: "a" } },
  { id: "q2" },
];

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ------------------------------------------------------------ advance core

describe("nextUnanswered — advance algorithm", () => {
  test("test_nextUnanswered_scans_forward_then_wraps", () => {
    const ordered = [
      { id: "q1", status: "answered" },
      { id: "q2", status: "answered" },
      { id: "q3", status: "open" },
      { id: "q4", status: "answered" },
    ];
    expect(nextUnanswered(ordered, 2)).toBe("q3"); // immediate successor
    expect(nextUnanswered(ordered, 3)).toBe("q3"); // wraps past the end
    expect(nextUnanswered(ordered, 0)).toBe("q3");
  });

  test("test_nextUnanswered_skips_moot_withdrawn_closed_and_reasked_counts", () => {
    const ordered = [
      { id: "q1", status: "open" },
      { id: "q2", status: "moot" },
      { id: "q3", status: "withdrawn" },
      { id: "q4", status: "closed" },
      { id: "q5", status: "reasked" },
    ];
    expect(nextUnanswered(ordered, 0)).toBe("q5");
    expect(nextUnanswered(ordered, 4)).toBe("q1"); // wrap: reasked IS unanswered
  });

  test("test_nextUnanswered_returns_undefined_when_none_remain", () => {
    const ordered = [
      { id: "q1", status: "answered" },
      { id: "q2", status: "moot" },
      { id: "q3", status: "withdrawn" },
      { id: "q4", status: "closed" },
      { id: "q5", status: "submitted" },
    ];
    expect(nextUnanswered(ordered, 0)).toBeUndefined();
    expect(nextUnanswered([], 0)).toBeUndefined();
  });
});

describe("cursorDomainSize — S1 domain contract", () => {
  test("test_cursorDomainSize_choice_includes_explain_affordance", () => {
    expect(cursorDomainSize(choiceQ("q", { options: OPTS_AB }))).toBe(3); // 2 options + ✎
    expect(cursorDomainSize(choiceQ("q", { options: undefined }))).toBe(1); // ✎ only
    expect(cursorDomainSize(choiceQ("q", { type: "text", options: undefined }))).toBe(1);
  });
});

// ---------------------------------------------------------------- actions

describe("optionUp / optionDown — cursor movement", () => {
  test("test_optionDown_moves_and_clamps_at_domain_top", () => {
    const { panel } = makePanel(seed(BASIC));
    expect(panel.cursorIndex).toBe(0); // ★ preselect on "a"
    expect(optionDown(panel)).toBe(true);
    expect(panel.cursorIndex).toBe(1);
    expect(optionDown(panel)).toBe(true);
    expect(panel.cursorIndex).toBe(2); // ✎ affordance = last index
    expect(optionDown(panel)).toBe(true);
    expect(panel.cursorIndex).toBe(2); // clamped, no wrap
  });

  test("test_optionUp_moves_and_clamps_at_zero", () => {
    const { panel } = makePanel(seed(BASIC));
    panel.cursorIndex = 1;
    expect(optionUp(panel)).toBe(true);
    expect(panel.cursorIndex).toBe(0);
    expect(optionUp(panel)).toBe(true);
    expect(panel.cursorIndex).toBe(0); // clamped
  });

  test("test_option_movement_invalidates_the_render_cache", () => {
    const { panel, requestRender } = makePanel(seed(BASIC));
    optionDown(panel);
    expect(requestRender).toHaveBeenCalled();
  });

  test("test_option_movement_on_text_question_domain_is_single_index", () => {
    const { panel } = makePanel(seed([{ id: "t1", overrides: { type: "text", options: undefined } }]));
    expect(optionDown(panel)).toBe(true);
    expect(panel.cursorIndex).toBe(0); // clamped at {0}
    expect(optionUp(panel)).toBe(true);
    expect(panel.cursorIndex).toBe(0);
  });

  test("test_option_movement_without_question_context_returns_false", () => {
    const { panel } = makePanel(createInterrogationState("goal"));
    panel.currentId = undefined;
    expect(optionUp(panel)).toBe(false);
    expect(optionDown(panel)).toBe(false);
  });
});

describe("accept — commit + advance (Q14=A)", () => {
  test("test_a_accept_commits_applyAnswer_and_advances_to_next_open", () => {
    const state = seed(BASIC);
    const { panel } = makePanel(state);
    expect(panel.currentId).toBe("q1"); // first open question
    expect(accept(panel)).toBe(true);
    const q1 = state.getQuestion("q1");
    expect(q1?.status).toBe("answered"); // the pending state (h2.38)
    expect(q1?.answer?.value).toBe("a");
    expect(panel.currentId).toBe("q2"); // advanced to the next open question
    expect(panel.cursorIndex).toBe(0); // cursor reset to ★ preselect
  });

  test("test_b_accept_wraps_to_first_open_at_top", () => {
    const state = seed(BASIC);
    const { panel } = makePanel(state);
    panel.currentId = "q2"; // last unanswered
    expect(accept(panel)).toBe(true);
    expect(state.getQuestion("q2")?.status).toBe("answered");
    expect(panel.currentId).toBe("q1"); // wrapped to the open question at top
  });

  test("test_c_accept_on_last_unanswered_stays_put", () => {
    const state = seed([{ id: "q1", overrides: { status: "answered" } }, { id: "q2" }]);
    const { panel } = makePanel(state);
    panel.currentId = "q2";
    expect(accept(panel)).toBe(true);
    expect(state.getQuestion("q2")?.status).toBe("answered");
    expect(panel.currentId).toBe("q2"); // everything answered → stay
  });

  test("test_f_accept_on_explain_affordance_sets_text_focus_no_answer", () => {
    const state = seed([{ id: "q1" }]);
    const { panel } = makePanel(state);
    panel.cursorIndex = 2; // ✎ explain affordance (options.length)
    expect(accept(panel)).toBe(true);
    expect(panel.focus).toBe("text");
    expect(state.getQuestion("q1")?.status).toBe("open"); // no answer applied
    expect(state.getQuestion("q1")?.answer).toBeUndefined();
  });

  test("test_accept_on_text_question_is_noop_seam_for_m4", () => {
    const state = seed([{ id: "t1", overrides: { type: "text", options: undefined } }]);
    const { panel } = makePanel(state);
    expect(accept(panel)).toBe(true);
    expect(state.getQuestion("t1")?.status).toBe("open");
  });

  test("test_h_accept_on_moot_and_withdrawn_is_noop", () => {
    const state = seed([
      { id: "q1" },
      { id: "q4", overrides: { status: "moot" } },
      { id: "q5", overrides: { status: "withdrawn" } },
    ]);
    const { panel } = makePanel(state);
    for (const id of ["q4", "q5"]) {
      panel.currentId = id;
      expect(accept(panel)).toBe(true); // consumed (context exists)
      expect(state.getQuestion(id)?.answer).toBeUndefined(); // nothing applied
      expect(panel.currentId).toBe(id); // no advance
      expect(state.getQuestion(id)?.status).not.toBe("answered");
    }
  });

  test("test_accept_without_question_context_returns_false", () => {
    const { panel } = makePanel(createInterrogationState("goal"));
    panel.currentId = undefined;
    expect(accept(panel)).toBe(false);
  });
});

describe("accept on answered — ripple-confirm seam (AC-13)", () => {
  test("test_g_seam_invoked_with_proposed_answer_then_remarks_answered", () => {
    const state = seed([{ id: "q1", overrides: { status: "answered" } }, { id: "q2" }]);
    const confirmRipple = seamMock(true);
    const { panel } = makePanel(state, { confirmRipple });
    panel.currentId = "q1";
    panel.cursorIndex = 1; // option "b" — a DIFFERENT value than the stored answer
    expect(accept(panel)).toBe(true);
    expect(confirmRipple).toHaveBeenCalledTimes(1);
    const [p, id, proposed] = confirmRipple.mock.calls[0];
    expect(p).toBe(panel);
    expect(id).toBe("q1");
    expect(proposed.value).toBe("b");
    expect(new Date(proposed.at).getTime()).not.toBeNaN(); // ISO timestamp
    // AC-13: the edit re-marks answered (pending) with the new value…
    const q1 = state.getQuestion("q1");
    expect(q1?.status).toBe("answered");
    expect(q1?.answer?.value).toBe("b");
    // …and the flow advanced (default seam semantics = apply + advance).
    expect(panel.currentId).toBe("q2");
  });

  test("test_g_default_seam_remarks_answered_pending_and_advances", () => {
    const state = seed([{ id: "q1", overrides: { status: "answered" } }, { id: "q2" }]);
    const { panel } = makePanel(state); // NO confirmRipple override → no-op () => true
    panel.currentId = "q1";
    panel.cursorIndex = 1;
    expect(accept(panel)).toBe(true);
    expect(state.getQuestion("q1")?.answer?.value).toBe("b");
    expect(state.getQuestion("q1")?.status).toBe("answered");
    expect(panel.currentId).toBe("q2");
  });

  test("test_g_seam_veto_skips_applyAnswer_and_advance", () => {
    const state = seed([{ id: "q1", overrides: { status: "answered" } }, { id: "q2" }]);
    const confirmRipple = seamMock(false);
    const { panel } = makePanel(state, { confirmRipple });
    panel.currentId = "q1";
    panel.cursorIndex = 1;
    expect(accept(panel)).toBe(true); // key consumed, but…
    expect(state.getQuestion("q1")?.answer?.value).toBe("a"); // …answer untouched
    expect(panel.currentId).toBe("q1"); // …no advance
  });

  test("test_g_seam_also_guards_submitted_questions", () => {
    const state = seed([{ id: "q1", overrides: { status: "submitted" } }, { id: "q2" }]);
    const confirmRipple = seamMock(true);
    const { panel } = makePanel(state, { confirmRipple });
    panel.currentId = "q1";
    accept(panel);
    expect(confirmRipple).toHaveBeenCalledTimes(1);
  });
});

describe("digit — quick-select (R5)", () => {
  test("test_e_digit_accepts_option_and_advances_like_accept", () => {
    const state = seed(BASIC);
    const { panel } = makePanel(state);
    expect(digit(panel, 2)).toBe(true);
    expect(state.getQuestion("q1")?.answer?.value).toBe("b");
    expect(state.getQuestion("q1")?.status).toBe("answered");
    expect(panel.currentId).toBe("q2");
  });

  test("test_e_digit_beyond_option_count_is_noop_false", () => {
    const state = seed([{ id: "q1" }]); // 2 options
    const { panel } = makePanel(state);
    expect(digit(panel, 3)).toBe(false); // ✎ affordance is not digit-selectable
    expect(digit(panel, 9)).toBe(false);
    expect(state.getQuestion("q1")?.answer).toBeUndefined();
    expect(digit(panel, 0)).toBe(false);
    expect(digit(panel, 1.5)).toBe(false);
  });

  test("test_digit_never_selects_the_other_row_no_state_change_fr_d1", () => {
    // WRITEIN-001 / FR-D1 explicit exclusion: the ✎ Other — write your own
    // row (cursor index options.length) is NOT digit-selectable — digit n
    // with n-1 === options.length is a no-op that mutates NOTHING.
    const state = seed([{ id: "q1" }]); // 2 options → Other row at index 2, digit 3
    const { panel } = makePanel(state);
    panel.currentId = "q1";
    const before = state.serialize();

    expect(digit(panel, 3)).toBe(false); // one past the 2 real options = the Other row
    expect(digit(panel, 9)).toBe(false);
    expect(state.serialize()).toEqual(before); // NO answer applied, no status change
    expect(state.getQuestion("q1")?.answer).toBeUndefined(); // nothing answered via digits
    expect(panel.currentId).toBe("q1"); // no advance either
  });

  test("test_e_digit_disabled_falls_through_false", () => {
    const state = seed(BASIC);
    const config = { ...DEFAULT_CONFIG, digitQuickSelect: false };
    const { panel } = makePanel(state, {}, config);
    expect(digit(panel, 1)).toBe(false);
    expect(state.getQuestion("q1")?.answer).toBeUndefined();
  });

  test("test_e_digit_on_text_question_is_false", () => {
    const state = seed([{ id: "t1", overrides: { type: "text", options: undefined } }]);
    const { panel } = makePanel(state);
    expect(digit(panel, 1)).toBe(false);
  });

  test("test_digit_on_answered_routes_through_the_ripple_seam", () => {
    const state = seed([{ id: "q1", overrides: { status: "answered" } }, { id: "q2" }]);
    const confirmRipple = seamMock(true);
    const { panel } = makePanel(state, { confirmRipple });
    panel.currentId = "q1";
    expect(digit(panel, 2)).toBe(true);
    expect(confirmRipple).toHaveBeenCalledTimes(1);
    expect(confirmRipple.mock.calls[0][2].value).toBe("b");
  });
});

describe("prevQuestion / nextQuestion — R1 free navigation", () => {
  const ALL_STATUSES: Array<{ id: string; overrides?: Partial<Question> }> = [
    { id: "q1", overrides: { recommendation: "a" } },
    { id: "q2", overrides: { status: "answered" } },
    { id: "q3", overrides: { status: "reasked" } },
    { id: "q4", overrides: { status: "moot" } },
    { id: "q5", overrides: { status: "withdrawn" } },
    { id: "q6", overrides: { status: "closed" } },
  ];

  test("test_d_next_traverses_every_status_and_clamps_at_end", () => {
    const state = seed(ALL_STATUSES);
    const { panel } = makePanel(state);
    expect(panel.currentId).toBe("q1");
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      expect(nextQuestion(panel)).toBe(true); // never rejected (R1)
      expect(panel.currentId).toBeDefined();
      ids.push(panel.currentId as string);
    }
    expect(ids).toEqual([
      "q2",
      "q3",
      "q4",
      "q5",
      "q6",
      "q6", // clamped — no wrap for explicit navigation
      "q6",
      "q6",
      "q6",
      "q6",
    ]);
  });

  test("test_d_prev_traverses_back_and_clamps_at_start", () => {
    const state = seed(ALL_STATUSES);
    const { panel } = makePanel(state);
    panel.currentId = "q6";
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      expect(prevQuestion(panel)).toBe(true);
      ids.push(panel.currentId);
    }
    expect(ids).toEqual(["q5", "q4", "q3", "q2", "q1", "q1", "q1", "q1"]);
  });

  test("test_k_advance_never_lands_on_moot_withdrawn_closed", () => {
    // Skips moot/withdrawn/closed in one hop: q1 → q5 is the next open.
    // q2's moot-ness is LEGITIMATE (unmet dependency — a missing dep id is
    // unmet forever): a conditionless moot question would be reopened by the
    // accept-path evaluateDependsOn hook (BUG-006b — empty dependsOn is the
    // degenerate always-met case), and advance would rightly land on it.
    const state = seed([
      { id: "q1" },
      { id: "q2", overrides: { status: "moot", dependsOn: [{ id: "ghost-dep", equals: "x" }] } },
      { id: "q3", overrides: { status: "withdrawn" } },
      { id: "q4", overrides: { status: "closed" } },
      { id: "q5" },
    ]);
    const { panel } = makePanel(state);
    expect(accept(panel)).toBe(true);
    expect(panel.currentId).toBe("q5");
    // Accepting q5 with only non-unanswered questions left → STAYS (never
    // wedges: the advance scan is a bounded full cycle).
    expect(accept(panel)).toBe(true);
    expect(panel.currentId).toBe("q5");
    expect(state.getQuestion("q5")?.status).toBe("answered");
  });

  test("test_k_exhaustive_accept_cycle_terminates_and_lands_only_on_answerable", () => {
    const state = seed(ALL_STATUSES);
    const { panel } = makePanel(state);
    // Accept repeatedly across the whole fixture — every landing is an
    // answerable-or-current question and the loop terminates (the advance
    // scan is a bounded full cycle; reasked re-answers are legal, AC-13).
    const answerable = ["q1", "q3"]; // open + reasked in ALL_STATUSES
    for (let i = 0; i < answerable.length + 2; i++) {
      expect(accept(panel)).toBe(true);
      expect(panel.currentId).toBeDefined();
      const current = state.getQuestion(panel.currentId as string);
      expect(["open", "reasked", "answered"]).toContain(current?.status);
    }
    for (const id of answerable) {
      expect(state.getQuestion(id)?.status).toBe("answered");
    }
  });

  test("test_d_cursor_resets_to_star_preselect_on_every_change", () => {
    const state = seed(ALL_STATUSES);
    const { panel } = makePanel(state);
    panel.cursorIndex = 3; // stray cursor position on q1
    nextQuestion(panel);
    expect(panel.cursorIndex).toBe(0); // q2 ★ preselect (recommendation "a")
    panel.cursorIndex = 2;
    prevQuestion(panel);
    expect(panel.cursorIndex).toBe(0); // q1 recommendation preselect again
  });
});

describe("submit — flush pending answers", () => {
  test("test_i_submit_with_pending_snapshots_bumps_and_delivers_once", () => {
    const state = seed(BASIC);
    state.applyAnswer("q1", { value: "a", at: T0 }); // pending since epoch 1
    const { panel } = makePanel(state);
    const { deps, sendMessage } = makeDeps(true);
    const snapsBefore = state.snapshots.length; // 0
    const epochBefore = state.epoch; // 1

    expect(submit(panel, deps)).toBe(true);

    // Exactly ONE buildSubmission side-effect pair: ring +1, epoch +1.
    expect(state.snapshots.length).toBe(snapsBefore + 1);
    expect(state.epoch).toBe(epochBefore + 1);
    expect(state.snapshots[state.snapshots.length - 1]?.epoch).toBe(epochBefore);
    // Exactly ONE delivery, idle branch → triggerTurn followUp (h3.6).
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [msg, options] = sendMessage.mock.calls[0];
    expect(msg.details.changed).toHaveLength(1);
    expect(msg.details.changed[0]?.id).toBe("q1");
    expect(msg.details.epoch).toBe(epochBefore); // PRE-bump epoch in the card
    expect(options).toEqual({ triggerTurn: true, deliverAs: "followUp" });
  });

  test("test_i_busy_probe_picks_the_steer_branch", () => {
    const state = seed(BASIC);
    state.applyAnswer("q1", { value: "a", at: T0 });
    const { panel } = makePanel(state);
    const { deps, sendMessage } = makeDeps(false);
    submit(panel, deps);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toEqual({ deliverAs: "steer" });
  });

  test("test_j_submit_with_zero_pending_flashes_nothing_to_submit_no_side_effects", () => {
    const state = seed(BASIC); // questions upserted, NOTHING answered
    const { panel } = makePanel(state);
    const { deps, sendMessage } = makeDeps(true);
    const snapsBefore = state.snapshots.length;
    const epochBefore = state.epoch;

    expect(submit(panel, deps)).toBe(true);
    expect(panel.footerFlash?.text).toBe("nothing to submit"); // exact h2.37 string
    expect(state.snapshots.length).toBe(snapsBefore); // NO snapshot…
    expect(state.epoch).toBe(epochBefore); // …NO epoch bump…
    expect(sendMessage).not.toHaveBeenCalled(); // …NO delivery
  });

  test("test_j_second_submit_after_a_flush_is_zero_pending_again", () => {
    const state = seed(BASIC);
    state.applyAnswer("q1", { value: "a", at: T0 });
    const { panel } = makePanel(state);
    const { deps, sendMessage } = makeDeps(true);
    expect(submit(panel, deps)).toBe(true);
    const snapsAfterFirst = state.snapshots.length;
    const epochAfterFirst = state.epoch;

    // No edits since → pending set is empty → flash, no new side effects.
    expect(submit(panel, deps)).toBe(true);
    expect(panel.footerFlash?.text).toBe("nothing to submit");
    expect(state.snapshots.length).toBe(snapsAfterFirst);
    expect(state.epoch).toBe(epochAfterFirst);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  // DEFECT FIX regression (P1.M7.T6.S1): the ctrl+s flush performs the
  // h2.38 answered(pending) → submitted transition (merge.ts: "all pending
  // (answered) ids before the epoch bump") and fires the lifecycle seam
  // after the real delivery. Unit-level half of the AC-3/AC-14 end-to-end
  // proofs (see ac-scripted.test.ts).
  test("test_i_submit_flush_marks_pending_submitted_and_calls_noteSubmissionDelivered", () => {
    const state = seed(BASIC);
    state.applyAnswer("q1", { value: "a", at: T0 });
    state.applyAnswer("q2", { value: "b", at: T0 }); // pending from an earlier partial flush
    const { panel } = makePanel(state);
    const noteSubmissionDelivered = vi.fn();
    const { deps, sendMessage } = makeDeps(true);
    (deps as { noteSubmissionDelivered?: () => void }).noteSubmissionDelivered =
      noteSubmissionDelivered;

    expect(submit(panel, deps)).toBe(true);

    // ALL pending ids — not only this diff's — entered "submitted".
    expect(state.getQuestion("q1")!.status).toBe("submitted");
    expect(state.getQuestion("q2")!.status).toBe("submitted");
    // The flush never touches rev (h2.39: answers are epoch territory).
    expect(state.getQuestion("q1")!.rev).toBe(1);
    // Seam fires exactly once, after the single delivery.
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(noteSubmissionDelivered).toHaveBeenCalledTimes(1);
    expect(noteSubmissionDelivered.mock.invocationCallOrder[0]).toBeGreaterThan(
      sendMessage.mock.invocationCallOrder[0],
    );
  });

  // BUG-008 regression (h2.2 Issue 8): after an agent rule-2 re-ask, the raw
  // diff contains the agent's own answer reset (old value → "(unanswered)")
  // because computeDiff is status-blind. Submit must (a) NOT ship the
  // re-asked question's preserved draft and (b) NOT list the reset in the
  // model-visible delta — while keeping the single snapshot/bump/delivery
  // contract intact.
  test("bug008_draft_of_reasked_question_survives_submit_that_ships_other_questions", () => {
    const state = seed(BASIC);
    state.applyAnswer("q1", { value: "a", at: T0 });
    const store = new DraftStore();
    const { panel } = makePanel(state, { drafts: store });
    const { deps, sendMessage } = makeDeps(true);

    // First submit consumes q1's answer — the ring baseline now holds q1
    // ANSWERED, which is what makes the re-ask produce a phantom diff entry.
    expect(submit(panel, deps)).toBe(true);
    expect(state.epoch).toBe(2);

    // Agent rule-2 re-ask of q1 (merge.ts: content change → status
    // "reasked", answer DELETED) — wholesale replace, exactly the shape
    // merge.ts hands upsertQuestion. The store preserves the user's draft
    // (existing R4 behavior on the re-ask itself).
    state.upsertQuestion({ ...choiceQ("q1", { recommendation: "a" }), rev: 2, status: "reasked" });
    store.setDraft("q1", "my elaboration draft");

    // User answers q2 and submits — shipping NOTHING for q1.
    state.applyAnswer("q2", { value: "b", at: T0 });
    const snapsBefore = state.snapshots.length;
    const epochBefore = state.epoch;
    expect(submit(panel, deps)).toBe(true);

    // (a) The re-asked question's draft SURVIVED (R4: no silent destruction).
    expect(store.getDraft("q1")).toBe("my elaboration draft");
    // (b) The delta lists ONLY the user shipment — no phantom q1 reset entry
    // in the content line nor in details.changed.
    expect(sendMessage).toHaveBeenCalledTimes(2); // one per real submit
    const msg = sendMessage.mock.calls[1][0] as {
      content: string;
      details: { changed: Array<{ id: string }> };
    };
    expect(msg.content).toContain("q2");
    expect(msg.content).not.toContain("(unanswered)");
    expect(msg.details.changed.map((e) => e.id)).toEqual(["q2"]);
    // (c) Side-effect contract unchanged: +1 snapshot, +1 epoch, once.
    expect(state.snapshots).toHaveLength(snapsBefore + 1);
    expect(state.epoch).toBe(epochBefore + 1);
  });

  test("bug008_zero_user_pending_pure_agent_reset_flashes_and_ships_nothing", () => {
    const state = seed(BASIC);
    state.applyAnswer("q1", { value: "a", at: T0 });
    const store = new DraftStore();
    const { panel } = makePanel(state, { drafts: store });
    const { deps, sendMessage } = makeDeps(true);
    expect(submit(panel, deps)).toBe(true); // baseline holds q1 answered

    // Rule-2 re-ask resets q1; the ONLY diff entry is the agent's own reset.
    state.upsertQuestion({ ...choiceQ("q1", { recommendation: "a" }), rev: 2, status: "reasked" });
    store.setDraft("q1", "still here");
    panel.batchNote = "held note"; // R3: stays held when nothing ships

    const snapsBefore = state.snapshots.length;
    const epochBefore = state.epoch;
    expect(submit(panel, deps)).toBe(true);

    expect(panel.footerFlash?.text).toBe(
      // WRITEIN-002: the preserved ✎ draft on the re-asked choice question
      // is HELD — its role binds to the current selection, which is none —
      // and the flash names it with the verbatim h2.39 template ("(s)" is
      // literal; no pluralization logic).
      "nothing to submit — 1 question(s) have drafts awaiting an option or Other",
    );
    expect(sendMessage).toHaveBeenCalledTimes(1); // only the first submit
    expect(state.snapshots).toHaveLength(snapsBefore); // NO snapshot
    expect(state.epoch).toBe(epochBefore); // NO epoch bump
    expect(store.getDraft("q1")).toBe("still here"); // draft intact
    expect(panel.batchNote).toBe("held note"); // held, never dropped (R3)
  });

  test("bug008_shipped_draft_is_destroyed_but_unshipped_neighbor_survives", () => {
    // Guard against over-preserving: a draft whose id the user DOES ship is
    // destroyed; a neighbor's draft (id not pending) survives even though
    // the buggy diff.changed-based flush would also have considered it.
    const state = seed(BASIC);
    state.applyAnswer("q1", { value: "a", at: T0 }); // only q1 pending
    const store = new DraftStore();
    store.setDraft("q1", "ships with q1");
    store.setDraft("q2", "q2 is not being shipped");
    const { panel } = makePanel(state, { drafts: store });
    const { deps } = makeDeps(true);

    expect(submit(panel, deps)).toBe(true);

    expect(store.getDraft("q1")).toBeUndefined(); // shipped → destroyed (R4)
    expect(store.getDraft("q2")).toBe("q2 is not being shipped"); // not shipped → survives
  });

  test("bug008_edited_archived_entry_still_ships_ac13", () => {
    // AC-13 guard: the BUG-008 filter must never drop a genuine user edit of
    // an archived (closed) answer — its entry carries a real answer, so the
    // `to !== "(unanswered)"` half keeps it, and the (changed) marker stays.
    const state = seed(BASIC);
    state.applyAnswer("q1", { value: "a", at: T0 });
    state.setStatus("q1", "closed"); // archived with its answer (h2.38)
    state.applyAnswer("q2", { value: "a", at: T0 });
    const store = new DraftStore();
    const { panel } = makePanel(state, { drafts: store });
    const { deps, sendMessage } = makeDeps(true);
    expect(submit(panel, deps)).toBe(true); // baseline: q1 closed/a, q2 shipped

    // User edits the closed answer → re-marked answered (pending), new value.
    state.applyAnswer("q1", { value: "b", at: T0 });
    expect(submit(panel, deps)).toBe(true);

    const msg = sendMessage.mock.calls[1][0] as {
      content: string;
      details: { changed: Array<{ id: string; to: string; editedArchived: boolean }> };
    };
    expect(msg.details.changed).toHaveLength(1);
    expect(msg.details.changed[0]?.id).toBe("q1");
    expect(msg.details.changed[0]?.editedArchived).toBe(true); // AC-13 marker data
    expect(msg.details.changed[0]?.to).toBe("Beta"); // a real answer, NOT "(unanswered)"
    expect(msg.content).toContain("q1: Beta (changed)"); // renderer marker source
  });
});

describe("write-in duty (WRITEIN-001, FR-D1)", () => {
  test("test_wi_accept_other_row_enters_writein_duty_and_seeds_draft", () => {
    const state = seed([{ id: "q1", overrides: { recommendation: "a" } }]);
    const { panel } = makePanel(state);
    panel.commitTextDraft("q1", "saved draft"); // pre-existing draft (R4)
    panel.currentId = "q1";
    panel.cursorIndex = 2; // past the 2 options = the ✎ Other — write your own row

    expect(accept(panel)).toBe(true);
    expect(panel.focus).toBe("text");
    expect(panel.textDuty).toBe("writein");
    expect(panel.textField.getText()).toBe("saved draft"); // seeded via the shared focusTextField path
    expect(renderDutyLabel("writein", stubTheme, 80)).toBe("OTHER — this text is the answer");
  });

  test("test_wi_enter_empty_buffer_on_answered_with_victims_never_gates", () => {
    // h2.35 gates COMMITS only — an empty buffer is not a commit (S1's
    // empty branch returns before the gate): draft save + blur, no modal.
    const state = seed([
      { id: "q1", overrides: { status: "answered" } },
      { id: "q2", overrides: { status: "answered", dependsOn: [{ id: "q1", equals: "a" }] } },
    ]);
    const { panel } = makePanel(state, { drafts: new DraftStore() });
    panel.currentId = "q1";
    panel.cursorIndex = 2;
    accept(panel); // Other row → writein duty (duty entry is ungated)
    expect(panel.textDuty).toBe("writein");

    expect(panel.handleInput("\r")).toBe(true); // empty buffer + enter

    expect(panel.confirmMode).toBeNull(); // no modal — no commit, no confirm
    expect(state.getQuestion("q1")?.answer?.value).toBe("a"); // untouched
    expect(panel.draftTextFor("q1")).toBe(""); // draft slot written (S1 tail)
    expect(panel.focus).toBe("options");
  });

  test("test_wi_enter_on_answered_with_victims_defers_into_modal_fr18", () => {
    // FR-18 × WRITEIN-001 (h2.35, P1.M2.T2.S2): committing a write-in on an
    // answered question with ripple victims defers into the SAME keep/cancel
    // modal as option edits — NOT confirmRippleEdit (the choice seam drops
    // the custom marker).
    const state = seed([
      { id: "q1", overrides: { status: "answered" } },
      { id: "q2", overrides: { status: "answered", dependsOn: [{ id: "q1", equals: "a" }] } },
    ]);
    const { panel } = makePanel(state);
    panel.currentId = "q1";
    panel.cursorIndex = 2;
    accept(panel); // Other row → writein duty (duty entry is ungated)
    expect(panel.textDuty).toBe("writein");

    panel.textField.setText("cockroachdb");
    expect(panel.handleInput("\r")).toBe(true); // write-in enter → GATE

    expect(panel.confirmMode?.kind).toBe("writein");
    expect(panel.confirmMode?.questionId).toBe("q1");
    expect(panel.confirmMode?.text).toBe("cockroachdb");
    expect(panel.confirmMode?.victims).toEqual(["q2"]);
    // NOTHING applied — the commit is owned by applyWriteInConfirm now.
    expect(state.getQuestion("q1")?.answer?.value).toBe("a");
    expect(state.getQuestion("q1")?.answer?.custom).toBeUndefined();
    expect(panel.currentId).toBe("q1");
    expect(panel.focus).toBe("text"); // editor stays focused behind the modal
    expect(panel.textDuty).toBe("writein"); // no blur on stash
    // (Byte-exact footer assertion lives in ripple-confirm.test.ts — this
    // file's minimal editor stub has no render surface.)

    // Modal enter applies the deferred commit (applyWriteInConfirm tail).
    expect(panel.handleInput("\r")).toBe(true);
    expect(panel.confirmMode).toBeNull();
    const q1 = state.getQuestion("q1")!;
    expect(q1.answer?.value).toBe("cockroachdb");
    expect(q1.answer?.custom).toBe(true); // h2.42 marker survives the modal
    expect(state.getQuestion("q2")?.status).toBe("moot"); // FR-17 re-derived
    expect(panel.focus).toBe("options");
    expect(panel.textDuty).toBe("elaboration");
  });

  test("test_wi_enter_commits_custom_answer_and_advances", () => {
    const state = seed(BASIC);
    const { panel } = makePanel(state);
    panel.currentId = "q1";
    panel.cursorIndex = 2;
    accept(panel); // → write-in duty, editor focused

    panel.textField.setText("a hybrid of A and B");
    expect(panel.handleInput("\r")).toBe(true); // write-in enter COMMITS

    const q1 = state.getQuestion("q1")!;
    expect(q1.status).toBe("answered");
    expect(q1.answer?.value).toBe("a hybrid of A and B"); // RAW user text, not an option value
    expect(q1.answer?.custom).toBe(true); // h2.42 write-in marker
    expect(typeof q1.answer?.at).toBe("string");
    expect(new Date(q1.answer!.at).toISOString()).toBe(q1.answer!.at); // ISO 8601
    expect(panel.currentId).toBe("q2"); // advanced to the next unanswered (Q14 parity)
    expect(panel.focus).toBe("options"); // blurred after the advance
    expect(panel.textDuty).toBe("elaboration"); // blurTextField reset the duty
  });

  test("test_wi_enter_empty_buffer_saves_draft_no_commit", () => {
    const state = seed([{ id: "q1", overrides: { recommendation: "a" } }]);
    const { panel } = makePanel(state, { drafts: new DraftStore() });
    panel.currentId = "q1";
    panel.cursorIndex = 2;
    accept(panel);
    expect(panel.textField.getText()).toBe(""); // no draft seeded

    expect(panel.handleInput("\r")).toBe(true); // empty buffer + enter

    const q1 = state.getQuestion("q1")!;
    expect(q1.answer).toBeUndefined(); // NO commit — nothing answered (h2.32)
    expect(q1.status).toBe("open");
    expect(panel.draftTextFor("q1")).toBe(""); // draft slot + DraftStore seam written
    expect(panel.focus).toBe("options"); // blurred back to options
    expect(panel.cursorIndex).toBe(0); // EXPLAIN-003 ★ re-seed off the Other row
    expect(panel.textDuty).toBe("elaboration");
  });

  test("test_wi_commit_reruns_dependsOn", () => {
    const state = seed([
      { id: "q1" },
      { id: "q2", overrides: { dependsOn: [{ id: "q1", notEquals: "x" }] } },
    ]);
    const { panel } = makePanel(state);
    panel.currentId = "q1";
    panel.cursorIndex = 2;
    accept(panel);

    panel.textField.setText("x"); // trips the notEquals condition
    panel.handleInput("\r");

    expect(state.getQuestion("q1")?.answer?.value).toBe("x");
    expect(state.getQuestion("q2")?.status).toBe("moot"); // FR-17 re-derived instantly
  });

  test("test_wi_value_keeps_newlines", () => {
    const state = seed([{ id: "q1" }]);
    const { panel } = makePanel(state);
    panel.currentId = "q1";
    panel.cursorIndex = 2;
    accept(panel);

    panel.handleInput("line1");
    panel.handleInput("\n"); // byte-guard: newline request inserts, never a stage transition
    panel.handleInput("line2");
    panel.handleInput("\r");

    expect(state.getQuestion("q1")?.answer?.value).toBe("line1\nline2");
  });

  test("test_blur_resets_duty_to_elaboration", () => {
    const state = seed([{ id: "q1" }]);
    const { panel } = makePanel(state);
    panel.currentId = "q1";
    panel.cursorIndex = 2;
    accept(panel);
    expect(panel.textDuty).toBe("writein");

    panel.blurTextField();

    expect(panel.textDuty).toBe("elaboration"); // duty is per-focus-session
  });
});

describe("submit — draft flush (R4, P1.M4.T2.S1)", () => {
  /** Stub DraftStore with spies, per panel.test.ts convention. */
  function makeDraftStoreSpy() {
    return {
      getDraft: vi.fn(),
      setDraft: vi.fn(),
      getNote: vi.fn(() => ""),
      setNote: vi.fn(),
      clearDraft: vi.fn(() => false),
      clearAll: vi.fn(),
      shipDrafts: vi.fn(() => new Map<string, { value: string; text: string }>()),
    };
  }

  test("test_i_submit_with_non_empty_diff_ships_exactly_diff_changed", () => {
    const state = seed(BASIC);
    state.applyAnswer("q1", { value: "a", at: T0 }); // pending → diff.changed = ["q1"]
    const drafts = makeDraftStoreSpy();
    const { panel } = makePanel(state, { drafts });
    const { deps } = makeDeps(true);

    expect(submit(panel, deps)).toBe(true);

    expect(drafts.shipDrafts).toHaveBeenCalledTimes(1);
    expect(drafts.shipDrafts).toHaveBeenCalledWith(["q1"]);
  });

  test("test_i_zero_pending_submit_never_touches_drafts", () => {
    const state = seed(BASIC); // nothing answered → zero pending
    const drafts = makeDraftStoreSpy();
    const { panel } = makePanel(state, { drafts });
    const { deps } = makeDeps(true);

    expect(submit(panel, deps)).toBe(true);
    expect(panel.footerFlash?.text).toBe("nothing to submit");
    expect(drafts.shipDrafts).not.toHaveBeenCalled();
    expect(drafts.clearDraft).not.toHaveBeenCalled();
    expect(drafts.clearAll).not.toHaveBeenCalled();
  });

  test("test_i_suspend_resume_money_test_two_sessions_one_store", () => {
    // THE R4 test: ONE store (the extension-closure singleton), TWO panel
    // sessions. Session 1 writes a text draft through the seam, then is
    // dropped (suspend). Session 2 — a fresh panel instance rehydrated from
    // the same store (the resume seeding path, panel.ts currentText) — sees
    // the draft. Submit then ships and destroys exactly the changed id.
    const store = new DraftStore();

    // Session 1 (open): user types in the text field → stage-1 save seam.
    const state1 = seed(BASIC);
    const panel1 = makePanel(state1, { drafts: store }).panel;
    store.setDraft("q1", "typed text"); // panel1.saveTextDraft() lands here
    expect(store.getDraft("q1")).toBe("typed text");
    void panel1; // ...panel suspended & destroyed; the STORE is not

    // Session 2 (resume): fresh panel, same store instance.
    const state2 = state1;
    const panel2 = makePanel(state2, { drafts: store }).panel;
    expect(store.getDraft("q1")).toBe("typed text"); // survival by construction
    void panel2;

    // Resume-session submit: q1 answered → shipped ids exactly ["q1"].
    state2.applyAnswer("q1", { value: "a", at: T0 });
    const { deps } = makeDeps(true);
    expect(submit(panel2, deps)).toBe(true);
    expect(store.getDraft("q1")).toBeUndefined(); // shipped → destroyed
    expect(store.getDraft("q2")).toBeUndefined(); // never drafted
  });
});

// ---------------------------------------------- temporary matcher (panel.ts)

describe("handleInput — config-driven router (keys.ts, P1.M3.T3.S1)", () => {
  test("test_matcher_arrows_drive_option_up_down_including_application_mode", () => {
    const { panel } = makePanel(seed(BASIC));
    panel.handleInput("\u001b[B"); // ↓
    expect(panel.cursorIndex).toBe(1);
    panel.handleInput("\u001b[A"); // ↑
    expect(panel.cursorIndex).toBe(0);
    panel.handleInput("\u001bOB"); // application-mode ↓
    expect(panel.cursorIndex).toBe(1);
    panel.handleInput("\u001bOA"); // application-mode ↑
    expect(panel.cursorIndex).toBe(0);
  });

  test("test_matcher_enter_both_cr_and_lf_accepts_and_advances", () => {
    const state = seed(BASIC);
    const { panel } = makePanel(state);
    panel.handleInput("\r");
    expect(state.getQuestion("q1")?.status).toBe("answered");
    expect(panel.currentId).toBe("q2");
    panel.handleInput("\n"); // defensive LF alias
    expect(state.getQuestion("q2")?.status).toBe("answered");
  });

  test("test_matcher_tab_prev_and_shift_tab_next_per_config_defaults", () => {
    const { panel } = makePanel(ALL_STATUSES_FIXTURE());
    expect(panel.currentId).toBe("q1");
    panel.handleInput("\t"); // config.keys.prevQuestion default "tab"
    expect(panel.currentId).toBe("q1"); // clamped at the start
    panel.handleInput("\u001b[Z"); // config.keys.nextQuestion default "shift+tab"
    expect(panel.currentId).toBe("q2");
    panel.handleInput("\t");
    expect(panel.currentId).toBe("q1");
  });

  test("test_matcher_digits_quick_select_when_enabled", () => {
    const state = seed(BASIC);
    const { panel } = makePanel(state);
    panel.handleInput("2");
    expect(state.getQuestion("q1")?.answer?.value).toBe("b");
  });

  test("test_matcher_digits_fall_through_when_quick_select_disabled", () => {
    const state = seed(BASIC);
    const config = { ...DEFAULT_CONFIG, digitQuickSelect: false };
    const { panel } = makePanel(state, {}, config);
    panel.handleInput("2");
    expect(state.getQuestion("q1")?.answer).toBeUndefined();
  });

  test("test_matcher_skipped_when_the_keys_seam_consumes_first", () => {
    const state = seed(BASIC);
    const keys = vi.fn(() => true);
    const { panel } = makePanel(state, { keys });
    panel.handleInput("\r");
    expect(keys).toHaveBeenCalledWith("\r", panel);
    expect(state.getQuestion("q1")?.status).toBe("open"); // matcher never ran
  });

  test("test_router_fixed_arrows_work_in_any_view", () => {
    const state = seed(BASIC);
    const { panel } = makePanel(state);
    panel.handleInput("\u000c"); // ctrl+l → overview (router seam default)
    expect(panel.view).toBe("overview");
    // Arrows are FIXED keys (h2.34): the router checks them before anything
    // else, in ANY view — only enter/digits/externalEditor carry focus
    // gating. View-gated TARGETS refine on top (deep P1.M5.T1.S1, overview
    // P1.M5.T2.S1): in overview ↓ moves the overview CURSOR ROW — never the
    // short-form option cursor and never currentId (h2.29).
    panel.handleInput("\u001b[B"); // ↓ moves the overview cursor
    expect(panel.overviewCursor).toBe(1);
    expect(panel.cursorIndex).toBe(0); // option cursor untouched
    panel.handleInput("\u001b[A"); // ↑ moves it back
    expect(panel.overviewCursor).toBe(0);
    expect(panel.currentId).toBe("q1");
  });

  test("test_matcher_submit_uses_the_delivery_seam_and_stays_inert_without_it", () => {
    const state = seed(BASIC);
    state.applyAnswer("q1", { value: "a", at: T0 });
    const { deps, sendMessage } = makeDeps(true);

    // Without a delivery surface the branch is inert.
    const bare = makePanel(state);
    bare.panel.handleInput("\u0013"); // ctrl+s
    expect(sendMessage).not.toHaveBeenCalled();

    // With one, ctrl+s submits (view-agnostic — works outside short too).
    const wired = makePanel(state, { delivery: deps });
    wired.panel.handleInput("\u001b[Z"); // shift+tab → q2 (still pending-free)
    wired.panel.handleInput("\u0013");
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  test("test_matcher_arrows_before_esc_builtins_never_eaten", () => {
    const state = seed(BASIC);
    const { panel } = makePanel(state);
    // An arrow is ESC-prefixed; it must move the cursor, not trip esc logic.
    panel.handleInput("\u001b[B");
    expect(panel.cursorIndex).toBe(1);
    expect(panel.view).toBe("short");
  });
});

// ------------------------------------------------------- footer flash (h2.37)

describe("panel.flash — transient footer flash", () => {
  useFakeTimers();

  test("test_flash_sets_line_renders_above_footer_and_expires", () => {
    const state = seed(BASIC);
    const { panel, requestRender } = makePanel(state);
    panel.render(80);
    panel.flash("nothing to submit");
    expect(panel.footerFlash?.text).toBe("nothing to submit");
    const lines = panel.render(80); // cache was invalidated → rebuild
    expect(lines.at(-2)).toContain("nothing to submit"); // directly above the footer
    expect(lines.at(-1)).toContain("answered"); // footer is still last

    vi.advanceTimersByTime(2500);
    expect(panel.footerFlash).toBeUndefined();
    expect(requestRender).toHaveBeenCalled(); // expiry re-invalidates
    const after = panel.render(80);
    expect(after.join("\n")).not.toContain("nothing to submit");
  });

  test("test_flash_timer_cleared_on_dispose_no_post_suspend_repaint", () => {
    const state = seed(BASIC);
    const { panel, requestRender } = makePanel(state);
    panel.flash("nothing to submit");
    const rendersAtDispose = requestRender.mock.calls.length;
    panel.dispose();
    vi.advanceTimersByTime(10_000);
    expect(requestRender.mock.calls.length).toBe(rendersAtDispose); // no repaint
  });

  test("test_back_to_back_flashes_replace_without_stacking_timers", () => {
    const state = seed(BASIC);
    const { panel } = makePanel(state);
    panel.flash("first");
    const firstTimer = panel.footerFlash?.timer;
    panel.flash("second");
    expect(panel.footerFlash?.text).toBe("second");
    expect(panel.footerFlash?.timer).not.toBe(firstTimer);
    vi.advanceTimersByTime(2500);
    expect(panel.footerFlash).toBeUndefined(); // only ONE live timer
  });
});

// ------------------------------------------------------------------ registry

describe("panelActions registry", () => {
  test("test_registry_exposes_the_named_action_surface", () => {
    for (const name of [
      "optionUp",
      "optionDown",
      "digit",
      "accept",
      "prevQuestion",
      "nextQuestion",
      "submit",
    ] as const) {
      expect(typeof panelActions[name]).toBe("function");
    }
  });
});

// ------------------------------------------------------------------ helpers

/** q1 open, then one question per non-open status (R1 traversal fixture). */
function ALL_STATUSES_FIXTURE(): InterrogationState {
  return seed([
    { id: "q1", overrides: { recommendation: "a" } },
    { id: "q2", overrides: { status: "answered" } },
    { id: "q3", overrides: { status: "reasked" } },
    { id: "q4", overrides: { status: "moot" } },
    { id: "q5", overrides: { status: "withdrawn" } },
    { id: "q6", overrides: { status: "closed" } },
  ]);
}

/** Opt-in fake timers for flash-expiry tests (declared inside describes). */
function useFakeTimers(): void {
  beforeEach(() => {
    vi.useFakeTimers();
  });
}

// --------------------------------- submit — batch note (R3, P1.M4.T2.S2)

describe("submit — batch note (R3, P1.M4.T2.S2)", () => {
  function makeDraftStoreSpy(note = "") {
    return {
      getDraft: vi.fn(),
      setDraft: vi.fn(),
      getNote: vi.fn(() => note),
      setNote: vi.fn(),
      shipDrafts: vi.fn(() => new Map<string, { value: string; text: string }>()),
    };
  }

  type SubmittedMsg = { content: string; details: { note?: string } };

  test("test_r3_submit_with_held_note_ships_NOTE_line_and_clears_after", () => {
    const state = seed(BASIC);
    state.applyAnswer("q1", { value: "a", at: T0 }); // pending → real submission
    const drafts = makeDraftStoreSpy("picked B because of the deploy");
    const { panel } = makePanel(state, { drafts });
    const { deps, sendMessage } = makeDeps(true);

    expect(submit(panel, deps)).toBe(true);

    const msg = sendMessage.mock.calls[0][0] as SubmittedMsg;
    const lines = msg.content.split("\n");
    expect(lines).toHaveLength(3); // h3.6 ≤3-line budget, note = third line
    expect(lines[2]).toBe("NOTE: picked B because of the deploy"); // model-visible
    expect(msg.details.note).toBe("picked B because of the deploy"); // card keeps it
    // h2.32 "cleared after shipping" — AFTER delivery, never before.
    expect(drafts.setNote).toHaveBeenCalledWith("");
    expect(panel.batchNote).toBe("");
    expect(drafts.setNote.mock.invocationCallOrder[0]).toBeGreaterThan(
      sendMessage.mock.invocationCallOrder[0],
    );
    // S1's shipDrafts flush is untouched and still adjacent.
    expect(drafts.shipDrafts).toHaveBeenCalledWith(["q1"]);
  });

  test("test_r3_store_note_wins_over_stale_panel_field", () => {
    const state = seed(BASIC);
    state.applyAnswer("q1", { value: "a", at: T0 });
    const drafts = makeDraftStoreSpy("store copy");
    const { panel } = makePanel(state, { drafts });
    panel.batchNote = "stale field copy";
    const { deps, sendMessage } = makeDeps(true);

    submit(panel, deps);

    const msg = sendMessage.mock.calls[0][0] as SubmittedMsg;
    expect(msg.content).toContain("NOTE: store copy");
    expect(msg.content).not.toContain("stale field copy");
  });

  test("test_r3_panel_field_is_the_fallback_without_a_store", () => {
    const state = seed(BASIC);
    state.applyAnswer("q1", { value: "a", at: T0 });
    const { panel } = makePanel(state); // NO drafts seam (pre-S1 shape)
    panel.batchNote = "field note";
    const { deps, sendMessage } = makeDeps(true);

    submit(panel, deps);

    const msg = sendMessage.mock.calls[0][0] as SubmittedMsg;
    expect(msg.content.split("\n")).toHaveLength(3);
    expect(msg.details.note).toBe("field note");
    expect(panel.batchNote).toBe(""); // cleared even without a store
  });

  test("test_r3_zero_pending_submit_holds_the_note", () => {
    const state = seed(BASIC); // nothing answered → zero pending
    const drafts = makeDraftStoreSpy("held");
    const { panel } = makePanel(state, { drafts });
    panel.batchNote = "held";
    const { deps, sendMessage } = makeDeps(true);

    expect(submit(panel, deps)).toBe(true);

    expect(panel.footerFlash?.text).toBe("nothing to submit");
    expect(sendMessage).not.toHaveBeenCalled(); // nothing shipped…
    expect(drafts.setNote).not.toHaveBeenCalled(); // …so nothing cleared
    expect(panel.batchNote).toBe("held"); // R3: ships with the NEXT submission
  });

  test("test_r3_empty_note_keeps_two_line_content_and_never_clears", () => {
    const state = seed(BASIC);
    state.applyAnswer("q1", { value: "a", at: T0 });
    const drafts = makeDraftStoreSpy("");
    const { panel } = makePanel(state, { drafts });
    const { deps, sendMessage } = makeDeps(true);

    submit(panel, deps);

    const msg = sendMessage.mock.calls[0][0] as SubmittedMsg;
    expect(msg.content.split("\n")).toHaveLength(2); // no NOTE line
    expect("note" in msg.details).toBe(false);
    expect(drafts.setNote).not.toHaveBeenCalled();
  });
});

// ----------------- submit draft reconciliation (NEW-002/NEW-003, h2.45)

describe("submit — draft reconciliation at submit (NEW-002/NEW-003, h2.45)", () => {
  test("NEW-002: an open text question's typed draft ships as the answer", () => {
    const state = seed([{ id: "t1", overrides: { type: "text", options: undefined } }]);
    const store = new DraftStore();
    const { panel } = makePanel(state, { drafts: store });
    const { deps, sendMessage } = makeDeps(true);

    store.setDraft("t1", "my detailed answer");
    expect(submit(panel, deps)).toBe(true);

    // The draft BECAME the answer — the only apply affordance a text
    // question has in the TUI (h2.45 "text answers ship").
    expect(state.getQuestion("t1")?.answer?.value).toBe("my detailed answer");
    expect(state.getQuestion("t1")?.status).toBe("submitted"); // flushed with the shipment
    expect(store.getDraft("t1")).toBeUndefined(); // shipped → destroyed (R4)
    const msg = sendMessage.mock.calls[0][0] as { content: string };
    // h2.42 grammar: the reconciled draft carries custom → renders ✎.
    expect(msg.content).toContain("t1: ✎ my detailed answer");
  });

  test("NEW-002: empty drafts never ship — an empty text slot is an absent draft", () => {
    const state = seed([{ id: "t1", overrides: { type: "text", options: undefined } }]);
    const store = new DraftStore();
    const { panel } = makePanel(state, { drafts: store });
    const { deps, sendMessage } = makeDeps(true);

    store.setDraft("t1", "   ");
    expect(submit(panel, deps)).toBe(true);

    expect(state.getQuestion("t1")?.answer).toBeUndefined();
    expect(state.getQuestion("t1")?.status).toBe("open");
    expect(sendMessage).not.toHaveBeenCalled(); // nothing user-shipped
    expect(state.epoch).toBe(1); // no epoch burn
  });

  test("NEW-002: a re-asked text question's re-typed draft ships (the text re-accept)", () => {
    const state = seed([{ id: "t1", overrides: { type: "text", options: undefined } }]);
    state.applyAnswer("t1", { value: "first", at: T0 });
    const store = new DraftStore();
    const { panel } = makePanel(state, { drafts: store });
    const { deps, sendMessage } = makeDeps(true);
    expect(submit(panel, deps)).toBe(true); // baseline holds t1 answered

    // Agent rule-2 re-ask: content change resets the answer, draft preserved.
    state.upsertQuestion({
      id: "t1",
      prompt: "changed",
      type: "text",
      rev: 2,
      status: "reasked",
      options: undefined,
    });
    // The user re-types and stage-1 saves (the text-question counterpart of
    // a choice re-accept) — the next ctrl+s must ship it, or the question
    // could NEVER be re-answered and would block completion forever.
    store.setDraft("t1", "second attempt");
    expect(submit(panel, deps)).toBe(true);

    expect(state.getQuestion("t1")?.answer?.value).toBe("second attempt");
    expect(state.getQuestion("t1")?.status).toBe("submitted");
    const msg = sendMessage.mock.calls.at(-1)![0] as { content: string };
    // h2.42 grammar: the reconciled draft carries custom → renders ✎.
    expect(msg.content).toContain("t1: ✎ second attempt");
  });

  test("NEW-003: an answered choice question's draft attaches as answer.text and rides the delta", () => {
    const state = seed([{ id: "q1", overrides: { recommendation: "a" } }]);
    const store = new DraftStore();
    const { panel } = makePanel(state, { drafts: store });
    const { deps, sendMessage } = makeDeps(true);

    state.applyAnswer("q1", { value: "a", at: T0 });
    store.setDraft("q1", "because of latency");
    expect(submit(panel, deps)).toBe(true);

    expect(state.getQuestion("q1")?.answer?.text).toBe("because of latency");
    expect(state.getQuestion("q1")?.answer?.value).toBe("a"); // value untouched
    expect(store.getDraft("q1")).toBeUndefined(); // shipped → destroyed (R4)
    const msg = sendMessage.mock.calls[0][0] as { content: string };
    // Same `{answer} — {free text}` grammar as the completion record.
    expect(msg.content).toContain("q1: Alpha — because of latency");
  });

  test("NEW-003 meets BUG-008: a re-asked choice question's preserved draft never attaches", () => {
    const state = seed(BASIC);
    state.applyAnswer("q1", { value: "a", at: T0 });
    const store = new DraftStore();
    const { panel } = makePanel(state, { drafts: store });
    const { deps, sendMessage } = makeDeps(true);
    expect(submit(panel, deps)).toBe(true);

    // Agent rule-2 re-ask of q1, draft preserved (BUG-008).
    state.upsertQuestion({
      ...choiceQ("q1", { recommendation: "a" }),
      rev: 2,
      status: "reasked",
    });
    store.setDraft("q1", "my elaboration draft");
    state.applyAnswer("q2", { value: "a", at: T0 });
    expect(submit(panel, deps)).toBe(true);

    // q1's reset is agent-caused — its draft must survive untouched.
    expect(state.getQuestion("q1")?.answer).toBeUndefined();
    expect(store.getDraft("q1")).toBe("my elaboration draft");
    const msg = sendMessage.mock.calls.at(-1)![0] as {
      content: string;
      details: { changed: Array<{ id: string }> };
    };
    expect(msg.details.changed.map((e) => e.id)).toEqual(["q2"]); // only the user shipment
  });
});

// --------------------------------- submit soft-gate warning (P1.M5.T3.S1)

describe("submit — soft-gate warning (display-only, P1.M5.T3.S1)", () => {
  /** Gate fixture: foundation group carries the gate; later group exists. */
  const GATE_FIXTURE: Array<{ id: string; overrides?: Partial<Question> }> = [
    { id: "g1", overrides: { group: "foundation", gate: true } },
    { id: "g2", overrides: { group: "foundation" } },
    { id: "n1", overrides: { group: "later" } },
  ];

  test("test_warning_gate_unanswered_sets_warning_AND_delivers_unchanged", () => {
    const state = seed(GATE_FIXTURE);
    state.applyAnswer("n1", { value: "a", at: T0 }); // only a later-group answer pending
    const { panel } = makePanel(state);
    const { deps, sendMessage } = makeDeps(true);

    expect(submit(panel, deps)).toBe(true);

    // h2.56: the submission ALWAYS ships — one delivery, snapshot, epoch.
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(state.snapshots.length).toBe(1);
    expect(state.epoch).toBe(2);
    // AND the dismissible warning is armed with the unanswered-gate count.
    expect(panel.gateWarning).toEqual({ count: 2, kind: "submit" });
  });

  test("test_warning_respects_gateWarnings_false", () => {
    const state = seed(GATE_FIXTURE);
    state.applyAnswer("n1", { value: "a", at: T0 });
    const config = { ...DEFAULT_CONFIG, gateWarnings: false } as InterrogatorConfig;
    const { panel } = makePanel(state, {}, config);
    const { deps, sendMessage } = makeDeps(true);

    expect(submit(panel, deps)).toBe(true);

    expect(sendMessage).toHaveBeenCalledTimes(1); // delivery unchanged
    expect(panel.gateWarning).toBeNull(); // no warning line
  });

  test("test_warning_all_gate_answered_no_warning", () => {
    const state = seed(GATE_FIXTURE);
    state.applyAnswer("g1", { value: "a", at: T0 });
    state.applyAnswer("g2", { value: "a", at: T0 });
    state.applyAnswer("n1", { value: "a", at: T0 });
    const { panel } = makePanel(state);
    const { deps, sendMessage } = makeDeps(true);

    expect(submit(panel, deps)).toBe(true);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(panel.gateWarning).toBeNull();
  });

  test("test_warning_zero_pending_shows_no_warning", () => {
    const state = seed(GATE_FIXTURE); // nothing answered anywhere
    const { panel } = makePanel(state);
    const { deps, sendMessage } = makeDeps(true);

    expect(submit(panel, deps)).toBe(true);

    expect(panel.footerFlash?.text).toBe("nothing to submit"); // flash, not warning
    expect(panel.gateWarning).toBeNull(); // nothing was submitted → no warning
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test("test_warning_moot_withdrawn_gate_questions_do_not_count", () => {
    const state = seed([
      { id: "g1", overrides: { group: "foundation", gate: true, status: "moot" } },
      { id: "g2", overrides: { group: "foundation", status: "withdrawn" } },
      { id: "n1", overrides: { group: "later" } },
    ]);
    state.applyAnswer("n1", { value: "a", at: T0 });
    const { panel } = makePanel(state);
    const { deps } = makeDeps(true);

    expect(submit(panel, deps)).toBe(true);
    expect(panel.gateWarning).toBeNull(); // n = 0 → no warning
  });

  test("test_warning_ungrouped_gate_bucket_counts", () => {
    const state = seed([
      { id: "u1", overrides: { gate: true } },
      { id: "n1", overrides: { group: "later" } },
    ]);
    state.applyAnswer("n1", { value: "a", at: T0 });
    const { panel } = makePanel(state);
    const { deps, sendMessage } = makeDeps(true);

    expect(submit(panel, deps)).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(panel.gateWarning).toEqual({ count: 1, kind: "submit" });
  });
});

// ----------- WRITEIN-002 submit-time draft role binding (P1.M2.T5.S1)

describe("submit — WRITEIN-002 draft role binding (h2.32/h2.48)", () => {
  /**
   * Real write-in commit through the TUI gestures: focus the ✎ Other row
   * (cursorIndex 2 of the 2-option fixtures), type, enter — writeInEnter
   * commits applyAnswer({ value, custom: true }) at enter and advances.
   */
  function commitWriteIn(panel: InterrogationPanel, text: string): void {
    panel.currentId = "q1";
    panel.cursorIndex = 2; // ✎ Other row (ungated duty entry)
    accept(panel); // → write-in duty, editor focused
    panel.textField.setText(text);
    expect(panel.handleInput("\r")).toBe(true); // write-in enter COMMITS
  }

  test("test_submit_elaboration_attaches_to_real_option_answer", () => {
    // Real-option answer + typed draft → the slot binds as elaboration
    // (answer.text); value untouched and NO custom marker on the result.
    const state = seed(BASIC);
    state.applyAnswer("q1", { value: "a", at: T0 }); // real option, no custom
    const store = new DraftStore();
    store.setDraft("q1", "because of the latency profile");
    const { panel } = makePanel(state, { drafts: store });
    const { deps, sendMessage } = makeDeps(true);

    expect(submit(panel, deps)).toBe(true);

    const a = state.getQuestion("q1")?.answer;
    expect(a?.value).toBe("a");
    expect(a?.text).toBe("because of the latency profile");
    expect(a?.custom).toBeUndefined(); // real-option answers stay non-custom
    const msg = sendMessage.mock.calls[0][0] as { content: string };
    expect(msg.content).toContain("q1: Alpha — because of the latency profile");
  });

  test("test_submit_writein_ships_value_custom_no_text_duplication", () => {
    // WRITEIN-002 core guard: a committed write-in's slot must NOT be
    // re-attached as answer.text at submit — the text already IS the value.
    const state = seed(BASIC);
    const store = new DraftStore();
    const { panel } = makePanel(state, { drafts: store });
    const { deps, sendMessage } = makeDeps(true);

    commitWriteIn(panel, "a hybrid of A and B");
    expect(state.getQuestion("q1")?.answer?.custom).toBe(true);
    // The user saved the same buffer as a slot (the elaboration save tail) —
    // the exact duplication hazard the `custom !== true` guard exists for.
    panel.commitTextDraft("q1", "a hybrid of A and B");

    expect(submit(panel, deps)).toBe(true);

    const a = state.getQuestion("q1")?.answer;
    expect(a?.value).toBe("a hybrid of A and B");
    expect(a?.custom).toBe(true); // h2.42 marker intact
    expect(a?.text).toBeUndefined(); // NOT duplicated into the elaboration field
    const msg = sendMessage.mock.calls[0][0] as { content: string };
    expect(msg.content).not.toContain("a hybrid of A and B — a hybrid of A and B");
  });

  test("test_submit_superseded_writein_rebinds_as_elaboration", () => {
    // AC-2b tail: write-in committed, then a REAL option accepted — the slot
    // survives the accept (R4: accept never touches the draft store) and
    // re-binds as elaboration at submit (value = option, custom cleared).
    const state = seed(BASIC);
    const store = new DraftStore();
    const { panel } = makePanel(state, { drafts: store });
    const { deps, sendMessage } = makeDeps(true);

    commitWriteIn(panel, "my custom take");
    panel.commitTextDraft("q1", "my custom take"); // kept slot text (R4)

    // Supersede: back to q1 — the currentId setter re-seeds the cursor to
    // the ★ "a" preselect — and accept the real option.
    panel.currentId = "q1";
    expect(accept(panel)).toBe(true);
    const superseded = state.getQuestion("q1")?.answer;
    expect(superseded?.value).toBe("a");
    expect(superseded?.custom).toBeUndefined(); // accept replaced the write-in
    expect(panel.draftTextFor("q1")).toBe("my custom take"); // slot KEPT (R4)

    expect(submit(panel, deps)).toBe(true);

    const a = state.getQuestion("q1")?.answer;
    expect(a?.value).toBe("a"); // the option won the value
    expect(a?.text).toBe("my custom take"); // kept write-in re-bound as elaboration
    expect(a?.custom).toBeUndefined();
    const msg = sendMessage.mock.calls[0][0] as { content: string };
    expect(msg.content).toContain("q1: Alpha — my custom take");
  });

  test("test_submit_text_draft_ships_with_custom_marker", () => {
    // NEW: the reconciled text answer carries custom: true (h2.42) — the
    // draft is user-typed text, never an option value.
    const state = seed([{ id: "t1", overrides: { type: "text", options: undefined } }]);
    const store = new DraftStore();
    const { panel } = makePanel(state, { drafts: store });
    const { deps, sendMessage } = makeDeps(true);

    store.setDraft("t1", "my detailed answer");
    expect(submit(panel, deps)).toBe(true);

    const a = state.getQuestion("t1")?.answer;
    expect(a?.value).toBe("my detailed answer");
    expect(a?.custom).toBe(true); // WRITEIN-002 marker
    expect(typeof a?.at).toBe("string"); // ISO timestamp still applied
    expect(state.getQuestion("t1")?.status).toBe("submitted"); // flushed
    expect(store.getDraft("t1")).toBeUndefined(); // shipped → destroyed (R4)
  });

  test("test_zero_pending_flash_names_held_drafts_verbatim", () => {
    // h2.39 verbatim template — "(s)" is literal, no pluralization logic.
    // Drafts ride the DraftStore fallback seam (same precedence as seeding).
    const state = seed(BASIC); // both open, nothing answered
    const store = new DraftStore();
    const { panel } = makePanel(state, { drafts: store });
    const { deps, sendMessage } = makeDeps(true);

    store.setDraft("q1", "held on q1");
    expect(submit(panel, deps)).toBe(true);
    expect(panel.footerFlash?.text).toBe(
      "nothing to submit — 1 question(s) have drafts awaiting an option or Other",
    );
    expect(sendMessage).not.toHaveBeenCalled();

    // n=2 — the count is the literal number; the template is unchanged.
    store.setDraft("q2", "held on q2");
    expect(submit(panel, deps)).toBe(true);
    expect(panel.footerFlash?.text).toBe(
      "nothing to submit — 2 question(s) have drafts awaiting an option or Other",
    );
    expect(sendMessage).not.toHaveBeenCalled(); // still nothing user-shipped

    // The count EXCLUDES text questions: an ANSWERED text question's held
    // store draft is skipped by reconcile (its answer committed at enter)
    // and is never "awaiting an option or Other".
    const state2 = seed([
      { id: "t1", overrides: { type: "text", options: undefined } },
      { id: "q1" },
    ]);
    state2.applyAnswer("t1", { value: "first", at: T0 });
    const store2 = new DraftStore();
    const { panel: p2 } = makePanel(state2, { drafts: store2 });
    const deps2 = makeDeps(true);
    expect(submit(p2, deps2.deps)).toBe(true); // baseline holds t1 answered
    store2.setDraft("t1", "held edit"); // answered text → skipped, not counted
    store2.setDraft("q1", "held choice");
    expect(submit(p2, deps2.deps)).toBe(true);
    expect(p2.footerFlash?.text).toBe(
      "nothing to submit — 1 question(s) have drafts awaiting an option or Other",
    );
  });
});

// ----------- AUTOSUBMIT-001 completeness hook (PRD h2.33, P2.M1.T1.S1)

describe("maybeAutoSubmit — completeness hook", () => {
  test("test_auto_last_open_accept_fires_submit_once_flash_epoch", () => {
    // The LAST open question is answered → the submission ships with no
    // further keypress: one sendMessage, verbatim flash, epoch 1→2.
    const state = seed([{ id: "q1", overrides: { recommendation: "a" } }]);
    const { deps, sendMessage } = makeDeps(true);
    const { panel } = makePanel(state, { delivery: deps });
    const epochBefore = state.epoch; // 1
    panel.currentId = "q1";
    panel.cursorIndex = 0;

    expect(accept(panel)).toBe(true);

    // EXACT submit pipeline, exactly once: one delivery, one epoch bump,
    // markSubmitted flushed the pending answer.
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(state.epoch).toBe(epochBefore + 1);
    expect(state.getQuestion("q1")?.status).toBe("submitted");
    // Verbatim h2.33 flash — literal "answer(s)", n captured before submit.
    expect(panel.footerFlash?.text).toBe("submitted — 1 answer(s)");
  });

  test("test_auto_multi_pending_ships_all_pending_in_one_firing", () => {
    // q1 answered earlier, q2 answered now → ONE firing ships BOTH pending
    // answers; the flash counts the whole pending set, not the last commit.
    const state = seed([
      { id: "q1", overrides: { status: "answered" } },
      { id: "q2" },
    ]);
    const { deps, sendMessage } = makeDeps(true);
    const { panel } = makePanel(state, { delivery: deps });
    panel.currentId = "q2";
    panel.cursorIndex = 0;

    expect(accept(panel)).toBe(true);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(panel.footerFlash?.text).toBe("submitted — 2 answer(s)");
    expect(state.epoch).toBe(2);
  });

  test("test_auto_edit_of_answered_on_complete_set_fires_again", () => {
    // One submission per commit: the FIRST complete-set commit fires; a
    // later edit of an already-submitted answer on the (still) complete set
    // fires AGAIN — each firing is a full submission (h2.41).
    const state = seed(BASIC);
    const { deps, sendMessage } = makeDeps(true);
    const { panel } = makePanel(state, { delivery: deps });
    panel.currentId = "q1";
    panel.cursorIndex = 0;

    accept(panel); // q1 answered, q2 still open → NO firing
    expect(sendMessage).not.toHaveBeenCalled();

    accept(panel); // last open answered → fires with BOTH pending
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(state.epoch).toBe(2);
    expect(panel.footerFlash?.text).toBe("submitted — 2 answer(s)");

    // Edit q1 (submitted → ripple seam passes on the default no-op seam):
    // re-answer, set stays complete (q2 submitted, q1 answered) → 2nd firing.
    panel.currentId = "q1"; // setter re-seeds the cursor to the ★ "a" preselect
    panel.cursorIndex = 1; // propose "b"
    accept(panel);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(state.epoch).toBe(3); // +1 per firing
    expect(panel.footerFlash?.text).toBe("submitted — 1 answer(s)"); // only q1 pending now
  });

  test("test_auto_consecutive_edits_each_one_submission_one_epoch_bump", () => {
    // FR-D4 epoch lock (h2.41): N consecutive edit commits on a complete
    // set → N full submissions, EACH bumping epoch exactly once via
    // buildSubmission's takeSnapshot + bumpEpoch — never batched, never
    // skipped. The `epoch-bumped` event fires exactly once per firing,
    // carrying the post-bump value (n = 2, 3, 4, 5).
    const state = seed(BASIC);
    const { deps, sendMessage } = makeDeps(true);
    const { panel } = makePanel(state, { delivery: deps });
    const bumped: number[] = [];
    const onBumped = (epoch: number): void => {
      bumped.push(epoch);
    };
    state.on("epoch-bumped", onBumped);

    panel.currentId = "q1";
    panel.cursorIndex = 0;
    accept(panel); // q1 answered, q2 still open → NO firing
    accept(panel); // set completes → firing 1 ships BOTH pending
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(state.epoch).toBe(2);
    expect(state.snapshots).toHaveLength(1);

    // Three consecutive edits of already-submitted answers; the set stays
    // complete throughout, so every commit tail fires (h2.33 trade-off:
    // each deliberate edit costs one model turn).
    const edits: Array<{ id: string; index: number }> = [
      { id: "q1", index: 1 }, // "a" → "b"
      { id: "q2", index: 1 }, // "a" → "b"
      { id: "q1", index: 0 }, // "b" → "a" (changed vs the last snapshot)
    ];
    for (const [i, edit] of edits.entries()) {
      panel.currentId = edit.id; // setter re-seeds the cursor to the ★ preselect
      panel.cursorIndex = edit.index;
      accept(panel);

      // Per iteration: exactly ONE new submission — one delivery, one
      // epoch bump, one snapshot, one flash counting only the edited
      // answer (it was the sole pending id at commit time).
      expect(sendMessage).toHaveBeenCalledTimes(2 + i);
      expect(state.epoch).toBe(3 + i);
      expect(state.snapshots).toHaveLength(2 + i);
      expect(panel.footerFlash?.text).toBe("submitted — 1 answer(s)");
    }

    // Totals: 1 complete-set firing + 3 edit firings = 4 submissions.
    expect(sendMessage).toHaveBeenCalledTimes(4);
    expect(state.epoch).toBe(5); // epoch 1 + exactly +1 per firing
    expect(state.snapshots).toHaveLength(4);
    // `epoch-bumped` emitted ONCE per firing with the post-bump value.
    expect(bumped).toEqual([2, 3, 4, 5]);
    state.off("epoch-bumped", onBumped);
    panel.dispose(); // flash timers armed → dispose per harness convention
  });

  test("test_resume_pending_panel_one_ctrl_s_flushes_once", () => {
    // h2.39 suspended-mid-delivery resume (modeled as STATE shape — never a
    // live TUI, AUTOMATION-POLICY): the user suspended between the last
    // commit and delivery; /interrogate reopens to a COMPLETE set holding
    // pending (answered) answers, zero open/reasked — the exact
    // post-suspend pre-delivery shape. ONE ctrl+s (submit(), the keys.ts
    // binding with host-pre-bound deps) ships ALL pending answers in a
    // single submission: one delivery, one epoch bump, one snapshot — no
    // interim partial ships.
    const state = seed([
      { id: "q1", overrides: { status: "answered" } }, // pending across suspend
      { id: "q2", overrides: { status: "answered" } }, // pending across suspend
    ]);
    const { deps, sendMessage } = makeDeps(true);
    const { panel } = makePanel(state, { delivery: deps });
    const epochBefore = state.epoch; // 1
    const bumps: number[] = [];
    const onBumped = (epoch: number): void => {
      bumps.push(epoch);
    };
    state.on("epoch-bumped", onBumped);

    expect(submit(panel, deps)).toBe(true);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(bumps).toEqual([epochBefore + 1]); // ONE bump, new value carried
    expect(state.epoch).toBe(epochBefore + 1);
    expect(state.getQuestion("q1")?.status).toBe("submitted");
    expect(state.getQuestion("q2")?.status).toBe("submitted");
    expect(state.snapshots).toHaveLength(1);
    state.off("epoch-bumped", onBumped);
    panel.dispose();
  });

  test("test_resume_pending_panel_new_commit_flushes_once", () => {
    // The alternative h2.39 flush path: same post-suspend pending shape,
    // but the user answers instead of pressing ctrl+s — the commit tail's
    // maybeAutoSubmit fires ONCE and ships the WHOLE pending set. The flash
    // counts every pending answer captured BEFORE submit (h2.33), not just
    // the freshly edited question.
    const state = seed([
      { id: "q1", overrides: { status: "answered" } }, // pending across suspend
      { id: "q2", overrides: { status: "answered" } }, // pending across suspend
    ]);
    const { deps, sendMessage } = makeDeps(true);
    const { panel } = makePanel(state, { delivery: deps });
    const bumps: number[] = [];
    const onBumped = (epoch: number): void => {
      bumps.push(epoch);
    };
    state.on("epoch-bumped", onBumped);

    panel.currentId = "q1"; // setter re-seeds the cursor to the ★ "a" preselect
    panel.cursorIndex = 1; // edit the pending answer → "b"

    expect(accept(panel)).toBe(true);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(bumps).toEqual([2]); // one commit-tail firing = one bump
    expect(state.epoch).toBe(2);
    expect(panel.footerFlash?.text).toBe("submitted — 2 answer(s)"); // q1+q2, not just the edit
    expect(state.getQuestion("q1")?.status).toBe("submitted");
    expect(state.getQuestion("q2")?.status).toBe("submitted");
    expect(state.snapshots).toHaveLength(1);
    state.off("epoch-bumped", onBumped);
    panel.dispose();
  });

  test("test_auto_incomplete_set_never_fires", () => {
    // A commit while any open question remains: no submit, no flash.
    const state = seed(BASIC);
    const { deps, sendMessage } = makeDeps(true);
    const { panel } = makePanel(state, { delivery: deps });
    panel.currentId = "q1";
    panel.cursorIndex = 0;

    accept(panel); // q2 still open

    expect(sendMessage).not.toHaveBeenCalled();
    expect(panel.footerFlash).toBeUndefined();
    expect(state.epoch).toBe(1); // no bump
    expect(state.snapshots).toHaveLength(0); // no snapshot
  });

  test("test_auto_reasked_question_blocks_the_firing", () => {
    // nextUnanswered parity: `reasked` counts as unanswered, exactly like
    // `open` — a re-asked question keeps the set incomplete.
    const state = seed([{ id: "q1" }, { id: "q2", overrides: { status: "reasked" } }]);
    const { deps, sendMessage } = makeDeps(true);
    const { panel } = makePanel(state, { delivery: deps });
    panel.currentId = "q1";
    panel.cursorIndex = 0;

    accept(panel);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(panel.footerFlash).toBeUndefined();
    expect(state.epoch).toBe(1);
  });

  test("test_auto_zero_pending_complete_set_noops_silently", () => {
    // All submitted, nothing answered: complete AND zero pending — the
    // zero-pending guard no-ops BEFORE submit: no flash, no pipeline.
    const state = seed([
      { id: "q1", overrides: { status: "submitted" } },
      { id: "q2", overrides: { status: "submitted" } },
    ]);
    const { deps, sendMessage } = makeDeps(true);
    const { panel } = makePanel(state, { delivery: deps });
    const epochBefore = state.epoch;

    expect(() => maybeAutoSubmit(panel, deps)).not.toThrow();
    expect(panel.footerFlash).toBeUndefined(); // silent — no "nothing to submit" either
    expect(sendMessage).not.toHaveBeenCalled();
    expect(state.epoch).toBe(epochBefore);
    expect(state.snapshots).toHaveLength(0);
  });

  test("test_auto_no_delivery_surface_noops_without_throwing", () => {
    // Headless/test panels have no panel.delivery and the commit tails pass
    // no deps arg — the hook must no-op, not throw (the commit itself lands).
    const state = seed([{ id: "q1" }]);
    const { panel } = makePanel(state); // NO delivery arg
    panel.currentId = "q1";
    panel.cursorIndex = 0;

    expect(() => accept(panel)).not.toThrow();

    expect(panel.footerFlash).toBeUndefined();
    expect(state.epoch).toBe(1); // submit skipped
    expect(state.getQuestion("q1")?.status).toBe("answered"); // commit still applied
  });

  test("test_auto_text_enter_via_writein_duty_fires", () => {
    // A TEXT question is answered through write-in duty (desiredTextDuty:
    // text questions enter "writein") — enter commits and auto-submits.
    const state = seed([{ id: "t1", overrides: { type: "text", options: undefined } }]);
    const { deps, sendMessage } = makeDeps(true);
    const { panel } = makePanel(state, { delivery: deps });
    panel.currentId = "t1";
    panel.focusTextField("writein");
    panel.textField.setText("my textual answer");

    expect(panel.handleInput("\r")).toBe(true); // write-in enter → direct commit branch

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(panel.footerFlash?.text).toBe("submitted — 1 answer(s)");
    expect(state.getQuestion("t1")?.answer?.value).toBe("my textual answer");
    expect(state.getQuestion("t1")?.status).toBe("submitted");
    expect(state.epoch).toBe(2);
  });

  test("test_auto_empty_buffer_writein_exit_never_fires", () => {
    // The empty-buffer exit is a DRAFT save (h2.32: nothing answered) — the
    // hook must not live on that branch: no submit, no flash.
    const state = seed([{ id: "q1" }]);
    const { deps, sendMessage } = makeDeps(true);
    const { panel } = makePanel(state, { delivery: deps, drafts: new DraftStore() });
    panel.currentId = "q1";
    panel.cursorIndex = 2; // ✎ Other row
    accept(panel); // → write-in duty
    panel.textField.setText("");

    expect(panel.handleInput("\r")).toBe(true);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(panel.footerFlash).toBeUndefined();
    expect(state.getQuestion("q1")?.status).toBe("open"); // nothing committed
  });

  test("test_auto_held_batch_note_rides_the_auto_submission", () => {
    // R3: the held batch note rides ANY submission, auto-fired included —
    // it ships as the NOTE line and is cleared after delivery.
    const state = seed([{ id: "q1" }]);
    const { deps, sendMessage } = makeDeps(true);
    const { panel } = makePanel(state, { delivery: deps });
    panel.batchNote = "typed before the last answer";
    panel.currentId = "q1";
    panel.cursorIndex = 0;

    expect(accept(panel)).toBe(true);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const msg = sendMessage.mock.calls[0][0] as { content: string; details: { note?: string } };
    expect(msg.content).toContain("NOTE: typed before the last answer");
    expect(msg.details.note).toBe("typed before the last answer");
    expect(panel.batchNote).toBe(""); // cleared after shipping (h2.32)
  });
});

// -------- maybeAutoSubmit gate hold (AUTOSUBMIT-002, P2.M1.T2.S1, AC-2d)

describe("maybeAutoSubmit — gate hold (AUTOSUBMIT-002, AC-2d)", () => {
  /**
   * Hold fixture: the gate group's g1 is UNANSWERED but no longer
   * open/reasked (agent-settled `closed`, answer reset) — the exact
   * "gate question unanswered, otherwise-complete set" shape of AC-2d.
   * countUnansweredGate counts answer-undefined non-terminal (not
   * withdrawn/moot) gate questions, while the T1.S1 completeness
   * predicate only blocks open/reasked — so the set passes completeness
   * and reaches the P2.M1.T2.S1 hold check with n = 1.
   *
   * Since the BUG-001 reorder this fixture is no longer the ONLY path to
   * the hold: maybeAutoSubmit now computes the gate count BEFORE the
   * completeness return, so the canonical OPEN-gate flow (g1 open, user
   * committing later-group answers) arms the same hold line — pinned by
   * test_auto_open_gate_question_arms_hold_line_no_submit below. These
   * closed-no-answer tests keep passing unchanged: the path reaches the
   * SAME n > 0 && pending > 0 condition, just more reachable.
   */
  const HOLD_FIXTURE: Array<{ id: string; overrides?: Partial<Question> }> = [
    { id: "g1", overrides: { group: "foundation", gate: true, status: "closed" } },
    { id: "g2", overrides: { group: "foundation", status: "answered" } },
    { id: "n1", overrides: { group: "later", recommendation: "a" } },
  ];

  function commitLast(handle: PanelHandle): boolean {
    handle.panel.currentId = "n1";
    handle.panel.cursorIndex = 0;
    return accept(handle.panel); // the commit tail runs maybeAutoSubmit
  }

  test("test_auto_gate_hold_withholds_commit_and_shows_exact_line", () => {
    // AC-2d withhold: a commit on an otherwise-complete set with an
    // unanswered gate question arms the commit-time hold line (FR-D5
    // verbatim, config-resolved label) and ships NOTHING: no sendMessage,
    // no auto-submit flash, no epoch bump.
    const state = seed(HOLD_FIXTURE);
    const { deps, sendMessage } = makeDeps(true);
    const { panel } = makePanel(state, { delivery: deps });
    const epochBefore = state.epoch; // 1

    expect(commitLast({ panel, requestRender: vi.fn() })).toBe(true); // commit lands

    expect(sendMessage).not.toHaveBeenCalled(); // withheld
    expect(panel.footerFlash?.text).toBeUndefined(); // no flash on the hold path
    expect(state.epoch).toBe(epochBefore);
    expect(panel.gateWarning).toEqual({ count: 1, kind: "hold", submitLabel: "Ctrl+S" });
    // The rendered footer-adjacent line is the EXACT hold string.
    const lines = panel.render(80);
    expect(lines[lines.length - 2]).toBe(
      "  ⚠ 1 foundational unanswered — answer them or Ctrl+S to submit now",
    );
  });

  test("test_auto_answering_gate_releases_next_commit_auto_submit", () => {
    // AC-2d release: once the gate question is answered, the next commit's
    // auto-submit fires — one sendMessage, verbatim flash, epoch +1.
    const state = seed(HOLD_FIXTURE);
    const { deps, sendMessage } = makeDeps(true);
    const { panel } = makePanel(state, { delivery: deps });

    expect(commitLast({ panel, requestRender: vi.fn() })).toBe(true);
    expect(panel.gateWarning?.kind).toBe("hold"); // held first

    // The user answers the gate question (agent re-opened it; seeded via
    // the raw applyAnswer primitive) → the set is truly complete.
    state.applyAnswer("g1", { value: "a", at: T0 });
    maybeAutoSubmit(panel, deps); // the next commit tail fires the same hook

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(panel.footerFlash?.text).toBe("submitted — 3 answer(s)");
    expect(state.epoch).toBe(2);
  });

  test("test_auto_ctrl_s_override_delivers_and_swaps_to_legacy_warning", () => {
    // AC-2d override: with the hold line armed, the deliberate submit-path
    // keypress (submit(), unchanged) delivers ANYWAY (h2.56 soft gate) and
    // overwrites the hold line with the legacy submit-time warning.
    const state = seed(HOLD_FIXTURE);
    const { deps, sendMessage } = makeDeps(true);
    const { panel } = makePanel(state, { delivery: deps });

    expect(commitLast({ panel, requestRender: vi.fn() })).toBe(true);
    expect(panel.gateWarning?.kind).toBe("hold");

    expect(submit(panel, deps)).toBe(true);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(state.epoch).toBe(2);
    expect(panel.gateWarning).toEqual({ count: 1, kind: "submit" });
    // The legacy string follows per existing behavior — a different string
    // from the hold line, by design (h2.33).
    expect(panel.render(80).join("\n")).toContain("later answers may shift");
  });

  test("test_auto_nongate_open_skip_stays_completely_silent", () => {
    // h2.58 pin: an ordinary skip — a NON-gate question still open — gets
    // NO warning of any kind: the completeness return fires BEFORE the
    // gate check.
    const state = seed([
      { id: "g1", overrides: { group: "foundation", gate: true, status: "answered" } },
      { id: "g2", overrides: { group: "foundation", status: "answered" } },
      { id: "n1", overrides: { group: "later" } }, // still open
    ]);
    const { deps, sendMessage } = makeDeps(true);
    const { panel } = makePanel(state, { delivery: deps });

    maybeAutoSubmit(panel, deps);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(panel.gateWarning).toBeNull();
    expect(panel.footerFlash?.text).toBeUndefined();
  });

  test("test_auto_open_gate_question_arms_hold_line_no_submit", () => {
    // BUG-001 fix — the canonical AC-2d flow: the gate question itself is
    // still OPEN while later-group answers exist. maybeAutoSubmit computes
    // the gate count BEFORE the completeness return, so the hold line arms
    // and nothing ships (previously dead code: the completeness return
    // fired first and the user got no feedback).
    const state = seed([
      { id: "g1", overrides: { group: "foundation", gate: true } }, // open
      { id: "g2", overrides: { group: "foundation", status: "answered" } },
      { id: "n1", overrides: { group: "later", status: "answered" } },
    ]);
    const { deps, sendMessage } = makeDeps(true);
    const { panel } = makePanel(state, { delivery: deps });
    const epochBefore = state.epoch;

    maybeAutoSubmit(panel, deps);

    expect(sendMessage).not.toHaveBeenCalled(); // withheld
    expect(state.epoch).toBe(epochBefore); // no submission
    expect(panel.footerFlash?.text).toBeUndefined(); // no flash on the hold path
    expect(panel.gateWarning).toEqual({ count: 1, kind: "hold", submitLabel: "Ctrl+S" });
    // The rendered footer-adjacent line is the EXACT hold string.
    expect(panel.render(80).join("\n")).toContain(
      "⚠ 1 foundational unanswered — answer them or Ctrl+S to submit now",
    );
  });

  test("test_auto_gate_unanswered_zero_pending_stays_silent", () => {
    // Zero-pending silence (BUG-001 reorder guard): the hold arms only when
    // something was actually committed (pending > 0). A bare maybeAutoSubmit
    // call with the gate question unanswered and NOTHING answered must arm
    // no line — n > 0 but pending === 0 falls through both returns silently.
    const state = seed([
      { id: "g1", overrides: { group: "foundation", gate: true } }, // open
      { id: "n1", overrides: { group: "later" } }, // open, never answered
    ]);
    const { deps, sendMessage } = makeDeps(true);
    const { panel } = makePanel(state, { delivery: deps });

    maybeAutoSubmit(panel, deps);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(panel.gateWarning).toBeNull();
    expect(panel.footerFlash?.text).toBeUndefined();
  });

  test("test_auto_gate_hold_respects_gateWarnings_false_silent_withhold", () => {
    // config.gateWarnings off ⇒ the hold withholds SILENTLY: no line, no
    // delivery, no flash (the display toggle governs both gate strings).
    const state = seed(HOLD_FIXTURE);
    const config = { ...DEFAULT_CONFIG, gateWarnings: false } as InterrogatorConfig;
    const { deps, sendMessage } = makeDeps(true);
    const { panel } = makePanel(state, { delivery: deps }, config);

    expect(commitLast({ panel, requestRender: vi.fn() })).toBe(true);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(panel.gateWarning).toBeNull();
    expect(panel.footerFlash?.text).toBeUndefined();
  });

  test("test_auto_gate_hold_label_follows_remapped_submit_key", () => {
    // h2.52: the hold line names the CONFIG-RESOLVED submit label — with
    // keys.submit remapped, Ctrl+Enter surfaces, never the default chord.
    const state = seed(HOLD_FIXTURE);
    const config = {
      ...DEFAULT_CONFIG,
      keys: { ...DEFAULT_CONFIG.keys, submit: "ctrl+enter" },
    } as InterrogatorConfig;
    const { deps } = makeDeps(true);
    const { panel } = makePanel(state, { delivery: deps }, config);

    expect(commitLast({ panel, requestRender: vi.fn() })).toBe(true);

    expect(panel.gateWarning).toEqual({ count: 1, kind: "hold", submitLabel: "Ctrl+Enter" });
    expect(panel.render(80).join("\n")).toContain("answer them or Ctrl+Enter to submit now");
  });
});

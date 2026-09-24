/**
 * src/panel/two-stage.test.ts — Mode A two-stage enter contract tests
 * (P1.M4.T1.S2, h2.31 Q17=A / FR-12).
 *
 * Conventions follow panel.test.ts / actions.test.ts (AUTOMATION-POLICY: no
 * live pi session — everything is vitest-assertable): a bare stub theme +
 * TUI, real InterrogationStates seeded through the raw primitives, vi.fn()
 * spies for the DraftStore + keys seams, and a stateful fake composed editor
 * driven with RAW terminal byte strings ("\r" plain enter, "\x1b[13;2u"
 * kitty shift+enter, "\x1b[13;2~" xterm shift+enter, "\n" ctrl+j, "\x1b\r"
 * alt+enter, "\x1b[13u" kitty plain enter) so terminal realities are
 * covered, never abstracted away.
 *
 * Two panel flavors per the seam contract (args.keys REPLACES the router
 * wholesale): the default flavor keeps the REAL config-driven router (so
 * ctrl+t / tab navigation / enter→accept behave like production), and the
 * keys-spy flavor exists only to assert dispatch ORDERING (stage checks run
 * before the seam). The fake editor's handleInput mirrors the stock Editor's
 * behavior for the sequences under test (newline sequences insert a line
 * break; printable chars insert) so multi-line flows are exercised end to
 * end WITHOUT the stock editor's destructive submitValue() ever being a
 * factor — exactly the property panel-level stage-1 interception guarantees.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { EditorComponent, TUI } from "@earendil-works/pi-tui";
import { describe, expect, test, vi, type Mock } from "vitest";
import { DEFAULT_CONFIG, type InterrogatorConfig } from "../config.js";
import { createInterrogationState, type InterrogationState, type Question } from "../state.js";
import type { DraftStore, InterrogationPanelArgs } from "./panel.js";
import { InterrogationPanel } from "./panel.js";

// ------------------------------------------------------------------ fixtures

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

/** Seed a state where every question starts open (upsert raw primitive). */
function seedOpen(ids: string[]): InterrogationState {
  const state = createInterrogationState("goal");
  for (const id of ids) state.upsertQuestion(choiceQ(id));
  return state;
}

/**
 * EXPLAIN-003: text-question variant — the two-stage advance arms ONLY on
 * text questions (the draft completes the answer); choice-question arming
 * tests below seed with this.
 */
function seedOpenText(ids: string[]): InterrogationState {
  const state = createInterrogationState("goal");
  for (const id of ids) state.upsertQuestion({ ...choiceQ(id), type: "text", options: undefined });
  return state;
}

/** Fresh DraftStore seam spy (P1.M4.T2.S1 lands the real one). */
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

/**
 * Stateful fake composed editor — the structural contract pi-vim etc.
 * satisfies (plain literal implementing EditorComponent), with newline
 * insertion mirroring the stock Editor for the sequences under test and an
 * addToHistory spy so history isolation (h2.31) is assertable.
 */
function fakeEditor(): EditorComponent & { handleInput: Mock; addToHistory: Mock } {
  let lines: string[] = [""];
  let line = 0;
  let col = 0;
  const insertNewline = (): void => {
    const current = lines[line] ?? "";
    lines.splice(line + 1, 0, current.slice(col));
    lines[line] = current.slice(0, col);
    line++;
    col = 0;
  };
  return {
    getText: vi.fn(() => lines.join("\n")),
    getExpandedText: vi.fn(() => lines.join("\n")),
    setText: vi.fn((t: string) => {
      lines = t.split("\n");
      line = lines.length - 1;
      col = lines[line]?.length ?? 0;
    }),
    handleInput: vi.fn((data: string) => {
      // Newline sequences (stock-editor semantics): ctrl+j "\n", alt+enter
      // "\x1b\r", kitty/xterm shift+enter CSI sequences.
      if (data === "\n" || data === "\x1b\r" || data.startsWith("\x1b[13")) {
        insertNewline();
        return;
      }
      // A lone ESC is a parsed-but-unbound key for the stock Editor — it is
      // dropped, never inserted (ESC-002 now forwards single escs here, so
      // the fake must mirror that instead of naively inserting the byte).
      if (data === "\u001b") return;
      for (const ch of data) {
        const cur = lines[line] ?? "";
        lines[line] = cur.slice(0, col) + ch + cur.slice(col);
        col++;
      }
    }),
    render: vi.fn(() => lines.map((l) => `|${l}`)),
    focused: false,
    addToHistory: vi.fn(),
  } as unknown as EditorComponent & { handleInput: Mock; addToHistory: Mock };
}

interface Handle {
  panel: InterrogationPanel;
  editor: ReturnType<typeof fakeEditor>;
  drafts: ReturnType<typeof draftsSpy>;
  /** Defined ONLY in the keys-spy flavor (real-router flavor: undefined). */
  keys?: Mock;
}

/**
 * Panel with full seams. `keysSpy` swaps the config router for a
 * consumes-nothing vi.fn — use it ONLY for dispatch-ordering assertions and
 * drive focus through panel.focusTextField() directly.
 */
function makePanel(state: InterrogationState, keysSpy = false): Handle {
  const editor = fakeEditor();
  const drafts = draftsSpy();
  const requestRender = vi.fn();
  const extra: Partial<InterrogationPanelArgs> = keysSpy ? { keys: vi.fn(() => false) } : {};
  const panel = new InterrogationPanel({
    tui: { requestRender } as unknown as TUI,
    theme: stubTheme,
    done: () => {},
    state,
    config: DEFAULT_CONFIG,
    drafts,
    editorFactory: () => editor,
    ...extra,
  });
  return { panel, editor, drafts, keys: extra.keys as Mock | undefined };
}

/** Focus the embedded editor through the real router seam (ctrl+t). */
function focusText(panel: InterrogationPanel): void {
  panel.handleInput("\u0014");
}

// ------------------------------------------------------------------- tests

describe("two-stage enter — stage 1 save, stage 2 advance (h2.31)", () => {
  test("test_stage1_enter_saves_draft_blurs_and_arms", () => {
    // EXPLAIN-003: arming is TEXT-question behavior (the draft completes
    // the answer there).
    const state = seedOpenText(["q1", "q2"]);
    const { panel, drafts } = makePanel(state);
    focusText(panel);
    panel.handleInput("my explanation");
    expect(panel.advanceArmed).toBe(false);

    expect(panel.handleInput("\r")).toBe(true); // stage 1

    expect(drafts.setDraft).toHaveBeenCalledTimes(1);
    expect(drafts.setDraft).toHaveBeenCalledWith("q1", "my explanation");
    expect(panel.focus).toBe("options");
    expect(panel.textField.focused).toBe(false);
    expect(panel.advanceArmed).toBe(true);
    // Editor content preserved verbatim (no stock submitValue empty/trim).
    expect(panel.textField.getText()).toBe("my explanation");
    // Stage 1 does NOT advance and does NOT select an option.
    expect(panel.currentId).toBe("q1");
    expect(state.getQuestion("q1")?.status).toBe("open");
    expect(state.getQuestion("q1")?.answer).toBeUndefined();
  });

  test("test_stage2_enter_advances_to_next_unanswered_and_consumes_flag", () => {
    const state = seedOpenText(["q1", "q2", "q3"]);
    const { panel, keys } = makePanel(state, true);
    panel.focusTextField();
    panel.handleInput("draft q1");
    panel.handleInput("\r"); // stage 1: arm

    expect(panel.handleInput("\r")).toBe(true); // stage 2: advance

    expect(panel.advanceArmed).toBe(false); // consumed exactly once
    expect(panel.currentId).toBe("q2"); // next unanswered (h2.38 scan)
    // No option was selected by the advance — statuses untouched.
    expect(state.getQuestion("q1")?.status).toBe("open");
    expect(state.getQuestion("q2")?.status).toBe("open");
    // Stage 2 intercepted BEFORE the keys seam (the armed enter never
    // reaches the router's enter→accept interception; typed chars above DID
    // pass through the seam, the "\r" must not).
    expect(keys).not.toHaveBeenCalledWith("\r", panel);
  });

  test("test_enter_after_stage2_is_normal_accept_again", () => {
    const state = seedOpenText(["q1", "q2"]);
    const { panel } = makePanel(state);
    panel.focusTextField();
    panel.handleInput("draft");
    panel.handleInput("\r"); // stage 1
    panel.handleInput("\r"); // stage 2 → q2

    // Third consecutive enter: flag is gone → normal router accept path.
    // On a TEXT question accept is the consumed no-op seam (the answer is
    // the draft — nothing to select).
    expect(panel.handleInput("\r")).toBe(true);
    expect(panel.advanceArmed).toBe(false);
    expect(panel.currentId).toBe("q2");
    expect(state.getQuestion("q2")?.status).toBe("open");
    expect(state.getQuestion("q2")?.answer).toBeUndefined();
  });

  test("test_stage1_on_choice_question_does_not_arm_next_enter_accepts", () => {
    // EXPLAIN-003 (the reported bug): explain → enter → enter on a CHOICE
    // question must ANSWER the highlighted option — the old armed stage-2
    // advance skipped the question unanswered, leaving nothing submittable.
    const state = seedOpen(["q1", "q2"]);
    const { panel, drafts } = makePanel(state);
    // WRITEIN-001: the ✎ Other row now opens the WRITE-IN editor (accept →
    // commit duty), so the elaboration editor opens via ctrl+t's focus path.
    panel.focusTextField(); // elaboration duty (default) — the two-stage stage-1 path
    panel.handleInput("my elaboration");
    expect(panel.handleInput("\r")).toBe(true); // stage 1: save + blur

    expect(panel.focus).toBe("options");
    expect(panel.advanceArmed).toBe(false); // NOT armed on choice questions
    expect(drafts.setDraft).toHaveBeenCalledWith("q1", "my elaboration");
    // Cursor re-seeded ✎ → ★ preselect (index 0, option "a").
    expect(panel.cursorIndex).toBe(0);

    // The next enter is a NORMAL accept: ★ "a" selected, elaboration kept,
    // accept-advance moves on — the question is now answered + submittable.
    expect(panel.handleInput("\r")).toBe(true);
    expect(state.getQuestion("q1")?.status).toBe("answered");
    expect(state.getQuestion("q1")?.answer?.value).toBe("a");
    expect(panel.draftTextFor("q1")).toBe("my elaboration"); // attaches at submit
    expect(panel.currentId).toBe("q2"); // Q14 accept-advance
  });
});

describe("two-stage enter — one-shot disarm", () => {
  test("test_non_enter_key_disarms_and_next_enter_falls_through", () => {
    const state = seedOpenText(["q1", "q2"]);
    const { panel, keys } = makePanel(state, true);
    panel.focusTextField();
    panel.handleInput("\r"); // arm (empty draft, still saves "")
    expect(panel.advanceArmed).toBe(true);

    panel.handleInput("\x1b[A"); // arrow up — any non-enter input disarms
    expect(panel.advanceArmed).toBe(false);

    // The following enter is NOT stage 2: it falls through to the keys seam.
    panel.handleInput("\r");
    expect(keys).toHaveBeenCalledWith("\r", panel);
    expect(panel.currentId).toBe("q1"); // no advance happened
  });

  test("test_armed_enter_in_options_focus_survives_disarm_check_order", () => {
    const state = seedOpenText(["q1", "q2"]);
    const { panel } = makePanel(state, true);
    panel.focusTextField();
    panel.handleInput("\r"); // stage 1 arms — must NOT be disarmed by itself
    expect(panel.advanceArmed).toBe(true);
    panel.handleInput("\r"); // stage 2 still fires (disarm check skips enter)
    expect(panel.currentId).toBe("q2");
    expect(panel.advanceArmed).toBe(false);
  });
});

describe("two-stage enter — newline safety (R4)", () => {
  const NEWLINE_SEQUENCES: Array<[string, string]> = [
    ["kitty_shift_enter", "\x1b[13;2u"],
    ["xterm_shift_enter", "\x1b[13;2~"],
    ["ctrl_j", "\n"],
    ["alt_enter", "\x1b\r"],
  ];

  for (const [name, seq] of NEWLINE_SEQUENCES) {
    test(`test_${name}_inserts_newline_without_saving`, () => {
      const state = seedOpen(["q1", "q2"]);
      const { panel, editor, drafts } = makePanel(state);
      focusText(panel);
      panel.handleInput("line1");

      panel.handleInput(seq); // must fall through to the editor verbatim

      expect(editor.handleInput).toHaveBeenCalledWith(seq);
      panel.handleInput("line2"); // typing continues on the inserted line
      expect(panel.textField.getText()).toBe("line1\nline2");
      expect(panel.focus).toBe("text"); // no blur
      expect(panel.advanceArmed).toBe(false); // no arming
      expect(drafts.setDraft).not.toHaveBeenCalled(); // no save
      expect(panel.textField.focused).toBe(true);
    });
  }

  test("test_multiline_flow_shift_enter_then_enter_saves_both_lines", () => {
    const state = seedOpen(["q1", "q2"]);
    const { panel, drafts } = makePanel(state);
    focusText(panel);
    panel.handleInput("line1");
    panel.handleInput("\x1b[13;2u"); // shift+enter → newline in the editor
    panel.handleInput("line2");
    expect(panel.textField.getText()).toBe("line1\nline2");

    panel.handleInput("\r"); // stage 1 saves the full multi-line draft

    expect(drafts.setDraft).toHaveBeenCalledWith("q1", "line1\nline2");
    expect(panel.focus).toBe("options");
  });

  test("test_kitty_plain_enter_is_stage1_not_newline", () => {
    // parseKey resolves "\x1b[13u" (kitty CSI-u plain enter) to "enter" —
    // it MUST stage-save, not insert a newline.
    const state = seedOpenText(["q1", "q2"]);
    const { panel, drafts } = makePanel(state);
    panel.focusTextField();
    panel.handleInput("kitty draft");

    panel.handleInput("\x1b[13u");

    expect(drafts.setDraft).toHaveBeenCalledWith("q1", "kitty draft");
    expect(panel.advanceArmed).toBe(true);
    expect(panel.focus).toBe("options");
  });

  test("test_ctrl_j_while_armed_disarms_rather_than_advancing", () => {
    const state = seedOpen(["q1", "q2"]);
    const { panel } = makePanel(state, true);
    panel.focusTextField();
    panel.handleInput("\r"); // arm
    panel.handleInput("\n"); // ctrl+j is a newline request, not stage 2
    expect(panel.advanceArmed).toBe(false);
    expect(panel.currentId).toBe("q1");
  });
});

describe("two-stage enter — note mode (R3)", () => {
  test("test_enter_in_note_focus_saves_note_and_exits_without_arming", () => {
    const state = seedOpen(["q1"]);
    const { panel, drafts } = makePanel(state);
    panel.textField.setText("batch note text");
    panel.focus = "note"; // P1.M4.T2.S2 owns the ctrl+shift+m open path

    expect(panel.handleInput("\r")).toBe(true);

    expect(drafts.setNote).toHaveBeenCalledTimes(1);
    expect(drafts.setNote).toHaveBeenCalledWith("batch note text");
    expect(panel.batchNote).toBe("batch note text");
    expect(panel.focus).toBe("options"); // note mode exited
    expect(panel.textField.focused).toBe(false);
    expect(panel.advanceArmed).toBe(false); // a note is NOT a question answer
    expect(drafts.setDraft).not.toHaveBeenCalled();
  });

  test("test_note_enter_never_reaches_router_accept", () => {
    const state = seedOpen(["q1"]);
    const { panel, keys } = makePanel(state, true);
    panel.focus = "note";
    panel.handleInput("\r");
    // The router would read enter in non-text focus as options accept —
    // stage-1 interception must run first.
    expect(keys).not.toHaveBeenCalled();
  });

  test("test_note_draft_survives_esc_exit_and_reseeds_on_reentry", () => {
    // h2.32 + FR-16: esc exits note mode WITHOUT destroying the draft —
    // exit writes through to the store, and re-entry re-seeds from it.
    const state = seedOpen(["q1"]);
    const { panel, drafts } = makePanel(state);
    panel.enterNoteMode(); // ctrl+shift+m open path (P1.M4.T2.S2)
    expect(panel.focus).toBe("note");
    expect(panel.textField.focused).toBe(true);
    panel.textField.setText("cross-cutting context");

    // ESC-002: single esc forwards to the (composed) editor; the esc-esc
    // PAIR exits note mode — write-through, no view descent, no suspend.
    panel.handleInput("\u001b");
    expect(panel.focus).toBe("note"); // still in the editor after one esc
    panel.handleInput("\u001b"); // second esc in a row — note exit

    expect(panel.focus).toBe("options");
    expect(panel.batchNote).toBe("cross-cutting context"); // write-through
    expect(drafts.setNote).toHaveBeenCalledWith("cross-cutting context");
    expect(panel.advanceArmed).toBe(false); // esc never arms the advance

    // Re-open (e.g. after suspend/resume): the store copy wins the seed.
    drafts.getNote.mockReturnValue("cross-cutting context");
    panel.enterNoteMode();
    expect(panel.focus).toBe("note");
    expect(panel.textField.getText()).toBe("cross-cutting context");
  });

  test("test_ctrl_shift_m_repress_exits_note_mode_preserving_draft", () => {
    const state = seedOpen(["q1"]);
    const { panel, drafts } = makePanel(state);
    panel.enterNoteMode();
    panel.textField.setText("kept");

    panel.handleInput("\u001b[109;6u"); // ctrl+shift+m re-press (kitty CSI-u)

    expect(panel.focus).toBe("options");
    expect(panel.batchNote).toBe("kept");
    expect(drafts.setNote).toHaveBeenCalledWith("kept");
  });

  test("test_unmatched_input_types_into_the_note_field", () => {
    // Note mode is the SAME editor on note duty: unmatched input forwards
    // to it exactly like text focus (only config intercepts are consumed).
    const state = seedOpen(["q1"]);
    const { panel, editor } = makePanel(state);
    panel.enterNoteMode();
    expect(panel.handleInput("x")).toBe(true);
    expect(editor.handleInput).toHaveBeenCalledWith("x");
  });
});

describe("two-stage enter — refocus seeding + draft survival", () => {
  test("test_refocus_after_stage1_reseeds_saved_draft", () => {
    const state = seedOpen(["q1", "q2"]);
    const { panel } = makePanel(state);
    focusText(panel);
    panel.handleInput("the draft");
    panel.handleInput("\r"); // stage 1 (buffer still holds the draft)
    expect(panel.focus).toBe("options");

    const seedSpy = vi.spyOn(panel.textField, "seed");
    panel.handleInput("\u0014"); // ctrl+t → focusTextField
    expect(seedSpy).toHaveBeenCalledWith("the draft");
    expect(panel.textField.getText()).toBe("the draft");
  });

  test("test_draft_slot_survives_navigation_and_reseeds_on_return", () => {
    const state = seedOpen(["q1", "q2"]);
    const { panel } = makePanel(state);
    focusText(panel);
    panel.handleInput("q1 draft");
    panel.handleInput("\r"); // stage 1 save on q1
    panel.handleInput("\r"); // stage 2 advance → q2

    // Navigate and return WITHOUT touching the slot map (R4: drafts survive
    // navigation; shift+tab/tab are the default nav accelerators — tab from
    // q2 clamps... no: tab = prevQuestion → back to q1).
    panel.handleInput("\t"); // tab = prevQuestion → q1
    expect(panel.currentId).toBe("q1");

    panel.handleInput("\u0014"); // refocus → seeded from the q1 slot
    expect(panel.textField.getText()).toBe("q1 draft");
  });

  test("test_cross_question_refocus_seeds_new_question_draft_not_stale_text", () => {
    const state = seedOpen(["q1", "q2"]);
    const { panel } = makePanel(state);
    focusText(panel);
    panel.handleInput("q1 draft");
    panel.handleInput("\r"); // stage 1 save on q1 (slot written)

    // Navigation keeps focus === "text" with a stale buffer — exactly what
    // seed-on-refocus repairs: q2 has no draft, so the field empties.
    panel.handleInput("\x1b[Z"); // shift+tab = nextQuestion → q2
    expect(panel.currentId).toBe("q2");
    panel.handleInput("\u0014"); // explicit refocus on q2
    expect(panel.textField.getText()).toBe(""); // never q1's leftover
  });
});

describe("two-stage enter — history isolation (h2.31)", () => {
  test("test_addToHistory_never_called_across_the_full_flow", () => {
    const state = seedOpen(["q1", "q2"]);
    const { panel, editor } = makePanel(state);
    // Full journey: focus, type, newline, stage-1 save, stage-2 advance,
    // note save — none of it may push editor history.
    focusText(panel);
    panel.handleInput("line1");
    panel.handleInput("\x1b[13;2u");
    panel.handleInput("line2");
    panel.handleInput("\r"); // stage 1
    panel.handleInput("\r"); // stage 2
    panel.textField.setText("note");
    panel.focus = "note";
    panel.handleInput("\r"); // note save

    expect(editor.addToHistory).not.toHaveBeenCalled();
    // onSubmit is deliberately never assigned (panel-level interception is
    // the single stage-1 trigger — see the [Mode A] JSDoc in panel.ts).
    expect(panel.textField.editor.onSubmit).toBeUndefined();
  });
});

/**
 * src/panel/two-stage.test.ts — commit-at-enter contract tests (WRITEIN-001,
 * h2.32 / FR-D2, P1.M2.T4.S1).
 *
 * The h2.31 two-stage arming machinery (one-shot advance flag, armed
 * stage-2 advance) was REMOVED: ONE enter now does the whole job, decided
 * by the editor's ACTIVE DUTY — write-in duty (type:"text" questions or
 * the ✎ Other row) COMMITS applyAnswer({value, custom: true}) + advances
 * (Q14 parity); elaboration duty (ctrl+t on a choice question) saves +
 * blurs, never commits, never advances; note duty exits + saves the batch
 * note. There is no second enter: a follow-up enter after an elaboration
 * save is just the normal options accept. Newline requests (shift+enter /
 * ctrl+j / alt+enter) are untouched by all of this — they never save and
 * never commit. The FILE NAME stays (h2.51 references it).
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
 * keys-spy flavor exists only to assert dispatch ORDERING (the enter-per-
 * duty fork runs before the seam). The fake editor's handleInput mirrors
 * the stock Editor's behavior for the sequences under test (newline
 * sequences insert a line break; printable chars insert) so multi-line
 * flows are exercised end to end WITHOUT the stock editor's destructive
 * submitValue() ever being a factor — exactly the property panel-level
 * enter interception guarantees.
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
 * Text-question variant: on type:"text" the editor opens in WRITE-IN duty
 * (duty-follows-cursor, P1.M2.T3.S1) — enter COMMITS the buffer as a
 * custom answer and advances (WRITEIN-001 commit-at-enter).
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

describe("commit-at-enter — one enter does the whole job (WRITEIN-001, h2.32)", () => {
  test("test_text_question_enter_commits_custom_answer_and_advances", () => {
    const state = seedOpenText(["q1", "q2"]);
    const { panel, drafts } = makePanel(state);
    // Duty-follows-cursor (P1.M2.T3.S1): ctrl+t on a type:"text" question
    // opens WRITE-IN duty — the buffer IS the answer.
    focusText(panel);
    expect(panel.textDuty).toBe("writein");
    panel.handleInput("my write-in answer");

    expect(panel.handleInput("\r")).toBe(true); // ONE enter: commit + advance

    const q1 = state.getQuestion("q1");
    expect(q1?.status).toBe("answered");
    expect(q1?.answer?.value).toBe("my write-in answer"); // RAW user text
    expect(q1?.answer?.custom).toBe(true); // h2.42 write-in marker
    expect(panel.focus).toBe("options"); // blurred after the commit
    expect(panel.currentId).toBe("q2"); // advanced to the next unanswered
    expect(panel.textDuty).toBe("elaboration"); // blurTextField reset the duty
    // VAL-002 commit-consume: the buffer text just BECAME the answer — the
    // commit tail consumes it (buffer cleared, no draft-slot/DraftStore
    // copy), so the advance can never stage the committed text as q1's
    // draft. The old landed write-through here was Issue B's poison: a
    // later option accept re-bound the stale copy as a bogus `answer.text`
    // elaboration of the new choice ("Alpha — my write-in answer").
    expect(drafts.setDraft).not.toHaveBeenCalled();
  });

  test("test_elaboration_enter_on_choice_saves_blurs_no_commit_no_advance", () => {
    const state = seedOpen(["q1", "q2"]);
    const { panel, drafts } = makePanel(state);
    focusText(panel); // ctrl+t on an option cursor → elaboration duty
    expect(panel.textDuty).toBe("elaboration");
    panel.handleInput("my elaboration");

    expect(panel.handleInput("\r")).toBe(true); // save + blur — nothing else

    expect(drafts.setDraft).toHaveBeenCalledWith("q1", "my elaboration");
    expect(state.getQuestion("q1")?.status).toBe("open");
    expect(state.getQuestion("q1")?.answer).toBeUndefined(); // NEVER a commit
    expect(panel.focus).toBe("options");
    expect(panel.currentId).toBe("q1"); // no advance
    expect(panel.cursorIndex).toBe(0); // ✎→★ preselect re-seed (index 0)
    // The follow-up enter is a NORMAL accept: ★ "a" selected, elaboration
    // kept, accept-advance moves on — no second-enter ritual anywhere.
    expect(panel.handleInput("\r")).toBe(true);
    expect(state.getQuestion("q1")?.status).toBe("answered");
    expect(state.getQuestion("q1")?.answer?.value).toBe("a");
    expect(panel.draftTextFor("q1")).toBe("my elaboration"); // attaches at submit
    expect(panel.currentId).toBe("q2");
  });

  test("test_empty_writein_enter_saves_draft_blurs_no_commit", () => {
    // Escape hatch: an empty buffer in write-in duty is NOT a commit —
    // draft write-through + blur only (R4; landed writeInEnter behavior).
    const state = seedOpenText(["q1", "q2"]);
    const { panel, drafts } = makePanel(state);
    focusText(panel);
    expect(panel.textField.getText()).toBe(""); // empty buffer

    expect(panel.handleInput("\r")).toBe(true);

    expect(state.getQuestion("q1")?.answer).toBeUndefined(); // no commit
    expect(state.getQuestion("q1")?.status).toBe("open");
    expect(drafts.setDraft).toHaveBeenCalledWith("q1", ""); // draft write-through
    expect(panel.draftTextFor("q1")).toBe("");
    expect(panel.focus).toBe("options");
    expect(panel.currentId).toBe("q1"); // no advance
  });

  test("test_text_enter_intercepts_before_the_keys_seam", () => {
    // Dispatch-ordering property that survives the two-stage removal: the
    // enter-per-duty fork consumes "\r" BEFORE the router sees it (the
    // note-mode analogue is test_note_enter_never_reaches_router_accept).
    const state = seedOpenText(["q1", "q2"]);
    const { panel, keys } = makePanel(state, true);
    panel.focusTextField("writein"); // spy flavor: focus driven directly
    panel.handleInput("committed via interception");

    panel.handleInput("\r");

    expect(state.getQuestion("q1")?.status).toBe("answered");
    expect(keys).not.toHaveBeenCalledWith("\r", panel);
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

    panel.handleInput("\r"); // elaboration enter saves the full multi-line draft

    expect(drafts.setDraft).toHaveBeenCalledWith("q1", "line1\nline2");
    expect(panel.focus).toBe("options");
  });

  test("test_kitty_plain_enter_commits_not_newline", () => {
    // parseKey resolves "\x1b[13u" (kitty CSI-u plain enter) to "enter" —
    // on a TEXT question it MUST commit (status answered), never insert a
    // newline and never fall through to the editor.
    const state = seedOpenText(["q1", "q2"]);
    const { panel, editor } = makePanel(state);
    focusText(panel);
    panel.handleInput("kitty answer");

    panel.handleInput("\x1b[13u");

    expect(state.getQuestion("q1")?.status).toBe("answered");
    expect(state.getQuestion("q1")?.answer?.value).toBe("kitty answer");
    expect(state.getQuestion("q1")?.answer?.custom).toBe(true);
    expect(panel.focus).toBe("options");
    expect(editor.handleInput).not.toHaveBeenCalledWith("\x1b[13u");
  });

  test("test_ctrl_j_inserts_newline_never_commits", () => {
    // "\n" is excluded from the enter fork by RAW BYTE (legacy parseKey
    // resolves ctrl+j to plain "enter"): it always reaches the editor as a
    // newline request — in write-in duty too, where plain enter commits.
    const state = seedOpenText(["q1", "q2"]);
    const { panel, editor, drafts } = makePanel(state);
    focusText(panel); // write-in duty on the text question
    panel.handleInput("line1");

    panel.handleInput("\n"); // ctrl+j — newline request, never a commit
    panel.handleInput("line2");

    expect(editor.handleInput).toHaveBeenCalledWith("\n");
    expect(panel.textField.getText()).toBe("line1\nline2");
    expect(panel.focus).toBe("text"); // editor still focused
    expect(drafts.setDraft).not.toHaveBeenCalled(); // no draft write
    expect(state.getQuestion("q1")?.answer).toBeUndefined(); // no commit
    expect(state.getQuestion("q1")?.status).toBe("open");
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
    expect(drafts.setDraft).not.toHaveBeenCalled(); // a note is NOT a question draft
  });

  test("test_note_enter_never_reaches_router_accept", () => {
    const state = seedOpen(["q1"]);
    const { panel, keys } = makePanel(state, true);
    panel.focus = "note";
    panel.handleInput("\r");
    // The router would read enter in non-text focus as options accept —
    // the enter fork must run first.
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
    panel.handleInput("\r"); // elaboration enter: save + blur (buffer keeps the draft)
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
    panel.handleInput("\r"); // elaboration save on q1 (slot written, blurred)

    // Navigate WITHOUT touching the slot map (R4: drafts survive
    // navigation; shift+tab/tab are the default nav accelerators).
    panel.handleInput("\x1b[Z"); // shift+tab = nextQuestion → q2
    expect(panel.currentId).toBe("q2");
    panel.handleInput("\t"); // tab = prevQuestion → back to q1
    expect(panel.currentId).toBe("q1");

    panel.handleInput("\u0014"); // refocus → seeded from the q1 slot
    expect(panel.textField.getText()).toBe("q1 draft");
  });

  test("test_cross_question_refocus_seeds_new_question_draft_not_stale_text", () => {
    const state = seedOpen(["q1", "q2"]);
    const { panel } = makePanel(state);
    focusText(panel);
    panel.handleInput("q1 draft");
    panel.handleInput("\r"); // elaboration save on q1 (slot written)

    // Navigation after the blur lands in options focus; refocusing on q2
    // re-seeds the buffer: q2 has no draft, so the field empties.
    panel.handleInput("\x1b[Z"); // shift+tab = nextQuestion → q2
    expect(panel.currentId).toBe("q2");
    panel.handleInput("\u0014"); // explicit refocus on q2
    expect(panel.textField.getText()).toBe(""); // never q1's leftover
  });
});

describe("two-stage enter — history isolation (h2.31)", () => {
  test("test_addToHistory_never_called_across_the_full_flow", () => {
    const state = seedOpenText(["q1", "q2"]);
    const { panel, editor } = makePanel(state);
    // Full journey: write-in focus on a text question, type, newline,
    // commit-enter, note save — none of it may push editor history.
    focusText(panel);
    panel.handleInput("line1");
    panel.handleInput("\x1b[13;2u");
    panel.handleInput("line2");
    panel.handleInput("\r"); // ONE enter commits the multi-line write-in
    expect(state.getQuestion("q1")?.status).toBe("answered");
    panel.textField.setText("note");
    panel.focus = "note";
    panel.handleInput("\r"); // note save

    expect(editor.addToHistory).not.toHaveBeenCalled();
    // onSubmit is deliberately never assigned (panel-level interception is
    // the single enter trigger — see the [Mode A] JSDoc in panel.ts).
    expect(panel.textField.editor.onSubmit).toBeUndefined();
  });
});

describe("VAL-002 — committed write-in is consumed, never re-bound as elaboration", () => {
  test("superseding a committed write-in with an option ships no stale text", () => {
    const state = seedOpen(["q1", "q2"]);
    const { panel, drafts } = makePanel(state);
    // Commit a write-in on q1's ✎ Other row: cursor to the affordance,
    // enter opens write-in duty, type, enter commits + advances.
    panel.cursorIndex = state.getQuestion("q1")!.options!.length;
    panel.handleInput("\r");
    expect(panel.textDuty).toBe("writein");
    panel.handleInput("my custom answer");
    panel.handleInput("\r"); // ONE enter: commit + advance
    expect(state.getQuestion("q1")?.answer).toMatchObject({ value: "my custom answer", custom: true });
    expect(panel.currentId).toBe("q2");
    // Commit-consume: the answer's own text must NOT also land in the
    // draft pipeline (that stale copy was Issue B's poison).
    expect(drafts.setDraft).not.toHaveBeenCalled();
    expect(panel.draftTextFor("q1")).toBeUndefined();
    // Change of mind: supersede the write-in with the ★ option.
    panel.currentId = "q1";
    panel.handleInput("\r"); // accept "a" (cursor re-seeded to ★)
    const answer = state.getQuestion("q1")!.answer!;
    expect(answer.value).toBe("a");
    expect(answer.custom).toBeUndefined();
    expect(answer.text).toBeUndefined(); // abandoned write-in never rides along
  });
});

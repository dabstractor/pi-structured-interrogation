/**
 * src/panel/keymap-ac.test.ts — keymap-trilogy delta AC coverage
 * (plan 004 P1.M4.T1.S2; delta_prd.md §3 AC-1..AC-6, the 2026-10-12 ruling —
 * NOT the legacy product ACs in ac-panel.test.ts).
 *
 * Styles follow the two sanctioned simulation patterns (architecture/
 * readme-and-test-flows.md §2): Style A = router-level `route(data,
 * panelStub)` over a vi.fn RoutedActions registry (keys.test.ts harness
 * shape); Style B = full InterrogationPanel + real InterrogationState +
 * handleInput with raw terminal bytes (panel.test.ts stub conventions).
 *
 * ## GAP AUDIT (Task 0 — grep-first; this file adds ONLY the gaps)
 *
 * | AC  | behavior                                          | already covered by | added here |
 * |-----|---------------------------------------------------|--------------------|------------|
 * | 1   | d/o/m/e dispatch from every non-editor view        | keys.test.ts test_bare_default_letters_dispatch_from_non_editor_focus | — |
 * | 1   | `t` → onElaborate (Style A), short-view gate       | Style B only (panel.test.ts t-entry tests) | ✅ short dispatch + deep/overview fall-through (BUG-011 gate) |
 * | 1   | 5 letters forward in text/note focus (Style A)     | keys.test.ts test_bare_default_letters_forward_in_text_and_note_focus | — |
 * | 1   | letters TYPE through the full panel (Style B)      | `t` (panel.test.ts re-press test), `m` in note focus only | ✅ d/o/t/m/e each reach the editor fake verbatim in text focus |
 * | 1   | ctrl+s intercepts in text focus (Style A)          | keys.test.ts :316/:413 | — |
 * | 1   | ctrl+s full submission FROM TEXT FOCUS (Style B)   | heartbeat test fires ctrl+s from OPTIONS focus | ✅ text-focus ctrl+s → real delivery, status flip, epoch bump |
 * | 1   | ctrl+g any-editor-duty both polarities (Style A)    | keys.test.ts test_externalEditor_in_editor_focus_any_duty | — |
 * | 1   | ctrl+g routed END-TO-END with mocked spawn         | panel.test.ts mocks editInExternalEditor (module seam), never child_process | ✅ $EDITOR spawn fake, await, replace-on-complete + options-focus negative |
 * | 1   | ctrl+g note-duty E2E round-trip (BUG-002)          | keys.test.ts router legs (P1.M2.T1.S2) | ✅ full-stack round-trip → batchNote/setNote, never setDraft (P1.M2.T1.S3) |
 * | 2   | hjkl per view + clamping + editor forwarding + schema absence | keys.test.ts :482–:630 (real-panel variants included) | Style B byte-landing complement added; the rest audit-only |
 * | 3   | digits inert (Style A, all contexts) + types       | keys.test.ts :630/:639/:663/:918/:994 | — |
 * | 3   | digitQuickSelect absent from schema + silent drop  | config.test.ts DIGIT-OUT-001 test | — |
 * | 3   | Style B full-panel no state change/advance/epoch   | — | ✅ handleInput("2") provably mutates nothing; types in editor |
 * | 4   | focusText alias, precedence, labels, silence       | config.test.ts focusText→elaborate describe (incl. test_alias_is_silent_no_console_output) | — (audit-only; no config.test.ts additions needed) |
 * | 5   | re-press t/m types; enter exit; double-esc both duties; single esc forwards; window reset/zero | panel.test.ts :1697/:2113, two-stage.test.ts note esc twin, keys.test.ts :829–:918 | — (audit-only; fully covered) |
 * | 6   | gates + conflict re-verification                   | npm test / typecheck / both guard suites; scripts/verify-keymap-conflicts.sh | recorded output lives in the PR notes (not here, not the README) |
 *
 * Byte discipline (S1's grep gate): the five letter actions are bare bytes
 * "d"/"o"/"t"/"m"/"e"; the two surviving chords keep their ctrl+s / ctrl+g
 * control bytes. None of the five letter actions appears here (or anywhere
 * in the suite) as a legacy chord byte sequence — those survive only in
 * S1's deliberate chord-REMAP fixtures (keys.test.ts / config-surface.test.ts),
 * which test remapped chords, not the defaults.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { EditorComponent, TUI } from "@earendil-works/pi-tui";
import { EventEmitter } from "node:events";
import { readFileSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import { DEFAULT_CONFIG, type InterrogatorConfig, type KeyAction } from "../config.js";
import { createInterrogationState, type InterrogationState, type Question } from "../state.js";
import { buildKeyRouter, type RoutedActions } from "./keys.js";
import type { DraftStore, InterrogationPanelArgs, PanelFocus, PanelView } from "./panel.js";
import { InterrogationPanel } from "./panel.js";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

// AC-1 ctrl+g end-to-end: the REAL editInExternalEditor runs against a fake
// child_process (external-editor.test.ts pattern) — node:fs/node:os/node:path
// stay REAL so the temp-dir lifecycle is exercised for truth.
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

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

/** The bare-letter/chord default data (mirrors keys.test.ts DEFAULT_DATA). */
const LETTER_BYTES: Record<KeyAction, string> = {
  deep: "d",
  overview: "o",
  elaborate: "t",
  batchNote: "m",
  submit: "\u0013",
  chat: "e",
  externalEditor: "\u0007",
  prevQuestion: "\t",
  nextQuestion: "\u001b[Z",
};
const CTRL_S = "\u0013";
const CTRL_G = "\u0007";

// ----------------------------------------------------- Style A harness (keys.test.ts shape)

interface PanelStub {
  view: PanelView;
  focus: PanelFocus;
  deepSticky: boolean;
  resolvedFlag: boolean;
  suspendCalls: number;
  lastEscAt: number | undefined;
  setView(v: PanelView): void;
  suspend(): void;
  isResolved(): boolean;
}

function makeStub(overrides: { view?: PanelView; focus?: PanelFocus } = {}): PanelStub {
  const panel: PanelStub = {
    view: overrides.view ?? "short",
    focus: overrides.focus ?? "options",
    deepSticky: false,
    resolvedFlag: false,
    suspendCalls: 0,
    lastEscAt: undefined,
    setView(v: PanelView) {
      this.view = v;
    },
    suspend() {
      this.suspendCalls += 1;
      this.resolvedFlag = true;
    },
    isResolved() {
      return this.resolvedFlag;
    },
  };
  return panel;
}

function makeActions(): RoutedActions & Record<string, Mock> {
  return {
    optionUp: vi.fn(() => true),
    optionDown: vi.fn(() => true),
    digit: vi.fn(() => true),
    accept: vi.fn(() => true),
    prevQuestion: vi.fn(() => true),
    nextQuestion: vi.fn(() => true),
    submit: vi.fn(() => true),
    onDeep: vi.fn(),
    onOverview: vi.fn(),
    onElaborate: vi.fn(),
    onBatchNote: vi.fn(),
    onChat: vi.fn(),
    onExternalEditor: vi.fn(),
  } as unknown as RoutedActions & Record<string, Mock>;
}

function makeRouter(config: InterrogatorConfig, actions: RoutedActions) {
  return { route: (data: string, panel: InterrogationPanel) => buildKeyRouter(config, actions)(data, panel as never) };
}

// ----------------------------------------------------- Style B harness (panel.test.ts shape)

/** Stateful editor fake recording every forwarded byte in order. */
function recordingEditor(): EditorComponent & { handleInput: Mock; received: string[] } {
  let text = "";
  const received: string[] = [];
  return {
    getText: vi.fn(() => text),
    setText: vi.fn((t: string) => {
      text = t;
    }),
    handleInput: vi.fn((data: string) => {
      received.push(data);
      text += data;
    }),
    render: vi.fn(() => [text]),
    focused: false,
    received,
  } as unknown as EditorComponent & { handleInput: Mock; received: string[] };
}

function draftsStub(): DraftStore & Record<"getDraft" | "setDraft" | "getNote" | "setNote", Mock> {
  return {
    getDraft: vi.fn(),
    setDraft: vi.fn(),
    getNote: vi.fn(() => ""),
    setNote: vi.fn(),
  } as unknown as DraftStore & Record<"getDraft" | "setDraft" | "getNote" | "setNote", Mock>;
}

interface StyleBHandle {
  panel: InterrogationPanel;
  editor: ReturnType<typeof recordingEditor>;
  drafts: ReturnType<typeof draftsStub>;
  tui: { stop: Mock; start: Mock; requestRender: Mock };
}

function makePanel(
  state: InterrogationState,
  extra: Partial<InterrogationPanelArgs> = {},
): StyleBHandle {
  const editor = recordingEditor();
  const drafts = draftsStub();
  const tui = { stop: vi.fn(), start: vi.fn(), requestRender: vi.fn() };
  const panel = new InterrogationPanel({
    tui: tui as unknown as TUI,
    theme: stubTheme,
    done: () => {},
    state,
    config: DEFAULT_CONFIG,
    drafts,
    editorFactory: () => editor,
    ...extra,
  });
  return { panel, editor, drafts, tui };
}

function seedOpen(ids: string[]): InterrogationState {
  const state = createInterrogationState("goal");
  for (const id of ids) state.upsertQuestion(choiceQ(id));
  return state;
}

/** Spawn fake: records the seeded content, writes the edit, exits cleanly. */
let seededAtSpawn: string | undefined;
function spawnWrites(content: string): void {
  spawnMock.mockImplementation((_command: string, args: string[]) => {
    const child = new EventEmitter();
    const file = args[args.length - 1] as string;
    queueMicrotask(() => {
      seededAtSpawn = readFileSync(file, "utf-8");
      writeFileSync(file, content, "utf-8");
      child.emit("close", 0);
    });
    return child;
  });
}

// ------------------------------------------------------------------ AC-1

describe("AC-1 — two-tier dispatch/typing + surviving chords (delta_prd §3.1)", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    seededAtSpawn = undefined;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("test_ac1_t_dispatches_onElaborate_from_short_options_focus_style_a", () => {
    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    expect(route(LETTER_BYTES.elaborate, makeStub() as never)).toBe(true);
    expect(actions.onElaborate).toHaveBeenCalledTimes(1);
  });

  test("test_ac1_t_dispatches_in_deep_overview_still_gated_deep_editor_001_style_a", () => {
    // DEEP-EDITOR-001: the deep view RENDERS the editor pinned below the
    // pane — `t` dispatches from deep too. OVERVIEW stays gated (BUG-004:
    // its cursor is a question index, not an option index — duty
    // derivation is meaningless there; the old BUG-011 rationale survives
    // only for this view). (d/o/m/e still dispatch everywhere —
    // keys.test.ts owns that half.)
    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    expect(route(LETTER_BYTES.elaborate, makeStub({ view: "deep" }) as never)).toBe(true);
    expect(actions.onElaborate).toHaveBeenCalledTimes(1);

    const actions2 = makeActions();
    const router2 = makeRouter(DEFAULT_CONFIG, actions2);
    expect(router2.route(LETTER_BYTES.elaborate, makeStub({ view: "overview" }) as never)).toBe(false);
    expect(actions2.onElaborate).not.toHaveBeenCalled();
    expect(actions2.onDeep).not.toHaveBeenCalled();
    expect(actions2.onOverview).not.toHaveBeenCalled();
    expect(actions2.onBatchNote).not.toHaveBeenCalled();
    expect(actions2.onChat).not.toHaveBeenCalled();
  });

  test("test_ac1_bare_letters_type_through_the_full_panel_in_text_focus_style_b", () => {
    const state = seedOpen(["q1"]);
    const { panel, editor, drafts } = makePanel(state);
    panel.focusTextField("elaboration"); // direct seam — bare keys can't enter
    expect(panel.focus).toBe("text");

    for (const letter of ["d", "o", "t", "m", "e"]) {
      expect(panel.handleInput(letter), letter).toBe(true); // forwarded = consumed by the panel
    }
    expect(editor.received).toEqual(["d", "o", "t", "m", "e"]); // each byte verbatim
    expect(panel.textField.getText()).toBe("dotme"); // the buffer grew — they TYPED
    expect(panel.focus).toBe("text"); // no toggle, no exit
    expect(drafts.setDraft).not.toHaveBeenCalled(); // no stage-1 saves mid-typing
    expect(state.getQuestion("q1")?.answer).toBeUndefined(); // nothing accepted
  });

  test("test_ac1_ctrl_s_submits_from_text_focus_full_delivery_style_b", () => {
    // The heartbeat test fires ctrl+s from OPTIONS focus; the AC's wording
    // is "ctrl+s still submits FROM TEXT FOCUS" — this drives exactly that
    // through the real delivery path (mock SubmitDeps, actions.test.ts
    // delivery-mock pattern).
    const state = seedOpen(["q1", "q2"]); // q2 stays open — submission attributable to ctrl+s
    state.applyAnswer("q1", { value: "a", at: new Date().toISOString() });
    const sendMessage = vi.fn();
    const { panel } = makePanel(state, {
      delivery: { sendMessage, isIdle: () => true },
    });
    const epochBefore = state.epoch;
    panel.focusTextField("elaboration");
    expect(panel.focus).toBe("text");

    expect(panel.handleInput(CTRL_S)).toBe(true); // tier-1 chord intercepts mid-answer

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const sent = sendMessage.mock.calls[0][0] as { customType: string; content: string };
    expect(sent.customType).toBe("interrogation-submission");
    expect(state.getQuestion("q1")?.status).toBe("submitted");
    expect(state.epoch).toBe(epochBefore + 1);
  });

  test("test_ac1_ctrl_g_opens_the_mock_editor_from_text_focus_and_replaces_draft", async () => {
    const state = seedOpen(["q1"]);
    const { panel, editor, drafts, tui } = makePanel(state);
    panel.focusTextField("elaboration");
    editor.setText("typed draft");

    vi.stubEnv("VISUAL", ""); // empty = unset → $EDITOR wins (machine-local env can't leak)
    vi.stubEnv("EDITOR", "fakeed");
    spawnWrites("edited text\n");

    const spy = vi.spyOn(panel, "openExternalEditor");
    expect(panel.handleInput(CTRL_G)).toBe(true); // routed — ctrl+g is text-focus context
    expect(spy).toHaveBeenCalledTimes(1);

    await spy.mock.results[0]!.value; // await the fire-and-forget round-trip

    // spawn received the resolved $EDITOR command + one temp answer file.
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args, opts] = spawnMock.mock.calls[0] as [string, string[], { stdio: string }];
    expect(command).toBe("fakeed");
    expect(args).toHaveLength(1);
    expect(args[0]).toMatch(/answer\.md$/);
    expect(opts.stdio).toBe("inherit");
    // The pre-suspend draft seeded the temp file; the edit replaced the field.
    expect(seededAtSpawn).toBe("typed draft");
    expect(editor.setText).toHaveBeenCalledWith("edited text");
    expect(panel.textField.getText()).toBe("edited text"); // trailing \n stripped
    expect(drafts.setDraft).toHaveBeenCalledWith("q1", "edited text"); // h2.45 sync
    // Suspend envelope: stop before, restart after; focus never moved.
    expect(tui.stop).toHaveBeenCalledTimes(1);
    expect(tui.start).toHaveBeenCalledTimes(1);
    expect(panel.focus).toBe("text");
  });

  test("test_ac1_ctrl_g_from_options_focus_does_not_spawn_style_b", () => {
    // ctrl+g fires ONLY from editor focus (h2.34 context gate) — from
    // options focus the byte is not consumed and nothing spawns.
    const state = seedOpen(["q1"]);
    const { panel } = makePanel(state);
    vi.stubEnv("EDITOR", "fakeed");
    spawnWrites("should never be written");

    const spy = vi.spyOn(panel, "openExternalEditor");
    expect(panel.handleInput(CTRL_G)).toBe(false); // unmatched → forwarded/ignored
    expect(spy).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  test("test_ac1_ctrl_g_note_duty_round_trips_into_the_batch_note_style_b", async () => {
    // BUG-002 E2E (P1.M2.T1.S3): ctrl+g is editor focus ANY duty — from note
    // duty the completed text must land in batchNote/drafts.setNote, NEVER the
    // current question's draft slot (the pre-fix corruption mode).
    const state = seedOpen(["q1"]);
    const { panel, editor, drafts, tui } = makePanel(state);
    panel.enterNoteMode(); // public seam — same as pressing 'm' (open-only)
    expect(panel.focus).toBe("note");
    editor.setText("note draft"); // seed the note buffer (typed-equivalent)

    vi.stubEnv("VISUAL", ""); // empty = unset → $EDITOR wins
    vi.stubEnv("EDITOR", "fakeed");
    spawnWrites("edited note\n");

    const spy = vi.spyOn(panel, "openExternalEditor");
    expect(panel.handleInput(CTRL_G)).toBe(true); // editorFocused gate (P1.M2.T1.S2)
    expect(spy).toHaveBeenCalledTimes(1);

    await spy.mock.results[0]!.value; // await the fire-and-forget round-trip

    // spawn: resolved $EDITOR command + one temp answer file, inherit stdio.
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args, opts] = spawnMock.mock.calls[0] as [string, string[], { stdio: string }];
    expect(command).toBe("fakeed");
    expect(args).toHaveLength(1);
    expect(args[0]).toMatch(/answer\.md$/);
    expect(opts.stdio).toBe("inherit");
    // Seeded with the NOTE draft (duty-blind seeding side), applied to the note.
    expect(seededAtSpawn).toBe("note draft");
    expect(editor.setText).toHaveBeenCalledWith("edited note");
    expect(panel.textField.getText()).toBe("edited note"); // trailing \n stripped
    expect(drafts.setNote).toHaveBeenCalledWith("edited note"); // note write-through
    expect(panel.batchNote).toBe("edited note");
    expect(drafts.setDraft).not.toHaveBeenCalled(); // NEVER the question slot
    // Envelope + duty preserved: stop before, start after; still note focus.
    expect(tui.stop).toHaveBeenCalledTimes(1);
    expect(tui.start).toHaveBeenCalledTimes(1);
    expect(panel.focus).toBe("note");
  });
});

// ------------------------------------------------------------------ AC-2

describe("AC-2 — hjkl fixed aliases: editor-focus typing complement (delta_prd §3.2)", () => {
  test("test_ac2_hjkl_type_through_the_full_panel_in_text_focus_style_b", () => {
    // keys.test.ts owns the per-view navigation + clamping + route-false
    // forwarding matrix (real-panel variants included). This Style B leg
    // proves the bytes actually LAND in the embedded editor's buffer.
    const state = seedOpen(["q1"]);
    const { panel, editor } = makePanel(state);
    panel.focusTextField("elaboration");

    for (const letter of ["h", "j", "k", "l"]) {
      expect(panel.handleInput(letter), letter).toBe(true);
    }
    expect(editor.received).toEqual(["h", "j", "k", "l"]);
    expect(panel.textField.getText()).toBe("hjkl");
    expect(panel.focus).toBe("text"); // never exited, never navigated
    expect(panel.currentId).toBe("q1"); // no question movement
  });

  test("test_ac2_hjkl_absent_from_the_resolved_default_schema", () => {
    // Cheap cross-check of keys.test.ts's schema-absence proof, phrased
    // against the whole default map (fixed family — nothing to remap).
    const bound = Object.values(DEFAULT_CONFIG.keys);
    for (const letter of ["h", "j", "k", "l"]) {
      expect(bound).not.toContain(letter);
    }
  });
});

// ------------------------------------------------------------------ AC-3

describe("AC-3 — digits inert at panel level (delta_prd §3.3)", () => {
  test("test_ac3_digit_press_changes_nothing_through_the_full_panel_style_b", () => {
    // Style A proves route-false + zero dispatch (keys.test.ts); this Style B
    // leg proves the FULL panel is untouched: no accept, no advance, no epoch
    // bump, no snapshot, no answer — for every digit, from options focus.
    for (const digit of ["1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
      const state = seedOpen(["q1", "q2"]);
      const { panel, drafts } = makePanel(state);
      const before = {
        epoch: state.epoch,
        snapshots: state.snapshots.length,
        status: state.getQuestion("q1")?.status,
        answer: state.getQuestion("q1")?.answer,
        currentId: panel.currentId,
        cursorIndex: panel.cursorIndex,
        focus: panel.focus,
        view: panel.view,
      };

      expect(panel.handleInput(digit), digit).toBe(false); // inert — not even consumed

      expect({
        epoch: state.epoch,
        snapshots: state.snapshots.length,
        status: state.getQuestion("q1")?.status,
        answer: state.getQuestion("q1")?.answer,
        currentId: panel.currentId,
        cursorIndex: panel.cursorIndex,
        focus: panel.focus,
        view: panel.view,
      }).toEqual(before);
      expect(drafts.setDraft).not.toHaveBeenCalled();
    }
  });

  test("test_ac3_digit_types_through_the_editor_in_text_focus_style_b", () => {
    const state = seedOpen(["q1"]);
    const { panel, editor } = makePanel(state);
    panel.focusTextField("elaboration");

    expect(panel.handleInput("2")).toBe(true); // forwarded into the editor
    expect(editor.received).toEqual(["2"]);
    expect(panel.textField.getText()).toBe("2");
    expect(panel.focus).toBe("text");
  });
});

// ------------------------------------------------------------------ AC-5 (audit-only)

describe("AC-5 — re-press types; exits via enter/double-esc (delta_prd §3.5)", () => {
  test("test_ac5_audit_companion_repress_and_exit_gestures_are_covered_elsewhere", () => {
    // No new coverage — the audit (header) pins every AC-5 behavior to an
    // existing green assertion. This companion simply re-runs the two
    // load-bearing ones back-to-back so a regression in either suite fails
    // with delta-AC context attached:
    //   - re-press types: panel.test.ts test_t_in_text_focus_types_... /
    //     test_m_in_note_focus_types_...
    //   - exits: enter per duty (two-stage.test.ts) + the esc-esc pair for
    //     BOTH duties (keys.test.ts :829 note / :850 text; two-stage.test.ts
    //     note twin) with single-esc forwarding and window reset/zero.
    const state = seedOpen(["q1"]);
    const { panel, editor } = makePanel(state);
    panel.focusTextField("elaboration");
    panel.handleInput("first");
    expect(panel.handleInput("t")).toBe(true); // re-press TYPES (no toggle)
    expect(panel.textField.getText()).toBe("firstt");
    expect(editor.received).toContain("t");
    expect(panel.focus).toBe("text");
    expect(panel.handleInput("\r")).toBe(true); // enter = the exit gesture
    expect(panel.focus).toBe("options"); // stage-1 save + blur (two-stage.test.ts territory)
  });
});

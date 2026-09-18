/**
 * src/panel/keys.test.ts — config-driven key dispatch tests (P1.M3.T3.S1).
 *
 * Conventions follow panel.test.ts / actions.test.ts: no runtime, fakes
 * cast to the narrow structural surface the router touches, and action
 * handlers are vi.fn spies. Default-accelerator cases feed RAW terminal
 * data and round-trip it through matchesKey in the fixture helper first —
 * if pi-tui's sequence grammar ever changes, the fixture fails loudly
 * instead of the assertions silently drifting (AUTOMATION-POLICY: all
 * dispatch behavior asserted in vitest, no live pi session).
 */
import { Key, matchesKey, type KeyId } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, test, vi, type Mock } from "vitest";
import { DEFAULT_CONFIG, type InterrogatorConfig, type KeyAction } from "../config.js";
import type { Question } from "../state.js";
import {
  buildKeyRouter,
  defaultRoutedActions,
  parseAccelerator,
  resolveBindings,
  type RoutedActions,
} from "./keys.js";
import type { InterrogationPanel, PanelFocus, PanelView } from "./panel.js";

// ------------------------------------------------------------------ fixtures

/** Raw terminal data for each h2.34 default accelerator. */
const DEFAULT_DATA: Record<KeyAction, string> = {
  deep: "\u0004", // ctrl+d
  overview: "\u000c", // ctrl+l
  focusText: "\u0014", // ctrl+t
  batchNote: "\u001b[109;6u", // kitty CSI-u ctrl+shift+m (m = 109)
  submit: "\u0013", // ctrl+s
  breakOut: "\u001b[113;6u", // kitty CSI-u ctrl+shift+q (q = 113)
  discuss: "\u001b[101;6u", // kitty CSI-u ctrl+shift+e (e = 101)
  externalEditor: "\u0007", // ctrl+g
  prevQuestion: "\t",
  nextQuestion: "\u001b[Z",
};

const UP = "\u001b[A";
const DOWN = "\u001b[B";
const ESCAPE = "\u001b";
const ENTER = "\r";
const F9 = "\u001b[20~";
const CTRL_ALT_D = "\u001b\u0004"; // legacy ctrl+alt+d (ESC + control byte)

function configWithKeys(keys: Partial<Record<KeyAction, string>>): InterrogatorConfig {
  return { ...DEFAULT_CONFIG, keys: { ...DEFAULT_CONFIG.keys, ...keys } };
}

/**
 * Fake panel exposing exactly the surface the router + seam defaults touch,
 * with REAL view/focus state transitions (setView assigns like panel.ts).
 * suspend flips isResolved like the resolved guard does.
 */
interface PanelStub extends InterrogationPanel {
  resolvedFlag: boolean;
  suspendCalls: number;
}

function makePanel(
  overrides: { view?: PanelView; focus?: PanelFocus; deepSticky?: boolean } = {},
): PanelStub {
  const panel = {
    view: overrides.view ?? "short",
    focus: overrides.focus ?? "options",
    deepSticky: overrides.deepSticky ?? false,
    resolvedFlag: false,
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
    suspendCalls: 0,
    invalidate: vi.fn(),
    // ESC-002 exit seams: the router's double-esc exit calls exactly one of
    // these (note duty → exitNoteMode, text duty → exitTextField).
    exitTextField: vi.fn(),
    lastEscAt: undefined as number | undefined,
    // Batch-note toggle seams (R3, P1.M4.T2.S2): the default action calls
    // exactly one of these per dispatch (focus === "note" ? exit : enter).
    enterNoteMode: vi.fn(),
    exitNoteMode: vi.fn(),
    // Wired default action (M4.T1.S3) calls this — a resolved async stub so
    // the fire-and-forget `void p.openExternalEditor()` never rejects.
    openExternalEditor: vi.fn(async () => {}),
  };
  return panel as unknown as PanelStub;
}

/** All-void→true spies for the seam callbacks, boolean spies for actions. */
function makeActions() {
  const spies = {
    optionUp: vi.fn((_p: InterrogationPanel) => true),
    optionDown: vi.fn((_p: InterrogationPanel) => true),
    digit: vi.fn((_p: InterrogationPanel, _n: number) => true),
    accept: vi.fn((_p: InterrogationPanel) => true),
    prevQuestion: vi.fn((_p: InterrogationPanel) => true),
    nextQuestion: vi.fn((_p: InterrogationPanel) => true),
    submit: vi.fn((_p: InterrogationPanel) => true),
    onDeep: vi.fn((_p: InterrogationPanel) => undefined),
    onOverview: vi.fn((_p: InterrogationPanel) => undefined),
    onFocusText: vi.fn((_p: InterrogationPanel) => undefined),
    onBatchNote: vi.fn((_p: InterrogationPanel) => undefined),
    onBreakOut: vi.fn((_p: InterrogationPanel) => undefined),
    onDiscuss: vi.fn((_p: InterrogationPanel) => undefined),
    onExternalEditor: vi.fn((_p: InterrogationPanel) => undefined),
  };
  const all: Mock[] = Object.values(spies);
  return { ...spies, all };
}

/** Total invocations across every action spy — the single-dispatch counter. */
function dispatchCount(actions: { all: Mock[] }): number {
  return actions.all.reduce((n, m) => n + m.mock.calls.length, 0);
}

/**
 * Round-trip guard: the raw data MUST match its accelerator via matchesKey.
 * Runs at fixture time so a pi-tui grammar change fails here, loudly.
 */
function expectMatches(data: string, keyId: KeyId, label: string): void {
  if (!matchesKey(data, keyId)) {
    throw new Error(`fixture broken: matchesKey(${JSON.stringify(data)}, "${keyId}") — ${label}`);
  }
}

/** Router with spy actions for a config. */
function makeRouter(config: InterrogatorConfig, actions: RoutedActions) {
  return { route: buildKeyRouter(config, actions), actions };
}
/** Router whose action spies are reachable with full Mock typing. */
function makeSpiedRouter(config: InterrogatorConfig) {
  const actions = makeActions();
  return { route: buildKeyRouter(config, actions), actions };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ------------------------------------------------------- accelerator layer

describe("parseAccelerator — grammar validation", () => {
  test("test_parseAccelerator_accepts_valid_forms", () => {
    expect(parseAccelerator("ctrl+d")).toBe("ctrl+d");
    expect(parseAccelerator("  CTRL+SHIFT+M ")).toBe("ctrl+shift+m");
    expect(parseAccelerator("shift+tab")).toBe("shift+tab");
    expect(parseAccelerator("tab")).toBe("tab");
    expect(parseAccelerator("f9")).toBe("f9");
    expect(parseAccelerator("1")).toBe("1");
    expect(parseAccelerator("?")).toBe("?");
    expect(parseAccelerator("ctrl+alt+super+x")).toBe("ctrl+alt+super+x");
  });

  test("test_parseAccelerator_rejects_invalid_forms", () => {
    expect(parseAccelerator("ctrl+")).toBeUndefined(); // dangling modifier
    expect(parseAccelerator("+")).toBeUndefined(); // empty tokens
    expect(parseAccelerator("")).toBeUndefined();
    expect(parseAccelerator("   ")).toBeUndefined();
    expect(parseAccelerator("hyper+x")).toBeUndefined(); // unknown modifier
    expect(parseAccelerator("ctrl+ctrl+d")).toBeUndefined(); // duplicate modifier
    expect(parseAccelerator("ctrl+f13")).toBeUndefined(); // unknown base key
    expect(parseAccelerator("ctrl+ab")).toBeUndefined(); // multi-char non-name
  });

  test("test_resolveBindings_falls_back_to_default_with_one_warn_per_invalid", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = configWithKeys({ submit: "ctrl+", deep: "not a key!!" });
    const bindings = resolveBindings(config);

    // Every action resolves to SOMETHING (table never has holes).
    for (const action of Object.keys(DEFAULT_CONFIG.keys) as KeyAction[]) {
      expect(bindings[action]).toBeDefined();
    }
    // Invalid entries fall back to the h2.52 defaults…
    expect(bindings.submit).toBe("ctrl+s");
    expect(bindings.deep).toBe("ctrl+d");
    // …valid remaps survive…
    const remapped = resolveBindings(configWithKeys({ submit: "f9" }));
    expect(remapped.submit).toBe("f9");
    // …and each invalid entry warns exactly once.
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

// ------------------------------------------------------------ default config

describe("buildKeyRouter — default config dispatch (h2.34 table)", () => {
  test("test_default_accelerators_dispatch_every_action", () => {
    // Fixture round-trip: raw data must satisfy matchesKey for its binding.
    const bindings = resolveBindings(DEFAULT_CONFIG);
    for (const action of Object.keys(DEFAULT_DATA) as KeyAction[]) {
      expectMatches(DEFAULT_DATA[action], bindings[action], action);
    }

    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);

    // Fixed arrows + enter (options focus) round-trip too.
    expectMatches(UP, Key.up, "up");
    expectMatches(DOWN, Key.down, "down");
    expectMatches(ENTER, Key.enter, "enter");
    expectMatches(ESCAPE, Key.escape, "escape");

    for (const action of Object.keys(DEFAULT_DATA) as KeyAction[]) {
      const fresh = makeActions();
      const router = makeRouter(DEFAULT_CONFIG, fresh);
      const panel = makePanel(
        action === "externalEditor" ? { focus: "text" } : { focus: "options" },
      );
      const consumed = router.route(DEFAULT_DATA[action], panel);
      expect(consumed, `${action} consumes ${JSON.stringify(DEFAULT_DATA[action])}`).toBe(true);
      expect(dispatchCount(fresh), `${action} dispatches exactly once`).toBe(1);
    }

    // Spot-check the wiring: each spy fired on its own action, nothing else.
    const spot = makeActions();
    const spotRouter = makeRouter(DEFAULT_CONFIG, spot);
    spotRouter.route(DEFAULT_DATA.submit, makePanel());
    expect(spot.submit).toHaveBeenCalledTimes(1);
    expect(spot.onDeep).not.toHaveBeenCalled();
    spotRouter.route(DEFAULT_DATA.breakOut, makePanel());
    expect(spot.onBreakOut).toHaveBeenCalledTimes(1);
    spotRouter.route(DEFAULT_DATA.batchNote, makePanel());
    expect(spot.onBatchNote).toHaveBeenCalledTimes(1);
    spotRouter.route(DEFAULT_DATA.prevQuestion, makePanel());
    expect(spot.prevQuestion).toHaveBeenCalledTimes(1);
    spotRouter.route(DEFAULT_DATA.nextQuestion, makePanel());
    expect(spot.nextQuestion).toHaveBeenCalledTimes(1);
  });

  test("test_unmatched_input_forwards", () => {
    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    const panel = makePanel();
    expect(route("x", panel)).toBe(false); // plain letter
    expect(route("\u001b[9~", panel)).toBe(false); // unbound sequence
    expect(dispatchCount(actions)).toBe(0);
  });
});

// ------------------------------------------------------------------ remap

describe("buildKeyRouter — remappability (AC-12 core)", () => {
  test("test_remapped_key_fires_and_old_key_releases", () => {
    const remapped = configWithKeys({ submit: "f9", deep: "ctrl+alt+d" });
    const bindings = resolveBindings(remapped);
    expectMatches(F9, bindings.submit, "remapped submit");
    expectMatches(CTRL_ALT_D, bindings.deep, "remapped deep");

    const actions = makeActions();
    const { route } = makeRouter(remapped, actions);

    // New keys fire…
    expect(route(F9, makePanel())).toBe(true);
    expect(actions.submit).toHaveBeenCalledTimes(1);
    expect(route(CTRL_ALT_D, makePanel())).toBe(true);
    expect(actions.onDeep).toHaveBeenCalledTimes(1);

    // …old defaults are RELEASED (forwarded, not consumed).
    expect(route("\u0013", makePanel())).toBe(false); // old ctrl+s submit
    expect(route("\u0004", makePanel())).toBe(false); // old ctrl+d deep
    expect(actions.submit).toHaveBeenCalledTimes(1);
    expect(actions.onDeep).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------- intercept rule (text)

describe("buildKeyRouter — h2.34 intercept rule with focus === text", () => {
  test("test_text_focus_still_intercepts_panel_keys", () => {
    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);

    // Panel-level keys consumed IN text focus — the whole point of the rule.
    expect(route(DEFAULT_DATA.submit, makePanel({ focus: "text" }))).toBe(true);
    expect(actions.submit).toHaveBeenCalledTimes(1);
    expect(route(DEFAULT_DATA.deep, makePanel({ focus: "text" }))).toBe(true);
    expect(actions.onDeep).toHaveBeenCalledTimes(1);
    expect(route(DEFAULT_DATA.overview, makePanel({ focus: "text" }))).toBe(true);
    expect(route(DEFAULT_DATA.focusText, makePanel({ focus: "text" }))).toBe(true);
    expect(route(DEFAULT_DATA.batchNote, makePanel({ focus: "text" }))).toBe(true);
    expect(route(DEFAULT_DATA.discuss, makePanel({ focus: "text" }))).toBe(true);
    expect(route(DEFAULT_DATA.breakOut, makePanel({ focus: "text" }))).toBe(true);
    expect(route(DEFAULT_DATA.prevQuestion, makePanel({ focus: "text" }))).toBe(true);
    expect(route(DEFAULT_DATA.nextQuestion, makePanel({ focus: "text" }))).toBe(true);

    // Typing keys FORWARD (return false) — the user is writing an answer.
    const fresh = makeActions();
    const freshRouter = makeRouter(DEFAULT_CONFIG, fresh);
    const textPanel = makePanel({ focus: "text" });
    expect(freshRouter.route("1", textPanel)).toBe(false);
    expect(freshRouter.route("9", textPanel)).toBe(false);
    expect(freshRouter.route("a", textPanel)).toBe(false);
    expect(freshRouter.route(ENTER, textPanel)).toBe(false); // two-stage enter is M4
    expect(dispatchCount(fresh)).toBe(0);
  });

  test("test_externalEditor_only_in_text_focus", () => {
    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    // Options focus: ctrl+g is NOT consumed (kept free elsewhere).
    expect(route(DEFAULT_DATA.externalEditor, makePanel({ focus: "options" }))).toBe(false);
    expect(actions.onExternalEditor).not.toHaveBeenCalled();
    // Text focus: consumed (its h2.34 context).
    expect(route(DEFAULT_DATA.externalEditor, makePanel({ focus: "text" }))).toBe(true);
    expect(actions.onExternalEditor).toHaveBeenCalledTimes(1);
  });
});

// -------------------------------------------------------------- esc descent

describe("buildKeyRouter — esc descent ladder (FR-16)", () => {
  test("test_esc_descends_deep_overview_and_suspends_from_short", () => {
    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);

    // deep → short (deepSticky NOT cleared — only entering deep sets it).
    const deep = makePanel({ view: "deep", deepSticky: true });
    expect(route(ESCAPE, deep)).toBe(true);
    expect(deep.view).toBe("short");
    expect(deep.deepSticky).toBe(true);

    // overview → short without sticky.
    const overview = makePanel({ view: "overview", deepSticky: false });
    expect(route(ESCAPE, overview)).toBe(true);
    expect(overview.view).toBe("short");

    // overview → deep WITH sticky (mirror of panel.ts's old overview toggle).
    const stickyOverview = makePanel({ view: "overview", deepSticky: true });
    expect(route(ESCAPE, stickyOverview)).toBe(true);
    expect(stickyOverview.view).toBe("deep");

    // short → suspend exactly once; state fields untouched (FR-16).
    const short = makePanel({ view: "short" });
    short.focus = "options";
    expect(route(ESCAPE, short)).toBe(true);
    expect(short.suspendCalls).toBe(1);
    expect(short.isResolved()).toBe(true);
    expect(short.view).toBe("short");

    // Repeated esc on the resolved panel: no throw, no second suspend,
    // router returns false (resolved guard).
    expect(route(ESCAPE, short)).toBe(false);
    expect(short.suspendCalls).toBe(1);
    expect(dispatchCount(actions)).toBe(0); // esc never touches action spies
  });
});

// ------------------------------------------------------------- fixed keys

describe("buildKeyRouter — fixed keys and gating", () => {
  test("test_arrows_and_enter_dispatch_regardless_of_config", () => {
    // Even a config that remaps actions cannot shadow the fixed keys —
    // arrows/enter/esc are not in the KeyAction union at all.
    const actions = makeActions();
    const { route } = makeRouter(configWithKeys({ prevQuestion: "up", nextQuestion: "down" }), actions);
    const panel = makePanel();
    expect(route(UP, panel)).toBe(true);
    expect(actions.optionUp).toHaveBeenCalledTimes(1); // fixed arrow, not prevQuestion
    expect(actions.prevQuestion).not.toHaveBeenCalled();
    expect(route(DOWN, panel)).toBe(true);
    expect(actions.optionDown).toHaveBeenCalledTimes(1);
    expect(route(ENTER, panel)).toBe(true);
    expect(actions.accept).toHaveBeenCalledTimes(1);
    expect(route(ESCAPE, panel)).toBe(true); // fixed esc — suspends from short
    expect(panel.suspendCalls).toBe(1);
  });

  test("test_digitQuickSelect_off_forwards_digits", () => {
    const config = { ...DEFAULT_CONFIG, digitQuickSelect: false };
    const actions = makeActions();
    const { route } = makeRouter(config, actions);
    expect(route("5", makePanel())).toBe(false);
    expect(actions.digit).not.toHaveBeenCalled();
  });

  test("test_digit_honors_action_result", () => {
    const actions = makeActions();
    actions.digit.mockReturnValueOnce(false); // beyond options → not consumed
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    expect(route("7", makePanel())).toBe(false);
    expect(actions.digit).toHaveBeenCalledWith(expect.anything(), 7);

    const actions2 = makeActions();
    const route2 = makeRouter(DEFAULT_CONFIG, actions2).route;
    expect(route2("2", makePanel())).toBe(true); // in range → consumed
    expect(actions2.digit).toHaveBeenCalledWith(expect.anything(), 2);
  });

  test("test_navigation_action_false_propagates", () => {
    const actions = makeActions();
    actions.optionUp.mockReturnValueOnce(false);
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    expect(route(UP, makePanel())).toBe(false);
  });
});

// ------------------------------------------------------------- collisions

describe("buildKeyRouter — collision + single-dispatch guarantees", () => {
  test("test_collision_first_in_resolution_order_wins", () => {
    // deep (earlier) vs submit (later) both on ctrl+d → deep wins.
    const actions = makeActions();
    const { route } = makeRouter(configWithKeys({ submit: "ctrl+d" }), actions);
    expect(route("\u0004", makePanel())).toBe(true);
    expect(actions.onDeep).toHaveBeenCalledTimes(1);
    expect(actions.submit).not.toHaveBeenCalled();
    expect(dispatchCount(actions)).toBe(1); // never double-dispatch
  });
});

// ------------------------------------------------- default seam behaviors

describe("defaultRoutedActions — seam defaults", () => {
  test("test_default_seams_toggle_views_and_suspend", () => {
    const actions = defaultRoutedActions();
    const panel = makePanel();

    actions.onDeep(panel); // short → deep, sticky set
    expect(panel.view).toBe("deep");
    expect(panel.deepSticky).toBe(true);
    actions.onDeep(panel); // deep → short, sticky survives
    expect(panel.view).toBe("short");

    actions.onOverview(panel); // → overview
    expect(panel.view).toBe("overview");
    actions.onOverview(panel); // deepSticky already set above → deep
    expect(panel.view).toBe("deep");

    // Fresh session (no sticky): overview toggles back to short.
    const fresh2 = makePanel();
    actions.onOverview(fresh2);
    expect(fresh2.view).toBe("overview");
    actions.onOverview(fresh2); // no sticky → short
    expect(fresh2.view).toBe("short");

    const sticky = makePanel();
    actions.onDeep(sticky); // deep (sticky now true)
    actions.onOverview(sticky); // → overview
    actions.onOverview(sticky); // sticky → deep
    expect(sticky.view).toBe("deep");

    actions.onFocusText(panel);
    expect(panel.focus).toBe("text");

    actions.onBreakOut(panel); // suspend terminus (M6 refines)
    expect(panel.suspendCalls).toBe(1);

    // Wired seams: the batch-note toggle hits the panel methods (R3), the
    // wired external-editor seam fire-and-forgets into the panel method.
    expect(() => actions.onDiscuss(panel)).not.toThrow();
    actions.onBatchNote(panel); // options focus → open
    expect(panel.enterNoteMode).toHaveBeenCalledTimes(1);
    expect(panel.exitNoteMode).not.toHaveBeenCalled();
    const inNote = makePanel({ focus: "note" });
    actions.onBatchNote(inNote); // re-press → exit
    expect(inNote.exitNoteMode).toHaveBeenCalledTimes(1);
    expect(inNote.enterNoteMode).not.toHaveBeenCalled();
    expect(() => actions.onExternalEditor(panel)).not.toThrow();
    expect(panel.openExternalEditor).toHaveBeenCalledTimes(1);
  });
});

// ------------------------------------------------- batch note (R3) dispatch

describe("batch note (R3, P1.M4.T2.S2) — ctrl+shift+m toggle + esc exit", () => {
  test("test_ctrl_shift_m_intercept_fires_in_every_focus_incl_note", () => {
    // The re-press exit depends on the intercept firing while focus is
    // already "note" (it precedes text-forwarding in the resolution order).
    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    for (const focus of ["options", "text", "note"] as PanelFocus[]) {
      actions.onBatchNote.mockClear();
      const panel = makePanel({ focus });
      expect(route(DEFAULT_DATA.batchNote, panel)).toBe(true);
      expect(actions.onBatchNote).toHaveBeenCalledTimes(1);
    }
  });

  test("test_esc_in_note_focus_single_forwards_double_exits_note_mode", () => {
    // ESC-002: esc while the embedded editor holds focus belongs to the
    // editor FIRST — a single esc forwards (route returns false → the
    // panel hands the byte to the editor, pi-vim insert-mode exit etc.);
    // the SECOND esc within the window closes the prompt box only (note
    // write-through exit, no view descent, no suspend).
    const actions = defaultRoutedActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    const panel = makePanel({ view: "deep", focus: "note" });

    expect(route(ESCAPE, panel)).toBe(false); // forwarded to the editor
    expect(panel.exitNoteMode).not.toHaveBeenCalled();
    expect(panel.lastEscAt).toBeDefined(); // window armed

    expect(route(ESCAPE, panel)).toBe(true); // pair completes
    expect(panel.exitNoteMode).toHaveBeenCalledTimes(1);
    expect(panel.lastEscAt).toBeUndefined(); // anchor consumed
    expect(panel.view).toBe("deep"); // ladder untouched
    expect(panel.suspendCalls).toBe(0);
  });

  test("test_esc_in_text_focus_double_esc_closes_field_not_panel", () => {
    // Same contract on the explain editor: double esc = exitTextField (draft
    // write-through + blur), NEVER suspend.
    const actions = defaultRoutedActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    const panel = makePanel({ view: "short", focus: "text" });

    expect(route(ESCAPE, panel)).toBe(false);
    expect(route(ESCAPE, panel)).toBe(true);
    expect(panel.exitTextField).toHaveBeenCalledTimes(1);
    expect(panel.suspendCalls).toBe(0);
  });

  test("test_double_esc_window_reset_by_any_other_key", () => {
    // "Twice in a row" is strict: esc, then a non-esc key, then esc — the
    // second pair member never fires (the anchor was reset).
    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    const panel = makePanel({ focus: "note" });

    expect(route(ESCAPE, panel)).toBe(false);
    expect(route("x", panel)).toBe(false); // forwarded to the editor, resets
    expect(panel.lastEscAt).toBeUndefined();
    expect(route(ESCAPE, panel)).toBe(false); // a NEW first esc, not a pair
    expect(panel.exitNoteMode).not.toHaveBeenCalled();
  });

  test("test_esc_exit_window_zero_disables_the_pair", () => {
    const config = { ...DEFAULT_CONFIG, escExitWindowMs: 0 };
    const actions = defaultRoutedActions();
    const { route } = makeRouter(config, actions);
    const panel = makePanel({ focus: "note" });

    expect(route(ESCAPE, panel)).toBe(false);
    expect(route(ESCAPE, panel)).toBe(false); // still forwarded — no pair
    expect(panel.exitNoteMode).not.toHaveBeenCalled();
  });

  test("test_arrows_forward_to_the_editor_in_text_and_note_focus", () => {
    // ESC-002: while the editor is focused the fixed arrows belong to the
    // editor (caret movement) — the option cursor never moves.
    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);

    for (const focus of ["text", "note"] as PanelFocus[]) {
      const panel = makePanel({ focus });
      expect(route(UP, panel)).toBe(false);
      expect(route(DOWN, panel)).toBe(false);
      expect(actions.optionUp).not.toHaveBeenCalled();
      expect(actions.optionDown).not.toHaveBeenCalled();
    }

    // Options focus: unchanged — arrows drive the option cursor.
    const options = makePanel({ focus: "options" });
    expect(route(UP, options)).toBe(true);
    expect(actions.optionUp).toHaveBeenCalledTimes(1);
  });

  test("test_esc_outside_note_focus_still_descends_to_suspend", () => {
    const actions = defaultRoutedActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    const panel = makePanel(); // short view, options focus
    expect(route(ESCAPE, panel)).toBe(true);
    expect(panel.suspendCalls).toBe(1);
    expect(panel.exitNoteMode).not.toHaveBeenCalled();
    expect(panel.enterNoteMode).not.toHaveBeenCalled();
  });

  test("test_digits_are_never_quick_select_while_typing_a_note", () => {
    // R3: the note field is the SAME editor — typing digits into it is
    // legitimate, so quick-select must not intercept (h2.34 scoping).
    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    const panel = makePanel({ focus: "note" });
    expect(route("7", panel)).toBe(false);
    expect(actions.digit).not.toHaveBeenCalled();
  });
});

// ---------------------------------- deep-view routing gates (P1.M5.T1.S1)

describe("deep view routing gates (P1.M5.T1.S1)", () => {
  /**
   * Stub carrying the surface the REAL deep actions touch (deep-view.ts
   * operates on the panel directly — the router hard-wires them for the
   * deep view, so spies cannot stand in for up/down/enter here).
   */
  function makeDeepPanel() {
    const applied: Array<{ id: string; value: string }> = [];
    const q: Question = {
      id: "q1",
      prompt: "p",
      type: "choice",
      rev: 1,
      status: "open",
      options: [
        { value: "a", label: "a" },
        { value: "b", label: "b" },
      ],
      recommendation: "a",
    };
    const panel = {
      ...makePanel({ view: "deep" }),
      currentId: "q1",
      cursorIndex: 0,
      scrollOffset: 0,
      lastWidth: 80,
      theme: { fg: (_n: string, s: string) => s, bold: (s: string) => s },
      config: { ...DEFAULT_CONFIG },
      viewLogs: [] as string[],
      setView(v: PanelView) {
        this.viewLogs.push(v);
        this.view = v;
      },
      state: {
        goal: "goal",
        getQuestion: () => q,
        orderedQuestions: () => [q],
        applyAnswer: (id: string, a: { value: string }) => {
          applied.push({ id, value: a.value });
          // Mirrors InterrogationState.applyAnswer: fresh answer object +
          // status flip (acceptFromDeep's veto detection reads the assign).
          q.answer = { ...a, at: "t" };
          q.status = "answered";
        },
      },
      confirmRippleEdit: () => true,
    };
    return { panel: panel as unknown as InterrogationPanel & Record<string, unknown>, applied, q };
  }

  test("test_up_in_deep_moves_selection_not_option_cursor", () => {
    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    const { panel } = makeDeepPanel();
    panel.cursorIndex = 1;

    expect(route(UP, panel as unknown as InterrogationPanel)).toBe(true);
    expect(panel.cursorIndex).toBe(0); // deep selection moved up
    expect(actions.optionUp).not.toHaveBeenCalled(); // short-view cursor untouched
  });

  test("test_down_in_deep_moves_selection_within_option_domain", () => {
    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    const { panel } = makeDeepPanel();

    expect(route(DOWN, panel as unknown as InterrogationPanel)).toBe(true);
    expect(panel.cursorIndex).toBe(1);
    expect(route(DOWN, panel as unknown as InterrogationPanel)).toBe(true);
    expect(panel.cursorIndex).toBe(1); // clamped — no ✎ index in deep
    expect(actions.optionDown).not.toHaveBeenCalled();
  });

  test("test_updown_in_short_still_route_to_option_actions", () => {
    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    const panel = makePanel({ view: "short" }); // no deep surface needed

    expect(route(UP, panel as unknown as InterrogationPanel)).toBe(true);
    expect(actions.optionUp).toHaveBeenCalledTimes(1);
    expect(route(DOWN, panel as unknown as InterrogationPanel)).toBe(true);
    expect(actions.optionDown).toHaveBeenCalledTimes(1);
  });

  test("test_enter_in_deep_accepts_and_returns_to_short", () => {
    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    const { panel, applied } = makeDeepPanel();
    panel.cursorIndex = 1;

    expect(route(ENTER, panel as unknown as InterrogationPanel)).toBe(true);
    expect(applied).toEqual([{ id: "q1", value: "b" }]); // highlighted option
    expect(panel.viewLogs).toEqual(["short"]); // returned to the short form
    expect(actions.accept).not.toHaveBeenCalled(); // short-view accept untouched
  });

  test("test_ctrl_t_gate_does_not_break_deep_view_neighbor_bindings", () => {
    // BUG-011 fall-through: ctrl+t in deep returns false WITHOUT dispatching,
    // and the view-specific handlers downstream still work — enter here
    // still runs the acceptFromDeep path (accepts highlighted, → short).
    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    const { panel, applied } = makeDeepPanel();
    panel.cursorIndex = 1;

    expect(route(DEFAULT_DATA.focusText, panel as unknown as InterrogationPanel)).toBe(false);
    expect(actions.onFocusText).not.toHaveBeenCalled();
    expect(dispatchCount(actions)).toBe(0); // nothing else consumed it either

    expect(route(ENTER, panel as unknown as InterrogationPanel)).toBe(true);
    expect(applied).toEqual([{ id: "q1", value: "b" }]);
    expect(panel.viewLogs).toEqual(["short"]);
    expect(actions.accept).not.toHaveBeenCalled();
  });

  test("test_enter_in_text_focus_still_forwards_in_deep", () => {
    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    const { panel } = makeDeepPanel();
    panel.focus = "text";

    expect(route(ENTER, panel as unknown as InterrogationPanel)).toBe(false);
    expect(panel.viewLogs).toEqual([]); // no view change — forwarded
  });

  test("test_esc_in_deep_descends_to_short_via_ladder", () => {
    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    const { panel } = makeDeepPanel();

    expect(route(ESCAPE, panel as unknown as InterrogationPanel)).toBe(true);
    expect(panel.view).toBe("short"); // ladder descent, unchanged semantics
    expect(actions.all.reduce((n, m) => n + m.mock.calls.length, 0)).toBe(0);
  });

  test("test_config_intercepts_still_fire_in_deep_view", () => {
    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    const { panel } = makeDeepPanel();

    expect(route(DEFAULT_DATA.deep, panel as unknown as InterrogationPanel)).toBe(true);
    expect(actions.onDeep).toHaveBeenCalledTimes(1); // toggle back to short
    expect(route(DEFAULT_DATA.submit, panel as unknown as InterrogationPanel)).toBe(true);
    expect(actions.submit).toHaveBeenCalledTimes(1);
    expect(route(DEFAULT_DATA.overview, panel as unknown as InterrogationPanel)).toBe(true);
    expect(actions.onOverview).toHaveBeenCalledTimes(1);
  });
});

// ------------------------------------------- overview view-gating (P1.M5.T2.S1)

describe("buildKeyRouter — overview view-gating (P1.M5.T2.S1)", () => {
  function overviewQ(id: string): Question {
    return {
      id,
      prompt: `p:${id}`,
      type: "choice",
      rev: 1,
      status: "open",
      options: [
        { value: "a", label: "a" },
        { value: "b", label: "b" },
      ],
      recommendation: "a",
    };
  }

  /**
   * Stub carrying the surface the REAL overview actions touch
   * (overview.ts operates on the panel directly — the router hard-wires
   * them for the overview view, so spies cannot stand in for up/down/
   * enter here; mirrors makeDeepPanel above).
   */
  function makeOverviewPanel() {
    const qs: Question[] = [overviewQ("q1"), overviewQ("q2"), overviewQ("q3")];
    const panel = {
      ...makePanel({ view: "overview" }),
      currentId: "q1",
      cursorIndex: 0,
      overviewCursor: 0,
      overviewScroll: 0,
      lastWidth: 80,
      theme: { fg: (_n: string, s: string) => s, bold: (s: string) => s },
      config: { ...DEFAULT_CONFIG },
      flash: vi.fn(),
      blurTextField: vi.fn(),
      viewLogs: [] as string[],
      setView(v: PanelView) {
        this.viewLogs.push(v);
        this.view = v;
      },
      state: { orderedQuestions: () => qs },
    };
    return { panel: panel as unknown as InterrogationPanel & Record<string, unknown>, qs };
  }

  test("test_updown_in_overview_moves_cursor_row_not_option_cursor", () => {
    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    const { panel } = makeOverviewPanel();

    expect(route(UP, panel as unknown as InterrogationPanel)).toBe(true);
    expect(panel.overviewCursor).toBe(0); // clamped at the top — consumed no-op
    expect(route(DOWN, panel as unknown as InterrogationPanel)).toBe(true);
    expect(panel.overviewCursor).toBe(1);
    expect(route(DOWN, panel as unknown as InterrogationPanel)).toBe(true);
    expect(route(DOWN, panel as unknown as InterrogationPanel)).toBe(true);
    expect(panel.overviewCursor).toBe(2); // clamped at the last question
    // The short-view option cursor and question pointer are NEVER touched.
    expect(panel.cursorIndex).toBe(0);
    expect(panel.currentId).toBe("q1");
    expect(actions.optionUp).not.toHaveBeenCalled();
    expect(actions.optionDown).not.toHaveBeenCalled();
  });

  test("test_config_prev_next_in_overview_move_cursor_row", () => {
    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    const { panel } = makeOverviewPanel();
    panel.overviewCursor = 1;

    // Contract 3: the config question-nav keys move the overview CURSOR.
    expect(route(DEFAULT_DATA.prevQuestion, panel as unknown as InterrogationPanel)).toBe(true);
    expect(panel.overviewCursor).toBe(0);
    expect(route(DEFAULT_DATA.nextQuestion, panel as unknown as InterrogationPanel)).toBe(true);
    expect(panel.overviewCursor).toBe(1);
    // currentId untouched — only enter/esc leave the overview list.
    expect(panel.currentId).toBe("q1");
    expect(actions.prevQuestion).not.toHaveBeenCalled();
    expect(actions.nextQuestion).not.toHaveBeenCalled();
  });

  test("test_enter_in_overview_jumps_to_short_form", () => {
    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    const { panel } = makeOverviewPanel();
    panel.overviewCursor = 1;

    expect(route(ENTER, panel as unknown as InterrogationPanel)).toBe(true);
    expect(panel.viewLogs).toEqual(["short"]); // jump target is ALWAYS short
    expect(panel.currentId).toBe("q2"); // the selected question
    expect(panel.overviewScroll).toBe(0); // scroll window reset
    expect(actions.accept).not.toHaveBeenCalled(); // short accept untouched
  });

  test("test_enter_in_text_focus_still_forwards_in_overview", () => {
    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    const { panel } = makeOverviewPanel();
    panel.focus = "text";

    expect(route(ENTER, panel as unknown as InterrogationPanel)).toBe(false);
    expect(panel.viewLogs).toEqual([]); // no view change — forwarded
  });

  test("test_digits_do_not_quick_select_in_overview", () => {
    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    const { panel } = makeOverviewPanel();

    expect(route("3", panel as unknown as InterrogationPanel)).toBe(false);
    expect(actions.digit).not.toHaveBeenCalled(); // no option accepted on q1
    // Control: the SAME byte in the short form still quick-selects.
    const short = makePanel({ view: "short" });
    expect(route("3", short as unknown as InterrogationPanel)).toBe(true);
    expect(actions.digit).toHaveBeenCalledTimes(1);
    expect(actions.digit).toHaveBeenCalledWith(short as unknown as InterrogationPanel, 3);
  });

  test("test_config_intercepts_still_fire_in_overview_view", () => {
    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    const { panel } = makeOverviewPanel();

    expect(route(DEFAULT_DATA.deep, panel as unknown as InterrogationPanel)).toBe(true);
    expect(actions.onDeep).toHaveBeenCalledTimes(1);
    expect(route(DEFAULT_DATA.overview, panel as unknown as InterrogationPanel)).toBe(true);
    expect(actions.onOverview).toHaveBeenCalledTimes(1); // toggle back
    expect(route(DEFAULT_DATA.submit, panel as unknown as InterrogationPanel)).toBe(true);
    expect(actions.submit).toHaveBeenCalledTimes(1);
    expect(route(DEFAULT_DATA.batchNote, panel as unknown as InterrogationPanel)).toBe(true);
    expect(actions.onBatchNote).toHaveBeenCalledTimes(1); // note mode at ANY view
  });
});

// --------------------------------------- focusText view gate (BUG-011)

describe("focusText gated to the short view (BUG-011)", () => {
  test("test_ctrl_t_in_deep_view_falls_through_without_dispatching", () => {
    // The editor renders only in the short view — ctrl+t in deep must be a
    // no-op FALL-THROUGH (return false), never a swallowed keystroke.
    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    expect(route(DEFAULT_DATA.focusText, makePanel({ view: "deep" }))).toBe(false);
    expect(actions.onFocusText).not.toHaveBeenCalled();
    expect(dispatchCount(actions)).toBe(0);
  });

  test("test_ctrl_t_in_overview_view_falls_through_without_dispatching", () => {
    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    expect(route(DEFAULT_DATA.focusText, makePanel({ view: "overview" }))).toBe(false);
    expect(actions.onFocusText).not.toHaveBeenCalled();
    expect(dispatchCount(actions)).toBe(0);
  });

  test("test_ctrl_t_in_short_view_still_dispatches_options_and_text_focus", () => {
    const actions = makeActions();
    const { route } = makeRouter(DEFAULT_CONFIG, actions);
    // Options focus (default view short): dispatched as before.
    expect(route(DEFAULT_DATA.focusText, makePanel())).toBe(true);
    expect(actions.onFocusText).toHaveBeenCalledTimes(1);
    // Text focus (the line-284 case — default view short): still dispatched.
    expect(route(DEFAULT_DATA.focusText, makePanel({ focus: "text" }))).toBe(true);
    expect(actions.onFocusText).toHaveBeenCalledTimes(2);
  });
});

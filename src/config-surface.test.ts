/**
 * src/config-surface.test.ts — AC-12 config-surface validation (P1.M7.T5.S2).
 *
 * End-to-end proof that every one of the 9 `keys.*` actions (R5 / commitment
 * 7 / AC-12, as amended by the breakOut removal) is remappable and that
 * every display string naming a key flows from the resolved config (h2.52):
 * full-remap configs drive the panel router (all 9 actions, both
 * directions), the footer (all screens + narrow mode), and the suspend
 * widget line — plus the all-9-actions invalid-value fallback sweep and a
 * dialog/warning audit. NO global registerShortcut surface exists anymore
 * (the ctrl+shift+q chord was removed — window managers claim it on many
 * desktops). The companion guard `no-hardcoded-keys.test.ts` makes the
 * no-hardcoded-labels rule un-regressible at the source level.
 *
 * ## Remappability audit [Mode A] — input to P1.M7.T7.S2's README keymap table
 *
 * | action          | default       | verified remap | router | registerShortcut | label surfaces rendered today        | notes |
 * |-----------------|---------------|----------------|--------|------------------|---------------------------------------|-------|
 * | deep            | ctrl+d        | ctrl+alt+d     | ✓      | n/a (panel-only) | footer (short, overview)              | |
 * | overview        | ctrl+l        | ctrl+shift+l   | ✓      | n/a              | footer (short, deep)                  | |
 * | focusText       | ctrl+t        | ctrl+y         | ✓      | n/a              | none rendered (no string names it)    | |
 * | batchNote       | ctrl+shift+m  | ctrl+shift+n   | ✓      | n/a              | none rendered (note header omits key) | |
 * | submit          | ctrl+s        | f9             | ✓      | n/a              | footer (every screen incl. narrow)    | |
 * | discuss         | ctrl+shift+e  | ctrl+shift+p   | ✓      | n/a              | none rendered (discuss text omits key)| |
 * | externalEditor  | ctrl+g        | ctrl+u         | ✓      | n/a              | none rendered                         | text-focus gated |
 * | prevQuestion    | tab           | left           | ✓      | n/a              | none rendered                         | |
 * | nextQuestion    | shift+tab     | right          | ✓      | n/a              | none rendered                         | |
 *
 * Fixed keys (NOT config-driven, by design — h2.34, out of AC-12 scope):
 * `up`/`down`/`left`/`right`/`esc`/`enter` plus digit quick-select 1–9.
 * left/right are the FULL-list question navigation arrows (prev/next,
 * view-aware like the config keys; never intercepted in text/note focus).
 * Rendered strings may name ONLY these (ripple confirm "enter=keep,
 * esc=cancel", footer statics "enter accept" / "esc back" / "↑/↓ scroll" /
 * "enter jump"). No unremappable `keys.*` action exists → no bugs against
 * commitment 7. The historical `breakOut` action is GONE (chord removed).
 *
 * ## Keymap conflict re-verification (hand-off note for P1.M7.T7.S2)
 *
 * Re-verified against
 * plan/001_0d6760db6bc5/architecture/environment-and-conflicts.md:59-87:
 * avoid in README examples — the ctrl+b family / ctrl+shift+b, x, j and
 * shift+down (pi-patty-bg-tasks), ctrl+shift+s / ctrl+shift+w (pi-web-access,
 * if loaded), ctrl+shift+f and ctrl+shift+up/down (pi built-in transcript
 * search/nav), and ctrl+m (editor-local cursorLeft). Defaults
 * ctrl+shift+m/q/e remain FREE; pi built-ins already claim ctrl+s/d/l/t/g
 * (panel intercepts first, documented — Mode A intercept rule). The remap
 * targets used here (ctrl+alt+d, ctrl+shift+l, ctrl+y, ctrl+shift+n, f9,
 * ctrl+alt+b, ctrl+shift+p, ctrl+u, left, right) collide with none of the
 * above. Re-verify in the target environment at build time.
 *
 * Conventions follow panel/keys.test.ts + command.test.ts: no runtime, fakes
 * cast to the narrow structural surface, spies for actions, RAW terminal data
 * round-tripped through matchesKey at fixture time (grammar drift fails
 * loudly), and DEFAULT_CONFIG imported/derived — never copy-pasted literals.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, type KeyId } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, test, vi, type Mock } from "vitest";
import {
  DEFAULT_CONFIG,
  loadConfigFrom,
  resolveKeyLabels,
  type InterrogatorConfig,
  type KeyAction,
} from "./config.js";
import { registerInterrogateCommand } from "./command.js";
import { buildKeyRouter, parseAccelerator, resolveBindings, type RoutedActions } from "./panel/keys.js";
import { renderConfirmFooter, renderFooter, renderNoteHeader, type ScreenKind } from "./panel/layout.js";
import type { PanelFocus, PanelHost, PanelView, InterrogationPanel } from "./panel/panel.js";
import { gateWarningLine } from "./panel/gate.js";
import { buildSuspendWidgetLine } from "./panel/suspend.js";
import {
  createInterrogationState,
  type InterrogationState,
  type Question,
  type SerializedState,
} from "./state.js";

// ------------------------------------------------------------------ fixtures

const ALL_ACTIONS = Object.keys(DEFAULT_CONFIG.keys) as KeyAction[];

/** Raw terminal data for each h2.34 DEFAULT accelerator (keys.test.ts table). */
const DEFAULT_DATA: Record<KeyAction, string> = {
  deep: "\u0004", // ctrl+d
  overview: "\u000c", // ctrl+l
  focusText: "\u0014", // ctrl+t
  batchNote: "\u001b[109;6u", // kitty CSI-u ctrl+shift+m (m = 109)
  submit: "\u0013", // ctrl+s
  discuss: "\u001b[101;6u", // kitty CSI-u ctrl+shift+e (e = 101)
  externalEditor: "\u0007", // ctrl+g
  prevQuestion: "\t",
  nextQuestion: "\u001b[Z",
};

/**
 * The full remap under test — one DISTINCTIVE, valid, non-conflicting
 * accelerator per action (all verified against pi-tui matchesKey below and
 * against the keymap-conflict table in the JSDoc header).
 */
const REMAPS: Record<KeyAction, { key: string; data: string }> = {
  deep: { key: "ctrl+alt+d", data: "\u001b\u0004" }, // legacy ESC + control byte
  overview: { key: "ctrl+shift+l", data: "\u001b[108;6u" }, // kitty CSI-u (l = 108)
  focusText: { key: "ctrl+y", data: "\u0019" }, // 0x19 = ctrl+y
  batchNote: { key: "ctrl+shift+n", data: "\u001b[110;6u" }, // kitty (n = 110)
  submit: { key: "f9", data: "\u001b[20~" },
  discuss: { key: "ctrl+shift+p", data: "\u001b[112;6u" }, // kitty (p = 112)
  externalEditor: { key: "ctrl+u", data: "\u0015" }, // 0x15 = ctrl+u
  // NOTE: prev/next deliberately do NOT remap to left/right — those are
  // FIXED keys now (question navigation); the remap must stay distinct so
  // the exhaustive remap proves the CONFIG layer, not the fixed branch.
  prevQuestion: { key: "f5", data: "\u001b[15~" },
  nextQuestion: { key: "f6", data: "\u001b[17~" },
};

/** A config with ALL 9 actions remapped — the PRD's example user settings. */
const FULL_REMAP: InterrogatorConfig = {
  ...DEFAULT_CONFIG,
  keys: Object.fromEntries(ALL_ACTIONS.map((a) => [a, REMAPS[a].key])) as InterrogatorConfig["keys"],
};

/** Router spy handling each action (the RoutedActions member the router calls). */
const SPY_FOR: Record<KeyAction, Exclude<keyof ReturnType<typeof makeActions>, "all">> = {
  deep: "onDeep",
  overview: "onOverview",
  focusText: "onFocusText",
  batchNote: "onBatchNote",
  submit: "submit",
  discuss: "onDiscuss",
  externalEditor: "onExternalEditor",
  prevQuestion: "prevQuestion",
  nextQuestion: "nextQuestion",
};

/** Human action words the footer composes ("{label} {action}" pairs). */
const WORDS: Record<KeyAction, string> = {
  deep: "deep",
  overview: "list",
  focusText: "text",
  batchNote: "note",
  submit: "submit",
  discuss: "discuss",
  externalEditor: "editor",
  prevQuestion: "prev",
  nextQuestion: "next",
};

/** Footer key-hint set per screen (mirror of layout SCREEN_KEYS — drift fails loudly below). */
const FOOTER_ACTIONS: Record<ScreenKind, KeyAction[]> = {
  short: ["deep", "overview", "submit"],
  deep: ["submit", "overview"],
  overview: ["submit", "deep"],
};

/** Static (fixed-key) footer hints per screen — enter/esc/arrows are NOT config-driven. */
const STATIC_HINTS: Record<ScreenKind, string[]> = {
  short: ["enter accept"],
  deep: ["esc back", "↑/↓ scroll"],
  overview: ["enter jump", "esc back"],
};

function configWithKeys(keys: Partial<Record<KeyAction, string>>): InterrogatorConfig {
  return { ...DEFAULT_CONFIG, keys: { ...DEFAULT_CONFIG.keys, ...keys } };
}

/** Real panel interface + test observability fields (keys.test.ts pattern). */
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

/** externalEditor is text-focus context (h2.34); everything else runs from options focus. */
function panelFor(action: KeyAction): PanelStub {
  return makePanel(action === "externalEditor" ? { focus: "text" } : {});
}

/** Round-trip guard: the raw data MUST match its accelerator via matchesKey. */
function expectMatches(data: string, keyId: KeyId, label: string): void {
  if (!matchesKey(data, keyId)) {
    throw new Error(`fixture broken: matchesKey(${JSON.stringify(data)}, "${keyId}") — ${label}`);
  }
}

/** Identity theme for render assertions (layout.test.ts stub convention). */
const theme = {
  fg: (_name: string, s: string) => s,
  bold: (s: string) => s,
} as unknown as Theme;

function footerState(): SerializedState {
  const q1: Question = {
    id: "q1",
    title: "Title q1",
    prompt: "prompt:q1",
    type: "choice",
    rev: 1,
    status: "open",
  };
  return { goal: "Ship the thing", epoch: 0, order: ["q1"], questions: { q1 }, completed: false };
}

function choiceQ(id: string): Question {
  return {
    id,
    title: `Title ${id}`,
    prompt: `prompt:${id}`,
    type: "choice",
    rev: 1,
    status: "open",
    options: [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ],
  };
}

/** Real InterrogationState seeded through the raw primitives (suspend.test.ts pattern). */
function makeInterrogationState(open: number, answered: number): InterrogationState {
  const state = createInterrogationState("goal");
  let i = 0;
  for (let j = 0; j < open; j++, i++) state.upsertQuestion(choiceQ(`q${i + 1}`));
  for (let j = 0; j < answered; j++, i++) {
    const q = choiceQ(`q${i + 1}`);
    state.upsertQuestion(q);
    state.applyAnswer(q.id, { value: "a", at: "t" });
  }
  return state;
}

// ------------------------------------------------------------ settings files

const cleanup: string[] = [];

/** Write a settings.json under a fresh temp dir; returns its path (config.test.ts pattern). */
async function writeSettings(body: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-interrogator-surface-"));
  cleanup.push(dir);
  const p = path.join(dir, "settings.json");
  await fs.writeFile(p, body, "utf8");
  return p;
}

afterEach(async () => {
  vi.restoreAllMocks();
  const dirs = cleanup.splice(0);
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
});

// ------------------------------------------------- fixture round-trip guard

describe("AC-12 fixture round-trip (grammar drift fails loudly)", () => {
  test("test_fixture_key_tables_round_trip_through_matchesKey", () => {
    const defaultBindings = resolveBindings(DEFAULT_CONFIG);
    const remapBindings = resolveBindings(FULL_REMAP);
    for (const action of ALL_ACTIONS) {
      expectMatches(DEFAULT_DATA[action], defaultBindings[action], `default ${action}`);
      expectMatches(REMAPS[action].data, remapBindings[action], `remapped ${action}`);
    }
  });

  test("test_full_remap_bindings_are_exactly_the_remap_table", () => {
    const bindings = resolveBindings(FULL_REMAP);
    for (const action of ALL_ACTIONS) {
      expect(bindings[action]).toBe(parseAccelerator(REMAPS[action].key));
    }
  });
});

// ------------------------------------------ exhaustive remap: 10 × 2 directions

describe("AC-12 exhaustive remap — all 9 actions, both directions", () => {
  test("test_every_action_fires_on_its_remapped_accelerator", () => {
    for (const action of ALL_ACTIONS) {
      const actions = makeActions();
      const route = buildKeyRouter(FULL_REMAP, actions);
      const panel = panelFor(action);
      const consumed = route(REMAPS[action].data, panel);
      expect(consumed, `${action} must fire on remap "${REMAPS[action].key}"`).toBe(true);
      expect(actions[SPY_FOR[action]], `${action} routes to its own handler`).toHaveBeenCalledTimes(1);
      expect(dispatchCount(actions), `${action} must dispatch exactly once`).toBe(1);
    }
  });

  test("test_every_default_accelerator_is_released_after_full_remap", () => {
    for (const action of ALL_ACTIONS) {
      const actions = makeActions();
      const route = buildKeyRouter(FULL_REMAP, actions);
      const panel = panelFor(action);
      const consumed = route(DEFAULT_DATA[action], panel);
      expect(consumed, `${action} default ${JSON.stringify(DEFAULT_DATA[action])} must be released`).toBe(false);
      expect(dispatchCount(actions), `nothing may fire for released ${action} default`).toBe(0);
    }
  });

  test("test_remapped_actions_fire_from_text_focus_too_intercept_rule", () => {
    // The h2.34 intercept rule holds for ANY binding, not just defaults:
    // remapped panel keys stay consumed while the user types in the editor.
    for (const action of ALL_ACTIONS) {
      if (action === "externalEditor") continue; // already text-gated in the exhaustive test
      const actions = makeActions();
      const route = buildKeyRouter(FULL_REMAP, actions);
      const panel = makePanel({ focus: "text" });
      expect(route(REMAPS[action].data, panel), `${action} remap fires in text focus`).toBe(true);
      expect(actions[SPY_FOR[action]]).toHaveBeenCalledTimes(1);
    }
  });
});

// ------------------------------------------- no global shortcut (breakOut removal)

describe("no global shortcut surface (breakOut removal)", () => {
  /** Capture registration through a spy pi (command.test.ts harness, registration-only). */
  function captureRegistration(config: InterrogatorConfig): {
    commands: string[];
    shortcutCalls: unknown[][];
  } {
    const commands: string[] = [];
    const shortcutCalls: unknown[][] = [];
    const pi = {
      registerCommand: vi.fn((name: string) => {
        commands.push(name);
      }),
      registerShortcut: vi.fn((...args: unknown[]) => {
        shortcutCalls.push(args);
      }),
    };
    registerInterrogateCommand(pi as unknown as ExtensionAPI, config, {} as unknown as PanelHost);
    return { commands, shortcutCalls };
  }

  test("test_no_shortcut_registered_under_default_or_full_remap", () => {
    // The ctrl+shift+q chord closes windows on many desktop environments
    // (the WM claims it before the terminal sees the bytes) — the extension
    // must never register a global shortcut, under ANY config.
    for (const config of [DEFAULT_CONFIG, FULL_REMAP]) {
      const { commands, shortcutCalls } = captureRegistration(config);
      expect(commands).toEqual(["interrogate"]);
      expect(shortcutCalls).toEqual([]);
    }
  });
});

// ------------------------------------------------------- label propagation

describe("label propagation — full remap (h2.52: config-generated display strings)", () => {
  test("test_resolveKeyLabels_full_remap_drops_every_default_label", () => {
    const remapped = resolveKeyLabels(FULL_REMAP);
    const defaults = resolveKeyLabels(DEFAULT_CONFIG);
    for (const action of ALL_ACTIONS) {
      expect(remapped[action], `${action} label must follow the remap`).not.toBe(defaults[action]);
    }
    // Exact grammar spot checks: capitalized "+"-joined tokens.
    expect(remapped.submit).toBe("F9");
    expect(remapped.prevQuestion).toBe("F5");
    expect(remapped.nextQuestion).toBe("F6");
    expect(Object.keys(remapped)).toHaveLength(9);
  });

  test("test_footer_reflects_remapped_labels_and_no_defaults_on_every_screen", () => {
    const remapped = resolveKeyLabels(FULL_REMAP);
    const defaults = resolveKeyLabels(DEFAULT_CONFIG);
    for (const screen of ["short", "deep", "overview"] as ScreenKind[]) {
      const footer = renderFooter(footerState(), screen, remapped, theme, 120);
      for (const action of FOOTER_ACTIONS[screen]) {
        expect(footer, `${screen}: remapped hint for ${action}`).toContain(
          `${remapped[action]} ${WORDS[action]}`,
        );
        expect(footer, `${screen}: default hint for ${action} must be gone`).not.toContain(
          `${defaults[action]} ${WORDS[action]}`,
        );
      }
      for (const stat of STATIC_HINTS[screen]) {
        expect(footer, `${screen}: fixed-key hint "${stat}" survives`).toContain(stat);
      }
    }
  });

  test("test_narrow_footer_keeps_remapped_submit_and_deep_hints", () => {
    // P1.M7.T5.S1 interplay: narrow mode collapses to {submit, deep} — with
    // config-resolved labels (never the defaults).
    const remapped = resolveKeyLabels(FULL_REMAP);
    const footer = renderFooter(footerState(), "short", remapped, theme, 80, true);
    expect(footer).toContain(`${remapped.submit} submit`);
    expect(footer).toContain(`${remapped.deep} deep`);
    expect(footer).not.toContain(`${remapped.overview} list`); // narrow drops the overview hint
    expect(footer).not.toContain("Ctrl+S submit");
    expect(footer).not.toContain("Ctrl+D deep");
  });

  test("test_suspend_widget_line_names_command_only_never_a_key_chord", () => {
    // breakOut removal: the widget line takes NO labels at all — it names
    // /interrogate only. A key chord (which the WM may claim for closing
    // windows) must never appear, under default OR fully remapped config.
    const state = makeInterrogationState(2, 1);
    const line = buildSuspendWidgetLine(state);
    expect(line).toBe("2 open · 1 answered — /interrogate to resume");
    expect(line).not.toMatch(/ctrl|alt\+|super\+|shift\+|tab/i);
  });

  test("test_dialog_and_warning_strings_name_only_fixed_keys", () => {
    // Ripple-confirm footer: enter/esc are FIXED keys (Mode A) — allowed;
    // no config-driven (ctrl/alt/super/shift+) label may ever appear here.
    const confirm = renderConfirmFooter(["q1", "q2"], theme, 80);
    expect(confirm).toContain("enter=keep, esc=cancel");
    expect(confirm).not.toMatch(/ctrl|\balt\+|super\+|shift\+/i);
    // Gate warning names no keys at all.
    const gate = gateWarningLine(3);
    expect(gate).toBe("⚠ 3 foundational unanswered — later answers may shift");
    expect(gate).not.toMatch(/ctrl|alt\+|super\+|shift\+|tab|\besc\b|\benter\b/i);
    // Batch-note title names no keys (the ctrl+shift+m binding is never spelled out).
    const note = renderNoteHeader(theme, 80);
    expect(note).toContain("NOTE — ships with next submission");
    expect(note).not.toMatch(/ctrl|alt\+|super\+|shift\+|tab/i);
  });
});

// ------------------------------------------------- invalid-config fallback sweep

describe("invalid-config fallback sweep — all 9 actions (one warn each)", () => {
  test("test_all_nine_invalid_accelerators_fall_back_to_defaults_with_one_warn_each", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const defaults = resolveBindings(DEFAULT_CONFIG);
    const broken = Object.fromEntries(ALL_ACTIONS.map((a) => [a, "ctrl+"])) as InterrogatorConfig["keys"];
    const bindings = resolveBindings({ ...DEFAULT_CONFIG, keys: broken });
    for (const action of ALL_ACTIONS) {
      expect(bindings[action], `${action} falls back to its default`).toBe(defaults[action]);
    }
    expect(warn).toHaveBeenCalledTimes(ALL_ACTIONS.length);
    for (const action of ALL_ACTIONS) {
      const calls = warn.mock.calls.filter((args) => args.join(" ").includes(`"${action}"`));
      expect(calls, `${action} warns exactly once`).toHaveLength(1);
    }
  });

  test("test_other_invalid_grammar_variants_also_release_to_defaults", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const defaults = resolveBindings(DEFAULT_CONFIG);
    const bad = ["ctrl+", "hyper+x", "ctrl+ctrl+d", "not a key!!", "   "];
    for (const value of bad) {
      expect(resolveBindings(configWithKeys({ submit: value })).submit).toBe(defaults.submit);
    }
    expect(warn).toHaveBeenCalledTimes(bad.length);
  });

  test("test_empty_string_key_is_coerced_to_default_at_load_time_silently", async () => {
    // coerceKeys rejects empty strings at LOAD time (config.ts), so the
    // binding layer never sees them — no warn, plain default.
    const p = await writeSettings(JSON.stringify({ interrogator: { keys: { submit: "" } } }));
    const cfg = await loadConfigFrom({ global: p });
    expect(cfg.keys.submit).toBe(DEFAULT_CONFIG.keys.submit);
  });

  test("test_end_to_end_settings_file_loads_normalizes_and_falls_back_with_single_warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = await writeSettings(
      JSON.stringify({ interrogator: { keys: { submit: "ctrl+", discuss: " Ctrl+Shift+P " } } }),
    );
    const cfg = await loadConfigFrom({ global: p });
    // Non-empty strings survive load verbatim (validation is the binding layer's job)…
    expect(cfg.keys.discuss).toBe(" Ctrl+Shift+P ");
    // …the valid-but-unnormalized value binds identically to its normalized form…
    const bindings = resolveBindings(cfg); // resolve ONCE — each resolve warns per invalid action
    expect(bindings.discuss).toBe("ctrl+shift+p");
    // …and the invalid grammar falls back with exactly ONE warn (submit only).
    expect(bindings.submit).toBe(DEFAULT_CONFIG.keys.submit);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]!.join(" ")).toContain('"submit"');
  });
});

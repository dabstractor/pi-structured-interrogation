/**
 * src/panel/keys.ts — config-driven key dispatch (P1.M3.T3.S1).
 *
 * The single raw-key dispatcher for the interrogation panel (h2.34): given
 * raw terminal input `data` plus the panel's current view/focus, the router
 * built by {@link buildKeyRouter} resolves AT MOST ONE action, invokes the
 * matching handler, and returns whether it consumed the input. Everything
 * unmatched forwards (`false` → the embedded editor when text-focused, else
 * the panel's default nav / ignore).
 *
 * ## Mode A — the intercept rule (h2.34)
 *
 * The panel owns raw keyboard focus (via `ctx.ui.custom()` —
 * questionnaire.ts pattern), so pi's own keybinding layer never sees these
 * keystrokes. Panel-level keys are therefore intercepted BEFORE any
 * forwarding, and this INCLUDES text focus: `ctrl+s` submit while the user
 * types in the embedded free-text field must submit, not insert a control
 * char. Concretely, the config-driven intercepts in step 4 of the resolution
 * order are valid whenever the panel is open, `focus === "text"` included.
 * The one fixed-key exception is `enter` (see below).
 *
 * ## Mode A — fixed keys (never config-driven)
 *
 * `up`, `down`, `esc`, and `enter` are FIXED: they are deliberately absent
 * from the `KeyAction` config union (config.ts), so a user cannot remap or
 * shadow them by construction. They are checked BEFORE every config
 * accelerator — arrows first, because arrow sequences are ESC-prefixed and
 * an esc branch checked earlier would eat them. `enter` interception applies
 * only when focus is on the options region; in text/note focus `enter`
 * FORWARDS so the embedded field (P1.M4.T1.S2) can implement its two-stage
 * save — this is the single exception to the intercept rule (note focus is
 * intercepted even earlier, at the panel level: stage-1 saves + exits).
 * `esc` descends the view ladder — exiting note mode first when note focus
 * is active (h2.32) — and finally suspends without destroying anything
 * (FR-16).
 *
 * ## Mode A — single dispatch + collision ordering
 *
 * At most ONE handler runs per input event: first match wins. If a user maps
 * two actions to the same accelerator, the action EARLIER in the resolution
 * order below wins — this is documented, deliberate behavior, not an error.
 * Resolution order (load-bearing — do not reorder casually):
 *
 *   1. up / down                (fixed — option cursor)
 *   2. esc                      (fixed — view-descent ladder, then suspend)
 *   3. enter                    (fixed — options focus only → accept)
 *   4. config intercepts, in this order:
 *      deep, overview, focusText, batchNote, submit, breakOut, discuss,
 *      externalEditor (only when focus === "text"), prevQuestion,
 *      nextQuestion, then digits 1–9 (only when digitQuickSelect AND focus
 *      is NOT "text"/"note" — typing digits into an answer or a note is
 *      legitimate; h2.34 scopes quick-select to the short-form options
 *      focus)
 *   5. no match → return false (forward to embedded editor / default nav)
 *
 * Accelerator validation: config strings arrive RESOLVED (defaults merged by
 * loadConfig) in pi's lowercase KeyId form, so they need only normalization
 * + validation — never translation. An invalid entry (e.g. "ctrl+") falls
 * back to the h2.52 default for that action with a single console.warn, so a
 * settings.json typo cannot brick the panel.
 */
import { Key, matchesKey, parseKey, type KeyId } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG, type InterrogatorConfig, type KeyAction } from "../config.js";
import { panelActions, type SubmitDeps } from "./actions.js";
import type { InterrogationPanel } from "./panel.js";

/**
 * Seam callbacks for actions whose owning modules land later. Navigation /
 * accept / digit / submit delegate to the named-action registry
 * (actions.ts, P1.M3.T2.S2); `submit` receives a host-pre-bound
 * {@link SubmitDeps} wrapper (the deps never flow through keys.ts).
 * The `on*` callbacks mutate the panel directly and are replaced by their
 * owning tasks (M4 text editor / batch note, M5 ripple, M6 widget + discuss).
 */
export interface RoutedActions {
  optionUp(p: InterrogationPanel): boolean;
  optionDown(p: InterrogationPanel): boolean;
  /** Quick-select option n (1-based). The router returns this boolean verbatim. */
  digit(p: InterrogationPanel, n: number): boolean;
  accept(p: InterrogationPanel): boolean;
  prevQuestion(p: InterrogationPanel): boolean;
  nextQuestion(p: InterrogationPanel): boolean;
  /** Host pre-binds SubmitDeps (sendMessage + isIdle) — inert when absent. */
  submit(p: InterrogationPanel): boolean;
  /** View toggle short↔deep (enters set deepSticky). M5 refines. */
  onDeep(p: InterrogationPanel): void;
  /** View toggle overview↔(deepSticky ? deep : short). M5 refines. */
  onOverview(p: InterrogationPanel): void;
  /** Focus the text editor. Default: focus = "text" (M4 refines). */
  onFocusText(p: InterrogationPanel): void;
  /**
   * Batch note (R3, h2.32): toggle note mode — enterNoteMode from any
   * focus/view, exitNoteMode on re-press. Implemented by the default set.
   */
  onBatchNote(p: InterrogationPanel): void;
  /** Break out. Default: suspend (M6 refines + global shortcut half). */
  onBreakOut(p: InterrogationPanel): void;
  /** Discuss in chat. M6.T2.S2 wires; default no-op. */
  onDiscuss(p: InterrogationPanel): void;
  /** External editor (text-focus context only). Wired by M4.T1.S3. */
  onExternalEditor(p: InterrogationPanel): void;
}

// ------------------------------------------------------- accelerator layer

/** Every legal modifier token in pi-tui's KeyId grammar. */
const MODIFIER_NAMES: ReadonlySet<string> = new Set(["ctrl", "shift", "alt", "super"]);

/** Single-character base keys: letters, digits, and pi-tui's symbol set. */
const SINGLE_CHAR_BASES: ReadonlySet<string> = new Set([
  ..."abcdefghijklmnopqrstuvwxyz",
  ..."0123456789",
  ..."`-=[]\\;',./!@#$%^&*()_+|~{}:<>?",
]);

/** Named base keys, compared lowercase (matchesKey lowercases KeyIds too). */
const NAMED_BASES: ReadonlySet<string> = new Set([
  "escape",
  "esc",
  "enter",
  "return",
  "tab",
  "space",
  "backspace",
  "delete",
  "insert",
  "clear",
  "home",
  "end",
  "pageup",
  "pagedown",
  "up",
  "down",
  "left",
  "right",
  ..."f1 f2 f3 f4 f5 f6 f7 f8 f9 f10 f11 f12".split(" "),
]);

function isBaseKey(token: string): boolean {
  if (token.length === 1) return SINGLE_CHAR_BASES.has(token);
  return NAMED_BASES.has(token);
}

/**
 * Normalize + validate a config accelerator string into a pi-tui KeyId.
 *
 * Config strings are ALREADY KeyId-compatible when valid (same lowercase
 * "ctrl+shift+x" grammar), so this only trims, lowercases, and checks the
 * grammar: tokens split on "+", modifiers ∈ {ctrl, shift, alt, super} (no
 * duplicates), final token a base key name or a single printable char.
 *
 * @returns the normalized KeyId, or `undefined` when invalid — callers fall
 * back to the action's default (never trust config strings as KeyIds raw:
 * `"ctrl+"` must not throw or match everything).
 */
export function parseAccelerator(s: string): KeyId | undefined {
  if (typeof s !== "string") return undefined;
  const normalized = s.trim().toLowerCase();
  if (normalized === "") return undefined;
  const tokens = normalized.split("+");
  if (tokens.some((t) => t === "")) return undefined; // "ctrl+", "a++b"
  const base = tokens[tokens.length - 1];
  if (!isBaseKey(base)) return undefined;
  const seen = new Set<string>();
  for (const m of tokens.slice(0, -1)) {
    if (!MODIFIER_NAMES.has(m) || seen.has(m)) return undefined;
    seen.add(m);
  }
  return normalized as KeyId;
}

/** All KeyActions in DEFAULT_CONFIG.keys order (single source of truth). */
const KEY_ACTIONS = Object.keys(DEFAULT_CONFIG.keys) as KeyAction[];

/**
 * Resolve the validated binding table for a config: one KeyId per KeyAction.
 * Any action whose `config.keys[action]` fails {@link parseAccelerator}
 * validation falls back to the h2.52 DEFAULT_CONFIG accelerator and logs
 * exactly one console.warn — a settings.json typo degrades to defaults, it
 * never bricks the panel or crashes dispatch.
 */
export function resolveBindings(config: InterrogatorConfig): Record<KeyAction, KeyId> {
  const out = {} as Record<KeyAction, KeyId>;
  for (const action of KEY_ACTIONS) {
    const parsed = parseAccelerator(config.keys[action]);
    if (parsed !== undefined) {
      out[action] = parsed;
      continue;
    }
    out[action] = parseAccelerator(DEFAULT_CONFIG.keys[action]) as KeyId;
    console.warn(
      `[interrogator] invalid keybinding for "${action}": ` +
        `${JSON.stringify(config.keys[action])} — using default "${DEFAULT_CONFIG.keys[action]}"`,
    );
  }
  return out;
}

// ------------------------------------------------------------ dispatch core

/**
 * The esc-descent ladder (fixed; FR-16 — backing out never destroys state):
 * note focus → exit note mode FIRST (the innermost level — h2.32: esc exits
 * note mode; the panel's write-through exit keeps the draft); deep → short;
 * overview → deepSticky ? deep : short; short → suspend (done(null): the
 * editor region is restored and the host flips to suspended, but state and
 * drafts survive). Descending from deep does NOT clear deepSticky — only
 * ENTERING deep sets it (mirrors panel.ts).
 */
function escapeDescend(panel: InterrogationPanel): void {
  if (panel.focus === "note") {
    panel.exitNoteMode();
  } else if (panel.view === "deep") {
    panel.setView("short");
  } else if (panel.view === "overview") {
    panel.setView(panel.deepSticky ? "deep" : "short");
  } else {
    panel.suspend();
  }
}

/**
 * The default action set: navigation/accept/digit/submit delegate to the
 * named-action registry (actions.ts); view toggles keep panel.ts's exact
 * prior semantics (deepSticky bookkeeping included); the not-yet-landed
 * features stay no-op seams. `delivery` pre-binds SubmitDeps for submit;
 * when it is absent the panel instance's own delivery seam is used, and
 * submit is inert (returns false) when neither exists.
 */
export function defaultRoutedActions(delivery?: SubmitDeps): RoutedActions {
  return {
    optionUp: (p) => panelActions.optionUp(p),
    optionDown: (p) => panelActions.optionDown(p),
    digit: (p, n) => panelActions.digit(p, n),
    accept: (p) => panelActions.accept(p),
    prevQuestion: (p) => panelActions.prevQuestion(p),
    nextQuestion: (p) => panelActions.nextQuestion(p),
    submit: (p) => {
      const deps = delivery ?? p.delivery;
      return deps !== undefined ? panelActions.submit(p, deps) : false;
    },
    onDeep: (p) => {
      if (p.view === "deep") {
        p.setView("short");
      } else {
        p.deepSticky = true;
        p.setView("deep");
      }
    },
    onOverview: (p) => {
      p.setView(p.view === "overview" ? (p.deepSticky ? "deep" : "short") : "overview");
    },
    onFocusText: (p) => {
      p.focus = "text"; // M4.T1.S2 refines (draft seeding, composed editor)
    },
    onBatchNote: (p) => {
      // R3/h2.32 toggle (P1.M4.T2.S2): open from ANY focus/view; re-press
      // while in note mode exits. Both directions write through the
      // DraftStore seam — the panel methods own the draft bookkeeping.
      if (p.focus === "note") p.exitNoteMode();
      else p.enterNoteMode();
    },
    onBreakOut: (p) => {
      p.suspend(); // M6.T1.S2 adds the global registerShortcut half
    },
    onDiscuss: () => {
      // M6.T2.S2 wires the discuss flow.
    },
    onExternalEditor: (p) => {
      // Wired by M4.T1.S3 (h2.31): fire-and-forget — the router is sync and
      // never awaits (pi's extension-editor.js uses the same `void` pattern;
      // openExternalEditor catches internally, so nothing rejects).
      void p.openExternalEditor();
    },
  };
}

/**
 * Build the panel's KeyHandler — the config-driven dispatcher wired into
 * InterrogationPanel via the `keys` seam. Binding resolution happens ONCE
 * here (never per keystroke). See the module JSDoc for the load-bearing
 * resolution order, the intercept rule (config keys consumed even in text
 * focus), the fixed-key list, and the collision-ordering guarantee.
 *
 * @returns `(data, panel) => boolean` — true ONLY when a handler was invoked.
 * For navigation/digit/submit actions the returned value is the action's own
 * consumed result; one-shot seam actions (view toggles, esc descent, …)
 * consume unconditionally (true).
 */
export function buildKeyRouter(
  config: InterrogatorConfig,
  actions: RoutedActions,
): (data: string, panel: InterrogationPanel) => boolean {
  const b = resolveBindings(config);
  return function route(data: string, panel: InterrogationPanel): boolean {
    if (panel.isResolved()) return false; // defensive; handleInput already guards

    // 1. Fixed arrows — BEFORE anything esc-related (arrows are ESC-prefixed).
    if (matchesKey(data, Key.up)) return actions.optionUp(panel);
    if (matchesKey(data, Key.down)) return actions.optionDown(panel);

    // 2. Fixed esc — the view-descent ladder, terminus suspend (FR-16).
    if (matchesKey(data, Key.escape)) {
      escapeDescend(panel);
      return true;
    }

    // 3. Fixed enter — options focus only. In text focus enter FORWARDS so
    // the embedded text field implements its two-stage save (P1.M4.T1.S2).
    if (panel.focus !== "text" && matchesKey(data, Key.enter)) return actions.accept(panel);

    // 4. Config-driven panel-level intercepts — valid whenever the panel is
    // open INCLUDING focus === "text" (h2.34 intercept rule). Order here is
    // the documented collision-winner order.
    if (matchesKey(data, b.deep)) {
      actions.onDeep(panel);
      return true;
    }
    if (matchesKey(data, b.overview)) {
      actions.onOverview(panel);
      return true;
    }
    if (matchesKey(data, b.focusText)) {
      actions.onFocusText(panel);
      return true;
    }
    if (matchesKey(data, b.batchNote)) {
      actions.onBatchNote(panel);
      return true;
    }
    if (matchesKey(data, b.submit)) return actions.submit(panel);
    if (matchesKey(data, b.breakOut)) {
      actions.onBreakOut(panel);
      return true;
    }
    if (matchesKey(data, b.discuss)) {
      actions.onDiscuss(panel);
      return true;
    }
    // externalEditor is text-focus context (h2.34) — gated so ctrl+g stays
    // free in every other context.
    if (panel.focus === "text" && matchesKey(data, b.externalEditor)) {
      actions.onExternalEditor(panel);
      return true;
    }
    if (matchesKey(data, b.prevQuestion)) return actions.prevQuestion(panel);
    if (matchesKey(data, b.nextQuestion)) return actions.nextQuestion(panel);

    // Digits are printable — NEVER intercepted while the user types an
    // answer (focus === "text") or a note (focus === "note", R3 — the SAME
    // editor on note duty); quick-select is an options-focus affordance.
    if (config.digitQuickSelect && panel.focus !== "text" && panel.focus !== "note") {
      const k = parseKey(data);
      if (k !== undefined && k >= "1" && k <= "9") return actions.digit(panel, Number(k));
    }

    // 5. No match — forward (embedded editor when text-focused, else default).
    return false;
  };
}

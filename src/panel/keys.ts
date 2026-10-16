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
 * ## Mode A — the intercept rule (h2.34, TWO-TIER per h2.74/BAREKEYS-001)
 *
 * The panel owns raw keyboard focus (via `ctx.ui.custom()` —
 * questionnaire.ts pattern), so pi's own keybinding layer never sees these
 * keystrokes. Panel-level keys are therefore intercepted BEFORE any
 * forwarding — but WHICH keys intercept depends on TIER (ui-spec:70):
 *
 * - TIER 1 — modifier chords and named bases (tab, f-keys): a chord is
 *   never a typed character, so it intercepts in EVERY focus state,
 *   `focus === "text"` included — `ctrl+s` submit while the user types in
 *   the embedded free-text field must submit, not insert a control char.
 * - TIER 2 — bare keys (single printable char, no modifier): they
 *   "intercept only from non-editor focus and always forward while the
 *   editor holds focus" (ui-spec:70) — otherwise `t` in an answer could
 *   never be typed. Forwarding is the no-match fall-through (`return
 *   false` → panel.ts hands the byte to the composed editor); a bare key
 *   is never consumed-and-ignored. Tier is classified from the RESOLVED
 *   binding once per router build, so a remap instantly re-tiers.
 *
 * The two surviving default chords are load-bearing (decisions :113-115):
 * `ctrl+s` submit ("submit must fire from text focus — a bare `s` could
 * never be typed") and `ctrl+g` external editor ("its only valid context
 * is editor focus, where a bare key must type — a bare `g` would be
 * permanently unpressable"). The one fixed-key exception is `enter` (see
 * below).
 *
 * ## Mode A — fixed keys (never config-driven)
 *
 * `up`, `down`, `left`, `right`, `esc`, and `enter` are FIXED: they are
 * deliberately absent from the `KeyAction` config union (config.ts), so a
 * user cannot remap or shadow them by construction. They are checked BEFORE
 * every config accelerator — arrows first, because arrow sequences are
 * ESC-prefixed and an esc branch checked earlier would eat them. VIMNAV-001
 * (h2.74) extends the fixed family with the hjkl ALIASES: `k`=↑, `j`=↓,
 * `h`=←, `l`=→ — matched by exact bare-byte equality (`data === "k"`; a
 * bare letter never carries modifiers), riding the SAME conditions and
 * dispatch as the arrows they mirror, fixed/config-absent exactly like
 * them. Like the arrows they are NOT intercepted in text/note focus, where
 * the editor owns every printable key — hjkl must TYPE (BAREKEYS-001
 * tier-2 nature). Collision-winner order (documented, not fixed): a config
 * binding on a bare `h`/`j`/`k`/`l` is shadowed by the fixed alias, same
 * as the arrows shadow any theoretical arrow remap. `←`/`→`
 * navigate the FULL question list (prev/next — every status navigable, R1/
 * FR-9, clamped at the ends) and are view-aware exactly like the config
 * prev/next keys (overview: cursor row; short/deep: current question); they
 * are NOT intercepted in text/note focus, where the editor caret owns them.
 * `enter` NEVER reaches this router in editor focus: panel.handleInput
 * intercepts it earlier — WRITEIN-001 commit-at-enter (note exit /
 * write-in commit / elaboration save+blur) and the SIDECHAT-001 chat send
 * (P1.M2.T3.S1: classifyChatCommand → /clear·/new reset | sendTurn |
 * empty no-op — a chat message is never an answer) — so the enter branch
 * below fires only from options focus (its guard is defensive).
 *
 * ## Mode A — the chat view (SIDECHAT-001, P1.M2.T3.S1)
 *
 * The chat view joins the fixed-key branches as a third view-aware family:
 * while `view === "chat"` and NO editor holds focus, ↑/↓ scroll the
 * transcript (chatScrollUp/chatScrollDown — the panel-owned offset clamped
 * via clampChatScroll against the render-fed line count; k/j ride the same
 * branches) and esc descends the NEW chat rung of the esc ladder:
 * streaming → abort the live reply (fire-and-forget — the engine pops the
 * aborted turn; the panel stays in the chat view, a second esc exits) and
 * idle → exit to the PRIOR view (panel.chatReturnView, seeded by the open
 * path) with the transcript RETAINED — the sidechat record is never
 * discarded from the ladder (discard is P1.M2.T5.S1's hook). The
 * pendingConfirm confirm row is NOT routed here: its enter/esc are
 * intercepted at panel level BEFORE the router (apply seam / decline), so
 * a confirm-enter can never double-fire as an options accept.
 *
 * EDITOR-FOCUS FORWARDING (ESC-002): while ANY embedded editor holds focus
 * (`focus === "text"`, `"note"`, or — since SIDECHAT-001 — the chat
 * input `"chat"`; the first two share one composed editor, the chat input
 * is the second TextField), `up`/`down` and SINGLE `esc` FORWARD to the
 * editor instead of
 * driving the panel: arrows move the editor caret (not the option cursor)
 * and esc is the editor's own key (vim insert-mode exit). The esc-descent
 * ladder runs only from options focus. Closing the editor region WITHOUT
 * suspending is the double-esc exit: a second esc within
 * `config.escExitWindowMs` (default 500ms; 0 disables) of the first closes
 * the prompt box only — draft write-through + blur back to options
 * (panel.exitTextField / exitNoteMode). The first esc of the pair still
 * reached the editor, so vim users keep their mode semantics; "twice in a
 * row" is strict (any other key resets the window via `panel.lastEscAt`).
 * The deterministic single-key companion is the elaborate key (onElaborate
 * seam): with the bare default `t` it enters from options focus only — in
 * editor focus the two-tier rule FORWARDS it (it must type), so the old
 * re-press-to-close reachability is chord-remap territory now.
 *
 * ## Mode A — single dispatch + collision ordering
 *
 * At most ONE handler runs per input event: first match wins. If a user maps
 * two actions to the same accelerator, the action EARLIER in the resolution
 * order below wins — this is documented, deliberate behavior, not an error.
 * Resolution order (load-bearing — do not reorder casually):
 *
 *   1. up / down / left / right   (fixed — view-aware: overview cursor →
 *      deep selection → short-form option cursor; left/right = question
 *      navigation, full list)
 *   2. esc                      (fixed — view-descent ladder, then suspend)
 *   3. enter                    (fixed — options focus only → view-aware:
 *      overview jump → deep accept → short accept)
 *   4. config intercepts, in this order (TWO-TIER — chords intercept in
 *      every focus; bare keys only from non-editor focus, else forward):
 *      deep, overview, elaborate, batchNote, submit, chat,
 *      externalEditor (editor focus, any duty: write-in, elaboration,
 *      note — BUG-002), prevQuestion,
 *      nextQuestion (view-aware: overview cursor movers).
 *   5. no match → return false (forward to embedded editor / default nav)
 *
 * Accelerator validation: config strings arrive RESOLVED (defaults merged by
 * loadConfig) in pi's lowercase KeyId form, so they need only normalization
 * + validation — never translation. An invalid entry (e.g. "ctrl+") falls
 * back to the h2.52 default for that action with a single console.warn, so a
 * settings.json typo cannot brick the panel.
 */
import { Key, matchesKey, type KeyId } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG, type InterrogatorConfig, type KeyAction } from "../config.js";
import { chatScrollDown, chatScrollUp, panelActions, type SubmitDeps } from "./actions.js";
import { acceptFromDeep, deepSelectionDown, deepSelectionUp } from "./deep-view.js";
import { overviewDown, overviewJump, overviewUp } from "./overview.js";
import type { InterrogationPanel } from "./panel.js";

/**
 * Seam callbacks for actions whose owning modules land later. Navigation /
 * accept / submit delegate to the named-action registry
 * (actions.ts, P1.M3.T2.S2); `submit` receives a host-pre-bound
 * {@link SubmitDeps} wrapper (the deps never flow through keys.ts).
 * The `on*` callbacks mutate the panel directly and are replaced by their
 * owning tasks (M4 text editor / batch note, M5 ripple, M6 widget; onChat
 * opens the per-question side chat — host-wired, P1.M2.T4.S1).
 */
export interface RoutedActions {
  optionUp(p: InterrogationPanel): boolean;
  optionDown(p: InterrogationPanel): boolean;
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
  onElaborate(p: InterrogationPanel): void;
  /**
   * Batch note (R3, h2.32): OPEN note mode — enterNoteMode from any
   * non-editor focus/view (BAREKEYS-001 removed the re-press close: a bare
   * `m` while the editor holds focus must type; closes are `enter` and the
   * double-`esc` pair). Implemented by the default set.
   */
  onBatchNote(p: InterrogationPanel): void;
  /** Open the per-question side chat. Wired host-side at panel.ts's
   * router-construction site (the closure needs the PiUISurface);
   * default no-op. */
  onChat(p: InterrogationPanel): void;
  /** External editor (editor focus, any duty: write-in, elaboration, note). Wired by M4.T1.S3. */
  onExternalEditor(p: InterrogationPanel): void;
}

// ------------------------------------------------------- accelerator layer

/** Every legal modifier token in pi-tui's KeyId grammar. */
const MODIFIER_NAMES: ReadonlySet<string> = new Set(["ctrl", "shift", "alt", "super"]);

/** Single-character base keys: letters, number keys, and pi-tui's symbol set. */
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

/**
 * BAREKEYS-001 tier classification: is this accelerator a BARE key — a
 * single printable character with no modifier? Bare keys are TIER 2: they
 * intercept only from non-editor focus and always forward while the
 * embedded editor holds focus (ui-spec:70 — a bare key must be typeable).
 * Chords and named bases (tab, f-keys) are TIER 1: never typed characters,
 * so they intercept in every focus state. Classified from the RESOLVED
 * binding (normalize once at router build, not per keystroke), so a remap
 * instantly changes tier. An invalid accelerator (parseAccelerator
 * undefined — resolveBindings already fell back to the default) classifies
 * as tier 1, matching the chord-ish defaults.
 */
function isBareBinding(accel: string): boolean {
  const parsed = parseAccelerator(accel);
  if (parsed === undefined) return false;
  const tokens = parsed.split("+");
  return tokens.length === 1 && SINGLE_CHAR_BASES.has(tokens[0] ?? "");
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
 * deep → short; overview → deepSticky ? deep : short; short → suspend
 * (done(null): the editor region is restored and the host flips to
 * suspended, but state and drafts survive). Descending from deep does NOT
 * clear deepSticky — only ENTERING deep sets it (mirrors panel.ts). NOTE:
 * this ladder runs only from OPTIONS focus — while the embedded editor is
 * focused, esc belongs to the editor (single) or closes the editor only
 * (double-esc, ESC-002); see the module JSDoc's editor-focus forwarding.
 */
function escapeDescend(panel: InterrogationPanel): void {
  // SIDECHAT-001 chat rung (P1.M2.T3.S1, h3.9) — FIRST, before the view
  // descent: streaming → abort ONLY (fire-and-forget; the engine pops the
  // aborted turn, the panel stays in the chat view — a second esc then
  // exits); idle → exit to the PRIOR view (chatReturnView, seeded by the
  // open path; "short" fallback). The record is RETAINED across the exit
  // (the chat key reopens onto the same transcript); the singleton is never
  // discarded here (discard is P1.M2.T5.S1's hook). Both halves are panel
  // methods — keys.ts stays free of sidechat imports.
  if (panel.view === "chat") {
    if (panel.abortChatStream()) return;
    panel.exitChatView();
    return;
  }
  if (panel.view === "deep") {
    panel.setView("short");
  } else if (panel.view === "overview") {
    panel.setView(panel.deepSticky ? "deep" : "short");
  } else {
    panel.suspend();
  }
}

/**
 * The double-esc exit (ESC-002) — invoked when esc arrives while the
 * embedded editor holds focus (text OR note) AND `panel.lastEscAt` marks a
 * first esc still inside `config.escExitWindowMs`. Closes the PROMPT BOX
 * ONLY: text focus → exitTextField (draft write-through + blur, no advance
 * arming); note focus → exitNoteMode (the same write-through contract, h2.32).
 * Never suspends, never descends a view — "back to normal question
 * selection".
 */
function escExitEditor(panel: InterrogationPanel): void {
  panel.lastEscAt = undefined;
  if (panel.focus === "note") panel.exitNoteMode();
  else if (panel.focus === "chat") panel.blurChatInput(); // close the chat box only (ESC-002, SIDECHAT-001)
  else panel.exitTextField();
}

/**
 * The default action set: navigation/accept/submit delegate to the
 * named-action registry (actions.ts); view toggles keep panel.ts's exact
 * prior semantics (deepSticky bookkeeping included); the not-yet-landed
 * features stay no-op seams. `delivery` pre-binds SubmitDeps for submit;
 * when it is absent the panel instance's own delivery seam is used, and
 * submit is inert (returns false) when neither exists.
 */
/**
 * [Mode A] Duty decision for the ctrl+t entry (WRITEIN-001 duty-follows-
 * cursor, h2.32; P1.M2.T3.S1): the editor duty FOLLOWS WHERE THE USER IS.
 *
 * - `"writein"` when the CURRENT question is `type:"text"` (the buffer IS
 *   the answer — checked FIRST: on a text question `options` is
 *   undefined/empty, so the index test alone would "coincidentally" fire),
 *   OR the cursor rests on the `✎ Other — write your own` row of a choice
 *   question (`cursorIndex === options.length` — short-view.ts's cursor
 *   convention).
 * - `"elaboration"` otherwise (default): cursor on a real option — the
 *   buffer is context that attaches to the selection at submit (FR-12:
 *   an elaboration never answers alone).
 *
 * Consumed by the panel's ctrl+t entry (panel.ts's routed.onElaborate →
 * `focusTextField(duty)`). The accept-the-Other-row path pre-sets the duty
 * itself (actions.ts) and does not go through here. Lives in keys.ts (the
 * ctrl+t entry layer) rather than panel.ts so the entry site and the
 * decision stay in one module; keys.ts→panel.ts is a type-only import, so
 * panel.ts importing this value creates no runtime cycle.
 */
export function desiredTextDuty(panel: InterrogationPanel): "writein" | "elaboration" {
  const q =
    panel.currentId !== undefined ? panel.state.getQuestion(panel.currentId) : undefined;
  if (q?.type === "text") return "writein";
  if (panel.cursorIndex === (q?.options?.length ?? 0)) return "writein"; // the ✎ Other row
  return "elaboration";
}

export function defaultRoutedActions(delivery?: SubmitDeps): RoutedActions {
  return {
    optionUp: (p) => panelActions.optionUp(p),
    optionDown: (p) => panelActions.optionDown(p),
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
    onElaborate: (p) => {
      p.focus = "text"; // M4.T1.S2 refines (draft seeding, composed editor)
    },
    onBatchNote: (p) => {
      // R3/h2.33: OPEN-only (BAREKEYS-001 killed the re-press toggle — a
      // bare 'm' types while the editor holds focus). Valid from any
      // non-editor focus and any view (FR-13). The guard keeps a
      // chord-remapped batchNote idempotent instead of mid-typing-swapping
      // the editor. Closes are `enter` and the double-`esc` pair; the panel
      // methods own the draft write-through bookkeeping.
      if (p.focus !== "note") p.enterNoteMode();
    },
    onChat: () => {
      // Default no-op — panel.ts refines this seam with the open-or-replace
      // path (P1.M2.T4.S1); the closure needs the PiUISurface, so keys.ts
      // itself stays UI-free.
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
 * For navigation/submit actions the returned value is the action's own
 * consumed result; one-shot seam actions (view toggles, esc descent, …)
 * consume unconditionally (true).
 */
export function buildKeyRouter(
  config: InterrogatorConfig,
  actions: RoutedActions,
): (data: string, panel: InterrogationPanel) => boolean {
  const b = resolveBindings(config);
  // BAREKEYS-001 tier table — resolved ONCE per binding at router build
  // (never per keystroke): bare (tier 2) bindings forward while the editor
  // holds focus; chords/named bases (tier 1) intercept everywhere. A remap
  // instantly changes tier because classification reads the RESOLVED
  // binding, not the raw config string.
  const bare = {
    deep: isBareBinding(b.deep),
    overview: isBareBinding(b.overview),
    elaborate: isBareBinding(b.elaborate),
    batchNote: isBareBinding(b.batchNote),
    submit: isBareBinding(b.submit),
    chat: isBareBinding(b.chat),
    externalEditor: isBareBinding(b.externalEditor),
    prevQuestion: isBareBinding(b.prevQuestion),
    nextQuestion: isBareBinding(b.nextQuestion),
  };
  const escWindow = Math.max(0, config.escExitWindowMs);
  return function route(data: string, panel: InterrogationPanel): boolean {
    if (panel.isResolved()) return false; // defensive; handleInput already guards

    // Editor-focus flag (ESC-002): the embedded editors (text/note duty AND
    // the chat input — SIDECHAT-001, P1.M2.T3.S1) own the fixed NAVIGATION
    // keys while focused — same class of exception as enter below (h2.34's
    // single documented exception, now a family). Uniform across ALL tier-2
    // bare keys: a bare binding must TYPE in whichever editor holds focus.
    const editorFocused =
      panel.focus === "text" || panel.focus === "note" || panel.focus === "chat";
    // Double-esc window reset (ESC-002): "esc twice in a row" is STRICT — any
    // non-esc input (letters, arrows, enter, config keys…) clears the anchor.
    // Arrow sequences (ESC-prefixed bytes) parse as up/down/left/right, not
    // escape, so they reset too — exactly right.
    if (!matchesKey(data, Key.escape)) panel.lastEscAt = undefined;

    // 1. Fixed arrows — BEFORE anything esc-related (arrows are ESC-prefixed).
    //    ONE view-switch (overview P1.M5.T2.S1, deep P1.M5.T1.S1, h2.29):
    //    ↑/↓ move the overview CURSOR ROW / the deep SELECTION — they never
    //    navigate questions or fire the short-view option cursor (question
    //    navigation is prev/next only; in overview even prev/next move the
    //    cursor). EDITOR FOCUS (ESC-002): arrows forward to the embedded
    //    editor (caret movement) — the option cursor never moves while the
    //    user types.
    if (!editorFocused && (matchesKey(data, Key.up) || data === "k")) {
      // SIDECHAT-001 chat view (P1.M2.T3.S1): ↑ scrolls the TRANSCRIPT
      // (clamped via the render-fed line count) — never the option cursor
      // (there are no option rows in the chat view). While the CHAT EDITOR
      // holds focus this branch is skipped (editorFocused) and the arrow
      // forwards to the editor as a caret key. `k` follows the same branch
      // structure (same alias family as overview/deep).
      if (panel.view === "chat") return chatScrollUp(panel);
      if (panel.view === "overview") return overviewUp(panel);
      if (panel.view === "deep") return deepSelectionUp(panel);
      return actions.optionUp(panel);
    }
    if (!editorFocused && (matchesKey(data, Key.down) || data === "j")) {
      if (panel.view === "chat") return chatScrollDown(panel);
      if (panel.view === "overview") return overviewDown(panel);
      if (panel.view === "deep") return deepSelectionDown(panel);
      return actions.optionDown(panel);
    }

    // 1b. Fixed ←/→ — question navigation through the FULL list (R1/FR-9:
    // every status navigable, clamped — stepQuestion), view-aware exactly
    // like the config prev/next keys: overview moves the CURSOR ROW, short
    // and deep move currentId. NOT intercepted in editor focus (text/
    // note/chat — P1.M2.T3.S1 adds chat): there the focused editor owns
    // horizontal caret movement (the same editor-forwarding contract as
    // every non-intercept key) — `!editorFocused` is exactly that
    // exclusion, uniform across the three editors. Checked with the
    // other fixed arrows, BEFORE esc: left/right sequences are
    // ESC-prefixed and the esc ladder must not eat them.
    if (!editorFocused) {
      if (matchesKey(data, Key.left) || data === "h") {
        if (panel.view === "overview") return overviewUp(panel);
        return actions.prevQuestion(panel);
      }
      if (matchesKey(data, Key.right) || data === "l") {
        if (panel.view === "overview") return overviewDown(panel);
        return actions.nextQuestion(panel);
      }
    }

    // 2. Fixed esc. OPTIONS focus: the view-descent ladder, terminus suspend
    //    (FR-16). EDITOR FOCUS (ESC-002): a single esc FORWARDS to the
    //    editor (pi-vim insert-mode exit etc. — return false → panel.ts
    //    hands the byte to the embedded editor); a second esc within
    //    escWindow closes the prompt box only (escExitEditor — draft
    //    write-through + blur, never suspend). escWindow === 0 disables the
    //    pair (every esc forwards; close via `enter` or the double-`esc`
    //    pair — BAREKEYS-001 removed the re-press toggles).
    if (matchesKey(data, Key.escape)) {
      if (!editorFocused) {
        escapeDescend(panel);
        return true;
      }
      const now = Date.now();
      if (
        escWindow > 0 &&
        panel.lastEscAt !== undefined &&
        now - panel.lastEscAt <= escWindow
      ) {
        escExitEditor(panel);
        return true;
      }
      if (escWindow > 0) panel.lastEscAt = now;
      return false; // single esc → the editor
    }

    // 3. Fixed enter — options focus only. In editor focus (text/note AND
    // chat — P1.M2.T3.S1) enter never reaches the router: panel.handleInput
    // intercepts it first (WRITEIN-001 commit-at-enter; chat send routing —
    // a chat message is never an answer), so this branch cannot see an
    // editor-focus enter; the guard is belt-and-braces.
    // Overview (P1.M5.T2.S1): enter JUMPS to the selected question in the
    // short form (overviewJump — restores options focus; the currentId
    // setter re-seeds the cursor per ANSWER-PIN-001 — recorded answer
    // first, ★ only while unanswered). Deep view (P1.M5.T1.S1): enter accepts the
    // highlighted option and lands per deepSticky (acceptFromDeep — stays
    // deep on the advanced-to question while sticky, DEEP-STICKY-ADVANCE;
    // text/moot/withdrawn are consumed no-ops there).
    if (!editorFocused && matchesKey(data, Key.enter)) {
      if (panel.view === "overview") return overviewJump(panel);
      if (panel.view === "deep") return acceptFromDeep(panel);
      return actions.accept(panel);
    }

    // 4. Config-driven panel-level intercepts — TWO-TIER (h2.74/
    // BAREKEYS-001, ui-spec:70): modifier chords intercept in every focus
    // state (a chord is never a typed character); BARE keys intercept only
    // from non-editor focus and always FORWARD while the editor holds
    // focus (`return false` → panel.ts hands the byte to the composed
    // editor — never consume-and-ignore). Tier comes from the resolved
    // binding (the `bare` table above), so remaps re-tier automatically.
    // Order here is the documented collision-winner order.
    if (matchesKey(data, b.deep)) {
      if (bare.deep && editorFocused) return false; // tier 2: must type
      actions.onDeep(panel);
      return true;
    }
    if (matchesKey(data, b.overview)) {
      if (bare.overview && editorFocused) return false; // tier 2: must type
      actions.onOverview(panel);
      return true;
    }
    // BUG-011: the embedded editor renders only in the short view (and
    // note mode, a separate focus); focusing it from deep/overview would
    // arm an invisible editor (blind typing, silent stage-1 draft saves).
    // In those views the elaborate key falls through to normal panel
    // handling (arrows scroll/navigate, enter keeps its view-specific
    // meaning). NOTE focus (ESC-002): it also falls through — the note
    // editor owns the buffer. TIER (BAREKEYS-001): with the bare default
    // `t` (or any bare remap) the key forwards in TEXT focus too — it must
    // type; a chord remap keeps every-focus reachability.
    if (
      panel.view === "short" &&
      panel.focus !== "note" &&
      matchesKey(data, b.elaborate)
    ) {
      if (bare.elaborate && editorFocused) return false; // tier 2: must type
      actions.onElaborate(panel);
      return true;
    }
    if (matchesKey(data, b.batchNote)) {
      if (bare.batchNote && editorFocused) return false; // tier 2: must type
      actions.onBatchNote(panel);
      return true;
    }
    if (matchesKey(data, b.submit)) {
      if (bare.submit && editorFocused) return false; // tier 2: must type
      return actions.submit(panel);
    }
    if (matchesKey(data, b.chat)) {
      if (bare.chat && editorFocused) return false; // tier 2: must type
      actions.onChat(panel);
      return true;
    }
    // externalEditor is editor-focus context, any duty (BUG-002 — one
    // embedded editor, three duties: write-in, elaboration, note; ui-spec
    // "editor focus (any duty)"). Gated so ctrl+g stays free in every
    // non-editor context. TIER: its only valid context is editor focus,
    // where a bare key must type — a bare remap therefore never intercepts
    // (decisions :113-115; keep the chord) — in BOTH text and note duty.
    if (editorFocused && matchesKey(data, b.externalEditor)) {
      if (bare.externalEditor) return false; // tier 2 in its only context
      actions.onExternalEditor(panel);
      return true;
    }
    // prev/next are view-aware (contract 3): in overview the config
    // question-nav keys move the CURSOR ROW — never currentId. TIER: bare
    // remaps forward while the editor holds focus (defaults tab/shift+tab
    // are named bases — tier 1 — and intercept everywhere).
    if (matchesKey(data, b.prevQuestion)) {
      if (bare.prevQuestion && editorFocused) return false; // tier 2: must type
      if (panel.view === "overview") return overviewUp(panel);
      return actions.prevQuestion(panel);
    }
    if (matchesKey(data, b.nextQuestion)) {
      if (bare.nextQuestion && editorFocused) return false; // tier 2: must type
      if (panel.view === "overview") return overviewDown(panel);
      return actions.nextQuestion(panel);
    }

    // 5. No match — forward (embedded editor when text-focused, else default).
    return false;
  };
}

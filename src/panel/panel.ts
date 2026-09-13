/**
 * src/panel/panel.ts — interrogation panel host (P1.M3.T1.S1).
 *
 * Owns the non-blocking `ctx.ui.custom()` panel lifecycle (h2.0 commitments 1
 * + 3, h2.35 suspend, h2.37 reopen-while-suspended):
 *
 * - `openPanel` invokes `pi.ui.custom(...)` FIRE-AND-FORGET — the floating
 *   promise is never awaited anywhere (see the Mode A JSDoc on openPanel).
 * - The panel replaces the bottom editor region (non-overlay default) while
 *   the transcript stays visible above, and persists while the agent is idle;
 *   ONLY `done()` (suspend) or `lifecycle.dismissPanel()` closes it.
 * - `done(null)` is the suspend contract: the editor region is restored, the
 *   host flips to "suspended" (not closed), and nothing user-visible is lost —
 *   state lives in the InterrogationState singleton, drafts in the DraftStore
 *   seam (P1.M4.T2.S1). The host stores no question/answer data.
 * - A questions-upserted event while suspended reopens the panel on a fresh
 *   instance rehydrated from state (deepSticky resets — it is per panel
 *   session, h2.29), focused on the first upserted currently-active question.
 * - Rendering: the short view's header/question/hint/footer lines are real
 *   config-driven layout renderers (src/panel/layout.ts, P1.M3.T1.S2) and
 *   the options region renders via renderShortViewOptions
 *   (src/panel/short-view.ts, P1.M3.T2.S1); deep/overview renderers are M5.
 *   What the host owns: render caching + invalidate + requestRender
 *   discipline, view state, cursorIndex seeding, and correct component
 *   plumbing.
 *
 * Seam map (interfaces only here — no stub implementations beyond tests):
 * - `DraftStore` → implemented by P1.M4.T2.S1 (accepted via openPanel options).
 * - `KeyHandler` → keys.ts (P1.M3.T3.S1): the panel defaults the seam to
 *   buildKeyRouter(config, defaultRoutedActions(delivery)) so every panel
 *   dispatches through the config-driven router; an explicit `keys` option
 *   (openPanel / InterrogationPanelArgs) overrides the default set.
 *
 * Host record discipline: exactly one panel host exists per extension session,
 * so the mutable host record is module-scoped (mirrors state.ts's singleton
 * discipline). `createPanelHost` re-arms it and wires the lifecycle dismiss
 * callback; `openPanel` is a standalone export operating on the same record —
 * the PRP's exact public surface has no host parameter, so the shared record
 * is the only way both signatures hold. Tests reset the record via
 * `createPanelHost` before each scenario.
 */
import type { ExtensionAPI, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { parseKey, type Component, type TUI } from "@earendil-works/pi-tui";
import { resolveKeyLabels, type InterrogatorConfig, type KeyAction } from "../config.js";
import { getState, type InterrogationState } from "../state.js";
import { nextUnanswered, type RippleConfirmFn, type SubmitDeps } from "./actions.js";
import { buildKeyRouter, defaultRoutedActions } from "./keys.js";
import { createEditorComponent, TextField, type EditorFactory } from "./text-field.js";
import {
  renderFlashLine,
  renderFooter,
  renderHeader,
  renderHintLine,
  renderQuestionLine,
} from "./layout.js";
import { initialCursorIndex, renderShortViewOptions } from "./short-view.js";

// --------------------------------------------------------------------- types

/** Panel view modes (h2.29). deepSticky is per panel session, not global. */
export type PanelView = "short" | "deep" | "overview";

/** Focus region inside the panel (short view h2.29 layout). */
export type PanelFocus = "options" | "text" | "note";

/**
 * Panel-local draft record — the {value, text} shape per the h2.45 drafts
 * lifecycle. Written by stage-1 enter (two-stage, h2.31); reconciled into
 * the real DraftStore by P1.M4.T2.S1. The map is the always-fresh source
 * for refocus seeding during the panel's lifetime.
 */
interface TextDraft {
  value: string;
  text: string;
}

/**
 * DraftStore seam — implemented by P1.M4.T2.S1. Accept a handle via
 * openPanel options; the host never constructs one.
 */
export interface DraftStore {
  getDraft(questionId: string): string | undefined;
  setDraft(questionId: string, text: string): void;
  /** Batch note (R3) — "" when unset. */
  getNote(): string;
  setNote(text: string): void;
}

/** Key dispatch seam — implemented by P1.M3.T3.S1 (keys.ts). */
export type KeyHandler = (data: string, panel: InterrogationPanel) => boolean;

export interface PanelHost {
  /** True while a panel component is mounted (custom() not yet done()-ed). */
  isOpen(): boolean;
  /** True after done(null) suspend, before the next openPanel. */
  isSuspended(): boolean;
  /** Force-close the current panel (dismiss path; resolves via done(null)). */
  suspend(): void;
  /** The live panel instance while open (renderers/tests may inspect). */
  getPanel(): InterrogationPanel | undefined;
  /** Teardown seam: unhook state listeners. */
  dispose(): void;
}

export interface OpenPanelOptions {
  config: InterrogatorConfig;
  state: InterrogationState;
  /** Draft store seam — optional until P1.M4.T2.S1 lands it. */
  drafts?: DraftStore;
  /** Key dispatch seam — optional until P1.M3.T3.S1 (keys.ts) lands it. */
  keys?: KeyHandler;
  /**
   * Delivery surface for the panel submit action (P1.M3.T2.S2) — the real
   * pi sendMessage + idle probe. Optional until a later task wires the
   * production transport; without it the submit key is inert (tests pass
   * mocks).
   */
  delivery?: SubmitDeps;
  /** Ripple-confirm seam override — default is the always-true no-op. */
  confirmRipple?: RippleConfirmFn;
  /** Question id to focus on open; defaults to first open question. */
  focusQuestionId?: string;
}

/**
 * Narrow structural pick of ExtensionAPI for the panel host: only `ui.custom`
 * and the run `mode` (custom() resolves undefined in RPC mode → the host
 * guards `mode === "tui"`).
 */
export interface PiUISurface {
  ui: {
    custom<T>(
      factory: (
        tui: TUI,
        theme: Theme,
        keybindings: KeybindingsManager,
        done: (result: T) => void,
      ) => Component & { dispose?(): void },
    ): Promise<T | undefined>;
    /**
     * Composed-editor factory seam (h2.31) — captured ONCE per openPanel.
     * Optional: undefined whenever no composed editor (pi-vim etc.) is
     * registered → the panel silently uses the stock pi-tui Editor.
     */
    getEditorComponent?(): EditorFactory | undefined;
  };
  mode?: string;
}

// ------------------------------------------------------- panel component

/** Statuses counted as "currently active" for focus selection (h2.44 set). */
const ACTIVE_STATUSES: readonly string[] = ["open", "answered", "submitted", "reasked"];

/** Footer flash lifetime (h2.37 transient states ~2.5s). */
const FLASH_MS = 2500;

/** Default ripple seam — always-true no-op until P1.M5.T4.S1 swaps it. */
const defaultRippleConfirm: RippleConfirmFn = () => true;

/** Constructor dependencies for {@link InterrogationPanel}. */
export interface InterrogationPanelArgs {
  tui: TUI;
  theme: Theme;
  /** Suspend contract: resolves the custom() promise; null = suspended (h2.35). */
  done: (result: null) => void;
  state: InterrogationState;
  config: InterrogatorConfig;
  drafts?: DraftStore;
  keys?: KeyHandler;
  delivery?: SubmitDeps;
  confirmRipple?: RippleConfirmFn;
  focusQuestionId?: string;
  /**
   * Composed-editor factory — the host captures `pi.ui.getEditorComponent()`
   * once per openPanel (P1.M4.T1.S1); undefined → stock Editor fallback.
   */
  editorFactory?: EditorFactory | undefined;
  /** Live keybindings manager from pi's custom() body (composed editors). */
  keybindings?: KeybindingsManager;
}

/**
 * The interrogation panel component (class pattern per todo.ts
 * TodoListComponent: constructor takes dependencies + the done callback).
 *
 * Structural renderers only in S1 — real header/question/footer labels are
 * P1.M3.T1.S2 and the deep/overview renderers are M5. This class owns view
 * state (short|deep|overview, deepSticky per session), render caching, the
 * invalidate → requestRender discipline, state-driven invalidation, and the
 * done(null) suspend path.
 */
export class InterrogationPanel implements Component {
  /** Current view — starts "short" every panel session (deepSticky resets). */
  view: PanelView = "short";
  /** Current focus region (h2.29 short layout). */
  focus: PanelFocus = "options";
  private currentIdValue: string | undefined;

  /**
   * Focused question id. Assigning it re-seeds {@link cursorIndex} to the
   * ★ recommendation preselect (R2) — question changes never carry an old
   * cursor over. Navigation (P1.M3.T2.S2) mutates cursorIndex directly.
   */
  get currentId(): string | undefined {
    return this.currentIdValue;
  }
  set currentId(id: string | undefined) {
    this.currentIdValue = id;
    const q = id !== undefined ? this.state.getQuestion(id) : undefined;
    this.cursorIndex = q !== undefined ? initialCursorIndex(q) : 0;
  }

  /**
   * Cursor index within the short-view options region (P1.M3.T2.S1). Domain:
   * choice questions 0..options.length (last index = the ✎ affordance);
   * text questions 0 (the primary affordance). Seeded to the ★
   * recommendation on every currentId change (R2 — the recommendation is
   * the preselected cursor position; answers never pin the cursor).
   * Lives ONLY on the panel instance: suspend keeps the live component's
   * value; a fresh reopened instance re-seeds from state (h2.29/h2.35).
   * Movement keys are NOT wired here — P1.M3.T2.S2 owns navigation.
   */
  cursorIndex = 0;
  /**
   * Once the user toggles deep, returning from overview restores deep.
   * Per panel session only — a fresh instance on reopen resets it (h2.29).
   */
  deepSticky = false;
  /** Deep view scroll offset (driven by M5 navigation; rendered in S1). */
  scrollOffset = 0;

  /**
   * Panel-local free-text drafts keyed by question id (h2.45): stage-1
   * enter ({@link saveTextDraft}) writes {value, text} here synchronously,
   * making it the freshest read for refocus seeding ({@link focusTextField}
   * falls back to the DraftStore seam). Survives question navigation (R4) —
   * it is NEVER cleared in this task; destruction/reconciliation rules
   * belong to P1.M4.T2.S1.
   */
  private draftSlots = new Map<string, TextDraft>();

  /**
   * One-shot two-stage enter flag (h2.31, Mode A): armed by stage-1 (enter
   * in text focus saved the draft), consumed by stage-2 (the NEXT enter
   * advances to the next unanswered question). Any other input event
   * disarms it (one-shot semantics — see handleInput). Public so tests can
   * assert the flag directly.
   */
  advanceArmed = false;

  /**
   * Batch note text (R3) — written by enter in note focus
   * ({@link saveNote}); the ctrl+shift+m open path is P1.M4.T2.S2.
   */
  batchNote = "";

  /**
   * Transient footer flash (h2.37 empty-state feedback, e.g. "nothing to
   * submit"): set via flash(), auto-cleared after {@link FLASH_MS} by its
   * own timer (which re-invalidates once). The timer is cleared in dispose()
   * so a suspended panel never repaints.
   */
  footerFlash: { text: string; timer?: ReturnType<typeof setTimeout> } | undefined;

  /** Submit transport seam — inert matcher branch when undefined. */
  readonly delivery: SubmitDeps | undefined;

  /**
   * Ripple-confirm seam (P1.M5.T4.S1 swaps the default). Public field so
   * M5 can reassign it without reconstructing the panel.
   */
  rippleConfirm: RippleConfirmFn;

  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly done: (result: null) => void;
  /**
   * Public readonly so the named actions (actions.ts, P1.M3.T2.S2) can read
   * the engine off the panel instance — the action surface takes `(panel)`
   * by contract. Mutation goes through state's own primitives only.
   */
  readonly state: InterrogationState;
  /**
   * Public readonly — actions read digitQuickSelect off it. Config is a
   * read-only input; a config reload constructs a fresh panel.
   */
  readonly config: InterrogatorConfig;
  private readonly drafts: DraftStore | undefined;
  /**
   * Embedded free-text editor (P1.M4.T1.S1) — exactly ONE per panel
   * lifetime, instantiated in the constructor (inside the live custom()
   * body). Never focused at construction; the router's onFocusText seam
   * (ctrl+t / ✎ accept) drives focus + draft seeding.
   */
  readonly textField: TextField;
  /** The config-driven dispatcher — always present (router is the default). */
  private readonly keys: KeyHandler;
  /**
   * Key display labels, memoized ONCE at construction from
   * resolveKeyLabels(config) (h2.52 — no hardcoded key names anywhere in
   * rendering). Config is a read-only input; a config reload constructs a
   * fresh panel (reopen rehydrates from options), so per-session memoization
   * never serves stale labels across reloads.
   */
  private readonly labels: Record<KeyAction, string>;
  private cached: string[] | undefined;
  private lastWidth = -1;
  /** Guard so a second done() after suspend cannot re-resolve (idempotent). */
  private resolved = false;

  private readonly onChanged = (): void => {
    this.invalidate();
  };

  constructor(args: InterrogationPanelArgs) {
    this.tui = args.tui;
    this.theme = args.theme;
    this.done = args.done;
    this.state = args.state;
    this.config = args.config;
    this.drafts = args.drafts;
    // P1.M4.T1.S1 — ONE embedded editor per panel lifetime. The composed
    // factory (pi.ui.getEditorComponent(), captured once per openPanel by
    // the host) is invoked HERE inside the live custom() body so tui/theme/
    // keybindings are the instances pi passed in; stock Editor otherwise
    // (editorMode "stock" or no factory — h2.51 risk row 1 mitigation).
    this.textField = new TextField({
      editor: createEditorComponent(
        args.editorFactory,
        args.config,
        args.tui,
        args.theme,
        // pi's custom() body always hands the live keybindings manager here;
        // the optional-args case is direct construction (tests), where no
        // composed factory is invoked against a real manager.
        args.keybindings as KeybindingsManager,
      ),
      theme: args.theme,
      onInvalidate: () => this.invalidate(),
    });

    // Key dispatch ALWAYS flows through the config-driven router (keys.ts,
    // P1.M3.T3.S1): the seam default wires the named actions + view-toggle
    // seams; an explicit args.keys (host override) replaces it wholesale.
    // Host-side refinement of the onFocusText seam (keys.ts itself is
    // untouched): ctrl+t / the ✎ affordance accept path now focus + seed
    // the embedded editor, not just flip the focus flag.
    const routed = defaultRoutedActions(args.delivery);
    routed.onFocusText = (p) => p.focusTextField();
    this.keys = args.keys ?? buildKeyRouter(args.config, routed);
    this.labels = resolveKeyLabels(args.config);
    this.delivery = args.delivery;
    this.rippleConfirm = args.confirmRipple ?? defaultRippleConfirm;
    this.currentId = pickInitialQuestionId(args.state, args.focusQuestionId);

    // Contract 7 — state is the source of truth: any mutation invalidates the
    // cached lines so renderers stay dumb. Unsubscribed in dispose().
    this.state.on("changed", this.onChanged);
  }

  /**
   * Cached render (todo.ts/questionnaire.ts discipline): rebuild only when
   * the width changed or invalidate() cleared the cache; callers get the SAME
   * array reference between rebuilds.
   */
  render(width: number): string[] {
    if (this.cached !== undefined && width === this.lastWidth) return this.cached;
    this.lastWidth = width;
    this.cached = this.buildLines(width);
    return this.cached;
  }

  /** Drop the render cache and schedule a TUI repaint. */
  invalidate(): void {
    this.cached = undefined;
    this.tui.requestRender();
  }

  /**
   * [Mode A] Two-stage enter (h2.31 Q17=A, FR-12) — the load-bearing order
   * inside this method is:
   *
   *   resolved guard → (a) one-shot disarm → (b) armed stage-2 enter →
   *   (c) text/note stage-1 enter → keys seam → textField forwarding.
   *
   * Stage 1 intercepts enter at the PANEL level (before the router and
   * before the embedded editor ever sees the byte) rather than via
   * editor.onSubmit because (1) composed editors (pi-vim) may not implement
   * onSubmit at all, and (2) the stock Editor's submitValue() EMPTIES the
   * buffer and TRIMS the text — interception keeps the editor content
   * intact for seeding. This deliberately supersedes S1's "FUTURE
   * M4.T1.S2: sets editor.onSubmit" note (double-fire risk; onSubmit stays
   * unset). parseKey-exact matching ("enter", never raw data === "\r")
   * makes newline input safe by construction: shift+enter (kitty
   * "\x1b[13;2u" / xterm "\x1b[13;2~"), alt+enter ("\x1b\r") parse to
   * modifier KeyIds and fall through to the editor, and ctrl+j ("\n") is
   * excluded by raw byte (legacy parseKey resolves it to plain "enter").
   * History isolation (h2.31): the embedded editor's history API is never
   * invoked anywhere in this panel — its up/down history stays empty.
   *
   * The config-driven router (keys.ts, P1.M3.T3.S1) still owns everything
   * else — fixed arrows/esc/enter, the esc-descent ladder (short-view esc
   * suspends, FR-16), and every config.keys accelerator via the h2.34
   * intercept-before-forward rule. Unmatched input is forwarded to the
   * embedded editor when focus === "text" (P1.M4.T1.S1); otherwise ignored.
   */
  handleInput(data: string): boolean {
    if (this.resolved) return false;
    const key = parseKey(data);
    // "\n" is a newline request (R4: ctrl+j / Ghostty shift+enter mapping),
    // never a stage transition — legacy parseKey resolves it to "enter", so
    // the raw byte is excluded here (kitty mode already yields "shift+enter").
    const enter = key === "enter" && data !== "\n";
    // (a) One-shot disarm: any input other than the stage-2 enter disarms
    // before normal dispatch. A stage-1 enter IS "enter", so arming in (c)
    // below is never undone by this check — order is load-bearing.
    if (this.advanceArmed && !enter) this.advanceArmed = false;
    // (b) Stage 2: the NEXT enter (options focus) advances to the next
    // unanswered question. Runs BEFORE the keys seam so the armed enter
    // cannot be shadowed by the router's enter→accept interception.
    if (this.advanceArmed && enter && this.focus === "options") {
      this.advanceArmed = false;
      this.advanceToNextUnanswered();
      this.invalidate();
      return true;
    }
    // (c) Stage 1: enter in text/note focus saves and blurs — never reaches
    // the editor (no stock submitValue, no onSubmit) and never the router
    // (in note focus the router would read enter as options accept).
    if (enter && (this.focus === "text" || this.focus === "note")) {
      if (this.focus === "note") this.saveNote();
      else this.saveTextDraft();
      return true;
    }
    if (this.keys(data, this)) return true;
    // Unmatched input reaches the embedded editor ONLY while text focus is
    // active (h2.34: config intercepts fired first inside the router — the
    // router consumed every panel key, even in text focus).
    if (this.focus === "text") {
      this.textField.handleInput(data);
      return true;
    }
    return false;
  }

  /**
   * Stage 1 for question text (h2.31 two-stage enter): snapshot the editor
   * text into the panel-local draft slot ({value, text} per h2.45 — final
   * store reconciliation is P1.M4.T2.S1), persist via the DraftStore seam
   * when present, blur back to options, and arm the one-shot advance flag.
   * Never advances and never selects an option. See the [Mode A] JSDoc on
   * {@link handleInput} for why the trigger is panel-level interception.
   */
  private saveTextDraft(): void {
    const text = this.textField.getText();
    const id = this.currentId;
    if (id !== undefined) {
      this.draftSlots.set(id, { value: id, text });
      this.drafts?.setDraft(id, text);
    }
    this.blurTextField(); // focus = "options" + editor blur + invalidate
    this.advanceArmed = true;
  }

  /**
   * Stage 1 for the batch note (R3): save via the seam + panel field and
   * exit note mode. Deliberately does NOT arm the advance flag — a note is
   * not a question answer. (The ctrl+shift+m open path is P1.M4.T2.S2; this
   * is the enter-to-save-and-exit path it will plug into.)
   */
  private saveNote(): void {
    const text = this.textField.getText();
    this.batchNote = text;
    this.drafts?.setNote(text);
    this.blurTextField();
  }

  /**
   * Stage 2 target: the accept-advance algorithm (h2.38) via the shared
   * nextUnanswered primitive from actions.ts — forward scan with wrap over
   * open/reasked, staying on the current question when nothing qualifies
   * (all answered). Mirrors actions.advanceAfterAccept without duplicating
   * its logic (actions.ts is read-only for this task; nextUnanswered is its
   * exported core). Assigning currentId re-seeds the cursor (R2).
   */
  private advanceToNextUnanswered(): void {
    const ordered = this.state.orderedQuestions();
    const from = ordered.findIndex((q) => q.id === this.currentId);
    const nextId = nextUnanswered(ordered, from);
    if (nextId !== undefined) this.currentId = nextId;
    this.invalidate();
  }

  /**
   * Suspend contract (h2.35): resolve custom() with null. The editor region
   * is restored by pi; the host's floating .then marks the host suspended.
   * Idempotent — a second call after resolution is a no-op.
   */
  suspend(): void {
    if (this.resolved) return;
    this.resolved = true;
    this.done(null);
  }

  /**
   * Ripple-confirm invocation point — accept calls this before re-answering
   * an answered/submitted question. The stored seam receives the panel so
   * the M5 flow can drive its own UI against it.
   */
  confirmRippleEdit(questionId: string, proposed: { value: string; at: string }): boolean {
    return this.rippleConfirm(this, questionId, proposed);
  }

  /**
   * Set the transient footer flash (h2.37) — one line above the footer,
   * auto-cleared after ~2.5s. Cancel any live timer first so back-to-back
   * flashes never stack; the expiry callback skips invalidate after suspend.
   */
  flash(text: string): void {
    if (this.footerFlash?.timer !== undefined) clearTimeout(this.footerFlash.timer);
    const timer = setTimeout(() => {
      this.footerFlash = undefined;
      if (!this.resolved) this.invalidate();
    }, FLASH_MS);
    this.footerFlash = { text, timer };
    this.invalidate();
  }

  /** Teardown: drop the state subscription and the flash timer (idempotent). */
  dispose(): void {
    this.state.off("changed", this.onChanged);
    if (this.footerFlash?.timer !== undefined) clearTimeout(this.footerFlash.timer);
    this.footerFlash = undefined;
    // Tolerant teardown: a composed editor may own timers/subscriptions.
    const editor = this.textField.editor as { dispose?: () => void };
    if (typeof editor.dispose === "function") editor.dispose();
  }

  /** True once suspend() resolved custom() (the router's defensive guard). */
  isResolved(): boolean {
    return this.resolved;
  }

  /**
   * Switch views (public so the keys.ts router + seam callbacks drive view
   * state through ONE path — no duplicated toggle logic). No-op when the
   * view is unchanged; invalidates the render cache otherwise.
   */
  setView(view: PanelView): void {
    if (this.view === view) return;
    this.view = view;
    this.invalidate();
  }

  /**
   * Focus path for the router's onFocusText seam (keys.focusText / ctrl+t,
   * and the ✎ affordance route refined in the constructor): focus the
   * embedded editor and seed the current draft. P1.M4.T1.S2 refines S1's
   * empty-only seeding (h2.31 seed-on-refocus): the freshest read is the
   * panel-local slot written by stage-1 enter ({@link saveTextDraft}),
   * falling back to the DraftStore seam (P1.M4.T2.S1 supplies it) and
   * finally "". {@link TextField.seed} is idempotent — a same-question
   * re-focus whose buffer already matches is a textual no-op — while a
   * cross-question re-focus re-seeds instead of showing the previous
   * question's leftover text.
   */
  focusTextField(): void {
    this.focus = "text";
    this.textField.focus();
    const id = this.currentId;
    const draft =
      id !== undefined ? (this.draftSlots.get(id)?.text ?? this.drafts?.getDraft(id)) : undefined;
    this.textField.seed(draft ?? "");
    this.invalidate(); // the editor region appears immediately
  }

  /**
   * Blur path back to the options region (two-stage enter wiring is
   * P1.M4.T1.S2; the router/actions call this once landed).
   */
  blurTextField(): void {
    this.focus = "options";
    this.textField.blur();
    this.invalidate(); // drop the editor region from the layout
  }

  /** The flash line for the current render pass, or undefined when unset. */
  private flashLine(width: number): string | undefined {
    if (this.footerFlash === undefined) return undefined;
    return renderFlashLine(this.footerFlash.text, this.theme, width);
  }

  /**
   * Short view: real header/question/hint/footer lines (S2) around the
   * options region rendered by renderShortViewOptions (P1.M3.T2.S1). Deep/
   * overview remain M5 placeholders. State is re-read on every rebuild —
   * the panel is a view; state is the source of truth (contract 7). An
   * unknown/absent currentId renders header + footer only (empty region).
   */
  private buildLines(width: number): string[] {
    if (this.view === "short") {
      const snapshot = this.state.serialize();
      const header = renderHeader(snapshot, this.theme, width);
      const ordered = this.state.orderedQuestions();
      const idx =
        this.currentId !== undefined ? ordered.findIndex((q) => q.id === this.currentId) : -1;
      const lines = [header.line];
      if (idx >= 0) {
        const current = ordered[idx];
        lines.push(renderQuestionLine(current, idx + 1, this.theme, width));
        lines.push(...renderHintLine(current, this.theme, width));
        lines.push(
          ...renderShortViewOptions({
            question: current,
            cursorIndex: this.cursorIndex,
            theme: this.theme,
            width,
          }),
        );
        // Editor region (h2.29, 3 lines default): the embedded editor shows
        // while text focus is active or the current question is a text
        // question (its primary affordance per short-view.ts). Sync the
        // wrapper flag with panel focus first so non-router focus paths
        // (actions.ts ✎ accept sets panel.focus directly) keep the editor's
        // own focused flag truthful.
        if (this.focus === "text" && !this.textField.focused) this.textField.focus();
        if (this.focus === "text" || current.type === "text") {
          lines.push(...this.textField.render(width));
        }
      }
      // Transient flash line sits directly above the footer (h2.37), one
      // visibleWidth-bounded dim line; timer expiry clears it.
      const flash = this.flashLine(width);
      if (flash !== undefined) lines.push(flash);
      lines.push(renderFooter(snapshot, this.view, this.labels, this.theme, width));
      return lines;
    }
    if (this.view === "deep") {
      return ["[deep] placeholder (TODO M5.T1)", `scrollOffset: ${this.scrollOffset}`];
    }
    return ["[overview] placeholder (TODO M5.T2)"];
  }
}

/**
 * Initial focus selection: explicit focusQuestionId when the question exists,
 * else the first status-"open" question, else the first question.
 */
function pickInitialQuestionId(state: InterrogationState, focusQuestionId?: string): string | undefined {
  const ordered = state.orderedQuestions();
  if (focusQuestionId !== undefined && ordered.some((q) => q.id === focusQuestionId)) {
    return focusQuestionId;
  }
  const firstOpen = ordered.find((q) => q.status === "open");
  return (firstOpen ?? ordered[0])?.id;
}

/** First upserted id that is still in an active status (h2.37 reopen focus). */
function firstActiveUpsertedId(state: InterrogationState, ids: string[]): string | undefined {
  for (const id of ids) {
    const q = state.getQuestion(id);
    if (q !== undefined && ACTIVE_STATUSES.includes(q.status)) return id;
  }
  return undefined;
}

// ------------------------------------------------------------------- host

type HostPhase = "closed" | "open" | "suspended";

/** Module-scoped host record — one panel host per extension session. */
let phase: HostPhase = "closed";
let currentPanel: InterrogationPanel | undefined;
let activePi: PiUISurface | undefined;
let lastOpts: OpenPanelOptions | undefined;
/** State instance currently wired for questions-upserted (for re-subscribe). */
let upsertState: InterrogationState | undefined;

/**
 * custom() resolution / rejection landing spot. ANY resolution counts as
 * suspend (null = suspend per h2.35; undefined host quirks are treated the
 * same — never reopen from a resolved custom()). Idempotent: only the
 * open→suspended edge mutates, so a done(null) already handled by the
 * lifecycle dismiss path cannot corrupt host flags.
 */
function markSuspended(): void {
  if (phase !== "open") return;
  phase = "suspended";
  currentPanel = undefined; // fresh instance on reopen — deepSticky resets
}

/** questions-upserted while open → invalidate; while suspended → reopen. */
function handleUpserted(ids: string[]): void {
  if (phase === "open") {
    // Open-but-stale: just invalidate — the panel re-reads state on render.
    currentPanel?.invalidate();
    return;
  }
  if (phase === "suspended" && activePi !== undefined && lastOpts !== undefined) {
    // h2.37: fresh instance rehydrated from state, focused on the first
    // upserted currently-active question.
    openPanel(activePi, {
      ...lastOpts,
      focusQuestionId: firstActiveUpsertedId(lastOpts.state, ids),
    });
  }
}

/** Force-close the current panel (no-op when nothing is open). */
function suspendCurrent(): void {
  if (phase !== "open") return;
  const panel = currentPanel;
  phase = "suspended";
  currentPanel = undefined;
  panel?.dispose(); // drop the state subscription ourselves (idempotent)
  panel?.suspend(); // done(null) → floating .then → markSuspended no-op
}

/** Detach the host-level upsert subscription and drop every stored reference. */
function resetHostRecord(): void {
  upsertState?.off("questions-upserted", handleUpserted);
  upsertState = undefined;
  phase = "closed";
  currentPanel = undefined;
  activePi = undefined;
  lastOpts = undefined;
}

/**
 * Build the panel host and wire the lifecycle dismiss path: the M2
 * auto-close/completion engine calls `lifecycle.dismissPanel()`, which lands
 * here as a suspend (done(null) → editor restored, host suspended).
 *
 * Re-arms the module-scoped host record, so calling this again (tests, or a
 * hypothetical second host) starts from a clean closed state.
 */
export function createPanelHost(lifecycle: {
  onPanelDismiss(cb: () => void): void;
  dismissPanel(): void;
}): PanelHost {
  resetHostRecord();
  lifecycle.onPanelDismiss(() => suspendCurrent());
  return {
    isOpen: () => phase === "open",
    isSuspended: () => phase === "suspended",
    suspend: () => suspendCurrent(),
    getPanel: () => currentPanel,
    dispose: () => resetHostRecord(),
  };
}

/**
 * Opens the interrogation panel fire-and-forget.
 *
 * WHY NOT AWAIT (Mode A): `ctx.ui.custom()` blocks until `done()` fires. The
 * interrogate tool must return immediately (h2.0 commitment 1 — non-blocking,
 * panel persists while idle). Awaiting the custom() promise anywhere
 * reachable from the tool execute or turn path would stall the turn exactly
 * like the ask_user extension. We deliberately orphan the promise and react
 * to its resolution (null = suspend, h2.35; any other resolution — including
 * undefined host quirks — is treated as suspend too) via .then/.catch.
 * Ref: plan architecture/system-context.md §"Verified architectural pattern".
 *
 * Behavior contract:
 * - Guards `mode === "tui"` (custom() resolves undefined in RPC mode).
 * - Single-instance: while a panel is open this is a no-op returning false
 *   (an upsert and a reconstruction can otherwise double-replace the editor).
 * - Subscribes questions-upserted on the given state instance for the
 *   open-invalidate / suspended-reopen behavior (h2.37); a prior
 *   subscription on an older state instance is replaced.
 *
 * @returns true when the panel opened (or was reopened), false when the
 *          mode guard, single-instance guard, or a non-promise custom()
 *          return blocked it.
 */
export function openPanel(pi: PiUISurface, opts: OpenPanelOptions): boolean {
  if (pi.mode !== undefined && pi.mode !== "tui") return false;
  if (phase === "open") return false;

  activePi = pi;
  lastOpts = opts;

  // Capture the composed-editor factory ONCE per panel instantiation
  // (h2.31) — never inside render or per keystroke. Undefined is a normal
  // state (no composed editor registered) → stock Editor fallback, silent.
  const editorFactory = pi.ui.getEditorComponent?.();

  // (Re)arm the host-level upsert subscription on THIS state instance —
  // exactly one live subscription at any time (off-then-on of the same
  // handler cannot stack).
  upsertState?.off("questions-upserted", handleUpserted);
  upsertState = opts.state;
  opts.state.on("questions-upserted", handleUpserted);

  // FIRE-AND-FORGET — see the Mode A JSDoc above. NEVER await this promise.
  const promise = pi.ui.custom<null>((tui, theme, keybindings, done) => {
    const panel = new InterrogationPanel({
      tui,
      theme,
      keybindings,
      editorFactory,
      done,
      state: opts.state,
      config: opts.config,
      drafts: opts.drafts,
      keys: opts.keys,
      delivery: opts.delivery,
      confirmRipple: opts.confirmRipple,
      focusQuestionId: opts.focusQuestionId,
    });
    currentPanel = panel;
    return panel;
  });

  // Host quirk tolerance: a non-promise return (RPC-mode undefined) means
  // nothing mounted — do not flip to open.
  if (promise === undefined || typeof promise.then !== "function") return false;

  phase = "open";
  void promise
    .then(() => {
      // Belt-and-braces cleanup: pi disposes the component on done(), but the
      // host must not depend on it — drop the state subscription ourselves
      // (dispose is idempotent). Dispose BEFORE markSuspended clears the
      // panel reference.
      currentPanel?.dispose();
      markSuspended();
    })
    .catch(() => {
      currentPanel?.dispose();
      markSuspended(); // log-safe swallow: a crashed panel must not wedge the host
    });
  return true;
}

/** Force-close the current panel through the host (dismiss-path entry point). */
export function suspendPanel(host: PanelHost): void {
  host.suspend();
}

/**
 * Auto-open on interrogate tool completion (first open + h2.37 reopen).
 *
 * index.ts calls this once at factory time; the tool_execution_end
 * subscription mirrors lifecycle.ts's narrowing (interrogate + !isError).
 * The UI surface comes from the handler's ExtensionContext (pi hands
 * `(event, ctx)` to handlers — ctx.ui.custom is the panel entry point; the
 * ExtensionAPI root has no ui). The state singleton is read lazily at event
 * time — it does not exist until the first upsert creates it.
 * Reopen-while-suspended from tool-path upserts is naturally covered:
 * openPanel no-ops while open and reopens while suspended (the state-event
 * path inside openPanel handles upserts that bypass tool events, e.g. the
 * debug command).
 *
 * pi.on returns void in the installed runtime — no unsubscriber is assumed
 * (tolerant track() pattern from lifecycle.ts).
 */
export function maybeAutoOpen(
  pi: Pick<ExtensionAPI, "on">,
  config: InterrogatorConfig,
  host: PanelHost,
): void {
  void pi.on("tool_execution_end", (event, ctx) => {
    if (event.toolName !== "interrogate" || event.isError) return;
    if (host.isOpen()) return;
    const state = getState();
    if (state === undefined) return;
    openPanel(ctx, { config, state });
  });
}

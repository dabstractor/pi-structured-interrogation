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
 *   (src/panel/short-view.ts, P1.M3.T2.S1); the deep (P1.M5.T1.S1) and
 *   overview (P1.M5.T2.S1) branches render their bounded content between
 *   the shared header/footer.
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
import { Key, matchesKey, parseKey, type Component, type TUI } from "@earendil-works/pi-tui";
import {
  editInExternalEditor,
  resolveExternalEditorCommand,
} from "../external-editor.js";
import { resolveKeyLabels, type InterrogatorConfig, type KeyAction } from "../config.js";
// SURFACE-001 gate (1): the single upsert-args predicate (lifecycle.ts is its
// only other consumer — no duplicate definition; no import cycle: lifecycle
// imports merge.js + state.js only, never panel.js).
import { isUpsertArgs } from "../lifecycle.js";
import { getState, type InterrogationState, type SerializedState } from "../state.js";
import { nextUnanswered, writeInEnter, type RippleConfirmFn, type SubmitDeps } from "./actions.js";
import {
  applyConfirmedEdit,
  applyTextConfirm,
  applyWriteInConfirm,
  beginTextConfirm,
  cancelConfirm,
  cancelTextConfirm,
  cancelWriteInConfirm,
  createRippleConfirm,
  rippleVictims,
  type RippleConfirmState,
} from "./ripple-confirm.js";
import { discussInChat } from "./discuss.js";
import { buildKeyRouter, defaultRoutedActions, desiredTextDuty } from "./keys.js";
import { createEditorComponent, TextField, type EditorFactory } from "./text-field.js";
import {
  renderConfirmFooter,
  renderDutyLabel,
  renderFlashLine,
  renderFooter,
  renderGateWarningLine,
  renderHeader,
  renderHintLine,
  renderNoteHeader,
  renderQuestionLine,
} from "./layout.js";
import {
  effectiveGroup,
  gateGroupNames,
  gateHoldLine,
  gateWarningLine,
  pickGateInitialQuestionId,
} from "./gate.js";
import { buildDeepContent, deepSeedCursorIndex, renderDeepWindow } from "./deep-view.js";
import { buildOverviewContent, clampOverviewScroll } from "./overview.js";
import { initialCursorIndex, renderShortViewOptions } from "./short-view.js";
import { terminalBudget } from "./terminal-budget.js";
import {
  RESUMABLE_STATUSES as ACTIVE_STATUSES,
  updateSuspendWidget,
  WIDGET_KEY,
} from "./suspend.js";

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
  // ---- extended lifecycle API (P1.M4.T2.S1) — OPTIONAL members so existing
  // test stubs stay valid; the real src/draft-store.ts implements them all.
  /** ✎-marker data (short view): true only for a slot with NON-empty text. */
  hasDraft?(questionId: string): boolean;
  /** NO-OP unless opts.explicit === true (R4: destroy only on explicit user action). */
  clearDraft?(questionId: string, opts?: { explicit?: boolean }): boolean;
  /** Submit flush: remove + return shipped entries (all slots when ids omitted). */
  shipDrafts?(ids?: string[]): Map<string, { value: string; text: string }>;
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
  /**
   * Branch-follow seam (session_tree): re-point the host's stored state
   * references — `lastOpts.state`, the h2.37 `questions-upserted`
   * subscription, and (when `surface` is given) the active surface — at a
   * reconstructed state instance WITHOUT opening, suspending, or otherwise
   * surfacing anything. Reconstruction on tree navigation calls this so a
   * later deliberate resume (`/interrogate`, model upsert, `{reopen:true}`)
   * rehydrates from the branch the user is actually on — never the
   * pre-navigation state. No-op when no panel was ever opened on this host
   * (nothing is resumable, so nothing needs retargeting).
   */
  retargetState(state: InterrogationState, surface?: PiUISurface): void;
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
    /**
     * Keyed widget line above the restored editor (h2.3) — the suspend
     * reminder surface; `undefined` content clears the widget. OPTIONAL so
     * existing test fakes and RPC surfaces stay valid; every call site
     * guards (directly or via suspend.ts updateSuspendWidget).
     */
    setWidget?(key: string, content: string[] | undefined, options?: { placement?: string }): void;
    /**
     * Editor preload (h2.35 discuss handoff) — the ONLY sanctioned writer
     * of main-editor text from the panel (discuss.ts discussInChat).
     * Optional: test fakes / RPC surfaces stay valid — every call site
     * guards (`?.`), same pattern as setWidget.
     */
    setEditorText?(text: string): void;
    /**
     * Editor text read-back (h2.35 verify-in-test, P1.M6.T2.S3) — the
     * belt-and-braces counterpart of setEditorText; only
     * editor-preservation.ts's fallback helpers read main-editor text
     * (never the production suspend path — native preservation is
     * verified). Optional: test fakes / RPC surfaces omit it; every call
     * site guards (`?.`), same pattern as setWidget/setEditorText.
     */
    getEditorText?(): string;
  };
  mode?: string;
  /**
   * Real submit transport (NEW-001) — the message channel the panel's
   * ctrl+s delivery uses when no explicit `delivery` opt was supplied.
   * Present on every real ExtensionContext; OPTIONAL so test fakes and
   * RPC surfaces stay valid (submit stays inert without it, as before).
   * Declared as a method so the real generic signature stays
   * structurally compatible (bivariant method checks).
   */
  sendMessage?(message: unknown, options?: unknown): void;
  /**
   * Live idle probe (ExtensionContext.isIdle) read AT SUBMIT TIME for the
   * delivery matrix. Optional: absent (test fakes) → treated as idle, the
   * safe triggerTurn+followUp branch of delivery.ts's matrix.
   */
  isIdle?(): boolean;
}

/**
 * BUGFIX (dead ctrl+s): minimal transport surface for the createPanelHost
 * delivery fallback — the ExtensionAPI root carries sendMessage (+ no ui),
 * so it cannot be a full PiUISurface. Structurally compatible with any
 * surface that can submit.
 */
export interface DeliveryTransportSurface {
  sendMessage?(message: unknown, options?: unknown): void;
  isIdle?(): boolean;
}

/**
 * Build the production SubmitDeps for a panel opened on `surface` (NEW-001
 * + dead-ctrl+s bugfix): the transport is the surface's sendMessage —
 * carried by the ExtensionAPI ROOT in a real session, NOT by event/tool
 * contexts (ExtensionContext has isIdle but no sendMessage in pi 0.85.x),
 * so openPanel falls back to the api root captured by createPanelHost. The
 * idle probe reads the surface LIVE at submit time (idle-status unknown →
 * idle, the safe followUp branch of delivery.ts's matrix), and
 * `noteSubmissionDelivered` threads the h2.44 line-1 lifecycle contract
 * (supplied by createPanelHost from the real lifecycle; optional so bare
 * surfaces/tests stay valid).
 *
 * @returns undefined when the surface carries no sendMessage — the panel
 * then opens exactly as before this fix (inert submit; tests passing
 * explicit `delivery` opts are unaffected).
 */
export function surfaceSubmitDeps(
  surface: PiUISurface | DeliveryTransportSurface,
  noteSubmissionDelivered?: () => void,
): SubmitDeps | undefined {
  if (typeof surface.sendMessage !== "function") return undefined;
  const send = surface.sendMessage;
  const deps: SubmitDeps = {
    sendMessage: (msg, opts) => send.call(surface, msg, opts),
    isIdle: () => (typeof surface.isIdle === "function" ? surface.isIdle() : true),
  };
  if (noteSubmissionDelivered !== undefined) deps.noteSubmissionDelivered = noteSubmissionDelivered;
  return deps;
}

// ------------------------------------------------------- panel component

/** Footer flash lifetime (h2.37 transient states ~2.5s). */
const FLASH_MS = 2500;

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
  /**
   * PiUISurface carrier (P1.M6.T2.S2) — captured once per openPanel (same
   * pattern as editorFactory) so the host can refine the discuss seam at
   * the router-construction site: keys.ts itself stays UI-free.
   */
  pi?: PiUISurface;
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
    // EXPLAIN-002: the editor buffer is QUESTION-SCOPED — switching
    // questions writes the outgoing buffer through to its owner question's
    // draft and re-seeds from the new question's draft. Without this, the
    // one-per-panel editor (h2.31) shows the PREVIOUS question's text when
    // a text-type question renders its editor region unfocused, or when
    // tab/shift+tab navigate while the editor is focused.
    this.syncBufferToQuestion(id);
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
   * Overview cursor — index into orderedQuestions() (NOT into rendered
   * rows; group headers are not cursor targets). Seeded ONCE on the
   * setView("overview") transition to the current question's index
   * (P1.M5.T2.S1 — ctrl+l/esc round-trips stay where you were); moved only
   * by the overview actions (overview.ts), never by renderers.
   */
  overviewCursor = 0;
  /** Overview scroll offset in rendered LINES, clamped to keep the cursor row visible. */
  overviewScroll = 0;

  /**
   * Panel-local free-text drafts keyed by question id (h2.45): an enter
   * save ({@link saveTextDraft}) writes {value, text} here synchronously,
   * making it the freshest read for refocus seeding ({@link focusTextField}
   * falls back to the DraftStore seam). Survives question navigation (R4) —
   * it is NEVER cleared in this task; destruction/reconciliation rules
   * belong to P1.M4.T2.S1.
   */
  private draftSlots = new Map<string, TextDraft>();

  /**
   * EXPLAIN-002 — which question (or duty) the TextField's buffer currently
   * holds: a question id, "note" while the editor is on note duty, or
   * undefined before the first assignment. The single editor component is
   * per-PANEL (h2.31) but its CONTENT is per-QUESTION: {@link syncBufferToQuestion}
   * maintains that invariant at every switch point so a long-form answer
   * never bleeds across questions (a text-type question renders the editor
   * region unfocused — it must show ITS draft, blank when none, never the
   * previous question's leftovers).
   */
  private bufferOwner: string | "note" | undefined;

  /**
   * [Mode A] The embedded editor's answer-side duty (WRITEIN-001, h2.32).
   * ONE editor, three duties: "writein" (the buffer IS the answer — entered
   * by accepting the ✎ Other row; enter COMMITS `applyAnswer({value, custom:
   * true})` + advance, Q14 parity), "elaboration" (default — the buffer
   * attaches to the selected option at submit; entered via keys.focusText,
   * P1.M2.T3.S1), and note duty (focus === "note", R3 — question-agnostic,
   * unchanged). The ACTIVE duty decides what the text MEANS and what the
   * editor region label says; it is set at focus time and reset to
   * "elaboration" on every blur.
   */
  textDuty: "writein" | "elaboration" = "elaboration";

  /**
   * Timestamp of the last esc KEY PRESS while the embedded editor held
   * focus (ESC-002): the double-esc exit window's anchor. Written/cleared
   * by the key router (keys.ts) — the panel only hosts the state. Any
   * non-esc input clears it ("esc twice IN A ROW" is strict), and leaving
   * editor focus (blur, suspend, mode exits) clears it via the exit paths.
   */
  lastEscAt: number | undefined;

  /**
   * Batch note text (R3) — written by {@link exitNoteMode} (enter, esc, and
   * ctrl+shift+m re-press all write through) and read at submit time as the
   * fallback when no DraftStore seam carries a note. Cleared by the submit
   * action AFTER the note ships (h2.32 "cleared after shipping").
   */
  batchNote = "";

  /**
   * Transient footer flash (h2.37 empty-state feedback, e.g. "nothing to
   * submit"): set via flash(), auto-cleared after {@link FLASH_MS} by its
   * own timer (which re-invalidates once). The timer is cleared in dispose()
   * so a suspended panel never repaints.
   */
  footerFlash: { text: string; timer?: ReturnType<typeof setTimeout> } | undefined;

  /**
   * Active soft-gate notice (P1.M5.T3.S1 warning + P2.M1.T2.S1 hold) — ONE
   * shared non-expiring slot, discriminated by `kind` (no second field):
   *
   * - `kind: "submit"` — the legacy submit-time warning: set by the submit
   *   action AFTER a real delivery is committed (never on the zero-pending
   *   path) when `config.gateWarnings` is on and gate-group questions remain
   *   unanswered. Rendered via gateWarningLine(count) — "…later answers may
   *   shift". Display-only; it NEVER blocks, delays, or vetoes anything.
   * - `kind: "hold"` — the AUTOSUBMIT-002 commit-time hold (P2.M1.T2.S1):
   *   set by maybeAutoSubmit when it WITHHOLDS the auto-submit because
   *   gate-group questions remain unanswered on an otherwise-complete set.
   *   Rendered via gateHoldLine(count, submitLabel) — the FR-D5 line naming
   *   the config-resolved submit key as the deliberate override (never a
   *   hardcoded chord). Withholding-only: ctrl+s still delivers via the
   *   unchanged submit path, which overwrites this with the `kind: "submit"`
   *   legacy warning after delivery.
   *
   * Both kinds: non-expiring (unlike {@link footerFlash}); any key dismisses
   * — handleInput stage 0 clears the field and CONTINUES normal key
   * processing, so the dismissing key still performs its own action (dismiss
   * + act). Rendered in the shared line above the footer, where the notice
   * wins over a still-live flash while active (h2.37: flashes never stack);
   * confirmMode suppression covers both kinds.
   */
  gateWarning:
    | { count: number; kind: "submit" }
    | { count: number; kind: "hold"; submitLabel: string }
    | null = null;

  /**
   * Modal ripple-confirm state (FR-18 / Q39=B, P1.M5.T4.S1) — set by the
   * default rippleConfirm seam (createRippleConfirm) when a pending answer
   * edit would invalidate ≥ 1 answered/submitted questions, by the text
   * stage-1 gate in {@link saveTextDraft}, or by the write-in commit gate
   * (kind "writein", P1.M2.T2.S2) in {@link writeInEnter}. While non-null
   * the mode is
   * MODAL: handleInput consumes every key (only enter=keep / esc=cancel
   * act), the footer is REPLACED by renderConfirmFooter in every view, and
   * the transient notice slot (flash + gate warning) is suppressed. Null
   * (the resting state) ⇒ every path behaves exactly as before this task.
   * Mutated only by the ripple-confirm flow (src/panel/ripple-confirm.ts).
   */
  confirmMode: RippleConfirmState | null = null;

  /** Submit transport seam — inert matcher branch when undefined. */
  readonly delivery: SubmitDeps | undefined;

  /**
   * Ripple-confirm seam (P1.M5.T4.S1 swaps the default). Public field so
   * M5 can reassign it without reconstructing the panel.
   */
  rippleConfirm: RippleConfirmFn;

  private readonly tui: TUI;
  /**
   * Public readonly — the deep-view scroll actions (deep-view.ts) build the
   * pane content off the panel to recompute scrollOffset; theme is a
   * per-instance constant so exposing it is read-only by construction.
   */
  readonly theme: Theme;
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
  /**
   * Public readonly — the submit action (actions.ts) flushes shipped
   * questions' drafts through it (shipDrafts, R4/h2.45). The store itself
   * is owned by the extension closure (index.ts), never constructed here.
   */
  readonly drafts: DraftStore | undefined;
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
   *
   * Public (readonly) since P2.M1.T2.S1: actions.ts maybeAutoSubmit reads
   * `labels.submit` to arm the commit-time hold line with the config-resolved
   * submit label — display strings must flow from here, never a literal chord.
   */
  readonly labels: Record<KeyAction, string>;
  private cached: string[] | undefined;
  /** Liveness signal: true once pi actually rendered this panel (cold-resume fix). */
  renderedOnce = false;
  /**
   * Last render width (-1 before the first render). Public so the deep-view
   * scroll actions clamp offsets against the width the pane was last
   * rendered at; renderDeepWindow re-clamps defensively on width changes.
   */
  lastWidth = -1;
  /**
   * Rows of the render pass that produced {@link cached} (undefined when
   * the terminal height was unknown — test mocks / odd environments). Part
   * of the cache key (h2.30, P1.M7.T5.S1): a resize that changes ONLY the
   * height must still rebuild, because hint suppression and overview
   * pagination are row-derived.
   */
  private lastRows: number | undefined;
  /** Guard so a second done() after suspend cannot re-resolve (idempotent). */
  private resolved = false;

  /**
   * Re-entrancy guard for the ctrl+g external-editor handoff — a second
   * trigger while one round-trip is in flight is a no-op (the TUI is
   * stopped anyway; the flag makes the guard testable).
   */
  private externalEditorInFlight = false;

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
    // untouched): ctrl+t is now a TOGGLE (ESC-002) — options focus → focus
    // + seed the embedded editor; text focus → exitTextField (draft
    // write-through + blur — never a commit). A deterministic single-key
    // "close the prompt box" companion to the double-esc exit.
    // WRITEIN-001 duty-follows-cursor (P1.M2.T3.S1, h2.32): the ENTRY
    // declares the duty via desiredTextDuty — write-in when the cursor sits
    // on the ✎ Other row or the question is type:"text", elaboration
    // otherwise. The re-press exit is duty-agnostic: save + blur, never a
    // commit, from either duty (R4 write-through).
    const routed = defaultRoutedActions(args.delivery);
    routed.onFocusText = (p) => {
      if (p.focus === "text") p.exitTextField();
      else p.focusTextField(desiredTextDuty(p));
    };
    // Host-side refinement of the discuss seam (P1.M6.T2.S2): discussInChat
    // needs the PiUISurface to preload the editor (h2.35), so the closure
    // is injected HERE — keys.ts stays UI-free. args.keys (host override)
    // still wins wholesale below.
    if (args.pi !== undefined) {
      const pi = args.pi;
      routed.onDiscuss = (p) => {
        discussInChat(pi, p);
      };
    }
    this.keys = args.keys ?? buildKeyRouter(args.config, routed);
    this.labels = resolveKeyLabels(args.config);
    this.delivery = args.delivery;
    this.rippleConfirm = args.confirmRipple ?? createRippleConfirm();
    // Initial focus (FR-1, P1.M5.T3.S1): focusQuestionId → gate group's
    // first answerable question → gate group's first question → first open →
    // first. With NO gate group declared the ladder degenerates to the
    // pre-gate behavior exactly (gate.ts pickGateInitialQuestionId tail).
    const ordered = args.state.orderedQuestions();
    this.currentId = pickGateInitialQuestionId(ordered, gateGroupNames(ordered), args.focusQuestionId);

    // Contract 7 — state is the source of truth: any mutation invalidates the
    // cached lines so renderers stay dumb. Unsubscribed in dispose().
    this.state.on("changed", this.onChanged);
  }

  /**
   * Cached render (todo.ts/questionnaire.ts discipline): rebuild only when
   * the width OR the terminal height changed (h2.30 — the fallbacks are
   * row-derived) or invalidate() cleared the cache; callers get the SAME
   * array reference between rebuilds. rows is re-read per call — no resize
   * event plumbing (the TUI repaints on resize; the next render re-derives
   * the budget from live dimensions).
   */
  render(width: number): string[] {
    const rows = this.currentRows();
    this.renderedOnce = true; // liveness: pi mounted and painted us at least once
    if (this.cached !== undefined && width === this.lastWidth && rows === this.lastRows) {
      return this.cached;
    }
    this.lastWidth = width;
    this.lastRows = rows;
    this.cached = this.buildLines(width);
    return this.cached;
  }

  /** Drop the render cache and schedule a TUI repaint. */
  invalidate(): void {
    this.cached = undefined;
    this.tui.requestRender();
  }

  /**
   * Live terminal height for THIS render pass (h2.30 height source — the
   * pi-api-validation.md §Unknown 2 resolution): re-read on every render,
   * never cached across passes, no resize subscription. Defensive: a TUI
   * without a `terminal` (test mocks, odd hosts) or a non-finite /
   * non-positive rows value reads as UNKNOWN — no height fallbacks (the
   * pre-P1.M7.T5.S1 layout; never an empty window, never a suppressed
   * hint).
   */
  private currentRows(): number | undefined {
    const rows: number | undefined = this.tui.terminal?.rows;
    return typeof rows === "number" && Number.isFinite(rows) && rows > 0 ? rows : undefined;
  }

  /**
   * [Mode A] Enter commits per duty (WRITEIN-001, h2.32 / FR-D2) — the
   * order inside this method is:
   *
   *   resolved guard → ctrl+c → CONFIRM-MODE CHECK (modal, FR-18) →
   *   gate-warning dismissal → enter-per-duty fork → keys seam → textField
   *   forwarding.
   *
   * There are NO arming stages: the h2.31 two-stage machinery (the
   * one-shot advance flag and the armed stage-2 advance) was REMOVED
   * (P1.M2.T4.S1) — a single enter now does the whole job, so the armed
   * second enter has no remaining purpose.
   *
   * The CONFIRM-MODE CHECK (P1.M5.T4.S1) sits BEFORE everything else
   * because the mode is MODAL: only enter (keep) / esc (cancel) act and
   * every other key is a consumed no-op — including keys that would
   * dismiss a gate warning. The modal check also runs before the duty
   * fork, so a confirm-enter can never double-fire as a duty commit.
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
    // CTRL-C-001 (SIGINT-style escape): ctrl+c closes the prompt FIRST —
    // suspend() (done(null): pi restores + refocuses the main editor; state
    // and drafts preserved) — and returns UNCONSUMED so pi's own ctrl+c
    // flow (app.clear: clear editor, then a second press within 500ms →
    // shutdown) resumes on the restored editor. Checked before the ripple
    // confirm modal and every other branch: an interrupt must always find
    // its way out. Built via Key.ctrl("c") (pi-tui's KeyId builder — never
    // a hardcoded label, h2.52) and matched like the fixed keys: it mirrors
    // the terminal SIGINT convention, not a panel hotkey (R5 covers the
    // panel's OWN keys).
    if (parseKey(data) === Key.ctrl("c")) {
      this.suspend();
      return false;
    }
    // CONFIRM MODE (FR-18 / Q39=B, P1.M5.T4.S1) — FIRST check after the
    // resolved guard, BEFORE the gate-warning dismissal: while a pending
    // answer edit awaits keep/cancel, no other key (including a gate-
    // warning dismissal or router/editor input)
    // may act. "\n" (ctrl+j newline) is excluded from keep exactly as in
    // the stage checks below; esc matches the router's fixed Key.escape.
    if (this.confirmMode !== null) {
      // ESC-002: a modal-consumed key breaks any pending esc-esc pair — the
      // editor never saw the modal's esc, so it cannot be its "second".
      this.lastEscAt = undefined;
      if (parseKey(data) === "enter" && data !== "\n") {
        if (this.confirmMode.kind === "text") applyTextConfirm(this);
        else if (this.confirmMode.kind === "writein") applyWriteInConfirm(this);
        else applyConfirmedEdit(this);
      } else if (matchesKey(data, Key.escape)) {
        if (this.confirmMode.kind === "text") cancelTextConfirm(this);
        else if (this.confirmMode.kind === "writein") cancelWriteInConfirm(this);
        else cancelConfirm(this);
      }
      return true; // modal: enter/esc acted; everything else is a consumed no-op
    }
    // Stage 0 — gate-warning dismissal (P1.M5.T3.S1, FR-9): ANY key clears
    // the warning and STILL acts. Clear + continue, never return: consuming
    // the key here would swallow the dismissing keypress (e.g. the first ↑
    // after submit would only dismiss) — "any key dismisses" means dismiss
    // AND act.
    if (this.gateWarning !== null) {
      this.gateWarning = null;
      this.invalidate();
    }
    const key = parseKey(data);
    // "\n" is a newline request (R4: ctrl+j / Ghostty shift+enter mapping),
    // never a stage transition — legacy parseKey resolves it to "enter", so
    // the raw byte is excluded here (kitty mode already yields "shift+enter").
    const enter = key === "enter" && data !== "\n";
    // Enter per duty (WRITEIN-001 — commit-at-enter, no arming stages):
    // enter in text/note focus NEVER reaches the editor (no stock
    // submitValue, no onSubmit) and never the router (in note focus the
    // router would read enter as options accept). Note exit = exitNoteMode:
    // the SAME write-through as esc/re-press (h2.32).
    if (enter && (this.focus === "text" || this.focus === "note")) {
      if (this.focus === "note") this.exitNoteMode();
      // The duty decides what enter MEANS (WRITEIN-001, P1.M2.T3.S1,
      // h2.32). Write-in duty: COMMIT the buffer as the answer
      // (writeInEnter — custom value + advance; FR-18 confirm on answered
      // edits). Elaboration duty: save + blur ONLY — the FR-18 gate runs
      // first (stageText), then save + blur; it NEVER advances and never
      // applies an answer (an elaboration alone never answers — FR-12).
      else if (this.textDuty === "writein") writeInEnter(this);
      else this.saveTextDraft();
      return true;
    }
    if (this.keys(data, this)) return true;
    // Unmatched input reaches the embedded editor while text OR note focus
    // is active (h2.34: config intercepts fired first inside the router —
    // the router consumed every panel key, even in editor focus). Note mode
    // is the SAME editor on note duty (R3), so it forwards identically.
    if (this.focus === "text" || this.focus === "note") {
      this.textField.handleInput(data);
      return true;
    }
    return false;
  }

  /**
   * Elaboration enter (WRITEIN-001 commit-at-enter): snapshot the editor
   * text into the panel-local draft slot ({value, text} per h2.45 — final
   * store reconciliation is P1.M4.T2.S1), persist via the DraftStore seam
   * when present, and blur back to options. Never commits an answer, never
   * advances, never selects an option — an elaboration attaches to the
   * selection at submit (FR-12). See the [Mode A] JSDoc on
   * {@link handleInput} for why the trigger is panel-level interception.
   */
  private saveTextDraft(): void {
    this.stageText(this.textField.getText());
  }

  /**
   * Editor-exit gesture (ESC-002): back out of the explain editor to normal
   * question selection — write the buffer through to the draft slot (R4:
   * the typed text is sacred; a bare blur would let the next refocus seed a
   * STALE draft over it) and blur to options (going back is not an answer
   * gesture — the next enter accepts the highlighted option, it does not
   * commit). Fires from the ctrl+t toggle and the double-esc exit (keys.ts);
   * never suspends the panel and never touches state (same save discipline).
   */
  exitTextField(): void {
    this.stageText(this.textField.getText());
  }

  /**
   * Shared save core for the elaboration-enter and the editor-exit
   * gestures: FR-18 text gate first (re-saving a draft on an
   * answered/submitted question whose ripple would invalidate
   * answered/submitted questions defers the save into the modal confirm),
   * then the unconditional commit tail.
   */
  private stageText(text: string): void {
    const id = this.currentId;
    if (id !== undefined) {
      const q = this.state.getQuestion(id);
      if (
        q !== undefined &&
        q.answer !== undefined &&
        (q.status === "answered" || q.status === "submitted") &&
        rippleVictims(this, id).length > 0
      ) {
        beginTextConfirm(this, text);
        return; // deferred — applyTextConfirm runs on confirm-enter
      }
    }
    this.commitTextDraft(id, text);
  }

  /**
   * The unconditional save tail shared by the direct save path and the
   * ripple-confirm apply path (applyTextConfirm): write the panel-local
   * slot ({value, text} per h2.45), persist via the DraftStore seam, and
   * blur back to options. Never advances and never applies an answer (a
   * text save is not an answer gesture — WRITEIN-001 commit-at-enter: only
   * write-in duty commits, via writeInEnter). Takes the question id
   * explicitly so a deferred confirm commits against the STASHED id even
   * though the modal guarantees currentId cannot drift while it is open.
   */
  commitTextDraft(questionId: string | undefined, text: string): void {
    if (questionId !== undefined) {
      this.draftSlots.set(questionId, { value: questionId, text });
      this.drafts?.setDraft(questionId, text);
      // EXPLAIN-003 cursor landing: when the explain editor closes on a
      // CHOICE question with the cursor resting on the ✎ affordance,
      // re-seed to the ★ preselect (R2 discipline) — the affordance's job
      // is done (draft saved) and the next enter should ACCEPT the
      // recommendation, not re-open the editor.
      const q = this.state.getQuestion(questionId);
      if (
        q !== undefined &&
        q.type !== "text" &&
        this.currentId === questionId &&
        this.cursorIndex >= (q.options?.length ?? 0)
      ) {
        this.cursorIndex = initialCursorIndex(q);
      }
    }
    this.blurTextField(); // focus = "options" + editor blur + invalidate
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
    // Deep entry (P1.M5.T1.S1): seed the selection to the ★ recommendation
    // (clamped into the deep cursor domain — no ✎ index) and reset the
    // scroll window ONCE per entry; deepSticky bookkeeping stays with the
    // router's onDeep/onOverview seams.
    if (view === "deep") {
      const q =
        this.currentId !== undefined ? this.state.getQuestion(this.currentId) : undefined;
      this.cursorIndex = deepSeedCursorIndex(q);
      this.scrollOffset = 0;
    } else if (view === "overview") {
      // Overview entry (P1.M5.T2.S1): seed the cursor to the CURRENT
      // question's row index (ctrl+l → esc round-trips leave you where you
      // were; 0 when absent) and reset the scroll window ONCE per entry —
      // the unchanged-view no-op above guarantees once-only seeding.
      const ordered = this.state.orderedQuestions();
      const idx =
        this.currentId !== undefined ? ordered.findIndex((q) => q.id === this.currentId) : -1;
      this.overviewCursor = idx >= 0 ? idx : 0;
      this.overviewScroll = 0;
    }
    this.invalidate();
  }

  /**
   * EXPLAIN-002 — re-scope the editor buffer to `id` (called from the
   * currentId setter and the note-exit path):
   *
   * - NOTE duty (owner "note") is QUESTION-AGNOSTIC: navigating while the
   *   note editor is open must not touch the note buffer (the note rides
   *   the next submission regardless of the current question) — no-op.
   * - Same owner → no-op (the buffer already IS that question's draft;
   *   every unfocused write path keeps slot and buffer in sync, so a
   *   re-seed here could only clobber identical text).
   * - Different owner → R4 WRITE-THROUGH first: the buffer's typed-but-
   *   unsubmitted text belongs to its OWNER question, so persist it to that
   *   question's slot + DraftStore seam BEFORE switching (navigation never
   *   destroys drafts — this is what keeps tab-away-and-back lossless while
   *   the editor is focused). Then seed the incoming question's freshest
   *   draft (panel-local slot → seam → "" — a NEW BLANK box when it has
   *   never been drafted). The write-through is deliberately UNGATED (no
   *   FR-18 ripple modal): navigation is not an answer gesture — the modal
   *   guards only the explicit save/exit gestures (enter, ctrl+t, esc-esc).
   */
  private syncBufferToQuestion(id: string | undefined): void {
    if (this.bufferOwner === "note") return; // note duty ignores question switches
    if (this.bufferOwner === id) return; // already showing this question's draft
    if (this.bufferOwner !== undefined) {
      const text = this.textField.getText();
      // Absent-draft discipline (the store's "empty slot = absent draft"
      // rule): a never-drafted owner with an empty buffer writes NOTHING;
      // a buffer deleted-to-empty over an existing draft DOES write ""
      // (the deletion is honored — same as a stage-1 enter on an emptied
      // buffer).
      const existing = this.freshestDraftFor(this.bufferOwner);
      if (text.trim() !== "" || existing.trim() !== "") {
        this.draftSlots.set(this.bufferOwner, { value: this.bufferOwner, text });
        this.drafts?.setDraft(this.bufferOwner, text);
      }
    }
    this.bufferOwner = id;
    const draft = this.freshestDraftFor(id);
    this.textField.seed(draft);
  }

  /**
   * Freshest draft text for a question: panel-local stage-1 slot first
   * ({@link saveTextDraft}), falling back to the DraftStore seam — the same
   * precedence as {@link focusTextField}'s seeding. "" when the question
   * has no draft (or no question is current).
   */
  private freshestDraftFor(questionId: string | undefined): string {
    if (questionId === undefined) return "";
    return this.draftSlots.get(questionId)?.text ?? this.drafts?.getDraft(questionId) ?? "";
  }

  /**
   * Focus path for the router's onFocusText seam (keys.focusText / ctrl+t,
   * and the ✎ affordance route refined in the constructor): focus the
   * embedded editor and seed the current draft. P1.M4.T1.S2's seed-on-
   * refocus contract (h2.31) is preserved: the freshest read is the
   * panel-local slot written by stage-1 enter ({@link saveTextDraft}),
   * falling back to the DraftStore seam (P1.M4.T2.S1 supplies it) and
   * finally "". {@link TextField.seed} is idempotent — a same-question
   * re-focus whose buffer already matches is a textual no-op — while a
   * cross-question re-focus re-seeds instead of showing the previous
   * question's leftover text. EXPLAIN-002: the buffer owner is (re)claimed
   * for the current question after seeding.
   *
   * [Mode A] WRITEIN-001 duty-follows-entry (P1.M2.T3.S1, h2.32): the
   * ctrl+t entry passes the duty computed by keys.ts's
   * {@link desiredTextDuty} — `"writein"` when the cursor rests on the
   * ✎ Other row or the question is `type:"text"` (the buffer IS the
   * answer), `"elaboration"` otherwise (the buffer attaches to the
   * selection at submit; FR-12: an elaboration never answers alone). The
   * duty is per-focus-session: {@link blurTextField} resets it to
   * "elaboration", so every focus session re-declares it. When the
   * parameter is OMITTED the caller has pre-set the duty itself (actions.ts's
   * ✎ Other accept assigns `textDuty = "writein"` before calling this) —
   * a caller's declaration is never clobbered with the default.
   */
  focusTextField(duty?: "writein" | "elaboration"): void {
    this.focus = "text";
    if (duty !== undefined) this.textDuty = duty; // per-focus-session — see JSDoc
    this.syncBufferToQuestion(this.currentId);
    this.textField.seed(this.freshestDraftFor(this.currentId));
    this.bufferOwner = this.currentId;
    this.textField.focus();
    this.invalidate(); // the editor region appears immediately
  }

  /**
   * Freshest draft text for a question (submit-time reconciliation, NEW-002/
   * NEW-003): the panel-local stage-1 slot first ({@link saveTextDraft}),
   * falling back to the DraftStore seam — the same precedence as
   * {@link focusTextField}'s seeding. Public so actions.ts's submit flow can
   * read drafts without reaching into the private slot map.
   */
  draftTextFor(questionId: string): string | undefined {
    return this.draftSlots.get(questionId)?.text ?? this.drafts?.getDraft(questionId);
  }

  /**
   * Blur path back to the options region (two-stage enter wiring is
   * P1.M4.T1.S2; the router/actions call this once landed). Also the
   * double-esc anchor reset: leaving editor focus ends any pending
   * esc-esc pair (ESC-002 — "twice in a row" never spans focus modes).
   */
  blurTextField(): void {
    this.focus = "options";
    this.lastEscAt = undefined;
    this.textDuty = "elaboration"; // duty is per-focus-session (WRITEIN-001); next focus re-declares it
    this.textField.blur();
    this.invalidate(); // drop the editor region from the layout
  }

  /**
   * [Mode A] Enter note mode (R3 / FR-13, h2.32) — ctrl+shift+m swaps the
   * editor area into note duty AT ANY TIME: from options focus, text focus,
   * and any view (short/deep/overview — buildLines renders the same swap in
   * all of them). The SAME embedded TextField instance is reused — never a
   * second editor — and {@link TextField.seed} loads the freshest draft
   * idempotently with zero editor-history pollution: the DraftStore seam's
   * note first (the suspend/resume-safe copy, P1.M4.T2.S1), then the panel
   * field, then "".
   *
   * Hold-until-ship semantics (h2.32): the note is HELD — question
   * navigation, view toggles, upserts, and suspend/resume leave it alone —
   * until the NEXT real submission, where it rides the delta as a `NOTE:`
   * line, lands on `details.note` for the user-only diff card
   * (P1.M7.T3.S1), and is then cleared ("cleared after shipping"). A
   * zero-pending submit ships nothing and therefore holds the note. enter
   * saves + exits; esc / re-press exit via {@link exitNoteMode}, whose
   * write-through keeps the draft (FR-16).
   */
  enterNoteMode(): void {
    this.focus = "note";
    this.textField.seed(this.drafts?.getNote() || this.batchNote || "");
    this.bufferOwner = "note"; // EXPLAIN-002: note duty suspends question scoping
    this.textField.focus();
    this.invalidate(); // the note header + editor region appear immediately
  }

  /**
   * Exit note mode — the single landing spot for ALL three exits: enter
   * (stage-1 save in {@link handleInput}), esc (the router's esc-descent
   * ladder), and the ctrl+shift+m re-press (keys.ts onBatchNote toggle).
   * FR-16: exit never destroys state — the field text is WRITTEN THROUGH
   * to the DraftStore seam + panel field BEFORE blurring, so the draft
   * survives the exit and re-seeds on re-entry. Deliberately does NOT
   * commit an answer — a note is not a question answer.
   */
  exitNoteMode(): void {
    const text = this.textField.getText();
    this.batchNote = text;
    this.drafts?.setNote(text);
    // EXPLAIN-002: the buffer just held the NOTE — re-scope it to the
    // current question BEFORE anything renders the editor region for it
    // (a text-type question renders unfocused; it must never show note
    // text). Seeding from the question's freshest draft does not lose the
    // note: it was written through to batchNote + the seam above. Direct
    // seeding (not syncBufferToQuestion) — the note is not an answer draft
    // to write through anywhere.
    this.bufferOwner = this.currentId;
    this.textField.seed(this.freshestDraftFor(this.currentId));
    this.blurTextField(); // focus = "options" + editor blur + invalidate
  }

  /**
   * [Mode A] ctrl+g external-editor handoff (h2.31, P1.M4.T1.S3) — the
   * action behind the router's `onExternalEditor` seam (keys.ts, wired by
   * M4.T1.S3). Mirrors pi's own extension-editor.js envelope: read the
   * draft BEFORE suspending, stop the TUI, round-trip the text through
   * $VISUAL → $EDITOR → nano (win32: notepad — see external-editor.ts)
   * with inherited stdio, and ONLY on a clean exit (code 0) replace the
   * field text (BOM-stripped, one trailing newline dropped) and sync the
   * draft slot + DraftStore seam.
   *
   * The `finally` ALWAYS restarts the TUI and repaints — a failed readback
   * or a rejected editor promise must never leave the terminal dead or the
   * in-flight flag stuck — and the internal catch keeps the router's
   * fire-and-forget (`void p.openExternalEditor()`) rejection-free.
   *
   * Deliberately does NOT blur, change focus, or commit (WRITEIN-001:
   * "the text replaces the field", full stop — enter semantics belong to
   * the enter-per-duty fork in {@link handleInput}).
   */
  async openExternalEditor(): Promise<void> {
    if (this.externalEditorInFlight) return;
    this.externalEditorInFlight = true;
    const draft = this.textField.getText(); // read BEFORE suspending (pi's order)
    this.tui.stop();
    try {
      const result = await editInExternalEditor({
        command: resolveExternalEditorCommand(),
        content: draft,
      });
      if (result.status === "complete") {
        const id = this.currentId;
        this.textField.setText(result.content);
        if (id !== undefined) {
          this.draftSlots.set(id, { value: id, text: result.content });
          this.drafts?.setDraft(id, result.content);
          this.bufferOwner = id; // EXPLAIN-002: buffer now belongs to this question
        }
        this.invalidate();
      }
    } catch {
      // Log-safe swallow (host discipline): a failed readback must not
      // reject through the router's `void openExternalEditor()`.
    } finally {
      this.externalEditorInFlight = false;
      this.tui.start();
      this.tui.requestRender(true);
    }
  }

  /** The flash line for the current render pass, or undefined when unset. */
  private flashLine(width: number): string | undefined {
    if (this.footerFlash === undefined) return undefined;
    return renderFlashLine(this.footerFlash.text, this.theme, width);
  }

  /**
   * The one transient line above the footer (shared slot, h2.37: flashes
   * never stack). The soft-gate submit warning (P1.M5.T3.S1) wins while
   * active — it is more important than a 2.5s flash; once dismissed, a
   * still-live flash resumes showing.
   */
  private footerNoticeLine(width: number): string | undefined {
    // Modal confirm (FR-18): the transient slot is suppressed entirely —
    // the confirm footer replaces the footer line, and neither a live
    // flash nor a gate warning may compete with the keep/cancel decision.
    if (this.confirmMode !== null) return undefined;
    if (this.gateWarning !== null) {
      // P2.M1.T2.S1: the string is picked by the payload's kind — hold names
      // the config-resolved submit label (stored on the payload; this render
      // path has no config access), submit keeps the legacy partial-warning.
      const text =
        this.gateWarning.kind === "hold"
          ? gateHoldLine(this.gateWarning.count, this.gateWarning.submitLabel)
          : gateWarningLine(this.gateWarning.count);
      return renderGateWarningLine(text, this.theme, width);
    }
    return this.flashLine(width);
  }

  /**
   * The footer line for the current pass. While confirmMode is active
   * (FR-18) the standard footer is REPLACED wholesale — in every view and
   * in note mode — by the single-line confirm footer, so the keep/cancel
   * decision is always the only footer surface (exactly one line, never
   * double-pushed). While the embedded editor holds focus (ESC-002) the
   * footer hints swap to the editor's exit affordances: enter saves (not
   * accepts), the editor-mode toggle key closes, and esc-esc closes when
   * the double-esc window is armed (escExitWindowMs > 0).
   */
  private footerLine(snapshot: SerializedState, width: number, narrow: boolean): string {
    if (this.confirmMode !== null) {
      return renderConfirmFooter(this.confirmMode.victims, this.theme, width);
    }
    // h2.30 cols < 60 (P1.M7.T5.S1): narrow footer — key hints collapse to
    // submit + deep (labels from this.labels, resolved at construction —
    // h2.52); renderFooter's right-to-left fit loop stays the width net.
    const editorExit = this.focus === "text" || this.focus === "note";
    return renderFooter(snapshot, this.view, this.labels, this.theme, width, narrow, editorExit
      ? { mode: this.focus === "note" ? "note" : "text", escEscHint: this.config.escExitWindowMs > 0 }
      : undefined);
  }

  /**
   * Short view: real header/question/hint/footer lines (S2) around the
   * options region rendered by renderShortViewOptions (P1.M3.T2.S1). The
   * deep (P1.M5.T1.S1) and overview (P1.M5.T2.S1) branches render their own
   * bounded content between the shared header and the view-aware footer.
   * State is re-read on every rebuild — the panel is a view; state is the
   * source of truth (contract 7). An unknown/absent currentId renders
   * header + footer only (empty region).
   */
  private buildLines(width: number): string[] {
    // h2.30 adaptive budget (P1.M7.T5.S1): derived ONCE per rebuild from the
    // live terminal dimensions and threaded to the hint/overview/footer
    // renderers below (a pure flag — no renderer reads the terminal).
    const budget = terminalBudget(width, this.currentRows());
    // Note mode (R3, h2.32): the editor area is REPLACED — note header +
    // the SAME embedded editor + flash + footer; the question/hint/options
    // region vanishes entirely. View-agnostic: note mode may be entered
    // from short, deep, or overview and renders the identical swap.
    if (this.focus === "note") {
      const snapshot = this.state.serialize();
      const lines: string[] = [renderNoteHeader(this.theme, width)];
      lines.push(...this.textField.render(width));
      const notice = this.footerNoticeLine(width);
      if (notice !== undefined) lines.push(notice);
      lines.push(this.footerLine(snapshot, width, budget.narrow));
      return lines;
    }
    if (this.view === "short") {
      const snapshot = this.state.serialize();
      const header = renderHeader(snapshot, this.theme, width);
      const ordered = this.state.orderedQuestions();
      const idx =
        this.currentId !== undefined ? ordered.findIndex((q) => q.id === this.currentId) : -1;
      // Soft-gate dimming (P1.M5.T3.S1, R1): when a gate group exists and
      // the CURRENT question is not in it, its question/hint/option lines
      // render dimmed — display ONLY, every interaction unchanged. No gate
      // group → dimmed stays false → output byte-identical to pre-gate.
      const gateGroups = gateGroupNames(ordered);
      const lines = [header.line];
      if (idx >= 0) {
        const current = ordered[idx];
        const dimmed = gateGroups.size > 0 && !gateGroups.has(effectiveGroup(current));
        lines.push(renderQuestionLine(current, idx + 1, this.theme, width, dimmed));
        // h2.30 rows < 24 (P1.M7.T5.S1): the hint line is suppressed WHOLE
        // (never truncated into nothing); the deep view stays untouched —
        // the always-available full replacement. Unknown height keeps the
        // hint (budget defaults).
        if (!budget.suppressHint) {
          lines.push(...renderHintLine(current, this.theme, width, dimmed));
        }
        lines.push(
          ...renderShortViewOptions({
            question: current,
            cursorIndex: this.cursorIndex,
            theme: this.theme,
            width,
            dimmed,
          }),
        );
        // Editor region (h2.29, 3 lines default): the embedded editor shows
        // while text focus is active or the current question is a text
        // question (its primary affordance per short-view.ts). Sync the
        // wrapper flag with panel focus first so non-router focus paths
        // (actions.ts ✎ accept sets panel.focus directly) keep the editor's
        // own focused flag truthful. EXPLAIN-002: the buffer is question-
        // scoped (synced at every currentId change) — this UNFOCUSED render
        // for a text question shows THAT question's draft (blank when none),
        // never another question's leftover text or the batch note.
        if (this.focus === "text" && !this.textField.focused) this.textField.focus();
        if (this.focus === "text" || current.type === "text") {
          // WRITEIN-001 (h2.32, P1.M2.T3.S1): the ACTIVE duty visibly labels
          // the region — "OTHER — this text is the answer" in write-in duty,
          // "EXPLAIN — attaches to your selection" in elaboration duty (the
          // default ctrl+t entry). The label is what keeps the two meanings
          // from ever being confused. UNFOCUSED renders (a text question's
          // always-on editor preview) show no label — duty is a property of
          // an ACTIVE focus session, and blurTextField resets it. The
          // note-mode push above is already labeled by renderNoteHeader.
          if (this.focus === "text") {
            lines.push(renderDutyLabel(this.textDuty, this.theme, width));
          }
          lines.push(...this.textField.render(width));
        }
      }
      // Transient line directly above the footer (h2.37): the gate-warning
      // line when active, else the flash line; timer expiry clears flashes.
      const notice = this.footerNoticeLine(width);
      if (notice !== undefined) lines.push(notice);
      lines.push(this.footerLine(snapshot, width, budget.narrow));
      return lines;
    }
    if (this.view === "deep") {
      const snapshot = this.state.serialize();
      const header = renderHeader(snapshot, this.theme, width);
      const lines = [header.line];
      const q =
        this.currentId !== undefined ? this.state.getQuestion(this.currentId) : undefined;
      if (q !== undefined) {
        const content = buildDeepContent({
          question: q,
          goal: this.state.goal,
          cursorIndex: this.cursorIndex,
          scrollOffset: this.scrollOffset,
          theme: this.theme,
          width,
          maxChars: this.config.caps.ramification,
        });
        lines.push(...renderDeepWindow(content, this.cursorIndex, this.scrollOffset, this.theme, width));
      }
      const notice = this.footerNoticeLine(width);
      if (notice !== undefined) lines.push(notice);
      lines.push(this.footerLine(snapshot, width, budget.narrow));
      return lines;
    }
    // Overview (P1.M5.T2.S1, FR-11) — the exhaustive tail of the view chain
    // (note → short → deep → overview): shared header, the clamped
    // OVERVIEW_HEIGHT-line window of the full question list, flash, and the
    // view-aware footer. Renderers stay PURE: the scroll offset is clamped
    // into a LOCAL (the actions own overviewScroll); group headers ride the
    // content lines; the list is never filtered (R1/Q34=A).
    {
      const snapshot = this.state.serialize();
      const header = renderHeader(snapshot, this.theme, width);
      const lines = [header.line];
      const ordered = this.state.orderedQuestions();
      if (ordered.length > 0) {
        const content = buildOverviewContent({
          ordered,
          cursorIndex: this.overviewCursor,
          theme: this.theme,
          width,
          // h2.30 rows < 12 (P1.M7.T5.S1): paginate to a 5-line window.
          // Infinity (height unknown / ≥ 12) → undefined → overview.ts keeps
          // its OVERVIEW_HEIGHT default; cursor-visible clamping unchanged.
          viewportHeight: Number.isFinite(budget.overviewViewportHeight)
            ? budget.overviewViewportHeight
            : undefined,
        });
        const offset = clampOverviewScroll(content, this.overviewScroll, this.overviewCursor);
        const end = Math.min(content.lines.length, offset + content.viewportHeight);
        for (let i = offset; i < end; i++) lines.push(content.lines[i]!);
      }
      const notice = this.footerNoticeLine(width);
      if (notice !== undefined) lines.push(notice);
      lines.push(this.footerLine(snapshot, width, budget.narrow));
      return lines;
    }
  }
}

/**
 * Replaced by gate.ts pickGateInitialQuestionId (P1.M5.T3.S1): the panel
 * constructor now seeds focus through the gate-aware ladder, which
 * degenerates to this exact behavior when no gate group is declared.
 */

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
/** BUGFIX (dead ctrl+s): api-root surface supplied by createPanelHost — see there. */
let rootDeliveryFallbackSurface: DeliveryTransportSurface | undefined;
let lastOpts: OpenPanelOptions | undefined;
/**
 * Lifecycle submit hook (NEW-001) — captured by createPanelHost from the
 * real lifecycle so the surface-derived SubmitDeps can honor the h2.44
 * line-1 contract (noteSubmissionDelivered right after a real delivery).
 * Undefined until a host exists / when the lifecycle lacks the hook.
 */
let hostNoteSubmissionDelivered: (() => void) | undefined;
/** State instance currently wired for questions-upserted (for re-subscribe). */
let upsertState: InterrogationState | undefined;
/**
 * Pre-suspend focus memory (P1.M6.T1.S1) — captured at the suspend choke
 * points BEFORE the panel reference is dropped; consumed by resumeOpenPanel.
 */
let lastFocusId: string | undefined;
/** When the current open attempt started (ms) — the stuck-open clock. */
let openedAt = 0;
/** Monotonic open sequence — stale custom() resolutions are ignored. */
let openSeq = 0;

/**
 * STUCK-OPEN DETECTION (cold-resume fix): `phase === "open"` is set as soon
 * as custom() returns a promise, but the panel only truly exists once the
 * custom() BODY runs (it assigns `currentPanel`). On a cold `--session`
 * resume, reconstruction auto-opens during session_start and that body can
 * never run — the UI never mounts the component, the promise never
 * resolves, and the host deadlocks on a phantom panel: every entry point
 * (/interrogate, agent upserts, {reopen:true}) sees "already open" and
 * silently no-ops. Self-heal rule: an open that has NO mounted panel well
 * past the mount window is treated as NOT open, so callers remount. 5s is
 * orders of magnitude above the real body-run gap yet invisible to users.
 */
function stuckOpen(): boolean {
  return (
    phase === "open" &&
    currentPanel?.renderedOnce !== true &&
    Date.now() - openedAt > 5000
  );
}

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
    // Stuck-open (cold-resume phantom): remount instead of invalidating a
    // panel that never mounted — same shape as the suspended branch below.
    if (stuckOpen() && activePi !== undefined && lastOpts !== undefined) {
      openPanel(activePi, { ...lastOpts, focusQuestionId: firstActiveUpsertedId(lastOpts.state, ids) });
      return;
    }
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
  // Focus memory BEFORE dispose (P1.M6.T1.S1): the host-forced path (lifecycle
  // dismiss / host.suspend()) nulls currentPanel below, and the floating .then
  // cannot recover the id afterwards — capture it here while it is live.
  if (currentPanel !== undefined) lastFocusId = currentPanel.currentId;
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
  hostNoteSubmissionDelivered = undefined;
  // Full close (h2.0 commitment 3 tail): clear the reminder widget BEFORE
  // dropping the surface — activePi is nulled below, so this is the last
  // chance to leave no stale "…to resume /interrogate" line behind.
  activePi?.ui.setWidget?.(WIDGET_KEY, undefined);
  // A live panel component must not outlive its host record (the reset
  // would orphan its state subscription — the same leak the maybeAutoOpen
  // stale-record hardening guards). Idempotent: disposed already, or never
  // mounted (suspended/closed hosts), it is a no-op.
  currentPanel?.dispose();
  phase = "closed";
  currentPanel = undefined;
  activePi = undefined;
  lastOpts = undefined;
  lastFocusId = undefined;
}

/**
 * Branch-follow retarget (PanelHost.retargetState): swap every stored
 * reference to the panel's state onto a reconstructed instance WITHOUT any
 * surfacing side effect. Call order matters when the caller also suspends:
 * retarget synchronously (below) BEFORE the suspend's async landing spots —
 * updateSuspendWidget in the custom() `.then` reads `lastOpts.state` only
 * after the microtask runs, so the reminder widget shows the CURRENT
 * branch's counts. The pre-suspend focus memory (`lastFocusId`) is left
 * alone: resumeOpenPanel validates it against the retargeted state and
 * falls through its ladder when the old branch's question no longer exists.
 */
function retargetHostState(state: InterrogationState, surface?: PiUISurface): void {
  if (lastOpts === undefined) return; // never opened — nothing resumable
  lastOpts = { ...lastOpts, state };
  // Re-arm the ONE upsert subscription on the new instance (off-then-on of
  // the same handler cannot stack) so h2.37 suspended-reopen observes the
  // branch-correct state. An OPEN panel's own reference is deliberately NOT
  // swapped here — the tree-nav caller suspends it first (panels re-read
  // their constructor state on remount, so a stale open panel would render
  // the abandoned branch's questions).
  upsertState?.off("questions-upserted", handleUpserted);
  upsertState = state;
  state.on("questions-upserted", handleUpserted);
  // Fresh surface when the caller has one (the session_tree handler ctx): a
  // later suspended-reopen mounts on the CURRENT ui, not the pre-navigation
  // surface pi may have torn down with the old branch.
  if (surface !== undefined) activePi = surface;
}

/**
 * Build the panel host and wire the lifecycle dismiss path: the M2
 * auto-close/completion engine calls `lifecycle.dismissPanel()`, which lands
 * here as a suspend (done(null) → editor restored, host suspended).
 *
 * Re-arms the module-scoped host record, so calling this again (tests, or a
 * hypothetical second host) starts from a clean closed state.
 */
export function createPanelHost(
  lifecycle: {
    onPanelDismiss(cb: () => void): void;
    dismissPanel(): void;
    /** Optional so test lifecycles stay valid; wired into the submit deps. */
    noteSubmissionDelivered?(): void;
  },
  /**
   * BUGFIX (dead ctrl+s): the ExtensionAPI ROOT surface, captured at factory
   * time as a delivery fallback. Event/tool contexts (ExtensionContext) carry
   * isIdle but NOT sendMessage in pi 0.85.x — maybeAutoOpen/reconstruction
   * open the panel on such a context, so surfaceSubmitDeps(ctx) returned
   * undefined and every ctrl+s was a silent no-op. The api root DOES carry
   * sendMessage, so it fills the transport half whenever the open-path
   * surface cannot.
   */
  rootSurface?: DeliveryTransportSurface,
): PanelHost {
  resetHostRecord();
  rootDeliveryFallbackSurface = rootSurface;
  lifecycle.onPanelDismiss(() => suspendCurrent());
  // NEW-001: capture the h2.44 line-1 hook so every surface-derived
  // SubmitDeps resets the auto-close engine's per-run flags after delivery.
  hostNoteSubmissionDelivered =
    typeof lifecycle.noteSubmissionDelivered === "function"
      ? () => lifecycle.noteSubmissionDelivered?.()
      : undefined;
  return {
    isOpen: () => phase === "open" && !stuckOpen(),
    isSuspended: () => phase === "suspended",
    suspend: () => suspendCurrent(),
    getPanel: () => currentPanel,
    retargetState: retargetHostState,
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
 *   EXCEPT a stuck-open (no mounted panel past the mount window — see
 *   {@link stuckOpen}): the call falls through and remounts, healing the
 *   cold-resume phantom.
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
  if (phase === "open" && !stuckOpen()) return false;

  // NEW-001 — production submit wiring: when the caller supplied no explicit
  // delivery, derive the SubmitDeps from THIS surface (every real open path —
  // maybeAutoOpen, reconstruction auto-open, upsert-reopen/resume — rides a
  // surface carrying sendMessage). One defaulting site covers all of them;
  // lastOpts stores the RESOLVED opts so handleUpserted/resumeOpenPanel
  // spreads keep the transport across suspend/resume (R4).
  const delivery =
    opts.delivery ??
    surfaceSubmitDeps(pi, hostNoteSubmissionDelivered) ??
    (rootDeliveryFallbackSurface !== undefined
      ? surfaceSubmitDeps(rootDeliveryFallbackSurface, hostNoteSubmissionDelivered)
      : undefined);
  const resolvedOpts: OpenPanelOptions = { ...opts, delivery };

  activePi = pi;
  lastOpts = resolvedOpts;

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
      pi,
      done,
      state: resolvedOpts.state,
      config: resolvedOpts.config,
      drafts: resolvedOpts.drafts,
      keys: resolvedOpts.keys,
      delivery: resolvedOpts.delivery,
      confirmRipple: resolvedOpts.confirmRipple,
      focusQuestionId: resolvedOpts.focusQuestionId,
    });
    currentPanel = panel;
    return panel;
  });

  // Host quirk tolerance: a non-promise return (RPC-mode undefined) means
  // nothing mounted — do not flip to open.
  if (promise === undefined || typeof promise.then !== "function") return false;

  // Stuck-open remount invalidates any PRIOR pending custom(): this open
  // supersedes it, and its (never-arriving or late) resolution must not
  // suspend the NEW panel. Capture the sequence and ignore stale landings.
  const seq = ++openSeq;
  phase = "open";
  openedAt = Date.now();
  // A live panel makes the reminder stale — clear it NOW, before `return
  // true`: openPanel is synchronous until the promise resolves, so waiting
  // for .then would leave the line up while the panel is live.
  activePi?.ui.setWidget?.(WIDGET_KEY, undefined);
  void promise
    .then(() => {
      if (seq !== openSeq) return; // superseded by a remount — ignore
      // Belt-and-braces cleanup: pi disposes the component on done(), but the
      // host must not depend on it — drop the state subscription ourselves
      // (dispose is idempotent). Dispose BEFORE markSuspended clears the
      // panel reference.
      // Focus memory BEFORE markSuspended (P1.M6.T1.S1): currentPanel is
      // still live on the user-done path here. On the host-forced path
      // (suspendCurrent) currentPanel is already undefined — lastFocusId was
      // captured there, and the `!== undefined` guard below keeps it intact.
      if (currentPanel !== undefined) lastFocusId = currentPanel.currentId;
      currentPanel?.dispose();
      markSuspended();
      // Suspend choke point (h2.3/h2.35): EVERY custom() resolution lands
      // here with one rule — suspended ∧ open>0 → show the reminder line,
      // else clear it. Covers suspend with open questions, completion with
      // 0 open, and lifecycle dismiss (updateSuspendWidget guards the
      // optional setWidget itself).
      if (activePi !== undefined && lastOpts !== undefined) {
        updateSuspendWidget(activePi, lastOpts.state);
      }
    })
    .catch(() => {
      if (seq !== openSeq) return; // superseded by a remount — ignore
      // Crashed panel: same suspend semantics — capture focus, then apply
      // the identical widget rule (symmetric with .then).
      if (currentPanel !== undefined) lastFocusId = currentPanel.currentId;
      currentPanel?.dispose();
      markSuspended(); // log-safe swallow: a crashed panel must not wedge the host
      if (activePi !== undefined && lastOpts !== undefined) {
        updateSuspendWidget(activePi, lastOpts.state);
      }
    });
  return true;
}

/** Force-close the current panel through the host (dismiss-path entry point). */
export function suspendPanel(host: PanelHost): void {
  host.suspend();
}

/**
 * Explicit resume entry (P1.M6.T1.S1; suspend.ts resumePanel delegates here,
 * consumed by P1.M6.T1.S2 / M6.T2.S1 / M6.T2.S2): reopen the suspended panel
 * like the upsert path (h2.37) with the RESUME-FOCUS ladder (RESUME-001):
 *
 *   1. FIRST UNANSWERED question in state order (status open or reasked —
 *      the same UNANSWERED_STATUSES the accept-advance algorithm uses,
 *      via nextUnanswered(ordered, -1), which scans from index 0). Closing
 *      and reopening /interrogate means "take me to what needs answering",
 *      not "take me back where I was standing".
 *   2. Else (everything answered/submitted/terminal — the pending-submit
 *      state) the pre-suspend focus {@link lastFocusId} when it still names
 *      an active question (ACTIVE_STATUSES).
 *   3. Else the first active question in state order (the
 *      firstActiveUpsertedId pattern).
 *
 * The upsert-driven auto-reopen (handleUpserted) keeps its own
 * first-upserted focus — this entry is ONLY for explicit resume.
 *
 * Reuses lastOpts (same state/config/drafts instances — R4 survival) and
 * openPanel itself; no duplicated open logic. Returns true when the panel
 * (re)opened; false when nothing is resumable (never opened / host reset),
 * the panel is already open (single-instance guard), or the mode guard
 * blocked it.
 */
export function resumeOpenPanel(pi: PiUISurface): boolean {
  if (lastOpts === undefined) return false;
  const state = lastOpts.state;
  // RESUME-001 rung 1: first unanswered (open/reasked) in state order —
  // nextUnanswered with fromIndex -1 normalizes to the LAST index, so its
  // wrap scan visits index 0 first: exactly "first unanswered in order".
  let focusId = nextUnanswered(state.orderedQuestions(), -1);
  if (focusId === undefined) {
    focusId = lastFocusId;
    if (focusId !== undefined) {
      const q = state.getQuestion(focusId);
      if (q === undefined || !ACTIVE_STATUSES.includes(q.status)) focusId = undefined;
    }
    if (focusId === undefined) {
      focusId = firstActiveUpsertedId(state, state.orderedQuestions().map((q) => q.id));
    }
  }
  return openPanel(pi, { ...lastOpts, focusQuestionId: focusId });
}

/**
 * Auto-open on interrogate tool completion — SURFACE-001 three-gate
 * allow-list (PRD h2.37, h2.16 event table, h2.10 AC-15). The panel may be
 * surfaced by the user (`/interrogate`), an agent upsert, or agent
 * `{reopen:true}` — never by a read. Mode A rationale: reads are PULL; a
 * read popping the panel over the user's prompt box mid-turn is the
 * empty-box-after-esc data-loss trap (pi's custom() editor snapshot/restore
 * turned every `esc` into lost input), so all three gates must pass:
 *
 * 1. UPSERT-CALL — the ended call carried a non-empty `questions[]`
 *    (`isUpsertArgs` over the peeked start-phase args; `questions: []` and
 *    absent questions route to read, as does a missing stash entry).
 * 2. UNANSWERED-EXIST — an open/reasked question remains post-upsert
 *    (`nextUnanswered(ordered, -1)` = UNANSWERED_STATUSES only — NOT
 *    hasResumableQuestions, which counts answered/submitted). A
 *    description-only edit over a fully answered set surfaces nothing.
 * 3. NOT-COMPLETED — `state.completed === false`. `clearForCompletion()`
 *    leaves the singleton installed with `completed` true and zero
 *    questions; that ghost must never pop (gates 2 and 3 each block it
 *    independently — both are enforced).
 *
 * GATE (1) args access — PEEK, NEVER CONSUME: end events carry no args, so
 * the call is classified via `peekArgs(toolCallId)` over index.ts's
 * `pendingUpsertArgs` start-phase stash. The LAST-registered
 * tool_execution_end handler (the FR-31/D-R6 deferred bridge emission)
 * consumes + deletes the entry; this handler registers and fires FIRST, so
 * it must peek only — a delete here would starve the bridge emission. The
 * default peek (`() => undefined`) classifies every call as a read ⇒ no
 * auto-open — the read-conservative default that lets unwired test surfaces
 * and the P3.M1.T3.S1 tree-nav characterization flips stay safe.
 *
 * `{reopen:true}` (index.ts onReopen → resumePanel) and the /interrogate
 * command are the deliberate paths and are untouched here.
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
 * @param peekArgs start-phase args stash lookup, wired by index.ts as
 *                 `(id) => pendingUpsertArgs.get(id)`; defaults to
 *                 "unknown call" so an unwired surface never auto-opens.
 *
 * pi.on returns void in the installed runtime — no unsubscriber is assumed
 * (tolerant track() pattern from lifecycle.ts).
 */
export function maybeAutoOpen(
  pi: Pick<ExtensionAPI, "on">,
  config: InterrogatorConfig,
  host: PanelHost,
  drafts?: DraftStore,
  peekArgs: (toolCallId: string) => unknown = () => undefined,
): void {
  void pi.on("tool_execution_end", (event, ctx) => {
    if (event.toolName !== "interrogate" || event.isError) return;
    // SURFACE-001 gate (1) — upsert-call: PEEK the start-phase args stash
    // (never delete — the LAST-registered end handler consumes it for the
    // D-R6 bridge emission). Missing entry / `questions: []` = read.
    if (!isUpsertArgs(peekArgs(event.toolCallId))) return;
    if (host.isOpen()) return;
    const state = getState();
    if (state === undefined) return;
    // SURFACE-001 gate (3) — not-completed: clearForCompletion() leaves the
    // singleton installed; a completed interrogation never resurfaces.
    if (state.completed) return;
    // SURFACE-001 gate (2) — unanswered-exist: open/reasked ONLY
    // (UNANSWERED_STATUSES via nextUnanswered; NOT hasResumableQuestions,
    // which counts answered/submitted). fromIndex -1 wraps to a full scan.
    if (nextUnanswered(state.orderedQuestions(), -1) === undefined) return;
    // The SAME store instance rides every (re)open — lastOpts spread in
    // handleUpserted reuses it on the suspended-reopen path, so drafts
    // survive suspend/resume (R4, h2.0 commitment 6).
    //
    // NEW-001 hardening — the HOST is the openness authority (in production
    // createPanelHost's isOpen() IS the module record, so the two can never
    // disagree). If the host says nothing is live yet openPanel still refuses
    // on the record's authority, the record is STALE — its panel belonged to
    // a dead surface/session (e.g. a state singleton replaced since it was
    // armed, leaving a record that no live panel can ever resolve). Silently
    // swallowing the upsert here would leave the interrogation without its
    // panel forever; dispose the stale panel's residue, re-arm the record,
    // and retry once.
    if (!openPanel(ctx, { config, state, drafts }) && phase === "open") {
      currentPanel?.dispose();
      resetHostRecord();
      openPanel(ctx, { config, state, drafts });
    }
  });
}

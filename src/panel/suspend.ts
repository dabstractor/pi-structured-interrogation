/**
 * src/panel/suspend.ts — widget line + suspend/resume coordinators
 * (P1.M6.T1.S1, h2.3/h2.35/h3.10, FR-14/FR-16 panel-side).
 *
 * Breaking out of the panel (done(null) suspend) must leave the user a
 * findable way back: ONE keyed widget line above the restored editor, plus
 * an explicit resume entry that rehydrates a FRESH panel from the shared
 * state + DraftStore with focus restored to the pre-suspend question.
 *
 * Module map:
 * - {@link buildSuspendWidgetLine} — the exact h2.3 string (pure).
 * - {@link updateSuspendWidget} — the set/clear visibility rule; called from
 *   panel.ts's single suspend choke point (openPanel's floating .then and
 *   .catch, after markSuspended).
 * - {@link RESUMABLE_STATUSES} — THE single definition of the resumable
 *   status set (open/answered/submitted/reasked; BUG-005). Consumed here by
 *   the visibility predicate and in panel.ts by resume-focus selection
 *   (P1.M4.T1.S2 wires command.ts/index.ts onto the predicate too).
 * - {@link hasResumableQuestions} — the shared resumable predicate.
 * - {@link suspendPanel} — re-export of panel.ts's host-force entry; the
 *   named consumer surface for P1.M6.T1.S2 (/interrogate + global
 *   ctrl+shift+q toggle) and P1.M6.T2.S2 (discuss).
 * - {@link resumePanel} — delegates to panel.ts resumeOpenPanel; consumed by
 *   P1.M6.T1.S2, P1.M6.T2.S1 (agent reopen:true), P1.M6.T2.S2.
 *
 * Suspend/resume state (phase, currentPanel, activePi, lastOpts,
 * lastFocusId) lives in panel.ts's module-scoped host record — this module
 * is a façade over it, never a second source of truth. The panel.ts ⇄
 * suspend.ts import cycle is safe: both sides only touch each other's
 * bindings inside function bodies, never during module evaluation.
 */
import { resolveKeyLabels, type InterrogatorConfig, type KeyAction } from "../config.js";
import type { InterrogationState } from "../state.js";
import { resumeOpenPanel, type PiUISurface } from "./panel.js";

export { suspendPanel } from "./panel.js";

/** The keyed widget identity (h2.3 — EXACT; keyed widgets coexist). */
export const WIDGET_KEY = "interrogator";

/**
 * [Mode A] THE resumable status set — single definition, deliberately
 * shared (BUG-005 / h2.5): a suspended interrogation is resumable while ANY
 * question is open, answered, submitted, or reasked — answered-pending
 * submission is a LIVE state (h2.37), not an empty one. Terminal statuses
 * (moot/withdrawn/closed) are never resumable.
 *
 * Consumers: {@link hasResumableQuestions} (widget visibility, this
 * module), panel.ts resume-focus selection (imported under its historical
 * ACTIVE_STATUSES alias), and — per P1.M4.T1.S2 — the command.ts toggle
 * and index.ts onReopen gates. Do not re-declare this array anywhere.
 */
export const RESUMABLE_STATUSES: readonly string[] = [
  "open",
  "answered",
  "submitted",
  "reasked",
];

/**
 * True ⟺ the state still holds at least one question whose status is in
 * {@link RESUMABLE_STATUSES} — the widget-visibility / resumable rule
 * (BUG-005: keys on active statuses, not open-only). False for an empty
 * state (post-clearForCompletion) and for all-terminal states
 * (moot/withdrawn/closed only).
 */
export function hasResumableQuestions(state: InterrogationState): boolean {
  return state.orderedQuestions().some((q) => RESUMABLE_STATUSES.includes(q.status));
}

/**
 * Status → count buckets feeding the line builder's n/m. `open` counts
 * status "open" ONLY and `answered` counts status "answered" ONLY —
 * submitted/reasked/moot/withdrawn/closed join NEITHER bucket (mirrors
 * results.ts buildStatusLine's convention). NOT the visibility rule —
 * visibility keys on {@link hasResumableQuestions} (BUG-005).
 */
function countStatuses(ordered: readonly { status: string }[]): {
  open: number;
  answered: number;
} {
  let open = 0;
  let answered = 0;
  for (const q of ordered) {
    if (q.status === "open") open++;
    else if (q.status === "answered") answered++;
  }
  return { open, answered };
}

/**
 * [Mode A] The exact suspend reminder line (h2.3 / h2.35):
 *
 *   `${n} open · ${m} answered — ${breakOutLabel} to resume /interrogate`
 *
 * Exact-string contract:
 * - `n` = questions with status `"open"` ONLY; `m` = status `"answered"`
 *   ONLY (submitted/reasked/moot/withdrawn/closed join neither bucket —
 *   same count semantics as results.ts buildStatusLine).
 * - Separators are ` · ` (space, U+00B7 middle dot, space) and ` — `
 *   (space, U+2014 em dash, space). The command name is lowercase
 *   `/interrogate`.
 * - `labels` MUST be the config-derived display labels
 *   (`resolveKeyLabels(config).breakOut`, e.g. `"Ctrl+Shift+Q"`) — NEVER
 *   the raw `config.keys.breakOut` accelerator (h2.52: no hardcoded key
 *   names in display strings); rebound keys relabel the line.
 *
 * Visibility rule (enforced by {@link updateSuspendWidget}, the only
 * consumer): the widget shows this line ⟺ the host is suspended AND
 * {@link hasResumableQuestions}(state) — any open/answered/submitted/
 * reasked question keeps it alive (BUG-005: "0 open · N answered" IS a
 * legitimate rendered line). Cleared only for truly dead states: post-
 * clearForCompletion (empty map) or all-terminal (moot/withdrawn/closed
 * only).
 */
export function buildSuspendWidgetLine(
  state: InterrogationState,
  labels: Record<KeyAction, string>,
): string {
  const { open, answered } = countStatuses(state.orderedQuestions());
  return `${open} open · ${answered} answered — ${labels.breakOut} to resume /interrogate`;
}

/**
 * The single set/clear rule at the suspend choke point:
 * hasResumableQuestions(state) → `setWidget("interrogator", [line])`;
 * otherwise → `setWidget("interrogator", undefined)` (clear). panel.ts
 * calls this from openPanel's floating .then AND .catch — every custom()
 * resolution (user done(null), host-forced dismiss, crashed panel) lands
 * there, so this one rule covers suspend-with-resumable, completion-with-
 * empty-map, and every dismiss variant.
 *
 * No-op when the surface has no setWidget (test fakes / RPC mode) —
 * PiUISurface.setWidget is optional by design.
 */
export function updateSuspendWidget(
  pi: PiUISurface,
  state: InterrogationState,
  config: InterrogatorConfig,
): void {
  const setWidget = pi.ui.setWidget;
  if (setWidget === undefined) return;
  const line = buildSuspendWidgetLine(state, resolveKeyLabels(config));
  // BUG-005: answered/submitted/reasked-but-unsubmitted questions are LIVE —
  // the widget must stay findable so the user can resurface and ctrl+s.
  setWidget.call(pi.ui, WIDGET_KEY, hasResumableQuestions(state) ? [line] : undefined);
}

/**
 * Explicit resume entry (h3.10): clear the widget, reopen a FRESH panel
 * rehydrated from the shared state + DraftStore (R4), focused on the
 * pre-suspend current question — falling back to the first active question
 * when that id is unset or no longer active (never a dead focus). Delegates
 * to panel.ts {@link resumeOpenPanel} (no duplicated openPanel logic).
 *
 * Returns true when the panel (re)opened; false when nothing is resumable,
 * the panel is already open, or the mode guard blocked it. Consumed by
 * P1.M6.T1.S2 (/interrogate + global ctrl+shift+q) and P1.M6.T2.S1/S2.
 */
export function resumePanel(pi: PiUISurface): boolean {
  return resumeOpenPanel(pi);
}

/**
 * src/lifecycle.ts — auto-close engine (P1.M2.T2.S1; FR-4, h2.44).
 *
 * h2.44 — Auto-close algorithm (Q9=B), verbatim from
 * spec/state-and-persistence.md §Auto-close algorithm:
 *
 * ```
 * on submission delivery: submittedRun = false
 * on tool_execution_end (interrogate, action=upsert): mark each touched submitted question reasked; submittedRun = true
 * on agent_settled:
 *    for q in submitted-at-current-epoch:
 *       if q not reasked this run → status = closed (archived)
 *    if no open/reasked/answered/moot questions remain → completion flow:
 *       inject interrogation-completion (full record, once) → dismiss panel → clear in-memory state
 * Aborted runs count as settled (agent_settled fires; the model saw the answers before abort and can re-ask).
 * ```
 *
 * Algorithm line → code site (Level-4 review aid):
 * - "on submission delivery: submittedRun = false" →
 *   {@link Lifecycle.noteSubmissionDelivered} (called by submit flows, never by
 *   delivery.ts — see the caller contract below).
 * - "on tool_execution_end (interrogate, action=upsert): mark each touched
 *   submitted question reasked; submittedRun = true" → the
 *   `tool_execution_end` subscription. "Touched submitted" means the id was
 *   upserted this run AND is still in status "submitted" at end time:
 *   merge.ts's rule 2 (changed options) already flipped changed ids to
 *   "reasked" during execution, so this pass covers rule 1 — a same-options
 *   upsert keeps status "submitted" (h2.44 still counts that as re-asked).
 * - "on agent_settled: …" → the `agent_settled` subscription →
 *   {@link Lifecycle.runClosePass}.
 * - "if no open/reasked/answered/moot questions remain → completion flow:
 *   inject … → dismiss panel → clear …" → **NOT this module**: completion
 *   injection/dismissal/clear is P1.M2.T2.S2, plugged into
 *   {@link LifecycleOptions.onAfterClosePass}. This engine only REPORTS
 *   `remainingActive` (h2.44's completion predicate is S2's to apply).
 *
 * Abort caveat: `agent_settled` abort semantics are undocumented in the pi
 * API (pi-api-validation.md Unknown 1) — verified empirically only via the M7
 * scripted runbook; the pass is idempotent so abort-fires are safe (a second
 * settle finds zero still-submitted questions and does nothing). Per-run
 * flags are cleared on EVERY pass exit path, including the no-state early
 * return.
 *
 * toolCallId correlation (h2.51 risk row 3, "agent_settled ordering vs
 * tool_execution_end"): `tool_execution_end` carries NO args — they exist
 * only on `tool_execution_start` (pi-api-validation.md §Events). The engine
 * therefore stashes each interrogate call's args under its `toolCallId` on
 * start and consumes the entry on end. An end without a matching start, a
 * non-interrogate tool, or an `isError` end (a thrown rev/epoch stale-guard,
 * which changed nothing — FR-22) records nothing: no `submittedRun`, no
 * re-asks.
 *
 * Epoch-proxy invariant: Question has NO submitted-epoch field, by design
 * (do not add one). "Submitted at the current epoch" ≡ `status ===
 * "submitted"` because every close pass closes or re-marks ALL then-submitted
 * questions and resets the per-run flags — so ids still in status
 * "submitted" were necessarily submitted at the latest epoch. This proxy plus
 * the idempotent pass is the designed mechanism.
 *
 * Caller contract — {@link Lifecycle.noteSubmissionDelivered}: submit flows
 * (P1.M2.T3.S1 debug command; P1.M3.T2.S2 panel ctrl+s) MUST call it
 * immediately after `deliverSubmission`. delivery.ts itself is pure plumbing
 * and is never modified to notify this engine (exactly one pi.sendMessage per
 * delivery — S2's contract).
 *
 * Consumers: P1.M2.T2.S2 (completion trigger via `onAfterClosePass`),
 * P1.M2.T3.S1 + P1.M3.T2.S2 (`noteSubmissionDelivered` after submit),
 * P1.M3.T1 (`onPanelDismiss` registration for panel dismissal).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { closeSubmitted } from "./merge.js";
import { getState, type InterrogationState, type Question, type QuestionStatus } from "./state.js";

/** Outcome of one agent_settled close pass (consumed by P1.M2.T2.S2). */
export interface ClosePassResult {
  /** Ids moved submitted → closed (archived) by this pass. */
  closed: string[];
  /** Ids moved submitted → reasked by an upsert in the run just settled. */
  reasked: string[];
  /** Ids STILL in an active status after the pass (open/answered/submitted/reasked). */
  remainingActive: string[];
}

export interface LifecycleOptions {
  /** State override (tests / reconstruction); defaults to getState(). */
  getState?: () => InterrogationState | undefined;
  /** Called after each close pass — P1.M2.T2.S2 plugs the completion trigger here. */
  onAfterClosePass?: (result: ClosePassResult) => void;
}

export interface Lifecycle {
  /** Reset per-run flags. Submit flows MUST call this right after deliverSubmission. */
  noteSubmissionDelivered(): void;
  /** Register panel-dismiss callback; fired by dismissPanel() — no-op until M3 wires a panel. */
  onPanelDismiss(cb: () => void): void;
  /** Fire the registered panel-dismiss callback (idempotent, safe with none registered). */
  dismissPanel(): void;
  /** Run the close pass explicitly (normally invoked by the agent_settled subscription). */
  runClosePass(): ClosePassResult | undefined; // undefined when no state exists
  /** Remove all pi event subscriptions (session teardown seam). */
  dispose(): void;
}

/** Statuses counted as "still active" for the ClosePassResult report. */
const ACTIVE_STATUSES: readonly QuestionStatus[] = ["open", "answered", "submitted", "reasked"];

/** h2.44 report predicate — NOT the completion predicate (that is S2's). */
function isActive(q: Question): boolean {
  return ACTIVE_STATUSES.includes(q.status);
}

/** Guarded record check (mirrors state.ts's tolerant-narrowing pattern). */
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Narrow untyped tool args to an upsert action. Tool args arrive untyped at
 * the event boundary; tolerate-and-ignore anything else (never `as any`).
 */
function isUpsertArgs(args: unknown): args is { questions: unknown[] } {
  return isRecord(args) && args.action === "upsert" && Array.isArray(args.questions);
}

/** Tolerant id extraction: object entries carrying a string `id` only — malformed entries are skipped, never thrown. */
function questionIds(questions: unknown[]): string[] {
  const ids: string[] = [];
  for (const entry of questions) {
    if (isRecord(entry) && typeof entry.id === "string") ids.push(entry.id);
  }
  return ids;
}

/**
 * Build the auto-close engine and subscribe it to the pi event stream
 * (h2.44; wiring lives at the factory per the "Subscribe in index.ts" rule —
 * index.ts calls `createLifecycle(pi)` after tool registration).
 *
 * Per-run engine state (reset on every settle pass and by
 * {@link Lifecycle.noteSubmissionDelivered}):
 * - `reaskedThisRun` — ids this run's interrogate upsert re-asked while in
 *   status "submitted" (excluded from the close pass).
 * - `submittedRun` — whether this run upserted at all (h2.44 bookkeeping;
 *   reserved for S2's completion predicate).
 * - `pendingToolArgs` — toolCallId → start-event args (h2.51 correlation).
 *
 * @param pi  narrow event surface — `Pick<ExtensionAPI, "on">` — so tests
 *            pass a bare mock without constructing a full ExtensionAPI
 * @param opts optional state override + post-close-pass hook
 */
export function createLifecycle(pi: Pick<ExtensionAPI, "on">, opts?: LifecycleOptions): Lifecycle {
  const resolveState = (): InterrogationState | undefined =>
    opts?.getState !== undefined ? opts.getState() : getState();

  let reaskedThisRun = new Set<string>();
  let submittedRun = false;
  const pendingToolArgs = new Map<string, unknown>();
  let panelDismissCb: (() => void) | undefined;

  // pi.on returns void in the installed pi runtime (handlers are torn down
  // wholesale when the extension unloads), but some hosts/mocks hand back an
  // unsubscribe function — capture it tolerantly for dispose().
  const unsubscribers: Array<() => void> = [];
  const track = (registered: unknown): void => {
    if (typeof registered === "function") unsubscribers.push(registered as () => void);
  };

  // h2.44 line 2, part 1: args exist ONLY on tool_execution_start — stash
  // them under the toolCallId for the end event (h2.51 risk row 3).
  track(
    pi.on("tool_execution_start", (event) => {
      if (event.toolName !== "interrogate") return;
      pendingToolArgs.set(event.toolCallId, event.args);
    }),
  );

  // h2.44 line 2, part 2: on an interrogate upsert end, mark each touched
  // submitted question reasked and set submittedRun. isError = thrown
  // stale-guard = no state change → record nothing. Always consume the
  // pending entry, even on the early-exit paths.
  track(
    pi.on("tool_execution_end", (event) => {
      const args = pendingToolArgs.get(event.toolCallId);
      pendingToolArgs.delete(event.toolCallId);
      if (event.toolName !== "interrogate" || event.isError || !isUpsertArgs(args)) return;
      const state = resolveState();
      if (state === undefined) return;
      submittedRun = true;
      for (const id of questionIds(args.questions)) {
        const q = state.getQuestion(id);
        if (q !== undefined && q.status === "submitted") {
          state.setStatus(id, "reasked"); // rule-1 same-options upserts land here (see module JSDoc)
          reaskedThisRun.add(id);
        }
      }
    }),
  );

  // h2.44 line 3: the close pass, idempotently, on every settle — aborted
  // runs included (FR-4 "aborts count as settled").
  track(
    pi.on("agent_settled", () => {
      runClosePass();
    }),
  );

  function runClosePass(): ClosePassResult | undefined {
    const state = resolveState();
    if (state === undefined) {
      // Defensive: no state → nothing to close AND nothing to report; still
      // clear the per-run flags so a stale reask set can never suppress a
      // later close after reconstruction (anti-pattern: stale flags).
      reaskedThisRun.clear();
      submittedRun = false;
      return undefined;
    }

    // Epoch-proxy invariant: status "submitted" ≡ submitted at the latest
    // epoch (every prior pass closed or re-marked all then-submitted ids).
    const submitted = state.orderedQuestions().filter((q) => q.status === "submitted");
    const toClose = submitted.filter((q) => !reaskedThisRun.has(q.id)).map((q) => q.id);
    closeSubmitted(state, toClose); // merge.js — throws-on-unknown already impossible: ids came from state

    const result: ClosePassResult = {
      closed: toClose,
      reasked: [...reaskedThisRun],
      remainingActive: state.orderedQuestions().filter(isActive).map((q) => q.id),
    };

    // CRITICAL: clear the per-run flags AFTER computing, ALWAYS — a second
    // settle with no new submission then finds zero submitted questions and
    // is a no-op (idempotence; makes abort-fires safe).
    reaskedThisRun.clear();
    submittedRun = false;

    opts?.onAfterClosePass?.(result);
    return result;
  }

  return {
    /** h2.44 line 1. Called by submit flows right after deliverSubmission. */
    noteSubmissionDelivered(): void {
      submittedRun = false;
      reaskedThisRun.clear();
    },

    /** Single registration slot — last registration wins (P1.M3.T1 is the consumer). */
    onPanelDismiss(cb: () => void): void {
      panelDismissCb = cb;
    },

    /** Pure hook machinery — no UI. Safe when nothing is registered. */
    dismissPanel(): void {
      panelDismissCb?.();
    },

    runClosePass,

    /** Session teardown seam: run every captured unsubscriber, drop state. */
    dispose(): void {
      for (const off of unsubscribers) off();
      unsubscribers.length = 0;
      pendingToolArgs.clear();
      reaskedThisRun.clear();
      submittedRun = false;
      panelDismissCb = undefined;
    },
  };
}

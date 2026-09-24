/**
 * src/completion.ts — the completion trigger (P1.M2.T2.S2; h3.9, h2.44 tail,
 * FR-5). Plugs into the lifecycle's `onAfterClosePass` seam (P1.M2.T2.S1) and
 * fires the completion flow EXACTLY ONCE per interrogation, when no questions
 * remain in any active status after a close pass.
 *
 * Mode A — spec quote (prd_snapshot.md h3.9, verbatim):
 *
 * ```
 *    if no open/reasked/answered/moot questions remain → completion flow:
 *       inject interrogation-completion (full record, once) → dismiss panel → clear in-memory state
 * ```
 *
 * Completion invariant (one-time): this fires EXACTLY once per interrogation
 * instance. The guard is `state.completed`, which only `clearForCompletion()`
 * ever sets — the flag and the clear are one atomic step inside state.ts, so
 * they can never diverge. Every re-fire vector is closed: a double
 * agent_settled, a repeat close pass, and an upsert racing (or following) the
 * clear all re-enter through the flag check BEFORE the predicate, and the
 * flag is only true after the clear happened. A NEW interrogation (fresh
 * `createInterrogationState`) starts `completed === false` and may complete
 * again — deliberately NO closure-local "fired" state is kept here.
 *
 * Predicate ownership: `ClosePassResult.remainingActive` (S1's report)
 * EXCLUDES `moot` by design (it reports h2.44's active set only), so this
 * module recomputes the predicate locally against the full status set
 * {open, reasked, answered, submitted, moot} — this module owns its
 * decision. The h2.37 edge (0 open questions + pending submissions →
 * completion waits for the close pass after the next agent reply) needs NO
 * special code: "submitted" is in the blocking set, so completion naturally
 * waits. That edge is covered by a test, not logic.
 *
 * Notes split: batch notes are NOT stored in state (draft-store territory).
 * This trigger collects them via `opts.getBatchNotes` and passes them to
 * `buildCompletion`; P1.M4.T2.S2 wires that getter to the draft store's
 * batch-note slot. Until then the getter is absent → undefined →
 * `details.notes: []`.
 *
 * Consumers: src/index.ts (wiring), P1.M3.T1.S1 (registers the real
 * `onPanelDismiss` callback — `dismissPanel()` becomes live), P1.M4.T2.S2
 * (getBatchNotes wiring), P1.M7.T3.S2 (recap-card renderer reads `details`
 * of the injected interrogation-completion message), P1.M7.T1
 * (reconstruction restores completed=true to preserve exactly-once across
 * restart).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildCompletion, deliverSubmission } from "./delivery.js";
import type { ClosePassResult, Lifecycle } from "./lifecycle.js";
import { getState, type InterrogationState, type QuestionStatus } from "./state.js";

/** Options for {@link createCompletionTrigger} — all seams narrow/injectable. */
export interface CompletionTriggerOptions {
  /** Lifecycle whose dismissPanel() is invoked (h3.9 "lifecycle: dismiss panel"). */
  lifecycle: Pick<Lifecycle, "dismissPanel">;
  /** State override (tests / reconstruction); defaults to getState(). */
  getState?: () => InterrogationState | undefined;
  /** Batch-notes source (draft store in P1.M4.T2.S2); absent → undefined. */
  getBatchNotes?: () => string[] | undefined;
  /** Idle probe for deliverSubmission; mirrors ExtensionContext.isIdle. */
  ctx?: { isIdle?: () => boolean };
  /**
   * FR-33 (remote bridge surface): fired once per completed interrogation,
   * AFTER the completion flow finishes (delivery → dismiss → clear).
   * index.ts routes it to remote-bridge's completeAll so no outstanding
   * `itg:` flow leaves a conformant client surface stuck open. Absent →
   * no-op (tests).
   */
  onCompleted?: () => void;
}

/** Outcome of one completion attempt (the testable core's return value). */
export interface CompletionResult {
  fired: boolean;
  reason?: "no-state" | "already-completed" | "active-questions-remain";
}

/**
 * Statuses that BLOCK completion — the h3.9 predicate set, computed HERE and
 * never taken from `ClosePassResult.remainingActive` (which excludes moot by
 * design in S1).
 */
const BLOCKING: ReadonlySet<QuestionStatus> = new Set([
  "open",
  "reasked",
  "answered",
  "submitted",
  "moot",
]);

/**
 * One completion attempt: the h3.9 decision + flow, returning the outcome.
 * {@link createCompletionTrigger} wraps this for the void-typed
 * `onAfterClosePass` seam; tests call it directly for `{fired, reason}`
 * assertions. `result` (the engine's report) is carried to match the
 * `onAfterClosePass` contract but deliberately NOT consulted — the predicate
 * is recomputed from state so this module owns its moot-inclusive decision.
 *
 * Side-effect order (h3.9 — never reorder):
 *   buildCompletion (from the FULL state) → deliverSubmission (the ONE full
 *   injection; the delivery matrix lives there, never call pi.sendMessage
 *   here) → dismissPanel (no-op stub until P1.M3.T1.S1) → clearForCompletion
 *   (LAST: panel/M3 reads state while dismissing; clear also sets
 *   completed=true). If deliverSubmission throws, the error propagates by
 *   contract (no try/catch) and state stays intact — a repeat close pass
 *   retries cleanly.
 */
export function attemptCompletion(
  pi: Pick<ExtensionAPI, "sendMessage">,
  opts: CompletionTriggerOptions,
  result: ClosePassResult,
): CompletionResult {
  // 1. No state → nothing to complete, nothing to throw about.
  const state = (opts.getState ?? getState)();
  if (state === undefined) return { fired: false, reason: "no-state" };

  // 2. One-time guard — BEFORE the predicate, so an upsert racing (or
  //    following) the clear can never re-arm completion on cleared state.
  if (state.completed === true) return { fired: false, reason: "already-completed" };

  // 3. Completion predicate — recomputed locally (moot-inclusive h3.9 set).
  const qs = state.orderedQuestions();
  if (qs.some((q) => BLOCKING.has(q.status))) {
    return { fired: false, reason: "active-questions-remain" };
  }
  // Zero questions: completable only if this state ever had content (a
  // submission snapshot or an epoch bump proves it). A never-used state must
  // not complete — completion implies an interrogation happened.
  // BUG-003 audit: close-pass snapshots cannot flip this predicate — they
  // are gated on toClose.length > 0, which requires prior submitted
  // questions, which require a prior submission, which already pushed a
  // ring entry (and bumped epoch past 1). By the time any close-pass
  // snapshot can exist, this predicate was already false.
  if (qs.length === 0 && state.snapshots.length === 0 && state.epoch <= 1) {
    return { fired: false, reason: "active-questions-remain" };
  }

  // 4. Fire, in h3.9 order — never reorder.
  const notes = opts.getBatchNotes?.();
  const msg = buildCompletion(state, notes); // BEFORE any clearing: full record from FULL state
  deliverSubmission(pi, msg, opts.ctx); // exactly one pi.sendMessage — the delivery matrix lives there
  opts.lifecycle.dismissPanel(); // safe no-op stub until P1.M3.T1.S1 wires a panel
  state.clearForCompletion(); // LAST: clears questions/order, retains goal/epoch/snapshots, sets completed=true
  opts.onCompleted?.(); // FR-33: resolve outstanding bridge flows AFTER the state settles

  return { fired: true };
}

/**
 * Build the `onAfterClosePass` callback (h3.9): after each close pass, run
 * {@link attemptCompletion} — inject the one full interrogation-completion
 * record (h2.46, via buildCompletion), dismiss the panel, then clear
 * in-memory state while retaining the audit trail (goal/epoch/snapshots).
 * See the module JSDoc for the exactly-once invariant and the
 * moot-inclusive predicate rationale.
 */
export function createCompletionTrigger(
  pi: Pick<ExtensionAPI, "sendMessage">,
  opts: CompletionTriggerOptions,
): (result: ClosePassResult) => void {
  return (result: ClosePassResult): void => {
    attemptCompletion(pi, opts, result);
  };
}

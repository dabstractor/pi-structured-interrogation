/**
 * src/remote-submit.ts — bridge-submission pipeline (FR-32; spec/decisions.md
 * D-R5; spec/architecture.md §Bridge submit).
 *
 * A bridge client submission rides the SAME machinery as a panel `ctrl+s`
 * (panel/actions.ts `submit()`), minus panel-local concerns (drafts, batch
 * note, gate-warning footer — panel and bridge surfaces own their own).
 * Bridge answers are USER SHIPMENTS: they must trigger a model reply via the
 * submission delta, never the chat-fallback recordAnswers path (that path
 * exists for answers the MODEL relays from chat inside a tool call — the
 * agent is already running there; here it is idle and must be re-triggered).
 *
 * ORDERING CONTRACT — mirrors actions.ts submit() exactly (load-bearing,
 * never reorder):
 *
 * 1. Answers were applied by the caller BEFORE this function's baseline
 *    reads (applyAnswer per recordable id — the caller validated against
 *    CURRENT options, D-R4). The panel equivalent is "answers were already
 *    applied by accept".
 * 2. `pre` = {@link submissionBaselineOf} (latest snapshot else the empty
 *    pre-first-snapshot baseline); `diff = computeDiff(pre, serialize())`.
 * 3. `pendingIds` = ALL status-"answered" ids, read BEFORE markSubmitted
 *    flips statuses (BUG-008: the user-shipped set must be captured
 *    pre-flip; it is also deliberately the FULL pending set, not just this
 *    surface's answers — panel parity: one submit ships everything pending).
 * 4. BUG-008(b) user-shipped filter (exact predicate from actions.ts):
 *    entries whose `to` is "(unanswered)" AND that the user did not ship
 *    are agent-caused rule-2 re-ask resets — never shipped, drafts survive.
 * 5. Zero shippable change → `nothing_shippable` (the panel's "nothing to
 *    submit" flash analogue) — NO snapshot, NO epoch bump, NO delivery.
 * 6. `markSubmitted(pendingIds)` (h2.38: pending ids are submitted at this
 *    epoch so the agent_settled close pass can archive them).
 * 7. `buildSubmission(state, { ...diff, changed: userChanged })` — it alone
 *    performs takeSnapshot + bumpEpoch, EXACTLY ONCE. Callers must never
 *    snapshot/bump around it.
 * 8. `deliverSubmission` (exactly ONE pi.sendMessage; steer-when-busy /
 *    followUp+triggerTurn — the delivery matrix lives there).
 * 9. `lifecycle.noteSubmissionDelivered()` — the h2.44 line-1 caller
 *    contract, immediately after delivery.
 *
 * Pure-data discipline (h2.13): narrow `Pick<ExtensionAPI, "sendMessage">`
 * pi surface; lifecycle as `Pick<Lifecycle, "noteSubmissionDelivered">`; no
 * UI, no panel imports, no events.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildSubmission, deliverSubmission, type SendableMessage } from "./delivery.js";
import type { Lifecycle } from "./lifecycle.js";
import { markSubmitted } from "./merge.js";
import { computeDiff, submissionBaselineOf } from "./snapshots.js";
import type { InterrogationState } from "./state.js";

/** One bridge answer, already validated + recordable (remote-bridge D-R4 mapping). */
export interface RemoteAnswerInput {
  id: string;
  value: string;
  /** Free-text elaboration alongside a valid picked option value. */
  text?: string;
}

/** Options for {@link recordRemoteSubmission}. */
export interface RemoteSubmitDeps {
  /** h2.44 line-1 caller contract — invoked immediately after delivery. */
  lifecycle?: Pick<Lifecycle, "noteSubmissionDelivered">;
  /** Idle probe for deliverSubmission; absent → the safe followUp+triggerTurn branch. */
  isIdle?: () => boolean;
}

/** Outcome of one remote submission attempt. */
export type RemoteSubmitOutcome =
  | { ok: true; msg: SendableMessage }
  /** Every applied answer already matched the pending set — accepted, nothing to ship. */
  | { ok: false; reason: "nothing_shippable" };

/**
 * Apply `answers` to `state` and ship ONE submission delta through the
 * panel-parity pipeline (see the module ordering contract). The caller owns
 * D-R4 validation; this function trusts its inputs and records them as
 * given (chat-fallback precedent — values are never remapped here).
 *
 * Throws propagate from deliverSubmission by contract (no error-swallowing —
 * the bridge's handler guards the bus).
 */
export function recordRemoteSubmission(
  pi: Pick<ExtensionAPI, "sendMessage">,
  state: InterrogationState,
  answers: RemoteAnswerInput[],
  deps: RemoteSubmitDeps = {},
): RemoteSubmitOutcome {
  // 1. Apply answers (caller-validated; statuses were checked recordable).
  const at = new Date().toISOString();
  for (const answer of answers) {
    state.applyAnswer(answer.id, { value: answer.value, at, ...(answer.text !== undefined ? { text: answer.text } : {}) });
  }

  // 2. Baseline + diff (status-blind — answer signatures only).
  const pre = submissionBaselineOf(state);
  const diff = computeDiff(pre, state.serialize());

  // 3. pendingIds BEFORE the markSubmitted flip (BUG-008). Deliberately the
  //    FULL pending set — panel parity: one submission ships everything
  //    pending, not just the surface that triggered it.
  const pendingIds = state.orderedQuestions().filter((q) => q.status === "answered").map((q) => q.id);

  // 4. BUG-008(b): exact actions.ts predicate — drop agent-caused resets.
  const userChanged = diff.changed.filter(
    (e) => pendingIds.includes(e.id) || !(e.to === "(unanswered)"),
  );

  // 5. Nothing user-shipped → nothing to submit (no snapshot/bump/delivery).
  if (diff.changed.length === 0 || userChanged.length === 0) {
    return { ok: false, reason: "nothing_shippable" };
  }

  // 6. h2.38 flush: pending ids are submitted at this epoch.
  markSubmitted(state, pendingIds);

  // 7. buildSubmission alone performs takeSnapshot + bumpEpoch (exactly once).
  const msg = buildSubmission(state, { ...diff, changed: userChanged });

  // 8. Exactly one sendMessage — the delivery matrix lives in deliverSubmission.
  deliverSubmission(pi, msg, { isIdle: deps.isIdle });

  // 9. h2.44 line-1 caller contract.
  deps.lifecycle?.noteSubmissionDelivered();

  return { ok: true, msg };
}

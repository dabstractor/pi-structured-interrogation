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
 * 5. STATUS FLUSH — `markSubmitted(pendingIds)` (h2.38: pending ids are
 *    submitted so the agent_settled close pass can archive them) happens
 *    BEFORE the zero-change early return, iff anything is pending: a
 *    conformant client re-submits the FULL answer set after every re-ask,
 *    and a rule-1 re-ask (same options) KEEPS the answers — identical
 *    values produce an empty diff, and skipping the flush there would
 *    leave freshly-answered ids stuck at "answered" (never submitted,
 *    never closed, completion deadlocked — live RPC itest deadlock #3).
 * 6. Zero shippable change → `nothing_shippable` (the panel's "nothing to
 *    submit" flash analogue) — NO snapshot, NO epoch bump, NO delivery.
 *    The status flush above has already run; only the delta is skipped.
 * 7. `buildSubmission(state, { ...diff, changed: userChanged })` — it alone
 *    performs takeSnapshot + bumpEpoch, EXACTLY ONCE. Callers must never
 *    snapshot/bump around it.
 * 8. `deliverSubmission` (exactly ONE pi.sendMessage; steer-when-busy /
 *    followUp+triggerTurn — the delivery matrix lives there).
 * 9. `lifecycle.noteSubmissionDelivered()` — the h2.44 line-1 caller
 *    contract, immediately after delivery.
 * 10. TAIL HOOK (P2.M1.T3.S1 — AUTOSUBMIT-001, h2.33 "one shared hook"):
 *     `deps.maybeAutoSubmit?.()` runs on BOTH exit paths, always AFTER the
 *     lifecycle call — the success tail (immediately after step 9) and the
 *     nothing_shippable tail (after its conditional
 *     noteSubmissionDelivered). The hook is INJECTED (index.ts owns the
 *     panel singletons; pure-data discipline forbids panel imports here).
 *     The common case no-ops: step 5's flush already flipped every
 *     answered → submitted, so a faithfully-wired hook
 *     (index.ts → actions.ts maybeAutoSubmit) finds zero pending — one
 *     bridge submission, never a duplicate. WRITEIN-001 parity rides in
 *     step 1: a customText-only bridge answer carries `custom: true`, the
 *     byte-identical answer object the panel's Other-row write-in commits.
 *
 * Pure-data discipline (h2.13): narrow `Pick<ExtensionAPI, "sendMessage">`
 * pi surface; lifecycle as `Pick<Lifecycle, "noteSubmissionDelivered">`; no
 * UI, no panel imports, no events (the tail hook is a zero-arg injection,
 * not a panel reference).
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
  /** WRITEIN-001 — customText-only write-in: value holds free text, not an
   * option value; it is NEVER validated against option lists (h2.42) and
   * lands on the state answer byte-identical to the panel's Other row. */
  custom?: boolean;
}

/** Options for {@link recordRemoteSubmission}. */
export interface RemoteSubmitDeps {
  /** h2.44 line-1 caller contract — invoked immediately after delivery. */
  lifecycle?: Pick<Lifecycle, "noteSubmissionDelivered">;
  /** Idle probe for deliverSubmission; absent → the safe followUp+triggerTurn branch. */
  isIdle?: () => boolean;
  /** P2.M1.T3.S1 — AUTOSUBMIT-001 bridge tail. Invoked AFTER
   * noteSubmissionDelivered on BOTH exit paths (success + nothing_shippable).
   * Injected from index.ts (panel singletons live there); absent → no-op. */
  maybeAutoSubmit?: () => void;
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
 * given (chat-fallback precedent — values are never remapped here; a
 * `custom: true` input is the WRITEIN-001 write-in and lands on the state
 * answer byte-identical to the panel's Other-row commit `{ value, custom:
 * true, at }`).
 *
 * TAIL HOOK (P2.M1.T3.S1 — AUTOSUBMIT-001, h2.33): `deps.maybeAutoSubmit`
 * runs at BOTH tails, always AFTER the h2.44 noteSubmissionDelivered call —
 * the success tail and the nothing_shippable tail. Injected from index.ts
 * (panel singletons live there); absent → no-op. The common case no-ops:
 * step 5's markSubmitted flush already flipped every answered → submitted,
 * so the hook finds zero pending — one bridge submission, never two.
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
    state.applyAnswer(answer.id, {
      value: answer.value,
      at,
      ...(answer.text !== undefined ? { text: answer.text } : {}),
      ...(answer.custom ? { custom: true } : {}),
    });
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

  // 5. STATUS FLUSH (before the zero-change return — see module contract:
  // identical-value re-selections after a rule-1 re-ask still count as the
  // user's current delivered answer; only the delta message is optional).
  if (pendingIds.length > 0) markSubmitted(state, pendingIds);

  // 6. Nothing user-shipped → nothing to submit (no snapshot/bump/delivery).
  //    The h2.44 line-1 contract STILL fires when the flush above ran: the
  //    answers were accepted (statuses now submitted), so the close-pass
  //    suppression flags must clear — a rule-1 re-upsert earlier in the run
  //    armed reaskedThisRun, and leaving it armed deadlocks completion
  //    exactly like the shipped-path variant (live RPC itest deadlock #4).
  if (diff.changed.length === 0 || userChanged.length === 0) {
    if (pendingIds.length > 0) deps.lifecycle?.noteSubmissionDelivered();
    deps.maybeAutoSubmit?.(); // tail hook runs here too — always AFTER the lifecycle call
    return { ok: false, reason: "nothing_shippable" };
  }

  // 7. buildSubmission alone performs takeSnapshot + bumpEpoch (exactly once).
  const msg = buildSubmission(state, { ...diff, changed: userChanged });

  // 8. Exactly one sendMessage — the delivery matrix lives in deliverSubmission.
  deliverSubmission(pi, msg, { isIdle: deps.isIdle });

  // 9. h2.44 line-1 caller contract.
  deps.lifecycle?.noteSubmissionDelivered();

  // 10. AUTOSUBMIT-001 tail hook — always AFTER the lifecycle call (h2.44
  // line-1 ordering is load-bearing). Zero pending after step 5's flush
  // makes a faithfully-wired hook a no-op: ships once, never twice.
  deps.maybeAutoSubmit?.();

  return { ok: true, msg };
}

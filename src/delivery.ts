/**
 * src/delivery.ts — Submission delta builder (P1.M2.T1.S1) + transport
 * (P1.M2.T1.S2; submit flow per spec h3.6).
 *
 * Two builder responsibilities, UI-free (h2.13 discipline):
 *
 * 1. {@link buildSubmission} — turn a computed diff ({@link computeDiff}
 *    output from snapshots.ts) plus an optional batch note into the compact
 *    ≤3-line custom message the model receives on ctrl+s. The full card data
 *    rides in `details` for the user-only renderer (P1.M7.T3.S1, h2.36:
 *    the card is drawn from `details`, NOT from content — decision Q2=A).
 * 2. The h3.6 side effects, in order: build FIRST, then
 *    {@link takeSnapshot}(state) BEFORE `state.bumpEpoch()`. One call = one
 *    submission = exactly one snapshot + one bump (mirrors
 *    `recordAnswers` in fallback.ts so ring digests stay coherent across
 *    submission surfaces).
 *
 * CALLER PRECONDITION (documented, panel-owned — P1.M3): pending answers are
 * already flushed into `state` before this function runs (ripple confirms
 * happened at edit time). buildSubmission does NOT flush; it receives
 * post-flush state.
 *
 * TRANSPORT (P1.M2.T1.S2, section at the bottom of this file):
 * {@link deliverSubmission} hands a built message to pi.sendMessage with the
 * exact options that make the model actually reply — the ONLY turn-triggering
 * path in the extension (h2.0 §1: no tool call ever waits on the user). The
 * builder half above stays transport-free (h2.13) and unit-testable with a
 * bare InterrogationState; the TRANSPORT section marker below separates the
 * two halves (delivery.test.ts module hygiene enforces that split).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { takeSnapshot, type DiffEntry, type SubmissionCardData } from "./snapshots.js";
import type { InterrogationState } from "./state.js";

/** Fixed reminder line (h3.6) — the second content line, byte-exact. */
export const SUBMISSION_REMINDER = "Consider how these affect your other questions.";

/**
 * Character budget for the "Submitted {k}: {list}" header+entry-list line
 * (Mode A: line 1 must never wrap into more than 2 display lines, keeping
 * total content within the ≤3-line budget of h2.0 §2 / h3.6). Tunable const;
 * when the joined entry list exceeds it, entries are dropped from the END
 * and a `+{m} more` suffix summarizes them.
 */
export const SUBMISSION_LIST_MAX_CHARS = 240;

/**
 * The pi.sendMessage payload for an interrogation submission. Content is
 * ALWAYS exactly 2 lines (≤3-line budget h3.6); the user-only diff card is
 * rendered from `details.card` by registerMessageRenderer (P1.M7.T3.S1),
 * never from content.
 */
export interface SubmissionMessage {
  customType: "interrogation-submission";
  /** 2 lines: `Submitted {k}: {entries}` + the fixed reminder. */
  content: string;
  display: true;
  details: {
    /** Same entries as the card — re-exported DiffEntry shape (snapshots.ts). */
    changed: DiffEntry[];
    /** Batch note passthrough; key absent when undefined/empty. */
    note?: string;
    /** PRE-bump epoch (the epoch being submitted) — matches diff.epoch. */
    epoch: number;
    /** Full card data for the user-only renderer (P1.M7.T3.S1). */
    card: SubmissionCardData;
  };
}

/**
 * Build the submission message and perform the submission bookkeeping
 * (h3.6, Mode A). Pure formatting + the snapshot/bump side effects; no
 * transport, no UI.
 *
 * Content format (h3.6, 2 lines, note intentionally details-only):
 *
 * ```
 * Submitted {k}: {id}: {to}; {id}: {to} (changed)…
 * Consider how these affect your other questions.
 * ```
 *
 * - Line 1 entries come from `diff.changed` (`{id}: {to}`, `to` is already
 *   label-preferred and untruncated by computeDiff — truncation to the
 *   {@link SUBMISSION_LIST_MAX_CHARS} budget is THIS module's job). Entries
 *   with `editedArchived` get a ` (changed)` suffix (AC-13) and are joined
 *   with `"; "`. When the joined list overflows the budget, entries are
 *   dropped from the end (never below 1) and `+{m} more` summarizes them;
 *   `{k}` still reports the true change count. Zero changes →
 *   `Submitted 0: (no changes)`. The reminder line is never truncated.
 * - details: `{changed, note?, epoch, card}` — `epoch` is the PRE-bump
 *   epoch (same as diff.epoch and the snapshot label); `note` is omitted
 *   when undefined/empty; `card` is the SubmissionCardData as passed.
 *
 * Side effects (strict order, once per call — even for zero changes, so the
 * ring stays consistent with stale-guard digests):
 * 1. (precondition, caller-owned) pending answers already flushed into
 *    `state` by the panel (P1.M3).
 * 2. `takeSnapshot(state)` — ring snapshot labeled with the CURRENT
 *    (pre-bump) epoch. MUST precede bumpEpoch (snapshots.ts caller
 *    contract: subscribing to `epoch-bumped` would mislabel).
 * 3. `state.bumpEpoch()` — exactly one bump; state.epoch ends at n+1 while
 *    the message's details.epoch stays n.
 *
 * @param state post-flush interrogation state (receives snapshot + bump)
 * @param diff computeDiff output describing this submission
 * @param note optional batch note (details-only passthrough)
 * @returns the message for P1.M2.T1.S2 to hand to pi.sendMessage
 */
export function buildSubmission(
  state: InterrogationState,
  diff: SubmissionCardData,
  note?: string,
): SubmissionMessage {
  const k = diff.changed.length;
  const entries = diff.changed.map(
    (e) => `${e.id}: ${e.to}${e.editedArchived ? " (changed)" : ""}`,
  );

  // Budget loop: shrink the entry list from the end until the header+list
  // line fits SUBMISSION_LIST_MAX_CHARS (always ≥1 entry survives), then
  // append the "+m more" rollup for whatever was dropped.
  let list = entries.join("; ");
  let dropped = 0;
  while (
    `Submitted ${k}: ${list}`.length > SUBMISSION_LIST_MAX_CHARS &&
    entries.length - dropped > 1
  ) {
    dropped++;
    list = entries.slice(0, entries.length - dropped).join("; ");
  }
  if (dropped > 0) list += `; +${dropped} more`;

  const content = `Submitted ${k}: ${k === 0 ? "(no changes)" : list}\n${SUBMISSION_REMINDER}`;

  // Side-effect tail (order is the contract — h2.39 / snapshots.ts JSDoc):
  // ring snapshot at the pre-bump epoch, then exactly one epoch bump.
  takeSnapshot(state);
  state.bumpEpoch();

  const details: SubmissionMessage["details"] = {
    changed: diff.changed,
    epoch: diff.epoch,
    card: diff,
  };
  if (typeof note === "string" && note.length > 0) details.note = note;

  return { customType: "interrogation-submission", content, display: true, details };
}

// ==== TRANSPORT (P1.M2.T1.S2) ==============================================
// Everything above builds the message; everything below delivers it. The
// marker is a structural contract: the builder half stays free of
// sendMessage/triggerTurn (enforced by delivery.test.ts module hygiene).

/**
 * The union of message shapes this module can deliver to the agent. Today
 * that is just {@link SubmissionMessage}; P1.M2.T1.S3 (completion record)
 * widens this alias to a union — keeping the alias means the widening touches
 * exactly one line and every consumer route stays {@link deliverSubmission}.
 */
export type SendableMessage = SubmissionMessage;

/**
 * pi.sendMessage options, mirrored from ExtensionAPI (types.d.ts:
 * `{ triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }`)
 * so the delivery matrix below has a named, testable type.
 */
export type DeliveryOptions = {
  triggerTurn?: boolean;
  deliverAs?: "steer" | "followUp" | "nextTurn";
};

/**
 * Deliver an interrogation submission/completion message to the agent.
 *
 * pi.sendMessage does NOT trigger an agent reply by default — custom
 * messages (role "custom") merely enter the LLM context. Since our
 * interrogate tool is non-blocking (h2.0 core commitment 1: no tool call
 * ever waits on the user), answers flow back later as small delta messages
 * that must TRIGGER a new reply — and this function is the ONLY place in the
 * extension that triggers a turn. Callers (P1.M2.T3.S1 debug submit command;
 * P1.M3.T2.S2 panel ctrl+s via lifecycle) must route ALL submissions through
 * here so the turn-trigger contract stays in one tested place.
 *
 * Delivery matrix (extensions.md "pi.sendMessage", pi-api-validation.md
 * Mismatch 2):
 *
 * | agent state                     | options                                |
 * |---------------------------------|----------------------------------------|
 * | busy (`ctx.isIdle() === false` —| `{ deliverAs: "steer" }`               |
 * | running, retrying, auto-        | queues the message; delivered after    |
 * | compacting, queued continuation | the current assistant turn finishes    |
 * | — "busy" is broader than just   | its tool calls, before the next LLM    |
 * | streaming per ctx.isIdle docs)  | call. No triggerTurn: the agent is     |
 * |                                 | already running, so triggering is      |
 * |                                 | meaningless — the key is omitted.      |
 * | idle, or idle-status unknown    | `{ triggerTurn: true,                  |
 * | (no ctx / isIdle missing)       |   deliverAs: "followUp" }`             |
 * |                                 | followUp delivers once the agent has   |
 * |                                 | no pending tool calls; triggerTurn     |
 * |                                 | fires the LLM response immediately.    |
 * |                                 | This is also the safe default when     |
 * |                                 | idle-status is unknown — followUp is   |
 * |                                 | valid in both states.                  |
 *
 * `"nextTurn"` is NEVER used: it never triggers or interrupts anything —
 * a submission delivered as nextTurn would leave the session dead until the
 * next user message (the exact trap of Mismatch 2).
 *
 * Contract:
 * - `msg` is passed through UNMUTATED and by reference — this function is
 *   pure plumbing and must not touch InterrogationState (buildSubmission
 *   already did snapshot+bumpEpoch).
 * - Exactly ONE pi.sendMessage call per invocation; nothing else on `pi` is
 *   touched (no appendEntry, no sendUserMessage — the delta is a custom
 *   message, not a user message).
 * - Fire-and-forget, returns void, NO error-swallowing try/catch: if
 *   pi.sendMessage throws (e.g. invalid state), the error propagates so the
 *   panel/debug caller's error handling surfaces it.
 *
 * @param pi  narrowest transport surface — `Pick<ExtensionAPI,
 *            "sendMessage">` — so unit tests pass plain `{ sendMessage }`
 *            mocks without constructing a full ExtensionAPI
 * @param msg built message (S1's buildSubmission, or S3's completion record)
 * @param ctx optional idle probe; `{ isIdle?: () => boolean }` mirrors
 *            ExtensionContext.isIdle (false = busy: processing an agent run,
 *            automatic retry, auto-compaction retry, or queued continuation
 *            — steer is correct in all of those cases)
 */
export function deliverSubmission(
  pi: Pick<ExtensionAPI, "sendMessage">,
  msg: SendableMessage,
  ctx?: { isIdle?: () => boolean },
): void {
  const busy = typeof ctx?.isIdle === "function" ? ctx.isIdle() === false : false;
  // Exact option objects per the matrix above — no extra/missing keys;
  // tests assert deep equality (busy branch must NOT carry triggerTurn).
  const options: DeliveryOptions = busy
    ? { deliverAs: "steer" }
    : { triggerTurn: true, deliverAs: "followUp" };
  pi.sendMessage(msg, options);
  // Fire-and-forget: no await, no try/catch — let caller error handling see throws.
}

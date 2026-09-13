/**
 * src/delivery.ts — Submission delta builder (P1.M2.T1.S1; submit flow per
 * spec h3.6).
 *
 * Two responsibilities, both UI-free (h2.13 discipline — no pi APIs here):
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
 * TRANSPORT: this module never calls pi.sendMessage or triggerTurn — that is
 * P1.M2.T1.S2's job, which will call pi.sendMessage with this builder's
 * return value ({triggerTurn: true, deliverAs: "steer"}). Keeping the
 * builder half framework-free makes it importable and unit-testable with a
 * bare InterrogationState.
 */
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

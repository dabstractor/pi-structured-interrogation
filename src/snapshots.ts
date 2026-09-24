/**
 * src/snapshots.ts — Snapshot ring + submission diff computation
 * (P1.M1.T2.S4; h2.39 snapshot semantics per spec/state-and-persistence.md).
 *
 * Three responsibilities, all pure data layer (h2.13: never touches UI):
 *
 * 1. {@link takeSnapshot} — capture a full deep-copied state snapshot into
 *    the bounded ring of {@link SNAPSHOT_RING_SIZE} on `state.snapshots`.
 *    Callers (the submit flow, P1.M2.T1.S1) MUST invoke this BEFORE
 *    `state.bumpEpoch()` — see the function JSDoc for why the
 *    `epoch-bumped` event cannot be used instead.
 * 2. {@link computeDiff} — pure diff of two `SerializedState`s producing the
 *    `SubmissionCardData` shape consumed by the submission card renderer
 *    (P1.M7.T3.S1, ui-spec.md h2.36) and the delivery delta builder
 *    (P1.M2.T1.S1).
 * 3. {@link digestSince} — compact one-line-per-submission delta digest
 *    embedded in stale-guard rejection messages (spec/architecture.md:
 *    "Changes since epoch N: {delta digest}").
 *
 * ONE diff core ({@link computeEntries}) backs both the card diff and the
 * digest so the two consumers can never diverge on change semantics.
 *
 * No events are emitted from this module — snapshotting is bookkeeping, not
 * a state mutation. Zero dependencies beyond `./state.js` types; state.ts
 * (S1) owns the `Snapshot` type, the `snapshots` field, and `serialize()`.
 */
import type { InterrogationState, Question, SerializedState, Snapshot } from "./state.js";

/** Ring bound for `state.snapshots` (h2.39: bounded ring of 10, oldest dropped). */
export const SNAPSHOT_RING_SIZE = 10;

/**
 * Pending-answer diff baseline over a bare state (FR-32; extracted from
 * panel/actions.ts `submissionBaseline` so the remote bridge-submission
 * pipeline shares the EXACT baseline semantics): the latest snapshot's
 * state ("answered since the LAST submission"), or a fresh empty baseline
 * before the first snapshot exists. The empty baseline is safe: computeDiff
 * compares answer signatures, and a question missing from `prev` with no
 * answer in `next` has signature `undefined` on BOTH sides — so only
 * genuinely ANSWERED questions surface as pending. buildSubmission takes a
 * NEW snapshot + bumps epoch, making this baseline fresh for the next submit.
 *
 * RING SHAPE (BUG-003 audit): the baseline is the MOST RECENT entry — after
 * the agent-settled close pass that IS the "closed" close-pass snapshot
 * (same epoch as the submit snapshot it archives), which is exactly the
 * `before.status === "closed"` that `editedArchived` needs (BUG-003/AC-13);
 * before settle it is the submit-time "submitted" snapshot. Duplicate
 * epochs cannot matter here: only the last entry is ever read.
 */
export function submissionBaselineOf(state: InterrogationState): SerializedState {
  const snaps = state.snapshots;
  const last = snaps[snaps.length - 1];
  if (last !== undefined) return last.state;
  return { goal: "", epoch: 0, order: [], questions: {}, completed: false };
}

/** Summary used on either diff side when the question/answer is missing. */
const UNANSWERED = "(unanswered)";

/**
 * One changed answer in a submission diff (h2.36 / AC-13).
 *
 * Plain data only — no live question objects are referenced, so entries are
 * safe to hand to renderers and tool results.
 */
export interface DiffEntry {
  /** Question id the entry belongs to. */
  id: string;
  /** `title ?? prompt` (next side preferred) — display name for the card. */
  title: string;
  /** Answer summary before (label-preferred; "(unanswered)" if none). */
  from: string;
  /** Answer summary after (label-preferred; "(unanswered)" if none). */
  to: string;
  /**
   * Q24=B / AC-13: the question was `closed` (archived) in `prev` and is
   * edited in `next`. The renderer turns this into the `(changed)` marker
   * ("Q3: sqlite → postgres (changed)") — this module only supplies the flag.
   */
  editedArchived: boolean;
  /**
   * Raw POST-change answer value (`answer.value` of the `next`-side
   * question). Omitted when the question is unanswered/cleared after the
   * change. Machine-readable reconstruction data (P1.M5.T1.S1
   * replaySubmission prefers this over the label-preferred `to`);
   * `to` stays the display-only summary for cards/deltas. Optional because
   * history written before this field existed carries no `value`.
   */
  value?: string;
}

/**
 * Shape consumed by the submission card renderer (P1.M7.T3.S1, ui-spec.md
 * h2.36: "{title}: {old} → {new (changed)}" + NOTE: line + "{open} remain
 * open") and the delivery delta builder (P1.M2.T1.S1).
 */
export interface SubmissionCardData {
  /** One entry per question whose answer signature changed. */
  changed: DiffEntry[];
  /**
   * Batch note passthrough (delivery.ts owns capture). Omitted when the
   * caller passes undefined or an empty string.
   */
  note?: string;
  /** Epoch of the `next` state (as carried in `SerializedState.epoch`). */
  epoch: number;
  /** Count of `next` questions with status "open" — "{open} remain open". */
  remainOpen: number;
}

/**
 * Change signature for one question: `answer.value` + (text ? NUL + text :
 * ""). `undefined` when the question is missing or has no answer — so a
 * missing question, a cleared answer, and a never-answered question all
 * compare equal. Includes `answer.text` because a text-only edit
 * ("elaboration added") IS a change for the diff card.
 */
function answerSignature(q: Question | undefined): string | undefined {
  const answer = q?.answer;
  if (q === undefined || answer === undefined) return undefined;
  return `${answer.value}\u0000${answer.text ?? ""}`;
}

/**
 * Flatten runs of newlines and tabs to the single-line separator — BUG-006
 * (h3.5): write-ins commit raw newlines ("multi-line values keep their
 * newlines", actions.ts), but every summary surface (delta content entries,
 * card to/from, digestSince segments) must be single-line so the model
 * delta keeps the ≤3-line shape (FR-3/AC-2). Same grammar as the NOTE line
 * (delivery.ts's `note.replace(/\n+/g, " / ")`) extended to tabs: RUNS
 * collapse (mixed `\n\t` runs included) to one `" / "`. Applied to the
 * FINAL composed summary only — never to `answer.value`/`answer.text` in
 * state (raw values stay raw) and never to {@link answerSignature} (the
 * change predicate compares raw value+text).
 */
const flatten = (s: string): string => s.replace(/[\n\t]+/g, " / ");

/**
 * Human-readable answer summary for diff cards / digests. WRITE-IN answers
 * (`answer.custom === true`, WRITEIN-001/h2.42) render `✎ {value}` — the
 * committed text IS the answer, so the option-label lookup is bypassed
 * entirely. Otherwise choice questions prefer the label of the option whose
 * `value` matches the answer value (falling back to the raw value when no
 * option matches); text questions use the raw value. A non-blank
 * `answer.text` elaboration rides the summary as ` — {text}` (NEW-003),
 * including on write-ins. Missing question/answer → "(unanswered)".
 *
 * SINGLE-LINE guarantee (BUG-006 flatten half, h3.5): the FINAL composed
 * string is flattened — runs of `\n`/`\t` collapse to `" / "` ({@link
 * flatten}) — so every delta content entry and card to/from field is
 * single-line. Strictly a summary transform: raw state (answer.value/text)
 * and {@link answerSignature} keep raw characters, and a newline-free
 * summary is byte-identical (the regex is a no-op without \n/\t). No
 * truncation — display truncation is the renderer's job; per-entry length
 * bounding is P1.M2.T3.S2's cap, NOT this function.
 */
function answerSummary(q: Question | undefined): string {
  const answer = q?.answer;
  if (q === undefined || answer === undefined) return UNANSWERED;
  // WRITEIN-001 (h2.42): value holds free text — ✎ prefix, never an option
  // lookup. Checked BEFORE the choice/text dispatch so a custom value that
  // collides with a real option value still renders as a write-in.
  let composed: string;
  if (answer.custom === true) {
    composed = `✎ ${answer.value}`;
    if (typeof answer.text === "string" && answer.text.trim() !== "") {
      composed = `${composed} — ${answer.text}`;
    }
  } else {
    // Label-preferred for choice, raw value otherwise (text → the typed text).
    composed =
      q.type === "choice"
        ? (q.options?.find((o) => o.value === answer.value)?.label ?? answer.value)
        : answer.value;
    // NEW-003 (h2.45/R4): a shipped ✎ elaboration rides the delta and the
    // diff card — same `{answer} — {free text}` grammar as the completion
    // record (h2.46), so the model sees the reasoning, not just the label.
    if (typeof answer.text === "string" && answer.text.trim() !== "") {
      composed = `${composed} — ${answer.text}`;
    }
  }
  // BUG-006 (h3.5): single-line summaries only — raw newline/tab runs in the
  // committed value/text collapse here, at the LAST moment, so raw state and
  // the change signature upstream stay untouched.
  return flatten(composed);
}

/**
 * Capture the full state AS SUBMITTED at the CURRENT epoch and retain it in
 * the bounded snapshot ring (h2.39: powers diff cards and post-hoc
 * recovery — NOT user-facing undo in v1). The returned `Snapshot` holds a
 * deep copy (`state.serialize()` is structuredClone'd), so later live
 * mutations cannot alter it; the ring keeps the last
 * {@link SNAPSHOT_RING_SIZE} entries, dropping the oldest, and
 * `snapshots[snapshots.length - 1]` is always the most recent. Snapshots
 * survive `clearForCompletion()` (state.ts retains them) for post-hoc
 * recovery after completion.
 *
 * CALLER CONTRACT: invoke this BEFORE `state.bumpEpoch()` — the snapshot is
 * labeled with the epoch being left (the pre-bump epoch), i.e. "state as
 * submitted at epoch N". Subscribing to `epoch-bumped` would be WRONG: that
 * event fires AFTER the increment, so a snapshot taken there would be
 * mislabeled with the post-bump epoch. Wiring lives in the submit flow
 * (P1.M2.T1.S1); this module only exports the explicit function.
 *
 * RING SHAPE INVARIANTS (BUG-003 audit, P1.M1.T3.S1): the ring may hold
 * MULTIPLE snapshots per epoch, and entries may hold any archived status.
 * Exactly two entry kinds exist:
 * - submit-time snapshots (delivery.ts `buildSubmission`, fallback.ts
 *   `recordAnswers`): hold statuses "submitted", taken BEFORE `bumpEpoch()`
 *   — the CALLER CONTRACT above applies to THESE SITES ONLY.
 * - close-pass snapshots (lifecycle.ts `runClosePass`, gated on
 *   `toClose.length > 0`, landed in P1.M1.T3.S2 — BUG-003 option (a)):
 *   hold statuses "closed" at the UN-bumped submit epoch; the close pass
 *   never bumps the epoch.
 * Every ring consumer tolerates both kinds: `submissionBaselineOf` reads
 * only the LAST entry; `digestSince`'s consecutive-pair diff fires only on
 * answer-signature changes, so status-only flips contribute zero entries.
 * See the per-function notes below.
 *
 * Emits NO events — snapshotting is bookkeeping, not a state mutation.
 */
export function takeSnapshot(state: InterrogationState): Snapshot {
  const snap: Snapshot = {
    epoch: state.epoch,
    at: new Date().toISOString(),
    state: state.serialize(),
  };
  state.snapshots.push(snap);
  while (state.snapshots.length > SNAPSHOT_RING_SIZE) state.snapshots.shift();
  return snap;
}

/**
 * Shared diff core for {@link computeDiff} and {@link digestSince} — ONE
 * implementation so card diffs and digests can never diverge.
 *
 * For the union of question ids across `prev`/`next`, an entry exists iff
 * the answer signature differs (a missing question or missing answer has
 * signature `undefined`). `title` is `title ?? prompt` from the side where
 * the question exists, preferring `next`. `editedArchived` is true iff the
 * question's status in `prev` was "closed" (closed→re-answered edit,
 * Q24=B / AC-13 marker data). Pure: mutates nothing.
 */
function computeEntries(prev: SerializedState, next: SerializedState): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const ids = new Set([...Object.keys(prev.questions), ...Object.keys(next.questions)]);
  for (const id of ids) {
    const before = prev.questions[id];
    const after = next.questions[id];
    if (answerSignature(before) === answerSignature(after)) continue;
    entries.push({
      id,
      title: after?.title ?? after?.prompt ?? before?.title ?? before?.prompt ?? id,
      from: answerSummary(before),
      to: answerSummary(after),
      editedArchived: before?.status === "closed",
      value: after?.answer?.value, // RAW post-change value; undefined when unanswered/missing
    });
  }
  return entries;
}

/**
 * Pure diff of two serialized states → submission card data (Mode A
 * contract; no mutation, no I/O, no events).
 *
 * SubmissionCardData shape, verbatim (consumed by the card renderer
 * P1.M7.T3.S1 and the delivery delta builder P1.M2.T1.S1):
 *
 * ```ts
 * {
 *   changed: Array<{
 *     id: string;              // question id
 *     title: string;           // q.title ?? q.prompt (next side preferred)
 *     from: string;            // label-preferred summary before ("(unanswered)" if none)
 *     to: string;              // label-preferred summary after
 *     editedArchived: boolean; // prev status was "closed" → renderer appends "(changed)" (AC-13)
 *     value?: string;          // RAW post-change answer.value (undefined when unanswered);
 *                              // machine-readable for reconstruction (P1.M5.T1.S1) —
 *                              // `to` remains the label-preferred display summary
 *   }>;
 *   note?: string;      // batch-note passthrough; omitted when undefined/empty
 *   epoch: number;      // next.epoch
 *   remainOpen: number; // count of next questions with status "open" ONLY
 * }
 * ```
 *
 * Label-preference rule: choice questions resolve the option label for the
 * answered value (raw value when no option matches); text questions use the
 * raw value; missing answers read "(unanswered)". Text-only edits
 * (`answer.text` changed, value same) count as changes. `editedArchived`
 * marks closed→re-answered edits so the renderer can add the `(changed)`
 * marker. Entries additionally carry `value` — the raw post-change
 * `answer.value` (undefined when the post-change side is unanswered) — for
 * machine consumers (P1.M5.T1.S1 replaySubmission); `from`/`to` stay
 * label-preferred display summaries. Strings are NOT truncated here —
 * display truncation is the renderer's job.
 *
 * @param prev state before the submission (usually a snapshot's `.state`)
 * @param next state after the submission (usually the live `serialize()`)
 * @param note optional batch note passthrough (delivery.ts owns capture)
 */
export function computeDiff(
  prev: SerializedState,
  next: SerializedState,
  note?: string,
): SubmissionCardData {
  const data: SubmissionCardData = {
    changed: computeEntries(prev, next),
    epoch: next.epoch,
    remainOpen: Object.values(next.questions).filter((q) => q?.status === "open").length,
  };
  if (typeof note === "string" && note.length > 0) data.note = note;
  return data;
}

/**
 * Compact one-line-per-submission delta digest for stale-guard rejection
 * messages (spec/architecture.md: "Changes since epoch 4: {delta digest}.
 * Re-apply against current state."). The output goes into the `{delta
 * digest}` slot verbatim — single line, no newlines, no full prompts.
 *
 * Walk: consecutive pairs (snapshot_i.state → snapshot_{i+1}.state → … →
 * current `state.serialize()`), considering snapshots with `epoch >=
 * epochFrom`. A snapshot labeled epoch N holds the state AS SUBMITTED at
 * epoch N (pre-bump capture), so each consecutive pair is exactly one
 * submission. Each changed submission contributes one segment
 * (`q3: sqlite→postgres; q7: (unanswered)→true`) using the same
 * label-preferred summaries as the card diff; submissions with no changes
 * are dropped; segments are joined with `" | "`.
 *
 * Returns "" when `epochFrom >= state.epoch` or nothing changed. Ring
 * overflow degrades gracefully: if `epochFrom` predates the oldest
 * surviving snapshot, the walk simply starts at the oldest surviving
 * snapshot ≥ epochFrom (all snapshots qualify when they are all newer).
 * Never throws on sparse shapes; never mutates `state`.
 *
 * SAME-EPOCH / STATUS-ONLY LINKS (BUG-003 audit): consecutive same-epoch
 * pairs (a submit snapshot + the close-pass "closed" snapshot share the
 * epoch) and status-only transitions contribute ZERO entries —
 * `computeEntries` fires only when `answerSignature` (value + text)
 * differs, so a submitted→closed flip is digest-invisible; the
 * `epoch >= epochFrom` filter tolerates duplicate epochs without assuming
 * uniqueness. A close-pass snapshot therefore never changes this digest.
 *
 * @param state live interrogation state (its ring + current serialize())
 * @param epochFrom the epoch the stale caller last saw
 */
export function digestSince(state: InterrogationState, epochFrom: number): string {
  if (epochFrom >= state.epoch) return "";
  const chain: SerializedState[] = [
    ...state.snapshots.filter((s) => s.epoch >= epochFrom).map((s) => s.state),
    state.serialize(),
  ];
  const segments: string[] = [];
  for (let i = 0; i + 1 < chain.length; i++) {
    const line = computeEntries(chain[i], chain[i + 1])
      .map((e) => `${e.id}: ${e.from}→${e.to}`)
      .join("; ");
    if (line.length > 0) segments.push(line);
  }
  return segments.join(" | ");
}

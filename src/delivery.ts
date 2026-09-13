/**
 * src/delivery.ts — Submission delta builder (P1.M2.T1.S1), completion
 * record builder (P1.M2.T1.S3), and transport (P1.M2.T1.S2; submit flow
 * per spec h3.6).
 *
 * Three builder responsibilities, UI-free (h2.13 discipline):
 *
 * 1. {@link buildSubmission} — turn a computed diff ({@link computeDiff}
 *    output from snapshots.ts) plus an optional batch note into the compact
 *    ≤3-line custom message the model receives on ctrl+s. The full card data
 *    rides in `details` for the user-only renderer (P1.M7.T3.S1, h2.36:
 *    the card is drawn from `details`, NOT from content — decision Q2=A).
 * 2. {@link buildCompletion} — the ONE full-context injection (h2.0 §2): the
 *    entire h2.46 Q&A record, sent to the model exactly once at completion.
 *    Fully PURE — no snapshot, no epoch bump, no clear (completion is not a
 *    submission; lifecycle P1.M2.T2.S2 clears AFTER delivery); recap card
 *    data rides in `details` for the user-only renderer (P1.M7.T3.S2).
 * 3. The h3.6 side effects, in order: build FIRST, then
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
import { evaluateDependsOn } from "./depends-on.js";
import { takeSnapshot, type DiffEntry, type SubmissionCardData } from "./snapshots.js";
import { UNGROUPED_LABEL, type InterrogationState, type Question } from "./state.js";

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

// ==== Completion record builder (P1.M2.T1.S3) ==============================
// The ONE full-context injection (h2.0 §2): the entire Q&A record reaches
// the model exactly once, at completion. Per-request injection is explicitly
// forbidden (h2.4 user veto). Unlike buildSubmission this builder is fully
// PURE — no snapshot, no epoch bump, no clear, no events (completion is not
// a submission; P1.M2.T2.S2's lifecycle owns clearing AFTER delivery).

/** Fixed placeholder for questions without an answer (h2.46 format). */
const COMPLETION_UNANSWERED = "(unanswered)";

/**
 * One question's recap row — plain data for the user-only recap card
 * renderer (P1.M7.T3.S2; h2.36). Never a reference into stored state.
 */
export interface CompletionRecapEntry {
  /** Question id. */
  id: string;
  /** `title ?? prompt`. */
  title: string;
  /** Label-preferred answer summary; "(unanswered)" when no answer exists. */
  answer: string;
  /** True iff the answer followed the recommendation. */
  star: boolean;
  /** Free-text elaboration; key omitted when absent or empty. */
  freeText?: string;
  /** ISO 8601 timestamp of the answer; omitted when unanswered. */
  answeredAt?: string;
}

/** One group's slice of the recap card, in `order[]` sequence. */
export interface CompletionRecapGroup {
  /** `q.group ?? UNGROUPED_LABEL` ("(none)"). */
  group: string;
  /** Entries in `order[]` order within this group. */
  questions: CompletionRecapEntry[];
}

/**
 * The pi.sendMessage payload for interrogation completion (h3.9). `content`
 * is the full h2.46 record VERBATIM — the ONE full injection (h2.0 §2, Q30:
 * the model writes the final spec from it); the user-only recap card is
 * rendered from `details` by P1.M7.T3.S2, never from content.
 */
export interface CompletionMessage {
  customType: "interrogation-completion";
  /** The h2.46 record, byte-exact (grammar documented on buildCompletion). */
  content: string;
  display: true;
  details: {
    /** The interrogation goal. */
    goal: string;
    /** Grouped recap rows; groups in first-appearance order. */
    groups: CompletionRecapGroup[];
    /** Batch notes in order; may be [] (notes are NOT stored in state). */
    notes: string[];
    /** Withdrawn/moot ids with derived reasons, in `order[]` order. */
    withdrawnMoot: Array<{ id: string; status: "withdrawn" | "moot"; reason: string }>;
    /** ISO timestamp captured at record build. */
    completedAt: string;
    /** state.epoch at build time (completion freezes the epoch). */
    epoch: number;
  };
}

/**
 * Label-preferred answer summary — a local replication of snapshots.ts's
 * module-PRIVATE `answerSummary` (choice → option label whose value matches
 * `answer.value`, falling back to the raw value; text → raw value; no answer
 * → "(unanswered)"). Duplicated by design; THIS comment is the sync
 * reference between the two rules — do NOT import the private.
 */
function completionAnswerSummary(q: Question): string {
  const answer = q.answer;
  if (answer === undefined) return COMPLETION_UNANSWERED;
  if (q.type === "choice") {
    return q.options?.find((o) => o.value === answer.value)?.label ?? answer.value;
  }
  return answer.value;
}

/**
 * Build the completion message — the single FULL Q&A record the model
 * receives exactly once when the interrogation completes (h3.9; commitment
 * h2.0 §2; Q30: the model writes the final spec from it). Pure: NO snapshot,
 * NO epoch bump, NO clear, NO events, NO mutation of `state` or its stored
 * questions (completion is not a submission — P1.M2.T2.S2's lifecycle
 * dismisses the panel and clears AFTER delivery, keeping entries for audit).
 * NO transport: callers hand the returned message to deliverSubmission,
 * which carries it unchanged (SendableMessage union member).
 *
 * Record format (h2.46, quoted verbatim — `content` is this record, byte
 * for byte):
 *
 * ```
 * INTERROGATION COMPLETE — {goal}
 * [group] {id} {title}: {answer value/label} {★ if recommendation followed} {— free text}
 * …every question, grouped, in order…
 * NOTES: {batch notes in order}
 * Withdrawn/moot: {ids + reasons}
 * ```
 *
 * Line grammars (one space between tokens; optional segments are omitted,
 * never left blank):
 *
 * - Header: `INTERROGATION COMPLETE — {goal}` (EM-dash, one space each side).
 * - Question line (EVERY question regardless of status — h2.46 "every
 *   question, grouped, in order"):
 *   `[${group}] ${id} ${title}: ${answer}` + ` ★` (iff `recommendation !==
 *   undefined && answer.value === recommendation`) + ` — ${text}` (iff
 *   `answer.text` is a non-empty string). `group` is `q.group ??
 *   UNGROUPED_LABEL` and rides on EVERY question line (h2.46 shows the group
 *   per line — no standalone group headers); `title` is `q.title ??
 *   q.prompt`; groups appear in first-appearance order and questions in
 *   `order[]` order. `answer` uses the label-preferred rule replicated from
 *   snapshots.ts's private `answerSummary` ({@link completionAnswerSummary}).
 * - NOTES line (ALWAYS present): `NOTES: ${notes.join("; ")}`, or
 *   `NOTES: (none)` when `notes` is undefined/empty. Batch notes are NOT
 *   stored in state — P1.M2.T2.S2's completion trigger collects them from
 *   the delivered submission messages' `details.note` and passes them here;
 *   this function only formats (undefined === []).
 * - Withdrawn/moot line (ALWAYS present):
 *   `Withdrawn/moot: ${entries.join("; ")}` with entry
 *   `${id} (${status}: ${reason})`, or `Withdrawn/moot: (none)` when empty.
 *   Entries come from `orderedQuestions()` filtered to status
 *   "withdrawn"/"moot", in `order[]` order. Reason derivation:
 *   `withdrawn` → the human-readable "omitted by agent" (merge.ts's
 *   WithdrawalInfo.reason is the fixed string "withdrawn", which would read
 *   as the tautological "(withdrawn: withdrawn)" — this record-only mapping
 *   is documented here); `moot` → `evaluateDependsOn(state)` recomputes the
 *   reason at build time (reasons are NOT persisted on Question) and the
 *   leading `moot: ` prefix of the h2.29-format reason (e.g.
 *   `moot: storage=sqlite`) is stripped to avoid the doubled
 *   "(moot: moot: …)"; a moot question with no matching MootEvaluation
 *   entry (defensive) gets "dependency unmet".
 *
 * details carries BOTH compact and expanded recap data (h2.36): goal +
 * grouped answers + timestamps for the compact card; `withdrawnMoot` with
 * reasons for `expanded`.
 *
 * @param state the interrogation state at completion (read-only here)
 * @param notes batch notes in order (undefined === []; never stored in state)
 * @returns the message for P1.M2.T2.S2 to hand to deliverSubmission
 */
export function buildCompletion(state: InterrogationState, notes?: string[]): CompletionMessage {
  const questions = state.orderedQuestions();

  // Moot reasons are COMPUTED, never stored (depends-on.ts): one evaluation
  // pass at build time, then an id → reason map. On a state at completion
  // statuses are stable, so the pass writes nothing (withdrawn/closed are
  // skipped; still-moot questions are listed without a status write) — the
  // call is effectively read-only here; delivery.test.ts purity assertions
  // (zero changed/epoch-bumped events, byte-identical serialize()) guard it.
  const mootReasons = new Map(evaluateDependsOn(state).mootered.map((m) => [m.id, m.reason] as const));

  const groups: CompletionRecapGroup[] = [];
  const byGroup = new Map<string, CompletionRecapGroup>();
  const withdrawnMoot: CompletionMessage["details"]["withdrawnMoot"] = [];
  const lines: string[] = [`INTERROGATION COMPLETE — ${state.goal}`];

  for (const q of questions) {
    const groupKey = q.group ?? UNGROUPED_LABEL;
    let group = byGroup.get(groupKey);
    if (group === undefined) {
      group = { group: groupKey, questions: [] };
      byGroup.set(groupKey, group);
      groups.push(group); // first-appearance order
    }

    const star = q.recommendation !== undefined && q.answer?.value === q.recommendation;
    const freeText = q.answer?.text;
    const hasFreeText = typeof freeText === "string" && freeText.length > 0;

    const entry: CompletionRecapEntry = {
      id: q.id,
      title: q.title ?? q.prompt,
      answer: completionAnswerSummary(q),
      star,
    };
    if (hasFreeText) entry.freeText = freeText;
    if (q.answer !== undefined) entry.answeredAt = q.answer.at;
    group.questions.push(entry);

    // Question line — group label rides on EVERY line (h2.46); optional
    // segments are omitted entirely, never left blank.
    lines.push(
      `[${groupKey}] ${q.id} ${entry.title}: ${entry.answer}` +
        (star ? " ★" : "") +
        (hasFreeText ? ` — ${freeText}` : ""),
    );

    if (q.status === "withdrawn" || q.status === "moot") {
      withdrawnMoot.push({
        id: q.id,
        status: q.status,
        reason:
          q.status === "withdrawn"
            ? "omitted by agent"
            : (mootReasons.get(q.id)?.replace(/^moot:\s*/, "") ?? "dependency unmet"),
      });
    }
  }

  lines.push(
    `NOTES: ${notes !== undefined && notes.length > 0 ? notes.join("; ") : "(none)"}`,
    `Withdrawn/moot: ${
      withdrawnMoot.length > 0
        ? withdrawnMoot.map((e) => `${e.id} (${e.status}: ${e.reason})`).join("; ")
        : "(none)"
    }`,
  );

  return {
    customType: "interrogation-completion",
    content: lines.join("\n"),
    display: true,
    details: {
      goal: state.goal,
      groups,
      notes: notes ?? [],
      withdrawnMoot,
      completedAt: new Date().toISOString(),
      epoch: state.epoch,
    },
  };
}

// ==== TRANSPORT (P1.M2.T1.S2) ==============================================
// Everything above builds the message; everything below delivers it. The
// marker is a structural contract: the builder half stays free of
// sendMessage/triggerTurn (enforced by delivery.test.ts module hygiene).

/**
 * The union of message shapes this module can deliver to the agent:
 * {@link SubmissionMessage} (submit deltas) and {@link CompletionMessage}
 * (the one full completion record). P1.M2.T1.S3 widened this alias to the
 * union — keeping the alias means every consumer route stays
 * {@link deliverSubmission} (the single widening point, as S2's contract
 * reserved).
 */
export type SendableMessage = SubmissionMessage | CompletionMessage;

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
  // Generic instantiation pins T to the UNION of details shapes — otherwise
  // inference picks the first union member's details and rejects the other.
  // Pure type-level: msg is still passed through by reference, unmutated.
  pi.sendMessage<SendableMessage["details"]>(msg, options);
  // Fire-and-forget: no await, no try/catch — let caller error handling see throws.
}

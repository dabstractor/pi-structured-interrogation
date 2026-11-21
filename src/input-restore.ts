/**
 * src/input-restore.ts — P3.M3.T1.S1 editor seeding ladder (Local input
 * recovery).
 *
 * PURE module: no panel/state imports, no fs, no events, no answer-mutation
 * surface. Consumed by the panel's seeding sites (focusTextField /
 * syncBufferToQuestion) here, and by P3.M3.T1.S2 (session-start restore +
 * side-chat composer) downstream.
 *
 * Binding rules:
 * - spec/state-and-persistence.md §Local input recovery, "Re-edit and
 *   commit" bullet + acceptance case 5 (reopen limbs): the re-opened editor
 *   seeds by one deterministic ladder — the user's newer matching recovery
 *   draft, otherwise the exact recorded write-in/text answer value,
 *   otherwise blank; a deliberate deletion-to-empty (in-memory slot "" or
 *   durable {text:"", seq}) is the NEWEST edit and preserves the empty
 *   editor; an option value never seeds the Other editor; seeding never
 *   mutates answers, retires recovery values, or resurrects a discarded
 *   draft (capture suppression lives in text-field.ts, retirement in
 *   P3.M2.T1.S3 — this module only READS).
 * - spec/ui-spec.md:46 EXPLAIN-002 amendment: the question-change re-scope
 *   re-seeds from the freshest draft and, for Other/text re-edits, falls
 *   back to the corresponding recorded answer (replacing the old
 *   blank-when-none rule).
 * - plan/006_45773b259b06/architecture/input-recovery.md: capture keys use
 *   the RAW walk-tip entry id at capture time, so a live-session walk whose
 *   tip has since grown must restore via ANCESTRY matching — candidates
 *   whose branchId is any entry of the CURRENT walk (ancestor-or-equal of
 *   the tip), never an exact-branchId lookup. `seq` is per-canonical-key:
 *   two candidates with different branchIds have INDEPENDENT counters, so
 *   cross-branch candidates order by savedAt (ISO), tie → later position in
 *   the walk. (The note's "no timestamps WITHIN the store" rule governs the
 *   store's own per-key ordering, which latest() already handles; the
 *   cross-entity draft-vs-answer comparison below is a different axis.)
 *
 * Timestamp assumption (documented next to the comparison): both savedAt
 * (DurableInputStore flush time) and answer.at (answer commit time) are
 * Date.toISOString() output — same clock, same format (Z, ms precision) —
 * so plain string comparison is chronological. savedAt lags the keystrokes
 * by at most the ≤1s flush window; the strict `savedAt > at` rule is
 * therefore conservative and only load-bearing where no handoff retire ran
 * (applyChatAnswer — model-authored, retires nothing): ties/missing
 * savedAt resolve to the recorded answer (ANSWER-PIN conservatism), and
 * handoff windows are tombstoned so they never even reach this comparison.
 */

import type { CaptureField } from "./input-capture.js";
import type { DurableValue } from "./input-durability.js";

/** Re-exported: SeedInputs.durable exposes this shape to consumers. */
export type { DurableValue };

/**
 * Narrow READ surface the panel receives for seeding. DurableInputStore
 * satisfies this structurally (DurableKeyQuery = these fields + optional
 * session); tests inject canned latest() doubles. Reads use ONLY
 * latest() — completed saves, tombstone-aware — never the capture store's
 * in-memory pending state.
 */
export interface DurableRead {
  latest(query: {
    branchId: string;
    questionId?: string | "-";
    field: CaptureField;
  }): DurableValue | undefined;
}

/** The recorded answer, narrowed to what the ladder needs (state.ts QuestionAnswer superset). */
export interface SeedAnswer {
  value: string;
  /** ISO 8601 (Date.toISOString output) of when the answer was recorded. */
  at: string;
  /**
   * WRITEIN-001: true for ✎ write-ins AND type:"text" answers — value
   * holds free text, not an option value. An option answer (custom unset)
   * NEVER seeds an editor.
   */
  custom?: boolean;
}

export interface SeedInputs {
  /** Panel-local stage-1/write-through slot text — undefined = absent; "" = deliberate empty. */
  slotText: string | undefined;
  /** DraftStore seam draft — same semantics (getDraft → undefined when absent). */
  seamText: string | undefined;
  /** Ancestry-resolved recovery record (may be {text:"", seq} = deliberate empty). */
  durable: DurableValue | undefined;
  /** The recorded answer, any status. */
  answer: SeedAnswer | undefined;
  /** duty === "writein" && answer.custom === true — computed by the caller via {@link answerSeedEligible}. */
  answerEligible: boolean;
}

/** Which ladder tier produced the seed (panel phantom-guard bookkeeping). */
export type SeedTier = "slot" | "seam" | "durable" | "answer" | "blank";

export interface SeedResult {
  /** The seed string, verbatim (untrimmed — deliberate "" included). */
  text: string;
  /** The tier that won. */
  tier: SeedTier;
}

/**
 * Caller-side answer gate — the option-value invariant in ONE place:
 * `duty === "writein" && answer?.custom === true`. custom:true covers ✎
 * write-ins AND type:"text" answers (state.ts); an option answer never
 * qualifies; the elaboration duty NEVER seeds from the answer.
 */
export function answerSeedEligible(
  duty: "writein" | "elaboration",
  answer: SeedAnswer | undefined,
): boolean {
  return duty === "writein" && answer?.custom === true;
}

/**
 * The seeding ladder with tier attribution (spec :140 "Re-edit and
 * commit"; ui-spec :46 EXPLAIN-002 amendment). Total, pure, no hidden
 * early returns behind casts:
 *
 * 1. slotText !== undefined  → it (deliberate "" preserved);
 * 2. seamText !== undefined  → it (same semantics);
 * 3. durable !== undefined:
 *    - no eligible answer → durable.text (deliberate "" included);
 *    - eligible answer    → durable.text iff savedAt exists AND is
 *      STRICTLY newer than answer.at; ties/missing savedAt fall through
 *      to the answer (ANSWER-PIN conservatism — see the timestamp
 *      assumption in the module docblock);
 * 4. eligible answer → answer.value verbatim (untrimmed);
 * 5. otherwise "".
 */
export function recoverySeed(inputs: SeedInputs): SeedResult {
  if (inputs.slotText !== undefined) return { text: inputs.slotText, tier: "slot" };
  if (inputs.seamText !== undefined) return { text: inputs.seamText, tier: "seam" };
  if (inputs.durable !== undefined) {
    // No opponent (absent/ineligible answer — elaboration duty, option
    // answer) → the recovery draft always wins, deliberate "" included.
    const newerThanAnswer =
      inputs.answer !== undefined && inputs.answerEligible
        ? // Strict > : ties and missing savedAt resolve to the recorded
          // answer (ANSWER-PIN conservatism). ISO strings compare
          // chronologically — same clock/format, see module docblock.
          inputs.durable.savedAt !== undefined && inputs.durable.savedAt > inputs.answer.at
        : true;
    if (newerThanAnswer) return { text: inputs.durable.text, tier: "durable" };
  }
  if (inputs.answerEligible && inputs.answer !== undefined) {
    return { text: inputs.answer.value, tier: "answer" };
  }
  return { text: "", tier: "blank" };
}

/** The ladder's text-only view ({@link recoverySeed}). */
export function recoverySeedText(inputs: SeedInputs): string {
  return recoverySeed(inputs).text;
}

/**
 * Newest recovery record for {questionId, field} whose capture tip is on
 * the CURRENT walk (ancestry restore rule — architecture note §restore;
 * the walk tip grows as turns append, so exact-branchId lookups miss
 * live-session drafts). For each walk entry id (oldest → newest; newest =
 * leaf) read latest({branchId, questionId, field}); tombstoned/
 * never-captured keys yield no candidate. Cross-branch candidates order by
 * savedAt (ISO; missing treated as oldest), tie → LATER position in the
 * walk (`>=` below). `seq` is never compared across branchIds — per-key
 * counters are independent. Sibling-branch records (branchId not in the
 * walk) are invisible by construction.
 */
export function latestDraftOnLineage(
  durable: DurableRead,
  walkIds: readonly string[],
  key: { questionId: string; field: Extract<CaptureField, "writein" | "elaboration"> },
): DurableValue | undefined {
  return newestOnLineage(durable, walkIds, key);
}

/**
 * Shared ancestry-scan core (S1 + S2): the ordering rule from
 * {@link latestDraftOnLineage}'s docblock, generalized to ANY CaptureField.
 * Exported signatures stay byte-identical to their shipped contracts —
 * both public functions delegate here.
 */
function newestOnLineage(
  durable: DurableRead,
  walkIds: readonly string[],
  key: { questionId: string | "-"; field: CaptureField },
): DurableValue | undefined {
  let best: DurableValue | undefined;
  let bestAt = "";
  for (const id of walkIds) {
    const v = durable.latest({ branchId: id, questionId: key.questionId, field: key.field });
    if (v === undefined) continue; // never captured OR tombstoned (retired)
    const at = v.savedAt ?? ""; // missing savedAt = oldest
    if (best === undefined || at >= bestAt) {
      best = v;
      bestAt = at;
    }
  }
  return best;
}

/**
 * P3.M3.T1.S2 — the GENERAL ancestry scan (adds "note" keyed
 * {questionId: "-"} and "sidechat-composer" to S1's writein/elaboration
 * form): the newest durable value for {questionId, field} whose capture
 * tip is on the CURRENT walk (architecture note §restore — "Restore
 * matching": ancestor-or-equal of the tip; sibling-branch records are
 * invisible by construction). Ordering identical to
 * {@link latestDraftOnLineage}: savedAt ISO compare (missing = oldest;
 * ISO-8601 extended strings compare chronologically as plain strings),
 * tie → LATER walk position (`>=`); `seq` never compared across
 * branchIds (per-key counters are independent). Tombstoned/never-captured
 * keys yield no candidate. Pure read — only latest(), never the capture
 * store's pending state, never a write.
 */
export function latestFieldOnLineage(
  durable: DurableRead,
  walkIds: readonly string[],
  key: { questionId: string | "-"; field: CaptureField },
): DurableValue | undefined {
  return newestOnLineage(durable, walkIds, key);
}

/**
 * The note-staging seam {@link restoreSessionNote} needs — DraftStore
 * satisfies it structurally (getNote/setNote); tests inject doubles.
 */
export interface NoteStageTarget {
  getNote(): string;
  setNote(text: string): void;
}

/**
 * P3.M3.T1.S2 — the session_start "load matching recovery values" step
 * for the BATCH NOTE (the one duty with no field-open ladder tier: the
 * note never commits an answer, so S1's lazy ladder has nothing to hang
 * it on — spec :137-140, FR-28). Stages the ancestry-matched durable
 * note (via {@link latestFieldOnLineage}, questionId "-") into the
 * extension-lifetime DraftStore seam under the ABSENT-ONLY guard:
 *
 * - stage ONLY when `drafts.getNote() === ""` AND the durable text is
 *   nonempty — an in-process session_start (reload/resume/fork) must
 *   never clobber live newer typing with an older durable copy; after a
 *   restart the seam is empty so the note restores;
 * - a deliberate durable {text: ""} stages nothing (the blank editor IS
 *   the user's last edit — there is no answer tier for the note);
 * - `enterNoteMode`'s existing seed (`drafts?.getNote() || batchNote`)
 *   then finds the staged note — no panel change.
 *
 * decisions.md "Later decision — panel input recovery" (supersedes the
 * Q6=B never-restored ruling for editor input; the transcript and answers
 * are still never restored). READ-ONLY toward durability, write ONLY to
 * the seam; no answer/submit/send surface, no events (SURFACE-002 — the
 * widget line stays the only cue). Returns whether it staged (tests).
 */
export function restoreSessionNote(
  durable: DurableRead,
  drafts: NoteStageTarget,
  walkIds: readonly string[],
): boolean {
  const v = latestFieldOnLineage(durable, walkIds, { questionId: "-", field: "note" });
  if (v === undefined || v.text === "") return false;
  if (drafts.getNote() !== "") return false; // absent-only: never clobber live typing
  drafts.setNote(v.text);
  return true;
}

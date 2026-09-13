/**
 * depends-on.ts — FR-17 / FR-18 data layer (P1.M1.T2.S3).
 *
 * Two pure-over-state entry points:
 *
 * - {@link evaluateDependsOn} re-derives moot-ness for every question with a
 *   non-empty `dependsOn` from the CURRENT answers (FR-17 "instant local"
 *   greying). Unmet → `setStatus(id, "moot")` with an h2.29-format reason
 *   (e.g. `moot: storage=sqlite`); re-met → `setStatus(id, "open")` (h2.38
 *   moot → open edge). Idempotent: a second call with unchanged answers
 *   performs zero status flips and therefore emits zero `changed` events.
 *   This is reconstruction step 5's cheap recompute (state-and-persistence.md
 *   line 52) and the panel's post-answer-hook.
 *
 * - {@link computeRipple} returns the transitive closure of question ids whose
 *   `dependsOn` chain passes through a changed id — the full, UNFILTERED data
 *   contract for FR-18. Callers (P1.M5.T4.S1 ripple confirm) filter to
 *   answered/submitted for the warning copy; filtering here would break the
 *   contract. Pure: never mutates state.
 *
 * Scope guard (FR-19): dependsOn evaluation covers INSTANT LOCAL effects only.
 * This module never prunes, never withdraws, and never touches agent-side
 * semantic pruning (merge.ts rule 4). Moot/withdrawn questions stay in the map
 * — the audit trail is contractual (Q34=A).
 *
 * Consumers (contracts only — no wiring here):
 * - P1.M5.T4.S1 ripple confirm: `computeRipple(state, editedId)` BEFORE
 *   applying the edit; filters to answered/submitted for
 *   `⚠ Invalidates {n} answered questions ({ids})`.
 * - P1.M5.T2.S1 overview: ⊘ marker + reason from
 *   {@link dependencyMet} / {@link MootEvaluation}.
 * - P1.M7.T1.S2 reconstruction step 5: {@link evaluateDependsOn} right after
 *   deserialize+setState — must work on freshly deserialized state.
 * - Panel: {@link evaluateDependsOn} after every applied answer change.
 *
 * Deliberate asymmetry: {@link evaluateDependsOn} mutates (via `setStatus`,
 * which emits one `changed` per actual flip); {@link computeRipple} does not
 * (the panel calls it pre-confirm, before deciding whether to confirm).
 */

import type { DependsOn, InterrogationState, Question, QuestionStatus } from "./state.js";

/**
 * One question left in (or newly pushed to) `moot` by an evaluation pass,
 * carrying the h2.29-format reason for overview rendering:
 * `moot: {depId}={answerValue}` (e.g. `moot: storage=sqlite`),
 * `moot: {depId}=unanswered`, or `moot: {depId}=missing`.
 */
export interface MootReason {
  /** Id of the dependsOn-bearing question that is (still) moot. */
  id: string;
  /** Human-readable reason in h2.29 format, e.g. `moot: storage=sqlite`. */
  reason: string;
}

/** Result of one {@link evaluateDependsOn} pass. */
export interface MootEvaluation {
  /**
   * Questions whose dependsOn is unmet after this pass — both newly mootered
   * (status flipped to `moot` this pass) and still-moot (already `moot`, no
   * event emitted). Withdrawn/closed questions are never listed (terminal
   * until re-upsert; h2.38).
   */
  mootered: MootReason[];
  /** Ids flipped `moot` → `open` this pass (h2.38 re-met edge). */
  reopened: string[];
}

/**
 * Terminal-by-re-upsert statuses (h2.38): a question that is `withdrawn` or
 * `closed` is never re-derived by dependsOn evaluation — upsert owns those
 * lifecycles. `moot` is NOT in this set: moot → open on re-met is exactly the
 * edge this module owns.
 */
const SKIP_EVALUATION: ReadonlySet<QuestionStatus> = new Set(["withdrawn", "closed"]);

/**
 * Build the h2.29-format reason for the FIRST failing conjunct.
 * - dependency id not in the map → `moot: {id}=missing`
 * - dependency present but unanswered → `moot: {id}=unanswered`
 * - answered but value fails the condition → `moot: {id}={actualValue}`
 *   (e.g. `moot: storage=sqlite` — the actual answer value is shown, both for
 *   `equals` and `notEquals` failures).
 */
function failReason(cond: DependsOn, dep: Question | undefined): string {
  if (dep === undefined) return `moot: ${cond.id}=missing`;
  if (dep.answer === undefined) return `moot: ${cond.id}=unanswered`;
  return `moot: ${cond.id}=${dep.answer.value}`;
}

/**
 * Single-question dependsOn check: is `question` askable given the current
 * answers in `state`? Exposed for renderers (overview moot markers) and tests.
 *
 * Semantics (FR-17 / h2.29):
 * - `dependsOn` undefined or empty array → always met (no conditions).
 * - EVERY `{id, equals?, notEquals?}` conjunct must be satisfied by that
 *   dependency's CURRENT answer (AND across conjuncts, AND across the
 *   `equals`/`notEquals` keys within one conjunct).
 * - `equals`: met iff the dependency exists and `answer.value === equals`.
 * - `notEquals`: met iff the dependency exists, is ANSWERED, and
 *   `answer.value !== notEquals`. An UNANSWERED dependency is unmet even for
 *   `notEquals` — unanswered ≠ "not equal".
 * - A conjunct with neither `equals` nor `notEquals` is met iff the dependency
 *   has any answer.
 * - A dependency id missing from the map is unmet (never throws).
 *
 * @returns `{ met: true }`, or `{ met: false, reason }` where `reason` is the
 * h2.29-format string for the FIRST failing conjunct.
 */
export function dependencyMet(
  state: InterrogationState,
  question: Question,
): { met: true } | { met: false; reason: string } {
  const dependsOn = question.dependsOn;
  if (!dependsOn || dependsOn.length === 0) return { met: true };

  for (const cond of dependsOn) {
    const dep = state.getQuestion(cond.id);
    if (dep === undefined) return { met: false, reason: `moot: ${cond.id}=missing` };

    const value = dep.answer?.value;
    let conjunctMet: boolean;
    if (cond.equals === undefined && cond.notEquals === undefined) {
      // Conditionless conjunct: met iff the dependency has any answer.
      conjunctMet = value !== undefined;
    } else {
      // Any explicit condition requires an answer (unanswered = unmet).
      conjunctMet = value !== undefined;
      if (conjunctMet && cond.equals !== undefined) conjunctMet = value === cond.equals;
      if (conjunctMet && cond.notEquals !== undefined) conjunctMet = value !== cond.notEquals;
    }
    if (!conjunctMet) return { met: false, reason: failReason(cond, dep) };
  }
  return { met: true };
}

/**
 * Re-derive moot-ness for every dependsOn-bearing question from the current
 * answers (FR-17 instant-local; reconstruction step 5; panel post-answer hook).
 *
 * Per question with a non-empty `dependsOn` (iteration in `order[]` sequence):
 * - met && status === "moot"  → `setStatus(id, "open")` (h2.38 re-met edge),
 *   id pushed to `reopened`.
 * - unmet && status not in {"moot","withdrawn","closed"} → `setStatus(id,
 *   "moot")`, `{id, reason}` pushed to `mootered`.
 * - unmet && status === "moot" → listed in `mootered` (reason included) but NO
 *   `setStatus` call — idempotence: no redundant `changed` events, so panels
 *   re-render zero times on no-op passes.
 * - `withdrawn`/`closed` → skipped entirely (terminal until re-upsert; never
 *   un-terminalized from here). `answered`/`submitted`/`reasked` questions DO
 *   go moot when unmet (moot wins; a re-met later returns them to `open`
 *   because `moot` was the recorded status — S2's merge rules own the
 *   reasked/re-upsert transitions around it).
 *
 * Emits one `changed` event per actual status flip, and nothing otherwise.
 * Works identically on freshly `deserialize`d state — no runtime-only
 * bookkeeping is consulted.
 */
export function evaluateDependsOn(state: InterrogationState): MootEvaluation {
  const mootered: MootReason[] = [];
  const reopened: string[] = [];

  for (const q of state.orderedQuestions()) {
    if (!q.dependsOn || q.dependsOn.length === 0) continue;
    if (SKIP_EVALUATION.has(q.status)) continue;

    const result = dependencyMet(state, q);
    if (result.met) {
      if (q.status === "moot") {
        state.setStatus(q.id, "open");
        reopened.push(q.id);
      }
    } else {
      // Only flip when the status actually changes — setStatus emits
      // 'changed' per call and panels must not re-render on no-op passes.
      if (q.status !== "moot") state.setStatus(q.id, "moot");
      mootered.push({ id: q.id, reason: result.reason });
    }
  }

  return { mootered, reopened };
}

/**
 * Transitive ripple closure of a changed question (FR-18 data contract).
 *
 * Given the reverse `dependsOn` edges (B dependsOn A ⇒ edge A → B), returns
 * every question id reachable from `changedId` in any number of hops,
 * EXCLUDING `changedId` itself, in BFS order.
 *
 * Example (3-level transitive chain — the Mode A fixture):
 *
 * ```
 * Q1 (storage?) ← Q2 dependsOn Q1{equals:"sqlite"}
 *               ← Q3 dependsOn Q2{equals:"advanced"}
 *               ← Q4 dependsOn Q3
 * ```
 *
 * `computeRipple(state, "Q1")` → `["Q2", "Q3", "Q4"]`: a change to Q1's answer
 * can directly unmeet Q2 (its `equals` conjunct no longer holds), and Q3/Q4
 * transitively through Q2's chain. The FR-18 ripple confirm must therefore see
 * the FULL closure — the panel filters to answered/submitted for the
 * `⚠ Invalidates {n} answered questions ({ids})` copy; this function returns
 * every id unfiltered.
 *
 * Pure: reads via `orderedQuestions()`/`getQuestion()` only — never calls
 * `setStatus`/`applyAnswer`, so the serialized state is byte-identical before
 * and after (the panel calls this BEFORE applying an edit to decide whether to
 * show the confirm at all).
 *
 * Cycle-safe: `dependsOn` cycles (agent bugs, e.g. A dependsOn B, B dependsOn
 * A) terminate via a visited set — BFS is O(V+E), each id enqueued at most
 * once, no hangs and no duplicate ids in the result. For the 2-cycle example,
 * `computeRipple(state, "A")` → `["B"]` (A itself excluded).
 */
export function computeRipple(state: InterrogationState, changedId: string): string[] {
  // Reverse adjacency on demand: dep-id → [dependent question ids].
  const dependents = new Map<string, string[]>();
  for (const q of state.orderedQuestions()) {
    for (const cond of q.dependsOn ?? []) {
      const list = dependents.get(cond.id);
      if (list === undefined) dependents.set(cond.id, [q.id]);
      else list.push(q.id);
    }
  }

  const seen = new Set<string>([changedId]); // also excludes changedId from output
  const out: string[] = [];
  const queue: string[] = [changedId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of dependents.get(current) ?? []) {
      if (seen.has(next)) continue; // cycle guard + dedupe
      seen.add(next);
      out.push(next);
      queue.push(next);
    }
  }
  return out;
}

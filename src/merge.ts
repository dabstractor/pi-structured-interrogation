/**
 * src/merge.ts — merge rules 1–4 (PRD h2.21) + user-answer/lifecycle
 * transitions (P1.M1.T2.S2). Built strictly on the raw primitives exposed by
 * {@link InterrogationState} (P1.M1.T2.S1) — this module NEVER edits state.ts
 * and imports from `./state.js` only. No UI, no config, no pi packages
 * (h2.13 layering: state + merge are UI-free; renderers subscribe to the
 * state's EventEmitter).
 *
 * questionRevBumped seam: state.ts exposes no per-question rev event (it is a
 * frozen parallel contract). The raw 'questions-upserted' EventEmitter event
 * still fires via `upsertQuestion`, and {@link applyUpsert} RETURNS the full
 * transition detail — `UpsertResult.revBumped[]` lists exactly the ids whose
 * rev increased. tool.ts (P1.M1.T3.S1) and the panel subscribe to
 * 'questions-upserted' and read this result for per-rule detail; no new event
 * types are needed in state.ts.
 *
 * Drafts (R4, FR-21) live entirely panel-side: nothing in this module reads,
 * writes, or clears draft state. Rule 2 "preserves" panel drafts by simply
 * never touching them — there is no draft concept here by design.
 *
 * rev discipline (h2.39): rules 1, 2, and the withdrawn/closed reopen bump
 * `rev` (every content mutation, including withdrawal-re-add). Rule 3 forces
 * rev 1 (a new id has no prior rev to bump). Rule 4 (withdrawal) and every
 * answer path NEVER bump rev.
 */
import type { InterrogationState, Question, QuestionAnswer, QuestionOption, QuestionStatus } from "./state.js";

/** One merge-rule application, recorded per incoming id in batch order. */
export interface UpsertTransition {
  id: string;
  /** Applied rule: 1–3 per h2.21; 4 is reserved (withdrawals are reported in `UpsertResult.withdrawn`); "reopen-*" is the h2.38 withdrawn/closed re-upsert path. */
  rule: 1 | 2 | 3 | 4 | "reopen-same" | "reopen-changed";
  /** Status before the transition, or "absent" for rule 3. */
  from: Question["status"] | "absent";
  /** Status after the transition. */
  to: Question["status"];
  /** Whether this transition increased the question's rev (h2.39). */
  revBumped: boolean;
  /** Whether the stored answer was deleted (rule 2 / reopen-changed). */
  answerReset: boolean;
}

/** Rule 4 outcome — the id is KEPT in the map (audit trail, Q34=A). */
export interface WithdrawalInfo {
  id: string;
  reason: "withdrawn";
}

/**
 * Structured result of {@link applyUpsert} — the questionRevBumped seam.
 * `revBumped[]` is the event surface; the raw 'questions-upserted'
 * EventEmitter event also fires per `upsertQuestion` call — panel and
 * tool.ts subscribe there and read this result for per-rule detail.
 */
export interface UpsertResult {
  /** One per incoming id, in batch order. */
  transitions: UpsertTransition[];
  /** Ids whose rev increased (rules 1, 2, and reopens) — never rule 3/4 ids. */
  revBumped: string[];
  /** Rule 4 — omitted live ids now `withdrawn` (kept in map for audit). */
  withdrawn: WithdrawalInfo[];
  /** Rule 3 — brand-new ids, in batch order (for panel focus/grouping). */
  appended: string[];
}

/** Statuses eligible for rule-4 withdrawal when omitted from a batch. */
const WITHDRAWABLE: readonly QuestionStatus[] = ["open", "answered", "submitted", "reasked"];

/**
 * Options comparison is by VALUE LIST only: map to `option.value` and compare
 * as ordered arrays. Label/ramification changes are text updates (rule 1),
 * never a re-ask. Missing options (text-type questions) compare as
 * equivalent: undefined, empty, and [] all count as "same options".
 */
function sameOptions(a?: QuestionOption[], b?: QuestionOption[]): boolean {
  const va = (a ?? []).map((o) => o.value);
  const vb = (b ?? []).map((o) => o.value);
  return va.length === vb.length && va.every((v, i) => v === vb[i]);
}

/** Throw the canonical unknown-id error before any mutation happens. */
function ensureKnown(state: InterrogationState, id: string): void {
  if (state.getQuestion(id) === undefined) throw new Error(`unknown question id: ${id}`);
}

/**
 * Apply one agent upsert batch against the interrogation state, executing the
 * four merge rules from PRD h2.21 verbatim:
 *
 * 1. Existing id, same option values → text/description/ramification updates
 *    apply silently; existing answer and rev-bump; drafts untouched.
 * 2. Existing id, changed options → answer reset, status `reasked` (⟳
 *    marker), rev-bump; panel draft *preserved* (surfaces when the user
 *    revisits).
 * 3. New id → appended, status `open`, rev 1.
 * 4. FLAG-GATED (2026-09-15 patch-semantics pin): omitted live ids withdraw
 *    (⊗ marker, kept in map with reason "withdrawn") ONLY when the caller
 *    passes `withdrawOmitted: true`. By default (patch semantics) the batch
 *    touches ONLY the ids it carries — omitted live questions are
 *    UNTOUCHED, so a surgical 1–2 question edit can never withdraw the plan.
 *    Deliberate pruning = resend the kept set + the flag.
 *
 * Reopen semantics (h2.38 decision table): a re-upsert of a `withdrawn` or
 * `closed` id bumps rev like any content mutation. Same option values keep
 * the stored answer and reopen to `answered` (or `open` when no answer was
 * kept); changed option values follow rule 2 (answer reset, `reasked`).
 * A `moot` id is left to P1.M1.T2.S3 on a same-options re-upsert (status
 * stays `moot`; S3 recomputes moot-ness after this returns); a changed-
 * options re-upsert is a genuine re-ask and follows rule 2.
 *
 * Options are compared by value list only (ordered `.value` arrays);
 * label/ramification edits are rule-1 text updates. For ALL incoming ids the
 * stored Question is rebuilt from the incoming content + the decided
 * status/rev/answer (via structuredClone) — the stored object returned by
 * `getQuestion()` is never mutated, and existing ids keep their `order[]`
 * position (guaranteed by `upsertQuestion`).
 *
 * Rule 4 runs ONLY when `withdrawOmitted` is true (2026-09-15 pin), over the
 * stored ids NOT present in the batch, and only "live" statuses
 * (open/answered/submitted/reasked) withdraw. `moot` is S3's domain,
 * `closed` is archived, and an already-`withdrawn` id is a no-op — none of
 * them re-withdraw (tolerant posture: warn-level differences, never refuses).
 * Withdrawn questions stay in the map with their answer preserved for audit
 * (Q34=A); rule 4 never bumps rev (h2.39).
 *
 * Throws `Error("duplicate question id in upsert batch: <id>")` when the
 * batch repeats an id — the whole batch is refused before any mutation.
 *
 * @param state - The interrogation state (raw primitives only; never edited).
 * @param incoming - The upsert batch, applied in array order.
 * @param withdrawOmitted - When true, rule 4 withdraws live ids omitted from
 *        the batch (set-replace mode). Default false: patch semantics —
 *        omitted live ids are untouched (2026-09-15 pin).
 * @returns The structured {@link UpsertResult} — the questionRevBumped seam:
 * `revBumped[]` is the event surface; the raw 'questions-upserted'
 * EventEmitter event also fires via `upsertQuestion` — panel and tool.ts
 * subscribe there and read this result for per-rule detail.
 */
export function applyUpsert(state: InterrogationState, incoming: Question[], withdrawOmitted = false): UpsertResult {
  // Duplicate ids inside one batch are a model protocol error — refuse the
  // whole batch before touching any state.
  const seen = new Set<string>();
  for (const q of incoming) {
    if (seen.has(q.id)) throw new Error(`duplicate question id in upsert batch: ${q.id}`);
    seen.add(q.id);
  }

  const transitions: UpsertTransition[] = [];
  const revBumped: string[] = [];
  const appended: string[] = [];

  // PASS 1 — rules 1–3 (+ reopens), per incoming id, in batch order.
  for (const incomingQ of incoming) {
    const existing = state.getQuestion(incomingQ.id);

    if (existing === undefined) {
      // Rule 3: new id → appended, status open, rev 1 (no prior rev to bump).
      const fresh: Question = {
        ...structuredClone(incomingQ),
        rev: 1,
        status: "open",
        answer: undefined,
      };
      // upsertQuestion forces rev 1 / "open" on new ids and appends to order[].
      state.upsertQuestion(fresh);
      transitions.push({
        id: incomingQ.id,
        rule: 3,
        from: "absent",
        to: "open",
        revBumped: false,
        answerReset: false,
      });
      appended.push(incomingQ.id);
      continue;
    }

    const reopening = existing.status === "withdrawn" || existing.status === "closed";
    const same = sameOptions(incomingQ.options, existing.options);
    const rev = existing.rev + 1; // every content mutation bumps rev (h2.39)

    let status: QuestionStatus;
    let answer: QuestionAnswer | undefined;
    let rule: UpsertTransition["rule"];
    let answerReset: boolean;

    if (same) {
      // Rule 1 / reopen-same: silent text update (prompt/description/title/
      // ramification/recommendation/group/gate/dependsOn all come from the
      // incoming content); answer kept; status kept — except withdrawn/closed
      // which reopen (answer kept → "answered", else "open").
      status = reopening ? (existing.answer !== undefined ? "answered" : "open") : existing.status;
      answer = existing.answer !== undefined ? structuredClone(existing.answer) : undefined;
      rule = reopening ? "reopen-same" : 1;
      answerReset = false;
    } else {
      // Rule 2 / reopen-changed: answer reset means DELETE the answer (not an
      // empty object) — it stays undefined until the user re-answers.
      status = "reasked";
      answer = undefined;
      rule = reopening ? "reopen-changed" : 2;
      answerReset = true;
    }

    const merged: Question = { ...structuredClone(incomingQ), rev, status, answer };
    // Wholesale replace; upsertQuestion preserves the order[] position.
    state.upsertQuestion(merged);

    transitions.push({
      id: incomingQ.id,
      rule,
      from: existing.status,
      to: status,
      revBumped: true,
      answerReset,
    });
    revBumped.push(incomingQ.id);
  }

  // PASS 2 — rule 4 (FLAG-GATED, 2026-09-15 pin): stored ids omitted from
  // the batch withdraw ONLY in set-replace mode (`withdrawOmitted: true`).
  // Default patch semantics skips this pass entirely — a surgical edit of
  // one or two ids can never withdraw the rest of the plan. Only live
  // statuses withdraw; moot (S3's domain), closed (archived), and already-
  // withdrawn ids are left untouched (no-op: no rev bump, no re-withdrawal).
  const withdrawn: WithdrawalInfo[] = [];
  if (withdrawOmitted) {
    for (const q of state.orderedQuestions()) {
      if (seen.has(q.id)) continue;
      if (!WITHDRAWABLE.includes(q.status)) continue;
      state.setStatus(q.id, "withdrawn"); // stays in map, answer kept for audit
      withdrawn.push({ id: q.id, reason: "withdrawn" });
    }
  }

  return { transitions, revBumped, withdrawn, appended };
}

/**
 * Record the user's answer for one question: delegates to
 * `state.applyAnswer`, which stores the answer and moves status to
 * `answered` (pending-until-submit per h2.38). NEVER bumps rev — answers are
 * epoch territory (h2.39). Throws on unknown ids.
 *
 * Legal prior statuses: any non-withdrawn status. v1 does NOT hard-enforce
 * priors beyond the unknown-id throw — the ripple confirmation lives
 * panel-side (FR-18). Prior status `closed` is the FR-2/Q24=B edit-archived
 * path: the same call re-marks it `answered`; the next submission diff marks
 * it `(changed)`.
 *
 * @param state - The interrogation state.
 * @param id - Question id; must exist (throws otherwise).
 * @param answer - The recorded answer (copied by the raw primitive).
 */
export function markAnswered(state: InterrogationState, id: string, answer: QuestionAnswer): void {
  state.applyAnswer(id, answer); // throws on unknown id; enforces no-rev-bump
}

/**
 * Move the given questions to `submitted` — the ctrl+s submit flush applies
 * this to all pending (answered) ids before the epoch bump. Throws on
 * unknown ids (validated for the whole batch before anything is applied).
 *
 * Legal prior status: `answered` (or reasked-then-answered). As with
 * {@link markAnswered}, v1 does not hard-enforce priors beyond the
 * unknown-id throw — ripple confirm lives panel-side (FR-18).
 */
export function markSubmitted(state: InterrogationState, ids: string[]): void {
  for (const id of ids) ensureKnown(state, id);
  for (const id of ids) state.setStatus(id, "submitted");
}

/**
 * Move the given questions to `closed` (archived) — the auto-close engine
 * (P1.M2.T2.S1) calls this after agent_settled for the submitted-at-epoch
 * ids that were not re-asked. Throws on unknown ids (validated for the whole
 * batch before anything is applied).
 *
 * Legal prior status: `submitted`. v1 does not hard-enforce this — the
 * unknown-id throw is the only guard.
 */
export function closeSubmitted(state: InterrogationState, ids: string[]): void {
  for (const id of ids) ensureKnown(state, id);
  for (const id of ids) state.setStatus(id, "closed");
}

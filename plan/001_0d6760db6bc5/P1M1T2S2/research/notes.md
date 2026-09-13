# Research notes — P1.M1.T2.S2 (Merge rules 1-4 + status transitions)

## Sources examined
- `plan/001_0d6760db6bc5/P1M1T2S1/PRP.md` — the S1 CONTRACT (in-flight, parallel). InterrogationState
  exports: QuestionStatus, Question/QuestionOption/QuestionAnswer, SerializedState, Snapshot,
  typed StateEvents; raw primitives `upsertQuestion(q)` (keep position on existing id),
  `removeQuestion(id)`, `applyAnswer(id, answer)` (no rev bump), `setStatus(id, status)`,
  `bumpRev(id)`, `bumpEpoch()`, `clearForCompletion()`; events 'changed'(SerializedState),
  'questions-upserted'([ids]), 'epoch-bumped'(epoch), 'completed-cleared'. state.ts imports
  ONLY node:events; no UI, no config.
- `spec/state-and-persistence.md` — §Question state machine (h2.38 diagram verbatim),
  §rev and epoch semantics (rev bumps on ANY content mutation incl. withdrawal-re-add; answers
  never bump rev; epoch bumps only on submission), §Auto-close algorithm (h2.44).
- PRD h2.21 (merge rules verbatim), h2.38, h2.8 (FR-2 editing archived → pending; FR-4 close
  semantics), FR-21 (drafts survive upserts — drafts live panel-side, state must not clear them).

## Key decisions for S2
1. S2 is a NEW module `src/merge-rules.ts` — do NOT edit state.ts (S1 is landing in parallel;
   contract only). It imports types + class from `./state.js`. Wait — placement decision: item
   says "consumed by tool.ts"; architecture module layout (system-context.md line 24) says
   state.ts owns merge logic. CONFLICT RESOLUTION: since S1's PRP explicitly says "S2's merge
   rules call bumpRev" and S1 ships raw primitives only, S2 implements the logic. Safest is a
   separate file `src/merge.ts` exporting applyUpsert + transition functions that take the
   state instance. This avoids editing state.ts while it's being implemented in parallel.
   Any event (questionRevBumped) must be added without touching state.ts → use the existing
   'questions-upserted' event payload extended? No — events are typed in state.ts. Solution:
   emit via state's EventEmitter using the raw 'questions-upserted' with ids, and ALSO export
   a merge-result object from applyUpsert listing rev-bumped ids + transitions so panel/tool
   consumers can react without new event types. Consumers needing push notification subscribe
   to 'questions-upserted' then read result fields. Document this clearly.
2. Option-comparison: compare `options` by VALUE equality over `option.value` array (order
   matters; same values = rule 1 regardless of label/ramification text changes — those are the
   "silent text update"). `type: "text"` questions: treat absence of options as "same options"
   → rule 1 applies to prompt/description edits of text questions.
3. Reopen of withdrawn/closed via re-upsert (h2.38): upsert containing id with current rev+1
   (guard enforced later in T3.S2; here we take echo rev as input optional) → status open
   (or answered kept if same options & answer exists? No: withdrawn→re-upsert = fresh open,
   rev bump; closed→re-upsert with same options keeps answer per diagram "closed+reopen via
   re-upsert with rev+1" → status reasked if changed options, else open-but-answer-kept?
   Diagram shows closed +re-upsert→ open/answered path ambiguous. DECISION: re-upsert of
   closed/withdrawn with SAME options → answer kept, status answered if answer exists else
   open (rev+1). With CHANGED options → rule 2 (reset, reasked). This matches rule 1
   "answer kept" spirit and FR-2.
4. markAnswered / markSubmitted / closeSubmitted are plain state transitions; editing closed
   → answered(pending) is FR-2/Q24=B. Pending vs answered: model has single "answered" status
   (h2.38) with "pending" qualifier = not yet submitted. markSubmitted(ids) sets status
   submitted; closeSubmitted(ids) sets closed.
5. Reason field for withdrawn/moot: Question type has no reason field. Withdrawal reason is a
   constant "withdrawn" per h2.21 rule 4; moot reasons are S3's concern. Store nothing extra —
   status IS the reason for withdrawal ("withdrawn"). Note for S3: moot reasons may need a
   field; that's S3's scope (may extend type — flag in PRP as out of scope here).

## Test approach
vitest co-located `src/merge.test.ts`; build state via createInterrogationState + upsertQuestion.

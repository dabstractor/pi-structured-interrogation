# Research notes — P1.M1.T2.S3: dependsOn evaluator + transitive ripple closure

## Consumers (from plan tree + specs)
- P1.M5.T4.S1 ripple confirm (ui-spec.md line 42): footer `⚠ Invalidates {n} answered questions ({ids}) — enter=keep, esc=cancel`; fires when ripple closure hits answered/submitted questions on commit of an edit to an *answered* question.
- P1.M5.T2.S1 overview (ui-spec.md line 20): `⊘` moot marker + reason, dimmed. Format from h2.29: `moot: storage=sqlite`.
- P1.M7.T1.S2 reconstruction step 5 (state-and-persistence.md line 52): "recompute dependsOn moot-ness from current answers (cheap, idempotent)" — so evaluateDependsOn must be pure/idempotent over state, callable standalone after deserialize.

## Upstream contracts
- S1 (state.ts, treated as frozen): `Question.dependsOn?: {id, equals?, notEquals?}[]`, `getQuestion`, `orderedQuestions`, statuses `open|answered|submitted|reasked|moot|withdrawn|closed`, `setStatus`, `SerializedState`. Typed events; no new events needed here.
- S2 (merge.ts, parallel): owns status transition legality for upserts/answers. S3 must NOT fight it: apply moot transitions via setStatus, and skip questions whose status shouldn't be re-derived.
- Repo conventions: ESM `./state.js` imports, co-located vitest `*.test.ts`, typecheck via `npm run typecheck`.

## Semantics decisions
- Condition met iff EVERY {id, equals?, notEquals?} conjunct satisfied by dependency's current answer. Unanswered dependency = unmet. Empty dependsOn array = always met.
- equals: `dep.answer?.value === cond.equals`. notEquals: `answer?.value !== cond.notEquals` — but unanswered dependency = unmet regardless (per item contract: "unanswered dependency = unmet unless no condition given").
- Unmet → status `moot` + reason string like `moot: storage=sqlite` (dependency id=cond value). Re-met → back to `open` per h2.38 (moot → open on re-met). Preserve answer? h2.38 shows moot from open; answered questions going moot is the ripple-confirm territory — panel gates via computeRipple BEFORE apply. Evaluator: when re-met, moot → open (only from moot).
- computeRipple(state, changedId): BFS over reverse dependsOn edges (dependents). Transitive set of ids whose dependsOn chain passes through changedId. Panel filters to answered/submitted for the confirm copy.
- Pure functions, no events fired except via setStatus (which emits 'changed'). Cheap: O(V+E).

## External reference
- Transitive closure over dependency DAGs: standard BFS on reverse adjacency; cycle guard via visited set (dependsOn cycles are agent bugs — treat as visited-stop, don't hang; optionally flag in reason).

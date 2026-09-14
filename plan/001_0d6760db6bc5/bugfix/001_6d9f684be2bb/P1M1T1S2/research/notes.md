# Research — P1.M1.T1.S2 (bugfix): tool.ts capped goal on create AND update

Verified against working tree (930 green tests, fully implemented repo).

## src/tool.ts upsert path (lines ~248–271)
```ts
case "upsert": {
  const state: InterrogationState = existing ?? createInterrogationState(parsed.action.goal ?? "");
  if (!existing) setState(state);
  assertFresh(state, parsed.action);
  const capped = applyCaps(parsed.action.questions, parsed.action.goal ?? "", config,
    ctx.model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW);
  applyUpsert(state, capped.questions.map(toMergeQuestion));   // capped.goal DISCARDED here
  ...
```
- CREATE path: raw goal used at createInterrogationState (uncapped). Fix: create AFTER applyCaps with `capped.goal` (or create with "" then setGoal(capped.goal)). Simplest: move applyCaps before state creation; state = existing ?? createInterrogationState(parsed.action.goal !== undefined ? capped.goal : ""); guard ordering: applyCaps is pure (no state mutation) so calling before assertFresh is safe, but keep assertFresh before ANY mutation of state — creating/registering a fresh singleton is fine. Safe minimal ordering: compute `capped` first (pure), then create/setState, then assertFresh, then REUSE-path setGoal.
- REUSE path: when `parsed.action.goal !== undefined` → `state.setGoal(capped.goal)` (S1 delivers setGoal; emits `changed`). setGoal must come after assertFresh (guards before mutation) and order vs applyUpsert doesn't matter semantically, but do setGoal after applyUpsert or before — pick after applyUpsert so a single `changed`-burst order matches questions-upserted flow; note applyUpsert + setGoal each emit `changed` (two events — acceptable, S1 says setGoal always emits).
- Stale doc comment at tool.ts:198–201: "existing state: the goal is FIXED for the lifetime of the state (readonly, no setter — verified)" — must be rewritten.

## caps.ts CapsResult (line 191)
`applyCaps` returns `{ questions: kept, goal: cappedGoal, warnings }`; warning text `goal truncated at ${originalLength} chars` (line 188). Already computed in the upsert path at line 252 — just consume `capped.goal`. applyCaps is pure (structuredClone; never mutates caller).

## tool.test.ts
- Lines 145–154: test "existing state: goal is NOT replaced (fixed for the lifetime of the state)" — asserts getState().goal stays "first goal". REWRITE to expect "second goal".
- Conventions: beforeEach resetState(); helpers seedState(goal)/seedQ/qi; tuiCtx(); executeInterrogate(args, tuiCtx()); assertions on r.details.state.goal and getState().
- Fresh-upsert test (lines ~136–150) already checks details.state.goal === "Ship it" — unaffected.

## tool-schema.ts
- Line 107: `goal: Type.Optional(Type.String({ description: "What these questions drive toward; shown in the panel header" }))` — append updatable note. Also line 80 routing table mentions goal? — line 80 lists `{questions, goal?, epoch?}`; only description needs the Mode-A update at line 107.

## Consumers of details.state.goal / serialize().goal (all auto-correct via setGoal emit)
results.ts read/upsert builders, fallback digest, delivery/completion, panel header, persistence — no changes needed here.

## Read routing
Goal-only `{}` call routes to read (routing at tool.ts ~227: questions→upsert, answers→record, reopen, else read). untouched.

## Next consumer (P1.M1.T2.S1 fresh-state swap)
Keep the capped-goal handling in one coherent block so the fresh-state swap reuses it.

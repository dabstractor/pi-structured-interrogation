# Research notes — Bugfix P1.M1.T2.S1 (fresh-state swap on upsert after completion)

## Bug being fixed — BUG-002 (PRD h2.2/h3.1)
After the first interrogation completes (`clearForCompletion()` sets `state.completed = true`, src/state.ts:410), the tool's upsert path reuses the session singleton (`existing ?? createInterrogationState(...)`, src/tool.ts:248). `attemptCompletion` short-circuits at src/completion.ts:110 (`if (state.completed === true) return {fired:false, reason:'already-completed'}`), so a second interrogation can NEVER fire its completion record. It also inherits stale goal + epoch.

## Verified code facts (line numbers current)
- src/tool.ts:231 `const existing = getState();` — `existing` is captured ONCE and reused by every case (read/upsert/reopen/record). The upsert case at ~248–271 currently:
  ```ts
  const state: InterrogationState = existing ?? createInterrogationState(parsed.action.goal ?? "");
  if (!existing) setState(state);
  assertFresh(state, parsed.action);
  const capped = applyCaps(parsed.action.questions, parsed.action.goal ?? "", config, ctx.model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW);
  applyUpsert(state, capped.questions.map(toMergeQuestion));
  ```
- **P1.M1.T1.S2 (previous item, in flight — CONTRACT)** rewrites this block to:
  ```ts
  const capped = applyCaps(parsed.action.questions, parsed.action.goal ?? "",
                           config, ctx.model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW);
  const state = existing ?? createInterrogationState(parsed.action.goal !== undefined ? capped.goal : "");
  if (!existing) setState(state);
  assertFresh(state, parsed.action);
  applyUpsert(state, capped.questions.map(toMergeQuestion));
  if (existing && parsed.action.goal !== undefined) state.setGoal(capped.goal);
  ```
  My PRP must compose with THAT shape (capped goal available, setGoal on reuse path).
- src/state.ts seams (all verified): `completed?: boolean` field (line 103/236, default false; set true ONLY in `clearForCompletion` at 410; restored by `deserialize` at 451 — exactly-once across restart is INTENDED, do not weaken); `snapshots` retained + goal/epoch retained by clearForCompletion (comment at ~405-411); `createInterrogationState(goal)` (557), `getState()` (564), `setState(state)` (573), `resetState()` (581). `serialize()` includes `completed` (line 431).
- src/completion.ts:110 — the one-time guard, runs BEFORE the predicate (comment lines 108-109: an upsert racing the clear can never re-arm completion on cleared state). Attempt order in `attemptCompletion`: no-state → completed guard → predicate → buildCompletion → deliverSubmission → dismissPanel → clearForCompletion.
- src/panel/panel.ts — `handleUpserted(ids)` (1143) subscribes `questions-upserted` on the CURRENT state instance (subscribed via opts.state.on at 1252, re-subscribed on resume). While suspended → reopens the panel; no open-count guard. **Consequence**: after a singleton swap, the panel must re-subscribe to the NEW instance — but panel.ts's wiring happens in `openPanel(opts.state)` / resume paths. The item contract says "Panel/lifecycle need no wiring" because `applyUpsert` on the new state fires `questions-upserted` → handleUpserted reopens. IMPORTANT nuance: handleUpserted is subscribed on the OLD instance; the NEW instance's event fires only if the panel subscribes to it. Since after completion the panel is dismissed (attemptCompletion calls lifecycle.dismissPanel()), and reopening happens on next openPanel call (which subscribes the passed state — index/lifecycle fetch getState() fresh), the no-wiring claim holds as long as lifecycle/panel read `getState()` at open time, not a cached instance. Flag this in the PRP as a verification point (grep lifecycle.ts for getState usage).
- src/merge.ts exports: `markAnswered`, `markSubmitted`, `closeSubmitted`, `applyUpsert` (completion.test.ts imports show the seam).
- Test conventions (src/tool.test.ts / completion.test.ts): `beforeEach(() => resetState())`; helpers `seedState(goal)` (line 60), `seedQ(st,id)`; `qi(id, {rev,...})`; `tuiCtx()`; `executeInterrogate(args, tuiCtx())`; completion.test.ts has a `vi.mock` of delivery with `deliverSubmission: vi.fn(...)` passthrough (lines ~40-50) and `makeOpts(st)` / `closePass()` helpers.

## Decision being pinned (from item contract)
Spec left epoch-on-new-interrogation UNSPECIFIED. Decision: a completed singleton is REPLACED by a fresh one (epoch 1, completed=false, empty snapshots) at the moment a NEW-question upsert arrives on a completed state. Goal retained from the old state unless the upsert carries a goal (FR-30 anchors re-asks). Rationale: state-and-persistence.md §Auto-close (completion clears in-memory state) + reconstruction takes the LATEST interrogate toolResult as base → fresh singleton is branch-natural. Recorded in P1.M5.T2.S2 (not this task).

## Fix location & ordering
In tool.ts upsert case, BEFORE assertFresh/applyCaps (guards run against the state that will actually receive the upsert — on a fresh state assertFresh trivially passes: epoch 1, no existing questions):
```ts
if (existing !== undefined && existing.completed === true) {
  const fresh = createInterrogationState(
    parsed.action.goal !== undefined ? capped.goal : existing.serialize().goal);
  setState(fresh);
  // proceed with upsert flow on `fresh` (existing must no longer shadow it)
}
```
Key trap: the local `existing` const is reused below for the reuse-path `setGoal` branch (S2 contract: `if (existing && parsed.action.goal !== undefined) state.setGoal(...)`). After a swap, `state` is fresh and goal is already set at construction — the setGoal branch must NOT run against `existing.completed` semantics. Cleanest: restructure so `existing` becomes `let`/re-derived or the completed-swap produces `state` and the setGoal condition keys off the ORIGINAL-existing vs fresh distinction (goal already applied at construction on the fresh path — setGoal would be a redundant but harmless second emit; prefer correctness: skip it).

## Reproduction steps (from PRD h3.1) — the failing-test-first script
1. seedState + seedQ q1; applyAnswer; buildSubmission/markSubmitted; closeSubmitted + attemptCompletion → fired:true.
2. executeInterrogate({questions:[{id:'n1',...}]}) (no epoch needed — fresh state, BUG-010/P1.M1.T3 will later require epoch on existing-id upserts; n1 is new).
3. answer n1, submit, close pass + attemptCompletion → MUST be fired:true (currently 'already-completed').

## Scope guards
- Do NOT touch completion.ts guard, state.ts completed/deserialize semantics (exactly-once across restart preserved — restart reconstructs the completed singleton; a NEW upsert after restart ALSO swaps fresh, which is correct).
- Do NOT add panel/lifecycle wiring (verify, don't modify).
- Docs: only the tool.ts upsert-case Mode A comment. README/decisions → P1.M5.T2.

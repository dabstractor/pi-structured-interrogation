# PRP — Bugfix P1.M1.T2.S1: Fresh-state swap on upsert after completion (epoch restarts at 1)

## Goal

**Feature Goal**: When an `interrogate` upsert arrives while the session singleton has `completed === true` (a prior interrogation already fired its completion record), the tool mints a **fresh state** via `createInterrogationState` (epoch 1, `completed=false`, empty questions/order/snapshots), installs it with `setState(...)`, and proceeds with the normal upsert flow on the new state. Result: N interrogations per session each fire their completion record exactly once, and `details.state` of the new interrogation carries epoch restarting at 1. Fixes BUG-002.

**Deliverable**: Modified `src/tool.ts` (completed-swap in the upsert case + Mode A doc comment) and `src/tool.test.ts` (failing-test-first reproduction + swap-semantics cases). No other files.

**Success Definition**:
- `npm run typecheck` + `npm test` all green (930 existing + S1/S2 of T1 + new tests)
- PRD h2.2/h3.1 steps-to-reproduce: first interrogation completes `{fired:true}`; a NEW-question upsert on the completed state creates a fresh state; that second interrogation also completes `{fired:true}` (currently `'already-completed'`)
- Fresh state: `epoch === 1`, `completed === false`, `snapshots.length === 0`; goal = the upsert's capped goal if sent, else the prior state's goal (retained)

## Why

Commitment 2 / FR-5 / Q30: the full Q&A record is injected **exactly once per interrogation**. The one-time guard `state.completed` (set only by `clearForCompletion`, restored by `deserialize` — exactly-once across restart is intended and must NOT be weakened) is never reset for a new interrogation because the upsert path reuses the session singleton. After the first completion, every subsequent interrogation short-circuits `attemptCompletion` with `'already-completed'`; its completion record — the record the model writes the spec from — is never delivered. The new interrogation also inherits the stale goal and unreset epoch.

This changeset **pins the spec gap** (epoch-on-new-interrogation is UNSPECIFIED in spec-contracts.md §'Second interrogation'): completion CLEARS in-memory state (state-and-persistence.md §Auto-close) and reconstruction takes the LATEST interrogate toolResult as base — so a fresh singleton is the natural reading. The pinned decision is recorded in P1.M5.T2.S2 (not this task).

## What

1. **Failing test first** (TDD): reproduce PRD h2.2/h3.1 steps 1–3 in `src/tool.test.ts` — second interrogation's `attemptCompletion` must return `{fired:true}`; it currently returns `'already-completed'`. Write it, watch it fail, then fix.
2. **`src/tool.ts` upsert case**: BEFORE `assertFresh`/state reuse, if `existing !== undefined && existing.completed === true`, mint a fresh state via `createInterrogationState(goal)` — goal = the upsert's **capped** goal when `parsed.action.goal !== undefined`, else RETAIN `existing.serialize().goal` (FR-30 anchors re-asks; a blank header helps nobody) — then `setState(fresh)` and continue the normal upsert flow on the fresh instance (`assertFresh` trivially passes: epoch 1, no existing questions). Comment the goal-retention choice.
3. **Compose with P1.M1.T1.S2's contract**: that subtask hoists `applyCaps` above state creation and adds a reuse-path `state.setGoal(capped.goal)`. After a completed-swap, the goal is already applied at construction — the reuse-path `setGoal` must not run for the swapped call (see Blueprint: key the setGoal branch off the ORIGINAL existing-vs-fresh distinction, not the post-swap `state`).
4. **Mode A doc comment** on the upsert case: singleton lifetime — a completed singleton is REPLACED, not reused; epoch restarts at 1; goal retained unless the upsert supplies one; `completed`'s exactly-once-across-restart semantics in `deserialize` are untouched.

### Success Criteria

- [ ] Upsert (new id) on a completed state → `getState()` is a NEW instance: `epoch === 1`, `completed === false`, `snapshots.length === 0`, `questions` contains only the new id, `order === [newId]`
- [ ] Goal retained: upsert WITHOUT `goal` after completion → fresh state's `goal` equals the prior goal
- [ ] Goal replaced + capped: upsert WITH a 500-char goal after completion → fresh goal length 400, `goal truncated at 500 chars` warning in result
- [ ] `details.state` of the swap-carrying upsert result reports epoch 1 and the new question
- [ ] Second interrogation end-to-end: answer → submit → close pass + `attemptCompletion` → `{fired:true}` (the PRD repro)
- [ ] First interrogation still fires exactly once (no regression); `deserialize` restoring `completed=true` still blocks a same-restart completion replay (guard untouched)
- [ ] Upsert on a NON-completed existing state behaves exactly as before (no swap) — regression case

## All Needed Context

### Context Completeness Check

Repo fully implemented and green (930 tests). This PRP cites the exact current upsert code, the S2 (P1.M1.T1.S2) contract that rewrites it, all state.ts singleton seams with line numbers, the completion guard, and the test-file conventions. An agent with this PRP plus `src/tool.ts`, `src/tool.test.ts`, `src/state.ts`, `src/completion.ts` can implement it.

### Documentation & References

```yaml
- file: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/P1M1T1S2/PRP.md
  why: "CONTRACT for the upsert-case shape this subtask composes with: applyCaps hoisted above creation, create uses capped goal, reuse path adds state.setGoal(capped.goal)"
  critical: "the setGoal branch keys on `existing && parsed.action.goal !== undefined` — after a completed-swap the goal is ALREADY applied at construction; do not run setGoal redundantly against the fresh instance (double `changed` emit, wrong semantics)"
  gotcha: S2 rewrites tool.test.ts:145-154 (goal now updatable) — land on top of S2's shape, do not revert it

- file: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/P1M1T1S1/PRP.md
  why: "CONTRACT for setGoal(): emits `changed` once, no rev/epoch bump; callers gate"
  gotcha: on the completed-swap path, use construction-time goal, NOT setGoal

- file: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/P1M1T2S1/research/notes.md
  why: verified line-by-line research — current upsert code, state.ts seams (createInterrogationState:557, getState:564, setState:573, resetState:581, completed:410, deserialize completed:451), completion guard (completion.ts:110), panel handleUpserted wiring, test helper conventions

- file: src/tool.ts
  why: "the ONLY logic file to modify. Upsert case ~248-271; `existing` captured once at line 231 and shared by all cases — the swap happens inside the upsert case only"
  pattern: "keep the executor synchronous and UI-free (h2.0 §1) — setState + applyUpsert events are the panel trigger, no direct UI calls"
  gotcha: "read/record/reopen cases must keep using the ORIGINAL `existing` captured at line 231 — a completed state should still read/record/reopen its audit trail; ONLY the upsert case swaps"

- file: src/state.ts
  why: "singleton seams (getState/setState/resetState, createInterrogationState) and `completed` lifecycle. DO NOT touch completed/deserialize/clearForCompletion semantics — exactly-once across restart is intended (restart reconstructs completed=true; a new post-restart upsert ALSO swaps fresh, which is correct)"
  gotcha: "`snapshots` is a readonly array and goal/epoch retention in clearForCompletion is deliberate — this is exactly why the fix swaps the singleton instead of resetting in place"

- file: src/completion.ts
  why: "the guard at line 110 stays byte-identical. Also note the zero-questions predicate (line ~117): fresh state with questions upserted passes it once they're closed"
  gotcha: "do NOT 'fix' this bug in completion.ts — the fix belongs in tool.ts's upsert case per the item contract"

- file: src/completion.test.ts
  why: "pattern for the end-to-end second-interrogation test: vi.mock delivery (deliverSubmission passthrough, ~lines 40-50), makeOpts(st), closePass(), markSubmitted/closeSubmitted from merge.js, attemptCompletion assertions"
  gotcha: that suite tests completion in isolation; the PRD repro belongs in tool.test.ts driving executeInterrogate + getState

- file: src/tool.test.ts
  why: "conventions: beforeEach resetState(); seedState(goal='g') (line 60); seedQ(st,id); qi(id,{rev,...}); tuiCtx(); executeInterrogate(args, tuiCtx()); StaleError from guards.js"
  gotcha: "after completion the state singleton is the COMPLETED instance — seed the repro via the real flow (upsert → applyAnswer/markSubmitted → buildSubmission → closeSubmitted → attemptCompletion) not by hand-setting completed"

- docfile: PRD h2.2/h3.1 (BUG-002 verbatim, in this PRP's task prompt) + h2.5 recommendation "reset the singleton or the completed flag when a fresh upsert arrives on a completed state"
```

### Current Codebase tree (relevant excerpt)

```bash
src/
├── tool.ts           # MODIFY: upsert case completed-swap + Mode A comment
├── tool.test.ts      # MODIFY: failing-test-first repro + swap cases
├── state.ts          # untouched (seams already exist; S1 setGoal landed from P1.M1.T1)
├── completion.ts     # untouched (guard stays byte-identical)
├── merge.ts          # untouched (applyUpsert fires questions-upserted + changed)
├── panel/panel.ts    # untouched (verify only: handleUpserted reopens while suspended)
└── ...
```

### Desired Codebase tree

```bash
src/
├── tool.ts           # upsert case: completed-swap block before guards
└── tool.test.ts      # + ~6 new tests in the upsert describe block
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: the swap must happen BEFORE assertFresh — guards must run against
//   the state that will actually receive the upsert. On a fresh state
//   assertFresh trivially passes (epoch 1, no existing ids). Do NOT run
//   assertFresh against the completed old state first (an epoch-guard throw
//   would block a legitimate new interrogation).
// CRITICAL: goal on the swap path comes from CONSTRUCTION, never setGoal —
//   the fresh instance is created with the right goal atomically; a follow-up
//   setGoal would emit a second `changed` and misrepresent the mutation.
// GOTCHA: `existing` (tool.ts:231) is reused by read/record/reopen cases —
//   scope the swap to the upsert case; rebind a local `state` there. The S2
//   reuse-path setGoal condition must remain keyed on the ORIGINAL `existing`
//   (pre-swap) so the swapped call skips it.
// GOTCHA: `existing.serialize().goal` is a safe deep-copied read (serialize
//   structuredClones) — use it for goal retention.
// GOTCHA: do NOT call resetState() — it clears the singleton to undefined;
//   we need an INSTALLED fresh state (setState) so the same call's applyUpsert
//   and downstream read/panel flows see it.
// GOTCHA: panel wiring — applyUpsert on the NEW state fires `questions-upserted`;
//   panel.ts handleUpserted (subscribed on the instance passed at open time)
//   reopens the panel while suspended with NO open-count guard. After
//   completion the panel is already dismissed (attemptCompletion →
//   lifecycle.dismissPanel), so the normal open path (which fetches
//   getState() fresh) picks up the new singleton. VERIFY (grep, don't modify)
//   that lifecycle.ts/panel.ts read getState() at open time rather than
//   caching an instance across the swap.
// GOTCHA: the fresh state's first upsert needs NO epoch in the call (nothing
//   exists to be stale) — consistent with BUG-010 (P1.M1.T3) which only
//   requires epoch when the upsert TOUCHES EXISTING ids (none exist post-swap).
// GOTCHA: executor is synchronous and UI-free (h2.0 §1) — the swap is pure
//   state plumbing; events do all propagation.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: WRITE THE FAILING TEST FIRST (src/tool.test.ts, upsert describe block)
  - TEST "second interrogation after completion completes (BUG-002, PRD h3.1)":
    1. const st = seedState("first goal"); seedQ(st, "q1"); setState already via seedState
    2. first interrogation completes: st.applyAnswer("q1", {...}); markSubmitted(st, ["q1"]);
       closeSubmitted(st, ["q1"]) — or drive via attemptCompletion-equivalent helpers
       from completion.test.ts (vi.mock delivery there; here assert on state):
       buildSubmission/delivery NOT needed for the state-level repro — simplest:
       st.applyAnswer → markSubmitted → closeSubmitted → assert st.completed === false
       UNTIL attemptCompletion runs; use completion.test.ts's makeOpts pattern
       (import attemptCompletion) with a mocked sendMessage to fire it → expect {fired:true}
    3. executeInterrogate({ questions: [qi("n1")] }, tuiCtx())   // NEW id, no epoch
    4. answer n1 (getState().applyAnswer), markSubmitted, close pass, attemptCompletion
       → expect res.fired === true   // FAILS today: 'already-completed'
  - RUN npx vitest run src/tool.test.ts — confirm the failure is exactly reason 'already-completed'

Task 2: IMPLEMENT the completed-swap in src/tool.ts upsert case
  - Composing with S2's post-rewrite shape, insert after `capped` is computed and
    BEFORE state resolution:
      // [Mode A] SINGLETON LIFETIME / BUG-002: a completed singleton is
      // REPLACED, not reused — completion cleared its questions and its
      // `completed` guard is exactly-once by design (deserialize restores it
      // across restart; never weakened). A new-question upsert starts a NEW
      // interrogation: fresh epoch 1, completed=false, empty snapshots.
      // Goal: the upsert's capped goal when sent, else the prior goal RETAINED
      // (FR-30 — the goal anchors re-asks; a blank header helps nobody).
      // Decision (spec gap pinned; recorded in P1.M5.T2.S2).
      let state: InterrogationState;
      if (existing !== undefined && existing.completed === true) {
        state = createInterrogationState(
          parsed.action.goal !== undefined ? capped.goal : existing.serialize().goal);
        setState(state);
      } else {
        state = existing ?? createInterrogationState(
          parsed.action.goal !== undefined ? capped.goal : "");
        if (!existing) setState(state);
      }
      assertFresh(state, parsed.action);   // trivially passes on the fresh instance
      applyUpsert(state, capped.questions.map(toMergeQuestion));
      if (existing !== undefined && existing.completed !== true
          && parsed.action.goal !== undefined) state.setGoal(capped.goal);  // S2 branch, swap-excluded
  - PRESERVE: everything below (serialize, non-TUI composite, buildUpsertResult) unchanged
  - PRESERVE: read/record/reopen cases still use the ORIGINAL `existing`

Task 3: ADD swap-semantics tests (same describe block)
  - "upsert on completed state swaps in a FRESH singleton": seed + complete (as Task 1);
    executeInterrogate({questions:[qi("n1")]}) →
    const s = getState()!; expect(s.epoch).toBe(1); expect(s.completed).toBe(false);
    expect(s.snapshots.length).toBe(0); expect(s.getQuestion("n1")!.status).toBe("open");
    expect(s.orderedQuestions().map(q=>q.id)).toEqual(["n1"]);
    expect(r.details.state.epoch).toBe(1)
  - "swap RETAINS the prior goal when the upsert omits goal": complete with goal
    "first goal"; upsert n1 WITHOUT goal → getState().goal === "first goal"
  - "swap applies the CAPPED goal when sent": upsert n1 with goal "x".repeat(500)
    → getState().goal.length === 400; result content includes "goal truncated at 500 chars"
  - "swap result details carry epoch 1 and completed false": covered above; also
    r.details.state.completed === false
  - "NON-completed existing state is NOT swapped": seedState + seedQ; upsert q2
    → getState() returns the SAME instance (expect(s).toBe(st)), epoch unchanged,
    q1 still present (regression)
  - "guard untouched: deserialize-restored completed still blocks replay":
    serialize a completed state → InterrogationState.deserialize(json).completed === true
    (pins the do-not-weaken invariant)
  - (StaleError regression) "stale upsert on non-completed state still throws":
    epoch 999 upsert on seeded state → toThrow(StaleError), state unchanged

Task 4: UPDATE the Mode A doc comment on the upsert case
  - Add/replace the singleton-lifetime bullet: completed singleton is replaced
    on a new upsert (fresh epoch 1, completed=false, empty snapshots); goal
    retained unless supplied (capped); the one-time guard itself is never reset
    and deserialize keeps exactly-once-across-restart; decision pinned in
    P1.M5.T2.S2 docs.

Task 5: RUN gates
  - npx vitest run src/tool.test.ts -v   → all green
  - npm run typecheck && npm test        → all green

Task 6: VERIFY (read-only, no modification) panel/lifecycle wiring assumption
  - grep -n "getState()" src/lifecycle.ts src/panel/panel.ts src/index.ts
  - confirm the open/resume paths fetch the singleton at call time (they pick up
    the swapped instance); note the finding in the PR/commit message. If a cached
    instance is found anywhere on the open path, STOP and report — do not expand scope.
```

### Implementation Patterns & Key Details

```ts
// The swap — exact placement relative to the S2 contract (applyCaps hoisted first):
const capped = applyCaps(parsed.action.questions, parsed.action.goal ?? "",
                         config, ctx.model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW);
let state: InterrogationState;
if (existing !== undefined && existing.completed === true) {
  // BUG-002: fresh interrogation on a completed session. Constructor-atomic goal.
  state = createInterrogationState(
    parsed.action.goal !== undefined ? capped.goal : existing.serialize().goal);
  setState(state);
} else {
  state = existing ?? createInterrogationState(
    parsed.action.goal !== undefined ? capped.goal : "");
  if (!existing) setState(state);
}
assertFresh(state, parsed.action);
applyUpsert(state, capped.questions.map(toMergeQuestion));
if (existing !== undefined && existing.completed !== true
    && parsed.action.goal !== undefined) state.setGoal(capped.goal);
// PATTERN: mutation events do all propagation (questions-upserted + changed);
//          the executor stays synchronous and UI-free.
// CRITICAL: goal on the swap path is CONSTRUCTION-time, never setGoal (double
//          emit + wrong mutation story). The setGoal branch excludes swaps.
```

### Integration Points

```yaml
STATE (no changes): "createInterrogationState / getState / setState / resetState seams already exist; completed set only in clearForCompletion (state.ts:410), restored by deserialize (451) — UNTOUCHED"
COMPLETION (no changes): "guard at completion.ts:110 stays byte-identical; the fresh state's completed=false makes it pass naturally"
DOWNSTREAM:
  - P1.M1.T3.S1 (assertFresh epoch requirement): "swap-carrying upserts touch NO existing ids → exempt by construction; do not add epoch requirements for them"
  - P1.M3.T3.S2 (evaluateDependsOn after applyUpsert): "runs on the post-swap state; fresh-state path covered automatically"
  - P1.M5.T1.S1 (reconstruction): "reconstruction takes the LATEST interrogate toolResult as base — the swap upsert's details.state IS that latest result, branch-correct by construction"
  - P1.M5.T2.S2 (decisions doc): "records the pinned epoch-restart decision — this subtask only leaves the pointer comment"
NO CHANGES to: completion.ts, state.ts, merge.ts, panel/, lifecycle.ts, caps.ts, tool-schema.ts
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck     # tsc --noEmit → zero errors
```

### Level 2: Unit Tests

```bash
npx vitest run src/tool.test.ts -v   # targeted while iterating (failing test first!)
npx vitest run src/completion.test.ts -v   # guard suite must stay byte-green
npm test                             # full suite, all green
```

### Level 3: Integration (tsx probe — mirrors the PRD repro end-to-end)

```bash
npx tsx -e "
import { getState, setState } from './src/state.js';
import { executeInterrogate } from './src/tool.js';
import { attemptCompletion } from './src/completion.js';
import { buildSubmission } from './src/delivery.js';
import { closeSubmitted, markSubmitted } from './src/merge.js';
import { resetState } from './src/state.js';
resetState();
const fakeCtx = { mode: 'tui', hasUI: true, model: undefined } as any;
// interrogation 1
executeInterrogate({ goal: 'first', questions: [{ id: 'q1', prompt: 'p', type: 'choice', options: [{value:'a',label:'A'}] }] }, fakeCtx);
const s1 = getState()!; s1.applyAnswer('q1', { value: 'a', at: new Date().toISOString() });
markSubmitted(s1, ['q1']); buildSubmission(s1, [], undefined as any); closeSubmitted(s1, ['q1']);
const r1 = attemptCompletion({ sendMessage: async () => {} } as any, { ctx: fakeCtx, lifecycle: { dismissPanel: () => {} } } as any, { closed: ['q1'] } as any);
console.log('first fired:', r1);
// interrogation 2 — the bug
executeInterrogate({ questions: [{ id: 'n1', prompt: 'p2', type: 'text' }] }, fakeCtx);
const s2 = getState()!;
console.log('fresh epoch:', s2.epoch, 'completed:', s2.completed, 'goal retained:', s2.goal);
s2.applyAnswer('n1', { value: 'x', at: new Date().toISOString() });
markSubmitted(s2, ['n1']); closeSubmitted(s2, ['n1']);
const r2 = attemptCompletion({ sendMessage: async () => {} } as any, { ctx: fakeCtx, lifecycle: { dismissPanel: () => {} } } as any, { closed: ['n1'] } as any);
console.log('second fired:', r2);   // EXPECT { fired: true } — was 'already-completed'
"
# NOTE: adapt helper signatures to the actual exports (check src/delivery.ts
# buildSubmission and src/completion.ts CompletionTriggerOptions/ClosePassResult
# shapes before running); the assertion target is r2.fired === true.
```

### Level 4: Domain validation

- [ ] Mode A comment on the upsert case documents the singleton lifetime + pinned decision pointer (P1.M5.T2.S2)
- [ ] grep confirms read/record/reopen still use the original `existing`; only upsert swaps
- [ ] grep confirms panel/lifecycle open paths call getState() at open time (Task 6 finding recorded)

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green
- [ ] Failing-test-first repro written and observed failing before the fix (reason 'already-completed')
- [ ] Second interrogation completes `{fired:true}`; fresh state epoch 1 / completed=false / empty snapshots
- [ ] Goal retained when omitted; capped+warning when supplied; result details carry epoch 1
- [ ] Non-completed upserts never swap (same instance, regression green); StaleError path intact
- [ ] completion.ts:110 and state.ts completed/deserialize semantics byte-untouched (guard test pins deserialize restore)
- [ ] Only src/tool.ts + src/tool.test.ts modified; no panel/lifecycle changes
- [ ] Mode A doc comment updated

## Anti-Patterns to Avoid

- ❌ Don't reset `completed` in place or touch completion.ts/state.ts guard semantics — swap the singleton instead
- ❌ Don't run assertFresh against the OLD completed state before swapping — guards belong to the receiving state
- ❌ Don't call `resetState()` — install the fresh state with `setState`
- ❌ Don't use setGoal on the swap path — constructor-atomic goal
- ❌ Don't let the swap leak into read/record/reopen cases (they keep the original `existing`)
- ❌ Don't require an epoch on the swap-carrying upsert — no existing ids to guard (BUG-010 scope)
- ❌ Don't add panel/lifecycle wiring on speculation — verify the event path, modify nothing

---

**Confidence Score**: 9/10 — the fix site, guard, singleton seams, S1/S2 contracts, and test conventions are all verified line-by-line against the current source; the only mild uncertainty is exact `buildSubmission`/`CompletionTriggerOptions` helper signatures in the Level-3 probe (test-level only; Task 1 uses completion.test.ts's proven mock pattern instead).

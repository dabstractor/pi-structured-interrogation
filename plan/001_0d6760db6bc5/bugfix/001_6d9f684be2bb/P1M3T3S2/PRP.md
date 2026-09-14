---
name: "bugfix P1.M3.T3.S2 — tool.ts: evaluateDependsOn after every applyUpsert"
description: "Fix defect (a) of BUG-006 (PRD h2.2/h3.5): the tool's upsert path never calls evaluateDependsOn after applying an upsert (only panel answers and reconstruction do), so agent edits to dependsOn conditions leave stale moot status until the next user answer. Fix: in src/tool.ts, upsert case, immediately after `applyUpsert(state, capped.questions.map(toMergeQuestion))` (line ~292), call `evaluateDependsOn(state)` — BEFORE the FR-30 goal block and before `state.serialize()` so the digest/result reflect post-evaluation statuses. This covers BOTH create and update (fresh-state swap from P1.M1.T2.S1 AND reuse) paths since the call sits after applyUpsert on the shared `state` variable. It relies on sibling P1.M3.T3.S1's fix in depends-on.ts (empty-dependsOn moot → open reopen) — treat that PRP as implemented contract. Mock nothing; tests go in tool.test.ts using its existing fixtures (qi/seedState/seedQ/tuiCtx/printCtx, resetState in beforeEach). Comment-only docs elsewhere (FR-17 conformance); no consumer changes."
---

## Goal

**Feature Goal**: Agent edits to dependsOn conditions take effect instantly on the upsert tool result (FR-17 "evaluated locally and instantly"): every `executeInterrogate` upsert — TUI and non-TUI, fresh create, completed-swap fresh interrogation, and reuse-update — re-derives moot-ness immediately after `applyUpsert`.

**Deliverable**: One-line call + Mode A comment in `src/tool.ts` upsert case; new tests in `src/tool.test.ts`.

**Success Definition**: Bug-report repro passes end-to-end through the tool: upsert dep(choice) + child(dependsOn dep equals sqlite), record dep=pg → next upsert re-evaluates so the child arrives moot in the SAME tool result; agent re-upserts child without dependsOn → child open in that result. `npm run typecheck` + `npm test` green.

## Why

FR-17 requires instant local evaluation. Every other mutation path already calls `evaluateDependsOn` (panel/actions.ts:249, panel/ripple-confirm.ts:129, delivery.ts:350, reconstruct.ts:368) — the tool upsert path is the only mutation path missing it, so agent-side dependsOn edits (adding a condition to a currently-open question, removing one from a moot question) leave stale statuses until the next user answer. With P1.M3.T3.S1's empty-dependsOn reopen fix in place, wiring this call also delivers the removed-dependency repair end-to-end.

## What

### Exact edit — `src/tool.ts` upsert case

Current (lines ~291-296):

```ts
      // Fires `questions-upserted` + `changed` — THE panel trigger
      // (P1.M2.T2.S1 lifecycle). This executor must not open anything.
      applyUpsert(state, capped.questions.map(toMergeQuestion));

      // FR-30 (BUG-001): a goal on ANY upsert replaces the stored one —
```

Insert immediately after the `applyUpsert(...)` line:

```ts
      // BUG-006(a) / FR-17: re-derive moot-ness from the just-merged state —
      // agent edits to dependsOn conditions take effect INSTANTLY, on this
      // tool result. evaluateDependsOn is pure state logic emitting `changed`
      // only on real flips (safe for the synchronous, UI-free executor,
      // h2.0 §1). Covers create, reuse, and the completed-swap fresh path
      // (all funnel through this one applyUpsert). With P1.M3.T3.S1's
      // empty-dependsOn reopen, a moot question whose dependency was removed
      // returns to open here. Runs BEFORE serialize() so the digest and the
      // result envelope reflect post-evaluation statuses.
      evaluateDependsOn(state);
```

- Add `evaluateDependsOn` to the `./depends-on.js` import in tool.ts (delivery.ts/panel use the same module specifier pattern).
- Placement is BEFORE the goal block (`state.setGoal`) and BEFORE `const serialized = state.serialize()` — result serialization must reflect post-evaluation statuses (contract §3/§4).
- Do NOT capture or surface the returned `MootEvaluation` — no result-content changes, no other consumer changes (contract §4).
- No changes to: applyUpsert/merge.ts, depends-on.ts (P1.M3.T3.S1 owns it), read/record/reopen cases, results.ts, fallback.ts.

### Tests — `src/tool.test.ts`

Add a `describe("executeInterrogate: upsert dependsOn evaluation (BUG-006a)")` block using existing fixtures (`resetState` runs in the file's beforeEach; use `qi` for wire questions, `tuiCtx()` and `printCtx()` for both modes). Wire questions carry `dependsOn: [{ id: "dep", equals: "sqlite" }]` and options for the choice dep.

1. **Moot in the SAME result (PRD repro, TUI)**: `executeInterrogate({goal:"g", questions:[qi("dep",{type:"choice",options:[...pg,sqlite...]}), qi("child",{dependsOn:[{id:"dep",equals:"sqlite"}]})]}, tuiCtx())`. Then `markAnswered(state,"dep",{value:"pg"})` + `evaluateDependsOn(state)` → child moot. Then upsert the child again WITHOUT dependsOn (same options, `rev:2` — merge rule 1; assertFresh requires correct epoch — read it from `getState().serialize().epoch`): the tool result must show the child `open` (moot-ness re-derived inside the upsert; no manual evaluateDependsOn in the test).
2. **New condition mutes instantly**: upsert dep + child (child initially no dependsOn, rev 1, open, dep answered pg earlier). Re-upsert child WITH `dependsOn [{id:"dep",equals:"sqlite"}]` rev 2 → child arrives `moot` in that same result.
3. **Fresh completed-swap path**: complete an interrogation (existing `completeInterrogation` helper, BUG-002 pattern), then upsert dep+child with dep already moot-making via a recorded answer is impossible on a fresh state — instead: fresh-swap upsert creates dep+child; record dep=pg via the `record` action (printCtx) or `markAnswered`; re-upsert child without dependsOn (rev 2, epoch from state) → child open in the result. (Proves the call sits on the shared post-applyUpsert path, not only the reuse branch.)
4. **Non-TUI digest reflects evaluation**: same scenario as test 1 but through `printCtx()` — the fallback digest's child line shows `open` after the removed-dependency upsert.

### Success Criteria

- [ ] `evaluateDependsOn(state)` called immediately after `applyUpsert` in the upsert case (both create and update reach it).
- [ ] Digest/serialization is computed after evaluation — statuses in tool results are post-evaluation.
- [ ] Tests 1-4 pass; no result-content format changes beyond reflected statuses.
- [ ] No changes outside `src/tool.ts` (comment/import/call) and `src/tool.test.ts`.

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the exact insertion point in tool.ts's upsert case, the execution-order facts (assertFresh → applyUpsert → [NEW evaluateDependsOn] → setGoal → serialize → result), the sibling S1 contract, and the existing test fixture conventions. All below.

### Documentation & References

```yaml
- file: src/tool.ts
  why: THE file. Upsert case spans ~lines 258-315: caps → singleton create/swap (BUG-002 shape from P1.M1.T2.S1) → assertFresh → applyUpsert (line 292) → setGoal block → serialize() → TUI buildUpsertResult / non-TUI fallback composite. Insert the call between applyUpsert and the goal block.
  gotcha: the executor must stay synchronous and UI-free (h2.0 §1) — evaluateDependsOn is pure state logic (setStatus only), safe. Do not open panels or call deps hooks here. StaleError from assertFresh already threw before this point.

- file: src/depends-on.ts
  why: evaluateDependsOn(state): MootEvaluation — READ-ONLY for this task (P1.M3.T3.S1 owns the empty-dependsOn reopen edit). Per its contract it emits one `changed` per real flip and nothing otherwise, so no-op upserts stay event-silent.
  gotcha: SKIP_EVALUATION (withdrawn/closed) is handled inside evaluateDependsOn — nothing extra needed at the call site.

- file: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/P1M3T3S1/PRP.md
  why: SIBLING CONTRACT — assume implemented exactly as written: after S1, evaluateDependsOn reopens a currently-moot question whose dependsOn is absent/[] to open. This task depends on that behavior for the removed-dependency repro.
  gotcha: do NOT re-implement or modify anything in depends-on.ts here.

- file: src/tool.test.ts
  why: test conventions — beforeEach(resetState); qi(id, overrides) wire-question factory (line 55); seedState/seedQ; tuiCtx()/printCtx() executor stubs (lines 74-82); existing BUG-002 swap tests at lines 273-345 show how to read epoch and re-upsert with rev+1.
  gotcha: assertFresh (P1.M1.T3.S1) rejects upserts touching existing ids without the correct epoch — always echo the epoch read from getState().serialize().epoch, and carry the current rev on re-upserted questions.

- docfile: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/prd_snapshot.md
  why: PRD h2.2/h3.5 (BUG-006) and h2.5 recommendation "Run evaluateDependsOn after every applyUpsert".
```

### Current Codebase tree (relevant excerpt)

```bash
src/
  tool.ts           # MODIFY: import + evaluateDependsOn(state) after applyUpsert + comment
  tool.test.ts      # MODIFY: new describe block, tests 1-4
  depends-on.ts     # read-only (P1.M3.T3.S1 contract)
  merge.ts          # read-only (applyUpsert semantics)
  guards.ts         # read-only (assertFresh/StaleError — epoch discipline in tests)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: call evaluateDependsOn BEFORE `state.serialize()` — both the TUI
// result and the non-TUI fallback digest/envelope derive from the serialized
// snapshot; evaluation after serialization would ship stale statuses.
// GOTCHA: place it after applyUpsert but before state.setGoal — setGoal emits
// its own `changed` and the ordering of those events is contractual per
// tool.ts comments; evaluateDependsOn emits nothing on no-op passes.
// GOTCHA: do NOT switch on existing vs swapped state — the shared `state`
// variable already points at the receiver for all paths; one call covers both.
// GOTCHA: re-upsert tests must pass rev (current+1) and the live epoch or
// assertFresh throws StaleError (P1.M1.T3.S1) — read them from
// getState().serialize(), don't hardcode.
// GOTCHA: importing evaluateDependsOn in tool.ts does NOT make tool.ts a
// "panel" concern — reconstruct.ts/delivery.ts already import it in the
// executor's dependency layer.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/tool.ts
  - ADD `evaluateDependsOn` to the "./depends-on.js" import
  - INSERT `evaluateDependsOn(state);` with the Mode A comment immediately after applyUpsert(...) (before the FR-30 setGoal block, before serialize())

Task 2: EDIT src/tool.test.ts
  - ADD describe("executeInterrogate: upsert dependsOn evaluation (BUG-006a)") with tests 1-4 from "What"
  - FOLLOW pattern: BUG-002 swap tests (lines 273-345) for epoch/rev handling; qi() for wire questions; choice options via overrides
  - NAMING: test titles state scenario + "(BUG-006a)"

Task 3: VERIFY
  - npm run typecheck && npm test
```

### Implementation Patterns & Key Details

```ts
// upsert case tail, target shape:
assertFresh(state, parsed.action);
applyUpsert(state, capped.questions.map(toMergeQuestion));
evaluateDependsOn(state); // BUG-006(a)/FR-17 — see Mode A comment
if (existing !== undefined && existing.completed !== true && parsed.action.goal !== undefined) {
  state.setGoal(capped.goal);
}
const serialized = state.serialize(); // post-evaluation
```

### Integration Points

```yaml
SIBLING: P1.M3.T3.S1 (depends-on.ts empty-dependsOn reopen) — REQUIRED for the
  removed-dependency reopen to fire; already wired once this call lands.
NO other consumer changes: panel hooks, delivery.ts, reconstruct.ts keep their
  own calls (idempotent — later no-op passes emit zero events).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # zero errors
```

### Level 2: Unit Tests

```bash
npx vitest run src/tool.test.ts -v
npm test            # full suite green
```

### Level 3: Integration — scripted probe (optional)

```bash
npx tsx -e '<repro: seed dep+child, answer dep=pg, evaluate → moot; re-upsert child sans dependsOn via executeInterrogate; assert state child open>'
```
Level 2 test 1 asserts the same thing; only run if extra confidence is wanted.

## Final Validation Checklist

- [ ] `npm run typecheck` clean; `npm test` all green.
- [ ] evaluateDependsOn runs after applyUpsert on create, reuse, and completed-swap paths.
- [ ] Tool results (TUI and non-TUI) show post-evaluation statuses (removed dep → open; new dep → moot, same result).
- [ ] No result-format changes beyond reflected statuses; no other files touched.
- [ ] Sibling S1 not duplicated or conflicted (depends-on.ts untouched).

## Anti-Patterns to Avoid

- ❌ Don't call evaluateDependsOn after `serialize()` — stale digest.
- ❌ Don't surface MootEvaluation in tool output or add result fields — contract §4 says no consumer changes.
- ❌ Don't special-case the swap path with a second call — one shared-path call covers both.
- ❌ Don't edit depends-on.ts, merge.ts, panel files, or reconstruct.ts.
- ❌ Don't mock evaluateDependsOn in tests — real state, real evaluation (existing convention).

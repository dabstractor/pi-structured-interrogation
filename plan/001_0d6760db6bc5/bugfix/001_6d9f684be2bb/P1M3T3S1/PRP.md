# PRP — bugfix P1.M3.T3.S1: depends-on.ts reopens moot questions whose dependsOn was removed/emptied

---
name: "bugfix P1.M3.T3.S1 — depends-on.ts: empty-dependsOn moot → open reopen"
description: "Fix the (b) half of BUG-006 (bug report h2.2/h3.5, Issue 6): evaluateDependsOn (src/depends-on.ts ~line 163-164) skips questions with empty/absent dependsOn (`if (!q.dependsOn || q.dependsOn.length === 0) continue;`), so a moot question whose dependency the agent REMOVED in a re-upsert can never return to open — it stays greyed moot forever despite having no conditions. Fix: in the empty-dependsOn case, if status === 'moot', setStatus(id, 'open') and push to `reopened` (a removed dependency is the degenerate always-met case per the h2.38 're-met → moot→open' edge). All other statuses: continue unchanged. SKIP_EVALUATION = {withdrawn, closed} stays BEFORE the moot check (terminal statuses never un-terminalize from here). Do NOT touch dependencyMet (equals/notEquals compare raw answer.value by design). MootEvaluation return shape {mootered, reopened} unchanged. Mode A JSDoc update on evaluateDependsOn. Pure test additions in depends-on.test.ts using existing raw-primitive fixture conventions. The sibling (a) half — calling evaluateDependsOn after applyUpsert in tool.ts — is P1.M3.T3.S2, NOT this task."
---

## Goal

**Feature Goal**: `evaluateDependsOn(state)` fully re-derives moot-ness INCLUDING the removed-dependency case: a question that is currently `moot` whose `dependsOn` is now absent or `[]` reopens to `open` (h2.38 re-met edge — an empty dependency list is trivially met). Bug-report repro (h2.2/h3.5): dep=pg → child moot; agent re-upserts child WITHOUT dependsOn; `evaluateDependsOn` → child must be `open`.

**Deliverable**: One behavioral edit + Mode A JSDoc update in `src/depends-on.ts` `evaluateDependsOn` (~lines 160-190); new test cases in `src/depends-on.test.ts`.

**Success Definition**: The repro passes: `evaluateDependsOn` reopens (status `open`, id in `reopened`, one `changed` event) any currently-`moot` question whose `dependsOn` is `undefined` or `[]`; empty-dependsOn questions in any OTHER status are untouched (no events); withdrawn/closed stay skipped even with empty dependsOn; a second pass is a no-op (idempotence preserved); `npm run typecheck` + `npm test` green.

## Why

FR-17 ("conditions evaluated locally and instantly") and the h2.38 state machine define moot → open on re-met. Removing a dependency in a re-upsert ("this question is no longer conditional") is a legitimate agent repair, and the resulting empty `dependsOn` is the degenerate always-met condition. Today the guard at depends-on.ts:163-164 skips these questions entirely, so the child stays permanently greyed `moot` with a stale reason — unaskable-looking despite having no conditions. Downstream consumers (reconstruction step 5 via reconstruct.ts:368, the panel post-answer hook, and — after P1.M3.T3.S2 — the tool upsert path) all funnel through this one function, so fixing it here fixes every caller.

## What

### Exact edit — `src/depends-on.ts` `evaluateDependsOn`

Current loop head (~lines 162-167):

```ts
for (const q of state.orderedQuestions()) {
  if (!q.dependsOn || q.dependsOn.length === 0) continue;
  if (SKIP_EVALUATION.has(q.status)) continue;
```

Replace with (order matters — SKIP_EVALUATION first, so withdrawn/closed never un-terminalize even with empty dependsOn):

```ts
for (const q of state.orderedQuestions()) {
  if (SKIP_EVALUATION.has(q.status)) continue;
  if (!q.dependsOn || q.dependsOn.length === 0) {
    // BUG-006(b): a removed/emptied dependsOn is the degenerate always-met
    // case (h2.38 re-met edge). Only a currently-moot question flips; every
    // other status is already "not moot" and stays untouched.
    if (q.status === "moot") {
      state.setStatus(q.id, "open");
      reopened.push(q.id);
    }
    continue;
  }
```

- Exactly one `setStatus` per actual flip → one `changed` event per flip (`setStatus` already emits only on real change — the existing idempotence tests must keep passing: a second pass finds status `open`, not `moot`, so zero events).
- Empty-dependsOn questions are NEVER pushed to `mootered` (they cannot be unmet).
- Do NOT modify `dependencyMet` (equals/notEquals compare raw `answer.value`, not the label — correct by design), `SKIP_EVALUATION` (`{withdrawn, closed}`), `MootEvaluation`, `computeRipple`, or any other function in the file.

### JSDoc update (Mode A) on `evaluateDependsOn`

Update the doc comment's per-question bullet list to add the empty-dependsOn rule, e.g.:

> - Empty/absent `dependsOn` (dependency removed in a re-upsert): treated as the degenerate always-met case. A currently-`moot` question reopens (`setStatus(id, "open")`, id pushed to `reopened` — h2.38 moot→open); all other statuses are skipped unchanged. `withdrawn`/`closed` are skipped before this check and never un-terminalize from here.

### Tests — `src/depends-on.test.ts` (extend the existing `describe("evaluateDependsOn — FR-17")` or add a `describe("evaluateDependsOn — removed dependencies (BUG-006b)")` block; follow existing conventions: raw primitives via the local `q(id, dependsOn?)` + `answered(value)` helpers, real `InterrogationState`, `changeCounter` for event counts, `state.setStatus(..., "moot")` to force the pre-state — NO mocks)

1. **Bug-report repro (PRD h2.2/h3.5)**: dep (choice) + child with `dependsOn: [{id:"dep", equals:"sqlite"}]`; answer dep=pg; `evaluateDependsOn` → child `moot` (in `mootered`). Then simulate the agent's repair: `child.dependsOn = undefined` (or set the question's dependsOn to `[]` via whatever state exposes — if questions are immutable through the state API, rebuild the same state minus dependsOn; the test only needs orderedQuestions() to yield the child with empty dependsOn while status is `moot`). Run `evaluateDependsOn` again → child status `open`, `result.reopened` contains the child id, `result.mootered` empty for it, `changeCounter` delta exactly 1.
2. **Idempotence**: third pass on the reopened state → `{mootered: [], reopened: []}` (or at least the child absent from both) and zero new `changed` events.
3. **Non-moot empty-dependsOn untouched**: question with no dependsOn in statuses `open`, `answered`, `submitted`, `reasked` → pass leaves statuses unchanged, zero events (guards against over-eager reopening).
4. **Terminal stays terminal**: `setStatus("wd","withdrawn")` and `setStatus("cl","closed")` on empty-dependsOn questions forced moot first? They cannot be moot+withdrawn simultaneously — set a previously-moot empty-dependsOn question to `withdrawn`, run pass → stays `withdrawn`, not reopened (SKIP_EVALUATION ordering proof).
5. **Mixed pass**: one dependency-reopened child + one still-unmet conditional child → result carries both `reopened:[reopenedId]` and `mootered:[stillMoot]` in one pass; exactly 1 flip event for the reopen (the still-moot one emits nothing — existing no-redundant-flip rule).

### Success Criteria

- [ ] Repro test 1 passes: removed-dependsOn moot child reopens to `open`.
- [ ] Only actual moot→open flips emit `changed`; no-op passes emit zero events (tests 2, 3).
- [ ] `withdrawn`/`closed` never reopen regardless of dependsOn (test 4).
- [ ] Mixed pass handles reopen + still-moot in one call (test 5).
- [ ] `dependencyMet`, `SKIP_EVALUATION`, `MootEvaluation` shape, `computeRipple` untouched.
- [ ] Mode A JSDoc documents the empty-dependsOn reopen rule.
- [ ] `npm run typecheck` + `npm test` green (including all pre-existing depends-on tests).

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the exact buggy guard location, the loop invariants (idempotence via no-redundant-setStatus, SKIP_EVALUATION semantics), how to build state in tests, and the boundary against sibling task P1.M3.T3.S2. All below.

### Documentation & References

```yaml
- file: src/depends-on.ts
  why: THE file. evaluateDependsOn loop at ~lines 158-190; the buggy guard `if (!q.dependsOn || q.dependsOn.length === 0) continue;` at ~line 163-164; SKIP_EVALUATION at line 75; setStatus usage pattern and the no-redundant-flip comments; MootEvaluation/MootReason interfaces at top.
  gotcha: reorder so SKIP_EVALUATION is checked BEFORE the empty-dependsOn branch — otherwise a moot-later-withdrawn question could never reach the skip. setStatus already emits 'changed' only on actual status change; rely on it, do not add your own event emission.

- file: src/depends-on.test.ts
  why: THE test conventions — local `q(id, dependsOn?)` Question factory (line 22), `answered(value)` (line 27), `changeCounter(state)` idempotence helper (line 35), real InterrogationState built from raw primitives, describe block "evaluateDependsOn — FR-17". Extend, don't rewrite.
  gotcha: existing tests at lines 195-230 already assert skip/terminal behavior — new tests must not contradict them; if the repro requires mutating a question's dependsOn post-construction and Question is deeply frozen/readonly, rebuild the state with the modified question instead of casting.

- file: src/state.ts
  why: InterrogationState surface used here — orderedQuestions(), setStatus(id, status) (emits one 'changed' per actual flip), getQuestion, QuestionStatus union ("open"|"answered"|"submitted"|"reasked"|"moot"|"withdrawn"|"closed"), DependsOn type.
  gotcha: setStatus validation (known id, legal status) — reopening to "open" is always legal from "moot".

- docfile: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/prd_snapshot.md
  why: bug report h2.2/h3.5 (Issue 6 / BUG-006) — full defect description + verified repro steps (PROBE2). This task is defect (b) ONLY.
  gotcha: defect (a) — tool.ts upsert path not calling evaluateDependsOn — is P1.M3.T3.S2, a separate work item. Do NOT touch tool.ts, merge.ts, reconstruct.ts here.

- file: src/reconstruct.ts (line ~368, read-only reference)
  why: existing consumer of evaluateDependsOn (reconstruction step 5) — proves the fix propagates through existing call sites with zero wiring changes.
```

### Current Codebase tree (relevant excerpt)

```bash
src/
  depends-on.ts        # MODIFY: evaluateDependsOn empty-dependsOn reopen + JSDoc
  depends-on.test.ts   # MODIFY: new test cases
  state.ts             # read-only reference (setStatus, orderedQuestions, statuses)
  reconstruct.ts       # read-only reference (existing consumer)
  tool.ts              # NOT in scope (P1.M3.T3.S2 owns the upsert-wiring half)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: check SKIP_EVALUATION (withdrawn/closed) BEFORE the empty-dependsOn
// branch — terminal statuses must never un-terminalize, even accidentally.
// GOTCHA: setStatus emits 'changed' only on a real status transition; do not
// emit events yourself, and do not call setStatus for non-moot empty-dependsOn
// questions (would break the zero-events-on-no-op invariant the panel relies on).
// GOTCHA: an empty-dependsOn question must NEVER appear in `mootered` — it
// cannot be unmet by definition.
// GOTCHA: do not "fix" dependencyMet to special-case empty arrays — the fix
// lives in the loop, and equals/notEquals raw-value comparison stays as-is.
// GOTCHA: if Question objects from orderedQuestions() are readonly in tests,
// rebuild the fixture state with the child's dependsOn omitted rather than
// mutating the returned object.
```

## Implementation Blueprint

### Data models and structure

No new types. `MootEvaluation { mootered: MootReason[]; reopened: string[] }` shape unchanged (removed-dependency reopens appear in `reopened` like any other re-met).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/depends-on.ts evaluateDependsOn
  - REORDER loop guards: SKIP_EVALUATION first, then empty-dependsOn branch (moot → setStatus(id,"open") + reopened.push; else continue)
  - PRESERVE: dependencyMet, computeRipple, MootEvaluation, SKIP_EVALUATION contents
  - UPDATE Mode A JSDoc per "What" §JSDoc

Task 2: EDIT src/depends-on.test.ts
  - ADD describe block "evaluateDependsOn — removed dependencies (BUG-006b)" with tests 1-5 from "What" §Tests
  - FOLLOW pattern: q()/answered()/changeCounter helpers, real state, no mocks
  - NAMING: test titles state the scenario, e.g. "reopens moot question whose dependsOn was removed (h2.38 re-met)"

Task 3: VERIFY
  - npm run typecheck && npm test
  - Confirm no behavior change for existing test fixtures (all pre-existing tests green unchanged)
```

### Implementation Patterns & Key Details

```ts
// The complete functional change (loop head):
for (const q of state.orderedQuestions()) {
  if (SKIP_EVALUATION.has(q.status)) continue;          // moved FIRST
  if (!q.dependsOn || q.dependsOn.length === 0) {
    if (q.status === "moot") {                          // degenerate re-met
      state.setStatus(q.id, "open");                    // one 'changed' per flip
      reopened.push(q.id);
    }
    continue;                                           // never in `mootered`
  }
  // ... existing met/unmet logic unchanged below ...
```

### Integration Points

```yaml
STATE (state.ts): none — setStatus is already the sanctioned mutation primitive.
CONSUMERS (no changes needed): reconstruct.ts step 5, panel post-answer hook —
  they call evaluateDependsOn and now get removed-dependency reopens for free.
NEXT (P1.M3.T3.S2, sibling): wires evaluateDependsOn AFTER applyUpsert in
  tool.ts — depends on this fix being in place to actually reopen.
NOT in scope: tool.ts, merge.ts, reconstruct.ts, any panel file.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck    # zero errors
```

### Level 2: Unit Tests

```bash
npx vitest run src/depends-on.test.ts -v
npm test             # full suite green
```

### Level 3: Integration — SCRIPTED ONLY

> The bug-report repro (PROBE2) is fully covered by Level 2 test 1: build state, moot the child, empty its dependsOn, evaluate, assert open. No live pi session needed. If desired, a tsx one-off probe mirroring the bug-report steps may be run but adds nothing the vitest case doesn't assert.

### Level 4: Domain-specific

- Invariant sweep: for every QuestionStatus, an empty-dependsOn question's status after a pass is: moot→open; all others→unchanged; withdrawn/closed→unchanged (covered by tests 3-4; ensure exhaustive status coverage in the test table).

## Final Validation Checklist

- [ ] `npm run typecheck` clean; `npm test` all green (pre-existing tests untouched).
- [ ] Removed/emptied dependsOn + status moot → reopened to `open`, one `changed` event.
- [ ] All other empty-dependsOn statuses untouched; withdrawn/closed never reopen.
- [ ] No empty-dependsOn id ever lands in `mootered`; no-op passes emit zero events.
- [ ] `dependencyMet` / `computeRipple` / `MootEvaluation` / `SKIP_EVALUATION` semantics unchanged.
- [ ] Mode A JSDoc documents the empty-dependsOn reopen rule.
- [ ] No edits outside src/depends-on.ts and src/depends-on.test.ts (tool.ts wiring is P1.M3.T3.S2).

## Anti-Patterns to Avoid

- ❌ Don't call evaluateDependsOn from tool.ts here — that's the sibling task P1.M3.T3.S2.
- ❌ Don't change `dependencyMet` to treat empty arrays — the loop owns the fix.
- ❌ Don't emit `changed` events manually or call setStatus on non-flip paths — idempotence is contractual.
- ❌ Don't reopen `withdrawn`/`closed` questions — terminal until re-upsert, by design.
- ❌ Don't add mocks — depends-on.test.ts is deliberately mock-free (raw primitives + real state).

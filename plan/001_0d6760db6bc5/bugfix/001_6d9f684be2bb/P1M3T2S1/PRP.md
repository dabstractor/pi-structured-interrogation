# PRP — bugfix P1.M3.T2.S1: recordAnswers marks recorded ids submitted so the close pass fires

---
name: "bugfix P1.M3.T2.S1 — fallback.ts: markSubmitted(recorded) inside recordAnswers"
description: "Fix BUG-004 (bug report h2.2/h3.3, Issue 4): non-TUI (pi -p/rpc/json) interrogations never auto-close and never complete. In src/fallback.ts recordAnswers, after the applyAnswer loop and inside the existing `recorded.length > 0` guard (from P1.M3.T1.S1), call markSubmitted(state, recorded) BEFORE takeSnapshot + bumpEpoch. Then: applyAnswer loop → markSubmitted(recorded) → takeSnapshot → bumpEpoch. Recorded ids land at status 'submitted', so the h2.44 agent_settled close pass (lifecycle.ts runClosePass, no TUI guard) archives them (closed) and attemptCompletion fires the one-time completion injection (AC-11). No downstream consumer changes; tool.ts record case needs zero edits (return shape already consumed). Integration test in fallback.test.ts (or tool.test.ts) reproducing the bug-report steps: upsert → answers → close pass + attemptCompletion → {fired:true}; mixed test (recorded+ignored) stays incomplete."
---

## Goal

**Feature Goal**: Non-TUI interrogations close and complete exactly like TUI ones (FR-25 / AC-11). Recorded chat answers move to `submitted` so the `agent_settled` close pass (h2.44, `lifecycle.ts` `runClosePass`, ~line 207 — filters `status === "submitted"`) archives them and `attemptCompletion` (wired via `index.ts` `createLifecycle(pi, { onAfterClosePass: createCompletionTrigger(...) })`) injects the completion record exactly once at close.

**Deliverable**: One functional edit in `src/fallback.ts` `recordAnswers` (insert `markSubmitted(state, recorded)`), one JSDoc update, tests in `src/fallback.test.ts` (+ one integration case in `src/tool.test.ts` if its harness covers the non-TUI record path).

**Success Definition**: The bug-report repro now passes: print-mode `executeInterrogate({goal, questions:[q1]})` → `executeInterrogate({answers:[{id:"q1", value:"b"}], epoch})` → q1 status `submitted` (not `answered`) → simulate agent_settled close pass + attemptCompletion → `{fired: true, …}` with q1 `closed`. A mixed call (one recorded + one ignored) leaves the ignored question active → completion stays `{fired:false, reason:"active-questions-remain"}`. `npm run typecheck` + `npm test` green.

## Why

- Bug report h2.2/h3.3 Issue 4 (BUG-004): `recordAnswers` (fallback.ts:197–222) only calls `applyAnswer` (status `answered`); its docstring (~line 168) falsely claims "markAnswered + markSubmitted-equivalent". The close pass archives only `submitted`, so chat-recorded answers stay `answered` forever — completion unreachable in every non-TUI session.
- The completion predicate (`completion.ts` `attemptCompletion` ~line 105): `BLOCKING = {open, reasked, answered, submitted, moot}` — `answered` blocks; `submitted` blocks only until the close pass runs. The zero-question rule (`snapshots.length > 0 || epoch > 1`) is already satisfied because recordAnswers bumps the epoch.
- `debug-commands.ts:203` (TUI debug path) already calls `markSubmitted` on recorded ids — this task makes the production non-TUI path match that precedent.

## What

### Exact edit — `src/fallback.ts` `recordAnswers`

After the applyAnswer loop, inside the existing `if (recorded.length > 0)` guard (installed by P1.M3.T1.S1), insert `markSubmitted` FIRST:

```ts
if (recorded.length > 0) {
  // BUG-004: chat answers ARE the submission in non-TUI mode (h2.39 "one
  // call = one submission"). Marking recorded ids submitted lets the
  // agent_settled close pass (h2.44, lifecycle.ts) archive them and
  // attemptCompletion fire the completion injection (FR-25/AC-11).
  markSubmitted(state, recorded);
  takeSnapshot(state); // AFTER markSubmitted so the snapshot holds 'submitted'
  state.bumpEpoch();
}
```

- **Ordering is load-bearing**: `markSubmitted` BEFORE `takeSnapshot` so the ring snapshot captures status `submitted` (the pre-bump epoch state); `takeSnapshot` before `bumpEpoch` (existing rule — snapshot labels the epoch being LEFT); exactly one bump per call, `recorded.length > 0` only (S1 contract preserved).
- `markSubmitted` (merge.ts:254) validates all ids known before applying — `recorded` ids are guaranteed known (they came from `state.getQuestion`), so it cannot throw; still, keep the call inside the guard so a zero-recorded call stays side-effect-free.
- **Import**: `import { markSubmitted } from "./merge.js"` in fallback.ts.

### JSDoc update (Mode A)

Rewrite the recordAnswers docstring paragraph (~line 168) to finally be true: "recorded ids are marked `submitted` (h2.39): one `answers[]` call collapses apply + the delivery step into one submission — the next `agent_settled` close pass archives them (closed) and the completion trigger fires. Buckets {recorded, unknown, ignored} per P1.M3.T1.S1. Epoch rule: one markSubmitted+snapshot+bump iff recorded.length > 0." Keep the GUARD ORDERING CONTRACT paragraph verbatim (assertFresh before; no epoch re-check here).

### Integration test (the PRD h2.2/h3.3 repro)

In `src/fallback.test.ts` (real InterrogationState, no mocks — existing convention), and/or tool.test.ts if it can drive executeInterrogate with a print-mode ctx:

1. Happy path: upsert q1 (choice, 2 options) → `recordAnswers(state, [{id:"q1", value:"b"}])` → assert q1.status === `"submitted"` → call the close-pass equivalent (`closeSubmitted(state, state.orderedQuestions().filter(q => q.status === "submitted").map(q => q.id))`) → assert q1.status === `"closed"` → call `attemptCompletion(fakePi, {...}, result)` → `{fired: true}`.
2. Mixed: q1 recordable + q2 open → record q1 → q1 submitted, q2 still open → close pass closes q1 → attemptCompletion → `{fired:false, reason:"active-questions-remain"}`.
3. Snapshot content: the pushed snapshot's q1 has status `submitted` (proves markSubmitted-before-takeSnapshot ordering).
4. Zero-side-effect preserved: all-ignored/all-unknown call → no snapshot, no epoch bump, no status changes (guards S1's contract survives).
5. Exactly-once: second attemptCompletion after fired → `{fired:false, reason:"already-completed"}`.

### Success Criteria

- [ ] Recorded ids land `submitted`; close pass archives them; attemptCompletion fires in non-TUI repro.
- [ ] Ordering: snapshot holds `submitted` status at the pre-bump epoch.
- [ ] Mixed recorded+ignored call does NOT complete (ignored question stays active).
- [ ] Zero-recorded calls still burn no epoch / push no snapshot (P1.M3.T1.S1 contract intact).
- [ ] Docstring truthful; guard-ordering paragraph preserved.
- [ ] No changes outside fallback.ts + tests.

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the current recordAnswers body (post-S1 shape with the ignored bucket and conditional snapshot/bump), markSubmitted semantics, the close-pass/completion wiring (already live in index.ts — nothing to wire), and test conventions. All anchored below.

### Documentation & References

```yaml
- file: src/fallback.ts
  why: recordAnswers (~185–225) — P1.M3.T1.S1's version already has {recorded, unknown, ignored} and `if (recorded.length > 0) { takeSnapshot; bumpEpoch }`. THIS task inserts markSubmitted(state, recorded) as the FIRST statement in that guard
  gotcha: if S1 is mid-implementation and the ignored bucket isn't there yet, WAIT/adapt: the edit target is the `recorded.length > 0` guard. Never revert S1's zero-side-effect rule
  gotcha: docstring at ~168 still claims "markSubmitted-equivalent" falsely — S1 was told to soften it; make the final version describe the REAL markSubmitted behavior

- file: src/merge.ts
  why: markSubmitted(state, ids) at line ~254 — validates-all-then-applies setStatus(id, "submitted"); also closeSubmitted (~262) for the integration test's close-pass simulation
  pattern: thin setStatus wrapper, throws only on unknown ids (impossible here)

- file: src/lifecycle.ts
  why: runClosePass (~line 207): filters status === "submitted", closeSubmitted(toClose), computes ClosePassResult. Subscribed to pi.on("agent_settled") with NO mode guard — already fires in non-TUI sessions; nothing to change
  gotcha: do NOT touch lifecycle.ts — the wiring is correct; the only missing piece was the status

- file: src/index.ts (~line 73)
  why: createLifecycle(pi, { onAfterClosePass: createCompletionTrigger(...) }) — completion trigger already wired for ALL modes; verify only, no edits

- file: src/completion.ts
  why: attemptCompletion (~line 105): completed guard → BLOCKING={open,reasked,answered,submitted,moot} predicate → zero-question rule (snapshots.length>0 || epoch>1 — recordAnswers' bump satisfies it). Test asserts reasons "active-questions-remain" and "already-completed"
  gotcha: attemptCompletion calls deliverSubmission → side effects on the pi handle; the test's fake pi ({sendMessage: vi.fn()}) must tolerate it (follow completion.test.ts's existing fake pattern)

- file: src/completion.test.ts
  why: existing fake-pi + ClosePassResult fixtures to reuse for the integration test

- file: src/fallback.test.ts
  why: mixedState() fixture + describe("recordAnswers") conventions; UPDATE existing assertions that expect status "answered" after record — they now expect "submitted" (this is the intended behavior change; check every test in that describe)

- file: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/P1M3T1S1/PRP.md
  why: CONTRACT — the return shape {recorded, unknown, ignored} and the recorded.length>0 guard this task builds on; also its note "P1.M3.T2.S1 adds markSubmitted on the recorded bucket — do not add markSubmitted here"

- file: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/prd_snapshot.md
  why: h2.2/h3.3 Issue 4 reproduction steps; h2.5 recommendation "Mark chat-recorded answers 'submitted' in recordAnswers"
```

### Current Codebase tree (relevant excerpt)

```bash
src/
  fallback.ts        # recordAnswers — THIS task's edit (one call inserted)
  fallback.test.ts   # update answered→submitted expectations + new integration tests
  merge.ts           # markSubmitted, closeSubmitted (read-only consumption)
  lifecycle.ts       # close pass (read-only — already mode-agnostic)
  completion.ts      # attemptCompletion (read-only; used in tests)
  index.ts           # wiring (verify only)
  tool.ts            # record case — NO edits needed (return shape unchanged)
```

### Known Gotchas of our codebase

```ts
// CRITICAL ordering: markSubmitted → takeSnapshot → bumpEpoch, all inside
// the recorded.length>0 guard. Snapshot must capture 'submitted' at the
// pre-bump epoch.
// GOTCHA: lifecycle's agent_settled subscription has NO TUI guard by design
// (event table) — do not add one; the fix is purely the status transition.
// GOTCHA: existing fallback.test.ts assertions on post-record status
// ("answered") MUST be updated to "submitted" — they encode the bug.
// GOTCHA: attemptCompletion triggers deliverSubmission → buildSubmission;
// on a state where recorded ids are 'submitted' (not 'answered') the diff
// logic must still see them — verify snapshots/computeEntries treats
// 'submitted' answers as present (it reads q.answer, status-independent).
// NOTE: the PRD's detect.ts mention is misdirected — detect.ts is the TUI
// round detector; non-TUI answers flow answers[] → tool.ts:366 → recordAnswers.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/fallback.ts — recordAnswers
  - ADD import: markSubmitted from "./merge.js"
  - INSERT: markSubmitted(state, recorded) as first statement inside the recorded.length>0 guard, before takeSnapshot
  - ADD: BUG-004 explanatory comment (chat answers ARE the submission in non-TUI mode)
Task 2: EDIT src/fallback.ts — JSDoc (Mode A) rewrite per What section
Task 3: EDIT src/fallback.test.ts
  - UPDATE: post-record status assertions answered → submitted (all in describe("recordAnswers"))
  - ADD: integration tests 1–5 from the What section (closeSubmitted + attemptCompletion, fake pi from completion.test.ts pattern)
Task 4: VALIDATE — npm run typecheck && npm test
```

### Implementation Patterns & Key Details

```ts
// The single functional change:
if (recorded.length > 0) {
  markSubmitted(state, recorded); // BUG-004 — BEFORE the snapshot
  takeSnapshot(state);
  state.bumpEpoch();
}
// Integration test close-pass simulation (mirror lifecycle.runClosePass):
const submitted = state.orderedQuestions().filter(q => q.status === "submitted").map(q => q.id);
closeSubmitted(state, submitted);
const result = { closed: submitted, reasked: [], remainingActive: state.orderedQuestions().filter(isActive).map(q => q.id) };
attemptCompletion(fakePi, opts, result);
```

### Integration Points

```yaml
NO wiring changes: index.ts createLifecycle/onAfterClosePass and the
agent_settled subscription already cover non-TUI — verify by reading only.
DOWNSTREAM (unchanged): tool.ts record case destructures the same return
shape; delivery/completion read status via q.answer (status-independent).
DO NOT TOUCH: lifecycle.ts, completion.ts, index.ts, merge.ts, panel/*,
tool.ts (except tests if needed).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # zero errors
```

### Level 2: Unit Tests

```bash
npx vitest run src/fallback.test.ts src/completion.test.ts
npm test            # full suite green
```

### Level 3: Bug-report repro (non-TUI probe)

```bash
# tsx probe: create state via executeInterrogate in print-mode ctx shape,
# upsert q1, record answers [{id:"q1",value:"b"}] with epoch →
# q1.status === "submitted"; run closeSubmitted + attemptCompletion →
# {fired:true}, q1 "closed". Mixed case (q2 open) → active-questions-remain.
```

## Final Validation Checklist

- [ ] `npm run typecheck` + `npm test` green
- [ ] BUG-004 repro passes: non-TUI answers → submitted → closed → completion fires once (AC-11)
- [ ] Mixed recorded+ignored stays incomplete
- [ ] Zero-recorded calls still side-effect-free
- [ ] Snapshot ordering proven (submitted status captured pre-bump)
- [ ] No files changed beyond fallback.ts + fallback.test.ts (+ optional tool.test.ts case)
- [ ] JSDoc truthful (markSubmitted now real, not "equivalent")

## Anti-Patterns to Avoid

- ❌ Don't mark ignored/unknown ids submitted — only `recorded`
- ❌ Don't move markSubmitted outside the guard (zero-side-effect rule from S1)
- ❌ Don't takeSnapshot before markSubmitted (snapshot must hold 'submitted')
- ❌ Don't touch lifecycle.ts/index.ts/completion.ts — wiring is already correct; the bug was the missing status transition
- ❌ Don't add a mode guard to agent_settled (it's deliberately mode-agnostic)

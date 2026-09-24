---
name: "BUG-003 fix — take snapshot in the agent-settled close pass so editedArchived can fire (AC-13)"
description: "Add takeSnapshot(state) to runClosePass in src/lifecycle.ts, gated on toClose.length > 0, so the ring captures 'closed' statuses at the submit epoch — making editedArchived true and the '(changed)' marker render through the REAL pipeline. Includes a real-pipeline regression test and, if trivial, converting actions.test.ts:701's manufactured baseline."
---

## Goal

**Feature Goal**: Implement fix option (a) for BUG-003: the agent-settled close pass (`runClosePass`, src/lifecycle.ts:227 area) takes a ring snapshot AFTER `closeSubmitted(state, toClose)` when `toClose.length > 0`. Result: editing an archived (closed) answer and re-submitting diffs against a baseline whose status is 'closed', so `computeDiff` sets `editedArchived: true` (src/snapshots.ts:209 `before?.status === "closed"`), rendering ` (changed)` in the model delta (src/delivery.ts:147) and the submission card (src/renderers.ts:70/177).

**Deliverable**: `src/lifecycle.ts` (one-line call + comment) + `src/lifecycle.test.ts` close-pass-snapshot tests + a REAL-PIPELINE regression test (answer → auto-submit → close pass → edit archived answer → auto-submit → assert `(changed)`), and optionally converting the manufactured closed baseline in `src/actions.test.ts:701`.

**Success Definition**: `npm test` + `npm run typecheck` green; the S1-pre-written lifecycle tests for the close-pass snapshot (see Context) now pass; a new end-to-end test exercises the real pipeline (no `state.setStatus` shortcut for the close) and observes `editedArchived === true` plus ` (changed)` in the delivery line and card; all existing direct `computeDiff` unit tests stay green.

## Why

- BUG-003 / PRD h3.2 + h2.5 recommendation 3: snapshots are only taken at submit-time sites (delivery.ts:185, fallback.ts:261), both AFTER markSubmitted → the ring never holds 'closed', so `editedArchived` is always false through production paths; the existing AC-13 test (ac-scripted.test.ts:554-635) only passes by hand-building `pre` via `state.serialize()`.
- AC-13/FR-2 promise: "Editing an archived answer re-marks it pending; next submission diff card highlights the change (`Q3: sqlite → postgres (changed)`)".
- S1 (audit, in flight / possibly landed) proved NO consumer of the ring breaks on a same-epoch 'closed' snapshot and pre-wrote the lifecycle tests this change must satisfy.

## What

1. **The change** (src/lifecycle.ts, inside `runClosePass`, immediately after `closeSubmitted(state, toClose)` and BEFORE building `result`):
   ```ts
   if (toClose.length > 0) {
     // BUG-003 (AC-13): capture the post-close state so a later edit of a
     // closed answer diffs against baseline status 'closed' → editedArchived.
     // Close pass NEVER bumps epoch — the "before bumpEpoch" ordering contract
     // applies to submit-time sites only. See takeSnapshot contract in
     // snapshots.ts (annotated by P1.M1.T3.S1 audit).
     takeSnapshot(state);
   }
   ```
   Import `takeSnapshot` from `./snapshots.js`. Gate on `toClose.length > 0` — a settle with nothing to close adds NO ring entry (idempotence of no-op settles preserved).
2. **Tests** (`src/lifecycle.test.ts`): S1's pre-written "close pass snapshot (BUG-003)" describe block should now pass as-is. If S1 landed them as `.todo`/red-by-design, activate them. They assert: after submit + settle with closable ids, ring gains one entry with `epoch === <submit epoch>` (NOT bumped) whose statuses are 'closed'; settle with nothing to close adds no snapshot; `digestSince(state, submitEpoch)` unchanged by the close-pass entry.
3. **Real-pipeline regression test** (place in `src/actions.test.ts` near the existing :701 test, or in lifecycle.test.ts if the harness fits): follow the bug-hunt repro as the spec — panel with q1 (choice a/b) + q2 → answer both → auto-submit (epoch 2) → **trigger the REAL close pass** (fire the lifecycle `agent_settled` handler / `runClosePass()` via the exported API — do NOT `state.setStatus('q1','closed')`) → edit q1 via write-in (currentId='q1', cursor to ✎ Other row, accept, type, enter) → auto-submit fires → assert the second submission's card entry has `editedArchived === true` and the delivered content line contains ` (changed)` (delivery.ts:147) and the card renders CHANGED_MARKER (renderers.ts:177).
   - The existing `src/actions.test.ts:701` test manufactures the closed baseline via `state.setStatus`. Per the contract note: **replace with the real close pass if trivial, else keep alongside** — decide by whether that test's harness has access to the lifecycle close pass (it exercises panel actions; if wiring runClosePass is more than a few lines, keep it and note why in a comment referencing this PRP).
4. **Docs**: verify `spec/state-and-persistence.md` :124-130 already reflects the close-pass snapshot (S1's doc task). If S1's docs landed, no change; if S1 pivoted or its doc edit is absent, add the 2-4 sentence passage per S1's Task 5 wording. Do not duplicate.

### Success Criteria

- [ ] `runClosePass` appends exactly one ring snapshot iff `toClose.length > 0`, at the pre-existing epoch, statuses 'closed'
- [ ] Real-pipeline test proves `editedArchived: true` → ` (changed)` in delivery content line + card, without any `state.setStatus` in the test path (except the retained legacy test if conversion was non-trivial)
- [ ] All direct `computeDiff` unit tests green; full suite green; typecheck clean
- [ ] `digestSince` output unaffected by close-pass entries (same-epoch identical-answer links contribute no segments)

## All Needed Context

### Context Completeness Check

This PRP embeds the exact insertion point, the gating condition, the downstream render sites, the test repro steps, and the S1 contract (invariant comments + pre-written tests). The implementer needs src/lifecycle.ts, src/snapshots.ts, src/delivery.ts, src/merge.ts and the test files — nothing else.

### Documentation & References

```yaml
- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/P1M1T3S1/PRP.md
  why: CONTRACT — audit of all ring consumers; conclusion: NO blocker; pre-wrote lifecycle tests + invariant comments + spec/state-and-persistence.md update
  gotcha: S1 runs in parallel — if its tests/comments/docs are absent at start, re-verify briefly with `grep -rn "takeSnapshot\|snapshots" src/lifecycle.test.ts` and land any missing invariant comment yourself, but DO NOT redo its full audit

- file: src/lifecycle.ts (runClosePass, ~:210-250)
  why: insertion point — after `closeSubmitted(state, toClose)` (:227), before building `result`
  pattern: agent_settled handler → runClosePass() → ClosePassResult; per-run flags cleared after
  gotcha: close pass NEVER bumps epoch (no ordering conflict with the takeSnapshot-before-bumpEpoch contract); keep the snapshot INSIDE the toClose.length>0 gate

- file: src/snapshots.ts
  why: takeSnapshot(state) (ring push, ring-of-10 trim); submissionBaselineOf (:43-49) reads MOST RECENT entry — after settle that's the close-pass snapshot, which is the whole fix; computeEntries editedArchived condition (~:209) `before?.status === "closed"`; digestSince tolerates same-epoch duplicates (identical-answer links → zero segments)

- file: src/merge.ts
  why: closeSubmitted(state, ids) (:282) — setStatus 'closed', throws on unknown ids (ids come from state, impossible here)
  pattern: call BEFORE takeSnapshot so the snapshot holds the closed statuses

- file: src/delivery.ts
  why: render site :147 ` (changed)` suffix on editedArchived entries in the model-visible content line; buildSubmission's own takeSnapshot at :185 is submit-time, unchanged

- file: src/renderers.ts
  why: card render :70 CHANGED_MARKER def, :177 warning-styled suffix for editedArchived entries

- file: src/actions.test.ts
  why: :701 test manufactures closed baseline via state.setStatus — replace with real close pass if trivial, else keep alongside with a comment

- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/architecture/bug-003-snapshots-changed.md
  why: root-cause analysis and the option (a)/(b)/(c) decision — (a) chosen

- file: src/lifecycle.test.ts
  why: S1's pre-written close-pass-snapshot describe block — must pass after this change
```

### Current Codebase tree (relevant slice)

```bash
src/
  lifecycle.ts   # runClosePass inside agent_settled wiring (~:227)
  snapshots.ts   # takeSnapshot / submissionBaselineOf / computeDiff / digestSince
  delivery.ts    # buildSubmission (takeSnapshot at :185), content line :147
  fallback.ts    # recordAnswers (takeSnapshot at :261, submit-time only)
  renderers.ts   # CHANGED_MARKER :70/:177
  actions.test.ts, lifecycle.test.ts, ac-scripted.test.ts
```

### Desired Codebase tree

No new files — modification of `src/lifecycle.ts` + test files only.

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: gate on toClose.length > 0 — no-op settles must not grow the ring (idempotence tests pin this)
// CRITICAL: snapshot AFTER closeSubmitted, so statuses are 'closed' in the entry
// ESM: import { takeSnapshot } from "./snapshots.js"
// Close pass never bumps epoch — do NOT add bumpEpoch anywhere near this change
// lifecycle.ts has no panel/UI imports in runClosePass — keep it that way
// In tests, drive the REAL close pass (fire agent_settled or call the exported runClosePass), not state.setStatus
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/lifecycle.ts — the one-line fix
  - IMPLEMENT: if (toClose.length > 0) takeSnapshot(state); right after closeSubmitted, with the BUG-003 comment block from "What" §1
  - IMPORT: takeSnapshot from "./snapshots.js"
  - VERIFY: S1's invariant comments (if landed) already describe this; do not duplicate prose

Task 2: ACTIVATE/verify lifecycle tests
  - RUN: npx vitest run src/lifecycle.test.ts
  - If S1's close-pass describe block is red-by-design → it must now go green; if absent, write the three cases (same-epoch closed entry / no-op settle adds nothing / digestSince unchanged)

Task 3: CREATE the real-pipeline AC-13 regression test
  - FOLLOW pattern: actions.test.ts harness (panel fixture, delivery capture) + lifecycle close pass trigger
  - REPRO (from bug hunt): q1 choice a/b + q2 → answer both → auto-submit (epoch 2) → real close pass → edit q1 via ✎ Other write-in → auto-submit → assert card entry editedArchived===true, delivered line contains " (changed)", card renders CHANGED_MARKER
  - DECISION: convert actions.test.ts:701's state.setStatus baseline to the real close pass if trivial; else keep + comment "manufactured baseline kept: harness lacks lifecycle wiring; real path covered by <new test name>"

Task 4: VERIFY docs
  - CHECK: spec/state-and-persistence.md :124-130 mentions close-pass snapshot (S1's edit). If missing, add the 2-4 sentence passage per S1 Task 5 wording.
```

### Implementation Patterns & Key Details

```ts
// The whole production diff:
   const toClose = submitted.filter(...).map((q) => q.id);
   closeSubmitted(state, toClose);
+  if (toClose.length > 0) takeSnapshot(state); // BUG-003 / AC-13 — see snapshots.ts ring contract
   const result: ClosePassResult = { ... };
```

### Integration Points

```yaml
CONSUMERS:
  - P1.M1.T3.S3 (end-to-end AC-13 acceptance proof) builds on this — its golden-path assertions must pass against the real pipeline
  - P1.M2.T3.S1 golden delta tests MUST land after this (gated per contract) — do not write them here
NO CONFIG / NO SCHEMA / NO API changes
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npx vitest run src/lifecycle.test.ts
```

### Level 2: Unit Tests

```bash
npx vitest run src/actions.test.ts src/snapshots.test.ts src/delivery.test.ts   # direct computeDiff tests stay green
npm test   # full 1224+ suite — triage any flips; ring-count-sensitive tests are the likely surface
```

### Level 3: Integration (real pipeline)

Covered by Task 3's regression test — answer → auto-submit → settle → close pass → write-in edit → auto-submit → `(changed)` observed in card + delta. No external mocks; panel/state harness only.

### Level 4: Docs

```bash
grep -n "close pass" spec/state-and-persistence.md   # confirm the passage exists (S1's or yours)
```

## Final Validation Checklist

- [ ] `npm run typecheck` + `npm test` green (ring-sensitive tests triaged, no silent skips)
- [ ] Close-pass snapshot appended iff toClose.length > 0; epoch NOT bumped; statuses 'closed'
- [ ] Real-pipeline test observes editedArchived true + ` (changed)` (delta line and card) with zero `state.setStatus` in its path
- [ ] digestSince output unaffected by close-pass entries (asserted)
- [ ] actions.test.ts:701 decision recorded (converted or kept-with-comment)
- [ ] spec/state-and-persistence.md reflects the close-pass snapshot semantics
- [ ] No epoch bumps, no UI imports, no new files beyond tests

---

## Anti-Patterns to Avoid

- ❌ Don't take the snapshot unconditionally — no-op settles must not grow the ring
- ❌ Don't snapshot BEFORE closeSubmitted (statuses would still be 'submitted')
- ❌ Don't bump epoch or touch the "before bumpEpoch" contract — the close pass never bumps
- ❌ Don't "fix" editedArchived by relaxing snapshots.ts:209 or by hand-building baselines in tests — the ring capture is the fix
- ❌ Don't write P1.M2.T3.S1 golden delta tests here (explicitly gated behind this item)
- ❌ Don't skip triaging a flipped test because "the count changed" — verify each flip is the intended ring growth

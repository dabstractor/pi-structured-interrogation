---
name: "BUG-003 prerequisite — audit snapshot-ring consumers for one-snapshot-per-epoch / submitted-only invariants"
description: "Enumerate every consumer of state.snapshots, prove (or fix) that a second same-epoch snapshot holding 'closed' statuses is safe, land the audit as invariant comments + doc updates, and pre-adjust lifecycle tests — unblocking the close-pass snapshot in P1.M1.T3.S2."
---

## Goal

**Feature Goal**: Before P1.M1.T3.S2 adds `takeSnapshot(state)` to the agent-settled close pass (fix option (a) for BUG-003, per `architecture/bug-003-snapshots-changed.md`), audit EVERY consumer of `state.snapshots` and its derived functions for two implicit invariants that the new snapshot would break: **(a) one snapshot per epoch** (close-pass snapshots share the submit epoch — no bump) and **(b) snapshots only hold 'submitted' statuses** (close-pass snapshots hold 'closed'). Adjust any consumer code/tests that would break; document the audited conclusion as invariant comments at the exact sites. If a hard blocker were found, STOP and record the pivot decision (diff archived-edit flags against pre-close state) for S2 — **this audit found NO blocker**; the PRP below encodes that conclusion and the work to codify it.

**Deliverable**:
1. Invariant comments at the four load-bearing sites: `snapshots.ts` `submissionBaselineOf` (:43-49) + `digestSince` (:294-299) + `takeSnapshot` (:175-190), `completion.ts` never-used predicate (:126-128), and the generalized `fallback.ts:260` comment.
2. `spec/state-and-persistence.md` snapshot-semantics update (~lines 124-130, where the auto-submit paragraph already mentions the ring) recording that close-pass snapshots hold 'closed' statuses at the submit epoch.
3. Pre-adjusted `src/lifecycle.test.ts` (TDD-first: expectations that a close pass with `toClose.length > 0` appends one same-epoch 'closed' snapshot — written to fail until S2 lands, OR structured as documented pending-expectation comments if S2 hasn't landed; see Task 4 for the exact mechanism).

**Success Definition**: full existing suite green at the end of THIS subtask (no behavior change yet — S2 adds the actual `takeSnapshot` call); every consumer annotated; docs state the new invariant; S2 receives an unambiguous green light (or, if implementation discovers a blocker mid-flight, a recorded pivot decision in the subtask result).

## User Persona (if applicable)

**Target User**: The implementing agent of P1.M1.T3.S2 (primary consumer of this audit); extension maintainers (invariant documentation).

**Use Case**: S2 adds one line to `runClosePass` — this item guarantees that line cannot silently corrupt stale-guard digests, completion predicates, baselines, or persistence.

**User Journey**: Auditor greps all `state.snapshots`/`submissionBaselineOf`/`digestSince`/`takeSnapshot` references → checks each against the two invariants → adjusts/tests → leaves comments → S2 implements against a proven-safe surface.

**Pain Points Addressed**: BUG-003's fix option (b)/(c) were avoided because (a) is minimal — but (a) is only safe if the ring's consumers tolerate same-epoch duplicates and non-submitted statuses. This item proves it rather than assuming it.

## Why

- PRD h2.2/h3.2 (BUG-003): `editedArchived` (snapshots.ts:209, `before?.status === "closed"`) can never fire through the real pipeline because the ring never captures the closed status — the close pass doesn't snapshot. The recommended fix (architecture/bug-003-snapshots-changed.md, option (a)) is one call site, but it introduces ring entries of a shape never seen before: same epoch as the preceding submit snapshot, statuses 'closed'.
- The `fallback.ts:260` comment ("snapshot must hold 'submitted'") reads like a ring-wide invariant; if it were, the close-pass snapshot would violate a documented contract. The audit must settle that it is a LOCAL ordering note (markSubmitted before takeSnapshot) — and rewrite it so it can't be misread again.
- Doing this audit as its own subtask keeps S2 a two-line change with a pre-proven blast radius, and keeps the end-to-end AC-13 test (S3) honest.

## What

1. **Re-run the audit yourself** (the research below is verified at planning time, but line numbers drift as parallel subtasks land — especially P1.M1.T2.S3 in panel code, which does NOT touch the ring): `grep -rn "\.snapshots\|submissionBaselineOf\|digestSince\|takeSnapshot" src --include=*.ts`. Confirm each finding in the Consumer Audit table below still holds; investigate anything NEW.
2. **Land invariant comments** (Mode A) at:
   - `snapshots.ts` `takeSnapshot` JSDoc: the ring may hold multiple snapshots per epoch; submit-time snapshots hold 'submitted', close-pass snapshots (lifecycle.ts, gated on `toClose.length > 0`) hold 'closed' at the pre-existing epoch; ordering contract "BEFORE bumpEpoch()" applies to submit-time sites only (the close pass never bumps).
   - `snapshots.ts` `submissionBaselineOf`: baseline = MOST RECENT ring entry — after agent settle that is the close-pass ('closed') snapshot, which is exactly what makes `editedArchived` fire (BUG-003/AC-13); before settle it is the submit ('submitted') snapshot.
   - `snapshots.ts` `digestSince`: consecutive same-epoch pairs with identical answers contribute zero segments (`computeEntries` fires only on `answerSignature` change), so close-pass links are digest-invisible; the `epoch >= epochFrom` filter tolerates duplicate epochs.
   - `completion.ts:126-128` never-used predicate: close-pass snapshots only exist after a submission (which already pushed one), so the predicate is safe.
   - `fallback.ts:260`: generalize the comment — "markSubmitted BEFORE takeSnapshot so THIS submit-time snapshot holds 'submitted'" + note that close-pass snapshots (lifecycle.ts) legitimately hold 'closed' (see snapshots.ts takeSnapshot contract).
3. **Adjust consumer code** — per the audit, NONE is required. If your re-audit contradicts a table row, fix that consumer TDD-first (test updated before code) and record the deviation in the subtask result.
4. **Pre-adjust `src/lifecycle.test.ts`**: add a new (initially failing or `.todo`-annotated, your call — prefer plain failing tests since S2 lands immediately after) describe "close pass snapshot (BUG-003, lands in P1.M1.T3.S2)": after a submit + `agent_settled` with closable ids, `state.snapshots` gains one entry with `epoch === <submit epoch>` (NOT bumped) whose statuses are 'closed'; a settle with nothing to close adds NO snapshot; `digestSince(state, submitEpoch)` output is unchanged by the close-pass entry. If S2 has already landed when you start, these must simply pass.
5. **Docs**: `spec/state-and-persistence.md` — extend the snapshot-semantics passage (~:124-130, the auto-submit paragraph "each submission's snapshot ring keeps the diffs correct") with 2-4 sentences: the ring also captures the agent-settled close pass (one snapshot per close pass that actually closes ids, same epoch as the submission it archives, statuses 'closed'); this is what lets post-archive edits diff as `(changed)` (AC-13); digestSince treats these links as no-ops.

### Success Criteria

- [ ] Consumer audit table re-verified against live code; every row either annotated-comment-only or explicitly adjusted (with tests)
- [ ] The five invariant comment sites landed (takeSnapshot, submissionBaselineOf, digestSince, completion predicate, fallback.ts:260)
- [ ] `spec/state-and-persistence.md` snapshot semantics updated
- [ ] lifecycle.test.ts carries the close-pass-snapshot expectations (passing if S2 landed, else red-by-design and noted in the result)
- [ ] `npm run typecheck` + `npm test` green (or only the S2-gated lifecycle tests red, explicitly flagged)
- [ ] Subtask result records: "NO hard invariant blocks the close-pass snapshot; S2 cleared to implement option (a)" — or the pivot decision if something emerged

## All Needed Context

### Context Completeness Check

This PRP embeds the full verified consumer audit (every `state.snapshots` consumer with file:line, the exact mechanism of each derived function, and why each tolerates or benefits from a same-epoch 'closed' snapshot), the S2 insertion contract, and the test surfaces. An agent needs this PRP plus the five source files — no further discovery.

### Documentation & References

```yaml
- docfile: plan/002_949db554a811/bugfix/001_c0ff03282c6f/architecture/bug-003-snapshots-changed.md
  why: "THE grounding document — verified claims table, exact code excerpts, all take-sites, fix option (a) with effects/risks, and the pre-audit consumer scan"
  critical: "fix option (a): takeSnapshot(state) in runClosePass AFTER closeSubmitted, gated on toClose.length>0; NO epoch bump; recommendation confirms no one-snapshot-per-epoch consumers were found — this PRP's audit re-proves and codifies that"

- file: src/snapshots.ts
  why: "ring mechanics — SNAPSHOT_RING_SIZE:34, submissionBaselineOf:43-49 (last entry), takeSnapshot:175-190 (BEFORE-bumpEpoch contract), computeEntries answerSignature gate :139-149, editedArchived:209, computeDiff:256-272, digestSince:294-299"
  pattern: "comment sites 1-3 all live in this file's JSDoc blocks; follow the existing dense contract-comment style"
  gotcha: "computeEntries fires ONLY on answerSignature (value+NUL+text) changes — status-only transitions produce NO entries; this is the mathematical basis for digest-safety"

- file: src/lifecycle.ts
  why: "runClosePass ~:214-243 — the S2 insertion point (after closeSubmitted at :227); this item only adds comments/tests around it, NOT the takeSnapshot call"
  gotcha: "close pass clears reaskedThisRun/submittedRun AFTER computing the result — comment placement must not suggest moving takeSnapshot before closeSubmitted"

- file: src/fallback.ts
  why: ":260 comment 'BEFORE takeSnapshot — snapshot must hold submitted' — generalize per What §2; recordAnswers itself is NOT modified"
  gotcha: "the BUG-004 fix (markSubmitted in recordAnswers) already landed here — don't disturb its rationale comment, EXTEND it"

- file: src/completion.ts
  why: "never-used predicate :126-128 (qs empty AND snapshots empty AND epoch<=1) — annotate why close-pass snapshots can't affect it"
  gotcha: "toClose.length>0 implies a prior submission implies a prior snapshot — state that implication in the comment, it's the whole safety argument"

- file: src/lifecycle.test.ts
  why: "test conventions + the S2-gated expectations to add (see What §4)"
  gotcha: "check how the suite triggers the close pass (agent_settled emission or direct runClosePass harness) and follow that pattern"

- file: spec/state-and-persistence.md
  why: "living spec — snapshot-semantics passage ~:124-130 to extend (the only place the docs claim ring semantics)"
  gotcha: "P1.M3.T2.S2 later does a spec sweep — write the passage so it's final-form, not provisional"

- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/P1M1T3S1/research/notes.md
  why: "the full consumer-by-consumer audit table with line numbers (this PRP's evidence base)"
```

### Current Codebase tree (relevant slice)

```bash
src/
  state.ts            # Snapshot type + snapshots field (:247-248); survives clearForCompletion
  snapshots.ts        # ring, submissionBaselineOf, takeSnapshot, computeDiff/digestSince, editedArchived
  lifecycle.ts        # runClosePass (close-pass insertion point for S2)
  delivery.ts         # take site :185 (buildSubmission, after markSubmitted)
  fallback.ts         # take site :261 (recordAnswers) + :260 invariant comment
  completion.ts       # never-used predicate :126-128
  guards.ts           # digestSince consumer (stale-guard digests)
  results.ts          # "inert snapshot" concept only — NOT a ring consumer
  reconstruct.ts      # replays toolResults/DiffEntry.value — not the ring
  persistence.ts      # does NOT persist the ring
  lifecycle.test.ts   # close-pass tests (S2-gated expectations land here)
spec/state-and-persistence.md  # snapshot-semantics docs (~:124-130)
```

### Desired Codebase tree

```bash
# No new files — modifications only:
src/snapshots.ts          # +3 invariant JSDoc blocks (takeSnapshot, submissionBaselineOf, digestSince)
src/completion.ts         # +predicate safety comment
src/fallback.ts           # generalized :260 comment
src/lifecycle.ts          # +insertion-point comment for S2 (no code change)
src/lifecycle.test.ts     # +close-pass-snapshot describe (S2-gated)
spec/state-and-persistence.md  # +close-pass snapshot semantics passage
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: this subtask does NOT add the takeSnapshot call — that is P1.M1.T3.S2. Adding it here steals S2's TDD red test.
// digestSince chain = [...snapshots.filter(s => s.epoch >= epochFrom).map(s => s.state), serialize()] — CONSECUTIVE PAIRS; same-epoch duplicates are filtered in, never assumed unique.
// computeEntries gate is answerSignature ONLY (value + NUL + text) — status flips ('submitted'→'closed') produce zero entries. This is why close-pass links are digest-invisible.
// Ring is in-memory only (persistence.ts never serializes it) — no disk-compat surface to audit.
// Parallel P1.M1.T2.S3 (panel.ts note-mode) does NOT touch the ring — but re-run the grep anyway; line numbers drift.
// ESM relative imports use ".js" suffix throughout.
// The actions.test.ts:701 AC-13 test manufactures its closed baseline BY HAND — it keeps passing after S2; do not "fix" it here (S3 owns the end-to-end rewrite).
```

## Implementation Blueprint

### Data models and structure

No data-model changes. The audit concerns `Snapshot { epoch, at, state }` consumers only.

### Consumer Audit (verified at planning time — re-verify before trusting)

| # | Consumer | Location | One-snapshot-per-epoch? | Submitted-only? | Action |
|---|----------|----------|------------------------|-----------------|--------|
| 1 | `submissionBaselineOf` | snapshots.ts:43-49 | Takes LAST entry — duplicate epochs fine | Wants 'closed' (that's the BUG-003 fix) | Comment only (documents intended effect) |
| 2 | `digestSince` | snapshots.ts:294-299 | `>=` filter + consecutive pairs — duplicates add no-op links | Status-only diffs produce no entries | Comment only |
| 3 | completion never-used predicate | completion.ts:126-128 | Close snapshot ⇒ prior submit snapshot ⇒ predicate already false | n/a | Comment only |
| 4 | `recordAnswers` fallback path | fallback.ts:260-261 | Own submit-time snapshot; epoch-guarded (close pass never bumps epoch) | Local ordering note, not ring-wide | Generalize comment |
| 5 | stale-guard digests | guards.ts:199, :255 | Via digestSince (row 2) | n/a | Covered by row 2 |
| 6 | `results.ts` | :7, :49, :178 | "Inert snapshot" = deep-copied results; does NOT read the ring | n/a | None |
| 7 | `reconstruct.ts` | :333 etc. | Replays mirrored toolResults / DiffEntry.value | n/a | None |
| 8 | `renderers.ts` | :70, :177 | Consumes SubmissionCardData, not the ring | n/a | None (benefits from S2) |
| 9 | `persistence.ts` | :55 | Ring never persisted | n/a | None |
| 10 | `debug-commands.ts` | :232 | Relies on buildSubmission's takeSnapshot only | n/a | None |
| 11 | remote-submit.ts:139 / panel actions.ts:145 | — | Via submissionBaselineOf (row 1) | n/a | Covered by row 1 |

**Conclusion: NO hard invariant blocks the close-pass snapshot. Option (a) is cleared for P1.M1.T3.S2.**

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: RE-RUN THE AUDIT (guards against drift from parallel subtasks)
  - RUN: grep -rn "\.snapshots\|submissionBaselineOf\|digestSince\|takeSnapshot" src --include=*.ts
  - DIFF against the Consumer Audit table above; investigate any new/changed reference
  - IF a hard blocker emerges: STOP, record the pivot decision (diff-time archived flags, option (c)) in the subtask result, skip Tasks 2-5's S2-unblocking claims

Task 2: COMMENT src/snapshots.ts (three JSDoc blocks)
  - takeSnapshot: multi-snapshot-per-epoch is legal; submit-time='submitted' (BEFORE bumpEpoch), close-time='closed' (lifecycle.ts, toClose>0, no bump)
  - submissionBaselineOf: last-entry semantics + post-settle baseline is the 'closed' snapshot (AC-13 mechanism)
  - digestSince: same-epoch no-op pairs proof (answerSignature gate)

Task 3: COMMENT src/completion.ts (:126-128) + src/fallback.ts (:260) + src/lifecycle.ts (insertion-point note near :227)
  - completion: toClose>0 ⇒ prior submission ⇒ prior snapshot ⇒ predicate safe
  - fallback: generalize to LOCAL ordering note + pointer to the close-pass contract
  - lifecycle: one comment marking where S2 adds takeSnapshot (after closeSubmitted, gated toClose.length>0)

Task 4: TESTS — src/lifecycle.test.ts
  - ADD describe "close pass snapshot (BUG-003, lands in P1.M1.T3.S2)":
    close-with-closable-ids ⇒ +1 snapshot, epoch NOT bumped, statuses 'closed';
    settle-with-nothing-to-close ⇒ +0 snapshots;
    digestSince(state, submitEpoch) unchanged across the close pass
  - RUN npm test: these are RED until S2 lands (expected — flag in the result) or GREEN if S2 already landed

Task 5: DOCS — spec/state-and-persistence.md (~:124-130)
  - EXTEND the snapshot-semantics passage per What §5 (final-form wording; P1.M3.T2.S2 will sweep, not rewrite)
```

### Implementation Patterns & Key Details

```ts
// The safety argument to encode in comments (one sentence each):
// digestSince:   computeEntries emits only on answerSignature(before) !== answerSignature(after);
//                a submitted→closed transition changes status, not answers ⇒ zero entries ⇒ no digest segment.
// baseline:      submissionBaselineOf returns snaps[snaps.length-1] — post-settle that IS the closed snapshot,
//                which is precisely the before.status === "closed" that editedArchived (snapshots.ts:209) needs.
// completion:    close-pass snapshots are gated on toClose.length > 0; toClose nonempty requires 'submitted'
//                questions, which require a prior submission, which already pushed a ring entry — the
//                never-used predicate was already false.
```

### Integration Points

```yaml
NO-CODE-BEHAVIOR-CHANGE:
  - "This subtask ships comments, tests, and docs only — production behavior identical (except the S2-gated red tests)"
UNBLOCKS:
  - "P1.M1.T3.S2: takeSnapshot in runClosePass (option (a)) — implements against the annotated invariants"
  - "P1.M1.T3.S3: end-to-end AC-13 test — rewrites ac-scripted.test.ts:554-635 to drive real submits"
DO-NOT-TOUCH:
  - "actions.test.ts:701 (manufactured-baseline AC-13 test — stays as-is, S3's concern)"
  - "fallback/delivery snapshot ordering (load-bearing for submit-time semantics)"
  - "state.ts Snapshot type / ring mechanics"
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # comments/tests only — must stay clean
```

### Level 2: Unit Tests

```bash
npm test
# Expected: everything green EXCEPT (optionally) the new S2-gated lifecycle describe, which is red-by-design
# until P1.M1.T3.S2 lands the takeSnapshot call. Flag that state explicitly in the subtask result —
# OR mark those tests .todo if your orchestrator requires a green tree between subtasks.
```

### Level 3: Integration Testing

Not applicable — no runtime behavior change in this subtask.

### Level 4: Creative & Domain-Specific Validation

```bash
# Re-verify the audit greps produce EXACTLY the consumers in the table (no stragglers):
grep -rn "\.snapshots\b" src --include=*.ts | grep -v "\.test\.ts"
grep -rn "submissionBaselineOf\|digestSince\|takeSnapshot" src --include=*.ts | grep -v "\.test\.ts"
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean
- [ ] `npm test` green (or S2-gated red tests explicitly flagged)

### Feature Validation

- [ ] Consumer audit table re-verified; every row actioned (comment or adjustment)
- [ ] Five invariant comment sites landed
- [ ] spec/state-and-persistence.md updated with close-pass snapshot semantics
- [ ] lifecycle.test.ts carries S2-gated expectations
- [ ] Subtask result records the green light (or pivot decision) for S2

### Code Quality Validation

- [ ] No production behavior changed (comments/tests/docs only)
- [ ] No snapshot take-site added or reordered
- [ ] Comments are Mode A (state the invariant + the reason, not just the rule)

### Documentation & Deployment

- [ ] fallback.ts:260 comment no longer readable as a ring-wide prohibition
- [ ] Spec passage is final-form wording
- [ ] No new dependencies, no config changes

---

## Anti-Patterns to Avoid

- ❌ Don't add the `takeSnapshot` call — that's S2's deliverable; this subtask must stay behavior-neutral
- ❌ Don't delete or rewrite the manufactured-baseline AC-13 tests — S3 owns that
- ❌ Don't "fix" digestSince/completion defensively (e.g. dedup by epoch) — the audit says they're already correct; defensive changes would mask the mechanism
- ❌ Don't trust the planning-time line numbers blindly — parallel subtasks land concurrently; re-run the greps
- ❌ Don't leave the fallback.ts:260 comment ambiguous — its current wording is exactly what made this audit necessary
- ❌ Don't mark the S2-gated tests green-by-fudge (`.skip`) without recording why — red-by-design or `.todo` with a note, never silent

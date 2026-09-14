---
name: "P1.M2.T1.S1 — buildSubmission: append post-bump epoch to the content line (BUG-003)"
description: "Small surgical fix in src/delivery.ts: line 1 of SubmissionMessage.content becomes `Submitted {k}: {list} (state epoch {n})` where n = the POST-bUMP epoch (diff.epoch + 1) — the epoch the model must echo on its next upsert to pass assertFresh in one round trip. Budget loop measures the suffixed line. All byte-exact delivery.test.ts assertions updated intentionally (TDD: new-format assertion first). details.epoch stays PRE-bump. Zero other behavior changes."
---

## Goal

**Feature Goal**: Restore the h3.6 delta contract in `buildSubmission`: the model-visible content line carries `(state epoch {n})` with the POST-bump epoch, eliminating the guaranteed STALE rejection on every submission→re-ask cycle (BUG-003).

**Deliverable**: Modified `src/delivery.ts` (~lines 145–162) + updated byte-exact assertions in `src/delivery.test.ts`.

**Success Definition**: `npm test` + `npm run typecheck` green; every byte-exact content assertion includes the epoch segment; a new regression test proves the echoed epoch passes `assertFresh` (state.epoch === n after buildSubmission, and an upsert carrying `epoch: n` is NOT stale).

## User Persona

**Target User**: The LLM agent — it reads the delta's epoch and echoes it on re-ask.

**Use Case**: User submits answers (ctrl+s) → delta arrives → model re-asks affected questions with `epoch: n` → guard passes first try (today: guaranteed STALE + wasted isError round trip).

**Pain Points Addressed**: BUG-003 — content built without any epoch; the epoch lives only in `details`, which the model never sees (card is user-only, Q2=A).

## Why

- spec/architecture.md h3.6 defines delta content as `Submitted {k}: {id→value list, changed marked} (state epoch {n})` + reminder.
- BUG-003 repro: upsert at epoch 1 → submit (state.epoch becomes 2) → model re-asks echoing epoch 1 → `STALE: session epoch is 2 (you sent 1)`. Every cycle pays this.
- P1.M1.T3.S1 (parallel, assume landed) makes `assertFresh` REQUIRE an epoch on upserts touching existing ids — a correct echoable epoch in the delta becomes the only reliable source for it.
- This is the core loop of the extension; P1.M2.T3.S1 (draft-safe submit) builds on this stable format.

## What

### Exact change in `src/delivery.ts` `buildSubmission` (~lines 129–167)

Current (line 162):

```ts
const content = `Submitted ${k}: ${k === 0 ? "(no changes)" : list}\n${SUBMISSION_REMINDER}${noteLine}`;
```

New:

1. Compute the post-bump epoch BEFORE the side-effect tail (equivalent to `state.epoch` after the bump): `const postEpoch = diff.epoch + 1;`
2. Format the line-1 suffix: `const epochSuffix = ` (state epoch ${postEpoch})`;`
3. Budget loop (~145–157): change the measurement from `` `Submitted ${k}: ${list}` `` to `` `Submitted ${k}: ${list}${epochSuffix}` `` so truncation still respects `SUBMISSION_LIST_MAX_CHARS` with the suffix folded in. The suffix is NEVER dropped (even in the single-huge-entry case where the loop cannot drop below 1 entry).
4. Content: `` `Submitted ${k}: ${k === 0 ? "(no changes)" : list}${epochSuffix}\n${SUBMISSION_REMINDER}${noteLine}` `` — the zero-change case also carries the suffix (a zero-change submit still bumps the epoch).
5. UNCHANGED: `SUBMISSION_REMINDER`, noteLine logic, `takeSnapshot(state); state.bumpEpoch();` tail order, `details` (epoch stays PRE-bump `diff.epoch` — snapshot labels and reconstruct's `submission.details.epoch >= state.epoch` filter depend on it), `customType`, `display`.
6. Update the JSDoc on `buildSubmission` (and the interface doc for `SubmissionMessage.content` if it shows an example) to show the new format and note that content's epoch is POST-bump while details.epoch is PRE-bump (one sentence each).

### TDD order (item contract, step 3)

1. First update the failing assertions in `delivery.test.ts` to the new format and add the new tests below; run `npx vitest run src/delivery.test.ts` — watch the format tests fail.
2. Then apply the delivery.ts change; watch everything pass.

### Test updates (byte-exact, all intentional)

- :88 happy path → `"Submitted 2: q1: SQLite; q2: Postgres (state epoch 2)\nConsider how these affect your other questions."` (fixture builds state at epoch 1 → post-bump 2).
- :110 → `"Submitted 2: qa: Postgres (changed); qb: new (state epoch 2)"`.
- :126–131 truncation: line 1 must still start `Submitted 30: ` and now END with the epoch segment; the `+m more` rollup sits BEFORE the suffix (change `/\+\d+ more$/` to e.g. `/\+\d+ more \(state epoch \d+\)$/`).
- :141 single-huge-entry: exact equality becomes `` `Submitted 1: q1: ${"x".repeat(SUBMISSION_LIST_MAX_CHARS * 2)} (state epoch 2)` ``; keep the `not.toContain("+1 more")` check.
- :154 zero-changes → `"Submitted 0: (no changes) (state epoch 2)\n..."`.
- :653 → `lines[0].toBe("Submitted 1: q1: SQLite (state epoch 2)")`.
- :685 → `lines[0].toBe("Submitted 0: (no changes) (state epoch 2)")` (epoch per its own fixture).
- :278 hand-built S2 transport fixture: NOT produced by buildSubmission (payload is opaque plumbing) — leave as-is.

### NEW tests

- `content_epoch_is_post_bump_and_matches_state_after_call`: after `buildSubmission`, `state.epoch === n` and content contains `(state epoch ${n})` with the SAME n; `msg.details.epoch === n - 1`.
- `echoed_epoch_passes_assertFresh_regression` (BUG-003 guard): build state via `state.upsertQuestion(...)`; submit; then call `assertFresh(state, parsed)`-equivalent — simplest: `import { assertFresh } from "./guards.js"` with a minimal parsed action `{action:{action:"upsert", epoch: n, questions:[{id, rev}]}}` shaped per src/guards.ts / src/tool-schema.ts (read guards.ts for the exact ParsedAction shape first). Must NOT throw. Same call with `epoch: n - 1` MUST throw the STALE error. If the parallel P1.M1.T3.S1 change to assertFresh has landed (epoch required on upserts touching existing ids), assert that too.

### Success Criteria

- [ ] All content lines carry ` (state epoch {n})` with post-bump n, including `(no changes)` and truncated cases
- [ ] details.epoch unchanged (pre-bump); side-effect tail unchanged; one snapshot + one bump still asserted
- [ ] Budget loop respects SUBMISSION_LIST_MAX_CHARS with suffix folded in
- [ ] Regression test: echoing content's epoch passes assertFresh; pre-bump echo throws
- [ ] `npm test` + `npm run typecheck` green; no other tests touched

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets the exact current code (quoted), the exact new format, the pre/post-bump epoch distinction with its rationale, the enumerated list of test lines to update, and the assertFresh regression recipe. No guessing.

### Documentation & References

```yaml
- file: src/delivery.ts
  why: buildSubmission lines ~129–175 (budget loop 145–157, content 162, tail 166–167, SUBMISSION_REMINDER line 43)
  pattern: keep the change surgical — 3 small edits + JSDoc sentence
  gotcha: compute postEpoch from diff.epoch + 1, NOT by reading state.epoch after the bump (state.epoch read after bumpEpoch() also works, but diff.epoch+1 keeps the value static/obvious)

- file: src/delivery.test.ts
  why: byte-exact assertions at lines 88, 110, 126-131, 141, 154, 653, 685 (update) and 278 (leave — opaque fixture); test conventions (fixtures via createInterrogationState + applyAnswer + computeDiff)
  gotcha: each fixture's starting epoch differs (state.epoch starts at 1 → post-bump 2 unless a prior submit in the same test bumped it further) — read the beforeEach/fixture before writing expected strings

- file: src/snapshots.ts
  why: SubmissionCardData.epoch semantics = next.epoch computed PRE-bump (computeDiff); DiffEntry shape
- file: src/guards.ts
  why: assertFresh + StaleError — read for the exact ParsedAction shape before writing the regression test; StaleError must be imported only in the TEST, delivery.ts does not guard

- file: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/architecture/delivery-completion.md
  why: BUG-003 confirmation (lines 20-33, 82-86); NOTE line 33 suggests PRE-bump diff.epoch — SUPERSEDED by this item's contract (post-bump) per the BUG-003 repro; use post-bump
- file: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/P1M1T3S1/PRP.md
  why: parallel change tightening assertFresh (epoch REQUIRED on upserts touching existing ids) — assume landed; makes the echoable epoch mandatory
- file: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/prd_snapshot.md (h2.2/h3.2 BUG-003, h2.5)
  why: the defect definition and repro steps
```

### Current Codebase tree (relevant slice)

```bash
src/delivery.ts          # MODIFY — buildSubmission only
src/delivery.test.ts     # MODIFY — byte-exact assertions + 2 new tests
src/snapshots.ts guards.ts state.ts   # READ-ONLY contracts
```

### Known Gotchas of our codebase & Library Quirks

```ts
// ESM: ".js" import suffixes in tests that newly import guards.js
// details.epoch MUST stay pre-bump — reconstruct.ts filters `submission.details.epoch >= state.epoch` (delivery-completion.md:71)
// snapshot label = pre-bump epoch; takeSnapshot BEFORE bumpEpoch — tail untouched
// epoch suffix is part of line 1 for the BUDGET — a suffix-naive loop lets long lists wrap past the ≤3-line budget
// the `+m more` rollup precedes the epoch suffix: "...; +4 more (state epoch 6)"
// line 278 fixture belongs to the S2 transport describe and is intentionally opaque — do not "fix" it
// a zero-change submit still bumps the epoch — its line gets the suffix too
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: UPDATE src/delivery.test.ts FIRST (TDD)
  - Rewrite the enumerated byte-exact assertions to the new format (read each fixture's epoch before writing expected n)
  - ADD the two new tests (post-bump epoch identity + assertFresh regression)
  - RUN: npx vitest run src/delivery.test.ts — format tests must FAIL

Task 2: MODIFY src/delivery.ts buildSubmission
  - postEpoch = diff.epoch + 1; epochSuffix; fold into budget-loop measurement; append to line 1 (both branches); JSDoc sentence
  - RUN: npx vitest run src/delivery.test.ts — all pass

Task 3: FULL GATE
  - npm test && npm run typecheck
```

### Implementation Patterns & Key Details

```ts
// Budget loop, folded measurement:
while (
  `Submitted ${k}: ${list}${epochSuffix}`.length > SUBMISSION_LIST_MAX_CHARS &&
  entries.length - dropped > 1
) { dropped++; list = entries.slice(0, entries.length - dropped).join("; "); }
if (dropped > 0) list += `; +${dropped} more`;
const content =
  `Submitted ${k}: ${k === 0 ? "(no changes)" : list}${epochSuffix}\n${SUBMISSION_REMINDER}${noteLine}`;
```

### Integration Points

```yaml
NONE beyond message text:
  - P1.M2.T3.S1 (draft-safe submit) builds on this stable format — do not change anything else in the content composition
  - README/spec doc updates are explicitly OUT of scope (P1.M5.T2, Mode B)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npx vitest run src/delivery.test.ts
```

### Level 2: Unit Tests

```bash
npm test   # full suite — especially guards / snapshots / reconstruct tests must stay green (details.epoch untouched)
```

### Level 3: Integration Testing

Not needed for this text-only change; the assertFresh regression test in Level 2 is the behavioral proof.

### Level 4: Domain Validation

Manual trace vs BUG-003 repro: upsert (epoch 1) → submit → content shows `(state epoch 2)` → re-ask with `epoch: 2` → no STALE (covered by the regression test).

## Final Validation Checklist

- [ ] `npm test` + `npm run typecheck` green
- [ ] Line 1 = `Submitted {k}: {list} (state epoch {n})` with POST-bump n in ALL branches (normal, changed, truncated, single-huge, zero-changes)
- [ ] details.epoch, snapshot order/bump count, reminder, NOTE line, customType/display all unchanged
- [ ] Budget loop measures the suffixed line; suffix never dropped; rollup precedes suffix
- [ ] Regression: echoed content epoch passes assertFresh; pre-bump echo throws STALE
- [ ] Only delivery.ts + delivery.test.ts modified

## Anti-Patterns to Avoid

- ❌ Don't put the PRE-bump epoch in content — that re-creates BUG-003 with a confusingly close string
- ❌ Don't change details.epoch or the snapshot/bump tail — three downstream consumers depend on them
- ❌ Don't update the opaque transport fixture at :278
- ❌ Don't widen scope (raw values = P1.M2.T2.S1; draft filtering = P1.M2.T3.S1; docs = P1.M5.T2)
- ❌ Don't skip the TDD order — write the failing assertions first

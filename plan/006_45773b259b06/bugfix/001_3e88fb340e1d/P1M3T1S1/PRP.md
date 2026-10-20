# PRP — P1.M3.T1.S1: Final changeset gate — full suite, typecheck, lint, diff vs baseline

---
name: "P1.M3.T1.S1 — Run the full gate and diff against the P1.M1.T1.S1 baseline"
description: "Verification-only task closing bugfix changeset 001_3e88fb340e1d: run npm test / npm run typecheck / npm run lint (repo root; scripts verified in package.json:34-38). Diff pass counts against the recorded P1.M1.T1.S1 baseline ({head, testFiles: 54, tests: 1624, typecheck: pass, lint: pass} — the baseline record itself was emitted in that subtask's report; head hash recorded at ITS run time, the research doc's 3a302a9 is stale). Expectation: every baseline test still green PLUS only the new tests added by P1.M1.T1.S2–S5, P1.M2.T1.S1, P1.M2.T2.S1, P1.M2.T3.S1; typecheck and lint exit 0. Any pre-existing-test failure = a regression introduced by this changeset — fix at the faulting subtask's seam, never by widening scope. Known benign: persistence.test.ts mocked 'state mirror appendEntry failed' log line; one-off flake policy: re-run once. Output: gate record {testsBefore, testsAfter, delta: only-new, typecheck, lint} consumed by P1.M3.T2's doc tasks and the changeset's validation report. No mocking; no docs."
---

## Goal

**Feature Goal**: The integrated changeset (BUG-001 full-fidelity replay, BUG-002 Other-row truncation, BUG-003 observable auto-submit confirmation, BUG-004 SURFACE-002 comment truth) is proven regression-free: full gate green, and the test-count diff against the baseline is exactly the newly added tests — nothing lost, nothing silently skipped.

**Deliverable**: A gate record `{testsBefore, testsAfter, delta: only-new, typecheck: "pass", lint: "pass", anomalies[]}` delivered in the implementing agent's report (plus, optionally, a copy at `plan/006_45773b259b06/bugfix/001_3e88fb340e1d/P1M3T1S1/research/gate-record.md` for P1.M3.T2 to cite). No source files written.

**Success Definition**: `npm test` exits 0 with baseline count + N new tests (N = the sum added by the implementing subtasks); `npm run typecheck` exit 0; `npm run lint` exit 0; every previously-green test still green; any deviation classified and resolved per the triage rules below.

## User Persona

**Target User**: The maintainer shipping the changeset and the P1.M3.T2 doc writer who must describe validated behavior truthfully.

**Use Case**: Pre-release verification: prove the four fixes landed without collateral damage, with an auditable count diff instead of "looks green".

**User Journey**: run the three gates → collect exact counts → diff vs baseline → all deltas map to new tests from the changeset's subtasks → record emitted.

**Pain Points Addressed**: Green-but-changed suites hide skipped/renamed/lost tests; a numeric diff against a recorded baseline makes regressions and silent deletions impossible to miss.

## Why

- The changeset's method (P1.M1.T1.S1's PRP): fixes are validated by comparing the final gate against a recorded baseline — "Without it, P1.M3.T1.S1 cannot distinguish newly-added tests from regressions."
- PRD h2.0's validation posture: the 1624-test suite was green throughout discovery; the fixes must keep it that way.
- P1.M3.T2's README updates cite the gate record as evidence (e.g. "restored replay fidelity" claims must point at green regression tests).

## What

### Procedure (exact)

1. **Record the run context**: `git rev-parse --short HEAD`, `git status --porcelain` (expect only plan/ bookkeeping noise; note anything else). Identify the actual baseline values: the P1.M1.T1.S1 report emitted `{head, testFiles, tests, typecheck, lint}` — its `tests` count (research-doc value 1624 across 54 files; the report's value is authoritative). **Read that report, do not trust this PRP's number** — if the recorded baseline is 1624/54, use that; if it differs, use the report.

2. **Run the gates** (repo root; scripts verified: `"test": "vitest run"`, `"typecheck": "tsc --noEmit"`, `"lint": "eslint src scripts *.ts"` — package.json:34-38):
   ```bash
   npm test 2>&1 | tee /tmp/gate-test.log
   npm run typecheck 2>&1 | tee /tmp/gate-typecheck.log
   npm run lint 2>&1 | tee /tmp/gate-lint.log
   ```

3. **Collect counts**: vitest's summary line gives `Test Files  <n> passed` and `Tests  <m> passed` (plus skipped/todo if any — those count as anomalies).

4. **Diff against baseline**:
   - `testsAfter.tests >= testsBefore.tests` (strictly greater by exactly the new-test count).
   - Enumerate the expected new tests per subtask (each implementing PRP specified TDD tests; the deltas to expect):
     - P1.M1.T1.S2/S3/S4 (DiffEntry text/custom producers + replay apply): new tests in `src/snapshots.test.ts`, `src/panel/actions.test.ts` (synthetic-entry seam), `src/reconstruct.test.ts`.
     - P1.M1.T1.S5 (end-to-end regression): a delivered-submission → reconstruction fidelity test (likely `src/reconstruct.test.ts` or a `regression-*.test.ts` file — the repo pattern per system_context.md:24).
     - P1.M2.T1.S1 (Other-row truncation): new tests in `src/panel/short-view.test.ts` (sub-60-col render budget).
     - P1.M2.T2.S1 (post-suspend notify channel): new tests in `src/panel/actions.test.ts` (+ possibly a panel seam file).
     - P1.M2.T3.S1 (comment + raw-source guard): one new guard test (reconstruct.test.ts or a dedicated file).
   - The exact per-file deltas are read from the subtask reports / `git log --stat` since the baseline head: `git diff --stat <baseline-head>..HEAD -- "src/*.test.ts"` gives the ground truth for which test files grew. Cross-check: grown files ⊆ the list above; any baseline test removed or renamed = regression-class anomaly.

5. **Triage rules** (strict):
   - **Pre-existing test failing/skipped** → regression introduced by the changeset. Locate the faulting subtask (which of the four fixes touched that seam), fix at that seam following its PRP's contract. Do NOT widen scope, do NOT delete/skip the failing test.
   - **New-test failure** → the owning subtask's implementation is wrong; fix per its PRP (its own acceptance criteria are the spec).
   - **Typecheck/lint failure** → same rule; the faulting subtask's seam.
   - **Known benign**: `src/persistence.test.ts` logs a mocked "state mirror appendEntry failed" error line in verbose mode — NOT a failure (system_context.md:12-13).
   - **Flake policy**: a one-off failure (timeout class — prior plan noted one) → re-run ONCE; reproducible = real (system_context.md:13-14).

6. **Emit the gate record**:
   ```
   GATE RECORD — changeset 001_3e88fb340e1d
   head: <final short hash>  (baseline head: <from P1.M1.T1.S1 record>)
   testsBefore: <n> (<files> files)  →  testsAfter: <m> (<files> files)
   delta: +<m-n> — ONLY new tests from: <list: snapshots.test, actions.test (synthetic seam), reconstruct.test (replay+guard), regression-*.test (e2e), short-view.test (truncation), actions.test (notify channel)>
   typecheck: pass · lint: pass
   anomalies: <none | flake-re-run-once note | fixes made at seams X, Y>
   ```
   Write a copy to `plan/006_45773b259b06/bugfix/001_3e88fb340e1d/P1M3T1S1/research/gate-record.md` (P1.M3.T2's citable evidence).

### Success Criteria

- [ ] `npm test` exit 0; test count = baseline + new-only delta; no baseline test lost/renamed/skipped.
- [ ] `npm run typecheck` exit 0; `npm run lint` exit 0.
- [ ] Delta fully attributed to the six implementing subtasks (via git diff --stat cross-check).
- [ ] Gate record emitted (report + research/gate-record.md).
- [ ] Any failure fixed at its owning subtask's seam; no scope widening; no test deletions/skips.

## All Needed Context

### Context Completeness Check

A fresh implementer has: the three verified commands, the baseline source-of-truth rule (read the P1.M1.T1.S1 report, not the stale research-doc numbers), the expected new-test inventory per subtask, the triage rules with the benign-noise and flake policies, and the record format.

### Documentation & References

```yaml
- file: package.json
  why: the gate commands (:34-38 — npm test / npm run typecheck / npm run lint); verified live

- file: plan/006_45773b259b06/bugfix/001_3e88fb340e1d/architecture/system_context.md
  why: §commands (lines ~9-14): the three commands + the benign persistence.test.ts mocked appendEntry log line + the one-off flake re-run policy

- file: plan/006_45773b259b06/bugfix/001_3e88fb340e1d/P1M1T1S1/PRP.md
  why: the baseline task's contract — the record shape {head, testFiles, tests, typecheck, lint, anomalies} and the note that the research doc's 3a302a9 head is STALE (recorded live)
  gotcha: the AUTHORITATIVE baseline numbers are in P1.M1.T1.S1's implementation REPORT (tasks.json status: Complete), not in any doc — locate it before diffing; the expected shape is 54 files / 1624 tests

- file: plan/006_45773b259b06/bugfix/001_3e88fb340e1d/P1M1T1.S2..S5, P1M2T1S1, P1M2T2S1, P1M2T3S1 PRP.md files
  why: each specifies its TDD tests — the expected-only delta inventory; P1.M2.T3.S1 (parallel) adds exactly one raw-source guard test and is comment-only otherwise

- bash: git diff --stat <baseline-head>..HEAD -- "src/*.test.ts"
  why: ground truth for which test files grew since the baseline — cross-check against the expected inventory; grown-file set must not include unrelated files

- file: src/persistence.test.ts
  why: the known benign noise source — a mocked appendEntry failure log is EXPECTED in verbose output, not an anomaly
```

### Current Codebase tree (relevant excerpt)

```bash
package.json     # gate scripts (:34-38)
src/*.test.ts    # the suite (54 files / 1624 tests at baseline)
plan/006_45773b259b06/bugfix/001_3e88fb340e1d/P1M1T1S1/  # baseline report location
```

### Desired Codebase tree

```bash
# No source changes expected (verification only).
# One research artifact: .../P1M3T1S1/research/gate-record.md
# (source edits ONLY if triage finds a regression — at the faulting seam)
```

### Known Gotchas

```ts
// The research doc's baseline numbers (54/1624, head 3a302a9) may be STALE —
//   the P1.M1.T1.S1 REPORT is authoritative; read it first.
# vitest exit code is the gate; the summary line gives the counts — parse
#   both "Test Files" and "Tests" rows.
# Skipped/todo tests are NOT green — they are anomalies (a baseline test
#   becoming skipped is a silent regression).
# The benign appendEntry log line appears in persistence.test.ts output —
#   ignore it; only exit codes and pass/fail counts matter.
# Flakes: re-run ONCE only; a reproducible failure is real.
# Fix regressions at the OWNING subtask's seam per its PRP — never delete,
# skip, or loosen a test to make the gate green.
```

## Implementation Blueprint

### Data models

None — verification. The gate record is the artifact (shape in What §6).

### Implementation Tasks (ordered)

```yaml
Task 1: RECOVER the baseline — read P1.M1.T1.S1's report for {head, testFiles, tests, typecheck, lint}; record git rev-parse HEAD now
Task 2: RUN the three gates, tee logs, collect exit codes + vitest summary counts (files + tests, plus any skipped/todo)
Task 3: DIFF — testsAfter vs testsBefore; git diff --stat on src/*.test.ts since the baseline head; attribute every grown file to one of the six implementing subtasks
Task 4: TRIAGE per the rules (regression → owning seam fix; new-test failure → owning PRP's criteria; benign/flake policies)
Task 5: RE-RUN to green if anything was fixed
Task 6: EMIT the gate record (report + research/gate-record.md) in the exact format
```

### Implementation Patterns & Key Details

```bash
# Count extraction from the vitest summary (last lines of the log):
grep -E "Test Files|Tests" /tmp/gate-test.log | tail -4
# Ground-truth delta attribution:
git diff --stat $(cat <baseline-head>)..HEAD -- 'src/*.test.ts'
```

### Integration Points

```yaml
CONSUMED:
  - P1.M1.T1.S1 baseline record (authoritative numbers)
  - the six implementing subtasks' landed code + tests (incl. parallel P1.M2.T3.S1's one guard test)
OUTPUT:
  - gate record consumed by P1.M3.T2.S1/S2 (README claims cite it) and the changeset's validation report
DO NOT: modify tests to pass; widen scope beyond the four fixes' seams
```

## Validation Loop

### Level 1–2 (this task IS the gate)

```bash
npm test && npm run typecheck && npm run lint   # all exit 0
```

### Level 3: Delta verification

```bash
git diff --stat <baseline-head>..HEAD -- 'src/*.test.ts'   # grown files ⊆ expected inventory
```

### Level 4: Not applicable — deterministic suite only (AUTOMATION-POLICY: no live TUI, no real model calls).

## Final Validation Checklist

- [ ] All three gates exit 0 on the final tree
- [ ] Baseline numbers recovered from the P1.M1.T1.S1 report (not the stale doc)
- [ ] Delta = only-new tests, each attributed to a named subtask; no lost/renamed/skipped baseline tests
- [ ] Benign noise and any one-off flake handled per policy (documented in anomalies[])
- [ ] Gate record emitted to report + research/gate-record.md
- [ ] No test deleted/skipped/loosened; any fix landed at the faulting subtask's seam

## Anti-Patterns to Avoid

- ❌ Never make the gate green by editing/deleting/skipping tests — fix the seam
- ❌ Don't diff against the research doc's numbers — the baseline report is authoritative
- ❌ Don't treat skipped/todo as passing
- ❌ Don't re-run flakes more than once or chase the benign appendEntry log line
- ❌ Don't expand into doc fixes — P1.M3.T2 owns those (it consumes this record)

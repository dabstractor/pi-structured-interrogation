# PRP — P1.M1.T1.S1: Confirm green baseline at HEAD (npm test, typecheck, lint)

## Goal

**Feature Goal**: Establish and record the authoritative green baseline before the docs-only KEYMNEMONICS-001 changeset work begins: run `npm test`, `npm run typecheck`, `npm run lint` on a clean checkout at HEAD, record exact counts, and report (never fix) any reproducible failure.

**Deliverable**: A baseline record `{head, testFiles, tests, typecheck, lint, anomalies[]}` delivered in the implementing agent's report (consumed by P1.M1.T1.S2 as a pre-condition and P1.M1.T3.S2 as the gate reference). **No files are written by this subtask.**

**Success Definition**:
- `npm test` → 54 test files / 1624 tests passed (exact counts recorded)
- `npm run typecheck` → exit 0
- `npm run lint` → exit 0
- HEAD recorded via `git rev-parse --short HEAD`
- A reproducible failure (passes on re-run once for the known flake, then fails again) is REPORTED, not fixed — the subtask stops there per PRD AC-3 discipline

## Why

Every later subtask in this changeset (keymap-conflict record refresh at P1.M1.T1.S2, README sweeps, and the final gate at P1.M1.T3.S2) needs a verified reference point: "the suite was green at {HEAD} with these counts." Docs-only changesets are validated by proving the tree state did not change behavior — impossible without a recorded baseline. The final gate (P1.M1.T3.S2) re-runs these exact commands and must observe identical counts.

## What

Read-only verification, three commands, in `/home/dustin/projects/pi-structured-interrogation`:

1. `git rev-parse --short HEAD` — record the short hash. **NOTE:** the research doc (system_context.md) records HEAD `7377318`; the tree has since moved (verified live during PRP research: HEAD is now **`eb09516`**, with the working tree clean except plan/ bookkeeping). Record the ACTUAL hash at run time, not the doc's.
2. `npm test` — expect exactly: `Test Files  54 passed (54)` / `Tests  1624 passed (1624)` (verified live during this PRP's research)
3. `npm run typecheck` — expect exit 0 (verified live)
4. `npm run lint` — expect exit 0 (verified live)

**Flake protocol**: a timeout-class failure was observed once in three runs during the research pass (src/persistence.test.ts; it also logs a benign mocked `state mirror appendEntry failed` error in verbose mode — that ERROR LINE IS EXPECTED NOISE, not a failure). If any test fails: re-run once. Pass-on-retry → record under `anomalies[]` as the known flake. Fail-twice → reproducible bug: report the exact failing test names + output and STOP (do not fix, do not proceed — P1.M1.T1.S2 must not build on a red baseline).

### Success Criteria

- [ ] HEAD hash recorded (actual, not from docs)
- [ ] Counts recorded exactly: 54 files / 1624 tests / typecheck pass / lint pass
- [ ] anomalies[] populated (empty, or the flake note, or the reproducible-failure report)
- [ ] Zero source files modified (`git status` shows only plan/ bookkeeping)

## All Needed Context

### Context Completeness Check

Verification-only subtask; no code knowledge required. All expected values below were verified live against the working tree during this PRP's research (2026, at HEAD eb09516): test 54/1624 green, typecheck exit 0, lint exit 0.

### Documentation & References

```yaml
- file: plan/006_45773b259b06/architecture/system_context.md
  why: "the research record: green at 54 files / 1624 tests, tsc + eslint exit 0; the one-off persistence.test.ts timeout flake + the benign mocked 'state mirror appendEntry failed' verbose noise"
  gotcha: "its HEAD hash (7377318) is STALE — the tree has moved; record the live hash"

- file: package.json
  why: "script definitions :35-37 — test = 'vitest run', typecheck = 'tsc --noEmit', lint = 'eslint src scripts *.ts'"

- file: plan/001_0d6760db6bc5/AUTOMATION-POLICY.md (referenced by spec h2.56)
  why: "the suite is hermetic vitest — no external services, no pi launch, no mocking needed"
```

### Current Codebase tree (relevant excerpt)

```bash
pi-structured-interrogation/   # run all commands from here
├── package.json               # scripts: test / typecheck / lint
├── src/                       # 54 *.test.ts files, hermetic
└── scripts/                   # eslint also covers scripts/ (verify-keymap-conflicts.sh's home — S2's target)
```

### Known Gotchas of our codebase & Library Quirks

```bash
# GOTCHA: vitest prints 'Test Files' and 'Tests' summary lines at the END —
#   tail the output; exit code is authoritative (vitest exits 1 on any failure).
# GOTCHA: src/persistence.test.ts may print an ERROR 'state mirror appendEntry
#   failed' line in verbose mode — it is a MOCKED path's expected log, not a
#   failure; judge by the exit code and the Tests summary only.
# GOTCHA: the known flake is timeout-class — if it fires, ONE re-run decides;
#   do not loop retries.
# GOTCHA: lint covers 'src scripts *.ts' — an untouched tree should stay
#   exit 0; if lint fails on a plan/ file it's out of scope (eslint glob
#   doesn't reach plan/).
# CRITICAL: DO NOT run any formatter/fixer, DO NOT touch src/, scripts/, or
#   README. A reproducible failure is REPORTED (exact test names + tail
#   output), never patched — per PRD AC-3, it's a bug at an existing seam.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: RECORD environment
  - cd /home/dustin/projects/pi-structured-interrogation
  - git rev-parse --short HEAD          # record
  - git status --short                  # expect clean except plan/ bookkeeping

Task 2: RUN npm test
  - capture the tail: 'Test Files' + 'Tests' summary lines and exit code
  - EXPECT 54 passed (54) / 1624 passed (1624), exit 0
  - on failure: single re-run; flake→anomalies, fail-twice→report+STOP

Task 3: RUN npm run typecheck           # expect exit 0, no output
Task 4: RUN npm run lint                # expect exit 0

Task 5: EMIT the baseline record (report only — no file writes):
  { head: "<actual-short-hash>", testFiles: 54, tests: 1624,
    typecheck: "pass", lint: "pass", anomalies: [] }
```

## Validation Loop

### Level 1–3 (this subtask IS the validation)

The three commands above are the entire deliverable. There is no code to typecheck/lint beyond what the commands themselves verify.

### Level 4: Not applicable

## Final Validation Checklist

- [ ] HEAD recorded (actual hash, not the stale doc value)
- [ ] 54 / 1624 / pass / pass recorded exactly
- [ ] anomalies[] resolved (empty or flake-note or stop-report)
- [ ] `git status` unchanged vs start (no source/doc modifications)
- [ ] No fixer, formatter, or source edit attempted under any circumstance

## Anti-Patterns to Avoid

- ❌ Don't fix a failing test, no matter how small the fix looks — report and stop
- ❌ Don't retry the flake more than once
- ❌ Don't treat the mocked persistence ERROR log line as a failure
- ❌ Don't record the research doc's stale HEAD hash
- ❌ Don't write any file (the record goes in the report; PRP/docs artifacts belong to other tasks)

---

**Confidence Score**: 10/10 — the expected values were verified live during this PRP's research (54/1624 green, typecheck 0, lint 0 at eb09516); the subtask is re-running three commands and recording numbers.

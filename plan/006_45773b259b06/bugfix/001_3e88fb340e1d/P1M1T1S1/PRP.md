# PRP — P1.M1.T1.S1: Confirm green baseline at HEAD (npm test, typecheck, lint)

## Goal

**Feature Goal**: Establish and record the authoritative green baseline before bugfix changeset 001_3e88fb340e1d begins: run `npm test`, `npm run typecheck`, `npm run lint` at HEAD, record exact counts, and report (never fix) any reproducible failure.

**Deliverable**: A baseline record `{head, testFiles, tests, typecheck, lint, anomalies[]}` delivered in the implementing agent's report — the precondition for P1.M1.T1.S2+ and the diff reference for the final gate (P1.M3.T1.S1, which expects prior counts + only newly added tests, zero regressions). **No files are written.**

**Success Definition**:
- `npm test` → 54 test files / 1624 tests passed (exact counts recorded)
- `npm run typecheck` → exit 0
- `npm run lint` → exit 0
- HEAD recorded via `git rev-parse --short HEAD`
- A reproducible failure (one re-run for the known flake, then fails again) is REPORTED and the subtask STOPS — the PRD's 4 bugs (BUG-001..004) are the only authorized work; a pre-existing red suite voids the changeset's premise

## Why

The changeset's four fixes (full-fidelity restart replay, Other-row truncation, observable auto-submit confirmation, SURFACE-002 comment truth) are validated by comparing the final gate against a recorded baseline: "green at {HEAD} with 54/1624." Without it, P1.M3.T1.S1 cannot distinguish newly-added tests from regressions. Docs-only or comment-only fixes (BUG-004) are proven behavior-neutral by identical counts.

## What

Read-only verification, in `/home/dustin/projects/pi-structured-interrogation`:

1. `git rev-parse --short HEAD` — record the hash. **NOTE:** the research doc records HEAD `3a302a9`; the tree has moved (verified live during this PRP's research: HEAD is now **`a3463cc`**, working tree clean except plan/ bookkeeping). Record the ACTUAL hash at run time.
2. `npm test` — expect exactly: `Test Files  54 passed (54)` / `Tests  1624 passed (1624)` (verified live at a3463cc)
3. `npm run typecheck` — expect exit 0 (verified live)
4. `npm run lint` — expect exit 0 (verified live)

**Flake protocol**: a one-off timeout-class failure was observed in a prior changeset; on a single failure, re-run once before concluding it is real. Also expected benign noise: `src/persistence.test.ts` logs a mocked `state mirror appendEntry failed` error in verbose mode — that ERROR LINE is expected noise from a mocked path, not a failure; judge only by exit code and the Tests summary.

### Success Criteria

- [ ] HEAD hash recorded (actual, not the doc's `3a302a9`)
- [ ] Counts recorded exactly: 54 files / 1624 tests / typecheck pass / lint pass
- [ ] anomalies[] populated (empty, flake-note, or reproducible-failure report + stop)
- [ ] Zero source files modified (`git status` unchanged except plan/ bookkeeping)

## All Needed Context

### Context Completeness Check

Verification-only subtask; no code knowledge required. All expected values were verified live during this PRP's research (at HEAD a3463cc): test 54/1624 green, typecheck exit 0, lint exit 0.

### Documentation & References

```yaml
- file: plan/006_45773b259b06/bugfix/001_3e88fb340e1d/architecture/system_context.md
  why: "the research record: green at 54/1624, script definitions, the persistence.test.ts benign mocked-error note and the prior-changeset one-off timeout flake"
  gotcha: "its HEAD hash (3a302a9) is STALE — the tree has moved; record the live hash"

- file: package.json
  why: "scripts :35-37 — test = 'vitest run', typecheck = 'tsc --noEmit', lint = 'eslint src scripts *.ts'"
```

### Current Codebase tree (relevant excerpt)

```bash
pi-structured-interrogation/   # run all commands from here
├── package.json               # scripts: test / typecheck / lint
├── src/                       # 54 hermetic *.test.ts files
└── scripts/                   # also covered by the lint glob
```

### Known Gotchas of our codebase & Library Quirks

```bash
# GOTCHA: vitest's summary lines ('Test Files' / 'Tests') print at the END —
#   tail the output; the process exit code is authoritative.
# GOTCHA: the persistence.test.ts mocked 'state mirror appendEntry failed'
#   ERROR log is EXPECTED noise — not a failure.
# GOTCHA: flake protocol = exactly ONE re-run; do not loop retries.
# CRITICAL: DO NOT fix anything. The PRD's 4 bugs are the only authorized
#   work; a reproducible baseline failure means the changeset premise is
#   broken — report exact failing test names + output and STOP.
# GOTCHA: don't run formatters/fixers; don't touch src/, scripts/, README.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: RECORD environment
  - cd /home/dustin/projects/pi-structured-interrogation
  - git rev-parse --short HEAD          # record (expect ~a3463cc or later)
  - git status --short                  # clean except plan/ bookkeeping

Task 2: RUN npm test
  - capture tail summary + exit code; EXPECT 54 passed (54) / 1624 passed (1624)
  - on failure: ONE re-run; flake→anomalies, fail-twice→report+STOP

Task 3: RUN npm run typecheck           # expect exit 0
Task 4: RUN npm run lint                # expect exit 0

Task 5: EMIT the baseline record (report only — no file writes):
  { head: "<actual-short-hash>", testFiles: 54, tests: 1624,
    typecheck: "pass", lint: "pass", anomalies: [] }
```

## Validation Loop

### Level 1–3 (this subtask IS the validation)

The three commands are the entire deliverable.

### Level 4: Not applicable

## Final Validation Checklist

- [ ] HEAD recorded (actual hash, not the stale doc value)
- [ ] 54 / 1624 / pass / pass recorded exactly
- [ ] anomalies[] resolved (empty / flake-note / stop-report)
- [ ] `git status` unchanged vs start
- [ ] No fix, formatter run, or file write of any kind

## Anti-Patterns to Avoid

- ❌ Don't fix a failing test — report and stop
- ❌ Don't retry the flake more than once
- ❌ Don't treat the mocked persistence ERROR log as a failure
- ❌ Don't record the research doc's stale HEAD hash
- ❌ Don't write any file (the record goes in the report)

---

**Confidence Score**: 10/10 — expected values verified live during this PRP's research (54/1624 green, typecheck 0, lint 0 at a3463cc); the subtask is re-running three commands and recording numbers.

# PRP — P3.M5.T1.S1: Full gate — scripted acceptance cases 1-5 + suite/typecheck/lint + static-guard audit

---

## Goal

**Feature Goal**: Run the complete P3 (Local input recovery) verification gate in one scripted,
non-interactive pass and produce an authoritative gate verdict: all five new acceptance-case
suites green, full `npm test` / `npm run typecheck` / `npm run lint` green, all five static
guards green (and the four pre-existing guard files provably unmodified), and the changeset diff
provably confined to the P3-owned src/test files.

**Deliverable**: A gate-verdict record delivered **in the implementing agent's report** (NOT a
repo file):

```json
{
  "head": "<sha>",
  "cases": { "1": {...}, "2": {...}, "3": {...}, "4": {...}, "5": {...} },
  "suite": { "testFiles": <n>, "tests": <n> },
  "typecheck": "green|fail",
  "lint": "green|fail",
  "guards": { "no-hardcoded-keys": {...}, "sidechat-cache-isolation": {...},
              "keymap-guard": {...}, "config-surface": {...}, "no-recovery-side-effects": {...} },
  "diffConfined": true,
  "anomalies": []
}
```

Each `cases[N]` entry: `{ files: [...], tests: <n>, green: bool }`. Each `guards[N]` entry:
`{ tests: <n>, green: bool, unmodified: bool }` (`unmodified` = empty `git diff --name-only`
vs the P3 base; for `no-recovery-side-effects` it is a NEW changeset file — `unmodified: "new-in-changeset"`).
The verdict is consumed by P3.M5.T1.S2 as its pre-condition. **No files are written to the
repository by this subtask** (verification only; docs are S2's).

**Success Definition**:
- All five acceptance-case suites (spec `state-and-persistence.md` §Local input recovery) pass,
  selected by exact vitest `-t` patterns, with per-case test counts recorded.
- `npm test` → whole suite passes, exact "Test Files N passed (N)" / "Tests M passed (M)" counts
  recorded; zero skipped tests.
- `npm run typecheck` → exit 0. `npm run lint` → exit 0.
- All five static-guard test files pass individually; the four pre-existing guards show an EMPTY
  diff against the P3 base commit.
- `git diff` (committed + working tree) vs the P3 base touches ONLY files in the changeset
  allow-list (§ below); `README.md`, `spec/`, `plan/`, `scripts/`, root `*.ts`, `package.json`,
  `tsconfig.json`, `vitest.config.ts` all untouched by the changeset at this gate.
- Any failure found is fixed **only at the P3-owned seams** and the gate is re-run to green —
  or the verdict is `fail` with a precise diagnosis.

## User Persona (if applicable)

**Target User**: (a) the P3.M5.T1.S2 implementing agent (consumes this verdict as its
pre-condition for the README/docs sync), (b) the human maintainer reviewing whether P3 landed.

**Use Case**: S2 must not flip the README limitations row ("memory-only drafts until local input
recovery ships") and re-word AC-9 until this gate proves cases 1-5 + suite/guards are green.

**User Journey**: gate agent runs the scripted audit → assembles the verdict record → reports it
→ S2 proceeds (or the failure is routed back to the owning seam).

**Pain Points Addressed**: no "it should work" hand-waving at milestone close; no stale README
claims; no guard silently weakened by a late fix; no unbounded diff at changeset end.

## Why

- P3 added a brand-new durable-input subsystem (capture, durability, restore, retirement,
  blank-answer rejection) across five subtasks (P3.M2.T1.S1-S3, P3.M3.T1.S1-S2, P3.M4.T1.S1-S2).
  This gate is the single point where the whole changeset is proven green before any docs claim
  it shipped.
- The AUTOMATION-POLICY (plan/001_0d6760db6bc5/AUTOMATION-POLICY.md) forbids live TUI
  verification — this gate proves every scripted-provable acceptance case via vitest over the
  real seams; interactive-only checks are deferred to the human runbook (none are in scope for
  cases 1-5; they are all state/persistence-level and fully scripted).
- Static guards protect invariants that late fixes love to break (hardcoded keys, side-chat
  cache isolation — recovery writes must be extension-local FILES: no `sendMessage`, no
  `appendEntry` of draft/composer content, no session-file writes; keymap conflicts; config
  surface). The gate re-proves them AND proves they were not edited to pass.

## What

A pure verification pass over the existing tree, in dependency order:

1. **Preflight** — confirm P3.M4 artifacts are present at HEAD (see Preconditions), resolve the
   changeset base commit, snapshot HEAD.
2. **Acceptance cases 1-5** — run each case's suite with exact `-t` selection; record counts.
3. **Full gates** — `npm test`, `npm run typecheck`, `npm run lint`.
4. **Static-guard audit** — run the five guard files; prove the four pre-existing guards have an
   empty diff vs base; confirm zero skipped tests anywhere.
5. **Diff-confinement audit** — union of committed diff and working-tree status vs the P3 base,
   restricted to repo code paths, must be ⊆ the allow-list; `README.md` absent (S2 owns it).
6. **Verdict assembly** — the JSON record above, in the report; consumed by P3.M5.T1.S2.

**Preconditions (must hold when this subtask starts — P3.M4.T1.S1 and P3.M4.T1.S2 have landed):**
- `src/blank-rejection.test.ts` exists (P3.M4.T1.S2's case-5 artifact). If missing → verdict
  `fail`, anomaly `"missing artifact: src/blank-rejection.test.ts"`, stop. Do NOT implement
  another subtask's work.
- `src/state.ts` exports `isBlankAnswerValue` and `applyAnswer` throws on blank values
  (P3.M4.T1.S1). Quick probe: `grep -n "isBlankAnswerValue" src/state.ts` is non-empty.
- `src/reconstruct.ts` contains `scrubLegacyBlankAnswers` (P3.M4.T1.S2). Same probe style.

### Success Criteria

- [ ] Cases 1-5 green with recorded per-case file/test counts
- [ ] `npm test` green, counts recorded, zero skipped
- [ ] `npm run typecheck` exit 0
- [ ] `npm run lint` exit 0
- [ ] Five guard files green; four pre-existing guards diff-empty vs base
- [ ] Diff confined to allow-list; README/spec/plan/scripts/config untouched by changeset
- [ ] Verdict record delivered in report (no repo writes by this subtask)
- [ ] Any fixes confined to P3-owned seams, documented as anomalies+fixes in the verdict

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, could they run this gate?" — Yes: every command,
file path, `describe` string, base-commit discovery command, and allow-list entry below was
verified against the working tree and git history during PRP research (see
`plan/006_45773b259b06/P3M5T1S1/research/gate-inventory.md`). The only not-yet-existing artifact
(`src/blank-rejection.test.ts`) is handled as an explicit precondition check.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- url: file://plan/001_0d6760db6bc5/AUTOMATION-POLICY.md
  why: binding automation policy — no live TUI, never call the interrogate tool, never wait for input
  critical: this gate is fully scripted (vitest/npm/git only); any "let me just open the panel"
    impulse is a policy violation and a pipeline outage, not verification

- file: spec/state-and-persistence.md
  why: §Local input recovery (:133-150) defines the five acceptance cases verbatim and the
    blank-rejection rule (:141) — the gate's source of truth
  pattern: acceptance cases listed under "**Acceptance cases (new):**" at ~:145-149
  gotcha: READ-ONLY — spec/ is part of the resolved PRD; never edit it

- file: package.json
  why: the three gate scripts — "test": "vitest run", "typecheck": "tsc --noEmit",
    "lint": "eslint src scripts *.ts"
  gotcha: run via npm run …, not ad-hoc tsc/eslint invocations, so the exact project config applies

- file: src/panel/session-restore.test.ts
  why: acceptance case 1 (describe at :247) + case 4-commit-half (:383) — P3.M3.T1.S2 artifacts
  pattern: makeSession/tmpDir harness, GROWN-walk restart; run with -t "acceptance case 1" etc.

- file: src/input-retirement.test.ts
  why: acceptance case 2 (:307) + case 3 (:353) — P3.M2.T1.S3 artifacts

- file: src/panel/retirement-sidechat.test.ts
  why: acceptance case 4-send-half (:329) — P3.M2.T1.S3 artifact

- file: src/blank-rejection.test.ts
  why: acceptance case 5 (five sections) — P3.M4.T1.S2 artifact; must exist at gate time

- file: src/reconstruct.test.ts
  why: case-5 supporting units — "replay blank guards (P3.M4.T1.S2)" + "base blank scrub" describes

- file: src/no-hardcoded-keys.test.ts
  why: static guard 1 (R5/AC-12) — source scanner, must be green AND unmodified vs base

- file: src/panel/sidechat-cache-isolation.test.ts
  why: static guard 2 (SIDECHAT-005) — main-conversation request bytes unchanged by chat activity

- file: src/keymap-guard.test.ts
  why: static guard 3 — keymap conflict guard vs pi built-ins/extensions

- file: src/config-surface.test.ts
  why: static guard 4 — AC-12 fixture round-trip + exhaustive remap, grammar drift fails loudly

- file: src/no-recovery-side-effects.test.ts
  why: static guard 5 (NEW in P3) — recovery writes are extension-local FILES: no sendMessage,
    no appendEntry of draft/composer content, no session-file writes

- file: plan/006_45773b259b06/P3M4T1S2/PRP.md
  why: the contract for what P3.M4.T1.S2 produces (in flight during this PRP's research) —
    defines src/blank-rejection.test.ts's five sections and the reconstruct.ts guards
  gotcha: treat as implemented exactly as specified; the gate consumes, never re-implements

- file: plan/006_45773b259b06/P3M5T1S1/research/gate-inventory.md
  why: this item's research note — verified describe strings, base commit, allow-list, verdict shape
```

### Current Codebase tree (run `tree` in the root of the project — or `ls`) to get an overview

```bash
# Relevant slice (61 test files expected at gate time; 60 today + blank-rejection.test.ts):
# src/
#   input-capture.ts/.test.ts      (P3.M2.T1.S1 — capture-on-edit, five editor duties)
#   input-durability.ts/.test.ts   (P3.M2.T1.S2 — atomic durable sink, monotonicity)
#   input-retirement.test.ts       (P3.M2.T1.S3 — retire/tombstone + cases 2 & 3)
#   no-recovery-side-effects.test.ts (P3.M2.T1.S3 — static scanner, guard 5)
#   input-restore.ts/.test.ts      (P3.M3.T1.S1 — seeding ladder)
#   panel/session-restore.test.ts  (P3.M3.T1.S2 — cases 1 & 4-commit-half)
#   panel/retirement-sidechat.test.ts (P3.M2.T1.S3 — case 4-send-half)
#   state.ts/.test.ts, panel/actions.ts/.test.ts, fallback.ts/.test.ts, tool.ts/.test.ts
#                                 (P3.M4.T1.S1 — applyAnswer blank guard + ingress)
#   reconstruct.ts/.test.ts, blank-rejection.test.ts (P3.M4.T1.S2 — replay scrub/skip + case 5)
#   no-hardcoded-keys.test.ts, keymap-guard.test.ts, config-surface.test.ts,
#   panel/sidechat-cache-isolation.test.ts   (pre-existing guards — must stay green + unmodified)
#   … all pre-existing interrogator modules (panel/, delivery, lifecycle, persistence, …)
# scripts/verify-keymap-conflicts.sh  (NOT part of this gate; keymap-guard.test.ts covers it)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. NO modified files (unless a gate failure is fixed at a P3-owned seam,
# in which case only allow-list files change). The deliverable is the in-report verdict:
# plan/006_45773b259b06/P3M5T1S1 → gate verdict JSON in the implementing agent's report
```

### Known Gotchas of our codebase & Library Quirks

```bash
# CRITICAL: AUTOMATION-POLICY — never call the interrogate tool, never open a live pi TUI,
# never end a turn waiting for user input. All five cases are already scripted in vitest.
# CRITICAL: vitest -t matches a SUBSTRING of the full test name (describe + test), so
#   -t "acceptance case 4" matches BOTH 4-send-half and 4-commit-half — that is desired.
# GOTCHA: base-commit discovery must be dynamic (history may be rewritten):
#   BASE=$(git log --format=%H --grep="capture-on-edit lands" -1)^   # parent of first P3 commit
#   (verified today: 11e864d "seven recovery axes resolved; capture track opens" — plan-only)
# GOTCHA: committed diff alone is NOT enough — union it with `git status --porcelain` so
#   uncommitted/untracked changeset files (e.g. a not-yet-committed blank-rejection.test.ts)
#   are audited too. Restrict both to code paths; plan/ and tasks.json are orchestrator-owned.
# GOTCHA: README.md must NOT appear in the changeset diff at THIS gate — P3.M5.T1.S2 (the
#   next subtask) owns README; its presence here means out-of-order work → record as anomaly.
# GOTCHA: vitest prints "skipped" only when nonzero — check the summary for "0 skipped" or
#   absence of the word; a guard "passing" via skip is a gate failure.
# GOTCHA: full `npm test` runtime is the whole ~61-file suite — do not parallelize shards or
#   filter it; the gate's suite verdict must be the single unfiltered `vitest run` result.
```

## Implementation Blueprint

### Data models and structure

No production code. The only "model" is the verdict record (Goal section) — plain JSON in the
report. Keep keys stable; S2 parses them.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: PREFLIGHT — preconditions, base commit, HEAD snapshot
  - RUN: ls src/blank-rejection.test.ts          # must exist (P3.M4.T1.S2 artifact)
  - RUN: grep -c "isBlankAnswerValue" src/state.ts            # > 0 (P3.M4.T1.S1)
  - RUN: grep -c "scrubLegacyBlankAnswers" src/reconstruct.ts # > 0 (P3.M4.T1.S2)
  - RUN: HEAD=$(git rev-parse --short HEAD); BASE=$(git log --format=%H --grep="capture-on-edit lands" -1)^
  - IF any precondition missing → verdict fail with anomaly, STOP (never implement others' work)

Task 2: ACCEPTANCE CASES 1-5 (scripted, per spec §Local input recovery)
  - CASE 1: npx vitest run src/panel/session-restore.test.ts -t "acceptance case 1"
  - CASE 2: npx vitest run src/input-retirement.test.ts       -t "acceptance case 2"
  - CASE 3: npx vitest run src/input-retirement.test.ts       -t "acceptance case 3"
  - CASE 4: npx vitest run src/panel/retirement-sidechat.test.ts src/panel/session-restore.test.ts -t "acceptance case 4"
      # matches both halves: 4-send-half + 4-commit-half (substring match is intentional)
  - CASE 5: npx vitest run src/blank-rejection.test.ts        # whole file (five sections)
      PLUS: npx vitest run src/reconstruct.test.ts -t "blank" # replay-guard + scrub units
  - RECORD per case: files run, tests passed, exit code. EXPECT: all green, nonzero test counts.
  - ON FAILURE: diagnose; fix ONLY at P3-owned seams (allow-list §Task 5); re-run to green.

Task 3: FULL GATES
  - npm test            # whole suite unfiltered; record "Test Files N passed" + "Tests M passed"; zero skipped
  - npm run typecheck   # tsc --noEmit, exit 0
  - npm run lint        # eslint src scripts *.ts, exit 0

Task 4: STATIC-GUARD AUDIT
  - RUN: npx vitest run src/no-hardcoded-keys.test.ts src/panel/sidechat-cache-isolation.test.ts \
      src/keymap-guard.test.ts src/config-surface.test.ts src/no-recovery-side-effects.test.ts
  - EXPECT: all five files green; record per-file test counts; zero skipped.
  - UNMODIFIED PROOF (the four pre-existing guards):
      git diff --name-only $BASE -- src/no-hardcoded-keys.test.ts \
        src/panel/sidechat-cache-isolation.test.ts src/keymap-guard.test.ts src/config-surface.test.ts
    EXPECT: EMPTY output. Any hit = a guard was edited during P3 → verdict anomaly; inspect and
    either revert the guard edit (if it weakens the guard) or fail loudly.
  - SEMANTIC CHECK while reading output: no-recovery-side-effects + sidechat-cache-isolation are
    the contract's "recovery writes are extension-local FILES" guards — no sendMessage, no
    appendEntry of draft/composer content, no session-file writes.

Task 5: DIFF-CONFINEMENT AUDIT
  - ACTUAL = union of:
      git diff --name-only $BASE -- src scripts *.ts package.json tsconfig.json vitest.config.ts README.md spec
      git status --porcelain -- src scripts *.ts package.json tsconfig.json vitest.config.ts README.md spec
  - ALLOW-LIST (changeset-owned; a file may appear untouched — that is fine):
      src/command.ts, src/index.ts, src/shortcut.ts,
      src/input-capture.ts, src/input-capture.test.ts,
      src/input-durability.ts, src/input-durability.test.ts,
      src/input-restore.ts, src/input-restore.test.ts,
      src/input-retirement.test.ts, src/no-recovery-side-effects.test.ts,
      src/panel/panel.ts, src/panel/panel.test.ts, src/panel/text-field.ts,
      src/panel/text-field.test.ts, src/panel/sidechat.ts, src/panel/sidechat-engine.ts,
      src/panel/actions.ts, src/panel/actions.test.ts,
      src/panel/session-restore.test.ts, src/panel/retirement-sidechat.test.ts,
      src/reconstruct.ts, src/reconstruct.test.ts, src/blank-rejection.test.ts,
      src/state.ts, src/state.test.ts, src/fallback.ts, src/fallback.test.ts,
      src/tool.ts, src/tool.test.ts
  - EXPECT: ACTUAL ⊆ ALLOW-LIST. README.md / spec/ / scripts/ / package.json / tsconfig.json /
    vitest.config.ts / root *.ts must NOT appear. Any extra path → anomaly (+ fix or fail).
  - NEVER exclude or edit plan/ paths — orchestrator-owned (tasks.json, PRP dirs); simply do not
    audit them.

Task 6: VERDICT ASSEMBLY (report-only; no repo writes)
  - ASSEMBLE the JSON from Goal with: HEAD sha, per-case results, suite counts, typecheck/lint,
    guard results (incl. unmodified flags), diffConfined bool, anomalies[] (flakes, fixes made,
    out-of-order README, anything unusual).
  - IF fixes were made during the gate: list file + reason in anomalies, re-run Tasks 2-5 to a
    clean final pass, and note the final-pass counts as the verdict numbers.
  - DELIVER in the implementing agent's report; flag "consumed by P3.M5.T1.S2" at the top.
```

### Implementation Patterns & Key Details

```bash
# PATTERN: one command per case, exact -t substring (verified describe strings):
#   "acceptance case 1 — hard-kill draft restore, all five limbs"
#   "acceptance case 2 — continuous typing progresses without idle, byte-exact final value"
#   "acceptance case 3 — failed write keeps both values; delayed writes never clobber or resurrect; branches isolate at file level"
#   "acceptance case 4-send-half — chat retirement rides the settle, never the send"
#   "acceptance case 4-commit-half — both sides of the save/commit handoff"
#   case 5: whole src/blank-rejection.test.ts (its describe strings are P3.M4.T1.S2's choice)

# PATTERN: base commit discovery is dynamic, never a hardcoded sha:
BASE=$(git log --format=%H --grep="capture-on-edit lands" -1)^
git log --oneline -1 $BASE   # sanity: expect "seven recovery axes resolved; capture track opens"

# CRITICAL failure rule (greenfield fix scope): a failing test is fixed at the seam the P3
# changeset OWNS — input-capture/input-durability/input-restore + their wiring
# (panel/text-field, panel/panel, panel/sidechat*, panel/actions, index, reconstruct,
# state/fallback/tool blank guards) — never by weakening an assertion, deleting a test,
# editing a pre-existing guard, or touching spec/plan/scripts/config.

# GOTCHA: if the harness has not yet committed P3.M4 work, `git diff --name-only $BASE` misses
# it — that is why Task 5 unions with `git status --porcelain` over the same pathspec.
```

### Integration Points

```yaml
CODE: none — no production changes (unless a seam fix is required, confined to the allow-list)
CONSUMERS:
  - P3.M5.T1.S2 (README + docs sync): uses this verdict as pre-condition; flips the README
    limitations row ("memory-only drafts until local input recovery ships" → shipped), re-words
    AC-9, updates the config reference — using the green counts recorded here
PLAN ARTIFACTS: verdict lives in the report only; plan/ and tasks.json untouched by this subtask
NO DATABASE / CONFIG / ROUTES / DEPENDENCIES
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck   # tsc --noEmit — exit 0 (this gate asserts it; no code expected to change)
npm run lint        # eslint src scripts *.ts — exit 0
```

### Level 2: Unit Tests (Component Validation)

```bash
# Per-case runs (Task 2 commands) — each green with nonzero test counts
npx vitest run src/panel/session-restore.test.ts -t "acceptance case 1"
npx vitest run src/input-retirement.test.ts -t "acceptance case 2"
npx vitest run src/input-retirement.test.ts -t "acceptance case 3"
npx vitest run src/panel/retirement-sidechat.test.ts src/panel/session-restore.test.ts -t "acceptance case 4"
npx vitest run src/blank-rejection.test.ts
npx vitest run src/reconstruct.test.ts -t "blank"
```

### Level 3: Integration Testing (System Validation)

```bash
npm test   # the entire suite, unfiltered — the authoritative suite verdict; record counts,
           # confirm zero skipped. NO live pi, NO interrogate calls (AUTOMATION-POLICY).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Static-guard audit (Task 4): five guard files green; four pre-existing guards diff-empty vs BASE.
# Diff-confinement audit (Task 5): ACTUAL ⊆ ALLOW-LIST; README/spec/scripts/config absent.
# Human-only checks (live TUI recovery feel) are OUT OF SCOPE — they belong to the human
# runbook (MANUAL-TUI-AC-RUNBOOK.md), never to an automated gate (AUTOMATION-POLICY).
```

## Final Validation Checklist

### Technical Validation

- [ ] All 4 validation levels completed and green (or diagnosed-failed with verdict `fail`)
- [ ] `npm test` green with recorded Test Files/Tests counts, zero skipped
- [ ] `npm run typecheck` exit 0; `npm run lint` exit 0
- [ ] Pre-existing four guards green AND `git diff --name-only $BASE -- <guards>` empty

### Feature Validation

- [ ] Cases 1-5 each green with recorded counts (case 4 = both halves)
- [ ] Case 5 present (blank-rejection.test.ts existed; precondition passed)
- [ ] no-recovery-side-effects green — recovery is extension-local FILES only
- [ ] Diff confined to allow-list; README untouched at this gate (S2 owns it)

### Code Quality Validation

- [ ] Zero repo writes by this subtask (or documented, allow-list-confined seam fixes)
- [ ] No test weakened, deleted, or skipped to reach green
- [ ] No guard file edited

### Documentation & Deployment

- [ ] Verdict JSON delivered in the report, marked "consumed by P3.M5.T1.S2"
- [ ] Anomalies (incl. any fixes) fully listed
- [ ] No environment variables, config, or dependency changes

## Anti-Patterns to Avoid

- ❌ Don't open a live TUI, call `interrogate`, or wait for user input — AUTOMATION-POLICY hard rule
- ❌ Don't implement missing P3.M4 artifacts yourself — verdict fail + escalate
- ❌ Don't fix failures outside the P3-owned seams (allow-list) or by weakening tests/guards
- ❌ Don't trust committed-diff-only audits — union with working-tree status
- ❌ Don't hardcode the base sha — discover it via the `git log --grep` recipe
- ❌ Don't filter/parallelize `npm test` — the suite verdict is the single unfiltered run
- ❌ Don't write any repo file for the verdict (report-only, per P1.M1.T1.S1 precedent)
- ❌ Don't touch plan/, tasks.json, spec/, README.md, scripts/, package.json — out of scope

---

**Confidence Score: 9/10** — every command, describe string, path, base-commit recipe, and
allow-list entry was verified against the working tree and git history; the sole residual
uncertainty is the exact describe naming inside `src/blank-rejection.test.ts` (P3.M4.T1.S2 was
in flight during research), which the PRP neutralizes by running that file whole.

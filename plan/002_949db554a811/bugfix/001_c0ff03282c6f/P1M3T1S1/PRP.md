# PRP — P1.M3.T1.S1: Full-suite regression sweep over the integrated Bugfix Wave 1 changeset

---
name: "P1.M3.T1.S1 — Run npm test + typecheck over the integrated changeset; triage flips and guard checks"
description: "Final verification gate for Bugfix Wave 1 (BUG-001..BUG-008, all 15 implementing subtasks landed). Run `npm test` (vitest run, ~1224 tests) + `npm run typecheck` at repo root. Classify every failure as expected-flip (verify the new assertion matches the owning bug's intended semantics, per the deliberate-flip inventory below) or unexpected fallout (fix minimally in the touched seam). Confirm the two guard suites — no-hardcoded-keys.test.ts and keymap-guard.test.ts — are green. No live TUI, no real interrogate calls (AUTOMATION-POLICY), no mocks (suite only). Output: green suite + a failure-triage note listing each flip with its justifying BUG id."
---

## Goal

**Feature Goal**: The integrated changeset (15 subtasks across panel actions, delivery, snapshots, short-view, remote bridge, and gate-hold logic) passes the full deterministic verification loop with every test difference accounted for — no silent semantic drift, no broken key-config guards.

**Deliverable**: Green `npm test` + `npm run typecheck` on the final integrated tree, plus a written failure-triage note (delivered in the subtask result / research notes) listing every deliberate test flip with its justifying BUG id, and documenting any unexpected fallout found and fixed.

**Success Definition**: Both commands exit 0; every test that changed relative to the pre-wave baseline is explained by one of the flips below (or by an owning subtask's TDD rewrite); `no-hardcoded-keys.test.ts` and `keymap-guard.test.ts` pass without modification to their guard logic; zero unexplained failures.

## User Persona

**Target User**: The maintainer trusting that the 8-bug fix wave didn't regress the 1224-test suite.

**Use Case**: Pre-release verification before documentation sweep (P1.M3.T2) and acceptance re-run.

**User Journey**: run suite → failures appear → each is checked against the flip inventory → either verified-expected or fixed at its seam → suite green → triage note recorded.

**Pain Points Addressed**: Bug-fix waves routinely land with stale pinned assertions that either mask real regressions (test updated to "make it pass") or fail spuriously; this task makes every flip an audited, justified decision.

## Why

- h2.0 Overview: the validation harness that found the 8 bugs reported "the repo's own suite (1224 tests) and typecheck pass" as the baseline — this sweep restores that guarantee after the fixes.
- Final gate of the plan; P1.M3.T2's documentation sweep depends on knowing the true final semantics (which this sweep certifies).

## What

### Procedure (exact)

1. **Baseline inventory** (cheap, before running): confirm the deliberate-flip test sites exist and were rewritten by their owning subtasks:
   - `src/panel/actions.test.ts:~268` — enter-on-text noop seam rewritten to "editor opens in write-in duty" (BUG-008 / P1.M2.T5.S1, the parallel item — treat its PRP as contract: two replacement tests, `test_accept_on_text_question_opens_writein_editor_no_answer` + `test_accept_then_type_enter_answers_text_question`).
   - `src/panel/actions.test.ts:~2042` — hold-line deviation pin INVERTED (BUG-001 / P1.M1.T1.S1-S2: gate-hold ⚠ line now arms before the completeness return; deviations now expected where they were previously forbidden).
   - `src/delivery.test.ts:~133` — delivery budget pin RE-PINNED (BUG-006 / P1.M2.T3.S1-S2: answerSummary flattens newlines/tabs + per-entry char cap in the budget loop).
   - `src/panel/short-view.test.ts:~197` — extended beyond hand-set `answer.text` (BUG-005 / P1.M2.T2.S1-S2: `hasTextAnswer` honors `answer.custom`; revisit preview renders the recorded value).
2. **Run the loop** at repo root:
   ```bash
   npm run typecheck
   npm test
   ```
   (Repo scripts verified: `"test": "vitest run"`, `"typecheck": "tsc --noEmit"` in package.json:31-32. There is NO validate.sh; scripts/ contains only remote-rpc-itest.mjs and verify-keymap-conflicts.sh.)
3. **Triage every failure**:
   - **Expected flip**: open the failing test, open the owning subtask's PRP/bug dossier (architecture/ dir), verify the NEW assertion encodes the intended fixed behavior (not just "made green"). If it matches → record in the triage note: test file:line, old expectation → new expectation, BUG id.
   - **Unexpected fallout**: reproduce mentally against the owning bug's architecture dossier; fix in the touched seam, minimally, following the dossier's seam guidance — never weaken a guard to pass. Any fix must itself be covered by an assertion (strengthen the nearest test if the fallout was untested).
   - **Ambiguous**: if a failure could be either a bad fix or a stale pin, prefer reading the source change over editing the test; only pin when the source provably implements the PRD-referenced semantics (h2.5 Recommendations are the semantic authority for each fix).
4. **Guard checks (must be green, unmodified guard logic)**:
   - `src/**/no-hardcoded-keys.test.ts` — regexes `ctrl+[a-z0-9]` in non-test `src/` files. Any NEW runtime string naming a key (e.g. a hold line or flash mentioning `ctrl+s` — the BUG-001 hold line and BUG-008 editor-open flash are prime suspects) MUST interpolate `resolveKeyLabels(config)` (src/config.ts:449). If the guard fires, fix the SOURCE string to interpolate — never edit the guard.
   - `src/**/keymap-guard.test.ts` — pins default keybindings + ALL_ACTIONS completeness. New actions added by the wave (none expected, but verify) must register in ALL_ACTIONS.
5. **Scope limits**: no live TUI runs, no real `interrogate` tool calls, no model turns (AUTOMATION-POLICY — deterministic suite only, same policy the bug hunt used for scripted checks). No mocks to add — the suite is already pure.
6. **Output**: the triage note. Format:

   ```
   TRIAGE — Bugfix Wave 1 regression sweep
   Expected flips:
   - <file>:<line> <test name> — <old> → <new> — BUG-00X (subtask id)
   Unexpected fallout (fixed):
   - <file>:<line> <symptom> — root cause — fix — test added/strengthened
   Guards: no-hardcoded-keys PASS · keymap-guard PASS (unmodified)
   Final: npm test PASS (N tests) · npm run typecheck PASS
   ```

### Success Criteria

- [ ] `npm run typecheck` exits 0.
- [ ] `npm test` exits 0 (full suite).
- [ ] Every test-diff vs the pre-wave baseline maps to a flip entry with a BUG id — no orphan changes.
- [ ] `no-hardcoded-keys.test.ts` green with guard regexes unmodified; any new key-naming runtime string interpolates `resolveKeyLabels`.
- [ ] `keymap-guard.test.ts` green — defaults pinned, ALL_ACTIONS complete.
- [ ] Triage note produced, listing all flips + any fallout fixes.
- [ ] No guard test logic weakened or deleted.

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the verify-loop commands (and that no validate.sh exists), the exact flip inventory, the two guard suites' contracts, and where each bug's intended semantics live. All below.

### Documentation & References

```yaml
- file: package.json
  why: scripts — "test": "vitest run" (:31), "typecheck": "tsc --noEmit" (:32); run from repo root
  gotcha: no validate.sh exists; scripts/ has only remote-rpc-itest.mjs + verify-keymap-conflicts.sh (do not invent other gates)

- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/prd_snapshot.md
  why: h2.0 (baseline: 1224 tests + typecheck passed pre-wave), h2.5 (Recommendations = semantic authority for each fix — use to judge whether a new assertion is right)
  critical: h2.5 bullet list is the acceptance semantics for gate-hold arming, draft write-through, archived-change snapshotting, textDuty re-derivation, write-in surfacing, delta bounding, bridge nack

- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/P1M2T5S1/PRP.md
  why: the parallel item's contract — the exact replacement tests for actions.test.ts:268 (enter-on-text). Assume landed exactly as specified
  gotcha: if those two tests are missing/different, that is unexpected fallout in P1.M2.T5.S1's seam, not a triage flip

- file: src/config.ts
  why: resolveKeyLabels (:449) — the ONLY sanctioned way to name a key in a runtime string; needed if the hard-coded-keys guard fires on new hold-line/flash copy
  pattern: grep the landed BUG-001 hold-line and BUG-008 code for literal "ctrl+" strings first — proactive check before the guard runs

- file: src/panel/actions.test.ts
  why: flip sites ~268 (BUG-008 rewrite) and ~2042 (BUG-001 hold-line deviation pin inverted)
- file: src/delivery.test.ts
  why: flip site ~133 (BUG-006 budget pin re-pinned after flatten + per-entry cap)
- file: src/panel/short-view.test.ts
  why: flip site ~197 (BUG-005 extended beyond hand-set answer.text — custom honored, preview rendered)

- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/architecture/
  why: per-bug architecture dossiers — the seam guidance to follow when fixing unexpected fallout (each implementing subtask wrote against these)
  gotcha: fixes go in the touched seam per dossier, never in guard tests or unrelated modules
```

### Current Codebase tree (relevant excerpt)

```bash
package.json            # test / typecheck scripts (verified)
scripts/                # remote-rpc-itest.mjs, verify-keymap-conflicts.sh — NOT part of this gate
src/panel/actions.test.ts   # flips: ~268 (BUG-008), ~2042 (BUG-001)
src/delivery.test.ts        # flip: ~133 (BUG-006)
src/panel/short-view.test.ts# flip: ~197 (BUG-005)
src/**/no-hardcoded-keys.test.ts, keymap-guard.test.ts  # guard suites
```

### Desired Codebase tree

```bash
# No new files. Possible minimal edits: source seams for fallout fixes,
# test files only for flip-verification corrections (assertion content, never guard logic).
# Research note (triage output) goes to plan/.../P1M3T1S1/research/triage-note.md
```

### Known Gotchas

```ts
// The 4 flip sites are DELIBERATE — a red suite there is expected only if the
// owning subtask failed to update them; verify against the owning PRP, then fix.
// no-hardcoded-keys: ANY new runtime "ctrl+x" string in non-test src fails the
// guard — interpolate resolveKeyLabels(config) instead (config.ts:449).
// keymap-guard pins defaults AND ALL_ACTIONS completeness — a new keymap action
// without ALL_ACTIONS registration fails it.
// Do NOT run remote-rpc-itest.mjs or verify-keymap-conflicts.sh as gates here.
// vitest run is single-shot (no watch) — a hung test fails the run; treat hangs
// as fallout (likely an un-awaited promise in a new seam, e.g. bridge nack path).
```

## Implementation Blueprint

### Data models

None — verification task. The only "artifact" is the triage note.

### Implementation Tasks (ordered)

```yaml
Task 1: PRE-CHECK — grep the landed wave for hardcoded key names
  - rg '"ctrl\+' src/ -g '!*.test.ts' — any hit must be resolveKeyLabels-interpolated before the guard sees it
Task 2: RUN — npm run typecheck; then npm test (capture full output to a log)
Task 3: TRIAGE — for each failure: map to flip inventory / owning PRP; verify assertion encodes h2.5 semantics; classify expected vs fallout
Task 4: FIX — fallout only, in the touched seam per that bug's dossier; add/strengthen an assertion for each fix
Task 5: RE-RUN to green; confirm guard suites pass unmodified
Task 6: WRITE plan/002_949db554a811/bugfix/001_c0ff03282c6f/P1M3T1S1/research/triage-note.md using the format in What §6
```

### Implementation Patterns & Key Details

```bash
# The whole loop (run from repo root):
npm run typecheck && npm test 2>&1 | tee /tmp/sweep.log
# Per-file rerun while triaging:
npx vitest run src/panel/actions.test.ts src/delivery.test.ts src/panel/short-view.test.ts
```

### Integration Points

```yaml
GATES (this task IS the gate):
  - downstream: P1.M3.T2.S1/S2 documentation sweeps consume the certified final semantics + triage note
CONSUMED:
  - all 15 implementing subtasks (Complete / Implementing per plan_status; P1.M2.T5.S1 lands in parallel — its PRP is the contract for the ~268 flip)
```

## Validation Loop

### Level 1–2 (this task is itself Levels 1–2 of the changeset)

```bash
npm run typecheck   # exit 0
npm test            # exit 0, full suite
```

### Level 3: Guard confirmation

```bash
npx vitest run -t "hardcoded"      # no-hardcoded-keys green, guard regexes untouched (git diff shows no guard edits)
npx vitest run -t "keymap"         # keymap-guard green, ALL_ACTIONS complete
```

### Level 4: Not applicable — deliberately NO live TUI / real tool calls (AUTOMATION-POLICY; deterministic suite only).

## Final Validation Checklist

- [ ] `npm run typecheck` exit 0
- [ ] `npm test` exit 0 (full suite, single run)
- [ ] All 4 flip sites verified against their owning PRPs/BUG ids; triage note written to research/
- [ ] Any fallout fixed in-seam with covering assertions; listed in the note
- [ ] Guard suites green with unmodified guard logic
- [ ] No changes outside: source seams (fallout fixes), flip assertions, research note
- [ ] `git diff` shows no edits to guard-test regexes/registration logic

## Anti-Patterns to Avoid

- ❌ Never "make it pass" by weakening/deleting a pinned assertion or guard — every change needs a BUG id
- ❌ Don't edit guard tests (no-hardcoded-keys / keymap-guard) — fix the source they point at
- ❌ Don't run live TUI / real interrogate calls — suite only (AUTOMATION-POLICY)
- ❌ Don't rerun remote-rpc-itest.mjs or verify-keymap-conflicts.sh as part of this gate
- ❌ Don't batch-triage failures by pattern-matching filenames — open each test and confirm intent

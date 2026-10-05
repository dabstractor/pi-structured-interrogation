---
name: "P1.M1.T5.S9 — Flip remaining cross-cutting panel suite rows to the ANSWER-PIN-001 contract"
description: "Flip every REMAINING assertion/comment in the panel test suites that pins the OLD contract (★-preselect-on-revisit / same-value-edit) to the NEW contract (caret on the recorded answer's row / inert no-op advance) — never a deletion. Audited against HEAD 7972f88: exactly 6 stale rows remain (actions.test.ts test_d ×1 block, auto-submit revisit comments ×4, ac-panel.test.ts:477 comment ×1) plus a two-stage.test.ts audit pass. Leave the already-flipped/accurate rows (verified list included). Output: green src/panel/*.test.ts on the new contract — the precondition for T5.S10's full-suite gate."
---

## Goal

**Feature Goal**: Complete spec M9's test-flip clause (h2.51: "flip the tests asserting them") for the rows NOT already flipped by T1.S1/S2, T2.S4/S5/S6, T3.S7: every remaining panel-suite assertion/comment that credits ★-preselect-on-revisit or same-value-edit behavior is flipped to assert the ANSWER-PIN-001 contract (FR-35: a recorded answer OWNS the caret — its display row under D-R13, the ✎ Other row for write-ins; the ★ preselect survives only on UNANSWERED questions; same-value commits are inert no-ops that advance). Every flip asserts the NEW contract — **never a deletion**. Rows already flipped or provably accurate (unanswered targets) are LEFT ALONE.

**Deliverable**: Test-only edits to `src/panel/actions.test.ts` (rename + rewrite `test_d_cursor_resets_to_star_preselect_on_every_change` at :796; flip the four auto-submit revisit-comment rows at :2118/:2125/:2167/:2237) and `src/panel/ac-panel.test.ts` (:477 comment); an audit pass over `src/panel/two-stage.test.ts` (:229, :520-523 — expected no-edit, flip only per the decision rule); a read-only verification pass documenting the already-complete suites (overview/panel/short-view/deep-view). Plus the pipeline-convention status flip `P1.M1.T5.S9 → Complete` in `plan/003_f8af1c6f6c49/tasks.json`. **Zero production-source edits.**

**Success Definition**: (1) `npx vitest run src/panel/` fully green on the NEW contract (currently 630/630 green — the flips must keep it green while pinning the new semantics, adding discriminating rows where the old assertion passed only coincidentally). (2) `npm run typecheck` clean, `npm test` full suite green. (3) `git diff` touches only the named test files + tasks.json. (4) Gate greps return zero stale old-contract claims. (5) T5.S10's full-suite gate (`npm test`) can run immediately on top of this.

## User Persona (if applicable)

**Target User**: The implementing/maintaining agent reading the panel suites as the executable spec of FR-35.

**Use Case**: A future change to cursor seeding (initialCursorIndex, the currentId setter) runs the suite: the flipped rows must FAIL if anyone regresses to ★-displaces-answer behavior — today several rows pass only because the recorded value happens to coincide with the ★ row (recommendation "a" == recorded "a" == display row 0), so they pin nothing.

**User Journey**: Engineer edits the setter → runs `npx vitest run src/panel/actions.test.ts` → the recorded-"b" discriminator row (added by this task) goes red → regression caught at the suite level, not in manual TUI.

**Pain Points Addressed**: The suite currently documents the pre-pin contract in its names/comments (e.g. "cursor resets to star preselect on every change") and green-passes through coincidence — the worst kind of pin: it looks covered and isn't.

## Why

- Spec M9 (h2.51) and the binding to-flip map (plan/003_f8af1c6f6c49/architecture/testing-verification.md): T5.S9 owns `actions.test.ts:541` (now :796), `actions.test.ts ~1878/1948` (drifted — the remaining stale subset is the auto-submit revisit rows), `overview.test.ts ~412/452` (resolved: handled/accurate, see audit), `panel.test.ts ~618` (resolved: flipped by T1.S2), `ac-panel.test.ts ~477`, and the short-view/two-stage residuals.
- ANSWER-PIN-001 (spec h3.5/FR-35, decision ledger h2.65) reversed the pre-pin contract; the landed production code (commits 1fba337, 886489c, d6d1553, 2d7a98f, 4a9d277, 7972f88) already implements it — the cross-cutting suites are the last place the OLD contract is still asserted.
- Dependency contract (tasks.json): T5.S9 consumes the landed contracts of T1.S1 (seed), T1.S2 (seed-site flips), T2.S4/S5/S6 (inert no-ops), T3.S7 (★ answered marker) and is the precondition for T5.S10 (AC-16 scripted test + binding green gates over the FULL suite including src/ac-scripted.test.ts and src/regression-phantom-submissions.test.ts — NOT this task's scope).
- Parallel-safety: T4.S8 (comment sweep) lands concurrently but is source-comments-only and explicitly leaves all `*.test.ts` to T5.S9/S10 — no write conflict; do not "fix" source comments here.

## What

1. **`src/panel/actions.test.ts` — flip the flagship row**: rename `test_d_cursor_resets_to_star_preselect_on_every_change` (:796) to a name asserting the new contract (e.g. `test_d_cursor_reseeds_recorded_answer_row_star_only_when_unanswered`); rewrite the body with a LOCAL fixture (do NOT mutate the shared `ALL_STATUSES` — tests at :720/:744 reuse it) that includes an answered question whose recorded value ("b") does NOT sit on the ★/row 0, so the flip DISCRIMINATES (the current fixture's recorded "a" == row 0 passes coincidentally under both contracts). Keep the q1 prev-leg (open + recommendation "a" → row 0 ★ preselect — accurate post-pin, now labeled as the unanswered case).
2. **`src/panel/actions.test.ts` — flip the four auto-submit revisit rows** (:2118, :2125 in the review-flow test; :2167 in the consecutive-edits loop; :2237 in the resume-new-commit test): every comment "setter re-seeds the cursor to the ★ \"a\" preselect" is made on an ANSWERED question — flip each to the recorded-answer seed; add ONE seed assertion at the first revisit of each non-loop site (and once before the loop at :2167) asserting the recorded row; keep loop-internal sites comment-only (the recorded value changes per iteration — 3rd iteration's recorded "b" seeds row 1 under D-R13; do not over-assert).
3. **`src/panel/ac-panel.test.ts` :477**: the row asserts `cursorIndex === 0` on q09 — UNANSWERED gate question with NO recommendation (the fixture gives a recommendation only to q01, :153) — accurate under the new contract, but the comment "alpha preselected (no recommendation)" mislabels it. Comment-only flip naming the unanswered clamp rule. Assertion unchanged.
4. **`src/panel/two-stage.test.ts` — audit pass**: re-derive the target's answeredness for :229 (✎→★ re-seed row) and :520-523 (write-in supersede, already carries an "FR-35 note"). Expected outcome: no edit (:229 targets an unanswered question — grep-verified in T4.S8's research; :520-523 was adjusted by T2.S5's landing). Apply the decision rule only if re-derivation contradicts this.
5. **Read-only verification pass** (produces the commit-message evidence, zero edits): confirm overview.test.ts (:400-455 rows target unanswered questions; marker rows :138-159 are the post-T3.S7 vocabulary tests), panel.test.ts (:617+ `test_overview_enter_revisit_seeds_to_recorded_answer_row` — flipped by T1.S2), short-view.test.ts (:79-135 FR-35 coverage landed by S1), deep-view.test.ts (T2.S6-owned, landed) — all verified complete; do not touch.
6. **tasks.json**: flip `P1.M1.T5.S9` status → `Complete` (pipeline convention — every subtask commit carries its own flip; check neighboring entries for the exact enum).

### Success Criteria

- [ ] Renamed test_d pins: nav into an answered question seeds the RECORDED answer's display row (including a recorded "b" → row 1 discriminator with a ★ present on row 0); nav into an unanswered question seeds ★ (row 0); stray cursor positions never survive a question change
- [ ] All four auto-submit revisit rows credit/assert the recorded-answer seed; zero "re-seeds the cursor to the ★" comments remain
- [ ] ac-panel.test.ts:477 comment states the unanswered clamp (no recommendation → display row 0), assertion unchanged
- [ ] two-stage.test.ts audit documented (decision rule applied; expected zero edits)
- [ ] `npx vitest run src/panel/` green; `npm run typecheck` clean; `npm test` full green
- [ ] `git diff --stat` = only `src/panel/actions.test.ts`, `src/panel/ac-panel.test.ts` (+ `src/panel/two-stage.test.ts` only if the audit flips a row), `plan/003_f8af1c6f6c49/tasks.json`
- [ ] Gate greps (Validation Level 4) return zero stale hits

## All Needed Context

### Context Completeness Check

This PRP carries the row-by-row audit of every map row verified against HEAD `7972f88` (suite green 630/630): exact current anchors, why each stale row is stale (including the coincidence trap — recorded "a" == ★ row 0 in the auto-submit fixtures), the proven post-pin fixture pattern to mirror, the audit decision rule, and the do-not-touch list with evidence. An implementer needs only the named test files + this document.

### Documentation & References

```yaml
- file: plan/003_f8af1c6f6c49/architecture/testing-verification.md
  why: "the binding to-flip map (T5.S9's owned rows) + the green-gate policy (scripted vitest only)"
  section: "To-flip map"

- file: plan/003_f8af1c6f6c49/architecture/answer-pinning-contract.md
  why: "the contract the flips assert: FR-D8 seeding rules (recorded row / ✎ row / clamp-0-never-★), FR-D9 inert no-ops, AC-16 shape, non-goals"
  section: "FR-D8 / FR-D9 / AC-16"

- file: plan/003_f8af1c6f6c49/P1M1T5S1/research/flip-audit.md
  why: "the verified audit table: every map row → current anchor → stale/accurate verdict + fixture semantics (seed() synthesizes answer \"a\" for status:\"answered\"; ALL_STATUSES q2 has NO recommendation) + gates"
  pattern: "row-by-row table; follow the FLIP/LEAVE verdicts exactly"

- file: src/panel/actions.test.ts
  why: "primary edit target: :796 test_d block; :2118/:2125/:2167/:2237 revisit rows; AND the pattern source — the T1.S1-landed recorded-row test (~:1258-1276, locate by content 'the RECORDED answer's display row (D-R13) — not 0, not ★') shows the exact fixture style to mirror"
  gotcha: "fixture helpers: seed() :83 (status:\"answered\" ⇒ applyAnswer value overrides.answer?.value ?? \"a\"); choiceQ :65 (OPTS_AB a/b; cursor domain 0=a,1=b,2=✎ Other); do NOT mutate ALL_STATUSES :710 (reused at :720/:744); verify BASIC's q2 spec line before asserting the ★-coincidence comment"

- file: src/panel/ac-panel.test.ts
  why: ":477 comment-only flip; fixture context :141-153 (only q01 gets recommendation \"alpha\"; q09 is an unanswered gate question)"
  gotcha: "AC-6 is a FR-17 moot test — the cursor row is incidental; change ONLY the comment, never the expectation"

- file: src/panel/two-stage.test.ts
  why: "audit pass :229 and :520-523; decision rule: flip only if the target question carries an answer at the assertion moment"
  gotcha: "T4.S8's research grep-verified :229 targets an unanswered question (accurate); :520-523 already carries an FR-35 note — expected zero edits"

- file: src/panel/short-view.ts
  why: "READ-ONLY — initialCursorIndex is the production seam the flips pin (landed 1fba337); consult to re-derive seeding if an audit row is ambiguous"
  gotcha: "never edit production sources in this task — if a flip reveals a PRODUCTION bug, stop and report instead of patching"

- url: spec/product-requirements.md (h3.5 / h2.10 AC-16, in-repo spec/)
  why: "FR-35 verbatim + AC-16's exact discriminator shape (non-recommended answer → caret on chosen row, ★ visible on its own row, caret NOT on it)"
```

### Current Codebase tree (relevant slice)

```bash
src/panel/                 # 16 test files, 630 tests, ALL GREEN at HEAD 7972f88
├── actions.test.ts        # EDIT: :796 test_d flip; :2118/:2125/:2167/:2237 revisit rows; pattern source ~:1258
├── ac-panel.test.ts       # EDIT: :477 comment only
├── two-stage.test.ts      # AUDIT (expected no-edit): :229, :520-523
├── overview.test.ts       # LEAVE (rows target unanswered q's; marker rows are post-T3.S7)
├── panel.test.ts          # LEAVE (:617+ revisit row flipped by T1.S2)
├── short-view.test.ts     # LEAVE (FR-35 coverage landed by S1)
├── deep-view.test.ts      # LEAVE (T2.S6-owned, landed 4a9d277)
└── (10 more suites)       # LEAVE — no map rows, no stale preselect claims
plan/003_f8af1c6f6c49/tasks.json   # EDIT: P1.M1.T5.S9 → Complete
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# No new files. Edits only:
# src/panel/actions.test.ts   — flagship flip (rename+discriminator) + 4 revisit-row flips
# src/panel/ac-panel.test.ts  — 1 comment flip
# src/panel/two-stage.test.ts — audit; edit ONLY if the decision rule fires
# plan/003_f8af1c6f6c49/tasks.json — status flip (pipeline convention)
```

### Known Gotchas of our codebase & Library Quirks

```text
# CRITICAL: the coincidence trap. In BASIC/ALL_STATUSES-style fixtures the
# recommendation is "a" and answers land on "a": display row 0 (D-R13 puts the
# ★ first) is BOTH the ★ row and the recorded row — `toBe(0)` passes under BOTH
# contracts. A flip that only edits comments pins nothing. Where the map row is
# a behavioral pin (test_d), ADD a discriminating fixture row (recorded "b" →
# row 1, ★ stays visible on row 0). Where the row is incidental to another
# contract (auto-submit counts/epochs — DO NOT alter their edit sequences or
# firing counts), assert the seed once at a known-state moment instead.

# CRITICAL: never delete or weaken an assertion — the contract says each flip
# asserts the NEW contract. Renaming the misleading test name is established
# precedent in this plan (T3.S7 renamed one).

# GOTCHA: seed() semantics — `status: "answered"` synthesizes answer "a"
# (applyAnswer) UNLESS overrides.answer.value is given; reasked/moot/withdrawn/
# closed via setStatus carry NO answer in these fixtures (post-pin seeding for
# them = unanswered case unless an explicit answer is provided).

# GOTCHA: ALL_STATUSES (:710) is shared by tests at :720/:744 — build the
# flipped test_d on a LOCAL fixture array, never mutate the shared one.

# GOTCHA: line anchors drift — locate by content ("cursor_resets_to_star",
# "re-seeds the cursor to the ★", "alpha preselected"). Anchors in this PRP are
# exact at HEAD 7972f88.

# GOTCHA: the accurate post-pin note at actions.test.ts ~:1972 ("the ★-reseed
# premise this test was written against is that flip's casualty") must SURVIVE
# the gate greps — its phrasing intentionally names the old premise as dead.

# GOTCHA: scope walls — src/ac-scripted.test.ts + src/regression-phantom-
# submissions.test.ts are T5.S10's; README.md is T6.S11's; layout.test.ts is
# T3.S7's (done); production sources are T4.S8's parallel lane (comments) —
# none may be touched here.
```

## Implementation Blueprint

### Data models and structure

None — no runtime data changes. The only "model" is the flip decision rule: **an assertion/comment credits ★ preselect (or ★ re-seed) at a moment the target question carries an `answer` → flip to the recorded-answer contract; target unanswered → accurate, leave.** Recorded-answer contract wording for comments: "the setter re-seeds to the RECORDED answer's display row (D-R13; ✎ Other row for write-ins) — ★ preselect only while unanswered (FR-35 / ANSWER-PIN-001)".

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: FLIP src/panel/actions.test.ts test_d block (:796-806)
  - RENAME: "test_d_cursor_resets_to_star_preselect_on_every_change"
            → "test_d_cursor_reseeds_recorded_answer_row_star_only_when_unanswered"
  - REWRITE body with a LOCAL fixture (mirror the landed pattern at ~:1258-1276):
      const state = seed([
        { id: "q1", overrides: { recommendation: "a" } },                          // open → ★ row 0
        { id: "q2", overrides: { status: "answered" } },                            // recorded "a" → row 0
        { id: "q3", overrides: { status: "answered", answer: { value: "b", at: T0 } } }, // recorded "b" → row 1 (DISCRIMINATOR)
      ]);
    then, through nextQuestion/prevQuestion (R1 full-list nav — answered targets ARE reachable):
      - stray cursorIndex on q1 → nextQuestion → q2: expect cursorIndex 0
        ("the RECORDED \"a\" owns display row 0 — q2 has NO recommendation; row 0 is the answer, not a ★ preselect")
      - nextQuestion → q3: expect cursorIndex 1
        ("the RECORDED \"b\" owns display row 1 — the ★ \"a\" row 0 never owns the caret once an answer exists (FR-35)")
      - stray cursorIndex 2 → prevQuestion → q2: expect cursorIndex 0 (re-entry re-pins; stray never survives)
      - prevQuestion → q1 (UNANSWERED): expect cursorIndex 0
        ("★ preselect row 0 — the unanswered case where the recommendation keeps the caret")
  - FOLLOW pattern: the T1.S1-landed test ~:1258-1276 (fixture + D-R13 display-row comments)
  - GOTCHA: do NOT mutate ALL_STATUSES; do NOT touch tests at :720/:744

Task 2: FLIP the four auto-submit revisit rows in src/panel/actions.test.ts
  - SITE :2118 (test_auto_review_flow…, q1 edit): replace comment
      OLD: panel.currentId = "q1"; // setter re-seeds the cursor to the ★ "a" preselect
      NEW: panel.currentId = "q1"; // setter re-seeds to the RECORDED "a" row (FR-35; ★ coincides — rec "a")
    and ADD immediately after, before the cursorIndex=1 drive:
      expect(panel.cursorIndex).toBe(0); // the recorded "a" owns row 0 on revisit — not a ★ re-proposal
  - SITE :2125 (same test, q2 edit): identical comment flip + identical seed assertion
    (verify BASIC's q2 carries recommendation "a" first — one read of the BASIC const near :131)
  - SITE :2167 (test_auto_consecutive_edits…, INSIDE the edits loop): comment-only flip
      OLD: panel.currentId = edit.id; // setter re-seeds the cursor to the ★ preselect
      NEW: panel.currentId = edit.id; // setter re-seeds to the RECORDED answer's row (FR-35)
    PLUS one pre-loop seed assertion after the completeness firing (q1 recorded "a" → row 0);
    do NOT assert per-iteration — the recorded value mutates across iterations
    (3rd iteration's recorded "b" seeds row 1 under D-R13)
  - SITE :2237 (test_resume_pending_panel_new_commit…, q2): comment flip + seed assertion
    (q2's answer came from seed()'s status:"answered" default "a" → row 0)
  - PRESERVE: every firing-count/epoch/snapshot assertion in these tests —
    the auto-submit contracts (AUTOSUBMIT-001/003) are the POINT of these tests;
    the seed assertions are additions, never alterations of the edit sequences

Task 3: FLIP src/panel/ac-panel.test.ts :477 (comment only)
  - OLD: expect(panel.cursorIndex).toBe(0); // alpha preselected (no recommendation)
  - NEW: expect(panel.cursorIndex).toBe(0); // q09 UNANSWERED, no recommendation (only q01 has one) — display row 0 by clamp, the unanswered seed (FR-35), not a ★ preselect
  - ASSERTION UNCHANGED (it is accurate; the AC-6 moot contract owns this test)

Task 4: AUDIT src/panel/two-stage.test.ts (:229, :520-523)
  - RE-DERIVE: does the target question carry an answer at each assertion moment?
    (read the surrounding test body; consult src/panel/short-view.ts initialCursorIndex if ambiguous)
  - EXPECTED: :229 targets an unanswered question (leave; optionally tighten the
    comment to name the unanswered case); :520-523 already carries the FR-35 note (leave)
  - IF contradicted: flip the comment/assertion per the decision rule — recorded
    answer's row (✎ Other row for write-ins), never deletion
  - RECORD the audit outcome in the commit message (the map's "residual rows" row
    closes here either way)

Task 5: VERIFY the already-complete suites (read-only — zero edits, evidence only)
  - overview.test.ts: rows ~:400-455 target UNANSWERED questions (accurate);
    marker rows ~:138-159 are the post-T3.S7 vocabulary tests — LEAVE
  - panel.test.ts: `test_overview_enter_revisit_seeds_to_recorded_answer_row`
    (~:617+) landed by T1.S2 — LEAVE
  - short-view.test.ts (:79-135 FR-35 describe) landed by S1 — LEAVE
  - deep-view.test.ts landed by T2.S6 (4a9d277) — LEAVE (out of scope even if a
    comment looks stale; report it, don't edit)
  - OUTPUT: the verified-complete list goes in the commit message body

Task 6: FLIP status in plan/003_f8af1c6f6c49/tasks.json
  - P1.M1.T5.S9 → "Complete" (ONLY this field; match the neighboring enum values)

Task 7: RUN the gate greps + full validation (Level 4 below); paste outputs
  into the commit message body — the task contract's OUTPUT is green
  src/panel/*.test.ts on the new contract, evidenced
```

### Implementation Patterns & Key Details

```text
# PATTERN — the discriminating flip (what makes a flip REAL vs cosmetic):
#   a stale row whose fixture puts the recorded value ON the ★ row (both "a")
#   passes under both contracts. Behavioral flips must introduce a case where
#   recorded ≠ ★: recorded "b" + recommendation "a" → D-R13 display [a(★), b],
#   caret must be row 1. Cosmetic rows (comments on incidental assertions in
#   foreign-contract tests) get comment flips + at most one seed assertion at a
#   known-state moment — never a restructure of the host test's scenario.

# PATTERN — comment voice (match the landed post-pin phrasing, e.g.
#   panel.test.ts:619-623 / actions.test.ts ~:1969-1973):
#   "the setter re-seeds to the RECORDED answer's display row (D-R13; ✎ Other
#    row for write-ins); ★ preselect only while unanswered (FR-35)"

# CRITICAL: T0 is the existing timestamp constant in actions.test.ts — reuse it
#   in the Task-1 fixture (do not import or invent a new one).

# CRITICAL: if any flip turns the suite RED in a way that suggests the
#   PRODUCTION seeding is wrong (not the test), STOP and report — production
#   edits are outside this task's walls (T1.S1's contract landed; a regression
#   would be a new bug for the human, not a test-side workaround).
```

### Integration Points

```yaml
RUNTIME: NONE — zero production edits, zero config/schema/UI-string changes
PIPELINE:
  - tasks.json: P1.M1.T5.S9 → Complete unblocks T5.S10 (AC-16 scripted test +
    binding green gates: npm test incl. src/ac-scripted.test.ts and
    src/regression-phantom-submissions.test.ts)
  - T6.S11 (README AC-16 row) consumes this task's green state
  - T4.S8 (parallel, source comments) is untouched by this diff and vice versa
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# This repo has no ruff/mypy — typecheck is the gate (package.json)
npm run typecheck
# Expected: zero errors. Comment/fixture edits in tests type under the same
# strict tsconfig; if errors appear you typo'd a fixture field — fix before proceeding.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The edited suites, immediately after each task:
npx vitest run src/panel/actions.test.ts
npx vitest run src/panel/ac-panel.test.ts
npx vitest run src/panel/two-stage.test.ts   # audit — must stay green either way
# Expected: all green. A red flipped row means either the fixture is wrong or
# (worse) production regressed — diagnose per the CRITICAL note in the blueprint.
```

### Level 3: Integration Testing (System Validation)

```bash
# The task's contractual OUTPUT: green src/panel/*.test.ts on the new contract
npx vitest run src/panel/
# Expected: 16 files green, all tests green (630 at HEAD + any added assertions).
# Then the full suite — the T5.S10 precondition:
npm test
# Expected: fully green, zero skips introduced.
```

### Level 4: Domain-Specific Validation (the task contract's OUTPUT evidence)

```bash
# Gate 1 — the renamed flagship is gone from the tree:
grep -rn "cursor_resets_to_star_preselect" src/
# Expected: ZERO hits.

# Gate 2 — the stale revisit-comment phrasing is gone from the panel suites:
grep -rn "re-seeds the cursor to the ★" src/panel/*.test.ts
# Expected: ZERO hits (the accurate ~:1972 "★-reseed premise … casualty" note
# does NOT match this pattern — verify it still exists:
grep -n "casualty" src/panel/actions.test.ts   # → 1 hit, kept).

# Gate 3 — diff walls:
git diff --stat
# Expected: ONLY src/panel/actions.test.ts, src/panel/ac-panel.test.ts
# (+ src/panel/two-stage.test.ts only if the Task-4 audit fired),
# + plan/003_f8af1c6f6c49/tasks.json. Zero production sources, zero README,
# zero T5.S10-owned files (src/ac-scripted.test.ts, src/regression-phantom-submissions.test.ts).

# REPORT: paste Gates 1-3 outputs + the Task-5 verified-complete list + the
# Task-4 audit outcome into the commit message body.
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1: `npm run typecheck` clean
- [ ] Level 2: each edited suite green immediately after its task
- [ ] Level 3: `npx vitest run src/panel/` green; `npm test` full green (T5.S10 precondition met)
- [ ] Level 4: Gates 1-2 zero hits; "casualty" note survives; Gate 3 diff walls hold; evidence in commit message

### Feature Validation

- [ ] test_d renamed + rewritten with the recorded-"b" discriminator (caret row 1 with ★ visible on row 0) and the unanswered ★ case labeled
- [ ] Four auto-submit revisit rows credit/assert the recorded-answer seed; firing-count/epoch assertions untouched
- [ ] ac-panel.test.ts:477 comment names the unanswered clamp; expectation unchanged
- [ ] two-stage.test.ts audit recorded (decision rule applied; expected zero edits)
- [ ] Verified-complete list for overview/panel/short-view/deep-view recorded (zero edits there)
- [ ] tasks.json: P1.M1.T5.S9 → Complete (this field only)

### Code Quality Validation

- [ ] No assertion deleted or weakened — every flip asserts the new contract
- [ ] Comment voice matches the landed post-pin phrasing (FR-35 / ANSWER-PIN-001 citations)
- [ ] No shared fixture mutated (ALL_STATUSES, BASIC); new fixture rows local to the flipped test
- [ ] No production source, README, spec/, or T5.S10/T6.S11-owned file touched

### Documentation & Deployment

- [ ] Mode A: the flipped tests ARE the documentation — no separate docs (task contract: "DOCS: none")
- [ ] Commit message carries the gate outputs, audit outcome, and verified-complete list

---

## Anti-Patterns to Avoid

- ❌ Don't flip by deleting assertions — every flip must assert the NEW contract (caret on recorded row / no-op advance)
- ❌ Don't ship cosmetic-only flips for behavioral rows — the coincidence trap (recorded "a" == ★ row 0) means a comment-only flip on test_d pins nothing; add the discriminator
- ❌ Don't restructure the auto-submit hosts — their firing-count/epoch contracts (AUTOSUBMIT-001/003) are the point; seed assertions are additive
- ❌ Don't mutate shared fixtures (ALL_STATUSES at :710 is reused at :720/:744)
- ❌ Don't touch production sources, T4.S8's comment lane, T5.S10's files (ac-scripted, regression-phantom), T6.S11's README, or T3.S7's layout.test.ts
- ❌ Don't scrub the ~:1972 "casualty" note or other accurate FR-35-aware comments — they document the reversal, not the old premise
- ❌ Don't edit a suite just because a comment mentions ★ — apply the decision rule (answered target at the assertion moment = the only flip trigger)
- ❌ Don't skip the gate greps or the commit-message evidence — green-on-new-contract is the task's OUTPUT artifact

# PRP — P1.M1.T5.S9: Flip remaining cross-cutting panel suite rows

## Goal

**Feature Goal**: Every assertion in `src/panel/*.test.ts` that still encodes the superseded status-agnostic ★-preselect contract (caret re-seeds to the recommendation on every revisit, even answered questions) is flipped to assert the ANSWER-PIN-001 contract: a recorded answer owns the caret at its display row; the ★ preselect survives only on unanswered questions. Flips assert the new contract — never delete or weaken a test.

**Deliverable**: Edited test files only — principally `src/panel/actions.test.ts` (one full test flip + five comment flips) and one comment flip in `src/panel/ac-panel.test.ts`, plus optional one-line annotations on verified-legitimate unanswered-path rows in `src/panel/overview.test.ts` / `src/panel/panel.test.ts`. Zero production-file changes.

**Success Definition**: `npx vitest run src/panel/` green (16 files / 630 tests, count may not drop); `npm run typecheck` green; a content sweep finds no remaining claim in `src/panel/*.test.ts` that the caret re-seeds to the ★ preselect on an answered question.

## Why

The answer-pinning contract (ANSWER-PIN-001 / FR-35, spec M9) landed in production code through subtasks T1–T4: `initialCursorIndex` now seeds to the recorded answer's display row (FR-D8), same-value commits are inert no-ops (FR-D9), and the short view carries the ★ answered marker (FR-D10). The panel suites are green — but green by coincidence or by stale comments, not by contract. Several rows still *name and justify* the old behavior ("setter re-seeds the cursor to the ★ preselect") on questions that carry answers, and one test (`test_d_cursor_resets_to_star_preselect_on_every_change`) still *asserts* the old contract, passing only because its fixture's recorded answer happens to sit at display row 0 where the old ★ pre-seed also landed. T4.S8's comment sweep covered non-test files only (its grep gates exclude `*.test.ts`). This subtask makes the panel suites *pin* the new contract so T5.S10's full-suite gate and the AC-16 test stand on suite rows that mean what they say. These stale tests were testing the bug; flipping them is the point (spec decision ledger, ANSWER-PIN-001: "every doc/test asserting status-agnostic preselect — those tests were testing the bug").

## What

For each site below: flip the assertion/comment to the new contract. The user-visible behavior does not change (production code is already correct); this is suite hygiene and regression-pinning.

### The contract being asserted (binding extract — FR-35 / ANSWER-PIN-001)

- When a question carries an answer (any status: answered / submitted / closed; moot keeps its dimmed answer), the caret seeds to the **recorded answer's display row**: the option row whose value equals `answer.value`; the `✎ Other` row (index `options.length`) when `answer.custom === true`; row 0 for `type:"text"`. A value no longer in `options` clamps to display row 0 — **never** to the recommendation.
- The ★ recommendation stays visible on its own row but never owns the caret or preselects once an answer exists; ★ preselect applies **only to unanswered questions**.
- Display order is D-R13 recommended-first (`displayOptions`): with options `[a, b]` and `recommendation: "b"`, display order is `[b(★), a]` — so a recorded answer `"a"` owns **display row 1**, while the ★ sits at row 0. This is the discriminating shape for flips.
- `enter`/digit on the already-recorded value is a state no-op that only advances (no ripple modal, no `answer.at` rewrite, no epoch bump, no auto-submit).

### Success criteria

- [ ] `test_d_cursor_resets_to_star_preselect_on_every_change` is renamed and rewritten so the answered-question leg asserts the recorded answer's display row via a **discriminating fixture** (answer at display row ≠ 0 while a ★ exists elsewhere), and the open-question leg keeps asserting the surviving ★ preselect.
- [ ] Every `// setter re-seeds the cursor to the ★ …` comment in `actions.test.ts` on an ANSWERED question is rewritten to state the recorded-answer seeding (with why it coincidentally lands at row 0 in that fixture).
- [ ] The `// cursor reset to ★ preselect` comment (actions.test.ts:245) and `// alpha preselected (no recommendation)` comment (ac-panel.test.ts:477) name the actual seeding path (no-answer/no-recommendation clamp to row 0).
- [ ] No test is deleted, skipped, or weakened; no assertion count drops; no production file changes.
- [ ] `npx vitest run src/panel/` green; `npm run typecheck` green.
- [ ] Sweep `grep -rn "re-seeds the cursor to the ★\|resets_to_star_preselect" src/panel/*.test.ts` returns zero hits.
- [ ] Verified-legitimate rows (below) are left untouched except optional clarifying annotations.

## All Needed Context

### Context Completeness Check

An implementer who knows nothing about this repo can execute this PRP: it lists every flip site by file, current line, and exact current content; prescribes the replacement text/shape; defines the contract being asserted; names the out-of-scope suites and the gates. No other document must be read (references below are supporting, not required).

### Documentation & References

```yaml
- file: plan/003_f8af1c6f6c49/architecture/answer-pinning-contract.md
  why: Binding extract of FR-D8/D9/D10 + AC-16 + status vocabulary — the contract every flipped row must assert
  pattern: "recorded answer owns the caret at its display row; ★ preselect only while unanswered; stale value clamps to row 0, never the recommendation"
- file: plan/003_f8af1c6f6c49/architecture/testing-verification.md
  why: The to-flip map this subtask executes (owner column T5.S9) + the scripted-vitest-only policy and green gates
  gotcha: "Line anchors are from the delta PRD — locate by content, lines may drift" (they have: +291 lines of insertions in actions.test.ts since the map was written)
- file: plan/003_f8af1c6f6c49/P1M1T5S9/research/inventory.md
  why: Today-verified line numbers, full quotes, prior-subtask coverage (what NOT to re-flip), and the legitimate-leave list
- file: src/panel/actions.test.ts
  why: Flip sites 1–7; also the fixtures (seed/choiceQ/BASIC/ALL_STATUSES at lines ~59–135, ~710) the prescriptions depend on
  pattern: seed() applies `answer` via state.applyAnswer (status → "answered"); OPTS_AB = [a=Alpha, b=Beta]
  gotcha: ALL_STATUSES is shared by three tests — do NOT mutate it; build the discriminating scenario inside the flipped test
- file: src/panel/short-view.ts
  why: initialCursorIndex + displayOptions — read-only reference for why the discriminating fixture asserts row 1 (D-R13 order), NOT to modify
- file: src/panel/ac-panel.test.ts
  why: Flip site 8 (comment at :477); the gate question q09 is OPEN there — the answer is committed by the ENTER two lines later
```

### Current Codebase tree (test files in scope only)

```bash
src/panel/
├── actions.test.ts      # 2614 lines — flip sites 1–7 (lines 245, 796–805, 2118, 2125, 2137, 2167, 2237)
├── ac-panel.test.ts     # 1165 lines — flip site 8 (line 477 comment)
├── overview.test.ts     # 527 lines — verified legitimate (:412, :452–453); optional annotation only
├── panel.test.ts        # 2739 lines — verified legitimate (:618, :814, :2176, :2740); no edits required
├── short-view.test.ts / two-stage.test.ts / deep-view.test.ts / layout.test.ts
│                        # already flipped by T1.S1 / T2.S5 / T2.S6 / T3.S7 — DO NOT touch
└── (11 more suites)     # clean per content sweep
```

### Desired changes (no new files)

```bash
src/panel/actions.test.ts    # 1 test renamed+rewritten; 6 comments re-justified
src/panel/ac-panel.test.ts   # 1 comment re-justified
src/panel/overview.test.ts   # (optional) 2 one-line "unanswered path" annotations
```

### Known Gotchas of our codebase & Library Quirks

```text
# CRITICAL: Lines drift. All anchors below were verified against the working tree
# at 2026-10-05 (post-f3e00c5). LOCATE BY CONTENT FIRST; the quoted text is exact.
# If a quote is not found at the given line, grep for its distinctive fragment.

# CRITICAL: Coincidental passes. A stale ★ assertion on an answered question still
# passes whenever answer.value occupies display row 0 (e.g. answer "a" with options
# [a,b] and no recommendation, or answer == recommendation under D-R13). Passing ≠
# flipped: the comment/name must state the recorded-answer seeding, and the flipped
# anchor test must use a fixture where answer row ≠ ★ row ≠ 0 so the new contract
# is actually pinned (asserting row 0 "because ★" tests nothing).

# GOTCHA: seed() in actions.test.ts routes `answer` overrides through
# state.applyAnswer(id, { value: overrides.answer?.value ?? "a", at: T0 }) — supply
# `answer: { value: "a" }` explicitly in the discriminating fixture; the default "a"
# is fine but explicit reads better next to recommendation "b".

# GOTCHA: displayOptions is recommended-first (D-R13): options [a,b] + rec "b" →
# display [b(★), a]; recorded "a" = display row 1; the ✎ Other row is index
# options.length (= 2 here). Digit quick-select and the cursor domain speak display
# positions.

# GOTCHA: The panel's initial currentId is the FIRST UNANSWERED question in state
# order — with q1 open and q2 answered, makePanel lands on q1 (matches the old
# test's starting point).

# NEVER: delete/skip a test, drop an assertion, or edit any non-test file. The T4.S8
# comment-sweep gates intentionally excluded *.test.ts — that residue is THIS task.
```

## Implementation Blueprint

### Flip site inventory (exact, verified)

All sites in `src/panel/actions.test.ts` unless noted. Current content quoted verbatim; lines verified 2026-10-05.

**Site 1 — the anchor test (full flip).** Line 796:

```ts
test("test_d_cursor_resets_to_star_preselect_on_every_change", () => {
  const state = seed(ALL_STATUSES);
  const { panel } = makePanel(state);
  panel.cursorIndex = 3; // stray cursor position on q1
  nextQuestion(panel);
  expect(panel.cursorIndex).toBe(0); // q2 ★ preselect (recommendation "a")
  panel.cursorIndex = 2;
  prevQuestion(panel);
  expect(panel.cursorIndex).toBe(0); // q1 recommendation preselect again
});
```

Why stale: q2 in ALL_STATUSES is `{ status: "answered" }` (seed applies answer "a"); landing on it now seeds to the recorded answer's row — and q2 has no recommendation, so the comment is doubly wrong. Replace with a discriminating rewrite (keep both legs — answered-pin AND the surviving open-★ — in one test):

```ts
test("test_d_cursor_seeds_to_recorded_answer_on_answered_star_on_open", () => {
  // ANSWER-PIN-001 (FR-35): landing on an ANSWERED question seeds the caret
  // to the recorded answer's DISPLAY row — never the ★ row, never
  // 0-by-default. The ★ preselect survives only on UNANSWERED questions.
  const state = seed([
    { id: "q1", overrides: { recommendation: "a" } }, // open → ★ path still applies
    {
      id: "q2",
      overrides: {
        recommendation: "b",
        status: "answered",
        answer: { value: "a", at: T0 },
      },
    },
  ]);
  const { panel } = makePanel(state);
  panel.cursorIndex = 3; // stray cursor position on q1
  nextQuestion(panel); // → q2 (answered "a")
  // D-R13 recommended-first: display [b(★), a, ✎] — the recorded "a" owns row 1;
  // row 0 is the ★ Beta row and must NOT hold the caret.
  expect(panel.cursorIndex).toBe(1);
  panel.cursorIndex = 2;
  prevQuestion(panel); // → q1 (open, recommendation "a")
  expect(panel.cursorIndex).toBe(0); // ★ preselect on an UNANSWERED question (the surviving path)
});
```

Note: this removes the test's last use of ALL_STATUSES — that fixture stays (two other tests use it: `test_d_next_traverses_every_status_and_clamps_at_end` and the accept-loop test above it). Optionally assert the rendered ▸ cursor sits on Alpha and not on the ★ Beta row (pattern: `panel.render(80)` then `lines.some(l => l.includes("▸") && l.includes("Alpha"))` / `!lines.some(l => l.includes("▸ ★"))` — mirrors `test_overview_enter_revisit_seeds_to_recorded_answer_row` in panel.test.ts).

**Sites 2–7 — stale seeding comments on ANSWERED questions (comment flips; behavior already correct because each site drives `panel.cursorIndex` explicitly right after).** Replace each `// setter re-seeds the cursor to the ★ "a" preselect` (or `// setter re-seeds the cursor to the ★ preselect`) with a comment stating the recorded-answer seeding and why it coincidentally lands at row 0, e.g.:

```ts
panel.currentId = "q1"; // setter re-seeds to the RECORDED answer's row (ANSWER-PIN-001) — "a" is display row 0 here, coincidentally not the ★'s doing; the proposal is driven explicitly below
```

- Site 2 — line 245, in `test_a_accept_commits_applyAnswer_and_advances_to_next_open`: `expect(panel.cursorIndex).toBe(0); // cursor reset to ★ preselect`. q2 (BASIC) is open with NO recommendation — nothing ★-preselects. Replace comment with: `// q2 open + no recommendation → no-answer seed path clamps to row 0`.
- Site 3 — line 2118, in the AUTOSUBMIT-003 review-flow-exit test: `panel.currentId = "q1"; // setter re-seeds the cursor to the ★ "a" preselect` (q1 answered "a", rec "a" — row 0 by coincidence).
- Site 4 — line 2125, same test, q2 leg: `panel.currentId = "q2"; // setter re-seeds the cursor to the ★ "a" preselect` (q2 answered "a").
- Site 5 — line 2137, in `test_auto_consecutive_edits_each_one_submission_one_epoch_bump`, first edit leg: `panel.currentId = "q1"; // setter re-seeds the cursor to the ★ "a" preselect`.
- Site 6 — line 2167, same test, edits loop: `panel.currentId = edit.id; // setter re-seeds the cursor to the ★ preselect` (loop questions are answered).
- Site 7 — line 2237, in `test_resume_pending_panel_new_commit_flushes_once`: `panel.currentId = "q2"; // setter re-seeds the cursor to the ★ "a" preselect` (q2 answered-pending "a").

**Site 8 — `src/panel/ac-panel.test.ts` line 477**, in AC-6: `expect(panel.cursorIndex).toBe(0); // alpha preselected (no recommendation)`. q09 (the gate question) is OPEN and has no recommendation — nothing preselects; the seed clamps to row 0 because there is no answer and no ★. Replace comment with: `// q09 unanswered, no recommendation → seed clamps to row 0 (no ★ exists yet — ANSWER-PIN-001 leaves unanswered seeding unchanged)`.

### Verified-legitimate rows — LEAVE (do not flip; optionally annotate)

These assert the ★ path on **unanswered** questions, which FR-35 deliberately preserves. Do not change their expectations. Optional (recommended): append a one-line comment `// unanswered path — ★ survives ANSWER-PIN-001` so future readers don't mistake them for missed flips:

- `panel.test.ts:618` `test_overview_enter_jumps_preseeds_cursor_and_focus` (q2 OPEN, rec "b"; the answered twin `test_overview_enter_revisit_seeds_to_recorded_answer_row` sits directly below — T1.S2's work)
- `panel.test.ts:814` `test_cursor_seeds_to_recommendation_and_resets_on_refocus` (all questions OPEN)
- `panel.test.ts:2176` deep-seed-on-entry test (OPEN); `panel.test.ts:2740` duty re-seed (q1 OPEN — the test asserts `answer` stays undefined)
- `overview.test.ts:412` (q1 OPEN, default rec sqlite) and `overview.test.ts:452–453` `test_jump_sets_short_view_current_id_and_preseeds_cursor` (q2 OPEN, rec postgres)
- `deep-view.test.ts:420` and `:501` (OPEN questions); `short-view.test.ts:84–89` (no-answer `initialCursorIndex` unit rows)

### Explicitly out of scope (owned by T5.S10 / T6.S11 — do not touch)

- `src/ac-scripted.test.ts` and `src/regression-phantom-submissions.test.ts` (T5.S10 stabilizes them to no-op semantics)
- The new AC-16 end-to-end scripted test and the binding full-suite gates (`npm test`, keymap guards) — T5.S10
- README usage/AC-list update — T6.S11
- Any production file (`src/**/*.ts` without `.test.`), any fixture shared by other tests, any config/keymap surface

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: FLIP the anchor test (actions.test.ts:796)
  - RENAME test_d_cursor_resets_to_star_preselect_on_every_change →
    test_d_cursor_seeds_to_recorded_answer_on_answered_star_on_open
  - IMPLEMENT: discriminating fixture per Site 1 (q2 rec "b" + answered "a" → assert
    cursorIndex 1 on landing; q1 open rec "a" → assert 0 on return); optional ▸-render
    assertions mirroring panel.test.ts's revisit test
  - KEEP: both legs (answered-pin + open-★); NEVER delete the test
  - GOTCHA: build the scenario with seed([...]) INSIDE the test — do not mutate ALL_STATUSES

Task 2: FLIP the six stale comments in actions.test.ts (Sites 2–7 at lines 245, 2118,
  2125, 2137, 2167, 2237 — locate by the quoted text, lines drift)
  - REPLACE each ★-re-seed justification with the recorded-answer seeding wording
  - PRESERVE every expect() and cursorIndex assignment — comments only

Task 3: FLIP the ac-panel.test.ts:477 comment (Site 8)
  - REPLACE "alpha preselected (no recommendation)" with the unanswered/no-rec clamp wording

Task 4: ANNOTATE (optional) the verified-legitimate rows in panel.test.ts (:618, :828,
  :2176, :2740) and overview.test.ts (:412, :452–453) with the one-line
  "unanswered path — ★ survives ANSWER-PIN-001" marker
  - DO NOT change any expectation

Task 5: VERIFY gates
  - npx vitest run src/panel/          → 16 files green, 630 tests (count must not drop)
  - npm run typecheck                  → clean
  - grep -rn "re-seeds the cursor to the ★\|resets_to_star_preselect" src/panel/*.test.ts → 0 hits
  - git diff --stat                    → only src/panel/*.test.ts files touched
```

### Integration Points

None. Test-only change; no config, routes, schema, or state-machine surface. The next subtask (T5.S10) consumes this one's output as its precondition: "green src/panel/*.test.ts on the new contract".

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck        # tsc --noEmit — catches broken fixture types/typos in edits (~3s)
# Expected: silent success. There is no linter step in this repo's package.json;
# typecheck + vitest are the gates.
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/panel/            # the subtask's own gate (~1.6s)
npx vitest run src/panel/actions.test.ts src/panel/ac-panel.test.ts   # fast inner loop while editing
# Expected: 16 files / 630 tests passed (test count stays ≥ 630 — the anchor test is
# rewritten in place, not removed). If the rewritten anchor test fails, check the
# fixture first: rec "b" + answered "a" must yield display row 1 (D-R13 order).
```

### Level 3: Contract Sweep (regression guard for THIS task)

```bash
# No remaining old-contract claims in the panel suites:
grep -rn "re-seeds the cursor to the ★\|resets_to_star_preselect" src/panel/*.test.ts
# Expected: no output (exit 1)

# No accidental production edits:
git diff --name-only
# Expected: only src/panel/actions.test.ts, src/panel/ac-panel.test.ts,
#           and (if annotated) src/panel/panel.test.ts, src/panel/overview.test.ts

# Coincidence check — the flipped anchor must FAIL against the old contract's shape:
# temporarily change the Site-1 assertion to toBe(0) and confirm vitest reports a
# failure on the q2 leg (proves the fixture discriminates), then restore toBe(1).
```

### Level 4: Neighbor Suites (cheap sanity — full suite is T5.S10's gate)

```bash
npx vitest run src/panel/ src/ac-scripted.test.ts   # scripted flows must still pass
# (ac-scripted stabilization is T5.S10's job — if this reveals failures beyond
#  comment-level drift, STOP and report; do not expand scope)
```

## Final Validation Checklist

### Technical Validation
- [ ] `npx vitest run src/panel/` green — 16 files, 630 tests, count not reduced
- [ ] `npm run typecheck` clean
- [ ] Contract sweep grep (Level 3) returns zero hits
- [ ] `git diff --name-only` lists only panel test files

### Feature Validation
- [ ] Anchor test renamed, both legs present, answered leg asserts display row 1 with a ★ at row 0 (discriminating)
- [ ] All six actions.test.ts seeding comments + the ac-panel comment state the recorded-answer/clamp path
- [ ] No expectation changed on verified-legitimate unanswered rows
- [ ] No test deleted, skipped, or weakened anywhere

### Code Quality Validation
- [ ] New comments cite ANSWER-PIN-001 (FR-35) so the rationale is grep-able
- [ ] No edits to fixtures shared with other tests (ALL_STATUSES untouched)
- [ ] Out-of-scope files (ac-scripted, regression-phantom, README, any src/*.ts) untouched

## Anti-Patterns to Avoid

- ❌ Don't "fix" a stale row by deleting it or loosening the assertion — flip means assert the NEW contract
- ❌ Don't flip legitimate unanswered-★ rows to expect answer-seeding — FR-35 preserves ★ preselect on unanswered questions; those rows are correct as-is
- ❌ Don't mutate shared fixtures (ALL_STATUSES, BASIC, choiceQ defaults) to make a point — build per-test scenarios
- ❌ Don't trust line numbers blindly — locate by the quoted content (insertions from T1/T2 subtasks shifted everything after ~line 400)
- ❌ Don't edit production code to make a test pass — the code is correct; only tests are stale
- ❌ Don't expand into T5.S10's scope (ac-scripted / regression-phantom / AC-16 / full-suite gates)

---

**Confidence Score: 9/10** — every flip site is verified by content against the working tree today, the discriminating fixture shape is derived from the actual `seed`/`displayOptions` behavior, and the gates are proven runnable. Residual 1/10 risk: an additional stale comment deeper in the 2.6k-line actions.test.ts that the content sweep patterns missed — mitigated by the Level 3 sweep and the instruction to flip any further ★-re-seed-on-answered claim found while editing.

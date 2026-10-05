# PRP — P1.M1.T1.S2: Purge seed-site JSDoc/comments; flip seed assertions

## Goal

**Feature Goal**: Finish FR-D8 (ANSWER-PIN-001 / FR-35): the three cursor **seed sites** inherit S1's rewritten `initialCursorIndex` automatically — this subtask (a) purges/rewrites every stale "answers never pin the cursor" / "next enter should ACCEPT the recommendation" comment at those sites, (b) flips/adds the seed assertions in `actions.test.ts` (~:995, EXPLAIN-003 re-seed) and `panel.test.ts` (~:618, currentId/overview-jump seed) to the pinning contract, proving inheritance for downstream subtasks. **NO logic changes.**

**Deliverable**: Comment/JSDoc edits in `src/panel/panel.ts` (two sites) and `src/panel/deep-view.ts` (one site); test flips/additions in `src/panel/actions.test.ts` and `src/panel/panel.test.ts`.

**Success Definition**:
- No comment at the three seed sites claims ★ preselect applies to answered questions or that enter should accept the recommendation; each site's docs state the pinning inheritance (recorded answer owns the caret; ★ only while unanswered)
- New green tests: editor-close re-seed on an ANSWERED question lands on the recorded answer's display row (not 0/★); currentId/overview-jump seed on an ANSWERED question lands on the recorded answer's display row
- Existing unanswered-preselect rows stay green (comments corrected where stale)
- `npm run typecheck` + full `npm test` green

## Why

h2.65: ANSWER-PIN-001 supersedes EXPLAIN-003's "✎ cursor re-seeds to ★ when the editor closes" clause (it re-seeds to the recorded answer when one exists) "and every doc/test asserting status-agnostic preselect — those tests were testing the bug." S1 rewrote the function's logic and its own doc blocks; the three seed sites' comments still assert the dead contract and would mislead every future reader (and S3/S4–S6/S9 build on these seams). Tests pinning the OLD behavior must flip so the inheritance is contractual.

## What

1. **panel.ts `set currentId` (~:354–364)**: update the setter's JSDoc to state: cursor seeds via `initialCursorIndex` — a recorded answer owns the caret (its display row / ✎ Other row); ★ preselect applies only while unanswered (FR-35/ANSWER-PIN-001). Keep the EXPLAIN-002 buffer-scoping comment (still true).
2. **panel.ts editor-close re-seed (~:883–893)**: PURGE the comment claiming "re-seed to the ★ preselect (R2 discipline) … the next enter should ACCEPT the recommendation, not re-open the editor." Replace with: re-seeds to the RECORDED answer when one exists; ★ only when unanswered (ANSWER-PIN-001 supersedes EXPLAIN-003's ★ clause — h2.65 ruling 5). Code (the `if (q !== undefined && …)` guard + `initialCursorIndex(q)` call) unchanged.
3. **deep-view.ts `deepSeedCursorIndex` JSDoc (~:559–571)**: rewrite the opening "the ★ recommendation preselect (R2, via initialCursorIndex)" claim: seeds follow `initialCursorIndex` — the recorded answer when present (the ✎ Other index is legal under the `count` clamp bound; stale values clamp to row 0), ★ preselect only for unanswered questions. Keep the D-R14/clamp-bound facts (still true).
4. **actions.test.ts ~:995** (EXPLAIN-003 empty-buffer test): q1 there is UNANSWERED — its `cursorIndex === 0` assertion stays (★ row 0), but fix the stale inline comment. ADD the flip: same flow with q1 carrying a recorded non-recommended answer → after editor close off the ✎ row, `panel.cursorIndex` equals the answer's display row (not 0).
5. **panel.test.ts ~:618** (`test_overview_enter_jumps_preseeds_cursor_and_focus`): the fixture jumps to an UNANSWERED q2 → row-0 ★ assertion stays (comment already correct: "★ preselect — display 0 under D-R13 order"). ADD the revisit variant: q2 WITH `answer` (value "a", recommendation "b") → after overview ENTER jump, `panel.cursorIndex === 1` (display row of "a" under D-R13: ★ "b" first), and the rendered `▸` cursor sits on a's row (assert the rendered line contains `▸` + a's label and NOT `▸ ★`).

### Success Criteria

- [ ] All three seed sites' docs state pinning inheritance; zero residual ★-on-answered claims in panel.ts/deep-view.ts seed contexts (grep gate below)
- [ ] EXPLAIN-003 answered-re-seed test green (recorded row, not 0/★)
- [ ] Overview-jump/currentId revisit seed test green (recorded display row; ▸ on a's row)
- [ ] Unanswered rows in both tests unchanged and green
- [ ] Zero source-code (non-comment) changes; typecheck + full suite green

## All Needed Context

### Context Completeness Check

Repo fully implemented, suites green pre-changeset. This is comment-only source edits + two test files; every site was read in the working tree and excerpted in the research notes. An agent needs this PRP plus the four named files.

### Documentation & References

```yaml
- file: plan/003_f8af1c6f6c49/P1M1T1S1/PRP.md
  why: "CONTRACT — S1's initialCursorIndex decision order (answer.custom → options.length; value → displayOptions row; stale → 0; text → 0; no answer → ★ row); S1 explicitly reserved seed-site comments for THIS subtask"
  critical: "the ✎ row index is (q.options ?? []).length; display row mapping is displayOptions (D-R13 recommended-first) — test expectations must be computed in DISPLAY order, e.g. 2-option q with rec 'b' answered 'a' → answer row 1"

- file: plan/003_f8af1c6f6c49/P1M1T1S2/research/notes.md
  why: "verbatim current excerpts of all three seed-site comment blocks + both test sites, the purge grep, and the inheritance proof (every site calls initialCursorIndex; no site computes a recommendation index itself)"

- file: plan/003_f8af1c6f6c49/architecture/panel-ui-seams.md
  why: "§Cursor seeding — verified seed-site inventory (@ c7d44c0): panel.ts:354 setter, panel.ts ~888-896 EXPLAIN-003 site, deep-view.ts:568 clamp bound tolerates the ✎ index"

- file: src/panel/panel.ts
  why: "set currentId :354-364 (EXPLAIN-002 comment stays) and editor-close re-seed :883-893 (comment :883-887 is the purge target)"
  gotcha: "the surrounding code (guard + initialCursorIndex call) is CORRECT post-S1 — touch comments only"

- file: src/panel/deep-view.ts
  why: "deepSeedCursorIndex JSDoc :559-566 + impl :568-571; JSDoc rewrite target"
  gotcha: "keep the true D-R14/clamp-bound sentences (count bound, zero-option → Other row 0) — only the ★-preselect framing is stale"

- file: src/panel/actions.test.ts
  why: "~:995 EXPLAIN-003 test — unanswered fixture stays; add answered variant. Harness: seed/makePanel/accept, panel.textField.setText/handleInput('\\r'), cursorIndex assertions"

- file: src/panel/panel.test.ts
  why: "~:611-622 overview-jump test — add answered-revisit variant. Harness: createInterrogationState + choiceQ + panelArgsFor, CTRL_L, overviewCursor, ENTER, render(80) line assertions"
  gotcha: "render assertions use string includes on rendered lines (existing pattern: l.includes('▸ ★ ') && l.includes('Beta'))"
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
├── panel.ts            # seed sites :354-364, :883-893 — COMMENT/JSDoc edits only
├── deep-view.ts        # deepSeedCursorIndex JSDoc :559-566 — edit only
├── panel.test.ts       # ADD answered-revisit jump-seed variant (~:618)
├── actions.test.ts     # ADD answered EXPLAIN-003 re-seed variant (~:995)
└── short-view.ts       # S1 owns — DO NOT TOUCH
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: NO logic changes — if a new test FAILS, the bug is in S1's
//   initialCursorIndex (or the test's expected display row), never in the
//   seed-site code. Do not "fix" the seed sites.
// GOTCHA: display rows are displayOptions order (D-R13: recommended first).
//   2-option q {a,b}, recommendation "b", answer "a" → display [b,a]; the
//   answer's display row is 1, the ★ row is 0. Compute every flipped
//   expectation through that order.
// GOTCHA: write-in answered questions seed to options.length (the ✎ row) —
//   if you add a write-in variant, expected index is options.length.
// GOTCHA: the EXPLAIN-003 re-seed guard only fires when the cursor was on/
//   past the ✎ row (cursorIndex >= options.length) — build the answered
//   variant the same way the existing test does (cursor to the ✎ affordance,
//   open editor, empty buffer, enter) so the re-seed path actually runs.
// GOTCHA: keep test names/comments accurate — rename the stale inline
//   comments ("EXPLAIN-003 ★ re-seed off the Other row" → pinning wording)
//   so future readers don't re-import the dead contract.
// GOTCHA: do NOT sweep actions.ts / keys.ts / overview.ts comments — that is
//   P1.M1.T4.S8; this subtask touches ONLY the three seed sites + two tests.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: PURGE panel.ts editor-close comment (:883-887)
  - REPLACE the "re-seed to the ★ preselect (R2 discipline) — … the next
    enter should ACCEPT the recommendation" block WITH the pinning statement
    (recorded answer when present; ★ only unanswered; ANSWER-PIN-001
    supersedes EXPLAIN-003's ★ clause, h2.65 ruling 5).

Task 2: UPDATE panel.ts set currentId JSDoc (:354 area)
  - ADD pinning-inheritance sentence to the setter's doc block; keep the
    EXPLAIN-002 comment inside the body verbatim.

Task 3: REWRITE deep-view.ts deepSeedCursorIndex JSDoc (:559-566)
  - New opening: seeds follow initialCursorIndex — recorded answer owns the
    caret (✎ Other index legal under the count clamp; stale → row 0); ★
    preselect only while unanswered. Keep clamp/zero-option facts.

Task 4: FLIP/ADD actions.test.ts EXPLAIN-003 coverage (~:985-1000)
  - Keep the existing unanswered test; correct its cursorIndex inline comment.
  - ADD test (same harness): seed q1 with overrides { answer: { value: "a",
    at: T0 }, status: "answered" }, recommendation "b"; cursor to ✎ row,
    accept → editor; empty-buffer enter; ASSERT panel.cursorIndex === 1
    (display row of "a"), render's ▸ NOT on the ★ row.

Task 5: ADD panel.test.ts revisit jump-seed variant (~:618)
  - Clone test_overview_enter_jumps_preseeds_cursor_and_focus with q2
    overrides { recommendation: "b", answer: { value: "a", at: T0 },
    status: "answered" }; after CTRL_L + overviewCursor=1 + ENTER:
    expect cursorIndex === 1, view "short", and render line with ▸ on a's
    label (and no "▸ ★" on b's line).
  - (Optional cheap sibling: direct panel.currentId = "q2" setter assertion —
    same seam; skip if the jump path already covers it.)

Task 6: GREP GATE + run
  - rg -n "preselect|ACCEPT the recommendation|answers never pin" src/panel/panel.ts src/panel/deep-view.ts
    → remaining hits must be explicitly unanswered-scoped wording only
  - npm run typecheck && npm test
```

### Implementation Patterns & Key Details

```ts
// Replacement comment for the editor-close site (panel.ts ~:883):
// EXPLAIN-003 cursor landing (ANSWER-PIN-001): when the explain editor
// closes on a CHOICE question with the cursor resting on the ✎ affordance,
// re-seed via initialCursorIndex — to the RECORDED answer's display row
// when one exists (the ✎ row for write-ins), to the ★ preselect only
// while the question is unanswered. Supersedes the old "next enter should
// ACCEPT the recommendation" clause (h2.65).

// Test expectation arithmetic (D-R13): display order is recommended-first,
// so with options [a,b] + recommendation "b" + answer "a":
//   display = [b(★, row 0), a(row 1)] → expect(panel.cursorIndex).toBe(1);
```

### Integration Points

```yaml
S1: "consumes the rewritten initialCursorIndex — comment edits must match its exact decision order (custom → options.length; value → display row; stale → 0; text → 0)"
DOWNSTREAM: "S4-S6 (inert no-ops) and S9 (cross-suite flips) build on these seams — the green flipped tests here are their inheritance proof"
S8: "the broader comment sweep (actions.ts, keys.ts, overview.ts) is P1.M1.T4.S8 — out of scope here"
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/actions.test.ts -v   # EXPLAIN-003 rows: unanswered kept + answered variant green
npx vitest run src/panel/panel.test.ts -v     # jump-seed rows green
npm test                                       # full suite green
```

### Level 3: Inheritance regression

```bash
npx vitest run src/panel/deep-view.test.ts src/panel/short-view.test.ts
# deep clamp + the S1 function rows — unaffected by comment edits; must stay green
```

### Level 4: Purge verification (manual)

- [ ] Read all three seed sites top-to-bottom: no sentence implies ★ owns the caret after an answer exists
- [ ] `rg -n "preselect|ACCEPT the recommendation|answers never pin" src/panel/panel.ts src/panel/deep-view.ts` — every remaining hit is unanswered-scoped
- [ ] `git diff` shows NO non-comment source changes in panel.ts / deep-view.ts

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → green
- [ ] Three seed sites' docs state the pinning inheritance ([Mode A])
- [ ] EXPLAIN-003 answered re-seed test green (recorded display row)
- [ ] Overview-jump revisit seed test green (recorded display row; ▸ not on ★)
- [ ] Unanswered preselect rows in both tests unchanged and green
- [ ] Zero logic changes (git diff confirms comment-only in panel.ts/deep-view.ts)
- [ ] No edits to short-view.ts (S1's) or actions.ts/keys.ts/overview.ts comments (S8's)

## Anti-Patterns to Avoid

- ❌ Don't touch seed-site code — inheritance is automatic; failing new tests mean wrong expectations or an S1 bug, not a site bug
- ❌ Don't compute expected rows from raw `q.options` order — use displayOptions (D-R13) order
- ❌ Don't flip the UNANSWERED assertions (~:995 as-is, ~:618 as-is) — only add answered variants
- ❌ Don't delete the still-true clamp/D-R14/EXPLAIN-002 sentences while purging
- ❌ Don't expand the sweep beyond the three seed sites — S8 owns the rest

---

**Confidence Score**: 9/10 — comment-only source edits with verbatim replacement text provided, exact test sites read from the working tree, expectation arithmetic spelled out (D-R13 display order), and the S1 contract is pinned in its PRP. The only care point (not flipping valid unanswered rows) is flagged in three places.

# Research — P1.M1.T1.S2: purge seed-site JSDoc/comments; flip seed assertions

Verified against working tree (pre-S1) + architecture/panel-ui-seams.md (§Cursor seeding, verified @ c7d44c0).

## The three seed sites (comment-only edits; logic inherits S1's new initialCursorIndex)
1. **src/panel/panel.ts:354–364** `set currentId(id)` — `this.cursorIndex = q !== undefined ? initialCursorIndex(q) : 0;`. Current comment block (:357–363) is EXPLAIN-002 buffer-scoping — mostly fine; the setter's surrounding JSDoc must state pinning inheritance: cursor seeds to the RECORDED answer when present, ★ preselect only when unanswered (FR-35).
2. **src/panel/panel.ts:883–893** editor-close re-seed (EXPLAIN-003 site). Current comment (883–887) claims: "re-seed to the ★ preselect (R2 discipline) … the next enter should ACCEPT the recommendation, not re-open the editor." — THE claim to purge. New statement: re-seeds to the RECORDED answer when one exists (its display row / ✎ row); ★ only when unanswered (ANSWER-PIN-001 supersedes EXPLAIN-003's clause per h2.65 ruling 5).
3. **src/panel/deep-view.ts:559–571** `deepSeedCursorIndex` JSDoc: "Seed the deep selection … the ★ recommendation preselect (R2 …)". Rewrite: seeds via initialCursorIndex — the recorded answer when present (incl. ✎ Other index, tolerated by the `count` clamp bound), ★ preselect only for unanswered; clamp-to-display-row-0 stale behavior inherits too.

## Test flips
- **src/panel/actions.test.ts ~:995** (EXPLAIN-003 empty-buffer test): `expect(panel.cursorIndex).toBe(0); // EXPLAIN-003 ★ re-seed off the Other row`. q1 in this fixture is UNANSWERED → cursor 0 remains CORRECT (★ row 0), only the comment is stale. Per the item contract "EXPLAIN-003 re-seed now expects the recorded answer": flip applies when an answer exists — ADD/extend a variant where q1 has a recorded answer (non-recommended value) → after editor close on the ✎ row, cursorIndex === answer's display row, NOT 0/★. Keep the unanswered row green with corrected comment.
- **src/panel/panel.test.ts ~:618** `test_overview_enter_jumps_preseeds_cursor_and_focus`: jumps to q2 with `recommendation: "b"` and NO answer → expects cursor 0 ("★ preselect — display 0 under D-R13"). Unanswered → UNCHANGED behavior. The flip target is a revisit variant: q2 WITH `answer` (e.g. value "a", rec "b") → after ENTER jump, `panel.cursorIndex` === display row of "a" (1 under D-R13: ★ b first, a second), and the rendered row `▸` sits on a's row, not the ★ row. Also the currentId setter path (panel.currentId = "q2") is the same seam — one variant covers both.

## Inheritance proof (why no logic changes)
All three sites call `initialCursorIndex(q)` (S1 rewrites it): setter panel.ts:357; editor-close panel.ts:893 `this.cursorIndex = initialCursorIndex(q)`; deep-view.ts:570 `Math.min(initialCursorIndex(q), count)` (count bound = options.length, tolerates ✎ index options.length). No arithmetic on recommendation anywhere at the sites.

## Purge list for these files (grep targets)
`rg -n "preselect|ACCEPT the recommendation|answers never pin|★ preselect" src/panel/panel.ts src/panel/deep-view.ts src/panel/actions.test.ts src/panel/panel.test.ts` — every hit in panel.ts/deep-view.ts seed contexts must either be rewritten (answer-pins wording) or confined to explicitly-unanswered contexts. (Other files — actions.ts, keys.ts, overview.ts — are S8's sweep, NOT this subtask.)

## S1 contract consumed
initialCursorIndex(q): answer present + custom → options.length; answer value in options → its displayOptions row; stale → 0; text → 0; no answer → ★ row (D-R13) or 0. Signature unchanged.

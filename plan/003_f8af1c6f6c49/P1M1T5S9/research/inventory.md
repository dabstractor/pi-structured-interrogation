# P1.M1.T5.S9 research — verified flip inventory (2026-10-05)

Baseline: post-`f3e00c5` (all prior subtasks T1.S1–T4.S8 Complete).
`npx vitest run src/panel/` = 16 files / 630 tests GREEN. `npm run typecheck` green (~3s).
Green ≠ done: several rows pass COINCIDENTALLY (recorded answer sits at display row 0,
where the old ★-preseed also landed) or are comment-only stale. Located by content per
testing-verification.md ("lines drift").

## Prior-subtask coverage (verified via git show — do NOT re-flip)
- 1fba337 (T1.S1): short-view.test.ts initialCursorIndex rows rewritten; two-stage.test.ts
  and actions.test.ts ~1975 supersede comments carry "FR-35 note" — flipped.
- 886489c (T1.S2): added panel.test.ts `test_overview_enter_revisit_seeds_to_recorded_answer_row`
  (+620) and actions.test.ts `test_wi_enter_empty_buffer_reseeds_to_recorded_answer_row`;
  actions.test.ts ~995 EXPLAIN-003 comment re-justified (q1 unanswered → ★ row 0, correct).
- d6d1553 (T2.S4) / 2d7a98f (T2.S5): same-value no-op rows actions.test.ts ~395–660 (option,
  digit, write-in, closed, complete-set) — all assert the inert contract.
- 4a9d277 (T2.S6): deep-view.test.ts acceptFromDeep same-value/veto rows (~507) — flipped.
- 7972f88 (T3.S7): layout.test.ts ★ answered marker rows — flipped.
- f3e00c5 (T4.S8): comment sweep covered NON-test files only (its grep gates exclude *.test.ts).

## REMAINING STALE — T5.S9 flips
| # | File:line (today) | Content | Why stale | Fix |
|---|---|---|---|---|
| 1 | actions.test.ts:796 | `test_d_cursor_resets_to_star_preselect_on_every_change` (ALL_STATUSES): `nextQuestion` → q2 asserts `cursorIndex` 0 `// q2 ★ preselect (recommendation "a")`; prev → q1 `// q1 recommendation preselect again` | q2 is ANSWERED ("a" via seed default) — landing seeds to the recorded answer's row now; q2 has NO recommendation, so the comment is doubly wrong; passes only because answer "a" = display row 0 | Full flip: own seed (q1 open rec "a"; q2 rec "b" + answered "a"), assert row 1 (recorded) on q2, row 0 (★ on OPEN q1) on return; rename |
| 2 | actions.test.ts:245 | `// cursor reset to ★ preselect` after accept advances to q2 (BASIC: q2 open, NO recommendation) | Nothing ★-preselects — no rec on q2; it's the no-answer/no-rec clamp to row 0 | Comment flip naming the real path |
| 3 | actions.test.ts:2118 | `panel.currentId = "q1"; // setter re-seeds the cursor to the ★ "a" preselect` — q1 ANSWERED "a" at this point (review-flow-exit test) | On an answered question the setter re-seeds to the RECORDED answer's row (coincidentally 0: answer "a" = display row 0) | Comment flip (test already drives cursorIndex explicitly) |
| 4 | actions.test.ts:2125 | same pattern, q2 (review-flow-exit test, `// setter re-seeds the cursor to the ★ "a" preselect`) | q2 ANSWERED "a" | Comment flip |
| 5 | actions.test.ts:2137 | same pattern, q1 (consecutive-edits test) | q1 ANSWERED | Comment flip |
| 6 | actions.test.ts:2167 | `panel.currentId = edit.id; // setter re-seeds the cursor to the ★ preselect` (edits loop over answered q1/q2) | loop questions are ANSWERED | Comment flip |
| 7 | actions.test.ts:2237 | `panel.currentId = "q2"; // setter re-seeds the cursor to the ★ "a" preselect` (resume-pending test; q2 answered pending) | q2 ANSWERED "a" | Comment flip |
| 8 | ac-panel.test.ts:477 | `expect(panel.cursorIndex).toBe(0); // alpha preselected (no recommendation)` — q09 gate, OPEN, no rec | Nothing preselects: unanswered + no rec → clamp row 0 (no ★ exists) | Comment flip naming the clamp path |

These are the delta-PRD anchors :541 (→796) and :1878/:1948 (→2118–2237 region after
+291 lines of prior-subtask insertions) plus content-sweep finds (:245, :477).

## VERIFIED LEGITIMATE — leave untouched (unanswered ★ path survives FR-35)
- panel.test.ts:618 `test_overview_enter_jumps_preseeds_cursor_and_focus` (q2 OPEN, rec "b";
  answered twin added by T1.S2 directly below) · :814/:828 seed-cycle test (all questions OPEN)
  · :2176 deep-seed test (OPEN) · :2740 duty re-seed (q1 OPEN, answer asserted undefined)
- overview.test.ts:412 (q1 OPEN, default rec sqlite) · :452–453 (q2 OPEN, rec postgres)
- deep-view.test.ts:420, :501 (OPEN questions); ripple-veto row ~507 already flipped
- short-view.test.ts:84–89 (no-answer initialCursorIndex unit rows — the unchanged contract)

## Non-goals confirmed elsewhere
- src/ac-scripted.test.ts + src/regression-phantom-submissions.test.ts + new AC-16 test +
  full-suite gates → T5.S10. README → T6.S11. No production-file edits in S9.

## Gate commands (verified working)
- `npx vitest run src/panel/` (16 files / 630 tests, ~1.6s)
- `npm run typecheck` (tsc --noEmit, ~3s)
- Sweep: `grep -rn "re-seeds the cursor to the ★\|resets_to_star_preselect" src/panel/*.test.ts` → 0 hits after flip

# P2.M1.T4.S1 research notes

## Where is the "submit pending answers first" edge?

- `grep -rni "submit pending|pending answers first|submitPending" src/` → **ZERO hits in code**. The string exists only in spec text (`spec/ui-spec.md:74`, `:138`) and plan docs (`delta_prd.md:23`, `:69`).
- delta_prd.md removals list names it as an awareness-level removal: "the `submit pending answers first` edge (completeness ships itself)" — no file/line anchors, unlike the two-stage and reconstruct removals which have exact anchors.
- Conclusion: the edge never existed as a distinct code branch in the current codebase (or was superseded when `maybeAutoSubmit` landed in commit `fbe6942`). The work is: (a) verify absence with greps + a regression lock, (b) write the scripted tests this subtask calls for.

## Relevant code anchors

- `src/panel/actions.ts`
  - `maybeAutoSubmit(panel, deps?)` at :593 — zero open/reasked + ≥1 answered → `submit()` + flash `submitted — {n} answer(s)`. No-op on zero pending / no delivery.
  - `submit(panel, deps)` at :449 — reconcileDraftsForSubmit → baseline/diff → BUG-008 filter → gate warning → markSubmitted → buildSubmission (which alone does takeSnapshot + bumpEpoch) → deliverSubmission → noteSubmissionDelivered → note clear.
  - Commit tails calling the hook: :251 (accept path) and :311 (write-in direct-commit exit).
- `src/state.ts` — `bumpEpoch()` :397-403 bumps epoch, emits `epoch-bumped` (new value). `epoch` starts at 1 (:235). JSDoc :201-210 already documents autosubmit-per-firing bump (P2.M1.T1.S1).
- `src/delivery.ts` — `buildSubmission` performs snapshot + bumpEpoch exactly once; callers must never bump around it (:19, module header).
- `src/panel/panel.ts:1700-1731` — `resumeOpenPanel`: rung 1 first unanswered; rung 2 "pending-submit state" = everything answered/submitted/terminal → `lastFocusId` if active; rung 3 first active. The suspended-mid-delivery resume lands on rung 2.
- `src/panel/suspend.ts` — `hasResumableQuestions` counts answered-pending as resumable (BUG-005: widget shows "0 open · N answered").

## Existing tests (P2.M1.T1.S1, actions.test.ts :1618-1760+)

- `test_auto_last_open_accept_fires_submit_once_flash_epoch` — one sendMessage, epoch 1→2, flash.
- `test_auto_multi_pending_ships_all_pending_in_one_firing`.
- `test_auto_edit_of_answered_on_complete_set_fires_again` — TWO firings, epoch 3 total. Gap: no CONSECUTIVE-edits loop (3+ edits → one bump each), no `epoch-bumped` event assertion, no snapshot-per-firing count assertion.
- `test_auto_incomplete_set_never_fires`, `test_auto_reasked_question_blocks_the_firing`, `test_auto_zero_pending_complete_set_noops_silently`, `test_auto_no_delivery_surface_noops_without_throwing`, `test_auto_text_enter_via_writein_duty_fires`.
- Missing entirely: the suspended-mid-delivery resume scenario (complete set + pending answers held; one ctrl+s flushes; a new commit flushes via hook) — that's this subtask's AC-9-facing behavior (consumed by P3.M2.T2.S1).

## Test harness conventions (actions.test.ts)

- `seed(specs)` :75, `makePanel(state, { delivery: deps })` :101, `makeDeps(isIdle)` :118 returns `{ deps, sendMessage }` (vi.fn sendMessage).
- Panels constructed directly (not openPanel); `dispose()` where flash timers armed.
- `panel.currentId` / `panel.cursorIndex` steer the accept path; `submit(panel, deps)` called directly for ctrl+s semantics.
- Epoch assertions: `state.epoch`; snapshot ring: `state.snapshots.length` (one per firing via buildSubmission).

## Downstream consumer

- P3.M2.T2.S1 rewrites AC-9 (restart opens nothing; pending answers ship on next commit/submit). This PRP's resume-flush tests define the semantics it consumes.

## Spec authority

- PRD h2.39 edge states: edge is gone; suspended-mid-delivery resumes to pending-submit panel; one ctrl+s or any new commit flushes.
- h2.41: epoch bumps on EVERY submission including every auto-submitted one.
- h2.33: edits of answered questions while complete = one submission per commit (deliberate one-model-turn-per-edit trade-off).

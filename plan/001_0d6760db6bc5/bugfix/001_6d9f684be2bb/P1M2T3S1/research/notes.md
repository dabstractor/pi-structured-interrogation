# Research notes — bugfix P1.M2.T3.S1 (BUG-008 draft-safe submit)

## Verified code facts

- `src/panel/actions.ts` `submit()` (~295–372): `diff = computeDiff(submissionBaseline(panel), panel.state.serialize())` at top; zero-pending early return on `diff.changed.length === 0` → flash "nothing to submit" (held note stays, R3); gate-warning block; `note = panel.drafts?.getNote() || panel.batchNote`; **`pendingIds` = status 'answered' ids computed BEFORE `markSubmitted(panel.state, pendingIds)`**; `buildSubmission(panel.state, diff, note)` (performs takeSnapshot + bumpEpoch itself); **line 355 bug: `panel.drafts?.shipDrafts?.(diff.changed.map(c => c.id))`**; `deliverSubmission(deps, msg, {isIdle: deps.isIdle})`; `deps.noteSubmissionDelivered?.()`; note cleared after delivery.
- `src/panel/panel.ts:112-124` DraftStore surface: `getDraft(id)`, `hasDraft?(id)`, `shipDrafts?(ids?)` (deletes + returns slots). Impl in `src/draft-store.ts`.
- `src/snapshots.ts`: `DiffEntry {id, title, from, to, editedArchived}` (+ optional `value` from parallel P1.M2.T2.S1); `UNANSWERED = "(unanswered)"` const (~line 33); `SubmissionCardData {changed, note?}`; computeDiff is status-blind (answer signatures).
- `src/merge.ts:181-193`: merge rule 2 (re-ask) resets answer→undefined, status 'reasked' — the source of the phantom `from:'old answer' → to:'(unanswered)'` diff entry vs the snapshot baseline.
- `src/delivery.ts` buildSubmission: derives `k` and content from `diff.changed.length`; side-effect tail takeSnapshot→bumpEpoch exactly once, caller must never wrap.
- `src/panel/actions.test.ts` conventions: `seed(specs)`, `makePanel(state, extra?)` (stubTheme + requestRender vi.fn), `makeDeps(isIdle)` → `{deps, sendMessage}`; submit describe at ~490; DraftStore imported from `../draft-store.js`.

## Fix design (PRP contract)

1. `shipDrafts(pendingIds.filter(id => panel.drafts?.hasDraft?.(id)))` — only user-shipped ids.
2. `userChanged = diff.changed.filter(e => pendingIds.includes(e.id) || e.to !== "(unanswered)")` → `buildSubmission(state, {...diff, changed: userChanged}, note)`. Load-bearing disjunct: pure `to`-filter would wrongly drop a genuinely-pending id whose signature ends unanswered.
3. Early-return guard extended: pure-agent-reset diff (userChanged empty) → flash, no side effects (preserves R3 held-note).
4. Parallel-item coordination: P1.M2.T2.S1 (DiffEntry.value) is additive and independent — filter reads only `id`/`to`.

## Regression scenarios pinned in PRP

- Re-asked q1 draft survives submit shipping q2 (the bug report steps).
- Pure agent reset + submit → flash only.
- Shipped draft destroyed (guard against over-preservation).
- editedArchived entries still ship (AC-13).

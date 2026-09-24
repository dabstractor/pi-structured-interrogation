# Research — P1.M1.T3.S1 (audit snapshot-ring consumers, BUG-003 prerequisite)

## Verified code (current HEAD, read-only)

### Ring + take sites
- `Snapshot { epoch, at, state }` on `state.snapshots` (src/state.ts:247-248), ring bound `SNAPSHOT_RING_SIZE = 10` (snapshots.ts:34). Survives `clearForCompletion` (audit trail).
- `takeSnapshot(state)` (snapshots.ts:175-190): pushes `structuredClone(serialize())` labeled with CURRENT `state.epoch`; contract "BEFORE bumpEpoch()". Only two production call sites:
  - `delivery.ts:185` (buildSubmission, after markSubmitted) → snapshots hold 'submitted'
  - `fallback.ts:261` (recordAnswers, after markSubmitted; comment at :260 "BEFORE takeSnapshot — snapshot must hold 'submitted'")
- Close pass: `lifecycle.ts` `runClosePass()` (~:214-243) → `closeSubmitted(state, toClose)` at :227 (merge.ts:282-287, submitted→closed). NO snapshot. Insertion point for S2: after `closeSubmitted`, gated on `toClose.length > 0` (close pass never bumps epoch → same-epoch snapshot holding 'closed').

### Consumer-by-consumer audit (the deliverable of this item)
1. **`submissionBaselineOf`** (snapshots.ts:43-49): returns LAST snapshot's `.state`, else empty baseline. Consumers: panel/actions.ts:145, remote-submit.ts:139. With a close-pass snapshot appended, the baseline becomes the closed-state snapshot → editedArchived (snapshots.ts:209 `before?.status === "closed"`) fires. INTENDED EFFECT — no adjustment. Must be documented (baseline = "most recent ring entry, which after agent settle is the close-pass snapshot").
2. **`digestSince`** (snapshots.ts:294-299): `chain = snapshots.filter(s => s.epoch >= epochFrom).map(s => s.state)` + live serialize; walks CONSECUTIVE PAIRS emitting one line per pair with answer changes (`computeEntries` fires only on `answerSignature` change — snapshots.ts:139-149). A close-pass pair (submitted-snap → closed-snap) has IDENTICAL answers → zero entries → no segment. Safe. Two snapshots at the same epoch are harmless (filter is >=, not ==; duplicates just add a no-op pair). Early return `epochFrom >= state.epoch` unaffected (close pass doesn't bump epoch). NO adjustment; add comment.
3. **`completion.ts:126-128`**: never-used predicate `qs.length===0 && state.snapshots.length===0 && state.epoch<=1`. Close-pass snapshot is gated on `toClose.length>0`, which requires 'submitted' questions, which require a prior submission (which already pushed a snapshot). Predicate unaffected. NO adjustment; add comment.
4. **`fallback.ts` recordAnswers**: takes its own submit-time snapshot; record path guarded by epoch equality (close pass doesn't bump epoch, so no new stale interactions). The :260 comment's invariant is about SUBMIT-time snapshots, not a prohibition on close-time ones — comment wording to be generalized (this item's doc task).
5. **`results.ts`**: "inert snapshot" = deep-copied tool-result concept only (results.ts:7,49,178); does NOT read `state.snapshots`. No assumption.
6. **`reconstruct.ts`**: replays from mirrored toolResults / DiffEntry.value (:333); does not walk the ring. No one-snapshot-per-epoch assumption.
7. **`renderers.ts` / `renderers.test.ts`**: consume `SubmissionCardData`/DiffEntry, not the ring. CHANGED_MARKER at renderers.ts:70/:177 benefits from the fix; no code change.
8. **`persistence.ts`**: does NOT serialize the ring ("mirrored state snapshots" at persistence.ts:55 is an unrelated chat-mirror concept). No disk compat concern.
9. **`debug-commands.ts`**: relies on buildSubmission's takeSnapshot (:232 comment); no close-pass involvement. Fine.
10. **`guards.ts` digestSince usage** (:199, :255): covered by #2 — no-op close-pass segment cannot alter stale messages.

### Tests that may shift when S2 lands
- `src/lifecycle.test.ts` — close-pass tests may assert `snapshots` count/content (audit and adjust HERE, TDD-first: update expected counts to include the close-pass entry).
- `src/completion.test.ts:367-381` — retention test hand-pushes a snapshot; unaffected. `:161` never-used state; unaffected.
- `src/fallback.test.ts` (snapshot-count pins :296,:360-362 etc.) — fallback path untouched; unaffected.
- `src/snapshots.test.ts`, `delivery.test.ts`, `renderers.test.ts`, `ac-scripted.test.ts:554-635`, `panel/actions.test.ts:701` — pure/pinned computeDiff & manufactured-baseline tests; unaffected (actions.test.ts:701 hand-builds its baseline).

### Conclusion
NO hard invariant blocks the close-pass snapshot. Green light for P1.M1.T3.S2 (fix option (a) in architecture/bug-003-snapshots-changed.md). This item lands the audit as code comments + generalized invariant docs, and pre-adjusts lifecycle.test.ts expectations.

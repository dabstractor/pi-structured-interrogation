# BUG-003 — AC-13 `(changed)` marker unreachable through the real submit pipeline

Verified against current HEAD, read-only. All line numbers exact.

## Verified-claims table

| # | Claim | Verdict |
|---|---|---|
| 1 | `src/snapshots.ts` `computeEntries` sets `editedArchived = before?.status === "closed"` | **CONFIRMED** — snapshots.ts:**209** |
| 2 | Snapshots only taken in `delivery.ts buildSubmission` (**:185**) and `fallback.ts recordAnswers` (**:261**), both AFTER `markSubmitted` (statuses 'submitted'); the agent-settle close pass (submitted→closed) never snapshots ⇒ every real post-edit submission diffs against a non-closed baseline ⇒ `editedArchived` always false | **CONFIRMED** |
| 3 | Panel submit baseline is always the LAST snapshot (`submissionBaselineOf`) | **CONFIRMED** — snapshots.ts:43–49 (`snaps[snaps.length - 1]`, empty-baseline before first) |
| 4 | `src/ac-scripted.test.ts` AC-13 test (~:554–635) passes only by hand-building `pre` via `state.serialize()` and calling `computeDiff` directly | **CONFIRMED** — describe "AC-13 — editing an archived answer re-pends and flags (changed)" (~:554); `const pre: SerializedState = state.serialize()` after manually emitting `agent_settled`; `computeDiff(pre, state.serialize())` called directly; `buildSubmission` fed the hand-made diff |

## Exact code

### `src/snapshots.ts` (whole file relevant pieces)

- **`:209`** in `computeEntries` (def :197–217):
  ```ts
  entries.push({
    id,
    title: after?.title ?? after?.prompt ?? before?.title ?? before?.prompt ?? id,
    from: answerSummary(before),
    to: answerSummary(after),
    editedArchived: before?.status === "closed",   // ← line 209
    value: after?.answer?.value,
  });
  ```
  Entry exists iff `answerSignature(before) !== answerSignature(after)` (:139–149, value + NUL + text; undefined ≡ missing/cleared).
- `computeDiff(prev, next, note?)` — :256–272 → `SubmissionCardData` (`changed`, `note?`, `epoch`, `remainOpen`).
- `takeSnapshot(state)` — :175–190: `Snapshot { epoch: state.epoch, at: ISO, state: structuredClone of serialize() }` pushed to `state.snapshots`; ring bound `SNAPSHOT_RING_SIZE = 10` (:34), oldest shifted; **caller contract: BEFORE `bumpEpoch()`** (snapshot labeled with the pre-bump epoch).
- `submissionBaselineOf(state)` — :43–49: last snapshot's `.state`, else empty baseline `{ goal:"", epoch:0, order:[], questions:{}, completed:false }`.
- `digestSince(state, epochFrom)` — :~290+: walks consecutive snapshot pairs → live state (stale-guard digests). Any new snapshot site inserts a link in this chain; pairs with no answer changes contribute nothing.

### Snapshot data structure & persistence

- `Snapshot` type + `snapshots` field owned by `src/state.ts` (:247–248 `readonly snapshots: Snapshot[] = []`; type def ~:100s). `state.serialize()` produces `SerializedState` = `{ goal, epoch, order, questions: {id → {status, answer, …}} }` — **statuses AND answers are stored**, so a snapshot at close-pass time would carry `closed`.
- Ring is in-memory on the state object; survives `clearForCompletion()` (state.ts:152, :411 — goal/epoch/snapshots retained for audit). persistence.ts does not serialize the ring itself ("mirrored state snapshots" in persistence.ts:55 is an unrelated chat-mirror concept). No disk persistence of snapshots found.

### ALL snapshot-taking sites (grep `takeSnapshot` in src, non-test)

1. `src/delivery.ts:185` — inside `buildSubmission` (def :143), AFTER the diff/card is built, tail order: `takeSnapshot(state); state.bumpEpoch();` (:185–186). Every panel/remote submit goes through `submit()` → `markSubmitted` (actions.ts:525) THEN `buildSubmission` — so submit-time snapshots hold `submitted`.
2. `src/fallback.ts:261` — `recordAnswers`: `markSubmitted(state, recorded); takeSnapshot(state); state.bumpEpoch();` — comment at :260 explicitly: "BEFORE takeSnapshot — snapshot must hold 'submitted'". Same `submitted` baseline.
3. No other call sites. `debug-commands.ts:232` relies on buildSubmission doing it; `remote-submit.ts:169`, `remote-bridge.ts:48`, `panel/actions.ts:533` all call buildSubmission.

### The agent-settle close pass (submitted → closed)

`src/lifecycle.ts:206–243` — `agent_settled` handler (:208–212) → `runClosePass()` (:214): filters `status === "submitted"` minus `reaskedThisRun` → `closeSubmitted(state, toClose)` at **:227** (merge.ts:282–287 sets `closed`). **No snapshot here** — this is the missing link. Also `tool_execution_end` re-ask pass (:185–203) sets `submitted → reasked` (rule-1) with no snapshot — same gap but reasked edits are answered-in-baseline anyway.

### Where `(changed)` renders

- **Model-visible delta**: `src/delivery.ts:146–147` — `(e) => \`${e.id}: ${e.to}${e.editedArchived ? " (changed)" : ""}\`` in `buildSubmission`'s `Submitted {k}: …` line.
- **User card**: `src/renderers.ts:70` `const CHANGED_MARKER = " (changed)"` (theme-styled `fg("warning", …)`); appended at **:177** in `buildSubmissionCard` (`{title}: {from} → {to} (changed)`, :104).

### Baseline read side

`src/panel/actions.ts:144–146 submissionBaseline(panel)` → delegates to `snapshots.ts submissionBaselineOf`; used at `submit()` :455. `remote-submit.ts:139` calls `submissionBaselineOf` directly. Both read the LAST snapshot.

## Tests pinning computeDiff / editedArchived / AC-13

- `src/ac-scripted.test.ts:~554–635` `AC-13_editing_archived_answer_re-pends_and_flags_changed` — drives real lifecycle to closed, then hand-builds `pre = state.serialize()` + `computeDiff` directly; pins `editedArchived: true`, `Submitted 1: q1: Postgres (changed) (state epoch 3)`, card `Database: SQLite → Postgres (changed)`.
- `src/panel/actions.test.ts:701` `bug008_edited_archived_entry_still_ships_ac13` — sets `q1` closed by hand via `state.setStatus("q1", "closed")` (:708) so the first submit's snapshot baseline holds `closed`; pins editedArchived through the real submit pipeline. **This is the only "real-pipeline" AC-13 test and it manufactures the closed baseline by hand.**
- `src/snapshots.test.ts:213` `editedArchived_true_only_for_closed_in_prev_regular_edit_stays_false` (+ :128/:148/etc. shape pins) — pure computeDiff pins, incl. `editedArchived: false` for non-closed prev.
- `src/delivery.test.ts:98` `editedArchived_entry_gets_changed_suffix_regular_edit_does_not` — pins `Submitted 2: qa: Postgres (changed); qb: new (state epoch 2)`.
- `src/renderers.test.ts:105` `AC-13: editedArchived entry renders the (changed) marker, styled warning`.
- `src/state.test.ts:60–334` — "changed" counts are upsert diff counts (unrelated semantics, don't confuse).

## Fix options (grounded)

**(a) Snapshot at the close pass** — in `src/lifecycle.ts runClosePass()` (~:214–243), after `closeSubmitted(state, toClose)` (:227): if `toClose.length > 0`, `takeSnapshot(state)` (import from snapshots.ts). Effects:
- `submissionBaselineOf` then returns the close-pass snapshot (statuses `closed`) → next post-edit submit's `computeDiff` sees `before.status === "closed"` → `editedArchived` true through the real pipeline. No snapshots.ts/delivery.ts/renderers changes.
- `digestSince` chain gains a link with identical answers → contributes no segment (safe).
- Contract notes: takeSnapshot labels with `state.epoch` (close pass doesn't bump) — the ring will hold two snapshots at the same epoch (submit-time `submitted`, close-time `closed`). digestSince filters by `epoch >= epochFrom` and walks consecutive pairs; duplicates are harmless. Must be taken only when `toClose` non-empty to avoid ring churn.
- Tests touched: `src/lifecycle.test.ts` (close-pass tests may assert snapshot counts), `ac-scripted.test.ts` AC-13 can now drive the whole thing through real submits (optional rewrite), panel actions AC-13 test at :701 still passes (its hand-built snapshot path is unaffected).
- Risk: `fallback.ts` comment ("snapshot must hold 'submitted'") suggests an intentional invariant — but that's about the submit-time snapshot, not a prohibition on close-time snapshots. Check `compaction.ts`/`results.ts` consumers of `state.snapshots` before landing (none found that assume one-snapshot-per-epoch).

**(b) Diff-time relaxation** — `snapshots.ts:209`: `editedArchived: before?.status === "closed" || (before?.status === "submitted" && …)`. Touches only `computeEntries`, but is semantically leaky: a rule-2 agent re-ask (answer reset → user re-answers) diffs against a `submitted` baseline and would then falsely render `(changed)`. Would need a discriminator (e.g. "was previously delivered/closed") not present in the baseline, or would have to accept false positives. Not recommended without extra state.

**(c) Track archived-ness on the live question** — e.g. set a `wasArchived`/`closedOnce` flag in `closeSubmitted` (merge.ts:282) or in applyAnswer when re-pending a `closed` question, and have `computeEntries` prefer `after.wasArchived` over `before.status`. Touches state.ts (Question type + serialization), merge.ts, snapshots.ts. More invasive; also fixes remote/fallback paths uniformly, but widens the serialized schema (reconstruct.ts/persistence compat).

**Recommendation: (a)** — one call site, preserves all existing test expectations except adding coverage; ring/epoch mechanics already tolerate it.

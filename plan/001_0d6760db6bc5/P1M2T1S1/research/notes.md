# Research notes — P1.M2.T1.S1 Submission delta builder

## Upstream contracts (verified in code)

- `src/snapshots.ts` (S4, complete):
  - `computeDiff(prev: SerializedState, next: SerializedState, note?: string): SubmissionCardData`
  - `SubmissionCardData = { changed: DiffEntry[]; note?: string; epoch: number; remainOpen: number }`
  - `DiffEntry = { id; title; from; to; editedArchived }` — renderer adds "(changed)" marker; content line must also mark changed entries itself (AC-13 style).
  - `takeSnapshot(state)` — CALLER CONTRACT: must run BEFORE `state.bumpEpoch()` (pre-bump epoch label). Exactly what this item's side-effect order requires.
  - `computeDiff`'s `epoch` field = `next.epoch` — computed BEFORE the bump if caller serializes pre-bump. So: flush → serialize next → computeDiff → build → snapshot → bumpEpoch keeps content/details epoch = submitted epoch consistently.
- `src/state.ts`: `applyAnswer(id, answer)` sets status "answered" (pending h2.38), never touches rev. `bumpEpoch()` emits `epoch-bumped` then `changed`. Draft store (P1.M4.T2.S1) does NOT exist yet — "flush pending answers into state" is the PANEL's future responsibility; buildSubmission documents the ordering contract but only owns snapshot+bump.
- `src/fallback.ts` `recordAnswers` precedent: one call = one submission = ONE `takeSnapshot` + ONE `bumpEpoch`. Follow the same discipline here.
- `src/results.ts`: `buildStatusLine(state)` exists; not needed in content (content format is fixed by h3.6).

## pi API (docs/extensions.md §sendMessage, lines ~1416-1440)

```ts
pi.sendMessage({
  customType: "...", content: "...", display: true, details: {...},
}, { triggerTurn: true, deliverAs: "steer" });
```

Message shape `{customType, content, display, details}` is exactly the deliverable object of buildSubmission. The actual `pi.sendMessage` call + triggerTurn is P1.M2.T1.S2 (next item) — this PRP only BUILDS the object.

## PRD constraints

- h3.6 (submit flow): side-effect order flush → build → epoch++/snapshot; content ≤3 lines (commitment 2).
- h2.36: renderer draws user-only card from `details.card`; card data = SubmissionCardData.
- AC-2: "≤3-line delta + reminder", epoch bumps; AC-13: "(changed)" marker on edited archived answers.
- h2.3 naming: customType `interrogation-submission`.

## Design decisions

1. `buildSubmission(state, diff, note?)` — pure-ish: returns the message object AND performs takeSnapshot+bumpEpoch as documented side effects (h3.6 explicitly assigns these to the submit flow, and snapshots.ts JSDoc names P1.M2.T1.S1 as the wiring owner).
2. Content line 1: `Submitted {k}: {list}` where list is `id: value` pairs joined by `; ` — but PRD says id→value with changed marked. Use `q3: postgres (changed)` style (mirrors AC-13 "Q3: sqlite → postgres (changed)"; reuse DiffEntry.to label-preferred summaries + editedArchived flag). Truncate list to keep total ≤3 lines (content-length budget in JSDoc).
3. Epoch in content/details = pre-bump epoch (the epoch being submitted), matching snapshot labels and diff.epoch.
4. Note lives ONLY in `details.note` (renderer shows the NOTE: line per h2.36); content stays 2 lines + reminder.

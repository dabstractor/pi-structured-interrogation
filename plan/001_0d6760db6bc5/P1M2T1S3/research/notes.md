# Research notes — P1.M2.T1.S3 Completion record builder

## Inputs available (verified in code)
- `src/state.ts`: `InterrogationState` — `goal`, `epoch`, `orderedQuestions()`, `getQuestion(id)`, `serialize()`, `clearForCompletion()` (NOT to be called here — lifecycle owns it), `snapshots: Snapshot[]` ring of 10. `Question` fields: `id, title?, prompt, type, options?, recommendation?, group?, status, answer?: {value, text?, at}`. Statuses: open/answered/submitted/reasked/moot/withdrawn/closed.
- `src/snapshots.ts`: `Snapshot {epoch, at (ISO), state: SerializedState}`, `answerSummary` is private (NOT exported) — label-preferred answer summary must be re-derived or a small local helper. `computeDiff` exists but is for submissions.
- `src/depends-on.ts`: `evaluateDependsOn(state)` → `MootEvaluation {mootered: MootReason[{id, reason: "moot: dep=value"}], reopened}`. Moot reasons are NOT persisted on `Question` — they are recomputed by calling `evaluateDependsOn`.
- `src/merge.ts`: withdrawn questions stay in map; `WithdrawalInfo.reason` is the fixed string `"withdrawn"`. No reason field on `Question`.
- `src/delivery.ts` (S1 landed): `buildSubmission`, `SubmissionMessage`. S2 (parallel, contract) adds `deliverSubmission(pi, msg, ctx?)`, `SendableMessage = SubmissionMessage` alias — S3 widens that union.

## Record format (h2.46, verbatim)
```
INTERROGATION COMPLETE — {goal}
[group] {id} {title}: {answer value/label} {★ if recommendation followed} {— free text}
…every question, grouped, in order…
NOTES: {batch notes in order}
Withdrawn/moot: {ids + reasons}
```

## Key decisions
- Batch notes are NOT persisted anywhere in state (S1 passes note only in the message `details`). Therefore `buildCompletion(state, notes?)` accepts `notes: string[]` — the completion trigger (P1.M2.T2.S2) collects them from submissions and passes them in.
- Withdrawn/moot reasons: derived, not stored. Withdrawn → `withdrawn`; moot → current `evaluateDependsOn(state).mootered` reasons.
- Label-preferred answer summary must be replicated locally (snapshots.ts's `answerSummary` is module-private; follow its exact rule: choice→option label for value (fallback raw value), text→raw value, no answer→`(unanswered)`).
- Pure function: NO snapshot, NO bumpEpoch, NO clearForCompletion (lifecycle P1.M2.T2.S2 owns: "dismiss panel; clear state" after sending).
- Grouping: use `q.group ?? UNGROUPED_LABEL` in first-appearance order via `orderedQuestions()`; within group, order[] order.

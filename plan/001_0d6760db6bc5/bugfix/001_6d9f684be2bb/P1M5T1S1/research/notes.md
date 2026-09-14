# Research notes — bugfix P1.M5.T1.S1 (replaySubmission prefers DiffEntry.value)

## Verified codebase facts

- `src/reconstruct.ts`:
  - `replaySubmission(state, details)` (~lines 279–296): iterates `details.changed`, skips unknown ids / non-string / empty / `(unanswered)` `to`, then `state.applyAnswer(id, { value: to, at: new Date().toISOString() })`. Comment on the apply line says "Best-effort: `to` is the label-preferred display summary..." — this is the comment to update (contract 5).
  - `UNANSWERED_SUMMARY = "(unanswered)"` module const at ~line 134 with a sync-reference comment to snapshots.ts.
  - `SUBMISSION_ENTRY_TYPE = "interrogation-submission"` local literal mirroring delivery.ts.
  - Engine flow: `reconstructFromBranch` → walkBranch → base from last interrogate toolResult `details.state` → newest mirror → none; submission replay is position-filtered (tool-result base: skip `submission.index <= toolIndex`) or epoch-filtered (mirror base: skip `epoch < state.epoch`); `replaySubmission` bumps epoch once per applied submission; `evaluateDependsOn(state)` runs once after replay (~line 368).
  - `replaySubmission` returns boolean (applied > 0) → caller counts `replayed`.
- `src/snapshots.ts` (already landed by P1.M2.T2.S1):
  - `DiffEntry` has `value?: string` — RAW post-change `answer.value`, `undefined` when the post-change side is unanswered/missing (line ~170: `value: after?.answer?.value`). History written before the field carries no `value` (documented in the interface JSDoc).
  - `displaySummary` (line ~110): label-preferred — `options.find(o => o.value === answer.value)?.label ?? answer.value`; text questions use the raw value. So `to` is a LABEL for choice questions whenever labels differ.
  - `"(unanswered)"` sentinel is snapshots.ts-module-private; reconstruct duplicates it deliberately.
- Semantics of `value` vs `to` for an agent reset entry (BUG-008 territory): post-change unanswered → `value: undefined`, `to: "(unanswered)"`. Current replay already skips these via the `to` check; with `value ?? to` we must ALSO treat `value === undefined` + `to === UNANSWERED_SUMMARY` as skip. Note the skip condition needs restructuring: resolve `const v = typeof entry.value === "string" && entry.value !== "" ? entry.value : entry.to;` then apply the UNANSWERED_SUMMARY/empty checks on `v`. New history (post P1.M2.T3.S1) filters agent resets out of shipped deltas anyway — the tolerance only guards legacy.
- `state.applyAnswer(id, {value, at})` — canonical value write; `state.epoch` readable; `bumpEpoch()` exists.
- Tests: `src/reconstruct.test.ts` uses vitest, helpers `makeCtx(entries: SessionEntry[], mode)`, `makeHost()`, `makeOpts(host, drafts)`, `seededState(mutator)` building serialized base states, and message entries carrying `details.state` / submission entries carrying `details` of SubmissionMessage shape. Follow those conventions; no mocks of snapshots needed — build real `changed` arrays with `{id, from, to, value}` fields.
- dependsOn: `evaluateDependsOn` compares `answer.value` against condition `equals` — the exact corruption path (label 'Beta' ≠ value 'b' → q2 wrongly moot). This is the acceptance test scenario.
- Parallel task P1.M4.T2.S1 (keys.ts focusText gating) — completely orthogonal; no shared files beyond none. No coordination needed.

## Test scenario (from PRD h3.6 repro)

q1 choice (options value 'b'/label 'Beta'), q2 dependsOn q1 equals 'b'. Branch: [toolResult(details.state with q1 unanswered), custom_message(details of submission with changed:[{id:'q1', ..., to:'Beta', value:'b'}])]. Expect after reconstructFromBranch: q1.answer.value === 'b', q2 status 'open' (not moot). Plus legacy test: same entry WITHOUT `value` → falls back to 'Beta' (documented legacy tolerance, assert current best-effort behavior).

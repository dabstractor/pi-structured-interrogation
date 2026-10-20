# Research — P1.M1.T1.S2 (bugfix 001_3e88fb340e1d): DiffEntry += optional text/custom

Verified against working tree + architecture/bug001-submission-replay.md §1-§3.

## DiffEntry today (src/snapshots.ts:90-115)
```ts
export interface DiffEntry {
  id: string; title: string; prompt?: string;
  from: string; to: string;
  editedArchived: boolean;
  value?: string; // RAW post-change answer.value; omitted when unanswered/missing; machine-readable for replay
}
```
Optional-key convention: keys present ONLY when meaningful (prompt? FULL-TRANSCRIPT-001 conditional-spread; value? omitted when undefined — note value is pushed unconditionally but serializes to absent when undefined; prompt uses `...(prompt !== undefined ? { prompt } : {})`).

## computeEntries (snapshots.ts:284-309) — producer A (this subtask)
```ts
entries.push({
  id, title,
  ...(prompt !== undefined ? { prompt } : {}),
  from: answerSummary(before), to: answerSummary(after),
  editedArchived: before?.status === "closed",
  value: after?.answer?.value, // RAW post-change value; undefined when unanswered/missing
});
```
`answerSignature` is value+text ⇒ a text-only elaboration edit DOES produce an entry (then drops the text today). Producer B (synthetic seam, src/panel/actions.ts submit path) is S3's; its JSDoc is named in snapshots.ts's FULL-TRANSCRIPT-001 comment (~:70-73) — "BOTH DiffEntry producers".

## Answer shape (src/state.ts:43-49)
`QuestionAnswer = { value: string; text?: string; custom?: boolean; at?: string }` — `applyAnswer` spreads `{...answer}` so text/custom pass through downstream.

## Change (per contract)
Interface: add
```ts
/** Free-text elaboration attached to the answer (`answer.text`, next side). Key present ONLY when a non-empty string — machine-readable reconstruction data mirroring `value?`; `to` stays display-only. Optional for legacy entries predating the field. */
text?: string;
/** WRITEIN-001 write-in marker (`answer.custom === true`, next side) — value holds free text, not an option value. Key present ONLY when true; ✎ rendering and ANSWER-PIN-001 ✎-row pinning derive from it after replay. Optional for legacy entries. */
custom?: boolean;
```
computeEntries push: add conditional spreads mirroring prompt's convention:
```ts
...((after?.answer?.text ?? "") !== "" ? { text: after.answer!.text! } : {}),
...(after?.answer?.custom === true ? { custom: true } : {}),
```
(or equivalent guarded reads). DO NOT touch from/to/editedArchived/value. Pure module — no mocks.

## Consumers sanity
- Card renderer / delivery delta builder consume from/to/display fields — new keys are additive; JSON details gain keys only when elaboration/write-in present (legacy shape byte-identical otherwise).
- S3 (synthetic seam) and S4 (replaySubmission reads entry.text/entry.custom) consume.

## Tests (src/snapshots.test.ts conventions: build two serialized states via state.serialize() / hand fixtures; computeDiff or computeEntries via computeDiff(prev, next))
1. elaborated choice answer (answer {value:"a", text:"because"}) → entry.text === "because", entry.custom absent
2. write-in (answer {value:"free text", custom:true}) → entry.custom === true, text absent
3. plain answer → neither key present ("text" in entry === false)
4. text-only elaboration EDIT (same value, new text) still yields an entry (answerSignature) and now carries text
5. existing fields unchanged for plain answers (id/title/from/to/editedArchived/value) — existing suite rows already pin; keep green.

# BUG-001 — Submission replay loses answer.text / answer.custom

PRD: Major Issue 1 (h3.0). Restart reconstruction replays `interrogation-submission`
deltas VALUE-ONLY, silently dropping elaborations (`answer.text`) and write-in markers
(`answer.custom`) whenever the debounced full-state mirror missed its flush window
(hard kill / SSH drop / SIGKILL inside the 2s debounce, or appendEntry failure).

## Pipeline (verified end-to-end)

### 1. Answer shape — src/state.ts:43-49
`{ value: string; text?: string; custom?: boolean; at?: string }`.
`applyAnswer` (state.ts:379-386) does `q.answer = { ...answer }` — pass text/custom
through and they land.

### 2. DiffEntry — src/snapshots.ts:90-115 (the carrier — MISSING fields)
```ts
export interface DiffEntry {
  id: string; title: string; prompt?: string;
  from: string;  // label-preferred summary before
  to: string;    // label-preferred summary after
  editedArchived: boolean;
  value?: string; // RAW post-change answer.value; machine-readable for replay
}
```
No `text`, no `custom`. JSDoc (~70-73, FULL-TRANSCRIPT-001) names "BOTH DiffEntry
producers": `computeEntries` here AND the panel's synthetic-entry seam in actions.ts.

### 3. Producer A — computeEntries (snapshots.ts:284-309)
```ts
entries.push({
  id, title,
  ...(prompt !== undefined ? { prompt } : {}),
  from: answerSummary(before), to: answerSummary(after),
  editedArchived: before?.status === "closed",
  value: after?.answer?.value, // RAW post-change value
});
```
Note: `answerSignature` (value+text) means text-only elaboration edits DO produce a
DiffEntry — then the elaboration is dropped from the entry.

### 4. Producer B — synthetic seam (src/panel/actions.ts:912-922)
Inside submit(): pending ids missing from the user diff get synthesized entries
reading the live question:
```ts
const q = panel.state.getQuestion(id)!;
const title = q.title ?? q.prompt ?? id;
const prompt = transcriptPrompt(q.prompt, title);
return { id, title, ...(prompt !== undefined ? { prompt } : {}),
         from: UNANSWERED_SUMMARY, to: answerSummary(q),
         editedArchived: false, value: q.answer?.value };
```
`q.answer?.text` / `q.answer?.custom` never copied. `buildSubmission(state,
{...diff, changed: augmented}, note)` (actions.ts:923) turns this into the delivered
`SubmissionMessage` (delivery.ts:66-85): `details: { changed: DiffEntry[]; note?; epoch; card }`.

### 5. Consumer — replaySubmission (src/reconstruct.ts:420-439) — the bug
```ts
const raw = entry.value;
const resolved = typeof raw === "string" && raw !== "" ? raw : entry.to;
if (typeof resolved !== "string" || resolved === "" || resolved === UNANSWERED_SUMMARY) continue;
state.applyAnswer(id, { value: resolved, at: new Date().toISOString() });
```
Value-first resolution (BUG-007) + sentinel skip (clearances) are CORRECT and must be
kept; the loss is the missing text/custom passthrough. Replay loop in
reconstructFromBranch (~558-570) picks base = newest plausible tool result
(`details.state`) or mirror entry (reconstruct.ts:504), replays submissions after it.

### 6. Downstream damage (why it matters)
- Read surface / digest: elaboration lines vanish (TRUST-001: user-authored words are
  never truncated-only on model-visible surfaces).
- WRITEIN-001: ✎ marker gone; ANSWER-PIN-001: replayed write-in value matches no
  option → caret clamps to display row 0 instead of the ✎ Other row.
- FR-5 completion record: `buildCompletion` (delivery.ts:443) reads `q.answer?.text`
  (delivery.ts:469) and `answer.custom === true → ✎ ${answer.value}` (delivery.ts:373)
  from state — after lossy replay the one-time record omits them permanently.

## Fix surface (per PRD Recommendation 1)
1. `DiffEntry` += optional `text?: string` (non-empty elaboration, key present only when
   a non-empty string) and `custom?: boolean` (WRITEIN-001 marker, `true` only) — follow
   the existing optional-key convention (`...(x !== undefined ? { x } : {})` / value).
2. BOTH producers copy them: `computeEntries` from `after?.answer`; the actions.ts seam
   from `q.answer`.
3. `replaySubmission` applies them with the state.ts:595-596 strict-guard precedent
   (`typeof entry.text === "string" && entry.text !== ""` → text; `entry.custom === true`
   → custom). Legacy entries without the keys degrade to today's behavior. `at`
   timestamps remain NOT carried (existing comment documents this — keep accurate).
4. Regression test replaying a submission carrying an elaborated option answer + a
   custom write-in (PRD-required).

## Size/caps risk — CLEARED
`details.changed` ships UNTRUNCATED by contract (delivery.ts:128, :200 — "details.changed/
details.card keep the UNTRUNCATED `to`"); `SUBMISSION_LIST_MAX_CHARS = 240` (delivery.ts:56)
caps only the display line 1 built from `to` summaries. Adding text/custom to
`details.changed` entries is consistent with the existing machine-data-untruncated rule.

## Test harness (reconstruct.test.ts)
Helpers: `seededState(build)` (:66) → real state via `applyUpsert`/`markAnswered` then
`.serialize()`; `toolResultEntry(state)` (:73) — role:"toolResult", toolName:"interrogate",
details.state; `mirrorEntry(data)` (:103) — customType INTERROGATION_STATE_ENTRY_TYPE;
`submissionEntry(details)` (:115) — custom_message, customType "interrogation-submission";
`diff(id, to, ...)` (:140); `markAnswered(s, id, {value, text?, custom?, at})`;
`makeCtx(entries)`, `makeOpts(makeHost())`.
Representative (reconstruct.test.ts:218-236): base toolResultEntry + two submissionEntry
→ `reconstructFromBranch(ctx, makeOpts(makeHost()))` → assert `result.source`,
`result.replayed`, `state?.getQuestion("q1")?.answer?.value`, `state?.epoch`.
End-to-end delivery capture: `buildSubmission`/`deliverSubmission` exported (delivery.ts:163);
panel seams in actions.test.ts (submit path, dozens of `panel.footerFlash?.text` asserts).
New regression file convention: `src/regression-*.test.ts`.

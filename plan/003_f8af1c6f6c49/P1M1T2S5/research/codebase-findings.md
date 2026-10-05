# Research notes — P1.M1.T2.S5: `writeInEnter` — byte-identical re-commit inert + buffer consume

## Binding contract (verbatim)

`plan/003_f8af1c6f6c49/architecture/answer-pinning-contract.md` § FR-D9, second bullet:

> `writeInEnter`: byte-identical write-in re-commit (`answer.custom === true && text === answer.value`; likewise `answer.value === text` on text questions) equally inert — checked BEFORE the ripple-victims branch; consume/neutralize the buffer (VAL-002 pattern) so the advance's draft write-through cannot stage committed text into the draft slot.

Third bullet (`acceptFromDeep`) is S6 — NOT this task. Non-goals doc block: no config keys, no hotkey rows, no auto-submit trigger changes, no state-machine/rev/epoch/persistence edits.

## Current code (src/panel/actions.ts:311–349, verified 2026-10-05)

```ts
export function writeInEnter(panel: InterrogationPanel): boolean {
  const q = currentQuestion(panel);
  if (q === undefined) { panel.blurTextField(); return true; }
  const text = panel.textField.getText();
  if (text.trim().length === 0) {            // empty gate — STAYS FIRST
    panel.commitTextDraft(q.id, text);       // draft write-through + blur, no commit
    return true;
  }
  // INSERTION POINT — inert check here (before the victims branch)
  const status = q.status;                   // :327
  if ((status === "answered" || status === "submitted") && rippleVictims(panel, q.id).length > 0) {  // :331
    beginWriteInConfirm(panel, text);        // deferred keep/cancel modal (kind "writein")
    return true;
  }
  panel.state.applyAnswer(q.id, { value: text, custom: true, at: new Date().toISOString() }); // :334
  evaluateDependsOn(panel.state);            // :336 (FR-17 moot recompute)
  panel.consumeCommittedBuffer(q.id);        // :344 (VAL-002)
  advanceAfterAccept(panel);                 // :345
  panel.blurTextField();                     // :346 (resets textDuty → "elaboration")
  maybeAutoSubmit(panel, undefined, { wasUnanswered: status === "open" || status === "reasked", questionId: q.id }); // :347
  return true;
}
```

Inert path = the commit tail minus applyAnswer/evaluateDependsOn/maybeAutoSubmit:
`consumeCommittedBuffer(q.id)` → `advanceAfterAccept(panel)` → `panel.blurTextField()` → `return true`.
Ordering is load-bearing: consume BEFORE advance (staging prevention), blur AFTER advance
(currentId setter's cursor re-seed wins on the repainted view — documented in writeInEnter's JSDoc).

## The two-clause match condition (why)

- **Choice questions: `recorded.custom === true && recorded.value === text`.** A recorded
  OPTION answer (no custom) whose value byte-equals the buffer text is a different-KIND
  commit — the write-in would flip `custom` on (option → write-in). Must NOT be inert
  (mirror of S4's custom exclusion, opposite direction).
- **Text questions: `recorded.value === text`, custom-agnostic.** `fallback.ts:252`
  (`state.applyAnswer(answer.id, applied)` where applied = `{value, text?, at}` — no custom)
  and `debug-commands.ts:222` record text answers WITHOUT the flag; the panel path
  (writeInEnter) records WITH `custom: true` (actions.test.ts:309 pins this). Both are the
  same KIND on text questions (value IS the user's text — there are no options), so both match.
  This is the contract's "likewise `answer.value === text` on text questions" clause.

Combined:
```ts
const recorded = q.answer;
if (recorded !== undefined && recorded.value === text && (recorded.custom === true || q.type === "text")) { …inert… }
```
Byte-identical = strict `===` on the RAW buffer (the commit applies raw text; trim is only
the emptiness gate). Whitespace-differing text is a DIFFERENT commit → existing paths.

## Buffer consume (the second half of the title)

- `consumeCommittedBuffer(questionId)` (panel.ts:962–968): guard `bufferOwner !== questionId →
  return`; else `textField.seed("")`, `draftSlots.delete(questionId)`,
  `drafts?.clearDraft?.(questionId, {explicit: true})`, `bufferOwner = undefined`.
- WITHOUT consume on the inert path: `advanceAfterAccept` → currentId setter →
  `syncBufferToQuestion(newId)` (panel.ts:1089–1110) writes the outgoing buffer (the identical
  answer text) into q's draft slot (`draftSlots.set` + DraftStore `setDraft`) — VAL-002's
  phantom-elaboration trap: a later DIFFERENT option accept would ship the answer text as
  bogus `answer.text` (reconcileDraftsForSubmit attaches the slot as elaboration for real
  options; actions.ts:455 skips attach only when `answer.custom === true`).
- After consume, `syncBufferToQuestion` skips the write-through (bufferOwner undefined →
  no staging) and re-seeds from the NEW question's draft.
- Tests calling `writeInEnter` without `focusTextField` have `bufferOwner === undefined` →
  consume is a harmless no-op there (no staging risk to begin with).

## Reachability / status matrix

- Write-in duty entry: `accept()` on Other row (cursorIndex ≥ options.length) or type:"text"
  (actions.ts:214–238) sets `textDuty = "writein"` + `focusTextField()` — seeds from
  `freshestDraftFor` (draft slot → DraftStore → ""), NEVER from the recorded answer. So a
  byte-identical re-commit requires the buffer to hold identical text (retyped, or a
  pre-existing identical draft). Seeding-from-answer is NOT in scope.
- `accept()` blocks moot/withdrawn before duty entry (actions.ts:220) — leave those guards
  alone (S4 posture). ctrl+t entry: `desiredTextDuty` (keys.ts) returns "writein" on Other
  row/text questions.
- Statuses carrying answers: answered/submitted/closed (+moot keeps dimmed). Inert applies
  to ALL (status-agnostic check on `q.answer`), so closed stays closed (no re-pend), and
  AUTOSUBMIT-003 rule-(b) (edit of last answerable on complete set) can never fire from a
  no-change keystroke.

## Ripple seam (what the inert check must precede)

`rippleVictims(panel, q.id)` + `beginWriteInConfirm(panel, text)` (ripple-confirm.ts; imported
actions.ts:30) stash a deferred modal `panel.confirmMode = {kind: "writein", …}`; modal enter →
`applyWriteInConfirm`, esc → `cancelWriteInConfirm` (panel.ts:771/775). Byte-identical commits
with victims > 0 must STILL be inert — the check is before the branch by construction.
Victims setup for the branch-order test: q1 answered write-in "alpha"; q2 dependsOn
`{id:"q1", equals:"alpha"}` (met → q2 visible/answered) → changing q1 invalidates q2.

## Test fixtures (src/panel/actions.test.ts, verified)

- `T0 = "2025-01-01T00:00:00.000Z"`; `OPTS_AB` (values "a"/"b"); `choiceQ(id, overrides)`;
  `seed(specs)` (applies `answerValue ?? "a"` via applyAnswer — NO custom flag);
  `seamMock(result)`; `makePanel(state, extra?)`; `makeDeps(isIdle)` → `{deps, sendMessage}`.
- Text questions: `overrides: { type: "text", options: undefined }` (actions.test.ts:277).
- Write-in answers: `state.applyAnswer(id, { value: "alpha", custom: true, at: T0 })`.
- Enter write-in duty in tests: `panel.focusTextField("writein")` (two-stage.test.ts:263
  precedent) or `accept()` with `panel.cursorIndex = 2` (Other row). Buffer: `panel.textField.setText(...)`.
- Assertables: `panel.confirmMode?.kind` (:1045 precedent), `panel.footerFlash`,
  `panel.draftTextFor(id)` (used actions.ts:~545), `panel.focus`, `panel.currentId`,
  `state.getQuestion(id)?.answer?.at === T0`.
- Sibling model: S4's committed group `describe("accept same-value — inert no-op (ANSWER-PIN-001 / FR-D9)")`
  (commit d6d1553) — place the new describe right after it.

## Existing write-in commits surveyed (flip risk ≈ zero)

Values committed in tests today: "postgres" (≠ recorded, actions.test.ts:965 + ac-scripted
AC-13 e2e), "cockroachdb" (:1042, victims modal test), "a hybrid of A and B" (:1076), "x"
(:1149, dependsOn), "my answer" (:305, open text q), "my textual answer" (:2183, auto-submit,
open t1), "" (empty branches). NONE byte-equals its recorded answer → no expected flips.
Triage rule if one fails: identical-text rows flip to inert; different-text rows must stay green.

## Validation commands

- `npx vitest run src/panel/actions.test.ts` (component)
- `npx vitest run` (full suite)
- `npm run typecheck` (tsc --noEmit)
- NO live pi session (AUTOMATION-POLICY binding).

## Git state note

S4 landed as commit `d6d1553` ("Re-committing the recorded answer just advances") during this
research session — build on it; its comment style and test group are the direct model.

# Research: writeInEnter + stageText closed-edit FR-18 gates (BUG-003, seams 2 & 3)

## Verified gate sites (line numbers drift slightly from the PRD; code is authoritative)

### Seam 2 — writeInEnter gate, src/panel/actions.ts:430

```ts
const status = q.status;
if ((status === "answered" || status === "submitted") && rippleVictims(panel, q.id).length > 0) {
  beginWriteInConfirm(panel, text);
  return true; // consumed — nothing applied yet
}
```

BEFORE it (must stay intact): the ANSWER-PIN-001 byte-identical no-op (~actions.ts:400-425):
`recorded.value === text && (recorded.custom === true || q.type === "text") && q.status !== "reasked"`
→ consumeCommittedBuffer + advance + blur, no state write. Its docblock says settled statuses
(answered/submitted/closed) stay inert — a byte-identical write-in re-commit on CLOSED stays a no-op,
and the reasked exclusion keeps rule-1 re-confirms seam-free. Our change is AFTER both.

### Seam 3 — stageText gate, src/panel/panel.ts:856-871

```ts
if (q !== undefined && q.answer !== undefined &&
    (q.status === "answered" || q.status === "submitted") &&
    rippleVictims(this, id).length > 0) {
  beginTextConfirm(this, text);
  return; // deferred — applyTextConfirm runs on confirm-enter
}
this.commitTextDraft(id, text);
```

Note the answer-presence conjunct (`q.answer !== undefined`) — KEEP it (stageText has no earlier
byte-identical no-op; answer-presence is what distinguishes a real elaboration edit from a first
draft). stageText is reached from saveTextDraft (elaboration enter, ~panel.ts:833) and
exitTextField (editor-exit ctrl+t / double-esc, ~panel.ts:846).

## Seam machinery (ripple-confirm.ts) — NO logic change needed

- beginWriteInConfirm / beginTextConfirm stash `panel.confirmMode` ({kind:"writein"|"text",
  questionId, text, victims (BFS closure), priorCursorIndex}).
- Enter on modal (panel.ts:770-771): kind "text" → applyTextConfirm (commitTextDraft with stashed
  id: draftSlots + DraftStore + blur; NEVER applyAnswer); kind "writein" → applyWriteInConfirm
  (applyAnswer {value:text, custom:true, at} → evaluateDependsOn → advance → blur).
- Esc: cancelWriteInConfirm (re-seed editor, zero state change) / cancelTextConfirm (restore
  recorded answer's text, keep focus).
- rippleVictims: dependents answered/submitted (closed dependents are not victims — see :30-34).

## Test patterns

- src/panel/ripple-confirm.test.ts: `describe("ripple confirm — write-in commit gate ...")` at :557;
  helper `enterWriteInDuty(handle, text)` (currentId="q1", cursorIndex=2 → Other row, "\r",
  editor.setText) then `panel.handleInput("\r")` → gate. seedRippleChain()/makePanel helpers.
- src/panel/panel.test.ts: `elaboration_save_on_answered_with_ripple_victims_routes_through_FR18_modal`
  (~:2595) is the exact pattern for the stageText closed case: makeDutyPanel, CTRL_T → textDuty,
  setText, "\r" → confirmMode.kind "text", esc → zero change, retry → "\r" confirm → draftTextFor.
- Stay-green pins: test_h_accept_on_moot_and_withdrawn_is_noop (actions.test.ts:316); existing
  write-in modal tests in ripple-confirm.test.ts; existing panel.test.ts elaboration modal test.

## Fixture shape (PRD BUG-003 repro)

q1 'db' options [sqlite,postgres], answered postgres then CLOSED (applyAnswer then
state.setStatus("q1","closed")); q2 'scale' answered pending with dependsOn [{id:"db",
equals:"postgres"}].
- write-in path: enter write-in duty on q1, text "mysql", enter → modal (victims ["q2"]); esc →
  unchanged; enter → applyWriteInConfirm: q1 answered {value:"mysql", custom:true}, q2 moot.
- elaboration path: CTRL_T on q1 (closed, cursor on real option → elaboration duty), setText,
  enter → modal kind "text"; esc → no draft; enter → draftTextFor("q1") saved, answer untouched.

## Sibling contract (P1.M2.T1.S1, in flight)

Widens the acceptOptionIndex gate to `answered || submitted || closed` (status-list form), updates
docblocks + spec/decisions.md FR-18 closed-edit pin, and touches NOTHING in writeInEnter/stageText.
Do not duplicate its tests (actions.test.ts AC-13 describe) or rewrite decisions.md wholesale —
extend the S1 pin wording only if needed.

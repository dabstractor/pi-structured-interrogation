# Research notes — P1.M2.T3.S1 (elaboration duty via ctrl+t, duty-follows-cursor)

## Upstream contract (P1.M2.T2.S1, implementing in parallel)

Its PRP lands: `textDuty: 'writein' | 'elaboration'` on the panel (default elaboration); `blurTextField()` resets duty to "elaboration"; accept() at Other index sets duty='writein' + calls focusTextField; `commitWriteIn(panel, q, text)` in actions.ts (empty→save+blur, non-empty→applyAnswer{value,custom:true,at}→evaluateDependsOn→advanceAfterAccept); `renderDutyLabel(duty, theme, width)` with BOTH verbatim strings ("OTHER — this text is the answer" / "EXPLAIN — attaches to your selection") inserted in buildLines ~:1230/:1281. Its PRP explicitly delegates to THIS item: "P1.M2.T3.S1 owns duty-follows-cursor and the ctrl+t label semantics."

P1.M2.T2.S2 (parallel): ripple routing for WRITE-IN commits on answered questions — this item must NOT touch it; our FR-18 work is elaboration-save-only.

## Verified current code (pre-S1 tree; may shift)

- `src/panel/panel.ts`:
  - `focusTextField()` :1031 — sets focus="text", syncBufferToQuestion(currentId), seed(freshestDraftFor) (precedence: panel draftSlots → drafts seam → ""), bufferOwner reclaim, focus, invalidate. No duty concept yet.
  - `blurTextField()` :~1046 — focus="options", lastEscAt reset, blur, invalidate.
  - `handleInput` two-stage ladder :654–760 — (a) one-shot disarm, (b) armed stage-2 advance (options focus), (c) text/note stage-1 enter; confirm-mode check (FR-18) in the ladder per :658; stage-1 gate in saveTextDraft :456.
  - `advanceArmed` :406–412 (deleted later by P1.M2.T4.S1 — write no new references).
  - `commitTextDraft` :~852 (public, empty-buffer tail), `draftTextFor` :~1044.
  - `enterNoteMode` :1066 / bufferOwner="note" — untouched.
- `src/panel/keys.ts`: `onFocusText` seam :114, router :290, config match `keys.focusText` :444, dispatch :446. ctrl+t currently toggles (entry + re-press exit).
- `src/panel/short-view.ts`: `OTHER_AFFORDANCE = "✎ Other — write your own"` :73; Other row = cursor index `options.length` :142/:356; digits never select it.
- `src/panel/ripple-confirm.ts`: `rippleVictims(panel, id)` :94; `createRippleConfirm` :108; `beginTextConfirm` :181; `applyTextConfirm` :206; `cancelTextConfirm` :220 — reuse for elaboration saves on answered questions.
- Tests: actions.test.ts seed/makePanel/makeDeps (:73/:99/:127); two-stage.test.ts shows the synthetic-key enter-ladder fixtures; no-mock conventions throughout.

## Spec anchors

- h2.32: verbatim labels; "the duty follows where the user is"; elaboration "enter saves the draft + blurs to options. NO advance, NO commit"; FR-18 keep/cancel modal for elaboration saves on answered questions (simplified from arm-flag carry-through).
- h2.36 hotkey row: focusText = "TOGGLE into the editor: elaboration duty by default; write-in duty when the cursor is on the Other row or the question is type:'text'; press again to close the prompt box (draft saved)".
- AC-2b: ctrl+t, type, enter → draft saved, question still unanswered.
- Gotcha pinned in PRP: decide duty with the explicit `type:"text"` check FIRST (empty-options coincidence), then cursorIndex === options.length.

# Research notes — P1.M2.T2.S1 (write-in duty: accept Other → commit-at-enter)

## Verified seams (src/panel/)

### accept routing — actions.ts
- `accept(panel)` (:205–223): cursorIndex >= options.length (the Other row after P1.M2.T1.S1's label swap) → `panel.focusTextField(); return true;` — comment says "the ✎ explain affordance — focus the editor through the panel's seeding path". THIS is the route to rewire: set duty = write-in BEFORE focusTextField.
- `acceptOptionIndex(panel, q, optionIndex)` (:232–249) — the Q14 commit sequence to mirror EXACTLY:
  1. `const proposed = { value: opt.value, at: new Date().toISOString() }`
  2. answered/submitted → `panel.confirmRippleEdit(q.id, proposed)` veto seam (P1.M2.T2.S2 extends this to write-ins — NOT this item)
  3. `panel.state.applyAnswer(q.id, proposed)`
  4. `evaluateDependsOn(panel.state)` — once, AFTER applyAnswer, BEFORE advance
  5. `advanceAfterAccept(panel)` (module-private :256 — same module, callable directly)
- `advanceAfterAccept`: `nextUnanswered(ordered, from)` (open/reasked only, forward scan with wrap); sets `panel.currentId = nextId` (setter re-seeds cursorIndex to ★ preselect); `panel.invalidate()`.
- `digit()` already excludes the Other index (P1.M2.T1.S1's explicit test) — untouched.

### editor focus/seed/duty — panel.ts
- `focusTextField()` (:1031): sets `focus = "text"`, `syncBufferToQuestion(currentId)`, `textField.seed(freshestDraftFor(currentId))`, `bufferOwner = currentId`, `textField.focus()`, invalidate. Write-in duty REUSES this wholesale (h2.32: "The editor seeds from the question's draft" — same seeding path).
- `blurTextField()` (:1046): focus="options", lastEscAt=undefined, blur, invalidate.
- `bufferOwner` (:394): question id | "note" — tracks buffer scope, NOT semantic duty. There is NO duty concept yet → this item adds `textDuty: "writein" | "elaboration"` (default "elaboration"); note duty is already represented by `focus === "note"` (untouched).
- `handleInput` stage (c) (:753–760): `enter && focus === "text" || "note"` → note: exitNoteMode; text: saveTextDraft(). THE seam for commit-at-enter: when `textDuty === "writein"`, enter routes to the write-in commit instead of saveTextDraft.
- `saveTextDraft()` (:792) → `stageText(text, arm)` (:833) → ripple text-gate (beginTextConfirm) → `commitTextDraft(id, text, {arm})` (:852): writes draftSlots + DraftStore seam, blurs, EXPLAIN-003 cursor re-seed to ★ when closing on the Other index. Two-stage machinery (advanceArmed :406–412, stage-2 :744) STILL EXISTS — P1.M2.T4.S1 removes it; this item must NOT add new arm usage and must not break two-stage.test.ts (elaboration path unchanged this item; ctrl+t elaboration labeling is P1.M2.T3.S1).
- `textField.getText()` — buffer read (stock + composed both implement).

### editor region label — panel.ts buildLines (:1230-ish)
- Short view pushes `...this.textField.render(width)` directly — NO region label exists today. Note duty renders `renderNoteHeader(theme, width)` (layout.ts) ABOVE the editor — the exact pattern to copy for the duty label line. This item adds ONLY the write-in label `OTHER — this text is the answer` (verbatim, em-dash); the EXPLAIN label (`EXPLAIN — attaches to your selection`) is P1.M2.T3.S1's.

### answer shape — state.ts
- `QuestionAnswer.custom?: boolean` (:48) + `AnswerInput` custom + deserialize strict-true revival (:551) — landed by P1.M1.T1.S1. So `applyAnswer(q.id, { value: text, custom: true, at })` carries through state, serialize, diff (✎ {text} display from P1.M1.T2.S1/S2).

### ripple
- `confirmRippleEdit(questionId, proposed)` (:901) delegates to the stored `rippleConfirm` seam. acceptOptionIndex's answered/submitted gate is the seam P1.M2.T2.S2 will route write-in commits through — this item deliberately does NOT call it (clean diff for S2), EXCEPT the empty-buffer no-commit path needs no ripple either (no answer change).

## Test harness convention (actions.test.ts :96–113)
`makePanel(seed)`: `stubTheme` (:45), `{ requestRender: vi.fn() } as unknown as TUI`, `new InterrogationPanel({ tui, theme, state: createInterrogationState(...) + seed helpers, config: ..., done, confirmRipple?... })`. Mock NOTHING — real InterrogationPanel + real state.

## Consumer chain (from item contract)
- P1.M2.T2.S2: ripple routing for write-in commits on answered questions.
- P1.M2.T4.S1: deletes advanceArmed/stageText machinery — write-in commit path must not depend on it.
- P1.M2.T5.S1: draft role binding at submit (write-in draft → answer.value).
- P2.M1.T1.S1: maybeAutoSubmit fires after every commit — will hook after this commit path.

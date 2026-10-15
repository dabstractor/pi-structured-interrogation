# Research notes — bugfix P1.M2.T1.S1 (openExternalEditor note-duty routing fork)

## Verified in live source

- `openExternalEditor` — src/panel/panel.ts ~:1306-1348 (JSDoc :1306-1319). Body: re-entrancy guard (`externalEditorInFlight`), `draft = this.textField.getText()` BEFORE `tui.stop()` (duty-blind — CORRECT: note mode seeds the same TextField, enterNoteMode :1265-1271), `editInExternalEditor` round-trip, then on `result.status === "complete"`:
  ```ts
  const id = this.currentId;
  this.textField.setText(result.content);
  if (id !== undefined) {
    this.draftSlots.set(id, { value: id, text: result.content });
    this.drafts?.setDraft(id, result.content);
    this.bufferOwner = id; // EXPLAIN-002
  }
  this.invalidate();
  ```
  — HARDWIRED to the question-draft path. In note mode (`bufferOwner === "note"`, `focus === "note"`) this would (a) corrupt the CURRENT question's draft slot with note text, (b) re-scope `bufferOwner` away from `"note"` (breaking question-scoping suspension). Also `id` may be undefined mid-note → the `if` silently skips the slot writes, but any defined currentId is a corruption target.
- `bufferOwner` discriminator — panel.ts :435 (`"note" | string | undefined`); the same discriminator `writeThroughCurrentDraft` uses (:948-951).
- **Write-through precedent** — `exitNoteMode` :1286-1291: `this.batchNote = text; this.drafts?.setNote(text);` then re-scopes. The fork mirrors exactly these two writes.
- Note submit read path — actions.ts :703 `panel.drafts?.getNote() || panel.batchNote`; post-ship clear :763-764. Both stay consistent because the fork writes the same pair exitNoteMode writes.
- JSDoc (:1306-1319) currently says "sync the draft slot + DraftStore seam" — extend to name both routing targets.

## Test infrastructure (panel.test.ts)

- `makeEditorHarness` :1881-1903: state with textQ q1, stub tui {stop,start,requestRender}, drafts mock {getDraft,setDraft,getNote,setNote}, fakePanelEditor, `panel.focus = "text"` — for the note sibling, call `panel.enterNoteMode()` then `editor.setText("note draft")`.
- `draftSlotsOf(panel)` helper for direct slot assertions.
- `vi.mock('../external-editor.js')` → `editMock` (mockResolvedValue complete/failed/rejected patterns all in the :1905-1996 describe).
- Clean-exit test :1905-1931 is the sibling to mirror.

## Ordering / scope

- This item lands the APPLY-side fork FIRST; the router gate widening (keys.ts:566 `panel.focus === "text"` → editorFocused any duty) is P1.M2.T1.S2; E2E is P1.M2.T1.S3. Until S2, the fork is dormant (ctrl+g unreachable in note focus) — no corruption window, no user-visible change.
- The fork is directly testable on `openExternalEditor` without the gate change (call the method in note mode).
- Assert `bufferOwner` stays `"note"` and `focus` stays `"note"`; `drafts.setDraft` NOT called; `draftSlots` untouched for the current question.
- BOM-stripping/newline-drop happen inside editInExternalEditor — not our concern; `result.content` is final text.

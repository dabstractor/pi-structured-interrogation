# Research notes — P1.M1.T2.S3: Note-mode swap writes through both buffers symmetrically (BUG-002 gesture 3)

## Verified current code (working tree)

### enterNoteMode — src/panel/panel.ts:1090-1116
```ts
enterNoteMode(): void {
  this.focus = "note";
  this.textField.seed(this.drafts?.getNote() || this.batchNote || "");
  this.bufferOwner = "note";
  this.textField.focus();
  this.invalidate();
}
```
BUG: `textField.seed(...)` runs with the question buffer still in the editor — overwrites it with nothing written to `draftSlots`/DraftStore. Order matters: the write-through must happen BEFORE both `focus = "note"` and `seed()` — after `focus = "note"` the buffer semantically belongs to the note (and S1's helper guard `focus !== "text" && focus !== "note"` is still satisfied but bufferOwner would already be ambiguous if we also set bufferOwner first). Insert helper call as the FIRST statement.

### exitNoteMode — src/panel/panel.ts:1127-1141 (ALREADY SYMMETRIC for the note side)
```ts
exitNoteMode(): void {
  const text = this.textField.getText();
  this.batchNote = text;
  this.drafts?.setNote(text);
  this.bufferOwner = this.currentId;
  this.textField.seed(this.freshestDraftFor(this.currentId));
  this.blurTextField();
}
```
The note buffer IS written through before the question buffer is re-seeded. The reverse swap's only gap is the question→note direction (enterNoteMode). Do not restructure exitNoteMode — only the enter side needs the fix. (Optionally note the symmetry in JSDoc.)

### Key routing
- ctrl+shift+m → keys.ts:479 `actions.onBatchNote(panel)` → keys.ts:322-327: `if (p.focus === "note") p.exitNoteMode(); else p.enterNoteMode();` — the toggle.
- esc from note focus → keys.ts:249/255 `panel.exitNoteMode()` (esc-descent ladder).
- ctrl+c from note focus → panel.ts:748 → `this.suspend()` → S1's `writeThroughCurrentDraft()` note branch (batchNote + setNote). Covered by S1; S3 adds its own assertion per the item contract (test c).
- enter from note focus → handleInput stage-1 save → exitNoteMode (already safe).

### S1 helper contract (P1M1T2S1 PRP, treated as landed)
`private writeThroughCurrentDraft(): void` — guards `focus !== "text" && focus !== "note"` → return; empty-trim text → return; `bufferOwner === "note"` → `batchNote = text; drafts?.setNote(text)`; else question-id owner → `draftSlots.set(id, {value: id, text}); drafts?.setDraft(id, text)`. No blur/invalidate/FR-18/EXPLAIN-003 side effects. At enterNoteMode call time bufferOwner is a question id (or undefined), so the question branch runs — exactly the swap write-through needed. Note the guard is focus-based: entering note mode FROM OPTIONS focus (buffer not focused) writes nothing — acceptable and consistent with S1 (blurred buffers are already synced on blur by commitTextDraft/sync paths).

### Test anchors (src/panel/panel.test.ts)
- `makeSuspendPanel` :1300-1307 (`panelArgsFor(state)` + done spy)
- note-mode describe :1765 ("note mode (R3, P1.M4.T2.S2)") — `test_ctrl_shift_m_enters_note_mode_and_swaps_editor_area` :1775; editor mock setText pattern :1813; drafts stub with `setNote`/`getNote` mocks :1818-1824
- `test_note_mode_exit_rescopes_buffer_to_current_question` :1427 — pins the exit-side semantics (keep green)
- `test_ctrl_c_escapes_note_mode_and_editor_focus` :1339 — extended by S1 with note-survival assertion

### Editor-open path for question duty
Used by text-field/write-in tests: open editor via the ✎ Other-row accept / text-question affordance → focus "text", bufferOwner = currentId. TextField `setText`/`seed`/`getText` are the harness seams.

## Design decisions
- Fix = one-line integration: `this.writeThroughCurrentDraft();` as the first statement of enterNoteMode, before `focus = "note"` and the seed.
- exitNoteMode: NO code change (already symmetric); document symmetry in JSDoc.
- ctrl+c from note focus: covered by S1's suspend() helper — S3 asserts it (TDD test c) rather than re-fixing.
- Mode A JSDoc: update enterNoteMode's doc block with the swap write-through guarantee (both directions).
- Scope: panel.ts (enterNoteMode + JSDoc) + panel.test.ts only.

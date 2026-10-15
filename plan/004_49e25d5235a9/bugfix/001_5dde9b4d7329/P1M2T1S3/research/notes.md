# Research notes — P1.M2.T1.S3 (E2E AC: note-duty ctrl+g round-trip)

## Verified facts (src/panel/keymap-ac.test.ts, current tree)

- **Mocks**: `vi.hoisted` `spawnMock` + `vi.mock("node:child_process", () => ({ spawn: spawnMock }))` (L52–54). Real fs — `spawnWrites` (L221–233) reads the seeded temp file via `readFileSync` (records it in module-level `seededAtSpawn`), `writeFileSync`s the edited content, emits `close 0` in a `queueMicrotask`.
- `CTRL_G = "\u0007"` (L96); `vi.stubEnv("VISUAL", "")` = unset; `vi.stubEnv("EDITOR", "fakeed")`.
- **AC-1 E2E precedent** (L313–341, text duty): spyOn `panel.openExternalEditor` (fire-and-forget — router action is `void p.openExternalEditor()`), `panel.handleInput(CTRL_G) === true`, then `await spy.mock.results[0]!.value` to await the round-trip; asserts spawn args (command `fakeed`, single arg matching `/answer\.md$/`, `stdio: "inherit"`), `seededAtSpawn`, `editor.setText`, `drafts.setDraft`, `tui.stop/start` ×1 each, `panel.focus` unchanged. Negative twin at L343–354 (options focus → false, no spawn).
- **Style B harness** `makePanel(state, extra)` (L193–211): real `InterrogationPanel` + real state + recordingEditor + drafts spy stub (`getDraft/setDraft/getNote/setNote` vi.fns) + spy tui (`stop/start/requestRender`). `seedOpen(ids)` builds open choice questions. `beforeEach` resets spawnMock + `seededAtSpawn`; `afterEach` `vi.unstubAllEnvs()`.
- **Header coverage table** L22–23 (AC-1 rows) — the "added here" column is the pattern for citing this task.
- Note duty entry: `panel.enterNoteMode()` is public; sets `focus = "note"`, seeds TextField from `drafts.getNote() || batchNote || ""`, `bufferOwner = "note"`. Note seed for the test: either pre-set `drafts` stub `getNote` return or `panel.batchNote = "..."` before entering (batchNote is a public panel field). Ctrl+g from note duty seeds the editor with whatever the TextField holds — set via `editor.setText(...)` after entering note mode (recordingEditor's setText writes through to the fake buffer per AC-1 precedent, where `panel.textField.getText()` reflects it).
- Apply side after P1.M2.T1.S1's fork: complete → `textField.setText(content)`, `bufferOwner === "note"` branch → `batchNote = content; drafts.setNote(content)`; `setDraft` NOT called; `bufferOwner` stays "note"; focus stays "note". Router gate after P1.M2.T1.S2: `editorFocused` (text OR note) → handleInput(CTRL_G) returns true from note focus.
- Panel exits from note focus: enter (intercepted in panel.handleInput before router) and double-esc. ctrl+g round-trip leaves `focus === "note"` (no blur) — assertion target.

## Test design (single new AC test + header row)

Name: `test_ac1_ctrl_g_note_duty_round_trips_into_the_batch_note_style_b` (BUG-002 E2E).
Flow: seedOpen(["q1"]) → makePanel → panel.enterNoteMode() → editor.setText("note draft") → stubEnv VISUAL=""/EDITOR="fakeed" → spawnWrites("edited note\n") → spy openExternalEditor → handleInput(CTRL_G) true → `await spy.mock.results[0]!.value` → assert spawn args, seededAtSpawn === "note draft", editor.setText("edited note"), drafts.setNote("edited note"), drafts.setDraft NOT called, tui stop/start ×1, focus still "note", panel.batchNote === "edited note".
Header row: | 1 | ctrl+g note-duty round-trip (BUG-002) | keys.test.ts router legs (P1.M2.T1.S2) | ✅ E2E round-trip → batchNote/setNote, never setDraft (P1.M2.T1.S3) |

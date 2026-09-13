# P1.M4.T2.S2 research — Batch note (R3): ctrl+shift+m mode + NOTE: delivery

## Verified facts in shipped code

### Note plumbing already present (P1.M2/M3/M4.T1)
- `src/config.ts:126` — `batchNote: "ctrl+shift+m"` key already in defaults + KeyAction union (line 45) + doc table (line 297). No config work needed.
- `src/panel/panel.ts`:
  - `PanelFocus = "options" | "text" | "note"` (line 68) — note focus state exists.
  - `batchNote = ""` field (line 260) — written by enter-save.
  - `saveNote()` private (lines 478-488): reads textField.getText(), writes `panel.batchNote` + `drafts.setNote`, blurs. Comment says open path is THIS task.
  - Stage-1 enter in handleInput (lines 442-443): `if (enter && focus === "note") this.saveNote()` — save-and-exit path done, tests in `src/panel/two-stage.test.ts:316-340`.
  - `drafts?.getNote()` is the cross-instance source (DraftStore from parallel P1.M4.T2.S1; contract: store lives in index.ts closure, survives suspend/resume, note NOT cleared by clearAll).
- `src/panel/keys.ts:245-247` — `onBatchNote: () => { /* M4.T2.S2 wires the batch-note flow */ }` — THE stub to implement (toggle).
- `src/panel/keys.ts:312-315` — `b.batchNote` intercept already routed BEFORE submit/breakOut; valid in all focus modes incl. "text".
- `src/panel/layout.ts:57` — ACTION_WORDS has `batchNote: "note"` (footer hints ready).
- `src/delivery.ts buildSubmission(state, diff, note?)` (line 116) — note param EXISTS but is **details-only** (line 68-69, 152: `details.note`). JSDoc: "note intentionally details-only", content "ALWAYS exactly 2 lines".

### ⚠ PRD vs code conflict (resolution decided in PRP)
- h2.32 (authoritative): "delivered as a `NOTE:` line in the delta and shown on the card".
- Shipped delivery.ts made it details-only citing h3.6's 2-line content format, but h3.6 header says "≤3-line custom message" — a third `NOTE: {text}` line only when a note ships fits the ≤3-line budget. R3 is a HARD requirement (h2.9): the model must see the note in the delta. PRP directs: append `NOTE: {note}` third line in buildSubmission content when note non-empty (newlines → " / "), KEEP details.note for the card (M7.T3.S1 consumes it).

### Editor-area swap / header
- Single `TextField` per panel lifetime (`panel.ts` field, constructed line 339). APIs: `seed(text)` idempotent no-history, `focus()`, `blur()`, `getText()`, `render(width)`.
- `buildLines` (panel.ts:660-700): short view = header.line + question line + hint + options (+ editor region when focus==="text" or text question) + flash + footer. Note mode replaces the Q&A region: note header + editor + footer.
- `renderHeader(state, theme, width)` in layout.ts returns 1 bordered line; add a note-mode header variant `┌ NOTE — ships with next submission ┐` (h2.32 exact string).

### Submit wiring
- `src/panel/actions.ts submit()` (line 294): zero-pending early return (flash, nothing else) → `buildSubmission(panel.state, diff)` → `deliverSubmission`. Parallel S1 adds `panel.drafts?.shipDrafts(diff.changed)` after buildSubmission. This task: pass note, clear note after delivery (h2.32 "cleared after shipping"). Zero-pending: note HELD (no submission → nothing ships; R3 says "with the NEXT submission").
- `DraftStore` seam (panel.ts:79-92) has getNote/setNote only; S1 may add optional members. Clearing = `setNote("")` + `panel.batchNote = ""` (no clearNote in seam; S1's contract keeps note out of clearAll deliberately but setNote("") achieves clearing).

### Debug submit
- `src/debug-commands.ts` — `/interrogate-debug-submit id=value,...` via parsePairs (line 53). No note support. Extend: a token with id `note` (i.e. `note=text`) is lifted out as the batch note (note id is unlikely to collide; document). Pass to buildSubmission; assert clearing.
- `buildCompletion(state, notes?)` (delivery.ts:300) already collects `details.note`-style batch notes — lifecycle.ts wiring of getBatchNotes is NOT this task (completion trigger reads delivered submissions' details.note; already P1.M2.T2.S2 seam).

## Exit semantics (FR-16 + h2.32)
- esc or re-press exits note mode WITHOUT destroying the draft: exit path also writes text through (setNote + batchNote) then blurs — "draft preserved between opens" + "esc never destroys any state". Enter = same write + blur (existing saveNote). Re-entry seeds textField from `drafts?.getNote() ?? batchNote ?? ""`.

## Tests to extend
- `src/panel/keys.test.ts` (onBatchNote spy at 101/223/450), `src/panel/two-stage.test.ts` (note block 316+), `src/panel/actions.test.ts` (submit fixtures), `src/delivery.test.ts` (content NOTE line), `src/debug-commands.test.ts`.

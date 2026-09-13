# Research notes — P1.M4.T1.S2: Two-stage enter, newlines, history isolation

## pi-tui stock Editor internals (node_modules/@earendil-works/pi-tui/dist/components/editor.js)

- Enter path: `kb.matches(data, "tui.input.submit")` → if `disableSubmit` return; if char before cursor is `\` → delete + newline (legacy shift+enter workaround); else `submitValue()`.
- `submitValue()` (~line 1124): expands paste markers, **trims**, RESETS state (`lines:[""]`, cursor 0/0, undoStack.clear, scrollOffset 0), fires `onChange("")`, then `onSubmit(result)`.
  → Stage-1 save MUST capture text in onSubmit; editor is intentionally emptied by stock submit. Re-seed on next focus.
- Newline keys (handled BEFORE submit check, ~line 714): `tui.input.newLine` (default ctrl+j), raw `"\n"`, `"\x1b\r"` (alt+enter), `"\x1b[13;2~"`, kitty sequences containing ESC+\r, shift+enter. So multi-line typing works natively — we must NOT intercept these.
- `disableSubmit: boolean` field exists (default false). We need submit ENABLED (repurposed as stage-1 save).
- History: internal `history` array only fed via `addToHistory(text)` (optional on EditorComponent). Never calling it ⇒ isolated history; up/down browsing finds nothing.

## EditorComponent surface (dist/editor-component.d.ts)
onSubmit?, onChange?, addToHistory?, getExpandedText?() all OPTIONAL → feature-detect; composed editors (pi-vim) may not have onSubmit → for those, stage-1 save must come from elsewhere: panel-level enter detection. Keys router contract (P1.M3.T3S1 PRP rule 3): router does NOT intercept enter when focus==="text" — it forwards. So panel.handleInput sees enter in text focus before textField.handleInput: we can implement stage-1 there, covering BOTH composed and stock editors uniformly, and set editor.onSubmit too as belt-and-braces? NO — double-save risk (panel intercepts enter, editor never sees it ⇒ onSubmit never fires). Decision: panel-level enter interception in text/note focus is the single stage-1 trigger; do NOT rely on onSubmit. But item description says "stock Editor onSubmit repurposed as stage-1 save". Safer design honoring that: intercept enter at panel level BEFORE forwarding, so stock submitValue never fires and editor state is preserved; set onSubmit defensively only if intercept path missed? Keep it simple: panel-level interception; onSubmit NOT set (S1 explicitly deferred setting it here); document why panel-level wins (works for composed editors lacking onSubmit, avoids stock submitValue's destructive reset + trim).

## Keys / KeyId
- `parseKey(data)` returns full KeyId incl. modifiers ("shift+enter" ≠ "enter") — use `parseKey(data) === "enter"` for exact match; never raw `data === "\r"` (kitty protocol, "\r\n" etc.).
- `matchesKey(data, Key.enter)` — for our purposes parseKey-exact is what we want.
- ESC caveat: arrow sequences start with ESC — irrelevant here since we only parse enter.

## Panel seams (src/panel/panel.ts)
- `PanelFocus = "options" | "text" | "note"` (line 61); `focus: PanelFocus = "options"` (line 198).
- `DraftStore` seam (lines 64–74): `getDraft/setDraft(questionId, text)`, `getNote/setNote`. Optional until P1.M4.T2.S1.
- `handleInput` (line 333): `resolved` guard → `this.keys?.(data, this)` seam first → minimal matcher (to be deleted by keys.ts).
- openPanel forwards `drafts` and `keys` opts (lines 645–646).
- S1 (parallel) adds: `textField` field, `focusTextField()`, forwarding `focus==="text"` → `textField.handleInput(data)` AFTER keys seam returns false.
- batchNote field exists at line ~70 comment.

## Contracts from parallel/landed items
- P1.M3.T3.S1 (keys.ts, in progress): intercept-before-forward incl. text focus (ctrl+s etc. still fire); enter/digits/letters forwarded in text focus; `onFocusText` seam → panel.focusTextField().
- P1.M4.T1.S1 (parallel, text-field.ts): TextField wrapper (getText/setText/seed/focus/blur/render/handleInput), createEditorComponent, no onSubmit set, never addToHistory.
- P1.M3.T2.S2 (actions.ts): optionUp/optionDown/digit/accept/prevQuestion/nextQuestion/submit.
- Draft {value,text} structured shape lands with M4.T2.S1; this task persists text via the existing DraftStore seam and keeps a panel-local {value,text} record.

## Two-stage design (Mode A)
Stage 1: enter in text focus → save draft (drafts seam + panel-local slot), blur → focus "options", arm `advanceArmed = true`.
Stage 2: next enter while armed & focus==="options" → consume flag, advance to next unanswered question (reuse nextQuestion action semantics). Any OTHER input while armed (before the enter) disarms (one-shot).
NOTE focus: enter saves note (drafts.setNote) and exits note mode → focus "options" (no advance arming; note is not a question answer).
Multi-line: shift+enter / ctrl+j / alt+enter all reach the editor untouched (router forwards non-intercepted keys in text focus; our panel-level check only matches exact "enter").

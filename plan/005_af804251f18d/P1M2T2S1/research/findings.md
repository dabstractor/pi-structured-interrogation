# Research notes — P1.M2.T2.S1 (second TextField: the chat input)

Primary source: `architecture/panel-view-integration.md` §Second editor — anchors re-verified by direct read.

## Verified anchors

### panel.ts
- Constructor :606–631: ONE `TextField` built via `createEditorComponent(args.editorFactory, args.config, args.tui, args.theme, args.keybindings as KeybindingsManager)` + `{ theme, onInvalidate: () => this.invalidate() }`. Comment :611–614: "ONE embedded editor per panel lifetime … factory … invoked HERE inside the live custom() body". The arch doc explicitly sanctions a SECOND TextField in the SAME constructor from the SAME factory.
- `PanelFocus = "options" | "text" | "note"` (:112). `PanelView = "short" | "deep" | "overview"` (:108) — "chat" union member is P1.M2.T4.S1's; THIS item must not add the view member, only the focus member + a view-name guard.
- `view: PanelView = "short"` (:344); `setView(view)` exists (:1053) — hook: leaving chat view must drop chat focus (invisible-editor hazard, arch doc line "only focus it while view === 'chat'"; BUG-011 note keys.ts:534-538).
- `handleInput` (:755+): ctrl+c first → confirm-mode → enter byte-guard (`data !== "\n"`) → enter branches (note/text duties) → `this.keys(data, this)` router → fall-through `if (this.focus === "text" || this.focus === "note") { this.textField.handleInput(data); return true; }`. The chat branch slots beside the text/note fall-through; the ENTER interception for chat goes BEFORE the router (arch doc: "the chat-input enter/send branch goes there [panel-level handleInput]").
- History isolation docblock :751-753: "the embedded editor's history API is never invoked anywhere in this panel" — same discipline for the chat editor.
- `blurTextField` (:~1046 earlier snapshot; resets focus/duty/esc anchor) — chat blur must be its OWN method (no textDuty, no esc-esc anchor coupling) and NEVER suspend.

### text-field.ts
- `EditorFactory` type restated :45–51; `createEditorComponent(factory, config, tui, theme, keybindings)` :88–98 — composed path invokes `factory(tui, buildEditorTheme(theme), keybindings)` (called once per editor; two editors = two factory calls — sanctioned). Stock fallback `new Editor(tui, buildEditorTheme(theme))`.
- `TextField` class :113+ — only assumes getText/setText/handleInput/render (+ optional focused/onChange feature-detection). `TextFieldArgs = { editor, theme, onInvalidate }`. `seed(text)` idempotent, `focus()/blur()`, `getText()`.

### keys.ts
- `editorFocused = panel.focus === "text" || panel.focus === "note"` (:431) gates arrows (→ editor), bare-key tier-2 (:527/:532), etc. A "chat" focus member makes `editorFocused` FALSE there — S3 (P1.M2.T3.S1) owns updating every branch; THIS item only guarantees the panel-level forwarding exists so arrows reach the chat editor while focused (arch doc: "up/down arrows forward to the chat editor while it holds focus").

### Consumer chain (plan_status)
- P1.M2.T3.S1 (key routing): enter interception/send, esc ladder rung, streaming-abort — replaces this item's interim enter body.
- P1.M2.T4.S1 (view render): PanelView "chat" union + render branch embedding this editor's lines; setView("chat") will call focusChatInput.
- P1.M2.T1.S1/S2 (parallel, chat-view.ts render module): pure render module — disjoint files from panel.ts constructor/focus work.
- sidechat.ts engine (M1, complete): singleton store — the chat input NEVER touches DraftStore/draftSlots (messages are sent, not drafted; SIDECHAT-002 ephemeral).

## Test conventions
- `new InterrogationPanel({ tui: { requestRender }, theme: stubTheme, state, config, done, ... })` no-mock harness; fake `editorFactory` = `vi.fn(() => fakeEditorComponent)` counting invocations and recording instances; a minimal EditorComponent stub `{ getText, setText, handleInput: vi.fn(), render: () => [], invalidate? }` (TextField feature-detects the rest).

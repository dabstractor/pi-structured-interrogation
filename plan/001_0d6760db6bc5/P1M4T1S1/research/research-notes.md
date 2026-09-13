# Research Notes — P1.M4.T1.S1: Editor composition factory + stock fallback

## pi API surface (verified in installed types)

- `~/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`
  - Line 62: `export type EditorFactory = (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent;`
  - Line 173: `getEditorComponent(): EditorFactory | undefined` on `ExtensionUIContext` (alongside `custom`, `setWidget`, etc. — same `ctx.ui` object the panel host already narrows).
  - CRITICAL: `ctx.ui.getEditorComponent()` must be read **once per panel instantiation**, and the factory called INSIDE the `custom()` factory body where live `tui`/`theme`/`keybindings` are in scope. Our `PiUISurface` structural pick (`src/panel/panel.ts` ~line 116) currently only includes `custom` → must add `getEditorComponent?: () => EditorFactory | undefined`.

## pi-tui Editor / EditorComponent (verified)

- `node_modules/@earendil-works/pi-tui/dist/components/editor.d.ts`
  - `EditorTheme { borderColor: (s: string) => string; selectList: SelectListTheme }`
  - `class Editor implements Component, Focusable` — `focused: boolean`, `onSubmit?: (text) => void`, `onChange?`, `render(width: number): string[]`, `handleInput(data: string)`, `getText()`, `setText()`, constructor `new Editor(tui: TUI, theme: EditorTheme, options?: EditorOptions)`.
- `node_modules/@earendil-works/pi-tui/dist/editor-component.d.ts`
  - `interface EditorComponent extends Component` — the minimal contract: getText/setText/handleInput/onSubmit?/onChange?/focused (via Component/Focusable), optional addToHistory?, getExpandedText?() (falls back to getText), borderColor?.
  - Composition rule: call `getEditorComponent()(tui, theme, keybindings)` when it returns a function AND `config.editorMode === "composed"`; else `new Editor(tui, editorTheme)`.

## Questionnaire canonical pattern (pi examples, lines 110–210)

```ts
const editorTheme: EditorTheme = {
  borderColor: (s) => theme.fg("accent", s),
  selectList: { selectedPrefix: t=>theme.fg("accent",t), selectedText: t=>theme.fg("accent",t),
                description: t=>theme.fg("muted",t), scrollInfo: t=>theme.fg("dim",t),
                noMatch: t=>theme.fg("warning",t) },
};
const editor = new Editor(tui, editorTheme);
editor.onSubmit = (value) => {...};
// render: editor.render(width - 2) with a one-char left prefix/border per line
// input: intercept panel keys first, else editor.handleInput(data); then refresh()
```

## Existing panel integration seams (src/panel/panel.ts)

- `PanelFocus = "options" | "text" | "note"` already exists (line 61). `focus` defaults `"options"` (h2.31: not focused by default).
- `openPanel`'s `pi.ui.custom<null>((tui, theme, _keybindings, done) => { new InterrogationPanel({...}) })` — `_keybindings` currently discarded; must be forwarded so the composed editor gets the user's keybinding manager (vim modes).
- Key router (P1.M3.T3.S1, parallel): intercepts config keys incl. `ctrl+t` (keys.focusText) BEFORE forwarding; unmatched input returns false → panel must forward to the text field's handleInput when `focus === "text"`. Router's `onFocusText(panel)` seam default is `p.focus = "text"`.
- short-view.ts: `textAffordanceLine` (✎ / TEXT affordance, cursorIndex domain includes the affordance slot); embedded editor region = 3 lines default (h2.29 layout, PRD snapshot line 375).
- config.ts: `EditorMode = "composed" | "stock"`, `editorMode: EditorMode` default `"composed"` (h2.52 risk mitigation row 1).
- Tests: stub theme pattern in `src/panel/actions.test.ts` (`{ fg, bold }` cast to Theme); bare-stub TUI; AUTOMATION-POLICY: no live pi session — assert via fake TUI/EditorComponent.

## Scope boundaries (parallel/future items)

- P1.M4.T1.S2 owns two-stage enter, newline handling (shift+enter/ctrl+j), history isolation (`disableSubmit`/never `addToHistory` refinement).
- P1.M4.T1.S3 owns ctrl+g external $VISUAL/$EDITOR.
- P1.M4.T2.S1 owns draft store; P1.M4.T2.S2 owns batch-note mode ("note" focus).
- This task: factory selection (composed vs stock), TextField wrapper (seed/getText/setText/render/handleInput/focus/blur), panel wiring (capture factory once per openPanel, instantiate inside custom(), render embedded region, forward input, focus/blur via keys router + ✎ affordance).

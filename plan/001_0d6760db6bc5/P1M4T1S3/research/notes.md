# Research — P1.M4.T1.S3: ctrl+g external editor

## Canonical pattern: pi's own implementation (verified by reading installed dist)

`/home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/external-editor.js`
— `editInExternalEditor(options)`:
- `mkdtempSync(join(tmpdir(), "pi-editor-"))` → file `prompt.md`
- `writeFileSync(filePath, content, "utf-8")`
- NOT spawnSync (comment: on Windows sync child_process races vim/nvim for the
  console input buffer) — uses `spawn(editor, [...editorArgs, filePath], { stdio: "inherit" })`
  awaited via a Promise over `error`/`close` events
- `child.on("error", () => resolve(null))` — editor missing → treated as failure
- exit code !== 0 → `{status:"failed"}` (no content change)
- success → `stripBom(readFileSync(...)).replace(/\n$/, "")` (strip BOM, drop ONE trailing newline)
- `finally { rmSync(directory, {recursive:true, force:true}) }` — best-effort cleanup

Caller: `extension-editor.js` `handleOpenExternalEditor()`:
```js
const content = this.editor.getText();
this.tui.stop();
try { const result = await editInExternalEditor(...);
      if (result.status === "complete") this.editor.setText(result.content); }
finally { this.tui.start(); this.tui.requestRender(true); }
```
Sync handleInput fires it with `void this.handleOpenExternalEditor()` (fire-and-forget).

## Editor command resolution
pi settings-manager.js `getExternalEditorCommand()`: settings.externalEditor →
`process.env.VISUAL || process.env.EDITOR` → `win32 ? "notepad" : "nano"`.
Our contract (h2.31 + item): $VISUAL → $EDITOR → nano. Command string is split
on spaces (`"code --wait"` works). We are an extension — we do NOT read pi
settings; env-only per the item contract.

## pi-tui suspend support (verified)
`node_modules/@earendil-works/pi-tui/dist/tui.d.ts`: TUI exposes `start(): void`
(line 230/330) and `stop(options?: TuiStopOptions): void` (231/336). Panel
already holds `tui: TUI` (src/panel/panel.ts:152,239).

## Existing seams in this repo
- `src/panel/keys.ts:93-94`: `onExternalEditor(p)` seam — "M4.T1.S3 wires;
  default no-op" (line 254). Router call site line 324-327, gated to
  `panel.focus === "text"` with binding `b.externalEditor` (default ctrl+g,
  config.ts:130). Tests exist (keys.test.ts:299-302, 448).
- `src/panel/text-field.ts` (S1): `getText()` prefers `getExpandedText?.()`;
  `setText`, `seed`, `focus`, `blur`, `handleInput`, `focused`.
- S2 (parallel PRP, treat as landed): panel gains `draftSlots` Map
  `{value,text}`, `advanceArmed`, `saveTextDraft()`, `saveNote()`;
  `focusTextField()` seeds from draftSlots ?? drafts seam.
- `stripBom` is a pi-internal util (`../../utils/text.js`) — NOT exported to
  extensions; implement locally (`replace(/^\uFEFF/, "")`).
- Tests use vitest, bare stubs, vi.fn() spies (keys.test.ts pattern).

# P1.M6.T2.S2 research — discuss-in-chat handoff (ctrl+shift+e)

## Verified codebase anchors (2025 read of working tree)

- `src/panel/keys.ts`
  - `RoutedActions.onDiscuss(p: InterrogationPanel): void` declared at :105.
  - `defaultRoutedActions()` provides a NO-OP `onDiscuss: () => { /* M6.T2.S2 wires the discuss flow */ }` at :272.
  - Router dispatch: `if (matchesKey(data, b.discuss)) { actions.onDiscuss(panel); return true; }` at :364 — routing ALREADY works; only the action body is missing.
  - Intercept rule: config keys valid in ANY view AND in text/note focus (h2.34) — "works from any view" is already satisfied by the router.
- `src/panel/panel.ts`
  - `PiUISurface` (interface at :166) has `ui.custom`, optional `getEditorComponent?`, optional `setWidget?` — NO `setEditorText` yet → must add `setEditorText?(text: string): void` (optional so test fakes / RPC surfaces stay valid — same pattern as setWidget).
  - Router wiring at :449-451: `const routed = defaultRoutedActions(args.delivery); routed.onFocusText = (p) => p.focusTextField();` — this is the established HOST-REFINEMENT pattern: keys.ts untouched, panel.ts overrides the seam closure. Mirror it for onDiscuss.
  - Module-scoped host record: `activePi` (:1037), `phase`, `currentPanel`, `lastOpts`.
  - `suspendPanel(host: PanelHost)` exported at :1237 — takes the PanelHost object (not pi); calls `suspendCurrent()`.
  - `p.suspend()` panel method = `done(null)` path (same as onBreakOut at keys.ts:266-268).
  - Suspend completion is ASYNC: `pi.ui.custom()` promise resolves later → `markSuspended()` + widget update in the floating `.then` (openPanel :1195+). Any `setEditorText` call must therefore be DEFERRED past that resolution or the editor restore can clobber it.
- `src/panel/suspend.ts` (P1.M6.T1.S1, merged)
  - Exports `suspendPanel` (re-export of panel.ts host-force entry), `resumePanel(pi)`, `buildSuspendWidgetLine`, `updateSuspendWidget`, `WIDGET_KEY`. Header names P1.M6.T2.S2 as a consumer of `suspendPanel`.
- `src/config.ts`
  - `KeyAction` includes `"discuss"` (:48); default `discuss: "ctrl+shift+e"` (:129); doc table :300. Config plumbing complete.
- `src/panel/layout.ts:60` — footer label map `discuss: "discuss"` (already rendered).
- Question shape (`src/state.ts`):
  - `Question { id, prompt, description?, type: "choice"|"text", options?: QuestionOption[], recommendation?, ... }`
  - `QuestionOption { value, label, ramification? }`
  - Recommendation matches option by **value** (`short-view.ts:90 findIndex((o) => o.value === q.recommendation)`; star render :192 `opt.value === q.recommendation ? STAR : ""`, STAR = `"★ "`).
  - `panel.currentId` (getter :245) = current question id in ANY view (short/deep/overview all keep currentId — overview cursor is separate).
- pi API (plan/001_0d6760db6bc5/architecture/pi-api-validation.md :43, :75)
  - `ctx.ui.setEditorText(text)` confirmed; `getEditorText()` also available. Editor text persists across `custom()` sessions (Q: "verify in test" → that's P1.M6.T2.S3's job, not ours).
  - Note tension: h2.35 says "main editor text preserved" on suspend, but discuss DELIBERATELY overwrites editor text with the handoff template — S3 (editor draft preservation) must not run before/over this handoff. Document in JSDoc.

## Template (h2.35 / h3.1 FR-15 — EXACT)
```
> {prompt}
{options one per line, ★ marked}
(discussing q{id} — agent: side-chat freely; reopen panel when done)
```
- Option line: `★ ` prefix on the option whose `value === q.recommendation`, else plain label (use `label`, the human-facing text).
- Text questions / no options: omit option lines entirely (prompt line + footer).
- Footer uses `q{id}` with the literal id, em-dash `—`, exact parenthetical.

## Parallel-item coordination
- P1.M6.T2.S1 (reopen:true) edits `src/tool.ts` + `src/index.ts` (deps seam). This item touches `src/panel/keys.ts` (action body), `src/panel/panel.ts` (PiUISurface + wiring), NEW `src/panel/discuss.ts` — no file overlap of edit regions.
- P1.M6.T2.S3 (editor draft preservation) is AFTER us and must treat our setEditorText as intentional.

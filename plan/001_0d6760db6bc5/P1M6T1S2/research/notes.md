# Research notes — P1.M6.T1.S2 (/interrogate command + global ctrl+shift+q + empty state)

## Prior item contract (P1.M6.T1.S1, in-flight — treat as implemented)
- NEW `src/panel/suspend.ts` exports:
  - `buildSuspendWidgetLine(state, labels)` (pure)
  - `updateSuspendWidget(pi, state, config)`
  - `suspendPanel(host: PanelHost): void` → `host.suspend()`
  - `resumePanel(pi: PiUISurface): boolean` → delegates to panel.ts `resumeOpenPanel(pi)`; reopens fresh panel with `focusQuestionId: lastFocusId` (fallback first active), clears widget.
- `src/panel/panel.ts` PiUISurface gains optional `setWidget?(key, content, options?)`; module `lastFocusId`; widget set/clear handled inside openPanel promise landing (S1's scope — NOT ours).
- Existing host surface (verified in panel.ts :1097-1102): `createPanelHost` returns `{ isOpen(), isSuspended(), suspend(), ... }`; `suspendPanel(host)` already exists in panel.ts (:1192) — S1 re-exports via suspend.ts.
- `openPanel(pi, opts)` no-ops while open, reopens while suspended (:1131-1135). `getState()` from state.ts = lazy singleton accessor.

## pi API facts (architecture/pi-api-validation.md)
- `pi.registerCommand("name", { description, handler: async (args: string, ctx) => {} })` — ctx has `ctx.ui`, `ctx.mode` ("tui"|"rpc"|"json"|"print"), `ctx.isIdle()`. Command invoked by user as `/name [args]`.
- `pi.registerShortcut("ctrl+shift+q", { description, handler: async (ctx) => {} })` — flat app-level, effectively TUI-only; handler ctx has `ctx.ui` (NO ctx.mode documented — rely on TUI-only nature). Key format `modifier+key`, so config value `keys.breakOut` can be passed through directly.
- `ctx.ui.notify(msg, 'info'|'error'|'warn')`.

## Key conflict status (environment-and-conflicts.md)
- `ctrl+shift+q`: FREE (no pi default, no installed extension claims it) — line 80 keymap table. `ctrl+shift+e` also FREE (S2 of next task).
- Re-verify note required in PR notes at build time (h2.34 tail).

## Existing registration pattern (src/index.ts :39-44)
- `pi.registerCommand("interrogate-ping", { description, handler: async (_args, ctx) => ctx.ui.notify(...) })` — follow this shape exactly.
- Factory holds `config`, `panelHost`, `drafts` in closure — command/shortcut registration must happen there or receive these handles.
- `maybeAutoOpen(pi, config, panelHost, drafts)` (:1213) uses `pi.on("tool_execution_end", (event, ctx) => ... openPanel(ctx, {config, state, drafts}))` — ctx (ExtensionContext) IS a valid PiUISurface carrier (`ctx.ui`).

## Empty-state semantics (h2.37 + h2.15)
- No state → `notify("No active interrogation — ask the agent to interrogate you", "info")` — EXACT string (h2.3 naming rules: exact copy).
- "No active interrogation" test: `getState() === undefined` OR host closed-with-nothing OR 0 open questions while suspended. Simplest correct rule: active ⟺ state exists ∧ (host open or suspended) ∧ open-question count > 0. 0-open suspended (pending submissions edge) → notify empty state (widget would be cleared anyway per S1).
- h2.15: "with args when no state → notify" — args never crash the handler; same notify.

## Dual registration (global + panel-scoped)
- In-panel ctrl+shift+q: ALREADY implemented in keys.ts `onBreakOut` (:268, :360 — `matchesKey(data, b.breakOut)` → `p.suspend()`), config-driven. KeyRouter intercepts before the editor sees it while the panel is open, so the app-level shortcut doesn't need to fire while panel holds focus — hence dual registration is REQUIRED and safe (idempotent guards: suspend while open is host.suspend() which no-ops on second resolution; resume while open no-ops).

## Toggle logic
```
if (ctx.mode !== "tui") → notify('interrogate panel is TUI-only', 'info')? 
```
PRD: "command available in TUI only (ctx.mode check)". In rpc mode custom() returns undefined → guard: non-TUI → notify info. Keep simple: mode !== "tui" → notify('The interrogation panel requires TUI mode', 'info') and return.

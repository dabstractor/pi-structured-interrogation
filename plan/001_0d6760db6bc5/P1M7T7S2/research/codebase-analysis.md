# Codebase & environment analysis — P1.M7.T7.S2 (keymap conflict re-verification record)

## Sources verified

- `plan/001_0d6760db6bc5/architecture/environment-and-conflicts.md` — baseline conflict table (the "PR notes" baseline this task re-verifies and records).
- pi defaults: `/home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/keybindings.md` (installed pi 0.85.1). Confirmed: ctrl+s = app.session.toggleSort; ctrl+d = app.exit (empty editor)/deleteCharForward/session.delete; ctrl+l = app.model.select; ctrl+t = app.thinking.toggle; ctrl+g = app.editor.external + altScreen.searchNext; ctrl+b = tui.editor.cursorLeft; ctrl+shift+m/q/e = no default; digits 1–9 = no default; tab/shift+tab/enter/esc/arrows = core input/select nav; ctrl+shift+f = transcript search, ctrl+shift+up/down = transcript nav (also avoid).
- Extensions with registerShortcut (grep of `~/.pi/agent/npm/node_modules`, `~/.pi/agent/git`, `~/.pi/extensions`):
  - pi-patty-bg-tasks (`src/shortcuts.ts:27-44`): ctrl+b, ctrl+shift+b, ctrl+shift+j, shift+down, ctrl+shift+x.
  - pi-web-access (`index.ts:99`): ctrl+shift+s, ctrl+shift+w (not in settings packages list — installed but likely unloaded).
  - pi-vim: no registerShortcut; editor-internal keys only.
  - All others checked: no registerShortcut.
- User rebinds in `~/.pi/agent/keybindings.json`: only tui.editor.cursorLeft/Right, pageUp, tui.altScreen.pageUp, tui.select.pageUp — none touch our keys.

## Why our defaults are safe (rationale to record)

- Panel-scoped keys (deep ctrl+d, overview ctrl+l, focusText ctrl+t, submit ctrl+s, batchNote ctrl+shift+m, discuss ctrl+shift+e, externalEditor ctrl+g-in-text-focus) collide with pi built-ins ONLY when the panel is open — the custom() component consumes input first (intercept-before-forward, `src/panel/keys.ts` header + keydown dispatch), so the built-in never fires while the panel is up. When the panel closes (suspend), interception stops and pi defaults behave normally.
- Global keys must be genuinely free: breakOut ctrl+shift+q is registered via `pi.registerShortcut` (src/index.ts:143 area) — verified no default and no extension claims it.
- Fixed keys (enter, esc, up/down, digits) are consumed only inside the panel modal — safe for the same intercept reason; digits have no pi default anyway.
- Avoided: ctrl+b/ctrl+shift+b/x/j/shift+down (patty-bg-tasks), ctrl+shift+s/w (pi-web-access), ctrl+m (sends \r), ctrl+shift+f / ctrl+shift+up/down (transcript).

## Repo state

- `src/config.ts` DEFAULT_CONFIG.keys = the 10 keys (lines 128–140) — README table must match exactly.
- S1 (parallel) creates `README.md` with an empty `### Keymap conflict re-verification` placeholder subsection — S2 fills it; if README absent, create the section per S1's skeleton.
- Tests: vitest (`npm test`), `npm run typecheck`. Existing guard test: `src/no-hardcoded-keys.test.ts`.
- pi docs path is machine-local: `/home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/keybindings.md` (also mirrored at `~/.pi/agent/npm/node_modules/...`).

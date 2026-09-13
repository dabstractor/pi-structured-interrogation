# Environment & Keymap-Conflict Map — pi-interrogator

## repo-state

- `/home/dustin/projects/pi-structured-interrogation` contains only: `spec/` (8 md files confirmed: SPEC.md, product-requirements.md, architecture.md, tool-protocol.md, ui-spec.md, state-and-persistence.md, implementation-plan.md, decisions.md), `plan/001_0d6760db6bc5/` (prd_snapshot.md, prd_index.txt, prd_manifest.md, empty `architecture/`), `.envrc`, `.git`.
- **No package.json, no tsconfig, no src/ — the build must create them.**
- Node v26.7.0, npm 11.18.0.
- No global vitest/tsx/jiti in `/home/dustin/.local/lib/node_modules` (only the pi-coding-agent package tree). jiti IS available inside pi's loader (see below), and vitest must be installed as a local devDependency (pattern used by pi-mulligan `vitest ^1` / hapax `vitest ^4`).

## pi-package-deps

Installed pi: `@earendil-works/pi-coding-agent@0.85.1` at `/home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/` (also mirrored at `~/.pi/agent/npm/node_modules/...`).

- **typebox**: YES — direct dependency `"typebox": "1.3.7"` in pi's package.json; present as `node_modules/typebox` in both install trees. Examples do plain `import { Type } from "typebox"`. (Note: bare `typebox`, NOT `@sinclair/typebox`.)
- **@earendil-works/pi-ai**: YES — nested dep of pi at `.../pi-coding-agent/node_modules/@earendil-works/pi-ai`. **`StringEnum` lives in pi-ai's `dist/utils/typebox-helpers`** (`typebox-helpers.js:13` / `.d.ts`), exported from the package root (`import { StringEnum } from "@earendil-works/pi-ai"` — examples tic-tac-toe.ts:20, todo.ts:13). It's a small wrapper over `Type.Unsafe`.
- **Extension API import**: `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";` — no relative paths. **jiti loads extensions**: pi's `dist/core/extensions/loader.js:14` does `import { createJiti } from "jiti/static"` — TypeScript sources are loaded directly, no build step needed for a local-path extension.
- Factory shape (from `dist/core/extensions/types.d.ts`): `ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>` — i.e. `export default function (pi: ExtensionAPI) { ... }`.

## local-package-template

Reference locals: `/home/dustin/projects/pi-mulligan`, `pi-file-injector`, `hapax`, `pi-nvim-bridge`; git-installed split-editor lands at `/home/dustin/.pi/agent/git/github.com/dabstractor/split-editor`.

Minimal viable local-path extension package (pi-mulligan pattern):

```jsonc
// package.json
{
  "name": "pi-interrogator",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "pi": { "extensions": ["./src/index.ts"] },
  "engines": { "node": ">=22.19.0" },
  "peerDependencies": { "@earendil-works/pi-coding-agent": "*", "typebox": "*" },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "~0.85.1",
    "@earendil-works/pi-ai": "~0.85.1",
    "typebox": "1.3.7",
    "@types/node": "^22",
    "typescript": "^5",
    "vitest": "^1"
  },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" }
}
```

```ts
// src/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function (pi: ExtensionAPI): void {
  // pi.registerTool / pi.registerCommand / pi.registerShortcut / pi.events ...
}
```

- Enable via `"../../projects/pi-structured-interrogation"` appended to `packages` in `~/.pi/agent/settings.json`.
- Settings key pattern: a camelCase top-level key in settings.json (e.g. `"piVim": {...}`, `"fileInjector": {...}`, `"mulligan": {...}`), read via merged global+project settings; pi-file-injector reads `~/.pi/agent/settings.json` + `<cwd>/.pi/settings.json` itself with `getAgentDir()` from pi-coding-agent exports. Suggest `"interrogator": { ... }` key.

## keymap-conflict-table

User rebinds (`~/.pi/agent/keybindings.json`, ALL): `tui.editor.cursorLeft: ["left"]`, `tui.editor.cursorRight: ["right"]`, `tui.editor.pageUp: ["ctrl+pageUp"]`, `tui.altScreen.pageUp: []`, `tui.select.pageUp: []`. None touch our proposed keys.

Extension shortcuts actually registered (verified):
- **pi-patty-bg-tasks** (`~/.pi/agent/npm/node_modules/pi-patty-bg-tasks/src/shortcuts.ts:27-44`): `ctrl+b`, `ctrl+shift+b`, `ctrl+shift+j`, `shift+down`, `ctrl+shift+x`. (PRD claim verified.)
- **pi-web-access** (`index.ts:99`): `ctrl+shift+s` (curate), `ctrl+shift+w` (activity). Note: NOT in settings.json `packages` list, so likely not loaded, but installed.
- **pi-vim**: NO `registerShortcut` calls; consumes keys only inside its vim-mode editor (`ctrl+r`, `ctrl+_` in ex/register mode, index.ts:2296-2560). Does not take ctrl+s/d/l/t/g globally.
- **pi-mcp-adapter**: `ctrl+...` strings only inside panel select widgets (mcp-panel.ts), not global registerShortcut.
- split-editor, pi-mulligan, pi-file-injector, hapax, pi-nvim-bridge, pi-bar, pi-context-usage, pi-permissions, remote-pi, pi-depo, pi-chrome, pi-shell-completions, pi-lsp, telemetry, zai-usage, `~/.pi/agent/extensions/subagent`: **no registerShortcut found**.

Pi built-in defaults relevant (docs/keybindings.md): `ctrl+s`=app.session.toggleSort / models.save / thinking.save; `ctrl+l`=app.model.select (+tree.filter.labeledOnly); `ctrl+t`=app.thinking.toggle (+tree.filter.noTools); `ctrl+d`=app.exit (empty editor) / session.delete / deleteCharForward / tree filter default; `ctrl+g`=app.editor.external (externalEditor — PRD's mirror claim verified) + searchNext; `ctrl+b`=cursorLeft (editor-local); `ctrl+f`=cursorRight; `ctrl+shift+m/q/e`= no default binding; `tab`=tui.input.tab; `shift+tab`=app.thinking.cycle; `enter`=submit/select.confirm; `esc`=interrupt/select.cancel; digits 1-9: no default binding; up/down=editor+select nav.

| key | status | owner | evidence |
|---|---|---|---|
| ctrl+s | CONFLICTED (built-in, multi-context) | pi: session toggleSort, models.save, thinking.save | docs/keybindings.md "Application"/"Sessions"/"Models" tables |
| ctrl+d | CONFLICTED (built-in, multi-context) | pi: app.exit, session.delete, deleteCharForward | docs/keybindings.md |
| ctrl+l | CONFLICTED (built-in) | pi: app.model.select, tree.filter.labeledOnly | docs/keybindings.md |
| ctrl+t | CONFLICTED (built-in) | pi: app.thinking.toggle, tree.filter.noTools | docs/keybindings.md |
| ctrl+g | CONFLICTED (built-in) | pi: app.editor.external (nvim), searchNext | docs/keybindings.md "Application" |
| ctrl+shift+m | FREE | none (no default, no extension) | docs/keybindings.md; grep registerShortcut |
| ctrl+shift+q | FREE | none | same |
| ctrl+shift+e | FREE | none | same |
| tab / shift+tab / enter / esc / up / down | CONFLICTED (core input/select nav) | pi core | docs/keybindings.md "TUI Input"/"TUI Clipboard" |
| digits 1-9 | FREE (no default) | — | docs/keybindings.md |
| ctrl+b, ctrl+shift+b/x/j, shift+down | TAKEN by patty-bg-tasks | patty-bg-tasks | shortcuts.ts:27-44 |
| ctrl+shift+s, ctrl+shift+w | TAKEN by pi-web-access (if loaded) | pi-web-access | index.ts:99 |

Note: pi extensions register shortcuts that overlay editor keys; ctx-awareness matters. Prefer ctrl+shift+m/q/e as defaults; ctrl+s/d/l/t/g and plain digits are risky (digits usable inside a modal overlay only). Also avoid `ctrl+shift+f` (transcript search) and `ctrl+shift+up/down` (transcript nav).

## testing-setup

- pi-mulligan: vitest ^1, `"test": "vitest run"`, `typecheck: tsc --noEmit`, plain `test/*.test.ts`; tsconfig.json present; engines node >=22.19.0.
- hapax: vitest ^4, `test: vitest --run`, `check: tsc --noEmit`, devDeps pin `@earendil-works/pi-coding-agent ~0.84.4`.
- pi-file-injector uses plain `node --test`-style `.test.mjs`.
- Recommended: vitest + tsc --noEmit (matches mulligan/hapax).

## toolchain-versions

- node 26.7.0, npm 11.18.0
- pi-coding-agent 0.85.1 (type "module", main dist/index.js, types dist/index.d.ts)
- typebox 1.3.7 (pi dep), jiti used by pi loader (jiti/static), no global tsx/vitest/jiti
- jiti resolves `@earendil-works/*` and `typebox` imports from the extension's own node_modules and pi's tree — peerDeps + devDependencies approach avoids runtime resolution issues.

# External Dependencies — pi-interrogator

All dependencies resolve from the installed pi package tree; no new runtime dependencies required.

## Runtime (peer/dev — resolved via jiti from pi's tree or local node_modules)

| Package | Version | Role | Import |
|---|---|---|---|
| `@earendil-works/pi-coding-agent` | 0.85.1 | Extension host: `ExtensionAPI` type, `getAgentDir()`, `CustomEditor` base (if needed) | `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"` |
| `typebox` | 1.3.7 (pi dep) | Tool parameter schemas. **Bare `typebox`, NOT `@sinclair/typebox`** | `import { Type } from "typebox"` |
| `@earendil-works/pi-ai` | ~0.85.1 (pi nested dep) | `StringEnum` (Google-compatible enums; lives in `dist/utils/typebox-helpers`, exported from root) | `import { StringEnum } from "@earendil-works/pi-ai"` |
| `@earendil-works/pi-tui` | (pi dep) | TUI components: `Editor`, `Text`, `Box`, `Key`, `matchesKey`, EditorTheme | `import { Editor, Text, ... } from "@earendil-works/pi-tui"` |
| `jiti` | (pi's loader) | TS loaded directly — no build step | n/a |

Node builtin `node:fs`/`node:path`/`node:child_process` for settings load + `$EDITOR` spawn.

## Dev

- `typescript ^5` + `tsc --noEmit` (typecheck script)
- `vitest ^1` (pi-mulligan precedent; hapax uses ^4) — `"test": "vitest run"`
- `@types/node ^22`
- Engines: node >= 22.19.0 (installed: 26.7.0, npm 11.18.0)

## Package skeleton (local-path extension, pi-mulligan pattern)

```jsonc
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
export default function (pi: ExtensionAPI): void { /* registrations */ }
```

## Loading for development

- Quick: `pi -e src/index.ts` (single-file load of the entry).
- Persistent: append `"../../projects/pi-structured-interrogation"` to `packages` in `~/.pi/agent/settings.json` (paths resolve against the settings file's dir; directory → package rules via `pi.extensions` manifest).
- `npm install` locally to materialize devDeps for typecheck/vitest; runtime resolution flows through jiti against pi's tree.

## Reference sources (local, authoritative)

- Docs: `/home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/{extensions,tui,keybindings,settings,session-format,compaction}.md`
- Examples: `.../examples/extensions/{questionnaire,todo,qna,entry-renderer,message-renderer,widget-placement,send-user-message,custom-compaction,plan-mode/}.ts`
- Type decls: `.../dist/core/extensions/types.d.ts`

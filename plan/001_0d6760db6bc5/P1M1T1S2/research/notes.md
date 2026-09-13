# Research — P1.M1.T1.S2 config.ts

## Settings-loading precedent (pi-file-injector, verified in-repo at /home/dustin/projects/pi-file-injector/file-injector.ts:307–356)
- pi exposes NO settings accessor to extensions (pi-api-validation.md §Mismatch 4).
- Pattern: `getAgentDir()` from `@earendil-works/pi-coding-agent` → global `settings.json`; project = `<cwd>/.pi/settings.json`.
- Every read/parse is try/caught → `{}`; non-object or array values → `{}`; never throws.
- Key namespacing: take the sub-object under `"interrogator"` key.

## pi exports verified
`grep dist/index.d.ts`: `export { CONFIG_DIR_NAME, getAgentDir, ... } from "./config.ts"` — both are named exports of `@earendil-works/pi-coding-agent`. CONFIG_DIR_NAME is `".pi"`.
Note: getAgentDir() is in config.ts (not obviously async) — file-injector calls it synchronously (`path.join(getAgentDir(), "settings.json")`). Use `readFileSync`/`readFile` from `node:fs/promises`; the tool/panel callers can await.

## Config reference (PRD h2.52 — verbatim defaults)
keys: deep ctrl+d, overview ctrl+l, focusText ctrl+t, batchNote ctrl+shift+m, submit ctrl+s, breakOut ctrl+shift+q, discuss ctrl+shift+e, externalEditor ctrl+g, prevQuestion tab, nextQuestion shift+tab.
caps: description 1200, ramification 600, options 7, questions 40, goal 400, contextBudgetPct 4.
toggles: gateWarnings true, roundDetection true, digitQuickSelect true. editorMode: "composed" (| "stock").

## Key labels
h2.52: every display string naming a key must be generated from resolved config — never hardcode. resolveKeyLabels(config) maps config.keys.* → display labels. Normalization for display: "ctrl+shift+q" → e.g. "Ctrl+Shift+Q"; keep simple, capitalize tokens.

## Deep-merge requirement
Unlike file-injector's shallow merge, PRD h2.18 says "deep-merged over defaults" — nested objects (keys, caps) merge per-key; scalars override. Arrays not present in config schema. Unknown keys: preserve? Contract says tolerant of missing keys; simplest safe behavior: deep-merge known shape with plain-object recursion; unknown keys pass through harmlessly (typed shape just ignores).

## Consumers (interfaces downstream tasks expect)
- tool.ts caps engine (P1.M1.T3.S3): `config.caps`
- panel/keys.ts (P1.M3.T3.S1): `config.keys`
- footer/widget/dialogs (P1.M3.T1.S2, P1.M6.T1.S1): `resolveKeyLabels(config)`
- detect.ts (P1.M7.T4.S1): `config.roundDetection`
- README config reference (P1.M7.T7.S1): JSDoc on loadConfig is source of truth (Mode A docs).

# Research notes — P1.M7.T7.S1 README.md

## Verified facts from codebase (read directly)

### Package / install
- `package.json`: name `pi-interrogator`, main/exports `./src/index.ts`, `pi.extensions: ["./src/index.ts"]`, engines node>=22.19.0, peerDeps `@earendil-works/pi-coding-agent` + `typebox`.
- Scripts: `npm test` → `vitest run`; `npm run typecheck` → `tsc --noEmit`.
- Install paths (architecture/external-deps.md §Loading):
  - Quick dev: `pi -e src/index.ts`
  - Persistent: add `"../../projects/pi-structured-interrogation"` to `packages` in `~/.pi/agent/settings.json` (paths resolve against settings file dir; directory → package via `pi.extensions` manifest). `npm install` needed for devDeps (typecheck/vitest).

### Config surface (src/config.ts, DEFAULT_CONFIG at line 128)
- Settings key: `"interrogator"` in global `<agentDir>/settings.json` or project `<cwd>/.pi/settings.json`; precedence DEFAULT ← global ← project; tolerant load, never throws.
- keys: deep ctrl+d, overview ctrl+l, focusText ctrl+t, batchNote ctrl+shift+m, submit ctrl+s, breakOut ctrl+shift+q, discuss ctrl+shift+e, externalEditor ctrl+g, prevQuestion tab, nextQuestion shift+tab.
- caps: description 1200, ramification 600, options 7, questions 40, goal 400, contextBudgetPct 4.
- toggles: gateWarnings, roundDetection, digitQuickSelect, compactionPreservation (all default true — note: compactionPreservation is an addition beyond the PRD h2.52 sample), editorMode: "composed" | "stock".
- Display strings generated via `resolveKeyLabels(config)` — enforced by src/no-hardcoded-keys.test.ts.
- Fixed keys (not remappable, h2.34): enter/esc/arrows/digits.

### Debug commands (src/debug-commands.ts)
- `/interrogate-debug-upsert <json>` — full upsert code path
- `/interrogate-debug-submit id=value,…` — flush as user submissions
- `/interrogate-debug-state` — status line + per-question lines
- Plus `/interrogate-ping` smoke test (index.ts), `/interrogate` reopen command (command.ts).

### Problem statement (PRD h2.5, verbatim source)
Question lists scroll off screen; user must scroll up to re-read, losing input box; requirements scattered/contradictory/forgotten. Interrogation needs the question set front-and-center while answering at one's own pace.

### Limitations (h2.4 + contract)
- Drafts not persisted across restart (documented limitation; in-session survival is guaranteed).
- TUI-first: non-TUI/`-p` mode gets fallback digest, not panel.
- Non-goals: no chat-text parsing while panel open, no concurrent interrogations, no images, no mouse, no pi-core modification, no per-request state injection.
- Compaction adaptation: compaction preservation emits instructions (session_before_compact); state reconstructs from mirror entries.

### Related artifacts
- Manual TUI AC runbook: plan/001_0d6760db6bc5/MANUAL-TUI-AC-RUNBOOK.md (human-only, pointer target for README dev section).
- P1.M7.T6.S2 (parallel): scripted panel AC pass — its PRP may add vitest coverage; README dev section should reference `npm test` generally so it stays true regardless.
- README.md does not exist yet (confirmed `ls README.md` → not found).
- Keymap conflict re-verification is S2's job — README must leave a clearly delimited subsection/anchor for S2's record so it can append without conflicts.

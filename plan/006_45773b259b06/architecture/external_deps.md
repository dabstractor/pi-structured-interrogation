# External dependencies — delta `006_45773b259b06`

**No new technology is introduced by this delta** (docs-only). The verification
toolchain depends on the local pi installation, enumerated here so downstream
agents do not rediscover it:

| Dependency | Version @ research | Path / note |
|---|---|---|
| pi-coding-agent | 1.0.2 | `~/.local/lib/node_modules/@earendil-works/pi-coding-agent` (`which pi` → `~/.local/bin/pi` → same install). Built-in bindings doc: `docs/keybindings.md` under that prefix — first candidate in the script; fallback `~/.pi/agent/npm/node_modules/@earendil-works/pi-coding-agent/docs/keybindings.md` |
| Installed extension trees scanned by the script | — | `~/.pi/agent/npm/node_modules`, `~/.pi/agent/git`, `~/.pi/extensions` (only those that exist are scanned) |
| Known global registrants | pi-patty-bg-tasks (5 string-literal chords, `src/shortcuts.ts:28-49`), pi-web-access (variable-indirect — AVOIDED-list only), pi-subagents (Key constant — AVOIDED-list/manual) | Live grep sees string literals only; this limitation is documented in the script and must be echoed in the README record |

The README record block cites the pi version and the method; keep both sourced from
the actual run (`scripts/verify-keymap-conflicts.sh` prints a WARN and degrades
gracefully if `docs/keybindings.md` is unreadable — record that if it happens).

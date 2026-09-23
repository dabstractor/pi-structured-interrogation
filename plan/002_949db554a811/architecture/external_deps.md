# External Dependencies — pi-interrogator delta (spec M8)

**Verdict: no new external dependencies, no new pi API surface.** The delta explicitly forbids new config keys and new pi API usage beyond already-consumed events (PRD non-goals; spec §Non-goals). Verified against `package.json`, `src/index.ts` wiring, and spec §"pi API surface used".

## Existing stack (unchanged, pinned)

| Dep | Version | Role |
|---|---|---|
| `@earendil-works/pi-coding-agent` | ~0.85.1 (peer + dev) | pi extension host API: `pi.registerTool/registerCommand/on/sendMessage/appendEntry/events`, `ctx.ui.custom/setWidget/getEditorComponent/setEditorText/notify`, `ctx.mode/hasUI/model.contextWindow` |
| `@earendil-works/pi-tui` | ^0.85.1 | TUI component base for the panel |
| `@earendil-works/pi-ai` | ~0.85.1 | `StringEnum` for typebox schemas |
| `typebox` | 1.3.7 | `interrogate` param/result schemas (`AnswerInput` at tool-schema.ts:156 gains `custom`) |
| `typescript` ^5 / `vitest` ^1 / node ≥22.19 | — | `tsc --noEmit`; `vitest run` (48 test files) |

## pi API consumed by this delta (all already wired — cite, don't add)

- `pi.events` `@eko24ive/pi-ask:*` bridge contract (FR-31..34, shipped) — delta only appends a tail hook inside `recordRemoteSubmission`.
- `tool_execution_start`/`tool_execution_end` subscriptions already exist in `src/index.ts` (args stash :215–225; deferred bridge emission registered last). SURFACE-001 reads the existing stash — no new subscription.
- `session_start` reconstruction path (`src/reconstruct.ts`) — SURFACE-002 swaps `openPanel` for the existing `ctx.ui.setWidget` helper; `onRestored` bridge emission retained.

## External research needed: none

No new technology is introduced. The write-in row, auto-submit hook, and surfacing gates are pure in-repo logic over existing seams (see `system_context.md` seam map). No third-party docs to consult; the authoritative spec strings live in `spec/ui-spec.md` (quoted verbatim in `config-tests-docs.md § Final strings ledger`).

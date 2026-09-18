# Implementation Plan — pi-interrogator

Target: a single competent dev agent one-shots this. Build in order; each milestone ends in a runnable, manually verifiable state.

## Prerequisites

- pi extension dev: read pi docs `extensions.md`, `tui.md`, `keybindings.md` before starting.
- Reference examples (in pi install): `questionnaire.ts` (embedded `Editor` inside `ctx.ui.custom` — proven pattern), `todo.ts` (tool-result-details state), `entry-renderer.ts`, `message-renderer.ts`, `qna.ts`, `plan-mode/` (event orchestration).
- TypeScript via jiti; typebox for schemas; `StringEnum` from `@earendil-works/pi-ai` for enums (Google compat).

## Milestones

**M1 — Tool + state core (no UI).** `config.ts`, `state.ts`, `tool.ts`, `index.ts` registration. Verify: in a scratch session the model upserts questions, reads state, gets merge-rule behavior and rev/epoch rejections; caps truncate with warnings; `details` carries full state. Non-TUI fallback digest renders in `-p` mode.

**M2 — Delivery + lifecycle.** `delivery.ts`, `lifecycle.ts` (auto-close on `agent_settled`, completion injection), renderers for tool rows. Verify with acceptance criteria 2, 3, 13, 14 (state-level, without panel: submissions still deliver from fallback path in `-p`).

**M3 — Panel short form.** `panel/panel.ts`, `short-view.ts`, `keys.ts`: replace-editor hosting, header/goal, options with ★ marks + preselect, digits/enter accept-advance, tab navigation, footer status. Verify AC-1 (minus gate dimming), AC-5 partially.

**M4 — Text field + drafts.** `text-field.ts`: compose `getEditorComponent()`, two-stage enter, `ctrl+g` `$EDITOR`, per-question drafts + batch note + `ctrl+shift+m`. Verify draft survival across navigation and upserts (R4).

**M5 — Deep view, overview, gate, ripples.** `deep-view.ts` (scrollable pane, sticky option headers, select-from-deep), `overview.ts`, group dimming + gate warnings, `dependsOn` evaluator + moot marks + ripple confirm. Verify AC-5, 6, 7.

**M6 — Suspend/resume ecosystem.** `esc` suspend + invoke-only `/interrogate` (immediate in every scenario) + widget naming `/interrogate`, reopen action, discuss-in-chat handoff with `setEditorText`, editor-text preservation across suspend. The `ctrl+shift+q` chord and its global shortcut were removed (window managers claim it on many desktops). Verify AC-4.

**M7 — Persistence + polish.** `persistence.ts` (mirror, reconstruction, auto-open), compaction instructions, message/entry renderers (cards), round detection (FR-26), terminal fallbacks (<24/<12 rows, <60 cols), config reference, README. Verify AC-8, 9, 10, 11, 12.

## File checklist

- [ ] `index.ts` — factory; registers tool/command/shortcut/events/renderers; mode guards
- [ ] `config.ts` — defaults + settings load; keymap table (ui-spec §Hotkeys), caps (tool-protocol §Caps), toggles (`gateWarnings`, `roundDetection`, `digitQuickSelect`)
- [ ] `state.ts` — state machine, rev/epoch, snapshots, change events, dependsOn evaluator
- [ ] `tool.ts` — schema, guards, merge rules, caps, fallback formatting, status line
- [ ] `panel/panel.ts` — `ctx.ui.custom` host, view switching, focus model, draft store
- [ ] `panel/short-view.ts`, `deep-view.ts`, `overview.ts`
- [ ] `panel/text-field.ts` — editor composition, `$EDITOR`
- [ ] `panel/keys.ts` — config-driven routing; intercept-before-forward rule
- [ ] `delivery.ts` — delta messages, completion record, reminder line
- [ ] `lifecycle.ts` — open/suspend/resume/reopen, widget, auto-close, completion trigger
- [ ] `renderers.ts` — submission/completion cards, state entry, tool rows
- [ ] `persistence.ts` — mirror, reconstruction, compaction instructions
- [ ] `detect.ts` — round heuristic + throttled notify
- [ ] `README.md` — install, config reference, keymap table, limitations (drafts not persisted; TUI-first)

## Testing

- **Unit (node/tsx script or vitest)**: state machine transitions; merge rules 1–4; rev/epoch guard math; dependsOn closure (transitive ripples); caps formula; reconstruction from fixture entries (tool-result details + deltas + entry-mirror fallback); delta digest formatting.
- **Integration (launch `pi -e .`)**: scripted model turns are unreliable — drive the tool directly via a debug command (`/interrogate-debug-upsert <json>`) that invokes the same code path as the tool; then manual verification per the AC runbook below.
  - **AUTOMATION AMENDMENT (binding, supersedes the above in automated runs — see plan/001_0d6760db6bc5/AUTOMATION-POLICY.md)**: automated pipeline runs NEVER launch a live `pi -e .` TUI session, NEVER call the `interrogate` tool for real, and NEVER wait for user answers. Automation drives the same code paths via vitest integration tests over `executeInterrogate`/the debug handlers plus headless `pi -p` one-shot probes. "Launch `pi -e .`" and "manual verification" above describe the HUMAN test procedure (recorded in MANUAL-TUI-AC-RUNBOOK.md), not an automated step.
- **AC runbook**: execute acceptance criteria 1–14 from product-requirements.md in order; each cites the FR it proves. AC-12 (rebinding) proves R5. AC-4 includes verifying the *main editor's* draft survives panel suspend/resume. In automation, ACs are proven by scripted tests; interactive-only ACs are deferred to the human runbook and never block the pipeline.
- **Regression guard**: keymap conflict re-verification (grep installed extensions' `registerShortcut` + pi `keybindings.md`) recorded in README.

## Risks

| Risk | Mitigation |
|---|---|
| Embedded editor double-instance quirks (history, IME, paste) | M4 isolated; fall back to stock pi-tui `Editor` if composition misbehaves (config flag `editorMode: "composed" \| "stock"`) |
| Deep-view scroll pane rendering bugs at odd widths | Cap + ellipsize; overview list is the escape hatch |
| `agent_settled` ordering vs tool_execution_end | Track per-run flags set in `tool_execution_end`; close pass reads them (state-and-persistence algorithm) |
| Compaction dropping tool-result details | Entry-mirror fallback path (tested via fixture) |
| Ctrl+shift+m/e terminal variability | Config-rebindable; documented; `\r` collision avoided |
| Model ignores "end your turn" instruction | Harmless (instruction-only, Q28=B); never `terminate` |

## Config reference (settings.json → `"interrogator"`)

```jsonc
{
  "keys": { "deep": "ctrl+d", "overview": "ctrl+l", "focusText": "ctrl+t",
            "batchNote": "ctrl+shift+m", "submit": "ctrl+s",
            "discuss": "ctrl+shift+e", "externalEditor": "ctrl+g",
            "prevQuestion": "tab", "nextQuestion": "shift+tab" },
  "caps": { "description": 1200, "ramification": 600, "options": 7,
            "questions": 40, "goal": 400, "contextBudgetPct": 4 },
  "gateWarnings": true, "roundDetection": true, "digitQuickSelect": true,
  "editorMode": "composed",
  "remote": { "enabled": true, "resurface": true }
}
```

## Remote integration milestone (2026-09-18; spec/decisions.md § Remote)

Build order: config surface → `remote-bridge.ts` (emission + submit handling + latch) → `remote-submit.ts` (panel-parity pipeline; extract `submissionBaselineOf` into snapshots.ts) → tool.ts hooks (`onLiveQuestions`, `hasRemoteSurface`) → index/completion/reconstruct wiring (`onCompleted`, `onRestored`) → tests (unit, real-bridge contract compat, live RPC round trip) → README.

Every display string that names a key (footer, widget, dialogs) is generated from the resolved config — never hardcode a key label.

# System Context — pi-interrogator

## What is being built

`pi-interrogator`: a single pi extension (TypeScript, jiti-loaded, no build step) providing structured interrogation — the model asks dozens of planning questions via one `interrogate` tool; the user answers in a persistent replace-editor bottom panel; partial submissions flow back as delta messages that trigger a new agent reply; the full Q&A record is injected exactly once at completion. Source of truth is the extension's in-memory state, guarded by per-question `rev` + session `epoch`.

**Greenfield**: repo `/home/dustin/projects/pi-structured-interrogation` contains only `spec/` (PRD sources, READ-ONLY), `plan/`, `.pi/`, `.envrc`, `.git`. Everything (package.json, tsconfig, src/) is created by this project. Target: pi 0.85.1 (`@earendil-works/pi-coding-agent`).

## Verified architectural pattern (THE core trick)

`ctx.ui.custom(factory)` **blocks** until `done()` is called (questionnaire.ts awaits it inside a tool execute). The PRD requires a NON-BLOCKING tool (commitment 1). Resolution, confirmed feasible against the API contract:

- `tool.ts` execute performs state upsert, then calls `lifecycle.openPanel(ctx)` and **returns immediately** — it never awaits the panel promise.
- `lifecycle.openPanel` invokes `ctx.ui.custom(...)` fire-and-forget (store the floating promise; swallow/inspect resolution). The panel component holds keyboard focus and IS the bottom editor region (non-overlay default) while the transcript stays visible above.
- Suspend = `done(null)` inside the panel (resolves the promise; editor region restored automatically). Resume = re-instantiate via the same fire-and-forget path, rehydrated from state + preserved drafts (held in extension memory, outside the component).
- Only entry into `await ctx.ui.custom` is forbidden inside tool execute; commands/events may also open the panel the same way (`/interrogate`, reopen, reconstruction auto-open).

## Module layout (from PRD architecture.md, confirmed against API)

```
src/
├── index.ts        # factory: export default (pi: ExtensionAPI) => void; registrations + mode guards
├── config.ts       # defaults + manual settings.json load (getAgentDir() + <cwd>/.pi/settings.json, deep-merge, key "interrogator")
├── state.ts        # InterrogationState: Map<id,Question>, order[], epoch, revs, snapshots, dependsOn evaluator, EventEmitter
├── tool.ts         # schema (typebox + StringEnum), 4 actions, guards (throw), caps, fallback digest, status line
├── panel/          # panel.ts (custom host, fire-and-forget), short-view.ts, deep-view.ts, overview.ts, text-field.ts, keys.ts
├── delivery.ts     # delta messages (sendMessage + triggerTurn:true), completion record
├── lifecycle.ts    # open/suspend/resume/reopen, widget, auto-close on agent_settled, completion trigger
├── renderers.ts    # message/entry renderers + tool rows
├── persistence.ts  # debounced entry mirror, session_start/session_tree reconstruction, compaction handler
└── detect.ts       # plain-text question-round heuristic (turn_end capture + agent_settled)
```

## Event wiring (extends PRD table with research-confirmed additions)

| Event | Handler |
|---|---|
| `session_start` | reconstruct state from branch; auto-open panel (FR-28) |
| `session_tree` | **ADDED** (todo.ts pattern): branch switches mid-session must re-reconstruct (PRD h2.43 branching) |
| `agent_settled` | auto-close pass (FR-4); completion check (FR-5); round-detection notify (FR-26) |
| `tool_execution_start`/`end` | record upserts this run (feeds auto-close); start carries args |
| `turn_end` | **ADDED**: capture final assistant message for round detection |
| `session_before_compact` | FR-29 via custom-compaction pattern (see adaptation below) |
| `session_shutdown` | flush mirror entry |

## Key adaptations (PRD intent → verified API contract)

1. **Submissions trigger replies**: `pi.sendMessage({customType:"interrogation-submission", content, display:true, details}, { triggerTurn: true, deliverAs: "followUp" })`; if streaming at submit time, deliverAs "steer". Custom messages participate in LLM context (model sees the delta).
2. **Stale guards throw**: `throw new Error("STALE: q3 is at rev 5 (you sent 2) ...")` → pi sets isError and reports the message to the LLM.
3. **FR-29 compaction**: session_before_compact result type has NO customInstructions field. Implement preservation via the custom-compaction.ts pattern: build the summary ourselves (ctx.modelRegistry + serializeConversation + convertToLlm) with the PRD's "Preserve verbatim: ..." text prepended; on failure return undefined (default compaction). Mirror entry + pull-refresh make this belt-and-braces.
4. **Settings**: no ctx.settings API → manual read of `~/.pi/agent/settings.json` + `<cwd>/.pi/settings.json` (fs, getAgentDir()), deep-merge project over global, `"interrogator"` key.
5. **Editor composition**: capture `ctx.ui.getEditorComponent()` ONCE at panel creation; if defined and config `editorMode === "composed"`, instantiate per-panel `factory(tui, editorTheme, keybindings)` (user's pi-vim editor, vim modes work); else fall back to stock `new Editor(tui, editorTheme)` from `@earendil-works/pi-tui` (questionnaire.ts:146 pattern). Both satisfy the same EditorComponent contract.

## Keymap reality (full table in environment-and-conflicts.md)

- Panel-scoped defaults (ctrl+s/d/l/t/g, tab, digits, enter, esc) are SAFE inside the panel: the custom component owns raw keyboard focus and consumes input before app keybindings (questionnaire.ts intercepts escape the same way). keys.ts implements intercept-before-forward to the embedded editor.
- Global shortcut `ctrl+shift+q` (break-out/resume, also handled inside panel): FREE — no pi default, no installed extension claims it.
- ctrl+shift+m / ctrl+shift+e: FREE. Digits 1–9: FREE.
- AVOID (taken): ctrl+b, ctrl+shift+b/x/j, shift+down (pi-patty-bg-tasks); ctrl+shift+s/w (pi-web-access if loaded); ctrl+shift+f (transcript search); ctrl+shift+up/down (transcript nav); ctrl+m (sends \r).
- User's keybindings.json rebinds only editor cursorLeft/right + pageUp keys — no collisions.

## State & reconstruction (todo.ts-proven pattern)

- Canonical state rides every tool result `details` (branch-correct by construction).
- Reconstruction: scan `ctx.sessionManager.getBranch()` for the LAST `toolResult` message with `toolName === "interrogate"` (details.state = base), then replay subsequent `interrogation-submission` custom messages' `details.changed`; fallback: newest `interrogation-state` custom entry. Re-run dependsOn moot evaluation. `getBranch()` (raw) preferred over `buildContextEntries()` (compaction-applied) so compacted-away tool results are still found via the entry mirror.
- Snapshots: ring of 10 full-state copies on each submission → diff cards + recovery.

## Testing strategy

- vitest (local devDependency; pi-mulligan/hapax precedent) for state machine, merge rules, guards, caps, dependsOn closure, reconstruction fixtures, digest formatting.
- Integration: `pi -e src/index.ts` (or local-path package entry) + debug commands `/interrogate-debug-upsert <json>`, `/interrogate-debug-submit`, `/interrogate-debug-state` driving the SAME code paths as the tool → scripted AC verification without model dependence. AC runbook = acceptance criteria 1–14.
- Toolchain: node 26.7.0, npm 11.18.0, TS via jiti (no emit), `tsc --noEmit` typecheck script.

## Docs plan (SOW §5)

- Mode A: JSDoc on every exported symbol + config reference comments ride with implementing subtasks.
- Mode B: final task sweeps README.md (install via local-path package, config reference, keymap table with conflict-verification record, limitations: drafts not persisted / TUI-first).

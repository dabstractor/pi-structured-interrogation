# pi 0.85.1 API Validation — pi-interrogator PRD

Verified against `/home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/` (docs/, dist/core/extensions/types.d.ts = "TD"). Version 0.85.1.

## Confirmed API surface (exact signatures)

### registerTool (docs/extensions.md:1955–2080)
```ts
pi.registerTool({
  name, label, description,           // description shown to LLM (always resident for active tools)
  promptSnippet: "...",               // one-liner
  promptGuidelines: ["Use interrogate for ..."],  // bullets — CONFIRMED on tools
  parameters: Type.Object({...}),     // typebox; StringEnum from @earendil-works/pi-ai
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    return { content: [{ type: "text", text }], details: {...} };
  },
  renderCall(args, theme, context),                       // -> Text
  renderResult(result, { expanded }, theme, context),     // -> Text
});
```
- **isError is set ONLY by throwing from execute** (extensions.md:2068). Stale-guard rejections must `throw new Error("STALE: ...")` carrying current state in the message; never return an isError field.
- onUpdate streaming updates available (not needed for interrogate).

### registerCommand (extensions.md:1525)
`pi.registerCommand("name", { description, handler: async (args: string, ctx) => {} })` — ctx has `ctx.ui`, `ctx.mode`, `ctx.isIdle()`, session control (`fork`, `navigateTree`, ...).

### registerShortcut (extensions.md:1638; keybindings.md:11–29)
`pi.registerShortcut("ctrl+shift+q", { description, handler: async (ctx) => {} })` — key format `modifier+key`, modifiers ctrl/shift/alt/super combinable. Flat app-level registration (no mode scoping); effectively TUI-only. Handler ctx has `ctx.ui`.

### Events (TD types.d.ts:909–940 — full on() overloads verified)
- `session_start` — `event.reason: "startup"|"reload"|"new"|"resume"|"fork"`.
- `agent_settled` — fires when Pi will not continue automatically; `ctx.isIdle()` true unless another extension started a run. **Abort semantics undocumented** (see Unknown).
- `tool_execution_end` — `event: { toolCallId, toolName, result, isError }` (args are on `tool_execution_start.event.args`).
- `session_before_compact` — event: `{ preparation, branchEntries, customInstructions?, reason, willRetry, signal }`; **result type is `{ cancel?: boolean; compaction?: CompactionResult }` ONLY** (TD types.d.ts:857–860). There is NO customInstructions return field. (Contrast: `session_before_tree` result DOES have `customInstructions` — different event.)
- `session_shutdown` — `event.reason: "quit"|"reload"|"new"|"resume"|"fork"`.
- Also available (useful): `session_tree` (branch navigation — todo.ts reconstructs here), `turn_end` (`event.message` = completed assistant message — feeds FR-26 round detection), `tool_execution_start` (args), `ui_prompt_start/end` (fire around custom()).

### ctx.ui (TD types.d.ts:63–180 — ExtensionUIContext)
- `custom<T>(factory: (tui, theme, keybindings, done: (result: T) => void) => Component & { dispose?() }, options?: { overlay?: boolean; overlayOptions?; onHandle? }): Promise<T>` — "temporarily replaces the editor with your component until done() is called" (extensions.md:2731). **Non-overlay (default) replaces the bottom editor region; transcript stays visible.** Overlay mode is experimental — not used. In RPC mode `custom()` returns undefined → guard on `ctx.mode === "tui"`.
- Component contract: `{ render(width: number): string[]; invalidate(): void; handleInput(data: string): void }` (questionnaire.ts).
- `setWidget(key, content: string[] | ((tui, theme) => Component) | undefined, options?: { placement?: "belowEditor" })` — keyed; multiple widgets coexist; `undefined` clears.
- `getEditorComponent(): EditorFactory | undefined` where `EditorFactory = (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent` (TD types.d.ts:62). Capture-then-wrap pattern documented (extensions.md:2796): `const prev = ctx.ui.getEditorComponent(); ctx.ui.setEditorComponent((t,th,kb) => new Wrapped(t,th,kb, prev?.(t,th,kb)))`.
- `setEditorText(text)`, `getEditorText()`, `pasteToEditor(text)`, `notify(message, "info"|"warning"|"error")`, `setStatus(key, text|undefined)` (footer segment).
- `select/confirm/input` dialogs; `editor(title, prefill)` multi-line prompt.

### Messaging & entries
- `pi.sendMessage({ customType, content, display, details }, { triggerTurn?: boolean; deliverAs?: "steer"|"followUp"|"nextTurn" })` (TD types.d.ts:971–981). Custom messages are `role: "custom"`, **participate in LLM context**, rendered via registerMessageRenderer. **Does NOT trigger a reply unless `triggerTurn: true`** (and when streaming, deliverAs is required to queue).
- `pi.sendUserMessage(content, { deliverAs })` — real user message, always triggers a turn; throws while streaming unless deliverAs set.
- `pi.appendEntry(customType, data)` — custom entry, **NOT in LLM context**, user-visible only via entry renderer, restorable via `ctx.sessionManager.getEntries()`/`getBranch()`.
- `pi.registerMessageRenderer(customType, (message, { expanded, outputPad }, theme) => Component)`; `pi.registerEntryRenderer<T>(customType, (entry, { expanded }, theme) => Component)`.
- Hidden per-turn context: `before_agent_start` → `{ message: { customType, content, display: false } }` + `pi.on("context")` filtering (plan-mode pattern) — NOT needed for v1 (per-request injection vetoed).

### Context / model / mode
- `ctx.mode: "tui" | "rpc" | "json" | "print"`; `ctx.hasUI` (TUI+RPC true; print/json false).
- `ctx.model.contextWindow` (tokens) — confirmed on model schema; `ctx.getContextUsage()` also available.
- `ctx.sessionManager.buildContextEntries()` (compaction-applied branch entries), `getEntries()`, `getBranch()`, `getLeafId()`.

### Compaction
- `ctx.compact({ customInstructions, replaceInstructions?, ... })` — customInstructions is an INPUT to compaction (from the caller), not settable by a session_before_compact handler.
- Full custom compaction from an extension: return `{ compaction: { summary, firstKeptEntryId, tokensBefore, usage?, details? } }` from session_before_compact — reference `examples/extensions/custom-compaction.ts` (uses `ctx.modelRegistry`, `serializeConversation`, `convertToLlm`).

## MISMATCHES / ADAPTATIONS required vs PRD

1. **FR-29 mechanism**: PRD assumes `session_before_compact` "supplies custom instructions" to the default summarizer. The real result type has no such field. ADAPTATION: implement the preservation instructions via the custom-compaction pattern (handler builds the summary itself with the PRD's verbatim-preservation text prepended to the summarizer prompt; on any failure return undefined → default compaction). Redundancy already in design: entry mirror + pull-refresh survive compaction regardless.
2. **Submission must trigger a reply**: sendMessage requires `{ triggerTurn: true, deliverAs: "followUp" }` (steer if streaming). PRD text doesn't name these options.
3. **isError**: stale-guard rejections throw (message = "STALE: ..." + current state), not a returned field.
4. **Extension settings**: no documented `ctx.settings` API. Read `~/.pi/agent/settings.json` + `<cwd>/.pi/settings.json` manually (fs + `getAgentDir()` exported by pi-coding-agent; pi-file-injector pattern), deep-merge project over global, key `"interrogator"`.
5. **Prompt guidelines**: no standalone global-guidelines API — use the tool's own `promptGuidelines: string[]` (exactly what the PRD wants: 2 bullets).
6. **120-word description**: convention only (no API limit); keep description ≤120 words per PRD.

## UNKNOWN / verify empirically during build

1. `agent_settled` firing on aborted runs (FR-4 says aborts count as settled) — verify with a scripted abort; code defensively (close pass is idempotent).
2. Non-overlay `custom()` height budget (no documented limit) — probe at runtime; terminal fallbacks (h2.30) handle small sizes.
3. Whether main editor text persists across `custom()` sessions (PRD: "verify in test") — `getEditorText()/setEditorText()` available as belt-and-braces.
4. Multiple widget ordering — only one widget key used ("interrogator").

# Reference Patterns from pi 0.85.1 Example Extensions

Source: `/home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/` (EX = that dir)
Type decls: `dist/core/extensions/types.d.ts` (TD)

## 1. Component hosting: `ctx.ui.custom<T>()`

`questionnaire.ts:131-137` — the canonical embedded-UI pattern. `custom()` **takes keyboard focus** and replaces the active input region while active (main editor coexists; it returns when `done()` is called):

```ts
const result = await ctx.ui.custom<QuestionnaireResult>((tui, theme, _kb, done) => {
    let currentTab = 0;               // closure-held state
    ...
    function refresh() { cachedLines = undefined; tui.requestRender(); }
    function submit(cancelled: boolean) {
        done({ questions, answers: Array.from(answers.values()), cancelled });
    }
    ...
    return {
        render,                        // (width: number) => string[]
        invalidate: () => { cachedLines = undefined; },
        handleInput,                   // (data: string) => void
    };
});
```

Key facts:
- Factory signature: `(tui, theme, keybindings, done) => Component` where Component = `{ render(width): string[]; invalidate(): void; handleInput(data): void }` (TD types.d.ts:117).
- `done(result)` resolves the promise and restores the editor — single exit point.
- Returns may be `null`-able (`question.ts` uses `custom<...| null>` and `done(null)` for cancel).
- **An `Editor` from `@earendil-works/pi-tui` can be constructed inside the factory** and embedded in `render()` output — `questionnaire.ts:146-158`:

```ts
const editorTheme: EditorTheme = {
    borderColor: (s) => theme.fg("accent", s),
    selectList: { selectedPrefix: (t) => theme.fg("accent", t), ... },
};
const editor = new Editor(tui, editorTheme);
editor.onSubmit = (value) => { ... };
```

- Input routing to embedded editor (`questionnaire.ts:216-227`): when in input mode, check `matchesKey(data, Key.escape)` first, else `editor.handleInput(data); refresh();`.
- Editor is rendered by calling `editor.render(Math.max(1, renderWidth - 2))` and prefixing each line (`questionnaire.ts:301-303`). Width budgeting: inset by 2 for the panel padding. No fixed height — editor renders however many lines its content needs.
- Caching: `cachedLines` invalidated in `invalidate()` and on every state change; `tui.requestRender()` to schedule.
- Non-TUI guard: `if (ctx.mode !== "tui") return errorResult(...)` (`questionnaire.ts:117-119`).
- `await ctx.ui.custom(...)` runs **inside a tool's `execute`** — the tool blocks until the user finishes, then returns answers as `content` (the string sent to the LLM) + `details` (state).

How interrogator should use this: one `interrogate` tool whose execute awaits `ctx.ui.custom<Answers>()`, factory returns a class instance (todo.ts `TodoListComponent` shows the class alternative: constructor takes `(todos, theme, onClose)`), `onClose = () => done()`. Embed pi-tui `Editor` for free-text answers with `editor.onSubmit`.

## 2. Tool + details state (branch-safe persistence)

`todo.ts:110-127` — reconstruct in-memory state by scanning session entries:

```ts
const reconstructState = (ctx: ExtensionContext) => {
    todos = []; nextId = 1;
    for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type !== "message") continue;
        const msg = entry.message;
        if (msg.role !== "toolResult" || msg.toolName !== "todo") continue;
        const details = msg.details as TodoDetails | undefined;
        if (details) { todos = details.todos; nextId = details.nextId; }
    }
};
pi.on("session_start", async (_e, ctx) => reconstructState(ctx));
pi.on("session_tree", async (_e, ctx) => reconstructState(ctx));
```

Every `execute` return includes full snapshot: `{ content: [{type:"text", text}], details: { action, todos, nextId } }` (`todo.ts:139-148`).

Render hooks: `renderCall(args, theme, _context)` and `renderResult(result, { expanded }, theme, _context)` returning `new Text(text, 0, 0)` (`todo.ts:216-222, 224-234`); `expanded` flag controls collapsed (first 5 + "... N more") vs full list.

How interrogator should use this: store Q/A set + progress in every tool result `details`; on `session_start`/`session_tree` rebuild by scanning `getBranch()` for `toolResult` entries with `toolName === "interrogate"`.

## 3. Renderers

Entry renderer (durable, NOT sent to LLM) — `entry-renderer.ts:18-31`:

```ts
pi.registerEntryRenderer<StatusCardData>("status-card", (entry, { expanded }, theme) => {
    const data = entry.data ?? { message: "No data", timestamp: Date.now() };
    const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
    box.addChild(new Text(`${theme.fg("accent", "[status]")} ${data.message}`, 0, 0));
    if (expanded) { box.addChild(new Text(theme.fg("dim", new Date(data.timestamp).toLocaleString()), 0, 0)); }
    return box;
});
// append: pi.appendEntry<StatusCardData>("status-card", { message, timestamp });  (line 41-43)
```

Message renderer (custom messages, rendered not sent unless display/trigger) — `message-renderer.ts:15-35`:

```ts
pi.registerMessageRenderer("status-update", (message, { expanded, outputPad }, theme) => {
    const details = message.details as { level: string; timestamp: number } | undefined;
    ...
    const box = new Box(outputPad, 1, (t) => theme.bg("customMessageBg", t));
    box.addChild(new Text(text, 0, 0));
    return box;
};
// send: pi.sendMessage({ customType: "status-update", content, display: true, details: {...} });
```

Matching is by exact `customType` string. Theme helpers available: `theme.fg(name, s)`, `theme.bg(name, s)`, `theme.bold`, `theme.strikethrough`; TUI comps: `Text`, `Box`, `BorderedLoader`; utilities `wrapTextWithAnsi`, `visibleWidth`, `truncateToWidth`.

## 4. sendMessage semantics (IMPORTANT)

From `send-user-message.ts` header + `plan-mode/index.ts` usage:
- `pi.sendMessage({customType, content, display, details})` sends a **custom message** (extension-role, not a literal user message). **It does NOT trigger an agent reply by default** — use `{ triggerTurn: true }` to make the agent respond (`plan-mode/index.ts:281` uses `triggerTurn: true, deliverAs: "followUp"`; and `triggerTurn: false` for display-only "Plan Complete!").
- `pi.sendUserMessage(content)` sends a **real user-role message and always triggers a turn** when idle; throws while streaming unless `deliverAs: "steer"` (interrupt) or `"followUp"` (queue) is given (`send-user-message.ts:24-33, 47-57`).
- `before_agent_start` can inject hidden context: return `{ message: { customType, content, display: false } }` (`plan-mode/index.ts:174-196`).
- `pi.on("context", ...)` can filter messages out of LLM context by `customType` (`plan-mode/index.ts:160-172`).
- qna.ts pattern (return input to model via editor): loads LLM-extracted text into the *main editor* with `ctx.ui.setEditorText(result)` and the user submits normally (`qna.ts:105-108`) — answers go to the model as a normal user message.

## 5. Events

Full list in TD types.d.ts:813 & 909-930. Events beyond the four known to the task: `session_info_changed`, `session_before_switch`, `session_before_fork`, `session_compact`, `session_compact_failed`, `session_before_tree`, `session_tree`, `project_trust`, plus `agent_start`, `agent_end`, `agent_settled`, `turn_start`, `turn_end`, `message_start/update/end`, `tool_execution_start/update/end`, `tool_call`, `tool_result`, `before_agent_start`, `context`, `before_provider_request/headers`, `after_provider_response`, `model_select`, `thinking_level_select`, `user_bash`, `input`, `ui_prompt_start/end`.

`tool_call` can veto: `pi.on("tool_call", async (event) => ({ block: true, reason: "..." }))` (plan-mode/index.ts:146-155).
`turn_end` receives the completed message: `event.message` (plan-mode/index.ts:209-217).
Cross-extension bus: `pi.events.emit("my:notification", data)` / `pi.events.on("my:notification", cb)` (event-bus.ts:22-34).

## 6. Widget & status

`widget-placement.ts` (whole file, 9 lines):

```ts
ctx.ui.setWidget("widget-above", ["Above editor widget"]);
ctx.ui.setWidget("widget-below", ["Below editor widget"], { placement: "belowEditor" });
```

Default placement is above editor; `undefined` content removes it. Widget is plain `string[]` (or a Component factory, TD types.d.ts:97-99).
Footer status segments: `ctx.ui.setStatus("plan-mode", themedText | undefined)` (plan-mode/index.ts:49-55); these appear in the built-in footer via `footerData.getExtensionStatuses()`.

## 7. Custom footer (global, conflicts)

`custom-footer.ts:28-52`: `ctx.ui.setFooter((tui, theme, footerData) => { const unsub = footerData.onBranchChange(...); return { dispose: unsub, invalidate() {}, render(width) { ... return [oneLine]; } }; })` — footerData gives `getGitBranch()`, `getExtensionStatuses()`. **`setFooter` replaces the global footer** (border-status-editor.ts calls `ctx.ui.setFooter(() => new EmptyFooter())` and `ctx.ui.setWorkingVisible(false)`). Risk: if another extension sets a footer, last-set wins. Interrogator's "1-line footer with counts + key hints inside its own panel" is safer as `ctx.ui.setStatus("interrogate", line)` (composes into the stock footer) or a `setWidget` line — full `setFooter` should only be used if owning the whole footer is acceptable.

## 8. Editor composition (main editor replacement)

`ctx.ui.setEditorComponent((tui, theme, keybindings) => new MyEditor(tui, theme, keybindings))` — replaces the **main chat editor** via subclassing `CustomEditor` (exported by pi-coding-agent):

- `modal-editor.ts:57-59`: `class ModalEditor extends CustomEditor` overriding `handleInput` (call `super.handleInput(seq)` for app-level keys like abort) and `render(width)` (call `super.render(width)`, mutate last line for a mode badge).
- `border-status-editor.ts:99-125`: `super(tui, theme, keybindings, { paddingX: 0 })`; stores `activeTui = tui` for spinner re-renders driven by `agent_start`/`agent_settled` events with `setInterval(() => activeTui?.requestRender(), 80)`.
- `rainbow-editor.ts`: `this.getText()`, `this.tui.requestRender()` available on CustomEditor.

No `$EDITOR` external-editor integration found in these examples (that stays built-in to the default editor).

How interrogator should use this: NOT needed if questions live in `ctx.ui.custom()` panels; only relevant if you want the main editor to show answer prompts. (qna.ts instead uses `ctx.ui.setEditorText`.)

## 9. Custom compaction

`custom-compaction.ts:23-45` — exact shape:

```ts
pi.on("session_before_compact", async (event, ctx) => {
    const { preparation, branchEntries: _, signal } = event;
    const { messagesToSummarize, turnPrefixMessages, tokensBefore, firstKeptEntryId, previousSummary } = preparation;
    ... // ctx.modelRegistry.complete(model, { messages }, { signal, ... })
    return { compaction: { summary, firstKeptEntryId, tokensBefore, usage: response.usage } };
});  // returning undefined falls back to default compaction
```

Uses `serializeConversation(convertToLlm(allMessages))` to build summary input. (plan-mode does NOT use session_before_compact; it injects per-turn context via `before_agent_start` with `display:false` messages + `context` event filtering.)

## 10. Commands, shortcuts, flags, misc

- `pi.registerCommand("name", { description, handler: async (args, ctx) => {...} })` — args is a string; `ctx.mode`, `ctx.isIdle()`, `ctx.model`, `ctx.sessionManager`, `ctx.ui.notify(msg, "info"|"warning"|"error")`.
- `pi.registerShortcut(Key.ctrlAlt("p"), { description, handler })` (plan-mode/index.ts:124-127).
- `pi.registerFlag("plan", { type: "boolean", default: false })`; `pi.getFlag("plan")`.
- `pi.setActiveTools(names)` / `pi.getActiveTools()` for tool gating.
- Hidden context messages survive in session; filter via `pi.on("context")`.
- State persistence via `pi.appendEntry("plan-mode", {...})` + restore on `session_start` by scanning `getEntries()` for `type === "custom"` & `customType` match (plan-mode/index.ts:102-106, 236-243).
- `ctx.ui.select(title, options[])`, `ctx.ui.editor(prompt, initial)` prompts (plan-mode/index.ts:265, 281).
- BorderedLoader for async work inside custom(): `new BorderedLoader(tui, theme, msg)` with `loader.onAbort = () => done(null)` and `loader.signal` (qna.ts:70-77).

# Nested-LLM + snapshot seams (sidechat.ts engine)

**Correction: the package is `@earendil-works/pi-coding-agent`** (no `pi-agent` exists). Verified
exports below from `node_modules/@earendil-works/pi-coding-agent/dist/` and `.../pi-ai/dist/`.

## Nested-call precedents (in-repo + upstream example)

- `src/compaction.ts:123–126` `resolveModel(ctx) = ctx.model ?? ctx.modelRegistry.getAvailable()[0]`; caller checks `!model` (:167).
- `src/compaction.ts:172–175` `await ctx.modelRegistry.complete(model, { messages }, { maxTokens: 8192, signal: event.signal, cacheRetention: "none", sessionId: uuidv7() })` — NOTE: `cacheRetention:"none"` + fresh sessionId is the compaction ONE-SHOT pattern. The side chat is MULTI-TURN and wants its OWN small prefix cache (SIDECHAT-003: first turn pays full input, later turns hit it) → do NOT copy `cacheRetention:"none"`; keep a stable own sessionId and default retention.
- Result handling: filter `response.content` for `{type:"text"}` and join (:178–182); usage off `response.usage` (:187–191); try/catch → `console.error` + bail (:193–197). qna.ts instead uses `ctx.ui.notify(msg,"error")` — the side chat surfaces errors as IN-VIEW notices (spec), so notify/qna style.
- Upstream example EXISTS: `node_modules/@earendil-works/pi-coding-agent/examples/extensions/qna.ts` — guards (`ctx.mode !== "tui"`, `!ctx.model` → notify), `ctx.sessionManager.getBranch()` walk, `complete(ctx.model!, { systemPrompt, messages:[userMessage] }, { signal })`, `stopReason === "aborted"` handling, `loader.onAbort`. (It ends in `setEditorText` — that part is NOT for us.)

## Exact API signatures (from .d.ts)

- `ModelRegistry` (core/model-registry.d.ts): `getAvailable(): Model<Api>[]`; `complete<TApi>(model: Model<TApi>, context: Context, options?: ModelsApiStreamOptions<TApi>): Promise<AssistantMessage>`; `find(provider, modelId)`; `hasConfiguredAuth(model)`; `getProviderAuthStatus(provider)`. **No `streamSimple` on the registry.**
- Streaming: `import { streamSimple } from "@earendil-works/pi-ai"` (compat.d.ts:65): `streamSimple<TApi>(model, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream`. Events: `start | text_start | text_delta | text_end | thinking_* | toolcall_* | done {reason, message} | error {reason, error}`; `partial: AssistantMessage` rides every event; abort via `options.signal` → terminates with `error {reason:"aborted"}`; auth missing → synchronous throw.
- `Context` (pi-ai types.d.ts:389): `{ systemPrompt?: string; messages: Message[]; tools?: Tool[] }` — side chat passes its own `systemPrompt` + snapshot+turns as `messages`, never `tools`.
- `AssistantMessage`: `content: (TextContent|ThinkingContent|ToolCall)[]; usage: Usage; stopReason: StopReason; errorMessage?; model; provider; api; timestamp`. `StopReason = "pending"|"stop"|"length"|"toolUse"|"error"|"aborted"|"deferred"`.
- `Usage` (types.d.ts:265–283): `input, output, cacheRead, cacheWrite, …, cost: { input, output, cacheRead, cacheWrite, total }`. Cost = `usage.cost.total`. The close-notify string maps `usage.input`→"in", `usage.output`→"out", `usage.cost.total`→"$…".
- `StreamOptions` includes `signal?: AbortSignal`, `maxTokens?`, `cacheRetention?`, `sessionId?`.
- `Model<TApi>`: `id, name, api, provider, …, contextWindow, maxTokens`; `ctx.model: Model<any> | undefined`.

## Branch-snapshot pipeline (SIDECHAT-003, once at chat creation)

1. `ctx.sessionManager.getBranch(fromId?): SessionEntry[]` (core/session-manager.d.ts:262) — path order, ALL entry types; filter to message-bearing entries (qna.ts walks `entry.type === "message"`).
2. `import { sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent"` (re-exported, dist/index.d.ts:19): `(entry: SessionEntry) => AgentMessage[]`.
3. `AgentMessage[]` ≠ `Message[]`: `Context.messages` takes `Message[]` (UserMessage | AssistantMessage | ToolResultMessage). Narrow/filter custom agent messages, or convert via `convertToLlm` (also exported by pi-coding-agent; precedent `src/compaction.ts:44`).
4. Result is the frozen snapshot stored on the singleton; appended AFTER it come the chat turns; the whole array is rebuilt per turn (system prompt + snapshot + turns). NEVER re-read `getBranch()` mid-chat (staleness accepted v1).

## Banned-API reality check (for the R5 guard)

Real names on `ExtensionAPI` (core/extensions/types.d.ts:971–1006): `sendMessage(message, options?)`, `sendUserMessage(content, options?)`, `setActiveTools(toolNames)`, `setModel(model)`, `registerTool(...)`. `sendMessage`/`sendUserMessage` also exist on `ReplacedSessionContext` (:298–306) — the identifier-level guard catches both usages. Guard list (spec, binding): `sendMessage | sendUserMessage | setActiveTools | registerTool | setModel`.

## Engine design notes

- Model resolution at OPEN (stored as `modelSnapshot` on the singleton): `config.sideChatModel` → `ctx.modelRegistry.find(provider, modelId)` (+ `hasConfiguredAuth` if useful); invalid/not-found → `ctx.ui.notify(...)` + `ctx.model ?? modelRegistry.getAvailable()[0]`; no model at all → singleton opens INERT (spec edge state).
- Loop: `sendTurn(text)` → append user message → `streamSimple(modelSnapshot, {systemPrompt, messages: snapshot+turns}, { signal: abortController.signal, sessionId: <own stable id> })` → consume deltas into a streaming buffer (view polls/renders) → on `done`: freeze assistant message (text join), parse ` ```answer ` (completed replies only), accumulate usage. On `error {reason:"aborted"}`: discard partial text (the turn never happened). Auth throw → in-view notice, chat stays usable.
- Unit-testability: inject the model-call seam (a `(model, context, options) => AssistantMessageEventStream | Promise<AssistantMessage>` port) so tests never hit a provider; ctx usage behind the same port bag.

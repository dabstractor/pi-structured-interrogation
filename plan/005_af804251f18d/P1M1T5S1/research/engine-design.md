# T5.S1 research — model resolution + turn dispatch over an injected port

## Verified API facts (architecture doc + .d.ts, plan/005_af804251f18d/architecture/nested-llm-and-snapshot-seams.md)
- `ModelRegistry`: `complete(model, context, options?)`, `find(provider, modelId)`, `hasConfiguredAuth(model)`, `getAvailable(): Model[]`. **No streamSimple on the registry** — `streamSimple` is a standalone `@earendil-works/pi-ai` export.
- `streamSimple(model, context, options?): AssistantMessageEventStream`; events `start|text_delta|...|done{reason,message}|error{reason,error}`; `partial: AssistantMessage` rides events; abort via `options.signal` → `error {reason:"aborted"}`; **auth missing → synchronous throw**.
- `Context = { systemPrompt?: string; messages: Message[]; tools?: Tool[] }` — side chat passes own systemPrompt + snapshot+turns, never tools.
- `StreamOptions`: `signal?, maxTokens?, cacheRetention?, sessionId?`.
- Precedent compaction.ts:121-126 `resolveModel(ctx) = ctx.model ?? ctx.modelRegistry.getAvailable()[0]`. **Do NOT copy compaction's `cacheRetention:"none"` + fresh sessionId** — side chat is multi-turn, wants its own stable sessionId + default retention (SIDECHAT-003/005).
- Upstream example: node_modules/@earendil-works/pi-coding-agent/examples/extensions/qna.ts (guards, complete(), stopReason === "aborted").
- Banned API list (SIDECHAT-005 guard, M3.T1.S1): `sendMessage | sendUserMessage | setActiveTools | registerTool | setModel` — streamSimple/modelRegistry/complete are NOT banned.

## Landed inputs (codebase, HEAD)
- **src/panel/sidechat.ts** (T3.S1, 211 lines): module singleton `get()/openOrReplace(questionId, deps)/discard()/resetChat()/classifyChatCommand()`; `SidechatRecord {questionId, messages: ChatMessage[], streamState: "idle"|"streaming", abortController, modelSnapshot: {provider, modelId}, systemPrompt, branchSnapshot: readonly unknown[] (opaque — zero pi imports in sidechat.ts is LOAD-BEARING for M3.T1), usage: {input, output, totalCost}}`; `SidechatRebindDeps {resolveModelSnapshot, buildSystemPrompt, buildBranchSnapshot}` invoked EXACTLY once per creation; `ChatMessage {role:"user"|"assistant", text, at: string(ISO)}`; header says "T5.S1 model resolution (the deps bag is their injection seam)", ChatStreamState "open to extension by T5.S2 — never narrowed".
- **src/panel/branch-snapshot.ts** (T4.S1): `BranchSnapshotMessages = readonly Message[]`, `takeBranchSnapshot(...)` — the producer module holding the pi-ai `Message` type.
- **src/panel/sidechat-prompt.ts** (T4.S2, in flight): `buildSideChatSystemPrompt(question, goal, questionsWithAnswers)` — pure; landed via record.systemPrompt.
- **src/config.ts** (T2.S1): `sideChatModel?: string` :95 — format **"provider/model-id"** (:87 JSDoc); absent/blank/ill-typed → undefined → session model at open; deliberately NOT in DEFAULT_CONFIG. Coercion :253-255.
- **compaction.ts:172-175**: complete() call shape with signal/sessionId (the one-shot pattern — contrast only).

## Engine design decided for the PRP
- New module `src/panel/sidechat-engine.ts` (+ .test.ts) — sidechat.ts stays pi-import-free; the engine may import pi-ai TYPES type-only + streamSimple for the production port (not on ban list).
- Port: `(model, context, {signal, sessionId}) => AssistantMessageEventStream | Promise<AssistantMessage>` injected; registry narrowed to `{find, getAvailable}`; `notify: (msg) => void`. Engine NEVER imports ctx — R5 guard clean.
- `resolveSideChatModel(config, registry, sessionModel, notify): Model | undefined`: split sideChatModel on FIRST "/" → find(provider, modelId); invalid/unknown/unparseable → notify + fallback `sessionModel ?? getAvailable()[0]`; nothing resolvable → undefined (inert).
- `modelSnapshotFromModel(model | undefined): ModelSnapshot` — undefined → `{provider:"", modelId:""}` empty = inert marker for the record/view (P1.M2.T1.S2).
- `sendTurn(text)` on engine instance {port, notify}: guards (no record / already streaming → false), append user ChatMessage (ISO at), fresh AbortController → record.abortController, streamState "streaming", Context {systemPrompt: record.systemPrompt, messages: [...branchSnapshot(Message[] via branch-snapshot type), ...record.messages → pi-ai Message ({role, content:[{type:"text",text}], timestamp: Date.parse(at)})]}, port {signal, sessionId: engine-held STABLE per-record id (uuid or questionId+created — never regenerated per turn)}. Minimal consumption skeleton (S2 refines): done → freeze assistant ChatMessage (join text), idle; error/aborted → idle, no assistant message; sync throw (auth) → push engine notice record + idle. abort(): signals the live controller.
- Notices: extend `SidechatRecord` additively with `notices: SidechatNotice[]` (`{kind:"auth"|"error", text, at}`), initialized `[]` in buildFresh — survives suspend with the record (Mode A doc edit to sidechat.ts header is already contractually required).
- Boundary vs S2 (streaming consumption: deltas/stop reasons/abort-discard/auth-as-notices refinements) and vs M2.T4.S1 (open-path wiring — engine only provides the building blocks).

## Test conventions (sidechat.test.ts): fake deps bags, resetSidechatForTests() between tests, plain vitest describe/test, dense Mode A comments citing decision IDs.

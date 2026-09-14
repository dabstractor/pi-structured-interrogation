# Research — P1.M7.T2.S1 (session_before_compact handler)

## pi 0.85.x API facts (verified in node_modules/@earendil-works/pi-coding-agent)

- `SessionBeforeCompactEvent` (dist/core/extensions/types.d.ts:442):
  `{ type, preparation: CompactionPreparation, branchEntries: SessionEntry[], customInstructions?: string, reason: "manual"|"threshold"|"overflow", willRetry: boolean, signal: AbortSignal }`
- `SessionBeforeCompactResult` (types.d.ts:857): `{ cancel?: boolean; compaction?: CompactionResult }` — **NO customInstructions return field** (unlike SessionBeforeTreeResult which has customInstructions at types.d.ts:861-866). Confirms the PRD mismatch adaptation.
- `CompactionPreparation` (session-manager): `{ firstKeptEntryId, messagesToSummarize: AgentMessage[], turnPrefixMessages: AgentMessage[], isSplitTurn, tokensBefore, previousSummary?, fileOps, settings }`
- `CompactionResult` returned shape from handler: `{ summary, firstKeptEntryId, tokensBefore, usage, details? }` — SessionManager adds id/parentId.
- Note: the DEFAULT compaction path DOES accept customInstructions (session-manager `compact(preparation, model, apiKey, headers, customInstructions, ...)` — prompt becomes `${basePrompt}\n\nAdditional focus: ${customInstructions}`), but extensions have no way to pass it without running the summarization themselves. Hence the custom-compaction.ts pattern.

## Canonical example

`examples/extensions/custom-compaction.ts` (installed under node_modules/@earendil-works/pi-coding-agent/examples/extensions/):
- lines 23-45: `ctx.modelRegistry.find(provider, modelId)` → serialize `serializeConversation(convertToLlm([...messagesToSummarize, ...turnPrefixMessages]))` → build single user message → `await ctx.modelRegistry.complete(model, {messages}, { maxTokens: 8192, signal, cacheRetention: "none", sessionId: uuidv7() })` → join text blocks → return `{ compaction: { summary, firstKeptEntryId, tokensBefore, usage: response.usage } }`.
- On missing model / empty summary / error: `return;` (undefined) → default compaction runs. Signal-aborted → also just return.

## Codebase facts

- `src/persistence.ts` exports `INTERROGATION_STATE_ENTRY_TYPE = "interrogation-state"` and `createStateMirror(pi)` returning `{flush(), dispose()}`. index.ts holds `mirror` in the factory closure with `pi.on("session_shutdown", () => mirror.flush())` — the compaction handler can call `mirror.flush()` pre-compaction (item contract: mirror flushed fresh so post-compaction read() reconstructs).
- `src/state.ts`: `getState()`, `InterrogationState.orderedQuestions()`, `serialize()`.
- Config (src/config.ts): `InterrogatorConfig.toggles = { gateWarnings, roundDetection, digitQuickSelect }` — add `compactionPreservation: true` following `coerceBoolean` pattern at line ~245, default at line ~142, and the toggles doc table (~line 318).
- index.ts factory: async, `config` loaded first; add `createCompactionGuard(pi, { config, mirror })` after mirror creation (~line 82) or after panelHost block.
- No active interrogation check: `getState()` undefined OR `orderedQuestions().length === 0` → return undefined (default compaction, no cost).

## Model choice for summarizer

Item contract says `ctx.modelRegistry` — use the session's CURRENT model (`ctx.modelRegistry` on the event ctx; custom-compaction example finds a specific cheaper model). Safest one-pass choice: use `ctx.model` (the active conversation model) if exposed on ExtensionContext, else find via registry. Verify at implementation: `ExtensionContext` in types.d.ts exposes `modelRegistry` and `mode`; for the model, mirror custom-compaction's `ctx.modelRegistry.find(...)` — but provider/id vary by user install, so prefer the active session model if reachable (check ctx fields; fallback: skip custom compaction if no model resolvable → default compaction).

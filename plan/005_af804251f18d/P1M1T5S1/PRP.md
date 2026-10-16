---
name: "P1.M1.T5.S1 — Model resolution and turn dispatch over an injected nested-call seam"
description: "New module src/panel/sidechat-engine.ts: resolveSideChatModel (sideChatModel override → find → notify+fallback → inert marker) + sendTurn/abort state machine (idle→streaming→idle) over an INJECTED model-call port (streamSimple-shaped), fresh AbortController per turn, stable own sessionId (never compaction's cacheRetention:\"none\"). Engine never imports ctx. Minimal additive edit to src/panel/sidechat.ts (notices field + Mode A header: SIDECHAT-005 nested-calls-only + model-resolution contract). Unit tests with fake port/registry — no provider, no ctx."
---

## Goal

**Feature Goal**: Implement the side-chat engine's model resolution and turn-dispatch halves (SIDECHAT-003/005): resolve WHICH nested model a chat runs on (`config.sideChatModel` "provider/model-id" override → `registry.find`, invalid → notify + session model, nothing resolvable → inert marker), and dispatch a turn over an **injected nested-call port** — append user message → assemble `Context {systemPrompt, messages: [...frozenSnapshot, ...turns]}` → invoke the port with a fresh AbortController stored on the singleton record and a **stable per-chat sessionId** (own small prefix cache, default retention — explicitly NOT compaction's one-shot `cacheRetention:"none"` pattern). The engine receives port/registry/notify as injection arguments — it never imports `ctx` (unit-testable; the M3.T1 cache-isolation guard stays clean).

**Deliverable**:
1. New file `src/panel/sidechat-engine.ts` — `SidechatModelPort` type, `SidechatEngineDeps` injection bag, `resolveSideChatModel(config, registry, sessionModel, notify): Model | undefined`, `modelSnapshotFromModel(model?): ModelSnapshot`, `createSidechatEngine(deps)` returning `{sendTurn(text): boolean, abort(): void}` driving the record's `streamState` idle→streaming→idle, plus the production port binding (`streamSimple` wrapper, exported but unwired).
2. New file `src/panel/sidechat-engine.test.ts` — resolution matrix (override / invalid→notify+fallback / no-model inert), context-assembly order, abortController stored/replaced per turn, sessionId stability, guards, auth-throw → notice record.
3. Minimal additive edit to `src/panel/sidechat.ts` — `SidechatNotice` + `notices: SidechatNotice[]` on the record (initialized `[]` in `buildFresh`) and the Mode A header block (nested-calls-only SIDECHAT-005 + model-resolution contract).

**Success Definition**: All new tests green; `npx vitest run src/panel/` green; `npm run typecheck` clean; banned-API grep clean on the side-chat module set; sidechat.ts remains free of `@earendil` imports (the engine holds the pi types); no wiring into the panel (M2.T4.S1 owns the open path), no streaming-delta/stop-reason semantics (T5.S2), no usage tally (T5.S3), no answer-block parsing (T6.S1).

## User Persona (if applicable)

**Target User**: The pi user asking a side-channel question about one interrogation question (SIDECHAT-001), possibly on a cheaper/faster model via `sideChatModel`.

**Use Case**: User presses `e` (chat) → chat opens resolved to the configured model (or notified + session model) → types a question → `enter` dispatches a nested model call that streams the answer WITHOUT touching the main conversation's cache or session state.

**User Journey**: Open chat → `sendTurn("why is sqlite recommended here?")` → turn dispatched on the injected port, controller live, state streaming → reply completes → assistant message frozen, state idle → next turn reuses the same sessionId (cache hit on the replayed branch prefix).

**Pain Points Addressed**: Discuss-in-chat's suspend/editor-preload round-trip (SIDECHAT-001); hardcoded provider models (compaction precedent generalizes); silent model-override typos (notify + fallback, never a crash); panel blocking on errors (notices, never blocks).

## Why

- SIDECHAT-003 (h2.80): model = session model at open, `sideChatModel` override (invalid → notify + session model); context = one-shot frozen snapshot under its own system prompt. SIDECHAT-005 (h2.16, binding): the chat talks to the model ONLY via nested `ctx.modelRegistry`-style calls — never `sendMessage`/`sendUserMessage`/`setActiveTools`/`registerTool`/`setModel` — so main-session cache preservation is structural.
- Dependency chain (tasks.json): consumes `config.sideChatModel` (T2.S1, landed config.ts:95, format "provider/model-id" :87), the singleton store (T3.S1, landed src/panel/sidechat.ts), the branch snapshot (T4.S1, landed src/panel/branch-snapshot.ts: `BranchSnapshotMessages = readonly Message[]`), the system prompt builder (T4.S2, in flight → `record.systemPrompt`). Feeds T5.S2 (streaming consumption refines the skeleton), T5.S3 (usage), P1.M2.T3.S1 (view key routing calls sendTurn/abort), P1.M2.T5.S1 (mid-stream abort hooks).
- Precedents: compaction.ts:121-126 `ctx.model ?? ctx.modelRegistry.getAvailable()[0]` resolution; compaction.ts:172-175 complete() call shape (one-shot pattern — contrast only); upstream qna.ts extension (guards + complete + aborted stopReason).

## What

1. **`resolveSideChatModel(config, registry, sessionModel, notify)`** — `registry` is a narrow port `{find(provider, modelId): Model | undefined; getAvailable(): Model[]}` (never the live ctx registry). Parse `config.sideChatModel` by splitting on the FIRST `"/"`: set + `find` hits → that Model; unset/blank/unparseable/unknown → `notify(...)` (production binding: `ctx.ui.notify(msg, "error")` style) + fallback `sessionModel ?? registry.getAvailable()[0]`; nothing resolvable → `undefined` (INERT — the view opens inert per P1.M2.T1.S2 via `modelSnapshotFromModel(undefined)` → `{provider:"", modelId:""}`).
2. **`createSidechatEngine({port, notify})`** — the port: `(model, context, options: {signal: AbortSignal; sessionId: string}) => AssistantMessageEventStream | Promise<AssistantMessage>`. `sendTurn(text)`: false if no live record (`sidechat.get()` undefined) or `streamState !== "idle"`; else append `ChatMessage {role:"user", text, at: new Date().toISOString()}`; `record.abortController = new AbortController()` (replaced EVERY turn); `record.streamState = "streaming"`; assemble `Context {systemPrompt: record.systemPrompt, messages: [...(record.branchSnapshot as Message[]), ...record.messages.map(toPiMessage)]}` where `toPiMessage(m) = {role: m.role, content: [{type: "text", text: m.text}], timestamp: Date.parse(m.at)}`; invoke `port(modelFor(record), context, {signal: record.abortController.signal, sessionId: engineSessionId(record)})` — the engine re-derives the Model from `record.modelSnapshot` via its registry (`find(provider, modelId)`; empty snapshot → inert: no dispatch, notice, back to idle) and holds a **stable sessionId per record identity** (regenerate only when the singleton record object changes — NEVER per turn). `abort()`: signals the live `record.abortController`.
3. **Minimal stream consumption skeleton** (T5.S2 refines; S1 owns lifecycle): consume the returned stream/promise — on settle: `done` → append assistant `ChatMessage` (joined text; the skeleton joins event `partial.content` text parts or the promise's `AssistantMessage` text), `streamState = "idle"`; `error {reason}` → `streamState = "idle"`, NO assistant message; **synchronous throw from the port** (auth missing throws per pi-ai) → append a notice record (`{kind:"auth", text, at}`) to `record.notices`, `streamState = "idle"` — the panel never blocks.
4. **`src/panel/sidechat.ts` additive edit**: `export interface SidechatNotice {kind: "auth" | "error"; text: string; at: string}`; `notices: SidechatNotice[]` on `SidechatRecord`; `notices: []` in `buildFresh`; Mode A header block: nested-calls-only (SIDECHAT-005 ban list) + the model-resolution contract (override → find → notify+fallback → inert). Touch NOTHING else (T3.S1/T3.S2 contracts frozen).
5. **Production port binding** (exported, unwired): `export const streamSimplePort: SidechatModelPort = (model, context, options) => streamSimple(model, context, options)` — `import { streamSimple } from "@earendil-works/pi-ai"` lives HERE (engine module), never in sidechat.ts. NO `cacheRetention:"none"`; default retention + the stable own sessionId.

### Success Criteria

- [ ] Resolution: set+valid → find result; set+invalid (bad split / unknown id) → notify called once + `sessionModel ?? getAvailable()[0]`; unset → session model; sessionModel undefined + empty registry → `undefined` (inert)
- [ ] Context assembly: port receives exactly `[...branchSnapshot, ...turns-as-Messages]` in order, with `systemPrompt === record.systemPrompt`, no `tools`
- [ ] AbortController: fresh controller stored per `sendTurn` call (two turns → two distinct controllers); `abort()` signals the live one
- [ ] sessionId: identical across consecutive turns on the same record; changes when the record is replaced
- [ ] Guards: `sendTurn` returns false on no-record and on already-streaming; empty-snapshot (inert) record → no port call, notice, idle
- [ ] Sync port throw → notice record appended, state idle, no assistant message
- [ ] `grep -nE "sendMessage|sendUserMessage|setActiveTools|registerTool|setModel" src/panel/sidechat-engine.ts src/panel/sidechat.ts` → CLEAN; `grep -n "@earendil" src/panel/sidechat.ts` → CLEAN
- [ ] `npx vitest run src/panel/` green; `npm run typecheck` clean

## All Needed Context

### Context Completeness Check

This PRP carries the verified pi-ai API surface (exact signatures from the .d.ts audit), the landed record/store shapes (sidechat.ts read in full), the config format ("provider/model-id"), the cache-isolation rules (what to copy and what NOT to copy from compaction), the injection seams, and the T5.S2/M2.T4.S1 boundary walls. An implementer needs only the named files + this document.

### Documentation & References

```yaml
- file: plan/005_af804251f18d/architecture/nested-llm-and-snapshot-seams.md
  why: "THE binding research doc: exact ModelRegistry/streamSimple/Context/AssistantMessage signatures, compaction vs qna precedents, banned-API list, engine design notes, snapshot pipeline"
  critical: "streamSimple is NOT on ModelRegistry (standalone pi-ai export); auth missing = synchronous throw; do NOT copy cacheRetention:'none'"

- file: src/panel/sidechat.ts
  why: "the store this engine drives: SidechatRecord/SidechatRebindDeps/ChatMessage shapes, singleton get()/openOrReplace semantics, buildFresh — and the file this task additively extends (notices + header)"
  gotcha: "zero @earendil imports in sidechat.ts is LOAD-BEARING (M3.T1 guard) — the engine module holds all pi types; branchSnapshot stays opaque `readonly unknown[]` there"

- file: src/panel/branch-snapshot.ts
  why: "T4.S1 landed producer: BranchSnapshotMessages = readonly Message[] + takeBranchSnapshot — the engine CASTS record.branchSnapshot through this module's type, never re-reads getBranch() mid-chat (SIDECHAT-003 freeze)"

- file: src/config.ts
  why: "sideChatModel?: string (:95), format 'provider/model-id' (:87 JSDoc), coercion (:253-255); absent → undefined → session model at open"
  gotcha: "NOT in DEFAULT_CONFIG by design — absent-vs-set detection matters; read it via the resolved InterrogatorConfig"

- file: src/compaction.ts
  why: "resolution precedent (:121-126 ctx.model ?? getAvailable()[0]) and complete() call shape (:172-175) — pattern source ONLY"
  gotcha: "compaction is the ONE-SHOT pattern (cacheRetention:'none', fresh sessionId) — the side chat is MULTI-TURN: stable own sessionId + default retention"

- file: plan/005_af804251f18d/P1M1T5S1/research/engine-design.md
  why: "this task's verified research digest: API facts, landed-input inventory, the decided engine design, test conventions"

- file: src/panel/sidechat.test.ts
  why: "test conventions: fake deps bags, resetSidechatForTests(), dense decision-ID comments"

- url: node_modules/@earendil-works/pi-coding-agent/examples/extensions/qna.ts
  why: "upstream nested-call example: mode/model guards, complete(), stopReason==='aborted' handling, notify-on-error style"
  gotcha: "its setEditorText tail is NOT for us (discuss-in-chat is being deleted)"
```

### Current Codebase tree (relevant slice)

```bash
src/panel/
├── sidechat.ts            # T3.S1 store (211 lines) — EXTEND: notices field + Mode A header
├── sidechat.test.ts       # store tests — extend only if buildFresh change needs rows
├── branch-snapshot.ts     # T4.S1 — BranchSnapshotMessages (readonly Message[])
├── sidechat-prompt.ts     # T4.S2 (in flight) — buildSideChatSystemPrompt → record.systemPrompt
└── (panel suites: 16 files green at this plan's HEAD)
src/config.ts              # sideChatModel/sideChatAutoApply landed (T2.S1)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/panel/sidechat-engine.ts       # NEW: port type, injection bag, resolveSideChatModel,
                                   #      modelSnapshotFromModel, createSidechatEngine
                                   #      (sendTurn/abort, state machine, notice records),
                                   #      streamSimplePort production binding (unwired)
src/panel/sidechat-engine.test.ts  # NEW: resolution matrix, assembly order, controller
                                   #      lifecycle, sessionId stability, guards, auth-throw
src/panel/sidechat.ts              # EDIT (additive): SidechatNotice, record.notices,
                                   #      buildFresh notices: [], Mode A header block
```

### Known Gotchas of our codebase & Library Quirks

```text
# CRITICAL: the engine NEVER imports ctx or the live modelRegistry — port +
#   registry-narrow-port + notify are injection arguments (unit tests pass
#   fakes; the R5/M3.T1 guard greps the side-chat module set for
#   sendMessage|sendUserMessage|setActiveTools|registerTool|setModel — the
#   engine must contain none, even in comments, per the no-hardcoded-keys
#   scanner discipline of stripping comments... comments are stripped there,
#   but keep code clean regardless).

# CRITICAL: sessionId is STABLE per record (own prefix cache across turns,
# SIDECHAT-003) — the compaction pattern (fresh uuidv7 per call +
# cacheRetention:"none") is the ANTI-pattern here. Never set cacheRetention.

# CRITICAL: `Model` and `Message` are type-only imports (import type from
#   "@earendil-works/pi-ai") — only streamSimplePort imports a VALUE; sidechat.ts
#   itself must gain ZERO @earendil references.

# GOTCHA: streamSimple throws SYNCHRONOUSLY on missing auth — wrap the port
#   invocation in try/catch; the catch path appends the notice and settles idle.

# GOTCHA: record.branchSnapshot is `readonly unknown[]` ON PURPOSE (opacity in
#   sidechat.ts); the engine casts via branch-snapshot.ts's BranchSnapshotMessages
#   type. NEVER call takeBranchSnapshot/getBranch from the engine — mid-chat
#   re-reads violate the SIDECHAT-003 freeze.

# GOTCHA: sendTurn while streamState==="streaming" returns false (no queueing,
#   no double-controller) — P1.M2.T3.S1's esc-abort rung handles the live case
#   via abort(); P1.M2.T5.S1 refines mid-stream discard.

# GOTCHA: buildFresh (sidechat.ts:139) initializes every record field — the new
#   notices: [] must land there or resetChat/openOrReplace produce records the
#   view reads as undefined (keep sidechat.test.ts rows green).
```

## Implementation Blueprint

### Data models and structure

```typescript
// src/panel/sidechat-engine.ts (type-only pi imports except streamSimplePort)
import type { AssistantMessage, Context, Message, Model } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai";
import type { InterrogatorConfig } from "../config.js";
import { get as getRecord, type SidechatNotice } from "./sidechat.js";
import type { BranchSnapshotMessages } from "./branch-snapshot.js";

export type SidechatModelPort = (
  model: Model,
  context: Context,
  options: { signal: AbortSignal; sessionId: string },
) => AssistantMessageEventStream | Promise<AssistantMessage>; // stream type: import type from pi-ai

export interface SidechatRegistryPort {
  find(provider: string, modelId: string): Model | undefined;
  getAvailable(): Model[];
}

export interface SidechatEngineDeps {
  port: SidechatModelPort;
  registry: SidechatRegistryPort;   // used at sendTurn to re-derive the Model from the frozen snapshot
  notify: (message: string) => void;
}

// resolveSideChatModel: config.sideChatModel "provider/model-id" → find;
// invalid/unknown → notify + (sessionModel ?? getAvailable()[0]); else undefined (inert)
export function resolveSideChatModel(
  config: Pick<InterrogatorConfig, "sideChatModel">,
  registry: SidechatRegistryPort,
  sessionModel: Model | undefined,
  notify: (message: string) => void,
): Model | undefined;

export function modelSnapshotFromModel(model: Model | undefined): ModelSnapshot; // undefined → {provider:"", modelId:""}
export const streamSimplePort: SidechatModelPort; // (m, c, o) => streamSimple(m, c, o)
export function createSidechatEngine(deps: SidechatEngineDeps): {
  sendTurn(text: string): boolean;
  abort(): void;
};
// sidechat.ts additive: SidechatNotice {kind:"auth"|"error"; text: string; at: string}; record.notices: SidechatNotice[]
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/panel/sidechat.ts (additive — smallest change first, keeps store tests honest)
  - ADD: export interface SidechatNotice { kind: "auth" | "error"; text: string; at: string }
  - ADD field: SidechatRecord.notices: SidechatNotice[]
  - EDIT buildFresh: notices: [] (the ONE-record-creation path — resetChat inherits it)
  - EDIT Mode A header: nested-calls-only block (SIDECHAT-005 ban list verbatim:
    never sendMessage/sendUserMessage/setActiveTools/registerTool/setModel; nested
    model calls only) + model-resolution contract (override → find → notify+fallback → inert)
  - KEEP: every existing export byte-compatible (T3.S1/T3.S2 contracts frozen)
  - RUN: npx vitest run src/panel/sidechat.test.ts  # green unchanged

Task 2: CREATE src/panel/sidechat-engine.ts — resolveSideChatModel + modelSnapshotFromModel
  - PARSE: split sideChatModel on FIRST "/" (slice after indexOf); 2 non-empty parts → find(provider, modelId)
  - FALLBACK: unset/blank/malformed/unknown → notify("side chat model '<raw>' not found — using <desc>") once
    + (sessionModel ?? registry.getAvailable()[0]); NOTHING resolvable → undefined
  - INERT MAP: modelSnapshotFromModel(undefined) → {provider:"", modelId:""} (the P1.M2.T1.S2 inert marker)
  - FOLLOW pattern: compaction.ts resolveModel fallback ORDER (session ?? first available)

Task 3: CREATE src/panel/sidechat-engine.ts — createSidechatEngine (sendTurn/abort)
  - STATE: engine-held {sessionId: string} keyed to record identity — regenerate when
    get() returns a different record object than last turn; NEVER per turn
  - sendTurn(text): guard no-record/streaming → false; append user ChatMessage (ISO at);
    fresh AbortController → record.abortController (REPLACE); streamState "streaming";
    model = registry.find(record.modelSnapshot.provider, record.modelSnapshot.modelId)
    — empty snapshot → notice {kind:"error"} + streamState "idle" + return true (turn recorded, no dispatch);
    assemble Context (systemPrompt + [...snapshot cast, ...turns mapped]); try {
    result = deps.port(model, context, {signal, sessionId}) } catch (sync throw — auth)
    → notice {kind:"auth", text} → streamState "idle" (assistant NOT appended) ;
    then the async settle skeleton: done → assistant ChatMessage (join text) + idle;
    error {reason} → idle, no assistant message (T5.S2 refines aborted-vs-error)
  - abort(): record.abortController.abort() (live controller only)
  - COMMENT discipline: cite SIDECHAT-002/003/005 + this task id; note the S2/M2 boundary

Task 4: CREATE src/panel/sidechat-engine.test.ts
  - FIXTURES: fake registry (find map + getAvailable list), fake port (captures
    model/context/options; returns scripted stream/promise/throw), vi.fn() notify,
    resetSidechatForTests() in beforeEach (sidechat.test.ts convention)
  - ROWS: (a) override set+found → find result; (b) "anthropic/nope" → notify once +
    sessionModel; (c) unset → sessionModel; (d) malformed "noslash" → notify + sessionModel;
    (e) sessionModel undefined + empty getAvailable → undefined; (f) inert snapshot map → {provider:"",modelId:""}
  - ROWS: assembly order — openOrReplace with deps {resolveModelSnapshot: fixed,
    buildSystemPrompt: () => "SYS", buildBranchSnapshot: () => [snapshotMsg]}, sendTurn
    → port captured context.messages === [snapshotMsg, userMsg] EXACTLY (order, mapped
    shape {role, content:[{type:"text",text}], timestamp}), systemPrompt "SYS", no tools
  - ROWS: two sendTurns → two DISTINCT controllers (first aborted? no — just distinct
    objects; abort() mid-fake-stream signals the CURRENT one); sessionId identical across
    both turns; replaces after openOrReplace on a different question
  - ROWS: guards (no record → false; streaming → false); sync-throw port → notices gains
    {kind:"auth"}, state idle, messages unchanged except the user turn
  - RUN: npx vitest run src/panel/sidechat-engine.test.ts

Task 5: VALIDATE the walls
  - npx vitest run src/panel/            # whole panel tree green
  - npm run typecheck
  - grep -nE "sendMessage|sendUserMessage|setActiveTools|registerTool|setModel" \
      src/panel/sidechat-engine.ts src/panel/sidechat.ts || echo CLEAN
  - grep -n "@earendil" src/panel/sidechat.ts || echo CLEAN
```

### Implementation Patterns & Key Details

```typescript
// PATTERN — the injected-port turn (the whole point: no ctx anywhere in the engine)
function dispatch(record: SidechatRecord, deps: SidechatEngineDeps, sessionId: string): void {
  record.abortController = new AbortController();           // fresh EVERY turn
  record.streamState = "streaming";
  const model = deps.registry.find(record.modelSnapshot.provider, record.modelSnapshot.modelId);
  if (!model) {                                             // inert record opened without a model
    record.notices.push({ kind: "error", text: INERT_TEXT, at: new Date().toISOString() });
    record.streamState = "idle";
    return;
  }
  const context: Context = {
    systemPrompt: record.systemPrompt,                      // T4.S2's frozen prompt
    messages: [
      ...(record.branchSnapshot as BranchSnapshotMessages), // SIDECHAT-003 frozen snapshot FIRST
      ...record.messages.map(toPiMessage),                  // then the live turns
    ],                                                      // NEVER tools (SIDECHAT-005)
  };
  try {
    const result = deps.port(model, context, { signal: record.abortController.signal, sessionId });
    // settle skeleton: done → freeze assistant + idle; error → idle (S2 refines)
  } catch (err) {
    record.notices.push({ kind: "auth", text: String(err), at: new Date().toISOString() });
    record.streamState = "idle";                            // panel never blocks
  }
}

// GOTCHA: sessionId regenerates ONLY on record-identity change (module-held
// lastRecordRef !== get()) — per-turn regeneration would break the prefix cache.
// CRITICAL: never set cacheRetention (compaction's "none" is the one-shot pattern).
```

### Integration Points

```yaml
RUNTIME: NONE this task — the engine is built but UNWIRED (no ctx binding, no key route)
INJECTION SEAMS (consumed next):
  - M2.T4.S1 (open path): builds SidechatRebindDeps {resolveModelSnapshot: () =>
      modelSnapshotFromModel(resolveSideChatModel(config, registryPort(ctx), ctx.model, notifyPort(ctx))),
      buildSystemPrompt: buildSideChatSystemPrompt(...), buildBranchSnapshot: takeBranchSnapshot(...)}
  - P1.M2.T3.S1 (key routing): engine.sendTurn on enter; engine.abort on the esc rung
  - T5.S2: refines the settle skeleton (delta streaming, stopReason, aborted discard)
  - T5.S3: accumulates record.usage from AssistantMessage.usage / cost.total
  - M3.T1.S1: the banned-API static guard covers sidechat-engine.ts from day one
CONFIG: reads sideChatModel only (sideChatAutoApply is T6.S2's, untouched here)
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck        # tsc --noEmit, strict — zero errors
# NOTE: repo has no ruff/mypy/lint step in gates; typecheck + vitest are the gates
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/panel/sidechat-engine.test.ts -v   # all rows green
npx vitest run src/panel/sidechat.test.ts             # store rows green (notices additive)
```

### Level 3: Integration Testing (System Validation)

```bash
npx vitest run src/panel/     # whole panel tree green (scripted only — AUTOMATION-POLICY:
                              # no live TUI, no real model calls; the fake port IS the seam)
npm test                      # full suite green
```

### Level 4: Domain-Specific Validation (cache-isolation walls)

```bash
# Banned-API wall (SIDECHAT-005 — must be CLEAN from day one; M3.T1.S1 hardens this):
grep -nE "sendMessage|sendUserMessage|setActiveTools|registerTool|setModel" \
  src/panel/sidechat-engine.ts src/panel/sidechat.ts || echo CLEAN
# sidechat.ts purity wall (M3.T1 guard precondition):
grep -n "@earendil" src/panel/sidechat.ts || echo CLEAN
# No one-shot cache pattern smuggled in:
grep -n "cacheRetention" src/panel/sidechat-engine.ts || echo CLEAN
# Expected: CLEAN / CLEAN / CLEAN (no cacheRetention anywhere in the engine).
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1: `npm run typecheck` clean
- [ ] Level 2: engine + store suites green
- [ ] Level 3: `npx vitest run src/panel/` + `npm test` fully green
- [ ] Level 4: three grep walls CLEAN

### Feature Validation

- [ ] Resolution matrix covered (override / malformed / unknown / unset / no-model-at-all → inert)
- [ ] Context assembly order asserted exactly (snapshot then turns; own systemPrompt; no tools)
- [ ] Fresh AbortController per turn; abort() signals the live one; sessionId stable per record
- [ ] Sync auth throw → notice record, idle, panel never blocks; guards return false
- [ ] streamSimplePort exported but unwired; sidechat.ts edits additive only

### Code Quality Validation

- [ ] Engine never imports ctx; all pi values imported only in sidechat-engine.ts
- [ ] Dense Mode A comments citing SIDECHAT-002/003/005 + T5.S2/M2 boundary notes
- [ ] No scope drift: no streaming deltas (S2), no usage (S3), no parsing (T6), no wiring (M2.T4)

### Documentation & Deployment

- [ ] Mode A: sidechat.ts header carries the SIDECHAT-005 nested-calls-only block + model-resolution contract
- [ ] No README changes (M3.T3.S1 owns changeset docs); no config JSDoc changes (T2.S1 landed them)

---

## Anti-Patterns to Avoid

- ❌ Don't import ctx or the live modelRegistry into the engine — injection arguments only (R5/M3.T1 guard)
- ❌ Don't copy compaction's `cacheRetention:"none"` or per-call fresh sessionId — multi-turn chat wants its own stable prefix cache
- ❌ Don't add `@earendil` imports to sidechat.ts — its purity is load-bearing for the M3.T1 guard
- ❌ Don't re-read `getBranch()`/`takeBranchSnapshot()` mid-chat — the snapshot is frozen at creation (SIDECHAT-003)
- ❌ Don't implement delta streaming, stop-reason semantics, aborted-discard, or usage tallying — T5.S2/S3 own them; keep the settle skeleton minimal
- ❌ Don't wire the engine into panel.ts/keys.ts — M2.T4.S1/M2.T3.S1 own the call sites
- ❌ Don't queue turns on streaming or reuse a controller — false + fresh controller per turn are the contract
- ❌ Don't let errors throw out of sendTurn — every failure path settles to idle and surfaces as a notice record

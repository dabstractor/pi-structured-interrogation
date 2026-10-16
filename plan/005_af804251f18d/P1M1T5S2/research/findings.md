# P1.M1.T5.S2 research findings (verified at repo HEAD d0b4de7; S1 in flight per its PRP)

## Verified pi-ai facts (node_modules .d.ts, exact)
- `streamSimple(model, context, options?): AssistantMessageEventStream` (compat.d.ts:65). NOT on ModelRegistry.
- `AssistantMessageEventStream extends EventStream<AssistantMessageEvent, AssistantMessage>`
  (utils/event-stream.d.ts): an **AsyncIterable** with `.result(): Promise<AssistantMessage>`.
  Factory `createAssistantMessageEventStream()` also exported.
- `AssistantMessageEvent` (types.d.ts:410+): discriminated union `start | text_start | text_delta |
  text_end | thinking_* | toolcall_* | done | error`; **`partial: AssistantMessage` rides EVERY
  event** (cumulative). Terminal: `{type:"done", reason, message}` / `{type:"error", reason, error}`
  (payload field names per the union — grep `text_delta`/`"done"` in types.d.ts:410-470 when editing).
- `AssistantMessage`: `content, usage, stopReason, errorMessage?, model, provider, api, timestamp`.
  `StopReason = "pending"|"stop"|"length"|"toolUse"|"error"|"aborted"|"deferred"`.
- Abort via `options.signal` terminates the stream with `error {reason:"aborted"}`; missing auth
  throws SYNCHRONOUSLY from streamSimple itself (S1's port contract covers both).

## Landed inputs / S1 contract (plan/005_af804251f18d/P1M1T5S1/PRP.md)
- `src/panel/sidechat-engine.ts` (S1, in flight → assume landed): `SidechatModelPort = (model,
  context, {signal, sessionId}) => AssistantMessageEventStream | Promise<AssistantMessage>`;
  `SidechatEngineDeps {port, registry, notify}`; `createSidechatEngine(deps) → {sendTurn, abort}`;
  `resolveSideChatModel`; `modelSnapshotFromModel`; `streamSimplePort` (unwired).
- S1's settle skeleton (S2 REFINES, must not regress): done → append assistant ChatMessage (join
  text) + idle; error{reason} → idle, NO assistant message; sync port throw → notice
  {kind:"auth"} + idle. Fresh AbortController per turn; stable sessionId per record identity;
  NEVER cacheRetention (compaction anti-pattern).
- `src/panel/sidechat.ts` (T3 landed, 211 lines): `ChatMessage {role, text, at}` (:49),
  `ChatStreamState = "idle"|"streaming"` (:56), `SidechatRecord {messages, streamState,
  abortController, notices(S1), modelSnapshot, systemPrompt, branchSnapshot, usage, ...}` (:92),
  `get/openOrReplace/buildFresh(:139)/resetChat/discard/resetSidechatForTests`. S1 adds
  `SidechatNotice {kind:"auth"|"error", text, at}` + `notices: []`. sidechat.ts is @earendil-FREE
  (load-bearing for M3.T1 guard).

## Contract semantics (item + PRD + sidechat-contracts.md)
- PRD :552 view: streaming cursor while a reply is in flight (M2.T1.S1 renders; S2 only exposes
  the buffer). :555 esc ladder: abort ⇒ "partial text discarded — the turn never happened".
  :556 parser takes the LAST ```answer block in a COMPLETED reply only. :587 mid-stream close
  aborts + discards (M2.T5.S1 hooks call abort(); S2 provides the discard semantics).
- contracts.md :93-100: footer esc hint reads `abort` while streaming; malformed → in-view notice;
  panel never blocks.

## S2 design decisions (fed into the PRP)
1. **streamingText: string** on SidechatRecord — the polling buffer. Refresh from
   `event.partial` (join text content) on EVERY event (field-name-proof vs delta payload names);
   `""` at dispatch start and after every settle. Freeze source = `done.message` (canonical).
2. **ChatStopReason** pi-free union in sidechat.ts (`"stop"|"length"|"toolUse"|"error"|"aborted"|"deferred"`)
   + `ChatMessage.stopReason?` (assistant rows only) — T6.S1 reads the frozen message.
3. **Abort = full rollback** ("the turn never happened"): pop the turn's user ChatMessage, no
   assistant record, no usage residue for T5.S3, clear buffer, idle, NO notice (deliberate esc).
   Triggers: `error{reason:"aborted"}` OR terminal stopReason/reason "aborted" (done event or
   promise resolution). Keeps the next turn's Context clean (no dangling unanswered user turn).
4. **Other errors** (error{reason≠"aborted"}, stopReason "error" + errorMessage, sync auth throw):
   user message STAYS (chat usable), notice {kind:"auth"|"error"}, no assistant record, idle.
5. **Only completed replies are frozen** into record.messages; partials live ONLY in
   streamingText (cleared on settle) — structurally, the parser never sees partials.
6. Promise-returning port: no events → buffer stays ""; await → route by stopReason (same table).

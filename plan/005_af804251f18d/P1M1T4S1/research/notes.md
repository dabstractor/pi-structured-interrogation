# P1.M1.T4.S1 research — one-shot branch snapshot pipeline (takeBranchSnapshot)

Working tree @ 34e76e9 (sidechat store landed, T3.S2 in flight).

## Placement decision (load-bearing)

- Landed `src/panel/sidechat.ts` (T3.S1) is a PURE leaf: header says "ZERO pi imports", and
  T3.S2's in-flight gate greps `@earendil` (plus the five banned identifiers) in sidechat.ts —
  ANY pi import there breaks the landed discipline. sidechat.ts's own header lists
  "T4.S1/S2 branch builders" as CONSUMERS that INJECT via the deps bag.
- Spec module layout (prd_snapshot h2.12 / M10) wants "branch snapshot via
  sessionEntryToContextMessages" in the sidechat family — satisfied by a SIBLING module.
- RESOLUTION: new file `src/panel/branch-snapshot.ts` (pure function + type), tests in
  `src/panel/branch-snapshot.test.ts`. sidechat.ts gains ONLY the Mode A header note +
  an updated BranchSnapshot comment (type stays `readonly unknown[]`).

## Verified pi-package seams (node_modules/@earendil-works/pi-coding-agent/dist)

- index.d.ts:10,19 — `convertToLlm` and `sessionEntryToContextMessages` both re-exported
  from the package root; `SessionEntry`, `ReadonlySessionManager` also exported.
- `sessionEntryToContextMessages(entry: SessionEntry): AgentMessage[]` (session-manager.d.ts:151;
  impl js :166-187) returns messages for FOUR entry types, `[]` for the rest:
  - `message` → `[entry.message]`; DEFENSIVE PATCH: user/assistant/toolResult role with
    `content == null` → `[{...message, content: []}]` (parsed-without-validation guard)
  - `custom_message` → `[createCustomMessage(customType, content ?? [], display, details, timestamp)]`
  - `branch_summary` (with summary) → `[createBranchSummaryMessage(...)]`
  - `compaction` → `[createCompactionSummaryMessage(summary, tokensBefore, timestamp)]`
  - `[]` for: thinking_level_change, model_change, custom (plain), label, session_info
  - THIS IS EXACTLY the projection pi's own `buildSessionContext` uses
    (session-manager.js:235: `buildContextEntries(...).flatMap(sessionEntryToContextMessages)`).
- `SessionManager.getBranch(fromId?): SessionEntry[]` (session-manager.d.ts:257-262):
  "Walk from entry to root, returning all entries in path order. Includes ALL entry types
  (messages, compaction, model changes, etc.). Use buildSessionContext() to get the RESOLVED
  messages for the LLM." Impl (js:958-966): leaf→root walk, reversed → ROOT→LEAF order.
  NOT compaction-aware: after a compaction the raw path carries the summarized history AND
  the compaction entry → the replay is FULL (SIDECHAT-003's "FULL main-branch replay") —
  redundancy after compaction is accepted v1 semantics, matching the spec's wording.
- `ReadonlySessionManager` (session-manager.d.ts:140) — exported Pick of read-only methods
  INCLUDING getBranch: perfect parameter type `Pick<ReadonlySessionManager, "getBranch">`
  (any real SessionManager satisfies it structurally).
- `SessionEntry` union (session-manager.d.ts:105): SessionMessageEntry | ThinkingLevelChangeEntry
  | ModelChangeEntry | CompactionEntry | BranchSummaryEntry | CustomEntry | CustomMessageEntry
  | LabelEntry | SessionInfoEntry. SessionEntryBase = {type, id, parentId, timestamp}.
- `convertToLlm(messages: AgentMessage[]): Message[]` (core/messages.d.ts:69-76): "Transform
  AgentMessages (including custom types) to LLM-compatible Messages." In-repo precedent:
  `src/compaction.ts:44` imports it; :91 `serializeConversation(convertToLlm(allMessages))`.
- `Message` (pi-ai types.d.ts, Context.messages) — import type from "@earendil-works/pi-ai"
  (compaction.ts:38 precedent for pi-ai imports; peer/dev dep present).

## The landed singleton surface consumed (src/panel/sidechat.ts)

- `SidechatRebindDeps.buildBranchSnapshot: () => BranchSnapshot` — invoked EXACTLY once per
  record creation inside `openOrReplace` (same-question reuse returns the record untouched,
  builders NOT re-invoked — SIDECHAT-003 freeze rule already guaranteed by T3.S1's code).
- `BranchSnapshot = readonly unknown[]` — "The real shape lands with P1.M1.T4.S1; this
  module only freezes and holds it — never interprets it."
- Wiring (M2.T4.S1's future work, panel-view-integration.md:21): `e` → onChat →
  openOrReplace(q, { ..., buildBranchSnapshot: () => takeBranchSnapshot(ctx.sessionManager) }).
- Test seam: `resetSidechatForTests()` for beforeEach; T3.S1 tests use fake-builder bags.

## Design (the pipeline)

```ts
// src/panel/branch-snapshot.ts
import { convertToLlm, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import type { ReadonlySessionManager } from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";

export type BranchSnapshotMessages = readonly Message[];

export function takeBranchSnapshot(
  sessionManager: Pick<ReadonlySessionManager, "getBranch">,
): BranchSnapshotMessages {
  const agentMessages = sessionManager.getBranch().flatMap(sessionEntryToContextMessages);
  return Object.freeze(convertToLlm(agentMessages));
}
```

- flatMap over ALL entries: the helper IS the filter (returns [] for non-bearing types) —
  identical to pi's own context assembly; no hand-rolled type filter to drift.
- convertToLlm narrows AgentMessage[] → Message[] (custom messages become user messages) —
  the sanctioned conversion, not hand-narrowing.
- Object.freeze: shallow — "frozen Message[]" (never re-read AND never mutated; nested
  message objects stay as pi produced them).
- Read-only: only getBranch() is called; zero session writes (SIDECHAT-005 clean — none of
  the banned identifiers appear; getBranch is not on the ban list).
- Once-at-creation is enforced by the CONSUMER (openOrReplace already guarantees it);
  this module is a pure function — same input → equal frozen output, new reference each call.

## Test matrix (src/panel/branch-snapshot.test.ts)

Fixtures: plain SessionEntry objects (SessionEntryBase fields + per-type payload).

1. Mixed branch: [model_change, user message, custom(plain), custom_message, assistant
   message, compaction, label, session_info, thinking_level_change, toolResult-bearing
   message] → output ORDER preserved; model_change/custom/label/session_info/
   thinking_level_change contribute NOTHING; the custom_message content and the compaction
   summary TEXT appear at their path positions (as user-role messages after convertToLlm);
   real messages survive verbatim. Assert via projection (roles + text), not deep equality
   of every field (convertToLlm may map custom shapes).
2. Null-content defensive row: message entry {role:"user", content:null} → survives with
   content [] (the helper's own patch).
3. Empty branch → [] frozen.
4. Object.isFrozen(result) === true; purity: two calls → deep-equal, distinct references.
5. Identity stability (the NEVER-re-read pin, through the landed store): stateful fake
   sessionManager; openOrReplace("q1", deps{buildBranchSnapshot: () => takeBranchSnapshot(fake)})
   → mutate fake's branch (append a message) → openOrReplace("q1", same deps) returns the
   SAME record (toBe); record.branchSnapshot has NO trace of the appended message; the
   builder was invoked exactly once. Different question ("q2") → rebuild: builder invoked
   again, snapshot reflects the (mutated) branch.
6. Guard compatibility greps: branch-snapshot.ts contains none of
   sendMessage|sendUserMessage|setActiveTools|registerTool|setModel; sidechat.ts still has
   zero `@earendil` (T3.S2's gate stays green).

## Docs (Mode A)

sidechat.ts header: extend the SIDECHAT-003 paragraph with the accepted-staleness sentence
("mid-chat submissions leave the snapshot stale — accepted v1") + name branch-snapshot.ts
as the producer; BranchSnapshot comment: real runtime shape is pi-ai Message[] produced by
takeBranchSnapshot (panel/branch-snapshot.ts); the static type stays readonly unknown[]
because zero-pi-imports is load-bearing for the M3.T1 guard.

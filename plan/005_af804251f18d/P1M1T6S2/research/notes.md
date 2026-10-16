# P1.M1.T6.S2 research notes — ApplyDecision contract + pendingConfirm + autoApply bypass

## Authorities read

- **plan/005_af804251f18d/architecture/panel-view-integration.md §Open/replace/discard wiring** (binding):
  - ONLY sanctioned apply seams: `acceptOptionIndex` (src/panel/actions.ts:268–331) and the write-in
    commit path (actions.ts:384–518). Engine is UI-free: it produces a decision, the PANEL routes it.
  - acceptOptionIndex chain: applyAnswer :315 → evaluateDependsOn :319 → advanceAfterAccept :320 →
    stageSupersededWriteIn :326 → maybeAutoSubmit :327; ripple veto `panel.confirmRippleEdit` :313.
  - Write-in region carries the same post-commit ordering :508–518.
  - "Routing the parsed answer through these two seams verbatim makes provenance indistinguishable
    BY CONSTRUCTION — no new answer path may be added."
- **plan/005_af804251f18d/architecture/sidechat-contracts.md §SIDECHAT-004** (binding):
  - Inline confirm row: `apply ★ sqlite? · enter = yes · esc = no` (footer-height, ripple-confirm family).
  - `sideChatAutoApply: true` (default false) bypasses the confirm.
  - `enter` applies through ORDINARY seams; `esc` declines, keeps chat open. Byte-identical provenance;
    no marker anywhere model-facing; no code path may mark an answer chat-derived.
- **P1.M1.T6.S1 PRP** (parallel, treat as contract): `parseAnswerBlock(replyText, optionValues)` →
  `ParsedAnswer = {kind:"value", value} | {kind:"text", text} | {kind:"none", reason}`; value
  byte-matches optionValues (===), text non-empty & carried VERBATIM. Lands in sidechat.ts.
- **PRD items this task answers**: h2.38 Side chat (SIDECHAT-001…005), h2.80 decision ledger entry,
  h2.8/h3.1 functional/panel-UX (side chat section).

## Codebase facts verified (read, not assumed)

1. **src/panel/sidechat.ts** — pure leaf store, ZERO pi imports (load-bearing for M3.T1 guard).
   Contains: ChatStopReason/ChatMessage/ChatStreamState/ChatUsage/ModelSnapshot/SidechatNotice/
   BranchSnapshot/SidechatRebindDeps/SidechatRecord types; `get()`, `openOrReplace`, `classifyChatCommand`,
   `resetChat`, `discard`, `formatChatCloseNotice`, `resetSidechatForTests`. Singleton = module-scope
   `let current`. T6.S1 (parallel) adds its types after the SidechatNotice interface and
   `parseAnswerBlock` right after `classifyChatCommand`'s closing brace — I anchor at the FILE TAIL
   (after `formatChatCloseNotice`) to avoid the collision.
2. **SidechatRecord fields** (T3.S1): questionId, messages, streamState, abortController,
   modelSnapshot, systemPrompt, branchSnapshot, usage, notices, streamingText. → `pendingConfirm?`
   slots after streamingText (T6.S1 does NOT touch this interface — no collision).
3. **src/config.ts**: `sideChatAutoApply: boolean` (L97), default `false` (L134), coerced via
   `coerceBoolean` (L257). config.ts itself imports @earendil — engine/store must NOT import config;
   the flag arrives INJECTED.
4. **src/panel/sidechat-engine.ts**: `SidechatEngineDeps = { port, registry, notify }` (L89–93) —
   the injection-bag precedent. `createSidechatEngine` has NO callers yet (pure M1; panel binding is
   M2). Freeze site: inside `route()`'s `if (message !== undefined)` block (~L266–284): pushes frozen
   assistant ChatMessage (`joinTextParts(message.content)`), then usage tally. Settle() has a liveness
   guard — dead/replaced records never reach route. Aborted turns roll back (no freeze).
5. **D-R13 display order** (src/panel/short-view.ts:105 `displayOptions`): recommended option first
   (if `q.recommendation` byte-matches an option value), rest in state order. **acceptOptionIndex
   speaks DISPLAY positions** (actions.ts:268 comment: "optionIndex is a DISPLAY position").
6. **short-view.ts has pi imports** (Theme from pi-coding-agent, visibleWidth from pi-tui) → sidechat.ts
   CANNOT import displayOptions. state.ts is pi-free (grep @earendil → no hits) → `import type
   { Question } from "../state.js"` is wall-clean.
7. **Question** (src/state.ts ~L60): `options?: QuestionOption[]`, `recommendation?: string`,
   `type: "choice" | "text"`. **QuestionOption** (L32): `{ value: string; label: string;
   ramification?: string }` — value is the answer-echo field.
8. **Engine test fakes** (sidechat-engine.test.ts): deps bag `{ port: fakePort(...),
   registry: fakeRegistry([...]), notify: vi.fn() }` (L182–184); `engineOverRecord({...})` helper (L307).

## Design decisions pinned (and why)

### D1 — ApplyDecision shape (item-specified)
```ts
export type ApplyDecision =
  | { seam: "acceptOptionIndex"; optionIndex: number }  // DISPLAY position (D-R13 domain)
  | { seam: "writeIn"; text: string };                   // verbatim (no trim — provenance)
```
Seam names are ROUTING LABELS for the panel's single routing consumer (M2.T6.S1). The engine/store
NEVER import actions.ts — the labels name seams they must not touch (panel-view-integration.md).

### D2 — toApplyDecision(parsed, question) takes the full Question
Item pins the signature; state.ts is pi-free so `import type { Question }` keeps the wall clean.
- kind "value" → display index via an INLINED D-R13 mirror (recommended-first, rest in state order).
  Cannot import displayOptions (pi-tui transitive). The mirror is 6 lines, doc-cross-referenced to
  short-view.ts displayOptions as the authority, and pinned by test vectors (rec reorders → indexes
  shift). Unmatched value (−1) → undefined (defensive; unreachable via settle's internal path since
  display order is a permutation of the same options).
- kind "text" → { seam: "writeIn", text } VERBATIM (trim would corrupt byte-identical provenance —
  same rule as T6.S1's carried value).
- kind "none" → undefined.

### D3 — settleApplyDecision(record, replyText, question, autoApply) is the store composer
Lives in sidechat.ts (state home; keeps engine thin; composes T6.S1's parser):
parse(replyText, declared optionValues) → toApplyDecision → pendingConfirm bookkeeping → returns decision.
- decision && !autoApply → record.pendingConfirm = decision (confirm state; M2.T1.S2 renders).
- decision && autoApply → pendingConfirm CLEARED; decision returned (immediately-applyable) — the
  engine then fires the injected onAutoApply callback (the exposure seam M2.T6.S1 binds).
- no decision → pendingConfirm CLEARED (the model's LATEST reply governs — same species as T6.S1's
  last-block-wins-no-fallback; a superseded confirm row must not linger).
Record param (not get()): matches the module's record-based mutator style; engine passes the live
record (identity = the singleton) after settle()'s liveness guard.

### D4 — Engine wiring: two OPTIONAL new deps, no callers to update
```ts
answerContext?: (questionId: string) => SidechatAnswerContext | undefined;  // { question, autoApply }
onAutoApply?: (decision: ApplyDecision) => void;
```
Freeze-site order (after usage tally, same block): resolve context → undefined (stale question) =
no-op → settleApplyDecision → if decision && autoApply && onAutoApply → fire once.
- Without the deps (all engine tests as landed): behavior byte-identical to T5 — inert by default.
- autoApply with no onAutoApply: decision evaporates (no pendingConfirm, no callback) — safe no-op,
  documented; the panel binder (M2.T6.S1) is the only routing consumer.
- Aborted turn: no freeze → no settle → an EARLIER reply's pendingConfirm survives ("the turn never
  happened" — correct).
- openOrReplace same-question reuse returns the record byte-unchanged → pendingConfirm survives an
  e-toggle (confirm row persists). resetChat/discard naturally clear (fresh record / undefined).

### D5 — clearPendingConfirm(record) is the decline seam
Item: "Declining (P1.M2.T6.S1) clears pendingConfirm" — the store provides it; M2.T6.S1 calls it on esc.

## Collision map (parallel T6.S1, same files)
- sidechat.ts: T6.S1 claims (a) types-after-SidechatNotice-interface, (b) function-after-
  classifyChatCommand. T6.S2 uses (a) types-after-ChatUsage-interface (far upstream of both),
  (b) functions after formatChatCloseNotice (file tail; T6.S1 claims nothing there), (c) ONE field
  on SidechatRecord (T6.S1 doesn't touch the interface).
- sidechat.test.ts: T6.S1 adds its own describe; T6.S2 adds a different describe — additive only.
- sidechat-engine.ts/.test.ts: T6.S1 does NOT touch them.
- HARD dependency: settleApplyDecision calls parseAnswerBlock — T6.S1 must land first (sequential
  landing per plan; only RESEARCH ran in parallel).

## Gate deltas vs T6.S1's gates
- `grep -rn "parseAnswerBlock" src/ --include="*.ts" | grep -v test` — T6.S1's "exactly ONE hit" gate
  EXPIRES when T6.S2 lands: settleApplyDecision's call site is the second sanctioned hit.
- sidechat.ts @earendil grep stays empty; banned-API-name grep (sendMessage|sendUserMessage|
  setActiveTools|registerTool|setModel) stays empty INCLUDING comments.
- git diff --stat: exactly 4 files (sidechat.ts, sidechat.test.ts, sidechat-engine.ts,
  sidechat-engine.test.ts).

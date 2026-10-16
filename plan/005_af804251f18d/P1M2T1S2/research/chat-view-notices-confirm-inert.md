# Research: chat-view S2 — notices, confirm row, inert notice

## Inputs verified in code

### SidechatRecord (src/panel/sidechat.ts:221-254)
- `notices: SidechatNotice[]` — append-only, oldest first; `SidechatNotice = {kind:"auth"|"error", text, at}` (:154). Engine pushes auth throws, inert-dispatch refusals (`INERT_NOTICE`), error events, stream failures (sidechat-engine.ts :412, :287).
- `pendingConfirm?: ApplyDecision` (:252) — present ONLY under manual mode after a settled reply produced a decision. `ApplyDecision = {seam:"acceptOptionIndex", optionIndex} | {seam:"writeIn", text}` (:139-142). NOTE: acceptOptionIndex carries an INDEX, not the value — the view needs the question's options to render the `apply ★ {value}?` preview.
- `streamingText`, `streamState` — S1's slice.
- `modelSnapshot: ModelSnapshot {provider, modelId}` — INERT MARKER = the EMPTY snapshot `{provider:"", modelId:""}` (sidechat-engine.ts :164-168 `modelSnapshotFromModel`, "nothing resolvable yields an INERT record (empty model snapshot marker)"). JSDoc at :134-135 names "the P1.M2.T1.S2 inert signal the view reads".

### The rejection-reason gap (design decision for this PRP)
`settleApplyDecision` (sidechat.ts :586) only sets/clears `pendingConfirm` — the `ParsedAnswer {kind:"none", reason: AnswerBlockRejection}` reason is NOT persisted anywhere, and the engine (:330-338) does not push a notice for it. The view cannot render "malformed answer block with reason" from the record as-is. Options considered:
1. Re-parse at render time in chat-view (import parseAnswerBlock + last assistant message + option values) — duplicates engine logic in the render path, needs reply text plumbed in.
2. **Chosen**: minimal store extension — `SidechatRecord.lastRejection?: AnswerBlockRejection`, written by `settleApplyDecision` in the SAME one-write pattern as pendingConfirm (set on kind "none", cleared otherwise), mirroring the supersede semantics ("the model's LATEST reply governs"). One field + one line; view stays pure; deterministic.

### AnswerBlockRejection enum (sidechat.ts :179-192) — five stable values, "the enum IS the notice API":
`"no-block" | "malformed-json" | "unknown-shape" | "value-mismatch" | "empty-text"`

### Confirm-row styling precedent (ripple-confirm.ts)
- The FR-18 modal REPLACES the footer: `renderConfirmFooter(victims, …)` → `⚠ Invalidates {n} answered questions ({ids}) — enter=keep, esc=cancel` (:13-14, :265).
- Side-chat confirm row is the same family (footer-height), spec text (sidechat-contracts.md :65): `apply ★ sqlite? · enter = yes · esc = no` — value preview from the matched option; text preview for write-ins.

### Inert contract (sidechat-contracts.md :99-100)
"No model seam (RPC/test fakes) or no model selected → chat view opens INERT with a one-line notice; the panel never blocks." Detection at render time: `record.modelSnapshot.provider === ""` (empty marker). Engine's INERT_NOTICE (sidechat-engine.ts :183-184): "no side chat model available — check sideChatModel in your config and provider auth" — fires on send attempts; the VIEW's one-line inert banner shows on open.

### Close flash is a notify, NOT a row
Usage/close flash goes through ctx.ui.notify per P1.M1.T5.S3 consumer (`formatChatCloseNotice(record.usage)` → "chat closed · {in} in · {out} out · ${cost}") — never an in-view row. Do not render usage anywhere.

### S1 sibling contract (chat-view.ts, in flight)
Exports `CHAT_VIEW_HEIGHT=20`, `ChatViewState {messages, streamState}`, `ChatViewQuestion {id, prompt}`, `buildChatContent(width, rows, chat, question, resolvedKeys): string[]`, `clampChatScroll`. Layout: header / transcript window (tail-pinned) / blank padding / footer hint line. S1 explicitly leaves S2 an extension point ("extras: string[] MAY be added by S2; documented extension seam in the doc block"). S2 extends the state slice (notices, pendingConfirm, modelSnapshot, rejection, options) rather than an opaque extras param — typed data in, rows out.

### Budget discipline (S1 ladder, terminal-budget.ts)
NARROW_COLS 60 / HINT_SUPPRESS_ROWS 24 / OVERVIEW_PAGINATE_ROWS 12. Notice rows drop before footer statics under narrow; confirm row REPLACES the footer entirely (never co-rendered with hints).

## Layout decision (pinned)
1. Inert banner (modelSnapshot empty): one dim row under the header, always when inert — takes precedence over everything except the header; transcript may be empty.
2. Transient notice row: the LATEST record.notices entry, one row directly above the blank padding line (below the transcript window). Latest-wins (append-only store; the view shows the newest — older ones are scroll history, not rows). Width-truncated.
3. Rejection notice row: when `lastRejection` set and no pendingConfirm — one row, mapped from the 5-value enum to fixed one-line texts.
4. Confirm row: when `pendingConfirm` — REPLACES the footer hint line (ripple-confirm family): `apply ★ {preview}? · enter = yes · esc = no`; preview = matched option value (★-prefixed? no — ★ denotes the recommended mark; spec shows `apply ★ sqlite?` where sqlite is the value) or `truncateVisible(text)` for write-ins.

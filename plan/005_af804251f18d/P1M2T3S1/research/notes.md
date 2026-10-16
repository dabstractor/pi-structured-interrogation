# Research notes — P1.M2.T3.S1 (chat-view routing, enter interception, esc-abort rung)

## Verified code facts

- `src/panel/keys.ts`:
  - `editorFocused` flag :434 = `focus === "text" || "note"` — must be extended with `"chat"` for arrows/esc forwarding + tier-2 bare-key forwarding.
  - Fixed ↑/↓ (with k/j aliases) :442-455 — view branches: overview → overviewUp, deep → deepSelectionUp, else optionUp. Chat branch goes here.
  - Fixed ←/→ :465-480 (not intercepted in editor focus). Fixed esc :487-510; `escapeDescend` def :276-283 (deep → short; overview → sticky?deep:short; else suspend) — NO streaming-abort precedent; chat rung is new and goes first.
  - `escExitEditor` :292+ — text/note duties; double-esc closes the box (ESC-002).
  - Fixed enter :513-518 — options focus only; enter never reaches the router in editor focus (intercepted in panel.handleInput — same for chat).
  - Two-tier intercepts :525-575; `b.chat`/`bare.chat` :563-565, tier table :419.
- `src/panel/panel.ts`:
  - handleInput ladder :724-830: resolved guard → **ctrl+c :762-773 (suspend + unconsumed, CTRL-C-001)** → CONFIRM-MODE CHECK (ripple modal FR-18) → enter interception (WRITEIN-001 machinery). Chat-focus enter branch goes at the interception site (S2.S1 leaves an interim consumed seam there).
  - `PanelView` :108 = short|deep|overview ("chat" arrives via P1.M2.T4.S1); `setView` :1053; `suspend` :1002; `isResolved` :1044.
- `src/panel/sidechat.ts` API: `get()` :267, `classifyChatCommand(input) → "/clear"|"/new"|null` :325, `resetChat(questionId, deps)` :473 (needs SidechatRebindDeps :211), `clearPendingConfirm(record)` :634, `discard()` :484 (NOT used on esc-exit — T5.S1 owns discard hooks). SidechatRecord carries streamState ("idle"|"streaming"), pendingConfirm (ApplyDecision), messages.
- `src/panel/sidechat-engine.ts`: `createSidechatEngine(deps)` :244 → `{ sendTurn(text): boolean; abort(): void }` — exported but UNWIRED (its docblock says the open path + routing land later). Verified abort semantics in route(): aborted → user turn popped, streamState → idle, no notice ("the turn never happened").
- `src/panel/chat-view.ts`: `clampChatScroll(totalLines, offset)` :178; `ChatViewState` :143 (pendingConfirm?, scroll); docblock :69 — "CONSUMERS: P1.M2.T3.S1 routes enter/esc when pendingConfirm is set".
- `src/panel/keys.test.ts`: harness makePanel :63 / makeActions :137; :751-region bare-`e` letter-vs-letter collision pin (deep `e` beats chat `e` — must stay green).
- Upstream PRP P1M2T2S1 (parallel): second TextField `chatField`, PanelFocus "chat", focusChatInput no-op off-view, setView-away blurs chat focus, interim enter seam "P1.M2.T3.S1 seam marker".

## Design decisions pinned in the PRP

- Chat enter branch lives in panel.handleInput (before the router), replacing S2.S1's interim seam: classify → resetChat | sendTurn | empty no-op; field cleared; never reaches accept/drafts.
- pendingConfirm enter/esc routed at panel level when focus ≠ chat; apply is a nullable stub seam (`onApplyConfirm`) owned by P1.M2.T6.S1 — tests assert routing only.
- Esc rung in escapeDescend (options focus): streaming → abort() fire-and-forget (engine settles async; no synchronous record mutation); idle → setView(chatReturnView ?? "short") without touching the singleton (discard = T5.S1). `chatReturnView` is this item's field, seeded by T4.S1's open path.
- editorFocused uniformly includes "chat" (arrows, esc, all tier-2 bare keys).
- Sequencing fallbacks: nullable engine/deps seams with test doubles; PanelView "chat" union member coordinated with T4.S1 (no shadow enum).

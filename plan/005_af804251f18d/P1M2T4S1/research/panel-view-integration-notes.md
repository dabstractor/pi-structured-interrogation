# Research notes — P1.M2.T4.S1: PanelView "chat" + open-or-replace path

## Touchpoints (current tree; T2.S1/T3.S1 land in parallel — anchors may shift)

- `PanelView` union: **panel.ts:108** `"short" | "deep" | "overview"` → add `"chat"`. Per-view state block ~:344–413 → add `chatScroll` (panel-owned transcript offset, int) + `chatReturnView: PanelView` (excluding "chat" — the view to return to on esc-exit; T3.S1's esc rung reads it with "short" fallback).
- `setView(view)`: **:1053–1083** — unchanged-view no-op (`if (this.view === view) return;`) gives once-only seeding. Add `"chat"` branch: seed `chatScroll` to BOTTOM (tail-pin; clampChatScroll windows from the end per chat-view.ts T1.S1 contract "tail-pinned by default") and `focusChatInput()` (S2.S1's method, no-op unless view==="chat"). NOTE S2.S1 adds "setView to non-chat blurs chat focus FIRST" — compatible: chat→chat no-op; chat→other blurs; other→chat focuses.
- `buildLines(width)`: **:1445+** — note-mode swap first, then `view === "short"` (:1462), deep (:1529), overview (:1563). Add `"chat"` branch: shared header (renderHeader like short/deep) → `buildChatContent(...)` from chat-view.ts:200 (embeds chatField.render via ChatViewState — per T2.S1, chatField is PUBLIC readonly so the view/panel renders it) → view-aware footer (footerLine with the chat ScreenKind).
- Footer: **layout.ts:38** `ScreenKind = "short" | "deep" | "overview"` → add `"chat"`; **SCREEN_KEYS :46–50** → add `chat: ["chat", "submit"?]` action set (FR-10: 3–4 hints; chat footer per architecture doc: `enter send · /clear · esc` — esc hint `abort` while streaming, `exit` idle; names the binding when current ≠ bound, e.g. `e reopens the chat on q3`); narrow set (:61 region); ACTION_WORDS entries for any new KeyAction. Check renderFooter's static-hint appending (:43–49 comment: short prefixes "enter accept"; deep appends "esc back · ↑/↓ scroll"; overview "enter jump · esc back") — chat appends its static hints the same way.
- Host refinement site: **panel.ts:652–661** — `if (args.pi !== undefined) { routed.onChat = (p) => { discussInChat(pi, p); }; }` with the comment saying "until the side-chat view lands (P1.M2.T4.S1)". REPLACE the body: no suspend, no editor preload (PiUISurface), main editor untouched (AC-17.1).
- `e` dispatch: keys.ts tier-2 bare `chat` key forwards to `actions.onChat` at non-editor focus from ANY view (landed by P1.M1.T1.S1 rename; T3.S1 extends editorFocused to include "chat").

## The onChat default + host wiring (the core open path)

Default `actions.onChat` in panel.ts's routed actions object (where onDiscuss's default lived — find the actions map near :640–660):

```
onChat(p):
  const qid = p.currentId; if (qid === undefined) return;
  const record = sidechat.get();
  if (record === undefined || record.questionId !== qid) {
    sidechat.openOrReplace(qid, sidechatDeps);   // snapshot taken NOW, once (SIDECHAT-003 frozen)
  }
  p.chatReturnView = p.view;                     // before switching (T3.S1 esc rung reads it)
  p.setView("chat");                             // seeds scroll bottom + focusChatInput
```

- `openOrReplace(questionId, deps: SidechatRebindDeps)` — sidechat.ts:284; same-question reuse SKIPS builder invocation (snapshot frozen). deps = `{resolveModelSnapshot, buildSystemPrompt, buildBranchSnapshot}` (:211–215) — pure functions from P1.M1.T4.S1/T4.S2 (sidechat-prompt.ts buildSideChatSystemPrompt; branch snapshot pipeline). Builders must be injected (panel/UI-free modules): host (args.pi / openPanel site panel.ts ~:1861–1900) constructs the deps bag once; panel holds it as a nullable constructor-args field (`args.sidechatDeps`) with the routed.onChat default consuming it; tests inject fakes.
- Engine: `createSidechatEngine(deps: SidechatEngineDeps)` (sidechat-engine.ts:244) is UNWIRED (no construction in extension/index — grep-verified). The engine instance is host-held; the panel only needs it for T3.S1 routing (sendTurn/abort seams are T3.S1's nullable fields). THIS item: host wiring of the engine + deps bag in openPanel/extension setup belongs here if T3.S1 left nullable seams — coordinate: T3.S1 injects doubles via fields; this item wires REAL host objects (engine via createSidechatEngine with real port/registry/notify, deps via real builders) at the openPanel site.
- Rebuild-on-change: sidechat record mutations must call `panel.invalidate()` (cached-render discipline, architecture doc §4) — the host subscription on the sidechat store (module has no event bus; add a tiny onChange hook where the engine settles / resetChat runs — check sidechat.ts for an existing notify seam; if absent, this item adds the invalidate hookup in the panel's render path: buildLines reads `sidechat.get()` live each rebuild and the engine's settle path calls a registered onSettled → panel.invalidate).

## Upstream contracts (treat as landed)

- P1.M1.T1.S1: keys.chat (`e`) + onChat seam name; compat alias discuss→chat.
- P1.M1.T4.S1/T4.S2: branch snapshot builder + buildSideChatSystemPrompt (sidechat-prompt.ts).
- P1.M1.T5.S1: createSidechatEngine (sendTurn/abort/streamState).
- P1.M2.T1.S1/S2: chat-view.ts buildChatContent(:200), ChatViewState(:143), clampChatScroll(:178), notices/confirm row; CHAT_VIEW_HEIGHT ≈ 20.
- P1.M2.T2.S1 (parallel, Implementing): `chatField` public readonly second TextField, PanelFocus "chat", focusChatInput/blurChatInput, setView blur hook, interim handleInput branch.
- P1.M2.T3.S1 (parallel, next): keys routing + esc rung reads chatReturnView; enter/send classification; editorFocused includes "chat".

## Validation

`npm run typecheck`, `npm test`, targeted `npx vitest run src/panel/panel.test.ts src/panel/layout.test.ts src/panel/keys.test.ts`. AC-17.1/17.3 behavior scripted: e → chat view focused input, header shows current question, footer hints; e again on same question → same record (no snapshot rebuild); e on another question → replaced record (snapshot once); setView seeding bottom; return-view restore via esc (with T3.S1).

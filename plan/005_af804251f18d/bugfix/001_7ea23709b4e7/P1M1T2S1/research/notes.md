# Research notes — P1.M1.T2.S1 (streaming esc abort gesture)

## Verified facts
- keys.ts fixed-esc branch :520-541: `!editorFocused → escapeDescend(panel); return true`. Editor focus: double-esc window (escExitWindowMs, config.ts:133, default 500) → escExitEditor → blurChatInput; else `return false` (single esc forwards to editor). editorFocused includes chat focus.
- escapeDescend (:297-315): FIRST rung — `panel.view === "chat"` → streaming: `panel.abortChatStream()` only (fire-and-forget); idle: `panel.exitChatView()`. Both panel methods; keys.ts stays sidechat-import-free.
- `panel.abortChatStream()` (:1768): returns false unless `getSidechatRecord()?.streamState === "streaming"`, else aborts. So the options-focus ladder already aborts on first esc; the DEAD path is chat FOCUS (single esc forwards to editor).
- chat-view.ts footer hint (:292): `esc {abort|exit}` — abort word shown while streaming, regardless of focus. Hint advertises a gesture that doesn't act while focused.
- Spec: ui-spec.md:115 "Esc ladder. Streaming: first `esc` aborts the in-flight reply" (chat-view-specific) vs ui-spec.md:44/86 ESC-002 single-esc-forwards (generic editor rule). Tension: pi-vim user typing mid-stream loses insert-exit if esc always aborts.
- Sidechat-focus.md §Streaming-abort gives two sanctioned shapes: (i) RECOMMENDED — while view==="chat" AND streaming, single esc aborts (ladder precedence; insert-exit returns when idle; abort rung does NOT consume the lastEscAt double-esc window); (ii) hint-honesty (reword hint). Item contract recommends (i).
- Test idioms: ac-sidechat.test.ts / sidechat-engine.test.ts ~324-394 — fake model port held open with captured AbortSignal; assert signal.aborted after one esc in focused state.
- Independent of P1.M1.T1.S1/S2 (enter/confirm seam) — but note S1's settle-blur means at settle focus is options, so the focused-streaming esc case is only mid-stream — fine.

## Chosen shape (i) implementation
In keys.ts fixed-esc branch, before the editorFocused double-esc logic: `if (editorFocused && panel.view === "chat" && panel.abortChatStream()) return true;` — abortChatStream itself gates on streaming (returns false when idle → falls through to normal forwarding). Do NOT touch panel.lastEscAt on the abort rung. keys.ts stays import-free (abortChatStream is a panel method). Docs: keys.ts esc-branch JSDoc + escapeDescend SIDECHAT-001 comment; footer hint unchanged (now true).

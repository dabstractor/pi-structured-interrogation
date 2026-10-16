# Research — P1.M1.T1.S2 (bugfix 001_7ea23709b4e7): route empty-buffer chat-focus enter to the pending confirm

Verified against working tree (panel.ts) + PRD h2.2/h3.0 fix direction (C).

## The branch (src/panel/panel.ts ~1258-1269)
```ts
// CHAT focus (SIDECHAT-001): enter is intercepted BEFORE the router —
// send routing via sendChatInput (classify /clear·/new → reset; text →
// sendTurn; empty → no-op). ...
if (this.focus === "chat" && enter) {
  this.sendChatInput();
  return true;
}
```
Preceding branch (~1222-1245): pendingConfirm routing gated `if (this.focus !== "chat")` — enter → `this.onApplyConfirm?.(pending)` + return true; esc → clearPendingConfirm. That gate STAYS (S1's blur makes the natural flow work; this subtask covers the refocused residual only).

## sendChatInput (panel.ts :1743, private)
Classifies the buffer: `/clear`·`/new` → reset; non-trim-empty text → sendTurn; empty/whitespace → consumed no-op. So routing a trim-empty enter to the confirm loses nothing.

## S1 contract (landed/in-flight)
Settle fire callback (panel.ts :514-515 wiring) blurs chat input ONLY when `pendingConfirm !== undefined` (blurChatInput: focus→"options" + chatField.blur(), never clears buffer). Residual: user re-focuses the input (focusChatInput :1705) to keep chatting, then presses enter on an empty/whitespace buffer while pendingConfirm still exists → dead gesture again. This subtask is the belt-and-suspenders.

## Change
Inside the chat-focus enter branch, BEFORE sendChatInput():
```ts
if (this.focus === "chat" && enter) {
  // BUG-001 residual (P1.M1.T1.S2): with a pending confirm and an empty/
  // whitespace buffer, enter applies — sendChatInput would no-op anyway,
  // so the confirm row's gesture is never dead in ANY focus state.
  // Real text still routes to sendChatInput (message first, confirm later).
  const pending = getSidechatRecord()?.pendingConfirm;
  const buf = this.chatField.getText();
  if (pending !== undefined && buf.trim() === "") {
    this.onApplyConfirm?.(pending);
    return true;
  }
  this.sendChatInput();
  return true;
}
```
Checks: `getSidechatRecord` imported at :87; `this.chatField` is the chat TextField (verify exact field name — grep chatField in panel.ts); `onApplyConfirm?: (decision: ApplyDecision) => void` optional seam (:895), wired at :1071. Do NOT touch esc (single-esc forwarding stays — ESC-002; P1.M1.T2.S1 owns the streaming hint).

## Test matrix (src/panel/ac-sidechat.test.ts, harness: convergePort :608-615, makeHarness/seedTransition/openChat/sendChat/flush, blurChatBox :443-446)
1. settle with pendingConfirm → panel.focusChatInput() (refocus) → handleInput(ENTER) on empty buffer → apply fires (q answered, record discarded, view short, usage notify)
2. chatField.setText("real text") + pendingConfirm + enter → sendChatInput path: message sent, pendingConfirm untouched, view chat
3. empty buffer + NO pendingConfirm + enter → consumed no-op (as today: no send, no throw)
4. whitespace-only buffer ("   ") + pendingConfirm + enter → applies (trim-empty)

Note: after S1's settle-blur, tests must explicitly focusChatInput() to reproduce the chat-focus state.

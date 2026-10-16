# Research Notes — Bugfix P1.M4.T1.S1: Keep the buffer when sendTurn returns false (BUG-006)

## Verified firsthand (src/panel/panel.ts, this session)

- `private sendChatInput()` at **:1878** (line numbers have drifted from the PRD's ~1743-1766; grep `private sendChatInput`). Current body:

```ts
const text = this.chatField.getText();
const command = classifyChatCommand(text);
if (command !== null) {
  if (this.chatRebindDeps !== undefined) {
    resetChat(this.currentId ?? "", this.chatRebindDeps);
  }
} else if (text.trim().length > 0) {
  this.sidechatEngine?.sendTurn(text); // refused while streaming — still consumed
}
this.chatField.setText("");
this.invalidate();
```

- Doc comment block (~:1863-1877, "[Mode A] Chat send routing"): numbered classification (1. /clear|/new → resetChat; 2. non-empty → sendTurn — "a false while already streaming is the engine's own guard; the input clears anyway"; 3. empty → consumed no-op) and the paragraph "The input clears on EVERY path. Chat paths never touch draftSlots…" — this paragraph is OURS to rewrite (coordinated with P1.M3.T2.S1, see below).
- Chat-focus enter branch (panel.ts ~:1387-1403): intercepts at panel level BEFORE the router; empty-buffer enter routes to pendingConfirm (P1.M1.T1.S2); otherwise `this.sendChatInput()`.
- `chatField: TextField` (:872, constructed :1094), `sidechatEngine?: SidechatEngine` (:877/:1107). `flash(text)` exists at :1611 (footer flash, auto-clear after FLASH_MS) — the optional refusal-notice seam.
- `sidechatEngine?.sendTurn(text)` — boolean return is ignored today (`?? false` not needed for the optional chain call but IS needed when capturing: `const sent = this.sidechatEngine?.sendTurn(text) ?? false;`).

## Engine refusal contract (src/panel/sidechat-engine.ts)

- `sendTurn(text): boolean` (~:394): returns `false` when (a) no live record (`getRecord() === undefined`), or (b) `record.streamState !== "idle"` — "no queueing, no double-controller — the esc rung aborts instead". Interface at :245; module docs :215 document both refusal reasons.

## Parallel-item boundary (P1.M3.T2.S1, in flight)

- Its PRP edits the SAME function's COMMAND branch (abort-before-reset + usage notify on /clear·/new) and rewrites the doc block's numbered list — its own text explicitly says: BUG-006's else-branch is P1.M4.T1.S1's, "do NOT touch the else-branch"; and for the shared doc paragraph it scopes its claim to "the input clears on the command and empty paths". OUR rewrite must: keep the command-path claims intact (abort+notify wording once S1 lands), change the send-branch wording to "clears only when the turn was accepted; a refused turn preserves the draft", and the tail paragraph becomes "clears on every ACCEPTED path". If S1 hasn't landed when this starts, leave a `// P1.M3.T2.S1:` coordination note rather than reverting its command-branch content.
- Interplay with landed P1.M1.T1.S1 (settle-blur): a DECISION-bearing settle blurs (text preserved — blur never clears); a non-decision settle keeps focus; this task adds the refused-enter case. No code coupling — sendChatInput just must not clear on refusal.

## Test harness (src/panel/ac-sidechat.test.ts — all helpers exist)

- `gatedStream()` (:333) — fake port whose stream is held open (streamState "streaming"), with terminal-event release (see `finishWith` usage around :1190-1196).
- `openChat(panel)` (:444), `sendChat(panel, text)` (:456) — drives the real enter path (`panel.handleInput("\r")` after setText? — check sendChat's body; if it calls sendChatInput directly, ALSO add a raw `handleInput("\r")` variant since the repro specifies the real key).
- Panel construction with a REAL createSidechatEngine over injected ports (:407, :433 sidechatEngine arg) — follow makePanel-style fixtures in that file.
- getSidechatRecord accessor for streamState/messages assertions; engine.sendTurn boolean tests at sidechat-engine.test.ts:282-372.

## PRD anchors

- Bug report h2.3/h3.5 (BUG-006): repro = open chat → send over held-open port → setText('follow-up question') → handleInput("\r") → getText() '' and nothing sent. Fix: "keep the text when sendTurn returns false (or queue it / notify 'reply in flight — esc to abort')".
- h2.5 recommendation: "preserve typed input when sendTurn refuses (BUG-006)".
- Draft-sacredness authority: ui-spec commitment 6 / R4.
- Successor: P1.M6.T1 (README §Side chat sync owns docs).

## Scope discipline

- ONLY the send branch + doc comment + tests. Optional `flash('reply in flight — esc aborts')` polish ONLY via the existing flash() seam — no new UI. Do NOT touch the command branch (S1's), the empty-buffer pendingConfirm routing (M1.T1.S2's), engine internals, or sidechat.ts.

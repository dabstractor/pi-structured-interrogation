# BUG-005 / BUG-006 / BUG-007 research — replace/reset abort ownership, input preservation, usage notices

All line numbers verified firsthand at HEAD e298920. Verdicts: **all three CONFIRMED.**

---

## Shared model: who owns abort (verified)

- `sidechat.ts` `openOrReplace()` (~283-291): different questionId → `buildFresh`
  replaces wholesale. JSDoc: "**The old record's controller is NOT aborted
  (caller's job)**." `resetChat()` (~466-470): same rule ("Caller-owns-abort:
  the old record's in-flight stream is NOT aborted here"). `discard()`
  (~474-478): "Deliberately does NOT abort ... mid-stream abort ordering is the
  CALLER's contract (P1.M2.T5.S1)".
- The panel's ONE correct caller today is the terminal-status discard hook
  (`panel.ts` `onChanged` ~941-975): `if (record.streamState === "streaming")
  record.abortController.abort(); // FIRST (ruling order)` then usage read →
  discard → close view → `this.sidechatNotify?.(formatChatCloseNotice(usage))`.
- Engine `abort()` (`sidechat-engine.ts` ~441-448) signals the LIVE singleton's
  controller only: `const record = getRecord(); if (record !== undefined)
  record.abortController.abort();`. A FRESH controller is created per turn at
  sendTurn (~403): `record.abortController = new AbortController();`.
- `settle()` liveness guard (`getRecord() !== record` → return; sites ~360,
  372, 385, 391): a replaced/discarded record's late completion mutates
  nothing — including usage. So an orphaned call streams to completion
  invisibly and NO user gesture can stop it (esc's abort rung reads the live
  record only).

## BUG-005 — replace orphans the in-flight LLM call (Minor) — CONFIRMED

`onChat` (`panel.ts:1057-1066`):

```ts
routed.onChat = (p) => {
  const qid = p.currentId;
  if (qid === undefined || args.chatRebindDeps === undefined) return;
  const record = getSidechatRecord();
  if (record === undefined || record.questionId !== qid) {
    openSidechatRecord(qid, args.chatRebindDeps); // snapshot NOW, once
  }
  if (p.view !== "chat") p.chatReturnView = p.view;
  p.setView("chat");
};
```

No abort of the replaced record, no notify (see BUG-007). The engine's abort()
can no longer reach the replaced controller (it is not the singleton).
Same-shape sibling: `sendChatInput`'s `/clear`|`/new` branch calls
`resetChat(...)` (`panel.ts:1756-1766`) — classification runs BEFORE the
streaming check, so `/clear` mid-stream also swaps the controller out from
under the in-flight call, orphaning it identically.

### Fix shape (mirror the close-path ordering, PRD-endorsed)

In `onChat`, before `openSidechatRecord`, when actually replacing
(`record !== undefined && record.questionId !== qid`):

1. `if (record.streamState === "streaming") record.abortController.abort();`
2. `const usage = record.usage;` (read BEFORE destroy)
3. `openSidechatRecord(qid, args.chatRebindDeps);`
4. `p.sidechatNotify?.(formatChatCloseNotice(usage));` (BUG-007's replace half —
   see below for the empty-record guard question)

Same ordering in `sendChatInput`'s command branch before `resetChat` (abort the
in-flight turn, read usage, reset, notify). Note the aborted turn's settle
rolls back ("the turn never happened") — it pops its user entry on the DEAD
record; harmless. Notify-noise consideration: replacing/resetting a record with
zero turns and zero usage would toast `chat closed · 0 in · 0 out · $0.00`.
The existing hook fires unconditionally (any record, any usage) — consistency
argues unconditional; UX argues suppressing the all-zero notice. Either is
defensible; pick one, test it, document it in the doc comment.

**Tests**: PRD BUG-005 repro — chat on q3 over a gated held-open streaming
port; blur, `o`, ↓↓↓, enter (jump), `e` on q4 → assert the q3 port call's
signal IS aborted (fake port captures the AbortSignal; assert
`signal.aborted === true`) and record.questionId === 'q4'. /clear variant:
streaming on q3, type `/clear`, enter → old signal aborted, messages+usage
reset, notify fired.

## BUG-006 — typed input destroyed when enter pressed mid-stream (Minor) — CONFIRMED

`sendChatInput` (`panel.ts:1743-1766`):

```ts
private sendChatInput(): void {
  const text = this.chatField.getText();
  const command = classifyChatCommand(text);
  if (command !== null) {
    if (this.chatRebindDeps !== undefined) {
      resetChat(this.currentId ?? "", this.chatRebindDeps);
    }
  } else if (text.trim().length > 0) {
    this.sidechatEngine?.sendTurn(text); // refused while streaming — still consumed
  }
  this.chatField.setText("");   // ← unconditional
  this.invalidate();
}
```

`sendTurn` returns `false` when `record.streamState !== "idle"`
(`sidechat-engine.ts` ~400-401: "no queueing, no double-controller — the esc
rung aborts instead"). The panel ignores the return and wipes the buffer.
Module JSDoc: "The input clears on EVERY path." Draft-sacredness
(ui-spec commitment 6 / R4) is violated on the one surface left out.

### Fix shape (PRD: "keep the text when sendTurn returns false")

Capture the boolean: `const sent = this.sidechatEngine?.sendTurn(text) ?? false;`
and clear only when `sent` (and always clear on the command path). Update the
doc comment ("clears on every path" → clears on every ACCEPTED path; a refused
turn preserves the draft). Optional polish per PRD: surface why (flash/notice
"reply in flight — esc to abort") — only if a cheap existing seam exists
(`panel.flash`); do not build new UI. Regression: PRD repro — streaming port,
`chatField.setText('follow-up')`, enter → `chatField.getText() ===
'follow-up'`, no new user turn in `record.messages`, still streaming.

## BUG-007 — no usage-close notice on replace or /clear·/new (Minor) — CONFIRMED

Sole notify site: the discard hook (`panel.ts:971`:
`this.sidechatNotify?.(formatChatCloseNotice(usage))`). Destroy paths and their
notify state (verified):

| Path | Site | Destroys | Notifies? |
|------|------|----------|-----------|
| Question reaches terminal status (any mutation path) | onChanged hook ~941-975 | record | YES |
| Replace via `onChat` (different question) | panel.ts ~1060 | record+usage | **NO** ← bug |
| `/clear`·`/new` reset | sendChatInput → resetChat ~1756 | messages+usage | **NO** ← bug |

`formatChatCloseNotice(usage: ChatUsage)` (sidechat.ts ~496-500):
`chat closed · {n} in · {n} out · ${cost}` — humanized (K at ≥1000, one
decimal, `.0` stripped; cost always 2 decimals). ui-spec.md:118: "Usage & close.
Each turn's usage accumulates; any close/discard notifies compactly
(`chat closed · 12.4K in · 3.1K out · $0.07`)."

### Fix shape

Fire the notice at both missing sites, reading `record.usage` BEFORE the
destroy, exactly as the hook does — this is implemented TOGETHER with the
BUG-005 abort ordering (same two sites, same sequencing; see above). Note for
`/clear`: ui-spec.md:114 frames the reset as the user's escape hatch ("discard
all messages and usage and rebind fresh; the view stays open") — the view
staying open is unchanged; only the notice is added per §Usage & close.

**Tests**: replace case — two turns with usage over a fake port (e.g. usage
{input:10,output:5,totalCost:0.07} then more), navigate + `e` elsewhere →
notify called once with the exact humanized string; /clear case — same, then
type `/clear` + enter → notify once, `record.messages` empty,
`record.usage` zeroed, view still "chat"; existing close-path notify tests
(ac-sidechat.test.ts AC-17.4 asserts `chat closed · 10 in · 5 out · $0.07`)
stay green.

## Existing tests that pin current behavior (will need updating)

- `src/panel/panel.test.ts` (~3836, ~4055 createSidechatEngine harnesses) —
  sendChatInput clearing / command-path tests.
- `src/panel/sidechat-engine.test.ts` — "usage tally & close notice (T5.S3)"
  (~721), guards (~360: refusal-while-streaming), controller lifecycle (~324).
- `src/panel/ac-sidechat.test.ts` — AC-17.x close/notify assertions.
Search for `setText("")`-adjacent assertions and `chat closed` expectations
when touching these seams; update pins to the new contracts above.

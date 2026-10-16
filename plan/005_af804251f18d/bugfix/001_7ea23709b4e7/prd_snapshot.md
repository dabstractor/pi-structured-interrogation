# Bug Fix Requirements

## Overview
Creative end-to-end validation of pi-interrogator at HEAD e298920 ('restart resurrection fixed; validation round done'). Gates: 1551/1551 vitest tests, tsc --noEmit, eslint, and scripts/verify-keymap-conflicts.sh all green. Live E2E against the installed pi 1.0.2 (print mode, real model, session-file ground truth): the prior round's CRITICAL restart-resurrection bug is genuinely fixed — a completed interrogation stays completed across multiple restarts (exactly 1 completion entry; a second interrogation completes to exactly 1 more), a plain-message turn after restart injects nothing, a post-restart read returns the completed state, and a brand-new interrogation after completion starts fresh at epoch 1 without inheriting old answers. The mirror-debounce base-selection poisoning scenario was analyzed and is structurally prevented (the tool_execution_end re-attach seed overwrites stale pending). The remaining defects concentrate in the NEW side-chat surface (SIDECHAT-001..005), found by runtime reproduction with the real panel/engine over fake model ports: the answer confirm row's advertised enter/esc gestures are dead in the default focused state (major — the shipped AC test itself codifies the undocumented double-esc workaround), plus six minor issues (chat on an answered question destroyed by unrelated mutations; no-op apply leaves a stuck confirm row; `e` in the overview binds the wrong question; mid-stream replacement orphans an unabortable LLM call; typed input silently destroyed when enter is pressed mid-stream; missing usage-close notices on replace//clear) and one reconstruction robustness gap (older valid tool results not in the candidate pool). Core lifecycle, staleness guards, completion exactly-once, write-ins, and the prior fix all verified sound.


## Critical Issues (Must Fix)
Issues that prevent core functionality from working.

None.


## Major Issues (Should Fix)
Issues that significantly impact user experience or functionality.

### Issue 1: Side-chat answer confirm row's advertised gestures (enter=apply, esc=decline) are dead in the default focused state
**Severity**: Major
**ID**: BUG-001
**Location**: src/panel/panel.ts:1222-1245 (focus !== "chat" gate), src/panel/panel.ts:1264-1269 (chat-focus enter → sendChatInput), src/panel/chat-view.ts:135-139,352-363 (row renders unconditionally)

**Description**:
When a side-chat reply converges on a fenced ```answer block, the footer renders 'apply ★ {value}? · enter = yes · esc = no' — but after sending a message the chat input holds focus (setView("chat") seeds focusChatInput and nothing blurs it on settle), and the confirm-row routing in handleInput is gated on `this.focus !== "chat"`. While focused, enter routes to sendChatInput(), which is an empty-buffer no-op (the message was already sent), and a single esc forwards to the editor (pi-vim). Both advertised gestures do NOTHING in the natural flow (type → enter to send → reply streams → confirm row appears → press enter). Pressing enter repeatedly never applies; the row looks frozen. The only path to a working enter is an undocumented double-esc (blur the input within escExitWindowMs) followed by enter — the project's own AC-17.4 test codifies this workaround ('Enter on the confirm row: blur the box (double-esc), then enter', src/panel/ac-sidechat.test.ts:636), so the shipped UX requires a gesture the UI never hints at. The same focus-blind pattern affects the streaming footer hint: while the input is focused, 'esc abort' is shown but a single esc forwards to the editor — aborting a runaway reply requires blur-then-esc. Violates ui-spec §Side chat ('shows an inline confirm (`enter` apply · `esc` keep chatting)') and the confirm-row family contract (the ripple confirm's enter/esc always act). Reproduced at runtime with the real panel + real engine over a fake model port: enter after settle leaves the answer unapplied, pendingConfirm still set, view still 'chat'; a second enter is equally dead; esc does not decline.

**Steps to Reproduce**:
1) Build a panel (DEFAULT_CONFIG, sideChatAutoApply false) on an unanswered choice question q3 with a converging model port (reply ends with ```answer {"value":"sqlite"}). 2) handleInput("e") → view 'chat', focus 'chat'. 3) chatField.setText("thoughts?"); handleInput("\r") → message sent, focus stays 'chat'. 4) Await settle → record.pendingConfirm set; render shows 'enter = yes'. 5) handleInput("\r") → q3 still unanswered, pendingConfirm still set, view still 'chat' (dead gesture). 6) handleInput("\u001b") → pendingConfirm still set (esc forwarded to editor, not a decline). Fix directions: blur the chat input when a decision settles (or render the confirm row only while focus !== 'chat', or route an empty-buffer enter in chat focus to the pending confirm).


## Minor Issues (Nice to Fix)
Small improvements or polish items.

### Issue 1: Side chat opened on an already-answered question is silently destroyed by any unrelated state change
**Severity**: Minor
**ID**: BUG-002
**Location**: src/panel/panel.ts:940-975 (discard hook current-status check), src/panel/panel.ts:1057-1066 (onChat has no status gate)

**Description**:
onChat opens a chat on any question regardless of status, but the discard hook (state.on("changed")) tests the question's CURRENT status (answered|submitted|moot|withdrawn|closed) rather than a transition INTO terminal state. So a chat opened on an already-answered question (a supported flow — the apply path explicitly handles ANSWER-PIN no-ops and FR-18 ripple confirms, which only arise on answered questions) lives on borrowed time: the next state mutation ANYWHERE (answering a different question, an agent upsert, a dependsOn flip) fires 'changed', sees the answered status, aborts/discards the chat and toasts 'chat closed'. Reproduced at runtime: answered q1, opened chat on q1, sent a turn, exited the view, answered q2 via state.applyAnswer → chat gone. The spec's discard rule is event-driven ('it discards when its question is answered or closed by ANY path (option accept, write-in, side-chat apply, moot/withdraw/upsert close)' — FR-15/SIDECHAT-002); an already-answered question is not 'being answered' by an unrelated mutation. Either the open path should refuse (or the hook should compare pre/post status transitions) so the behavior is consistent.

**Steps to Reproduce**:
1) Panel on q1..q4; markAnswered(q1, postgres). 2) handleInput("e") on q1 → chat opens on q1, send a turn (works). 3) Blur chat box (esc,esc), exit view (esc). 4) state.applyAnswer("q2", sqlite) → getSidechat() is undefined and notify fired 'chat closed · …' — the q1 chat was collateral damage from q2's answer.

### Issue 2: Same-value (ANSWER-PIN no-op) apply from the confirm row never discards the chat and leaves the confirm row stuck
**Severity**: Minor
**ID**: BUG-003
**Location**: src/panel/actions.ts:562-578 (applyChatAnswer — discard delegated to the changed hook), src/panel/panel.ts:940-975 (hook never fires on no-op)

**Description**:
applyChatAnswer routes through acceptOptionIndex, whose same-value path is a correct ANSWER-PIN-001 no-op (advance only, no state write). But the chat's discard/close is driven entirely by the state 'changed' event, which a no-op never fires, and nothing clears record.pendingConfirm on apply ('manual clearing would race a same-value no-op' per the code comment — so no clearing exists at all). Result on an already-answered question whose chat re-proposes the recorded value: blur + enter applies as a no-op (correct), but the view stays 'chat', the record survives, and the confirm row keeps rendering 'apply ★ …' — pressing enter again re-runs the no-op forever. Only esc (decline) clears the row. Violates AC-17.4's tail ('enter → the answer applies … the chat vanishes') and SIDECHAT-002's discard-on-answer contract for this edge; at minimum the apply should consume pendingConfirm and close the view when the record's question is already terminal.

**Steps to Reproduce**:
1) Panel on q1..q4; markAnswered(q3, sqlite). 2) handleInput("e") on q3 with a converging port proposing sqlite. 3) Send a turn → pendingConfirm set. 4) Blur (esc,esc) then handleInput("\r") → apply runs as no-op; view still 'chat', getSidechat()?.pendingConfirm still defined, render still contains 'apply ★'. 5) Further enters keep no-oping with the row still shown.

### Issue 3: `e` in the overview opens the side chat on the background question, not the cursor row
**Severity**: Minor
**ID**: BUG-004
**Location**: src/panel/keys.ts:599-603 (chat dispatch, no overview branch), src/panel/panel.ts:1057-1060 (onChat uses currentId), src/panel/overview.ts:362-380 (cursor never syncs currentId)

**Description**:
In the overview the interaction model is cursor-row-centric (↑/↓ move the cursor row, enter jumps to it; stepOverviewCursor deliberately 'NEVER touches panel.currentId'). But the chat key dispatch has no overview branch — onChat binds to p.currentId, the question the panel sat on BEFORE entering the overview. A user who moves the overview cursor to q5's row and presses `e` gets a chat header showing the WRONG question (the old background one), and the replace-singleton semantics then bind the chat to that wrong question. The elaborate key is view-gated to the short view precisely to avoid this class of confusion (BUG-011 note in keys.ts); the chat key should either target the overview cursor row or be gated out of the overview. Reproduced at runtime: panel on q1, `o`, ↓↓ to another row, `e` → record.questionId === 'q1'.

**Steps to Reproduce**:
1) Panel on q1..q4 (focusQuestionId q1). 2) handleInput("o") → overview. 3) handleInput("\u001b[B") → overviewCursor now on q2's row. 4) handleInput("e") → getSidechat()?.questionId is 'q1', not the cursor row's question.

### Issue 4: Replacing a chat mid-stream orphans the in-flight LLM call — never aborted, no abort handle (cost leak)
**Severity**: Minor
**ID**: BUG-005
**Location**: src/panel/panel.ts:1057-1066 (onChat — openOrReplace without aborting the replaced record), src/panel/sidechat-engine.ts abort() (live-record-only)

**Description**:
Opening a chat on another question replaces the singleton record wholesale without aborting the replaced record's in-flight stream (the engine's abort() signals only the LIVE record; settle's liveness guard then silently no-ops when the orphan completes). The orphaned provider call keeps generating tokens invisibly and unaborted — there is NO user gesture that can stop it (esc's abort rung reads the live record only). This is the same class the implementation-plan risk table mitigates with 'esc aborts; singleton + one-shot snapshot cap the blast radius', and the close path already gets it right (a chat whose question closes mid-stream aborts FIRST, then discards — panel.ts discard hook ordering). The replace path in onChat should do the same: abort the replaced record's controller before openOrReplace. Reproduced at runtime: chat on q3 with a held-open streaming port, blur, jump to q4 via overview+enter, `e` on q4 → record replaced, port still has exactly one in-flight call that abortChatStream() cannot reach.

**Steps to Reproduce**:
1) Chat on q3; send a message over a gated fake port (stream held open, streamState 'streaming'). 2) Blur the chat input (esc,esc), then leave via `o` (overview), ↓↓↓ to q4, enter (jump), `e` (open chat on q4). 3) getSidechat()?.questionId === 'q4' while the q3 port call is still in flight; panel.abortChatStream() signals only the q4 record's controller — the q3 stream can never be aborted.

### Issue 5: Typed chat input is silently destroyed when enter is pressed while a reply is streaming
**Severity**: Minor
**ID**: BUG-006
**Location**: src/panel/panel.ts:1743-1766 (sendChatInput — unconditional setText("")), src/panel/sidechat-engine.ts sendTurn (refuses while streaming)

**Description**:
sendChatInput clears the chat input on EVERY path ('The input clears on EVERY path'), including the path where engine.sendTurn refuses the turn (returns false while streamState === 'streaming'). A user who types a follow-up while the model is replying and presses enter loses their text with no feedback — nothing is sent, nothing is queued, the buffer is wiped. This violates the draft-sacredness spirit (commitment 6 / R4 — the panel's own draft machinery is painstakingly lossless) on the one text surface that was left out, and there is no discoverable reason the message vanished. Fix: keep the text when sendTurn returns false (or queue it / notify 'reply in flight — esc to abort').

**Steps to Reproduce**:
1) Open a chat, send a message over a held-open streaming port (streamState 'streaming'). 2) chatField.setText('follow-up question'); handleInput("\r"). 3) chatField.getText() is now '' and no turn was sent — the typed follow-up is gone.

### Issue 6: No usage/close notification when a chat is replaced by opening on another question or reset via /clear or /new
**Severity**: Minor
**ID**: BUG-007
**Location**: src/panel/panel.ts:1057-1066 (onChat — no notify on replace), src/panel/panel.ts:1743-1766 (sendChatInput /clear branch — no notify), sole notify site src/panel/panel.ts:971

**Description**:
ui-spec §Side chat 'Usage & close' requires 'any close/discard notifies compactly (`chat closed · 12.4K in · 3.1K out · $0.07`)'. The notify fires only from the terminal-status discard hook (panel.ts:971). When the user opens a chat on a different question (wholesale replacement — the old chat and its accumulated usage are destroyed) or runs /clear//new (messages and usage discarded), no notification is ever shown; the tally silently evaporates. The user has no way to see what a discarded chat cost, which is exactly what the spec's close notice exists for.

**Steps to Reproduce**:
1) Open a chat on q3, run two turns over a fake port with usage. 2) Navigate to another question and press `e` (replacement) — no 'chat closed' notify. 3) Repeat with `/clear` in the chat input — messages+usage reset with no notify. Compare: answering the chat's own question DOES notify.

### Issue 7: Reconstruction drops older valid interrogate tool results when the newest one fails to deserialize
**Severity**: Minor
**ID**: BUG-008
**Location**: src/reconstruct.ts:326-345 (walkBranch keeps only the last tool result), src/reconstruct.ts:449-453 (single tool-result candidate)

**Description**:
walkBranch keeps only the LAST interrogate tool result carrying details.state (result.toolState/toolIndex), and the candidate pool pushes that single entry. The module JSDoc claims 'Deserialize failures degrade to the next-older candidate, so one corrupt entry never crashes session_start' — but the only older candidates are mirror entries; earlier valid tool results on the branch are never candidates. If the newest tool result's state envelope is damaged (e.g. a truncated/hand-edited session file) and no mirror entry exists (mirrors are a 2s-debounced fallback that may never have flushed), reconstruction collapses to 'no state' even though a perfectly valid older tool result sits earlier on the branch — silently losing the whole interrogation. Fix: collect every state-carrying tool result (with index) into the candidate pool like mirrors, newest-first.

**Steps to Reproduce**:
Craft a branch: [toolResult(interrogate, valid live state), ...plain turns..., toolResult(interrogate, corrupt details.state: a hostile object whose getters throw)], no custom entries. reconstructFromBranch → { source: 'none' } — the valid earlier tool result is ignored and all questions are lost, though the intended contract is degrade-to-next-older.

## Testing Summary
- Total bugs found: 8
- Critical: 0
- Major: 1
- Minor: 7

## Recommendations
- Fix BUG-001 by blurring the chat input (or routing an empty-buffer enter) when a decision settles, so the confirm row's advertised gestures work in the default state; add a regression test that presses enter immediately after settle WITHOUT blurring first.
- Make the side-chat discard hook transition-aware (compare pre/post status, or gate onChat on non-terminal status) and have applyChatAnswer consume pendingConfirm + close the view when the target question is already terminal (BUG-002/BUG-003).
- Abort the replaced record's stream and fire the usage-close notice in onChat and the /clear path, mirroring the close-path ordering (BUG-005/BUG-007); preserve typed input when sendTurn refuses (BUG-006).
- Route the chat key in the overview to the cursor-row question (or gate it out) to match the overview's cursor-row interaction model (BUG-004).
- Collect every state-carrying interrogate tool result into the reconstruction candidate pool so the documented degrade-to-next-older behavior actually holds (BUG-008).

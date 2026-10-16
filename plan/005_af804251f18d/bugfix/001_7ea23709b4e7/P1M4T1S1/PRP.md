# PRP — Bugfix P1.M4.T1.S1: Keep the buffer when sendTurn returns false (streaming refusal) — BUG-006

## Goal

**Feature Goal**: Fix BUG-006 — the chat input silently destroys typed text when enter is pressed while a side-chat reply is streaming. `sendChatInput` (src/panel/panel.ts, `private sendChatInput()` — grep it, currently ~:1878) calls `this.sidechatEngine?.sendTurn(text)` ignoring its boolean return and then unconditionally `this.chatField.setText("")`. Change: capture the return (`const sent = ... ?? false`), clear the buffer ONLY when the turn was accepted; a refused turn (no live record, or `streamState !== "idle"` — the engine's no-queueing guard) preserves the draft so the user can re-press enter after the stream completes (or abort with esc). The command path (`/clear`·`/new`) and the empty-buffer no-op still always clear.

**Deliverable**: Modified send path + doc comment in `src/panel/panel.ts` (send branch + tail of `sendChatInput`, doc block ~:1863-1877), optional one-line refusal flash via the existing `flash()` seam (:1611) if cheap, and tests in `src/panel/ac-sidechat.test.ts`. No engine/sidechat.ts/command-branch changes.

**Success Definition**: PRD repro scripted and green: open chat → send a message over a held-open streaming port → `chatField.setText('follow-up question')` → enter (`handleInput("\r")` through the real key path) → `chatField.getText() === 'follow-up question'`, no new user turn in `record.messages`, `streamState` still `"streaming"`; then release the port (settle) → re-press enter → the follow-up sends (`record.messages` gains the user turn) and the buffer clears to `""`. Accepted-send, empty-buffer, and command paths unchanged. `npm test` + `npm run typecheck` green.

## User Persona (if applicable)

**Target User**: A pi user side-chatting with the model about a question while a reply is streaming.

**Use Case**: The user reads the streaming answer, types a follow-up, presses enter before the stream finishes — the text must survive (R4 draft-sacredness spirit), with the recover path being esc-abort or waiting and re-pressing enter.

**User Journey**: Type follow-up → enter mid-stream → nothing lost (optionally a transient footer hint "reply in flight — esc aborts") → stream settles (or esc aborts) → enter again → message ships, buffer clears.

**Pain Points Addressed**: Typed text vanishing with no feedback and no discoverable reason (BUG-006) — the one text surface left out of the panel's otherwise painstakingly lossless draft machinery.

## Why

- PRD h2.3/h3.5 (BUG-006) + h2.5 recommendation: "preserve typed input when sendTurn refuses (BUG-006)".
- Draft-sacredness authority: ui-spec commitment 6 / R4 — the panel's draft machinery is lossless everywhere else; this closes the gap.
- Completes the input-preservation trilogy with the landed P1.M1.T1.S1: decision-bearing settle blurs (preserving text), non-decision settle keeps focus, and now a refused enter mid-stream also preserves text.

## What

### Code contract

Current send branch + tail (verified; `grep -n "private sendChatInput" src/panel/panel.ts` — ~:1878):

```ts
} else if (text.trim().length > 0) {
  this.sidechatEngine?.sendTurn(text); // refused while streaming — still consumed
}
this.chatField.setText("");
this.invalidate();
```

becomes:

```ts
} else if (text.trim().length > 0) {
  // BUG-006: a refused turn (no live record, or streamState !== "idle" —
  // the engine's no-queueing guard) must NOT destroy the typed draft. The
  // buffer survives; re-press enter after settle (or esc-abort) to send.
  const sent = this.sidechatEngine?.sendTurn(text) ?? false;
  if (sent) {
    this.chatField.setText("");
  } else if (OPTIONAL_FLASH) {
    this.flash("reply in flight — esc aborts"); // only if using the polish
  }
}
this.chatField.setText(text_wipe_for_command_and_empty_paths_only);
this.invalidate();
```

Precisely: restructure so the tail `setText("")` applies ONLY to the command and empty paths; the send path clears in its own `if (sent)` branch. Consume-ness is unchanged (enter is still consumed — return behavior of the enter branch untouched). The `?? false` matters: `sidechatEngine` is optional.

### Optional polish (strictly bounded)

A transient refusal notice `this.flash("reply in flight — esc aborts")` — ONLY via the existing `flash()` seam (panel.ts :1611, footer flash with FLASH_MS auto-clear). Do NOT build any new UI, timer, or notify channel for this. If flash interplays awkwardly with the chat view's footer, drop the polish — the buffer preservation alone satisfies the PRD.

### Doc comment rewrite (~:1863-1877)

Rewrite the "[Mode A] Chat send routing" block: path 2 becomes "non-empty → `sendTurn(text)`; the buffer clears only when the turn was ACCEPTED — a refused turn (already streaming, no live record) preserves the draft (BUG-006; R4 spirit); re-press enter after settle, or esc-abort". The closing paragraph becomes "The input clears on every ACCEPTED path" with the refused-send carve-out named. **COORDINATION with P1.M3.T2.S1** (parallel, same function's command branch + doc list): its PRP explicitly scopes its claim to "the input clears on the command and empty paths" and leaves this else-branch to us. Read the landed doc block first; keep its command-path wording (abort-before-reset + usage notice) intact; merge rather than overwrite. If S1 has NOT landed when you start, write your text with a `// P1.M3.T2.S1:` coordination note instead of reverting anything.

### Out of scope

- The command branch (`/clear`·`/new`) — P1.M3.T2.S1's (abort + notify).
- The empty-buffer pendingConfirm enter routing — P1.M1.T1.S2's (landed).
- Queueing the refused message (PRD offers keep/queue/notify; we implement keep, optionally notify).
- sidechat-engine.ts internals, sidechat.ts, keys.ts, README (P1.M6.T1 owns §Side chat sync).

### Success Criteria

- [ ] Refused send (streaming): buffer preserved byte-for-byte, no user turn appended, streamState untouched, enter consumed.
- [ ] After settle, re-press enter: turn sends, buffer clears.
- [ ] Refused send with NO live record (chat closed under focus — edge): same preservation (sendTurn false path), no throw.
- [ ] Accepted send still clears immediately; empty buffer and `/clear`·`/new` paths unchanged.
- [ ] Doc comment reflects accepted-path clearing + refusal carve-out, merged with S1's command wording.
- [ ] `npm test` + `npm run typecheck` green.

## All Needed Context

### Context Completeness Check

The exact current source, engine refusal contract, parallel-item boundary, test helpers, and repro steps are all verified firsthand (see research/research-notes.md). A fresh implementer needs only this PRP + the listed files.

### Documentation & References

```yaml
- file: src/panel/panel.ts
  why: THE target. sendChatInput body + doc block (~:1863-1877 body-at-:1878; grep "private sendChatInput" — line numbers drift). chatField (:872/:1094), optional sidechatEngine (:877/:1107), flash() (:1611), chat-focus enter branch (~:1387-1403) that calls sendChatInput.
  gotcha: `sidechatEngine?.sendTurn(text)` returns boolean|undefined — capture with `?? false`. Do NOT touch the command branch or empty-buffer routing.

- file: src/panel/sidechat-engine.ts
  why: sendTurn contract (~:394): false on no live record OR streamState !== "idle" ("no queueing, no double-controller — the esc rung aborts instead"); interface :245; module docs :215. READ ONLY — no changes.
  critical: both refusal reasons must preserve the buffer; the engine is not modified.

- file: src/panel/ac-sidechat.test.ts
  why: the harness. gatedStream() (:333) — held-open fake port with terminal-event release; openChat(panel) (:444); sendChat(panel, text) (:456); real-engine panel fixtures (:407/:433 sidechatEngine arg); held-open + settle patterns at :919-:1050 and :1190-1196.
  gotcha: CHECK sendChat's body — if it calls the private path directly, ALSO drive the real key (`panel.handleInput("\r")` after `chatField.setText`) for at least one test; the PRD repro specifies the real enter key.

- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/P1M3T2S1/PRP.md
  why: PARALLEL CONTRACT (in flight, same function): it edits the command branch + doc list and explicitly leaves the else-branch to this task ("do NOT touch the else-branch") while scoping its doc claim to "the input clears on the command and empty paths". Merge doc text, never overwrite.
  critical: if its code hasn't landed, typecheck/test sequencing may interleave — keep this task's diff confined to the send branch + tail restructure + doc paragraph so both land cleanly.

- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/architecture/sidechat-engine.md
  why: §BUG-006 — the verified defect writeup (sendChatInput clears on EVERY path; engine refuses while streaming). Authority for the fix shape.

- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/P1M4T1S1/research/research-notes.md
  why: verbatim current source of the branch, engine contract excerpt, harness line anchors, and the S1 coordination rules.
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
  panel.ts            # MODIFY: sendChatInput send branch + tail + doc block
  ac-sidechat.test.ts # MODIFY: refusal-preservation tests (PRD repro + settle re-send)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: optional chain — `this.sidechatEngine?.sendTurn(text)` is
// `boolean | undefined`; capture as `?? false` or the always-clear bug
// survives in the engine-less configuration.
// GOTCHA: the tail `this.chatField.setText("")` runs for command + empty
// paths only after the restructure — an early `return` after invalidate()
// in the refused branch is an acceptable shape too; pick the one that keeps
// the doc comment's numbered list honest.
// GOTCHA: enter is STILL consumed on refusal (the branch returns true) —
// do not "fix" that into forwarding; a forwarded enter would hit
// pendingConfirm routing (M1.T1.S2) with a NON-empty buffer, which is fine,
// but the contract here is consume-and-preserve.
// GOTCHA: doc-block merge with P1.M3.T2.S1 (parallel) — read the landed
// block first; keep its abort/notify wording; scope claims per path.
// GOTCHA: don't queue the message (no buffering in panel state) — keep is
// the chosen PRD remedy; queueing would need new lifecycle the plan
// deliberately avoids ("no queueing" is the engine's own rule).
// GOTCHA: flash() is the ONLY sanctioned notice seam; no ctx.notify, no
// sidechatNotify (that is the usage-close notice channel — different bug).
```

## Implementation Blueprint

### Data models and structure

None — behavior-only fix inside an existing private method.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/panel/panel.ts — sendChatInput send branch
  - CAPTURE: const sent = this.sidechatEngine?.sendTurn(text) ?? false;
  - CLEAR: chatField.setText("") only when sent (inside the branch); restructure so the tail clear covers command + empty paths only (or early-return shape — keep the doc list accurate)
  - OPTIONAL: this.flash("reply in flight — esc aborts") on !sent, ONLY if it reads cleanly in the chat view; drop if awkward
  - REWRITE doc block path-2 wording + tail paragraph ("clears on every ACCEPTED path"); MERGE with P1.M3.T2.S1's command wording if landed, else leave a // P1.M3.T2.S1: note
  - PRESERVE: command branch (S1's), empty-buffer pendingConfirm routing (M1.T1.S2's), consume-ness, invalidate() call ordering

Task 2: EDIT src/panel/ac-sidechat.test.ts — the PRD repro + variants
  - TEST A (repro): openChat; send a message over gatedStream() (streamState "streaming"); chatField.setText("follow-up question"); panel.handleInput("\r"); expect chatField.getText() === "follow-up question", getSidechatRecord().messages has NO new user turn, streamState === "streaming", enter consumed
  - TEST B (settle → re-send): continue A — release the gate (terminal event, flush to idle); handleInput("\r") again; expect messages gained the follow-up user turn, chatField.getText() === ""
  - TEST C (no live record): engine configured so getRecord() is undefined (chat never opened / reset) with focus chat + text → enter → buffer preserved, no throw (sendTurn false path)
  - TEST D (accepted send unchanged): idle stream → enter → turn sent, buffer cleared (guards against over-preserving)
  - TEST E (command/empty unchanged): "/clear" clears input; empty-buffer enter routes to pendingConfirm (or no-op) — regression guards only if not already pinned by existing tests (grep before adding)
  - FOLLOW pattern: ac-sidechat.test.ts fixtures (real createSidechatEngine, gatedStream, openChat/sendChat); drive the REAL key (handleInput("\r")) in A/B — if sendChat bypasses the key path, use the raw handleInput
  - NAMING: test_send_refused_mid_stream_preserves_buffer, ..._resends_after_settle, etc. (file's convention)

Task 3: GATES
  - RUN: npx vitest run src/panel/ac-sidechat.test.ts && npm run typecheck && npm test
```

### Implementation Patterns & Key Details

```ts
// Final shape (one clean variant):
private sendChatInput(): void {
  const text = this.chatField.getText();
  const command = classifyChatCommand(text);
  if (command !== null) {
    // ... P1.M3.T2.S1's abort+reset+notify (UNTOUCHED) ...
    this.chatField.setText("");
  } else if (text.trim().length > 0) {
    // BUG-006: refused turn preserves the draft (R4 spirit). The engine
    // refuses on no-live-record or streamState !== "idle"; re-press enter
    // after settle, or esc-abort the stream first.
    const sent = this.sidechatEngine?.sendTurn(text) ?? false;
    if (sent) this.chatField.setText("");
    else this.flash("reply in flight — esc aborts"); // optional polish
  } else {
    this.chatField.setText(""); // empty no-op still normalizes the buffer
  }
  this.invalidate();
}
```

### Integration Points

```yaml
PANEL (panel.ts): send branch + doc only; enter-branch consume behavior unchanged
ENGINE (sidechat-engine.ts): UNTOUCHED — refusal contract already correct
PARALLEL P1.M3.T2.S1: same function, command branch — merge docs, disjoint code
SUCCESSOR P1.M6.T1: README §Side chat sync documents the preserved-on-refusal behavior
NO changes to: sidechat.ts, keys.ts, chat-view.ts, actions.ts, README
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck    # zero errors
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/ac-sidechat.test.ts -v
npm test             # full suite green (sidechat-engine.test.ts's boolean tests untouched)
```

### Level 3: Integration — SCRIPTED ONLY (AUTOMATION-POLICY)

The full PRD repro (held-open port, typed follow-up, enter mid-stream, settle, re-press) is assertable in vitest via gatedStream() — no live pi session, no mocks beyond the existing fake ports.

### Level 4: Domain-specific gates

```bash
# The unconditional clear is gone from the send path:
grep -n "sendTurn" src/panel/panel.ts   # the call captures its return; no bare fire-and-forget
# Optional flash is the only new UI surface (and only via flash()):
git diff src/panel/panel.ts | grep -c "notify\|setWidget\|new .*Component"  # → 0
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` + `npm test` green.
- [ ] Diff confined to panel.ts (send branch/tail/doc) + ac-sidechat.test.ts.

### Feature Validation (BUG-006 closed)

- [ ] PRD repro green: refused mid-stream enter preserves the buffer, sends nothing, stream continues.
- [ ] Post-settle re-press sends the follow-up and clears.
- [ ] No-live-record refusal preserves too; accepted send/command/empty paths unchanged.
- [ ] Optional flash (if kept) fires once per refusal via flash() only.

### Code Quality Validation

- [ ] Mode A doc comment accurate per-path and merged with S1's wording (no contradiction).
- [ ] No queueing machinery added; engine untouched; consume-ness unchanged.

### Documentation & Deployment

- [ ] README untouched (P1.M6.T1 owns §Side chat sync); doc-comment update recorded in code.

## Anti-Patterns to Avoid

- ❌ Don't ignore the boolean (`?.sendTurn(text)` without `?? false` captures undefined → bug survives in engine-less configs).
- ❌ Don't clear the buffer on refusal "for consistency" — preservation IS the fix.
- ❌ Don't touch the command branch, pendingConfirm routing, or the engine.
- ❌ Don't queue the message or build new UI for the notice — flash() or nothing.
- ❌ Don't forward a refused enter to the router — it stays consumed.
- ❌ Don't overwrite P1.M3.T2.S1's doc wording — merge.

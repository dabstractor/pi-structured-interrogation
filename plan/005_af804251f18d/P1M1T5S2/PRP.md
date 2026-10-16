---
name: "P1.M1.T5.S2 — Streaming consumption: deltas, stop reasons, abort, auth errors"
description: "Refine src/panel/sidechat-engine.ts's settle skeleton into full stream consumption: text deltas accumulate into record.streamingText (the view's polling buffer, refreshed from event.partial every event), done freezes the assistant ChatMessage (canonical join from done.message) with a pi-free ChatStopReason recorded on the message, aborted (error{reason:'aborted'} OR terminal stopReason 'aborted') fully rolls back the turn — pop the user message, no assistant record, no usage residue, no notice; other errors / sync auth throw append notice records with the user turn kept (chat stays usable); only completed replies ever land in record.messages so the parser structurally never sees partials. Additive sidechat.ts edit (streamingText + ChatStopReason + ChatMessage.stopReason?) stays @earendil-free. Tests extend sidechat-engine.test.ts with a fake async-iterable stream."
---

## Goal

**Feature Goal**: Own the consumption side of the injected nested-call port (SIDECHAT-001/002/005, PRD h3.9/h2.38): turn the S1 settle skeleton in `src/panel/sidechat-engine.ts` into a real streaming state machine — deltas accumulate into a polling buffer the view renders later (P1.M2.T1.S1), `done` freezes the assistant message with its stop reason, **aborted turns never happened** (partial text discarded, user turn rolled back, zero usage), every other failure surfaces as an in-view notice while the chat stays usable, and only completed replies become message records (the P1.M1.T6.S1 parser input).

**Deliverable**:
1. EDIT `src/panel/sidechat-engine.ts` — replace S1's settle skeleton with full consumption: for-await over the `AssistantMessageEventStream` (buffer ← join of `event.partial` text content per event), terminal routing per the stop-reason table below, full-rollback abort path, error/auth notice paths, promise-port branch; keep S1's contracts (fresh controller per turn, stable sessionId, sync-throw notice, guards) byte-intact.
2. ADDITIVE EDIT `src/panel/sidechat.ts` — `export type ChatStopReason` (pi-free string union), `ChatMessage.stopReason?: ChatStopReason`, `SidechatRecord.streamingText: string`, `buildFresh` initializes `streamingText: ""`; header block note.
3. EXTEND `src/panel/sidechat-engine.test.ts` — fake async-iterable stream harness; rows for happy-path delta→freeze, abort-via-error-event, abort-via-stopReason, other-error notice, auth-throw notice, parser-never-sees-partials, chat-still-usable-after-error.

**Success Definition**: All new rows + S1's rows green (`npx vitest run src/panel/sidechat-engine.test.ts`); `npx vitest run src/panel/` green; `npm test` green; `npm run typecheck` clean; banned-API grep clean; `grep "@earendil" src/panel/sidechat.ts` clean; no `cacheRetention` in the engine; no view rendering (M2.T1.S1), no usage tally (T5.S3), no answer-block parsing (T6.S1), no panel/key wiring (M2.T4.S1/T3.S1), no mid-stream close hooks (M2.T5.S1 — they call `abort()`).

## User Persona (if applicable)

**Target User**: The pi user side-chatting about one interrogation question (SIDECHAT-001).

**Use Case**: Type a question → `enter` → reply streams in (cursor animates off the buffer) → complete → frozen in the transcript; press `esc` mid-stream → the in-flight reply and its turn vanish as if never sent; provider/auth failure → a notice line, type again immediately.

**User Journey**: sendTurn → deltas flow → `streamingText` grows per event (view renders cursor) → done → transcript gains the assistant line; esc mid-stream → abort signal fires → transcript unchanged, state idle; auth error → one-line notice, next turn works.

**Pain Points Addressed**: Partial garbage freezing into the record on abort (turn-never-happened); stream errors blocking the panel (notices only); the parser reading half-streamed text (only completed replies freeze).

## Why

- SIDECHAT decisions (PRD h2.80, h3.9, h2.38 :552-556, :587): streaming cursor while in flight; esc aborts with "partial text discarded — the turn never happened"; malformed/stream errors → in-view notice, chat stays open; the parser takes the LAST ` ```answer ` block in a COMPLETED reply only; mid-stream close (M2.T5.S1) aborts + discards through this exact seam.
- Dependency chain: consumes S1's `sendTurn`/`abort` dispatch and the port contract (`plan/005_af804251f18d/P1M1T5S1/PRP.md` — treat as landed); produces the `streamingText` buffer + `streamState` transitions consumed by P1.M2.T1.S1 (streaming cursor) and the frozen assistant messages consumed by P1.M1.T6.S1 (parser); abort cleanliness guarantees T5.S3 has no phantom usage to tally.
- All pi-ai facts verified from `node_modules/@earendil-works/pi-ai/dist` (see research/findings.md).

## What

**Terminal routing table** (the whole task in one view — every terminal lands `streamState = "idle"` and clears `streamingText`):

| Terminal | Trigger | Assistant record | User turn | Notice | Usage residue |
|---|---|---|---|---|---|
| done (normal) | `done` event, stopReason ∈ stop/length/toolUse/deferred | FREEZE: join `done.message` text content, `stopReason` recorded on the ChatMessage | kept | none | message present (T5.S3 tallies it) |
| aborted | `error{reason:"aborted"}` OR terminal stopReason/reason `"aborted"` (event or resolved promise) | NONE | **POPPED** (full rollback) | NONE (deliberate esc) | none |
| other error | `error{reason ≠ "aborted"}`, or done with stopReason `"error"` (+`errorMessage?`) | NONE | kept | `{kind:"error", text}` | none |
| sync auth throw | port throws before returning a stream | NONE | kept | `{kind:"auth", text}` (S1, unchanged) | none |

1. **Delta accumulation**: on EVERY event, `record.streamingText = joinTextParts(event.partial.content)` (partial rides every event — cumulative, so the buffer is field-name-proof against delta payload variants). The view (M2.T1.S1) polls this while `streamState === "streaming"`; the engine renders nothing.
2. **Freeze**: the frozen `ChatMessage {role:"assistant", text, at: ISO, stopReason}` takes its text from `done.message` content (canonical), NOT the display buffer.
3. **Abort = the turn never happened**: remove the turn's user ChatMessage (pop the entry S1 appended at dispatch), leave no assistant record, clear the buffer, idle, no notice — the next turn's Context rebuilds clean with no dangling unanswered user turn.
4. **Errors never block**: notice records (S1's `SidechatNotice`) on the error/auth paths; the user turn stays visible; the very next `sendTurn` dispatches normally.
5. **Promise-port branch**: no events → buffer stays `""`; `await` the `AssistantMessage` and route by its `stopReason` through the same table.
6. **Parser isolation is structural**: partial text exists ONLY in `streamingText` (cleared on every settle); `record.messages` only ever gains completed assistant rows.

### Success Criteria

- [ ] Happy path: deltas update `streamingText` per event; done freezes `{role:"assistant", text: canonical join, stopReason:"stop"}`; buffer cleared; state idle
- [ ] Abort via `error{reason:"aborted"}`: user turn popped, no assistant row, buffer cleared, idle, zero notices
- [ ] Abort via terminal stopReason `"aborted"` (done event AND promise branch): identical rollback
- [ ] Other error event → `{kind:"error"}` notice; user turn kept; no assistant row; idle
- [ ] done with stopReason `"error"` → same as other error (text = `errorMessage ?? reason`), no freeze
- [ ] Sync auth throw → `{kind:"auth"}` notice (S1 row still green); no residue
- [ ] Parser never sees partials: mid-stream `record.messages` has no assistant entry; after abort none; after done exactly one with joined text
- [ ] Chat stays usable: after an error notice, a fresh `sendTurn` dispatches (port called again)
- [ ] S1's contracts unregressed: guards, fresh controller per turn, stable sessionId, context assembly, notice kinds
- [ ] Walls: banned-API grep CLEAN; `@earendil` absent from sidechat.ts; no `cacheRetention`; typecheck + suites green

## All Needed Context

### Context Completeness Check

This PRP carries the verified pi-ai event/stream shapes (AsyncIterable + `.result()`, `partial` on every event, terminal payloads), S1's exact landed seams (treated as contract), the landed store fields, the full terminal routing table with the rollback decision, and the test harness design. An implementer needs only the named files + this document.

### Documentation & References

```yaml
- file: plan/005_af804251f18d/P1M1T5S1/PRP.md
  why: "THE upstream contract: SidechatModelPort shape, createSidechatEngine skeleton, settle skeleton this task replaces, notice kinds, controller/sessionId rules, walls"
  critical: "do not regress any S1 success criterion; S2 refines ONLY the settle/consumption half"

- file: plan/005_af804251f18d/architecture/nested-llm-and-snapshot-seams.md
  why: "exact streamSimple/AssistantMessage/StopReason signatures, abort/auth semantics, cache-isolation rules"

- file: plan/005_af804251f18d/P1M1T5S2/research/findings.md
  why: "verified .d.ts facts (EventStream = AsyncIterable + result(): Promise, event union, partial-on-every-event), landed-input inventory, design decisions with rationale"

- file: src/panel/sidechat-engine.ts
  why: "S1's landed engine — the settle skeleton you replace; keep dispatch/guards/notice/auth paths intact"
  gotcha: "the skeleton joins partial text on done; S2 must freeze from done.message content instead and add the buffer + routing"

- file: src/panel/sidechat.ts
  why: "store to extend additively: ChatMessage(:49), ChatStreamState(:56), SidechatRecord(:92), buildFresh(:139); S1's SidechatNotice/notices land with S1"
  gotcha: "sidechat.ts must stay 100% @earendil-free — ChatStopReason is a hand-written string union, never imported from pi-ai"

- file: node_modules/@earendil-works/pi-ai/dist/types.d.ts
  why: "AssistantMessageEvent union (:410+): exact payload field names for text_delta/done/error — read before writing the for-await body"
  gotcha: "buffer refresh uses event.partial (cumulative) so code never depends on the delta field name"

- file: node_modules/@earendil-works/pi-ai/dist/utils/event-stream.d.ts
  why: "AssistantMessageEventStream = EventStream<AssistantMessageEvent, AssistantMessage>: AsyncIterable + result(): Promise<AssistantMessage> — the fake-stream harness mirrors this shape"

- file: plan/005_af804251f18d/architecture/sidechat-contracts.md
  why: "esc-ladder + notice semantics (:93-100), mid-stream close aborts (:41), empty/edge states"

- file: src/panel/sidechat-engine.test.ts
  why: "extend S1's harness: fake registry/port/notify, resetSidechatForTests() in beforeEach; ADD the fake async-iterable stream builder"
```

### Current Codebase tree (relevant slice)

```bash
src/panel/
├── sidechat.ts            # T3 store + S1 notices — EDIT (additive): streamingText, ChatStopReason, stopReason?
├── sidechat-engine.ts     # S1 (in flight → landed): dispatch + settle skeleton — EDIT: full consumption
├── sidechat-engine.test.ts# S1 tests — EXTEND: stream harness + routing rows
├── sidechat-prompt.ts     # T4.S2 (in flight) — untouched
└── branch-snapshot.ts     # T4.S1 landed — untouched
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# No new files. Edits only:
# src/panel/sidechat-engine.ts — delta loop, terminal routing, abort rollback, error/auth notices, promise branch
# src/panel/sidechat.ts        — additive: ChatStopReason, ChatMessage.stopReason?, SidechatRecord.streamingText, buildFresh "", header note
# src/panel/sidechat-engine.test.ts — new harness + rows
```

### Known Gotchas of our codebase & Library Quirks

```text
# CRITICAL: the abort path POPS the user ChatMessage ("the turn never happened") — without the
#   pop, the next turn's Context carries a dangling unanswered user turn after the snapshot.
#   Other-error paths KEEP it (the failure is visible; the chat stays usable). This asymmetry
#   is the contract — encode it as a Mode A comment at the routing site.

# CRITICAL: refresh the buffer from event.partial (joins of text content parts) — NEVER from
#   the delta payload field; partial is cumulative and rides every event, so the view buffer
#   is correct regardless of delta-field naming across pi-ai versions.

# CRITICAL: freeze from done.message content (canonical), not from streamingText — the buffer
#   is a DISPLAY artifact; the message record must match what the model actually produced.

# CRITICAL: sidechat.ts gains ZERO @earendil imports (M3.T1 guard precondition). ChatStopReason
#   omits "pending" (a terminal-only union — records never carry pending).

# GOTCHA: the stream is an AsyncIterable — consume with for-await; a terminal event ENDS the
#   iteration (EventStream completes). Do not call stream.result() in the event path (it is
#   the promise-fallback for callers without iteration; done.message is your result).

# GOTCHA: streamSimple throws SYNCHRONOUSLY on missing auth — the S1 try/catch around the port
#   call already covers it; S2 only guarantees no buffer/state residue on that path.

# GOTCHA: every terminal path must settle to idle and clear streamingText even when it throws
#   mid-iteration — wrap the consumption loop so an unexpected exception cannot strand
#   streamState === "streaming" (settle → notice {kind:"error"}).

# GOTCHA: banned identifiers (sendMessage|sendUserMessage|setActiveTools|registerTool|setModel)
#   must not appear in the engine — even in comments (discipline).

# GOTCHA: no cacheRetention anywhere; sessionId stays STABLE per record identity (S1) — the
#   consumption loop never touches sessionId or the controller.
```

## Implementation Blueprint

### Data models and structure

```typescript
// src/panel/sidechat.ts (additive, pi-free)
export type ChatStopReason = "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";
export interface ChatMessage { role: "user" | "assistant"; text: string; at: string;
  stopReason?: ChatStopReason; }            // assistant rows only carry stopReason
export interface SidechatRecord { /* S1 fields */ streamingText: string; }  // "" unless streaming

// src/panel/sidechat-engine.ts — consumption (inside createSidechatEngine's dispatch)
// joinTextParts(content): filter {type:"text"} parts, join their text — the ONLY text extractor
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/panel/sidechat.ts (additive — smallest change first)
  - ADD ChatStopReason union + ChatMessage.stopReason? + SidechatRecord.streamingText: string
  - EDIT buildFresh: streamingText: "" (the one record-creation path; resetChat inherits)
  - HEADER note: streamingText is the VIEW's polling buffer (M2.T1.S1 renders the cursor);
    aborted turns roll back the user turn (turn-never-happened); cite P1.M1.T5.S2
  - RUN: npx vitest run src/panel/sidechat.test.ts   # green unchanged

Task 2: EDIT src/panel/sidechat-engine.ts — the consumption loop (replaces S1's settle skeleton)
  - HELPERS: joinTextParts(content: AssistantMessage["content"]): string — {type:"text"} filter + join
  - STREAM branch (port returned an AsyncIterable):
      record.streamingText = "";                       // reset at dispatch
      for await (const ev of stream):
        if (ev.partial) record.streamingText = joinTextParts(ev.partial.content);  // every event
        if (ev.type === "done")     → route(ev.message.stopReason, ev.message, ev.reason)
        if (ev.type === "error")    → ev.reason === "aborted" ? routeAbort() : noticeError(String(ev.error))
      // loop end without a terminal (stream closed early) → settle: notice {kind:"error"}, idle
  - PROMISE branch (port returned a Promise<AssistantMessage>):
      const msg = await promise; route(msg.stopReason, msg, msg.stopReason)
  - ROUTE(stopReason, message, reason):
      "aborted"                                    → routeAbort()
      "error"                                      → noticeError(message.errorMessage ?? String(reason ?? "stream error"))  // no freeze
      stop|length|toolUse|deferred                 → freeze(message)
  - routeAbort(): record.messages.pop() ONLY if the tail is THIS turn's user entry (defensive:
      compare reference captured at dispatch); streamingText = ""; no assistant; no notice; idle
  - freeze(message): push ChatMessage {role:"assistant", text: joinTextParts(message.content),
      at: new Date().toISOString(), stopReason: message.stopReason as ChatStopReason};
      streamingText = ""; idle   // usage untouched — T5.S3's tally, fed by the frozen message
  - noticeError(text)/auth: record.notices.push({kind, text, at}); streamingText = ""; idle
  - WRAP the whole consumption in try/catch: any unexpected throw → notice {kind:"error"} + settle idle
  - KEEP S1 intact: dispatch guards, fresh AbortController, sessionId stability, context assembly
  - RUN: npm run typecheck

Task 3: EXTEND src/panel/sidechat-engine.test.ts — harness + rows
  - HARNESS: fakeAssistantMessage(overrides) builder; fakeStream(events[]) returning an object
    with [Symbol.asyncIterator] yielding scripted events (each carrying partial) and ending
    after the terminal; fakePromisePort resolving an AssistantMessage; reuse S1's openOrReplace
    fixture deps {resolveModelSnapshot, buildSystemPrompt, buildBranchSnapshot}
  - ROW happy: [start, text_delta(partial "He"), text_delta(partial "Hello"), done{stopReason:"stop",
      message content [{type:"text",text:"Hello world"}]}] → during iteration streamingText hits
      "He" then "Hello" (assert via a port stub that snapshots record.streamingText per event);
      after: exactly one assistant row {text:"Hello world", stopReason:"stop"}; streamingText "";
      state idle; messages = [user, assistant]
  - ROW abort-error-event: [text_delta(partial "par"), error{reason:"aborted", error:…}] →
      messages = [] (user POPPED), streamingText "", idle, notices [], no assistant row
  - ROW abort-done-stopReason: done{stopReason:"aborted"} → identical rollback (messages popped)
  - ROW abort-promise-branch: promise port resolves AssistantMessage{stopReason:"aborted"} → rollback
  - ROW other-error-event: error{reason:"rate_limited"} → messages keeps user; notices gains
      {kind:"error"}; no assistant; idle; streamingText ""
  - ROW done-stopReason-error: done{stopReason:"error", errorMessage:"boom"} → notice
      {kind:"error", text:"boom"}; no freeze
  - ROW auth-throw (S1's, re-verified): sync-throwing port → {kind:"auth"}; state idle
  - ROW parser-never-sees-partials: mid-stream (before terminal) record.messages has NO
      assistant row; after abort none; after done exactly one
  - ROW usable-after-error: following the other-error row, sendTurn("again") → port called again,
      happy freeze lands
  - ROW defensible-pop: abort with a message tail that is NOT this turn's user entry (simulate
      by discarding mid-turn) → pop is skipped, no crash (defensive branch)
  - RUN: npx vitest run src/panel/sidechat-engine.test.ts

Task 4: VALIDATE walls + full gates
  - npx vitest run src/panel/ ; npm test ; npm run typecheck
  - grep -nE "sendMessage|sendUserMessage|setActiveTools|registerTool|setModel" \
      src/panel/sidechat-engine.ts src/panel/sidechat.ts || echo CLEAN
  - grep -n "@earendil" src/panel/sidechat.ts || echo CLEAN
  - grep -n "cacheRetention" src/panel/sidechat-engine.ts || echo CLEAN
```

### Implementation Patterns & Key Details

```typescript
// PATTERN — the terminal router (one function, every path settles idle + clears the buffer):
function route(stopReason: StopReason | undefined, message: AssistantMessage | undefined, rawReason?: string): void {
  record.streamingText = "";
  record.streamState = "idle";
  if (stopReason === "aborted" || rawReason === "aborted") return rollbackTurn();   // turn never happened
  if (stopReason === "error") return pushNotice("error", message?.errorMessage ?? String(rawReason ?? "stream error"));
  if (message) freezeAssistant(message);                                            // stop|length|toolUse|deferred
}
// rollbackTurn: pop the tail IF it is this turn's user entry (reference captured at dispatch) —
//   no assistant record, no notice, nothing for T5.S3 to tally. Asymmetric with error paths
//   (they KEEP the user turn: the failure is visible; the chat stays usable).

// CRITICAL: settle-idle + clear-buffer happens FIRST in route() so no path can strand "streaming".
// CRITICAL: streamingText refresh uses ev.partial (cumulative) — never the delta field name.
```

### Integration Points

```yaml
RUNTIME: NONE this task — engine stays unwired (M2.T4.S1 opens the view; M2.T3.S1 routes enter/esc)
CONSUMED NEXT:
  - P1.M2.T1.S1: renders record.streamingText + streamState (cursor) and the footer "abort" hint
  - P1.M1.T6.S1: parses record.messages assistant rows (completed only) for the ```answer block
  - P1.M1.T5.S3: tallies usage off the frozen messages; aborts contribute nothing (no record)
  - P1.M2.T5.S1: mid-stream close hooks call engine.abort() → this task's rollback fires
PIPelines: none — no config, no keys, no banned APIs
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck        # tsc --noEmit strict — zero errors (repo gates: typecheck + vitest only)
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/sidechat-engine.test.ts -v   # S1 rows + all new routing rows green
npx vitest run src/panel/sidechat.test.ts             # store rows green (additive fields)
```

### Level 3: Integration (scripted only — no live TUI, no provider; the fake port IS the seam)

```bash
npx vitest run src/panel/     # whole panel tree green
npm test                      # full suite green
```

### Level 4: Domain-Specific (cache-isolation + scope walls)

```bash
grep -nE "sendMessage|sendUserMessage|setActiveTools|registerTool|setModel" \
  src/panel/sidechat-engine.ts src/panel/sidechat.ts || echo CLEAN   # SIDECHAT-005
grep -n "@earendil" src/panel/sidechat.ts || echo CLEAN              # store purity (M3.T1 precondition)
grep -n "cacheRetention" src/panel/sidechat-engine.ts || echo CLEAN  # no one-shot pattern
git diff --stat   # ONLY sidechat-engine.ts, sidechat.ts, sidechat-engine.test.ts
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1: typecheck clean
- [ ] Level 2: engine + store suites green
- [ ] Level 3: `npx vitest run src/panel/` + `npm test` green
- [ ] Level 4: three greps CLEAN; diff walls hold (3 files only)

### Feature Validation

- [ ] Routing table fully covered: freeze / abort-rollback (3 trigger shapes) / other-error / done-error / auth-throw
- [ ] streamingText: reset at dispatch, refreshed per event, cleared on every settle
- [ ] Abort pops this turn's user entry (defensively reference-checked); no assistant row; no notice; no usage residue
- [ ] Errors keep the user turn + push notices; next sendTurn dispatches
- [ ] Parser isolation asserted (no assistant rows mid-stream/after abort; exactly one after done)
- [ ] stopReason recorded on frozen rows (pi-free union); "pending" never stored

### Code Quality Validation

- [ ] S1's contracts unregressed (guards, controller/sessionId, assembly, notice kinds)
- [ ] Engine renders nothing (view is M2.T1.S1's); parses nothing (T6.S1's); tallies nothing (T5.S3's)
- [ ] Mode A comments cite SIDECHAT-002/003/005 + P1.M1.T5.S2 + the rollback asymmetry rationale
- [ ] sidechat.ts remains @earendil-free; no banned identifiers anywhere in the two modules

### Documentation & Deployment

- [ ] Mode A only — sidechat.ts header note covers the consumption contract (task contract: "DOCS: none — header block from S1 covers it"); no README/config changes (M3.T3.S1 owns docs)

---

## Anti-Patterns to Avoid

- ❌ Don't freeze from streamingText — done.message is canonical; the buffer is display-only
- ❌ Don't derive the buffer from delta payload fields — event.partial is cumulative and version-proof
- ❌ Don't keep the aborted user turn "for context" — "the turn never happened"; a dangling user turn corrupts the next Context rebuild
- ❌ Don't push a notice on abort — the user pressed esc deliberately; silence is the contract
- ❌ Don't tally, parse, render, or wire — T5.S3 / T6.S1 / M2.T1.S1 / M2.T3.S1 / M2.T4.S1 own those halves
- ❌ Don't touch sessionId/controllers in the consumption loop, and never set cacheRetention
- ❌ Don't let any path exit without settling idle + clearing the buffer (wrap the loop)
- ❌ Don't regress S1's rows while refining the skeleton — refine means replace the settle half, keep the dispatch half

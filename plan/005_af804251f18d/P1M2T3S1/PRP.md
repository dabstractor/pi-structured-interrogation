# PRP — P1.M2.T3.S1: Chat-view routing branches, enter interception, streaming-abort esc rung

---
name: "P1.M2.T3.S1 — Routing branches, enter interception, and the streaming-abort esc rung (SIDECHAT-001 chat-view input contract)"
description: "Wire the chat view into input routing: (a) keys.ts fixed ↑/↓ gain a `panel.view === 'chat'` branch routing to transcript scroll (chatScroll offset via clampChatScroll); (b) panel.handleInput's chat-focus enter branch (the interim seam P1.M2.T2.S1 left) becomes real: classifyChatCommand first (/clear //new → resetChat), else sendTurn(text) + clear the chat input; while pendingConfirm shows and focus is NOT in the chat editor, enter applies (P1.M2.T6.S1's handler — stub no-op here) and esc declines; (c) esc ladder escapeDescend gains a chat rung: streaming → engine.abort() (engine discards the partial by construction), idle → exit the view back to the PRIOR view (chat record retained; setView only — never touch the singleton); (d) bare `e` (keys.chat) stays TIER-2 — forwards while ANY editor holds focus including the chat editor (keys.test.ts:751 pin carries); (e) verify ctrl+c close flow + ripple CONFIRM-MODE modal coexist with the chat view. Tests on ROUTING, not apply semantics. Mode A keys.ts module docs: chat dispatch + two-tier note + esc-ladder chat rung."
---

## Goal

**Feature Goal**: The chat view (SIDECHAT-001) gets its complete input contract: transcript scrolling on ↑/↓, enter-to-send with `/clear`·`/new` classification (h2.38), pendingConfirm enter/esc routing (consumer is P1.M2.T6.S1 — stubbed here), a new esc-ladder rung (`chat + streaming → abort`; `chat + idle → exit view, transcript retained`), bare-`e` tier-2 forwarding in chat-editor focus, and verified ctrl+c / CONFIRM-MODE coexistence.

**Deliverable**: Modified `src/panel/keys.ts` (fixed-key branches + escapeDescend rung + module JSDoc) and `src/panel/panel.ts` (chat-focus enter branch replaces the interim seam; pendingConfirm enter/esc routing; engine seam), plus tests in `src/panel/keys.test.ts` and `src/panel/panel.test.ts`.

**Success Definition**: `npm test` + `npm run typecheck` green; scripted: ↑/↓ scroll the chat transcript only in the chat view; enter in chat-editor focus sends a turn (or resets on `/clear`//`/new`) and never reaches accept/saveTextDraft/writeInEnter; esc while streaming aborts (user turn popped by the engine) and a second esc exits the view; esc while idle exits directly; pendingConfirm + options-focus enter routes to the apply seam stub and esc declines; bare `e` types into the chat editor; ctrl+c still suspends-and-stays-unconsumed from the chat view; the ripple CONFIRM-MODE modal ordering is unaffected by the chat view.

## User Persona

**Target User**: The TUI user in a per-question side chat (`e`, SIDECHAT-001) — talking to the side model without leaving the panel.

**Use Case**: open chat → type → enter → watch the stream → esc to abort a rambling reply → esc again to return to the question; or let it finish and apply/decline the suggested answer from the confirm row.

**User Journey**: `e` on a question → chat view + focused chat input → type, enter (sends) → streaming → esc (abort, transcript rolls the turn back) → esc (back to the question view, chat retained for `e` to reopen).

**Pain Points Addressed**: no input contract for the new view; esc ambiguity (abort vs exit vs suspend); enter must NEVER answer a question from the chat input.

## Why

- h2.38 Side chat + h3.9 Side chat flow: chat is a panel view with its own key semantics; enter sends, esc aborts-then-exits.
- Consumes: chat-view render (P1.M2.T1.S1/S2 — `clampChatScroll`, `ChatViewState`, confirm row), chat editor focus discipline (P1.M2.T2.S1 — `PanelFocus "chat"`, `chatField`, the interim enter seam in handleInput), `classifyChatCommand`/`resetChat`/`clearPendingConfirm` (sidechat.ts:325/:473/:634), engine `sendTurn`/`abort`/`streamState` (sidechat-engine.ts:244 — still UNWIRED; this item provides the routing, the open path is P1.M2.T4.S1).
- Feeds: P1.M2.T4.S1 (PanelView "chat" union + setView seeding — routing branches reference `view === "chat"`), P1.M2.T6.S1 (the real apply handler — this item's enter branch delegates to a stubbed seam).
- keys.test.ts:751 pins the bare-`e` letter-vs-letter collision resolution — the chat editor must not regress the tier-2 forwarding family.

## What

### Exact behaviors

**(a) keys.ts fixed ↑/↓ — chat branch.** In `route()`'s step 1 (keys.ts:442-455): while `panel.view === "chat"` AND focus is NOT the chat editor, ↑/↓ adjust the transcript scroll (`panel.chatScrollOffset ± 1` clamped via `clampChatScroll(totalLines, offset)` from chat-view.ts:178 — totalLines from the render state; keep a small `chatScrollUp/Down(panel)` helper pair in actions.ts or panel.ts mirroring `overviewUp/overviewDown`). While the CHAT editor holds focus, ↑/↓ FORWARD to it (same editorFocused exception — the `editorFocused` flag at keys.ts:434 must include `focus === "chat"` for arrows, see (d)). `k`/`j` aliases follow the same branch structure as existing.

**(b) panel.handleInput — chat-focus enter + pendingConfirm.** P1.M2.T2.S1's handleInput chat branch intercepts enter with an interim "consumed" seam. Replace it:
- `focus === "chat"` + enter: read `this.chatField` buffer text —
  1. `classifyChatCommand(text)` (sidechat.ts:325) returns `"/clear"` or `"/new"` → `resetChat(questionId, deps)` (sidechat.ts:473; deps = the same SidechatRebindDeps the open path uses — a panel-held seam, see Integration) ; clear the field; consumed.
  2. else non-empty text → `engine.sendTurn(text)` (returns boolean; a `false` while already streaming is the engine's own guard — consume anyway); clear the field; consumed.
  3. empty text → consumed no-op (never forwards, never answers).
  NEVER reaches `accept`/`saveTextDraft`/write-in enter (S2.S1's core invariant — keep it).
- `pendingConfirm` is set (sidechat record's) AND `panel.focus !== "chat"` (the confirm row is interactive while focus is outside the editor): enter → call the apply seam `onApplyConfirm?.(decision)` — a nullable panel field/method P1.M2.T6.S1 will implement; here it defaults to a no-op stub (declared, never throwing). esc → decline: `clearPendingConfirm(record)` (sidechat.ts:634). Keep tests on ROUTING (which handler fired), not apply semantics.
- Ordering in the handleInput ladder: this enter branch sits where S2.S1's interim seam sits (before the router); the existing ctrl+c rung (panel.ts:762-773) and CONFIRM-MODE CHECK must stay AHEAD of or correctly interleaved with the chat branches — verify (e).

**(c) esc ladder — chat rung.** In `escapeDescend` (keys.ts:276-283), BEFORE the existing branches:
```ts
if (panel.view === "chat") {
  if (engine/streamState === "streaming") { engine.abort(); return; } // partial discarded by the engine
  panel.setView(panel.chatReturnView ?? "short"); // exit; record retained, singleton untouched
  return;
}
```
- `streaming` read from the live sidechat record (`get()?.streamState === "streaming"`) — the abort is fire-and-forget; the engine's route() pops the aborted turn (verified: sidechat-engine.ts "aborted = the turn never happened").
- Exit sets the view back to the PRIOR view WITHOUT touching the singleton (no `discard()` — that is P1.M2.T5.S1's hook at state-mutation seams). `chatReturnView` is a small panel field the OPEN path (P1.M2.T4.S1) seeds (`view before entering chat`); this item defines/reads it with a `"short"` fallback. NOTE: `setView` away from chat already blurs chat focus (S2.S1 contract).
- Esc while the CHAT EDITOR holds focus: unchanged ESC-002 semantics (single esc forwards to the editor; double-esc closes the box) — the chat rung lives in escapeDescend which only runs from NON-editor focus; confirm the editorFocused guard at keys.ts:493 covers `focus === "chat"` (it checks text/note — extend it).

**(d) Bare `e` — TIER-2 in chat-editor focus.** The `editorFocused` flag (keys.ts:434) currently `focus === "text" || focus === "note"`. Extend to include `"chat"` so: bare bindings (incl. `b.chat` = `e`) forward (`return false` → the byte types into the chat editor), chords still intercept, and the fixed arrows/esc forwarding exceptions apply uniformly. keys.test.ts:751's collision pin must keep passing.

**(e) ctrl+c + CONFIRM-MODE coexistence.** Verify (tests): ctrl+c from ANY chat state (chat view focus, chat editor focus, pendingConfirm showing) runs the existing close flow — `suspend()` + return unconsumed (panel.ts:762-773, CTRL-C-001) — BEFORE any chat branch; and the ripple CONFIRM-MODE modal (the `confirmRippleEdit` state in handleInput's ladder) still takes precedence over chat-view branches when a ripple modal is open. No behavior change expected — pin it with tests.

### Success Criteria

- [ ] ↑/↓ in chat view scroll the transcript (clamped); in chat-editor focus they forward to the editor
- [ ] Enter in chat focus: `/clear`//`/new` → resetChat + field cleared; text → sendTurn + field cleared; empty → consumed no-op; NEVER answers a question
- [ ] pendingConfirm + non-chat focus: enter → apply seam stub fires; esc → clearPendingConfirm
- [ ] Esc ladder: chat+streaming → abort only (turn rolled back, view retained); chat+idle → exit to prior view, singleton untouched; deeper ladder unchanged
- [ ] Bare `e` types into the chat editor; keys.test.ts:751 pin green
- [ ] ctrl+c suspends-and-stays-unconsumed from every chat state; ripple modal precedence unaffected
- [ ] No DraftStore/draftSlots/history interaction from any chat-input path (S2.S1 invariant)

## All Needed Context

### Context Completeness Check

An implementer needs: the current keys.ts routing structure with line anchors, S2.S1's chat-focus contract, the sidechat store/engine API surface, the esc-ladder and handleInput ladders, and the test harness. All below.

### Documentation & References

```yaml
- file: plan/005_af804251f18d/P1M2T2S1/PRP.md
  why: THE upstream contract — second TextField (chatField), PanelFocus "chat", focusChatInput/blurChatInput (no-op off-chat), setView-away blurs chat focus, handleInput chat branch with the INTERIM enter seam this item replaces, "enter never reaches accept/saveTextDraft/writeInEnter"
  gotcha: if S2.S1 hasn't landed when you start, land your changes behind it — the chat-focus branch sites are defined by its PRP

- file: plan/005_af804251f18d/architecture/panel-view-integration.md
  why: the architecture ruling this contract cites — fixed keys are view-aware branches (keys.ts:433-505); esc ladder has NO streaming-abort precedent (chat rung is new); ENTER INTERCEPTED AT PANEL LEVEL in handleInput BEFORE the router (~panel.ts:725-830); ctrl+c and CONFIRM-MODE ordering must be revisited for the chat view

- file: src/panel/keys.ts
  why: THE main edit site — editorFocused flag :434; fixed ↑/↓ :442-455; fixed ←/→ :465-480; esc + escapeDescend/escExitEditor :487-510 (ladder def :276-283); fixed enter :513-518; two-tier config intercepts + bare.chat :525-575; module JSDoc two-tier rules :22-51
  pattern: every branch returns boolean (true=consumed, false=forward to editor); follow the existing view-branch style verbatim

- file: src/panel/panel.ts
  why: handleInput ladder :724-830 (resolved guard → ctrl+c :762-773 → CONFIRM-MODE → enter interception); PanelView :108 (union — "chat" lands via P1.M2.T4.S1; if not yet present, coordinate: add the union member as a minimal type extension ONLY if T4.S1 hasn't, flagged in the PR notes); setView :1053; suspend :1002; isResolved :1044
  gotcha: enter interception precedes the router — the chat enter branch goes THERE, not in keys.ts

- file: src/panel/sidechat.ts
  why: store API — classifyChatCommand :325, resetChat(questionId, deps) :473, clearPendingConfirm(record) :634, get() :267, SidechatRecord (streamState, pendingConfirm ApplyDecision, messages), SidechatRebindDeps :211
  gotcha: resetChat needs deps (branch snapshot etc.) — panel-held seam; if not yet wired by T4.S1, inject via constructor arg with a test double

- file: src/panel/sidechat-engine.ts
  why: createSidechatEngine(deps) :244 returns { sendTurn(text): boolean, abort(): void } — UNWIRED export (its own doc says routing lands here); abort semantics verified in route(): aborted turn popped, streamState reset
  pattern: engine instance is panel/host-held; this item calls it, does not construct it (constructor seam / nullable field with a default no-op double)

- file: src/panel/chat-view.ts
  why: clampChatScroll(totalLines, scrollOffset) :178; ChatViewState :143 (pendingConfirm?/scroll fields); buildChatContent :200 (the S1 extras: notices, confirm row); "CONSUMERS: P1.M2.T3.S1 routes enter/esc when pendingConfirm is set" (:69)
  pattern: scroll helpers mirror overviewUp/overviewDown (actions.ts)

- file: src/panel/keys.test.ts
  why: harness — makeActions/makePanel (:63/:137), route(data, panel) assertions, the :751 bare-`e` letter-collision pin (deep `e` beats chat `e`); collision/tier test style to follow for the chat branches
  gotcha: fixed arrows are ESC-prefixed bytes — use matchesKey(Key.up) fixtures like existing tests

- file: src/panel/panel.test.ts
  why: handleInput ladder tests (ctrl+c precedence, confirm-mode ordering) — follow their synthetic-key fixtures; S2.S1's chat-focus tests live here too
```

### Current Codebase tree (relevant slice)

```bash
src/panel/
  keys.ts            # EDIT — chat ↑/↓ branch, editorFocused extension, esc-ladder chat rung, module JSDoc
  panel.ts           # EDIT — chat-focus enter branch (classify/send), pendingConfirm enter/esc, engine + chatReturnView seams
  sidechat.ts        # read-only API (classifyChatCommand, resetChat, clearPendingConfirm, get)
  sidechat-engine.ts # read-only API (sendTurn, abort)
  chat-view.ts       # read-only API (clampChatScroll, ChatViewState)
  actions.ts         # EDIT (small) — chatScrollUp/Down helpers if placed here
  keys.test.ts       # EDIT — routing tests
  panel.test.ts      # EDIT — enter/esc/pendingConfirm/ctrl+c tests
```

### Desired Codebase tree

```bash
# no new files
```

### Known Gotchas

```ts
// CRITICAL: enter interception order — the chat-focus enter branch lives in
// panel.handleInput BEFORE the router (the WRITEIN-001 machinery site,
// ~panel.ts:725-830). keys.ts's fixed-enter branch (:513) can never see it.

// CRITICAL: escapeDescend only runs from NON-editor focus; the chat rung's
// streaming-abort is the OPTIONS-focus esc path. While the CHAT EDITOR is
// focused, esc stays ESC-002 (single forwards, double closes the box) —
// extend the editorFocused guard to include "chat" so that stays true.

// CRITICAL: bare keys must TYPE in the chat editor — extend editorFocused
// (:434) to include focus === "chat" for every tier-2 check, not just chat.

// abort() is fire-and-forget: the engine settles asynchronously (pops the
// aborted turn). Do NOT synchronously mutate the record after abort; the
// view re-renders from the settled state.

// resetChat needs SidechatRebindDeps (branch snapshot machinery) — obtain
// from the panel's open-path seam; if P1.M2.T4.S1 hasn't landed, inject a
// nullable deps field and default the enter branch to a graceful no-op
// under test doubles (tests supply fakes).

// "chat" may not be in PanelView yet (T4.S1) — coordinate; do not build a
// shadow enum. If unavoidable, add the union member minimally and flag it
// for T4.S1 to own.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: READ landed state
  - READ keys.ts :425-575 (routing), :276-283 (ladder); panel.ts handleInput :724-830, setView :1053; S2.S1's landed chat-focus code (chatField/focus seams); sidechat.ts + sidechat-engine.ts API exports; chat-view.ts ChatViewState/clampChatScroll
  - CONFIRM: whether PanelView "chat" and the chatField seams exist yet (parallel S2.S1 / planned T4.S1); choose injection points accordingly

Task 2: MODIFY src/panel/keys.ts
  - editorFocused := focus ∈ {text, note, chat}
  - ↑/↓ step-1: panel.view === "chat" && !chatEditorFocused → chatScrollUp/Down (new helpers, clampChatScroll)
  - escapeDescend: chat rung FIRST (streaming → abort; idle → setView(chatReturnView ?? "short"), singleton untouched)
  - (fixed ←/→ and enter branches: verify no chat special-casing needed — chat view + options focus enter is consumed by the pendingConfirm routing in panel.ts; document)
  - Mode A module JSDoc: chat dispatch, two-tier note (chat editor types bare keys), the esc-ladder chat rung

Task 3: MODIFY src/panel/panel.ts
  - Replace the interim chat-focus enter seam: classifyChatCommand → resetChat | sendTurn | empty no-op; clear chatField after send/reset
  - pendingConfirm routing (non-chat focus): enter → onApplyConfirm stub (nullable seam, P1.M2.T6.S1 owns the real handler); esc → clearPendingConfirm
  - Engine + SidechatRebindDeps seams (nullable fields / constructor opts with test doubles); chatReturnView field (T4.S1's open path seeds it; "short" fallback)
  - Verify ladder placement relative to ctrl+c (:762) and CONFIRM-MODE; add ordering comments

Task 4: ADD tests
  - keys.test.ts: chat-view ↑/↓ scroll branch (clamped at ends); ↑/↓ forward in chat-editor focus; esc from chat+streaming (fake engine.streamState) → abort called once, view unchanged; esc chat+idle → setView(returnView), get() record still present (singleton untouched); bare `e` in chat focus → route returns false; :751 collision pin re-run
  - panel.test.ts: enter in chat focus — "/clear" and "/new" → resetChat called (fake deps), field cleared; plain text → sendTurn called with the text, field cleared; empty → consumed, nothing called; enter NEVER triggers accept/answer state changes; pendingConfirm + options focus: enter → apply stub fired, esc → clearPendingConfirm; ctrl+c from chat view/editor/pendingConfirm → suspend called, returns unconsumed; ripple CONFIRM-MODE modal open in chat view → modal precedence preserved
  - All via the existing makeActions/makePanel doubles; no mocks beyond the suite conventions (fake engine = {sendTurn: vi.fn(()=>true), abort: vi.fn()} style seam doubles, consistent with existing fake-factory use)

Task 5: RUN validation; fix until green
```

### Integration Points

```yaml
ENGINE SEAM:
  - engine: { sendTurn(text): boolean; abort(): void } | undefined — panel-held, host-wired (T4.S1/P1.M2.T5 seams may relocate the wiring); tests inject doubles
  - streamState read live via sidechat.get()?.streamState — never cached

APPLY SEAM:
  - onApplyConfirm(decision): void — nullable stub; P1.M2.T6.S1 replaces with the real acceptOptionIndex / write-in-commit routing. This item's tests assert the stub FIRES, not apply semantics.

VIEW SEAM:
  - PanelView "chat" + setView seeding + open path: P1.M2.T4.S1. chatReturnView is this item's field, T4.S1's open path writes it.

CONFIG: none — no new keys (chat key exists; bare tier already resolved).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # expected: zero errors
```

### Level 2: Unit Tests

```bash
npm test
npx vitest run src/panel/keys.test.ts src/panel/panel.test.ts -v
# Expected: new routing tests pass; :751 pin green; S2.S1's chat-focus tests unaffected
```

### Level 3: Scenario walkthrough (once T4.S1 lands; unit-level before then)

```bash
pi -e .
# e on a question → chat view → type "why sqlite?" + enter → streaming → esc (abort; turn gone) → esc (back to question) → e again (transcript retained)
# /clear + enter → fresh chat; /new + enter → fresh chat
# let a reply with an answer block finish → confirm row → enter applies / esc declines (stub until T6.S1)
# ctrl+c anywhere in chat → prompt closes, pi's ctrl+c flow resumes
```

### Level 4: Regression sweep

```bash
npx vitest run   # full suite — esc ladder, ESC-002, tier tests, keymap-ac, no-hardcoded-keys
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean; `npm test` green

### Feature Validation

- [ ] ↑/↓ scroll routing per focus (view vs chat editor)
- [ ] Enter classification order: /clear|/new → text → empty; never answers
- [ ] Esc sequencing: abort-then-exit; idle exit; ESC-002 intact in editor focus
- [ ] Bare `e` forwards in chat-editor focus; :751 pin green
- [ ] ctrl+c + CONFIRM-MODE coexistence pinned by tests
- [ ] Apply branch is routing-only (stub fires; semantics deferred to T6.S1)

### Code Quality Validation

- [ ] No new files; keys.ts/panel.ts (+helpers in actions.ts) + tests only
- [ ] Mode A JSDoc: chat dispatch, two-tier note, esc-ladder chat rung
- [ ] No DraftStore/draftSlots/history interaction from chat paths
- [ ] Anti-patterns avoided: no synchronous post-abort mutation, no shadow PanelView enum

## Anti-Patterns to Avoid

- ❌ Letting chat-input enter reach accept/saveTextDraft/writeInEnter (S2.S1's disqualifying invariant)
- ❌ Wiring the engine/apply logic here (routing only — T4.S1 owns open, T6.S1 owns apply, T5.S1 owns discard)
- ❌ Extending editorFocused for SOME bare keys but not others (uniform "chat" inclusion)
- ❌ Mutating the sidechat record after abort() (the engine settles asynchronously)
- ❌ Discarding the singleton on esc-exit (retention is the contract; discard is T5.S1)
- ❌ Hardcoding view names where setView/PanelView exist (except the unavoidable "chat" literals mirroring existing style)

---

**Confidence Score**: 8/10 — routing sites, upstream seams (S2.S1's interim enter marker, T1.S2's documented consumer note at chat-view.ts:69), and engine/store APIs are all pinned; residual risk is sequencing against the two parallel/planned view items (S2.S1, T4.S1), mitigated by Task 1's read-first step and the nullable-seam fallbacks.

# PRP — Bugfix P1.M1.T1.S1: Blur the chat input when a settle produces a pendingConfirm

## Goal

**Feature Goal**: Fix BUG-001 (PRD h2.2/h3.0, Major): after a side-chat reply converges on a ```answer block, the confirm row's advertised gestures (enter=apply, esc=decline) are dead in the default focused state — `setView("chat")` seeds `focusChatInput` and nothing blurs on settle, while the confirm-row routing is gated on `this.focus !== "chat"` (panel.ts ~:1222-1245). Fix direction (A) per the PRD: blur the chat input when a DECISION-BEARING settle lands, so the natural flow (type → enter → reply streams → confirm row → enter) works with no pre-blur.

**Deliverable**: Extended settle observation (the `settleInvalidatingPort` fire callback wiring at panel.ts:514-515) + updated AC-17.4 tests in `src/panel/ac-sidechat.test.ts` + JSDoc updates.

**Success Definition**:
- After `await flush()` (settle with `pendingConfirm` set) and NO manual blur: `handleInput(ENTER)` applies the answer (q3 answered/submitted, record discarded, view "short", notify `chat closed · 10 in · 5 out · $0.07`); `handleInput(ESCAPE)` declines (pendingConfirm undefined, chat retained, view "chat")
- The blur fires ONLY on a decision-bearing settle: rejection settles, autoApply bypass, and no-block settles keep focus (user may be typing a follow-up)
- Blur never clears the TextField buffer (in-progress text preserved)
- The `blurChatBox` workaround lines are dropped from both AC-17.4 tests; helper kept (ESC-002 behavior unchanged)
- Full suite + typecheck green

## Why

The confirm row renders unconditionally (chat-view.ts:135-139/:352-363) and its footer promises `enter = yes · esc = no`, but in the natural flow the input still holds focus after sending: enter routes to `sendChatInput` (panel.ts ~:1264-1269) — an empty-buffer no-op — and a single esc forwards to the editor (pi-vim). Both gestures do nothing; the row looks frozen. The only working path is the undocumented double-esc blur, which the project's own AC test codifies (`ac-sidechat.test.ts:636`: "blur the box (double-esc), then enter"). Violates ui-spec §Side chat ("shows an inline confirm (`enter` apply · `esc` keep chatting)") and the confirm-row family contract (the ripple confirm's enter/esc always act).

## What

Extend the settle observation so a decision-bearing settle blurs the chat input:

1. **The seam**: the `settleInvalidatingPort` fire callback at panel.ts:514-515 — currently `port: settleInvalidatingPort(streamSimplePort, () => currentPanel?.invalidate())`. Either extend that closure or (preferably, cleaner) pass a richer fire callback in the same wiring site. The fire runs as a macrotask AFTER the engine's route() continuation, so the live record is POST-settle — `getSidechatRecord()?.pendingConfirm` is already set when it runs.

2. **The logic** (inside the fire callback, after `p.invalidate()`):
```ts
const p = currentPanel;
p?.invalidate();
// BUG-001 fix (P1.M1.T1.S1): a decision-bearing settle blurs the chat
// input so the confirm row's enter/esc gestures are live in the natural
// focused flow. ONLY on pendingConfirm — rejection/autoApply/no-block
// settles keep focus (the user may be typing a follow-up). Blur never
// clears the TextField buffer (blurChatInput only reclaims focus).
if (p !== undefined && p.focus === "chat" && getSidechatRecord()?.pendingConfirm !== undefined) {
  p.blurChatInput();
}
```

3. **Constraints**:
   - Blur ONLY when `pendingConfirm !== undefined` — a rejection settle, autoApply bypass (config on), or plain no-block settle must keep focus
   - No routing-table changes (the `focus !== "chat"` gate at :1222-1245 stays; P1.M1.T1.S2 adds the empty-buffer-enter belt-and-suspenders separately)
   - `blurChatInput()` (panel.ts:1718-1724) is public and precedent-safe (the double-esc escExitEditor path already lands focus="options"); it never touches textDuty/bufferOwner/lastEscAt and never clears the buffer

4. **Tests** (src/panel/ac-sidechat.test.ts):
   - `AC-17.4_confirm_row_and_apply_byte_identical` (:618-663): DELETE the `blurChatBox(chat.panel);` line (:636) — after `await flush()` the settle itself blurs; ENTER applies directly
   - `AC-17.4_esc_declines_keeps_chat` (:665-680): DELETE `blurChatBox(panel);` — ESCAPE declines directly
   - ADD the PRD-demanded no-blur regression (can fold into the two above or add a new test): after `await flush()` with NO blur, assert `panel.focus === "options"` (the settle blurred), then the apply/decline assertions
   - ADD a focus-retention test: a NO-block settle (plain reply, `pendingConfirm === undefined`) with focus "chat" KEEPS focus after flush (typing a follow-up stays seamless)
   - KEEP the `blurChatBox` helper (:443-446) and ESC-002 tests unchanged

5. **Docs [Mode A]**: update the `settleInvalidatingPort` JSDoc (panel.ts :404-425) and the SIDECHAT-001 comment above the pendingConfirm routing branch (~:1222-1245) to document blur-on-decision-settle. README §Side chat sync is P1.M6.T1's.

### Success Criteria

- [ ] Natural-flow enter applies / esc declines with no pre-blur (updated AC-17.4 green)
- [ ] Decision-blur only: no-block settle keeps focus "chat" (new test)
- [ ] Buffer preserved across the blur (existing chat-field tests + the retained-transcript assertions)
- [ ] `blurChatBox` workaround lines removed from both tests; helper kept
- [ ] No routing-table change; gates untouched
- [ ] `npm run typecheck` + full `npm test` green

## All Needed Context

### Context Completeness Check

Repo at HEAD e298920, 1551 tests green. The fix is one closure extension + two test edits; every line reference below was verified in the working tree. The ac-sidechat fake-port harness IS the isolation — mock nothing.

### Documentation & References

```yaml
- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/architecture/sidechat-focus.md
  why: "§BUG-001 firsthand runtime verification: focus seeding at panel.ts:1551-1554, the confirm-row gate :1222-1245, chat-focus enter :1264-1269, settle macrotask ordering, blurChatInput precedent-safety"

- file: src/panel/panel.ts
  why: "THE seam: settleInvalidatingPort :404-425 (JSDoc + wrapper; fire = setTimeout macrotask post-settle), wiring :514-515, confirm-row gate :1222-1245 (STAYS), setView chat seeding :1551-1554 (STAYS), blurChatInput :1718-1724 (public, focus->options + chatField.blur(), never clears buffer)"
  pattern: "the fire callback already reaches the live panel via currentPanel; getSidechatRecord (imported at :87 as get) reads the LIVE module record post-settle"

- file: src/panel/ac-sidechat.test.ts
  why: "the harness: convergePort() :608-615 (doneStream(answerReply('sqlite'), {input:10,output:5,total:0.07})), makeHarness/seedTransition/openChat/sendChat/flush helpers, blurChatBox :443-446 (KEEP), the two tests to edit :618-663 and :665-680"
  gotcha: ":636 is the codified workaround line to delete; Run B (byte-identity) and its assertions stay untouched"

- file: src/sidechat.ts (read-only orientation)
  why: "getSidechatRecord()?.pendingConfirm shape (ApplyDecision | undefined); autoApply bypass never sets pendingConfirm — that's why the !== undefined guard excludes it"
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
├── panel.ts             # settle fire callback + JSDoc ×2 — MODIFY
├── ac-sidechat.test.ts  # drop workaround lines, add no-blur regression + focus-retention — MODIFY
└── chat-view.ts         # NO CHANGE (row already renders unconditionally)
src/sidechat.ts          # NO CHANGE
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: the fire callback is a MACROTASK (setTimeout 0) after the engine's
//   route() continuation — pendingConfirm is already parsed when it runs;
//   do NOT await anything inside it.
// GOTCHA: guard on BOTH p.focus === "chat" AND pendingConfirm !== undefined —
//   without the focus guard you'd blur an options-focused user's session on
//   every decision settle (invalidate-only today); without the pendingConfirm
//   guard you'd steal focus from a user typing a follow-up after a plain reply.
// GOTCHA: blurChatInput never clears the TextField buffer — no extra
//   preservation code needed; but do NOT swap it for chatField.blur() alone
//   (focus field must flip to "options" for the routing gate).
// GOTCHA: autoApply:true bypass never sets pendingConfirm — the guard handles
//   it for free; don't special-case it.
// GOTCHA: the two AC-17.4 tests each call flush() once after send — the new
//   blur happens inside that same settle; no extra flush needed before ENTER.
// GOTCHA: keep Run B (byte-identity, user-selection baseline) byte-identical —
//   only Run A's workaround line is removed.
// GOTCHA: don't touch the focus !== "chat" routing gate — S2 adds the
//   empty-buffer-enter route as defense-in-depth for the refocused case.
```

## Implementation Blueprint

### Implementation Tasks (TDD-ordered)

```yaml
Task 1: ADD failing no-blur regression (extend ac-sidechat.test.ts)
  - In AC-17.4_confirm_row_and_apply_byte_identical: after `await flush()`,
    BEFORE handleInput(ENTER), assert panel.focus === "options" (fails today:
    focus stays "chat")
  - ADD test AC-17.4_no_block_settle_keeps_chat_focus:
    port returns doneStream("ok") (no answer block); openChat → sendChat →
    flush → panel.focus === "chat" (retained), pendingConfirm undefined

Task 2: EXTEND the settle fire callback (panel.ts :514-515)
  - Richer closure per the What §2 sketch; typecheck stays clean
    (getSidechatRecord already imported at :87)

Task 3: DROP the workaround lines
  - :636 blurChatBox(chat.panel); in confirm_row_and_apply_byte_identical
  - blurChatBox(panel); in esc_declines_keeps_chat
  - Keep the helper + its comment (ESC-002 tests still use it)

Task 4: DOCS — JSDoc on settleInvalidatingPort (:404-425) and the SIDECHAT-001
  comment above the pendingConfirm branch (~:1222-1245): document
  blur-on-decision-settle (BUG-001 fix, natural-flow gestures live)

Task 5: RUN all gates
```

### Implementation Patterns & Key Details

```ts
// panel.ts :514-515 after:
port: settleInvalidatingPort(streamSimplePort, () => {
  const p = currentPanel;
  p?.invalidate();
  // BUG-001 (P1.M1.T1.S1): decision-bearing settle reclaims chat focus so
  // the confirm row's advertised enter/esc act without a pre-blur. Only on
  // pendingConfirm — plain/rejection/autoApplied settles keep focus (follow-up
  // typing uninterrupted). blurChatInput never clears the buffer.
  if (p !== undefined && p.focus === "chat" && getSidechatRecord()?.pendingConfirm !== undefined) {
    p.blurChatInput();
  }
}),
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/ac-sidechat.test.ts     # AC-17.4 family + new regression/retention
npx vitest run src/panel/panel.test.ts src/panel/keys.test.ts   # focus/routing untouched
npm test                                          # full 1551+ suite
```

### Level 3: Adjacent behavior verification

```bash
npx vitest run src/panel/ac-sidechat.test.ts -t "17"           # whole AC-17 sweep
npx vitest run src/panel/chat-view.test.ts 2>/dev/null || true # render untouched
# ESC-002 double-esc tests still green (blurChatBox helper path preserved):
npx vitest run src/panel/keys.test.ts -t "esc"
```

### Level 4: Behavior matrix walkthrough

Verify: decision settle + focused → blur + gestures live; decision settle + options focus → no-op; no-block settle + focused → focus kept; rejection settle → focus kept; buffer preserved after blur.

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green
- [ ] No-blur enter applies / esc declines (updated AC-17.4)
- [ ] No-block settle keeps focus (new test); buffer preserved
- [ ] Workaround lines removed; blurChatBox helper + ESC-002 tests intact
- [ ] Routing gate (:1222-1245) unchanged; autoApply bypass unaffected
- [ ] JSDoc ×2 updated; README untouched (P1.M6.T1)

## Anti-Patterns to Avoid

- ❌ Don't blur on every settle — only decision-bearing (pendingConfirm set)
- ❌ Don't touch the focus !== "chat" routing gate or the streaming esc hint (P1.M1.T1.S2 / P1.M1.T2.S1 own those)
- ❌ Don't clear or reseed the chat TextField — blurChatInput only reclaims focus
- ❌ Don't delete the blurChatBox helper or Run B byte-identity assertions
- ❌ Don't add routing-table branches for enter/esc — this subtask is the focus fix only
- ❌ Don't await inside the macrotask fire callback

---

**Confidence Score**: 9/10 — single closure extension on a verified seam with a public precedent-safe blur method, existing harness tests to flip, and the fix direction (A) taken verbatim from the PRD.

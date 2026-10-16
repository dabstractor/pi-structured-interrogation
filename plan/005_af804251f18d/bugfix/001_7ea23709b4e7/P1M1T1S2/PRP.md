# PRP — Bugfix P1.M1.T1.S2: Route empty-buffer chat-focus enter to the pending confirm

## Goal

**Feature Goal**: Complete BUG-001 (PRD h2.2/h3.0, fix direction C): with a pending answer confirm and the chat input focused, an empty/whitespace-buffer enter currently reaches `sendChatInput()` — a consumed no-op — leaving the confirm row's advertised gesture dead. Route it to `onApplyConfirm` instead. S1's settle-blur covers the natural flow; this covers the residual: the user re-focuses the input (to keep chatting) and then presses enter on an empty buffer while `pendingConfirm` exists. After this, enter on the confirm row is never a dead gesture in ANY focus state.

**Deliverable**: ~8 lines inside the chat-focus enter branch (src/panel/panel.ts ~:1258-1269) + comment + tests in `src/panel/ac-sidechat.test.ts`.

**Success Definition**:
- Refocused input + pendingConfirm + enter on empty buffer → apply fires (answer applied, record discarded, view "short", usage notify) — never reaches sendChatInput
- Real text + pendingConfirm + enter → sendChatInput as today (message sent, confirm untouched)
- Whitespace-only buffer + pendingConfirm + enter → applies (trim-empty)
- Empty buffer + NO pendingConfirm + enter → consumed no-op exactly as today
- esc in chat focus UNTOUCHED (single-esc editor forwarding stays — ESC-002; P1.M1.T2.S1 owns the streaming hint)
- `npm run typecheck` + full `npm test` green

## Why

A trim-empty enter is not a message — `sendChatInput` no-ops on it — so treating it as the confirm gesture loses nothing while making the confirm row's `enter = yes` promise hold in every focus state. PRD recommendation: "route an empty-buffer enter in chat focus to the pending confirm"; the shipped AC-17.4 workaround (blur-then-enter) must stop being the only path.

## What

In the chat-focus enter branch (panel.ts ~:1264-1269), before `this.sendChatInput()`:

```ts
if (this.focus === "chat" && enter) {
  // BUG-001 residual (P1.M1.T1.S2): with a pending confirm and a
  // trim-empty buffer, enter APPLIES — sendChatInput would no-op on the
  // empty buffer anyway, so the confirm row's gesture is never dead in
  // any focus state. Real text still routes to sendChatInput (the
  // message ships first; the confirm stays pending).
  const pending = getSidechatRecord()?.pendingConfirm;
  if (pending !== undefined && this.chatField.getText().trim() === "") {
    this.onApplyConfirm?.(pending);
    return true;
  }
  this.sendChatInput();
  return true;
}
```

**Constraints**:
- The `focus !== "chat"` pendingConfirm gate at ~:1222-1245 STAYS unchanged (it handles options/deep/etc. focus; S1's blur routes the natural flow there)
- Do NOT touch esc anywhere in this subtask
- Do NOT touch `sendChatInput` internals, `focusChatInput`, or the settle-blur callback (S1's)
- Docs [Mode A]: update the branch comment block (~:1259-1269) to document the empty-buffer confirm routing (the sketch above is the content)

### Success Criteria

- [ ] All 4 test rows green (apply-on-empty / real-text-wins / whitespace-applies / no-pending-noop)
- [ ] `onApplyConfirm?.()` optional-call form used (seam may be unwired in headless tests)
- [ ] No routing-table, gate, or esc changes
- [ ] Full suite + typecheck green

## All Needed Context

### Context Completeness Check

Repo green at HEAD (post-S1). The branch, the confirm gate, `sendChatInput`'s empty-buffer no-op, the imports (`getSidechatRecord` at :87), the `onApplyConfirm` seam (:895, wired :1071), and the AC harness are all verified in the working tree and excerpted in the research notes. An agent needs this PRP plus `src/panel/panel.ts` (:1222-1269, :1743) and `src/panel/ac-sidechat.test.ts`.

### Documentation & References

```yaml
- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/P1M1T1S1/PRP.md
  why: "CONTRACT — S1 blurs the input on decision-bearing settles ONLY (pendingConfirm !== undefined); the focus !== 'chat' gate stays; S1 explicitly reserves this empty-buffer-enter route as defense-in-depth for the refocused case"
  critical: "after S1, tests must call focusChatInput() explicitly to reproduce chat focus (the settle no longer leaves it focused)"

- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/P1M1T1S2/research/notes.md
  why: "verbatim excerpts of the chat-focus enter branch (:1258-1269), the pendingConfirm gate (:1222-1245), sendChatInput's trim-empty no-op (:1743), and the 4-row test matrix"

- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/architecture/sidechat-focus.md
  why: "§BUG-001 runtime verification + the three fix directions; this subtask is direction (C)"
  section: "§BUG-001"

- file: src/panel/panel.ts
  why: "the branch to modify (:1258-1269); the gate to mirror semantically (:1222-1245: enter → onApplyConfirm(pending) + return true); getSidechatRecord import :87; onApplyConfirm seam :884-895 wired :1071; chatField accessor (verify exact name near focusChatInput :1705 / sendChatInput :1743)"
  pattern: "use the SAME shape as the :1231-1237 branch: optional-call the seam, return true (consumed)"
  gotcha: "sendChatInput no-ops on trim-empty buffers — that equivalence is the safety argument; do not duplicate its classification logic"

- file: src/panel/ac-sidechat.test.ts
  why: "harness: convergePort() :608-615 (doneStream(answerReply('sqlite'), {input:10,output:5,total:0.07})), makeHarness/seedTransition/openChat/sendChat/flush helpers, blurChatBox :443-446, AC-17.4 tests :618-680 (post-S1 they no longer pre-blur)"
  pattern: "settle flow: openChat → sendChat → await flush() → NOW focusChatInput() to reproduce the residual → setText('') → handleInput(ENTER)"
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
├── panel.ts             # chat-focus enter branch ~:1258-1269 — MODIFY (+comment)
└── ac-sidechat.test.ts  # ADD empty-buffer confirm rows — MODIFY (add only)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: guard BOTH pendingConfirm !== undefined AND trim-empty buffer —
//   without the buffer check, enter would apply instead of sending the
//   user's just-typed message (real text must ALWAYS route to sendChatInput).
// GOTCHA: use getText().trim() === "" (whitespace-only is not a message —
//   sendChatInput no-ops on it too, so routing it to the confirm is safe).
// GOTCHA: onApplyConfirm is OPTIONAL (:895) — optional-call it; a headless
//   test without the seam still must not throw (row 4's no-op path).
// GOTCHA: post-S1 the settle blurs — tests MUST focusChatInput() after
//   flush() to enter the chat-focus state this subtask fixes.
// GOTCHA: do NOT handle "\n" — the branch's `enter` already excludes the
//   raw newline byte (R4 newline guard just above).
// GOTCHA: do NOT touch esc/escape anywhere — ESC-002 single-esc editor
//   forwarding and the decline path (options focus) are out of scope.
// GOTCHA: verify the chat TextField's accessor name (chatField vs textField
//   vs a getter) against focusChatInput :1705 / sendChatInput :1743 before
//   writing — use whatever sendChatInput itself reads.
```

## Implementation Blueprint

### Implementation Tasks (TDD-ordered)

```yaml
Task 1: ADD failing tests to src/panel/ac-sidechat.test.ts (new describe
  "chat-focus empty-buffer enter routes to the pending confirm (BUG-001 residual)")
  - Row 1 (apply): convergePort fixture → openChat → sendChat → await flush()
    (pendingConfirm set; settle blurred per S1) → panel.focusChatInput() →
    chatField empty → handleInput(ENTER) → q answered, record discarded,
    view "short", usage notify fired — sendTurn NOT called again
  - Row 2 (real text wins): same settle → focusChatInput() →
    setText("another thought") → handleInput(ENTER) → message sent
    (turn dispatched), pendingConfirm STILL set, view "chat"
  - Row 3 (whitespace applies): focusChatInput() → setText("   ") →
    ENTER → apply fires (not a send)
  - Row 4 (no pending no-op): plain reply port (no answer block) →
    focusChatInput() → empty ENTER → consumed (returns true), nothing sent,
    nothing applied, no throw

Task 2: ADD the routing in panel.ts chat-focus enter branch (:1258-1269)
  - Insert the pending/trim-empty check BEFORE sendChatInput (sketch in What)
  - Update the branch comment block to document the routing [Mode A]

Task 3: RUN gates
  - npx vitest run src/panel/ac-sidechat.test.ts
  - npx vitest run src/panel/panel.test.ts src/panel/keys.test.ts
  - npm run typecheck && npm test
```

### Implementation Patterns & Key Details

```ts
// The complete modified branch (drop-in):
if (this.focus === "chat" && enter) {
  // BUG-001 residual (P1.M1.T1.S2): trim-empty buffer + pending confirm →
  // apply. sendChatInput no-ops on a trim-empty buffer anyway, so this
  // loses nothing and the confirm row's enter is never a dead gesture in
  // any focus state. Real text always ships the message first.
  const pending = getSidechatRecord()?.pendingConfirm;
  if (pending !== undefined && this.chatField.getText().trim() === "") {
    this.onApplyConfirm?.(pending);
    return true;
  }
  this.sendChatInput();
  return true;
}
```

### Integration Points

```yaml
S1: "consumes the settle-blur; the focus !== 'chat' gate (:1222-1245) and both S1 surfaces stay byte-identical"
FUTURE: "P1.M1.T2.S1 (streaming esc hint) and P1.M6.T1 (README sync) consume the completed gesture contract: enter-on-confirm works in every focus state"
DOCS: "branch comment only — README is P1.M6.T1"
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/ac-sidechat.test.ts -v   # new describe + AC-17.4 family
npm test                                           # full suite
```

### Level 3: Adjacent behavior verification

```bash
npx vitest run src/panel/ac-sidechat.test.ts -t "17"      # whole AC-17 sweep (S1 rows still green)
npx vitest run src/panel/panel.test.ts src/panel/keys.test.ts   # routing/focus untouched
```

### Level 4: Behavior matrix (manual)

- [ ] focus=chat + pending + empty → apply; focus=chat + pending + text → send; focus=chat + no pending + empty → noop; focus≠chat + pending → existing gate path unchanged; whitespace → apply

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green
- [ ] All 4 rows green; real-text priority preserved
- [ ] `focus !== "chat"` gate, esc handling, sendChatInput internals, settle-blur callback — all untouched
- [ ] Branch comment documents the routing [Mode A]
- [ ] onApplyConfirm optional-call form; no throw without the seam

## Anti-Patterns to Avoid

- ❌ Don't route a non-empty enter to the confirm — the user's message always wins
- ❌ Don't touch esc or the ESC-002 forwarding — out of scope
- ❌ Don't modify sendChatInput/focusChatInput/the settle callback — S1 owns them
- ❌ Don't remove or weaken the `focus !== "chat"` gate — it serves other views
- ❌ Don't forget focusChatInput() in tests — post-S1 the settle blurs, and skipping it makes the test pass for the wrong reason (options-focus gate)
- ❌ Don't treat "\n" as enter — the branch's guard already excludes it

---

**Confidence Score**: 9/10 — an 8-line guard on a verified branch with the exact mirror-shape (the :1231-1237 options-focus branch) to copy, a clear safety argument (sendChatInput's trim-empty no-op), and a 4-row test matrix using the existing fake-port harness; the only care point (post-S1 test focus setup) is flagged in three places.

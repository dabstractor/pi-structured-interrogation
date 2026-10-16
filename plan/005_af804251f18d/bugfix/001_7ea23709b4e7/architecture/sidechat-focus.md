# BUG-001 / BUG-002 / BUG-003 research — confirm-row focus, discard hook, terminal apply

All line numbers verified firsthand at HEAD e298920. Verdicts: **all three CONFIRMED.**

---

## BUG-001 — advertised confirm-row gestures dead while chat input focused (Major)

### Confirmed mechanism

1. **Render half** (`src/panel/chat-view.ts`): `ChatViewState.pendingConfirm`
   (field at ~149) → `confirmRow(d, question, width)` (~352-363) renders
   `apply ★ {preview}? · enter = yes · esc = no` (CONFIRM_PREFIX/SUFFIX ~134-139)
   whenever set — the row REPLACES the footer hint string unconditionally of focus.
2. **Routing half** (`src/panel/panel.ts` handleInput ~1222-1245):

```ts
if (this.focus !== "chat") {
  const pending = getSidechatRecord()?.pendingConfirm;
  if (pending !== undefined) {
    if (enter) { this.onApplyConfirm?.(pending); return true; }
    if (key === "escape") { const record = getSidechatRecord();
      if (record !== undefined) clearPendingConfirm(record); return true; }
  }
}
```

3. **Focus stays on chat after send** (`panel.ts` ~1264-1269):

```ts
if (this.focus === "chat" && enter) { this.sendChatInput(); return true; }
```

`sendChatInput()` on an empty buffer is a consumed no-op (message already sent),
so enter is dead. A single esc falls through the router — `keys.ts` fixed-esc
branch (~527-541): editor focus (incl. chat) → first esc `return false` →
`panel.ts` forwards to `chatField.handleInput(data)` (pi-vim); only the SECOND
esc within `escExitWindowMs` reaches `escExitEditor` → `blurChatInput()`
(`keys.ts:329-336`). After blur, the `focus !== "chat"` branch finally routes
enter/esc. **The shipped AC test codifies the workaround**:
`ac-sidechat.test.ts:636` — `// Enter on the confirm row: blur the box
(double-esc), then enter.` followed by `blurChatBox(chat.panel);
chat.panel.handleInput(ENTER);` (helper at ~443-446: two `handleInput(ESCAPE)`).

4. **Why focus holds**: `setView("chat")` seeds `focusChatInput()`
   (`panel.ts:1551-1554`); nothing blurs on settle. `blurChatInput()`
   (`panel.ts:1718-1724`) exists and is public: `focus = "options"` +
   `chatField.blur()` + invalidate — precedent-safe in the chat view (the
   double-esc path already lands there).

### The settle observation seam (verified)

The panel has NO engine/store subscription. Settle reaches the panel through
`settleInvalidatingPort(port, fire)` (`panel.ts:415-425`), wired at
`panel.ts:514-515`:

```ts
port: settleInvalidatingPort(streamSimplePort, () => currentPanel?.invalidate()),
```

It wraps the port result's promise with `.finally(() => setTimeout(fire, 0))` —
the macrotask fires AFTER the engine's microtask `route()` continuation, so the
fire callback observes the POST-settle record. **This callback is the natural
blur hook**: after invalidate, `if (getSidechatRecord()?.pendingConfirm !==
undefined)` and the live panel's `focus === "chat"` → `p.blurChatInput()`.
`onAutoApply` (engine dep, `panel.ts:533-537`) shows the same currentPanel
routing pattern. NOTE: blur only on a DECISION-bearing settle — a rejection
settle or autoApply bypass keeps focus (user keeps typing); blur never clears
the buffer (TextField keeps text on blur).

### Fix directions (PRD offers three; recommended = first + belt-and-braces third)

- **(A) Blur on settle** (recommended): extend the `settleInvalidatingPort` fire
  callback (or an equivalent settle observation) to blur when a pendingConfirm
  landed. Makes the natural flow (type → enter → reply → confirm row → enter)
  work via the EXISTING `focus !== "chat"` routing — no routing changes, no
  pi-vim regressions (ESC-002 single-esc forwarding only matters while focused,
  and after blur the editor holds no focus).
- **(C) Route empty-buffer chat-focus enter to the pending confirm**
  (belt-and-braces, covers refocus-then-enter): in the
  `if (this.focus === "chat" && enter)` branch, before `sendChatInput()`, if the
  buffer is empty/whitespace-only AND `getSidechatRecord()?.pendingConfirm` is
  set → `this.onApplyConfirm?.(pending); return true;`. A whitespace-only
  buffer is not a message (sendChatInput no-ops on it) — treating it as the
  confirm gesture is consistent.
- **(B) Render the row only while `focus !== "chat"`** — NOT recommended alone:
  the row would flicker in/out as focus moves; keep the row visible always.

**AC test updates**: `ac-sidechat.test.ts` AC-17.4
`AC-17.4_confirm_row_and_apply_byte_identical` (~618-663) drops the
`blurChatBox` line; add the PRD-demanded regression: press enter immediately
after settle WITHOUT blurring (assert apply + discard + notify + view short);
`AC-17.4_esc_declines_keeps_chat` (~665-680) likewise drops its blur. The
`blurChatBox` helper stays (ESC-002 still blurs) but is no longer load-bearing
for the confirm row.

### Streaming-abort half of BUG-001 (same focus-blind pattern)

Footer hint while streaming reads `esc abort` (chat-view.ts footer hints swap on
stream state), but single esc in chat focus forwards to the editor; abort needs
blur-then-esc. ui-spec.md:115: "Esc ladder. Streaming: first `esc` aborts the
in-flight reply" — the chat-view esc ladder is spec-explicit, while ESC-002's
single-esc-forwarding (`ui-spec.md:44,86`) is the generic editor rule. Tension:
a pi-vim user typing during a stream loses insert-exit if esc always aborts.
Resolution options for the fixer (documented, not mandated):
(i) chat-view-specific ladder precedence — while `view === "chat"` AND streaming,
single esc aborts (spec §Side chat wins for the chat view; insert-exit returns
when idle); or (ii) keep forwarding, fix the HINT to advertise the true gesture
(e.g. `esc·esc abort` while focused). Either makes the advertised gesture true;
(i) matches ui-spec.md:115 verbatim. Regression: repro a held-open streaming
port, press esc once in focused state, assert the abort fired.

---

## BUG-002 — answered-question chat killed by unrelated mutations (Minor)

### Confirmed mechanism

`onChanged` (`panel.ts:941-975`, wired at 1087) on EVERY `state.on("changed")`:

```ts
const q = this.state.getQuestion(record.questionId);
...
const terminal = q.status === "answered" || q.status === "submitted" ||
  q.status === "moot" || q.status === "withdrawn" || q.status === "closed";
if (!terminal) return;
// abort-first → read usage → discardSidechatRecord() → close view → notify
```

It tests CURRENT status. `onChat` (`panel.ts:1057-1066`) has NO status gate —
chats on answered questions open freely (and are a SUPPORTED flow: BUG-003's
ANSWER-PIN no-op apply and FR-18 ripple confirms only arise there). So the next
`changed` from ANY mutation (another question answered, agent upsert,
dependsOn flip) sees "answered" → destroys the chat + notify.

`state.ts` events: `changed: [state: SerializedState]` (full POST-mutation
snapshot — line 156-158), `questions-upserted: [ids: string[]]`,
`epoch-bumped`, `completed-cleared`. **No pre-state in the payload** → a
transition-aware fix must track last-seen status panel-side.

### Fix shape (PRD recommendation: transition-aware hook)

Panel-private last-seen status for the record's question (e.g.
`sidechatLastStatus: QuestionStatus | undefined`), seeded at record open
(onChat / openSidechatRecord call site) and updated at the end of every hook
run. Discard ONLY on a non-terminal → terminal transition. Seeding rules:

- Seed at open with the question's CURRENT status (an already-answered
  question's chat legally lives — no discard on the next unrelated changed).
- If last-seen is undefined when the hook first runs (record created before
  this panel instance — suspend/resume rebuild), seed, don't discard.
- Same-status re-answers (FR-18 ripple edit on an answered question:
  answered→answered) do NOT discard under transition semantics — documented
  accepted behavior; the alternative (refusing opens on terminal questions)
  is REJECTED because answered-question chats are the supported apply surface
  for BUG-003.

Keep the hook's existing ordering contract on a REAL transition
(abort-first → usage read → discard → close view → notify once).

**Tests**: repro from PRD (answered q1 chat survives `state.applyAnswer("q2",
...)` — `getSidechat()` still defined, NO notify fired); counter-test — chat on
open q3, answer q3 via main panel → discard + notify still fires (the
SIDECHAT-001 contract, `panel.test.ts` / `ac-sidechat.test.ts` close-path
tests must stay green).

---

## BUG-003 — same-value apply never discards; confirm row stuck (Minor)

### Confirmed mechanism

`applyChatAnswer` (`actions.ts:562-578`) routes through `acceptOptionIndex`,
whose same-value path is a correct ANSWER-PIN-001 no-op (`AcceptOutcome
"noop"` — actions.ts ~229-262, 276-284: advance only, NO `applyAnswer`, NO
`changed` event). The discard/close/notify is driven entirely by the `changed`
hook (applyChatAnswer JSDoc: "discard + usage notify + chat close
(P1.M2.T5.S1's state 'changed' hook); pendingConfirm clearing (... manual
clearing would race a same-value no-op)" — so NO clearing exists at all).
Result on an already-answered question whose chat re-proposes the recorded
value: enter applies as a no-op forever; view stays 'chat'; row stays rendered;
only esc (decline) clears.

### Fix shape (PRD: "the apply should consume pendingConfirm and close the view
when the record's question is already terminal")

In `applyChatAnswer` (actions.ts), after routing through the seam:

1. `clearPendingConfirm(record)` — consume the confirm (the "race" concern in
   the old comment was about clearing BEFORE routing; clearing AFTER the seam
   ran, only when the question is ALREADY terminal, cannot race a no-op: the
   no-op happened, nothing further will fire).
2. If the record's question is terminal (the no-op case): mirror the hook's
   close ordering — abort first if `streamState === "streaming"` (a second turn
   could be in flight), read `usage`, `discardSidechatRecord()`, close the view
   (`panel.setView(chatReturnView !== "chat" ? chatReturnView : "short")`),
   `panel.sidechatNotify?.(formatChatCloseNotice(usage))`.
3. The NON-terminal case (a real answer write) is unchanged — `changed` fires,
   the hook owns discard/close/notify exactly as today (byte-identical
   provenance preserved; do not double-notify: the hook no-ops once the record
   is gone).

**AC**: PRD BUG-003 repro — answered q3, converging port proposing the recorded
value, enter (no blur needed after BUG-001's M1.T1) → apply no-ops, chat
vanishes, row gone, view left chat, notify fired once. Also keep
AC-17.4's ordinary path green (unanswered q3: apply writes → hook discards →
single notify).

Interaction: after BUG-002's transition-aware hook, a chat opened on answered
q3 SURVIVES until this consume path ends it — the two fixes together make the
answered-question chat lifecycle coherent.

---
name: "P1.M2.T2.S1 — Terminal-consume: applyChatAnswer consumes pendingConfirm and ends the chat when the target question is already terminal (PRD BUG-003)"
description: "In src/panel/actions.ts applyChatAnswer: after routing decision.seam through writeInEnter/acceptOptionIndex (byte-identical provenance untouched), add a post-sequence consume tail: clearPendingConfirm(record) whenever the record is still alive; and when the record survived the seam AND no FR-18 modal is pending AND the question's status is terminal-for-chat (the ANSWER-PIN no-op case, where the state 'changed' hook can never fire), mirror the hook's exact close ordering (abort-if-streaming → read usage → discardSidechatRecord() → setView(chatReturnView fallback 'short') → sidechatNotify(formatChatCloseNotice(usage))). Non-terminal real writes stay UNCHANGED — the hook owns them; no double-notify (getSidechatRecord()===undefined makes the hook no-op). Rewrite the 'Deliberately NOT here' JSDoc paragraph. Tests per PRD repro. Consumed by P1.M6.T1 docs."
---

## Goal

**Feature Goal**: PRD BUG-003 / AC-17.4 tail ("enter → the answer applies … the chat vanishes") holds for the same-value no-op edge: pressing enter on the confirm row of a chat whose question is already answered consumes the offer (`pendingConfirm` cleared), discards the chat, closes the view, and fires the usage-close notice exactly once — instead of leaving a stuck `apply ★` row that re-no-ops forever.

**Deliverable**: Modified `src/panel/actions.ts` (applyChatAnswer restructure + rewritten JSDoc) + tests in `src/panel/actions.test.ts` (sidechat apply describe).

**Success Definition**: `npm test` + `npm run typecheck` green; PRD repro scripted (see Tests §5); the ordinary AC-17.4 path (open question → real write → hook-driven close) unchanged; no double-notify anywhere; seam arguments byte-identical (no provenance change).

## User Persona

**Target User**: TUI user whose side chat re-proposes the already-recorded value on an answered question — pressing enter on `apply ★ sqlite?` must END the interaction, not loop.

**Use Case**: Chat on answered q3 proposes sqlite (== recorded) → confirm row → enter → the apply is a correct ANSWER-PIN no-op → today: view stays "chat", record alive, row stuck. After: consume + close + one notice.

**User Journey**: enter on the confirm row → (no-op apply) → chat closes, view returns to chatReturnView, `chat closed · … in · … out · $…` toast once → further enters are ordinary (nothing pending).

**Pain Points Addressed**: Stuck confirm row; SIDECHAT-002 discard-on-answer contract violated on this edge; no feedback loop.

## Why

- PRD h2.3/h3.2 (BUG-003): "at minimum the apply should consume pendingConfirm and close the view when the record's question is already terminal"; h2.5: "have applyChatAnswer consume pendingConfirm + close the view when the target question is already terminal".
- The old JSDoc's stated reason for refusing ("manual clearing would race a same-value no-op") dissolves when clearing happens AFTER the seam ran and only when the question is already terminal: the no-op already happened, nothing further will fire (research findings §decision table).
- Builds on parallel P1.M2.T1.S1 (transition-aware hook): with it, an answered-question DIFFERENT-value direct apply also leaves the record alive (answered→answered is no transition) — this consume path then closes it. The guard works identically under both hook versions.

## What

All logic in `src/panel/actions.ts` `applyChatAnswer` (:562–578). Imports: add `clearPendingConfirm`, `discardSidechatRecord`, `formatChatCloseNotice`, `getSidechatRecord` from `./sidechat.js` (check which are already imported).

### 1. Restructure — both seams flow through one tail

Current body early-returns from the writeIn branch. Restructure (seam arguments UNTOUCHED — byte-identical provenance is a core commitment):

```ts
export function applyChatAnswer(panel: InterrogationPanel, decision: ApplyDecision): boolean {
  const record = getSidechatRecord();
  const state = panel.state;
  if (record === undefined || state.getQuestion(record.questionId) === undefined) return true;
  if (panel.currentId !== record.questionId) panel.currentId = record.questionId; // setter re-seeds + scopes buffer

  let outcome: boolean;
  if (decision.seam === "writeIn") {
    panel.textField.setText(decision.text); // RAW — the keyboard commit's "arguments"
    outcome = writeInEnter(panel);
  } else {
    const q = state.getQuestion(record.questionId);
    outcome = q !== undefined ? acceptOptionIndex(panel, q, decision.optionIndex) !== false : true;
  }

  // [PRD BUG-003 / P1.M2.T2.S1] Consume tail — see JSDoc §Contract.
  const live = getSidechatRecord();
  if (live === record) {
    // The offer was consumed either way (applied, no-op'd, or deferred into
    // an FR-18 modal) — retire the confirm row.
    clearPendingConfirm(live);
    const q = state.getQuestion(record.questionId);
    const terminal = q !== undefined && TERMINAL_FOR_CHAT.has(q.status);
    // The no-op case ONLY: the seam wrote nothing (record still alive — the
    // 'changed' hook never fired) and no FR-18 modal is pending (a veto
    // defers the real write; its tail owns the close). Mirror the hook's
    // ordering exactly (panel.ts onChanged).
    if (terminal && panel.confirmMode === undefined) {
      if (live.streamState === "streaming") live.abortController.abort(); // FIRST — a second turn may be in flight
      const usage = live.usage; // read BEFORE discard
      discardSidechatRecord();
      if (panel.view === "chat") {
        panel.setView(panel.chatReturnView !== "chat" ? panel.chatReturnView : "short");
      }
      panel.sidechatNotify?.(formatChatCloseNotice(usage)); // once — getSidechatRecord() is now undefined
    }
  }
  return outcome;
}
```

- `TERMINAL_FOR_CHAT`: a small module-local `ReadonlySet<QuestionStatus>` (`answered | submitted | moot | withdrawn | closed`) — the same five the hook tests inline (panel.ts onChanged ~:974-979). Do NOT import the panel's inline check (it isn't extracted); if P1.M2.T1.S1 (parallel) exported a helper, prefer it — read panel.ts at implementation time and reuse whichever exists to keep ONE canonical predicate.
- `panel.confirmMode`, `panel.chatReturnView`, `panel.sidechatNotify`, `panel.view`, `panel.setView` — check current visibility; if private, this is the sanctioned reason to expose the minimal needed surface (confirmMode read-only getter or public readonly field — follow how other actions.ts seams access panel state; several already read panel internals).
- Return value: the ORIGINAL seam outcome (`outcome`), unchanged — callers and tests key on it.

### 2. Why this cannot double-notify or race

Document in the JSDoc (this replaces the "Deliberately NOT here" bullet about pendingConfirm):

- **Real write, non-terminal question**: applyAnswer emits `changed` synchronously INSIDE the seam → the hook discards before the tail runs → `live !== record` → tail no-ops. (Under the T1.S1 transition hook, an answered→answered direct write also leaves the record alive → the terminal branch closes it — same single notify, different owner; exactly-once holds either way because the tail fires only when the hook did not.)
- **FR-18 veto ("veto" outcome / beginWriteInConfirm deferral)**: `panel.confirmMode !== undefined` → tail clears pendingConfirm (the modal now owns the interaction) and does NOT close — the deferred apply's tail eventually writes and the hook/next applyChatAnswer re-entry closes.
- **No-op (the bug)**: no emit, no modal → record alive, status terminal → close path runs once; every later enter finds `getSidechatRecord() === undefined` → the guard at the top returns consumed.

### 3. JSDoc rewrite (Mode A, contract point 5)

Replace the "Deliberately NOT here … pendingConfirm clearing (… would race a same-value no-op)" paragraph with the new contract: the consume tail clears pendingConfirm on every applied decision and closes the chat when the record survived the seam with no modal pending AND the question is terminal (the no-op edge) — mirroring the hook's ordering (abort → usage → discard → view close → notify once); explain WHY post-sequence clearing does not race the no-op (the no-op already completed; nothing further fires from the seam). Keep the other "Deliberately NOT here" bullets (answer construction/markers/timestamps). README sync is P1.M6.T1's.

### 4. Explicitly OUT of scope

- The transition-aware hook (parallel P1.M2.T1.S1 — panel.ts); this item reads only.
- onChat replace-path abort/notify (P1.M3.T1.S1), /clear notify (P1.M3.T2.S1), input preservation (P1.M4.T1.S1).
- Any change to seam arguments, AcceptOutcome semantics, writeInEnter/acceptOptionIndex internals.

### Success Criteria

- [ ] PRD repro: answered q3 + converging port proposing sqlite → pendingConfirm → `handleInput("\r")` (no blur) → state unchanged (no new answer.at), `getSidechatRecord() === undefined`, `panel.view === chatReturnView`, exactly one sidechatNotify (`chat closed · …`), render contains no `apply ★`
- [ ] Second enter after the consume: inert (record gone, no second notify)
- [ ] Ordinary path (open q3 → real write): unchanged — hook fires, one notify, tail no-ops
- [ ] FR-18 veto path: pendingConfirm cleared, chat NOT closed while the modal is open
- [ ] Seam arguments byte-identical (setText(decision.text) raw; acceptOptionIndex(q, decision.optionIndex) unchanged)
- [ ] `npm test` + `npm run typecheck` green (incl. P1.M1.T1.S1/S2's focused-enter tests and AC-17.4)

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets: the exact current body to restructure (including the early-return trap), the decision table showing why the live-record + no-modal + terminal guard discriminates every scenario, the hook's ordering to mirror verbatim, the real export names (`getSidechatRecord`, not the PRD's `getSidechat`), the visibility caveat, the T1.S1 interaction, and the repro test recipe. No guessing.

### Documentation & References

```yaml
- file: src/panel/actions.ts
  why: applyChatAnswer :531-578 (JSDoc paragraph to rewrite + body to restructure — NOTE the writeIn early-return), AcceptOutcome :245 ("noop" :299 — advance only, NO applyAnswer, NO changed), acceptOptionIndex :270
  gotcha: seam arguments must remain byte-identical — provenance-by-construction is a core commitment; restructure control flow only

- file: src/panel/panel.ts
  why: onChanged hook :961-993 — the ordering to mirror (abort FIRST → usage read BEFORE discard → discardSidechatRecord → view close with chatReturnView fallback → sidechatNotify once); the inline terminal predicate :974-979 (or T1.S1's exported helper if present); panel field/method visibility to check (confirmMode, chatReturnView, sidechatNotify, setView)
  gotcha: the hook fires SYNCHRONOUSLY inside applyAnswer (emitChanged) — the tail's live===record check is what discriminates

- file: src/panel/sidechat.ts
  why: real export names — getSidechatRecord, clearPendingConfirm :636, discardSidechatRecord, formatChatCloseNotice :508-511, record fields usage :231 / streamState / abortController / pendingConfirm :244
  gotcha: PRD text says "getSidechat()" — the actual name is getSidechatRecord

- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/architecture/sidechat-focus.md
  why: §BUG-003 primary research — verified anchors and the close-ordering pattern
- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/P1M2T1S1/PRP.md
  why: CONTRACT (parallel) — transition-aware hook; explains why answered→answered direct writes become THIS path's responsibility under the new hook; keep behavior correct under BOTH hook versions
- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/prd_snapshot.md (h2.3/h3.2 BUG-003, h2.5 recommendations, h2.0 AC-17.4 reference)
  why: the defect, the repro, the mandated remedy
```

### Current Codebase tree (relevant slice)

```bash
src/panel/ actions.ts panel.ts sidechat.ts sidechat-engine.ts (+ actions.test.ts panel.test.ts)
```

### Desired Codebase tree

```bash
# no new files
src/panel/actions.ts         # MODIFIED: applyChatAnswer consume tail + JSDoc rewrite (+ minimal panel-surface access if needed)
src/panel/actions.test.ts    # MODIFIED: terminal-consume tests
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// The writeIn branch early-returns today — the restructure must route BOTH seams through the tail.
// ESM ".js" import suffixes; several sidechat exports may already be imported — extend, don't duplicate.
// The 'changed' hook discards SYNCHRONOUSLY inside applyAnswer — never "pre-clear" pendingConfirm BEFORE
//   the seam (that was the old code's correctly-feared race); clearing AFTER is safe.
// Read usage BEFORE discardSidechatRecord() — the record object survives but getSidechatRecord() must be
//   undefined afterwards (exactly-once depends on it).
// chatReturnView is never "chat" by its seeding rule — the ternary fallback is belt-and-braces (copy the hook).
// panel.confirmMode may be private — expose minimally (read-only getter) rather than widening the class;
//   check what T1.S1/S2 already exposed first.
// Don't assert "no applyAnswer called" via spies on private internals — assert OBSERVABLE state: answer.at
//   unchanged, serialize byte-identical, no 'changed' events during the enter.
```

## Implementation Blueprint

### Data models and structure

None — control-flow change only.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: READ panel.ts at implementation time — determine TERMINAL_FOR_CHAT source (inline set vs T1.S1's
  exported helper) and the visibility of confirmMode/chatReturnView/sidechatNotify; prefer reuse over duplication.

Task 1: TDD — ADD failing tests first (actions.test.ts sidechat apply describe; reuse its fake-port fixtures)
  - noop_apply_on_answered_question_consumes_and_closes (PRD repro §Tests: exactly one notify; view ===
     chatReturnView; getSidechatRecord() undefined; render free of 'apply ★'; state byte-identical incl. answer.at)
  - second_enter_after_consume_is_inert (no further notify/state change)
  - ordinary_apply_on_open_question_still_hook_driven (one notify; unchanged expectations)
  - fr18_veto_clears_pendingconfirm_but_keeps_chat_open (confirmMode set; record alive; no notify)
  - noop_close_mirrors_hook_ordering (streaming record: abortController.abort called BEFORE discard; usage
     values appear in the notice)
  - writein_byte_identical_noop_also_closes (custom answer same text re-proposed — if the writeIn seam has
     a same-value inert path; verify in writeInEnter and cover whichever edge exists)

Task 2: RESTRUCTURE applyChatAnswer per What §1 (seam arguments untouched) + imports

Task 3: REWRITE the JSDoc paragraph (What §2-3) — Mode A, the new contract + no-race explanation

Task 4: GATES
  - npx vitest run src/panel/actions.test.ts src/panel/panel.test.ts   # AC-17.4 + P1.M1.T1 focused-enter tests green
  - npm test && npm run typecheck
```

### Implementation Patterns & Key Details

The load-bearing guard, verbatim from What §1:

```ts
const live = getSidechatRecord();
if (live === record) {
  clearPendingConfirm(live);
  if (terminalForChat(q.status) && panel.confirmMode === undefined) { /* hook-mirroring close */ }
}
```

Identity comparison (`live === record`) — not a field check — is what makes the discrimination airtight across both hook versions.

### Integration Points

```yaml
CONSUMERS (do NOT implement):
  - P1.M6.T1.S1: README §Side chat sync documents the consume+close contract
  - P1.M2.T1.S1 (parallel): the transition hook — this tail complements it; both land independently
STATE/CONFIG/EVENTS: none
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npx vitest run src/panel/actions.test.ts
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/panel.test.ts src/panel/ripple-confirm.test.ts   # veto-path + hook interplay green
npm test
```

### Level 3: Integration Testing

Covered by the scripted repro (fake-port panel harness is the project's integration surface for side chat). Live-TUI verification lands with P1.M3's sweeps if any.

### Level 4: Domain Validation

Walk the decision table (research findings) against the implemented guard — every row must be closed by exactly one owner (hook / deferred tail / consume path).

## Final Validation Checklist

- [ ] `npm test` + `npm run typecheck` green; AC-17.4 + P1.M1.T1 focused-enter tests green
- [ ] PRD repro passes with exactly one notify, view closed to chatReturnView, no stuck `apply ★`
- [ ] Ordinary path + FR-18 veto path behavior unchanged/verified; no double-notify in any scenario
- [ ] Seam arguments byte-identical; return value = original seam outcome
- [ ] Close ordering mirrors the hook (abort → usage → discard → view → notify)
- [ ] JSDoc paragraph rewritten (Mode A) with the no-race explanation; README NOT touched (P1.M6.T1)

---

## Anti-Patterns to Avoid

- ❌ Don't clear pendingConfirm BEFORE the seam runs — that is the race the old comment correctly feared; post-sequence only
- ❌ Don't close the chat while `panel.confirmMode` is set — the FR-18 deferral owns the interaction until its tail applies
- ❌ Don't change seam arguments or add a "chat answer" fast path — provenance-by-construction is a core commitment ("no new answer path may be added")
- ❌ Don't notify from both the tail and the hook — the identity guard (`live === record`) is the mechanism; don't replace it with flag bookkeeping
- ❌ Don't read usage after discard or abort after discard — copy the hook's ordering verbatim
- ❌ Don't touch the hook, onChat, or engine files — parallel/sibling items own them

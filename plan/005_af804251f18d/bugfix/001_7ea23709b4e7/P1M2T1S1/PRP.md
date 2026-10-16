---
name: "P1.M2.T1.S1 — Gate the discard hook on a non-terminal→terminal status transition (BUG-002)"
description: "Make src/panel/panel.ts's onChanged side-chat discard hook transition-aware: track a panel-private last-seen status for the record's question (seeded at onChat open, re-seeded on record replacement/reset and on first hook run when undefined); discard ONLY when last-seen was non-terminal AND current is terminal (answered|submitted|moot|withdrawn|closed). Already-terminal-at-open chats survive unrelated mutations (the supported BUG-003 apply surface). Ordering contract preserved verbatim on real transitions. Rewrite the SIDECHAT-001 discard-guarantee comment (Mode A). Tests: PRD repro + counter-tests; existing discard-family tests (all genuine transitions) stay green."
---

## Goal

**Feature Goal**: BUG-002 — a side chat opened on an already-answered question is no longer collateral damage from unrelated state mutations; the hook discards exactly when the record's question TRANSITIONS into a terminal-for-chat status.

**Deliverable**: Modified `src/panel/panel.ts` (hook + seeding at onChat + `sidechatLastSeen` tracking + rewritten comment) + tests in `src/panel/panel.test.ts` (the sidechat describe).

**Success Definition**: `npm test` + `npm run typecheck` green; the PRD repro passes (answered q1 chat survives answering q2 — record alive, notify NOT called); counter-test (chat on open q3, answer q3 → discard + notify exactly as today); all existing discard-family tests green unmodified (every one of them is a genuine non-terminal→terminal transition — verified); documented same-status-reanswer edge.

## User Persona

**Target User**: TUI user chatting about an already-answered question (re-examining a choice, using the chat's apply surface for FR-18/ANSWER-PIN scenarios).

**Use Case**: Chat open on answered q1, user answers q2 in the main panel → the q1 chat survives; toast appears only when a chat's OWN question reaches terminal state.

**Pain Points Addressed**: "a chat opened on an already-answered question … lives on borrowed time: the next state mutation ANYWHERE … aborts/discards the chat and toasts 'chat closed'" (h2.3/h3.1 BUG-002).

## Why

- PRD h2.5 recommendation: "Make the side-chat discard hook transition-aware (compare pre/post status …)". The spec's discard rule is event-driven ("discards when its question is answered or closed by ANY path") — an already-answered question is not *being answered* by an unrelated mutation.
- The `'changed'` event payload is the full POST-mutation snapshot (state.ts:156-158) — no pre-state available from the event; transition detection must be panel-side.
- Chosen over gating onChat on non-terminal status because answered-question chats are a supported surface: the apply path explicitly handles ANSWER-PIN no-ops and FR-18 ripple confirms, which only arise on answered questions (BUG-003's fix, P1.M2.T2.S1, builds on this).

## What

### 1. The tracking field — `src/panel/panel.ts`

Add a panel-private pair (a bare status would go stale across record replacement — key by question id):

```ts
/** BUG-002 transition tracking: {questionId, status} the discard hook last
 *  saw for the live record's question. undefined until first observed. */
private sidechatLastSeen: { questionId: string; status: QuestionStatus } | undefined;
```

Terminal predicate: extract the existing inline check into a small helper `terminalForChat(status)` (`answered | submitted | moot | withdrawn | closed`) — the hook's current condition, unchanged.

### 2. Seeding rules

- **At open (onChat, ~:1083-1090)**: after `openSidechatRecord(qid, …)` (or the same-question reuse branch), seed `this.sidechatLastSeen = { questionId: qid, status: <current status of qid> }`. An already-terminal question at seed time → seed, do NOT discard (answered-question chats are supported).
- **Records opened outside onChat** (tests call `openOrReplace` directly; also suspend/resume where the record predates this panel instance): on the first hook run with `sidechatLastSeen === undefined || sidechatLastSeen.questionId !== record.questionId` → seed with the current status and RETURN (no discard decision this run). This single rule covers both the direct-open test path and panel-instance rotation, and re-seeds automatically when the singleton is replaced (different questionId) or reset via `/clear`//`new` on another question.
- **After every hook run that does NOT discard**: update `sidechatLastSeen = { questionId: record.questionId, status: q.status }` (so moot→closed same-question churn updates the baseline without discarding — both terminal).

### 3. The hook — decision change only

Current (~:970-995): computes `terminal` from CURRENT status and discards on `terminal`. New:

```ts
const record = getSidechatRecord();
if (record === undefined) return;
const q = this.state.getQuestion(record.questionId);
if (q === undefined) return;
// BUG-002: transition semantics —
const last = this.sidechatLastSeen;
if (last === undefined || last.questionId !== record.questionId) {
  this.sidechatLastSeen = { questionId: record.questionId, status: q.status };
  return; // seed-only run: first observation, replaced record, or new panel instance
}
const nowTerminal = terminalForChat(q.status);
const wasTerminal = terminalForChat(last.status);
this.sidechatLastSeen = { questionId: record.questionId, status: q.status };
if (!nowTerminal || wasTerminal) return; // no REAL transition into terminal
// …existing tail VERBATIM: abort-first (streaming) → usage read →
// discardSidechatRecord() → close view to chatReturnView → notify once.
```

**Ordering contract preserved verbatim on a real transition** (abort-first → usage read → discard → close view → notify once; re-entrancy safety via discard clearing `get()`).

**Documented accepted edge** (hook comment): same-status re-answers (FR-18 ripple edit, answered→answered; moot→moot churn) do not discard under transition semantics — the question was already terminal when the edit landed. P1.M2.T2.S1's apply-side terminal-consume covers the apply flavor of this edge.

### 4. Comment rewrite (Mode A)

Rewrite the `SIDECHAT-001 discard guarantee` comment above the hook (~:941-960) to state: transition semantics (discard on non-terminal→terminal only), the seeding rules (open-time seed; seed-only first run for records predating the panel or opened outside onChat; per-run baseline update), the accepted same-status-reanswer edge, and the unchanged ordering contract. Keep the universal-bus rationale (the hook still sees every mutation path — it just decides by transition now).

### 5. Tests — `src/panel/panel.test.ts` (the sidechat/discard describe; reuse `makeDiscardPanel`/`rebind`/`resetSidechatForTests` fixtures)

1. `test_bug002_answered_question_chat_survives_unrelated_mutation` (the PRD repro): q1..q4, `state.applyAnswer("q1", …)` (q1 answered), `openOrReplace("q1", rebind())`, `panel.setView("chat")`, one turn over the existing fake-port fixtures if convenient (not required for the repro), blur/exit view; then `state.applyAnswer("q2", …)` → `getSidechat()` DEFINED (same questionId "q1"), `notify` NOT called, view untouched.
2. `test_discard_still_fires_on_real_transition` (counter): chat on OPEN q3, `accept(panel)` on q3 (or applyAnswer) → discard + notify once + view closes to chatReturnView — the existing `test_discard_on_option_accept` shape, distinct question, to pin the transition gate specifically.
3. `test_seed_only_when_record_predates_panel`: create the record via `openOrReplace` (bypassing onChat), fire an unrelated `applyAnswer` on another question → seed-only run: record survives; THEN answer the record's open question → discard fires (baseline was correctly seeded non-terminal).
4. `test_replacement_reseeds_baseline`: chat on open q1 (seeded open); open on q2 (already answered) via `openOrReplace("q2", …)`; fire unrelated mutation → q2 chat survives (questionId-mismatch re-seed).
5. `test_same_status_reanswer_edge_is_documented_behavior`: chat on answered q1 (seeded terminal); `state.applyAnswer("q1", differentValue)` (answered→answered, FR-18-class edit without the modal here) → record survives, notify NOT called — the accepted edge, pinned.
6. Stay-green sweep: the existing discard family (`test_discard_on_option_accept`, `_writein_commit`, `_moot_flip`, `_upsert_close`, `_sidechat_apply`, `test_midstream_abort_order`, plus ac-sidechat.test.ts :665/:767/:1013 "chat closed" assertions) — all genuine transitions from open; verify untouched.

### 6. Explicitly OUT of scope

- BUG-003 (stuck confirm row / terminal-consume on same-value apply) — P1.M2.T2.S1, which CONSUMES this item's output.
- BUG-005/007 (abort-before-replace, usage notices on replace//clear) — P1.M3; the hook's tail is shared but untouched by them.
- BUG-004/006/008; onChat status gating (rejected alternative); the in-flight P1.M1.T2.S1 esc-gesture work (chat-view/keys — no overlap).

### Success Criteria

- [ ] PRD repro passes: answered-question chat survives unrelated mutation, notify silent
- [ ] Real transitions still discard with the exact existing ordering; all existing discard tests green unmodified
- [ ] Seeding: open-time, first-run (record-predates-panel / direct open), replacement re-seed — all tested
- [ ] Mode A comment: transition semantics + seeding rules + accepted edge + unchanged ordering
- [ ] Only panel.ts + panel.test.ts modified

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets: the current hook body, the exact new decision block, the seeding rules with rationale, the terminal-set definition, the stay-green analysis (why every existing test is a genuine transition), and six enumerated tests with fixture names. No guessing.

### Documentation & References

```yaml
- file: src/panel/panel.ts
  why: onChanged hook ~:941-995 (grep `discard guarantee` — terminal check, abort-first tail, notify once); onChat ~:1083-1090 (the seed site); the 'changed' event contract; panel-private field conventions
  pattern: decision-change only — the tail stays byte-identical
  gotcha: key lastSeen by questionId, not bare status — records get replaced across questions and /clear rebinds

- file: src/state.ts
  why: :156-158 'changed' payload is the full POST-mutation snapshot — why pre-state must be tracked panel-side; QuestionStatus union
- file: src/panel/panel.test.ts
  why: the sidechat discard describe (~:3590-3700): makeDiscardPanel/rebind/resetSidechatForTests fixtures, the discard-family tests that must stay green (every one starts from an OPEN question — verified)
- file: src/panel/ac-sidechat.test.ts
  why: :665/:767/:1013 'chat closed' assertions — real-transition scenarios; green sweep required
- file: src/panel/sidechat.ts
  why: SidechatRecord/getSidechat/discard/openOrReplace/resetChat shapes; resetSidechatForTests
- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/prd_snapshot.md (h2.3/h3.1 BUG-002, h2.5 rec 2)
  why: defect definition, repro steps, chosen fix alternative
- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/architecture/sidechat-focus.md
  why: §BUG-002 firsthand verification — hook anatomy, onChat lack of gate, event-payload fact
```

### Current Codebase tree (relevant slice)

```bash
src/panel/ panel.ts sidechat.ts (+ panel.test.ts ac-sidechat.test.ts)
```

### Desired Codebase tree

```bash
# no new files
src/panel/panel.ts        # sidechatLastSeen field + seed sites + hook decision + comment rewrite
src/panel/panel.test.ts   # +5 tests (repro, counter, predates-panel, reseed, edge pin)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// Line numbers drift (parallel M1.T2.S1 in chat-view/keys) — grep `discard guarantee` for the hook
// update sidechatLastSeen BEFORE the discard decision in every non-discard path, or the baseline goes stale on the next event
// key by questionId: openOrReplace on another question / /clear rebind must re-seed, not compare across records
// do NOT gate onChat on non-terminal status — answered-question chats are the supported apply surface (BUG-003 fix depends on them surviving)
// abort-first ordering is a ruling contract — only the DECISION changes, never the tail
// re-entrancy safety (discard clears get()) already holds; the seed-only return adds no new re-entrancy surface
// tests calling openOrReplace directly (all existing ones) rely on the seed-only-first-run rule — without it they'd regress
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: WRITE the 5 new tests (What §5) — repro + edge-pin FAIL at HEAD; run npx vitest run src/panel/panel.test.ts -t sidechat (or -t discard) to confirm

Task 2: MODIFY src/panel/panel.ts
  - terminalForChat helper (extracted condition)
  - sidechatLastSeen field + seed in onChat + transition decision in the hook + baseline updates
  - Mode A comment rewrite (What §4)

Task 3: GATES
  - npx vitest run src/panel/panel.test.ts src/panel/ac-sidechat.test.ts
  - npm test && npm run typecheck
```

### Implementation Patterns & Key Details

```ts
// The decision block (whole logic change) — see What §3. Seeding invariant:
// sidechatLastSeen ALWAYS reflects the last status observed for the LIVE
// record's question after the hook returns; discard requires
// terminalForChat(now) && !terminalForChat(last) && same record lineage.
```

### Integration Points

```yaml
DOWNSTREAM (do NOT implement):
  - P1.M2.T2.S1 (BUG-003): applyChatAnswer terminal-consume — builds on answered-question chats surviving; its repro ("chat on answered q3 surviving until its own apply consumes it") depends on this item landing first
  - P1.M3 (BUG-005/007): shares the hook's tail ordering as its mirror pattern — do not alter the tail
EVENTS: none new — still the universal state.on("changed") bus
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npx vitest run src/panel/panel.test.ts -t sidechat
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/panel.test.ts src/panel/ac-sidechat.test.ts
npm test   # full suite; the parallel P1.M1.T2.S1 (chat esc gesture) must stay green — different files
```

### Level 3: Integration Testing

Covered by the panel-harness tests (real state bus, real record, real hook).

### Level 4: Domain Validation

Trace vs the PRD repro: answered q1 → chat on q1 → answer q2 → chat alive, no toast; chat on open q3 → answer q3 → discard + toast once. Both pinned by tests 1-2.

## Final Validation Checklist

- [ ] `npm test` + `npm run typecheck` green; existing discard family + ac-sidechat assertions untouched and green
- [ ] Transition-only discard; seeding at open / first-run / replacement all tested; same-status edge pinned as documented behavior
- [ ] Ordering tail byte-identical; abort-first preserved; notify exactly once per record
- [ ] Mode A comment rewritten (transition semantics, seeding rules, accepted edge, ordering)
- [ ] Only panel.ts + panel.test.ts modified; TDD order followed

## Anti-Patterns to Avoid

- ❌ Don't gate onChat on non-terminal status — kills the supported answered-question apply surface (BUG-003 depends on it)
- ❌ Don't track a bare status without questionId — record replacement//clear corrupts the baseline
- ❌ Don't reorder or touch the discard tail — the abort-first ruling order is a contract other items mirror
- ❌ Don't skip the baseline update on non-discard runs — stale basauses false discards later
- ❌ Don't implement BUG-003's confirm-row consume here — P1.M2.T2.S1 owns it

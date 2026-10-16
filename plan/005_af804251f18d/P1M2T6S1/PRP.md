# PRP — P1.M2.T6.S1: Confirm-row apply/decline and autoApply bypass routed via acceptOptionIndex / write-in commit

---
name: "P1.M2.T6.S1 — SIDECHAT-004 indistinguishable-provenance apply routing"
description: "Wire the last engine/view seam: `applyChatAnswer(panel, decision)` in src/panel/actions.ts routes the side-chat's ApplyDecision VERBATIM through the two ordinary answer seams — seam \"acceptOptionIndex\" → the existing acceptOptionIndex with the decision's DISPLAY optionIndex; seam \"writeIn\" → seed the panel write-in buffer with the decision's raw text and invoke the existing writeInEnter commit path. NO new answer code path, no wrappers that could add markers: deltas, diff cards, completion records, and tool results stay byte-identical to user-made answers (asserted by fixture comparison). Wire panel.onApplyConfirm (the P1.M2.T3.S1 routing stub, panel.ts:853) and the engine's answerContext/onAutoApply deps (resolveSidechatHostSeams). esc declines via the landed clearPendingConfirm; sideChatAutoApply bypasses the confirm on parse completion. [Mode A] JSDoc notes the SIDECHAT-004 contract at panel.ts/sidechat.ts apply sites."
---

## Goal

**Feature Goal**: SIDECHAT-004 (core commitment 9): a side-chat-proposed answer applies through the ordinary accept seams and is indistinguishable from a user selection in every model-facing record — byte-identical submission deltas, diff cards, completion record, tool results. Confirm row: `enter` applies, `esc` declines (chat stays open). `sideChatAutoApply: true` applies on parse completion with no confirm.

**Deliverable**: New `applyChatAnswer` routing function in `src/panel/actions.ts`; wiring of `panel.onApplyConfirm` (constructor routed block, panel.ts ~:1023) and of `answerContext` + `onAutoApply` into the engine deps (`resolveSidechatHostSeams`, panel.ts :486–508); [Mode A] JSDoc at the apply sites in panel.ts and sidechat.ts; tests in `src/panel/sidechat.test.ts` (+ engine test for the autoApply firing). No new files.

**Success Definition**: `npm run typecheck` + `npm test` green; scripted AC-17.4: apply from the confirm row answers via the ordinary seam with advance + auto-submit + T5.S1's discard/usage-notify firing; byte-identical provenance proven against a user-selection fixture; ripple confirm still raises on invalidating edits; ANSWER-PIN same-value no-op holds; decline keeps the chat; autoApply applies without any confirm state.

## User Persona

**Target User**: The TUI answerer who asks the side chat for a recommendation.

**Use Case**: User presses `e`, discusses, the model proposes an answer — a confirm row appears; `enter` applies it exactly as if the user had picked the option themselves (or typed the write-in); `esc` dismisses the proposal and keeps chatting.

**Pain Points Addressed**: Proposed answers that carry telltale markers into the model conversation (provenance leakage); modal dead-ends where declining kills the chat.

## Why

- Core commitment 9 (h2.0): "answers it proposes apply through the ordinary accept seams and are indistinguishable from user selections in every model-facing record."
- Architecture ruling (plan/005_af804251f18d/architecture/panel-view-integration.md §"Open/replace/discard wiring", verbatim authority): "Routing the parsed answer through these two seams verbatim makes provenance indistinguishable BY CONSTRUCTION — no new answer path may be added." Anchors: `acceptOptionIndex` actions.ts:268–331 (applyAnswer :315 → evaluateDependsOn :319 → advanceAfterAccept :320 → stageSupersededWriteIn :326 → maybeAutoSubmit :327; veto seam `panel.confirmRippleEdit` :313); write-in commit region actions.ts:384–518 (same post-commit ordering :508–518).
- Inputs landed: ApplyDecision/pendingConfirm/autoApply bookkeeping (P1.M1.T6.S2 — sidechat.ts :139/:605/:635), confirm-row rendering + enter/esc routing (P1.M2.T1.S2 + T3.S1 — panel.ts :1181–1199 calls `this.onApplyConfirm?.(pending)`, esc already declines via `clearPendingConfirm`), discard machinery (P1.M2.T5.S1 — fires on the state `changed` bus).
- Parallel boundary: P1.M2.T5.S2 (suspend survival) may relocate the engine construction inside `resolveSidechatHostSeams` — re-read the landed tree before editing that function; do not duplicate or undo its placement work.
- This is the LAST engine/view seam — the feature is functionally complete after this subtask (AC-17.4; P1.M2.T7 deletes discuss, P1.M3 sweeps).

## What

### Behavior contract (exact)

1. **`applyChatAnswer(panel: InterrogationPanel, decision: ApplyDecision): boolean`** — new exported function in `src/panel/actions.ts`, placed near `writeInEnter`:
   - Resolve the target question: `const record = getSidechatRecord()`; if `record === undefined` or the question is gone from state → consumed `true`, nothing done. If `panel.currentId !== record.questionId`, assign `panel.currentId = record.questionId` FIRST (the setter is the sanctioned re-entry: it re-seeds the cursor per ANSWER-PIN and performs the buffer-scoping write-through, so the editor holds the target question's buffer before any commit).
   - `decision.seam === "acceptOptionIndex"`: `q = currentQuestion(panel)`; return `acceptOptionIndex(panel, q, decision.optionIndex) !== false` — the SAME arguments a keyboard accept produces (`optionIndex` is a DISPLAY position; `displayOptions(q)` mapping lives inside the seam — never re-map here). The seam's entire chain runs untouched: ANSWER-PIN same-value no-op, FR-18 `confirmRippleEdit` veto, applyAnswer, evaluateDependsOn, advanceAfterAccept, stageSupersededWriteIn, maybeAutoSubmit.
   - `decision.seam === "writeIn"`: `panel.textField.setText(decision.text)` — the RAW bytes, no trim, no marker (the commit path commits the RAW buffer; trim only gates emptiness, and a whitespace-only decision was already rejected by the parser's "empty-text" rule) — then `return writeInEnter(panel)`. The keyboard write-in commit is byte-for-byte this sequence: buffer content + `writeInEnter`. Its whole chain runs untouched: byte-identical no-op, reasked re-confirm, FR-18 victims → `beginWriteInConfirm` deferral, direct-commit tail with `consumeCommittedBuffer`/advance/blur/maybeAutoSubmit.
   - NO wrapper behavior of its own: no answer construction, no markers, no timestamps, no invalidation beyond what the seams do, no discard (T5.S1's `state.on("changed")` hook owns discard + usage notify — the apply answers the question, the hook fires, the chat closes where the advance already points).
2. **Confirm-row wiring** (panel.ts constructor routed block, after `routed.onChat` ~:1033): `this.onApplyConfirm = (decision) => { applyChatAnswer(this, decision); }` — replacing the nullable stub default. The T3.S1 branch at :1181–1199 is ALREADY correct (enter fires the seam, esc declines via `clearPendingConfirm`); do not touch it. Esc decline: chat stays open, messages intact, `pendingConfirm` + `lastRejection` cleared (landed `clearPendingConfirm`).
3. **Engine deps wiring** (`resolveSidechatHostSeams`, panel.ts :486–508 — the `createSidechatEngine({...})` call): add the two optional deps the engine already defines (sidechat-engine.ts :114/:120):
   - `answerContext: (qid) => { const state = lastOpts?.state; const q = state?.getQuestion(qid); if (state === undefined || q === undefined) return undefined; return { question: q, autoApply: config.sideChatAutoApply }; }` — the exact staleness pattern `buildSystemPrompt` uses one screen up.
   - `onAutoApply: (decision) => { const p = currentPanel; if (p !== undefined) applyChatAnswer(p, decision); }` — routes into the LIVE panel via the module host record (settle-forwarding target already used by the port seam on :504). The engine fires it ONLY on `decision && ctx.autoApply` (sidechat-engine.ts :334) — no confirm state ever exists under the bypass (`settleApplyDecision` clears `pendingConfirm` in that branch, landed).
   - If T5.S2 relocated the engine construction, wire the deps at the LANDED construction site (single site — never construct twice).
4. **[Mode A] JSDoc** at the apply sites: panel.ts — the `onApplyConfirm` field doc (drop "ROUTING stub… P1.M2.T6.S1 replaces it", state the real routing + cite SIDECHAT-004 "indistinguishable provenance: routed through acceptOptionIndex / writeInEnter verbatim — no new answer path") and one line in the routed-block comment; sidechat.ts — the `ApplyDecision` header already names P1.M2.T6.S1; append one line noting the routing LANDED: "actions.ts applyChatAnswer routes it; the seams' provenance is byte-identical by construction (SIDECHAT-004)".
5. **Mock nothing** in tests: real `InterrogationPanel`/state/engine seams per existing fixtures. (`panel.confirmRipple` remains a test seam — using it to force a veto is the established pattern, not a mock of this feature.)

### Success Criteria

- [ ] Choice question, side chat proposes `{value: "postgres"}` → confirm row → `enter` → answer `{value: "postgres"}` (no custom), status answered, advance to next unanswered, auto-submit fires when it was the last open question, chat record discarded + usage notify (T5.S1 hook).
- [ ] Write-in proposal `{text: "…"}` → `enter` → answer `{value: text, custom: true}` byte-identical (raw, no trim), same chain.
- [ ] **Byte-identical provenance**: same scenario driven twice — once by keyboard (`acceptOptionIndex` / `textField.setText` + `writeInEnter`), once via `applyChatAnswer` — `state.serialize()`, the submission delta payload, the diff-card line, and the completion-record line are deep-equal / string-equal respectively.
- [ ] Ripple: applying a DIFFERENT value on an answered question with victims still raises the keep/cancel modal (`panel.confirmRipple` veto → nothing applied, chat unchanged); write-in victims → `beginWriteInConfirm` modal.
- [ ] ANSWER-PIN: applying the SAME value the question already records (non-custom, settled status) is the inert no-op — advance only, no fresh `answer.at`, no auto-submit, no modal.
- [ ] Decline: `esc` on the confirm row → `pendingConfirm`/`lastRejection` cleared, chat view open, messages intact, nothing answered.
- [ ] autoApply: `sideChatAutoApply: true` + a settled reply with a valid block → `onAutoApply` fires, answer applied, `record.pendingConfirm` stayed undefined; a "none" reply under autoApply applies nothing (notice only).
- [ ] `npm run typecheck` + `npm test` green (existing T3.S1 stub-assertion tests updated: they now assert real routing, not stub firing).

## All Needed Context

### Context Completeness Check

Every seam is anchored to landed code with line references, the parallel-item boundary (T5.S2 engine placement) is stated, the routing design (buffer-seed + writeInEnter) is justified against the seam's actual implementation, and the byte-identical test is decomposed into concrete comparisons. An implementer needs nothing beyond this PRP + the repo.

### Documentation & References

```yaml
- file: plan/005_af804251f18d/architecture/panel-view-integration.md
  why: THE ruling — §"Open/replace/discard wiring" quotes the two seams with the full post-commit chain and line anchors; "no new answer path may be added" is binding
  pattern: implement literally; if landed line numbers drifted (T5.S1/T5.S2 landed), re-anchor by symbol names

- file: plan/005_af804251f18d/P1M2T6S1/research/notes.md
  why: verified anchors for every claim — acceptOptionIndex/writeInEnter chains, ApplyDecision/settleApplyDecision/clearPendingConfirm, the onApplyConfirm stub, the engine-deps gap, test patterns

- file: src/panel/actions.ts
  why: acceptOptionIndex (:268 — DISPLAY index, ANSWER-PIN no-op, FR-18 veto, full tail) and writeInEnter (:384 — RAW-buffer commit, byte-identical no-op, victims deferral, direct tail :508–518); applyChatAnswer lives beside them
  pattern: routing function delegates; the ONLY panel mutations it performs are currentId alignment and textField.setText
  gotcha: optionIndex is DISPLAY order (displayOptions) — do NOT index q.options directly; writeInEnter commits the RAW buffer, so setText must receive the decision text untrimmed

- file: src/panel/panel.ts
  why: onApplyConfirm stub :853–860 (wire it in the constructor routed block after routed.onChat :1023–1034); the T3.S1 confirm-row branch :1181–1199 (already correct — read-only); resolveSidechatHostSeams :486–508 (engine deps gap — add answerContext/onAutoApply; buildSystemPrompt's staleness pattern one screen up; currentPanel module record)
  gotcha: T5.S2 (parallel) may relocate the engine construction — wire at the landed site; never construct the engine twice

- file: src/panel/sidechat.ts
  why: ApplyDecision :139 (both seams' payload contracts), settleApplyDecision :605 (autoApply clears pendingConfirm, returns decision), clearPendingConfirm :635 (esc decline — landed)
  pattern: read-only except the one JSDoc line; the store never calls the seams

- file: src/panel/sidechat-engine.ts
  why: optional deps answerContext :114 / onAutoApply :120; the firing site :330–337 (decision && ctx.autoApply only)
  pattern: read-only — the wiring happens at the host construction site

- file: src/panel/ripple-confirm.ts
  why: beginWriteInConfirm/applyWriteInConfirm — the FR-18 deferral write-ins route into when victims exist (writeInEnter does this internally; no direct calls needed)
  pattern: read-only reference for test expectations

- file: src/panel/sidechat.test.ts (+ sidechat-engine.test.ts)
  why: landed ApplyDecision fixtures; the byte-identical comparison tests live here; engine test extends the autoApply firing assertion from "onAutoApply called" to "applied through the panel"
  pattern: panelArgsFor(state) / makeMockPi fixtures per the existing files; no mocks of state/seams
```

### Current Codebase tree (relevant slice)

```bash
src/panel/
  actions.ts        # MODIFY — add applyChatAnswer + JSDoc
  panel.ts          # MODIFY — wire onApplyConfirm (constructor) + engine deps (resolveSidechatHostSeams) + JSDoc
  sidechat.ts       # MODIFY — one JSDoc line on ApplyDecision (routing landed)
  sidechat.test.ts  # MODIFY — apply/decline/autoApply/byte-identical tests
  sidechat-engine.test.ts  # MODIFY — autoApply routes into the panel
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: optionIndex in ApplyDecision is DISPLAY order (D-R13
// recommended-first). acceptOptionIndex maps display→option internally via
// displayOptions(q) — indexing q.options directly applies the WRONG ROW
// whenever a recommendation exists.
// CRITICAL: write-in text is VERBATIM — never .trim() before setText; the
// parser already rejected whitespace-only ("empty-text"), and trimming would
// break byte-identical provenance (SIDECHAT-004 owner ruling).
// CRITICAL: currentId alignment FIRST — writeInEnter commits against
// currentQuestion(panel) (currentId), not record.questionId; assigning
// panel.currentId also runs the setter's buffer write-through so no draft
// is corrupted.
// GOTCHA: do NOT clear pendingConfirm manually after apply — the T5.S1
// discard hook removes the whole record when the question answers; manual
// clearing would race a same-value no-op (record alive, confirm cleared —
// acceptable and correct: nothing was applied).
// GOTCHA: the FR-18 modal (confirmMode) takes precedence over the chat
// confirm row by construction (panel.ts ordering) — a vetoed apply leaves
// the chat and pendingConfirm untouched; do not "help" by clearing.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD applyChatAnswer to src/panel/actions.ts
  - SIGNATURE: export function applyChatAnswer(panel: InterrogationPanel, decision: ApplyDecision): boolean
  - IMPORT: ApplyDecision + getSidechatRecord from ./sidechat.js
  - LOGIC: per contract §1 (record/currentId alignment → seam dispatch)
  - JSDOC: [Mode A] — SIDECHAT-004 indistinguishable provenance; cite the two
    seams and the "no new answer path" ruling; list what it must NOT do
    (no markers, no discard, no pendingConfirm handling beyond the seams)

Task 2: WIRE panel.onApplyConfirm in src/panel/panel.ts constructor
  - PLACE: routed block, immediately after routed.onChat (~:1034):
    `this.onApplyConfirm = (d) => { applyChatAnswer(this, d); };`
  - UPDATE the onApplyConfirm field JSDoc (:853) — stub language out, real routing in
  - IMPORT applyChatAnswer from ./actions.js

Task 3: WIRE engine deps in resolveSidechatHostSeams (panel.ts :486–508)
  - ADD answerContext (staleness pattern of buildSystemPrompt; config.sideChatAutoApply)
  - ADD onAutoApply (currentPanel → applyChatAnswer)
  - VERIFY single construction site (T5.S2 parallel — re-read first)

Task 4: JSDoc line in src/panel/sidechat.ts ApplyDecision header
  - routing LANDED note (contract §4)

Task 5: TESTS in src/panel/sidechat.test.ts
  - apply option seam: answer + advance + maybeAutoSubmit + record discarded
  - apply writeIn seam: custom answer, raw text byte-equal
  - byte-identical provenance: keyboard fixture vs applyChatAnswer —
    state.serialize() deep-equal, delta payload equal, diff-card line equal,
    completion line equal
  - ripple veto (panel.confirmRipple = () => false) → nothing applied, chat intact
  - ANSWER-PIN same-value no-op → advance only, no answer.at rewrite
  - decline (esc semantics: clearPendingConfirm via the panel branch or direct)
  - autoApply: engine settle with config.sideChatAutoApply → applied, pendingConfirm undefined
  - stale record/question gone → consumed no-op
  - UPDATE the T3.S1 stub tests wherever they asserted stub-only firing

Task 6: TESTS in src/panel/sidechat-engine.test.ts
  - onAutoApply dep now routes into a real panel when autoApply: extend the
    existing firing test to assert the ANSWER landed through the seam
```

### Implementation Patterns & Key Details

```ts
// actions.ts — the whole routing function (no more than this):
export function applyChatAnswer(panel: InterrogationPanel, decision: ApplyDecision): boolean {
  const record = getSidechatRecord();
  const state = panel.state;
  if (record === undefined || state.getQuestion(record.questionId) === undefined) return true;
  if (panel.currentId !== record.questionId) panel.currentId = record.questionId; // setter re-seeds + scopes buffer
  if (decision.seam === "writeIn") {
    panel.textField.setText(decision.text); // RAW — the keyboard commit's "arguments"
    return writeInEnter(panel);
  }
  const q = state.getQuestion(record.questionId);
  return q !== undefined ? acceptOptionIndex(panel, q, decision.optionIndex) !== false : true;
}

// panel.ts — resolveSidechatHostSeams additions:
answerContext: (qid) => {
  const st = lastOpts?.state;
  const q = st?.getQuestion(qid);
  if (st === undefined || q === undefined) return undefined;
  return { question: q, autoApply: config.sideChatAutoApply };
},
onAutoApply: (decision) => {
  const p = currentPanel;
  if (p !== undefined) applyChatAnswer(p, decision);
},
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck          # expected: zero errors
npx eslint src/panel/actions.ts src/panel/panel.ts src/panel/sidechat.ts 2>/dev/null || true
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/sidechat.test.ts src/panel/sidechat-engine.test.ts -v
npx vitest run src/panel/ -v        # no panel-wide regressions (T3.S1 routing, T5.S1 hooks, ripple, autosubmit)
```

### Level 3: Integration (scripted AC-17.4)

```bash
npx vitest run src/panel/ -v -t "apply"   # the confirm-row/apply/autoApply scenarios are the AC-17.4 scripted coverage
```

### Level 4: Documentation gate

- `grep -n "ROUTING stub" src/panel/panel.ts` returns nothing; SIDECHAT-004 cited at the apply sites (actions.ts applyChatAnswer, panel.ts onApplyConfirm, sidechat.ts ApplyDecision).

## Final Validation Checklist

- [ ] `npm run typecheck` clean; full `npx vitest run` green.
- [ ] Both seams route verbatim; zero new answer-construction code.
- [ ] Byte-identical provenance test passes (state, delta, diff card, completion record).
- [ ] Ripple modal + ANSWER-PIN no-op + reasked re-confirm all behave via the seams.
- [ ] Decline keeps the chat; autoApply applies with no confirm state.
- [ ] T5.S1 discard + usage notify fire from the apply (asserted, not duplicated).
- [ ] [Mode A] JSDoc updated at all three apply sites.

## Anti-Patterns to Avoid

- ❌ Don't construct an answer object, marker, or timestamp in applyChatAnswer — the seams own all of it.
- ❌ Don't trim/normalize the write-in text or re-map the option index — both break SIDECHAT-004 byte-identity.
- ❌ Don't add discard/notify/close logic — T5.S1's `state.on("changed")` hook owns it.
- ❌ Don't construct a second engine or move T5.S2's placement — wire the landed site.
- ❌ Don't special-case autoApply inside the panel — the engine's `decision && ctx.autoApply` gate is the only trigger.

---

**Confidence Score**: 9/10 — the routing function is ~10 lines delegating to two fully-landed, heavily-tested seams; the only judgment call (buffer-seed + writeInEnter for the write-in seam) is forced by the "no new answer path" ruling and matches how a keyboard commit produces its arguments; residual risk is limited to line drift from the parallel T5.S2 item, which the PRP flags for re-reading.

---
name: "P1.M1.T3.S3 — End-to-end AC-13 acceptance test through the real submit pipeline"
description: "Add a permanent regression test proving AC-13 end-to-end: panel-driven answers → real auto-submit delivery → real agent-settled close pass → write-in edit of the archived answer → second real auto-submit → editedArchived:true + ' (changed)' in the delivered content line and the submission card. No hand-built baselines, no state.setStatus, no direct computeDiff. Existing direct-computeDiff AC-13 test is retained as a unit test; actions.test.ts:701's manufactured baseline retained with a documentation comment."
---

## Goal

**Feature Goal**: The regression net BUG-003 lacked: a vitest acceptance test that drives AC-13 through **production code paths only** — panel actions, maybeAutoSubmit, buildSubmission/delivery, the agent-settled close pass with S2's snapshot, submissionBaselineOf, computeDiff, renderers — and observes `editedArchived: true` and the ` (changed)` marker in BOTH the model-visible content line and the user card.

**Deliverable**: A new test (new describe block) in `src/ac-scripted.test.ts`, plus a documentation comment on the retained `bug008_edited_archived_entry_still_ships_ac13` test at `src/panel/actions.test.ts:701`. No production code changes.

**Success Definition**: `npm test` + `npm run typecheck` green; the new test contains ZERO occurrences of `state.setStatus`, hand-built `pre` baselines, or direct `computeDiff`/`buildSubmission` calls in its assertion path; the existing AC-13 unit test (ac-scripted.test.ts:554-635) is untouched and still green.

## User Persona

**Target User**: The extension maintainer/regression gate (P1.M3.T1 full-suite sweep); the PRD's acceptance runbook.

**Use Case**: Any future change to snapshot timing, close pass, or submit pipeline that would silently re-break the `(changed)` marker flips this test immediately.

**User Journey**: user answers all questions → auto-submit delivers → agent settles (answers archived/closed) → user re-opens the panel, edits the archived answer via ✎ write-in → enter → second auto-submit fires → the model sees `Q1: ... (changed)` and the user's card highlights the edit.

**Pain Points Addressed**: The shipped test suite claimed AC-13 coverage while manufacturing its baseline — the bug shipped undetected through 1224 passing tests.

## Why

- PRD h3.2/BUG-003: the existing AC-13 test "passes only by hand-building `pre` via state.serialize() at the closed moment and calling computeDiff directly, bypassing the snapshot-ring baseline the production submit uses."
- README.md:262's AC-13 passage already promises this proof; the P1.M3.T2 doc sweep verifies against it.
- S2 (parallel contract) makes the pipeline correct (close-pass snapshot); this item pins it forever.

## What

1. **Placement & hygiene**: add a NEW describe block to `src/ac-scripted.test.ts` after the existing AC-13 describe (e.g. `describe("AC-13 (end-to-end) — edited archived answer flags (changed) through the REAL submit pipeline")`). The file's `beforeEach(() => resetState())` already isolates the singleton. The file is shared across parallel suites — **additive only; do not modify any existing test**.
2. **The test** (single test, e.g. `AC-13_e2e_real_pipeline_close_pass_writein_edit_changed`), combining the two harnesses:
   - `const h = makePiHarness(); const lifecycle = wireLifecycle(h); registerDebugBridge(h, lifecycle);` (all three helpers already exist in this file at ~:141/:175/:226).
   - Upsert via the real tool: `executeInterrogate({ goal, epoch: 1, questions: [q1, q2] }, tuiCtx(), DEFAULT_CONFIG)` — q1 = choice with 2 options (recommendation "a"), q2 = **text, never answered** (keeps completion from firing when the close pass runs — same guard the existing test uses).
   - Build the panel on the SINGLETON so panel and lifecycle share state: follow `src/panel/actions.test.ts` `makePanel` shape — `new InterrogationPanel({ tui: { requestRender: vi.fn() } as TUI, theme: stubTheme, done: () => {}, state: getState()!, config: DEFAULT_CONFIG })` (adapt: either re-declare the helper locally or import panel-test utilities; keep the stubTheme already defined in ac-scripted.test.ts:187).
   - Delivery: `const { deps, sendMessage } = makeDeps(true)` (actions.test.ts:118 pattern — `sendMessage` mock + `isIdle: () => true`; re-declare locally).
   - **Answer both**: q1 via the panel — `panel.currentId = "q1"; panel.cursorIndex = 0;` then `acceptOptionIndex`/`accept(panel)` (follow actions.test.ts write-in tests for exact call); q2 via the ✎ text path — navigate to q2's Other/text affordance, `accept`, `panel.textField.setText(...)`, `panel.handleInput("\r")` (enter COMMITS). The final commit's `maybeAutoSubmit` tail fires the REAL auto-submit → `sendMessage` call 1; assert `state.epoch === 2` and q1/q2 `submitted`.
   - **Real close pass**: `h.emit("agent_settled")` → assert `state.getQuestion("q1")!.status === "closed"` (REAL close, no setStatus) and — S2 contract — `state.snapshots.at(-1)` holds epoch === 2 (not bumped) with q1 status 'closed'.
   - **Archived edit via write-in**: `panel.currentId = "q1"; panel.cursorIndex = <index past both options = ✎ Other row>`; `accept(panel)` → `panel.focus === "text"`, `panel.textDuty === "writein"`; `panel.textField.setText("edited archived answer")`; `panel.handleInput("\r")` → commit + maybeAutoSubmit tail → `sendMessage` call 2 (auto-submit fires because no unanswered remain — q2 is closed/submitted? NO: q2 was submitted and then closed by the same settle; both are non-pending, completeness holds).
   - **Assertions** (the AC-13 verdict, from the delivered message — NOT from hand-built diff objects):
     - `const msg2 = sendMessage.mock.calls[1][0]` → `msg2.details.changed` has length 1, entry `{ id: "q1", editedArchived: true, ... }` with the write-in value.
     - `msg2.content` contains `" (changed)"` (delivery.ts:147 renders the suffix).
     - Card: `renderLines(buildSubmissionCard(msg2, { expanded: false, outputPad: 0 }, stubTheme))` has a line matching `/(changed)/` (renderers.ts:177 CHANGED_MARKER). (`buildSubmissionCard`, `renderLines`, `stubTheme` already used in this file — see existing AC-13 test :628-633.)
     - Ring: baseline used was the close-pass snapshot — implicit; optionally assert `submissionBaselineOf(state)` epoch equals 2 before the second submit (import from `./snapshots.js` if asserted).
   - **Forbidden in this test's path**: `state.setStatus(...)`, manual `const pre = state.serialize()` + `computeDiff`, direct `buildSubmission(state, diff)` — the message must come out of `sendMessage`.
3. **Retain + annotate the two existing tests**:
   - Existing AC-13 direct-computeDiff test (ac-scripted.test.ts:554-635): keep unchanged (contract: do not delete) — it is the computeDiff unit proof.
   - `src/panel/actions.test.ts:701` `bug008_edited_archived_entry_still_ships_ac13`: RETAIN (it guards the BUG-008 draft-flush filter interaction, a distinct concern) and add a 2-3 line comment above it: "manufactured closed baseline via setStatus — kept deliberately as a unit guard for the BUG-008 filter; the REAL pipeline (close pass → ring baseline → (changed)) is covered by AC-13_e2e_real_pipeline... in src/ac-scripted.test.ts."
4. **Docs**: none (README.md:262 already promises this; P1.M3.T2 verifies).

### Success Criteria

- [ ] New e2e test green, with zero `setStatus`/hand-built-baseline/direct-diff calls in its path
- [ ] Asserts `editedArchived: true` + ` (changed)` in content line AND card, plus the real close-pass snapshot invariants (epoch not bumped, status 'closed')
- [ ] Existing AC-13 unit test untouched and green; actions.test.ts:701 retained with the documentation comment
- [ ] `npm test` (full suite) + `npm run typecheck` green

## All Needed Context

### Context Completeness Check

An agent with no codebase knowledge gets: both harness recipes (exact helper names/locations), the exact gesture sequence (cursorIndex → accept → setText → handleInput("\r")), the assertion targets with file:line, the completion-avoidance guard, and the retain-don't-delete contract. No guessing.

### Documentation & References

```yaml
- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/P1M1T3S2/PRP.md
  why: CONTRACT — runClosePass now takes a snapshot (toClose.length > 0, same-epoch, statuses 'closed'); its own real-pipeline test is minimal — THIS item is the comprehensive e2e acceptance net; do not duplicate its minimal test, extend coverage
  gotcha: S2 is in flight — if its snapshot change is not yet landed, this test will fail on editedArchived; coordinate (its landing is a prerequisite)

- file: src/ac-scripted.test.ts (:137-235 makePiHarness/wireLifecycle/registerDebugBridge, :554-635 existing AC-13, :187 stubTheme, :47 imports)
  why: the harness this test builds on + the test to retain; BEFORE you write, read the whole existing AC-13 test and mirror its setup (tuiCtx, executeInterrogate, invoke, emit)
  pattern: "makePiHarness() → wireLifecycle → registerDebugBridge → executeInterrogate(..., tuiCtx(), DEFAULT_CONFIG) → await h.invoke(...) / h.emit('agent_settled')"
  gotcha: additive-only — this file is shared by parallel suites; never edit existing tests

- file: src/panel/actions.test.ts (:75 seed, :101 makePanel, :118 makeDeps, ~:760-820 & :1476 write-in gesture tests, :701 manufactured-baseline test to annotate)
  why: panel construction on a shared state + the exact write-in gesture: currentId/cursorIndex past options → accept(panel) → textDuty 'writein' → textField.setText → handleInput('\r') commits
  pattern: "new InterrogationPanel({ tui: {requestRender: vi.fn()} as TUI, theme: stubTheme, done: () => {}, state, config: DEFAULT_CONFIG })"
  gotcha: actions.test.ts seeds a LOCAL state — the e2e test must pass getState()! (the singleton) so panel + lifecycle + close pass share one state

- file: src/panel/actions.ts (:213 accept, :236 acceptOptionIndex, :450 submit, :607 maybeAutoSubmit)
  why: the production path under test; maybeAutoSubmit fires the auto-submit tail on the final commit when deps.isIdle() is true

- file: src/lifecycle.ts (:156 createLifecycle, :212 runClosePass)
  why: h.emit("agent_settled") drives the REAL close pass (submitted → closed + S2's snapshot)

- file: src/snapshots.ts (:209 editedArchived condition; submissionBaselineOf; takeSnapshot)
  why: what makes the fix observable — baseline is now the close-pass 'closed' snapshot

- file: src/delivery.ts (:147 " (changed)" suffix) and src/renderers.ts (:70 CHANGED_MARKER, :177 card render)
  why: the two assertion surfaces (model delta line + user card)

- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/architecture/bug-003-snapshots-changed.md
  why: root-cause analysis; the repro steps in this PRP are its Steps to Reproduce, translated into harness gestures
```

### Current Codebase tree (relevant slice)

```bash
src/
  ac-scripted.test.ts   # + new e2e describe (additive)
  panel/actions.test.ts # + comment at :701 (no test edits)
  lifecycle.ts snapshots.ts delivery.ts renderers.ts  # production paths under test (NO changes)
```

### Desired Codebase tree

No new files — one new describe/test in `src/ac-scripted.test.ts`, one comment in `src/panel/actions.test.ts`.

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: state is a MODULE SINGLETON — ac-scripted.test.ts's beforeEach resetState() handles isolation; the PANEL must be built on getState()!, never on a fresh seeded state
// CRITICAL: keep one never-answered-then-closed non-gate question (q2 text) so the close pass does NOT complete the interrogation (completion clears questions from under the assertions)
// maybeAutoSubmit only fires when deps.isIdle() → makeDeps(true)
// Write-in cursorIndex = number of options (the ✎ Other row sits past them)
// handleInput("\r") is the write-in ENTER that COMMITS (non-empty buffer; empty buffer only saves a draft)
// ESM: relative imports need .js suffix; vi.fn() mocks for sendMessage/requestRender
// AUTOMATION-POLICY (file header): no live TUI, no real pi process, no user-in-the-loop
// The second auto-submit requires ALL non-terminal questions non-pending — after the settle both q1 and q2 are closed/archived; editing q1 re-pends ONLY q1 → completeness holds → tail fires
```

## Implementation Blueprint

### Data models and structure

No production types — test-only. Local helpers re-declared in ac-scripted.test.ts (do not import test code across suites):

```ts
// mirror of actions.test.ts makeDeps
function makeSubmitDeps(): { deps: SubmitDeps; sendMessage: Mock } {
  const sendMessage = vi.fn();
  return { deps: { sendMessage, isIdle: () => true }, sendMessage };
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: PREREQUISITE CHECK
  - RUN: npx vitest run src/lifecycle.test.ts src/ac-scripted.test.ts
  - VERIFY S2 landed: grep -n "takeSnapshot" src/lifecycle.ts — the close-pass call must exist. If absent, STOP and report (S2 contract unmet); do not implement the fix here.

Task 1: ADD the e2e describe/test to src/ac-scripted.test.ts
  - SETUP: makePiHarness + wireLifecycle + registerDebugBridge; executeInterrogate upsert (q1 choice 2 opts rec "a"; q2 text) via tuiCtx()
  - PANEL: construct InterrogationPanel on getState()! with makeDeps-style {sendMessage, isIdle:true}
  - FLOW: answer q1 (accept on option) + q2 (text affordance → setText → '\r') → assert sendMessage call 1, epoch 2, statuses submitted
  - SETTLE: h.emit("agent_settled") → assert q1 closed (real close pass) + snapshots.at(-1) epoch 2 & status 'closed'
  - EDIT: currentId q1 → cursorIndex = Other row → accept → textDuty 'writein' → setText("edited archived answer") → handleInput("\r")
  - ASSERT: sendMessage call 2 → details.changed[0] {id q1, editedArchived true}; content contains " (changed)"; buildSubmissionCard lines contain CHANGED_MARKER; no setStatus/direct computeDiff anywhere in the test body
  - FOLLOW pattern: existing AC-13 test setup (:557-590) + actions.test.ts write-in gestures (:760-820)

Task 2: ANNOTATE src/panel/actions.test.ts:701
  - ADD comment above bug008_edited_archived_entry_still_ships_ac13: manufactured setStatus baseline kept deliberately (BUG-008 filter unit guard); real pipeline covered by the new e2e test in src/ac-scripted.test.ts
  - DO NOT edit the test body
```

### Implementation Patterns & Key Details

```ts
// Assertion core (the whole point — everything must come from sendMessage):
const msg2 = sendMessage.mock.calls[1][0] as SubmissionMessage;
expect(msg2.details.changed).toEqual([
  expect.objectContaining({ id: "q1", editedArchived: true }),
]);
expect(msg2.content).toContain(" (changed)"); // delivery.ts:147
const card = renderLines(buildSubmissionCard(msg2, { expanded: false, outputPad: 0 }, stubTheme));
expect(card.some((l) => l.includes("(changed)"))).toBe(true); // renderers.ts:177
```

### Integration Points

```yaml
DEPENDS ON: P1.M1.T3.S2 (close-pass snapshot) — hard prerequisite, verified by Task 0
FEEDS: P1.M3.T1.S1 full-suite sweep (this test is part of the gate); P1.M3.T2 README verification cites it for the README.md:262 AC-13 passage
NO production code changes in this item
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npx vitest run src/ac-scripted.test.ts -t "AC-13"
```

### Level 2: Unit Tests

```bash
npx vitest run src/ac-scripted.test.ts src/panel/actions.test.ts src/lifecycle.test.ts src/snapshots.test.ts
npm test   # full suite green — no flips expected (additive-only)
```

### Level 3: Integration (the deliverable)

The new test IS the integration proof — it drives tool → panel → auto-submit → settle → close pass → write-in edit → second auto-submit → rendered card, with delivery captured by the fake `sendMessage`.

### Level 4: Mutation check (optional but recommended)

Temporarily comment out S2's `takeSnapshot(state)` in runClosePass → the e2e test must FAIL (proves it actually guards the pipeline, not a tautology). Restore afterward; leave no mutation behind.

## Final Validation Checklist

- [ ] `npm test` + `npm run typecheck` green; no existing test modified
- [ ] E2E test path contains zero `setStatus` / hand-built `pre` baselines / direct `computeDiff`-into-`buildSubmission` calls
- [ ] `editedArchived: true` + ` (changed)` asserted in content line AND card; close-pass snapshot invariants asserted (epoch unbumped, status 'closed')
- [ ] Task 0 prerequisite verified (S2 landed); mutation check done (optional)
- [ ] actions.test.ts:701 carries the documentation comment; existing AC-13 unit test retained
- [ ] Only two files touched: src/ac-scripted.test.ts (additive), src/panel/actions.test.ts (comment)

---

## Anti-Patterns to Avoid

- ❌ Don't manufacture the closed baseline (`state.setStatus`) — the whole point is the REAL close pass + ring baseline
- ❌ Don't call `computeDiff`/`buildSubmission` directly for assertions — read the delivered `sendMessage` payload
- ❌ Don't edit or delete the existing AC-13 direct-computeDiff test or any shared-suite test (additive-only rule)
- ❌ Don't build the panel on a locally seeded state — it must share the singleton with the lifecycle
- ❌ Don't let the close pass trigger completion (keep the never-answered-until-submit q2; assert no completion message fired)
- ❌ Don't fix production code here — if the test finds a bug, report it (S2's territory), don't patch pipeline files in a test-only item

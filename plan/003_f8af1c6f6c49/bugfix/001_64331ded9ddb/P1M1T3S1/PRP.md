---
name: "Re-ask round-trip regression — public-seam integration test (re-ask → re-confirm → submission → settle → completion)"
description: "Permanent colocated vitest suite driving only public seams (executeInterrogate + lifecycle event bus + InterrogationPanel accept/submit + captured sendMessage), pinning both re-ask flavors (rule-1 same-value re-confirm, rule-2 re-answer) through submission, close pass, and the FR-5 completion injection."
---

## Goal

**Feature Goal**: Encode the PRD's BUG-001/BUG-002 repro journeys as a permanent scripted regression (`src/regression-reask-roundtrip.test.ts`, vitest, colocated — NOT a scripts/ probe): Scenario A (rule-1 re-ask, same-value enter re-confirm) and Scenario B (rule-2 re-ask, changed options, re-accept with auto-submit), each ending in delivery → agent_settled close → the FR-5 `interrogation-completion` record injected exactly once. This is the composition guarantee over all four M1 fixes (T1.S1 fall-through, T1.S2 auto path, T2.S1/T2.S2 no-op exclusions).

**Deliverable**: `src/regression-reask-roundtrip.test.ts` — harness modeled on `src/regression-phantom-submissions.test.ts` (copy `makePiHarness`/`tuiCtx`/`makeWalkthrough`/`stubTheme`/key constants), two scenario describes with per-step delivery-count and epoch assertions, and a file-header comment mapping the scenarios to PRD BUG-001/BUG-002 repro steps. No production changes expected; if a residual gap surfaces (candidate: the close-pass epoch proxy), fix minimally and note it in the decisions.md pin from P1.M1.T1.S1.

**Success Definition**: both scenarios run green end-to-end in-process (no external services); at every step the observable fingerprints (sendMessage count + customType + content substrings, `state.epoch`, per-question status) match the PRD's expectations; full `npm test` + `npm run typecheck` green.

## User Persona (if applicable)

**Target User**: Future waves of the pi-interrogator codebase (the test is the re-ask contract pin, cited by P1.M3.T2.S1's docs); the end user is the indirect beneficiary — the re-ask loop that previously wedged now provably completes.

**Use Case**: Any future change to submit(), accept paths, lifecycle, or completion runs this suite; a regression in the re-ask confirmation loop fails CI immediately instead of shipping as a release blocker.

**User Journey**: Agent upserts → user answers → submits (epoch 2) → agent rule-1/rule-2 re-asks → user re-confirms (same value or fresh pick) → submission 2 delivers (epoch 3) → agent settles → question closes → the full Q&A record is injected once → panel dismissed, state cleared.

**Pain Points Addressed**: Both release blockers (silent re-ask wedges) were found by adversarial probes that then evaporated; this suite makes the exact repro permanent.

## Why

- PRD h2.0/h2.1: the re-ask/re-confirmation loop wedges "block the completion injection that is the product's core deliverable". The four M1 fixes each have unit tests, but nothing pins their COMPOSITION — the wedge was precisely a composition failure (no-op exclusion + empty-diff fall-through + auto path + close pass interacting).
- architecture/system_context.md §Test conventions (binding): "End-to-end probes (PRD's harness): vite-node headless scripts driving ONLY public seams … M1.T3 encodes this as a permanent regression test."
- P1.M3.T2.S1's docs cite this test as the guarantee; it must exist and be green before that sweep.

## What

1. **File**: `src/regression-reask-roundtrip.test.ts` — vitest, colocated, header comment mapping Scenario A → PRD h2.1/h3.0 (BUG-001) steps 1-5 and Scenario B → PRD h2.2/h3.1 (BUG-002) steps, stating these are the permanent encodings of the vite-node probes.
2. **Harness** (adapted from `src/regression-phantom-submissions.test.ts`, verified this session):
   - `makePiHarness()` — `pi.on` captures handlers; `emit(event, payload?)` fires them (extend the model to pass a payload — needed for tool events).
   - `createLifecycle(h.pi, { onAfterClosePass: createCompletionTrigger(h.pi, { lifecycle: { dismissPanel: () => lifecycle.dismissPanel() }, ctx: { isIdle: () => true } }) })`.
   - `panelOf()` constructing `InterrogationPanel` with `delivery: { sendMessage: h.sendMessage, isIdle: () => true, noteSubmissionDelivered: () => lifecycle.noteSubmissionDelivered() }`, `config: DEFAULT_CONFIG`, `drafts: new DraftStore()`, `editorFactory: () => fakeEditor()`.
   - `tuiCtx()` = `{ mode: "tui", hasUI: true, model: { contextWindow: 200_000 } }`; `executeInterrogate(args, tuiCtx(), DEFAULT_CONFIG)`.
   - Re-ask trigger (host simulation — executeInterrogate does NOT emit tool events): `emit("tool_execution_start", { toolCallId: "tc1", toolName: "interrogate", args: upsertArgs })` BEFORE, then the real `executeInterrogate` upsert, then `emit("tool_execution_end", { toolCallId: "tc1", toolName: "interrogate", result: undefined, isError: false })`. Lifecycle stashes start-args by toolCallId and flips touched `submitted` ids to `reasked` on end (lifecycle.ts:169-204 — verified shapes).
3. **Scenario A (rule-1, PRD BUG-001 repro)**:
   1. Upsert q1 (choice a/b, no recommendation needed) epoch 1 → panel; accept 'a' (cursor 0, ENTER); ctrl+s → assert 1 delivery (`customType === "interrogation-submission"`, content contains `q1: a`), epoch 2, status `submitted`.
   2. Rule-1 re-ask: `executeInterrogate({ epoch: 2, questions: [{ ...q1, rev: 1, prompt: "p2?" }] }, …)` wrapped in start/end events → assert status `reasked`, answer still `a` (kept).
   3. Remount panel; caret pins to the recorded 'a' row; ENTER → assert status `answered` (the T2.S1 exclusion), still 1 delivery.
   4. ctrl+s → assert 2nd delivery, epoch 3, status `submitted`, flash is NOT "nothing to submit" (assert via the hard fingerprints: delivery count + epoch; check `panel`'s flash accessor if trivially available, else skip the string).
   5. `emit("agent_settled")` → status `closed`; completion fires: final sendMessage is the completion record (content contains "INTERROGATION COMPLETE"), total sendMessage count exact, state cleared.
4. **Scenario B (rule-2, PRD BUG-002 repro)**:
   1. Same seed with options [a,b,c]; accept 'a'; ctrl+s → 1 delivery, epoch 2, `submitted`.
   2. Rule-2 re-ask: upsert with options [a,b,d], rev echoed, epoch 2, wrapped in tool events → assert status `reasked`, answer `undefined` (reset by merge).
   3. Remount panel; re-accept 'a' (ENTER) → commit; with zero unanswered remaining, **maybeAutoSubmit fires automatically — NO ctrl+s** (AUTOSUBMIT-001 via the T1.S2 empty-diff transition) → assert 2nd delivery, epoch 3, status `submitted`.
   4. `emit("agent_settled")` → `closed`; completion record delivered exactly once; counts/epoch asserted.
5. **Assertions discipline**: at EVERY step assert the PRD's observable fingerprints — sendMessage call count, customType, content substrings, `getState()!.epoch`, `getQuestion("q1")!.status` (+ `.answer?.value`). No internals, no mocks beyond the fake pi/editor (public seams only).
6. **Residual gaps**: if the composition exposes one, fix minimally within this subtask (candidate: lifecycle.ts:53-57 close-pass "epoch-proxy invariant" — status `submitted` ≡ submitted-at-latest-epoch — interacting with T1.S1's flush) and append a note to the decisions.md pin created by P1.M1.T1.S1.

### Success Criteria

- [ ] Scenario A end-to-end: re-ask keeps answer → same-value enter re-marks `answered` → ctrl+s delivers sub2 (epoch 3) → settle closes → one completion injection, state cleared
- [ ] Scenario B end-to-end: rule-2 resets answer → re-accept auto-submits (no ctrl+s) → delivery epoch 3 → settle closes → one completion injection
- [ ] Delivery counts and epoch values asserted at each step; no "nothing to submit" wedge anywhere
- [ ] File header maps scenarios to PRD BUG-001/BUG-002 repro steps
- [ ] `npm test` + `npm run typecheck` green; no production-code change unless a gap surfaced (then minimal + noted in the decisions.md pin)

## All Needed Context

### Context Completeness Check

The PRP contains the full harness recipe (verified against the model test this session), the exact lifecycle event shapes with the toolCallId correlation mechanic, the rule-1/rule-2 merge semantics, the step-by-step assertion fingerprints for both scenarios, and the contracts of the four consumed M1 fixes. An agent needs this PRP plus `src/regression-phantom-submissions.test.ts`, `src/lifecycle.ts`, `src/panel/panel.ts` (constructor args), and `src/tool.ts` (executor signature).

### Documentation & References

```yaml
- file: src/regression-phantom-submissions.test.ts
  why: "THE MODEL — copy makePiHarness, tuiCtx, makeWalkthrough (lifecycle+completionTrigger wiring, panelOf with delivery seam), fakeEditor, stubTheme, key constants"
  pattern: "public-seam composition: real executeInterrogate + real lifecycle + real panel; only pi/editor faked; sendMessage captured via vi.fn"
  gotcha: "its emit() passes only {type: event} — EXTEND to accept a payload for tool_execution_start/end; the lifecycle end-handler requires event.toolName, event.toolCallId, !event.isError"

- file: src/lifecycle.ts
  why: "the re-ask machinery under test — start handler stashes args by toolCallId (:169-175), end handler flips touched submitted→reasked keeping answers (:187-204), agent_settled→runClosePass (:208-212), close pass closes submitted-not-reaskedThisRun (:213-243)"
  pattern: "exact event payload shapes verified in research/notes.md; lifecycle.test.ts :137-143 shows the canonical start/end/emit recipe"
  gotcha: "executeInterrogate does NOT emit tool events — the harness simulates the host: start → upsert → end, matching toolCallIds"

- file: src/completion.ts
  why: "completion trigger semantics — BLOCKING = {open, reasked, answered, submitted, moot} (:66-73); one-time guard; order buildCompletion → deliverSubmission → dismissPanel → clearForCompletion (:94-135)"
  pattern: "assert the completion sendMessage content contains 'INTERROGATION COMPLETE' and that it fired EXACTLY once (sendMessage count arithmetic)"

- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/architecture/reask-confirmation-loop.md
  why: "THE seam map — verified anchors for every step of the loop (actions.ts no-ops, submit early-return, maybeAutoSubmit, lifecycle flip, merge rules, completion BLOCKING)"
  critical: "§2 is the control-flow narrative of exactly the loops this test scripts"

- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/architecture/spec-contracts.md
  why: "§11 auto-close algorithm VERBATIM (the contract this test pins) + §12 D-R6/bridge-removal history (why the panel path lacked the flush)"
  section: "§11 state-and-persistence.md — auto-close algorithm"

- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/architecture/system_context.md
  why: "§Test conventions (binding): public-seam vite-node probe pattern this suite encodes permanently"

- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/P1M1T2S2/PRP.md
  why: "PREDECESSOR CONTRACT (in flight): writeInEnter reasked exclusion + kind-preserving commit — its unit tests cover the editor path; this integration covers the acceptOptionIndex path (Scenario A) and the auto path (Scenario B). Land on top of it."
  gotcha: "T2.S2's kind-preservation (custom flag) is NOT exercised by these scenarios (option re-accepts only) — do not duplicate its unit coverage"

- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/P1M1T1S1/PRP.md
  why: "CONTRACT (COMPLETE): submit() pendingIds fall-through — the flush that lets Scenario A's step 4 deliver despite the empty answer-signature diff. Consume; its decisions.md pin is where any residual-gap note goes"

- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/P1M1T3S1/research/notes.md
  why: "verified harness recipe, event shapes, rule-1/rule-2 semantics, fingerprint list, residual-gap candidate — this PRP's evidence base"
```

### Current Codebase tree (relevant slice)

```bash
src/
  regression-phantom-submissions.test.ts  # THE harness model (copy/adapt)
  tool.ts            # executeInterrogate(args, ctx, config) public seam
  lifecycle.ts       # createLifecycle(pi, opts) + event handlers (re-ask flip, close pass)
  completion.ts      # createCompletionTrigger + attemptCompletion (BLOCKING set)
  panel/panel.ts     # InterrogationPanel constructor args (tui/theme/done/state/config/drafts/editorFactory/delivery)
  panel/actions.ts   # acceptOptionIndex / submit / maybeAutoSubmit (fixed by M1.T1/T2)
  merge.ts           # rule 1 vs rule 2 semantics
  state.ts           # getState/resetState/getQuestion/epoch
spec/decisions.md    # the P1.M1.T1.S1 pin (residual-gap notes go here)
```

### Desired Codebase tree

```bash
src/
  regression-reask-roundtrip.test.ts   # NEW — the only expected artifact
# (minimal production fix + decisions.md note ONLY if a residual gap surfaces)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: executeInterrogate emits NO tool events — the harness must emit tool_execution_start
// (with args) → run the upsert → emit tool_execution_end with the SAME toolCallId. The end handler
// reads args from the start stash; mismatched ids = silent no-op.
// CRITICAL: the end handler needs !event.isError AND isUpsertArgs(args) (questions non-empty array).
// Rule-1 re-ask upsert MUST echo rev (current) AND epoch (current) or assertFresh throws StaleError.
// Delivery messages: customType "interrogation-submission" for deltas; the completion record's
// content begins "INTERROGATION COMPLETE" (verify the exact customType from the captured call).
// After completion, state is CLEARED (clearForCompletion) — getQuestion returns undefined; the
// completion sendMessage is the LAST call — assert exact total counts.
// rule-2 (changed options) resets the answer to undefined at merge time — the panel caret seeds to
// display row 0 (no recorded answer) — Scenario B's re-accept is a FRESH accept, not a pinned one.
// beforeEach(resetState()) is mandatory (the model test does it); vi.mock nothing — real modules.
// ESM relative imports use ".js" suffix.
```

## Implementation Blueprint

### Data models and structure

No production data models. Test-local helpers: `makePiHarness` (payload-capable emit), `fakeEditor`, `stubTheme`, `choiceQ(id, options?)`, `reask(upsertArgs)` (start→executeInterrogate→end wrapper), `panelOf()`, `tuiCtx`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: HARNESS — src/regression-reask-roundtrip.test.ts
  - COPY from regression-phantom-submissions.test.ts: makePiHarness (EXTEND emit to pass a payload), fakeEditor, stubTheme, tuiCtx, key constants, beforeEach(resetState)
  - ADAPT makeWalkthrough: same lifecycle+completionTrigger+panel wiring
  - ADD reaskHost(upsertArgs): emit tool_execution_start {toolCallId, toolName:"interrogate", args} → executeInterrogate(upsertArgs, tuiCtx(), DEFAULT_CONFIG) → emit tool_execution_end {toolCallId, toolName:"interrogate", result: undefined, isError: false}
  - ADD header comment mapping Scenario A/B to PRD BUG-001/BUG-002 repro steps (Mode A)

Task 2: SCENARIO A (rule-1) — describe "rule-1 re-ask: same-value re-confirm completes the loop (BUG-001)"
  - STEPS per What §3, asserting after each: sendMessage count, customType, content substring, state.epoch, q1.status (+ answer.value)
  - FINAL: agent_settled → closed; completion record (content contains "INTERROGATION COMPLETE") exactly once; state cleared

Task 3: SCENARIO B (rule-2) — describe "rule-2 re-ask: re-answer auto-submits and completes (BUG-002)"
  - STEPS per What §4 — the auto path: NO ctrl+s after the re-accept; the delivery arrives via maybeAutoSubmit's empty-diff transition (T1.S2)
  - FINAL: same completion assertions as A

Task 4: FULL-SUITE RUN + residual-gap triage
  - RUN: npm test && npm run typecheck
  - IF a step cannot be made green because a production seam miscomposes (prime suspect: lifecycle.ts:53-57 epoch-proxy vs T1.S1's flush): fix minimally, add a unit test for the fix, and append a note to the decisions.md pin from P1.M1.T1.S1
  - IF the harness itself is at fault (wrong event shape, missing toolCallId correlation): fix the harness, never the assertion
```

### Implementation Patterns & Key Details

```ts
// The re-ask host wrapper (the one non-obvious mechanic):
function reaskHost(h: Harness, upsertArgs: unknown): void {
  const toolCallId = `tc-${++seq}`;
  h.emit("tool_execution_start", { toolCallId, toolName: "interrogate", args: upsertArgs });
  executeInterrogate(upsertArgs as InterrogateParamsValue, tuiCtx(), DEFAULT_CONFIG);
  h.emit("tool_execution_end", { toolCallId, toolName: "interrogate", result: undefined, isError: false });
}
// start/end share toolCallId; the end handler reads the stashed args — the
// flip applies to touched ids whose CURRENT status is "submitted".

// Fingerprint assertion helper:
const deliveries = () => h.sendMessage.mock.calls.filter((c) => c[0]?.customType === "interrogation-submission");
// epoch/status: getState()!.epoch / getState()!.getQuestion("q1")!.status
```

### Integration Points

```yaml
CONSUMED-FIXES (do not re-implement):
  - "P1.M1.T1.S1 submit() pendingIds fall-through (COMPLETE)"
  - "P1.M1.T1.S2 maybeAutoSubmit empty-diff transition (COMPLETE)"
  - "P1.M1.T2.S1 acceptOptionIndex reasked exclusion (Implementing — assume landed)"
  - "P1.M1.T2.S2 writeInEnter reasked exclusion (in flight — not exercised here; option re-accepts only)"
CONSUMED-BY:
  - "P1.M3.T2.S1 docs sweep cites this suite as the re-ask contract pin"
DO-NOT-TOUCH:
  - "No vi.mock of any src module — real modules, fake pi/editor only (the model test's discipline)"
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # new test file type-checks
```

### Level 2: Unit Tests

```bash
npx vitest run src/regression-reask-roundtrip.test.ts -v   # both scenarios green
npm test                                                  # full suite green (no regressions to the M1 unit tests)
```

### Level 3: Integration Testing

The suite IS the integration test — no further runtime validation. Optional probe parity: the scenarios must cover every step of the PRD's Steps-to-Reproduce lists (BUG-001 h2.1/h3.0, BUG-002 h2.2/h3.1); diff them line by line when writing the header mapping.

### Level 4: Creative & Domain-Specific Validation

```bash
# Prove the test actually guards: temporarily revert one consumed fix (e.g. comment the reasked
# exclusion in acceptOptionIndex) → Scenario A must FAIL at step 3. Restore. (Do this mentally or
# in a scratch edit; never commit the sabotage.)
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean
- [ ] `npm test` fully green including the new suite

### Feature Validation

- [ ] Scenario A: re-ask → same-value enter re-confirms → ctrl+s delivers (epoch 3) → settle → completion once
- [ ] Scenario B: rule-2 reset → re-accept auto-submits → settle → completion once
- [ ] Per-step fingerprints asserted (delivery counts, customTypes, epoch, statuses)
- [ ] No "nothing to submit" wedge in either scenario
- [ ] Header maps scenarios to the PRD repro steps

### Code Quality Validation

- [ ] Public seams only (executeInterrogate, lifecycle events, panel actions, captured sendMessage) — no internals, no module mocks
- [ ] Harness adapted from the model test, not reinvented
- [ ] Any residual production fix is minimal, unit-tested, and noted in the decisions.md pin

### Documentation & Deployment

- [ ] File-header comment (Mode A) present; no user-facing/config/API surface change
- [ ] No new dependencies

---

## Anti-Patterns to Avoid

- ❌ Don't write a scripts/ probe — the item contract mandates a permanent colocated vitest suite
- ❌ Don't vi.mock src modules — the model test's discipline is real modules + fake pi/editor; mocks would test the mocks
- ❌ Don't emit tool_execution_end without a matching start (args are stashed by toolCallId — the flip silently no-ops)
- ❌ Don't skip the rev/epoch echo on re-ask upserts — assertFresh throws StaleError and the scenario dies at the wrong step
- ❌ Don't press ctrl+s in Scenario B — the point is the AUTO path (T1.S2); a manual submit would mask its absence
- ❌ Don't weaken assertions to "eventually delivers" — exact counts and epoch values per step are the PRD's fingerprints
- ❌ Don't fix a surfaced gap broadly — minimal fix + decisions.md note; broad refactors belong to a future wave

# PRP — P1.M2.T4.S1: Emit submit-result nack + completeFlow on unexpected internal errors in the bridge submit handler

---
name: "P1.M2.T4.S1 — Emit submit-result nack + completeFlow on unexpected internal errors in the bridge submit handler (BUG-007, FR-32/D-R6)"
description: "BUG-007: the pi-ask submit handler's outer bare catch (src/remote-bridge.ts:258-268) swallows unexpected internal throws from recordRemoteSubmission with NO submit-result ack (remote client hangs) and no flow teardown. Fix (architecture/bug-007-bridge-errors.md option (a), PRD h2.5 recommendation 6): inside handleSubmit, wrap the recordRemoteSubmission call (:348) in try/catch; on ANY throw, emitSubmitResult with a new 'internal_error' literal (widen the union at :289) + completeFlow(flowId), then return. Keep the outer bare catch as a strictly last-resort bus guard (reword its false 'state consistency is guarded upstream' comment). NO rollback — recordRemoteSubmission mutates state first (applyAnswer :130 → markSubmitted :155 → snapshot/epoch), snapshot ring + epoch are append-only; state stays half-mutated in the documented worst case, healed by the next upsert resurface. TDD with the FakeBus + makePi + makeBridge harness (remote-bridge.test.ts:21-75), injecting a throwing state via RemoteBridgeOptions.getState. Mode A docs: spec/product-requirements.md FR-32, spec/decisions.md D-R6, spec/architecture.md:158 pipeline note; spec/tool-protocol.md documents NO submit-result error literals (verified — no change); README has no bridge-ack passage (verified — no change)."
---

## Goal

**Feature Goal**: PRD h3.6 / h2.5 recommendation 6: "In the bridge submit handler, emit a submit-result nack … when an unexpected internal error escapes the pipeline, so remote clients never hang without an ack." Any internal throw (applyAnswer listener, computeDiff, markSubmitted, buildSubmission, deliverSubmission, maybeAutoSubmit hook, injected lifecycle) during a bridge answer submit produces an `internal_error` nack + flow completion instead of silence.

**Deliverable**: Modified `src/remote-bridge.ts` (widened error union + try/catch around the recordRemoteSubmission call + docstring updates), new tests in `src/remote-bridge.test.ts`, and one-sentence doc syncs in `spec/product-requirements.md` / `spec/decisions.md` / `spec/architecture.md`. No new files.

**Success Definition**: `npm run typecheck` + `npm test` green; new tests assert (1) a throwing state → `submit-result` event on the FakeBus with `ok:false`, `error:"internal_error"` AND a `completed` event (flow torn down — a follow-up submit on the same flowId nacks `flow_not_found`); (2) valid submits still ack `ok:true` + completed + resurface; (3) validation nacks (`invalid_answer`) and `flow_not_found` nacks unchanged. No attempt at rollback anywhere.

## User Persona

**Target User**: The remote client user (pi-ask / remote-pi Flutter app) submitting answers over the bridge.

**Use Case**: The user answers questions in the remote UI and submits; if an internal error hits mid-pipeline (a hostile-but-possible listener throw, a delivery failure), the client still receives its ack (as a warning) and the flow resolves — never a hang to client timeout.

**User Journey**: submit → (internal error) → client receives `{ok:false, error:"internal_error", message}` + flow `completed` → client shows a warning; the interrogation surface self-heals on the next model upsert (resurface) or `/interrogate`-style reopen.

**Pain Points Addressed**: BUG-007 — swallowed internal errors left the client with no ack (hang until timeout) AND state half-mutated with no delta delivered and no `noteSubmissionDelivered` (close-pass deadlock risk).

## Why

- PRD h2.0 (minor issue 4 / BUG-007) and h2.5 recommendation 6, quoted in the PRD context above.
- FR-32/D-R6 parity: "submit acks (ok or nack) flow back to the client" — today the nack half of that contract silently fails on internal errors.
- `deliverSubmission` throws propagate BY CONTRACT (src/remote-submit.ts:118: "the bridge's handler guards the bus") — the handler must now also ACK, not merely guard.
- Independent of all sibling bugfixes (BUG-001..006, BUG-008): touches only remote-bridge.ts's ack path; P1.M2.T3.S2 (delivery budget cap) is upstream-but-orthogonal — it edits delivery.ts's entry shaping, not the submit call chain's error surface.

## What

[User-visible behavior: remote clients always receive a submit-result (ok or nack); internal failures resolve the flow with a warning instead of hanging.]

### Behavior contract (exact)

1. **Widen the error union** in `emitSubmitResult`'s signature (remote-bridge.ts ~:289): `ok: true | { error: "flow_not_found" | "invalid_answer" | "internal_error"; message: string }`. Payload shape unchanged (`{version:1, requestId, flowId, ok:false, error, message}`); pi-ask's client treats any `ok:false` as a warning — arbitrary error strings are permitted by the contract.
2. **Wrap the answer path**: in `handleSubmit`, replace the bare call
   ```ts
   recordRemoteSubmission(pi, state, answers.applied, {
     lifecycle: opts.lifecycle,
     maybeAutoSubmit: opts.maybeAutoSubmit,
   });
   ```
   (~:348) with a try/catch: on throw → `emitSubmitResult(requestId, flowId, { error: "internal_error", message: "Internal error during submission — state may be partially applied; the next upsert resurfaces live questions." })` (message wording may vary but must say it's internal and non-fatal) → `completeFlow(flowId)` → `return` (skip the ok-ack, skip resurface — the surface may be inconsistent; the next upsert re-emits).
3. **Keep the outer bare catch** (:258–268) strictly as a last-resort bus guard (it has no parsed requestId/flowId — it catches throws from the malformed-input early paths and any emitSubmitResult/completeFlow failure). REWORD its comment: "state consistency is guarded upstream" is false — e.g. "last-resort bus guard only; the answer path above acks internal_error itself".
4. **NO rollback**: do not attempt to undo applyAnswer/markSubmitted/snapshot/epoch. State half-mutated is the documented worst case (D-R6 resurface heals). Do NOT touch remote-submit.ts's ordering (its module comment: "load-bearing, never reorder").
5. **Everything else unchanged**: malformed/foreign/missing-flowId/missing-state/cancel/invalid-answer paths byte-identical; the happy path still acks `ok:true` → `completeFlow` → conditional resurface.
6. **Docs ([Mode A], spec/ is living documentation)**: one sentence each — spec/product-requirements.md FR-32 (internal errors nack `internal_error` + complete the flow), spec/decisions.md D-R6 (:41), spec/architecture.md §Bridge submit pipeline (:158, note the internal_error branch after `recordRemoteSubmission`). spec/tool-protocol.md documents NO submit-result error literals (grep-verified) — no change. README verified to have no bridge-ack passage — no change. Also update remote-bridge.ts's module docstring ("A submit acks submit-result then completes the flow" — add the internal-error nack) and the handleSubmit docstring region (:230–238, "every branch defensive, never throws into the emitter" remains true).

### Success Criteria

- [ ] Throwing state → FakeBus records `submit-result` with `ok:false`, `error:"internal_error"`, echoing requestId+flowId; AND `completed` emitted (flow gone — a second submit on the same flowId nacks `flow_not_found`)
- [ ] The outer listener itself does NOT throw into the FakeBus emit loop (bus guard intact)
- [ ] Valid submit test still green: `ok:true` + completed + resurface; ledger (`noteSubmissionDelivered`) fires; `sent` has the delta
- [ ] Validation nack test still green: `invalid_answer` + `ask:replay` re-emit; cancel → defer unchanged
- [ ] `grep -n "internal_error" src/remote-bridge.ts` shows the union member + the nack emission; `npm run typecheck` + `npm test` green
- [ ] Zero changes to src/remote-submit.ts, src/state.ts, src/delivery.ts

## All Needed Context

### Context Completeness Check

The touchpoints are enumerated with verified current-tree anchors, the exact code shapes to change are quoted, the test harness and the injection lever for forcing a throw are described at fixture level, and the no-rollback rationale is documented. An implementer needs nothing beyond this PRP + the repo.

### Documentation & References

```yaml
- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/architecture/bug-007-bridge-errors.md
  why: THE research doc — verdict (both claims confirmed), exact anchors for the catch (:258-268), emitSubmitResult (:287-298, union at :289), handleSubmit paths (:300-361, requestId/flowId at :303-304, recordRemoteSubmission at :348), the recordRemoteSubmission step order (remote-submit.ts:125-184), fix option (a) verbatim, the pi-ask error-string-permissiveness note, and the full test inventory
  pattern: implement option (a) exactly
  gotcha: its "also consider" tail (ordering the ack before maybeAutoSubmit / outcome-based acks) is OPTIONAL refinement, NOT required — the contract for this item is the unconditional internal_error nack on any throw

- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/P1M2T4S1/research/bug-007-notes.md
  why: distilled anchor verification against the CURRENT tree + doc-sync target list + the flow-registry assertion idea (second submit nacks flow_not_found proves completeFlow ran)
  pattern: use as the work checklist

- file: src/remote-bridge.ts
  why: the file being edited — module docstring (:20-60, event names + "A submit acks submit-result then completes the flow"), listener registration + bare catch (:258-268), emitCompleted/completeFlow (:277-285), emitSubmitResult (:287-298), handleSubmit (:300-361)
  pattern: the nack mirrors the existing flow_not_found nacks (:305-311, :326-331) — same emitSubmitResult shape, same message style
  gotcha: emitSubmitResult's ok param is a discriminated union — widening it is a type-level change only; check for other literal-typed references (grep the union) before assuming one edit suffices

- file: src/remote-submit.ts
  why: read-only context — recordRemoteSubmission (:121-184) ordering and its :118 docstring "Throws propagate from deliverSubmission by contract"; RemoteSubmitOutcome (:97-100)
  pattern: DO NOT modify; do NOT reorder; no rollback
  gotcha: nothing_shippable is a RETURN VALUE ({ok:false, reason}) not a throw — it already acks ok:true today and must keep doing so

- file: src/remote-bridge.test.ts
  why: the harness — FakeBus (:25-44), makePi (:46-57), makeBridge (:60-75), noteDelivered ledger, fixtureState/setState, submit() helper (:244), describe("submit handling") (:248) with all the pinned paths, tail-hook test (:613)
  pattern: new tests go inside describe("submit handling") using the same fixtures; inject the throwing state via RemoteBridgeOptions.getState (makeBridge currently doesn't forward getState — extend it with an options param or build the bridge inline in the new test)
  gotcha: getState is a RemoteBridgeOptions field consulted at (:325 `(opts.getState ?? getState)()`) — the throwing wrapper must delegate upsertQuestion/serialize/liveQuestions etc. to a real fixtureState so mapWireAnswers succeeds and the throw lands INSIDE recordRemoteSubmission's applyAnswer

- files: spec/product-requirements.md (:65-67 FR-31..33), spec/decisions.md (:40-41 D-R5/D-R6), spec/architecture.md (:38, :149-162 bridge pipeline)
  why: Mode A living-doc sync targets (one sentence each; architecture.md:158's ASCII pipeline gains the internal_error branch note)
  gotcha: spec/tool-protocol.md documents no submit-result error literals (grep-verified) and README.md has no bridge-ack passage (verified) — do NOT touch either

- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/P1M2T3S2/PRP.md
  why: the parallel-item contract (delivery budget cap, src/delivery.ts) — orthogonal to this fix; confirms no overlap in files or call-chain shape
```

### Current Codebase tree (relevant slice)

```bash
src/
  remote-bridge.ts        # submit handler + ack union + nacks — EDIT
  remote-bridge.test.ts   # FakeBus/makePi/makeBridge harness + submit tests — EDIT (add tests)
  remote-submit.ts        # recordRemoteSubmission pipeline — READ-ONLY
  state.ts, delivery.ts   # READ-ONLY
spec/
  product-requirements.md # FR-32 sentence — EDIT
  decisions.md            # D-R6 sentence — EDIT
  architecture.md         # pipeline note — EDIT
```

### Desired Codebase tree

```bash
# same files; zero new files
src/remote-bridge.ts        # internal_error literal + wrapped answer path + docstrings
src/remote-bridge.test.ts   # 3+ new tests (nack+complete, flow-registry teardown, unchanged paths)
```

### Known Gotchas of our codebase

```ts
// CRITICAL: the outer bare catch has NO access to requestId/flowId (they are
// parsed inside handleSubmit) — that is exactly why the nack must live INSIDE
// handleSubmit around recordRemoteSubmission, not in the outer catch.

// CRITICAL: do NOT rollback. state.applyAnswer/markSubmitted run before any
// delivery; snapshots ring + epoch are append-only with no undo API. The
// half-mutated state is the documented worst case; the next upsert resurface
// heals the surface (D-R6). Attempting rollback WILL corrupt the ring.

// CRITICAL: the throwing-state injection must delegate EVERYTHING except the
// throw to a real fixtureState — mapWireAnswers (:369-432, non-throwing
// validation) runs BEFORE recordRemoteSubmission and needs working state, or
// the test will nack invalid_answer instead of hitting the internal path.

// nothing_shippable is a return value, not a throw — the happy-path test
// "identical re-selection" keeps acking ok:true. Do not conflate.

// completeFlow on the nack path means a RETRY with the same flowId nacks
// flow_not_found — intended (the client re-renders from the next started
// flow). Assert it; do not "fix" it.

// pi-ask contract permits arbitrary error strings (client warns on ok:false)
// — widening the union is wire-compatible; no client changes exist in-repo.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: RED — write the failing tests first (src/remote-bridge.test.ts)
  - TEST internal_error_nack_on_throwing_state: makeBridge-style wiring, but
    createRemoteBridge with getState: () => throwingState (fixtureState
    wrapped: applyAnswer throws, everything else delegates). Emit a started
    flow (bridge.emitFlow or the upsert path the existing tests use — see
    describe("emitFlow lifecycle") :173), then submit(bus, flowId,
    {kind:"answer", answers:{q1:{values:["postgres"]}}}). ASSERT:
    bus.of("@eko24ive/pi-ask:submit-result") last entry = {version:1,
    requestId, flowId, ok:false, error:"internal_error", message:string};
    bus.of("@eko24ive/pi-ask:completed") contains {flowId}; sent is EMPTY
    (no delta); ledger.calls === 0
  - TEST flow_torn_down_after_internal_error: follow-up submit(bus, flowId,
    ...) on the same flowId → flow_not_found nack (proves completeFlow ran)
  - TEST guard: existing valid-submit / invalid-answer / cancel tests stay
    green unchanged (no edits to them)
  - RUN: npx vitest run src/remote-bridge.test.ts → new tests FAIL (no
    submit-result emitted on throw — bus.of(PI_ASK_SUBMIT_RESULT) empty)

Task 2: MODIFY src/remote-bridge.ts — the fix
  - WIDEN the emitSubmitResult union with "internal_error"
  - WRAP recordRemoteSubmission (~:348) in try/catch → nack + completeFlow +
    return; skip resurface on the nack path
  - REWORD the outer catch comment (:258-268 — remove the false "guarded
    upstream" claim; state it is a last-resort bus guard only)
  - UPDATE docstrings: module header (submit-ack sentence gains the
    internal_error nack), handleSubmit region (:230-238)

Task 3: RUN tests → green; npm run typecheck
  - npx vitest run src/remote-bridge.test.ts src/remote-submit.test.ts src/remote-compat.test.ts

Task 4: DOC SYNC ([Mode A] one sentence each)
  - spec/product-requirements.md FR-32; spec/decisions.md D-R6;
    spec/architecture.md :158 pipeline (internal_error branch note)
  - NO tool-protocol.md / README changes (verified absent)

Task 5: FULL validation
  - npm test; npm run typecheck
```

### Implementation Patterns & Key Details

```ts
// remote-bridge.ts — the answer path after the fix (shape only):
try {
  recordRemoteSubmission(pi, state, answers.applied, {
    lifecycle: opts.lifecycle,
    maybeAutoSubmit: opts.maybeAutoSubmit,
  });
} catch {
  // BUG-007: ack the client + tear the flow down so it never hangs. State
  // may be half-mutated (no rollback — snapshots/epoch are append-only);
  // the next upsert resurface heals the surface (D-R6).
  emitSubmitResult(requestId, flowId, {
    error: "internal_error",
    message: "Internal error during submission. State may be partially applied; a later upsert resurfaces live questions.",
  });
  completeFlow(flowId);
  return;
}
// happy path unchanged: nothing_shippable is a RETURN VALUE (acks ok:true)
emitSubmitResult(requestId, flowId, true);
completeFlow(flowId);

// test throwing-state lever (delegating wrapper — everything but applyAnswer):
function throwingApplyState(base: InterrogationState): InterrogationState {
  return new Proxy(base, {
    get(target, prop) {
      if (prop === "applyAnswer") return () => { throw new Error("boom"); };
      const v = Reflect.get(target, prop);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}
```

### Integration Points

```yaml
NO new config, state, renderer, or panel surface. Consumers:
  - pi-ask / remote-pi clients: wire-compatible (arbitrary error strings
    already permitted; ok:false renders as a warning).
  - P1.M2.T3.S2 (parallel, delivery budget cap): orthogonal — it edits
    delivery.ts entry shaping, never the submit call chain's error surface.
  - P1.M3.T1.S1 regression sweep runs the whole suite including these tests.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # catches union-widening stragglers
```

### Level 2: Unit Tests

```bash
npx vitest run src/remote-bridge.test.ts -v     # new nack tests + all pinned paths
npx vitest run src/remote-submit.test.ts src/remote-compat.test.ts -v   # untouched neighbors
npm test                                        # whole suite
```

### Level 3: Contract sweep (grep gates)

```bash
grep -n "internal_error" src/remote-bridge.ts   # union member + nack emission present
grep -rn "rollback" src/                        # no rollback attempt anywhere
```

### Level 4: Manual (optional; human runbook item — NOT automation)

```bash
# Live bridge failure requires a genuinely throwing listener; covered by the
# injected-throw test. Manual check optional: valid remote submit still acks.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean; `npm test` green (incl. the 3+ new tests)
- [ ] FakeBus never receives a listener throw (outer guard unbroken)

### Feature Validation

- [ ] Throwing state → `submit-result` {ok:false, error:"internal_error", matching requestId/flowId} + `completed` + no delta sent + no noteSubmissionDelivered
- [ ] Flow registry torn down (retry → flow_not_found)
- [ ] Valid submits / invalid_answer nacks / cancel-defer / flow_not_found all unchanged
- [ ] No resurface emission on the nack path

### Code Quality Validation

- [ ] Only src/remote-bridge.ts + src/remote-bridge.test.ts + 3 spec files touched
- [ ] remote-submit.ts / state.ts / delivery.ts byte-identical; no rollback logic
- [ ] Docstrings updated (false "guarded upstream" claim removed); spec sentences landed

## Anti-Patterns to Avoid

- ❌ Emitting the nack from the outer bare catch (no parsed ids there — it cannot)
- ❌ Attempting state rollback (append-only snapshot ring + epoch; would corrupt)
- ❌ Reordering recordRemoteSubmission's steps or moving the ok-ack before the tail hook (out of scope; the unconditional internal_error nack is the contract)
- ❌ Treating `nothing_shippable` (return value) as an error — it acks ok:true
- ❌ Touching spec/tool-protocol.md or README (verified: nothing to sync)
- ❌ Using a real pi session or real events bus in tests — FakeBus + fake pi only

---

**Confidence Score**: 9/10 — the bug report's fix option (a) is a surgical, single-file change with verified anchors, an existing harness, a clean throw-injection lever (RemoteBridgeOptions.getState), and zero coupling to the parallel delivery-cap item; the only residual risk is anchor drift from the parallel item, which does not edit remote-bridge.ts.

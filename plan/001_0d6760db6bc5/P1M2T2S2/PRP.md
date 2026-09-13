---
name: "P1.M2.T2.S2 — Completion trigger + one-time injection (completion.ts)"
description: "Create src/completion.ts: a completion trigger that plugs into lifecycle's onAfterClosePass hook (P1.M2.T2.S1), fires the completion flow EXACTLY ONCE per interrogation when no questions remain in {open, reasked, answered, submitted, moot} after a close pass — buildCompletion → deliverSubmission → dismissPanel → clearForCompletion, in that order (h3.9). Add a `completed` flag on InterrogationState as the one-time guard. Wire it in index.ts. NO panel UI (P1.M3.T1.S1), NO recap-card renderer (P1.M7.T3.S2), NO persistence (M7). Mode A JSDoc on the completion invariant."
---

## Goal

**Feature Goal**: Implement the completion trigger (h3.9, h2.44 tail, FR-5): after each agent_settled close pass, if NO questions remain in any active status {open, reasked, answered, submitted} AND no moot questions remain, the completion flow fires exactly once — inject the ONE full interrogation-completion record (h2.46, built by P1.M2.T1.S3's `buildCompletion`, delivered via P1.M2.T1.S2's `deliverSubmission`), dismiss the panel (lifecycle `dismissPanel()` stub — real panel in P1.M3.T1.S1), and clear in-memory state while retaining the audit trail (`clearForCompletion()`).

**Deliverable**: `src/completion.ts` with `createCompletionTrigger(pi, opts?)` + types; `src/completion.test.ts`; `src/state.ts` minimal addition of the `completed` one-time flag (+ `SerializedState` field); `src/index.ts` wiring `createLifecycle(pi, { onAfterClosePass: trigger })`.

**Success Definition**: `npm test` + `npm run typecheck` green; completion fires exactly once even across double settles, repeat close passes, and new upserts after completion was blocked; completion does NOT fire while any question is open/answered/submitted/reasked/moot (incl. the h2.37 edge: 0 open + pending submissions → waits until the close pass after the next agent reply); order of side effects is build → deliver → dismiss → clear; state after completion has zero questions but retained goal/epoch/snapshots and `completed === true`.

## User Persona

**Target User**: The TUI user whose interrogation just finished — they see the recap card and the panel closes itself; the model receives the full Q&A record once and writes the deliverable (commitment 2 / Q30).

**Use Case**: Agent asks 4 questions, user answers, submits, agent settles without re-asking → close pass archives them → zero active questions → completion trigger injects `interrogation-completion`, panel dismisses, state clears (entries kept for audit).

**User Journey**: last open question closes → full record injected → recap card appears (renderer in M7) → panel dismisses → session free.

**Pain Points Addressed**: interrogation "ending" invisibly; the model never getting the full consolidated record; double-injection if settle fires twice.

## Why

- h3.9 mandates the exact flow and side-effect order; h2.44's tail makes completion the last step of the auto-close algorithm; h2.46 is the record content (already built by S3).
- Consumes the seam P1.M2.T2.S1 deliberately left: `LifecycleOptions.onAfterClosePass(result)` + `dismissPanel()`.
- Proves AC-14 (completion: one full injection, recap card, state cleared with audit trail).
- Output consumed by the panel (dismiss behavior, M3) and the recap-card renderer (M7.T3.S2, reads `details` from the injected message).

## What

### `src/completion.ts` — public surface

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ClosePassResult, Lifecycle } from "./lifecycle.js";

export interface CompletionTriggerOptions {
  /** Lifecycle whose dismissPanel() is invoked (h3.9 "lifecycle: dismiss panel"). */
  lifecycle: Pick<Lifecycle, "dismissPanel">;
  /** State override (tests / reconstruction); defaults to getState(). */
  getState?: () => InterrogationState | undefined;
  /** Batch-notes source (draft store in P1.M4.T2.S2); absent → undefined. */
  getBatchNotes?: () => string[] | undefined;
  /** Idle probe for deliverSubmission; mirrors ExtensionContext.isIdle. */
  ctx?: { isIdle?: () => boolean };
}

export interface CompletionResult {
  fired: boolean;
  reason?: "no-state" | "already-completed" | "active-questions-remain";
}

export function createCompletionTrigger(
  pi: Pick<ExtensionAPI, "sendMessage">,
  opts: CompletionTriggerOptions,
): (result: ClosePassResult) => void;
```

### Trigger algorithm (h3.9 + h2.44 tail, exact)

The returned function is the `onAfterClosePass` callback (called by the lifecycle engine after every close pass — see P1.M2.T2.S1 PRP §public surface):

1. `const state = (opts.getState ?? getState)()`; if `undefined` → return `{ fired: false, reason: "no-state" }`.
2. **One-time guard**: if `state.completed === true` → return `{ fired: false, reason: "already-completed" }`. (The flag lives on state — see Integration Points / state.ts change below.)
3. **Completion predicate**: compute from `state.orderedQuestions()` — fire only when NO question has status in `["open", "reasked", "answered", "submitted", "moot"]` (i.e. every question is `closed` or `withdrawn`, or there are zero questions at all — treat zero-questions-with-completed=false as completable only if the state ever had questions; if `order` is empty AND the state never had content, do not fire, return `active-questions-remain`). Do NOT trust `result.remainingActive` alone — it excludes `moot` by design in S1; recompute locally against the full status set so this module owns its predicate. If predicate fails → `{ fired: false, reason: "active-questions-remain" }`.
4. **Fire, in h3.9 order**:
   a. `const notes = opts.getBatchNotes?.()` (may be undefined — batch notes aren't stored in state; draft store arrives in P1.M4.T2.S2).
   b. `const msg = buildCompletion(state, notes)` — MUST run BEFORE any clearing (the record is built from the full state).
   c. `deliverSubmission(pi, msg, opts.ctx)` — exactly one `pi.sendMessage`, using the SAME options contract as submissions. The contract's requirement "must NOT triggerTurn if the agent is mid-reply — deliver via followUp" is satisfied by `deliverSubmission`'s delivery matrix: post-`agent_settled` the agent is idle → `{ triggerTurn: true, deliverAs: "followUp" }`; if somehow busy → `{ deliverAs: "steer" }` (queued, no interrupt). Do NOT call `pi.sendMessage` directly and do NOT modify `deliverSubmission`.
   d. `opts.lifecycle.dismissPanel()` — no-op until P1.M3.T1.S1 registers a real callback (S1's stub contract).
   e. `state.clearForCompletion()` — clears questions/order, retains goal/epoch/snapshots (h3.9 "keep entries for audit", h3.9 audit trail for renderers P1.M7.T3.S2), and sets `completed = true` (see below).
5. Return `{ fired: true }`.

### state.ts minimal change (`completed` flag)

- Add field `completed: boolean` to `InterrogationState` (interface + class), default `false` in `createInterrogationState` and in any deserialize path.
- Set `this.completed = true` INSIDE `clearForCompletion()` (guarantees the invariant "cleared ⇒ completed" — the flag and the clear can never diverge) — this is the ONLY assignment site.
- Add `completed` to `SerializedState` and `serialize()` output (persistence/M7 reconstruction will need it; adding it now costs one field and keeps the round-trip complete).
- Do not touch any other state.ts logic.

### index.ts wiring

```ts
const lifecycle = createLifecycle(pi, {
  onAfterClosePass: createCompletionTrigger(pi, { lifecycle: /* see below */ }),
});
```
Circularity note: `createCompletionTrigger` needs the lifecycle for `dismissPanel`, and `createLifecycle` needs the trigger. Resolve with a late-binding shim: `const lifecycleRef = { dismissPanel: () => lifecycle.dismissPanel() }` (declare `let lifecycle` first), or construct lifecycle first with a mutable options object. Either is fine — document the chosen one in a comment.

### Success Criteria

- [ ] All questions closed/withdrawn after a close pass → completion fires: exactly one `pi.sendMessage` with `customType: "interrogation-completion"` and the matrix-correct options (idle → `{triggerTurn: true, deliverAs: "followUp"}`)
- [ ] Order enforced: buildCompletion called BEFORE clearForCompletion; deliverSubmission before dismissPanel before clear (assert via mock call order)
- [ ] Fires EXACTLY once: second close pass after completion → `{ fired: false, reason: "already-completed" }`, zero sendMessage calls
- [ ] Predicate blocks while any question is open/reasked/answered/submitted/moot
- [ ] h2.37 edge: submit pending (questions `submitted`) → close pass does NOT fire; after the next agent reply + settle (questions closed) → fires
- [ ] Moot question present → completion blocked until moot is withdrawn/closed path leaves no moot
- [ ] No state → `{fired:false, reason:"no-state"}`, no throw
- [ ] `dismissPanel()` invoked exactly once per firing (and lifecycle stub is a safe no-op)
- [ ] `getBatchNotes` passthrough: notes array reaches `buildCompletion`; undefined also fine
- [ ] After completion: `state.orderedQuestions()` empty, `state.completed === true`, goal/epoch/snapshots retained
- [ ] Existing lifecycle/state/merge/delivery suites still green (only additive state.ts change)

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets: the exact seam it plugs into (S1's `onAfterClosePass` + `dismissPanel`), the exact builder and transport signatures (S3/S1-of-T1), the exact side-effect order from h3.9, the predicate including the `moot` subtlety, the one-time-guard mechanism including the state.ts change, the circular-wiring resolution, and mock/test conventions. No guessing about where notes come from or how "exactly once" is enforced.

### Documentation & References

```yaml
- file: src/lifecycle.ts   # (P1.M2.T2.S1 — may still be landing; its PRP is the contract)
  why: createLifecycle(pi, opts), LifecycleOptions.onAfterClosePass(result: ClosePassResult),
       Lifecycle.dismissPanel(), noteSubmissionDelivered(), dispose()
  pattern: plug the trigger as onAfterClosePass; call lifecycle.dismissPanel() — never touch pi panels directly
  gotcha: ClosePassResult.remainingActive EXCLUDES moot (S1 reports h2.44's set only) — recompute the predicate locally

- file: src/delivery.ts
  why: buildCompletion(state, notes?) -> CompletionMessage {customType:"interrogation-completion", content: h2.46 record, display:true, details: recap card data} (P1.M2.T1.S3);
       deliverSubmission(pi, msg, ctx) — the ONLY turn-triggering path, busy→steer / idle→followUp+triggerTurn matrix
  gotcha: NEVER call pi.sendMessage directly; buildCompletion is PURE (no snapshot/bump/clear); must run BEFORE clearForCompletion
  note: if S3 has not landed when implementation starts, gate on its PRP contract (plan/001_0d6760db6bc5/P1M2T1S3/PRP.md) — SendableMessage widened to SubmissionMessage | CompletionMessage

- file: src/state.ts
  why: InterrogationState (orderedQuestions, clearForCompletion, events incl. "completed-cleared"),
       getState()/setState() singleton, SerializedState/serialize() for the new `completed` field
  pattern: add completed:boolean; set true inside clearForCompletion; include in serialize()
  gotcha: clearForCompletion retains goal/epoch/snapshots — that IS the audit retention (h3.9); do not clear more or less

- file: src/index.ts
  why: factory — replace the S1 placeholder createLifecycle(pi) call with onAfterClosePass wiring; late-binding shim for the lifecycle reference

- file: plan/001_0d6760db6bc5/prd_snapshot.md  (h3.9, h2.44, h2.46, h2.37)
  why: h3.9 flow + side-effect order verbatim; h2.44 completion predicate; h2.46 record format (S3's builder output); h2.37 edge (0 open + pending submissions → completion waits)

- file: plan/001_0d6760db6bc5/P1M2T2S1/PRP.md
  why: the contract for the engine this plugs into (ClosePassResult shape, dismissPanel stub, idempotent close passes)
- file: plan/001_0d6760db6bc5/P1M2T1S3/PRP.md
  why: buildCompletion contract (notes responsibility split — trigger collects and passes; draft store arrives M4)
```

### Current Codebase tree

```bash
src/ index.ts config.ts state.ts merge.ts depends-on.ts snapshots.ts tool-schema.ts guards.ts caps.ts results.ts fallback.ts tool.ts delivery.ts lifecycle.ts(+test, from parallel S1) (+ *.test.ts)
```

### Desired Codebase tree

```bash
src/
  completion.ts        # NEW: createCompletionTrigger — h3.9 completion flow, one-time guard
  completion.test.ts   # NEW: mock pi/lifecycle/state-driven unit tests
  state.ts             # MODIFIED: add `completed` flag (field, clearForCompletion sets it, serialize includes it)
  index.ts             # MODIFIED: wire onAfterClosePass: createCompletionTrigger(...)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// ESM: relative imports use ".js" suffix (`from "./lifecycle.js"`).
// buildCompletion MUST run before clearForCompletion — the record reads the full question map.
// closeForCompletion sets completed=true — the flag is the one-time guard; do not also track "fired" in a closure
//   (a new interrogation via createInterrogationState gets completed=false and can complete again).
// The h2.37 edge needs NO special code: "submitted" is in the blocked-status set, so completion naturally
//   waits for the close pass after the next agent reply. Cover it with a test, not logic.
// deliverSubmission is fire-and-forget and may THROW (propagates by design) — let it; do not wrap in try/catch.
// Dismiss before clear: panel reads state while dismissing (future M3) — clear must be last.
// vi.mock may be needed if delivery.ts exports are spied on; prefer injecting mocks via
//   Pick<ExtensionAPI,"sendMessage"> ({ sendMessage: vi.fn() }) and a lifecycle stub { dismissPanel: vi.fn() }.
```

## Implementation Blueprint

### Data models and structure

Plain types only (`CompletionTriggerOptions`, `CompletionResult` as in What). No new persistence, no config keys, no env vars.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/state.ts (minimal)
  - IMPLEMENT: completed:boolean on InterrogationState interface + class; default false;
     set true inside clearForCompletion(); add to SerializedState + serialize()
  - NAMING: `completed` (matches "completed-cleared" event naming)
  - TESTS: extend existing state.test.ts case for clearForCompletion (flag true, serialize round-trips)

Task 2: CREATE src/completion.ts
  - IMPLEMENT: types + createCompletionTrigger per What §algorithm
  - FOLLOW pattern: src/delivery.ts (narrow Pick surface, Mode A JSDoc, fire-and-forget plumbing style)
  - DEPENDENCIES: state.js (getState, InterrogationState), delivery.js (buildCompletion, deliverSubmission), lifecycle.js (types only + dismissPanel via opts)
  - JSDOC (Mode A): quote h3.9 block verbatim; state the completion invariant —
     "fires EXACTLY once per interrogation instance: guarded by state.completed, which only
      clearForCompletion sets; a second agent_settled, a repeat close pass, or an upsert racing
      the clear cannot re-fire it. A NEW interrogation (fresh state) starts completed=false."
     Document the moot-in-predicate deviation from ClosePassResult.remainingActive, and the
     notes-collection split (getBatchNotes ← draft store P1.M4.T2.S2).

Task 3: CREATE src/completion.test.ts
  - IMPLEMENT: mocked pi {sendMessage: vi.fn()}, lifecycle stub {dismissPanel: vi.fn()},
     fixture state via createInterrogationState + merge helpers; drive trigger directly with
     hand-built ClosePassResult objects (integration through the real engine is S1's test concern)
  - CASES: fire-once happy path (all closed) with call-order assertions
     (build→send→dismiss→clear — spy order via invocationCallOrder or shared log);
     second-pass no-refire; blocked-by-open/answered/submitted/reasked/moot; h2.37 pending-submissions
     sequence (submitted blocks → simulate reply/settle closure → fires); busy ctx → steer options
     (assert deep-equal {deliverAs:"steer"}), idle ctx → {triggerTurn:true, deliverAs:"followUp"});
     no-state; getBatchNotes passthrough; completed flag + snapshot retention assertions;
     zero-question fresh state does not fire
  - NAMING: test("completion fires exactly once and in h3.9 order", ...)
  - PLACEMENT: src/completion.test.ts

Task 4: MODIFY src/index.ts
  - INTEGRATE: late-binding lifecycle shim; createLifecycle(pi, { onAfterClosePass:
     createCompletionTrigger(pi, { lifecycle: shimRef }) }); replace S1's placeholder call
  - PRESERVE: ping command, tool registration, config load
```

### Implementation Patterns & Key Details

```ts
// The predicate (owned here, not by ClosePassResult):
const BLOCKING = new Set(["open", "reasked", "answered", "submitted", "moot"]);
const qs = state.orderedQuestions();
const blocked = qs.filter((q) => BLOCKING.has(q.status));
if (blocked.length > 0) return { fired: false, reason: "active-questions-remain" };
// (qs.length === 0 on a never-used state: also treat as not-firing — completion implies content existed.)

// h3.9 order — never reorder:
const msg = buildCompletion(state, opts.getBatchNotes?.());   // full record from FULL state
deliverSubmission(pi, msg, opts.ctx);                          // the ONE full injection
opts.lifecycle.dismissPanel();                                 // stub until P1.M3.T1.S1
state.clearForCompletion();                                    // last — also sets completed=true
```

### Integration Points

```yaml
STATE (src/state.ts): completed flag; clearForCompletion sets it; serialize round-trips it (M7.T1 reconstruction consumes)
LIFECYCLE (src/index.ts): onAfterClosePass: trigger; dismissPanel consumed
FUTURE CONSUMERS:
  - P1.M3.T1.S1: registers the real onPanelDismiss callback — dismissPanel becomes live
  - P1.M4.T2.S2: getBatchNotes wired to the draft store's batch-note slot
  - P1.M7.T3.S2: recap card renderer reads details of the injected interrogation-completion message
  - P1.M7.T1: reconstruction must restore completed=true to preserve the one-time invariant across restart
CONFIG: none
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck
npx vitest run src/completion.test.ts src/state.test.ts
```

### Level 2: Unit Tests (Component Validation)

```bash
npm test    # full suite — no regressions in lifecycle/state/merge/delivery/tool suites
```

### Level 3: Integration Testing (System Validation)

Deferred by design: real `agent_settled` completion is exercised via P1.M2.T3.S1 debug commands and the M7 scripted runbook (AC-14). This item's runtime surface is a callback + one sendMessage; index.ts compiling and loading is the smoke check.

### Level 4: Creative & Domain-Specific Validation

Line-by-line review of the trigger against h3.9 (each spec line maps to a code site); confirm the JSDoc completion-invariant sentence names all re-fire vectors (double settle, repeat pass, post-completion upsert) and the fresh-state reset.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean; `npm test` green (all suites)

### Feature Validation

- [ ] All Success Criteria pass (esp. exactly-once, side-effect order, h2.37 edge, moot-blocks)
- [ ] Exactly one `pi.sendMessage` per firing, via `deliverSubmission` only
- [ ] Post-completion state: questions empty, completed=true, goal/epoch/snapshots retained

### Code Quality Validation

- [ ] `.js` ESM import suffixes; narrow `Pick<...>` surfaces; no `as any`
- [ ] No modification of deliverSubmission/buildCompletion/lifecycle engine internals (seams consumed as-is)
- [ ] state.ts change strictly additive (completed flag only)

### Documentation & Deployment

- [ ] Mode A JSDoc quotes h3.9 and states the one-time invariant; consumers (M3 panel, M4 notes, M7.T3.S2 renderer, M7.T1 reconstruction) named
- [ ] No new config keys or env vars

---

## Anti-Patterns to Avoid

- ❌ Don't clear state before building the record — content would be empty
- ❌ Don't call pi.sendMessage directly or duplicate the delivery-matrix logic
- ❌ Don't use a closure "fired" variable as the guard — the flag belongs on state (new interrogations must be able to complete)
- ❌ Don't trust `ClosePassResult.remainingActive` for the predicate — it omits moot
- ❌ Don't wrap deliverSubmission in try/catch — throws are caller-visible by contract
- ❌ Don't special-case the h2.37 edge in code — the blocked-status set already covers it; test it instead

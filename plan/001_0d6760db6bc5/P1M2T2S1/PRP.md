---
name: "P1.M2.T2.S1 — Auto-close engine (agent_settled close pass) (lifecycle.ts)"
description: "Create src/lifecycle.ts: a lifecycle engine that subscribes to tool_execution_start/end + agent_settled, implements the h2.44 auto-close algorithm exactly (per-run reask flags via toolCallId correlation; close submitted questions not re-asked), exposes noteSubmissionDelivered() and onPanelDismiss(cb) hooks, and is wired in index.ts. NO completion injection (that is P1.M2.T2.S2, plugged into this engine's post-close-pass hook). Mode A JSDoc including the abort caveat."
---

## Goal

**Feature Goal**: Implement the auto-close engine (FR-4, h2.44): after each `agent_settled`, every question in status `submitted` that the just-finished agent run did not re-ask (via an `interrogate` upsert touching it) transitions to `closed (archived)`. Aborted runs count as settled. The pass is idempotent.

**Deliverable**: `src/lifecycle.ts` with `createLifecycle(pi, opts?)` + types, `src/lifecycle.test.ts` with event-driven unit tests, and `src/index.ts` modified to construct and subscribe the engine after tool registration.

**Success Definition**: `npm test` + `npm run typecheck` green; scripted event sequences (submit → settle, submit → upsert → settle, aborted run, double settle, interleaved submissions) produce exactly the h2.44 status outcomes; `onPanelDismiss` callback machinery present and no-op by default.

## User Persona

**Target User**: The TUI user who answered questions — their submitted answers must auto-archive once the agent has incorporated (or ignored) them, without manual bookkeeping. Secondary consumer: the completion trigger (P1.M2.T2.S2) and the panel (P1.M3) via `onPanelDismiss`.

**Use Case**: ctrl+s submits 3 answers → submission delta triggers an agent run → the run upserts question A (re-asked, stays live) but not B/C → `agent_settled` → B and C become `closed (archived)`; A stays `reasked`.

**User Journey**: submit → agent reply (possibly with interrogate upserts) → settle → untouched submitted questions dim to archived (visible, editable per FR-2) → eventually zero active questions → completion (S2, later).

**Pain Points Addressed**: Manual question lifecycle management; stale "submitted" questions lingering forever; race between `tool_execution_end` and `agent_settled` ordering (h2.51 risk row 3).

## Why

- h2.44 mandates the algorithm verbatim; h2.16 assigns `agent_settled` → auto-close pass (FR-4) and `tool_execution_end` → record whether this run upserted.
- merge.ts `closeSubmitted` was built for exactly this caller (its JSDoc says "the auto-close engine (P1.M2.T2.S1) calls this after agent_settled").
- Proves AC-3 (state semantics: submitted → closed unless re-asked; aborts count as settled).
- Output consumed by the completion trigger (P1.M2.T2.S2) and later the panel dismissal (M3).

## What

### `src/lifecycle.ts` — public surface

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Outcome of one agent_settled close pass (consumed by P1.M2.T2.S2). */
export interface ClosePassResult {
  /** Ids moved submitted → closed (archived) by this pass. */
  closed: string[];
  /** Ids moved submitted → reasked by an upsert in the run just settled. */
  reasked: string[];
  /** Ids STILL in an active status after the pass (open/answered/submitted/reasked). */
  remainingActive: string[];
}

export interface LifecycleOptions {
  /** State override (tests / reconstruction); defaults to getState(). */
  getState?: () => InterrogationState | undefined;
  /** Called after each close pass — P1.M2.T2.S2 plugs the completion trigger here. */
  onAfterClosePass?: (result: ClosePassResult) => void;
}

export interface Lifecycle {
  /** Reset per-run flags. Submit flows MUST call this right after deliverSubmission. */
  noteSubmissionDelivered(): void;
  /** Register panel-dismiss callback; fired by dismissPanel() — no-op until M3 wires a panel. */
  onPanelDismiss(cb: () => void): void;
  /** Fire the registered panel-dismiss callback (idempotent, safe with none registered). */
  dismissPanel(): void;
  /** Run the close pass explicitly (normally invoked by the agent_settled subscription). */
  runClosePass(): ClosePassResult | undefined; // undefined when no state exists
  /** Remove all pi event subscriptions (session teardown seam). */
  dispose(): void;
}

export function createLifecycle(pi: Pick<ExtensionAPI, "on">, opts?: LifecycleOptions): Lifecycle;
```

### Engine algorithm (h2.44, exact)

Per-run engine state: `reaskedThisRun: Set<string>`, `submittedRun = false`, `pendingToolArgs: Map<toolCallId, args>`.

1. **`tool_execution_start`**: if `event.toolName === "interrogate"`, store `pendingToolArgs.set(event.toolCallId, event.args)`. (args exist ONLY on start — pi-api-validation.md §Events.)
2. **`tool_execution_end`**: if `event.toolName !== "interrogate"` or `event.isError`, delete the pending entry and return (a thrown stale-guard is an isError result → no state change → nothing to record). Look up args by `event.toolCallId`; delete the entry. If `args?.action === "upsert"`: set `submittedRun = true`; for each `id` in `args.questions` (tolerant: array-of-objects with string `id` only), if the state has the id and its status is `"submitted"`, `state.setStatus(id, "reasked")` and add to `reaskedThisRun`. (applyUpsert rule 2 already set reasked for changed options; this pass covers rule 1 — same-options upsert keeps status "submitted", which h2.44 still counts as re-asked.)
3. **`agent_settled`** → `runClosePass()`:
   - No state → return undefined.
   - Collect `submitted = orderedQuestions().filter(q => q.status === "submitted")`. (Epoch proxy is sound: every prior settle closed or re-marked all then-submitted questions, so current "submitted" ids were submitted at the latest epoch — see research note.)
   - `toClose = submitted.filter(q => !reaskedThisRun.has(q.id))` → `closeSubmitted(state, toClose.map(q => q.id))` (throws-on-unknown already validated since ids came from state).
   - `remainingActive = orderedQuestions().filter(isActive).map(q => q.id)` where `isActive(q) = ["open","answered","submitted","reasked"].includes(q.status)` (h2.44 completion predicate is S2's to apply; we only report).
   - Reset per-run state: `reaskedThisRun.clear(); submittedRun = false` (**idempotence**: a second settle with no new submission finds zero submitted questions → no-op; abort-fire is safe — pi-api-validation.md Unknown 1).
   - Invoke `opts.onAfterClosePass?.(result)` and return it.
4. **`noteSubmissionDelivered()`**: `submittedRun = false; reaskedThisRun.clear()`. Called by submit flows (P1.M2.T3.S1 debug command; P1.M3.T2.S2 panel ctrl+s) immediately after `deliverSubmission` — deliverSubmission itself is pure plumbing and must NOT be modified.
5. **Panel dismissal**: `dismissPanel()` invokes the single registered callback (last registration wins); default = no registered callback → no-op. Pure hook machinery — no UI.
6. **index.ts**: after `pi.registerTool(...)`, add `createLifecycle(pi)` and keep the instance (a `// P1.M2.T2.S2 will pass onAfterClosePass here` comment marks the completion-trigger seam). No config changes.
7. **JSDoc (Mode A)**: quote the h2.44 block verbatim; document the abort caveat ("`agent_settled` abort semantics are undocumented in the pi API — verified empirically only via M7 scripted runbook; the pass is idempotent so abort-fires are safe"), the toolCallId correlation rationale (h2.51 event-ordering risk), the epoch-proxy invariant, and the `noteSubmissionDelivered` caller contract.

### Success Criteria

- [ ] submit → settle (no upsert): submitted ids → `closed`
- [ ] submit → upsert touching some ids → settle: touched → `reasked`, untouched → `closed`
- [ ] Same-options upsert (rule 1, status stays submitted) still flips to `reasked` at tool_execution_end
- [ ] `isError` tool result records nothing
- [ ] Aborted run (agent_settled with no tool events) still closes submitted questions (FR-4 "aborts count as settled")
- [ ] Double agent_settled with no intervening submission: second pass closes nothing (idempotent)
- [ ] `onAfterClosePass` receives accurate `{closed, reasked, remainingActive}`
- [ ] `onPanelDismiss`/`dismissPanel` round-trip works and is a no-op without registration
- [ ] No state → `runClosePass()` returns undefined, no throw
- [ ] `dispose()` unsubscribes all handlers
- [ ] `npm test` + `npm run typecheck` green; existing suites untouched

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets: the exact event shapes and their asymmetry (args only on start), the exact state/merge API to call, the epoch-proxy invariant justification, the idempotence requirement and why, the seam contracts with S2/M2.T3.S2/M3, and vitest mocking patterns for `pi.on`. No guessing about where "reasked" comes from or how to detect upserts.

### Documentation & References

```yaml
- file: src/state.ts
  why: InterrogationState API — orderedQuestions(), setStatus(id, status), serialize(); getState()/setState() singleton; QuestionStatus union
  pattern: reads via orderedQuestions()/getQuestion; mutations via setStatus so `changed` fires
  gotcha: Question has NO submitted-epoch field — do not add one; rely on the close-all-each-settle invariant

- file: src/merge.ts
  why: closeSubmitted(state, ids) — the documented caller for THIS engine; applyUpsert rule 1 vs rule 2 status behavior (why the engine must flip rule-1 "submitted" → "reasked" itself)
  pattern: markSubmitted/closeSubmitted throw on unknown ids — ids always sourced from state first
  gotcha: no markReasked helper exists; use state.setStatus(id, "reasked") directly

- file: src/delivery.ts
  why: buildSubmission (snapshot+bumpEpoch site) and deliverSubmission (pure plumbing, {sendMessage} mock) — the submit flow whose callers must call noteSubmissionDelivered()
  gotcha: DO NOT modify deliverSubmission to notify the engine (S2 contract: exactly one pi.sendMessage, untouched)

- file: src/index.ts
  why: factory where subscriptions land ("Subscribe in index.ts" per item); currently registers ping command + interrogate tool
  pattern: add createLifecycle(pi) after registerTool; keep instance for later milestones

- file: plan/001_0d6760db6bc5/architecture/pi-api-validation.md
  why: §Events — tool_execution_start {toolCallId,toolName,args}, tool_execution_end {toolCallId,toolName,result,isError}, agent_settled (abort semantics UNDOCUMENTED, Unknown 1); h2.51 ordering risk row
  gotcha: args are NEVER on tool_execution_end — correlate by toolCallId

- file: plan/001_0d6760db6bc5/prd_snapshot.md (h2.44, h2.16, h2.38, h3.0 FR-4, h2.51)
  why: algorithm verbatim; event subscription table; state machine diagram (submitted → closed via agent_settled, no re-ask); ordering-risk mitigation

- file: plan/001_0d6760db6bc5/P1M2T1S3/PRP.md
  why: parallel S3 adds buildCompletion + widens SendableMessage — completion trigger is P1.M2.T2.S2, NOT this item; do not duplicate
```

### Current Codebase tree

```bash
src/ index.ts config.ts state.ts merge.ts depends-on.ts snapshots.ts tool-schema.ts guards.ts caps.ts results.ts fallback.ts tool.ts delivery.ts (+ *.test.ts)
# delivery.ts gains buildCompletion from parallel S3 (contract PRP) — independent of this item
```

### Desired Codebase tree

```bash
src/
  lifecycle.ts        # NEW: createLifecycle engine (h2.44 auto-close + hooks)
  lifecycle.test.ts   # NEW: event-sequence unit tests via mocked pi.on
  index.ts            # MODIFIED: createLifecycle(pi) subscription wiring
```

### Known Gotchas of our codebase & Library Quirks

```ts
// ESM: relative imports use ".js" suffix (`from "./state.js"`).
// tool_execution_end has NO args — toolCallId correlation map is mandatory (h2.51 risk row 3).
// agent_settled abort semantics are UNDOCUMENTED (pi-api-validation.md Unknown 1) — idempotent pass is the mitigation.
// applyUpsert rule 1 (same options) leaves status "submitted" — engine must flip touched submitted ids to "reasked" itself.
// isError tool results = thrown stale-guards = no state change — must NOT set submittedRun or mark reasks.
// state has no submitted-epoch tracking; "submitted-at-current-epoch" ≡ status === "submitted" (invariant: each settle clears the field).
// createLifecycle takes Pick<ExtensionAPI, "on"> so tests pass a vi.fn() mock — no real pi runtime.
// pi.on returns unsubscribe functions (capture and expose via dispose()).
```

## Implementation Blueprint

### Data models and structure

Plain types only (`ClosePassResult`, `LifecycleOptions`, `Lifecycle` as in What §public surface). No persistence, no config.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/lifecycle.ts
  - IMPLEMENT: types + createLifecycle(pi, opts?) per What §algorithm
  - FOLLOW pattern: src/delivery.ts (Pick<ExtensionAPI,...> narrow surface, Mode A JSDoc, exported optionless purity)
  - NAMING: createLifecycle, noteSubmissionDelivered, onPanelDismiss, dismissPanel, runClosePass, dispose
  - DEPENDENCIES: state.js (getState, InterrogationState, Question), merge.js (closeSubmitted)
  - PLACEMENT: src/lifecycle.ts
  - JSDOC: quote h2.44 verbatim; abort caveat; toolCallId rationale; epoch-proxy invariant; noteSubmissionDelivered caller contract

Task 2: CREATE src/lifecycle.test.ts
  - IMPLEMENT: mock pi = { on: vi.fn() }; capture handlers into a record keyed by event name; helper
     emit(event, payload) invoking the captured handler; fixture state via createInterrogationState +
     upsertQuestion + applyAnswer + markSubmitted (merge.js)
  - CASES (see Success Criteria): plain close; upsert-partial-reask; rule-1 same-options reask;
     isError ignored; aborted-run close; double-settle idempotence; remainingActive accounting;
     onAfterClosePass invocation; onPanelDismiss/dismissPanel round-trip + no-op;
     no-state undefined; dispose unsubscribes (assert all captured unsubscribers called)
  - NAMING: test("close pass archives submitted questions not reasked this run", ...)
  - PLACEMENT: src/lifecycle.test.ts

Task 3: MODIFY src/index.ts
  - INTEGRATE: import createLifecycle; call createLifecycle(pi) after registerTool; keep the
     instance in a local (comment: completion trigger P1.M2.T2.S2 will pass onAfterClosePass)
  - PRESERVE: ping command, tool registration, config load
```

### Implementation Patterns & Key Details

```ts
// toolCallId correlation (the h2.51 mitigation):
const pendingToolArgs = new Map<string, unknown>();
// on "tool_execution_start":
if (ev.toolName === "interrogate") pendingToolArgs.set(ev.toolCallId, ev.args);
// on "tool_execution_end":
const args = pendingToolArgs.get(ev.toolCallId); pendingToolArgs.delete(ev.toolCallId);
if (ev.toolName === "interrogate" && !ev.isError && isUpsertArgs(args)) { ... }

// Tolerant args narrowing (tool args are untyped at the boundary):
function isUpsertArgs(a: unknown): a is { questions: Array<{ id: string }> } { /* obj + array filter */ }

// Close pass core:
const toClose = state.orderedQuestions()
  .filter((q) => q.status === "submitted" && !reaskedThisRun.has(q.id))
  .map((q) => q.id);
closeSubmitted(state, toClose); // merge.js — emits changed per id
// CRITICAL: clear reaskedThisRun/submittedRun AFTER computing, ALWAYS (idempotence).
```

### Integration Points

```yaml
EVENTS (via pi.on in createLifecycle): tool_execution_start, tool_execution_end, agent_settled
CONFIG: none
INDEX.TS: createLifecycle(pi) after registerTool
CONSUMER 1 (P1.M2.T2.S2): onAfterClosePass(result) → if result.remainingActive.length === 0
  (and h2.44 predicate holds) → buildCompletion + deliverSubmission + dismissPanel + clear
CONSUMER 2 (P1.M2.T3.S1 + P1.M3.T2.S2): call noteSubmissionDelivered() immediately after deliverSubmission
CONSUMER 3 (P1.M3.T1): onPanelDismiss registration (panel done(null) suspend / completion dismiss)
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck
npx vitest run src/lifecycle.test.ts
```

### Level 2: Unit Tests (Component Validation)

```bash
npm test    # full suite — no regressions in state/merge/delivery/tool suites
# Expected: all pass, including idempotence and abort cases.
```

### Level 3: Integration Testing (System Validation)

Deferred by design: live `agent_settled`/abort behavior is exercised via P1.M2.T3.S1 debug commands and the M7 scripted runbook (pi-api-validation.md Unknown 1 requires an empirical abort check there). This item's runtime surface is subscriptions only; smoke-load is covered by index.ts compiling and the extension loading (`pi` factory path unchanged otherwise).

### Level 4: Creative & Domain-Specific Validation

Review the JSDoc against h2.44 line-by-line (each algorithm line maps to a code site); confirm the abort caveat sentence is present.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean
- [ ] `npm test` green (all suites)

### Feature Validation

- [ ] All Success Criteria cases pass (esp. rule-1 reask, isError ignore, abort close, double-settle idempotence)
- [ ] `onAfterClosePass` result shape matches ClosePassResult
- [ ] index.ts subscribes; extension still loads (no factory changes beyond the one call)

### Code Quality Validation

- [ ] `.js` ESM import suffixes
- [ ] No modification of delivery.ts/state.ts/merge.ts (consumed as-is)
- [ ] Mode A JSDoc quoting h2.44 + abort caveat
- [ ] Tolerant narrowing of untyped event payloads (no `as any` casts of args without guards)

### Documentation & Deployment

- [ ] JSDoc names consumers (S2 trigger, submit-flow callers, M3 panel)
- [ ] No new env vars or config keys

---

## Anti-Patterns to Avoid

- ❌ Don't read args from tool_execution_end — they don't exist there (h2.51)
- ❌ Don't track submitted-epoch on Question — the status proxy + idempotent pass is the designed mechanism
- ❌ Don't perform completion injection/dismissal here — S2 owns it; this engine only reports via onAfterClosePass
- ❌ Don't modify deliverSubmission or state.ts/merge.ts to "help" the engine
- ❌ Don't skip clearing per-run flags on early exits — non-idempotent passes break abort/double-settle safety
- ❌ Don't mark reasks from isError tool results (stale-guard throws changed nothing)
- ❌ Don't swallow unknown event shapes — tolerate-and-ignore with narrowing guards, never `as any`

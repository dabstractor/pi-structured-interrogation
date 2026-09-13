---
name: "P1.M2.T1.S2 — sendMessage plumbing: triggerTurn + streaming delivery (delivery.ts: deliverSubmission)"
description: "Add to src/delivery.ts an exported, unit-testable `deliverSubmission(pi, msg, ctx?)` that injects a built SubmissionMessage (from P1.M2.T1.S1's buildSubmission) via pi.sendMessage with correct turn-triggering options: when the agent is busy/streaming (ctx.isIdle() === false) use `{ deliverAs: 'steer' }`; when idle use `{ triggerTurn: true, deliverAs: 'followUp' }` (pi-api-validation.md Mismatch 2). This is the ONLY turn-triggering path in the extension (core commitment h2.0 §1 — no tool call ever waits on the user). Include JSDoc (Mode A) explaining triggerTurn/deliverAs semantics."
---

## Goal

**Feature Goal**: Implement the transport half of submission delivery — a single function that takes a built custom message and hands it to `pi.sendMessage` with the exact options that guarantee the model actually replies, in both the idle case (panel open while agent waits) and the streaming case (user hits ctrl+s / debug submit while the agent is mid-turn).

**Deliverable**: `src/delivery.ts` gains:

```ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export type SendableMessage = SubmissionMessage; // re-export/type alias; S3's completion record will extend this union

export type DeliveryOptions = { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" };

/** JSDoc: triggerTurn semantics (Mode A — see Implementation Blueprint). */
export function deliverSubmission(
  pi: Pick<ExtensionAPI, "sendMessage">,
  msg: SendableMessage,
  ctx?: { isIdle?: () => boolean },
): void;
```

plus `src/delivery.test.ts` additions covering both option branches and the no-ctx default.

**Success Definition**: `npm test` + `npm run typecheck` green; unit tests assert `pi.sendMessage` was called exactly once with the message object unmodified and the correct options object for each branch (idle / streaming / no ctx / missing isIdle). No pi runtime needed in tests (mock pi object).

## User Persona

**Target User**: The LLM agent — it must receive the ≤3-line submission delta *and be prompted to reply* (process upserts, ask follow-ups, or complete). Secondarily the TUI user, whose ctrl+s must have visible effect even while the agent is streaming.

**Use Case**: User presses ctrl+s in the panel (P1.M3.T2.S2) or runs the debug submit command (P1.M2.T3.S1); the submission delta must reach the model and trigger its next reply.

**User Journey**: panel/debug computes diff → `buildSubmission(state, diff, note)` (S1, already snapshot+bumped epoch) → `deliverSubmission(pi, msg, ctx)` → pi queues (steer) or triggers (followUp+triggerTurn) → model sees `role: custom` delta in context → replies.

**Pain Points Addressed**: pi.sendMessage silently does nothing to advance the conversation by default — a submission sent without `triggerTurn: true` while idle leaves the session dead until the next user message (the exact trap documented as Mismatch 2 in pi-api-validation.md).

## Why

- h2.0 core commitment §1 (non-blocking tool): answers flow back "later as small delta messages that trigger a new reply" — `deliverSubmission` is that triggering mechanism, and the only one in the extension.
- h3.6 submit flow: `delivery.ts: sendMessage customType "interrogation-submission"` → "model replies" — this item owns that arrow.
- Architecture doc Mismatch 2 (verbatim): "Submission must trigger a reply: sendMessage requires `{ triggerTurn: true, deliverAs: 'followUp' }` (steer if streaming)."
- Consumers: P1.M2.T3.S1 (debug submit) and P1.M3.T2.S2 (panel ctrl+s via lifecycle) both call this one function — centralizing it here prevents divergent delivery behavior and makes the turn-trigger contract testable in isolation.

## What

- `deliverSubmission(pi, msg, ctx?)`:
  1. If `ctx?.isIdle` is a function and `ctx.isIdle() === false` → call `pi.sendMessage(msg, { deliverAs: "steer" })`. (Agent busy; steer queues delivery after the current assistant turn's tool calls, before the next LLM call. `triggerTurn` is meaningless while busy — omit it.)
  2. Otherwise (idle, no ctx, or `isIdle` missing) → call `pi.sendMessage(msg, { triggerTurn: true, deliverAs: "followUp" })`. (Idle: followUp delivers once the agent has no pending tool calls and `triggerTurn: true` fires the LLM response immediately. This is also the safe default when idle-status is unknown — followUp is valid in both states.)
  3. Never mutate `msg`. Never call anything else on `pi`. Return void (fire-and-forget; sendMessage is the queueing primitive).
  4. Do NOT wrap in try/catch that swallows errors — if pi.sendMessage throws (e.g., invalid state), let it propagate so the panel/debug caller's error handling surfaces it.
- Type note: accept the narrowest `pi` shape (`Pick<ExtensionAPI, "sendMessage">`) and an optional minimal `ctx` (`{ isIdle?: () => boolean }`) so unit tests pass plain mocks without constructing a full ExtensionAPI. This satisfies the contract's "verify with ctx.isIdle()/mode guards" while keeping the function pure-plumbing.
- `SendableMessage` starts as `SubmissionMessage` (S1's type). S3 (completion record) will widen it to a union; keep the alias so later widening touches one line.
- JSDoc (Mode A, required by contract point 5) documenting: custom messages are `role: "custom"` and participate in LLM context; sendMessage never triggers a reply unless `triggerTurn: true`; the steer-vs-followUp decision table; and that this is the extension's only turn-triggering path (commitment 1).

### Success Criteria

- [ ] Idle branch: called with `{ triggerTurn: true, deliverAs: "followUp" }`, message passed by reference/unchanged
- [ ] Streaming branch (`ctx.isIdle() === false`): called with `{ deliverAs: "steer" }` and NO triggerTurn key
- [ ] No ctx / no isIdle: falls back to the followUp+triggerTurn branch
- [ ] Exactly one `sendMessage` call per invocation; no other pi API touched
- [ ] Unit tests use mocked pi (vi.fn()), no pi runtime import
- [ ] JSDoc present with triggerTurn semantics
- [ ] `npm test` and `npm run typecheck` pass

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets: the exact pi.sendMessage option semantics (quoted from extensions.md and the project's validated API notes), the upstream SubmissionMessage type from S1 (co-developed in the same file), the consumers list, and the test conventions (mock pi, vitest). No guessing about which deliverAs value to use in which state.

### Documentation & References

```yaml
- url: file:///home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md#pisendmessagemessage-options
  why: authoritative sendMessage(message, options) semantics
  critical: |
    deliverAs: "steer" (default) queues while streaming, delivered after current assistant
    turn's tool calls before next LLM call; "followUp" waits until agent has no more tool
    calls; "nextTurn" never triggers (NOT used here). triggerTurn: true triggers an LLM
    response immediately IF idle; only applies to steer/followUp.

- url: file:///home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md#ctxisidle--ctxabort--ctxhaspendingmessages
  why: ctx.isIdle() definition
  critical: isIdle() is false while processing an agent run, automatic retry, auto-compaction
    retry, or queued continuation — i.e. "busy" is broader than just streaming.

- file: plan/001_0d6760db6bc5/architecture/pi-api-validation.md
  why: validated API surface + Mismatch 2 (the exact rule this item implements)
  section: "Context / model / mode" and "MISMATCHES §2"

- file: src/delivery.ts  (arriving from P1.M2.T1.S1 — CONTRACT)
  why: contains SubmissionMessage + buildSubmission; deliverSubmission is added to this same file
  pattern: follow its existing JSDoc/export style; reuse SubmissionMessage via import/type alias
  gotcha: buildSubmission already did snapshot+bumpEpoch; deliverSubmission must NOT touch state

- file: src/index.ts
  why: factory pattern — later wiring (P1.M2.T3.S1, P1.M3) will call deliverSubmission with
    the command/panel ctx; this item does NOT change index.ts (no new registration needed)

- file: src/fallback.ts + src/fallback.test.ts
  why: test conventions — plain vitest, mock objects passed instead of real runtime deps

- file: plan/001_0d6760db6bc5/prd_snapshot.md (h3.6, h2.0 §1, h2.15)
  why: submit flow names sendMessage as the delivery primitive; commitment 1 makes this the
    only turn-triggering path; API surface list includes pi.sendMessage
```

### Current Codebase tree

```bash
src/ index.ts config.ts state.ts merge.ts depends-on.ts snapshots.ts tool-schema.ts guards.ts caps.ts results.ts fallback.ts tool.ts (+ *.test.ts)
# src/delivery.ts + delivery.test.ts arriving from P1.M2.T1.S1 (parallel) — buildSubmission side
```

### Desired Codebase tree

```bash
src/
  delivery.ts        # MODIFIED (by S1's merge or directly): add deliverSubmission + SendableMessage + DeliveryOptions
  delivery.test.ts   # MODIFIED: add deliverSubmission test suite
```

### Known Gotchas of our codebase & Library Quirks

```ts
// ESM: relative imports use ".js" suffix (`import { ... } from "./snapshots.js"`).
// CRITICAL: pi.sendMessage does NOT trigger a reply by default — the whole point of this item.
// triggerTurn only has effect when idle; passing it during steer is harmless but noisy — omit it.
// "nextTurn" NEVER triggers — never use it for submissions.
// ctx.isIdle() false covers retry/auto-compaction/queued continuations too, not just streaming —
//   steer is still correct in all those cases (queue behind whatever is running).
// Custom messages are role:"custom" and DO enter LLM context (model sees the delta) —
//   do not "helpfully" also appendEntry or sendUserMessage here.
// Tests must not import @earendil-works/pi-coding-agent at runtime; use Pick<...> types + vi.fn() mocks.
```

## Implementation Blueprint

### Data models and structure

No new data models beyond the option types. `deliverSubmission` is pure plumbing over S1's `SubmissionMessage`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: PREREQUISITE CHECK
  - IF src/delivery.ts already exists (S1 landed): extend it. IF NOT (S1 still in flight):
    create it containing S1's contract as specified in plan/001_0d6760db6bc5/P1M2T1S1/PRP.md —
    do NOT weaken or alter S1's buildSubmission behavior; only append your exports.
  - In either case keep S1's exports (SubmissionMessage, SUBMISSION_REMINDER, buildSubmission) intact.

Task 1: ADD types + deliverSubmission to src/delivery.ts
  - IMPLEMENT: DeliveryOptions, SendableMessage (= SubmissionMessage), deliverSubmission(pi, msg, ctx?)
  - SIGNATURE: pi: Pick<ExtensionAPI, "sendMessage">; ctx?: { isIdle?: () => boolean }
  - LOGIC: ctx?.isIdle?.() === false ? steer : followUp+triggerTurn (exact objects above)
  - NAMING: deliverSubmission (contract-mandated); exported
  - JSDOC: Mode A — full triggerTurn/deliverAs decision table (see Key Details)

Task 2: ADD tests to src/delivery.test.ts
  - IMPLEMENT: describe("deliverSubmission") with cases:
      * idle ctx → { triggerTurn: true, deliverAs: "followUp" }
      * busy ctx (isIdle: () => false) → { deliverAs: "steer" }, assert no triggerTurn key
      * no ctx → followUp branch
      * ctx without isIdle ({}) → followUp branch
      * message passed through unmutated (same reference), sendMessage called exactly once
      * throws propagate when sendMessage rejects
  - PATTERN: vi.fn() mock pi: `const sendMessage = vi.fn(); deliverSubmission({ sendMessage }, msg, ctx)`
  - NAMING: test("deliverSubmission uses steer while agent is busy", ...) style
  - PLACEMENT: extend S1's delivery.test.ts; do not remove S1's tests if present
```

### Implementation Patterns & Key Details

```ts
/**
 * Deliver an interrogation submission/completion message to the agent.
 *
 * pi.sendMessage does NOT trigger an agent reply by default — custom messages
 * merely enter the LLM context (role "custom"). Since our interrogate tool is
 * non-blocking (core commitment 1: no tool call ever waits on the user), this
 * function is the ONLY place in the extension that triggers a turn.
 *
 * Delivery matrix:
 * - Agent busy (ctx.isIdle() === false — running, retrying, auto-compacting,
 *   or has queued continuations): { deliverAs: "steer" }. The message queues
 *   and is delivered after the current assistant turn finishes its tool calls,
 *   before the next LLM call; the agent is already running so no trigger needed.
 * - Agent idle (default / unknown): { triggerTurn: true, deliverAs: "followUp" }.
 *   followUp delivers once the agent has no pending tool calls, and
 *   triggerTurn: true fires the LLM response immediately.
 * - "nextTurn" is never used: it never triggers anything.
 */
export function deliverSubmission(
  pi: Pick<ExtensionAPI, "sendMessage">,
  msg: SendableMessage,
  ctx?: { isIdle?: () => boolean },
): void {
  const busy = typeof ctx?.isIdle === "function" ? ctx.isIdle() === false : false;
  // PATTERN: exact option objects — do not add/remove keys; tests assert deep equality
  pi.sendMessage(msg, busy ? { deliverAs: "steer" } : { triggerTurn: true, deliverAs: "followUp" });
  // GOTCHA: fire-and-forget, return void; do not await, do not swallow errors
}
```

### Integration Points

```yaml
NO REGISTRATION: deliverSubmission is an exported function, not a pi hook — index.ts is NOT
  modified in this item. Wiring happens in P1.M2.T3.S1 (debug command) and P1.M3.T2.S2 (panel).
FUTURE (S3): completion record builder will produce a second SendableMessage variant routed
  through this same function; keep SendableMessage as the single widening point.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx tsc --noEmit          # typecheck (project script: npm run typecheck)
npx vitest run src/delivery.test.ts   # targeted
# Expected: zero errors.
```

### Level 2: Unit Tests (Component Validation)

```bash
npm test                                     # full suite (vitest run)
npx vitest run src/delivery.test.ts -t deliverSubmission -v
# Expected: all pass, including S1's buildSubmission tests (if landed) — no regressions.
```

### Level 3: Integration Testing (System Validation)

Deferred to P1.M2.T3.S1 (debug submit command) which will exercise the real path:
`/interrogate-debug-submit` in a live pi session with the extension loaded, observing that the
model replies after submission. This item has no runtime surface of its own to integration-test.

### Level 4: Creative & Domain-Specific Validation

Manual smoke (optional, if a live session is cheap): start `pi`, load extension, from a command
handler call `deliverSubmission(pi, buildSubmission(state, diff), ctx)` with agent idle → confirm
a new assistant turn begins. Streaming case can be observed by triggering while the agent streams.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean
- [ ] `npm test` green (all suites)
- [ ] deliverSubmission tests cover idle/busy/no-ctx/no-isIdle branches

### Feature Validation

- [ ] Idle branch options deep-equal `{ triggerTurn: true, deliverAs: "followUp" }`
- [ ] Busy branch options deep-equal `{ deliverAs: "steer" }`
- [ ] S1's exports untouched; S1 tests (if present) still pass
- [ ] JSDoc (Mode A) on deliverSubmission explains triggerTurn semantics
- [ ] No state mutation, no appendEntry, no sendUserMessage — sendMessage only

### Code Quality Validation

- [ ] `.js` ESM import suffixes
- [ ] Narrow `Pick<ExtensionAPI, "sendMessage">` pi type (mock-friendly)
- [ ] No try/catch that swallows sendMessage errors

### Documentation & Deployment

- [ ] Consumers named in JSDoc (P1.M2.T3.S1 debug submit, P1.M3.T2.S2 panel ctrl+s)
- [ ] No new env vars or config keys

---

## Anti-Patterns to Avoid

- ❌ Don't call pi.sendMessage without options — silently does not trigger a reply when idle
- ❌ Don't use `deliverAs: "nextTurn"` — never triggers
- ❌ Don't add triggerTurn to the steer branch (meaningless while busy)
- ❌ Don't couple deliverSubmission to InterrogationState or UI — it takes an already-built message
- ❌ Don't await or wrap sendMessage in error-swallowing try/catch
- ❌ Don't modify index.ts or add registrations — wiring belongs to P1.M2.T3.S1 / P1.M3.T2.S2

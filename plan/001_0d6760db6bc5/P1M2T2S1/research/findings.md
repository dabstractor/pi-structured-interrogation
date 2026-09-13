# Research notes — P1.M2.T2.S1 Auto-close engine

## Existing state/merge API (verified in src/state.ts, src/merge.ts)

- `QuestionStatus = "open"|"answered"|"submitted"|"reasked"|"moot"|"withdrawn"|"closed"` (state.ts:22).
- `state.setStatus(id, status)`, `state.orderedQuestions()`, `state.epoch`, `state.serialize()`.
- merge.ts already provides exactly the transitions named in the item CONTRACT:
  - `markSubmitted(state, ids)` → status "submitted" (ctrl+s flush path).
  - `closeSubmitted(state, ids)` → status "closed" (doc comment explicitly says "the auto-close engine (P1.M2.T2.S1) calls this after agent_settled for the submitted-at-epoch ids that were not re-asked").
  - `applyUpsert` rule 2 sets status "reasked" for changed-options upserts, but rule 1 (same options) keeps status — this is the case the engine must handle itself: after a tool_execution_end for interrogate/upsert, any touched id still in "submitted" must be flipped to "reasked" manually.
- No `markReasked` helper exists in merge.ts — engine calls `state.setStatus(id, "reasked")` directly (legal: setStatus has no prior-status guard).
- "Submitted-at-current-epoch": state does NOT track per-question submitted epoch. Invariant that makes a proxy safe: every agent_settled close pass closes ALL outstanding "submitted" questions not re-asked, so at any settle, questions with status "submitted" were necessarily submitted at the latest epoch (earlier ones were closed or re-marked). Predicate: `status === "submitted"`.
- Snapshot ring (`snapshots.ts takeSnapshot`, called by `buildSubmission` pre-bump) is available for defensive verification but not needed by the engine.

## pi event API (plan/001_0d6760db6bc5/architecture/pi-api-validation.md)

- `tool_execution_start` — `event: { toolCallId, toolName, args }` (args ONLY here).
- `tool_execution_end` — `event: { toolCallId, toolName, result, isError }` (NO args) → correlate by toolCallId.
- `agent_settled` — fires when Pi will not continue automatically. **Abort semantics undocumented** (Unknown 1) → FR-4 treats aborts as settled; keep the close pass idempotent so double-fire / abort-fire is safe.
- Subscriptions via `pi.on(event, handler)` — verified overloads TD types.d.ts:909–940.
- Handler ctx includes `ctx.isIdle()`.

## Delivery contract (src/delivery.ts, S1+S2 landed)

- `buildSubmission(...)` is the ONLY snapshot+bumpEpoch site (epoch ends n+1 after build).
- `deliverSubmission(pi, msg, ctx?)` is pure plumbing ({ sendMessage } mock-able), fire-and-forget — it must NOT be modified to notify the engine. Therefore the engine exposes `noteSubmissionDelivered()` which the submit flow calls right after deliverSubmission (future callers: P1.M2.T3.S1 debug submit command, P1.M3.T2.S2 panel ctrl+s). Both PRPs get this contract via the item chain.
- S3 (parallel) adds `buildCompletion` + widens `SendableMessage` — completion trigger is P1.M2.T2.S2, NOT this item. This item only exposes a post-close-pass hook S2 can consume.

## index.ts wiring

Currently only registers ping command + interrogate tool (src/index.ts, 38 lines). Lifecycle subscription lands here per the item ("Subscribe in index.ts").

## Test conventions

- vitest, colocated `*.test.ts`, plain describe/test, fixtures built via `createInterrogationState("goal")` + `upsertQuestion` + `applyAnswer`/`setStatus`. No pi runtime needed — mock `pi.on` with `vi.fn()` and capture handlers, then invoke them with synthetic events.

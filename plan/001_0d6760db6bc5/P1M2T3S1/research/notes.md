# Research notes — P1.M2.T3.S1 debug commands

## Codebase facts verified (2025 session read)

- `src/index.ts:32-37` — registerCommand pattern: `pi.registerCommand("interrogate-ping", { description, handler: async (_args, ctx) => ctx.ui.notify("…","info") })`. Factory loads config once (`loadConfig`).
- `src/tool.ts:185` — `export function executeInterrogate(args: unknown, ctx: ExecutorContext, config?)` — synchronous, routes parse → guards → caps → merge → results. `ExecutorContext = { mode: string, hasUI: boolean, model?: { contextWindow? } }`. Throws plain Error (malformed / no-state record/reopen) and propagates StaleError. Module-level `activeConfig` set by `createInterrogateTool`.
- `src/delivery.ts` — `buildSubmission(state, diff, note?)` (line 116): takes snapshot at pre-bump epoch then `state.bumpEpoch()` itself; returns SubmissionMessage `{customType:"interrogation-submission", content, display:true, details}`. `deliverSubmission(pi, msg, ctx?)` (line 465): busy → `{deliverAs:"steer"}`, idle → `{triggerTurn:true, deliverAs:"followUp"}`; forced idle by passing `{isIdle: () => true}`.
- `src/snapshots.ts` — `takeSnapshot(state)` (126), `computeDiff(...)` (200), `digestSince` (238); `DiffEntry`, `SubmissionCardData` shapes. Ring lives on state; buildSubmission JSDoc says diff must be computed pre-flush by the caller (panel precondition).
- `src/fallback.ts:197` — `recordAnswers(state, answers)` — canonical answer flush: `state.applyAnswer(id, {value, at: new Date().toISOString()})`, unknown-id collection, NO option validation; guard ordering: assertFresh must precede (executor-owned), not re-checked.
- `src/results.ts:87` — `buildStatusLine(SerializedState)` (h2.28); `buildUpsertResult` embeds warnings in render rows; `ResultDetails.statusLine` is the cheap extract point.
- `src/state.ts` — class `InterrogationState` (`goal` readonly, `epoch=1`), `getState`/`setState`/`resetState` (524-541), `serialize()`, `getQuestion`, `applyAnswer`, `orderedQuestions`.
- Build/test: `npm test` (vitest run), `npm run typecheck` (tsc --noEmit). Tests colocated `*.test.ts`, vi.fn stubbing style in tool.test.ts / delivery.test.ts.

## PRD anchors

- h2.50 Testing: scripted model turns unreliable; debug command must invoke the same code path. AC runbook P1.M7.T6.S1 uses these commands for AC-2/3/8/13/14 state-level.
- h3.6 Submit (partial, immediate): flush → diff → delta message → epoch bump.
- h2.3 naming: `/interrogate-debug-upsert|submit|state` final strings.
- P1.M2.T2.S2 (parallel, contract): completion trigger consumes lifecycle close-pass seam; state gains `completed` flag inside `clearForCompletion` — debug submit triggering a full settle→close→completion cycle in a live session is expected behavior, not a bug.

## Open point resolved by PRP Task 1

- `computeDiff` exact parameter list (snapshots.ts:200) must be read before coding; PRP instructs capturing the pre-flush ring snapshot before `applyAnswer`.

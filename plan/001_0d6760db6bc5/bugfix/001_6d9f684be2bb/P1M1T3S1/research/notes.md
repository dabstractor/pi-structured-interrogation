# Research — BUG-010 fix (assertFresh: reject epoch-less upserts touching existing ids)

## Current code (verified by reading)
- `src/guards.ts` `assertFresh(state, parsed)` (~line 172):
  - read/reopen: return immediately (never guarded).
  - record: `parsed.epoch === undefined` → plain `Error("answers requires epoch: include the epoch from your last read/result")`; wrong epoch → `epochStale` StaleError with `digestSince`.
  - upsert: per-question rev guard loop (existing ids must send current rev; first mismatch throws combined/rev-only StaleError). Final check: `if (sentEpoch !== undefined && sentEpoch !== state.epoch) throw epochStale(...)` — epoch is OPT-IN on upsert (BUG-010).
- `StaleError` and `buildStaleMessage` exported from guards.ts. `digestSince(state, sentEpoch)` builds the delta digest.
- `src/tool-schema.ts` line ~108: `epoch: Type.Optional(Type.Integer({ description: "REQUIRED with questions/answers: the session epoch you last saw (guards stale updates)" }))` — description must be rewritten per this item.
- `state.getQuestion(id) !== undefined` is the existing-id test (state.ts).

## Test patterns (verified)
- `src/guards.test.ts` (426 lines): drives the REAL state API — `createInterrogationState("goal")`, seeds via `state.upsertQuestion(...)`, `capture(() => assertFresh(...))`, asserts `err.message` substrings. Guards are tested WITHOUT executeInterrogate. Uses beforeEach, describe blocks "assertFresh — <topic>".
- `src/tool.test.ts`: executor level — `seedState(goal)`, `seedQ(st,id)`, `qi(id,{rev,...})`, `tuiCtx()`, `executeInterrogate(args, tuiCtx())`, `getState()`. StaleError imported from `./guards.js`.

## CRITICAL blast radius — existing tests that upsert existing ids WITHOUT epoch
~58 occurrences of `rev: 1` in tests with no epoch key. Verified examples that will newly throw:
- tool.test.ts:153 ("goal on upsert REPLACES"), :161 ("goal OMITTED"), :175 ("reuse upsert caps"), :196 ("merge rule 1") — each does `executeInterrogate({ questions: [qi("q1", { rev: 1, ... })] })` with no epoch after `seedQ(st, "q1")`.
- guards.test.ts "pass-through and guard matrix" describe (~lines 228–261): upsert fixtures touching existing ids with no epoch that currently expect success.
- Likely also fallback/merge/snapshot/completion suites that drive upserts on existing ids — implementer must run full `npm test` and add `epoch: 1` (or `epoch: state.epoch`) to every affected fixture. Failing-test triage IS part of this fix; do not weaken the guard to satisfy tests.

## Interaction with parallel P1.M1.T2.S1 (fresh-state swap on completion)
T2S1 swaps the singleton to a fresh state when `existing.completed === true` BEFORE assertFresh. On a fresh state there are no existing ids → our new check passes trivially. No conflict. (On any upsert path, the check runs against whatever state assertFresh receives — pure function of (state, parsed).)
P1.M1.T1.S2 already changed the epoch... no: T1.S2 only changed goal handling. Epoch field description in tool-schema.ts already carries a goal note from T1.S2 edits (verified: goal description mentions updatability) — only the EPOCH line changes here.

## Error-message precedent
Record path uses plain Error (not StaleError) for MISSING epoch because there is no digest to show. Our new upsert missing-epoch error follows the same precedent but the message must include the current epoch for self-heal: item text specifies:
`STALE: upsert touching existing questions requires the session epoch (current {state.epoch}). Re-send with epoch.`
(Note: plain `Error` class per the record-path precedent, "STALE:" prefix in text. Do NOT attach digestSince — there is no baseline epoch to diff from.)

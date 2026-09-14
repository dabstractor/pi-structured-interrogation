---
name: "BUG-010 — assertFresh: reject epoch-less upserts touching existing ids"
description: "Close the opt-in epoch guard hole in the upsert path: an upsert that touches ≥1 existing question must carry the session epoch; missing epoch → plain Error with self-heal message containing the current epoch. Plus schema-description and JSDoc sync."
---

## Goal

**Feature Goal**: In `src/guards.ts` `assertFresh`, the upsert path currently enforces the epoch only when one is sent (`if (sentEpoch !== undefined && sentEpoch !== state.epoch)`). Change it so an upsert whose batch contains **≥1 id that already exists in state** (`state.getQuestion(id) !== undefined`) and whose `parsed.epoch === undefined` **throws a plain `Error`** with a self-heal message that includes the current epoch. Fixes BUG-010 (PRD h2.3/h3.9): h2.22 requires upserts touching existing questions to echo BOTH the per-question revs AND the session epoch; today the epoch half is opt-in.

**Deliverable**:
1. `src/guards.ts` — new missing-epoch check in the upsert branch of `assertFresh` (rev checks and sent-epoch mismatch behavior byte-identical) + updated JSDoc.
2. `src/tool-schema.ts` — `epoch` field description rewritten to the precise rule (Mode A docs).
3. `src/guards.test.ts` + `src/tool.test.ts` — new cases + fixing existing fixtures that now need `epoch`.

**Success Definition**: PRD h2.3/h3.9 repro — upsert q1; `executeInterrogate({questions:[{id:"q1", rev:1, ...}]})` with NO epoch → isError/throw; first-call upserts with brand-new ids and no epoch still succeed; `npm run typecheck` + `npm test` green (existing tests updated, not deleted).

## User Persona (if applicable)

**Target User**: The AI coding agent calling `interrogate` (consumer of the error message); extension maintainers (correctness of the staleness contract).

**Use Case**: The agent upserts a second batch touching questions it already asked. The guard forces it to have done a read (or held a result) first — write's read-before-write discipline, h2.22.

**User Journey**: Agent sends epoch-less upsert touching q1 → tool returns isError `STALE: upsert touching existing questions requires the session epoch (current 1). Re-send with epoch.` → agent re-sends with `epoch: 1` (value handed to it in the message) → succeeds.

**Pain Points Addressed**: Silent opt-in staleness protection; lost-update risk when the model mutates existing questions off a stale view.

## Why

- PRD h2.22 (guards, Q38=A): "upserts touching existing questions must echo each question's rev AND the session epoch." The `answers[]` path already enforces epoch presence; the upsert path doesn't — inconsistent and under-protective.
- The current schema description even says epoch is "REQUIRED with questions/answers" while the code accepts epoch-less existing-id upserts — contract drift between docs and behavior. This fix aligns both directions (behavior tightened, description made precise).

## What

1. **`src/guards.ts` — upsert branch of `assertFresh`**: after (or before — see Blueprint for ordering rationale) the per-question rev loop, if `parsed.epoch === undefined` AND any incoming id satisfies `state.getQuestion(q.id) !== undefined`, throw:
   ```ts
   throw new Error(
     `STALE: upsert touching existing questions requires the session epoch (current ${state.epoch}). Re-send with epoch.`,
   );
   ```
   Plain `Error`, NOT `StaleError` — same precedent as the record path's missing-epoch error (guards.ts:217–222): there is no sent epoch, hence no `digestSince` delta to show; the self-heal value (current epoch) is embedded instead.
   - Keep everything else untouched: rev-guard loop, combined/rev-only StaleError shapes, final `sentEpoch !== undefined && sentEpoch !== state.epoch` check, read/reopen early return, record path.
   - Ordering note: run the missing-epoch presence check **after the rev loop** (so a genuinely stale rev still gets the richer StaleError first) — OR compute `touchesExisting` before the loop and check missing-epoch first. Pick ONE, document it in a comment; the recommended order is: rev loop first (richest diagnostics), then missing-epoch-on-existing-ids check, then the existing sent-epoch mismatch check.
2. **`src/tool-schema.ts` (~line 108) — epoch description**: replace `"REQUIRED with questions/answers: the session epoch you last saw (guards stale updates)"` with the precise rule, e.g.:
   `"Required when recording answers and when upserting questions that already exist (include the epoch from your last read/result); optional for a first upsert of brand-new questions (guards stale updates)."`
3. **`assertFresh` JSDoc**: update the `upsert` bullet to state the new rule: existing-id upserts MUST carry `epoch`; missing epoch → plain Error with the current epoch in the message; first-call all-new-id upserts may omit it.
4. **Tests**:
   - `src/guards.test.ts` (real-state pattern, no mocks): new describe "assertFresh — upsert epoch presence (BUG-010)": epoch-less upsert touching existing id throws Error with message containing "current {epoch}" and "Re-send with epoch"; epoch-less upsert with ONLY new ids passes; epoch-less upsert mixing one new + one existing id throws; matching epoch passes (existing behavior); read/reopen still never guarded even with stale epochs.
   - `src/tool.test.ts` executor-level case per item contract: seed state + q1, `executeInterrogate({ questions: [qi("q1", { rev: 1 })] }, tuiCtx())` (no epoch) → returns an isError result (check how the executor converts thrown guards errors — the existing StaleError cases at tool.test.ts:184–192 show the executor propagates errors; plain Errors are likewise surfaced as isError; match the actual mechanism you find).
   - **Fix existing fixtures** (blast radius): ~58 occurrences of `rev: 1` without epoch across suites; verified offenders in `tool.test.ts` (lines ~153, ~161, ~175, ~196) and `guards.test.ts` "pass-through and guard matrix" (~lines 228–261). Add `epoch: 1` (or the state's current epoch, e.g. `epoch: st.epoch`) to every upsert touching existing ids. Run the FULL suite; fix every failure this way — never weaken the guard to make a test pass.

### Success Criteria

- [ ] PRD h2.3/h3.9 repro: epoch-less upsert touching q1 → thrown Error, message includes current epoch and "Re-send with epoch"
- [ ] First upsert of brand-new ids with NO epoch still succeeds (schema stays `Type.Optional`)
- [ ] Existing-id upsert WITH matching epoch + matching rev succeeds exactly as before (no behavior change)
- [ ] Sent-but-mismatched epoch behavior unchanged (epoch-only StaleError with digest)
- [ ] read/reopen remain never-guarded
- [ ] tool.test.ts executor-level isError case present
- [ ] tool-schema.ts epoch description + assertFresh JSDoc updated (Mode A)
- [ ] `npm test` + `npm run typecheck` green

## All Needed Context

### Context Completeness Check

The PRP quotes the exact current guard code, the exact error-message precedent, the exact schema line to rewrite, both test files' conventions, the verified list of tests that will break, and the interaction with the parallel fresh-state-swap item. An agent with this PRP + `src/guards.ts`, `src/tool-schema.ts`, and the two test files can implement it without further discovery.

### Documentation & References

```yaml
- file: src/guards.ts
  why: THE logic file. assertFresh upsert branch (~lines 205–235); record-path missing-epoch precedent at 217–222 (plain Error, no digest); epochStale helper at bottom.
  pattern: "read/reopen early-return → record branch → upsert rev loop → final sent-epoch mismatch check. Insert the new missing-epoch-on-existing-ids check per the ordering note."
  gotcha: "Use plain Error (StaleError implies digest details the caller can't be given — there's no sent epoch to diff from). Do not touch StaleError, buildStaleMessage, digestSince, or epochStale."

- file: src/guards.test.ts
  why: test conventions — real state via createInterrogationState + upsertQuestion; capture(() => assertFresh(...)) helper; describe-per-topic; asserts err.message substrings
  pattern: "see describe blocks 'assertFresh — h3.8 message shapes' and 'pass-through and guard matrix' (~lines 211–261 — the matrix cases are the ones needing epoch added)"
  gotcha: ~426 lines; fixtures at top (state seeds) are shared — read before editing

- file: src/tool.test.ts
  why: executor-level conventions — seedState(seed)/seedQ/qi/tuiCtx/executeInterrogate/getState; StaleError imported from "./guards.js" (line 23)
  pattern: "stale upsert test at lines 184–192 shows how thrown guard errors surface; mirror it for the plain-Error case (lines ~153/161/175/196 need epoch added)"
  gotcha: "line 161 currently EXPECTS success for an epoch-less existing-id upsert ('goal OMITTED leaves goal unchanged') — it must gain epoch: 1 and keep expecting success"

- file: src/tool-schema.ts
  why: epoch field description (~line 108) to rewrite; MUST stay Type.Optional (first-call upserts remain epoch-less-friendly)
  pattern: neighbor field descriptions are one-liners; goal description was already rewritten by P1.M1.T1.S2 — follow its precise-rule style

- file: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/P1M1T2S1/PRP.md
  why: CONTRACT for the parallel fresh-state-swap — a completed-state upsert swaps to a fresh state BEFORE assertFresh, where no existing ids exist → our new check passes trivially. No conflict; do not add completed-state special-casing here.
  gotcha: T2S1 also edits tool.ts upsert tests — land on top of its shape

- file: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/P1M1T3S1/research/notes.md
  why: verified line-by-line research — current guard code, message precedent, blast-radius list of epoch-less fixtures
```

### Current Codebase tree (relevant slice)

```bash
src/
  guards.ts           # assertFresh, StaleError, buildStaleMessage, digestSince
  guards.test.ts      # 426 lines, real-state fixtures
  tool-schema.ts      # TypeBox InterrogateParams (epoch ~line 108)
  tool.ts             # executor: upsert/read/reopen/record cases
  tool.test.ts        # executor tests (seedState/seedQ/qi/tuiCtx)
  state.ts            # getQuestion / createInterrogationState (used by tests only here)
  # + merge.ts, snapshots.ts, fallback.ts, completion.ts, panel/, etc. (suites may also carry epoch-less existing-id upserts)
```

### Desired Codebase tree

```bash
# No new files — modifications only:
src/guards.ts         # + missing-epoch-on-existing-ids check + JSDoc
src/tool-schema.ts    # epoch description rewrite
src/guards.test.ts    # + BUG-010 describe; matrix fixtures gain epoch
src/tool.test.ts      # + executor isError case; ~4 fixtures gain epoch
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: plain Error for MISSING epoch (record-path precedent, guards.ts:217–222) — StaleError only for WRONG values (it carries digestSince, which needs a baseline epoch).
// CRITICAL: schema epoch stays Type.Optional — brand-new first upserts MUST work without epoch (h2.3/h3.9 fix is about EXISTING ids only).
// "Touches existing" = ANY incoming id with state.getQuestion(id) !== undefined (mix of new+existing counts).
// ~58 `rev: 1` occurrences without epoch across test suites — run the FULL `npm test` and triage every failure by adding epoch, never by relaxing the guard.
// Message must embed state.epoch verbatim — it is the self-heal value ("current {state.epoch}").
// ESM: relative imports use ".js" suffix (guards.test.ts imports "./guards.js").
```

## Implementation Blueprint

### Data models and structure

No new types. The only data touched: `ParsedAction` (from tool-schema — `epoch?: number` on `upsert`/`record`) and `InterrogationState.getQuestion`. Both already exist.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: FAILING TESTS FIRST (TDD) — src/guards.test.ts
  - ADD describe "assertFresh — upsert epoch presence (BUG-010)" with the 5 cases listed under "What" §4
  - WATCH the missing-epoch cases fail (they currently pass silently) before touching guards.ts

Task 2: MODIFY src/guards.ts — upsert branch of assertFresh
  - AFTER the per-question rev loop, BEFORE the final sent-epoch mismatch check, add:
    const touchesExisting = parsed.questions.some((q) => state.getQuestion(q.id) !== undefined);
    if (parsed.epoch === undefined && touchesExisting) {
      throw new Error(
        `STALE: upsert touching existing questions requires the session epoch (current ${state.epoch}). Re-send with epoch.`,
      );
    }
  - ADD a one-line comment on the ordering choice (rev loop first = richest diagnostics win)
  - UPDATE the upsert bullet in assertFresh's JSDoc (Mode A): rule + error class + first-upsert exception
  - PRESERVE: rev loop, both StaleError shapes, epochStale, record branch, read/reopen return

Task 3: MODIFY src/tool-schema.ts — epoch description (~line 108)
  - REPLACE the "REQUIRED with questions/answers" text with the precise rule (exact suggested text under "What" §2)
  - KEEP Type.Optional — no schema-level enforcement

Task 4: FIX EXISTING TEST FIXTURES (blast radius)
  - RUN: npm test — collect every failure
  - FIX: add `epoch: 1` (or `epoch: st.epoch` / current epoch) to each upsert that touches existing ids
  - KNOWN offenders: tool.test.ts ~153/161/175/196; guards.test.ts "pass-through and guard matrix" ~228–261; audit fallback/merge/snapshot/completion suites too
  - NEVER: delete a test or weaken the guard to make one pass

Task 5: ADD executor-level case — src/tool.test.ts
  - seedState + seedQ(st,"q1"); executeInterrogate({ questions: [qi("q1", { rev: 1 })] }, tuiCtx()) with NO epoch
  - ASSERT isError result (match the executor's actual thrown-error surface mechanism — see the StaleError case at tool.test.ts:184–192 for how errors are asserted; if the executor wraps instead of propagates, assert the wrapped shape)
  - FOLLOW-UP assertion: re-sending with epoch: 1 succeeds (self-heal round-trip)
```

### Implementation Patterns & Key Details

```ts
// Ordering inside the upsert branch (final shape):
// 1. rev loop (unchanged) — richest StaleError diagnostics for genuinely stale revs
// 2. NEW: missing-epoch-on-existing-ids → plain Error with current epoch (self-heal)
// 3. sent-but-mismatched epoch → epochStale (unchanged)

// Why plain Error, not StaleError: the record path (guards.ts:217–222) already
// established that a MISSING required value is a required-param violation, not
// staleness — and StaleError's `details` contract carries a digestSince delta,
// which is impossible without a baseline epoch. The current epoch in the message
// IS the remedy.
```

### Integration Points

```yaml
NO-DOWNSTREAM-CHANGES:
  - "assertFresh signature unchanged; callers (tool.ts executor) already catch/propagate guard errors"
  - "tool-schema.ts schema shape unchanged (Type.Optional stays) — only the description string changes"
  - "Panel/lifecycle/fallback untouched — this is a pure guard-tightening fix"
PARALLEL-ITEM COMPAT:
  - "P1.M1.T2.S1 (fresh-state swap): swaps to a fresh state BEFORE assertFresh — no existing ids → new check passes. No special-casing needed here."
  - "P1.M1.T1.S2 (goal cap): rewrote the goal description neighbor; follow its style, don't touch its text."
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # tsc --noEmit — clean
```

### Level 2: Unit Tests

```bash
npm test                          # FULL suite — this fix intentionally breaks fixtures; all must be triaged to green
npx vitest run src/guards.test.ts -v
npx vitest run src/tool.test.ts -v
```

### Level 3: Integration Testing

```bash
# PRD h2.3/h3.9 repro, driven at the executor level (tool.test.ts covers it; optional manual probe):
# upsert q1 → epoch-less upsert touching q1 → isError containing "current 1" → retry with epoch → success
```

### Level 4: Creative & Domain-Specific Validation

Not applicable — pure guard logic, no UI/runtime surface.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean
- [ ] `npm test` fully green (new cases + every triaged fixture)

### Feature Validation

- [ ] PRD repro closed: epoch-less existing-id upsert rejected with self-heal message
- [ ] First upsert (all-new ids, no epoch) still accepted
- [ ] Mismatched-epoch and stale-rev behaviors unchanged
- [ ] read/reopen never guarded
- [ ] Executor surfaces the rejection as isError (tool.test.ts case)

### Code Quality Validation

- [ ] Plain Error (not StaleError) for the missing-epoch case; StaleError classes/di digest logic untouched
- [ ] Only the epoch description string changed in tool-schema.ts (still Type.Optional)
- [ ] No deleted tests; fixtures extended with epoch, not weakened

### Documentation & Deployment

- [ ] assertFresh JSDoc + tool-schema epoch description state the precise rule (Mode A)
- [ ] No new dependencies, no config changes

---

## Anti-Patterns to Avoid

- ❌ Don't make epoch required at the TypeBox schema level — first-call upserts must stay epoch-less-friendly (h2.3/h3.9 fix targets existing ids only)
- ❌ Don't throw StaleError for a missing epoch — there's no digest to show (follow the record-path precedent)
- ❌ Don't reorder/break the existing rev-loop diagnostics to shoehorn the check in first without documenting why
- ❌ Don't delete or `skip` failing fixtures — add the epoch they now need
- ❌ Don't add completed-state special-casing here — that's P1.M1.T2.S1's contract
- ❌ Don't catch the new Error inside assertFresh or the executor to "warn instead" — h2.22 mandates rejection

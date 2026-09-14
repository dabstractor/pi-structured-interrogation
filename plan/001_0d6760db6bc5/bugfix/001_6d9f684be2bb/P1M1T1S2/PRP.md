# PRP — Bugfix P1.M1.T1.S2: tool.ts — apply capped goal on create AND update upserts

## Goal

**Feature Goal**: The `interrogate` upsert path applies the **caps-enforced goal** in BOTH cases: on state creation (capped, not raw) and on later upserts when the action carries `goal` (via `state.setGoal(capped.goal)`). Fixes BUG-001's tool-layer half (goal updates were silently dropped) and BUG-009's tool-layer half (uncapped goal stored while the result claims truncation). Tests asserting the buggy "goal is fixed" behavior are rewritten — tests are the contract.

**Deliverable**: Modified `src/tool.ts` (upsert case), `src/tool-schema.ts` (goal field description), `src/tool.test.ts` (rewritten assertions + new cases). No other files.

**Success Definition**:
- `npm run typecheck` + `npm test` all green (930 existing + S1's setGoal tests + new/rewritten goal tests)
- Create: `getState().goal === capped.goal` (goal >400 chars → truncated to 400, warning present)
- Reuse with `goal` present: `state.goal` updates to the capped value; `details.state.goal` reflects it
- Reuse with `goal` omitted: goal unchanged
- Read routing untouched (goal-only `{}` call still a read)

## Why

BUG-001 (PRD h2.2/h3.0): FR-30 requires an agent-supplied, **updatable** goal; the schema accepts `goal` on every upsert, but tool.ts reuses the singleton and silently discards it. BUG-009 (h2.3/h3.8): even the create path stores the RAW goal while `applyCaps` computes the capped one — over-budget goals exceed the 400-char cap in stored state. S1 delivered `setGoal()`; this subtask wires it.

## What

1. **Rewrite the stale doc comment** in tool.ts (~lines 198–201) asserting "the goal is FIXED for the lifetime of the state (`InterrogationState.goal` is readonly, no setter exists — verified)" — goal is now updatable via `setGoal` on any upsert carrying `goal`.
2. **Upsert case (tool.ts ~248–271)**:
   - Compute `capped = applyCaps(...)` (pure — no state mutation) BEFORE creating/registering state.
   - CREATE path (`existing == null`): `createInterrogationState(parsed.action.goal !== undefined ? capped.goal : "")` — capped goal at construction; `setState` as today.
   - REUSE path: after `assertFresh` and after `applyUpsert`, if `parsed.action.goal !== undefined` → `state.setGoal(capped.goal)`.
   - KEEP `assertFresh` ordering: guards run before any state mutation.
   - Goal applies **only on upsert actions**; read/record/reopen routing untouched.
3. **tool-schema.ts line 107**: append to the goal field description that the goal is updatable on any upsert call (Mode A docs).
4. **tool.test.ts**: rewrite lines 145–154 (goal-NOT-replaced test) to expect the update; add cap/omission cases (below).

### Success Criteria

- [ ] Create upsert with 500-char goal → `getState().goal.length === 400`, `goal truncated at 500 chars` warning in result content
- [ ] Reuse upsert with `goal: "UPDATED"` → `getState().goal === "UPDATED"` and `r.details.state.goal === "UPDATED"`
- [ ] Reuse upsert WITHOUT `goal` → goal unchanged (no setGoal call, no extra `changed` event)
- [ ] Stale upsert (wrong epoch) with a goal → StaleError thrown, goal NOT mutated (assertFresh before setGoal)
- [ ] Doc comment + schema description updated; all tests green

## All Needed Context

### Context Completeness Check

Repo is fully implemented and green (930 tests). This PRP cites exact current code of the upsert case, the CapsResult contract, and the test file's helpers — an agent with only this PRP plus `src/tool.ts`, `src/tool-schema.ts`, `src/tool.test.ts` can implement it.

### Documentation & References

```yaml
- file: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/P1M1T1S1/PRP.md
  why: "CONTRACT for setGoal(): signature `setGoal(goal: string): void`, emits `changed` with full serialized snapshot, no rev/epoch bump, always emits (caller gates)"
  critical: S1 assumes THIS subtask flips tool.test.ts:145-154 — do not leave it passing against old semantics

- file: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/P1M1T1S2/research/notes.md
  why: verified line-by-line research — current upsert code, CapsResult shape, test conventions, warning text

- file: src/tool.ts
  why: "the only logic file to modify. Upsert case at ~248-271 (see notes.md for verbatim excerpt); stale doc comment at 198-201; upsertWarnings at 176"
  pattern: "upsertWarnings(parsed.warnings, capped.warnings) already carries the `goal truncated at {n} chars` warning into the result once applyCaps computed it — no extra plumbing"
  gotcha: applyCaps is PURE (structuredClone) — safe to hoist above state creation; but assertFresh must still run before ANY mutation (setGoal/applyUpsert), never before singleton registration

- file: src/caps.ts
  why: "CapsResult (lines 40-46, 191): `{ questions: kept, goal: cappedGoal, warnings }`; truncation warning literal `goal truncated at ${originalLength} chars` (line 188); cap default 400 from config.caps.goal"
  gotcha: do NOT re-implement truncation in tool.ts — capped.goal is authoritative

- file: src/tool.test.ts
  why: "rewrite lines 145-154; conventions: beforeEach resetState(); helpers seedState(goal)/seedQ(st,id)/qi(id,{rev,...}); stubs tuiCtx()/printCtx(); assertions via executeInterrogate(args, tuiCtx()) then getState()"

- file: src/tool-schema.ts
  why: "line 107 goal field description — append updatable semantics ([Mode A] docs = source of truth for protocol docs)"
```

### Current Codebase tree (relevant excerpt)

```bash
src/
├── tool.ts           # MODIFY: upsert case + doc comment (~198-201, ~248-271)
├── tool.test.ts      # MODIFY: rewrite 145-154, add cases
├── tool-schema.ts    # MODIFY: line 107 description
├── caps.ts           # untouched (applyCaps already returns capped.goal)
├── state.ts          # untouched (setGoal delivered by S1)
└── ...
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: two `changed` events fire on a goal-carrying reuse upsert
//   (applyUpsert + setGoal each emit). That is expected per S1 ("setGoal always
//   emits; callers gate"). Do NOT try to coalesce events.
// GOTCHA: create-path goal: when parsed.action.goal === undefined the create
//   still uses "" (today's behavior) — do NOT pass capped.goal ("") in a way
//   that changes the goal-omitted create semantics ("" either way; keep the
//   ternary explicit for clarity).
// GOTCHA: hoisting applyCaps above state creation changes NOTHING observable
//   (pure) — but keep the applyCaps args identical: (parsed.action.questions,
//   parsed.action.goal ?? "", config, ctx.model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW).
// GOTCHA: assertFresh(state, parsed.action) BEFORE applyUpsert AND setGoal —
//   a STALE upsert carrying a new goal must leave state.goal untouched.
// GOTCHA: setGoal on the REUSE path only when parsed.action.goal !== undefined —
//   omitting goal on a re-ask must never wipe it to "".
// GOTCHA: executor is fully synchronous and UI-free (h2.0 §1) — setGoal's
//   `changed` event is the panel-trigger mechanism; do not await anything.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: REWRITE stale doc comment in src/tool.ts (~198-201)
  - REPLACE the "goal is FIXED for the lifetime of the state (readonly, no
    setter exists — verified)" bullet WITH: on upsert, the goal applies when
    present — create path constructs with the CAPPED goal; reuse path calls
    state.setGoal(capped.goal); omitted goal leaves it unchanged; cap enforced
    via applyCaps (caps.ts), warning `goal truncated at {n} chars` surfaces in
    the result.

Task 2: REORDER + APPLY in the upsert case (src/tool.ts ~248-271)
  - NEW shape:
      const capped = applyCaps(parsed.action.questions, parsed.action.goal ?? "",
                               config, ctx.model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW);
      const state: InterrogationState =
        existing ?? createInterrogationState(parsed.action.goal !== undefined ? capped.goal : "");
      if (!existing) setState(state);
      assertFresh(state, parsed.action);          // guards BEFORE mutation (unchanged rule)
      applyUpsert(state, capped.questions.map(toMergeQuestion));
      if (existing && parsed.action.goal !== undefined) state.setGoal(capped.goal);
  - Keep everything below (serialize, non-TUI composite, buildUpsertResult) unchanged.

Task 3: UPDATE src/tool-schema.ts line 107
  - description: "What these questions drive toward; shown in the panel
    header. Updatable: a goal sent on ANY upsert replaces the current one
    (capped at config caps.goal, default 400 chars)."

Task 4: REWRITE tool.test.ts:145-154 + add cases (same describe "executeInterrogate: upsert (TUI)")
  - REPLACE test "existing state: goal is NOT replaced..." WITH
    "existing state: goal on upsert REPLACES the stored goal":
      const st = seedState("first goal"); seedQ(st, "q1");
      const r = executeInterrogate({ goal: "second goal", questions: [qi("q1", { rev: 1 })] }, tuiCtx());
      expect(getState()!.goal).toBe("second goal");
      expect(r.details.state.goal).toBe("second goal");
  - ADD "existing state: goal OMITTED on upsert leaves goal unchanged":
      upsert without goal → getState().goal === "first goal"
  - ADD "create upsert stores the CAPPED goal (BUG-009)":
      executeInterrogate({ goal: "x".repeat(500), questions: [qi("q1")] }, tuiCtx())
      → getState()!.goal.length === 400; result content includes
        "goal truncated at 500 chars" (follow the existing warnings-order test at ~163 for how warnings appear)
  - ADD "reuse upsert caps an over-budget goal":
      seedState("first goal"); seedQ q1; upsert goal 500 chars rev 1
      → goal.length === 400, warning present
  - ADD "stale upsert with goal throws and leaves goal untouched":
      seedState("first goal"); seedQ q1; executeInterrogate({ goal: "evil",
        epoch: 999, questions: [qi("q1", { rev: 1 })] }, tuiCtx()) →
      expect(...).toThrow(StaleError); getState()!.goal === "first goal"
  - ADD (optional, cheap) "setGoal emits changed": capture via
      getState()!.on("changed", ...) — state.test.ts pattern (S1 already
      covers; skip if redundant)

Task 5: RUN gates
  - npm run typecheck && npm test   (all green)
  - npx vitest run src/tool.test.ts -v
```

### Implementation Patterns & Key Details

```ts
// The whole change, in place (upsert case):
const capped = applyCaps(
  parsed.action.questions,
  parsed.action.goal ?? "",
  config,
  ctx.model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
);
const state: InterrogationState =
  existing ?? createInterrogationState(parsed.action.goal !== undefined ? capped.goal : "");
if (!existing) setState(state);
assertFresh(state, parsed.action); // StaleError propagates (h2.22)
applyUpsert(state, capped.questions.map(toMergeQuestion));
if (existing && parsed.action.goal !== undefined) state.setGoal(capped.goal); // BUG-001 fix
// serialize() NOW reflects the updated/capped goal in details.state.goal.
```

### Integration Points

```yaml
STATE: "setGoal from S1 — signature fixed; emits changed (panel header, persistence, renderers all react via the event, zero further wiring)"
FUTURE: "P1.M1.T2.S1 (fresh-state swap) reuses this exact capped-goal block — keep it one coherent sequence, no inline duplication"
RESULTS: "buildUpsertResult / inlineEnvelope serialize AFTER setGoal, so details.state.goal is correct with no results.ts change"
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck    # zero errors
```

### Level 2: Unit Tests

```bash
npx vitest run src/tool.test.ts -v   # all rewritten + new goal cases green
npm test                             # full suite green (incl. S1 setGoal tests)
```

### Level 3: Behavior probe (optional)

```bash
npx tsx -e "
import { resetState } from './src/state.js';
import { executeInterrogate } from './src/tool.js';
resetState();
executeInterrogate({ goal: 'original', questions: [{ id: 'q1', prompt: 'p?', kind: 'choice', options: [{ value: 'a', label: 'A' }] }] }, { mode: 'tui', hasUI: true, model: { contextWindow: 200000 } });
executeInterrogate({ goal: 'UPDATED', questions: [{ id: 'q1', rev: 1, prompt: 'p?', kind: 'choice', options: [{ value: 'a', label: 'A' }] }] }, { mode: 'tui', hasUI: true, model: { contextWindow: 200000 } });
console.log((await import('./src/state.js')).getState().goal); // EXPECT: UPDATED
"
```
(Adapt field names to tool-schema.ts QuestionInput if the probe errors — the test suite is the authoritative gate.)

### Level 4: Regression

- [ ] `npx vitest run src/state.test.ts src/results.test.ts` green (goal read sites unaffected)
- [ ] Read routing unchanged: existing read tests still pass

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green
- [ ] Create path stores capped goal; reuse path updates via setGoal only when goal present
- [ ] Over-budget goal → 400 chars stored + `goal truncated at {n} chars` warning in result
- [ ] Stale guard fires before any goal mutation
- [ ] tool.ts:198–201 stale "goal is FIXED" comment rewritten; tool-schema.ts:107 description updated
- [ ] tool.test.ts:145–154 rewritten (no test asserts the old buggy behavior)
- [ ] No changes to caps.ts, state.ts, results.ts, delivery.ts, panel/*
- [ ] Read routing untouched (goal-only `{}` still a read)

## Anti-Patterns to Avoid

- ❌ Don't truncate the goal in tool.ts — applyCaps/capped.goal is the single truncation authority
- ❌ Don't call setGoal when `goal` is omitted — would wipe the goal to ""
- ❌ Don't move setGoal before assertFresh — stale upserts must not mutate
- ❌ Don't coalesce/suppress the extra `changed` event from setGoal
- ❌ Don't touch the read/record/reopen routes
- ❌ Don't keep any test asserting goal stays fixed — tests are the contract (PRD h2.2/h3.0 governs)

---

**Confidence Score**: 9/10 — exact current code of the upsert case, CapsResult contract, and test conventions verified against the working tree; the change is ~10 lines plus test rewrites; only dependency is S1's setGoal, whose contract is pinned in its PRP.

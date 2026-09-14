# PRP — Bugfix P1.M1.T1.S1: state.ts — mutable goal via setGoal() mutation primitive

## Goal

**Feature Goal**: Make `InterrogationState.goal` mutable through a new `setGoal(goal: string): void` mutation primitive that emits `changed`, so BUG-001 (goal never updatable, FR-30 violation) can be fixed by the tool layer (P1.M1.T1.S2). Serialization shape is unchanged; every existing `state.goal` read site keeps compiling.

**Deliverable**: Modified `src/state.ts` — private goal field + public getter + `setGoal()` — plus new tests in `src/state.test.ts`.

**Success Definition**:
- `npm run typecheck` and the full vitest suite pass (930 existing tests green + new setGoal tests)
- `state.setGoal("X")` updates `state.goal`, `serialize().goal`, and emits `changed` once with the full serialized snapshot
- `rev`/`epoch` are untouched by setGoal (goal is not epoch territory)
- One existing test (`src/tool.test.ts:145–154` asserting goal stays "first goal") may still pass — tool wiring is the NEXT subtask; do not change tool.ts here

## Why

BUG-001 (bugfix PRD h2.2/h3.0): `InterrogationState.goal` is `readonly` with no setter (src/state.ts:219), so any `goal` sent on a later upsert is silently dropped — it never reaches the panel header, read digest, or completion record. This subtask provides the state-layer primitive; P1.M1.T1.S2 wires it into tool.ts (create AND update upserts, with the 400-char cap).

## What

In `src/state.ts`:
1. Replace `readonly goal: string;` (~line 218) with a private field + public `get goal(): string` accessor
2. Add `setGoal(goal: string): void` that assigns and funnels through `emitChanged()` (mutation discipline: only mutation paths emit `changed`)
3. Keep constructor assignment (`this.goal = goal;` line ~242) via the private field
4. Update JSDoc: field/setGoal docs and the class-level "Mutation discipline" comment (~lines 210–214, the list of mutation paths) — goal is no longer "fixed for the lifetime of the state"; add `setGoal` to the mutation-path list
5. Do NOT touch rev/epoch, serialize() shape, or any other module

### Success Criteria

- [ ] `state.goal` public reads compile everywhere unchanged (getter, same type)
- [ ] `setGoal` emits exactly one `changed` event whose payload's `.goal` is the new value
- [ ] `setGoal` with the same string still emits (simple, predictable; callers gate if needed)
- [ ] `serialize()` output shape unchanged: `{goal, epoch, order, questions, completed}`
- [ ] Class-level mutation-discipline JSDoc lists `setGoal`
- [ ] No changes to tool.ts, results.ts, delivery.ts, or any UI module

## All Needed Context

### Context Completeness Check

The repo is fully implemented (930 green tests). This is a surgical state-layer change; every file/line reference below was verified against the working tree. An agent knowing nothing else needs only this PRP plus `src/state.ts` and `src/state.test.ts`.

### Documentation & References

```yaml
- file: src/state.ts
  why: "the only file to modify. Line 218-219: `readonly goal: string;` with JSDoc 'fixed for the lifetime of the state'; constructor at 240-243 (`this.goal = goal;`); mutation-discipline class JSDoc at ~210-214; serialize() at ~412 (`goal: this.goal`)"
  pattern: "all mutations funnel through private emitChanged() — see upsertQuestion (~line 310), removeQuestion (~325), applyAnswer (~340): mutate fields, then `this.emitChanged()`"
  gotcha: "EventEmitter base; `changed` payload is the FULL serialized snapshot (listeners assert changed[0].goal)"

- file: src/state.test.ts
  why: "test conventions: describe block, `q({...})` question factory, `state.on(\"changed\", ...)` capture pattern (lines 59-75)"
  pattern: "test('...', () => { const changed = []; state.on('changed', st => changed.push(st)); ... expect(changed[0].goal)... })"

- file: plan/001_0d9f.../bugfix/001_6d9f684be2bb/architecture/core-modules.md
  why: "§BUG-001 research: exact read-site inventory (state.ts:412 serialize, results.ts:125, fallback.ts:125, delivery.ts:336/395, panel/layout.ts:209) proving a `changed`-emitting mutation propagates everywhere with zero further wiring"
  section: "BUG-001"

- file: src/tool.test.ts (lines 145-154)
  why: "existing test asserting goal is NOT updated ('first goal') — still valid after this subtask because tool.ts is unchanged; S2 will flip it"
  gotcha: "do NOT edit tool.test.ts here"
```

### Current Codebase tree (relevant excerpt)

```bash
src/
├── state.ts          # InterrogationState — MODIFY here
├── state.test.ts     # ADD setGoal tests here
├── tool.ts           # NOT this subtask (S2)
├── caps.ts           # 400-char goal cap lives here; NOT this subtask
└── ... (20+ other modules, untouched)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: emitChanged() emits the full serialize() snapshot on 'changed' —
//   listeners (panel header, renderers, persistence) read st.goal from it.
// GOTCHA: use `private _goal: string` + `get goal(): string`. Do NOT use an
//   accessor pair named `goal` with a setter on the same name — an implicit
//   setter would let callers bypass setGoal and skip the emit.
// GOTCHA: the class-level JSDoc at src/state.ts ~210-214 enumerates the
//   "only mutation paths" (upsertQuestion, applyAnswer, setStatus, bumpRev,
//   bumpEpoch, removeQuestion, clearForCompletion) — setGoal must be added
//   there or the doc becomes false.
// GOTCHA: do NOT bump epoch or rev in setGoal — goal updates are not
//   state-machine transitions (h2.39 rev/epoch semantics untouched).
// GOTCHA: snapshots[] ring is NOT touched by setGoal (snapshots are submission
//   audit trail; past snapshots keep the historical goal).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/state.ts — field + accessor
  - REPLACE line 218-219:
      /** Interrogation goal — fixed for the lifetime of the state. */
      readonly goal: string;
    WITH:
      private _goal: string;
      /** Interrogation goal — agent-supplied, updatable via setGoal (FR-30). */
      get goal(): string { return this._goal; }
  - UPDATE constructor (line ~242): `this._goal = goal;`

Task 2: ADD setGoal() in the mutations section (near upsertQuestion/removeQuestion)
  - /**
     * Updates the interrogation goal (agent re-upserts with a changed goal —
     * FR-30). Not a rev/epoch transition. Emits `changed`.
     */
    setGoal(goal: string): void {
      this._goal = goal;
      this.emitChanged();
    }

Task 3: UPDATE class-level mutation-discipline JSDoc (~lines 210-214)
  - Add `setGoal` to the enumerated mutation-path list; adjust wording so goal
    is no longer described as lifetime-fixed.

Task 4: ADD tests to src/state.test.ts (new describe "setGoal")
  - FOLLOW pattern: existing 'changed'-capture tests (lines 59-75)
  - CASES:
    1. updates state.goal and serialize().goal; emits exactly one 'changed'
       whose payload .goal === new value; epoch and question revs unchanged
    2. setGoal('') works (empty goal is legal — createInterrogationState("")
       and the goal-omitted path in tool.ts already produce "")
    3. constructor goal still readable before any setGoal (regression)

Task 5: RUN npm run typecheck && npm test
  - All 930 existing tests must stay green (tool.test.ts:145-154 still passes
    because tool.ts is untouched)
```

### Implementation Patterns & Key Details

```ts
// Existing mutation pattern to copy (src/state.ts ~325):
removeQuestion(id: string): void {
  this.questions.delete(id);
  ...
  this.emitChanged();
}
// setGoal follows identically: plain field assign, then emitChanged().
// No guard logic here — caps (400-char, BUG-009) and call-sites live in tool.ts (S2).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # zero errors — proves every state.goal read site still compiles
```

### Level 2: Unit Tests

```bash
npm test                          # full suite: 930 existing + new setGoal tests, all green
npx vitest run src/state.test.ts  # focused run while iterating
```

### Level 3: Regression confirmation

```bash
npx vitest run src/tool.test.ts   # unchanged behavior confirmed (goal still "first goal" until S2)
npx vitest run src/results.test.ts src/fallback.test.ts  # goal read sites unaffected
```

### Level 4: Manual (optional, quick)

```bash
pi -e src/index.ts   # extension loads cleanly; behavior identical (nothing calls setGoal yet)
```

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors
- [ ] `npm test` → all green including new setGoal tests
- [ ] serialize() shape unchanged ({goal, epoch, order, questions, completed})
- [ ] Class JSDoc mutation-path list includes setGoal; field doc no longer says lifetime-fixed
- [ ] No changes to tool.ts, tool.test.ts, results.ts, fallback.ts, delivery.ts, panel/*
- [ ] rev/epoch/snapshots untouched by setGoal

## Anti-Patterns to Avoid

- ❌ Don't add an implicit `set goal(...)` — all mutation must funnel through setGoal + emitChanged
- ❌ Don't enforce the 400-char cap here — that's S2's job (caps.ts / applyCaps)
- ❌ Don't bump epoch/rev or snapshot on goal change
- ❌ Don't wire tool.ts yet — this PRP delivers the primitive only
- ❌ Don't "fix" tool.test.ts:145-154 — it belongs to S2

---

**Confidence Score**: 9/10 — surgical, well-localized change; exact lines, patterns, and test conventions verified against the working tree; the only cross-module concern (compile compatibility) is covered by the getter + typecheck gate.

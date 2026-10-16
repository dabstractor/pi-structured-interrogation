# PRP — P1.M5.T1.S1: Array-collect tool results in walkBranch and pool them newest-first

---

## Goal

**Feature Goal**: Fix BUG-008 (h2.3/h3.7): `walkBranch` in `src/reconstruct.ts` keeps only the LAST interrogate tool result carrying `details.state` (singular `toolState`/`toolIndex` slots), so when the newest tool result fails to deserialize and no mirror entry exists, reconstruction collapses to `{source: "none"}` even though a perfectly valid older tool result sits earlier on the branch. Change the walk to array-collect EVERY state-carrying tool result (with branch index) and push them all into the candidate pool alongside the mirror entries — the existing newest-first index sort + tryDeserialize degrade loop then makes the documented "deserialize failures degrade to the next-older candidate" contract (module JSDoc ~41–43) actually hold across tool results, while preserving FR-27 last-wins for the all-valid case.

**Deliverable**:
- `src/reconstruct.ts` — `WalkResult` slot change (`toolState`/`toolIndex` → `toolResults` array), `walkBranch` append logic, pool construction loop, JSDoc updates (walkBranch, WalkResult fields, module step-2 prose).
- `src/reconstruct.test.ts` — four new/updated tests (PRD repro, last-wins preserved, corrupt-tool+newer-mirror competition, all-corrupt fallback).

**Success Definition**: The PRD h3.7 repro passes — branch `[toolResult(valid live state), ...plain turns..., toolResult(hostile getter-throwing details.state)]` with NO custom entries reconstructs to `{source: "tool-result"}` with the OLDER valid state (all questions recovered); the existing ~line-738 last-wins test stays green.

## User Persona

**Target User**: The pi user who restarts / resumes a session whose session file has a damaged newest interrogate tool result (truncated or hand-edited file).
**Use Case**: The 2s-debounced mirror may never have flushed; the tool results are the only state traces on the branch.
**User Journey**: restart → session_start reconstruction → instead of silently losing the whole interrogation (`no state`), the panel reopens from the last VALID tool result.
**Pain Points Addressed**: silent total loss of an interrogation on one corrupt entry, contradicting the documented degrade contract.

## Why

- BUG-008 (h2.3 Issue 7, Minor): the candidate pool's only "older" candidates today are mirrors; earlier valid tool results are never candidates.
- Consumed downstream by P1.M6.T1 (README §Limitations may soften its reconstruction-degradation caveat) — this task does NOT touch README (owned by P1.M6).
- Isolated module change: research re-grepped all consumers of `toolState`/`toolIndex` — the ONLY consumer is the candidate-pool construction inside `reconstructFromBranch` itself; no test or other file references the fields. Safe to replace.

## What

In `src/reconstruct.ts`:

1. `WalkResult` (~282–297): replace the singular `toolState: unknown` + `toolIndex: number` with `toolResults: Array<{ index: number; data: unknown }>` — every state-carrying interrogate tool result in walk order (ascending index). Mirrors/submissions/completions arrays unchanged.
2. `walkBranch` (~326–350): initialize `toolResults: []`; in the tool-result branch, `result.toolResults.push({ index, data: details.state })` instead of overwriting the slots. Remove the `// LAST occurrence wins (FR-27)` comment — last-wins now emerges from index competition in the pool, not from overwrite.
3. Pool construction (~449–453): replace the `if (walk.toolIndex >= 0) candidates.push(...)` with a `for...of` loop pushing EVERY `walk.toolResults` entry with `source: "tool-result"`, before the mirror loop. The mirror loop, `candidates.sort((a, b) => b.index - a.index)` (newest-first, stable), and the tryDeserialize degrade loop need NO structural change — newest-first competition preserves FR-27 last-wins when everything deserializes.
4. Docs ([Mode A]): update walkBranch JSDoc, the WalkResult field docs, and the module JSDoc's step-2 prose (~41–43 and the pool comment ~435–457) to state that every state-carrying tool result is a candidate, competing with mirrors by branch index, newest-first.

`baseIndex` semantics are unchanged (it is the winning candidate's index; used by the submission position filter and the completion-marker scan downstream — untouched).

### Success Criteria

- [ ] Corrupt-newest + no mirror → reconstructs from the older valid tool result (`source: "tool-result"`, questions recovered)
- [ ] Both valid → newest tool result still wins (FR-27 last-wins; existing ~738 test green)
- [ ] Corrupt-newest tool result + newer valid mirror → mirror wins (index competition)
- [ ] All tool results corrupt, no mirrors → `{source: "none"}` path unchanged
- [ ] Full existing test suite green; `toolState`/`toolIndex` have no dangling references

## All Needed Context

### Context Completeness Check

Verified by direct read of `src/reconstruct.ts` (lines ~270–500) and `src/reconstruct.test.ts` (helpers + the two adjacent tests): an agent with only this PRP knows the exact current shapes, the pool algorithm, and the test fixture conventions.

### Documentation & References

```yaml
- file: src/reconstruct.ts
  why: THE file — WalkResult (~282-297, singular tool slots), walkBranch (~326-350, overwrite at ~342-343 "// LAST occurrence wins (FR-27)"), pool construction (~435-470: Candidate interface, single push at ~450-452, mirror loop ~453-457, stable newest-first sort, tryDeserialize degrade loop with "one corrupt entry degrades to the next-older candidate" comment), tryDeserialize (~360-369), module JSDoc (~41-43)
  pattern: mirrors array collection + pool loop is the exact pattern to replicate for tool results
  gotcha: baseIndex feeds the submission position filter and completions find() downstream — leave that logic untouched; all-fail path returns {source:"none"} (~489+) — unchanged

- file: src/reconstruct.test.ts
  why: Test conventions — helpers makeCtx/makeHost/makeOpts/seededState/applyUpsert/choiceQ/diff/toolResultEntry/submissionEntry/completionEntry; the getter-throw hostile fixture (~line 372: toolResultEntry({ get goal() { throw new Error("corrupt payload"); } })); the two-valid-tool-results last-wins test (~line 738, "a NEW interrogation after the completion REPLACES") that MUST stay green
  pattern: build branches as arrays of these entry helpers; assert via result.source + getState()
  gotcha: reconstructFromBranch resets global state itself (resetState()) — no extra reset needed

- file: src/state.ts
  why: read-only reference — deserialize's tolerant shape; first untrusted read at raw.goal (~line 493) is why getter-throw envelopes throw
  pattern: read-only

- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/prd_snapshot.md (h2.3 Issue 7 / BUG-008)
  why: exact repro scenario and the recommendation (h2.5) this implements
  critical: the repro branch is [toolResult(valid), ...plain turns..., toolResult(corrupt)], NO custom entries

- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/P1M4T2S1/PRP.md
  why: parallel in-flight task (overview cursor-row chat targeting: panel/keys.ts, panel.ts accessor, overview.ts)
  gotcha: ZERO overlap with reconstruct.ts — no coordination needed; do not touch panel files
```

### Current Codebase tree (relevant slice)

```bash
src/
  reconstruct.ts        # MODIFY — WalkResult, walkBranch, pool construction, JSDoc
  reconstruct.test.ts   # EXTEND — 4 scenarios; keep ~738 last-wins green
  state.ts              # READ-ONLY — deserialize / raw.goal getter-throw behavior
```

### Desired Codebase tree

```bash
# No new files — surgical modification + tests only.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: SessionEntry tool results are `type: "message"` with
//   msg.role === "toolResult" && msg.toolName === "interrogate" &&
//   details.state non-null — keep the existing guard chain exactly
//   (details undefined / state undefined / state null all skip).
// CRITICAL: candidates.sort((a,b) => b.index - a.index) must remain a STABLE
//   newest-first sort — do not re-sort or dedupe; equal indices can't occur
//   (indices come from branch.forEach position).
// CRITICAL: toolState/toolIndex have exactly ONE consumer (the pool push) —
//   re-grep before deleting; if any new consumer appeared since research,
//   update it to the array rather than deleting blindly.
// CRITICAL: walk order for the array is ascending index (append) — the sort
//   handles ordering; do not pre-sort in walkBranch.
// CRITICAL: reconstruction is untrusted-input code — every field access in
//   walkBranch stays guarded; a malformed entry skips, never throws
//   (session_start must not crash).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/reconstruct.ts — WalkResult + walkBranch
  - REPLACE WalkResult fields toolState/toolIndex with:
      toolResults: Array<{ index: number; data: unknown }>;
    (field doc: every state-carrying interrogate tool result, walk order)
  - IN walkBranch: init toolResults: []; tool-result branch becomes
      result.toolResults.push({ index, data: details.state });
    (delete the overwrite + the "LAST occurrence wins (FR-27)" comment —
    last-wins now emerges from pool index competition)
  - PRESERVE: mirrors/submissions/completions collection, all guards

Task 2: MODIFY src/reconstruct.ts — pool construction
  - REPLACE:
      if (walk.toolIndex >= 0) {
        candidates.push({ index: walk.toolIndex, data: walk.toolState, source: "tool-result" });
      }
    WITH:
      for (const tr of walk.toolResults) {
        candidates.push({ index: tr.index, data: tr.data, source: "tool-result" });
      }
    (placed before the existing mirror for...of loop)
  - NO CHANGE: mirror loop, candidates.sort (newest-first, stable),
    tryDeserialize degrade loop, baseIndex/completion/submission-filter logic

Task 3: UPDATE JSDoc ([Mode A] docs contract)
  - walkBranch JSDoc: "collects every candidate in order" now includes EVERY
    state-carrying tool result
  - WalkResult.toolResults field doc per Task 1
  - Module JSDoc step-2 prose (~41-43) + the pool comment (~435-457): every
    state-carrying tool result is a candidate competing with mirrors by
    branch index, newest-first; a corrupt NEWEST tool result degrades to the
    next-older candidate (tool result or mirror)
  - README §Limitations sync is P1.M6.T1's — do NOT touch README

Task 4: EXTEND src/reconstruct.test.ts — new describe "reconstruction tool-result candidate pool (BUG-008)"
  - TEST (a) PRD repro: branch [toolResultEntry(validState), plain turns
    (any non-interrogate message entries), toolResultEntry(hostileState)] where
    hostileState = { get goal() { throw new Error("corrupt payload"); } } (copy
    the ~372 fixture pattern); NO custom/mirror entries. Assert
    result.source === "tool-result" and getState() has the OLDER valid state's
    questions (e.g. getQuestion("q1") defined with the older state's answers)
  - TEST (b) last-wins preserved: two VALID tool results (older state with q1,
    newer state with n1, e.g. mirroring the ~738 fixture shape) → newest wins
    (source "tool-result", n1 present, q1 absent). If ~738's existing test
    already covers this exactly, keep it green rather than duplicating — add
    an explicit two-valid-tool-results case in the new describe regardless
  - TEST (c) corrupt-newest tool result + NEWER valid mirror entry →
    source "mirror-entry" (index competition: mirror's index > tool's)
  - TEST (d) all tool results corrupt + no mirrors → { source: "none",
    replayed: 0, opened: false }
  - FOLLOW pattern: existing helpers (toolResultEntry, seededState, makeCtx,
    makeHost, makeOpts); NAMING matching file style ("corrupt newest tool
    result degrades to the older valid one", ...)
  - PLACEMENT: new describe block after the existing base-selection describes

Task 5: VERIFY
  - grep -rn "toolState\|toolIndex" src/ → zero hits (fields fully removed)
  - npx tsc --noEmit && npx vitest run
```

### Implementation Patterns & Key Details

```typescript
// WalkResult (after):
//   toolResults: Array<{ index: number; data: unknown }>;
// walkBranch tool-result branch (after guards):
//   result.toolResults.push({ index, data: details.state });
// Pool (after) — the only structural addition:
//   for (const tr of walk.toolResults)
//     candidates.push({ index: tr.index, data: tr.data, source: "tool-result" });
// Everything downstream (sort, tryDeserialize loop, baseIndex) untouched —
// newest-first competition IS the fix AND preserves last-wins.
```

### Integration Points

```yaml
NO new integration points:
  - SessionEntry shapes unchanged (input contract)
  - ReconstructResult shape unchanged (output contract)
  - baseIndex consumers (submission filter, completions find) unchanged
  - README owned by P1.M6.T1; parallel P1.M4.T2.S1 touches only panel files
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npx tsc --noEmit
# Expected: zero errors.
```

### Level 2: Unit Tests

```bash
npx vitest run src/reconstruct.test.ts
npx vitest run            # full suite — zero regressions (incl. ~738 last-wins)
# Expected: all pass, including the four new scenarios.
```

### Level 3: Scenario validation (scripted in tests)

```bash
npx vitest run src/reconstruct.test.ts -t "BUG-008"   # repro (a)–(d)
grep -rn "toolState\|toolIndex" src/ || echo "clean"  # old fields fully gone
```

No live TUI run needed — reconstruction is pure + fixture-driven.

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` full suite green
- [ ] `grep -rn "toolState\|toolIndex" src/` returns nothing
- [ ] Only `src/reconstruct.ts` + `src/reconstruct.test.ts` modified

### Feature Validation

- [ ] Corrupt newest tool result + no mirror → older valid tool result wins, questions recovered
- [ ] All-valid case: newest tool result still wins (FR-27; ~738 test green)
- [ ] Newer valid mirror beats corrupt newest tool result (index competition)
- [ ] All-corrupt → `{source: "none"}` unchanged; no crash on hostile getters
- [ ] Submission replay / completion-marker behavior byte-identical (baseIndex semantics untouched)

### Code Quality Validation

- [ ] Array collection mirrors the existing mirrors-loop pattern exactly
- [ ] All input guards preserved (malformed entries skip, never throw)
- [ ] [Mode A] JSDoc updated (walkBranch, WalkResult, module step-2 prose)
- [ ] README NOT touched (P1.M6.T1 owns it)

## Anti-Patterns to Avoid

- ❌ Don't change the sort, the tryDeserialize loop, or baseIndex consumers — the pool change alone is the fix
- ❌ Don't keep the old singular fields "for compatibility" — they have zero external consumers; delete them
- ❌ Don't pre-sort or dedupe in walkBranch — ascending append + pool sort is the contract
- ❌ Don't relax the walkBranch guards (details/state null checks) — untrusted input skips silently
- ❌ Don't touch README or panel files (owned by P1.M6 / parallel P1.M4.T2.S1)

---

**Confidence Score**: 9/10 — the exact current code (singular slots, pool, sort, degrade loop), the zero-external-consumer fact (re-grepped), and both adjacent test patterns were read directly; the change is a mechanical array-ification plus fixture tests.

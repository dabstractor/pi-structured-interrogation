# PRP — P1.M1.T2.S3: dependsOn evaluator + transitive ripple closure

## Goal

**Feature Goal**: A self-contained `src/depends-on.ts` module exporting two pure-over-state functions: `evaluateDependsOn(state)` — recompute moot-ness of every question with `dependsOn` from current answers, applying `moot` (with reason like `moot: storage=sqlite`) and re-meting moot→open per h2.38 — and `computeRipple(state, changedId)` — the transitive closure of question ids whose dependsOn chain passes through `changedId`, used by the FR-18 ripple confirm to list answered/submitted victims.

**Deliverable**: `src/depends-on.ts` + `src/depends-on.test.ts` passing `npm run typecheck` and `npm test`. No changes to `state.ts` (S1, frozen) or `merge.ts` (S2, parallel). No wiring — consumers arrive later (panel ripple confirm P1.M5.T4.S1, overview P1.M5.T2.S1, reconstruction P1.M7.T1.S2).

**Success Definition**:
- `npm run typecheck` → zero errors; `npm test` → all tests green
- Conditions evaluate locally and instantly, idempotently — calling `evaluateDependsOn` twice changes nothing on the second call
- `computeRipple` returns the correct transitive set for a 3-level chain (test fixture with A ← B ← C ← D) and is cycle-safe
- `grep -n "^import" src/depends-on.ts` shows only `./state.js` type imports (plus `./merge.js` if type-only) — no UI, no config

## Why

FR-17 (instant local dependency greying) and FR-18 (ripple confirm on edits that invalidate answered/submitted questions) are the two most behavior-defining UX contracts of the panel (Q39=B is a defaulted decision the user explicitly specified — do not redesign the UX). Every consumer — panel render, overview moot markers (⊘ + reason, dimmed, Q34=A), the ripple confirm footer, and reconstruction step 5 ("recompute dependsOn moot-ness from current answers (cheap, idempotent)", state-and-persistence.md line 52) — funnels through these two functions. Centralizing the closure here guarantees the confirm, the overview, and post-restart state agree.

## What

- `src/depends-on.ts` exports:
  - `evaluateDependsOn(state: InterrogationState): MootEvaluation` — for each question with a non-empty `dependsOn`, determine met/unmet; unmet → `setStatus(id, "moot")` (reason stored, see below); re-met → `setStatus(id, "open")` (only from `moot`). Returns `{ mootered: Array<{id, reason}>, reopened: string[] }`.
  - `computeRipple(state: InterrogationState, changedId: string): string[]` — transitive set of question ids whose dependsOn chain (any depth) passes through `changedId`. Pure: does not mutate state.
  - `dependencyMet(state, question): { met: boolean; reason?: string }` — exported helper (single-question check; used by tests and reusable by renderers).
  - types `MootEvaluation`, `MootReason`.
- Mode A docs: JSDoc on `computeRipple` with a 3-level transitive example (required by item contract).

### Success Criteria

- [ ] Condition met iff **every** `{id, equals?, notEquals?}` conjunct is satisfied by that dependency's **current** answer
- [ ] `equals`: met iff `dep.answer?.value === cond.equals`; `notEquals`: met iff dependency is answered AND `answer.value !== cond.notEquals`; **unanswered dependency = unmet unless no condition given** (i.e. an entry with neither equals nor notEquals is met iff the dependency has any answer; empty `dependsOn` array = always met)
- [ ] Unmet → `status: "moot"` with reason string in h2.29 format: `` `moot: ${depId}=${answerValue ?? "unanswered"}` `` style — concretely the FIRST failing conjunct produces `moot: storage=sqlite` (id + expected/actual value, see Blueprint)
- [ ] Re-met → back to `open` (h2.38 moot→open edge); only questions currently `moot` are reopened — never touch `withdrawn`/`closed`/`submitted`/`answered`/`reasked` statuses
- [ ] `computeRipple(state, changedId)` returns exactly the ids reachable from `changedId` via **reverse** dependsOn edges (B dependsOn A ⇒ ripple from A includes B, and transitively C where C dependsOn B), excluding `changedId` itself; idempotent, pure, cycle-safe (visited set — cycles must not hang or duplicate)
- [ ] Both functions work on freshly `deserialize`d state (reconstruction step 5) — no reliance on runtime-only bookkeeping
- [ ] Missing dependency id (dependsOn references a question not in the map) = that conjunct unmet, reason `moot: {depId}=missing` — never throws

## All Needed Context

### Context Completeness Check

Greenfield; dependencies are `state.ts` (S1, frozen contract — full public surface in its PRP) and optionally merge.ts types. The complete condition semantics, reason format, transition rules, and ripple closure definition are specified in this PRP. No prior codebase knowledge required.

### Documentation & References

```yaml
- file: plan/001_0d6760db6bc5/P1M1T2S1/PRP.md
  why: THE CONTRACT for InterrogationState — Question.dependsOn type, getQuestion/orderedQuestions,
        setStatus, QuestionStatus values, serialize/deserialize
  critical: do NOT modify state.ts; use setStatus(id, "moot"/"open") which emits 'changed';
    statuses are "open"|"answered"|"submitted"|"reasked"|"moot"|"withdrawn"|"closed"
  gotcha: S1 landed in parallel — treat as read-only; if a primitive is missing, read state via
    serialize()/getQuestion, never extend the class

- file: plan/001_0d6760db6bc5/P1M1T2S2/PRP.md
  why: merge.ts contract — owns upsert/answer status legality; S3 must not conflict
  critical: evaluateDependsOn runs AFTER upserts (tool) and after answer changes (panel);
    only ever transitions moot→open or *→moot for dependsOn-bearing questions. Rule-2 `reasked`
    is merge territory — a `reasked` question with unmet dependsOn still goes moot (moot wins,
    re-derive on re-met would return it to open since moot was the recorded status).

- file: plan/001_0d6760db6bc5/P1M1T2S3/research/notes.md
  why: condensed research — semantics decisions, consumer contracts, cycle handling

- file: spec/state-and-persistence.md
  why: h2.38 state machine (moot ← dependsOn unmet; moot → open on re-met; moot/withdrawn stay
        visible with reason = audit trail Q34=A); line 52 reconstruction step 5 "recompute
        dependsOn moot-ness from current answers (cheap, idempotent)"
  critical: moot is terminal-until-re-met or re-upsert; evaluateDependsOn is the re-met path

- file: spec/ui-spec.md (line 42)
  why: ripple confirm contract — fires when transitive closure "hits answered/submitted questions";
        footer `⚠ Invalidates {n} answered questions ({ids}) — enter=keep, esc=cancel`
  critical: computeRipple returns ALL transitively affected ids; the PANEL filters to
    answered/submitted for the confirm copy. Filtering here would break the contract.

- file: spec/product-requirements.md (FR-17/FR-18, h3.2) — verbatim in task prompt
- file: src/config.test.ts / src/state.test.ts conventions — co-located vitest, ESM `.js` import suffix

- url: https://en.wikipedia.org/wiki/Transitive_closure#In_graph_theoretic_queries
  why: reverse-edge BFS gives the transitive closure from a single source; visited-set BFS is O(V+E)
```

### Current Codebase tree (when implementation starts)

```bash
pi-structured-interrogation/
├── package.json / tsconfig.json / vitest.config.ts
├── src/
│   ├── index.ts          # factory (do not modify)
│   ├── config.ts(+test)  # complete
│   ├── state.ts(+test)   # S1 — DO NOT MODIFY
│   └── merge.ts(+test)   # S2 — landed in parallel, DO NOT MODIFY
└── plan/  spec/
```

### Desired Codebase tree

```bash
src/
├── state.ts / state.test.ts   # unchanged
├── merge.ts / merge.test.ts   # unchanged
├── depends-on.ts              # NEW: evaluateDependsOn, computeRipple, dependencyMet, types
└── depends-on.test.ts         # NEW: vitest unit tests
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: Q39=B is a DEFAULTED decision the user explicitly specified — keep the ripple UX
//   exactly as specified; this module supplies data only, no UX redesign.
// CRITICAL: FR-19 — dependsOn covers INSTANT LOCAL effects only. Do NOT prune questions,
//   do NOT withdraw, do NOT touch agent-side semantic pruning (merge.ts rule 4).
// CRITICAL: computeRipple must NOT mutate state (panel calls it BEFORE applying an edit to
//   decide whether to show the confirm). evaluateDependsOn DOES mutate (via setStatus) —
//   the asymmetry is intentional and documented.
// GOTCHA: import from "./state.js" with `import type` for types (ESM .js suffix convention).
// GOTCHA: setStatus emits 'changed' per call — evaluateDependsOn should only call it when the
//   status actually flips (compare first), or panels will re-render N times per evaluation.
// GOTCHA: dependsOn cycles (agent bug) must not infinite-loop — BFS with a visited Set.
// GOTCHA: unanswered dependency = unmet EVEN IF the conjunct is `notEquals` the answer value
//   (unanswered ≠ "not equal"). Conjunct with no condition = met iff dependency answered.
// GOTCHA: store the reason ON the question? state.ts Question has no mootReason field and
//   CANNOT be edited. Keep the reason OUT of state.ts: expose it via MootEvaluation return
//   value and recompute on demand via dependencyMet() for renderers. Do not monkey-patch fields.
```

## Implementation Blueprint

### Data models and structure

```ts
import type { InterrogationState, Question, DependsOn } from "./state.js";

export interface MootEvaluation {
  mootered: Array<{ id: string; reason: string }>;  // newly or still-unmet (status now "moot")
  reopened: string[];                               // moot → open this pass
}

// Reason format (h2.29 / FR-17 example `moot: storage=sqlite`):
function failReason(cond: DependsOn, dep: Question | undefined, state: InterrogationState): string {
  // dep missing  → `moot: ${cond.id}=missing`
  // unanswered   → `moot: ${cond.id}=unanswered`
  // equals fail  → `moot: ${cond.id}=${dep.answer.value}`   (e.g. storage=sqlite)
  // notEquals fail → `moot: ${cond.id}=${dep.answer.value}`
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/depends-on.ts — dependencyMet + reason builder
  - IMPLEMENT: dependencyMet(state, q): iterate q.dependsOn (skip when undefined/empty → met);
    EVERY conjunct must pass; return { met, reason } with reason from the FIRST failing conjunct
  - SEMANTICS (verbatim from Success Criteria):
    - cond.equals !== undefined: met iff dep exists && dep.answer?.value === cond.equals
    - cond.notEquals !== undefined: met iff dep exists && dep.answer exists && dep.answer.value !== cond.notEquals
    - neither given: met iff dep exists && dep.answer exists
    - multiple keys on one conjunct: ALL must hold (treat as AND within the conjunct too)
  - PLACEMENT: src/depends-on.ts

Task 2: IMPLEMENT evaluateDependsOn(state)
  - FOR each question in state.orderedQuestions() with non-empty dependsOn:
    - met && q.status === "moot" → setStatus(id, "open"); push to reopened
    - !met && q.status !== "moot" && q.status not in {"withdrawn", "closed"} → setStatus(id, "moot"); push {id, reason}
    - !met && q.status === "moot" → include in mootered (reason) but NO setStatus (idempotence — no redundant 'changed' events)
    - withdrawn/closed: skip entirely (terminal until re-upsert; do not un-terminal them)
  - RETURN MootEvaluation
  - IDEMPOTENT: second call with unchanged answers returns same mootered set with zero setStatus calls (test with a 'changed'-listener counter)

Task 3: IMPLEMENT computeRipple(state, changedId) + Mode A JSDoc
  - BUILD reverse adjacency on demand: for each question with dependsOn, for each conjunct id → edge changed-target → dependent
  - BFS from changedId over reverse edges with a visited Set; collect reached ids EXCLUDING changedId
  - PURE: read via getQuestion/orderedQuestions only; never call setStatus/applyAnswer
  - JSDOC (Mode A, REQUIRED): 3-level transitive example —
      Q1 (storage?) ← Q2 dependsOn Q1{equals:"sqlite"} ← Q3 dependsOn Q2{equals:"advanced"} ← Q4 dependsOn Q3
      computeRipple(state, "Q1") → ["Q2", "Q3", "Q4"] — explain that a change to Q1's answer can
      unmeet Q2 directly, and Q3/Q4 transitively through Q2's chain, which is why the FR-18 confirm
      must see the full closure, filtered to answered/submitted for the warning copy.
  - CYCLE-SAFE: A→B→A dependsOn cycles terminate (visited set); document in JSDoc

Task 4: CREATE src/depends-on.test.ts
  - NAMING: test_<behavior>; fresh createInterrogationState per test; helper to seed questions
  - TESTS (minimum):
    1. no dependsOn anywhere: evaluateDependsOn is a no-op, returns empty results, zero 'changed' events
    2. dependency unanswered → mootered with `moot: depId=unanswered`; question status "moot"
    3. equals satisfied → no moot; equals mismatch → `moot: storage=sqlite` (exact string)
    4. notEquals: answered dep matching the excluded value → unmet; answered dep different → met;
       UNANSWERED dep with notEquals → unmet (regression for the gotcha)
    5. conjunct with no condition: met iff dep answered
    6. multiple conjuncts: one fails → unmet, reason from the FIRST failing conjunct
    7. re-met: dep answered to satisfying value → moot → open (reopened); second evaluateDependsOn call: zero 'changed' events (idempotence)
    8. withdrawn/closed questions with unmet dependsOn: skipped, status unchanged
    9. missing dependency id: `moot: ghost=missing`, no throw
    10. computeRipple chain A←B←C←D (matches JSDoc example): ripple(A) = [B,C,D]; ripple(C) = [D]; ripple(D) = []
    11. computeRipple purity: state serialize() before/after identical
    12. cycle A dependsOn B, B dependsOn A: ripple(A) terminates, returns [B] (A excluded); no hang
    13. works on deserialized state: seed → serialize → JSON round-trip → deserialize → evaluateDependsOn produces same statuses
  - PLACEMENT: src/depends-on.test.ts

Task 5: VALIDATE
  - npm run typecheck && npm test
```

### Implementation Patterns & Key Details

```ts
// Reverse-adjacency BFS (Task 3 core):
const dependents = new Map<string, string[]>();
for (const q of state.orderedQuestions())
  for (const cond of q.dependsOn ?? []) {
    if (!dependents.has(cond.id)) dependents.set(cond.id, []);
    dependents.get(cond.id)!.push(q.id);
  }
const seen = new Set([changedId]); const out: string[] = [];
const queue = [changedId];
while (queue.length) {
  for (const next of dependents.get(queue.shift()!) ?? [])
    if (!seen.has(next)) { seen.add(next); out.push(next); queue.push(next); }
}
return out;

// Idempotent status flip (Task 2):
if (!met && q.status !== "moot" && q.status !== "withdrawn" && q.status !== "closed") {
  state.setStatus(q.id, "moot");           // emits 'changed' once
} // else: no event
```

### Integration Points

```yaml
MODULES (contracts only — no file changes outside depends-on.ts / depends-on.test.ts):
  - P1.M5.T4.S1 ripple confirm: calls computeRipple(state, editedId) BEFORE applying the edit;
    filters result to answered/submitted for `⚠ Invalidates {n} answered questions ({ids})`
  - P1.M5.T2.S1 overview: renders ⊘ + reason from dependencyMet()/MootEvaluation; markers per ui-spec.md line 20
  - P1.M7.T1.S2 reconstruction step 5: calls evaluateDependsOn(state) right after deserialize+setState
  - panel submit/answer change: calls evaluateDependsOn after every applied answer change (FR-17 "instant")
NO CHANGES to: src/index.ts, src/state.ts, src/merge.ts, src/config.ts, package.json (zero new deps)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck     # tsc --noEmit → zero errors
```

### Level 2: Unit Tests

```bash
npm test                                    # vitest run → all green
npx vitest run src/depends-on.test.ts -v    # targeted while iterating
```

### Level 3: Integration (behavioral probe)

```bash
# Temporary probe (delete after): moot → re-met → open, plus ripple depth
node --input-type=module -e "
import('./src/depends-on.ts').then(d => import('./src/state.ts').then(s => {
  const st = s.createInterrogationState('probe');
  const q = (id, dependsOn) => ({ id, prompt: id, type: 'choice', rev: 1, status: 'open', dependsOn });
  st.upsertQuestion(q('storage')); st.upsertQuestion(q('fs', [{id:'storage', equals:'sqlite'}]));
  st.upsertQuestion(q('wal', [{id:'fs', notEquals:'none'}]));
  d.evaluateDependsOn(st); console.log('fs moot:', st.getQuestion('fs').status);
  console.log('ripple(storage):', d.computeRipple(st, 'storage'));
  st.applyAnswer('storage', { value:'sqlite', at:new Date().toISOString() });
  d.evaluateDependsOn(st); console.log('fs after:', st.getQuestion('fs').status, 'wal:', st.getQuestion('wal').status);
}));"
# EXPECT: fs moot: moot | ripple(storage): [ 'fs', 'wal' ] | fs after: open wal: open
```

### Level 4: Domain validation

- [ ] JSDoc on computeRipple contains the 3-level transitive example (item contract, Mode A)
- [ ] `grep -n "^import" src/depends-on.ts` shows only `./state.js` (+ `./merge.js` type-only if used)
- [ ] FR-18 consumer copy strings (h2.29 reason format `moot: storage=sqlite`) reproduced in tests

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green (state, merge, depends-on suites)
- [ ] No files outside `src/depends-on.ts` + `src/depends-on.test.ts` created/modified; no new deps

### Feature Validation

- [ ] FR-17: unmet → moot with h2.29-format reason, kept in map, never removed; re-met → open
- [ ] FR-18 data contract: computeRipple returns full transitive closure (unfiltered), pure
- [ ] Idempotent + cheap; works on deserialized state (reconstruction step 5)
- [ ] Unanswered dependency = unmet unless no condition given; missing dep id = `=missing`, no throw
- [ ] withdrawn/closed never un-terminalized; cycles safe

### Code Quality Validation

- [ ] ESM `.js` import suffix; co-located vitest test file; tolerant input handling
- [ ] No UI imports, no config reads — data layer only

## Anti-Patterns to Avoid

- ❌ Don't filter computeRipple to answered/submitted — the panel does that for the confirm copy
- ❌ Don't mutate state inside computeRipple (it runs pre-confirm to decide whether to confirm)
- ❌ Don't touch state.ts or merge.ts — both are parallel/frozen contracts
- ❌ Don't emit redundant 'changed' events on no-op evaluations (compare before setStatus)
- ❌ Don't treat unanswered as satisfying notEquals; don't throw on missing dependency ids
- ❌ Don't prune/withdraw moot questions — FR-19: dependsOn is instant-local only; audit trail is contractual (Q34=A)
- ❌ Don't redesign the ripple UX — Q39=B is user-specified and vetoed-from-change

---

**Confidence Score**: 9/10 — the upstream state.ts contract is fully specified in the S1 PRP (frozen, imports-only), the condition/ripple semantics are pinned verbatim by FR-17/FR-18 + h2.38 + ui-spec line 42, and all three downstream consumers' needs are documented with exact call sites. Only residual uncertainty: reason-string exact wording beyond the `moot: storage=sqlite` exemplar (spec gives the format, tests pin the chosen rendering).

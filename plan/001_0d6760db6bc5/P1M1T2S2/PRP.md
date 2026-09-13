# PRP — P1.M1.T2.S2: Merge rules 1-4 + status transitions

## Goal

**Feature Goal**: Implement `applyUpsert(incoming: Question[], state)` executing the four merge rules from PRD h2.21 by id (silent text update / changed-options re-ask / append new / omit-to-withdraw), plus the user-answer and lifecycle transition methods `markAnswered`, `markSubmitted`, `closeSubmitted` — all built strictly on the raw primitives exposed by `InterrogationState` (P1.M1.T2.S1) without editing `state.ts`.

**Deliverable**: `src/merge.ts` + `src/merge.test.ts` passing `npm run typecheck` and `npm test`. `state.ts` is NOT modified (it is landing in parallel and is treated as a frozen contract).

**Success Definition**:
- `npm run typecheck` → zero errors; `npm test` → all merge + state tests green
- All 4 merge rules behave exactly per h2.21; panel drafts never referenced/touched (they live panel-side)
- `applyUpsert` returns a structured result exposing rev-bumped ids and transitions (the `questionRevBumped` seam) so panel/tool consumers can react without new event types in state.ts
- Editing a closed answer re-marks it `answered` (FR-2, Q24=B); withdrawn/closed reopen via re-upsert with rev+1 (h2.38)

## Why

Merge rules are the contract the model relies on for re-asks (the item's research note): every `interrogate` upsert (tool.ts, P1.M1.T3.S1), the auto-close engine (P1.M2.T2.S1), the panel submit flush, and reconstruction replay (P1.M7.T1.S2) funnel through these transitions. Withdrawal keeps the question in the map for audit (Q34=A). Getting rule 2's draft preservation and rule 4's audit semantics right here prevents silent state corruption across the whole milestone tree.

## What

- `src/merge.ts` exports:
  - `applyUpsert(state: InterrogationState, incoming: Question[]): UpsertResult`
  - `markAnswered(state: InterrogationState, id: string, answer: QuestionAnswer): void`
  - `markSubmitted(state: InterrogationState, ids: string[]): void`
  - `closeSubmitted(state: InterrogationState, ids: string[]): void`
  - types `UpsertResult`, `UpsertTransition`, `WithdrawalInfo`
- Mode A JSDoc on `applyUpsert` enumerating the 4 rules **verbatim from h2.21**.

### Success Criteria

- [ ] Rule 1: same option values → text/description/ramification update silently, answer kept, `rev+1`
- [ ] Rule 2: changed options → answer reset, status `reasked`, `rev+1`; no draft state touched anywhere in the module (no draft fields exist here — by design)
- [ ] Rule 3: new id → appended (end of `order[]`), status `open`, `rev 1`
- [ ] Rule 4: existing id omitted from an upsert batch → status `withdrawn`, kept in map (never removed)
- [ ] Re-upsert of a withdrawn or closed id with rev+1 reopens per h2.38 (see Blueprint decision table)
- [ ] `markAnswered` on closed/submitted/open → status `answered`; never bumps rev; throws on unknown id
- [ ] `markSubmitted(ids)` → `submitted`; `closeSubmitted(ids)` → `closed`; unknown ids throw
- [ ] `applyUpsert` throws on duplicate ids inside a single incoming batch
- [ ] `grep -n "^import" src/merge.ts` shows only `./state.js` (type imports) — no UI, no config

## All Needed Context

### Context Completeness Check

Greenfield; the only dependency is `state.ts`, whose complete public surface is specified in the S1 PRP (treated as contract — reproduced under References). This PRP contains the merge decision tables, transition matrices, and option-comparison rules; no prior codebase knowledge required.

### Documentation & References

```yaml
- file: plan/001_0d6760db6bc5/P1M1T2S1/PRP.md
  why: THE CONTRACT for InterrogationState — raw primitives to build on
  critical: use upsertQuestion/applyAnswer/setStatus/bumpRev ONLY; do NOT edit state.ts;
    typed events are 'changed' | 'questions-upserted' | 'epoch-bumped' | 'completed-cleared'
  gotcha: S1 is implemented IN PARALLEL — never modify, only import. If a needed primitive is
    missing, work around it via the exported methods, don't extend the class.

- file: plan/001_0d6760db6bc5/P1M1T2S2/research/notes.md
  why: condensed research — parallel-conflict resolution (separate merge.ts file), event seam
    decision, reopen semantics, option comparison rule
  critical: read before designing the UpsertResult shape

- file: spec/state-and-persistence.md
  why: AUTHORITATIVE — §Question state machine (copy diagram lines into JSDoc context),
    §rev and epoch semantics ("rev bumps on any content mutation incl. withdrawal-re-add;
    user answers do NOT bump rev"), §Auto-close algorithm (consumer of closeSubmitted)
  critical: rev+1 on rules 1, 2 AND on reopen-re-upsert; answers never bump rev

- PRD h2.21 (merge rules, verbatim below), h2.38 (state machine), h2.8 FR-2/FR-21,
  spec/tool-protocol.md §Merge rules (same as h2.21)

- file: src/config.ts + src/config.test.ts
  why: repo conventions — ESM imports with .js suffix ("./state.js"), vitest co-located tests,
    tolerant input guards
```

**h2.21 verbatim (JSDoc source for applyUpsert)**:
1. Existing id, same option values → text/description/ramification updates apply silently; existing answer and rev-bump; drafts untouched.
2. Existing id, changed options → answer reset, status `reasked` (⟳ marker), rev-bump; panel draft *preserved* (surfaces when the user revisits).
3. New id → appended, status `open`, rev 1.
4. Existing id omitted → withdrawn (⊗ marker, kept in map with reason "withdrawn").

### Current Codebase tree (when implementation starts)

```bash
pi-structured-interrogation/
├── package.json / tsconfig.json / vitest.config.ts
├── src/
│   ├── index.ts        # factory (do not modify)
│   ├── config.ts       # + config.test.ts (complete)
│   ├── state.ts        # + state.test.ts (landed per S1 PRP — DO NOT MODIFY)
└── plan/  spec/
```

### Desired Codebase tree

```bash
src/
├── state.ts / state.test.ts   # unchanged
├── merge.ts                   # NEW: applyUpsert + markAnswered/markSubmitted/closeSubmitted + result types
└── merge.test.ts              # NEW: vitest unit tests
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: state.ts is landing IN PARALLEL — importing it is fine, editing it is FORBIDDEN.
//   Consequence: the item's "expose questionRevBumped event" cannot be a new typed event on the
//   class. Instead applyUpsert RETURNS rev-bumped ids + transitions in UpsertResult AND the raw
//   'questions-upserted' event fires via upsertQuestion; tool.ts/panel poll the result. Document
//   this seam in the JSDoc so P1.M1.T3.S1 and panel know where to subscribe.
// CRITICAL: options comparison is by VALUE LIST: map options → option.value, compare as ordered
//   arrays. Label/ramification changes are text updates (rule 1). Missing options (text-type
//   questions) → both sides undefined/empty counts as "same options".
// GOTCHA: import from "./state.js" (ESM + .js suffix per config.ts convention), types with
//   `import type`.
// GOTCHA: upsertQuestion on a NEW id forces rev 1 / status open and appends to order[] — rule 3
//   is one call. On EXISTING id it REPLACES the entry but keeps order position — callers must
//   compute the merged Question themselves (status/rev/answer per rules) before calling it.
// GOTCHA: rule 2 "answer reset" means delete question.answer; answer stays undefined until the
//   user re-answers. Do NOT synthesize an empty answer object.
// GOTCHA: rule 4 needs the CURRENT map ids not present in the batch — but only ids that were
//   in a "live" state. Also withdrawing an already-withdrawn id is a no-op (no rev bump).
// GOTCHA: never bump rev via applyAnswer/markAnswered — h2.39. Only content mutations bump rev.
// GOTCHA: Question objects stored in state are internal — build fresh objects with
//   structuredClone(...) spread before upsertQuestion; never mutate getQuestion() results.
```

## Implementation Blueprint

### Data models and structure

```ts
import type { InterrogationState, Question, QuestionAnswer } from "./state.js";

export interface UpsertTransition {
  id: string;
  rule: 1 | 2 | 3 | 4 | "reopen-same" | "reopen-changed";
  from: Question["status"] | "absent";
  to: Question["status"];
  revBumped: boolean;
  answerReset: boolean;
}

export interface WithdrawalInfo { id: string; reason: "withdrawn"; }

export interface UpsertResult {
  transitions: UpsertTransition[];   // one per incoming id, in batch order
  revBumped: string[];               // the questionRevBumped seam — ids whose rev increased
  withdrawn: WithdrawalInfo[];       // rule 4 — omitted ids
  appended: string[];                // rule 3 — new ids (for panel focus/grouping)
}
```

### Merge decision table (authoritative)

| existing status | option values | resulting status | answer | rev |
|---|---|---|---|---|
| open/answered/submitted/reasked | same | unchanged status | kept | +1 |
| open/answered/submitted/reasked | changed | `reasked` | reset (deleted) | +1 |
| absent (new id) | — | `open` | none | 1 |
| withdrawn | same | `answered` if answer kept else `open` | kept | +1 |
| withdrawn | changed | `reasked` | reset | +1 |
| closed | same | `answered` (edit-again path, FR-2 spirit) | kept | +1 |
| closed | changed | `reasked` | reset | +1 |
| any | id omitted from batch | `withdrawn` (no-op if already withdrawn) | kept for audit | unchanged |

Rule 1 "silent text update": incoming `prompt`/`description`/`title`/`ramification`/`recommendation` overwrite; `group`/`gate`/`dependsOn` also update (content mutation, same bucket per h2.39). For ALL incoming ids, the stored Question is rebuilt from the incoming content + the decided status/rev/answer — do not field-patch the stored object.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/merge.ts — types + option comparison helper
  - IMPLEMENT: UpsertTransition / WithdrawalInfo / UpsertResult (above), exactly these shapes
  - IMPLEMENT: private sameOptions(a?: QuestionOption[], b?: QuestionOption[]): boolean —
    ordered comparison of .value arrays; undefined/empty/[] treated as equivalent
  - NAMING: PascalCase types, camelCase functions; PLACEMENT: src/merge.ts
  - IMPORTS: `import type {...} from "./state.js"` and `import { ... } from "./state.js"` — NOTHING else

Task 2: IMPLEMENT applyUpsert(state, incoming): UpsertResult
  - MODE A DOCS: JSDoc enumerating the 4 h2.21 rules VERBATIM (quoted block above) + the
    questionRevBumped seam note ("revBumped[] in the result is the event surface; the raw
    'questions-upserted' EventEmitter event also fires via upsertQuestion — panel and tool.ts
    subscribe there and read this result for per-rule detail")
  - PRECONDITION: throw Error("duplicate question id in upsert batch: <id>") on repeated ids in incoming
  - PASS 1 (per incoming question, batch order):
    absent id → rule 3: build { ...clone(incoming), rev: 1, status: "open", answer: undefined },
      state.upsertQuestion(q) → transition { rule: 3, from: "absent", to: "open", revBumped: false }
    existing id → consult decision table:
      same options → keep existing answer + existing status unless withdrawn/closed (→ answered-or-open),
        merge text fields from incoming, rev = existing.rev + 1
      changed options → answer deleted, status "reasked", rev = existing.rev + 1
      call state.upsertQuestion(merged) (keeps order position)
  - PASS 2 (withdrawals): for each stored id NOT in the batch, with status NOT already "withdrawn"
    AND status ∈ { open, answered, submitted, reasked } (moot/closed/withdrawn are NOT re-withdrawable):
    state.setStatus(id, "withdrawn") — stays in map, answer kept for audit, NO rev bump;
    record in withdrawn[]. If status is "moot" or "closed": leave untouched (moot is S3's domain;
    closed is archived — omission means the agent let it rest).
  - RETURN the assembled UpsertResult
  - GOTCHA: build merged Question objects via structuredClone of incoming + explicit
    rev/status/answer fields; never mutate objects returned by state.getQuestion()

Task 3: IMPLEMENT transition methods
  - markAnswered(state, id, answer): void
      unknown id → throw Error(`unknown question id: ${id}`)
      sets answer + status "answered" via state.applyAnswer(id, answer) (which enforces no-rev-bump);
      if previous status was "closed" this IS the FR-2/Q24=B reopen path — same call, no special case
  - markSubmitted(state, ids): void — for each id: throw on unknown; state.setStatus(id, "submitted").
      Called by the ctrl+s submit flush with all pending (answered) ids.
  - closeSubmitted(state, ids): void — for each id: throw on unknown; state.setStatus(id, "closed").
      Called by auto-close (P1.M2.T2.S1) after agent_settled for submitted-at-epoch ids not re-asked.
  - JSDoc on each: legal-prior statuses (markAnswered: any non-withdrawn; markSubmitted: answered
    or reasked-then-answered; closeSubmitted: submitted) — v1 does NOT hard-enforce priors beyond
    the unknown-id throw (ripple confirm lives panel-side, FR-18); document this explicitly.

Task 4: CREATE src/merge.test.ts (vitest, co-located)
  - SETUP helper: newState(...qs) = createInterrogationState("test") + upsertQuestion seeds
    (import from ./state.js — assumes S1 landed; if S1 lands after, coordinate via plan status)
  - NAMING: test_<behavior>; fresh state per test
  - TESTS (minimum):
    1. rule 1 same options: prompt/description/label/ramification updates; answer kept; status kept; rev 1→2
    2. rule 1 label-only change (same .value list) counts as rule 1 (NOT a reset)
    3. rule 2 changed options: answer deleted (undefined), status "reasked", rev+1; result.answerReset true
    4. rule 2 reordered values counts as changed (ordered comparison)
    5. rule 3 new id: appended at end of order, status open, rev 1, result.appended contains it
    6. rule 4 omission: status withdrawn, still in map, answer preserved, rev unchanged; withdrawn[] lists it
    7. rule 4 no-op cases: already-withdrawn id omitted → no double transition; moot/closed ids omitted → untouched
    8. reopen withdrawn same-options: status answered (answer kept), rev+1
    9. reopen closed changed-options: status reasked, answer reset, rev+1
    10. duplicate ids in batch → throws
    11. markAnswered: status answered, rev UNCHANGED (h2.39 regression); on closed question → answered (FR-2); unknown id throws
    12. markSubmitted / closeSubmitted: transitions applied; unknown id throws
    13. text-type questions (no options): prompt edit = rule 1, rev+1, answer kept
    14. UpsertResult completeness: transitions length === incoming length; revBumped ⊆ incoming ids
    15. import-purity: read src/merge.ts source, assert every import line matches /^import (type )?\{.*\} from "\.\/state\.js"/
  - PLACEMENT: src/merge.test.ts

Task 5: VALIDATE
  - npm run typecheck && npm test
```

### Implementation Patterns & Key Details

```ts
// Option comparison — VALUES, ordered, absent ≡ empty:
function sameOptions(a?: QuestionOption[], b?: QuestionOption[]): boolean {
  const va = (a ?? []).map(o => o.value);
  const vb = (b ?? []).map(o => o.value);
  return va.length === vb.length && va.every((v, i) => v === vb[i]);
}

// Merged-question construction (rule 1/2/reopen) — never mutate stored objects:
const existing = state.getQuestion(id)!;
const merged: Question = {
  ...structuredClone(incomingQ),
  rev: existing.rev + 1,                 // every content mutation bumps rev (h2.39)
  status: sameOptions ? keepOrReopen(existing.status) : "reasked",
  answer: sameOptions ? existing.answer : undefined,  // rule 2 = DELETE, not empty object
};
state.upsertQuestion(merged);            // keeps order position for existing ids

// keepOrReopen(status): "withdrawn"|"closed" → (existing.answer ? "answered" : "open"); else status
```

### Integration Points

```yaml
MODULES (contracts only — no file changes outside merge.ts/merge.test.ts):
  - P1.M1.T3.S1 tool.ts: applyUpsert is the core of the upsert action; result feeds the tool result details
  - P1.M1.T2.S3 dependsOn: runs AFTER applyUpsert in tool.ts to recompute moot-ness; merge.ts never touches moot
  - P1.M2.T2.S1 auto-close: closeSubmitted(ids) on agent_settled; "reasked this run" detected by comparing
    against a rule-2 transition (needs the UpsertResult — tool.ts should stash it per run)
  - panel submit flush: markAnswered on edit, markSubmitted on ctrl+s
  - P1.M7.T1.S2 reconstruction: replay = applyUpsert on stored state (idempotent because rules are rev-relative)
NO CHANGES to: state.ts, index.ts, config.ts, package.json (zero new dependencies)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck     # tsc --noEmit → zero errors (merge.ts + merge.test.ts)
```

### Level 2: Unit Tests

```bash
npx vitest run src/merge.test.ts -v   # targeted while iterating
npm test                              # full suite green (config + state + merge)
```

### Level 3: Integration (behavioral probe)

```bash
# Temporary probe (delete after): full rule walkthrough against live state
node --input-type=module -e "
Promise.all([import('./src/state.ts'), import('./src/merge.ts')]).then(([s, m]) => {
  const st = s.createInterrogationState('Probe');
  const r1 = m.applyUpsert(st, [{ id: 'db', prompt: 'DB?', type: 'choice', rev: 1, status: 'open',
    options: [{ value: 'pg', label: 'Postgres' }, { value: 'sqlite', label: 'SQLite' }] }]);
  console.log('rule3:', JSON.stringify(r1.appended));
  m.markAnswered(st, 'db', { value: 'pg', at: new Date().toISOString() });
  const r2 = m.applyUpsert(st, [{ id: 'db', prompt: 'DB (revised)?', type: 'choice', rev: 2, status: 'answered',
    options: [{ value: 'pg', label: 'PostgreSQL' }, { value: 'sqlite', label: 'SQLite' }] }]);
  console.log('rule1 kept answer:', st.getQuestion('db').answer?.value, 'rev:', st.getQuestion('db').rev);
  const r3 = m.applyUpsert(st, [{ id: 'db', prompt: 'DB?', type: 'choice', rev: 3, status: 'reasked',
    options: [{ value: 'mysql', label: 'MySQL' }] }]);
  console.log('rule2 reset:', st.getQuestion('db').answer, 'status:', st.getQuestion('db').status);
  const r4 = m.applyUpsert(st, []);
  console.log('rule4 withdrawn:', JSON.stringify(r4.withdrawn), 'in map:', !!st.getQuestion('db'));
});"
# EXPECT: appended ['db']; 'pg' + rev 3; undefined + reasked; withdrawn with db, in map true
```

### Level 4: Domain validation

- [ ] JSDoc on applyUpsert quotes all four h2.21 rules verbatim
- [ ] `grep -n "^import" src/merge.ts` → only ./state.js
- [ ] `git diff --name-only` shows only src/merge.ts and src/merge.test.ts added

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` → 0 errors
- [ ] `npm test` → all green (state, config, merge)
- [ ] No formatting/lint regressions (repo has no linter configured — typecheck is the gate)

### Feature Validation

- [ ] All 4 merge rules + reopen paths pass their tests (decision table covered row by row)
- [ ] Withdrawn questions retained in map with answer (audit trail, Q34=A)
- [ ] Answers never bump rev in any path (h2.39 regression tests present)
- [ ] markAnswered on closed → answered (FR-2/Q24=B) tested
- [ ] UpsertResult exposes revBumped[] + transitions for downstream consumers

### Code Quality Validation

- [ ] state.ts untouched (parallel work preserved)
- [ ] No mutation of objects returned by getQuestion()/serialize()
- [ ] ESM .js-suffix imports match repo convention
- [ ] Zero new dependencies

## Anti-Patterns to Avoid

- ❌ Don't edit state.ts to add a questionRevBumped event — it's landing in parallel; the result object IS the seam
- ❌ Don't compare options by label or deep-equality — VALUE LIST only (labels are text, rule 1)
- ❌ Don't set answer to `{value:""}` on rule 2 — delete it
- ❌ Don't bump rev on rule 4 (withdrawal) or on any answer path — h2.39
- ❌ Don't withdraw moot/closed/withdrawn ids on omission — only live statuses
- ❌ Don't hard-enforce transition priors beyond unknown-id throws — ripple confirm is panel-side (FR-18)
- ❌ Don't touch drafts anywhere — drafts live panel-side (R4, FR-21); merge.ts must have no draft concept

---

**Confidence Score**: 8/10 — merge rules are contractual (h2.21 verbatim), the S1 primitive surface is fully specified in its PRP, and the decision table resolves every status×options combination. Residual risk: the S1 primitive `upsertQuestion`'s exact behavior for existing ids (replace-but-keep-position, caller computes merged fields) must land as specified — mitigated by the explicit JSDoc "raw primitive" contract in S1's PRP and the workarounds documented above.

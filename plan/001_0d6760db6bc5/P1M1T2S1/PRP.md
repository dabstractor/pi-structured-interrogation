# PRP — P1.M1.T2.S1: InterrogationState core: types, map/order, rev/epoch, change events

## Goal

**Feature Goal**: A self-contained `src/state.ts` module exporting the authoritative types (`QuestionStatus`, `Question`, `Snapshot`, `SerializedState`) and the `InterrogationState` class with `createInterrogationState()`, a singleton accessor, rev/epoch primitives, upsert entry points (applied by S2), query helpers (`getQuestion`, `orderedQuestions`, `groupSummaries`), `serialize()` / `static deserialize()`, and change events via `node:events` EventEmitter — with zero UI imports and zero new dependencies.

**Deliverable**: `src/state.ts` + `src/state.test.ts` passing `npm run typecheck` and `npm test`. No wiring into index.ts (tool.ts consumes it in P1.M1.T3, persistence in P1.M7.T1).

**Success Definition**:
- `npm run typecheck` → zero errors
- `npm test` → all state tests pass (types, rev/epoch, events, serialize/deserialize round-trip, order/group helpers)
- `state.ts` contains no imports besides `node:events` — provably never touches UI (h2.13)

## Why

`state.ts` is the single in-memory source of truth for the entire extension (PRD h2.13, storage layer 1 of 3 in spec/state-and-persistence.md). Everything downstream — merge rules (S2), dependsOn evaluator (S3), snapshot ring (S4), the `interrogate` tool's `details` snapshot (P1.M1.T3.S4), delivery, lifecycle, panel rendering, and persistence/reconstruction (P1.M7.T1) — builds on the types and primitives defined here. Getting the data shapes and event surface exactly right now prevents rework across the whole milestone tree.

## What

- `src/state.ts` exports (per h2.17 + item contract):
  - `type QuestionStatus = "open" | "answered" | "submitted" | "reasked" | "moot" | "withdrawn" | "closed"`
  - `interface QuestionOption { value: string; label: string; ramification?: string }`
  - `interface QuestionAnswer { value: string; text?: string; at: string }` (`at` = ISO timestamp)
  - `interface Question { id: string; title?: string; prompt: string; description?: string; type: "choice" | "text"; options?: QuestionOption[]; recommendation?: string; group?: string; gate?: boolean; dependsOn?: { id: string; equals?: string; notEquals?: string }[]; rev: number; status: QuestionStatus; answer?: QuestionAnswer }`
  - `interface Snapshot { epoch: number; at: string; state: SerializedState }`
  - `interface SerializedState { goal: string; epoch: number; order: string[]; questions: Record<string, Question> }` (plain JSON, details-compatible)
  - `class InterrogationState` (see Blueprint) extending `EventEmitter`
  - `createInterrogationState(goal: string): InterrogationState`
  - `getState(): InterrogationState | undefined` and `resetState(): void` — singleton accessor pair
- Mode A docs: full JSDoc on `InterrogationState` reproducing the h2.38 status machine diagram (ASCII art in a JSDoc comment).

### Success Criteria

- [ ] All h2.17 types exported exactly (field names/optionalities verbatim)
- [ ] `epoch` starts at 1; `bumpEpoch()` increments and emits `'epoch-bumped'`
- [ ] `rev` starts at 1 per question; `bumpRev(id)` increments and emits `'changed'`; no answer-writing primitive in this subtask ever bumps rev (h2.39)
- [ ] Events `'changed'`, `'questions-upserted'`, `'epoch-bumped'`, `'completed-cleared'` emitted with documented payloads
- [ ] `serialize()` → plain JSON round-trips through `deserialize()` losslessly
- [ ] `orderedQuestions()` returns questions in `order[]` order; `groupSummaries()` returns per-group aggregates
- [ ] Typecheck + tests green; zero imports beyond `node:events` in state.ts

## All Needed Context

### Context Completeness Check

Greenfield repo. Scaffold (package.json, tsconfig, vitest) arrives from P1.M1.T1.S1 exactly as its PRP specifies; `src/config.ts` arrives in parallel from P1.M1.T1.S2 — **state.ts does NOT depend on config.ts** (caps enforcement lives in tool.ts, P1.M1.T3.S3). This PRP contains the complete type definitions, class surface, event payloads, and state machine diagram; no prior codebase knowledge required.

### Documentation & References

```yaml
- file: spec/state-and-persistence.md
  why: AUTHORITATIVE for the question state machine diagram (§Question state machine), rev/epoch semantics (§rev and epoch semantics), storage layering (§Storage: state.ts is in-memory layer 1, mutations emit change events)
  critical: copy the status machine ASCII diagram into the InterrogationState JSDoc VERBATIM (Mode A docs)

- file: plan/001_0d6760db6bc5/P1M1T2S1/research/notes.md
  why: condensed research — downstream consumer contracts (S2/S4/T3.S4/P1.M7.T1), design decisions (EventEmitter, serialize shape, tolerant deserialize)
  critical: read before inventing the event payload shapes

- file: plan/001_0d6760db6bc5/architecture/system-context.md (line 24)
  why: module placement + confirms EventEmitter choice: "state.ts # InterrogationState: Map<id,Question>, order[], epoch, revs, snapshots, dependsOn evaluator, EventEmitter"
  gotcha: dependsOn evaluator is S3 — this subtask defines the dependsOn TYPE only, no evaluation logic

- file: plan/001_0d6760db6bc5/P1M1T1S2/PRP.md (§Patterns, tolerant-read guards)
  why: object-guard narrowing pattern to reuse in deserialize() — never cast unknown JSON without typeof/Array guards
  pattern: `typeof v === "object" && v !== null && !Array.isArray(v)` before narrowing

- url: https://nodejs.org/api/events.html#class-eventemitter
  why: node:events EventEmitter — zero-dependency pub/sub; on/emit/off semantics
  gotcha: Node 22 has `EventEmitter` as named export of "node:events"; max-listeners warning at 11+ listeners is fine for our consumer count

- PRD h2.17, h2.38, h2.39, h2.13 (reproduced in full in the task prompt / prd_snapshot.md)
```

### Current Codebase tree (after P1.M1.T1.S1 + S2 land)

```bash
pi-structured-interrogation/
├── package.json / tsconfig.json / vitest.config.ts
├── src/
│   ├── index.ts        # factory + interrogate-ping stub (do not modify)
│   └── config.ts       # + config.test.ts (parallel subtask — do not touch)
└── plan/  spec/  .pi/  .envrc  .gitignore
```

### Desired Codebase tree

```bash
src/
├── index.ts            # unchanged
├── config.ts           # unchanged (parallel work)
├── state.ts            # NEW: types, InterrogationState, createInterrogationState, singleton accessor
└── state.test.ts       # NEW: vitest unit tests (co-located, mirrors config.test.ts placement)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: state.ts must NEVER touch UI — no imports from pi packages, no ctx, no panel refs (h2.13).
//   Allowed imports: "node:events" ONLY (plus types defined in this file). Enforce by review.
// CRITICAL: never cache state across session_shutdown (h2.43) — the singleton accessor must be
//   resettable (resetState()) and JSDoc must document that lifecycle/persistence owns reset timing.
// CRITICAL: user answers do NOT bump rev (h2.39) — answer mutations are epoch territory. S1 defines
//   bumpRev(id) as a separate primitive; only S2's merge rules call it on CONTENT mutations.
// GOTCHA: `questions: Map<string, Question>` is the runtime shape; serialize() must convert to a
//   plain Record<string, Question> keyed by id, with `order: string[]` preserving sequence —
//   JSON.stringify(Map) yields {} silently; never store the Map in snapshots/details directly.
// GOTCHA: internal mutation must not leak references — getQuestion() returns the stored object;
//   external code must not mutate it. Either deep-freeze on read or (chosen) document + provide
//   upsert/applyAnswer as the only mutation paths; snapshots must deep-copy (structuredClone).
// GOTCHA: tsconfig is strict — Map iteration (entries()/values()) needs no lib changes under
//   target es2022; structuredClone is global in Node 17+, no import needed.
// GOTCHA: EventEmitter is untyped by default — provide typed listener signatures via a
//   `StateEvents` interface + declaration merge (see Blueprint) so consumers get autocomplete.
// GOTCHA: deserialize() input comes from persisted custom entries (P1.M7.T1) — treat as untrusted:
//   object guards before narrowing; missing/invalid fields fall back to defaults (status "open",
//   rev 1, epoch 1); never throw on malformed input (config.ts tolerance precedent).
```

## Implementation Blueprint

### Data models and structure

```ts
import { EventEmitter } from "node:events";

export type QuestionStatus =
  | "open" | "answered" | "submitted" | "reasked" | "moot" | "withdrawn" | "closed";

export interface QuestionOption { value: string; label: string; ramification?: string; }
export interface QuestionAnswer { value: string; text?: string; at: string; } // at = ISO 8601
export interface DependsOn { id: string; equals?: string; notEquals?: string; }

export interface Question {
  id: string;
  title?: string;
  prompt: string;
  description?: string;
  type: "choice" | "text";
  options?: QuestionOption[];
  recommendation?: string;
  group?: string;
  gate?: boolean;
  dependsOn?: DependsOn[];
  rev: number;            // starts 1, content mutations only (h2.39)
  status: QuestionStatus;
  answer?: QuestionAnswer;
}

export interface SerializedState {
  goal: string;
  epoch: number;
  order: string[];
  questions: Record<string, Question>;
}

export interface Snapshot { epoch: number; at: string; state: SerializedState; }
// Ring-of-10 push logic lands in P1.M1.T2.S4; S1 owns the type + the array field.

export interface StateEvents {
  changed: [state: SerializedState];              // any mutation — full snapshot payload
  "questions-upserted": [ids: string[]];          // agent upserts (S2 fills transitions)
  "epoch-bumped": [epoch: number];                // submission
  "completed-cleared": [];                        // completion clears state
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/state.ts — types + JSDoc state machine
  - IMPLEMENT: all types above (field names/optionalities VERBATIM from h2.17 + item contract)
  - MODE A DOCS: JSDoc on InterrogationState containing the h2.38 status machine ASCII diagram
    verbatim (copy from spec/state-and-persistence.md §Question state machine) plus a bullet list:
    moot/withdrawn terminal-until-re-upsert, closed answer edit → answered(pending), answers apply
    via ripple confirm before entering answered(pending)
  - NAMING: exported PascalCase types/classes; PLACEMENT: src/state.ts

Task 2: IMPLEMENT InterrogationState class core
  - constructor(goal: string): { goal, epoch = 1, questions = new Map(), order = [], snapshots = [] }
  - extends EventEmitter with typed StateEvents via declaration merging:
      export interface InterrogationState extends EventEmitter { on/emit overloads for StateEvents }
    (or an internal typed wrapper if declaration merging fights strict mode — typed surface is the requirement)
  - PRIVATE emitChanged(): emits 'changed' with this.serialize()
  - METHODS:
    - getQuestion(id): Question | undefined
    - orderedQuestions(): Question[] — map order[] → questions; skip ids missing from the Map (defensive)
    - groupSummaries(): Array<{ group: string; total: number; answered: number; submitted: number;
      open: number; moot: number; withdrawn: number; closed: number; reasked: number }> —
      aggregate per non-undefined group; undefined-group questions counted under group "(none)"
      (label constant exported as UNGROUPED_LABEL)
    - bumpRev(id): void — increment question.rev, emitChanged(); throw Error(`unknown question id: ${id}`) if absent
    - bumpEpoch(): number — ++epoch, emit 'epoch-bumped' (epoch), emitChanged(); returns new epoch
  - JSDOC on class: singleton lifecycle note (h2.43 — never cache across session_shutdown; resetState is the only teardown)

Task 3: IMPLEMENT upsert entry points (raw storage only — S2 applies merge rules/status transitions)
  - upsertQuestion(q: Question): void — insert or replace by id.
    NEW id: status must be "open" (default if omitted), rev starts 1 (ignore/validate supplied rev),
    append id to order[]. EXISTING id: replace entry, keep position in order[]. Emit 'questions-upserted' ([id]) + emitChanged()
  - removeQuestion(id): void — delete from Map and order[] (used by S2 for withdrawn/archival variants)
  - applyAnswer(id, answer: QuestionAnswer): void — set question.answer + status = "answered";
    MUST NOT touch rev (h2.39); emitChanged()
  - setStatus(id, status: QuestionStatus): void — raw transition (S2 enforces legality); emitChanged()
  - clearForCompletion(): void — questions.clear(), order = [], emit 'completed-cleared' + emitChanged();
    epoch/goal retained (audit trail) — snapshots kept
  - JSDOC on each: "Raw primitive. Merge rules / transition legality enforced in merge-rules module (P1.M1.T2.S2)."

Task 4: IMPLEMENT serialize() / static deserialize()
  - serialize(): SerializedState — Object.fromEntries over Map, spread order[], goal, epoch.
    Deep-copy safety: return fresh objects (JSON-clone via structuredClone) so callers can't mutate internals
  - static deserialize(data: unknown): InterrogationState — tolerant:
    object-guard `typeof === "object" && !null && !Array.isArray`;
    goal → String(goal ?? ""); epoch → Number.isFinite ? : 1; order → Array.isArray ? filter(string) : [];
    questions → object-guard → per-id Question with defaults (status "open", rev 1, type "choice" fallback);
    SKIP malformed question entries rather than throwing. Resulting Map order normalized against order[]
    (append any Map ids missing from order[] at the end). DO NOT emit events during deserialize.

Task 5: IMPLEMENT factory + singleton
  - createInterrogationState(goal): InterrogationState — thin constructor wrapper (test/extension seam)
  - getState(): InterrogationState | undefined; setState(s) (internal, used by reconstruction P1.M7.T1.S2);
    resetState(): void — clears the singleton reference. Module-level `let current: InterrogationState | undefined`.

Task 6: CREATE src/state.test.ts (vitest, co-located — mirror config.test.ts conventions)
  - NAMING: test_<behavior>; use fresh instances per test (beforeEach), never the singleton for core tests
  - TESTS (minimum):
    1. createInterrogationState: epoch === 1, empty Map/order/snapshots, goal set
    2. upsertQuestion new id: appears in Map + end of order, status "open", rev 1
    3. upsertQuestion existing id: replaced, position preserved in order
    4. bumpRev: 1 → 2; unknown id throws; 'changed' emitted each time
    5. bumpEpoch: 1 → 2 → 3; 'epoch-bumped' payload carries new value; returns new value
    6. applyAnswer: sets answer + status "answered"; rev UNCHANGED (h2.39 regression test); 'changed' emitted
    7. orderedQuestions: insertion order; orphaned order-entries skipped defensively
    8. groupSummaries: two groups + ungrouped; counts per status correct
    9. events: 'questions-upserted' carries [id]; 'completed-cleared' fires on clearForCompletion; Map cleared, epoch retained
    10. serialize/deserialize round-trip: deep-equal Map contents, order, epoch, goal (use toStrictEqual on serialize() of both)
    11. deserialize tolerance: null / array / missing fields / malformed question entry / non-numeric epoch → defaults, no throw
    12. singleton: getState() undefined → setState → get → resetState → undefined
    13. no-UI guard (cheap static test): read src/state.ts source, assert only import line(s) match /^import .* from "node:events"/ — proves h2.13
  - PLACEMENT: src/state.test.ts

Task 7: VALIDATE
  - npm run typecheck && npm test
```

### Implementation Patterns & Key Details

```ts
// Typed EventEmitter via declaration merging:
export interface InterrogationState { on<K extends keyof StateEvents>(e: K, l: (...a: StateEvents[K]) => void): this; }
export class InterrogationState extends EventEmitter { /* ... */ }
// Node's typings make on/emit bivariant-compatible with this overload set; if strict mode complains,
// fall back to a narrow `emitTyped` private helper — the PUBLIC surface must stay typed.

// Serialize — Map must become a plain record:
serialize(): SerializedState {
  const questions: Record<string, Question> = {};
  for (const [id, q] of this.questions) questions[id] = structuredClone(q);
  return structuredClone({ goal: this.goal, epoch: this.epoch, order: [...this.order], questions });
}

// Tolerant deserialize guard (config.ts precedent):
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// Status machine JSDoc anchor — copy diagram verbatim from spec/state-and-persistence.md lines 6–23.
```

### Integration Points

```yaml
MODULES (contracts only — no file changes outside state.ts/state.test.ts):
  - P1.M1.T2.S2 merge rules: calls upsertQuestion/bumpRev/setStatus inside legality checks; adds transition validation ON TOP of these raw primitives
  - P1.M1.T2.S4 snapshots: pushes Snapshot{epoch, at, state: serialize()} into state.snapshots on bumpEpoch/submission; owns ring-of-10 trimming
  - P1.M1.T3.S4 tool details: result details.state = state.serialize()
  - P1.M1.T3.S2 guards: reads current epoch + revs from state for staleness rejection
  - P1.M7.T1.S1 persistence: debounced mirror of serialize(); S1.S2 reconstruction: InterrogationState.deserialize(base) + setState()
  - panel/renderers: subscribe to 'changed'/'questions-upserted'/'epoch-bumped'/'completed-cleared' ONLY
NO CHANGES to: src/index.ts, src/config.ts, package.json (node:events is a builtin — no new deps)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck     # tsc --noEmit → zero errors (covers state.ts + state.test.ts)
```

### Level 2: Unit Tests

```bash
npm test                              # vitest run → all state tests green
npx vitest run src/state.test.ts -v   # targeted while iterating
```

### Level 3: Integration (behavioral probe)

```bash
# Temporary probe (delete after): exercise events + round-trip in one shot
node --input-type=module -e "
import('./src/state.ts').then(m => {
  const s = m.createInterrogationState('Plan the migration');
  s.on('changed', st => console.log('changed, epoch', st.epoch));
  s.upsertQuestion({ id: 'q1', prompt: 'DB?', type: 'choice', rev: 1, status: 'open' });
  s.applyAnswer('q1', { value: 'postgres', at: new Date().toISOString() });
  console.log('rev after answer (must be 1):', s.getQuestion('q1').rev);
  const back = m.InterrogationState.deserialize(JSON.parse(JSON.stringify(s.serialize())));
  console.log('round-trip equal:', JSON.stringify(back.serialize()) === JSON.stringify(s.serialize()));
});"
# EXPECT: two 'changed' logs, rev 1 after answer, round-trip equal: true, no exception.
```

### Level 4: Domain validation

- [ ] JSDoc on InterrogationState contains the h2.38 state machine diagram + terminal-state bullets
- [ ] `grep -n "^import" src/state.ts` shows ONLY `node:events`
- [ ] Event payloads match the StateEvents interface consumers will code against

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green
- [ ] All h2.17 types exported with exact field names/optionalities
- [ ] rev starts 1, answer writes never bump it; epoch starts 1, bumps emit `'epoch-bumped'`
- [ ] All four events emitted with documented payloads; serialize/deserialize round-trips
- [ ] deserialize never throws on malformed input; no state cached across resetState (h2.43 documented)
- [ ] No files outside src/state.ts + src/state.test.ts modified; no new dependencies
- [ ] Mode A JSDoc state machine present on InterrogationState

## Anti-Patterns to Avoid

- ❌ Don't import anything from pi packages or UI modules in state.ts — h2.13 is contractual
- ❌ Don't let applyAnswer bump rev — answers are epoch territory (h2.39)
- ❌ Don't JSON.stringify a Map directly (yields `{}`) — always convert via Object.fromEntries/loop
- ❌ Don't return internal object references from serialize() — deep-copy (structuredClone)
- ❌ Don't enforce merge-rule legality here — S2 owns transitions; S1 primitives are raw by design
- ❌ Don't implement the snapshot ring or dependsOn evaluation — S4 and S3 respectively
- ❌ Don't cast unknown JSON without object guards — tolerance is contractual for P1.M7 reconstruction

---

**Confidence Score**: 9/10 — types are contractual (h2.17 verbatim), state machine and rev/epoch semantics are verbatim in spec/state-and-persistence.md, EventEmitter choice confirmed in architecture/system-context.md, and the singleton/serialize contracts match every downstream consumer PRP path. Only mild uncertainty: exact typed-EventEmitter ergonomics under strict tsconfig (two equivalent fallbacks given in the Blueprint).

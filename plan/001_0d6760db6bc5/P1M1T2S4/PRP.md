# PRP — P1.M1.T2.S4: Snapshot ring + diff computation

## Goal

**Feature Goal**: A self-contained `src/snapshots.ts` module implementing (a) `takeSnapshot(state)` — capture a full deep-copied state snapshot into the bounded ring of 10 on `state.snapshots` (called on every submission, BEFORE the epoch bump), (b) `computeDiff(prev, next)` — pure diff of two `SerializedState`s producing the `SubmissionCardData` shape consumed by the submission card renderer and delivery delta builder, and (c) `digestSince(state, epochFrom)` — compact one-line-per-submission delta digest used in stale-guard rejection messages ("Changes since epoch N").

**Deliverable**: `src/snapshots.ts` + `src/snapshots.test.ts` passing `npm run typecheck` and `npm test`. No changes to `state.ts` (S1, frozen), `merge.ts` (S2), or `depends-on.ts` (S3, parallel — do not create or modify it). No wiring — the submit flow (P1.M2.T1.S1), stale guards (P1.M1.T3.S2), and card renderer (P1.M7.T3.S1) call these functions later.

**Success Definition**:
- `npm run typecheck` → zero errors; `npm test` → all suites green
- 12 submissions → `state.snapshots.length === 10`, oldest dropped, newest is the pre-12th-bump state
- `computeDiff` produces `{changed: [{id, title, from, to, editedArchived}], note?, epoch, remainOpen}` with labels preferred over values for choice questions, and `editedArchived: true` on closed→re-answered edits (AC-13)
- `digestSince` returns a compact digest string matching the stale-guard message slot (spec/architecture.md line 75)
- Mode A JSDoc on `computeDiff` documents the `SubmissionCardData` shape verbatim

## User Persona (if applicable)

**Target User**: End user reviewing the interrogation panel (indirectly — via future submission diff cards) and the AI model receiving stale-guard rejections (indirectly — via digestSince). This item is pure data layer.

**Use Case**: On ctrl+s submission, a full state snapshot is retained for diffing and post-hoc recovery; the diff between consecutive snapshots powers the `{title}: {old} → {new (changed)}` card; when the model sends a stale epoch, the guard replies with a delta digest so it can re-apply intelligently.

**Pain Points Addressed**: No visible "what changed" feedback on submit; model confusion after stale rejections; no recovery point history.

## Why

- h2.39 (PRD): "Snapshots: full state copied on every submission (bounded ring of 10) — powers diff cards and post-hoc recovery; not user-facing undo in v1." S1 already declared `state.snapshots: Snapshot[]` and its ring-trim owner is this task.
- AC-13: "Editing an archived answer re-marks it pending; next submission diff card highlights the change (`Q3: sqlite → postgres (changed)`)." The `(changed)` marker data originates here.
- Stale guards (h3.8, Q38=A) reject with "current state + delta digest" — the digest is computed here from the ring.
- Centralizing diff logic guarantees the delivery delta (P1.M2.T1.S1), the card renderer (P1.M7.T3.S1), and stale guards agree on one diff semantics.

## What

- `src/snapshots.ts` exports:
  - `takeSnapshot(state: InterrogationState): Snapshot` — deep-copy current state (`state.serialize()`), stamp `{epoch: state.epoch, at: new Date().toISOString(), state}`, push onto `state.snapshots`, trim to last 10 (drop oldest), return the snapshot. Emits NO events.
  - `computeDiff(prev: SerializedState, next: SerializedState, note?: string): SubmissionCardData` — pure; no state mutation, no I/O.
  - `digestSince(state: InterrogationState, epochFrom: number): string` — walks the snapshot ring plus current state; compact digest of answer changes per submission since `epochFrom`.
  - types `SubmissionCardData`, `DiffEntry`.
  - constant `SNAPSHOT_RING_SIZE = 10`.

### Success Criteria

- [ ] Ring bound is exactly 10 (`SNAPSHOT_RING_SIZE`); push-then-shift-oldest trimming; `snapshots[snapshots.length-1]` is always the most recent
- [ ] `takeSnapshot` captures the state AS SUBMITTED at the CURRENT epoch — callers invoke it BEFORE `state.bumpEpoch()` (ordering is the caller's contract; document in JSDoc why subscribing to `epoch-bumped` is wrong — it fires after the increment)
- [ ] `computeDiff` changes detection: for the union of question ids across `prev`/`next`, an entry exists iff `answerSignature` differs — where a missing question or missing answer has signature `undefined`. Signature = `answer.value` + (text ? `"\u0000"+text` : "")
- [ ] `from`/`to` summaries: choice question → the **label** of the option whose `value` matches the answer value (fall back to raw value if no match); text question → raw value; no answer → `"(unanswered)"`. No truncation here (renderer's job)
- [ ] `title` = `q.title ?? q.prompt` (from the side where the question exists; prefer `next`)
- [ ] `editedArchived: true` iff the question's status in `prev` is `"closed"` and it appears as changed (Q24=B / AC-13 marker data)
- [ ] `epoch` = `next.epoch`; `remainOpen` = count of `next` questions with status `"open"`; `note` = passthrough third arg (delivery.ts owns batch-note capture)
- [ ] `digestSince`: consecutive pairs (snapshot_i.state → snapshot_{i+1}.state → … → current `state.serialize()`), for snapshots with `epoch >= epochFrom` (a snapshot labeled epoch N holds the state as submitted at epoch N); each submission contributes one compact segment `q3: sqlite→postgres; q7: (unanswered)→true` using the same label-preferred summaries; segments joined by ` | `. Empty string when `epochFrom >= state.epoch` or nothing changed
- [ ] Ring overflow: if `epochFrom` predates the oldest surviving snapshot, digest starts from the oldest snapshot (degrade gracefully, never throw)
- [ ] All functions tolerate deserialized/untrusted input shapes via the `SerializedState` type (already validated by `deserialize`) — never throw on missing fields (use optional chaining)

## All Needed Context

### Context Completeness Check

Greenfield module. The complete upstream contract (`state.ts` public surface — read in full, frozen) and every downstream consumer contract are specified in this PRP. No prior codebase knowledge required.

### Documentation & References

```yaml
- file: src/state.ts
  why: THE upstream contract — read it first. Owns Snapshot {epoch, at, state}, snapshots[] field,
        serialize() (deep-copied, structuredClone), bumpEpoch() (increments THEN emits), epoch, and
        the JSDoc notes that S4 owns ring trimming
  critical: DO NOT MODIFY state.ts. Import types from "./state.js" with ESM .js suffix.
    snapshots is `readonly Snapshot[]` — push/shift are legal (mutation of contents), reassignment is not.

- file: plan/001_0d6760db6bc5/P1M1T2S3/PRP.md
  why: parallel sibling contract — depends-on.ts lands in the same tree; confirms src/ conventions
        (pure-data module + co-located vitest file, zero new deps, no UI imports)
  critical: do NOT create/modify depends-on.ts; it is S3's deliverable

- file: plan/001_0d6760db6bc5/P1M1T2S4/research/notes.md
  why: condensed research — ordering decision (takeSnapshot before bumpEpoch), SubmissionCardData
        shape derivation, digest walk algorithm, label-preference rule

- file: spec/architecture.md (lines 73-76, "Stale guard rejection")
  why: verbatim message template containing the digest slot:
        "STALE: q3 is at rev 5 (you sent 2); session epoch is 9 (you sent 4).
         Current q3: {text}. Changes since epoch 4: {delta digest}. Re-apply against current state."
  critical: digestSince output goes into "{delta digest}"; keep it compact — no newlines, no full prompts

- file: spec/ui-spec.md (line 80 / h2.36 Renderers)
  why: interrogation-submission card contract — "each changed answer {title}: {old} → {new (changed)}
        + any NOTE: line + {open} remain open" — defines why SubmissionCardData carries
        changed[], note?, epoch, remainOpen
  critical: `(changed)` marker rendering is the renderer's; S4 supplies editedArchived flag data

- file: spec/state-and-persistence.md (h2.38-h2.39)
  why: closed→answered(pending) edit path (Q24=B); snapshot ring of 10; "not user-facing undo in v1";
        clearForCompletion RETAINS snapshots (post-hoc recovery survives completion)

- file: spec/product-requirements.md (AC-13, line 80)
  why: acceptance text `Q3: sqlite → postgres (changed)` — values may be raw values, labels are
        preferred when resolvable
```

### Current Codebase tree (when implementation starts)

```bash
pi-structured-interrogation/
├── package.json / tsconfig.json / vitest.config.ts
├── src/
│   ├── index.ts           # factory (do not modify)
│   ├── config.ts(+test)   # complete
│   ├── state.ts(+test)    # S1 — DO NOT MODIFY (already landed; read it)
│   ├── merge.ts(+test)    # S2 — landed, DO NOT MODIFY
│   └── depends-on.ts(+test) # S3 — landing in parallel, DO NOT CREATE/MODIFY
└── plan/  spec/
```

### Desired Codebase tree

```bash
src/
├── state.ts / state.test.ts      # unchanged
├── merge.ts / merge.test.ts      # unchanged
├── depends-on.ts(+test)          # S3, unchanged by this task
├── snapshots.ts                  # NEW: takeSnapshot, computeDiff, digestSince, types, SNAPSHOT_RING_SIZE
└── snapshots.test.ts             # NEW: vitest unit tests
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: state.ts is FROZEN. `snapshots` is `readonly Snapshot[]` — push()/shift() are fine,
//   reassignment (`state.snapshots = []`) will not typecheck. Do not extend the class.
// CRITICAL: takeSnapshot must run BEFORE bumpEpoch() (caller contract, P1.M2.T1.S1 wiring).
//   Subscribing to "epoch-bumped" is WRONG — it fires after epoch++ (state.ts line ~380), so the
//   snapshot would be labeled with the post-bump epoch. Export an explicit function; document this.
// GOTCHA: a Snapshot labeled epoch N = state AS SUBMITTED at epoch N (pre-bump capture).
//   digestSince(N) must therefore consider snapshots with epoch >= N, PLUS the current live state.
// GOTCHA: serialize() already structuredClones — the snapshot's state is mutation-safe. But do NOT
//   store live question objects in DiffEntry; copy strings only.
// GOTCHA: comparison by answerSignature must include answer.text — a text-only edit ("elaboration
//   added") IS a change for the diff card.
// GOTCHA: `remainOpen` counts status === "open" ONLY — not "answered" (those are pending), not "moot".
// GOTCHA: ESM imports use "./state.js" suffix (project convention; see merge.ts / depends-on.ts).
// GOTCHA: no new dependencies — typebox/pi packages are NOT needed here; zero imports beyond
//   ./state.js types (and nothing else — this module needs no EventEmitter use of its own).
```

## Implementation Blueprint

### Data models and structure

```ts
import type { InterrogationState, SerializedState, Snapshot } from "./state.js";

export const SNAPSHOT_RING_SIZE = 10;

/** One changed answer in a submission diff (h2.36 / AC-13). */
export interface DiffEntry {
  id: string;
  /** `title ?? prompt` — display name for the card. */
  title: string;
  /** Answer summary before (label-preferred; "(unanswered)" if none). */
  from: string;
  /** Answer summary after (label-preferred). */
  to: string;
  /** Q24=B / AC-13: question was `closed` (archived) in prev and edited — renderer adds `(changed)`. */
  editedArchived: boolean;
}

/** Shape consumed by the submission card renderer (P1.M7.T3.S1) and delivery delta builder
 *  (P1.M2.T1.S1). Mode A contract — documented in computeDiff JSDoc. */
export interface SubmissionCardData {
  changed: DiffEntry[];
  /** Batch note passthrough (delivery.ts owns capture; empty/omitted when none). */
  note?: string;
  /** Epoch of the `next` state (post-submission epoch as carried in SerializedState.epoch). */
  epoch: number;
  /** Count of `next` questions with status "open" — card footer "{open} remain open". */
  remainOpen: number;
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/snapshots.ts — answerSummary + answerSignature helpers
  - IMPLEMENT (not exported, or exported for tests):
    - answerSummary(q: Question | undefined): string
      - no question or no answer → "(unanswered)"
      - choice: options?.find(o => o.value === answer.value)?.label ?? answer.value
      - text: answer.value
    - answerSignature(q: Question | undefined): string | undefined
      - undefined when no question/no answer; else `${answer.value}\u0000${answer.text ?? ""}`
  - PLACEMENT: src/snapshots.ts top

Task 2: IMPLEMENT takeSnapshot(state) + ring trim
  - const snap: Snapshot = { epoch: state.epoch, at: new Date().toISOString(), state: state.serialize() }
  - state.snapshots.push(snap); while (state.snapshots.length > SNAPSHOT_RING_SIZE) state.snapshots.shift()
  - return snap; emit NOTHING (no state content mutation — no 'changed')
  - JSDOC: caller contract — invoke BEFORE bumpEpoch(); explain why the epoch-bumped event is
    unusable (fires post-increment). Mention h2.39 ring-of-10 and post-hoc recovery
    (snapshots survive clearForCompletion per state.ts).

Task 3: IMPLEMENT computeDiff(prev, next, note?) + Mode A JSDoc (REQUIRED)
  - ids = union of Object.keys(prev.questions) and Object.keys(next.questions)
  - for each id: sigPrev = answerSignature(prev.questions[id]); sigNext = answerSignature(next.questions[id])
    - equal (including both undefined) → skip
    - else push DiffEntry:
        title = (next.questions[id]?.title ?? next.questions[id]?.prompt ?? prev.questions[id]?.title ?? prev.questions[id]?.prompt ?? id)
        from = answerSummary(prev.questions[id]); to = answerSummary(next.questions[id])
        editedArchived = prev.questions[id]?.status === "closed"
  - epoch = next.epoch; remainOpen = count of Object.values(next.questions) with status === "open"
  - include `note` key only when the argument is a non-empty string
  - MODE A JSDOC on computeDiff: document SubmissionCardData shape verbatim, the label-preference
    rule, editedArchived/AC-13 semantics, and that truncation is the renderer's job

Task 4: IMPLEMENT digestSince(state, epochFrom)
  - if epochFrom >= state.epoch → ""
  - chain = [...state.snapshots.filter(s => s.epoch >= epochFrom).map(s => s.state), state.serialize()]
    (dedupe: if the last surviving snapshot's epoch === state.epoch, the live state IS the next
     segment — the concat of snapshots + live is already correct; do not special-case)
  - for each consecutive pair (a, b): reuse the diff-entry computation from Task 3 (extract shared
    computeEntries(a, b) helper); render each entry as `${id}: ${from}→${to}` joined by "; "
  - join per-submission segments with " | "; empty segments (no changes) are dropped entirely
  - graceful degradation: ring overflow means the walk simply starts at the oldest surviving
    snapshot ≥ epochFrom (or the oldest overall if all are older); never throw

Task 5: CREATE src/snapshots.test.ts
  - NAMING: test_<behavior>; fresh createInterrogationState per test; helpers to seed
    questions/answers (mirror src/state.test.ts conventions)
  - TESTS (minimum):
    1. takeSnapshot pushes onto state.snapshots with epoch = pre-bump epoch, ISO `at`, and a state
       deep-equal to serialize(); mutating the live question afterwards does NOT alter the snapshot
    2. ring: 12 takeSnapshot calls → length 10; snapshots[0].epoch === 3 (oldest dropped); last is epoch 12
    3. computeDiff: no answers changed → changed: [], remainOpen counts only "open"
    4. value change: q3 sqlite → postgres → one entry, from "SQLite" (label) when options carry labels;
       raw value fallback when value matches no option (exact-string assertions)
    5. text-only edit (answer.text changes, value same) → entry present
    6. new answer (unanswered → answered) and cleared answer (answered → undefined) both produce
       entries with "(unanswered)" on the correct side
    7. question present only in next with an answer → entry with from "(unanswered)"
    8. editedArchived: prev status "closed", next has new answer → editedArchived true; regular edit → false
    9. note passthrough: omitted when undefined/empty, present otherwise; epoch = next.epoch
    10. purity: JSON.stringify(prev) and (next) identical before/after computeDiff
    11. digestSince: seed 3 submissions via takeSnapshot+bumpEpoch with one answer change each →
        digest contains `q1: a→b` style segments separated by " | ", one per changed submission;
        epochFrom >= current epoch → ""; nothing changed → ""
    12. digestSince overflow: epochFrom = 1 with ring holding only epochs 3..12 → digest still
        produced starting from epoch-3 snapshot; no throw
  - PLACEMENT: src/snapshots.test.ts

Task 6: VALIDATE
  - npm run typecheck && npm test
```

### Implementation Patterns & Key Details

```ts
// Ring trim (Task 2):
state.snapshots.push(snap);
while (state.snapshots.length > SNAPSHOT_RING_SIZE) state.snapshots.shift();

// Shared diff core (Tasks 3-4) — keep ONE implementation so card diffs and digest can't diverge:
function computeEntries(a: SerializedState, b: SerializedState): DiffEntry[] { /* Task 3 loop body */ }

// Digest rendering (Task 4):
const segments = pairs.map(([a, b]) => computeEntries(a, b)
  .map(e => `${e.id}: ${e.from}→${e.to}`).join("; "))
  .filter(s => s.length > 0);
return segments.join(" | ");
```

### Integration Points

```yaml
MODULES (contracts only — no file changes outside snapshots.ts / snapshots.test.ts):
  - P1.M2.T1.S1 delivery delta builder (submit flow):
      takeSnapshot(state); const card = computeDiff(snap.state, state.serialize() AFTER bumpEpoch... 
      NOTE exact sequencing owned by delivery.ts; epoch in next comes from serialize().epoch
  - P1.M1.T3.S2 stale guards: rejection message embeds digestSince(state, modelEpoch) per
      spec/architecture.md "Changes since epoch N: {delta digest}"
  - P1.M7.T3.S1 submission card renderer: renders SubmissionCardData per h2.36 —
      `{title}: {from} → {to (changed)}` + NOTE: + `{remainOpen} remain open`; truncation there
  - post-hoc recovery: snapshots survive clearForCompletion() (state.ts retains them) — S4 adds nothing
NO CHANGES to: src/index.ts, state.ts, merge.ts, depends-on.ts, config.ts, package.json (zero new deps)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck     # tsc --noEmit → zero errors
```

### Level 2: Unit Tests

```bash
npx vitest run src/snapshots.test.ts -v    # targeted while iterating
npm test                                    # full suite green (state, merge, depends-on if landed, snapshots)
```

### Level 3: Integration (behavioral probe)

```bash
# Temporary probe (delete after): ring + diff + digest round-trip
node --input-type=module -e "
Promise.all([import('./src/snapshots.ts'), import('./src/state.ts')]).then(([d, s]) => {
  const st = s.createInterrogationState('probe');
  st.upsertQuestion({ id: 'q3', prompt: 'q3', type: 'choice', rev: 1, status: 'open',
    options: [{ value: 'sqlite', label: 'SQLite' }, { value: 'postgres', label: 'Postgres' }] });
  d.takeSnapshot(st); st.bumpEpoch();
  st.applyAnswer('q3', { value: 'postgres', at: new Date().toISOString() });
  const snap = d.takeSnapshot(st); st.bumpEpoch();
  const diff = d.computeDiff(st.snapshots[0].state, st.serialize());
  console.log(JSON.stringify(diff));
  console.log('digest:', d.digestSince(st, 1));
  console.log('ring:', st.snapshots.length);
}));"
# EXPECT: one changed entry {id:'q3', title:'q3', from:'(unanswered)', to:'Postgres', editedArchived:false},
#         epoch 3, remainOpen 0; digest 'q3: (unanswered)→Postgres'; ring: 2
```

### Level 4: Domain validation

- [ ] Mode A JSDoc on computeDiff documents SubmissionCardData shape {changed[], note?, epoch, remainOpen} (item contract)
- [ ] `grep -n "^import" src/snapshots.ts` shows only `import type ... from "./state.js"`
- [ ] AC-13 marker data path verified in tests (editedArchived on closed→re-answered)
- [ ] Stale-guard digest slot shape matches spec/architecture.md line 75 (compact, no newlines)

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green
- [ ] No files outside `src/snapshots.ts` + `src/snapshots.test.ts` created/modified; no new deps

### Feature Validation

- [ ] h2.39: full state copied per submission, bounded ring of 10, oldest dropped
- [ ] computeDiff: label-preferred from/to summaries, "(unanswered)" for missing, text-edits count,
      editedArchived flag (AC-13), epoch + remainOpen populated, note passthrough
- [ ] digestSince: one segment per changed submission, label-preferred, graceful overflow, ""
      when epochFrom >= current epoch
- [ ] Pure where promised: computeDiff/digestSince never mutate inputs; takeSnapshot emits no events
- [ ] All success criteria from "What" section met

### Code Quality Validation

- [ ] ESM `.js` import suffix; co-located vitest tests matching src/state.test.ts conventions
- [ ] No UI, pi-package, or config imports — data layer only
- [ ] Self-documenting names; JSDoc on all exported symbols

## Anti-Patterns to Avoid

- ❌ Don't modify state.ts (frozen S1) or create/modify depends-on.ts (S3 in flight)
- ❌ Don't subscribe to `epoch-bumped` to snapshot — it fires AFTER the increment; the
      takeSnapshot-before-bumpEpoch ordering is the caller contract
- ❌ Don't reassign `state.snapshots` — it's `readonly[]`; use push/shift
- ❌ Don't build a second diff implementation for the digest — one shared computeEntries core
- ❌ Don't truncate from/to strings here — renderer owns display truncation
- ❌ Don't emit `changed` from takeSnapshot — snapshotting is bookkeeping, not a state mutation
- ❌ Don't treat a value-only comparison as the diff signature — answer.text is part of the change
- [^ ] Don't add user-facing undo — v1 non-goal (h2.39 / h2.4)

---

**Confidence Score**: 9/10 — state.ts was read in full (the `snapshots` field, `Snapshot` type, serialize() deep-copy semantics, and the explicit S4-owns-ring-trim comment pin the integration exactly), all three downstream consumers' contracts are cited with line-accurate spec references, and the only residual ambiguity (exact digest join separators, note passthrough mechanics) is pinned by explicit decisions documented in the JSDoc contract and tests.

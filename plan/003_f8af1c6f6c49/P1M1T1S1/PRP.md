# PRP — P1.M1.T1.S1: Rewrite `initialCursorIndex` — the recorded answer owns the caret

## Goal

**Feature Goal**: Implement FR-35/FR-D8 (ANSWER-PIN-001, spec h2.8/h3.5/h2.65, AC-16): when a question carries an answer (any status — answered, submitted, closed, moot keeps its dimmed answer), `initialCursorIndex(q)` must seed the caret to the RECORDED ANSWER's display row — never to the ★ recommendation. ★ preselect survives only on unanswered questions.

**Deliverable**: Rewritten `initialCursorIndex` in `src/panel/short-view.ts` (~:117-124) + updated JSDoc/comment blocks + flipped/added tests in `src/panel/short-view.test.ts`.

**Success Definition**:
- `q.answer` present + `custom: true` → returns `options.length` (the ✎ Other row index)
- `q.answer` present + choice value in options → returns the DISPLAY row of `answer.value` via `displayOptions` order
- `q.answer` present + value no longer in options → clamps to 0 (row 0, NEVER the ★ recommendation row — even when the recommendation is display row 0 by D-R13 ordering; the clamp means display row 0, and the "never the recommendation" clause forbids falling back to the recommendation's index when it differs)
- `type: "text"` → 0 (the primary affordance)
- No answer → today's behavior unchanged (display row of ★ recommendation, clamp 0)
- Full suite + typecheck green; signature `initialCursorIndex(q: Question): number` unchanged

## Why

h2.65 (2026-10-04 interrogation): on revisit the caret re-seeded to the ★ recommendation, so the user couldn't tell what they'd answered, and `enter` on the revisit re-proposed the recommendation as an edit — the ripple modal accusing the user of invalidating their own work, with the recommendation one keypress from overwriting a deliberately different answer. User's words: "DO NOT RE-PROPOSE ANYTHING AFTER A USER HAS SELECTED AN ANSWER. THESE QUESTIONS TAKE HARD WORK. Always keep the user's answer. No exceptions." This subtask delivers the cursor-seeding half; the inert no-op accept paths are P1.M1.T2 (S4-S6), and seed-site comment purging is S2.

## What

Rewrite `initialCursorIndex` (src/panel/short-view.ts:117-124). Decision order:

```ts
export function initialCursorIndex(q: Question): number {
  const answer = q.answer;
  if (answer === undefined) {
    // ★ preselect — UNANSWERED questions only (ANSWER-PIN-001)
    if (q.type === "text") return 0;
    if (q.recommendation === undefined) return 0;
    const idx = displayOptions(q).findIndex((o) => o.value === q.recommendation);
    return idx >= 0 ? idx : 0;
  }
  // A recorded answer owns the caret (FR-35) — every status carrying answer.
  if (answer.custom === true) return (q.options ?? []).length; // ✎ Other row
  if (q.type === "text") return 0;
  const idx = displayOptions(q).findIndex((o) => o.value === answer.value);
  return idx >= 0 ? idx : 0; // stale value → display row 0, never ★ fallback
}
```

Docs [Mode A]:
1. Rewrite the JSDoc above `initialCursorIndex` (:110-116) — replace "Status-agnostic: a revisited answered question still preselects the recommendation — answers never pin the cursor" (now FALSE) with the pinning contract
2. Rewrite the "WHY ★ AND PRESELECT COEXIST" block (:22-28) — ★ stays visible on its row (R2 intact) but never owns the caret when an answer exists; preselect applies only to unanswered questions

### Success Criteria

- [ ] All 5 behavior rows above implemented and tested
- [ ] Flipped test rows: the ★-preselect-on-revisit assertions in short-view.test.ts (notably :92 `choiceQ({ status: "answered" })` expecting 0 — must become the answer's row)
- [ ] NEW test: stale-value clamp (★ recommendation present, `answer.value` absent from options → 0, and with a recommendation that is NOT display row 0, assert the result is 0-not-recommendation where constructible)
- [ ] NEW test: write-in (`custom: true`) seeds to `options.length` (✎ row)
- [ ] Unanswered tests (:79-:87, :91) unchanged and green
- [ ] Signature unchanged; no changes to displayOptions, deep-view.ts, panel.ts, actions.ts code (seed sites consume automatically; S2 owns their comments)

## All Needed Context

### Context Completeness Check

Repo fully implemented, suites green. This is one pure function + comments + tests. Every line reference verified against the working tree; the implementing agent needs this PRP plus short-view.ts/short-view.test.ts and (read-only) the three seed sites.

### Documentation & References

```yaml
- file: plan/003_f8af1c6f6c49/architecture/panel-ui-seams.md
  why: "dedicated §Cursor-seaming research: initialCursorIndex at short-view.ts:119, displayOptions D-R13 ordering, ✎ row at options.length, accent-highlight-on-recorded-row already shipped (commit 32a1f6e) — only caret placement missing"
  section: "§Cursor-seeding"

- file: plan/003_f8af1c6f6c49/architecture/answer-pinning-contract.md
  why: "authoritative answer shape {value, custom?: true, at} + the pinning decision matrix consumed here"

- file: src/panel/short-view.ts
  why: "displayOptions :101-108 (recommended-first stable sort, exported), initialCursorIndex :117-124 (the rewrite target), comment blocks :22-28 and :110-116 (doc rewrite targets)"
  pattern: "displayOptions order IS the cursor domain; ✎ Other row index = (q.options ?? []).length"

- file: src/panel/short-view.test.ts
  why: "test conventions: choiceQ()/textQ() factories :44-70 (override spread — pass answer via overrides), describe 'initialCursorIndex (R2 preselect)' :77-93"
  gotcha: ":92 is the status-agnostic preselect pin to FLIP; :79-:91 are the unanswered rows to KEEP"

- file: src/panel/panel.ts (READ ONLY — no edits here)
  why: "seed sites :357 (currentId setter re-seed) and :894 — they call initialCursorIndex(q) and inherit the fix unchanged"

- file: src/panel/deep-view.ts (READ ONLY)
  why: "deepInitialCursor :560-571 wraps initialCursorIndex clamped into the deep cursor domain — inherits automatically"

- file: src/panel/actions.ts (READ ONLY)
  why: "imports initialCursorIndex at :31 — other consumers inherit; no-op accept semantics are P1.M1.T2.S4-S6, NOT this PRP"
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
├── short-view.ts        # initialCursorIndex + displayOptions + comments — MODIFY
├── short-view.test.ts   # flip :92-row, add custom/stale tests — MODIFY
├── deep-view.ts         # consumer (clamped wrapper) — NO CHANGE
├── panel.ts             # seed sites :357/:894 — NO CHANGE
└── actions.ts           # consumer — NO CHANGE
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: displayOptions puts the ★ recommendation FIRST when set — for
//   answered questions with a matching option, the answer's display row is
//   its STATE-order position among the non-recommended tail (or 0 if the
//   answer IS the recommendation). Map through displayOptions, never raw options.
// GOTCHA: the ✎ Other row index is (q.options ?? []).length — same constant the
//   renderers use for the trailing synthetic row; do not hardcode a different one.
// CRITICAL: type:"text" with a recorded answer still returns 0 (the text
//   affordance IS row 0 — the pinning is inherent), but the ANSWER-FIRST branch
//   order matters: custom:true must be checked before the type:"text" early
//   return if a text answer ever carried custom (defensive; text answers with
//   custom also pin to 0, so order is safe either way — keep answer.custom
//   branch before generic choice mapping regardless).
// GOTCHA: q.answer present but value === "" — narrowAnswer forbids empty
//   values, and reviveQuestion requires string; treat presence of answer as
//   the pinning trigger (no value-emptiness re-check).
// GOTCHA: moot questions KEEP their answer (dimmed) — the answer-first branch
//   must not be gated on status; answer presence alone pins.
// GOTCHA: do NOT touch the unanswered branches — tests :79-:91 pin them and
//   R2 (unmistakable recommendation) is intact per FR-35.
```

## Implementation Blueprint

### Implementation Tasks (TDD-ordered)

```yaml
Task 1: ADD failing tests to src/panel/short-view.test.ts
  - Rename describe 'initialCursorIndex (R2 preselect)' → covers pinning too
  - NEW rows (use choiceQ({ answer: {...}, status: 'answered' }) overrides):
    1. answered non-recommended value (e.g. answer.value 'postgres', rec 'sqlite')
       → returns the DISPLAY row of 'postgres' (1 under D-R13: sqlite first)
    2. answer.custom: true → returns options.length (2 = ✎ row for a 2-option q)
    3. stale value: answer.value 'ghost', recommendation 'sqlite' → 0
       (row 0 IS the recommendation here under D-R13; ALSO add the discriminating
       fixture: recommendation undefined + answer.value 'ghost' → 0, proving the
       clamp is row-0, not recommendation-seek)
    4. text question with recorded answer → 0
    5. FLIP :92: choiceQ({ status: 'answered' }) has NO answer → still 0
       (unanswered preselect unchanged — keep this row as-is, it tests status
       alone, which no longer implies answer presence)
    6. moot with answer → pins to the answer row (answer presence regardless of status)

Task 2: REWRITE initialCursorIndex (short-view.ts :117-124)
  - Implement the decision order in the What section above
  - Keep the export, name, and signature byte-identical

Task 3: REWRITE the two comment blocks
  - :110-116 function JSDoc: pinning contract (answer-first; ★ only unanswered;
    stale clamps to display row 0)
  - :22-28 'WHY ★ AND PRESELECT COEXIST': ★ visible always (R2), preselect only
    unanswered; reference ANSWER-PIN-001 / FR-35

Task 4: RUN gates
  - npx vitest run src/panel/short-view.test.ts → green
  - npm test + npm run typecheck → full green (seed-site and deep-view suites
    may flip revisit-cursor assertions — if any OTHER suite fails on cursor
    expectations, P1.M1.T1.S2/S9 own those flips; only short-view.test.ts is
    in scope here. If a cross-suite failure blocks green, make the minimal
    assertion flip in that suite and note it for S2.)
```

### Implementation Patterns & Key Details

```ts
// The complete new implementation (drop-in):
export function initialCursorIndex(q: Question): number {
  const answer = q.answer;
  if (answer === undefined) {
    if (q.type === "text" || q.recommendation === undefined) return 0;
    const idx = displayOptions(q).findIndex((o) => o.value === q.recommendation);
    return idx >= 0 ? idx : 0;
  }
  if (answer.custom === true) return (q.options ?? []).length;
  const idx = displayOptions(q).findIndex((o) => o.value === answer.value);
  return idx >= 0 ? idx : 0;
}
// type:'text' answered falls through to the last findIndex, which returns -1 → 0
// for values not in options — but prefer the explicit `if (q.type === 'text') return 0;`
// inside the answer branch for clarity (both yield 0).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/short-view.test.ts   # the rewritten describe
npm test                                       # full suite
```

### Level 3: Consumer regression (inheritance)

```bash
npx vitest run src/panel/panel.test.ts src/panel/deep-view.test.ts src/panel/actions.test.ts
# Seed sites and the deep clamp consume initialCursorIndex unchanged; revisit
# cursor assertions in these suites may legitimately flip — triage per Task 4 note.
```

### Level 4: Behavior matrix walkthrough

Verify each row of the decision table (custom / choice-in-options / stale / text / no-answer) against the new tests — no row untested.

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → green
- [ ] All five pinning rows tested; stale-clamp test includes the recommendation-undefined discriminator
- [ ] Unanswered ★ preselect rows (:79-:91) unchanged and green
- [ ] Both comment blocks rewritten (no residual status-agnostic-preselect claims in short-view.ts)
- [ ] No changes to displayOptions, panel.ts, deep-view.ts, actions.ts code
- [ ] Signature unchanged — S2's seed-site work is comment-only by design

## Anti-Patterns to Avoid

- ❌ Don't map through raw `q.options` — the cursor domain is displayOptions order (D-R13)
- ❌ Don't gate pinning on status — answer presence alone pins (moot keeps its dimmed answer)
- ❌ Don't "fall back" to the recommendation on stale values — clamp to display row 0
- ❌ Don't touch the unanswered branches or their tests
- ❌ Don't implement the no-op enter/digit semantics here — that's P1.M1.T2.S4-S6
- ❌ Don't purge seed-site comments — that's P1.M1.T1.S2

---

**Confidence Score**: 9/10 — single pure function with a complete drop-in implementation, exact line references, factories for the test overrides already in place, and the only uncertainty (cross-suite cursor assertion flips) is explicitly triaged to sibling subtasks.

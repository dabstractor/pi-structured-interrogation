# PRP — P1.M1.T2.S1: Implement stageSupersededWriteIn + unit tests for each guard

## Goal

**Feature Goal**: Add the exported `stageSupersededWriteIn(panel, questionId, superseded, newValue)` helper to `src/panel/actions.ts` — the WRITEIN-002 re-bind primitive (PRD BUG-001, adjudicated "restore"). Four ordered guards (custom-only, non-whitespace, no kind-flip, user-draft-wins), then stage the superseded write-in's text via the public `commitTextDraft` seam. **No call sites in this subtask** — P1.M1.T3.S1/S2 wire it.

**Deliverable**: New exported function + [Mode A] JSDoc in `src/panel/actions.ts`; a new test describe in `src/panel/actions.test.ts` (TDD failing-first: happy path + one test per guard).

**Success Definition**:
- `npm run typecheck` + full `npm test` green
- Happy path: custom superseded answer, no existing draft → `panel.draftTextFor('q1')` returns the write-in text
- Each of the four guards independently proven (including the delete-to-empty `''` draft case)
- Zero call sites added; `actions.test.ts:2213` (manufactured rebind test) untouched — S3 owns it

## Why

BUG-001 (PRD h2.2/h3.0): `consumeCommittedBuffer` (panel.ts:982-991, the VAL-002 fix) deletes the slot + store at write-in commit, so `acceptOptionIndex`'s later supersede apply leaves `answer.text` undefined — the user's words vanish from every surface, violating AC-2b and R4. The adjudicated fix restores the re-bind: re-create the slot **at supersede time, from the recorded answer's value, only when no user-held draft exists**. The staged slot is an ordinary role-less draft that `reconcileDraftsForSubmit` (actions.ts:573-579) attaches as `answer.text` at the next submit — no changes to reconcile, submit, or panel internals. This subtask is the leaf primitive both apply sites consume.

## What

Add to `src/panel/actions.ts` (verbatim from the research doc §(d), plus [Mode A] JSDoc citing the P1.M1.T1.S1 decisions.md ruling):

```ts
export function stageSupersededWriteIn(
  panel: InterrogationPanel,
  questionId: string,
  superseded: QuestionAnswer | undefined,
  newValue: string,
): void {
  if (superseded === undefined || superseded.custom !== true) return; // 1: only write-ins re-bind
  const text = superseded.value;
  if (text.trim() === "") return;                                   // 2: degenerate — no ✎ for whitespace
  if (text === newValue) return;                                    // 3: kind-flip — never "Alpha — Alpha"
  if (panel.draftTextFor(questionId) !== undefined) return;          // 4: user-held draft wins (incl. delete-to-empty "")
  panel.commitTextDraft(questionId, text);
}
```

Guard 1 needs no value-change check: the ANSWER-PIN-001 inert branch at actions.ts:296 requires `recorded.custom !== true`, so **every** apply behind a `custom:true` answer is a genuine supersede. Guard 4 uses `!== undefined` (NOT a trim check): a deliberate delete-to-empty `""` slot is defined and must never be resurrected — stricter R4 reading.

### Success Criteria

- [ ] Helper exported from actions.ts; `QuestionAnswer` imported from the state module; no new module deps (ripple-confirm.ts already imports from actions.js — no cycle when S2 wires it)
- [ ] TDD: 6 tests (happy path + 4 guards, guard 4 split into non-empty and delete-to-empty cases) written first, observed red, then green
- [ ] `test_wi_same_value_recommit_consumes_buffer_no_draft_residue` (actions.test.ts:776, VAL-002 pin) stays green — commit path untouched
- [ ] actions.test.ts:2213/:2223 untouched; zero behavior change (no call sites)
- [ ] Full suite + typecheck green

## All Needed Context

### Context Completeness Check

Repo green; the research doc holds the verbatim helper code, guard rationale, and seam analysis. Agent needs this PRP plus `src/panel/actions.ts`, `src/panel/actions.test.ts`, `src/panel/panel.ts` (seams, read-only).

### Documentation & References

```yaml
- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/architecture/bug001-writein-supersede.md
  why: "THE research doc — §(d) has the verbatim helper sketch + full guard rationale (incl. why guard 1 needs no value check and why guard 4 is !== undefined, not trim) + why commitTextDraft is the sanctioned seam; §(e) test-impact (still-green pins)"
  critical: "§(d) 'New-answer kind is implicit': applyWriteInConfirm must NEVER call this helper (reconcile skips custom answers — staging there is pure ✎-marker noise). State this in the JSDoc."

- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/P1M1T2S1/research/notes.md
  why: condensed verified seam lines + test plan

- file: src/panel/actions.ts
  why: "helper placement (near the write-in/accept helpers); import QuestionAnswer from ../state.js (match the file's existing import style); ANSWER-PIN-001 inert branch :296 context"
  gotcha: "do NOT add the call sites — S3's contract; do NOT touch :2213"

- file: src/panel/panel.ts
  why: "READ-ONLY seams: draftTextFor :1205-1210 (slot ?? store), commitTextDraft :903-926 (EXPLAIN-003 re-seed guarded by cursorIndex >= options.length — cannot fire from an accept gesture), draftSlots PRIVATE :423"
  gotcha: "commitTextDraft's blurTextField is harmless in accept context (focus already 'options') — do not fight it"

- file: src/panel/actions.test.ts
  why: "house fixtures seed() :82 / choiceQ() :64; new describe near the write-in tests; still-green pin :776; off-limits :2213-:2242"

- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/P1M1T1S1/PRP.md (CONTRACT)
  why: "decisions.md ruling text the JSDoc cites — 'WRITEIN-002 supersede re-bind restored (BUG-001)'; cite by name, do not quote wholesale"
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
├── actions.ts           # MODIFY: + stageSupersededWriteIn + JSDoc
└── actions.test.ts      # MODIFY: + describe with 6 TDD tests
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: guard ORDER matters — write the tests so each guard is provable
//   in isolation (e.g. guard 3 tested with a non-empty custom value + equal newValue).
// CRITICAL: guard 4 compares against undefined, NOT truthiness — draftTextFor
//   returns "" for a deliberate delete-to-empty; "" !== undefined → user's slot wins.
// GOTCHA: the helper may be called with the PRE-apply recorded answer (S3 passes
//   the captured `recorded`); it stages drafts only — never mutates answer state.
// GOTCHA: headless test panels have an optional drafts seam — to make guard-4
//   tests deterministic, either wire a real DraftStore stub or stage the
//   user draft via panel.commitTextDraft (public seam) in the fixture.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: WRITE FAILING TESTS FIRST (src/panel/actions.test.ts, new describe
        "stageSupersededWriteIn — WRITEIN-002 re-bind guards")
  - fixtures: seed([{id:'q1'}]) + choiceQ; panel via the existing harness
  - happy path: applyAnswer custom {value:'my own words', custom:true} on q1;
    stageSupersededWriteIn(panel,'q1',{value:'my own words',custom:true,at:'t'},'alpha')
    → expect(panel.draftTextFor('q1')).toBe('my own words')        // FAILS: no export
  - guard 1: non-custom {value:'alpha',at} → undefined result; undefined superseded → undefined
  - guard 2: custom {value:'   '} → no stage
  - guard 3: custom value === newValue ('alpha'/'alpha') → no stage
  - guard 4a: existing non-empty draft (commitTextDraft 'user draft' first) → stays 'user draft'
  - guard 4b: delete-to-empty '' draft staged first → draftTextFor stays '' (never clobbered)
  - RUN: confirm red (import of stageSupersededWriteIn fails)

Task 2: IMPLEMENT the helper in src/panel/actions.ts
  - verbatim per What §code; place near the write-in helpers; [Mode A] JSDoc:
    WRITEIN-002 re-bind, VAL-002 interplay (consume-at-commit stays; slot re-created
    ONLY at supersede time, never over a user draft incl. delete-to-empty), cite the
    P1.M1.T1.S1 decisions.md ruling by name; note applyWriteInConfirm must never call it

Task 3: RUN gates
  - npx vitest run src/panel/actions.test.ts -v
  - npm run typecheck && npm test   (:776 pin green; :2213 untouched and still green)
```

### Implementation Patterns & Key Details

```ts
// The helper is a pure "guarded stage" — drafts only, never answer state:
// (1) custom !== true → return      (inert branch :296 means every custom apply is a supersede)
// (2) value.trim() === "" → return  (no ✎ noise)
// (3) value === newValue → return   (kind-flip)
// (4) draftTextFor(id) !== undefined → return  (user slot wins, incl. "")
// tail: panel.commitTextDraft(id, superseded.value)
```

### Integration Points

```yaml
MODULES (contracts only — NO call sites added here):
  - P1.M1.T3.S1: "acceptOptionIndex: capture `recorded` at :294, call stageSupersededWriteIn(panel, q.id, recorded, proposed.value) after applyAnswer :313; rewrites the manufactured :2213 test"
  - P1.M1.T3.S2: "applyConfirmedEdit (ripple-confirm.ts:158): capture pre-apply answer, call after applyAnswer — ripple-confirm already imports from ./actions.js"
NO CHANGES to: panel.ts, reconcileDraftsForSubmit, submit, consumeCommittedBuffer, actions.test.ts:2213/:776
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/actions.test.ts -v
npm test
```

### Level 3: Behavioral probe

```bash
npx vitest run src/panel/actions.test.ts -t "stageSupersededWriteIn" -v   # the 6 TDD tests
```

### Level 4: Domain validation

- [ ] JSDoc cites the decisions.md ruling, states the VAL-002 interplay, and warns off applyWriteInConfirm
- [ ] `rg -n "stageSupersededWriteIn" src/` — definition + tests only (zero call sites)

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green
- [ ] TDD: 6 tests red-then-green; each guard provable in isolation
- [ ] Delete-to-empty `''` draft never clobbered; kind-flip never stages
- [ ] :776 VAL-002 pin green; :2213 untouched; zero call sites
- [ ] Only actions.ts + actions.test.ts modified

## Anti-Patterns to Avoid

- ❌ Don't use a truthiness or trim check for guard 4 — `''` is a user slot and wins
- ❌ Don't reach into private draftSlots — commitTextDraft is the sanctioned seam
- ❌ Don't add call sites or touch the :2213 test — S3's contract
- ❌ Don't call it from write-in→write-in edits (applyWriteInConfirm) — reconcile skips custom answers
- ❌ Don't mutate answer state — the helper stages drafts only

---

**Confidence Score**: 10/10 — the helper code is verbatim in the research doc with full guard rationale; seams, test fixtures, and sibling contracts all verified against the working tree.

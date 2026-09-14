---
name: "bugfix P1.M2.T2.S1 — snapshots.ts computeEntries: add raw `value` to DiffEntry"
description: "Extend src/snapshots.ts DiffEntry with an optional `value?: string` field = the POST-change raw answer value (`after.answer?.value`, undefined when unanswered), populated in the private computeEntries diff core. Do NOT change from/to label summaries, the answerSignature change predicate, or any renderer. Type-only ripple through snapshots.test.ts / delivery.test.ts exact-match fixtures. This is the BUG-007 foundation consumed by P1.M5.T1.S1 (reconstruct.replaySubmission will prefer `value` over the label `to`). Mode A JSDoc on DiffEntry documenting value (raw, machine-readable, reconstruction) vs to (label-preferred, display-only)."
---

## Goal

**Feature Goal**: Every emitted `DiffEntry` in submission diffs/digests carries the machine-readable raw answer value alongside the existing label-preferred display summary, so downstream reconstruction (P1.M5.T1.S1) can restore exact canonical `answer.value` instead of display labels (BUG-007 root cause: label ≠ value corrupts state after restart).

**Deliverable**: Modified `src/snapshots.ts` (DiffEntry + computeEntries + JSDoc), updated exact-match fixtures in `src/snapshots.test.ts` and `src/delivery.test.ts`. No other file's logic changes.

**Success Definition**: `npm run typecheck` + `npm test` green; `computeDiff`/`digestSince` entries for answered questions carry `value === after.answer.value` (raw, not label); unanswered/cleared entries omit `value`; `from`/`to`/signature behavior byte-identical to before.

## User Persona

**Target User**: The session-restarting user (AC-9: "panel reopens with questions/answers") — whose answers must survive a restart with the exact raw values they chose, not the display label. Machine consumers: `reconstruct.ts` (P1.M5.T1.S1), session history.

**Use Case**: User answers choice q1 with value `"b"` (label `"Beta"`), submits; the submission delta's details now carry `value: "b"`; after restart, reconstruction replays `"b"` — not `"Beta"` — so `dependsOn` equals/notEquals, the read digest, and the completion ★ check stay correct.

**User Journey**: unchanged for humans — this is a data-shape enrichment invisible in the UI (cards render from `title/from/to` as before).

**Pain Points Addressed**: BUG-007 — session-start reconstruction writing display labels as answer values, breaking moot evaluation, digests, and ★ recommendation checks after restart.

## Why

- Bug report h2.2/Issue 7 (BUG-007) + h2.5 recommendation: "Carry raw answer values (not label summaries) in submission delta details.changed so reconstruction replay restores exact values."
- This item is the FOUNDATION: it puts `value` into the data that flows into session history via `SubmissionMessage.details.changed`. P1.M5.T1.S1 then flips `reconstruct.ts:289` to prefer it.
- One diff core (`computeEntries`) backs both `computeDiff` (card/delta) and `digestSince` — a single edit propagates everywhere; renderers are untouched because `value` is additive/optional.

## What

In `src/snapshots.ts`:

1. **Extend the interface** (keep field order: append after `editedArchived`):

```ts
export interface DiffEntry {
  id: string;
  title: string;
  from: string;
  to: string;
  editedArchived: boolean;
  /**
   * Raw POST-change answer value (`answer.value` of the `next`-side
   * question). Omitted when the question is unanswered/cleared after the
   * change. Machine-readable reconstruction data (P1.M5.T1.S1
   * replaySubmission prefers this over the label-preferred `to`);
   * `to` stays the display-only summary for cards/deltas. Optional because
   * history written before this field existed carries no `value`.
   */
  value?: string;
}
```

2. **Populate in `computeEntries`** (private, ~line 148): in the pushed entry add
   `value: after?.answer?.value,` — i.e. the raw post-change value; `undefined` when `after` is missing or unanswered (matches the contract: omit when unanswered; since the object literal includes the key with undefined, `toEqual` treats it as absent — either spell it conditionally (`...(after?.answer ? { value: after.answer.value } : {})`) or plainly; pick ONE and keep tests consistent with it).
3. **Do NOT touch**: `answerSignature` (the change predicate), `answerSummary` (from/to stay label-preferred), `UNANSWERED`, `SubmissionCardData`, `takeSnapshot`, `computeDiff`/`digestSince` signatures. `delivery.ts` needs NO edit — `SubmissionMessage.details.changed` re-exports `DiffEntry` (delivery.ts:66–67), so the field flows into session history automatically.
4. **JSDoc (Mode A)**: on `DiffEntry` as shown above — explicitly document the split: `value` = raw, machine-readable, for reconstruction; `to` = label-preferred, display-only; plus the legacy-tolerance note (pre-change history has no `value`; fallback handling belongs to P1.M5.T1.S1, not here).
5. **Fixture ripple** (type-only, but required because suites use exact `toEqual` literals):
   - `src/snapshots.test.ts` — every expected `changed` entry whose post-change question IS answered gets `value: "<raw post value>"` (e.g. `choice_value_change_uses_labels_exact_entry` → `value: "postgres"`; `value_matching_no_option_falls_back_to_raw_value` → `value: "mysql"`; `text_only_edit_...` → `value: "sqlite"`; the `(unanswered)→answered` cases; the `editedArchived` case). Cleared-answer case (`to: "(unanswered)"`) gets no `value` (or `value: undefined`).
   - `src/delivery.test.ts` — any assertion matching `details.changed` / card entries byte-exactly gets the same additions.
   - ADD new dedicated tests (see Task 4).

### Success Criteria

- [ ] `DiffEntry.value?: string` present; `computeDiff` entries for answered questions carry the RAW value (`"b"`, not `"Beta"`) even when a label exists
- [ ] Value-matching-no-option fallback: `value === answer.value` (same as `to` in that case)
- [ ] Text questions: `value === answer.value`
- [ ] Cleared answers (`to: "(unanswered)"`): `value` undefined/omitted
- [ ] `digestSince` entries also carry `value` (shared core proves itself)
- [ ] `from`/`to` outputs unchanged vs prior suite behavior (only additions to literals)
- [ ] `answerSignature` predicate untouched — no new entries appear/disappear
- [ ] `npm run typecheck` + `npm test` green

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets: exact current DiffEntry/computeEntries code shape, which private helper produces what, exactly which test literals break and how to fix them, the explicit do-not-touch list, the consumer contract (P1.M5.T1.S1 prefers `value`, tolerates legacy absence), and the vitest `toEqual` undefined-vs-absent nuance. No guessing.

### Documentation & References

```yaml
- file: src/snapshots.ts
  why: THE file — DiffEntry (~37–55), private answerSummary (~86–100: choice → LABEL for value, fallback raw; text → raw; missing → "(unanswered)"), answerSignature (value NUL text — the change predicate), computeEntries (~148–167: emits entry iff signature differs)
  pattern: single change core backs computeDiff AND digestSince — edit once, both carry value
  gotcha: answerSignature/answerSummary/from/to MUST NOT change; value is additive only

- file: src/snapshots.test.ts
  why: exact `toEqual` literals for diff.changed (~122–226) that break when `value` is populated; also the fixture helpers (q(), ans()) for new tests
  gotcha: vitest toEqual treats `value: undefined` as key-absent — cleared-answer cases pass either way; answered cases MUST gain the field

- file: src/delivery.test.ts
  why: SubmissionMessage.details.changed is DiffEntry[] re-exported (delivery.ts:66–67) — byte-exact changed assertions ripple here too
  gotcha: delivery.ts itself needs NO edit; only test literals

- file: src/reconstruct.ts
  why: line 289 currently applyAnswer(id, {value: to}) — the BUG-007 consumer; line ~46 JSDoc documents `to` as display-only. DO NOT modify in this item (P1.M5.T1.S1 owns the flip to prefer entry.value)

- file: src/renderers.ts (lines 144, 183)
  why: proves renderers read changed as array + sparse guards — optional new field is safe, no renderer change

- file: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/prd_snapshot.md (h2.2 Issue 7 / BUG-007, h2.5 recommendation "Carry raw answer values")
  why: the defect being fixed and the mandated remedy
```

### Current Codebase tree (src/)

```bash
src/ snapshots.ts (+test) delivery.ts (+test) reconstruct.ts (+test) renderers.ts (+test) state.ts merge.ts tool.ts lifecycle.ts completion.ts fallback.ts panel/ ... — full M1–M7 implementation exists
```

### Desired Codebase tree

```bash
src/
  snapshots.ts        # MODIFIED: DiffEntry.value? + computeEntries population + Mode A JSDoc
  snapshots.test.ts   # MODIFIED: fixture literals + new value-semantics tests
  delivery.test.ts    # MODIFIED: fixture literals only (delivery.ts untouched)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// ESM: relative imports use ".js" suffix.
// snapshots.ts is a zero-dependency pure module — keep it that way (no state mutation, no events).
// computeEntries is PRIVATE — the field is populated there once; computeDiff/digestSince need no edits.
// vitest toEqual: {value: undefined} ≡ key absent — but pick one spelling and match it in all literals.
// Do NOT "helpfully" add a pre-change `fromValue` — the contract names ONE field: post-change `value`.
// Do NOT touch delivery.ts content-line format ({id}: {to}) — labels stay model-visible; value is data-only.
```

## Implementation Blueprint

### Data models and structure

Only the DiffEntry change shown in What §1. No new modules, no config, no events.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/snapshots.ts — DiffEntry interface
  - IMPLEMENT: optional `value?: string` field with the Mode A JSDoc from What §1 (raw vs display split + legacy note)
  - PLACEMENT: after editedArchived (field order preserved for review diffs)

Task 2: MODIFY src/snapshots.ts — computeEntries population
  - IMPLEMENT: `value: after?.answer?.value` in the pushed entry (or conditional spread — one consistent style)
  - PRESERVE: signature comparison, from/to via answerSummary, title/editedArchived logic, iteration order

Task 3: UPDATE fixtures
  - MODIFY src/snapshots.test.ts: extend every exact-match changed literal whose post-change question is
     answered with `value: <raw post value>`; cleared-answer literals get value: undefined (or omit — consistent)
  - MODIFY src/delivery.test.ts: same treatment for changed/card entry literals

Task 4: ADD dedicated tests to src/snapshots.test.ts
  - IMPLEMENT: describe/computeDiff value-semantics cases:
      * value is RAW not label: choice with label "Beta"/value "b" answered "b" → entry.value === "b" while to === "Beta"
      * no-option-match fallback: entry.value === raw value === to
      * text question: value === answer.value
      * cleared answer (was answered → applyAnswer-less reset e.g. via merge rule-2 path or fresh unanswered next
        side): to === "(unanswered)", value undefined
      * digestSince entries carry value too (shared-core proof)
      * text-only elaboration edit: value present, equals unchanged raw value
  - NAMING: test("diff entry carries raw value not label", ...) style (match file's snake_case test names)
  - PATTERN: reuse existing q()/ans() fixture helpers and createInterrogationState + upsertQuestion + applyAnswer
```

### Implementation Patterns & Key Details

```ts
// In computeEntries — the ONLY logic change:
entries.push({
  id,
  title: after?.title ?? after?.prompt ?? before?.title ?? before?.prompt ?? id,
  from: answerSummary(before),
  to: answerSummary(after),
  editedArchived: before?.status === "closed",
  value: after?.answer?.value, // RAW post-change value; undefined when unanswered/missing
});
// NOTE: when to === "(unanswered)" value is undefined — this is the signal
// P1.M5.T1.S1 uses to know an answer was CLEARED vs changed.
```

### Integration Points

```yaml
SESSION HISTORY: SubmissionMessage.details.changed[].value now persisted via buildSubmission (no code change — type flows through)
CONSUMER (P1.M5.T1.S1): reconstruct.ts replaySubmission will read entry.value ?? entry.to (legacy fallback) — that item owns reconstruct.ts
RENDERERS: no change (value unused by cards)
CONFIG/EVENTS/DB: none
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck
npx vitest run src/snapshots.test.ts src/delivery.test.ts
```

### Level 2: Unit Tests (Component Validation)

```bash
npm test   # full suite — proves no fixture was missed and no behavior regressed
```

### Level 3: Integration Testing (System Validation)

Not applicable — pure data-shape change with no runtime surface beyond existing tests; end-to-end proof (reconstruction restoring raw values) is P1.M5.T1.S1's validation.

### Level 4: Creative & Domain-Specific Validation

Review the DiffEntry JSDoc against the contract point 5 (value = raw/machine-readable/reconstruction; to = label-preferred/display-only; legacy absence noted).

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean
- [ ] `npm test` green (all suites, including reconstruct/renderers — untouched modules prove no ripple beyond fixtures)

### Feature Validation

- [ ] All Success Criteria cases pass (raw-not-label, fallback, text, cleared, digestSince)
- [ ] from/to/signature behavior unchanged (no entry added/removed in existing tests)

### Code Quality Validation

- [ ] `.js` ESM import suffixes (no new imports anyway)
- [ ] Mode A JSDoc on DiffEntry per contract
- [ ] One consistent spelling of the absent-value case across code and literals

### Documentation & Deployment

- [ ] JSDoc names the consumer (P1.M5.T1.S1 replaySubmission) and the legacy-tolerance boundary
- [ ] No new env vars, config keys, or events

---

## Anti-Patterns to Avoid

- ❌ Don't change `to`/`from` to raw values — labels stay (renderers, user-only card, delta line all depend on them)
- ❌ Don't touch the answerSignature predicate — change semantics are frozen
- ❌ Don't add `fromValue`/`text`/`at` fields "for completeness" — the contract names exactly one field
- ❌ Don't edit reconstruct.ts/delivery.ts logic in this item — reconstruction flip is P1.M5.T1.S1; delivery is type-flow only
- ❌ Don't make `value` required — pre-change history in old sessions has no value; optionality IS the legacy tolerance
- ❌ Don't skip updating a failing exact-match fixture by loosening to toMatchObject — keep toEqual exactness

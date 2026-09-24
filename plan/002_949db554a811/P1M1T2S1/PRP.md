# PRP — P1.M1.T2.S1: ✎ {text} in diff surfaces: snapshots.answerSummary, delivery.completionAnswerSummary, renderers card line

## Goal

**Feature Goal**: Implement FR-D3 / spec h2.42 + h2.38 display half for WRITE-IN answers: when `answer.custom === true` (delivered by P1.M1.T1.S1), both answer-summary helpers render `✎ {answer.value}` instead of doing a label/option lookup. Diff `from`/`to` entries, the diff card line, and the completion record answer lines all show the ✎-prefixed write-in text; collapsed views truncate to fit via the existing renderer helpers; `expanded` shows the full text.

**Deliverable**: Modified `src/snapshots.ts` (`answerSummary` ✎ branch + docblock), `src/delivery.ts` (`completionAnswerSummary` ✎ branch + sync docblock), `src/renderers.ts` (doc comment only, if that), plus tests in `snapshots.test.ts`, `delivery.test.ts`, `renderers.test.ts`. Pure formatting — mock nothing.

**Success Definition**:
- `npm run typecheck` + full vitest suite green
- A custom answer (`{ value: "my own text", custom: true }`) on a choice question produces diff `from`/`to` of `✎ my own text` (no option-label lookup, no raw-value ambiguity)
- The user-only card line renders `Title: old → ✎ my own text`; collapsed truncates via `truncateToWidth`, expanded shows full text
- `completionAnswerSummary` returns `✎ my own text` for the same answer (no drift from snapshots' rule)
- The sync comment between the two helpers stays true and both docblocks document the ✎ branch (Mode A)

## Why

WRITEIN-001 (core commitment 6, h2.42): a write-in's committed text IS the answer, and "renderers, diff cards, and the completion record display write-ins as `✎ {text}`". The data layer (S1) carries `custom`; without this subtask every write-in renders as a bogus option-value string in the delta the MODEL reads (via `details.changed`) and in the cards the USER reads — indistinguishable from a real option value. Both summary helpers are display chokepoints (`snapshots.ts answerSummary` feeds `DiffEntry.from/to` and thus submission `details`; `delivery.ts completionAnswerSummary` feeds the completion record). They are intentional duplicates; BOTH must gain the branch in tandem or they drift.

## What

1. `src/snapshots.ts` `answerSummary` (:124): before the choice/text dispatch, `if (answer.custom === true)` → summary = `` `✎ ${answer.value}` `` (bypass the option-label lookup entirely). Keep the existing NEW-003 elaboration suffix (` — ${answer.text}` when present and non-blank) AFTER the ✎ summary, same grammar.
2. `src/delivery.ts` `completionAnswerSummary` (:269): same branch — `if (answer.custom === true) return `✎ ${answer.value}`;` placed after the `answer === undefined` guard, before the choice lookup. This helper has NO text-suffix today; add ONLY the ✎ branch.
3. `src/renderers.ts` card entry line (:171): **no logic change needed** — `from`/`to` come from `DiffEntry` (answerSummary output); collapsed already truncates via `truncateToWidth(line, COLLAPSED_LINE_BUDGET)` (ANSI-aware) and `expanded` never truncates (full write-in text). Update the renderer's doc comment to note write-ins arrive pre-prefixed as `✎ {text}` from the summary layer.
4. Mode A JSDoc on BOTH helpers: document the ✎ write-in branch (`custom: true` → `✎ {value}`, never checked against option lists) and keep/refresh the "duplicated by design / this comment is the sync reference" contract — the two rules must remain byte-equivalent in behavior.

### Success Criteria

- [ ] `answerSummary({type:"choice", options:[...], answer:{value:"not-an-option", custom:true, at}})` → `✎ not-an-option` (label lookup bypassed)
- [ ] Same with `answer.text: "because"` → `✎ not-an-option — because` (NEW-003 grammar preserved)
- [ ] Non-custom answers byte-identical to before (regression: existing summary/diff tests untouched and green)
- [ ] `completionAnswerSummary` custom → `✎ not-an-option`; choice-label and text paths regression-green
- [ ] Diff card line for a custom answer contains `✎ `; collapsed line obeys `COLLAPSED_LINE_BUDGET`; expanded shows the full text
- [ ] `answerSignature` (snapshots.ts:110) NOT modified — change detection uses `value\u0000text`, unaffected by custom
- [ ] Both docblocks updated; sync comment still names both helpers

## All Needed Context

### Context Completeness Check

Repo fully implemented (930+ green tests); P1.M1.T1.S1 delivers `QuestionAnswer.custom?: boolean` end-to-end (schema → applyAnswer → serialize → revive) — its PRP is the contract. This PRP cites the exact current code of all three touchpoints; an agent needs only this PRP plus the named files.

### Documentation & References

```yaml
- file: plan/002_949db554a811/P1M1T1S1/PRP.md
  why: "CONTRACT: answer.custom lands in QuestionAnswer (state.ts:42-49), round-trips through narrowAnswer/applyAnswer/serialize/revive; downstream can rely on q.answer.custom === true"
  gotcha: applyAnswer spreads { ...answer } — custom already flows into state with no further change

- file: plan/002_949db554a811/P1M1T2S1/research/notes.md
  why: verified line-by-line excerpts of all three touchpoints + decided branch semantics + test plan

- file: src/snapshots.ts
  why: "answerSummary at :124-139 (label-preferred choice, raw text, NEW-003 ` — {text}` suffix, NO truncation); consumed by computeDiff :193-194 (DiffEntry.from/to)"
  pattern: "add the custom branch FIRST in the summary computation, before the choice/text ternary"
  gotcha: "answerSignature (:110-116) is change-detection, not display — do NOT touch; summaries never truncate (JSDoc rule; truncation is the renderer's job)"

- file: src/delivery.ts
  why: "completionAnswerSummary at :269-276; docblock :264-268 IS the sync comment ('Duplicated by design... do NOT import the private') — keep it true"
  gotcha: "no elaboration suffix in this helper (h2.49 record handles free text at line assembly) — add ONLY the ✎ branch"

- file: src/renderers.ts
  why: "card entry line at :171 (`${INDENT}${title}: ${from} → ${to}`); collapsed truncates via truncateToWidth(line, COLLAPSED_LINE_BUDGET), expanded shows the full line"
  pattern: "no logic change — from/to already carry whatever answerSummary produced; doc comment only"
  gotcha: "truncateToWidth is ANSI-aware and runs AFTER theme composition — never String.slice"

- docfile: spec h2.42 (answer shape), h2.38 (Renderers: 'write-in answers render as ✎ {text} (truncated to fit); expanded shows full write-in text'), h2.10 AC-2a (card and delta render ✎ {text}) — in this PRP's task prompt
```

### Current Codebase tree (relevant excerpt)

```bash
src/
├── snapshots.ts       # MODIFY: answerSummary ✎ branch + docblock
├── delivery.ts        # MODIFY: completionAnswerSummary ✎ branch + sync docblock
├── renderers.ts       # doc comment only (line flows from DiffEntry)
├── snapshots.test.ts  # ADD: custom-answer summary/diff tests
├── delivery.test.ts   # ADD: completionAnswerSummary custom tests
└── renderers.test.ts  # ADD: card-line ✎ assertion (collapsed + expanded)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: BOTH helpers gain the branch in the SAME changeset — they are
//   intentional duplicates joined by the sync comment; updating one drifts the
//   diff card against the completion record.
// CRITICAL: summaries NEVER truncate — "✎ truncated to fit" is delivered by
//   renderers.ts's existing truncateToWidth on the composed line; do not add
//   truncation to snapshots/delivery.
// GOTCHA: branch placement — after the undefined-answer guard, BEFORE the
//   choice ternary, so a custom answer whose value happens to equal a real
//   option value still renders as ✎ write-in.
// GOTCHA: use `answer.custom === true` (strict), matching S1's reviveQuestion
//   convention — legacy payloads lack the key entirely.
// GOTCHA: the "✎ " prefix is two chars (U+2712 + space) — use the literal
//   "✎ " consistently across both helpers and tests.
// GOTCHA: do NOT add `custom` to answerSignature (snapshots.ts:110) — it keys
//   changed-detection on value+text only, by design.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: src/snapshots.ts — answerSummary ✎ branch
  - Inside answerSummary (:124), after `if (q === undefined || answer === undefined) return UNANSWERED;`:
      if (answer.custom === true) {
        // WRITEIN-001 (h2.42): value holds free text — ✎ prefix, never an option lookup
        const base = `✎ ${answer.value}`;
        if (typeof answer.text === "string" && answer.text.trim() !== "") return `${base} — ${answer.text}`;
        return base;
      }
  - UPDATE the docblock (:117-123): add the ✎ write-in branch line + keep "no truncation" rule
  - REGRESSION: choice-label, text, unanswered, NEW-003 suffix paths unchanged

Task 2: src/delivery.ts — completionAnswerSummary ✎ branch
  - After the `answer === undefined` guard (:271):
      if (answer.custom === true) return `✎ ${answer.value}`;   // WRITEIN-001 (h2.42)
  - UPDATE the sync docblock (:264-268): note BOTH rules now share the ✎ branch;
    the comment remains the sync reference (Mode A)

Task 3: src/renderers.ts — doc comment only
  - Renderer doc (~:35-50 or the card-line comment): note diff from/to for
    write-ins arrive pre-prefixed as `✎ {text}` from the summary layer;
    collapsed truncation via truncateToWidth already satisfies "truncated to fit";
    expanded shows full text. NO logic change.

Task 4: tests
  - snapshots.test.ts (ADD, follow existing describe/test style):
    * custom answer on choice q → summary/diff to === "✎ my own text" (build a diff via
      computeDiff or the helper if exported — it is module-private, so assert via
      computeDiff's DiffEntry.from/to like existing tests do)
    * custom + text → "✎ my own text — because"
    * custom value equal to a REAL option value → still "✎ …" (lookup bypassed)
    * non-custom regression: existing tests stay green untouched
  - delivery.test.ts (ADD): completionAnswerSummary path via buildCompletion output —
    a custom answer line reads "✎ my own text"; choice-label regression intact
    (if the helper is private, assert through the completion record content, existing pattern)
  - renderers.test.ts (ADD): card line for a custom diff entry contains "✎ ";
    collapsed variant width ≤ COLLAPSED_LINE_BUDGET (or reuse existing truncation test pattern);
    expanded variant contains the FULL text

Task 5: RUN gates
  - npm run typecheck && npm test
```

### Implementation Patterns & Key Details

```ts
// The branch (identical rule in BOTH helpers — the sync comment joins them):
// snapshots.answerSummary (with NEW-003 suffix):
if (answer.custom === true) {
  const base = `✎ ${answer.value}`;
  return typeof answer.text === "string" && answer.text.trim() !== ""
    ? `${base} — ${answer.text}` : base;
}
// delivery.completionAnswerSummary (no suffix there — record handles free text):
if (answer.custom === true) return `✎ ${answer.value}`;
// PATTERN: strict `=== true` (legacy payloads lack the key).
// CRITICAL: placement BEFORE the choice ternary — custom wins even if the
// value collides with a real option value.
```

### Integration Points

```yaml
UPSTREAM (contract): "P1.M1.T1.S1 delivers answer.custom through schema/state/revive — consume, do not re-add"
DOWNSTREAM:
  - P1.M1.T2.S2 (read results, completion record lines, recap card, fallback digest): "consumes these same summary rules — keep behavior byte-compatible"
  - P2.M1.T1.S1 (auto-submit flash/submission tests): "will assert these ✎ strings — do not change the '✎ ' literal"
NO CHANGES to: state.ts, tool-schema.ts, fallback.ts, panel/*, answerSignature, truncation helpers
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run src/snapshots.test.ts src/delivery.test.ts src/renderers.test.ts -v
npm test    # full suite green
```

### Level 3: Behavioral probe (pure formatting — quick tsx check)

```bash
npx tsx -e "
import { InterrogationState, createInterrogationState } from './src/state.js';
// seed a choice question, applyAnswer with custom:true, run the diff/completion
// path and print the from/to + completion line; expect '✎ my own text'.
"   # adapt to actual export names; assertion: the ✎ literal appears, no option lookup ran
```

### Level 4: Domain validation

- [ ] Both docblocks document the ✎ branch; the sync comment still names both helpers
- [ ] `grep -n "✎" src/snapshots.ts src/delivery.ts` shows the branch in both, and nowhere a truncation of the ✎ text in the summary layer

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green
- [ ] `✎ {value}` renders for custom answers in DiffEntry.from/to, card line, completion record line
- [ ] Elaboration suffix composes `✎ v — text` (snapshots only, NEW-003 grammar)
- [ ] Non-custom behavior byte-identical; answerSignature untouched; summaries still never truncate
- [ ] Both helpers updated in tandem; sync docblocks true (Mode A)
- [ ] Only src/snapshots.ts, src/delivery.ts, src/renderers.ts (comment) + the three test files touched

## Anti-Patterns to Avoid

- ❌ Don't update one summary helper without the other — they are joined by the sync comment
- ❌ Don't add truncation to the summary layer — truncation is the renderer's job
- ❌ Don't run the option-label lookup before the custom check — a value collision must still show ✎
- ❌ Don't touch answerSignature or applyAnswer — custom already flows through (S1 contract)
- ❌ Don't add option-list validation for custom values — write-ins are accepted as-is (h2.42)
- ❌ Don't change the "✎ " literal — downstream tests (P2.M1.T1) assert it

---

**Confidence Score**: 9/10 — all three touchpoints read line-by-line against the working tree; the change is a pure-formatting branch with the S1 data contract verified; the only mild uncertainty is whether summaries are asserted directly or via computeDiff/buildCompletion outputs in the existing tests (both paths specified above).

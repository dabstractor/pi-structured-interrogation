---
name: "P1.M2.T1.S1 — Replace EXPLAIN_AFFORDANCE with the Other row; explicit digit-exclusion test (FR-D1)"
description: "Surgical rename/relabel in src/panel/short-view.ts: the `✎ explain…` affordance constant becomes `OTHER_AFFORDANCE = \"✎ Other — write your own\"` (verbatim from the Final strings ledger / h2.32), explainLine → otherLine, JSDoc rewritten (Mode A, cites WRITEIN-001). It remains the LAST row at cursor index options.length, fixed (not configurable), not digit-selectable. Behavior change: NONE — accept routing stays exactly as today (P1.M2.T2.S1). Update pinned-string tests in short-view.test.ts + panel.test.ts; add the explicit digit-exclusion test the spec demands (no state change, no answer applied)."
---

## Goal

**Feature Goal**: FR-D1 / WRITEIN-001 (h2.32, h2.58, h2.0 §6): every choice question's short-view options list ends in the synthetic write-in row `✎ Other — write your own`, occupying the cursor slot the old explain affordance held, with the digit-exclusion guarantee explicitly tested.

**Deliverable**: Modified `src/panel/short-view.ts` (const rename + label + function rename + Mode A JSDoc), comment-only touch in `src/panel/actions.ts` (`cursorDomainSize` doc), updated pinned strings in `src/panel/short-view.test.ts` + `src/panel/panel.test.ts`, and one new explicit digit-exclusion test in `src/panel/actions.test.ts`.

**Success Definition**: `npm test` + `npm run typecheck` green; the row renders `  ▸ ✎ Other — write your own` when focused (cursor index `options.length`) and dimmed otherwise; `digit(panel, n)` for the Other row's index applies NO answer and changes NO state (explicit test); no behavioral change to cursor domain, navigation, or accept.

## User Persona

**Target User**: TUI user answering choice questions — the Other row is the visible write-in escape hatch ("a hand-written answer ships BY ITSELF", WRITEIN-001).

**Use Case**: User scans options; none fit; the cursor lands on the `✎ Other — write your own` last row (accept routing to the write-in editor arrives in P1.M2.T2.S1).

**Pain Points Addressed**: The old label lied — `✎ explain…` implied the editor was an elaboration surface only; WRITEIN-001 makes that slot the write-in answer surface and requires the label to say so unambiguously ("the two answer-side duties are entered by different, visibly labeled paths").

## Why

- h2.32 (WRITEIN-001): "accepting the synthetic `✎ Other — write your own` row (the LAST row of every choice question's options list, cursor index `options.length` — the same slot the old explain affordance occupied; fixed, not configurable, not digit-selectable)".
- h2.36 hotkey table: quick-select `1–9` is "REAL options only (never the Other row)" — hence the explicit exclusion test.
- This is the display leaf that P1.M2.T2.S1 (accept routing), P1.M2.T3.S1 (duty-follows-cursor), and P1.M2.T6.S1 (deep view) build on; landing the stable label + cursor semantics first keeps those items diff-minimal.

## What

### 1. `src/panel/short-view.ts`

- :64: `const EXPLAIN_AFFORDANCE = "✎ explain…";` → `const OTHER_AFFORDANCE = "✎ Other — write your own";`
  - Verbatim label — do not re-punctuate; note the em-dash `—` (U+2014) and the ellipsis is GONE.
  - Mode A JSDoc above it: "The synthetic write-in row (WRITEIN-001, FR-D1): every choice question's options list ends here; accepting it (P1.M2.T2.S1) makes the embedded editor the WRITE-IN surface whose committed text IS the answer (`custom: true`). Fixed label — deliberately NOT configurable and NOT digit-selectable (h2.32/h2.36); replaces the retired `✎ explain…` explain affordance, which moved to the elaboration duty (`ctrl+t`, P1.M2.T3.S1)."
- :214–224: rename `explainLine` → `otherLine` (same params/return/logic — only the label constant and docblock change). Update its docblock: it renders the Other row at cursor index `optionCount`; focus BEHAVIOR (write-in duty) is P1.M2.T2.S1.
- :167: update the call site name; pass args unchanged (`options.length, cursorIndex, theme, dimAll`).
- :4 and :132 docblocks: replace `✎ explain…` mentions with the Other row (one sentence each).

### 2. `src/panel/actions.ts` — comments only

- `cursorDomainSize` docblock (:122–125): "last index = the ✎ explain affordance" → "last index = the synthetic ✎ Other write-in row (WRITEIN-001)". NO logic change — the function already returns `options.length + 1`.
- `digit()` docblock (:187 area): mentions "the ✎ affordance is NOT digit-selectable" → name the Other row explicitly. NO logic change.

### 3. Tests

- `src/panel/short-view.test.ts`:
  - :7 docblock, :171 → `["  ▸ ✎ Other — write your own"]`, :172 → `["    ✎ Other — write your own"]`, :178 describe title, :184, :188 — replace the pinned string everywhere it appears (grep `explain…` to catch stragglers).
- `src/panel/panel.test.ts` :455: `l.includes("✎ explain…")` → `l.includes("✎ Other — write your own")`.
- `src/panel/actions.test.ts` — ADD the explicit digit-exclusion test the spec demands (beyond the existing `false`-return checks at :360–366):

```ts
test("digit_never_selects_the_other_row_no_state_change (FR-D1)", () => {
  // build panel with 2-option choice question q, answered by digit before/after
  const before = panel.state.serialize();
  const ok = digit(panel, 3);            // 3 = one past the 2 real options = the Other row
  expect(ok).toBe(false);
  expect(digit(panel, 9)).toBe(false);
  expect(panel.state.serialize()).toEqual(before);   // NO answer applied, no status change
  const q = panel.state.getQuestion("q");            // (match your fixture's id)
  expect(q?.answer).toBeUndefined();                 // nothing answered via digits
});
```

  Follow the existing fixture style in the `digit — quick-select (R5)` describe (:350); reuse its panel builder rather than inventing a new one.

### Explicitly OUT of scope (guard rails)

- Accept/enter behavior at the Other index — UNCHANGED this item (P1.M2.T2.S1 rewires it to write-in duty; today it opens the explain field, and that stays).
- Editor duties, region labels, ctrl+t semantics (P1.M2.T3.S1); deep view Other section (P1.M2.T6.S1); two-stage removal (P1.M2.T4).
- `✎ {text}` ANSWER rendering — already handled by P1.M1.T2.S1/S2 (parallel; different files).

### Success Criteria

- [ ] Label byte-exact `✎ Other — write your own` everywhere it renders
- [ ] Cursor semantics unchanged: `cursorDomainSize` still options+1; focused row shows `▸ ` prefix at `cursorIndex === options.length`; dimmed otherwise; `dimAll` respected
- [ ] New digit-exclusion test asserts `false` return AND no state change; existing suite green
- [ ] No new exports; `OTHER_AFFORDANCE` stays module-private; no logic lines touched in actions.ts
- [ ] grep `explain…` across src/ returns zero hits afterward

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets: every line to touch (by line number, verified today), the verbatim label, the JSDoc text to write, the exact new test, and the scope fence listing everything NOT to change. No guessing.

### Documentation & References

```yaml
- file: src/panel/short-view.ts
  why: the only source change — :64 const, :167 call site, :214-224 explainLine, :4/:132 docblocks
  pattern: keep explainLine/otherLine logic byte-identical apart from the constant name
  gotcha: label uses em-dash U+2014 with spaces; NO trailing ellipsis (the old label had "…")

- file: src/panel/actions.ts
  why: cursorDomainSize (:122-125) and digit (:187-197) — COMMENT-ONLY updates; logic already correct
  gotcha: do not touch any code line; the exclusion `n - 1 >= (q.options?.length ?? 0)` already guards

- file: src/panel/short-view.test.ts
  why: pinned strings at :7, :171, :172, :178, :184, :188; render(q, cursorIndex) helper convention
- file: src/panel/panel.test.ts
  why: :455 substring assertion on the short-view region
- file: src/panel/actions.test.ts
  why: :350-366 existing digit describe — fixture pattern to reuse for the new explicit test

- file: plan/002_949db554a811/prd_snapshot.md (h2.32, h2.36, h2.58 WRITEIN-001, h2.0 §6, h2.10 AC-2a)
  why: verbatim label + "fixed, not configurable, not digit-selectable" contract
- file: plan/002_949db554a811/P1M1T2S2/PRP.md
  why: parallel sibling (✎ {text} answer display in results/delivery/renderers) — different files, no overlap; do not duplicate
```

### Current Codebase tree (relevant slice)

```bash
src/panel/ short-view.ts actions.ts (+ short-view.test.ts actions.test.ts panel.test.ts)
```

### Desired Codebase tree

```bash
# no new files — modifications only
src/panel/short-view.ts   # OTHER_AFFORDANCE + otherLine + Mode A JSDoc
src/panel/actions.ts      # comment-only (cursorDomainSize, digit docblocks)
src/panel/short-view.test.ts src/panel/panel.test.ts src/panel/actions.test.ts  # pinned strings + new test
```

### Known Gotchas of our codebase & Library Quirks

```ts
// The em-dash in the label matters — byte-exact tests will fail on a hyphen
// explainLine's focus logic is correct AS-IS; a "helpful" rewrite risks regressing dimAll/cursor edge cases
// grep for "explain…" AFTER the edit — it must be zero hits in src/ (docs outside src are not this item's concern)
// do NOT export OTHER_AFFORDANCE — deep view (P1.M2.T6.S1) will import or re-declare its own; exporting now invites coupling before the consumer's shape is settled
// panel.test.ts:455 is a substring check — keep it substring-style (row may be dimmed/prefixed in context)
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: UPDATE src/panel/short-view.test.ts + panel.test.ts FIRST (TDD)
  - replace pinned "✎ explain…" strings with "✎ Other — write your own"; run vitest → must FAIL

Task 2: MODIFY src/panel/short-view.ts
  - rename const + label + explainLine→otherLine + docblocks (verbatim JSDoc from What §1)

Task 3: MODIFY src/panel/actions.ts comments (cursorDomainSize, digit docblocks)

Task 4: ADD digit-exclusion test in src/panel/actions.test.ts (What §3 snippet, reuse :350 fixtures)

Task 5: GATES
  - grep -rn "explain…" src/ → zero hits
  - npx vitest run src/panel/short-view.test.ts src/panel/actions.test.ts src/panel/panel.test.ts
  - npm test && npm run typecheck
```

### Implementation Patterns & Key Details

```ts
// otherLine — logic identical to the current explainLine, label swapped:
function otherLine(optionCount: number, cursorIndex: number, theme: Theme, dimAll: boolean): string {
  const prefix = cursorIndex === optionCount ? CURSOR : BLANK;
  const content = `${prefix}${OTHER_AFFORDANCE}`;
  const focused = cursorIndex === optionCount && !dimAll;
  return `${INSET}${focused ? content : theme.fg("dim", content)}`;
}
```

### Integration Points

```yaml
DOWNSTREAM (do NOT implement):
  - P1.M2.T2.S1: accept routing — cursor index options.length → write-in duty (enter commits applyAnswer({value, custom:true}) + advance)
  - P1.M2.T3.S1: ctrl+t duty follows cursor-on-Other → write-in duty
  - P1.M2.T6.S1: deep view Other section (own label + verbatim ramification from h2.29)
CONFIG: none — the row is fixed by spec (not configurable), unlike hotkeys (R5 applies to keys, not this label)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npx vitest run src/panel/short-view.test.ts
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/actions.test.ts src/panel/panel.test.ts
npm test   # full suite — navigation/layout/keys tests must stay green (no logic change)
```

### Level 3: Integration Testing

Render-only change; covered by the panel test suite. Optional manual check: run pi with the extension linked, open the panel via /interrogate after an upsert, confirm the last row reads `✎ Other — write your own` and the cursor reaches it with ↓.

### Level 4: Domain Validation

grep gates: `grep -rn "explain…" src/` → 0 hits; `grep -rn "Other — write your own" src/ | wc -l` → source once + tests.

## Final Validation Checklist

- [ ] `npm test` + `npm run typecheck` green; `grep -rn "explain…" src/` empty
- [ ] Label byte-exact `✎ Other — write your own`; focused prefix `▸ `; dimmed variant; dimAll respected
- [ ] Cursor domain unchanged (options.length + 1); accept/navigation behavior unchanged
- [ ] Explicit digit-exclusion test: false return + zero state change + no answer applied
- [ ] Mode A JSDoc citing WRITEIN-001/FR-D1; actions.ts touched comments-only
- [ ] No new exports, no new files, no scope creep into duties/deep-view/two-stage

## Anti-Patterns to Avoid

- ❌ Don't change otherLine's rendering logic — label and names only
- ❌ Don't rewire accept/enter at the Other index — that's P1.M2.T2.S1 and changing it here breaks two-stage tests unexpectedly
- ❌ Don't make the label configurable — the spec pins it ("fixed, not configurable")
- ❌ Don't touch the answer-display `✎ {text}` plumbing — owned by P1.M1.T2.S1/S2
- ❌ Don't leave the old string in any docblock or test — the grep gate is part of done

---
name: "P1.M2.T1.S1 — Truncate the ✎ Other row label to the render budget (BUG-002, src/panel/short-view.ts)"
description: "Surgical fix: otherLine (~:289-300) gains a `budget: number` param (passed from renderShortViewOptions :220, which already computes `budget = width - INSET 2 - RIGHT 2`); the RAW OTHER_AFFORDANCE label is truncated via truncateVisible BEFORE any theme.fg wrap — `truncateVisible(OTHER_AFFORDANCE, Math.max(1, budget - visibleWidth(prefix)))` — then the existing success/dim/focus coloring applies to the truncated string exactly as today. No change to OTHER_AFFORDANCE, prefix/cursor logic, or the write-in success rule. TDD: narrow-width tests at 10/20/30 following the :575-586 pattern; width-80 golden lines (:299-300) stay byte-identical. No mocks."
---

## Goal

**Feature Goal**: BUG-002 — every `renderShortViewOptions` line fits the terminal width, including the synthetic `✎ Other — write your own` row, restoring terminal-budget.ts's contract ("the renderers' existing truncation keeps every line inside the terminal") below ~32 columns.

**Deliverable**: Modified `src/panel/short-view.ts` (otherLine signature + call site + truncation) + tests in `src/panel/short-view.test.ts`.

**Success Definition**: `npm test` + `npm run typecheck` green; at widths 10/20/30 every returned line has `visibleWidth(line) ≤ w` with `…` present on truncated Other rows; the width-80 golden assertions (:299-300, :312, :316) pass byte-identical; the write-in success-colored variant also truncates; the dim/unfocused variant truncates.

## User Persona

**Target User**: TUI user on a narrow terminal (<60 cols: split panes, small SSH windows).

**Use Case**: Panel renders at width 20 → the Other row reads `  ▸ ✎ Other — wri…` instead of overflowing and letting pi-tui word-wrap it into extra rows that shift the panel layout.

**Pain Points Addressed**: The Other row is "an option row of the list and the one label that never truncates" — the unambiguous spec violation against ui-spec's sub-60-col fallback table.

## Why

- h3.1/BUG-002: the label is 28 visible cols + 4-col inset = 32; overflow verified at widths 1–20. Every sibling truncates (optionLine ~:252, textAffordanceLine ~:311).
- h2.5 rec: "Route otherLine's OTHER_AFFORDANCE label through truncateVisible with the same budget math as optionLine."
- pi-tui `Text` word-wraps overlong elements — overflow shifts layout on ultra-narrow terminals, breaking the fixed-row panel geometry.

## What

### 1. `src/panel/short-view.ts` — otherLine

Current (~:289-300): `otherLine(q, optionCount, cursorIndex, theme, dimAll)` builds `prefix`, wraps `OTHER_AFFORDANCE` in `theme.fg("success", …)` when `q.answer?.custom === true`, and never truncates.

Change:

1. Signature: add `budget: number` (place after `theme` to mirror textAffordanceLine's `(cursorIndex, theme, budget, dimAll)` ordering).
2. Call site (:220): `lines.push(otherLine(q, options.length, cursorIndex, theme, budget, dimAll));` — the budget already exists at :200 (`Math.max(1, width - INSET.length - RIGHT.length)`).
3. Body — truncate the RAW label BEFORE any theme.fg wrap (truncateVisible is ANSI-safe, but wrap-then-truncate would clip escape codes' content unpredictably and the success color must cover the final visible string):

```ts
const prefix = cursorIndex === optionCount ? CURSOR : BLANK;
const labelBudget = Math.max(1, budget - visibleWidth(prefix));
const raw = truncateVisible(OTHER_AFFORDANCE, labelBudget);
const label = q.answer?.custom === true ? theme.fg("success", raw) : raw;
const content = `${prefix}${label}`;
const focused = cursorIndex === optionCount && !dimAll;
return `${INSET}${focused ? content : theme.fg("dim", content)}`;
```

Note `INSET` is outside the budget math exactly as in optionLine (the caller's budget already excludes INSET+RIGHT — verify against optionLine's usage: its head is prefix+star and teaser, all inside `budget`; INSET is prepended at return, same here). UNCHANGED: `OTHER_AFFORDANCE` (:84, exported — do not touch), prefix/cursor logic, the success-color rule for write-in answers, the dim-unfocused rule, focus intensity.

### 2. Comment

One-line addition to otherLine's docblock: the label truncates to the caller's budget like every option row (ui-spec fallback table; BUG-002 fix) — color wraps the truncated string.

### 3. Tests — `src/panel/short-view.test.ts`, in/next to the `narrow width (h2.30 …)` describe (:575+), reusing its `render(q, cursor, theme, width)` + `visibleWidth` helpers; no mocks:

1. `other_row_truncates_at_widths_10_20_30` (TDD — fails at HEAD): choice question (short labels so the Other row is the longest line), `for (const w of [10, 20, 30])` → every line `visibleWidth(line) <= w`; the Other line contains `…` at each width; at width 30 the line is shorter than the full 32-col label.
2. `other_row_golden_lines_unchanged_at_width_80`: the existing byte-pins (:299-300 focused/unfocused full label, :312/:316 in the WRITEIN describe) already prove this — assert they still pass untouched (no edits to those assertions; if the local `render` fixture defaults to a width < 32, ensure the golden tests render at ≥ 36 — check the fixture's default width first; the current goldens pass at HEAD so the default is already wide enough — do not change it).
3. `writein_colored_other_row_also_truncates`: question with `{ value: "x", custom: true, at }` answer, width 20 → Other line `visibleWidth <= 20`, still contains the success color (assert via the test theme's marker or by stripping ANSI and checking content), truncated with `…`.
4. `truncation_preserves_prefix_and_focus_intensity`: width 20, cursor on the Other row → line starts with `  ▸ ` (INSET+CURSOR) and carries no dim marker (focused); same width, cursor elsewhere → dim variant, still `≤ 20`.

### 4. Explicitly OUT of scope

- The footer's sub-18-col minimal-form overflow (PRD calls it out but does not require it here — "the Other-row label is the unambiguous spec violation").
- BUG-003 (auto-submit flash), BUG-004 (index.ts comment) — P1.M2.T2/T3.
- Any change to OTHER_AFFORDANCE's string, deep-view's Other section, or overview rendering.

### Success Criteria

- [ ] Widths 10/20/30: every line ≤ width; Other row truncated with `…`; prefix/focus/dim/success semantics intact
- [ ] Width-80 goldens byte-identical (existing assertions untouched and green)
- [ ] Only otherLine + call site changed; OTHER_AFFORDANCE untouched; typecheck + full suite green

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets: the current otherLine body, the exact new body, the call-site line, the budget's provenance (:200), the truncate-before-color ordering rationale, and four enumerated tests with the fixture/helper names. No guessing.

### Documentation & References

```yaml
- file: src/panel/short-view.ts
  why: otherLine ~:289-300 (grep `otherLine(` for the live position — parallel M1 items may drift lines); call site :220; budget :200; optionLine's budget math ~:246-258 (the pattern to mirror); textAffordanceLine :310-312; OTHER_AFFORDANCE :84 (exported — DO NOT change)
  pattern: truncate the RAW string first, theme-wrap second — exactly optionLine's order (`truncateVisible(opt.label, …)` then `theme.fg("success", label)`)
  gotcha: budget already excludes INSET (2) + RIGHT (2); prefix (2 cols) IS inside the budget math (`budget - visibleWidth(prefix)`)

- file: src/panel/layout.ts
  why: truncateVisible (:158-163 per the contract note — grep `truncateVisible` for the live position) — ANSI/ellipsis-safe; also visibleWidth helper
- file: src/panel/short-view.test.ts
  why: narrow-width describe :575-586 (render/visibleWidth/`…` conventions), golden byte-pins :299-300/:312/:316 (must stay green untouched), module docblock :7
- file: src/panel/terminal-budget.ts
  why: the width-safety contract this fix restores (its header states renderers' truncation keeps every line inside the terminal)
- file: plan/006_45773b259b06/bugfix/001_3e88fb340e1d/prd_snapshot.md (h2.3/h3.1 BUG-002, h2.5 rec 2)
  why: defect definition, repro (widths 10/20/30, 32-col overflow math), recommended fix
- file: plan/006_45773b259b06/bugfix/001_3e88fb340e1d/architecture/bug002-003-panel-render-flash.md
  why: §BUG-002 firsthand verification — no budget param, sibling math quoted
```

### Current Codebase tree (relevant slice)

```bash
src/panel/ short-view.ts layout.ts (+ short-view.test.ts)
```

### Desired Codebase tree

```bash
# no new files
src/panel/short-view.ts        # otherLine budget param + truncation + docblock line
src/panel/short-view.test.ts   # +4 narrow-width tests
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// truncate BEFORE theme.fg — truncateVisible is ANSI-safe but the success/dim color must wrap the FINAL visible string
// budget at :200 already excludes INSET+RIGHT; subtract only the prefix inside otherLine
// the :299-300 goldens depend on the test fixture's default render width being ≥ 36 — it passes at HEAD, don't touch the fixture
// OTHER_AFFORDANCE is exported and pinned byte-exact elsewhere — never edit the string
// em-dash + ellipsis are multi-byte UTF-8 but 1 visible col each via visibleWidth — trust the helpers, never String.length
// panel.render(width) at ultra-narrow widths also involves the footer (out of scope — 18-col minimal form overflow is a separate acknowledged non-goal)
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: WRITE the 4 tests (What §3) — truncation tests FAIL at HEAD; run npx vitest run src/panel/short-view.test.ts to confirm
Task 2: MODIFY src/panel/short-view.ts — otherLine signature/body + call site + docblock line (What §1-2)
Task 3: GATES
  - npm run typecheck
  - npx vitest run src/panel/short-view.test.ts
  - npm test
```

### Implementation Patterns & Key Details

```ts
// The entire logic change (see What §1): one param, one truncate, wrap order.
const labelBudget = Math.max(1, budget - visibleWidth(prefix));
const raw = truncateVisible(OTHER_AFFORDANCE, labelBudget);
```

### Integration Points

```yaml
DOWNSTREAM (do NOT implement):
  - P1.M3.T2.S2: README truncation-claims sweep documents this behavior
CONSUMERS: renderShortViewOptions only — deep-view/overview have their own Other rendering (untouched)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npx vitest run src/panel/short-view.test.ts
```

### Level 2: Unit Tests

```bash
npm test   # full suite — the parallel P1.M1.T1.S5 replay regression (snapshots/reconstruct/actions) shares no files with this item
```

### Level 3: Integration Testing

Renderer-pure change; the panel harness render tests (panel.test.ts layout assertions at narrow widths, if any) cover composition. Optional manual: link the extension, resize a pi pane to ~25 cols, open the panel, confirm the Other row shows `…` and the layout doesn't shift.

### Level 4: Domain Validation

Trace vs h3.1 repro: `panel.render(w)` for w ∈ [10, 20, 30] → every line `visibleWidth ≤ w`; the sibling comparison (long real option label truncates at the same widths) is already pinned by the :575 test family.

## Final Validation Checklist

- [ ] `npm test` + `npm run typecheck` green; existing goldens byte-identical
- [ ] Other row truncates at 10/20/30 with `…`; success/dim/focus/prefix semantics preserved on the truncated string
- [ ] Only otherLine + call site + tests touched; OTHER_AFFORDANCE string untouched
- [ ] TDD order followed (failing narrow-width tests first)

## Anti-Patterns to Avoid

- ❌ Don't wrap-then-truncate — truncate the raw label, then color the result
- ❌ Don't subtract INSET again inside otherLine — the caller's budget already excludes it
- ❌ Don't touch OTHER_AFFORDANCE, the footer, or the test fixture's default width
- ❌ Don't widen into deep-view/overview Other rendering — out of scope

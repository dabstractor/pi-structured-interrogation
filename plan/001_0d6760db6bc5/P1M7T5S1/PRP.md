# PRP — P1.M7.T5.S1: Adaptive rendering (<24 rows, <12 rows, <60 cols)

## Goal

**Feature Goal**: Implement h2.30 terminal fallbacks so the interrogation
panel remains usable on low-height remote sessions and narrow terminals:
height < 24 rows suppresses the hint line (deep view still available — it's a
full replacement); height < 12 rows makes the overview paginate 5 rows; width
< 60 columns truncates option labels with `…`, wraps ramifications, and shows
at most 2 footer keys (`submit`, `deep`).

**Deliverable**: A new pure module `src/panel/terminal-budget.ts` (threshold
table + budget computation), narrow-mode support in `layout.ts` renderFooter,
a viewport-height override in `overview.ts`, height-aware rendering and cache
invalidation in `panel.ts`, plus tests and a JSDoc threshold table [Mode A].

**Success Definition**: All threshold rules apply automatically at render
time from live terminal dimensions, resize is picked up without new event
plumbing, all existing tests still pass, and new tests cover each threshold
boundary (24/23, 12/11, 60/59).

## Why

- h2.5/h2.6: low-height remote sessions (SSH over small terminals) must
  remain usable — the panel must never demand more rows than the terminal has
  for its critical content.
- The existing constants (`OVERVIEW_HEIGHT = 20`, `DEEP_VIEW_HEIGHT = 20`)
  were explicitly left as placeholders: both modules' JSDoc say "P1.M7.T5.S1
  owns any dynamic sizing." This task is that designed seam.

## What

User-visible behavior (from h2.30, authoritative):

| Condition | Rule |
|---|---|
| rows < 24 | Hint line (first sentence of description) suppressed in the short view. Deep view unaffected (full replacement, always available). |
| rows < 12 | Overview list viewport paginates 5 rows (scroll window height = 5 content lines). Cursor-row-always-visible clamping still applies. |
| cols < 60 | Option labels truncate with `…`; ramifications wrap (already true in deep view — verify); footer shows max 2 keys: `submit` and `deep` (config-resolved labels). |

### Success Criteria

- [ ] `terminalBudget(width, rows)` pure function returns the fallback flags
      for any (width, rows) including 0/undefined (safe defaults).
- [ ] Short view at rows=23 renders no hint line; at rows=24 it does.
- [ ] Overview at rows=11 shows a 5-line content window; at rows=12 the
      default `OVERVIEW_HEIGHT` window.
- [ ] Footer at width=59 contains exactly the `submit` and `deep` hints
      (labels from `resolveKeyLabels(config)`); at width=60 the normal
      per-screen hints.
- [ ] Terminal resize (rows change) invalidates the panel render cache —
      `render(width)` re-reads rows each call.
- [ ] JSDoc threshold table [Mode A] in `terminal-budget.ts`.
- [ ] `npm test` green; no regressions in panel/layout/overview suites.

## All Needed Context

### Context Completeness Check

An implementer who knows nothing about this codebase can implement from this
PRP: it names every file, function, line region, seam, and test convention
below. Verified against the live source on this branch.

### Documentation & References

```yaml
- file: src/panel/panel.ts
  why: render cache + buildLines composition point
  pattern: "render(width) at ~line 505: `if (this.cached !== undefined && width === this.lastWidth) return this.cached;` — add lastRows to the cache key. buildLines(width) at ~line 937: short branch emits `renderHintLine(current, ...)` at ~line 967 (suppress here); overview branch at ~line 1020 slices `content.lines` using `content.viewportHeight` (override here). Panel already stores `this.tui` (~line 440)."
  gotcha: "Height source: `this.tui.terminal.rows` (TuiBase.terminal: Terminal with `get rows()`). Read it defensively — `this.tui.terminal?.rows` — treat undefined/0 as unlimited (use Infinity thresholds → no fallbacks)."

- file: src/panel/layout.ts
  why: pure renderers; renderHintLine + renderFooter
  pattern: "renderHintLine already returns [] when no description — the suppression hook is the CALL SITE in panel.buildLines, keep layout.ts pure. renderFooter (~line 466) drops hints right-to-left via SCREEN_KEYS; SCREEN_KEYS.short = [\"deep\",\"overview\",\"submit\"] means submit drops FIRST — wrong for h2.30."
  gotcha: "Add an optional `narrow?: boolean` (or `maxHints?: number`) param to renderFooter: when narrow, filter hints to exactly the `submit` and `deep` KeyActions (config labels — NEVER hardcoded, h2.52) plus the screen's static enter/esc hints, THEN run the existing fit loop. Keep backward-compatible default."

- file: src/panel/overview.ts
  why: overview window height seam
  pattern: "buildOverviewContent({ordered, cursorIndex, theme, width}) returns {lines, questionRowLine, viewportHeight: OVERVIEW_HEIGHT}. Add optional `viewportHeight?: number` param defaulting to OVERVIEW_HEIGHT; clampOverviewScroll already uses content.viewportHeight so pagination follows automatically."
  gotcha: "viewportHeight must be >= 1 (Math.max(1, ...)) — a 0/undefined rows must never produce an empty window."

- file: src/panel/short-view.ts
  why: option label truncation at narrow width
  pattern: "renderShortViewOptions already truncates labels via truncateVisible into a width-2 budget. VERIFY at width 59: labels truncate with `…` and the `✎ explain…` affordance line fits. If labels already truncate, no code change needed here — only a test."

- file: src/panel/deep-view.ts
  why: ramification wrapping verification
  pattern: "Ramifications already word-wrap inside the pane (module's own wrap helper, indent 4). VERIFY at width 59 no line exceeds visibleWidth(width). DEEP_VIEW_HEIGHT stays 20 — deep view is a full replacement that scrolls; h2.30 does not shrink it."

- file: src/panel/panel.test.ts
  why: test conventions + mock tui
  pattern: "1528-line direct-construction test suite; mock tui object passed to InterrogationPanel. Extend the mock with `terminal: { rows: N, columns: M }` (structural typing suffices — TUI is imported as type-only in panel.ts). vitest (`npm test` = `vitest run`)."

- file: plan/001_0d6760db6bc5/architecture/pi-api-validation.md
  why: §Unknown 2 resolution — custom() height budget
  section: "line ~74: 'Non-overlay custom() height budget — probe at runtime; terminal fallbacks (h2.30) handle small sizes.' Resolution: read tui.terminal.rows per render (see notes.md)."
```

### Current Codebase tree (panel region only)

```bash
src/panel/
  panel.ts        # host: custom() lifecycle, render cache, buildLines(width)
  layout.ts       # pure renderers: header, question line, hint, footer, flash
  short-view.ts   # options region (labels truncate via truncateVisible)
  deep-view.ts    # DEEP_VIEW_HEIGHT=20 scrolling pane, wrapped ramifications
  overview.ts     # OVERVIEW_HEIGHT=20 window, cursor-always-visible clamp
  keys.ts, actions.ts, gate.ts, ripple-confirm.ts, text-field.ts, ...
  *.test.ts       # vitest, colocated
```

### Desired Codebase tree with files to be added

```bash
src/panel/
  terminal-budget.ts        # NEW — pure threshold table + TerminalBudget type
  terminal-budget.test.ts   # NEW — boundary tests (24/23, 12/11, 60/59, undefined)
  panel.ts                  # MODIFIED — rows read, cache key, hint suppression,
                            #            overview viewport override, narrow footer
  layout.ts                 # MODIFIED — renderFooter narrow param (back-compat)
  overview.ts               # MODIFIED — optional viewportHeight param
  layout.test.ts            # MODIFIED — narrow footer tests
  overview.test.ts          # MODIFIED — 5-row pagination tests
  panel.test.ts             # MODIFIED — height-aware render tests w/ mock terminal
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: panel render cache is keyed ONLY on width today (panel.ts ~505).
// A rows change with same width would serve stale tall output — add lastRows.
// CRITICAL: never hardcode key labels — resolveKeyLabels(config) (h2.52);
// footer hint words come from ACTION_WORDS + SCREEN_KEYS in layout.ts.
// CRITICAL: glyph widths are never 1 col — all truncation goes through
// truncateVisible/visibleWidth (ANSI + wide-char safe); never .slice() display text.
// GOTCHA: tui.terminal.rows may be undefined in odd environments — defensive
// optional chain, treat missing height as "no height fallbacks".
// GOTCHA: P1.M7.T4.S1 (src/detect.ts) is being implemented IN PARALLEL —
// do not touch src/detect.ts or anything round-detection related.
// GOTCHA: P1.M7.T5.S2 owns config-surface validation — do not touch config.ts
// beyond reading existing resolveKeyLabels.
```

## Implementation Blueprint

### Data model

```ts
// src/panel/terminal-budget.ts
/**
 * MODE A — TERMINAL FALLBACK THRESHOLD TABLE (h2.30, P1.M7.T5.S1)
 *
 * | Condition        | Fallback                                            |
 * |------------------|-----------------------------------------------------|
 * | rows < 24        | hint line suppressed (deep view unaffected — full   |
 * |                  | replacement, always available)                      |
 * | rows < 12        | overview viewport paginates 5 rows                  |
 * | cols < 60        | option labels truncate with …; ramifications wrap; |
 * |                  | footer shows max 2 keys: submit, deep               |
 *
 * Height source: tui.terminal.rows read per render (pi-api-validation.md
 * §Unknown 2 resolution). rows undefined/0 ⇒ no height fallbacks.
 */
export const HINT_SUPPRESS_ROWS = 24;
export const OVERVIEW_PAGINATE_ROWS = 12;
export const OVERVIEW_PAGE_SIZE = 5;
export const NARROW_COLS = 60;

export interface TerminalBudget {
  /** rows < 24 — suppress the short-view hint line. */
  suppressHint: boolean;
  /** rows < 12 — overview content window height (5), else undefined (default). */
  overviewViewportHeight: number;
  /** cols < 60 — narrow footer (submit+deep only), labels truncate harder. */
  narrow: boolean;
}

export function terminalBudget(width: number, rows: number | undefined): TerminalBudget;
// rows === undefined || rows <= 0 → suppressHint=false, overviewViewportHeight=Infinity/default, narrow still derived from width.
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/panel/terminal-budget.ts
  - IMPLEMENT: constants + TerminalBudget + terminalBudget(width, rows) pure fn
  - NAMING: exported UPPER_SNAKE constants, camelCase fn
  - PLACEMENT: src/panel/ next to layout.ts
  - JSDOC: threshold table [Mode A] (contract 5, DOCS requirement)

Task 2: CREATE src/panel/terminal-budget.test.ts
  - IMPLEMENT: boundary tests — (80,24) no suppress, (80,23) suppress;
    (80,12) default window, (80,11) window=5; (59,40) narrow, (60,40) not;
    (60,undefined) no height fallbacks; (0,0) no crash, narrow from width
  - FOLLOW pattern: layout.test.ts (vitest, describe/test/expect)

Task 3: MODIFY src/panel/layout.ts — renderFooter narrow mode
  - ADD optional param `narrow = false` to renderFooter (after labels? keep
    signature back-compat: append `narrow?: boolean` last)
  - WHEN narrow: build hints ONLY from KeyActions {submit, deep} for every
    ScreenKind (labels from the labels arg — never hardcoded), keep the
    screen's static hints (enter accept / esc back / ↑/↓ scroll) subject to
    the same right-to-left fit loop
  - PRESERVE: existing behavior verbatim when narrow=false (all current
    layout.test.ts tests must pass unchanged)
  - UPDATE renderFooter JSDoc with the h2.30 narrow rule

Task 4: MODIFY src/panel/overview.ts — viewport height override
  - ADD optional `viewportHeight?: number` to buildOverviewContent options
    (default OVERVIEW_HEIGHT; Math.max(1, ...))
  - Return it as content.viewportHeight (clampOverviewScroll already consumes it)
  - NO changes to clampOverviewScroll or cursor logic

Task 5: MODIFY src/panel/panel.ts — height-aware rendering
  - READ rows per render: `const rows = this.tui.terminal?.rows` inside
    render(width)/buildLines (add a private helper `currentRows()`)
  - CACHE KEY: extend `render(width)` guard to `width === this.lastWidth &&
    rows === this.lastRows` (new field lastRows, init undefined)
  - SHORT VIEW branch (buildLines ~line 966): compute budget via
    terminalBudget(width, rows); skip `renderHintLine` when suppressHint
  - OVERVIEW branch (~line 1030): pass `viewportHeight:
    budget.overviewViewportHeight` to buildOverviewContent when rows < 12
    (or always pass the value; default is OVERVIEW_HEIGHT)
  - FOOTER: pass `budget.narrow` to renderFooter in footerLine() (one call
    site, ~line 921 — computes budget once and threads it, or recompute)
  - DO NOT touch deep-view height (DEEP_VIEW_HEIGHT stays 20 — scrolls)

Task 6: MODIFY tests — layout.test.ts (narrow footer: exactly submit+deep
  labels present, overview/list hints absent at width 59; normal at 60),
  overview.test.ts (viewportHeight=5 window + cursor-always-visible at low
  rows), panel.test.ts (mock tui gains terminal:{rows,columns}; render at
  rows 23 → no hint line; rows 24 → hint; rows 11 + overview view → 5-line
  window; resize rows with same width → cache invalidated)
  - FOLLOW pattern: existing suites, identity theme stub, plain-JSON fixtures
  - NAMING: test("footer narrow: ...") / test("hint suppressed below 24 rows")

Task 7: VERIFY width < 60 label/ramification behavior (no code unless broken)
  - RUN existing suites; if short-view labels or deep-view ramifications
    produce lines exceeding visibleWidth(width) at width 59, add regression
    tests (they should already truncate/wrap — assert it)

### Implementation Patterns & Key Details

```ts
// panel.ts render cache (the ONLY stateful change):
render(width: number): string[] {
  const rows = this.currentRows();
  if (this.cached !== undefined && width === this.lastWidth && rows === this.lastRows) {
    return this.cached;
  }
  this.lastWidth = width;
  this.lastRows = rows;
  this.cached = this.buildLines(width);
  return this.cached;
}

// footer narrow filter (layout.ts): derive KeyActions first, map through labels
const narrowActions: KeyAction[] = ["submit", "deep"];
const hints = (narrow ? narrowActions : SCREEN_KEYS[screen])
  .map((a) => `${labels[a]} ${ACTION_WORDS[a]}`);
// then existing static-hint appends + right-to-left fit loop unchanged
```

### Integration Points

```yaml
NO new config, events, tool, or persistence changes. Pure rendering task.
PARALLEL SAFETY: do not modify src/detect.ts (P1.M7.T4.S1, in progress).
FUTURE: P1.M7.T6.S1 scripted ACs will assert these fallbacks — keep
terminalBudget exported and deterministic.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npx tsc --noEmit        # or the project's typecheck script (check package.json scripts)
npm test -- src/panel/terminal-budget.test.ts -v
# Expected: zero errors
```

### Level 2: Unit Tests

```bash
npm test -- src/panel/terminal-budget.test.ts src/panel/layout.test.ts src/panel/overview.test.ts src/panel/panel.test.ts
npm test        # FULL suite — no regressions across all 30+ test files
# Expected: all pass
```

### Level 3: Integration (manual, human-run)

Resize a real pi session running the panel: 24-row terminal (hint line gone,
ctrl+d deep view still full), 11-row terminal + ctrl+l (overview scrolls 5
rows at a time), 59-col terminal (footer shows only submit + deep; option
labels end with `…`). Document in the M7.T6 human runbook — not automatable
here.

## Final Validation Checklist

- [ ] `npm test` full suite green
- [ ] Threshold boundaries tested: 24/23, 12/11, 60/59
- [ ] rows undefined/0 → no height fallbacks, no crash
- [ ] Render cache invalidated on rows change
- [ ] Footer narrow uses resolveKeyLabels (no hardcoded labels)
- [ ] Deep view untouched by height rules (full replacement preserved)
- [ ] JSDoc threshold table [Mode A] present in terminal-budget.ts
- [ ] src/detect.ts and config.ts untouched

## Anti-Patterns to Avoid

- ❌ Don't subscribe to resize events — reading `tui.terminal.rows` per
  render is sufficient (TUI re-renders on resize).
- ❌ Don't hardcode "ctrl+d"/"ctrl+s" strings in the footer — labels come
  from resolveKeyLabels.
- ❌ Don't shrink DEEP_VIEW_HEIGHT — h2.30 explicitly keeps deep view full.
- ❌ Don't String.prototype.slice display text — truncateVisible only.
- ❌ Don't break renderFooter's existing signature/behavior for current
  callers (additive optional param only).

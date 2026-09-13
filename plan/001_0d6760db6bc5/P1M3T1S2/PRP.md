# PRP — P1.M3.T1.S2: Header, question line, footer with config-driven labels

## Goal

**Feature Goal**: Implement the three structural render lines of the interrogation panel (header, question line, footer) as pure, width-budgeted, config-driven render functions in a new `src/panel/layout.ts`, and wire them into the `InterrogationPanel` component produced by P1.M3.T1.S1, replacing its `"header (TODO S2)"` / `"question line (TODO S2)"` / `"footer (TODO S2)"` placeholder lines. Every display string naming a key is generated from resolved config via `resolveKeyLabels` — zero hardcoded key labels (h2.52, AC-12).

**Deliverable**: `src/panel/layout.ts` exporting `renderHeader`, `renderQuestionLine`, `renderHintLine`, `renderFooter`, plus a shared `truncateVisible` char-safe truncation helper and status-marker helper; modified `src/panel/panel.ts` (the S1 panel) to call them; `src/panel/layout.test.ts` with width-truncation, label-reflection, and ANSI-safety tests.

**Success Definition**: Given state + config, each render function returns exactly 1 line whose `visibleWidth` (ANSI-aware) ≤ the width budget; footer key labels change when config.keys changes (AC-12); goal truncates with ellipsis in header but is full-text available to the deep view (FR-30); all tests pass, typecheck clean.

## Why

The panel's persistent chrome is the user's orientation surface: goal (FR-30), current question + status markers, and progress + available keys (FR-10). Views built later (short P1.M3.T2, deep P1.M5.T1, overview P1.M5.T2) all sit *between* header and footer — those two lines plus the question line are the stable frame this task owns. Doing it now with exact width budgeting unblocks every subsequent view task with a verified contract.

## What

Per h2.29 layout (inset 2 from panel edge for content; header/footer span full render width):

1. **Header (1 line)**: `┌ interrogation · {goal} ── {statusCounts} ┐`
   - `statusCounts` = `"{answered}/{total} answered · {reasked} re-asked"` (subset of the h2.28 format — **no** moot, **no** epoch in the panel footer/header; those belong to the model-facing status line in `results.ts buildStatusLine`, which stays untouched).
   - Goal truncated with `…` to fit; full goal text exposed via a `goalFull` return so the deep view (M5.T1) can show it untruncated (FR-30).
   - Question/status markers and `interrogation` title dimmed/colored via `theme.fg` helpers (reference-patterns.md §3).
2. **Question line (1 line)**: `{group label} · Q{n}/{id} {title} [status markers]`
   - `n` = 1-based position in `state.order`; group label falls back to `"(none)"` via the existing `UNGROUPED_LABEL` convention in `state.ts`.
   - Status markers appended right-aligned: `⟳ re-asked`, `✎ text answer`, `⊘ moot` (+reason, dimmed), `⊗ withdrawn` — only the applicable ones. Markers are ANSI-wrapped so `visibleWidth` accounts correctly.
3. **Hint line (short form only)**: first sentence of `question.description`, dimmed (`theme.fg("dim", …)`), truncated with `…` to width. First sentence = text up to the first `. `, `?`, or `!` followed by a space/end, else whole description. Omitted entirely when no description.
4. **Footer (1 line)**: `└ {progress} · {key hints} ⏎ ┘` where progress = `"{answered}/{total} answered · {reasked} re-asked ·"` (trailing separator before key hints, per h2.29/FR-10) and key hints = the **3–4 keys relevant to the current screen**, labels from `resolveKeyLabels(config)`, e.g. short form: `enter accept · {deep} deep · {overview} list · {submit} submit`; deep view: `{submit} submit · esc back · ↑/↓ scroll`; overview: `enter jump · esc back`. Key hints are `"{label} {action}"` pairs joined by ` · `. If everything doesn't fit, drop key hints from the right (progress + ⏎ never dropped; at extreme widths degrade to progress only).
5. **Width budgeting**: every function takes `width: number` and produces ANSI-wrapped lines whose visible width ≤ `width` − inset where applicable (question line/hint inset 2 per questionnaire.ts pattern). Truncation is char-safe: use/replicate `truncateToWidth` + `visibleWidth` from `@earendil-works/pi-tui` utilities (reference-patterns.md §3, line 103) — never `String.slice` (breaks ANSI + wide chars).

### Success Criteria

- [ ] Header and footer each render exactly 1 line at every width ≥ 40 (below that, P1.M7.T5.T1's fallbacks handle it — this task only needs to not crash).
- [ ] Footer labels reflect `resolveKeyLabels(config)`; rebinding `keys.deep` to `ctrl+x` changes the rendered string (test asserts this — AC-12).
- [ ] Goal longer than available width truncates with a single `…`; never wraps to 2 lines.
- [ ] Question line shows group label, Q-position, id, title (truncated), and correct markers per question status.
- [ ] `renderHintLine` returns `[]` for missing description, 1 dimmed truncated line otherwise.
- [ ] Panel (S1 component) short view now renders real header/question/hint/footer lines around the still-placeholder options region (S1's options-region line remains for P1.M3.T2.S1 to replace).
- [ ] Chat/transcript visible above panel is preserved (non-overlay — S1 owns this; S2 must not change hosting). [AC-1]
- [ ] No hardcoded key label anywhere in new code (`grep -rn "ctrl+d\|ctrl+l\|ctrl+s" src/panel/layout.ts` returns nothing except in tests exercising config inputs).

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the S1 panel contract (what exists and what placeholders to replace), the config label API, the state/serialized shapes, the theme/width utility patterns, and the exact h2.29/h2.28/h2.52 string formats (all included in the selected PRD content above and below). All specified with file anchors.

### Documentation & References

```yaml
- file: plan/001_0d6760db6bc5/P1M3T1S1/PRP.md
  why: CONTRACT for the panel host/component this task plugs into
  pattern: InterrogationPanel class; render(width) returns string[]; placeholder lines "interrogation header (TODO S2)", "question line (TODO S2)", "footer (TODO S2)" to replace; theme + tui come from the custom() factory args (tui, theme, keybindings, done)
  gotcha: S1 is being implemented IN PARALLEL — do not modify panel.ts beyond replacing the three placeholder lines and threading theme/config into the component; keep render-cache behavior (invalidate clears cache) intact. If panel.ts's internals differ slightly from its PRP, adapt; the seam is the render(width) line assembly.

- file: src/config.ts
  why: InterrogatorConfig (keys: Record<KeyAction,string>) + resolveKeyLabels(config): Record<KeyAction,string> at line ~360 — THE source of every key display label (h2.52); labelFor normalizes to "Ctrl+Enter" style
  pattern: import { resolveKeyLabels, InterrogatorConfig, KeyAction } from "../config"
  gotcha: panel already receives `config` in OpenPanelOptions (S1) — thread it (or a memoized labels record) to the render functions; do NOT re-read settings per render

- file: src/results.ts
  why: buildStatusLine(state) lines ~87-105 — count semantics (answered counts status==="answered" only; total = state.order.length; skip orphan ids). Reuse the counting discipline for header/footer counts. DO NOT call buildStatusLine itself — panel format omits moot+epoch
  pattern: iterate state.order, look up state.questions[id], bucket by status

- file: src/state.ts
  why: Question/SerializedState shapes (lines 60-100: id, title?, prompt, description?, group?, status, answer?, rev); UNGROUPED_LABEL for group fallback; orderedQuestions()/groupSummaries()
  gotcha: question display title = `q.title ?? q.prompt` (title optional); goal is `state.goal` (readonly, max 400 chars by caps — still must truncate for narrow widths)

- file: plan/001_0d6760db6bc5/architecture/reference-patterns.md
  why: §3 (line ~103) theme + ANSI utilities: theme.fg("dim"/"accent"/"muted", s), theme.bold; visibleWidth(s), truncateToWidth(s, width) — char-safe truncation helpers; questionnaire.ts width budgeting: editor.render(Math.max(1, renderWidth - 2)), inset 2
  gotcha: marker glyphs (⟳ ✎ ⊘ ⊗ ★ ▸) can be double-width in some terminals — always measure with visibleWidth, never assume 1 char per glyph

- file: src/tool.ts (renderCallRow, line ~293)
  why: existing in-repo example of theme.fg + theme.bold usage for a colored one-line render — follow its style
```

### Current Codebase tree (relevant excerpt)

```bash
src/
  config.ts          # resolveKeyLabels, InterrogatorConfig  ← labels
  state.ts           # Question, SerializedState, UNGROUPED_LABEL
  results.ts         # buildStatusLine (count discipline reference)
  panel/             # NEW dir (created by P1.M3.T1.S1)
    panel.ts         # S1 host + InterrogationPanel  ← MODIFY placeholders
  *.test.ts          # vitest, colocated
```

### Desired Codebase tree with files added/modified

```bash
src/panel/
  panel.ts            # MODIFY: replace 3 placeholder lines with layout.ts calls
  layout.ts           # CREATE: pure render functions + helpers (this task's core)
  layout.test.ts      # CREATE: width/label/ANSI tests
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: never truncate with String.prototype.slice — ANSI escape sequences
// and wide glyphs break. Use truncateToWidth/visibleWidth from pi-tui (or
// local equivalents replicating them) — reference-patterns.md §3.
// CRITICAL: h2.52 — every display string naming a key comes from
// resolveKeyLabels(config). Even "enter accept" is exempt (enter is not
// remappable), but ctrl+d/l/s/t/etc. NEVER appear literally.
// GOTCHA: h2.28 status line and the panel footer are DIFFERENT formats sharing
// count semantics. results.ts buildStatusLine includes moot+epoch and is
// model-facing; the panel header/footer omit them. Don't "unify" them.
// GOTCHA: render functions must be PURE (state+config+theme+width → string)
// so P1.M3.T2/M5 views and tests can call them without a live panel.
// GOTCHA: theme helpers wrap strings in ANSI; compose truncation AFTER
// wrapping decisions — measure visibleWidth of unwrapped text, wrap the
// truncated result.
```

## Implementation Blueprint

### Data shapes

```ts
// src/panel/layout.ts (Mode A JSDoc on every export)
import type { InterrogatorConfig, KeyAction } from "../config";
import type { Question, SerializedState } from "../state";
import type { Theme } from "@earendil-works/pi-coding-agent"; // match S1's import path

export type ScreenKind = "short" | "deep" | "overview";

/** Keys relevant per screen (FR-10: 3–4 keys). Order = display order. */
export const SCREEN_KEYS: Record<ScreenKind, KeyAction[]> = {
  short:   ["deep", "overview", "submit"],
  deep:    ["submit", "overview"],        // + hardcoded-free "esc back · ↑/↓ scroll" static hints
  overview: ["submit", "deep"],
};

export interface HeaderRender {
  line: string;        // exactly 1 line, includes ┌ … ┐ borders
  goalFull: string;    // untruncated goal for the deep view (FR-30)
}

export function renderHeader(state: SerializedState, theme: Theme, width: number): HeaderRender;
export function renderQuestionLine(q: Question, position: number, theme: Theme, width: number): string;
export function renderHintLine(q: Question, theme: Theme, width: number): string[]; // [] when no description
export function renderFooter(state: SerializedState, screen: ScreenKind,
                             labels: Record<KeyAction, string>, theme: Theme, width: number): string;

/** Char-safe truncate with ellipsis; ANSI-aware. */
export function truncateVisible(text: string, maxWidth: number): string;
/** Status marker fragment for the question line right side, e.g. " ⟳ re-asked". */
export function statusMarkers(q: Question, theme: Theme): string;
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/panel/layout.ts
  - IMPLEMENT: truncateVisible (visibleWidth-aware, appends "…" when cut), statusMarkers, renderHeader, renderQuestionLine, renderHintLine, renderFooter, firstSentence helper
  - FOLLOW pattern: src/tool.ts renderCallRow (theme.fg + theme.bold composition); width math from reference-patterns.md questionnaire inset-2
  - NAMING: renderX functions, SCREEN_KEYS const, ScreenKind union
  - CONTRACT: pure functions; JSDoc (Mode A) on layout budget rules (header/footer = exactly 1 line each at any width ≥ 40; goal/hints truncate right-to-left: drop key hints first, then goal chars)
  - PLACEMENT: src/panel/layout.ts

Task 2: MODIFY src/panel/panel.ts
  - REPLACE the three S1 placeholder lines ("interrogation header (TODO S2)", "question line (TODO S2)", "footer (TODO S2)") with real calls: renderHeader(...).line, renderQuestionLine(currentQuestion, position, theme, width), renderHintLine(...), renderFooter(state, this.view, labels, theme, width)
  - ADD: memoize `labels = resolveKeyLabels(config)` once at panel construction (config available via OpenPanelOptions); store `theme` from factory args if S1 didn't
  - PRESERVE: S1 render cache + invalidate + handleInput seams; options-region placeholder line for P1.M3.T2.S1; deep/overview placeholders
  - GOTCHA: current question lookup via state.orderedQuestions() and this.currentId; position = index in state.order + 1; panel re-reads state on render (S1 contract — state is source of truth)

Task 3: CREATE src/panel/layout.test.ts
  - IMPLEMENT: vitest tests (follow src/config.test.ts / src/results.test.ts conventions, stub theme per src/tool.test.ts:81 pattern returning input strings)
  - CASES: (a) header fits at width 80 with goal; (b) long goal truncates with single …, goalFull preserved; (c) footer labels change when config.keys rebound (AC-12); (d) footer drops key hints at narrow widths before dropping progress; (e) question line markers per status incl. moot+reason dimmed; (f) hint line first-sentence extraction + [] when no description; (g) every output line visibleWidth ≤ requested width for widths 40/60/80/120; (h) empty state 0/0 counts
  - NAMING: test("renderHeader …") style matching existing tests
  - PLACEMENT: src/panel/layout.test.ts
```

### Implementation Patterns & Key Details

```ts
// Header budgeting sketch
export function renderHeader(state, theme, width): HeaderRender {
  // inner = width - 2 (the ┌ ┐ corners). Count segments left→right:
  // "┌ interrogation · " + goal + " ── " + counts + " ┐"
  // Priority: counts NEVER truncate; goal absorbs all shrinkage; if goal
  // budget < 1 char, render "…" only; if even title doesn't fit (width < ~30),
  // fall back to "┌ interrogation ┐" without counts (still 1 line).
  const counts = `${answered}/${total} answered · ${reasked} re-asked`;
  const fixed = `┌ interrogation · ${" ── " + counts} ┐`;
  const goalBudget = width - visibleWidth(fixed) - 2;
  const goalTxt = truncateVisible(state.goal, Math.max(1, goalBudget));
  ...
}

// Footer priority: progress line is sacred; key hints dropped right-to-left;
// final degradation = "└ {progress} ⏎ ┘"
// Question line: compose left part "{group} · Q{n}/{id} {title}", measure,
// truncate title first, then group label; markers appended with visibleWidth
// reserve (measure markers BEFORE truncating the left part).
```

### Integration Points

```yaml
NO database / config-file / route changes. Config is READ-ONLY input.
PANEL (panel.ts from S1):
  - replace 3 placeholder lines; add memoized labels + theme threading
DOWNSTREAM CONSUMERS (do not create yet):
  - P1.M3.T2.S1 short view replaces the options-region placeholder between hint and footer
  - P1.M5.T1.S1 deep view uses renderHeader().goalFull and renderFooter(state, "deep", …)
  - P1.M5.T2.S1 overview uses renderFooter(state, "overview", …)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npx tsc --noEmit                 # typecheck (project uses tsconfig.json)
npx vitest run src/panel/layout.test.ts src/panel/panel.test.ts 2>/dev/null || npx vitest run src/panel/
# Expected: zero errors. No linter is configured in this repo as of M3 — tsc + tests are the gates.
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/ -v
npx vitest run                    # full suite — no regressions in M1/M2 tests
# Expected: all pass, including all width-budget and AC-12 label-reflection cases.
```

### Level 3: Integration — SCRIPTED ONLY (AUTOMATION-POLICY.md)

> **Never perform this live** — no `pi` TUI session, no `/interrogate-debug-upsert`
> by hand, no calling the `interrogate` tool for real. Automated runs cover the
> same assertions in vitest:

```bash
# Layout assertions are pure-function tests: render header/footer/question line
# at widths 40/60/80/120 and assert via visibleWidth (no wrap, `…` truncation).
# Config-driven labels: rebinding test fakes a resolved config and asserts the
# footer label changes (AC-12) — no live .pi/settings.json editing needed.
npx vitest run src/panel/layout.test.ts
npm test
```

The old "manual smoke" observations (header/goal/counts, dimmed hint, footer
# key labels, rebinding) are all expressible as render-output assertions against
the pure layout functions.

### Level 4: Domain-specific

Covered by width-invariant test sweep (g) at 40/60/80/120 columns — asserts no wrap, no ANSI breakage via visibleWidth on output.

## Final Validation Checklist

- [ ] `npx tsc --noEmit` clean; `npx vitest run` all green.
- [ ] Header/footer each exactly 1 line at widths 40–120; truncation uses `…`.
- [ ] No literal key labels outside tests (`grep -rn '"ctrl+' src/panel/layout.ts` empty).
- [ ] Footer labels derived from `resolveKeyLabels` and proven by a rebinding test (AC-12).
- [ ] S1 panel placeholders replaced; options-region placeholder + view/caching/handleInput seams untouched.
- [ ] JSDoc (Mode A) documents the 1-line header/footer budget contract on the layout module.
- [ ] Chat remains visible above panel (hosting untouched) [AC-1].

## Anti-Patterns to Avoid

- ❌ Don't call `buildStatusLine` for the panel footer (wrong format — moot/epoch are model-facing only).
- ❌ Don't hardcode "ctrl+d" etc. anywhere; don't cache labels across config reloads.
- ❌ Don't use String.slice for truncation (ANSI/wide-char corruption).
- ❌ Don't mutate state or read settings inside render functions — pure (state, config, theme, width) → strings.
- ❌ Don't expand scope into the options region, key dispatch, or deep/overview rendering (later tasks own those).

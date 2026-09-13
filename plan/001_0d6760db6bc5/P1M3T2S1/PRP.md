# PRP — P1.M3.T2.S1: Short form renderer: options, ★ marks, preselect, ✎ affordance

## Goal

**Feature Goal**: Implement the short-view *options region* of the interrogation panel as a pure render module `src/panel/short-view.ts`, replacing the `"options region (TODO M3.T2)"` placeholder line in the InterrogationPanel's short view (P1.M3.T1.S1). It renders, per h2.29: the options list with cursor `▸`, the recommended option marked `★ sqlite` AND preselected as the initial cursor position (hard requirement R2 — Q15=A, no bulk-accept), the dimmed `✎ explain…` free-text affordance line beneath the options (focus target for P1.M4.T1.S2), moot-question dimming with reason, and a primary text-field affordance for `type: "text"` questions.

**Deliverable**: `src/panel/short-view.ts` (pure `renderShortViewOptions` function + `initialCursorIndex` helper + option-line helpers) and `src/panel/short-view.test.ts`; one small modification to `src/panel/panel.ts` to call the renderer in place of the options-region placeholder and track `cursorIndex` on the panel instance.

**Success Definition**: Given the current question + state + theme + width + cursor index, the renderer returns ANSI-wrapped lines matching the h2.29 short-form layout exactly; the recommended option shows `★` before its label and is the cursor position on first render of a question; ✎ affordance renders for every question type (choice and text); moot questions render dimmed with reason; all lines pass `visibleWidth ≤ width`; `npm run typecheck` + `npx vitest run` green.

## Why

The options region is the interactive heart of the panel (FR-7). This task defines the visual + cursor-state contract that P1.M3.T2.S2 (navigation: arrow movement, digit quick-select, enter accept+advance) and P1.M4.T1.S2 (focus on the ✎ affordance) build on. R2 is a *hard requirement from user tooling evaluations*: a recommendation that isn't unmistakable is a disqualifying failure — hence both the `★` glyph and preselect-as-initial-cursor.

## What

### Layout contract (h2.29, verbatim structure)

```
│   ▸ ★ sqlite   — Tool result details; branch-correct                 │   ← cursor + recommended
│     postgres   — Custom entries; simpler                             │   ← cursor elsewhere
│     ✎ explain…                                                        ← free-text affordance
```

1. **Option lines** (choice questions, in `state.order`-preserving option order from `q.options`):
   - Prefix per option: `▸ ` for the option at `cursorIndex`; two spaces otherwise (keeps alignment).
   - Recommendation: the option whose `value === q.recommendation` gets `★ ` inserted between cursor prefix and label → `▸ ★ sqlite`. Non-recommended options have no star.
   - Ramification-lite: if the option has a `ramification`, render ` — {ramification}` after the label, dimmed, truncated with `…` to the width budget. (Full ramification text belongs to the deep view, P1.M5.T1.S1 — here it's a one-line teaser.)
   - Dim the whole line (except the cursor prefix and ★) for non-gate/late questions only in P1.M5.T3.S1 gate semantics — NOT this task. This task dims only **moot** questions (see 3).
2. **✎ affordance line** (always present for choice questions): `  ✎ explain…` — dimmed; when `cursorIndex === options.length` it is the focus target: prefix `▸ ` instead of two spaces and render at full (non-dim) intensity. It occupies cursor index `q.options.length` in the cursor domain. Its focus behavior (editor composition) is P1.M4.T1.S2; this task only renders the line and includes it in the cursor range.
3. **Moot questions**: when `q.status === "moot"`, the entire options region renders dimmed with a reason line `⊘ moot — {reason}` where reason comes from the moot cause; if no reason string is available in state, render `⊘ moot — dependency changed`. Options are still listed but dimmed and the ★ is dimmed too. (State's moot transition doesn't carry a structured reason field — derive from `q.answer?.value` if present, else the generic string. Keep this a helper so it can be refined later.)
4. **type: "text" questions**: no option lines. Render the text-field affordance as PRIMARY: a single line `✎ {answer draft placeholder or "answer…"}` rendered at full intensity — this is cursor index 0 and the only focus target. If the question already has an answer (`q.answer?.text`), show its first line (dimmed) as the current-value preview. The actual embedded editor is P1.M4.T1.S1 — here it is an affordance line only.
5. **Withdrawn questions** (`status === "withdrawn"`): render a single dimmed `⊗ withdrawn` line (no options).
6. **Inset**: content lines inset 2 columns inside the panel border (questionnaire.ts pattern), i.e. render to `width - 2` budget then prefix two spaces.

### Cursor state (shared with P1.M3.T2.S2 — define it here, navigate it there)

- `InterrogationPanel` gains `cursorIndex: number` (instance field, defaults set per question below). This task defines the *domain*: for choice questions, indices `0..q.options.length` (last = ✎ affordance); for text questions, index `0`.
- `initialCursorIndex(q: Question): number` — pure helper: returns `q.options.findIndex(o => o.value === q.recommendation)` clamped to ≥ 0, falling back to 0 (i.e. the recommendation is the preselected cursor position — R2). For text questions returns 0. If a question is revisited with `status === "answered"`, still use the recommendation preselect (answers don't pin the cursor; enter accept+advance is T2.S2's concern).
- `panel.ts` calls `initialCursorIndex` whenever `currentId` changes (reset cursor on question change). Movement keys are NOT implemented here.

### Success Criteria

- [ ] Recommended option renders `▸ ★ {label}` and `initialCursorIndex` points at it (test: cursor prefix on the ★ line).
- [ ] Question with `recommendation` unset → no ★ anywhere, cursor at 0.
- [ ] ✎ affordance line present on every choice question; focusable (cursor prefix at end of range).
- [ ] type: "text" question renders primary text affordance, no option lines.
- [ ] Moot question renders dimmed with `⊘ moot — {reason}` line.
- [ ] Withdrawn question renders `⊗ withdrawn` line only.
- [ ] Every returned line's `visibleWidth ≤ width` at widths 60/80/120 (ramification teaser truncates with `…`).
- [ ] Panel short view shows the real options region between the S2 hint line and footer; placeholders `"options region (TODO M3.T2)"` and `"focus: …"` gone.
- [ ] Renderer is pure: (question, state-derived inputs, theme, width, cursorIndex) → string[]; no pi imports, no state mutation, no I/O.
- [ ] JSDoc (Mode A) documents the marker glyph vocabulary (`·` open, `★` answered/recommended, `⟳` re-asked, `⊘` moot, `⊗` withdrawn, `✎` has text answer / affordance, `▸` cursor).

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the Question/option data shapes, the S1/S2 panel seams to plug into (both being implemented in parallel — treat their PRPs as contracts), the theme/ANSI width utilities, and the exact h2.29 layout. All specified below with file anchors.

### Documentation & References

```yaml
- file: src/state.ts
  why: Question (lines ~48-80: id, title?, prompt, description?, type "choice"|"text", options?: QuestionOption{value,label,ramification?}, recommendation?, status, answer?), QuestionStatus union, SerializedState
  gotcha: recommendation matches option VALUE not label; options may be undefined on text questions; title may be missing (title ?? prompt — though this module doesn't render the title, S2 does)

- file: plan/001_0d6760db6bc5/P1M3T1S1/PRP.md
  why: CONTRACT for InterrogationPanel — the placeholder line "options region (TODO M3.T2)" this task replaces; fields view/focus/currentId; render caching + invalidate discipline; render(width) → string[]
  gotcha: S1 is implemented/complete-ish; if panel.ts internals differ slightly from its PRP, adapt at the seam: the short-view line assembly inside render(width)

- file: plan/001_0d6760db6bc5/P1M3T1S2/PRP.md
  why: CONTRACT for layout.ts (implemented in parallel) — renderHeader/renderQuestionLine/renderHintLine/renderFooter plus exported helpers truncateVisible + visibleWidth discipline. The short view's line order is: header, question line, hint, [THIS TASK: options region], footer
  pattern: pure render functions taking (…, theme, width); theme.fg("dim", s), theme.bold; truncateVisible from @earendil-works/pi-tui (or layout.ts re-export)
  gotcha: import truncateVisible/visibleWidth from src/panel/layout.ts if exported there, else from pi-tui directly — check what exists at implementation time

- file: plan/001_0d6760db6bc5/architecture/reference-patterns.md
  why: §3 theme + ANSI utilities; questionnaire.ts inset-2 width budgeting (editor.render(width - 2), prefix "  ")
  gotcha: ★ ✎ ⊘ ⊗ ▸ glyphs may render double-width in some terminals — always measure with visibleWidth, never assume 1

- file: src/tool.ts (renderCallRow ~293)
  why: in-repo example of theme.fg + theme.bold composition for one-line colored renders
```

### Current Codebase tree (relevant excerpt)

```bash
src/
  state.ts           # Question, QuestionOption, QuestionStatus shapes
  config.ts          # InterrogatorConfig (keys incl. focusText) — read-only input
  panel/             # from S1 (host) + S2 (layout)
    panel.ts         # MODIFY: replace options-region placeholder, add cursorIndex
    layout.ts        # EXISTS (S2, parallel): header/question/hint/footer + truncateVisible
    short-view.ts    # CREATE (this task)
    short-view.test.ts # CREATE
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: alignment — the non-cursor prefix must be two spaces "  " so the
// ▸ (1 visible col) + space keeps labels column-aligned with "▸ {label}".
// CRITICAL: star spacing — "▸ ★ sqlite" (star + space + label); recommended
// but not cursor: "  ★ sqlite". Both prefixes are 4 visible cols total.
// GOTCHA: recommendation may reference a value no longer in options
// (post-upsert) — findIndex returns -1 → clamp to 0, render no ★.
// GOTCHA: never String.slice truncation — ANSI + wide glyphs; use
// truncateVisible/visibleWidth.
// GOTCHA: don't implement key handling, enter-accept, digit select, dimming
// of non-gate groups, or the embedded editor — P1.M3.T2.S2 / P1.M5.T3.S1 /
// P1.M4.T1.* own those. Only cursorIndex DEFAULTS belong here.
// GOTCHA: renderer must tolerate q.options === undefined for choice questions
// (schema validation happens upstream, but render empty options region + ✎ only).
```

## Implementation Blueprint

### Data shapes

```ts
// src/panel/short-view.ts
import type { Question } from "../state";
import type { Theme } from "@earendil-works/pi-coding-agent"; // match panel.ts import

/** Inputs to the options-region renderer. */
export interface ShortViewInput {
  question: Question;
  /** Cursor index in the cursor domain (0..options.length; ✎ = last). */
  cursorIndex: number;
  theme: Theme;
  /** Full panel render width; content budget = width - 2 (inset). */
  width: number;
}

/** Pure renderer: returns the option + affordance lines (no header/footer). */
export function renderShortViewOptions(input: ShortViewInput): string[];

/** Initial cursor position for a question — the ★ recommendation (R2). */
export function initialCursorIndex(q: Question): number;

/** Reason string for a moot question (derived; refine in later tasks). */
export function mootReason(q: Question): string;
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/panel/short-view.ts
  - IMPLEMENT: initialCursorIndex (findIndex on recommendation value, clamp), mootReason, renderShortViewOptions
  - LINES (choice): for i, opt of question.options → prefix = i===cursor ? "▸ " : "  "; star = opt.value===recommendation ? "★ " : ""; line = prefix + star + opt.label + (opt.ramification ? dim(" — "+truncated ramification) : ""); ✎ line: index options.length, "▸ ✎ explain…" when focused else "  ✎ explain…" dim
  - LINES (text): single primary "✎ {q.answer?.text ? first line of text : "answer…"}" line (dim current value, full intensity placeholder)
  - MOOT: dim everything + prepend "⊘ moot — {mootReason(q)}" line; WITHDRAWN: "⊗ withdrawn" only
  - MODE A JSDoc: module-level block documenting the marker vocabulary (· ★ ⟳ ⊘ ⊗ ✎ ▸) per h2.29/FR-11 and why ★ + preselect coexist (R2)
  - PLACEMENT: src/panel/short-view.ts

Task 2: MODIFY src/panel/panel.ts
  - REPLACE the short-view placeholder lines "options region (TODO M3.T2)" and "focus: …" with renderShortViewOptions({question, cursorIndex: this.cursorIndex, theme, width})
  - ADD: cursorIndex field; set this.cursorIndex = initialCursorIndex(q) whenever currentId changes (in the currentId setter / open / jump path S1 provides)
  - PRESERVE: render caching + invalidate; S2 header/question/hint/footer assembly; handleInput seam (no new key handling)
  - GOTCHA: question lookup = state.getQuestion(this.currentId); render must not crash on undefined question (empty region)

Task 3: CREATE src/panel/short-view.test.ts
  - STUB theme like src/tool.test.ts:81 / layout.test.ts (fg/bold return input)
  - CASES: (a) recommended option shows "▸ ★ {label}" when cursor at initial index; (b) cursor on 2nd option → "  ★ rec" still starred, "▸ second"; (c) no recommendation → no ★, initialCursorIndex 0; (d) recommendation value not in options → clamp 0, no ★; (e) ✎ line focusable at last index, non-focused variant dimmed; (f) text question primary affordance + answered preview; (g) moot dimming + reason line; (h) withdrawn single line; (i) ramification teaser truncation with … ; (j) visibleWidth of every line ≤ width for 60/80/120; (k) options undefined → ✎ only
  - FOLLOW pattern: src/config.test.ts / src/results.test.ts vitest conventions
  - PLACEMENT: src/panel/short-view.test.ts
```

### Implementation Patterns & Key Details

```ts
// Option line composition (the alignment is the whole game):
const prefix = i === cursorIndex ? "▸ " : "  ";
const star   = opt.value === q.recommendation ? "★ " : "";
// "▸ ★ label" and "  ★ label" and "▸ label" all align at col 4 (inset).
const label  = truncateVisible(opt.label, budget);
const ram    = opt.ramification
  ? theme.fg("dim", " — " + truncateVisible(opt.ramification, ramBudget)) : "";
line = "  " /* inset */ + prefix + star + label + ram;
// Ramification budget = width - 2 - inset - 4 (prefix+star) - visibleWidth(label),
// floored at 0 → omit the teaser entirely if budget < ~4.
```

### Integration Points

```yaml
PANEL (panel.ts):
  - short-view line assembly: header(S2) + questionLine(S2) + hint(S2) + renderShortViewOptions(this) + footer(S2)
  - new field: cursorIndex (P1.M3.T2.S2 navigation will mutate it; M3.T2.S1 only seeds it)
NO config / state / index.ts changes. Theme + width come from existing seams.
FUTURE CONSUMERS (do not implement):
  - P1.M3.T2.S2: ↑/↓ moves cursorIndex across 0..options.length; digits select; enter accepts (✎ = focus text field via P1.M4.T1.S2)
  - P1.M5.T1.S1 deep view reuses the ★/▸ line style for sticky option headers
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck            # tsc, zero errors
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/short-view.test.ts -v
npm test                     # full suite — M1/M2 + S1/S2 panel tests stay green
```

### Level 3: Integration — SCRIPTED ONLY (AUTOMATION-POLICY.md)

> **Never perform this live** — no `pi -e .` session, no
> `/interrogate-debug-upsert` by hand, no calling the `interrogate` tool for
> real, no waiting for a user answer. The short-form render is a pure function;
> automated runs assert its output directly:

```bash
# Render the short view from the same fixture state in vitest and assert:
#   ▸ cursor prefix on the selected option, ★ + preselect on the recommended
#   one ("▸ ★ sqlite"), ✎ explain… affordance beneath, header/footer from S2,
#   moot dimming — via string/visibleWidth assertions at 60/80/120 columns.
npx vitest run src/panel/short-view.test.ts
npm test
```

### Level 4: Domain-specific

Width-invariant sweep at 60/80/120 columns asserting no wrap and alignment (prefix columns match between cursor/non-cursor lines) via visibleWidth.

## Final Validation Checklist

- [ ] `npm run typecheck` clean; `npm test` all green.
- [ ] ★ + preselect both present on the recommended option (R2) — proven by test (a).
- [ ] ✎ affordance on every question; primary affordance for text questions.
- [ ] Moot/withdrawn rendering correct and dimmed.
- [ ] Placeholders removed from panel.ts short view; caching/invalidate intact; no key handling added.
- [ ] Mode A JSDoc on marker glyph vocabulary.
- [ ] Renderer pure — no pi imports outside the Theme type.

## Anti-Patterns to Avoid

- ❌ Don't implement navigation, digit select, enter-accept, or editor composition (P1.M3.T2.S2 / P1.M4.T1).
- ❌ Don't reorder or filter options — state order is the display order (R1 freedom).
- ❌ Don't String.slice truncate; don't assume glyph widths.
- ❌ Don't store cursorIndex anywhere but the panel instance (suspend must lose nothing).
- ❌ Don't render bulk-accept affordances ("accept all ★") — Q15=A explicitly rejects.

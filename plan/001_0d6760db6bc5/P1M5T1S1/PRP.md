# PRP — P1.M5.T1.S1: Scrollable deep view with sticky headers + select-from-deep

---

## Goal

**Feature Goal**: Implement the deep view (`ctrl+d`, FR-8 / h2.29 / Q19-Q20 merged) as a FULL replacement of the Q&A region between header and footer: full question description on top, then each option as a sticky section header (`▸ sqlite`) followed by its wrapped ramification text. `↑/↓` SCROLL the pane (they do NOT navigate questions in deep view); the highlighted option remains visible via sticky-header logic within the viewport budget; `enter` selects the highlighted option → returns to short view AND advances to the next unanswered question (Q14). `esc` returns to short view without destroying anything (FR-16). The full goal text is shown in deep view (FR-30).

**Deliverable**:
- `src/panel/deep-view.ts` — pure content builder + scroll/selection model + sticky window algorithm + `acceptFromDeep` action (new file).
- `src/panel/deep-view.test.ts` — unit tests (new file).
- Surgical, view-gated edits to `src/panel/keys.ts` (up/down/enter routing in deep view) and `src/panel/panel.ts` (replace the deep placeholder branch in `buildLines`; deep state fields).

**Success Definition**: AC-5 — from the short form, `ctrl+d` opens a scrollable pane listing ALL ramifications; scrolling to any option and pressing `enter` selects it, returns to the short form, and advances to the next unanswered question; `esc` descends to short form with all state intact; deep toggle is sticky for the panel session (`ctrl+l` overview round-trip restores deep — that path already works via `deepSticky`).

## User Persona

**Target User**: The pi user being interrogated (developer answering structured questions).
**Use Case**: The short form's one-line ramification teaser is insufficient — the user needs the full description and every option's full ramification before choosing.
**User Journey**: short form → `ctrl+d` → read full description + scroll ramifications → `↑/↓` to highlight an option (its header stays pinned while its text scrolls) → `enter` → back on short form, already advanced to the next unanswered question. Or `esc` to just go back.
**Pain Points Addressed**: truncated teasers forcing guesswork; losing position after reading long text.

## Why

- FR-8 (h2.3.1): the deep view is the primary informed-decision surface — recommendations are only "unmistakable" (R2) when the user can read full ramifications.
- Consumes the short-view panel (P1.M3.T1.S1/T2.S1) and keyRouter (P1.M3.T3.S1); consumed by overview view-switching (P1.M5.T2.S1 via `deepSticky`) and the terminal-fallback work (P1.M7.T5.S1 reuses the render budget knobs).
- h2.51 risk row 2 mitigation: cap + ellipsize rendering so huge descriptions/ramifications cannot blow the terminal (overview list is the escape hatch, M5.T2).

## What

- `ctrl+d` (already wired in keys.ts `onDeep` — DO NOT re-implement the toggle) switches `panel.view` to `"deep"` and sets `deepSticky = true`.
- Deep render: panel header (unchanged, `renderHeader`) at top, then a scrollable pane capped at `DEEP_VIEW_HEIGHT` (default 20) content lines, then footer (unchanged, `renderFooter` — already view-aware).
- Pane content, top→bottom: full goal text (FR-30, dimmed, wrapped), blank separator, full `question.description` (wrapped), blank separator, then for each option in state order: a section header line `▸ label` (or `▸ ★ label` when it matches `q.recommendation` — same ★/▸ vocabulary as short-view.ts) followed by its `ramification` text wrapped over multiple indented lines. Withdrawn question: single `⊗ withdrawn` dim line (mirror short-view).
- Selection model: one option index is highlighted (reuse `panel.cursorIndex` — same domain as short view minus the ✎ affordance, i.e. `0..options.length-1`); the highlighted header renders with the `▸` cursor prefix, others with two spaces.
- Sticky headers: `↑/↓` move the SELECTION (and scroll the window minimally so the highlighted header + at least its first ramification line stay inside the viewport); when the selected section's header would scroll above the window top, clamp the offset so the header pins at the top of the viewport. Scrolling is bounded `[0, contentLines - viewportHeight]` (offset never negative, never past the end).
- `enter` in deep view (choice question, option highlighted): accept that option — same commit semantics as short-view accept (ripple-confirm seam when re-answering answered/submitted, `state.applyAnswer`, advance via `nextUnanswered`) — then `panel.setView("short")`. `deepSticky` stays true.
- `esc` in deep view: existing `escapeDescend` already does deep → short without clearing `deepSticky` — no change needed.
- Text questions in deep view: description + goal scroll; `enter` is a consumed no-op (the text affordance belongs to the short form / embedded editor).
- Moot questions: pane rendered fully dimmed with the `⊘ moot — {reason}` line prepended (mirror short-view `mootReason`); enter is a consumed no-op (R1: navigable, not editable).
- Rendering cap (h2.51 row 2): each ramification/description is capped (reuse `config.caps.maxRamificationChars` = 600 chars; append `…` when truncated) and every line is word-wrapped to the width budget then hard-truncated with `…` via `truncateVisible`.

### Success Criteria

- [ ] `ctrl+d` renders full description + all options with full ramifications, header/footer intact, pane ≤ `DEEP_VIEW_HEIGHT` lines
- [ ] `↑/↓` in deep view scroll/move selection — NEVER change `panel.currentId`
- [ ] Highlighted section header stays visible while its ramification text scrolls (sticky clamp)
- [ ] `enter` in deep view: applies the answer, returns to short view, advances to next unanswered (Q14)
- [ ] `esc` in deep view: returns to short form; nothing destroyed; `deepSticky` still true (overview round-trip restores deep)
- [ ] Full goal text visible in deep view (FR-30)
- [ ] Verbose descriptions/ramifications are capped and ellipsized — total rendered lines bounded
- [ ] All existing tests still pass (keys.test.ts, panel.test.ts, actions.test.ts, short-view.test.ts)

## All Needed Context

### Context Completeness Check

Verified: an agent with only this PRP + the listed files has the full picture. The toggle, esc ladder, deepSticky bookkeeping, and `PanelView` plumbing ALREADY exist (listed below) — this task renders the view and reroutes three keys.

### Documentation & References

```yaml
- file: src/panel/panel.ts
  why: The host — deep placeholder branch in buildLines (~line "if (this.view === \"deep\")"), deepSticky + scrollOffset fields, handleInput dispatch order, invalidate/render-cache discipline
  pattern: short-view branch of buildLines; view/focus/cursorIndex state; setView()
  gotcha: NEVER await anything in render paths; currentId setter re-seeds cursorIndex — deep-view selection reads it but must not fight the setter

- file: src/panel/short-view.ts
  why: THE pure-renderer pattern to follow (module structure, INSET/CURSOR/STAR constants, marker vocabulary, wrap/truncate via visibleWidth)
  pattern: pure (question, cursorIndex, theme, width) → string[]; optionLine/explainLine builders; moot/withdrawn branches
  gotcha: never String.prototype.slice display text — always truncateVisible; labels column-aligned via equal-width prefixes

- file: src/panel/keys.ts
  why: The router to make view-aware — resolution-order steps 1 (up/down), 3 (enter); onDeep/escapeDescend already correct
  pattern: buildKeyRouter step structure, matchesKey(data, Key.up) fixed-key checks
  gotcha: arrows are checked BEFORE esc (ESC-prefixed sequences) — do not reorder; a parallel task (P1.M4.T2.S2 batch note) edits onBatchNote in defaultRoutedActions — keep edits surgical, don't reorder steps 4+

- file: src/panel/actions.ts
  why: Commit semantics to reuse — ripple seam invocation, applyAnswer, advanceAfterAccept, nextUnanswered (exported), mootReason-adjacent status handling
  pattern: acceptOptionIndex (private — replicate its semantics in acceptFromDeep, or export it)
  gotcha: acceptOptionIndex is NOT exported today; PRP permits exporting it OR duplicating the 6-line commit sequence — prefer exporting

- file: src/panel/layout.ts
  why: renderHeader(state, theme, width), renderFooter(state, view, labels, theme, width) already take the view; truncateVisible; firstSentence (NOT used in deep — full description)
  pattern: import { truncateVisible } from "./layout.js"
  gotcha: footer is already view-aware via SCREEN_KEYS — verify "deep" screen shows {submit, overview, esc-ish} keys per config labels

- file: src/state.ts
  why: Question shape — description?, options?[{label,value,ramification?}], recommendation?, status; state.goal readonly; getQuestion/orderedQuestions/applyAnswer/serialize
  pattern: read question via panel.state.getQuestion(panel.currentId)
  gotcha: serialize() includes goal — renderHeader consumes it truncated; deep view needs the FULL goal, read state.goal directly

- file: src/config.ts
  why: caps.maxRamificationChars (default 600) — reuse as the per-text char cap; KeyAction "deep" exists
  pattern: config is readonly on the panel; access via panel.config.caps.maxRamificationChars
  gotcha: do NOT add new config keys in this task — use the existing cap + a module constant for viewport height (fallbacks tuning is P1.M7.T5.S1)

- file: plan/001_0d6760db6bc5/P1M4T2S2/PRP.md
  why: Parallel in-flight task — batch-note note-focus mode; it touches keys.ts defaultRoutedActions.onBatchNote and panel note focus
  gotcha: design is orthogonal (view routing vs focus mode) — but coordinate: batch note must also work while view === "deep" (note field replaces the pane region per FR-13 "at any time" — if P1.M4.T2.S2's note mode renders in buildLines, deep view must yield the pane region to it; check its PRP's OUTPUT section and gate the deep branch on focus !== "note" if it specifies that)

- file: src/panel/panel.test.ts + src/panel/keys.test.ts
  why: Test patterns — mock theme {fg:(c,s)=>s}-style, fake TUI {requestRender}, key routing assertions
  pattern: construct InterrogationPanel directly with mocks; drive handleInput with raw key bytes
```

### Current Codebase tree (relevant slice)

```bash
src/
  config.ts            # KeyAction "deep", caps.maxRamificationChars
  state.ts             # Question/QuestionOption, InterrogationState, goal
  panel/
    panel.ts           # InterrogationPanel host — deep placeholder in buildLines
    layout.ts          # renderHeader/renderFooter/truncateVisible (shared)
    short-view.ts      # pure short-form renderer (pattern to follow)
    actions.ts         # accept/advance/nextUnanswered (commit semantics)
    keys.ts            # config-driven router (steps 1/3 need view gating)
    text-field.ts      # embedded editor (not used in deep view)
    *.test.ts          # colocated vitest
```

### Desired Codebase tree with files to be added

```bash
src/panel/
  deep-view.ts         # NEW — pure content builder + sticky scroll window + acceptFromDeep
  deep-view.test.ts    # NEW — unit tests for renderer, scroll model, accept, routing gates
  keys.ts              # MODIFIED — view-gated up/down/enter dispatch (steps 1 & 3)
  panel.ts             # MODIFIED — real deep branch in buildLines; deep-view state wiring
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: arrows are ESC-prefixed — keys.ts checks up/down BEFORE esc; never reorder.
// CRITICAL: display text is ANSI/wide-char — only truncateVisible/visibleWidth, never .slice().
// CRITICAL: panel.render(width) has NO height parameter — the deep pane's height cap is a
//   constant (DEEP_VIEW_HEIGHT = 20), not derived from terminal rows (M7.T5.S1 adapts).
// CRITICAL: enter must remain PARSE-KEY-exact in panel.ts handleInput (two-stage enter) —
//   deep-view enter routing happens INSIDE the router (step 3), not by adding raw-byte checks.
// CRITICAL: currentId setter re-seeds cursorIndex — entering deep view should seed selection
//   from the existing cursorIndex (or initialCursorIndex) ONCE, not continuously.
// CRITICAL: up/down in deep view must NOT call actions.optionUp/optionDown (question nav is
//   config keys prevQuestion/nextQuestion only, and even those scroll-noop here per h2.29 —
//   config intercepts remain live in deep view EXCEPT nothing changes: only fixed 1/3 gate).
// CRITICAL: do not call panel.state mutations from renderers — renderers are pure; selection
//   and scroll live on the panel (scrollOffset, cursorIndex) and are mutated by key actions only.
// CRITICAL: parallel task P1.M4.T2.S2 (batch note) — check its PRP OUTPUT contract first; if
//   note mode renders a field region, the deep branch must defer to it (focus === "note").
```

## Implementation Blueprint

### Data models and structure

No new persistent models. Panel-local view state (already partially present in panel.ts):

```typescript
// panel.ts (existing fields, now meaningful):
scrollOffset: number; // deep-view window offset in CONTENT LINES, default 0, reset on entering deep
cursorIndex: number;  // reused as the highlighted option index in deep view
deepSticky: boolean;  // existing — untouched

// deep-view.ts new exported types:
export interface DeepViewInput {
  question: Question;
  goal: string;              // full text (FR-30)
  cursorIndex: number;       // highlighted option
  scrollOffset: number;
  theme: Theme;
  width: number;             // full panel width; content budget = width - 2 (INSET)
}
export interface DeepContent {
  lines: string[];           // flattened content (pre-window): goal, description, sections
  sectionHeaderLineIndex: number[]; // per option: index into `lines` of its header
  viewportHeight: number;    // DEEP_VIEW_HEIGHT
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/panel/deep-view.ts — content builder (pure)
  - IMPLEMENT: buildDeepContent(question, goal, config caps, theme, width): DeepContent
    - goal block: dimmed, word-wrapped to budget, from state.goal (FULL text, FR-30)
    - description block: wrapped; each of goal/description capped at
      config.caps.maxRamificationChars chars with "…" appended when truncated (h2.51 row 2)
    - per option (state order, never filtered — R1): header line `▸ label` or `▸ ★ label`
      (★ when opt.value === q.recommendation; prefix "▸ " when highlighted at render time,
      else two spaces — alignment identical to short-view.ts optionLine); then ramification
      wrapped over indented (4-col) lines, capped + ellipsized
    - withdrawn: ["⊗ withdrawn"] dim; moot: prepend "⊘ moot — {mootReason(q)}" (import mootReason
      from short-view.ts), whole pane dimmed
  - IMPLEMENT: wrapText(text, budget): string[] — visibleWidth-aware word wrap (split on
    spaces, break words longer than budget with truncateVisible + "…"); never assume glyph widths
  - FOLLOW pattern: src/panel/short-view.ts (constants INSET/CURSOR/STAR, line builders, purity)
  - NAMING: snake-free camelCase, exported names buildDeepContent / wrapText / mootReason reuse
  - PLACEMENT: src/panel/deep-view.ts

Task 2: CREATE src/panel/deep-view.ts — sticky scroll window
  - IMPLEMENT: clampScroll(content: DeepContent, scrollOffset: number, cursorIndex: number): number
    - [Mode A] JSDoc REQUIRED here: document the sticky-header scroll budget (see contract 5
      below) — offset bounds [0, max(0, lines.length - viewportHeight)] AND the sticky clamp:
      offset must satisfy headerLineIdx >= offset when cursor is in/above the window, and
      headerLineIdx + 1 (header + first ramification line) <= offset + viewportHeight - 1 when
      below; i.e. offset = clamp(offset, headerIdx - viewportHeight + 2, headerIdx) intersected
      with the global bounds
  - IMPLEMENT: renderDeepWindow(content, cursorIndex, scrollOffset, theme, width): string[]
    — slice content.lines to the viewport window, re-rendering the highlighted option's header
    with the `▸ ` prefix
  - IMPLEMENT: deepSelectionUp(p)/deepSelectionDown(p): mutate panel.cursorIndex within
    [0, options.length-1] (NO ✎ index in deep), recompute scrollOffset via clampScroll,
    panel.invalidate() — and NEVER touch panel.currentId (h2.29: ↑/↓ don't navigate questions)
  - PLACEMENT: same file, below the content builder

Task 3: CREATE src/panel/deep-view.ts — acceptFromDeep
  - IMPLEMENT: acceptFromDeep(panel): boolean
    - no question / text question / moot / withdrawn → consumed no-op true
    - choice: replicate acceptOptionIndex semantics — prefer EXPORTING acceptOptionIndex from
      actions.ts (one-line change: add `export` — verify no conflicts with P1.M4.T2.S2 scope;
      it doesn't touch it) and calling it (ripple seam on answered/submitted, applyAnswer,
      advanceAfterAccept), THEN panel.setView("short") and reset panel.scrollOffset = 0;
      deepSticky stays true (sticky per session)
  - FOLLOW pattern: actions.ts accept / acceptOptionIndex
  - PLACEMENT: deep-view.ts; register in a small `export const deepActions = {...}` if keys.ts
    needs a seam, or import directly

Task 4: MODIFY src/panel/keys.ts — view-gated dispatch (surgical)
  - STEP 1 (up/down): when panel.view === "deep", route to deepSelectionUp/Down instead of
    actions.optionUp/optionDown; short/overview unchanged
  - STEP 3 (enter): when panel.view === "deep" AND focus !== "text", route to acceptFromDeep
    instead of actions.accept
  - DO NOT touch: esc ladder (already correct), step-4 config intercepts (deep toggle,
    overview, prevQuestion/nextQuestion stay live), digits gate (focus-based, unchanged —
    digits in deep view may keep short-view semantics; leave as-is, out of scope)
  - PRESERVE: resolution order 1→5, arrow-before-esc, single-dispatch guarantee
  - GOTCHA: parallel task P1.M4.T2.S2 edits defaultRoutedActions.onBatchNote in this file —
    keep edits to the dispatch function only; no reordering

Task 5: MODIFY src/panel/panel.ts — real deep branch in buildLines
  - REPLACE the "[deep] placeholder" branch: header line (renderHeader — unchanged), then
    renderDeepWindow(...) output, then renderFooter (unchanged signature, view-aware)
  - WIRE: on setView("deep") entry (or first render in deep), seed cursorIndex to
    initialCursorIndex(q) clamped to options.length-1 and scrollOffset = 0. Cleanest: do the
    seeding inside setView when switching to "deep" (guard: only when previous view !== "deep")
  - KEEP: render caching, invalidate discipline, width-change rebuild — untouched
  - CHECK the P1.M4.T2.S2 PRP OUTPUT first: if its note mode renders into the panel body,
    gate the deep branch on focus !== "note" so the note field wins (FR-13 "at any time")

Task 6: CREATE src/panel/deep-view.test.ts + EXTEND keys.test.ts / panel.test.ts
  - deep-view.test.ts: wrapText (short/long/unbounded-word/unicode), buildDeepContent
    (goal present, description, ★ header, capped text ellipsized, moot/withdrawn variants),
    clampScroll (bounds, sticky pin above/below, minimal scroll on selection move),
    renderDeepWindow (window size ≤ DEEP_VIEW_HEIGHT, highlighted header prefix, alignment),
    acceptFromDeep (applies answer + setView("short") + advance; ripple veto path; text/moot
    no-ops; deepSticky preserved)
  - keys.test.ts additions: up/down in deep view call deep handlers and never optionUp/Down;
    enter in deep view calls acceptFromDeep; esc deep→short still works; config intercepts
    still fire in deep view (e.g. ctrl+d toggles back to short)
  - panel.test.ts additions: buildLines deep branch = header + window + footer; entering deep
    seeds selection/scroll; view switch invalidates
  - FOLLOW pattern: short-view.test.ts (pure renderer tests), keys.test.ts (raw key bytes via
    buildKeyRouter + panel mock/real instance)
  - NAMING: test_{unit}_{scenario}
  - PLACEMENT: colocated
```

### Implementation Patterns & Key Details

```typescript
// Sticky clamp — the core algorithm (Task 2):
// maxOffset = Math.max(0, content.lines.length - content.viewportHeight)
// headerIdx = content.sectionHeaderLineIndex[cursorIndex] ?? 0
// keep header + 1 line visible, prefer minimal movement:
//   offset = Math.min(Math.max(scrollOffset, headerIdx - viewportHeight + 2), headerIdx)
//   return Math.max(0, Math.min(offset, maxOffset))
// (When the selected header is above the window this PINS it at the top — "sticky".)

// Word wrap (visibleWidth-safe):
// function wrapText(text: string, budget: number): string[] {
//   // split words on spaces; accumulate while visibleWidth(line + " " + word) <= budget;
//   // a single word longer than budget → truncateVisible(word, budget - 1) + "…"
// }

// Enter routing in keys.ts step 3 (surgical):
// if (panel.view === "deep" && panel.focus !== "text" && matchesKey(data, Key.enter))
//   return acceptFromDeep(panel);
// if (panel.focus !== "text" && matchesKey(data, Key.enter)) return actions.accept(panel);

// acceptFromDeep commit (reuse, don't duplicate):
// export acceptOptionIndex from actions.ts → ripple seam → applyAnswer → advanceAfterAccept
// then: panel.setView("short"); panel.scrollOffset = 0;  // deepSticky untouched
```

### Integration Points

```yaml
VIEW STATE: none new — PanelView/"deep", deepSticky, scrollOffset already exist in panel.ts
KEYS: no config changes; KeyAction "deep" already in config.ts defaults (ctrl+d)
FOOTER: layout.ts SCREEN_KEYS — verify the "deep" screen entry shows the right keys
  (submit/overview labels); adjust ONLY if missing, following its existing pattern
NO state.ts / delivery / persistence changes — deep view is pure presentation + accept reuse
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npx tsc --noEmit          # type check (project uses plain tsc + vitest; no ruff/mypy)
# Expected: zero errors. Fix before proceeding.
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/deep-view.test.ts
npx vitest run src/panel/keys.test.ts src/panel/panel.test.ts
npx vitest run             # full suite — no regressions in any existing test
# Expected: all pass.
```

### Level 3: Integration (manual/TUI smoke)

```bash
# Scripted path via existing debug commands (src/debug-commands.ts):
#   /interrogate-debug-upsert with a fixture question carrying long descriptions + ramifications
#   → open the panel, press ctrl+d, scroll, enter — verify return + advance
# Manual TUI runbook (recorded for AC-5): ctrl+d opens pane; ↑/↓ scroll; header stays pinned;
# enter selects + advances; esc descends; ctrl+d again from short re-enters (sticky);
# ctrl+l → esc returns to deep (deepSticky). Human-run; note results for M7.T6.S2.
```

### Level 4: Edge-case validation (scripted in tests)

```bash
npx vitest run src/panel/deep-view.test.ts -t "cap"       # truncation/ellipsis paths
npx vitest run src/panel/deep-view.test.ts -t "sticky"    # scroll clamp paths
npx vitest run src/panel/deep-view.test.ts -t "wrap"      # narrow-width wrap (<60 cols behavior)
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` — full suite green (zero regressions)
- [ ] No new dependencies added

### Feature Validation

- [ ] AC-5 flow works: scroll all ramifications, select from deep, return + advance
- [ ] ↑/↓ in deep view never change the focused question
- [ ] Highlighted section header remains visible while its text scrolls (sticky clamp)
- [ ] esc: deep → short, no state destroyed, deepSticky preserved
- [ ] Full goal text + full description rendered (FR-30/FR-8)
- [ ] Verbose text capped + ellipsized; rendered pane bounded by DEEP_VIEW_HEIGHT
- [ ] Moot/withdrawn/text questions render sanely; enter no-ops consumed

### Code Quality Validation

- [ ] deep-view.ts is a pure renderer + actions, mirroring short-view.ts structure
- [ ] Marker vocabulary (▸ ★ ⊘ ⊗ ✎-free) consistent with short-view.ts
- [ ] keys.ts edits surgical and view-gated; resolution order preserved
- [ ] [Mode A] JSDoc on the sticky-header scroll budget present (contract 5)
- [ ] No conflicts with parallel P1.M4.T2.S2 (batch note) — note-mode gating checked

## Anti-Patterns to Avoid

- ❌ Don't re-implement the ctrl+d toggle, esc ladder, or deepSticky bookkeeping — they exist and are correct
- ❌ Don't slice display strings — always truncateVisible/visibleWidth
- ❌ Don't let up/down navigate questions in deep view (h2.29 is explicit)
- ❌ Don't derive the pane height from the terminal (not available in render(width)); use the constant, leave adaptation to M7.T5.S1
- ❌ Don't mutate state from renderers; don't await in render paths
- ❌ Don't reorder keys.ts steps or touch P1.M4.T2.S2's onBatchNote seam

---

**Confidence Score**: 8/10 — all consuming/producing interfaces already exist in code and were read directly; the only residual risks are (a) coordination with the in-flight batch-note PRP (mitigated by the explicit check task) and (b) the exact sticky clamp feel, which is unit-tested against a precise spec.

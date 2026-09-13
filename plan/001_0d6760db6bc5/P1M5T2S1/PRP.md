# PRP — P1.M5.T2.S1: Overview list with markers + jump

---

## Goal

**Feature Goal**: Implement the overview list (`ctrl+l`, FR-11 / h2.29): a full-screen-in-panel list of ALL questions in state order, each with its status marker — `·` open, `★` answered, `⟳` re-asked, `⊘` moot (+reason, dimmed), `⊗` withdrawn, `✎` has text answer — with group headers inserted at group boundaries and the gate group header marked `▲`. A cursor row moves with `↑/↓` (AND with the config `prevQuestion`/`nextQuestion` keys — contract 3); `enter` jumps to the selected question in the short form (focus restored); `esc` returns without destroying anything (FR-16). Withdrawn/moot rows render dimmed with reason text (audit trail, Q34=A). Pagination/height adaptation is OUT of scope (P1.M7.T5.S1) — this task renders the full list bounded by a constant window.

**Deliverable**:
- `src/panel/overview.ts` — pure row builder (marker + group header + ▲ gate logic), cursor/scroll model, and the `overviewJump` action (new file).
- `src/panel/overview.test.ts` — unit tests (new file).
- Surgical edits to `src/panel/keys.ts` (view-gated up/down/enter/prev/next in overview) and `src/panel/panel.ts` (real overview branch in `buildLines`; overview cursor state).

**Success Definition**: AC-6-ready — `ctrl+l` shows every question with correct markers, group headers, and `▲` on the gate group; `↑/↓` (or the config question-nav keys) move a cursor row; `enter` closes the overview, focuses that question in the short form with options focus restored; `esc` returns to the prior view (deepSticky-aware — existing ladder); moot row shows `⊘ moot — {reason}` dimmed (AC-6); this is the R1 navigation-freedom surface.

## User Persona

**Target User**: The pi user being interrogated.
**Use Case**: The user wants to see the whole questionnaire at a glance — what's answered, what was re-asked, what went moot and why — and jump straight to any question (including back to an earlier one, R1).
**User Journey**: short form → `ctrl+l` → scan the marked list / group headers → `↑/↓` to a row → `enter` → short form now on that question, cursor on options. Or `esc` to go back without moving.
**Pain Points Addressed**: long interrogations lose the map; moot questions disappear silently; no way to see which group still has open work.

## Why

- FR-11 (h2.3.1) + h2.29: the overview is the navigation-freedom surface for hard requirement R1 — users must be able to reach and revisit any question.
- Consumes the panel host (P1.M3.T1.S1), short view (P1.M3.T2.S1), key router (P1.M3.T3.S1), moot reasons from the dependsOn evaluator (P1.M1.T2.S3), and exists as a sibling of the deep view (P1.M5.T1.S1, in flight — see Integration).
- Moot/withdrawn visibility (Q34=A audit trail) — dimmed rows with reasons, never hidden.

## What

- `ctrl+l` (already wired: keys.ts `onOverview` sets `view = "overview"`) opens the list; `esc` returns (existing `escapeDescend` — DO NOT re-implement).
- Overview render replaces everything between header and footer: `renderHeader` (unchanged) at top, the question list, then `renderFooter(snapshot, "overview", ...)` (layout.ts ALREADY supports the "overview" screen — no changes).
- One row per question in `state.orderedQuestions()` order — NEVER filtered (R1): `{marker} {title or prompt}` truncated to budget. Dimmed entirely when `status` is `moot` or `withdrawn`. Moot rows append ` — {reason}` dimmed. The cursor row gets the `▸ ` prefix (2 visible cols), others two spaces (short-view.ts alignment pattern).
- Group headers: a dimmed header line `{group label}` inserted whenever the question's effective group (`q.group ?? "(none)"`) differs from the previous question's. The gate group (any member with `gate === true`) header renders `{group label} ▲`. `▲` is a group-level attribute computed from membership (a question's own `gate` flag marks its group).
- Cursor row state: an index into the QUESTION rows (group headers are not cursor targets). Entering overview seeds it to the CURRENT question's index (so `ctrl+l`/`esc` round-trips leave you where you were); clamp to `[0, questions.length-1]`.
- `↑/↓` in overview move the cursor (never `optionUp/optionDown`, never `currentId`); the config `prevQuestion`/`nextQuestion` accelerators ALSO move it while in overview (contract 3: "cursor up/down (or config question nav keys)"). `enter` jumps: set `panel.currentId` to the selected question's id (the setter re-seeds `cursorIndex` — R2 preselect preserved), `panel.setView("short")`, and restore focus to `"options"` (if the editor was focused — `blurTextField()`; a note stays held untouched, the note-mode branch renders before views anyway).
- Scroll window: the list renders inside a constant-height window `OVERVIEW_HEIGHT = 20` content lines (terminal-height adaptation is P1.M7.T5.S1); scroll offset clamps so the cursor row is always visible (`[rowIdx - OVERVIEW_HEIGHT + 1, rowIdx]` intersect global bounds — simpler than deep view's sticky rule; no sticky headers here).
- JUMP target is always the SHORT form (even when `deepSticky` is true — contract 3 says "jumps to that question in short form"; the user can re-enter deep with `ctrl+d`, and deepSticky remains set for the next esc-from-overview).

### Success Criteria

- [ ] `ctrl+l` renders ALL questions in order with markers `· ★ ⟳ ⊘ ⊗ ✎`, correct per status (✎ combines with others when a text answer exists)
- [ ] Group headers at boundaries; gate group header shows `▲`; ungrouped bucket uses `"(none)"`
- [ ] Moot row: `⊘ … — {reason}` dimmed; withdrawn row: `⊗ …` dimmed — both still listed (Q34=A)
- [ ] `↑/↓` and config prev/next keys move the cursor; cursor row always visible (window clamp)
- [ ] `enter` jumps: view "short", current question = selected, focus "options", cursor preseeded
- [ ] `esc` from overview returns to `deepSticky ? deep : short` — existing ladder, untouched
- [ ] Footer shows the "overview" screen keys (already in layout.ts — verify only)
- [ ] All existing tests pass (`npx vitest run`, `npx tsc --noEmit`)

## All Needed Context

### Context Completeness Check

Verified: an agent with only this PRP + the listed files has the full picture. The toggle (`onOverview`), esc ladder (`escapeDescend`), `PanelView` plumbing, and the view-aware footer ALREADY exist — this task renders the list, owns the cursor, and reroutes five dispatch cases.

### Documentation & References

```yaml
- file: src/panel/short-view.ts
  why: THE pattern to follow — pure renderer, INSET/CURSOR/BLANK constants, marker glyph vocabulary JSDoc, mootReason() helper
  pattern: pure (inputs) → string[]; alignment via equal-width prefixes; truncateVisible everywhere
  gotcha: mootReason() reads q.answer?.value, but depends-on.ts writes h2.29-format reasons; write a local overviewMootReason(q) reading q.answer?.text ?? q.answer?.value ?? "dependency changed" (mirrors layout.ts statusMarkers)

- file: src/panel/panel.ts
  why: Host — overview placeholder branch at the end of buildLines (~"return [\"[overview] placeholder...\"]"); view/focus/cursorIndex state; currentId setter re-seeds cursorIndex; blurTextField(); note-mode branch renders FIRST
  pattern: short-view branch of buildLines for structure (header … list … flash … footer)
  gotcha: note mode is view-agnostic and must keep winning — the overview branch sits AFTER the focus==="note" branch (already the case); never await in render paths

- file: src/panel/keys.ts
  why: The router to make view-aware — step 1 (up/down), step 3 (enter), step 4 (prevQuestion/nextQuestion); onOverview/escapeDescend already correct
  pattern: matchesKey(data, Key.up) fixed checks; resolution order 1→5
  gotcha: arrows BEFORE esc (ESC-prefixed sequences) — never reorder; PARALLEL TASK P1.M5.T1.S1 (deep view) adds view-gating for "deep" in the SAME steps 1/3 — merge your conditions into the same view-gate (e.g. if view==="overview" … else if view==="deep" … else optionUp/Down) rather than adding a second layer; digits quick-select must NOT fire in overview (it would accept an option on the current question) — gate digits on view !== "overview"

- file: src/panel/layout.ts
  why: renderHeader, renderFooter (ScreenKind "overview" ALREADY wired: SCREEN_KEYS.overview + "enter jump · esc back" statics), truncateVisible, visibleWidth, UNGROUPED_LABEL export
  pattern: import { renderHeader, renderFooter, truncateVisible, UNGROUPED_LABEL } from "./layout.js"
  gotcha: verify only — do not modify layout.ts unless the overview footer statics are missing (they are present per source read)

- file: src/panel/actions.ts
  why: R1 navigation semantics reference (prevQuestion/nextQuestion clamped ±1, no filtering); nextUnanswered exported
  pattern: actions mutate panel + invalidate, return boolean consumed
  gotcha: do NOT call panelActions.prevQuestion/nextQuestion while view==="overview" — they change currentId; route to overview cursor instead

- file: src/state.ts
  why: Question shape (group?, gate?, status, answer{value,text?}), orderedQuestions(), UNGROUPED_LABEL, statuses open/answered/submitted/reasked/moot/withdrawn/closed
  pattern: panel.state.orderedQuestions() is the render order source
  gotcha: "submitted" and "closed" questions still list — marker rules below; `submitted` shows ★ (it carries an answer); `closed` shows ★ too if answered (h2.38 archived-but-answerable)

- file: plan/001_0d6760db6bc5/P1M5T1S1/PRP.md
  why: CONTRACT for the parallel deep-view task — it edits keys.ts steps 1/3 with "deep" gating and panel.ts buildLines deep branch; assume it lands exactly as specified
  gotcha: coordinate the shared edit sites: one combined view-gate in keys.ts steps 1/3, one if/else-if chain in buildLines (note → short → deep → overview)
```

### Current Codebase tree (relevant slice)

```bash
src/
  state.ts             # Question.group/gate/status, orderedQuestions(), UNGROUPED_LABEL
  config.ts            # KeyAction "overview" (ctrl+l), digitQuickSelect
  panel/
    panel.ts           # InterrogationPanel — overview placeholder in buildLines
    layout.ts          # renderHeader/renderFooter (overview screen READY), truncateVisible
    short-view.ts      # pure-renderer pattern, marker vocabulary, mootReason
    actions.ts         # prevQuestion/nextQuestion (R1), nextUnanswered
    keys.ts            # config-driven router (steps 1/3/4 need overview gating)
    *.test.ts          # colocated vitest
```

### Desired Codebase tree with files to be added

```bash
src/panel/
  overview.ts          # NEW — row builder (markers/groups/▲), cursor+scroll model, overviewJump
  overview.test.ts     # NEW — unit tests
  keys.ts              # MODIFIED — overview-gated up/down/enter/prev/next; digits gated off in overview
  panel.ts             # MODIFIED — real overview branch in buildLines; overview cursor state + seeding
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: arrows are ESC-prefixed — keys.ts checks up/down BEFORE esc; never reorder.
// CRITICAL: display text is ANSI/wide-char — only truncateVisible/visibleWidth, never .slice().
// CRITICAL: panel.render(width) has NO height — the window cap is the module constant
//   OVERVIEW_HEIGHT = 20, not terminal rows (adaptation is P1.M7.T5.S1).
// CRITICAL: group headers are NOT cursor rows — the cursor indexes QUESTION rows only;
//   when computing header insertion, track both lists (row list + question-row indices).
// CRITICAL: entering overview seeds the cursor to the current question's index ONCE
//   (on the setView("overview") transition, mirroring how deep view seeds) — not per render.
// CRITICAL: parallel P1.M5.T1.S1 edits the SAME keys.ts steps and the SAME buildLines
//   if/else chain — merge gates; never duplicate or reorder the chain.
// CRITICAL: ✎ (has text answer) can co-occur with ★/⟳ — marker precedence order:
//   withdrawn ⊗ > moot ⊘ > re-asked ⟳ (+✎ appended) > answered ★ (+✎) > open ·.
//   ("submitted"/"closed" with an answer show ★ — h2.38.)
// CRITICAL: renderers are pure — no state mutation, no I/O; cursor/scroll live on the panel.
```

## Implementation Blueprint

### Data models and structure

No new persistent models. Panel-local state (panel.ts):

```typescript
/** Overview cursor — index into orderedQuestions() (NOT into rendered rows). */
overviewCursor = 0;
/** Overview scroll offset in rendered LINES, clamped to keep the cursor row visible. */
overviewScroll = 0;
```

New exported types in overview.ts:

```typescript
export interface OverviewInput {
  ordered: Question[];        // state.orderedQuestions()
  cursorIndex: number;        // index into ordered
  theme: Theme;
  width: number;              // full panel width; content budget = width - 2 (INSET)
}
export interface OverviewContent {
  lines: string[];            // flattened rows incl. group headers
  /** Per question i: rendered-line index of its row (for the scroll clamp). */
  questionRowLine: number[];
  viewportHeight: number;     // OVERVIEW_HEIGHT
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/panel/overview.ts — marker + row builder (pure)
  - IMPLEMENT: overviewMarker(q): string — [Mode A] JSDoc REQUIRED documenting the glyph
    semantics (contract 5): "·" open, "★" answered (any status carrying q.answer —
    answered/submitted/closed after an answer), "⟳" reasked, "⊘" moot, "⊗" withdrawn;
    "✎" appended (space-joined) whenever q.answer?.text is non-empty (has text answer).
    Precedence: withdrawn > moot > reasked > answered > open; ✎ composes with ⟳/★.
  - IMPLEMENT: overviewMootReason(q): string — q.answer?.text ?? q.answer?.value ??
    "dependency changed" (depends-on.ts writes h2.29-format reasons like
    "moot: storage=sqlite" into the answer; mirror layout.ts statusMarkers' read).
  - IMPLEMENT: buildOverviewContent(input): OverviewContent
    - iterate ordered; effective group = q.group ?? UNGROUPED_LABEL; when it differs
      from the previous question's, push a dimmed header line `{group} ▲` when ANY
      question in that group (scan ordered) has gate === true, else `{group}`
    - question row: `{prefix}{marker} {title-or-prompt}` — prefix "▸ " when i ===
      cursorIndex else "  " (short-view.ts alignment); moot row appends dimmed
      ` — {overviewMootReason(q)}` within budget; whole row dimmed when moot/withdrawn
    - every line visibleWidth ≤ budget via truncateVisible (title absorbs shrink,
      reason second — mirror renderQuestionLine's shrink priority)
  - FOLLOW pattern: src/panel/short-view.ts (constants, purity, line builders)
  - PLACEMENT: src/panel/overview.ts

Task 2: CREATE src/panel/overview.ts — cursor + scroll window
  - IMPLEMENT: clampOverviewScroll(content, scroll, cursorIndex): number — global bounds
    [0, max(0, lines.length - viewportHeight)] intersected with
    [rowLine - viewportHeight + 1, rowLine] so the cursor row is always inside
  - IMPLEMENT: overviewUp(p)/overviewDown(p): mutate panel.overviewCursor within
    [0, ordered.length-1], recompute overviewScroll, panel.invalidate() — NEVER touch
    currentId or cursorIndex
  - PLACEMENT: same file, below the builder

Task 3: CREATE src/panel/overview.ts — overviewJump
  - IMPLEMENT: overviewJump(panel): boolean
    - no questions → consumed no-op true (flash "no questions" via panel.flash)
    - q = ordered[panel.overviewCursor]; if q undefined → false
    - if panel.focus === "text" → panel.blurTextField(); else if focus === "note"
      leave note mode alone (enter in note focus never reaches here — panel.handleInput
      stage-1 intercepts; defensive: do nothing to focus when "note")
    - panel.currentId = q.id   // setter re-seeds cursorIndex (R2 preselect)
    - panel.setView("short"); panel.overviewScroll = 0; return true
  - FOLLOW pattern: actions.ts stepQuestion (mutate panel.currentId + invalidate + bool)
  - PLACEMENT: same file; export alongside the cursor movers

Task 4: MODIFY src/panel/keys.ts — view-gated dispatch (surgical, MERGE with deep gating)
  - STEP 1 (up/down): when panel.view === "overview" → overviewUp/overviewDown;
    MERGE with the in-flight "deep" gate from P1.M5.T1.S1 into one view-switch
    (if overview → overview movers; else if deep → deep movers; else optionUp/Down)
  - STEP 3 (enter): when panel.view === "overview" AND panel.focus !== "text" →
    overviewJump(panel) (before the generic accept branch)
  - STEP 4 (prevQuestion/nextQuestion): when panel.view === "overview" → route to
    overviewUp/overviewDown (contract 3: config question-nav keys move the cursor);
    otherwise unchanged
  - STEP 4 (digits): add view !== "overview" to the digit quick-select gate
  - DO NOT touch: esc ladder (overview → deepSticky?deep:short — already correct),
    onOverview toggle, step ordering, note-mode seams
  - GOTCHA: esc in TEXT focus while in overview — escapeDescend checks note first then
    view: still correct (descends overview, editor stays focused; jump is what restores
    options focus). Leave as-is.

Task 5: MODIFY src/panel/panel.ts — real overview branch + seeding
  - REPLACE the "[overview] placeholder" branch: renderHeader(snapshot) line, then the
    clamped window slice of buildOverviewContent({...}), then flash line, then
    renderFooter(snapshot, "overview", ...) — mirroring the short branch's structure
  - WIRE seeding: on setView("overview") (only when previous view !== "overview"),
    seed overviewCursor = index of currentId in orderedQuestions() (0 when absent),
    overviewScroll = 0. If P1.M5.T1.S1 added seeding inside setView for "deep",
    extend the same transition block — one switch, per-view branches.
  - KEEP: note-mode branch first, render caching/invalidate discipline untouched
  - ADD fields overviewCursor/overviewScroll (blueprint above)

Task 6: CREATE src/panel/overview.test.ts + EXTEND keys.test.ts / panel.test.ts
  - overview.test.ts: overviewMarker (every status, ✎ composition, precedence),
    overviewMootReason (answer.text preferred, fallback), buildOverviewContent
    (group headers at boundaries, ungrouped "(none)", ▲ on gate group, ▸ cursor row
    alignment, moot/withdrawn dimmed + reason, width truncation), clampOverviewScroll
    (bounds + cursor-visibility), overviewUp/Down (clamping, no currentId change),
    overviewJump (view short, currentId set, focus options from text, cursor reseed,
    empty-state no-op)
  - keys.test.ts additions: up/down in overview route to overview movers (not
    optionUp/Down); enter in overview jumps; config prev/next keys move the cursor in
    overview; digits do NOT quick-select in overview; esc overview→short and
    overview→deep (deepSticky) unchanged; ctrl+l toggles back
  - panel.test.ts additions: buildLines overview branch = header + window + footer;
    entering overview seeds cursor to current question; window keeps cursor visible
  - FOLLOW pattern: short-view.test.ts (pure renderer), keys.test.ts (raw key bytes)
  - PLACEMENT: colocated
```

### Implementation Patterns & Key Details

```typescript
// Scroll clamp (Task 2) — simpler than deep view (no sticky headers):
// const max = Math.max(0, content.lines.length - content.viewportHeight);
// const row = content.questionRowLine[cursorIndex] ?? 0;
// return Math.max(0, Math.min(Math.max(scroll, row - content.viewportHeight + 1),
//                              Math.min(row, max)));

// Marker (Task 1):
// function overviewMarker(q: Question): string {
//   let m = "·";
//   if (q.answer !== undefined && q.status !== "moot" && q.status !== "withdrawn") m = "★";
//   if (q.status === "reasked") m = "⟳";
//   if (q.status === "moot") m = "⊘";
//   if (q.status === "withdrawn") m = "⊗";
//   if ((q.answer?.text ?? "") !== "" && m !== "⊗" && m !== "⊘") m += " ✎";
//   return m;
// }

// Gate group detection: precompute ONE set of gate groups before the loop:
// const gateGroups = new Set(ordered.filter(q => q.gate).map(q => q.group ?? UNGROUPED_LABEL));
// header: gateGroups.has(group) ? `${group} ▲` : group   (dimmed)

// keys.ts step 1 (surgical merge with the in-flight deep gating):
// if (matchesKey(data, Key.up)) {
//   if (panel.view === "overview") return overviewUp(panel);
//   if (panel.view === "deep") return deepSelectionUp(panel); // P1.M5.T1.S1
//   return actions.optionUp(panel);
// }
```

### Integration Points

```yaml
VIEW STATE: PanelView "overview" exists; add overviewCursor/overviewScroll fields
FOOTER: layout.ts "overview" screen READY (SCREEN_KEYS.overview + "enter jump · esc back") — verify only
KEYS: no config changes; KeyAction "overview" (ctrl+l) already default
NO state.ts / delivery / persistence changes — pure presentation + jump reuse
PARALLEL: P1.M5.T1.S1 (deep view, in flight) shares keys.ts steps 1/3 and the
  buildLines chain — merge gates, do not duplicate; note-focus branch wins over all views
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npx tsc --noEmit          # zero errors
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/overview.test.ts
npx vitest run src/panel/keys.test.ts src/panel/panel.test.ts
npx vitest run             # full suite — no regressions
```

### Level 3: Integration (manual/TUI smoke — record for M7.T6.S2)

```bash
# Scripted setup via debug commands:
#   /interrogate-debug-upsert with a fixture: questions across 2+ groups, one gate group,
#   one dependsOn-mooted question (answer its dependency to moot it), one withdrawn
#   (upsert omission), one answered, one text-answered
# Manual: ctrl+l → verify markers/groups/▲/dimmed moot+reason; ↑/↓ + config prev/next
#   keys; enter jumps to short form on that question; esc round-trip restores
#   deep when deepSticky; ctrl+shift+m note field still renders while in overview.
```

### Level 4: Edge cases (scripted)

```bash
npx vitest run src/panel/overview.test.ts -t "marker"    # all status/✎ combinations
npx vitest run src/panel/overview.test.ts -t "scroll"    # clamp with long lists
npx vitest run src/panel/overview.test.ts -t "gate"      # ▲ and ungrouped bucket
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` — full suite green (including P1.M5.T1.S1's deep-view tests once merged)
- [ ] No new dependencies

### Feature Validation

- [ ] All markers correct per status; ✎ composes with ⟳/★; moot shows reason dimmed (AC-6)
- [ ] Group headers at boundaries; `▲` marks the gate group; `"(none)"` bucket works
- [ ] Cursor moves via ↑/↓ AND config prev/next keys; always visible within the window
- [ ] `enter` jumps to the short form on the selected question, options focus restored
- [ ] `esc` returns via the existing ladder; nothing destroyed; deepSticky honored
- [ ] Moot/withdrawn rows present and dimmed (audit trail), never filtered
- [ ] Note mode still renders while overview is the nominal view (FR-13 "at any time")

### Code Quality Validation

- [ ] overview.ts is a pure renderer + cursor/jump actions, mirroring short-view.ts
- [ ] keys.ts edits surgical and merged with deep-view gating; order preserved
- [ ] Digits quick-select disabled in overview
- [ ] [Mode A] JSDoc on marker semantics present (contract 5)
- [ ] No conflicts with parallel P1.M5.T1.S1 (shared edit sites merged, not duplicated)

## Anti-Patterns to Avoid

- ❌ Don't re-implement the ctrl+l toggle, esc ladder, or deepSticky bookkeeping — they exist and are correct
- ❌ Don't slice display strings — truncateVisible/visibleWidth only
- ❌ Don't let up/down or prev/next change `currentId` while in overview — the ONLY exit-to-question is `enter` (or esc)
- ❌ Don't derive the window height from the terminal — constant; adaptation is M7.T5.S1
- ❌ Don't filter moot/withdrawn/closed rows out of the list (R1/Q34=A)
- ❌ Don't duplicate the deep-view view-gates in keys.ts — merge into one switch
- ❌ Don't mutate state from renderers; don't await in render paths

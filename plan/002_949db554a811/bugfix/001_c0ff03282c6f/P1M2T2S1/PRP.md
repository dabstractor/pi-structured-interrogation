---
name: "bugfix P1.M2.T2.S1 — ✎ marker parity: hasTextAnswer honors answer.custom (BUG-005 part 1)"
description: "One-line semantic fix in src/panel/layout.ts: the module-private hasTextAnswer (:181-186) additionally returns true when q.answer.custom === true (strict), so a CHOICE write-in answer renders the ✎ question-line marker via statusMarkers — matching the overview's markerParts vocabulary (custom === true || type text → ✎). Elaboration (answer.text) semantics unchanged; marker string stays '✎ text answer'. TDD: extend layout.test.ts statusMarkers suite + one short-view render sweep proving the marker appears on the question line for a custom answer. No other file changes."
---

## Goal

**Feature Goal**: BUG-005 part 1 (bug report h3.4, recommendation: "Include answer.custom in hasTextAnswer"): a CHOICE question answered via write-in (`answer = { value, custom: true, at }`, no `text` field) renders the `✎` marker on the short-view question line — the same glyph the overview already shows for the same answer. Consistent marker semantics across surfaces.

**Deliverable**: Modified `src/panel/layout.ts` (hasTextAnswer + comment), extended `src/panel/layout.test.ts`, one render assertion in `src/panel/short-view.test.ts` (or panel.test.ts) proving the marker reaches the composed question line.

**Success Definition**: `npm test` + `npm run typecheck` green; question with `{value:'my write-in', custom:true}` → question line carries `✎ text answer` marker; plain option answers show no marker; elaborations (`answer.text`) unchanged; text questions unchanged.

## User Persona

**Target User**: TUI user revisiting a question they answered with a write-in — the question line must advertise "this was hand-written" the same way the overview does, or the two surfaces disagree about the same answer.

**Use Case**: Answer q1 via `✎ Other` → navigate away → come back (or scan the panel): the question line shows the ✎ marker today only for text/elaborated questions; write-ins were invisible (BUG report repro: `'(none) · Q1/q1 Pick'` — no ✎).

**User Journey**: unchanged interactionally — this is display parity only.

**Pain Points Addressed**: Inconsistent ✎ semantics between question line and overview for the same answer; recorded write-ins invisible in the panel (partially — S2's revisit preview completes it).

## Why

- Bug report h3.4 (BUG-005) location 1: "layout.ts hasTextAnswer (:181-186, feeds the short-view question-line ✎ marker) checks `q.type === 'text' || answer.text` but not `answer.custom`".
- h2.5 recommendation: "Include answer.custom in hasTextAnswer and render the recorded value … in the revisit preview" — the value-preview half is P1.M2.T2.S2, NOT this item.
- The overview already got it right (`markerParts`: `custom === true || type text` → ` ✎`); this aligns the question line's vocabulary.

## What

In `src/panel/layout.ts`:

```ts
/** True when the question's answer carries (or is) free text. */
function hasTextAnswer(q: Question): boolean {
  if (q.status !== "answered" && q.status !== "submitted") return false;
  if (q.answer === undefined) return false;
  // BUG-005 part 1 (WRITEIN-001 parity): a write-in answer (custom: true,
  // value holds the user's own text — committed with NO text field) is a
  // text answer for marker purposes, matching overview markerParts
  // (custom === true || type text → ✎). STRICT true — corrupt truthy
  // values must not leak (same discipline as overview.ts).
  if (q.answer.custom === true) return true;
  return q.type === "text" || (q.answer.text !== undefined && q.answer.text !== "");
}
```

That is the entire logic change. `statusMarkers`' marker string stays `"✎ text answer"` (vocabulary parity means the ✎ glyph; the overview's ✎/≡ split is NOT imported — elaboration keeps its existing `"✎ text answer"` marker per the pinned test at layout.test.ts:176–178). Update `statusMarkers`' docblock (:289–291 "Markers: …") and `hasTextAnswer`'s one-liner to name write-ins.

### Success Criteria

- [ ] Choice question, status answered/submitted, `answer = {value:'my write-in', custom:true, at}` → `statusMarkers(q, theme)` contains `" ✎ text answer"`
- [ ] Composed question line (short-view render at width 100) shows the marker for that answer
- [ ] Plain option answer (`{value:'a', at}`, no custom/text) → no ✎ (unchanged)
- [ ] Elaboration (`{value:'a', text:'why', at}`) → `" ✎ text answer"` (unchanged — existing test :176–178 stays green as-is)
- [ ] Text question with plain value → `" ✎ text answer"` (unchanged)
- [ ] custom falsy-but-not-true (e.g. `"yes"` string from corrupt input) → treated as NOT a write-in (strict `=== true`)
- [ ] Open/unanswered/moot/withdrawn statuses → no ✎ from this path (guard clauses unchanged)
- [ ] `npm test` + `npm run typecheck` green

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets the exact current function, its sole call site, the marker string to emit, the strict-true discipline, the pinned tests that must NOT change, and the boundary against sibling S2. Nothing to guess.

### Documentation & References

```yaml
- file: src/panel/layout.ts
  why: hasTextAnswer (:181-186 — the fix), its SOLE caller statusMarkers (:298-309, exported — "✎ text answer" string at :301), docblocks to update (:289-291)
  pattern: strict === true check, mirroring overview.ts's "corrupt truthy values must not leak" comment
  gotcha: marker string stays "✎ text answer" — do NOT import the overview's " ✎"/" ≡" suffix split here

- file: src/panel/overview.ts
  why: markerParts (~:130-141) — the ALREADY-CORRECT vocabulary this fix matches (isWriteIn = answer?.custom === true; isTextAnswer = type text && answer defined → " ✎")
  gotcha: read for reference only — no changes to overview.ts

- file: src/panel/layout.test.ts
  why: statusMarkers describe (:147-179), mkQuestion helper, exact-string assertions (:173 text question, :178 elaboration) that pin unchanged behavior
- file: src/panel/short-view.test.ts
  why: render(width) sweep convention for the composed question line (docblock :7 names the marker); add the write-in render assertion here (or in panel.test.ts if the question-line composition is exercised there)

- file: src/panel/actions.ts
  why: writeInEnter (:281) commits { value: text, custom: true, at } with NO text field — the answer shape that must trigger the marker

- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/prd_snapshot.md (h2.0 overview, h2.3/h3.4 BUG-005, h2.5 recommendations)
  why: the defect, the repro, and the mandated remedy
```

### Current Codebase tree (relevant slice)

```bash
src/panel/ layout.ts overview.ts short-view.ts actions.ts (+ layout.test.ts short-view.test.ts)
```

### Desired Codebase tree

```bash
# no new files
src/panel/layout.ts        # MODIFIED: hasTextAnswer + docblocks
src/panel/layout.test.ts   # MODIFIED: new statusMarkers cases
src/panel/short-view.test.ts (or panel.test.ts)  # MODIFIED: one render assertion
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// STRICT === true for custom (corrupt truthy values must not leak — overview.ts discipline; state.ts deserialize :551 revives custom the same way)
// Write-in answers carry NO answer.text — the (text !== undefined && text !== "") clause never fires for them; that's the bug
// Elaboration semantics unchanged: the pinned test at layout.test.ts:176-178 (choiceWithNote → " ✎ text answer") must stay green UNMODIFIED
// statusMarkers wraps the whole fragment in theme.fg("dim", ...) — assert with the stubTheme's dim codes like existing tests do (toBe(" ✎ text answer") works because the stub theme passes through)
// moot branch also reads answer.text for the reason — custom answers have no text → bare "⊘ moot"; no interaction with this change
```

## Implementation Blueprint

### Data models and structure

None — display predicate only.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: TDD — ADD failing tests first
  - layout.test.ts statusMarkers describe:
      * writein_choice_answer_shows_text_answer_marker: mkQuestion({type:"choice" default, status:"answered",
        answer:{value:"my write-in", custom:true, at:"..."}}) → toBe(" ✎ text answer")
      * writein_submitted_status_also_marks (status "submitted")
      * custom_strict_true_only: answer:{value:"x", custom:"yes" as unknown, at} → "" (no marker)
      * plain_option_answer_still_no_marker (regression guard)
  - short-view render sweep: build the q via the file's question fixture, render at width 100,
     assert the question line contains "✎ text answer" (match the file's existing line-matching style)

Task 2: MODIFY src/panel/layout.ts hasTextAnswer (code in What §) + update the two docblocks
  (hasTextAnswer one-liner and statusMarkers' "Markers:" list — name write-ins: custom answers)

Task 3: GATES
  - npx vitest run src/panel/layout.test.ts src/panel/short-view.test.ts
  - npm test && npm run typecheck   # overview.test.ts, panel.test.ts untouched and green
```

### Implementation Patterns & Key Details

See What § for the exact function. Order the custom check BEFORE the text/elaboration disjunction for readability (both are pure reads; order is not load-bearing).

### Integration Points

```yaml
DOWNSTREAM (do NOT implement):
  - P1.M2.T2.S2: revisit preview (answerPreviewLine) renders the recorded value — the OTHER half of BUG-005; this item's marker makes S2's render visible/consistent
  - P1.M3.T2: README write-in passages sweep (no docs here)
CONFIG/STATE/EVENTS: none
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npx vitest run src/panel/layout.test.ts
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/overview.test.ts src/panel/short-view.test.ts src/panel/panel.test.ts
npm test   # full suite — elaboration/text/moot marker pins unchanged
```

### Level 3: Integration Testing

Not applicable — pure render predicate; the render-sweep test IS the composed-surface proof.

### Level 4: Domain Validation

Diff review: the ONLY logic line added is the `if (q.answer.custom === true) return true;` guard; docblock mentions updated; no string/format changes elsewhere.

## Final Validation Checklist

- [ ] `npm test` + `npm run typecheck` green
- [ ] Write-in (custom:true) → `✎ text answer` on the question line (unit + render sweep)
- [ ] Elaboration/text/plain-option behavior byte-identical (existing pins green unmodified)
- [ ] Strict `=== true`; falsy-but-truthy corrupt values rejected
- [ ] No changes to overview.ts, short-view.ts source, actions.ts, state.ts
- [ ] Docblocks on hasTextAnswer + statusMarkers name write-ins

---

## Anti-Patterns to Avoid

- ❌ Don't import/reimplement the overview's ✎/≡ suffix split — question-line vocabulary is "✎ text answer" for all text-bearing answers
- ❌ Don't touch answerPreviewLine or any revisit-preview logic — that's P1.M2.T2.S2
- ❌ Don't loosen the strict-true check (`if (q.answer.custom)`) — corrupt truthy leakage is an explicitly guarded class in this codebase
- ❌ Don't modify the moot-reason path or status guards while editing the function
- ❌ Don't update pinned elaboration tests to expect new behavior — elaboration is UNCHANGED

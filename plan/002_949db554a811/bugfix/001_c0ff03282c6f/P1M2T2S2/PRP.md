---
name: "bugfix P1.M2.T2.S2 — Revisit preview: render the recorded write-in/text value as the dimmed answer preview (BUG-005 part 2)"
description: "Fix the dead preview in src/panel/short-view.ts answerPreviewLine (:259-269): it reads only q.answer?.text, but write-in and text answers commit to answer.value (custom:true), so the dimmed current-value preview never renders for them. New read: dimmed FIRST LINE of (answer.custom === true || q.type === 'text') ? answer.value : answer.text, truncated via truncateVisible to the existing region budget. Empty/undefined renders nothing (unchanged). TDD, no mocks. Cursor stays on the ★ preselect by design (panel.ts:368) — do NOT add cursor sync. Independent of the ✎ marker fix (P1.M2.T2.S1) but complements it."
---

## Goal

**Feature Goal**: BUG-005 part 2 (bug report h3.4): on revisit, a recorded write-in (`answer = { value, custom: true, at }`) or text answer (`answer.value`) renders its value as the dimmed first-line preview in the short view — closing the gap where "there is no way to see what a recorded write-in answer says anywhere in the panel".

**Deliverable**: Modified `src/panel/short-view.ts` (`answerPreviewLine` read logic + JSDoc) + new cases in `src/panel/short-view.test.ts`.

**Success Definition**: `npm test` + `npm run typecheck` green; `renderShortView` with `currentId` on a choice question answered `{value:'my write-in', custom:true}` shows a dimmed preview line containing `my write-in`; same for a text question with `{value:'text answer'}`; multi-line values show only line one; the existing hand-set `answer.text` test (:197) stays green; empty/undefined answers render nothing.

## User Persona

**Target User**: TUI user returning to a question they answered via write-in — they need to see what they answered without leaving the panel for the transcript card or a model read.

**Use Case**: Revisit q1 (choice, custom write-in 'my write-in') → dimmed preview under the options/Other rows shows `my write-in`. Revisit q2 (type text, value 'text answer') → preview under the `✎ answer…` affordance (already the text-question layout slot at :171-173).

**Pain Points Addressed**: Recorded write-in answers invisible everywhere in the panel (short view dead preview, overview glyph-only, deep view options-only).

## Why

- Bug report h3.4 location 2: "answerPreviewLine (short-view.ts:259) reads `q.answer?.text` — but text/write-in answers are committed to `answer.value` (custom:true), so the 'dimmed current-value preview' is dead code".
- h2.5 recommendation: "render the recorded value (first line) in the revisit preview for text/write-in answers".
- Independent of P1.M2.T2.S1 (the ✎ marker in layout.ts `hasTextAnswer`) — together they close BUG-005.

## What

### The fix — `src/panel/short-view.ts` `answerPreviewLine` (:259-269)

Current body reads `const text = q.answer?.text;` and returns `undefined` for empty. Replace the read only:

```ts
// BUG-005 part 2: write-in (custom: true) and text answers commit to
// answer.value; elaborations ride answer.text. Read whichever field the
// recorded answer actually used — same vocabulary as overview markerParts
// (custom === true || type text → value) and cancelTextConfirm's seed read.
const a = q.answer;
const text =
  a !== undefined && (a.custom === true || q.type === "text") ? a.value : a?.text;
if (text === undefined || text === "") return undefined;
// ... rest unchanged: split("\n", 1)[0], truncateVisible(firstLine,
// Math.max(1, budget - INSET.length - BLANK.length)), undefined on ""
```

- `a.custom === true` STRICT (serialized state revives custom as strict true — state.ts precedent); a missing `value` on a custom answer yields `undefined` → no line (defensive).
- Elaboration semantics unchanged: a choice answer with `answer.text` (and no custom) still previews the elaboration — same as today.
- Choice-question answers (`value` = option value, no custom, no text) still render nothing (option rows already show the recorded selection via their own check-marking — do NOT preview option values).
- Update the function's JSDoc: "the first line of the recorded answer — `answer.value` for write-ins (custom) and text questions, `answer.text` for elaborations".
- The call site (:171) already runs for `q.type === "text"` only. For CHOICE write-ins the preview line must ALSO render: add the call to the choice branch (after the option rows + Other row push, before the soft-gate wrap):

```ts
} else {
  // ...options loop + otherRow pushes...
  const preview = answerPreviewLine(q, theme, budget, dimAll);
  if (preview !== undefined) lines.push(preview);
}
```

(Only custom write-ins on choice questions produce a defined value here — plain option answers return undefined.)

### Success Criteria

- [ ] Choice q `{value:'my write-in', custom:true, status:'answered'}`, `render(100)` with currentId on it → a dimmed line containing `my write-in` appears below the Other row
- [ ] Text q `{value:'text answer'}` → dimmed preview under `✎ answer…` (existing slot)
- [ ] Multi-line value `'line one\nline two'` → preview shows only `line one`
- [ ] Long value truncates via truncateVisible (no wrap) — narrow-width render (e.g. width 40) stays one line
- [ ] Elaboration-only answer (`{value:'a', text:'note'}` no custom) → previews `note` (unchanged behavior)
- [ ] Plain option answer (no custom, no text) → NO preview line (unchanged)
- [ ] Undefined/empty answer → no line (unchanged)
- [ ] Existing short-view.test.ts:197 (hand-set `answer.text`) green UNMODIFIED
- [ ] No mocks; no cursor changes (panel.ts:368 ★ preselect stays); no changes outside short-view.ts + its test

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets: the exact current function body, the exact new read expression, the choice-branch call-site insertion, the field vocabulary precedent (overview markerParts / cancelTextConfirm), the strict-custom rule, and the test harness shape (textQ/render helpers, hand-set answer shapes). No guessing.

### Documentation & References

```yaml
- file: src/panel/short-view.ts
  why: answerPreviewLine (:259-269 — the function to fix, quoted above), renderShortViewOptions (:155-180 — the text/choice branch split
       and the preview call site at :171-173), otherLine/optionLine (row order the preview follows)
  pattern: reuse the existing first-line split + truncateVisible budget math verbatim
  gotcha: the preview is pre-dimmed via theme.fg("dim", ...) inside the builder — do not double-dim on the soft-gate wrap

- file: src/panel/short-view.test.ts
  why: textQ() (:60) and render(q, cursorIndex, theme, width) (:71) helpers; the :197 test that must stay green
       (hand-sets answer.text with multi-line); DIM assertion style
  pattern: extend the "text questions" describe block + add a choice/custom describe; same render() no-mock style

- file: src/panel/ripple-confirm.ts cancelTextConfirm
  why: the recorded-answer read precedent: type "text" || answer.custom === true → answer.value, else answer.text ?? ""
- file: src/panel/overview.ts markerParts
  why: the marker vocabulary precedent (custom === true || type text → ✎) this preview read mirrors

- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/P1M2T2S1/PRP.md
  why: CONTRACT (parallel) — hasTextAnswer/layout.ts ✎ marker fix; independent file, complementary outcome; do not touch layout.ts here
- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/prd_snapshot.md (h3.4, h2.5 recommendation line)
  why: the bug being fixed + the recommended read rule, verbatim
```

### Current Codebase tree (relevant slice)

```bash
src/panel/ short-view.ts short-view.test.ts layout.ts (S1's target — untouched here) overview.ts ripple-confirm.ts
```

### Desired Codebase tree

```bash
# no new files
src/panel/short-view.ts        # answerPreviewLine read fix + choice-branch call site + JSDoc
src/panel/short-view.test.ts   # new cases (custom write-in, text value, multi-line, truncation, no-preview cases)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// ESM ".js" import suffixes (none new needed — truncateVisible already imported).
// answer.custom is STRICT true when present (serialize revives it as strict true); compare with === true.
// A custom answer with no value field → undefined → no line (never render "undefined").
// Do NOT preview plain option values on choice questions — option rows already mark the recorded selection; previewing duplicates it.
// The dimAll (moot) wrap pass runs over FINISHED lines — the preview builder already applies theme.fg("dim"); double-dimming a moot
//   question is the existing behavior for the text-question preview — match it, don't special-case.
// Do NOT add cursor sync to the recorded answer (panel.ts:368 — ★ preselect on revisit is by design).
// Test fixtures: choice questions need options + answer {value, custom:true, at}; use the existing helpers' Partial<Question> overrides.
```

## Implementation Blueprint

### Data models and structure

None — display-only change; no state, config, or schema edits.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: TESTS FIRST — src/panel/short-view.test.ts
  - ADD cases (What §Success Criteria): choice custom write-in preview; text value preview; multi-line first-line-only;
    narrow-width truncation; elaboration unchanged; plain option answer no preview; empty/undefined no preview
  - NAMING: file's existing test-name style; PLACEMENT: extend "text questions" describe + a new "write-in preview" describe

Task 2: MODIFY src/panel/short-view.ts
  - answerPreviewLine: new read (What §fix) + JSDoc update
  - renderShortViewOptions choice branch: push answerPreviewLine result when defined (after otherRow)

Task 3: GATES
  - npx vitest run src/panel/short-view.test.ts
  - npm test && npm run typecheck
```

### Implementation Patterns & Key Details

See What §fix — the only two edits are the read expression inside `answerPreviewLine` and one 2-line insertion in the choice branch. Keep the existing budget math (`Math.max(1, budget - INSET.length - BLANK.length)`) and the empty-string-→-undefined guard verbatim.

### Integration Points

```yaml
DISPLAY SURFACES: short view only (overview shows the ✎ glyph via S1's marker; deep view unchanged)
FUTURE: README write-in visibility passage — P1.M3.T2.S1 final sweep (contract point 5)
CONFIG/STATE/SCHEMA: none
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npx vitest run src/panel/short-view.test.ts
```

### Level 2: Unit Tests

```bash
npm test    # full suite; :197 and the S1 marker tests (layout.test.ts) green
```

### Level 3: Integration Testing

Optional manual pass: debug-upsert a choice question, accept Other, commit, navigate away and back → dimmed write-in text visible; same for a text question.

### Level 4: Domain Validation

Confirm the read rule matches the two precedents (overview markerParts, cancelTextConfirm seed) — one vocabulary across surfaces.

## Final Validation Checklist

- [ ] `npm test` + `npm run typecheck` green
- [ ] All Success Criteria checked (esp. first-line-only, truncation, elaboration unchanged, no cursor change)
- [ ] Diff confined to short-view.ts + short-view.test.ts
- [ ] JSDoc updated to name the value/text read rule

---

## Anti-Patterns to Avoid

- ❌ Don't preview plain option values on choice questions (duplicates the option-row selection mark)
- ❌ Don't touch the cursor preselect or add recorded-answer sync (panel.ts:368 is by design)
- ❌ Don't reimplement truncation — reuse truncateVisible and the existing budget math
- ❌ Don't touch layout.ts (S1 owns the ✎ marker there)
- ❌ Don't render multi-line previews — first line only, per the existing contract

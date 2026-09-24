# PRP — P1.M2.T5.S1: accept() on type:'text' opens the editor in write-in duty

---
name: "P1.M2.T5.S1 — Enter on a text question's ✎ affordance opens the write-in editor (BUG-008, FR-12 / AC-2c)"
description: "BUG-008: accept() (src/panel/actions.ts:217-218) short-circuits type:'text' with a consumed no-op, while short-view.ts renders '✎ answer…' as the question's PRIMARY affordance (textAffordanceLine :250-252, cursor index 0, the only focus target) and renderFooter (layout.ts:462) advertises 'enter accept' — pressing enter does nothing (discoverability gap, and it blocks AC-2c's 'text answer / enter' first-try flow). Fix: in accept(), mirror the ✎ Other-row branch (actions.ts:~223): replace `if (q.type === 'text') return true;` with `panel.textDuty = 'writein'; panel.focusTextField(); return true;` — focusTextField (panel.ts:1126-1136) seeds the editor from the freshest draft (R4 revisit restore) and (per the landed BUG-004 fix in syncBufferToQuestion) the duty re-derives writein for text questions regardless. DO NOT import keys.ts into actions.ts (import cycle). Ripple/FD-18/maybeAutoSubmit side effects already live downstream in writeInEnter (actions.ts:282-313) — accept() only opens the editor. TDD: rewrite the pinned noop seam test (src/panel/actions.test.ts:268-273, test_accept_on_text_question_is_noop_seam_for_m4) to assert the editor opens (focus === 'text', duty 'writein' via renderDutyLabel, question still unanswered) and a follow-up type + enter answers the question ({value, custom:true} through writeInEnter). Panel harness; no mocks. No docs (AC-2c already describes the intended behavior; P1.M3.T2 sweeps wording)."
---

## Goal

**Feature Goal**: PRD h3.7 (BUG-008): on `type:"text"` questions, pressing `enter` on the rendered `✎ answer…` affordance (cursor index 0) opens the embedded editor in WRITE-IN duty — exactly the affordance + footer hint ("enter accept") the short view already promises. AC-2c's text-answer enter flow works on first try.

**Deliverable**: Modified `src/panel/actions.ts` (one branch in `accept()` + JSDoc line), rewritten test at `src/panel/actions.test.ts:268-273` (+ one full type+enter commit test). No new files, no docs, no renderer/footer changes — they are already truthful.

**Success Definition**: `npm run typecheck` + `npm test` green; the rewritten test asserts enter on a text question → `focus === "text"`, duty label `OTHER — this text is the answer` (via `renderDutyLabel`), status still `open`; then type + enter → `writeInEnter` commits `{value: text, custom: true}` + advance. Existing Other-row, moot/withdrawn, digit, and option-accept tests unchanged.

## User Persona

**Target User**: The TUI answerer on a `type:"text"` question.

**Use Case**: User sees `✎ answer…` as the single cursor target, footer says "enter accept", presses enter → editor opens labeled as the write-in answer surface; types; enter commits and advances. No need to know about ctrl+t.

**Pain Points Addressed**: BUG-008 — the advertised primary affordance was a silent consumed no-op; the only documented entry (ctrl+t via duty-follows-question-type) was undiscoverable from the screen itself.

## Why

- PRD h3.7 / h2.3 Issue 5 (BUG-008), quoted in the PRD context: "accept() short-circuits text questions as a consumed no-op … Discoverability gap … it now also blocks the AC-2c 'text-answer enter' flow for anyone who tries enter first."
- The fix the report implies: make the affordance truthful by mirroring the Other-row write-in entry.
- Upstream (landed, verified in current tree): write-in commit machinery — `writeInEnter` (actions.ts:282-313) handles empty-buffer (save draft + blur), ripple victims (FR-18 modal), commit (`applyAnswer({value, custom:true})`), `evaluateDependsOn`, `advanceAfterAccept`, blur — ALL downstream of the editor being open in write-in duty; the BUG-004 fix (P1.M2.T1.S1, complete) makes `syncBufferToQuestion` re-derive the duty, and `focusTextField(duty?)` (panel.ts:1126-1136) applies an explicit duty AFTER sync ("entry paths always win").
- Parallel item P1.M2.T4.S1 (bridge nack, BUG-007) touches only `src/remote-bridge.ts` + its tests — zero overlap with this change.

## What

[User-visible: enter on a text question's affordance opens the `OTHER — this text is the answer` editor seeded with any existing draft; typing + enter answers the question with `custom:true` and advances.]

### Behavior contract (exact)

1. **The edit** (actions.ts:217-218): replace
   ```ts
   if (q.type === "text") return true;
   ```
   with the Other-row mirror (same shape as the `panel.cursorIndex >= optionCount` branch at ~:223):
   ```ts
   if (q.type === "text") {
     // BUG-008 / FR-12: the ✎ affordance + "enter accept" footer are the
     // question's advertised entry — open the WRITE-IN editor (the draft IS
     // the answer on text questions; enter inside commits via writeInEnter).
     panel.textDuty = "writein";
     panel.focusTextField();
     return true;
   }
   ```
   `focusTextField()` with no argument runs `syncBufferToQuestion` (which re-derives `writein` for text questions per the landed BUG-004 fix) and seeds from the freshest draft (R4 revisit restore); setting `textDuty` before the call mirrors the Other-row branch exactly. (Equivalent one-liner: `panel.focusTextField("writein")` — the explicit duty wins by construction, panel.ts:1120-1131 docstring. Either form is acceptable; pick ONE and match it in the comment.)
   **Do NOT import keys.ts's `desiredTextDuty` into actions.ts — it would create an import cycle. Set the duty directly.**
2. **JSDoc** on `accept()` (:203-216): replace the bullet "- Text question → consumed no-op (field composition is P1.M4.T1.S2)." with "- Text question → WRITE-IN duty: textDuty='writein' + focusTextField (BUG-008 — the ✎ affordance + 'enter accept' footer are the advertised entry); enter in that duty commits via writeInEnter." Keep every other bullet byte-identical (moot/withdrawn no-op, Other-row, option accept).
3. **Everything else unchanged**: moot/withdrawn no-op stays BEFORE the text branch (order in the current function: undefined → moot/withdrawn → text → Other-row → option); no renderer, footer, keys.ts, panel.ts, or short-view.ts changes — the affordance and "enter accept" hint are already correct and now become truthful.
4. **TDD test rewrite** (actions.test.ts:268-273): replace `test_accept_on_text_question_is_noop_seam_for_m4` with TWO tests (same `seed`/`makePanel` harness, real seams, no mocks):
   - `test_accept_on_text_question_opens_writein_editor_no_answer`: `seed([{ id: "t1", overrides: { type: "text", options: undefined } }])`; `accept(panel)` → `true`; `panel.focus === "text"`; `panel.textDuty === "writein"` (or assert `renderDutyLabel(panel.textDuty, stubTheme, 80) === "OTHER — this text is the answer"` — `renderDutyLabel` is already imported in this test file at :23 and its output pinned at :838); `state.getQuestion("t1")?.status === "open"` and `answer === undefined` (opening ≠ answering).
   - `test_accept_then_type_enter_answers_text_question`: same seed; `accept(panel)`; `panel.textField.setText("my answer")` (or type via the field seam the file's other write-in tests use — follow the nearest existing writeInEnter test); `handleInput("\r")` through the panel (or call the enter path the file already exercises) → status `answered`, `answer.value === "my answer"`, `answer.custom === true`, focus back to `"options"`, advance per writeInEnter.
   - If any OTHER test elsewhere pins the old no-op (grep `noop_seam`, `type: "text"` + `accept(` in panel.test.ts / ac-panel.test.ts), update it to the new expectation — the grep is part of the task.
5. **No docs**: spec AC-2c (spec/product-requirements.md:79) already describes the intended behavior; P1.M3.T2.S1/S2 sweep wording.

### Success Criteria

- [ ] Enter on a text question's affordance → editor focused in write-in duty, seeded from any existing draft, question still unanswered
- [ ] Follow-up type + enter → `{value: text, custom: true}` commit + advance (writeInEnter path, untouched)
- [ ] Empty buffer + enter after the new entry → writeInEnter's empty branch: draft write-through + blur, NO commit (existing behavior, must not regress)
- [ ] moot/withdrawn no-op, digit accept, option accept, Other-row accept all unchanged (existing tests green)
- [ ] `grep -n "desiredTextDuty" src/panel/actions.ts` → empty (no keys.ts import / no cycle)

## All Needed Context

### Context Completeness Check

The exact branch being replaced is quoted with current-tree anchors, the Other-row pattern to mirror is identified at its anchor, `focusTextField`'s duty semantics (sync re-derivation vs explicit-duty-wins) are documented from its live docstring, and the test rewrite is specified at assertion level using harness pieces already imported in the target file. An implementer needs nothing beyond this PRP + the repo.

### Documentation & References

```yaml
- file: src/panel/actions.ts
  why: accept() (:203-231) — the branch being replaced (:217-218), the Other-row mirror branch (~:223-229), accept()'s JSDoc (:203-216); writeInEnter (:282-313) — read-only, the downstream commit the editor entry hands off to
  pattern: mirror the Other-row branch's exact two-statement shape (textDuty assignment + focusTextField()) and comment density
  gotcha: DO NOT import desiredTextDuty from keys.ts — import cycle (keys.ts imports actions.ts); set the duty directly or use focusTextField's duty param

- file: src/panel/panel.ts
  why: focusTextField(duty?) (:1126-1136) — focus="text", syncBufferToQuestion (re-derives duty per BUG-004 fix), explicit duty applied AFTER sync ("entry paths always win", :1120-1124), seeds freshestDraftFor, bufferOwner, invalidate
  pattern: read-only; no panel.ts change needed
  gotcha: none — either entry form lands on writein for text questions because sync re-derives it AND the explicit set wins

- file: src/panel/actions.test.ts
  why: the test being rewritten (:268-273 test_accept_on_text_question_is_noop_seam_for_m4); harness pieces — seed/makePanel (:268 fixture shape), renderDutyLabel import (:23) with pinned output (:838, stubTheme)
  pattern: follow sibling tests for the type+enter flow (grep writeInEnter / "custom: true" assertions in this file); no mocks anywhere
  gotcha: `overrides: { type: "text", options: undefined }` is the established way to seed a text question — reuse it

- file: src/panel/short-view.ts
  why: textAffordanceLine (:245-252) — the ✎ affordance this fix makes truthful; READ-ONLY (already renders cursor index 0 as the only focus target)
  gotcha: do not "fix" the affordance or placeholder — the bug is in accept(), not the view

- file: src/panel/layout.ts
  why: renderFooter (:452+) unconditionally prefixes "enter accept" (:462 area) — now truthful for text questions too; READ-ONLY
  gotcha: layout.ts:406 documents the editor-focus footer variant — no change needed there

- file: src/panel/keys.ts
  why: desiredTextDuty (:288) returns "writein" for text questions — the logic being mirrored WITHOUT the import; documents why sync re-derivation already lands on writein
  gotcha: import cycle — actions.ts must not import keys.ts (verified in the research note)

- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/architecture/bug-008-enter-text.md
  why: THE research note — anchors for the no-op (:217-218), the affordance, the footer, the ctrl+t path (panel.ts:628 focusTextField(desiredTextDuty(p))), and the import-cycle warning
  pattern: follow its INPUT/LOGIC sections; this PRP restates them with verified anchors

- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/P1M2T4S1/PRP.md
  why: the parallel-item contract (bridge nack, src/remote-bridge.ts only) — confirms zero file overlap and no dependency; nothing from it is consumed here
```

### Current Codebase tree (relevant slice)

```bash
src/panel/actions.ts        # accept() text branch + JSDoc — EDIT
src/panel/actions.test.ts   # noop seam test rewrite + commit test — EDIT
src/panel/panel.ts          # focusTextField — read-only
src/panel/short-view.ts     # ✎ affordance — read-only (already truthful)
src/panel/layout.ts         # footer "enter accept" — read-only
src/panel/keys.ts           # desiredTextDuty — read-only, DO NOT import
```

### Desired Codebase tree

```bash
# same files; zero new files
src/panel/actions.ts        # text branch opens write-in editor
src/panel/actions.test.ts   # rewritten seam test + type/enter commit test
```

### Known Gotchas of our codebase

```ts
// CRITICAL: DO NOT import desiredTextDuty from keys.ts into actions.ts —
// keys.ts already imports actions.ts (circular). Set the duty directly
// (panel.textDuty = "writein") or use focusTextField("writein").

// CRITICAL: branch ORDER in accept() matters — keep moot/withdrawn BEFORE
// the text branch (a moot text question stays a consumed no-op, R1).

// The empty-buffer escape hatch must keep working: after the new entry,
// enter on an EMPTY editor → writeInEnter's empty branch (draft write-through
// + blur, no commit). Do not special-case anything in accept().

// focusTextField() seeds the freshest draft (R4 revisit restore) — a user
// who re-enters the affordance after typing sees their draft, by existing
// machinery; nothing to add.

// ac-panel.test.ts may pin AC flows over text questions through enter —
// if any pinned "noop" expectation exists there (grep type: "text" in
// ac-panel.test.ts), update it; the acceptance criterion AC-2c is what this
// fix ALIGNS WITH, not against.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: RED — rewrite the pinned test first (src/panel/actions.test.ts)
  - REPLACE test_accept_on_text_question_is_noop_seam_for_m4 (:268-273) with
    test_accept_on_text_question_opens_writein_editor_no_answer
  - ADD test_accept_then_type_enter_answers_text_question (assertions above)
  - GREP for other no-op pins: rg -n "noop_seam|type: \"text\"" src/panel/*.test.ts
    — update any that now break
  - RUN: npx vitest run src/panel/actions.test.ts → new tests FAIL (focus stays "options")

Task 2: MODIFY src/panel/actions.ts — the fix
  - REPLACE the text no-op branch with the Other-row mirror (code block in
    What §1); update the accept() JSDoc bullet (What §2)

Task 3: GREEN + validation
  - npx vitest run src/panel/actions.test.ts src/panel/panel.test.ts src/panel/ac-panel.test.ts -v
  - npm test && npm run typecheck
  - rg -n "desiredTextDuty" src/panel/actions.ts  # expect empty
```

### Implementation Patterns & Key Details

```ts
// accept() after the fix (region only — everything else byte-identical):
export function accept(panel: InterrogationPanel): boolean {
  const q = currentQuestion(panel);
  if (q === undefined) return false;
  if (q.status === "moot" || q.status === "withdrawn") return true; // R1: navigable, not editable
  if (q.type === "text") {
    // BUG-008 / FR-12: the ✎ affordance + "enter accept" footer are the
    // advertised entry — open the WRITE-IN editor (the draft IS the answer
    // on text questions; enter inside commits via writeInEnter).
    panel.textDuty = "writein";
    panel.focusTextField(); // seeds freshest draft; sync re-derives writein (BUG-004 fix)
    return true;
  }
  // ...Other-row and option branches unchanged
}
```

### Integration Points

```yaml
NO config/state/renderer/footer/keys surface changes. Consumers:
  - writeInEnter (actions.ts:282-313): owns everything after entry — commit,
    FR-18 ripple modal on answered questions, advance, blur, empty-buffer
    escape hatch. accept() only opens the door.
  - maybeAutoSubmit / gate-hold (BUG-001 fix): fires off writeInEnter's
    commit like any Other-row write-in — no special case needed or allowed.
  - P1.M3.T1.S1 regression sweep + P1.M3.T2 doc sweep consume this; the
    README/spec already describe AC-2c's intended behavior (no doc change).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # also proves no circular-import type fallout
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/actions.test.ts -v
npx vitest run src/panel/ -v            # accept is cross-referenced (panel, ac-panel, keys tests)
npm test
rg -n "desiredTextDuty" src/panel/actions.ts   # expect NO matches
```

### Level 3: Manual (live TUI — human runbook item, not automation)

```bash
pi -e .
# text question: enter on "✎ answer…" → editor opens labeled
#   "OTHER — this text is the answer", seeded with any prior draft
# type + enter → answered, ✎ shown on the question line, advance
# enter on empty editor → draft saved + blur, still unanswered
# moot/withdrawn question: enter still a silent consumed no-op
```

### Level 4: Contract sweep

```bash
# AC-2c alignment: the scripted test_accept_then_type_enter_answers_text_question
# IS the AC-2c text-answer enter flow assertion — keep its assertions strict
# (value, custom:true, focus back to options, advance).
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean; `npm test` green (whole repo)
- [ ] No `desiredTextDuty` import in actions.ts; no other file changed beyond actions.ts + actions.test.ts

### Feature Validation

- [ ] Enter on the ✎ text affordance opens write-in editor (focus "text", duty writein, no answer applied)
- [ ] Type + enter commits `{value, custom:true}` + advance; empty-buffer enter saves draft + blurs without commit
- [ ] moot/withdrawn / digit / option / Other-row accept behaviors unchanged (existing tests green)
- [ ] Footer "enter accept" and the ✎ affordance are now truthful with zero view changes

### Code Quality Validation

- [ ] Only the two listed files modified; branch order preserved; JSDoc bullet updated
- [ ] New tests use the existing seed/makePanel harness with real seams (no mocks)

## Anti-Patterns to Avoid

- ❌ Importing keys.ts (desiredTextDuty) into actions.ts — import cycle
- [ ] Handling ripple/maybeAutoSubmit/advance inside accept() — that is writeInEnter's job; accept() only opens the editor
- [ ] Touching short-view.ts / layout.ts to "fix" the affordance or footer — they are already correct; the bug was the no-op
- [ ] Making the text branch return false (unconsumed) — it must be consumed `true`, matching the Other-row contract
- [ ] Skipping the TDD rewrite of the pinned noop seam test — it WILL fail against the new behavior and must be replaced, not deleted
- [ ] Mocking state/panel seams in the new tests — follow the file's real-seam pattern

---
name: "P1.M2.T1.S1 — Re-derive textDuty in syncBufferToQuestion from the new question's cursor position (BUG-004)"
description: "Fix in src/panel/panel.ts: at the END of syncBufferToQuestion, when focus === 'text', re-derive panel.textDuty via the ALREADY-IMPORTED desiredTextDuty(this) (panel.ts:73 — no new import, no cycle; keys.ts→panel.ts is type-only). Guard the explicit-duty path in focusTextField so ctrl+t/Other-accept entry duties are not clobbered. TDD: navigation repro tests first (writein→choice=elaboration save+blur; →text=writein commit; back to Other row=writein). Mode A JSDoc update on syncBufferToQuestion."
---

## Goal

**Feature Goal**: WRITEIN-001's cursor-follow rule (FR-12, spec/ui-spec.md:53, decisions.md:21) holds across question navigation: a text-editor focus session that spans a question change re-declares its duty from the NEW question's type + freshly-reseeded cursorIndex — never commits a write-in while the cursor sits on a real option.

**Deliverable**: Modified `src/panel/panel.ts` (syncBufferToQuestion tail + focusTextField ordering guard + Mode A JSDoc) + new tests in `src/panel/panel.test.ts` (navigation repro family).

**Success Definition**: `npm test` + `npm run typecheck` green; the BUG-004 repro (Other-accept q1 → shift+tab to q2 → type → enter) ends with q2 UNanswered and its draft saved (save+blur), NOT `{value, custom:true}`; navigating to a text question while focused yields writein duty on enter; all existing duty tests (:734, :883, :2256–:2395, :443) stay green.

## User Persona

**Target User**: TUI user typing in the embedded editor who tabs between questions mid-thought.

**Use Case**: User accepts Other on q1, starts typing, shift+tabs to q2 (cursor lands on q2's ★ option) to check something, types, hits enter → the text saves as q2's draft/elaboration (save+blur) — it must NOT silently answer q2 as a custom write-in.

**Pain Points Addressed**: BUG-004 — enter commits a write-in on a question whose cursor sits on a real option, bypassing option selection with commit semantics that contradict the visible cursor.

## Why

- The enter fork (panel.ts:~:800) trusts `this.textDuty`; duty is reset only on blur (:1128), so any focus session spanning a navigation keeps the stale duty.
- The currentId setter re-seeds `cursorIndex = initialCursorIndex(q)` BEFORE calling syncBufferToQuestion — so at sync's end both inputs (new q from `state.getQuestion(id)`, fresh cursorIndex) are available with no ordering change.
- h2.5 recommendation 4 (verbatim): "Re-derive textDuty from the new question's cursor position in syncBufferToQuestion … so enter after navigation matches the cursor-follow rule."
- A flat elaboration reset was considered and rejected (architecture doc): wrong for `type:"text"` questions and diverges from the cursor-derived principle.

## What

### 1. `src/panel/panel.ts` — syncBufferToQuestion tail

At the END of `syncBufferToQuestion` (after `this.bufferOwner = id; this.textField.seed(draft);`), add:

```ts
    // BUG-004 / WRITEIN-001 "duty follows entry path and cursor position":
    // a text-focus session that spans a question change re-declares its
    // duty from the NEW question's freshly-reseeded cursor (★ preselect,
    // set by the currentId setter BEFORE this runs). desiredTextDuty is
    // already imported (ctrl+t entry) — keys.ts→panel.ts is type-only, no
    // runtime cycle. Note duty early-returned above; options-focus
    // navigation is skipped by the focus guard.
    if (this.focus === "text") {
      this.textDuty = desiredTextDuty(this);
    }
```

No new import — `desiredTextDuty` is already imported at panel.ts:73.

### 2. `src/panel/panel.ts` — focusTextField ordering guard (CRITICAL)

Current `focusTextField(duty?)` (~:1095-1105) assigns `this.textDuty = duty` BEFORE `this.syncBufferToQuestion(this.currentId)`. With the new re-derivation at sync's END, an explicit entry duty (ctrl+t's `desiredTextDuty`, Other-accept's `"writein"`) would be **clobbered**. Fix by reordering so the explicit assignment lands AFTER the sync:

```ts
  focusTextField(duty?: "writein" | "elaboration"): void {
    this.focus = "text";
    this.syncBufferToQuestion(this.currentId);   // re-derives from cursor…
    if (duty !== undefined) this.textDuty = duty; // …then explicit entry duty wins
    this.textField.seed(this.freshestDraftFor(this.currentId));
    this.bufferOwner = this.currentId;
    this.textField.focus();
    this.invalidate();
  }
```

(In practice duty, when passed, equals what re-derivation computes — same predicate — but the reorder makes the entry-path contract explicit and future-proof; note it in the JSDoc.)

### 3. Mode A JSDoc updates

- `syncBufferToQuestion`: document the duty re-derivation rule (cursor-follow per FR-12 / WRITEIN-001, h3.3 fix) and the focus guard.
- `focusTextField`: note that an explicit `duty` argument is applied AFTER sync so entry paths always win over the re-derivation.

### 4. Tests — `src/panel/panel.test.ts` (add; TDD: write first, watch fail)

Follow the existing duty-family style (:2256–:2395) — panel harness, `handleInput` with real key sequences, no external mocks.

1. `navigation_from_other_row_writein_to_choice_q_enter_is_save_blur_not_commit` (the BUG-004 repro): q1 choice (rec a), q2 choice (rec b). Other-accept on q1 (`accept` or `handleInput('\r')` with cursor on the Other row → duty writein). `handleInput('\x1b[Z')` (shift+tab) → currentId q2, cursorIndex = ★. `textField.setText("x")`; `handleInput('\r')`. Assert: q2 NOT answered (`q.answer === undefined`, status not "answered"), focus back to "options", draft slot for q2 holds "x".
2. `navigation_to_text_question_while_focused_yields_writein_duty_on_enter`: from any focused state, tab/shift+tab onto a `type:"text"` question → type + enter → committed `applyAnswer({value: text, custom: true})`, status answered, advance.
3. `navigation_back_to_other_row_cursor_restores_writein_duty`: build the case where the reseeded cursor lands on the Other row (e.g. a choice question whose preselect is the Other row — per `initialCursorIndex` semantics in short-view.ts; if ★ always preselects a real option, construct it by navigating then moving the cursor DOWN onto the Other row with `handleInput('\x1b[B')`, which does NOT route through sync — then tab away and back is unnecessary; instead assert the Other-row-accept path still yields writein after a round-trip navigation: Other-accept q1 → shift+tab q2 → tab back to q1 → cursor reseeds to ★ (duty elaboration now) — enter saves+blurs. This pins that the stale writein is gone in BOTH directions).
4. `explicit_entry_duty_survives_focusTextField_sync` (guard for What §2): call `panel.focusTextField("writein")` while the cursor is on a real option; assert `panel.textDuty === "writein"` immediately after (the ctrl+t-on-Other and accept paths' contract).
5. Regression sweep: existing tests `test_wi_accept_other_row_enters_writein_duty_and_seeds_draft` (actions.test.ts:734), `test_blur_resets_duty_to_elaboration` (:883), the ctrl+t family (panel.test.ts:2256–2395), and keys.test.ts prev/next-in-text-focus tests all stay green unchanged.

### Explicitly OUT of scope

- BUG-005 (✎ marker parity / revisit preview — P1.M2.T2), BUG-008 (enter on text affordance opens editor — P1.M2.T5), delta bounding (P1.M2.T3), bridge nack (P1.M2.T4).
- Any change to `desiredTextDuty` itself, key routing, or navigation gating — navigation still happens in text focus; only the duty re-derives.

### Success Criteria

- [ ] BUG-004 repro test passes: q2 unanswered, draft saved, focus blurred
- [ ] Text-question navigation → writein commit; explicit focusTextField(duty) wins over re-derivation
- [ ] Note duty unaffected (early return path); options-focus navigation performs no duty write (focus guard)
- [ ] Full suite + typecheck green; no existing duty test flipped

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets: the exact navigation chain (keys → actions → currentId setter → sync), the exact insertion point with code, the clobber hazard in focusTextField and its reorder fix, the already-existing import (no cycle work needed), and the enumerated test family with the key sequences. No guessing.

### Documentation & References

```yaml
- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/architecture/bug-004-textduty.md
  why: the full verified map — textDuty assignment sites, syncBufferToQuestion body, currentId setter ordering, fix sketch, test inventory
  critical: setter re-seeds cursorIndex BEFORE sync (full inputs available at sync's end); keys.ts→panel.ts is type-only so the value import is cycle-safe

- file: src/panel/panel.ts
  why: :427 textDuty decl; :73 desiredTextDuty import; ~:800 enter fork; currentId setter :352-363; syncBufferToQuestion ~:985-1030 (line numbers drifted after Wave-1 — grep `syncBufferToQuestion` and `focusTextField` for current positions); focusTextField ~:1095-1105; blur reset :1128
  pattern: reuse desiredTextDuty — do NOT inline-duplicate the predicate
  gotcha: focusTextField assigns explicit duty BEFORE sync today — reorder or the re-derivation clobbers entry duties (What §2)

- file: src/panel/keys.ts
  why: desiredTextDuty (:288-296) — the pure predicate; step-4 prev/next ungated in text focus (why navigation reaches sync while focused)
- file: src/panel/actions.ts
  why: accept-on-Other :223 sets duty then focusTextField (explicit-duty consumer); writeInEnter :296-341 (commit path the bug triggers); prev/nextQuestion :344-355
- file: src/panel/layout.ts
  why: renderDutyLabel :277-290 — label updates for free via existing render wiring once textDuty is correct (assert in repro test that the label swaps if cheap)
- file: src/panel/panel.test.ts
  why: duty-family test conventions (:2256-:2395) and :443 label render; where the new tests go
- file: src/panel/actions.test.ts
  why: :734 / :883 duty pins that must stay green
- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/prd_snapshot.md (h2.3/h3.3 BUG-004, h2.5 rec 4)
  why: defect definition, repro steps, and the recommended fix locus
```

### Current Codebase tree (relevant slice)

```bash
src/panel/ panel.ts keys.ts actions.ts layout.ts short-view.ts (+ panel.test.ts actions.test.ts keys.test.ts)
```

### Desired Codebase tree

```bash
# no new files — modifications only
src/panel/panel.ts        # syncBufferToQuestion tail re-derivation + focusTextField reorder + JSDoc
src/panel/panel.test.ts   # 4 new tests (navigation duty family)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// Line numbers in the architecture doc are pre-Wave-1; grep symbol names for current positions
// The focus guard (`this.focus === "text"`) is mandatory — without it options-focus navigation writes duty pointlessly and note duty would too if the early return ever changes
// bufferOwner === "note" early-return runs BEFORE the re-derivation → note duty never re-derives (correct: the note is question-agnostic)
// focusTextField reorder: sync FIRST, explicit duty SECOND — otherwise ctrl+t/Other-accept duties get clobbered
// writeInEnter already blurs (resets duty) — the leak ONLY manifests on navigate-before-commit; don't "fix" writeInEnter
// desiredTextDuty reads panel.currentId + panel.cursorIndex + state — inside sync, all three already refer to the NEW question
// shift+tab byte sequence: '\x1b[Z' (as used in the bug-hunt repro); tab '\t'
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: WRITE the 4 new tests in src/panel/panel.test.ts FIRST (TDD)
  - repro (What §4.1) must FAIL at HEAD; run npx vitest run src/panel/panel.test.ts to confirm

Task 2: MODIFY src/panel/panel.ts
  - syncBufferToQuestion tail: `if (this.focus === "text") this.textDuty = desiredTextDuty(this);` + comment
  - focusTextField: reorder explicit-duty assignment AFTER syncBufferToQuestion
  - Mode A JSDoc on both (What §3)

Task 3: GATES
  - npx vitest run src/panel/panel.test.ts src/panel/actions.test.ts src/panel/keys.test.ts
  - npm test && npm run typecheck
```

### Implementation Patterns & Key Details

```ts
// The entire logic change, in place (end of syncBufferToQuestion):
this.bufferOwner = id;
const draft = this.freshestDraftFor(id);
this.textField.seed(draft);
if (this.focus === "text") this.textDuty = desiredTextDuty(this); // BUG-004 cursor-follow
```

### Integration Points

```yaml
NONE new — pure panel-internal semantics:
  - deep-view.ts:482 and actions.ts:223 set duty explicitly then focusTextField() — protected by the reorder (Task 2b)
  - ripple-confirm.ts documents blur-reset tails — unchanged
  - downstream bugfix items (P1.M2.T2/T5) build on stable duty semantics
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npx vitest run src/panel/panel.test.ts
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/actions.test.ts src/panel/keys.test.ts
npm test   # full suite — 1224+ tests; zero flips expected (no test pins duty-persists-across-navigation)
```

### Level 3: Integration Testing

Panel-harness level covered by the new tests; no pi runtime needed for this seam.

### Level 4: Domain Validation

Manual trace vs the h3.3 repro: every link (shift+tab → currentId setter → cursor ★ reseed → sync re-derivation → elaboration → enter saves+blurs) is pinned by repro test 1.

## Final Validation Checklist

- [ ] `npm test` + `npm run typecheck` green; no existing duty/navigation test flipped
- [ ] syncBufferToQuestion re-derives duty (focus === "text" guard) via desiredTextDuty — no predicate duplication
- [ ] focusTextField applies explicit duty AFTER sync (entry paths win)
- [ ] 4 new tests pass: choice-nav save+blur, text-nav writein commit, round-trip stale-duty gone, explicit-duty survival
- [ ] Mode A JSDoc updated on syncBufferToQuestion (cursor-follow rule, FR-12/WRITEIN-001) and focusTextField
- [ ] Only panel.ts + panel.test.ts modified

## Anti-Patterns to Avoid

- ❌ Don't inline-duplicate the duty predicate — desiredTextDuty is already imported
- ❌ Don't skip the focusTextField reorder — the re-derivation WILL clobber explicit entry duties without it
- ❌ Don't reset duty to a flat "elaboration" — wrong for text questions, rejected in the architecture doc
- ❌ Don't touch writeInEnter, key routing, or navigation gating — the commit path is correct once duty is right
- ❌ Don't re-derive in the currentId setter instead — sync is the single choke point that note duty already guards

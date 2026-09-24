# PRP — P1.M2.T3.S1: Elaboration duty via ctrl+t; duty follows cursor-on-Other / type:text

---
name: "P1.M2.T3.S1 — Elaboration duty via ctrl+t with EXPLAIN region label; duty follows cursor-on-Other / type:text (FR-D1, WRITEIN-001)"
description: "Make ctrl+t (keys.focusText) duty-aware: by default it focuses the embedded editor in ELABORATION duty (label `EXPLAIN — attaches to your selection`, verbatim); but while the cursor sits on the `✎ Other — write your own` row (cursorIndex === options.length) OR the current question is type:'text', ctrl+t enters WRITE-IN duty instead (label `OTHER — this text is the answer`). Elaboration enter = save draft + blur — NO advance, NO commit, NO arming (an elaboration alone never answers). ctrl+t re-press exits (save + blur). Elaboration save on an ANSWERED question whose ripple would invalidate others routes through the existing FR-18 keep/cancel modal (beginTextConfirm). Consumes P1.M2.T2.S1's textDuty/renderDutyLabel contract; is consumed by P1.M2.T4.S1 (two-stage removal makes enter the only commit gesture) and P1.M2.T5.S1 (role binding). Mode A JSDoc: three duties, duty-follows-cursor rule, elaboration-never-answers."
---

## Goal

**Feature Goal**: FR-D1 / h2.32 (WRITEIN-001, amended): `ctrl+t` becomes a duty-aware toggle into the embedded editor — ELABORATION duty by default (region label `EXPLAIN — attaches to your selection`), WRITE-IN duty when the cursor is on the Other row or the question is `type:"text"` ("the duty follows where the user is"). Elaboration `enter` saves the draft and blurs to options — never advances, never commits, never arms. Elaboration saves on answered questions route through the existing FR-18 ripple-confirm modal.

**Deliverable**: Modified `src/panel/panel.ts` (`focusTextField` duty parameter + elaboration enter tail), `src/panel/keys.ts` (onFocusText duty decision — or a panel helper it calls), plus tests in `src/panel/panel.test.ts` / `src/panel/actions.test.ts` using the existing no-mock harness. No new files.

**Success Definition**: `npm test` + `npm run typecheck` green. Scripted: (1) cursor on a real option → ctrl+t → editor focused, region shows `EXPLAIN — attaches to your selection`, type + enter → draft saved, question still unanswered, focus on options, no advance, no arm; (2) cursor on the Other row → ctrl+t → region shows `OTHER — this text is the answer`, enter commits `custom:true` + advances (S1's write-in path); (3) `type:"text"` question → ctrl+t → write-in duty likewise; (4) elaboration save on an answered question with ripple victims → the keep/cancel modal appears (esc cancels with no state change); (5) ctrl+t re-press from either duty → save + blur, no commit.

## User Persona

**Target User**: The TUI user who wants to attach context to a selection without answering ("attach context" and "this text is my answer" can never be confused — h2.32's design premise).

**Use Case**: User selects an option, presses ctrl+t, types rationale, enter → the text rides as `answer.text` at submit; the question remains answerable/unanswered as before.

**User Journey**: cursor on an option → ctrl+t → labeled EXPLAIN box → type → enter (saves + blurs) → accept option later → elaboration attaches at submit (binding is P1.M2.T5.S1).

**Pain Points Addressed**: One ambiguous text box whose meaning (context vs answer) had to be guessed; the duty now follows entry path and cursor position, visibly labeled.

## Why

- h2.32 (WRITEIN-001): "Elaboration duty — reached via `keys.focusText` … While the cursor sits on the Other row (or the question is `type:"text"`), `ctrl+t` enters write-in duty instead — the duty follows where the user is." FR-12: "elaboration … attaches the draft to the selected option at submit (`answer.text`); it never answers alone."
- Consumes the contract P1.M2.T2.S1 (implementing in parallel) lands: `textDuty: 'writein' | 'elaboration'` on the panel, `renderDutyLabel(duty, theme, width)` (already renders BOTH label strings — S1's PRP §label notes "P1.M2.T3.S1 owns duty-follows-cursor and the ctrl+t label semantics"), `commitWriteIn` for write-in enter, and `blurTextField` resetting `textDuty = "elaboration"`.
- Feeds P1.M2.T4.S1 (two-stage removal — elaboration enter must already never arm) and P1.M2.T5.S1 (role binding reads the duty/slot).
- AC-2b: "`ctrl+t`, type, `enter` → draft saved, question still unanswered."

## What

### Behavior contract (exact)

1. **Duty decision at ctrl+t** (single helper, e.g. `desiredTextDuty(panel): "writein" | "elaboration"`):
   - `"writein"` when `panel.cursorIndex === (currentQuestion.options?.length ?? 0)` on a choice question (the Other row, landed by P1.M2.T1.S1) OR `currentQuestion.type === "text"`.
   - `"elaboration"` otherwise (default).
   - `focusTextField()` gains an optional duty parameter (or an internal variant): `focusTextField(duty: "writein" | "elaboration" = "elaboration")` sets `this.textDuty = duty` before seeding/focusing. The keys.ts `onFocusText` router (line ~290) computes the duty and passes it. Seeding, `bufferOwner` reclaim (EXPLAIN-002), and `textField.focus()` are UNCHANGED from the existing body.
2. **Toggle exit**: ctrl+t while `focus === "text"` already exits via the existing toggle wiring in keys.ts (line ~444-446 calls `actions.onFocusText`; check the current toggle branch — it must remain save + blur, no commit; duty-agnostic).
3. **Elaboration enter** (in `handleInput`'s text-focus enter branch — the fork S1 created): `textDuty === "elaboration"` →
   - **FR-18 routing FIRST**: if the current question is ANSWERED/SUBMITTED and the save would invalidate others (`rippleVictims(panel, id).length > 0` from ripple-confirm.ts:94), route through the existing `beginTextConfirm` modal (ripple-confirm.ts:181) — enter=keep/apply, esc=cancel with no state change. (S1's ripple handling for WRITE-IN commits on answered questions is P1.M2.T2.S2 — parallel, do not touch; this item only routes the ELABORATION save.)
   - Otherwise: save draft to the panel-local slot (`commitTextDraft`/`saveTextDraft` path, panel.ts ~:852) → `blurTextField()` (which resets duty). **NO advance, NO `applyAnswer`, NO `advanceArmed` set, NO auto-submit hook.**
   - Empty buffer: identical — save "" (or no-op) + blur.
4. **Write-in enter** (entered via ctrl+t on Other/text, or via accepting the Other row): S1's `commitWriteIn` handles it — this item changes NOTHING in that path; the fork is by `textDuty`, which now has two entry routes.
5. **Labels**: the editor region renders `renderDutyLabel(this.textDuty, …)` (S1 landed the renderer + insertion points in buildLines ~:1230/:1281). Verify both branches display; the EXPLAIN branch becomes reachable now.
6. **Note duty**: entirely unchanged (`ctrl+shift+m`, `enterNoteMode`, `bufferOwner = "note"`).

### Success Criteria

- [ ] ctrl+t on a real-option cursor → elaboration duty + EXPLAIN label; enter saves + blurs, question unchanged (status/answer untouched), no advance
- [ ] ctrl+t with cursor on the Other row → write-in duty + OTHER label; enter commits `custom:true` and advances
- [ ] ctrl+t on a `type:"text"` question → write-in duty (OTHER label)
- [ ] Elaboration enter never sets `advanceArmed` / never calls any advance primitive
- [ ] Elaboration save on an answered question with ripple victims → keep/cancel modal; esc = no state change; enter = applies (draft saved)
- [ ] ctrl+t re-press exits either duty with draft write-through (R4)
- [ ] After T4 lands, no residue: elaboration enter contains no arm references (T4 deletes them anyway)

## All Needed Context

### Context Completeness Check

An implementer needs: S1's landed duty contract, the current focusTextField/handleInput/keys wiring with line anchors, the ripple seam function names, and the test harness. All below.

### Documentation & References

```yaml
- file: plan/002_949db554a811/P1M2T2S1/PRP.md
  why: THE upstream contract — textDuty field ('writein'|'elaboration', default elaboration), focusTextField unchanged-but-dutied, blurTextField resets duty, commitWriteIn (empty→save+blur, non-empty→applyAnswer{value,custom:true,at}+evaluateDependsOn+advanceAfterAccept), renderDutyLabel with BOTH verbatim strings, label insertion in buildLines ~:1230/:1281
  pattern: its "P1.M2.T3.S1 owns duty-follows-cursor and the ctrl+t label semantics" note is the handoff
  gotcha: treat it as implemented exactly; if a detail below disagrees with the landed code, the code wins

- file: src/panel/panel.ts
  why: focusTextField (:1031 — focus path, seeding precedence draftSlots→drafts seam→"", bufferOwner reclaim); blurTextField (:~1046 — resets textDuty per S1); handleInput two-stage ladder (:654-760 — (a) disarm, (b) armed stage-2, (c) text/note stage-1 enter fork by textDuty); commitTextDraft (:~852); advanceArmed (:406-412 — DO NOT SET from elaboration); enterNoteMode (:1066) untouched
  pattern: put the elaboration enter tail in branch (c) next to S1's write-in branch
  gotcha: EXPLAIN-002 buffer scoping (syncBufferToQuestion, bufferOwner :394) is orthogonal to textDuty — do not conflate

- file: src/panel/keys.ts
  why: onFocusText router seam (:114, :290, :444-446) — ctrl+t toggle: focus→text calls actions.onFocusText; re-press while focused exits. The duty decision belongs at the ctrl+t ENTRY site (compute from cursorIndex + current question) and is passed into focusTextField
  pattern: keys.ts matches config keys.focusText (:444); labels come from resolveKeyLabels — never hardcode
  gotcha: cursorIndex domain is 0..options.length inclusive (Other row = options.length, short-view.ts:356)

- file: src/panel/short-view.ts
  why: OTHER_AFFORDANCE = "✎ Other — write your own" (:73); the Other row occupies cursor index options.length (:142, :356); digit quick-select never selects it
  pattern: the duty predicate mirrors this cursor convention exactly

- file: src/panel/ripple-confirm.ts
  why: FR-18 seam — rippleVictims(panel, questionId) (:94), createRippleConfirm (:108), beginTextConfirm (:181), applyTextConfirm (:206), cancelTextConfirm (:220); the existing confirm-mode check in handleInput's stage ladder (:658 "CONFIRM-MODE CHECK (modal, FR-18)") and stage-1 gate in saveTextDraft (:456)
  pattern: elaboration saves on answered questions reuse beginTextConfirm — the SAME keep/cancel modal as any edit
  gotcha: rippleVictims semantics = answered/submitted edits only; open-question elaborations never confirm

- file: src/panel/actions.test.ts + src/panel/panel.test.ts
  why: no-mock harness — seed()/makePanel()/makeDeps() (actions.test.ts :73, :99, :127); panel.test.ts drives handleInput with synthetic key events; two-stage tests in two-stage.test.ts show the enter ladder fixtures
  pattern: follow the existing text-focus enter tests (grep 'focusText\|ctrl+t\|"text"' in panel.test.ts)
  gotcha: synthetic key events use the same parse path as handleInput (see two-stage.test.ts)

- file: spec/ui-spec.md h2.32 (quoted in this PRP's PRD context)
  why: verbatim label strings and the duty-follows-cursor sentence — byte-exact requirements

- file: plan/002_949db554a811/P1M2T2S2 (parallel, ripple routing for WRITE-IN commits)
  why: do NOT touch write-in ripple routing; your FR-18 work is elaboration-only
```

### Current Codebase tree (relevant slice)

```bash
src/panel/
  panel.ts         # focusTextField/blurTextField/handleInput enter fork/commitTextDraft — EDIT
  keys.ts          # onFocusText router + ctrl+t toggle — EDIT (duty decision site)
  short-view.ts    # Other row rendering + cursor convention (read-only)
  text-field.ts    # embedded editor component (read-only)
  ripple-confirm.ts# FR-18 seam (read-only, reuse)
  layout.ts        # renderDutyLabel may live here per S1 (read-only, verify)
  *.test.ts        # add tests to panel.test.ts / actions.test.ts
```

### Desired Codebase tree

```bash
src/panel/panel.ts        # MODIFIED — focusTextField(duty?) + elaboration enter tail + FR-18 routing
src/panel/keys.ts         # MODIFIED — onFocusText computes duty (cursor-on-Other / type:text)
src/panel/panel.test.ts   # MODIFIED — elaboration/duty-follows tests
```

### Known Gotchas

```ts
// CRITICAL: P1.M2.T2.S1 lands in parallel — read the LANDED panel.ts/keys.ts
// first; anchors above are from the pre-S1 tree and may have shifted ~40 lines.

// CRITICAL: elaboration enter must NEVER set advanceArmed, never call
// nextUnanswered/advanceAfterAccept, never applyAnswer. "An elaboration
// alone never answers a question" (h2.32). T4 deletes the arm machinery
// wholesale — leave zero new references.

// CRITICAL: the duty decision uses the CURRENT cursorIndex at ctrl+t time.
// On a type:"text" question the "options list" is empty/undefined —
// cursorIndex === options?.length would coincidentally be true; prefer the
// EXPLICIT type check first, then the Other-row index test.

// Label strings are VERBATIM: "EXPLAIN — attaches to your selection",
// "OTHER — this text is the answer" (em dash, exact wording).

// blurTextField resets textDuty to "elaboration" (S1) — every focus session
// re-declares duty; never persist duty across blur.

// Note duty is orthogonal (focus === "note"); do not add textDuty branches
// to enterNoteMode/exitNoteMode.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: READ landed state
  - READ src/panel/panel.ts (focusTextField, blurTextField, handleInput enter fork, textDuty, renderDutyLabel wiring), src/panel/keys.ts onFocusText (:290, :444), src/panel/ripple-confirm.ts (:94, :181-230)
  - CONFIRM: where renderDutyLabel lives (panel.ts or layout.ts per S1's landing) and its exact signature

Task 2: MODIFY src/panel/panel.ts
  - focusTextField(duty: "writein" | "elaboration" = "elaboration"): set this.textDuty = duty at entry; body otherwise unchanged
  - Add (or export) desiredTextDuty helper: type==="text" → "writein"; cursorIndex === (options?.length ?? 0) → "writein"; else "elaboration"
  - Elaboration enter tail in handleInput branch (c): FR-18 check (answered/submitted + rippleVictims>0 → beginTextConfirm; existing confirm-mode ladder applies/ applies) else commitTextDraft + blurTextField. NO advance/commit/arm
  - Mode A JSDoc: three duties (writein|elaboration|note), duty-follows-cursor rule, elaboration-never-answers

Task 3: MODIFY src/panel/keys.ts
  - onFocusText: compute duty via the helper and pass to focusTextField (entry); verify the re-press toggle exit still saves + blurs duty-agnostically

Task 4: ADD tests (panel.test.ts primarily; actions.test.ts if the ripple routing lives there)
  - elaboration_enter_saves_blurs_no_advance_no_commit (AC-2b): open choice question, ctrl+t (cursor on option), type via textField, enter → draft slot has text, question unanswered, focus options, advanceArmed false (assert no cursor move)
  - ctrl_t_on_other_row_enters_writein_duty: cursorIndex = options.length → ctrl+t → textDuty writein, OTHER label in rendered lines; enter commits custom:true + advances
  - ctrl_t_on_text_question_enters_writein_duty
  - elaboration_enter_on_answered_with_ripple_victims_opens_confirm_modal: esc cancels — no state change; enter applies draft
  - ctrl_t_repress_exits_with_write_through: type text, ctrl+t again → focus options, draft preserved (R4)
  - follow existing synthetic-key fixtures from two-stage.test.ts

Task 5: RUN validation; fix until green
```

### Integration Points

```yaml
NONE beyond panel/keys:
  - P1.M2.T4.S1 will DELETE advanceArmed — write no new references (this item's
    elaboration path is already arm-free, making T4's deletion easier).
  - P1.M2.T5.S1 reads the draft slot + duty semantics for role binding — the
    slot shape {value, text} and save path are unchanged here.
  - No config additions (ctrl+t is the existing keys.focusText; R5 unaffected).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # expected: zero errors
```

### Level 2: Unit Tests

```bash
npm test
npx vitest run src/panel/panel.test.ts src/panel/actions.test.ts -v
# Expected: new duty tests pass; two-stage.test.ts / text-field tests unaffected
# (elaboration enter no longer arms — if two-stage tests assert arming on
# elaboration saves, those assertions are superseded by AC-2b; update ONLY
# assertions about elaboration arming, not text-question write-in commits.)
```

### Level 3: Integration (live TUI manual)

```bash
pi -e .
# upsert a choice question + a text question
# ctrl+t with cursor on an option → EXPLAIN label; type; enter → question still open; accept option later
# move cursor to ✎ Other row → ctrl+t → OTHER label; type; enter → answered, ✎ {text} shown, advanced
# text question → ctrl+t → OTHER label; enter commits
# answered question + dependents: ctrl+t, edit, enter → keep/cancel modal; esc = nothing changed
```

### Level 4: Contract sweep

```bash
npx vitest run   # full suite — verify zero regressions in keys/ripple/two-stage suites
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean; `npm test` green

### Feature Validation

- [ ] ctrl+t default = elaboration, EXPLAIN label verbatim; enter saves + blurs, no advance/commit/arm (AC-2b)
- [ ] ctrl+t on Other row / type:text = write-in duty, OTHER label; enter commits + advances
- [ ] Elaboration save on answered question with victims → FR-18 modal; esc = no state change
- [ ] ctrl+t re-press exits with draft write-through (R4)
- [ ] Note duty, buffer scoping (EXPLAIN-002), esc ladder all unchanged

### Code Quality Validation

- [ ] Only panel.ts / keys.ts (+tests) modified; ripple-confirm reused not modified
- [ ] No new advanceArmed references; no hardcoded key labels (resolveKeyLabels)
- [ ] Mode A JSDoc: three duties, duty-follows-cursor, elaboration-never-answers

## Anti-Patterns to Avoid

- ❌ Making elaboration enter commit or advance (the core invariant: never answers alone)
- ❌ Setting advanceArmed anywhere new (T4 deletes it; don't add residue)
- ❌ Deciding duty by checking `type === "text"` AFTER the Other-row index test (coincidence on empty options lists)
- ❌ Touching write-in commit logic or its ripple routing (S1/S2 own them)
- ❌ Modifying ripple-confirm.ts instead of reusing beginTextConfirm/applyTextConfirm/cancelTextConfirm
- ❌ Hardcoding label strings in render paths instead of using S1's renderDutyLabel

---

**Confidence Score**: 8/10 — the contract is precise and the upstream S1 PRP is explicit that this item owns exactly the duty-follows-cursor + ctrl+t label semantics; the residual risk is line-anchor drift from the two parallel items (S1/S2), mitigated by Task 1's read-first step and "landed code wins" rule.

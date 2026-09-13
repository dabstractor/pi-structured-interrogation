# PRP — P1.M5.T4.S1: Invalidation confirm (enter=keep, esc=cancel)

---

## Goal

**Feature Goal**: Implement the FR-18 / Q39=B ripple confirm: when the user commits an answer change to an **answered/submitted** question and the transitive `dependsOn` ripple would invalidate other answered/submitted questions, the panel enters a **modal confirm state** — the footer becomes `⚠ Invalidates {n} answered questions ({ids}) — enter=keep, esc=cancel`. `esc` cancels the edit with **zero state change** (prior selection restored); `enter` applies the edit and immediately re-runs `evaluateDependsOn` so victims grey out as moot with reasons (FR-17). Zero victims → apply directly, no confirm. No drill-down in v1.

**Deliverable**:
- `src/panel/ripple-confirm.ts` — the real `RippleConfirmFn` implementation + panel confirm-mode state helpers (new file).
- `src/panel/ripple-confirm.test.ts` — unit tests (new file).
- Surgical edits: `src/panel/panel.ts` (confirm-mode field + input interception + wiring the real default + text stage-1 gate), `src/panel/layout.ts` (`renderConfirmFooter`), `src/panel/actions.ts` (one-line: run `evaluateDependsOn` after `applyAnswer` in `acceptOptionIndex` — see Task 4).

**Success Definition**: With a fixture chain Q1(answered) ← Q2(answered, dependsOn Q1) ← Q3(submitted, dependsOn Q2): re-answering Q1 triggers the confirm footer listing Q2, Q3; `esc` leaves state/statuses/answers/cursor untouched; `enter` applies Q1's new answer and Q2/Q3 flip to `moot` (with reasons) instantly. Editing an answered question with NO ripple victims applies directly (no confirm). An answered TEXT question edited in the field gets the same gate at stage-1 enter. Full suite green (`npx vitest run`), `npx tsc --noEmit` clean.

## User Persona

**Target User**: The pi user being interrogated.
**Use Case**: The user changes an earlier foundational answer ("storage: sqlite → postgres") that two later answered questions depended on.
**User Journey**: cursor on the already-answered option → press enter (or a digit) → footer swaps to `⚠ Invalidates 2 answered questions (Q2, Q3) — enter=keep, esc=cancel` → press `esc` (changed mind — everything is exactly as before, cursor back on the recorded answer) or `enter` (commit — Q2/Q3 instantly render greyed moot `⊘ storage=sqlite`-style reasons).
**Pain Points Addressed**: silently invalidating a questionnaire full of answers; irreversible-feeling edits; delayed/confusing invalidation feedback.

## Why

- FR-18 + Q39=B (h2.57): the user explicitly chose edit-time ripple confirm with forced accept/cancel as the v1 UX.
- FR-17: dependency effects must be instant and local; today `evaluateDependsOn` only runs on snapshot/delivery (delivery.ts) — the panel never re-runs it after an applied answer, so AC-6 ("greys as moot, instantly") currently fails for panel-side edits.
- Consumes: `computeRipple` (P1.M1.T2.S3, src/depends-on.ts:217), `evaluateDependsOn` (same file :160), the `RippleConfirmFn` seam stubbed by accept/advance (P1.M3.T2.S2, src/panel/actions.ts:36), the two-stage text save (P1.M4.T1.S2, panel.ts `saveTextDraft`).
- Parallel-item contract: P1.M5.T3.S1 (gate warning) adds a persistent footer-adjacent warning dismissed by any key and a top-of-`handleInput` dismissal check. Coordinate the insertion order: BOTH the gate-warning dismissal and the confirm-mode interception live at the top of `handleInput` — confirm mode must be checked FIRST (it is modal; while it is active no other key, including a gate-warning dismissal, may act). Re-read panel.ts at implementation time; do not break T3's "any key dismisses while still acting" when confirmMode is inactive.

## What

- **Trigger** (unchanged invocation point): `acceptOptionIndex` (actions.ts:226-236) already calls `panel.confirmRippleEdit(q.id, proposed)` before `applyAnswer` when status is `answered`/`submitted`. This task makes the panel's default `rippleConfirm` the real flow (replace `defaultRippleConfirm` at panel.ts:176/405; keep `args.confirmRipple` override working for tests).
- **Victim computation**: `computeRipple(state, editedId)` (pure, transitive, cycle-safe, excludes editedId) filtered to victims = ids whose current status is `answered` or `submitted`. Zero victims → the seam returns `true` (apply directly, exactly today's behavior).
- **Confirm mode (modal)**: victims ≥ 1 → stash `{ questionId, proposed, priorCursorIndex }` in `panel.confirmMode`, `invalidate()`, and the seam returns `false` (veto — no `applyAnswer`, no advance, no draft writes). While `confirmMode` is set:
  - Footer line is REPLACED by `renderConfirmFooter(victims, theme, width)` → `⚠ Invalidates {n} answered questions ({ids}) — enter=keep, esc=cancel` (ids comma-space joined, order = `computeRipple` BFS order). Width-bounded via `truncateVisible`; the flash line is suppressed during confirm mode.
  - `handleInput` intercepts immediately after the `resolved` guard, before the advanceArmed disarm (a) and everything else: `enter` → apply; `esc` → cancel; **any other key → consumed no-op** (modal — the user must decide).
- **Cancel (`esc`)**: clear `confirmMode`, restore the prior selection, `invalidate()`. NO state mutation of any kind (no applyAnswer, no setStatus, no snapshot, no epoch). For choice questions: `cursorIndex` → index of the option whose `value === q.answer.value`; if not found, the stashed `priorCursorIndex`. The user stays on the same question.
- **Apply (`enter`)**: clear `confirmMode`, then perform the deferred commit exactly as `acceptOptionIndex` would have: `state.applyAnswer(questionId, proposed)`, run `evaluateDependsOn(state)` (Task 4), advance via `nextUnanswered` (exported from actions.ts — replicate `advanceAfterAccept` tail: find current index, `nextUnanswered`, set `currentId`, `invalidate()`). Note: when triggered from the deep view (`acceptFromDeep` already returned after the veto), the apply happens in place — the view stays deep (documented, acceptable v1; deep-view's veto branch already "stays in deep view").
- **Text gate (stage-1 save)**: in `panel.saveTextDraft`, BEFORE writing `draftSlots`/`drafts.setDraft`, when the current question is `answered`/`submitted` with a recorded answer: compute victims with the SAME helper; if ≥ 1, stash a text-pending confirm (`{ questionId, kind: "text", text }`) and enter confirm mode (save deferred). `esc` → cancel: restore the editor to the recorded answer's text (re-`seed` via the existing seeding pattern in `focusTextField`, panel.ts:618+) and KEEP text focus — no draft write, no blur, no arm. `enter` → complete the deferred save (write draft slot + `drafts.setDraft`, blur, arm `advanceArmed`) using the stashed text. Zero victims → save immediately as today.
- **No drill-down in v1**: the confirm footer is the only surface; nothing jumps to victims, nothing expands details.
- **[Mode A] JSDoc (contract 5)**: header JSDoc on `src/panel/ripple-confirm.ts` documents the forced accept/cancel contract: the seam vetoes synchronously, the deferred commit is owned by the confirm flow, esc is a guaranteed no-state-change path, and enter = keep + instant `evaluateDependsOn` re-run (FR-17).

### Success Criteria

- [ ] Re-answering an answered choice question with answered/submitted ripple victims swaps the footer to `⚠ Invalidates {n} answered questions ({ids}) — enter=keep, esc=cancel` and commits NOTHING until a decision key
- [ ] `esc`: statuses, answers, rev/epoch, snapshots, cursor position all byte-identical to pre-edit; cursor restored to the recorded answer's option (AC-7)
- [ ] `enter`: edit applied; victims flip to `moot` with reasons immediately (FR-17/AC-6 applies to any panel-side apply); cursor advances via the standard accept-advance algorithm
- [ ] Zero victims (ripple empty, or all victims open/moot/withdrawn) → direct apply, no confirm mode, behavior identical to today
- [ ] Editing an OPEN or REASKED question never confirms (status gate)
- [ ] Text stage-1: same gate; esc restores recorded answer text and keeps focus; enter completes the save
- [ ] While confirm mode is active, only enter/esc act; all other keys are consumed no-ops; flash line suppressed
- [ ] `confirmRipple` arg override still wins over the new default; existing deep-view veto behavior (stay in deep view) unaffected
- [ ] Full suite green; `npx tsc --noEmit` clean

## All Needed Context

### Context Completeness Check

An implementer with zero codebase knowledge gets: the exact seam to fill, exact functions to call with signatures, the input-pipeline insertion point, footer render conventions, the parallel-item coordination note, and the test fixture shapes. ✅

### Documentation & References

```yaml
- file: src/panel/actions.ts
  why: RippleConfirmFn type (:36-44), acceptOptionIndex invocation (:226-236), nextUnanswered (:80-107), panelActions registry — the contract this task fills
  pattern: seam call BEFORE applyAnswer; veto returns consumed true from accept, false from seam
  gotcha: advanceAfterAccept is private — use exported nextUnanswered, do NOT duplicate the wrap scan

- file: src/depends-on.ts
  why: computeRipple (:217-241, pure, unfiltered closure) and evaluateDependsOn (:160-184, mutates via setStatus, emits changed per flip)
  pattern: computeRipple BEFORE apply to decide; evaluateDependsOn AFTER apply to grey
  gotcha: computeRipple returns ALL statuses unfiltered — the confirm must filter to answered/submitted for victims AND the footer copy; SKIP_EVALUATION means withdrawn/closed never moot

- file: src/panel/panel.ts
  why: defaultRippleConfirm (:176) + wiring (:405), confirmRippleEdit (:552), handleInput order (:432-496), saveTextDraft (:508-517), footer call sites (:765/:802/:825/:852), focusTextField seeding (:618+)
  pattern: [Mode A] JSDoc block on handleInput pins the staging order — insert confirm-mode check immediately after the resolved guard
  gotcha: stage-2 armed-enter check (b) currently runs early — confirm interception MUST precede it or an armed enter could bypass the modal; also dispose() cleans timers (no new timers needed)

- file: src/panel/layout.ts
  why: renderFooter (:314), renderFlashLine (:98) + truncateVisible (:85) — width-bounded single-line footer convention
  pattern: renderConfirmFooter mirrors renderFlashLine's truncation and dim/⚠ accent styling
  gotcha: footer renders EXACTLY 1 line at any width ≥ 40 — the confirm line must never wrap

- file: src/panel/deep-view.ts
  why: acceptFromDeep veto detection (:429-448) via q.answer reference identity — deferred apply must not double-fire the seam
  pattern: the confirm flow's apply path replicates acceptOptionIndex's tail (apply + advance), never calls the seam again

- file: src/panel/two-stage.test.ts
  why: fake editor + DraftStore spy harness, focusText helper, seedOpen fixture — reuse the same test scaffolding pattern
  pattern: createInterrogationState + upsertQuestion raw seeding + state.applyAnswer to pre-answer
  gotcha: stage-1 saves do NOT apply text answers to state (asserted :179-180) — the text gate keys off the RECORDED answer (agent upsert origin)

- file: plan/001_0d6760db6bc5/P1M5T3S1/PRP.md
  why: parallel gate-warning item — it also adds a top-of-handleInput dismissal check and a footer-adjacent warning line
  pattern: coordinate insertion order (confirm-mode FIRST) and warning-line precedence (confirm footer replaces the footer; gate warning line suppressed during confirm mode)
  gotcha: if T3 has not landed, implement the confirm interception standalone — do not add T3 code

- file: plan/001_0d6760db6bc5/P1M5T4S1/research/notes.md
  why: full verified seam/research notes incl. line anchors
```

### Current Codebase tree (relevant excerpt)

```bash
src/
  depends-on.ts          # computeRipple, evaluateDependsOn (DONE, read-only for this task)
  panel/
    panel.ts             # host: handleInput, saveTextDraft, rippleConfirm seam wiring
    actions.ts           # RippleConfirmFn, acceptOptionIndex, nextUnanswered, submit
    keys.ts              # config-driven dispatch (enter/esc FIXED keys — no changes needed)
    layout.ts            # renderFooter, renderFlashLine, truncateVisible
    deep-view.ts         # acceptFromDeep (consumes the seam — no changes)
    text-field.ts        # embedded editor wrapper
    actions.test.ts / two-stage.test.ts   # test patterns
```

### Desired Codebase tree with files to be added

```bash
src/panel/
  ripple-confirm.ts        # NEW — createRippleConfirm(): RippleConfirmFn + confirm-mode helpers + victim computation
  ripple-confirm.test.ts   # NEW — AC-7 matrix: trigger/cancel/apply/text/zero-victim/modal-lock
  panel.ts                 # MODIFIED — confirmMode field, handleInput interception, default wiring, saveTextDraft gate
  layout.ts                # MODIFIED — renderConfirmFooter export
  actions.ts               # MODIFIED — evaluateDependsOn(state) after applyAnswer in acceptOptionIndex (FR-17 instant moot)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: the seam returns boolean SYNCHRONOUSLY at accept time. The confirm
// FLOW is deferred: on victims ≥ 1 return false (veto), stash the pending edit,
// and let the confirm-mode enter handler perform apply+advance itself. Never
// re-invoke the seam from the deferred apply (infinite loop).
// CRITICAL: handleInput staging order is load-bearing (panel.ts:432 JSDoc):
// resolved guard → CONFIRM-MODE CHECK (new, first) → (a) disarm → (b) armed
// stage-2 enter → (c) stage-1 text/note enter → keys seam → editor forwarding.
// An armed enter must NOT bypass the modal, and the modal must not disarm the
// flag spuriously — enter inside confirm mode must NOT trip check (b): return
// from the confirm branch before (a)/(b) run.
// CRITICAL: computeRipple is PURE — safe pre-apply. evaluateDependsOn MUTATES
// (setStatus) and emits one 'changed' per real flip; run it AFTER applyAnswer,
// exactly once per commit. The panel's 'changed' subscription already
// invalidates; call panel.invalidate() once more after advance (idempotent).
// CRITICAL: text stage-1 save does NOT apply answers to state (by design,
// two-stage.test.ts:179) — the text gate compares against q.answer (recorded
// via agent upsert); esc restores THAT text via the focusTextField seeding
// pattern (draftSlots freshest read).
// enter/esc are FIXED keys (keys.ts Mode A) — footer copy hardcodes them; no
// config surface, AC-12 unaffected.
// The panel renders footer in 4 branches (note/short/deep/overview at :765,
// :802, :825, :852) — funnel through ONE confirm substitution point (or guard
// all four identically) so confirm mode shows in every view.
```

## Implementation Blueprint

### Data models and structure

```ts
// src/panel/ripple-confirm.ts
import type { RippleConfirmFn } from "./actions.js";
import type { InterrogationPanel } from "./panel.js";
import { computeRipple, evaluateDependsOn } from "../depends-on.js";
import { nextUnanswered } from "./actions.js";

/** Modal confirm state for a pending answer edit (FR-18 / Q39=B). */
export interface RippleConfirmState {
  questionId: string;
  /** Choice: the proposed answer (deferred applyAnswer payload). */
  proposed?: { value: string; at: string };
  /** Text: the staged stage-1 payload (deferred draft save). */
  kind: "choice" | "text";
  text?: string;
  victims: string[];          // answered/submitted ripple ids, BFS order
  priorCursorIndex: number;   // esc restore fallback
}
// Panel gains: confirmMode: RippleConfirmState | null  (public, read by render + tests)
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/panel/ripple-confirm.ts
  - IMPLEMENT: rippleVictims(panel, questionId): string[] — computeRipple filtered to answered/submitted
  - IMPLEMENT: createRippleConfirm(): RippleConfirmFn — zero victims → true; else stash panel.confirmMode
    (choice payload), invalidate(), return false
  - IMPLEMENT: applyConfirmedEdit(panel): void — clear mode, applyAnswer, evaluateDependsOn, advance (nextUnanswered), invalidate
  - IMPLEMENT: cancelConfirm(panel): void — restore cursor (recorded answer's option index, else priorCursorIndex), clear mode, invalidate. Zero state mutation.
  - IMPLEMENT: text variants: beginTextConfirm(panel, text), applyTextConfirm(panel) (write draftSlots + drafts.setDraft + blur + arm), cancelTextConfirm(panel) (re-seed editor to q.answer.text, keep text focus)
  - NAMING: snake_case exports, no classes; [Mode A] JSDoc header on the forced accept/cancel contract
  - PLACEMENT: src/panel/ripple-confirm.ts; imports ONLY from actions/panel/depends-on/state types

Task 2: MODIFY src/panel/layout.ts
  - IMPLEMENT: renderConfirmFooter(victims: string[], theme, width): string —
    `⚠ Invalidates {n} answered questions ({ids}) — enter=keep, esc=cancel`,
    ⚠ accent + dim body, truncateVisible-bounded, exactly 1 line
  - FOLLOW pattern: renderFlashLine (:98); add to the export list and FooterScreen docs
  - TEST: extend layout.test.ts describe("renderConfirmFooter") — exact copy, truncation at narrow width, 1-line guarantee

Task 3: MODIFY src/panel/panel.ts
  - ADD field: confirmMode (RippleConfirmState | null = null), public
  - WIRE: this.rippleConfirm = args.confirmRipple ?? createRippleConfirm() (delete defaultRippleConfirm)
  - INTERCEPT: in handleInput, immediately after the resolved guard: if confirmMode → enter calls
    applyConfirmedEdit/applyTextConfirm, esc calls cancelConfirm/cancelTextConfirm, ANY other key
    returns true (consumed no-op). Always return from this branch.
  - RENDER: in buildLines, when confirmMode !== null replace the footer line with
    renderConfirmFooter(...) at ALL FOUR footer push sites (or one shared guard); suppress flashLine during confirm mode
  - GATE: saveTextDraft — pre-answer answered/submitted check via rippleVictims; ≥1 victims → beginTextConfirm and RETURN (no slot write, no drafts.setDraft, no blur, no arm); else today's path
  - GOTCHA: the confirm branch runs BEFORE (a) disarm — a confirm-enter must not trip the armed stage-2 advance
  - PRESERVE: suspend(), dispose(), args.confirmRipple override, existing tests

Task 4: MODIFY src/panel/actions.ts (one surgical addition)
  - ADD: evaluateDependsOn(panel.state) immediately after state.applyAnswer in
    acceptOptionIndex (FR-17: instant moot greying for ANY panel-side answer —
    AC-6; no other task owns this for panel edits)
  - GOTCHA: keep it AFTER applyAnswer and BEFORE advanceAfterAccept; changed
    events per flip flow through the panel's existing subscription; add import from ../depends-on.js
  - NOTE: deep-view/overview already render moot markers (statusMarkers) — no renderer changes needed

Task 5: CREATE src/panel/ripple-confirm.test.ts
  - FIXTURE: seed chain Q1 choice(answered) ← Q2 choice(answered, dependsOn Q1 equals) ← Q3 choice(submitted, dependsOn Q2); reuse two-stage.test.ts harness patterns (createInterrogationState, upsertQuestion, applyAnswer to pre-answer, makePanel with fake editor + DraftStore spies)
  - CASES (test_snake_case naming):
    test_edit_answered_with_victims_swaps_footer_and_defers_commit
    test_esc_cancels_with_zero_state_change (statuses, answers, q.answer refs, rev/epoch, snapshot count, cursorIndex on recorded option)
    test_enter_applies_and_victims_go_moot_with_reasons_instantly (evaluateDependsOn effect + advance)
    test_zero_victims_applies_directly_no_confirm (incl. ripple hitting only open/moot questions)
    test_open_or_reasked_edit_never_confirms
    test_confirm_mode_modal_only_enter_esc_act (arrows/digits/ctrl+s consumed no-ops; state untouched)
    test_digit_quick_select_on_answered_uses_same_gate
    test_text_stage1_gate_esc_restores_recorded_answer_text_keeps_focus
    test_text_stage1_gate_enter_completes_deferred_save (drafts.setDraft called once with staged text, blur, armed)
    test_confirm_footer_exact_copy_and_width_truncation (via renderConfirmFooter or panel.render output)
    test_deep_view_accept_defers_then_applies_in_place (acceptFromDeep veto branch stays deep; enter applies, advances)
    test_confirm_ripple_override_still_wins (args.confirmRipple takes precedence)
```

### Implementation Patterns & Key Details

```ts
// The seam — veto + defer (src/panel/ripple-confirm.ts)
export function createRippleConfirm(): RippleConfirmFn {
  return (panel, questionId, proposed) => {
    const victims = rippleVictims(panel, questionId);
    if (victims.length === 0) return true; // apply directly — today's behavior
    panel.confirmMode = { questionId, kind: "choice", proposed, victims,
      priorCursorIndex: panel.cursorIndex };
    panel.invalidate();
    return false; // veto: deferred commit owned by the confirm flow
  };
}

// handleInput interception (panel.ts — first check after the resolved guard)
if (this.confirmMode !== null) {
  const key = parseKey(data);
  if (key === "enter") applyConfirm(this);      // choice → applyConfirmedEdit; text → applyTextConfirm
  else if (key === "esc") cancelConfirmKind(this);
  return true;                                   // modal: everything else is a consumed no-op
}
// CRITICAL: enter here must NOT fall through to the armed stage-2 (b) check — return above.

// Deferred apply (mirror of acceptOptionIndex's tail — NEVER re-invoke the seam)
function applyConfirmedEdit(panel) {
  const cm = panel.confirmMode!;
  panel.confirmMode = null;
  panel.state.applyAnswer(cm.questionId, cm.proposed!);
  evaluateDependsOn(panel.state);               // FR-17: victims grey instantly
  const ordered = panel.state.orderedQuestions();
  const from = ordered.findIndex((q) => q.id === panel.currentId);
  const nextId = nextUnanswered(ordered, from);
  if (nextId !== undefined) panel.currentId = nextId;
  panel.invalidate();
}
```

### Integration Points

```yaml
PANEL RENDER:
  - footer substitution: all four renderFooter push sites in buildLines (panel.ts:765/802/825/852)
  - flash suppression while confirmMode !== null (flashLine / footerFlash render guard)

KEYS:
  - NO keys.ts changes: enter/esc are fixed keys; the modal intercept lives in
    panel.handleInput BEFORE the keys seam, mirroring the note-mode stage-1 precedent

STATE:
  - NO state.ts / merge.ts changes: computeRipple (pre) and evaluateDependsOn (post)
    are the complete FR-17/18 data path

PARALLEL ITEM (P1.M5.T3.S1 gate warning, may land concurrently):
  - if its any-key-dismissal check is present in handleInput, confirm-mode
    interception must be inserted ABOVE it (modal wins); suppress its warning
    line during confirm mode the same way as the flash line
  - if not yet landed, implement standalone — do NOT write T3 code
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx tsc --noEmit                       # typecheck whole project
npx vitest run src/panel/ripple-confirm.test.ts   # targeted
# Expected: zero errors. Read output and fix before proceeding.
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/panel/ripple-confirm.test.ts -t "esc_cancels"   # AC-7 core
npx vitest run src/panel/                       # panel area suite
npx vitest run                                  # FULL suite — regression guard
# Expected: all pass. Any actions/panel/two-stage/deep-view test failing means
# the handleInput staging order or applyAnswer addition regressed behavior.
```

### Level 3: Integration Testing (System Validation)

```bash
# Debug-command fixture route (no TUI needed) — optional smoke: not required;
# the confirm flow is panel-internal. If a manual check is desired, the
# MANUAL-TUI-AC-RUNBOOK.md AC-7 section is the human pass (P1.M7.T6).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# AC-7 scripted equivalent lives entirely in ripple-confirm.test.ts:
# esc → assert state.serialize() deep-equal to pre-edit snapshot capture
# enter → assert victims moot + mootered reasons present + advance target
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` full suite green (zero regressions in panel/actions/two-stage/deep-view/overview)

### Feature Validation

- [ ] Footer copy exact: `⚠ Invalidates {n} answered questions ({ids}) — enter=keep, esc=cancel`
- [ ] AC-7: esc = no state change (deep-equal serialized state + cursor restored); enter = applies
- [ ] FR-17: enter (and any panel-side accept) runs evaluateDependsOn — victims moot with reasons instantly (AC-6)
- [ ] Zero victims → direct apply; open/reasked → never confirms; digits share the gate
- [ ] Text stage-1: same gate, esc restores recorded text + keeps focus, enter completes save
- [ ] Modal: only enter/esc act during confirm mode; flash suppressed; works in short/deep/overview/note renders

### Code Quality Validation

- [ ] [Mode A] JSDoc on ripple-confirm.ts documenting the forced accept/cancel contract
- [ ] Seam override (`args.confirmRipple`) still wins; no new config surface (enter/esc fixed)
- [ ] No duplication of advance/ripple logic — reuses computeRipple/evaluateDependsOn/nextUnanswered

---

## Anti-Patterns to Avoid

- ❌ Don't re-invoke `confirmRippleEdit` from the deferred apply — the seam fires once per user gesture
- ❌ Don't run `computeRipple` after `applyAnswer` (post-apply statuses pollute the victim filter)
- ❌ Don't let the armed stage-2 enter or any config intercept fire inside the modal
- ❌ Don't mutate state on esc — not even cursor-adjacent state (snapshot counts must be identical)
- ❌ Don't add keys.ts/config.ts surface for enter/esc — they're fixed by Mode A design
- ❌ Don't wrap or double-push the footer — confirm REPLACES the single footer line, one line max

---

**Confidence Score: 9/10** — the seam, victim computation, and evaluation functions all exist with explicit contracts pointing at this task; the only residual risk is merge coordination with the parallel gate-warning item (handled by the insertion-order contract above).

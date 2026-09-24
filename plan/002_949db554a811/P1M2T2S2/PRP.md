---
name: "P1.M2.T2.S2 — Ripple confirm routes write-in commits on answered questions through the existing keep/cancel modal (FR-18 × WRITEIN-001)"
description: "Extend the FR-18 ripple-confirm flow to write-in commits (h2.35: 'the moment enter finalizes — option accept, write-in commit, or a text/write-in re-commit on an answered question'). In writeInEnter (landed by P1.M2.T2.S1), when the question is answered/submitted AND rippleVictims is non-empty, defer the commit into the existing modal: new confirmMode kind \"writein\" (stash text + victims), reusing the SAME renderConfirmFooter (footer string verbatim, unchanged) and the kind-agnostic modal key handling. applyWriteInConfirm mirrors applyConfirmedEdit's tail (applyAnswer {value, custom: true, at} → evaluateDependsOn → advance) + blurTextField; cancelWriteInConfirm re-seeds the editor from the recorded answer with zero state change. Mock nothing; reuse ripple-confirm.test.ts fixture patterns."
---

## Goal

**Feature Goal**: FR-D1 ripple sentence (h2.35): a write-in commit (`enter` in write-in duty, P1.M2.T2.S1) on an ANSWERED/SUBMITTED question whose `dependsOn` ripple (transitive closure) hits answered/submitted questions routes through the SAME keep/cancel modal — footer `⚠ Invalidates {n} answered questions ({ids}) — enter=keep, esc=cancel` verbatim and unchanged; `enter` applies the commit (applyAnswer → evaluateDependsOn → advance → blur); `esc` reverts with zero state change. Write-in edits behave identically to option edits for FR-18.

**Deliverable**: Modified `src/panel/actions.ts` (writeInEnter gains the ripple gate), `src/panel/ripple-confirm.ts` (new `beginWriteInConfirm`/`applyWriteInConfirm`/`cancelWriteInConfirm` + widened `RippleConfirmState.kind`), `src/panel/panel.ts` (handleInput modal branch dispatches the new kind — 2 lines), plus tests in `src/panel/ripple-confirm.test.ts` (and one actions.test.ts case if the gate assertion lives there).

**Success Definition**: `npm test` + `npm run typecheck` green; scripted: answered question with 2 victims → accept Other → type → `enter` → confirmMode set (`kind: "writein"`), NO answer applied, footer shows the verbatim modal line; modal `enter` → custom answer applied, dependsOn re-derived (victims moot), panel advanced, editor blurred (duty reset); modal `esc` → zero state change, editor re-seeded from the recorded answer, still write-in focused; zero victims or unanswered question → commit applies directly with no modal (S1 behavior preserved); existing choice/text confirm flows byte-identical.

## User Persona

**Target User**: TUI user revisiting an answered question to replace its answer with a write-in — they must see the same invalidation warning they'd get for an option edit, with identical keys.

**Use Case**: Q1 answered `postgres` (option); Q7/Q12 depend on Q1 and are answered. User re-enters Q1, accepts `✎ Other`, types "cockroachdb", hits `enter` → footer: `⚠ Invalidates 2 answered questions (Q7, Q12) — enter=keep, esc=cancel`. Enter → Q1 = write-in `cockroachdb`, Q7/Q12 moot instantly, panel advances. Esc → nothing changed, editor restored to the recorded answer.

**User Journey**: (same as any FR-18 edit — h2.35 deliberately makes write-in commits indistinguishable from option edits at this seam).

**Pain Points Addressed**: A write-in silently invalidating dependent answers with no confirmation — the exact trap FR-18 exists for, now reachable through the new write-in path.

## Why

- h2.35 (verbatim): the confirm triggers on "the moment `enter` finalizes — option accept, **write-in commit**, or a text/write-in re-commit on an answered question" — the write-in commit path landed in P1.M2.T2.S1 without this gate, by contract ("Ripple routing for write-in commits on answered/submitted questions lands in P1.M2.T2.S2").
- h2.32 elaboration bullet notes the FR-18 clause is "simplified from the old arm-flag carry-through, which the two-stage removal obsoletes" — the `arm` flag in `beginTextConfirm` belongs to the soon-deleted stage machinery (P1.M2.T4.S1); this item must NOT add any arm usage (plain commit semantics).
- AC-7 ("Edit an answered question that invalidates 3 others → confirm dialog appears; esc cancels with no state change; enter applies") now covers write-in edits.
- Output consumed by P2.M1.T1.S1 (post-commit auto-submit check runs on the APPLIED path — applyWriteInConfirm's tail is a maybeAutoSubmit hook site).

## What

### 1. The gate — `src/panel/actions.ts` `writeInEnter` (from S1's contract)

Insert immediately after the empty-buffer branch, BEFORE `applyAnswer`:

```ts
// FR-18 / h2.35: a write-in commit on an answered/submitted question with
// ripple victims routes through the SAME keep/cancel modal as option edits
// (P1.M2.T2.S2) — the commit is DEFERRED to applyWriteInConfirm; enter
// applies, esc reverts. Zero victims → direct commit (createRippleConfirm
// semantics; the modal only exists when something would be invalidated).
const status = q.status;
if ((status === "answered" || status === "submitted") && rippleVictims(panel, q.id).length > 0) {
  beginWriteInConfirm(panel, text);
  return true; // consumed — nothing applied yet
}
```

Everything else in `writeInEnter` unchanged (S1's contract: empty → `commitTextDraft(q.id, text, {arm:false})`; else apply → evaluateDependsOn → advance → blur). Imports: `rippleVictims`, `beginWriteInConfirm` from `./ripple-confirm.js` (panel.ts already imports `rippleVictims` from there — same precedent).

### 2. State shape — `src/panel/ripple-confirm.ts`

Widen `RippleConfirmState.kind` to `"choice" | "text" | "writein"` and document the new kind on the interface:

```ts
/** Write-in: the staged commit payload (deferred write-in commit on an
 *  answered/submitted question — h2.35). `text` carries the buffer; the
 *  applied payload is { value: text, custom: true, at: now } (h2.42). No
 *  `arm` — write-in commits are plain commits (the two-stage machinery is
 *  being removed, P1.M2.T4.S1); no `proposed` — reuse `text`. */
```

`text?: string` already exists on the state (text kind) — the writein kind reuses it. No other field changes. `renderConfirmFooter` takes `victims` only — the verbatim footer comes free for the new kind.

### 3. New flow functions — `src/panel/ripple-confirm.ts`

```ts
/**
 * [Mode A] Write-in commit gate entry (FR-18 × WRITEIN-001, h2.35, P1.M2.T2.S2):
 * called by writeInEnter when the current question is answered/submitted
 * AND rippleVictims is non-empty. Stashes the buffer as a writein-pending
 * confirm; the editor STAYS FOCUSED in write-in duty behind the modal
 * (modal keys are consumed by handleInput's confirmMode branch — the
 * editor never sees them). Nothing is applied until applyWriteInConfirm.
 */
export function beginWriteInConfirm(panel: InterrogationPanel, text: string): void {
  const id = panel.currentId;
  if (id === undefined) return;
  panel.confirmMode = {
    questionId: id,
    kind: "writein",
    text,
    victims: rippleVictims(panel, id),
    priorCursorIndex: panel.cursorIndex,
  };
  panel.invalidate();
}

/**
 * Confirm-enter for a write-in commit (the deferred apply). Clears the mode
 * FIRST, then mirrors writeInEnter's commit tail EXACTLY ONCE — never
 * re-invoking the gate: applyAnswer({ value: text, custom: true, at })
 * (h2.42: a hand-written answer ships BY ITSELF with the custom marker),
 * evaluateDependsOn (FR-17/AC-6: victims flip to moot instantly),
 * accept-advance via nextUnanswered (Q14 parity; stays put when nothing
 * unanswered remains), then blurTextField (resets textDuty to
 * "elaboration"). P2.M1.T1.S1 hooks maybeAutoSubmit after this tail.
 */
export function applyWriteInConfirm(panel: InterrogationPanel): void {
  const cm = panel.confirmMode;
  panel.confirmMode = null;
  if (cm === null || cm.kind !== "writein" || cm.text === undefined) return;
  panel.state.applyAnswer(cm.questionId, {
    value: cm.text,
    custom: true,
    at: new Date().toISOString(),
  });
  evaluateDependsOn(panel.state);
  const ordered = panel.state.orderedQuestions();
  const from = ordered.findIndex((q) => q.id === panel.currentId);
  const nextId = nextUnanswered(ordered, from);
  if (nextId !== undefined) panel.currentId = nextId; // setter re-seeds cursor (R2)
  panel.blurTextField(); // AFTER advance (S1's ordering: advance's cursor reset wins), resets duty
  panel.invalidate();
}

/**
 * Confirm-esc for a write-in commit — the guaranteed zero-state-change
 * path (AC-7). NO state mutation (no applyAnswer, no draft write, no
 * snapshot). Reverts the EDIT: re-seed the editor from the recorded answer
 * (cancelTextConfirm's read pattern — answer.value for text questions and
 * custom write-ins, answer.text for choice elaborations) and KEEP write-in
 * focus (the user stays in the editor they were typing in; textDuty is
 * untouched — still "writein").
 */
export function cancelWriteInConfirm(panel: InterrogationPanel): void {
  const cm = panel.confirmMode;
  panel.confirmMode = null;
  if (cm === null || cm.kind !== "writein") return;
  const q = panel.state.getQuestion(cm.questionId);
  const recorded =
    q === undefined || q.answer === undefined
      ? ""
      : q.type === "text" || q.answer.custom === true
        ? q.answer.value
        : (q.answer.text ?? "");
  panel.textField.seed(recorded);
  panel.invalidate();
}
```

Notes: `evaluateDependsOn` and `nextUnanswered` are already imported in ripple-confirm.ts (used by `applyConfirmedEdit`) — verify imports; add nothing new beyond the panel type.

### 4. Modal key dispatch — `src/panel/panel.ts` `handleInput` (~:712-720)

Current branch: enter → `kind === "text" ? applyTextConfirm : applyConfirmedEdit`; esc → `kind === "text" ? cancelTextConfirm : cancelConfirm`. Change to a three-way dispatch:

```ts
if (enter) {
  if (this.confirmMode.kind === "text") applyTextConfirm(this);
  else if (this.confirmMode.kind === "writein") applyWriteInConfirm(this);
  else applyConfirmedEdit(this);
}
if (esc) {
  if (this.confirmMode.kind === "text") cancelTextConfirm(this);
  else if (this.confirmMode.kind === "writein") cancelWriteInConfirm(this);
  else cancelConfirm(this);
}
```

(Match the file's actual if-shape; keep the existing structure, just insert the two writein cases.) Footer rendering (`:1199` `renderConfirmFooter(this.confirmMode.victims, ...)`) is kind-agnostic — untouched. The modal consumes all keys — the focused editor behind it never sees enter/esc while confirmMode is set (existing stage-0 behavior).

### 5. Explicitly OUT of scope (guard rails)

- maybeAutoSubmit (P2.M1.T1.S1) — leave a named seam comment only.
- Two-stage machinery / `arm` semantics (P1.M2.T4.S1) — the writein kind has NO arm field; do not touch `beginTextConfirm`'s.
- Elaboration duty / ctrl+t (P1.M2.T3.S1), deep-view Other select (P1.M2.T6.S1 — it reuses writeInEnter so it inherits this gate for free), draft role binding (P1.M2.T5.S1).
- No changes to `renderConfirmFooter`, `createRippleConfirm`, `applyConfirmedEdit`, `cancelConfirm`, `beginTextConfirm` — choice/text flows byte-identical.

### Success Criteria

- [ ] Answered question + victims: write-in `enter` sets `confirmMode = {kind:"writein", questionId, text, victims, priorCursorIndex}`, NO applyAnswer, NO draft write; footer is `⚠ Invalidates {n} answered questions ({ids}) — enter=keep, esc=cancel` byte-exact
- [ ] Modal `enter`: `answer = { value: <text>, custom: true, at: <ISO> }`, status `answered`, victims moot instantly (evaluateDependsOn), panel advanced (nextUnanswered), `focus === "options"` and `textDuty === "elaboration"` (blur ran after advance)
- [ ] Modal `esc`: zero state change (answer untouched, no draft write, no epoch/rev movement), editor re-seeded to the recorded answer (custom write-in → `answer.value`; prior option answer → `answer.text ?? ""`), focus stays `"text"` with duty `"writein"`
- [ ] Zero victims on an answered question → direct commit, no modal (S1 behavior)
- [ ] Unanswered/open question (any victims among dependencies) → direct commit, no modal
- [ ] Submitted-status question → same gate as answered (h2.35 "answered/submitted")
- [ ] Choice and text confirm flows: existing ripple-confirm tests green UNMODIFIED (byte-identical behavior)
- [ ] No `arm` usage anywhere in the new code; no config/state/schema changes
- [ ] `npm test` + `npm run typecheck` green

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets: the exact existing flow code (RippleConfirmState, rippleVictims, createRippleConfirm, applyConfirmedEdit's tail to mirror, cancelTextConfirm's seed-read pattern, handleInput's modal dispatch), the exact gate insertion point in writeInEnter (S1's contract function), the verbatim footer guarantee (victims-only renderer), ordering rules (clear mode first; blur after advance), the esc revert semantics per prior-answer shape, and the scope fence. No guessing.

### Documentation & References

```yaml
- file: src/panel/ripple-confirm.ts
  why: THE module to extend — RippleConfirmState (:59-83, kind union + text? reuse), rippleVictims (:94, victim filter answered/submitted),
       createRippleConfirm (modal stash pattern :108), applyConfirmedEdit (:135 — the exact tail to mirror: clear-first → applyAnswer → evaluateDependsOn → nextUnanswered advance → invalidate),
       cancelTextConfirm (:220 — the recorded-answer seed-read pattern to copy in cancelWriteInConfirm), beginTextConfirm (:181 — the stash-entry pattern)
  pattern: new trio beginWriteInConfirm/applyWriteInConfirm/cancelWriteInConfirm sits beside the text trio; mode mutated ONLY here
  gotcha: clear confirmMode FIRST in apply (re-entrancy); proposed? is NOT used by the writein kind — reuse text?

- file: src/panel/actions.ts
  why: writeInEnter (just landed by P1.M2.T2.S1 — read it first): the gate inserts after the empty-buffer branch, before applyAnswer;
       acceptOptionIndex (:232) shows the existing status-gate precedent (`if (q.status === "answered" || q.status === "submitted")`)
  gotcha: the gate condition needs BOTH the status check AND rippleVictims(...).length > 0 — panel.confirmRippleEdit is the CHOICE seam (stashes kind "choice", drops custom) — do NOT reuse it for write-ins

- file: src/panel/panel.ts
  why: handleInput modal branch (:712-720 — insert the two writein dispatch cases), footer render (:1199 — kind-agnostic, untouched),
       confirmMode field doc (:457 — update the doc comment to name the writein kind), blurTextField (resets textDuty per S1)
  gotcha: while confirmMode is non-null handleInput consumes EVERY key before the editor forward — the focused editor behind the modal never sees enter/esc (rely on this; do not blur on stash)

- file: src/panel/ripple-confirm.test.ts
  why: fixture patterns to reuse verbatim — no-mock panel harness, victim-laden dependsOn fixtures, footer string assertions
  gotcha: existing choice/text cases must pass UNMODIFIED — new cases are additive

- file: plan/002_949db554a811/P1M2T2S1/PRP.md
  why: CONTRACT — writeInEnter's exact shape (empty branch, commit tail, blur-after-advance), textDuty field, and the explicit
       "P1.M2.T2.S2 adds the answered/submitted ripple routing as its own diff" seam this item fills
- file: plan/002_949db554a811/prd_snapshot.md (h2.35, h2.32 FR-18 clause, h2.42 answer shape, h2.10 AC-7/AC-2a)
  why: verbatim ripple sentence incl. "write-in commit"; plain-commit semantics (no arm); {value, custom:true, at} shape
```

### Current Codebase tree (relevant slice)

```bash
src/panel/ panel.ts actions.ts ripple-confirm.ts ripple-confirm.test.ts actions.test.ts layout.ts (renderConfirmFooter)
```

### Desired Codebase tree

```bash
# no new files — modifications + additive tests only
src/panel/ripple-confirm.ts  # kind union + writein trio + JSDoc
src/panel/actions.ts         # writeInEnter ripple gate
src/panel/panel.ts           # modal dispatch cases + confirmMode doc comment
src/panel/ripple-confirm.test.ts  # new write-in modal cases
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// ESM ".js" import suffixes; ripple-confirm.ts already imports evaluateDependsOn + nextUnanswered for applyConfirmedEdit — check before adding.
// Do NOT widen/Use `proposed` for the writein payload — it types as {value, at} (no custom) and routes kind "choice" apply logic; the writein kind owns its payload in `text`.
// esc revert must handle BOTH prior-answer shapes: a custom write-in (seed answer.value) and a prior option answer (seed answer.text ?? "") — copy cancelTextConfirm's read, plus the `answer.custom === true` branch.
// blur AFTER the advance in applyWriteInConfirm (S1's ordering rule: the currentId setter re-seeds the cursor; blur's invalidate is harmless after).
// The modal is stage-0 in handleInput: it consumes ALL keys — no editor key can leak past it; don't add defensive editor handling.
// Victim set is computed BEFORE any apply (rippleVictims filters CURRENT statuses) — compute in beginWriteInConfirm once, stash, never recompute.
// Byte-exact footer assertions: `⚠ Invalidates 2 answered questions (Q7, Q12) — enter=keep, esc=cancel` — em-dash U+2014, comma+space id list.
// No `arm` anywhere: the two-stage machinery is scheduled for deletion (P1.M2.T4.S1); writein commits are plain commits (h2.32 simplification note).
```

## Implementation Blueprint

### Data models and structure

Only the union widening: `RippleConfirmState.kind: "choice" | "text" | "writein"` (writein reuses the existing `text?` field; no `arm`, no `proposed`). Answer payload at apply: `{ value: text, custom: true, at: ISO }` (h2.42, already supported end-to-end by P1.M1.T1.S1).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/panel/ripple-confirm.ts
  - WIDEN kind union; add interface doc for the writein kind (What §2)
  - ADD beginWriteInConfirm / applyWriteInConfirm / cancelWriteInConfirm (What §3)
  - FOLLOW pattern: the text trio (begin/apply/cancel TextConfirm) — stash, clear-first apply, seed-read cancel
  - JSDOC: Mode A, quote the h2.35 ripple sentence; note the P2.M1.T1.S1 maybeAutoSubmit seam on the apply tail

Task 2: MODIFY src/panel/actions.ts
  - writeInEnter: insert the status + rippleVictims gate before applyAnswer (What §1)
  - IMPORTS: rippleVictims, beginWriteInConfirm from "./ripple-confirm.js"

Task 3: MODIFY src/panel/panel.ts
  - handleInput modal branch: add writein cases to enter and esc dispatch (What §4)
  - confirmMode field doc comment: name the third kind and its owner (P1.M2.T2.S2)

Task 4: TESTS — src/panel/ripple-confirm.test.ts (reuse existing fixtures)
  - writein_commit_on_answered_with_victims_defers_into_modal (confirmMode shape; NO state change; footer byte-exact)
  - writein_confirm_enter_applies_custom_answer_moots_victims_advances_blurs
    (answer {value,custom:true,at}; victims moot; currentId advanced; focus options; duty elaboration)
  - writein_confirm_esc_reverts_zero_state_change (answer/draft/rev/epoch untouched; editor seeded from recorded answer — BOTH prior shapes:
     prior custom write-in → answer.value; prior option answer → answer.text ?? "")
  - writein_commit_zero_victors_applies_directly (no modal)
  - writein_commit_open_question_applies_directly_even_with_dependents
  - writein_commit_submitted_question_gates (same as answered)
  - choice_and_text_flows_unchanged (existing tests unmodified — the real assertion is that none of them were edited)
  - NAMING: existing file's test-name style
  - PLACEMENT: src/panel/ripple-confirm.test.ts (one gate test may sit in actions.test.ts beside the S1 write-in tests if that's where writeInEnter cases live)

Task 5: GATES
  - npx vitest run src/panel/ripple-confirm.test.ts src/panel/actions.test.ts
  - npm test && npm run typecheck   # two-stage.test.ts must stay green (no arm interaction)
```

### Implementation Patterns & Key Details

See What §1–§4 for the exact code. The two load-bearing orderings: (a) in `applyWriteInConfirm`, clear `confirmMode` FIRST and blur AFTER the advance; (b) in `writeInEnter`, the gate runs only on the non-empty path — an empty buffer never reaches it (empty = no commit = nothing to confirm).

### Integration Points

```yaml
DOWNSTREAM SEAMS (do NOT implement):
  - P2.M1.T1.S1: maybeAutoSubmit hooks at applyWriteInConfirm's tail (after blur) — the APPLIED path is the auto-submit trigger
  - P1.M2.T4.S1: two-stage deletion must not touch the writein kind (it has no arm to remove)
  - P1.M2.T6.S1: deep-view Other select reuses writeInEnter → inherits this gate unchanged
CONFIG: none; STATE: none; SCHEMA: none; FOOTERS: none (renderConfirmFooter reused as-is)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npx vitest run src/panel/ripple-confirm.test.ts
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/    # whole panel suite green, two-stage included
npm test
```

### Level 3: Integration Testing

Optional manual TUI pass via debug upsert: seed an answered question with answered dependents, accept Other, type, enter → observe modal footer; enter → victims grey with reasons; repeat with esc → nothing changed. AC-7-with-write-in is scripted in the P4 sweep.

### Level 4: Domain Validation

Review the JSDoc against contract point 3 (verbatim footer, reuse, no mocks); confirm h2.35's ripple sentence is quoted and every clause maps to a code site (answered/submitted gate, transitive victims, enter=keep applies, esc=cancel reverts, applied commit then "runs the auto-submit check like any other" → P2 seam comment).

## Final Validation Checklist

- [ ] `npm test` + `npm run typecheck` green; existing ripple-confirm choice/text tests UNMODIFIED and green
- [ ] All Success Criteria checked (esp. zero-state-change esc, blur-after-advance, both prior-answer seed shapes)
- [ ] Footer string byte-exact and renderer untouched
- [ ] No arm usage, no config/state/schema changes, choice/text flows untouched
- [ ] Mode A JSDoc with h2.35 quote and P2 seam named
- [ ] Scope fence respected (no maybeAutoSubmit, no two-stage edits, no ctrl+t/deep-view work)

---

## Anti-Patterns to Avoid

- ❌ Don't reuse `panel.confirmRippleEdit` for write-ins — it stashes kind "choice" and drops the `custom` marker
- ❌ Don't stuff the write-in payload into `proposed` — widen nothing; use the existing `text` field with a new kind
- ❌ Don't compute victims at apply time — stash them at begin (statuses shift after applies)
- ❌ Don't blur on stash — the editor stays focused behind the modal; esc keeps the user in it
- ❌ Don't touch the choice/text flows or their tests "for consistency" — this diff is purely additive
- ❌ Don't add an `arm` option — plain commit semantics (h2.32's simplification note; the machinery dies in P1.M2.T4.S1)
- ❌ Don't gate on empty buffers — no commit, no confirm (S1 already returns before the gate)

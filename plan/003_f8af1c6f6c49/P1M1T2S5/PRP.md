# PRP — P1.M1.T2.S5: `writeInEnter` — byte-identical re-commit inert + buffer consume

## Goal

**Feature Goal**: Implement FR-35/FR-D9's write-in half (ANSWER-PIN-001, spec h2.8 h3.5 / h2.34 / h2.65, AC-16; binding contract: `plan/003_f8af1c6f6c49/architecture/answer-pinning-contract.md` § FR-D9 second bullet): when `enter` in write-in duty commits buffer text that IS byte-identical to the question's already-recorded write-in answer, the commit must be a **state NO-OP that still consumes the buffer, advances, and blurs** — no ripple-victims modal, no `applyAnswer`, no `answer.at` rewrite, no `evaluateDependsOn` re-run, no `maybeAutoSubmit` trigger, and NO draft-slot residue (the identical text must never be staged back into the draft slot by the advance's write-through).

**Deliverable**: A byte-identical short-circuit inside `writeInEnter` in `src/panel/actions.ts` (~line 311, placed AFTER the empty-buffer gate and BEFORE the ripple-victims branch), plus a new test group in `src/panel/actions.test.ts`. This is the write-in twin of S4 (`acceptOptionIndex`, landed commit `d6d1553`) — same contract shape, write-in seam.

**Success Definition**:
- Match condition (two-clause, from the binding contract): `q.answer !== undefined && q.answer.value === text && (q.answer.custom === true || q.type === "text")`.
  - Choice questions: inert ONLY for a recorded write-in (`custom === true`) re-committed byte-identically.
  - Text questions: `answer.value === text` matches regardless of the custom flag (fallback `answers[]` records text answers without it — `fallback.ts:252`, `debug-commands.ts:222`).
- Inert path performs ONLY: `panel.consumeCommittedBuffer(q.id)` → `advanceAfterAccept(panel)` → `panel.blurTextField()` → `return true`. It does NOT call: `beginWriteInConfirm`, `applyAnswer`, `evaluateDependsOn`, `maybeAutoSubmit`. No flash, no epoch bump, no `sendMessage`, no modal.
- `answer.at` is byte-identical after the no-op (no fresh timestamp); `status` unchanged (an archived `closed` question is NOT re-marked pending).
- After the inert exit, `panel.draftTextFor(q.id)` is empty — the identical text cannot ship later as a phantom elaboration (VAL-002).
- A DIFFERENT write-in text (or a recorded option value equal to the buffer text on a choice question) keeps today's behavior exactly: victims modal on answered/submitted edits, direct commit otherwise, auto-submit per AUTOSUBMIT-003.
- Full vitest suite + `tsc --noEmit` green.

## User Persona

**Target User**: The planner (human) answering interrogation questions in the pi TUI panel.

**Use Case**: The user revisits a question they already answered with a hand-written write-in (`✎ Other`), re-enters the write-in editor, and presses `enter` on text identical to their recorded answer (retyped, or an identical draft was present).

**User Journey**: navigate back (caret pins to the ✎ Other row, T1) → accept Other → type/re-view text → `enter` → the panel advances to the next unanswered question; the editor closes; NOTHING else happens — no modal accusing them of invalidating their own work, no fresh timestamp, no phantom submission, no leftover draft that would attach itself to a future option choice.

**Pain Points Addressed**: Today that `enter` re-proposes the answer as an edit — the FR-18 keep/cancel modal fires on a no-change keystroke, archived answers re-pend, a complete-set rule-(b) position ships a phantom submission (epoch bump + model turn + panel suspend), and the identical text can be staged into the draft slot where a later option accept would ship it as bogus `answer.text` elaboration. User's words (2026-10-04 interrogation): "DO NOT RE-PROPOSE ANYTHING AFTER A USER HAS SELECTED AN ANSWER. THESE QUESTIONS TAKE HARD WORK. Always keep the user's answer. No exceptions."

## Why

- ANSWER-PIN-001 (h2.65) reversed the status-agnostic re-propose behavior for options (S4, landed) — FR-35/FR-18 extend the identical ruling to write-ins: "a byte-identical write-in re-commit is equally inert" and "An identical re-commit … or a byte-identical write-in — is not a change: no modal, no state write, advance only."
- Siblings already landed: T1 (`1fba337` cursor seeding — the caret now pins to the ✎ Other row for write-in answers, making same-value enter the natural revisit gesture) and S4 (`d6d1553` — `acceptOptionIndex` inert no-op). S5 completes the accept-path pair; S6 (`acceptFromDeep`) builds after it.
- The buffer-consume half prevents a silent data bug unique to the write-in path: `advanceAfterAccept` → `syncBufferToQuestion` writes the outgoing buffer into the question's draft slot; without consume, the just-"committed" identical text becomes a staged draft that `reconcileDraftsForSubmit` would later attach as elaboration to a DIFFERENT option choice (VAL-002 pattern, already proven on the real commit path at actions.ts:339–344).

## What

Modify ONE function: `writeInEnter(panel)` in `src/panel/actions.ts` (current body quoted in full below, verified at lines 311–349):

```ts
export function writeInEnter(panel: InterrogationPanel): boolean {
  const q = currentQuestion(panel);
  if (q === undefined) {
    panel.blurTextField();
    return true;
  }
  const text = panel.textField.getText();
  if (text.trim().length === 0) {
    // Empty: draft write-through + blur, no commit (R4) — reuse the
    // existing save tail …, explicitly NOT a commit.
    panel.commitTextDraft(q.id, text);
    return true;
  }
  // FR-18 / h2.35: a write-in commit on an answered/submitted question with
  // ripple victims routes through the SAME keep/cancel modal as option edits
  // (P1.M2.T2.S2) — the commit is DEFERRED to applyWriteInConfirm …
  const status = q.status;
  if ((status === "answered" || status === "submitted") && rippleVictims(panel, q.id).length > 0) {
    beginWriteInConfirm(panel, text);
    return true; // consumed — nothing applied yet
  }
  panel.state.applyAnswer(q.id, { value: text, custom: true, at: new Date().toISOString() });
  // FR-17: … AFTER the apply, BEFORE the advance …
  evaluateDependsOn(panel.state);
  // VAL-002: the buffer text just BECAME the answer — consume it …
  panel.consumeCommittedBuffer(q.id);
  advanceAfterAccept(panel); // Q14 parity: currentId → next unanswered …
  panel.blurTextField(); // resets textDuty to "elaboration"
  maybeAutoSubmit(panel, undefined, { wasUnanswered: status === "open" || status === "reasked", questionId: q.id });
  return true;
}
```

New behavior — insert the short-circuit AFTER the empty-buffer gate's closing `}` and BEFORE the `// FR-18 / h2.35:` comment block:

```ts
  // ANSWER-PIN-001 / FR-D9: a byte-identical write-in re-commit is an inert
  // no-op that advances — never a re-proposal. Checked BEFORE the
  // ripple-victims branch: a same-value re-commit is not a change (FR-18),
  // so no keep/cancel modal, no applyAnswer (no fresh answer.at), no moot
  // recompute, no auto-submit. Two-clause match: choice questions require a
  // recorded WRITE-IN (custom === true) — an option answer whose value
  // byte-equals the buffer text is a different-KIND commit (it would flip
  // custom OFF) and routes through the normal paths; text questions match on
  // value alone (fallback answers[] records text answers without the custom
  // flag — same kind either way). Byte-identical = strict === on the RAW
  // buffer; whitespace-differing text is a real edit. VAL-002 parity: the
  // buffer still "became" the answer, so consume it — otherwise the advance's
  // syncBufferToQuestion write-through stages the identical text into q's
  // draft slot, where a later option accept would ship it as bogus
  // elaboration (answer.text).
  const recorded = q.answer;
  if (recorded !== undefined && recorded.value === text && (recorded.custom === true || q.type === "text")) {
    panel.consumeCommittedBuffer(q.id); // BEFORE advance: kill the write-through source
    advanceAfterAccept(panel); // Q14 rhythm: advance only, no state write
    panel.blurTextField(); // AFTER advance (commit-tail parity): editor closes, duty resets
    return true;
  }
```

Also extend `writeInEnter`'s JSDoc (the block at actions.ts:286–310) with the no-op-first sentence, and extend `accept()`'s JSDoc Other-row/text-question bullets (actions.ts:206–213) with the same-value-inert clause (mirroring what S4 did for the option bullet — actions.ts only; the cross-file comment sweep is S8, P1.M1.T4.S8).

### Success Criteria

- [ ] Byte-identical re-commit on an `answered` write-in (choice question): inert — no `confirmMode`, `answer.value`/`answer.at`/`status` unchanged, advances to next unanswered (or stays when none), editor blurred (`panel.focus === "options"`), `draftTextFor(q.id)` empty.
- [ ] Byte-identical re-commit WITH ripple victims present (`answered` + dependents that the change would invalidate): STILL inert — the victims branch is never reached; `panel.confirmMode` stays null. This is the branch-order proof.
- [ ] Text question (`type: "text"`) with a NON-custom recorded answer (fallback shape, no `custom` flag) + identical buffer: inert; `at` unchanged.
- [ ] Byte-identical re-commit on `closed` (archived): inert; status STAYS `closed` (not re-marked pending).
- [ ] Recorded OPTION answer (no custom) on a choice question whose value equals the buffer text: NOT inert — normal path (victims check → modal or direct commit), `answer.at` fresh, `custom: true` applied (different-kind edit).
- [ ] DIFFERENT write-in text on an answered/submitted question: today's behavior preserved (victims modal with victims; direct commit + fresh `at` without).
- [ ] Complete-set rule-(b) position (all answered, currentId = last answerable): byte-identical re-commit triggers NO auto-submit — epoch unchanged, `sendMessage` never called, no flash, panel not suspended.
- [ ] `npx vitest run` and `npm run typecheck` green.

## All Needed Context

### Context Completeness Check

If someone knew nothing about this codebase, could they implement this successfully? Yes: the PRP quotes the exact function to modify and the exact insertion point, the verbatim binding contract clause, the two-clause match condition with its rationale, the buffer-consume mechanics (`consumeCommittedBuffer` / `syncBufferToQuestion` quoted), the test-file fixtures to reuse (quoted), the sibling landed implementation to mirror (S4, commit `d6d1553`), and the verification commands. No pi runtime or TUI session is needed — all behavior is verifiable headless via vitest against the real `InterrogationState`.

### Documentation & References

```yaml
- file: plan/003_f8af1c6f6c49/architecture/answer-pinning-contract.md
  why: BINDING contract for this changeset — FR-D9 second bullet is this task verbatim
  pattern: "writeInEnter: byte-identical write-in re-commit (answer.custom === true && text === answer.value; likewise answer.value === text on text questions) equally inert — checked BEFORE the ripple-victims branch; consume/neutralize the buffer (VAL-002 pattern) so the advance's draft write-through cannot stage committed text into the draft slot."
  gotcha: the SAME doc's third bullet (acceptFromDeep third outcome) is S6 — do NOT implement it here; Non-goals block forbids config keys / hotkey rows / auto-submit changes / state edits

- file: src/panel/actions.ts
  why: the file to modify; writeInEnter (:286 JSDoc, :311 body), accept (:214, Other-row/text duty entry + its JSDoc :206), advanceAfterAccept (:357), maybeAutoSubmit consumer, VAL-002 comment (:339)
  pattern: Mode A contract — handlers take (panel), call panel.invalidate()/advance; every mutation path documented in dense JSDoc citing spec anchors; S4's landed short-circuit in acceptOptionIndex (:252–266) is the direct stylistic model
  gotcha: insertion point is AFTER the empty-buffer gate, BEFORE `const status = q.status;` (:327) — inside/after the victims branch is too late (modal fires) and after `applyAnswer` defeats the point

- file: src/panel/actions.test.ts
  why: test file to extend; fixtures verbatim — seed() (applies answerValue ?? "a" via applyAnswer, NO custom flag), choiceQ(), OPTS_AB, T0, seamMock(), makePanel(), makeDeps(), text-question overrides { type: "text", options: undefined } (:277), write-in answer seeding state.applyAnswer(id, { value, custom: true, at: T0 }), duty entry panel.focusTextField("writein") (two-stage.test.ts:263 precedent) or accept() with cursorIndex = options.length, buffer via panel.textField.setText()
  pattern: S4's committed describe "accept same-value — inert no-op (ANSWER-PIN-001 / FR-D9)" (commit d6d1553) — place the new describe immediately AFTER it; snake_case test names; assertions on state.getQuestion / panel.currentId / panel.confirmMode (:1045 precedent) / panel.footerFlash / panel.draftTextFor / panel.focus
  gotcha: seed()'s default answer has NO custom flag — write-in scenarios must apply answers explicitly with custom: true

- file: src/panel/panel.ts
  why: READ-ONLY — the three seam methods the inert path composes: consumeCommittedBuffer (:962–968: bufferOwner guard, seed(""), draftSlots.delete, clearDraft, bufferOwner = undefined), syncBufferToQuestion (:1089–1110: the write-through the consume defeats), blurTextField (:1190–1197: focus → options, textDuty reset, no draft write-through), focusTextField (:1164: seeds from freshest DRAFT, never the answer)
  pattern: consumer contract only
  gotcha: consumeCommittedBuffer is a NO-OP when bufferOwner !== questionId (e.g. writeInEnter called without focusTextField in a test) — that is correct, not a bug; there is no staging risk without ownership

- file: src/panel/ripple-confirm.ts
  why: READ-ONLY — rippleVictims(panel, id) + beginWriteInConfirm(panel, text) are the seam being skipped; victims setup for the branch-order test: q2 dependsOn { id: "q1", equals: "<recorded write-in value>" } and is currently met
  pattern: deferred modal panel.confirmMode = { kind: "writein", … }; modal enter → applyWriteInConfirm, esc → cancelWriteInConfirm (panel.ts:771/775)
  gotcha: "skipped" means panel.confirmMode stays null/undefined — assert it, not just the return value

- file: src/state.ts
  why: READ-ONLY — QuestionAnswer shape (:42–57: { value, text?, custom?, at }); applyAnswer assigns a FRESH answer object with a new `at` on every call (the rewrite the no-op must avoid)
  gotcha: never touch state.ts in this task (contract Non-goals)

- file: src/fallback.ts (:186, :252) and src/debug-commands.ts (:222)
  why: READ-ONLY — proof that non-TUI recorded answers carry NO custom flag (state.applyAnswer(id, { value, text?, at })) — the reason the text-question clause is custom-agnostic
  gotcha: do not "fix" fallback to set custom — out of scope and harmless by design

- file: plan/003_f8af1c6f6c49/P1M1T2S5/research/codebase-findings.md
  why: this task's research notes — current-code listing, two-clause rationale, consume mechanics, fixture inventory, flip-risk survey of every existing write-in commit in the suite
  pattern: n/a
  gotcha: n/a
```

### Current Codebase tree (relevant excerpt)

```bash
pi-structured-interrogation/
├── package.json              # scripts: test = vitest run; typecheck = tsc --noEmit
├── src/
│   ├── panel/
│   │   ├── actions.ts        # MODIFY: writeInEnter short-circuit (+ JSDoc in writeInEnter/accept) — the deliverable
│   │   ├── actions.test.ts   # EXTEND: new describe after S4's inert group
│   │   ├── panel.ts          # READ-ONLY (consumeCommittedBuffer / syncBufferToQuestion / blurTextField)
│   │   └── ripple-confirm.ts # READ-ONLY (the skipped seam)
│   ├── state.ts              # READ-ONLY (QuestionAnswer, applyAnswer fresh-object)
│   └── …                     # untouched
└── vitest.config.ts
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# No new files. Two modified files only:
src/panel/actions.ts        # writeInEnter: byte-identical short-circuit before the victims branch + JSDoc clauses
src/panel/actions.test.ts   # new describe "write-in same-value — inert no-op + buffer consume (ANSWER-PIN-001 / FR-D9)"
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: placement — AFTER the empty-buffer gate (a byte-identical commit
// is by definition non-empty, so gate order is safe), BEFORE the
// ripple-victims branch. Inside the victims branch is TOO LATE: a
// byte-identical commit on an answered question WITH victims must never see
// the modal ("a same-value re-commit is not a change" — FR-18).

// CRITICAL: two-clause match, do not collapse it to value equality alone.
// Choice: recorded.custom === true REQUIRED — an option answer whose value
// byte-equals the text is a different-KIND commit (flips custom OFF) and
// must route normally (mirror of S4's custom exclusion, opposite direction).
// Text: value equality alone (custom-agnostic) — fallback.ts:252 and
// debug-commands.ts:222 record text answers WITHOUT the flag.

// CRITICAL: byte-identical = strict === on the RAW buffer. The commit path
// applies raw text (trim is only the emptiness gate) — so text differing by
// ANY whitespace is a real edit: victims modal / fresh at / auto-submit per
// today's rules.

// CRITICAL: consume BEFORE advance, blur AFTER advance. Consume kills the
// buffer ownership so advanceAfterAccept's currentId setter →
// syncBufferToQuestion cannot write the identical text into q's draft slot
// (VAL-002 phantom-elaboration trap). Blur after advance is the documented
// commit-tail ordering: the currentId setter's cursor re-seed wins on the
// repainted view; blurTextField then resets textDuty to "elaboration" and
// drops the editor from the layout. Without blur, focus stays "text" on the
// NEXT question — the user would be typing into its write-in buffer.

// CRITICAL: do NOT call panel.commitTextDraft on the inert path — it SAVES
// the text as a draft (the exact opposite of consume). The empty-buffer
// branch is the only commitTextDraft caller in this function.

// CRITICAL: closed (archived) + byte-identical must NOT re-mark pending.
// FR-2/AC-13's "editing re-marks pending" applies to CHANGES (h2.40: "A
// same-value re-commit is not an edit — no confirm, no state write").
// Observable: status stays "closed"; the next submit ships nothing for it.

// CRITICAL: AUTOSUBMIT-003 rule-(b) suppression. Today a byte-identical
// write-in "edit" on the last answerable question of a complete set fires
// maybeAutoSubmit (submission + epoch bump + sendMessage + panel suspend).
// The inert path skips maybeAutoSubmit entirely. Observable: epoch
// unchanged, sendMessage mock not called, footerFlash undefined.

// NOTE: moot questions never reach write-in duty via accept() (blocked at
// actions.ts:220) — add no moot guards; the answer-based check is harmless
// if reached via other focus paths (a moot question keeps its dimmed answer).

// NOTE: the write-in editor seeds from the FRESHEST DRAFT, never the
// recorded answer (focusTextField → freshestDraftFor). Reaching a
// byte-identical buffer means the user retyped it or an identical draft
// existed. Changing the seeding is NOT this task (T1's dim preview on the ✎
// row is the recorded write-in's display).

// GOTCHA (tests): seed() applies answers WITHOUT custom — write-in scenarios
// need explicit state.applyAnswer(id, { value, text, custom: true, at: T0 }).
// Assert answer.at === T0 to prove no rewrite. consumeCommittedBuffer no-ops
// unless the buffer is owned (focusTextField first). vitest only (no live pi
// session — AUTOMATION-POLICY binding).
```

## Implementation Blueprint

### Data models and structure

No new data models. Existing shape relied upon (state.ts:42–57):

```ts
interface QuestionAnswer {
  value: string;   // chosen option value, or raw text (write-ins / text questions)
  text?: string;   // free-text elaboration attached to a selection
  custom?: boolean; // WRITEIN-001: value holds free text; renders as ✎ {text}
  at: string;      // ISO 8601 — must never be rewritten by a no-op
}
```

### Implementation Tasks (TDD-ordered)

```yaml
Task 1: ADD tests in src/panel/actions.test.ts — new describe IMMEDIATELY AFTER
  S4's "accept same-value — inert no-op (ANSWER-PIN-001 / FR-D9)" group
  - DESCRIBE: "write-in same-value — inert no-op + buffer consume (ANSWER-PIN-001 / FR-D9)"
  - FIXTURES (reuse, do not duplicate): seed(), seamMock(), makePanel(), makeDeps(), OPTS_AB, T0;
    text questions via overrides { type: "text", options: undefined }; write-in answers via
    state.applyAnswer(id, { value: "alpha", custom: true, at: T0 }); duty entry via
    panel.focusTextField("writein") after panel.currentId = "q1"; buffer via panel.textField.setText("alpha")
  - TESTS (snake_case names):
    1. test_wi_same_value_recommit_on_answered_writein_is_inert_and_advances —
       q1 answered write-in "alpha" (custom: true, at T0), q2 open; focusTextField("writein"),
       setText("alpha"); writeInEnter(panel) → true; q1: answer.value "alpha", answer.at === T0,
       status "answered"; panel.currentId === "q2"; panel.focus === "options" (blurred)
    2. test_wi_same_value_recommit_with_victims_skips_modal_and_is_inert —
       BRANCH-ORDER PROOF: q1 answered write-in "alpha"; q2 dependsOn { id: "q1", equals: "alpha" }
       (currently met); focus writein on q1, setText("alpha"), writeInEnter → true;
       panel.confirmMode stays undefined (no beginWriteInConfirm); answer.at === T0; advances
    3. test_wi_same_value_recommit_on_text_question_without_custom_flag_is_inert —
       t1 type:"text", answered via applyAnswer({ value: "my answer", at: T0 }) (NO custom —
       fallback shape); focus writein, setText("my answer"), enter → inert; at T0; status answered
    4. test_wi_same_value_recommit_on_closed_stays_closed_not_remarked_pending —
       q1 answered write-in then setStatus("closed"); identical re-commit → status STAYS "closed",
       at T0, advances (archived edit-pending is for CHANGES only)
    5. test_wi_recorded_option_answer_equal_text_is_not_inert —
       q1 answered with option "a" via seed() default (NO custom); Other-row duty
       (cursorIndex 2 → accept, or focusTextField("writein")), setText("a"), enter → NOT inert:
       normal path applies { value: "a", custom: true, fresh at } (different-KIND edit — custom
       flips ON); answer.at !== T0
    6. test_wi_different_text_on_answered_writein_still_commits_normally —
       q1 answered write-in "alpha"; setText("beta"), enter → today's behavior: (no victims)
       direct commit — answer.value "beta", custom true, answer.at !== T0, status "answered",
       advances; regression guard mirroring S4's different-value row
    7. test_wi_same_value_recommit_consumes_buffer_no_draft_residue —
       q1 answered write-in "alpha", q2 open; focusTextField("writein") (claims bufferOwner),
       setText("alpha"), writeInEnter → inert; then expect panel.draftTextFor("q1") === ""
       (consume deleted the slot — VAL-002: a later option accept on q1 ships NO answer.text
       elaboration) and panel.focus === "options"
    8. test_wi_same_value_on_complete_set_does_not_auto_submit —
       q1,q2,q3 ALL answered with write-ins (q3 = last answerable — rule-(b) position);
       makeDeps(true) + makePanel(state, { delivery: deps }); currentId = "q3",
       focusTextField("writein"), setText(identical), enter → sendMessage 0 calls; state.epoch
       unchanged; panel.footerFlash undefined; answer.at === T0
  - RUN: npx vitest run src/panel/actions.test.ts — tests 1–4, 7, 8 FAIL (red) against
    current code; 5 and 6 may already pass (they pin normal-path behavior) — keep them as
    regression guards regardless

Task 2: IMPLEMENT the short-circuit in src/panel/actions.ts writeInEnter
  - INSERT after the empty-buffer branch's closing brace, before the "// FR-18 / h2.35:" comment
    (exact code in the What section above — includes the ANSWER-PIN-001/FR-D9 + two-clause +
    VAL-002 rationale comment)
  - EXTEND writeInEnter's JSDoc (:286–310): add the no-op-first sentence ("a byte-identical
    write-in re-commit (custom recorded write-in, or any recorded value on text questions)
    is an inert no-op: consume + advance + blur only — no modal, applyAnswer, moot recompute,
    or auto-submit")
  - EXTEND accept()'s JSDoc Other-row/text bullets (:206–213) with "(byte-identical re-commit
    inert — ANSWER-PIN-001)" mirroring the option bullet S4 updated
  - PRESERVE: everything from `const status = q.status;` down is byte-identical
  - RUN: npx vitest run src/panel/actions.test.ts — all green

Task 3: FULL suite + typecheck + triage
  - npx vitest run (full) and npm run typecheck
  - EXPECTED FLIPS: none — every existing write-in commit in the suite uses different text
    ("postgres", "cockroachdb", "a hybrid of A and B", "x", "my answer", "my textual answer")
    or an empty buffer (surveyed in research/codebase-findings.md)
  - TRIAGE RULE if a row fails: a test asserting state change / modal / auto-submit on a
    byte-identical write-in re-commit flips to inert expectations; a different-text row must
    stay green untouched — if a different-text row fails, the implementation is wrong, fix
    the implementation not the test

Task 4: COMMENT HYGIENE (minimal, actions.ts only)
  - Confine JSDoc/comment edits to actions.ts (writeInEnter + accept bullets); the
    cross-file status-agnostic-preselect sweep is S8 (P1.M1.T4.S8) — do not chase keys.ts,
    overview.ts, deep-view.ts
```

### Implementation Patterns & Key Details

```ts
// The entire behavioral change (see What for the full commented version):
const recorded = q.answer;
if (recorded !== undefined && recorded.value === text && (recorded.custom === true || q.type === "text")) {
  panel.consumeCommittedBuffer(q.id); // VAL-002 — BEFORE advance: no staging via syncBufferToQuestion
  advanceAfterAccept(panel);          // Q14 rhythm — advance only, no state write
  panel.blurTextField();              // AFTER advance (commit-tail parity) — editor closes, duty resets
  return true;                        // consumed
}
// PATTERN: the commit tail minus the three state mutations — the ONLY
//        difference between this and a real commit is zero state writes.
// GOTCHA: never reorder — consume→advance→blur mirrors applyAnswer→…
//        →consume→advance→blur→maybeAutoSubmit exactly.
// GOTCHA: `text` is the RAW buffer (getText()); strict === against
//        recorded.value — no trim, no normalization.
```

### Integration Points

```yaml
STATE: none — state.ts untouched; the no-op's whole point is zero state writes
CONFIG: none — no new keys (contract Non-goals: "No config keys, no hotkey rows")
KEYS: none — keys.ts routing untouched; enter in write-in duty already reaches writeInEnter (panel.ts:807)
AUTO-SUBMIT: none — maybeAutoSubmit body untouched; the no-op path merely never calls it
RIPPLE SEAM: none — ripple-confirm.ts untouched; the check merely precedes its branch
SIBLINGS: S6 (acceptFromDeep, P1.M1.T2.S6) builds after this — keep writeInEnter's
  signature (panel) => boolean UNCHANGED; deep-view Other selection reuses the accept() pair
  and inherits this behavior for free
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck        # tsc --noEmit — zero errors
# (No ruff/mypy/prettier in this repo — package.json has only test + typecheck.)
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/panel/actions.test.ts          # new describe + existing groups green
npx vitest run src/panel/                          # panel suite (write-in consumers: two-stage, ac-panel)
# Expected: all pass. The 8 new tests are the contract's proof (Task 1 list).
```

### Level 3: Consumer regression (System Validation)

```bash
npx vitest run   # FULL suite — no live pi session (AUTOMATION-POLICY binding:
                 # never launch pi -e . in automated runs; vitest over the real
                 # state objects IS the integration surface here)
# Expected: zero flips (surveyed); any failure triaged per Task 3's rule.
```

### Level 4: Behavior matrix walkthrough (manual reasoning over the new tests)

| Scenario | Modal? | applyAnswer? | answer.at | Status after | Advance? | Blur? | Draft residue? | Auto-submit? |
|---|---|---|---|---|---|---|---|---|
| answered write-in + identical text, no victims | no | no | T0 | answered | yes | yes | none (consumed) | no |
| answered write-in + identical text, WITH victims | no | no | T0 | answered | yes | yes | none | no |
| text question, non-custom answer, identical text | no | no | T0 | answered | yes | yes | none | no |
| closed write-in + identical text | no | no | T0 | closed | yes | yes | none | no |
| choice: recorded OPTION value == buffer text | (victims check → maybe) | yes | fresh | answered | yes | yes | consumed (real path) | per AUTOSUBMIT-003 |
| answered write-in + DIFFERENT text | victims → maybe | yes | fresh | answered | yes | yes | consumed (real path) | per AUTOSUBMIT-003 |
| complete set, last answerable, identical text | no | no | T0 | answered | yes | yes | none | NO (epoch/sendMessage unchanged) |
| empty buffer (unchanged branch) | no | no | n/a | unchanged | no | via commitTextDraft | draft saved (R4) | no |

Each row maps 1:1 to a passing test from Task 1 (row 8 = test 8; the empty-buffer row is the existing pinned behavior, not a new test).

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` zero errors
- [ ] `npx vitest run` (full suite) green — or failures triaged per the FR-D9 contract with the flip documented in the PR notes
- [ ] No live pi session launched (AUTOMATION-POLICY)

### Feature Validation

- [ ] All 8 new tests present and passing; matrix rows in Level 4 each map to a test
- [ ] `panel.confirmMode` asserted undefined on inert paths INCLUDING the with-victims case (branch-order proof — not just "returns true")
- [ ] `answer.at === T0` asserted (the rewrite prohibition is the core of ANSWER-PIN-001)
- [ ] closed-stays-closed asserted (no phantom re-pending → no phantom `(changed)` shipment)
- [ ] Rule-(b) suppression asserted (no epoch bump, no sendMessage, no flash)
- [ ] Buffer-consume asserted (`draftTextFor(q.id) === ""` — VAL-002, the task's second deliverable)
- [ ] Different-text and option-value-equal-text rows pin today's behavior (FR-18 regression guards)

### Code Quality Validation

- [ ] Only `src/panel/actions.ts` (+ its test file) modified; state.ts, panel.ts, ripple-confirm.ts, keys.ts, deep-view.ts untouched
- [ ] `writeInEnter` signature unchanged (S6 builds on it)
- [ ] Comment updates confined to actions.ts (cross-file sweep is S8)
- [ ] New code carries ANSWER-PIN-001/FR-D9/VAL-002 spec anchors in comments, matching file conventions (S4's landed style)

### Documentation & Deployment

- [ ] No new config keys, env vars, or keymap entries (contract Non-goals)
- [ ] PR notes state that deep-view Other-row selection inherits the inert behavior via the shared accept() path (informational for S6's author)

---

## Anti-Patterns to Avoid

- ❌ Don't put the check after the ripple-victims branch — a byte-identical commit on an answered question WITH dependents must never see the keep/cancel modal; the contract names the branch order explicitly
- ❌ Don't collapse the match to `recorded.value === text` alone — on choice questions a recorded OPTION answer whose value equals the text is a different-KIND commit (custom flips) and must route normally; and don't require `custom === true` on text questions (fallback records lack the flag)
- ❌ Don't trim/normalize before comparing — byte-identical means strict `===` on the raw buffer; whitespace-differing text is a real edit
- ❌ Don't skip `consumeCommittedBuffer` because "nothing was applied" — the text still BECAME the answer semantically; without consume, the advance's `syncBufferToQuestion` stages it into the draft slot (VAL-002 phantom-elaboration trap)
- ❌ Don't call `commitTextDraft` on the inert path — it SAVES the text as a draft (the opposite of consume); it belongs to the empty-buffer branch only
- ❌ Don't skip `blurTextField` — without it, focus stays "text" and the user is typing into the NEXT question's write-in buffer; blur after advance (commit-tail ordering), never before
- ❌ Don't call `panel.flash`, arm `gateWarning`, or fire `maybeAutoSubmit` on the no-op path — silence IS the no-op's UX
- ❌ Don't reorder to advance→consume — consume must precede advance or the write-through already happened
- ❌ Don't implement S6's `acceptFromDeep` third outcome here — deep-view's veto heuristic reading the no-op as a veto is the documented interim; S6 owns the fix
- ❌ Don't flip or weaken different-text tests to make things pass — they are the FR-18 regression guard this task must preserve

---

**Confidence Score: 9/10** — one-function change with a verbatim binding contract, the landed sibling (S4, `d6d1553`) as both stylistic model and proven test pattern, quoted current code with exact insertion point, reusable fixtures inventoried, a surveyed-zero flip risk with explicit triage rules, and a fully observable headless test surface. Residual risk: an unanticipated cross-cutting test committing an identical write-in (mitigated by the Task 3 triage rule) and the with-victims fixture needing correct `dependsOn` setup (spelled out in the ripple-confirm reference).

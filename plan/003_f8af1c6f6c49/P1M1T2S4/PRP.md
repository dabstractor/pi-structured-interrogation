# PRP — P1.M1.T2.S4: `acceptOptionIndex` — same-value commit is an inert NO-OP (digit inherits)

## Goal

**Feature Goal**: Implement FR-35/FR-D9 (ANSWER-PIN-001, spec h2.8 h3.5 / h2.34 / h2.65, AC-16): when `enter` (or a digit quick-select 1–9) commits an option whose value IS the question's already-recorded answer, the commit must be a **state NO-OP that still ADVANCES** (Q14 rhythm): no ripple-seam call, no `applyAnswer`, no `answer.at` rewrite, no `evaluateDependsOn` re-run, no `maybeAutoSubmit` trigger. The FR-18 ripple confirm fires ONLY on an explicit DIFFERENT choice.

**Deliverable**: A same-value short-circuit inside `acceptOptionIndex` in `src/panel/actions.ts` (~line 244, placed BEFORE the ripple seam), plus a new test group in `src/panel/actions.test.ts`. `digit()` inherits the behavior automatically — it delegates to `acceptOptionIndex` (actions.ts:204) — and this inheritance is exactly why the check must live INSIDE `acceptOptionIndex`, not in `accept()`.

**Success Definition**:
- Match condition (status-agnostic, value-first): `q.answer !== undefined && q.answer.custom !== true && q.answer.value === opt.value` → inert path.
- Inert path performs ONLY `advanceAfterAccept(panel)` + `return true`. It does NOT call: `panel.confirmRippleEdit`, `panel.state.applyAnswer`, `evaluateDependsOn`, `maybeAutoSubmit`. No flash, no `gateWarning` arming, no epoch bump, no `sendMessage`.
- `answer.at` is byte-identical after the no-op (no fresh timestamp); `status` unchanged (an archived `closed` question is NOT re-marked pending).
- Digit quick-select on the recorded value behaves identically (inherits).
- A DIFFERENT value on an answered/submitted question still routes through the ripple seam (today's behavior, untouched).
- Full vitest suite + `tsc --noEmit` green.

## Why

ANSWER-PIN-001 (h2.65, 2026-10-04 interrogation): on revisit, the caret re-seeded to the ★ recommendation and `enter` RE-PROPOSED the recommendation as an edit — the ripple modal accused the user of invalidating their own work by keeping it, with the recommendation one keypress from overwriting a deliberately different answer. User's words: "DO NOT RE-PROPOSE ANYTHING AFTER A USER HAS SELECTED AN ANSWER. THESE QUESTIONS TAKE HARD WORK. Always keep the user's answer. No exceptions."

T1 (P1.M1.T1.S1, landed — commit `1fba337`) already seeds the caret onto the recorded answer (`initialCursorIndex`), so same-value `enter` is now the DEFAULT revisit gesture. That makes this task urgent: today's `acceptOptionIndex` routes such an `enter` through the seam and `applyAnswer` (fresh `answer.at` object every time — see `state.ts` "applyAnswer always assigns a FRESH answer object"), re-marks archived questions pending, and can trigger AUTOSUBMIT-003 rule (b) (an "edit" on the last answerable question of a complete set) — shipping a phantom submission for a no-change keystroke. FR-18 (h2.34): "An identical re-commit — `enter` or a digit on the already-recorded value … — is not a change: no modal, no state write, advance only."

## What

Modify ONE function: `acceptOptionIndex(panel, q, optionIndex)` in `src/panel/actions.ts`. Current body (lines ~244–267):

```ts
export function acceptOptionIndex(panel: InterrogationPanel, q: Question, optionIndex: number): boolean {
  const opt = displayOptions(q)[optionIndex];
  if (opt === undefined) return false;
  const proposed = { value: opt.value, at: new Date().toISOString() };
  const wasUnanswered = q.status === "open" || q.status === "reasked";
  if (q.status === "answered" || q.status === "submitted") {
    if (!panel.confirmRippleEdit(q.id, proposed)) return true; // seam vetoed
  }
  panel.state.applyAnswer(q.id, proposed);
  evaluateDependsOn(panel.state);
  advanceAfterAccept(panel);
  maybeAutoSubmit(panel, undefined, { wasUnanswered, questionId: q.id });
  return true;
}
```

New behavior — insert the same-value short-circuit AFTER `opt` resolution and BEFORE the seam block:

```ts
  const opt = displayOptions(q)[optionIndex];
  if (opt === undefined) return false;
  // ANSWER-PIN-001 / FR-D9: enter (or digit) on the ALREADY-RECORDED value
  // is a state no-op that advances — never a re-proposal. Checked BEFORE
  // the ripple seam: a same-value re-commit is not a change (FR-18), so
  // no modal, no applyAnswer (no fresh answer.at), no evaluateDependsOn,
  // no maybeAutoSubmit. Non-custom only: a write-in answer (custom) whose
  // text byte-equals an option value is a different-KIND commit (it would
  // flip the custom flag) and routes through the seam like any edit.
  const recorded = q.answer;
  if (recorded !== undefined && recorded.custom !== true && recorded.value === opt.value) {
    advanceAfterAccept(panel); // Q14 rhythm: advance only, no state write
    return true;
  }
  const proposed = { value: opt.value, at: new Date().toISOString() };
  // … rest unchanged …
```

Also update `acceptOptionIndex`'s JSDoc ("Shared commit path for accept + digit…") to state the no-op-first contract.

### Success Criteria

- [ ] Same-value accept on `answered` question: seam NOT invoked, `answer.value`/`answer.at`/`status` unchanged, `panel.currentId` advances to next unanswered (or stays when none), returns `true`.
- [ ] Same-value via `digit(panel, n)` inherits the identical inert behavior.
- [ ] Same-value on `submitted` and on `closed` (archived) questions: inert; `closed` stays `closed` (NOT re-marked pending).
- [ ] Recorded `custom: true` (write-in) answer whose text equals an option value: NOT inert — seam path (different-kind edit).
- [ ] Different value on answered/submitted: seam still invoked (existing behavior preserved).
- [ ] Complete-set rule-(b) position (all answered, currentId = last answerable): same-value accept triggers NO auto-submit — epoch unchanged, `sendMessage` never called.
- [ ] `npm test` and `npm run typecheck` green.

## All Needed Context

### Context Completeness Check

If someone knew nothing about this codebase, could they implement this successfully? Yes: the PRP quotes the exact function to modify, the exact insertion point, the binding contract extract, the test-file fixtures to reuse (quoted), the verification commands, and the two adjacent sibling tasks whose territory must NOT be touched (S5/S6). No pi runtime or TUI session is needed — all behavior is verifiable headless via vitest against the real `InterrogationState`.

### Documentation & References

```yaml
- file: plan/003_f8af1c6f6c49/architecture/answer-pinning-contract.md
  why: BINDING contract for this changeset — FR-D9 first bullet is this task verbatim
  pattern: "acceptOptionIndex: answer exists && value equals proposed option value (non-custom recorded choice) → state NO-OP that ADVANCES (Q14 rhythm): skip ripple seam (confirmRippleEdit), applyAnswer, evaluateDependsOn, maybeAutoSubmit entirely; no fresh answer.at. digit inherits (same seam)."
  gotcha: the SAME doc's next two bullets (writeInEnter byte-identical; acceptFromDeep third outcome) are S5/S6 — do NOT implement them here

- file: src/panel/actions.ts
  why: the file to modify; acceptOptionIndex (~:244), digit (~:189–207), accept (~:214–242), advanceAfterAccept (~:341), maybeAutoSubmit (~:653)
  pattern: Mode A contract — handlers are key-agnostic, take (panel), call panel.invalidate()/advance; every mutation path documented in dense JSDoc citing spec anchors
  gotcha: digit() ends with `return acceptOptionIndex(panel, q, n - 1)` — inheritance is FREE only if the check is inside acceptOptionIndex; moot/withdrawn digit no-op (`if (q.status === "moot" || q.status === "withdrawn") return true;`) stays untouched

- file: src/panel/actions.test.ts
  why: test file to extend; reuse its fixtures verbatim (quoted below) — OPTS_AB (values "a"/"b"), choiceQ(), seed() (applies answer with T0="2025-01-01T00:00:00.000Z" then status), seamMock(result), makePanel(), makeDeps()
  pattern: "describe('accept same-value — inert no-op (ANSWER-PIN-001 / FR-D9)', …) with snake_case test names (test_g_… / test_x_… precedent); assertions on state.getQuestion / panel.currentId / seam mock calls"
  gotcha: existing seam describe at :339 ('accept on answered — ripple-confirm seam (AC-13)') uses DIFFERENT values (cursor 1 = 'b' vs stored 'a') — nothing there flips; afterEach restores mocks/timers

- file: src/panel/short-view.ts
  why: T1's landed initialCursorIndex (~:127) — pins the caret to the recorded answer, which is WHY same-value enter is now the default revisit gesture; also exports displayOptions (D-R13 recommended-first order) used for opt resolution
  pattern: answer-custom → options.length (✎ row); value → display row; stale → 0
  gotcha: displayOptions order is recommended-first — the recorded answer's DISPLAY row may differ from its array index; compare VALUES (opt.value === answer.value), never indices

- file: src/panel/deep-view.ts
  why: READ-ONLY context — acceptFromDeep (~:528) consumes acceptOptionIndex and detects a veto via reference equality `q.answer === before`; after this task a same-value deep enter is inert AND (interim) stays in deep view because the unchanged answer reads as "veto"
  pattern: consumer contract only
  gotcha: do NOT touch deep-view.ts — S6 (P1.M1.T2.S6) owns replacing the heuristic so the no-op returns to short + advances; the interim state is expected and acceptable until S6 lands

- file: src/state.ts
  why: applyAnswer semantics — assigns a FRESH answer object with a new `at` on every call (this is the answer.at rewrite the no-op must avoid); statuses answered/submitted/closed/moot/withdrawn/reasked
  pattern: raw primitives upsertQuestion/applyAnswer/setStatus; getQuestion/orderedQuestions return live stored objects
  gotcha: never touch state.ts in this task (Non-goals list in answer-pinning-contract.md)

- file: src/panel/ripple-confirm.ts
  why: the seam being skipped — panel.confirmRippleEdit(questionId, proposed) delegates to the injected rippleConfirm (panel.ts:992); rippleVictims powers writeInEnter's variant (S5)
  pattern: seamMock(result) in tests intercepts it
  gotcha: skip means ZERO calls (assert toHaveBeenCalledTimes(0)), not a false return

- file: plan/003_f8af1c6f6c49/P1M1T2S4/research/codebase-findings.md
  why: this task's research notes — line numbers, edge rulings (custom exclusion, closed-stays-closed, rule-(b) suppression), validation commands
  pattern: n/a
  gotcha: n/a
```

### Current Codebase tree (relevant excerpt)

```bash
pi-structured-interrogation/
├── package.json              # scripts: test = vitest run; typecheck = tsc --noEmit
├── src/
│   ├── panel/
│   │   ├── actions.ts        # MODIFY: acceptOptionIndex (+JSDoc) — the deliverable
│   │   ├── actions.test.ts   # EXTEND: new describe for the inert no-op
│   │   ├── short-view.ts     # landed T1: initialCursorIndex; exports displayOptions
│   │   ├── deep-view.ts      # READ-ONLY (S6 territory)
│   │   └── panel.ts          # READ-ONLY (confirmRippleEdit seam wiring :992)
│   ├── state.ts              # READ-ONLY (applyAnswer fresh-object semantics)
│   └── …                     # untouched
└── vitest.config.ts
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# No new files. Two modified files only:
src/panel/actions.ts        # acceptOptionIndex: same-value short-circuit before the seam + JSDoc
src/panel/actions.test.ts   # new describe "accept same-value — inert no-op (ANSWER-PIN-001 / FR-D9)"
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: placement is BEFORE the seam block — inside the seam's
// if (answered||submitted) branch is TOO LATE for closed questions and
// still computes `proposed`. The check is status-agnostic by design:
// ANY status carrying an answer pins (answered/submitted/closed; moot
// keeps a dimmed answer but accept()/digit() already no-op moot earlier —
// leave those guards alone).

// CRITICAL: compare VALUES via displayOptions, never indices — D-R13
// recommended-first display order means display row ≠ options array index,
// and the recorded answer's row may equal the recommendation's row by
// coincidence. The match is `recorded.value === opt.value` (byte-equal).

// CRITICAL: custom exclusion. recorded.custom === true means the value is
// USER TEXT, not an option value. If that text byte-equals an option value,
// accepting the option is a different-kind edit (flips custom) — do NOT
// treat it as same-value. Route it through the seam like any edit.

// CRITICAL: closed (archived) + same-value must NOT re-mark pending.
// FR-2/AC-13's "editing re-marks pending" applies to CHANGES; h2.40:
// "A same-value re-commit is not an edit — no confirm, no state write."
// This is observable: status stays "closed" and the next submit ships
// nothing for it.

// CRITICAL: AUTOSUBMIT-003 rule (b) suppression. Today a same-value accept
// on the last answerable question of a complete set counts as an "edit
// commit" and FIRES maybeAutoSubmit (submit + epoch bump + sendMessage +
// panel.suspend). The no-op path must skip maybeAutoSubmit entirely.
// Observable: epoch unchanged, sendMessage mock not called, panel NOT suspended.

// NOTE: advanceAfterAccept already calls panel.invalidate() internally and
// handles the "no unanswered remains → stay on current question" case via
// nextUnanswered returning undefined — the no-op path needs NOTHING else.

// NOTE (interim deep-view behavior, expected): acceptFromDeep's
// `q.answer === before` reference-equality heuristic will read the no-op as
// a veto, so a same-value enter in deep view stays in deep view (on the
// ADVANCED question). Do not "fix" this here — S6 replaces the heuristic.

// GOTCHA (tests): seed() applies answers with timestamp T0 — assert
// answer.at === T0 after the no-op to prove no rewrite. Flash assertions
// need panel.flash spy, not timers. vitest only (no live pi session —
// AUTOMATION-POLICY binding).
```

## Implementation Blueprint

### Data models and structure

No new data models. Existing shape relied upon (state.ts h2.42):

```ts
type Answer = { value: string; at: string; text?: string; custom?: true };
// custom: true marks a write-in (value is user text, not an option value)
```

### Implementation Tasks (TDD-ordered)

```yaml
Task 1: ADD tests in src/panel/actions.test.ts — new describe AFTER the existing
  "accept on answered — ripple-confirm seam (AC-13)" group (:339–391)
  - DESCRIBE: "accept same-value — inert no-op (ANSWER-PIN-001 / FR-D9)"
  - FIXTURES (reuse, do not duplicate): seed(), seamMock(), makePanel(), makeDeps(), OPTS_AB (a/b), T0
  - TESTS (snake_case names, test_ prefix):
    1. test_same_value_accept_on_answered_is_inert_and_advances —
       seed q1 answered("a" at T0) + q2 open; seamMock(true) via makePanel extra
       {confirmRipple}; panel.currentId="q1" (cursor seeds to recorded "a" per T1);
       expect(accept(panel)).toBe(true); expect(confirmRipple).toHaveBeenCalledTimes(0);
       q1: answer.value "a", answer.at === T0, status "answered";
       panel.currentId === "q2" (advanced)
    2. test_same_value_digit_inherits_inert_no_op —
       same seed; digit(panel, 1) (option "a"); seam NOT called; answer.at T0;
       advanced to q2 — proves the digit path inherits via acceptOptionIndex
    3. test_same_value_on_submitted_is_inert — seed q1 submitted + q2 open;
       accept on "a"; seam NOT called; status stays "submitted"; at T0; advances
    4. test_same_value_on_closed_stays_closed_not_remarked_pending —
       seed q1 closed (with answer — seed via status "answered" then
       setStatus "closed", or apply answer after setStatus) + q2 open;
       accept on "a"; status STAYS "closed"; at T0; advances
    5. test_custom_answer_matching_option_value_is_not_inert —
       seed q1 answered with {value: "a", custom: true, at: T0} + q2 open;
       cursor on option "a" row; accept → seamMock IS called (routed through
       the seam — different-kind edit); NOT a no-op
    6. test_different_value_still_routes_through_seam —
       regression guard mirroring the existing AC-13 tests: cursor on "b"
       (different value); seam called once with proposed.value "b"
    7. test_same_value_on_complete_set_does_not_auto_submit —
       seed q1,q2,q3 ALL answered (complete set, ≥1 pending); makeDeps();
       panel.delivery = deps; currentId = "q3" (the LAST answerable — rule (b)
       position); accept same-value on q3's recorded answer;
       expect(sendMessage).toHaveBeenCalledTimes(0); state.epoch unchanged;
       no flash (or: no "submitted — " flash)
  - RUN: npx vitest run src/panel/actions.test.ts — ALL 7 FAIL (red) against current code

Task 2: IMPLEMENT the short-circuit in src/panel/actions.ts acceptOptionIndex
  - INSERT after `if (opt === undefined) return false;` and BEFORE `const proposed = …`
    (exact code in the What section above — includes ANSWER-PIN-001/FR-D9 comment)
  - UPDATE the function JSDoc: add the no-op-first sentence ("same-value
    re-commit (non-custom) is an inert no-op: advance only — no seam,
    applyAnswer, moot recompute, or auto-submit; digit inherits")
  - PRESERVE: everything from `const proposed` down is byte-identical
  - RUN: npx vitest run src/panel/actions.test.ts — all green

Task 3: FULL suite + typecheck + triage
  - npx vitest run (full) and npm run typecheck
  - IF any cross-cutting row fails (candidates: two-stage.test.ts, ac-panel.test.ts,
    ac-scripted.test.ts, deep-view.test.ts, panel.test.ts, regression-phantom-submissions.test.ts):
    triage against the FR-D9 contract — a row asserting state change / seam /
    auto-submit on a SAME-VALUE accept flips to inert expectations; a row using a
    DIFFERENT value must stay green untouched. deep-view rows about same-value
    staying-in-deep describe the S6 interim — pin them as-is (characterization),
    do not implement S6's fix here
  - EXPECT: zero flips in the existing seam describe (:339) — it uses different values

Task 4: COMMENT HYGIENE (minimal, actions.ts only)
  - The Module/JSDoc comments of accept() and digit() mention "ripple seam on
    answered/submitted" for their acceptOptionIndex delegation — append the
    "(same-value re-commit inert — ANSWER-PIN-001)" clause where they describe
    the shared commit path, ONLY if such a sentence exists in actions.ts itself
    (the cross-file comment sweep is S8, P1.M1.T4 — do not chase other files)
```

### Implementation Patterns & Key Details

```ts
// The entire behavioral change (see What for full commented version):
const recorded = q.answer;
if (recorded !== undefined && recorded.custom !== true && recorded.value === opt.value) {
  advanceAfterAccept(panel); // Q14 rhythm — advance only
  return true;               // consumed
}
// PATTERN: single seam, shared by accept()/digit()/acceptFromDeep —
//         one check covers all three entry paths (S6 only adjusts the
//         deep-view CONSUMER's outcome interpretation, not this function)
// GOTCHA: opt comes from displayOptions(q) (recommended-first, D-R13) —
//         value comparison only, never index comparison
```

### Integration Points

```yaml
STATE: none — state.ts is untouched; the no-op's whole point is zero state writes
CONFIG: none — no new keys (Non-goals: "No config keys, no hotkey rows")
KEYS: none — keys.ts routing untouched; enter/digit already reach acceptOptionIndex
AUTO-SUBMIT: none — maybeAutoSubmit body untouched; the no-op path merely never calls it
DEEP-VIEW: none (S6) — interim stay-in-deep behavior documented in tests only if a
  characterization row already exists
SIBLINGS: S5 (writeInEnter) and S6 (acceptFromDeep) build on this seam afterwards —
  keep acceptOptionIndex's signature (panel, q, optionIndex) => boolean UNCHANGED
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
npx vitest run src/panel/                          # panel suite (actions consumers)
# Expected: all pass. The 7 new tests are the contract's proof (Task 1 list).
```

### Level 3: Consumer regression (System Validation)

```bash
npx vitest run   # FULL suite — no live pi session (AUTOMATION-POLICY binding:
                 # never launch pi -e . in automated runs; vitest over the real
                 # state objects IS the integration surface here)
# Triage any failure per Task 3: same-value rows flip to inert; different-value
# rows stay. Candidates: two-stage, ac-panel, ac-scripted, deep-view, panel,
# regression-phantom-submissions.
```

### Level 4: Behavior matrix walkthrough (manual reasoning over the new tests)

| Scenario | Seam called? | applyAnswer? | answer.at | Status after | Advance? | Auto-submit? |
|---|---|---|---|---|---|---|
| answered + same value (enter) | no | no | T0 (unchanged) | answered | yes | no |
| answered + same value (digit) | no | no | T0 | answered | yes | no |
| submitted + same value | no | no | T0 | submitted | yes | no |
| closed + same value | no | no | T0 | closed | yes | no |
| answered + custom text == option value | yes | (per seam) | may change | per seam | per path | per AUTOSUBMIT-003 |
| answered + DIFFERENT value | yes (once) | yes | fresh | answered | yes | per AUTOSUBMIT-003 |
| complete set, last answerable, same value | no | no | T0 | answered | yes (stays if none) | NO (epoch, sendMessage unchanged) |

Each row must map 1:1 to a passing test from Task 1 (row 7 = test 7, etc.).

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` zero errors
- [ ] `npx vitest run` (full suite) green — or failures triaged per the FR-D9 contract with the flip documented in the PR notes
- [ ] No live pi session launched (AUTOMATION-POLICY)

### Feature Validation

- [ ] All 7 new tests present and passing; matrix rows in Level 4 each map to a test
- [ ] Seam mock asserted `toHaveBeenCalledTimes(0)` on inert paths (not just "returns true")
- [ ] `answer.at === T0` asserted (the rewrite prohibition is the core of ANSWER-PIN-001)
- [ ] closed-stays-closed asserted (no phantom re-pending → no phantom shipment)
- [ ] Rule-(b) suppression asserted (no epoch bump, no sendMessage, no suspend)
- [ ] Different-value seam rows (existing AC-13 describe) untouched and green

### Code Quality Validation

- [ ] Only `src/panel/actions.ts` (+ its test file) modified; state.ts, panel.ts, deep-view.ts, keys.ts untouched
- [ ] acceptOptionIndex signature unchanged (S5/S6 build on it)
- [ ] Comment updates confined to actions.ts (cross-file sweep is S8)
- [ ] New code carries the ANSWER-PIN-001/FR-D9 spec anchors in comments, matching file conventions

### Documentation & Deployment

- [ ] No new config keys, env vars, or keymap entries (contract Non-goals)
- [ ] Interim deep-view behavior (stay-in-deep on same-value) noted in the PR description for S6's author

---

## Anti-Patterns to Avoid

- ❌ Don't put the check inside the `if (q.status === "answered" || "submitted")` seam branch — closed questions and the proposed/at computation come first; the contract is status-agnostic and sits BEFORE the seam
- ❌ Don't gate the no-op behind `panel.cursorIndex === initialCursorIndex(q)` (index equality) — display order (D-R13) and stale-answer clamping make indices unreliable; compare VALUES
- ❌ Don't "fix" deep-view's stay-in-deep interim or writeInEnter's same-value path here — S6/S5 territory; scope creep breaks their PRPs
- ❌ Don't call `panel.flash` or arm `gateWarning` on the no-op path — silence IS the no-op's UX
- ❌ Don't rewrite/replace `advanceAfterAccept` with an inline variant — reuse it so the "no unanswered → stay" edge and invalidate stay single-sourced
- ❌ Don't flip or weaken the existing different-value seam tests to make things pass — they are the FR-18 regression guard this task must preserve

---

**Confidence Score: 9/10** — one-function change with a verbatim binding contract, quoted current code, exact insertion point, reusable test fixtures, and a fully observable state-level test surface; the only residual risk is an unanticipated cross-cutting test asserting same-value state changes (mitigated by Task 3 triage rules).

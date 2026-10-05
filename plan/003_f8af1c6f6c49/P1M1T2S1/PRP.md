# PRP — P1.M1.T2.S1: acceptOptionIndex: same-value commit is an inert NO-OP (digit inherits)

## Goal

**Feature Goal**: Implement FR-D9 / ANSWER-PIN-001 (h2.65, FR-35, FR-18 last sentence): `enter` (and digit quick-select) on a choice question whose recorded answer equals the proposed option is an inert state NO-OP — no `confirmRippleEdit`, no `applyAnswer` (hence no fresh `answer.at`), no `evaluateDependsOn`, no `maybeAutoSubmit` — advancing to the next unanswered per the Q14 rhythm only. `acceptOptionIndex` exposes a THREE-OUTCOME result (`"noop" | "accept" | "veto"`) consumed by P1.M1.T2.S6 (acceptFromDeep).

**Deliverable**: Modified `src/panel/actions.ts` (no-op branch + `AcceptOutcome` type + updated call sites + JSDoc) and new tests in `src/panel/actions.test.ts`. Digit path (`:196`) inherits via its existing delegation.

**Success Definition**:
- `npm run typecheck` + full `npm test` green
- Enter/digit on the recorded value (caret pinned there by S1's `initialCursorIndex`): consumed, `currentId` advances, `answer.at` byte-identical, status unchanged, epoch unchanged, ripple seam never called, no submission fires
- A DIFFERENT choice on an answered question still raises the FR-18 seam (regression)
- Unanswered questions' accept path byte-identical to before (regression)

## Why

ANSWER-PIN-001 (h2.65): "on revisit the caret re-seeded to the ★ recommendation, so `enter` on the revisit RE-PROPOSED the recommendation as an edit — the modal accusing the user of invalidating their own work by keeping it." FR-35 rules: "`enter` (and digit quick-select) on the already-recorded value is a state NO-OP that may advance (Q14 rhythm): no `applyAnswer`, no fresh `answer.at`, no ripple modal, no auto-submit trigger." S1 (COMPLETE) pins the caret to the recorded row — this subtask makes landing there inert. FR-18's confirm guards exactly a DIFFERENT choice.

## What

1. **New exported type** `AcceptOutcome = "noop" | "accept" | "veto"` in `src/panel/actions.ts`.
2. **`acceptOptionIndex` returns `AcceptOutcome`**: after computing `opt = displayOptions(q)[optionIndex]` and BEFORE the answered/submitted ripple seam (`:255`), insert the no-op branch:
   `if (q.answer !== undefined && q.answer.custom !== true && q.answer.value === opt.value) { advanceAfterAccept(panel); return "noop"; }`
   Existing seams: veto path returns `"veto"`; the full commit path returns `"accept"`.
3. **Update the two internal call sites** (both in actions.ts): `accept` (`:265`) and `digit` (`:196`) — both return consumed-ness, so `return acceptOptionIndex(...) !== false` or keep a tiny boolean wrapper; all three outcomes were `true` before, so behavior is unchanged at those sites.
4. **Mode A JSDoc**: on `acceptOptionIndex` (cite ANSWER-PIN-001/FR-35/FR-D9, the three outcomes, and that the digit path inherits) and on the digit path (no-op inheritance). Purge the status-agnostic comment at actions.ts ~:278 as touched by this change.

### Success Criteria

- [ ] No-op branch fires only when `q.answer` exists, `!answer.custom`, and `answer.value === opt.value` (display-position mapped value)
- [ ] No-op path calls ONLY `advanceAfterAccept` — zero state writes, zero seam/modal/evaluate/auto-submit calls; `answer.at` untouched
- [ ] Digit 1..9 on the recorded value inherits the no-op (consumed, zero state change)
- [ ] Different-option edit on answered/submitted still calls `confirmRippleEdit`; seam veto still returns consumed with no apply (`"veto"`)
- [ ] Complete-set no-op never triggers maybeAutoSubmit (no delivery, no epoch bump)
- [ ] Unanswered-question accepts unchanged; write-in (`custom: true`) answers never match option values (same-value check skipped)

## All Needed Context

### Context Completeness Check

Repo fully implemented, suites green; S1 (caret pinning, COMPLETE) guarantees enter/digit land on the recorded row. All line references verified against the working tree (research/notes.md holds verbatim excerpts). Agent needs this PRP plus `src/panel/actions.ts`, `src/panel/actions.test.ts`, `src/panel/deep-view.ts` (read-only, S6 context).

### Documentation & References

```yaml
- file: plan/003_f8af1c6f6c49/architecture/panel-ui-seams.md
  why: "THE seam doc (§Accept-paths :15-19): :244 signature, :255 ripple seam, :265 maybeAutoSubmit, :196 digit delegation, deep-view :528/:552 consumer needing the three-outcome signal"
  critical: "no-op must short-circuit BEFORE :255; return shape must expose NO-OP vs ACCEPT vs VETO for acceptFromDeep"

- file: plan/003_f8af1c6f6c49/P1M1T2S1/research/notes.md
  why: verbatim current acceptOptionIndex/digit/advanceAfterAccept bodies + test-describe anchors + decided branch semantics

- file: src/panel/actions.ts
  why: "ONLY source file. acceptOptionIndex :244-267, digit :190-197, accept tail :265, advanceAfterAccept :262"
  pattern: "displayOptions(q)[optionIndex] is the D-R13 display-position seam — compare against opt.value, never a raw index"
  gotcha: "q.answer.custom === true means value is free text — skip the same-value check (it can never legitimately match an option)"

- file: src/panel/actions.test.ts
  why: "extend: describe('accept — commit + advance (Q14=A)') :235, 'accept on answered — ripple-confirm seam (AC-13)' :339, 'digit — quick-select (R5)' :393; existing harness makePanel/seed + seamSpy(confirmRippleEdit) pattern"
  gotcha: "ripple renders through the existing harness — mock nothing external (contract: 'Mock: none')"

- file: src/panel/deep-view.ts
  why: "READ-ONLY context: acceptFromDeep :528 currently guesses no-op from `q.answer === before` (:552) — S6 replaces it with the AcceptOutcome; do NOT modify deep-view here"

- file: plan/003_f8af1c6f6c49/P1M1T1S1/PRP.md (S1, COMPLETE)
  why: "CONTRACT: initialCursorIndex pins the caret to the recorded answer on every entry path — enter/digit land on the recorded row by default, which is what makes this no-op the DEFAULT revisit behavior"
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
├── actions.ts           # MODIFY: AcceptOutcome + no-op branch + call sites + JSDoc
├── actions.test.ts      # MODIFY: new no-op describe + regression tests
└── deep-view.ts         # untouched (S6 consumes the outcome)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: branch placement — AFTER opt lookup (need opt.value), BEFORE the
//   answered/submitted ripple seam at :255. Before applyAnswer means answer.at
//   can never be rewritten by a no-op.
// CRITICAL: three outcomes must remain distinguishable — S6 keys "return to
//   short + advance" (noop) vs "stay in deep" (veto) off this return value.
// GOTCHA: optionIndex is a DISPLAY position (D-R13) — always map through
//   displayOptions(q)[optionIndex] before comparing values.
// GOTCHA: custom write-ins — q.answer.custom === true → value is user text,
//   never an option value; the same-value check must skip (a text "collision"
//   with an option label/value is still a DIFFERENT choice → FR-18 seam).
// GOTCHA: moot/withdrawn consumed-no-op guards upstream of acceptOptionIndex
//   (digit :195, accept) stay untouched — different mechanism, same inertness.
// GOTCHA: maybeAutoSubmit is transition-gated and context-carrying; the no-op
//   never reaches it — assert with a delivery spy on the complete-set fixture.
// GOTCHA: statuses carrying answer include closed (archived) — the no-op check
//   keys on q.answer, NOT on status; closed + same-value is equally inert
//   (the seam at :255 only fires for answered/submitted, which the no-op
//   branch already precedes).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: WRITE FAILING TESTS FIRST (src/panel/actions.test.ts, new describe
        "acceptOptionIndex — same-value no-op (ANSWER-PIN-001/FR-D9)")
  - test_enter_on_recorded_value_is_inert_advance_only:
      seed q1 answered {value:'a', at:'T1', custom:false} + q2 open;
      caret on recorded row (S1 pins it; else set cursorIndex explicitly);
      seamSpy confirms confirmRippleEdit NOT called;
      accept(panel) → consumed; q1.answer.at === 'T1'; status 'answered';
      epoch unchanged; NO delivery; panel.currentId === 'q2'
  - test_digit_on_recorded_value_is_inert (BUG-002 digit inheritance):
      same fixture, digit('1') where options[0].value === 'a' → consumed,
      zero state change (same assertions)
  - test_different_option_on_answered_still_raises_FR18_seam (regression)
  - test_noop_never_fires_maybeAutoSubmit_on_complete_set:
      all answered; no-op commit → zero sendMessage/deliver, epoch unchanged
  - test_unanswered_accept_path_unchanged (regression)
  - test_custom_writein_answer_never_noops_against_options:
      q1 answered {value:'my text', custom:true}; accept on any option row
      → routes through the seam as an edit (not inert)
  - RUN npx vitest run src/panel/actions.test.ts — the new inert tests FAIL
    (today: modal seam + applyAnswer rewrite answer.at)

Task 2: IMPLEMENT in src/panel/actions.ts
  - ADD export type AcceptOutcome = "noop" | "accept" | "veto";
  - CHANGE acceptOptionIndex return type to AcceptOutcome:
      opt lookup unchanged; then:
        if (q.answer !== undefined && q.answer.custom !== true
            && q.answer.value === opt.value) {
          advanceAfterAccept(panel);   // Q14 rhythm only — nothing else
          return "noop";
        }
      seam veto path: return "veto"; full-commit tail: return "accept";
  - UPDATE call sites (accept :265, digit :196): consume the outcome —
    both return consumed-ness, e.g. `return acceptOptionIndex(...) !== false`
    or an explicit `!== undefined` — keep boolean surface, all outcomes consumed
  - JSDoc [Mode A] on acceptOptionIndex (three outcomes, ANSWER-PIN-001/FR-35
    citation, digit inheritance) and on the digit path; purge the ~:278
    status-agnostic comment

Task 3: RUN gates
  - npx vitest run src/panel/actions.test.ts -v
  - npm run typecheck && npm test   (S6/S5 may add call sites later; none today)
```

### Implementation Patterns & Key Details

```ts
export type AcceptOutcome = "noop" | "accept" | "veto";

export function acceptOptionIndex(panel, q, optionIndex): AcceptOutcome {
  const opt = displayOptions(q)[optionIndex];
  if (opt === undefined) return false as unknown as AcceptOutcome; // keep existing false contract — see Gotchas
  // ANSWER-PIN-001 / FR-35: the recorded value owns the commit — same-value
  // enter/digit is an inert NO-OP (advance only). A custom write-in's value
  // is free text and never matches an option — edits always route to the seam.
  if (q.answer !== undefined && q.answer.custom !== true
      && q.answer.value === opt.value) {
    advanceAfterAccept(panel); // Q14 rhythm — the ONLY effect
    return "noop";
  }
  const proposed = { value: opt.value, at: new Date().toISOString() };
  const wasUnanswered = q.status === "open" || q.status === "reasked";
  if (q.status === "answered" || q.status === "submitted") {
    if (!panel.confirmRippleEdit(q.id, proposed)) return "veto"; // seam vetoed
  }
  panel.state.applyAnswer(q.id, proposed);
  evaluateDependsOn(panel.state);
  advanceAfterAccept(panel);
  maybeAutoSubmit(panel, undefined, { wasUnanswered, questionId: q.id });
  return "accept";
}
// NOTE: the `opt === undefined` early return currently yields false — either
// widen AcceptOutcome with "invalid" or keep boolean union
// (`AcceptOutcome | false`); pick one, document it, and keep BOTH internal
// call sites compiling (they only test consumed-ness).
```

### Integration Points

```yaml
MODULES (contracts only):
  - P1.M1.T2.S6 (acceptFromDeep): "consumes AcceptOutcome: noop → return to short + advance; veto → stay in deep; replaces the `q.answer === before` heuristic at deep-view.ts:552"
  - P1.M1.T2.S5 (writeInEnter): "parallel byte-identical write-in no-op — separate function, same contract shape; do not entangle"
  - P1.M1.T5.S10 (AC-16 test): "asserts the enter-on-recorded-value inertness end-to-end — keep the zero-state-change surface stable"
NO CHANGES to: deep-view.ts, panel.ts, state.ts, maybeAutoSubmit, evaluateDependsOn
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/actions.test.ts -v     # new describe + regressions
npm test                                        # full suite
```

### Level 3: Behavioral probe (AC-16 fragment)

```bash
npx vitest run src/panel/actions.test.ts -t "no-op" -v
# The Task-1 tests ARE the repro: enter/digit on the recorded value previously
# fired the FR-18 seam and rewrote answer.at; they must now be inert.
```

### Level 4: Domain validation

- [ ] JSDoc on acceptOptionIndex + digit path states the no-op contract citing ANSWER-PIN-001/FR-35 (Mode A)
- [ ] `rg -n "AcceptOutcome" src/panel/` — type + acceptOptionIndex + the two call sites; deep-view untouched

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green
- [ ] TDD: inertness tests observed failing before the fix
- [ ] Same-value enter/digit: consumed, advance only, zero state change (no modal, no answer.at rewrite, no epoch bump, no delivery)
- [ ] Digit inheritance pinned by an explicit test; different-choice seam and unanswered paths regression-green
- [ ] `custom: true` answers never no-op against option rows
- [ ] AcceptOutcome exposed for S6; only actions.ts + actions.test.ts modified

## Anti-Patterns to Avoid

- ❌ Don't place the no-op check after the ripple seam — the modal would still fire
- ❌ Don't run applyAnswer "harmlessly" on a no-op — answer.at rewrite is exactly what FR-35 forbids
- ❌ Don't compare raw optionIndex to anything — display positions map through displayOptions
- ❌ Don't gate the no-op on status — it keys on `q.answer` presence (closed/archived included)
- ❌ Don't skip the same-value check's `!answer.custom` guard — write-in text can collide with an option value
- ❌ Don't modify deep-view.ts/writeInEnter in this subtask — S6/S5's contracts

---

**Confidence Score**: 9/10 — the seam, both call sites, the advance tail, and the test harness were read line-by-line; the only open choice (how `opt === undefined`'s `false` coexists with the enum) is spelled out with two acceptable resolutions.

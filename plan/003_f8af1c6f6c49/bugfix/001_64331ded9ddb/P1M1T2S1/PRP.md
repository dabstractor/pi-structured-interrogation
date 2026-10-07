# PRP — Bugfix P1.M1.T2.S1: acceptOptionIndex (and digit) no-op exclusion for `reasked` — enter on the kept value re-confirms

## Goal

**Feature Goal**: Fix PRD BUG-001 (h2.1/h3.0): the ANSWER-PIN-001 same-value no-op in `acceptOptionIndex` (src/panel/actions.ts:293-297) checks only answer presence, so `enter` (or digit) on a rule-1 re-asked question's KEPT answer is swallowed as `"noop"` and the question is stuck in `reasked` forever. Add `&& q.status !== "reasked"` (one line) so same-value enter on a reasked question is a re-confirmation commit: outcome `"accept"`, `applyAnswer` re-marks `answered` with a fresh `answer.at`, advance, and the auto-submit transition may fire. Digit path inherits.

**Deliverable**: One-line condition change + rewritten ANSWER-PIN-001 comment block (:284-298) in `src/panel/actions.ts`; TDD tests in `src/panel/actions.test.ts`; one appended pin in `spec/decisions.md`.

**Success Definition**:
- `npm run typecheck` + full `npm test` green
- PRD BUG-001 repro: reasked+kept-answer 'a' → enter on 'a' → outcome `"accept"`, status `answered`, `answer.at` refreshed, advance to next unanswered
- Completing-the-set variant: sole reasked question re-confirmed → auto-submit transition fires and DELIVERS (epoch bump + one sendMessage — the BUG-001/BUG-002 composition, relying on S1's fixed submit() pipeline)
- Stay-green pins unchanged: `test_same_value_on_submitted_is_inert` (:422), `test_same_value_on_closed_stays_closed_not_remarked_pending` (:436), `test_same_value_on_complete_set_does_not_auto_submit` (:481), `test_h_accept_on_moot_and_withdrawn_is_noop` (:316), `test_same_value_digit_inherits_inert_no_op` (:411)

## Why

The state machine requires `reasked → user answers → answered(pending)`, but the no-op (authored to stop re-PROPOSAL of SETTLED answers on revisit) applied verbatim to the hybrid reasked+kept-answer state — created by the lifecycle marker, not the user — breaks the re-ask confirmation loop: the question counts as unanswered everywhere, AUTOSUBMIT-001 can never fire, ctrl+s says "nothing to submit", and completion (FR-5, the product's core deliverable) is permanently blocked unless the user changes their answer. Commitment 8 ("Always keep the user's answer. No exceptions.") is violated by the wedge, not by the fix — re-confirming the kept value IS keeping it.

## What

1. **One-line fix** (actions.ts:294): `if (recorded !== undefined && recorded.custom !== true && recorded.value === opt.value && q.status !== "reasked") { ... return "noop"; }` — everything after the condition already handles reasked correctly (`wasUnanswered` includes reasked at :301; the FR-18 seam gate at :302 skips non-answered/submitted statuses — so a same-value re-confirm is seam-free, exactly as P1.M2.T1.S1's widened gate must preserve).
2. **Mode A comment rewrite** (:284-298): the no-op covers SETTLED statuses (answered/submitted/closed carrying the recorded value); a rule-1 re-ask same-value enter is a re-confirmation commit (re-marks pending, fresh `at` — the answer signature at snapshots.ts:123 excludes `at`, so diffs are unaffected).
3. **spec/decisions.md**: append the ANSWER-PIN-001 amendment pin — the 2026-10-04 ruling (2) gains its reasked exception ("same-value enter on a rule-1 re-asked question is a re-confirmation, not a no-op"). Spec-wins: read the existing decisions.md ANSWER-PIN-001 entry first and match its formatting convention.

### Success Criteria

- [ ] Same-value enter/digit on `reasked` → `"accept"`, status `answered`, fresh `answer.at`, advance; confirmRippleEdit NOT called (seam-free re-confirm)
- [ ] Same-value on `answered`/`submitted`/`closed` still inert `"noop"` (:422/:436 green unchanged)
- [ ] Complete-set no-op still does not auto-submit (:481 green unchanged — scope is reasked ONLY)
- [ ] Digit inherits the exclusion (test on a reasked question via `digit(panel, n)`)
- [ ] Full suite + typecheck green; decisions.md pin appended

## All Needed Context

### Context Completeness Check

Repo green (1265 tests); all line references verified against the working tree and the architecture research doc. Agent needs this PRP plus `src/panel/actions.ts`, `src/panel/actions.test.ts`, `spec/decisions.md`, `spec/state-and-persistence.md` (state machine, read-only).

### Documentation & References

```yaml
- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/architecture/reask-confirmation-loop.md
  why: "THE research doc — §1.1 verbatim no-op condition, §4 fix (a), §5 risks/interactions (keep scope tight or :481 flips; answer.at rewrite safe because snapshots.ts:123 signature excludes at; fix (b) = S1's submit pipeline)"
  critical: "§5: 'If someone widens (a) to all statuses, these flip — keep scope tight' — the exclusion is reasked ONLY"

- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/P1M1T2S1/research/notes.md
  why: condensed verified excerpts + stay-green anchor list + test plan

- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/P1M1T1S1/PRP.md (S1, in flight — CONTRACT)
  why: "S1's submit() pendingIds fall-through is what lets the re-marked pending answer actually DELIVER; test (b) depends on it. Do not re-implement or touch submit()/maybeAutoSubmit"

- file: src/panel/actions.ts
  why: "ONLY source file. No-op condition :293-297; comment block :284-298; post-condition body :301-314 already correct for reasked (verified)"
  gotcha: "the FR-18 seam gate (:302) fires only for answered/submitted — a same-value re-confirm on reasked never hits the modal; P1.M2.T1.S1 must PRESERVE this seam-free path when widening the gate to closed"

- file: src/panel/actions.test.ts
  why: "TDD placement: next to test_same_value_on_submitted_is_inert (:422); stay-green anchors :316/:411/:436/:481; conventions: harness makePanel, delivery stub/deps, status seeding per the bug-hunt reask fixtures (rule-2 tests :953/:995 show the reasked seeding style)"
  gotcha: "headless panels — no external mocks"

- file: spec/decisions.md
  why: "append the ANSWER-PIN-001 reasked amendment per repo convention; read the existing 2026-10-04 entry (:61 area, 'DO NOT RE-PROPOSE…') first"
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
├── actions.ts           # MODIFY: one-line exclusion + comment rewrite
└── actions.test.ts      # MODIFY: TDD failing-first tests
spec/decisions.md        # MODIFY: append amendment pin
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: scope is `reasked` ONLY — widening to other statuses flips
//   test_same_value_on_complete_set_does_not_auto_submit (:481).
// GOTCHA: answer.at refresh is CORRECT for a re-confirmation and harmless to
//   diffs — the answer signature (snapshots.ts:123) is value+text only.
// GOTCHA: custom write-ins stay excluded from the same-value check entirely
//   (existing `recorded.custom !== true` guard) — write-in reasked parity is
//   S2's (writeInEnter), do not entangle.
// GOTCHA: test (b) (auto-submit delivers) depends on S1's submit() fix — if
//   S1 hasn't landed, write the test anyway (it's the contract) and coordinate;
//   do not "fix" the delivery inside this subtask.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: WRITE FAILING TESTS FIRST (src/panel/actions.test.ts, near :422)
  - (a) test_same_value_on_reasked_reconfirms (BUG-001 repro):
      q1 choice [a,b] → accept 'a' → submit (submitted, epoch 2) →
      rule-1 re-ask flip (seed status 'reasked', answer 'a' KEPT — lifecycle
      rule-1 style per architecture doc §2/§3, or drive the lifecycle event);
      enter on the pinned 'a' row → expect outcome "accept";
      q1.status === 'answered'; answer.at !== old at; confirmRipple NOT called;
      advanced to next unanswered
  - (b) test_reasked_reconfirm_completing_set_auto_submits_and_delivers:
      sole question; same flow → ONE new sendMessage, epoch bump,
      status 'submitted' (relies on S1's pipeline; if S1 not yet landed,
      mark it and land after S1)
  - (c) digit variant: reasked q, digit on recorded value → consumed, re-marked
  - RUN: (a)/(c) fail today (outcome "noop", status stays reasked)

Task 2: IMPLEMENT the one-line exclusion in src/panel/actions.ts:294
  - add `&& q.status !== "reasked"` to the no-op condition

Task 3: REWRITE the ANSWER-PIN-001 comment block (:284-298) [Mode A]
  - settled-statuses no-op + reasked re-confirmation semantics + the
    snapshots.ts:123 signature note

Task 4: APPEND the decisions.md amendment pin (spec-wins formatting)

Task 5: RUN gates
  - npx vitest run src/panel/actions.test.ts -v   (new + :316/:411/:422/:436/:481 green)
  - npm run typecheck && npm test
```

### Implementation Patterns & Key Details

```ts
// The condition after the fix (one line changed):
const recorded = q.answer;
if (recorded !== undefined && recorded.custom !== true
    && recorded.value === opt.value && q.status !== "reasked") {
  advanceAfterAccept(panel); // Q14 rhythm: advance only, no state write
  return "noop";
}
// Everything below is UNCHANGED and already correct for reasked:
// wasUnanswered includes 'reasked' (:301) → the accept can be the
// last-unanswered TRANSITION → maybeAutoSubmit fires (and, with S1's
// submit() fix, DELIVERS).
```

### Integration Points

```yaml
MODULES (contracts only):
  - P1.M1.T2.S2 (writeInEnter): "same reasked exclusion for byte-identical write-in re-commits — parallel function, do not share code paths"
  - P1.M1.T3.S1 (round-trip integration): "consumes this + S1/S2 for the full re-ask → re-confirm → settle → completion test"
  - P1.M2.T1.S1 (widened FR-18 gate): "MUST preserve the seam-free same-value re-confirm path on reasked (gate statuses are answered/submitted/+closed, never reasked)"
NO CHANGES to: submit(), maybeAutoSubmit, writeInEnter, seam gate, lifecycle
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/actions.test.ts -v
npm test
```

### Level 3: Behavioral probe (PRD BUG-001 repro)

```bash
npx vitest run src/panel/actions.test.ts -t "reask" -v
# Tests (a)-(c) ARE the repro: previously 'after enter on recorded value: reasked'.
```

### Level 4: Domain validation

- [ ] Comment block states the reasked exclusion (Mode A); decisions.md pin appended in repo convention
- [ ] `git diff src/panel/actions.ts` shows exactly one condition line + comments

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green
- [ ] TDD: reconfirm tests observed failing (noop/stuck-reasked) before the fix
- [ ] Same-value on reasked → "accept", re-marked answered, fresh at, seam-free, advance; digit inherits
- [ ] answered/submitted/closed no-op + moot/withdrawn + complete-set pins green unchanged
- [ ] Only actions.ts, actions.test.ts, spec/decisions.md touched

## Anti-Patterns to Avoid

- ❌ Don't widen the exclusion beyond `reasked` — :481 flips
- ❌ Don't touch the seam gate, submit(), or maybeAutoSubmit — sibling contracts
- ❌ Don't suppress the `answer.at` refresh — it's correct and diff-invisible
- ❌ Don't entangle writeInEnter — S2's parallel fix
- ❌ Don't paraphrase decisions.md — match its existing formatting (spec-wins)

---

**Confidence Score**: 9/10 — the condition, the already-correct downstream body, every stay-green anchor, and the sibling contracts were verified line-by-line (architecture doc §1.1/§4/§5 + fresh reads); the only sequencing risk (test (b) needing S1's submit fix) is called out explicitly.

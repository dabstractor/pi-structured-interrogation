# Research notes — P1.M1.T2.S1 (acceptOptionIndex reasked no-op exclusion)

## Verified code facts
- No-op condition actions.ts:293-297 (read verbatim): `const recorded = q.answer; if (recorded !== undefined && recorded.custom !== true && recorded.value === opt.value) { advanceAfterAccept(panel); return "noop"; }` — NO status check. Comment block :284-292 is the ANSWER-PIN-001 doc to rewrite.
- After exclusion, existing body already handles reasked correctly: `wasUnanswered = open|reasked` (:301), seam gate only for answered/submitted (:302), `applyAnswer` (:306) re-marks answered + fresh `answer.at` (fine — signature at snapshots.ts:123 excludes `at`, diffs unaffected), `evaluateDependsOn` (:311), `advanceAfterAccept`, `maybeAutoSubmit` (:313).
- Digit path routes through acceptOptionIndex; actions.test.ts:411 `test_same_value_digit_inherits_inert_no_op` pins routing (asserts on answered q — stays green).
- Stay-green anchors in actions.test.ts: :422 submitted-inert, :436 closed-stays-closed, :481 complete-set-no-autosubmit, :316 moot/withdrawn noop, :411 digit.
- Architecture doc reask-confirmation-loop.md §1.1 (verbatim condition), §4 fix (a) = add `&& q.status !== "reasked"`, §5 risks: keep scope tight (widening to all statuses would flip :481); answer.at rewrite safe (signature excludes at); fix (b) is S1/T1 (submit pipeline) — already in flight.
- Sibling contracts: S2 = writeInEnter parity; P1.M1.T2 in plan = T2.S2. P1.M1.T1.S1 (COMPLETE per parallel ctx / in flight) fixes submit() pendingIds fall-through so re-marked pending actually ships.
- spec/decisions.md: ANSWER-PIN-001 2026-10-04 ruling (2) — append reasked exception per repo convention (spec-wins: check decisions.md wording before writing).

## Fix
One line: `&& q.status !== "reasked"` in the :294 condition. Outcome "accept" for same-value-on-reasked → applyAnswer re-marks answered, fresh at, advance; auto-submit transition may fire and deliver via S1's pipeline.

## Tests (TDD failing-first, actions.test.ts near :422)
(a) PRD BUG-001 repro: q1 choice a/b accepted 'a' + ctrl+s (submitted, epoch 2) → lifecycle rule-1 flip (or seed status reasked + answer kept, matching bug-hunt seeding style) → enter on 'a' → outcome "accept", status answered, at refreshed, advance.
(b) completing-the-set variant: sole question reasked; re-confirm → maybeAutoSubmit transition fires, DELIVERS (epoch bump + one sendMessage) — BUG-001/BUG-002 composition (depends on S1's submit fix).
(c) stay-green: :422, :436, :481, :316, :411.
No external mocks (headless panels).

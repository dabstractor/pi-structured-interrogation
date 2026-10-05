# Research notes — P1.M1.T2.S4 (acceptOptionIndex same-value inert no-op)

## Binding contract (plan/003_f8af1c6f6c49/architecture/answer-pinning-contract.md, FR-D9)

> `acceptOptionIndex`: answer exists && value equals proposed option value (non-custom recorded
> choice) → state NO-OP that ADVANCES (Q14 rhythm): skip ripple seam (`confirmRippleEdit`),
> `applyAnswer`, `evaluateDependsOn`, `maybeAutoSubmit` entirely; no fresh `answer.at`.
> `digit` inherits (same seam).

Companion clauses (other subtasks, NOT this one): writeInEnter byte-identical = S5;
acceptFromDeep third outcome = S6; ★ marker = S7.

## Code findings

- `src/panel/actions.ts:244` `acceptOptionIndex(panel, q, optionIndex)` — current order:
  displayOptions → proposed{value,at} → `wasUnanswered` → seam (answered/submitted) →
  `applyAnswer` → `evaluateDependsOn` → `advanceAfterAccept` → `maybeAutoSubmit`.
  No same-value check exists today.
- `src/panel/actions.ts:189` `digit()` ends with `return acceptOptionIndex(panel, q, n - 1)` —
  digit inherits automatically iff the check lives INSIDE acceptOptionIndex (not in `accept()`).
- `src/state.ts` `applyAnswer` always assigns a FRESH answer object (new `at` each call) — this is
  why a same-value accept today rewrites `answer.at`, and why deep-view.ts:552's
  `q.answer === before` reference-equality heuristic works.
- `src/panel/deep-view.ts:528` `acceptFromDeep` consumes acceptOptionIndex; on unchanged
  `q.answer` it treats the outcome as a ripple VETO and stays in deep view. INTERIM after this
  task: a same-value deep enter is inert AND stays in deep view — acceptable until S6 replaces
  the heuristic with an explicit outcome signal. Do NOT touch deep-view.ts here.
- `src/panel/short-view.ts:127` `initialCursorIndex` (T1, landed) seeds the caret onto the
  recorded answer — same-value enter is now the DEFAULT revisit gesture, which is exactly the
  path this task must make inert.
- `src/panel/actions.test.ts` conventions: `choiceQ`/`OPTS_AB` fixtures, `seed()` (applyAnswer
  for answered status with `T0` timestamp), `seamMock(result)`, `makePanel()`, `makeDeps()`,
  snake_case test names. Existing seam describe (:339) uses DIFFERENT values (cursor "b" vs
  stored "a") — nothing there flips.
- `maybeAutoSubmit` (actions.ts:653) AUTOSUBMIT-003 rule (b): an EDIT commit on the last
  sequential answerable question of a complete set currently FIRES (submit + epoch bump).
  A same-value re-accept on that position fires today → must become inert here (skip
  maybeAutoSubmit entirely on the no-op path).
- Validation commands (package.json): `npm test` = `vitest run`; `npm run typecheck` =
  `tsc --noEmit`. No ruff/mypy (TypeScript repo).
- No existing test asserts current same-value-accept state behavior (grepped: seam tests,
  rule-(b) tests use different values) — expect additive tests, triage-only for cross-cutting
  suites.

## Edge rulings distilled from the contract

1. Match condition is status-agnostic over `q.answer` (answered/submitted/closed all pin via T1;
   moot/withdrawn never reach acceptOptionIndex through accept()/digit() guards — leave their
   earlier no-op guards as the only moot handling).
2. `answer.custom === true` is EXCLUDED even if the write-in text byte-equals an option value —
   accepting a real option on a write-in answer is a different-kind edit (flips custom) and
   routes through the seam.
3. Closed (archived) + same-value → inert: must NOT re-mark pending (FR-2's "editing re-marks
   pending" applies to changes; "a same-value re-commit is not a change", h2.34).
4. No-op path performs advance (Q14 rhythm) + return true (consumed); no flash, no gateWarning,
   no epoch bump, no sendMessage.

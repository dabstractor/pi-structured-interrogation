# TRIAGE — Bugfix Wave 1 regression sweep

Subtask: P1.M3.T1.S1 (plan/002_949db554a811/bugfix/001_c0ff03282c6f)
Gate: `npm run typecheck` + `npm test` over the integrated 15-subtask changeset (BUG-001..BUG-008).
Policy: deterministic suite only — no live TUI, no real interrogate calls, no model turns (AUTOMATION-POLICY).

## Run record

- `npm run typecheck` → exit 0 (tsc --noEmit, zero errors).
- `npm test` (`vitest run`) → **48 files / 1278 tests, all passing, exit 0** on the first integrated run.
- Sweep log: /tmp/sweep.log. Single "failed" substring hit is a deliberate
  error-injection console line inside the persistence-mirror tolerance test
  ("state mirror appendEntry failed Error: session in a weird state") — an
  assertion fixture, not a test failure. Zero skipped, zero todo.

## Expected flips (verified, not merely observed green)

Each inventory site was opened and its NEW assertion checked against the
owning bug's semantics (h2.5 Recommendations as authority):

- src/panel/actions.test.ts:276 + :295 `test_accept_on_text_question_opens_writein_editor_no_answer` /
  `test_accept_then_type_enter_answers_text_question` — enter-on-text-question
  noop seam replaced per the P1.M2.T5.S1 contract: accept now OPENS the write-in
  editor (focus "text", textDuty "writein", consumed, no answer applied), and
  type-then-enter commits through writeInEnter ({value, custom: true}) and
  advances — BUG-008 (P1.M2.T5.S1, textDuty re-derivation / write-in surfacing).
  Old assertion (enter answers immediately / noop) → new two-test open-then-commit pair.
- src/panel/actions.test.ts:~2054 `describe("maybeAutoSubmit — gate hold (AUTOSUBMIT-002, AC-2d)")` —
  BUG-001 (P1.M1.T1.S1-S2): gate count now computed BEFORE the completeness
  return, so the ⚠ hold line arms on the canonical open-gate flow
  (hold → release on gate answer → ctrl+s override swaps to legacy warning →
  non-gate skip stays silent). The former deviation-forbidden pin is inverted:
  hold-line deviation before completeness return is now the pinned expectation,
  exact FR-D5 string with config-resolved submit label.
- src/delivery.test.ts:~133 `single_huge_entry_is_ellipsis_truncated_to_budget` —
  BUG-006 (P1.M2.T3.S1-S2): per-entry ellipsis cap re-pins line 1 to
  SUBMISSION_LIST_MAX_CHARS (old "keep ≥1 entry whole" rule removed), epoch
  suffix never dropped, single entry capped not rolled up.
- src/panel/short-view.test.ts:~197+ `describe("text questions")` /
  `describe("write-in preview (BUG-005 part 2)")` — BUG-005 (P1.M2.T2.S1-S2):
  answered preview renders beyond hand-set `answer.text` — `hasTextAnswer`
  honors `answer.custom` (choice write-in dimmed value preview below the Other
  row, w1) and the text-question preview reads `answer.value` (w2) instead of
  requiring a multiline `text` field.

No orphan test diffs found: every located deviation maps to a flip entry above.

## Unexpected fallout (fixed)

None. Zero failures on the integrated first run; no in-seam fixes required; no
assertions changed by this sweep.

## Guards

- src/no-hardcoded-keys.test.ts **PASS** (guard regexes unmodified — `git diff`
  empty on the file). Pre-check `rg 'ctrl\+' src/ -g '!*.test.ts'` found only
  config-default accelerators (src/config.ts DEFAULT_CONFIG.keys — the
  sanctioned source resolveKeyLabels derives from) and comments; the BUG-001
  hold line and BUG-008 duty label interpolate `resolveKeyLabels`-resolved
  values (e.g. submitLabel "Ctrl+S"), no new hardcoded key strings.
- src/keymap-guard.test.ts **PASS** (defaults pinned, ALL_ACTIONS complete,
  unmodified). No new keymap actions were added by the wave.

## Final

- npm test PASS (1278 tests / 48 files) · npm run typecheck PASS
- Certified for the P1.M3.T2 documentation sweep: the flip semantics above are
  the final integrated behavior.

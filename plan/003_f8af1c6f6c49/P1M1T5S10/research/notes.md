# P1.M1.T5.S10 research notes — verified at working tree (HEAD 4e17456 + S9 flips, 2026-10-05)

Task: "AC-16 scripted test + binding green gates" (tasks.json id P1.M1.T5.S10, 1 pt).
All claims below verified by direct file reads / test runs this session.
Prior-session research (corroborates everything): `../P1M1T5S2/research/findings.md`.

## Baseline (gates today)
- `npx vitest run` → **46 files / 1257 tests, all green**.
- `npm run typecheck` → green.
- Working tree holds S9's panel-suite flips (uncommitted, staged) — do not touch `src/panel/*.test.ts`.

## AC-16 home decision
- State-level ACs live in `src/ac-scripted.test.ts` (AC-2/3/8/11/13/14/15); panel-level ACs in
  `src/panel/ac-panel.test.ts` (AC-1/4/5/6/7/9/10/12). The S10 contract names `src/ac-scripted.test.ts`
  explicitly and that suite already constructs `InterrogationPanel` directly (AC-13 e2e, ~:708) —
  **AC-16 goes in `src/ac-scripted.test.ts`** as a new describe block + a row in the Mode A
  per-AC results table (:16–35).

## Verified seams for the AC-16 walkthrough
- `acceptOptionIndex` no-op branch (src/panel/actions.ts ~:288–296): `recorded !== undefined &&
  recorded.custom !== true && recorded.value === opt.value` → `advanceAfterAccept` + return `"noop"`,
  checked BEFORE the ripple seam; skips confirmRippleEdit / applyAnswer / evaluateDependsOn /
  maybeAutoSubmit. Status is NOT gated (closed/submitted answers pin and no-op too).
- `AcceptOutcome = "noop" | "accept" | "veto" | false` (actions.ts:260). `accept(panel)` (actions.ts:218)
  is the boolean-coerced exported wrapper (AC-13 e2e precedent: `expect(accept(panel)).toBe(true)`).
- `writeInEnter` (actions.ts:349): byte-identical write-in re-commit (`custom:true && buffer ===
  answer.value`, likewise any recorded value on text questions) is inert — consume + advance + blur;
  buffer never staged into the draft slot.
- Modal: `panel.confirmMode` (`RippleConfirmState | null`, ripple-confirm.ts:68). Non-null ⇒ modal
  consumes every key; enter=keep, esc=cancel (byte-identical revert, cursor restored to the recorded
  answer row). `rippleVictims` (ripple-confirm.ts:104) BFS order. Footer (AC-7 shape):
  `⚠ Invalidates {n} answered question(s) ({ids}) — enter=keep, esc=cancel`.
- Fixed ←/→ (src/panel/keys.ts ~:399–410): NOT intercepted in text/note focus; short view →
  `actions.prevQuestion` / `actions.nextQuestion` (full list, clamped). Raw sequences:
  LEFT `"\u001b[D"`, RIGHT `"\u001b[C"`, ENTER `"\r"`, ESC `"\u001b"`, DOWN `"\u001b[B"`.
- `initialCursorIndex` (src/panel/short-view.ts:127): answer present → custom ⇒ `options.length` (✎ row),
  text ⇒ 0, option value ⇒ DISPLAY row via `displayOptions` (D-R13 recommended-first), stale ⇒ 0 (never ★).
  No answer ⇒ ★ row. `displayOptions` (short-view.ts:104) is exported.
- Render: `optionLine` accents the recorded non-custom answer's label — `theme.fg("accent", label)`
  (short-view.ts ~:266); caret prefix `CURSOR = "▸ "` at cursorIndex; `STAR = "★ "` only on the
  recommended row; `OTHER_AFFORDANCE = "✎ Other — write your own"` at index `options.length`
  (dim when unfocused). `answerPreviewLine` (short-view.ts:308): dim first-line preview of a custom
  write-in's `answer.value` under the Other row. Recording-theme convention (text-field.test.ts:31):
  `fg: (name, s) => \`${name}:${s}\`` — makes accent/dim routing assertable.
- Panel ctor (AC-13 e2e convention, ac-scripted.test.ts ~:708): `new InterrogationPanel({ tui:
  { requestRender: vi.fn() }, theme, done: () => {}, state, config: DEFAULT_CONFIG, delivery: deps })`;
  `makeDeps()` there → `{ deps: { sendMessage, isIdle: () => true }, sendMessage }`. `editorFactory`
  optional — `panel.textField.setText` works without it (AC-13 e2e). `panel.dispose()` at end (footer
  flash timers). `panel.focus` / `panel.textDuty` (`"writein"`) observable after accepting the ✎ row.
- dependsOn: executor upsert evaluates instantly — a dependsOn question whose dep is UNANSWERED
  arrives **moot**; `evaluateDependsOn` after every panel `applyAnswer` re-mets moot→open
  (src/depends-on.ts :6–10, :67 "Ids flipped moot → open this pass (h2.38 re-met edge)").
- Epoch bumps ONLY inside buildSubmission (a real submission). Commits/edits/no-ops never bump.
  `maybeAutoSubmit` fires only at completeness (zero open/reasked + AUTOSUBMIT-003 transition/edit
  conditions) — keeping one question permanently OPEN silences `sendMessage` for the whole flow.
- State is a module singleton: `resetState()` in the suite's beforeEach (already present).

## Stabilization sites (verified this session)
1. `src/ac-scripted.test.ts:770` — `panel2.currentId = "q1"; // setter re-seeds cursorIndex to the ★ preselect`
   — STALE: q1 is CLOSED carrying recorded "b" (committed at :730 via cursorIndex 1; recommendation "a").
   Under ANSWER-PIN-001 the setter seeds recorded "b" → display row 1. The following
   `panel2.cursorIndex = 2` override masks it (test passes by override). Fix: flip comment + ADD
   discriminating `expect(panel2.cursorIndex).toBe(1);` before the override.
2. `src/ac-scripted.test.ts:728` — same comment text but q1 is UNANSWERED there (accurate).
   Relabel to name the unanswered path (★ preselect survives while unanswered).
3. `src/regression-phantom-submissions.test.ts` — ZERO behavioral flips needed: no row re-commits an
   existing answer; the `writeIn` helper (~:170) sets `cursorIndex = options.length` explicitly
   (immune to seeding); `:290` comment (`// seeds to ★ recommended`) is the unanswered path — accurate.
   ADDITIVE row in "one genuine answer fabricates nothing" after settle: state is epoch 2,
   cancel-trigger CLOSED with "alt" (non-rec; display row 1 under D-R13, ★ "rec" row 0).
   Fresh `panelOf()`, `currentId = "cancel-trigger"` → assert seeds row 1 (a phantom re-proposal
   would sit row 0), ENTER → no-op advance to cancel-semantics, `sendMessage` count unchanged (1),
   epoch 2, `answer.at` unchanged. Optional clarifier "(unanswered — FR-35)" on the :290 comment.

## Guard suites / greps
- `src/no-hardcoded-keys.test.ts` scans NON-test `.ts` only → raw escape constants in tests are safe.
- `src/keymap-guard.test.ts` asserts `DEFAULT_CONFIG.keys` — a test-only diff keeps it green.
- Do not regress S9: `grep -rn "cursor_resets_to_star" src/` must stay 0-hit.
- After stabilization: `grep -n "setter re-seeds cursorIndex to the ★ preselect" src/ac-scripted.test.ts`
  → 0 hits (both :728 and :770 rewritten).
- Test count must not drop (baseline 1257; net +2 or more).

## AC-16 fixture design (derived from spec h2.10 AC-16 + FR-D9 seams)
- q1 choice [a,b] rec "a" — pin target, answered "b" (non-rec) → caret row 1, ★ row 0.
- q2 choice [x,y] rec "x" — write-in target: custom answer pins ✎ row 2 while ★ "x" sits row 0.
- q3 choice — permanently open completeness blocker (keeps sendMessage silent throughout).
- q4 choice [x,y] dependsOn [{id:"q1", equals:"b"}] — FR-18 victim; arrives moot at upsert
  (q1 unanswered), re-mets open after q1="b", answered "x" before the different-choice leg.
- Phases: A answer q1 "b" → advance q2; B travel to q4, answer "x"; C ← back to q1 → caret/accent
  row 1 + ★ row 0 visible; ENTER → no-op advance (serialize byte-identical, epoch 1, at unchanged,
  confirmMode null, sendMessage 0); D q2 write-in commit → ← back → ✎ row 2 + dim preview;
  E byte-identical write-in re-commit inert; F q1 different choice (cursorIndex 0 = ★ "a") → FR-18
  modal victims [q4] → esc cancels byte-identical → re-edit + enter=keep → q1 "a", q4 moot (answer
  kept), still zero submissions.

## Rev 2 (post attempt-1 issue, verified 2026-10-05 03:26)
- Attempt 1 delivered the full changeset; suite 46/1258 green; only failure was PRP v1's
  unsatisfiable "≥ 1260" (blueprint yields exactly 1257+1=1258). Count gate amended to 1258.
- Seam corrections verified in tree: answer.value stores wire VALUE ("x", not "Ex")
  (ac-scripted.test.ts:1202); confirm footer (layout.ts:144) always plural + ⚠ accent-wrapped
  separately → asserts "accent:⚠" + "Invalidates 1 answered questions (q4)" (:1271-1272).
- AC-16 test present at ac-scripted.test.ts:1095/:1115; header row :26; both files modified.

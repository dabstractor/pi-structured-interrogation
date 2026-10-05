# P1.M1.T4.S1 research — comment sweep residuals (verified 2026-10-05, working tree @ 6fd79f9)

## The new contract (single voice target)

ANSWER-PIN-001 / FR-35 (spec h2.8 h3.5, h2.65): the `set currentId` setter seeds
`cursorIndex` via `initialCursorIndex` (T1.S1, landed 1fba337) — a RECORDED answer
owns the caret (option's display row under D-R13 order; ✎ Other row for write-ins;
row 0 for stale values), and the ★ recommendation preselects ONLY while the
question is UNANSWERED. Any comment claiming the setter/cursor "re-seeds to the
★ (R2 preselect)" without the unanswered qualifier is a stale status-agnostic
claim.

## Confirmed stale sites — keys.ts + overview.ts (the contract's listed anchors)

### src/panel/keys.ts ~437-444 (fixed-enter comment block)
Verbatim (inside the `// 3. Fixed enter` block):
```
    // Overview (P1.M5.T2.S1): enter JUMPS to the selected question in the
    // short form (overviewJump — restores options focus, R2 preselect via
    // the currentId setter). Deep view (P1.M5.T1.S1): enter accepts the
```
Stale phrase: "R2 preselect via / the currentId setter" — the jump target may
carry a recorded answer; the setter then seeds to the ANSWER row, not ★.

### src/panel/overview.ts:13 (file header)
```
 * the config prevQuestion/nextQuestion accelerators (contract 3); `enter`
 * jumps to the selected question in the SHORT form (focus restored, R2
 * preselect re-seeded via the currentId setter); `esc` descends the
```
Stale: "R2 / preselect re-seeded via the currentId setter". (Residual NOT in the
arch-note anchor list — found by grep.)

### src/panel/overview.ts:383-391 (overviewJump JSDoc bullet)
```
 * - `panel.currentId = q.id` re-seeds the short-view option cursor to the
 *   ★ recommendation (R2 preselect) via the setter.
```

### src/panel/overview.ts:405 (inline)
```ts
  panel.currentId = q.id; // setter re-seeds cursorIndex (R2 preselect)
```

## Confirmed stale sites — test-file comments (broad-grep residuals; comment-only, zero behavior)

All are `panel.currentId = X;` lines in tests where X carries a recorded answer
at that moment (the setter seeds to the ANSWER row; the "★ preselect" mechanism
claim is wrong even when the rows coincide):

- `src/panel/actions.test.ts:1863` — `panel.currentId = "q1"; // setter re-seeds the cursor to the ★ "a" preselect` (q1 ANSWERED "a" — test_auto_edit_on_complete_set…)
- `src/panel/actions.test.ts:1870` — same comment on q2 (ANSWERED "a")
- `src/panel/actions.test.ts:1912` — `panel.currentId = edit.id; // setter re-seeds the cursor to the ★ preselect` (answered edit target — test_auto_consecutive_edits…)
- `src/panel/actions.test.ts:1982` — `panel.currentId = "q2"; // setter re-seeds the cursor to the ★ "a" preselect` (q2 ANSWERED)
- `src/ac-scripted.test.ts:770` — `panel2.currentId = "q1"; // setter re-seeds cursorIndex to the ★ preselect` (q1 is CLOSED with a recorded answer — archived-edit step 5)

NOTE: `src/ac-scripted.test.ts` is outside src/panel/ but is a grep-found
residual of the dead contract; editing its COMMENT (not assertion) is in scope
("plus any residual found by grep"). T5.S9/S10 flip ASSERTIONS afterwards —
comment-only edits here do not collide.

## Verified ACCURATE "preselect" hits (leave untouched — unanswered-scoped or historical)

- short-view.ts:4/20-28/100/121/130 — S1's rewritten blocks (unanswered-scoped)
- short-view.test.ts:5/75/79/83/159 — :159 asserts the NEW keying (status ≠ answer; pins on `q.answer` presence)
- panel.ts:350/376/891-893/1112 — T1.S2 rewrites. panel.ts:893 quotes "ACCEPT
  the recommendation" INSIDE the supersession note ("Supersedes the old …
  clause (EXPLAIN-003 — h2.65 ruling 5)") — INTENTIONAL historical quotation,
  the ONLY allowed hit for that phrase
- tool-schema.ts:62 + tool-schema.test.ts:64 — landed T1.S3 spec-verbatim string ("preselected only while unanswered — a recorded answer always owns the cursor")
- overview.test.ts:412/452, panel.test.ts:618/828/2176/2740, deep-view.test.ts:420/501, two-stage.test.ts:229, actions.test.ts:131/195/245/541-549/824, ac-scripted.test.ts:728, ac-panel.test.ts:477 — all describe UNANSWERED fixtures (★ preselect correct there)
- regression-phantom-submissions.test.ts:11 — historical remote-bridge bug note (accurate)
- actions.ts ~:329 ("cursor → ★ preselect" after advance to next UNANSWERED) — arguably accurate but :339/:353/:371 setter claims are T2.S4/S5's purge sites (arch note) — NOT mine unless still stale when I run (then they are grep-found residuals → fix)

## Grep gate (run at implementation time; line numbers drift as T2.S4/S5/S6/T3.S1 land)

1. `rg -n "never pin" src/` → 0
2. `rg -ni "star preselect" src/` → 0
3. `rg -ni "status-agnostic" src/` → 0
4. `rg -n "preselects it" src/` → 0
5. `rg -n "ACCEPT the recommendation" src/` → exactly 1: panel.ts supersession quote (keep)
6. `rg -n "R2 preselect" src/panel/` → 0 after this sweep
7. Broad classification: `rg -n "preselect" src/` → every remaining hit must be
   unanswered-scoped, a landed spec-verbatim string, or a documented historical
   note (list above is the expected classification)

## Validation

- `npm run typecheck` (tsc --noEmit) and `npm test` (vitest run) — must be green
  with ZERO test edits (comment-only changes; if a test fails, the edit touched
  code — revert and retry)
- Confirm no code changed: `git diff --stat` shows only .ts files; `git diff -U0
  | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' | grep -vE '^[+-]\s*(//|\*)'`
  should show nothing outside comment tokens (inline `// …` suffixes on code
  lines are fine — the code before `//` must be byte-identical)

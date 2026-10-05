# S8 research — residual status-agnostic-preselect comment inventory

Verified against HEAD `7972f88` (post S1–S7). Greps run over non-test `src/` sources.

## Grep commands (re-runnable evidence)

```bash
# Contract terms (tasks.json LOGIC)
grep -rn -iE "never pin|star preselect|status-agnostic|preselects it|ACCEPT the recommendation" src/ --include="*.ts" | grep -v ".test.ts"
# → ONE hit: panel.ts:893 — INSIDE the "Supersedes the old …" quote (correct, keep)

# Broader stale-claim patterns
grep -rnE "R2 preselect|preselect re-seeded|re-seeds cursorIndex \(R2|re-seeds cursor \(R2\)|★ recommendation preselect|★ preselect via|cursor → ★ preselect|re-seed to ★|EXPLAIN-003 ★ re-seed|cursor re-seed to ★|to the ★ recommendation|resets to the ★ preselect" src/ --include="*.ts" | grep -v ".test.ts"
# → 13 hits across 4 files (inventory below), MINUS the already-correct post-pin sites
```

## STALE sites (S8 rewrites these — comments only)

| # | File:line | Kind | Current text (key excerpt) |
|---|---|---|---|
| 1 | overview.ts:13 | wrong post-pin | "focus restored, R2 preselect re-seeded via the currentId setter" |
| 2 | overview.ts:389-390 | wrong post-pin | "re-seeds the short-view option cursor to the ★ recommendation (R2 preselect) via the setter" |
| 3 | overview.ts:405 | inline, code-adjacent | `// setter re-seeds cursorIndex (R2 preselect)` |
| 4 | keys.ts:440 | wrong post-pin | "overviewJump — restores options focus, R2 preselect via the currentId setter" |
| 5 | actions.ts:326-327 | superseded EXPLAIN-003 clause | "DraftStore seam + EXPLAIN-003 ★ re-seed) with arming explicitly off" |
| 6 | actions.ts:357-358 | superseded EXPLAIN-003 clause | "EXPLAIN-003 cursor re-seed to ★), explicitly NOT a commit" |
| 7 | actions.ts:404 | inline, code-adjacent | `// Q14 parity: currentId → next unanswered, cursor → ★ preselect` |
| 8 | actions.ts:413-414 | setter mischaracterization | "Assigning currentId re-seeds cursorIndex to the ★ recommendation preselect via the panel's own setter" |
| 9 | actions.ts:428 | wrong post-pin (R1 nav reaches answered) | "Cursor resets to the ★ preselect via the currentId setter on every change" |
| 10 | actions.ts:446 | inline, code-adjacent | `// setter re-seeds cursorIndex (R2)` |
| 11 | ripple-confirm.ts:158 | inline, code-adjacent | `// setter re-seeds cursor (R2)` |
| 12 | ripple-confirm.ts:304 | inline, code-adjacent | `// setter re-seeds cursor (R2)` |

Plus one doc glitch inside the block rewritten for #5: actions.ts:323-324 duplicates
"EMPTY buffer: save the draft + blur back to" twice ("…blur back to / Buffer: EMPTY buffer: …").

## Semantics that decide "stale" vs "accurate"

- `UNANSWERED_STATUSES = ["open", "reasked"]` (actions.ts:85). `nextUnanswered` (actions.ts:106) only ever returns questions in those statuses → sites 7/8/11/12 have UNANSWERED targets, so the ★ outcome is real, but the comment asserts the SETTER contract (recorded-answer-first since S1) unqualified — rewrite to name both.
- `overviewJump` (overview.ts:398) jumps into the UNFILTERED list (R1) → target may carry an answer → "re-seeds to ★" is flatly wrong (sites 1-4).
- `prevQuestion`/`stepQuestion` (actions.ts:425-447) navigate the full list → targets may be answered → site 9/10 flatly wrong.
- `commitTextDraft` re-seed (panel.ts:885-896) now goes to the recorded answer when one exists; EXPLAIN-003's "re-seed to ★" clause was superseded by h2.65 ruling 5 → sites 5/6.

## Known-good look-alikes (do NOT touch)

- panel.ts:891-893 — the supersession QUOTE ("re-seed to the ★ preselect / next enter should ACCEPT the recommendation" — h2.65 ruling 5 reference). Gate B hits it legitimately; Gate C does not ("re-seed to the ★" contains "the ").
- panel.ts:376-377, short-view.ts:121, deep-view.ts:585 — CORRECT post-pin phrasings; Gate C excludes them via the UNANSWERED/while/never-to filter.
- short-view.ts:100,130; deep-view.ts:583-590 (rest); panel.ts:347-356, 367-380, 885-896 — post-pin language landed in S1/S2/S6.
- tool-schema.ts:62 — spec-verbatim schema string landed in S3 (pinned by tool-schema.test.ts).
- Test comments (two-stage.test.ts:229, overview.test.ts:412/441-452, deep-view.test.ts:420/501, panel.test.ts:618/828, short-view.test.ts:159): all scoped to UNANSWERED questions (verified: two-stage seedOpen q1 recommendation "a"; overview.test q2 unanswered w/ recommendation) → accurate; test edits belong to T5.S9/S10.

## Gates (verified commands)

- `npm test` (vitest run) — full suite currently green at HEAD.
- `npm run typecheck` (tsc --noEmit, strict).
- `npx vitest run src/no-hardcoded-keys.test.ts src/keymap-guard.test.ts` — comment text is scanner-stripped, but keep `ctrl+…` labels out of new comment text anyway.

# System context — pi-interrogator delta `006_45773b259b06` (2026-10-20)

Repo: `/home/dustin/projects/pi-structured-interrogation` — a pi-coding-agent extension
(`pi-interrogator`) implementing a structured-interrogation panel. TypeScript, vitest,
eslint. Source layout: `src/` (config, tool-schema, panel/, persistence, snapshots…),
`spec/` (human-owned spec — READ-ONLY), `scripts/`, `README.md` (the only user-facing
doc; **no `docs/` directory exists at repo root**).

## Repo state at research time

- HEAD: `7377318` ("question description required; bare prompts rejected"), branch
  `main`, clean except untracked `plan/006_45773b259b06/` (this plan).
- npm scripts (package.json): `test` = `vitest run`, `typecheck` = `tsc --noEmit`,
  `lint` = `eslint src scripts *.ts`.

## The six PRD rulings — ALL ALREADY SHIPPED at HEAD (verified)

| Ruling | Commit | Evidence confirmed |
|---|---|---|
| SANITIZE-001 | `1952841` | `sanitizeDisplayText` in `src/panel/layout.ts` + `src/panel/sanitize-display-text.test.ts` |
| DEEP-EDITOR-001 | `fd07f1e`/`fe81962` | `src/panel/deep-view.ts` + host editor; `deep-view.test.ts:1075–1106` |
| FULL-TRANSCRIPT-001 | `d59372a` | `transcriptPrompt` exported `src/snapshots.ts:77`, used at `:292`, `src/panel/delivery.ts:478`, `src/panel/actions.ts:911` |
| FOOTER-001 | `231f365` | per-screen action sets in `src/panel/layout.ts` |
| KEYMNEMONICS-001 (+amendment) | `a2f1d70`/`4507f31` | `DEFAULT_CONFIG.keys` at `src/config.ts:118–128`: deep `d`, overview `i`, elaborate `e`, batchNote `n`, submit `ctrl+s`, chat `c`, externalEditor `ctrl+g`, prevQuestion `tab`, nextQuestion `shift+tab` |
| `description` REQUIRED | `7377318` | `src/tool-schema.ts:59` + structured parse error at `:360–377` |

**The delta is docs-only.** Per PRD AC-3: no new code beyond the README record; any gap
found in the six rulings during verification is a BUG to fix at the existing seam, not
a rebuild.

## Gate baseline (verified 2026-10-20, scout run)

- `npm test`: **PASS** — 54 files / 1624 tests (~5s tests / ~15s wall). Known flake:
  one timeout-class failure observed once in three runs (`src/persistence.test.ts`
  also logs a benign mocked "state mirror appendEntry failed" error in verbose mode);
  re-run once before declaring a failure.
- `npm run typecheck`: PASS (exit 0). `npm run lint`: PASS (exit 0).

## Minor observations (NOT in scope — record only)

- `src/keymap-guard.test.ts` test name says "ten actions" but there are 9 — stale
  name only, assertion is correct over `ALL_ACTIONS`. Docs-only delta must not touch it.

## Hard boundaries for this changeset

- Edit **README.md only**. `spec/` is human-owned and carries two DECLARED stale
  fossils (AC-2b and M8 prose saying the elaborate key is `t`) — treat as stale prose,
  never assert, never fix.
- `plan/004_49e25d5235a9/architecture/*` notes reference the old `d/o/t/m/e` letter
  set — historical records of a past changeset; DO NOT TOUCH.
- Write artifacts only under `plan/006_45773b259b06/`.

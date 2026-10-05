# System context — delta 003 (ANSWER-PIN-001 / FR-35, spec M9)

## Repo & stack (verified 2026-10-05)
- `pi-interrogator` — TypeScript extension for the pi coding agent (`package.json`: `main: src/index.ts`, `pi.extensions: [./src/index.ts]`).
- UI: custom panel TUI on `@earendil-works/pi-tui` ^0.85.1; schema: `typebox` 1.3.7; Node >= 22.19.0.
- Scripts: `npm test` = `vitest run`; `npm run typecheck` = `tsc --noEmit`. Config: `tsconfig.json`, `vitest.config.ts`.
- Spec corpus lives in `spec/` (full amended PRD, incl. ANSWER-PIN-001 via spec commit `de633b0`; code HEAD through `c7d44c0`, tree clean).

## What this delta is (and is NOT)
- Everything else in the PRD diff is ALREADY SHIPPED — cite, don't rebuild: bugfix wave BUG-001..008, D-R11–D-R14 locked visuals incl. accent highlight on the recorded answer's row (`32a1f6e`), AUTOSUBMIT-003 narrowing (`2bc2e7c`), bridge removal (`f4969c7`), selection glyphs (`98398af`), first-answer sentinel (`265ecf9`), FR-3d post-submit exit (`2aae6ea`), record-derived `answered` counter.
- This delta = FR-D8 (cursor pins to recorded answer), FR-D9 (inert same-value commits), FR-D10 (★ answered marker on question line), comment purge, test flips, AC-16, README sync.
- Non-goals: no new config surface, no auto-submit/gate/bridge changes, no overview marker changes (already correct), no bulk-accept, no state-machine/rev/epoch/persistence changes.

## Prior plan context (still binding)
- `plan/001_0d6760db6bc5/AUTOMATION-POLICY.md` — verification policy (see testing-verification.md).
- `plan/002_949db554a811/architecture/panel-ui-seams.md` — seam map still accurate for these seams; updated line anchors in this dir's `panel-ui-seams.md`.
- FR-D numbering continues the 002 delta's FR-D series (D8..D10 here).

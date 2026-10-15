# Research Notes — P1.M4.T1.S1: Flip residual scripted suites to the new keymap contract

## Primary source

`plan/004_49e25d5235a9/architecture/readme-and-test-flows.md` — §2 (two simulation styles) and §3 (per-suite inventory with line numbers) are the authoritative map; verbatim tables read in full this session.

## Byte constants (old → new)

| Const | Old byte | New send |
|---|---|---|
| CTRL_D / deep | `\u0004` | `"d"` |
| CTRL_L / overview | `\u000c` | `"o"` |
| CTRL_T / elaborate | `\u0014` | `"t"` |
| BATCH_NOTE | `\u001b[109;6u` | `"m"` |
| DISCUSS | `\u001b[101;6u` | `"e"` |
| submit / externalEditor | `\u0013` / `\u0007` | UNCHANGED (stays chords) |
| digits `"1"`..`"9"` | quick-select | INERT at panel level (route false / types in editor) |

Inline `\u0014` sends NOT via a const (sed would miss): panel.test.ts **:1531, :1570, :2852**.

## Simulation styles (unchanged mechanics)

- Style A router-level: `route(data, stubPanel)`; `DEFAULT_DATA` round-tripped via `matchesKey` (keys.test.ts).
- Style B full-panel: `panel.handleInput(data)` / `firstCall(mock).component.handleInput(data)`.
- Direct-focus pattern (for tests that used re-press toggles): `panel.focusTextField("writein"|"elaboration")` (panel.ts:1188) and `panel.enterNoteMode()` (panel.ts:1262); precedent two-stage.test.ts:385.

## File ownership already claimed by earlier subtasks (DO NOT duplicate; treat as landed)

- keys.test.ts + config-surface.test.ts defaults/inversions: **P1.M1.T2.S1** (DEFAULT_DATA letters, :278/:508 inversion, config-surface :348).
- focusText→elaborate renames in config/labels: **P1.M1.T1.S1/S2**.
- Re-press-gesture test reworks — panel.test.ts :1964 & :2769, two-stage :413: **P1.M1.T2.S2** (two-stage :385 stays green).
- layout.test.ts editor-exit flip + config-surface footer extension: **P1.M1.T2.S3**.
- hjkl tests in keys.test.ts: **P1.M2.T1.S1**.
- actions.test.ts digit-suite delete (:908–967), matcher flips (:1780–1810), digit-based ripple conversions (:513/:545/:601), ripple-confirm.test.ts :390-area: **P1.M3.T1.S2**.
- config.test.ts toggles rewrite, config-surface.test.ts :35/:209: **P1.M3.T1.S3** (parallel — treat as landed).

## Residual inventory FOR THIS TASK

1. **panel.test.ts** (~50 handleInput sites, ~30 tests): CTRL_D/CTRL_L consts :61-62, BATCH_NOTE :1922, CTRL_T :2557; sites at 397-429, 458-466, 498-708 (~12 CTRL_L), 1531/1570 inline \u0014, batch-note suite 1922-2317 (~10), 2224-2303, describe "ctrl+t duty — EXPLAIN vs OTHER" :2556 + tests 2597-2910 (~12), 2852 inline. EXCLUDE :1964/:2769 (already reworked by M1.T2.S2).
2. **two-stage.test.ts** ~13 sites: `focusText(panel)` helper :181 (rename → elaborate), seam sends `\u0014` at :441 + call sites 193, 218, 244, 285, 302, 320, 338, 435, 449, 467, 486. EXCLUDE :413 (reworked).
3. **ac-panel.test.ts** 8 sites / 4 tests: :379/:426/:453/:493 CTRL_L, :620 CTRL_D, :722/:725/:769 CTRL_T (the :725 re-press exit needs gesture swap).
4. **deep-view.test.ts** 4 sites: :818, :843, :898 `handleInput("\u0004")` → `"d"` (+ :863 comment).
5. **discuss.test.ts**: const :35, sends :327/:362/:567 → `"e"`; the "deliberately UNGATED" intercept test :552-567 INVERTS (bare `e` in editor focus must TYPE — expect route false + buffer contains "e").
6. **ripple-confirm.test.ts**: :467 comment (ctrl+t toggle-exit) only — :390 was M3T1S2's.
7. **layout.test.ts** :72-74 fixtures (defaults now d/o/t + elaborate rename) + :393 comment. (Editor-exit test was M1T2S3's.)
8. **ac-scripted.test.ts / overview.test.ts / text-field.test.ts / editor-preservation.test.ts**: zero flips (verify only; ctrl+s `\u0013` at ac-scripted :739 unchanged).
9. **Residuals not owned earlier** — grep-driven sweep for stragglers in keys.test.ts / actions.test.ts / config-surface.test.ts (e.g. keys.test.ts:632 comment was left to S1's file; collision-order :445 letter-vs-letter cases; actions.test write-in suite :709-897 is direct-focus — verify only), plus keymap-guard.test.ts (action-list rename :40; avoided-keys table :55-73 now moot for letters — minimal fix only if red) and no-hardcoded-keys.test.ts (fixtures :232/:236-237 `deep: "ctrl+d"`; CTRL regex no longer matches anything — repair only to green, redesign is NOT this task).

## Contract notes for expectations

- Two-tier intercept: bare letters intercept ONLY from non-editor focus; chords (ctrl+s/ctrl+g) intercept everywhere incl. text/note focus.
- Digits: inert at panel level from any view/focus (route false); they type in editor focus.
- `t` (elaborate) remains short-view gated (BUG-011); `d`/`o`/`m`/`e` fire from deep/overview too.
- Toggle-exit scenarios: re-press closes are gone — exit via `enter` or double-`esc`, or set focus/enterNoteMode() directly (two-stage.test.ts:385 pattern).
- Gate: FULL `npm test` + `npm run typecheck` green.

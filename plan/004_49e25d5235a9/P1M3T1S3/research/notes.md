# Research Notes — P1.M3.T1.S3: Delete digitQuickSelect from the config schema and settings load

## 1. Verified site map — src/config.ts (line numbers STABLE into S3: S1 owns keys.ts/keys.test.ts, S2 owns actions.ts/actions.test.ts/short-view.ts/panel.ts/ripple-confirm.test.ts — neither touches config.ts)

| Site | Line (verified in current tree) | Content |
|---|---|---|
| Interface field + JSDoc | :79–80 | `/** Allow pressing 1–9 to quick-select an option. Default true. */` + `digitQuickSelect: boolean;` in `InterrogatorConfig` |
| Default | :123 | `digitQuickSelect: true,` in `DEFAULT_CONFIG` |
| coerceConfig line | :234 | `digitQuickSelect: coerceBoolean(src.digitQuickSelect, DEFAULT_CONFIG.digitQuickSelect),` |
| loadConfig JSDoc header counts | :277 | `* Nested objects merge per-key; scalars replace. 9 keys + 4 toggles` |
| loadConfig JSDoc toggles table row | :309 | `` | `digitQuickSelect` | true | Press 1–9 to quick-select an option | panel keys (P1.M3.T3.S1) | `` |

Post-edit: interface has 9 keys + 3 toggles (gateWarnings, roundDetection, compactionPreservation) + editorMode + escExitWindowMs. Key count UNCHANGED (9) — elaborate replaced focusText 1:1 in P1.M1.T1.S1.

**DISCREPANCY RESOLVED**: architecture/config-surface.md:50 says counts become "8 keys + 3 toggles" — STALE (written before the elaborate rename settled). Current config.ts:277 says "9 keys" and the work item confirms "9 keys + 3 toggles — the key count is unchanged". Follow the work item + current code.

## 2. AC-3 mechanism — why a stale settings file loads cleanly

`loadConfigFrom` = `coerceConfig(deepMerge(deepMerge(DEFAULT_CONFIG, global), project))`. The merged raw object DOES carry a stale `digitQuickSelect` (deepMerge spreads override keys), but `coerceConfig` REBUILDS the result field-by-field from named fields only — unknown keys are dropped on the floor. So deleting the four sites removes the field from schema AND from the resolved output with no additional unknown-key handling. Test must assert: settings file with `digitQuickSelect: false` → resolved config `toEqual(DEFAULT_CONFIG)` and `"digitQuickSelect" in cfg === false`.

## 3. Precondition — reader-free codebase (INPUT contract)

`grep -rn "digitQuickSelect" src/ --include="*.ts" | grep -v "\.test\.ts"` must yield ONLY src/config.ts. Current tree still has two readers (in-flight siblings):
- `src/panel/keys.ts:599` — `config.digitQuickSelect &&` (S1's deletion, P1.M3.T1.S1)
- `src/panel/actions.ts:195` — `if (!panel.config.digitQuickSelect) return false;` (S2's deletion)

If either remains, deleting the interface field fails `typecheck` — wait/coordinate, don't hack around.

Test-file occurrences today: `config.test.ts` :108/:113/:114/:116/:117 (S3's to rewrite); `keys.test.ts:632` comment only ("digitQuickSelect is S3's…", S1's file — S3 leaves keys.test.ts untouched; expected residual).

## 4. config.test.ts — toggles test rewrite (:106–117)

Current `test_toggles_coerce_bad_values_to_defaults_and_keep_false`:
- :108 bad fixture includes `digitQuickSelect: {}` → drop from fixture (keep `gateWarnings: "yes", roundDetection: 0`)
- :113 `expect(cfg.digitQuickSelect).toBe(true)` → replace with key-absence assertions
- :114–117 "off" write `{ interrogator: { digitQuickSelect: false } }` → KEEP the stale write (it is the AC-3 test) but assert absence + `toEqual(DEFAULT_CONFIG)`; fold `gateWarnings: false` into it to preserve the test's "keep false" half
- Helpers available: `writeSettings(body)` :29, `missingPath()` :37, `loadConfigFrom({global, project})` — reuse, don't reinvent
- After field deletion, `cfg.digitQuickSelect` is a TYPECHECK ERROR — use `"digitQuickSelect" in cfg` / `Object.keys(cfg)` instead
- :42 `test_no_files_anywhere_returns_defaults_exactly` uses `toEqual(DEFAULT_CONFIG)` — survives unchanged

## 5. config-surface.test.ts — two sites (only digit hits in file: :35, :209)

- :35 comment: "`up`/`down`/`left`/`right`/`esc`/`enter` plus digit quick-select 1–9." → delete " plus digit quick-select 1–9" (digits are not fixed keys anymore — they're inert/nothing)
- :209 fixture in `makeActions()`: `digit: vi.fn((_p: InterrogationPanel, _n: number) => true),` → delete line (S2 removes the PanelActions/RoutedActions member; the spy is dead weight and may excess-property-error depending on typing)
- No other digit-spy assertions in the file (verified: only :35/:209 match "digit")

## 6. Unaffected suites (verified)

- `keymap-guard.test.ts`: ALL_ACTIONS = 9 entries (deep…nextQuestion); digitQuickSelect was a TOGGLE, never a KeyAction; completeness test iterates ALL_ACTIONS — unaffected. (File's "ten actions" wording at :25/:100 is pre-existing stale naming, NOT S3's scope.)
- `no-hardcoded-keys.test.ts`, `ac-scripted.test.ts`, `panel.test.ts`, `ac-panel.test.ts`: zero digitQuickSelect hits.
- `scripts/`: zero hits.

## 7. Out of scope (owned elsewhere)

- README digit references (:36–37, :51, :54, :59) → P1.M4.T2.S1
- keys.ts / keys.test.ts → S1 (incl. the :632 stale-after-S3 comment)
- actions.ts etc. → S2
- AC-3 scripted end-to-end → P1.M4.T1.S2 (S3 supplies the config-level absence test)

## 8. External research

None needed — pure in-repo schema deletion; no libraries involved. Coercion/merge patterns are local to config.ts (deepMerge/tryReadInterrogator/coerceBoolean, file-injector-derived).

## 9. Consumers of S3's output

- P1.M4.T2.S1 (README rewrite) consumes the corrected loadConfig JSDoc (Mode A: JSDoc is the README's source of truth)
- P1.M4.T1.S2 (AC-3 scripted) relies on the final schema being 9 keys + 3 toggles

## 10. Validation commands (verified against repo)

- `npm run typecheck` (script exists; equivalent `npx tsc --noEmit`)
- `npx vitest run src/config.test.ts src/config-surface.test.ts`
- `npm test` (full suite)
- Audit: `grep -rn "digitQuickSelect" src/` → only config.test.ts (deliberate stale-fixture test) + keys.test.ts:632 comment (S1's)

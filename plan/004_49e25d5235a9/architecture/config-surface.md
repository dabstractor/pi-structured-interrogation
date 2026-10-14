# Config Surface Map — Keymap Trilogy (plan 004)

Read-only research at HEAD 182f4ce. Line numbers are real (content-located).

## 1. KeyAction union & defaults (src/config.ts)

**Union** — `export type KeyAction =` at **:48**; members in order (:49–58):
`deep`, `overview`, `focusText` (**:51**), `batchNote`, `submit`, `discuss`, `externalEditor`, `prevQuestion`, `nextQuestion`. 9 members total.

**KEY_ACTIONS array** (drives coercion + label iteration) at **:93–103**, `"focusText"` at **:96**. Declared `as const satisfies readonly KeyAction[]`.

**Defaults block** — `export const DEFAULT_CONFIG` at **:109**, `keys:` at **:110**:
```ts
deep:          "ctrl+d",         // :111
overview:      "ctrl+l",         // :112
focusText:     "ctrl+t",         // :113
batchNote:     "ctrl+shift+m",   // :114
submit:        "ctrl+s",         // :115
discuss:       "ctrl+shift+e",   // :116
externalEditor:"ctrl+g",         // :117
prevQuestion:  "tab",            // :118
nextQuestion:  "shift+tab",      // :119
```
`digitQuickSelect: true` at **:123**. Interface field `digitQuickSelect: boolean` at **:80**.

## 2. Coercion & compat-alias seam

- `coerceKeys(raw)` at **:195–202**: iterates `KEY_ACTIONS`; per action, `typeof v === "string" && v.trim() !== "" ? v : DEFAULT_CONFIG.keys[action]`. **Unknown action names on `src` are silently dropped** (never copied) — so a settings file's `keys.focusText` after the rename would simply be ignored unless aliased.
- `coerceConfig(raw)` at **:216–225**: calls `coerceKeys(src.keys)` (:219) and `coerceBoolean(src.digitQuickSelect, DEFAULT_CONFIG.digitQuickSelect)` (**:222**).
- Precedents: `coerceBoolean`/`coerceNumber`/`coerceEditorMode` (:178–193) — all tolerant, fall back to default. There is **no historical alias precedent in config.ts**: grep for alias/deprecated/legacy/formerly finds only prose notes (breakOut removal note at :41–46, CAPS-OUT note :69–71). The only "silent drop" precedent is `tryReadInterrogator` + open-schema merge (unknown top-level keys vanish via `coerceConfig` rebuilding the object field-by-field).
- **Alias seam**: slot inside `coerceKeys` before the per-action loop — e.g. if `src.focusText` is a string and `src.elaborate` is absent/invalid, use it for `elaborate`. Since `coerceConfig` rebuilds the object explicitly, deleting `digitQuickSelect` there (and at :80, :123) removes it from the schema and settings load with no other change needed — unknown `digitQuickSelect` in settings then simply contributes nothing.

## 3. Doc-table generator (JSDoc in loadConfig, README source of truth)

Not code — a markdown table inside the `loadConfig` JSDoc. Keys table under `### keys` heading (**:269**), rows **:271–280**, verbatim:

```
 * | field           | default         | purpose                                        | label consumer |
 * |-----------------|-----------------|------------------------------------------------|----------------|
 * | `deep`          | `"ctrl+d"`      | Open the deep-dive/ramification view           | footer, dialogs |
 * | `overview`      | `"ctrl+l"`      | Open the question overview list                | footer, dialogs |
 * | `focusText`     | `"ctrl+t"`      | Focus the text editor for the current question | footer          |
 * | `batchNote`     | `"ctrl+shift+m"`| Attach a batch note                            | footer, dialogs |
 * | `submit`        | `"ctrl+s"`      | Submit answers / close the panel               | footer, widget  |
 * | `discuss`       | `"ctrl+shift+e"`| Discuss the current question in chat           | footer, dialogs |
 * | `externalEditor`| `"ctrl+g"`      | Open the draft in an external editor           | footer, widget  |
 * | `prevQuestion`  | `"tab"`         | Move to the previous question                  | footer          |
 * | `nextQuestion`  | `"shift+tab"`   | Move to the next question                      | footer          |
```
Toggles table under `### toggles` (**:282**); `digitQuickSelect` row at **:287**: `` | `digitQuickSelect` | true | Press 1–9 to quick-select an option | panel keys (P1.M3.T3.S1) | ``. Also `focusText` prose mention in the `escExitWindowMs` section at **:296** ("close via the `focusText` toggle or enter"). Header counts at ~:266 ("9 keys + 4 toggles") must become 8 keys + 3 toggles.

## 4. focusText & digitQuickSelect occurrence map (non-test, outside config.ts)

`grep -rn 'focusText\|digitQuickSelect' src --include='*.ts' | grep -v .test.ts`:

| file:line | identifier | purpose |
|---|---|---|
| src/panel/layout.ts:67 | focusText | `focusText: "text"` — focus-state→label mapping |
| layout.ts:431 | focusText | comment (footer label naming) |
| layout.ts:501 | labels.focusText | footer hint `` `${labels.focusText} explain` `` |
| layout.ts:510 | labels.focusText | short-screen static hint set |
| layout.ts:516 | labels.focusText | editor-exit hint "…close" |
| src/panel/actions.ts:188,195 | digitQuickSelect | comment + `if (!panel.config.digitQuickSelect) return false;` — digit select gate (delete) |
| actions.ts:211–241, deep-view.ts:742,747, panel.ts:415,439,1147,1156,1185,1199 | focusText | `focusTextField()` method / router seam `onFocusText` — method name, not config key (decide whether rename touches it; config-side rename is independent) |
| src/panel/keys.ts:68,71 | both | header comment (dispatch order + digit gate) |
| keys.ts:475 | `matchesKey(data, b.focusText)` | binding dispatch — becomes `b.elaborate` |
| keys.ts:512 | `config.digitQuickSelect &&` | digit quick-select path (delete) |
| src/panel/panel.ts:541 | digitQuickSelect | comment ("actions read digitQuickSelect off it") |

## 5. Guard-test mechanics

### src/no-hardcoded-keys.test.ts
Scans **every non-test `.ts` under src/** (recursive `listSourceFiles`, test name `test_source_contains_no_hardcoded_key_labels`). Pipeline: `stripComments` (string-aware comment blanker) → `blankDefaultConfigBlock` (blanks config.ts's `DEFAULT_CONFIG` literal, from `export const DEFAULT_CONFIG` to first column-0 `\n};`). Violation regexes: `/["'`](?:\s*)(?:alt|super)\+/i`, `/ctrl\+[a-z0-9]/i` (ctrl matched anywhere in code), `/shift\+tab/i`. Key assertion (≈:186): `expect(problems, "runtime code must never hardcode a key label (h2.52)").toEqual([]);`.
**Post-change**: no edits needed for bare-letter defaults — `d/o/t/m/e` contain no modifier and don't match any regex; `tab`/`shift+tab` defaults remain inside the blanked DEFAULT_CONFIG block. The rename and digit removal don't affect it. Still passes as long as no new `ctrl+…` literal appears in runtime code. Note CTRL_ANYWHERE does **not** check keys.ts dispatch logic, only literals.

### src/keymap-guard.test.ts
Imports `DEFAULT_CONFIG` + `KeyAction`. Three invariants:
1. `test_no_default_key_is_on_a_taken_or_avoided_key` — `DEFAULT_CONFIG.keys` entries must not hit `AVOIDED_KEYS` (ctrl+b, ctrl+shift+b/j/x/s/w, shift+down, ctrl+m, ctrl+shift+f/up/down). Assertion: `expect(hit, \`keys.${action} = "${key}" sits on a TAKEN key…\`).toBeUndefined();`. Bare `d/o/t/m/e` are **not** in AVOIDED_KEYS → no collision. The guard does NOT check conflicts with fixed keys (hjkl/arrows/enter/esc/digits) or intra-map duplicates — bare letters colliding with fixed hjkl/`m`/`t` aliases is **unchecked here**.
2. `test_every_default_matches_the_pi_accelerator_grammar` — `/^([a-z0-9]+\+)*[a-z0-9]+$/`. Bare letters `d`,`o`,`t`,`m`,`e` **pass**.
3. `test_keys_map_stays_complete_over_all_ten_actions` (name says ten, asserts **9** via `ALL_ACTIONS` duplicated at :24–34 with `"focusText"` at :29) — `expect(Object.keys(DEFAULT_CONFIG.keys).sort()).toEqual([...ALL_ACTIONS].sort());`. **Must be edited**: rename focusText→elaborate in its local `ALL_ACTIONS` copy. Optionally add hjkl→arrow aliases & digit inertness assertions here.
4. `test_guard_list_stays_curated_and_actionable` — list hygiene only, unaffected.

## 6. Tests to flip

| file | test name | line | pins-old | becomes-new |
|---|---|---|---|---|
| config.test.ts | test_no_files_anywhere_returns_defaults_exactly | :42 | full DEFAULT_CONFIG equality incl. chord keys + digitQuickSelect | equality with new defaults (d/o/t/m/e), no digitQuickSelect key |
| config.test.ts | test_global_only_keys_override_changes_only_that_key | :47 | keys: {submit:"ctrl+enter"} — chord-style override | still valid; optionally add a bare-letter override case |
| config.test.ts | test_toggles_coerce_bad_values_to_defaults_and_keep_false | :106 | `digitQuickSelect: {}` → true; `false` honored | drop digitQuickSelect assertions or assert the field is absent from resolved config |
| config.test.ts | test_resolve_key_labels_covers_all_actions_with_default_config | :129 | `labels.focusText === "Ctrl+T"`, Ctrl+D/L/Shift+M/Shift+E etc. (9 labels) | `labels.elaborate === "T"`; "D","O","M","E","Ctrl+S","Ctrl+G","Tab","Shift+Tab" |
| config.test.ts | test_resolve_key_labels_reflects_rebound_keys | :144 | rebound chord labels | keep; add focusText→elaborate alias case (settings `keys.focusText:"ctrl+t"` resolves elaborate) |
| config-surface.test.ts | header comment table (:19–24) + DEFAULT_KEYS fixture :88–98 | :88 | control-sequence fixtures for ctrl+d/l/t, ctrl+shift+m/e, tab, shift+tab, ctrl+s, ctrl+g | new fixtures: `d`,`o`,`t`,`m`,`e` as plain key events ("d" etc.); submit/externalEditor/prev/next unchanged |
| config-surface.test.ts | REMAP table :105–117 | :105 | remap chords (ctrl+alt+d, ctrl+y, ctrl+shift+n, f9…) | keep chords as remaps (fine) but rename focusText→elaborate entries |
| config-surface.test.ts | handler map :128–136, focus target map :141–149 | :128/:141 | `focusText: "onFocusText"`, `focusText: "text"` | `elaborate: …` |
| config-surface.test.ts | test_fixture_key_tables_round_trip_through_matchesKey | :305 | chord fixtures through matchesKey | new bare-letter fixtures round-trip |
| config-surface.test.ts | test_every_action_fires_on_its_remapped_accelerator / test_every_default_accelerator_is_released_after_full_remap | :325/:337 | default chord release | release of defaults now means pressing bare d/o/t/m/e does nothing after remap; two-tier intercept semantics (bare in text focus → forwarded to editor) must be reflected in test_remapped_actions_fire_from_text_focus_too_intercept_rule (:348) |
| config-surface.test.ts | label tests :399–470 (test_resolve_keyLabels_full_remap…, test_footer_reflects_remapped_labels…, expect(footer).not.toContain("Ctrl+D deep") :440) | :399 | default labels are chords (Ctrl+D etc.) | footer must not contain "D deep"-style defaults; rename focusText refs |
| config-surface.test.ts | invalid sweep :473–518 (bad values fall back to defaults.submit == ctrl+s) | :473 | `defaults.submit` chord equality | still "ctrl+s"; add alias+digitQuickSelect-absence assertions if in scope |
| keymap-guard.test.ts | ALL_ACTIONS array | :24–34 | `"focusText"` member; 9 entries | `"elaborate"`; guard passes with bare letters (grammar ✓, AVOIDED ✓); consider adding fixed-key collision tests for hjkl/m/t aliases |

## Confidence & anomalies

- **Anomaly 1**: keymap-guard test name says "all ten actions" but asserts **9** — pre-existing naming drift; don't copy the "ten".
- **Anomaly 2**: keymap-guard's `ALL_ACTIONS` is a hand-duplicated copy of config's `KEY_ACTIONS` — rename must hit both or completeness test fails.
- **Anomaly 3**: the planned change makes bare defaults colliding with fixed keys (`hjkl` aliases, `m`=`batchNote`? no—`m` is batchNote itself; but `h`/`j`/`k`/`l` are fixed arrows and `d` is a config default — no collision; `t` elaborate vs nothing fixed; `e` discuss vs esc? distinct) — **keymap-guard does not check fixed-key conflicts at all**, so that invariant is currently unguarded; plan should note it.
- **Anomaly 4**: `m` (batchNote) and `t` (elaborate) are letters commonly consumed by editors (vim motions in pi-vim normal mode). Two-tier intercept (modifier always intercepts; bare forwards while focus is text/note) is the mitigation; config-surface's intercept test at :348 pins the old all-intercept rule and needs semantic rewrite.
- **Anomaly 5**: no alias precedent exists in config.ts — the focusText→elaborate alias must be added fresh inside `coerceKeys` (or `coerceConfig` before `coerceKeys`), which is the only place settings key names are read.
- No mismatch blocking the plan: config.ts and both guard tests exist as described.

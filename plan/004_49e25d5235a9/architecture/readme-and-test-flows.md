# README stale map + affected-test inventory (hotkey change: chords → bare letters)

Research for the planning delta at HEAD 182f4ce. Contract being planned:
- `deep` `ctrl+d` → `d`; `overview` `ctrl+l` → `o`; `focusText` `ctrl+t` → `t` **and renamed to `elaborate`**; `batchNote` `ctrl+shift+m` → `m`; `discuss` `ctrl+shift+e` → `e`; `submit` stays `ctrl+s`; `externalEditor` stays `ctrl+g`.
- hjkl = fixed aliases of arrows.
- Digit quick-select (1–9) removed — digits inert at panel level (still type in editor).
- While embedded editor holds focus, ALL bare keys (config letters + hjkl + digits) type into the buffer instead of intercepting.

---

## 1. README stale map

### 1a. Structure (headings with real line numbers)

| Line | Heading | Notes |
|---|---|---|
| 1 | `# pi-interrogator` | intro, no keys |
| 11 | `## Install` | no keys |
| 30 | `## Usage` | **stale** — keymap prose in item 2 (lines 33–68), item 4 mentions removed `ctrl+shift+q` (line ~105, fine), item 3 `ctrl+s` (lines 69–83, still valid) |
| 130 | `## Configuration` | **stale** — sample settings.json `keys` block lines 137–149, `digitQuickSelect` line 155 |
| 173 | `## Keymap` | **stale** — remappable table lines 177–188; fixed-keys table lines 191–199 (digits row line 198, arrows lines 196–197); intercept-rule prose lines 231–233 |
| 235 | `### Subcommands (one command, no autocomplete noise)` | key-free |
| 251 | `## Acceptance criteria (spec)` | **stale refs** — 2b `ctrl+t` (line 261), 2d `ctrl+s` ok (line 265), 16 mentions "enter/digit" (line 277) |
| 279 | `## Limitations` | clean |
| 300 | `## Development` | clean |
| 320 | `### Keymap conflict re-verification` | **whole section stale** — chord-conflict rationale (2026-09-13 verification) loses most of its subject matter; see 1b hits at 337–343, 347–364 |
| 391 | `## Project structure` | clean |

No TOC/anchors section exists in README.md.

### 1b. Every grep hit (`grep -nE 'ctrl\+t|ctrl\+d|ctrl\+l|ctrl\+shift\+m|ctrl\+shift\+e|focusText|digit|hjkl' README.md`)

| Line | Hit (section) | Content / what changes |
|---|---|---|
| 36 | Usage item 2 | digits `1`–`9` quick-select prose — digit QS removed |
| 37 | Usage item 2 | "`ctrl+t` to focus the free-text editor" → `t` / elaborate |
| 38 | Usage item 2 | "`ctrl+d` … deep-dive, `ctrl+l` … overview, `ctrl+shift+m` … batch note" → `d`, `o`, `m` |
| 39 | Usage item 2 | "`ctrl+g` to finish the draft in an external editor" — unchanged |
| 47 | Usage item 2 | "`ctrl+t` is not the only entry" (text-question enter path) |
| 51 | Usage item 2 | "`enter` or a digit on the recorded value" (answer pinning) — digit refs |
| 54 | Usage item 2 | re-confirm "(`enter`, a digit, or a byte-identical write-in)" |
| 59 | Usage item 2 | "a different digit … raises the invalidation confirm" |
| 141 | Configuration sample | `"deep": "ctrl+d"` → `"d"` |
| 142 | Configuration sample | `"overview": "ctrl+l"` → `"o"` |
| 143 | Configuration sample | `"focusText": "ctrl+t"` → `"elaborate": "t"` (rename + value) |
| 144 | Configuration sample | `"batchNote": "ctrl+shift+m"` → `"m"` |
| 146 | Configuration sample | `"discuss": "ctrl+shift+e"` → `"e"` |
| 155 | Configuration sample | `"digitQuickSelect": true` — field to delete (or mark removed) |
| 179 | Keymap table | `deep` default `ctrl+d` row |
| 180 | Keymap table | `overview` default `ctrl+l` row |
| 181 | Keymap table | `focusText` row (long duty explanation) — rename to elaborate |
| 182 | Keymap table | `batchNote` row `ctrl+shift+m` |
| 184 | Keymap table | `discuss` row `ctrl+shift+e` |
| 198 | Fixed keys table | `1`–`9` quick-select row — remove / replace with "digits inert" |
| 204 | Keymap prose | "digits never do" (✎ Other row) — digit QS language |
| 261 | Acceptance 2b | elaboration described via `ctrl+t` |
| 277 | Acceptance 16 | "enter/digit on the recorded value" ×2 — digit refs |
| 337 | Keymap re-verification | `ctrl+d` (`deep`) conflict table row |
| 338 | Keymap re-verification | `ctrl+l` (`overview`) row |
| 339 | Keymap re-verification | `ctrl+t` (`focusText`) row |
| 342 | Keymap re-verification | `ctrl+shift+m` (`batchNote`) row |
| 343 | Keymap re-verification | `ctrl+shift+e` (`discuss`) row |
| 347 | Keymap re-verification | "Fixed panel keys (`enter`/`esc`/arrows/digits `1`-`9`)" — digits no longer panel keys; hjkl aliases must be added |
| 363 | Keymap re-verification | "built-ins (`ctrl+d/l/t/s/g` …)" — intercept rationale rewrite |
| 364 | Keymap re-verification | "enter/esc/arrows/digits/tab" |

### 1c. Usage keymap prose (~lines 33–68, quoted essence)

Line 33–39: "Answer in the panel: move between questions with `tab` / `shift+tab`, pick an option with digits `1`–`9` (real options only — the `✎ Other` row is never digit-selectable) or arrows + `enter`, press `ctrl+t` to focus the free-text editor (short view), `ctrl+d` for the deep-dive view, `ctrl+l` for the overview, `ctrl+shift+m` to attach a batch note, `ctrl+g` to finish the draft in an external editor."

All chord mentions become bare letters; digit-QS sentence deleted (arrows + enter + editor remain); later prose (lines 47–68) references `ctrl+t` and digits again.

### 1d. Sample settings.json block (lines 137–149, quoted)

```jsonc
    "keys": {
      "deep": "ctrl+d",             // open the deep-dive (ramification) view
      "overview": "ctrl+l",         // open the question overview list
      "focusText": "ctrl+t",        // focus the free-text editor (short view)
      "batchNote": "ctrl+shift+m",  // attach a batch note
      "submit": "ctrl+s",           // submit answers / close the panel
      "discuss": "ctrl+shift+e",    // discuss the current question in chat
      "externalEditor": "ctrl+g",   // open the draft in an external editor
      "prevQuestion": "tab",        // previous question
      "nextQuestion": "shift+tab"   // next question
    },
```
(Also line 155: `"digitQuickSelect": true, // allow 1–9 to quick-select an option` — delete.)

### 1e. Other keymap-related content

- Fixed-keys table (lines 191–199): arrows rows 196–197 need hjkl-alias note; digit row 198 removed.
- Intercept prose lines 231–233: "While the editor is focused, `esc` (single) and `↑`/`↓` also forward to the editor" — must extend to ALL bare keys forwarding in editor focus.
- Navigation defaults prose (~lines 206–208): ←/→ fixed keys — fine.
- Keymap-conflict section (320–389): conflict table + "panel-intercept rationale" (362–364) + regression-guard mention of `src/keymap-guard.test.ts` (line 386) — most chord-conflict analysis becomes moot; bare letters introduce a NEW class of conflict (panel-scope only, since letters type in editor).
- No FAQ section; no other tables with keys.

---

## 2. Key-press simulation pattern

Two distinct styles, both raw-string based (no synthetic event objects):

### Style A — router-level (src/panel/keys.test.ts)

Feeds **raw terminal bytes** to `route(data, panel)` from `buildKeyRouter(config, actions)`; panel is a narrow stub; actions are `vi.fn` spies. Every default accelerator's bytes are tabled in `DEFAULT_DATA` and round-tripped through `matchesKey(data, keyId)` at fixture time so pi-tui grammar drift fails loudly (`expectMatches`, lines ~126–133).

Quoted example (keys.test.ts:197–207, default dispatch loop):

```ts
const DEFAULT_DATA: Record<KeyAction, string> = {
  deep: "\u0004", overview: "\u000c", focusText: "\u0014",
  batchNote: "\u001b[109;6u", submit: "\u0013", discuss: "\u001b[101;6u",
  externalEditor: "\u0007", prevQuestion: "\t", nextQuestion: "\u001b[Z",
};
...
const consumed = router.route(DEFAULT_DATA[action], panel);
expect(consumed, ...).toBe(true);
expect(dispatchCount(fresh), `${action} dispatches exactly once`).toBe(1);
```

- Focus simulation: `makePanel({ focus: "text" })` — the stub's `focus` field is just `"options" | "text" | "note"`; view via `{ view: "short" | "deep" | "overview" }`.
- Digits are sent as plain strings: `route("3", panel)` (keys.test.ts:901,905), `route("5", makePanel())` (:380).
- Spy mapping for the renamed action: `onFocusText` (makeActions, keys.test.ts:118) + `defaultRoutedActions` seam names `focusText: "onFocusText"`, `focusText: "text"` (config-surface.test.ts:130/143).
- Remap tests use `configWithKeys({ submit: "f9", deep: "ctrl+alt+d" })` then `expectMatches(F9, bindings.submit, ...)`.

### Style B — full-panel (panel.test.ts / actions.test.ts / ac-panel.test.ts / deep-view.test.ts etc.)

Drives the real panel component's `handleInput(data: string): boolean` with the same raw byte constants; `true` = consumed. Constants defined per file, e.g. panel.test.ts:61–62 `const CTRL_D = "\u0004"; const CTRL_L = "\u000c";`, :1922 `const BATCH_NOTE = "\u001b[109;6u";`, :2557 `const CTRL_T = "\u0014";`, ac-panel.test.ts:96–98 `CTRL_D/CTRL_L/CTRL_T`, discuss.test.ts:35 `const DISCUSS = "\u001b[101;6u";`. Rendered-component harness uses `firstCall(mock).component.handleInput(...)` (panel.test.ts:458). Digits sent as `panel.handleInput("2")` (actions.test.ts:1783, ripple-confirm.test.ts:390). Editor focus is usually set directly via `panel.focusTextField("writein"|"elaboration"|undefined)` rather than via the hotkey, but many tests drive the real router seam with `panel.handleInput("\u0014")` (ctrl+t, e.g. panel.test.ts:1531/1570/2852).

**Downstream recipe for new tests:** replace byte constants with plain letters — `"d"`, `"o"`, `"t"`, `"m"`, `"e"` (digits stay `"1"`–`"9"` but now expect `route(...) === false` / types into the editor buffer). Note the contract change: in editor focus the letters must NOT be consumed by the router — today the router intercepts config keys even in text focus (keys.test.ts:278 `test_text_focus_still_intercepts_panel_keys`).

---

## 3. Affected-tests inventory

Legend for "new": letter = bare-letter from non-editor focus dispatches the action; TYPES = when `focus==="text"|"note"`, the key must NOT intercept — it types into the buffer (expect `route===false` + buffer content). INERT = digit no longer quick-selects at panel level (expect `route===false`, no state change; in editor focus it types). `focusText→elaborate` = action/spy/config rename.

### src/panel/keys.test.ts (hardest hit — ~20 tests)

| Test (line) | Old simulation | New expectation |
|---|---|---|
| `test_default_accelerators_dispatch_every_action` (198) | `DEFAULT_DATA` bytes incl. `\u0004`,`\u000c`,`\u0014`,`\u001b[109;6u`,`\u001b[101;6u`; `externalEditor` case runs with `{focus:"text"}` | constants → `"d"`,`"o"`,`"t"`,`"m"`,`"e"`; `matchesKey` round-trip still valid for letters; ctrl+s/ctrl+g bytes unchanged; externalEditor case still types-in-editor exception (stays a chord) |
| `test_unmatched_input_forwards` (250) | `route("x")===false` — plain letter forwards | **contract reversal**: `"x"` stays false, but `"d"/"o"/"t"/"m"/"e"` now dispatch from options focus; add cases that letters forward in text focus |
| `test_text_focus_still_intercepts_panel_keys` (278) | `\u0014` etc. consumed with `focus:"text"`; digits `"1"/"9"` forwarded (298–299) | **invert**: all bare config letters now forward (false) in text focus; ctrl+s/ctrl+g still intercept |
| `test_externalEditor_only_in_text_focus` (305) | ctrl+g gated to text focus | unchanged bytes; only the surrounding fixture table changes |
| `test_arrows_and_enter_dispatch_regardless_of_config` (359) | arrows/enter bytes | add hjkl alias assertions (`h`=up etc.) |
| `test_digitQuickSelect_off_forwards_digits` (376) | `route("5")===false` when flag off | config field disappears — test becomes "digits always inert at panel level" |
| `test_digit_honors_action_result` (384) | `route("7")`→digit spy(7); `route("2")` | digit action removed → expect forward/false, digit spy gone |
| `test_remapped_key_fires_and_old_key_releases` (~248) | remap to `f9`/`ctrl+alt+d` | still valid pattern; defaults in assertions change |
| `test_collision_first_in_resolution_order_wins` (445) | chord collisions | new collision space: letter vs letter, letter vs hjkl |
| `test_default_seams_toggle_views_and_suspend` (459) | seam defaults incl. focusText | rename focusText→elaborate |
| `test_ctrl_shift_m_intercept_fires_in_every_focus_incl_note` (508) | `\u001b[109;6u` in note/text focus consumed | **invert for text focus**: `"m"` types into editor when editor focused |
| `test_esc_in_note_focus...` (521), `test_esc_in_text_focus...` (542), `test_double_esc_window_reset...` (555), `test_esc_exit_window_zero...` (569) | esc sequences | esc logic unchanged; only if they rely on chord interception ordering |
| `test_arrows_forward_to_the_editor_in_text_and_note_focus` (580) | arrow bytes forward in text/note focus | extend with h/j/k/l + config letters forwarding in editor focus |
| `test_digits_are_never_quick_select_while_typing_a_note` (610) | `route("7")` in note focus → digit spy NOT called | still passes trivially; digit action removal makes it global |
| `test_ctrl_t_gate_does_not_break_deep_view_neighbor_bindings` (721) | `\u0014` gating in deep | gate now applies to `"t"`; note elaborate is short-view gated |
| `test_config_intercepts_still_fire_in_deep_view` (760) | config keys fire in deep view | bare letters from deep view (non-editor focus) still fire; `t` still gated |
| `test_digits_do_not_quick_select_in_overview` (896) | `route("3")` overview→false, short→true(903–907) | short-view digit case (905–907) now also false |
| `test_config_intercepts_still_fire_in_overview_view` (910) | chords in overview | letters `d`/`o`/`m`/`e` fire; `t` gated (947 suite) |
| `focusText gated to the short view (BUG-011)` suite (928–953): `test_ctrl_t_in_deep_view_falls_through` (929), `..._overview_...` (939), `..._short_view_still_dispatches...` (947) | `\u0014` bytes | `"t"`; rename elaborate; text-focus case inside 947 must now forward |
| `parseAccelerator` suite (155–183) | grammar | bare letters already accepted (`parseAccelerator("1")==="1"` at 163); consider single-letter normalization |
| `resolveBindings` fallback (172) | defaults `ctrl+s`/`ctrl+d` | defaults become `d` etc. |
| Fixture consts `DEFAULT_DATA` (39–50), `configWithKeys` (56) | chords | letters; `expectMatches` still round-trips |

### src/panel/actions.test.ts (6 hits + digit suite)

| Test (line) | Old | New |
|---|---|---|
| digit suite (908–967): `test_e_digit_accepts_option...` (909), `test_e_digit_beyond_option_count_is_noop_false` (918), `test_digit_never_selects_the_other_row...` (928), `test_e_digit_disabled_falls_through_false` (944, uses `digitQuickSelect:false` at 946), `test_e_digit_on_text_question_is_false` (952), `test_digit_on_answered_routes_through_the_ripple_seam` (958) | call `panelActions.digit(panel, n)` directly | the digit action is removed — suite deleted or converted to "digit press is inert at panel level" router tests |
| `test_matcher_digits_quick_select_when_enabled` (1780) | `panel.handleInput("2")` quick-selects (1783) | `handleInput("2")` → false / types in editor |
| `test_matcher_digits_fall_through_when_quick_select_disabled` (1787) | `digitQuickSelect:false`, `handleInput("2")` false (1789–1791) | becomes redundant/inverted — always false |
| `test_matcher_skipped_when_the_keys_seam_consumes_first` (1795) | seam consumes chord `\u000c` (ctrl+l → overview, 1807) | seam consumes `"o"` |
| `test_registry_exposes_the_named_action_surface` (1897) | registry names | focusText→elaborate if named there |
| write-in duty tests driving `panel.focusTextField("writein")` (709–897, ~13 sites) | direct focus, no hotkey | unchanged (no chord) — verify only |

### src/panel/panel.test.ts (~50 handleInput chord sites)

| Lines (tests) | Old | New |
|---|---|---|
| 397–429 `test_ctrl_l_overview_esc_returns` (406), deepSticky reopen (451) | `CTRL_D`/`CTRL_L` toggles | `"d"`/`"o"` |
| 458–466 suspend tests (`firstCall(mock).component.handleInput(CTRL_D)`) | rendered component | `"d"` |
| 498–708 `test_builtins_render_real_lines_per_view` (498), overview seed/window/status/footer suite (552–708, ~12 `CTRL_L` sites) | `CTRL_L` entry to overview | `"o"` — many repeated one-liner flips |
| 1531, 1570 raw `panel.handleInput("\u0014")` (ctrl+t focus) | ctrl+t | `"t"` |
| 1922–2317 batch-note suite: `test_ctrl_shift_m_enters_note_mode...` (1934), `test_note_mode_swaps_from_deep_view_too` (1951), `test_repress_exits_preserving_draft...` (1964), `test_esc_exits_note_mode...` (1987), note-vs-question draft tests (2049–2214, BATCH_NOTE at 2167–2184), `test_note_mode_still_wins_over_deep_pane` (2307) | `BATCH_NOTE = "\u001b[109;6u"` toggles (~10 sites) | `"m"`; note-mode toggle from text focus now impossible via bare key while editor holds focus — some tests must set `panel.focus="note"`/`enterNoteMode()` directly (pattern exists: two-stage.test.ts:385) |
| 2224–2303 deep seeding + `ctrl+l overview round-trip` (2302–2303, 2314 note via BATCH_NOTE) | CTRL_D/CTRL_L/BATCH_NOTE | `"d"`/`"o"`/`"m"` |
| 2554–2910 `describe("ctrl+t duty — EXPLAIN vs OTHER")` (2556): CTRL_T const 2557; tests at 2597, 2612, 2631, 2656, 2676, 2715, 2769 (`ctrl_t_repress_exits...`), 2813, 2846, 2868, 2898 | `CTRL_T` focus/toggle (~12 sites) | `"t"` + describe renamed (elaborate); repress-toggle in editor focus: bare `t` while typing now TYPES — the toggle-exit semantics need a non-key exit (esc/double-esc) or the toggle only from options focus — planning decision |

### src/panel/ac-panel.test.ts (8 sites)

| Test (line) | Old | New |
|---|---|---|
| AC-1 (351) | none — clean | — |
| AC-12 remap footer labels (426, uses CTRL_L at 379) | footer reflects remap | defaults table 19–25-style fixtures change to letters |
| AC-6 (467, CTRL_L at 453) | ctrl+l → overview | `"o"` |
| (493 CTRL_L, gate/moot test) | ctrl+l | `"o"` |
| AC-5 deep scroll (613, CTRL_D at 620) | ctrl+d entry sets deepSticky | `"d"` |
| AC-4 suspend/drafts (703, CTRL_T at 722/725/769) | ctrl+t focus + toggle-exit | `"t"` focus from options; the 725 toggle-exit re-press while focused now types — swap exit gesture |

### src/ac-scripted.test.ts (mostly unaffected)

- 739 `panel.handleInput("\u0013")` = ctrl+s submit — unchanged.
- 786/803/1247/1263/1279/1290/1301–1311 ENTER, 1231/1266 LEFT, 1303 ESCAPE — fixed keys, unchanged.
- No digit presses, no chord presses other than ctrl+s. Only comments mention ctrl+s (251, 310, 627, 661, 736). **No test flips required.**

### src/panel/layout.test.ts

- 72–74: fixture config copies defaults (`deep:"ctrl+d"`, `overview:"ctrl+l"`, `focusText:"ctrl+t"`) — update to letters + rename (footer labels render from these).
- 393: comment "the focusText toggle closes" — comment/label only.

### src/panel/overview.test.ts

- 543 `panel.focusTextField()` — direct focus, no hotkey. No flips; only footer-string assertions if any name chords (grep found none).

### src/panel/discuss.test.ts

- 35 `const DISCUSS = "\u001b[101;6u"`; sends at 327, 362, 567 (router dispatch mid-edit — 552 comment: "step-4 intercept for ctrl+shift+e is deliberately UNGATED" by editor focus).
- New: `"e"` from options focus discusses; from editor focus it must TYPE — the "ungated" intercept rule (552–567) inverts for the bare letter; mid-edit discuss test needs explicit blur or stays chord-based only if discuss were a chord (it isn't).

### src/panel/text-field.test.ts

- 57/174–176/286: `field.handleInput("x")` delegates to editor — the pattern bare keys will now exercise from panel level. No chord sends. Minimal/no flips; useful template for "letters type" assertions.

### src/panel/two-stage.test.ts (heavy ctrl+t user)

- 181 `function focusText(panel)` drives focus "through the real router seam (ctrl+t)" — 441 `panel.handleInput("\u0014")` is the seam send; call sites 193, 218, 244, 285, 302, 320, 338, 435, 449, 467, 486.
- New: seam sends `"t"`; the helper name/comments rename to elaborate. 413 `\u001b[109;6u` (ctrl+shift+m re-press exits note) → `"m"` — but re-press while note editor focused must TYPE now; test 385/413 pair needs rework (exit via esc or focus manipulation).

### src/panel/editor-preservation.test.ts

- No hotkey sends (tests at 230–378 drive seams directly). No flips.

### src/config.test.ts

- 108–114: coercion test feeds `digitQuickSelect: {}` and expects `true`; 113–114 explicit `digitQuickSelect: false`. Remove/replace the field in fixtures; defaults assertions for `keys` (if any) change.

### src/config-surface.test.ts (systemic)

- Header matrix 19–25 (default/remap columns), avoided-keys prose 42–49, `DEFAULT_KEY_DATA` 89–95 (chord bytes), remap table 106–112 (`focusText: ctrl+y` etc.), spy map 130, focus map 143, digit spy 204, fixture round-trip 304–322, exhaustive remap 324–362 (incl. 348 `fire_from_text_focus_too_intercept_rule` — **inverts**: remapped bare keys forward from text focus), label tests 398–469 (footer strings now show bare letters; "no chord in dialog" regexes still fine), invalid-config sweep 472–516. Essentially every test's default column flips; `focusText`→`elaborate` rename across all tables.

### src/keymap-guard.test.ts (hits only — mechanics covered by another agent)

- 9, 14, 23, 26 (comment: fixed keys "enter/esc/arrows/digits intentionally absent"), 40 `"focusText"` action list, 55–73 avoided-keys table. Guard's premise (chord conflicts) mostly moot for letters; action list rename needed.

### src/no-hardcoded-keys.test.ts (hits only)

- 8, 10, 35, 41–42 (`CTRL_ANYWHERE = /ctrl\+[a-z0-9]/i`), 52, 167, 203–237 (fixture strings incl. `deep: "ctrl+d"` at 232/236–237). Bare-letter defaults likely need a NEW rule (letters can legitimately appear as text) — guard redesign flagged.

### Also affected (outside the listed 15 — flag)

- src/panel/deep-view.test.ts: 818, 843, 863(comment), 898 `panel.handleInput("\u0004")` (ctrl+d → deepSticky) → `"d"`.
- src/panel/ripple-confirm.test.ts: 390 `panel.handleInput("2")` digit quick-select → inert; 467 comment ctrl+t toggle-exit.

### Per-suite flip counts (approx. sites to edit)

| Suite | Sites |
|---|---|
| keys.test.ts | ~20 tests / ~60 assertions |
| actions.test.ts | 8 tests (digit suite 6 + matcher 2) |
| panel.test.ts | ~50 handleInput sites across ~30 tests |
| ac-panel.test.ts | 8 sites / 4 tests |
| ac-scripted.test.ts | 0 (comments only) |
| layout.test.ts | 3 fixture lines + 1 comment |
| overview.test.ts | 0 |
| discuss.test.ts | 3 sends + intercept-rule test |
| text-field.test.ts | 0 |
| two-stage.test.ts | ~13 sites |
| editor-preservation.test.ts | 0 |
| config.test.ts | 2 assertions |
| config-surface.test.ts | ~15 tests systemic |
| keymap-guard.test.ts | ~10 hits |
| no-hardcoded-keys.test.ts | ~10 hits |
| deep-view.test.ts | 4 sites |
| ripple-confirm.test.ts | 2 sites |

---

## 4. Other references (index.ts etc.)

- src/index.ts: only comment-level references — line 175 ("a `ctrl+s` can ship the pending answers"), line 259 ("the `ctrl+shift+q` chord closes windows…", historical, fine). No footer/keymap/chord literals in code (footer strings live in layout.ts / keys.ts, generated from config — README §Configuration "Labels follow config" line ~164). No changes forced in index.ts; scripts/verify-keymap-conflicts.sh (README:386) parses `DEFAULT_CONFIG.keys` and should be revisited by the config/keys owner.
- src/panel/keys.ts header ("Mode A — the intercept rule", cited at README:364) is the doc anchor for the new editor-focus forwarding rule.

## 5. Anomalies

1. **Editor-focus conflict**: the new contract (bare keys type in editor focus) directly inverts three documented/tested behaviors: keys.test.ts:278 (`test_text_focus_still_intercepts_panel_keys`), config-surface.test.ts:348 (`fire_from_text_focus_too_intercept_rule`), and keys.ts's "ungated" ctrl+shift+e intercept (discuss.test.ts:552). Decide how toggle-style actions (elaborate re-press exit, batchNote re-press exit) are exited while the editor holds focus (double-esc exists; ESC-002).
2. **`t` rename collision**: `focusText`→`elaborate` renames the KeyAction, config field, spy seam (`onFocusText`), and ~15 test helpers named `focusText`/`CTRL_T` — mechanical but wide.
3. **Letter conflicts with hjkl**: `h/j/k/l` are not among the config letters (d,o,t,m,e) so no direct collision today, but the collision-order test (keys.test.ts:445) should gain letter-vs-hjkl cases; a user remapping `deep` to `j` collides with the alias — resolution order needs spec.
4. **digitQuickSelect removal** also deletes a config field: config.test.ts coercion fixture, actions.test digit suite (6 tests), and README line 155 all reference it; keymap-guard.test.ts:26 comment says digits are "intentionally absent" from config — stays true.
5. **panel.test.ts:2852 and 1531/1570** send `\u0014` inline (not via the CTRL_T const) — easy to miss in a sed-style flip.
6. **no-hardcoded-keys guard** keys on `/ctrl\+[a-z0-9]/`; bare-letter defaults (`deep: "d"`) are indistinguishable from prose letters — guard needs a new strategy before the config flip.

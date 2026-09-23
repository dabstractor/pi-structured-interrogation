# Config, keymap guard, test infra, docs, binding policy — delta research map

Delta scope (from `plan/002_949db554a811/delta_prd.md`): write-in answers (`✎ Other` row, `answer.custom`), completeness auto-submit (footer flash `submitted — {n} answer(s)`), gate-hold warning line, surfacing gates. All refs below are exact at research time.

## 1. src/config.ts — resolved config shape, labels, string construction

**Resolved shape** — `interface InterrogatorConfig` (config.ts:115-138):
- `keys: Record<KeyAction, string>` — `KeyAction` union at config.ts:96-106: `"deep" | "overview" | "focusText" | "batchNote" | "submit" | "discuss" | "externalEditor" | "prevQuestion" | "nextQuestion"` (deliberately NO `breakOut`).
- `caps: CapsConfig` (config.ts:78-104): `description` 1200, `ramification` 600, `minDescription` 200, `minRamification` 120, `options` 7, `questions` 40, `goal` 400, `contextBudgetPct` 4.
- Toggles: `gateWarnings: true` (FR-9), `roundDetection: true`, `digitQuickSelect: true`, `compactionPreservation: true`.
- `editorMode: "composed" | "stock"` (default `"composed"`; `EditorMode` at config.ts:26-31).
- `escExitWindowMs: 500` (double-esc editor exit window, ESC-002; coerced `Math.max(0, …)`).
- `remote: RemoteConfig` (`enabled: true`, `resurface: true`) — config.ts:36-51.

`DEFAULT_CONFIG` at config.ts:152-190; default keys: `deep: "ctrl+d"`, `overview: "ctrl+l"`, `focusText: "ctrl+t"`, `batchNote: "ctrl+shift+m"`, `submit: "ctrl+s"`, `discuss: "ctrl+shift+e"`, `externalEditor: "ctrl+g"`, `prevQuestion: "tab"`, `nextQuestion: "shift+tab"`.

**Label helper** — `export function resolveKeyLabels(config: InterrogatorConfig): Record<KeyAction, string>` (config.ts:449-455). Internal `labelFor` (config.ts:432-446) normalizes one accelerator to display form ("ctrl+shift+m" → "Ctrl+Shift+M"). Memoized once per panel session at `panel.ts:598` (`this.labels = resolveKeyLabels(args.config)`; field declared panel.ts:515).

**String construction from labels** (current examples):
- `src/panel/layout.ts:426` — footer hints: `` const hints: string[] = keyActions.map((action) => `${labels[action]} ${ACTION_WORDS[action]}`) ``.
- `src/panel/layout.ts:442` — editor-exit close hint: `` editorExit.mode === "note" ? `${labels.batchNote} close` : `${labels.focusText} close` ``.
- `src/panel/layout.ts` `renderFooter(state, screen, labels, theme, width, narrow, editorExit?)` (layout.ts:415-466) is the footer builder; `panel.ts:1206` calls it with `this.labels`.

Exception: the suspend **widget line** (`src/panel/suspend.ts:127-131`, `buildSuspendWidgetLine`) contains NO key label by design: `` `${open} open · ${answered} answered — /interrogate to resume` `` (breakOut removal — widget must never name a chord).

**Flash mechanics**: `panel.flash(text)` (panel.ts:910), `FLASH_MS` ~2.5s (panel.ts:285); flashes never stack; gate warning wins over live flash in the shared transient slot (panel.ts:1172-1185); ripple keep/cancel suppresses both (panel.ts:1180). Current zero-pending flash in `src/panel/actions.ts:398-404` (the string the delta replaces — see strings ledger).

## 2. src/no-hardcoded-keys.test.ts — keymap guard mechanics

- Scans **every non-test `.ts` under `src/`** (`listSourceFiles`, recursive, skips `*.test.ts`).
- Violation regexes: `MODIFIER_STRING = /["'`](?:\s*)(?:alt|super)\+/i` (quote-anchored), `CTRL_ANYWHERE = /ctrl\+[a-z0-9]/i` (**anywhere**, catches " Ctrl+S"), `SHIFT_TAB = /shift\+tab/i`. Fixed keys (enter/esc/arrows/digits) are NOT matched.
- Pipeline: `stripComments` (string/template-aware, preserves literals and interpolation nesting) → `blankDefaultConfigBlock` (only `config.ts`'s `DEFAULT_CONFIG` literal is allowlisted, up to first top-level `\n};`) → `violationsIn`. Any match fails with file:line.
- **Consequence for the delta**: the new gate-hold line `⚠ {n} foundational unanswered — answer them or {submit} to submit now` MUST interpolate `labels.submit` (or similar) — writing "ctrl+s" literally in any runtime src file fails CI. Same for any flash/help string: produce key names only via `resolveKeyLabels(config)`. Comment mentions are safe (stripped), but keep comments config-relative in review.
- **src/keymap-guard.test.ts** (companion, different concern): pins that no `DEFAULT_CONFIG.keys` default sits on a TAKEN key (`AVOIDED_KEYS` list, keymap-guard.test.ts:54-76), every default matches accelerator grammar `/^([a-z0-9]+\+)*[a-z0-9]+$/`, and the keys map stays COMPLETE over exactly the 9 actions listed (`test_keys_map_stays_complete_over_all_ten_actions` — header comment says "10", code lists 9). New keymap entries must update `ALL_ACTIONS` and stay off the avoided list (keep in sync with `scripts/verify-keymap-conflicts.sh` + README "Keymap conflict re-verification" table at README.md:255-295).

## 3. focusText (ctrl+t) binding + toggle behavior

- Config key: `keys.focusText`, default `"ctrl+t"` (config.ts:161; README keymap table README.md:159).
- Router: `src/panel/keys.ts` — intercept is gated to `panel.view === "short" && panel.focus !== "note"` (keys.ts:~BUG-011 comment + `if (panel.view === "short" && panel.focus !== "note" && matchesKey(data, b.focusText))` in the route function). From deep/overview it falls through (BUG-011: would arm an invisible editor); in note focus it forwards to the note editor.
- Toggle behavior today: `defaultRoutedActions.onFocusText` (keys.ts) currently just sets `p.focus = "text"` — the true toggle (press in options focus to enter, press again to exit) is described as the ESC-002 deterministic companion and lives in the refined behavior (spec/ui-spec.md:53 says "default `ctrl+t`, toggle as today"); `panel.exitTextField()` is the write-through exit. Config keys are intercepted EVEN in text focus (h2.34 intercept rule), so ctrl+t works from inside the editor.
- Per spec/ui-spec.md:53 the delta reuses ctrl+t for EXPLAIN duty on the write-in/editor; when the cursor is on the Other row (or `type:"text"`), ctrl+t enters write-in duty instead — duty follows the cursor.

## 4. Test infra

- `package.json` scripts: `"test": "vitest run"`, `"typecheck": "tsc --noEmit"`.
- `vitest.config.ts` (complete): `import { defineConfig } from "vitest/config"; export default defineConfig({ test: { passWithNoTests: true } });` — no setup files, no aliases, no globals.
- Test file count: **48** `*.test.ts` files under `src/` (panel tests live alongside sources in `src/panel/`).
- Run a single file: `npx vitest run src/config.test.ts` (or any path, e.g. `npx vitest run src/panel/short-view.test.ts`). No flags needed.
- Node >= 22.19.0 (`engines`); deps vitest ^1, typescript ^5.

## 5. plan/001_0d6760db6bc5/AUTOMATION-POLICY.md — binding constraints

Hard rule: **no live interactive verification**. Automated runs must NEVER: (1) call the `interrogate` tool for real (it surfaces questions to a human and deadlocks the pipeline); (2) start an interactive `pi`/`pi -e .` TUI session and drive it by hand; (3) treat PRP "Level 3/4 live/manual/observe" instructions as permission to go live (scripted alternatives always win); (4) end a turn waiting for user input as a verification step ("panel is up — waiting for your choice" is a failure mode).
Instead: prove ACs by scripted vitest tests against exported functions with fake `ctx`/`tui` (pattern: `src/panel/panel.test.ts`); call `executeInterrogate(...)`/debug-command handlers directly and assert envelope + `serialize()`; render via component `render(width)` with `visibleWidth` sweeps at 40/60/80/120 cols; headless `pi -p` for end-to-end. Interactive-only ACs defer to the human-only MANUAL-TUI-AC-RUNBOOK.md. Incident record (2026-09-13) documents a subtask marked Failed after a live upsert stalled the pipeline.

## 6. README.md touchpoints (359 lines)

Heading outline (grep '^#'):
- `1:# pi-interrogator`, `11:## Install`, `30:## Usage`, `98:## Configuration`, `151:## Keymap`, `199:### Subcommands (one command, no autocomplete noise)`, `214:## Limitations`, `235:## Development`, `255:### Keymap conflict re-verification`, `326:## Project structure`.
- Hotkey table: README.md:151-162 region (rows at 159-162; header ~154-158). Config reference: 98-150 (JSON example with keys at 107-114). Features/capabilities: Usage 30-97 (auto-open 34, ctrl+t 36, ctrl+s 42, two-stage removed-era explain note 181-184). Limitations (drafts not persisted): 214-234. No literal "acceptance criteria"/AC section; AC-adjacent: Development 235+ and Keymap conflict re-verification 255-295.

grep hits for the delta terms:
- `auto-open`: **34** — "panel **auto-opens** on the first upsert." (Usage); also 347 (Project structure comment "reconstruction: session start (auto-open,…)").
- `ctrl+t`: **36** (Usage: "press `ctrl+t` to focus"), **111** (config example `"focusText": "ctrl+t"`), **159** (keymap table row: "Toggle the free-text editor: focus it, or (already focused) close it — draft saved, back to options"), **274** (conflict table: "panel-safe reuse").
- `ctrl+s`: **42** (Usage: "Press `ctrl+s` to submit. Partial submissions are fine"), **113** (config example), **161** (keymap table Submit row), **275** (conflict table).
- `explain`: **181, 184** (Usage: 'The free-text "explain" field is an **elaboration, not an answer of its own**… on `type:"text"` questions the editor IS the answer').
- `two-stage`: **no hits in README.md** (machinery described only in spec/src).
- `✎`: **no hits in README.md** (glyph usage is src-only — see §7).
- `advanceArmed`: **no hits in README.md** (spec/ui-spec.md:58 says the machinery is REMOVED by this delta).
- Related: 38/160/277 `ctrl+shift+m` (batch note), 51 (breakOut removal note), 291-295 (taken-key table rows the delta must keep in sync if keys change — they don't).

## 7. `✎` glyph usage in src/ (runtime + tests)

- `src/panel/short-view.ts:64` — `const EXPLAIN_AFFORDANCE = "✎ explain…";` (the affordance the delta repurposes: the Other row takes its slot).
- `src/panel/short-view.ts:16` — marker legend: "`✎` free-text affordance / has-text answer"; `:4,45,108,117,132,135,142,214,235-237` — cursor domain (`✎` = last row, index `options.length`), layout of the `✎ explain…` / `✎ answer…` line, prefix+placeholder composition.
- `src/panel/deep-view.ts:21,201,390,452` — deep view has NO `✎` (belongs to short form; deep cursor domain excludes it). NOTE: spec/ui-spec.md:19 now adds a synthetic `✎ Other — write your own` section in DEEP view with the extension-supplied ramification (delta change).
- Tests pinning glyph: `src/panel/short-view.test.ts:168-208` (`"  ▸ ✎ explain…"`, `"  ▸ ✎ answer…"`), `src/panel/panel.test.ts:455,556,1250,1765`, `src/panel/two-stage.test.ts:244-252` (the removed-by-delta two-stage flow), `src/panel/actions.test.ts:174-189,259,363,655`, `src/panel/deep-view.test.ts:391`.
- `src/renderers.ts` (message renderer): per spec/ui-spec.md:129 write-in answers on the submission card render as `✎ {text}` (truncated, expanded shows full).

## 8. spec/ui-spec.md — verbatim final strings (see ledger below)

Sources: Other-row deep-view ramification ui-spec.md:19; editor region labels ui-spec.md:52-53, 78; auto-submit flash + gate-hold ui-spec.md:67-72 (§Auto-submit); zero-pending flash ui-spec.md:56, 139. All quoted verbatim in the ledger.

## 9. tsconfig.json / typecheck

`{"compilerOptions": {"strict": true, "target": "es2022", "module": "esnext", "moduleResolution": "bundler", "noEmit": true, "skipLibCheck": true, "esModuleInterop": true, "types": ["node"]}, "include": ["src/**/*"]}`. `npm run typecheck` (tsc --noEmit) must pass with `strict: true` across all of `src/**/*` (tests included via include). ESM (`"type": "module"`), imports use `.js` suffixes.

## 10. plan/002_949db554a811/ contents

Exists with: `architecture/` (**empty** — this doc is its first content), `delta_from.txt`, `delta_prd.md`, `prd_index.txt`, `prd_manifest.txt`, `prd_snapshot.md`. No prior architecture/task docs — this file is the starting point for downstream agents.

## Final strings ledger (use VERBATIM)

| String | Verbatim text | Spec source |
|---|---|---|
| Other row label (short view, cursor domain) | `✎ Other — write your own` | ui-spec.md:52 ("the synthetic **`✎ Other — write your own`** row") |
| Other section (deep view) | `✎ Other — write your own` | ui-spec.md:19 |
| Other-row deep-view ramification | `None of the listed options fit — write your own answer; it ships as the official answer for this question, not as an attachment to one of them.` | ui-spec.md:19 |
| Write-in editor region label | `OTHER — this text is the answer` | ui-spec.md:52 |
| Elaboration editor region label | `EXPLAIN — attaches to your selection` | ui-spec.md:53 |
| Note mode region label | `NOTE — ships with next submission` | ui-spec.md:78 |
| Auto-submit footer flash | `submitted — {n} answer(s)` | ui-spec.md:71 |
| Gate-hold warning line | `⚠ {n} foundational unanswered — answer them or {submit} to submit now` — `{submit}` interpolates `resolveKeyLabels(config).submit`; any key dismisses; never blocks | ui-spec.md:72 |
| Zero-pending flash (no drafts) | `nothing to submit` | ui-spec.md:139 |
| Zero-pending flash (held drafts, replaces actions.ts:398-404 string) | `nothing to submit — {n} question(s) have drafts awaiting an option or Other` | ui-spec.md:56, 139 |
| Ripple warning (unchanged, must not regress) | `⚠ Invalidates {n} answered questions ({ids}) — enter=keep, esc=cancel` | ui-spec.md:82 |
| Old gate warning (pre-delta submit-time, ui-spec.md:21 `⚠ {n} foundational unanswered — later answers may shift`) | superseded at commit-time by the gate-hold string above; check delta_prd.md for whether the submit-time variant survives | ui-spec.md:21 vs :72 |
| Write-in card rendering | `✎ {text}` (truncated to fit; expanded shows full) | ui-spec.md:129 |
| Widget line (unchanged) | `{open} open · {answered} answered — /interrogate to resume` | src/panel/suspend.ts:127-131 (no key label, by policy) |

Guard reminder: every `{submit}`-style key mention in runtime code must come from `resolveKeyLabels`; literal "ctrl+s"/"ctrl+t" outside `DEFAULT_CONFIG` fails the no-hardcoded-keys guard.

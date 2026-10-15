# Research notes — P1.M4.T1.S2: Scripted AC coverage, keymap-conflict re-verification, full gates

## The AC set being proven (delta_prd.md §3 — NOT the legacy numbered ACs in ac-panel.test.ts)

AC-1..AC-6 of THIS changeset (keymap trilogy). ac-panel.test.ts's "AC-1..AC-12" labels are the LEGACY product ACs — do not conflate; new coverage goes in a clearly-named describe or new file keyed to the delta ACs.

- AC-1: from non-editor focus d/o/t/m/e dispatch; while editor-focused each letter TYPES; ctrl+s still submits from text focus; ctrl+g still opens $EDITOR.
- AC-2: hjkl per-view navigation (short: options/questions; deep: selection; overview: cursor row), clamping, typing while editor-focused, absent from config schema.
- AC-3: 1–9 inert at panel level; digits type in editor; digitQuickSelect absent from schema AND settings load.
- AC-4: legacy `keys.focusText` settings still bind elaborate (compat alias); keys.elaborate drives action + footer label; focusText gone from types/tables.
- AC-5: re-pressing t/m while editor-focused types (no toggle); prompts close via enter/double-esc only.
- AC-6: gates green + conflict re-verification recorded.

## Simulation styles (readme-and-test-flows.md §2, verified)

- Style A (router level): `route(data, panelStub)` where panelStub is `{focus, view, ...}` + RoutedActions of vi.fn spies; assert consumed true/false + which spy fired. keys.test.ts has the harness (`makeRouter`/DEFAULT_DATA conventions, actions registry at :92-158).
- Style B (full panel): construct InterrogationPanel (stub theme/TUI, real state), `panel.handleInput(data)`; editor focus via `panel.focusTextField("writein"|"elaboration")` (panel.ts:1188) or `panel.enterNoteMode()` (panel.ts:1262) — bare keys can't enter these from editor focus anymore. Rendered-component variant: `firstCall(mock).component.handleInput(data)`.

## Key seams verified in source

- keys.ts two-tier intercept: `isBareBinding` (line ~218) — tier 2 letters forward in editor focus (route returns false); chords always intercept. `externalEditor` gated `focus === "text"` (line 565); bare externalEditor binding forwards (:566). hjkl = exact bare-byte matches riding the arrow branches (fixed family).
- panel.ts `openExternalEditor()` (line ~1312): reads draft, `tui.stop()`, `editInExternalEditor({command: resolveExternalEditorCommand(), content})`, replaces on `status === "complete"`, finally restarts TUI. Test seam: `editInExternalEditor` in src/external-editor.ts — external-editor.test.ts mocks `node:child_process.spawn` with `vi.mock` + fake child recording spawn args (line 24/38) and sets `process.env.VISUAL`/`EDITOR`. Mock at the SPAWN level (existing precedent) or spy on `editInExternalEditor` — either is established; spawn-mock is the deeper proof (asserts $EDITOR actually opened with the draft).
- ctrl+s submit from text focus: ac-scripted.test.ts:739 sends `\u0013` (ctrl+s) — keep byte. Submit needs SubmitDeps (delivery seam) — actions.test.ts/panel.test.ts conventions for mock delivery.
- Footer labels: `resolveKeyLabels(config)` (config.ts) renders from config — layout.test.ts footer assertions pattern.
- Config schema absence: KeyAction union (config.ts:51) — no hjkl/digitQuickSelect members; settings load = `loadConfig`/`coerceConfig` (config.test.ts:42 full-defaults equality pattern; :106 toggles coercion).

## Guard tests (config-surface.md §5, verified)

- src/no-hardcoded-keys.test.ts: scans non-test .ts, stripComments + blankDefaultConfigBlock; regexes are CHORD-shaped (ctrl+…, alt+/super+, shift+tab) — bare letters never match; NO edits needed beyond whatever P1.M1.T1.S1's rename already did. Green = pass.
- src/keymap-guard.test.ts: (1) defaults ∉ AVOIDED_KEYS — letters pass; (2) grammar regex `^([a-z0-9]+\+)*[a-z0-9]+$` — letters pass; (3) ALL_ACTIONS completeness — focusText→elaborate rename (P1.M1.T1.S1 owned; verify green); (4) curation hygiene. KNOWN GAP (system_context.md:31, recorded out of scope): neither guard checks fixed-key or intra-map collisions — do NOT extend guards in this task.
- digits/ hjkl absence from schema can be asserted cheaply in keymap-guard or the new AC file: `expect(Object.keys(DEFAULT_CONFIG.keys))` contains no hjkl; `"digitQuickSelect" in resolved` === false.

## scripts/verify-keymap-conflicts.sh (read in full)

- Parses DEFAULT_CONFIG.keys via sed of `action: "accelerator"` lines (works for bare letters — grammar unchanged).
- Checks each default against AVOIDED list (all chords — bare letters can't hit) + live `registerShortcut("` grep across EXT_TREES + pi built-in docs (INFO only).
- For bare letters: expected result = every letter row "clear" (no live extension registers a bare-letter global shortcut; even if one did, panel owns keyboard — but flag it). Update needed where? The script's header/exit-summary comments describe chord-era rationale ("ctrl+d/l/t/s/g defaults") — refresh the [Mode A] comment block: bare letters collide with nothing by construction (panel-owned keyboard, no global shortcut registered); ctrl+s/ctrl+g remain the only chord defaults. Possibly extend the summary output to note the two-tier rule. Keep the AVOIDED list (guards REBINDS onto chords).
- RECORD output: save the run's output into plan notes? No — the PR notes consume it; the task should emit it to stdout and the implementer records it in the PR/commit message (and P1.M4.T2.S1 rewrites the README section). Do NOT write README here (P1.M4.T2.S1 owns).

## Where each AC test goes

- New file `src/panel/keymap-ac.test.ts` (or describe blocks in keys.test.ts/ac-panel.test.ts — prefer a dedicated file so the delta-ACs are greppable): Style A for dispatch/typing matrix; Style B + spawn-mock for ctrl+g; config.test.ts-style assertions for AC-3 schema absence and AC-4 alias; panel.test.ts note/elaborate suites already own enter/double-esc exits (verify + fill gaps only).
- Existing coverage from S1's flipped suites already proves much of AC-1/AC-2/AC-5 incidentally — S2 adds tests ONLY where none exist (grep first; the contract says so).

## Gates

npm test · npm run typecheck · both guard suites · bash scripts/verify-keymap-conflicts.sh (exit 0).

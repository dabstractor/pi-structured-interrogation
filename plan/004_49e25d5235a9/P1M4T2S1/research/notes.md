# Research notes — P1.M4.T2.S1: README rewrite for the keymap trilogy

## Verified current state (HEAD, post-trilogy implementation)
- `src/config.ts`: `KeyAction` includes `"elaborate"` (:51, :94); defaults landed
  `deep:"d" :109, overview:"o" :110, elaborate:"t" :111, batchNote:"m" :112, discuss:"e" :114`
  (submit/externalEditor/prev/next unchanged — ctrl+s / ctrl+g / tab / shift+tab).
  Silent `focusText`→`elaborate` compat alias in coerceKeys (:194-205). NO `digitQuickSelect`
  anywhere in config.
- `src/panel/keys.ts`: hjkl wired into the fixed branches (:440-465), exact bare-byte match
  (`data === "k"` etc.), editor-focus gating (`!editorFocused`), header comment cites h2.74.
- The full README stale map lives in
  `plan/004_49e25d5235a9/architecture/readme-and-test-flows.md` §1 (line-numbered tables for
  every stale region: Usage :33-68, Configuration :137-155, Keymap :173-233, Acceptance
  :261/:277, conflict section :320-389; plus the §1b grep-hit table listing every line).
- Authoritative NEW content source: PRD h2.35 (hotkey table + two-tier intercept prose +
  conflict-avoidance paragraph + fixed-key notes) and h2.55 (config reference sample with the
  9 keys). These should be adapted, not invented.
- P1.M4.T1.S2 (parallel, treat as landed) produces: `bash scripts/verify-keymap-conflicts.sh`
  exit 0 output recorded for the PR notes (bare letters clear; ctrl+s/ctrl+g unchanged), plus
  `src/panel/keymap-ac.test.ts` delta-AC coverage. The README conflict section's re-verification
  date/evidence block must be refreshed FROM that recorded output.
- README has NO table of contents — no anchors to maintain. 424 lines at HEAD.
- spec/*.md is synced separately (spec/decisions.md already contains the 2026-10-12 ruling) —
  README task must NOT edit spec/.

## The GATE (verbatim from item contract)
`grep -n "ctrl+t\|ctrl+d\|ctrl+l\|focusText\|digit" README.md` must return ZERO lines — the
word "digit" may not appear AT ALL (no "digits", "digitQuickSelect", nothing). Number-key
inertness must be phrased without it, e.g. "number keys do nothing at panel level — they only
type where typing is possible (inside the editor)".

## Content decisions to bake into the PRP
- Usage item 2 (the big "Answer in the panel" paragraph): keys become `d`/`o`/`t`/`m`/`e`;
  quick-select sentence deleted; answer-pinning prose re-phrased to `enter` only (no digit);
  "different digit" → "a different choice"; elaborate is entered with `t` and named
  "elaborate"; re-press-to-close is GONE — close via `enter` or double-`esc`.
- Sample settings.json: exactly the 9 keys of h2.55 with inline comments; delete the
  `digitQuickSelect` line; note the silent `focusText`→`elaborate` legacy alias (config.ts:194).
- Keymap tables: remappable table = 9 rows with new defaults; `elaborate` row's effect prose
  rewritten (no toggle language — it enters the editor, duty by context; closes via
  enter/double-esc). Fixed table: enter / esc / ctrl+c / ↑↓+k j / ←→+h l rows; digit row
  replaced by nothing (or a "number keys are inert" line inside the two-tier prose).
- Two-tier intercept prose (h2.35 verbatim adaptation): chords (ctrl+s, ctrl+g) intercept
  everywhere incl. editor focus; bare keys (config letters + hjkl) intercept only from
  non-editor focus and always type while the editor holds focus; single esc and ↑/↓
  forward to the editor (ESC-002).
- Fixed-key documentation must note: remapping a CONFIG key ONTO a fixed key (e.g.
  `deep: "j"`) is deterministically shadowed by the fixed branch — document as
  non-configurable + shadowing note.
- Conflict section: keep the avoided-keys tables (ctrl+b etc. — unchanged), rewrite the
  verified-defaults table to the 9 new defaults (bare letters: panel-scope only, collide
  with nothing global by construction), refresh date/evidence from P1.M4.T1.S2's recorded
  output, rewrite the panel-intercept rationale for the two-tier rule, keep the
  verify-keymap-conflicts.sh regression-guard block (script exists at scripts/, updated by
  P1.M4.T1.S2).
- Acceptance refs :261 (2b ctrl+t → t) and :277 (AC-16 "enter/digit" → "enter"); also :51/:54/:59
  in Usage prose. AC-16 wording: same-value `enter` is a zero-state-change advance; byte-identical
  write-in re-commit inert.

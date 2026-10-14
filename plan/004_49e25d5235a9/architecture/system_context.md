# System context — delta 004: keymap trilogy (VIMNAV-001 / BAREKEYS-001 / DIGIT-OUT-001)

## Repo & stack (verified 2026-10-14, HEAD 182f4ce)
- `pi-interrogator` — TypeScript extension for the pi coding agent (`package.json`: `main: src/index.ts`).
- UI: custom panel TUI on `@earendil-works/pi-tui` (Key / matchesKey / parseAccelerator / parseKey primitives); schema `typebox`; vitest; `npm test` = `vitest run`, `npm run typecheck` = `tsc --noEmit`.
- Spec corpus in `spec/` was synced to the target contract by commit `8c5f870` ("No source moves") — **spec/*.md are READ-ONLY for this delta**; report spec errors, never edit.

## What this delta is (and is NOT)
- The PRD diff bundles 12 decision changes; **11 are already shipped in source** (TRUST-001 `3779383`, DEEP-PIN-002 `6e383c2`, DEEP-PIN-003 `3779383`, GOAL-OUT/MIRROR-SILENT/DEEP-FULL `e6e2f3a`, CAPS-OUT `e6e2f3a`, DEEP-STICKY `2b174b1`, DEEP-LAND `182f4ce`, BUG wave via plan 003). Cite them, do not rebuild, do not re-verify beyond the suite staying green.
- This delta = the **2026-10-12 keymap trilogy only**: bare-letter defaults + `elaborate` rename + two-tier intercept + gesture removal (R1), `hjkl` fixed aliases (R2), digit quick-select removal (R3), README/changeset docs (R4, Mode B).
- No state-machine, lifecycle, rendering, delivery, or spec work.

## Verified gap map (research files in this directory — line numbers real at 182f4ce)
- `config-surface.md` — KeyAction union (:48, `focusText` :51), KEY_ACTIONS (:93-103), defaults (:111-119, chords), `digitQuickSelect` (:80/:123/:222/:287), `coerceKeys` (:195-202, **no alias precedent — alias must be added fresh**), loadConfig JSDoc tables (:269-287), guard mechanics (no-hardcoded-keys needs NO edits; keymap-guard ALL_ACTIONS :24-34 must rename), tests-to-flip tables.
- `keys-and-actions.md` — `buildKeyRouter` resolution order (keys.ts :355-523): fixed ↑/↓ (:382-391) → ←/→ (:401-410, editor-gated) → esc/double-esc (:419-435) → enter (:446-450) → config intercepts (:455-506, currently ONE-tier) → digits (:508-519) → forward. Elaborate re-press toggle lives in the **panel.ts:645-648 override** (not the keys.ts default); note toggle keys.ts:322-328. Footer `renderFooter` (layout.ts :478-530) currently **swaps** the explain hint for close hints while editor-focused — spec requires **drop**. Verbatim spec quotes (ui-spec :70/:84/:88/:92/:94/:116, decisions :112-116, FR-8/11/12/13/35).
- `readme-and-test-flows.md` — README stale map (~35 hits, sections at :30/:130/:173/:251/:320-389, **no TOC**), raw-byte key-simulation patterns (router-level `route(data, stub)` vs full-panel `handleInput(data)`), per-suite flip inventory (panel.test.ts ~50 sites incl. **inline `\u0014` at :1531/:1570/:2852**, keys.test ~20 tests, config-surface systemic, two-stage ~13, etc.).

## Target contract (authoritative wording in spec, quoted in keys-and-actions.md §8)
- Defaults: `deep:"d"`, `overview:"o"`, `elaborate:"t"`, `batchNote:"m"`, `discuss:"e"`; survivors `submit:"ctrl+s"` ("submit must fire from text focus — a bare `s` could never be typed") and `externalEditor:"ctrl+g"` ("only valid context is editor focus, where a bare key must type"); `tab`/`shift+tab` unchanged.
- Two-tier intercept: modifier-bearing (and generally non-printable) config values intercept in EVERY focus state; single-printable-char ("bare") values and fixed `hjkl` intercept only from non-editor focus and forward (return false → panel hands the byte to the composed editor) while `focus === "text" || "note"`.
- `hjkl` fixed, non-configurable, same branch/gates/dispatch as the arrows; `k/j` with `↑/↓`, `h/l` with `←/→`.
- Digits inert at panel level (no accept/advance/state change); they only type where typing is possible. `digitQuickSelect` gone from schema + settings load (unknown fields already vanish via `coerceConfig`'s field-by-field rebuild).
- Gestures: re-press-to-close toggles for elaborate/note die; closes are `enter` and double-`esc` (`escExitWindowMs`) only. Footer carries `{elaborate} explain`, dropped — never swapped — while the editor holds focus.
- Compat: settings `keys.focusText` maps silently onto `elaborate` (explicit `elaborate` wins).

## Planning rulings (decisions baked into tasks.json)
1. **Rename atomicity**: the `focusText`→`elaborate` identifier rename must land as ONE subtask across config.ts + keys.ts dispatch/RoutedActions + panel.ts override + layout label maps + keymap-guard ALL_ACTIONS + test fixtures, with chord VALUES unchanged — otherwise typecheck breaks mid-milestone. `panel.focusTextField()/exitTextField()` and `desiredTextDuty` are NOT renamed (editor mechanics, not the config key). Routed-action seam `onFocusText` → `onElaborate`.
2. **Defaults + two-tier land together**: flipping values while the intercept is one-tier would pin wrong behavior; one subtask owns both plus the directly-owning test inversions (keys.test :278/:508, config-surface :348).
3. **Tier classifier**: TIER-2 (forward while editing) iff the normalized binding is a single printable character; everything else (chords, `tab`, f-keys like `f9` remaps) is TIER-1 (intercepts everywhere — a non-printable key is never a typed character).
4. **Remap-onto-fixed-key shadowing** (user sets `deep:"j"`): deterministic — the fixed branch runs before config intercepts, so the fixed key wins. Out of scope to change; DOCUMENT in README (M4.T2.S1) and leave keymap-guard unextended.
5. **Known guard gap (recorded, out of scope)**: neither guard checks config-vs-fixed-key or intra-map collisions; no-hardcoded-keys cannot catch hardcoded bare labels (regexes are chord-shaped). AC-6 only requires the guards green with the new defaults.
6. **README grep gate**: PRD requires `grep "ctrl+t\|ctrl+d\|ctrl+l\|focusText\|digit" README.md` → zero — the **word "digit" may not appear at all**; phrase number-key inertness without it.
7. **Suite strategy**: implementing subtasks flip the tests that pin their seam; cross-cutting scripted suites (panel/ac-panel/two-stage/deep-view/ripple-confirm/discuss/layout residuals) flip in a final stabilization task once all three changes have landed (plan-003 precedent).

## Prior research still binding
- `plan/003_f8af1c6f6c49/architecture/testing-verification.md` — green gates verbatim (full suite, typecheck, no-hardcoded-keys, keymap-guard); scripted-vitest-only policy.
- `plan/003_f8af1c6f6c49/architecture/panel-ui-seams.md` — accept paths / ripple seam / same-value no-op contracts referenced by FR-35 comment purge (anchors drifted; locate by content).

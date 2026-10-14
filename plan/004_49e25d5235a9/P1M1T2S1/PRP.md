# PRP — P1.M1.T2.S1: Flip defaults to d/o/t/m/e and tier intercepts on modifier presence in buildKeyRouter

## Goal

**Feature Goal**: Implement BAREKEYS-001's defaults + intercept halves (h2.74/h2.35): `DEFAULT_CONFIG.keys` becomes `deep:'d', overview:'o', elaborate:'t', batchNote:'m', discuss:'e'` (submit/externalEditor/prev/next unchanged), and `buildKeyRouter` step 7 (keys.ts:455-506) becomes TWO-TIER: bare config keys (single printable char, no modifier) intercept only from NON-editor focus (`focus !== "text" && focus !== "note"`) and always forward while the editor holds focus (typing `t` inserts a `t`); modifier chords intercept in every focus state.

**Deliverable**: Modified `src/config.ts` (defaults + JSDoc keys table), `src/panel/keys.ts` (tier gating + module doc rewrite :11-19/:60-76), and test flips in `src/panel/keys.test.ts` + `src/config-surface.test.ts` (+ `src/config.test.ts` default assertions). spec/*.md READ-ONLY.

**Success Definition**:
- `npm run typecheck` + full `npm test` green
- Letters `d/o/t/m/e` dispatch from options/deep/overview (non-editor) focus; letters forward (`route===false`, editor buffer receives the byte) in BOTH text and note focus
- `ctrl+s` still submits from text focus; `ctrl+g` still opens the editor from text focus (mocked $EDITOR seam)
- A remap to a chord (e.g. `deep:'ctrl+alt+d'`) intercepts in text focus; a remap to a bare key forwards
- Fixed branches (↑/↓/←/→/esc/enter, steps 3-6) byte-untouched; elaborate keeps the BUG-011 short-view gate; config keys still fire from deep/overview non-editor focus (keys.test :760/:910 green)

## Why

h2.74/BAREKEYS-001: panel-action defaults lose their chords — the panel owns the whole keyboard while open (`custom()` raw-input dispatch), so bare letters cost nothing and collide with nothing. The intercept rule necessarily becomes two-tier: a chord is never a typed character, but a bare key MUST type while the editor holds focus — otherwise `t` in an answer could never be typed. The two surviving chords are load-bearing (quote decisions :113-115 in JSDoc): `ctrl+s` submit ("submit must fire from text focus — a bare `s` could never be typed") and `ctrl+g` external editor ("its only valid context is editor focus, where a bare key must type — a bare `g` would be permanently unpressable").

## What

1. **Defaults** (config.ts:111-119, post-S1/S2 rename shape): `deep:'d', overview:'o', elaborate:'t', batchNote:'m', discuss:'e'`; `submit:'ctrl+s', externalEditor:'ctrl+g', prevQuestion:'tab', nextQuestion:'shift+tab'` unchanged. JSDoc keys table (:271-280) default column updated + the two chord reasons quoted.
2. **Tier gating** in keys.ts step 7: for each resolved binding, classify TIER-2 iff its normalized KeyId is a single printable character (use the existing `SINGLE_CHAR_BASES`/`parseAccelerator` machinery — e.g. helper `isBareBinding(accel)`); TIER-2 intercepts only when `!editorFocused` (the flag already computed at :367) — otherwise fall through (no match → `return false` → panel.ts hands the byte to the composed editor). TIER-1 (any modifier chord, tab, f-keys) intercepts everywhere, as today. Fixed branches untouched; externalEditor keeps its `focus === "text"` gate; elaborate keeps the BUG-011 `view === "short" && focus !== "note"` gate (the tier rule adds note-focus forwarding for the now-bare `t`, consistent); digit branch untouched (P1.M3 deletes it).
3. **Doc rewrite** (Mode A): keys.ts module doc :11-19 (currently documents the ONE-tier "intercepts INCLUDE text focus" rule) and the resolution-order block :60-76 — both rewritten to the two-tier rule, quoting ui-spec:70's wording: bare keys "intercept only from non-editor focus and always forward while the editor holds focus".

### Success Criteria

- [ ] Defaults match h2.35's table exactly (d/o/t/m/e + 4 surviving entries)
- [ ] Bare config keys forward in text AND note focus; chords intercept in both
- [ ] Inverted tests flipped: keys.test.ts:278 `test_text_focus_still_intercepts_panel_keys` and :508 ctrl_shift_m-every-focus now assert FORWARDING for bare / INTERCEPTING for chords; config-surface.test.ts:348 fire_from_text_focus updated
- [ ] Default fixtures updated: keys.test.ts DEFAULT_DATA :39-50 and config-surface.test.ts :88-98 — control bytes (`\u0004`, `\u000c`, `\u0014`, `\u001b[109;6u`, `\u001b[101;6u`) → `'d','o','t','m','e'`
- [ ] New tests: letters dispatch from options/deep/overview; letters forward in text+note; ctrl+s submits from text focus; ctrl+g opens mocked $EDITOR; remap-to-chord intercepts in text focus; remap-to-bare forwards
- [ ] Fixed keys, elaborate BUG-011 gate, deep/overview non-editor firing all regression-green

## All Needed Context

### Context Completeness Check

Repo fully implemented, suites green; S1 (focusText→elaborate rename) and S2 (compat alias) land first — this subtask assumes the post-rename shape. All line references verified against the working tree; the architecture doc holds verbatim excerpts. Agent needs this PRP plus `src/config.ts`, `src/panel/keys.ts`, `src/panel/keys.test.ts`, `src/config-surface.test.ts`, `src/config.test.ts`.

### Documentation & References

```yaml
- file: plan/004_49e25d5235a9/architecture/keys-and-actions.md
  why: "THE research doc — §1 current one-tier rule (module doc :11-19, :60-76 rewrite sites), §2 verbatim resolution order (step 7 = keys.ts:455-506 with the BUG-011 gate at :463-471), §4 forwarding mechanism (return false → panel.ts hands byte to editor), §8 verbatim spec quotes (ui-spec:70 two-tier, decisions :113-115 chord reasons)"
  critical: "§2 step 7 is the ONLY branch family to change; steps 3-6 fixed keys and step 8 digits are other subtasks' scope"

- file: plan/004_49e25d5235a9/P1M1T2S1/research/notes.md
  why: condensed verified excerpts — current DEFAULT_CONFIG, step-7 code, SINGLE_CHAR_BASES/parseAccelerator anchors, test-invert list, design decisions

- file: plan/004_49e25d5235a9/P1M1T1S1/PRP.md + P1M1T1S2/PRP.md (CONTRACTS)
  why: "S1 renames focusText→elaborate (dispatch seam onElaborate/onFocusText per its spec — use the post-rename names); S2 adds the silent focusText alias — do not disturb it when flipping defaults"
  gotcha: "S2's alias tests assert against DEFAULT_CONFIG.keys.elaborate (value-agnostic) — the 't' flip must not break them"

- file: src/config.ts
  why: "defaults :111-119, JSDoc table :271-280, coerceKeys/alias (untouched)"
  gotcha: "flip ONLY the five values; submit/externalEditor/prev/next/tab stay byte-identical"

- file: src/panel/keys.ts
  why: "step 7 :455-506 + module docs :11-19/:60-76 + SINGLE_CHAR_BASES :133 / parseAccelerator :137-159 / resolveBindings :171-188 + editorFocused :367"
  pattern: "bare detection: reuse the existing single-char grammar — do NOT hand-roll regexes over raw bytes"

- file: src/panel/keys.test.ts / src/config-surface.test.ts
  why: "fixtures/inversions: DEFAULT_DATA :39-50, :278, :508, config-surface :88-98/:348; keep-green :760/:910; external-editor $EDITOR mock seam per existing external-editor tests"
  gotcha: "note focus needs explicit forwarding tests too — the tier rule covers BOTH editor duties (text and note)"
```

### Current Codebase tree (relevant excerpt)

```bash
src/
├── config.ts                # MODIFY: defaults + JSDoc
├── panel/keys.ts            # MODIFY: tier gating + doc rewrite
├── panel/keys.test.ts       # MODIFY: fixture + inversion flips + new tests
├── config-surface.test.ts   # MODIFY: fixture + inversion flip
└── config.test.ts           # check/adjust default assertions only
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: tier classification keys off the RESOLVED binding (normalize once
//   at resolveBindings time — compute isBare per binding up front, not per
//   keystroke), not the raw config string; a remap must instantly change tier.
// CRITICAL: bare keys must FORWARD (return false), not be swallowed —
//   forwarding is the no-match fall-through; panel.ts hands the raw byte to
//   the composed editor. Never "consume and ignore" a bare key in editor focus.
// GOTCHA: editorFocused flag exists at keys.ts:367 — reuse it; don't re-derive.
// GOTCHA: externalEditor's own gate (focus === "text") stays — the tier rule
//   does NOT open ctrl+g in options focus.
// GOTCHA: elaborate is now bare 't': the tier rule's editor-focus forward
//   REPLACES any re-press-toggle reachability — but the toggle REMOVAL itself
//   is S2's; only ensure 't' from text/note focus forwards (it must type).
// GOTCHA: digit branch (step 8) still exists and still has its own
//   text/note gating — untouched here, deleted in P1.M3.
// GOTCHA: keys.test fixtures use control-byte sequences for the old chords —
//   plain 'd'/'o'/'t'/'m'/'e' strings parse fine through matchesKey; verify
//   each flipped fixture still drives the intended action.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: FLIP DEFAULT_CONFIG (src/config.ts:111-119)
  - deep: "d", overview: "o", elaborate: "t", batchNote: "m", discuss: "e"
    (post-S1/S2 rename field name); other five entries byte-unchanged
  - UPDATE JSDoc keys table :271-280 default column + quote the two chord
    reasons from decisions :113-115 (Mode A)

Task 2: IMPLEMENT tier classification + gating (src/panel/keys.ts)
  - ADD helper isBareBinding(accel: string): boolean — true iff the
    normalized accelerator is a single printable char with no modifier
    (reuse SINGLE_CHAR_BASES/parseAccelerator grammar)
  - COMPUTE per-binding tier once (alongside resolveBindings or at
    buildKeyRouter setup): bareDeep/bareOverview/bareElaborate/bareBatchNote/
    bareDiscuss/bareSubmit...
  - IN step 7, for each intercept: `if (matchesKey(data, b.X)) { if (bareX && editorFocused) return false; actions.onX(panel); return true; }`
    (externalEditor/prev/next keep their existing gates; elaborate keeps
    BUG-011's view gate on top of the tier gate)
  - FIXED branches steps 3-6 and digit step 8: byte-untouched

Task 3: REWRITE module docs (keys.ts :11-19 and :60-76) — Mode A
  - two-tier rule verbatim from ui-spec:70: chords intercept even in text
    focus; bare keys intercept only from non-editor focus and always forward
    while the editor holds focus

Task 4: FLIP/EXTEND tests
  - keys.test.ts DEFAULT_DATA :39-50 → 'd','o','t','m','e'
  - keys.test.ts :278 (text-focus intercept) → assert FORWARDING for bare
    letters + INTERCEPT for a chord; :508 batchNote variant same treatment
  - config-surface.test.ts :88-98 fixtures + :348 fire_from_text_focus flip
  - NEW: letters dispatch from options/deep/overview focus; letters forward
    in text AND note focus (route===false + editor buffer receives the byte);
    ctrl+s submits from text focus; ctrl+g opens the mocked $EDITOR from text
    focus; remap deep:'ctrl+alt+d' intercepts in text focus; remap
    batchNote:'n' (bare) forwards in text focus
  - config.test.ts: adjust any default-value assertions (keep-green: S2's
    alias tests are value-agnostic by contract)
  - KEEP-GREEN: keys.test :760/:910

Task 5: RUN gates
  - npx vitest run src/panel/keys.test.ts src/config-surface.test.ts src/config.test.ts -v
  - npm run typecheck && npm test
```

### Implementation Patterns & Key Details

```ts
// Tier classification (once, at binding resolution):
const isBareBinding = (accel: string): boolean =>
  parseAccelerator(accel).length === 1 && !accel.includes("+");
// (adapt to the real return shape of parseAccelerator — the contract is:
//  single printable base char, zero modifier tokens)

// Step-7 intercept shape (each site):
if (matchesKey(data, b.deep)) {
  if (bare.deep && editorFocused) return false; // BAREKEYS-001 tier 2: forward — must type
  actions.onDeep(panel);
  return true;
}
```

### Integration Points

```yaml
MODULES (contracts only):
  - P1.M1.T2.S2 (gesture removal): "'t'/'m' from editor focus now FORWARD by tier rule — S2 removes the onElaborate/onBatchNote toggle arms; do not pre-remove them here"
  - P1.M1.T2.S3 (footer drop): "unrelated — labels/hints only"
  - P1.M2.T1.S1 (hjkl): "hjkl are FIXED family (steps 3-4) — mirror the same editor-focus forwarding this PRP establishes for bare keys"
  - P1.M3.T1.S1 (digit removal): "digit branch sits AFTER step 7 and already text/note-gated — unaffected by tiering, deleted later"
NO CHANGES to: actions.ts, panel.ts, fixed branches, digit branch, S2's alias
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/keys.test.ts src/config-surface.test.ts src/config.test.ts -v
npm test
```

### Level 3: Behavioral probe

```bash
npx vitest run src/panel/keys.test.ts -t "text focus" -v
# Flipped + new tests: bare letters forward (editor receives them), chords intercept.
```

### Level 4: Domain validation

- [ ] keys.ts module doc states the two-tier rule (Mode A, quotes ui-spec:70)
- [ ] config.ts JSDoc table shows d/o/t/m/e + the two chord reasons
- [ ] `git diff` shows fixed branches and digit branch untouched

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green
- [ ] Defaults = h2.35 table; bare keys forward in text+note focus; chords intercept everywhere
- [ ] Inverted tests flipped; fixtures use plain letters; new tier tests in place
- [ ] Fixed keys / BUG-011 gate / deep-overview firing / S2 alias all regression-green
- [ ] Only config.ts, keys.ts, keys.test.ts, config-surface.test.ts, config.test.ts touched; spec/ untouched

## Anti-Patterns to Avoid

- ❌ Don't classify tiers per keystroke from raw bytes — resolve once per binding
- ❌ Don't swallow bare keys in editor focus — forwarding (return false) is the contract
- ❌ Don't touch the fixed branches, digit branch, or gesture-toggle arms — P1.M2/P1.M3/S2
- ❌ Don't drop externalEditor's text-focus gate or elaborate's BUG-011 view gate
- ❌ Don't hardcode 'd'/'t' etc. in router logic — tiers derive from the resolved binding, so remaps work
- ❌ Don't edit spec/*.md — READ-ONLY

---

**Confidence Score**: 9/10 — the step-7 code, doc rewrite sites, key-parsing grammar, every invert/keep-green test anchor, and both sibling PRP contracts were verified against the working tree via the architecture research doc; the only mild uncertainty is the exact `parseAccelerator` return shape for the bare-detection helper (contract stated, shape-check flagged).

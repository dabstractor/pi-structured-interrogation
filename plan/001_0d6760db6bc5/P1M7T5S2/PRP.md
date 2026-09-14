---
name: "P1.M7.T5.S2 — Config surface validation: every hotkey remappable (R5/AC-12)"
description: End-to-end validation that all 10 config hotkeys are remappable and every key-naming display string is config-generated; adds a machine-checked no-hardcoded-labels guard and a remappability audit record.
---

## Goal

**Feature Goal**: Prove AC-12 end-to-end and make it un-regressible: every one of
the 10 `keys.*` actions (including the `breakOut` global shortcut) fires on its
remapped accelerator, stops firing on the default, and every display string that
names a key (footer, suspend widget, ripple/confirm dialogs, gate warning, batch
note title, registered shortcut description) reflects the remap — with a
machine-checked source guard that no runtime string hardcodes a key label.

**Deliverable**:
1. `src/remap.test.ts` (or `src/config-surface.test.ts`) — exhaustive remap suite
   covering all 10 actions × {fires-on-new, old-default-released}, plus label
   propagation through footer/widget/dialog renderers.
2. `src/no-hardcoded-keys.test.ts` — source-scan guard test.
3. `docs/`-free audit record [Mode A]: `REMAPPABILITY.md` notes folded into
   JSDoc of the new test files + a summary section below (feeds P1.M7.T7.S2's
   README keymap table).
4. Any fixes to non-remappable keys or hardcoded labels found (documented as
   bugs against commitment 7 if genuinely unfixable).

**Success Definition**: AC-12 passes by script — with a project
`.pi/settings.json` containing a full remap of all 10 keys, the panel router,
widget line, footer, dialogs, and `registerShortcut` all use the new bindings;
`npm test` green including the two new guard suites.

## Why

- R5 / commitment 7 (h2.9): "all hotkeys configurable — no exceptions". AC-12
  (h2.10): "Every default hotkey remappable via config; footer/widget strings
  reflect the remap."
- Existing coverage is partial: `keys.test.ts:245` remaps only 2 of 10 actions;
  no test asserts label propagation to widget/dialogs; nothing prevents a future
  edit from reintroducing a hardcoded "Ctrl+S" string.
- The registered global shortcut (`command.ts:163`) passes the raw config string
  to `registerShortcut` without `parseAccelerator` normalization — untested
  edge (uppercase/whitespace config values).

## What

User-visible behavior: a user who sets, e.g.,
`.pi/settings.json → {"interrogator":{"keys":{"submit":"f9","breakOut":"ctrl+alt+b", …}}}`
sees every hint, widget line, and dialog reference the new keys, and every old
default stops triggering the action.

### Success Criteria

- [ ] For EACH of the 10 `KeyAction`s: remapped accelerator fires the routed
      action; the default accelerator no longer does (test both directions).
- [ ] `breakOut` remap reaches BOTH surfaces: `buildKeyRouter` binding AND
      `pi.registerShortcut` receives the remapped string (assert via the
      registerShortcut spy in the command-test mock).
- [ ] `resolveKeyLabels` output for a fully-remapped config contains zero
      default accelerators' labels; footer (`layout.ts` `renderFooter`-path via
      SCREEN_KEYS), suspend widget line (`buildSuspendWidgetLine`), gate warning
      text, ripple/confirm dialog text, and batch-note title either (a) contain
      only config-derived labels, or (b) the code is FIXED to do so, or (c) the
      string names only fixed keys (arrows/enter/esc — allowed, they are not in
      `keys.*`).
- [ ] Source guard test: scanning `src/**` (excluding `*.test.ts`) finds no
      string literal matching `/ctrl\+[a-z]/i` or `shift\+tab` OUTSIDE
      `config.ts` DEFAULT_CONFIG block and its JSDoc — i.e. no runtime display
      or dispatch code hardcodes a key. Comments in other files are tolerated
      by the guard (strip `//` and `/* */` comment spans before matching) but
      preferably cleaned to config-relative wording.
- [ ] Any key that CANNOT be remapped is documented in the audit table below
      and flagged as a bug against commitment 7 (expected: none — fixed keys
      esc/arrows/enter/digits are by design, h2.34, and out of scope).
- [ ] Non-remap config regression: invalid accelerator strings still fall back
      to defaults with exactly one `console.warn` per action (already in
      `resolveBindings`; add an all-10-actions invalidity sweep test).
- [ ] Keymap conflict re-verification note (avoid ctrl+b family, ctrl+shift+s/w,
      ctrl+shift+f, ctrl+shift+up/down, ctrl+m) recorded for P1.M7.T7.S2.

## All Needed Context

### Context Completeness Check

An implementer knowing nothing about this codebase can implement from this PRP
plus the referenced files: the config model, router, label resolver, display
consumers, and test patterns are all cited with exact paths/lines below.

### Documentation & References

```yaml
- file: src/config.ts
  why: DEFAULT_CONFIG.keys (lines 130-139), parseAccelerator grammar,
        resolveKeyLabels (line 370), loadConfigFrom merge order
  pattern: extend the existing resolveKeyLabels/remap tests in config.test.ts:154,174
  gotcha: pi exposes NO settings accessor — config loads by reading settings.json
          files directly; tests must use loadConfigFrom with temp files or inline
          config objects, not the real environment

- file: src/panel/keys.ts
  why: resolveBindings + buildKeyRouter — the dispatch core every remap test drives
  pattern: keys.test.ts:245-260 "remappability (AC-12 core)" — configWithKeys
           helper + fake panel; replicate per-action, per-direction
  gotcha: externalEditor only dispatches when panel.focus === "text"; prev/next
          in overview move the cursor instead — tests must set the right focus/view

- file: src/command.ts
  why: line 163 pi.registerShortcut(config.keys.breakOut) — the global surface.
        CONFIRM the raw-string pass-through: consider normalizing via
        parseAccelerator(config.keys.breakOut) ?? default before registering so a
        "Ctrl+Shift+Q"-style value behaves like keys.ts does. If changed, add a
        test: uppercase config value still registers lowercase normalized KeyId.
  gotcha: registerShortcut's modifier+key format IS the config format — do not
          pass the DISPLAY label

- file: src/panel/layout.ts
  why: renderFooter path — SCREEN_KEYS table + ACTION_WORDS + labels param
        (lines 359-383); batch-note editor-area title (line 232)
  pattern: layout.test.ts shows pure-renderer assertions on returned strings

- file: src/panel/suspend.ts
  why: buildSuspendWidgetLine (line 82) uses labels.breakOut; line 104 resolves
  pattern: suspend.test.ts asserts the exact widget line format

- file: src/panel/ripple-confirm.ts, src/panel/gate.ts, src/panel/discuss.ts
  why: dialog/warning text audit targets — verify they contain no key label
        beyond config-derived ones or fixed-key names (enter/esc OK)

- file: plan/001_0d6760db6bc5/architecture/environment-and-conflicts.md
  why: keymap conflict table to re-verify and hand to P1.M7.T7.S2
  section: repo-state / keymap conflict sections

- file: plan/001_0d6760db6bc5/P1M7T5S1/PRP.md
  why: parallel sibling adding src/panel/terminal-budget.ts; narrow footer shows
        only submit+deep hints with config-resolved labels — do not duplicate or
        conflict; your source guard must not flag its (config-driven) footer
```

### Current Codebase tree (relevant slice)

```bash
src/
  config.ts               # defaults, load, deep-merge, resolveKeyLabels  ← test
  config.test.ts          # label tests at :154,:174 to extend
  command.ts              # registerShortcut(breakOut) :163               ← audit/fix
  command.test.ts         # ExtensionAPI mock w/ registerShortcut spy
  panel/
    keys.ts               # resolveBindings + buildKeyRouter              ← test all 10
    keys.test.ts          # remap pattern at :245
    layout.ts             # footer SCREEN_KEYS, batch-note title          ← audit
    suspend.ts            # widget line                                   ← audit
    ripple-confirm.ts gate.ts discuss.ts                                  ← audit
```

### Desired Codebase tree with files to be added

```bash
src/
  config-surface.test.ts   # NEW: exhaustive 10-action remap suite + label
                           # propagation + invalid-fallback sweep + registerShortcut
                           # remap assertion (JSDoc: remappability audit table)
  no-hardcoded-keys.test.ts # NEW: source-scan guard (comment-stripping regex),
                            # allowlist: config.ts defaults + this test file
src/command.ts             # POSSIBLY MODIFIED: normalize breakOut via parseAccelerator
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: pi has NO ctx.settings API — never try to read live pi settings in
// tests; construct InterrogatorConfig objects directly or via loadConfigFrom
// with injected paths (config.ts's seam for exactly this).

// GOTCHA: parseAccelerator lowercases/normalizes; registerShortcut currently
// gets the RAW config string. Inconsistent normalization = remap works in-panel
// but the global shortcut misses on "Ctrl+Shift+Q" config input.

// GOTCHA: matchesKey lowercases KeyIds — dispatch tests should emit pi-style
// key event data strings; follow keys.test.ts fixtures exactly.

// GOTCHA: focus/view gating: externalEditor needs focus==="text"; digits need
// focus not text/note and view!=="overview". Remap tests for OTHER actions
// should run from default short/options focus so the gating doesn't mask a
// binding regression.

// Concurrency: P1.M7.T5.S1 is landing terminal-budget.ts + footer changes in
// parallel — keep your new tests in NEW files; if you must touch shared test
// files, additive-only.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/config-surface.test.ts
  - IMPLEMENT: table-driven suite over ALL 10 KeyActions:
    for each action: (a) remap to a distinctive valid accelerator, drive
    buildKeyRouter with the new key event data → action fired (spy on the
    corresponding RoutedActions method); (b) drive the DEFAULT key event →
    action NOT fired (released).
  - INCLUDE: breakOut registerShortcut assertion — registerInterrogateCommand
    mock pi, spy registerShortcut arg === remapped accelerator; and the
    all-10-invalid-values fallback sweep (resolveBindings returns defaults,
    10 console.warns).
  - INCLUDE: label propagation — resolveKeyLabels(fullyRemappedConfig) contains
    no default labels; renderFooter/footer hints + buildSuspendWidgetLine
    strings contain remapped labels and not defaults.
  - FOLLOW pattern: src/panel/keys.test.ts:245 configWithKeys + fake panel;
    src/panel/suspend.test.ts widget-line assertion
  - PLACEMENT: src/ (imports both config and panel modules)

Task 2: FIX src/command.ts (if audit confirms)
  - NORMALIZE: register parseAccelerator(config.keys.breakOut) ??
    parseAccelerator(DEFAULT_CONFIG.keys.breakOut) — mirror keys.ts fallback
  - TEST: uppercase/whitespace breakOut config registers the normalized KeyId
  - PRESERVE: existing registerShortcut semantics and description text

Task 3: CREATE src/no-hardcoded-keys.test.ts
  - IMPLEMENT: read src/ recursively (node:fs), skip *.test.ts and this file;
    strip // and /*…*/ comments; assert no match for
    /["'`](?:ctrl|alt|super)\+[^"'`]*["'`]/i or /shift\+tab/i EXCEPT an
    allowlist entry for config.ts's DEFAULT_CONFIG block (match by line range
    or by extracting the DEFAULT_CONFIG object literal before scanning).
  - GOTCHA: keep the guard's own regex in a form that doesn't self-match —
    the skip of *.test.ts handles it.
  - NAMING: test("source_contains_no_hardcoded_key_labels")

Task 4: AUDIT pass over dialogs
  - CHECK src/panel/ripple-confirm.ts, gate.ts, discuss.ts, layout.ts
    batch-note title, deep-view hints: any key name in a rendered string must
    come from labels param or name a fixed key (enter/esc/arrows — allowed).
    Fix violations; if unfixable, record in the audit table as a bug vs
    commitment 7.
  - RECORD: remappability audit table in config-surface.test.ts JSDoc [Mode A]:
    action → remapped ✓ both surfaces → label surfaces updated ✓ → notes.
    This table + the conflict re-verification note are the input P1.M7.T7.S2
    consumes for the README keymap section.

Task 5: RUN full validation loop (below); npm test green.
```

### Integration Points

```yaml
CONFIG: none — this task validates the existing surface; the only code change
        candidate is command.ts normalization (Task 2).
DOCS: none beyond code [Mode A]; README sweep is P1.M7.T7.S2 — hand off the
      audit table + conflict notes in test JSDoc.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npx tsc --noEmit          # or the repo's typecheck script (check package.json scripts)
npx eslint src/ 2>/dev/null || true   # repo currently has no eslint config — skip if absent
```

### Level 2: Unit Tests (the core gate)

```bash
npm test                                   # full suite, no regressions
npx vitest run src/config-surface.test.ts -t "remap"   # the new exhaustive sweep
npx vitest run src/no-hardcoded-keys.test.ts
```

### Level 3: Manual end-to-end (optional but recommended once)

```bash
# In a scratch checkout: write .pi/settings.json with a full remap, launch pi
# with the extension, upsert questions via /interrogate-debug-upsert, verify
# footer + widget + dialogs show new keys and old defaults are inert.
```

### Level 4: Hand-off verification

- [ ] Audit table complete; any unremappable key documented as a bug vs
      commitment 7 (expected: none).

## Final Validation Checklist

- [ ] All 10 actions remap + release, both directions tested
- [ ] breakOut: router AND registerShortcut both remapped
- [ ] resolveKeyLabels propagation verified in footer + widget (+ dialogs audited)
- [ ] no-hardcoded-keys guard green and would fail on a planted "Ctrl+S" literal
      (test the guard by temporarily adding one, then remove)
- [ ] npm test fully green; no regressions to keys/layout/suspend/command suites
- [ ] Invalid-config fallback sweep covers all 10 actions
- [ ] Audit table + conflict re-verification note written for P1.M7.T7.S2
- [ ] No edits to PRD/tasks.json/other work items' scope

## Anti-Patterns to Avoid

- ❌ Don't test only submit/deep (the existing partial coverage) — the point is
  ALL 10, exhaustively, per direction.
- ❌ Don't hardcode the default accelerators in assertions via copy-paste —
  import DEFAULT_CONFIG and derive (the guard test would flag drift).
- ❌ Don't skip the registerShortcut surface — in-panel remap alone fails AC-12
  for breakOut.
- ❌ Don't modify keys.ts dispatch logic unless a real bug is found; this is a
  validation task first, fix task second.

---

**Confidence Score**: 9/10 — the infrastructure (config-driven bindings, label
resolver, consumers) is already complete and documented; this task is
exhaustive test coverage + a source guard + one probable normalization fix in
command.ts. Low ambiguity.

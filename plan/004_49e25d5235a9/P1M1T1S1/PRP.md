# PRP — P1.M1.T1.S1: Rename `keys.focusText` → `keys.elaborate` (KeyAction member, defaults field, dispatch seam, label maps — values unchanged)

## Goal

**Feature Goal**: Execute the mechanical rename half of BAREKEYS-001 (spec h2.74/h2.35): the config action key `focusText` becomes `elaborate` everywhere — KeyAction union, KEY_ACTIONS, DEFAULT_CONFIG field, JSDoc table row, RoutedActions member `onFocusText`→`onElaborate`, keys.ts dispatch, panel.ts host override, layout.ts label maps, keymap-guard ALL_ACTIONS, and the listed test fixtures/spies. **The VALUE stays `ctrl+t`** — the default flip to `t` is P1.M1.T2.S1, and the `focusText`→`elaborate` compat alias is P1.M1.T1.S2. Behavior must be byte-identical after the rename.

**Deliverable**: Renamed identifiers across `src/config.ts`, `src/panel/keys.ts`, `src/panel/panel.ts`, `src/panel/layout.ts`, `src/keymap-guard.test.ts`, and test fixtures in `src/panel/keys.test.ts`, `src/config.test.ts`, `src/config-surface.test.ts`.

**Success Definition**:
- `DEFAULT_CONFIG.keys.elaborate === "ctrl+t"`; no `focusText` key remains anywhere in `src/` (grep clean, except the S2 alias task's future home — this subtask leaves zero occurrences)
- `resolveKeyLabels(config).elaborate === "Ctrl+T"`; footer renders identically ("Ctrl+T explain" until the T2 value flip)
- keys.test.ts, config.test.ts, config-surface.test.ts, keymap-guard.test.ts all green after mechanical flips
- `npm run typecheck` + full `npm test` green
- `focusTextField()`/`exitTextField()`/`desiredTextDuty()` method names UNTOUCHED

## Why

BAREKEYS-001 (h2.74): "`keys.focusText` renamed `keys.elaborate` — the action attaches text to the answer (elaboration/write-in duty); it was never 'focus text'." The rename is step 1 of the keymap trilogy so the value flip (T2) and compat alias (S2) land on the final name. Doing rename-before-alias keeps the alias a pure legacy-input concern.

## What

Mechanical renames (identifier → replacement), all values and intercept behavior unchanged:

| Site | Old | New |
|---|---|---|
| config.ts :51 | `\| "focusText"` in KeyAction union | `\| "elaborate"` |
| config.ts :96 | `"focusText",` in KEY_ACTIONS | `"elaborate",` |
| config.ts :113 | `focusText: "ctrl+t",` in DEFAULT_CONFIG.keys | `elaborate: "ctrl+t",` |
| config.ts :274 | JSDoc keys-table row `` `focusText` `` | `` `elaborate` `` + purpose wording: "Enter the editor: elaboration on the selection / write-in duty (FR-12)" |
| config.ts :296 | "close via the `focusText` toggle" | "close via enter" (or reference `elaborate`; T2.S2 removes the toggle gesture anyway — keep the minimal accurate wording) |
| keys.ts :114 | `onFocusText(p: InterrogationPanel): void;` | `onElaborate(...)` |
| keys.ts :319-321 | `onFocusText: (p) => {...}` in defaultRoutedActions | `onElaborate: (p) => {...}` (body unchanged) |
| keys.ts :475 | `matchesKey(data, b.focusText)` | `matchesKey(data, b.elaborate)` — the BUG-011 gate at :463-471 (`view === "short" && focus !== "note"`) STAYS as-is |
| keys.ts :477 | `actions.onFocusText(panel);` | `actions.onElaborate(panel);` |
| panel.ts :644 | `routed.onFocusText = (p) => {` host override | `routed.onElaborate = ...` (body unchanged) |
| layout.ts :67 | `focusText: "text",` in WORDS-like map | `elaborate: "text",` |
| layout.ts :501/:510 | `${labels.focusText} explain` | `${labels.elaborate} explain` (D-R11 footer string unchanged in output while value is ctrl+t) |
| layout.ts :516 | `${labels.focusText} close` | `${labels.elaborate} close` |
| keymap-guard.test.ts :40 | `"focusText",` in ALL_ACTIONS | `"elaborate",` |
| keys.test.ts :31 (DEFAULT_DATA) | `focusText: "\u0014", // ctrl+t` | `elaborate: "\u0014", // ctrl+t` |
| keys.test.ts SPY_FOR (~:130) | `focusText: "onFocusText",` | `elaborate: "onElaborate",` |
| keys.test.ts WORDS (~:143) | `focusText: "text",` | `elaborate: "text",` |
| keys.test.ts :288/:730/:926-954 | `DEFAULT_DATA.focusText` + describe name "focusText gated to the short view (BUG-011)" | `DEFAULT_DATA.elaborate` + rename describe to "elaborate gated to the short view (BUG-011)" |
| config.test.ts :135 | `expect(labels.focusText).toBe("Ctrl+T");` | `expect(labels.elaborate).toBe("Ctrl+T");` |
| config-surface.test.ts :21/:91/:108/:130/:143 | doc table row, DEFAULT/override fixture keys, SPY map `focusText: "onFocusText"`, WORDS `focusText: "text"` | same mechanical flips |
| panel.ts :439/:554/:633/:1156, keys.ts :51/:68/:281 | comment mentions of focusText/onFocusText | reword to `elaborate`/`onElaborate` (Mode A) |

**DO NOT rename**: `panel.focusTextField()`, `panel.exitTextField()`, `desiredTextDuty()` — editor-focus mechanics, not the config key (research keys-and-actions.md §4). All ~30 `focusTextField(...)` test call sites and actions.ts/deep-view.ts internal uses stay.

### Success Criteria

- [ ] `grep -rn "focusText\|onFocusText" src/` returns ZERO hits after the rename
- [ ] `grep -rn "focusTextField" src/` unchanged (methods kept)
- [ ] DEFAULT value `ctrl+t` / data `\u0014` untouched everywhere
- [ ] All four listed suites + full suite + typecheck green
- [ ] spec/*.md NOT edited (read-only; report mismatches, never edit)

## All Needed Context

### Context Completeness Check

Repo fully implemented, suites green. This is a grep-driven mechanical rename with the complete site inventory mapped above (verified against the working tree). An agent needs this PRP plus the named files; `grep -rn focusText src/` is the completeness check.

### Documentation & References

```yaml
- file: plan/004_49e25d5235a9/architecture/config-surface.md
  why: "§1/§4 complete site inventory of the config surface rename"
- file: plan/004_49e25d5235a9/architecture/keys-and-actions.md
  why: "§6/§9 dispatch/label-map sites; §4 the ruling that focusTextField()/exitTextField()/desiredTextDuty() are editor mechanics, NOT the config key — do not rename"

- file: src/config.ts
  why: "KeyAction union :48-58 (:51), KEY_ACTIONS :93-103 (:96), DEFAULT_CONFIG.keys :113, loadConfig JSDoc keys-table :274 + :296, resolveKeyLabels :334 (generic over KEY_ACTIONS — needs no edit beyond the arrays above)"
  pattern: "KEY_ACTIONS drives coercion + label maps — updating the array + defaults object is sufficient for resolveKeyLabels to expose labels.elaborate"

- file: src/panel/keys.ts
  why: "RoutedActions.onFocusText :114, defaultRoutedActions delegate :319-321, dispatch :475-477 (BUG-011 gate :463-471 stays), comments :51/:68/:281"

- file: src/panel/panel.ts
  why: "host override routed.onFocusText :644-648 (body unchanged); comments :439/:554/:633/:1156"

- file: src/panel/layout.ts
  why: "WORDS map :67, footer hints :501, statics set :510, editorExit line :516, comment :431"

- file: src/keymap-guard.test.ts
  why: "hand-duplicated ALL_ACTIONS :24-40 — the completeness test asserts DEFAULT_CONFIG.keys key set equals this list, so both must flip together"

- file: src/panel/keys.test.ts
  why: "DEFAULT_DATA :31 (within the :39-50 block region), makeActions spy + SPY_FOR :~130, WORDS :~143, view-gate rows :288/:730/:926-954"

- file: src/config-surface.test.ts
  why: "seam maps :128-149 (SPY_FOR/WORDS hand-duplicates), fixtures :91/:108, doc table :21"
```

### Current Codebase tree (relevant excerpt)

```bash
src/
├── config.ts               # union + KEY_ACTIONS + defaults + JSDoc — RENAME
├── panel/keys.ts            # RoutedActions + defaultRoutedActions + dispatch — RENAME
├── panel/panel.ts           # host override + comments — RENAME (override only)
├── panel/layout.ts          # label/hint maps — RENAME
├── keymap-guard.test.ts     # ALL_ACTIONS — RENAME
├── panel/keys.test.ts       # fixtures/spies — RENAME
├── config.test.ts           # labels assertion :135 — RENAME
├── config-surface.test.ts   # seam maps/fixtures — RENAME
└── (actions.ts, deep-view.ts, discuss.test.ts: focusTextField() uses — NO CHANGE)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: the value stays "ctrl+t" — P1.M1.T2.S1 flips it to "t"; a value
//   change here would break the byte-identical contract and collide with S2.
// CRITICAL: keymap-guard ALL_ACTIONS is HAND-DUPLICATED (not derived) — it must
//   be flipped in lockstep or the completeness test fails.
// GOTCHA: SPY_FOR / WORDS maps exist in BOTH keys.test.ts (~:130/:143) and
//   config-surface.test.ts (:130/:143) — two hand-duplicates, four flips.
// GOTCHA: layout.ts :501's rendered string is "Ctrl+T explain" today via
//   labels — output is unchanged because only the label KEY renames, not its
//   resolved value (resolveKeyLabels formats from the config value).
// GOTCHA: keys.test.ts BUG-011 describe (:928) routes DEFAULT_DATA.focusText
//   through view gates — rename the property access, keep the gate assertions.
// GOTCHA: don't touch actions.ts:232/:241, deep-view.ts:747, or the ~30
//   focusTextField("writein") test calls — method names are out of scope.
// GOTCHA: spec/*.md already use keys.elaborate (synced at 8c5f870) — if any
//   spec/code mismatch surfaces, REPORT it, never edit spec/.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: BASELINE — grep inventory
  - grep -rn "focusText\|onFocusText" src/ | grep -v focusTextField
  - Run npm test first: everything green before touching anything

Task 2: RENAME in src/config.ts (4 code sites + 2 JSDoc sites per table above)
Task 3: RENAME in src/panel/keys.ts (union member, delegate, dispatch, comments)
Task 4: RENAME in src/panel/panel.ts (override property :644 + 4 comment sites)
Task 5: RENAME in src/panel/layout.ts (map key :67 + 3 label interpolations + :431 comment)
Task 6: RENAME test-side: keymap-guard.test.ts ALL_ACTIONS :40; keys.test.ts
  (DEFAULT_DATA :31, SPY_FOR, WORDS, :288/:730, describe :928 + its
  DEFAULT_DATA.focusText rows); config.test.ts :135; config-surface.test.ts
  (:21 comment row, :91, :108, SPY :130, WORDS :143)
Task 7: VERIFY
  - grep -rn "focusText\|onFocusText" src/ | grep -v focusTextField → EMPTY
  - npm run typecheck → 0 errors (typecheck is the exhaustive rename verifier —
    any missed consumer fails here)
  - npx vitest run src/panel/keys.test.ts src/config.test.ts src/config-surface.test.ts src/keymap-guard.test.ts
  - npm test (full suite)
```

### Implementation Patterns & Key Details

```ts
// config.ts after (excerpt):
export type KeyAction = ... | "elaborate" | ...;
const KEY_ACTIONS = [..., "elaborate", ...] as const satisfies readonly KeyAction[];
export const DEFAULT_CONFIG: InterrogatorConfig = {
  keys: { ..., elaborate: "ctrl+t", ... },   // VALUE UNCHANGED — T2 flips it
};

// keys.ts dispatch (only the binding read + handler name change):
if (view === "short" && focus !== "note" && matchesKey(data, b.elaborate)) {  // gate unchanged
  actions.onElaborate(panel);
}
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck          # the exhaustive rename gate — any missed site errors here
grep -rn "focusText\|onFocusText" src/ | grep -v focusTextField   # expect: no output
grep -rn "focusTextField" src/ | wc -l                             # expect: same count as baseline
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/keys.test.ts src/config.test.ts src/config-surface.test.ts src/keymap-guard.test.ts
npm test
```

### Level 3: Behavior-identical spot checks

```bash
npx vitest run src/panel/keys.test.ts -t "BUG-011"    # view gate intact
npx vitest run src/panel/layout.test.ts src/panel/panel.test.ts  # footer strings unchanged
```

### Level 4: Spec-contract check (report only)

Compare config.ts's JSDoc keys table against spec ui-spec h2.35 (`keys.elaborate (renamed from focusText)`) — the spec is already on the new name; code now matches. Report (do not edit) any residual mismatch.

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green
- [ ] grep: zero `focusText`/`onFocusText` in src/ (excluding focusTextField method)
- [ ] `DEFAULT_CONFIG.keys.elaborate === "ctrl+t"` — value NOT flipped
- [ ] `resolveKeyLabels(...).elaborate === "Ctrl+T"` (config.test.ts flipped row green)
- [ ] keymap-guard ALL_ACTIONS flipped in lockstep; completeness test green
- [ ] focusTextField/exitTextField/desiredTextDuty untouched
- [ ] JSDoc row renamed with FR-12 wording; no spec/ files edited
- [ ] Intercept gates (BUG-011 :463-471) unchanged

## Anti-Patterns to Avoid

- ❌ Don't change any key VALUE — ctrl+t stays until P1.M1.T2.S1
- ❌ Don't add the focusText compat alias here — that's P1.M1.T1.S2 (coerceKeys)
- ❌ Don't rename focusTextField()/exitTextField()/desiredTextDuty() — editor mechanics, out of scope
- ❌ Don't "improve" the dispatch gate or gesture logic — T2.S2 owns gesture removal
- ❌ Don't edit spec/*.md or README.md — README is the Mode B final task
- ❌ Don't rely on grep alone — typecheck is the exhaustive verifier (union renames surface every consumer)

---

**Confidence Score**: 9/10 — pure mechanical rename with a complete verified site inventory, typecheck as the exhaustive gate, and a definitive grep completion check. Only mild risk: a string-literal reference grep can't see — mitigated by the full-suite run.

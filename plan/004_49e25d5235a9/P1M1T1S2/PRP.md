# PRP — P1.M1.T1.S2: Silent `focusText`→`elaborate` compat alias in coerceKeys

## Goal

**Feature Goal**: Users with an existing `settings.json` carrying the old `keys.focusText` entry (renamed to `keys.elaborate` by P1.M1.T1.S1) must keep working: `coerceKeys` (src/config.ts:195-202) silently drops unknown action names, so post-rename the old key would vanish. Add a silent, code-only compat alias — legacy `focusText` feeds `elaborate` when the new name is absent/invalid; an explicit valid `elaborate` always wins.

**Deliverable**: ~5 lines in `coerceKeys` (+ one-line maintainer comment) in `src/config.ts`, and alias tests in `src/config.test.ts`.

**Success Definition**:
- Settings `{keys:{focusText:"ctrl+j"}}` → resolved `keys.elaborate === "ctrl+j"`; `resolveKeyLabels(cfg).elaborate` and the footer reflect it
- Both present → `elaborate` wins
- `focusText` valid + `elaborate` invalid (empty/non-string) → alias value used, not the default
- No console.warn anywhere (silent, tolerant-coercion posture)
- The string `focusText` appears ONLY at the alias site + alias tests in `src/` (PRD grep gate: never in docs/types beyond the raw-settings read)
- `npm run typecheck` + full `npm test` green

## Why

BAREKEYS-001 (h2.74) renamed `keys.focusText` → `keys.elaborate`. The rename (S1) leaves zero `focusText` occurrences, so a settings file from before the rename silently loses its custom binding — the user's rebind regresses to the default with no signal. The alias keeps such files working through the rename. It must stay code-only: the old name disappears from types, JSDoc, README, and docs entirely (PRD grep gate).

## What

In `coerceKeys` (src/config.ts:195-202), before the per-action loop, resolve the `elaborate` source with alias fallback:

```ts
// Legacy alias (BAREKEYS-001 rename): a pre-rename keys.focusText binding
// feeds keys.elaborate when the new name is absent/invalid; never logged.
const elaborateValid =
  typeof src.elaborate === "string" && src.elaborate.trim() !== "";
const legacyValid =
  typeof src.focusText === "string" && src.focusText.trim() !== "";
const effSrc = { ...src };
if (!elaborateValid && legacyValid) effSrc.elaborate = src.focusText;
```
then the existing loop runs over `effSrc` unchanged. (Equivalent inline variants are fine — the contract is: valid `elaborate` wins; valid `focusText` fills an absent/invalid `elaborate`; otherwise defaults apply as today.) `coerceConfig` (:216-225) is untouched.

### Success Criteria

- [ ] Alias matrix (4 rows + silence row) tested and green in `src/config.test.ts`
- [ ] Alias assertions reference `DEFAULT_CONFIG.keys.elaborate` for defaults (value-agnostic — survives P1.M1.T2.S1's `t` flip)
- [ ] `grep -rn "focusText" src/ README.md spec/` → only the coerceKeys alias site + comment + config.test.ts alias rows (zero in docs/types/JSDoc tables)
- [ ] No behavior change for configs that never used `focusText`
- [ ] Full suite + typecheck green

## All Needed Context

### Context Completeness Check

Repo fully implemented, suites green pre-changeset; S1 (mechanical rename, value still `ctrl+t`) lands in parallel. This PRP quotes the exact current coerceKeys body and gives the drop-in alias code; the implementing agent needs this PRP plus `src/config.ts` (:178-225) and `src/config.test.ts`.

### Documentation & References

```yaml
- file: plan/004_49e25d5235a9/P1M1T1S1/PRP.md
  why: "CONTRACT — S1 renames KeyAction member/KEY_ACTIONS/defaults/labels to `elaborate`, VALUE stays 'ctrl+t' until T2; S1 explicitly reserves the coerceKeys alias for THIS subtask (grep-clean of focusText before the alias lands)"
  critical: "S1's keymap-guard completeness test asserts DEFAULT_CONFIG.keys key set — the alias must NOT add focusText to KEY_ACTIONS or the defaults object"

- file: plan/004_49e25d5235a9/P1M1T1S2/research/notes.md
  why: "verbatim coerceKeys body, alias precedence rule, label-propagation proof (resolveKeyLabels is generic over KEY_ACTIONS — footer inherits with zero label work), test matrix with the value-agnostic assertion strategy"

- file: plan/004_49e25d5235a9/architecture/config-surface.md
  why: "§2 Coercion & compat-alias seam — confirms no alias precedent exists, unknown names are silently dropped, and slots the alias inside coerceKeys before the loop"
  section: "§2"

- file: src/config.ts
  why: "coerceKeys :195-202 (the ONLY settings-keys read point via coerceConfig :219); coercion helpers :178-193 show the tolerant fall-back-to-default posture the alias must match"
  gotcha: "isPlainObject guard on raw stays — alias code reads src.focusText AFTER that guard; a non-object keys map needs no alias"

- file: src/config.test.ts
  why: "conventions: every test runs loadConfigFrom({global, project}) with mkdtemp paths and the writeConfig(p, obj) helper (:23-32); imports DEFAULT_CONFIG/loadConfigFrom/resolveKeyLabels (:12); labels rows at :129-133 show the assert shape"
  pattern: "write a real settings.json with the legacy key into a temp global path; loadConfigFrom; assert cfg.keys.elaborate + resolveKeyLabels(cfg).elaborate"
```

### Current Codebase tree (relevant excerpt)

```bash
src/
├── config.ts           # coerceKeys :195-202 — ADD alias + comment (only source change)
└── config.test.ts      # ADD alias describe (~4-5 rows) — MODIFY (add only)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: do NOT add "focusText" to KeyAction, KEY_ACTIONS, DEFAULT_CONFIG,
//   labels, or keymap-guard ALL_ACTIONS — it is a RAW-SETTINGS name only; the
//   completeness tests assert the 9-member key set (post-S1: elaborate in,
//   focusText out).
// GOTCHA: alias precedence is strict: valid elaborate ALWAYS wins even when
//   focusText is also present; an INVALID elaborate (empty string, number,
//   null) does NOT win — focusText fills it.
// GOTCHA: alias tests must not hardcode "ctrl+t" as the default — T2 flips the
//   default to "t"; assert against DEFAULT_CONFIG.keys.elaborate so this
//   subtask's tests survive T2 unchanged.
// GOTCHA: silence is contractual — no console.warn (tolerant-coercion posture,
//   h2.74-era decisions); add a spy row proving zero warns.
// GOTCHA: coerceKeys receives the DEEP-MERGED raw (global over defaults-shape,
//   project over global) — a project focusText + global elaborate merge to
//   both-present at the alias point; the precedence rule handles it; add a
//   merge-level test row only if cheap (global focusText, project without keys).
// GOTCHA: spec/*.md and README.md are READ-ONLY here — the old name must not
//   be introduced to any doc (README keymap tables are P1.M4.T2.S1's rewrite).
```

## Implementation Blueprint

### Implementation Tasks (TDD-ordered)

```yaml
Task 1: ADD failing alias tests to src/config.test.ts (new describe "focusText→elaborate legacy alias")
  - Row 1 (alias applies): settings {"keys":{"focusText":"ctrl+j"}} via temp
    global file → cfg.keys.elaborate === "ctrl+j"; resolveKeyLabels(cfg).elaborate === "Ctrl+J"
  - Row 2 (explicit wins): {"keys":{"focusText":"ctrl+j","elaborate":"ctrl+k"}}
    → elaborate "ctrl+k"
  - Row 3 (invalid elaborate → alias): {"keys":{"focusText":"ctrl+j","elaborate":""}}
    and a {"elaborate": 42} variant → elaborate "ctrl+j"
  - Row 4 (no legacy → default): {"keys":{}} or focusText:"" / 42
    → cfg.keys.elaborate === DEFAULT_CONFIG.keys.elaborate
  - Row 5 (silence): vi.spyOn(console,"warn") → not called during any alias load
  - Row 6 (cheap, optional): global {keys:{focusText:"ctrl+j"}} + project {} → alias applies post-merge

Task 2: ADD the alias in coerceKeys (config.ts :195-202)
  - Insert the effSrc alias block (What section) before the loop; loop over effSrc
  - One-line maintainer comment naming BAREKEYS-001 and the never-logged rule
  - coerceConfig untouched; no type/exports changed

Task 3: GREP GATE
  - grep -rn "focusText" src/ → ONLY config.ts alias site (+comment) and
    config.test.ts alias rows
  - grep -rn "focusText" README.md spec/ → EMPTY (nothing added; report any
    pre-existing mismatch, never edit spec/)

Task 4: RUN gates
  - npx vitest run src/config.test.ts src/config-surface.test.ts src/keymap-guard.test.ts
  - npm run typecheck && npm test
```

### Implementation Patterns & Key Details

```ts
// Drop-in (only change inside coerceKeys; loop reads effSrc instead of src):
function coerceKeys(raw: unknown): Record<KeyAction, string> {
  const src = isPlainObject(raw) ? raw : {};
  // Legacy alias (BAREKEYS-001 rename): a pre-rename keys.focusText binding
  // silently feeds keys.elaborate when the new name is absent/invalid.
  const elaborateValid = typeof src.elaborate === "string" && src.elaborate.trim() !== "";
  const legacyValid = typeof src.focusText === "string" && src.focusText.trim() !== "";
  const effSrc = !elaborateValid && legacyValid ? { ...src, elaborate: src.focusText } : src;
  const out = {} as Record<KeyAction, string>;
  for (const action of KEY_ACTIONS) {
    const v = (effSrc as Record<string, unknown>)[action];
    out[action] = typeof v === "string" && v.trim() !== "" ? v : DEFAULT_CONFIG.keys[action];
  }
  return out;
}
```

### Integration Points

```yaml
UPSTREAM: "S1's rename makes focusText a dead raw-settings name — this alias revives it silently; value stays ctrl+t until T2"
DOWNSTREAM: "P1.M1.T2.S1 default-flip tests rely on alias tests being value-agnostic (assert DEFAULT_CONFIG.keys.elaborate); P1.M4.T1.S2 AC-12/AC-4 scripted coverage treats the alias as the rename-compat guarantee"
DOCS: "none — README/spec are later Mode B tasks; the alias is invisible by design"
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
grep -rn "focusText" src/          # only coerceKeys alias + comment + config.test.ts alias rows
grep -rn "focusText" README.md spec/   # empty
```

### Level 2: Unit Tests

```bash
npx vitest run src/config.test.ts -v    # new alias describe green
npx vitest run src/config-surface.test.ts src/keymap-guard.test.ts   # key-set completeness untouched
npm test                                  # full suite
```

### Level 3: Label/footer propagation

```bash
npx vitest run src/panel/layout.test.ts src/panel/keys.test.ts   # footer hint inherits labels.elaborate — unchanged
```

### Level 4: Behavior matrix (manual)

- [ ] No-legacy configs behave byte-identically (defaults path unchanged)
- [ ] Both-present, invalid-elaborate, invalid-legacy, silence — each row tested

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green
- [ ] Alias precedence matrix green (alias / explicit-wins / invalid-new → alias / no-legacy → default)
- [ ] Zero console output from the alias
- [ ] `focusText` absent from KeyAction/KEY_ACTIONS/defaults/labels/keymap-guard and from all docs
- [ ] Alias tests value-agnostic (DEFAULT_CONFIG.keys.elaborate, no literal "ctrl+t")
- [ ] coerceConfig untouched; only coerceKeys (+tests) changed

## Anti-Patterns to Avoid

- ❌ Don't add focusText to any type/array/default — it lives only as a raw-settings read
- ❌ Don't warn/log — the alias is silent by contract
- ❌ Don't let an invalid `elaborate` beat a valid `focusText` — invalid never wins
- ❌ Don't hardcode "ctrl+t" in tests — T2 flips the default
- ❌ Don't document the old name anywhere (README/spec/JSDoc tables) — grep gate is a PRD requirement
- ❌ Don't touch coerceConfig, resolveKeyLabels, or the deep-merge

---

**Confidence Score**: 9/10 — a ~10-line, self-contained alias with the exact current coerceKeys body quoted, a drop-in implementation, a full test matrix, and a definitive grep gate; only mild risk is merge-level subtleties (covered by the optional Row 6).

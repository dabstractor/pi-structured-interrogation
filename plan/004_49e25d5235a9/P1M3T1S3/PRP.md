# PRP — P1.M3.T1.S3: Delete digitQuickSelect from the config schema and settings load (DIGIT-OUT-001)

## Goal

**Feature Goal**: Remove the `digitQuickSelect` toggle from the interrogator config surface entirely — interface field, default, coercion line, and JSDoc reference — leaving a final schema of **9 keys + 3 toggles** (`gateWarnings`, `roundDetection`, `compactionPreservation`) + `editorMode` + `escExitWindowMs`. A user's settings file that still carries `digitQuickSelect` must load cleanly with the key ABSENT from the resolved config (AC-3: "absent from the config schema and settings load").

**Deliverable**: Edits to `src/config.ts` (delete 4 sites + fix JSDoc counts), `src/config.test.ts` (rewrite the toggles test :106–117: drop digitQuickSelect fixtures, assert key ABSENCE on a stale settings file), `src/config-surface.test.ts` (drop the digit fixture :209 + purge the :35 comment clause).

**Success Definition**: `npm run typecheck` green, `npm test` green. `grep -rn "digitQuickSelect" src/` hits only `config.test.ts` (the deliberate stale-settings test) and the one S1-owned comment in `keys.test.ts:632`. keymap-guard completeness unaffected (still 9 keys). Output consumed by P1.M4.T2.S1 (README sample settings from the corrected JSDoc) and P1.M4.T1.S2 (AC-3 scripted).

## Why

- h2.74 DIGIT-OUT-001: "digit quick-select (1–9 accepts option n) and the `digitQuickSelect` toggle are REMOVED entirely… The `digitQuickSelect` toggle is deleted." With hjkl + `enter`, digits were a redundant second accept path and a stray digit instantly answered + advanced — an accidental-answer footgun.
- This is step 3 of 3. S1 (P1.M3.T1.S1) deleted the keys.ts digit branch; S2 (P1.M3.T1.S2) deleted `actions.digit` — destroying the LAST source reader of `config.digitQuickSelect` (actions.ts:195). With no readers left, the config field is dead schema; this task removes it.
- The mechanics are trivially safe: `coerceConfig` rebuilds the config object **field-by-field from named fields only** (config.ts:225–240), so an unknown `digitQuickSelect` in a settings file already contributes nothing once the field is deleted — no unknown-key handling needed. This task also PROVES that property with a test (a stale settings file loads cleanly, key absent).

## What

### Exact edits

**1. `src/config.ts` — delete 4 sites, fix counts** (line numbers verified in the current tree and STABLE into S3: neither S1 nor S2 touches config.ts)

- **:79–80 — interface field + its JSDoc** (inside `InterrogatorConfig`, between `roundDetection` and `compactionPreservation`):
  ```ts
  /** Allow pressing 1–9 to quick-select an option. Default true. */
  digitQuickSelect: boolean;
  ```
- **:123 — default** (inside `DEFAULT_CONFIG`): `digitQuickSelect: true,`
- **:234 — coercion line** (inside `coerceConfig`'s return object): `digitQuickSelect: coerceBoolean(src.digitQuickSelect, DEFAULT_CONFIG.digitQuickSelect),`
- **:277 — header counts fix** (loadConfig JSDoc): `* Nested objects merge per-key; scalars replace. 9 keys + 4 toggles` → `9 keys + 3 toggles`. **Key count stays 9** (elaborate replaced focusText 1:1 in P1.M1.T1.S1). Optionally append DIGIT-OUT-001 to the parenthetical two lines down: `(defaults = PRD h2.52 as amended by the breakOut removal and DIGIT-OUT-001)`.
- **:309 — toggles table row** (under `### toggles` at :304): delete `` | `digitQuickSelect` | true    | Press 1–9 to quick-select an option                  | panel keys (P1.M3.T3.S1) | ``. The table keeps 3 rows: `gateWarnings`, `roundDetection`, `compactionPreservation`.
- **Do NOT touch**: the top-of-file Consumers comment (no digit mention), `coerceBoolean`/`coerceKeys`/`deepMerge`/`tryReadInterrogator`, `KEY_ACTIONS` (9 entries — unchanged).

**2. `src/config.test.ts` — rewrite `test_toggles_coerce_bad_values_to_defaults_and_keep_false` (:106–117)**

Current body (for reference):
```ts
test("test_toggles_coerce_bad_values_to_defaults_and_keep_false", async () => {
  const bad = await writeSettings(
    JSON.stringify({ interrogator: { gateWarnings: "yes", roundDetection: 0, digitQuickSelect: {} } }),
  );
  const cfg = await loadConfigFrom({ global: bad, project: await missingPath() });
  expect(cfg.gateWarnings).toBe(true);
  expect(cfg.roundDetection).toBe(true);
  expect(cfg.digitQuickSelect).toBe(true);
  const off = await writeSettings(JSON.stringify({ interrogator: { digitQuickSelect: false } }));
  const cfg2 = await loadConfigFrom({ global: off, project: await missingPath() });
  expect(cfg2.digitQuickSelect).toBe(false);
  expect(cfg2).toEqual({ ...DEFAULT_CONFIG, digitQuickSelect: false });
});
```

Rewrite to (keep the test name — both halves stay meaningful):
```ts
test("test_toggles_coerce_bad_values_to_defaults_and_keep_false", async () => {
  const bad = await writeSettings(
    JSON.stringify({ interrogator: { gateWarnings: "yes", roundDetection: 0 } }),
  );
  const cfg = await loadConfigFrom({ global: bad, project: await missingPath() });
  expect(cfg.gateWarnings).toBe(true);
  expect(cfg.roundDetection).toBe(true);
  // DIGIT-OUT-001: digitQuickSelect is deleted from the schema. A settings
  // file still carrying it loads cleanly — coerceConfig rebuilds the config
  // field-by-field, so the unknown key contributes nothing and is ABSENT
  // from the resolved object (AC-3).
  const stale = await writeSettings(
    JSON.stringify({ interrogator: { gateWarnings: false, digitQuickSelect: false } }),
  );
  const cfg2 = await loadConfigFrom({ global: stale, project: await missingPath() });
  expect(cfg2.gateWarnings).toBe(false);
  expect("digitQuickSelect" in cfg2).toBe(false);
  expect(Object.keys(cfg2)).not.toContain("digitQuickSelect");
  expect(cfg2).toEqual({ ...DEFAULT_CONFIG, gateWarnings: false });
});
```
Notes: `cfg2.digitQuickSelect` is now a TYPECHECK ERROR (field gone) — that's why the assertions use `in` / `Object.keys`. `gateWarnings: false` preserves the test's "keep false" half. Helpers `writeSettings` (:29) and `missingPath` (:37) already exist — reuse them. The :42 defaults test (`toEqual(DEFAULT_CONFIG)`) survives unchanged.

**3. `src/config-surface.test.ts` — 2 edits (the file's only digit hits are :35 and :209)**

- **:35 comment purge**: `` * `up`/`down`/`left`/`right`/`esc`/`enter` plus digit quick-select 1–9. `` → `` * `up`/`down`/`left`/`right`/`esc`/`enter`. `` (digits are no longer fixed keys — they are inert plain input).
- **:209 fixture drop**: inside `makeActions()`, delete the line `digit: vi.fn((_p: InterrogationPanel, _n: number) => true),` (S2 removed the PanelActions/RoutedActions member this spied on). No other test in the file asserts on the digit spy (verified).

### Success Criteria

- [ ] `InterrogatorConfig` = 9 `keys` actions + `gateWarnings` + `roundDetection` + `compactionPreservation` + `editorMode` + `escExitWindowMs`; no `digitQuickSelect` anywhere in `src/config.ts`.
- [ ] loadConfig JSDoc says "9 keys + 3 toggles"; toggles table has 3 rows.
- [ ] Config test proves: stale `{ interrogator: { digitQuickSelect: false } }` in settings → resolved config `toEqual(DEFAULT_CONFIG…)` with the key absent.
- [ ] `npm run typecheck` and `npm test` green; keymap-guard completeness (9 keys) untouched.
- [ ] `grep -rn "digitQuickSelect" src/` → only `config.test.ts` (deliberate) + `keys.test.ts:632` comment (S1's file, see Non-goals).

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the exact 4 config.ts sites with stable line numbers, the S1+S2 landing precondition (no remaining source readers), the field-rebuild coercion mechanism that makes stale settings harmless, the typecheck consequence of touching deleted fields in tests (`cfg.digitQuickSelect` → error; use `in`), and the file-boundary rules (keys.ts/keys.test.ts/actions.ts/README belong to siblings). All provided below.

### Documentation & References

```yaml
- file: src/config.ts
  why: THE edit target — :79-80 interface field, :123 default, :234 coerceConfig line, :277 JSDoc counts, :309 JSDoc toggles row (all verified; stable because S1/S2 never edit this file)
  pattern: coerceConfig (lines ~216-240) rebuilds field-by-field — this is WHY unknown settings keys vanish; read it before editing to confirm the mechanism
  gotcha: line numbers cited are pre-edit and shift only with YOUR OWN sequential edits; re-grep if uncertain: grep -n digitQuickSelect src/config.ts

- file: src/config.test.ts
  why: :106-117 toggles test rewrite (drop fixtures, add absence assertions on a stale settings file)
  pattern: writeSettings (:29) / missingPath (:37) helpers + loadConfigFrom({global, project}) seam — never read the real ~/.pi
  gotcha: after deleting the interface field, any `cfg.digitQuickSelect` access FAILS typecheck — assert absence with "digitQuickSelect" in cfg / Object.keys(cfg)

- file: src/config-surface.test.ts
  why: :209 digit spy fixture in makeActions() + :35 fixed-keys comment clause — both deleted
  gotcha: this file is NOT in S1's or S2's edit lists; these two sites are S3's alone (work item: "config-surface.test.ts fixtures drop the field")

- file: plan/004_49e25d5235a9/P1M3T1S2/PRP.md
  why: CONTRACT — S2 (implementing in parallel) deletes actions.digit including the actions.ts:195 config read, which is the LAST reader; S3 starts from S2's reader-free output
  critical: if actions.ts:195 or keys.ts:599 still read digitQuickSelect when you start, S1/S2 haven't landed — typecheck WILL fail after your edit; coordinate, don't hack

- file: plan/004_49e25d5235a9/architecture/config-surface.md
  why: research note §1-§3 cataloguing the config.ts sites (referenced by the work item)
  gotcha: its :50 claim that counts become "8 keys + 3 toggles" is STALE — the elaborate rename kept 9 keys; current config.ts:277 and the work item both say 9 keys + 3 toggles. Follow the code + work item.

- file: src/keymap-guard.test.ts
  why: proves UNAFFECTED — ALL_ACTIONS (9 entries) iterates KeyActions only; digitQuickSelect was a toggle, never a KeyAction
  gotcha: its "ten actions" wording (:25/:100) is pre-existing stale naming — NOT yours to fix (scope creep)

- spec PRD h2.74 (DIGIT-OUT-001) + h2.55 (config reference: no digitQuickSelect in the final schema) + h2.35 ("The digitQuickSelect toggle is deleted; digits are inert at panel level")
  why: authoritative rulings; selected content embedded in the task prompt
```

### Current Codebase tree (relevant excerpt)

```bash
src/
  config.ts               # EDIT: 4 deletions + JSDoc counts (this task's core)
  config.test.ts          # EDIT: toggles test rewrite :106-117
  config-surface.test.ts  # EDIT: :35 comment + :209 fixture
  keymap-guard.test.ts    # UNTOUCHED (9-key completeness — unaffected)
  panel/keys.ts           # S1's — DO NOT TOUCH (digit branch lives there until S1 lands)
  panel/actions.ts        # S2's — DO NOT TOUCH (:195 reader lives there until S2 lands)
README.md                 # P1.M4.T2.S1's — DO NOT TOUCH (still has digit refs :36-37/:51/:54/:59)
```

### Desired Codebase tree

```bash
# No files added or removed — deletions and rewording only.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: SEQUENCE GATE — S3 requires the reader-free codebase (the work
// item's INPUT contract). Gate on it first:
//   grep -rn "digitQuickSelect" src/ --include="*.ts" | grep -v "\.test\.ts"
// must print ONLY src/config.ts lines. keys.ts:599 and actions.ts:195 must
// be gone (S1/S2). If not: STOP and coordinate — deleting the field with a
// live reader breaks typecheck, and suppressing it is forbidden.
// GOTCHA: settings tolerance comes FREE — coerceConfig constructs the result
// object literal field-by-field; it never spreads `src`. An unknown
// digitQuickSelect key in a merged settings file is simply never read. Do
// NOT add unknown-key stripping/deprecation-warning logic — the PRD wants
// silent tolerance (mirrors the focusText alias philosophy in coerceKeys).
// GOTCHA: TypeScript — after the interface deletion, every `cfg.digitQuickSelect`
// in tests is a compile error, and object literals typed as InterrogatorConfig
// carrying the key fail excess-property checks. Sweep with grep, don't rely
// on the compiler to find them one at a time.
// GOTCHA: `toEqual({ ...DEFAULT_CONFIG, gateWarnings: false })` in the rewritten
// test is DEEP equality on the resolved object — it implicitly proves no
// stray digitQuickSelect key survives the load (toEqual ignores undefined but
// the key would have to be present-and-defined to leak; pair it with the
// explicit `in` assertion anyway).
```

## Implementation Blueprint

### Data models and structure

`InterrogatorConfig` after this task (final surface, 9 keys + 3 toggles + 2 scalars — matches PRD h2.55):

```ts
export interface InterrogatorConfig {
  keys: Record<KeyAction, string>;          // 9 actions: deep, overview, elaborate,
                                            // batchNote, submit, discuss, externalEditor,
                                            // prevQuestion, nextQuestion
  gateWarnings: boolean;                    // default true
  roundDetection: boolean;                  // default true
  compactionPreservation: boolean;          // default true
  editorMode: EditorMode;                   // default "composed"
  escExitWindowMs: number;                  // default 500
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: GATE ON THE READER-FREE PRECONDITION
  - RUN: grep -rn "digitQuickSelect" src/ --include="*.ts" | grep -v "\.test\.ts"
  - EXPECT: only src/config.ts (:79-80/:123/:234/:309 area). If panel/keys.ts:599 or
    panel/actions.ts:195 appear, S1/S2 haven't landed — coordinate (do NOT edit their files).

Task 2: EDIT src/config.ts — delete the four sites + fix JSDoc
  - DELETE: :79-80 interface field + JSDoc, :123 default, :234 coerceConfig line, :309 toggles table row
  - FIX: :277 "9 keys + 4 toggles" → "9 keys + 3 toggles" (key count UNCHANGED at 9)
  - OPTIONAL: extend the :279 parenthetical to "...as amended by the breakOut removal and DIGIT-OUT-001"
  - INVARIANT: grep -n digitQuickSelect src/config.ts → zero; grep -ni digit src/config.ts → zero

Task 3: EDIT src/config.test.ts — toggles test rewrite (:106-117)
  - DROP digitQuickSelect from the bad-values fixture; keep gateWarnings "yes" + roundDetection 0
  - KEEP a stale-settings write ({ gateWarnings: false, digitQuickSelect: false }) asserting:
    gateWarnings false honored, "digitQuickSelect" in cfg2 === false,
    Object.keys(cfg2) excludes it, toEqual({ ...DEFAULT_CONFIG, gateWarnings: false })
  - USE "in"/Object.keys — direct property access no longer compiles
  - RUN: npx vitest run src/config.test.ts

Task 4: EDIT src/config-surface.test.ts — fixture + comment
  - DELETE: :209 digit spy line in makeActions()
  - REWORD: :35 fixed-keys comment — drop " plus digit quick-select 1–9"
  - RUN: npx vitest run src/config-surface.test.ts

Task 5: FULL GATES + RESIDUE AUDIT
  - RUN: npm run typecheck && npm test
  - AUDIT: grep -rn "digitQuickSelect" src/ → ONLY config.test.ts (deliberate stale-fixture
    test) + keys.test.ts:632 comment (S1's file — leave; see Non-goals)
  - CHECK: keymap-guard suite green with zero edits (9 keys still complete)
```

### Implementation Patterns & Key Details

```ts
// Key-absence assertions (typecheck-safe after the field deletion):
expect("digitQuickSelect" in cfg2).toBe(false);
expect(Object.keys(cfg2)).not.toContain("digitQuickSelect");
expect(cfg2).toEqual({ ...DEFAULT_CONFIG, gateWarnings: false }); // deep equality:
// nothing leaks through the load, and the defaults object itself carries no key

// The load pipeline (unchanged by this task — this is WHY stale settings are inert):
//   tryReadInterrogator(global) → tryReadInterrogator(project)
//   → deepMerge(deepMerge(DEFAULT_CONFIG, global), project)   // merged raw MAY carry
//     the stale key (deepMerge spreads override keys)
//   → coerceConfig(merged)                                    // REBUILDS field-by-field:
//     the return object literal names gateWarnings/roundDetection/
//     compactionPreservation/editorMode/escExitWindowMs only — the stale key is
//     never read, so it cannot appear in the output. Deleting :234 is the whole change.
```

### Integration Points

```yaml
CONFIG: this task IS the config change — no migrations, no compat shim (DIGIT-OUT-001 says
  removed entirely; contrast with focusText→elaborate which kept a silent alias — a toggle
  being deleted needs NO alias because nothing consumes it anymore after S1+S2)
UNBLOCKS: P1.M4.T2.S1 (README sample settings block + keymap tables — the loadConfig JSDoc
  is its Mode A source of truth), P1.M4.T1.S2 (AC-3 scripted check asserts absence end-to-end)
DOCS: [Mode A] loadConfig JSDoc — toggles table row deleted, header counts corrected. No
  README changes (P1.M4.T2.S1 owns it).
KEYS/ACTIONS: none — keys.ts/keys.test.ts are S1's, actions.ts etc. are S2's. Do not touch.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck          # (equivalent: npx tsc --noEmit)
# Expected: zero errors. NO ts-ignore/suppressions — a live digitQuickSelect reader means
# S1/S2 haven't landed; go back to Task 1, don't suppress.
```

### Level 2: Unit Tests

```bash
npx vitest run src/config.test.ts src/config-surface.test.ts -v
npx vitest run src/keymap-guard.test.ts    # proves 9-key completeness unaffected, zero edits
npm test                                   # full suite
# Expected: all green. The rewritten toggles test must FAIL if the field were re-added
# to coerceConfig (the `in` assertion guards the schema).
```

### Level 3: Residue audit

```bash
grep -rn "digitQuickSelect" src/
# Expected: src/config.test.ts (deliberate stale-fixture/absence test) and
# src/panel/keys.test.ts:632 (S1's comment; see Non-goals) ONLY.
grep -rni "digit" src/config.ts
# Expected: zero matches.
grep -rn "digitQuickSelect" scripts/ 2>/dev/null
# Expected: zero.
```

### Level 4: Behavior verification (scripted, no TUI needed)

```bash
# Stale-settings tolerance, proven by the unit test (no manual run required):
# a settings.json carrying {"interrogator":{"digitQuickSelect":false}} loads to
# exactly DEFAULT_CONFIG with the key absent — asserted in the rewritten
# test_toggles_coerce_bad_values_to_defaults_and_keep_false.
# AC-3 end-to-end scripting is P1.M4.T1.S2's deliverable; S3 supplies this config-level proof.
```

## Final Validation Checklist

- [ ] `npm run typecheck` clean; `npm test` all green.
- [ ] `src/config.ts` has zero `digit`/`digitQuickSelect` matches (case-insensitive).
- [ ] JSDoc header reads "9 keys + 3 toggles"; toggles table has exactly 3 rows (gateWarnings, roundDetection, compactionPreservation).
- [ ] Rewritten toggles test asserts key ABSENCE via `in`/`Object.keys` + deep-equality on a stale settings file; name and both coverage halves (coerce-bad→defaults, keep-false) preserved.
- [ ] `config-surface.test.ts` makeActions() has no digit spy; :35 comment has no digit clause.
- [ ] keymap-guard, no-hardcoded-keys, ac-scripted suites green with ZERO edits from this task.
- [ ] keys.ts / keys.test.ts / actions.ts / actions.test.ts / short-view.ts / panel.ts / ripple-confirm.test.ts / README.md untouched.
- [ ] No suppressions (ts-ignore/eslint-disable) introduced.

## Anti-Patterns to Avoid

- ❌ Don't start editing before the Task 1 gate — a live reader (keys.ts:599 / actions.ts:195) turns your deletion into a typecheck break; wait for or coordinate with S1/S2 instead.
- ❌ Don't add unknown-key stripping or a deprecation warning for digitQuickSelect in settings — coerceConfig's field-by-field rebuild already silently drops it; the PRD's tolerance philosophy is silence (same as the focusText alias: "never logged").
- ❌ Don't touch keys.ts/keys.test.ts (S1's) even for the :632 stale comment, actions files (S2's), or README (P1.M4.T2.S1's) — boundary discipline protects the parallel pipeline.
- ❌ Don't change the key count — it stays 9 keys + 3 toggles. The architecture note's "8 keys" is stale; elaborate replaced focusText 1:1.
- ❌ Don't leave `cfg.digitQuickSelect` accesses in tests — they don't compile after the field is gone; use `in`/`Object.keys`.
- ❌ Don't fix keymap-guard's pre-existing "ten actions" wording — out of scope.

# PRP — P1.M1.T2.S1: Interface fields, defaults, coercion, and JSDoc rows for the two side-chat settings

## Goal

**Feature Goal**: Add the two SIDECHAT config fields to the interrogator config surface: `sideChatModel?: string` (optional "provider/model-id" override for the side chat; default = the session's current model at chat open; invalid → notify + session model) and `sideChatAutoApply: boolean` (skip the answer-confirm row; default false) — interface, defaults, coercion, JSDoc reference rows, and tests. Pure config-layer change; no consumers wired.

**Deliverable**: Modified `src/config.ts` + tests in `src/config.test.ts`.

**Success Definition**:
- `npm run typecheck` + full `npm test` green
- `{"interrogator":{"sideChatAutoApply":true}}` resolves true; absent/bad → false
- `{"interrogator":{"sideChatModel":"anthropic/claude-..."}}` resolves through; blank/non-string/absent → the key is `undefined` on the resolved config
- Both JSDoc rows present in the config reference; DEFAULT_CONFIG carries `sideChatAutoApply: false` and NO `sideChatModel` key

## Why

SIDECHAT-001…005 (h2.80/h2.38): the per-question side chat needs its model override and confirm-bypass knobs in the standard config surface so P1.M1.T5.S1 (model resolution) and P1.M1.T6.S2 (autoApply bypass) read resolved config — never raw settings. `sideChatModel` is the FIRST optional field in this config, so it also establishes the optional-string coercion precedent.

## What

1. **Interface** (`InterrogatorConfig`, near :84 next to `compactionPreservation`):
   - `sideChatModel?: string` — JSDoc: `"provider/model-id" override for the side chat; default = the session's current model at chat open; invalid → notify + session model.`
   - `sideChatAutoApply: boolean` — JSDoc: `Skip the answer-confirm row (apply immediately when the side chat's answer block parses); default false.`
2. **DEFAULT_CONFIG** (~:121): add `sideChatAutoApply: false`. Do NOT add a `sideChatModel` key at all — `loadConfigFrom` does `coerceConfig(deepMerge(DEFAULT_CONFIG, user), user)`, so a defaulted key would defeat the absent-vs-set distinction; omission keeps `undefined` reachable.
3. **Coercion** (`coerceConfig` :227-238): `sideChatAutoApply: coerceBoolean(src.sideChatAutoApply, false)`; new optional-string path for `sideChatModel: typeof v === "string" && v.trim() !== "" ? v : undefined` (inline or a `coerceOptionalString` helper — either is fine; no DEFAULT_CONFIG fallback involved).
4. **JSDoc config reference** (toggles table ~:303-311, format of the `compactionPreservation` row at :309): add both rows; extend the count string (~:263, updated by P1.M1.T1.S1) if it enumerates rows.
5. **Tests** (`src/config.test.ts`, following the toggle-test shapes at :98/:106): boolean coercion matrix (true/false/"true"/"false"/absent→false/bad→false) and optional-string matrix (valid passes / whitespace→undefined / absent→undefined / non-string→undefined) + a DEFAULT_CONFIG shape regression (new key present; `sideChatModel` absent).

### Success Criteria

- [ ] Resolved `config.sideChatAutoApply === false` by default; coercions per matrix
- [ ] Resolved `config.sideChatModel === undefined` when absent/blank/ill-typed; exact string when set
- [ ] `DEFAULT_CONFIG` has no `sideChatModel` key (deep-merge + coercion yield undefined)
- [ ] Both JSDoc rows present (Mode A); consumer map comment (~:22) not required to name future consumers
- [ ] config-surface.test.ts untouched (keys-only fixtures per recipe step 5); full suite green

## All Needed Context

### Context Completeness Check

Small, fully-specified config change. The recipe is verbatim in the architecture doc; the coercion/gotcha analysis is in research/notes.md. Agent needs this PRP plus `src/config.ts` and `src/config.test.ts`.

### Documentation & References

```yaml
- file: plan/005_af804251f18d/architecture/config-and-keys-rename.md
  why: "§New-config recipe (:41-52) — the precedent steps (compactionPreservation), including the optional-string note and the keys-only fixture caveat"

- file: plan/005_af804251f18d/P1M1T2S1/research/notes.md
  why: verified current line anchors + the deep-merge absent-vs-default gotcha + test matrix

- file: src/config.ts
  why: "interface :81-86, DEFAULT_CONFIG ~:121, coerceBoolean :184, coerceConfig :227-238, JSDoc table :303-311"
  pattern: "mirror compactionPreservation verbatim for the boolean; NO default key for the optional string (gotcha in notes)"

- file: src/config.test.ts
  why: "toggle test shapes :98/:106; use loadConfigFrom with temp-dir fixtures (existing convention)"
```

### Current/Derived Codebase tree

```bash
src/
├── config.ts        # MODIFY: +2 fields, +1 default, +2 coercions, +2 JSDoc rows
└── config.test.ts   # MODIFY: +~6 tests
```

### Known Gotchas

```ts
// CRITICAL: do NOT add sideChatModel to DEFAULT_CONFIG — deepMerge(DEFAULT, user)
//   would always define it and coerceConfig could never return undefined.
// GOTCHA: optional-string check is `typeof v === "string" && v.trim() !== ""` —
//   store the ORIGINAL string (no re-trim) when non-blank.
// GOTCHA: tsconfig is strict — `sideChatModel?: string` + `undefined` assignment is fine;
//   avoid `sideChatModel: undefined` in object literals if exactOptionalPropertyTypes is on
//   (check tsconfig; omit the key instead).
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: TESTS FIRST (src/config.test.ts)
  - boolean matrix + optional-string matrix + DEFAULT_CONFIG shape regression
    (sideChatAutoApply false present; 'sideChatModel' in DEFAULT_CONFIG === false)
  - RUN → new tests red

Task 2: IMPLEMENT (src/config.ts)
  - interface fields + JSDoc; DEFAULT_CONFIG sideChatAutoApply: false (no model key)
  - coerceConfig: coerceBoolean(src.sideChatAutoApply, false) + optional-string path
  - JSDoc toggles-table rows; count string if needed

Task 3: RUN gates
  - npx vitest run src/config.test.ts -v && npm run typecheck && npm test
```

### Implementation Patterns & Key Details

```ts
// coerceConfig additions:
sideChatAutoApply: coerceBoolean(src.sideChatAutoApply, false),
sideChatModel:
  typeof src.sideChatModel === "string" && src.sideChatModel.trim() !== ""
    ? src.sideChatModel
    : undefined,
```

### Integration Points

```yaml
CONSUMERS (contracts only, no wiring): "P1.M1.T5.S1 reads config.sideChatModel; P1.M1.T6.S2 reads config.sideChatAutoApply — nothing else may read raw settings for these keys"
NO CHANGES to: config-surface.test.ts, keys, loadConfig paths, any consumer
```

## Validation Loop

```bash
npm run typecheck
npx vitest run src/config.test.ts -v
npm test
```

## Final Validation Checklist

- [ ] Typecheck + full suite green; TDD red→green observed
- [ ] Coercion matrices proven; undefined-not-absent-default semantics for sideChatModel
- [ ] DEFAULT_CONFIG: sideChatAutoApply false, no sideChatModel key
- [ ] JSDoc rows present (Mode A); only config.ts + config.test.ts touched

## Anti-Patterns to Avoid

- ❌ Don't default `sideChatModel` in DEFAULT_CONFIG — kills the undefined semantics
- ❌ Don't trim the stored value — only blank-check with trim
- ❌ Don't touch keys fixtures or config-surface.test.ts
- ❌ Don't wire consumers — later subtasks own that

---

**Confidence Score**: 10/10 — recipe verbatim in the architecture doc; all anchors verified against the working tree; the single real trap (deep-merge absent-vs-default) is explicitly handled.

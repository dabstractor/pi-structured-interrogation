# PRP — P1.M1.T1.S2: Silent `discuss`→`chat` compat alias in coerceKeys

## Goal

**Feature Goal**: Users with an existing `settings.json` carrying the old `keys.discuss` entry (renamed to `keys.chat` by P1.M1.T1.S1) must keep working: `coerceKeys` silently drops unknown action names, so post-rename the old binding would vanish. Add the silent, presence-based compat alias — legacy `discuss` feeds `chat` when the user has not explicitly set the new name — copying the exact `focusText`→`elaborate` precedent at src/config.ts:192-210.

**Deliverable**: ~5 lines in `coerceKeys` (+ one-line maintainer comment) in `src/config.ts`, and alias tests in `src/config.test.ts`.

**Success Definition**:
- Settings `{keys:{discuss:"ctrl+shift+d"}}` → resolved `cfg.keys.chat === "ctrl+shift+d"`; `resolveKeyLabels(cfg).chat` and the footer reflect it; `discuss` key absent from the resolved keys map
- Explicit valid `keys.chat` ALWAYS wins — including when it equals the default `"e"` (presence-based, read on the RAW pre-merge user map)
- Invalid/blank legacy `discuss` ignored → default
- Silent — never logged, never warned
- After this subtask, the name `discuss` exists in src/ ONLY at the coerceKeys alias site (+comment) and the alias tests (discussInChat/discuss.ts are a different identifier and remain until P1.M2.T7.S1)
- `npm run typecheck` + full `npm test` green

## Why

SIDECHAT-001 (h2.80, 2026-10-15) renames `keys.discuss` → `keys.chat`. Without an alias, a pre-rename settings file silently loses its custom binding. The repo already solved this exact problem once (BAREKEYS-001's `focusText`→`elaborate` alias, config.ts:192-210 with its presence-based userKeys threading) — this subtask replicates that mechanism verbatim for the second rename.

## What

In `coerceKeys` (src/config.ts:192-210), alongside the existing focusText alias, add the chat alias using the same shape:

```ts
// Legacy alias (SIDECHAT-001 rename): a pre-rename keys.discuss binding
// silently feeds keys.chat when the user has not set the new name; never
// logged. Presence-based on the raw pre-merge user map (see focusText above):
// an explicit valid keys.chat ALWAYS wins, even when equal to the default.
const chatExplicit = typeof user.chat === "string" && user.chat.trim() !== "";
const discussValid = typeof src.discuss === "string" && src.discuss.trim() !== "";
```
and fold into `effSrc`: when `!chatExplicit && discussValid`, set `chat: src.discuss` (compose with the existing elaborate alias in ONE effSrc build, or chain two conditional spreads — either is fine as long as precedence is independent per action). The existing per-action loop and `coerceConfig(raw, userRaw)` threading (:225, :259) are untouched — the userKeys plumbing already exists for focusText.

### Success Criteria

- [ ] Alias matrix green in `src/config.test.ts` (mirror of the focusText describe at :168-200)
- [ ] Presence-based row: explicit `keys.chat === "e"` (equal to default) + legacy discuss present → chat wins
- [ ] Alias assertions reference `DEFAULT_CONFIG.keys.chat` for defaults (value-agnostic)
- [ ] Zero console output; `discuss` absent from resolved keys
- [ ] `grep -rn "discuss" src/ | grep -v discussInChat | grep -v "discuss.ts" | grep -v discuss.test` → only coerceKeys alias + comment + config.test.ts alias rows
- [ ] Full suite + typecheck green; no changes outside coerceKeys (+tests)

## All Needed Context

### Context Completeness Check

Repo green at HEAD; the focusText alias precedent (code + tests) already exists in the working tree and is quoted here in full. The implementing agent needs this PRP plus `src/config.ts` (:178-260) and `src/config.test.ts` (:168-200).

### Documentation & References

```yaml
- file: plan/005_af804251f18d/P1M1T1S1/PRP.md
  why: "CONTRACT — S1 renames discuss→chat everywhere (value stays 'e', onChat bridge still calls discussInChat), flips config-surface's raw-settings fixture :547-554 to `chat`, and explicitly reserves the coerceKeys alias for THIS subtask"
  critical: "S1's keymap-guard completeness test asserts the DEFAULT_CONFIG.keys key set — the alias must NOT add discuss to KeyAction/KEY_ACTIONS/defaults"

- file: plan/005_af804251f18d/P1M1T1S2/research/notes.md
  why: "verbatim excerpts of the focusText alias (config.ts:192-210), the loadConfigFrom userKeys threading (:259), the architecture doc's verbatim alias shape, and the test-precedent rows"

- file: plan/005_af804251f18d/architecture/config-and-keys-rename.md
  why: "§Silent alias mechanism — the exact effSrc shape to copy; explains why the RAW pre-merge user map is threaded (deepMerge cannot distinguish absent from rebound-to-default)"
  section: "§Silent alias mechanism"

- file: src/config.ts
  why: "coerceKeys :192-210 — the focusText alias to mirror VERBATIM in shape (userKeys presence check, effSrc conditional spread, one maintainer comment); coerceConfig :225 + loadConfigFrom :259 already thread the raw user map — zero plumbing needed"
  gotcha: "src.discuss reads a name that exists in NO type — that's the point (raw-settings-only name), exactly like src.focusText today"

- file: src/config.test.ts
  why: "the focusText alias describe :168-200 — the row shapes to mirror (alias-feeds, explicit-wins, explicit-equal-to-default-still-wins, legacy-key-absent-from-resolved)"
  pattern: "writeSettings(JSON.stringify({interrogator:{keys:{...}}})) into a temp path; loadConfigFrom({global: g}); assert cfg.keys.chat + (cfg.keys as Record<string,unknown>).discuss undefined"
```

### Current Codebase tree (relevant excerpt)

```bash
src/
├── config.ts           # coerceKeys :192-210 — ADD chat alias + comment (only source change)
└── config.test.ts      # ADD "discuss→chat legacy alias (SIDECHAT-001)" describe — MODIFY (add only)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: presence must be read on `user` (the RAW pre-merge user map), not
//   `src` (the DEFAULT-merged map) — after deepMerge, chat:"e" is always
//   present, so an src-based check would let the default mask the legacy
//   binding. The focusText alias already threads userKeys; reuse it.
// CRITICAL: do NOT add "discuss" to KeyAction, KEY_ACTIONS, DEFAULT_CONFIG,
//   labels, or keymap-guard ALL_ACTIONS — raw-settings name only.
// GOTCHA: the two aliases (focusText→elaborate, discuss→chat) are INDEPENDENT
//   per action — compose the effSrc so neither interferes with the other.
// GOTCHA: alias tests must not hardcode "e" — assert against
//   DEFAULT_CONFIG.keys.chat so later default changes can't break them.
// GOTCHA: silence is contractual — no console.warn/log; mirror the focusText
//   tests' silence coverage (or add a spy row if they lack one).
// GOTCHA: discussInChat / discuss.ts / discuss.test.ts are UNRELATED
//   identifiers that survive until P1.M2.T7.S1 — grep gates must exclude
//   them; do not touch them.
// GOTCHA: spec/ and README.md are READ-ONLY here — the old name must not
//   appear in any doc (Mode B sweep P1.M3.T3 enforces the final gate).
```

## Implementation Blueprint

### Implementation Tasks (TDD-ordered)

```yaml
Task 1: ADD failing alias tests to src/config.test.ts — new describe
  "discuss→chat legacy alias (SIDECHAT-001)" mirroring :168-200:
  - Row 1 (alias feeds): {"keys":{"discuss":"ctrl+shift+d"}} →
    cfg.keys.chat === "ctrl+shift+d";
    (cfg.keys as Record<string,unknown>).discuss === undefined;
    resolveKeyLabels(cfg).chat === "Ctrl+Shift+D"
  - Row 2 (explicit wins): {"keys":{"discuss":"ctrl+shift+d","chat":"ctrl+k"}}
    → chat "ctrl+k"
  - Row 3 (explicit-equal-to-default still wins): {"keys":{"discuss":"ctrl+shift+d",
    "chat": DEFAULT_CONFIG.keys.chat}} → chat stays the default (presence-based,
    read on the raw map)
  - Row 4 (blank/invalid legacy ignored): {"keys":{"discuss":""}} and a
    non-string variant → cfg.keys.chat === DEFAULT_CONFIG.keys.chat
  - Row 5 (silence): no console.warn during any alias load (spy)
  - Row 6 (cheap): global {keys:{discuss:"ctrl+shift+d"}} + project {} → alias
    applies after merge

Task 2: ADD the alias in coerceKeys (config.ts :192-210)
  - Insert chatExplicit/discussValid + fold into the effSrc build alongside
    the focusText alias (independent precedence per action)
  - One-line maintainer comment naming SIDECHAT-001 and the never-logged rule
  - coerceConfig / loadConfigFrom / KEY_ACTIONS / defaults untouched

Task 3: GREP GATE
  - grep -rn "discuss" src/ | grep -v discussInChat | grep -v "discuss.ts" |
    grep -v discuss.test → ONLY coerceKeys alias site + comment +
    config.test.ts alias rows
  - grep -rn "discuss" README.md spec/ → EMPTY (nothing added)

Task 4: RUN gates
  - npx vitest run src/config.test.ts src/config-surface.test.ts src/keymap-guard.test.ts
  - npm run typecheck && npm test
```

### Implementation Patterns & Key Details

```ts
// coerceKeys after (both aliases, independent per action):
const user = isPlainObject(userKeys) ? userKeys : {};
// …existing focusText→elaborate comment + code…
const elaborateExplicit = typeof user.elaborate === "string" && user.elaborate.trim() !== "";
const legacyFocusValid = typeof src.focusText === "string" && src.focusText.trim() !== "";
// Legacy alias (SIDECHAT-001 rename): a pre-rename keys.discuss binding
// silently feeds keys.chat when the user has not set the new name; never
// logged. Presence-based on the raw user map (see focusText above).
const chatExplicit = typeof user.chat === "string" && user.chat.trim() !== "";
const discussValid = typeof src.discuss === "string" && src.discuss.trim() !== "";
let effSrc = src;
if (!elaborateExplicit && legacyFocusValid) effSrc = { ...effSrc, elaborate: src.focusText };
if (!chatExplicit && discussValid) effSrc = { ...effSrc, chat: src.discuss };
// …existing KEY_ACTIONS loop over effSrc unchanged…
```

### Integration Points

```yaml
UPSTREAM: "S1's rename makes discuss a dead raw-settings name — this alias revives it silently; value stays 'e'"
DOWNSTREAM: "every config consumer inherits implicitly; the final `discuss` doc/grep sweep is P1.M3.T3.S2; discuss engine deletion is P1.M2.T7.S1 (unaffected)"
DOCS: "none — the maintainer comment IS the Mode A deliverable; the old name must never reach README/spec"
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
grep -rn "discuss" src/ | grep -v discussInChat | grep -v "discuss.ts" | grep -v discuss.test   # only alias site + tests
```

### Level 2: Unit Tests

```bash
npx vitest run src/config.test.ts -v                  # new alias describe green
npx vitest run src/config-surface.test.ts src/keymap-guard.test.ts   # key-set completeness untouched
npm test
```

### Level 3: Behavior-identical spot checks

```bash
npx vitest run src/panel/keys.test.ts src/panel/layout.test.ts    # chat label/footer unchanged for non-legacy configs
npx vitest run src/config.test.ts -t "focusText"                  # the first alias still green (no interference)
```

### Level 4: Behavior matrix (manual)

- [ ] No-legacy configs byte-identical; both-present; invalid-legacy; explicit-equal-to-default; silence — each row tested

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green
- [ ] Alias precedence matrix green (feeds / explicit-wins / explicit-equal-default-wins / invalid-ignored / silent)
- [ ] Presence read on the RAW user map (userKeys), not the merged map
- [ ] `discuss` absent from KeyAction/KEY_ACTIONS/defaults/labels/keymap-guard and all docs; resolved keys carry no `discuss` key
- [ ] focusText alias unaffected (its tests still green)
- [ ] Alias tests value-agnostic (DEFAULT_CONFIG.keys.chat, no literal "e")
- [ ] Only coerceKeys (+config.test.ts) changed

## Anti-Patterns to Avoid

- ❌ Don't read presence on the DEFAULT-merged map — the default would mask the legacy binding
- ❌ Don't add discuss to any type/array/default — raw-settings name only
- ❌ Don't warn/log — silent by contract
- ❌ Don't couple the two aliases' precedence — independent per action
- ❌ Don't hardcode "e" in tests
- ❌ Don't touch discuss.ts/discussInChat (P1.M2.T7.S1 owns deletion) or README/spec (Mode B)
- ❌ Don't restructure coerceConfig/loadConfigFrom — the plumbing already exists

---

**Confidence Score**: 10/10 — an exact copy of an in-tree precedent (focusText alias code AND tests) with the plumbing already threaded; the only new decision (composing two independent aliases) is spelled out with drop-in code.

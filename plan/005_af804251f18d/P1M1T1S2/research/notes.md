# Research — P1.M1.T1.S2 (plan 005): silent discuss→chat compat alias in coerceKeys

Verified against working tree.

## Precedent already in place: the focusText→elaborate alias (src/config.ts:192-210)
`coerceKeys(raw, userKeys?)`:
- `src = isPlainObject(raw) ? raw : {}`
- presence-based alias: `user = isPlainObject(userKeys) ? userKeys : {}`; `elaborateExplicit = typeof user.elaborate === "string" && user.elaborate.trim() !== ""`; `legacyValid = typeof src.focusText === "string" && src.focusText.trim() !== ""`; `effSrc = !elaborateExplicit && legacyValid ? { ...src, elaborate: src.focusText } : src`
- loop reads `effSrc[action]`, falls back to `DEFAULT_CONFIG.keys[action]`
- `coerceConfig(raw, userRaw?)` at :225 threads `userRaw` (verify it passes userRaw into coerceKeys — the focusText threading at :259: `return coerceConfig(deepMerge(DEFAULT_CONFIG, user), user)` — the raw USER map, pre-DEFAULT merge, is required because deepMerge cannot distinguish absent from rebound-to-default).
- Long maintainer comment at :193-201 explains the mechanism.

Why userKeys (raw pre-merge): loadConfigFrom :259-260 deep-merges DEFAULT_CONFIG first — merged map can't tell "chat absent" from "chat explicitly set to default 'e'". Presence must be read on the raw user map.

## Alias to add (verbatim shape, per architecture/config-and-keys-rename.md §Silent alias mechanism)
```ts
const chatExplicit = typeof user.chat === "string" && user.chat.trim() !== "";
const legacyValid = typeof src.discuss === "string" && src.discuss.trim() !== "";
// (fold into one effSrc: alias discuss→chat when !chatExplicit && legacyValid)
```
One-line maintainer comment mirroring the focusText one (naming the SIDECHAT rename). Silent — never logged/warned. Explicit valid keys.chat ALWAYS wins even when equal to the default "e".

Note: after S1's rename, `discuss` exists nowhere in src/ types — `src.discuss` reads a raw-settings-only name on an unknown-key object (typed via cast/index — same as focusText does: the loop already indexes `effSrc[action]`; reading `src.discuss` needs `(src as Record<string, unknown>)` or is fine since src is `Record<string, unknown>`-ish from isPlainObject — check the focusText precedent: it reads `src.focusText` directly; src's type after isPlainObject guard permits it).

## Test precedent (config.test.ts :168-200)
describe "focusText→elaborate legacy alias (BAREKEYS-001)" with rows: alias feeds when absent; explicit wins; explicit-equal-to-default still wins (presence-based, raw-map read); plus focusText key absent from resolved keys. Mirror with discuss→chat rows.

## Grep gate
After this subtask, `discuss` in src/ exists ONLY at the coerceKeys alias site (+comment) and the alias tests. discussInChat/discuss.ts/discuss.test.ts still exist (deleted P1.M2.T7.S1) — those are `discussInChat`, not the settings key; the grep excludes them. The name must NOT appear in any doc (Mode B sweep P1.M3.T3).

## Raw-settings test material
config-surface.test.ts :547-554 (per S1's PRP) flips its raw-settings fixture to `chat` — S1 asserts the new name; S2 adds the alias rows in config.test.ts only.

# Research notes — P1.M1.T2.S1 (sideChatModel + sideChatAutoApply config fields)

## Verified facts (src/config.ts current)
- `InterrogatorConfig` toggles live at :81-86 (`compactionPreservation: boolean` at :84) — recipe precedent.
- `DEFAULT_CONFIG` `compactionPreservation: true` at :121.
- `coerceBoolean(value, fallback)` at :184; `coerceConfig` at :227-238 (returns keys, 3 booleans, editorMode, escExitWindowMs).
- JSDoc toggles table rows ~:303-311 (compactionPreservation row at :309); consumer map at :22.
- GOTCHA: `loadConfigFrom` does `coerceConfig(deepMerge(DEFAULT_CONFIG, user), user)` — the merged `src` always carries DEFAULT_CONFIG values, so a default-merged `sideChatAutoApply: false` is indistinguishable from absent. Boolean coercion is unaffected (same fallback), but for `sideChatModel` the OPTIONAL-string path must yield `undefined` when the value is absent/blank — with deep-merge, `DEFAULT_CONFIG` must NOT define `sideChatModel` at all (absent key survives the merge unless user supplies one) so the `typeof === "string" && trim` check sees undefined → undefined. Do NOT add `sideChatModel: undefined` to DEFAULT_CONFIG (ts exactOptionalPropertyTypes/JSON churn) — omit the key entirely.
- `escExitWindowMs: Math.max(0, coerceNumber(...))` shows the numeric-tail pattern; ours goes before editorMode or after compactionPreservation (grouped with toggles).
- Tests: src/config.test.ts toggle patterns `test_toggles_coerce_bad_values_to_defaults_and_keep_false` (:106), numeric-string toggle (:98). config-surface.test.ts fixtures stay keys-only (recipe step 5).
- Upstream contract: P1.M1.T1.S1 renamed keys.discuss→keys.chat (land on the post-rename shape); its count string at config.ts ~:263 was updated there — extend if the row count changes.

## Consumers (contracts only, no wiring here)
- P1.M1.T5.S1 model override reads `config.sideChatModel` (default = session model at chat open; invalid → notify + session model).
- P1.M1.T6.S2 confirm bypass reads `config.sideChatAutoApply`.
- Nothing else may read raw settings for these two keys.

## Test matrix (src/config.test.ts)
- sideChatAutoApply: true/false/"true"/"false"/absent→false/bad ("yes", 1, null)→false
- sideChatModel: valid string passes; whitespace-only→undefined; absent→undefined; non-string (number/bool/null)→undefined; trim preserved (no extra trim of value itself — store as given if non-blank)
- Regression: existing toggle tests + full DEFAULT_CONFIG shape test (new key present: sideChatAutoApply; sideChatModel ABSENT — `'sideChatModel' in DEFAULT_CONFIG === false` or toEqual without the key).

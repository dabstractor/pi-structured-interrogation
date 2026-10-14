# Research — P1.M1.T1.S2: silent focusText→elaborate compat alias in coerceKeys

Verified against working tree + architecture/config-surface.md §2.

## The seam (src/config.ts, post-S1)
- `coerceKeys(raw)` :195-202: `src = isPlainObject(raw) ? raw : {}`; loops `KEY_ACTIONS`; per action `out[action] = typeof v === "string" && v.trim() !== "" ? v : DEFAULT_CONFIG.keys[action]`. Unknown action names (e.g. a stale `focusText` post-rename) are silently DROPPED — hence the alias.
- `coerceConfig(raw)` :216-225 rebuilds field-by-field — `coerceKeys(src.keys)` at :219 is the ONLY place settings key names are read. Alias inside coerceKeys (before the loop) per config-surface.md §2 "Alias seam" guidance.
- No alias precedent in config.ts — add fresh. Tolerant-coercion posture (h2.74-era decisions :113): SILENT alias, no console.warn.
- After S1, `KEY_ACTIONS`/`DEFAULT_CONFIG.keys`/labels use `elaborate`; value still "ctrl+t" until T2 (alias is name-level, value-agnostic).

## Alias rule (from item contract)
In coerceKeys, before the loop:
- if `typeof src.focusText === "string" && src.focusText.trim() !== ""` AND `src.elaborate` is NOT a valid string (absent / non-string / empty) → use `src.focusText` as the source for `elaborate`.
- explicit valid `keys.elaborate` ALWAYS wins; invalid `elaborate` + valid `focusText` → alias value (not default).
Implementation shape: compute `const srcElaborate = (typeof src.elaborate === "string" && src.elaborate.trim() !== "") ? src.elaborate : (typeof src.focusText === "string" && src.focusText.trim() !== "" ? src.focusText : undefined);` then let the existing loop read from an augmented source, or special-case the `elaborate` iteration. Keep it inside coerceKeys so coerceConfig is untouched.

## Label/footer propagation
resolveKeyLabels iterates KEY_ACTIONS generically — `labels.elaborate` derives from the resolved keys.elaborate, so an aliased "ctrl+t" yields "Ctrl+T" and the footer's `${labels.elaborate} explain` reflects it automatically. No label-side work.

## Test conventions (config.test.ts)
- All tests run `loadConfigFrom({ global, project })` with mkdtemp temp files (`writeConfig(p, obj)` helper at :29-32); imports DEFAULT_CONFIG/loadConfigFrom/resolveKeyLabels (:12).
- Test matrix per contract:
  1. settings `{keys:{focusText:"ctrl+t"}}` → cfg.keys.elaborate === "ctrl+t"; resolveKeyLabels(cfg).elaborate === "Ctrl+T"
  2. both present `{keys:{focusText:"ctrl+j", elaborate:"ctrl+k"}}` → elaborate "ctrl+k"
  3. focusText valid + elaborate invalid (e.g. "" or 42) → alias value used, NOT default
  4. focusText invalid (empty/non-string) + elaborate absent → default ("ctrl+t" until T2 flips to "t" — assert against DEFAULT_CONFIG.keys.elaborate, not a literal, to stay flip-proof)
  5. alias is silent: no console.warn side effect (spy or just assert no throw; contract says silent — a vi.spyOn(console,"warn") toHaveBeenCalledTimes(0) row is cheap insurance)

## Grep gate (PRD): the name focusText must NOT appear in any doc — the ONLY permitted occurrences in src/ are the alias site in config.ts (+ its one-line maintainer comment) and the alias tests. No README/spec mention (spec is READ-ONLY; README is T2's Mode B task).

## Downstream
- P1.M1.T2.S1 default-value tests: assert alias tests against DEFAULT_CONFIG.keys.elaborate (not literal "ctrl+t") so the T2 value flip doesn't break them.
- P1.M4.T1.S2 AC-4 scripted coverage: AC-12 "every default hotkey remappable; footer reflects remap" — the alias keeps old settings files working through the rename.

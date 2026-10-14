# Research notes — P1.M2.T1.S1 (VIMNAV-001: hjkl fixed aliases in keys.ts)

## Live code (src/panel/keys.ts, post-M1 drift)

- **↑/↓ fixed branches** — :439-448: `if (!editorFocused && matchesKey(data, Key.up)) { overview→overviewUp / deep→deepSelectionUp / else actions.optionUp }` and mirror for down. `editorFocused` derived earlier from `panel.focus === "text" || panel.focus === "note"` (check its exact derivation at the top of the returned router; grep `editorFocused =`).
- **←/→ fixed branch** — :459-467: gated by `panel.focus !== "text" && panel.focus !== "note"`; left → `overviewUp` in overview else `actions.prevQuestion`; right → `overviewDown` / `actions.nextQuestion`.
- **Fixed-keys doc block** :34-48+ (Mode A section "fixed keys (never config-driven)") — extend to list hjkl.
- `matchesKey(data, accel)` handles bare single chars (defaults d/o/t/m/e are resolved bare bindings matched the same way). For the FIXED aliases the cleanest match is exact byte equality `data === "k"` (no parse needed; a bare letter never arrives with modifiers). An `isBareBinding` helper exists (:227) but is for resolved config strings — not needed here.
- **Ordering guarantee**: fixed branches (1a/1b) run BEFORE config accelerators (step 4) and before esc — so if a user REMAPS some action to a bare `k`, the fixed alias shadows the remap (documented collision-winner order; mirrors arrows which already shadow everything). Note in doc block.
- Default bare letters are d/o/t/m/e — h/j/k/l collide with nothing today.
- editorFocused gate note: ↑/↓ use `!editorFocused`; ←/→ use the explicit focus!=="text"&&"note" check — same semantics; aliases ride the SAME condition (extend the `if` with `|| data === "k"` etc., not a new branch).

## Tests (src/panel/keys.test.ts)

- Raw-byte constants :40-43 (UP/DOWN/LEFT/RIGHT escape sequences); hjkl are plain "k"/"j"/"h"/"l" strings.
- "buildKeyRouter — fixed keys and gating" describe :427+ — arrows dispatch regardless of config (:428), ←/→ clamp tests :479-492, editor-focus forwarding :503-504 (LEFT/RIGHT return false in text/note focus). Extend this describe.
- makeRouter / makeActions / makePanel stubs (router + panel stubs; no external mocks).
- keymap-guard.test.ts (src/) — completeness list must NOT gain hjkl (they're absent from KeyAction by design).

## Config fence (AC-2)

hjkl must NOT appear in: `KeyAction` union (config.ts), `KEY_ACTIONS` (keys.ts :234-235), `DEFAULT_CONFIG.keys`, config JSDoc tables. They are fixed like arrows.

## Interactions

- P1.M3 (later): digit branch deletion — hjkl untouched; digits become inert. Digit tests in the same describe will be removed by P1.M3, not here.
- P1.M1.T2.S3 (in flight): footer hint drop while editor focused — no overlap (display only).
- P1.M4.T1.S2 consumes this contract for AC-2 scripted coverage; P1.M4.T2.S1 README table.
- BAREKEYS-001 tier note: hjkl are PRINTABLE fixed keys → tier-2 behavior (forward in editor focus) exactly like the arrows' editor gating; spec ui-spec:94: "k/j are checked in the same fixed branch as ↑/↓ — identical view-aware semantics and identical editor-focus forwarding (VIMNAV-001)".

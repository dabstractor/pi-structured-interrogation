---
name: "P1.M2.T1.S1 — Add k/j to the fixed ↑/↓ branch and h/l to ←/→ with identical gating (VIMNAV-001)"
description: "Extend the two fixed-arrow branches in src/panel/keys.ts buildKeyRouter: the ↑ condition ORs a bare 'k' byte, ↓ ORs 'j', ← ORs 'h', → ORs 'l' — same editor-focus gate (forward/return false while focus==='text'||'note' so they TYPE), same per-view dispatch (overview: cursor row; deep: selection; short: option cursor incl. the ✎ Other row / prev-next question clamped no-wrap). hjkl are FIXED: absent from KeyAction/KEY_ACTIONS/DEFAULT_CONFIG/config JSDoc (AC-2 'nowhere in the config schema'). Extend the fixed-keys doc block. Raw-byte tests in keys.test.ts arrow suite; keymap-guard completeness list gains nothing. No mocks beyond the existing router/panel stubs."
---

## Goal

**Feature Goal**: VIMNAV-001 — `h`/`j`/`k`/`l` join the FIXED key family as aliases of `←`/`↓`/`↑`/`→` with byte-identical gating and dispatch, enabling vim-style navigation through questions and answer choices while the arrows stay for everyone else.

**Deliverable**: Modified `src/panel/keys.ts` (4 condition extensions in the two fixed branches + doc block) + extended tests in `src/panel/keys.test.ts`.

**Success Definition**: `npm test` + `npm run typecheck` green; in the short view `j`/`k` move the option cursor (domain includes the ✎ Other row) and `h`/`l` navigate questions clamped at both ends without wrap; in deep view `j`/`k` move the selection; in overview all four move the cursor row; all four forward (`route === false`) in text AND note focus (they type); arrows still work; hjkl appear nowhere in the config schema (keymap-guard untouched).

## User Persona

**Target User**: Vim-habituated pi user answering questions in the panel.

**Use Case**: User holds home-row: `j`/`k` walk options (including down to `✎ Other — write your own`), `h`/`l` walk questions (full list, every status, clamped), `enter` accepts — no arrow reach needed.

**Pain Points Addressed**: Arrow-only navigation forces hand travel for the panel's most frequent interactions; hjkl cost nothing (the panel owns the whole keyboard via `custom()` raw-input dispatch).

## Why

- h2.74 VIMNAV-001 (verbatim): hjkl "join the FIXED family as aliases… identical view-aware semantics…, identical editor-focus forwarding… Fixed, not configurable, exactly like the arrows they mirror."
- h2.35: "`k`/`j` are checked in the same fixed branch as `↑`/`↓` — identical view-aware semantics and identical editor-focus forwarding"; hjkl are printable → tier-2 behavior (never intercept in editor focus).
- R5 as amended (h2.74): the fixed family (`↑↓←→` + hjkl, `enter`, `esc`, `ctrl+c`) is the documented exception to configurability.
- P1.M4.T1.S2 (AC-2 scripted coverage) and P1.M4.T2.S1 (README fixed-keys table) consume this contract.

## What

### 1. The router change — `src/panel/keys.ts` buildKeyRouter

Current fixed branches (post-M1 drift; grep `matchesKey(data, Key.up)` for live lines):

```ts
if (!editorFocused && matchesKey(data, Key.up)) { /* overviewUp | deepSelectionUp | optionUp */ }
if (!editorFocused && matchesKey(data, Key.down)) { /* … */ }
if (panel.focus !== "text" && panel.focus !== "note") {
  if (matchesKey(data, Key.left)) { /* overviewUp | prevQuestion */ }
  if (matchesKey(data, Key.right)) { /* overviewDown | nextQuestion */ }
}
```

Extend the four conditions with exact bare-byte equality (a bare letter never carries modifiers, so `data === "k"` is the precise match — no parseAccelerator round-trip):

```ts
if (!editorFocused && (matchesKey(data, Key.up) || data === "k")) { … }
if (!editorFocused && (matchesKey(data, Key.down) || data === "j")) { … }
// …inside the focus gate:
if (matchesKey(data, Key.left) || data === "h") { … }
if (matchesKey(data, Key.right) || data === "l") { … }
```

Rules:
- **Identical gating**: the aliases ride the EXISTING conditions — never a new branch, never a different gate. While `focus === "text" || "note"` all four fall through (`return false`) → panel.ts hands the byte to the composed editor → the buffer grows. They must never be consumed-and-ignored.
- **Identical dispatch**: same inner view-switch lines, unchanged — short view option cursor domain already includes the ✎ Other row (`cursorDomainSize`); `prevQuestion`/`nextQuestion` already navigate the full list clamped, no wrap.
- **No config surface**: hjkl must NOT appear in `KeyAction` (config.ts), `KEY_ACTIONS` (keys.ts), `DEFAULT_CONFIG.keys`, or any config JSDoc/table. AC-2: "nowhere in the config schema". `src/keymap-guard.test.ts`'s completeness list gains NOTHING.
- **Collision order**: fixed branches run BEFORE config accelerators — if a user remaps an action to a bare `k`, the fixed alias shadows the remap (same as arrows today). Note this in the doc block, one sentence.

### 2. Doc block — keys.ts fixed-keys section (~:34-48, "Mode A — fixed keys (never config-driven)")

Extend: the fixed family is `up/down/left/right` **+ the hjkl aliases** (`k`=↑, `j`=↓, `h`=←, `l`=→ — VIMNAV-001, fixed exactly like the arrows they mirror, absent from the KeyAction union by construction); like the arrows they are not intercepted in text/note focus (printable keys must type); a config binding that collides with a fixed alias is shadowed by it (documented collision-winner order).

### 3. Tests — `src/panel/keys.test.ts`, extend the "buildKeyRouter — fixed keys and gating" describe (:427+)

Raw-byte style (hjkl are plain strings; reuse `makeRouter`/`makeActions`/`makePanel`; no external mocks):

1. `test_hjkl_alias_the_fixed_arrows_regardless_of_config`: mirror of :428 — even with hostile remaps, `route("k", …)` → optionUp called (not prevQuestion even if prevQuestion were somehow "k"); j/h/l likewise dispatch optionDown/prevQuestion/nextQuestion.
2. `test_jk_move_option_cursor_including_the_other_row`: short-view panel with a 2-option choice question → `route("j")` moves cursorIndex to the Other row index (options.length); `route("k")` back.
3. `test_hl_navigate_full_list_clamped_no_wrap`: multi-question panel → `route("h")` at q1 stays q1 (no wrap); `route("l")` advances through every status (moot/withdrawn/closed included) and clamps at the last.
4. `test_hjkl_deep_view_moves_selection` / `test_hjkl_overview_moves_cursor_row`: view-aware dispatch mirrors the arrow tests (deep: deepSelectionUp/Down; overview: overviewUp/Down for BOTH k/j and h/l).
5. `test_hjkl_forward_in_text_and_note_focus`: for focus "text" and "note", all four return `false` (mirror of :503-504) — they type.
6. `test_arrows_still_work_alongside_aliases`: the four arrow sequences still dispatch (regression guard).
7. `test_hjkl_absent_from_the_config_schema` (AC-2): assert `Object.keys(DEFAULT_CONFIG.keys)` contains none of "h","j","k","l" and the KeyAction-typed keys never bind them in `resolveBindings(DEFAULT_CONFIG)`; leave src/keymap-guard.test.ts untouched (its completeness list must stay hjkl-free).

### 4. Explicitly OUT of scope

- Digit quick-select removal (P1.M3 — digit tests in the same describe are P1.M3's to delete; don't touch them here).
- Footer hint behavior (P1.M1.T2.S3, in flight — display only, no overlap).
- README/config-reference tables (P1.M4.T2.S1); AC scripted coverage (P1.M4.T1.S2).
- Any change to `isBareBinding`, the tier table, `resolveBindings`, or the esc/enter branches.

### Success Criteria

- [ ] hjkl dispatch identically to the arrows in all three views, with identical editor-focus forwarding
- [ ] Zero config surface: absent from KeyAction/KEY_ACTIONS/DEFAULT_CONFIG/JSDoc; keymap-guard untouched and green
- [ ] Arrow behavior unchanged; existing arrow/gating tests green
- [ ] Fixed-keys doc block lists the aliases with the shadowing note (Mode A)

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets: the exact four condition extensions with code, the matching-strategy rationale (exact byte equality), the identical-gating rule, the config-fence list, the doc-block text to add, and seven enumerated tests with the describe and neighbor patterns. No guessing.

### Documentation & References

```yaml
- file: src/panel/keys.ts
  why: the two fixed branches (↑/↓ ~:439-448, ←/→ ~:459-467 — grep `matchesKey(data, Key.up)` for live lines), the fixed-keys doc block ~:34-48, editorFocused derivation, the step-4 tier dispatch (collision order proof)
  pattern: OR the bare byte into the EXISTING condition — never a new branch
  gotcha: bare letters never arrive with modifiers; use `data === "k"` not matchesKey/parseAccelerator

- file: src/panel/keys.test.ts
  why: raw-byte constants :40-43, "fixed keys and gating" describe :427+, arrow clamp tests :479-492, editor-focus forwarding :503-504, makeRouter/makeActions/makePanel stubs
  gotcha: digit tests in the same describe belong to P1.M3 — leave them alone
- file: src/keymap-guard.test.ts
  why: completeness list — must NOT gain hjkl (they are config-absent by design); its staying green IS the AC-2 proof alongside test 7
- file: src/config.ts
  why: KeyAction union + DEFAULT_CONFIG.keys — READ-ONLY reference proving hjkl are absent; no edits
- file: plan/004_49e25d5235a9/prd_snapshot.md (h2.74 VIMNAV-001, h2.35 hotkey table + fixed-key notes, h2.8 FR-9, h2.10)
  why: the alias contract, fixed-family list, R5 amendment, editor-forwarding rule
- file: plan/004_49e25d5235a9/P1M1.T2.S3/PRP.md (in flight)
  why: footer hint drop while editor focused — display-only sibling; no shared logic
```

### Current Codebase tree (relevant slice)

```bash
src/panel/ keys.ts (+ keys.test.ts)
src/ keymap-guard.test.ts   # read-only proof, untouched
src/ config.ts              # read-only reference, untouched
```

### Desired Codebase tree

```bash
# no new files
src/panel/keys.ts        # 4 condition ORs + doc block extension
src/panel/keys.test.ts   # +7 tests in the fixed-keys describe
```

### Known Gotchas of our codebase & Library Quirks

```ts
// Line numbers drift across the parallel M1 items — grep `matchesKey(data, Key.up)` / `Key.left` for live positions
// hjkl must ride the EXISTING gate expressions — a separate `if (data === "k")` branch invites gate drift later
// ←/→ gate reads panel.focus explicitly ("text"/"note"); ↑/↓ use the editorFocused local — same semantics, extend whichever condition you find
// fixed family is checked BEFORE config accelerators: a user remap to a bare "k" is shadowed — document, don't "fix"
// don't touch the digit branch/tests — P1.M3 deletes them wholesale
// hjkl are PRINTABLE tier-2 by nature: never intercept in editor focus; a consumed-and-ignore would break typing
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: WRITE the 7 tests first (What §3) — hjkl dispatch tests FAIL at HEAD; run npx vitest run src/panel/keys.test.ts to confirm
Task 2: MODIFY src/panel/keys.ts — the four condition ORs + doc block (What §1-2)
Task 3: GATES
  - npx vitest run src/panel/keys.test.ts src/keymap-guard.test.ts
  - npm test && npm run typecheck
```

### Implementation Patterns & Key Details

```ts
// The entire logic change (four ORs):
if (!editorFocused && (matchesKey(data, Key.up) || data === "k")) { … }
if (!editorFocused && (matchesKey(data, Key.down) || data === "j")) { … }
if (panel.focus !== "text" && panel.focus !== "note") {
  if (matchesKey(data, Key.left) || data === "h") { … }
  if (matchesKey(data, Key.right) || data === "l") { … }
}
```

### Integration Points

```yaml
DOWNSTREAM (do NOT implement):
  - P1.M4.T1.S2: AC-2 scripted coverage exercises hjkl end-to-end
  - P1.M4.T2.S1: README fixed-keys table lists hjkl aliases
CONFIG: none (fixed family — no config surface by design)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npx vitest run src/panel/keys.test.ts
```

### Level 2: Unit Tests

```bash
npx vitest run src/keymap-guard.test.ts
npm test   # full suite; parallel M1 items' tests must stay green
```

### Level 3: Integration Testing

Router+stub level covers the contract (P1.M4.T1.S2 adds the scripted end-to-end pass). Optional manual check with the extension linked: open the panel, navigate with hjkl across views, verify typing "test" in the editor inserts all letters.

### Level 4: Domain Validation

Trace vs h2.35 fixed-key notes: k/j in the same fixed branch as ↑/↓; h/l with ←/→; identical forwarding; clamped no-wrap; Other row reachable via j.

## Final Validation Checklist

- [ ] `npm test` + `npm run typecheck` green; arrows unaffected; digit tests untouched (P1.M3's)
- [ ] hjkl dispatch identically per view; forward (false) in text AND note focus; clamp/no-wrap preserved
- [ ] hjkl absent from KeyAction / KEY_ACTIONS / DEFAULT_CONFIG / config JSDoc; keymap-guard.test.ts unmodified and green
- [ ] 7 new tests pass; fixed-keys doc block extended with the alias list + shadowing note (Mode A)
- [ ] Only keys.ts + keys.test.ts modified

## Anti-Patterns to Avoid

- ❌ Don't create separate hjkl branches — the identical-gating contract rides the existing conditions
- ❌ Don't add hjkl to any config surface or the keymap-guard list — fixed means config-absent
- ❌ Don't intercept hjkl in editor focus — printable keys must type (BAREKEYS-001 tier-2 nature)
- ❌ Don't touch the digit path or footer logic — P1.M3 / P1.M1.T2.S3 own them
- ❌ Don't use matchesKey/parseAccelerator for the aliases — exact byte equality is the precise match

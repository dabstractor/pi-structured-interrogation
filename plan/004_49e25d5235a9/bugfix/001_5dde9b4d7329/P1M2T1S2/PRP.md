---
name: "P1.M2.T1.S2 — Widen keys.ts:566 externalEditor gate to editorFocused (any duty) + sync three stale comments + flip router tests (BUG-002 router side)"
description: "One-condition change in src/panel/keys.ts:566 — `panel.focus === \"text\"` → `editorFocused` (the canonical ESC-002 flag computed at keys.ts:425: focus === 'text' || 'note') — so ctrl+g (or a remapped chord) opens $EDITOR from note duty, matching spec/ui-spec.md:84 'editor focus (any duty)'. The bare tier-2 guard at :567 is UNCHANGED (bare remaps type in both duties). Sync three stale text-focus-only comments to 'editor focus (any duty: write-in, elaboration, note)': module JSDoc (~:96), seam interface comment (~:145), gate comment (:562-564). TDD: add the note-focus positive leg to keys.test.ts first (red), then widen (green); rename test_externalEditor_only_in_text_focus (:349-357) to any-duty semantics keeping options-negative and text-positive legs. PREREQUISITE: P1.M2.T1.S1's note-duty routing fork must be landed (the gate is only safe to open after the apply side is duty-correct)."
---

## Goal

**Feature Goal**: BUG-002 router half — the externalEditor config intercept fires for ANY editor duty (write-in, elaboration, note), keyed off the canonical `editorFocused` flag instead of `focus === "text"` only, so ctrl+g opens `$VISUAL`/`$EDITOR` from batch-note mode just like the other two duties.

**Deliverable**: Modified `src/panel/keys.ts` (gate :566 + three comment syncs) and `src/panel/keys.test.ts` (renamed/extended router test). No spec edit (spec/ui-spec.md:84 already reads "editor focus (any duty)").

**Success Definition**: `npm test` + `npm run typecheck` green; router-level: `\u0007` from `focus: "note"` → consumed + `onExternalEditor` dispatched exactly once; from `focus: "text"` → consumed (unchanged); from `focus: "options"` → false + not dispatched (unchanged); a bare remap of externalEditor forwards (types) in BOTH text and note duty (tier-2 guard unchanged); all other keys.test.ts router tests green unmodified.

## User Persona

**Target User**: TUI user composing a batch note (`m`) with a long note that deserves a real editor.

**Use Case**: Press `m` (focus → "note"), then ctrl+g → `$VISUAL`/`$EDITOR` opens seeded with the note draft; the completed text routes back to the note (P1.M2.T1.S1's fork).

**User Journey**: note mode → ctrl+g → external editor opens (previously: dead — the BEL byte fell through the router and was harmlessly swallowed by the TextField) → edit → clean exit → note updated + persisted via `drafts.setNote`.

**Pain Points Addressed**: PRD h2.3/h3.1 BUG-002 — "the feature is dead" in note duty while the ui-spec promises "editor focus (any duty)" for the one embedded editor's three duties.

## Why

- PRD h2.5 recommendation (verbatim): "Widen the externalEditor intercept gate in src/panel/keys.ts:566 to focus === 'text' || focus === 'note'…" — `editorFocused` IS that disjunction, already computed at keys.ts:425 for the other editor-focus exceptions (ESC-002, tier-2 guards). Using the flag instead of re-spelling the disjunction keeps one canonical definition.
- ui-spec hotkey row (spec/ui-spec.md:84): context "editor focus (any duty) — MUST stay modifier-bearing… (BAREKEYS-001)". The current gate violates the spec; the spec is right (FR-12/h2.31 places the ctrl+g affordance in the free-text section covering all three duties of the one editor).
- Order-of-landing with P1.M2.T1.S1: the apply-side routing fork (`bufferOwner === "note"` → batchNote/setNote, never the question slot) must land FIRST — this item opens the gate only when the apply side is duty-correct, so there is no corruption window.
- P1.M2.T1.S3 then adds the end-to-end round-trip AC; this item makes the router truthful and test-pinned.

## What

### 1. The gate — `src/panel/keys.ts` :566

Current:

```ts
if (panel.focus === "text" && matchesKey(data, b.externalEditor)) {
  if (bare.externalEditor) return false; // tier 2 in its only context
  actions.onExternalEditor(panel);
  return true;
}
```

Change the first condition to `editorFocused &&` — nothing else in the block moves. `editorFocused` is already in scope (computed at :425 before step 4's intercept chain: `panel.focus === "text" || panel.focus === "note"`).

- **Bare tier-2 guard (:567) UNCHANGED**: in note duty the editor holds focus, so a bare remap must TYPE (BAREKEYS-001) — `return false` → panel.ts:831-834 forwards the byte into the TextField, which types it, in both duties.
- Options focus still ignores the chord entirely (`editorFocused` false) — ctrl+g stays free in every non-editor context.
- Resolution order is untouched: externalEditor remains the 7th intercept in step 4, after submit/discuss, before prevQuestion.

### 2. Comment syncs — three sites, wording "editor focus (any duty: write-in, elaboration, note)"

1. Module resolution-order JSDoc (~keys.ts:96, step-4 list): `externalEditor (only when focus === "text")` → `externalEditor (editor focus, any duty: write-in, elaboration, note — BUG-002)`.
2. Seam interface comment (~keys.ts:145): `/** External editor (text-focus context only). Wired by M4.T1.S3. */` → `/** External editor (editor focus, any duty: write-in, elaboration, note). Wired by M4.T1.S3. */`
3. Gate comment (:562-564): rewrite to "externalEditor is editor-focus context, any duty (BUG-002 — one embedded editor, three duties; ESC-002's editorFocused definition). Gated so ctrl+g stays free in every non-editor context. TIER: its only valid context is editor focus, where a bare key must type — a bare remap therefore never intercepts (decisions :113-115; keep the chord)." Keep the decisions reference.

These three comment updates ARE this seam's Mode A doc sync; spec/ui-spec.md:84 already reads correctly — verify with a grep, do NOT edit the spec.

### 3. Tests — TDD failing-first — `src/panel/keys.test.ts`

Rename `test_externalEditor_only_in_text_focus` (:349-357) → `test_externalEditor_in_editor_focus_any_duty` (or equivalent), reusing `makeActions()`, `makeRouter(DEFAULT_CONFIG, actions)`, `DEFAULT_DATA.externalEditor` (`"\u0007"`, fixture :35):

1. KEEP options-focus negative leg (unchanged): `route(DEFAULT_DATA.externalEditor, makePanel({ focus: "options" }))` → `false`, `onExternalEditor` not called.
2. KEEP text-focus positive leg (unchanged): `focus: "text"` → `true`, called once.
3. ADD note-focus positive leg (write FIRST, red before the gate change): `route(DEFAULT_DATA.externalEditor, makePanel({ focus: "note" }))` → `true`, `onExternalEditor` `toHaveBeenCalledTimes(1)`.
4. ADD bare-remap leg (stay-green for tier 2, mirrors the neighboring tier-2 tests): router built with a config whose `externalEditor` is a bare key (see how the file's other tier-2 cases remap — typically a shallow DEFAULT_CONFIG override, e.g. `{ ...DEFAULT_CONFIG, keys: { ...DEFAULT_CONFIG.keys, externalEditor: "g" } }` — match the file's actual override convention) → from BOTH `focus: "text"` and `focus: "note"`, route returns `false` and does not dispatch.

`makePanel` (stub factory :63) already accepts `focus` overrides; no fixture work needed.

### 4. Explicitly OUT of scope

- The apply-side routing fork in openExternalEditor — P1.M2.T1.S1.
- The end-to-end note-duty ctrl+g round-trip AC (keymap-ac pattern) — P1.M2.T1.S3.
- Any spec/, README, or decisions.md edit — ui-spec:84 is already correct; the changeset-level docs sweep is P1.M3.T2.
- Any other intercept's gate, the tier-2 rule itself, or the resolution order.

### Success Criteria

- [ ] Note focus: chord consumed, `onExternalEditor` dispatched exactly once
- [ ] Text focus: unchanged behavior; options focus: chord ignored
- [ ] Bare remap: forwards (types) in BOTH text and note duty; never dispatches
- [ ] All three stale comments now say "editor focus (any duty: write-in, elaboration, note)"
- [ ] No spec edit; full `npm test` + `npm run typecheck` green

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets: the exact gate code and its one-condition change, the in-scope `editorFocused` definition with its line, the three comment sites with current text, the target test with both existing legs to preserve, the makePanel/makeActions/DEFAULT_DATA conventions, the prerequisite ordering against S1, and the spec verification (no edit). No guessing.

### Documentation & References

```yaml
- file: src/panel/keys.ts
  why: |
    :566 gate (THE edit), :425 editorFocused flag (already computed — reuse, do not recompute),
    :562-564 gate comment (sync), ~:96 module JSDoc step-4 list (sync),
    ~:145 seam interface onExternalEditor comment (sync), :567 tier-2 bare guard (UNTOUCHED).
    Line numbers may have drifted — locate by grepping `b.externalEditor` and `editorFocused`.
  gotcha: |
    Use the existing editorFocused binding, not a fresh disjunction — one canonical ESC-002
    definition. Do not touch the bare guard or the intercept order.

- file: src/panel/keys.test.ts
  why: |
    :35 DEFAULT_DATA.externalEditor fixture, :63 makePanel({focus}) stub factory,
    :137 makeActions spy factory, :157 dispatchCount, :349-357 the test to rename/extend;
    nearby tier-2 bare-remap tests show the config-override convention to copy for leg 4.
  pattern: assert route() boolean + onExternalEditor call counts, exactly like the neighbors

- file: src/panel/panel.ts (:831-834)
  why: the fall-through that makes today's note duty dead — unmatched bytes forward to
    textField.handleInput when focus is text OR note; this is why the bare tier-2 return false
    still types correctly in note duty after the widening (no behavior change for bare remaps)

- file: spec/ui-spec.md:84 (hotkey table row "external editor")
  why: the authoritative context wording — "editor focus (any duty) — MUST stay modifier-bearing…"
    (BAREKEYS-001). Already correct: grep to verify, do NOT edit.

- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/prd_snapshot.md (h2.3/h3.1 BUG-002, h2.5 rec 2)
  why: defect definition, repro, recommended gate widening

- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/P1M2T1S1/PRP.md
  why: sibling contract — the openExternalEditor note-duty routing fork that MUST land before
    this gate opens; confirms no corruption window and that this item changes nothing in panel.ts
```

### Current Codebase tree

```bash
src/panel/ keys.ts panel.ts actions.ts ripple-confirm.ts short-view.ts overview.ts layout.ts (+ *.test.ts)
# BUG-001 work (P1.M1) complete; P1.M2.T1.S1 (apply-side fork) in flight
```

### Desired Codebase tree

```bash
src/panel/keys.ts        # MODIFIED — gate :566 + three comment syncs
src/panel/keys.test.ts   # MODIFIED — renamed test + note leg + bare-remap leg
```

### Known Gotchas of our codebase & Library Quirks

```ts
// editorFocused is defined INSIDE route() at :425 — the gate at :566 runs in the same closure;
//   no parameter threading needed.
// The chord byte for ctrl+g is "\u0007" (BEL) — DEFAULT_DATA fixture, not a literal "ctrl+g" string.
// ESC-002 double-esc window: any non-esc config key resets lastEscAt BEFORE step 4 — the
//   ctrl+g dispatch also (correctly) clears the double-esc anchor; don't "fix" that.
// Tier-2 rule: bare keys forward while the editor holds focus — externalEditor's ONLY context
//   is editor focus, so a bare remap can NEVER intercept (BAREKEYS-001 / decisions :113-115).
// ESM: relative imports use ".js" suffix (not relevant here — no import changes).
// PREREQUISITE: verify P1.M2.T1.S1 landed (grep bufferOwner === "note" in panel.ts
//   openExternalEditor) before flipping the gate; if not landed, land only the tests+comments
//   and leave the gate text-only — never widen ahead of the apply side.
```

## Implementation Blueprint

### Data models and structure

None — no type changes; the `PanelFocus` union already includes "note".

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: PREREQUISITE CHECK
  - Grep src/panel/panel.ts openExternalEditor for the bufferOwner === "note" fork
    (P1.M2.T1.S1). If absent, STOP after Task 1's tests+comments and leave the gate
    text-only (the widening is unsafe before the apply side is duty-correct).

Task 1: TDD FAILING-FIRST — src/panel/keys.test.ts
  - RENAME test_externalEditor_only_in_text_focus (:349-357) to any-duty semantics
    (test_externalEditor_in_editor_focus_any_duty).
  - KEEP: options-focus negative leg (false + not called) and text-focus positive leg
    (true + called once), verbatim.
  - ADD note-focus positive leg: route(DEFAULT_DATA.externalEditor,
    makePanel({ focus: "note" })) → true + onExternalEditor called exactly once.
  - ADD bare-remap leg per the file's tier-2 override convention: bare externalEditor
    forwards (false, no dispatch) from BOTH text and note focus.
  - Run: npx vitest run src/panel/keys.test.ts — expect exactly the note leg red.

Task 2: WIDEN the gate in src/panel/keys.ts:566 — `panel.focus === "text"` → `editorFocused`.
  Leave the tier-2 guard and dispatch lines untouched. Run the keys tests — all green.

Task 3: SYNC the three stale comments (module JSDoc ~:96, seam interface ~:145, gate comment
  :562-564) to "editor focus (any duty: write-in, elaboration, note)" with the BUG-002 cite
  and the BAREKEYS-001 rationale preserved in the gate comment.

Task 4: FULL GATES — npm test + npm run typecheck; grep spec/ui-spec.md:84 unchanged
  ("editor focus (any duty)") — no spec edit.
```

### Implementation Patterns & Key Details

```ts
// keys.ts :566 — after (the ONLY code change):
// externalEditor is editor-focus context, any duty (BUG-002: one embedded
// editor, three duties — write-in, elaboration, note; ui-spec "editor focus
// (any duty)"). Gated so ctrl+g stays free in every non-editor context.
// TIER: its only valid context is editor focus, where a bare key must
// type — a bare remap therefore never intercepts (decisions :113-115; keep
// the chord) — in BOTH text and note duty.
if (editorFocused && matchesKey(data, b.externalEditor)) {
  if (bare.externalEditor) return false; // tier 2 in its only context
  actions.onExternalEditor(panel);
  return true;
}
```

### Integration Points

```yaml
NO API CHANGES: internal router condition; onExternalEditor's signature and wiring (M4.T1.S3)
  are untouched. panel.ts handleInput:831-834 already forwards to the TextField for BOTH text
  and note focus, so the tier-2 return-false path types correctly in note duty with no change.
SIBLING (S1): openExternalEditor's note fork consumes the newly-reachable dispatch — together
  they complete BUG-002's router+apply halves.
DOWNSTREAM: P1.M2.T1.S3 adds the end-to-end note-duty round-trip AC on top of this gate.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx tsc --noEmit        # npm run typecheck — zero errors
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/panel/keys.test.ts -v   # new note leg green; all router tests green
npm test                                    # full suite — nothing else regressed
```

### Level 3: Integration Testing (System Validation)

Deferred to P1.M2.T1.S3 (note-duty ctrl+g end-to-end, keymap-ac pattern). This item's router
coverage is complete at Level 2: consumed/dispatched booleans on the real router.

### Level 4: Creative & Domain-Specific Validation

Optional manual TUI pass: load the extension, `/interrogate`, `m`, ctrl+g → `$VISUAL`/`$EDITOR`
opens seeded with the note draft; clean exit → note text updated (S1's fork). Cross-check
write-in/elaboration duty still opens the editor.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean; `npm test` fully green

### Feature Validation

- [ ] Note focus: chord consumed, dispatched exactly once
- [ ] Text focus: unchanged; options focus: chord ignored (negative leg green)
- [ ] Bare remap: forwards in both editor duties, never dispatches
- [ ] E2E round-trip left to P1.M2.T1.S3 (not duplicated here)

### Code Quality Validation

- [ ] Reuses :425 `editorFocused`; no recomputed disjunction; tier-2 guard untouched
- [ ] Only keys.ts (gate + 3 comments) and keys.test.ts modified
- [ ] Comment wording consistent across the three sites

### Documentation & Deployment

- [ ] Three comment syncs done; spec/ui-spec.md verified correct and untouched
- [ ] No new config keys or env vars

---

## Anti-Patterns to Avoid

- ❌ Don't widen the gate before P1.M2.T1.S1's apply-side fork has landed
- ❌ Don't touch the bare tier-2 guard or the intercept resolution order
- ❌ Don't recompute the focus disjunction — use the canonical `editorFocused`
- ❌ Don't edit spec/ui-spec.md — it is already correct
- ❌ Don't drop the existing options-negative or text-positive test legs
- ❌ Don't add panel.ts changes — the router half is this item's entire code scope

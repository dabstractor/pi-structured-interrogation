# PRP — P1.M3.T1.S1: Delete the digit branch and digit routing from keys.ts (DIGIT-OUT-001)

---
name: "P1.M3.T1.S1 — Remove the digit quick-select resolution step, RoutedActions.digit, and the defaultRoutedActions delegate"
description: "DIGIT-OUT-001 step 1 of 3: in src/panel/keys.ts delete the digit resolution block (:585-597 — config.digitQuickSelect && view!=='overview' && focus!=='text'/'note' → actions.digit(panel, Number(k)) for '1'..'9'), the RoutedActions.digit interface member (:121), and the defaultRoutedActions digit delegate (:339). The STANDALONE actions.digit implementation in actions.ts SURVIVES untouched (nothing references it after this — P1.M3.T1.S2 deletes it; typecheck must stay green WITHOUT unused-export suppression). Digits become plain unmatched input: router returns false — they type in editor focus and do NOTHING at options/overview/deep focus (no accept, no advance, no state change). Purge digit wording from keys.ts doc comments (:88-92 resolution-order list, :111, :315, :585-589 block comment). Flip keys.test.ts digit tests (:445, :453, :684, :970) to inertness assertions. Note: config.digitQuickSelect still exists (deleted in S3) — the branch referencing it is simply gone. No mocks beyond existing router/panel stubs."
---

## Goal

**Feature Goal**: Digit quick-select is removed from the key router (DIGIT-OUT-001): digits 1–9 are inert at panel level everywhere except the embedded editor, where they type. The router's resolution order and public seams (`RoutedActions`) lose their digit step/member; the standalone `actions.digit` implementation survives unreferenced for exactly one more subtask.

**Deliverable**: Edits to `src/panel/keys.ts` (one deleted block, one deleted interface member, one deleted delegate, doc-comment purges) and `src/panel/keys.test.ts` (digit tests flipped to inertness + an editor-typing assertion). `src/panel/actions.ts` untouched.

**Success Definition**: `npm test` + `npm run typecheck` green with no unused-code errors. `route('3') === false` from options, overview, AND deep focus with zero state change and no `actions.digit` call; `handleInput('2')` (via `route` in editor focus) returns false so the byte reaches the composed editor (types). hjkl/arrow/esc/enter/config-intercept routing all unchanged.

## User Persona

**Target User**: The panel answerer protecting hard-won work.

**Use Case**: A stray digit keystroke during question review no longer instantly answers + advances a question (DIGIT-OUT-001's exact footgun rationale — "two keys vs one" redundancy with hjkl + enter).

**User Journey**: user presses `3` at options focus → nothing happens (was: option 3 accepted, question advanced). In the editor, `3` types `3`.

**Pain Points Addressed**: accidental-answer footgun on ANSWER-PIN-001 hard-won answers; redundant second accept path.

## Why

- h2.74 DIGIT-OUT-001: "digit quick-select (1–9 accepts option n) and the `digitQuickSelect` toggle are REMOVED entirely… Supersedes every digit-accept reference in the living docs."
- h2.35: "Digit quick-select (1–9) is REMOVED… digits are inert at panel level (they only ever type, where typing is possible)."
- Split delivery (this is S1 of 3): S1 = router + seams; S2 = the now-unreferenced `actions.digit` implementation + digit-accept comments; S3 = `digitQuickSelect` config schema/settings. Keeping S1 self-contained means S2 has literally zero references to delete.

## What

### Exact deletions in `src/panel/keys.ts`

**1. The digit resolution block** (current lines ~585-597, between the `b.nextQuestion` intercept and the `// 5. No match — forward` tail) — delete verbatim:

```ts
    // Digits are printable — NEVER intercepted while the user types an
    // answer (focus === "text") or a note (focus === "note", R3 — the SAME
    // editor on note duty), nor in the overview (a digit there would accept
    // an option on the CURRENT question — not what the list is for);
    // quick-select is a short-form options-focus affordance.
    if (
      config.digitQuickSelect &&
      panel.view !== "overview" &&
      panel.focus !== "text" &&
      panel.focus !== "note"
    ) {
      const k = parseKey(data);
      if (k !== undefined && k >= "1" && k <= "9") return actions.digit(panel, Number(k));
    }
```

After deletion, a digit falls through to the tail `return false` — forwarded to the embedded editor (types) or to default handling (does nothing panel-visible). **Verify after the edit**: if `parseKey`'s ONLY remaining use was this block, the import at line 103 (`parseKey` from `@earendil-works/pi-tui`) becomes unused → remove `parseKey` from the import (keep `Key`, `matchesKey`, `type KeyId`); grep `parseKey` in keys.ts first. Similarly `config.digitQuickSelect` may have been the only `config` field read directly in the router — the `config` parameter itself stays (accelerator resolution uses it).

**2. `RoutedActions.digit` interface member** (line ~121):

```ts
  digit(p: InterrogationPanel, n: number): boolean;
```

Delete the member from the interface. (Line ~152's comment "Single-character base keys: letters, digits, and pi-tui's symbol set" describes parseAccelerator's charset — leave it; it's not about quick-select. Check :152 in context and only touch if it names quick-select.)

**3. `defaultRoutedActions` digit delegate** (line ~339):

```ts
    digit: (p, n) => panelActions.digit(p, n),
```

Delete the line. `panelActions.digit` in actions.ts then has zero references — typecheck stays green because it is an exported member of `panelActions`, not a local unused variable.

**4. Doc-comment purges** (delete/rewrite the digit wording, keep everything else):
- Module JSDoc resolution-order list (:88-92): remove the "then digits 1–9 (only when digitQuickSelect AND …)" clause; step 4's config-intercept list now ends at `nextQuestion (view-aware: overview cursor movers)`.
- :111 "navigation/accept/digit/submit delegate to the named-action registry" → "navigation/accept/submit delegate…" (in the seam-callbacks doc block above the interface — grep `digit` to catch the exact sentence in the current tree).
- :299 same phrase in the defaultRoutedActions doc block → drop "digit/".
- :315 "…convention; digit quick-select never selects that row" — drop the digit clause (keep the ✎-Other-row convention sentence it hangs on).

**Post-edit invariant**: `grep -n digit src/panel/keys.ts` returns ZERO matches (comments included). Everything digit-related now lives only in actions.ts (S2's target) and config (S3's target).

### Test changes in `src/panel/keys.test.ts`

- `:103` — `digit: vi.fn(...)` in the `makeActions()` factory: DELETE the member (the interface no longer has it; typecheck enforces). Grep for other `actions.digit` references in the file and remove them along with the tests below.
- **Flip** `:445` `test_digitQuickSelect_off_forwards_digits` → `test_digits_are_always_forwarded`: `route("3", options-focus panel) === false`, `actions` untouched (no digit mock to assert — assert instead that NO state changed: `panel.cursorIndex`/`currentId` unchanged, and no view change).
- **Flip** `:453` `test_digit_honors_action_result` (and its sibling at ~:458-:463 using `actions2`) → replace with one test asserting `route("7") === false` / `route("2") === false` from short-form options focus with zero panel mutation (compare a shallow snapshot of `{view, focus, cursorIndex, currentId, deepSticky}` before/after).
- **Flip** `:684` `test_digits_are_never_quick_select_while_typing_a_note` → `test_digit_types_in_note_focus`: note-focus panel, `route("5") === false` (forwarded to the note editor — the byte types).
- **Flip** `:970` `test_digits_do_not_quick_select_in_overview` → `test_digit_is_inert_in_overview`: overview panel, `route("3") === false`, `panel.overviewCursor` unchanged, no view change.
- **Add**: `test_digit_is_inert_in_deep_focus`: deep view, options focus, `route("3") === false`, selection (`deepSelection`/whatever the deep-view stub exposes) unchanged.
- **Add**: `test_digit_types_in_text_focus`: text focus, `route("2") === false`.

### Success Criteria

- [ ] `grep -n digit src/panel/keys.ts` → no matches (code or comments).
- [ ] `RoutedActions` and `defaultRoutedActions` have no digit member/delegate; `makeActions()` factory updated.
- [ ] `route("1".."9") === false` from options, overview, deep focus; from text/note focus (types).
- [ ] Zero panel/state mutation on digits at any focus.
- [ ] `src/panel/actions.ts` byte-untouched (`actions.digit` survives unreferenced).
- [ ] `npm test` + `npm run typecheck` green; no unused-import/unused-member errors.
- [ ] Arrow/hjkl/esc/enter/two-tier config intercepts all unchanged (their suites green).

## All Needed Context

### Context Completeness Check

A fresh implementer has: exact line-anchored deletions (verified against the current tree), the keep-vs-delete boundary (actions.ts and config survive ONE subtask), the doc-comment purge list, and the per-test flip map. No guessing required.

### Documentation & References

```yaml
- docfile: plan/004_49e25d5235a9/architecture/keys-and-actions.md
  why: THE dossier — §2 step 8 (the digit resolution step and its exact gating) and §5 (deletion sequencing across S1/S2/S3); anchors for the branch (:508-519 per the dossier; ~585-597 in the current tree after M1's edits — grep `digitQuickSelect` for the live block), RoutedActions.digit (:103), the delegate (:300), and the doc-comment sites (:70-74, :93, :260, :276, :351 in dossier numbering)
  critical: the keep/delete boundary — actions.digit implementation SURVIVES S1 unreferenced; S2 deletes it; S3 deletes the config field

- file: src/panel/keys.ts
  why: all four edit sites verified in the current tree — digit block :585-597, RoutedActions.digit :121, delegate :339, doc comments :88-92 / :111 / :299 / :315
  gotcha: after deleting the block, check whether `parseKey` (import line ~103) is still used anywhere in the file — grep before removing from the import; do NOT touch :152's charset comment unless it names quick-select

- file: src/panel/actions.ts
  why: READ ONLY — panelActions.digit is the implementation that survives; confirm zero post-S1 references via grep, do not edit

- file: src/panel/keys.test.ts
  why: the flip map — makeActions digit mock :103, digit tests :445/:453(+~:458-463)/:684/:970; note the makeOverviewPanel helper (~:893) and DEFAULT_DATA/ESCAPE/UP/DOWN constants used by neighboring tests
  pattern: inertness assertions follow the file's existing style — expect(route(...)).toBe(false) plus before/after state-field comparisons (see :896-907 for the overview-panel assertion style)

- file: src/config.ts
  why: digitQuickSelect still exists there (S3 deletes it) — after removing the router's read, `grep digitQuickSelect src/` should hit ONLY config.ts (+ its tests) and NOT keys.ts; this is the S1→S3 handoff invariant
  gotcha: do NOT delete the config field in this subtask

- docfile: plan/004_49e25d5235a9/P1M2T1S1/PRP.md
  why: the parallel item's contract — hjkl joins the fixed branches in buildKeyRouter. It edits the fixed-arrow conditions ABOVE the digit block; zero semantic overlap, but re-read its final router shape if line anchors shifted (grep, don't trust line numbers blindly)

- prd_snapshot: h2.74 DIGIT-OUT-001, h2.35 hotkey table (digit-removal paragraph), h2.10 AC-3
  why: the ruling text and the acceptance criterion (AC-3: a digit must not answer/advance — zero state change)
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/keys.ts         # router — ALL of this task's production edits
src/panel/keys.test.ts    # flip map target
src/panel/actions.ts      # READ ONLY (actions.digit survives)
src/config.ts             # READ ONLY (digitQuickSelect survives until S3)
```

### Desired Codebase tree

```bash
# No new files. Edits: keys.ts (deletions + doc purge), keys.test.ts (flips + adds).
# Post-edit greps: `digit` absent from keys.ts; `digitQuickSelect` absent from
# src/panel/*; `panelActions.digit` present-but-unreferenced in actions.ts.
```

### Known Gotchas

```ts
// actions.digit in actions.ts MUST survive — deleting it here collides with
//   P1.M3.T1.S2 (its whole job) and S1's contract ("typecheck stays green").
// The digit block is load-bearing ORDERING-adjacent: it sits AFTER the config
//   intercepts and BEFORE the `return false` tail — after deletion the tail
//   directly follows b.nextQuestion; nothing else shifts.
// parseKey import may become unused — grep before trimming the import
//   (matchesKey/Key/KeyId certainly stay).
// makeActions()'s digit mock must go with the interface member, or typecheck
//   fails on excess property / test files break on the missing member.
// hjkl (parallel P1.M2.T1.S1) are NEW single-byte keys in the FIXED branches —
//   their fixed-branch checks run BEFORE the (now deleted) digit block, so no
//   interaction; but if anchors moved, grep `digitQuickSelect` for the live site.
// Digits at non-editor focus now hit the tail `return false` — panel.ts
//   forwards unmatched input to the composed editor only when focused; at
//   options focus a false return is a harmless no-op (AC-3 semantics).
```

## Implementation Blueprint

### Data models

`RoutedActions` loses one member (`digit`). No other type changes; no config changes.

### Implementation Tasks (ordered)

```yaml
Task 1: TDD — write the inertness tests first (they fail against the live router)
  - flip :445, :453(+sibling), :684, :970 per the map; add deep-focus and text-focus digit tests; delete the makeActions digit mock
Task 2: EDIT src/panel/keys.ts — delete the digit block (:585-597)
Task 3: EDIT src/panel/keys.ts — delete RoutedActions.digit (:121) and the defaultRoutedActions delegate (:339)
Task 4: EDIT src/panel/keys.ts — purge digit wording from doc comments (:88-92, :111, :299, :315); grep `digit` in the file → must be empty
Task 5: CHECK imports — grep parseKey; trim the pi-tui import only if unused
Task 6: VALIDATE — npx vitest run src/panel/keys.test.ts; then npm test + npm run typecheck; grep invariants (`digit` in keys.ts; `digitQuickSelect` outside config)
```

### Implementation Patterns & Key Details

```ts
// Inertness assertion pattern (matches the file's overview-panel style ~:896-907):
const before = { view: p.view, focus: p.focus, cursorIndex: p.cursorIndex,
                 currentId: p.currentId, deepSticky: p.deepSticky };
expect(route("3", p)).toBe(false);            // forwarded/unmatched
expect({ view: p.view, focus: p.focus, cursorIndex: p.cursorIndex,
         currentId: p.currentId, deepSticky: p.deepSticky }).toEqual(before);
```

### Integration Points

```yaml
ROUTER CALLER: src/panel/panel.ts handleInput → route() — unchanged (false = forward)
DOWNSTREAM:
  - P1.M3.T1.S2 deletes actions.digit (now unreferenced — verify with grep as S1's handoff evidence)
  - P1.M3.T1.S3 deletes digitQuickSelect from config (grep must show only config.ts + config tests after S1)
DO NOT TOUCH: actions.ts, config.ts, deep-view.ts, overview.ts, panel.ts
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck    # zero errors — no unused imports, RoutedActions consumers compile
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/keys.test.ts
npm test             # full suite — esp. hjkl/arrow/esc/enter/two-tier suites (parallel item's tests too)
```

### Level 3: Invariant greps (the S1→S2/S3 handoff evidence)

```bash
grep -n "digit" src/panel/keys.ts            # expect: no output
grep -rn "digitQuickSelect" src/ --include="*.ts" | grep -v test   # expect: config.ts only
grep -n "digit" src/panel/actions.ts | head -3   # expect: the implementation still present (S2's target)
```

### Level 4: Not applicable — router logic only, no UI/bridge surface.

## Final Validation Checklist

- [ ] `npm test` + `npm run typecheck` green
- [ ] `grep digit src/panel/keys.ts` empty (code AND comments)
- [ ] Digits inert at options/overview/deep focus; typed at text/note focus; zero state change (asserted)
- [ ] `actions.digit` implementation intact and unreferenced; `digitQuickSelect` present only in config + its tests
- [ ] `git diff` touches exactly `src/panel/keys.ts` + `src/panel/keys.test.ts`
- [ ] Resolution-order doc comment ends step 4 at nextQuestion; module JSDoc truthful

## Anti-Patterns to Avoid

- ❌ Don't delete `actions.digit` or the config field — S2/S3 own them; deleting here breaks the staged contract
- ❌ Don't leave digit wording in keys.ts comments — the purge IS part of the deliverable
- ❌ Don't reorder or touch any other resolution step — the two-tier intercepts and fixed branches (incl. the parallel hjkl work) are load-bearing
- ❌ Don't assert only `route(...) === false` — also assert zero state change (AC-3)
- ❌ Don't trust line numbers blindly — the parallel hjkl item shifts anchors; grep `digitQuickSelect` for the live block

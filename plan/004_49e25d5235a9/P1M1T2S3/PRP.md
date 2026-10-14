# PRP — P1.M1.T2.S3: Footer drops (not swaps) the elaborate hint while the editor holds focus

## Goal

**Feature Goal**: Close the D-R11-as-amended footer contract (ui-spec :116, h2.37, h2.74/BAREKEYS-001): while the embedded editor holds focus (`focus === "text" || "note"`), `renderFooter` must DROP the `{elaborate} explain` hint entirely and render NO replacement close hint — deleting the `${labels.elaborate} close` / `${labels.batchNote} close` toggle-hint branches. "enter save" and the conditional "esc esc back" (escEscHint) stay; all non-editor footer content and the right-to-left narrow drop loop stay unchanged.

**Deliverable**: Modified `src/panel/layout.ts` (renderFooter editorExit branch + FooterEditorExit JSDoc, Mode A) and flipped/extended tests in `src/panel/layout.test.ts` + `src/config-surface.test.ts`. `src/panel/panel.ts` is NOT touched (the `FooterEditorExit` interface keeps `mode`, so the :1401-1403 call site stays valid).

**Success Definition**:
- `npm run typecheck` + full `npm test` green
- Editor-focused footer (text and note duty, every screen, wide and narrow): contains "enter save", contains "esc esc back" iff `escEscHint === true`, contains NEITHER "explain" NOR "close" in any hint
- Options-focused short-view footer still shows `{elaborate} explain` (label from `resolveKeyLabels`, post-S1 default `t`)
- No other hint, the progress segment, the fit loop, or the narrow degradation changes

## Why

BAREKEYS-001 (h2.74) removed the re-press-to-close toggle gestures (P1.M1.T2.S2): a bare `t`/`m` while the editor holds focus must type, never act. The footer's swap-in close hints (`t close`, `m close`) advertise gestures that no longer exist — a hint that lies is worse than no hint. The locked contract (h2.37 D-R11 as amended): the explain hint is "dropped (not swapped) while the editor holds focus (bare keys never intercept there; the editor's own exits — `enter`, double-`esc` — need no panel label)". This subtask is the behavioral half; identifier renames at layout.ts :501/:510/:516 already landed in P1.M1.T1.S1.

## What

1. **renderFooter editorExit branch (layout.ts :511-521)**: keep the statics filter (it already excludes `${labels.elaborate} explain` from `kept`), keep `hints.push("enter save", ...kept)`, keep `if (editorExit.escEscHint) hints.push("esc esc back")`, and DELETE the final push of `mode === "note" ? \`${labels.batchNote} close\` : \`${labels.elaborate} close\``. No replacement hint is added — the drop is the deliverable.
2. **FooterEditorExit interface/JSDoc (layout.ts :425-440)**: update the doc block (Mode A) to describe the editor-focus hint set — enter save, optional esc-esc back, everything else per screen minus the lying statics; state that `mode` is retained for call-site stability (panel.ts passes it) but is no longer rendered from.
3. **Branch comment (layout.ts :508-511)**: rewrite — the editor's own exits need no panel label; explain is dropped (not swapped) per D-R11 as amended.

### Success Criteria

- [ ] Editor-focused footer omits the explain hint AND any close hint, for `mode: "text"` and `mode: "note"`, on short, deep, and overview screens
- [ ] `escEscHint: false` → no "esc esc" hint; `escEscHint: true` → present (regression-preserved)
- [ ] "enter save" present in every editor-focused render; "enter accept"/"enter jump"/"esc back"/"↑/↓ scroll" still filtered out (statics set unchanged)
- [ ] Options focus short view still ends with `{labels.elaborate} explain` (post-S1 default renders via resolveKeyLabels — assert against `resolveKeyLabels(mkConfig())` output, not a hardcoded "T")
- [ ] Narrow width: fit loop unchanged; a narrow editor-focused render degrades without ever surfacing "explain" or "close"
- [ ] `src/panel/panel.ts` untouched; `grep -n "close" src/panel/layout.ts` finds no footer hint composing "close"
- [ ] Full suite + typecheck green

## All Needed Context

### Context Completeness Check

Repo fully implemented. This PRP quotes the exact current editorExit branch, the interface, the caller line, and every test anchor. An agent needs this PRP plus `src/panel/layout.ts`, `src/panel/layout.test.ts`, `src/config-surface.test.ts`.

### Documentation & References

```yaml
- file: plan/004_49e25d5235a9/P1M1T2S3/research/notes.md
  why: verbatim current code of the editorExit branch (:511-521), FooterEditorExit (:425-440),
        caller (panel.ts:1401-1403), test anchors, sibling-contract summaries

- file: plan/004_49e25d5235a9/architecture/keys-and-actions.md §7 (:68-69)
  why: THE research note — confirms current SWAP behavior and states the BAREKEYS-001 target
        ("explain hint DROPPED entirely … no toggle-close hint")

- file: src/panel/layout.ts
  why: the only production file. renderFooter :478-531, FooterEditorExit :425-440,
        SCREEN_KEYS/NARROW_FOOTER_ACTIONS/ACTION_WORDS maps (:139-160)
  pattern: "[Mode A] doc blocks above each export; comments cite spec sections (D-R11, ESC-002)"
  gotcha: "do NOT touch the fit loop (:525-528), progress segment, or screen statics — the
    drop loop must still drop the explain hint FIRST on narrow options-focus renders (it is
    the last-pushed hint there, so pop-order already does this)"

- file: plan/004_49e25d5235a9/P1M1T2S1/PRP.md (Implementing — CONTRACT)
  why: defaults flip to d/o/t/m/e — labels.elaborate default becomes "t"
  critical: "assert rendered hints against resolveKeyLabels(mkConfig()) values, never a
    hardcoded capitalization — S1 owns the exact label format"

- file: plan/004_49e25d5235a9/P1M1T2S2/PRP.md (Implementing — CONTRACT)
  why: removes the re-press-to-close gestures — the reason no close hint may be advertised
  gotcha: "S2 touches panel.ts/keys.ts gesture code, NOT layout.ts — no file overlap"

- file: src/panel/layout.test.ts
  why: ":388-420 test_editor-exit hints… FLIPS (drop the 'Ctrl+T close'/'Ctrl+N close'
        assertions, add not-contains explain/close); mkConfig fixture :72-74 flips to the
        post-S1 default keymap"
  gotcha: "mkConfig is a remap-friendly stand-in — keep the remap capability, update the
    DEFAULT values to S1's contract (elaborate 't', batchNote 'm', …) and fix the :409
    'mkConfig rebinds batchNote' comment accordingly"

- file: src/config-surface.test.ts
  why: ":399-470 label suite — extend :412 test_footer_reflects_remapped_labels… with an
        editorExit renderFooter case (remapped labels, no default-label hints, footer
        contains neither 'explain' nor 'close' while editor-focused)"

- docfile: PRD h2.37 (D-R11 as amended — the locked footer contract), h2.74 (BAREKEYS-001),
  h2.35 (two-tier intercept: bare keys never intercept in editor focus) — verbatim in the task prompt
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
├── layout.ts             # MODIFY: renderFooter editorExit branch + FooterEditorExit JSDoc
├── layout.test.ts        # MODIFY: flip :388-420 editor-exit test; fixture :72-74 post-S1 defaults
└── panel.ts              # UNTOUCHED (caller :1401-1403 stays valid — interface keeps `mode`)
src/config-surface.test.ts # MODIFY: extend the :412 footer label test with an editorExit case
```

### Desired Codebase tree

```bash
src/panel/
├── layout.ts             # drop-not-swap editorExit branch; Mode A comments
├── layout.test.ts        # flipped + new not-contains assertions
└── panel.ts              # unchanged
src/config-surface.test.ts # extended footer label coverage
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: DELETE the close-hint push — do not replace it with any other hint.
//   The contract is a DROP: while editor-focused the footer names NO explain
//   surface and NO close gesture (the editor's own exits need no label).
// CRITICAL: keep the statics Set exactly as-is (it already filters the explain
//   hint out of `kept` AND removes the lying screen statics). Both jobs matter.
// GOTCHA: keep `mode` on FooterEditorExit — panel.ts:1402 still passes it and
//   this subtask must not touch panel.ts. Mark it render-unused in the JSDoc.
// GOTCHA: label capitalization/format belongs to resolveKeyLabels + S1's defaults
//   flip — compose hints as `${labels.elaborate} explain` and assert with the
//   resolved label, never a literal like "T" or "Ctrl+T".
// GOTCHA: the fit loop pops RIGHT-TO-LEFT — with the close hint gone, the last
//   hint while editor-focused is "esc esc back", which is now the first drop at
//   narrow widths. That is correct (the editor exits stay advertised until space
//   runs out); do not reorder.
// GOTCHA: renderFooter is a pure render function — tests use fixture configs and
//   mkState() states; no panel instance, no mocks (per the item contract).
// GOTCHA: narrow mode (NARROW_FOOTER_ACTIONS) never includes elaborate — the
//   narrow+editorExit combination must simply not crash and not show explain/close.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: WRITE FAILING TESTS FIRST
  - src/panel/layout.test.ts — REWORK test_editor-exit hints… (:388-420):
    for mode "text" and "note" (and the escEscHint:false + deep-screen variants
    already in the test), REPLACE the `Ctrl+T close` / `Ctrl+N close` assertions with:
      expect(text).not.toContain("explain");
      expect(text).not.toContain("close");
    KEEP: toContain("enter save"), not.toContain("enter accept"),
          toContain("esc esc back") (escEscHint:true) / not "esc esc" (false)
  - ADD test_editor_focus_footer_drops_explain_on_every_screen:
    for screen of short/deep/overview, editorExit {mode:"text"} and {mode:"note"}:
      rendered contains "enter save", contains no "explain", no "close"
  - ADD test_options_focus_short_footer_names_elaborate (regression):
    no editorExit → footer contains `${resolveKeyLabels(mkConfig()).elaborate} explain`
  - ADD test_narrow_editor_focus_footer_never_shows_explain_or_close:
    width 40, narrow=true, editorExit set → degrades without "explain"/"close"
  - UPDATE mkConfig fixture defaults (:72-74) to S1's keymap (elaborate "t",
    batchNote "m", deep "d", overview "o", discuss "e", submit stays a chord) —
    coordinate with whatever S1's PRP pinned; fix the :409 comment
  - src/config-surface.test.ts — EXTEND test_footer_reflects_remapped_labels… (:412):
    add an editorExit render (remapped labels): remapped hints present, no
    default-label hints, footer contains neither "explain" nor "close"
  - RUN npx vitest run src/panel/layout.test.ts src/config-surface.test.ts —
    the not-contains("close") assertions FAIL pre-fix

Task 2: IMPLEMENT src/panel/layout.ts (renderFooter :511-521)
  - DELETE the closing hints.push(mode === "note" ? `${labels.batchNote} close`
    : `${labels.elaborate} close`) — nothing replaces it
  - REWRITE the branch comment: editor's own exits (enter save, double-esc) need
    no panel label; explain is dropped (not swapped) — D-R11 as amended (h2.37)
  - UPDATE FooterEditorExit JSDoc (Mode A): describe the editor-focus hint set
    ("enter save", optional "esc esc back", screen hints minus statics); note
    `mode` is retained for call-site stability (panel.ts passes it) and is not
    rendered from

Task 3: RUN gates
  - npx vitest run src/panel/layout.test.ts src/config-surface.test.ts -v
  - npm run typecheck && npm test
```

### Implementation Patterns & Key Details

```ts
// editorExit branch AFTER the fix:
if (editorExit !== undefined) {
  // ESC-002/BAREKEYS-001: while the editor holds focus the screen statics lie
  // (enter saves, esc forwards, arrows move the caret) — drop them. The
  // explain hint is DROPPED, not swapped: bare keys never intercept in editor
  // focus and the editor's own exits (enter, double-esc) need no panel label
  // (D-R11 as amended, h2.37/ui-spec :116). No close hint is advertised.
  const statics = new Set(["enter accept", "enter jump", "esc back", "↑/↓ scroll", `${labels.elaborate} explain`]);
  const kept = hints.filter((h) => !statics.has(h));
  hints.length = 0;
  hints.push("enter save", ...kept);
  if (editorExit.escEscHint) hints.push("esc esc back");
  // (deleted: the `${labels.batchNote} close` / `${labels.elaborate} close` push)
}
```

### Integration Points

```yaml
MODULES:
  - panel.ts footerLine (:1401-1403): UNTOUCHED — FooterEditorExit keeps `mode`
  - P1.M4.T1.S1 (AC-4 label assertions): consumes this footer contract — after
    this subtask, editor-focused footer = "enter save" [+ "esc esc back"], never
    explain/close
  - P1.M4.T2.S1 (README usage prose): documents the drop-not-swap behavior from
    this contract
  - S1 (defaults) / S2 (gesture removal): parallel, no file overlap (keys.ts,
    panel.ts vs layout.ts)
NO CHANGES to: panel.ts, keys.ts, renderConfirmFooter, fit loop, SCREEN_KEYS/NARROW_FOOTER_ACTIONS
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/layout.test.ts src/config-surface.test.ts -v
npm run typecheck && npm test
```

### Level 3: Behavioral probe (pure render, harness)

```bash
npx vitest run src/panel/layout.test.ts -t "editor" -v
# The reworked tests ARE the probe: no explain/close hint in any editor-focused
# render; options focus still names the elaborate key.
```

### Level 4: Domain validation

- [ ] Mode A comments in layout.ts describe the editor-focus hint set and the drop-not-swap contract
- [ ] `grep -n 'close' src/panel/layout.ts` — no footer hint composes "close" (renderConfirmFooter's FR-18 "esc=cancel" copy is a different surface and stays)
- [ ] `git diff --stat` shows only layout.ts, layout.test.ts, config-surface.test.ts changed

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green (incl. S1/S2's flipped suites)
- [ ] TDD: not-contains("close") assertions observed failing before the deletion
- [ ] Editor-focused footer: "enter save" always; "esc esc back" iff window armed; never "explain", never "close"; all screens; narrow-safe
- [ ] Options focus unchanged: `{elaborate} explain` present, drop-loop order intact (explain first casualty at narrow widths)
- [ ] panel.ts, keys.ts, fit loop, statics maps untouched; FooterEditorExit keeps `mode` (documented render-unused)
- [ ] mkConfig fixture + :409 comment consistent with S1's landed defaults

## Anti-Patterns to Avoid

- ❌ Don't swap the explain hint for any replacement hint — the contract is a pure drop
- ❌ Don't remove `mode` from FooterEditorExit — that drags panel.ts into scope
- ❌ Don't reorder the fit loop or "unshift enter save" placement — hint order drives drop order
- ❌ Don't hardcode label strings ("T", "Ctrl+T") — resolve via labels from resolveKeyLabels
- ❌ Don't touch the statics Set's existing members — both jobs (explain drop + lying-statics drop) are needed
- ❌ Don't touch renderConfirmFooter (ripple modal footer) — different surface, keeps its esc=cancel copy
- ❌ Don't flip tests silently without first observing them fail (TDD gate)

---

**Confidence Score**: 9/10 — the exact branch, interface, caller, and every test anchor were read line-by-line from the working tree; the change is a one-push deletion plus comments, with all sibling-contract boundaries (S1 defaults, S2 gestures, panel.ts caller) explicitly fenced.

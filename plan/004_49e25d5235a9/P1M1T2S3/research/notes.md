# Research notes — P1.M1.T2.S3: Footer drops (not swaps) the elaborate hint while the editor holds focus

## Verified current code

### renderFooter — src/panel/layout.ts:478-531
- Signature: `renderFooter(state, screen, labels, theme, width, narrow = false, editorExit?: FooterEditorExit, position?)`
- :501 `if (screen === "short") hints.push(`${labels.elaborate} explain`)` — D-R11 permanent hint.
- :511-521 editorExit branch — TODAY it SWAPS:
  ```ts
  const statics = new Set(["enter accept", "enter jump", "esc back", "↑/↓ scroll", `${labels.elaborate} explain`]);
  const kept = hints.filter((h) => !statics.has(h));
  hints.length = 0;
  hints.push("enter save", ...kept);
  if (editorExit.escEscHint) hints.push("esc esc back");
  hints.push(editorExit.mode === "note" ? `${labels.batchNote} close` : `${labels.elaborate} close`);
  ```
- Fit loop (:525-528): drops hints right-to-left until fits; progress-only final degradation.

### FooterEditorExit interface — layout.ts:425-440
`{ mode: "text" | "note"; escEscHint: boolean }` — doc block currently describes the toggle-close hints. `mode` becomes render-dead after this fix.

### Caller — src/panel/panel.ts footerLine :1388-1403
`const editorExit = this.focus === "text" || this.focus === "note";` then passes
`{ mode: this.focus === "note" ? "note" : "text", escEscHint: this.config.escExitWindowMs > 0 }` (:1401-1403).

### Spec target (ui-spec :116 / h2.37 D-R11 as amended, h2.74 BAREKEYS-001)
"The short-view footer permanently carries `{elaborate} explain` … first casualty of the narrow-width right-to-left drop loop, and dropped (not swapped) while the editor holds focus (bare keys never intercept there; the editor's own exits — `enter`, double-`esc` — need no panel label)."

## The fix
In the editorExit branch:
1. KEEP the statics filter as-is (it already drops the explain hint from `kept`).
2. DELETE the final `hints.push(mode === "note" ? batchNote close : elaborate close)` — no replacement close hint.
3. KEEP `hints.push("enter save", ...kept)` and `if (editorExit.escEscHint) hints.push("esc esc back")`.
4. Result: editor-focused hint set = "enter save" + surviving screen hints minus statics + optional "esc esc back". No "close" hint, no "explain" hint, ever.
5. Update the branch comment + FooterEditorExit JSDoc (Mode A): describe the drop-not-swap contract; `mode` retained on the interface solely for call-site stability (panel.ts:1402 unchanged) — mark it render-unused in the doc.

Narrow-width: the drop loop already pops right-to-left; with the close hint gone the loop is untouched — explain is still first casualty on short (it's the last-pushed hint before "enter save" is unshifted... order check: hints = ["enter accept"?, ...screen hints, explain, (deep/overview statics)] → after swap: ["enter save", kept..., "esc esc back"?]. "esc esc back" is last → dropped first by the loop. Explain is already filtered pre-loop while editor-focused. Contract "explain dropped FIRST" applies to options-focus narrow drops: loop order unchanged there (explain last-pushed → popped first). Verify in a narrow editor-focus test only that no crash/no explain appears.

## Sibling contracts (parallel, treat as landed)
- P1.M1.T1.S1 (Complete): `KeyAction` member `elaborate`, defaults field, dispatch seam, label maps renamed; identifiers at layout.ts :501/:510/:516 already say `elaborate`.
- P1.M1.T2.S1 (Implementing): defaults flip to d/o/t/m/e; `labels.elaborate` default becomes "t" → rendered "t explain" (capitalization per resolveKeyLabels — check: today "Ctrl+T"; new default likely "t"; assert against resolveKeyLabels output, not a hardcoded string).
- P1.M1.T2.S2 (Implementing): removes re-press-to-close gestures (onElaborate entry-only, onBatchNote open-only) — the semantic reason no close hint exists to advertise.

## Test anchors
- layout.test.ts :388-420 `test_editor-exit hints: enter save, esc-esc back, toggle close (ESC-002)` — FLIPS: drop `Ctrl+T close`/`Ctrl+N close` assertions; add not-contains "explain" and "close" while editor-focused (text + note + escEscHint:false + deep variants all present in the test).
- layout.test.ts :72-74 mkConfig fixture — post-S1 default keymap flip (elaborate "t", batchNote "m", …) per S1's contract; assertions like "T explain" from options focus.
- config-surface.test.ts :412 `test_footer_reflects_remapped_labels_and_no_defaults_on_every_screen` (:399-470 suite) — EXTEND with an editorExit renderFooter case: remapped labels reflected; no default-label hints; footer contains neither "explain" nor "close" while editor-focused.
- panel.ts:1401-1403 caller stays untouched (interface keeps `mode`).

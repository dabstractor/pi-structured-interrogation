# Finding: does pi preserve main editor text across custom() sessions?

## Source evidence (installed runtime, verified 2025)

`node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js`
`InteractiveMode.showExtensionCustom` (the function behind `ctx.ui.custom`), lines ~2157–2210:

```js
async showExtensionCustom(factory, options) {
    const savedText = this.editor.getText();          // snapshot at OPEN
    const restoreEditor = () => {
        this.editorContainer.clear();
        this.editorContainer.addChild(this.editor);   // SAME instance re-added
        this.editor.setText(savedText);               // text restored at CLOSE
        this.ui.setFocus(this.editor);
        this.ui.requestRender();
    };
    ...
    const close = (result) => {
        ...
        else restoreEditor();                          // done() → restore
```

## Conclusions

1. **YES — the PRD claim holds.** The main editor is a single long-lived
   instance (`this.editor`). `custom()` snapshots its text at open and
   re-adds the SAME instance with the snapshot restored when `done()` fires.
   Main editor text present when the panel opened is intact after suspend.

2. **Text typed while suspended is also preserved.** While the panel is
   suspended the main editor IS the live editor (custom() already resolved).
   A subsequent resume (`custom()` again) snapshots the CURRENT text —
   including side-chat typing and S2's discuss-in-chat `setEditorText`
   preload — and restores that snapshot on the next close. Chained
   suspend/resume cycles never lose text: each cycle's snapshot is taken
   from the live editor at that cycle's open.

3. **Do NOT add our own snapshot/restore.** It would be redundant AND
   dangerous: restoring a pre-suspend snapshot would clobber text the user
   typed during the side chat (the exact failure the item description warns
   about). The "only restore if unchanged-empty" guard is therefore never
   needed on the verified runtime. We record the belt-and-braces seam
   (`getEditorText`/`setEditorText`, confirmed at
   architecture/pi-api-validation.md:43) but do not invoke it in the
   production suspend path.

4. **Caveat.** This is the installed runtime's behavior; a pi version change
   could regress it. Mitigation: the vitest suite pins the emulation of
   these exact semantics (editor-preservation.test.ts), the finding is
   recorded for the README limitations section (P1.M7.T7.S1), and AC-4's
   "main editor draft also intact" gets a final human pass in
   MANUAL-TUI-AC-RUNBOOK.md.

## S2 interaction note

S2's deferred `setEditorText(template)` writes the discuss template into the
live editor AFTER custom() resolves (post-restore) — with native
preservation, a later resume snapshots that template text and restores it on
the next close, so the template survives the whole side-chat cycle too.

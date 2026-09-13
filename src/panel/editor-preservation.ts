/**
 * src/panel/editor-preservation.ts — h2.35 verify-in-test discharge
 * (P1.M6.T2.S3; h2.51 risk table + pi-api-validation.md open question 3).
 *
 * [Mode A] FINDING (empirically verified from the installed pi runtime,
 * recorded in plan/001_0d6760db6bc5/P1M6T2S3/research/finding.md):
 *
 * > "main editor text preserved (pi's editor instance persists across
 * > custom() sessions; verify in test)" — h2.35
 *
 * VERIFIED SOURCE — pi's `InteractiveMode.showExtensionCustom` (the
 * function behind `ctx.ui.custom`), in
 * `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/
 * interactive-mode.js` (~lines 2157-2210):
 *
 *     async showExtensionCustom(factory, options) {
 *         const savedText = this.editor.getText();       // snapshot at OPEN
 *         const restoreEditor = () => {
 *             this.editorContainer.clear();
 *             this.editorContainer.addChild(this.editor); // SAME instance
 *             this.editor.setText(savedText);             // restore at CLOSE
 *             ...
 *         };
 *         ... const close = (result) => { ... else restoreEditor(); ... }
 *
 * Conclusions (per the research finding):
 * 1. The main editor is a single long-lived instance; custom() snapshots
 *    its text at open and re-adds the SAME instance with that snapshot
 *    restored when done() fires. Editor text present at panel-open is
 *    intact after suspend — the h2.35 claim holds natively.
 * 2. Chained cycles re-snapshot the LIVE editor at each open, so text
 *    typed while suspended (side chat) and S2's discuss-in-chat
 *    `setEditorText` preload survive resume + subsequent close too.
 * 3. THEREFORE: NO production snapshot/restore is added. Restoring a
 *    pre-suspend snapshot on resume would CLOBBER text the user typed
 *    during the side chat — the exact hazard this item guards against.
 *    panel.ts's suspend path (openPanel's .then/.catch) is deliberately
 *    untouched.
 * 4. Caveat: this is the installed runtime's behavior; a pi version
 *    change could regress it. Mitigations: editor-preservation.test.ts
 *    pins these semantics against a fake ctx emulating them, the finding
 *    is recorded for the README limitations section (P1.M7.T7.S1), and
 *    AC-4 ("main editor draft also intact") gets a final human pass in
 *    MANUAL-TUI-AC-RUNBOOK.md.
 *
 * FALLBACK (regression) PATH: if a future pi drops native preservation,
 * flip {@link EDITOR_PRESERVATION} to `"manual"` and wire
 * {@link snapshotEditorText} (capture at suspend) +
 * {@link restoreEditorTextIfEmpty} (restore only into an empty editor, so
 * side-chat typing is never clobbered) at panel.ts's suspend choke points
 * (openPanel's .then/.catch). Until then the helpers are exported, tested,
 * and intentionally never called from production code — documented
 * non-use, not dead code.
 */

import type { PiUISurface } from "./panel.js";

/**
 * Which mechanism preserves main-editor text across panel suspend/resume.
 * `"native"` — pi's showExtensionCustom snapshot/restore (verified;
 * production does nothing). `"manual"` — reserved for a future regression:
 * wire the snapshot/restore helpers below at panel.ts's suspend choke
 * points. Never read by production logic today; it is the finding's
 * machine-checkable record (and the README limitations quote anchor).
 */
export const EDITOR_PRESERVATION = "native" as const;

/**
 * Belt-and-braces read of the main editor text via the optional
 * `pi.ui.getEditorText()` seam (confirmed at
 * architecture/pi-api-validation.md:43; runtime impl at
 * interactive-mode.js ctx.ui). Returns `undefined` when the seam is absent
 * (test fakes / RPC surfaces) — callers must tolerate that.
 *
 * NOT called from production today (native preservation is verified); this
 * is the capture half of the regression fallback described in the module
 * JSDoc.
 */
export function snapshotEditorText(pi: PiUISurface): string | undefined {
  return pi.ui.getEditorText?.();
}

/**
 * Belt-and-braces restore, guarded so it can NEVER clobber user text:
 * writes `snapshot` back only when the seam exists, the snapshot is
 * defined, AND the editor's current text is empty/whitespace. Returns
 * whether a restore happened.
 *
 * NOT called from production today (native preservation is verified) — and
 * note the guard is exactly why this helper is safe to wire if a pi
 * regression ever requires it: text typed during the suspended side chat
 * (non-empty) is never overwritten.
 */
export function restoreEditorTextIfEmpty(
  pi: PiUISurface,
  snapshot: string | undefined,
): boolean {
  const get = pi.ui.getEditorText;
  const set = pi.ui.setEditorText;
  if (get === undefined || set === undefined || snapshot === undefined) {
    return false;
  }
  const current = get.call(pi.ui);
  if (current !== undefined && current.trim() !== "") return false;
  set.call(pi.ui, snapshot);
  return true;
}

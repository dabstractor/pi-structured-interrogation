/**
 * src/panel/discuss.ts — discuss-in-chat handoff (P1.M6.T2.S2).
 *
 * `ctrl+shift+e` (config `keys.discuss`) from ANY panel view suspends the
 * panel (the same done(null) path as break-out, so the suspend widget line
 * appears and resume works identically) and preloads the MAIN editor with
 * an EXACT h2.35 template quoting the current question. The user then edits
 * and submits the text NORMALLY — their turn, their words; this module
 * never calls sendMessage. The agent side-chats freely and the panel
 * reopens afterwards via ctrl+shift+q / /interrogate / agent reopen:true,
 * with drafts intact (suspend, not resolve).
 *
 * [Mode A] — the preload template is an EXACT contract (prd h2.35, final
 * bullet): "Discuss-in-chat (ctrl+shift+e): suspend + setEditorText with:
 *
 *     > {prompt}
 *     {options one per line, ★ marked}
 *     (discussing q{id} — agent: side-chat freely; reopen panel when done)
 *
 * Concretely, for a choice question with a recommendation the editor
 * receives exactly:
 *
 *     > Should we use sqlite or json?
 *     ★ sqlite
 *     json
 *     (discussing q3 — agent: side-chat freely; reopen panel when done)
 *
 * Text questions (no options) produce prompt line + footer only. The
 * recommendation star matches by option VALUE (short-view.ts's rule) —
 * never by label, so panel and template can never disagree on which option
 * is starred.
 */
import type { Question } from "../state.js";
import type { InterrogationPanel, PiUISurface } from "./panel.js";

/** The footer parenthetical — literal question id, em dash (h2.35). */
const discussFooter = (id: string): string =>
  `(discussing ${id} — agent: side-chat freely; reopen panel when done)`;

/**
 * Build the h2.35 discuss preload template for one question (pure — no I/O,
 * no panel access, fully unit-testable).
 *
 * Shape (h2.35 EXACT contract):
 *   1. `> {prompt}` — the prompt VERBATIM (no trimming, no rewrap).
 *   2. Only for `type === "choice"` with a non-empty `options` array: one
 *      line per option — the human-facing `label`, prefixed `★ ` (star +
 *      single space) on the option whose `value === recommendation` (the
 *      SAME value-match rule as short-view). No cursor `▸`, no ramification
 *      text: the template quotes the question for chat, it does not render
 *      the panel.
 *   3. `(discussing q3 — agent: side-chat freely; reopen panel when
 *      done)` for question id "q3" — the id is interpolated LITERALLY (ids
 *      in this system already carry their own `q` prefix), em dash.
 *
 * Blocks join with "\n"; the string has NO trailing newline (the user's
 * cursor lands right after the footer so they can start typing their take).
 *
 * @param question the question to quote (read-only).
 * @returns the exact editor preload text.
 */
export function buildDiscussTemplate(question: Question): string {
  const lines: string[] = [`> ${question.prompt}`];
  if (question.type === "choice" && question.options !== undefined) {
    for (const opt of question.options) {
      // Star by VALUE (short-view.ts:90/:192 rule) — a label match would
      // silently drop the star the moment the agent renames an option.
      lines.push((opt.value === question.recommendation ? "★ " : "") + opt.label);
    }
  }
  lines.push(discussFooter(question.id));
  return lines.join("\n");
}

/**
 * The discuss-in-chat handoff (h2.35 / h3.1 FR-15 / h2.55 Q36): suspend the
 * panel, then preload the main editor with the question template.
 *
 * Sequence (load-bearing order):
 *   1. Resolve the current question from `panel.currentId` (valid in every
 *      view — short/deep/overview all keep currentId). Missing id or a
 *      question absent from state → return `false`: NO suspend, NO editor
 *      write, the panel simply stays open.
 *   2. Build the template (pure builder above).
 *   3. `panel.suspend()` — the panel's own done(null) path, identical to
 *      the onBreakOut action. NEVER the host's suspendPanel: the key
 *      handler holds the live panel. openPanel's floating .then flips the
 *      host to suspended and paints the resume-widget line.
 *   4. Defer the editor write past a microtask: `void
 *      Promise.resolve().then(() => pi.ui.setEditorText?.(text))`. The
 *      custom() session resolves ASYNCHRONOUSLY and pi restores the editor
 *      region in that resolution — an immediate write inside the key
 *      handler would be CLOBBERED by the restore. The microtask deferral is
 *      the minimum safe ordering; escalate to setTimeout(0) only if the TUI
 *      runbook (P1.M7.T6) still shows clobbering. `setEditorText` is
 *      optional on the surface (test fakes / RPC) — always `?.`, never
 *      throw when absent (suspend still happened).
 *
 * The editor overwrite is DELIBERATE and must WIN over any preservation
 * logic: P1.M6.T2.S3 preserves editor drafts on a PLAIN suspend, but must
 * never revert (or schedule a revert of) this handoff text — the template
 * IS the feature.
 *
 * @returns true when the handoff ran (suspend + deferred write); false
 * when there is no current question (panel left untouched).
 */
export function discussInChat(pi: PiUISurface, panel: InterrogationPanel): boolean {
  const id = panel.currentId;
  const question = id !== undefined ? panel.state.getQuestion(id) : undefined;
  if (question === undefined) return false;

  const text = buildDiscussTemplate(question);

  // Suspend FIRST (done(null)), then write — never the reverse: the write
  // must land after the panel has begun yielding the editor back to pi.
  panel.suspend();
  void Promise.resolve().then(() => pi.ui.setEditorText?.(text));
  return true;
}

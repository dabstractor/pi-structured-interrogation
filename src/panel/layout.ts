/**
 * src/panel/layout.ts — pure layout renderers for the interrogation panel
 * (P1.M3.T1.S2): header, question line, hint line, footer.
 *
 * MODE A CONTRACT — LAYOUT BUDGET (read before touching any renderer):
 *
 * - Every renderer is PURE: (state, config-labels, theme, width) → string.
 *   No state mutation, no settings reads, no panel reference — downstream
 *   views (short P1.M3.T2, deep P1.M5.T1, overview P1.M5.T2) and tests call
 *   them directly without a live panel.
 * - Header and footer each render EXACTLY 1 line at any width ≥ 40 (below
 *   40, P1.M7.T5.T1's narrow-terminal fallbacks own the behavior — these
 *   functions merely must not crash or exceed the width).
 * - Truncation is char-safe: ONLY via {@link truncateVisible}
 *   (visibleWidth/truncateToWidth from @earendil-works/pi-tui — ANSI codes
 *   don't count toward width; wide glyphs do). NEVER String.prototype.slice
 *   on untruncated display text — it breaks ANSI sequences and wide chars.
 * - Shrink priority: header counts NEVER truncate (the goal absorbs all
 *   shrinkage; at extreme widths the header degrades to `┌ interrogation ┐`).
 *   Footer progress + the `⏎ ┘` tail NEVER drop — key hints are dropped
 *   right-to-left first, degrading to progress-only at extreme widths.
 * - Key labels come exclusively from `resolveKeyLabels(config)` (h2.52) —
 *   no remappable-key accelerator literal appears in this module. Only
 *   non-remappable keys ("enter", "esc", "↑/↓") may appear as static
 *   hint words.
 * - h2.28 divergence (deliberate, do NOT unify): the panel header/footer use
 *   a SUBSET of the status-line counts (`answered`, `re-asked`) — no moot
 *   count, no epoch. results.ts buildStatusLine stays the model-facing
 *   format; count SEMANTICS (record-derived answered, orphan ids skipped,
 *   total = order.length) are shared and replicated here.
 */
import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { KeyAction } from "../config.js";
import { UNGROUPED_LABEL, type Question, type SerializedState } from "../state.js";

/**
 * Which panel screen a footer is rendered for (h2.29 views). `"chat"` is
 * the SIDECHAT-001 side-chat view (P1.M2.T4.S1): its hint CONTENT arrives
 * PRE-RENDERED from chat-view.ts's footerHints (the esc word flips with
 * the stream state and the reopen naming rides the resolved chat binding —
 * stream/binding state this module cannot see), threaded through
 * renderFooter's `chatHints` argument; SCREEN_KEYS.chat exists for Record
 * exhaustiveness and as the fallback shape when no hints are supplied.
 */
export type ScreenKind = "short" | "deep" | "overview" | "chat";

/**
 * Keys relevant per screen (FR-10: 3–4 key hints). Order = display order.
 * Screen-specific static hints (non-remappable keys) are appended by
 * {@link renderFooter}: short prefixes "enter accept"; deep appends
 * "esc back · ↑/↓ scroll"; overview appends "enter jump · esc back".
 */
export const SCREEN_KEYS: Record<ScreenKind, KeyAction[]> = {
  short: ["deep", "overview", "submit"],
  deep: ["submit", "overview"],
  overview: ["submit", "deep"],
  // The remappable chat key is the only KeyAction relevant on the chat
  // screen; its hint content (enter send · /clear · esc {abort|exit}) is
  // stream-STATE-dependent and arrives pre-rendered via chatHints.
  chat: ["chat"],
};

/**
 * Narrow-footer key actions (h2.30, cols < 60 — P1.M7.T5.S1): the key hints
 * collapse to at most TWO — submit + deep — on every screen. Deep is the
 * always-available full replacement, so it never leaves the eligible set;
 * the screen's static hints (enter accept / esc back / ↑/↓ scroll / enter
 * jump) remain and the right-to-left fit loop below stays the width safety
 * net. Labels resolve through the caller's `labels` argument — never
 * hardcoded (h2.52).
 */
const NARROW_FOOTER_ACTIONS: readonly KeyAction[] = ["submit", "deep"];

/** Human word for each KeyAction in "{label} {action}" hint pairs. */
const ACTION_WORDS: Record<KeyAction, string> = {
  deep: "deep",
  overview: "list",
  elaborate: "text",
  batchNote: "note",
  submit: "submit",
  chat: "chat",
  externalEditor: "editor",
  prevQuestion: "prev",
  nextQuestion: "next",
};

/** Result of {@link renderHeader}: one bordered line + the untruncated goal. */
export interface HeaderRender {
  /** Exactly 1 line: `┌ interrogation · {goal} ── {counts} ┐`. */
  line: string;
  /** Untruncated goal — the deep view (M5.T1) shows it in full (FR-30). */
  goalFull: string;
}

// ----------------------------------------------------------------- helpers

/**
 * SANITIZE-001 (2026-10-17, owner report "accumulating artifacts"): flatten
 * line-break controls and delete row-corrupting stray controls from text
 * BEFORE it becomes a rendered panel line.
 *
 * The contract every panel renderer owes pi-tui's differential renderer is
 * ONE ARRAY ELEMENT = ONE TERMINAL ROW. pi-tui paints each element with
 * `\x1b[2K` + text + `\r\n` and its `visibleWidth` counts C0 controls as
 * ZERO-width (`\p{Control}` → zeroWidthRegex), so a literal `\n` riding in a
 * word survives `wrapText` (space-split) and `truncateVisible` (width math)
 * alike — and the terminal then EXECUTES it as a line feed (ONLCR ⇒ CRLF):
 * every later row of the frame paints one row below the renderer's model
 * (`previousLines` / `hardwareCursorRow` / `previousViewportTop`), stale
 * short-view rows stay un-overwritten, short new rows overlay long stale
 * rows mid-row, and because the model never learns of the shift, each
 * view switch compounds the desync — stale blocks accumulate in scrollback
 * at +1 per cycle on terminals tall enough for the diff path (on short
 * terminals the `firstChanged < prevViewportTop` full-clear masks it).
 *
 * Model-authored question text (`description`, `ramification`, labels,
 * moot reasons, chat transcripts, write-ins) is free-form multi-paragraph
 * prose, so this is not a hypothetical: the deep view has rendered full
 * text un-truncated since the caps engine was removed (e6e2f3a).
 *
 * Treatment (display-only — NEVER applied to model-facing records):
 * - Line-break controls `\r\n`, `\r`, `\n`, `\x0b` (VT), `\x0c` (FF) —
 *   including a RUN of them with the surrounding spaces/tabs — flatten to
 *   ONE space (word-wrap then re-flows the joined text normally).
 * - Row/cell-corrupting strays `\x00`-`\x06`, `\x08` (BS), `\x0e`/`\x0f`
 *   (SO/SI charset shift), `\x11`/`\x13` (XON/XOFF), `\x14`-`\x1a`,
 *   `\x1c`-`\x1f`, `\x7f` (DEL) are DELETED (invisible; replacing them
 *   with spaces would corrupt spacing).
 * - Preserved: `\x1b` (ANSI CSI/OSC payload — themed fragments flow through
 *   these helpers), `\x07` (BEL — terminates OSC-8 hyperlink sequences),
 *   `\x09` (tab — pi-tui width-accounts it as 3 and normalizes it to
 *   spaces at the terminal seam).
 *
 * Idempotent; identity for already-clean text.
 */
export function sanitizeDisplayText(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex -- SANITIZE-001: matching the line-break controls IS this function's job
      .replace(/(?:[ \t]*(?:\r\n|\r|\n|\x0b|\x0c))+[ \t]*/g, " ")
      // eslint-disable-next-line no-control-regex -- SANITIZE-001: deleting row-corrupting C0 bytes IS this function's job
      .replace(/[\x00-\x06\x08\x0e-\x1a\x1c-\x1f\x7f]/g, "")
  );
}

/**
 * Char-safe truncate with a single `…` ellipsis. ANSI-aware and wide-char
 * aware (delegates to pi-tui truncateToWidth); returns the input unchanged
 * when it already fits. `maxWidth <= 0` yields "". SANITIZE-001: the input
 * is {@link sanitizeDisplayText}-cleaned FIRST — every truncated fragment
 * (labels, teasers, hints, markers, moot reasons, the header goal) is
 * guaranteed a single terminal row even when the source text carried
 * paragraph breaks or stray control bytes.
 */
export function truncateVisible(text: string, maxWidth: number): string {
  const clean = sanitizeDisplayText(text);
  if (maxWidth <= 0) return "";
  if (visibleWidth(clean) <= maxWidth) return clean;
  return stripTerminalSequences(truncateToWidth(clean, maxWidth, "…"));
}

/**
 * Transient footer flash line (h2.37 empty-state feedback, e.g. "nothing to
 * submit", P1.M3.T2.S2): ONE dimmed, two-space-inset line rendered directly
 * above the footer, visibleWidth-bounded so a long message can never wrap.
 * Lifetime/expiry is panel-owned (flash() timer); this is the pure line
 * builder.
 */
export function renderFlashLine(text: string, theme: Theme, width: number): string {
  const budget = Math.max(1, width - 2); // two-column inset (options-region alignment)
  return theme.fg("dim", `  ${truncateVisible(text, budget - 2)}`);
}

/**
 * Soft-gate submit warning line (P1.M5.T3.S1, h2.56): `⚠ {n} foundational
 * unanswered — later answers may shift`, rendered in the SAME slot as
 * {@link renderFlashLine} (directly above the footer) with mirrored styling
 * — one dimmed, two-space-inset, visibleWidth-bounded line. Unlike a flash
 * it does NOT auto-expire: the panel clears it on the next keypress (any
 * key dismisses). The caller passes the text from gate.ts
 * gateWarningLine(count); this is the pure line builder.
 */
export function renderGateWarningLine(text: string, theme: Theme, width: number): string {
  const budget = Math.max(1, width - 2); // two-column inset (mirrors renderFlashLine)
  return theme.fg("dim", `  ${truncateVisible(text, budget - 2)}`);
}

/**
 * Modal ripple-confirm footer (FR-18 / Q39=B, P1.M5.T4.S1):
 * `⚠ Invalidates {n} answered questions ({ids}) — enter=keep, esc=cancel`.
 *
 * Replaces the standard footer WHOLESALE while a ripple confirm is pending
 * (every view + note mode), so the keep/cancel decision is the only footer
 * surface — one line, exactly like renderFooter at any width ≥ 40. Copy
 * hardcodes enter/esc (FIXED keys, Mode A — never config-driven). `ids` is
 * the victim list in computeRipple BFS order, comma-space joined. Styling
 * mirrors the transient slot: two-column inset, ⚠ in accent + dim body,
 * truncateVisible-bounded so a long victim list can never wrap.
 *
 * @param victims answered/submitted ripple ids (BFS order)
 * @param theme   pi theme (⚠ accent, body dim)
 * @param width   total render width budget for the line
 */
export function renderConfirmFooter(victims: string[], theme: Theme, width: number): string {
  const plain = `⚠ Invalidates ${victims.length} answered questions (${victims.join(", ")}) — enter=keep, esc=cancel`;
  const budget = Math.max(1, width - 2); // two-column inset (mirrors renderFlashLine)
  const body = truncateVisible(plain, budget);
  // Compose theme-wrapping AFTER truncation (module contract): accent ⚠,
  // dim remainder — slicing the truncated PLAIN text is ANSI-safe.
  return `  ${theme.fg("accent", body.slice(0, 1))}${theme.fg("dim", body.slice(1))}`;
}

/**
 * First sentence of a description: text up to (and including) the first
 * `.`, `?`, or `!` that is followed by a space or end-of-string; the whole
 * description when no such terminator exists.
 */
export function firstSentence(description: string): string {
  const match = /^(.*?[.!?])(?:\s|$)/s.exec(description);
  return match !== null ? match[1] : description;
}

/**
 * Panel count semantics (mirrors results.ts buildStatusLine discipline,
 * minus moot/epoch which are model-facing only): `answered` is
 * RECORD-DERIVED (2026-10-02 — `answer` present and status
 * `answered`/`submitted`/`closed`, the same rule as results.ts
 * `isRecordAnswered`); total = order.length; orphaned order ids
 * (no matching question) are skipped defensively.
 */
function statusCounts(state: SerializedState): { answered: number; reasked: number; total: number } {
  let answered = 0;
  let reasked = 0;
  for (const id of state.order) {
    const q = state.questions[id];
    if (q === undefined) continue; // defensive: skip orphaned order ids
    if (
      q.answer !== undefined &&
      (q.status === "answered" || q.status === "submitted" || q.status === "closed")
    )
      answered++;
    else if (q.status === "reasked") reasked++;
  }
  return { answered, reasked, total: state.order.length };
}

/**
 * True when the question's answer carries (or is) free text: text
 * questions, elaborations (answer.text), and write-ins (answer.custom —
 * BUG-005 part 1: a hand-written answer IS text for marker purposes,
 * matching overview.ts's markerParts vocabulary).
 */
function hasTextAnswer(q: Question): boolean {
  if (q.status !== "answered" && q.status !== "submitted") return false;
  if (q.answer === undefined) return false;
  // BUG-005 part 1 (WRITEIN-001 parity): a write-in answer (custom: true,
  // value holds the user's own text — committed with NO text field) is a
  // text answer for marker purposes, matching overview markerParts
  // (custom === true || type text → ✎). STRICT true — corrupt truthy
  // values must not leak (same discipline as overview.ts).
  if (q.answer.custom === true) return true;
  return q.type === "text" || (q.answer.text !== undefined && q.answer.text !== "");
}

// --------------------------------------------------------------- renderers

/**
 * Header line (h2.29): `┌ interrogation · {goal} ── {counts} ┐`.
 *
 * Budget: exactly 1 line at width ≥ 40. `counts` is
 * `"{answered}/{total} answered · {reasked} re-asked"` (h2.28 SUBSET — no
 * moot, no epoch). The goal absorbs all shrinkage (truncated with a single
 * `…`); when counts no longer fit the header degrades to
 * `┌ interrogation ┐` (counts never truncate, they vanish whole). The full
 * goal is always returned as {@link HeaderRender.goalFull} for the deep
 * view (FR-30).
 *
 * @param state  plain-JSON state snapshot (read-only)
 * @param theme  pi theme (title dimmed, counts muted)
 * @param width  total render width budget for the line
 */
export function renderHeader(state: SerializedState, theme: Theme, width: number): HeaderRender {
  // 2026-09-30 wayfinding restructure (user direction): the header no
  // longer carries the answered/re-asked counts — the footer's progress
  // segment is their single home (the old duplication read awkwardly next
  // to the position indicator). statusCounts stays only for shape parity.
  void state;
  const title = "interrogation";
  const goalFull = state.goal;

  // Visible widths of the fixed segments (measured UNWRAPPED, then wrapped —
  // compose truncation before theme-wrapping, per module contract).
  const prefixW = "┌ interrogation · ".length; // ┌ + sp + title + sp + · + sp

  if (width >= prefixW + 2) {
    const goalBudget = width - prefixW - 2; // trailing " ┐"
    if (goalFull === "") {
      return { line: `┌ ${theme.fg("dim", title)} ┐`, goalFull };
    }
    const goalTxt = truncateVisible(goalFull, goalBudget);
    return {
      line: `┌ ${theme.fg("dim", title)} · ${goalTxt} ┐`,
      goalFull,
    };
  }
  if (width >= "┌ interrogation ┐".length) {
    return { line: `┌ ${theme.fg("dim", title)} ┐`, goalFull };
  }
  // Below ~19 columns: 1-line, non-crashing minimal border (M7.T5 owns real
  // narrow fallbacks).
  return { line: width >= 2 ? "┌┐" : "┌", goalFull };
}

/**
 * Note-mode header (h2.32, R3/FR-13): `┌ NOTE — ships with next submission ┐`.
 *
 * Title line of the ctrl+shift+m editor-area swap: the batch note is held
 * (exit never destroys it — FR-16) and ships as the model-visible `NOTE:`
 * content line of the NEXT submission, cleared after shipping (h2.32).
 * Styling mirrors {@link renderHeader}'s degraded branch — dim title inside
 * the same `┌ … ┐` border grammar. Degrades WHOLE (never truncates): below
 * the full string's width it collapses to `┌ NOTE ┐`, then to the minimal
 * non-crashing border (M7.T5 owns real narrow fallbacks).
 *
 * @param theme  pi theme (title dimmed)
 * @param width  total render width budget for the line
 */
export function renderNoteHeader(theme: Theme, width: number): string {
  const title = "NOTE — ships with next submission";
  if (width >= `┌ ${title} ┐`.length) return `┌ ${theme.fg("dim", title)} ┐`;
  if (width >= "┌ NOTE ┐".length) return `┌ ${theme.fg("dim", "NOTE")} ┐`;
  return width >= 2 ? "┌┐" : "┌";
}

/**
 * [Mode A] Editor-region duty label (WRITEIN-001, h2.32): the ACTIVE duty
 * decides what the buffer MEANS. Write-in duty's text IS the answer, so the
 * region is labeled `OTHER — this text is the answer` (h2.32, verbatim,
 * em-dash U+2014). The elaboration string ("EXPLAIN — attaches to your
 * selection") is rendered for completeness so the switch is total; its
 * DISPLAY activation (duty-follows-cursor, ctrl+t semantics) is
 * P1.M2.T3.S1 — until then the panel pushes this line only in write-in
 * duty. Fixed spec strings — never configurable, never key labels (h2.32
 * pins "visibly labeled"). Styling mirrors {@link renderNoteHeader}'s
 * dim title; narrow widths truncate char-safely (wide glyphs / ANSI-safe),
 * never String.slice.
 *
 * @param duty   the active editor duty
 * @param theme  pi theme (label dimmed)
 * @param width  total render width budget for the line
 */
export function renderDutyLabel(
  duty: "writein" | "elaboration",
  theme: Theme,
  width: number,
): string {
  const label =
    duty === "writein" ? "OTHER — this text is the answer" : "EXPLAIN — attaches to your selection";
  return theme.fg("dim", truncateToWidth(label, width));
}

/**
 * Status marker fragment for the question line's right side, e.g.
 * `" ⟳ re-asked"` (leading space separator; "" when no marker applies).
 * Markers: `⟳ re-asked`, `★ answered` (FR-D10 — any status carrying
 * `q.answer` EXCEPT moot/withdrawn: answered/submitted/closed — parity
 * with overview.ts markerParts, h2.28 record-derived answered; h2.38
 * archived questions still show ★), `✎ text answer` (text questions,
 * elaborations, and write-ins — custom answers), `⊘ moot` (+ reason from
 * the persisted `mootReason` field — h2.29 format, dimmed, capped below),
 * `⊗ withdrawn` — only the applicable ones,
 * joined with " · ". `⟳ re-asked` overrides ★ (the re-ask is the freshest
 * fact, same precedence as the overview; structural — status is one enum
 * value, so they never co-occur) and ★ composes with `✎ text answer`
 * (joined with " · ": `" ★ answered · ✎ text answer"`). The whole fragment
 * is dim-wrapped so visibleWidth accounting stays ANSI-safe (marker glyphs
 * may be double-width — always measure, never assume 1 col per glyph). The
 * moot reason is capped at {@link MARKER_REASON_CAP} columns so one verbose
 * reason cannot crowd out the question text on ordinary widths.
 */
export function statusMarkers(q: Question, theme: Theme): string {
  const parts: string[] = [];
  if (q.status === "reasked") parts.push("⟳ re-asked");
  if (
    q.answer !== undefined &&
    (q.status === "answered" || q.status === "submitted" || q.status === "closed")
  ) {
    parts.push("★ answered");
  }
  if (hasTextAnswer(q)) parts.push("✎ text answer");
  if (q.status === "moot") {
    // BUG-004: the persisted h2.29 reason (evaluator-owned) replaces the old
    // answer.text derivation — an elaboration is not a moot cause.
    const reason = truncateVisible(q.mootReason ?? "", MARKER_REASON_CAP);
    parts.push(reason === "" ? "⊘ moot" : `⊘ moot ${reason}`);
  }
  if (q.status === "withdrawn") parts.push("⊗ withdrawn");
  return parts.length === 0 ? "" : theme.fg("dim", ` ${parts.join(" · ")}`);
}

/** Max visible columns for the dimmed moot reason (keeps question text room). */
const MARKER_REASON_CAP = 24;

/**
 * Question line (h2.29 short view): `{group} · Q{n}/{id} {title}` with
 * status markers right-aligned at the budget edge.
 *
 * Budget: `width - 2` (inset 2 per the questionnaire.ts pattern); the line
 * is 2-space indented. Shrink priority: the title absorbs shrinkage first,
 * then the group label; markers are measured BEFORE the left part is
 * truncated and are never truncated themselves.
 *
 * @param q         the question to render (title falls back to prompt)
 * @param position  1-based position in state.order
 * @param theme     pi theme (group dimmed, title bold)
 * @param width     total render width budget (inset applied internally)
 * @param dim       soft-gate dimming (P1.M5.T3.S1): wrap the FINISHED line
 *                  (after truncation — the width accounting stays honest) in
 *                  theme.fg("dim", …). Display-only — content, markers, and
 *                  alignment are byte-identical either way. Default false.
 */
export function renderQuestionLine(
  q: Question,
  position: number,
  total: number,
  theme: Theme,
  width: number,
  dim = false,
): string {
  const groupLabel = q.group ?? UNGROUPED_LABEL;
  const titleTxt = q.title ?? q.prompt;
  // 2026-09-30 wayfinding restructure: {n}/{total} next to the question
  // (was Q{n}/{q.id} — position/id mash-up); the header's counts segment is
  // gone, so this is the top-line position home.
  const plain = `${groupLabel} · ${position}/${total} ${titleTxt}`;

  const budget = Math.max(1, width - 2); // inset 2
  let markers = statusMarkers(q, theme);
  let markerW = markers === "" ? 0 : visibleWidth(markers);
  // Last resort (pathological marker content): shrink the markers too —
  // truncateVisible is ANSI-aware, so themed markers survive this intact.
  if (markerW >= budget) {
    markers = truncateVisible(markers, budget);
    markerW = visibleWidth(markers);
  }
  // Left part yields to markers: reserve their width (the marker fragment
  // already carries its leading separator space).
  const leftBudget = Math.max(1, budget - markerW);
  const leftPlain = truncateVisible(plain, leftBudget);

  // Wrap AFTER truncation: the group label dims only while it survived the
  // cut whole (boundary is computed on the truncated PLAIN text — safe).
  let left: string;
  if (leftPlain.length < groupLabel.length) {
    left = theme.fg("dim", leftPlain);
  } else {
    left = theme.fg("dim", groupLabel) + theme.bold(leftPlain.slice(groupLabel.length));
  }

  function finish(): string {
    if (markers === "") return `  ${left}`;
    const gap = Math.max(0, budget - visibleWidth(leftPlain) - markerW);
    return `  ${left}${" ".repeat(gap)}${markers}`;
  }
  // Dim wrap AFTER truncation/composition: theme.fg is ANSI-transparent to
  // visibleWidth, so wrapping the finished line keeps all accounting honest
  // (layout.ts module contract — never slice, always wrap finished text).
  if (!dim) return finish();
  return theme.fg("dim", finish());
}

/**
 * Hint line (short view only): first sentence of `question.description`,
 * dimmed and truncated to `width - 2` (inset 2). Returns [] when the
 * question has no description — the line is omitted entirely, it never
 * renders empty.
 */
export function renderHintLine(q: Question, theme: Theme, width: number, dim = false): string[] {
  if (q.description === undefined || q.description === "") return [];
  const budget = Math.max(1, width - 2); // inset 2
  const line = `  ${theme.fg("dim", truncateVisible(firstSentence(q.description), budget))}`;
  // Dim wrap the FINISHED line (after truncation) — soft-gate dimming is a
  // color-class-only change (P1.M5.T3.S1).
  return [dim ? theme.fg("dim", line) : line];
}

/**
 * Footer hints for the embedded-editor exit affordances (ESC-002). While
 * the editor holds focus the standard "enter accept" prefix becomes
 * "enter save" and an "esc esc back" hint is appended when the double-esc
 * window is armed (escEscHint) — everything else per screen survives minus
 * the lying statics (which include the elaborate explain hint: DROPPED, not
 * swapped — D-R11 as amended, h2.37). No close hint is rendered: since
 * BAREKEYS-001 (h2.74) removed the re-press-to-close toggles, no close
 * gesture exists to advertise, and a bare key must type while the editor
 * holds focus (h2.35) — the editor's own exits (enter, double-esc) need no
 * panel label.
 */
export interface FooterEditorExit {
  /**
   * Which duty the editor is on: "text" (explain field) or "note".
   * Retained for CALL-SITE STABILITY ONLY (panel.ts's footerLine still
   * passes it) — renderFooter no longer reads it (the close hints it
   * selected were removed with BAREKEYS-001's toggle gestures).
   */
  mode: "text" | "note";
  /** True when escExitWindowMs > 0 (the esc-esc hint would otherwise lie). */
  escEscHint: boolean;
}

/**
 * Footer line (h2.29): `└ {progress} · {key hints} ⏎ ┘` where progress is
 * `"{answered}/{total} answered · {reasked} re-asked ·"` (the trailing `·`
 * separates progress from the hints) and key hints are `"{label} {action}"`
 * pairs for the 3–4 keys relevant to {@link screen}, labels resolved by the
 * caller via `resolveKeyLabels(config)` (h2.52 — never hardcoded).
 *
 * Budget: exactly 1 line at width ≥ 40. Degradation drops key hints
 * right-to-left (last first); at extreme widths the footer degrades to
 * `└ {progress} ⏎ ┘` (progress + ⏎ are never dropped, never truncated).
 *
 * Narrow mode (h2.30, cols < 60 — P1.M7.T5.S1): `narrow = true` swaps the
 * per-screen SCREEN_KEYS for exactly {submit, deep} on every screen, then
 * appends the same static hints and runs the same right-to-left fit loop —
 * so at narrow widths the appended statics drop first and the two config
 * key hints survive longest. Default false → byte-identical to the
 * pre-P1.M7.T5.S1 behavior for every existing caller.
 *
 * Editor exit (ESC-002): `editorExit` swaps the prefix to the embedded
 * editor's own affordances (see {@link FooterEditorExit}) — "enter save",
 * optional "esc esc back", screen hints minus the lying statics; the
 * explain hint is dropped (not swapped) and no close hint exists
 * (D-R11 as amended). Omitted → the standard hints.
 *
 * @param state   plain-JSON state snapshot (read-only)
 * @param screen  which view the footer is for (selects SCREEN_KEYS + statics)
 * @param labels  resolved key labels (resolveKeyLabels(config) — memoized by
 *                the panel per session; never re-read settings here)
 * @param theme   pi theme (progress muted, hints dim, ⏎ accent)
 * @param width   total render width budget for the line
 * @param narrow  h2.30 narrow fallback (cols < 60): key hints collapse to
 *                submit + deep. Default false.
 * @param editorExit ESC-002 editor-affordance hints; omit for standard hints.
 * @param position Wayfinding (2026-09-30): 1-based position of the focused
 *        question + total, rendered inside the progress segment as
 *        `q{n}/{total}` — the status line carries WHERE you are (computed
 *        from state; never agent-supplied). Omit to render progress only.
 * @param chatHints SIDECHAT-001 (P1.M2.T4.S1): the PRE-RENDERED chat hint
 *        string from chat-view.ts's footerHints (`enter send · /clear ·
 *        esc {abort|exit}` + the binding-named reopen hint) — composed as
 *        ONE fit-loop entry so degradation drops it whole (progress-only is
 *        the floor, as every screen). Consulted only when `screen` is
 *        "chat"; omitted → the SCREEN_KEYS.chat fallback (`{label} chat`).
 */
export function renderFooter(
  state: SerializedState,
  screen: ScreenKind,
  labels: Record<KeyAction, string>,
  theme: Theme,
  width: number,
  narrow = false,
  editorExit?: FooterEditorExit,
  position?: { n: number; total: number },
  chatHints?: string,
): string {
  const { answered, reasked, total } = statusCounts(state);
  // Wayfinding (2026-09-30): `q{n}/{total}` rides IN the progress segment
  // (never dropped). To pay for it, the re-asked segment is omitted when
  // zero — "0 re-asked" carried no information, and dropping it keeps the
  // hint budget intact at standard widths.
  const progress =
    `${answered}/${total} answered` +
    (reasked > 0 ? ` · ${reasked} re-asked` : "") +
    (position !== undefined ? ` · q${position.n}/${position.total}` : "");

  const keyActions = narrow ? NARROW_FOOTER_ACTIONS : SCREEN_KEYS[screen];
  // SANITIZE-001: key labels (config-resolved) and the pre-rendered chat
  // hint string are the only footer fragments that reach the line WITHOUT
  // passing truncateVisible/wrapText — sanitize them at composition so the
  // footer line keeps the one-element-one-row contract unconditionally
  // (the fit loop below measures visibleWidth only, which counts control
  // bytes as zero-width and would happily pass a stray \n through).
  const hints: string[] = keyActions.map(
    (action) => `${sanitizeDisplayText(labels[action])} ${ACTION_WORDS[action]}`,
  );
  // Chat (SIDECHAT-001): swap the mapped hints for the pre-rendered string
  // BEFORE the static pushes (none of which target chat) and the fit loop.
  // The narrow NARROW_FOOTER_ACTIONS swap never reaches a chat screen's
  // content either: the string itself already shrinks via chat-view's own
  // budget handling.
  if (screen === "chat") {
    hints.length = 0;
    hints.push(sanitizeDisplayText(chatHints ?? `${labels.chat} ${ACTION_WORDS.chat}`));
  }
  if (screen === "short") hints.unshift("enter accept"); // enter is not remappable
  if (screen === "short") hints.push(`${labels.elaborate} explain`); // D-R11: the footer permanently names the chord
  if (screen === "deep")
    hints.push("esc back", "↑/↓ scroll", `${labels.elaborate} explain`); // DEEP-EDITOR-001: D-R11 parity — deep is a first-class editing surface
  if (screen === "overview") hints.push("enter jump", "esc back");
  if (editorExit !== undefined) {
    // While the editor holds focus the screen statics lie: enter no longer
    // accepts/jumps (it SAVES — two-stage, h2.31), esc does not descend
    // (single esc forwards to the editor), arrows do not scroll. Drop the
    // descent statics and the elaborate explain hint with them; swap in the
    // editor's own affordances. D-R11 as amended (h2.37 / ui-spec :116):
    // the explain hint is DROPPED, not swapped — bare keys never intercept
    // in editor focus (h2.35/BAREKEYS-001), and the editor's own exits
    // (enter save, double-esc) need no panel label, so NO close hint is
    // advertised either. The fit loop's first casualty while editor-focused
    // is therefore "esc esc back" (right-to-left pop order).
    const statics = new Set(["enter accept", "enter jump", "esc back", "↑/↓ scroll", `${labels.elaborate} explain`]);
    const kept = hints.filter((h) => !statics.has(h));
    hints.length = 0;
    hints.push("enter save", ...kept);
    if (editorExit.escEscHint) hints.push("esc esc back");
  }

  // Drop hints right-to-left until the full form fits; progress-only is the
  // final degradation (never dropped, never truncated).
  while (hints.length > 0 && visibleWidth(`└ ${progress} · ${hints.join(" · ")} ⏎ ┘`) > width) {
    hints.pop();
  }
  if (hints.length === 0) {
    return `└ ${theme.fg("muted", progress)} ${theme.fg("accent", "⏎")} ┘`;
  }
  return `└ ${theme.fg("muted", `${progress} ·`)} ${theme.fg("dim", hints.join(" · "))} ${theme.fg("accent", "⏎")} ┘`;
}

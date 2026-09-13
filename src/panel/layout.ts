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
 *   format; count SEMANTICS (status === "answered" only, orphan ids skipped,
 *   total = order.length) are shared and replicated here.
 */
import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { KeyAction } from "../config.js";
import { UNGROUPED_LABEL, type Question, type SerializedState } from "../state.js";

/** Which panel screen a footer is rendered for (h2.29 views). */
export type ScreenKind = "short" | "deep" | "overview";

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
};

/** Human word for each KeyAction in "{label} {action}" hint pairs. */
const ACTION_WORDS: Record<KeyAction, string> = {
  deep: "deep",
  overview: "list",
  focusText: "text",
  batchNote: "note",
  submit: "submit",
  breakOut: "break out",
  discuss: "discuss",
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
 * Char-safe truncate with a single `…` ellipsis. ANSI-aware and wide-char
 * aware (delegates to pi-tui truncateToWidth); returns the input unchanged
 * when it already fits. `maxWidth <= 0` yields "".
 *
 * NOTE: pi-tui adorns a cut with reset sequences (`…\u001b[0m`); since this
 * module composes theme-wrapping AFTER truncation (module contract), the
 * adornment is stripped so callers always receive plain text back.
 */
export function truncateVisible(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (visibleWidth(text) <= maxWidth) return text;
  return stripTerminalSequences(truncateToWidth(text, maxWidth, "…"));
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
 * minus moot/epoch which are model-facing only): `answered` counts
 * status === "answered" ONLY; total = order.length; orphaned order ids
 * (no matching question) are skipped defensively.
 */
function statusCounts(state: SerializedState): { answered: number; reasked: number; total: number } {
  let answered = 0;
  let reasked = 0;
  for (const id of state.order) {
    const q = state.questions[id];
    if (q === undefined) continue; // defensive: skip orphaned order ids
    if (q.status === "answered") answered++;
    else if (q.status === "reasked") reasked++;
  }
  return { answered, reasked, total: state.order.length };
}

/** True when the question's answer carries (or is) free text. */
function hasTextAnswer(q: Question): boolean {
  if (q.status !== "answered" && q.status !== "submitted") return false;
  if (q.answer === undefined) return false;
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
  const { answered, reasked, total } = statusCounts(state);
  const counts = `${answered}/${total} answered · ${reasked} re-asked`;
  const title = "interrogation";
  const goalFull = state.goal;

  // Visible widths of the fixed segments (measured UNWRAPPED, then wrapped —
  // compose truncation before theme-wrapping, per module contract).
  const prefixW = "┌ interrogation · ".length; // ┌ + sp + title + sp + · + sp
  const suffixW = " ──  ┐".length + counts.length; // sp + ── + sp + counts + sp + ┐

  if (width >= prefixW + suffixW + 1) {
    // Counts fit whole — goal takes whatever remains (≥ 1 col).
    const goalBudget = width - prefixW - suffixW;
    if (goalFull === "") {
      return {
        line: `┌ ${theme.fg("dim", title)} ── ${theme.fg("muted", counts)} ┐`,
        goalFull,
      };
    }
    const goalTxt = truncateVisible(goalFull, goalBudget);
    return {
      line: `┌ ${theme.fg("dim", title)} · ${goalTxt} ── ${theme.fg("muted", counts)} ┐`,
      goalFull,
    };
  }
  if (width >= "┌ interrogation ┐".length) {
    // Degrade: drop counts + goal whole (they never truncate).
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
 * Status marker fragment for the question line's right side, e.g.
 * `" ⟳ re-asked"` (leading space separator; "" when no marker applies).
 * Markers: `⟳ re-asked`, `✎ text answer`, `⊘ moot` (+ reason from the
 * answer text, dimmed), `⊗ withdrawn` — only the applicable ones, joined
 * with " · ". The whole fragment is dim-wrapped so visibleWidth accounting
 * stays ANSI-safe (marker glyphs may be double-width — always measure,
 * never assume 1 col per glyph). The moot reason is capped at
 * {@link MARKER_REASON_CAP} columns so one verbose reason cannot crowd out
 * the question text on ordinary widths.
 */
export function statusMarkers(q: Question, theme: Theme): string {
  const parts: string[] = [];
  if (q.status === "reasked") parts.push("⟳ re-asked");
  if (hasTextAnswer(q)) parts.push("✎ text answer");
  if (q.status === "moot") {
    const reason = truncateVisible(q.answer?.text ?? "", MARKER_REASON_CAP);
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
  theme: Theme,
  width: number,
  dim = false,
): string {
  const groupLabel = q.group ?? UNGROUPED_LABEL;
  const titleTxt = q.title ?? q.prompt;
  const plain = `${groupLabel} · Q${position}/${q.id} ${titleTxt}`;

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
 * @param state   plain-JSON state snapshot (read-only)
 * @param screen  which view the footer is for (selects SCREEN_KEYS + statics)
 * @param labels  resolved key labels (resolveKeyLabels(config) — memoized by
 *                the panel per session; never re-read settings here)
 * @param theme   pi theme (progress muted, hints dim, ⏎ accent)
 * @param width   total render width budget for the line
 */
export function renderFooter(
  state: SerializedState,
  screen: ScreenKind,
  labels: Record<KeyAction, string>,
  theme: Theme,
  width: number,
): string {
  const { answered, reasked, total } = statusCounts(state);
  const progress = `${answered}/${total} answered · ${reasked} re-asked`;

  const hints: string[] = SCREEN_KEYS[screen].map((action) => `${labels[action]} ${ACTION_WORDS[action]}`);
  if (screen === "short") hints.unshift("enter accept"); // enter is not remappable
  if (screen === "deep") hints.push("esc back", "↑/↓ scroll");
  if (screen === "overview") hints.push("enter jump", "esc back");

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

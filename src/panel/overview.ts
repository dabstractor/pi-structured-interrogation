/**
 * src/panel/overview.ts — overview list renderer + cursor/jump model
 * (P1.M5.T2.S1, FR-11 / h2.29).
 *
 * The overview (ctrl+l) is the navigation-freedom surface for hard
 * requirement R1: a full-screen-in-panel list of ALL questions in
 * `state.orderedQuestions()` order — NEVER filtered (R1/Q34=A: moot,
 * withdrawn, and closed questions stay listed) — each row carrying its
 * status marker, with dimmed group headers inserted at group boundaries
 * and the gate group's header marked `▲`. A cursor row moves with ↑/↓ and
 * the config prevQuestion/nextQuestion accelerators (contract 3); `enter`
 * jumps to the selected question in the SHORT form (focus restored, R2
 * preselect re-seeded via the currentId setter); `esc` descends the
 * existing router ladder (deepSticky-aware) without destroying anything
 * (FR-16).
 *
 * MODE A CONTRACT — MARKER GLYPH VOCABULARY (contract 5, panel-wide per
 * short-view.ts / deep-view.ts):
 *
 * - `·`  open question (no answer recorded)
 * - `★`  answered — ANY status carrying `q.answer` (answered, submitted,
 *        closed — h2.38 archived-but-answerable still shows ★)
 * - `⟳`  re-asked (overrides ★ — the re-ask is the freshest fact)
 * - `⊘`  moot (row dimmed; the h2.29-format reason rides the row text)
 * - `⊗`  withdrawn (row dimmed)
 * - `✎`  has-text answer — APPENDED (space-joined) to the marker whenever
 *        `q.answer?.text` is non-empty; composes with ⟳ and ★ only.
 *
 * Marker PRECEDENCE (highest wins): withdrawn ⊗ > moot ⊘ > re-asked ⟳ >
 * answered ★ > open ·. Moot/withdrawn suppress the ✎ suffix (their row
 * already carries the reason; a withdrawn row is the audit trail itself).
 *
 * MODE A CONTRACT — ALIGNMENT (mirrors short-view.ts):
 *
 * - Content is inset 2 columns (INSET); the cursor prefix is `▸ ` (2
 *   visible cols) and the non-cursor prefix two spaces, so titles stay
 *   column-aligned between cursor and non-cursor rows.
 * - Glyph widths are NEVER assumed — truncation and assertions go through
 *   visibleWidth/truncateVisible (ANSI- and wide-char-safe; never
 *   String.prototype.slice on display text).
 *
 * RENDER BUDGET (h2.51 risk row 2): the list renders inside a
 * constant-height window of {@link OVERVIEW_HEIGHT} content lines — a
 * module constant, NOT terminal rows (panel.render(width) has no height;
 * terminal-height adaptation is P1.M7.T5.S1). The scroll offset clamps so
 * the cursor row is ALWAYS visible (simpler than the deep view's
 * sticky-header rule — no sticky headers here).
 *
 * Purity: the builders are pure (inputs → strings/numbers, no state
 * mutation, no I/O, no key handling). Cursor/scroll state lives on the
 * panel; the panel actions at the bottom mutate panel fields only.
 * Structure mirrors short-view.ts / deep-view.ts: constants → helpers →
 * builder → clamp → panel actions.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { UNGROUPED_LABEL, type Question } from "../state.js";
import { truncateVisible } from "./layout.js";
import type { InterrogationPanel } from "./panel.js";

// ---------------------------------------------------------------- constants

/**
 * Overview window height in CONTENT lines (h2.51 row 2) — header and footer
 * render outside it. A constant because render(width) carries no height;
 * P1.M7.T5.S1 (terminal fallback) owns any dynamic sizing.
 */
export const OVERVIEW_HEIGHT = 20;

/** Two-column inset applied to every line (short-view.ts pattern). */
const INSET = "  ";
/** Cursor prefix — exactly 2 visible cols so titles align with "  ". */
const CURSOR = "▸ ";
/** Non-cursor prefix — two spaces, same width as the cursor prefix. */
const BLANK = "  ";
/** Gate-group flag appended to a group header (group-level attribute). */
const GATE_MARK = " ▲";
/** Moot reason separator inside a row (mirrors short-view's " — "). */
const MOOT_SEP = " — ";
/** Generic moot reason when state carries no derivable cause. */
const DEFAULT_MOOT_REASON = "dependency changed";
/**
 * Max visible columns for the moot reason in a row (mirrors layout.ts's
 * MARKER_REASON_CAP) — one verbose cause cannot crowd the question text to
 * nothing; the title absorbs the remaining shrink instead.
 */
const REASON_CAP = 24;
/**
 * Fallback render width for scroll math before the panel's first render
 * (lastWidth === -1) — mirrors deep-view.ts; the next render re-clamps.
 */
const FALLBACK_WIDTH = 80;

// ------------------------------------------------------------------ helpers

/**
 * [Mode A — contract 5] Status marker for one overview row, documenting the
 * glyph semantics in force panel-wide (see the module JSDoc for the full
 * vocabulary):
 *
 * - `·` open (no answer)
 * - `★` answered — any status carrying `q.answer` EXCEPT moot/withdrawn
 *   (answered/submitted/closed — h2.38 archived questions still show ★)
 * - `⟳` re-asked — overrides ★ (the re-ask is the freshest fact)
 * - `⊘` moot — overrides everything below it
 * - `⊗` withdrawn — highest precedence
 * - `✎` appended (space-joined) whenever `q.answer?.text` is non-empty;
 *   composes with ⟳/★ (and ·), suppressed on ⊘/⊗ rows whose text already
 *   carries the audit-trail reason.
 *
 * Pure: reads the question only.
 */
export function overviewMarker(q: Question): string {
  let m = "·";
  if (q.answer !== undefined && q.status !== "moot" && q.status !== "withdrawn") m = "★";
  if (q.status === "reasked") m = "⟳";
  if (q.status === "moot") m = "⊘";
  if (q.status === "withdrawn") m = "⊗";
  if ((q.answer?.text ?? "") !== "" && m !== "⊗" && m !== "⊘") m += " ✎";
  return m;
}

/**
 * Reason string for a moot overview row. depends-on.ts derives
 * h2.29-format reasons (e.g. `moot: storage=sqlite`); layout.ts
 * statusMarkers reads `q.answer?.text` for the header fragment while
 * short-view's mootReason reads `q.answer?.value` — this overview reader
 * prefers the text (the depends-on contract) and falls back to the value
 * (the short-view contract), then the generic cause. Empty strings count
 * as missing (a "" text must not shadow a real value).
 */
export function overviewMootReason(q: Question): string {
  const text = q.answer?.text;
  if (text !== undefined && text !== "") return text;
  const value = q.answer?.value;
  if (value !== undefined && value !== "") return value;
  return DEFAULT_MOOT_REASON;
}

// -------------------------------------------------------------- builder in

/** Inputs to the overview content builder ({@link buildOverviewContent}). */
export interface OverviewInput {
  /** state.orderedQuestions() — the render order source (never filtered). */
  ordered: Question[];
  /** Cursor index into `ordered` (NOT into rendered rows). */
  cursorIndex: number;
  theme: Theme;
  /** Full panel render width; content budget = width - 2 (INSET). */
  width: number;
}

/**
 * Flattened overview content (pre-window). One reusable build serves both
 * scroll clamping ({@link clampOverviewScroll}) and rendering (the panel's
 * buildLines slices `lines` to the window).
 */
export interface OverviewContent {
  /** Flattened content lines — group headers + question rows, styled. */
  lines: string[];
  /** Per question i: rendered-line index of its row (for scroll clamping). */
  questionRowLine: number[];
  /** Viewport height cap ({@link OVERVIEW_HEIGHT}). */
  viewportHeight: number;
}

// ---------------------------------------------------------- content builder

/**
 * Pure overview content builder (FR-11 / h2.29): one row per question in
 * `ordered` order — NEVER filtered (R1/Q34=A) — with a dimmed group header
 * inserted whenever a question's effective group (`q.group ??
 * {@link UNGROUPED_LABEL}`) differs from the previous question's. The gate
 * group's header (ANY member with `gate === true` — a group-level attribute
 * computed from membership) renders `{group} ▲`.
 *
 * Row shape: `{prefix}{marker} {title-or-prompt}` where the prefix is
 * `▸ ` for the cursor row and two spaces otherwise (short-view alignment);
 * moot rows append ` — {reason}`; the whole row renders dimmed when the
 * status is moot or withdrawn. Shrink priority mirrors renderQuestionLine:
 * the title absorbs shrinkage first, the reason shrinks second (it is
 * already capped at {@link REASON_CAP} columns), and the prefix/marker are
 * never truncated. Every emitted line satisfies `visibleWidth ≤ width`.
 */
export function buildOverviewContent(input: OverviewInput): OverviewContent {
  const { ordered, cursorIndex, theme, width } = input;
  const budget = Math.max(1, width - INSET.length);

  // ONE pre-pass for gate groups: any question with gate === true marks its
  // EFFECTIVE group; the group's header then carries ▲ for all its rows.
  const gateGroups = new Set(
    ordered.filter((q) => q.gate === true).map((q) => q.group ?? UNGROUPED_LABEL),
  );

  const lines: string[] = [];
  const questionRowLine: number[] = [];
  let currentGroup: string | undefined;

  for (let i = 0; i < ordered.length; i++) {
    const q = ordered[i]!;
    const group = q.group ?? UNGROUPED_LABEL;
    if (group !== currentGroup) {
      const label = gateGroups.has(group) ? `${group}${GATE_MARK}` : group;
      lines.push(`${INSET}${theme.fg("dim", truncateVisible(label, budget))}`);
      currentGroup = group;
    }
    questionRowLine.push(lines.length);
    lines.push(questionRow(q, i, cursorIndex, theme, budget));
  }
  return { lines, questionRowLine, viewportHeight: OVERVIEW_HEIGHT };
}

/**
 * One question row: inset + cursor prefix + marker + title (+ dim-included
 * moot reason), dimmed wholesale for moot/withdrawn — cursor prefix
 * included (h2.29, mirrors short-view's moot dimming).
 */
function questionRow(
  q: Question,
  index: number,
  cursorIndex: number,
  theme: Theme,
  budget: number,
): string {
  const prefix = index === cursorIndex ? CURSOR : BLANK;
  const marker = overviewMarker(q);
  const headW = visibleWidth(prefix) + visibleWidth(marker) + 1; // +1 space
  const dim = q.status === "moot" || q.status === "withdrawn";

  // Reason FIRST (it is capped, not squeezed): the title absorbs whatever
  // budget remains — the renderQuestionLine shrink order (markers measured
  // before the left part; the left part yields).
  let reason = "";
  if (q.status === "moot") {
    const capped = truncateVisible(overviewMootReason(q), REASON_CAP);
    const titleBudget = Math.max(1, budget - headW - visibleWidth(MOOT_SEP) - visibleWidth(capped));
    const title = truncateVisible(q.title ?? q.prompt, titleBudget);
    // Pathological widths: even the capped reason no longer fits beside the
    // title — shrink the reason to what remains, or drop it entirely (the
    // ⊘ marker still flags the row; reason text is additive).
    const reasonBudget = budget - headW - visibleWidth(title) - visibleWidth(MOOT_SEP);
    if (reasonBudget >= 1) reason = MOOT_SEP + truncateVisible(overviewMootReason(q), reasonBudget);
    const body = `${prefix}${marker} ${title}${reason}`;
    return `${INSET}${dim ? theme.fg("dim", body) : body}`;
  }

  const title = truncateVisible(q.title ?? q.prompt, Math.max(1, budget - headW));
  const body = `${prefix}${marker} ${title}`;
  return `${INSET}${dim ? theme.fg("dim", body) : body}`;
}

// ----------------------------------------------------- scroll window clamp

/**
 * [Mode A] Window clamp — keeps the cursor row visible inside the
 * {@link OVERVIEW_HEIGHT}-line window (simpler than deep view's
 * sticky-header rule: no sticky headers here). The offset is squeezed into
 * the cursor-visibility range `[rowLine - viewportHeight + 1, rowLine]`
 * (minimal movement: a cursor row already inside the window never shifts
 * the offset) and finally into the global bounds
 * `[0, max(0, lines.length - viewportHeight)]` — never negative, never past
 * the end. The cursor row ALSO pins the offset from above (offset > rowLine
 * would scroll it off the window top). A cursor without a row (out-of-range
 * index, empty list) falls back to row 0 per the blueprint — the offset
 * pins to the top.
 */
export function clampOverviewScroll(content: OverviewContent, scroll: number, cursorIndex: number): number {
  const max = Math.max(0, content.lines.length - content.viewportHeight);
  const row = content.questionRowLine[cursorIndex] ?? 0;
  return Math.max(0, Math.min(Math.max(scroll, row - content.viewportHeight + 1), Math.min(row, max)));
}

// ------------------------------------------------------------ panel actions

/**
 * Panel render context for the overview actions: mirrors deep-view's
 * deepInput — the scroll offset indexes CONTENT LINES, which depend on
 * width, so clamping uses the width the list was last rendered at
 * ({@link FALLBACK_WIDTH} before the first render; the next render
 * re-clamps defensively via {@link clampOverviewScroll} in buildLines).
 */
function overviewInput(panel: InterrogationPanel, cursorIndex: number): OverviewInput {
  return {
    ordered: panel.state.orderedQuestions(),
    cursorIndex,
    theme: panel.theme,
    width: panel.lastWidth > 0 ? panel.lastWidth : FALLBACK_WIDTH,
  };
}

/** Move the overview cursor up one question (clamped at 0, no wrap). */
export function overviewUp(panel: InterrogationPanel): boolean {
  return stepOverviewCursor(panel, -1);
}

/** Move the overview cursor down one question (clamped at the last row). */
export function overviewDown(panel: InterrogationPanel): boolean {
  return stepOverviewCursor(panel, 1);
}

/**
 * Shared cursor step: mutate `panel.overviewCursor` within
 * `[0, ordered.length - 1]` — group headers are NOT cursor rows —
 * recompute `panel.overviewScroll` via {@link clampOverviewScroll}, and
 * invalidate. NEVER touches `panel.currentId` or `panel.cursorIndex`
 * (h2.29: the ONLY exit-to-question is `enter`/`esc`). Consumed no-op
 * (true) when there is nothing to move onto.
 */
function stepOverviewCursor(panel: InterrogationPanel, delta: number): boolean {
  const count = panel.state.orderedQuestions().length;
  if (count === 0) return true;
  const next = Math.min(count - 1, Math.max(0, panel.overviewCursor + delta));
  if (next !== panel.overviewCursor) {
    panel.overviewCursor = next;
    panel.overviewScroll = clampOverviewScroll(
      buildOverviewContent(overviewInput(panel, next)),
      panel.overviewScroll,
      next,
    );
    panel.invalidate();
  }
  return true;
}

/**
 * `enter` in overview (contract 3 / FR-11): jump to the selected question
 * in the SHORT form — even when deepSticky is set (the user can re-enter
 * deep with ctrl+d; deepSticky stays set for the next esc-from-overview).
 *
 * - Blur the embedded editor first when text focus is active (the jump
 *   restores options focus); note focus never reaches here (the panel's
 *   stage-1 enter intercept fires before the router) and is left untouched
 *   defensively — a held note stays held.
 * - `panel.currentId = q.id` re-seeds the short-view option cursor to the
 *   ★ recommendation (R2 preselect) via the setter.
 * - `panel.setView("short")` + reset the overview scroll offset.
 *
 * No-questions: consumed no-op (`true`) with a transient footer flash —
 * nothing else changes. Out-of-range cursor (defensive): `false`.
 */
export function overviewJump(panel: InterrogationPanel): boolean {
  const ordered = panel.state.orderedQuestions();
  if (ordered.length === 0) {
    panel.flash("no questions");
    return true;
  }
  const q = ordered[panel.overviewCursor];
  if (q === undefined) return false;
  if (panel.focus === "text") panel.blurTextField();
  panel.currentId = q.id; // setter re-seeds cursorIndex (R2 preselect)
  panel.setView("short");
  panel.overviewScroll = 0;
  return true;
}

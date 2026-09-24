/**
 * src/panel/deep-view.ts — deep view renderer + scroll/selection model
 * (P1.M5.T1.S1).
 *
 * The deep view (FR-8 / h2.29 / Q19-Q20) is a FULL replacement of the Q&A
 * region between header and footer: the full goal text (FR-30, dimmed) on
 * top, then the full `question.description`, then one sticky section per
 * option (`▸ ★ sqlite` header + wrapped ramification text), then — on
 * choice questions — the synthetic `✎ Other — write your own` section
 * (P1.M2.T6.S1). `↑/↓` SCROLL the pane / move the selection — they NEVER
 * navigate questions (h2.29: question navigation belongs to the config
 * prev/next keys only); `enter` selects the highlighted option — or, on
 * the Other section, opens the write-in duty back on the short form
 * (h2.32) — and returns to the short view (advancing to the next
 * unanswered question, Q14); `esc` descends via the existing
 * router ladder without destroying anything (FR-16).
 *
 * MODE A CONTRACT — MARKER GLYPH VOCABULARY (panel-wide, short-view.ts):
 *
 * - `★`  recommended option (header body `▸ ★ label` — unmistakable, R2)
 * - `⊘`  moot (reason line prepended, whole pane dimmed)
 * - `⊗`  withdrawn (pane collapses to the single dim line)
 * - `▸`  cursor / highlighted section header
 * - `✎`  the synthetic Other section on choice questions (P1.M2.T6.S1):
 *   rendered AFTER the last option at cursor index `options.length`; the
 *   label is shared with short-view.ts (`OTHER_AFFORDANCE`) and the
 *   ramification is the fixed `OTHER_RAMIFICATION` string (h2.29). It is
 *   selectable (same sticky-header machinery as real options) and `enter`
 *   on it enters the write-in duty — short form + editor focused (h2.32).
 *   Text questions still render goal + description only and `enter` is a
 *   consumed no-op (the embedded editor composes on the short form).
 *
 * MODE A CONTRACT — ALIGNMENT (mirrors short-view.ts):
 *
 * - Content is inset 2 columns (`INSET`); the cursor prefix is `▸ ` (2
 *   visible cols) and the non-cursor prefix two spaces, so header labels
 *   stay column-aligned. Ramification lines are indented 4 columns total,
 *   aligning under the header label.
 * - Glyph widths are NEVER assumed: wrapping and truncation go through
 *   visibleWidth/truncateVisible (ANSI- and wide-char-safe; never
 *   String.prototype.slice on display text — the per-text char cap is the
 *   one exception, capping SOURCE characters before rendering, mirroring
 *   the config caps' char-count semantics).
 *
 * MODE A CONTRACT — RENDER BUDGET (h2.51 risk row 2): the pane is capped at
 * {@link DEEP_VIEW_HEIGHT} content lines (a module constant, NOT terminal
 * rows — panel.render(width) has no height parameter; M7.T5.S1 adapts) and
 * every text block is capped at the config ramification char cap with `…`
 * appended when truncated. Huge descriptions/ramifications cannot blow the
 * terminal; the overview list (M5.T2) is the escape hatch.
 *
 * Purity: the builders/renderers are pure (no state mutation, no I/O, no
 * key handling — mutations live in the named actions below and on the
 * panel). Structure mirrors short-view.ts: constants → helpers → builder →
 * line/window renderers → panel actions.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Question } from "../state.js";
import { acceptOptionIndex } from "./actions.js";
import { truncateVisible } from "./layout.js";
import type { InterrogationPanel } from "./panel.js";
import { OTHER_AFFORDANCE, initialCursorIndex, mootReason } from "./short-view.js";

// ---------------------------------------------------------------- constants

/**
 * Deep pane height cap in CONTENT lines (h2.51 row 2) — header and footer
 * render outside it. A constant because render(width) carries no height;
 * M7.T5.S1 (terminal fallback) owns any dynamic sizing.
 */
export const DEEP_VIEW_HEIGHT = 20;

/** Two-column inset applied to every content line (short-view.ts pattern). */
const INSET = "  ";
/** Cursor prefix — exactly 2 visible cols so labels align with "  ". */
const CURSOR = "▸ ";
/** Non-cursor prefix — two spaces, same width as the cursor prefix. */
const BLANK = "  ";
/** Recommendation mark inserted between prefix and label (short-view.ts). */
const STAR = "★ ";
/** Ramification indent (4 visible cols total) — aligns under header labels. */
const RAM_INDENT = "    ";
/** Moot reason line head (mirrors short-view.ts). */
const MOOT_HEAD = "⊘ moot — ";
/** Withdrawn questions collapse to this single dimmed line. */
const WITHDRAWN_LINE = "⊗ withdrawn";
/**
 * The synthetic Other section's ramification (P1.M2.T6.S1, h2.29) — a FIXED
 * extension-supplied string rendered verbatim through the SAME
 * capText → wrapText → dim → RAM_INDENT pipeline as option ramifications.
 * Deliberately NOT configurable; never starred (the Other row is not an
 * option and is never recommended).
 */
export const OTHER_RAMIFICATION =
  "None of the listed options fit — write your own answer; it ships as the official answer for this question, not as an attachment to one of them.";
/**
 * Fallback render width for scroll math before the panel's first render
 * (lastWidth === -1) — only affects offset clamping fidelity between the
 * action and the next real render; renderDeepWindow re-clamps defensively.
 */
const FALLBACK_WIDTH = 80;

// -------------------------------------------------------------------- types

/** Inputs to the deep content builder ({@link buildDeepContent}). */
export interface DeepViewInput {
  question: Question;
  /** FULL goal text (FR-30) — read from state.goal, never the header's cut. */
  goal: string;
  /** Highlighted option index (advisory — baked into placeholder headers). */
  cursorIndex: number;
  /** Scroll offset (advisory — clamping happens in {@link clampScroll}). */
  scrollOffset: number;
  theme: Theme;
  /** Full panel render width; content budget = width - 2 (INSET). */
  width: number;
  /** Per-text char cap (config.caps.ramification) — h2.51 row 2. */
  maxChars: number;
}

/**
 * Flattened deep pane content (pre-window). One reusable build serves both
 * scroll clamping ({@link clampScroll} — needs line counts + header indexes)
 * and rendering ({@link renderDeepWindow} — slices + re-styles headers).
 */
export interface DeepContent {
  /**
   * Flattened content lines, fully styled — EXCEPT section header lines,
   * which are baked with the build-time cursor prefix and re-rendered by
   * {@link renderDeepWindow} so the highlighted header always carries `▸ `.
   */
  lines: string[];
  /** Per option: index into {@link lines} of its section header line. */
  sectionHeaderLineIndex: number[];
  /** Per section: plain header body (`★ sqlite` / `postgres` / the ✎ Other
   *  label), theme-free. The Other section is always the LAST entry. */
  sectionHeaders: string[];
  /** True for moot questions — headers re-render dimmed (whole pane dim). */
  dimAll: boolean;
  /** Viewport height cap ({@link DEEP_VIEW_HEIGHT}). */
  viewportHeight: number;
}

// ------------------------------------------------------------------ helpers

/**
 * Cap SOURCE text at `maxChars` characters with `…` appended when truncated
 * (h2.51 row 2 — char-count semantics matching the config caps, applied
 * before wrapping; display-width safety stays with wrapText/truncateVisible).
 */
function capText(text: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "…";
}

/**
 * Word-wrap `text` to `budget` visible columns (visibleWidth-aware — glyph
 * widths are never assumed): split on spaces and accumulate lines while
 * `visibleWidth(line + " " + word)` fits; a single word longer than the
 * budget is hard-truncated with `…` via truncateVisible (which also bounds
 * every emitted line). Never returns an empty array — a blank input yields
 * one empty line so block separators stay symmetrical.
 */
export function wrapText(text: string, budget: number): string[] {
  const b = Math.max(1, budget);
  const words = text.split(" ").filter((w) => w !== "");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    if (visibleWidth(word) > b) {
      // Unbreakable overlong word: flush, then hard-truncate it onto one
      // line — truncateVisible already appends the single `…` adornment.
      if (cur !== "") {
        lines.push(cur);
        cur = "";
      }
      lines.push(truncateVisible(word, b - 1));
      continue;
    }
    if (cur === "") {
      cur = word;
      continue;
    }
    const candidate = `${cur} ${word}`;
    if (visibleWidth(candidate) <= b) cur = candidate;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines.length > 0 ? lines : [""];
}

// ---------------------------------------------------------- content builder

/**
 * Pure deep-pane content builder (h2.29 layout, FR-30 / FR-8): the FULL
 * goal text (dimmed, capped + wrapped), a blank separator, the FULL
 * `question.description` (capped + wrapped), a blank separator, then one
 * section per option in state order (never filtered or reordered — R1):
 * a header line `▸ label` / `▸ ★ label` (★ when the option matches
 * `q.recommendation` — same vocabulary as short-view.ts) followed by its
 * ramification wrapped over indented (4-col) dimmed lines.
 *
 * Dim hierarchy: the goal and ramification lines render dim ALWAYS (the
 * goal is context, the ramification is the expanded short-view teaser,
 * which renders dim there); the description renders full intensity; moot
 * dims the whole pane (headers included, via {@link DeepContent.dimAll}).
 *
 * Variants:
 * - Withdrawn: the pane collapses to the single dim `⊗ withdrawn` line
 *   (mirrors the short-view options region).
 * - Moot: a `⊘ moot — {reason}` line is prepended and the whole pane
 *   renders dimmed ({@link DeepContent.dimAll}); options are still listed
 *   (audit trail, Q34=A).
 * - Choice questions: after the real option sections, the synthetic
 *   `✎ Other — write your own` section (P1.M2.T6.S1) renders at cursor
 *   index `options.length` — label shared with short-view.ts
 *   (`OTHER_AFFORDANCE`), ramification the fixed `OTHER_RAMIFICATION`
 *   (h2.29), never starred. Present even when `options` is undefined or
 *   empty (the Other row is the whole cursor domain there).
 * - Text questions: goal + description only — no option sections and no
 *   Other section (the embedded editor composes on the short form).
 */
export function buildDeepContent(input: DeepViewInput): DeepContent {
  const { question: q, goal, theme, width, maxChars } = input;
  const budget = Math.max(1, width - INSET.length);

  if (q.status === "withdrawn") {
    return {
      lines: [`${INSET}${theme.fg("dim", WITHDRAWN_LINE)}`],
      sectionHeaderLineIndex: [],
      sectionHeaders: [],
      dimAll: false,
      viewportHeight: DEEP_VIEW_HEIGHT,
    };
  }

  const dimAll = q.status === "moot";
  const lines: string[] = [];
  const sectionHeaderLineIndex: number[] = [];
  const sectionHeaders: string[] = [];

  // Moot reason line PREPENDED to the pane (mirrors short-view's reason
  // line ahead of the options list).
  if (dimAll) {
    lines.push(mootLine(q, theme, budget));
    lines.push("");
  }
  pushBlock(lines, goal, theme, budget, maxChars, true);
  lines.push("");
  if (q.description !== undefined && q.description !== "") {
    pushBlock(lines, q.description, theme, budget, maxChars, dimAll);
    lines.push("");
  }
  if (q.type === "choice") {
    const options = q.options ?? [];
    for (let i = 0; i < options.length; i++) {
      const opt = options[i]!;
      const star = opt.value === q.recommendation ? STAR : "";
      const body = `${star}${truncateVisible(opt.label, Math.max(1, budget - visibleWidth(star)))}`;
      sectionHeaders.push(body);
      sectionHeaderLineIndex.push(lines.length);
      // Placeholder header (build-time cursor prefix baked in); renderDeepWindow
      // re-renders header lines with the CURRENT cursor prefix every render.
      const prefix = i === input.cursorIndex ? CURSOR : BLANK;
      const composed = `${INSET}${prefix}${body}`;
      lines.push(dimAll ? theme.fg("dim", composed) : composed);
      if (opt.ramification !== undefined && opt.ramification !== "") {
        pushBlock(lines, opt.ramification, theme, budget, maxChars, true, RAM_INDENT);
      }
    }
    // P1.M2.T6.S1: the synthetic ✎ Other section — cursor index
    // `options.length` (WRITEIN-001 deep parity), ALWAYS the LAST
    // sectionHeaderLineIndex entry so clampScroll/renderDeepWindow work
    // unchanged. Present even with zero options (the Other row is the
    // whole domain there); never on withdrawn/text questions.
    sectionHeaders.push(OTHER_AFFORDANCE);
    sectionHeaderLineIndex.push(lines.length);
    const prefix = options.length === input.cursorIndex ? CURSOR : BLANK;
    const composed = `${INSET}${prefix}${OTHER_AFFORDANCE}`;
    lines.push(dimAll ? theme.fg("dim", composed) : composed);
    pushBlock(lines, OTHER_RAMIFICATION, theme, budget, maxChars, true, RAM_INDENT);
  }
  return { lines, sectionHeaderLineIndex, sectionHeaders, dimAll, viewportHeight: DEEP_VIEW_HEIGHT };
}

/**
 * Append one text block: char-capped ({@link capText}), word-wrapped to the
 * post-indent budget ({@link wrapText}), each line INSET-prefixed, optional
 * extra indent, and dimmed when `dim`. Pure — appends into the caller's
 * array only.
 */
function pushBlock(
  lines: string[],
  text: string,
  theme: Theme,
  budget: number,
  maxChars: number,
  dim: boolean,
  indent = "",
): void {
  const indentW = visibleWidth(indent);
  const wrapped = wrapText(capText(text, maxChars), Math.max(1, budget - indentW));
  for (const ln of wrapped) {
    const composed = `${INSET}${indent}${ln}`;
    lines.push(dim ? theme.fg("dim", composed) : composed);
  }
}

/** Moot reason line `⊘ moot — {reason}` (mirrors short-view.ts mootLine). */
function mootLine(q: Question, theme: Theme, budget: number): string {
  const reasonBudget = Math.max(1, budget - visibleWidth(MOOT_HEAD));
  const reason = truncateVisible(mootReason(q), reasonBudget);
  return `${INSET}${theme.fg("dim", `${MOOT_HEAD}${reason}`)}`;
}

// ----------------------------------------------------- scroll + render core

/**
 * [Mode A] Sticky-header scroll budget (contract 5) — the load-bearing
 * algorithm that keeps the highlighted option's header visible while its
 * ramification text scrolls (AC-5):
 *
 * The window is `[offset, offset + viewportHeight - 1]` over
 * `content.lines`. The selected section's header (line `headerIdx`) plus at
 * least its FIRST ramification line must stay inside the window:
 *
 * - header not above the window top:  offset ≤ headerIdx
 * - header + 1 line inside the bottom: offset ≥ headerIdx - viewportHeight + 2
 *
 * so `offset = clamp(scrollOffset, headerIdx - viewportHeight + 2, headerIdx)`
 * — minimal movement (a header already inside the window never shifts the
 * offset), and when the selected header would scroll ABOVE the window top
 * the upper bound PINS it there ("sticky"). The result is finally clamped
 * to the global bounds `[0, max(0, lines.length - viewportHeight)]` — the
 * offset is never negative and never past the end. When the cursor has no
 * section (text questions, out-of-range index) only the global bounds
 * apply. When the sticky range and the global bounds intersect to empty
 * (header inside the final window), the global clamp wins — the header is
 * still visible there by construction.
 */
export function clampScroll(content: DeepContent, scrollOffset: number, cursorIndex: number): number {
  const maxOffset = Math.max(0, content.lines.length - content.viewportHeight);
  const headerIdx = content.sectionHeaderLineIndex[cursorIndex];
  let offset = Math.max(0, scrollOffset);
  if (headerIdx !== undefined) {
    offset = Math.min(Math.max(offset, headerIdx - content.viewportHeight + 2), headerIdx);
  }
  return Math.max(0, Math.min(offset, maxOffset));
}

/**
 * Slice the content to the viewport window at `scrollOffset` (defensively
 * re-clamped — renderers never mutate panel state) and re-render every
 * visible section header with the CURRENT cursor prefix (`▸ ` highlighted /
 * two spaces), dimmed when {@link DeepContent.dimAll}. Always returns at
 * most `content.viewportHeight` lines, each within `width`.
 */
export function renderDeepWindow(
  content: DeepContent,
  cursorIndex: number,
  scrollOffset: number,
  theme: Theme,
  width: number,
): string[] {
  const budget = Math.max(1, width - INSET.length);
  const maxOffset = Math.max(0, content.lines.length - content.viewportHeight);
  const offset = Math.max(0, Math.min(scrollOffset, maxOffset));
  const end = Math.min(content.lines.length, offset + content.viewportHeight);
  const window: string[] = [];
  for (let i = offset; i < end; i++) window.push(content.lines[i]!);
  for (let s = 0; s < content.sectionHeaderLineIndex.length; s++) {
    const lineIdx = content.sectionHeaderLineIndex[s]!;
    if (lineIdx < offset || lineIdx >= end) continue;
    const prefix = s === cursorIndex ? CURSOR : BLANK;
    const body = truncateVisible(content.sectionHeaders[s]!, Math.max(1, budget - visibleWidth(prefix)));
    const composed = `${INSET}${prefix}${body}`;
    window[lineIdx - offset] = content.dimAll ? theme.fg("dim", composed) : composed;
  }
  return window;
}

// ------------------------------------------------------------ panel actions

/**
 * Panel render context for the deep actions: the focused question plus the
 * last render width (scroll offsets index CONTENT LINES, which depend on
 * width — clamping against the width the pane was last rendered at keeps
 * the offset valid until the next render re-clamps defensively).
 */
function deepInput(panel: InterrogationPanel): { q: Question | undefined; input: DeepViewInput } {
  const q =
    panel.currentId !== undefined ? panel.state.getQuestion(panel.currentId) : undefined;
  const width = panel.lastWidth > 0 ? panel.lastWidth : FALLBACK_WIDTH;
  return {
    q,
    input: {
      question: q as Question,
      goal: panel.state.goal,
      cursorIndex: panel.cursorIndex,
      scrollOffset: panel.scrollOffset,
      theme: panel.theme,
      width,
      maxChars: panel.config.caps.ramification,
    },
  };
}

/** Move the deep selection up one option (clamped at 0, no wrap). */
export function deepSelectionUp(panel: InterrogationPanel): boolean {
  return stepDeepSelection(panel, -1);
}

/** Move the deep selection down one section (clamped at the Other section). */
export function deepSelectionDown(panel: InterrogationPanel): boolean {
  return stepDeepSelection(panel, 1);
}

/**
 * Shared deep-selection step: mutate `panel.cursorIndex` within
 * `[0, options.length]` — index `options.length` IS the synthetic
 * `✎ Other` section (P1.M2.T6.S1; same domain convention as actions.ts's
 * cursorDomainSize) — recompute `panel.scrollOffset` via
 * {@link clampScroll}, and invalidate. NEVER touches `panel.currentId`
 * (h2.29: ↑/↓ in deep view do not navigate questions). Consumed no-op for
 * text/moot/withdrawn (nothing to select) and at the domain boundaries
 * (zero-option choice questions own the single Other index, so moves are
 * no-ops there); false only when no question context exists.
 */
function stepDeepSelection(panel: InterrogationPanel, delta: number): boolean {
  const { q } = deepInput(panel);
  if (q === undefined) return false;
  if (q.type !== "choice") return true;
  const count = q.options?.length ?? 0;
  const next = Math.min(count, Math.max(0, panel.cursorIndex + delta));
  if (next !== panel.cursorIndex) {
    panel.cursorIndex = next;
    const { input } = deepInput(panel);
    input.cursorIndex = next;
    panel.scrollOffset = clampScroll(buildDeepContent(input), panel.scrollOffset, next);
    panel.invalidate();
  }
  return true;
}

/**
 * `enter` in deep view (Q14/Q19-Q20): accept the highlighted option with
 * the EXACT short-view commit semantics ({@link acceptOptionIndex} —
 * ripple-confirm seam on answered/submitted edits, applyAnswer, advance to
 * the next unanswered question), then return to the short view and reset
 * the scroll offset. On the synthetic `✎ Other` section (index
 * `options.length`, P1.M2.T6.S1) NOTHING is answered: the panel returns to
 * the short form with the editor focused in write-in duty (h2.32) — the
 * commit happens at writeInEnter when the user presses enter in the
 * editor. `deepSticky` is untouched — the toggle stays sticky
 * for the panel session.
 *
 * No-op paths (all consumed, `true`):
 * - no question context;
 * - text questions (the text affordance belongs to the short form);
 * - moot/withdrawn (R1: navigable, not editable);
 * - ripple VETO: `acceptOptionIndex` commits nothing — the user stays in
 *   deep view to re-decide (dropping to short would hide the pane they are
 *   reading); the view only changes on a real commit.
 */
export function acceptFromDeep(panel: InterrogationPanel): boolean {
  const { q } = deepInput(panel);
  if (q === undefined) return true;
  if (q.type !== "choice") return true;
  if (q.status === "moot" || q.status === "withdrawn") return true;
  const count = q.options?.length ?? 0;
  const index = Math.min(Math.max(0, panel.cursorIndex), count);
  if (index === count) {
    // ✎ Other section (WRITEIN-001 deep parity, P1.M2.T6.S1): enter only
    // OPENS the write-in duty — short form + editor focused, seeded from
    // the freshest draft by focusTextField; writeInEnter owns the commit
    // (h2.32). Branch order mirrors actions.ts accept()'s Other row.
    panel.textDuty = "writein";
    panel.setView("short");
    panel.scrollOffset = 0;
    panel.focusTextField();
    return true;
  }
  const before = q.answer;
  const accepted = acceptOptionIndex(panel, q, index);
  // Veto detection without re-invoking the seam: applyAnswer always assigns
  // a FRESH answer object; a vetoed edit leaves the old one in place. On a
  // veto the user stays in deep view to re-decide (dropping to short would
  // hide the pane they are reading).
  if (q.answer === before) return true;
  panel.setView("short");
  panel.scrollOffset = 0;
  return accepted;
}

/**
 * Seed the deep selection for a question — the ★ recommendation preselect
 * (R2, via {@link initialCursorIndex}) clamped into the deep cursor domain
 * `[0, options.length]` (P1.M2.T6.S1: the synthetic Other index is legal —
 * the clamp bound is `count`, not `count - 1`, so a cursor parked on the
 * Other section is tolerated rather than snapped below it). Zero-option
 * choice questions seed onto the Other row itself (index 0 === count).
 * Used by panel.setView when ENTERING deep view; `currentId`'s own setter
 * already re-seeds on question changes.
 */
export function deepSeedCursorIndex(q: Question | undefined): number {
  if (q === undefined || q.type !== "choice") return 0;
  const count = q.options?.length ?? 0;
  return Math.min(initialCursorIndex(q), count);
}

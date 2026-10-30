/**
 * src/panel/terminal-budget.ts — adaptive terminal fallbacks (h2.30,
 * P1.M7.T5.S1).
 *
 * MODE A — TERMINAL FALLBACK THRESHOLD TABLE (contract 5, read before
 * touching any panel renderer that consumes a budget):
 *
 * | Condition  | Fallback                                                  |
 * |------------|-----------------------------------------------------------|
 * | rows < 24  | short-view hint line suppressed (deep view unaffected —   |
 * |            | full replacement, always available)                       |
 * | rows < 12  | overview list viewport paginates 5 content rows           |
 * | cols < 60  | option labels truncate with …; ramifications wrap; footer |
 * |            | shows max 2 keys: submit, deep                            |
 *
 * Height source: `tui.terminal.rows` is read PER RENDER (resolution of
 * pi-api-validation.md §Unknown 2) — no resize event plumbing; the TUI
 * repaints on resize and the next render re-derives the budget from the
 * live dimensions. `rows` undefined / ≤ 0 / non-finite ⇒ height unknown ⇒
 * NO height fallbacks (suppressHint false, overviewViewportHeight Infinity
 * so callers keep the default window); the width rule still applies.
 *
 * Purity: (width, rows) → flags. No I/O, no TUI reference, no state — the
 * panel computes one budget per buildLines pass and threads it to the
 * renderers (layout.ts renderFooter narrow flag, overview.ts viewport
 * override, panel.ts hint suppression). P1.M7.T6.S1's scripted ACs assert
 * against these exports, so the table and the function stay deterministic.
 */

/** Height below which the short-view hint line is suppressed (rows < 24). */
export const HINT_SUPPRESS_ROWS = 24;

/**
 * Chrome reserve for the GROW-side budget (DEEP-FULLSCREEN-001, 2026-10-24
 * owner ruling): panel header (1) + breathing blank (1) + transient notice
 * line (0–1) + footer (1) + the TUI status bar (1). The deep pane's
 * content budget is `rows - DEEP_CHROME_ROWS` — the panel may occupy the
 * FULL remaining terminal; the transcript above shrinks to whatever is
 * left (possibly nothing — reading a question needs no chat context: `c
 * chat` renders the transcript INSIDE the panel, and `esc` descends to the
 * docked short view instantly).
 */
export const DEEP_CHROME_ROWS = 5;

/**
 * DEEP-FULLSCREEN-001 growth formula: the deep pane's content-line budget
 * from live rows — `max(20, rows - DEEP_CHROME_ROWS)`. The historical 20-
 * line cap (deep-view.ts DEEP_VIEW_HEIGHT) is now the FLOOR: a 24-row
 * terminal is byte-identical to before; every row above belongs to the
 * pane. `undefined` rows (test mocks / non-TTY) ⇒ `undefined` ⇒ the
 * renderer keeps its DEEP_VIEW_HEIGHT default — the old behavior exactly.
 */
export function deepViewportBudget(rows: number | undefined): number | undefined {
  if (typeof rows !== "number" || !Number.isFinite(rows) || rows <= 0) return undefined;
  return Math.max(20, rows - DEEP_CHROME_ROWS);
}

/** Height below which the overview list paginates (rows < 12). */
export const OVERVIEW_PAGINATE_ROWS = 12;

/** Overview content-window height while paginating (rows < 12). */
export const OVERVIEW_PAGE_SIZE = 5;

/** Width below which the narrow fallbacks apply (cols < 60). */
export const NARROW_COLS = 60;

/** Adaptive fallback flags for one render pass (see the threshold table). */
export interface TerminalBudget {
  /** rows < 24 — suppress the short-view hint line (deep view unaffected). */
  suppressHint: boolean;
  /**
   * DEEP-FULLSCREEN-001 — the deep pane's content-line budget from live
   * rows ({@link deepViewportBudget}); `undefined` when rows are unknown,
   * leaving deep-view.ts's DEEP_VIEW_HEIGHT (20) as the default. This is
   * the GROW side of the h2.30 table — the shrink side below is unchanged.
   */
  deepViewportHeight: number | undefined;
  /**
   * rows < 12 — overview content window height ({@link OVERVIEW_PAGE_SIZE});
   * Infinity when the default window applies (rows unknown / ≥ 12). Callers
   * pass the value through only when finite, so overview.ts keeps owning
   * the OVERVIEW_HEIGHT default.
   */
  overviewViewportHeight: number;
  /** cols < 60 — narrow footer (submit + deep only) and harder truncation. */
  narrow: boolean;
}

/**
 * Compute the h2.30 fallback flags for one render pass. Safe for ANY input:
 * rows undefined / ≤ 0 / non-finite disable the height rules (never crash,
 * never paginate, never suppress — the deep view remains reachable and the
 * overview keeps its default window); the width rule derives from `width`
 * alone, so degenerate widths (0, negative) count as narrow and the
 * renderers' existing truncation keeps every line inside the terminal.
 */
export function terminalBudget(width: number, rows: number | undefined): TerminalBudget {
  const knownRows =
    typeof rows === "number" && Number.isFinite(rows) && rows > 0 ? rows : undefined;
  return {
    suppressHint: knownRows !== undefined && knownRows < HINT_SUPPRESS_ROWS,
    deepViewportHeight: deepViewportBudget(knownRows),
    overviewViewportHeight:
      knownRows !== undefined && knownRows < OVERVIEW_PAGINATE_ROWS
        ? OVERVIEW_PAGE_SIZE
        : Infinity,
    narrow: width < NARROW_COLS,
  };
}

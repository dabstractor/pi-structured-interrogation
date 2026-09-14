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
    overviewViewportHeight:
      knownRows !== undefined && knownRows < OVERVIEW_PAGINATE_ROWS
        ? OVERVIEW_PAGE_SIZE
        : Infinity,
    narrow: width < NARROW_COLS,
  };
}

/**
 * src/panel/terminal-budget.test.ts — h2.30 threshold boundary tests
 * (P1.M7.T5.S1).
 *
 * Pure-function suite: every threshold boundary from the [Mode A] table in
 * terminal-budget.ts (24/23 hint suppression, 12/11 overview pagination,
 * 60/59 narrow) plus the degenerate inputs (undefined / 0 / negative / NaN
 * rows, width 0) that must yield safe defaults without crashing.
 */
import { describe, expect, test } from "vitest";
import {
  HINT_SUPPRESS_ROWS,
  NARROW_COLS,
  OVERVIEW_PAGE_SIZE,
  OVERVIEW_PAGINATE_ROWS,
  terminalBudget,
} from "./terminal-budget.js";

describe("terminalBudget — hint suppression (rows < 24)", () => {
  test("24 rows keeps the hint line", () => {
    expect(terminalBudget(80, HINT_SUPPRESS_ROWS).suppressHint).toBe(false);
  });

  test("23 rows suppresses the hint line", () => {
    expect(terminalBudget(80, HINT_SUPPRESS_ROWS - 1).suppressHint).toBe(true);
  });
});

describe("terminalBudget — overview pagination (rows < 12)", () => {
  test("12 rows keeps the default window (Infinity = no override)", () => {
    expect(terminalBudget(80, OVERVIEW_PAGINATE_ROWS).overviewViewportHeight).toBe(Infinity);
  });

  test("11 rows paginates to a 5-line window", () => {
    expect(terminalBudget(80, OVERVIEW_PAGINATE_ROWS - 1).overviewViewportHeight).toBe(
      OVERVIEW_PAGE_SIZE,
    );
  });
});

describe("terminalBudget — narrow (cols < 60)", () => {
  test("59 cols is narrow", () => {
    expect(terminalBudget(NARROW_COLS - 1, 40).narrow).toBe(true);
  });

  test("60 cols is not narrow", () => {
    expect(terminalBudget(NARROW_COLS, 40).narrow).toBe(false);
  });
});

describe("terminalBudget — degenerate inputs are safe", () => {
  test("undefined rows disables height fallbacks; width rule still applies", () => {
    const b = terminalBudget(59, undefined);
    expect(b.suppressHint).toBe(false);
    expect(b.overviewViewportHeight).toBe(Infinity);
    expect(b.narrow).toBe(true);
  });

  test("0 rows / 0 cols never crash — narrow derives from width", () => {
    const b = terminalBudget(0, 0);
    expect(b.suppressHint).toBe(false);
    expect(b.overviewViewportHeight).toBe(Infinity);
    expect(b.narrow).toBe(true); // width 0 < 60
  });

  test("negative and non-finite rows disable height fallbacks", () => {
    expect(terminalBudget(80, -3).suppressHint).toBe(false);
    expect(terminalBudget(80, NaN).overviewViewportHeight).toBe(Infinity);
  });

  test("low height + narrow width applies all three fallbacks together", () => {
    const b = terminalBudget(59, 10);
    expect(b.suppressHint).toBe(true);
    expect(b.overviewViewportHeight).toBe(OVERVIEW_PAGE_SIZE);
    expect(b.narrow).toBe(true);
  });
});

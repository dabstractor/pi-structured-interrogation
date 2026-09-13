/**
 * src/panel/deep-view.test.ts — deep view renderer + scroll/selection
 * model tests (P1.M5.T1.S1).
 *
 * Conventions follow short-view.test.ts (pure renderer tests: identity
 * theme for content assertions, hand-built plain fixtures) and
 * panel.test.ts (real InterrogationStates seeded through the raw
 * primitives; InterrogationPanel constructed directly with a fake composed
 * editor). AUTOMATION-POLICY: all behavior asserted in vitest, no live pi
 * session.
 *
 * Coverage: wrapText (short/long/unbounded-word/unicode width bounds),
 * buildDeepContent (full goal, description, ★ header, capped text
 * ellipsized, moot/withdrawn/text variants, options never filtered),
 * clampScroll (global bounds, sticky pin above/below, minimal scroll),
 * renderDeepWindow (window ≤ DEEP_VIEW_HEIGHT, highlighted header prefix,
 * column alignment), deepSelectionUp/Down (domain clamp, currentId never
 * touched, offset recompute), acceptFromDeep (apply + setView("short") +
 * advance, ripple veto stays in deep, text/moot no-ops, deepSticky
 * preserved), deepSeedCursorIndex.
 */
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, test, vi } from "vitest";
import { DEFAULT_CONFIG } from "../config.js";
import type { InterrogationState } from "../state.js";
import { createInterrogationState, type Question } from "../state.js";
import {
  acceptFromDeep,
  buildDeepContent,
  clampScroll,
  deepSeedCursorIndex,
  deepSelectionDown,
  deepSelectionUp,
  DEEP_VIEW_HEIGHT,
  renderDeepWindow,
  wrapText,
  type DeepContent,
} from "./deep-view.js";
import { InterrogationPanel, type InterrogationPanelArgs } from "./panel.js";

// ------------------------------------------------------------------ fixtures

/** Identity theme for content assertions (stub per tool.test.ts). */
const theme = {
  fg: (_name: string, s: string) => s,
  bold: (s: string) => s,
} as unknown as Theme;

const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

/** Dim-aware theme: `fg("dim", s)` wraps in real ANSI dim codes. */
const dimTheme = {
  fg: (name: string, s: string) => (name === "dim" ? DIM + s + RESET : s),
  bold: (s: string) => s,
} as unknown as Theme;

const RAM_A = "Tool result details; branch-correct";
const RAM_B = "Custom entries; simpler";

function choiceQ(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    prompt: "Which database?",
    type: "choice",
    rev: 1,
    status: "open",
    options: [
      { value: "sqlite", label: "sqlite", ramification: RAM_A },
      { value: "postgres", label: "postgres", ramification: RAM_B },
    ],
    recommendation: "sqlite",
    ...overrides,
  };
}

function textQ(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    prompt: "Project name?",
    type: "text",
    rev: 1,
    status: "open",
    ...overrides,
  };
}

function deepInputFor(q: Question, over: Partial<Parameters<typeof buildDeepContent>[0]> = {}) {
  return {
    question: q,
    goal: "Ship the thing",
    cursorIndex: 0,
    scrollOffset: 0,
    theme,
    width: 80,
    maxChars: 600,
    ...over,
  };
}

function fakePanelEditor(): {
  handleInput: unknown;
  setText: (t: string) => void;
} & Record<string, unknown> {
  let text = "";
  return {
    getText: vi.fn(() => text),
    setText: vi.fn((t: string) => {
      text = t;
    }),
    handleInput: vi.fn(),
    render: vi.fn(() => ["e1", "e2", "e3"]),
    focused: false,
  } as unknown as ReturnType<typeof fakePanelEditor>;
}

function panelArgsFor(
  state: InterrogationState,
  extra: Partial<InterrogationPanelArgs> = {},
): InterrogationPanelArgs {
  return {
    tui: { requestRender: vi.fn() } as never,
    theme,
    done: () => {},
    state,
    config: DEFAULT_CONFIG,
    editorFactory: fakePanelEditor as never,
    ...extra,
  } as InterrogationPanelArgs;
}

// ------------------------------------------------------------------- wrapText

describe("wrapText", () => {
  test("test_wrap_short_text_single_line", () => {
    expect(wrapText("hello", 40)).toEqual(["hello"]);
  });

  test("test_wrap_long_text_breaks_on_spaces_within_budget", () => {
    const lines = wrapText("hello world foo", 10);
    expect(lines).toEqual(["hello", "world foo"]);
    for (const ln of lines) expect(visibleWidth(ln)).toBeLessThanOrEqual(10);
  });

  test("test_wrap_unbounded_word_hard_truncates_with_ellipsis", () => {
    const lines = wrapText("abcdefghijklmnop", 10);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/\u2026$/); // …
    expect(visibleWidth(lines[0]!)).toBeLessThanOrEqual(10);
  });

  test("test_wrap_unbounded_word_flushes_pending_line_first", () => {
    const lines = wrapText("hi abcdefghijklmnop", 10);
    expect(lines[0]).toBe("hi");
    expect(lines[1]).toMatch(/\u2026$/);
  });

  test("test_wrap_unicode_widths_stay_within_budget", () => {
    const lines = wrapText("日本語 テスト 東京", 8);
    for (const ln of lines) expect(visibleWidth(ln)).toBeLessThanOrEqual(8);
    expect(lines.length).toBeGreaterThan(1);
  });

  test("test_wrap_empty_text_yields_single_empty_line", () => {
    expect(wrapText("", 10)).toEqual([""]);
  });
});

// ----------------------------------------------------------- buildDeepContent

describe("buildDeepContent", () => {
  test("test_build_full_goal_and_description_wrapped", () => {
    const goal = "Ship ".repeat(20).trim(); // 100 chars → wraps at width 80
    const q = choiceQ("db", { description: "Long description ".repeat(6).trim() });
    const content = buildDeepContent(deepInputFor(q, { goal }));
    // Wrapped lines carry the 2-col INSET — normalize to reconstruct blocks.
    const flat = content.lines.map((l) => l.replace(/^\s\s/, "")).join(" ").trim();
    // FR-30: the FULL goal text is present (no header-style truncation).
    expect(flat).toContain(goal);
    expect(flat).toContain("Long description");
    for (const ln of content.lines) expect(visibleWidth(ln)).toBeLessThanOrEqual(80);
    // Blank separators between the goal and description blocks.
    expect(content.lines[0]).not.toBe("");
    expect(content.lines).toContain("");
  });

  test("test_build_goal_dimmed", () => {
    const content = buildDeepContent(deepInputFor(choiceQ("db"), { theme: dimTheme }));
    expect(content.lines[0]).toContain(DIM);
  });

  test("test_build_star_header_marks_recommendation", () => {
    const content = buildDeepContent(deepInputFor(choiceQ("db")));
    expect(content.sectionHeaders[0]).toBe("★ sqlite");
    expect(content.sectionHeaders[1]).toBe("postgres");
    // Header line indexes point at actual header lines in `lines`.
    expect(content.lines[content.sectionHeaderLineIndex[0]!]).toContain("sqlite");
  });

  test("test_build_ramification_indented_and_all_options_present", () => {
    const content = buildDeepContent(deepInputFor(choiceQ("db")));
    const flat = content.lines.join("\n");
    expect(flat).toContain(RAM_A);
    expect(flat).toContain(RAM_B);
    // R1: options are never filtered — both sections exist.
    expect(content.sectionHeaders).toHaveLength(2);
    // Ramification lines are indented 4 columns (aligns under labels).
    const ramLine = content.lines[content.sectionHeaderLineIndex[0]! + 1]!;
    expect(ramLine.startsWith("      ")).toBe(true); // INSET(2) + RAM_INDENT(4)
  });

  test("test_cap_verbose_text_ellipsized_bounded_lines", () => {
    const ram = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
    const q = choiceQ("db", { options: [{ value: "a", label: "a", ramification: ram }] });
    const content = buildDeepContent(deepInputFor(q, { maxChars: 600 }));
    const ramText = content.lines
      .slice(content.sectionHeaderLineIndex[0]! + 1)
      .map((l) => l.replace(/^\s+/, ""))
      .join(" ");
    // 600-char cap + single `…` ellipsis, wrapped — bounded total.
    expect(ramText.startsWith("word0")).toBe(true);
    expect(ramText.endsWith("\u2026")).toBe(true);
    expect(ramText.replace(/\u2026/g, "").length).toBeLessThanOrEqual(600);
    // Pane is bounded by the viewport at render time (600-char cap + wrap).
    const window = renderDeepWindow(content, 0, 0, theme, 80);
    expect(window.length).toBeLessThanOrEqual(DEEP_VIEW_HEIGHT);
  });

  test("test_moot_prepends_reason_and_dims_whole_pane", () => {
    const q = choiceQ("db", { status: "moot", answer: { value: "sqlite", at: "t" } });
    const content = buildDeepContent(deepInputFor(q, { theme: dimTheme }));
    expect(content.dimAll).toBe(true);
    expect(content.lines[0]).toContain("⊘ moot — sqlite");
    // Every non-blank line dimmed, options still listed (audit trail, Q34=A).
    for (const ln of content.lines) if (ln !== "") expect(ln).toContain(DIM);
    expect(content.sectionHeaders).toHaveLength(2);
  });

  test("test_moot_reason_falls_back_to_generic", () => {
    const q = choiceQ("db", { status: "moot", answer: { value: "", at: "t" } });
    const content = buildDeepContent(deepInputFor(q));
    expect(content.lines.join("\n")).toContain("⊘ moot — dependency changed");
  });

  test("test_withdrawn_collapses_to_single_dim_line", () => {
    const content = buildDeepContent(
      deepInputFor(choiceQ("db", { status: "withdrawn" }), { theme: dimTheme }),
    );
    expect(content.lines).toEqual([`${"  "}${DIM}⊗ withdrawn${RESET}`]);
    expect(content.sectionHeaders).toHaveLength(0);
  });

  test("test_text_question_has_no_option_sections", () => {
    const content = buildDeepContent(deepInputFor(textQ("name")));
    expect(content.sectionHeaders).toHaveLength(0);
    expect(content.lines.join("\n")).toContain("Ship the thing");
    expect(content.lines.join("\n")).not.toContain("▸");
  });
});

// ---------------------------------------------------------------- clampScroll

/** Hand-built content: 30 lines, headers at 5 / 12 / 20, viewport 10. */
function fixedContent(): DeepContent {
  return {
    lines: Array.from({ length: 30 }, (_, i) => `L${i}`),
    sectionHeaderLineIndex: [5, 12, 20],
    sectionHeaders: ["★ a", "b", "c"],
    dimAll: false,
    viewportHeight: 10,
  };
}

describe("clampScroll", () => {
  test("test_scroll_bounded_below_zero", () => {
    expect(clampScroll(fixedContent(), -5, 0)).toBe(0);
  });

  test("test_scroll_bounded_past_end", () => {
    // maxOffset = 30 - 10 = 20; no-section cursor → plain global clamp.
    expect(clampScroll(fixedContent(), 100, 99)).toBe(20);
  });

  test("test_sticky_minimal_no_scroll_when_header_visible", () => {
    // Header 5 inside window [0, 9] → offset unchanged.
    expect(clampScroll(fixedContent(), 0, 0)).toBe(0);
  });

  test("test_sticky_scrolls_minimally_when_header_below_window", () => {
    // Header 20 below window [0,9] → offset rises to 20 - 10 + 2 = 12 so the
    // header lands second-to-last with its first ramification line last.
    expect(clampScroll(fixedContent(), 0, 2)).toBe(12);
  });

  test("test_sticky_pins_header_at_window_top_when_scrolled_above", () => {
    // Header 5 above window top (offset 15) → offset clamps to 5 (pinned).
    expect(clampScroll(fixedContent(), 15, 0)).toBe(5);
  });

  test("test_sticky_clamp_intersects_global_bounds", () => {
    // Header 20 wants offset ≥ 12; global maxOffset 20 admits it.
    expect(clampScroll(fixedContent(), 0, 2)).toBeLessThanOrEqual(20);
  });

  test("test_no_section_cursor_uses_global_bounds_only", () => {
    expect(clampScroll(fixedContent(), 7, 99)).toBe(7);
  });
});

// ----------------------------------------------------------- renderDeepWindow

describe("renderDeepWindow", () => {
  test("test_window_bounded_by_viewport_height", () => {
    const content = buildDeepContent(deepInputFor(choiceQ("db")));
    const window = renderDeepWindow(content, 0, 0, theme, 80);
    expect(window.length).toBeLessThanOrEqual(DEEP_VIEW_HEIGHT);
    expect(window.length).toBeGreaterThan(0);
  });

  test("test_window_slice_respects_offset_and_end", () => {
    const content = fixedContent();
    const window = renderDeepWindow(content, 0, 12, theme, 80);
    // Header lines (index 12 "b", 20 "c") re-render with the cursor prefix.
    expect(window).toEqual([
      "    b", "L13", "L14", "L15", "L16", "L17", "L18", "L19", "    c", "L21",
    ]);
  });

  test("test_window_highlights_cursor_header_with_triangle_prefix", () => {
    const content = buildDeepContent(deepInputFor(choiceQ("db"), { cursorIndex: 1 }));
    const window = renderDeepWindow(content, 1, 0, theme, 80);
    const h0 = window[content.sectionHeaderLineIndex[0]!];
    const h1 = window[content.sectionHeaderLineIndex[1]!];
    expect(h0).toBe("    ★ sqlite"); // INSET + BLANK prefix — no cursor
    expect(h1).toBe("  ▸ postgres"); // INSET + cursor prefix
  });

  test("test_header_labels_stay_column_aligned_across_cursor_moves", () => {
    const content = buildDeepContent(deepInputFor(choiceQ("db"), { cursorIndex: 0 }));
    const withCursor0 = renderDeepWindow(content, 0, 0, theme, 80);
    const withCursor1 = renderDeepWindow(content, 1, 0, theme, 80);
    const h0Cursor = withCursor0[content.sectionHeaderLineIndex[0]!];
    const h0Blank = withCursor1[content.sectionHeaderLineIndex[0]!];
    // "▸ " and "  " are both 2 visible cols → the SAME option's label stays
    // at the same column when the cursor moves on/off it.
    expect(visibleWidth("▸ ")).toBe(2);
    expect(h0Cursor!.indexOf("sqlite")).toBe(h0Blank!.indexOf("sqlite"));
  });

  test("test_window_defensive_clamp_on_stale_offset", () => {
    const content = fixedContent();
    // Offset 100 (stale after a width change) re-clamps to maxOffset 20.
    const window = renderDeepWindow(content, 0, 100, theme, 80);
    expect(window).toHaveLength(10);
    expect(window[0]).toBe("    c"); // line 20 is option 2's header
  });

  test("test_moot_window_dims_headers", () => {
    const q = choiceQ("db", { status: "moot", answer: { value: "sqlite", at: "t" } });
    const content = buildDeepContent(deepInputFor(q, { theme }));
    const window = renderDeepWindow(content, 0, 0, dimTheme, 80);
    const h0 = window[content.sectionHeaderLineIndex[0]!];
    expect(h0).toContain(DIM);
  });
});

// ------------------------------------------------------- deep selection model

describe("deep selection (deepSelectionUp/Down)", () => {
  function setup(questions: Question[]): InterrogationPanel {
    const state = createInterrogationState("goal");
    for (const q of questions) state.upsertQuestion(q);
    return new InterrogationPanel(panelArgsFor(state));
  }

  test("test_down_moves_selection_and_recomputes_offset", () => {
    const panel = setup([choiceQ("db")]);
    panel.setView("deep");
    expect(panel.cursorIndex).toBe(0); // ★ preselect
    expect(deepSelectionDown(panel)).toBe(true);
    expect(panel.cursorIndex).toBe(1);
    expect(panel.scrollOffset).toBe(0); // header still visible — no scroll
  });

  test("test_selection_clamped_within_option_domain_no_pen_mark", () => {
    const panel = setup([choiceQ("db")]);
    panel.setView("deep");
    deepSelectionDown(panel);
    expect(deepSelectionDown(panel)).toBe(true); // consumed no-op at the end
    expect(panel.cursorIndex).toBe(1); // NOT the short view's ✎ index (2)
    expect(deepSelectionUp(panel)).toBe(true);
    expect(panel.cursorIndex).toBe(0);
    expect(deepSelectionUp(panel)).toBe(true); // consumed no-op at the top
    expect(panel.cursorIndex).toBe(0);
  });

  test("test_updown_never_change_current_id", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    state.upsertQuestion(choiceQ("q2"));
    const panel = new InterrogationPanel(panelArgsFor(state));
    panel.setView("deep");
    deepSelectionDown(panel);
    deepSelectionUp(panel);
    expect(panel.currentId).toBe("q1");
  });

  test("test_text_question_consumed_noop", () => {
    const panel = setup([textQ("name")]);
    panel.setView("deep");
    expect(deepSelectionDown(panel)).toBe(true);
    expect(panel.cursorIndex).toBe(0);
  });

  test("test_no_question_returns_false", () => {
    const state = createInterrogationState("goal");
    const panel = new InterrogationPanel(panelArgsFor(state));
    panel.setView("deep");
    expect(deepSelectionDown(panel)).toBe(false);
  });
});

// ------------------------------------------------------------- acceptFromDeep

describe("acceptFromDeep", () => {
  function setup(questions: Question[], statuses: Record<string, Question["status"]> = {}): InterrogationPanel {
    const state = createInterrogationState("goal");
    for (const q of questions) {
      state.upsertQuestion(q);
      // upsert normalizes status to "open" — lifecycle statuses go through
      // the raw setStatus primitive (panel.test.ts fixture discipline).
      if (statuses[q.id] !== undefined) state.setStatus(q.id, statuses[q.id]);
    }
    return new InterrogationPanel(panelArgsFor(state));
  }

  test("test_accept_applies_answer_returns_to_short_and_advances", () => {
    const panel = setup([choiceQ("q1"), choiceQ("q2")]);
    panel.handleInput("\u0004"); // ctrl+d → deep
    expect(panel.view).toBe("deep");
    deepSelectionDown(panel); // highlight "postgres"
    expect(panel.cursorIndex).toBe(1);

    expect(acceptFromDeep(panel)).toBe(true);
    expect(panel.state.getQuestion("q1")?.answer?.value).toBe("postgres");
    expect(panel.state.getQuestion("q1")?.status).toBe("answered");
    expect(panel.view).toBe("short");
    expect(panel.currentId).toBe("q2"); // advanced to next unanswered (Q14)
    expect(panel.scrollOffset).toBe(0);
    expect(panel.deepSticky).toBe(true); // sticky for the panel session
  });

  test("test_accept_uses_highlighted_option_not_stale_cursor", () => {
    const panel = setup([choiceQ("q1")]);
    panel.setView("deep");
    acceptFromDeep(panel); // ★ preselect (sqlite) accepted from deep
    expect(panel.state.getQuestion("q1")?.answer?.value).toBe("sqlite");
  });

  test("test_ripple_veto_stays_in_deep_without_committing", () => {
    const panel = setup([choiceQ("q1")]);
    panel.setView("deep");
    acceptFromDeep(panel); // first answer commits
    panel.setView("deep"); // re-enter to edit
    panel.rippleConfirm = () => false; // veto the edit
    expect(acceptFromDeep(panel)).toBe(true); // consumed…
    expect(panel.view).toBe("deep"); // …but the user stays to re-decide
    expect(panel.state.getQuestion("q1")?.answer?.value).toBe("sqlite"); // unchanged
  });

  test("test_text_question_consumed_noop", () => {
    const panel = setup([textQ("t1")]);
    panel.setView("deep");
    expect(acceptFromDeep(panel)).toBe(true);
    expect(panel.view).toBe("deep");
    expect(panel.state.getQuestion("t1")?.answer).toBeUndefined();
  });

  test("test_moot_question_consumed_noop", () => {
    const panel = setup([choiceQ("m1", { answer: { value: "x", at: "t" } })], { m1: "moot" });
    panel.setView("deep");
    expect(acceptFromDeep(panel)).toBe(true);
    expect(panel.view).toBe("deep");
  });

  test("test_withdrawn_question_consumed_noop", () => {
    const panel = setup([choiceQ("w1")], { w1: "withdrawn" });
    panel.setView("deep");
    expect(acceptFromDeep(panel)).toBe(true);
    expect(panel.view).toBe("deep");
  });
});

// -------------------------------------------------------- deepSeedCursorIndex

describe("deepSeedCursorIndex", () => {
  test("test_seeds_recommendation_clamped_into_option_domain", () => {
    expect(deepSeedCursorIndex(choiceQ("db"))).toBe(0); // ★ sqlite
    expect(deepSeedCursorIndex(choiceQ("db", { recommendation: "postgres" }))).toBe(1);
  });

  test("test_text_and_empty_domains_seed_zero", () => {
    expect(deepSeedCursorIndex(textQ("name"))).toBe(0);
    expect(deepSeedCursorIndex(choiceQ("db", { options: [] }))).toBe(0);
    expect(deepSeedCursorIndex(undefined)).toBe(0);
  });
});

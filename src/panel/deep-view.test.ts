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
 * buildDeepContent (full description, ★ header, capped text
 * ellipsized, moot/withdrawn/text variants, options never filtered, the
 * synthetic ✎ Other section — P1.M2.T6.S1),
 * clampScroll (global bounds, sticky pin above/below, minimal scroll),
 * renderDeepWindow (window ≤ DEEP_VIEW_HEIGHT, highlighted header prefix,
 * column alignment), deepSelectionUp/Down (domain clamp, currentId never
 * touched, offset recompute), acceptFromDeep (apply + sticky landing
 * (deepSticky ? deep : short — DEEP-STICKY-ADVANCE) + advance, Other →
 * write-in duty, ripple veto stays in deep, text/moot
 * no-ops, deepSticky preserved), deepSeedCursorIndex.
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
  MIN_OPTIONS_VIEWPORT,
  OTHER_RAMIFICATION,
  renderDeepWindow,
  wrapText,
  type DeepContent,
} from "./deep-view.js";
import { nextQuestion } from "./actions.js";
import { InterrogationPanel, type InterrogationPanelArgs } from "./panel.js";
import { renderShortViewOptions } from "./short-view.js";

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
    cursorIndex: 0,
    scrollOffset: 0,
    theme,
    width: 80,
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
  test("test_build_full_description_wrapped", () => {
    const q = choiceQ("db", { description: "Long description ".repeat(6).trim() });
    const content = buildDeepContent(deepInputFor(q));
    // Wrapped question lines carry the 2-col ▌-rail prefix (DEEP-PIN-002),
    // option lines the 2-col INSET — normalize both to reconstruct blocks.
    // DEEP-PIN-001: the question region is its own pinned array above the
    // scrollable options region.
    const flat = [...content.questionLines, ...content.lines]
      .map((l) => l.replace(/^(?:\s\s|▌ )/, ""))
      .join(" ")
      .trim();
    expect(flat).toContain("Long description");
    for (const ln of [...content.questionLines, ...content.lines])
      expect(visibleWidth(ln)).toBeLessThanOrEqual(80);
    // DEEP-PIN-002: the air line ABOVE the pinned block, plus the blank
    // separator below it.
    expect(content.questionLines[0]).toBe("");
    expect(content.questionLines[content.questionLines.length - 1]).toBe("");
  });

  test("test_build_description_full_intensity", () => {
    const content = buildDeepContent(
      deepInputFor(choiceQ("db", { description: "Which database should back the build?" }), {
        theme: dimTheme,
      }),
    );
    // The pinned question region carries NO dim codes for an open
    // question — the description renders full intensity (only moot dims
    // the pane; dim otherwise belongs to ramification rows).
    for (const ln of content.questionLines) expect(ln).not.toContain(DIM);
  });

  test("test_build_star_header_marks_recommendation", () => {
    const content = buildDeepContent(deepInputFor(choiceQ("db")));
    expect(content.sectionHeaders[0]).toBe("sqlite"); // label ONLY — the ★ lives in the rail now
    expect(content.sectionStarred[0]).toBe(true);
    expect(content.sectionStarred[1]).toBe(false);
    expect(content.sectionHeaders[1]).toBe("postgres");
    // Header line indexes point at actual header lines in `lines`.
    expect(content.lines[content.sectionHeaderLineIndex[0]!]).toContain("sqlite");
  });

  test("test_build_ramification_indented_and_all_options_present", () => {
    const content = buildDeepContent(deepInputFor(choiceQ("db")));
    const flat = content.lines.join("\n");
    expect(flat).toContain(RAM_A);
    expect(flat).toContain(RAM_B);
    // R1: options are never filtered — both sections exist, followed by
    // the synthetic Other section (P1.M2.T6.S1).
    expect(content.sectionHeaders).toHaveLength(3);
    expect(content.sectionHeaders[2]).toBe("✎ Other — write your own");
    // Ramification rows: 1-char explanation indent (amended 6) — bar at
    // col 3, text col 4. Amendment 9: the SELECTED section's bars (cursor 0
    // → sqlite) render heavy ┃; unselected sections keep │.
    const ramLine = content.lines[content.sectionHeaderLineIndex[0]! + 1]!;
    expect(ramLine.startsWith("   ┃")).toBe(true);
    const unselectedRam = content.lines[content.sectionHeaderLineIndex[1]! + 1]!;
    expect(unselectedRam.startsWith("   │")).toBe(true);
  });

  test("test_verbose_text_wraps_in_full_never_char_truncated", () => {
    const ram = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
    const q = choiceQ("db", { options: [{ value: "a", label: "a", ramification: ram }] });
    const content = buildDeepContent(deepInputFor(q));
    // DEEP-FULL-001: the deep view NEVER char-truncates — the whole
    // ramification wraps into `lines` (scrollable); only the WINDOW slice
    // renders, so the pane stays bounded.
    const ramText = content.lines
      .slice(content.sectionHeaderLineIndex[0]! + 1, content.sectionHeaderLineIndex[1])
      .filter((l) => l !== "") // variation B section separators are not text
      .map((l) => l.replace(/^\s*[│┃]\s?/, "")) // D-R14 pipes (│ light, ┃ heavy) + indent are not text
      .join(" ");
    expect(ramText.startsWith("word0")).toBe(true);
    expect(ramText.endsWith("word399")).toBe(true); // EVERY word present
    expect(ramText).not.toContain("\u2026"); // no ellipsis anywhere
    // The rendered window stays bounded by the viewport at render time.
    const window = renderDeepWindow(content, 0, 0, theme, 80);
    expect(window.length).toBeLessThanOrEqual(DEEP_VIEW_HEIGHT);
    // ...and scrolling reaches the tail: cursor on the LAST section (✎
    // Other, index 1) with an oversized seed offset — the sticky-header
    // clamp pins it near the bottom of the pane.
    const lastOffset = clampScroll(content, content.lines.length, 1);
    const tailWindow = renderDeepWindow(content, 1, lastOffset, theme, 80);
    expect(tailWindow.join("\n")).toContain("word399");
  });

  test("test_moot_prepends_reason_and_dims_whole_pane", () => {
    const q = choiceQ("db", { status: "moot", answer: { value: "sqlite", at: "t" } });
    const content = buildDeepContent(deepInputFor(q, { theme: dimTheme }));
    expect(content.dimAll).toBe(true);
    expect(content.questionLines[1]).toContain("⊘ moot — sqlite"); // after the air line
    // Every non-blank line dimmed, options still listed (audit trail, Q34=A).
    for (const ln of [...content.questionLines, ...content.lines])
      if (ln !== "") expect(ln).toContain(DIM);
    expect(content.sectionHeaders).toHaveLength(3); // options + Other, dimmed
  });

  test("test_moot_reason_falls_back_to_generic", () => {
    const q = choiceQ("db", { status: "moot", answer: { value: "", at: "t" } });
    const content = buildDeepContent(deepInputFor(q));
    expect(content.questionLines.join("\n")).toContain("⊘ moot — dependency changed");
  });

  test("test_withdrawn_collapses_to_single_dim_line", () => {
    const content = buildDeepContent(
      deepInputFor(choiceQ("db", { status: "withdrawn" }), { theme: dimTheme }),
    );
    expect(content.questionLines).toEqual(["", `▌ ${DIM}⊗ withdrawn${RESET}`]);
    expect(content.lines).toEqual([]);
    expect(content.sectionHeaders).toHaveLength(0);
  });

  test("test_text_question_has_no_option_sections", () => {
    const content = buildDeepContent(
      deepInputFor(textQ("name", { description: "What should we call it?" })),
    );
    expect(content.sectionHeaders).toHaveLength(0);
    expect(content.lines).toEqual([]); // the whole pane is the pinned question
    expect(content.questionLines.join("\n")).toContain("What should we call it?");
    expect(content.questionLines.join("\n")).not.toContain("▸");
  });
});

// ---------------------------------------------------------------- clampScroll

/** Hand-built content: 3 pinned question lines above a 30-line options
 *  region, headers at 5 / 12 / 20, options viewport 10. */
function fixedContent(): DeepContent {
  return {
    questionLines: ["Q0", "Q1", "Q2"],
    lines: Array.from({ length: 30 }, (_, i) => `L${i}`),
    sectionHeaderLineIndex: [5, 12, 20],
    sectionHeaders: ["a", "b", "c"],
    sectionStarred: [true, false, false],
    sectionAnswered: [false, false, false],
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
    // Cursor 1 (header 12): offset 12 is inside its sticky range [4, 12],
    // so the slice renders exactly there — mid-offset windowing intact.
    const window = renderDeepWindow(content, 1, 12, theme, 80);
    // Pinned question region rides EVERY window (DEEP-PIN-001); header
    // lines (index 12 "b", 20 "c") re-render with selection styling.
    expect(window).toEqual([
      "Q0", "Q1", "Q2",
      "▸ b", "L13", "L14", "L15", "L16", "L17", "L18", "L19", "  c", "L21",
    ]);
  });

  test("test_window_highlights_cursor_header_with_triangle_prefix", () => {
    const content = buildDeepContent(deepInputFor(choiceQ("db"), { cursorIndex: 1 }));
    const window = renderDeepWindow(content, 1, 0, theme, 80);
    const base = content.questionLines.length; // window = pinned + options
    const h0 = window[base + content.sectionHeaderLineIndex[0]!];
    const h1 = window[base + content.sectionHeaderLineIndex[1]!];
    expect(h0).toBe("  sqlite ★"); // trailing star after the title (amendment 8)
    expect(h1).toBe("▸ postgres"); // selected — ▸ prefix (amendment 9) + accent+bold
  });

  test("test_selected_section_glyph_markers_prefix_and_heavy_bars", () => {
    // D-R14 amendment 9: the highlighted section carries BOTH character
    // signals — `▸ ` header prefix (2 visible cols, labels stay aligned)
    // and heavy ┃ pipes on every ramification row — while every other
    // section (and the Other section) keeps `  ` + │. Color-independent:
    // the stub theme styles nothing, so these assertions prove the glyph
    // channel survives a color-broken TTY.
    const content = buildDeepContent(deepInputFor(choiceQ("db"), { cursorIndex: 1 }));
    const between = (from: number, to: number) =>
      content.lines.slice(from + 1, to).filter((l) => l !== "");
    const postgresRams = between(
      content.sectionHeaderLineIndex[1]!,
      content.sectionHeaderLineIndex[2]!,
    );
    expect(postgresRams.length).toBeGreaterThan(0);
    for (const ln of postgresRams) expect(ln.startsWith("   ┃")).toBe(true);
    const sqliteRams = between(
      content.sectionHeaderLineIndex[0]!,
      content.sectionHeaderLineIndex[1]!,
    );
    for (const ln of sqliteRams) expect(ln.startsWith("   │")).toBe(true);
    // Header prefixes: selected ▸, others two spaces, titles all at col 2.
    expect(content.lines[content.sectionHeaderLineIndex[1]!].startsWith("▸ postgres")).toBe(true);
    expect(content.lines[content.sectionHeaderLineIndex[0]!].startsWith("  sqlite")).toBe(true);
  });

  test("test_header_labels_stay_column_aligned_across_cursor_moves", () => {
    const content = buildDeepContent(deepInputFor(choiceQ("db"), { cursorIndex: 0 }));
    const withCursor0 = renderDeepWindow(content, 0, 0, theme, 80);
    const withCursor1 = renderDeepWindow(content, 1, 0, theme, 80);
    const base = content.questionLines.length;
    const h0Cursor = withCursor0[base + content.sectionHeaderLineIndex[0]!];
    const h0Blank = withCursor1[base + content.sectionHeaderLineIndex[0]!];
    // "▸ " and "  " are both 2 visible cols → the SAME option's label stays
    // at the same column when the cursor moves on/off it.
    expect(visibleWidth("▸ ")).toBe(2);
    expect(h0Cursor!.indexOf("sqlite")).toBe(h0Blank!.indexOf("sqlite"));
  });

  test("test_window_defensive_clamp_on_stale_offset", () => {
    const content = fixedContent();
    // DEEP-LAND-001: the render's defensive clamp is the FULL sticky
    // budget, not just the global bounds — a stale offset (e.g. after a
    // width change) renders with the CURSOR's header in the window.
    // Cursor 0 (header 5): offset 100 clamps to 5, not maxOffset 20.
    const window = renderDeepWindow(content, 0, 100, theme, 80);
    expect(window).toHaveLength(13); // 3 pinned + 10 window
    expect(window[0]).toBe("Q0"); // pinned region always leads
    expect(window[3]).toBe("▸ a ★"); // header 5 pinned at the window top
    // A cursor with NO section still gets the plain global clamp.
    expect(renderDeepWindow(content, 99, 100, theme, 80)[3]).toBe("  c"); // line 20
  });

  test("test_moot_window_dims_headers", () => {
    const q = choiceQ("db", { status: "moot", answer: { value: "sqlite", at: "t" } });
    const content = buildDeepContent(deepInputFor(q, { theme }));
    const window = renderDeepWindow(content, 0, 0, dimTheme, 80);
    const base = content.questionLines.length;
    const h0 = window[base + content.sectionHeaderLineIndex[0]!];
    expect(h0).toContain(DIM);
  });
});

// ------------------------------------------- pinned question (DEEP-PIN-001)

describe("pinned question region (DEEP-PIN-001)", () => {
  test("test_question_stays_visible_while_selection_scrolls_to_late_sections", () => {
    // Long description + two long-ramification options: pre-pin, the
    // sticky floor (`offset ≥ headerIdx - vh + 2`) stranded the question
    // above the window with no way back short of exiting deep view.
    const ram = "word ".repeat(120).trim();
    const q = choiceQ("db", {
      description: "Which database should back the build?".repeat(3),
      options: [
        { value: "a", label: "a", ramification: ram },
        { value: "b", label: "b", ramification: ram },
      ],
    });
    const content = buildDeepContent(deepInputFor(q));
    // Walk the selection down to the LAST section (✎ Other).
    const offset = clampScroll(content, 0, 2);
    expect(offset).toBeGreaterThan(0); // the options region really scrolled
    const window = renderDeepWindow(content, 2, offset, theme, 80);
    expect(window.length).toBeLessThanOrEqual(DEEP_VIEW_HEIGHT);
    const text = window.join("\n");
    expect(text).toContain("Which database should back the build?"); // description
    // …and at EVERY intermediate offset the question region leads the pane
    // (DEEP-PIN-001; DEEP-PIN-002: an air line precedes the block
    // and every question text line carries the accent ▌ rail).
    for (let o = 0; o <= offset; o++) {
      const w = renderDeepWindow(content, 1, o, theme, 80);
      expect(w[0]).toBe(""); // breathing room below the panel header
      expect(w[1].startsWith("▌ ")).toBe(true); // accent rail (stub theme: uncolored)
      expect(w[1]).toContain("Which database should back the build?");
    }
  });

  test("test_tall_question_region_truncates_bottom_first_with_marker", () => {
    // A description long enough to overflow DEEP_VIEW_HEIGHT -
    // MIN_OPTIONS_VIEWPORT on its own: the region is whole-line truncated
    // with a dimmed `…` marker (bottom-first — the tail token is cut), and
    // the options window keeps its minimum height.
    const desc = `${"dword ".repeat(200)}dend`; // ~1200 chars → ~16 wrapped lines
    const q = choiceQ("db", { description: desc });
    const content = buildDeepContent(deepInputFor(q, { theme: dimTheme }));
    expect(content.questionLines.length).toBeLessThanOrEqual(
      DEEP_VIEW_HEIGHT - MIN_OPTIONS_VIEWPORT,
    );
    const flat = content.questionLines.join(" ");
    expect(flat).not.toContain("dend"); // bottom-first: the tail was cut
    expect(content.questionLines).toContain(`▌ ${DIM}…${RESET}`); // marker (railed, DEEP-PIN-002)
    expect(content.viewportHeight).toBe(MIN_OPTIONS_VIEWPORT);
    const window = renderDeepWindow(content, 0, 0, theme, 80);
    expect(window.length).toBeLessThanOrEqual(DEEP_VIEW_HEIGHT);
    // Options still visible: the first section header renders in-window.
    expect(window.join("\n")).toContain("sqlite");
  });

  test("test_text_question_uses_whole_pane_for_the_question", () => {
    // No options region → the pinned budget is the full pane height.
    const desc = "dword ".repeat(200).trim();
    const content = buildDeepContent(deepInputFor(textQ("name", { description: desc })));
    expect(content.questionLines.length).toBeLessThanOrEqual(DEEP_VIEW_HEIGHT);
    expect(content.lines).toEqual([]);
  });
});

// ------------------------------- answered visibility (DEEP-PIN-003)

describe("answered visibility (DEEP-PIN-003)", () => {
  /** Color-tagging theme: `fg("success", s)` → `<success>s</success>`. */
  const colorTheme = {
    fg: (name: string, s: string) => `<${name}>${s}</${name}>`,
    bold: (s: string) => `<b>${s}</b>`,
  } as unknown as Theme;

  function answeredQ(overrides: Partial<Question> = {}): Question {
    return choiceQ("db", {
      status: "answered",
      answer: { value: "sqlite", at: "t" },
      ...overrides,
    });
  }

  test("test_answered_title_renders_success_no_interface_additions", () => {
    // Owner ruling (DEEP-PIN-003): ONE signal — the recorded answer's
    // TITLE renders success. No head line, no rail recolor, no ✓ glyphs:
    // the question region stays byte-identical to an unanswered question's.
    const answered = buildDeepContent(deepInputFor(answeredQ(), { theme: colorTheme }));
    const open = buildDeepContent(deepInputFor(choiceQ("db"), { theme: colorTheme }));
    expect(answered.questionLines).toEqual(open.questionLines); // no new lines
    expect(answered.questionLines.join("\n")).not.toContain("✓");
    expect(answered.questionLines.join("\n")).not.toContain("<success>"); // rail stays accent
    for (const ln of answered.questionLines) {
      if (ln !== "") expect(ln).toContain("<accent>▌");
    }
  });

  test("test_unanswered_question_no_success_anywhere", () => {
    const content = buildDeepContent(deepInputFor(choiceQ("db"), { theme: colorTheme }));
    expect(content.questionLines.join("\n")).not.toContain("<success>");
    expect(content.lines.join("\n")).not.toContain("<success>");
    expect(content.sectionAnswered).toEqual([false, false, false]);
    // The ★ preselect stays accent (selection hue), never success.
    expect(content.lines[content.sectionHeaderLineIndex[0]!]!).toContain("<accent>sqlite");
  });

  test("test_recorded_answer_title_success_selected_or_not", () => {
    // The user's exact ambiguity: unanswered preselect vs. answered top
    // choice on the same row. The TITLE COLOR breaks it — success vs.
    // accent — in the baked lines and every window re-render.
    const content = buildDeepContent(deepInputFor(answeredQ(), { theme: colorTheme }));
    expect(content.sectionAnswered).toEqual([true, false, false]);
    // cursorIndex 0 === the answer's display row (ANSWER-PIN-001 seeds the
    // caret there): selected answered row = bold + SUCCESS (not accent).
    const header = content.lines[content.sectionHeaderLineIndex[0]!]!;
    expect(header).toContain("<b><success>sqlite</success></b>");
    // Re-render with the caret moved OFF: still success, now unbolded.
    const base = content.questionLines.length;
    const reRendered = renderDeepWindow(content, 1, 0, colorTheme, 80)[
      base + content.sectionHeaderLineIndex[0]!
    ]!;
    expect(reRendered).toContain("<success>sqlite</success>");
    expect(reRendered).not.toContain("<b>");
    // The OTHER option's title stays primary; the ★ still trails (amendment 8).
    expect(content.lines[content.sectionHeaderLineIndex[1]!]!).toContain("<text>postgres</text>");
    expect(header).toContain("★");
  });

  test("test_unanswered_preselect_title_is_accent_not_success", () => {
    // The discriminating pair, side by side: same row, same caret — only
    // the hue differs (accent = "not answered yet", success = "recorded").
    const open = buildDeepContent(deepInputFor(choiceQ("db"), { theme: colorTheme }));
    const openHeader = open.lines[open.sectionHeaderLineIndex[0]!]!;
    expect(openHeader).toContain("<b><accent>sqlite</accent></b>");
    expect(openHeader).not.toContain("<success>");
  });

  test("test_write_in_answer_colors_other_section_title", () => {
    const q = answeredQ({ answer: { value: "my own thing", at: "t", custom: true } });
    const content = buildDeepContent(deepInputFor(q, { theme: colorTheme }));
    expect(content.sectionAnswered).toEqual([false, false, true]); // ✎ Other
    const header = content.lines[content.sectionHeaderLineIndex[2]!]!;
    expect(header).toContain("<success>✎ Other — write your own</success>");
    expect(header).not.toContain("✓");
  });

  test("test_coloring_keys_on_answer_presence_not_status", () => {
    // Same key as the short view's row coloring and ANSWER-PIN-001's caret
    // pinning: answer PRESENCE. Reset residue on an open question still
    // colors (the row IS the recorded value); moot dims the whole pane
    // over the coloring (dim wrapper wins, audit trail intact).
    const reset = buildDeepContent(
      deepInputFor(choiceQ("db", { answer: { value: "sqlite", at: "t" } }), {
        theme: colorTheme,
      }),
    );
    expect(reset.sectionAnswered).toEqual([true, false, false]);
    expect(reset.lines[reset.sectionHeaderLineIndex[0]!]!).toContain("<success>");
    const moot = buildDeepContent(
      deepInputFor(answeredQ({ status: "moot" }), { theme: colorTheme }),
    );
    expect(moot.sectionAnswered).toEqual([true, false, false]);
    expect(moot.lines[moot.sectionHeaderLineIndex[0]!]!).toContain("<dim>"); // dimmed over
    expect(moot.dimAll).toBe(true);
  });

  test("test_no_interface_cost_bounds_hold", () => {
    // Zero lines added: bounds identical to an unanswered question's.
    const answered = buildDeepContent(deepInputFor(answeredQ()));
    const open = buildDeepContent(deepInputFor(choiceQ("db")));
    expect(answered.questionLines).toHaveLength(open.questionLines.length);
    expect(answered.lines).toHaveLength(open.lines.length);
    const window = renderDeepWindow(answered, 0, 0, theme, 80);
    expect(window.length).toBeLessThanOrEqual(DEEP_VIEW_HEIGHT);
    expect(answered.viewportHeight).toBeGreaterThanOrEqual(MIN_OPTIONS_VIEWPORT);
  });
});

describe("answered visibility, short view (DEEP-PIN-003)", () => {
  const colorTheme = {
    fg: (name: string, s: string) => `<${name}>${s}</${name}>`,
    bold: (s: string) => `<b>${s}</b>`,
  } as unknown as Theme;

  test("test_short_view_recorded_option_label_success", () => {
    const q = choiceQ("db", {
      status: "answered",
      answer: { value: "postgres", at: "t" },
    });
    const lines = renderShortViewOptions({ question: q, cursorIndex: 0, theme: colorTheme, width: 80 });
    const postgres = lines.find((l) => l.includes("postgres"))!;
    expect(postgres).toContain("<success>postgres</success>");
    expect(postgres).not.toContain("<accent>");
    // Unanswered options render no success anywhere.
    const open = renderShortViewOptions({
      question: choiceQ("db"),
      cursorIndex: 0,
      theme: colorTheme,
      width: 80,
    });
    expect(open.join("\n")).not.toContain("<success>");
  });

  test("test_short_view_write_in_colors_other_row", () => {
    const q = choiceQ("db", {
      status: "answered",
      answer: { value: "hand-written", at: "t", custom: true },
    });
    // Caret pinned on the ✎ row (ANSWER-PIN-001): focused + success label.
    const lines = renderShortViewOptions({ question: q, cursorIndex: 2, theme: colorTheme, width: 80 });
    const other = lines.find((l) => l.includes("✎ Other"))!;
    expect(other).toContain("<success>✎ Other — write your own</success>");
    // …and dimmed (caret elsewhere) still carries the green inside the dim.
    const away = renderShortViewOptions({ question: q, cursorIndex: 0, theme: colorTheme, width: 80 });
    const otherAway = away.find((l) => l.includes("✎ Other"))!;
    expect(otherAway).toContain("<success>");
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

  test("test_selection_clamped_at_the_other_section_no_wrap", () => {
    const panel = setup([choiceQ("db")]);
    panel.setView("deep");
    deepSelectionDown(panel);
    deepSelectionDown(panel); // onto the Other section (the short view's ✎ index)
    expect(panel.cursorIndex).toBe(2);
    expect(deepSelectionDown(panel)).toBe(true); // consumed no-op past Other
    expect(panel.cursorIndex).toBe(2);
    expect(deepSelectionUp(panel)).toBe(true);
    expect(panel.cursorIndex).toBe(1);
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

describe("landing scroll (DEEP-LAND-001)", () => {
  /** 10 single-ramification options — sections run 3 lines each, so the
   * options region (~30+ lines) overflows the viewport and late sections
   * (and the ✎ Other section) sit below a top-anchored window. */
  function longChoiceQ(id: string, overrides: Partial<Question> = {}): Question {
    return choiceQ(id, {
      options: Array.from({ length: 10 }, (_, n) => ({
        value: `opt${n}`,
        label: `opt ${n}`,
        ramification: `Ram ${n}`,
      })),
      recommendation: undefined,
      ...overrides,
    });
  }

  function setup(questions: Question[], answered: string[] = []): InterrogationPanel {
    const state = createInterrogationState("goal");
    for (const q of questions) state.upsertQuestion(q);
    // upsert normalizes status to "open" — answered statuses go through
    // the raw setStatus primitive (fixture discipline, acceptFromDeep tests).
    for (const id of answered) state.setStatus(id, "answered");
    return new InterrogationPanel(panelArgsFor(state));
  }

  /** Deep-pane body lines (between header and footer) for visibility asserts. */
  function deepBody(panel: InterrogationPanel): string[] {
    return panel.render(80).slice(1, -2);
  }

  test("test_deep_entry_lands_with_write_in_other_section_visible", () => {
    // A write-in answer pins the caret to the ✎ Other section — always
    // the LAST section. Entering deep view must not land it below a
    // top-anchored window (the bare reset-to-0 bug).
    const panel = setup([
      longChoiceQ("q1", { answer: { value: "hand", at: "t", custom: true } }),
    ], ["q1"]);
    panel.currentId = "q1";
    panel.setView("deep");
    expect(panel.cursorIndex).toBe(10); // ✎ Other row (ANSWER-PIN-001)
    expect(panel.scrollOffset).toBeGreaterThan(0); // clamped up from 0 — not a bare reset
    expect(deepBody(panel).some((l) => l.includes("✎ Other"))).toBe(true); // caret's section visible
  });

  test("test_navigation_landing_replaces_stale_high_offset", () => {
    // The owner-reported first-answer case: scroll deep on q1, navigate to
    // an answered question whose caret seeds to display row 0 — the stale
    // offset must NOT carry over (it hid the first answers above the top,
    // and `up` at the boundary was a no-op — only down+up recovered).
    const panel = setup([
      longChoiceQ("q1"),
      longChoiceQ("q2", { answer: { value: "opt0", at: "t" } }),
    ], ["q2"]);
    panel.setView("deep"); // q1 (first open) — caret 0, no ★ (no recommendation)
    for (let i = 0; i < 8; i++) deepSelectionDown(panel);
    expect(panel.scrollOffset).toBeGreaterThan(0); // scrolled deep on q1
    expect(nextQuestion(panel)).toBe(true);
    expect(panel.currentId).toBe("q2");
    expect(panel.cursorIndex).toBe(0); // recorded answer owns the caret (FR-35)
    expect(panel.scrollOffset).toBe(0); // stale offset REPLACED, not carried
    expect(deepBody(panel).some((l) => l.includes("opt 0"))).toBe(true);
    // Boundary no-op (up at row 0) — consumed, and the caret's header
    // STAYS visible without the down+up jiggle.
    expect(deepSelectionUp(panel)).toBe(true);
    expect(deepBody(panel).some((l) => l.includes("opt 0"))).toBe(true);
  });

  test("test_navigation_landing_clamps_up_for_late_recorded_answer", () => {
    // The mirror case: caret seeds to a LATE display row while the offset
    // sits low (0) — the landing clamp must scroll it INTO the window
    // (the stale reset-to-0 bug hid the last answers below the bottom,
    // and `down` at the boundary was a no-op).
    const panel = setup([
      longChoiceQ("q1"),
      longChoiceQ("q2", { answer: { value: "opt9", at: "t" } }),
    ], ["q2"]);
    panel.setView("deep"); // q1 at offset 0
    expect(panel.scrollOffset).toBe(0);
    expect(nextQuestion(panel)).toBe(true);
    expect(panel.cursorIndex).toBe(9); // opt9 — the last display row
    expect(panel.scrollOffset).toBeGreaterThan(0); // clamped up from 0
    expect(deepBody(panel).some((l) => l.includes("opt 9"))).toBe(true);
  });

  test("test_accept_stay_landing_keeps_just_accepted_row_visible", () => {
    // Advance-STAY (all questions answered → currentId unchanged → the
    // setter never re-seeds): the post-accept landing clamp must keep the
    // just-accepted late row visible — a bare reset-to-0 dropped it below
    // the window.
    const panel = setup([longChoiceQ("q1")]);
    panel.handleInput("d"); // deep (bare default, BAREKEYS-001; sets deepSticky)
    for (let i = 0; i < 9; i++) deepSelectionDown(panel); // highlight opt9
    expect(acceptFromDeep(panel)).toBe(true);
    expect(panel.view).toBe("deep"); // sticky landing
    expect(panel.currentId).toBe("q1"); // no next unanswered → STAY
    expect(panel.cursorIndex).toBe(9);
    expect(panel.scrollOffset).toBeGreaterThan(0); // not a bare reset
    expect(deepBody(panel).some((l) => l.includes("opt 9"))).toBe(true);
  });
});

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

  test("test_accept_applies_answer_stays_in_deep_when_sticky_and_advances", () => {
    const panel = setup([choiceQ("q1"), choiceQ("q2")]);
    panel.handleInput("d"); // deep (bare default, BAREKEYS-001; sets deepSticky)
    expect(panel.view).toBe("deep");
    deepSelectionDown(panel); // highlight "postgres"
    expect(panel.cursorIndex).toBe(1);

    expect(acceptFromDeep(panel)).toBe(true);
    expect(panel.state.getQuestion("q1")?.answer?.value).toBe("postgres");
    expect(panel.state.getQuestion("q1")?.status).toBe("answered");
    // DEEP-STICKY-ADVANCE: sticky landing stays in the deep view on the
    // advanced-to question — answering must not yank the reader out of the
    // detailed view (owner request 2026-10-11).
    expect(panel.view).toBe("deep");
    expect(panel.currentId).toBe("q2"); // advanced to next unanswered (Q14)
    expect(panel.cursorIndex).toBe(0); // re-seeded: q2's ★ preselect (currentId setter)
    expect(panel.scrollOffset).toBe(0);
    expect(panel.deepSticky).toBe(true); // sticky for the panel session
  });

  test("test_accept_without_sticky_returns_to_short", () => {
    // Defensive seam contract: deepSticky — not view==="deep" — decides the
    // landing. Only real entry (`d`) sets it; a direct setView("deep")
    // without it drops back to short after an accept (mirrors onOverview
    // and esc-from-overview). Unreachable via the key router.
    const panel = setup([choiceQ("q1"), choiceQ("q2")]);
    panel.setView("deep"); // bypasses the router — deepSticky stays false
    expect(acceptFromDeep(panel)).toBe(true);
    expect(panel.view).toBe("short");
    expect(panel.currentId).toBe("q2");
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
    deepSelectionDown(panel); // caret OFF the recorded value (S1 pins it to sqlite) — a real EDIT
    panel.rippleConfirm = () => false; // veto the edit
    expect(acceptFromDeep(panel)).toBe(true); // consumed…
    expect(panel.view).toBe("deep"); // …but the user stays to re-decide
    expect(panel.state.getQuestion("q1")?.answer?.value).toBe("sqlite"); // unchanged
  });

  test("test_same_value_noop_stays_in_deep_when_sticky_and_advances", () => {
    const panel = setup(
      [choiceQ("q1", { answer: { value: "postgres", at: "t0" } }), choiceQ("q2")],
      { q1: "answered" },
    );
    panel.currentId = "q1"; // initial focus lands on q2 (first OPEN, FR-1 ladder); the journey navigates to the answered q1 first
    panel.handleInput("d"); // deep (bare default, BAREKEYS-001; sets deepSticky) — S1/FR-D8: caret seeds to the RECORDED answer's section
    expect(panel.cursorIndex).toBe(1); // postgres display row (row 0 = ★ sqlite, D-R13)
    const seam = vi.fn(() => true);
    panel.rippleConfirm = seam;
    expect(acceptFromDeep(panel)).toBe(true); // consumed
    expect(panel.view).toBe("deep"); // NO-OP is not a veto — sticky landing stays deep (DEEP-STICKY-ADVANCE)
    expect(panel.currentId).toBe("q2"); // Q14 advance ran inside the no-op
    expect(panel.cursorIndex).toBe(0); // re-seeded on q2's ★ preselect
    expect(panel.scrollOffset).toBe(0);
    expect(seam).toHaveBeenCalledTimes(0); // FR-D9: same-value never consults the seam
    const q1 = panel.state.getQuestion("q1");
    expect(q1?.answer?.value).toBe("postgres"); // unchanged, same object
    expect(q1?.answer?.at).toBe("t0"); // no answer.at rewrite
    expect(q1?.status).toBe("answered"); // not re-marked, not reset
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
    // D-R13: display order puts the recommendation first — seed is display 0
    expect(deepSeedCursorIndex(choiceQ("db", { recommendation: "postgres" }))).toBe(0);
  });

  test("test_text_and_empty_domains_seed_zero", () => {
    expect(deepSeedCursorIndex(textQ("name"))).toBe(0);
    expect(deepSeedCursorIndex(choiceQ("db", { options: [] }))).toBe(0);
    expect(deepSeedCursorIndex(undefined)).toBe(0);
  });

  test("test_seed_domain_tolerates_the_other_index", () => {
    // Deep domain is [0, options.length] (P1.M2.T6.S1): the clamp bound is
    // count, so a zero-option choice seeds onto the Other row itself
    // (index 0 === count) instead of snapping outside the domain.
    expect(deepSeedCursorIndex(choiceQ("db", { options: [] }))).toBe(0);
    expect(deepSeedCursorIndex(choiceQ("db"))).toBe(0); // ★ seed unchanged
    // D-R13: display order — recommendation leads, seed stays display 0
    expect(deepSeedCursorIndex(choiceQ("db", { recommendation: "postgres" }))).toBe(0);
  });
});

// --------------------------------- Other section (P1.M2.T6.S1, FR-D1/AC-5)

describe("Other section (P1.M2.T6.S1)", () => {
  function setup(questions: Question[]): InterrogationPanel {
    const state = createInterrogationState("goal");
    for (const q of questions) state.upsertQuestion(q);
    return new InterrogationPanel(panelArgsFor(state));
  }

  test("test_other_section_rendered_after_last_option_with_verbatim_ramification", () => {
    const content = buildDeepContent(deepInputFor(choiceQ("db")));
    // Synthetic section is the LAST section, at index options.length = 2.
    expect(content.sectionHeaders).toHaveLength(3);
    expect(content.sectionHeaders[2]).toBe("✎ Other — write your own");
    const headerIdx = content.sectionHeaderLineIndex[2]!;
    expect(headerIdx).toBeGreaterThan(content.sectionHeaderLineIndex[1]!);
    expect(content.lines[headerIdx]).toContain("✎ Other — write your own");
    // Never recommended — no ★ on the Other row.
    expect(content.lines[headerIdx]).not.toContain("★");
    // VERBATIM ramification (em-dash intact), wrapped + D-R14 pipe indent.
    const ramText = content.lines
      .slice(headerIdx + 1)
      .map((l) => l.replace(/^\s*│\s?/, ""))
      .join(" ");
    expect(ramText).toBe(OTHER_RAMIFICATION);
    expect(ramText).toContain("fit — write your own answer");
    for (const ln of content.lines.slice(headerIdx + 1)) {
      expect(ln.startsWith("   │")).toBe(true); // 1-char indent: bar col 3, text col 4
    }
  });

  test("test_other_ramification_flows_through_the_same_dim_pipeline", () => {
    const content = buildDeepContent(deepInputFor(choiceQ("db"), { theme: dimTheme }));
    const headerIdx = content.sectionHeaderLineIndex[2]!;
    expect(content.lines.slice(headerIdx + 1).length).toBeGreaterThan(0);
    // D-R13 inversion: ramifications render FULL intensity (not dim)
    for (const ln of content.lines.slice(headerIdx + 1)) expect(ln).not.toContain(DIM);
  });

  test("test_other_header_sticky_and_cursor_prefix_in_window", () => {
    const ram = "word ".repeat(120).trim(); // long rams → real scrolling
    const q = choiceQ("db", {
      options: [
        { value: "a", label: "a", ramification: ram },
        { value: "b", label: "b", ramification: ram },
      ],
    });
    const content = buildDeepContent(deepInputFor(q));
    const headerIdx = content.sectionHeaderLineIndex[2]!;
    // Cursor ON the Other section: sticky math keeps the header + its first
    // ramification line inside the window, and the window re-renders the
    // Other header with the `▸ ` prefix.
    const offset = clampScroll(content, 0, 2);
    const window = renderDeepWindow(content, 2, offset, theme, 80);
    const base = content.questionLines.length; // pinned region above window
    const header = window[base + headerIdx - offset];
    expect(header).toBeDefined();
    expect(header).toContain("✎ Other — write your own");
    expect(header!.startsWith("▸ ✎")).toBe(true); // selected → ▸ prefix (amendment 9)
  });

  test("test_zero_option_choice_renders_other_as_the_only_section", () => {
    const content = buildDeepContent(deepInputFor(choiceQ("db", { options: [] })));
    expect(content.sectionHeaders).toEqual(["✎ Other — write your own"]);
    expect(content.lines.join("\n")).toContain("None of the listed options fit");
  });

  test("test_no_other_section_on_text_or_withdrawn", () => {
    const text = buildDeepContent(deepInputFor(textQ("t")));
    expect([...text.questionLines, ...text.lines].join("\n")).not.toContain("✎ Other");
    const withdrawn = buildDeepContent(deepInputFor(choiceQ("w", { status: "withdrawn" })));
    expect([...withdrawn.questionLines, ...withdrawn.lines].join("\n")).not.toContain("✎ Other");
  });

  test("test_selection_reaches_and_clamps_at_the_other_section", () => {
    const panel = setup([choiceQ("db")]);
    panel.setView("deep");
    deepSelectionDown(panel);
    deepSelectionDown(panel); // onto the Other section (index options.length)
    expect(panel.cursorIndex).toBe(2);
    expect(deepSelectionDown(panel)).toBe(true); // consumed no-op — no wrap
    expect(panel.cursorIndex).toBe(2);
    expect(deepSelectionUp(panel)).toBe(true); // back onto the last option
    expect(panel.cursorIndex).toBe(1);
  });

  test("test_zero_option_choice_selection_domain_is_the_other_row", () => {
    const panel = setup([choiceQ("db", { options: [] })]);
    panel.setView("deep");
    expect(panel.cursorIndex).toBe(0); // the Other section IS the domain
    expect(deepSelectionDown(panel)).toBe(true); // consumed no-op
    expect(panel.cursorIndex).toBe(0);
  });

  test("test_accept_other_returns_to_short_in_writein_duty_editor_focused", () => {
    const panel = setup([choiceQ("q1")]);
    panel.setView("deep");
    deepSelectionDown(panel);
    deepSelectionDown(panel); // Other
    expect(acceptFromDeep(panel)).toBe(true);
    expect(panel.view).toBe("short");
    expect(panel.textDuty).toBe("writein");
    expect(panel.focus).toBe("text"); // editor focused
    expect(panel.textField.focused).toBe(true);
    expect(panel.scrollOffset).toBe(0);
    expect(panel.state.getQuestion("q1")?.answer).toBeUndefined(); // nothing answered
    expect(panel.currentId).toBe("q1"); // no advance — the duty is open
    expect(panel.cursorIndex).toBe(2); // parked on the short form's ✎ row
  });

  test("test_accept_other_on_zero_option_choice_opens_writein", () => {
    const panel = setup([choiceQ("z", { options: [] })]);
    panel.setView("deep");
    expect(acceptFromDeep(panel)).toBe(true);
    expect(panel.view).toBe("short");
    expect(panel.textDuty).toBe("writein");
    expect(panel.state.getQuestion("z")?.answer).toBeUndefined();
  });
});

// -------------------------- narrow width (h2.30 cols < 60, P1.M7.T5.S1)

describe("narrow width (h2.30 cols < 60)", () => {
  test("ramifications wrap at width 59 — no rendered line exceeds the budget", () => {
    const q = choiceQ("db", {
      options: [
        { value: "a", label: "aaa", ramification: `${RAM_A} ${RAM_B} `.repeat(6) },
        { value: "b", label: "bbb", ramification: `${RAM_B} ${RAM_A} `.repeat(6) },
      ],
    });
    const content = buildDeepContent(deepInputFor(q, { width: 59 }));
    const lines = renderDeepWindow(content, 0, 0, theme, 59);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(59);
    // Wrapped, not truncated away: every ramification word survives.
    expect(lines.join("\n")).toContain(RAM_A.split(";")[0]!.trim());
  });
});

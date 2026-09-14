/**
 * src/panel/overview.test.ts — overview list renderer + cursor/jump model
 * tests (P1.M5.T2.S1).
 *
 * Conventions follow deep-view.test.ts (pure renderer tests: identity theme
 * for content assertions, dim-aware theme for dimming assertions, hand-
 * built plain fixtures; real InterrogationStates seeded through the raw
 * primitives; InterrogationPanel constructed directly with a fake composed
 * editor). AUTOMATION-POLICY: all behavior asserted in vitest, no live pi
 * session.
 *
 * Coverage: overviewMarker (every status, ✎ composition, precedence),
 * overviewMootReason (text preferred, value fallback, generic default),
 * buildOverviewContent (group headers at boundaries, ungrouped "(none)",
 * ▲ gate-group mark, ▸ cursor alignment, moot/withdrawn dimmed + reason,
 * width truncation, never filtered, empty list), clampOverviewScroll
 * (global bounds, cursor-visibility pin, minimal movement),
 * overviewUp/Down (domain clamp, currentId/cursorIndex untouched, scroll
 * recompute, empty no-op), overviewJump (short view, currentId, R2
 * preseed, text-focus blur, empty-state flash, out-of-range false).
 */
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, test, vi } from "vitest";
import { DEFAULT_CONFIG } from "../config.js";
import type { InterrogationState, Question } from "../state.js";
import { createInterrogationState } from "../state.js";
import {
  buildOverviewContent,
  clampOverviewScroll,
  OVERVIEW_HEIGHT,
  overviewDown,
  overviewJump,
  overviewMarker,
  overviewMootReason,
  overviewUp,
  type OverviewContent,
} from "./overview.js";
import { InterrogationPanel, type InterrogationPanelArgs } from "./panel.js";
import { OVERVIEW_PAGE_SIZE } from "./terminal-budget.js";

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

function choiceQ(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    title: `Title ${id}`,
    prompt: "Which database?",
    type: "choice",
    rev: 1,
    status: "open",
    options: [
      { value: "sqlite", label: "sqlite" },
      { value: "postgres", label: "postgres" },
    ],
    recommendation: "sqlite",
    ...overrides,
  };
}

function answer(value: string, text?: string): Question["answer"] {
  return { value, ...(text !== undefined ? { text } : {}), at: "t" };
}

/** `count` questions in ONE group — lines = 1 header + count rows. */
function overviewContentFor(count: number, over: Partial<Parameters<typeof buildOverviewContent>[0]> = {}): OverviewContent {
  const ordered: Question[] = [];
  for (let i = 1; i <= count; i++) ordered.push(choiceQ(`q${i}`, { group: "g" }));
  return buildOverviewContent({
    ordered,
    cursorIndex: 0,
    theme,
    width: 80,
    ...over,
  });
}

function fakePanelEditor(): {
  getText: () => string;
  setText: (t: string) => void;
  handleInput: unknown;
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

// --------------------------------------------------------------- marker (contract 5)

describe("overviewMarker — glyph semantics + precedence", () => {
  test("test_marker_open_is_dot", () => {
    expect(overviewMarker(choiceQ("q"))).toBe("·");
  });

  test("test_marker_any_answer_carrying_status_is_star", () => {
    // answered, submitted, closed — h2.38 archived-but-answerable shows ★ too.
    expect(overviewMarker(choiceQ("q", { status: "answered", answer: answer("sqlite") }))).toBe("★");
    expect(overviewMarker(choiceQ("q", { status: "submitted", answer: answer("sqlite") }))).toBe("★");
    expect(overviewMarker(choiceQ("q", { status: "closed", answer: answer("sqlite") }))).toBe("★");
  });

  test("test_marker_reasked_overrides_star", () => {
    expect(overviewMarker(choiceQ("q", { status: "reasked", answer: answer("sqlite") }))).toBe("⟳");
  });

  test("test_marker_moot_and_withdrawn_take_highest_precedence", () => {
    expect(overviewMarker(choiceQ("q", { status: "moot", answer: answer("sqlite") }))).toBe("⊘");
    expect(overviewMarker(choiceQ("q", { status: "withdrawn", answer: answer("sqlite") }))).toBe("⊗");
  });

  test("test_marker_text_answer_appends_pencil", () => {
    expect(overviewMarker(choiceQ("q", { status: "answered", answer: answer("sqlite", "why") }))).toBe("★ ✎");
    expect(overviewMarker(choiceQ("q", { status: "reasked", answer: answer("sqlite", "why") }))).toBe("⟳ ✎");
    // Per the marker blueprint ANY answer object (even an empty value) reads
    // as answered — ★ is the base the ✎ composes onto.
    expect(overviewMarker(choiceQ("q", { answer: answer("", "why") }))).toBe("★ ✎");
  });

  test("test_marker_pencil_suppressed_on_moot_and_withdrawn", () => {
    // Their rows already carry the audit-trail text (reason / withdrawn).
    expect(overviewMarker(choiceQ("q", { status: "moot", answer: answer("v", "moot: x=y") }))).toBe("⊘");
    expect(overviewMarker(choiceQ("q", { status: "withdrawn", answer: answer("v", "why") }))).toBe("⊗");
  });
});

// ------------------------------------------------------------ moot reason

describe("overviewMootReason — depends-on reason read", () => {
  test("test_reason_prefers_answer_text_h229_format", () => {
    const q = choiceQ("q", { status: "moot", answer: answer("sqlite", "moot: storage=sqlite") });
    expect(overviewMootReason(q)).toBe("moot: storage=sqlite");
  });

  test("test_reason_falls_back_to_answer_value", () => {
    const q = choiceQ("q", { status: "moot", answer: answer("sqlite") });
    expect(overviewMootReason(q)).toBe("sqlite");
  });

  test("test_reason_generic_default_when_nothing_derivable", () => {
    expect(overviewMootReason(choiceQ("q", { status: "moot" }))).toBe("dependency changed");
    // Empty strings count as missing — "" text must not shadow a real value.
    expect(overviewMootReason(choiceQ("q", { status: "moot", answer: answer("v", "") }))).toBe("v");
    expect(overviewMootReason(choiceQ("q", { status: "moot", answer: answer("", "") }))).toBe(
      "dependency changed",
    );
  });
});

// --------------------------------------------------------- content builder

describe("buildOverviewContent — rows, headers, gate mark", () => {
  test("test_build_group_headers_at_boundaries_and_ungrouped_bucket", () => {
    const ordered = [
      choiceQ("a1", { group: "storage" }),
      choiceQ("a2", { group: "storage" }),
      choiceQ("b1", { group: "ui" }),
      choiceQ("c1"), // no group → "(none)"
    ];
    const content = buildOverviewContent({ ordered, cursorIndex: 0, theme, width: 80 });
    // Headers at EVERY boundary including the first group; question rows map
    // through questionRowLine (line 5 is the "(none)" header, row c1 at 6).
    expect(content.lines[0]).toBe("  storage");
    expect(content.lines[3]).toBe("  ui");
    expect(content.lines[5]).toBe("  (none)");
    expect(content.questionRowLine).toEqual([1, 2, 4, 6]);
    expect(content.viewportHeight).toBe(OVERVIEW_HEIGHT);
  });

  test("test_build_gate_group_header_carries_triangle_mark", () => {
    const ordered = [
      choiceQ("a1", { group: "plain" }),
      choiceQ("g1", { group: "gated", gate: true }), // ANY member marks the group
      choiceQ("g2", { group: "gated" }), // group-level attribute
    ];
    const content = buildOverviewContent({ ordered, cursorIndex: 0, theme, width: 80 });
    expect(content.lines[0]).toBe("  plain");
    expect(content.lines[2]).toBe("  gated ▲");
    // Exactly one ▲ in the whole list.
    expect(content.lines.filter((l) => l.includes("▲"))).toHaveLength(1);
  });

  test("test_build_cursor_row_prefix_alignment", () => {
    const ordered = [choiceQ("a"), choiceQ("b"), choiceQ("c")];
    const content = buildOverviewContent({ ordered, cursorIndex: 1, theme, width: 80 });
    // Every row: 2-col INSET + 2-col prefix — cursor `▸ `, others two spaces.
    expect(content.lines[1]).toBe("    · Title a"); // INSET + BLANK
    expect(content.lines[2]).toBe("  ▸ · Title b"); // INSET + CURSOR
    expect(content.lines[3]).toBe("    · Title c");
    for (const ln of content.lines) expect(visibleWidth(ln)).toBeLessThanOrEqual(80);
  });

  test("test_build_moot_row_dimmed_with_reason_not_filtered", () => {
    const ordered = [
      choiceQ("ok"),
      choiceQ("m", { status: "moot", answer: answer("sqlite", "moot: storage=sqlite") }),
    ];
    const content = buildOverviewContent({ ordered, cursorIndex: 0, theme: dimTheme, width: 80 });
    // Both rows present (R1/Q34=A — never filtered)…
    expect(content.lines).toHaveLength(3); // header + 2 rows
    const mootRow = content.lines[2]!;
    expect(mootRow).toContain("⊘");
    expect(mootRow).toContain("Title m");
    // …the moot row dimmed WHOLESALE (cursor prefix included) with the reason.
    expect(mootRow).toContain(`${DIM}  ⊘ Title m — moot: storage=sqlite${RESET}`);
    expect(visibleWidth(mootRow)).toBeLessThanOrEqual(80);
  });

  test("test_build_withdrawn_row_dimmed_present", () => {
    const ordered = [choiceQ("ok"), choiceQ("w", { status: "withdrawn", answer: answer("a", "why") })];
    const content = buildOverviewContent({ ordered, cursorIndex: 0, theme: dimTheme, width: 80 });
    expect(content.lines).toHaveLength(3); // header + 2 rows — NOT collapsed away
    // The INSET sits OUTSIDE the dim wrap; the withdrawn row is dimmed whole.
    expect(content.lines[2]).toBe(`  ${DIM}  ⊗ Title w${RESET}`);
  });

  test("test_build_truncates_to_width_budget_title_absorbs_shrink", () => {
    const long = "x".repeat(200);
    const ordered = [choiceQ("q", { title: undefined, prompt: long })];
    const content = buildOverviewContent({ ordered, cursorIndex: 0, theme, width: 40 });
    expect(content.lines).toHaveLength(2);
    const row = content.lines[1]!;
    expect(visibleWidth(row)).toBeLessThanOrEqual(40);
    expect(row.endsWith("…")).toBe(true); // title truncated with the adornment
  });

  test("test_build_moot_reason_capped_title_still_gets_room", () => {
    const reason = "moot: ".repeat(20).trim(); // 120 chars — far over the cap
    const ordered = [choiceQ("m", { status: "moot", answer: answer("v", reason) })];
    const content = buildOverviewContent({ ordered, cursorIndex: 0, theme, width: 60 });
    const row = content.lines[1]!;
    expect(visibleWidth(row)).toBeLessThanOrEqual(60);
    expect(row).toContain("Title m"); // title absorbs shrink, reason capped second
    expect(row).toContain("…"); // the reason itself was truncated
  });

  test("test_build_empty_list_yields_no_lines", () => {
    const content = buildOverviewContent({ ordered: [], cursorIndex: 0, theme, width: 80 });
    expect(content.lines).toEqual([]);
    expect(content.questionRowLine).toEqual([]);
    expect(content.viewportHeight).toBe(OVERVIEW_HEIGHT);
  });

  test("test_build_markers_render_inside_rows", () => {
    const ordered = [
      choiceQ("a", { status: "answered", answer: answer("sqlite", "why") }),
      choiceQ("b", { status: "reasked", answer: answer("sqlite") }),
    ];
    const content = buildOverviewContent({ ordered, cursorIndex: 0, theme, width: 80 });
    expect(content.lines[1]).toContain("★ ✎ Title a");
    expect(content.lines[2]).toContain("⟳ Title b");
  });
});

// ------------------------------------------------------------ scroll clamp

describe("clampOverviewScroll — window bounds + cursor visibility", () => {
  // 1 header + 30 rows = 31 lines; viewport 20 → global max offset 11.
  const content = overviewContentFor(30);

  test("test_scroll_clamps_to_global_bounds", () => {
    expect(clampOverviewScroll(content, -5, 0)).toBe(0);
    // The cursor row pins the offset from above too (offset > row would
    // scroll the row off the top) — the global max is reached from the LAST
    // cursor row, whose line 30 sits past it.
    expect(clampOverviewScroll(content, 100, 29)).toBe(11);
  });

  test("test_scroll_pins_cursor_row_visible_at_bottom", () => {
    // Cursor on the last row (line 30): any offset lands at the pin 11 —
    // window [11, 30] always contains the row.
    expect(clampOverviewScroll(content, 0, 29)).toBe(11);
    expect(clampOverviewScroll(content, 11, 29)).toBe(11);
  });

  test("test_scroll_minimal_when_cursor_already_visible", () => {
    // Rows 0..19 are visible at offset 0 — no movement for any of them.
    for (const idx of [0, 5, 10, 18]) {
      expect(clampOverviewScroll(content, 0, idx)).toBe(0);
    }
    // Cursor at line 25 needs offset ≥ 6 (window [6, 25]); 0 moves minimally.
    expect(clampOverviewScroll(content, 0, 24)).toBe(6);
    // An offset that already keeps the row visible is left alone.
    expect(clampOverviewScroll(content, 8, 24)).toBe(8);
  });

  test("test_scroll_out_of_range_cursor_falls_back_to_row_zero", () => {
    // No row → blueprint fallback row 0: the offset pins to the top (the
    // cursor row is undefined, so the conservative top-anchored window wins).
    expect(clampOverviewScroll(content, 3, 99)).toBe(0);
    expect(clampOverviewScroll(overviewContentFor(0), 3, 0)).toBe(0);
  });
});

// ----------------------------------------------------------- panel actions

describe("overviewUp/overviewDown — cursor + scroll actions", () => {
  test("test_up_down_move_cursor_and_clamp_at_domain_edges", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    state.upsertQuestion(choiceQ("q2"));
    state.upsertQuestion(choiceQ("q3"));
    const panel = new InterrogationPanel(panelArgsFor(state));
    panel.view = "overview";
    panel.overviewCursor = 1;

    expect(overviewUp(panel)).toBe(true);
    expect(panel.overviewCursor).toBe(0);
    expect(overviewUp(panel)).toBe(true);
    expect(panel.overviewCursor).toBe(0); // clamped — no wrap
    expect(overviewDown(panel)).toBe(true);
    expect(overviewDown(panel)).toBe(true);
    expect(overviewDown(panel)).toBe(true);
    expect(panel.overviewCursor).toBe(2); // clamped at the last question
    // NEVER touches the question pointer or the option cursor (h2.29).
    expect(panel.currentId).toBe("q1");
    expect(panel.cursorIndex).toBe(0); // ★ preselect of q1 (recommendation)
  });

  test("test_down_recomputes_scroll_to_keep_cursor_visible", () => {
    const state = createInterrogationState("goal");
    for (let i = 1; i <= 30; i++) state.upsertQuestion(choiceQ(`q${i}`, { group: "g" }));
    const panel = new InterrogationPanel(panelArgsFor(state));
    panel.view = "overview";
    for (let i = 0; i < 25; i++) overviewDown(panel);
    expect(panel.overviewCursor).toBe(25);
    expect(panel.overviewScroll).toBeGreaterThan(0);
    // The rendered window still shows the cursor row.
    const lines = panel.render(80);
    expect(lines.some((l) => l.includes("▸") && l.includes("Title q26"))).toBe(true);
  });

  test("test_up_down_consumed_noop_without_questions", () => {
    const state = createInterrogationState("goal");
    const panel = new InterrogationPanel(panelArgsFor(state));
    panel.view = "overview";
    expect(overviewUp(panel)).toBe(true);
    expect(overviewDown(panel)).toBe(true);
    expect(panel.overviewCursor).toBe(0);
  });
});

// ------------------------------------------------------------- overviewJump

describe("overviewJump — enter jumps to the short form", () => {
  test("test_jump_sets_short_view_current_id_and_preseeds_cursor", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    state.upsertQuestion(choiceQ("q2", { recommendation: "postgres" }));
    const panel = new InterrogationPanel(panelArgsFor(state));
    panel.view = "overview";
    panel.overviewCursor = 1;

    expect(overviewJump(panel)).toBe(true);
    expect(panel.view).toBe("short");
    expect(panel.currentId).toBe("q2");
    // R2 preselect: the currentId setter re-seeded the ★ recommendation.
    expect(panel.cursorIndex).toBe(1);
    expect(panel.overviewScroll).toBe(0);
  });

  test("test_jump_blurs_text_focus_back_to_options", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    const panel = new InterrogationPanel(panelArgsFor(state));
    panel.view = "overview";
    panel.focusTextField();
    expect(panel.focus).toBe("text");
    expect(overviewJump(panel)).toBe(true);
    expect(panel.focus).toBe("options");
    expect(panel.view).toBe("short");
  });

  test("test_jump_empty_state_flashes_consumed_noop", () => {
    const state = createInterrogationState("goal");
    const panel = new InterrogationPanel(panelArgsFor(state));
    panel.view = "overview";
    expect(overviewJump(panel)).toBe(true);
    expect(panel.view).toBe("overview"); // nothing else changed
    expect(panel.footerFlash?.text).toContain("no question");
    panel.dispose(); // clear the flash timer (h2.37 test discipline)
  });

  test("test_jump_out_of_range_cursor_returns_false", () => {
    const state = createInterrogationState("goal");
    state.upsertQuestion(choiceQ("q1"));
    const panel = new InterrogationPanel(panelArgsFor(state));
    panel.view = "overview";
    panel.overviewCursor = 99;
    expect(overviewJump(panel)).toBe(false);
    expect(panel.view).toBe("overview");
  });
});

// -------------------- viewport height override (h2.30, P1.M7.T5.S1)

describe("buildOverviewContent viewportHeight override (h2.30, P1.M7.T5.S1)", () => {
  test("defaults to OVERVIEW_HEIGHT when no override is passed", () => {
    expect(overviewContentFor(3).viewportHeight).toBe(OVERVIEW_HEIGHT);
  });

  test("viewportHeight override paginates the window (rows < 12 → 5)", () => {
    const content = overviewContentFor(30, { viewportHeight: OVERVIEW_PAGE_SIZE });
    expect(content.viewportHeight).toBe(OVERVIEW_PAGE_SIZE);
    expect(content.lines.length).toBeGreaterThan(OVERVIEW_PAGE_SIZE); // pagination matters
  });

  test("override clamps to >= 1 — a degenerate value never empties the window", () => {
    expect(overviewContentFor(3, { viewportHeight: 0 }).viewportHeight).toBe(1);
    expect(overviewContentFor(3, { viewportHeight: -7 }).viewportHeight).toBe(1);
  });

  test("cursor stays visible inside the 5-line window at low rows", () => {
    // 1 group → 1 header + 8 rows; cursor parked on the LAST question.
    const content = overviewContentFor(8, { viewportHeight: OVERVIEW_PAGE_SIZE });
    const last = 7;
    const offset = clampOverviewScroll(content, 0, last);
    const row = content.questionRowLine[last]!;
    expect(offset).toBe(row - OVERVIEW_PAGE_SIZE + 1); // window pinned just above
    expect(row).toBeGreaterThanOrEqual(offset);
    expect(row).toBeLessThan(offset + OVERVIEW_PAGE_SIZE);
  });

  test("5-line window slices to whole rows incl. the group header at the top", () => {
    // Panel-level slice math (buildLines): offset 0 + viewportHeight 5 shows
    // lines 0..4 — the group header plus the first 4 question rows.
    const content = overviewContentFor(8, { viewportHeight: OVERVIEW_PAGE_SIZE });
    const end = Math.min(content.lines.length, 0 + content.viewportHeight);
    expect(end).toBe(5);
    expect(content.lines[0]).toContain("g"); // header line rides the window
  });
});

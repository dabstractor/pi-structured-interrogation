/**
 * src/panel/layout.test.ts — layout renderer tests (P1.M3.T1.S2).
 *
 * Covers the S2 success criteria: 1-line header/footer at every tested
 * width with `…` truncation, AC-12 label reflection through
 * resolveKeyLabels, footer hint-degradation priority, per-status question
 * markers, first-sentence hint extraction, and the width-invariant sweep
 * (40/60/80/120) asserting no wrap and no ANSI breakage via visibleWidth.
 *
 * Conventions follow tool.test.ts / panel.test.ts: identity theme stub,
 * hand-built plain-JSON fixtures (no runtime).
 */
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, test } from "vitest";
import type { InterrogatorConfig } from "../config.js";
import { resolveKeyLabels } from "../config.js";
import type { Question, QuestionStatus, SerializedState } from "../state.js";
import {
  firstSentence,
  renderFooter,
  renderHeader,
  renderHintLine,
  renderQuestionLine,
  statusMarkers,
  truncateVisible,
  type ScreenKind,
} from "./layout.js";

// ------------------------------------------------------------------ fixtures

/** Identity theme for render assertions (stub per PRP / tool.test.ts). */
const stubTheme = {
  fg: (_name: string, s: string) => s,
  bold: (s: string) => s,
} as unknown as Theme;

const theme = stubTheme;

function mkQuestion(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    title: `Title ${id}`,
    prompt: `prompt:${id}`,
    type: "choice",
    rev: 1,
    status: "open",
    ...overrides,
  };
}

function mkState(overrides: Partial<SerializedState> = {}): SerializedState {
  const q1 = mkQuestion("q1");
  return {
    goal: "Ship the thing",
    epoch: 0,
    order: ["q1"],
    questions: { q1 },
    completed: false,
    ...overrides,
  };
}

/** Minimal config stand-in — resolveKeyLabels only reads config.keys. */
function mkConfig(keys: Partial<Record<string, string>> = {}): InterrogatorConfig {
  return {
    keys: {
      deep: "ctrl+d",
      overview: "ctrl+l",
      focusText: "ctrl+t",
      batchNote: "ctrl+n",
      submit: "ctrl+enter",
      breakOut: "ctrl+o",
      discuss: "ctrl+g",
      externalEditor: "ctrl+e",
      prevQuestion: "ctrl+p",
      nextQuestion: "ctrl+x",
      ...keys,
    },
  } as unknown as InterrogatorConfig;
}

const SCREENS: ScreenKind[] = ["short", "deep", "overview"];
const WIDTHS = [40, 60, 80, 120];

// ------------------------------------------------------------- truncateVisible

describe("truncateVisible", () => {
  test("returns text unchanged when it fits", () => {
    expect(truncateVisible("short", 10)).toBe("short");
    expect(truncateVisible("exact", 5)).toBe("exact");
  });

  test("appends a single … when truncating", () => {
    const out = truncateVisible("a".repeat(50), 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith("…")).toBe(true);
    expect(out.split("…")).toHaveLength(2); // exactly one ellipsis
    expect(visibleWidth(out)).toBe(10);
  });

  test("handles degenerate budgets without crashing", () => {
    expect(truncateVisible("anything", 0)).toBe("");
    expect(truncateVisible("anything", -3)).toBe("");
    expect(truncateVisible("", 5)).toBe("");
  });
});

// --------------------------------------------------------------- renderHeader

describe("renderHeader", () => {
  test("renders goal + counts inside the border at comfortable width", () => {
    const { line } = renderHeader(mkState(), theme, 80);
    expect(line).toContain("┌ interrogation · Ship the thing ── 0/1 answered · 0 re-asked ┐");
    expect(line).not.toContain("…");
    expect(line).not.toContain("\n");
    expect(visibleWidth(line)).toBeLessThanOrEqual(80);
  });

  test("long goal truncates with a single … but goalFull is preserved (FR-30)", () => {
    const goal = "G".repeat(300);
    const { line, goalFull } = renderHeader(mkState({ goal }), theme, 80);
    expect(goalFull).toBe(goal); // deep view gets the full text
    expect(line.split("…")).toHaveLength(2); // exactly one ellipsis
    expect(line).not.toContain("\n");
    expect(visibleWidth(line)).toBeLessThanOrEqual(80);
  });

  test("counts never truncate: narrow width drops them whole, keeping 1 line", () => {
    const state = mkState();
    const { line } = renderHeader(state, theme, 24); // counts can no longer fit
    expect(line).toBe("┌ interrogation ┐");
    expect(line).not.toContain("\n");
  });

  test("empty goal renders without a dangling separator", () => {
    const { line } = renderHeader(mkState({ goal: "" }), theme, 80);
    expect(line).toContain("┌ interrogation ── 0/1 answered · 0 re-asked ┐");
  });
});

// -------------------------------------------------------------- statusMarkers

describe("statusMarkers", () => {
  test("no markers for open questions", () => {
    expect(statusMarkers(mkQuestion("q1"), theme)).toBe("");
  });

  test("reasked / withdrawn markers", () => {
    expect(statusMarkers(mkQuestion("q1", { status: "reasked" }), theme)).toBe(" ⟳ re-asked");
    expect(statusMarkers(mkQuestion("q1", { status: "withdrawn" }), theme)).toBe(" ⊗ withdrawn");
  });

  test("moot marker includes the dimmed reason when present", () => {
    const q = mkQuestion("q1", {
      status: "moot",
      answer: { value: "", text: "no longer relevant", at: "2026-01-01T00:00:00Z" },
    });
    expect(statusMarkers(q, theme)).toBe(" ⊘ moot no longer relevant");
    const bare = mkQuestion("q1", { status: "moot" });
    expect(statusMarkers(bare, theme)).toBe(" ⊘ moot");
  });

  test("text-answer marker for answered text questions and elaborated choices", () => {
    const textQ = mkQuestion("q1", {
      type: "text",
      status: "answered",
      answer: { value: "some text", at: "2026-01-01T00:00:00Z" },
    });
    expect(statusMarkers(textQ, theme)).toBe(" ✎ text answer");
    const choiceWithNote = mkQuestion("q1", {
      status: "submitted",
      answer: { value: "a", text: "elaboration", at: "2026-01-01T00:00:00Z" },
    });
    expect(statusMarkers(choiceWithNote, theme)).toBe(" ✎ text answer");
  });
});

// --------------------------------------------------------- renderQuestionLine

describe("renderQuestionLine", () => {
  test("shows group label, position, id, and title", () => {
    const q = mkQuestion("q1", { group: "Storage" });
    const line = renderQuestionLine(q, 3, theme, 80);
    expect(line).toContain("Storage · Q3/q1 Title q1");
    expect(visibleWidth(line)).toBeLessThanOrEqual(80);
  });

  test("group falls back to (none) and title falls back to prompt", () => {
    const q = mkQuestion("q1", { title: undefined });
    const line = renderQuestionLine(q, 1, theme, 80);
    expect(line).toContain("(none) · Q1/q1 prompt:q1");
  });

  test("markers render per status and sit at the end of the line", () => {
    for (const status of ["reasked", "moot", "withdrawn"] as QuestionStatus[]) {
      const q = mkQuestion("q1", { status });
      const line = renderQuestionLine(q, 1, theme, 80);
      expect(line.trimEnd().endsWith(statusMarkers(q, theme).trimStart())).toBe(true);
      expect(visibleWidth(line)).toBeLessThanOrEqual(80);
    }
  });

  test("long titles truncate (never wrap to 2 lines), markers still fit", () => {
    const q = mkQuestion("q1", { title: "T".repeat(200), status: "reasked" });
    const line = renderQuestionLine(q, 1, theme, 60);
    expect(line).not.toContain("\n");
    expect(line.endsWith("⟳ re-asked")).toBe(true);
    expect(visibleWidth(line)).toBeLessThanOrEqual(60);
  });
});

// ------------------------------------------------------------ renderHintLine

describe("renderHintLine", () => {
  test("omitted entirely ([]) when no description", () => {
    expect(renderHintLine(mkQuestion("q1"), theme, 80)).toEqual([]);
    expect(renderHintLine(mkQuestion("q1", { description: "" }), theme, 80)).toEqual([]);
  });

  test("first sentence only, dimmed, within budget", () => {
    const q = mkQuestion("q1", { description: "First sentence. Second sentence. Third!" });
    const lines = renderHintLine(q, theme, 80);
    expect(lines).toHaveLength(1);
    expect(lines[0].trim()).toBe("First sentence.");
    expect(visibleWidth(lines[0])).toBeLessThanOrEqual(80);
  });

  test("no terminator keeps the whole description; long text truncates with …", () => {
    const whole = mkQuestion("q1", { description: "no terminator here" });
    expect(renderHintLine(whole, theme, 80)[0].trim()).toBe("no terminator here");

    const long = mkQuestion("q1", { description: "d".repeat(120) });
    const line = renderHintLine(long, theme, 40)[0];
    expect(line).not.toContain("\n");
    expect(visibleWidth(line)).toBeLessThanOrEqual(40);
    expect(line.trimEnd().endsWith("…")).toBe(true);
  });
});

// --------------------------------------------------------------- renderFooter

describe("renderFooter", () => {
  test("renders progress + config-driven key hints for the short screen", () => {
    const labels = resolveKeyLabels(mkConfig());
    const line = renderFooter(mkState(), "short", labels, theme, 120);
    expect(line).toContain("0/1 answered · 0 re-asked ·");
    expect(line).toContain("enter accept");
    expect(line).toContain("Ctrl+D deep");
    expect(line).toContain("Ctrl+L list");
    expect(line).toContain("Ctrl+Enter submit");
    expect(line.trimEnd().endsWith("⏎ ┘")).toBe(true);
  });

  test("deep/overview screens show their own static hints", () => {
    const labels = resolveKeyLabels(mkConfig());
    const deep = renderFooter(mkState(), "deep", labels, theme, 120);
    expect(deep).toContain("Ctrl+Enter submit");
    expect(deep).toContain("esc back");
    expect(deep).toContain("↑/↓ scroll");
    const overview = renderFooter(mkState(), "overview", labels, theme, 120);
    expect(overview).toContain("Ctrl+D deep");
    expect(overview).toContain("enter jump");
  });

  test("AC-12: labels reflect resolveKeyLabels — rebinding keys.deep changes the string", () => {
    const state = mkState();
    const defaultLabels = resolveKeyLabels(mkConfig());
    const reboundLabels = resolveKeyLabels(mkConfig({ deep: "ctrl+x", submit: "ctrl+shift+q" }));
    const before = renderFooter(state, "short", defaultLabels, theme, 120);
    const after = renderFooter(state, "short", reboundLabels, theme, 120);
    expect(before).toContain("Ctrl+D deep");
    expect(before).toContain("Ctrl+Enter submit");
    expect(after).toContain("Ctrl+X deep");
    expect(after).toContain("Ctrl+Shift+Q submit");
    expect(after).not.toContain("Ctrl+D deep");
    expect(after).not.toContain("Ctrl+Enter submit");
  });

  test("narrow widths drop key hints right-to-left before touching progress", () => {
    const labels = resolveKeyLabels(mkConfig());
    const state = mkState();

    const wide = renderFooter(state, "short", labels, theme, 60);
    expect(wide).toContain("enter accept"); // leftmost hint survives first
    expect(wide).toContain("Ctrl+D deep");
    expect(wide).not.toContain("Ctrl+L list"); // dropped right-to-left
    expect(wide).not.toContain("Ctrl+Enter submit");
    expect(visibleWidth(wide)).toBeLessThanOrEqual(60);

    const narrow = renderFooter(state, "short", labels, theme, 45);
    expect(narrow).not.toContain("accept");
    expect(narrow).toContain("0/1 answered · 0 re-asked"); // progress sacred
    expect(narrow.trimEnd().endsWith("⏎ ┘")).toBe(true);
    expect(visibleWidth(narrow)).toBeLessThanOrEqual(45);
  });

  test("empty state renders 0/0 counts", () => {
    const labels = resolveKeyLabels(mkConfig());
    const line = renderFooter(mkState({ order: [], questions: {} }), "short", labels, theme, 120);
    expect(line).toContain("0/0 answered · 0 re-asked");
  });
});

// ---------------------------------------------- width-invariant sweep (L4)

describe("width invariants (40/60/80/120)", () => {
  test("every renderer returns ≤ 1 line whose visibleWidth ≤ requested width", () => {
    const labels = resolveKeyLabels(mkConfig());
    const qOpen = mkQuestion("q1", { title: "T".repeat(90), status: "answered" });
    const qMoot = mkQuestion("q2", {
      title: "M".repeat(90),
      status: "moot",
      answer: { value: "", text: "reason ".repeat(20).trim(), at: "2026-01-01T00:00:00Z" },
    });
    const qHinted = mkQuestion("q3", {
      title: "H".repeat(90),
      description: "Sentence one. ".repeat(20),
    });
    const state = mkState({
      goal: "Goal ".repeat(80).trim(),
      order: ["q1", "q2", "q3"],
      questions: { q1: qOpen, q2: qMoot, q3: qHinted },
    });

    for (const width of WIDTHS) {
      const header = renderHeader(state, theme, width);
      expect(header.line).not.toContain("\n");
      expect(visibleWidth(header.line)).toBeLessThanOrEqual(width);
      expect(header.goalFull).toBe(state.goal);

      for (const q of [qOpen, qMoot, qHinted]) {
        const qLine = renderQuestionLine(q, 1, theme, width);
        expect(qLine).not.toContain("\n");
        expect(visibleWidth(qLine)).toBeLessThanOrEqual(width);
        for (const hint of renderHintLine(q, theme, width)) {
          expect(hint).not.toContain("\n");
          expect(visibleWidth(hint)).toBeLessThanOrEqual(width);
        }
      }

      for (const screen of SCREENS) {
        const footer = renderFooter(state, screen, labels, theme, width);
        expect(footer).not.toContain("\n");
        expect(visibleWidth(footer)).toBeLessThanOrEqual(width);
        expect(footer).toContain("1/3 answered · 0 re-asked"); // progress never dropped
      }
    }
  });

  test("count semantics skip orphaned order ids", () => {
    const state = mkState({
      order: ["q1", "ghost"],
      questions: { q1: mkQuestion("q1", { status: "answered" }) },
    });
    const { line } = renderHeader(state, theme, 120);
    expect(line).toContain("1/2 answered · 0 re-asked"); // total = order.length
  });
});

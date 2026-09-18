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
  renderConfirmFooter,
  renderFlashLine,
  renderFooter,
  renderGateWarningLine,
  renderHeader,
  renderHintLine,
  renderNoteHeader,
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

  test("editor-exit hints: enter save, esc-esc back, toggle close (ESC-002)", () => {
    const labels = resolveKeyLabels(mkConfig());
    const state = mkState();

    // Text focus (short screen): enter SAVES (not accepts), esc-esc back,
    // and the focusText toggle closes.
    const text = renderFooter(state, "short", labels, theme, 160, false, {
      mode: "text",
      escEscHint: true,
    });
    expect(text).toContain("enter save");
    expect(text).not.toContain("enter accept");
    expect(text).toContain("esc esc back");
    expect(text).toContain("Ctrl+T close");

    // Note duty: the toggle hint is the batchNote key instead.
    const note = renderFooter(state, "short", labels, theme, 160, false, {
      mode: "note",
      escEscHint: true,
    });
    expect(note).toContain("enter save");
    expect(note).toContain("Ctrl+N close"); // mkConfig rebinds batchNote

    // Window disabled (escExitWindowMs = 0): the esc-esc hint must not lie.
    const noWindow = renderFooter(state, "short", labels, theme, 160, false, {
      mode: "text",
      escEscHint: false,
    });
    expect(noWindow).not.toContain("esc esc");
    expect(noWindow).toContain("Ctrl+T close");

    // Deep-screen editor exit: the descent statics are dropped (esc belongs
    // to the editor while focused) and the editor affordances swap in.
    const deep = renderFooter(state, "deep", labels, theme, 160, false, {
      mode: "text",
      escEscHint: true,
    });
    expect(deep).toContain("enter save");
    expect(deep).toContain("esc esc back");
    expect(deep.split("esc esc back").join("")).not.toContain("esc back");
    expect(deep).not.toContain("↑/↓ scroll");
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

// ------------------------------------------------------------ renderNoteHeader

describe("renderNoteHeader", () => {
  test("exact h2.32 header string at comfortable width", () => {
    expect(renderNoteHeader(theme, 80)).toBe("┌ NOTE — ships with next submission ┐");
  });

  test("degrades WHOLE to ┌ NOTE ┐ below the full string width (never truncates)", () => {
    // Full header needs 37 columns; 36 must drop the whole title.
    expect(renderNoteHeader(theme, 36)).toBe("┌ NOTE ┐");
    expect(renderNoteHeader(theme, 30)).toBe("┌ NOTE ┐");
  });

  test("extreme narrow stays 1-line and non-crashing", () => {
    expect(renderNoteHeader(theme, 8)).toBe("┌ NOTE ┐");
    expect(renderNoteHeader(theme, 4)).toBe("┌┐");
    expect(renderNoteHeader(theme, 1)).toBe("┌");
    expect(renderNoteHeader(theme, 0)).toBe("┌");
  });

  test("1 line, never wrapping, at every tested width (width-invariant sweep)", () => {
    for (const w of [...WIDTHS, 36, 30, 9, 2]) {
      const line = renderNoteHeader(theme, w);
      expect(line).not.toContain("\n");
      expect(visibleWidth(line)).toBeLessThanOrEqual(w);
    }
  });
});

// ------------------------------------------------------- renderGateWarningLine

describe("renderGateWarningLine (P1.M5.T3.S1)", () => {
  test("mirrors renderFlashLine styling: 2-space inset, dim, exact text", () => {
    const text = "⚠ 2 foundational unanswered — later answers may shift";
    expect(renderGateWarningLine(text, theme, 120)).toBe(`  ${text}`);
    expect(renderGateWarningLine(text, theme, 120)).toBe(
      renderFlashLine(text, theme, 120),
    );
  });

  test("truncates to width - 2 with a single ellipsis, never wrapping", () => {
    const long = `⚠ ${"x".repeat(200)} foundational`;
    const line = renderGateWarningLine(long, theme, 40);
    expect(line).not.toContain("\n");
    expect(visibleWidth(line)).toBeLessThanOrEqual(40);
    expect(line.endsWith("…")).toBe(true);
  });

  test("handles degenerate widths without crashing (exact renderFlashLine mirror)", () => {
    for (const w of [40, 4, 3, 2, 1, 0]) {
      const text = "⚠ 1 foundational";
      // The PRP contract is "mirror renderFlashLine exactly" — assert the
      // mirror itself so the two degrade identically at pathological widths.
      expect(renderGateWarningLine(text, theme, w)).toBe(renderFlashLine(text, theme, w));
      expect(renderGateWarningLine(text, theme, w)).not.toContain("\n");
    }
  });
});

// -------------------------------------------- dim variants (P1.M5.T3.S1)

/** Real-ANSI dim theme: `fg("dim", s)` wraps in ANSI dim codes (width-invisible). */
const ansiDimTheme = {
  fg: (name: string, s: string) => (name === "dim" ? `\u001b[2m${s}\u001b[0m` : s),
  bold: (s: string) => s,
} as unknown as Theme;

const DIM_START = "\u001b[2m";
const DIM_END = "\u001b[0m";

describe("renderQuestionLine dim param", () => {
  test("dim=false output is byte-identical to the pre-gate renderer", () => {
    const question = mkQuestion("q1", { group: "storage" });
    expect(renderQuestionLine(question, 1, theme, 80, false)).toBe(
      renderQuestionLine(question, 1, theme, 80),
    );
  });

  test("dim=true wraps the FINISHED line in the dim class (content identical)", () => {
    const question = mkQuestion("q1", { group: "storage" });
    // Invariant: with the SAME theme, dim=true is exactly the undimmed
    // finished line wrapped once — no content, truncation, or inner-styling
    // difference (inner dim/bold wraps compose unchanged inside the outer).
    const undimmed = renderQuestionLine(question, 1, ansiDimTheme, 80, false);
    const dimmed = renderQuestionLine(question, 1, ansiDimTheme, 80, true);
    expect(dimmed).toBe(`${DIM_START}${undimmed}${DIM_END}`);
    // Status markers survive inside the wrap.
    const marked = mkQuestion("q1", { status: "reasked" });
    expect(renderQuestionLine(marked, 1, ansiDimTheme, 80, true)).toBe(
      `${DIM_START}${renderQuestionLine(marked, 1, ansiDimTheme, 80, false)}${DIM_END}`,
    );
    // With the identity theme the wrap is transparent: dim=true output is
    // byte-identical to dim=false (and to the pre-gate 4-arg call).
    expect(renderQuestionLine(question, 1, theme, 80, true)).toBe(
      renderQuestionLine(question, 1, theme, 80, false),
    );
  });

  test("dim=true never breaks width accounting (ANSI-transparent wrap)", () => {
    const question = mkQuestion("q1", { group: "g" });
    for (const w of WIDTHS) {
      const line = renderQuestionLine(question, 1, ansiDimTheme, w, true);
      expect(visibleWidth(line)).toBeLessThanOrEqual(w);
    }
  });
});

describe("renderHintLine dim param", () => {
  test("dim=false output unchanged; no-description still omits the line", () => {
    const question = mkQuestion("q1", { description: "First sentence. More detail." });
    expect(renderHintLine(question, theme, 80, false)).toEqual(
      renderHintLine(question, theme, 80),
    );
    expect(renderHintLine(mkQuestion("q1"), theme, 80, true)).toEqual([]);
  });

  test("dim=true wraps the finished line in the dim class", () => {
    const question = mkQuestion("q1", { description: "First sentence. More detail." });
    const [undimmed] = renderHintLine(question, ansiDimTheme, 80, false);
    const [dimmed] = renderHintLine(question, ansiDimTheme, 80, true);
    expect(dimmed).toBe(`${DIM_START}${undimmed}${DIM_END}`);
  });
});

describe("renderConfirmFooter", () => {
  test("test_confirm_footer_exact_copy", () => {
    expect(renderConfirmFooter(["q2", "q3"], theme, 80)).toBe(
      "  ⚠ Invalidates 2 answered questions (q2, q3) — enter=keep, esc=cancel",
    );
  });

  test("test_confirm_footer_single_victim_lists_one_id", () => {
    const line = renderConfirmFooter(["q9"], theme, 80);
    expect(line).toBe("  ⚠ Invalidates 1 answered questions (q9) — enter=keep, esc=cancel");
  });

  test("test_confirm_footer_truncates_and_stays_exactly_one_line", () => {
    const victims = ["q2", "q3", "q4", "q5", "q6-with-a-very-long-id-suffix"];
    for (const width of [40, 60, 80, 120]) {
      const line = renderConfirmFooter(victims, theme, width);
      expect(line.includes("\n")).toBe(false); // never wraps
      expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
    expect(renderConfirmFooter(["q2", "q3"], theme, 40)).toContain("…");
  });
});

// ------------------------------ renderFooter narrow mode (h2.30, P1.M7.T5.S1)

describe("renderFooter narrow mode (h2.30, P1.M7.T5.S1)", () => {
  const labels = resolveKeyLabels(mkConfig());
  /** Short rebound labels so BOTH narrow key hints fit inside 59 cols. */
  const shortLabels = resolveKeyLabels(mkConfig({ submit: "s", deep: "d" }));

  test("narrow defaults to false — 5-arg calls are byte-identical to pre-task output", () => {
    for (const screen of SCREENS) {
      expect(renderFooter(mkState(), screen, labels, theme, 80)).toBe(
        renderFooter(mkState(), screen, labels, theme, 80, false),
      );
    }
  });

  test("key hints collapse to submit + deep on every screen (list hint excluded)", () => {
    // Roomy width: the narrow FILTER (not the fit loop) must do the work.
    const short = renderFooter(mkState(), "short", labels, theme, 120, true);
    expect(short).toContain("enter accept"); // static hint stays
    expect(short).toContain("Ctrl+Enter submit");
    expect(short).toContain("Ctrl+D deep");
    expect(short).not.toContain("Ctrl+L list"); // excluded by the 2-key cap

    const deep = renderFooter(mkState(), "deep", labels, theme, 120, true);
    expect(deep).toContain("Ctrl+Enter submit");
    expect(deep).toContain("Ctrl+D deep"); // replaces deep's own list hint
    expect(deep).not.toContain("Ctrl+L list");
  });

  test("width 59 keeps exactly the submit + deep key hints — statics drop first", () => {
    // Overview narrow: appended statics (enter jump / esc back) are the
    // rightmost hints, so the fit loop sheds them before the two key hints.
    const line = renderFooter(mkState(), "overview", shortLabels, theme, 59, true);
    expect(line).toContain("S submit");
    expect(line).toContain("D deep");
    expect(line).not.toContain("enter jump");
    expect(line).not.toContain("esc back");
    expect(visibleWidth(line)).toBeLessThanOrEqual(59);
  });

  test("narrow degrades right-to-left into the ordinary fit loop", () => {
    // Far below 59 every hint yields; the progress-only footer is still
    // exactly 1 line (progress + ⏎ never drop — module contract).
    const line = renderFooter(mkState(), "overview", shortLabels, theme, 31, true);
    expect(line).toBe("└ 0/1 answered · 0 re-asked ⏎ ┘");
    expect(line.includes("\n")).toBe(false);
  });
});

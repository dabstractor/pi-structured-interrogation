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
      // BAREKEYS-001 defaults (P1.M1.T2.S1 flip, mirrors config.ts):
      // d/o/t/m/e are bare keys; submit keeps its chord, externalEditor
      // keeps ctrl+g, prev/next keep tab/shift+tab.
      deep: "d",
      overview: "i",
      elaborate: "e",
      batchNote: "n",
      submit: "ctrl+s",
      chat: "c",
      externalEditor: "ctrl+g",
      prevQuestion: "tab",
      nextQuestion: "shift+tab",
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
    expect(line).toContain("┌ interrogation · Ship the thing ┐"); // counts moved to the footer (2026-09-30)
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

  test("below the goal-fit threshold the header degrades to the bare title", () => {
    const state = mkState();
    const { line } = renderHeader(state, theme, 19); // goal prefix can no longer fit
    expect(line).toBe("┌ interrogation ┐");
    expect(line).not.toContain("\n");
  });

  test("empty goal renders without a dangling separator", () => {
    const { line } = renderHeader(mkState({ goal: "" }), theme, 80);
    expect(line).toContain("┌ interrogation ┐");
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
    // BUG-004: the reason comes from the persisted mootReason field — NOT
    // the answer text (an elaboration is not a moot cause).
    const q = mkQuestion("q1", { status: "moot", mootReason: "no longer relevant" });
    expect(statusMarkers(q, theme)).toBe(" ⊘ moot no longer relevant");
    const bare = mkQuestion("q1", { status: "moot" });
    expect(statusMarkers(bare, theme)).toBe(" ⊘ moot");
  });

  test("moot marker reason truncates to MARKER_REASON_CAP (24 cols)", () => {
    const q = mkQuestion("q1", {
      status: "moot",
      mootReason: "moot: aVeryLongDependencyIdentifierThatExceedsTheCap=withValue",
    });
    const line = statusMarkers(q, theme);
    expect(line).toContain("⊘ moot ");
    expect(line).not.toContain("ExceedsTheCap"); // truncated, never wrapped
    const bare = mkQuestion("q1", { status: "moot", answer: { value: "v", text: "elaboration", at: "t" } });
    expect(statusMarkers(bare, theme)).toBe(" ⊘ moot"); // elaboration is NOT a reason
  });

  test("text-answer marker for answered text questions and elaborated choices", () => {
    const textQ = mkQuestion("q1", {
      type: "text",
      status: "answered",
      answer: { value: "some text", at: "2026-01-01T00:00:00Z" },
    });
    expect(statusMarkers(textQ, theme)).toBe(" ★ answered · ✎ text answer");
    const choiceWithNote = mkQuestion("q1", {
      status: "submitted",
      answer: { value: "a", text: "elaboration", at: "2026-01-01T00:00:00Z" },
    });
    expect(statusMarkers(choiceWithNote, theme)).toBe(" ★ answered · ✎ text answer");
  });

  test("writein_choice_answer_shows_text_answer_marker", () => {
    const q = mkQuestion("q1", {
      status: "answered",
      answer: { value: "my write-in", custom: true, at: "2026-01-01T00:00:00Z" },
    });
    expect(statusMarkers(q, theme)).toBe(" ★ answered · ✎ text answer");
  });

  test("writein_submitted_status_also_marks", () => {
    const q = mkQuestion("q1", {
      status: "submitted",
      answer: { value: "my write-in", custom: true, at: "2026-01-01T00:00:00Z" },
    });
    expect(statusMarkers(q, theme)).toBe(" ★ answered · ✎ text answer");
  });

  test("custom_strict_true_only_corrupt_truthy_rejected", () => {
    const q = mkQuestion("q1", {
      status: "answered",
      answer: { value: "x", custom: "yes" as unknown as boolean, at: "2026-01-01T00:00:00Z" },
    });
    expect(statusMarkers(q, theme)).toBe(" ★ answered"); // ★ yes — record-derived; ✎ no — strict === true (not a write-in)
  });

  test("plain_option_answer_shows_star_answered_marker", () => {
    const q = mkQuestion("q1", {
      status: "answered",
      answer: { value: "a", at: "2026-01-01T00:00:00Z" },
    });
    expect(statusMarkers(q, theme)).toBe(" ★ answered");
  });

  test("star_answered_marker_per_status_answered_submitted_closed", () => {
    for (const status of ["answered", "submitted", "closed"] as QuestionStatus[]) {
      const q = mkQuestion("q1", {
        status,
        answer: { value: "a", at: "2026-01-01T00:00:00Z" },
      });
      expect(statusMarkers(q, theme)).toBe(" ★ answered");
    }
  });

  test("star_answered_excludes_reasked_moot_withdrawn_even_with_residual_answer", () => {
    const at = "2026-01-01T00:00:00Z";
    expect(
      statusMarkers(mkQuestion("q1", { status: "reasked", answer: { value: "a", at } }), theme),
    ).toBe(" ⟳ re-asked"); // ⟳ overrides ★ (status enum — they never co-occur)
    expect(
      // BUG-004: the moot reason rides the persisted mootReason field.
      statusMarkers(mkQuestion("q1", { status: "moot", mootReason: "reason" }), theme),
    ).toBe(" ⊘ moot reason");
    expect(
      statusMarkers(mkQuestion("q1", { status: "withdrawn", answer: { value: "a", at } }), theme),
    ).toBe(" ⊗ withdrawn");
  });
});

// --------------------------------------------------------- renderQuestionLine

describe("renderQuestionLine", () => {
  test("shows group label, position, id, and title", () => {
    const q = mkQuestion("q1", { group: "Storage" });
    const line = renderQuestionLine(q, 3, 7, theme, 80);
    expect(line).toContain("Storage · 3/7 Title q1");
    expect(visibleWidth(line)).toBeLessThanOrEqual(80);
  });

  test("group falls back to (none) and title falls back to prompt", () => {
    const q = mkQuestion("q1", { title: undefined });
    const line = renderQuestionLine(q, 1, 1, theme, 80);
    expect(line).toContain("(none) · 1/1 prompt:q1");
  });

  test("writein answer renders the ✎ marker on the composed question line (BUG-005)", () => {
    const q = mkQuestion("q1", {
      status: "answered",
      answer: { value: "my write-in", custom: true, at: "2026-01-01T00:00:00Z" },
    });
    const line = renderQuestionLine(q, 1, 2, theme, 100);
    expect(line).toContain("✎ text answer");
    expect(line).toContain("★ answered"); // ★ composes with ✎ on the rendered line (FR-D10)
    expect(visibleWidth(line)).toBeLessThanOrEqual(100);
  });

  test("markers render per status and sit at the end of the line", () => {
    for (const status of ["reasked", "moot", "withdrawn"] as QuestionStatus[]) {
      const q = mkQuestion("q1", { status });
      const line = renderQuestionLine(q, 1, 2, theme, 80);
      expect(line.trimEnd().endsWith(statusMarkers(q, theme).trimStart())).toBe(true);
      expect(visibleWidth(line)).toBeLessThanOrEqual(80);
    }
  });

  test("long titles truncate (never wrap to 2 lines), markers still fit", () => {
    const q = mkQuestion("q1", { title: "T".repeat(200), status: "reasked" });
    const line = renderQuestionLine(q, 1, 2, theme, 60);
    expect(line).not.toContain("\n");
    expect(line.endsWith("⟳ re-asked")).toBe(true);
    expect(visibleWidth(line)).toBeLessThanOrEqual(60);
  });

  test("combined ★/✎ markers never overflow at narrow widths (VAL-001)", () => {
    // Committed write-in = the exact `★ answered · ✎ text answer` state
    // BUG-001 replay restores. When the marker string alone fills the
    // budget, the markers truncate to budget − 1 so
    // `2 + leftFloor(1) + markers` stays inside `width` (was width + 1,
    // e.g. 21 cols at width 20 — VAL-001).
    const q = mkQuestion("q1", {
      status: "answered",
      answer: { value: "my write-in", custom: true, at: "2026-01-01T00:00:00Z" },
    });
    expect(visibleWidth(statusMarkers(q, theme))).toBeGreaterThanOrEqual(25); // combined markers fill sub-31 budgets
    for (let width = 18; width <= 30; width++) {
      const line = renderQuestionLine(q, 1, 2, theme, width);
      expect(line, `width ${width}: no wrap`).not.toContain("\n");
      expect(visibleWidth(line), `width ${width}: fits`).toBeLessThanOrEqual(width);
    }
    // Degenerate widths (budget ≤ 1): must not crash, never wrap.
    for (const width of [3, 2, 1, 0]) {
      const line = renderQuestionLine(q, 1, 2, theme, width);
      expect(line, `width ${width}: no wrap`).not.toContain("\n");
    }
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
  test("renders progress + config-driven feature hints for the short screen", () => {
    const labels = resolveKeyLabels(mkConfig());
    const line = renderFooter(mkState(), "short", labels, theme, 120);
    expect(line).toContain("0/1 answered ·"); // re-asked segment omitted at zero (2026-09-30)
    expect(line).toContain("d deep");
    expect(line).toContain("i list");
    expect(line).toContain("c chat");
    expect(line).toContain("e explain");
    expect(line).toContain("n note");
    expect(line).toContain("Ctrl+S submit");
    expect(line).not.toContain("enter"); // FOOTER-001: ubiquitous keys never hinted
    expect(line).not.toContain("esc");
    expect(line.trimEnd().endsWith("⏎ ┘")).toBe(true);
  });

  test("deep/overview screens advertise their features — no enter/esc statics", () => {
    const labels = resolveKeyLabels(mkConfig());
    const deep = renderFooter(mkState(), "deep", labels, theme, 120);
    expect(deep).toContain("Ctrl+S submit");
    expect(deep).toContain("i list");
    expect(deep).toContain("c chat");
    expect(deep).toContain("e explain");
    expect(deep).not.toContain("esc back");
    expect(deep).not.toContain("↑/↓ scroll");
    const overview = renderFooter(mkState(), "overview", labels, theme, 120);
    expect(overview).toContain("d deep");
    expect(overview).toContain("c chat");
    expect(overview).not.toContain("enter jump");
    expect(overview).not.toContain("esc back");
  });

  test("AC-12: labels reflect resolveKeyLabels — rebinding keys.deep changes the string", () => {
    const state = mkState();
    const defaultLabels = resolveKeyLabels(mkConfig());
    const reboundLabels = resolveKeyLabels(mkConfig({ deep: "ctrl+x", submit: "f9" }));
    const before = renderFooter(state, "short", defaultLabels, theme, 120);
    const after = renderFooter(state, "short", reboundLabels, theme, 120);
    expect(before).toContain("d deep");
    expect(before).toContain("Ctrl+S submit");
    expect(after).toContain("Ctrl+X deep");
    expect(after).toContain("F9 submit");
    expect(after).not.toContain("d deep");
    expect(after).not.toContain("Ctrl+S submit");
  });

  test("narrow widths drop feature hints right-to-left before touching progress", () => {
    const labels = resolveKeyLabels(mkConfig());
    const state = mkState();

    const wide = renderFooter(state, "short", labels, theme, 60);
    expect(wide).toContain("d deep"); // leftmost feature hint survives first
    expect(wide).toContain("i list");
    expect(wide).toContain("c chat");
    expect(wide).toContain("e explain");
    expect(wide).not.toContain("n note"); // rightmost features yield first
    expect(wide).not.toContain("Ctrl+S submit");
    expect(wide).not.toContain("enter");
    expect(visibleWidth(wide)).toBeLessThanOrEqual(60);

    const narrow = renderFooter(state, "short", labels, theme, 45);
    // Key hints still yield first (progress sacred).
    expect(narrow).toContain("0/1 answered");
    expect(narrow).not.toContain("Ctrl+S submit");
    expect(narrow).not.toContain("enter");
    expect(narrow.trimEnd().endsWith("⏎ ┘")).toBe(true);
    expect(visibleWidth(narrow)).toBeLessThanOrEqual(45);
  });

  test("empty state renders 0/0 counts", () => {
    const labels = resolveKeyLabels(mkConfig());
    const line = renderFooter(mkState({ order: [], questions: {} }), "short", labels, theme, 120);
    expect(line).toContain("0/0 answered");
  });

  test("editor-exit hints: chords only — bare-key features and enter/esc never labeled (FOOTER-001)", () => {
    const labels = resolveKeyLabels(mkConfig());
    const state = mkState();

    // Text focus (short screen): only the modifier-bearing actions stay
    // true — submit fires from every focus state, externalEditor's ONLY
    // valid context is editor focus. Bare-key feature hints would lie
    // (they type while the editor holds focus, BAREKEYS-001).
    const text = renderFooter(state, "short", labels, theme, 160, false, {
      mode: "text",
      escEscHint: true,
    });
    expect(text).toContain("Ctrl+S submit");
    expect(text).toContain("Ctrl+G editor");
    expect(text).not.toContain("d deep");
    expect(text).not.toContain("c chat");
    expect(text).not.toContain("e explain");
    expect(text).not.toContain("enter save"); // ubiquitous keys never labeled
    expect(text).not.toContain("esc esc");

    // Note duty and the disabled double-esc window: identical footer —
    // the window no longer changes the line.
    const note = renderFooter(state, "short", labels, theme, 160, false, {
      mode: "note",
      escEscHint: false,
    });
    expect(note).toBe(text);

    // Deep-screen editor exit: same chord collapse, no descent statics.
    const deep = renderFooter(state, "deep", labels, theme, 160, false, {
      mode: "text",
      escEscHint: true,
    });
    expect(deep).toContain("Ctrl+G editor");
    expect(deep).not.toContain("esc back");
    expect(deep).not.toContain("↑/↓ scroll");
  });

  test("editor-focus footer collapses to chords on every screen and mode (FOOTER-001)", () => {
    const labels = resolveKeyLabels(mkConfig());
    const state = mkState();
    for (const screen of SCREENS) {
      for (const mode of ["text", "note"] as const) {
        const line = renderFooter(state, screen, labels, theme, 160, false, {
          mode,
          escEscHint: true,
        });
        expect(line, `${screen}/${mode}: submit present`).toContain("Ctrl+S submit");
        expect(line, `${screen}/${mode}: editor present`).toContain("Ctrl+G editor");
        expect(line, `${screen}/${mode}: no bare-key features`).not.toContain("deep");
        expect(line, `${screen}/${mode}: no enter`).not.toContain("enter");
        expect(line, `${screen}/${mode}: no esc`).not.toContain("esc");
      }
    }
  });

  test("options-focus short footer still names the elaborate key (regression)", () => {
    // D-R11's permanent half is untouched: with the editor NOT focused the
    // short footer carries `{elaborate} explain` — asserted via the resolved
    // label (never a hardcoded "T"), per the h2.52 config-labels rule.
    const labels = resolveKeyLabels(mkConfig());
    const line = renderFooter(mkState(), "short", labels, theme, 160);
    expect(line).toContain(`${labels.elaborate} explain`);
  });

  test("narrow editor-focus footer keeps the chords, drops nothing true", () => {
    // Narrow + editorExit must simply not crash and keep only the chord
    // hints (both are short labels; the fit loop is the width net).
    const labels = resolveKeyLabels(mkConfig());
    const state = mkState();
    for (const mode of ["text", "note"] as const) {
      const line = renderFooter(state, "short", labels, theme, 40, true, {
        mode,
        escEscHint: true,
      });
      expect(line).toContain("answered"); // progress never dropped
      expect(line).toContain("Ctrl+S submit"); // both chords are short but
      // only the first fits at 40 cols — the fit loop is the width net
      expect(line).not.toContain("enter");
    }
  });
});

// ---------------------------------------------- width-invariant sweep (L4)

describe("width invariants (40/60/80/120)", () => {
  test("every renderer returns ≤ 1 line whose visibleWidth ≤ requested width", () => {
    const labels = resolveKeyLabels(mkConfig());
    const qOpen = mkQuestion("q1", {
      title: "T".repeat(90),
      status: "answered",
      answer: { value: "a", at: "t" },
    });
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
        const qLine = renderQuestionLine(q, 1, 2, theme, width);
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
        expect(footer).toContain("1/3 answered"); // progress never dropped (re-asked omitted at zero)
      }
    }
  });

  test("count semantics skip orphaned order ids", () => {
    const state = mkState({
      order: ["q1", "ghost"],
      questions: { q1: mkQuestion("q1", { status: "answered", answer: { value: "a", at: "t" } }) },
    });
    const { line } = renderHeader(state, theme, 120);
    expect(line).not.toContain("answered"); // counts live in the footer now; header never shows them
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
    expect(renderQuestionLine(question, 1, 2, theme, 80, false)).toBe(
      renderQuestionLine(question, 1, 2, theme, 80),
    );
  });

  test("dim=true wraps the FINISHED line in the dim class (content identical)", () => {
    const question = mkQuestion("q1", { group: "storage" });
    // Invariant: with the SAME theme, dim=true is exactly the undimmed
    // finished line wrapped once — no content, truncation, or inner-styling
    // difference (inner dim/bold wraps compose unchanged inside the outer).
    const undimmed = renderQuestionLine(question, 1, 2, ansiDimTheme, 80, false);
    const dimmed = renderQuestionLine(question, 1, 2, ansiDimTheme, 80, true);
    expect(dimmed).toBe(`${DIM_START}${undimmed}${DIM_END}`);
    // Status markers survive inside the wrap.
    const marked = mkQuestion("q1", { status: "reasked" });
    expect(renderQuestionLine(marked, 1, 2, ansiDimTheme, 80, true)).toBe(
      `${DIM_START}${renderQuestionLine(marked, 1, 2, ansiDimTheme, 80, false)}${DIM_END}`,
    );
    // With the identity theme the wrap is transparent: dim=true output is
    // byte-identical to dim=false (and to the pre-gate 4-arg call).
    expect(renderQuestionLine(question, 1, 2, theme, 80, true)).toBe(
      renderQuestionLine(question, 1, 2, theme, 80, false),
    );
  });

  test("dim=true never breaks width accounting (ANSI-transparent wrap)", () => {
    const question = mkQuestion("q1", { group: "g" });
    for (const w of WIDTHS) {
      const line = renderQuestionLine(question, 1, 2, ansiDimTheme, w, true);
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
    expect(short).toContain("Ctrl+S submit");
    expect(short).toContain("d deep");
    expect(short).not.toContain("i list"); // excluded by the 2-key cap
    expect(short).not.toContain("enter"); // no statics exist to keep (FOOTER-001)

    const deep = renderFooter(mkState(), "deep", labels, theme, 120, true);
    expect(deep).toContain("Ctrl+S submit");
    expect(deep).toContain("d deep"); // replaces deep's own list hint
    expect(deep).not.toContain("i list");
  });

  test("width 59 keeps exactly the submit + deep key hints — statics drop first", () => {
    // Overview narrow: with the zero-re-asked segment omitted, the two key
    // hints AND the statics fit at 59 — the ladder only sheds statics when
    // width demands it.
    const line = renderFooter(mkState(), "overview", shortLabels, theme, 59, true);
    expect(line).toContain("s submit");
    expect(line).toContain("d deep");
    expect(visibleWidth(line)).toBeLessThanOrEqual(59);
  });

  test("narrow degrades right-to-left into the ordinary fit loop", () => {
    // Far below 59 every hint yields; the progress-only footer is still
    // exactly 1 line (progress + ⏎ never drop — module contract).
    const line = renderFooter(mkState(), "overview", shortLabels, theme, 31, true);
    expect(line).toBe("└ 0/1 answered · s submit ⏎ ┘"); // enter jump/esc back/deep yielded; submit (leftmost key hint) survives
    expect(line.includes("\n")).toBe(false);
  });
});

describe("chat footer (SIDECHAT-001, P1.M2.T4.S1)", () => {
  const CHAT_HINTS = "enter send · /clear · esc exit";

  test("pre-rendered hints compose into the frame as ONE entry", () => {
    const labels = resolveKeyLabels(mkConfig());
    const line = renderFooter(
      mkState(),
      "chat",
      labels,
      theme,
      120,
      false,
      undefined,
      undefined,
      CHAT_HINTS,
    );
    expect(line.startsWith("└ ")).toBe(true);
    expect(line).toContain(CHAT_HINTS); // the string rides verbatim (single fit entry)
    expect(line).toContain("0/1 answered"); // progress rides the frame
    expect(line.endsWith("⏎ ┘")).toBe(true);
  });

  test("fallback without chatHints names the chat binding", () => {
    const labels = resolveKeyLabels(mkConfig());
    const line = renderFooter(mkState(), "chat", labels, theme, 120);
    expect(line).toContain(`${labels.chat} chat`);
    expect(line).not.toContain("enter send"); // nothing fabricated
  });

  test("degradation drops the whole hint entry; progress-only survives", () => {
    const labels = resolveKeyLabels(mkConfig());
    const line = renderFooter(
      mkState(),
      "chat",
      labels,
      theme,
      30,
      false,
      undefined,
      undefined,
      CHAT_HINTS,
    );
    expect(line).not.toContain("enter send"); // the entry yielded whole
    expect(line).toContain("answered"); // progress never drops
    expect(line.endsWith("⏎ ┘")).toBe(true);
  });
});

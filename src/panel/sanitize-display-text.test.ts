/**
 * src/panel/sanitize-display-text.test.ts — SANITIZE-001 regression pins
 * (2026-10-17, owner report "accumulating artifacts").
 *
 * The contract under test: every line a panel view emits is ONE TERMINAL
 * ROW — no line-break controls (\n, \r, VT, FF) and no row-corrupting stray
 * control bytes (\x08 BS, \x0e/\x0f SO/SI, \x7f DEL, …). pi-tui's
 * differential renderer paints each array element as exactly one row and
 * its visibleWidth counts C0 controls as zero-width, so a literal newline
 * riding inside an element executes as a real line feed on the terminal,
 * desyncing the renderer's row model; view switches then compound the
 * desync and stale blocks accumulate in scrollback (+1 per open/close
 * cycle on terminals tall enough for the diff path — the reported bug).
 *
 * Root cause chain, for the record: model-authored question text is
 * free-form multi-paragraph prose; wrapText splits only on spaces (a \n
 * survives inside a word) and truncateVisible measured the \n as width 0 —
 * so the deep view (full-text rendering since e6e2f3a removed the caps
 * engine) shipped literal newlines in rendered lines. The fix flattens
 * line breaks to single spaces and deletes stray controls at the two
 * display choke points (truncateVisible / wrapText) plus the footer's
 * label composition — display ONLY; model-facing records keep their
 * newlines (results.ts, sidechat prompts, persistence).
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { EditorComponent, TUI } from "@earendil-works/pi-tui";
import { describe, expect, test, vi } from "vitest";
import { DEFAULT_CONFIG } from "../config.js";
import { createInterrogationState, resetState, type InterrogationState, type Question } from "../state.js";
import { InterrogationPanel, type InterrogationPanelArgs } from "./panel.js";
import { sanitizeDisplayText, truncateVisible } from "./layout.js";
import { wrapText } from "./deep-view.js";
import { renderFooter } from "./layout.js";

/** Identity theme (panel.test.ts convention) — no ESC bytes, so the row
 *  assertion below is airtight against fixture output. */
const stubTheme = {
  fg: (_name: string, s: string) => s,
  bold: (s: string) => s,
} as unknown as Theme;

/**
 * Every control byte that corrupts row/column geometry on a real terminal:
 * line breaks (\n \r \v \f), cursor movers (BS DEL), charset shifts (SO SI),
 * flow controls, and the C0 misc band — everything except ESC (\x1b, ANSI),
 * BEL (\x07, OSC-8 terminator) and TAB (\x09, width-accounted by pi-tui).
 */
/* eslint-disable no-control-regex -- SANITIZE-001: the assertions match control bytes by design */
const ROW_CORRUPTERS = /[\x00-\x06\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/;

function fakePanelEditor(): EditorComponent {
  let text = "";
  return {
    getText: vi.fn(() => text),
    setText: vi.fn((t: string) => {
      text = t;
    }),
    handleInput: vi.fn(),
    render: vi.fn(() => ["e1", "e2", "e3"]),
    invalidate: vi.fn(),
    focused: false,
  } as unknown as EditorComponent;
}

function panelArgsFor(
  state: InterrogationState,
  extra: Partial<InterrogationPanelArgs> = {},
): InterrogationPanelArgs {
  return {
    tui: { requestRender: vi.fn() } as unknown as TUI,
    theme: stubTheme,
    done: () => {},
    state,
    config: DEFAULT_CONFIG,
    editorFactory: () => fakePanelEditor(),
    ...extra,
  };
}

/** The question shape from the owner report: multi-paragraph description
 *  (the deep view renders it in full), a multi-paragraph ramification, a
 *  label with an embedded break, and a moot reason with one. */
function messyQ(id: string): Question {
  return {
    id,
    prompt: `prompt:${id}\nsecond line of the prompt`,
    title: `Q${id} title\nwith a break`,
    type: "choice",
    rev: 1,
    status: "open",
    group: `Artifact\n(Q1–Q2)`,
    description:
      "The sidecar file holds the engine's persistent state so it survives a server restart via tmux-resurrect's save/restore hooks.\n" +
      "\n" +
      "**Fixed name** means one sidecar, e.g. `<resurrect-dir>/session-history.state`, overwritten on every resurrect save.",
    options: [
      {
        value: "fixed",
        label: "One fixed file: session-history.state",
        ramification:
          "Simplest possible round-trip: export blindly overwrites one file, import blindly reads it.\n" +
          "\n" +
          "No path derivation, no rotation, resurrect's dedup quirk is irrelevant.",
      },
      { value: "per-save", label: "Per-save files: tmux_resurrect_<ts>.state" },
    ],
    mootReason: "dependency changed\nupstream was re-asked",
  };
}

// ------------------------------------------------------- sanitizeDisplayText

describe("sanitizeDisplayText — SANITIZE-001 flattening rules", () => {
  test("test_line_breaks_flatten_to_one_space", () => {
    expect(sanitizeDisplayText("a\nb")).toBe("a b");
    expect(sanitizeDisplayText("a\rb")).toBe("a b");
    expect(sanitizeDisplayText("a\r\nb")).toBe("a b");
    expect(sanitizeDisplayText("a\vb")).toBe("a b"); // VT is a line feed
    expect(sanitizeDisplayText("a\fb")).toBe("a b"); // FF is a line feed
  });

  test("test_break_runs_with_surrounding_space_collapse_to_one_space", () => {
    // The owner-report shape: a blank line between paragraphs.
    expect(sanitizeDisplayText("para one.\n\nPara two.")).toBe("para one. Para two.");
    expect(sanitizeDisplayText("para one. \n \t \n Para two.")).toBe("para one. Para two.");
    expect(sanitizeDisplayText("a\r\n\r\nb")).toBe("a b");
    expect(sanitizeDisplayText("a\n\n\n\nb")).toBe("a b");
  });

  test("test_row_corrupting_strays_are_deleted_not_spaced", () => {
    // Backspace moves the cursor left; SO/SI shift charsets; DEL eats a
    // cell — none may reach the terminal, and deleting (not spacing) keeps
    // clean text's spacing intact.
    expect(sanitizeDisplayText("ab\x08c")).toBe("abc");
    expect(sanitizeDisplayText("a\x0eb")).toBe("ab");
    expect(sanitizeDisplayText("a\x0fb")).toBe("ab");
    expect(sanitizeDisplayText("a\x7fb")).toBe("ab");
    expect(sanitizeDisplayText("a\x00\x01\x02b")).toBe("ab");
    expect(sanitizeDisplayText("a\x1c\x1d\x1e\x1fb")).toBe("ab");
  });

  test("test_ansi_sequences_bel_and_tabs_survive", () => {
    // Themed fragments flow through the choke points: CSI params, OSC-8
    // hyperlink terminators (BEL) and tabs (width-accounted by pi-tui)
    // must pass untouched.
    const ansi = "\x1b[38;2;10;20;30mstyled\x1b[0m";
    expect(sanitizeDisplayText(ansi)).toBe(ansi);
    const osc = "\x1b]8;;https://example.com\x07link\x1b]8;;\x07";
    expect(sanitizeDisplayText(osc)).toBe(osc);
    expect(sanitizeDisplayText("a\tb")).toBe("a\tb");
  });

  test("test_identity_on_clean_text_and_idempotent", () => {
    const clean = "One fixed file: session-history.state — Simplest possible round-trip.";
    expect(sanitizeDisplayText(clean)).toBe(clean);
    const once = sanitizeDisplayText("a\n\nb\x08c");
    expect(sanitizeDisplayText(once)).toBe(once);
  });
});

// --------------------------------------------------- choke-point unit pins

describe("wrapText — SANITIZE-001 wrap choke point", () => {
  test("test_multiline_paragraphs_wrap_as_single_row_lines", () => {
    const lines = wrapText(
      "Para one of the description is long enough to wrap around the pane a bit.\n" +
        "\n" +
        "Para two follows the embedded newline.",
      40,
    );
    expect(lines.length).toBeGreaterThan(1); // it actually wrapped
    for (const line of lines) expect(line).not.toMatch(ROW_CORRUPTERS);
    // The paragraphs joined with exactly one space — no doubled spaces.
    expect(lines.join(" ").includes("  ")).toBe(false);
  });

  test("test_crlf_and_lone_cr_also_flatten", () => {
    const lines = wrapText("alpha\r\nbeta\rgamma", 80);
    expect(lines).toEqual(["alpha beta gamma"]);
  });
});

describe("truncateVisible — SANITIZE-001 truncation choke point", () => {
  test("test_fitting_multiline_text_returns_flattened_single_row", () => {
    // Fitting text takes the early-return path — it must return the
    // SANITIZED text there too, not the raw input.
    const out = truncateVisible("short one.\n\nshort two.", 80);
    expect(out).toBe("short one. short two.");
    expect(out).not.toMatch(ROW_CORRUPTERS);
  });

  test("test_truncated_multiline_text_has_no_row_corrupters", () => {
    const out = truncateVisible(
      "The sidecar file holds the engine's persistent state so it survives a server restart.\n\nSecond paragraph tail that will be cut.",
      60,
    );
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(ROW_CORRUPTERS);
  });
});

// ------------------------------------------------------- panel-level pins

describe("panel render — SANITIZE-001 one-line-per-row invariant", () => {
  test("test_every_line_of_every_view_is_one_terminal_row", () => {
    resetState();
    const state = createInterrogationState(
      "Resolve the five TODO(open) design questions\nso the spec can be finalized.",
    );
    state.upsertQuestion(messyQ("q1"));
    const panel = new InterrogationPanel(panelArgsFor(state));

    // Short view: hint (first sentence), option teasers, markers, preview.
    const short = panel.render(120);
    expect(short.length).toBeGreaterThan(3);
    for (const line of short) expect(line).not.toMatch(ROW_CORRUPTERS);

    // Deep view: FULL description + full ramifications — the view that
    // shipped literal newlines before the fix.
    panel.setView("deep");
    const deep = panel.render(120);
    expect(deep.join("\n")).toContain("**Fixed name** means one sidecar");
    for (const line of deep) expect(line).not.toMatch(ROW_CORRUPTERS);

    // Overview: question rows (title/prompt fallbacks, moot reasons).
    panel.setView("overview");
    const overview = panel.render(120);
    for (const line of overview) expect(line).not.toMatch(ROW_CORRUPTERS);

    // The header goal carries the state goal text (also multi-paragraph
    // in the wild — every view's first line).
    for (const frame of [short, deep, overview]) {
      expect(frame[0]).not.toMatch(ROW_CORRUPTERS);
    }
  });

  test("test_moot_reason_with_break_renders_one_row", () => {
    resetState();
    const state = createInterrogationState("goal");
    state.upsertQuestion({ ...messyQ("q1"), status: "moot", dependsOn: undefined });
    const panel = new InterrogationPanel(panelArgsFor(state));
    for (const line of panel.render(120)) expect(line).not.toMatch(ROW_CORRUPTERS);
    panel.setView("deep");
    for (const line of panel.render(120)) expect(line).not.toMatch(ROW_CORRUPTERS);
  });

  test("test_footer_hints_survive_a_label_with_a_break", () => {
    // resolveKeyLabels output is config-derived; a stray control byte in a
    // label must not reach the composed footer line.
    const state = createInterrogationState("goal");
    state.upsertQuestion(messyQ("q1"));
    const serialized = state.serialize();
    const labels = {
      deep: "d\x0b",
      overview: "o",
      elaborate: "t",
      batchNote: "n",
      submit: "ctrl+s\n",
      chat: "e",
      externalEditor: "ctrl+g",
      prevQuestion: "p",
      nextQuestion: "N",
    } as unknown as Parameters<typeof renderFooter>[2];
    const footer = renderFooter(serialized, "short", labels, stubTheme, 120);
    expect(footer).not.toMatch(ROW_CORRUPTERS);
  });
});

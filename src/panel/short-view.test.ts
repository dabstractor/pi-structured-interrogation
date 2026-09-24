/**
 * src/panel/short-view.test.ts — short-view options region renderer tests
 * (P1.M3.T2.S1).
 *
 * Covers the S1 success criteria: ★ + preselect coexistence on the
 * recommended option (R2, "▸ ★ sqlite"), cursor-prefix alignment between
 * starred/unstarred/cursor lines, the focusable ✎ Other — write your own row at
 * the end of the cursor domain, the primary text affordance with dimmed
 * answered preview, moot dimming with derived reason, withdrawn collapse,
 * ramification teaser truncation, and the width-invariant sweep
 * (60/80/120) asserting visibleWidth ≤ width and no wrap.
 *
 * Conventions follow layout.test.ts / tool.test.ts: identity theme stub
 * for content assertions, hand-built plain fixtures (no runtime). A second
 * stub wraps `dim` in REAL ANSI codes so dimming is assertable while
 * visibleWidth math stays honest (ANSI is width-invisible).
 */
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, test } from "vitest";
import type { Question } from "../state.js";
import { initialCursorIndex, mootReason, renderShortViewOptions } from "./short-view.js";

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

function choiceQ(overrides: Partial<Question> = {}): Question {
  return {
    id: "db",
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

function textQ(overrides: Partial<Question> = {}): Question {
  return {
    id: "notes",
    prompt: "Anything else?",
    type: "text",
    rev: 1,
    status: "open",
    ...overrides,
  };
}

function render(q: Question, cursorIndex: number, th: Theme = theme, width = 80): string[] {
  return renderShortViewOptions({ question: q, cursorIndex, theme: th, width });
}

// ------------------------------------------------- cursor domain + preselect

describe("initialCursorIndex (R2 preselect)", () => {
  test("points at the recommended option and only at it", () => {
    expect(initialCursorIndex(choiceQ())).toBe(0);
    expect(initialCursorIndex(choiceQ({ recommendation: "postgres" }))).toBe(1);
  });

  test("no recommendation → 0; unknown recommendation value clamps to 0", () => {
    expect(initialCursorIndex(choiceQ({ recommendation: undefined }))).toBe(0);
    expect(initialCursorIndex(choiceQ({ recommendation: "ghost" }))).toBe(0);
  });

  test("text questions → 0; answers never pin the cursor (revisited answered)", () => {
    expect(initialCursorIndex(textQ())).toBe(0);
    expect(initialCursorIndex(choiceQ({ status: "answered" }))).toBe(0);
  });
});

describe("mootReason", () => {
  test("derives from answer.value when present, else the generic string", () => {
    expect(mootReason(choiceQ({ answer: { value: "postgres chosen", at: "2026-01-01T00:00:00Z" } }))).toBe(
      "postgres chosen",
    );
    expect(mootReason(choiceQ())).toBe("dependency changed");
    expect(mootReason(choiceQ({ answer: { value: "", at: "2026-01-01T00:00:00Z" } }))).toBe(
      "dependency changed",
    );
  });
});

// ------------------------------------------------------------ option lines

describe("choice option lines", () => {
  test("(a) recommended option renders ▸ ★ and holds the initial cursor (R2)", () => {
    const q = choiceQ();
    const cursor = initialCursorIndex(q);
    const lines = render(q, cursor);
    expect(lines[0]).toContain("▸ ★ sqlite");
    expect(lines[0]).toContain(RAM_A);
    expect(lines[0].startsWith("  ▸ ★ sqlite")).toBe(true); // inset + cursor + star
  });

  test("(b) cursor elsewhere: ★ stays on the recommendation, cursor moves", () => {
    const lines = render(choiceQ(), 1);
    expect(lines[0].startsWith("    ★ sqlite")).toBe(true); // inset + blank prefix + star
    expect(lines[1].startsWith("  ▸ postgres")).toBe(true);
    expect(lines[1]).not.toContain("★");
  });

  test("cursor and star prefixes keep columns aligned (4-col starred heads)", () => {
    const atRec = render(choiceQ(), 0);
    const elsewhere = render(choiceQ(), 1);
    expect(atRec[0].slice(0, 6)).toBe("  ▸ ★ ");
    expect(elsewhere[0].slice(0, 6)).toBe("    ★ ");
    expect(elsewhere[1].slice(0, 4)).toBe("  ▸ "); // 2-col prefix, no star shift
  });

  test("(c) no recommendation → no ★ anywhere, cursor at 0", () => {
    const q = choiceQ({ recommendation: undefined });
    const lines = render(q, 0);
    expect(lines.join("\n")).not.toContain("★");
    expect(lines[0].startsWith("  ▸ sqlite")).toBe(true);
  });

  test("(d) recommendation value missing from options → clamp 0, no ★", () => {
    const q = choiceQ({ recommendation: "ghost" });
    const lines = render(q, initialCursorIndex(q));
    expect(lines.join("\n")).not.toContain("★");
    expect(lines[0].startsWith("  ▸ sqlite")).toBe(true);
  });

  test("(i) ramification teaser truncates with … and is omitted when out of room", () => {
    const long = choiceQ({
      options: [{ value: "a", label: "alpha", ramification: "R".repeat(200) }],
    });
    const lines = render(long, 0, theme, 60);
    expect(lines[0]).toContain("…");
    expect(lines[0]).not.toContain("R".repeat(50));
    expect(visibleWidth(lines[0])).toBeLessThanOrEqual(60);

    const fits = choiceQ({ options: [{ value: "a", label: "alpha", ramification: "tiny" }] });
    expect(render(fits, 0)[0]).toContain("alpha — tiny");

    // No budget left under the label → teaser dropped whole, line still fits.
    const narrow = choiceQ({
      options: [{ value: "a", label: "alphabeta", ramification: "R".repeat(50) }],
    });
    const narrowLines = render(narrow, 0, theme, 14);
    expect(narrowLines[0]).not.toContain("—");
    expect(visibleWidth(narrowLines[0])).toBeLessThanOrEqual(14);
  });

  test("(k) choice question with options undefined renders ✎ only", () => {
    const q = choiceQ({ options: undefined });
    expect(initialCursorIndex(q)).toBe(0);
    expect(render(q, 0)).toEqual(["  ▸ ✎ Other — write your own"]); // cursor 0 === options.length → focused
    expect(render(q, 5)).toEqual(["    ✎ Other — write your own"]); // unfocused variant, out-of-range cursor
  });
});

// -------------------------------------------------------- ✎ affordance line

describe("✎ Other — write your own row (WRITEIN-001)", () => {
  test("(e) focusable at the end of the cursor domain, dimmed otherwise", () => {
    const q = choiceQ();
    const last = (q.options ?? []).length;

    const focused = render(q, last, dimTheme).at(-1);
    expect(focused).toBe("  ▸ ✎ Other — write your own"); // full intensity — no dim codes
    expect(focused).not.toContain(DIM);

    const idle = render(q, 0, dimTheme).at(-1);
    expect(idle).toContain("✎ Other — write your own");
    expect(idle).toContain(DIM); // dimmed when not the focus target
    expect(idle).not.toContain("▸");
  });
});

// ---------------------------------------------------------- text questions

describe("text questions", () => {
  test("(f) primary affordance renders; answered preview is dimmed first line only", () => {
    const q = textQ();
    expect(initialCursorIndex(q)).toBe(0);
    const lines = render(q, 0);
    expect(lines).toEqual(["  ▸ ✎ answer…"]); // full intensity, cursor index 0

    const answered = textQ({
      status: "answered",
      answer: { value: "first line", text: "first line\nsecond line", at: "2026-01-01T00:00:00Z" },
    });
    const aLines = render(answered, 0, dimTheme);
    expect(aLines[0]).toBe("  ▸ ✎ answer…"); // affordance stays primary
    expect(aLines[1]).toContain(DIM); // preview dimmed
    expect(aLines[1]).toContain("first line");
    expect(aLines.join("\n")).not.toContain("second line"); // first line only
  });

  test("affordance is full intensity even unfocused; no option lines ever", () => {
    const lines = render(textQ(), 0, dimTheme);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(DIM);
  });

  test("(w2) answered preview reads answer.value (BUG-005 part 2) — text answers commit to value", () => {
    const q = textQ({
      status: "answered",
      answer: { value: "text answer", at: "2026-01-01T00:00:00Z" },
    });
    const lines = render(q, 0, dimTheme);
    expect(lines).toHaveLength(2); // affordance + preview (was dead before the fix)
    expect(lines[1]).toContain(DIM); // dimmed
    expect(lines[1]).toContain("text answer");
  });
});

// ------------------------------------------------------- write-in preview

describe("write-in preview (BUG-005 part 2)", () => {
  const AT = "2026-01-01T00:00:00Z";

  test("(w1) choice custom write-in renders dimmed value preview below the Other row", () => {
    const q = choiceQ({
      status: "answered",
      answer: { value: "my write-in", custom: true, at: AT },
    });
    const lines = render(q, 0, dimTheme);
    expect(lines).toHaveLength(4); // 2 options + Other row + preview
    const preview = lines[3];
    expect(preview).toContain(DIM); // dimmed
    expect(preview).toContain("my write-in");
    // Rows above the preview are untouched by the fix.
    expect(render(q, 0, dimTheme).slice(0, 3)).toEqual(
      render(choiceQ({ status: "answered" }), 0, dimTheme),
    );
  });

  test("(w3) multi-line write-in previews first line only", () => {
    const q = choiceQ({
      status: "answered",
      answer: { value: "line one\nline two", custom: true, at: AT },
    });
    const lines = render(q, 0, dimTheme);
    expect(lines).toHaveLength(4);
    expect(lines[3]).toContain("line one");
    expect(lines.join("\n")).not.toContain("line two"); // first line only
  });

  test("(w4) long write-in truncates at narrow width — every line stays single", () => {
    const q = choiceQ({
      status: "answered",
      answer: {
        value: "a very long write-in answer that can never possibly fit inside narrow terminal widths",
        custom: true,
        at: AT,
      },
    });
    const lines = render(q, 0, dimTheme, 40);
    expect(lines).toHaveLength(4); // truncated, never wrapped
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(40);
    expect(lines[3]).toContain("…"); // truncateVisible ellipsis
  });

  test("(w5) elaboration-only choice answer previews answer.text (behavior unchanged)", () => {
    const q = choiceQ({
      status: "answered",
      answer: { value: "postgres", text: "ops note", at: AT }, // no custom
    });
    const lines = render(q, 0, dimTheme);
    expect(lines).toHaveLength(4);
    expect(lines[3]).toContain("ops note");
  });

  test("(w6) plain option answer adds no preview line (rows carry the selection)", () => {
    const plain = choiceQ({
      status: "answered",
      answer: { value: "sqlite", at: AT }, // an option value — NOT previewed
    });
    expect(render(plain, 0)).toHaveLength(3); // 2 options + Other, no preview
    expect(render(plain, 0)).toEqual(render(choiceQ({ status: "answered" }), 0));
  });

  test("(w7) empty or valueless custom answers render no line (never 'undefined')", () => {
    const emptyValue = choiceQ({
      status: "answered",
      answer: { value: "", custom: true, at: AT },
    });
    expect(render(emptyValue, 0)).toHaveLength(3);
    // Defensive: a custom answer missing its value field entirely.
    const noValue = choiceQ({
      status: "answered",
      answer: { custom: true, at: AT } as unknown as Question["answer"],
    });
    expect(render(noValue, 0)).toHaveLength(3);
    expect(render(noValue, 0).join("\n")).not.toContain("undefined");
    // No answer at all → unchanged.
    expect(render(choiceQ({ status: "answered" }), 0)).toHaveLength(3);
  });
});

// ------------------------------------------------- moot / withdrawn variants

describe("moot and withdrawn questions", () => {
  test("(g) moot renders dimmed region with derived reason line (★ dimmed too)", () => {
    const withCause = choiceQ({
      status: "moot",
      answer: { value: "postgres chosen", at: "2026-01-01T00:00:00Z" },
    });
    const lines = render(withCause, 0, dimTheme);
    expect(lines[0]).toBe(`  ${DIM}⊘ moot — postgres chosen${RESET}`);
    for (const line of lines.slice(1)) expect(line).toContain(DIM); // whole region dimmed
    expect(lines[1]).toContain("★ sqlite"); // still listed — audit trail (Q34=A)

    const noCause = choiceQ({ status: "moot" });
    expect(render(noCause, 0)[0]).toContain("⊘ moot — dependency changed");
  });

  test("(h) withdrawn collapses to a single dimmed ⊗ line", () => {
    const lines = render(choiceQ({ status: "withdrawn" }), 0, dimTheme);
    expect(lines).toEqual([`  ${DIM}⊗ withdrawn${RESET}`]);
  });
});

// --------------------------------------------- width-invariant sweep (L3/L4)

describe("width invariants (60/80/120)", () => {
  test("(j) every line fits the width — no wrap, ANSI-safe dimming", () => {
    const WIDTHS = [60, 80, 120];
    const longChoice = choiceQ({
      options: [
        { value: "a", label: "L".repeat(120), ramification: "R".repeat(200) },
        { value: "b", label: "M".repeat(40) },
        { value: "c", label: "N".repeat(30), ramification: "S".repeat(100) },
      ],
    });
    const mootQ = choiceQ({
      id: "m",
      status: "moot",
      answer: { value: "c".repeat(80), at: "2026-01-01T00:00:00Z" },
    });
    const textLong = textQ({
      id: "t",
      answer: { value: "", text: `${"P".repeat(150)}\nsecond`, at: "2026-01-01T00:00:00Z" },
    });
    const withdrawn = choiceQ({ id: "w", status: "withdrawn" });

    for (const width of WIDTHS) {
      for (const q of [longChoice, mootQ, textLong, withdrawn]) {
        for (const cursor of [0, 1, 2, 99]) {
          for (const th of [theme, dimTheme]) {
            for (const line of render(q, cursor, th, width)) {
              expect(line).not.toContain("\n");
              expect(visibleWidth(line)).toBeLessThanOrEqual(width);
            }
          }
        }
      }
    }
  });
});

// ------------------------------------- soft-gate dimmed flag (P1.M5.T3.S1)

describe("renderShortViewOptions dimmed — soft-gate dimming (P1.M5.T3.S1)", () => {
  test("dimmed:true wraps EVERY line; content byte-identical to undimmed", () => {
    const question = choiceQ();
    const cursor = initialCursorIndex(question);
    const plain = renderShortViewOptions({ question, cursorIndex: cursor, theme: dimTheme, width: 80 });
    const dimmed = renderShortViewOptions({ question, cursorIndex: cursor, theme: dimTheme, width: 80, dimmed: true });
    expect(dimmed).toHaveLength(plain.length);
    dimmed.forEach((line, i) => {
      // Exact wrap invariant: DIM + (same-theme undimmed line) + RESET —
      // cursor ▸, ★, ramification teaser all inside the wrap untouched.
      expect(line).toBe(`${DIM}${plain[i]}${RESET}`);
    });
  });

  test("dimmed defaults to false — output byte-identical to dimmed:false", () => {
    const question = choiceQ();
    const cursor = initialCursorIndex(question);
    const implicit = renderShortViewOptions({ question, cursorIndex: cursor, theme, width: 80 });
    const explicitFalse = renderShortViewOptions({ question, cursorIndex: cursor, theme, width: 80, dimmed: false });
    expect(implicit).toEqual(explicitFalse);
  });

  test("dimmed:true on a text question wraps affordance + preview lines", () => {
    const question = textQ({ status: "answered", answer: { value: "notes", text: "line one\nline two", at: "t" } });
    const plain = renderShortViewOptions({ question, cursorIndex: 0, theme: dimTheme, width: 80 });
    const dimmed = renderShortViewOptions({ question, cursorIndex: 0, theme: dimTheme, width: 80, dimmed: true });
    expect(dimmed).toHaveLength(plain.length);
    dimmed.forEach((line, i) => expect(line).toBe(`${DIM}${plain[i]}${RESET}`));
  });

  test("dimmed:true on moot/withdrawn may double-dim (acceptable) without width change", () => {
    const moot = choiceQ({ status: "moot", answer: { value: "dep", at: "t" } });
    const plain = renderShortViewOptions({ question: moot, cursorIndex: 0, theme: dimTheme, width: 80 });
    const dimmed = renderShortViewOptions({ question: moot, cursorIndex: 0, theme: dimTheme, width: 80, dimmed: true });
    dimmed.forEach((line, i) => expect(line).toBe(`${DIM}${plain[i]}${RESET}`));
    for (const line of dimmed) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(80);
    }

    const withdrawn = choiceQ({ status: "withdrawn" });
    const wPlain = renderShortViewOptions({ question: withdrawn, cursorIndex: 0, theme: dimTheme, width: 80 });
    const wd = renderShortViewOptions({ question: withdrawn, cursorIndex: 0, theme: dimTheme, width: 80, dimmed: true });
    expect(wd).toHaveLength(1);
    expect(wd[0]).toBe(`${DIM}${wPlain[0]}${RESET}`);
  });

  test("dimmed:true keeps width invariants at every tested width", () => {
    const question = choiceQ();
    for (const w of [60, 80, 120]) {
      const lines = renderShortViewOptions({ question, cursorIndex: 0, theme: dimTheme, width: w, dimmed: true });
      for (const line of lines) {
        expect(line).not.toContain("\n");
        expect(visibleWidth(line)).toBeLessThanOrEqual(w);
      }
    }
  });
});

// -------------------------- narrow width (h2.30 cols < 60, P1.M7.T5.S1)

describe("narrow width (h2.30 cols < 60)", () => {
  test("labels truncate with … at width 59 — every line stays inside the budget", () => {
    const q = choiceQ({
      options: [
        { value: "a", label: "A".repeat(80), ramification: RAM_A },
        { value: "b", label: "B".repeat(80), ramification: RAM_B },
      ],
    });
    const lines = render(q, 0, theme, 59);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(59);
    expect(lines.join("\n")).toContain("…"); // truncation is the fallback, not overflow
  });

  test("text affordance fits at width 59", () => {
    const lines = render(textQ(), 0, theme, 59);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(59);
  });
});

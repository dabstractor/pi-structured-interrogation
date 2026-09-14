/**
 * src/renderers.test.ts — unit tests for the submission diff card renderer
 * (P1.M7.T3.S1; h2.36).
 *
 * Calls the PURE {@link buildSubmissionCard} directly with an identity stub
 * theme (tool.test.ts pattern) — no pi runtime, no TUI. Assertions run on
 * `Text`/`Box` render output: with the identity theme the rendered lines are
 * plain strings, so content/structure checks are exact. A tagging theme
 * (wraps every theme.fg payload in `[name]…[/]`) proves the AC-13
 * `(changed)` marker is styled distinctly (theme.fg("warning", …)).
 *
 * Covered: (a) collapsed happy path, (b) AC-13 marker + styling, (c) note
 * present/absent/empty, (d) expanded full submission (no cap, no
 * truncation, epoch footer), (e) collapsed 80-col truncation + entry cap
 * rollup, (f) defensive fallbacks (no details / no card / sparse changed),
 * (g) zero-changes card, plus the registerSubmissionCardRenderer shim.
 */
import { describe, expect, test } from "vitest";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import {
  buildSubmissionCard,
  COLLAPSED_ENTRY_CAP,
  COLLAPSED_LINE_BUDGET,
  registerSubmissionCardRenderer,
  type CardRenderOptions,
  type SubmissionCardMessage,
} from "./renderers.js";
import type { DiffEntry, SubmissionCardData } from "./snapshots.js";

/** Identity theme (tool.test.ts pattern): passes text through untouched. */
const stubTheme = {
  fg: (_name: string, s: string) => s,
  bold: (s: string) => s,
} as unknown as Theme;

/** Tagging theme: proves WHICH theme.fg color wrapped a payload. */
const tagTheme = {
  fg: (name: string, s: string) => `[${name}]${s}[/]`,
  bold: (s: string) => s,
} as unknown as Theme;

function entry(overrides: Partial<DiffEntry> = {}): DiffEntry {
  return {
    id: "q1",
    title: "Database",
    from: "sqlite",
    to: "postgres",
    editedArchived: false,
    ...overrides,
  };
}

function card(overrides: Partial<SubmissionCardData> = {}): SubmissionCardData {
  return {
    changed: [entry(), entry({ id: "q2", title: "Cache", from: "none", to: "redis" })],
    epoch: 4,
    remainOpen: 3,
    ...overrides,
  };
}

function msg(
  data: SubmissionCardData,
  content = "Submitted 2: q1: postgres; q2: redis\nConsider how these affect your other questions.",
): SubmissionCardMessage {
  return { content, details: { card: data } };
}

const collapsed: CardRenderOptions = { expanded: false, outputPad: 0 };
const expanded: CardRenderOptions = { expanded: true, outputPad: 0 };

/** Render a built component to trimmed display lines (wide width → no wrap). */
function lines(component: Parameters<typeof buildSubmissionCard>[2] extends never ? never : TextLike): string[] {
  return component.render(500).map((l) => l.trimEnd());
}
type TextLike = { render(width: number): string[] };

describe("buildSubmissionCard", () => {
  test("collapsed happy path: header, both entry lines, remain-open footer", () => {
    const out = buildSubmissionCard(msg(card()), collapsed, stubTheme);
    const ls = lines(out);
    expect(ls[0]).toContain("Submitted");
    expect(ls[0]).toContain("2 changed");
    expect(ls[0]).toContain("epoch 4");
    expect(ls).toContainEqual(expect.stringContaining("Database: sqlite → postgres"));
    expect(ls).toContainEqual(expect.stringContaining("Cache: none → redis"));
    expect(ls.some((l) => l.endsWith("3 remain open"))).toBe(true);
  });

  test("AC-13: editedArchived entry renders the (changed) marker, styled warning", () => {
    const data = card({ changed: [entry({ editedArchived: true })] });
    const out = buildSubmissionCard(msg(data), collapsed, stubTheme);
    expect(lines(out).some((l) => l.includes("Database: sqlite → postgres (changed)"))).toBe(true);

    // Styled distinctly: the marker payload passes through theme.fg("warning", …).
    const tagged = buildSubmissionCard(msg(data), collapsed, tagTheme);
    expect(lines(tagged).some((l) => l.includes("[warning] (changed)[/]"))).toBe(true);

    // Non-edited entries carry no marker.
    const plain = buildSubmissionCard(msg(card()), collapsed, stubTheme);
    expect(lines(plain).some((l) => l.includes("(changed)"))).toBe(false);
  });

  test("note present renders a NOTE: line; absent or empty note renders none", () => {
    const withNote = buildSubmissionCard(msg(card({ note: "prefer sqlite compat" })), collapsed, stubTheme);
    expect(lines(withNote).some((l) => l.includes("NOTE: prefer sqlite compat"))).toBe(true);

    const withoutNote = buildSubmissionCard(msg(card()), collapsed, stubTheme);
    expect(lines(withoutNote).some((l) => l.includes("NOTE:"))).toBe(false);

    // computeDiff omits empty notes, but truthiness (never .length) also
    // guards a hand-built empty string.
    const emptyNote = buildSubmissionCard(msg(card({ note: "" })), collapsed, stubTheme);
    expect(lines(emptyNote).some((l) => l.includes("NOTE:"))).toBe(false);
  });

  test("expanded: all entries past the cap, untruncated, note in full, epoch footer", () => {
    const longTo = "x".repeat(300);
    const longNote = "n".repeat(200);
    const many = Array.from({ length: 12 }, (_, i) =>
      entry({ id: `q${i}`, title: `T${i}`, from: "a", to: "b" }),
    );
    const data = card({
      changed: [...many, entry({ id: "qLong", to: longTo, editedArchived: true })],
      note: longNote,
    });
    const out = buildSubmissionCard(msg(data), expanded, stubTheme);
    const ls = lines(out);

    // No cap: every one of the 13 entries renders.
    expect(ls.filter((l) => l.includes(": a → b")).length).toBe(12);
    // No truncation: the 300-char value and 200-char note appear in full.
    expect(ls.some((l) => l.includes(longTo))).toBe(true);
    expect(ls.some((l) => l.includes(longNote))).toBe(true);
    // AC-13 marker still applied when expanded.
    expect(ls.some((l) => l.includes("(changed)"))).toBe(true);
    // Dedicated dim epoch footer line (header omits the inline epoch).
    expect(ls.some((l) => l === "epoch 4")).toBe(true);
    expect(ls[0]).not.toContain("epoch");
  });

  test("collapsed truncation: long entry line is cut to the visible budget", () => {
    const data = card({ changed: [entry({ to: "y".repeat(200) })] });
    const out = buildSubmissionCard(msg(data), collapsed, stubTheme);
    const line = lines(out).find((l) => l.includes("Database:"));
    expect(line).toBeDefined();
    expect(visibleWidth(line as string)).toBeLessThanOrEqual(COLLAPSED_LINE_BUDGET);
    // Head of the value survives (truncation cuts the tail, keeps the start).
    expect(line).toContain("Database: sqlite → yyy");
  });

  test("collapsed entry cap: 10 entries → cap lines + `+{m} more` rollup", () => {
    const data = card({
      changed: Array.from({ length: 10 }, (_, i) => entry({ id: `q${i}`, title: `T${i}` })),
    });
    const out = buildSubmissionCard(msg(data), collapsed, stubTheme);
    const ls = lines(out);
    expect(ls.filter((l) => /T\d+: sqlite → postgres/.test(l)).length).toBe(COLLAPSED_ENTRY_CAP);
    expect(ls.some((l) => l.includes("+2 more"))).toBe(true);
  });

  test("defensive: missing details, missing card, or sparse changed → no throw", () => {
    const content = "Submitted 2: q1: postgres\nConsider how these affect your other questions.";

    // No details at all → plain content text.
    const noDetails = buildSubmissionCard({ content }, collapsed, stubTheme);
    expect(noDetails).toBeInstanceOf(Text);
    expect(lines(noDetails).join("\n")).toBe(content);

    // details present but card missing → fallback too (also in expanded).
    const noCard = buildSubmissionCard({ content, details: {} }, expanded, stubTheme);
    expect(lines(noCard).join("\n")).toBe(content);

    // Sparse card: changed not an array → header + footer only, no crash.
    const sparse = buildSubmissionCard(
      msg(card({ changed: undefined as unknown as DiffEntry[] })),
      collapsed,
      stubTheme,
    );
    const sparseLines = lines(sparse);
    expect(sparseLines[0]).toContain("Submitted 0 changed");
    expect(sparseLines.some((l) => l.endsWith("3 remain open"))).toBe(true);
  });

  test("zero changes: header reads `Submitted 0 changed`, footer still renders", () => {
    const out = buildSubmissionCard(msg(card({ changed: [] })), collapsed, stubTheme);
    const ls = lines(out);
    expect(ls[0]).toContain("Submitted 0 changed");
    expect(ls.some((l) => l.endsWith("3 remain open"))).toBe(true);
  });

  test("outputPad is applied as the component's horizontal padding", () => {
    const out = buildSubmissionCard(msg(card({ changed: [] })), { expanded: false, outputPad: 2 }, stubTheme);
    // Un-trimmed first rendered line starts with the pad.
    expect(out.render(500)[0]?.startsWith("  ")).toBe(true);
  });
});

describe("registerSubmissionCardRenderer", () => {
  test("registers the exact customType and routes rendering through buildSubmissionCard", () => {
    const seen: Array<[string, (m: SubmissionCardMessage, o: CardRenderOptions, t: Theme) => unknown]> = [];
    const pi = {
      registerMessageRenderer: (customType: string, renderer: (typeof seen)[0][1]) => {
        seen.push([customType, renderer]);
      },
    } as unknown as Pick<ExtensionAPI, "registerMessageRenderer">;

    registerSubmissionCardRenderer(pi);

    expect(seen).toHaveLength(1);
    const [customType, renderer] = seen[0] as [string, (typeof seen)[0][1]];
    expect(customType).toBe("interrogation-submission");

    // The shim renders a real card payload through the pure builder.
    const out = renderer(msg(card()), collapsed, stubTheme) as TextLike;
    expect(lines(out)).toContainEqual(expect.stringContaining("Database: sqlite → postgres"));
  });
});

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
 * present/absent/empty, (d) expanded full submission (epoch footer), (e)
 * FULL-TRANSCRIPT-001 — user-authored input never truncated, capped, or
 * hidden in either mode: full entry/note text when collapsed, no entry
 * cap, dim full-prompt lines, row-safe " / " flattening, NOTES visible in
 * the collapsed recap, (f) defensive fallbacks (no details / no card /
 * sparse changed), (g) zero-changes card, plus the
 * registerSubmissionCardRenderer shim.
 *
 * P1.M7.T3.S2 appends: buildCompletionRecapCard (completion recap card,
 * AC-14) suite + its registration shim — same stub-theme patterns as
 * above. (The `interrogation-state` mirror entries have NO renderer —
 * they stay durable but invisible; see renderers.ts.)
 */
import { describe, expect, test } from "vitest";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { buildCompletion, type CompletionRecapEntry } from "./delivery.js";
import { computeDiff } from "./snapshots.js";
import { createInterrogationState } from "./state.js";
import {
  buildCompletionRecapCard,
  buildSubmissionCard,
  registerCompletionRecapRenderer,
  registerSubmissionCardRenderer,
  type CardRenderOptions,
  type CompletionRecapDetails,
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

  test("first answers never render the (unanswered) sentinel; clearances keep `→ (unanswered)`", () => {
    const data = card({
      changed: [
        entry({ from: "(unanswered)", to: "Alpha" }),
        entry({ id: "q2", title: "Cache", from: "none", to: "(unanswered)" }),
      ],
    });
    for (const opts of [collapsed, expanded]) {
      const ls = lines(buildSubmissionCard(msg(data), opts, stubTheme));
      // First-time answer: `{title}: {to}` alone — no arrow, no sentinel.
      expect(ls.some((l) => l.includes("Database: Alpha"))).toBe(true);
      // Clearance keeps the full form — it IS unanswered now (honest).
      expect(ls.some((l) => l.includes("Cache: none → (unanswered)"))).toBe(true);
      // The sentinel NEVER appears as a was-unanswered from-side label.
      expect(ls.some((l) => l.includes("(unanswered) →"))).toBe(false);
    }
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

  test("FULL-TRANSCRIPT-001: long entry line renders IN FULL when collapsed", () => {
    const data = card({ changed: [entry({ to: "y".repeat(200) })] });
    for (const opts of [collapsed, expanded]) {
      const out = buildSubmissionCard(msg(data), opts, stubTheme);
      const line = lines(out).find((l) => l.includes("Database:"));
      expect(line).toBeDefined();
      // The ENTIRE value survives in the default (collapsed) view — no
      // 80-column cut; the look-back record shows every word the model got.
      expect(line).toContain(`Database: sqlite → ${"y".repeat(200)}`);
    }
  });

  test("FULL-TRANSCRIPT-001: multi-line elaboration flattens row-safely, never truncates", () => {
    // A \n inside a card line would execute a real line feed and desync
    // the differential renderer (SANITIZE-001 lesson) — display-only
    // flatten to " / ", the model-visible grammar (BUG-006).
    const data = card({ changed: [entry({ to: "postgres — line one\nline two\n\nline three" })] });
    for (const opts of [collapsed, expanded]) {
      const ls = lines(buildSubmissionCard(msg(data), opts, stubTheme));
      expect(ls.some((l) => l.includes("postgres — line one / line two / line three"))).toBe(true);
      expect(ls.some((l) => l.includes("\n"))).toBe(false);
    }
  });

  test("WRITEIN-001: ✎ write-in entry renders IN FULL in both modes", () => {
    const longWriteIn = "✎ " + "w".repeat(200);

    // Collapsed (default): the FULL write-in text renders — never budget-cut.
    const collapsedOut = buildSubmissionCard(
      msg(card({ changed: [entry({ from: "SQLite", to: longWriteIn })] })),
      collapsed,
      stubTheme,
    );
    const line = lines(collapsedOut).find((l) => l.includes("Database:"));
    expect(line).toBeDefined();
    expect(line).toBe(`  Database: SQLite → ${longWriteIn}`);

    // Expanded: identical user-input content.
    const expandedOut = buildSubmissionCard(
      msg(card({ changed: [entry({ from: "SQLite", to: longWriteIn })] })),
      expanded,
      stubTheme,
    );
    expect(lines(expandedOut).some((l) => l.includes(longWriteIn))).toBe(true);
  });

  test("FULL-TRANSCRIPT-001: entry prompt renders as a dim indented line under the entry", () => {
    const data = card({
      changed: [
        entry({ prompt: "Which database engine should back the service?" }),
        entry({ id: "q2", title: "Cache", from: "none", to: "redis", prompt: "Cache?" }),
      ],
    });
    for (const opts of [collapsed, expanded]) {
      const ls = lines(buildSubmissionCard(msg(data), opts, stubTheme));
      // Full prompt text on its own deeper-indented line, both modes.
      expect(ls).toContainEqual("    Which database engine should back the service?");
      expect(ls).toContainEqual("    Cache?");
    }

    // Prompt is dim-styled (metadata tint; the user still reads every word).
    const tagged = lines(buildSubmissionCard(msg(data), collapsed, tagTheme));
    expect(tagged).toContainEqual("[dim]    Which database engine should back the service?[/]");
  });

  test("FULL-TRANSCRIPT-001: prompt line skipped when title already shows it (or key absent)", () => {
    // title === prompt (prompt-only question) and a legacy entry without
    // the key: the title line IS the full question — never duplicated.
    const data = card({
      changed: [entry({ title: "Which database?", prompt: "Which database?" }), entry()],
    });
    for (const opts of [collapsed, expanded]) {
      const ls = lines(buildSubmissionCard(msg(data), opts, stubTheme));
      expect(ls.filter((l) => l.includes("Which database?"))).toHaveLength(1);
    }
  });

  test("FULL-TRANSCRIPT-001: multi-line prompt flattens row-safely", () => {
    const data = card({ changed: [entry({ prompt: "line one\nline two" })] });
    const ls = lines(buildSubmissionCard(msg(data), collapsed, stubTheme));
    expect(ls).toContainEqual("    line one / line two");
    expect(ls.some((l) => l.includes("\n"))).toBe(false);
  });

  test("WRITEIN-001 end-to-end: custom answer flows answerSummary → computeDiff → card line", () => {
    const s = createInterrogationState("Plan the migration");
    s.upsertQuestion({
      id: "w1",
      prompt: "Wildcard",
      title: "Wildcard",
      type: "choice",
      rev: 1,
      status: "open",
      options: [{ value: "a", label: "Alpha" }],
    });
    s.applyAnswer("w1", { value: "a", at: "2025-01-01T00:00:00.000Z" });
    const prev = s.serialize();
    s.applyAnswer("w1", { value: "my own text", custom: true, at: "2025-01-01T00:00:00.000Z" });
    const data = computeDiff(prev, s.serialize());
    expect(data.changed[0]?.to).toBe("✎ my own text");
    const out = buildSubmissionCard(msg(data), collapsed, stubTheme);
    expect(lines(out).some((l) => l.includes("Wildcard: Alpha → ✎ my own text"))).toBe(true);
  });

  test("FULL-TRANSCRIPT-001: NO entry cap — every changed entry renders when collapsed", () => {
    const data = card({
      changed: Array.from({ length: 10 }, (_, i) => entry({ id: `q${i}`, title: `T${i}` })),
    });
    const out = buildSubmissionCard(msg(data), collapsed, stubTheme);
    const ls = lines(out);
    // ALL ten render — no `+{m} more` rollup hides what the user shipped.
    expect(ls.filter((l) => /T\d+: sqlite → postgres/.test(l)).length).toBe(10);
    expect(ls.some((l) => l.includes("more"))).toBe(false);
  });

  test("FULL-TRANSCRIPT-001: NOTE line renders IN FULL when collapsed (multi-line flattened)", () => {
    const longNote = "n".repeat(200);
    const data = card({ note: longNote, changed: [entry()] });
    const ls = lines(buildSubmissionCard(msg(data), collapsed, stubTheme));
    expect(ls.some((l) => l.includes(`NOTE: ${longNote}`))).toBe(true);

    const multi = card({ note: "first line\nsecond line" });
    const mls = lines(buildSubmissionCard(msg(multi), collapsed, stubTheme));
    expect(mls.some((l) => l.includes("NOTE: first line / second line"))).toBe(true);
    expect(mls.some((l) => l.includes("\n"))).toBe(false);
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

/* ══════════════════════════════════════════════════════════════════
 * P1.M7.T3.S2 — completion recap card + state mirror entry marker
 * ══════════════════════════════════════════════════════════════════ */

function recap(overrides: Partial<CompletionRecapEntry> = {}): CompletionRecapEntry {
  return { id: "q1", title: "Database", answer: "postgres", star: false, ...overrides };
}

function recapDetails(overrides: Partial<CompletionRecapDetails> = {}): CompletionRecapDetails {
  return {
    goal: "Choose a persistence stack",
    groups: [
      {
        group: "Storage",
        questions: [recap(), recap({ id: "q2", title: "Cache", answer: "redis", star: true })],
      },
      { group: "Process", questions: [recap({ id: "q3", title: "Runner", answer: "pm2" })] },
    ],
    notes: [],
    withdrawnMoot: [],
    completedAt: "2026-02-14T10:30:00.000Z",
    epoch: 7,
    ...overrides,
  };
}

describe("buildCompletionRecapCard", () => {
  test("collapsed (AC-14): goal header, every grouped question + answer, ★, completed footer, moot hint", () => {
    const d = recapDetails({ withdrawnMoot: [{ id: "q9", status: "withdrawn", reason: "superseded" }] });
    const ls = lines(buildCompletionRecapCard(d, collapsed, stubTheme, "FALLBACK"));
    expect(ls[0]).toContain("INTERROGATION COMPLETE — Choose a persistence stack");
    expect(ls).toContainEqual(expect.stringContaining("[Storage] q1 Database: postgres"));
    expect(ls).toContainEqual(expect.stringContaining("[Storage] q2 Cache: redis ★"));
    expect(ls).toContainEqual(expect.stringContaining("[Process] q3 Runner: pm2"));
    expect(ls.some((l) => l.startsWith("completed "))).toBe(true);
    expect(ls).toContainEqual("1 withdrawn/moot");
    // Reasons ship expanded-only: collapsed carries the count hint only.
    expect(ls.some((l) => l.includes("superseded"))).toBe(false);
  });

  test("★ renders only on starred answers, accent-styled", () => {
    const tagged = lines(buildCompletionRecapCard(recapDetails(), collapsed, tagTheme, ""));
    expect(tagged.filter((l) => l.includes("[accent]★[/]")).length).toBe(1);
    expect(tagged.some((l) => l.includes("q2 Cache: redis [accent]★[/]"))).toBe(true);
    expect(tagged.some((l) => l.includes("q1 Database: postgres"))).toBe(true);
    expect(tagged.some((l) => l.includes("q1 Database: postgres ★"))).toBe(false);
  });

  test("expanded: free-text in full, dim answeredAt, NOTES, withdrawn/moot reasons, epoch", () => {
    const longFree = "f".repeat(300);
    const d = recapDetails({
      groups: [
        { group: "Storage", questions: [recap({ freeText: longFree, answeredAt: "2026-02-14T09:00:00.000Z" })] },
      ],
      notes: ["prefer sqlite compat", "second batch note"],
      withdrawnMoot: [
        { id: "q8", status: "moot", reason: "answered by q1" },
        { id: "q9", status: "withdrawn", reason: "user request" },
      ],
    });
    const ls = lines(buildCompletionRecapCard(d, expanded, stubTheme, ""));
    expect(ls.some((l) => l.includes(longFree))).toBe(true); // untruncated
    expect(ls.some((l) => l.startsWith("  answered "))).toBe(true);
    expect(ls).toContainEqual(expect.stringContaining("NOTE: prefer sqlite compat"));
    expect(ls).toContainEqual(expect.stringContaining("NOTE: second batch note"));
    expect(ls.some((l) => l.includes("Withdrawn/moot:"))).toBe(true);
    expect(ls).toContainEqual(expect.stringContaining("q8 (moot: answered by q1)"));
    expect(ls).toContainEqual(expect.stringContaining("q9 (withdrawn: user request)"));
    expect(ls).toContainEqual("epoch 7");
    // The collapsed count hint is replaced by the full section.
    expect(ls.some((l) => /^\d+ withdrawn\/moot$/.test(l))).toBe(false);
  });

  test("expanded with nothing withdrawn/moot and no notes: `(none)` and no NOTE lines", () => {
    const ls = lines(buildCompletionRecapCard(recapDetails(), expanded, stubTheme, ""));
    expect(ls.some((l) => l.trim() === "(none)")).toBe(true);
    expect(ls.some((l) => l.includes("NOTE:"))).toBe(false);
  });

  test("FULL-TRANSCRIPT-001: long free-text renders IN FULL when collapsed", () => {
    const longFree = "f".repeat(300);
    const d = recapDetails({
      groups: [{ group: "Storage", questions: [recap({ freeText: longFree })] }],
    });
    for (const opts of [collapsed, expanded]) {
      const line = lines(buildCompletionRecapCard(d, opts, stubTheme, "")).find((l) =>
        l.includes("Database:"),
      );
      expect(line).toBeDefined();
      expect(line).toContain(`Database: postgres — ${longFree}`);
    }
  });

  test("FULL-TRANSCRIPT-001: multi-line free-text flattens row-safely in both modes", () => {
    const d = recapDetails({
      groups: [{ group: "Storage", questions: [recap({ freeText: "para one\npara two" })] }],
    });
    for (const opts of [collapsed, expanded]) {
      const ls = lines(buildCompletionRecapCard(d, opts, stubTheme, ""));
      expect(ls.some((l) => l.includes("postgres — para one / para two"))).toBe(true);
      expect(ls.some((l) => l.includes("\n"))).toBe(false);
    }
  });

  test("FULL-TRANSCRIPT-001: recap entry prompt renders dim-indented under the question line", () => {
    const d = recapDetails({
      groups: [
        {
          group: "Storage",
          questions: [recap({ prompt: "Which database engine should back the service?" })],
        },
      ],
    });
    for (const opts of [collapsed, expanded]) {
      const ls = lines(buildCompletionRecapCard(d, opts, stubTheme, ""));
      expect(ls).toContainEqual("  Which database engine should back the service?");
    }
    const tagged = lines(buildCompletionRecapCard(d, collapsed, tagTheme, ""));
    expect(tagged).toContainEqual("[dim]  Which database engine should back the service?[/]");
  });

  test("FULL-TRANSCRIPT-001: NOTES render when collapsed (user input is never mode-gated)", () => {
    const d = recapDetails({ notes: ["prefer sqlite compat", "second batch note"] });
    const ls = lines(buildCompletionRecapCard(d, collapsed, stubTheme, ""));
    expect(ls).toContainEqual(expect.stringContaining("NOTE: prefer sqlite compat"));
    expect(ls).toContainEqual(expect.stringContaining("NOTE: second batch note"));
  });

  test("WRITEIN-001: ✎ write-in recap entry renders IN FULL in both modes", () => {
    const longWriteIn = "✎ " + "w".repeat(200); // what completionAnswerSummary ships
    const d = recapDetails({
      groups: [
        { group: "Storage", questions: [recap({ id: "w1", title: "Wildcard", answer: longWriteIn })] },
      ],
    });
    for (const opts of [collapsed, expanded]) {
      const line = lines(buildCompletionRecapCard(d, opts, stubTheme, "")).find((l) =>
        l.includes("Wildcard:"),
      );
      expect(line).toBeDefined();
      expect(line).toContain(longWriteIn);
    }
  });

  test("WRITEIN-001 end-to-end: custom answer flows completionAnswerSummary → recap entry → card line", () => {
    const s = createInterrogationState("Plan the migration");
    s.upsertQuestion({
      id: "w1",
      prompt: "Wildcard",
      title: "Wildcard",
      type: "choice",
      rev: 1,
      status: "open",
      group: "G",
      options: [{ value: "a", label: "Alpha" }],
    });
    s.applyAnswer("w1", { value: "my own text", custom: true, at: "2025-01-01T00:00:00.000Z" });
    const msg = buildCompletion(s);
    const out = buildCompletionRecapCard(msg.details, expanded, stubTheme, "");
    expect(lines(out).some((l) => l.includes("[G] w1 Wildcard: ✎ my own text"))).toBe(true);
  });

  test("defensive: undefined details or empty groups → plain fallback content text", () => {
    const content = "Interrogation complete:\nq1: postgres\nq2: redis";

    const noDetails = buildCompletionRecapCard(undefined, collapsed, stubTheme, content);
    expect(noDetails).toBeInstanceOf(Text);
    expect(lines(noDetails).join("\n")).toBe(content);

    const emptyGroups = buildCompletionRecapCard(recapDetails({ groups: [] }), expanded, stubTheme, content);
    expect(lines(emptyGroups).join("\n")).toBe(content);
  });
});

describe("registerCompletionRecapRenderer", () => {
  test("registers the exact customType and routes through buildCompletionRecapCard", () => {
    const seen: Array<[string, (m: unknown, o: CardRenderOptions, t: Theme) => unknown]> = [];
    const pi = {
      registerMessageRenderer: (customType: string, renderer: (typeof seen)[0][1]) => {
        seen.push([customType, renderer]);
      },
    } as unknown as Pick<ExtensionAPI, "registerMessageRenderer">;

    registerCompletionRecapRenderer(pi);

    expect(seen).toHaveLength(1);
    const [customType, renderer] = seen[0] as [string, (typeof seen)[0][1]];
    expect(customType).toBe("interrogation-completion");

    // Real payload → card; sparse message → content fallback.
    const out = renderer({ content: "RAW", details: recapDetails() }, collapsed, stubTheme) as TextLike;
    expect(lines(out)[0]).toContain("INTERROGATION COMPLETE");
    const fb = renderer({ content: "RAW", details: undefined }, collapsed, stubTheme) as TextLike;
    expect(lines(fb).join("\n")).toBe("RAW");
  });
});

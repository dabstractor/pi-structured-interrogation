#!/usr/bin/env node
/**
 * scripts/demo-deep-selection.ts — candidate demos for a TTY-safe selection
 * marker in the interrogation panel's DEEP view (detailed answer view).
 *
 * Problem: deep-view selection is communicated ONLY by accent color + bold
 * on the selected section's title and ramification bars (D-R14,
 * spec/decisions.md). On a TTY where color renders wrongly there is no
 * character-level signal — the user cannot tell which answer is selected.
 * The short (compressed) view does not have this problem: its cursor row
 * swaps a two-space prefix for `▸ `.
 *
 * Run in your terminal to see the colored versions:
 *
 *     node scripts/demo-deep-selection.ts [width]
 *
 * OUTCOME (2026-10-04): variant 4 (▸ prefix + heavy ┃ bars) ADOPTED as
 * D-R14 amendment 9 — see spec/decisions.md. This script is kept as the
 * record of the considered alternatives.
 *
 * Each candidate renders the same deep-view excerpt three times:
 *   1. "color"     — exactly as a healthy terminal shows it (truecolor,
 *                    default dark theme values).
 *   2. "attrs"     — all color SGR codes stripped, text attributes kept
 *                    (bold/underline/inverse). This is the terminal D-R14
 *                    assumed when it locked "bold = no-color fallback".
 *   3. "plain"     — every SGR code stripped. Pure characters: worst-case
 *                    TTY. A selection that survives here satisfies the
 *                    "at least one character changes" requirement.
 *
 * Fixture: cursor (selection) sits on option 2 "Append-only JSONL spool";
 * the ★ recommendation sits on option 1 "SQLite staging table" — so the
 * demo shows selection and recommendation markers coexisting without
 * colliding. In the real panel the ✎ Other section receives the identical
 * marker when the cursor is on it (cursor index options.length).
 *
 * This script deliberately imports nothing from src/ (the panel graph is
 * heavy); layout mirrors src/panel/deep-view.ts: 2-col inset, 2-col right
 * margin, `│` bar at col 3 on every ramification row, trailing `Title ★`
 * (amendment 8), blank separator between sections (variation B),
 * description + ramification text full intensity.
 */
import { readFileSync } from "node:fs";
import { Theme, type ThemeBg, type ThemeColor } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

// ------------------------------------------------------------ theme (dark)

/** Default dark theme values, read from the installed pi package. */
function loadDarkTheme(): Theme {
  const url = new URL(
    "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/dark.json",
    import.meta.url,
  );
  const dark = JSON.parse(readFileSync(url, "utf8")) as {
    vars: Record<string, string>;
    colors: Record<string, string>;
  };
  const resolve = (c: string): string => dark.vars[c] ?? c;
  const fg: Partial<Record<ThemeColor, string>> = {};
  const bg: Partial<Record<ThemeBg, string>> = {};
  for (const [k, v] of Object.entries(dark.colors)) {
    if (k.endsWith("Bg")) bg[k as ThemeBg] = resolve(v);
    else fg[k as ThemeColor] = resolve(v);
  }
  return new Theme(
    fg as Record<ThemeColor, string>,
    bg as Record<ThemeBg, string>,
    "truecolor",
  );
}
const theme = loadDarkTheme();

// ------------------------------------------------------------- fixture

const GOAL =
  "Nightly ingest must never lose a record the API has already accepted, even when the enrichment step fails and the run retries.";

const DESCRIPTION =
  "Pick the durability mechanism for accepted-but-not-yet-enriched records. The choice trades operational simplicity against recovery guarantees: whatever sits between the API ack and the enrichment commit is the window where a crash can silently drop work.";

interface Opt {
  label: string;
  starred: boolean;
  ramification: string;
}

const OPTIONS: Opt[] = [
  {
    label: "SQLite staging table",
    starred: true,
    ramification:
      "Every accepted record lands in a local staging table inside the same transaction boundary as the API ack. A crashed run resumes by replaying the table, so nothing is lost and there is no new service to operate. The cost is coupling: the ingest process now owns a real database file, its migrations, and its backups.",
  },
  {
    label: "Append-only JSONL spool",
    starred: false,
    ramification:
      "Each accepted record is appended to a per-day JSONL file before the ack returns. Recovery is grep-able and auditable by humans, and no database runtime is involved. The cost is integrity: a half-written line after a crash needs a repair pass, and reads scale linearly with spool size.",
  },
  {
    label: "Redis stream",
    starred: false,
    ramification:
      "Records go into a Redis stream with consumer groups tracking enrichment progress; replays and monitoring come built in. The cost is a new stateful service in the critical path: if Redis is down the API cannot ack, and the data-loss policy becomes a Redis persistence configuration question.",
  },
];

/** Same string as deep-view.ts OTHER_RAMIFICATION (copied — see header). */
const OTHER_LABEL = "✎ Other — write your own";
const OTHER_RAMIFICATION =
  "None of the listed options fit — write your own answer; it ships as the official answer for this question, not as an attachment to one of them.";

/** Cursor position for the demo: option index 1 (JSONL spool). */
const CURSOR = 1;

// ---------------------------------------------------------- layout helpers

const INSET = "  ";
const RIGHT = 2;
const BAR = " │ ";
const HEAVY_BAR = " ┃ ";

/** Word-wrap to a visible-width budget (mirrors deep-view wrapText). */
function wrap(text: string, budget: number): string[] {
  const b = Math.max(1, budget);
  const words = text.split(" ").filter((w) => w !== "");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    if (visibleWidth(word) > b) {
      if (cur !== "") lines.push(cur);
      cur = "";
      lines.push(word.slice(0, Math.max(0, b - 1)) + "…");
      continue;
    }
    const cand = cur === "" ? word : `${cur} ${word}`;
    if (visibleWidth(cand) <= b) cur = cand;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines.length > 0 ? lines : [""];
}

// ------------------------------------------------------------ SGR filters

// eslint-disable-next-line no-control-regex -- the ANSI ESC byte (0x1b) IS the match target
const SGR = /\x1b\[[0-9;]*m/g;

/** True when an SGR parameter list sets fg/bg COLOR (not an attribute). */
function isColorSeq(params: string): boolean {
  if (params === "") return false;
  const codes = params.split(";").map(Number);
  return codes.some(
    (c) =>
      c === 38 || c === 48 || c === 39 || c === 49 ||
      (c >= 30 && c <= 37) || (c >= 40 && c <= 47) ||
      (c >= 90 && c <= 97) || (c >= 100 && c <= 107),
  );
}

/** Drop color codes, keep attributes (bold/underline/inverse/resets). */
function stripColors(s: string): string {
  return s.replace(SGR, (m) => {
    const params = m.slice(2, -1); // strip "\x1b[" and "m"
    return isColorSeq(params) ? "" : m;
  });
}

/** Drop every SGR code — the pure-character worst case. */
function stripAll(s: string): string {
  return s.replace(SGR, "");
}

// ------------------------------------------------------------- variants

/**
 * A candidate treatment. Everything is STRICTLY ADDITIVE to the current
 * accent+bold styling (v0) unless noted — the question is only which
 * character-level signal(s) to add.
 */
interface Variant {
  name: string;
  blurb: string;
  /** Column-0..1 prefix of a section header: selected vs not. */
  headPrefix: (selected: boolean) => string;
  /** Column-0..1 prefix of a ramification row: selected vs not. */
  ramPrefix: (selected: boolean) => string;
  /** The bar indent on ramification rows. */
  bar: (selected: boolean) => string;
  /** Title styling hook (v5 swaps accent+bold for inverse). */
  title: (selected: boolean, t: string) => string;
}

const accentBold = (t: string) => theme.bold(theme.fg("accent", t));
const primaryBar = (t: string) => theme.fg("text", t);

const VARIANTS: Variant[] = [
  {
    name: "0 — status quo (current code, D-R14)",
    blurb: "accent + bold on the selected title and its bars. No character changes.",
    headPrefix: () => "  ",
    ramPrefix: () => "  ",
    bar: (sel) => (sel ? accentBold(BAR) : primaryBar(BAR)),
    title: (sel, t) => (sel ? accentBold(t) : primaryBar(t)),
  },
  {
    name: "1 — ▸ cursor prefix on the selected header",
    blurb: "short-view parity: `▸ ` replaces the selected header's inset; others keep two spaces. Titles stay column-aligned.",
    headPrefix: (sel) => (sel ? "▸ " : "  "),
    ramPrefix: () => "  ",
    bar: (sel) => (sel ? accentBold(BAR) : primaryBar(BAR)),
    title: (sel, t) => (sel ? accentBold(t) : primaryBar(t)),
  },
  {
    name: "2 — ▌ rail down the whole selected section",
    blurb: "`▌` at column 0 on EVERY line of the selected section (header + ramification rows), not just the header.",
    headPrefix: (sel) => (sel ? "▌ " : "  "),
    ramPrefix: (sel) => (sel ? "▌ " : "  "),
    bar: (sel) => (sel ? accentBold(BAR) : primaryBar(BAR)),
    title: (sel, t) => (sel ? accentBold(t) : primaryBar(t)),
  },
  {
    name: "3 — heavy ┃ bars on the selected section",
    blurb: "the selected section's ramification pipes render `┃` instead of `│`; the header keeps color+bold only.",
    headPrefix: () => "  ",
    ramPrefix: () => "  ",
    bar: (sel) => (sel ? accentBold(HEAVY_BAR) : primaryBar(BAR)),
    title: (sel, t) => (sel ? accentBold(t) : primaryBar(t)),
  },
  {
    name: "4 — combo: ▸ prefix + heavy ┃ bars (1 + 3)",
    blurb: "header AND body of the selected section change characters; most redundant signal.",
    headPrefix: (sel) => (sel ? "▸ " : "  "),
    ramPrefix: () => "  ",
    bar: (sel) => (sel ? accentBold(HEAVY_BAR) : primaryBar(BAR)),
    title: (sel, t) => (sel ? accentBold(t) : primaryBar(t)),
  },
  {
    name: "5 — attribute-only: inverse-video title (no char change)",
    blurb: "theme.inverse() on the selected title. Shown for completeness: survives color loss, NOT attribute loss.",
    headPrefix: () => "  ",
    ramPrefix: () => "  ",
    bar: (sel) => (sel ? accentBold(BAR) : primaryBar(BAR)),
    title: (sel, t) => (sel ? theme.inverse(theme.fg("accent", t)) : primaryBar(t)),
  },
];

// --------------------------------------------------------------- render

function renderExcerpt(v: Variant, width: number): string[] {
  const budget = Math.max(1, width - INSET.length - RIGHT);
  const ramBudget = Math.max(1, budget - BAR.length);
  const lines: string[] = [];

  const pushBlock = (text: string, dim: boolean, indent = "") => {
    for (const ln of wrap(text, budget - visibleWidth(indent))) {
      const composed = `${INSET}${indent}${ln}`;
      lines.push(dim ? theme.fg("dim", composed) : composed);
    }
  };

  pushBlock(GOAL, true);
  lines.push("");
  pushBlock(DESCRIPTION, false);
  lines.push("");

  const section = (label: string, ram: string, selected: boolean, starred: boolean) => {
    const star = starred ? ` ${primaryBar("★")}` : "";
    lines.push(`${v.headPrefix(selected)}${v.title(selected, label)}${star}`);
    for (const ln of wrap(ram, ramBudget)) {
      lines.push(`${v.ramPrefix(selected)}${v.bar(selected)}${ln}`);
    }
    lines.push("");
  };

  OPTIONS.forEach((o, i) => section(o.label, o.ramification, i === CURSOR, o.starred));
  section(OTHER_LABEL, OTHER_RAMIFICATION, false, false);
  return lines;
}

// --------------------------------------------------------------- output

const width = Math.max(40, Number(process.argv[2] ?? 80));
const out = (s = "") => console.log(s);

out("══════════════════════════════════════════════════════════════════════");
out(`Deep-view selection-marker demos — width ${width}`);
out(`Selection (cursor) is on: "${OPTIONS[CURSOR]!.label}"   ★ recommendation: "${OPTIONS[0]!.label}"`);
out("In the real panel the ✎ Other row gets the identical marker when focused.");
out("Each variant: (a) full color, (b) colors stripped / attrs kept, (c) all SGR stripped.");
out("Only variants whose (b) AND (c) views still identify the selection are TTY-safe.");
out();

for (const v of VARIANTS) {
  const lines = renderExcerpt(v, width);
  out(`━━━ Variant ${v.name}`);
  out(`    ${v.blurb}`);
  out();
  for (const ln of lines) out(ln);
  out();
  out("    —— colors stripped, attributes kept (the TTY D-R14 assumed) ——");
  out();
  for (const ln of lines) out(stripColors(ln).trimEnd());
  out();
  out("    —— ALL SGR stripped (worst-case TTY: pure characters) ——");
  out();
  for (const ln of lines) out(stripAll(ln).trimEnd());
  out();
  out("══════════════════════════════════════════════════════════════════════");
  out();
}

out("Summary (does the selection survive?)");
out("  variant  chars change   color-loss  attr-loss   notes");
out("  0 quo    none           bold only   ✗           current behavior");
out("  1 ▸      header         ✓           ✓           matches short view + ui-spec text");
out("  2 ▌      whole section  ✓           ✓           marks body rows mid-scroll");
out("  3 ┃      ram rows       ✓           ✓           header itself stays color-only");
out("  4 ▸+┃    header + body  ✓           ✓           most redundant");
out("  5 inv    none           ✓           ✗           attribute channel only");

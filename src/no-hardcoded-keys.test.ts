/**
 * src/no-hardcoded-keys.test.ts — source-scan guard for R5/AC-12 (P1.M7.T5.S2).
 *
 * Machine-checked guarantee that NO runtime code hardcodes a key label: every
 * non-test `.ts` file under `src/` is scanned (comments stripped by a
 * string-aware scanner, `config.ts`'s DEFAULT_CONFIG block allowlisted) and
 * must contain zero string literals naming a config accelerator
 * (`ctrl+…`/`alt+…`/`super+…`) or the `shift+tab` binding. Display strings
 * must flow from `resolveKeyLabels(config)` (h2.52); dispatch must flow from
 * `resolveBindings`. Fixed keys (enter/esc/arrows/digits — h2.34, not in
 * `keys.*`) are deliberately NOT matched: rendered strings may name them.
 *
 * Allowlist: `config.ts`'s `DEFAULT_CONFIG` object literal — the one place a
 * key accelerator must exist. Its JSDoc (and all other comments) are stripped
 * before matching, so comment mentions never trip the guard — but they are
 * kept config-relative in reviews.
 *
 * Assumption: `src/` (non-test) contains no regex literals holding quote
 * characters, so a quote-aware scanner cannot mis-track lexical state. The
 * self-tests below pin the scanner's own behavior (planted literals fail,
 * comment-only mentions pass, interpolation is handled).
 *
 * Name: test_source_contains_no_hardcoded_key_labels (per PRP P1.M7.T5.S2
 * Task 3). Companion suite: config-surface.test.ts (behavioral AC-12 proof).
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const SRC_ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * A string literal STARTING with a modifier+ — i.e. a hardcoded accelerator.
 * ctrl is additionally matched ANYWHERE (see CTRL_ANYWHERE — stronger than
 * the quote-anchored form: catches " Ctrl+S"-style padding and mid-string
 * mentions); alt/super stay quote-anchored (unanchored /alt\+/ could hit
 * ordinary words ending in "alt").
 */
const MODIFIER_STRING = /["'`](?:\s*)(?:alt|super)\+/i;
/** Any "ctrl+<key>" text in scanneable code — hardcoded accelerators have no legitimate home outside DEFAULT_CONFIG. */
const CTRL_ANYWHERE = /ctrl\+[a-z0-9]/i;
/** The one non-obvious default binding, caught even mid-string. */
const SHIFT_TAB = /shift\+tab/i;

type Frame = '"' | "'" | "`" | "${";

/**
 * Blank out comment spans (// and /* … *\/) while PRESERVING string and
 * template literals — a `//` inside "https://…" or a `{}` inside a JSDoc
 * table must not corrupt the scan. Tracks a stack so template interpolations
 * (`` `…${ "ctrl+x" }…` ``) stay inside string context until their own
 * delimiter closes. Newlines are preserved so violation line numbers stay
 * accurate.
 */
function stripComments(src: string): string {
  const out: string[] = [];
  const stack: Frame[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const top = stack[stack.length - 1];
    if (top === undefined) {
      // Code context: comments are blanked, strings open frames.
      if (c === "/" && src[i + 1] === "/") {
        while (i < src.length && src[i] !== "\n") {
          out.push(" ");
          i += 1;
        }
        continue;
      }
      if (c === "/" && src[i + 1] === "*") {
        out.push("  ");
        i += 2;
        while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
          out.push(src[i] === "\n" ? "\n" : " ");
          i += 1;
        }
        if (i < src.length) {
          out.push("  ");
          i += 2;
        }
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        stack.push(c);
        out.push(c);
        i += 1;
        continue;
      }
      out.push(c);
      i += 1;
      continue;
    }
    // String / interpolation context — the stack top says which. Escapes
    // first; inside a ${…} interpolation, quotes AND backticks open nested
    // frames (nested templates hold quotes) and only a top-level `}` closes
    // the interpolation; inside a string, only its own delimiter (or ${ for
    // templates) changes state.
    if (c === "\\") {
      out.push(src.slice(i, i + 2));
      i += 2;
      continue;
    }
    if (top === "${") {
      if (c === "}") {
        stack.pop();
        out.push(c);
        i += 1;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        stack.push(c);
        out.push(c);
        i += 1;
        continue;
      }
      out.push(c);
      i += 1;
      continue;
    }
    if (c === top) {
      stack.pop();
      out.push(c);
      i += 1;
      continue;
    }
    if (top === "`" && c === "$" && src[i + 1] === "{") {
      stack.push("${");
      out.push("${");
      i += 2;
      continue;
    }
    out.push(c === "\n" ? "\n" : c);
    i += 1;
  }
  return out.join("");
}

/**
 * Blank config.ts's DEFAULT_CONFIG object literal — the sanctioned home of
 * every default accelerator. Runs on comment-stripped source; the block ends
 * at the first top-level `};` (column 0 — nested closings are indented).
 */
function blankDefaultConfigBlock(stripped: string): string {
  const start = stripped.indexOf("export const DEFAULT_CONFIG");
  if (start === -1) return stripped;
  const end = stripped.indexOf("\n};", start);
  if (end === -1) return stripped;
  return (
    stripped.slice(0, start) +
    stripped.slice(start, end + 3).replace(/[^\n]/g, " ") +
    stripped.slice(end + 3)
  );
}

/** Reduce a source file to its scan target: comments stripped, defaults allowlisted. */
function toScannable(fileName: string, source: string): string {
  const stripped = stripComments(source);
  return path.basename(fileName) === "config.ts" ? blankDefaultConfigBlock(stripped) : stripped;
}

function violationsIn(scannable: string): string[] {
  const found: string[] = [];
  for (const [name, re] of [
    ["hardcoded modifier string", MODIFIER_STRING],
    ["hardcoded ctrl+ key", CTRL_ANYWHERE],
    ["hardcoded shift+tab", SHIFT_TAB],
  ] as const) {
    const m = re.exec(scannable);
    if (m !== null) {
      const line = scannable.slice(0, m.index).split("\n").length;
      found.push(`${name} (line ${line}: ${JSON.stringify(m[0])})`);
    }
  }
  return found;
}

async function listSourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listSourceFiles(p)));
    else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("no-hardcoded-keys source guard (R5/AC-12)", () => {
  test("test_source_contains_no_hardcoded_key_labels", async () => {
    const files = await listSourceFiles(SRC_ROOT);
    expect(files.length).toBeGreaterThan(5); // sanity: the scan actually sees src/
    const problems: string[] = [];
    for (const file of files) {
      const found = violationsIn(toScannable(file, await fs.readFile(file, "utf8")));
      for (const v of found) problems.push(`${path.relative(SRC_ROOT, file)}: ${v}`);
    }
    expect(problems, "runtime code must never hardcode a key label (h2.52)").toEqual([]);
  });

  test("test_guard_scanner_flags_planted_hardcoded_labels", () => {
    // Planted runtime literals MUST be caught…
    expect(violationsIn(stripComments(`const k = "ctrl+s";`))).not.toEqual([]);
    expect(violationsIn(stripComments("const k = 'alt+p';"))).not.toEqual([]);
    expect(violationsIn(stripComments("const k = `super+space`;"))).not.toEqual([]);
    expect(violationsIn(stripComments(`const hint = "press shift+tab next";`))).not.toEqual([]);
    // …including case/whitespace variants a future edit might sneak in.
    expect(violationsIn(stripComments(`const k = " Ctrl+S";`))).not.toEqual([]);
  });

  test("test_guard_scanner_ignores_comments_and_resolves_strings", () => {
    // Comment mentions are tolerated by the guard (stripped before matching)…
    expect(violationsIn(stripComments(`// uses ctrl+s to submit\nconst x = 1;`))).toEqual([]);
    expect(violationsIn(stripComments(`/* default ctrl+shift+q */ const x = 1;`))).toEqual([]);
    // …but a comment AND a literal together still trip it…
    expect(violationsIn(stripComments(`// see below\nconst k = "ctrl+s";`))).not.toEqual([]);
    // …strings hide comment-lookalikes, URLs, braces…
    expect(violationsIn(stripComments(`const url = "https://x//path"; /* real */`))).toEqual([]);
    expect(violationsIn(stripComments(`const t = \`a {b} \` + "c"; // note ctrl+s`))).toEqual([]);
    // …and template interpolation re-enters string context correctly.
    expect(violationsIn(stripComments('const t = `${ x }`; // ctrl+s'))).toEqual([]);
    expect(violationsIn(stripComments('const t = `${ "ctrl+x" }`;'))).not.toEqual([]);
    // Nested templates (a template inside an interpolation, holding quotes)
    // must not desync the scanner — the regression this pin came from.
    expect(
      violationsIn(stripComments('const t = `a ${ cond ? `${x} ("q")` : "y" } b`; // ctrl+s')),
    ).toEqual([]);
  });

  test("test_guard_allowlists_only_the_default_config_block", () => {
    // The DEFAULT_CONFIG literal itself is the sanctioned home…
    const block = `export const DEFAULT_CONFIG: InterrogatorConfig = {\n  keys: {\n    deep: "ctrl+d",\n    nextQuestion: "shift+tab",\n  },\n  editorMode: "composed",\n};\nconst later = 1;`;
    const scannable = blankDefaultConfigBlock(stripComments(block));
    expect(violationsIn(scannable)).toEqual([]);
    // …but code AFTER the block is scanned again — an accidental sibling
    // literal would still fail (the allowlist is the block, not the file).
    const leaky = `export const DEFAULT_CONFIG = { keys: { deep: "ctrl+d" } };\nconst bad = "ctrl+e";`;
    expect(violationsIn(blankDefaultConfigBlock(stripComments(leaky)))).not.toEqual([]);
  });
});

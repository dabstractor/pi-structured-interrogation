/**
 * src/panel/sidechat-cache-isolation.test.ts — static guard for SIDECHAT-005
 * (h2.16, binding): the side chat NEVER touches the main conversation.
 *
 * Every non-test module in the side-chat cluster is scanned (comments
 * stripped by a string-aware scanner) and must contain zero references to a
 * model-context-mutating pi API: sendMessage, sendUserMessage, setActiveTools,
 * registerTool, setModel. Identifier references are matched (word-boundary)
 * so both `pi.sendMessage(...)` and ctx-borne destructured uses
 * (`const { sendMessage } = ctx`) trip the guard. The side-chat modules run
 * their LLM loop on an INJECTED nested-call seam (P1.M1.T5.S1) precisely so
 * these APIs are never needed — there is NO legitimate use; a hit is always
 * a contract violation. The only sanctioned entry to the main conversation
 * is the answer-apply path through the ordinary seams (acceptOptionIndex /
 * write-in commit, P1.M2.T6.S1).
 *
 * Anatomy cloned from src/no-hardcoded-keys.test.ts (deliberately COPIED,
 * not imported — each guard owns its scanner so the two evolve
 * independently): stripComments blanks `//` and `/* … *\/` spans with
 * newlines PRESERVED (accurate violation line numbers) while tracking a
 * frame stack over `" ' ` ${"` so strings, template literals, interpolations,
 * URLs, and escapes never desync the scan. STRING CONTENTS ARE PRESERVED —
 * a banned name inside a live prompt string is still a violation surface to
 * review (the carve-out policy below covers any future false positive).
 *
 * File set is TARGETED — the side-chat cluster only, never repo-wide: every
 * other module (index.ts, delivery.ts, …) legitimately uses sendMessage.
 *
 * Carve-out policy: none exists today and none is expected. If one becomes
 * genuinely necessary, mirror no-hardcoded-keys' blankDefaultConfigBlock
 * shape — a narrow line-bounded blanking helper with a comment documenting
 * WHY, plus a self-test proving the carve-out is the block, not the file.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const PANEL_ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * The side-chat cluster: store/lifecycle, render module, nested LLM loop,
 * system-prompt builder, and the frozen branch-snapshot pipeline —
 * enumerated explicitly (TARGETED, not repo-wide) with `.test.ts` excluded.
 * Grow this list when the cluster grows a non-test helper module.
 */
const SIDECHAT_FILES = [
  "sidechat.ts",
  "chat-view.ts",
  "sidechat-engine.ts",
  "sidechat-prompt.ts",
  "branch-snapshot.ts",
] as const;

/**
 * SIDECHAT-005 (h2.16, binding): the side chat NEVER touches the main
 * conversation. These identifiers are the model-context-mutating ExtensionAPI
 * surface; an identifier reference catches both `pi.sendMessage(...)` and
 * ctx-borne destructured uses (`const { sendMessage } = ctx`). The side-chat
 * modules run their LLM loop on an injected nested-call seam — there is NO
 * legitimate use; a hit is always a contract violation.
 */
const BANNED_API = [
  "sendMessage",
  "sendUserMessage",
  "setActiveTools",
  "registerTool",
  "setModel",
] as const;

type Frame = '"' | "'" | "`" | "${";

/**
 * Blank out comment spans (// and /* … *\/) while PRESERVING string and
 * template literals — a `//` inside "https://…" or a `{}` inside a JSDoc
 * table must not corrupt the scan. Tracks a stack so template interpolations
 * (`` `…${ "x" }…` ``) stay inside string context until their own delimiter
 * closes. Newlines are preserved so violation line numbers stay accurate.
 * (Cloned verbatim from src/no-hardcoded-keys.test.ts — see module docblock.)
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
 * Word-boundary, per-name scan over comment-stripped source with line
 * numbers computed from the stripped text. `\b` is required: substring
 * matching would flag longer identifiers (registerToolbar-style).
 */
function violationsIn(stripped: string): string[] {
  const problems: string[] = [];
  for (const name of BANNED_API) {
    const re = new RegExp(`\\b${name}\\b`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null) {
      const line = stripped.slice(0, m.index).split("\n").length;
      problems.push(
        `line ${line}: banned identifier '${name}' (SIDECHAT-005: side chat must not touch the main conversation)`,
      );
    }
  }
  return problems;
}

describe("side-chat cache-isolation guard (SIDECHAT-005, h2.16)", () => {
  test("test_sidechat_cluster_touches_no_main_conversation_api", async () => {
    const files = SIDECHAT_FILES.map((f) => path.join(PANEL_ROOT, f));
    // Sanity: every enumerated cluster module actually exists (a rename must
    // update this list, not silently shrink the scan).
    for (const file of files) {
      await expect(fs.access(file)).resolves.toBeUndefined();
    }
    expect(files.length).toBeGreaterThan(1); // the scan actually sees the cluster

    const problems: string[] = [];
    for (const file of files) {
      const stripped = stripComments(await fs.readFile(file, "utf8"));
      for (const v of violationsIn(stripped)) {
        problems.push(`${path.relative(PANEL_ROOT, file)}: ${v}`);
      }
    }
    expect(
      problems,
      "the side chat must never touch the main conversation (h2.16, SIDECHAT-005)",
    ).toEqual([]);
  });

  test("test_guard_flags_banned_identifiers_in_all_access_shapes", () => {
    // pi.*-style, destructured, and property call — identifier matching
    // covers every access shape, for EACH of the five banned names.
    for (const name of BANNED_API) {
      expect(violationsIn(stripComments(`await pi.${name}(m);`))).not.toEqual([]);
      expect(violationsIn(stripComments(`const { ${name} } = ctx;`))).not.toEqual([]);
      expect(violationsIn(stripComments(`runtime.${name}(id);`))).not.toEqual([]);
    }
    // Word boundaries: longer identifiers sharing a prefix are NOT hits.
    expect(violationsIn(stripComments(`registerToolbar(t); sendUserMessageLater();`))).toEqual([]);
  });

  test("test_guard_ignores_comment_only_mentions", () => {
    // Comment mentions never trip the guard (stripped before matching)…
    expect(violationsIn(stripComments(`// sendMessage would be wrong here\nconst x = 1;`))).toEqual(
      [],
    );
    expect(violationsIn(stripComments(`/* registerTool note */ const y = 2;`))).toEqual([]);
    // …but a comment AND a planted use together still trips.
    expect(
      violationsIn(stripComments(`// never do this\nawait pi.sendMessage(m);`)),
    ).not.toEqual([]);
  });

  test("test_scanner_stays_string_and_template_aware", () => {
    // URLs with // inside strings must not open a phantom comment…
    expect(violationsIn(stripComments(`const url = "https://x//path";`))).toEqual([]);
    // …nested templates (a template inside an interpolation, holding quotes)
    // must not desync the scanner…
    expect(
      violationsIn(stripComments('const t = `a ${ cond ? `${x} ("q")` : "y" } b`;')),
    ).toEqual([]);
    // …a banned name in a plain comment-adjacent string is still scanned
    // (string contents are preserved — a prompt embedding "sendMessage" is
    // a review surface), so it TRIPS…
    expect(
      violationsIn(stripComments('const hint = "use sendMessage to surface this";')),
    ).not.toEqual([]);
    // …including from inside a live template interpolation.
    expect(violationsIn(stripComments("const t = `see ${name}: registerTool`;"))).not.toEqual([]);
  });
});

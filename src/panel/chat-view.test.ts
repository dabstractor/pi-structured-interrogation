/**
 * Unit tests for src/panel/chat-view.ts (SIDECHAT-001, P1.M2.T1.S1).
 *
 * Pure-function tests, deep-view.test.ts pattern: byte-exact line arrays,
 * identity fixtures, no mocks, no panel/pi runtime. Labels flow only from
 * the resolvedKeys argument; the keymap-guard completeness list gains
 * nothing (hjkl/…-style fixed keys are not config surface and the chat
 * binding label is always read from the argument).
 */
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, test } from "vitest";
import { DEFAULT_CONFIG } from "../config.js";
import * as fs from "node:fs";
import {
  CHAT_VIEW_HEIGHT,
  buildChatContent,
  clampChatScroll,
  type ChatViewQuestion,
} from "./chat-view";
import type { ChatMessage } from "./sidechat";

const Q: ChatViewQuestion = { id: "q3", prompt: "Which database should we use?" };

function msg(role: ChatMessage["role"], text: string): ChatMessage {
  return { role, text, at: "2025-01-01T00:00:00.000Z" };
}

function view(
  messages: ChatMessage[],
  streamState: "idle" | "streaming" = "idle",
): { messages: ChatMessage[]; streamState: "idle" | "streaming" } {
  return { messages, streamState };
}

const keys = DEFAULT_CONFIG.keys;

describe("chat-view layout", () => {
  test("layout_exactness_default_budget", () => {
    const lines = buildChatContent(
      80,
      40,
      view([msg("user", "Should we use transactions?"), msg("assistant", "Yes.")]),
      Q,
      keys,
    );
    expect(lines).toEqual([
      "  chat · q3 — Which database should we use?",
      "  you › Should we use transactions?",
      "  Yes.",
      "",
      "enter send · /clear · esc exit",
    ]);
  });

  test("header_truncates_long_prompt", () => {
    const long: ChatViewQuestion = { id: "q3", prompt: "P".repeat(300) };
    const lines = buildChatContent(80, 40, view([]), long, keys);
    expect(lines[0]).toContain("chat · q3 — ");
    expect(visibleWidth(lines[0]!)).toBeLessThanOrEqual(80);
    expect(lines[0]).toContain("…"); // truncateVisible adornment
  });

  test("user_prefix_and_plain_assistant", () => {
    const lines = buildChatContent(
      40,
      40,
      view([msg("user", "a long user message that must wrap across several rendered lines"), msg("assistant", "assistant reply body")]),
      Q,
      keys,
    );
    const userLines = lines.filter((l) => l.includes("you › "));
    expect(userLines).toHaveLength(1); // prefix on the FIRST row only
    expect(lines[1]).toMatch(/^  you › /);
    // Continuations hang-indent under the prefix, assistant lines plain.
    const body = lines.slice(1, lines.length - 2);
    for (const line of body.slice(1)) {
      expect(line.startsWith("  you › ")).toBe(false);
      expect(visibleWidth(line)).toBeLessThanOrEqual(40); // never exceeds the width
    }
    expect(visibleWidth(body[0]!)).toBeLessThanOrEqual(40);
    expect(body.at(-1)).toBe("  assistant reply body"); // plain — no prefix
  });

  test("streaming_cursor", () => {
    const assistantTail = buildChatContent(
      80,
      40,
      view([msg("user", "q"), msg("assistant", "reply")], "streaming"),
      Q,
      keys,
    );
    expect(assistantTail[2]).toBe("  reply▌"); // trailing cursor on the last line

    const userTail = buildChatContent(80, 40, view([msg("user", "q")], "streaming"), Q, keys);
    expect(userTail[userTail.length - 3]).toBe("  ▌"); // standalone cursor row (before blank+footer)

    const idle = buildChatContent(80, 40, view([msg("assistant", "reply")], "idle"), Q, keys);
    expect(idle.join("\n")).not.toContain("▌"); // idle: no cursor anywhere
  });

  test("window_cap_and_tail_pin", () => {
    const many = Array.from({ length: 25 }, (_, i) => msg("user", `m${i}`));
    const lines = buildChatContent(80, 40, view(many), Q, keys);
    // header + 20 window lines + blank + footer; the window is the LAST 20.
    expect(lines).toHaveLength(1 + CHAT_VIEW_HEIGHT + 1 + 1);
    expect(lines[1]).toBe("  you › m5"); // head lines 0-4 dropped — tail-pinned
    expect(lines[CHAT_VIEW_HEIGHT]).toBe("  you › m24"); // newest visible

    expect(clampChatScroll(25, -5)).toBe(0); // negative → head
    expect(clampChatScroll(25, 999)).toBe(5); // past end → tail (newest visible)
    expect(clampChatScroll(5, 999)).toBe(0); // short transcript: no scroll range
  });

  test("footer_esc_word_variants", () => {
    const idle = buildChatContent(80, 40, view([]), Q, keys);
    expect(idle.at(-1)).toContain("esc exit");
    const streaming = buildChatContent(80, 40, view([], "streaming"), Q, keys);
    expect(streaming.at(-1)).toContain("esc abort");
    expect(streaming.at(-1)).not.toContain("exit");
  });

  test("footer_names_binding_when_remapped", () => {
    const remapped = { ...keys, chat: "x" };
    const lines = buildChatContent(80, 40, view([]), Q, remapped);
    expect(lines.at(-1)).toContain("x opens the chat on q3");

    const def = buildChatContent(80, 40, view([]), Q, keys);
    expect(def.at(-1)).not.toContain("opens the chat on"); // default footer has no clause
  });

  test("narrow_degradation", () => {
    const lines = buildChatContent(50, 40, view([]), Q, { ...keys, chat: "x" });
    const footer = lines.at(-1)!;
    expect(footer).toBe("enter send · esc exit"); // /clear gone, statics survive
    expect(footer).not.toContain("opens the chat on"); // binding-name dropped next
  });

  test("hint_suppress_and_tiny_rows", () => {
    const suppressed = buildChatContent(80, 20, view([]), Q, keys);
    expect(suppressed.at(-1)).toBe("esc exit"); // statics suppressed, safety word alone

    const many = Array.from({ length: 30 }, (_, i) => msg("user", `m${i}`));
    const tiny = buildChatContent(80, 10, view(many), Q, keys);
    expect(tiny.at(-1)).toBe("esc exit");
    const windowLines = tiny.length - 3; // minus header, blank, footer
    expect(windowLines).toBeLessThanOrEqual(6); // max(1, rows - 4)
    expect(tiny[1]).toBe("  you › m24"); // still tail-pinned in the tiny window
  });
});

describe("chat-view module hygiene", () => {
  test("chat-view.ts imports only local render modules (pure — no panel/pi runtime)", () => {
    const src = fs.readFileSync(new URL("./chat-view.ts", import.meta.url), "utf8");
    const importLines = src.split("\n").filter((l) => l.startsWith("import"));
    expect(importLines).toHaveLength(6);
    expect(importLines).toContain('import { visibleWidth } from "@earendil-works/pi-tui";');
    const localImports = importLines.filter((l) => !l.includes("@earendil-works"));
    expect(localImports).toHaveLength(5);
    for (const line of localImports) {
      expect(line).toMatch(
        /^import (?:type )?\{.*\} from "\.\.\/config\.js"|"\.\/(deep-view|layout|sidechat|terminal-budget)\.js";$/s,
      );
    }
    expect(src).not.toContain("panel.js");
    expect(src).not.toContain("@earendil-works/pi-coding-agent");
  });
});

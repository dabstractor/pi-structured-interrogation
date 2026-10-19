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
  ANSWER_REJECTION_NOTICES,
  CHAT_VIEW_HEIGHT,
  buildChatContent,
  clampChatScroll,
  type ChatViewQuestion,
  type ChatViewState,
} from "./chat-view";
import type { AnswerBlockRejection, ChatMessage, SidechatNotice } from "./sidechat";

const Q: ChatViewQuestion = { id: "q3", prompt: "Which database should we use?" };

function msg(role: ChatMessage["role"], text: string): ChatMessage {
  return { role, text, at: "2025-01-01T00:00:00.000Z" };
}

function view(
  messages: ChatMessage[],
  streamState: "idle" | "streaming" = "idle",
  extra: Partial<ChatViewState> = {},
): ChatViewState {
  return {
    messages,
    streamState,
    notices: [],
    modelSnapshot: { provider: "side", modelId: "side-model" }, // non-empty: no inert banner
    ...extra,
  };
}

function notice(text: string, kind: SidechatNotice["kind"] = "error"): SidechatNotice {
  return { kind, text, at: "2025-01-01T00:00:00.000Z" };
}

const Q_OPTS: ChatViewQuestion = {
  id: "q3",
  prompt: "Which database should we use?",
  options: [{ value: "postgres" }, { value: "sqlite" }], // display order
};

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
      "/clear",
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
    expect(lines[1]).toMatch(/^ {2}you › /);
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

  test("footer_is_state_invariant_clear_only (FOOTER-001)", () => {
    const idle = buildChatContent(80, 40, view([]), Q, keys);
    expect(idle.at(-1)).toBe("/clear");
    const streaming = buildChatContent(80, 40, view([], "streaming"), Q, keys);
    expect(streaming.at(-1)).toBe("/clear"); // no enter-send, no esc wording
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
    expect(footer).toBe("/clear"); // /clear never drops (FOOTER-001)
    expect(footer).not.toContain("opens the chat on"); // binding-name dropped first
  });

  test("hint_suppress_and_tiny_rows", () => {
    const suppressed = buildChatContent(80, 20, view([]), Q, keys);
    expect(suppressed.at(-1)).toBe("/clear"); // /clear survives hint suppression

    const many = Array.from({ length: 30 }, (_, i) => msg("user", `m${i}`));
    const tiny = buildChatContent(80, 10, view(many), Q, keys);
    expect(tiny.at(-1)).toBe("/clear");
    const windowLines = tiny.length - 3; // minus header, blank, footer
    expect(windowLines).toBeLessThanOrEqual(6); // max(1, rows - 4)
    expect(tiny[1]).toBe("  you › m24"); // still tail-pinned in the tiny window
  });
});

// ------------------------------------------- extras: notices / confirm / inert (P1.M2.T1.S2)

describe("chat-view extras — engine notice row (latest wins)", () => {
  test("latest_notice_renders_one_row_above_padding_older_notice_absent", () => {
    const lines = buildChatContent(
      80,
      40,
      view([], "idle", {
        notices: [notice("older auth failure"), notice("newest dispatch failure")],
      }),
      Q,
      keys,
    );
    expect(lines[lines.length - 3]).toBe("  ! newest dispatch failure"); // above blank+footer
    expect(lines.join("\n")).not.toContain("older auth failure"); // latest-wins, not a stack
    expect(lines[lines.length - 2]).toBe(""); // the locked padding line stays BELOW the row
  });

  test("no_notices_no_row", () => {
    const lines = buildChatContent(80, 40, view([]), Q, keys);
    expect(lines.some((l) => l.startsWith("  ! "))).toBe(false);
  });

  test("notice_row_drops_under_narrow_budget_before_footer_statics_shrink", () => {
    const lines = buildChatContent(
      50,
      40,
      view([], "idle", { notices: [notice("auth failed")] }),
      Q,
      keys,
    );
    expect(lines.some((l) => l.startsWith("  ! "))).toBe(false); // notice gone
    expect(lines.at(-1)).toBe("/clear"); // footer survives (drop AFTER the notice)
  });
});

describe("chat-view extras — answer-block rejection row", () => {
  test("all_five_reasons_render_their_byte_exact_notice_row", () => {
    for (const reason of Object.keys(ANSWER_REJECTION_NOTICES) as AnswerBlockRejection[]) {
      const lines = buildChatContent(200, 40, view([], "idle", { lastRejection: reason }), Q, keys);
      expect(lines[lines.length - 3]).toBe(`  ! ${ANSWER_REJECTION_NOTICES[reason]}`);
      expect(lines[lines.length - 2]).toBe("");
    }
  });

  test("mutually_exclusive_with_pendingConfirm — confirm wins, rejection never renders", () => {
    const lines = buildChatContent(
      80,
      40,
      view([], "idle", {
        pendingConfirm: { seam: "acceptOptionIndex", optionIndex: 0 },
        lastRejection: "no-block", // unreachable via the one-write settle, defensive
      }),
      Q_OPTS,
      keys,
    );
    expect(lines.at(-1)).toBe("apply ★ postgres? · enter = yes · esc = no");
    expect(lines.join("\n")).not.toContain("  ! ");
  });

  test("rejection_outlives_the_engine_notice_row_under_squeeze", () => {
    const lines = buildChatContent(
      50,
      40,
      view([], "idle", {
        lastRejection: "malformed-json",
        notices: [notice("auth failed")],
      }),
      Q,
      keys,
    );
    // Narrow width (50): the rejection row SURVIVES (truncated to fit) while
    // the engine-notice row is gone — the rejection drops last.
    expect(lines[lines.length - 3]).toMatch(/^ {2}! answer block is not valid JSON/);
    expect(lines[lines.length - 3]).toContain("…"); // width-truncated, still present
    expect(lines.join("\n")).not.toContain("auth failed"); // the notice dropped first
  });
});

describe("chat-view extras — answer confirm row (replaces the footer)", () => {
  test("option_preview_byte_exact_and_footer_hints_gone", () => {
    const lines = buildChatContent(
      80,
      40,
      view([], "idle", { pendingConfirm: { seam: "acceptOptionIndex", optionIndex: 1 } }),
      Q_OPTS,
      keys,
    );
    expect(lines.at(-1)).toBe("apply ★ sqlite? · enter = yes · esc = no"); // display order
    expect(lines.join("\n")).not.toContain("enter send"); // REPLACES the hints, never stacks
    expect(lines[lines.length - 2]).toBe(""); // locked padding rule intact
  });

  test("writeIn_preview_verbatim_and_truncated_to_width", () => {
    const long = "x".repeat(100);
    const lines = buildChatContent(
      40,
      40,
      view([], "idle", { pendingConfirm: { seam: "writeIn", text: long } }),
      Q,
      keys,
    );
    const footer = lines.at(-1)!;
    expect(footer.startsWith("apply ★ ")).toBe(true);
    expect(footer.endsWith("? · enter = yes · esc = no")).toBe(true);
    expect(footer).toContain("…"); // truncateVisible adornment
    expect(visibleWidth(footer)).toBeLessThanOrEqual(40);
    expect(footer).not.toContain(long); // actually truncated
  });

  test("oob_optionIndex_falls_back_to_hash_index_never_crashes", () => {
    const lines = buildChatContent(
      80,
      40,
      view([], "idle", { pendingConfirm: { seam: "acceptOptionIndex", optionIndex: 7 } }),
      Q_OPTS,
      keys,
    );
    expect(lines.at(-1)).toBe("apply ★ #7? · enter = yes · esc = no");
  });

  test("confirm_row_never_degrades_away_under_tiny_rows", () => {
    const lines = buildChatContent(
      80,
      10,
      view([], "idle", { pendingConfirm: { seam: "acceptOptionIndex", optionIndex: 0 } }),
      Q_OPTS,
      keys,
    );
    expect(lines.at(-1)).toBe("apply ★ postgres? · enter = yes · esc = no"); // sole footer line
    expect(lines[0]).toContain("chat · q3"); // header survived
  });
});

describe("chat-view extras — inert no-model banner", () => {
  test("banner_under_header_even_with_empty_transcript", () => {
    // Width 100: the pinned banner text (84 cols + 2 inset) fits byte-exact.
    const lines = buildChatContent(
      100,
      40,
      view([], "idle", { modelSnapshot: { provider: "", modelId: "" } }),
      Q,
      keys,
    );
    expect(lines[0]).toContain("chat · q3");
    expect(lines[1]).toBe(
      "  no side chat model available — check sideChatModel in your config and provider auth",
    );
    expect(lines).toHaveLength(4); // header + banner + blank + footer (empty transcript)

    // Narrow terminal: the banner STILL renders (state, never drops),
    // truncated to fit.
    const narrow = buildChatContent(
      40,
      40,
      view([], "idle", { modelSnapshot: { provider: "", modelId: "" } }),
      Q,
      keys,
    );
    expect(narrow[1]).toMatch(/^ {2}no side chat model available — check.*…$/);
    expect(visibleWidth(narrow[1]!)).toBeLessThanOrEqual(40);
  });

  test("no_banner_when_provider_present", () => {
    const lines = buildChatContent(80, 40, view([]), Q, keys); // default fixture has a provider
    expect(lines.join("\n")).not.toContain("no side chat model available");
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

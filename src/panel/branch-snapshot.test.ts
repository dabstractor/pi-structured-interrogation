/**
 * src/panel/branch-snapshot.test.ts — unit tests for the SIDECHAT-003
 * one-shot branch snapshot (P1.M1.T4.S1): entry-type filtering (pi's own
 * context projection — flatMap everything, the helper IS the filter),
 * root→leaf path order, the null-content defensive patch, shallow freeze +
 * purity, and the never-re-read identity pin through the landed store
 * (openOrReplace's once-per-creation guarantee). The session manager is a
 * plain-object fake over an in-memory entries array — no real
 * SessionManager, no session writes, no I/O.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Message } from "@earendil-works/pi-ai";
import type {
  SessionEntry,
  SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";
import { takeBranchSnapshot, type BranchSnapshotMessages } from "./branch-snapshot.js";
import { openOrReplace, resetSidechatForTests, type SidechatRebindDeps } from "./sidechat.js";

const T0_ISO = "2025-01-01T00:00:00.000Z"; // entry timestamps are ISO strings

/** SessionEntryBase fields (type/id/parentId/timestamp) for the entry under construction. */
function entryBase(id: string, parentId: string | null) {
  return { id, parentId, timestamp: T0_ISO };
}

/** User message fixture — string content, epoch timestamp (pi-ai message shape). */
function userMessage(text: string) {
  return { role: "user" as const, content: text, timestamp: 0 };
}

/** Minimal but type-valid AssistantMessage fixture. */
function assistantMessage(text: string) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-fixture",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop" as const,
    timestamp: 0,
  };
}

/** Minimal but type-valid ToolResultMessage fixture. */
function toolResultMessage(text: string) {
  return {
    role: "toolResult" as const,
    toolCallId: "call-1",
    toolName: "fixture-tool",
    content: [{ type: "text" as const, text }],
    isError: false,
    timestamp: 0,
  };
}

/** Message entry carrying a hand-edited null content (the parsed-without-validation case). */
function nullContentUserEntry(id: string, parentId: string | null): SessionEntry {
  const message = { role: "user", content: null, timestamp: 0 } as unknown as SessionMessageEntry["message"];
  return { ...entryBase(id, parentId), type: "message", message };
}

/**
 * The mixed e1..e11 branch, each entry parented on the previous so the
 * root→leaf path order is meaningful: [model_change, user message,
 * custom(plain), custom_message, assistant message, compaction, label,
 * session_info, thinking_level_change, msg(null content), toolResult message].
 */
function buildBranch(): SessionEntry[] {
  return [
    { ...entryBase("e1", null), type: "model_change", provider: "anthropic", modelId: "claude-fixture" },
    { ...entryBase("e2", "e1"), type: "message", message: userMessage("hello there") },
    { ...entryBase("e3", "e2"), type: "custom", customType: "state-sync", data: { n: 1 } },
    { ...entryBase("e4", "e3"), type: "custom_message", customType: "ext-note", content: "extension says hi", display: true },
    { ...entryBase("e5", "e4"), type: "message", message: assistantMessage("I can help") },
    { ...entryBase("e6", "e5"), type: "compaction", summary: "compacted summary text", firstKeptEntryId: "e4", tokensBefore: 1000 },
    { ...entryBase("e7", "e6"), type: "label", targetId: "e2", label: "checkpoint" },
    { ...entryBase("e8", "e7"), type: "session_info", name: "fixture session" },
    { ...entryBase("e9", "e8"), type: "thinking_level_change", thinkingLevel: "high" },
    nullContentUserEntry("e10", "e9"),
    { ...entryBase("e11", "e10"), type: "message", message: toolResultMessage("tool output text") },
  ];
}

/** Text projection: message content as plain text, in order (string or text blocks). */
function texts(messages: readonly Message[]): string[] {
  return messages.map((m) => {
    if (typeof m.content === "string") return m.content;
    return m.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
  });
}

beforeEach(() => {
  resetSidechatForTests();
});

describe("takeBranchSnapshot — SIDECHAT-003 one-shot branch replay (P1.M1.T4.S1)", () => {
  test("mixed branch: only conversation-bearing entries survive, path order preserved", () => {
    const result = takeBranchSnapshot({ getBranch: () => buildBranch() });

    // Exactly the six conversation-bearing contributions, ROOT→LEAF:
    // e2 user, e4 custom_message, e5 assistant, e6 compaction, e10 null user, e11 toolResult.
    expect(result).toHaveLength(6); // model_change/custom/label/session_info/thinking_level_change contribute NOTHING
    expect(result.map((m) => m.role)).toEqual(["user", "user", "assistant", "user", "user", "toolResult"]);
    const t = texts(result);
    expect(t[0]).toBe("hello there"); // real message survives verbatim
    expect(t[1]).toBe("extension says hi"); // custom_message → user message (convertToLlm)
    expect(t[2]).toBe("I can help"); // real assistant message survives verbatim
    expect(t[3]).toContain("compacted summary text"); // compaction summary rides as user text
    expect(t[4]).toBe(""); // null-content patch → content []
    expect(t[5]).toBe("tool output text"); // toolResult message survives verbatim
  });

  test("null-content user message is patched to content [] (pi's defensive guard)", () => {
    const entries: SessionEntry[] = [nullContentUserEntry("e1", null)];
    const result = takeBranchSnapshot({ getBranch: () => entries });
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toEqual([]);
  });

  test("empty branch → frozen []", () => {
    const result = takeBranchSnapshot({ getBranch: () => [] });
    expect(result).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test("shallow-frozen and pure: two calls deep-equal with distinct references", () => {
    const fake = { getBranch: () => buildBranch() };
    const a = takeBranchSnapshot(fake);
    const b = takeBranchSnapshot(fake);
    expect(Object.isFrozen(a)).toBe(true);
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // pure function: no memoization, fresh frozen array per call
  });

  test("identity: snapshot stored once at creation — branch mutations never re-read (SIDECHAT-003)", () => {
    const entries = buildBranch();
    const fake = { getBranch: () => entries }; // closure over the LIVE branch
    const deps: SidechatRebindDeps = {
      resolveModelSnapshot: vi.fn(() => ({ provider: "p", modelId: "m" })),
      buildSystemPrompt: vi.fn(() => "sys"),
      buildBranchSnapshot: vi.fn(() => takeBranchSnapshot(fake)),
    };

    const rec = openOrReplace("q1", deps);
    expect(deps.buildBranchSnapshot).toHaveBeenCalledTimes(1);
    const before = texts(rec.branchSnapshot as BranchSnapshotMessages);
    expect(before.join("\n")).toContain("hello there");

    // The main session moves on mid-chat…
    entries.push({ ...entryBase("e12", "e11"), type: "message", message: userMessage("later turn") });

    // …same-question reuse returns the SAME record; the builder is NOT
    // re-invoked and the appended turn does NOT leak into the snapshot
    // (staleness accepted v1 — SIDECHAT-003).
    expect(openOrReplace("q1", deps)).toBe(rec);
    expect(deps.buildBranchSnapshot).toHaveBeenCalledTimes(1);
    expect(texts(rec.branchSnapshot as BranchSnapshotMessages)).toEqual(before);
    expect(texts(rec.branchSnapshot as BranchSnapshotMessages).join("\n")).not.toContain("later turn");

    // A DIFFERENT question replaces wholesale: builder re-invoked exactly
    // once, and the fresh snapshot DOES see the (mutated) branch.
    const rec2 = openOrReplace("q2", deps);
    expect(rec2).not.toBe(rec);
    expect(deps.buildBranchSnapshot).toHaveBeenCalledTimes(2);
    expect(texts(rec2.branchSnapshot as BranchSnapshotMessages).join("\n")).toContain("later turn");
  });
});

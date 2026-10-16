/**
 * src/panel/sidechat.test.ts — unit tests for the SIDECHAT-002 store
 * (P1.M1.T3.S1): singleton identity, same-question reuse without rebind,
 * wholesale replacement with no carry-over, discard, and the builder
 * call-count pins. Fake builders only — the module under test imports
 * nothing, so neither does this suite.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  classifyChatCommand,
  discard,
  get,
  openOrReplace,
  resetChat,
  resetSidechatForTests,
  type SidechatRebindDeps,
} from "./sidechat.js";

let seq = 0;

/** Fake builder bag: every return value embeds the call sequence counter. */
function fakeDeps(): SidechatRebindDeps {
  return {
    resolveModelSnapshot: vi.fn(() => ({ provider: "p", modelId: `m${++seq}` })),
    buildSystemPrompt: vi.fn(() => `sys-${seq}`),
    buildBranchSnapshot: vi.fn(() => [{ i: ++seq }]),
  };
}

beforeEach(() => {
  seq = 0;
  resetSidechatForTests();
});

describe("sidechat store — singleton lifecycle (SIDECHAT-002)", () => {
  test("absent before the first open", () => {
    expect(get()).toBeUndefined();
  });

  test("singleton identity: two get() calls return the SAME record", () => {
    const deps = fakeDeps();
    openOrReplace("q1", deps);
    expect(get()).toBeDefined();
    expect(get()).toBe(get());
  });

  test("same-question reuse returns the identical record without re-invoking builders", () => {
    const deps = fakeDeps();
    const first = openOrReplace("q1", deps);
    expect(deps.resolveModelSnapshot).toHaveBeenCalledTimes(1);
    expect(deps.buildSystemPrompt).toHaveBeenCalledTimes(1);
    expect(deps.buildBranchSnapshot).toHaveBeenCalledTimes(1);

    // Mutate externally — reuse must NOT rebuild (mutation preserved).
    first.messages.push({ role: "user", text: "hello", at: "T0" });
    first.usage.input = 41;

    const second = openOrReplace("q1", fakeDeps());
    expect(second).toBe(first); // identity-stable reuse, not a rebuild
    expect(second.messages).toEqual([{ role: "user", text: "hello", at: "T0" }]);
    expect(second.usage.input).toBe(41);
    // The FRESH deps bag passed on the second open is never consulted.
    expect(deps.resolveModelSnapshot).toHaveBeenCalledTimes(1);
    expect(deps.buildSystemPrompt).toHaveBeenCalledTimes(1);
    expect(deps.buildBranchSnapshot).toHaveBeenCalledTimes(1);
  });

  test("different question → wholesale replacement: no carry-over, fresh controller, builders re-invoked", () => {
    const deps1 = fakeDeps();
    const first = openOrReplace("q1", deps1);
    first.messages.push({ role: "assistant", text: "old chat", at: "T0" });
    first.usage.output = 100;

    const deps2 = fakeDeps();
    const second = openOrReplace("q2", deps2);

    expect(second).not.toBe(first);
    expect(second.questionId).toBe("q2");
    expect(second.messages).toEqual([]); // NOTHING carried over
    expect(second.usage).toEqual({ input: 0, output: 0, totalCost: 0 }); // zeroed
    expect(second.streamState).toBe("idle");
    expect(second.abortController).not.toBe(first.abortController); // fresh controller
    expect(second.abortController.signal.aborted).toBe(false);
    expect(second.modelSnapshot).not.toEqual(first.modelSnapshot); // rebuilt from deps2
    expect(second.systemPrompt).not.toBe(first.systemPrompt);
    expect(second.branchSnapshot).not.toBe(first.branchSnapshot);
    // Old record untouched (replacement, not mutation).
    expect(first.messages).toEqual([{ role: "assistant", text: "old chat", at: "T0" }]);
    // Each builder ran exactly once per creation (2 creations total).
    expect(deps1.resolveModelSnapshot).toHaveBeenCalledTimes(1);
    expect(deps2.resolveModelSnapshot).toHaveBeenCalledTimes(1);
    expect(deps2.buildSystemPrompt).toHaveBeenCalledTimes(1);
    expect(deps2.buildBranchSnapshot).toHaveBeenCalledTimes(1);
  });

  test("replacement needs no confirmation: the open returns the new record directly", () => {
    // Structural pin: openOrReplace's signature has no callback/flag
    // surface — the q1→q2 switch is instantaneous and side-effect-free
    // beyond the replacement itself (SIDECHAT-002: no confirm, ever).
    openOrReplace("q1", fakeDeps());
    const deps = fakeDeps();
    const replaced = openOrReplace("q2", deps);
    expect(replaced.questionId).toBe("q2");
    expect(get()).toBe(replaced);
    expect(deps.resolveModelSnapshot).toHaveBeenCalledTimes(1); // no extra probe calls
  });

  test("discard clears the singleton; a subsequent open builds fresh (builders re-run)", () => {
    const deps1 = fakeDeps();
    const first = openOrReplace("q1", deps1);
    first.messages.push({ role: "user", text: "gone", at: "T0" });

    discard(); // plain in-memory delete — NO abort here (caller's job, P1.M2.T5.S1)
    expect(get()).toBeUndefined();
    expect(first.abortController.signal.aborted).toBe(false); // discard never aborts

    const deps2 = fakeDeps();
    const fresh = openOrReplace("q1", deps2); // even the SAME question rebuilds
    expect(fresh).not.toBe(first);
    expect(fresh.messages).toEqual([]);
    expect(deps2.resolveModelSnapshot).toHaveBeenCalledTimes(1); // fresh creation ran the builders
    expect(deps1.buildBranchSnapshot).toHaveBeenCalledTimes(1); // old builders untouched
  });
});

describe("classifyChatCommand — SIDECHAT-002 slash escapes (P1.M1.T3.S2)", () => {
  test("the two commands classify by byte-exact first whitespace-delimited token", () => {
    expect(classifyChatCommand("/clear")).toBe("/clear");
    expect(classifyChatCommand("/new")).toBe("/new");
    // Trailing words ride along — only the FIRST token decides.
    expect(classifyChatCommand("/clear extra words")).toBe("/clear");
    expect(classifyChatCommand("/new   ")).toBe("/new");
    // Leading whitespace is consumed by the split — still the command.
    expect(classifyChatCommand("  /clear")).toBe("/clear");
  });

  test("everything else is a message (null) — the four contract exemplars + pins", () => {
    expect(classifyChatCommand("/usr/bin/env")).toBeNull(); // a path, not a command
    expect(classifyChatCommand("/clearance")).toBeNull(); // prefix match is a bug
    expect(classifyChatCommand("see /clear below")).toBeNull(); // mid-sentence token
    expect(classifyChatCommand("## /clear")).toBeNull(); // markdown heading
    // Case-sensitive: no case-folding, ever.
    expect(classifyChatCommand("/Clear")).toBeNull();
    // Empty and whitespace-only inputs split to a "" first token → null.
    expect(classifyChatCommand("")).toBeNull();
    expect(classifyChatCommand("  ")).toBeNull();
  });
});

describe("resetChat — SIDECHAT-003 refresh valve (P1.M1.T3.S2)", () => {
  test("an existing record is rebuilt FRESH: zeroed messages/usage, new controller, builders re-run", () => {
    const deps1 = fakeDeps();
    const first = openOrReplace("q1", deps1);
    first.messages.push(
      { role: "user", text: "old", at: "T0" },
      { role: "assistant", text: "stale reply", at: "T1" },
    );
    first.usage.input = 41;
    first.usage.output = 100;
    first.usage.totalCost = 0.5;

    const deps2 = fakeDeps();
    const fresh = resetChat("q1", deps2); // SAME questionId — the reuse path MUST NOT fire

    // A brand-new record, not the reused one.
    expect(fresh).not.toBe(first);
    expect(fresh.questionId).toBe("q1");
    expect(fresh.messages).toEqual([]); // NOTHING carried over
    expect(fresh.usage).toEqual({ input: 0, output: 0, totalCost: 0 }); // zeroed
    expect(fresh.streamState).toBe("idle");
    expect(fresh.abortController).not.toBe(first.abortController); // fresh controller
    expect(fresh.abortController.signal.aborted).toBe(false);
    // Caller-owns-abort: resetChat never touches the OLD controller.
    expect(first.abortController.signal.aborted).toBe(false);
    // NEW builder outputs (the SIDECHAT-003 snapshot refresh) — fakeDeps is
    // sequence-aware, so the values are provably distinct per creation.
    expect(fresh.modelSnapshot).not.toEqual(first.modelSnapshot);
    expect(fresh.systemPrompt).not.toBe(first.systemPrompt);
    expect(fresh.branchSnapshot).not.toBe(first.branchSnapshot);
    // Each builder ran exactly once MORE (on deps2 — the fresh bag).
    expect(deps2.resolveModelSnapshot).toHaveBeenCalledTimes(1);
    expect(deps2.buildSystemPrompt).toHaveBeenCalledTimes(1);
    expect(deps2.buildBranchSnapshot).toHaveBeenCalledTimes(1);
    // The singleton now hands out the new record.
    expect(get()).toBe(fresh);
  });

  test("no prior record: reset still builds and installs fresh (first-input /clear is legal)", () => {
    const deps = fakeDeps();
    const fresh = resetChat("q9", deps);
    expect(fresh.questionId).toBe("q9");
    expect(fresh.messages).toEqual([]);
    expect(fresh.usage).toEqual({ input: 0, output: 0, totalCost: 0 });
    expect(fresh.streamState).toBe("idle");
    expect(get()).toBe(fresh);
    expect(deps.resolveModelSnapshot).toHaveBeenCalledTimes(1);
    expect(deps.buildSystemPrompt).toHaveBeenCalledTimes(1);
    expect(deps.buildBranchSnapshot).toHaveBeenCalledTimes(1);
  });
});

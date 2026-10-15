/**
 * src/panel/sidechat.test.ts — unit tests for the SIDECHAT-002 store
 * (P1.M1.T3.S1): singleton identity, same-question reuse without rebind,
 * wholesale replacement with no carry-over, discard, and the builder
 * call-count pins. Fake builders only — the module under test imports
 * nothing, so neither does this suite.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  discard,
  get,
  openOrReplace,
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

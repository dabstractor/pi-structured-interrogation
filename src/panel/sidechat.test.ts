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
  clearPendingConfirm,
  discard,
  formatChatCloseNotice,
  get,
  openOrReplace,
  parseAnswerBlock,
  resetChat,
  resetSidechatForTests,
  settleApplyDecision,
  toApplyDecision,
  type ChatUsage,
  type SidechatRebindDeps,
} from "./sidechat.js";
import type { Question } from "../state.js";

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

// P1.M1.T5.S3 — the close-notice formatter. The string is SPEC-PINNED
// (ui-spec §Side chat "Usage & close", verbatim authority via
// sidechat-contracts.md §SIDECHAT-005: "any close/discard notifies
// compactly (`chat closed · 12.4K in · 3.1K out · $0.07`)"), so the rows
// below are byte-exact vectors, not property assertions: the sub-1000 /
// trailing-.0 / cost-padding / rounding edge rules are pinned here because
// the spec's single example leaves them open. Pure function — no store,
// no pi types (ChatUsage is plain numbers); the spec example doubles as a
// vector row.
describe("formatChatCloseNotice — spec-pinned close string (P1.M1.T5.S3)", () => {
  const u = (input: number, output: number, totalCost: number): ChatUsage => ({
    input,
    output,
    totalCost,
  });

  test("the spec example: 12400/3100/$0.07 → `chat closed · 12.4K in · 3.1K out · $0.07`", () => {
    expect(formatChatCloseNotice(u(12400, 3100, 0.07))).toBe(
      "chat closed · 12.4K in · 3.1K out · $0.07",
    );
  });

  test("zero chat: 0/0/$0 → `0 in · 0 out · $0.00` (plain digit zeros, padded cost)", () => {
    expect(formatChatCloseNotice(u(0, 0, 0))).toBe("chat closed · 0 in · 0 out · $0.00");
  });

  test("sub-1000 boundary: 999/999/$0.006 → `999 in · 999 out · $0.01` (no K, no padding)", () => {
    expect(formatChatCloseNotice(u(999, 999, 0.006))).toBe(
      "chat closed · 999 in · 999 out · $0.01",
    );
  });

  test("exact 1000 strips the trailing .0: `1K`, never `1.0K`; $1.2 pads to `$1.20`", () => {
    expect(formatChatCloseNotice(u(1000, 1000, 1.2))).toBe("chat closed · 1K in · 1K out · $1.20");
  });

  test("toFixed rounds: 12499→`12.5K`, 2801→`2.8K`, $0.066→`$0.07`", () => {
    expect(formatChatCloseNotice(u(12499, 2801, 0.066))).toBe(
      "chat closed · 12.5K in · 2.8K out · $0.07",
    );
  });

  test("asymmetric usage: 123456 in / 0 out / $0 → `123.5K in · 0 out · $0.00`", () => {
    expect(formatChatCloseNotice(u(123456, 0, 0))).toBe(
      "chat closed · 123.5K in · 0 out · $0.00",
    );
  });
});

describe("parseAnswerBlock — SIDECHAT-004 answer-block parsing (P1.M1.T6.S1)", () => {
  // Contract: sidechat-contracts.md §SIDECHAT-004 + ui-spec §Side chat
  // "Answer protocol" — the LAST fenced ```answer block of a COMPLETED
  // reply, strict JSON, exact-key shapes, byte-matched values. This parser
  // is the strict inverse of the mirror prompt (sidechat-prompt.ts §"##
  // Answer protocol"). Every rejection row asserts the FULL
  // { kind: "none", reason } object (toEqual, never toMatchObject).

  /** Wrap a JSON body in the canonical fenced block the mirror prompt teaches. */
  const block = (body: string): string => "```answer\n" + body + "\n```";
  const OPTIONS = ["postgres", "sqlite"] as const;

  test("valid value shape: byte-matched option → {kind:'value', value}", () => {
    expect(parseAnswerBlock('some prose\n' + block('{"value":"sqlite"}'), OPTIONS)).toEqual({
      kind: "value",
      value: "sqlite",
    });
  });

  test("valid text shape: the write-in text IS the answer, carried as-is", () => {
    expect(
      parseAnswerBlock(block('{"text":"use streaming, but batch the writes"}'), OPTIONS),
    ).toEqual({ kind: "text", text: "use streaming, but batch the writes" });
  });

  test("text is returned VERBATIM: validity checks trim(), the payload stays untrimmed", () => {
    expect(parseAnswerBlock(block('{"text":" padded "}'), [])).toEqual({
      kind: "text",
      text: " padded ",
    });
  });

  test("last-block-wins: two valid blocks with prose between → the LATER one", () => {
    const reply = block('{"value":"a"}') + "\nactually, reconsidered:\n" + block('{"value":"b"}');
    expect(parseAnswerBlock(reply, ["a", "b"])).toEqual({ kind: "value", value: "b" });
  });

  test("malformed LAST block: NO fallback to an earlier valid one — the latest intent governs", () => {
    const reply = block('{"value":"a"}') + "\n" + block("{'value':'b'}");
    expect(parseAnswerBlock(reply, ["a", "b"])).toEqual({
      kind: "none",
      reason: "malformed-json",
    });
  });

  test("byte-match strictness: case or whitespace variants mismatch — no normalization anywhere", () => {
    for (const v of ["Sqlite", " sqlite", "SQLITE"]) {
      expect(parseAnswerBlock(block('{"value":"' + v + '"}'), ["sqlite"])).toEqual({
        kind: "none",
        reason: "value-mismatch",
      });
    }
  });

  test("malformed JSON: trailing comma and single quotes throw strict → malformed-json", () => {
    expect(parseAnswerBlock(block('{"value":"x",}'), OPTIONS)).toEqual({
      kind: "none",
      reason: "malformed-json",
    });
    expect(parseAnswerBlock(block("{'value':'x'}"), OPTIONS)).toEqual({
      kind: "none",
      reason: "malformed-json",
    });
  });

  test("unknown shapes: arrays, scalars, null, empty object, both keys, extra keys, non-string values", () => {
    for (const body of [
      "[]",
      "42",
      '"x"',
      "null",
      "{}",
      '{"value":"x","text":"y"}',
      '{"value":42}',
      '{"value":"x","why":"z"}',
    ]) {
      expect(parseAnswerBlock(block(body), OPTIONS)).toEqual({
        kind: "none",
        reason: "unknown-shape",
      });
    }
  });

  test("empty or whitespace-only text → empty-text", () => {
    expect(parseAnswerBlock(block('{"text":""}'), OPTIONS)).toEqual({
      kind: "none",
      reason: "empty-text",
    });
    expect(parseAnswerBlock(block('{"text":"   "}'), OPTIONS)).toEqual({
      kind: "none",
      reason: "empty-text",
    });
  });

  test("no-block: no fence, or a fence that is not EXACTLY `answer` (wrong tag/case/suffix)", () => {
    for (const reply of [
      "just a plain reply, no block at all",
      '```json\n{"value":"x"}\n```',
      '```ANSWER\n{"value":"x"}\n```',
      '```answer json\n{"value":"x"}\n```',
    ]) {
      expect(parseAnswerBlock(reply, OPTIONS)).toEqual({ kind: "none", reason: "no-block" });
    }
  });

  test("unterminated block at EOF (reply cut mid-fence) is not a block → no-block", () => {
    expect(parseAnswerBlock('done\n```answer\n{"value":"sqlite"}', OPTIONS)).toEqual({
      kind: "none",
      reason: "no-block",
    });
  });

  test("fence tolerance: 4-backtick fences ARE blocks (close ≥3 suffices); trailing space after `answer` OK", () => {
    expect(parseAnswerBlock('````answer\n{"value":"a"}\n````', ["a"])).toEqual({
      kind: "value",
      value: "a",
    });
    expect(parseAnswerBlock('```answer \n{"value":"a"}\n```', ["a"])).toEqual({
      kind: "value",
      value: "a",
    });
  });

  test("text question (empty optionValues): any value form mismatches — no question-type param", () => {
    expect(parseAnswerBlock(block('{"value":"x"}'), [])).toEqual({
      kind: "none",
      reason: "value-mismatch",
    });
  });

  test("pretty-printed multi-line JSON body parses fine", () => {
    expect(parseAnswerBlock(block('{"value":\n  "a"\n}'), ["a"])).toEqual({
      kind: "value",
      value: "a",
    });
  });

  test("position-agnostic: trailing prose after the block does not disqualify it", () => {
    expect(parseAnswerBlock(block('{"value":"a"}') + "\nHope this helps!", ["a"])).toEqual({
      kind: "value",
      value: "a",
    });
  });
});

// ---------------------------------------------------------------------------
// ApplyDecision contract (P1.M1.T6.S2, SIDECHAT-004). Mode A contract:
// sidechat-contracts.md §SIDECHAT-004 + panel-view-integration.md
// §Open/replace/discard — a reply's applicable answer block becomes a
// routing-ready decision NAMING the ordinary apply seam (display-indexed
// option accept, or verbatim write-in); the store only PRODUCES decisions
// and maintains record.pendingConfirm — it never routes one (the panel's
// single routing consumer, P1.M2.T6.S1, does). The display-order mirror
// (recommended-first) is pinned here against short-view.ts displayOptions,
// the authority this module cannot import (zero-pi wall).

/** Choice question literal: options [postgres, sqlite, memory], no
 * recommendation unless overridden — only the fields the decision path
 * reads (state.ts Question, pi-free). */
function choiceQuestion(overrides?: Partial<Question>): Question {
  return {
    id: "q.choice",
    rev: 1,
    status: "open",
    prompt: "pick one",
    type: "choice",
    options: [
      { value: "postgres", label: "Postgres" },
      { value: "sqlite", label: "SQLite" },
      { value: "memory", label: "In-memory" },
    ],
    ...overrides,
  };
}

/** Text question literal — options deliberately ABSENT (the shape that must
 * never hit a bare .map). */
function textQuestion(overrides?: Partial<Question>): Question {
  return { id: "q.text", rev: 1, status: "open", prompt: "describe it", type: "text", ...overrides };
}

/** [postgres, sqlite] question — the settle rows' two-option target. */
function twoOptionQuestion(): Question {
  return choiceQuestion({
    id: "q1",
    options: [
      { value: "postgres", label: "Postgres" },
      { value: "sqlite", label: "SQLite" },
    ],
  });
}

describe("toApplyDecision / settleApplyDecision — ApplyDecision contract, pendingConfirm, autoApply bypass (SIDECHAT-004, P1.M1.T6.S2)", () => {
  test("value → DISPLAY index without a recommendation: state order IS display order", () => {
    const q = choiceQuestion();
    expect(toApplyDecision({ kind: "value", value: "postgres" }, q)).toEqual({
      seam: "acceptOptionIndex",
      optionIndex: 0,
    });
    expect(toApplyDecision({ kind: "value", value: "sqlite" }, q)).toEqual({
      seam: "acceptOptionIndex",
      optionIndex: 1,
    });
    expect(toApplyDecision({ kind: "value", value: "memory" }, q)).toEqual({
      seam: "acceptOptionIndex",
      optionIndex: 2,
    });
  });

  test("value → DISPLAY index WITH a recommendation: recommended first, rest keep state order (D-R13 reorder pin)", () => {
    const q = choiceQuestion({ recommendation: "memory" });
    expect(toApplyDecision({ kind: "value", value: "memory" }, q)).toEqual({
      seam: "acceptOptionIndex",
      optionIndex: 0,
    });
    expect(toApplyDecision({ kind: "value", value: "postgres" }, q)).toEqual({
      seam: "acceptOptionIndex",
      optionIndex: 1,
    });
    expect(toApplyDecision({ kind: "value", value: "sqlite" }, q)).toEqual({
      seam: "acceptOptionIndex",
      optionIndex: 2,
    });
  });

  test("dangling recommendation (byte-matches no option value) does NOT reorder (displayOptions guard mirrored)", () => {
    const q = choiceQuestion({ recommendation: "no-such-value" });
    expect(toApplyDecision({ kind: "value", value: "postgres" }, q)).toEqual({
      seam: "acceptOptionIndex",
      optionIndex: 0,
    });
    expect(toApplyDecision({ kind: "value", value: "sqlite" }, q)).toEqual({
      seam: "acceptOptionIndex",
      optionIndex: 1,
    });
    expect(toApplyDecision({ kind: "value", value: "memory" }, q)).toEqual({
      seam: "acceptOptionIndex",
      optionIndex: 2,
    });
  });

  test("text → writeIn carrying the text VERBATIM — surrounding whitespace survives untouched", () => {
    expect(toApplyDecision({ kind: "text", text: " padded " }, textQuestion())).toEqual({
      seam: "writeIn",
      text: " padded ",
    });
  });

  test("kind none (every reason) → undefined — the in-view notice path owns it, never a decision", () => {
    const reasons = [
      "no-block",
      "malformed-json",
      "unknown-shape",
      "value-mismatch",
      "empty-text",
    ] as const;
    for (const reason of reasons) {
      expect(toApplyDecision({ kind: "none", reason }, choiceQuestion())).toBeUndefined();
    }
  });

  test("defensive: a value outside the display universe → undefined, never a wrong-row decision", () => {
    expect(toApplyDecision({ kind: "value", value: "zzz" }, choiceQuestion())).toBeUndefined();
  });

  test("settle manual: returns the decision AND sets record.pendingConfirm to the same decision", () => {
    const record = openOrReplace("q1", fakeDeps());
    const decision = settleApplyDecision(
      record,
      '```answer\n{"value":"sqlite"}\n```',
      twoOptionQuestion(),
      false,
    );
    expect(decision).toEqual({ seam: "acceptOptionIndex", optionIndex: 1 });
    expect(record.pendingConfirm).toEqual({ seam: "acceptOptionIndex", optionIndex: 1 });
  });

  test("settle autoApply: returns the decision but pendingConfirm stays absent (bypass — no confirm state ever)", () => {
    const record = openOrReplace("q1", fakeDeps());
    const decision = settleApplyDecision(
      record,
      '```answer\n{"value":"sqlite"}\n```',
      twoOptionQuestion(),
      true,
    );
    expect(decision).toEqual({ seam: "acceptOptionIndex", optionIndex: 1 });
    expect(record.pendingConfirm).toBeUndefined();
  });

  test("settle writeIn on a text question (options undefined): verbatim decision, pendingConfirm set under manual", () => {
    const record = openOrReplace("q1", fakeDeps());
    const decision = settleApplyDecision(
      record,
      '```answer\n{"text":"use streaming"}\n```',
      textQuestion({ id: "q1" }),
      false,
    );
    expect(decision).toEqual({ seam: "writeIn", text: "use streaming" });
    expect(record.pendingConfirm).toEqual({ seam: "writeIn", text: "use streaming" });
  });

  test("supersede: a later reply with no applicable block CLEARS a prior pendingConfirm (latest reply governs)", () => {
    const record = openOrReplace("q1", fakeDeps());
    const q = twoOptionQuestion();
    expect(settleApplyDecision(record, '```answer\n{"value":"sqlite"}\n```', q, false)).toBeDefined();
    expect(record.pendingConfirm).toBeDefined();
    expect(
      settleApplyDecision(record, "actually, on reflection — see my note above", q, false),
    ).toBeUndefined();
    expect(record.pendingConfirm).toBeUndefined();
  });

  test("decline: clearPendingConfirm clears the field and nothing else on the record", () => {
    const record = openOrReplace("q1", fakeDeps());
    settleApplyDecision(record, '```answer\n{"value":"sqlite"}\n```', twoOptionQuestion(), false);
    expect(record.pendingConfirm).toBeDefined();
    clearPendingConfirm(record);
    expect(record.pendingConfirm).toBeUndefined();
    expect(record.messages).toEqual([]); // chat content untouched — esc keeps the chat open
    expect(record.questionId).toBe("q1");
  });

  test("lifecycle: resetChat rebuilds WITHOUT confirm state; discard removes the record (it dies with it)", () => {
    const opened = openOrReplace("q1", fakeDeps());
    settleApplyDecision(opened, '```answer\n{"value":"sqlite"}\n```', twoOptionQuestion(), false);
    expect(opened.pendingConfirm).toBeDefined();
    const fresh = resetChat("q1", fakeDeps());
    expect(fresh.pendingConfirm).toBeUndefined();
    settleApplyDecision(fresh, '```answer\n{"value":"sqlite"}\n```', twoOptionQuestion(), false);
    expect(fresh.pendingConfirm).toBeDefined();
    discard();
    expect(get()).toBeUndefined();
  });

  test("purity: identical inputs give identical outputs across repeated settles (idempotent per state)", () => {
    const record = openOrReplace("q1", fakeDeps());
    const q = twoOptionQuestion();
    const first = settleApplyDecision(record, '```answer\n{"value":"sqlite"}\n```', q, false);
    const second = settleApplyDecision(record, '```answer\n{"value":"sqlite"}\n```', q, false);
    expect(second).toEqual(first);
    expect(record.pendingConfirm).toEqual(first);
    // No-decision settles converge too (aborted turns never settle — engine
    // contract — so an earlier pendingConfirm survives them; that row lives
    // in the engine suite).
    expect(settleApplyDecision(record, "no block here", q, false)).toBeUndefined();
    expect(record.pendingConfirm).toBeUndefined();
  });
});

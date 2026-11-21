/**
 * src/input-capture.test.ts — input-recovery capture coordinator tests
 * (P3.M2.T1.S1; spec state-and-persistence.md §Local input recovery
 * :133-149 acceptance halves owned by S1: capture-on-edit/paste,
 * byte-exactness, bounded pacing, seq minting rules, inertness).
 *
 * Conventions: bare vi.fn() spies + literal fakes (text-field.test.ts
 * pattern); vi.useFakeTimers for the pacing clock (the store uses plain
 * setTimeout ONLY — no interval, no process-level timers, by design).
 * The no-side-effects suite mirrors the sidechat-cache-isolation static
 * scanner's posture (string-aware source scan for forbidden surfaces).
 */
import { describe, expect, test, vi, afterEach, beforeEach, type Mock } from "vitest";
import { readFileSync } from "node:fs";
import {
  InputCaptureStore,
  type CaptureKey,
  type CaptureRecord,
  type CaptureSink,
} from "./input-capture.js";

// ------------------------------------------------------------------ fixtures

function key(partial: Partial<CaptureKey> & { field: CaptureKey["field"] }): CaptureKey {
  return { branchId: "branch-1", questionId: "-", ...partial };
}

const WRITEIN_KEY = key({ questionId: "q1", field: "writein" });

function makeStore(sink: Mock = vi.fn()): {
  store: InputCaptureStore;
  sink: Mock;
} {
  return {
    store: new InputCaptureStore({ sink: sink as unknown as CaptureSink, session: () => "sess-1" }),
    sink,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------- per-duty keys

describe("per-duty capture — all five editor duties", () => {
  test("✎ Other write-in captures under {branch, qid, writein}", () => {
    const { store, sink } = makeStore();
    store.setKeyDirty(WRITEIN_KEY, () => "custom answer");
    vi.advanceTimersByTime(250);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toEqual({
      branchId: "branch-1",
      questionId: "q1",
      field: "writein",
      session: "sess-1",
      text: "custom answer",
      seq: 1,
    });
  });

  test("type:\"text\" answer duty captures under writein with its own qid", () => {
    const { store, sink } = makeStore();
    const k = key({ questionId: "q2", field: "writein" });
    store.setKeyDirty(k, () => "text answer");
    vi.advanceTimersByTime(250);
    expect(sink.mock.calls[0][0]).toMatchObject({ questionId: "q2", field: "writein", text: "text answer" });
  });

  test("elaboration duty captures under its option-attached key", () => {
    const { store, sink } = makeStore();
    store.setKeyDirty(key({ questionId: "q3", field: "elaboration" }), () => "rationale");
    vi.advanceTimersByTime(250);
    expect(sink.mock.calls[0][0]).toMatchObject({ questionId: "q3", field: "elaboration", seq: 1 });
  });

  test("batch note duty is question-agnostic (questionId \"-\")", () => {
    const { store, sink } = makeStore();
    store.setKeyDirty(key({ questionId: "-", field: "note" }), () => "note body");
    vi.advanceTimersByTime(250);
    expect(sink.mock.calls[0][0]).toMatchObject({ questionId: "-", field: "note", text: "note body" });
  });

  test("side-chat composer captures under the active record's question", () => {
    const { store, sink } = makeStore();
    store.setKeyDirty(key({ questionId: "q4", field: "sidechat-composer" }), () => "chat prompt");
    vi.advanceTimersByTime(250);
    expect(sink.mock.calls[0][0]).toMatchObject({
      questionId: "q4",
      field: "sidechat-composer",
      text: "chat prompt",
    });
  });
});

// ------------------------------------------------------------------- paste

describe("paste is a plain buffer mutation — full expanded string, no placeholder", () => {
  test("single multiline paste capture is byte-exact", () => {
    const { store, sink } = makeStore();
    const pasted = "line1\nline2\nline3 あ — tab\tend";
    store.setKeyDirty(WRITEIN_KEY, () => pasted);
    vi.advanceTimersByTime(250);
    expect(sink).toHaveBeenCalledTimes(1);
    expect((sink.mock.calls[0][0] as CaptureRecord).text).toBe(pasted);
  });
});

// -------------------------------------------------------------- byte-exactness

describe("byte-exact expanded strings", () => {
  const cases: Array<[string, string]> = [
    ["leading whitespace + multiline + tab", "  leading\nline2\t"],
    ["Unicode + emoji + ellipsis", "あé…🜂 — 中文"],
    ["trailing spaces preserved", "trailing   "],
    ["newlines everywhere", "\n\nmiddle\n\n"],
  ];
  for (const [label, text] of cases) {
    test(label, () => {
      const { store, sink } = makeStore();
      store.setKeyDirty(WRITEIN_KEY, () => text);
      vi.advanceTimersByTime(250);
      expect((sink.mock.calls[0][0] as CaptureRecord).text).toBe(text);
    });
  }

  test("typed-empty after real input captures \"\" (delete-to-empty IS an edit)", () => {
    const { store, sink } = makeStore();
    store.setKeyDirty(WRITEIN_KEY, () => "typed text");
    vi.advanceTimersByTime(250);
    store.setKeyDirty(WRITEIN_KEY, () => ""); // user deleted everything
    vi.advanceTimersByTime(250);
    const records = sink.mock.calls.map((c) => c[0] as CaptureRecord);
    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({ text: "", seq: 2 });
  });
});

// ------------------------------------------------------------------- pacing

describe("pacing — bounded progress, never idle/blur/shutdown-only", () => {
  test("trailing debounce fires at 250ms, coalescing the burst", () => {
    const { store, sink } = makeStore();
    store.setKeyDirty(WRITEIN_KEY, () => "a");
    vi.advanceTimersByTime(100);
    store.setKeyDirty(WRITEIN_KEY, () => "ab");
    vi.advanceTimersByTime(100);
    store.setKeyDirty(WRITEIN_KEY, () => "abc");
    expect(sink).not.toHaveBeenCalled(); // still inside the window
    vi.advanceTimersByTime(49); // t=249
    expect(sink).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); // t=250 — trailing edge
    expect(sink).toHaveBeenCalledTimes(1);
    expect((sink.mock.calls[0][0] as CaptureRecord).text).toBe("abc"); // newest read
  });

  test("50 keystrokes at 50ms intervals → multiple flushes DURING the burst (max dirty age)", () => {
    const { store, sink } = makeStore();
    let buffer = "";
    const flushTimes: number[] = [];
    sink.mockImplementation(() => flushTimes.push(vi.getMockedSystemTime()?.getTime() ?? 0));
    for (let i = 0; i < 50; i++) {
      buffer += String(i % 10);
      store.setKeyDirty(WRITEIN_KEY, () => buffer);
      vi.advanceTimersByTime(50);
    }
    // Continuous typing never idles past the debounce window, so every
    // flush here is the 1000ms max-dirty-age deadline (or the re-armed
    // debounce cadence) — either way: progress WITHOUT idle.
    expect(sink.mock.calls.length).toBeGreaterThanOrEqual(2);
    // And the newest text always won:
    expect(store.latest(WRITEIN_KEY)?.text).toBe(buffer);
  });

  test("identity edits (text equal to last captured value) never re-arm or mint", () => {
    const { store, sink } = makeStore();
    store.setKeyDirty(WRITEIN_KEY, () => "same");
    vi.advanceTimersByTime(250);
    expect(sink).toHaveBeenCalledTimes(1);
    store.setKeyDirty(WRITEIN_KEY, () => "same"); // identical ⇒ not edit work
    vi.advanceTimersByTime(1000);
    expect(sink).toHaveBeenCalledTimes(1); // no mint, no timer, no emit
  });
});

// --------------------------------------------------------------------- seq

describe("seq minting rules", () => {
  test("per-key monotonic seq; keys evolve independently", () => {
    const { store, sink } = makeStore();
    const noteKey = key({ questionId: "-", field: "note" });
    store.setKeyDirty(WRITEIN_KEY, () => "one");
    store.setKeyDirty(noteKey, () => "note one");
    vi.advanceTimersByTime(250);
    const records = sink.mock.calls.map((c) => c[0] as CaptureRecord);
    expect(records.find((r) => r.field === "writein")?.seq).toBe(1);
    expect(records.find((r) => r.field === "note")?.seq).toBe(1);
    store.setKeyDirty(WRITEIN_KEY, () => "two");
    vi.advanceTimersByTime(250);
    expect(sink.mock.calls.map((c) => (c[0] as CaptureRecord).seq)).toEqual([1, 1, 2]);
  });

  test("incidental seeding mints nothing — only onChange-driven edits reach the store", () => {
    // The TextField suppresses programmatic setText (its own tests prove the
    // wiring); at the STORE level the equivalent guarantee is: no setKeyDirty
    // call ⇒ no seq, no record, ever.
    const { store, sink } = makeStore();
    vi.advanceTimersByTime(5000);
    expect(sink).not.toHaveBeenCalled();
    expect(store.latest(WRITEIN_KEY)).toBeUndefined();
  });

  test("stale-key safety: pending A + switch to B → each record carries its own edit-time key", () => {
    const { store, sink } = makeStore();
    const keyB = key({ questionId: "q9", field: "elaboration" });
    store.setKeyDirty(WRITEIN_KEY, () => "text for A"); // A pending, unflushed
    store.setKeyDirty(keyB, () => "text for B"); // ownership switched before any flush
    vi.advanceTimersByTime(250);
    const records = sink.mock.calls.map((c) => c[0] as CaptureRecord);
    expect(records.find((r) => r.questionId === "q1")?.text).toBe("text for A");
    expect(records.find((r) => r.questionId === "q9")?.text).toBe("text for B");
  });
});

// ------------------------------------------------------------ accelerators

describe("forceFlush accelerators + dispose", () => {
  test("forceFlush() flushes all dirty keys early, sync, without timers", () => {
    const { store, sink } = makeStore();
    store.setKeyDirty(WRITEIN_KEY, () => "flush me");
    store.forceFlush();
    expect(sink).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(sink).toHaveBeenCalledTimes(1); // no double-emit from the armed timers
  });

  test("forceFlush(key) flushes only that key", () => {
    const { store, sink } = makeStore();
    const other = key({ questionId: "q2", field: "note" });
    store.setKeyDirty(WRITEIN_KEY, () => "a");
    store.setKeyDirty(other, () => "b");
    store.forceFlush(WRITEIN_KEY);
    expect(sink).toHaveBeenCalledTimes(1);
    expect((sink.mock.calls[0][0] as CaptureRecord).questionId).toBe("q1");
  });

  test("dispose cancels timers idempotently; post-dispose edits are ignored", () => {
    const { store, sink } = makeStore();
    store.setKeyDirty(WRITEIN_KEY, () => "never flushed");
    store.dispose();
    store.dispose(); // idempotent
    vi.advanceTimersByTime(5000);
    expect(sink).not.toHaveBeenCalled();
    store.setKeyDirty(WRITEIN_KEY, () => "after dispose");
    vi.advanceTimersByTime(5000);
    expect(sink).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------------- inertness

describe("no side effects — capture path touches ONLY the sink", () => {
  test("a hostile sink never breaks capture (fail silent-and-honest)", () => {
    const sink = vi.fn(() => {
      throw new Error("disk on fire");
    });
    const store = new InputCaptureStore({ sink, session: () => "sess-1" });
    store.setKeyDirty(WRITEIN_KEY, () => "still captured");
    vi.advanceTimersByTime(250);
    expect(sink).toHaveBeenCalledTimes(1); // attempted
    expect(store.latest(WRITEIN_KEY)?.text).toBe("still captured"); // memory stands
    store.setKeyDirty(WRITEIN_KEY, () => "and continues");
    vi.advanceTimersByTime(250);
    expect(sink).toHaveBeenCalledTimes(2); // natural retry on the next flush tick
  });

  test("hostile text getter / session resolver degrade, never throw", () => {
    const sink = vi.fn();
    const store = new InputCaptureStore({
      sink,
      session: () => {
        throw new Error("no session for you");
      },
    });
    store.setKeyDirty(WRITEIN_KEY, () => {
      throw new Error("editor gone");
    });
    vi.advanceTimersByTime(500);
    expect(sink).not.toHaveBeenCalled();
    store.setKeyDirty(WRITEIN_KEY, () => "fine");
    vi.advanceTimersByTime(250);
    expect((sink.mock.calls[0][0] as CaptureRecord).session).toBe("");
  });

  test("static audit: the module references no answer/submit/send/model/fs surface", () => {
    // Mirrors the sidechat-cache-isolation scanner posture (S3 ships the
    // dedicated scanner; this pins S1's slice now). spec :139: saving must
    // not advance/commit/queue/submit/send/resend/call a model, and S1 has
    // NO filesystem use at all.
    const source = readFileSync(new URL("./input-capture.ts", import.meta.url), "utf8");
    const banned = [
      "applyAnswer",
      "buildSubmission",
      "deliverSubmission",
      "maybeAutoSubmit",
      "sendMessage",
      "sendUserMessage",
      "steer",
      "streamSimple",
      "appendEntry",
      "node:fs",
      "writeFileSync",
      "renameSync",
    ];
    for (const name of banned) {
      expect(source.includes(name), `forbidden surface in input-capture.ts: ${name}`).toBe(false);
    }
  });
});

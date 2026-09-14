/**
 * src/persistence.test.ts — unit tests for the debounced state mirror
 * (P1.M7.T1.S1; h2.40 layer 3). A bare mock `{ on, appendEntry }` stands in
 * for pi (per the lifecycle.test.ts convention); fixture states are real
 * InterrogationStates driven through the raw mutation primitives. Fake
 * timers control the 2s debounce window; the mocked clock starts at a fixed
 * instant so `at` (ISO 8601 of the FLUSH moment) is asserted exactly.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import {
  INTERROGATION_STATE_ENTRY_TYPE,
  STATE_MIRROR_DEBOUNCE_MS,
  createStateMirror,
  type InterrogationStateEntryData,
  type StateMirror,
} from "./persistence.js";
import {
  createInterrogationState,
  getState,
  resetState,
  setState,
  type InterrogationState,
  type Question,
} from "./state.js";

// ------------------------------------------------------------------ mock pi

type Handler = (event: unknown) => void;

interface MockPi {
  pi: Pick<ExtensionAPI, "appendEntry" | "on">;
  /** The vi.fn backing `pi.on` — assert registrations with it. */
  on: Mock<[event: string, handler: Handler], () => void>;
  /** The vi.fn backing `pi.appendEntry` — assert mirrored entries with it. */
  appendEntry: Mock<[customType: string, data?: unknown], void>;
  /** Fire every handler registered for `event` (copy-first: dispose-safe). */
  emit(event: string, payload?: Record<string, unknown>): void;
  /** Live handler registry — dispose() must empty every list via the offs. */
  handlers: Map<string, Handler[]>;
}

function makeMockPi(): MockPi {
  const handlers = new Map<string, Handler[]>();
  const on = vi.fn((event: string, handler: Handler) => {
    const list = handlers.get(event) ?? [];
    list.push(handler);
    handlers.set(event, list);
    return () => {
      const current = handlers.get(event);
      if (current === undefined) return;
      const i = current.indexOf(handler);
      if (i !== -1) current.splice(i, 1);
    };
  }) as Mock<[event: string, handler: Handler], () => void>;
  const appendEntry = vi.fn() as Mock<[customType: string, data?: unknown], void>;
  const emit = (event: string, payload: Record<string, unknown> = {}): void => {
    for (const handler of [...(handlers.get(event) ?? [])]) handler({ type: event, ...payload });
  };
  return { pi: { on, appendEntry } as unknown as Pick<ExtensionAPI, "appendEntry" | "on">, on, appendEntry, emit, handlers };
}

/** Last appended entry, narrowed to the S2 payload contract. */
function entryAt(mock: MockPi, i: number): InterrogationStateEntryData {
  const call = mock.appendEntry.mock.calls[i];
  if (call === undefined) throw new Error(`no appendEntry call at index ${i}`);
  expect(call[0]).toBe(INTERROGATION_STATE_ENTRY_TYPE);
  return call[1] as InterrogationStateEntryData;
}

// ----------------------------------------------------------------- fixtures

// Fixed fake-clock origin: flush at +2000ms lands on ...T12:00:02.000Z.
const CLOCK_ORIGIN = new Date("2025-06-01T12:00:00.000Z");

const OPTS_AB = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];

function choiceQ(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    prompt: `prompt:${id}`,
    type: "choice",
    rev: 1,
    status: "open",
    options: OPTS_AB.map((o) => ({ ...o })),
    ...overrides,
  };
}

function newState(): InterrogationState {
  return createInterrogationState("test goal");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(CLOCK_ORIGIN);
});

afterEach(() => {
  vi.useRealTimers();
});

// --------------------------------------------------- debounce: burst/latest

test("mutation burst within the window → exactly ONE entry carrying the LAST state", () => {
  const st = newState();
  const mock = makeMockPi();
  const mirror = createStateMirror(mock.pi, { getState: () => st });

  st.upsertQuestion(choiceQ("q1"));
  vi.advanceTimersByTime(1500); // 500ms left on q1's window…
  st.upsertQuestion(choiceQ("q2")); // …reset by q2
  vi.advanceTimersByTime(500); // q1's original window would have fired here
  st.upsertQuestion(choiceQ("q3")); // reset again
  expect(mock.appendEntry).not.toHaveBeenCalled();

  vi.advanceTimersByTime(2000); // 2s after the LAST mutation

  expect(mock.appendEntry).toHaveBeenCalledTimes(1);
  const data = entryAt(mock, 0);
  expect(data.state.order).toEqual(["q1", "q2", "q3"]); // full final snapshot
  expect(data.epoch).toBe(st.epoch);
  expect(data.state).toEqual(st.serialize()); // verbatim serialize() shape
  expect(data.at).toBe("2025-06-01T12:00:04.000Z"); // flush moment, not mutation
  mirror.dispose();
});

test("mutations spaced beyond the window → one entry per window (accumulating audit trail)", () => {
  const st = newState();
  const mock = makeMockPi();
  const mirror = createStateMirror(mock.pi, { getState: () => st });

  st.upsertQuestion(choiceQ("q1"));
  vi.advanceTimersByTime(2000); // window 1 fires
  st.upsertQuestion(choiceQ("q2"));
  vi.advanceTimersByTime(2500); // window 2 fires

  expect(mock.appendEntry).toHaveBeenCalledTimes(2);
  expect(entryAt(mock, 0).state.order).toEqual(["q1"]);
  expect(entryAt(mock, 1).state.order).toEqual(["q1", "q2"]);
  expect(entryAt(mock, 1).at).toBe("2025-06-01T12:00:04.000Z");
  mirror.dispose();
});

// ------------------------------------------------------------ manual flush

test("flush() appends a pending window immediately and cancels the timer", () => {
  const st = newState();
  const mock = makeMockPi();
  const mirror = createStateMirror(mock.pi, { getState: () => st });

  st.upsertQuestion(choiceQ("q1"));
  mirror.flush();

  expect(mock.appendEntry).toHaveBeenCalledTimes(1);
  expect(entryAt(mock, 0).state.order).toEqual(["q1"]);

  vi.advanceTimersByTime(10_000); // timer was cancelled — no second append
  expect(mock.appendEntry).toHaveBeenCalledTimes(1);

  mirror.flush(); // nothing pending → no-op
  expect(mock.appendEntry).toHaveBeenCalledTimes(1);
  mirror.dispose();
});

// -------------------------------------------------------------- idle = mute

test("no mutations → no appendEntry, ever; and after a flush, idle time appends nothing", () => {
  const st = newState();
  const mock = makeMockPi();
  const mirror = createStateMirror(mock.pi, { getState: () => st });

  vi.advanceTimersByTime(60_000);
  expect(mock.appendEntry).not.toHaveBeenCalled();

  st.upsertQuestion(choiceQ("q1"));
  vi.advanceTimersByTime(2000); // the only window
  expect(mock.appendEntry).toHaveBeenCalledTimes(1);

  vi.advanceTimersByTime(60_000); // idle after the flush
  expect(mock.appendEntry).toHaveBeenCalledTimes(1);
  mirror.dispose();
});

// ------------------------------------------------------- failure isolation

test("appendEntry throwing is contained; later windows still work", () => {
  const st = newState();
  const mock = makeMockPi();
  mock.appendEntry.mockImplementation(() => {
    throw new Error("session in a weird state");
  });
  const mirror = createStateMirror(mock.pi, { getState: () => st });

  // The `changed` emitter is synchronous — a throwing appendEntry must not
  // break the mutation path…
  expect(() => st.upsertQuestion(choiceQ("q1"))).not.toThrow();
  // …nor explode out of the debounce timer callback.
  vi.advanceTimersByTime(2000);
  expect(mock.appendEntry).toHaveBeenCalledTimes(1); // attempted, error swallowed

  // Recovery: the NEXT window appends normally.
  mock.appendEntry.mockImplementation(() => {});
  st.upsertQuestion(choiceQ("q2"));
  vi.advanceTimersByTime(2000);
  expect(mock.appendEntry).toHaveBeenCalledTimes(2);
  expect(entryAt(mock, 1).state.order).toEqual(["q1", "q2"]);
  mirror.dispose();
});

// ------------------------------------------------------------------ dispose

test("dispose() stops all mirroring — no appends from pending timer or later mutations", () => {
  const st = newState();
  const mock = makeMockPi();
  const mirror = createStateMirror(mock.pi, { getState: () => st });

  st.upsertQuestion(choiceQ("q1")); // window pending
  mirror.dispose();
  vi.advanceTimersByTime(10_000); // pending timer must not fire
  st.upsertQuestion(choiceQ("q2")); // unsubscribed — no new window starts
  vi.advanceTimersByTime(10_000);

  expect(mock.appendEntry).not.toHaveBeenCalled();

  mirror.dispose(); // idempotent
  expect(mock.appendEntry).not.toHaveBeenCalled();
});

// ------------------------------------------------ session_shutdown wiring

describe("session_shutdown flush (the index.ts wiring: pi.on → mirror.flush)", () => {
  for (const reason of ["quit", "reload", "new", "resume", "fork"] as const) {
    test(`reason "${reason}" flushes a pending window synchronously`, () => {
      const st = newState();
      const mock = makeMockPi();
      const mirror = createStateMirror(mock.pi, { getState: () => st });
      mock.pi.on("session_shutdown", () => mirror.flush()); // exact index.ts wiring

      st.upsertQuestion(choiceQ("q1"));
      mock.emit("session_shutdown", { reason }); // handler runs synchronously

      expect(mock.appendEntry).toHaveBeenCalledTimes(1);
      expect(entryAt(mock, 0).state.order).toEqual(["q1"]);
      expect(entryAt(mock, 0).at).toBe("2025-06-01T12:00:00.000Z"); // flush at shutdown, not +2s

      vi.advanceTimersByTime(10_000); // timer was cancelled by the flush
      expect(mock.appendEntry).toHaveBeenCalledTimes(1);
      mirror.dispose();
    });
  }

  test("shutdown with nothing pending appends nothing", () => {
    const st = newState();
    const mock = makeMockPi();
    const mirror = createStateMirror(mock.pi, { getState: () => st });
    mock.pi.on("session_shutdown", () => mirror.flush());

    mock.emit("session_shutdown", { reason: "quit" });
    expect(mock.appendEntry).not.toHaveBeenCalled();
    mirror.dispose();
  });
});

// ------------------------------------------- late attach (production shape)

describe("late attach via tool_execution_end discovery", () => {
  test("registers the discovery subscription", () => {
    const mock = makeMockPi();
    const mirror = createStateMirror(mock.pi, { getState: () => undefined });
    expect(mock.on.mock.calls.map((call) => call[0])).toContain("tool_execution_end");
    mirror.dispose();
  });

  test("first upsert's pre-subscription mutation is recovered by the seed window", () => {
    const mock = makeMockPi();
    const mirror = createStateMirror(mock.pi); // default singleton getter — undefined at factory time

    // Production shape: the state comes into existence DURING tool
    // execution, so its `changed` fires before the mirror can subscribe.
    const st = newState();
    setState(st);
    st.upsertQuestion(choiceQ("q1"));

    mock.emit("tool_execution_end", {
      toolCallId: "call-1",
      toolName: "interrogate",
      result: undefined,
      isError: false,
    });

    vi.advanceTimersByTime(STATE_MIRROR_DEBOUNCE_MS);
    expect(mock.appendEntry).toHaveBeenCalledTimes(1);
    expect(entryAt(mock, 0).state.order).toEqual(["q1"]); // seed recovered it
    mirror.dispose();
  });

  test("already-attached instance: further tool ends never fabricate a window", () => {
    const st = newState();
    const mock = makeMockPi();
    const mirror = createStateMirror(mock.pi, { getState: () => st }); // attached at creation, no seed

    st.upsertQuestion(choiceQ("q1"));
    vi.advanceTimersByTime(STATE_MIRROR_DEBOUNCE_MS);
    expect(mock.appendEntry).toHaveBeenCalledTimes(1);

    mock.emit("tool_execution_end", { toolCallId: "call-2", toolName: "interrogate" }); // same instance
    vi.advanceTimersByTime(60_000);
    expect(mock.appendEntry).toHaveBeenCalledTimes(1); // no re-seed, no extra entry
    mirror.dispose();
  });

  test("default singleton path + dispose stops discovery too", () => {
    const st = newState();
    setState(st);
    try {
      const mock = makeMockPi();
      const mirror = createStateMirror(mock.pi); // resolves getState() lazily
      mirror.dispose();

      mock.emit("tool_execution_end", { toolCallId: "call-1", toolName: "interrogate" });
      st.upsertQuestion(choiceQ("q1"));
      vi.advanceTimersByTime(60_000);
      expect(mock.appendEntry).not.toHaveBeenCalled();
    } finally {
      resetState();
    }
  });
});

// ------------------------------------------------------------- misc contract

test("epoch copies the state epoch at flush time", () => {
  const st = newState();
  const mock = makeMockPi();
  const mirror = createStateMirror(mock.pi, { getState: () => st });

  st.upsertQuestion(choiceQ("q1"));
  expect(st.bumpEpoch()).toBe(2); // submission — also emits `changed`

  vi.advanceTimersByTime(2000);
  const data = entryAt(mock, 0);
  expect(data.epoch).toBe(2);
  expect(data.state.epoch).toBe(2);
  mirror.dispose();
});

test("custom debounceMs is honored", () => {
  const st = newState();
  const mock = makeMockPi();
  const mirror = createStateMirror(mock.pi, { getState: () => st, debounceMs: 100 });

  st.upsertQuestion(choiceQ("q1"));
  vi.advanceTimersByTime(99);
  expect(mock.appendEntry).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(mock.appendEntry).toHaveBeenCalledTimes(1);
  mirror.dispose();
});

test("entry type constant is the single source of truth", () => {
  expect(INTERROGATION_STATE_ENTRY_TYPE).toBe("interrogation-state");
});

test("mirror creation and disposal do not touch state (write-only w.r.t. state)", () => {
  const st = newState();
  const mock = makeMockPi();
  const before = st.serialize();
  const mirror = createStateMirror(mock.pi, { getState: () => st });
  mirror.dispose();
  expect(st.serialize()).toEqual(before);
  expect(getState()).toBeUndefined(); // mirror never seeds the singleton
});

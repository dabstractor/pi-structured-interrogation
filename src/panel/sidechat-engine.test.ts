/**
 * src/panel/sidechat-engine.test.ts — unit tests for the side-chat engine:
 * the resolveSideChatModel matrix (override / invalid → notify+fallback /
 * unset → session model / nothing → undefined), the inert snapshot map,
 * context-assembly order, AbortController lifecycle, per-record sessionId
 * stability, guards, the synchronous auth-throw → notice path (T5.S1), and
 * the FULL stream-consumption routing table — delta buffer accumulation,
 * freeze, abort rollback (error-event / done-stopReason / promise shapes),
 * error/auth notices, parser isolation — over a fake async-iterable stream
 * (T5.S2). Fake port/registry/notify ONLY — no provider, no ctx (the
 * injected-port seam is the whole point; SIDECHAT-005 nested-calls-only).
 *
 * Conventions follow sidechat.test.ts: fake dep bags, resetSidechatForTests()
 * in beforeEach, dense decision-ID comments, plain vitest describe/test.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  type Message,
  type Model,
} from "@earendil-works/pi-ai";
import type { InterrogatorConfig } from "../config.js";
import {
  createSidechatEngine,
  modelSnapshotFromModel,
  resolveSideChatModel,
  streamSimplePort,
  type SidechatEngineDeps,
  type SidechatRegistryPort,
} from "./sidechat-engine.js";
import { get, openOrReplace, resetSidechatForTests, type SidechatRebindDeps } from "./sidechat.js";

let seq = 0;

/** Minimal but structurally complete Model<Api> (pi-ai's Model<Api> is field-heavy). */
function fakeModel(provider: string, id: string): Model<Api> {
  seq += 1;
  return {
    id,
    name: `${provider}/${id} #${seq}`,
    api: "anthropic-messages",
    provider,
    baseUrl: "https://example.test/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 1024,
  };
}

/** Registry narrow port: find over a fixed model list, getAvailable echoes it. */
function fakeRegistry(models: Model<Api>[]): SidechatRegistryPort {
  return {
    find: vi.fn((provider, modelId) =>
      models.find((m) => m.provider === provider && m.id === modelId),
    ),
    getAvailable: vi.fn(() => models),
  };
}

/** Config port: absent key stays absent (unset-vs-set detection matters). */
function cfg(sideChatModel?: string): Pick<InterrogatorConfig, "sideChatModel"> {
  return sideChatModel === undefined ? {} : { sideChatModel };
}

/** Structurally complete AssistantMessage carrying one text part. */
function assistantReply(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "prov",
    model: "mdl-1",
    usage: {
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 3,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

/** A completed stream: pushes `done` and ends — settle() freezes the reply. */
function doneStream(text: string): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "done", reason: "stop", message: assistantReply(text) });
  stream.end();
  return stream;
}

/** A stream that never completes — pins the "streaming" guard. */
function pendingStream(): AssistantMessageEventStream {
  return createAssistantMessageEventStream();
}

/** Typed fake port so mock.calls[i][2].sessionId is checked, not cast. */
function fakePort(behavior: () => AssistantMessageEventStream | Promise<AssistantMessage>) {
  return vi.fn(
    (_model: Model<Api>, _context: Context, _options: { signal: AbortSignal; sessionId: string }) =>
      behavior(),
  );
}

/** Structurally complete AssistantMessage with overrides (T5.S2 harness):
 * `text` builds the single text part; `stopReason`/`errorMessage` ride on
 * top of the S1 {@link assistantReply} defaults. */
function fakeAssistantMessage(
  overrides: { text?: string; stopReason?: AssistantMessage["stopReason"]; errorMessage?: string } = {},
): AssistantMessage {
  const base = assistantReply(overrides.text ?? "reply");
  return {
    ...base,
    ...(overrides.stopReason !== undefined ? { stopReason: overrides.stopReason } : {}),
    ...(overrides.errorMessage !== undefined ? { errorMessage: overrides.errorMessage } : {}),
  };
}

/** Fake AssistantMessageEventStream (T5.S2): a plain async-iterable
 * mirroring the EventStream shape — [Symbol.asyncIterator] yields the
 * scripted events in order and ends after the terminal. There is NO
 * result() the engine could lean on; done.message is the result. `observe`
 * runs AFTER each yield has been processed by the engine — the hook the
 * buffer-accumulation and parser-isolation rows snapshot through. */
function fakeStream(
  events: AssistantMessageEvent[],
  observe?: () => void,
): AssistantMessageEventStream {
  async function* iterate(): AsyncGenerator<AssistantMessageEvent> {
    for (const event of events) {
      yield event;
      observe?.();
    }
  }
  return { [Symbol.asyncIterator]: iterate } as unknown as AssistantMessageEventStream;
}

/** The frozen branch-snapshot replay the record opens with (SIDECHAT-003). */
function snapshotMessage(): Message {
  return { role: "user", content: [{ type: "text", text: "snapshot replay" }], timestamp: 1234 };
}

/** Fake rebind bag: fixed model snapshot, "SYS" prompt, one-message snapshot. */
function rebindDeps(overrides?: Partial<SidechatRebindDeps>): SidechatRebindDeps {
  return {
    resolveModelSnapshot: vi.fn(() => ({ provider: "prov", modelId: "mdl-1" })),
    buildSystemPrompt: vi.fn(() => "SYS"),
    buildBranchSnapshot: vi.fn(() => [snapshotMessage()]),
    ...overrides,
  };
}

/** Engine over a live q1 record with sane defaults; override any dep. */
function engineOverRecord(deps: Partial<SidechatEngineDeps> = {}) {
  return createSidechatEngine({
    port: fakePort(() => doneStream("ok")),
    registry: fakeRegistry([fakeModel("prov", "mdl-1")]),
    notify: vi.fn(),
    ...deps,
  });
}

/** Settle only awaits microtasks/timers of already-complete fake streams. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  seq = 0;
  resetSidechatForTests();
});

describe("resolveSideChatModel — resolution matrix (SIDECHAT-003, T5.S1)", () => {
  test("(a) set + parseable + find hit → that Model<Api>, no notify", () => {
    const m = fakeModel("prov", "mdl-1");
    const registry = fakeRegistry([m]);
    const notify = vi.fn();
    expect(resolveSideChatModel(cfg("prov/mdl-1"), registry, undefined, notify)).toBe(m);
    expect(registry.find).toHaveBeenCalledWith("prov", "mdl-1");
    expect(notify).not.toHaveBeenCalled();
  });

  test("(b) set + unknown id → notify ONCE + session model fallback", () => {
    const session = fakeModel("prov", "session-m");
    const notify = vi.fn();
    expect(resolveSideChatModel(cfg("anthropic/nope"), fakeRegistry([]), session, notify)).toBe(session);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notify).mock.calls[0][0]).toContain("anthropic/nope");
  });

  test("(b2) unknown id + no session model → notify ONCE + first available", () => {
    const first = fakeModel("prov", "first");
    const notify = vi.fn();
    expect(resolveSideChatModel(cfg("x/y"), fakeRegistry([first]), undefined, notify)).toBe(first);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  test("(c) unset → session model, notify untouched", () => {
    const session = fakeModel("prov", "session-m");
    const notify = vi.fn();
    expect(resolveSideChatModel(cfg(), fakeRegistry([]), session, notify)).toBe(session);
    expect(notify).not.toHaveBeenCalled();
  });

  test("(c2) blank string behaves as unset (no notify)", () => {
    const session = fakeModel("prov", "session-m");
    const notify = vi.fn();
    expect(resolveSideChatModel(cfg("   "), fakeRegistry([]), session, notify)).toBe(session);
    expect(notify).not.toHaveBeenCalled();
  });

  test("(d) malformed 'noslash' → notify ONCE + session model", () => {
    const session = fakeModel("prov", "session-m");
    const notify = vi.fn();
    expect(resolveSideChatModel(cfg("noslash"), fakeRegistry([]), session, notify)).toBe(session);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  test("(d2) empty halves ('prov/' and '/x') count as malformed", () => {
    const session = fakeModel("prov", "session-m");
    const notify = vi.fn();
    expect(resolveSideChatModel(cfg("prov/"), fakeRegistry([]), session, notify)).toBe(session);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(resolveSideChatModel(cfg("/x"), fakeRegistry([]), session, notify)).toBe(session);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  test("(e) unset + no session model + empty registry → undefined (inert)", () => {
    const notify = vi.fn();
    expect(resolveSideChatModel(cfg(), fakeRegistry([]), undefined, notify)).toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("modelSnapshotFromModel — inert marker map (P1.M2.T1.S2)", () => {
  test("(f) undefined → empty {provider:'', modelId:''} marker", () => {
    expect(modelSnapshotFromModel(undefined)).toEqual({ provider: "", modelId: "" });
  });

  test("resolved model → {provider, modelId: id}", () => {
    expect(modelSnapshotFromModel(fakeModel("prov", "mdl-1"))).toEqual({
      provider: "prov",
      modelId: "mdl-1",
    });
  });
});

describe("createSidechatEngine — dispatch & context assembly (T5.S1)", () => {
  test("port receives exactly [snapshot, turns] with own systemPrompt and no tools", async () => {
    openOrReplace("q1", rebindDeps());
    const port = fakePort(() => doneStream("answer text"));
    const engine = engineOverRecord({ port });
    expect(engine.sendTurn("why is sqlite recommended here?")).toBe(true);

    expect(port).toHaveBeenCalledTimes(1);
    const [model, context, options] = port.mock.calls[0]!;
    expect(model.id).toBe("mdl-1"); // re-derived from the frozen snapshot
    expect(context.systemPrompt).toBe("SYS"); // record.systemPrompt (T4.S2)
    expect("tools" in context).toBe(false); // NEVER tools (SIDECHAT-005)
    expect(context.messages).toEqual([
      snapshotMessage(), // frozen branch replay FIRST (SIDECHAT-003)
      {
        role: "user",
        content: [{ type: "text", text: "why is sqlite recommended here?" }],
        timestamp: expect.any(Number),
      }, // then the live turn, mapped ChatMessage
    ]);
    expect(options.signal).toBe(get()!.abortController.signal);
    expect(typeof options.sessionId).toBe("string");

    await flush();
    const record = get()!;
    expect(record.streamState).toBe("idle");
    expect(record.messages).toEqual([
      { role: "user", text: "why is sqlite recommended here?", at: expect.any(String) },
      // joined text frozen + stop reason recorded (P1.M1.T5.S2)
      { role: "assistant", text: "answer text", at: expect.any(String), stopReason: "stop" },
    ]);
  });

  test("promise-returning port settles with the assistant reply", async () => {
    openOrReplace("q1", rebindDeps());
    const engine = engineOverRecord({ port: fakePort(async () => assistantReply("promised")) });
    expect(engine.sendTurn("hi")).toBe(true);
    await flush();
    const record = get()!;
    expect(record.streamState).toBe("idle");
    expect(record.messages).toEqual([
      { role: "user", text: "hi", at: expect.any(String) },
      { role: "assistant", text: "promised", at: expect.any(String), stopReason: "stop" },
    ]);
  });
});

describe("createSidechatEngine — controller & sessionId lifecycle (T5.S1)", () => {
  test("fresh AbortController per turn; abort() signals the LIVE one; sessionId stable", async () => {
    openOrReplace("q1", rebindDeps());
    const port = fakePort(() => doneStream("ok"));
    const engine = engineOverRecord({ port });

    engine.sendTurn("first");
    const c1 = get()!.abortController;
    const session1 = port.mock.calls[0]![2]!.sessionId;
    await flush();

    engine.sendTurn("second");
    const c2 = get()!.abortController;
    const session2 = port.mock.calls[1]![2]!.sessionId;

    expect(c2).not.toBe(c1); // TWO turns → two DISTINCT controllers
    expect(c1.signal.aborted).toBe(false); // the old one was never aborted
    expect(session2).toBe(session1); // SAME record identity → SAME sessionId (prefix cache)

    engine.abort();
    expect(c2.signal.aborted).toBe(true); // live controller signaled
    expect(c1.signal.aborted).toBe(false);
  });

  test("sessionId regenerates when the record is replaced (SIDECHAT-002)", () => {
    openOrReplace("q1", rebindDeps());
    const port = fakePort(() => doneStream("ok"));
    const engine = engineOverRecord({ port });
    engine.sendTurn("a");
    const s1 = port.mock.calls[0]![2]!.sessionId;
    openOrReplace("q2", rebindDeps()); // wholesale replacement, new record object
    engine.sendTurn("b");
    expect(port.mock.calls[1]![2]!.sessionId).not.toBe(s1);
  });
});

describe("createSidechatEngine — guards (T5.S1)", () => {
  test("no live record → false, port never called", () => {
    const port = fakePort(() => doneStream("ok"));
    const engine = engineOverRecord({ port });
    expect(engine.sendTurn("ghost")).toBe(false);
    expect(port).not.toHaveBeenCalled();
  });

  test("already streaming → false (no queueing, no double-controller)", () => {
    openOrReplace("q1", rebindDeps());
    const port = fakePort(() => pendingStream());
    const engine = engineOverRecord({ port });
    expect(engine.sendTurn("hold")).toBe(true);
    expect(get()!.streamState).toBe("streaming");
    expect(engine.sendTurn("queued")).toBe(false);
    expect(port).toHaveBeenCalledTimes(1);
  });

  test("inert record (empty snapshot) → true, NO port call, error notice, idle", () => {
    openOrReplace(
      "q1",
      rebindDeps({ resolveModelSnapshot: vi.fn(() => ({ provider: "", modelId: "" })) }),
    );
    const port = fakePort(() => doneStream("ok"));
    const engine = engineOverRecord({ port });
    expect(engine.sendTurn("hi")).toBe(true); // turn recorded, dispatch refused
    const record = get()!;
    expect(port).not.toHaveBeenCalled();
    expect(record.notices).toEqual([expect.objectContaining({ kind: "error" })]);
    expect(record.streamState).toBe("idle");
    expect(record.messages.map((m) => m.role)).toEqual(["user"]);
  });
});

describe("createSidechatEngine — failure paths never block the panel (T5.S1)", () => {
  test("synchronous port throw (missing auth) → auth notice + idle, no assistant message", () => {
    openOrReplace("q1", rebindDeps());
    const port = fakePort(() => {
      throw new Error("no auth configured for provider");
    });
    const engine = engineOverRecord({ port });
    expect(engine.sendTurn("hi")).toBe(true); // turn accepted; panel never blocks
    const record = get()!;
    expect(record.streamState).toBe("idle");
    expect(record.notices).toEqual([
      { kind: "auth", text: expect.stringContaining("no auth"), at: expect.any(String) },
    ]);
    expect(record.messages.map((m) => m.role)).toEqual(["user"]); // NO assistant message
  });

  test("stream error event → idle, no assistant message (T5.S2 refines)", async () => {
    openOrReplace("q1", rebindDeps());
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "error", reason: "error", error: assistantReply("boom") });
    stream.end();
    const engine = engineOverRecord({ port: fakePort(() => stream) });
    expect(engine.sendTurn("hi")).toBe(true);
    await flush();
    const record = get()!;
    expect(record.streamState).toBe("idle");
    expect(record.messages.map((m) => m.role)).toEqual(["user"]);
  });

  test("reply landing after wholesale replacement never touches the dead record", async () => {
    openOrReplace("q1", rebindDeps());
    let release!: (m: AssistantMessage) => void;
    const port = fakePort(
      () => new Promise<AssistantMessage>((resolve) => (release = resolve)),
    );
    const engine = engineOverRecord({ port });
    engine.sendTurn("slow");
    const dead = get()!;
    openOrReplace("q2", rebindDeps()); // replace mid-flight (SIDECHAT-002)
    release(assistantReply("late"));
    await flush();
    expect(dead.streamState).toBe("streaming"); // dead record untouched by settle
    expect(dead.messages.map((m) => m.role)).toEqual(["user"]);
    expect(get()!.streamState).toBe("idle"); // the live record is idle
  });

  test("abort() without a record is a no-op", () => {
    expect(() => engineOverRecord().abort()).not.toThrow();
  });
});

describe("createSidechatEngine — stream consumption routing table (T5.S2)", () => {
  test("happy path: buffer accumulates per event, done freezes canonical text + stopReason", async () => {
    openOrReplace("q1", rebindDeps());
    const buffers: string[] = [];
    const events: AssistantMessageEvent[] = [
      { type: "start", partial: assistantReply("") },
      { type: "text_delta", contentIndex: 0, delta: "He", partial: assistantReply("He") },
      // partial is cumulative — note "Hello" ≠ "He"+"llo world" delta concat
      { type: "text_delta", contentIndex: 0, delta: "llo", partial: assistantReply("Hello") },
      // canonical done text differs from the last partial: freeze must read done.message
      {
        type: "done",
        reason: "stop",
        message: fakeAssistantMessage({ text: "Hello world" }),
      },
    ];
    const engine = engineOverRecord({
      port: fakePort(() => fakeStream(events, () => buffers.push(get()!.streamingText))),
    });
    expect(engine.sendTurn("hi")).toBe(true);
    await flush();
    const record = get()!;
    // "" after start, "He", "Hello" after each delta. No 4th observation:
    // the engine returns from the loop at the terminal (settle is inline),
    // so the iterator closes before the generator could observe again — the
    // post-settle clear is asserted via record.streamingText below.
    expect(buffers).toEqual(["", "He", "Hello"]);
    expect(record.streamingText).toBe("");
    expect(record.streamState).toBe("idle");
    expect(record.messages).toEqual([
      { role: "user", text: "hi", at: expect.any(String) },
      { role: "assistant", text: "Hello world", at: expect.any(String), stopReason: "stop" },
    ]);
    expect(record.notices).toEqual([]);
  });

  test("abort via error{reason:'aborted'} → FULL rollback: user turn popped, no notice", async () => {
    openOrReplace("q1", rebindDeps());
    const roles: string[][] = [];
    const buffers: string[] = [];
    const events: AssistantMessageEvent[] = [
      { type: "text_delta", contentIndex: 0, delta: "par", partial: assistantReply("par") },
      {
        type: "error",
        reason: "aborted",
        error: fakeAssistantMessage({ text: "par", stopReason: "aborted" }),
      },
    ];
    const engine = engineOverRecord({
      port: fakePort(() =>
        fakeStream(events, () => {
          roles.push(get()!.messages.map((m) => m.role));
          buffers.push(get()!.streamingText);
        }),
      ),
    });
    engine.sendTurn("fleeting question");
    await flush();
    // Mid-stream: user turn present, partial text in the buffer.
    expect(roles[0]).toEqual(["user"]);
    expect(buffers[0]).toBe("par");
    const record = get()!;
    expect(record.messages).toEqual([]); // "the turn never happened"
    expect(record.streamingText).toBe("");
    expect(record.streamState).toBe("idle");
    expect(record.notices).toEqual([]); // esc is deliberate — NO notice
  });

  test("abort via done carrying terminal stopReason 'aborted' → identical rollback", async () => {
    openOrReplace("q1", rebindDeps());
    const events = [
      { type: "text_delta", contentIndex: 0, delta: "par", partial: assistantReply("par") },
      {
        type: "done",
        reason: "aborted",
        message: fakeAssistantMessage({ text: "par", stopReason: "aborted" }),
      },
    ] as unknown as AssistantMessageEvent[]; // off-union: real streams signal abort via error
    const engine = engineOverRecord({ port: fakePort(() => fakeStream(events)) });
    engine.sendTurn("hi");
    await flush();
    const record = get()!;
    expect(record.messages).toEqual([]); // user POPPED, no assistant row
    expect(record.streamingText).toBe("");
    expect(record.streamState).toBe("idle");
    expect(record.notices).toEqual([]);
  });

  test("abort via promise branch (resolved stopReason 'aborted') → identical rollback", async () => {
    openOrReplace("q1", rebindDeps());
    const engine = engineOverRecord({
      port: fakePort(async () => fakeAssistantMessage({ stopReason: "aborted" })),
    });
    engine.sendTurn("hi");
    await flush();
    const record = get()!;
    expect(record.messages).toEqual([]); // user POPPED
    expect(record.streamingText).toBe(""); // promise branch: buffer never set, stays ""
    expect(record.streamState).toBe("idle");
    expect(record.notices).toEqual([]);
  });

  test("other error event → error notice, user turn KEPT, no assistant row, idle", async () => {
    openOrReplace("q1", rebindDeps());
    const events = [
      { type: "text_delta", contentIndex: 0, delta: "par", partial: assistantReply("par") },
      {
        type: "error",
        reason: "rate_limited",
        error: fakeAssistantMessage({ text: "par" }),
      },
    ] as unknown as AssistantMessageEvent[]; // off-union reason: any non-aborted failure
    const engine = engineOverRecord({ port: fakePort(() => fakeStream(events)) });
    engine.sendTurn("hi");
    await flush();
    const record = get()!;
    expect(record.streamState).toBe("idle");
    expect(record.streamingText).toBe("");
    expect(record.messages.map((m) => m.role)).toEqual(["user"]); // user turn kept
    expect(record.messages).toHaveLength(1); // NO assistant row
    expect(record.notices).toEqual([
      { kind: "error", text: "rate_limited", at: expect.any(String) },
    ]);
  });

  test("done with stopReason 'error' + errorMessage → notice (text = errorMessage), no freeze", async () => {
    openOrReplace("q1", rebindDeps());
    const events = [
      {
        type: "done",
        reason: "error",
        message: fakeAssistantMessage({ text: "half", stopReason: "error", errorMessage: "boom" }),
      },
    ] as unknown as AssistantMessageEvent[]; // off-union: done never carries 'error' in real streams
    const engine = engineOverRecord({ port: fakePort(() => fakeStream(events)) });
    engine.sendTurn("hi");
    await flush();
    const record = get()!;
    expect(record.streamState).toBe("idle");
    expect(record.messages.map((m) => m.role)).toEqual(["user"]); // NO freeze
    expect(record.notices).toEqual([{ kind: "error", text: "boom", at: expect.any(String) }]);
  });

  test("parser isolation: mid-stream record.messages has no assistant row; after abort none; after done exactly one", async () => {
    openOrReplace("q1", rebindDeps());
    const roleSets: string[][] = [];
    const abortEvents: AssistantMessageEvent[] = [
      { type: "text_delta", contentIndex: 0, delta: "par", partial: assistantReply("par") },
      {
        type: "error",
        reason: "aborted",
        error: fakeAssistantMessage({ stopReason: "aborted" }),
      },
    ];
    const abortEngine = engineOverRecord({
      port: fakePort(() => fakeStream(abortEvents, () => roleSets.push(get()!.messages.map((m) => m.role)))),
    });
    abortEngine.sendTurn("first");
    await flush();
    // Mid-stream: the user turn is visible, NO assistant row ever appeared.
    expect(roleSets.every((roles) => roles.every((r) => r === "user"))).toBe(true);
    expect(get()!.messages).toEqual([]); // after abort: none

    const doneEngine = engineOverRecord({ port: fakePort(() => doneStream("final")) });
    doneEngine.sendTurn("second");
    await flush();
    expect(get()!.messages.map((m) => m.role)).toEqual(["user", "assistant"]); // exactly one
    expect(get()!.messages.filter((m) => m.role === "assistant")).toEqual([
      { role: "assistant", text: "final", at: expect.any(String), stopReason: "stop" },
    ]);
  });

  test("chat stays usable: after an error notice the next sendTurn dispatches and freezes", async () => {
    openOrReplace("q1", rebindDeps());
    let call = 0;
    const port = fakePort(() => {
      call += 1;
      return call === 1
        ? fakeStream([
            { type: "error", reason: "error", error: fakeAssistantMessage({ stopReason: "error" }) },
          ])
        : doneStream("recovered");
    });
    const engine = engineOverRecord({ port });
    engine.sendTurn("first");
    await flush();
    expect(get()!.notices).toEqual([expect.objectContaining({ kind: "error" })]);
    expect(get()!.streamState).toBe("idle"); // settle unblocked the guard

    expect(engine.sendTurn("again")).toBe(true); // port called again
    await flush();
    expect(port).toHaveBeenCalledTimes(2);
    const record = get()!;
    expect(record.messages.map((m) => m.role)).toEqual(["user", "user", "assistant"]);
    expect(record.messages[2]).toMatchObject({ text: "recovered", stopReason: "stop" });
    expect(record.streamState).toBe("idle");
  });

  test("defensible pop: abort when the tail is NOT this turn's user entry → pop skipped, no crash", async () => {
    openOrReplace("q1", rebindDeps());
    const events: AssistantMessageEvent[] = [
      { type: "text_delta", contentIndex: 0, delta: "par", partial: assistantReply("par") },
      { type: "error", reason: "aborted", error: fakeAssistantMessage({ stopReason: "aborted" }) },
    ];
    const engine = engineOverRecord({ port: fakePort(() => fakeStream(events)) });
    engine.sendTurn("hi");
    // Simulate a foreign append racing the stream: the tail is no longer the
    // turn's user entry, so the reference-checked pop MUST skip it.
    get()!.messages.push({ role: "assistant", text: "foreign tail", at: "T" });
    await flush();
    const record = get()!;
    expect(record.messages).toEqual([
      { role: "user", text: "hi", at: expect.any(String) }, // user turn untouched
      { role: "assistant", text: "foreign tail", at: "T" },
    ]);
    expect(record.streamState).toBe("idle"); // settled, not crashed
    expect(record.streamingText).toBe("");
  });

  test("stream closed without a terminal → error notice, user kept, idle (no stranded 'streaming')", async () => {
    openOrReplace("q1", rebindDeps());
    const engine = engineOverRecord({
      port: fakePort(() =>
        fakeStream([
          { type: "text_delta", contentIndex: 0, delta: "par", partial: assistantReply("par") },
        ]),
      ),
    });
    engine.sendTurn("hi");
    await flush();
    const record = get()!;
    expect(record.streamState).toBe("idle");
    expect(record.streamingText).toBe("");
    expect(record.messages.map((m) => m.role)).toEqual(["user"]);
    expect(record.notices).toEqual([
      { kind: "error", text: "stream ended before a reply", at: expect.any(String) },
    ]);
  });

  test("unexpected throw mid-iteration → error notice + idle (consumption wrapped)", async () => {
    openOrReplace("q1", rebindDeps());
    const engine = engineOverRecord({
      port: fakePort(() => {
        async function* explode(): AsyncGenerator<AssistantMessageEvent> {
          yield { type: "text_delta", contentIndex: 0, delta: "x", partial: assistantReply("x") };
          throw new Error("harness explosion");
        }
        return { [Symbol.asyncIterator]: explode } as unknown as AssistantMessageEventStream;
      }),
    });
    engine.sendTurn("hi");
    await flush();
    const record = get()!;
    expect(record.streamState).toBe("idle"); // never stranded "streaming"
    expect(record.streamingText).toBe("");
    expect(record.messages.map((m) => m.role)).toEqual(["user"]);
    expect(record.notices).toEqual([
      { kind: "error", text: expect.stringContaining("harness explosion"), at: expect.any(String) },
    ]);
  });
});

describe("streamSimplePort — production binding (exported, UNWIRED)", () => {
  test("the binding exists as a function; wiring is P1.M2.T4.S1's", () => {
    expect(typeof streamSimplePort).toBe("function");
  });
});

/**
 * src/compaction.test.ts — unit tests for the session_before_compact
 * preservation guard (P1.M7.T2.S1; FR-29/h2.42). A bare mock `{ on }` stands
 * in for pi (the lifecycle.test.ts/delivery.test.ts convention); the compaction
 * event and ctx are hand-built fixtures and the model registry is a vi.fn
 * `complete` — no runtime, no network. The state singleton is never touched:
 * the guard under test takes an injectable `getState` (StateMirrorOptions
 * pattern), so every case drives its own fixture state.
 */
import type { ExtensionAPI, ExtensionContext, SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, test, vi, type Mock } from "vitest";
import {
  buildPreservationPrompt,
  createCompactionGuard,
  PRESERVATION_INSTRUCTIONS,
  type PreservationPromptMessage,
} from "./compaction.js";
import { DEFAULT_CONFIG, type InterrogatorConfig } from "./config.js";
import { createInterrogationState, type InterrogationState, type Question } from "./state.js";

// ------------------------------------------------------------------ mock pi

type CompactionHandler = (event: unknown, ctx: unknown) => Promise<unknown>;

function makeMockPi() {
  const handlers = new Map<string, CompactionHandler>();
  const on = vi.fn((event: string, handler: CompactionHandler) => {
    handlers.set(event, handler);
    return () => handlers.delete(event);
  });
  const pi = { on } as unknown as Pick<ExtensionAPI, "on">;
  return {
    pi,
    on,
    /** Invoke the captured session_before_compact handler (async). */
    callHandler(event: unknown, ctx: unknown): Promise<unknown> {
      const handler = handlers.get("session_before_compact");
      if (handler === undefined) throw new Error("session_before_compact handler not registered");
      return handler(event, ctx);
    },
  };
}

// ----------------------------------------------------------------- fixtures

const USAGE = { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 };
const MODEL = { id: "test-model", provider: "test-provider" };

function userMsg(text: string, timestamp = 1) {
  return { role: "user" as const, content: [{ type: "text" as const, text }], timestamp };
}

function assistantText(text: string) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "openai-completions",
    provider: "test-provider",
    model: "test-model",
    usage: USAGE,
    stopReason: "stop" as const,
  };
}

function makeEvent(overrides: Record<string, unknown> = {}): SessionBeforeCompactEvent {
  return {
    type: "session_before_compact",
    preparation: {
      firstKeptEntryId: "kept-entry-1",
      messagesToSummarize: [userMsg("please implement feature X")],
      turnPrefixMessages: [],
      isSplitTurn: false,
      tokensBefore: 42424,
      fileOps: { read: new Set(), written: new Set(), edited: new Set() },
      settings: { enabled: true, reserveTokens: 20000, keepRecentTokens: 20000 },
    },
    branchEntries: [],
    reason: "manual",
    willRetry: false,
    signal: new AbortController().signal,
    ...overrides,
  } as unknown as SessionBeforeCompactEvent;
}

/** Fake event ctx: active model + registry whose `complete` is the test seam. */
function makeCtx(opts: { noModel?: boolean; complete?: Mock } = {}) {
  const complete =
    opts.complete ?? vi.fn(async () => assistantText("preserved summary"));
  const ctx = {
    mode: "tui",
    model: opts.noModel ? undefined : MODEL,
    modelRegistry: {
      getAvailable: vi.fn(() => (opts.noModel ? [] : [MODEL])),
      complete,
    },
  };
  return { ctx: ctx as unknown as ExtensionContext, complete };
}

const OPTS_AB = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];

function choiceQ(id: string): Question {
  return {
    id,
    prompt: `prompt:${id}`,
    type: "choice",
    rev: 1,
    status: "open",
    options: OPTS_AB.map((o) => ({ ...o })),
  };
}

function stateWithQuestions(): InterrogationState {
  const st = createInterrogationState("ship the feature");
  st.upsertQuestion(choiceQ("q1"));
  return st;
}

// ------------------------------------------------------------------- setup

interface Setup {
  on: Mock;
  flush: Mock;
  complete: Mock;
  state: InterrogationState | undefined;
  /** Fire the captured handler with an optional event override. */
  run(eventOverrides?: Record<string, unknown>): Promise<unknown>;
  runEvent(event: SessionBeforeCompactEvent): Promise<unknown>;
}

function setup(
  opts: {
    config?: InterrogatorConfig;
    /** Explicit `undefined` = no state; omitted = active fixture state. */
    state?: InterrogationState | undefined;
    noModel?: boolean;
    complete?: Mock;
    flush?: Mock;
  } = {},
): Setup {
  const flush = opts.flush ?? vi.fn();
  const config = opts.config ?? DEFAULT_CONFIG;
  const state = opts.state === undefined && !("state" in opts) ? stateWithQuestions() : opts.state;
  const mock = makeMockPi();
  const { ctx, complete } = makeCtx({ noModel: opts.noModel, complete: opts.complete });
  createCompactionGuard(mock.pi, { config, mirror: { flush }, getState: () => state });
  return {
    on: mock.on,
    flush,
    complete,
    state,
    run: (eventOverrides = {}) => mock.callHandler(makeEvent(eventOverrides), ctx),
    runEvent: (event) => mock.callHandler(event, ctx),
  };
}

/** Extract the summarizer prompt text from the (first) complete call. */
function promptTextOf(complete: Mock): string {
  const context = complete.mock.calls[0][1] as { messages: PreservationPromptMessage[] };
  return context.messages[0].content[0].text;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ------------------------------------------------------------- the constant

test("PRESERVATION_INSTRUCTIONS matches the PRD h2.42 text byte-for-byte", () => {
  expect(PRESERVATION_INSTRUCTIONS).toBe(
    "Preserve verbatim: the user's stated goals and plan constraints from all messages (including side conversations), all interrogation answers and later changes, the interrogation goal, and the fact that current interrogation state is available via interrogate({}).",
  );
});

// ------------------------------------------------------------ subscriptions

test("subscribes to session_before_compact", () => {
  const s = setup();
  expect(s.on).toHaveBeenCalledWith("session_before_compact", expect.any(Function));
});

// ------------------------------------------------------- undefined fallbacks

test("(a) disabled toggle → undefined, complete NOT called, mirror NOT flushed", async () => {
  const s = setup({ config: { ...DEFAULT_CONFIG, compactionPreservation: false } });
  await expect(s.run()).resolves.toBeUndefined();
  expect(s.complete).not.toHaveBeenCalled();
  expect(s.flush).not.toHaveBeenCalled();
});

test("(b) no state (getState undefined) → undefined, no calls", async () => {
  const s = setup({ state: undefined });
  await expect(s.run()).resolves.toBeUndefined();
  expect(s.complete).not.toHaveBeenCalled();
  expect(s.flush).not.toHaveBeenCalled();
});

test("(c) zero ordered questions → undefined, no calls", async () => {
  const s = setup({ state: createInterrogationState("goal with no questions") });
  await expect(s.run()).resolves.toBeUndefined();
  expect(s.complete).not.toHaveBeenCalled();
  expect(s.flush).not.toHaveBeenCalled();
});

test("(e) no model resolvable → undefined, complete NOT called, mirror still flushed", async () => {
  const s = setup({ noModel: true });
  await expect(s.run()).resolves.toBeUndefined();
  expect(s.complete).not.toHaveBeenCalled();
  expect(s.flush).toHaveBeenCalledTimes(1);
});

test("(f) complete rejection → undefined, no throw, single console.error line", async () => {
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const complete = vi.fn(async () => {
    throw new Error("model exploded");
  });
  const s = setup({ complete });
  await expect(s.run()).resolves.toBeUndefined();
  expect(errSpy).toHaveBeenCalledTimes(1);
  expect(s.flush).toHaveBeenCalledTimes(1); // fresh entry landed despite the failure
});

test("mirror.flush throwing is contained → undefined + console.error once", async () => {
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const flush: Mock = vi.fn((): void => {
    throw new Error("appendEntry failed");
  });
  const s = setup({ flush });
  await expect(s.run()).resolves.toBeUndefined();
  expect(s.complete).not.toHaveBeenCalled();
  expect(errSpy).toHaveBeenCalledTimes(1);
});

test("(g) signal aborted after complete resolves → undefined", async () => {
  const controller = new AbortController();
  const complete = vi.fn(async () => {
    controller.abort();
    return assistantText("summary that arrived anyway");
  });
  const s = setup({ complete });
  const event = makeEvent({ signal: controller.signal });
  await expect(s.runEvent(event)).resolves.toBeUndefined();
  expect(s.flush).toHaveBeenCalledTimes(1);
});

test("(h) blank summary text → undefined", async () => {
  const complete = vi.fn(async () => assistantText("   \n  "));
  const s = setup({ complete });
  await expect(s.run()).resolves.toBeUndefined();
});

// ------------------------------------------------------------- the happy path

test("(d) active interrogation → flush BEFORE complete, preservation prompt, compaction result", async () => {
  const s = setup();
  const event = makeEvent();
  const result = (await s.runEvent(event)) as {
    compaction: { summary: string; firstKeptEntryId: string; tokensBefore: number; usage: unknown };
  };

  // Mirror flushed exactly once, before the model call.
  expect(s.flush).toHaveBeenCalledTimes(1);
  expect(s.flush.mock.invocationCallOrder[0]).toBeLessThan(s.complete.mock.invocationCallOrder[0]);

  // Prompt carries the preservation instructions verbatim, prepended.
  const promptText = promptTextOf(s.complete);
  expect(promptText.startsWith(PRESERVATION_INSTRUCTIONS)).toBe(true);
  expect(promptText).toContain("[User]: please implement feature X");
  expect(promptText).toContain("<conversation>");

  // complete options: signal forwarded, 8192 cap, no cache, fresh session id.
  const [calledModel, , options] = s.complete.mock.calls[0] as [
    unknown,
    unknown,
    { maxTokens: number; signal: AbortSignal; cacheRetention: string; sessionId: string },
  ];
  expect(calledModel).toBe(MODEL); // active conversation model — no hardcoded provider
  expect(options.maxTokens).toBe(8192);
  expect(options.signal).toBe(event.signal);
  expect(options.cacheRetention).toBe("none");
  expect(typeof options.sessionId).toBe("string");

  // Returned compaction shape, field-for-field from preparation/response.
  expect(result).toEqual({
    compaction: {
      summary: "preserved summary",
      firstKeptEntryId: "kept-entry-1",
      tokensBefore: 42424,
      usage: USAGE,
    },
  });
});

test("(i) previousSummary present → prompt carries the <previous-summary> block", async () => {
  const s = setup();
  await s.run({
    preparation: {
      firstKeptEntryId: "kept-entry-1",
      messagesToSummarize: [userMsg("please implement feature X")],
      turnPrefixMessages: [],
      isSplitTurn: false,
      tokensBefore: 42424,
      previousSummary: "earlier compaction summary",
      fileOps: { read: new Set(), written: new Set(), edited: new Set() },
      settings: { enabled: true, reserveTokens: 20000, keepRecentTokens: 20000 },
    },
  });
  const promptText = promptTextOf(s.complete);
  expect(promptText).toContain("<previous-summary>");
  expect(promptText).toContain("earlier compaction summary");
});

// --------------------------------------------------- pure prompt builder (j)

test("(j) buildPreservationPrompt: preservation text first, conversation wrapped, message order kept", () => {
  const messages = buildPreservationPrompt({
    messagesToSummarize: [userMsg("hello there")],
    turnPrefixMessages: [userMsg("prefix msg", 2)],
    previousSummary: undefined,
  });
  expect(messages).toHaveLength(1);
  expect(messages[0].role).toBe("user");
  expect(messages[0].content).toHaveLength(1);
  expect(typeof messages[0].timestamp).toBe("number");

  const text = messages[0].content[0].text;
  // Preservation instructions are the FIRST bytes.
  expect(text.startsWith(PRESERVATION_INSTRUCTIONS)).toBe(true);
  expect(text.indexOf(PRESERVATION_INSTRUCTIONS)).toBeLessThan(text.indexOf("<conversation>"));
  // Both message lists serialized, in order, inside the conversation wrapper.
  const conversation = text.slice(text.indexOf("<conversation>"));
  expect(conversation).toContain("[User]: hello there");
  expect(conversation.indexOf("[User]: hello there")).toBeLessThan(conversation.indexOf("[User]: prefix msg"));
  expect(conversation).toContain("</conversation>");
  // No previous-summary block when absent.
  expect(text).not.toContain("<previous-summary>");
});

test("(j) buildPreservationPrompt with previousSummary → block present before the conversation", () => {
  const messages = buildPreservationPrompt({
    messagesToSummarize: [userMsg("hello there")],
    turnPrefixMessages: [],
    previousSummary: "iterative context",
  });
  const text = messages[0].content[0].text;
  const previousStart = text.indexOf("<previous-summary>");
  const conversationStart = text.indexOf("<conversation>");
  expect(previousStart).toBeGreaterThan(-1);
  expect(previousStart).toBeLessThan(conversationStart);
  expect(text).toContain("iterative context");
});

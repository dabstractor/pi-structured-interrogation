/**
 * src/remote-bridge.test.ts — FR-31..34 unit coverage (plan §5.1):
 * toAskQuestions mapping table (D-R3), full lifecycle on a fake events bus
 * (started payload shape → submit → submit-result → completed → resurface),
 * cancel/stale/foreign/malformed filtering, invalid-answer handling, and
 * the config gates.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { DEFAULT_CONFIG, type InterrogatorConfig } from "./config.js";
import {
  PI_ASK_COMPLETED,
  PI_ASK_STARTED,
  PI_ASK_SUBMIT_RESULT,
  createRemoteBridge,
  liveQuestions,
  toAskQuestions,
  type RemoteBridge,
} from "./remote-bridge.js";
import { createInterrogationState, getState, resetState, setState, type InterrogationState } from "./state.js";

// ------------------------------------------------------------ fake bus + pi

type Handler = (data: unknown) => void;

class FakeBus {
  handlers = new Map<string, Set<Handler>>();
  emitted: { event: string; data: unknown }[] = [];

  on(event: string, handler: Handler): () => void {
    const set = this.handlers.get(event) ?? new Set<Handler>();
    set.add(handler);
    this.handlers.set(event, set);
    return () => set.delete(handler);
  }

  emit(event: string, data: unknown): void {
    this.emitted.push({ event, data });
    for (const h of this.handlers.get(event) ?? []) h(data);
  }

  of(event: string): unknown[] {
    return this.emitted.filter((e) => e.event === event).map((e) => e.data);
  }
}

function makePi(bus: FakeBus) {
  const sent: unknown[] = [];
  return {
    pi: {
      events: bus,
      sendMessage: (msg: unknown) => {
        sent.push(msg);
      },
    } as unknown as Parameters<typeof createRemoteBridge>[0],
    sent,
  };
}

function noteDelivered(): { calls: number } {
  const ledger = { calls: 0 };
  return ledger;
}

function makeBridge(
  config: InterrogatorConfig = DEFAULT_CONFIG,
): { bridge: RemoteBridge; bus: FakeBus; sent: unknown[]; ledger: { calls: number } } {
  const bus = new FakeBus();
  const { pi, sent } = makePi(bus);
  const ledger = noteDelivered();
  const bridge = createRemoteBridge(pi, {
    config,
    lifecycle: { noteSubmissionDelivered: () => void ledger.calls++ },
  });
  return { bridge, bus, sent, ledger };
}

/** Fixture: q1 choice (postgres recommended, ramifications), q2 text, q3 answered, q4 withdrawn. */
function fixtureState(): InterrogationState {
  const state = createInterrogationState("Plan the migration");
  state.upsertQuestion({
    id: "q1",
    title: "Database engine",
    prompt: "Which database engine should we target?",
    description: "The engine choice constrains migrations, tooling, and ops.",
    type: "choice",
    options: [
      { value: "sqlite", label: "SQLite", ramification: "Zero-ops, single writer." },
      { value: "postgres", label: "PostgreSQL", ramification: "Full ACID, needs a server." },
    ],
    recommendation: "postgres",
    rev: 1,
    status: "open",
  });
  state.upsertQuestion({
    id: "q2",
    prompt: "Any constraints on downtime?",
    type: "text",
    rev: 1,
    status: "open",
  });
  state.upsertQuestion({
    id: "q3",
    prompt: "Answered already?",
    type: "choice",
    options: [{ value: "y", label: "Yes" }],
    rev: 1,
    status: "open",
  });
  state.upsertQuestion({
    id: "q4",
    prompt: "Withdrawn?",
    type: "text",
    rev: 1,
    status: "open",
  });
  // Statuses AFTER upsert (upsertQuestion forces new ids to "open"): q3 is
  // answered-pending (not live for the bridge), q4 terminal.
  state.applyAnswer("q3", { value: "y", at: "2026-01-01T00:00:00.000Z" });
  state.setStatus("q4", "withdrawn");
  return state;
}

beforeEach(() => {
  resetState();
});

// ------------------------------------------------------------ D-R3 mapping

describe("toAskQuestions (D-R3)", () => {
  test("maps live questions only: answered and terminal excluded", () => {
    const qs = toAskQuestions(fixtureState().serialize());
    expect(qs.map((q) => q.id)).toEqual(["q1", "q2"]);
  });

  test("prompt carries description appended; label carries title (explicit)", () => {
    const qs = toAskQuestions(fixtureState().serialize());
    const q1 = qs.find((q) => q.id === "q1")!;
    expect(q1.prompt).toBe("Which database engine should we target?\n\nThe engine choice constrains migrations, tooling, and ops.");
    expect(q1.label).toBe("Database engine");
    expect(q1.type).toBe("single");
    expect(q1.required).toBe(false);
  });

  test("absent title maps to an EXPLICIT empty label string (never omitted)", () => {
    const q2 = toAskQuestions(fixtureState().serialize()).find((q) => q.id === "q2")!;
    expect(q2.label).toBe("");
    expect(q2.prompt).toBe("Any constraints on downtime?");
    expect(q2.options).toEqual([]);
  });

  test("recommended option label gets the ★ suffix; ramification rides as description", () => {
    const q1 = toAskQuestions(fixtureState().serialize()).find((q) => q.id === "q1")!;
    const sqlite = q1.options.find((o) => o.value === "sqlite")!;
    const postgres = q1.options.find((o) => o.value === "postgres")!;
    expect(sqlite.label).toBe("SQLite");
    expect(sqlite.description).toBe("Zero-ops, single writer.");
    expect(postgres.label).toBe("PostgreSQL ★");
    expect(postgres.description).toBe("Full ACID, needs a server.");
  });

  test("liveQuestions returns open + reasked in order", () => {
    const live = liveQuestions(fixtureState().serialize());
    expect(live.map((q) => q.id)).toEqual(["q1", "q2"]);
  });
});

// ------------------------------------------------------------ lifecycle

describe("emitFlow lifecycle", () => {
  test("started payload conforms to the bridge contract", () => {
    const { bridge, bus } = makeBridge();
    const state = fixtureState();
    const flowId = bridge.emitFlow(state, "tool");
    expect(flowId).toMatch(/^itg:/);
    const started = bus.of(PI_ASK_STARTED) as Array<Record<string, unknown>>;
    expect(started).toHaveLength(1);
    const payload = started[0]!;
    expect(payload.version).toBe(1);
    expect(payload.flowId).toBe(flowId);
    expect(payload.source).toBe("tool");
    expect(payload.title).toBe("Plan the migration");
    const questions = payload.questions as Array<Record<string, unknown>>;
    for (const q of questions) {
      expect(typeof q.id).toBe("string");
      expect((q.prompt as string).length).toBeGreaterThan(0);
      expect(typeof q.label).toBe("string"); // explicit, possibly empty
      for (const o of q.options as Array<Record<string, string>>) {
        expect(o.value.length).toBeGreaterThan(0);
        expect(o.label.length).toBeGreaterThan(0);
      }
    }
  });

  test("title falls back to Interrogation and soft-caps at 80", () => {
    const { bridge, bus } = makeBridge();
    const state = createInterrogationState("x".repeat(400));
    state.upsertQuestion({ id: "q1", prompt: "p?", type: "text", rev: 1, status: "open" });
    bridge.emitFlow(state, "tool");
    const started = (bus.of(PI_ASK_STARTED) as Array<Record<string, unknown>>)[0]!;
    expect(started.title).toBe("x".repeat(80));
    bridge.completeAll();
    const empty = createInterrogationState("");
    empty.upsertQuestion({ id: "q1", prompt: "p?", type: "text", rev: 1, status: "open" });
    bridge.emitFlow(empty, "tool");
    const started2 = (bus.of(PI_ASK_STARTED) as Array<Record<string, unknown>>)[1]!;
    expect(started2.title).toBe("Interrogation");
  });

  test("a new emission completes the previous flow (single outstanding surface)", () => {
    const { bridge, bus } = makeBridge();
    const state = fixtureState();
    const first = bridge.emitFlow(state, "tool");
    const second = bridge.emitFlow(state, "tool");
    expect(first).not.toBe(second);
    const completed = bus.of(PI_ASK_COMPLETED) as Array<Record<string, unknown>>;
    expect(completed).toHaveLength(1);
    expect(completed[0]!.flowId).toBe(first);
  });

  test("no live questions → null + outstanding flows retired", () => {
    const { bridge, bus } = makeBridge();
    const state = fixtureState();
    bridge.emitFlow(state, "tool");
    state.setStatus("q1", "closed");
    state.setStatus("q2", "closed");
    expect(bridge.emitFlow(state, "tool")).toBeNull();
    expect(bus.of(PI_ASK_COMPLETED)).toHaveLength(1); // the ONE outstanding flow retired
  });

  test("remote.enabled=false → null, no events", () => {
    const config = { ...DEFAULT_CONFIG, remote: { enabled: false, resurface: true, displayDigest: false } };
    const { bridge, bus } = makeBridge(config);
    expect(bridge.emitFlow(fixtureState(), "tool")).toBeNull();
    expect(bus.emitted).toHaveLength(0);
  });
});

// ------------------------------------------------------------ submit paths

function submit(bus: FakeBus, flowId: string, response: unknown, requestId = `req-${Math.random()}`): void {
  bus.emit("@eko24ive/pi-ask:submit", { version: 1, requestId, flowId, response });
}

describe("submit handling", () => {
  test("answer: state applied, submission delivered once, ack + completed + resurface", () => {
    const { bridge, bus, sent, ledger } = makeBridge();
    const state = fixtureState();
    setState(state);
    const flowId = bridge.emitFlow(state, "tool")!;

    submit(bus, flowId, {
      kind: "answer",
      mode: "submit",
      answers: { q1: { values: ["postgres"] }, q2: { customText: "under one hour" } },
    });

    // State: both answers applied + submitted.
    expect(state.getQuestion("q1")!.status).toBe("submitted");
    expect(state.getQuestion("q1")!.answer?.value).toBe("postgres");
    expect(state.getQuestion("q2")!.status).toBe("submitted");
    expect(state.getQuestion("q2")!.answer?.value).toBe("under one hour");
    // One submission message, correct content shape + epoch line. THREE
    // shipped: panel-parity — pendingIds is the FULL answered set, so q3
    // (answered-pending from the fixture, e.g. accepted on the panel
    // earlier) ships with the bridge submission, exactly like ctrl+s.
    expect(sent).toHaveLength(1);
    const msg = sent[0] as { content: string; customType: string; details: { changed: unknown[]; epoch: number } };
    expect(msg.customType).toBe("interrogation-submission");
    expect(msg.content).toContain("Submitted 3: q1: PostgreSQL");
    expect(msg.content).toContain("(state epoch ");
    expect(msg.details.changed.map((e) => (e as { id: string }).id).sort()).toEqual(["q1", "q2", "q3"]);
    // h2.44 caller contract fired after delivery.
    expect(ledger.calls).toBe(1);
    // submit-result ok:true, completed for the flow, resurface (q3/q4 not live → none remain).
    const results = bus.of(PI_ASK_SUBMIT_RESULT) as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(true);
    const completed = bus.of(PI_ASK_COMPLETED) as Array<Record<string, unknown>>;
    expect(completed.some((c) => c.flowId === flowId)).toBe(true);
    expect((bus.of(PI_ASK_STARTED) as unknown[]).length).toBe(1); // nothing remained → no resurface
  });

  test("partial answer resurfaces remaining questions with source ask:replay", () => {
    const { bridge, bus, sent } = makeBridge();
    const state = fixtureState();
    state.upsertQuestion({
      id: "q5",
      prompt: "One more?",
      type: "text",
      rev: 1,
      status: "open",
    });
    setState(state);
    const flowId = bridge.emitFlow(state, "tool")!;

    submit(bus, flowId, { kind: "answer", mode: "submit", answers: { q1: { values: ["sqlite"] } } });

    expect(sent).toHaveLength(1);
    const started = bus.of(PI_ASK_STARTED) as Array<Record<string, unknown>>;
    expect(started).toHaveLength(2);
    expect(started[1]!.source).toBe("ask:replay");
    const questions = started[1]!.questions as Array<{ id: string }>;
    expect(questions.map((q) => q.id).sort()).toEqual(["q2", "q5"]);
  });

  test("cancel: ack + completed, zero state mutation, zero sendMessage", () => {
    const { bridge, bus, sent } = makeBridge();
    const state = fixtureState();
    setState(state);
    const flowId = bridge.emitFlow(state, "tool")!;
    const before = state.serialize();

    submit(bus, flowId, { kind: "cancel" });

    expect(sent).toHaveLength(0);
    expect(state.serialize()).toEqual(before);
    const results = bus.of(PI_ASK_SUBMIT_RESULT) as Array<Record<string, unknown>>;
    expect(results[0]!.ok).toBe(true);
    expect((bus.of(PI_ASK_COMPLETED) as unknown[]).some((c) => (c as Record<string, unknown>).flowId === flowId)).toBe(true);
    expect((bus.of(PI_ASK_STARTED) as unknown[])).toHaveLength(1); // no resurface on cancel
  });

  test("stale itg: flow → flow_not_found nack", () => {
    const { bridge, bus } = makeBridge();
    const state = fixtureState();
    setState(state);
    const flowId = bridge.emitFlow(state, "tool")!;
    submit(bus, flowId, { kind: "cancel" }); // resolves the flow

    submit(bus, flowId, { kind: "answer", mode: "submit", answers: { q1: { values: ["sqlite"] } } });

    const results = bus.of(PI_ASK_SUBMIT_RESULT) as Array<Record<string, unknown>>;
    const last = results[results.length - 1]!;
    expect(last.ok).toBe(false);
    expect(last.error).toBe("flow_not_found");
  });

  test("unknown itg: flow (never emitted) → flow_not_found", () => {
    const { bridge, bus } = makeBridge();
    setState(fixtureState());
    submit(bus, "itg:never-minted:9", { kind: "cancel" });
    const results = bus.of(PI_ASK_SUBMIT_RESULT) as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(results[0]!.error).toBe("flow_not_found");
  });

  test("foreign flowId → total silence (no submit-result of ours)", () => {
    const { bridge, bus } = makeBridge();
    setState(fixtureState());
    submit(bus, "pi-ask-own-flow-id", { kind: "cancel" });
    expect(bus.of(PI_ASK_SUBMIT_RESULT)).toHaveLength(0);
  });

  test("malformed submits → silence (except well-routed itg: strays, which nack)", () => {
    const { bridge, bus } = makeBridge();
    setState(fixtureState());
    bus.emit("@eko24ive/pi-ask:submit", null);
    bus.emit("@eko24ive/pi-ask:submit", { version: 2, flowId: "itg:x:1", requestId: "r", response: { kind: "cancel" } });
    bus.emit("@eko24ive/pi-ask:submit", { version: 1, flowId: 7, requestId: "r", response: { kind: "cancel" } });
    bus.emit("@eko24ive/pi-ask:submit", { version: 1, requestId: "r", response: { kind: "cancel" } });
    expect(bus.of(PI_ASK_SUBMIT_RESULT)).toHaveLength(0);
    // A well-shaped submit routed at an itg: flow with no response body is
    // still ROUTABLE — it nacks flow_not_found (attribution is the point of
    // the prefix).
    bus.emit("@eko24ive/pi-ask:submit", { version: 1, flowId: "itg:x:1", requestId: "r" });
    const results = bus.of(PI_ASK_SUBMIT_RESULT) as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(results[0]!.error).toBe("flow_not_found");
  });

  test("invalid option values (stale after re-ask) dropped; all-invalid → invalid_answer + replay", () => {
    const { bridge, bus, sent } = makeBridge();
    const state = fixtureState();
    setState(state);
    const flowId = bridge.emitFlow(state, "tool")!;

    // q1 options changed server-side after emission (re-ask swapped values).
    state.upsertQuestion({
      id: "q1",
      title: "Database engine",
      prompt: "Which database engine should we target?",
      type: "choice",
      options: [
        { value: "mysql", label: "MySQL" },
        { value: "oracle", label: "Oracle" },
      ],
      rev: 2,
      status: "reasked",
    });

    submit(bus, flowId, {
      kind: "answer",
      mode: "submit",
      answers: { q1: { values: ["postgres"] } }, // no longer a valid value
    });

    expect(sent).toHaveLength(0);
    const results = bus.of(PI_ASK_SUBMIT_RESULT) as Array<Record<string, unknown>>;
    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.error).toBe("invalid_answer");
    // Fresh flow re-rendered with CURRENT options.
    const started = bus.of(PI_ASK_STARTED) as Array<Record<string, unknown>>;
    expect(started).toHaveLength(2);
    const replayed = started[1]!.questions as Array<{ id: string; options: Array<{ value: string }> }>;
    expect(replayed.find((q) => q.id === "q1")!.options.map((o) => o.value)).toEqual(["mysql", "oracle"]);
  });

  test("unknown ids and terminal statuses drop; mixed submit keeps valid ones", () => {
    const { bridge, bus, sent } = makeBridge();
    const state = fixtureState();
    setState(state);
    const flowId = bridge.emitFlow(state, "tool")!;

    submit(bus, flowId, {
      kind: "answer",
      mode: "submit",
      answers: {
        q1: { values: ["sqlite"] },
        nope: { values: ["x"] },
        q4: { customText: "withdrawn question" },
      },
    });

    expect(sent).toHaveLength(1);
    expect(state.getQuestion("q4")!.status).toBe("withdrawn");
    expect(state.getQuestion("q1")!.answer?.value).toBe("sqlite");
  });

  test("freeform customText on a choice question records as given", () => {
    const { bridge, bus, sent } = makeBridge();
    const state = fixtureState();
    setState(state);
    const flowId = bridge.emitFlow(state, "tool")!;
    submit(bus, flowId, { kind: "answer", mode: "submit", answers: { q1: { customText: "cockroachdb actually" } } });
    expect(state.getQuestion("q1")!.answer?.value).toBe("cockroachdb actually");
    expect(sent).toHaveLength(1);
  });

  test("values + customText on a choice question = value + text elaboration", () => {
    const { bridge, bus } = makeBridge();
    const state = fixtureState();
    setState(state);
    const flowId = bridge.emitFlow(state, "tool")!;
    submit(bus, flowId, {
      kind: "answer",
      mode: "submit",
      answers: { q1: { values: ["postgres"], customText: "if ops agrees" } },
    });
    expect(state.getQuestion("q1")!.answer?.value).toBe("postgres");
    expect(state.getQuestion("q1")!.answer?.text).toBe("if ops agrees");
  });

  test("missing singleton state → flow_not_found", () => {
    const { bridge, bus } = makeBridge();
    // No setState: the singleton is undefined.
    const state = fixtureState();
    const flowId = bridge.emitFlow(state, "tool")!; // emission itself needs no singleton
    submit(bus, flowId, { kind: "answer", mode: "submit", answers: { q1: { values: ["sqlite"] } } });
    const results = bus.of(PI_ASK_SUBMIT_RESULT) as Array<Record<string, unknown>>;
    expect(results[0]!.error).toBe("flow_not_found");
  });

  test("resurface=false → no replay after a partial submit", () => {
    const config = { ...DEFAULT_CONFIG, remote: { enabled: true, resurface: false, displayDigest: false } };
    const { bridge, bus } = makeBridge(config);
    const state = fixtureState();
    setState(state);
    const flowId = bridge.emitFlow(state, "tool")!;
    submit(bus, flowId, { kind: "answer", mode: "submit", answers: { q1: { values: ["sqlite"] } } });
    expect((bus.of(PI_ASK_STARTED) as unknown[])).toHaveLength(1);
  });

  test("remote.enabled=false → submits ignored entirely", () => {
    const config = { ...DEFAULT_CONFIG, remote: { enabled: false, resurface: true, displayDigest: false } };
    const { bridge, bus, sent } = makeBridge(config);
    const state = fixtureState();
    setState(state);
    bus.emit("@eko24ive/pi-ask:submit", {
      version: 1,
      requestId: "r",
      flowId: "itg:whatever:1",
      response: { kind: "answer", mode: "submit", answers: { q1: { values: ["sqlite"] } } },
    });
    expect(sent).toHaveLength(0);
    expect(bus.of(PI_ASK_SUBMIT_RESULT)).toHaveLength(0);
    expect(state.getQuestion("q1")!.status).toBe("open");
  });
});

// ------------------------------------------------------------ teardown

describe("dispose / completeAll", () => {
  test("dispose completes outstanding flows and unsubscribes", () => {
    const { bridge, bus } = makeBridge();
    const state = fixtureState();
    setState(state);
    const flowId = bridge.emitFlow(state, "tool")!;
    bridge.dispose();
    expect((bus.of(PI_ASK_COMPLETED) as unknown[]).some((c) => (c as Record<string, unknown>).flowId === flowId)).toBe(true);
    // After dispose, submits draw no reaction at all (the raw bus.emit still
    // records itself — assert on OUR emissions, not bus.emitted length).
    const resultsBefore = (bus.of(PI_ASK_SUBMIT_RESULT)).length;
    bus.emit("@eko24ive/pi-ask:submit", { version: 1, requestId: "r2", flowId: "itg:other:2", response: { kind: "cancel" } });
    expect(bus.of(PI_ASK_SUBMIT_RESULT)).toHaveLength(resultsBefore);
  });
});

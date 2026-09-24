/**
 * src/remote-bridge.test.ts — FR-31..34 unit coverage (plan §5.1):
 * toAskQuestions mapping table (D-R3), full lifecycle on a fake events bus
 * (started payload shape → submit → submit-result → completed → resurface),
 * cancel/stale/foreign/malformed filtering, invalid-answer handling, and
 * the config gates.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG, type InterrogatorConfig } from "./config.js";
import { maybeAutoSubmit as runMaybeAutoSubmit, type SubmitDeps } from "./panel/actions.js";
import { InterrogationPanel } from "./panel/panel.js";
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
  overrides: { getState?: () => InterrogationState | undefined } = {},
): { bridge: RemoteBridge; bus: FakeBus; sent: unknown[]; ledger: { calls: number } } {
  const bus = new FakeBus();
  const { pi, sent } = makePi(bus);
  const ledger = noteDelivered();
  const bridge = createRemoteBridge(pi, {
    config,
    lifecycle: { noteSubmissionDelivered: () => void ledger.calls++ },
    ...overrides,
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
    const config = { ...DEFAULT_CONFIG, remote: { enabled: false, resurface: true } };
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
    const config = { ...DEFAULT_CONFIG, remote: { enabled: true, resurface: false } };
    const { bridge, bus } = makeBridge(config);
    const state = fixtureState();
    setState(state);
    const flowId = bridge.emitFlow(state, "tool")!;
    submit(bus, flowId, { kind: "answer", mode: "submit", answers: { q1: { values: ["sqlite"] } } });
    expect((bus.of(PI_ASK_STARTED) as unknown[])).toHaveLength(1);
  });

  test("remote.enabled=false → submits ignored entirely", () => {
    const config = { ...DEFAULT_CONFIG, remote: { enabled: false, resurface: true } };
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

  // ------------------------------------ BUG-007 — internal_error nack (FR-32/D-R6)

  /**
   * BUG-007 throw lever: a state whose applyAnswer THROWS while everything
   * else delegates to a real fixture (mapWireAnswers' non-throwing D-R4
   * validation must succeed so the throw lands INSIDE
   * recordRemoteSubmission's apply step, not in the invalid_answer path).
   */
  function throwingApplyState(base: InterrogationState): InterrogationState {
    return new Proxy(base, {
      get(target, prop) {
        if (prop === "applyAnswer") {
          return () => {
            throw new Error("boom: injected internal failure");
          };
        }
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? (v as (...args: unknown[]) => unknown).bind(target) : v;
      },
    }) as unknown as InterrogationState;
  }

  test("BUG-007: throwing state → internal_error nack + completed, no delta, no lifecycle", () => {
    const state = fixtureState();
    const { bridge, bus, sent, ledger } = makeBridge(DEFAULT_CONFIG, {
      getState: () => throwingApplyState(state),
    });
    const flowId = bridge.emitFlow(state, "tool")!; // emission uses the REAL state
    const requestId = "req-internal-error";

    // The listener must NOT throw into the bus emit loop — submit() drives
    // bus.emit directly, so an unguarded listener throw would fail the test
    // right here (BUG-007: it used to be swallowed WITHOUT any ack).
    expect(() =>
      submit(bus, flowId, { kind: "answer", mode: "submit", answers: { q1: { values: ["postgres"] } } }, requestId),
    ).not.toThrow();

    // The client got its ack: an internal_error NACK echoing the ids.
    const results = bus.of(PI_ASK_SUBMIT_RESULT) as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    const nack = results[0]!;
    expect(nack.version).toBe(1);
    expect(nack.requestId).toBe(requestId);
    expect(nack.flowId).toBe(flowId);
    expect(nack.ok).toBe(false);
    expect(nack.error).toBe("internal_error");
    expect(typeof nack.message).toBe("string");
    expect(nack.message).toMatch(/internal/i);
    // The flow is torn down (completed resolves the client surface).
    const completed = bus.of(PI_ASK_COMPLETED) as Array<Record<string, unknown>>;
    expect(completed.some((c) => c.flowId === flowId)).toBe(true);
    // No submission delta shipped, no lifecycle note, no resurface
    // (the surface may be inconsistent — the next upsert re-emits).
    expect(sent).toHaveLength(0);
    expect(ledger.calls).toBe(0);
    expect(bus.of(PI_ASK_STARTED)).toHaveLength(1);
  });

  test("BUG-007: flow registry torn down — retry on the same flowId nacks flow_not_found", () => {
    const state = fixtureState();
    const { bridge, bus } = makeBridge(DEFAULT_CONFIG, {
      getState: () => throwingApplyState(state),
    });
    const flowId = bridge.emitFlow(state, "tool")!;

    submit(bus, flowId, { kind: "answer", mode: "submit", answers: { q1: { values: ["postgres"] } } }, "req-1");
    submit(bus, flowId, { kind: "answer", mode: "submit", answers: { q1: { values: ["sqlite"] } } }, "req-2");

    const results = bus.of(PI_ASK_SUBMIT_RESULT) as Array<Record<string, unknown>>;
    expect(results).toHaveLength(2);
    expect(results[0]!.error).toBe("internal_error");
    expect(results[1]!.ok).toBe(false);
    expect(results[1]!.error).toBe("flow_not_found"); // completeFlow ran after the nack
    expect(results[1]!.requestId).toBe("req-2");
  });
});

// ----------------------------------- P2.M1.T3.S1 — WRITEIN-001 parity

describe("mapWireAnswers — WRITEIN-001 parity", () => {
  test("customText-only on a choice question = the write-in path: { value, custom: true, at } byte-identical to the panel Other row", () => {
    const { bridge, bus, sent } = makeBridge();
    const state = fixtureState();
    setState(state);
    const flowId = bridge.emitFlow(state, "tool")!;

    submit(bus, flowId, { kind: "answer", mode: "submit", answers: { q1: { customText: "cockroachdb, tuned" } } });

    const a = state.getQuestion("q1")!.answer!;
    // Byte-identical to actions.ts writeInEnter's commit { value, custom: true, at }.
    expect(a).toEqual({ value: "cockroachdb, tuned", custom: true, at: a.at });
    expect(Object.keys(a).sort()).toEqual(["at", "custom", "value"]);
    expect(state.getQuestion("q1")!.status).toBe("submitted");
    expect(sent).toHaveLength(1); // it shipped like any other answer
  });

  test("custom value NOT in the option list is accepted as-is (never validated against options — h2.42)", () => {
    const { bridge, bus, sent } = makeBridge();
    const state = fixtureState();
    setState(state);
    const flowId = bridge.emitFlow(state, "tool")!;

    // "sqlite"/"postgres" are the only options — the custom value is not one.
    submit(bus, flowId, { kind: "answer", mode: "submit", answers: { q1: { customText: "DynamoDB (really)" } } });

    const results = bus.of(PI_ASK_SUBMIT_RESULT) as Array<Record<string, unknown>>;
    expect(results[0]!.ok).toBe(true); // accepted, NOT invalid_answer
    expect(state.getQuestion("q1")!.answer).toMatchObject({ value: "DynamoDB (really)", custom: true });
    expect(sent).toHaveLength(1);
  });

  test("invalid values[0] WITHOUT customText still drops (D-R4 unchanged)", () => {
    const { bridge, bus, sent } = makeBridge();
    const state = fixtureState();
    setState(state);
    const flowId = bridge.emitFlow(state, "tool")!;

    submit(bus, flowId, { kind: "answer", mode: "submit", answers: { q1: { values: ["not-a-current-option"] } } });

    expect(sent).toHaveLength(0);
    expect(state.getQuestion("q1")!.status).toBe("open");
    const results = bus.of(PI_ASK_SUBMIT_RESULT) as Array<Record<string, unknown>>;
    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.error).toBe("invalid_answer");
  });

  test("valid values[0] + customText → text elaboration, custom flag ABSENT", () => {
    const { bridge, bus } = makeBridge();
    const state = fixtureState();
    setState(state);
    const flowId = bridge.emitFlow(state, "tool")!;

    submit(bus, flowId, {
      kind: "answer",
      mode: "submit",
      answers: { q1: { values: ["postgres"], customText: "if ops agrees to host it" } },
    });

    const a = state.getQuestion("q1")!.answer!;
    expect(a.value).toBe("postgres");
    expect(a.text).toBe("if ops agrees to host it");
    expect(a.custom).toBeUndefined(); // elaboration is NOT a write-in
    expect(Object.keys(a).sort()).toEqual(["at", "text", "value"]);
  });

  test("text question carries custom: true via values[0] AND via customText (panel parity)", () => {
    // Path 1: customText.
    const first = makeBridge();
    const s1 = fixtureState();
    setState(s1);
    const flow1 = first.bridge.emitFlow(s1, "tool")!;
    submit(first.bus, flow1, { kind: "answer", mode: "submit", answers: { q2: { customText: "under one hour" } } });
    expect(s1.getQuestion("q2")!.answer).toEqual({ value: "under one hour", custom: true, at: s1.getQuestion("q2")!.answer!.at });

    // Path 2: values[0] — same custom marker, same shape.
    const second = makeBridge();
    const s2 = fixtureState();
    setState(s2);
    const flow2 = second.bridge.emitFlow(s2, "tool")!;
    submit(second.bus, flow2, { kind: "answer", mode: "submit", answers: { q2: { values: ["two hours"] } } });
    expect(s2.getQuestion("q2")!.answer).toEqual({ value: "two hours", custom: true, at: s2.getQuestion("q2")!.answer!.at });
  });

  test("empty customText-only still drops (empty write-in is absent customText)", () => {
    const { bridge, bus, sent } = makeBridge();
    const state = fixtureState();
    setState(state);
    const flowId = bridge.emitFlow(state, "tool")!;

    submit(bus, flowId, { kind: "answer", mode: "submit", answers: { q1: { customText: "" } } });

    expect(sent).toHaveLength(0);
    expect(state.getQuestion("q1")!.status).toBe("open");
    const results = bus.of(PI_ASK_SUBMIT_RESULT) as Array<Record<string, unknown>>;
    expect(results[0]!.ok).toBe(false);
  });

  test("note and optionNotes stay dropped (ignored on the wire)", () => {
    const { bridge, bus } = makeBridge();
    const state = fixtureState();
    setState(state);
    const flowId = bridge.emitFlow(state, "tool")!;

    submit(bus, flowId, {
      kind: "answer",
      mode: "submit",
      answers: {
        q1: { values: ["postgres"], note: "wire note", optionNotes: { postgres: "why" } },
        q2: { customText: "constraint", note: "another" },
      },
    });

    const a1 = state.getQuestion("q1")!.answer!;
    expect(a1.value).toBe("postgres");
    expect(a1.text).toBeUndefined();
    expect(a1).toEqual({ value: "postgres", at: a1.at }); // note never landed
    const a2 = state.getQuestion("q2")!.answer!;
    expect(a2).toEqual({ value: "constraint", custom: true, at: a2.at });
  });

  test("bridge tail hook: injected maybeAutoSubmit fires once after the lifecycle call; the flushed pending set keeps it a no-op", () => {
    const bus = new FakeBus();
    const { pi, sent } = makePi(bus);
    const ledger = { calls: 0 };
    let state: InterrogationState | undefined;
    let hookWouldShip = false;
    // Faithful index.ts wiring: actions.ts maybeAutoSubmit ships only when
    // the set is complete AND answered-pending exist. markSubmitted's flush
    // (pipeline step 5) runs BEFORE the tail, so there are none.
    const maybeAutoSubmit = () => {
      const pending = state?.orderedQuestions().filter((q) => q.status === "answered") ?? [];
      if (pending.length > 0) hookWouldShip = true;
    };
    const bridge = createRemoteBridge(pi, {
      config: DEFAULT_CONFIG,
      lifecycle: { noteSubmissionDelivered: () => void ledger.calls++ },
      maybeAutoSubmit,
    });
    state = fixtureState(); // q3 is answered-pending: ships WITH the bridge submission (panel parity)
    setState(state);
    const flowId = bridge.emitFlow(state, "tool")!;
    const epochBefore = state.epoch;

    submit(bus, flowId, { kind: "answer", mode: "submit", answers: { q1: { customText: "cockroachdb" } } });

    expect(sent).toHaveLength(1); // ONE submission total — no double-ship from the hook
    expect(hookWouldShip).toBe(false);
    expect(ledger.calls).toBe(1); // h2.44 contract fired before the hook ran
    expect(state.epoch).toBe(epochBefore + 1); // epoch bumped once, inside buildSubmission only
  });

  test("bridge submit with an open gate question: tail hook inherited, one submission, hold stays silent (flush precedes the hook)", () => {
    // P1.M1.T1.S2 — bridge inheritance pin (BUG-001/AC-2d audit). The REAL
    // actions.ts maybeAutoSubmit is wired exactly like index.ts:107–109
    // (late-binding panel lookup; explicit SubmitDeps because a headless
    // panel has no delivery of its own and the hook would early-return).
    //
    // The remote client's submit IS a deliberate commit (the ctrl+s analog):
    // it ships itself. The inherited hook then runs — but recordRemote-
    // Submission's step-5 markSubmitted flush (AUTOSUBMIT-001's load-bearing
    // "one bridge submission, never two" ordering) has ALREADY flipped every
    // answered → submitted, so the hook sees pending === 0 and S1's
    // `n > 0 && pending > 0` hold guard cannot arm — the zero-pending
    // silence applies. This pins the true inherited semantics: hook LIVE
    // and invoked exactly once, exactly ONE submission (the bridge's own),
    // no hook-driven second submission, gateWarning untouched.
    const bus = new FakeBus();
    const { pi, sent } = makePi(bus);
    const ledger = { calls: 0 };
    const stubTheme = {
      fg: (_name: string, s: string) => s,
      bold: (s: string) => s,
    } as unknown as Theme;

    // Shared singleton: gate question g1 OPEN in its own gate group + a
    // later-group question the bridge will answer.
    const state = createInterrogationState("goal");
    state.upsertQuestion({
      id: "g1",
      prompt: "Foundational: scope?",
      type: "choice",
      options: [{ value: "a", label: "A" }],
      group: "foundation",
      gate: true,
      rev: 1,
      status: "open",
    });
    state.upsertQuestion({
      id: "n1",
      prompt: "Downtime constraints?",
      type: "text",
      group: "later",
      rev: 1,
      status: "open",
    });
    setState(state);

    // Real panel over the SAME state instance, with explicit SubmitDeps
    // (index.ts wires maybeAutoSubmit(panel) with no deps → panel.delivery;
    // the headless panel gets delivery through its args instead).
    const panelSendMessage = vi.fn();
    const deps: SubmitDeps = { sendMessage: panelSendMessage, isIdle: () => true };
    const panel = new InterrogationPanel({
      tui: { requestRender: vi.fn() } as unknown as TUI,
      theme: stubTheme,
      done: () => {},
      state,
      config: DEFAULT_CONFIG,
      delivery: deps,
    });

    let hookCalls = 0;
    const bridge = createRemoteBridge(pi, {
      config: DEFAULT_CONFIG,
      lifecycle: { noteSubmissionDelivered: () => void ledger.calls++ },
      maybeAutoSubmit: () => {
        hookCalls++;
        runMaybeAutoSubmit(panel, deps);
      },
    });
    const flowId = bridge.emitFlow(state, "tool")!;
    const epochBefore = state.epoch;

    submit(bus, flowId, { kind: "answer", mode: "submit", answers: { n1: { customText: "under an hour" } } });

    // The bridge's OWN submission shipped exactly once (the remote user's
    // deliberate submit — NOT withheld by the hold).
    expect(sent).toHaveLength(1);
    expect(ledger.calls).toBe(1); // h2.44 contract fired before the hook ran
    // The inherited hook ran exactly once — and found zero pending (the
    // step-5 flush precedes it): no hold armed, no second submission.
    expect(hookCalls).toBe(1);
    expect(panel.gateWarning).toBeNull();
    expect(panelSendMessage).not.toHaveBeenCalled();
    expect(state.epoch).toBe(epochBefore + 1); // bumped once, inside buildSubmission only
    expect(state.getQuestion("n1")!.status).toBe("submitted");
    expect(state.getQuestion("g1")!.status).toBe("open"); // the gate question is untouched
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

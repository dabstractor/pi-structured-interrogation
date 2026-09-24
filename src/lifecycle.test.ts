/**
 * src/lifecycle.test.ts — event-sequence unit tests for the auto-close engine
 * (P1.M2.T2.S1; h2.44). A bare mock `{ on }` stands in for pi — no runtime,
 * per the delivery.test.ts convention. Handlers are captured by event name
 * and driven via `emit(event, payload)`; fixture states are real
 * InterrogationStates seeded through the raw primitives + merge.js.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, test, vi, type Mock } from "vitest";
import { applyUpsert, markAnswered, markSubmitted } from "./merge.js";
import { digestSince, takeSnapshot } from "./snapshots.js";
import { createLifecycle, type ClosePassResult } from "./lifecycle.js";
import { attemptCompletion } from "./completion.js";
import { DEFAULT_CONFIG } from "./config.js";
import { executeInterrogate } from "./tool.js";
import {
  createInterrogationState,
  resetState,
  setState,
  type InterrogationState,
  type Question,
} from "./state.js";

// ------------------------------------------------------------------ mock pi

type Handler = (event: unknown) => void;

interface MockPi {
  pi: Pick<ExtensionAPI, "on">;
  /** The vi.fn backing `pi.on` — assert registrations with it. */
  on: Mock<[event: string, handler: Handler], () => void>;
  /** Fire every handler registered for `event` (copy-first: dispose-safe). */
  emit(event: string, payload?: Record<string, unknown>): void;
  /** Unsubscribe functions the mock hands back from on() — dispose drains these. */
  unsubscribers: Array<() => void>;
  /** Live handler registry — dispose() must empty every list via the offs. */
  handlers: Map<string, Handler[]>;
}

/** Helper (not inline generic) so vitest 1.x infers the precise Mock type. */
function makeOnMock(
  handlers: Map<string, Handler[]>,
  unsubscribers: Array<() => void>,
): Mock<[event: string, handler: Handler], () => void> {
  return vi.fn((event: string, handler: Handler) => {
    const list = handlers.get(event) ?? [];
    list.push(handler);
    handlers.set(event, list);
    const off = () => {
      const current = handlers.get(event);
      if (current === undefined) return;
      const i = current.indexOf(handler);
      if (i !== -1) current.splice(i, 1);
    };
    unsubscribers.push(off);
    return off;
  });
}

function makeMockPi(): MockPi {
  const handlers = new Map<string, Handler[]>();
  const unsubscribers: Array<() => void> = [];
  const on = makeOnMock(handlers, unsubscribers);
  const emit = (event: string, payload: Record<string, unknown> = {}): void => {
    for (const handler of [...(handlers.get(event) ?? [])]) handler({ type: event, ...payload });
  };
  // Cast mirrors tool.test.ts's mock convention; the mock's call signature is
  // a widened superset of the three overloads the engine uses.
  return { pi: { on } as unknown as Pick<ExtensionAPI, "on">, on, emit, unsubscribers, handlers };
}

// ----------------------------------------------------------------- fixtures

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

const AT = "2025-01-01T00:00:00.000Z";

/** Seed ids as answered-then-submitted — the shape right after ctrl+s. */
function seedSubmitted(st: InterrogationState, ids: string[]): void {
  for (const id of ids) {
    st.upsertQuestion(choiceQ(id));
    markAnswered(st, id, { value: "a", at: AT });
  }
  markSubmitted(st, ids);
}

/** REAL wire shape (h2.19): the schema has no `action` field — a non-empty questions array IS an upsert. */
function upsertArgs(ids: string[]): Record<string, unknown> {
  return { questions: ids.map((id) => ({ id })) };
}

/**
 * FULL real-arg payload (h2.19): every entry carries the schema-required
 * prompt/type/options — the shape a model actually sends when honoring
 * commitment 4 (a re-ask resends the FULL set, unchanged entries included).
 */
function fullUpsertArgs(st: InterrogationState, refined?: string): Record<string, unknown> {
  return {
    epoch: st.epoch,
    questions: st.orderedQuestions().map((q) => ({
      id: q.id,
      prompt: q.id === refined ? `${q.prompt} (clarified)?` : q.prompt,
      type: q.type,
      rev: q.rev,
      options: q.options,
    })),
  };
}

/** One agent run: interrogate upsert (start → end) then agent_settled. */
function runUpsertAndSettle(
  mock: MockPi,
  touchedIds: string[],
  runOpts: { isError?: boolean; toolName?: string; callId?: string } = {},
): void {
  const callId = runOpts.callId ?? "call-1";
  const toolName = runOpts.toolName ?? "interrogate";
  mock.emit("tool_execution_start", { toolCallId: callId, toolName, args: upsertArgs(touchedIds) });
  mock.emit("tool_execution_end", {
    toolCallId: callId,
    toolName,
    result: undefined,
    isError: runOpts.isError ?? false,
  });
  mock.emit("agent_settled");
}

function statusOf(st: InterrogationState, id: string): string {
  return st.getQuestion(id)?.status ?? "(absent)";
}

// ------------------------------------------------------------- subscriptions

test("subscribes to tool_execution_start, tool_execution_end, and agent_settled", () => {
  const mock = makeMockPi();
  const lifecycle = createLifecycle(mock.pi);
  const events = mock.on.mock.calls.map((call) => call[0]);
  expect(events).toContain("tool_execution_start");
  expect(events).toContain("tool_execution_end");
  expect(events).toContain("agent_settled");
  lifecycle.dispose();
});

// ------------------------------------------------------------- close pass

test("close pass archives submitted questions not reasked this run", () => {
  const st = newState();
  seedSubmitted(st, ["q1", "q2", "q3"]);
  const mock = makeMockPi();
  const lifecycle = createLifecycle(mock.pi, { getState: () => st });

  mock.emit("agent_settled"); // settled run with no interrogate upsert

  expect(statusOf(st, "q1")).toBe("closed");
  expect(statusOf(st, "q2")).toBe("closed");
  expect(statusOf(st, "q3")).toBe("closed");
  lifecycle.dispose();
});

test("upsert touching some ids reasks them; untouched ids close", () => {
  const st = newState();
  seedSubmitted(st, ["q1", "q2", "q3"]);
  const mock = makeMockPi();
  const lifecycle = createLifecycle(mock.pi, { getState: () => st });

  runUpsertAndSettle(mock, ["q2"]); // agent re-asked only q2

  expect(statusOf(st, "q2")).toBe("reasked");
  expect(statusOf(st, "q1")).toBe("closed");
  expect(statusOf(st, "q3")).toBe("closed");
  lifecycle.dispose();
});

test("rule-1 same-options upsert keeps status submitted — engine still flips it to reasked", () => {
  const st = newState();
  seedSubmitted(st, ["q1"]);
  // Simulate the tool's merge step for a same-options upsert: rule 1 keeps
  // status "submitted" (rev bumps, answer kept — merge.ts semantics).
  applyUpsert(st, [choiceQ("q1")]);
  expect(statusOf(st, "q1")).toBe("submitted");

  const mock = makeMockPi();
  const lifecycle = createLifecycle(mock.pi, { getState: () => st });
  runUpsertAndSettle(mock, ["q1"]);

  // h2.44 counts the same-options touch as a re-ask → never archived.
  expect(statusOf(st, "q1")).toBe("reasked");
  lifecycle.dispose();
});

test("rule-2 changed-options upsert (merge already reasked) is not closed by the pass", () => {
  const st = newState();
  seedSubmitted(st, ["q1", "q2"]);
  // Simulate the tool's merge step for a changed-options batch that also
  // carries q2 (same options → rule 1 keeps it submitted; an omitted q2
  // would be WITHDRAWN by rule 4, which is merge.ts's job, not this test's).
  applyUpsert(st, [choiceQ("q1", { options: [{ value: "c", label: "Gamma" }] }), choiceQ("q2")]);
  expect(statusOf(st, "q1")).toBe("reasked"); // rule 2 flipped it during execution

  const mock = makeMockPi();
  const lifecycle = createLifecycle(mock.pi, { getState: () => st });
  runUpsertAndSettle(mock, ["q1"]); // engine: q1 is no longer "submitted" → nothing extra recorded

  expect(statusOf(st, "q1")).toBe("reasked");
  expect(statusOf(st, "q2")).toBe("closed");
  lifecycle.dispose();
});

test("isError tool result records nothing — submitted ids still close", () => {
  const st = newState();
  seedSubmitted(st, ["q1", "q2"]);
  const mock = makeMockPi();
  const lifecycle = createLifecycle(mock.pi, { getState: () => st });

  // A thrown rev/epoch stale-guard surfaces as isError → no state change →
  // no submittedRun, no re-ask marks.
  runUpsertAndSettle(mock, ["q1"], { isError: true });

  expect(statusOf(st, "q1")).toBe("closed");
  expect(statusOf(st, "q2")).toBe("closed");
  lifecycle.dispose();
});

test("aborted run — agent_settled with no tool events — still closes submitted questions", () => {
  const st = newState();
  seedSubmitted(st, ["q1"]);
  const mock = makeMockPi();
  const lifecycle = createLifecycle(mock.pi, { getState: () => st });

  mock.emit("agent_settled"); // abort: settle fires with no tool activity

  expect(statusOf(st, "q1")).toBe("closed");
  lifecycle.dispose();
});

// S2-GATED (BUG-003, audited in P1.M1.T3.S1): these tests encode the
// close-pass snapshot contract that P1.M1.T3.S2 implements — takeSnapshot
// in runClosePass, AFTER closeSubmitted, gated on toClose.length > 0, with
// NO epoch bump. They are deliberately PLAIN (not .todo/.skip): until S2
// lands they are RED BY DESIGN — the failure IS S2's TDD signal.
describe("close pass snapshot (BUG-003, lands in P1.M1.T3.S2)", () => {
  test("a close pass that closes ids appends ONE same-epoch 'closed' snapshot (no epoch bump)", () => {
    const st = newState();
    seedSubmitted(st, ["q1"]);
    const mock = makeMockPi();
    const lifecycle = createLifecycle(mock.pi, { getState: () => st });
    const baselineCount = st.snapshots.length; // seedSubmitted pushes no snapshot
    const submitEpoch = st.epoch;

    mock.emit("agent_settled");

    expect(statusOf(st, "q1")).toBe("closed");
    expect(st.snapshots.length).toBe(baselineCount + 1); // exactly one close-pass entry
    const snap = st.snapshots[st.snapshots.length - 1]!;
    expect(snap.epoch).toBe(submitEpoch); // same epoch as the submission it archives
    expect(st.epoch).toBe(submitEpoch); // close pass NEVER bumps
    expect(Object.values(snap.state.questions).every((q) => q.status === "closed")).toBe(true);
    lifecycle.dispose();
  });

  test("a settle with nothing to close adds NO snapshot (toClose.length > 0 gate)", () => {
    const st = newState();
    seedSubmitted(st, ["q1"]);
    const mock = makeMockPi();
    const lifecycle = createLifecycle(mock.pi, { getState: () => st });

    mock.emit("agent_settled"); // closes q1 (S2-gated snapshot lands here)
    const afterClose = st.snapshots.length;
    mock.emit("agent_settled"); // nothing submitted → toClose empty → no snapshot

    expect(statusOf(st, "q1")).toBe("closed");
    expect(st.snapshots.length).toBe(afterClose);
    lifecycle.dispose();
  });

  test("digestSince(state, submitEpoch) output is unchanged by the close-pass entry", () => {
    const st = newState();
    seedSubmitted(st, ["q1", "q2"]);
    takeSnapshot(st); // first submission's ring entry (submit-time: 'submitted')
    st.bumpEpoch(); // epoch 2
    // q1 re-answered + re-submitted → a REAL pending delta vs the epoch-1 snapshot.
    markAnswered(st, "q1", { value: "b", at: AT });
    markSubmitted(st, ["q1"]);
    const submitEpoch = st.epoch;
    const before = digestSince(st, 1);
    expect(before).not.toBe(""); // guard: the delta is real, not a vacuous comparison

    const mock = makeMockPi();
    const lifecycle = createLifecycle(mock.pi, { getState: () => st });
    mock.emit("agent_settled"); // closes q1+q2 → S2 appends one same-epoch snapshot

    expect(statusOf(st, "q1")).toBe("closed");
    expect(st.epoch).toBe(submitEpoch);
    expect(st.snapshots.length).toBe(2); // submit snapshot + close-pass snapshot
    expect(st.snapshots[1]!.epoch).toBe(submitEpoch);
    // Same-epoch link with identical answer signatures ⇒ zero extra segments.
    expect(digestSince(st, 1)).toBe(before);
    lifecycle.dispose();
  });
});

test("double agent_settled with no intervening submission: second pass is a no-op", () => {
  const st = newState();
  seedSubmitted(st, ["q1", "q2"]);
  const mock = makeMockPi();
  const results: Array<ClosePassResult | undefined> = [];
  const lifecycle = createLifecycle(mock.pi, {
    getState: () => st,
    onAfterClosePass: (r) => results.push(r),
  });

  runUpsertAndSettle(mock, ["q1"]); // q1 reasked, q2 closed
  mock.emit("agent_settled"); // double settle (abort-fire shape)

  expect(results[0]).toEqual({ closed: ["q2"], reasked: ["q1"], remainingActive: ["q1"] });
  expect(results[1]).toEqual({ closed: [], reasked: [], remainingActive: ["q1"] });
  expect(statusOf(st, "q1")).toBe("reasked"); // second pass must NOT archive it
  expect(statusOf(st, "q2")).toBe("closed");
  lifecycle.dispose();
});

test("remainingActive accounting across moot/withdrawn/closed statuses", () => {
  const st = newState();
  const mock = makeMockPi();
  const lifecycle = createLifecycle(mock.pi, { getState: () => st });

  st.upsertQuestion(choiceQ("a-open"));
  st.upsertQuestion(choiceQ("b-answered"));
  markAnswered(st, "b-answered", { value: "a", at: AT });
  seedSubmitted(st, ["c-submitted", "d-reasked"]);
  st.upsertQuestion(choiceQ("e-moot"));
  st.setStatus("e-moot", "moot");
  st.upsertQuestion(choiceQ("f-withdrawn"));
  st.setStatus("f-withdrawn", "withdrawn");
  st.upsertQuestion(choiceQ("g-closed"));
  st.setStatus("g-closed", "closed");

  runUpsertAndSettle(mock, ["d-reasked"]); // c-submitted closes, d-reasked survives

  expect(statusOf(st, "c-submitted")).toBe("closed");
  const result = lifecycle.runClosePass(); // idempotent second pass: same remaining set
  expect(result?.remainingActive).toEqual(["a-open", "b-answered", "d-reasked"]);
  lifecycle.dispose();
});

// ----------------------------------------------------- onAfterClosePass

test("onAfterClosePass receives exactly the returned ClosePassResult", () => {
  const st = newState();
  seedSubmitted(st, ["q1", "q2"]);
  const mock = makeMockPi();
  const onAfterClosePass = vi.fn();
  const lifecycle = createLifecycle(mock.pi, { getState: () => st, onAfterClosePass });

  const returned = lifecycle.runClosePass();

  expect(onAfterClosePass).toHaveBeenCalledTimes(1);
  const arg = onAfterClosePass.mock.calls[0]?.[0] as ClosePassResult | undefined;
  expect(arg).toEqual({ closed: ["q1", "q2"], reasked: [], remainingActive: [] });
  expect(arg).toBe(returned); // same object identity, not a copy
  lifecycle.dispose();
});

// --------------------------------------------- noteSubmissionDelivered

test("noteSubmissionDelivered clears the run's reask set (fresh-epoch semantics)", () => {
  const st = newState();
  seedSubmitted(st, ["q1"]);
  const mock = makeMockPi();
  const lifecycle = createLifecycle(mock.pi, { getState: () => st });

  runUpsertAndSettle(mock, ["q1"]); // q1 → reasked; engine remembers the reask
  expect(statusOf(st, "q1")).toBe("reasked");

  // New submission flow: the user re-answers q1 and hits ctrl+s again.
  markAnswered(st, "q1", { value: "b", at: AT });
  markSubmitted(st, ["q1"]);
  lifecycle.noteSubmissionDelivered(); // submit-flow contract (after deliverSubmission)

  mock.emit("agent_settled"); // the run that answers the NEW submission

  // The stale reask from the previous run must not suppress this close.
  expect(statusOf(st, "q1")).toBe("closed");
  lifecycle.dispose();
});

// --------------------------------------------------- panel-dismiss hooks

test("onPanelDismiss/dismissPanel round-trip; last registration wins; no-op without registration", () => {
  const mock = makeMockPi();
  const lifecycle = createLifecycle(mock.pi);

  expect(() => lifecycle.dismissPanel()).not.toThrow(); // nothing registered yet

  const first = vi.fn();
  const second = vi.fn();
  lifecycle.onPanelDismiss(first);
  lifecycle.onPanelDismiss(second); // last registration wins
  lifecycle.dismissPanel();
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
  lifecycle.dispose();
});

// ------------------------------------------------------------ edge cases

test("no state → runClosePass returns undefined and onAfterClosePass is not called", () => {
  const mock = makeMockPi();
  const onAfterClosePass = vi.fn();
  const lifecycle = createLifecycle(mock.pi, { onAfterClosePass });

  expect(lifecycle.runClosePass()).toBeUndefined();
  mock.emit("agent_settled");
  expect(onAfterClosePass).not.toHaveBeenCalled();
  lifecycle.dispose();
});

test("dispose unsubscribes every captured handler and drops engine state", () => {
  const st = newState();
  seedSubmitted(st, ["q1"]);
  const mock = makeMockPi();
  const lifecycle = createLifecycle(mock.pi, { getState: () => st });

  expect(mock.unsubscribers).toHaveLength(3);
  lifecycle.dispose();
  // Every captured unsubscriber ran: the mock's handler lists are all empty.
  expect([...mock.handlers.values()].every((list) => list.length === 0)).toBe(true);

  // Handlers are gone: events after dispose no longer reach the engine.
  mock.emit("agent_settled");
  expect(statusOf(st, "q1")).toBe("submitted"); // untouched
});

test("tool end without a matching start records nothing (toolCallId correlation)", () => {
  const st = newState();
  seedSubmitted(st, ["q1"]);
  const mock = makeMockPi();
  const lifecycle = createLifecycle(mock.pi, { getState: () => st });

  // No tool_execution_start → no stashed args → the upsert is invisible.
  mock.emit("tool_execution_end", {
    toolCallId: "ghost",
    toolName: "interrogate",
    result: undefined,
    isError: false,
  });
  mock.emit("agent_settled");

  expect(statusOf(st, "q1")).toBe("closed");
  lifecycle.dispose();
});

test("non-interrogate tools and non-upsert actions record nothing (no reask marks)", () => {
  const st = newState();
  seedSubmitted(st, ["q1", "q2"]);
  const mock = makeMockPi();
  const lifecycle = createLifecycle(mock.pi, { getState: () => st });

  // A bash tool call carrying (bogus) upsert args must not reask q1: the
  // settle then archives it — "closed" proves no re-ask was recorded.
  runUpsertAndSettle(mock, ["q1"], { toolName: "bash" });
  expect(statusOf(st, "q1")).toBe("closed");

  // An interrogate `read` (real shape: `{}` — no questions) is likewise not
  // a re-ask → q2 archives.
  mock.emit("tool_execution_start", {
    toolCallId: "call-2",
    toolName: "interrogate",
    args: {},
  });
  mock.emit("tool_execution_end", {
    toolCallId: "call-2",
    toolName: "interrogate",
    result: undefined,
    isError: false,
  });
  mock.emit("agent_settled");
  expect(statusOf(st, "q2")).toBe("closed");
  lifecycle.dispose();
});

test("empty questions array routes to read (presence routing) — records nothing", () => {
  const st = newState();
  seedSubmitted(st, ["q1"]);
  const mock = makeMockPi();
  const lifecycle = createLifecycle(mock.pi, { getState: () => st });

  // `{questions: []}` parses to a `read` action (h2.20) — not an upsert, so
  // the settle archives q1 and the round-detection flag stays false.
  mock.emit("tool_execution_start", { toolCallId: "call-1", toolName: "interrogate", args: { questions: [] } });
  mock.emit("tool_execution_end", { toolCallId: "call-1", toolName: "interrogate", result: undefined, isError: false });
  mock.emit("agent_settled");

  expect(statusOf(st, "q1")).toBe("closed");
  expect(lifecycle.upsertedThisRun()).toBe(false);
  lifecycle.dispose();
});

test("full-set resend (commitment 4): every in-batch submitted id counts as touched (FR-4)", () => {
  const st = newState();
  seedSubmitted(st, ["q1", "q2"]);
  const mock = makeMockPi();
  const lifecycle = createLifecycle(mock.pi, { getState: () => st });

  // The agent refines q1 and resends q2 VERBATIM (full-set commitment: an
  // omission would withdraw q2 via merge rule 4). FR-4: submitted questions
  // close "unless that reply upserted them" — q2 WAS upserted, so it must
  // show re-asked, never archived.
  const args = fullUpsertArgs(st, "q1");
  mock.emit("tool_execution_start", { toolCallId: "call-1", toolName: "interrogate", args });
  mock.emit("tool_execution_end", { toolCallId: "call-1", toolName: "interrogate", result: undefined, isError: false });
  mock.emit("agent_settled");

  expect(statusOf(st, "q1")).toBe("reasked");
  expect(statusOf(st, "q2")).toBe("reasked");
  lifecycle.dispose();
});

test("interleaved submissions: ids from different epochs settle independently", () => {
  const st = newState();
  const mock = makeMockPi();
  const lifecycle = createLifecycle(mock.pi, { getState: () => st });

  // Epoch 1: submit q1 → settle closes it.
  seedSubmitted(st, ["q1"]);
  mock.emit("agent_settled");
  expect(statusOf(st, "q1")).toBe("closed");

  // Epoch 2: submit q2+q3; the agent upserts q2 (touched), omits q3.
  seedSubmitted(st, ["q2", "q3"]);
  runUpsertAndSettle(mock, ["q2"]);
  expect(statusOf(st, "q2")).toBe("reasked");
  expect(statusOf(st, "q3")).toBe("closed");
  expect(statusOf(st, "q1")).toBe("closed"); // earlier epoch unaffected
  lifecycle.dispose();
});

// ------------------------------------------------- default singleton path

test("default getState() singleton path drives the same engine", () => {
  const st = newState();
  seedSubmitted(st, ["q1"]);
  setState(st);
  try {
    const mock = makeMockPi();
    const lifecycle = createLifecycle(mock.pi);
    mock.emit("agent_settled");
    expect(statusOf(st, "q1")).toBe("closed");
    lifecycle.dispose();
  } finally {
    resetState();
  }
});

// ------------------------------------------------- full scripted sequence

describe("h2.44 scripted sequences", () => {
  test("submit → upsert partial → settle → re-answer → resubmit → settle closes", () => {
    const st = newState();
    seedSubmitted(st, ["q1", "q2", "q3"]);
    const mock = makeMockPi();
    const lifecycle = createLifecycle(mock.pi, { getState: () => st });

    runUpsertAndSettle(mock, ["q2"]); // touched q2 only
    expect([statusOf(st, "q1"), statusOf(st, "q2"), statusOf(st, "q3")]).toEqual([
      "closed",
      "reasked",
      "closed",
    ]);

    // User answers the re-asked question and resubmits; agent never re-asks.
    markAnswered(st, "q2", { value: "b", at: AT });
    markSubmitted(st, ["q2"]);
    lifecycle.noteSubmissionDelivered();
    mock.emit("agent_settled");
    expect(statusOf(st, "q2")).toBe("closed");

    lifecycle.dispose();
  });
});

// --------------------------------------------------- upsertedThisRun getter

// P1.M7.T4.S1 — detect.ts consumes this flag at turn_end, which fires BEFORE
// agent_settled's flag-clearing close pass; these tests pin that window.
describe("upsertedThisRun (P1.M7.T4.S1 getter)", () => {
  test("test_upserted_this_run_true_after_successful_upsert_false_after_settle", () => {
    const st = newState();
    seedSubmitted(st, ["q1"]);
    const mock = makeMockPi();
    const lifecycle = createLifecycle(mock.pi, { getState: () => st });

    expect(lifecycle.upsertedThisRun()).toBe(false); // fresh session: no upsert yet

    mock.emit("tool_execution_start", { toolCallId: "call-1", toolName: "interrogate", args: upsertArgs(["q1"]) });
    expect(lifecycle.upsertedThisRun()).toBe(false); // start alone sets nothing

    mock.emit("tool_execution_end", { toolCallId: "call-1", toolName: "interrogate", result: undefined, isError: false });
    expect(lifecycle.upsertedThisRun()).toBe(true); // the turn_end-time window detect.ts reads

    mock.emit("agent_settled"); // close pass clears the flag AFTER turn_end
    expect(lifecycle.upsertedThisRun()).toBe(false);

    lifecycle.dispose();
  });

  test("test_upserted_this_run_stays_false_on_isError_and_resets_via_noteSubmissionDelivered", () => {
    const st = newState();
    seedSubmitted(st, ["q1"]);
    const mock = makeMockPi();
    const lifecycle = createLifecycle(mock.pi, { getState: () => st });

    // isError (thrown stale-guard) records nothing → getter stays false.
    runUpsertAndSettle(mock, ["q1"], { isError: true });
    expect(lifecycle.upsertedThisRun()).toBe(false);

    // A real upsert (start+end, before any settle) raises the flag; a fresh
    // submission delivery resets it — the other flag-clearing path.
    mock.emit("tool_execution_start", { toolCallId: "call-2", toolName: "interrogate", args: upsertArgs(["q1"]) });
    mock.emit("tool_execution_end", { toolCallId: "call-2", toolName: "interrogate", result: undefined, isError: false });
    expect(lifecycle.upsertedThisRun()).toBe(true);
    lifecycle.noteSubmissionDelivered(); // submit-flow contract (after deliverSubmission)
    expect(lifecycle.upsertedThisRun()).toBe(false);

    // dispose drops engine state → flag reads false afterwards.
    mock.emit("tool_execution_start", { toolCallId: "call-3", toolName: "interrogate", args: upsertArgs(["q1"]) });
    mock.emit("tool_execution_end", { toolCallId: "call-3", toolName: "interrogate", result: undefined, isError: false });
    lifecycle.dispose();
    expect(lifecycle.upsertedThisRun()).toBe(false);
  });
});

// ------------------------------------------------- AC-11 regression (FR-32)

describe("close pass × non-TUI record (live RPC itest repro)", () => {
  afterEach(() => resetState());

  test("re-ask then in-run answers[] record re-arms the close pass — completion fires at settle", () => {
    resetState();
    const mock = makeMockPi();
    const st = newState();
    setState(st); // the executor resolves the singleton, not the lifecycle opt
    // The bridge/panel shipped q1 (status submitted) — the world right after
    // a remote submission or panel ctrl+s.
    seedSubmitted(st, ["q1"]);
    let fired: boolean | undefined;
    const sent: string[] = [];
    const sendPi = { sendMessage: (m: { customType: string }) => sent.push(m.customType) };
    const lifecycle = createLifecycle(mock.pi, {
      getState: () => st,
      onAfterClosePass: (r) => {
        fired = attemptCompletion(
          sendPi as unknown as Parameters<typeof attemptCompletion>[0],
          { lifecycle: { dismissPanel: () => {} }, getState: () => st },
          r,
        ).fired;
      },
    });

    // 1. Same-run agent re-upsert touching the submitted id (the itest's
    //    lint re-upsert): the end-handler marks it reasked + arms the
    //    reaskedThisRun suppression.
    mock.emit("tool_execution_start", { toolCallId: "c1", toolName: "interrogate", args: upsertArgs(["q1"]) });
    mock.emit("tool_execution_end", { toolCallId: "c1", toolName: "interrogate", result: undefined, isError: false });
    expect(statusOf(st, "q1")).toBe("reasked");

    // 2. The model records the user's (re-)answer via the fallback answers[]
    //    path, wired exactly like index.ts: onAnswersRecorded →
    //    noteSubmissionDelivered. Record applies + marks submitted…
    executeInterrogate(
      { epoch: st.epoch, answers: [{ id: "q1", value: "a" }] },
      { mode: "print", hasUI: false },
      DEFAULT_CONFIG,
      { onAnswersRecorded: () => lifecycle.noteSubmissionDelivered() },
    );
    expect(statusOf(st, "q1")).toBe("submitted");

    // 3. Settle: WITHOUT the onAnswersRecorded clearing, reaskedThisRun
    //    suppresses toClose and the completion record never fires (the
    //    itest deadlock). With it, the id closes and completion injects.
    mock.emit("agent_settled");
    // Completion fired and clearForCompletion consumed the question map —
    // the id is ABSENT (not "closed"): the deadlock is gone.
    expect(statusOf(st, "q1")).toBe("(absent)");
    expect(fired).toBe(true);
    expect(sent).toEqual(["interrogation-completion"]);
    lifecycle.dispose();
  });

  test("suppression still holds when the record records nothing (unknown ids only)", () => {
    resetState();
    const mock = makeMockPi();
    const st = newState();
    setState(st);
    seedSubmitted(st, ["q1"]);
    const lifecycle = createLifecycle(mock.pi, { getState: () => st });
    mock.emit("tool_execution_start", { toolCallId: "c1", toolName: "interrogate", args: upsertArgs(["q1"]) });
    mock.emit("tool_execution_end", { toolCallId: "c1", toolName: "interrogate", result: undefined, isError: false });
    expect(statusOf(st, "q1")).toBe("reasked");
    // All-unknown record: zero side effects, hook NOT invoked → suppression
    // must survive (the user has NOT re-answered; the panel gets its chance).
    const hook = vi.fn();
    executeInterrogate(
      { epoch: st.epoch, answers: [{ id: "zz", value: "x" }] },
      { mode: "print", hasUI: false },
      DEFAULT_CONFIG,
      { onAnswersRecorded: () => { hook(); lifecycle.noteSubmissionDelivered(); } },
    );
    expect(hook).not.toHaveBeenCalled();
    mock.emit("agent_settled");
    expect(statusOf(st, "q1")).toBe("reasked"); // still open for the user
    lifecycle.dispose();
  });
});

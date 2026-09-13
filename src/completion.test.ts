/**
 * src/completion.test.ts — unit tests for the completion trigger
 * (P1.M2.T2.S2; h3.9). Mock conventions mirror lifecycle.test.ts /
 * delivery.test.ts: a bare `{ sendMessage: vi.fn() }` stands in for pi and a
 * `{ dismissPanel: vi.fn() }` stub for the lifecycle. delivery.ts is
 * vi.mock'd with spy-wrapped REAL implementations so the h3.9 side-effect
 * order is observable via a shared log without changing behavior. Fixture
 * states are real InterrogationStates seeded through the raw primitives +
 * merge.js helpers; the trigger is driven directly with hand-built
 * ClosePassResult objects (integration through the real engine is
 * lifecycle.test.ts's concern).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import {
  attemptCompletion,
  createCompletionTrigger,
  type CompletionTriggerOptions,
} from "./completion.js";
import {
  buildCompletion,
  deliverSubmission,
  type CompletionMessage,
  type DeliveryOptions,
} from "./delivery.js";
import { createLifecycle, type ClosePassResult } from "./lifecycle.js";
import { markAnswered, closeSubmitted, markSubmitted } from "./merge.js";
import {
  createInterrogationState,
  type InterrogationState,
  type Question,
} from "./state.js";

// ------------------------------------------------- delivery spy (real impls)

/** Shared call-order log — pushed by the spy wrappers + dismiss + clear. */
const log = vi.hoisted(() => [] as string[]);

vi.mock("./delivery.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./delivery.js")>();
  return {
    ...actual,
    buildCompletion: vi.fn((...args: Parameters<typeof actual.buildCompletion>) => {
      log.push("build");
      return actual.buildCompletion(...args);
    }),
    deliverSubmission: vi.fn((...args: Parameters<typeof actual.deliverSubmission>) => {
      log.push("deliver");
      return actual.deliverSubmission(...args);
    }),
  };
});

// ------------------------------------------------------------------ mock pi

type SendMessageMock = Mock<[msg: unknown, options?: Record<string, unknown>], void>;

interface MockPi {
  pi: Pick<ExtensionAPI, "sendMessage">;
  sendMessage: SendMessageMock;
}

function makeMockPi(): MockPi {
  const sendMessage: SendMessageMock = vi.fn(
    (_msg: unknown, _options?: Record<string, unknown>): void => {},
  );
  // Cast mirrors tool.test.ts/lifecycle.test.ts: the mock's call signature is
  // a widened superset of pi.sendMessage's generic overload.
  return { pi: { sendMessage } as unknown as Pick<ExtensionAPI, "sendMessage">, sendMessage };
}

// ----------------------------------------------------------------- fixtures

const OPTS_AB = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];

const AT = "2025-01-01T00:00:00.000Z";

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

function makeState(): InterrogationState {
  return createInterrogationState("test goal");
}

/** Fixture that also records the clear step in the shared h3.9 order log. */
function makeTrackedState(): InterrogationState {
  const st = makeState();
  st.on("completed-cleared", () => log.push("clear")); // fired inside clearForCompletion
  return st;
}

/** Seed ids as answered-then-submitted — the shape right after ctrl+s. */
function seedSubmitted(st: InterrogationState, ids: string[]): void {
  for (const id of ids) {
    st.upsertQuestion(choiceQ(id));
    markAnswered(st, id, { value: "a", at: AT });
  }
  markSubmitted(st, ids);
}

/** Hand-built ClosePassResult — the engine's report, NOT trusted by the predicate. */
function closePass(overrides: Partial<ClosePassResult> = {}): ClosePassResult {
  return { closed: [], reasked: [], remainingActive: [], ...overrides };
}

function makeOpts(
  st: InterrogationState | undefined,
  overrides: Partial<CompletionTriggerOptions> = {},
): CompletionTriggerOptions {
  return {
    lifecycle: {
      dismissPanel: () => {
        log.push("dismiss");
      },
    },
    getState: () => st,
    ...overrides,
  };
}

beforeEach(() => {
  log.length = 0; // reset the shared order log
  vi.mocked(buildCompletion).mockClear();
  vi.mocked(deliverSubmission).mockClear();
});

function sentMessage(pi: MockPi): CompletionMessage {
  expect(pi.sendMessage).toHaveBeenCalledTimes(1);
  return pi.sendMessage.mock.calls[0]?.[0] as CompletionMessage;
}

function sentOptions(pi: MockPi): DeliveryOptions {
  return pi.sendMessage.mock.calls[0]?.[1] as DeliveryOptions;
}

// -------------------------------------------------- decision outcomes

describe("attemptCompletion — decision outcomes", () => {
  test("no state → {fired:false, reason:'no-state'}, no throw, no side effects", () => {
    const pi = makeMockPi();
    const res = attemptCompletion(pi.pi, makeOpts(undefined), closePass());
    expect(res).toEqual({ fired: false, reason: "no-state" });
    expect(pi.sendMessage).not.toHaveBeenCalled();
    expect(log).toEqual([]);
  });

  test("zero-question fresh state does not fire — completion implies content existed", () => {
    const pi = makeMockPi();
    const st = makeState(); // never used: no questions, no snapshots, epoch 1
    const res = attemptCompletion(pi.pi, makeOpts(st), closePass());
    expect(res).toEqual({ fired: false, reason: "active-questions-remain" });
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });

  test("blocks while any question is open/answered/submitted/reasked/moot", () => {
    const statuses = ["open", "answered", "submitted", "reasked", "moot"] as const;
    for (const status of statuses) {
      const st = makeState();
      st.upsertQuestion(choiceQ("q1"));
      st.setStatus("q1", status);
      const pi = makeMockPi();
      // The engine's remainingActive excludes moot — the local predicate must
      // block anyway (never trust the report for the decision).
      const res = attemptCompletion(pi.pi, makeOpts(st), closePass());
      expect(res).toEqual({ fired: false, reason: "active-questions-remain" });
      expect(pi.sendMessage).not.toHaveBeenCalled();
      expect(st.completed).toBe(false); // nothing mutated on a blocked pass
    }
  });

  test("withdrawn/closed statuses do not block", () => {
    const st = makeState();
    st.upsertQuestion(choiceQ("q1"));
    st.upsertQuestion(choiceQ("q2"));
    st.setStatus("q1", "withdrawn");
    st.setStatus("q2", "closed");
    const pi = makeMockPi();
    const res = attemptCompletion(pi.pi, makeOpts(st), closePass());
    expect(res).toEqual({ fired: true });
  });
});

// --------------------------------------------- exactly-once + h3.9 order

describe("attemptCompletion — fires exactly once, in h3.9 order", () => {
  test("completion fires exactly once and in h3.9 order", () => {
    const st = makeTrackedState();
    seedSubmitted(st, ["q1", "q2"]);
    st.bumpEpoch(); // epoch → 2 (a submission happened)
    closeSubmitted(st, ["q1", "q2"]); // the settle's close pass archived them
    const pi = makeMockPi();

    const res = attemptCompletion(pi.pi, makeOpts(st), closePass({ closed: ["q1", "q2"] }));

    expect(res).toEqual({ fired: true });
    // h3.9 side-effect order — build → deliver → dismiss → clear, verbatim.
    expect(log).toEqual(["build", "deliver", "dismiss", "clear"]);
    // Exactly ONE pi.sendMessage with the completion record, matrix-correct.
    const msg = sentMessage(pi);
    expect(msg.customType).toBe("interrogation-completion");
    expect(msg.display).toBe(true);
    expect(msg.content).toContain("INTERROGATION COMPLETE — test goal");
    expect(msg.content).toContain("prompt:q1"); // built from the FULL state
    expect(msg.details.groups.length).toBeGreaterThan(0); // not built post-clear
    expect(sentOptions(pi)).toEqual({ triggerTurn: true, deliverAs: "followUp" });
  });

  test("second close pass after completion → already-completed, zero sends", () => {
    const st = makeTrackedState();
    seedSubmitted(st, ["q1"]);
    closeSubmitted(st, ["q1"]);
    const pi = makeMockPi();
    expect(attemptCompletion(pi.pi, makeOpts(st), closePass()).fired).toBe(true);

    // Double settle / repeat close pass — cannot re-fire.
    const res = attemptCompletion(pi.pi, makeOpts(st), closePass());
    expect(res).toEqual({ fired: false, reason: "already-completed" });
    expect(pi.sendMessage).toHaveBeenCalledTimes(1); // still exactly one
    expect(log).toEqual(["build", "deliver", "dismiss", "clear"]); // no re-run
  });

  test("upsert after completion cannot re-arm completion (guard before predicate)", () => {
    const st = makeState();
    seedSubmitted(st, ["q1"]);
    closeSubmitted(st, ["q1"]);
    const pi = makeMockPi();
    expect(attemptCompletion(pi.pi, makeOpts(st), closePass()).fired).toBe(true);

    st.upsertQuestion(choiceQ("q1")); // racing/following upsert → status open
    const res = attemptCompletion(pi.pi, makeOpts(st), closePass());
    // reason already-completed (not active-questions-remain) proves the guard
    // runs BEFORE the predicate.
    expect(res).toEqual({ fired: false, reason: "already-completed" });
    expect(pi.sendMessage).toHaveBeenCalledTimes(1);
  });

  test("h2.37 edge: 0 open + pending submissions → waits; next reply's close pass fires", () => {
    const st = makeState();
    seedSubmitted(st, ["q1"]); // 0 open, 1 submitted
    const pi = makeMockPi();

    // Close pass 1: the engine reports remainingActive = [] (excludes
    // submitted by design) — completion must STILL not fire.
    const r1 = attemptCompletion(pi.pi, makeOpts(st), closePass());
    expect(r1).toEqual({ fired: false, reason: "active-questions-remain" });
    expect(pi.sendMessage).not.toHaveBeenCalled();

    // Next agent reply + settle with no re-ask → close pass archives → fires.
    closeSubmitted(st, ["q1"]);
    const r2 = attemptCompletion(pi.pi, makeOpts(st), closePass({ closed: ["q1"] }));
    expect(r2).toEqual({ fired: true });
    expect(pi.sendMessage).toHaveBeenCalledTimes(1);
  });

  test("moot question blocks until the moot path leaves no moot", () => {
    const st = makeState();
    st.upsertQuestion(choiceQ("q1"));
    st.setStatus("q1", "moot");
    const pi = makeMockPi();

    expect(attemptCompletion(pi.pi, makeOpts(st), closePass())).toEqual({
      fired: false,
      reason: "active-questions-remain",
    });

    st.setStatus("q1", "withdrawn"); // moot resolved via withdrawal path
    expect(attemptCompletion(pi.pi, makeOpts(st), closePass()).fired).toBe(true);
  });
});

// ------------------------------------------------- side effects & wiring

describe("attemptCompletion — side effects & wiring", () => {
  test("busy ctx → steer options (no triggerTurn key); idle ctx → followUp + triggerTurn", () => {
    // Each delivery-matrix branch needs its own fresh completable fixture —
    // the first firing clears the state (one-time guard).
    const completable = (): InterrogationState => {
      const st = makeState();
      seedSubmitted(st, ["q1"]);
      closeSubmitted(st, ["q1"]);
      return st;
    };

    const busy = makeMockPi();
    attemptCompletion(
      busy.pi,
      { ...makeOpts(completable()), ctx: { isIdle: () => false } },
      closePass(),
    );
    expect(sentOptions(busy)).toEqual({ deliverAs: "steer" }); // no triggerTurn key

    const idle = makeMockPi();
    attemptCompletion(
      idle.pi,
      { ...makeOpts(completable()), ctx: { isIdle: () => true } },
      closePass(),
    );
    expect(sentOptions(idle)).toEqual({ triggerTurn: true, deliverAs: "followUp" });
  });

  test("dismissPanel invoked exactly once per firing; blocked passes never dismiss", () => {
    const st = makeState();
    seedSubmitted(st, ["q1"]);
    const pi = makeMockPi();
    attemptCompletion(pi.pi, makeOpts(st), closePass()); // blocked (submitted)
    expect(log).toEqual([]); // no dismiss on a blocked pass

    closeSubmitted(st, ["q1"]);
    attemptCompletion(pi.pi, makeOpts(st), closePass({ closed: ["q1"] }));
    expect(log.filter((entry) => entry === "dismiss")).toHaveLength(1);
  });

  test("real lifecycle.dismissPanel with no panel callback is a safe no-op", () => {
    const on = vi.fn((_event: string, _handler: (event: unknown) => void) => () => {});
    const lifecycle = createLifecycle({ on } as unknown as Pick<ExtensionAPI, "on">);
    const st = makeState();
    seedSubmitted(st, ["q1"]);
    closeSubmitted(st, ["q1"]);
    const pi = makeMockPi();

    const res = attemptCompletion(
      pi.pi,
      { lifecycle, getState: () => st },
      closePass({ closed: ["q1"] }),
    );

    expect(res).toEqual({ fired: true }); // stub dismiss threw nothing
    lifecycle.dispose();
  });

  test("getBatchNotes passthrough: notes reach buildCompletion; undefined → []", () => {
    const st = makeState();
    seedSubmitted(st, ["q1"]);
    closeSubmitted(st, ["q1"]);

    const withNotes = makeMockPi();
    const r1 = attemptCompletion(
      withNotes.pi,
      { ...makeOpts(st), getBatchNotes: () => ["note one", "note two"] },
      closePass(),
    );
    expect(r1.fired).toBe(true);
    expect(sentMessage(withNotes).details.notes).toEqual(["note one", "note two"]);

    // Rebuild a fresh fixture for the undefined-notes case.
    const fresh = makeState();
    seedSubmitted(fresh, ["q1"]);
    closeSubmitted(fresh, ["q1"]);
    const withoutNotes = makeMockPi();
    const r2 = attemptCompletion(withoutNotes.pi, makeOpts(fresh), closePass());
    expect(r2.fired).toBe(true);
    expect(sentMessage(withoutNotes).details.notes).toEqual([]);
  });

  test("post-completion state: questions empty, completed=true, goal/epoch/snapshots retained", () => {
    const st = makeState();
    seedSubmitted(st, ["q1"]);
    st.bumpEpoch(); // epoch → 2
    st.snapshots.push({ epoch: 1, at: AT, state: st.serialize() }); // audit trail
    closeSubmitted(st, ["q1"]);
    const pi = makeMockPi();

    attemptCompletion(pi.pi, makeOpts(st), closePass({ closed: ["q1"] }));

    expect(st.orderedQuestions()).toEqual([]);
    expect(st.completed).toBe(true);
    expect(st.goal).toBe("test goal"); // retained
    expect(st.epoch).toBe(2); // retained
    expect(st.snapshots).toHaveLength(1); // retained for renderers (M7.T3.S2)
    expect(st.serialize().completed).toBe(true); // round-trips
  });
});

// ------------------------------------------------------- void callback seam

describe("createCompletionTrigger", () => {
  test("returns a void onAfterClosePass callback that fires the flow", () => {
    const st = makeTrackedState();
    seedSubmitted(st, ["q1"]);
    closeSubmitted(st, ["q1"]);
    const pi = makeMockPi();
    const trigger = createCompletionTrigger(pi.pi, makeOpts(st));

    expect(trigger(closePass({ closed: ["q1"] }))).toBeUndefined(); // void contract

    expect(pi.sendMessage).toHaveBeenCalledTimes(1);
    expect(log).toEqual(["build", "deliver", "dismiss", "clear"]);
    expect(st.completed).toBe(true);
  });

  test("the returned callback ignores a no-state session (never throws)", () => {
    const pi = makeMockPi();
    const trigger = createCompletionTrigger(pi.pi, makeOpts(undefined));
    expect(() => trigger(closePass())).not.toThrow();
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });
});

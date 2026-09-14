/**
 * Unit tests for src/state.ts (P1.M1.T2.S1).
 *
 * Core tests use fresh InterrogationState instances (fresh per test in
 * beforeEach) — the module singleton is exercised only in the dedicated
 * singleton test, which always resets after itself. The final test is the
 * cheap static h2.13 guard: state.ts may import node:events only.
 */
import * as fs from "node:fs";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, test } from "vitest";
import {
  InterrogationState,
  UNGROUPED_LABEL,
  createInterrogationState,
  getState,
  resetState,
  setState,
  type Question,
  type SerializedState,
} from "./state";

/** Fresh question with sensible defaults; overrides win. */
function q(overrides: Partial<Question> & { id: string }): Question {
  return {
    prompt: `prompt for ${overrides.id}`,
    type: "text",
    rev: 1,
    status: "open",
    ...overrides,
  };
}

let state: InterrogationState;

beforeEach(() => {
  state = createInterrogationState("Plan the migration");
});

describe("createInterrogationState", () => {
  test("starts at epoch 1 with empty questions/order/snapshots and the given goal", () => {
    expect(state.epoch).toBe(1);
    expect(state.goal).toBe("Plan the migration");
    expect(state.snapshots).toEqual([]);
    const serialized = state.serialize();
    expect(serialized.order).toEqual([]);
    expect(serialized.questions).toEqual({});
  });
});

describe("setGoal", () => {
  test("updates state.goal and serialize().goal; emits exactly one 'changed' with the new value", () => {
    state.upsertQuestion(q({ id: "q1" }));
    const revBefore = state.getQuestion("q1")!.rev;
    const changed: SerializedState[] = [];
    state.on("changed", (st) => changed.push(st));
    state.setGoal("Ship the redesign");
    expect(state.goal).toBe("Ship the redesign");
    expect(state.serialize().goal).toBe("Ship the redesign");
    expect(changed).toHaveLength(1);
    expect(changed[0].goal).toBe("Ship the redesign");
    expect(changed[0].epoch).toBe(1); // goal is not epoch territory (h2.39)
    expect(state.getQuestion("q1")?.rev).toBe(revBefore); // question revs untouched
    expect(state.snapshots).toEqual([]); // snapshot ring untouched
  });

  test("same string still emits (simple, predictable primitive)", () => {
    const changed: SerializedState[] = [];
    state.on("changed", (st) => changed.push(st));
    state.setGoal("Plan the migration");
    expect(changed).toHaveLength(1);
    expect(changed[0].goal).toBe("Plan the migration");
  });

  test("empty goal is legal", () => {
    const changed: SerializedState[] = [];
    state.on("changed", (st) => changed.push(st));
    state.setGoal("");
    expect(state.goal).toBe("");
    expect(state.serialize().goal).toBe("");
    expect(changed).toHaveLength(1);
    expect(changed[0].goal).toBe("");
  });

  test("constructor goal is readable before any setGoal (regression)", () => {
    expect(state.goal).toBe("Plan the migration");
    expect(state.serialize().goal).toBe("Plan the migration");
  });
});

describe("upsertQuestion", () => {
  test("new id: stored, appended to order, forced open at rev 1", () => {
    state.upsertQuestion(q({ id: "q1", rev: 99, status: "closed" }));
    expect(state.getQuestion("q1")?.status).toBe("open");
    expect(state.getQuestion("q1")?.rev).toBe(1);
    expect(state.serialize().order).toEqual(["q1"]);
  });

  test("new id: emits 'questions-upserted' with [id] and 'changed' with full state", () => {
    const upserted: string[][] = [];
    const changed: SerializedState[] = [];
    state.on("questions-upserted", (ids) => upserted.push(ids));
    state.on("changed", (st) => changed.push(st));
    state.upsertQuestion(q({ id: "q1" }));
    expect(upserted).toEqual([["q1"]]);
    expect(changed).toHaveLength(1);
    expect(changed[0].epoch).toBe(1);
    expect(changed[0].goal).toBe("Plan the migration");
    expect(changed[0].questions.q1).toBeDefined();
    expect(changed[0].order).toEqual(["q1"]);
  });

  test("existing id: replaced wholesale, order position preserved, rev/status kept (raw)", () => {
    state.upsertQuestion(q({ id: "q1" }));
    state.upsertQuestion(q({ id: "q2" }));
    state.upsertQuestion(q({ id: "q1", prompt: "updated prompt", rev: 7, status: "submitted" }));
    expect(state.getQuestion("q1")?.prompt).toBe("updated prompt");
    expect(state.getQuestion("q1")?.rev).toBe(7);
    expect(state.getQuestion("q1")?.status).toBe("submitted");
    expect(state.serialize().order).toEqual(["q1", "q2"]);
  });

  test("removeQuestion: drops from map and order, emits 'changed'", () => {
    const changed: SerializedState[] = [];
    state.on("changed", (st) => changed.push(st));
    state.upsertQuestion(q({ id: "q1" }));
    state.upsertQuestion(q({ id: "q2" }));
    state.removeQuestion("q1");
    expect(state.getQuestion("q1")).toBeUndefined();
    expect(state.serialize().order).toEqual(["q2"]);
    expect(changed).toHaveLength(3); // 2 upserts + remove
  });
});

describe("bumpRev", () => {
  test("increments rev (1 → 2) and emits 'changed' each time", () => {
    state.upsertQuestion(q({ id: "q1" }));
    const changed: SerializedState[] = [];
    state.on("changed", (st) => changed.push(st));
    state.bumpRev("q1");
    expect(state.getQuestion("q1")?.rev).toBe(2);
    state.bumpRev("q1");
    expect(state.getQuestion("q1")?.rev).toBe(3);
    expect(changed).toHaveLength(2);
  });

  test("unknown id throws", () => {
    expect(() => state.bumpRev("nope")).toThrow("unknown question id: nope");
  });
});

describe("bumpEpoch", () => {
  test("1 → 2 → 3; 'epoch-bumped' payload carries the new value; returns it", () => {
    const bumps: number[] = [];
    state.on("epoch-bumped", (epoch) => bumps.push(epoch));
    expect(state.bumpEpoch()).toBe(2);
    expect(state.bumpEpoch()).toBe(3);
    expect(state.epoch).toBe(3);
    expect(bumps).toEqual([2, 3]);
  });
});

describe("applyAnswer", () => {
  test("sets answer + status 'answered'; rev UNCHANGED (h2.39); emits 'changed'", () => {
    state.upsertQuestion(q({ id: "q1" }));
    state.bumpRev("q1"); // rev now 2
    const changed: SerializedState[] = [];
    state.on("changed", (st) => changed.push(st));
    const at = new Date().toISOString();
    state.applyAnswer("q1", { value: "postgres", text: "team knows it", at });
    const after = state.getQuestion("q1");
    expect(after?.status).toBe("answered");
    expect(after?.rev).toBe(2); // regression guard: answers never bump rev
    expect(after?.answer).toEqual({ value: "postgres", text: "team knows it", at });
    expect(changed).toHaveLength(1);
  });

  test("unknown id throws", () => {
    expect(() => state.applyAnswer("nope", { value: "x", at: "t" })).toThrow(
      "unknown question id: nope",
    );
  });
});

describe("setStatus", () => {
  test("raw transition without touching rev; unknown id throws", () => {
    state.upsertQuestion(q({ id: "q1" }));
    state.setStatus("q1", "moot");
    expect(state.getQuestion("q1")?.status).toBe("moot");
    expect(state.getQuestion("q1")?.rev).toBe(1);
    expect(() => state.setStatus("nope", "open")).toThrow("unknown question id: nope");
  });
});

describe("orderedQuestions", () => {
  test("returns questions in order[] insertion sequence", () => {
    state.upsertQuestion(q({ id: "a" }));
    state.upsertQuestion(q({ id: "b" }));
    state.upsertQuestion(q({ id: "c" }));
    expect(state.orderedQuestions().map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  test("skips orphaned order entries defensively (via tolerant deserialize)", () => {
    const rebuilt = InterrogationState.deserialize({
      goal: "g",
      epoch: 1,
      order: ["ghost", "a"],
      questions: { a: { prompt: "p", type: "text", rev: 1, status: "open" } },
    });
    expect(rebuilt.orderedQuestions().map((x) => x.id)).toEqual(["a"]);
  });
});

describe("groupSummaries", () => {
  test("aggregates per group; ungrouped questions counted under '(none)'", () => {
    state.upsertQuestion(q({ id: "q1", group: "db" }));
    state.upsertQuestion(q({ id: "q2", group: "db" }));
    state.upsertQuestion(q({ id: "q3", group: "ui" }));
    state.upsertQuestion(q({ id: "q4" }));
    state.upsertQuestion(q({ id: "q5" }));
    state.applyAnswer("q2", { value: "x", at: "t" });
    state.setStatus("q3", "submitted");
    state.setStatus("q4", "moot");
    state.setStatus("q5", "closed");

    const summaries = state.groupSummaries();
    expect(summaries).toHaveLength(3);
    expect(summaries.find((s) => s.group === "db")).toEqual({
      group: "db",
      total: 2,
      answered: 1,
      submitted: 0,
      open: 1,
      moot: 0,
      withdrawn: 0,
      closed: 0,
      reasked: 0,
    });
    expect(summaries.find((s) => s.group === "ui")?.submitted).toBe(1);
    expect(summaries.find((s) => s.group === UNGROUPED_LABEL)).toEqual({
      group: "(none)",
      total: 2,
      answered: 0,
      submitted: 0,
      open: 0,
      moot: 1,
      withdrawn: 0,
      closed: 1,
      reasked: 0,
    });
  });
});

describe("clearForCompletion", () => {
  test("emits 'completed-cleared', clears questions/order, retains epoch/goal/snapshots", () => {
    let cleared = 0;
    state.on("completed-cleared", () => {
      cleared++;
    });
    state.upsertQuestion(q({ id: "q1" }));
    state.bumpEpoch(); // epoch → 2
    state.snapshots.push({ epoch: 1, at: "t", state: state.serialize() });

    state.clearForCompletion();

    expect(cleared).toBe(1);
    expect(state.serialize().questions).toEqual({});
    expect(state.serialize().order).toEqual([]);
    expect(state.epoch).toBe(2); // epoch retained (audit trail)
    expect(state.goal).toBe("Plan the migration"); // goal retained
    expect(state.snapshots).toHaveLength(1); // snapshots kept
  });

  test("still emits 'changed' after clearing (empty-state snapshot)", () => {
    const changed: SerializedState[] = [];
    state.on("changed", (st) => changed.push(st));
    state.upsertQuestion(q({ id: "q1" }));
    state.clearForCompletion();
    expect(changed).toHaveLength(2);
    expect(changed[1].questions).toEqual({});
  });

  test("sets the one-time completed flag; serialize round-trips it (P1.M2.T2.S2)", () => {
    expect(state.completed).toBe(false); // fresh default
    state.upsertQuestion(q({ id: "q1" }));
    state.clearForCompletion();
    expect(state.completed).toBe(true);

    const snap = state.serialize();
    expect(snap.completed).toBe(true);
    const revived = InterrogationState.deserialize(snap);
    expect(revived.completed).toBe(true); // M7.T1 restores the guard
  });

  test("deserialize tolerates a missing completed field (legacy payload → false)", () => {
    state.upsertQuestion(q({ id: "q1" }));
    const legacy = JSON.parse(JSON.stringify(state.serialize())) as Record<string, unknown>;
    delete legacy.completed;
    expect(InterrogationState.deserialize(legacy).completed).toBe(false);
  });
});

describe("serialize/deserialize round-trip", () => {
  test("round-trips losslessly, both direct and via JSON", () => {
    state.upsertQuestion(
      q({
        id: "q1",
        title: "Database",
        description: "pick one",
        type: "choice",
        group: "db",
        gate: true,
        recommendation: "postgres",
        options: [{ value: "postgres", label: "Postgres", ramification: "ops burden" }],
      }),
    );
    state.upsertQuestion(
      q({ id: "q2", dependsOn: [{ id: "q1", equals: "postgres" }] }),
    );
    state.applyAnswer("q1", { value: "postgres", text: "familiar", at: "2025-01-01T00:00:00.000Z" });
    state.bumpRev("q2");
    state.bumpEpoch();

    const direct = InterrogationState.deserialize(state.serialize());
    expect(direct.serialize()).toStrictEqual(state.serialize());

    const viaJson = InterrogationState.deserialize(
      JSON.parse(JSON.stringify(state.serialize())),
    );
    expect(viaJson.serialize()).toStrictEqual(state.serialize());
    expect(viaJson.getQuestion("q1")?.answer).toEqual({
      value: "postgres",
      text: "familiar",
      at: "2025-01-01T00:00:00.000Z",
    });
    expect(viaJson.orderedQuestions().map((x) => x.id)).toEqual(["q1", "q2"]);
  });
});

describe("deserialize tolerance", () => {
  test("null/undefined/arrays/primitives → empty defaults, no throw", () => {
    for (const bad of [null, undefined, 42, "nope", [], true]) {
      const s = InterrogationState.deserialize(bad);
      expect(s.goal).toBe("");
      expect(s.epoch).toBe(1);
      expect(s.serialize().questions).toEqual({});
      expect(s.serialize().order).toEqual([]);
    }
  });

  test("missing/invalid fields fall back to defaults; malformed entries skipped; order normalized", () => {
    const s = InterrogationState.deserialize({
      goal: "g",
      epoch: "three", // invalid → 1
      order: ["q1", "q1", "ghost", "q2"], // deduped; ghost dropped
      questions: {
        q1: { prompt: "P" }, // only prompt → all defaults
        q2: {
          prompt: "Q",
          rev: 4,
          status: "submitted",
          type: "text",
          answer: { value: "v", at: "t", text: "extra" },
        },
        bad: "not-an-object", // skipped
        worse: 7, // skipped
      },
    });
    expect(s.goal).toBe("g");
    expect(s.epoch).toBe(1);
    expect(s.serialize().order).toEqual(["q1", "q2"]); // q2 appended (missing from order)
    expect(s.getQuestion("q1")).toMatchObject({
      id: "q1",
      prompt: "P",
      type: "choice",
      rev: 1,
      status: "open",
    });
    expect(s.getQuestion("q2")).toMatchObject({
      rev: 4,
      status: "submitted",
      type: "text",
      answer: { value: "v", at: "t", text: "extra" },
    });
  });

  test("non-numeric epoch → 1; valid finite epoch preserved", () => {
    expect(InterrogationState.deserialize({ epoch: Number.NaN }).epoch).toBe(1);
    expect(InterrogationState.deserialize({ epoch: Number.POSITIVE_INFINITY }).epoch).toBe(1);
    expect(InterrogationState.deserialize({ epoch: "9" }).epoch).toBe(1);
    expect(InterrogationState.deserialize({ epoch: 9 }).epoch).toBe(9);
  });

  test("deserialize emits NO events", () => {
    const calls: unknown[][] = [];
    const original = EventEmitter.prototype.emit;
    EventEmitter.prototype.emit = function spy(event: string | symbol, ...args: unknown[]) {
      calls.push([event, ...args]);
      return true;
    };
    try {
      InterrogationState.deserialize({
        goal: "g",
        epoch: 3,
        order: ["q1"],
        questions: { q1: { prompt: "p", status: "answered", answer: { value: "v", at: "t" } } },
      });
    } finally {
      EventEmitter.prototype.emit = original;
    }
    expect(calls).toEqual([]);
  });
});

describe("singleton accessor", () => {
  test("undefined → setState → get → resetState → undefined", () => {
    resetState(); // guarantee clean slate regardless of execution order
    expect(getState()).toBeUndefined();
    const s = createInterrogationState("g");
    setState(s);
    expect(getState()).toBe(s);
    resetState();
    expect(getState()).toBeUndefined();
  });
});

describe("h2.13 no-UI guard", () => {
  test("state.ts imports ONLY node:events", () => {
    const src = fs.readFileSync(new URL("./state.ts", import.meta.url), "utf8");
    const importLines = src.split("\n").filter((line) => line.startsWith("import "));
    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) {
      expect(line).toMatch(/^import .* from "node:events";$/);
    }
  });
});

/**
 * Unit tests for src/guards.ts (P1.M1.T3.S2).
 *
 * Fixtures drive the real state API (createInterrogationState /
 * upsertQuestion / applyAnswer / takeSnapshot / bumpEpoch / bumpRev) so the
 * asserted STALE messages are produced end-to-end through digestSince.
 * Final tests are the purity check (guards never mutate state or emit
 * events) and the module-hygiene import guard (state.test.ts convention).
 */
import * as fs from "node:fs";
import { beforeEach, describe, expect, test } from "vitest";
import { StaleError, assertFresh, buildStaleMessage } from "./guards.js";
import { takeSnapshot } from "./snapshots.js";
import { createInterrogationState, type InterrogationState, type Question } from "./state.js";
import type { ParsedAction, QuestionInput } from "./tool-schema.js";

const T0 = "2025-01-01T00:00:00.000Z";

const DB_OPTIONS = [
  { value: "postgres", label: "Postgres" },
  { value: "sqlite", label: "SQLite" },
];

/** Full stored Question with sensible defaults; overrides win. */
function stored(overrides: Partial<Question> & { id: string }): Question {
  return {
    prompt: `prompt for ${overrides.id}`,
    type: "text",
    rev: 1,
    status: "open",
    ...overrides,
  };
}

/** Capture a thrown value, or undefined when nothing threw. */
function capture(fn: () => void): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

/**
 * State at epoch 9 with question q3 ("Which database?", choice) at rev 5,
 * answered postgres since epoch 5, snapshots labeled 1..8. The stale
 * caller's view: epoch 4, q3 at rev 2, q3 unanswered. digestSince(state, 4)
 * therefore yields exactly "q3: (unanswered)→Postgres" (snap4 → snap5);
 * digestSince(state, 8) yields "" (snap8 → live: no change).
 */
function buildStaleFixture(): InterrogationState {
  const state = createInterrogationState("ship it");
  state.upsertQuestion(
    stored({ id: "q3", prompt: "Which database?", type: "choice", options: DB_OPTIONS }),
  );
  // Epochs 1→5: snapshots labeled 1..4, q3 unanswered throughout.
  for (let i = 0; i < 4; i++) {
    takeSnapshot(state);
    state.bumpEpoch();
  }
  // User answers and submits: snapshot 5 carries the change vs snap 4.
  state.applyAnswer("q3", { value: "postgres", at: T0 });
  takeSnapshot(state);
  state.bumpEpoch(); // epoch 6
  // Three quiet submissions → epoch 9, snapshots 6..8, nothing changes.
  for (let i = 0; i < 3; i++) {
    takeSnapshot(state);
    state.bumpEpoch();
  }
  // Agent re-asked q3 after the caller's read: rev 1 → 5.
  for (let i = 0; i < 4; i++) state.bumpRev("q3");
  return state;
}

/** The stale upsert from the AC-8 user journey (PRP h3.8 fixture). */
const STALE_UPSERT: ParsedAction = {
  action: "upsert",
  epoch: 4,
  questions: [
    { id: "q3", rev: 2, prompt: "Which database?", type: "choice", options: DB_OPTIONS },
  ],
};

describe("assertFresh — h3.8 message shapes", () => {
  let state: InterrogationState;
  beforeEach(() => {
    state = buildStaleFixture();
  });

  test("combined rev+epoch mismatch matches the h3.8 template byte-for-byte", () => {
    const err = capture(() => assertFresh(state, STALE_UPSERT));
    expect(err).toBeInstanceOf(StaleError);
    const stale = err as StaleError;
    expect(stale.message).toBe(
      "STALE: q3 is at rev 5 (you sent 2); session epoch is 9 (you sent 4). " +
        "Current q3: Which database?. " +
        "Changes since epoch 4: q3: (unanswered)→Postgres. " +
        "Re-apply against current state.",
    );
    expect(stale.details).toEqual({
      id: "q3",
      sentRev: 2,
      currentRev: 5,
      sentEpoch: 4,
      currentEpoch: 9,
      digest: "q3: (unanswered)→Postgres",
    });
  });

  test("rev-only mismatch (epoch absent) omits epoch and digest clauses", () => {
    const err = capture(() =>
      assertFresh(state, {
        action: "upsert",
        questions: [
          { id: "q3", rev: 2, prompt: "Which database?", type: "choice", options: DB_OPTIONS },
        ],
      }),
    );
    const stale = err as StaleError;
    expect(stale.message).toBe(
      "STALE: q3 is at rev 5 (you sent 2). Current q3: Which database?. " +
        "Re-apply against current state.",
    );
    expect(stale.details).toEqual({ id: "q3", sentRev: 2, currentRev: 5 });
  });

  test("rev-only mismatch (epoch matches current) also omits the epoch clause", () => {
    const err = capture(() =>
      assertFresh(state, {
        action: "upsert",
        epoch: 9,
        questions: [
          { id: "q3", rev: 2, prompt: "Which database?", type: "choice", options: DB_OPTIONS },
        ],
      }),
    );
    const stale = err as StaleError;
    expect(stale.message).toBe(
      "STALE: q3 is at rev 5 (you sent 2). Current q3: Which database?. " +
        "Re-apply against current state.",
    );
    expect(stale.details).toEqual({ id: "q3", sentRev: 2, currentRev: 5 });
  });

  test("epoch-only mismatch (all revs fresh) carries the delta digest", () => {
    const err = capture(() =>
      assertFresh(state, {
        action: "upsert",
        epoch: 4,
        questions: [
          { id: "q3", rev: 5, prompt: "Which database?", type: "choice", options: DB_OPTIONS },
        ],
      }),
    );
    const stale = err as StaleError;
    expect(stale.message).toBe(
      "STALE: session epoch is 9 (you sent 4). " +
        "Changes since epoch 4: q3: (unanswered)→Postgres. " +
        "Re-apply against current state.",
    );
    expect(stale.details).toEqual({
      sentEpoch: 4,
      currentEpoch: 9,
      digest: "q3: (unanswered)→Postgres",
    });
  });

  test("epoch-only mismatch with only new ids throws the same variant", () => {
    const err = capture(() =>
      assertFresh(state, {
        action: "upsert",
        epoch: 4,
        questions: [{ id: "q-new", prompt: "Fresh?", type: "text" }],
      }),
    );
    const stale = err as StaleError;
    expect(stale.message).toBe(
      "STALE: session epoch is 9 (you sent 4). " +
        "Changes since epoch 4: q3: (unanswered)→Postgres. " +
        "Re-apply against current state.",
    );
  });

  test("empty digestSince output renders (none)", () => {
    // Caller sent epoch 8: snap8 → live has no answer changes → digest "".
    const err = capture(() =>
      assertFresh(state, { action: "record", epoch: 8, answers: [{ id: "q3", value: "x" }] }),
    );
    const stale = err as StaleError;
    expect(stale.message).toBe(
      "STALE: session epoch is 9 (you sent 8). Changes since epoch 8: (none). " +
        "Re-apply against current state.",
    );
    expect(stale.details.digest).toBe("");
  });

  test("empty snapshot ring renders (none) too", () => {
    const fresh = createInterrogationState("goal"); // epoch 1, no snapshots
    const err = capture(() =>
      assertFresh(fresh, { action: "record", epoch: 3, answers: [{ id: "q3", value: "x" }] }),
    );
    const stale = err as StaleError;
    expect(stale.message).toBe(
      "STALE: session epoch is 1 (you sent 3). Changes since epoch 3: (none). " +
        "Re-apply against current state.",
    );
  });
});

describe("assertFresh — pass-through and guard matrix", () => {
  let state: InterrogationState;
  beforeEach(() => {
    state = buildStaleFixture();
  });

  test("read and reopen are never guarded, with any/missing epoch", () => {
    expect(() => assertFresh(state, { action: "read" })).not.toThrow();
    expect(() => assertFresh(state, { action: "reopen" })).not.toThrow();
    // Tolerance: unexpected fields on read/reopen are ignored, not guarded.
    expect(() =>
      assertFresh(state, { action: "read", epoch: 4 } as unknown as ParsedAction),
    ).not.toThrow();
  });

  test("new-id upsert without rev passes (with or without epoch)", () => {
    expect(() =>
      assertFresh(state, {
        action: "upsert",
        questions: [{ id: "q-new", prompt: "Fresh?", type: "text" }],
      }),
    ).not.toThrow();
    expect(() =>
      assertFresh(state, {
        action: "upsert",
        epoch: 9,
        questions: [{ id: "q-new", prompt: "Fresh?", type: "text" }],
      }),
    ).not.toThrow();
  });

  test("existing-id upsert without rev throws the rev-only variant", () => {
    const err = capture(() =>
      assertFresh(state, {
        action: "upsert",
        questions: [
          { id: "q3", prompt: "Which database?", type: "choice", options: DB_OPTIONS },
        ],
      }),
    );
    const stale = err as StaleError;
    expect(stale.message).toBe(
      "STALE: q3 is at rev 5 (you sent none). Current q3: Which database?. " +
        "Re-apply against current state.",
    );
    expect(stale.details).toEqual({ id: "q3", currentRev: 5 });
  });

  test("fresh upsert (current revs, current epoch) passes", () => {
    expect(() =>
      assertFresh(state, {
        action: "upsert",
        epoch: 9,
        questions: [
          { id: "q3", rev: 5, prompt: "Which database?", type: "choice", options: DB_OPTIONS },
        ],
      }),
    ).not.toThrow();
  });
});

/**
 * BUG-010 (PRD h2.22/h3.9): an upsert whose batch touches ≥1 EXISTING id
 * must carry the session epoch. Missing epoch → plain Error (record-path
 * precedent — no sent epoch means no digestSince baseline for a StaleError)
 * whose message embeds the current epoch as the self-heal value.
 */
describe("assertFresh — upsert epoch presence (BUG-010)", () => {
  let state: InterrogationState;
  beforeEach(() => {
    state = buildStaleFixture(); // epoch 9, q3 ("Which database?") at rev 5
  });

  test("epoch-less upsert touching an existing id throws plain Error with the current epoch", () => {
    const err = capture(() =>
      assertFresh(state, {
        action: "upsert",
        questions: [
          { id: "q3", rev: 5, prompt: "Which database?", type: "choice", options: DB_OPTIONS },
        ],
      }),
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(StaleError);
    expect((err as Error).message).toBe(
      "STALE: upsert touching existing questions requires the session epoch (current 9). Re-send with epoch.",
    );
  });

  test("epoch-less upsert with ONLY brand-new ids passes (first call stays epoch-less-friendly)", () => {
    expect(() =>
      assertFresh(state, {
        action: "upsert",
        questions: [{ id: "q-new", prompt: "Fresh?", type: "text" }],
      }),
    ).not.toThrow();
  });

  test("epoch-less upsert mixing one new + one existing id throws", () => {
    const err = capture(() =>
      assertFresh(state, {
        action: "upsert",
        questions: [
          { id: "q-new", prompt: "Fresh?", type: "text" },
          { id: "q3", rev: 5, prompt: "Which database?", type: "choice", options: DB_OPTIONS },
        ],
      }),
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(StaleError);
    expect((err as Error).message).toContain("current 9");
    expect((err as Error).message).toContain("Re-send with epoch.");
  });

  test("epoch-less upsert with a STALE rev still gets the richer rev-only StaleError first (ordering)", () => {
    const err = capture(() =>
      assertFresh(state, {
        action: "upsert",
        questions: [
          { id: "q3", rev: 2, prompt: "Which database?", type: "choice", options: DB_OPTIONS },
        ],
      }),
    );
    expect(err).toBeInstanceOf(StaleError);
    expect((err as StaleError).details).toEqual({ id: "q3", sentRev: 2, currentRev: 5 });
  });

  test("existing-id upsert WITH the matching epoch + revs passes exactly as before", () => {
    expect(() =>
      assertFresh(state, {
        action: "upsert",
        epoch: 9,
        questions: [
          { id: "q3", rev: 5, prompt: "Which database?", type: "choice", options: DB_OPTIONS },
        ],
      }),
    ).not.toThrow();
  });

  test("read/reopen remain never-guarded, even with stale epochs", () => {
    expect(() => assertFresh(state, { action: "read" })).not.toThrow();
    expect(() => assertFresh(state, { action: "reopen" })).not.toThrow();
  });
});

describe("assertFresh — answers (record)", () => {
  let state: InterrogationState;
  beforeEach(() => {
    state = buildStaleFixture();
  });

  test("answers with the matching epoch pass", () => {
    expect(() =>
      assertFresh(state, {
        action: "record",
        epoch: 9,
        answers: [{ id: "q3", value: "sqlite" }],
      }),
    ).not.toThrow();
  });

  test("answers with a wrong epoch throw the epoch-only variant", () => {
    const err = capture(() =>
      assertFresh(state, {
        action: "record",
        epoch: 4,
        answers: [{ id: "q3", value: "sqlite" }],
      }),
    );
    const stale = err as StaleError;
    expect(stale.message).toBe(
      "STALE: session epoch is 9 (you sent 4). " +
        "Changes since epoch 4: q3: (unanswered)→Postgres. " +
        "Re-apply against current state.",
    );
  });

  test("answers without epoch throw the plain required-param error (not STALE)", () => {
    const err = capture(() =>
      assertFresh(state, { action: "record", answers: [{ id: "q3", value: "sqlite" }] }),
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(StaleError);
    expect((err as Error).message).toBe(
      "answers requires epoch: include the epoch from your last read/result",
    );
  });

  test("answers never trigger per-question rev checks (h2.39)", () => {
    // Even an id that does not exist cannot make answers stale — epoch only.
    expect(() =>
      assertFresh(state, { action: "record", epoch: 9, answers: [{ id: "ghost", value: "x" }] }),
    ).not.toThrow();
  });
});

describe("assertFresh — multiple stale ids and purity", () => {
  test("multiple stale ids report the FIRST in agent-supplied order", () => {
    const state = createInterrogationState("ship it");
    state.upsertQuestion(stored({ id: "qa", prompt: "A?" }));
    state.upsertQuestion(stored({ id: "qb", prompt: "B?" }));
    state.bumpRev("qa");
    state.bumpRev("qb"); // both now at rev 2; caller still believes rev 1

    const err = capture(() =>
      assertFresh(state, {
        action: "upsert",
        questions: [
          { id: "qb", rev: 1, prompt: "B?", type: "text" },
          { id: "qa", rev: 1, prompt: "A?", type: "text" },
        ],
      }),
    );
    const stale = err as StaleError;
    expect(stale.details.id).toBe("qb"); // first stale id in array order
    expect(stale.message).toBe(
      "STALE: qb is at rev 2 (you sent 1). Current qb: B?. Re-apply against current state.",
    );
  });

  test("guards never mutate state and never emit events", () => {
    const state = buildStaleFixture();
    const before = state.serialize();
    let events = 0;
    const count = () => {
      events++;
    };
    state.on("changed", count);
    state.on("questions-upserted", count);
    state.on("epoch-bumped", count);

    capture(() => assertFresh(state, STALE_UPSERT));
    assertFresh(state, { action: "read" });
    assertFresh(state, { action: "reopen" });
    assertFresh(state, { action: "record", epoch: 9, answers: [{ id: "q3", value: "x" }] });
    capture(() => assertFresh(state, { action: "record", epoch: 4, answers: [] }));

    state.off("changed", count);
    state.off("questions-upserted", count);
    state.off("epoch-bumped", count);
    expect(events).toBe(0);
    expect(state.serialize()).toEqual(before);
  });
});

describe("StaleError identity", () => {
  test("is an Error named StaleError carrying typed details", () => {
    const err = new StaleError("STALE: test.", { id: "q1", sentRev: 1, currentRev: 2 });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(StaleError);
    expect(err.name).toBe("StaleError");
    expect(err.message).toBe("STALE: test.");
    expect(err.details).toEqual({ id: "q1", sentRev: 1, currentRev: 2 });
  });
});

describe("buildStaleMessage", () => {
  test("renders the full combined template verbatim", () => {
    expect(
      buildStaleMessage({
        id: "q3",
        sentRev: 2,
        currentRev: 5,
        sentEpoch: 4,
        currentEpoch: 9,
        prompt: "Which database?",
        digest: "q3: a→b",
      }),
    ).toBe(
      "STALE: q3 is at rev 5 (you sent 2); session epoch is 9 (you sent 4). " +
        "Current q3: Which database?. Changes since epoch 4: q3: a→b. " +
        "Re-apply against current state.",
    );
  });

  test("renders (none) for an empty digest and none for a missing rev", () => {
    expect(
      buildStaleMessage({ sentEpoch: 4, currentEpoch: 9, digest: "" }),
    ).toBe(
      "STALE: session epoch is 9 (you sent 4). Changes since epoch 4: (none). " +
        "Re-apply against current state.",
    );
    expect(
      buildStaleMessage({ id: "q3", sentRev: undefined, currentRev: 3, prompt: "P?" }),
    ).toBe("STALE: q3 is at rev 3 (you sent none). Current q3: P?. Re-apply against current state.");
  });
});

describe("module hygiene", () => {
  test("guards.ts is a pure module: type-only state/tool-schema imports + digestSince", () => {
    const src = fs.readFileSync(new URL("./guards.ts", import.meta.url), "utf8");
    const importLines = src.split("\n").filter((l) => l.startsWith("import"));
    expect(importLines).toHaveLength(3);
    expect(importLines[0]).toMatch(/^import type \{.*\} from "\.\/state\.js";$/s);
    expect(importLines[1]).toMatch(/^import \{ digestSince \} from "\.\/snapshots\.js";$/);
    expect(importLines[2]).toMatch(/^import type \{.*ParsedAction.*\} from "\.\/tool-schema\.js";$/s);
    // No pi/UI/runtime imports beyond the three pinned lines above.
    for (const line of importLines) expect(line).not.toMatch(/@earendil-works|node:|ctx\.ui/);
  });
});

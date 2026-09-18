/**
 * Unit tests for src/results.ts (P1.M1.T3.S4).
 *
 * Fixtures are hand-built SerializedState literals (builders must accept any
 * well-formed serialized state, not just live-class output) plus a round-trip
 * fixture minted through createInterrogationState + serialize(). The final
 * test is the cheap static purity guard: results.ts may import ./state.js
 * only — no pi imports, no live-state imports.
 */
import * as fs from "node:fs";
import { describe, expect, test } from "vitest";
import { buildReadResult, buildStatusLine, buildUpsertResult } from "./results";
import {
  createInterrogationState,
  UNGROUPED_LABEL,
  type Question,
  type SerializedState,
} from "./state";

/** Fresh question with sensible defaults; overrides win (state.test.ts pattern). */
function q(overrides: Partial<Question> & { id: string }): Question {
  return {
    prompt: `prompt for ${overrides.id}`,
    type: "text",
    rev: 1,
    status: "open",
    ...overrides,
  };
}

/** Hand-built serialized state from a question list; order = given order. */
function ser(
  questions: Question[],
  opts: { goal?: string; epoch?: number } = {},
): SerializedState {
  const byId: Record<string, Question> = {};
  for (const x of questions) byId[x.id] = x;
  return {
    goal: opts.goal ?? "Ship the thing",
    epoch: opts.epoch ?? 1,
    order: questions.map((x) => x.id),
    questions: structuredClone(byId),
  };
}

const H35_SENTENCE = "End your turn with a one-line note; do not call further tools.";

describe("buildStatusLine", () => {
  test("empty state: 0/0 with epoch passthrough", () => {
    expect(buildStatusLine(ser([], { epoch: 4 }))).toBe(
      "0/0 answered · 0 re-asked · 0 moot · epoch 4",
    );
  });

  test("mixed statuses byte-exact: answered counts status==='answered' ONLY", () => {
    // 8 total: 2 answered, 1 reasked, 1 moot, and open/submitted/withdrawn/closed
    // must NOT join the answered bucket nor appear in the line.
    const state = ser([
      q({ id: "a1", status: "answered" }),
      q({ id: "a2", status: "answered" }),
      q({ id: "r1", status: "reasked" }),
      q({ id: "m1", status: "moot" }),
      q({ id: "o1", status: "open" }),
      q({ id: "s1", status: "submitted" }),
      q({ id: "w1", status: "withdrawn" }),
      q({ id: "c1", status: "closed" }),
    ]);
    expect(buildStatusLine(state)).toBe("2/8 answered · 1 re-asked · 1 moot · epoch 1");
  });

  test("separator is exactly ' · ' (space, middle dot U+00B7, space)", () => {
    const line = buildStatusLine(ser([]));
    expect(line.includes("\u00B7")).toBe(true);
    expect(line.includes("•")).toBe(false);
    for (const sep of line.match(/.{1}\u00B7.{1}/g) ?? []) {
      expect(sep).toBe(" \u00B7 ");
    }
  });

  test("orphans in order[] are skipped for counts but total stays order.length", () => {
    const state = ser([q({ id: "a1", status: "answered" })]);
    state.order.push("ghost");
    expect(buildStatusLine(state)).toBe("1/2 answered · 0 re-asked · 0 moot · epoch 1");
  });
});

describe("buildReadResult", () => {
  test("full digest: goal, status line, first-appearance group order incl (none), one-liners", () => {
    const longPrompt = "a".repeat(61); // 61 chars → truncated to 60
    const state = ser(
      [
        q({
          id: "db",
          title: "Database",
          group: "Scope",
          type: "choice",
          status: "answered",
          rev: 2,
          answer: { value: "postgres", at: "2025-01-01T00:00:00Z" },
        }),
        q({ id: "auth", status: "open", prompt: longPrompt, group: "Scope" }),
        q({ id: "roll", title: "Rollback plan", status: "reasked", rev: 3 }),
        q({ id: "vendor", title: "Vendor lock-in", group: "Risk", status: "moot" }),
      ],
      { epoch: 3 },
    );
    const result = buildReadResult(state);
    expect(result.content).toBe(
      [
        "Goal: Ship the thing",
        "1/4 answered · 1 re-asked · 1 moot · epoch 3",
        "Scope: 1/2 answered",
        `${UNGROUPED_LABEL}: 0/1 answered`,
        "Risk: 0/1 answered",
        "db: Database — answered (rev 2) · answered: postgres",
        "  prompt: prompt for db",
        "  group: Scope",
        `auth: ${"a".repeat(60)} — open (rev 1)`,
        `  prompt: ${longPrompt}`,
        "  group: Scope",
        "roll: Rollback plan — reasked (rev 3)",
        "  prompt: prompt for roll",
        "vendor: Vendor lock-in — moot (rev 1)",
        "  prompt: prompt for vendor",
        "  group: Risk",
      ].join("\n"),
    );
  });

  test("empty goal: Goal line omitted entirely (content starts with the status line)", () => {
    const result = buildReadResult(ser([], { goal: "" }));
    expect(result.content).toBe("0/0 answered · 0 re-asked · 0 moot · epoch 1");
  });

  test("one-liner without answer has no answered suffix; 60-char prompt not truncated", () => {
    const exact = "x".repeat(60);
    const result = buildReadResult(ser([q({ id: "p1", prompt: exact })]));
    expect(result.content).toContain(`p1: ${exact} — open (rev 1)`);
    expect(result.content.includes(" · answered:")).toBe(false);
  });

  test("details envelope: action read, epoch, statusLine mirrors content line", () => {
    const state = ser([q({ id: "a1", status: "answered" })], { epoch: 9 });
    const result = buildReadResult(state);
    expect(result.details.action).toBe("read");
    expect(result.details.epoch).toBe(9);
    expect(result.details.statusLine).toBe("1/1 answered · 0 re-asked · 0 moot · epoch 9");
    // With a goal present the status line is content line 2 (after `Goal: …`).
    expect(result.content.split("\n")[1]).toBe(result.details.statusLine);
  });
});

describe("buildUpsertResult", () => {
  test("no warnings: exactly three fixed lines, ends with the h3.5 sentence", () => {
    const result = buildUpsertResult(ser([], { epoch: 2 }), []);
    expect(result.content).toBe(
      [
        "0/0 answered · 0 re-asked · 0 moot · epoch 2",
        "Questions visible to the user.",
        H35_SENTENCE,
      ].join("\n"),
    );
    expect(result.content.endsWith(H35_SENTENCE)).toBe(true);
    expect(result.details.action).toBe("upsert");
    expect(result.details.epoch).toBe(2);
  });

  test("warnings appended in order, one per line, after the fixed lines", () => {
    const result = buildUpsertResult(ser([]), [
      "description truncated to 500 chars (why)",
      "ramification truncated to 300 chars (how)",
    ]);
    const lines = result.content.split("\n");
    expect(lines).toHaveLength(5);
    expect(lines[1]).toBe("Questions visible to the user.");
    expect(lines[2]).toBe(H35_SENTENCE);
    expect(lines[3]).toBe("description truncated to 500 chars (why)");
    expect(lines[4]).toBe("ramification truncated to 300 chars (how)");
  });
});

describe("details contract (h2.40)", () => {
  test("details.state is a deep copy: mutating the input after building changes nothing", () => {
    const state = ser(
      [
        q({
          id: "db",
          status: "answered",
          rev: 2,
          answer: { value: "postgres", at: "2025-01-01T00:00:00Z" },
        }),
      ],
      { epoch: 5 },
    );
    const read = buildReadResult(state);
    const upsert = buildUpsertResult(state, []);
    const snapshot = structuredClone(state);

    // Deep-mutate the caller's state AFTER building.
    state.epoch = 99;
    state.goal = "changed";
    state.order.push("zzz");
    const mutated = state.questions["db"];
    mutated.status = "closed";
    mutated.rev = 42;
    mutated.answer = undefined;

    for (const result of [read, upsert]) {
      expect(result.details.state).toEqual(snapshot);
      expect(result.details.state).not.toBe(state);
      expect(result.details.state.questions["db"]).not.toBe(state.questions["db"]);
      expect(result.details.epoch).toBe(5); // frozen at build time
    }
    expect(read.details.action).toBe("read");
    expect(upsert.details.action).toBe("upsert");
  });

  test("round-trip fixture: serialize() output builds an equivalent digest", () => {
    const live = createInterrogationState("Plan the migration");
    live.upsertQuestion(
      q({ id: "q1", title: "Database", group: "Scope", type: "choice" }),
    );
    live.upsertQuestion(q({ id: "q2" }));
    live.applyAnswer("q1", { value: "postgres", at: "2025-01-01T00:00:00Z" });
    live.setStatus("q2", "reasked");
    live.bumpEpoch();

    const result = buildReadResult(live.serialize());
    expect(result.content).toBe(
      [
        "Goal: Plan the migration",
        "1/2 answered · 1 re-asked · 0 moot · epoch 2",
        "Scope: 1/1 answered",
        `${UNGROUPED_LABEL}: 0/1 answered`,
        "q1: Database — answered (rev 1) · answered: postgres",
        "  prompt: prompt for q1",
        "  group: Scope",
        "q2: prompt for q2 — reasked (rev 1)",
      ].join("\n"),
    );
  });
});

test("purity guard: results.ts imports ./state.js only", () => {
  const source = fs.readFileSync(new URL("./results.ts", import.meta.url), "utf8");
  const specs = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  expect(specs.length).toBeGreaterThan(0);
  for (const spec of specs) expect(spec).toBe("./state.js");
});

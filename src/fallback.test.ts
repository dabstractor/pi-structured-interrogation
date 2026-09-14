/**
 * src/fallback.test.ts — P1.M1.T3.S5: digest format (h2.26 byte-exact),
 * recordAnswers semantics (apply → snapshot → single epoch bump), tolerant
 * unknown-id handling, and the isNonTui guard truth table.
 */
import { beforeEach, describe, expect, test } from "vitest";
import {
  RELAY_INSTRUCTION,
  buildFallbackDigest,
  isNonTui,
  recordAnswers,
} from "./fallback.js";
import { createInterrogationState, type InterrogationState } from "./state.js";
import type { AnswerInput } from "./tool-schema.js";

/** Mixed fixture: choice+★, text, choice w/o recommendation, withdrawn skip. */
function mixedState(): InterrogationState {
  const state = createInterrogationState("Plan the migration");
  state.upsertQuestion({
    id: "q1",
    title: "Database engine",
    prompt: "Which database engine should we target?",
    type: "choice",
    options: [
      { value: "sqlite", label: "SQLite" },
      { value: "postgres", label: "PostgreSQL" },
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
    title: "Rollback strategy",
    prompt: "What is the rollback strategy if the migration fails?",
    type: "choice",
    options: [
      { value: "snapshot", label: "Full snapshot restore" },
      { value: "none", label: "None" },
    ],
    rev: 1,
    status: "open",
  });
  state.upsertQuestion({
    id: "q4",
    title: "Legacy sync",
    prompt: "Should we sync the legacy store?",
    type: "text",
    rev: 1,
    status: "open",
  });
  state.setStatus("q4", "withdrawn");
  return state;
}

const MIXED_DIGEST = [
  "INTERROGATION — Plan the migration (epoch 1)",
  "",
  "**1. Database engine** (`q1`)",
  "Which database engine should we target?",
  "1) SQLite (`sqlite`)",
  "2) PostgreSQL (`postgres`) ★",
  "Recommendation: PostgreSQL",
  "",
  "**2. Any constraints on downtime?** (`q2`)",
  "Any constraints on downtime?",
  "",
  "**3. Rollback strategy** (`q3`)",
  "What is the rollback strategy if the migration fails?",
  "1) Full snapshot restore (`snapshot`)",
  "2) None (`none`)",
  "",
  RELAY_INSTRUCTION,
].join("\n");

describe("isNonTui", () => {
  test("truth table over the four pi modes × hasUI", () => {
    expect(isNonTui("tui", true)).toBe(false);
    expect(isNonTui("tui", false)).toBe(true);
    expect(isNonTui("rpc", true)).toBe(true);
    expect(isNonTui("rpc", false)).toBe(true);
    expect(isNonTui("json", true)).toBe(true);
    expect(isNonTui("json", false)).toBe(true);
    expect(isNonTui("print", true)).toBe(true);
    expect(isNonTui("print", false)).toBe(true);
  });
});

describe("buildFallbackDigest", () => {
  let state: InterrogationState;

  beforeEach(() => {
    state = mixedState();
  });

  test("renders the full numbered digest for the mixed fixture, byte-exact", () => {
    expect(buildFallbackDigest(state.serialize())).toBe(MIXED_DIGEST);
  });

  test("relay sentence is the exact final line", () => {
    const digest = buildFallbackDigest(state.serialize());
    const lines = digest.split("\n");
    expect(lines[lines.length - 1]).toBe(
      "Relay this digest verbatim to the user in chat; they will answer in their next message.",
    );
    expect(RELAY_INSTRUCTION).toBe(lines[lines.length - 1]);
  });

  test("withdrawn/moot/closed are skipped and numbering counts rendered questions only", () => {
    state.setStatus("q1", "moot");
    state.setStatus("q3", "closed");
    const digest = buildFallbackDigest(state.serialize());
    expect(digest).not.toContain("q1");
    expect(digest).not.toContain("q3");
    expect(digest).not.toContain("q4");
    expect(digest).toContain("**1. Any constraints on downtime?** (`q2`)");
    expect(digest).not.toContain("**2.");
  });

  test("goal line is omitted (epoch still shown) when goal is empty", () => {
    const empty = createInterrogationState("");
    empty.upsertQuestion({
      id: "t1",
      prompt: "Pick one",
      type: "text",
      rev: 1,
      status: "open",
    });
    const digest = buildFallbackDigest(empty.serialize());
    expect(digest.startsWith("INTERROGATION (epoch 1)\n")).toBe(true);
    expect(digest).not.toContain("—");
  });

  test("epoch is passed through from the serialized state", () => {
    state.bumpEpoch();
    state.bumpEpoch();
    expect(state.epoch).toBe(3);
    expect(buildFallbackDigest(state.serialize())).toContain(
      "INTERROGATION — Plan the migration (epoch 3)",
    );
  });

  test("heading falls back to the first 60 prompt characters when title is absent", () => {
    const long = createInterrogationState("");
    const prompt = "a".repeat(70) + "TAIL";
    long.upsertQuestion({ id: "big", prompt, type: "text", rev: 1, status: "open" });
    const digest = buildFallbackDigest(long.serialize());
    expect(digest).toContain(`**1. ${"a".repeat(60)}** (\`big\`)`);
    expect(digest).not.toContain("TAIL**"); // heading truncated, not the prompt body
    expect(digest).toContain(prompt); // prompt body renders in full
  });

  test("choice question without options renders heading + prompt only", () => {
    const bare = createInterrogationState("");
    bare.upsertQuestion({
      id: "b1",
      title: "Bare",
      prompt: "No options here",
      type: "choice",
      rev: 1,
      status: "open",
    });
    const digest = buildFallbackDigest(bare.serialize());
    expect(digest).toBe(
      ["INTERROGATION (epoch 1)", "", "**1. Bare** (`b1`)", "No options here", "", RELAY_INSTRUCTION].join("\n"),
    );
  });

  test("is pure: digesting does not mutate epoch, snapshots, or question data", () => {
    const before = state.serialize();
    buildFallbackDigest(state.serialize());
    expect(state.epoch).toBe(1);
    expect(state.snapshots).toEqual([]);
    expect(state.serialize()).toEqual(before);
  });
});

describe("recordAnswers", () => {
  let state: InterrogationState;

  beforeEach(() => {
    state = mixedState();
  });

  test("applies each answer: status answered, value/text/at recorded, rev untouched", () => {
    const result = recordAnswers(state, [
      { id: "q1", value: "postgres", text: "the open-source one" },
      { id: "q2", value: "two hours max" },
    ]);

    expect(result).toEqual({ recorded: ["q1", "q2"], unknown: [], ignored: [] });
    const q1 = state.getQuestion("q1");
    const q2 = state.getQuestion("q2");
    expect(q1?.status).toBe("answered");
    expect(q1?.answer).toMatchObject({ value: "postgres", text: "the open-source one" });
    expect(q2?.status).toBe("answered");
    expect(q2?.answer).toMatchObject({ value: "two hours max" });
    expect(q2?.answer?.text).toBeUndefined();
    for (const q of [q1, q2]) {
      expect(q?.answer?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(Number.isNaN(Date.parse(q!.answer!.at))).toBe(false);
      expect(q?.rev).toBe(1); // applyAnswer never bumps rev (h2.39)
    }
    expect(q1?.answer?.at).toBe(q2?.answer?.at); // one submission, one timestamp
  });

  test("pushes exactly one snapshot at the pre-bump epoch and bumps epoch exactly once", () => {
    expect(state.snapshots).toEqual([]);
    recordAnswers(state, [
      { id: "q1", value: "postgres" },
      { id: "q2", value: "2h" },
      { id: "q3", value: "snapshot" },
    ]);

    expect(state.epoch).toBe(2); // 1 → 2, one bump for the whole batch
    expect(state.snapshots).toHaveLength(1);
    const snap = state.snapshots[0];
    expect(snap.epoch).toBe(1); // labeled with the epoch being left (takeSnapshot BEFORE bumpEpoch)
    expect(snap.state.epoch).toBe(1);
    expect(snap.state.questions.q1?.status).toBe("answered"); // snapshot is state AS SUBMITTED
    expect(snap.state.questions.q1?.answer?.value).toBe("postgres");
    expect(snap.state.questions.q2?.status).toBe("answered");
    expect(snap.state.questions.q3?.status).toBe("answered");
  });

  test("collects unknown ids without throwing and leaves those questions untouched", () => {
    const result = recordAnswers(state, [
      { id: "ghost", value: "x" },
      { id: "q1", value: "sqlite" },
      { id: "phantom", value: "y", text: "why not" },
    ]);

    expect(result).toEqual({ recorded: ["q1"], unknown: ["ghost", "phantom"], ignored: [] });
    expect(state.getQuestion("q1")?.status).toBe("answered");
    // The still-existing untouched questions keep their prior shape.
    expect(state.getQuestion("q2")?.status).toBe("open");
    expect(state.getQuestion("q2")?.answer).toBeUndefined();
    expect(state.epoch).toBe(2); // still exactly one submission bump
    expect(state.snapshots).toHaveLength(1);
  });

  test("an all-unknown call has ZERO side effects (no snapshot, no epoch burn)", () => {
    const result = recordAnswers(state, [{ id: "nope", value: "z" }]);
    expect(result).toEqual({ recorded: [], unknown: ["nope"], ignored: [] });
    expect(state.epoch).toBe(1); // unchanged — nothing recorded, no submission
    expect(state.snapshots).toEqual([]);
  });

  test("records free-form values verbatim — no option-value validation", () => {
    const result = recordAnswers(state, [{ id: "q1", value: "something not in the list" }]);
    expect(result.recorded).toEqual(["q1"]);
    expect(state.getQuestion("q1")?.answer?.value).toBe("something not in the list");
  });

  test("empty answers array: zero side effects (no submission)", () => {
    const result = recordAnswers(state, [] as AnswerInput[]);
    expect(result).toEqual({ recorded: [], unknown: [], ignored: [] });
    expect(state.epoch).toBe(1);
    expect(state.snapshots).toEqual([]);
  });

  test("second record call pushes a second snapshot (ring stays consistent)", () => {
    recordAnswers(state, [{ id: "q1", value: "postgres" }]);
    recordAnswers(state, [{ id: "q2", value: "1h" }]);
    expect(state.epoch).toBe(3);
    expect(state.snapshots).toHaveLength(2);
    expect(state.snapshots[1].epoch).toBe(2);
    expect(state.snapshots[1].state.questions.q2?.status).toBe("answered");
  });

  test("withdrawn id is ignored: untouched question, no resurrection (BUG-012)", () => {
    // mixedState seeds q4 as withdrawn (upsert-omission path).
    const before = state.getQuestion("q4");
    const result = recordAnswers(state, [{ id: "q4", value: "yes", text: "resurrect me" }]);

    expect(result).toEqual({ recorded: [], unknown: [], ignored: ["q4"] });
    expect(state.getQuestion("q4")).toEqual(before); // status/answer/rev unchanged
    expect(state.getQuestion("q4")?.status).toBe("withdrawn");
    expect(state.getQuestion("q4")?.answer).toBeUndefined();
    // Nothing recorded → zero side effects.
    expect(state.epoch).toBe(1);
    expect(state.snapshots).toEqual([]);
  });

  test("moot id is ignored (terminal-until-re-upsert, h2.38)", () => {
    state.setStatus("q1", "moot");
    const before = state.getQuestion("q1");
    const result = recordAnswers(state, [{ id: "q1", value: "postgres" }]);

    expect(result).toEqual({ recorded: [], unknown: [], ignored: ["q1"] });
    expect(state.getQuestion("q1")).toEqual(before);
    expect(state.getQuestion("q1")?.status).toBe("moot");
    expect(state.epoch).toBe(1);
    expect(state.snapshots).toEqual([]);
  });

  test("closed id is ignored — closed reopens ONLY via re-upsert (rev+1), never answers[]", () => {
    state.setStatus("q2", "closed");
    const before = state.getQuestion("q2");
    const result = recordAnswers(state, [{ id: "q2", value: "2h" }]);

    expect(result).toEqual({ recorded: [], unknown: [], ignored: ["q2"] });
    expect(state.getQuestion("q2")).toEqual(before);
    expect(state.getQuestion("q2")?.status).toBe("closed");
    expect(state.epoch).toBe(1);
    expect(state.snapshots).toEqual([]);
  });

  test("mixed call (recorded + ignored + unknown): exactly one snapshot, one epoch bump", () => {
    state.setStatus("q3", "closed"); // ignored bucket
    const result = recordAnswers(state, [
      { id: "q1", value: "postgres" }, // recorded
      { id: "q4", value: "resurrect" }, // ignored (withdrawn)
      { id: "ghost", value: "x" }, // unknown
    ]);

    expect(result).toEqual({ recorded: ["q1"], unknown: ["ghost"], ignored: ["q4"] });
    expect(state.getQuestion("q1")?.status).toBe("answered");
    expect(state.getQuestion("q4")?.status).toBe("withdrawn"); // untouched
    expect(state.getQuestion("ghost")).toBeUndefined();
    expect(state.epoch).toBe(2); // exactly one submission bump
    expect(state.snapshots).toHaveLength(1);
  });

  test("answers to ignored ids never appear in the snapshot", () => {
    recordAnswers(state, [
      { id: "q1", value: "postgres" },
      { id: "q4", value: "resurrect me" }, // withdrawn → ignored
    ]);

    const snap = state.snapshots[0];
    expect(snap.state.questions.q1?.answer?.value).toBe("postgres");
    expect(snap.state.questions.q4?.answer).toBeUndefined(); // never applied
    expect(snap.state.questions.q4?.status).toBe("withdrawn");
  });
});

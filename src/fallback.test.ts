/**
 * src/fallback.test.ts — P1.M1.T3.S5: digest format (h2.26 byte-exact),
 * recordAnswers semantics (apply → markSubmitted → snapshot → single epoch
 * bump; BUG-004), tolerant unknown-id handling, the isNonTui guard truth
 * table, and the BUG-004 integration repro (recorded → submitted → close
 * pass → completion fires once; h2.2/h3.3 Issue 4).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  RELAY_INSTRUCTION,
  buildFallbackDigest,
  isNonTui,
  recordAnswers,
} from "./fallback.js";
import { attemptCompletion, type CompletionTriggerOptions } from "./completion.js";
import type { ClosePassResult } from "./lifecycle.js";
import { closeSubmitted } from "./merge.js";
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

// --------------------------------------------- BUG-004 integration helpers

/** Fake pi for attemptCompletion ({sendMessage} pattern per completion.test.ts). */
function makeFakePi(): Pick<ExtensionAPI, "sendMessage"> {
  return { sendMessage: vi.fn() } as unknown as Pick<ExtensionAPI, "sendMessage">;
}

function optsFor(st: InterrogationState): CompletionTriggerOptions {
  return { lifecycle: { dismissPanel: () => {} }, getState: () => st };
}

/** h2.44 active set (lifecycle/engine convention — moot excluded there). */
function activeIds(st: InterrogationState): string[] {
  return st
    .orderedQuestions()
    .filter((q) => ["open", "answered", "submitted", "reasked"].includes(q.status))
    .map((q) => q.id);
}

/** The h2.2/h3.3 repro shape: n identical choice questions, all open. */
function reproState(ids: string[]): InterrogationState {
  const st = createInterrogationState("Plan the migration");
  for (const id of ids) {
    st.upsertQuestion({
      id,
      title: `Q ${id}`,
      prompt: `prompt:${id}`,
      type: "choice",
      options: [
        { value: "sqlite", label: "SQLite" },
        { value: "postgres", label: "PostgreSQL" },
      ],
      rev: 1,
      status: "open",
    });
  }
  return st;
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

  test("applies each answer: status submitted, value/text/at recorded, rev untouched", () => {
    const result = recordAnswers(state, [
      { id: "q1", value: "postgres", text: "the open-source one" },
      { id: "q2", value: "two hours max" },
    ]);

    expect(result).toEqual({ recorded: ["q1", "q2"], unknown: [], ignored: [] });
    const q1 = state.getQuestion("q1");
    const q2 = state.getQuestion("q2");
    expect(q1?.status).toBe("submitted"); // BUG-004: recorded ids land submitted, not answered
    expect(q1?.answer).toMatchObject({ value: "postgres", text: "the open-source one" });
    expect(q2?.status).toBe("submitted");
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
    expect(snap.state.questions.q1?.status).toBe("submitted"); // markSubmitted BEFORE takeSnapshot
    expect(snap.state.questions.q1?.answer?.value).toBe("postgres");
    expect(snap.state.questions.q2?.status).toBe("submitted");
    expect(snap.state.questions.q3?.status).toBe("submitted");
  });

  test("collects unknown ids without throwing and leaves those questions untouched", () => {
    const result = recordAnswers(state, [
      { id: "ghost", value: "x" },
      { id: "q1", value: "sqlite" },
      { id: "phantom", value: "y", text: "why not" },
    ]);

    expect(result).toEqual({ recorded: ["q1"], unknown: ["ghost", "phantom"], ignored: [] });
    expect(state.getQuestion("q1")?.status).toBe("submitted");
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

  test("custom (WRITEIN-001) is carried through to the recorded answer; absent → no key", () => {
    const result = recordAnswers(state, [
      { id: "q1", value: "my own take", custom: true },
      { id: "q2", value: "no marker here" },
    ]);
    expect(result).toEqual({ recorded: ["q1", "q2"], unknown: [], ignored: [] });
    const q1 = state.getQuestion("q1");
    const q2 = state.getQuestion("q2");
    expect(q1?.answer?.custom).toBe(true);
    expect(q1?.answer !== undefined && "custom" in q1.answer).toBe(true);
    // Legacy shape: no marker → no custom key at all (not custom: undefined).
    expect(q2?.answer !== undefined && "custom" in q2.answer).toBe(false);
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
    expect(state.snapshots[1].state.questions.q2?.status).toBe("submitted");
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
    expect(state.getQuestion("q1")?.status).toBe("submitted");
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

  // ----------------------------------------- BUG-004 integration (h2.2/h3.3)

  test("BUG-004 repro: recorded → submitted → close pass closes → completion fires", () => {
    const st = reproState(["q1"]); // the bug-report shape: exactly one choice question
    const pi = makeFakePi();

    recordAnswers(st, [{ id: "q1", value: "postgres" }]);
    expect(st.getQuestion("q1")?.status).toBe("submitted"); // NOT answered — the fix

    // agent_settled close pass (lifecycle.runClosePass equivalent: filters submitted).
    const toClose = st.orderedQuestions().filter((q) => q.status === "submitted").map((q) => q.id);
    closeSubmitted(st, toClose);
    expect(st.getQuestion("q1")?.status).toBe("closed");

    const closePass: ClosePassResult = {
      closed: toClose,
      reasked: [],
      remainingActive: activeIds(st),
    };
    const outcome = attemptCompletion(pi, optsFor(st), closePass);
    expect(outcome).toEqual({ fired: true }); // AC-11: completion injection fires
    expect(pi.sendMessage).toHaveBeenCalledTimes(1); // the ONE full injection
    expect(st.completed).toBe(true); // one-time guard set by the fire
  });

  test("BUG-004 mixed: q1 recorded + closed but q2 still open → active-questions-remain", () => {
    const st = reproState(["q1", "q2"]);
    const pi = makeFakePi();

    const result = recordAnswers(st, [{ id: "q1", value: "postgres" }]);
    expect(result.recorded).toEqual(["q1"]);
    expect(st.getQuestion("q1")?.status).toBe("submitted");
    expect(st.getQuestion("q2")?.status).toBe("open"); // still active

    const toClose = st.orderedQuestions().filter((q) => q.status === "submitted").map((q) => q.id);
    closeSubmitted(st, toClose);
    const closePass: ClosePassResult = {
      closed: toClose,
      reasked: [],
      remainingActive: activeIds(st),
    };
    const outcome = attemptCompletion(pi, optsFor(st), closePass);
    expect(outcome).toEqual({ fired: false, reason: "active-questions-remain" });
    expect(pi.sendMessage).not.toHaveBeenCalled();
    expect(st.completed).toBe(false);
  });

  test("snapshot ordering: ring captures 'submitted' at the pre-bump epoch", () => {
    recordAnswers(state, [{ id: "q1", value: "postgres" }]);
    const snap = state.snapshots[0];
    expect(snap.epoch).toBe(1); // labels the epoch being LEFT
    expect(snap.state.epoch).toBe(1);
    expect(snap.state.questions.q1?.status).toBe("submitted"); // markSubmitted ran FIRST
    expect(state.epoch).toBe(2);
  });

  test("all-ignored + all-unknown call stays side-effect-free after the fix (S1 contract)", () => {
    state.setStatus("q3", "closed");
    const result = recordAnswers(state, [
      { id: "ghost", value: "x" }, // unknown
      { id: "q4", value: "resurrect" }, // withdrawn → ignored
    ]);
    expect(result).toEqual({ recorded: [], unknown: ["ghost"], ignored: ["q4"] });
    expect(state.epoch).toBe(1); // no epoch burn
    expect(state.snapshots).toEqual([]); // no snapshot push
    expect(state.getQuestion("q4")?.status).toBe("withdrawn"); // untouched
    expect(state.getQuestion("q3")?.status).toBe("closed"); // untouched
  });

  test("completion fires exactly once (already-completed on the second attempt)", () => {
    const st = reproState(["q1"]);
    const pi = makeFakePi();
    const opts = optsFor(st);

    recordAnswers(st, [{ id: "q1", value: "postgres" }]);
    const toClose = st.orderedQuestions().filter((q) => q.status === "submitted").map((q) => q.id);
    closeSubmitted(st, toClose);
    const closePass: ClosePassResult = { closed: toClose, reasked: [], remainingActive: [] };

    expect(attemptCompletion(pi, opts, closePass)).toEqual({ fired: true });
    expect(attemptCompletion(pi, opts, closePass)).toEqual({
      fired: false,
      reason: "already-completed",
    });
    expect(pi.sendMessage).toHaveBeenCalledTimes(1); // one injection total
  });
});

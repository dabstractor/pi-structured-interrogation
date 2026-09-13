/**
 * src/merge.test.ts — unit tests for the merge rules (P1.M1.T2.S2).
 * Co-located vitest suite; fresh state per test; raw primitives only.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { applyUpsert, closeSubmitted, markAnswered, markSubmitted } from "./merge.js";
import { createInterrogationState, type InterrogationState, type Question, type QuestionAnswer, type QuestionStatus } from "./state.js";

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

function ans(value: string): QuestionAnswer {
  return { value, at: "2025-01-01T00:00:00.000Z" };
}

function newState(): InterrogationState {
  return createInterrogationState("test");
}

/** Seed a question, then optionally apply an answer and/or force a status. */
function seedQ(
  st: InterrogationState,
  q: Question,
  opts: { status?: QuestionStatus; answer?: QuestionAnswer } = {},
): InterrogationState {
  st.upsertQuestion(q); // forces rev 1 / open on the new id
  if (opts.answer !== undefined) st.applyAnswer(q.id, opts.answer);
  if (opts.status !== undefined) st.setStatus(q.id, opts.status);
  return st;
}

// ---------------------------------------------------------------- rule 1

test("test_rule1_same_options_updates_text_keeps_answer_status_and_bumps_rev", () => {
  const st = newState();
  seedQ(st, choiceQ("q1"), { answer: ans("a") }); // answered, rev 1
  seedQ(st, choiceQ("q2"));
  const before = st.getQuestion("q1")!; // stored object — must not be mutated

  const r = applyUpsert(st, [
    choiceQ("q1", {
      title: "Revised title",
      prompt: "revised prompt",
      description: "revised description",
      recommendation: "pick a",
      group: "data",
      options: [
        { value: "a", label: "Alpha (renamed)", ramification: "now noted" },
        { value: "b", label: "Beta" },
      ],
    }),
  ]);

  const after = st.getQuestion("q1")!;
  expect(after.title).toBe("Revised title");
  expect(after.prompt).toBe("revised prompt");
  expect(after.description).toBe("revised description");
  expect(after.recommendation).toBe("pick a");
  expect(after.group).toBe("data");
  expect(after.options?.[0]).toEqual({ value: "a", label: "Alpha (renamed)", ramification: "now noted" });
  expect(after.answer?.value).toBe("a"); // kept
  expect(after.status).toBe("answered"); // kept
  expect(after.rev).toBe(2); // 1 → 2
  expect(st.serialize().order).toEqual(["q1", "q2"]); // position preserved
  expect(before.rev).toBe(1); // old stored object untouched
  expect(r.transitions).toEqual([
    { id: "q1", rule: 1, from: "answered", to: "answered", revBumped: true, answerReset: false },
  ]);
  expect(r.revBumped).toEqual(["q1"]);
});

test("test_rule1_label_only_change_same_value_list_is_not_a_reset", () => {
  const st = newState();
  seedQ(st, choiceQ("q1"), { answer: ans("b") });
  const r = applyUpsert(st, [
    choiceQ("q1", { options: [{ value: "a", label: "Alpha!" }, { value: "b", label: "Beta!" }] }),
  ]);
  const q = st.getQuestion("q1")!;
  expect(r.transitions[0].rule).toBe(1);
  expect(r.transitions[0].answerReset).toBe(false);
  expect(q.answer?.value).toBe("b"); // kept
  expect(q.status).toBe("answered");
  expect(q.rev).toBe(2);
});

test("test_rule1_keeps_status_for_submitted_and_reasked_rows", () => {
  const st = newState();
  seedQ(st, choiceQ("s"), { status: "submitted", answer: ans("a") });
  seedQ(st, choiceQ("r"), { status: "reasked" });
  const r = applyUpsert(st, [choiceQ("s", { prompt: "s2" }), choiceQ("r", { prompt: "r2" })]);
  expect(st.getQuestion("s")!.status).toBe("submitted");
  expect(st.getQuestion("r")!.status).toBe("reasked");
  expect(r.transitions.map((t) => t.rule)).toEqual([1, 1]);
  expect(r.revBumped).toEqual(["s", "r"]);
});

// ---------------------------------------------------------------- rule 2

test("test_rule2_changed_options_delete_answer_and_reask", () => {
  const st = newState();
  seedQ(st, choiceQ("q1"), { answer: ans("a") });
  const r = applyUpsert(st, [
    choiceQ("q1", { options: [{ value: "a", label: "Alpha" }, { value: "c", label: "Gamma" }] }),
  ]);
  const q = st.getQuestion("q1")!;
  expect(q.answer).toBeUndefined(); // deleted, not emptied
  expect(q.status).toBe("reasked");
  expect(q.rev).toBe(2);
  expect(r.transitions).toEqual([
    { id: "q1", rule: 2, from: "answered", to: "reasked", revBumped: true, answerReset: true },
  ]);
  expect(r.revBumped).toEqual(["q1"]);
});

test("test_rule2_reordered_option_values_count_as_changed", () => {
  const st = newState();
  seedQ(st, choiceQ("q1"), { answer: ans("a") });
  const r = applyUpsert(st, [
    choiceQ("q1", { options: [{ value: "b", label: "Beta" }, { value: "a", label: "Alpha" }] }),
  ]);
  expect(r.transitions[0].rule).toBe(2); // ordered comparison, not set equality
  expect(st.getQuestion("q1")!.answer).toBeUndefined();
});

test("test_rule2_from_submitted_reasks", () => {
  const st = newState();
  seedQ(st, choiceQ("s"), { status: "submitted", answer: ans("a") });
  const r = applyUpsert(st, [choiceQ("s", { options: [{ value: "z", label: "Z" }] })]);
  expect(st.getQuestion("s")!.status).toBe("reasked");
  expect(r.transitions[0]).toMatchObject({ rule: 2, from: "submitted", to: "reasked", answerReset: true });
});

// ---------------------------------------------------------------- rule 3

test("test_rule3_new_id_appended_open_rev1", () => {
  const st = newState();
  seedQ(st, choiceQ("q1"));
  const r = applyUpsert(st, [choiceQ("q2", { rev: 9, status: "answered", answer: ans("x") })]);
  const q = st.getQuestion("q2")!;
  expect(q.status).toBe("open"); // forced, incoming status ignored
  expect(q.rev).toBe(1); // forced, incoming rev ignored
  expect(q.answer).toBeUndefined(); // no synthesized answer
  expect(st.serialize().order).toEqual(["q1", "q2"]); // appended at end
  expect(r.appended).toEqual(["q2"]);
  expect(r.transitions).toEqual([
    { id: "q2", rule: 3, from: "absent", to: "open", revBumped: false, answerReset: false },
  ]);
  expect(r.revBumped).toEqual([]); // rev 1 is fresh, not a bump
});

// ---------------------------------------------------------------- rule 4

test("test_rule4_omitted_id_withdrawn_kept_in_map_answer_preserved_rev_unchanged", () => {
  const st = newState();
  seedQ(st, choiceQ("q1"), { answer: ans("a") });
  seedQ(st, choiceQ("q2"));
  const r = applyUpsert(st, [choiceQ("q2")]); // q1 omitted
  const q1 = st.getQuestion("q1")!;
  expect(q1).toBeDefined(); // kept in map (Q34=A audit trail)
  expect(q1.status).toBe("withdrawn");
  expect(q1.answer?.value).toBe("a"); // preserved for audit
  expect(q1.rev).toBe(1); // withdrawal never bumps rev
  expect(r.withdrawn).toEqual([{ id: "q1", reason: "withdrawn" }]);
  expect(r.revBumped).toEqual(["q2"]); // only the incoming (rule-1) id bumped
  expect(r.transitions).toHaveLength(1); // transitions cover incoming ids only
});

test("test_rule4_noop_for_withdrawn_and_leaves_moot_closed_untouched", () => {
  const st = newState();
  seedQ(st, choiceQ("w"), { status: "withdrawn", answer: ans("a") });
  seedQ(st, choiceQ("m"), { status: "moot" });
  seedQ(st, choiceQ("c"), { status: "closed", answer: ans("b") });
  const r = applyUpsert(st, [choiceQ("keep")]);
  expect(r.withdrawn).toEqual([]); // no double withdrawal
  expect(st.getQuestion("w")!.status).toBe("withdrawn");
  expect(st.getQuestion("w")!.rev).toBe(1);
  expect(st.getQuestion("m")!.status).toBe("moot"); // S3's domain
  expect(st.getQuestion("c")!.status).toBe("closed"); // archived
});

// ---------------------------------------------------------------- reopen

test("test_reopen_withdrawn_same_options_keeps_answer_and_marks_answered", () => {
  const st = newState();
  seedQ(st, choiceQ("q1"), { status: "withdrawn", answer: ans("a") });
  const r = applyUpsert(st, [choiceQ("q1", { prompt: "back" })]);
  const q = st.getQuestion("q1")!;
  expect(q.status).toBe("answered");
  expect(q.answer?.value).toBe("a");
  expect(q.rev).toBe(2); // h2.38: closed/withdrawn reopen bumps rev
  expect(r.transitions).toEqual([
    { id: "q1", rule: "reopen-same", from: "withdrawn", to: "answered", revBumped: true, answerReset: false },
  ]);
});

test("test_reopen_withdrawn_same_options_without_answer_opens", () => {
  const st = newState();
  seedQ(st, choiceQ("q1"), { status: "withdrawn" });
  const r = applyUpsert(st, [choiceQ("q1")]);
  expect(st.getQuestion("q1")!.status).toBe("open");
  expect(r.transitions[0].rule).toBe("reopen-same");
  expect(r.transitions[0].to).toBe("open");
});

test("test_reopen_closed_changed_options_reasks_and_resets_answer", () => {
  const st = newState();
  seedQ(st, choiceQ("q1"), { status: "closed", answer: ans("a") });
  const r = applyUpsert(st, [choiceQ("q1", { options: [{ value: "x", label: "X" }] })]);
  const q = st.getQuestion("q1")!;
  expect(q.status).toBe("reasked");
  expect(q.answer).toBeUndefined();
  expect(q.rev).toBe(2);
  expect(r.transitions).toEqual([
    { id: "q1", rule: "reopen-changed", from: "closed", to: "reasked", revBumped: true, answerReset: true },
  ]);
});

test("test_moot_reupsert_same_options_stays_moot_changed_options_reasks", () => {
  const st = newState();
  seedQ(st, choiceQ("m"), { status: "moot" });
  const r1 = applyUpsert(st, [choiceQ("m", { prompt: "edited" })]);
  expect(st.getQuestion("m")!.status).toBe("moot"); // merge never touches moot on same options
  expect(r1.transitions[0].rule).toBe(1);
  const r2 = applyUpsert(st, [choiceQ("m", { options: [{ value: "n", label: "N" }] })]);
  expect(st.getQuestion("m")!.status).toBe("reasked"); // genuine re-ask per rule 2
  expect(r2.transitions[0].rule).toBe(2);
});

// -------------------------------------------------------- batch protocol

test("test_duplicate_ids_in_batch_throw_and_refuse_whole_batch", () => {
  const st = newState();
  expect(() => applyUpsert(st, [choiceQ("q1"), choiceQ("q1", { prompt: "dup" })])).toThrowError(
    "duplicate question id in upsert batch: q1",
  );
  expect(st.getQuestion("q1")).toBeUndefined(); // nothing mutated
});

test("test_upsert_result_shape_matches_batch", () => {
  const st = newState();
  seedQ(st, choiceQ("a"), { answer: ans("a") });
  seedQ(st, choiceQ("b"));
  const incoming = [choiceQ("a", { prompt: "a2" }), choiceQ("c"), choiceQ("b", { prompt: "b2" })];
  const r = applyUpsert(st, incoming);
  expect(r.transitions).toHaveLength(incoming.length);
  expect(r.transitions.map((t) => t.id)).toEqual(["a", "c", "b"]);
  for (const id of r.revBumped) expect(incoming.some((q) => q.id === id)).toBe(true);
  expect(r.revBumped).toEqual(["a", "b"]); // rule-3 'c' did not bump
  expect(r.appended).toEqual(["c"]);
  expect(r.withdrawn).toEqual([]);
});

// ------------------------------------------------------------ text-type

test("test_text_question_prompt_edit_is_rule1_answer_kept", () => {
  const st = newState();
  seedQ(st, { id: "t1", prompt: "name the db", type: "text", rev: 1, status: "open" }, { answer: ans("postgres") });
  const r = applyUpsert(st, [{ id: "t1", prompt: "name the db (precisely)", type: "text", rev: 2, status: "answered" }]);
  const after = st.getQuestion("t1")!;
  expect(after.prompt).toBe("name the db (precisely)");
  expect(after.answer?.value).toBe("postgres"); // missing options ≡ same options
  expect(after.status).toBe("answered");
  expect(after.rev).toBe(2);
  expect(r.transitions[0].rule).toBe(1);
});

// -------------------------------------------------------- transitions

test("test_markAnswered_sets_answered_without_rev_bump", () => {
  const st = newState();
  seedQ(st, choiceQ("q1"));
  const revBefore = st.getQuestion("q1")!.rev;
  markAnswered(st, "q1", ans("a"));
  const q = st.getQuestion("q1")!;
  expect(q.status).toBe("answered");
  expect(q.answer?.value).toBe("a");
  expect(q.rev).toBe(revBefore); // h2.39 regression: answers never bump rev
});

test("test_markAnswered_on_closed_reopens_to_answered_FR2", () => {
  const st = newState();
  seedQ(st, choiceQ("q1"), { status: "closed", answer: ans("a") });
  markAnswered(st, "q1", ans("b"));
  const q = st.getQuestion("q1")!;
  expect(q.status).toBe("answered"); // FR-2 / Q24=B: re-marks answered(pending)
  expect(q.answer?.value).toBe("b");
  expect(q.rev).toBe(1); // still no rev bump on the answer path
});

test("test_markAnswered_unknown_id_throws", () => {
  const st = newState();
  expect(() => markAnswered(st, "ghost", ans("a"))).toThrowError("unknown question id: ghost");
});

test("test_markSubmitted_then_closeSubmitted_apply_transitions", () => {
  const st = newState();
  seedQ(st, choiceQ("q1"), { answer: ans("a") });
  seedQ(st, choiceQ("q2"), { answer: ans("b") });
  markSubmitted(st, ["q1", "q2"]);
  expect(st.getQuestion("q1")!.status).toBe("submitted");
  expect(st.getQuestion("q2")!.status).toBe("submitted");
  closeSubmitted(st, ["q1", "q2"]);
  expect(st.getQuestion("q1")!.status).toBe("closed");
  expect(st.getQuestion("q2")!.status).toBe("closed");
});

test("test_markSubmitted_unknown_id_throws_without_partial_apply", () => {
  const st = newState();
  seedQ(st, choiceQ("q1"));
  expect(() => markSubmitted(st, ["q1", "ghost"])).toThrowError("unknown question id: ghost");
  expect(st.getQuestion("q1")!.status).toBe("open"); // batch refused atomically
});

test("test_closeSubmitted_unknown_id_throws", () => {
  const st = newState();
  expect(() => closeSubmitted(st, ["ghost"])).toThrowError("unknown question id: ghost");
});

// -------------------------------------------------------- import purity

test("test_merge_ts_imports_only_state_js", () => {
  const src = readFileSync(new URL("./merge.ts", import.meta.url), "utf8");
  const importLines = src.split("\n").filter((line) => line.startsWith("import"));
  expect(importLines.length).toBeGreaterThan(0);
  for (const line of importLines) {
    expect(line).toMatch(/^import (type )?\{.*\} from "\.\/state\.js"/);
  }
});

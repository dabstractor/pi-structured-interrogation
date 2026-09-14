/**
 * Unit tests for src/snapshots.ts (P1.M1.T2.S4).
 *
 * Fresh InterrogationState per test (beforeEach, mirroring state.test.ts).
 * computeDiff/digestSince tests mostly drive the real state API and capture
 * `serialize()` outputs; pure-data mutations of serialized copies exercise
 * the deserialized/untrusted-shape tolerance. Final test is the static
 * import guard: snapshots.ts may import ./state.js types only.
 */
import * as fs from "node:fs";
import { beforeEach, describe, expect, test } from "vitest";
import {
  SNAPSHOT_RING_SIZE,
  computeDiff,
  digestSince,
  takeSnapshot,
  type DiffEntry,
  type SubmissionCardData,
} from "./snapshots";
import {
  createInterrogationState,
  type InterrogationState,
  type Question,
  type QuestionAnswer,
  type SerializedState,
} from "./state";

const T0 = "2025-01-01T00:00:00.000Z";

/** Fresh question with sensible defaults; overrides win (state.test.ts convention). */
function q(overrides: Partial<Question> & { id: string }): Question {
  return {
    prompt: `prompt for ${overrides.id}`,
    type: "text",
    rev: 1,
    status: "open",
    ...overrides,
  };
}

/** Fresh answer with a fixed timestamp so serialized states compare stably. */
function ans(value: string, text?: string): QuestionAnswer {
  return text === undefined ? { value, at: T0 } : { value, text, at: T0 };
}

/** One submission round: record, snapshot (pre-bump), bump. */
function submit(state: InterrogationState): void {
  takeSnapshot(state);
  state.bumpEpoch();
}

let state: InterrogationState;

beforeEach(() => {
  state = createInterrogationState("Plan the migration");
});

describe("takeSnapshot", () => {
  test("snapshot_pushes_deep_copy_labeled_with_pre_bump_epoch", () => {
    state.upsertQuestion(q({ id: "q1" }));
    const before = state.serialize();
    const events: string[] = [];
    state.on("changed", () => events.push("changed"));
    state.on("epoch-bumped", () => events.push("epoch-bumped"));

    const snap = takeSnapshot(state);

    expect(state.snapshots).toEqual([snap]);
    expect(snap.epoch).toBe(1); // pre-bump epoch — caller bumps afterwards
    expect(snap.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO 8601
    expect(snap.state).toEqual(before);
    expect(events).toEqual([]); // emits NO events
  });

  test("snapshot_is_mutation_safe_later_live_edits_do_not_alter_it", () => {
    state.upsertQuestion(q({ id: "q1" }));
    const snap = takeSnapshot(state);
    state.applyAnswer("q1", ans("late"));
    expect(snap.state.questions.q1?.answer).toBeUndefined();
    expect(state.snapshots[0]?.state.questions.q1?.answer).toBeUndefined();
    expect(state.serialize().questions.q1?.answer).toEqual(ans("late"));
  });

  test("ring_trims_to_10_dropping_oldest_newest_is_most_recent", () => {
    for (let i = 1; i <= 12; i++) {
      takeSnapshot(state);
      state.bumpEpoch();
    }
    expect(state.snapshots).toHaveLength(SNAPSHOT_RING_SIZE);
    expect(state.snapshots[0]?.epoch).toBe(3); // epochs 1-2 dropped
    expect(state.snapshots[state.snapshots.length - 1]?.epoch).toBe(12);
  });
});

describe("computeDiff", () => {
  test("no_answer_changes_yields_empty_changed_and_remainOpen_counts_open_only", () => {
    state.upsertQuestion(q({ id: "q1" }));
    state.upsertQuestion(q({ id: "q2" }));
    state.upsertQuestion(q({ id: "q3" }));
    state.applyAnswer("q2", ans("x")); // answered (pending) — NOT open
    state.setStatus("q3", "moot");
    const diff = computeDiff(state.serialize(), state.serialize());
    expect(diff.changed).toEqual([]);
    expect(diff.remainOpen).toBe(1); // only q1
    expect(diff.epoch).toBe(state.epoch);
  });

  test("choice_value_change_uses_labels_exact_entry", () => {
    state.upsertQuestion(
      q({
        id: "q3",
        type: "choice",
        options: [
          { value: "sqlite", label: "SQLite" },
          { value: "postgres", label: "Postgres" },
        ],
      }),
    );
    state.applyAnswer("q3", ans("sqlite"));
    const prev = state.serialize();
    state.applyAnswer("q3", ans("postgres"));
    const expected: DiffEntry[] = [
      {
        id: "q3",
        title: "prompt for q3",
        from: "SQLite",
        to: "Postgres",
        editedArchived: false,
        value: "postgres",
      },
    ];
    expect(computeDiff(prev, state.serialize()).changed).toEqual(expected);
  });

  test("value_matching_no_option_falls_back_to_raw_value", () => {
    state.upsertQuestion(
      q({
        id: "q3",
        type: "choice",
        options: [{ value: "sqlite", label: "SQLite" }],
      }),
    );
    state.applyAnswer("q3", ans("sqlite"));
    const prev = state.serialize();
    state.applyAnswer("q3", ans("mysql")); // no matching option
    const diff = computeDiff(prev, state.serialize());
    expect(diff.changed).toEqual([
      { id: "q3", title: "prompt for q3", from: "SQLite", to: "mysql", editedArchived: false, value: "mysql" },
    ]);
  });

  test("text_only_edit_same_value_new_text_counts_as_change", () => {
    state.upsertQuestion(q({ id: "q7", title: "Elaboration" }));
    state.applyAnswer("q7", ans("sqlite", "we keep it simple"));
    const prev = state.serialize();
    state.applyAnswer("q7", ans("sqlite", "elaboration added"));
    const diff = computeDiff(prev, state.serialize());
    // NEW-003: from/to render the shipped elaboration (`{answer} — {text}`,
    // the h2.46 completion-record grammar) so the delta line carries the
    // user's reasoning; `value` stays the RAW option value (reconstruction
    // replays value-first — BUG-007).
    expect(diff.changed).toEqual([
      {
        id: "q7",
        title: "Elaboration",
        from: "sqlite — we keep it simple",
        to: "sqlite — elaboration added",
        editedArchived: false,
        value: "sqlite",
      },
    ]);
  });

  test("new_answer_and_cleared_answer_both_diff_with_unanswered_on_correct_side", () => {
    state.upsertQuestion(q({ id: "q1" }));
    state.upsertQuestion(q({ id: "q2" }));
    state.applyAnswer("q1", ans("yes"));
    const prev = state.serialize();
    const next = state.serialize();
    delete next.questions.q1?.answer; // cleared
    next.questions.q2 = { ...q({ id: "q2" }), answer: ans("v") }; // newly answered
    const diff = computeDiff(prev, next);
    expect(diff.changed).toEqual([
      { id: "q1", title: "prompt for q1", from: "yes", to: "(unanswered)", editedArchived: false },
      {
        id: "q2",
        title: "prompt for q2",
        from: "(unanswered)",
        to: "v",
        editedArchived: false,
        value: "v",
      },
    ]);
  });

  test("question_present_only_in_next_with_answer_diffs_from_unanswered", () => {
    const prev = state.serialize();
    const next = state.serialize();
    next.questions.qn = { ...q({ id: "qn" }), answer: ans("hello") };
    const diff = computeDiff(prev, next);
    expect(diff.changed).toEqual([
      {
        id: "qn",
        title: "prompt for qn",
        from: "(unanswered)",
        to: "hello",
        editedArchived: false,
        value: "hello",
      },
    ]);
  });

  test("editedArchived_true_only_for_closed_in_prev_regular_edit_stays_false", () => {
    state.upsertQuestion(
      q({
        id: "qa",
        type: "choice",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      }),
    );
    state.upsertQuestion(q({ id: "qb" }));
    state.applyAnswer("qa", ans("a"));
    state.setStatus("qa", "closed"); // archived (Q24=B)
    state.applyAnswer("qb", ans("old"));
    const prev = state.serialize();
    // Edit the archived answer + re-answer the regular one
    state.applyAnswer("qa", ans("b"));
    state.applyAnswer("qb", ans("new"));
    const diff = computeDiff(prev, state.serialize());
    const qa = diff.changed.find((e) => e.id === "qa");
    const qb = diff.changed.find((e) => e.id === "qb");
    expect(qa).toEqual({ id: "qa", title: "prompt for qa", from: "A", to: "B", editedArchived: true, value: "b" });
    expect(qb).toEqual({
      id: "qb",
      title: "prompt for qb",
      from: "old",
      to: "new",
      editedArchived: false,
      value: "new",
    });
  });

  test("note_passthrough_omitted_when_undefined_or_empty_present_otherwise", () => {
    const prev = state.serialize();
    const next = state.serialize();
    next.epoch = 7;
    expect("note" in computeDiff(prev, next)).toBe(false);
    expect("note" in computeDiff(prev, next, "")).toBe(false);
    const withNote: SubmissionCardData = computeDiff(prev, next, "switching db");
    expect(withNote.note).toBe("switching db");
    expect(withNote.epoch).toBe(7); // = next.epoch
  });

  test("pure_neither_input_is_mutated", () => {
    state.upsertQuestion(q({ id: "q1" }));
    state.applyAnswer("q1", ans("a"));
    const prev = state.serialize();
    state.applyAnswer("q1", ans("b"));
    const next = state.serialize();
    const prevJson = JSON.stringify(prev);
    const nextJson = JSON.stringify(next);
    computeDiff(prev, next, "note");
    expect(JSON.stringify(prev)).toBe(prevJson);
    expect(JSON.stringify(next)).toBe(nextJson);
  });

  test("tolerates_sparse_untrusted_shapes_without_throwing", () => {
    const prev: SerializedState = { goal: "", epoch: 1, order: [], questions: {} };
    const next: SerializedState = {
      goal: "",
      epoch: 2,
      order: ["qz"],
      questions: { qz: q({ id: "qz" }) }, // no answer → signature undefined → no entry
    };
    const diff = computeDiff(prev, next);
    expect(diff.changed).toEqual([]);
    expect(diff.epoch).toBe(2);
    expect(diff.remainOpen).toBe(1);
  });
});

describe("digestSince", () => {
  test("one_segment_per_changed_submission_joined_by_pipe_separator", () => {
    state.upsertQuestion(q({ id: "q1" }));
    state.upsertQuestion(q({ id: "q2" }));
    state.applyAnswer("q1", ans("a"));
    submit(state); // epoch 2
    state.applyAnswer("q1", ans("b"));
    submit(state); // epoch 3
    state.applyAnswer("q2", ans("x"));
    submit(state); // epoch 4
    // Pairs: (1→2) q1 a→b; (2→3) q2 unanswered→x; (3→live) nothing → dropped
    expect(digestSince(state, 1)).toBe("q1: a→b | q2: (unanswered)→x");
  });

  test("empty_when_epochFrom_at_or_after_current_epoch_or_nothing_changed", () => {
    state.upsertQuestion(q({ id: "q1" }));
    state.applyAnswer("q1", ans("a"));
    submit(state); // epoch 2, live == snap2 (nothing changed since)
    expect(state.epoch).toBe(2);
    expect(digestSince(state, 2)).toBe(""); // epochFrom >= state.epoch
    expect(digestSince(state, 3)).toBe("");
    expect(digestSince(state, 1)).toBe(""); // pair (snap1, live): no change
  });

  test("ring_overflow_degrades_to_oldest_surviving_snapshot_without_throwing", () => {
    state.upsertQuestion(q({ id: "q3" }));
    for (let i = 1; i <= 12; i++) {
      state.applyAnswer("q3", ans(`v${i}`));
      submit(state);
    }
    expect(state.epoch).toBe(13);
    // Ring holds epochs 3..12; epochFrom 1 predates it → walk starts at snap3.
    // First surviving pair (snap3 → snap4) is exactly the q3 v3→v4 change.
    const digest = digestSince(state, 1);
    expect(digest.startsWith("q3: v3→v4")).toBe(true);
    expect(digest).not.toContain("v2");
    expect(digest.endsWith("q3: v11→v12")).toBe(true); // last pair with a change
    // Partial range still resolves from the ring
    expect(digestSince(state, 11)).toBe("q3: v11→v12");
  });
});

describe("diff entry value semantics (BUG-007 foundation)", () => {
  test("diff_entry_carries_raw_value_not_label", () => {
    state.upsertQuestion(
      q({
        id: "q1",
        type: "choice",
        options: [
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ],
      }),
    );
    const prev = state.serialize();
    state.applyAnswer("q1", ans("b")); // user chose RAW value "b" (label "Beta")
    const diff = computeDiff(prev, state.serialize());
    // Sanity: a change entry exists for the flip from unanswered.
    const entry = diff.changed.find((e) => e.id === "q1");
    expect(entry?.to).toBe("Beta"); // display summary is label-preferred
    expect(entry?.value).toBe("b"); // machine-readable raw value
  });

  test("diff_entry_value_equals_raw_when_no_option_matches", () => {
    state.upsertQuestion(
      q({ id: "q3", type: "choice", options: [{ value: "sqlite", label: "SQLite" }] }),
    );
    const prev = state.serialize();
    state.applyAnswer("q3", ans("mysql")); // no matching option
    const diff = computeDiff(prev, state.serialize());
    const entry = diff.changed.find((e) => e.id === "q3");
    expect(entry?.value).toBe("mysql");
    expect(entry?.to).toBe("mysql"); // fallback makes to === value in this case
  });

  test("diff_entry_value_for_text_questions_is_the_raw_value", () => {
    state.upsertQuestion(q({ id: "t1" }));
    const prev = state.serialize();
    state.applyAnswer("t1", ans("plain text"));
    const diff = computeDiff(prev, state.serialize());
    const entry = diff.changed.find((e) => e.id === "t1");
    expect(entry?.value).toBe("plain text");
    expect(entry?.value).toBe(entry?.to); // text summaries are already raw
  });

  test("diff_entry_value_omitted_when_answer_cleared", () => {
    state.upsertQuestion(q({ id: "q1" }));
    state.applyAnswer("q1", ans("yes"));
    const prev = state.serialize();
    const next = state.serialize();
    delete next.questions.q1?.answer; // cleared
    const diff = computeDiff(prev, next);
    const entry = diff.changed.find((e) => e.id === "q1");
    expect(entry?.to).toBe("(unanswered)");
    expect(entry?.value).toBeUndefined(); // the cleared-vs-changed signal (P1.M5.T1.S1)
  });

  test("digest_core_shared_value_flows_without_changing_digest_output", () => {
    state.upsertQuestion(
      q({
        id: "q1",
        type: "choice",
        options: [
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ],
      }),
    );
    state.applyAnswer("q1", ans("b"));
    submit(state); // snap epoch 1 holds "b"
    const prev = state.serialize();
    state.applyAnswer("q1", ans("a"));
    submit(state); // snap epoch 2 holds "a"; pair (1→2) is the b→a change
    // prev (answered "b") vs live: the shared core emits the raw value...
    const diff = computeDiff(prev, state.serialize());
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]?.value).toBe("a");
    expect(diff.changed[0]?.to).toBe("Alpha");

    // ...while the digest (same core) still renders display summaries only.
    expect(digestSince(state, 1)).toBe("q1: Beta→Alpha");
  });
});

describe("module hygiene", () => {
  test("snapshots.ts imports ./state.js types only (h2.13 data-layer guard)", () => {
    const src = fs.readFileSync(new URL("./snapshots.ts", import.meta.url), "utf8");
    const importLines = src.split("\n").filter((l) => l.startsWith("import"));
    expect(importLines).toHaveLength(1);
    expect(importLines[0]).toMatch(/^import type \{.*\} from "\.\/state\.js";$/s);
  });
});

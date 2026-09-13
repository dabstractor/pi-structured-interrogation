/**
 * Unit tests for src/delivery.ts (P1.M2.T1.S1).
 *
 * Follows snapshots.test.ts conventions: fresh InterrogationState per test,
 * fixtures built via createInterrogationState + applyAnswer + computeDiff,
 * no pi runtime imports. Verifies content format (h3.6), ≤3-line budget
 * truncation, epoch semantics (pre-bump label, one snapshot + one bump),
 * note passthrough, and `(changed)` markers on editedArchived entries.
 */
import * as fs from "node:fs";
import { beforeEach, describe, expect, test } from "vitest";
import {
  SUBMISSION_LIST_MAX_CHARS,
  SUBMISSION_REMINDER,
  buildSubmission,
  type SubmissionMessage,
} from "./delivery";
import { computeDiff, type SubmissionCardData } from "./snapshots";
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

/** Diff the live state against a prev captured BEFORE the answers were applied. */
function diffFrom(prev: SerializedState, note?: string): SubmissionCardData {
  return computeDiff(prev, state.serialize(), note);
}

/** Choice question fixture with two labeled options. */
function choice(id: string): Question {
  return q({
    id,
    type: "choice",
    options: [
      { value: "sqlite", label: "SQLite" },
      { value: "postgres", label: "Postgres" },
    ],
  });
}

let state: InterrogationState;

beforeEach(() => {
  state = createInterrogationState("Plan the migration");
});

describe("buildSubmission — content", () => {
  test("happy_path_two_answers_exact_content_and_envelope", () => {
    state.upsertQuestion(q({ id: "q1" }));
    state.upsertQuestion(q({ id: "q2" }));
    const prev = state.serialize();
    state.applyAnswer("q1", ans("SQLite"));
    state.applyAnswer("q2", ans("Postgres"));
    const diff = diffFrom(prev);

    const msg = buildSubmission(state, diff);

    expect(msg.content).toBe(
      "Submitted 2: q1: SQLite; q2: Postgres\nConsider how these affect your other questions.",
    );
    expect(msg.customType).toBe("interrogation-submission");
    expect(msg.display).toBe(true);
    expect(msg.details.card).toBe(diff); // same object reference
    expect(msg.details.changed).toEqual(diff.changed);
  });

  test("editedArchived_entry_gets_changed_suffix_regular_edit_does_not", () => {
    state.upsertQuestion(choice("qa"));
    state.upsertQuestion(q({ id: "qb" }));
    state.applyAnswer("qa", ans("sqlite"));
    state.setStatus("qa", "closed"); // archived (Q24=B)
    state.applyAnswer("qb", ans("old"));
    const prev = state.serialize();
    state.applyAnswer("qa", ans("postgres"));
    state.applyAnswer("qb", ans("new"));
    const diff = computeDiff(prev, state.serialize());

    const msg = buildSubmission(state, diff);

    const line1 = msg.content.split("\n")[0];
    expect(line1).toBe("Submitted 2: qa: Postgres (changed); qb: new");
  });

  test("truncation_30_long_answers_keeps_3_line_budget_and_true_k", () => {
    for (let i = 1; i <= 30; i++) {
      state.upsertQuestion(q({ id: `q${i}` }));
    }
    const prev = state.serialize();
    for (let i = 1; i <= 30; i++) state.applyAnswer(`q${i}`, ans("v".repeat(60)));
    const diff = computeDiff(prev, state.serialize());
    expect(diff.changed).toHaveLength(30);

    const msg = buildSubmission(state, diff);
    const lines = msg.content.split("\n");

    expect(lines).toHaveLength(2); // ≤3 lines (2 by construction)
    expect(lines[0]).toMatch(/^Submitted 30: /); // k reports the true count
    expect(lines[0]).toMatch(/\+\d+ more$/); // rollup suffix present
    expect(lines[1]).toBe(SUBMISSION_REMINDER);
  });

  test("single_huge_entry_still_fits_budget_rule_at_least_one_survives", () => {
    state.upsertQuestion(q({ id: "q1" }));
    const prev = state.serialize();
    state.applyAnswer("q1", ans("x".repeat(SUBMISSION_LIST_MAX_CHARS * 2)));
    const diff = diffFrom(prev);

    const msg = buildSubmission(state, diff);
    const lines = msg.content.split("\n");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(`Submitted 1: q1: ${"x".repeat(SUBMISSION_LIST_MAX_CHARS * 2)}`);
    expect(lines[0]).not.toContain("+1 more"); // single entry is never dropped
  });

  test("zero_changes_no_changes_line_still_one_snapshot_one_bump", () => {
    state.upsertQuestion(q({ id: "q1" }));
    const prev = state.serialize();
    const diff = diffFrom(prev);
    expect(diff.changed).toEqual([]);

    const msg = buildSubmission(state, diff);

    expect(msg.content).toBe(
      "Submitted 0: (no changes)\nConsider how these affect your other questions.",
    );
    expect(state.snapshots).toHaveLength(1); // ring consistency on empty diffs
    expect(state.epoch).toBe(2);
  });

  test("reminder_line_is_byte_exact_vs_constant", () => {
    state.upsertQuestion(q({ id: "q1" }));
    const prev = state.serialize();
    state.applyAnswer("q1", ans("a"));
    const msg = buildSubmission(state, diffFrom(prev));

    expect(SUBMISSION_REMINDER).toBe("Consider how these affect your other questions.");
    expect(msg.content.split("\n")[1]).toBe(SUBMISSION_REMINDER);
  });
});

describe("buildSubmission — details", () => {
  test("note_passthrough_present_when_non_empty_absent_otherwise", () => {
    state.upsertQuestion(q({ id: "q1" }));
    const prev = state.serialize();
    state.applyAnswer("q1", ans("a"));
    const diff = diffFrom(prev);

    const withNote = buildSubmission(state, diff, "switching db");
    expect(withNote.details.note).toBe("switching db");

    const noNote = buildSubmission(state, diff);
    expect("note" in noNote.details).toBe(false);

    const emptyNote = buildSubmission(state, diff, "");
    expect("note" in emptyNote.details).toBe(false);
  });

  test("epoch_details_epoch_is_pre_bump_state_epoch_is_post_bump", () => {
    state.upsertQuestion(q({ id: "q1" }));
    const prev = state.serialize();
    state.applyAnswer("q1", ans("a"));
    const diff = diffFrom(prev);
    const before = state.epoch; // 1

    const msg = buildSubmission(state, diff);

    expect(before).toBe(1);
    expect(msg.details.epoch).toBe(1); // pre-bump, matches diff.epoch
    expect(msg.details.epoch).toBe(diff.epoch);
    expect(state.epoch).toBe(2); // exactly +1
  });

  test("snapshot_ring_exactly_one_push_labeled_pre_bump_epoch", () => {
    state.upsertQuestion(q({ id: "q1" }));
    const prev = state.serialize();
    state.applyAnswer("q1", ans("a"));
    const diff = diffFrom(prev);
    const ringBefore = state.snapshots.length;

    buildSubmission(state, diff);

    expect(state.snapshots.length - ringBefore).toBe(1); // exactly one push
    const last = state.snapshots[state.snapshots.length - 1];
    expect(last?.epoch).toBe(1); // labeled with the PRE-bump epoch
    expect(last?.state.epoch).toBe(1); // snapshot state is pre-bump too
  });

  test("no_message_mutation_side_effects_details_hold_input_references", () => {
    state.upsertQuestion(q({ id: "q1" }));
    const prev = state.serialize();
    state.applyAnswer("q1", ans("a"));
    const diff = diffFrom(prev);

    const msg: SubmissionMessage = buildSubmission(state, diff, "n");

    expect(msg.details.card).toBe(diff);
    expect(msg.details.changed).toBe(diff.changed);
    expect(Object.keys(msg.details).sort()).toEqual(["card", "changed", "epoch", "note"]);
  });
});

describe("module hygiene", () => {
  test("delivery.ts imports only local data-layer modules (no pi/UI/transport)", () => {
    const src = fs.readFileSync(new URL("./delivery.ts", import.meta.url), "utf8");
    const importLines = src.split("\n").filter((l) => l.startsWith("import"));
    expect(importLines).toHaveLength(2);
    for (const line of importLines) {
      expect(line).toMatch(/^import (?:type )?\{.*\} from "\.\/(snapshots|state)\.js";$/s);
    }
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toContain("sendMessage");
    expect(code).not.toContain("triggerTurn");
  });
});

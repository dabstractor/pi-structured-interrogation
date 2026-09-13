/**
 * src/panel/gate.test.ts — soft-gate helper tests (P1.M5.T3.S1).
 *
 * Covers the five gate.ts exports: effectiveGroup (ungrouped bucket),
 * gateGroupNames (any-member rule, ungrouped gate, empty/none),
 * countUnansweredGate (open counts; answered/submitted don't; moot/
 * withdrawn excluded), gateWarningLine exact string, and the
 * pickGateInitialQuestionId ladder (focusQuestionId wins; gate first
 * answerable; all-withdrawn/moot fallback; no-gate degenerates to the
 * pre-gate first-open/first tail).
 *
 * Conventions follow layout.test.ts / actions.test.ts: hand-built plain
 * fixtures (no runtime), no pi imports beyond state types.
 */
import { describe, expect, test } from "vitest";
import { UNGROUPED_LABEL, type Question } from "../state.js";
import {
  countUnansweredGate,
  effectiveGroup,
  gateGroupNames,
  gateWarningLine,
  pickGateInitialQuestionId,
} from "./gate.js";

// ------------------------------------------------------------------ fixtures

function q(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    prompt: `prompt:${id}`,
    type: "choice",
    rev: 1,
    status: "open",
    options: [{ value: "a", label: "Alpha" }],
    ...overrides,
  };
}

/** Seed answers via applyAnswer semantics (answer + status answered). */
function answered(question: Question, value = "a"): Question {
  return { ...question, answer: { value, at: "2024-01-01T00:00:00Z" }, status: "answered" };
}

// ------------------------------------------------------------- effectiveGroup

describe("effectiveGroup", () => {
  test("test_effectiveGroup_uses_q_group_when_present", () => {
    expect(effectiveGroup(q("g1", { group: "storage" }))).toBe("storage");
  });

  test(`test_effectiveGroup_ungrouped_maps_to_${UNGROUPED_LABEL}`, () => {
    expect(effectiveGroup(q("u1"))).toBe(UNGROUPED_LABEL);
  });
});

// ------------------------------------------------------------- gateGroupNames

describe("gateGroupNames — any-member rule", () => {
  test("test_gate_any_single_member_marks_whole_group", () => {
    const ordered = [
      q("g1", { group: "foundation", gate: true }),
      q("g2", { group: "foundation" }), // non-gate member — group STILL gate
      q("n1", { group: "later" }),
    ];
    const gate = gateGroupNames(ordered);
    expect(gate.has("foundation")).toBe(true);
    expect(gate.has("later")).toBe(false);
    expect(gate.size).toBe(1);
  });

  test("test_gate_ungrouped_bucket_is_gate_eligible", () => {
    const ordered = [q("u1", { gate: true }), q("u2"), q("g1", { group: "later" })];
    const gate = gateGroupNames(ordered);
    expect(gate.has(UNGROUPED_LABEL)).toBe(true);
    expect(gate.has("later")).toBe(false);
  });

  test("test_gate_empty_and_none_yield_empty_set", () => {
    expect(gateGroupNames([]).size).toBe(0);
    expect(gateGroupNames([q("a"), q("b", { group: "x" })]).size).toBe(0);
  });

  test("test_gate_multiple_gate_groups_detected", () => {
    const ordered = [
      q("a", { group: "one", gate: true }),
      q("b", { group: "two", gate: true }),
      q("c", { group: "three" }),
    ];
    expect(gateGroupNames(ordered)).toEqual(new Set(["one", "two"]));
  });
});

// --------------------------------------------------------- countUnansweredGate

describe("countUnansweredGate", () => {
  const gate = new Set(["foundation"]);

  test("test_count_open_gate_questions_count_as_unanswered", () => {
    const ordered = [
      q("g1", { group: "foundation", gate: true }),
      q("g2", { group: "foundation" }),
      q("n1", { group: "later" }), // non-gate open — never counted
    ];
    expect(countUnansweredGate(ordered, gate)).toBe(2);
  });

  test("test_count_answered_and_submitted_do_not_count", () => {
    const ordered = [
      answered(q("g1", { group: "foundation", gate: true })),
      q("g2", { group: "foundation", status: "submitted", answer: { value: "a", at: "t" } }),
    ];
    expect(countUnansweredGate(ordered, gate)).toBe(0);
  });

  test("test_count_moot_and_withdrawn_are_excluded", () => {
    const ordered = [
      q("g1", { group: "foundation", gate: true, status: "moot" }),
      q("g2", { group: "foundation", status: "withdrawn" }),
      q("g3", { group: "foundation", status: "reasked" }), // reasked open question counts
    ];
    expect(countUnansweredGate(ordered, gate)).toBe(1);
  });

  test("test_count_ignores_questions_outside_gate_groups", () => {
    const ordered = [q("n1", { group: "later" }), q("n2")];
    expect(countUnansweredGate(ordered, gate)).toBe(0);
    expect(countUnansweredGate(ordered, new Set())).toBe(0);
  });
});

// ------------------------------------------------------------ gateWarningLine

describe("gateWarningLine", () => {
  test("test_warning_text_exact_string", () => {
    expect(gateWarningLine(1)).toBe("⚠ 1 foundational unanswered — later answers may shift");
    expect(gateWarningLine(2)).toBe("⚠ 2 foundational unanswered — later answers may shift");
  });
});

// ------------------------------------------------- pickGateInitialQuestionId

describe("pickGateInitialQuestionId — FR-1 ladder", () => {
  test("test_focus_explicit_focusQuestionId_wins_over_gate", () => {
    const ordered = [
      q("g1", { group: "foundation", gate: true }),
      q("n1", { group: "later" }),
    ];
    expect(pickGateInitialQuestionId(ordered, gateGroupNames(ordered), "n1")).toBe("n1");
  });

  test("test_focus_unknown_focusQuestionId_falls_through_to_gate", () => {
    const ordered = [
      q("g1", { group: "foundation" }),
      q("g2", { group: "foundation", gate: true }),
      q("n1", { group: "later" }),
    ];
    // g1 is first in order — the gate group's first ANSWERABLE question.
    expect(pickGateInitialQuestionId(ordered, gateGroupNames(ordered), "ghost")).toBe("g1");
  });

  test("test_focus_lands_on_gate_groups_first_answerable_skipping_withdrawn_moot", () => {
    const ordered = [
      q("g1", { group: "foundation", gate: true, status: "withdrawn" }),
      q("g2", { group: "foundation", status: "moot" }),
      q("g3", { group: "foundation" }), // first answerable member
      q("n1", { group: "later", status: "open" }),
    ];
    expect(pickGateInitialQuestionId(ordered, gateGroupNames(ordered), undefined)).toBe("g3");
  });

  test("test_focus_all_withdrawn_or_moot_falls_back_to_gate_groups_first_question", () => {
    const ordered = [
      q("n1", { group: "later", status: "open" }),
      q("g1", { group: "foundation", gate: true, status: "withdrawn" }),
      q("g2", { group: "foundation", status: "moot" }),
    ];
    expect(pickGateInitialQuestionId(ordered, gateGroupNames(ordered), undefined)).toBe("g1");
  });

  test("test_focus_answered_or_submitted_gate_members_are_answerable_targets", () => {
    const ordered = [
      answered(q("g1", { group: "foundation", gate: true })),
      q("g2", { group: "foundation" }),
    ];
    // answered/submitted are NOT withdrawn/moot → answerable per FR-1.
    expect(pickGateInitialQuestionId(ordered, gateGroupNames(ordered), undefined)).toBe("g1");
  });

  test("test_focus_no_gate_degenerates_to_first_open_then_first", () => {
    const ordered = [q("a", { status: "answered" }), q("b", { status: "open" }), q("c")];
    expect(pickGateInitialQuestionId(ordered, new Set(), undefined)).toBe("b");

    const noneOpen = [q("a", { status: "answered" }), q("z", { status: "closed" })];
    expect(pickGateInitialQuestionId(noneOpen, new Set(), undefined)).toBe("a");

    expect(pickGateInitialQuestionId([], new Set(), undefined)).toBeUndefined();
  });

  test("test_focus_ungrouped_gate_question_focuses_ungrouped_bucket", () => {
    const ordered = [q("g1", { group: "later" }), q("u1", { gate: true })];
    expect(pickGateInitialQuestionId(ordered, gateGroupNames(ordered), undefined)).toBe("u1");
  });
});

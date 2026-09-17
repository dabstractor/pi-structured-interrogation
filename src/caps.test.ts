/**
 * Unit tests for src/caps.ts (P1.M1.T3.S3).
 *
 * The caps engine is pure — plain-object fixtures only, no mocks, no I/O.
 * Formula numbers are asserted against PRD h2.23 (budget = min(pct/100 ×
 * contextWindow × 4, 60000) chars, divided across the INPUT batch); warning
 * strings are asserted byte-for-byte.
 */
import { expect, test } from "vitest";
import { DEFAULT_CONFIG } from "./config";
import { applyCaps, CHARS_PER_TOKEN, DESCRIPTION_BUDGET_CEILING, descriptionCap } from "./caps";
import type { QuestionInput } from "./tool-schema";

/** Build one minimal question with optional overrides. */
function makeQ(id: string, overrides: Partial<QuestionInput> = {}): QuestionInput {
  return { id, prompt: `prompt ${id}`, type: "text", ...overrides };
}

/** Build `n` simple questions. */
function makeBatch(n: number): QuestionInput[] {
  return Array.from({ length: n }, (_, i) => makeQ(`q${i}`));
}

// ---------------------------------------------------------------- constants

test("test_constants_expose_the_h2_23_formula_numbers", () => {
  expect(CHARS_PER_TOKEN).toBe(4);
  expect(DESCRIPTION_BUDGET_CEILING).toBe(60000);
});

// ------------------------------------------------- descriptionCap: formula

test("test_descriptionCap_default_caps_at_128k_window_40_questions_stays_1200", () => {
  // 4% × 128000 × 4 = 20480 chars → floor(20480/40) = 512 → max(1200, 512)
  expect(descriptionCap(DEFAULT_CONFIG.caps, 128_000, 40)).toBe(1200);
});

test("test_descriptionCap_1m_window_hits_60k_ceiling_1500_per_question_at_40", () => {
  // 4% × 1M × 4 = 160000 → min → 60000 → floor(60000/40) = 1500 → max(1200, 1500)
  expect(descriptionCap(DEFAULT_CONFIG.caps, 1_000_000, 40)).toBe(1500);
});

test("test_descriptionCap_ceiling_clamps_absurd_windows_even_for_one_question", () => {
  expect(descriptionCap(DEFAULT_CONFIG.caps, 10_000_000, 1)).toBe(60000);
});

test("test_descriptionCap_zero_questions_divides_by_one", () => {
  expect(descriptionCap(DEFAULT_CONFIG.caps, 128_000, 0)).toBe(20480);
});

// ------------------------------------------------- applyCaps: descriptions

test("test_applyCaps_128k_window_truncates_descriptions_to_1200_across_batch", () => {
  const qs = Array.from({ length: 40 }, (_, i) => makeQ(`q${i}`, { description: "x".repeat(1300) }));
  const r = applyCaps(qs, "", DEFAULT_CONFIG, 128_000);
  expect(r.questions.every((q) => q.description?.length === 1200)).toBe(true);
  expect(r.warnings).toHaveLength(40);
  expect(r.warnings[0]).toBe("q0 description truncated at 1300 chars — restructure if essential");
});

test("test_applyCaps_h2_23_exemplar_warning_q7_2100_chars_byte_for_byte", () => {
  const qs = makeBatch(40);
  qs[7].description = "y".repeat(2100);
  const r = applyCaps(qs, "", DEFAULT_CONFIG, 128_000);
  expect(r.warnings).toEqual(["q7 description truncated at 2100 chars — restructure if essential"]);
  expect(r.questions[7].description).toHaveLength(1200);
});

test("test_applyCaps_1m_window_raises_effective_cap_to_1500", () => {
  const qs = Array.from({ length: 40 }, (_, i) => makeQ(`q${i}`, { description: "z".repeat(1600) }));
  const r = applyCaps(qs, "", DEFAULT_CONFIG, 1_000_000);
  expect(r.questions[0].description).toHaveLength(1500);
  expect(r.warnings[0]).toBe("q0 description truncated at 1600 chars — restructure if essential");
});

test("test_description_budget_uses_pre_truncation_question_count", () => {
  // 45 questions @ 1M window: budget 60000 / INPUT 45 = 1333 (NOT /40 = 1500).
  const qs = Array.from({ length: 45 }, (_, i) => makeQ(`q${i}`, { description: "w".repeat(2000) }));
  const r = applyCaps(qs, "", DEFAULT_CONFIG, 1_000_000);
  expect(r.questions).toHaveLength(40);
  expect(r.questions[0].description).toHaveLength(Math.floor(60000 / 45));
  expect(r.questions[0].description).toHaveLength(1333);
  expect(r.warnings).toContain("questions truncated to 40 — 5 dropped");
});

test("test_description_exactly_at_cap_passes_silently", () => {
  const qs = Array.from({ length: 40 }, (_, i) => makeQ(`q${i}`, { description: "x".repeat(1200) }));
  const r = applyCaps(qs, "", DEFAULT_CONFIG, 128_000);
  expect(r.warnings).toEqual([]);
  expect(r.questions[0].description).toHaveLength(1200);
});

// ------------------------------------------------ applyCaps: ramification

test("test_ramification_truncated_to_600_with_exact_warning", () => {
  const qs = [
    makeQ("q1", {
      type: "choice",
      options: [{ value: "a", label: "A", ramification: "r".repeat(700) }],
    }),
  ];
  const r = applyCaps(qs, "", DEFAULT_CONFIG, 128_000);
  expect(r.warnings).toEqual(["q1 ramification truncated at 700 chars"]);
  expect(r.questions[0].options?.[0]?.ramification).toHaveLength(600);
});

test("test_ramification_lint_warns_on_thin_text_and_on_total_absence", () => {
  const qs = [
    makeQ("q1", {
      type: "choice",
      options: [{ value: "a", label: "A", ramification: "short" }, { value: "b", label: "B" }],
    }),
  ];
  const r = applyCaps(qs, "", DEFAULT_CONFIG, 128_000);
  // 2026-09-15 deep-view pin: thin (present-but-short) per option, and each
  // missing ramification lints individually — every choice must be decidable.
  expect(r.warnings).toEqual([
    "q1 option a ramification is only 5 chars — expand to standalone consequences and re-upsert",
    "q1 option b has no ramification — give every option standalone consequences and re-upsert",
  ]);
});

// ----------------------------------------------------- applyCaps: options

test("test_options_truncation_reappends_recommendation_when_it_is_last", () => {
  const opts = Array.from({ length: 9 }, (_, i) => ({ value: `v${i}`, label: `L${i}`, ramification: "r".repeat(120) }));
  const qs = [makeQ("q1", { type: "choice", options: opts, recommendation: "v8" })];
  const r = applyCaps(qs, "", DEFAULT_CONFIG, 128_000);
  expect(r.questions[0].options?.map((o) => o.value)).toEqual([
    "v0", "v1", "v2", "v3", "v4", "v5", "v6", "v8",
  ]);
  expect(r.questions[0].recommendation).toBe("v8");
  expect(r.warnings).toEqual(["q1 options truncated to 8 (recommendation preserved)"]);
});

test("test_options_truncation_with_recommendation_in_head_reports_plain_count", () => {
  const opts = Array.from({ length: 9 }, (_, i) => ({ value: `v${i}`, label: `L${i}`, ramification: "r".repeat(120) }));
  const qs = [makeQ("q1", { type: "choice", options: opts, recommendation: "v2" })];
  const r = applyCaps(qs, "", DEFAULT_CONFIG, 128_000);
  expect(r.questions[0].options).toHaveLength(7);
  expect(r.warnings).toEqual(["q1 options truncated to 7 (recommendation preserved)"]);
});

test("test_options_truncation_without_recommendation_keeps_first_n", () => {
  const opts = Array.from({ length: 9 }, (_, i) => ({ value: `v${i}`, label: `L${i}`, ramification: "r".repeat(120) }));
  const qs = [makeQ("q1", { type: "choice", options: opts })];
  const r = applyCaps(qs, "", DEFAULT_CONFIG, 128_000);
  expect(r.questions[0].options?.map((o) => o.value)).toHaveLength(7);
  expect(r.warnings).toEqual(["q1 options truncated to 7 (recommendation preserved)"]);
});

test("test_options_under_cap_pass_through_untouched", () => {
  const opts = [
    { value: "a", label: "A", ramification: "r".repeat(120) },
    { value: "b", label: "B", ramification: "r".repeat(120) },
  ];
  const qs = [makeQ("q1", { type: "choice", options: opts, recommendation: "a" })];
  const r = applyCaps(qs, "", DEFAULT_CONFIG, 128_000);
  expect(r.questions[0].options).toEqual(opts);
  expect(r.warnings).toEqual([]);
});

// --------------------------------------------------- applyCaps: questions

test("test_question_count_truncation_keeps_first_40_and_warns", () => {
  const qs = makeBatch(45);
  const r = applyCaps(qs, "", DEFAULT_CONFIG, 128_000);
  expect(r.questions.map((q) => q.id)).toEqual(makeBatch(40).map((q) => q.id));
  expect(r.warnings).toEqual(["questions truncated to 40 — 5 dropped"]);
});

// ------------------------------------------------------- applyCaps: goal

test("test_goal_truncated_to_400_with_exact_warning", () => {
  const r = applyCaps([], "g".repeat(500), DEFAULT_CONFIG, 128_000);
  expect(r.goal).toHaveLength(400);
  expect(r.warnings).toEqual(["goal truncated at 500 chars"]);
});

// ------------------------------------------- applyCaps: minimums (deep-view lint)

test("test_thin_description_warns_with_expand_instruction_and_is_never_mutated", () => {
  const r = applyCaps([makeQ("q1", { description: "thin" })], "", DEFAULT_CONFIG, 128_000);
  expect(r.questions[0].description).toBe("thin"); // lint never pads
  expect(r.warnings).toEqual([
    "q1 description is only 4 chars — deep view must stand alone; expand and re-upsert with the current rev",
  ]);
});

test("test_thin_ramification_warns_per_option", () => {
  const qs = [makeQ("q1", { type: "choice", options: [{ value: "a", label: "A", ramification: "too short" }] })];
  const r = applyCaps(qs, "", DEFAULT_CONFIG, 128_000);
  expect(r.warnings).toEqual([
    "q1 option a ramification is only 9 chars — expand to standalone consequences and re-upsert",
  ]);
});

test("test_options_without_ramification_warn_per_option", () => {
  const qs = [makeQ("q1", { type: "choice", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] })];
  const r = applyCaps(qs, "", DEFAULT_CONFIG, 128_000);
  expect(r.warnings).toEqual([
    "q1 option a has no ramification — give every option standalone consequences and re-upsert",
    "q1 option b has no ramification — give every option standalone consequences and re-upsert",
  ]);
});

test("test_zero_floors_disable_each_lint", () => {
  const config = { ...DEFAULT_CONFIG, caps: { ...DEFAULT_CONFIG.caps, minDescription: 0, minRamification: 0 } };
  const qs = [makeQ("q1", { description: "thin", type: "choice", options: [{ value: "a", label: "A" }] })];
  const r = applyCaps(qs, "", config, 128_000);
  expect(r.warnings).toEqual([]);
});

test("test_floor_lints_the_stored_text_not_the_input", () => {
  // 30000 chars truncates to 20480 (1 question, 128k window: budget 20480)
  // — above the 200 floor: no lint despite the shorthand-looking input,
  // because the lint targets the text the user will actually see.
  const r = applyCaps([makeQ("q1", { description: "x".repeat(30000) })], "", DEFAULT_CONFIG, 128_000);
  expect(r.warnings).toEqual(["q1 description truncated at 30000 chars — restructure if essential"]);
});

test("test_absent_description_never_lints", () => {
  const r = applyCaps([makeQ("q1")], "", DEFAULT_CONFIG, 128_000);
  expect(r.warnings).toEqual([]);
});

// ------------------------------------------------- no-warning happy paths

test("test_under_cap_batch_produces_no_warnings_and_identical_content", () => {
  const qs = [
    makeQ("q1", {
      description: "d".repeat(250),
      type: "choice",
      options: [{ value: "a", label: "A", ramification: "r".repeat(150) }],
      recommendation: "a",
    }),
  ];
  const r = applyCaps(qs, "goal under limit", DEFAULT_CONFIG, 128_000);
  expect(r.warnings).toEqual([]);
  expect(r.questions[0]).toEqual(qs[0]);
  expect(r.goal).toBe("goal under limit");
});

// ------------------------------------------------------- purity/never-throw

test("test_inputs_never_mutated_even_when_everything_truncates", () => {
  const qs: QuestionInput[] = Array.from({ length: 45 }, (_, i) =>
    makeQ(`q${i}`, {
      description: "d".repeat(2100),
      type: "choice",
      options: Array.from({ length: 9 }, (_, j) => ({
        value: `v${j}`,
        label: `L${j}`,
        ramification: "r".repeat(700),
      })),
      recommendation: "v8",
    }),
  );
  const goal = "g".repeat(500);
  const before = structuredClone(qs);

  const r = applyCaps(qs, goal, DEFAULT_CONFIG, 128_000);

  expect(qs).toEqual(before);
  expect(goal).toBe("g".repeat(500));
  expect(r.questions[0]).not.toBe(qs[0]);
  expect(r.questions[0].options?.[0]).not.toBe(qs[0].options?.[0]);
  expect(r.questions).toHaveLength(40);
  expect(r.questions[0].description).toHaveLength(1200);
  expect(r.questions[0].options).toHaveLength(8);
});

test("test_absent_optionals_and_empty_batch_never_throw", () => {
  expect(applyCaps([], "", DEFAULT_CONFIG, 128_000)).toEqual({
    questions: [],
    goal: "",
    warnings: [],
  });
  // choice question without options; recommendation naming no option.
  const qs = [
    { id: "q1", prompt: "p", type: "text" } as QuestionInput,
    makeQ("q2", {
      type: "choice",
      options: [{ value: "a", label: "A", ramification: "r".repeat(120) }],
      recommendation: "nonexistent",
    }),
  ];
  const r = applyCaps(qs, "", DEFAULT_CONFIG, 128_000);
  expect(r.warnings).toEqual([]);
  expect(r.questions).toHaveLength(2);
});

// ------------------------------------------------------- config overrides

test("test_config_override_caps_description_respected", () => {
  const config = { ...DEFAULT_CONFIG, caps: { ...DEFAULT_CONFIG.caps, description: 2000 } };
  const qs = Array.from({ length: 40 }, (_, i) => makeQ(`q${i}`, { description: "x".repeat(2500) }));
  const r = applyCaps(qs, "", config, 128_000);
  // cap = max(2000, floor(20480/40)=512) = 2000
  expect(r.questions[0].description).toHaveLength(2000);
  expect(r.warnings[0]).toBe("q0 description truncated at 2500 chars — restructure if essential");
});

test("test_context_budget_pct_override_scales_budget_to_ceiling", () => {
  const config = { ...DEFAULT_CONFIG, caps: { ...DEFAULT_CONFIG.caps, contextBudgetPct: 50 } };
  // 50% × 128000 × 4 = 256000 → ceiling → 60000 → 1 question → cap 60000.
  const qs = [makeQ("q1", { description: "d".repeat(60000) })];
  const r = applyCaps(qs, "", config, 128_000);
  expect(r.warnings).toEqual([]);
  expect(r.questions[0].description).toHaveLength(60000);
});

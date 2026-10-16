/**
 * src/panel/sidechat-prompt.test.ts — pins the SIDECHAT-003 system-prompt
 * builder (P1.M1.T4.S2): verbatim inclusion (600+ char description head AND
 * tail, every option's full ramification, newline-bearing prompt round-trip),
 * the one-line-per-question digest shape (collapsed whitespace, verbatim
 * write-in values, bare status words), the SIDECHAT-004 answer protocol per
 * question type (```answer fenced block, JSON form(s), byte-match wording),
 * the goal line, and determinism (two calls → identical strings). Pure
 * data-in/string-out — no state object, no mocks needed.
 */
import { describe, expect, test } from "vitest";
import type { Question } from "../state.js";
import { buildSideChatSystemPrompt } from "./sidechat-prompt.js";

const T0 = "2025-01-01T00:00:00.000Z";

const GOAL = "Ship a storage layer that survives the SOC-2 audit without waking the on-call engineer.";

/** 600+ char multi-line description with punctuation + unicode — head AND tail pinned verbatim. */
const LONG_DESCRIPTION = [
  "Background: this service started as a weekend hack and grew three unplanned migrations in March —",
  "the team attached the full history to this question so the advisor sees the same contract the",
  "user sees in deep view: cost ceilings ($0.04/GB at p99), a hard SOC-2 deadline (2026-03-31),",
  "and a standing preference — “prefer boring technology” — held since the postmortem of 2025-11.",
  "Deployment reality: one writer node, reads replicated to two regions (eu-west, us-east), p99",
  "query budget 40 ms, and the on-call rotation is exactly two engineers. Unicode check: naïve",
  "façade, Žižek, 日本語, 🚀. Punctuation check: semicolons; colons: dashes — and (parentheses).",
  "If any of this is missing from what the advisor sees, the advice is grounded in a summary, not",
  "the real question — that failure mode is exactly what this verbatim contract exists to prevent.",
].join("\n");

/** 200+ char consequence notes — each must appear in FULL (no ramification summarization). */
const RAMIFICATION_SQLITE =
  "Zero-ops single-file storage: backups are file copies, every host already ships the library, " +
  "and p99 stays under budget at current write volume — but the writer is single-node, so a busy " +
  "night-batch job serializes behind the API and the 2026-03-31 SOC-2 audit needs the WAL verified.";
const RAMIFICATION_POSTGRES =
  "Full SQL surface with real replication: the two-region reads become warm standbys, extensions " +
  "cover the JSON shapes the billing team wants, and point-in-time recovery satisfies the audit — " +
  "at the cost of running (and patching) a database server in every region from now on.";

const CHOICE_QUESTION: Question = {
  id: "q3",
  prompt:
    "Which storage engine should we ship?\nLine two — unicode check: émöji 🚀, “quotes”, and a trailing colon:",
  description: LONG_DESCRIPTION,
  type: "choice",
  options: [
    { value: "sqlite", label: "SQLite", ramification: RAMIFICATION_SQLITE },
    { value: "postgres", label: "Postgres", ramification: RAMIFICATION_POSTGRES },
    { value: "files", label: "Files on disk" }, // no ramification — line renders bare
  ],
  rev: 1,
  status: "open",
};

const TEXT_QUESTION: Question = {
  id: "t1",
  prompt: "What should we name the release?",
  type: "text",
  rev: 1,
  status: "open",
};

/** 3-question digest fixture: answered / custom write-in / unanswered (moot). */
const DIGEST_QUESTIONS: Question[] = [
  {
    id: "q1",
    prompt: "Pick the storage engine",
    type: "choice",
    options: CHOICE_QUESTION.options,
    rev: 1,
    status: "answered",
    answer: { value: "sqlite", at: T0 },
  },
  {
    id: "q2",
    prompt: "Why   collapse   these\n\nruns?",
    type: "choice",
    options: CHOICE_QUESTION.options,
    rev: 1,
    status: "answered",
    answer: { value: "boring tech wins on call load", custom: true, at: T0 }, // write-in — verbatim
  },
  {
    id: "q4",
    prompt: "Migrate legacy exports?",
    type: "choice",
    options: CHOICE_QUESTION.options,
    rev: 1,
    status: "moot",
  },
];

describe("buildSideChatSystemPrompt — SIDECHAT-003 five sections (P1.M1.T4.S2)", () => {
  test("test_role_framing_and_question_heading_open_the_prompt", () => {
    const out = buildSideChatSystemPrompt(CHOICE_QUESTION, GOAL, DIGEST_QUESTIONS);
    expect(out).toContain("private advisor");
    expect(out).toContain("exactly ONE question");
    expect(out).toContain("## The question (q3 · type: choice)");
  });

  test("test_verbatim_description_round_trips_head_and_tail", () => {
    const out = buildSideChatSystemPrompt(CHOICE_QUESTION, GOAL, DIGEST_QUESTIONS);
    expect(LONG_DESCRIPTION.length).toBeGreaterThan(600); // fixture sanity: long enough to pin
    expect(out).toContain(LONG_DESCRIPTION); // FULL inclusion
    expect(out).toContain(LONG_DESCRIPTION.slice(0, 80)); // head verbatim
    expect(out).toContain(LONG_DESCRIPTION.slice(-80)); // tail verbatim
  });

  test("test_every_option_ramification_appears_in_full", () => {
    const out = buildSideChatSystemPrompt(CHOICE_QUESTION, GOAL, DIGEST_QUESTIONS);
    expect(RAMIFICATION_SQLITE.length).toBeGreaterThan(200); // fixture sanity
    expect(RAMIFICATION_POSTGRES.length).toBeGreaterThan(200);
    expect(out).toContain(RAMIFICATION_SQLITE);
    expect(out).toContain(RAMIFICATION_POSTGRES);
    expect(out).toContain("- SQLite (value: sqlite)");
    expect(out).toContain("- Postgres (value: postgres)");
    expect(out).toContain("- Files on disk (value: files)"); // bare line when no ramification
  });

  test("test_prompt_with_embedded_newlines_round_trips_verbatim", () => {
    const out = buildSideChatSystemPrompt(CHOICE_QUESTION, GOAL, DIGEST_QUESTIONS);
    expect(out).toContain(CHOICE_QUESTION.prompt); // NOT whitespace-collapsed in the question section
  });

  test("test_goal_under_its_own_heading", () => {
    const out = buildSideChatSystemPrompt(CHOICE_QUESTION, GOAL, DIGEST_QUESTIONS);
    expect(out).toContain(`## The goal\n\n${GOAL}`); // verbatim, on its own line
  });

  test("test_digest_renders_exactly_one_line_per_question", () => {
    const out = buildSideChatSystemPrompt(CHOICE_QUESTION, GOAL, DIGEST_QUESTIONS);
    const start = out.indexOf("## Answers so far");
    const end = out.indexOf("## Answer protocol");
    const lines = out
      .slice(start, end)
      .split("\n")
      .filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(3); // EXACTLY one line per question
    expect(lines[0]).toBe("- q1 · Pick the storage engine → answered: sqlite");
    // Whitespace runs collapsed to single spaces; custom write-in value ships VERBATIM.
    expect(lines[1]).toBe("- q2 · Why collapse these runs? → answered: boring tech wins on call load");
    expect(lines[2]).toBe("- q4 · Migrate legacy exports? → moot"); // bare status word
  });

  test("test_answer_protocol_choice_names_both_forms_with_byte_match", () => {
    const out = buildSideChatSystemPrompt(CHOICE_QUESTION, GOAL, DIGEST_QUESTIONS);
    expect(out).toContain("```answer"); // the fenced tag the parser keys on
    expect(out).toContain('{"value": "<exact option value>"}'); // value-form example
    expect(out).toContain("byte-match"); // the exactness instruction
    expect(out).toContain('{"value": "sqlite"}'); // a LITERAL option value as example
    expect(out).toContain('{"text"'); // write-in form also legitimate on choice
  });

  test("test_answer_protocol_text_form_only", () => {
    const out = buildSideChatSystemPrompt(TEXT_QUESTION, GOAL, DIGEST_QUESTIONS);
    expect(out).toContain("```answer");
    expect(out).toContain('{"text"'); // text form present
    expect(out).not.toContain('{"value"'); // NO value-form example on a text question
  });

  test("test_choice_has_options_block_text_gets_free_text_note", () => {
    const choice = buildSideChatSystemPrompt(CHOICE_QUESTION, GOAL, DIGEST_QUESTIONS);
    expect(choice).toContain("Options:");
    const text = buildSideChatSystemPrompt(TEXT_QUESTION, GOAL, DIGEST_QUESTIONS);
    expect(text).not.toContain("Options:");
    expect(text).toContain("free-text question");
    expect(text).toContain("the answer is the user's own words");
  });

  test("test_deterministic_two_calls_produce_identical_strings", () => {
    const a = buildSideChatSystemPrompt(CHOICE_QUESTION, GOAL, DIGEST_QUESTIONS);
    const b = buildSideChatSystemPrompt(CHOICE_QUESTION, GOAL, DIGEST_QUESTIONS);
    expect(a === b).toBe(true); // === identity, not just deep equality
    expect(a).toBe(b);
  });
});

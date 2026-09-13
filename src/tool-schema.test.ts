/**
 * src/tool-schema.test.ts — unit tests for interrogate schema, action
 * routing, and validation (P1.M1.T3.S1). Co-located vitest suite; pure layer
 * only — no state, no UI.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type InterrogatorConfig } from "./config.js";
import {
  InterrogateParams,
  OptionSchema,
  QuestionSchema,
  parseInterrogateParams,
  type ParseResult,
} from "./tool-schema.js";

function cfg(overrides: Partial<InterrogatorConfig["caps"]> = {}): InterrogatorConfig {
  return { ...DEFAULT_CONFIG, caps: { ...DEFAULT_CONFIG.caps, ...overrides } };
}

function choiceQ(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    prompt: `prompt:${id}`,
    type: "choice",
    options: [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ],
    ...overrides,
  };
}

/** Assert the happy-shape invariants every parse shares. */
function expectShape(r: ParseResult): void {
  expect(r).toHaveProperty("ok");
  expect(Array.isArray(r.errors)).toBe(true);
  expect(Array.isArray(r.warnings)).toBe(true);
}

// -------------------------------------------------------------------- schema

describe("schema exports", () => {
  it("exposes the h2.19 schema objects", () => {
    expect(OptionSchema).toBeDefined();
    expect(QuestionSchema).toBeDefined();
    expect(InterrogateParams).toBeDefined();
  });

  it("InterrogateParams declares all five h2.19 top-level properties", () => {
    const props = Object.keys((InterrogateParams as { properties: Record<string, unknown> }).properties);
    expect(props).toEqual(expect.arrayContaining(["goal", "epoch", "questions", "reopen", "answers"]));
  });

  it("QuestionSchema carries the optional rev pass-through field", () => {
    const props = Object.keys((QuestionSchema as { properties: Record<string, unknown> }).properties);
    expect(props).toContain("rev");
    expect((QuestionSchema as { properties: Record<string, unknown> }).properties.rev).toBeDefined();
  });
});

// ------------------------------------------------------------------- routing

describe("routing (h2.20 four action shapes)", () => {
  it("{} routes read with ok:true", () => {
    const r = parseInterrogateParams({}, cfg());
    expectShape(r);
    expect(r.ok).toBe(true);
    expect(r.action).toEqual({ action: "read" });
  });

  it("{questions: []} routes read (empty batch is not an upsert)", () => {
    const r = parseInterrogateParams({ questions: [] }, cfg());
    expect(r.ok).toBe(true);
    expect(r.action).toEqual({ action: "read" });
  });

  it("{reopen: true} routes reopen", () => {
    const r = parseInterrogateParams({ reopen: true }, cfg());
    expect(r.ok).toBe(true);
    expect(r.action).toEqual({ action: "reopen" });
  });

  it("{reopen: false} routes read", () => {
    const r = parseInterrogateParams({ reopen: false }, cfg());
    expect(r.action).toEqual({ action: "read" });
  });

  it("{answers: [...]} routes record with epoch passthrough", () => {
    const r = parseInterrogateParams(
      { answers: [{ id: "q1", value: "a" }], epoch: 7 },
      cfg(),
    );
    expect(r.ok).toBe(true);
    expect(r.action).toEqual({
      action: "record",
      epoch: 7,
      answers: [{ id: "q1", value: "a" }],
    });
  });

  it("{answers: []} routes read (empty answers is not a record)", () => {
    const r = parseInterrogateParams({ answers: [] }, cfg());
    expect(r.action).toEqual({ action: "read" });
  });

  it("{questions: [...], goal, epoch} routes upsert with full passthrough", () => {
    const r = parseInterrogateParams(
      { questions: [choiceQ("q1", { rev: 3 })], goal: "pick a db", epoch: 2 },
      cfg(),
    );
    expect(r.ok).toBe(true);
    expect(r.action).toEqual({
      action: "upsert",
      goal: "pick a db",
      epoch: 2,
      questions: [
        {
          id: "q1",
          prompt: "prompt:q1",
          type: "choice",
          rev: 3,
          options: [
            { value: "a", label: "Alpha" },
            { value: "b", label: "Beta" },
          ],
        },
      ],
    });
  });

  it("precedence: questions beat answers", () => {
    const r = parseInterrogateParams(
      { questions: [choiceQ("q1")], answers: [{ id: "q9", value: "a" }] },
      cfg(),
    );
    expect(r.action?.action).toBe("upsert");
  });

  it("precedence: answers beat reopen", () => {
    const r = parseInterrogateParams(
      { answers: [{ id: "q9", value: "a" }], reopen: true },
      cfg(),
    );
    expect(r.action?.action).toBe("record");
  });

  it("precedence: questions beat reopen", () => {
    const r = parseInterrogateParams({ questions: [choiceQ("q1")], reopen: true }, cfg());
    expect(r.action?.action).toBe("upsert");
  });

  it("goal without questions does not fabricate an upsert", () => {
    const r = parseInterrogateParams({ goal: "just reading" }, cfg());
    expect(r.action).toEqual({ action: "read" });
  });
});

// ---------------------------------------------------------------- validation

describe("question validation", () => {
  it("duplicate option values produce a structured error identifying the question id", () => {
    const r = parseInterrogateParams(
      {
        questions: [
          choiceQ("q1", {
            options: [
              { value: "a", label: "Alpha" },
              { value: "a", label: "Alpha again" },
            ],
          }),
        ],
      },
      cfg(),
    );
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].path).toBe("questions[0].options");
    expect(r.errors[0].message).toContain("duplicate option value");
    expect(r.errors[0].message).toContain('"q1"');
  });

  it("recommendation not matching any option value errors with the question id", () => {
    const r = parseInterrogateParams(
      { questions: [choiceQ("q1", { recommendation: "zzz" })] },
      cfg(),
    );
    expect(r.ok).toBe(false);
    expect(r.errors[0].path).toBe("questions[0].recommendation");
    expect(r.errors[0].message).toContain('"zzz"');
    expect(r.errors[0].message).toContain('"q1"');
  });

  it("recommendation matching an option value passes through", () => {
    const r = parseInterrogateParams(
      { questions: [choiceQ("q1", { recommendation: "b" })] },
      cfg(),
    );
    expect(r.ok).toBe(true);
    expect(r.action).toMatchObject({ action: "upsert" });
    expect((r.action as { questions: { recommendation?: string }[] }).questions[0].recommendation).toBe("b");
  });

  it("empty id errors at the question path", () => {
    const r = parseInterrogateParams({ questions: [choiceQ("")] }, cfg());
    expect(r.ok).toBe(false);
    expect(r.errors[0].path).toBe("questions[0].id");
    expect(r.errors[0].message).toContain("non-empty");
  });

  it("missing prompt errors with the offending id", () => {
    const r = parseInterrogateParams(
      { questions: [{ id: "q1", type: "choice", options: [{ value: "a", label: "A" }] }] },
      cfg(),
    );
    expect(r.ok).toBe(false);
    expect(r.errors[0].path).toBe("questions[0].prompt");
    expect(r.errors[0].message).toContain('"q1"');
  });

  it("type=choice without options errors", () => {
    const r = parseInterrogateParams(
      { questions: [{ id: "q1", prompt: "p", type: "choice" }] },
      cfg(),
    );
    expect(r.ok).toBe(false);
    expect(r.errors[0].path).toBe("questions[0].options");
    expect(r.errors[0].message).toContain("choice");
  });

  it("type=text without options is fine", () => {
    const r = parseInterrogateParams(
      { questions: [{ id: "q1", prompt: "p", type: "text" }] },
      cfg(),
    );
    expect(r.ok).toBe(true);
    expect(r.action).toMatchObject({ action: "upsert" });
  });

  it("type=text options are allowed but ignored (no error, not carried)", () => {
    const r = parseInterrogateParams(
      {
        questions: [
          {
            id: "q1",
            prompt: "p",
            type: "text",
            options: [{ value: "a", label: "A" }],
          },
        ],
      },
      cfg(),
    );
    expect(r.ok).toBe(true);
    const q = (r.action as { questions: { options?: unknown }[] }).questions[0];
    expect(q.options).toBeUndefined();
  });

  it("collects ALL errors across questions, not just the first failure", () => {
    const r = parseInterrogateParams(
      {
        questions: [
          choiceQ(""), // bad id
          choiceQ("q2", { recommendation: "nope" }), // bad recommendation
          choiceQ("q3", { type: "choice", options: [] }), // no options
        ],
      },
      cfg(),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBe(3);
    expect(r.errors.map((e) => e.path)).toEqual([
      "questions[0].id",
      "questions[1].recommendation",
      "questions[2].options",
    ]);
  });

  it("non-object question entries error at their index path", () => {
    const r = parseInterrogateParams({ questions: [null, choiceQ("q2")] }, cfg());
    expect(r.ok).toBe(false);
    expect(r.errors[0].path).toBe("questions[0]");
    expect(r.action).toMatchObject({ action: "upsert" });
    expect((r.action as { questions: unknown[] }).questions).toHaveLength(1);
  });

  it("wrong-typed optional fields are dropped with structured errors", () => {
    const r = parseInterrogateParams(
      { questions: [choiceQ("q1", { title: 42, gate: "yes", rev: "3" })] },
      cfg(),
    );
    expect(r.ok).toBe(false);
    const paths = r.errors.map((e) => e.path);
    expect(paths).toContain("questions[0].title");
    expect(paths).toContain("questions[0].gate");
    expect(paths).toContain("questions[0].rev");
  });

  it("wrong-typed top-level fields error at their own path", () => {
    const r = parseInterrogateParams({ goal: 42, epoch: "one", reopen: "yes" }, cfg());
    expect(r.ok).toBe(false);
    const paths = r.errors.map((e) => e.path);
    expect(paths).toEqual(["goal", "epoch", "reopen"]);
  });

  it("dependsOn entries require a non-empty id", () => {
    const r = parseInterrogateParams(
      { questions: [choiceQ("q1", { dependsOn: [{ equals: "a" }] })] },
      cfg(),
    );
    expect(r.ok).toBe(false);
    expect(r.errors[0].path).toBe("questions[0].dependsOn[0].id");
  });

  it("valid dependsOn passes through", () => {
    const r = parseInterrogateParams(
      { questions: [choiceQ("q2", { dependsOn: [{ id: "q1", equals: "a" }] })] },
      cfg(),
    );
    expect(r.ok).toBe(true);
    expect((r.action as { questions: { dependsOn?: unknown }[] }).questions[0].dependsOn).toEqual([
      { id: "q1", equals: "a" },
    ]);
  });
});

describe("answer validation (record action)", () => {
  it("answers require non-empty id and value", () => {
    const r = parseInterrogateParams({ answers: [{ id: "", value: "" }] }, cfg());
    expect(r.ok).toBe(false);
    const paths = r.errors.map((e) => e.path);
    expect(paths).toContain("answers[0].id");
    expect(paths).toContain("answers[0].value");
  });

  it("text elaboration passes through on answers", () => {
    const r = parseInterrogateParams(
      { answers: [{ id: "q1", value: "a", text: "because" }] },
      cfg(),
    );
    expect(r.ok).toBe(true);
    expect(r.action).toEqual({
      action: "record",
      answers: [{ id: "q1", value: "a", text: "because" }],
    });
  });
});

describe("malformed args (never throws)", () => {
  it("null / string / number / array args → ok:false, no action, structured error", () => {
    for (const bad of [null, "questions", 42, [], true]) {
      const r = parseInterrogateParams(bad, cfg());
      expectShape(r);
      expect(r.ok).toBe(false);
      expect(r.action).toBeUndefined();
      expect(r.errors.length).toBeGreaterThan(0);
    }
  });

  it("unknown extra keys are tolerated (open schema)", () => {
    const r = parseInterrogateParams({ questions: [choiceQ("q1")], futureField: { x: 1 } }, cfg());
    expect(r.ok).toBe(true);
    expect(r.action?.action).toBe("upsert");
  });
});

// ---------------------------------------------------------------------- caps

describe("question-count cap (h2.23 truncate, never reject)", () => {
  function batch(n: number): Record<string, unknown> {
    return {
      questions: Array.from({ length: n }, (_, i) => choiceQ(`q${i + 1}`)),
    };
  }

  it("50 questions with caps.questions: 40 → 40 kept + warning, still upsert, ok", () => {
    const r = parseInterrogateParams(batch(50), cfg({ questions: 40 }));
    expectShape(r);
    expect(r.ok).toBe(true);
    expect(r.action?.action).toBe("upsert");
    const qs = (r.action as { questions: { id: string }[] }).questions;
    expect(qs).toHaveLength(40);
    expect(r.warnings).toEqual(["questions truncated at 40 — restructure if essential"]);
  });

  it("keeps the FIRST N in agent-supplied order", () => {
    const r = parseInterrogateParams(batch(50), cfg({ questions: 40 }));
    const qs = (r.action as { questions: { id: string }[] }).questions;
    expect(qs[0].id).toBe("q1");
    expect(qs[39].id).toBe("q40");
  });

  it("exactly at the cap → no truncation, no warning", () => {
    const r = parseInterrogateParams(batch(40), cfg({ questions: 40 }));
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
    expect((r.action as { questions: unknown[] }).questions).toHaveLength(40);
  });

  it("never rejects even when truncated entries are malformed", () => {
    const questions: unknown[] = Array.from({ length: 50 }, (_, i) => choiceQ(`q${i + 1}`));
    questions.push(null); // beyond the cap — must not surface as an error
    const r = parseInterrogateParams({ questions }, cfg({ questions: 40 }));
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect((r.action as { questions: unknown[] }).questions).toHaveLength(40);
  });
});

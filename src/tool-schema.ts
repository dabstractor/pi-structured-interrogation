/**
 * src/tool-schema.ts — `interrogate` tool schema, action routing, and
 * validation (P1.M1.T3.S1). Pure layer: no state mutation, no UI, no pi
 * runtime imports.
 *
 * Every `interrogate` tool call enters through {@link parseInterrogateParams}:
 * the agent's raw JSON args are tolerantly narrowed against the h2.19 wire
 * schema, routed to one of four actions (h2.20), and reduced to a typed
 * {@link ParsedAction} the executor (P1.M1.T3.S4/S5) switch-cases on.
 *
 * Architectural boundaries (h2.13 spirit):
 * - This module imports `typebox` (schema definitions for S6 tool
 *   registration) and TYPE-ONLY imports from `./state.js` / `./config.js`.
 *   The state engine (`state.ts`/`merge.ts`) must never import typebox —
 *   validation-before-mutation keeps TypeBox concerns out of the store.
 * - NEVER throws on malformed input: every problem is collected as a
 *   structured `{path, message}` error so the tool-result layer (S4/S5) can
 *   format `isError` results.
 * - Stale rev/epoch guards are P1.M1.T3.S2 — this layer only PASSES THROUGH
 *   epoch/rev values. TUI-vs-non-TUI `answers` handling is the executor's
 *   (S5) decision — routing returns `record` regardless of mode.
 *
 * TypeBox v1.3.7 note (verified against node_modules): the bare `typebox`
 * package exports `Type` but NO `Static` type and NO top-level `Value` /
 * `Errors` / `TypeCompiler` runtime module — so per the PRD fallback rule,
 * runtime narrowing here is hand-rolled (the `state.ts` `reviveQuestion`
 * pattern) and `InterrogateParamsValue` is declared by hand to mirror the
 * schema exactly.
 */
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { InterrogatorConfig } from "./config.js";
import type { DependsOn, QuestionOption } from "./state.js";

// --------------------------------------------------------------------- schema

/**
 * One selectable option of a `type: "choice"` question (h2.19 as amended
 * by the 2026-09-15 deep-view quality pin: `label`/`ramification` now state
 * the standalone-reader contract — see spec/decisions.md).
 */
export const OptionSchema = Type.Object({
  value: Type.String({ description: "Option value returned when selected" }),
  label: Type.String({ description: "One-line short-view label; the detail belongs in ramification" }),
  ramification: Type.Optional(Type.String({ description: "Deep-view prose: standalone consequences of picking this option — what changes, effort, risk, trade-offs. Assume the reader sees ONLY this text: expand your reasoning, define terms, no shorthand/codewords, no 'as discussed'" })),
});

/**
 * One question of an `upsert` batch (h2.19 as amended by the 2026-09-15
 * deep-view quality pin — field descriptions define the expand-don't-
 * compress contract; see spec/decisions.md). `rev` is pass-through
 * only here: the parse layer never synthesizes or checks staleness (S2 owns
 * rev guards; `state.ts` forces rev 1 / status "open" for new ids).
 */
export const QuestionSchema = Type.Object({
  id: Type.String({ description: "Stable identity you choose; never reuse for a different question" }),
  title: Type.Optional(Type.String({ description: "Short label used in digests and overview" })),
  prompt: Type.String({ description: "Short-form question text shown by default" }),
  description: Type.Optional(Type.String({ description: "Deep-view context, fully standalone: assume the reader has NOT seen the conversation. Take the explanation you would normally give and EXPAND it — define terms/acronyms, state concrete facts, lay out the decision space — never compress to shorthand. First sentence doubles as the short-view hint" })),
  type: StringEnum(["choice", "text"]),
  options: Type.Optional(Type.Array(OptionSchema, { description: "Required for type=choice" })),
  recommendation: Type.Optional(Type.String({ description: "Recommended option value; marked ★ and preselected" })),
  group: Type.Optional(Type.String({ description: "Grouping label; groups render as sections" })),
  gate: Type.Optional(Type.Boolean({ description: "Mark this question's group as the foundational gate group" })),
  dependsOn: Type.Optional(Type.Array(Type.Object({
    id: Type.String({ description: "Question this one depends on" }),
    equals: Type.Optional(Type.String()),
    notEquals: Type.Optional(Type.String()),
  }), { description: "Moot conditions evaluated locally as the user answers" })),
  rev: Type.Optional(Type.Integer({ description: "REQUIRED when updating an existing question: the rev you last saw" })),
});

/**
 * `interrogate` tool parameters (h2.19 verbatim) — THE agent-facing contract
 * for this tool. Registered as the tool's `parameters` in P1.M1.T3.S6.
 *
 * ## The four action shapes (h2.20)
 *
 * Exactly ONE thing happens per call; routing precedence is
 * questions → answers → reopen → read:
 *
 * | args                              | action   | effect                                      |
 * |-----------------------------------|----------|---------------------------------------------|
 * | `{questions:[...], goal?, epoch?}` | upsert   | Create/update ONLY sent ids (patch)         |
 * | `{}`                               | read     | Return current panel state                  |
 * | `{reopen:true}`                    | reopen   | Resurface the panel with existing state     |
 * | `{answers:[...], epoch?}`          | record   | Record the user's chat answers              |
 *
 * - **upsert** — every entry of `questions` is a full {@link QuestionSchema}
 *   object. New ids are created; existing ids are replaced wholesale;
 *   OMITTED live ids are untouched (2026-09-15 patch-semantics pin) unless
 *   `withdrawOmitted: true` is sent (set-replace mode for deliberate pruning).
 *   Include `epoch` (the session
 *   epoch you last saw) and per-question `rev` when updating existing
 *   questions — stale values are rejected downstream by the guard layer.
 * - **read** — `{}` (or any args that name no action, including
 *   `{questions: []}`) returns the current state without mutating anything.
 * - **reopen** — `{reopen:true}` resurfaces the panel with existing state.
 * - **record** — `{answers:[...]}` records the user's chat answers. This is
 *   the NON-TUI fallback only; in a TUI session the executor ignores it
 *   (that decision belongs to P1.M1.T3.S5 — routing still returns `record`).
 *
 * ## Caps (h2.23 — truncate, never reject)
 *
 * Oversized batches are truncated to the configured cap (first N in
 * agent-supplied order) with a warning — NEVER a hard reject. This module
 * enforces the question-count cap (`config.caps.questions`, default 40) via
 * the warning `questions truncated at N — restructure if essential`;
 * remaining caps (description/ramification/options/goal lengths) are the
 * P1.M1.T3.S3 caps engine.
 */
export const InterrogateParams = Type.Object({
  goal: Type.Optional(Type.String({ description: "What these questions drive toward; shown in the panel header. Updatable: a goal sent on ANY upsert replaces the current one (capped at config caps.goal, default 400 chars)." })),
  epoch: Type.Optional(Type.Integer({ description: "Required when recording answers and when upserting questions that already exist (include the epoch from your last read/result); optional for a first upsert of brand-new questions (guards stale updates)." })),
  questions: Type.Optional(Type.Array(QuestionSchema, { description: "Upsert (surgical): only the ids sent are created or updated — omitted live questions are untouched. To prune by omission, resend the full live set with withdrawOmitted: true" })),
  withdrawOmitted: Type.Optional(Type.Boolean({ description: "Set-replace mode: live ids omitted from this batch withdraw (answers kept). Only meaningful alongside questions[]; omission alone NEVER withdraws" })),
  reopen: Type.Optional(Type.Boolean({ description: "Resurface the panel with existing state" })),
  answers: Type.Optional(Type.Array(Type.Object({
    id: Type.String(), value: Type.String(), text: Type.Optional(Type.String()),
    custom: Type.Optional(Type.Boolean({ description: "WRITEIN-001: marks a write-in — value holds the user's free text (not an option value); renders as ✎ {text}" })),
  }), { description: "Non-TUI fallback only: record the user's chat answers" })),
});

// -------------------------------------------------------------- static types

/**
 * Wire-shaped question as accepted by `interrogate` — the {@link QuestionSchema}
 * projection. Identical to `state.ts`'s `Question` minus the store-owned
 * `status` and with `rev` optional (pass-through; the store synthesizes it).
 */
export interface QuestionInput {
  /** Stable identity chosen by the agent; never reused for a different question. */
  id: string;
  /** Short label used in digests and overview. */
  title?: string;
  /** Short-form question text shown by default. */
  prompt: string;
  /** Deep-view context, fully standalone — expand, never compress (see schema field description). */
  description?: string;
  /** `"choice"` requires non-empty `options`; `"text"` ignores them. */
  type: "choice" | "text";
  /** Required for type=choice. */
  options?: QuestionOption[];
  /** Recommended option value; must equal one option `value` for choice questions. */
  recommendation?: string;
  /** Grouping label; groups render as sections. */
  group?: string;
  /** Mark this question's group as the foundational gate group. */
  gate?: boolean;
  /** Moot conditions evaluated locally as the user answers. */
  dependsOn?: DependsOn[];
  /** Pass-through only — the rev the agent last saw (guards are S2's job). */
  rev?: number;
}

/** Wire-shaped answer entry ({@link InterrogateParams} `answers` items). */
export interface AnswerInput {
  /** Question id this answer belongs to. */
  id: string;
  /** Chosen option value (choice) or raw text (text questions). */
  value: string;
  /** Free-text elaboration attached to the answer. */
  text?: string;
  /** WRITEIN-001: value holds free text, not an option value; renders as ✎ {text}. */
  custom?: boolean;
}

/**
 * The h2.19 wire value shape, declared by hand (bare `typebox@1.3.7` has no
 * `Static` export — see module docblock). The raw `unknown` args handed to
 * {@link parseInterrogateParams} are narrowed toward this shape.
 */
export interface InterrogateParamsValue {
  /** What these questions drive toward; shown in the panel header. */
  goal?: string;
  /** Session epoch the agent last saw (guards stale updates downstream). */
  epoch?: number;
  /** Upsert batch — non-empty array routes to `upsert`. */
  questions?: QuestionInput[];
  /** Set-replace mode: omitted live ids withdraw (default false — patch semantics). */
  withdrawOmitted?: boolean;
  /** Resurface the panel with existing state. */
  reopen?: boolean;
  /** Non-TUI answer recording — non-empty array routes to `record`. */
  answers?: AnswerInput[];
}

/**
 * h2.20 discriminator — consumed by P1.M1.T3.S2–S5 and the P1.M2.T3.S1 debug
 * commands. Routing precedence: non-empty `questions` → `upsert`; else
 * non-empty `answers` → `record`; else `reopen === true` → `reopen`; else
 * `read` (includes `{}` and `{questions: []}`).
 */
export type ParsedAction =
  | { action: "upsert"; questions: QuestionInput[]; withdrawOmitted?: boolean; goal?: string; epoch?: number }
  | { action: "read" }
  | { action: "reopen" }
  | { action: "record"; epoch?: number; answers: AnswerInput[] };

/** Outcome of {@link parseInterrogateParams}. */
export interface ParseResult {
  /** `true` iff zero structured errors were collected (warnings don't affect ok). */
  ok: boolean;
  /**
   * The routed action. Always present when `args` is a JSON object (routing
   * is deterministic from presence); `undefined` only when `args` itself is
   * not an object. May accompany `ok: false` — executors format the errors.
   */
  action?: ParsedAction;
  /**
   * Structured validation problems, never thrown: e.g.
   * `[{ path: "questions[2].options", message: "duplicate option value \"x\"" }]`.
   */
  errors: { path: string; message: string }[];
  /** Non-fatal notices, e.g. the h2.23 question-count truncation warning. */
  warnings: string[];
}

// -------------------------------------------------------------------- guards

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Collects `{path, message}` problems during narrowing — never throws. */
type ErrorSink = { path: string; message: string }[];

// ------------------------------------------------------------------ parsing

/**
 * Validate + route raw `interrogate` args (P1.M1.T3.S1). Pure: no state
 * mutation, no UI, no throws — malformed input becomes structured errors.
 *
 * Routing precedence (h2.20): non-empty `questions` → `upsert`; else
 * non-empty `answers` → `record`; else `reopen === true` → `reopen`; else
 * `read` (`{}` and `{questions: []}` both read).
 *
 * Validation (per-question, ALL problems collected — not first-fail):
 * - non-empty `id` and `prompt`
 * - `type: "choice"` requires non-empty `options` with unique `value`s
 * - `recommendation` (when present on a choice question) must equal one
 *   option `value`
 * - `type: "text"` never requires options (present options are ignored)
 *
 * Caps: `questions.length > config.caps.questions` keeps the FIRST
 * `caps.questions` questions (stable agent-supplied order) and appends the
 * warning `questions truncated at N — restructure if essential` — never a
 * hard reject (h2.23).
 *
 * Non-goals (owned elsewhere): rev/epoch staleness guards (S2), the full
 * caps engine for description/ramification/options/goal (S3), executor
 * isError formatting (S4/S5), and the answers-in-TUI ignore decision (S5 —
 * routing returns `record` regardless of mode).
 *
 * @param args Raw tool-call arguments (untrusted JSON).
 * @param config Resolved interrogator config (only `caps.questions` read).
 */
export function parseInterrogateParams(args: unknown, config: InterrogatorConfig): ParseResult {
  const errors: ErrorSink = [];
  const warnings: string[] = [];

  if (!isObj(args)) {
    return {
      ok: false,
      errors: [{ path: "args", message: "interrogate params must be a JSON object" }],
      warnings,
    };
  }

  // -- top-level scalars (tolerant: wrong type → structured error, dropped)
  let goal: string | undefined;
  if (args.goal !== undefined) {
    if (typeof args.goal === "string") goal = args.goal;
    else errors.push({ path: "goal", message: "goal must be a string" });
  }

  let epoch: number | undefined;
  if (args.epoch !== undefined) {
    if (typeof args.epoch === "number" && Number.isInteger(args.epoch)) epoch = args.epoch;
    else errors.push({ path: "epoch", message: "epoch must be an integer" });
  }

  let reopen = false;
  if (args.reopen !== undefined) {
    if (typeof args.reopen === "boolean") reopen = args.reopen;
    else errors.push({ path: "reopen", message: "reopen must be a boolean" });
  }

  let withdrawOmitted = false;
  if (args.withdrawOmitted !== undefined) {
    if (typeof args.withdrawOmitted === "boolean") withdrawOmitted = args.withdrawOmitted;
    else errors.push({ path: "withdrawOmitted", message: "withdrawOmitted must be a boolean" });
  }

  // -- questions (truncate FIRST at the cap, then validate what survives —
  //    errors on dropped entries would be noise)
  let questions: QuestionInput[] | undefined;
  if (args.questions !== undefined) {
    if (Array.isArray(args.questions)) {
      let incoming: unknown[] = args.questions;
      if (incoming.length > config.caps.questions) {
        warnings.push(`questions truncated at ${config.caps.questions} — restructure if essential`);
        incoming = incoming.slice(0, config.caps.questions);
      }
      questions = [];
      for (let i = 0; i < incoming.length; i++) {
        const q = narrowQuestion(incoming[i], `questions[${i}]`, errors);
        if (q !== undefined) questions.push(q);
      }
    } else {
      errors.push({ path: "questions", message: "questions must be an array" });
    }
  }

  // -- answers (light structural validation only; matching against stored
  //    questions happens in the executor/merge layers)
  let answers: AnswerInput[] | undefined;
  if (args.answers !== undefined) {
    if (Array.isArray(args.answers)) {
      answers = [];
      for (let i = 0; i < args.answers.length; i++) {
        const a = narrowAnswer(args.answers[i], `answers[${i}]`, errors);
        if (a !== undefined) answers.push(a);
      }
    } else {
      errors.push({ path: "answers", message: "answers must be an array" });
    }
  }

  // -- deterministic routing (h2.20 precedence)
  let action: ParsedAction;
  if (questions !== undefined && questions.length > 0) {
    action = { action: "upsert", questions, withdrawOmitted };
    if (goal !== undefined) action.goal = goal;
    if (epoch !== undefined) action.epoch = epoch;
  } else if (answers !== undefined && answers.length > 0) {
    action = { action: "record", answers };
    if (epoch !== undefined) action.epoch = epoch;
  } else if (reopen) {
    action = { action: "reopen" };
  } else {
    action = { action: "read" };
  }

  return { ok: errors.length === 0, action, errors, warnings };
}

// ------------------------------------------------------------------ helpers

/**
 * Tolerantly narrow one question entry (the `state.ts` `reviveQuestion`
 * pattern). Valid parts are kept; invalid parts are dropped with a structured
 * error tagged with the entry's index path AND, where applicable, its id —
 * so error messages can identify the offending question even when the path
 * index alone wouldn't.
 */
function narrowQuestion(raw: unknown, path: string, errors: ErrorSink): QuestionInput | undefined {
  if (!isObj(raw)) {
    errors.push({ path, message: "question must be an object" });
    return undefined;
  }

  const id = typeof raw.id === "string" ? raw.id : "";
  if (id.trim() === "") errors.push({ path: `${path}.id`, message: `id must be a non-empty string (got ${JSON.stringify(raw.id ?? null)})` });

  const prompt = typeof raw.prompt === "string" ? raw.prompt : "";
  if (prompt.trim() === "") errors.push({ path: `${path}.prompt`, message: `prompt must be a non-empty string (question ${JSON.stringify(id)})` });

  const isChoice = raw.type === "choice";
  const isText = raw.type === "text";
  if (!isChoice && !isText) {
    errors.push({ path: `${path}.type`, message: `type must be "choice" or "text" (question ${JSON.stringify(id)})` });
  }

  const q: QuestionInput = { id, prompt, type: isText ? "text" : "choice" };

  // optional string fields
  const stringFields = ["title", "description", "group"] as const;
  for (const field of stringFields) {
    const v = raw[field];
    if (v === undefined) continue;
    if (typeof v === "string") q[field] = v;
    else errors.push({ path: `${path}.${field}`, message: `${field} must be a string (question ${JSON.stringify(id)})` });
  }

  if (raw.gate !== undefined) {
    if (typeof raw.gate === "boolean") q.gate = raw.gate;
    else errors.push({ path: `${path}.gate`, message: `gate must be a boolean (question ${JSON.stringify(id)})` });
  }

  if (raw.rev !== undefined) {
    if (typeof raw.rev === "number" && Number.isInteger(raw.rev)) q.rev = raw.rev;
    else errors.push({ path: `${path}.rev`, message: `rev must be an integer (question ${JSON.stringify(id)})` });
  }

  if (raw.dependsOn !== undefined) {
    if (Array.isArray(raw.dependsOn)) {
      const dependsOn: DependsOn[] = [];
      for (let i = 0; i < raw.dependsOn.length; i++) {
        const dep = raw.dependsOn[i];
        const depPath = `${path}.dependsOn[${i}]`;
        if (!isObj(dep)) {
          errors.push({ path: depPath, message: `dependsOn entry must be an object (question ${JSON.stringify(id)})` });
          continue;
        }
        if (typeof dep.id !== "string" || dep.id.trim() === "") {
          errors.push({ path: `${depPath}.id`, message: `dependsOn id must be a non-empty string (question ${JSON.stringify(id)})` });
          continue;
        }
        const narrowed: DependsOn = { id: dep.id };
        if (dep.equals !== undefined) {
          if (typeof dep.equals === "string") narrowed.equals = dep.equals;
          else errors.push({ path: `${depPath}.equals`, message: `equals must be a string (question ${JSON.stringify(id)})` });
        }
        if (dep.notEquals !== undefined) {
          if (typeof dep.notEquals === "string") narrowed.notEquals = dep.notEquals;
          else errors.push({ path: `${depPath}.notEquals`, message: `notEquals must be a string (question ${JSON.stringify(id)})` });
        }
        dependsOn.push(narrowed);
      }
      if (dependsOn.length > 0) q.dependsOn = dependsOn;
    } else {
      errors.push({ path: `${path}.dependsOn`, message: `dependsOn must be an array (question ${JSON.stringify(id)})` });
    }
  }

  // options — required (non-empty, unique values) for choice; allowed but
  // IGNORED for text (h2.19/h2.20: text questions carry no options)
  let optionValues: string[] | undefined;
  if (raw.options !== undefined) {
    if (Array.isArray(raw.options)) {
      const options: QuestionOption[] = [];
      const seen = new Set<string>();
      let duplicate = false;
      for (let i = 0; i < raw.options.length; i++) {
        const opt = raw.options[i];
        const optPath = `${path}.options[${i}]`;
        if (!isObj(opt)) {
          errors.push({ path: optPath, message: `option must be an object (question ${JSON.stringify(id)})` });
          continue;
        }
        if (typeof opt.value !== "string" || opt.value.trim() === "") {
          errors.push({ path: `${optPath}.value`, message: `option value must be a non-empty string (question ${JSON.stringify(id)})` });
          continue;
        }
        if (typeof opt.label !== "string") {
          errors.push({ path: `${optPath}.label`, message: `option label must be a string (question ${JSON.stringify(id)})` });
          continue;
        }
        const option: QuestionOption = { value: opt.value, label: opt.label };
        if (opt.ramification !== undefined) {
          if (typeof opt.ramification === "string") option.ramification = opt.ramification;
          else errors.push({ path: `${optPath}.ramification`, message: `ramification must be a string (question ${JSON.stringify(id)})` });
        }
        if (seen.has(opt.value)) {
          duplicate = true;
          errors.push({ path: `${path}.options`, message: `duplicate option value ${JSON.stringify(opt.value)} (question ${JSON.stringify(id)})` });
        }
        seen.add(opt.value);
        options.push(option);
      }
      if (isChoice) {
        if (options.length === 0) {
          errors.push({ path: `${path}.options`, message: `type "choice" requires at least one option (question ${JSON.stringify(id)})` });
        } else if (duplicate) {
          // errors already pushed above with the offending values
        }
        optionValues = options.map((o) => o.value);
        if (options.length > 0) q.options = options;
      }
      // text questions: options dropped silently (ignored by contract)
    } else {
      errors.push({ path: `${path}.options`, message: `options must be an array (question ${JSON.stringify(id)})` });
    }
  } else if (isChoice) {
    errors.push({ path: `${path}.options`, message: `type "choice" requires at least one option (question ${JSON.stringify(id)})` });
  }

  if (raw.recommendation !== undefined) {
    if (typeof raw.recommendation === "string") {
      if (isChoice && optionValues !== undefined && !optionValues.includes(raw.recommendation)) {
        errors.push({
          path: `${path}.recommendation`,
          message: `recommendation ${JSON.stringify(raw.recommendation)} does not match any option value (question ${JSON.stringify(id)})`,
        });
      } else {
        q.recommendation = raw.recommendation;
      }
    } else {
      errors.push({ path: `${path}.recommendation`, message: `recommendation must be a string (question ${JSON.stringify(id)})` });
    }
  }

  return q;
}

/** Tolerantly narrow one answer entry. */
function narrowAnswer(raw: unknown, path: string, errors: ErrorSink): AnswerInput | undefined {
  if (!isObj(raw)) {
    errors.push({ path, message: "answer must be an object" });
    return undefined;
  }
  if (typeof raw.id !== "string" || raw.id.trim() === "") {
    errors.push({ path: `${path}.id`, message: `answer id must be a non-empty string (got ${JSON.stringify(raw.id ?? null)})` });
  }
  if (typeof raw.value !== "string" || raw.value.trim() === "") {
    errors.push({ path: `${path}.value`, message: `answer value must be a non-empty string (got ${JSON.stringify(raw.value ?? null)})` });
  }
  const a: AnswerInput = {
    id: typeof raw.id === "string" ? raw.id : "",
    value: typeof raw.value === "string" ? raw.value : "",
  };
  if (raw.text !== undefined) {
    if (typeof raw.text === "string") a.text = raw.text;
    else errors.push({ path: `${path}.text`, message: "text must be a string" });
  }
  if (raw.custom !== undefined) {
    if (typeof raw.custom === "boolean") a.custom = raw.custom;
    else errors.push({ path: `${path}.custom`, message: "custom must be a boolean" });
  }
  return a;
}

/**
 * pi-interrogator — soft-cap engine (P1.M1.T3.S3).
 *
 * Pure implementation of PRD h2.23: over-budget question/goal content is
 * TRUNCATED WITH A WARNING, never rejected ("q7 description truncated at
 * 2100 chars — restructure if essential"). The model sees exactly what was
 * cut and why, and restructures on its next turn instead of stalling on a
 * hard error. The 2026-09-15 deep-view quality pin adds warn-only MINIMUM
 * floors on the same self-heal pattern (see {@link applyCaps} step 6): thin
 * deep-view text warns and the model re-upserts it expanded.
 *
 * Purity contract: no I/O, no events, no pi imports, no module state, never
 * throws. Inputs are deep-copied (structuredClone) — the caller's array and
 * question objects stay pristine. Whether warnings reach the tool result is
 * the CONSUMER's policy: the upsert executor (P1.M1.T3.S4) always appends
 * them to the tool result (h2.23 — truncate WITH a warning, never a hard
 * reject); applyCaps always reports.
 *
 * Consumers:
 *   - tool.ts upsert executor (P1.M1.T3.S4)  → applyCaps(parsed.questions, parsed.goal ?? "", config, ctx.model.contextWindow)
 *   - debug commands (P1.M2.T3.S1)           → applyCaps for scripted cap verification
 */

import type { CapsConfig, InterrogatorConfig } from "./config.js";
import type { QuestionInput } from "./tool-schema.js";

/**
 * Approximate characters per token — converts the model's token-based
 * context window into a character budget (h2.23). Exported because it IS
 * part of the formula.
 */
export const CHARS_PER_TOKEN = 4;

/**
 * Hard ceiling (characters) on the total description budget regardless of
 * how large the context window is (h2.23). Exported because it IS part of
 * the formula.
 */
export const DESCRIPTION_BUDGET_CEILING = 60000;

/** What {@link applyCaps} returns: capped copies plus every warning raised (truncations, drops, and minimum-floor lints). */
export interface CapsResult {
  /** Deep-copied, capped questions — safe to hand straight to merge.upsert. */
  questions: QuestionInput[];
  /** The goal, truncated to `caps.goal` if it was over budget. */
  goal: string;
  /** Human-readable warning for EVERY truncation/drop, in application order. */
  warnings: string[];
}

/**
 * Per-question description cap (h2.23 formula), in characters:
 *
 *   totalDescriptionBudget = min(caps.contextBudgetPct / 100 × contextWindow × CHARS_PER_TOKEN, DESCRIPTION_BUDGET_CEILING)
 *   perQuestionBudget      = floor(totalDescriptionBudget / max(questionCount, 1))
 *   cap                    = max(caps.description, perQuestionBudget)
 *
 * With defaults (contextBudgetPct 4, description 1200): a 128k-token window
 * budgets 20480 chars → 512/question @ 40 questions → the 1200 default wins;
 * a 1M-token window hits the 60000-char ceiling → 1500/question @ 40 → the
 * cap RISES to 1500. `questionCount` must be the INPUT batch size — computed
 * BEFORE question-count truncation, because the budget was sized for the
 * batch the model intended (h2.23: "divided across the batch").
 *
 * Config override: `interrogator.caps.contextBudgetPct` and
 * `interrogator.caps.description` in settings.json (either scope).
 *
 * @param caps The coerced `config.caps`.
 * @param contextWindow The model's context window in TOKENS.
 * @param questionCount Number of questions in the INPUT batch (never less than 1 is used for the division).
 * @returns The effective description cap in characters.
 */
export function descriptionCap(caps: CapsConfig, contextWindow: number, questionCount: number): number {
  const totalDescriptionBudget = Math.min(
    (caps.contextBudgetPct / 100) * contextWindow * CHARS_PER_TOKEN,
    DESCRIPTION_BUDGET_CEILING,
  );
  const perQuestionBudget = Math.floor(totalDescriptionBudget / Math.max(questionCount, 1));
  return Math.max(caps.description, perQuestionBudget);
}

/**
 * Apply every soft cap to an upsert batch. Truncates over-budget content
 * with an explicit warning — NEVER rejects (soft caps only, h2.23) and
 * never throws on malformed/absent optional fields (they are skipped).
 *
 * ## Caps applied, in order
 * 1. **questions** — keep the FIRST `caps.questions` in input order; one
 *    batch-level warning if anything was dropped. Description caps still use
 *    the ORIGINAL input count (the budget was sized for the intended batch).
 * 2. **description** — per question, truncate to {@link descriptionCap}'s
 *    cap (plain `.slice`, no ellipsis — the warning carries the signal).
 * 3. **ramification** — each option's `ramification` ≤ `caps.ramification`
 *    (applied to all options present, before the options keep, per h2.23 §
 *    order — a subsequently-dropped option may still produce this warning).
 * 4. **options** — keep the FIRST `caps.options`, then re-append the option
 *    whose `value === question.recommendation` if it was cut, so the
 *    recommendation always names a surviving option. `recommendation` itself
 *    is left untouched.
 * 5. **goal** — truncate to `caps.goal`.
 * 6. **minimums (2026-09-15 deep-view quality lint)** — warn (NEVER mutate,
 *    never reject) when a deep-view field is thinner than its floor: a
 *    provided description < `caps.minDescription`, an option ramification
 *    < `caps.minRamification`, or an option with NO ramification at all.
 *    Floors of 0 disable each lint. Checked against the FINAL stored text
 *    (post-truncation) so an over-cap shorthand dump still lints. The warning
 *    text tells the model to re-upsert expanded — the same self-heal path as
 *    truncation warnings (h2.23).
 *
 * ## Exact warning formats
 * - `questions truncated to ${caps.questions} — ${droppedCount} dropped`
 * - `${id} description truncated at ${originalLength} chars — restructure if essential`
 * - `${id} ramification truncated at ${originalLength} chars`
 * - `${id} options truncated to ${keptCount} (recommendation preserved)`
 * - `goal truncated at ${originalLength} chars`
 * - `${id} description is only ${n} chars — deep view must stand alone; expand and re-upsert with the current rev`
 * - `${id} option ${value} ramification is only ${n} chars — expand to standalone consequences and re-upsert`
 * - `${id} option ${value} has no ramification — give every option standalone consequences and re-upsert`
 *
 * Absent or already-under-cap fields pass silently (no warning).
 *
 * ## Config overrides (settings.json, global or project scope)
 * ```json
 * { "interrogator": { "caps": {
 *     "description": 1200, "ramification": 600, "options": 7,
 *     "questions": 40, "goal": 400, "contextBudgetPct": 4 } } }
 * ```
 *
 * ## Purity & warnings policy
 * Returns NEW objects (deep-copied via structuredClone); the caller's
 * questions are never mutated. Warnings are ALWAYS returned — applyCaps
 * knows no suppression toggle, and they always reach the tool result (h2.23's
 * warning is unconditional: the model must see what was cut to self-correct).
 * `config.gateWarnings` gates only the FR-9 panel submit warning, never
 * tool-result content; do not re-derive any suppression policy here.
 *
 * @param questions `QuestionInput[]` from the parsed upsert action (pass `parsed.questions`).
 * @param goal The goal string from the same action.
 * @param config Resolved {@link InterrogatorConfig} from src/config.ts (already coerced — no defensive parsing here).
 * @param contextWindow The model's context window in TOKENS (`ctx.model.contextWindow`), read by the executor and passed as a plain number.
 * @returns Capped copies of the batch plus every warning, in application order.
 */
export function applyCaps(
  questions: QuestionInput[],
  goal: string,
  config: InterrogatorConfig,
  contextWindow: number,
): CapsResult {
  const warnings: string[] = [];
  const inputCount = questions.length;

  // Budget is computed for the batch the model INTENDED — the INPUT count,
  // before question-count truncation (h2.23: "divided across the batch").
  const descCap = descriptionCap(config.caps, contextWindow, inputCount);

  // Deep-copy BEFORE any mutation so the caller's objects stay pristine.
  const kept = structuredClone(questions).slice(0, config.caps.questions);

  // 1. Questions cap — batch-level warning, no id prefix.
  if (inputCount > config.caps.questions) {
    const droppedCount = inputCount - config.caps.questions;
    warnings.push(`questions truncated to ${config.caps.questions} — ${droppedCount} dropped`);
  }

  for (const q of kept) {
    // 2. Description cap — plain slice; the warning carries the meaning.
    if (typeof q.description === "string" && q.description.length > descCap) {
      const originalLength = q.description.length;
      q.description = q.description.slice(0, descCap);
      warnings.push(`${q.id} description truncated at ${originalLength} chars — restructure if essential`);
    }

    // 3. Ramification cap — each option present, before the options keep.
    if (Array.isArray(q.options)) {
      for (const option of q.options) {
        if (typeof option?.ramification === "string" && option.ramification.length > config.caps.ramification) {
          const originalLength = option.ramification.length;
          option.ramification = option.ramification.slice(0, config.caps.ramification);
          warnings.push(`${q.id} ramification truncated at ${originalLength} chars`);
        }
      }
    }

    // 4. Options cap — keep-first-N, recommendation re-appended if cut.
    if (Array.isArray(q.options) && q.options.length > config.caps.options) {
      const head = q.options.slice(0, config.caps.options);
      if (typeof q.recommendation === "string") {
        const recommended = q.options.find((option) => option?.value === q.recommendation);
        if (recommended && !head.includes(recommended)) head.push(recommended);
      }
      q.options = head;
      warnings.push(`${q.id} options truncated to ${q.options.length} (recommendation preserved)`);
    }
  }

  // 5. Goal cap — last, per h2.23 § order.
  let cappedGoal = goal;
  if (goal.length > config.caps.goal) {
    const originalLength = goal.length;
    cappedGoal = goal.slice(0, config.caps.goal);
    warnings.push(`goal truncated at ${originalLength} chars`);
  }

  // 6. Minimums — 2026-09-15 deep-view quality lint. Warn-only: fields are
  //    never padded or rejected (a floor that MUTATES would manufacture fake
  //    detail; a floor that REJECTS would stall the batch — both worse than
  //    the warning + re-upsert self-heal loop this package already uses for
  //    over-cap content). Missing descriptions do NOT lint (a question can be
  //    self-evident from its prompt alone) but a missing ramification on an
  //    option DOES: every answer choice must carry its own standalone
  //    explanation — that is the deep view's core guarantee.
  for (const q of kept) {
    if (config.caps.minDescription > 0 && typeof q.description === "string" && q.description.length < config.caps.minDescription) {
      warnings.push(
        `${q.id} description is only ${q.description.length} chars — deep view must stand alone; expand and re-upsert with the current rev`,
      );
    }

    if (Array.isArray(q.options)) {
      for (const option of q.options) {
        const r = typeof option?.ramification === "string" ? option.ramification : "";
        if (config.caps.minRamification === 0) continue;
        if (r.length === 0) {
          warnings.push(
            `${q.id} option ${option.value} has no ramification — give every option standalone consequences and re-upsert`,
          );
        } else if (r.length < config.caps.minRamification) {
          warnings.push(
            `${q.id} option ${option.value} ramification is only ${r.length} chars — expand to standalone consequences and re-upsert`,
          );
        }
      }
    }
  }

  return { questions: kept, goal: cappedGoal, warnings };
}

/**
 * src/fallback.ts — Non-TUI fallback digest + chat-answer recording
 * (P1.M1.T3.S5; h2.26 / h3.3 FR-25 / h2.20).
 *
 * In non-TUI sessions (`ctx.mode !== "tui" || !ctx.hasUI` — modes
 * `tui|rpc|json|print` per plan/001_0d6760db6bc5/architecture/pi-api-validation.md:54;
 * `hasUI` is false in print/json) there is no panel to render questions. The
 * `interrogate` tool degrades to a pure chat-based flow:
 *
 * 1. An upsert result carries a numbered markdown digest (h2.26) the model
 *    relays verbatim in chat — {@link buildFallbackDigest}.
 * 2. The user answers in their next prompt; the model records those answers
 *    via `{answers:[...]}` — {@link recordAnswers} (h2.20: returns the shared
 *    status line; non-TUI only).
 * 3. Read and completion behave identically to TUI (S4's `buildReadResult` is
 *    mode-agnostic; completion injection is P1.M2.T2.S2) — nothing here.
 *
 * DIVISION OF LABOR (do NOT grow this module into the executor):
 * - Result assembly (status line + digest + caps warnings; the record
 *   `InterrogateResult` envelope with `action: "record"`) is S6's job — this
 *   module returns strings and data only.
 * - The TUI "ignore `{answers:[...]}`" decision (h2.20) is the executor's
 *   routing decision (S6), never made here — routing in tool-schema.ts
 *   returns `record` in ALL modes.
 * - The epoch guard is NOT applied here: the executor (S6) runs
 *   `assertFresh(state, parsed)` (guards.ts) BEFORE calling
 *   {@link recordAnswers}; a `StaleError` propagates out of `execute` so pi
 *   sets `isError` (pi-api-validation.md:21). This module must not re-guard —
 *   double epoch semantics would break healing flows.
 *
 * Pure data layer per h2.13: no pi imports, no UI references, no events
 * emitted from this module (state mutations emit through state.ts).
 */
import { takeSnapshot } from "./snapshots.js";
import type {
  InterrogationState,
  Question,
  QuestionAnswer,
  QuestionOption,
  SerializedState,
} from "./state.js";
import type { AnswerInput } from "./tool-schema.js";

/** Final digest line, verbatim (h2.26: "the description instructs the model to relay it verbatim in chat"). */
export const RELAY_INSTRUCTION =
  "Relay this digest verbatim to the user in chat; they will answer in their next message.";

/**
 * h2.26 guard predicate (pi-api-validation.md:54): the fallback flow applies
 * whenever there is no interactive panel — any non-`tui` mode (rpc/json/
 * print) OR a `tui` session whose `ctx.hasUI` is false.
 *
 * The executor (S6) switches on this to pick digest-vs-upsert-result for
 * upserts, and to IGNORE `{answers:[...]}` in TUI sessions (h2.20) while
 * recording in non-TUI.
 */
export function isNonTui(mode: string, hasUI: boolean): boolean {
  return mode !== "tui" || !hasUI;
}

/**
 * Maximum prompt characters used as the display title when `question.title`
 * is absent (h2.26 digest heading field: `{title ?? prompt-truncated-60}`).
 */
const TITLE_FALLBACK_LIMIT = 60;

/**
 * Statuses excluded from the digest — nothing left to ask (h2.26).
 * `answered`/`submitted`/`reasked`/`open` DO render: the model re-relays on
 * re-ask, and already-answered questions stay visible for context.
 */
const DIGEST_SKIP_STATUSES: ReadonlySet<Question["status"]> = new Set([
  "withdrawn",
  "moot",
  "closed",
]);

/**
 * FR-25 numbered markdown digest (h2.26) — the exact format the model relays
 * verbatim in non-TUI sessions.
 *
 * Format spec (Mode A):
 *
 * ```
 * INTERROGATION — {goal} (epoch {n})
 * ```
 * The ` — {goal}` segment is omitted when `goal === ""` (header collapses to
 * `INTERROGATION (epoch {n})` so the epoch is always shown). One blank line
 * follows the header.
 *
 * Then one block per rendered question, numbered 1..n positionally over
 * `state.order` — the numbering counts RENDERED questions only (withdrawn /
 * moot / closed are skipped, so ids stay contiguous 1..n):
 *
 * ```
 * **{n}. {title ?? prompt-truncated-60}** (`{id}`)
 * {prompt}
 * 1) {label} (`{value}`)[ ★]
 * 2) …
 * Recommendation: {label of the option whose value === recommendation}
 * ```
 *
 * - The heading falls back to the first {@link TITLE_FALLBACK_LIMIT}
 *   characters of the prompt when `title` is absent (no ellipsis added).
 * - Option ordinals are 1-based `1) 2) …` so the user can answer "1.2" or by
 *   value; the digest is agent-relayed text and is never parsed back.
 * - `★` (U+2605 BLACK STAR, single leading space — the same mark the panel
 *   uses, h2.33/Q15) marks the option whose `value === question.recommendation`.
 * - The `Recommendation:` line renders the matching option's LABEL (raw
 *   recommendation value as fallback) and is omitted when the question has
 *   no recommendation.
 * - `type: "text"` questions render heading + prompt only (no option list,
 *   no recommendation line).
 * - Question blocks are separated by one blank line.
 *
 * The digest ends with the exact relay sentence:
 * `Relay this digest verbatim to the user in chat; they will answer in their next message.`
 *
 * Pure: input is a `SerializedState` (as produced by `state.serialize()`),
 * nothing is mutated, no events are emitted, and the output is a plain
 * string for the executor (S6) to wrap with the status line + caps warnings.
 */
export function buildFallbackDigest(state: SerializedState): string {
  const lines: string[] = [];
  lines.push(state.goal === "" ? `INTERROGATION (epoch ${state.epoch})` : `INTERROGATION — ${state.goal} (epoch ${state.epoch})`);

  let number = 0;
  for (const id of state.order) {
    const q = state.questions[id];
    if (q === undefined) continue; // orphan id (tolerant reconstruction) — skip
    if (DIGEST_SKIP_STATUSES.has(q.status)) continue;
    number++;

    lines.push("");
    lines.push(`**${number}. ${q.title ?? truncate(q.prompt, TITLE_FALLBACK_LIMIT)}** (\`${q.id}\`)`);
    lines.push(q.prompt);

    if (q.type === "choice" && q.options !== undefined) {
      let ordinal = 0;
      for (const option of q.options) {
        ordinal++;
        lines.push(optionLine(q, option, ordinal));
      }
    }
    if (q.recommendation !== undefined) {
      const label = q.options?.find((o) => o.value === q.recommendation)?.label ?? q.recommendation;
      lines.push(`Recommendation: ${label}`);
    }
  }

  lines.push("");
  lines.push(RELAY_INSTRUCTION);
  return lines.join("\n");
}

/** One `n) label (`value`)[ ★]` digest line — ★ on the recommended option. */
function optionLine(q: Question, option: QuestionOption, ordinal: number): string {
  const star = option.value === q.recommendation ? " ★" : "";
  return `${ordinal}) ${option.label} (\`${option.value}\`)${star}`;
}

/** First `limit` characters of `text` (no ellipsis — truncation is silent). */
function truncate(text: string, limit: number): string {
  return text.length > limit ? text.slice(0, limit) : text;
}

/**
 * markAnswered + markSubmitted-equivalent for chat answers (h2.39): the user
 * already spoke in chat, so the answer is applied immediately and the
 * "delivery" step collapses into a submission snapshot + one epoch bump.
 *
 * Semantics:
 * - For each `{id, value, text?}` whose id exists in the state: apply
 *   `state.applyAnswer(id, { value, text?, at })` — status moves to
 *   "answered" (pending), `rev` is NEVER touched (answers are epoch
 *   territory, h2.39). All answers share one ISO `at` timestamp (one
 *   submission). `text` passthrough when present.
 * - Unknown ids are collected into `unknown` — NEVER thrown (tolerant
 *   pattern throughout this codebase); the executor surfaces them in the
 *   result text.
 * - Answer values are recorded AS GIVEN — no validation against option
 *   lists (chat answers are free-form; value-vs-options matching is the
 *   merge-rules layer's domain for upserts only).
 * - Exactly ONE snapshot push + ONE `state.bumpEpoch()` per CALL, even for a
 *   multi-answer batch — one call is one submission (h2.39). The snapshot is
 *   taken via the shared ring helper (`takeSnapshot`, BEFORE `bumpEpoch`)
 *   so the ring stays consistent with panel submissions.
 * - An all-unknown call is still one submission: the epoch advances and the
 *   returned status line (S6's job) carries the fresh epoch so the model
 *   re-orients.
 *
 * GUARD ORDERING CONTRACT (executor, S6): `assertFresh(state, parsed)` MUST
 * run BEFORE this function; this module does NOT re-check epoch (the single
 * guard prevents double-guard breaking healing flows), and a `StaleError`
 * propagates out of `execute` so pi sets `isError`.
 */
export function recordAnswers(
  state: InterrogationState,
  answers: AnswerInput[],
): { recorded: string[]; unknown: string[] } {
  const recorded: string[] = [];
  const unknown: string[] = [];
  const at = new Date().toISOString();

  for (const answer of answers) {
    if (state.getQuestion(answer.id) === undefined) {
      unknown.push(answer.id);
      continue;
    }
    const applied: QuestionAnswer = { value: answer.value, at };
    if (answer.text !== undefined) applied.text = answer.text;
    state.applyAnswer(answer.id, applied);
    recorded.push(answer.id);
  }

  // One call = one submission (h2.39): ring snapshot at the pre-bump epoch,
  // then exactly one epoch bump — regardless of how many answers applied.
  takeSnapshot(state);
  state.bumpEpoch();

  return { recorded, unknown };
}

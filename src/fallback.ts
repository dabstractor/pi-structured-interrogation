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
import { markSubmitted } from "./merge.js";
import { takeSnapshot } from "./snapshots.js";
import type {
  InterrogationState,
  Question,
  QuestionAnswer,
  QuestionOption,
  QuestionStatus,
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
 * Statuses an `answers[]` entry may NOT record against (BUG-012):
 * terminal-until-re-upsert per h2.38 — moot/withdrawn share the rule, and
 * `closed` reopens ONLY via re-upsert with rev+1, never via answers[].
 * Deliberately a LOCAL set: depends-on.ts's SKIP_EVALUATION is a different
 * concept (evaluation skip, no moot) and must not be reused.
 */
const TERMINAL_ANSWER_STATUSES: ReadonlySet<QuestionStatus> = new Set(["moot", "withdrawn", "closed"]);

/**
 * Apply chat `answers[]` to the state for non-TUI mode (BUG-012 gate): the
 * user already spoke in chat, so a recordable answer is applied and
 * SUBMITTED immediately — in non-TUI mode chat answers ARE the submission.
 *
 * Semantics:
 * - For each `{id, value, text?}`, bucket by id:
 *   - `recorded` — id exists with a recordable status →
 *     `state.applyAnswer(id, { value, text?, at })`, then the whole recorded
 *     batch is marked `submitted` (BUG-004, h2.39): one `answers[]` call
 *     collapses apply + the delivery step into ONE submission — the next
 *     `agent_settled` close pass (h2.44, lifecycle.ts `runClosePass`)
 *     archives those ids (closed) and the completion trigger fires
 *     (FR-25/AC-11). `rev` is NEVER touched (answers are epoch territory,
 *     h2.39); all answers share one ISO `at` timestamp (one submission).
 *     `text` passthrough when present.
 *   - `unknown` — id not in state. NEVER thrown (tolerant pattern
 *     throughout this codebase); the executor surfaces them in the result
 *     text.
 *   - `ignored` — id exists but status ∈ {moot, withdrawn, closed}:
 *     terminal-until-re-upsert (h2.38). The answer is NOT applied and the
 *     question is left untouched (status/answer/rev unchanged) — matching
 *     the panel's accept path, which already treats these as consumed
 *     no-ops.
 * - Answer values are recorded AS GIVEN — no validation against option
 *   lists (chat answers are free-form; value-vs-options matching is the
 *   merge-rules layer's domain for upserts only).
 * - Epoch rule: ONE `markSubmitted` + snapshot push + `state.bumpEpoch()`
 *   per CALL — but ONLY when `recorded.length > 0`. Ordering is
 *   load-bearing: `markSubmitted` BEFORE `takeSnapshot` so the ring
 *   snapshot captures status `submitted` (the pre-bump epoch state), and
 *   `takeSnapshot` BEFORE `bumpEpoch` (existing rule — the snapshot labels
 *   the epoch being LEFT). The "snapshot must hold `submitted`" requirement
 *   is LOCAL to submit-time take-sites — the ring also legitimately holds
 *   close-pass snapshots with "closed" statuses (lifecycle.ts runClosePass,
 *   BUG-003; see the RING SHAPE INVARIANTS note on snapshots.ts
 *   takeSnapshot). A fully ignored/unknown (or empty) call has
 *   ZERO side effects: it burns no epoch, pushes no snapshot, and marks
 *   nothing (BUG-012: a no-op record must not masquerade as a submission).
 *   `markSubmitted` validates all ids before applying — `recorded` ids are
 *   guaranteed known (they came from `state.getQuestion`), so it cannot
 *   throw; the call stays inside the guard so a zero-recorded call remains
 *   side-effect-free.
 *
 * GUARD ORDERING CONTRACT (executor, S6): `assertFresh(state, parsed)` MUST
 * run BEFORE this function; this module does NOT re-check epoch (the single
 * guard prevents double-guard breaking healing flows), and a `StaleError`
 * propagates out of `execute` so pi sets `isError`.
 */
export function recordAnswers(
  state: InterrogationState,
  answers: AnswerInput[],
): { recorded: string[]; unknown: string[]; ignored: string[] } {
  const recorded: string[] = [];
  const unknown: string[] = [];
  const ignored: string[] = [];
  const at = new Date().toISOString();

  for (const answer of answers) {
    const q = state.getQuestion(answer.id);
    if (q === undefined) {
      unknown.push(answer.id);
      continue;
    }
    // BUG-012: terminal-until-re-upsert (h2.38) — moot/withdrawn/closed ids
    // are consumed no-ops, matching the panel's accept path. Closed reopens
    // ONLY via re-upsert (rev+1), never via answers[].
    if (TERMINAL_ANSWER_STATUSES.has(q.status)) {
      ignored.push(answer.id);
      continue;
    }
    const applied: QuestionAnswer = { value: answer.value, at };
    if (answer.text !== undefined) applied.text = answer.text;
    if (answer.custom !== undefined) applied.custom = answer.custom;
    state.applyAnswer(answer.id, applied);
    recorded.push(answer.id);
  }

  // One call = one submission — but ONLY if something was recorded. A fully
  // ignored/unknown (or empty) call burns no epoch and pushes no snapshot
  // (mirrors the panel's zero-pending ctrl+s early-return flash).
  if (recorded.length > 0) {
    // BUG-004: chat answers ARE the submission in non-TUI mode (h2.39 "one
    // call = one submission"). Marking recorded ids submitted lets the
    // agent_settled close pass (h2.44, lifecycle.ts) archive them and
    // attemptCompletion fire the completion injection (FR-25/AC-11).
    markSubmitted(state, recorded); // BEFORE takeSnapshot — so THIS submit-time snapshot holds 'submitted' (LOCAL ordering note, not ring-wide: close-pass snapshots hold 'closed' — see snapshots.ts takeSnapshot)
    takeSnapshot(state);
    state.bumpEpoch();
  }

  return { recorded, unknown, ignored };
}

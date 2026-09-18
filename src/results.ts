/**
 * src/results.ts — pure result builders for the `interrogate` tool
 * (P1.M1.T3.S4). Every interrogate result carries (a) human/model-facing
 * content text and (b) a `details` envelope whose `state` field is the
 * CANONICAL persistence layer (h2.40 layer 2): the full post-call
 * `serialize()` projection, deep-copied on intake so results are inert
 * snapshots — later state mutations can never leak into a built result.
 *
 * This module is the single mint point for that envelope. Consumers:
 * - P1.M1.T3.S5 (non-TUI digest + answers action) — wraps these builders;
 *   record/reopen call sites own their content text and reuse the envelope
 *   shape via the shared helpers here.
 * - P1.M1.T3.S6 (tool executor) — upsert → applyCaps → merge →
 *   buildUpsertResult(state.serialize(), warnings); read →
 *   buildReadResult(state.serialize()).
 * - P1.M7.T1.S2 (reconstruction) — scans toolResult.details.state.
 *
 * Purity contract: no pi imports, no state mutation, no events, no I/O.
 * The only import is `./state.js` (the `UNGROUPED_LABEL` constant plus
 * types). Group-bucket semantics mirror `state.ts` `groupSummaries()` but
 * are re-implemented PURELY over the serialized projection — builders take
 * `SerializedState`, never the live `InterrogationState` class.
 */
import { UNGROUPED_LABEL } from "./state.js";
import type { Question, SerializedState } from "./state.js";

// -------------------------------------------------------------------- types

/**
 * Result action tag — mirrors `tool-schema.ts` `ParsedAction`'s discriminant
 * (h2.20: upsert | read | reopen | record). Declared locally as a literal
 * union to keep this module dependency-light.
 */
export type ResultAction = "upsert" | "read" | "reopen" | "record";

/**
 * Canonical details envelope (h2.40 layer 2). Carried on EVERY interrogate
 * result, on EVERY action.
 *
 * `details.state` is the canonical persistence layer (h2.40 layer 2) —
 * reconstruction (P1.M7.T1.S2) replays the latest interrogate result on the
 * current branch via `details.state`; therefore `details` MUST carry the
 * FULL post-call state on EVERY action, including read.
 */
export interface ResultDetails {
  /**
   * Full post-call state — THE canonical persistence payload. Always a
   * `structuredClone` of the caller's `SerializedState`: results are inert
   * snapshots, and later mutations of the caller's state never leak into a
   * previously built result.
   */
  state: SerializedState;
  /** Duplicates `state.epoch` for convenient scanning by reconstruction and digests. */
  epoch: number;
  /** The rendered h2.28 status line — shared with the panel footer (h2.28) without re-parsing content. */
  statusLine: string;
  /** Which action produced this result (h2.20). */
  action: ResultAction;
}

/**
 * One interrogate tool result: `content` is the model-facing text,
 * `details` the canonical envelope (see {@link ResultDetails}).
 */
export interface InterrogateResult {
  content: string;
  details: ResultDetails;
}

// ----------------------------------------------------------------- builders

/**
 * The shared h2.28 status line, byte-for-byte:
 * `"{answered}/{total} answered · {reasked} re-asked · {moot} moot · epoch {n}"`.
 *
 * Counts come from `state.questions` following `state.order` (orphans are
 * skipped defensively): total = `state.order.length`; `answered` counts
 * status === "answered" ONLY — `submitted`/`closed` are pending/archived
 * territory and never join this bucket, and `open`/`withdrawn` do not appear
 * in the line at all. Separators are ` · ` (space, middle dot U+00B7,
 * space). Empty state → `0/0 answered · 0 re-asked · 0 moot · epoch {n}`.
 *
 * Shared by design with the panel footer (h2.28): both render this exact
 * string, and `details.statusLine` carries it so renderers never re-parse
 * content.
 */
export function buildStatusLine(state: SerializedState): string {
  let answered = 0;
  let reasked = 0;
  let moot = 0;
  for (const id of state.order) {
    const q = state.questions[id];
    if (q === undefined) continue; // defensive: skip orphaned order ids
    if (q.status === "answered") answered++;
    else if (q.status === "reasked") reasked++;
    else if (q.status === "moot") moot++;
  }
  return `${answered}/${state.order.length} answered · ${reasked} re-asked · ${moot} moot · epoch ${state.epoch}`;
}

/**
 * Build the `read` result (h3.7, full-content per the 2026-09-15 pin): the
 * re-orientation digest the model uses after compaction, a stale rejection,
 * or before a surgical edit — carrying EVERYTHING needed to reconstruct a
 * complete question object, so a full-set resend never depends on context
 * that compaction may have summarized away.
 *
 * Content line order:
 * 1. `Goal: {goal}` — omitted entirely when goal is `""`
 * 2. the h2.28 status line
 * 3. one group summary per group, first-appearance order following
 *    `state.order`: `{group}: {answered}/{total} answered`; questions
 *    without `group` bucket under `"(none)"` (the `UNGROUPED_LABEL`)
 * 4. per-question blocks in `state.order`. Each block starts with the
 *    one-liner `{id}: {title} — {status} (rev {rev})` plus ` · answered: {value}`
 *    when an answer exists (titles are short by contract and never
 *    truncated; a missing `title` falls back to `prompt` sliced to 60 chars,
 *    plain slice, no ellipsis), followed by indented detail lines, only when
 *    the field is present: `  prompt: {full}` (when a title hides it or the
 *    60-char slice cut it), `  description: {full}`,
 *    `  - {value} = {label}[ ★][ — {ramification}]` per option, and one
 *    combined `  group: … · gate: true · dependsOn: {id}={v}|{id}≠{v}` line.
 *
 * `details.state` is the canonical persistence layer (h2.40 layer 2) —
 * reconstruction (P1.M7.T1.S2) replays the latest interrogate result on the
 * current branch via `details.state`; therefore `details` MUST carry the
 * FULL post-call state on EVERY action, including read.
 */
export function buildReadResult(state: SerializedState): InterrogateResult {
  const statusLine = buildStatusLine(state);
  const lines: string[] = [];
  if (state.goal !== "") lines.push(`Goal: ${state.goal}`);
  lines.push(statusLine);
  lines.push(...groupSummaryLines(state));
  for (const id of state.order) {
    const q = state.questions[id];
    if (q !== undefined) lines.push(...questionBlock(q));
  }
  return { content: lines.join("\n"), details: envelope(state, "read", statusLine) };
}

/**
 * Build the `upsert` result (h2.20 + h3.5): the compact return that tells
 * the model its questions are live and that it must end its turn.
 *
 * Content line order:
 * 1. the h2.28 status line
 * 2. `Questions visible to the user.` (exact sentence)
 * 3. `End your turn with a one-line note; do not call further tools.`
 *    (exact h3.5 sentence — the resident non-blocking instruction)
 * 4. each caps warning from `warnings[]`, one per line, in order
 *
 * `warnings` are rendered as received: they always reach the tool result
 * (h2.23's warning is unconditional — no suppression toggle exists), and the
 * S6 executor appends them verbatim, never filters.
 *
 * `details.state` is the canonical persistence layer (h2.40 layer 2) —
 * reconstruction (P1.M7.T1.S2) replays the latest interrogate result on the
 * current branch via `details.state`; therefore `details` MUST carry the
 * FULL post-call state on EVERY action, including read.
 */
export function buildUpsertResult(state: SerializedState, warnings: string[]): InterrogateResult {
  const statusLine = buildStatusLine(state);
  const lines = [
    statusLine,
    "Questions visible to the user.",
    "End your turn with a one-line note; do not call further tools.",
    ...warnings,
  ];
  return { content: lines.join("\n"), details: envelope(state, "upsert", statusLine) };
}

// ------------------------------------------------------------------ helpers

/**
 * Shared details mint: deep-copies the caller's state via `structuredClone`
 * so results are inert snapshots (later state mutations can never leak into
 * a previously built result), and duplicates `epoch` + `statusLine` for
 * convenient scanning (h2.40).
 */
function envelope(state: SerializedState, action: ResultAction, statusLine: string): ResultDetails {
  return { state: structuredClone(state), epoch: state.epoch, statusLine, action };
}

/**
 * Pure mirror of `state.ts` `groupSummaries()` bucket semantics, reduced to
 * the h3.7 summary line: `{group}: {answered}/{total} answered`, first-
 * appearance order following `state.order`, absent groups under
 * `UNGROUPED_LABEL`. Takes the serialized projection — never the live class.
 */
function groupSummaryLines(state: SerializedState): string[] {
  const groups: { name: string; total: number; answered: number }[] = [];
  const indexOf = new Map<string, number>();
  for (const id of state.order) {
    const q = state.questions[id];
    if (q === undefined) continue;
    const name = q.group ?? UNGROUPED_LABEL;
    let i = indexOf.get(name);
    if (i === undefined) {
      i = groups.length;
      indexOf.set(name, i);
      groups.push({ name, total: 0, answered: 0 });
    }
    groups[i].total++;
    if (q.status === "answered") groups[i].answered++;
  }
  return groups.map((g) => `${g.name}: ${g.answered}/${g.total} answered`);
}

/** One h3.7 per-question BLOCK: the one-liner plus full-content detail lines (2026-09-15 pin). */
function questionBlock(q: Question): string[] {
  // Titles are short by contract — never truncated. Only the prompt
  // fallback gets the 60-char plain slice (no ellipsis).
  const label = q.title ?? q.prompt.slice(0, 60);
  const lines = [questionLine(q)];
  // Full prompt when the header line does not already show it verbatim.
  if (q.title !== undefined || q.prompt.length > 60) lines.push(`  prompt: ${q.prompt}`);
  if (q.description !== undefined) lines.push(`  description: ${q.description}`);
  for (const opt of q.options ?? []) {
    const star = q.recommendation === opt.value ? " ★" : "";
    const ram = opt.ramification !== undefined ? ` — ${opt.ramification}` : "";
    lines.push(`  - ${opt.value} = ${opt.label}${star}${ram}`);
  }
  const meta: string[] = [];
  if (q.group !== undefined) meta.push(`group: ${q.group}`);
  if (q.gate === true) meta.push("gate: true");
  if (q.dependsOn !== undefined && q.dependsOn.length > 0) {
    meta.push(`dependsOn: ${q.dependsOn.map((d) => (d.equals !== undefined ? `${d.id}=${d.equals}` : `${d.id}≠${d.notEquals}`)).join(", ")}`);
  }
  if (meta.length > 0) lines.push(`  ${meta.join(" · ")}`);
  return lines;
}

/** One h3.7 per-question line: `{id}: {label} — {status} (rev {rev})[ · answered: {value}]`. */
function questionLine(q: Question): string {
  // Titles are short by contract — never truncated. Only the prompt
  // fallback gets the 60-char plain slice (no ellipsis).
  const label = q.title ?? q.prompt.slice(0, 60);
  let line = `${q.id}: ${label} — ${q.status} (rev ${q.rev})`;
  if (q.answer !== undefined) line += ` · answered: ${q.answer.value}`;
  return line;
}

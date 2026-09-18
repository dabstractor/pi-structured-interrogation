/**
 * src/debug-commands.ts — /interrogate debug subcommands (P1.M2.T3.S1,
 * h2.50; CMD-001: collapsed from three top-level /interrogate-debug-*
 * commands into ONE /interrogate command — "debug" is now a subcommand,
 * keeping /interrogate the only autocomplete hit for "/inter").
 * Scripted model turns are unreliable; these verbs invoke the SAME
 * functions the tool executor uses, so a passing debug run is evidence
 * about the production path.
 *
 * Subcommands (all under `/interrogate debug …`):
 *
 * - `/interrogate debug upsert <json>` — the FULL upsert path via
 *   {@link executeInterrogate} itself (parse → assertFresh → caps → merge →
 *   result building). Deliberately NOT re-implemented: duplicating it would
 *   defeat the h2.50 same-code-path purpose. Stale upserts notify the
 *   StaleError message verbatim (current rev/text + delta digest) — the
 *   AC-8 self-heal payload, now observable from the keyboard.
 * - `/interrogate debug submit [id=value,…]` — flushes each pair as a user
 *   answer (the "panel precondition" delivery.ts documents as caller-owned;
 *   the 8-line flush mirrors fallback.ts `recordAnswers` — free-form values,
 *   no option validation, unknown-id collection), then runs the full
 *   submission path: computeDiff against the PRE-flush state →
 *   {@link buildSubmission} (which ITSELF performs takeSnapshot + bumpEpoch
 *   in its strict order — calling them here too would double-bump) →
 *   {@link deliverSubmission} with a forced-idle probe so the submission
 *   triggers a real agent turn exactly like a panel ctrl+s (h3.6). A
 *   `note=<text>` pair is the batch note (R3, h2.32). NOTE for testers:
 *   `triggerTurn: true` starts a real agent turn in a live session.
 * - `/interrogate debug state` — buildStatusLine + one line per question.
 *
 * TUI-only convenience. All verbs are harmless with empty state: errors
 *   (including StaleError) are caught and surfaced via ctx.ui.notify — never
 *   rethrown into pi's command runner. Debug surface only: zero new logic
 *   beyond the 8-line answer flush; imports only from existing modules.
 *
 * Live-session note: upserts fire `questions-upserted`/`changed` events that
 * the auto-close lifecycle consumes — intended, do not suppress.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { InterrogatorConfig } from "./config.js";
import { buildSubmission, deliverSubmission } from "./delivery.js";
import type { Lifecycle } from "./lifecycle.js";
import { markSubmitted } from "./merge.js";
import { buildStatusLine } from "./results.js";
import { computeDiff } from "./snapshots.js";
import { executeInterrogate } from "./tool.js";
import { getState, type SerializedState } from "./state.js";

/** Prompt preview cap for the per-question one-liners (results.ts convention). */
const PROMPT_PREVIEW_CHARS = 60;

/** Plain slice to 60 chars, no ellipsis (buildReadResult's convention). */
function truncate(text: string): string {
  return text.length > PROMPT_PREVIEW_CHARS ? text.slice(0, PROMPT_PREVIEW_CHARS) : text;
}

/**
 * Parse `/interrogate-debug-submit` args as comma-separated `id=value` pairs.
 * The value runs to the next comma (values may contain spaces); both sides
 * are trimmed. A token without `=`, or with an empty id, is malformed.
 * Zero tokens (empty/whitespace args) yields [].
 */
function parsePairs(args: string): Array<{ id: string; value: string }> | undefined {
  const tokens = args.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
  const pairs: Array<{ id: string; value: string }> = [];
  for (const token of tokens) {
    const i = token.indexOf("=");
    if (i < 0) return undefined; // no "=" — malformed
    const id = token.slice(0, i).trim();
    if (id.length === 0) return undefined; // empty id — malformed
    pairs.push({ id, value: token.slice(i + 1).trim() });
  }
  return pairs;
}

/**
 * One-line status dump for a question (state command): `- <id> [<status>]
 * rev<r> <first 60 chars of prompt>` plus ` = <value>` when answered.
 */
function questionLine(id: string, q: SerializedState["questions"][string]): string {
  const answer = q.answer !== undefined ? ` = ${q.answer.value}` : "";
  return `- ${id} [${q.status}] rev${q.rev} ${truncate(q.prompt)}${answer}`;
}

/**
 * Minimal ctx surface the debug verbs touch (structural subset of pi's
 * ExtensionCommandContext — notify only).
 */
export interface DebugCommandCtx {
  ui: { notify(message: string, level: "info" | "warning" | "error"): void };
}

/**
 * `/interrogate debug …` subcommand handler (CMD-001): receives the text
 * AFTER the "debug" token, dispatches on the first verb token
 * (`upsert|submit|state`), and errors with a usage line on anything else.
 * Never throws — every failure path notifies.
 */
export type DebugSubcommandHandler = (args: string, ctx: DebugCommandCtx) => Promise<void>;

/**
 * Build the debug subcommand handler (P1.M2.T3.S1 bodies, CMD-001 shell).
 * Called once by index.ts at factory time with the SAME loaded config the
 * tool uses — never reload it here — and wired into the single
 * /interrogate command's "debug" branch.
 *
 * @param pi     transport surface; only sendMessage is touched (submit)
 * @param config the interrogator config loaded once by the index.ts factory
 * @param lifecycle optional auto-close engine handle — the submit flow MUST
 *               call {@link Lifecycle.noteSubmissionDelivered} right after
 *               deliverSubmission (h2.44 line 1, lifecycle.ts caller
 *               contract); index.ts passes the live engine.
 */
export function createDebugSubcommands(
  pi: Pick<ExtensionAPI, "sendMessage">,
  config: InterrogatorConfig,
  lifecycle?: Pick<Lifecycle, "noteSubmissionDelivered">,
): DebugSubcommandHandler {
  return async (args, ctx) => {
    const trimmed = args.trim();
    const sp = trimmed.search(/\s/);
    const verb = (sp < 0 ? trimmed : trimmed.slice(0, sp)).toLowerCase();
    const rest = sp < 0 ? "" : trimmed.slice(sp + 1).trim();
    if (verb === "upsert") {
      await debugUpsert(rest, ctx, config);
    } else if (verb === "submit") {
      await debugSubmit(rest, ctx, config, lifecycle, pi);
    } else if (verb === "state") {
      await debugState(ctx);
    } else {
      ctx.ui.notify(
        `interrogate debug: unknown subcommand "${verb}" — usage: /interrogate debug upsert|submit|state`,
        "error",
      );
    }
  };
}

// ---------------------------------------------------------------- upsert

async function debugUpsert(
  args: string,
  ctx: DebugCommandCtx,
  config: InterrogatorConfig,
): Promise<void> {
  let json: unknown;
  try {
    json = JSON.parse(args.trim());
  } catch (e) {
    ctx.ui.notify(`interrogate debug upsert: invalid JSON: ${(e as Error).message}`, "error");
    return;
  }
  try {
    // THE production executor — same parse/guard/caps/merge/result path
    // a model call takes. Synchronous and side-effect rich (fires
    // questions-upserted/changed consumed by lifecycle) by design.
    const result = executeInterrogate(json, { mode: "tui", hasUI: true }, config);
    // Warnings ride in the result content rows; the h2.28 status line is
    // the compact observable (caps/truncation effects stay visible via
    // /interrogate debug state — deliberately not re-running caps here).
    ctx.ui.notify(result.details.statusLine, "info");
  } catch (err) {
    // Single catch for plain Errors (malformed params, no-state) and
    // StaleError — whose message is the AC-8 self-heal payload (current
    // rev/text + digest) and must surface VERBATIM.
    ctx.ui.notify(`interrogate debug upsert: ${(err as Error).message}`, "error");
  }
}

// ---------------------------------------------------------------- submit

async function debugSubmit(
  args: string,
  ctx: DebugCommandCtx,
  config: InterrogatorConfig,
  lifecycle: Pick<Lifecycle, "noteSubmissionDelivered"> | undefined,
  pi: Pick<ExtensionAPI, "sendMessage">,
): Promise<void> {
  void config; // same-loaded-config contract only — this path reads state, not config
  // Parse first (never touch state on malformed input). pi's notify
  // level enum is "info" | "warning" | "error" — "warning" is the warn.
  const pairs = parsePairs(args);
  if (pairs !== undefined && pairs.length === 0) {
    ctx.ui.notify("interrogate debug submit: nothing to submit", "warning");
    return;
  }
  if (pairs === undefined) {
    ctx.ui.notify("interrogate debug submit: expected id=value[,id=value...]", "error");
    return;
  }
  const state = getState();
  if (state === undefined) {
    ctx.ui.notify("interrogate debug submit: no interrogation state", "error");
    return;
  }

  // R3 debug coverage: a `note=<text>` pair is the batch note, not an
  // answer id — lift it out BEFORE the flush so the id never reaches the
  // state engine (an unknown-id "note" would otherwise be collected);
  // an empty value is no note at all.
  const notePair = pairs.find((p) => p.id === "note");
  const answers = pairs.filter((p) => p.id !== "note");
  const note = notePair !== undefined && notePair.value !== "" ? notePair.value : undefined;

  // PRE-flush baseline: computeDiff must describe the flush as a diff
  // against the state BEFORE any applyAnswer (ordering contract — a
  // post-bump snapshot is NOT the baseline). serialize() is a deep copy,
  // so later mutations cannot alter it.
  const pre = state.serialize();

  // Answer flush — mirrors fallback.ts recordAnswers: free-form values
  // with NO option validation, unknown ids collected, answers never
  // touch rev. Caller-owned precondition of buildSubmission (it does
  // NOT flush).
  const unknown: string[] = [];
  const recorded: string[] = [];
  for (const { id, value } of answers) {
    if (state.getQuestion(id) === undefined) {
      unknown.push(id);
      continue;
    }
    state.applyAnswer(id, { value, at: new Date().toISOString() });
    recorded.push(id);
  }
  ctx.ui.notify(
    `interrogate debug submit: recorded: ${recorded.join(", ") || "(none)"}; ` +
      `unknown: ${unknown.join(", ") || "(none)"}`,
    "info",
  );

  // Full submission path (h2.14/h3.6) — buildSubmission performs
  // takeSnapshot + bumpEpoch itself, exactly once; do NOT duplicate.
  try {
    const diff = computeDiff(pre, state.serialize());
    // h2.38 ctrl+s transition (FR-3c): every pending (answered) id is
    // submitted at this epoch — the flush merge.ts documents ("the ctrl+s
    // submit flush applies this to all pending (answered) ids before the
    // epoch bump"). WITHOUT this the h2.44 close pass (which archives only
    // status "submitted" ids after agent_settled) never fires and
    // completion can never trigger (AC-3 / AC-14). Runs after computeDiff
    // (answer-signature diff is status-blind) and before buildSubmission
    // (the epoch bump) — the exact flush window.
    const pendingIds = state.orderedQuestions().filter((q) => q.status === "answered").map((q) => q.id);
    if (pendingIds.length > 0) markSubmitted(state, pendingIds);
    const msg = buildSubmission(state, diff, note);
    // Force the idle branch of the delivery matrix → { triggerTurn:
    // true, deliverAs: "followUp" } so the debug submission triggers an
    // agent turn exactly like a real panel submission (h3.6). NOTE: in a
    // live session this starts a real agent turn — that is the point.
    deliverSubmission(pi, msg, { isIdle: () => true });
    // h2.44 line 1 (lifecycle.ts caller contract, "immediately after
    // deliverSubmission"): a submission shipped — reset the engine's
    // per-run flags for the settle that answers it.
    lifecycle?.noteSubmissionDelivered();
    // R3 cleared-after-shipping report: the note rode THIS submission
    // (model-visible NOTE: line + details.note) and is now consumed.
    ctx.ui.notify(
      `interrogate debug submit: submitted epoch ${state.epoch}` +
        (note !== undefined ? `; note cleared: "${note}"` : ""),
      "info",
    );
  } catch (err) {
    ctx.ui.notify(`interrogate debug submit: ${(err as Error).message}`, "error");
  }
}

// ------------------------------------------------------------------ state

async function debugState(ctx: DebugCommandCtx): Promise<void> {
  const state = getState();
  if (state === undefined) {
    // Harmless-empty requirement: epoch 0 is the "never started" view.
    ctx.ui.notify("interrogate debug state: no interrogation state (epoch 0)", "info");
    return;
  }
  const s = state.serialize();
  const lines = [buildStatusLine(s)];
  for (const id of s.order) {
    const q = s.questions[id];
    if (q === undefined) continue; // defensive: skip orphaned order ids
    lines.push(questionLine(id, q));
  }
  ctx.ui.notify(lines.join("\n"), "info");
}

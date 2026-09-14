/**
 * src/detect.ts — plain-text question-round detection (P1.M7.T4.S1; FR-26,
 * h2.27), TUI-only.
 *
 * h2.27 — Round heuristic (verbatim intent from the PRD): after each
 * assistant turn, if the final assistant message contains ≥3 lines matching
 * the round regex AND no interrogate upsert occurred in this run, notify the
 * user `Question round detected in chat — /interrogate to move it into the
 * panel`. Throttled to once per 3 turns; toggleable via
 * config.roundDetection; NEVER transforms message content.
 *
 * PRD clause → code site (Level-4 review aid):
 * - "after each assistant turn … final assistant message" → the
 *   `turn_end` subscription (the ONLY event this module touches). turn_end
 *   carries the completed assistant message ({@link TurnEndEvent} message
 *   field); streaming/message_update is never consulted.
 * - "≥3 lines matching the regex" → {@link ROUND_LINE_RE} applied per line
 *   via {@link countRoundLines}.
 * - "no interrogate upsert occurred in this run" →
 *   `lifecycle.upsertedThisRun()` (P1.M2.T2.S1's `submittedRun` flag — the
 *   single source of truth; NOT duplicated here). Read-safe at turn_end:
 *   the flag is set only on a successful (non-error) interrogate
 *   tool_execution_end and cleared on agent_settled's close pass or
 *   submission delivery — both happen AFTER turn_end (see research/notes.md
 *   ordering section).
 * - "notify the user …" → exactly one `ctx.ui.notify(..., "info")` with
 *   {@link ROUND_NOTIFY_MESSAGE} — user nudges only; the module never calls
 *   sendMessage, never auto-runs /interrogate, and never writes to
 *   `event.message` (h2.0: no content transformation).
 * - "throttled to once per 3 turns" → {@link NOTIFY_EVERY_N_TURNS} +
 *   `lastNotifiedTurn`, measured in `event.turnIndex` deltas.
 * - "toggleable via config.roundDetection" → the first guard of the
 *   handler (config.ts P1.M1.T1.S2; default true — detect.ts is the named
 *   consumer in config.ts's JSDoc).
 *
 * Guard ORDER is contractual (cheap/broad first): toggle → TUI mode →
 * throttle → upsert suppression → text extraction → regex count → notify.
 *
 * Consumers: src/index.ts (P1.M7.T4 wiring — `createRoundDetector(pi,
 * { config, lifecycle })` after the lifecycle assignment; `dispose()` stays
 * unwired per the persistence-mirror precedent — subscriptions die with the
 * runtime).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { InterrogatorConfig } from "./config.js";
import type { Lifecycle } from "./lifecycle.js";

/**
 * h2.27 round-line regex, VERBATIM from the PRD. Per-line test (split on
 * `\n`); a line matches when it is, after optional leading whitespace:
 *
 * - `Q?\d+[\).:]` — a numbered list item: `1)`, `2.`, `Q3:` (optional "Q"
 *   prefix, one-or-more digits, then a closing paren, period, or colon);
 * - `[❓\-•*]` — a bullet marker: the ❓ emoji, a hyphen, a bullet, or an
 *   asterisk;
 *
 * …followed by `\s+.+\?` — whitespace, non-empty text, and a trailing
 * question mark (`.+` is greedy; the final `\?` anchors on the last `?`).
 *
 * WHY ≥3 LINES (the threshold lives in the caller, not here): three or more
 * matching lines is a ROUND of questions — exactly the batch situation the
 * /interrogate panel was built for; one or two are stray questions that
 * plain chat handles fine, and nudging on them would be noise (FR-26).
 */
export const ROUND_LINE_RE = /^\s*(?:Q?\d+[\).:]|[❓\-•*])\s+.+\?/;

/**
 * h2.27 notify message, VERBATIM (byte-identical; em dash, not hyphen).
 * Names the /interrogate command so the nudge is actionable.
 */
export const ROUND_NOTIFY_MESSAGE =
  "Question round detected in chat — /interrogate to move it into the panel";

/**
 * Throttle window in TURNS (PRD h2.27: "throttled to once per 3 turns").
 * Measured as `event.turnIndex - lastNotifiedTurn >= 3` — turnIndex is
 * monotonic per session, so deltas are exact turn counts; a manual counter
 * would also count non-assistant events and drift (known gotcha).
 */
const NOTIFY_EVERY_N_TURNS = 3;

export interface RoundDetectorOptions {
  /** Narrowed to just the toggle this module reads (config.ts is never modified here). */
  config: Pick<InterrogatorConfig, "roundDetection">;
  /** Narrowed to the per-run upsert flag getter (single source of truth — P1.M2.T2.S1). */
  lifecycle: Pick<Lifecycle, "upsertedThisRun">;
}

export interface RoundDetector {
  /** Remove all pi event subscriptions (session teardown seam). */
  dispose(): void;
}

/**
 * Tolerant assistant-text extraction from the turn_end message (types.d.ts:
 * TurnEndEvent.message is an AgentMessage whose content is a string or a
 * block array). Only `{ type: "text", text }` blocks contribute — reasoning
 * and tool blocks are ignored. Non-string/missing content yields undefined
 * (detection is silent). Pure read — never writes to the message. Mirrors
 * lifecycle.ts's tolerant-narrowing style (no `as any`).
 */
function assistantText(message: unknown): string | undefined {
  if (typeof message !== "object" || message === null || Array.isArray(message)) return undefined;
  const record = message as { content?: unknown };
  if (typeof record.content === "string") return record.content;
  if (!Array.isArray(record.content)) return undefined;
  const parts: string[] = [];
  for (const block of record.content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}

/** Count lines of `text` matching the h2.27 round regex (split on `\n`). */
function countRoundLines(text: string): number {
  let count = 0;
  for (const line of text.split("\n")) {
    if (ROUND_LINE_RE.test(line)) count++;
  }
  return count;
}

/**
 * Build the round detector and subscribe it to `turn_end` (wiring lives at
 * the factory per the "Subscribe in index.ts" rule — index.ts calls
 * `createRoundDetector(pi, { config, lifecycle })` after the lifecycle
 * assignment, since the detector consumes `lifecycle.upsertedThisRun()`).
 *
 * @param pi   narrow event surface — `Pick<ExtensionAPI, "on">` — so tests
 *             pass a bare mock without constructing a full ExtensionAPI
 * @param opts the config toggle + lifecycle upsert-flag getter
 */
export function createRoundDetector(
  pi: Pick<ExtensionAPI, "on">,
  opts: RoundDetectorOptions,
): RoundDetector {
  // Bootstrap: -3 so the FIRST qualifying detection may fire at turnIndex 0
  // (0 - (-3) = 3 >= NOTIFY_EVERY_N_TURNS). Any earlier virtual turn is
  // impossible (turnIndex starts at 0).
  let lastNotifiedTurn = -NOTIFY_EVERY_N_TURNS;

  // pi.on returns void in the installed pi runtime, but some hosts/mocks hand
  // back an unsubscribe function — capture it tolerantly for dispose()
  // (verbatim lifecycle.ts precedent).
  const unsubscribers: Array<() => void> = [];
  const track = (registered: unknown): void => {
    if (typeof registered === "function") unsubscribers.push(registered as () => void);
  };

  track(
    pi.on("turn_end", (event, ctx) => {
      // 1. Config toggle (cheap; the PRD's off-switch).
      if (!opts.config.roundDetection) return;
      // 2. TUI-only (FR-26). Tolerant: no ctx / non-TUI mode → silent.
      if (ctx?.mode !== "tui") return;
      // 3. Throttle FIRST (cheaper than the upsert read): once per 3 turns.
      if (event.turnIndex - lastNotifiedTurn < NOTIFY_EVERY_N_TURNS) return;
      // 4. The model already used the interrogate tool this run → no nudge.
      //    Race-free at turn_end: submittedRun clears only on agent_settled's
      //    close pass / submission delivery, both AFTER turn_end.
      if (opts.lifecycle.upsertedThisRun()) return;
      // 5. Completed assistant message text (pure read; no mutation ever).
      const text = assistantText(event.message);
      if (text === undefined) return;
      // 6. h2.27 threshold: a ROUND (≥3), not a stray question.
      if (countRoundLines(text) < 3) return;
      // 7. One nudge, exact h2.27 string, then open the throttle window.
      ctx?.ui?.notify(ROUND_NOTIFY_MESSAGE, "info");
      lastNotifiedTurn = event.turnIndex;
    }),
  );

  return {
    dispose(): void {
      for (const off of unsubscribers) off();
      unsubscribers.length = 0;
    },
  };
}

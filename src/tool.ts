/**
 * src/tool.ts — the `interrogate` tool: registration object + executor core
 * (P1.M1.T3.S6). This is the single LLM entry point for structured
 * interrogation (h2.15): it composes the S1–S5 modules —
 *
 *   parse (tool-schema) → guards → caps → merge → result builders → fallback
 *
 * into one routing executor, and registers it via the h2.24 resident text and
 * the h2.25 compact render rows.
 *
 * NON-BLOCKING INVARIANT (h2.0 §1): the executor is fully synchronous. It
 * never opens the panel, never calls UI surface, never blocks on anything
 * user-driven, and returns a compact result immediately. Panel opening is
 * event-driven: `applyUpsert` fires `questions-upserted` on the state
 * singleton, and the lifecycle module (P1.M2.T2.S1) subscribes to it.
 * `details.state` on every result is the canonical persistence envelope
 * (h2.40 layer 2).
 *
 * Parallel ownership: results.ts / fallback.ts / tool-schema.ts are S4/S5/S1
 * contracts and are NOT modified here. `envelope()` is private to results.ts,
 * so the reopen/record/non-TUI-upsert envelopes are minted inline below with
 * the exact documented shape ({state: structuredClone, epoch, statusLine,
 * action}).
 */
import { Box, Text } from "@earendil-works/pi-tui";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Static } from "typebox";
import { applyCaps } from "./caps.js";
import { DEFAULT_CONFIG, type InterrogatorConfig } from "./config.js";
import { buildFallbackDigest, isNonTui, recordAnswers } from "./fallback.js";
import { assertFresh } from "./guards.js";
import { applyUpsert } from "./merge.js";
import {
  buildReadResult,
  buildStatusLine,
  buildUpsertResult,
  type InterrogateResult,
  type ResultAction,
  type ResultDetails,
} from "./results.js";
import {
  createInterrogationState,
  getState,
  setState,
  type InterrogationState,
  type Question,
  type SerializedState,
} from "./state.js";
import { InterrogateParams, parseInterrogateParams, type QuestionInput } from "./tool-schema.js";

// ------------------------------------------------------- resident text (h2.24)

/**
 * Resident description contract (h2.24): ≤120 words, verbatim from the PRD;
 * pi keeps tool descriptions always resident for active tools, so no extra
 * injection API is used (per-request injection is vetoed, h2.4).
 */
export const INTERROGATE_TOOL_DESCRIPTION =
  "Structured interrogation: plan by asking the user questions they answer in a persistent panel. Upsert `questions[]` (stable ids; existing questions require their current `rev`; omitting an id withdraws it). Call with `{}` to read current state, goal, and epoch. Answers arrive as submission messages — consider how they affect your other questions and re-ask only those materially affected (upsert with new rev). First round: few broad foundational questions with key ramifications; refine in later rounds; send the full set up front. The question set is the plan: when it completes, the full record is injected — derive the spec from it, don't re-plan. If unsure your view is current, read before upserting.";

/**
 * The two h2.24 guideline bullets, verbatim (pi-api-validation.md adaptation
 * #5: the tool's own promptGuidelines field is THE mechanism — no standalone
 * global-guidelines API exists, and none is needed since the description is
 * always resident for active tools).
 */
export const INTERROGATE_PROMPT_GUIDELINES: string[] = [
  "Use interrogate for structured planning questions instead of plain-text question blocks; send the full set in one call.",
  "After answers arrive, re-ask only questions materially affected by the new answers, then let the interrogation complete.",
];

/**
 * One-line discovery snippet for the Available-tools system-prompt section
 * (pi-api-validation.md confirms the field). OURS, not PRD-verbatim — the
 * h2.24 text above is the model's contract; this only keeps discovery cheap.
 */
export const INTERROGATE_PROMPT_SNIPPET =
  "Ask structured planning questions via the interrogate tool; users answer in a persistent panel.";

// ----------------------------------------------------------------- constants

/** Defensive stand-in when `ctx.model` is absent (documented on ToolContext). */
export const DEFAULT_CONTEXT_WINDOW = 200_000;

/**
 * The slice of pi's ExtensionContext the executor reads — nothing else.
 * Structural: the real execute() hands its full ExtensionContext straight
 * through, and tests stub this shape ({ mode, hasUI, model.contextWindow }).
 * Deliberately carries NO UI surface: the executor cannot touch it.
 */
export interface ExecutorContext {
  /** Run mode: "tui" | "rpc" | "json" | "print" (h2.26 fallback guard input). */
  mode: string;
  /** Whether dialog-capable UI is available (h2.26 fallback guard input). */
  hasUI: boolean;
  /** Current model; only `contextWindow` (tokens) is read, defensively. */
  model?: { contextWindow?: number } | undefined;
}

/**
 * Config seam for {@link executeInterrogate}: set once by
 * {@link createInterrogateTool} at factory time (index.ts loads config once,
 * synchronously thereafter). Explicit third argument always wins.
 */
let activeConfig: InterrogatorConfig = DEFAULT_CONFIG;

/**
 * What the injected resume hook reports about the host-side reopen attempt
 * ([Mode A] — the full reopen decision table lives on the hook's host side;
 * see the `reopen` case below for the executor's line mapping).
 */
export type ReopenOutcome = "reopened" | "already-open" | "no-state";

/**
 * Optional executor dependencies injected by the factory (index.ts).
 * Deliberately NOT a UI surface: the executor's non-blocking invariant
 * (h2.0 §1) forbids any direct UI calls, so panel-touching behavior is
 * injected from the factory closure that owns the panel host.
 */
export interface ToolDeps {
  /**
   * [Mode A] Resume hook for `{reopen:true}` (FR-6/Q12 agent-judgment
   * reopen). The executor adds NO deterministic guard beyond state
   * existence — no recency, epoch, or cooldown check — because the agent's
   * judgment is the only gate and the always-visible suspend widget is the
   * user's safety net while suspended. The hook exists instead of a direct
   * UI call because the executor must stay synchronous and UI-free
   * (h2.0 §1): the panel module retains its own surface carriers
   * (activePi/lastOpts), so the hook needs nothing from this context. It
   * routes through the SAME resumePanel path as the ctrl+shift+q /
   * /interrogate hotkey (h2.35 — a single resume path); the host phase
   * flips synchronously, so the returned outcome is trustworthy at once.
   */
  onReopen?: () => ReopenOutcome;
}

// ------------------------------------------------------------------- helpers

/**
 * QuestionInput → merge.ts Question mapping (the S2/S3 test-suite convention):
 * `applyUpsert` overrides `rev`/`status`/`answer` internally, but the `Question`
 * type requires them, so supply neutral values. Optional content fields are
 * copied only when present so no explicit `undefined` keys appear on the
 * stored object.
 */
function toMergeQuestion(input: QuestionInput): Question {
  const q: Question = { id: input.id, prompt: input.prompt, type: input.type, rev: input.rev ?? 1, status: "open" };
  if (input.title !== undefined) q.title = input.title;
  if (input.description !== undefined) q.description = input.description;
  if (input.options !== undefined) q.options = input.options;
  if (input.recommendation !== undefined) q.recommendation = input.recommendation;
  if (input.group !== undefined) q.group = input.group;
  if (input.gate !== undefined) q.gate = input.gate;
  if (input.dependsOn !== undefined) q.dependsOn = input.dependsOn;
  return q;
}

/**
 * Inline envelope mint for the actions results.ts does not build (its
 * `envelope()` is private by design — S4 ownership). Shape matches the
 * documented ResultDetails exactly: inert post-call snapshot + convenience
 * duplicates (h2.40 layer 2).
 */
function inlineEnvelope(state: SerializedState, action: ResultAction, statusLine: string): ResultDetails {
  return { state: structuredClone(state), epoch: state.epoch, statusLine, action };
}

/**
 * Combined upsert warning list: parse warnings (h2.23 truncation from S1)
 * PREPENDED to caps warnings (S3), appended UNCONDITIONALLY — h2.23 requires
 * truncation "with a warning in the tool result (never a hard reject)" and
 * specifies no suppression toggle; the model must see what was cut to
 * self-correct. (`config.gateWarnings` is the FR-9 panel submit warning —
 * unrelated to tool results.)
 */
function upsertWarnings(parsed: string[], capped: string[]): string[] {
  return [...parsed, ...capped];
}

// ------------------------------------------------------------------ executor

/**
 * The testable executor core for the `interrogate` tool. Pure-ish: reads
 * `ctx.mode` / `ctx.hasUI` / `ctx.model.contextWindow` and the module state
 * singleton; mutates state only through S2/S3/S5 entry points; fully
 * synchronous — never blocks on anything user-driven, opens no panel, and
 * has no UI dependency beyond the two mode flags (h2.0 §1).
 *
 * Routing (h2.20 precedence from S1): non-empty `questions` → upsert; else
 * non-empty `answers` → record; else `reopen === true` → reopen; else read.
 *
 * Behavior:
 * - parse first, ALWAYS before any state work: malformed input throws
 *   (`invalid interrogate params:` + one `- path: message` line per error)
 *   so pi sets isError — it must never look like success, and h2.22 guards
 *   never see it.
 * - no existing state: read → synthesized empty view (`epoch 0`, NOT
 *   persisted); upsert → create + register the singleton with the parsed
 *   goal; record → plain Error; reopen → plain Error.
 * - a parsed `goal` applies on upsert whenever present: the create path
 *   constructs with the CAPPED goal and later upserts update it via
 *   `state.setGoal(capped.goal)` (FR-30; BUG-001/BUG-009); an omitted goal
 *   leaves the stored one unchanged. Truncation is owned by `applyCaps`
 *   (caps.ts); its `goal truncated at {n} chars` warning surfaces in the
 *   result via `upsertWarnings`.
 * - `assertFresh` runs before upsert/record mutation; StaleError propagates
 *   UNCAUGHT — its message is the model's self-heal signal (h2.22).
 * - upsert: caps → merge (fires `questions-upserted`/`changed` — the panel
 *   trigger; do NOT open anything here) → TUI compact result or non-TUI
 *   status + digest + warnings composite.
 * - record (h2.20): TUI → IGNORED (ack note only, no state change);
 *   non-TUI → recordAnswers (epoch bumped inside) + status/unknown lines.
 * - reopen: TUI → invokes the injected `deps.onReopen` resume hook (agent-
 *   judgment trusted, FR-6) and reports its outcome as a confirmation line;
 *   non-TUI → identical to read.
 *
 * @throws Error on malformed params (isError) and on record/reopen without
 *         state; StaleError propagates from the guards.
 */
export function executeInterrogate(
  args: unknown,
  ctx: ExecutorContext,
  config: InterrogatorConfig = activeConfig,
  deps: ToolDeps = {},
): InterrogateResult {
  // 1. Parse + route — before ANY state work (malformed input never mutates).
  const parsed = parseInterrogateParams(args, config);
  if (!parsed.ok || parsed.action === undefined) {
    throw new Error(
      "invalid interrogate params:\n" + parsed.errors.map((e) => `- ${e.path}: ${e.message}`).join("\n"),
    );
  }

  const existing = getState();

  switch (parsed.action.action) {
    // ------------------------------------------------------------ read
    case "read": {
      if (!existing) {
        // Synthesized empty view — NOT persisted (getState() stays undefined).
        // epoch 0 signals "no interrogation has ever started this session".
        const view = createInterrogationState("").serialize();
        view.epoch = 0;
        return buildReadResult(view);
      }
      return buildReadResult(existing.serialize());
    }

    // ---------------------------------------------------------- upsert
    case "upsert": {
      // Caps first — applyCaps is PURE (structuredClone, no state mutation),
      // so hoisting it above singleton creation changes nothing observable.
      // capped.goal is the single truncation authority (BUG-009): never
      // truncate the goal here.
      const capped = applyCaps(
        parsed.action.questions,
        parsed.action.goal ?? "",
        config,
        ctx.model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
      );
      // [Mode A] SINGLETON LIFETIME / BUG-002: a completed singleton is
      // REPLACED, not reused — completion cleared its questions and its
      // `completed` guard is exactly-once by design (deserialize restores it
      // across restart; never weakened). A new-question upsert starts a NEW
      // interrogation: fresh epoch 1, completed=false, empty snapshots.
      // Goal: the upsert's capped goal when sent, else the prior goal RETAINED
      // (FR-30 — the goal anchors re-asks; a blank header helps nobody).
      // Decision (spec gap pinned; recorded in P1.M5.T2.S2).
      let state: InterrogationState;
      if (existing !== undefined && existing.completed === true) {
        // BUG-002: fresh interrogation on a completed session. The goal is
        // CONSTRUCTOR-atomic — never setGoal on this path (a follow-up would
        // double-emit `changed` and misrepresent the mutation).
        state = createInterrogationState(
          parsed.action.goal !== undefined ? capped.goal : existing.serialize().goal,
        );
        setState(state);
      } else {
        // Create stores the CAPPED goal; goal-omitted creates still start from
        // "" (explicit ternary keeps that semantic visible).
        state = existing ?? createInterrogationState(parsed.action.goal !== undefined ? capped.goal : "");
        if (!existing) setState(state);
      }

      // StaleError propagates (h2.22) — BEFORE any mutation. Runs against the
      // state that will RECEIVE the upsert (guards belong to the receiver): on
      // a fresh swap state this trivially passes (epoch 1, no existing ids).
      assertFresh(state, parsed.action);

      // Fires `questions-upserted` + `changed` — THE panel trigger
      // (P1.M2.T2.S1 lifecycle). This executor must not open anything.
      applyUpsert(state, capped.questions.map(toMergeQuestion));

      // FR-30 (BUG-001): a goal on ANY upsert replaces the stored one —
      // already capped above. Omitted goal → unchanged (never wipe to "").
      // This emits a second `changed` after applyUpsert's — expected per
      // setGoal's contract (always emits; callers gate). Do NOT coalesce.
      // Swap-excluded (BUG-002): keyed on the ORIGINAL `existing` (pre-swap) —
      // on the completed-swap path the goal was applied at construction.
      if (existing !== undefined && existing.completed !== true && parsed.action.goal !== undefined) {
        state.setGoal(capped.goal);
      }

      const serialized = state.serialize();
      if (isNonTui(ctx.mode, ctx.hasUI)) {
        // h2.26 fallback: status line + numbered digest (ends with the relay
        // sentence from fallback.ts) + warnings. Envelope minted inline.
        const statusLine = buildStatusLine(serialized);
        const content = [statusLine, ...buildFallbackDigest(serialized).split("\n"), ...upsertWarnings(parsed.warnings, capped.warnings)].join("\n");
        return { content, details: inlineEnvelope(serialized, "upsert", statusLine) };
      }
      return buildUpsertResult(serialized, upsertWarnings(parsed.warnings, capped.warnings));
    }

    // ---------------------------------------------------------- reopen
    //
    // [Mode A] AGENT-JUDGMENT REOPEN (FR-6/Q12): there is NO deterministic
    // guard here beyond state existence — no recency, epoch, or cooldown
    // check. The agent's judgment is the only gate, and the always-visible
    // suspend widget is the user's safety net while suspended, so a wrong
    // judgment call costs the user one esc — never stranding them. The
    // actual resume is delegated to the injected `deps.onReopen` hook
    // rather than any direct UI call: this executor must stay synchronous
    // and UI-free (h2.0 §1), and the panel module retains its own surface
    // carriers, so the hook needs nothing from this context. The hook
    // routes through the SAME resumePanel path as the ctrl+shift+q /
    // /interrogate hotkey (h2.35 — a single resume path); the host phase
    // flips synchronously, so the outcome is trustworthy immediately and
    // this call stays non-blocking.
    case "reopen": {
      if (!existing) throw new Error("no interrogation state to reopen");
      const serialized = existing.serialize();
      if (isNonTui(ctx.mode, ctx.hasUI)) {
        // Nothing to resurface in a non-TUI run — a read re-orients instead.
        return buildReadResult(serialized);
      }
      const statusLine = buildStatusLine(serialized);
      const outcome = deps.onReopen?.() ?? "reopened";
      const line =
        outcome === "already-open"
          ? "Panel already open."
          : outcome === "no-state"
            ? "No open questions to reopen."
            : "Panel reopened.";
      return { content: `${statusLine}\n${line}`, details: inlineEnvelope(serialized, "reopen", statusLine) };
    }

    // ---------------------------------------------------------- record
    case "record": {
      if (!existing) {
        throw new Error("no interrogation in progress — call interrogate with questions[] first");
      }
      assertFresh(existing, parsed.action); // epoch guard (record ordering contract)
      const state = existing;

      if (!isNonTui(ctx.mode, ctx.hasUI)) {
        // h2.20: answers in TUI are IGNORED — the panel is the answer channel.
        const serialized = state.serialize();
        const statusLine = buildStatusLine(serialized);
        return {
          content: `${statusLine}\nanswers ignored in TUI — answers arrive via the panel.`,
          details: inlineEnvelope(serialized, "record", statusLine),
        };
      }

      const { recorded, unknown, ignored } = recordAnswers(state, parsed.action.answers);
      const serialized = state.serialize(); // POST-record: epoch bumped inside (iff anything recorded)
      const statusLine = buildStatusLine(serialized);
      const lines = [statusLine];
      if (ignored.length > 0) lines.push(`not recordable (moot/withdrawn/closed): ${ignored.join(", ")}`);
      if (unknown.length > 0) lines.push(`unknown ids: ${unknown.join(", ")}`);
      if (recorded.length === 0) lines.push("no answers recorded");
      return { content: lines.join("\n"), details: inlineEnvelope(serialized, "record", statusLine) };
    }
  }
}

// ------------------------------------------------------------------ renderer

/**
 * h2.25 call row — ARGS-DERIVED approximation (renderCall receives no state):
 * `interrogate {n} questions {+m new ~k updated}` where `+m new` counts
 * questions without a `rev` and `~k updated` counts questions carrying one.
 * With no `questions[]`, a compact action suffix renders instead (`record
 * answers` / `reopen panel`); bare reads render just `interrogate`.
 */
function renderCallRow(args: Static<typeof InterrogateParams> | undefined, theme: Theme): string {
  let text = theme.fg("toolTitle", theme.bold("interrogate "));
  if (Array.isArray(args?.questions) && args.questions.length > 0) {
    const updated = args.questions.filter((q) => typeof q?.rev === "number").length;
    const fresh = args.questions.length - updated;
    const parts = [`${args.questions.length} questions`];
    if (fresh > 0) parts.push(`+${fresh} new`);
    if (updated > 0) parts.push(`~${updated} updated`);
    text += theme.fg("muted", parts.join(" "));
  } else if (Array.isArray(args?.answers)) {
    text += theme.fg("muted", "record answers");
  } else if (args?.reopen === true) {
    text += theme.fg("muted", "reopen panel");
  }
  return text;
}

// ------------------------------------------------------------- registration

/**
 * Build the `interrogate` ToolDefinition (h2.15/h2.3) bound to the resolved
 * config. Called ONCE by index.ts at factory time; also seams the executor's
 * default config for direct {@link executeInterrogate} callers (debug
 * commands, tests).
 */
export function createInterrogateTool(
  config: InterrogatorConfig,
  deps: ToolDeps = {},
): ToolDefinition<typeof InterrogateParams, ResultDetails> {
  activeConfig = config;
  return {
    name: "interrogate",
    label: "interrogate",
    description: INTERROGATE_TOOL_DESCRIPTION,
    promptSnippet: INTERROGATE_PROMPT_SNIPPET,
    promptGuidelines: INTERROGATE_PROMPT_GUIDELINES,
    parameters: InterrogateParams,
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const result = executeInterrogate(params, ctx, config, deps);
      return { content: [{ type: "text", text: result.content }], details: result.details };
    },
    renderCall(args, theme, _context) {
      return new Text(renderCallRow(args, theme), 0, 0);
    },
    renderResult(result, { expanded }, theme, _context) {
      const details: ResultDetails | undefined = result.details;
      if (!details) {
        // Defensive: stale/foreign results without our envelope fall back to
        // the raw model-facing text (todo.ts pattern).
        const first = result.content[0];
        return new Text(first?.type === "text" ? first.text : "", 0, 0);
      }
      if (!expanded) {
        // Collapsed: the shared h2.28 status line carried in the envelope.
        return new Text(theme.fg("muted", details.statusLine), 0, 0);
      }
      // Expanded: the full state summary — the read-result line format, one
      // Text child per line in a padding-free Box (compact per h2.25).
      const box = new Box(0, 0);
      for (const line of buildReadResult(details.state).content.split("\n")) {
        box.addChild(new Text(line, 0, 0));
      }
      return box;
    },
  };
}

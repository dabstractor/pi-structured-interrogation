/**
 * src/compaction.ts — session_before_compact preservation guard
 * (P1.M7.T2.S1; FR-29, h2.42 — the compaction half of the Q37 residue fix).
 *
 * [Mode A] PRD ADAPTATION — why this module runs the summarization itself:
 * The PRD (h2.42/FR-29) specified supplying preservation instructions to pi's
 * compaction summarizer from the session_before_compact handler. pi 0.85.1's
 * `SessionBeforeCompactResult` is `{ cancel?, compaction? }` — it has NO
 * instructions-return field (unlike `SessionBeforeTreeResult`, which does).
 * pi's DEFAULT compaction path does accept customInstructions internally
 * (appended as an "Additional focus:" suffix), but that parameter is not
 * reachable from an extension (plan/001_0d6760db6bc5/architecture/
 * pi-api-validation.md §Mismatch 1). The only mechanism pi offers is the
 * canonical custom-compaction pattern (examples/extensions/custom-compaction.ts:23-45):
 * the extension runs the summarization ITSELF — serialize the conversation,
 * one modelRegistry.complete call — and returns `{ compaction: {...} }`, with
 * the PRD's preservation text PREPENDED to the summarizer prompt. Returning
 * `undefined` from the handler makes pi run default compaction untouched;
 * that is the designed failure mode for EVERYTHING going wrong here.
 *
 * h2.42 contract honored:
 * - The preservation text is PREPENDED VERBATIM ({@link PRESERVATION_INSTRUCTIONS}).
 * - "No other compaction machinery": no cancel, no injection, no state
 *   mutation, no panels — one mirror flush + one model call, then either the
 *   custom summary or a silent fall-through.
 * - Post-compaction survival does NOT depend on the summary: a FRESH
 *   `interrogation-state` mirror entry is flushed synchronously BEFORE any
 *   summarization, so P1.M7.T1.S2 reconstruction (the `interrogate({})` read
 *   path) finds full state regardless of what compaction discards.
 *
 * Handler logic — every failure path returns undefined (→ default compaction):
 *   toggle off → no active interrogation → [ try: mirror.flush → resolve
 *   model → build prompt (preservation text prepended) → modelRegistry.complete
 *   (event.signal forwarded) → join text blocks → blank/aborted → undefined ]
 *   → catch: one console.error line, undefined. NEVER throws, NEVER cancels,
 *   NEVER blocks compaction — preservation is additive, not gating.
 */
import { uuidv7 } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";
import type { InterrogatorConfig } from "./config.js";
import type { StateMirror } from "./persistence.js";
import { getState, type InterrogationState } from "./state.js";

/**
 * Preservation instructions prepended to the compaction summarizer prompt —
 * VERBATIM from PRD h2.42 (FR-29). Byte-for-byte stable: compaction.test.ts
 * asserts the exact string, so any edit here is a deliberate contract change.
 */
export const PRESERVATION_INSTRUCTIONS =
  "Preserve verbatim: the user's stated goals and plan constraints from all messages " +
  "(including side conversations), all interrogation answers and later changes, the " +
  "interrogation goal, and the fact that current interrogation state is available via " +
  "interrogate({}).";

/** The CompactionPreparation slice the prompt builder consumes. */
export type PreparationSlice = Pick<
  SessionBeforeCompactEvent["preparation"],
  "messagesToSummarize" | "turnPrefixMessages" | "previousSummary"
>;

/**
 * The single-user-message summarization request handed to
 * `modelRegistry.complete` (the `Context.messages` payload).
 */
export interface PreservationPromptMessage {
  role: "user";
  content: [{ type: "text"; text: string }];
  timestamp: number;
}

/**
 * Build the summarizer prompt messages (pure — no model, no state, no I/O):
 *
 * 1. {@link PRESERVATION_INSTRUCTIONS} PREPENDED — the first bytes of the
 *    prompt, for maximum salience (PRD h2.42).
 * 2. pi's default summarization ask (structure, concision — the
 *    custom-compaction.ts:37-52 rendition).
 * 3. A `<previous-summary>` block when `previousSummary` exists (iterative
 *    compaction), so repeated compactions don't lose earlier preservation.
 * 4. The full conversation — `[...messagesToSummarize, ...turnPrefixMessages]`
 *    — serialized inside `<conversation>` so the model summarizes rather than
 *    continues it.
 */
export function buildPreservationPrompt(preparation: PreparationSlice): PreservationPromptMessage[] {
  const allMessages = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages];
  const conversationText = serializeConversation(convertToLlm(allMessages));
  const previousBlock = preparation.previousSummary
    ? `\n\n<previous-summary>\n${preparation.previousSummary}\n</previous-summary>`
    : "";
  const text =
    PRESERVATION_INSTRUCTIONS +
    `

You are a conversation summarizer. Create a comprehensive summary of this conversation that captures:
1. The main goals and objectives discussed
2. Key decisions made and their rationale
3. Important code changes, file modifications, or technical details
4. Current state of any ongoing work
5. Any blockers, issues, or open questions
6. Next steps that were planned or suggested

Be thorough but concise. The summary will replace the ENTIRE conversation history, so include all information needed to continue the work effectively.

Format the summary as structured markdown with clear sections.` +
    previousBlock +
    `

<conversation>
${conversationText}
</conversation>`;
  return [{ role: "user", content: [{ type: "text", text }], timestamp: Date.now() }];
}

/**
 * Resolve the summarizer model WITHOUT hardcoding a provider: prefer the
 * ACTIVE conversation model (`ctx.model`), else the first available registry
 * model. `undefined` → the caller falls through to default compaction.
 */
function resolveModel(ctx: ExtensionContext) {
  return ctx.model ?? ctx.modelRegistry.getAvailable()[0];
}

/** Options for {@link createCompactionGuard} (the StateMirrorOptions injection pattern). */
export interface CompactionGuardOptions {
  /** Resolved extension config; only the `compactionPreservation` toggle is read here. */
  config: InterrogatorConfig;
  /** The factory's single StateMirror instance (index.ts) — flush() only, never dispose(). */
  mirror: Pick<StateMirror, "flush">;
  /** State source override (tests); defaults to the state.ts singleton getter. */
  getState?: () => InterrogationState | undefined;
}

/**
 * Subscribe the `session_before_compact` preservation handler (h2.42/FR-29,
 * adapted — see the [Mode A] module JSDoc). ONE instance per extension
 * activation, created in the index.ts factory with the SAME config and mirror
 * the rest of the extension shares. Reason-agnostic: manual /compact,
 * threshold, and overflow compaction all flow through the same handler.
 *
 * With no active interrogation (or the toggle off) the handler returns
 * `undefined` immediately — zero-cost default compaction, no model call.
 */
export function createCompactionGuard(pi: Pick<ExtensionAPI, "on">, opts: CompactionGuardOptions): void {
  const resolveState = opts.getState ?? getState;
  const { config, mirror } = opts;

  pi.on("session_before_compact", async (event, ctx) => {
    // 1. Toggle off → default compaction, zero cost.
    if (!config.compactionPreservation) return undefined;
    // 2. No active interrogation → default compaction (never waste a model
    //    call summarizing a context with nothing to preserve).
    const state = resolveState();
    if (state === undefined || state.orderedQuestions().length === 0) return undefined;
    try {
      // 3. Flush the mirror FIRST — a fresh `interrogation-state` entry lands
      //    even if everything below fails, so post-compaction read()
      //    reconstruction (P1.M7.T1.S2) always finds full state.
      mirror.flush();
      // 4. Resolve the summarizer model (active model, else registry; never a
      //    hardcoded provider). None → default compaction.
      const model = resolveModel(ctx);
      if (!model) return undefined;
      // 5-6. Summarize with the preservation instructions prepended; the
      //      event's AbortSignal is ALWAYS forwarded so user-cancelled
      //      compaction aborts the model call.
      const messages = buildPreservationPrompt(event.preparation);
      const response = await ctx.modelRegistry.complete(
        model,
        { messages },
        { maxTokens: 8192, signal: event.signal, cacheRetention: "none", sessionId: uuidv7() },
      );
      // 7. Join text blocks; blank summary or aborted signal → default
      //    compaction (the example's fall-through discipline).
      const summary = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      if (!summary.trim() || event.signal.aborted) return undefined;
      // 8. Hand the summary to pi (SessionManager adds id/parentId).
      return {
        compaction: {
          summary,
          firstKeptEntryId: event.preparation.firstKeptEntryId,
          tokensBefore: event.preparation.tokensBefore,
          usage: response.usage,
        },
      };
    } catch (err) {
      // 9. ANY failure → single console.error line, default compaction.
      //    NEVER throw, NEVER cancel, NEVER block compaction.
      console.error("interrogator: preservation compaction failed, using default compaction", err);
      return undefined;
    }
  });
}

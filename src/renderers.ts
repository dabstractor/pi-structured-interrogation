/**
 * src/renderers.ts — user-only custom message renderers
 * (P1.M7.T3.S1; h2.36 ui-spec Renderers).
 *
 * Draws the compact submission diff card for `interrogation-submission`
 * custom messages (built by delivery.ts `buildSubmission`, P1.M2.T1.S1).
 * The card is USER-ONLY visual (h2.36): the model reads `message.content`
 * (the ≤3-line delta), never the card — the renderer reads only
 * `message.details.card` and formats it. It never touches live
 * interrogation state and never mutates the message.
 *
 * Two exports (P1.M7.T3.S1):
 *
 * 1. {@link buildSubmissionCard} — the PURE, testable builder:
 *    `(message, { expanded, outputPad }, theme) => Text | Box`. Collapsed
 *    by default (budgeted); `expanded` shows the full submission.
 * 2. {@link registerSubmissionCardRenderer} — the thin registration shim
 *    called ONCE from the index.ts factory; matches the EXACT customType
 *    `"interrogation-submission"` (the same literal delivery.ts ships).
 *
 * P1.M7.T3.S2 appends two more display surfaces to this file — same
 * shape (pure build function + thin registration shim), additive only:
 *
 * 3. {@link buildCompletionRecapCard} — the `interrogation-completion`
 *    recap card (AC-14): goal header, every grouped question with its
 *    final answer and ★, completion timestamp; expanded adds the
 *    withdrawn/moot reasons, full free-text, NOTES and the epoch line.
 * 4. {@link buildStateEntryMarker} — the `interrogation-state` mirror
 *    entry marker: ONE dim, non-interactive audit line (h2.40 layer 3).
 *
 * [Mode A] Display budgets (collapsed):
 * - Header line: `Submitted {k} changed · epoch {n}` (k = change count).
 * - One line per changed answer, capped at {@link COLLAPSED_ENTRY_CAP}
 *   entries with a `+{m} more` rollup line when exceeded.
 * - Each entry/note line is truncated to {@link COLLAPSED_LINE_BUDGET}
 *   visible columns via `truncateToWidth` (ANSI-aware; never String.slice).
 *   A very long entry may therefore lose its `(changed)` suffix to the
 *   budget — the budget is the contract.
 * - `NOTE: {note}` line only when a note shipped (card.note is ABSENT, not
 *   empty, when none — truthiness check).
 * - Footer `{remainOpen} remain open`.
 *
 * [Mode A] Display budgets (expanded):
 * - NO truncation, NO entry cap: every changed entry in full, the note in
 *   full. The header omits the inline epoch (it moves to a dedicated dim
 *   `epoch {n}` footer line so it is not rendered twice).
 *
 * GOTCHAS honored here: relative imports use `.js` (repo ESM convention);
 * theme.fg is applied PER LINE (styles don't survive Text wrapping across
 * lines); truncateToWidth runs AFTER composing the themed string; the
 * renderer is synchronous, cheap, and never throws on sparse shapes — a
 * message without `details.card` falls back to the plain content text.
 */
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Box, Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { CompletionMessage } from "./delivery.js";
import { INTERROGATION_STATE_ENTRY_TYPE } from "./persistence.js";
import type { SubmissionCardData } from "./snapshots.js";

/** Visible-column budget for each collapsed card line (h2.36 compact card). */
export const COLLAPSED_LINE_BUDGET = 80;

/**
 * Max changed-answer lines shown collapsed; overflow rolls up into a
 * `+{m} more` line instead of unbounded vertical growth.
 */
export const COLLAPSED_ENTRY_CAP = 8;

/** AC-13 suffix (theme-styled) for `editedArchived` entries. */
const CHANGED_MARKER = " (changed)";

/** Two-space indent shared by entry/note lines (header/footer are flush). */
const INDENT = "  ";

/**
 * Renderer options as delivered by pi (extensions.md
 * registerMessageRenderer): `expanded` from the ctrl+o toggle, `outputPad`
 * from the outputPad setting.
 */
export interface CardRenderOptions {
  expanded: boolean;
  outputPad: number;
}

/**
 * Minimal structural slice of a SubmissionMessage (delivery.ts) that the
 * card renderer needs: the model-facing content (fallback text) and the
 * optional `details.card`. Kept narrow so tests can pass plain literals
 * and the shim stays a one-liner.
 */
export interface SubmissionCardMessage {
  content: string;
  details?: { card?: SubmissionCardData };
}

/**
 * Build the submission diff card component (PURE — a function of the
 * message and options only; reads no live state, mutates nothing).
 *
 * Collapsed (default, h2.36 compact):
 *
 * ```
 * Submitted {k} changed · epoch {n}
 *   {title}: {from} → {to}[ (changed)]     ← ≤ cap lines, 80-col truncation
 *   [+{m} more]                            ← rollup when over the cap
 *   [NOTE: {note}]                         ← only when a note shipped
 * {remainOpen} remain open
 * ```
 *
 * `editedArchived` entries get the ` (changed)` suffix styled
 * `theme.fg("warning", …)` (AC-13); the `NOTE:` label is styled
 * `theme.fg("accent", …)`; header suffix and footer are
 * `theme.fg("muted", …)`. Every line is a separate Text child inside a
 * padding-free Box so per-line theming survives rendering.
 *
 * Expanded: the same card with NO truncation and NO entry cap — every
 * changed entry in full and the note in full — plus a dim
 * `epoch {n}` footer line (the collapsed header's inline `· epoch {n}`
 * moves here so the epoch is never rendered twice).
 *
 * Defensive: a message without `details` or `details.card` (sparse shape,
 * foreign message, older payload) renders the plain `message.content`
 * text instead of throwing.
 *
 * @param message narrow slice of the custom message ({@link SubmissionCardMessage})
 * @param options `{ expanded, outputPad }` as delivered by pi
 * @param theme   active TUI theme (fg/bold helpers)
 * @returns a Text (fallback) or a Box with one Text child per card line
 */
export function buildSubmissionCard(
  message: SubmissionCardMessage,
  options: CardRenderOptions,
  theme: Theme,
): Text | Box {
  const card = message.details?.card;
  if (!card) {
    // Defensive fallback (tool.ts renderResult pattern): no card data →
    // render the model-facing content verbatim. outputPad is applied as
    // the Text's horizontal padding, mirroring the docs example.
    return new Text(message.content, options.outputPad, 0);
  }

  const { expanded, outputPad } = options;
  // Sparse-shape guard: changed should always be an array (computeDiff
  // guarantees it) but a hand-built payload may omit it.
  const entries = Array.isArray(card.changed) ? card.changed : [];
  const remainOpen = typeof card.remainOpen === "number" ? card.remainOpen : 0;
  const epoch = typeof card.epoch === "number" ? card.epoch : 0;

  const box = new Box(0, 0);

  // Header. Collapsed carries the epoch inline (one compact line);
  // expanded gets the dedicated dim epoch footer instead (no duplication).
  const headerSuffix = expanded
    ? ` ${entries.length} changed`
    : ` ${entries.length} changed · epoch ${epoch}`;
  box.addChild(
    new Text(
      theme.fg("toolTitle", theme.bold("Submitted")) + theme.fg("muted", headerSuffix),
      outputPad,
      0,
    ),
  );

  // Entry lines — one Text child per line (per-line theming; styles do not
  // survive across lines of a single Text). truncateToWidth runs AFTER the
  // themed string is composed (it is ANSI-aware); String.slice would be
  // ANSI-unsafe. Collapsed truncates to the budget; expanded never does.
  const shown = expanded ? entries : entries.slice(0, COLLAPSED_ENTRY_CAP);
  for (const e of shown) {
    let line = `${INDENT}${e?.title ?? ""}: ${e?.from ?? ""} → ${e?.to ?? ""}`;
    if (e?.editedArchived) line += theme.fg("warning", CHANGED_MARKER); // AC-13
    box.addChild(new Text(expanded ? line : truncateToWidth(line, COLLAPSED_LINE_BUDGET), outputPad, 0));
  }

  // Collapsed cap rollup: summarize what the budget hid.
  if (!expanded && entries.length > COLLAPSED_ENTRY_CAP) {
    const rollup = `${INDENT}+${entries.length - COLLAPSED_ENTRY_CAP} more`;
    box.addChild(new Text(truncateToWidth(theme.fg("muted", rollup), COLLAPSED_LINE_BUDGET), outputPad, 0));
  }

  // NOTE line — card.note is ABSENT (not empty string) when no note shipped
  // (computeDiff omits it), so truthiness — never .length.
  if (card.note) {
    const line = `${INDENT}${theme.fg("accent", "NOTE:")} ${card.note}`;
    box.addChild(new Text(expanded ? line : truncateToWidth(line, COLLAPSED_LINE_BUDGET), outputPad, 0));
  }

  // Footer.
  box.addChild(new Text(theme.fg("muted", `${remainOpen} remain open`), outputPad, 0));

  // Expanded-only dim epoch line.
  if (expanded) {
    box.addChild(new Text(theme.fg("dim", `epoch ${epoch}`), outputPad, 0));
  }

  return box;
}

/**
 * Register the user-only submission card renderer with pi. Called ONCE
 * from the index.ts factory. Matches the EXACT customType
 * `"interrogation-submission"` (the literal delivery.ts
 * SubmissionMessage ships). Thin shim only — all behavior lives in the
 * pure {@link buildSubmissionCard}.
 *
 * The message renderer callback narrows pi's `CustomMessage` (whose
 * `content` may theoretically be a content-part array and whose `details`
 * is typed `unknown`) into the {@link SubmissionCardMessage} slice.
 *
 * @param pi narrowest surface — `Pick<ExtensionAPI, "registerMessageRenderer">`
 *           — so tests can pass a one-method stub without a full ExtensionAPI
 */
export function registerSubmissionCardRenderer(
  pi: Pick<ExtensionAPI, "registerMessageRenderer">,
): void {
  pi.registerMessageRenderer<{ card?: SubmissionCardData }>(
    "interrogation-submission",
    (message, options, theme) =>
      buildSubmissionCard(
        {
          content: typeof message.content === "string" ? message.content : "",
          details: message.details,
        },
        options,
        theme,
      ),
  );
}

/* ───────────────────────────────────────────────────────────────────────
 * Completion recap card + state mirror entry marker (P1.M7.T3.S2)
 *
 * Consumes two live contracts, read-only:
 * - delivery.ts `CompletionMessage.details` (P1.M2.T1.S3) for the recap
 *   card rendered from the one-time completion message (h3.9/AC-14).
 * - persistence.ts `INTERROGATION_STATE_ENTRY_TYPE` (P1.M7.T1.S1) for the
 *   mirror entry marker (h2.40 layer 3 audit trail).
 * ─────────────────────────────────────────────────────────────────────── */

/**
 * Narrow slice of the completion payload the recap card reads:
 * `CompletionMessage["details"]` (delivery.ts, P1.M2.T1.S3).
 */
export type CompletionRecapDetails = CompletionMessage["details"];

/**
 * Renderer options as delivered by pi for ENTRY renderers
 * (extensions.md registerEntryRenderer): `expanded` only — entries get
 * NO `outputPad` (message renderers do).
 */
export interface MarkerRenderOptions {
  expanded: boolean;
}

/**
 * Structural subset of persistence.ts's {@link InterrogationStateEntryData}
 * ({ state: SerializedState; epoch: number; at: string }) that the mirror
 * marker needs. `state` is deliberately NOT in the type: the mirror is a
 * one-line audit marker, never a state view (h2.36). Both keys are optional
 * so a sparse/foreign payload still renders (`epoch ?`).
 */
export interface StateMirrorData {
  /** state.epoch at flush time; absent → "?" in the marker line. */
  epoch?: number;
  /** ISO flush timestamp; expanded-only detail line when present. */
  at?: string;
}

/**
 * Build the completion recap card component (PURE — a function of its
 * arguments only; reads no live state, calls no pi API, mutates nothing).
 *
 * Data contract — `CompletionMessage["details"]` (delivery.ts):
 * - `goal: string` — interrogation goal (header).
 * - `groups: CompletionRecapGroup[]` — `{ group, questions }` in
 *   first-appearance order; entries are `CompletionRecapEntry`
 *   `{ id, title, answer, star, freeText?, answeredAt? }` where the
 *   `freeText`/`answeredAt` keys are OMITTED when absent (truthiness —
 *   never `.length`).
 * - `notes: string[]` — batch notes in order; may be [].
 * - `withdrawnMoot: { id, status: "withdrawn"|"moot", reason }[]` —
 *   reasons are PRE-COMPUTED by delivery; the renderer never re-evaluates
 *   dependencies. May be [].
 * - `completedAt: string` (ISO), `epoch: number` (frozen at build).
 *
 * [Mode A] Display budgets (collapsed — AC-14):
 * - Header `INTERROGATION COMPLETE — {goal}` (toolTitle+bold title).
 * - One line per question, grouped: `[group] {id} {title}: {answer}{ ★}`
 *   (★ accent-styled when the answer followed the recommendation). Each
 *   line — free-text included — is truncated to {@link COLLAPSED_LINE_BUDGET}
 *   visible columns via truncateToWidth (ANSI-aware; never String.slice).
 * - Dim footer `completed {toLocaleString}`; plus `{n} withdrawn/moot`
 *   count hint when n > 0 (details are expanded-only).
 *
 * [Mode A] Display budgets (expanded):
 * - NO truncation: `— {freeText}` in full on the question line, a dim
 *   `answered {toLocaleString}` line under each answered question,
 *   `NOTE: {note}` per details.notes (section skipped silently when
 *   empty), a `Withdrawn/moot:` section with `{id} ({status}: {reason})`
 *   lines (or `(none)`), the dim `completed …` footer, and a dim
 *   `epoch {n}` line. The collapsed count hint is suppressed — the full
 *   section replaces it.
 *
 * Defensive: undefined `details` or empty/absent `groups` renders plain
 * `fallbackContent` (the shim passes message.content) as a Text.
 *
 * @param details CompletionMessage["details"] (may be undefined)
 * @param options `{ expanded, outputPad }` as delivered by pi
 * @param theme   active TUI theme (fg/bold helpers)
 * @param fallbackContent plain text shown when details are missing/empty
 * @returns a Text (fallback) or a Box with one Text child per card line
 */
export function buildCompletionRecapCard(
  details: CompletionRecapDetails | undefined,
  options: CardRenderOptions,
  theme: Theme,
  fallbackContent = "",
): Text | Box {
  // Sparse-shape guard: groups should always be a non-empty array
  // (buildCompletion guarantees it) but a hand-built payload may omit it.
  const groups = details && Array.isArray(details.groups) ? details.groups : [];
  if (!details || groups.length === 0) {
    // Defensive fallback (buildSubmissionCard pattern): no details →
    // render the model-facing content verbatim (outputPad as h-padding).
    return new Text(fallbackContent, options.outputPad, 0);
  }

  const { expanded, outputPad } = options;
  const notes = Array.isArray(details.notes) ? details.notes : [];
  const withdrawnMoot = Array.isArray(details.withdrawnMoot) ? details.withdrawnMoot : [];
  const epoch = typeof details.epoch === "number" ? details.epoch : 0;

  const box = new Box(0, 0);

  // Header — S1's toolTitle+bold pattern; goal plain for readability.
  box.addChild(
    new Text(
      theme.fg("toolTitle", theme.bold("INTERROGATION COMPLETE")) + ` — ${details.goal}`,
      outputPad,
      0,
    ),
  );

  // Question lines — one Text child per line (per-line theming; styles do
  // not survive across lines of a single Text). Collapsed truncates the
  // whole themed line to the shared budget (free-text included; composed
  // first, truncated after — truncateToWidth is ANSI-aware). Expanded never
  // truncates and adds the dim answeredAt line under answered questions.
  for (const g of groups) {
    const questions = Array.isArray(g?.questions) ? g.questions : [];
    for (const q of questions) {
      let line = `[${g?.group ?? ""}] ${q?.id ?? ""} ${q?.title ?? ""}: ${q?.answer ?? ""}`;
      if (q?.star) line += ` ${theme.fg("accent", "★")}`;
      if (q?.freeText) line += ` — ${q.freeText}`; // key omitted when absent → truthiness
      box.addChild(new Text(expanded ? line : truncateToWidth(line, COLLAPSED_LINE_BUDGET), outputPad, 0));
      if (expanded && q?.answeredAt) {
        box.addChild(
          new Text(
            theme.fg("dim", `${INDENT}answered ${new Date(q.answeredAt).toLocaleString()}`),
            outputPad,
            0,
          ),
        );
      }
    }
  }

  // NOTES — expanded-only, one line per note; skipped silently when empty.
  if (expanded) {
    for (const note of notes) {
      if (!note) continue;
      box.addChild(new Text(`${INDENT}${theme.fg("accent", "NOTE:")} ${note}`, outputPad, 0));
    }
  }

  // Withdrawn/moot — collapsed gets a count hint, expanded the full
  // pre-computed reasons (never re-evaluated here — renderer stays pure).
  if (expanded) {
    box.addChild(new Text(theme.fg("accent", "Withdrawn/moot:"), outputPad, 0));
    if (withdrawnMoot.length === 0) {
      box.addChild(new Text(`${INDENT}(none)`, outputPad, 0));
    } else {
      for (const w of withdrawnMoot) {
        box.addChild(new Text(`${INDENT}${w?.id ?? ""} (${w?.status ?? "?"}: ${w?.reason ?? ""})`, outputPad, 0));
      }
    }
  }

  // Footer — completion timestamp in both modes (dim). Collapsed adds the
  // count hint when anything was withdrawn/moot; expanded adds the epoch
  // line instead (the full section replaced the hint).
  if (details.completedAt) {
    box.addChild(
      new Text(theme.fg("dim", `completed ${new Date(details.completedAt).toLocaleString()}`), outputPad, 0),
    );
  }
  if (!expanded && withdrawnMoot.length > 0) {
    box.addChild(new Text(theme.fg("dim", `${withdrawnMoot.length} withdrawn/moot`), outputPad, 0));
  }
  if (expanded) {
    box.addChild(new Text(theme.fg("dim", `epoch ${epoch}`), outputPad, 0));
  }

  return box;
}

/**
 * Build the state mirror marker component (PURE): ONE dim line — the
 * whole audit marker spec (h2.36) — never a dump of `data.state`.
 *
 * Collapsed/expanded: `· interrogation state @ epoch {n}` (theme.fg dim).
 * Expanded adds a second dim line with the flush timestamp
 * (`new Date(at).toLocaleString()`) when `at` shipped — kept minimal per
 * h2.36: the mirror is a marker, not a state view.
 *
 * Defensive: missing data or missing epoch renders `epoch ?`.
 *
 * @param data    structural subset of InterrogationStateEntryData (may be undefined)
 * @param options `{ expanded }` as delivered by pi (entries have NO outputPad)
 * @param theme   active TUI theme (fg/bold helpers)
 * @returns a Box with one (collapsed) or two (expanded) Text children
 */
export function buildStateEntryMarker(
  data: StateMirrorData | undefined,
  options: MarkerRenderOptions,
  theme: Theme,
): Text | Box {
  const epoch = typeof data?.epoch === "number" ? data.epoch : "?";
  const box = new Box(0, 0);
  box.addChild(new Text(theme.fg("dim", `· interrogation state @ epoch ${epoch}`), 0, 0));
  if (options.expanded && data?.at) {
    box.addChild(new Text(theme.fg("dim", new Date(data.at).toLocaleString()), 0, 0));
  }
  return box;
}

/**
 * Register the user-only completion recap card renderer with pi. Called
 * ONCE from the index.ts factory. Matches the EXACT customType
 * `"interrogation-completion"` (the literal delivery.ts CompletionMessage
 * ships). Thin shim only — all behavior lives in the pure
 * {@link buildCompletionRecapCard}.
 *
 * The message renderer callback narrows pi's `CustomMessage` (whose
 * `content` may theoretically be a content-part array and whose `details`
 * is typed `unknown`) into the recap slice, passing content separately as
 * the defensive fallback text.
 *
 * @param pi narrowest surface — `Pick<ExtensionAPI, "registerMessageRenderer">`
 *           — so tests can pass a one-method stub without a full ExtensionAPI
 */
export function registerCompletionRecapRenderer(
  pi: Pick<ExtensionAPI, "registerMessageRenderer">,
): void {
  pi.registerMessageRenderer<CompletionMessage["details"]>(
    "interrogation-completion",
    (message, options, theme) =>
      buildCompletionRecapCard(
        message.details,
        options,
        theme,
        typeof message.content === "string" ? message.content : "",
      ),
  );
}

/**
 * Register the state mirror entry renderer with pi. Called ONCE from the
 * index.ts factory. Matches the EXACT customType via persistence.ts's
 * exported {@link INTERROGATION_STATE_ENTRY_TYPE} const — never the
 * hardcoded string. Thin shim only — all behavior lives in the pure
 * {@link buildStateEntryMarker}.
 *
 * Entries are durable and NOT in LLM context (extensions.md); the generic
 * types `entry.data` as the narrow {@link StateMirrorData} slice (pi types
 * it `data?: T`, so undefined flows straight into the defensive builder).
 *
 * @param pi narrowest surface — `Pick<ExtensionAPI, "registerEntryRenderer">`
 *           — so tests can pass a one-method stub without a full ExtensionAPI
 */
export function registerStateEntryRenderer(pi: Pick<ExtensionAPI, "registerEntryRenderer">): void {
  pi.registerEntryRenderer<StateMirrorData>(
    INTERROGATION_STATE_ENTRY_TYPE,
    (entry, options, theme) => buildStateEntryMarker(entry.data, options, theme),
  );
}

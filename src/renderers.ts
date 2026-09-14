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
 * Two exports:
 *
 * 1. {@link buildSubmissionCard} — the PURE, testable builder:
 *    `(message, { expanded, outputPad }, theme) => Text | Box`. Collapsed
 *    by default (budgeted); `expanded` shows the full submission.
 * 2. {@link registerSubmissionCardRenderer} — the thin registration shim
 *    called ONCE from the index.ts factory; matches the EXACT customType
 *    `"interrogation-submission"` (the same literal delivery.ts ships).
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

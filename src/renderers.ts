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
 * P1.M7.T3.S2 appends one more display surface to this file — same
 * shape (pure build function + thin registration shim), additive only:
 *
 * 3. {@link buildCompletionRecapCard} — the `interrogation-completion`
 *    recap card (AC-14): goal header, every grouped question with its
 *    final answer and ★, completion timestamp; expanded adds the
 *    withdrawn/moot reasons, full free-text, NOTES and the epoch line.
 *
 * [Mode A] Display budgets (collapsed) — FULL-TRANSCRIPT-001 (2026-10-19
 * owner ruling, h2.36 amendment): the card is the user's DURABLE record of
 * what they told the model, so user-authored input is NEVER truncated,
 * capped, or hidden — in EITHER mode:
 * - Header line: `Submitted {k} changed · epoch {n}` (k = change count).
 * - One line per changed answer — ALL of them, no entry cap — each showing
 *   the full `{from} → {to}` summary (write-ins as `✎ {text}`, elaborations
 *   as `— {text}`; single-line via the " / " flatten, never column-cut).
 * - Under each entry, a dim indented line with the FULL question prompt
 *   whenever the entry carries a `prompt` the title does not already show
 *   in full (DiffEntry.prompt; prompt-only questions render it as the
 *   title line itself — never duplicated).
 * - `NOTE: {note}` line only when a note shipped (card.note is ABSENT, not
 *   empty, when none — truthiness check), in full.
 * - Footer `{remainOpen} remain open`.
 *
 * [Mode A] Display budgets (expanded):
 * - IDENTICAL user-input content (the full-transcript rule is mode-blind);
 * - the header omits the inline epoch (it moves to a dedicated dim
 *   `epoch {n}` footer line so it is not rendered twice).
 *
 * The collapsed/expanded toggle therefore differentiates METADATA only —
 * never what the user said. The old 80-column truncation and 8-entry cap
 * are DELETED (superseded; the same FR-23 "nothing is truncated" principle
 * the panel already follows).
 *
 * GOTCHAS honored here: relative imports use `.js` (repo ESM convention);
 * theme.fg is applied PER LINE (styles don't survive Text wrapping across
 * lines); every full-text line passes through {@link flattenLine} so a
 * literal newline can never desync the differential renderer's row model
 * (the SANITIZE-001 lesson — display-only; `details` keep raw text); the
 * renderer is synchronous, cheap, and never throws on sparse shapes — a
 * message without `details.card` falls back to the plain content text.
 */
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import type { CompletionMessage } from "./delivery.js";
import { UNANSWERED_SUMMARY, type SubmissionCardData } from "./snapshots.js";

/**
 * Display-only single-line flatten for full-text card lines (FULL-TRANSCRIPT-001):
 * newline/tab runs collapse to `" / "` — the same grammar the model-visible
 * NOTE/continuation lines use (BUG-006). The user sees the same single-line
 * form the model received, while `details` keep the raw multi-line text.
 * Row-model safety (SANITIZE-001 lesson): pi-tui paints each array element
 * as one terminal row, so a literal `\n` inside a card line would execute a
 * real line feed and desync the differential renderer.
 */
const flattenLine = (s: string): string => s.replace(/[\n\t]+/g, " / ");

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
 * FULL-TRANSCRIPT-001 (h2.36 amendment, 2026-10-19): the card is the
 * user's durable look-back record of exactly what they told the model —
 * question text, answer, elaboration, note — so user-authored input
 * renders IN FULL in BOTH modes. Collapsed (default):
 *
 * ```
 * Submitted {k} changed · epoch {n}
 *   {title}: {to}[ (changed)]              ← FIRST answers — never
 *                                           "(unanswered)" (ALL entries,
 *                                           never column-truncated)
 *   {title}: {from} → {to}[ (changed)]     ← RE-answers (real prior answer)
 *     {prompt}                              ← dim, ONLY when the title does
 *                                           not already show the full prompt
 *   [NOTE: {note}]                         ← only when a note shipped, in full
 * {remainOpen} remain open
 * ```
 *
 * `editedArchived` entries get the ` (changed)` suffix styled
 * `theme.fg("warning", …)` (AC-13); the `NOTE:` label is styled
 * `theme.fg("accent", …)`; header suffix and footer are
 * `theme.fg("muted", …)`; prompt lines are `theme.fg("dim", …)`. Every
 * line is a separate Text child inside a padding-free Box so per-line
 * theming survives rendering.
 *
 * Expanded: IDENTICAL user-input content (the full-transcript rule is
 * mode-blind) — plus a dim `epoch {n}` footer line (the collapsed header's
 * inline `· epoch {n}` moves here so the epoch is never rendered twice).
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
  // survive across lines of a single Text). FULL-TRANSCRIPT-001: EVERY
  // changed entry renders in BOTH modes — no entry cap, no rollup, no
  // column truncation; `to`/`from` are already single-line (BUG-006 flatten
  // in snapshots.answerSummary) and carry the elaboration (`— {text}`,
  // NEW-003) in full. Write-in answers (h2.42) arrive PRE-PREFIXED as
  // `✎ {text}` in from/to from the summary layer — no special-casing here.
  for (const e of entries) {
    // A FIRST-TIME answer never renders the "(unanswered)" sentinel as the
    // from side — "Question q1: (unanswered) → Alpha" reads as unanswered
    // AFTER the user answered it. First answers render `{title}: {to}`
    // alone; only re-answers — a real prior answer existed — show
    // `{from} → {to}`. Answer CLEARANCES keep the full form:
    // `Alpha → (unanswered)` is honest (the question IS unanswered now).
    const from = e?.from ?? "";
    const hadPriorAnswer = from !== "" && from !== UNANSWERED_SUMMARY;
    let line = hadPriorAnswer
      ? `${INDENT}${e?.title ?? ""}: ${from} → ${flattenLine(e?.to ?? "")}`
      : `${INDENT}${e?.title ?? ""}: ${flattenLine(e?.to ?? "")}`;
    if (e?.editedArchived) line += theme.fg("warning", CHANGED_MARKER); // AC-13
    box.addChild(new Text(line, outputPad, 0));

    // FULL-TRANSCRIPT-001: the question's full prompt rides under the
    // entry — dim, indented one level deeper — ONLY when the entry carries
    // a `prompt` the title line does not already show in full (prompt-only
    // questions ARE their own title; legacy entries without the key render
    // the title line alone; the data layer omits equal prompts, and this
    // display-side check makes the dedupe defensive against hand-built
    // payloads). flattenLine keeps the row model safe on multi-line prompts
    // (SANITIZE-001 lesson).
    if (typeof e?.prompt === "string" && e.prompt !== "" && e.prompt !== (e?.title ?? "")) {
      box.addChild(
        new Text(theme.fg("dim", `${INDENT}${INDENT}${flattenLine(e.prompt)}`), outputPad, 0),
      );
    }
  }

  // NOTE line — card.note is ABSENT (not empty string) when no note shipped
  // (computeDiff omits it), so truthiness — never .length. FULL-TRANSCRIPT-
  // 001: in full, both modes (flattenLine for row-model safety).
  if (card.note) {
    const line = `${INDENT}${theme.fg("accent", "NOTE:")} ${flattenLine(card.note)}`;
    box.addChild(new Text(line, outputPad, 0));
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
 * Completion recap card (P1.M7.T3.S2)
 *
 * Consumes one live contract, read-only:
 * - delivery.ts `CompletionMessage.details` (P1.M2.T1.S3) for the recap
 *   card rendered from the one-time completion message (h3.9/AC-14).
 * ─────────────────────────────────────────────────────────────────────── */

/**
 * Narrow slice of the completion payload the recap card reads:
 * `CompletionMessage["details"]` (delivery.ts, P1.M2.T1.S3).
 */
export type CompletionRecapDetails = CompletionMessage["details"];

/*
 * The `interrogation-state` mirror ENTRIES (persistence.ts, h2.40 layer 3)
 * are intentionally NOT rendered: no entry renderer is registered for
 * them, and pi skips entries without a renderer — the entries stay
 * durable (post-restart reconstruction, reconstruct.ts) but invisible in
 * the transcript (owner ruling 2026-10-08: the accumulated
 * `· interrogation state @ epoch {n}` lines were noise between turns).
 */

/**
 * Build the completion recap card component (PURE — a function of its
 * arguments only; reads no live state, calls no pi API, mutates nothing).
 *
 * Data contract — `CompletionMessage["details"]` (delivery.ts):
 * - `goal: string` — interrogation goal (header).
 * - `groups: CompletionRecapGroup[]` — `{ group, questions }` in
 *   first-appearance order; entries are `CompletionRecapEntry`
 *   `{ id, title, prompt?, answer, star, freeText?, answeredAt? }` where the
 *   `prompt`/`freeText`/`answeredAt` keys are OMITTED when absent (truthiness —
 *   never `.length`).
 * - `notes: string[]` — batch notes in order; may be [].
 * - `withdrawnMoot: { id, status: "withdrawn"|"moot", reason }[]` —
 *   reasons are PRE-COMPUTED by delivery; the renderer never re-evaluates
 *   dependencies. May be [].
 * - `completedAt: string` (ISO), `epoch: number` (frozen at build).
 *
 * [Mode A] Display budgets (collapsed — AC-14, FULL-TRANSCRIPT-001
 * amendment 2026-10-19: user-authored input is never truncated or hidden in
 * either mode):
 * - Header `INTERROGATION COMPLETE — {goal}` (toolTitle+bold title).
 * - One line per question, grouped: `[group] {id} {title}: {answer}{ ★}`
 *   (★ accent-styled when the answer followed the recommendation), with
 *   `— {freeText}` in full on the line — write-ins as `✎ {text}` — plus a
 *   dim indented line with the FULL prompt when the entry carries one the
 *   title does not already show in full. NEVER column-truncated.
 * - `NOTE: {note}` per details.notes — user input, so BOTH modes (section
 *   skipped silently when empty).
 * - Dim footer `completed {toLocaleString}`; plus `{n} withdrawn/moot`
 *   count hint when n > 0 (agent-side metadata: reasons are expanded-only).
 *
 * [Mode A] Display budgets (expanded):
 * - The same never-truncated user-input lines, plus METADATA: a dim
 *   `answered {toLocaleString}` line under each answered question, a
 *   `Withdrawn/moot:` section with `{id} ({status}: {reason})` lines (or
 *   `(none)`), the dim `completed …` footer, and a dim `epoch {n}` line.
 *   The collapsed count hint is suppressed — the full section replaces it.
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
  // not survive across lines of a single Text). FULL-TRANSCRIPT-001: never
  // column-truncated in EITHER mode — answer + free-text render in full
  // (flattenLine keeps multi-line text row-safe, SANITIZE-001 lesson). Under
  // each line, the FULL prompt when the entry carries one the title does
  // not already show. Expanded additionally adds the dim answeredAt line
  // under answered questions (metadata, mode-gated).
  for (const g of groups) {
    const questions = Array.isArray(g?.questions) ? g.questions : [];
    for (const q of questions) {
      let line = `[${g?.group ?? ""}] ${q?.id ?? ""} ${q?.title ?? ""}: ${flattenLine(q?.answer ?? "")}`;
      if (q?.star) line += ` ${theme.fg("accent", "★")}`;
      if (q?.freeText) line += ` — ${flattenLine(q.freeText)}`; // key omitted when absent → truthiness
      box.addChild(new Text(line, outputPad, 0));
      if (
        typeof q?.prompt === "string" &&
        q.prompt !== "" &&
        q.prompt !== (q?.title ?? "")
      ) {
        box.addChild(
          new Text(theme.fg("dim", `${INDENT}${flattenLine(q.prompt)}`), outputPad, 0),
        );
      }
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

  // NOTES — user-authored input (FULL-TRANSCRIPT-001): BOTH modes, one line
  // per note in full; skipped silently when empty.
  for (const note of notes) {
    if (!note) continue;
    box.addChild(new Text(`${INDENT}${theme.fg("accent", "NOTE:")} ${flattenLine(note)}`, outputPad, 0));
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

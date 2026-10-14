/**
 * src/panel/short-view.ts — short-view options region renderer
 * (P1.M3.T2.S1): option lines with cursor `▸`, the `★` recommendation mark,
 * recommendation preselect, the `✎ Other — write your own` write-in row
 * (WRITEIN-001), moot/withdrawn
 * variants, and the primary text-field affordance for `type: "text"`
 * questions.
 *
 * MODE A CONTRACT — MARKER GLYPH VOCABULARY (h2.29 / FR-11, panel-wide):
 *
 * - `·`  open question (question-line marker — layout.ts)
 * - `★`  recommended option (this module); question lines reuse it as the
 *        answered/text-answer marker (layout.ts statusMarkers)
 * - `⟳`  re-asked (question-line marker — layout.ts)
 * - `⊘`  moot (this module's reason line; also layout.ts markers)
 * - `⊗`  withdrawn (this module's single line; also layout.ts markers)
 * - `✎`  free-text affordance / has-text answer (this module; layout.ts)
 * - `▸`  cursor (this module; movement keys are P1.M3.T2.S2)
 *
 * WHY ★ AND PRESELECT COEXIST (R2 — hard requirement from user tooling
 * evaluations): a recommendation that isn't unmistakable is a disqualifying
 * failure. The `★` keeps the recommendation visible on its row wherever the
 * cursor wanders — but since ANSWER-PIN-001 (FR-35) the PRESELECT belongs
 * to the recorded answer on revisits: {@link initialCursorIndex} seeds the
 * ★ line only while the question is UNANSWERED (`▸ ★ sqlite` on first
 * render); once an answer exists the cursor pins to the answer's row and
 * the ★ stays visible but never re-owns the caret. The preselect is a
 * cursor position, never an implicit answer — there is deliberately NO
 * bulk-accept affordance (Q15=A).
 *
 * MODE A CONTRACT — ALIGNMENT (the whole game):
 *
 * - The cursor prefix is `▸ ` (2 visible cols); the non-cursor prefix is
 *   two spaces, so labels stay column-aligned between cursor and non-cursor
 *   lines.
 * - The star is `★ ` inserted between prefix and label: `▸ ★ label` and
 *   `  ★ label` both place the label at 4 visible cols, `▸ label` at 2.
 *   Both starred prefixes total 4 visible cols.
 * - Content lines are inset 2 columns inside the panel border
 *   (questionnaire.ts pattern): render into a `width - 2` budget, then
 *   prefix two spaces.
 * - Glyph widths are NEVER assumed — truncation and assertions go through
 *   visibleWidth/truncateVisible (ANSI- and wide-char-safe; never
 *   String.prototype.slice on display text).
 *
 * Purity: (question, cursorIndex, theme, width) → string[]. No pi imports
 * beyond the Theme type, no state mutation, no I/O, no key handling.
 * Navigation (↑/↓, enter accept) is P1.M3.T2.S2; editor
 * composition on the ✎ affordance is P1.M4.T1.S2; gate/late dimming is
 * P1.M5.T3.S1. The deep view (P1.M5.T1.S1) reuses the ★/▸ line style.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Question, QuestionOption } from "../state.js";
import { truncateVisible } from "./layout.js";

// ---------------------------------------------------------------- constants

/** Two-column inset applied to every line (questionnaire.ts pattern). */
const INSET = "  ";
/** Cursor prefix — exactly 2 visible cols so labels align with "  ". */
const CURSOR = "▸ ";
/** Non-cursor prefix — two spaces, same width as the cursor prefix. */
const BLANK = "  ";
/**
 * D-R13 (2026-09-30): 2-col RIGHT margin — answers sit equidistant from the
 * pane frame's left and right edges (variation A, live-review pass).
 */
export const RIGHT = "  ";
/** Recommendation mark inserted between prefix and label. */
const STAR = "★ ";
/**
 * The synthetic write-in row (WRITEIN-001, FR-D1): every choice question's
 * options list ends here; accepting it (P1.M2.T2.S1) makes the embedded
 * editor the WRITE-IN surface whose committed text IS the answer
 * (`custom: true`). Fixed label — deliberately NOT configurable and NOT
 * quick-selectable; reachable only via the cursor (h2.32/h2.36, as amended
 * by DIGIT-OUT-001); it replaces the retired explain affordance in the same
 * last-row cursor slot (the elaboration duty moved
 * to `ctrl+t`, P1.M2.T3.S1). Exported for deep-view.ts's synthetic Other
 * section (P1.M2.T6.S1) — single source of truth so the label never drifts
 * between views.
 */
export const OTHER_AFFORDANCE = "✎ Other — write your own";
/** Placeholder for the primary text-field affordance (text questions). */
const TEXT_PLACEHOLDER = "answer…";
/** Generic moot reason when state carries no derivable cause. */
const DEFAULT_MOOT_REASON = "dependency changed";
/** Moot reason line head (reason appended after this separator). */
const MOOT_HEAD = "⊘ moot — ";
/** Withdrawn questions collapse to this single dimmed line. */
const WITHDRAWN_LINE = "⊗ withdrawn";
/** Minimum visible cols for the ` — {ramification}` teaser, else omit it. */
const MIN_TEASER_WIDTH = 4;

// ------------------------------------------------------------------ helpers

/**
 * D-R13 (2026-09-30): DISPLAY order — recommended option first, the rest in
 * state order (stable). Presentation only: state stores nothing about the
 * order; the cursor domain and the ★ preselect both speak display
 * positions, and actions.acceptOptionIndex maps back at
 * its single seam. Exported (deep-view.ts sections render the same order).
 */
export function displayOptions(q: Question): QuestionOption[] {
  const options = q.options ?? [];
  if (q.recommendation === undefined) return options;
  const rec = options.find((o) => o.value === q.recommendation);
  if (rec === undefined) return options;
  return [rec, ...options.filter((o) => o !== rec)];
}

/**
 * Initial cursor position for a question (ANSWER-PIN-001 / FR-35): a
 * recorded answer OWNS the caret. Choice questions seed to the DISPLAY row
 * of `answer.value` (displayOptions order — D-R13); `custom: true` seeds to
 * the ✎ Other row (`options.length` — the trailing synthetic row the
 * renderers use); text questions to 0 (the affordance IS row 0 — the pin
 * is inherent). Pinning keys on `q.answer` PRESENCE alone, regardless of
 * status (moot keeps its dimmed answer and pins too); a stale answer value
 * (option removed post-upsert) clamps to display row 0 — NEVER a fallback
 * to the ★ recommendation. UNANSWERED questions keep the R2 ★ preselect:
 * the DISPLAY index of the recommendation (0 when set under D-R13),
 * clamped to 0 when unset or when the recommendation references a value no
 * longer in `options` (post-upsert). Status alone (e.g. `answered` with
 * the answer reset) does not imply pinning — only answer presence does.
 */
export function initialCursorIndex(q: Question): number {
  const answer = q.answer;
  if (answer === undefined) {
    // ★ preselect — UNANSWERED questions only (ANSWER-PIN-001).
    if (q.type === "text" || q.recommendation === undefined) return 0;
    const idx = displayOptions(q).findIndex((o) => o.value === q.recommendation);
    return idx >= 0 ? idx : 0;
  }
  // A recorded answer owns the caret (FR-35) — every status carrying an
  // answer pins here; no status gate.
  if (answer.custom === true) return (q.options ?? []).length; // ✎ Other row
  if (q.type === "text") return 0; // the text affordance IS row 0 — pin inherent
  const idx = displayOptions(q).findIndex((o) => o.value === answer.value);
  return idx >= 0 ? idx : 0; // stale value → display row 0, never ★ fallback
}

/**
 * Reason string for a moot question (FR-17/BUG-004): the persisted h2.29
 * reason ({@link Question.mootReason}, written by evaluateDependsOn at the
 * mute/still-moot site) when present — rendered VERBATIM including its
 * "moot: " prefix. Legacy states written before the field existed fall back
 * to the derived cause — `q.answer?.value` when present, else the generic
 * "dependency changed".
 */
export function mootReason(q: Question): string {
  if (q.mootReason !== undefined && q.mootReason !== "") return q.mootReason;
  const cause = q.answer?.value;
  return cause !== undefined && cause !== "" ? cause : DEFAULT_MOOT_REASON;
}

/** Inputs to the options-region renderer. */
export interface ShortViewInput {
  question: Question;
  /** Cursor index in the cursor domain (0..options.length; ✎ = last). */
  cursorIndex: number;
  theme: Theme;
  /** Full panel render width; content budget = width - 2 (inset). */
  width: number;
  /**
   * Soft-gate dimming (P1.M5.T3.S1): when true, every produced line is
   * wrapped in theme.fg("dim", …) at the very END of the builder — a single
   * color-class-only seam AFTER all content is composed, so glyphs, order,
   * prefixes, ★/✎ logic, and truncation stay byte-identical; only the color
   * class changes. Already-dim lines (moot/withdrawn variants) may
   * double-dim — visually harmless (dim over dim) and width-neutral, since
   * theme.fg is ANSI-transparent to visibleWidth. Default false (no gate →
   * no wrapping → byte-identical output).
   */
  dimmed?: boolean;
}

/**
 * Pure renderer for the short-view options region (h2.29): returns the
 * option + affordance lines only — no header/question/hint/footer.
 *
 * - Choice questions: one line per option in state order (never reordered
 *   or filtered, R1), each `  ` inset + cursor prefix + optional `★ ` +
 *   label + dimmed ` — {ramification}` teaser, then the
 *   `✎ Other — write your own` write-in row (cursor index `options.length`).
 * - Text questions: no option lines — the primary affordance
 *   `✎ answer…` (cursor index 0, full intensity), plus a dimmed first-line
 *   preview when `q.answer?.text` exists.
 * - Moot: reason line `⊘ moot — {reason}` prepended and the whole region
 *   dimmed (★ included); options are still listed (audit trail, Q34=A).
 * - Withdrawn: a single dimmed `⊗ withdrawn` line, no options.
 *
 * Tolerant by contract: `q.options === undefined` on a choice question
 * renders just the ✎ affordance (schema validation happens upstream).
 * Every returned line satisfies `visibleWidth ≤ width`.
 */
export function renderShortViewOptions(input: ShortViewInput): string[] {
  const { question: q, cursorIndex, theme, width, dimmed } = input;
  const budget = Math.max(1, width - INSET.length - RIGHT.length); // inset 2 + right margin 2 (variation A)

  if (q.status === "withdrawn") {
    const line = `${INSET}${theme.fg("dim", WITHDRAWN_LINE)}`;
    return [dimmed ? theme.fg("dim", line) : line];
  }

  const dimAll = q.status === "moot";
  const lines: string[] = [];
  if (dimAll) lines.push(mootLine(q, theme, budget));

  if (q.type === "text") {
    lines.push(textAffordanceLine(cursorIndex, theme, budget, dimAll));
    const preview = answerPreviewLine(q, theme, budget, dimAll);
    if (preview !== undefined) lines.push(preview);
  } else {
    const options = displayOptions(q); // D-R13: recommended-first display order
    for (let i = 0; i < options.length; i++) {
      lines.push(optionLine(q, options[i], i, cursorIndex, theme, budget, dimAll));
    }
    lines.push(otherLine(q, options.length, cursorIndex, theme, dimAll));
    // BUG-005 part 2: choice write-ins preview here too — only custom
    // write-ins produce a line (plain option answers return undefined; the
    // option rows already carry the recorded selection).
    const preview = answerPreviewLine(q, theme, budget, dimAll);
    if (preview !== undefined) lines.push(preview);
  }
  // Soft-gate dimming seam (P1.M5.T3.S1): one wrap pass over the FINISHED
  // lines — content composed exactly as before, only the color class added.
  return dimmed ? lines.map((line) => theme.fg("dim", line)) : lines;
}

// ----------------------------------------------------------- line builders

/**
 * One option line: inset + cursor prefix + optional ★ + label + dimmed
 * ramification teaser. The teaser shares the line budget (head + label +
 * separator accounted via visibleWidth) and is omitted entirely when fewer
 * than {@link MIN_TEASER_WIDTH} columns remain.
 */
function optionLine(
  q: Question,
  opt: QuestionOption,
  index: number,
  cursorIndex: number,
  theme: Theme,
  budget: number,
  dimAll: boolean,
): string {
  const prefix = index === cursorIndex ? CURSOR : BLANK;
  const star = opt.value === q.recommendation ? STAR : "";
  const headW = visibleWidth(prefix) + visibleWidth(star);
  const label = truncateVisible(opt.label, Math.max(1, budget - headW));

  let teaser = "";
  if (opt.ramification !== undefined && opt.ramification !== "") {
    const sep = " — ";
    const teaserBudget = budget - headW - visibleWidth(label) - visibleWidth(sep);
    if (teaserBudget >= MIN_TEASER_WIDTH) {
      teaser = sep + truncateVisible(opt.ramification, teaserBudget);
    }
  }

  if (dimAll) {
    // Moot dims the whole line — cursor prefix and ★ included (h2.29).
    return `${INSET}${theme.fg("dim", `${prefix}${star}${label}${teaser}`)}`;
  }
  // D-R13 (2026-09-30), amended 2026-10-07 (DEEP-PIN-003, owner ruling):
  // the recorded answer's option row renders its label in SUCCESS
  // (green) — same one-signal rule as the deep view's section title, so
  // "answered" reads identically in both views and never confuses with
  // the accent selection/preselect hue; write-in answers keep their dim
  // preview (the ✎ Other row carries the green, see otherLine).
  const answered = q.answer !== undefined && q.answer.custom !== true && q.answer.value === opt.value;
  const styledLabel = answered ? theme.fg("success", label) : label;
  const dimTeaser = teaser === "" ? "" : theme.fg("dim", teaser);
  return `${INSET}${prefix}${star}${styledLabel}${dimTeaser}`;
}

/**
 * The `✎ Other — write your own` row (WRITEIN-001) — present on every
 * choice question and occupying cursor index `optionCount` (the LAST row).
 * At that index it is the focus target: `▸ ` prefix and full (non-dim)
 * intensity; otherwise dimmed with a two-space prefix. Focus BEHAVIOR (the
 * write-in duty) is P1.M2.T2.S1; this module only renders the line inside
 * the cursor range. DEEP-PIN-003: when the recorded answer is a committed
 * write-in (custom: true), the label renders SUCCESS (green) — the same
 * one-signal answered coloring as option rows and deep-view titles.
 */
function otherLine(
  q: Question,
  optionCount: number,
  cursorIndex: number,
  theme: Theme,
  dimAll: boolean,
): string {
  const prefix = cursorIndex === optionCount ? CURSOR : BLANK;
  const isWriteInAnswer = q.answer?.custom === true;
  const label = isWriteInAnswer ? theme.fg("success", OTHER_AFFORDANCE) : OTHER_AFFORDANCE;
  const content = `${prefix}${label}`;
  const focused = cursorIndex === optionCount && !dimAll;
  return `${INSET}${focused ? content : theme.fg("dim", content)}`;
}

/**
 * Primary text-field affordance for `type: "text"` questions (cursor index
 * 0, the only focus target). Full intensity — it is the question's primary
 * affordance, not a secondary escape hatch. The embedded editor itself is
 * P1.M4.T1.S1; this is the affordance line only.
 */
function textAffordanceLine(cursorIndex: number, theme: Theme, budget: number, dimAll: boolean): string {
  const prefix = cursorIndex === 0 ? CURSOR : BLANK;
  const placeholderBudget = Math.max(1, budget - visibleWidth(prefix) - visibleWidth("✎ "));
  const placeholder = truncateVisible(TEXT_PLACEHOLDER, placeholderBudget);
  const content = `${prefix}✎ ${placeholder}`;
  return dimAll ? `${INSET}${theme.fg("dim", content)}` : `${INSET}${content}`;
}

/**
 * Dimmed current-value preview under the affordance/Other rows: the first
 * line of the recorded answer — `answer.value` for write-ins (custom) and
 * text questions, `answer.text` for elaborations (BUG-005 part 2). Indented
 * to align with the placeholder text. Returns undefined when there is no
 * previewable answer — the line is never rendered empty, and plain option
 * values are never previewed (option rows carry the selection).
 */
function answerPreviewLine(q: Question, theme: Theme, budget: number, dimAll: boolean): string | undefined {
  // BUG-005 part 2: write-in (custom: true) and text answers commit to
  // answer.value; elaborations ride answer.text. Read whichever field the
  // recorded answer actually used — same vocabulary as overview markerParts
  // (custom === true || type text → value) and cancelTextConfirm's seed read.
  const a = q.answer;
  const text =
    a !== undefined && (a.custom === true || q.type === "text") ? a.value : a?.text;
  if (text === undefined || text === "") return undefined;
  const firstLine = text.split("\n", 1)[0] ?? "";
  const preview = truncateVisible(firstLine, Math.max(1, budget - INSET.length - BLANK.length));
  if (preview === "") return undefined;
  return `${INSET}${theme.fg("dim", `${BLANK}${BLANK}${preview}`)}`; // already dimmed
}

/**
 * Moot reason line: `⊘ moot — {mootReason(q)}`, dimmed; the reason
 * truncates to the remaining budget so a verbose cause cannot wrap.
 */
function mootLine(q: Question, theme: Theme, budget: number): string {
  const reasonBudget = Math.max(1, budget - visibleWidth(MOOT_HEAD));
  const reason = truncateVisible(mootReason(q), reasonBudget);
  return `${INSET}${theme.fg("dim", `${MOOT_HEAD}${reason}`)}`;
}

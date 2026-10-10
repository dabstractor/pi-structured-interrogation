/**
 * src/panel/deep-view.ts — deep view renderer + scroll/selection model
 * (P1.M5.T1.S1).
 *
 * The deep view (FR-8 / h2.29 / Q19-Q20) is a FULL replacement of the Q&A
 * region between header and footer, split into TWO regions (owner ruling
 * 2026-10-05, DEEP-PIN-001): a PINNED question region on top — the full
 * `question.description`, then the full goal text under it (FR-30, dimmed;
 * plus a `⊘ moot` reason line first when moot) — and a SCROLLABLE options
 * region under
 * it with one section per option (`▸ ★ sqlite` header + wrapped
 * ramification text) and — on choice questions — the synthetic
 * `✎ Other — write your own` section (P1.M2.T6.S1). The question NEVER
 * scrolls out of view: `scrollOffset` indexes the options region only, so
 * scrolling to the last answer choices cannot hide the question being
 * answered (the pre-pin layout scrolled the whole pane and its sticky
 * floor `offset ≥ headerIdx - vh + 2` then made the question unreachable
 * until the view was toggled). When the pinned region alone would
 * overflow {@link DEEP_VIEW_HEIGHT}, it is line-truncated bottom-first
 * (goal yields space before the description) with a dimmed `…` marker —
 * never by stealing the options window's minimum height.
 *
 * DEEP-PIN-002 (2026-10-05, owner request) — question framing: the pinned
 * region must read as a distinct block ("hard to see where the question
 * begins and ends"). It gets breathing room on all sides — a blank line
 * above (below the panel header), the existing blank below, one extra
 * column of right padding (question text wraps 1 col narrower than option
 * rows), and the accent `▌` rail at column 0 on every question text line
 * (moot line, goal, description, truncation marker). The rail is 2 visible
 * cols (`▌ `), so question text stays at column 2, column-aligned with
 * option titles; width-safe like every glyph here (visibleWidth = 1). `↑/↓` SCROLL the pane / move the selection — they NEVER
 * navigate questions (h2.29: question navigation belongs to the config
 * prev/next keys only); `enter` selects the highlighted option — or, on
 * the Other section, opens the write-in duty back on the short form
 * (h2.32) — and returns to the short view (advancing to the next
 * unanswered question, Q14); `esc` descends via the existing
 * router ladder without destroying anything (FR-16).
 *
 * MODE A CONTRACT — MARKER GLYPH VOCABULARY (panel-wide, short-view.ts):
 *
 * - `★`  recommended option (header body `▸ ★ label` — unmistakable, R2)
 * - `⊘`  moot (reason line prepended, whole pane dimmed)
 * - `⊗`  withdrawn (pane collapses to the single dim line)
 * - `▸`  cursor / highlighted section header
 * - `✎`  the synthetic Other section on choice questions (P1.M2.T6.S1):
 *   rendered AFTER the last option at cursor index `options.length`; the
 *   label is shared with short-view.ts (`OTHER_AFFORDANCE`) and the
 *   ramification is the fixed `OTHER_RAMIFICATION` string (h2.29). It is
 *   selectable (same sticky-header machinery as real options) and `enter`
 *   on it enters the write-in duty — short form + editor focused (h2.32).
 *   Text questions still render goal + description only and `enter` is a
 *   consumed no-op (the embedded editor composes on the short form).
 *
 * MODE A CONTRACT — ALIGNMENT (mirrors short-view.ts):
 *
 * - Content is inset 2 columns (`INSET`); the cursor prefix is `▸ ` (2
 *   visible cols) and the non-cursor prefix two spaces, so header labels
 *   stay column-aligned. Ramification lines are indented 4 columns total,
 *   aligning under the header label.
 * - Glyph widths are NEVER assumed: wrapping and truncation go through
 *   visibleWidth/truncateVisible (ANSI- and wide-char-safe; never
 *   String.prototype.slice on display text — the per-text char cap is the
 *   one exception, capping SOURCE characters before rendering, mirroring
 *   the config caps' char-count semantics).
 *
 * MODE A CONTRACT — RENDER BUDGET (h2.51 risk row 2): the pane is capped at
 * {@link DEEP_VIEW_HEIGHT} content lines (a module constant, NOT terminal
 * rows — panel.render(width) has no height parameter; M7.T5.S1 adapts) and
 * every text block is capped at the config ramification char cap with `…`
 * appended when truncated. Huge descriptions/ramifications cannot blow the
 * terminal; the overview list (M5.T2) is the escape hatch.
 *
 * Purity: the builders/renderers are pure (no state mutation, no I/O, no
 * key handling — mutations live in the named actions below and on the
 * panel). Structure mirrors short-view.ts: constants → helpers → builder →
 * line/window renderers → panel actions.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Question } from "../state.js";
import { acceptOptionIndex } from "./actions.js";
import { truncateVisible } from "./layout.js";
import type { InterrogationPanel } from "./panel.js";
import { OTHER_AFFORDANCE, RIGHT, displayOptions, initialCursorIndex, mootReason } from "./short-view.js";

// ---------------------------------------------------------------- constants

/**
 * Deep pane height cap in CONTENT lines (h2.51 row 2) — header and footer
 * render outside it. A constant because render(width) carries no height;
 * M7.T5.S1 (terminal fallback) owns any dynamic sizing.
 */
export const DEEP_VIEW_HEIGHT = 20;

/**
 * Minimum scrollable height reserved for the options region (DEEP-PIN-001):
 * when the pinned question region (moot line + goal + description) alone
 * would overflow {@link DEEP_VIEW_HEIGHT}, the question is line-truncated
 * bottom-first with a dimmed `…` marker — the sections' window is never
 * squeezed below this floor (a pane with no visible options would strand
 * the selection). Exported for tests.
 */
export const MIN_OPTIONS_VIEWPORT = 4;

/**
 * DEEP-PIN-002 — the pinned question block's left rail glyph. Accent-
 * colored, column 0, followed by one space (2 visible cols — question text
 * stays at column 2, aligned under option titles). Same glyph family the
 * 2026-10-04 selection demo (scripts/demo-deep-selection.ts, candidate 2)
 * measured; visibleWidth 1, never assumed elsewhere.
 */
const QUESTION_RAIL = "▌ ";

/** Two-column inset applied to every content line (short-view.ts pattern). */
const INSET = "  ";
/**
 * D-R14 (amended 6, 2026-09-30 live-review): amendment 5 (title/explanation
 * color swap) REVERTED — it made bars and explanation text share a color,
 * killing the bars' distinctness. Titles PRIMARY (theme text), selected =
 * accent + bold on title AND its bars; explanation text RAW full-intensity;
 * bars PRIMARY (theme text) — the amendment-4 state, which read best. The
 * explanation block now indents 1 char (bar col 3, text col 4).
 *
 * D-R14 AMENDMENT 9 (2026-10-04, owner ruling): selection must carry a
 * CHARACTER-level signal, not just accent+bold — on color-broken TTYs the
 * amendment-4 "bold = no-color fallback" assumption failed outright. The
 * highlighted section now ALSO renders `▸ ` in place of its header inset
 * (the short-view cursor vocabulary; labels stay column-aligned) and its
 * ramification pipes render `┃` (heavy) instead of `│` — same 3 visible
 * cols, so the amended-6 indent geometry is untouched. Color treatment
 * unchanged: the glyphs are an ADDITIVE channel, not a replacement.
 */
/** Recommendation mark inserted before the title label (short-view.ts). */
const STAR = "★ ";
/**
 * Explanation-row pipe indent: 1 space + │/┃ + space (3 visible cols; bar
 * at col 3, text col 4 — amended 6 indent). Bars PRIMARY (theme text); the
 * SELECTED section's bars highlight — accent + bold AND the heavy ┃ glyph
 * (amendment 9's per-row character signal).
 */
function ramIndent(theme: Theme, selected: boolean): string {
  const bar = selected ? " ┃ " : " │ ";
  return selected ? theme.bold(theme.fg("accent", bar)) : theme.fg("text", bar);
}
/** Title styling: selected = accent + bold (plus the ▸ prefix / heavy ┃ bars — amendment 9's character channel); unselected = PRIMARY (theme text). */
function titleStyle(theme: Theme, selected: boolean, body: string): string {
  return selected ? theme.bold(theme.fg("accent", body)) : theme.fg("text", body);
}
/**
 * Header line prefix (2 visible cols either way): `▸ ` on the highlighted
 * section — the character-level selection signal (D-R14 amendment 9; same
 * glyph vocabulary as the short-view cursor) — two spaces otherwise.
 * Replaces INSET on header lines so labels stay column-aligned.
 */
function headerPrefix(selected: boolean): string {
  return selected ? "▸ " : INSET;
}
/** Moot reason line head (mirrors short-view.ts). */
const MOOT_HEAD = "⊘ moot — ";
/** Withdrawn questions collapse to this single dimmed line. */
const WITHDRAWN_LINE = "⊗ withdrawn";
/**
 * The synthetic Other section's ramification (P1.M2.T6.S1, h2.29) — a FIXED
 * extension-supplied string rendered verbatim through the SAME
 * capText → wrapText → dim → RAM_INDENT pipeline as option ramifications.
 * Deliberately NOT configurable; never starred (the Other row is not an
 * option and is never recommended).
 */
export const OTHER_RAMIFICATION =
  "None of the listed options fit — write your own answer; it ships as the official answer for this question, not as an attachment to one of them.";
/**
 * Fallback render width for scroll math before the panel's first render
 * (lastWidth === -1) — only affects offset clamping fidelity between the
 * action and the next real render; renderDeepWindow re-clamps defensively.
 */
const FALLBACK_WIDTH = 80;

// -------------------------------------------------------------------- types

/** Inputs to the deep content builder ({@link buildDeepContent}). */
export interface DeepViewInput {
  question: Question;
  /** FULL goal text (FR-30) — read from state.goal, never the header's cut. */
  goal: string;
  /** Highlighted option index (advisory — baked into placeholder headers). */
  cursorIndex: number;
  /** Scroll offset (advisory — clamping happens in {@link clampScroll}). */
  scrollOffset: number;
  theme: Theme;
  /** Full panel render width; content budget = width - 2 (INSET). */
  width: number;
  /** Per-text char cap (config.caps.ramification) — h2.51 row 2. */
  maxChars: number;
}

/**
 * Flattened deep pane content (pre-window). One reusable build serves both
 * scroll clamping ({@link clampScroll} — needs line counts + header indexes)
 * and rendering ({@link renderDeepWindow} — slices + re-styles headers).
 */
export interface DeepContent {
  /**
   * PINNED question region (DEEP-PIN-001): moot reason line, full goal
   * text, and full `question.description` (capped/wrapped, bottom-line
   * truncated with a dimmed `…` marker when over budget). Rendered ABOVE
   * the scroll window by {@link renderDeepWindow} on EVERY offset — the
   * question never scrolls out of view. Withdrawn questions collapse to
   * the single dim line here.
   */
  questionLines: string[];
  /**
   * Flattened SCROLLABLE options-region lines (sections + separators),
   * fully styled — EXCEPT section header lines,
   * which are baked with the build-time cursor prefix and re-rendered by
   * {@link renderDeepWindow} so the highlighted header always carries `▸ `.
   */
  lines: string[];
  /** Per option: index into {@link lines} of its section header line. */
  sectionHeaderLineIndex: number[];
  /** Per section: plain header body (the label ONLY — the ★ rail lives in
   *  `sectionStarred`, never inside the body), theme-free. The Other section
   *  is always the LAST entry. */
  sectionHeaders: string[];
  /** D-R14 amendment 7 (2026-09-30): per section — true when the option is
   *  the recommendation; renders the ★ at COLUMN 0 (the left rail) without
   *  moving the title text (title stays col 2). Parallels sectionHeaders
   *  (Other = always false). */
  sectionStarred: boolean[];
  /** DEEP-PIN-003: per section — true on the section carrying the RECORDED
   *  answer (the option whose value === `answer.value`, or the ✎ Other
   *  section for `custom: true` write-ins). Renders the success-colored
   *  trailing ` ✓` after the title (before the ★) and rides the header
   *  re-render in {@link renderDeepWindow} so the mark survives cursor
   *  moves. All false while unanswered — the ★ preselect and a pinned
   *  recorded answer are indistinguishable by caret alone, which is
   *  exactly the ambiguity this channel exists to break. */
  sectionAnswered: boolean[];
  /** True for moot questions — headers re-render dimmed (whole pane dim). */
  dimAll: boolean;
  /** Scrollable options-region height cap (≤ {@link DEEP_VIEW_HEIGHT}; see
   *  {@link MIN_OPTIONS_VIEWPORT}). The question region renders ABOVE it,
   * pinned — `scrollOffset` indexes `lines` only. */
  viewportHeight: number;
}

// ------------------------------------------------------------------ helpers

/**
 * Cap SOURCE text at `maxChars` characters with `…` appended when truncated
 * (h2.51 row 2 — char-count semantics matching the config caps, applied
 * before wrapping; display-width safety stays with wrapText/truncateVisible).
 */
function capText(text: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "…";
}

/**
 * Word-wrap `text` to `budget` visible columns (visibleWidth-aware — glyph
 * widths are never assumed): split on spaces and accumulate lines while
 * `visibleWidth(line + " " + word)` fits; a single word longer than the
 * budget is hard-truncated with `…` via truncateVisible (which also bounds
 * every emitted line). Never returns an empty array — a blank input yields
 * one empty line so block separators stay symmetrical.
 */
export function wrapText(text: string, budget: number): string[] {
  const b = Math.max(1, budget);
  const words = text.split(" ").filter((w) => w !== "");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    if (visibleWidth(word) > b) {
      // Unbreakable overlong word: flush, then hard-truncate it onto one
      // line — truncateVisible already appends the single `…` adornment.
      if (cur !== "") {
        lines.push(cur);
        cur = "";
      }
      lines.push(truncateVisible(word, b - 1));
      continue;
    }
    if (cur === "") {
      cur = word;
      continue;
    }
    const candidate = `${cur} ${word}`;
    if (visibleWidth(candidate) <= b) cur = candidate;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines.length > 0 ? lines : [""];
}

// ---------------------------------------------------------- content builder

/**
 * Pure deep-pane content builder (h2.29 layout, FR-30 / FR-8): the FULL
 * goal text (dimmed, capped + wrapped), a blank separator, the FULL
 * `question.description` (capped + wrapped), a blank separator, then one
 * section per option in state order (never filtered or reordered — R1):
 * a header line — `▸ label ★` when highlighted / `  label ★` otherwise
 * (TRAILING ★, amendment 8; the highlighted section carries the `▸ `
 * prefix + heavy `┃` pipes of amendment 9) — followed by its ramification
 * wrapped over indented (4-col) dimmed lines.
 *
 * Dim hierarchy: the goal and ramification lines render dim ALWAYS (the
 * goal is context, the ramification is the expanded short-view teaser,
 * which renders dim there); the description renders full intensity; moot
 * dims the whole pane (headers included, via {@link DeepContent.dimAll}).
 *
 * Variants:
 * - Withdrawn: the pane collapses to the single dim `⊗ withdrawn` line
 *   (mirrors the short-view options region).
 * - Moot: a `⊘ moot — {reason}` line is prepended and the whole pane
 *   renders dimmed ({@link DeepContent.dimAll}); options are still listed
 *   (audit trail, Q34=A).
 * - Choice questions: after the real option sections, the synthetic
 *   `✎ Other — write your own` section (P1.M2.T6.S1) renders at cursor
 *   index `options.length` — label shared with short-view.ts
 *   (`OTHER_AFFORDANCE`), ramification the fixed `OTHER_RAMIFICATION`
 *   (h2.29), never starred. Present even when `options` is undefined or
 *   empty (the Other row is the whole cursor domain there).
 * - Text questions: goal + description only — no option sections and no
 *   Other section (the embedded editor composes on the short form).
 */
export function buildDeepContent(input: DeepViewInput): DeepContent {
  const { question: q, goal, theme, width, maxChars } = input;
  const budget = Math.max(1, width - INSET.length - RIGHT.length); // inset 2 + right margin 2 (variation A)

  if (q.status === "withdrawn") {
    return {
      questionLines: ["", `${questionIndent(theme)}${theme.fg("dim", WITHDRAWN_LINE)}`],
      lines: [],
      sectionHeaderLineIndex: [],
      sectionHeaders: [],
      sectionStarred: [],
      sectionAnswered: [],
      dimAll: false,
      viewportHeight: DEEP_VIEW_HEIGHT,
    };
  }

  const dimAll = q.status === "moot";
  const hasSections = q.type === "choice";
  // DEEP-PIN-003: answered-state visibility — success rail + `✓ answered`
  // head line + per-section ✓ marks. Gate mirrors statusMarkers (moot
  // excluded — it owns the pane dim + ⊘ line; ANSWER-PIN-001 pins the
  // caret, this makes the PIN VISIBLE: pre-003 a recorded answer on the
  // recommended row rendered pixel-identical to the unanswered ★ preselect).
  const answered = isAnswered(q);
  const lines: string[] = [];
  const sectionHeaderLineIndex: number[] = [];
  const sectionHeaders: string[] = [];
  const sectionStarred: boolean[] = [];
  const sectionAnswered: boolean[] = [];

  // ---- pinned question region (DEEP-PIN-001): moot line + description +
  // goal, fitted to the pane budget. RENDER ORDER per the spec sentence —
  // "full `description`, full `goal` below it, dimmed" — the description
  // first, the goal UNDER it (validation Issue 4, 2026-10-07: the blocks
  // used to render goal-above-description). Truncation PRIORITY is
  // unchanged and independent of render order: the description owns the
  // space first (it is the question being answered; the goal is context
  // already summarized — truncated — in the header, FR-30), so the goal
  // yields lines first when the region overflows; both blocks cap at
  // maxChars as before. Whole-line truncation only, via fitBlock.
  // DEEP-PIN-002 framing: a blank line ABOVE the block (air below the
  // panel header), the accent ▌ rail on every text line, and one extra
  // column of right padding (question text wraps 1 col narrower than the
  // options rows — breathing room on all sides).
  const head: string[] = [""];
  if (answered) {
    head.push(answeredLine(theme), "");
  }
  if (dimAll) {
    head.push(mootLine(q, theme, budget - 1), "");
  }
  const qBudget = budget - 1; // extra right-padding col (DEEP-PIN-002)
  const rail = questionIndent(theme, answered);
  const goalBlock: string[] = [];
  pushBlock(goalBlock, goal, theme, qBudget, maxChars, true, "", rail);
  const descBlock: string[] = [];
  if (q.description !== undefined && q.description !== "") {
    pushBlock(descBlock, q.description, theme, qBudget, maxChars, dimAll, "", rail);
  }
  const separators = descBlock.length > 0 ? 2 : 1; // blank between blocks (+ after the last)
  const questionBudget = hasSections
    ? DEEP_VIEW_HEIGHT - MIN_OPTIONS_VIEWPORT
    : DEEP_VIEW_HEIGHT; // no sections → the question may use the whole pane
  const avail = questionBudget - head.length - separators;
  const descKept = fitBlock(descBlock, avail, theme, answered);
  const goalKept = fitBlock(goalBlock, avail - descKept.length, theme, answered);
  // DEEP-PIN-001 order: description block ABOVE the goal block (one blank
  // line between; the trailing blank separates the pinned region from the
  // options region exactly as before).
  const questionLines = [...head];
  if (descKept.length > 0) questionLines.push(...descKept, "");
  questionLines.push(...goalKept, "");
  // ---- scrollable options region (unchanged composition; indexes are
  // now RELATIVE TO `lines`, offset 0 = first section header's region top).
  if (q.type === "choice") {
    const options = displayOptions(q); // D-R13: recommended-first display order (same as short view)
    for (let i = 0; i < options.length; i++) {
      const opt = options[i]!;
      // D-R14 amendment 8 (2026-09-30): the ★ follows the title — TRAILING
      // `Title ★` — instead of the col-0 rail; the title text stays at
      // col 2 with the plain inset, and the star's width is reserved so
      // truncation can never eat it. DEEP-PIN-003: the recorded answer's
      // section carries ` ✓` (success) BETWEEN the title and the ★ — the
      // answer mark sits closest to the label it certifies; its width is
      // reserved like the star's.
      const starred = opt.value === q.recommendation;
      const isAnswerRow = answered && q.answer?.custom !== true && opt.value === q.answer?.value;
      const starSuffix = starred ? ` ${theme.fg("text", "★")}` : "";
      const checkSuffix = isAnswerRow ? ` ${theme.fg("success", "✓")}` : "";
      const body = truncateVisible(
        opt.label,
        Math.max(1, budget - (starred ? 2 : 0) - (isAnswerRow ? 2 : 0)),
      );
      sectionHeaders.push(body);
      sectionStarred.push(starred);
      sectionAnswered.push(isAnswerRow);
      sectionHeaderLineIndex.push(lines.length);
      const composed = `${headerPrefix(i === input.cursorIndex)}${titleStyle(theme, i === input.cursorIndex, body)}${checkSuffix}${starSuffix}`;
      lines.push(dimAll ? theme.fg("dim", composed) : composed);
      // D-R13/D-R14: explanation rows — full intensity, each prefixed by the
      // colored quote-bar pipe. Moot dims the whole pane over it.
      if (opt.ramification !== undefined && opt.ramification !== "") {
        pushBlock(lines, opt.ramification, theme, budget, maxChars, dimAll, ramIndent(theme, i === input.cursorIndex));
      }
      // Variation B (2026-09-30, promoted from live-review to spec): one
      // blank line between each answer section — the separator rides the
      // content, so it scrolls with it; sectionHeaderLineIndex bookkeeping
      // follows automatically since blanks are pushed while building.
      lines.push("");
    }
    // P1.M2.T6.S1: the synthetic ✎ Other section — cursor index
    // `options.length` (WRITEIN-001 deep parity), ALWAYS the LAST
    // sectionHeaderLineIndex entry so clampScroll/renderDeepWindow work
    // unchanged. Present even with zero options (the Other row is the
    // whole domain there); never on withdrawn/text questions.
    sectionHeaders.push(OTHER_AFFORDANCE);
    sectionStarred.push(false); // never recommended (h2.29)
    // DEEP-PIN-003: a committed write-in (custom: true) certifies the ✎
    // Other section — trailing ` ✓` like a real option row.
    const otherIsAnswer = answered && q.answer?.custom === true;
    sectionAnswered.push(otherIsAnswer);
    sectionHeaderLineIndex.push(lines.length);
    const otherCheck = otherIsAnswer ? ` ${theme.fg("success", "✓")}` : "";
    const composed = `${headerPrefix(options.length === input.cursorIndex)}${titleStyle(theme, options.length === input.cursorIndex, OTHER_AFFORDANCE)}${otherCheck}`;
    lines.push(dimAll ? theme.fg("dim", composed) : composed);
    pushBlock(lines, OTHER_RAMIFICATION, theme, budget, maxChars, dimAll, ramIndent(theme, options.length === input.cursorIndex));
  }
  const viewportHeight = Math.max(
    hasSections ? MIN_OPTIONS_VIEWPORT : 1,
    DEEP_VIEW_HEIGHT - questionLines.length,
  );
  return { questionLines, lines, sectionHeaderLineIndex, sectionHeaders, sectionStarred, sectionAnswered, dimAll, viewportHeight };
}

/**
 * Append one text block: char-capped ({@link capText}), word-wrapped to the
 * post-indent budget ({@link wrapText}), each line prefixed (INSET by
 * default; the question rail for pinned blocks, DEEP-PIN-002), optional
 * extra indent, and dimmed when `dim`. Pure — appends into the caller's
 * array only.
 */
function pushBlock(
  lines: string[],
  text: string,
  theme: Theme,
  budget: number,
  maxChars: number,
  dim: boolean,
  indent = "",
  prefix = INSET,
): void {
  const indentW = visibleWidth(indent);
  const wrapped = wrapText(capText(text, maxChars), Math.max(1, budget - indentW));
  for (const ln of wrapped) {
    const composed = `${prefix}${indent}${ln}`;
    lines.push(dim ? theme.fg("dim", composed) : composed);
  }
}

/** Moot reason line `⊘ moot — {reason}` (mirrors short-view.ts mootLine). */
function mootLine(q: Question, theme: Theme, budget: number): string {
  const reasonBudget = Math.max(1, budget - visibleWidth(MOOT_HEAD));
  const reason = truncateVisible(mootReason(q), reasonBudget);
  return `${questionIndent(theme)}${theme.fg("dim", `${MOOT_HEAD}${reason}`)}`;
}

/**
 * DEEP-PIN-002: the question block's left rail — `▌ ` (2 visible cols),
 * ACCENT while the question is open and SUCCESS (green) once it carries a
 * recorded answer (DEEP-PIN-003 — "another color for already-answered
 * questions": the whole block reads differently at a glance). Replaces the
 * INSET on every pinned question text line so the block's left edge is a
 * solid colored rail while its text stays at column 2 (option-title
 * alignment). The ✓ answered head line + per-section ✓ marks are the
 * character-level channel (color-broken TTYs — D-R14 amendment 9
 * philosophy: never color alone).
 */
function questionIndent(theme: Theme, answered = false): string {
  return theme.fg(answered ? "success" : "accent", QUESTION_RAIL);
}

/** DEEP-PIN-003 — head-line label for questions carrying a recorded answer. */
const ANSWERED_HEAD = "✓ answered";
/**
 * DEEP-PIN-003: the `✓ answered` head line — the deep view's counterpart
 * of the short view's `★ answered` question-line marker (statusMarkers,
 * same status gate), success-colored on the success-colored rail.
 */
function answeredLine(theme: Theme): string {
  return `${questionIndent(theme, true)}${theme.fg("success", ANSWERED_HEAD)}`;
}
/**
 * DEEP-PIN-003 gate (mirrors layout.ts statusMarkers exactly): an answer
 * object PLUS an answered/submitted/closed status. Status alone (answer
 * reset) is not "answered"; answer presence alone (moot keeps its answer
 * for the audit trail) is not either — moot owns its own `⊘` line.
 */
function isAnswered(q: Question): boolean {
  return (
    q.answer !== undefined &&
    (q.status === "answered" || q.status === "submitted" || q.status === "closed")
  );
}

/**
 * Fit a pinned question block into `max` lines (DEEP-PIN-001): whole-line
 * truncation from the bottom with a fresh dimmed `…` marker line (carrying
 * the question rail — success-colored when answered, DEEP-PIN-003)
 * replacing the cut tail. Whole lines only — never slices a styled line
 * (ANSI-safe); `max` ≤ 0 yields an empty block. Pure.
 */
function fitBlock(block: string[], max: number, theme: Theme, answered = false): string[] {
  if (max <= 0) return [];
  if (block.length <= max) return block;
  return [...block.slice(0, max - 1), `${questionIndent(theme, answered)}${theme.fg("dim", "…")}`];
}

// ----------------------------------------------------- scroll + render core

/**
 * [Mode A] Sticky-header scroll budget (contract 5) — the load-bearing
 * algorithm that keeps the highlighted option's header visible while its
 * ramification text scrolls (AC-5). Operates on the SCROLLABLE options
 * region only (`content.lines`): the question region above it is pinned
 * (DEEP-PIN-001) and cannot scroll out of view, so the old failure mode —
 * the sticky floor stranding the question above the window with no way
 * back — is structurally gone. The window is `[offset, offset +
 * viewportHeight - 1]` over `content.lines`. The selected section's header (line `headerIdx`) plus at
 * least its FIRST ramification line must stay inside the window:
 *
 * - header not above the window top:  offset ≤ headerIdx
 * - header + 1 line inside the bottom: offset ≥ headerIdx - viewportHeight + 2
 *
 * so `offset = clamp(scrollOffset, headerIdx - viewportHeight + 2, headerIdx)`
 * — minimal movement (a header already inside the window never shifts the
 * offset), and when the selected header would scroll ABOVE the window top
 * the upper bound PINS it there ("sticky"). The result is finally clamped
 * to the global bounds `[0, max(0, lines.length - viewportHeight)]` — the
 * offset is never negative and never past the end. When the cursor has no
 * section (text questions, out-of-range index) only the global bounds
 * apply. When the sticky range and the global bounds intersect to empty
 * (header inside the final window), the global clamp wins — the header is
 * still visible there by construction.
 */
export function clampScroll(content: DeepContent, scrollOffset: number, cursorIndex: number): number {
  const maxOffset = Math.max(0, content.lines.length - content.viewportHeight);
  const headerIdx = content.sectionHeaderLineIndex[cursorIndex];
  let offset = Math.max(0, scrollOffset);
  if (headerIdx !== undefined) {
    offset = Math.min(Math.max(offset, headerIdx - content.viewportHeight + 2), headerIdx);
  }
  return Math.max(0, Math.min(offset, maxOffset));
}

/**
 * Render the deep pane at `scrollOffset`: the PINNED question region
 * (DEEP-PIN-001 — moot line + goal + description, present on EVERY offset;
 * the question never scrolls out of view) followed by the options-region
 * window, defensively re-clamped (renderers never mutate panel state),
 * every visible section header re-rendered with the CURRENT cursor prefix
 * (`▸ ` highlighted / two spaces), dimmed when {@link DeepContent.dimAll}.
 * Always returns at most `content.viewportHeight` options lines under the
 * pinned question lines (total ≤ {@link DEEP_VIEW_HEIGHT}), each within
 * `width`.
 */
export function renderDeepWindow(
  content: DeepContent,
  cursorIndex: number,
  scrollOffset: number,
  theme: Theme,
  width: number,
): string[] {
  const budget = Math.max(1, width - INSET.length - RIGHT.length);
  const maxOffset = Math.max(0, content.lines.length - content.viewportHeight);
  const offset = Math.max(0, Math.min(scrollOffset, maxOffset));
  const end = Math.min(content.lines.length, offset + content.viewportHeight);
  const window: string[] = [];
  for (let i = offset; i < end; i++) window.push(content.lines[i]!);
  for (let s = 0; s < content.sectionHeaderLineIndex.length; s++) {
    const lineIdx = content.sectionHeaderLineIndex[s]!;
    if (lineIdx < offset || lineIdx >= end) continue;
    const starred = content.sectionStarred[s] === true;
    // DEEP-PIN-003: re-render the recorded answer's ` ✓` (success) with the
    // header — between title and ★, width reserved — so the mark survives
    // cursor moves exactly like the star does.
    const answerMarked = content.sectionAnswered[s] === true;
    const body = truncateVisible(
      content.sectionHeaders[s]!,
      Math.max(1, budget - (starred ? 2 : 0) - (answerMarked ? 2 : 0)),
    );
    // D-R14 amendment 8: TRAILING `Title ★` — no rail, no leading star; the
    // star's width is reserved so truncation never eats it. Selection =
    // accent+bold title/bars PLUS the ▸ header prefix (amendment 9); the
    // star stays primary text.
    const starSuffix = starred ? ` ${theme.fg("text", "★")}` : "";
    const checkSuffix = answerMarked ? ` ${theme.fg("success", "✓")}` : "";
    const composed = `${headerPrefix(s === cursorIndex)}${titleStyle(theme, s === cursorIndex, body)}${checkSuffix}${starSuffix}`;
    window[lineIdx - offset] = content.dimAll ? theme.fg("dim", composed) : composed;
  }
  return [...content.questionLines, ...window];
}

// ------------------------------------------------------------ panel actions

/**
 * Panel render context for the deep actions: the focused question plus the
 * last render width (scroll offsets index CONTENT LINES, which depend on
 * width — clamping against the width the pane was last rendered at keeps
 * the offset valid until the next render re-clamps defensively).
 */
function deepInput(panel: InterrogationPanel): { q: Question | undefined; input: DeepViewInput } {
  const q =
    panel.currentId !== undefined ? panel.state.getQuestion(panel.currentId) : undefined;
  const width = panel.lastWidth > 0 ? panel.lastWidth : FALLBACK_WIDTH;
  return {
    q,
    input: {
      question: q as Question,
      goal: panel.state.goal,
      cursorIndex: panel.cursorIndex,
      scrollOffset: panel.scrollOffset,
      theme: panel.theme,
      width,
      maxChars: panel.config.caps.ramification,
    },
  };
}

/** Move the deep selection up one option (clamped at 0, no wrap). */
export function deepSelectionUp(panel: InterrogationPanel): boolean {
  return stepDeepSelection(panel, -1);
}

/** Move the deep selection down one section (clamped at the Other section). */
export function deepSelectionDown(panel: InterrogationPanel): boolean {
  return stepDeepSelection(panel, 1);
}

/**
 * Shared deep-selection step: mutate `panel.cursorIndex` within
 * `[0, options.length]` — index `options.length` IS the synthetic
 * `✎ Other` section (P1.M2.T6.S1; same domain convention as actions.ts's
 * cursorDomainSize) — recompute `panel.scrollOffset` via
 * {@link clampScroll}, and invalidate. NEVER touches `panel.currentId`
 * (h2.29: ↑/↓ in deep view do not navigate questions). Consumed no-op for
 * text/moot/withdrawn (nothing to select) and at the domain boundaries
 * (zero-option choice questions own the single Other index, so moves are
 * no-ops there); false only when no question context exists.
 */
function stepDeepSelection(panel: InterrogationPanel, delta: number): boolean {
  const { q } = deepInput(panel);
  if (q === undefined) return false;
  if (q.type !== "choice") return true;
  const count = q.options?.length ?? 0;
  const next = Math.min(count, Math.max(0, panel.cursorIndex + delta));
  if (next !== panel.cursorIndex) {
    panel.cursorIndex = next;
    const { input } = deepInput(panel);
    input.cursorIndex = next;
    panel.scrollOffset = clampScroll(buildDeepContent(input), panel.scrollOffset, next);
    panel.invalidate();
  }
  return true;
}

/**
 * `enter` in deep view (Q14/Q19-Q20): accept the highlighted option with
 * the EXACT short-view commit semantics ({@link acceptOptionIndex} —
 * ripple-confirm seam on answered/submitted edits, applyAnswer, advance to
 * the next unanswered question), then return to the short view and reset
 * the scroll offset. On the synthetic `✎ Other` section (index
 * `options.length`, P1.M2.T6.S1) NOTHING is answered: the panel returns to
 * the short form with the editor focused in write-in duty (h2.32) — the
 * commit happens at writeInEnter when the user presses enter in the
 * editor. `deepSticky` is untouched — the toggle stays sticky
 * for the panel session.
 *
 * No-op paths (all consumed, `true`):
 * - no question context;
 * - text questions (the text affordance belongs to the short form);
 * - moot/withdrawn (R1: navigable, not editable).
 *
 * Outcome interpretation (Mode A, ANSWER-PIN-001 / FR-D9 — seam doc
 * panel-ui-seams.md:17): this consumer interprets `acceptOptionIndex`'s
 * `AcceptOutcome` signal and NEVER re-derives it from state — the old
 * `q.answer === before` reference comparison WAS the bug (applyAnswer
 * assigns a FRESH answer object on real commits while the same-value no-op
 * deliberately leaves the answer object untouched, so an identity check
 * reads the no-op as a veto and strands the user in the deep pane):
 * - "noop"   — same-value re-commit: INERT (no applyAnswer, no answer.at
 *   rewrite, no seam, no moot recompute, no auto-submit) but the Q14
 *   advance ALREADY RAN inside acceptOptionIndex — NOT a veto; the panel
 *   returns to the short form exactly like a real ACCEPT.
 * - "accept" — real commit applied (ripple passed or not applicable);
 *   advance already ran; return to short.
 * - "veto"   — the ripple-confirm seam refused the edit; NOTHING applied,
 *   NO advance; the user STAYS in deep view to re-decide in the pane they
 *   are reading (dropping to short would hide it).
 * - false    — out-of-range index (defensive; unreachable here — the
 *   index is clamped into [0, options.length] and the Other index is
 *   handled above); propagated honestly (`!== false`).
 */
export function acceptFromDeep(panel: InterrogationPanel): boolean {
  const { q } = deepInput(panel);
  if (q === undefined) return true;
  if (q.type !== "choice") return true;
  if (q.status === "moot" || q.status === "withdrawn") return true;
  const count = q.options?.length ?? 0;
  const index = Math.min(Math.max(0, panel.cursorIndex), count);
  if (index === count) {
    // ✎ Other section (WRITEIN-001 deep parity, P1.M2.T6.S1): enter only
    // OPENS the write-in duty — short form + editor focused, seeded from
    // the freshest draft by focusTextField; writeInEnter owns the commit
    // (h2.32). Branch order mirrors actions.ts accept()'s Other row.
    panel.textDuty = "writein";
    panel.setView("short");
    panel.scrollOffset = 0;
    panel.focusTextField();
    return true;
  }
  const outcome = acceptOptionIndex(panel, q, index);
  // ANSWER-PIN-001 / FR-D9: only a ripple VETO keeps the user in deep view
  // (dropping to short would hide the pane they are reading; nothing was
  // committed). A same-value NO-OP is NOT a veto — the Q14 advance already
  // ran inside acceptOptionIndex, so the panel returns to the short form
  // exactly like a real ACCEPT. Never re-derive the outcome from state
  // (q.answer before/after identity) — that heuristic is the bug this
  // signal replaced.
  if (outcome === "veto") return true;
  panel.setView("short");
  panel.scrollOffset = 0;
  return outcome !== false;
}

/**
 * Seed the deep selection for a question — via {@link initialCursorIndex},
 * clamped into the deep cursor domain `[0, options.length]` (P1.M2.T6.S1:
 * the synthetic Other index is legal — the clamp bound is `count`, not
 * `count - 1`, so a cursor parked on the Other section is tolerated rather
 * than snapped below it). ANSWER-PIN-001 (FR-35): a recorded answer owns
 * the caret — its display row (D-R13), or the ✎ Other index for write-ins
 * (legal under the `count` clamp; stale values land on display row 0) —
 * while the ★ recommendation preselect applies only to UNANSWERED
 * questions. Zero-option choice questions seed onto the Other row itself
 * (index 0 === count). Used by panel.setView when ENTERING deep view;
 * `currentId`'s own setter already re-seeds on question changes.
 */
export function deepSeedCursorIndex(q: Question | undefined): number {
  if (q === undefined || q.type !== "choice") return 0;
  const count = q.options?.length ?? 0;
  return Math.min(initialCursorIndex(q), count);
}

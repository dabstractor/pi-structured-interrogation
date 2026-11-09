/**
 * src/panel/chat-view.ts — side-chat view core renderer (SIDECHAT-001,
 * P1.M2.T1.S1; FR-15 / h2.38 §Side chat).
 *
 * PURE render module (deep-view.ts discipline): inputs in, lines out — no
 * panel.ts import, no pi runtime imports, no singleton reads, no state
 * mutation, no I/O. The caller (P1.M2.T4.S1's "chat" render branch) owns
 * view seeding, the scroll offset on the panel, and invalidate-on-store-
 * mutation (cached-render discipline, panel.ts's buildLines seam); this
 * module owns the height cap, the tail-pinned window clamp, and the exact
 * line strings.
 *
 * VIEW CONTRACT (h2.38, verbatim strings):
 *
 * - Line 1 header: `chat · {id} — {prompt}`, INSET 2-col convention, the
 *   prompt truncated with truncateVisible to fit the width-2 budget (no
 *   ellipsis logic of our own).
 * - Transcript window: user lines prefixed `you › ` (continuation lines
 *   hang-indent under the prefix), assistant lines plain; long bodies wrap
 *   with deep-view's wrapText so no line exceeds the width. While
 *   `streamState === "streaming"` the in-flight reply TOKEN-STREAMS: the
 *   engine's cumulative `streamingText` buffer renders as a growing
 *   assistant tail, the trailing `▌` cursor riding its LAST wrapped row.
 *   Before the first token (`streamingText` empty) a THINKING row shows an
 *   animated spinner plus elapsed seconds (`⠙ thinking… · 4s`) — frame and
 *   elapsed are pure functions of the caller-supplied `nowMs` render clock
 *   and `streamStartedAt`; with a FROZEN assistant tail and an empty buffer
 *   the legacy shape (trailing cursor on the last line) is kept. The window shows at
 *   most {@link CHAT_VIEW_HEIGHT} lines and is TAIL-PINNED — the newest
 *   exchange is visible on open (setView seeds bottom; P1.M2.T3.S1's ↑/↓
 *   move the panel-owned offset through {@link clampChatScroll}).
 * - One BLANK padding line between window and footer (locked padding rule:
 *   one blank line below every view's scroll area, ABOVE the footer).
 * - Footer HINT STRING (the `└ … ⏎` frame + progress composition belongs
 *   to the panel seam's renderFooter-style pass): statics
 *   `enter send · /clear · esc {abort|exit}` — the esc word flips on the
 *   stream state (`abort` while streaming, safety-critical). When the chat
 *   binding is REMAPPED off its default, the footer names it:
 *   `{resolvedKeys.chat} opens the chat on {id}` — labels flow ONLY from
 *   the resolvedKeys argument (no-hardcoded-keys discipline); fixed-key
 *   names (enter/esc) are not remappable and may be named directly
 *   (renderFooter precedent).
 *
 * S2 EXTRAS (P1.M2.T1.S2 — three render pieces on the record's state):
 *
 * - Inert banner: `modelSnapshot.provider === ""` (the engine's empty
 *   marker) → one dim row directly under the header, byte-pinned to
 *   sidechat-engine.ts's module-private INERT_NOTICE (duplicated, never
 *   imported — purity). Renders ALWAYS, even with an empty transcript:
 *   an inert chat with nothing in it is exactly the open-inert frame.
 * - Notice rows (latest-wins): the record's `notices` log is append-only;
 *   the view renders ONLY the newest entry as one `! {text}` row directly
 *   above the padding line. A `lastRejection` row (the five stable
 *   AnswerBlockRejection values mapped through the exported
 *   ANSWER_REJECTION_NOTICES map — the enum IS the notice API) shares that
 *   slot and renders immediately ABOVE the notice row when both exist:
 *   the rejection is the most recent settle outcome, the notice engine
 *   noise. Drop order under squeeze: engine-notice row first (narrow
 *   budget drops it before `/clear` drops from the footer), then the
 *   rejection; the banner and the confirm row NEVER drop (state, not
 *   decoration) — under tiny rows the window yields lines first, floor 1.
 * - Answer confirm row: while `pendingConfirm` exists, the row
 *   `apply ★ {preview}? · enter = yes · esc = no` REPLACES the footer
 *   hint string entirely (ripple-confirm family — a confirm state OWNS the
 *   footer slot, never stacks under it; frame-less so the panel seam
 *   composes its frame identically). `{preview}`: acceptOptionIndex
 *   indexes the question's DISPLAY-order options (OOB → `#{i}`, never
 *   crash); writeIn previews the verbatim text, visible-truncated. The ★
 *   is the spec's literal mark, NOT the recommendation-star logic; the
 *   row NEVER degrades away — it is the view's active decision state.
 *   pendingConfirm/lastRejection are mutually exclusive by the store's
 *   one-write settle (sidechat.ts settleApplyDecision).
 *
 * CONSUMERS: P1.M2.T3.S1 routes enter/esc when `pendingConfirm` is set
 * (the confirm row's visibility IS the routing contract's user-facing
 * half); P1.M2.T6.S1 applies through the named seam and calls
 * clearPendingConfirm. The close/usage flash is deliberately NOT a row —
 * ctx.ui.notify is its only channel (SIDECHAT-005).
 *
 * Terminal fallbacks (h2.30 ladder via terminalBudget): narrow (cols < 60)
 * drops `/clear` first and then the binding-name clause; hint-suppress
 * rows (< 24) keep only `esc {abort|exit}`; tiny rows (< 12) shrink the
 * window to `max(1, rows - 4)` lines so header + window + blank + footer
 * fit, footer degrading to `esc {word}` alone.
 *
 * CHAT-CONTEXT-001 (owner ruling 2026-11-08): the panel seam renders the
 * question + answer options AS INITIALLY PRESENTED (the short-view
 * renderers, display-only) directly ABOVE this module's output — the chat
 * is APPENDED to that presentation, never a replacement for it. The seam
 * owns the fit: it measures the question block and passes the sixth
 * `viewportHeight` argument (live rows minus the block and the frame
 * chrome) so the transcript window yields lines FIRST (floor 1) and the
 * question stays visible on short terminals. Absent argument ⇒ the
 * historical heights above, byte-identical.
 *
 * SEAMS for the siblings (do not implement here):
 * - P1.M2.T1.S2 LANDED its pieces in this module (see "S2 EXTRAS" above —
 *   the [header, …banner, …window, …extras, "", footer] return order is the
 *   placement contract).
 * - CHAT-CONTEXT-001: the question + options block lives at the PANEL seam
 *   (short-view.ts renderers, display-only) — this module never renders
 *   it; it only accepts the window cap the seam derives from it.
 * - P1.M2.T3.S1 (input routing) targets the panel-owned scroll offset —
 *   clamp it through {@link clampChatScroll} before storing.
 * - P1.M2.T4.S1 (panel wiring) seeds the view bottom, invalidates on
 *   sidechat store mutations, and composes the footer frame.
 */
import { visibleWidth } from "@earendil-works/pi-tui";
import type { KeyAction } from "../config.js";
import { wrapText } from "./deep-view.js";
import { truncateVisible } from "./layout.js";
// Kept single-line: the module-hygiene test pins the import-line shape.
import type { AnswerBlockRejection, ApplyDecision, ChatMessage, ChatStreamState, ModelSnapshot, SidechatNotice } from "./sidechat.js";
import { OVERVIEW_PAGINATE_ROWS, terminalBudget, type TerminalBudget } from "./terminal-budget.js";

/** Deep-view DEEP_VIEW_HEIGHT precedent: transcript window cap in content lines. */
export const CHAT_VIEW_HEIGHT = 20;

/** Two-column inset applied to every line (panel-wide line convention). */
const INSET = "  ";
/** Prefix on user transcript lines (h2.38 verbatim). */
const USER_PREFIX = "you › ";
/** Streaming cursor glyph (h2.38: "streaming cursor while a reply is in flight"). */
const CURSOR = "▌";
/** Spinner frames + period for the pre-first-token thinking row (frame
 * index = nowMs / SPINNER_MS mod length — pure per render, no timers here). */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const SPINNER_MS = 120;
/** The chat action's DEFAULT binding — the only literal compared against a label. */
const CHAT_DEFAULT_LABEL = "c";

/**
 * Inert no-model banner text (P1.M2.T1.S2) — BYTE-PINNED to sidechat-engine.ts's
 * module-private `INERT_NOTICE` (:183). Deliberately DUPLICATED, never
 * imported: the engine module pulls pi-ai, and this view must stay pure
 * (no engine imports — the M3.T1 cache-isolation guard scans for them).
 */
const INERT_BANNER =
  "no side chat model available — check sideChatModel in your config and provider auth";

/**
 * AnswerBlockRejection → one-line in-view notice text (P1.M2.T1.S2). The
 * enum IS the notice API (sidechat.ts AnswerBlockRejection JSDoc): each of
 * the five stable values maps to exactly one row; the wording tells the
 * user what happened and how to nudge the model. Fixed strings — never
 * remapped, never themed here (the panel seam themes later).
 */
export const ANSWER_REJECTION_NOTICES: Record<AnswerBlockRejection, string> = {
  "no-block":
    "no answer block in the reply — ask the side model to conclude with a fenced ```answer block",
  "malformed-json": "answer block is not valid JSON — ask the side model to retry",
  "unknown-shape": 'answer block must be exactly {"value": …} or {"text": …}',
  "value-mismatch": "answer value does not match any option — ask the side model to pick from the list",
  "empty-text": "answer text is empty — ask the side model to retry",
};

/** Confirm-row fixed frame (P1.M2.T1.S2): `apply ★ {preview}? · enter = yes · esc = no`.
 * The ★ is the SPEC'S literal mark (SIDECHAT-004 example), not the
 * recommendation-star logic; enter/esc are fixed keys (ripple-confirm footer
 * precedent — not config surface, never resolvedKeys). */
const CONFIRM_PREFIX = "apply ★ ";
const CONFIRM_SUFFIX = "? · enter = yes · esc = no";

/** Structural slice of SidechatRecord — the view never sees the singleton. */
export interface ChatViewState {
  messages: ChatMessage[];
  streamState: ChatStreamState;
  /** Engine event log (append-only, oldest first) — the view renders ONLY
   * the newest entry (latest-wins; P1.M2.T1.S2). */
  notices: SidechatNotice[];
  /** Pending apply offer — its confirm row REPLACES the footer hints. */
  pendingConfirm?: ApplyDecision;
  /** Why the last settled reply's block was inapplicable — one rejection
   * notice row (mutually exclusive with pendingConfirm by the one-write
   * settle). */
  lastRejection?: AnswerBlockRejection;
  /** Model identity frozen at record creation; the inert marker is
   * `{ provider: "", modelId: "" }` → the banner row renders. */
  modelSnapshot: ModelSnapshot;
  /** In-flight reply text (the engine's cumulative partial buffer) — while
   * `streamState === "streaming"` this renders as a growing assistant tail
   * (token streaming); empty/absent = pre-first-token → the thinking row. */
  streamingText?: string;
  /** Wall-clock ms at the live turn's dispatch — feeds the thinking row's
   * elapsed-seconds readout (absent → no elapsed shown). */
  streamStartedAt?: number;
  /** Render clock (ms) supplied by the panel per render tick — the spinner
   * frame and elapsed readout are PURE functions of it (this module stays
   * timer-free; the panel's stream ticker drives repaints). */
  nowMs?: number;
}

/** The question the chat is attached to (header identity + option preview). */
export interface ChatViewQuestion {
  id: string;
  prompt: string;
  /** Options in DISPLAY order (D-R13 recommended-first) — the confirm row's
   * `acceptOptionIndex` preview indexes THIS array (ApplyDecision carries an
   * index, not a value). */
  options?: Array<{ value: string }>;
}

/**
 * Clamp a scroll offset against the transcript window (deep-view
 * clampScroll precedent, TAIL-PINNED): negative offsets clamp to 0 (head)
 * and offsets past the end clamp to `totalLines - CHAT_VIEW_HEIGHT`, so an
 * offset pointing beyond the bottom shows the NEWEST lines (the open-seeds-
 * bottom contract — P1.M2.T3.S1's ↑/↓ move the offset, the panel stores it,
 * this module guarantees the window bounds). Pure.
 */
export function clampChatScroll(totalLines: number, scrollOffset: number): number {
  const maxOffset = Math.max(0, totalLines - CHAT_VIEW_HEIGHT);
  return Math.min(Math.max(0, scrollOffset), maxOffset);
}

/**
 * Render the side-chat view body: header line, tail-pinned transcript
 * window (≤ {@link CHAT_VIEW_HEIGHT} lines, or `max(1, rows - 4)` at tiny
 * row counts), one blank padding line, and the footer hint string. Every
 * returned line is INSET 2-col and fits `width` visible columns; the
 * footer hint is frame-less — the panel seam composes
 * `└ {progress} · {hints} ⏎ ┘`. Pure: no reads beyond the arguments.
 *
 * @param width terminal width for this pass
 * @param rows terminal rows for this pass (undefined ⇒ no height fallbacks)
 * @param chat structural slice of the sidechat record (messages + stream state
 *   + the S2 extras: notices, pendingConfirm, lastRejection, modelSnapshot)
 * @param question the question the chat is attached to (header identity;
 *   `options` in DISPLAY order feeds the confirm row's preview)
 * @param resolvedKeys resolved key LABELS — the only source for the
 *   remappable chat binding's name in the footer
 * @param viewportHeight CHAT-CONTEXT-001 transcript-window cap from the
 *   panel seam (it renders the question + options block above this output
 *   and subtracts that height from the live rows). Optional and
 *   SHRINK-ONLY: `min` against the historical height (the tiny-rows
 *   formula or {@link CHAT_VIEW_HEIGHT}), floor 1 — the cap never GROWS
 *   the window. Absent ⇒ the historical height, byte-identical (unknown
 *   rows pass nothing and keep the fixed cap).
 */
export function buildChatContent(
  width: number,
  rows: number | undefined,
  chat: ChatViewState,
  question: ChatViewQuestion,
  resolvedKeys: Record<KeyAction, string>,
  viewportHeight?: number,
): string[] {
  const budget = terminalBudget(width, rows);
  // S2 state rows. Inert banner: the record's frozen model identity is the
  // empty marker → the chat opened inert; the banner is STATE (the reason
  // the chat cannot act), rendered at every budget, even with an empty
  // transcript (that is exactly the inert-on-open frame).
  const banner = chat.modelSnapshot.provider === "" ? [inertBannerLine(width)] : [];
  // Rejection / latest-notice rows between window and padding (drop rules
  // inside extraRows).
  const extras = extraRows(chat, budget, width);
  // Tiny rows (< 12, h2.30's paginate threshold): the WHOLE view must fit —
  // header + window + blank + footer = rows - 4 lines of room; the S2 state
  // rows are chrome too, so the WINDOW yields lines first (floor 1) when
  // they are present. The banner and the confirm row never yield.
  const tiny = budget.overviewViewportHeight !== Infinity;
  const base = tiny
    ? Math.max(1, (rows ?? OVERVIEW_PAGINATE_ROWS) - 4 - banner.length - extras.length)
    : CHAT_VIEW_HEIGHT;
  // CHAT-CONTEXT-001: the seam's cap only ever SHRINKS (min against the
  // historical height; floor 1) — CHAT_VIEW_HEIGHT stays the ceiling.
  const height =
    viewportHeight !== undefined ? Math.max(1, Math.min(base, viewportHeight)) : base;

  const transcript = transcriptLines(chat, width);
  // Tail-pinned window: the NEWEST lines are the default view (setView
  // seeds bottom; the panel-owned offset navigates via clampChatScroll at
  // the wiring layer — this render always guarantees the bottom window).
  const start = Math.max(0, transcript.length - height);
  // CRASH GUARD (live pi-tui uncaughtException "Rendered line … exceeds
  // terminal width"): every window row is hard-bounded to `width` —
  // truncateVisible is a NO-OP on fitting lines, so this costs nothing in
  // the common case and makes the component structurally incapable of
  // overflowing the terminal, whatever a future overlay appends.
  const window = transcript.slice(start, start + height).map((line) => truncateVisible(line, width));

  // Footer slot (the ONLY placement subtlety — ripple-confirm family): a
  // pending confirm REPLACES the hint string entirely (a confirm state owns
  // the footer slot; it never stacks under it) and NEVER degrades away —
  // it is the view's active decision state, safety-critical like esc abort.
  const footerLine =
    chat.pendingConfirm !== undefined
      ? confirmRow(chat.pendingConfirm, question, width)
      : footerHints(question, resolvedKeys, budget);

  return [headerLine(question, width), ...banner, ...window, ...extras, "", footerLine];
}

// ------------------------------------------------------------------ helpers

/** Line 1: `chat · {id} — {prompt}`, prompt truncateVisible'd to fit width-2. */
function headerLine(question: ChatViewQuestion, width: number): string {
  const budget = Math.max(1, width - INSET.length);
  const head = `chat · ${question.id} — `;
  const prompt = truncateVisible(question.prompt, Math.max(1, budget - visibleWidth(head)));
  return `${INSET}${head}${prompt}`;
}

/**
 * One transcript message → rendered lines. User lines carry the `you › `
 * prefix on the first row with a hanging indent on wrap continuations;
 * assistant lines render plain. wrapText keeps every line within the
 * width-2 content budget (ANSI/wide-char-safe — never String.slice).
 */
function messageLines(message: ChatMessage, width: number): string[] {
  const budget = Math.max(1, width - INSET.length);
  if (message.role === "user") {
    const bodyBudget = Math.max(1, budget - visibleWidth(USER_PREFIX));
    return wrapText(message.text, bodyBudget).map((line, i) =>
      i === 0
        ? `${INSET}${USER_PREFIX}${line}`
        : `${INSET}${" ".repeat(visibleWidth(USER_PREFIX))}${line}`,
    );
  }
  return wrapText(message.text, budget).map((line) => `${INSET}${line}`);
}

/** Full transcript with the streaming overlay applied (h2.38 + token streaming). */
function transcriptLines(chat: ChatViewState, width: number): string[] {
  const lines: string[] = [];
  for (const message of chat.messages) lines.push(...messageLines(message, width));
  if (chat.streamState !== "streaming") return lines;
  const partial = chat.streamingText ?? "";
  if (partial.length > 0) {
    // Token streaming: the cumulative buffer renders as a growing assistant
    // tail (same wrap rules as a frozen assistant row); the cursor rides its
    // LAST wrapped row so the newest token is always visibly "live".
    const body = wrapText(partial, Math.max(1, width - INSET.length)).map(
      (line) => `${INSET}${line}`,
    );
    lines.push(...withTrailingCursor(body, width));
    return lines;
  }
  // Pre-first-token: no buffer yet. A FROZEN assistant tail keeps the
  // legacy trailing-cursor shape; a user tail (or empty chat) shows the
  // thinking row — animated spinner + elapsed, the "is it alive" signal.
  const last = lines[lines.length - 1];
  if (chat.messages[chat.messages.length - 1]?.role === "assistant" && last !== undefined) {
    withTrailingCursor(lines, width); // trailing cursor on the reply (width-safe)
  } else {
    lines.push(thinkingLine(chat, width)); // standalone indicator row
  }
  return lines;
}

/**
 * Append the streaming cursor to the last of the given rendered rows,
 * WIDTH-SAFE by construction. The live-crash lesson (pi-tui uncaughtException
 * "Rendered line … exceeds terminal width", 242 > 241): appending the
 * cursor AFTER wrapping overflows a full-width last row by exactly one
 * column. Room on the last row → trailing cursor; a FULL last row (or no
 * rows) → the cursor gets its own INSET row. Never widens any line past
 * `width`.
 */
function withTrailingCursor(rows: string[], width: number): string[] {
  const last = rows[rows.length - 1];
  if (last !== undefined && visibleWidth(last) + visibleWidth(CURSOR) <= width) {
    rows[rows.length - 1] = `${last}${CURSOR}`;
    return rows;
  }
  rows.push(`${INSET}${CURSOR}`);
  return rows;
}

/**
 * The pre-first-token indicator row: `{frame} thinking… · {N}s`. The
 * spinner frame derives from the caller-supplied `nowMs` render clock
 * (`nowMs / SPINNER_MS mod frames`) and the elapsed seconds from
 * `streamStartedAt` — PURE per render (no timers in this module); an
 * absent clock pins frame 0 and an absent start hides the elapsed term.
 */
function thinkingLine(chat: ChatViewState, width: number): string {
  const frame = SPINNER_FRAMES[Math.floor((chat.nowMs ?? 0) / SPINNER_MS) % SPINNER_FRAMES.length]!;
  let text = `${frame} thinking…`;
  if (
    chat.streamStartedAt !== undefined &&
    chat.nowMs !== undefined &&
    chat.nowMs >= chat.streamStartedAt
  ) {
    text += ` · ${Math.floor((chat.nowMs - chat.streamStartedAt) / 1000)}s`;
  }
  return `${INSET}${truncateVisible(text, Math.max(1, width - INSET.length))}`;
}

/**
 * Footer hint string (frame composed at the panel seam). FOOTER-001: the
 * one non-ubiquitous affordance worth its chars is `/clear` — the
 * confused-chat escape hatch (SIDECHAT-005) — and it never drops; the
 * binding-name reopen clause yields first under narrow/suppressed
 * budgets. Enter-send and esc-abort/exit wording is deleted (ubiquitous
 * keys earn no labels). The chat binding's name flows ONLY from
 * resolvedKeys.
 */
function footerHints(
  question: ChatViewQuestion,
  resolvedKeys: Record<KeyAction, string>,
  budget: TerminalBudget,
): string {
  const hints = ["/clear"];
  if (!budget.narrow && !budget.suppressHint && resolvedKeys.chat !== CHAT_DEFAULT_LABEL) {
    hints.push(`${resolvedKeys.chat} opens the chat on ${question.id}`);
  }
  return hints.join(" · ");
}

/**
 * The S2 state rows between the window and the padding line, in render
 * order: the rejection row FIRST (immediately ABOVE the notice row — the
 * rejection is the most recent settle outcome; the notice is engine
 * noise). Drop rules: the engine-notice row drops FIRST under squeeze —
 * narrow budget drops it before `/clear` ever drops from the footer —
 * while the rejection survives narrow and only yields with the window at
 * its floor (it is the settle outcome the user must see to understand why
 * nothing applies). pendingConfirm renders neither: the fields are
 * mutually exclusive by the one-write settle, and its confirm row owns the
 * footer instead (the guard here is defensive).
 */
function extraRows(chat: ChatViewState, budget: TerminalBudget, width: number): string[] {
  const rows: string[] = [];
  if (chat.pendingConfirm === undefined && chat.lastRejection !== undefined) {
    rows.push(noticeLine(ANSWER_REJECTION_NOTICES[chat.lastRejection], width));
  }
  if (!budget.narrow && chat.notices.length > 0) {
    const latest = chat.notices[chat.notices.length - 1];
    if (latest !== undefined) rows.push(noticeLine(latest.text, width));
  }
  return rows;
}

/** One `! {text}` notice/rejection row (latest-wins slot), truncated to width. */
function noticeLine(text: string, width: number): string {
  const budget = Math.max(1, width - INSET.length - visibleWidth("! "));
  return `${INSET}! ${truncateVisible(text, budget)}`;
}

/**
 * The inert no-model banner row — directly under the header. The text is
 * BYTE-PINNED to sidechat-engine.ts's module-private INERT_NOTICE and
 * deliberately duplicated (never imported): the engine module pulls pi-ai
 * and this view's purity is load-bearing (M3.T1 cache-isolation guard).
 */
function inertBannerLine(width: number): string {
  return `${INSET}${truncateVisible(INERT_BANNER, Math.max(1, width - INSET.length))}`;
}

/**
 * The answer confirm row — `apply ★ {preview}? · enter = yes · esc = no`
 * (SIDECHAT-004 byte-exact; the ★ is the spec's literal mark, NOT the
 * recommendation-star logic; enter/esc are fixed keys named directly, the
 * ripple-confirm footer precedent). Frame-less: it replaces the footer
 * hint STRING in the same slot, so the panel seam composes its
 * `└ … ⏎ ┘` frame around it identically. Preview: `acceptOptionIndex`
 * indexes the question's DISPLAY-order options (guarded — out-of-bounds
 * falls back to `#{i}` and never crashes); `writeIn` carries the text
 * verbatim, visible-truncated to the remaining width, no quotes added.
 * The caller renders this at EVERY budget — it never degrades away.
 */
function confirmRow(d: ApplyDecision, question: ChatViewQuestion, width: number): string {
  const budget = Math.max(1, width - visibleWidth(CONFIRM_PREFIX) - visibleWidth(CONFIRM_SUFFIX));
  const raw =
    d.seam === "writeIn"
      ? d.text
      : (question.options?.[d.optionIndex]?.value ?? `#${d.optionIndex}`); // OOB guard
  return `${CONFIRM_PREFIX}${truncateVisible(raw, budget)}${CONFIRM_SUFFIX}`;
}

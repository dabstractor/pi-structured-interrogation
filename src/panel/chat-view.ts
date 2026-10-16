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
 *   `streamState === "streaming"` the LAST transcript line carries a
 *   trailing `▌` cursor; when the tail is a user message (no assistant
 *   text yet) the cursor is a standalone row instead. The window shows at
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
 * Terminal fallbacks (h2.30 ladder via terminalBudget): narrow (cols < 60)
 * drops `/clear` first and then the binding-name clause; hint-suppress
 * rows (< 24) keep only `esc {abort|exit}`; tiny rows (< 12) shrink the
 * window to `max(1, rows - 4)` lines so header + window + blank + footer
 * fit, footer degrading to `esc {word}` alone.
 *
 * SEAMS for the siblings (do not implement here):
 * - P1.M2.T1.S2 (notices: per-reason error/malformed-block/close rows, the
 *   answer confirm row, the inert no-model notice) may add an optional
 *   `extras: string[]` parameter rendered between the window and the
 *   padding line — the return order [header, …window, …extras?, "", footer]
 *   is the documented extension point.
 * - P1.M2.T3.S1 (input routing) targets the panel-owned scroll offset —
 *   clamp it through {@link clampChatScroll} before storing.
 * - P1.M2.T4.S1 (panel wiring) seeds the view bottom, invalidates on
 *   sidechat store mutations, and composes the footer frame.
 */
import { visibleWidth } from "@earendil-works/pi-tui";
import type { KeyAction } from "../config.js";
import { wrapText } from "./deep-view.js";
import { truncateVisible } from "./layout.js";
import type { ChatMessage, ChatStreamState } from "./sidechat.js";
import { OVERVIEW_PAGINATE_ROWS, terminalBudget, type TerminalBudget } from "./terminal-budget.js";

/** Deep-view DEEP_VIEW_HEIGHT precedent: transcript window cap in content lines. */
export const CHAT_VIEW_HEIGHT = 20;

/** Two-column inset applied to every line (panel-wide line convention). */
const INSET = "  ";
/** Prefix on user transcript lines (h2.38 verbatim). */
const USER_PREFIX = "you › ";
/** Streaming cursor glyph (h2.38: "streaming cursor while a reply is in flight"). */
const CURSOR = "▌";
/** The chat action's DEFAULT binding — the only literal compared against a label. */
const CHAT_DEFAULT_LABEL = "e";

/** Structural slice of SidechatRecord — the view never sees the singleton. */
export interface ChatViewState {
  messages: ChatMessage[];
  streamState: ChatStreamState;
}

/** The question the chat is attached to (header identity only). */
export interface ChatViewQuestion {
  id: string;
  prompt: string;
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
 * @param chat structural slice of the sidechat record (messages + stream state)
 * @param question the question the chat is attached to (header identity)
 * @param resolvedKeys resolved key LABELS — the only source for the
 *   remappable chat binding's name in the footer
 */
export function buildChatContent(
  width: number,
  rows: number | undefined,
  chat: ChatViewState,
  question: ChatViewQuestion,
  resolvedKeys: Record<KeyAction, string>,
): string[] {
  const budget = terminalBudget(width, rows);
  // Tiny rows (< 12, h2.30's paginate threshold): the WHOLE view must fit —
  // header + window + blank + footer = rows - 4 lines of room.
  const tiny = budget.overviewViewportHeight !== Infinity;
  const height = tiny ? Math.max(1, (rows ?? OVERVIEW_PAGINATE_ROWS) - 4) : CHAT_VIEW_HEIGHT;

  const transcript = transcriptLines(chat, width);
  // Tail-pinned window: the NEWEST lines are the default view (setView
  // seeds bottom; the panel-owned offset navigates via clampChatScroll at
  // the wiring layer — this render always guarantees the bottom window).
  const start = Math.max(0, transcript.length - height);
  const window = transcript.slice(start, start + height);

  return [headerLine(question, width), ...window, "", footerHints(chat, question, resolvedKeys, budget)];
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

/** Full transcript with the streaming cursor applied (h2.38's two shapes). */
function transcriptLines(chat: ChatViewState, width: number): string[] {
  const lines: string[] = [];
  for (const message of chat.messages) lines.push(...messageLines(message, width));
  if (chat.streamState === "streaming") {
    const last = lines[lines.length - 1];
    if (chat.messages[chat.messages.length - 1]?.role === "assistant" && last !== undefined) {
      lines[lines.length - 1] = `${last}${CURSOR}`; // trailing cursor on the reply
    } else {
      lines.push(`${INSET}${CURSOR}`); // user tail / empty chat: standalone cursor row
    }
  }
  return lines;
}

/**
 * Footer hint string (frame composed at the panel seam). Degrades per the
 * h2.30 ladder: narrow drops `/clear` then the binding-name clause;
 * hint-suppress and tiny rows keep only the safety-critical
 * `esc {abort|exit}`. The esc word flips on the stream state; the chat
 * binding's name flows ONLY from resolvedKeys.
 */
function footerHints(
  chat: ChatViewState,
  question: ChatViewQuestion,
  resolvedKeys: Record<KeyAction, string>,
  budget: TerminalBudget,
): string {
  const escWord = chat.streamState === "streaming" ? "abort" : "exit";
  if (budget.suppressHint) return `esc ${escWord}`;
  const hints =
    budget.narrow ? ["enter send", `esc ${escWord}`] : ["enter send", "/clear", `esc ${escWord}`];
  if (!budget.narrow && resolvedKeys.chat !== CHAT_DEFAULT_LABEL) {
    hints.push(`${resolvedKeys.chat} opens the chat on ${question.id}`);
  }
  return hints.join(" · ");
}

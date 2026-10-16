# Research notes — P1.M2.T1.S1 (chat-view.ts: header, transcript, scroll window, footer, render budget)

## Upstream contracts (verified in live source)

- `src/panel/sidechat.ts` (landed M1): `ChatMessage {role:"user"|"assistant", text, at, stopReason?}` (:94); `ChatStreamState = "idle" | "streaming"` (:102); `SidechatRecord {questionId, messages, streamState, …}` (:195); singleton `get()` (:220). Streaming cursor renders off `streamState === "streaming"` (record JSDoc :208 names P1.M2.T1.S1 as the consumer).
- `src/panel/sidechat-engine.ts` — unwired engine (open path is P1.M2.T4.S1); not needed here.
- `src/panel/terminal-budget.ts`: `terminalBudget(width, rows)` → `{hintSuppress, narrow, overviewPaginate, …}`; consts `HINT_SUPPRESS_ROWS=24`, `NARROW_COLS=60`, `OVERVIEW_PAGINATE_ROWS=12`.
- `src/panel/deep-view.ts` precedent: `DEEP_VIEW_HEIGHT = 20` (:104), `clampScroll(content, scrollOffset, cursorIndex)` (:529), `renderDeepWindow(...)` (:554). chat-view.ts mirrors: `CHAT_VIEW_HEIGHT ≈ 20` + a scroll clamp.
- `src/panel/layout.ts`: renderers PURE `(state, labels, theme, width) → string`; labels ALWAYS via caller-passed `resolveKeyLabels(config)` output (`labels: Record<KeyAction, string>`, renderFooter :488-491) — never hardcoded (h2.52 + no-hardcoded-keys.test.ts guard). `truncateVisible(text, budget)` exists in layout.ts (ANSI-aware). Two-col INSET convention `  `.
- Footer statics precedent: renderFooter prefixes/append static hints per screen ("enter accept", "esc back · ↑/↓ scroll", "enter jump · esc back") — chat appends `enter send · /clear · esc{abort|exit}`-style statics; but the ESC VARIANT (abort vs exit) depends on streamState, which renderFooter doesn't receive. DECISION: chat-view.ts exports its own `buildChatFooter(...)` (progress + chat statics + binding-name line), and P1.M2.T4.S1's render branch uses it instead of renderFooter for view==="chat" — documented split.
- Cached-render discipline (panel.ts :679-703 render/invalidate; rows re-read per render currentRows :711-718): sidechat store mutations must call panel.invalidate() — that wiring is P1.M2.T4/S5's; chat-view.ts stays PURE (no panel dependency): deep-view.ts's pattern of taking plain inputs and returning lines.

## UX contract (prd_snapshot h2.38 Side chat, verbatim strings)

- Header: `chat · q3 — {prompt, truncated}` (one line; id + prompt).
- Transcript: user lines prefixed `you ›`, assistant lines plain, streaming cursor while a reply is in flight; scrollable.
- Footer: `enter send · /clear · esc` — esc hint reads `abort` while streaming, `exit` when idle; NAMES THE BINDING when current ≠ bound: `e reopens the chat on q3` — generated from resolved config, never hardcoded.
- Terminal fallbacks "as every other view": <24 rows hint-suppress analog, <12 rows tiny, <60 cols narrow.
- Answer confirm row / notices / inert notice = P1.M2.T1.S2 (NOT this item).
- Chat input (second editor) = P1.M2.T2.S1; key routing (↑/↓ scroll target) = P1.M2.T3.S1; panel wiring = P1.M2.T4.S1.

## Design

`buildChatContent(width, rows, chatState, question, resolvedKeys)`:
- chatState: a minimal structural slice `{ messages: ChatMessage[]; streamState: ChatStreamState }` (accept `SidechatRecord` structurally — avoids importing panel singletons into the pure module; import types from ./sidechat.js).
- question: `{ id: string; prompt: string }` (structural — panel passes the live question).
- resolvedKeys: `Record<KeyAction, string>` (the resolveKeyLabels output; used for the binding-name line when label ≠ "e").
- Returns `{ lines: string[]; scrollTop … }`-free PURE lines: header, window of transcript (CHAT_VIEW_HEIGHT cap, wrapped to width, scroll clamp pins the tail/bottom by default since setView seeds latest), blank line (padding variation A), footer line.
- Streaming cursor: last assistant line gets a trailing `▌` (or a bare `… ▌` row when no assistant text yet) while streamState === "streaming".
- Long line wrapping: reuse `wrapText(text, budget)` from deep-view.ts (:272) for transcript bodies; header truncates via truncateVisible.
- Tiny rows (<12): window shrinks (max(1, rows-4) style) and hint suppression per terminalBudget; narrow (<60): footer degrades right-to-left like renderFooter's fit loop — simplest compliant: keep `enter send · esc` minimum + drop `/clear` first.

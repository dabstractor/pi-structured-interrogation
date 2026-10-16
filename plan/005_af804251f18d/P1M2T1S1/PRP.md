---
name: "P1.M2.T1.S1 — chat-view.ts: header, transcript, scroll window, footer, render budget (SIDECHAT-001 render module, part 1)"
description: "Create src/panel/chat-view.ts + chat-view.test.ts — a PURE render module (deep-view.ts pattern, no panel dependency) exporting buildChatContent(width, rows, chatState, question, resolvedKeys): one-line header `chat · {id} — {prompt, truncated}`; transcript window (user lines `you ›`, assistant plain, streaming cursor ▌ while streamState==='streaming') capped at CHAT_VIEW_HEIGHT ≈ 20 with a tail-pinned scroll clamp; blank padding line; footer line `enter send · /clear · esc` with esc hint `abort` while streaming / `exit` idle, generated from resolved key labels (binding-name line `e reopens the chat on q3` when label ≠ default), degrading per terminalBudget fallbacks. Notices/confirm row = P1.M2.T1.S2; input/routing/panel wiring = S2-S4. Mode A header doc block stating the SIDECHAT-001 view contract."
---

## Goal

**Feature Goal**: The side-chat view's core rendering — header, scrollable transcript window, and context-aware footer — as a pure module ready for P1.M2.T4.S1's "chat" render branch.

**Deliverable**: `src/panel/chat-view.ts` + `src/panel/chat-view.test.ts`. chat-view.ts exports:

```ts
export const CHAT_VIEW_HEIGHT = 20;   // deep-view DEEP_VIEW_HEIGHT precedent (:104)
export interface ChatViewState {       // structural slice of SidechatRecord
  messages: ChatMessage[];             // type imported from ./sidechat.js
  streamState: ChatStreamState;
}
export interface ChatViewQuestion { id: string; prompt: string; }
export function buildChatContent(
  width: number,
  rows: number | undefined,
  chat: ChatViewState,
  question: ChatViewQuestion,
  resolvedKeys: Record<KeyAction, string>,
): string[];
```

**Success Definition**: `npm test` + `npm run typecheck` green; exact-line layout tests at default/narrow/tiny budgets pass; truncation and hint variants (abort/exit/remapped binding) pass; no hardcoded key labels (the `no-hardcoded-keys.test.ts` discipline — labels only via the `resolvedKeys` argument); zero imports of panel.ts or pi runtime.

## User Persona

**Target User**: TUI user mid-interrogation who wants a private back-and-forth about one question without leaving the panel.

**Use Case**: Press `e` on q3 (wiring in P1.M2.T4.S1) → the panel body becomes: `chat · q3 — Which database…`, the streaming exchange, and a footer telling them `enter send · /clear · esc abort` while the reply streams.

**Pain Points Addressed**: SIDECHAT-001 replaces the discuss-in-chat handoff (suspend + main-editor preload + reopen round-trip) with an in-panel view; this module is its visual half.

## Why

- FR-15 / h2.38 Side chat: "one-line header (`chat · q3 — {prompt, truncated}`), scrollable transcript (user lines prefixed `you ›`, assistant lines plain, streaming cursor while a reply is in flight) … footer `enter send · /clear · esc` whose esc hint reads `abort` while streaming and `exit` when idle … Terminal fallbacks and render-cache discipline as every other view."
- architecture/panel-view-integration.md Add-a-view recipe step 3: "delegating to a new src/panel/chat-view.ts buildChatContent(…) (deep-view/overview pattern: module owns height cap + scroll clamp, e.g. CHAT_VIEW_HEIGHT ≈ 20)."
- Landing the pure renderer first keeps P1.M2.T2–T4 (notices, input, routing, panel wiring) diff-minimal.

## What

### 1. Module shape — `src/panel/chat-view.ts`

Pure module: imports ONLY types from `./sidechat.js` (`ChatMessage`, `ChatStreamState`), `KeyAction` from `../config.js`, and helpers from `./layout.js` / `./deep-view.js` / `./terminal-budget.js`. NO panel.ts import, NO pi imports (deep-view.ts discipline). Header doc block (Mode A): states the SIDECHAT-001 view contract it implements (header/transcript/footer per ui-spec §Side chat), that notices + the answer confirm row are P1.M2.T1.S2 additions, and that the caller (P1.M2.T4.S1) owns view seeding, scroll state on the panel, and invalidate-on-store-mutation (cached-render discipline, panel.ts :679-703).

### 2. Header (line 1)

```
chat · {question.id} — {question.prompt, truncateVisible to fit width-2}
```

One line, INSET (2-col) convention like every panel line. When the prompt is longer than the budget, truncate with `truncateVisible` (layout.ts) — no ellipsis logic of your own.

### 3. Transcript window

- Render each `ChatMessage`: user lines prefixed `you › ` (dim the prefix via the theme if a theme is passed — for the pure string core, plain prefix is fine; P1.M2.T4.S1 may theme at the panel seam), assistant lines plain. Wrap long bodies with `wrapText(text, budget)` (deep-view.ts :272) at `width - 2` so no line exceeds the width.
- Streaming cursor: while `chat.streamState === "streaming"`, the LAST line gets a trailing `▌`; when the last message is a user message (no assistant text yet), append a standalone `▌` row.
- Height cap: the transcript window shows at most `CHAT_VIEW_HEIGHT` (20) rendered lines; expose the clamp as `clampChatScroll(totalLines, scrollOffset)` (deep-view `clampScroll` precedent) — **tail-pinned by default**: the function returns the effective window such that the newest lines are visible when `scrollOffset` points past the end (setView will seed "bottom"; P1.M2.T3.S1's ↑/↓ move it). Pure: the panel owns the offset; this module clamps and windows.

### 4. Padding + footer

- One blank line between the window and the footer (padding variation A — "one blank line below every view's scroll area, ABOVE the footer").
- Footer, `└ …` frame optional at this layer — produce the HINT STRING; P1.M2.T4.S1 composes the frame with progress (renderFooter's `{progress} · {hints} ⏎` shape, layout.ts :488). Hints:
  - Statics: `enter send · /clear · esc {abort|exit}` — the esc word flips on `streamState`.
  - Binding-name line: when `resolvedKeys.chat !== "e"`, the footer carries `{label} reopens the chat on {question.id}` (e.g. `e reopens the chat on q3` when chat is bound elsewhere and `e` is free — NO: use the RESOLVED chat label: `{resolvedKeys.chat} opens the chat on {id}`; the spec's example `e reopens the chat on q3` shows the shape). Generated ONLY from `resolvedKeys` — never a literal key (no-hardcoded-keys discipline).
- Budget degradation, driven by `terminalBudget(width, rows)`:
  - Narrow (< `NARROW_COLS` 60): drop `/clear` first, keep `enter send · esc {word}`; the binding-name line drops next.
  - Hint-suppress rows analog (< `HINT_SUPPRESS_ROWS` 24): drop the statics entirely, keep the esc word alone (`esc abort` — it is safety-critical while streaming).
  - Tiny (< `OVERVIEW_PAGINATE_ROWS` 12): the transcript window shrinks to `max(1, rows - 4)` lines (header + window + blank + footer must fit); the footer degrades to `esc {word}`.

### 5. Tests — `src/panel/chat-view.test.ts`

Pure-function tests, no mocks (deep-view.test.ts pattern). Cover:

1. `layout_exactness_default_budget`: 80×40, 2 messages → exactly: header line, 2 transcript lines, blank, footer line — byte-exact strings.
2. `header_truncates_long_prompt`: 300-char prompt → header width-fits, contains `chat · q3 — `.
3. `user_prefix_and_plain_assistant`: `you › ` on user lines only; assistant plain; multi-line wrap via wrapText stays within width-2.
4. `streaming_cursor`: streamState "streaming" with an assistant tail → trailing `▌`; with a user tail → standalone `▌` row; idle → no cursor anywhere.
5. `window_cap_and_tail_pin`: >20 rendered lines → window is the LAST 20 (tail-pinned); `clampChatScroll` clamps negative and past-end offsets.
6. `footer_esc_word_variants`: idle → `esc exit`; streaming → `esc abort`.
7. `footer_names_binding_when_remapped`: resolvedKeys.chat = "x" → footer contains `x opens the chat on q3`; default "e" → no binding-name clause (the default footer already shows it via the key hints).
8. `narrow_degradation`: width 50 → `/clear` gone, `enter send · esc exit` survives; binding-name line dropped.
9. `hint_suppress_and_tiny_rows`: rows 20 → statics suppressed, `esc exit` alone; rows 10 → window ≤ 6 lines, footer just `esc exit`.

### 6. Explicitly OUT of scope

- Notices (in-view error/malformed-block/close-notice rows), the answer confirm row, the inert no-model notice — P1.M2.T1.S2 (buildChatContent should leave clean seams: an optional `extras: string[]` parameter MAY be added by S2; do not invent it now beyond a documented extension point in the doc block).
- The second editor/chat input (P1.M2.T2.S1), key routing incl. ↑/↓ targeting the window and the esc-abort rung (P1.M2.T3.S1), PanelView "chat" union/setView/render branch/open path (P1.M2.T4.S1), discard hooks (P1.M2.T5).
- Any theme/ANSI styling decisions beyond plain strings (the panel seam may add fg codes; keep the module's output plain and assert exact bytes).

### Success Criteria

- [ ] Byte-exact layout at default/narrow/tiny budgets; truncation; abort/exit; remapped-binding naming
- [ ] CHAT_VIEW_HEIGHT cap + clampChatScroll tail-pinning; streaming cursor both shapes
- [ ] Pure: no panel.ts/pi imports; labels only from resolvedKeys; typecheck green
- [ ] Mode A header doc block stating the SIDECHAT-001 contract + S2/S4 extension seams

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets: the exported signature, every layout string with byte examples, the height/scroll precedent (deep-view.ts), the budget constants and degradation ladder, the label-source rule with its guard test, and nine enumerated pure tests. No guessing.

### Documentation & References

```yaml
- file: src/panel/sidechat.ts
  why: ChatMessage (:94), ChatStreamState (:102), SidechatRecord (:195), get() (:220); record JSDoc :208 names this item as the streaming-cursor consumer
  gotcha: accept a STRUCTURAL slice (ChatViewState), not the whole record — keeps the module pure and testable

- file: src/panel/deep-view.ts
  why: the module pattern to follow — DEEP_VIEW_HEIGHT (:104), wrapText (:272), clampScroll (:529), renderDeepWindow (:554)
- file: src/panel/terminal-budget.ts
  why: terminalBudget(width, rows) + HINT_SUPPRESS_ROWS/NARROW_COLS/OVERVIEW_PAGINATE_ROWS consts driving the degradation ladder
- file: src/panel/layout.ts
  why: purity conventions, truncateVisible, INSET, renderFooter shape (:488 — P1.M2.T4.S1 composes the frame; this module supplies the hint string)
- file: src/panel/deep-view.test.ts
  why: the pure-render test conventions (byte-exact line arrays, no mocks)

- file: plan/005_af804251f18d/architecture/panel-view-integration.md
  why: §Add-a-view recipe steps 3-5 (this module = step 3's delegate; footer split documented), cached-render discipline note
- file: plan/005_af804251f18d/prd_snapshot.md (h2.38 Side chat section, FR-15, h2.30 fallbacks, padding rules)
  why: verbatim layout strings, esc-hint variants, binding-name line example, terminal-fallback contract
- file: src/no-hardcoded-keys.test.ts
  why: the banned-literal discipline — labels flow only through resolvedKeys; keep the module compliant
- file: plan/005_af804251f18d/P1M1T6S2/PRP.md (in flight)
  why: ApplyDecision/pendingConfirm lands next — S2's confirm row builds on this module's seams; no overlap (different render pieces)
```

### Current Codebase tree (relevant slice)

```bash
src/panel/ sidechat.ts sidechat-prompt.ts sidechat-engine.ts deep-view.ts overview.ts layout.ts terminal-budget.ts (+ tests)
```

### Desired Codebase tree

```bash
src/panel/chat-view.ts        # NEW — buildChatContent + CHAT_VIEW_HEIGHT + clampChatScroll
src/panel/chat-view.test.ts   # NEW — 9 pure tests
```

### Known Gotchas of our codebase & Library Quirks

```ts
// ESM ".js" import suffixes; type-only imports where possible (sidechat.js types)
// key labels NEVER hardcoded — resolvedKeys argument only (no-hardcoded-keys.test.ts + h2.52)
// wrapText(truncateVisible) are ANSI/width-aware — reuse, don't reimplement
// tail-pin, not head-pin: newest transcript lines must be visible by default (setView seeds bottom)
// blank padding line sits ABOVE the footer, never after it (locked padding rule, D-R14-era)
// the footer frame (└ … ⏎ + progress) belongs to the PANEL seam — this module returns the hint CONTENT, so S4 can compose renderFooter-style output
// don't read the singleton inside the module — the panel passes state in; store mutations trigger panel.invalidate() at the wiring layer (cached-render discipline)
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/panel/chat-view.ts
  - consts + types + buildChatContent + clampChatScroll + Mode A header doc block (What §1-4)
  - helpers: headerLine(question, width), transcriptLines(chat, width), windowLines(lines, height, scroll), chatHintString(chat, question, resolvedKeys, budget)

Task 2: CREATE src/panel/chat-view.test.ts (What §5) — pure, byte-exact, no mocks

Task 3: GATES
  - npm run typecheck
  - npx vitest run src/panel/chat-view.test.ts
  - npm test
```

### Implementation Patterns & Key Details

```ts
// Core skeleton:
export function buildChatContent(width, rows, chat, question, resolvedKeys): string[] {
  const budget = terminalBudget(width, rows);
  const height = Math.min(
    CHAT_VIEW_HEIGHT,
    budget.tiny ? Math.max(1, (rows ?? 24) - 4) : CHAT_VIEW_HEIGHT,
  );
  const header = headerLine(question, width);
  const body = windowLines(transcriptLines(chat, width), height, /* tail-pinned */);
  return [header, ...body, "", footerHints(chat, question, resolvedKeys, budget)];
}
// esc word: chat.streamState === "streaming" ? "abort" : "exit"
// binding-name clause only when resolvedKeys.chat !== "e" (label-driven, never a literal)
```

### Integration Points

```yaml
DOWNSTREAM (do NOT implement):
  - P1.M2.T1.S2: appends notice/confirm/inert rows (documented extension seam)
  - P1.M2.T3.S1: ↑/↓ route to the scroll offset this module clamps
  - P1.M2.T4.S1: PanelView "chat" union, setView bottom-seeding, buildLines branch, footer frame composition
CONFIG: none new (reads resolvedKeys only)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npx vitest run src/panel/chat-view.test.ts
```

### Level 2: Unit Tests

```bash
npm test   # full suite; in-flight P1.M1.T6.S2 touches sidechat.ts (parser/pendingConfirm) — different files, no conflicts
```

### Level 3: Integration Testing

None — the panel wiring is P1.M2.T4.S1; visual check happens there.

### Level 4: Domain Validation

Manual review against h2.38's layout paragraph: every named string (`chat · q3 — …`, `you ›`, `enter send · /clear · esc`, `abort`/`exit`, binding-name example) appears in the module or its tests.

## Final Validation Checklist

- [ ] `npm test` + `npm run typecheck` green; only 2 new files
- [ ] Header/transcript/footer byte-exact per tests; degradation ladder at 24/12-row and 60-col thresholds
- [ ] CHAT_VIEW_HEIGHT cap + tail-pinned clampChatScroll; streaming cursor both shapes
- [ ] Labels only via resolvedKeys (no-hardcoded-keys compliant); pure module (no panel/pi imports)
- [ ] Mode A header doc block: SIDECHAT-001 contract + S2/S3/S4 seams documented

## Anti-Patterns to Avoid

- ❌ Don't read the sidechat singleton or panel state inside the module — inputs in, lines out
- ❌ Don't hardcode `e`, `esc`, or any label in a string — the resolvedKeys argument is the only source
- ❌ Don't pin the window to the head — the newest exchange must be visible on open
- ❌ Don't implement notices/confirm rows/input/routing — S2/S3/S4 own them; leave documented seams only
- ❌ Don't add ANSI styling here — plain strings keep the tests byte-exact; theming belongs to the panel seam

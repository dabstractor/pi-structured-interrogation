# Research notes — P1.M2.T7.S1 (delete discuss end-to-end)

Verified against the working tree on research day. Baseline: `npm test` → 52 files / 1524 tests green.

## 1. What already died (earlier tasks — do NOT re-do)

- P1.M1.T1.S1/S2 renamed `keys.discuss` → `keys.chat` everywhere + added the `coerceKeys` alias.
- P1.M2.T4.S1 landed `routed.onChat` (panel.ts ~:1014-1033): open-or-replace path, **no suspend, no editor preload**. It REMOVED the panel.ts `import … from "./discuss.js"` and the `discussInChat` host call. `grep discussInChat src/panel/panel.ts` → 0 hits. The inventory's "panel.ts:74 import / :652-661 host refinement" is ALREADY DONE.
- keys.test.ts / config-surface.test.ts / keymap-guard.test.ts / ac-panel.test.ts / tree-nav-repro.test.ts / ac-scripted.test.ts / layout.ts / layout.test.ts: **zero** `discuss` hits remain (swept by M1.T1).

## 2. The deletion proper

- `src/panel/discuss.ts` (117 lines): `buildDiscussTemplate`, `discussFooter`, `discussInChat`. Nothing outside `discuss.test.ts` imports it anymore.
- `src/panel/discuss.test.ts` (**611 lines** now, not 583 — T4.S1 rewrote the middle suite). 17 tests in 4 describes:
  - `buildDiscussTemplate` exact-contract suite (:183-255, 6 tests) — DIES.
  - `discussInChat` suspend+preload suite (:255-311, 4 tests) — DIES.
  - "chat key wiring — keys.ts router → the chat view" (:311-448, 2 tests: opens-from-short-view-never-suspends, opens-from-every-view) — DIES. `e`-dispatch-per-view coverage survives in **keys.test.ts:397** (`e dispatches in ${view}` loop over short/deep/overview) — verified present.
  - "discuss gesture — R4/BUG-002 draft write-through (real panel)" (:473-611, 5 tests): 4 die with the gesture; the last one, `test_chord_chat_key_mid_write_opens_chat_without_touching_the_draft` (:575-611), is ALREADY side-chat-era and is the MODEL for the successor pin (chord `\u001b[101;6u` mid-write → view "chat", focus "chat", no done(null), no setEditorText, buffer intact, no draft write-through). No equivalent coverage exists in any other file — the successor pin must subsume it.

## 3. Residual sweep — exact current anchors (grep -rin discuss src/)

Line numbers verified research-day; P1.M2.T6.S1 (parallel) adds wiring after `routed.onChat` (~panel.ts:1033) so **panel.ts lines WILL drift — anchor by quoted text**.

| # | File:line | Anchor text | Action |
|---|---|---|---|
| 1 | panel.ts :326-331 | setEditorText JSDoc: "Editor preload (h2.35 legacy discuss handoff) … (discuss.ts; its panel wiring was removed by P1.M2.T4.S1 — the file itself dies in P1.M2.T7.S1)" | REWORD — editor-preservation.ts is the writer now |
| 2 | panel.ts :536-541 | `pi?:` arg JSDoc: "so the host can refine the discuss seam at the router-construction site" | REWORD (arg STAYS — openPanel :2491 passes it; note: panel no longer consumes args.pi after T4.S1) |
| 3 | panel.ts :1019-1020 | routed.onChat comment: "(AC-17.1; the old discuss handoff call is gone — deleting the engine itself is P1.M2.T7.S1)" | REWORD — drop the historical parenthetical |
| 4 | panel.ts :1354-1356 | writeThroughCurrentDraft JSDoc: "Reuse contract: S2 (discuss) and S3 (note-mode swap) call this before their own exits." | REWORD — drop S2 (discuss); keep note-mode/suspend callers |
| 5 | keys.ts :138-140 | RoutedActions JSDoc: "onChat routes to discussInChat until the SIDECHAT view lands — P1.M2.T4.S1)" | REWORD |
| 6 | keys.ts :163-167 | onChat field JSDoc: "still routes to discussInChat until SIDECHAT's own action lands (P1.M2.T4.S1); default no-op" | REWORD |
| 7 | keys.ts :408-413 | default onChat no-op body: "SIDECHAT bridge: still routes to discussInChat (./discuss.js) until …" | REWORD |
| 8 | editor-preservation.ts :31-33 | finding #2: "and S2's discuss-in-chat `setEditorText` preload survive resume + subsequent close too" | REWORD (keep the chained-cycles semantics) |
| 9 | editor-preservation.test.ts :142-148 | fake-done comment: "pi's discuss-style post-resolve writes land AFTER the restore" | REWORD — "post-resolve editor writes" |
| 10 | editor-preservation.test.ts :274-290 | test **name** `test_discuss_preload_survives_resume_cycle` + comments "break out to discuss in chat", "S2 discuss.ts discussInChat", "S2's flow survives" | RENAME + REWORD (logic unchanged; it pins post-resolve write ordering, a live invariant) |
| 11 | suspend.ts :21-22 | "and P1.M6.T2.S2 (discuss)." | REWORD — drop the discuss consumer ref |
| 12 | keymap-ac.test.ts :36-38 | "S1's deliberate chord-REMAP fixtures (keys.test.ts / discuss.test.ts / …)" | Remove `discuss.test.ts` from the list |

## 4. Survivors — verify untouched, do NOT break

- `PiUISurface.ui.setEditorText` declaration (panel.ts :332) + `getEditorText` (:341) — consumed by editor-preservation.ts `restoreEditorTextIfEmpty` (:95-110).
- setEditorText test fakes: tree-nav-repro.test.ts:76, ac-scripted.test.ts:977, ac-panel.test.ts:258, editor-preservation.test.ts:179/312/347/387 (none say "discuss" anymore).
- Esc break-out main-conversation flow (FR-14/FR-16).
- config.ts :216-224 `coerceKeys` legacy alias + config.test.ts :257-343 alias suite (P1.M1.T1.S2 deliverable).
- keys.test.ts :397 `e dispatches in ${view}`.

## 5. Leave-list (English prose, NOT feature mentions — inventory ruling)

- compaction.ts:100 "discussed", tool-schema.ts:45 "as discussed" (inventory: leave).
- sidechat-prompt.ts:120 "keep discussing without emitting the block" — agent-facing prompt contract (Mode A, P1.M1.T4.S2); same prose category as the two above. Rewording it would change shipped prompt bytes — LEAVE.

## 6. Successor pin — mechanics verified

- editor-preservation.test.ts has: `makePreservationPi` (fake ctx w/ editor model + setEditorText/getEditorText), `optsFor(state, extra)`, `firstCall(mock)`, `flush()`, `resumeOpenPanel`, `seedState()`. It has NO drafts fixture — port `makeDraftsStore` (discuss.test.ts :443-450: Map-backed getDraft/setDraft/getNote/setNote vi.fns) + `slotFor`/`slotCount` private-peek helpers.
- To make `e` live, openPanel needs explicit `chatRebindDeps` + `sidechatEngine` opts (openPanel :2458-2467: explicit opts win; `resolveSidechatHostSeams` returns undefined for fake surfaces lacking modelRegistry). Double shape from the chord test:
  `chatRebindDeps: { resolveModelSnapshot: () => ({ provider: "test", modelId: "test-model" }), buildSystemPrompt: () => "system prompt", buildBranchSnapshot: () => [] as never }, sidechatEngine: { sendTurn: () => true, abort: () => {} }`.
- `resumeOpenPanel` spreads `lastOpts` (RESOLVED opts — chat deps persist across resume, openPanel :2455-2467).
- Chat-view semantics landed (verified in panel.ts): `handleInput("e")` → `routed.onChat` → view "chat", focus "chat" (setView("chat") seeds chat focus; onChat sets chatReturnView first). `blurChatInput` (:1686) → focus "options", does NOT stage the write-in buffer (mid-write detour is non-destructive while the panel lives — chord test pins buffer intact).
- Draft staging at suspend: `writeThroughCurrentDraft` (panel.ts :1358+) fires only when focus is text/note at suspend time — so the no-double-staging successor stages via re-focus `focusTextField("writein")` then `done(null)`, with the chat detour inserted between typing and suspend.

## 7. Gates

`npm test` (vitest run), `npm run typecheck` (tsc --noEmit — the dangling-import safety net), `npm run lint` (eslint src scripts *.ts), `scripts/verify-keymap-conflicts.sh` (no keymap change → passes unchanged). Baseline 52 files/1524 tests; after: 51 files, 1524 − 17 deleted + 2 new successor = 1509 expected.

# System context — bugfix round 001 (plan/005, bug 001_7ea23709b4e7)

Repo: `/home/dustin/projects/pi-structured-interrogator` at HEAD `e298920`
("restart resurrection fixed; validation round done"). Project: **pi-interrogator**,
a pi extension (`package.json` `"pi": {"extensions": ["./src/index.ts"]}`) that runs
a structured interrogation panel (`src/panel/`) driven by an `interrogate` tool
(`src/tool.ts`), with state reconstruction from session files (`src/reconstruct.ts`).

## Verdict on the PRD

All 8 reported bugs were verified against the code **firsthand** (this session) and
by dedicated research notes (see sibling files). **All 8 are CONFIRMED — none refuted.**

| ID | Severity | One-line defect | Fix seam (primary) |
|----|----------|-----------------|--------------------|
| BUG-001 | Major | Confirm row's advertised enter/esc dead while chat input focused | `panel.ts` handleInput focus gate + blur-on-settle via `settleInvalidatingPort` callback |
| BUG-002 | Minor | Discard hook tests CURRENT status, not transition → answered-question chat killed by unrelated mutations | `panel.ts` `onChanged` hook (~941-975) — transition-aware gating |
| BUG-003 | Minor | Same-value apply (ANSWER-PIN no-op) never discards; confirm row stuck forever | `actions.ts` `applyChatAnswer` (~562-578) — terminal consume |
| BUG-004 | Minor | `e` in overview opens chat on `currentId`, not cursor row | `keys.ts` chat branch (~608-612) + cursor-row accessor |
| BUG-005 | Minor | Replace/reset never aborts replaced record's in-flight stream (orphaned LLM call) | `panel.ts` `onChat` (~1057-1066) + `sendChatInput` /clear branch |
| BUG-006 | Minor | Typed input wiped when `sendTurn` refuses (streaming) | `panel.ts` `sendChatInput` (~1743-1766) — keep text on `false` |
| BUG-007 | Minor | No usage-close notify on replace (`onChat`) or reset (`/clear`,`/new`) | same sites as BUG-005 — fire `formatChatCloseNotice` |
| BUG-008 | Minor | Reconstruction candidate pool holds only the LAST tool result | `reconstruct.ts` `walkBranch` (~282-343) + pool (~449-457) |

## Architecture facts a fixer must know (verified)

- **Panel key routing order** (`panel.ts` `handleInput`, ~1200-1290): ctrl+c →
  confirm-mode modal → gate-warning dismiss → **pendingConfirm branch GATED on
  `this.focus !== "chat"`** (~1222-1245) → text/note enter duties → **chat-focus
  enter → `sendChatInput()`** (~1264-1269) → keys router → editor forwarding
  (`chatField.handleInput`).
- **Esc ladder** (`keys.ts` ~527-541): single esc in editor focus (incl. chat)
  FORWARDS to the editor (`return false` → `chatField`); second esc within
  `escExitWindowMs` (default 500ms, `config.ts:133`) → `escExitEditor` →
  `blurChatInput()` (`keys.ts:329-336`, `panel.ts:1718-1724`). `escapeDescend`
  (~297) holds the chat rungs: streaming → `abortChatStream()` only; idle →
  `exitChatView()`.
- **Chat focus lifecycle**: `setView("chat")` seeds `focusChatInput()`
  (`panel.ts:1551-1554`); nothing blurs on settle. `blurChatInput()` sets
  `focus = "options"` (safe in chat view — the double-esc path already does it).
- **Settle observation seam**: the panel has NO engine subscription; it observes
  settle through `settleInvalidatingPort` (`panel.ts:415-425`) wrapping the model
  port — on stream completion it `setTimeout(fire, 0)` → `currentPanel?.invalidate()`.
  This fire callback is where a blur-on-pendingConfirm hook lands. `onAutoApply`
  (engine dep, `panel.ts:533-537`) routes auto-applies to `currentPanel`.
- **Sidechat store** (`sidechat.ts`, module singleton): `get()`/`openOrReplace()`
  (wholesale replace; **caller owns abort** — JSDoc explicit), `resetChat()`
  (fresh rebuild; caller owns abort), `discard()`, `classifyChatCommand()`,
  `parseAnswerBlock()`, `toApplyDecision()`, `settleApplyDecision()`,
  `clearPendingConfirm()`, `formatChatCloseNotice(usage)`. Record:
  `{questionId, messages, streamState: "idle"|"streaming", abortController,
  modelSnapshot, systemPrompt, branchSnapshot, usage:{input,output,totalCost},
  notices, streamingText, pendingConfirm?, lastRejection?}`.
- **Engine** (`sidechat-engine.ts`): `sendTurn(text)` returns `false` on refusal
  (no record / already streaming — `if (record.streamState !== "idle") return false`);
  fresh `AbortController` EVERY turn (`record.abortController = new AbortController()`,
  ~403). `abort()` signals the LIVE record's controller only (~441-448). `settle()`
  liveness guard `if (getRecord() !== record) return;` (~360,372,385,391) — a
  replaced/discarded record's late completion touches nothing (usage never tallies).
  Usage tally only on completed turns post-guard (~341-349).
- **Discard hook** (`panel.ts` `onChanged`, ~941-975, wired `state.on("changed")`
  at 1087): abort-first → read usage → `discardSidechatRecord()` → close view to
  `chatReturnView` → `sidechatNotify(formatChatCloseNotice(usage))`. Tests the
  question's **CURRENT** status against terminal set (answered|submitted|moot|
  withdrawn|closed) — the BUG-002 defect. `state` "changed" event carries the full
  serialized POST-mutation snapshot (`state.ts:156-158`) — no pre-state, so
  transition detection must be panel-side last-seen-status tracking.
- **`onChat`** (`panel.ts:1057-1066`): binds to `p.currentId`; replaces record
  via `openSidechatRecord` when question differs (no abort, no notify — BUG-005/007);
  sets `chatReturnView = p.view` then `setView("chat")`.
- **`applyChatAnswer`** (`actions.ts:562-578`): re-seeds `panel.currentId`, routes
  `acceptOptionIndex` / `writeInEnter`; JSDoc explicitly delegates discard+notify
  to the changed hook and refuses manual pendingConfirm clearing ("would race a
  same-value no-op") — the BUG-003 defect. Same-value accept is a correct
  ANSWER-PIN-001 no-op (`AcceptOutcome "noop"`, no `applyAnswer`, no `changed`).
- **Overview** (`overview.ts`): `panel.overviewCursor` public (`panel.ts:677`);
  `overviewJump` (~408-418) reads `ordered[panel.overviewCursor]` — the pattern a
  cursor-question accessor mirrors. `stepOverviewCursor` never touches `currentId`.
- **Reconstruction** (`reconstruct.ts`): `walkBranch` (~326-347) reduces tool
  results to ONE last-wins slot (`result.toolState = details.state; // LAST
  occurrence wins (FR-27)` at 342-343); pool pushes that single entry (450-452)
  vs the mirror `for...of` loop (453-457); candidates sorted `b.index - a.index`,
  `tryDeserialize` loop degrades newest→older (463-470); JSDoc at 41-43 promises
  degrade-to-next-older. Getter-throwing state fails `tryDeserialize` (caught;
  `state.ts:493` first read) → `{source:"none"}` at ~489.
- **Confirm row render** (`chat-view.ts`): `confirmRow()` (~352-363) renders
  `apply ★ {preview}? · enter = yes · esc = no` whenever `ChatViewState.pendingConfirm`
  is set — unconditionally of focus (the render half of BUG-001). Streaming footer
  hint reads `abort` while streaming, `exit` when idle.

## Cross-bug interactions (ordering guidance)

1. **BUG-002 before BUG-003's full scenario**: with the transition-aware hook,
   a chat opened on an answered question survives unrelated mutations; BUG-003's
   consume-then-close then owns that record's end of life on no-op apply.
2. **BUG-005 + BUG-007 share sites**: `onChat` replace and `sendChatInput` /clear
   both need abort-before-destroy + usage notice, mirroring the close-path
   ordering (abort FIRST, read usage BEFORE discard, notify once).
3. **BUG-001's blur-on-settle and BUG-006's keep-text-on-refusal interact**: a
   settle that produces pendingConfirm blurs the input; a settle that does NOT
   (rejection/autoApply/no-block) keeps focus so the user can keep typing. Both
   preserve typed text (blur never clears; refusal never clears).
4. **BUG-004 and BUG-005 interact**: fixing overview targeting makes the
   "jump to q4 then `e`" repro in BUG-005 natural — chat replace from overview
   must abort the replaced record. No code dependency, but test both paths.

## Gates (must stay green)

`npm test` (vitest run — 1551/1551 at HEAD per PRD), `npm run typecheck`
(tsc --noEmit), `npm run lint` (eslint), `bash scripts/verify-keymap-conflicts.sh`
(checks DEFAULT_CONFIG.keys against avoided chords + live extension registrations;
adding view branches to existing config-driven keys does NOT trip it).

## Task map

P1.M1 = BUG-001 (confirm-row gestures, incl. streaming-abort half) ·
P1.M2 = BUG-002+003 (answered-question chat lifecycle) ·
P1.M3 = BUG-005+007 (replace/reset abort + usage notices) ·
P1.M4 = BUG-006+004 (input preservation + overview targeting) ·
P1.M5 = BUG-008 (reconstruction pool) ·
P1.M6 = changeset-level docs sync (README + spec align).

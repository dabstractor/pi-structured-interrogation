# SURFACING + REMOTE + LIFECYCLE seams (SURFACE-001/002, remote-bridge parity)

Self-contained map for the delta PRD. All paths relative to repo root `src/`.

## 1. src/index.ts — event wiring

Factory registration ORDER (load order = handler fire order per event):

1. **`createLifecycle(pi, …)` at index.ts:73** — subscribes (inside `createLifecycle`, lifecycle.ts):
   - `tool_execution_start` (lifecycle.ts:193): stashes interrogate args under `toolCallId` in `pendingToolArgs` (correlation for the end event; h2.51).
   - `tool_execution_end` (lifecycle.ts:207): consumes the stash, and for non-error **upsert** args (`isUpsertArgs`, lifecycle.ts:109 — non-empty `questions[]` by PRESENCE routing) marks touched submitted ids `reasked`, sets `submittedRun = true`.
   - `agent_settled` (lifecycle.ts:224): `runClosePass()` — close submitted→closed (except reaskedThisRun), clear per-run flags, then `onAfterClosePass(result)` (completion trigger).
   - `onAfterClosePass` → `createCompletionTrigger` (completion.ts): on `remainingActive` empty → inject completion record, `lifecycle.dismissPanel()` (suspends panel), clear state. `onCompleted: () => remoteBridge.completeAll()` (FR-33).
2. **`createRemoteBridge(pi, { config, lifecycle })` at index.ts:98** — subscribes `@eko24ive/pi-ask:submit` on `pi.events` bus (remote-bridge.ts:284).
3. Round detector, state mirror, compaction guard, debug subcommands.
4. **`createPanelHost(lifecycle, pi)` at index.ts:144**, then **`maybeAutoOpen(pi, config, panelHost, drafts)` at index.ts:152** — registers a 2nd `tool_execution_end` handler (see §2).
5. **`createReconstruction(pi, …)` at index.ts:169** — subscribes `session_start` (origin `"session-start"`) and `session_tree` (origin `"session-tree"`) at reconstruct.ts:496-497; routes to `reconstructFromBranch(ctx, opts, origin)`. `onRestored` (index.ts:173-176): `remoteBridge.emitFlow(state, "ask:resume")` (FR-34).
6. **The factory's own `tool_execution_start`/`tool_execution_end` pair at index.ts:215-230** (3rd end handler, registered LAST — fires AFTER lifecycle's rule-1 flip and AFTER maybeAutoOpen's):
   - `tool_execution_start` (index.ts:216-220): if `toolName === "interrogate"`: `resumeSurface = ctx` (stash for `{reopen:true}`) and `pendingUpsertArgs.set(event.toolCallId, event.args)`.
   - `tool_execution_end` (index.ts:222-230): `const args = pendingUpsertArgs.get(toolCallId); pendingUpsertArgs.delete(...)`; early-return on `isError` or non-array `args.questions` (NOTE: **empty-array reads pass this gate** — a read `{}` has `questions` absent, so it returns; a `{questions: []}` would also be non-upsert but present); then `getState()`; if state exists → `remoteBridge.emitFlow(state, "tool")` (FR-31/D-R6 end-phase emission).
   - `pendingUpsertArgs` mechanics: populated ONLY by the start handler above (interrogate calls), cleared by delete-on-end (one-shot per toolCallId; never flushed on dispose — minor leak on skipped ends). Readers: only the end handler. `resumeSurface` (index.ts:206) is a separate last-writer-wins stash read by `onReopen`.
7. `pi.registerTool(createInterrogateTool(config, { onReopen, onLiveQuestions, onAnswersRecorded }))` (index.ts:231). `onReopen` (index.ts:232): already-open → "already-open"; needs state + `hasResumableQuestions(state)` + `resumeSurface` else "no-state"; else `resumePanel(resumeSurface)` → "reopened". `onAnswersRecorded: () => lifecycle.noteSubmissionDelivered()` (AC-11).
8. Renderers + `registerInterrogateCommand(pi, config, panelHost, { drafts, debug })` (index.ts:283).

`session_shutdown` (index.ts:116): `mirror.flush(); remoteBridge.dispose()`.

## 2. src/panel/panel.ts — maybeAutoOpen (SURFACE-001 bug site)

`export function maybeAutoOpen(pi, config, host, drafts?)` at **panel.ts:1759**. Subscribes `tool_execution_end`; handler body (panel.ts:1767-1787):

```ts
if (event.toolName !== "interrogate" || event.isError) return;
if (host.isOpen()) return;
const state = getState();
if (state === undefined) return;
if (!openPanel(ctx, { config, state, drafts }) && phase === "open") {
  currentPanel?.dispose(); resetHostRecord(); openPanel(ctx, { config, state, drafts });
}
```

**Bug**: the ONLY conditions are toolName+!isError+host-closed+state-exists. ANY successful interrogate call — including pure `{}` reads and reads after completion — pops the panel. No check of upsert-vs-read args, no `completed`, no unanswered-question count. Deps received: `pi` (`Pick<ExtensionAPI,"on">` — the factory ExtensionAPI), `config`, `host` (PanelHost = openness authority), `drafts`. Note the handler has access to `event` only at END (args absent on end events — that's why index.ts stashes start args; maybeAutoOpen does NOT stash today, so it cannot currently distinguish read from upsert without new wiring).

## 3. src/panel/panel.ts — handleUpserted (h2.37 suspended-reopen)

`function handleUpserted(ids: string[])` at **panel.ts:1429** — subscribed to the state's `questions-upserted` event (armed in `openPanel` at panel.ts:1616-1618: off-then-on, single subscription; re-armed in `retargetHostState` panel.ts:1543-1546; unsubscribed in panel disposal panel.ts:1467/1506 and `resetHostRecord`).

- `phase === "open"`: stuck-open phantom → remount via `openPanel(activePi, { ...lastOpts, focusQuestionId: firstActiveUpsertedId(...) })`; else open-but-stale → `currentPanel?.invalidate()` (re-reads state on render).
- `phase === "suspended" && activePi && lastOpts`: **reopen** — `openPanel(activePi, { ...lastOpts, focusQuestionId: firstActiveUpsertedId(lastOpts.state, ids) })` (fresh instance rehydrated from state, focus on first upserted active question).
- No gating on whether the upsert left unanswered questions today — but this path fires only on a genuine `questions-upserted` mutation (not on reads), so it is SURFACE-001-compliant in spirit.

## 4. src/reconstruct.ts — session_start / session_tree

`reconstructFromBranch(ctx, opts, origin)` (reconstruct.ts:329): `resetState()` + `setFallbackActive(false)` (top, h2.43), walk raw branch (`getBranch()`), base selection (last interrogate toolResult `details.state` → newest `interrogation-state` mirror → none), delta replay (value-first, BUG-007), `evaluateDependsOn`.

Branches:
- No state (reconstruct.ts:386-405): teardown; returns `opened:false`. On `session-tree`: suspend open host + `opts.host.dispose()`.
- Non-empty check (reconstruct.ts:432-447): completed/empty state installs but opens nothing (same teardown on tree).
- **Non-TUI** (reconstruct.ts:449-458): `setFallbackActive(true)`; `if (origin === "session-start") opts.onRestored?.(state)` (reconstruct.ts:455, FR-34); returns `opened:false`.
- **`session-tree` SILENT path** (reconstruct.ts:459-466): `opts.host.retargetState(state, ctx); if (opts.host.isOpen()) opts.host.suspend(); return { …, opened:false }` — never openPanel, never onRestored.
- **session-start TUI** (reconstruct.ts:470-479): `opts.onRestored?.(state)` at reconstruct.ts:472 (FR-34, BEFORE openPanel), then **`const opened = openPanel(ctx, { config: opts.config, state, drafts: opts.drafts })` at reconstruct.ts:478** — the SURFACE-002 target. Conditions reaching it: origin `session-start` (default), TUI mode, state found + `orderedQuestions().length > 0`. No unanswered-question filter today.

`hasResumableQuestions` is NOT consulted by reconstruct.ts today (only by suspend-widget visibility, onReopen gate, command toggle).

## 5. src/panel/suspend.ts

- `RESUMABLE_STATUSES = ["open","answered","submitted","reasked"]` (suspend.ts:52-57, single definition, BUG-005).
- `hasResumableQuestions(state)` at **suspend.ts:66**: `orderedQuestions().some(q => RESUMABLE_STATUSES.includes(q.status))` — false for empty (post-`clearForCompletion`) and all-terminal states.
- `buildSuspendWidgetLine(state)` at suspend.ts:117 (helper `countStatuses` at :82): exact format `` `${n} open · ${m} answered — /interrogate to resume` `` — `n` counts status `"open"` only, `m` status `"answered"` only; separators ` · ` (U+00B7) and ` — ` (U+2014); lowercase `/interrogate`; never a key chord.
- `updateSuspendWidget(pi, state)` at suspend.ts:135: `setWidget(WIDGET_KEY, hasResumableQuestions(state) ? [line] : undefined)`; `WIDGET_KEY = "interrogator"` (suspend.ts:38); no-op when surface lacks `setWidget`. Called from openPanel's floating `.then`/`.catch` (single suspend choke point in panel.ts). Widget also explicitly cleared in `resetHostRecord` (panel.ts:1481: `activePi?.ui.setWidget?.(WIDGET_KEY, undefined)`).

## 6. src/remote-submit.ts — recordRemoteSubmission

`export function recordRemoteSubmission(pi, state, answers, deps)` at **remote-submit.ts:90** (deps: `RemoteSubmitDeps { lifecycle?: Pick<Lifecycle,"noteSubmissionDelivered">; isIdle? }`, remote-submit.ts:64). Pipeline in EXACT order:

1. **remote-submit.ts:94-98** — apply each answer: `state.applyAnswer(id, { value: answer.value, at, ...(answer.text !== undefined ? { text: answer.text } : {}) })`. Caller owns D-R4 validation (remote-bridge.ts:371-395 `mapWireAnswers` validates choice `values[0]` against `(q.options ?? []).some(o => o.value === picked)`).
2. **:100-101** — `pre = submissionBaselineOf(state); diff = computeDiff(pre, state.serialize())`.
3. **:104** — `pendingIds` = all status-"answered" ids, read BEFORE the flip (BUG-008).
4. **:107-109** — `userChanged = diff.changed.filter(e => pendingIds.includes(e.id) || !(e.to === "(unanswered)"))` (BUG-008(b)).
5. **:115** — `if (pendingIds.length > 0) markSubmitted(state, pendingIds)` (before zero-change return).
6. **:117-122** — zero shippable → `noteSubmissionDelivered()` if flushed; return `{ok:false, reason:"nothing_shippable"}`.
7. **:125** — `buildSubmission(state, { ...diff, changed: userChanged })` (sole takeSnapshot + bumpEpoch).
8. **:128** — `deliverSubmission(pi, msg, { isIdle })` (one sendMessage).
9. **:131** — `deps.lifecycle?.noteSubmissionDelivered()`; return `{ok:true, msg}` (:133).

**customText TODAY**: bridge `customText` maps in remote-bridge.ts:378-393 — text questions: `value = custom ?? values?.[0]`; choice: `picked = values?.[0]` validated against current option values; customText-only on a choice records `value = custom` (freeform) with **no `text` and no `custom` flag**; customText alongside a valid picked value rides as `answer.text` (remote-submit.ts:97 `text` field). The PRD's `custom:true` on customText-only bridge answers has NO current representation — `RemoteAnswerInput` (remote-submit.ts:55-61) has only `{id, value, text?}`.

**maybeAutoSubmit slot**: after step 9 (`:131`), just before `return { ok:true, msg }` — a tail call would also cover the `nothing_shippable` path only if added before BOTH returns (the nothing_shippable return at :121 already fires noteSubmissionDelivered when flushed). **Deps awareness**: the function has NO panel/host import and no UI — pure-data discipline (module doc, remote-submit.ts:33-34: "no UI, no panel imports, no events"). A maybeAutoSubmit at the tail needs a new dep (e.g. a host/panel handle or callback injected via `RemoteSubmitDeps`) — remote-bridge.ts:334 passes `{ lifecycle: opts.lifecycle }` today and its own `RemoteBridgeOptions` (remote-bridge.ts:264) carries only `config`, `lifecycle`, `getState`.

## 7. src/remote-bridge.ts — @eko24ive/pi-ask:submit handler

- Subscription: remote-bridge.ts:284 `events.on(PI_ASK_SUBMIT, raw => { try { handleSubmit(raw) } catch {} })` — only when `config.remote.enabled`.
- `handleSubmit` (remote-bridge.ts:313): malformed (`version!==1`/missing ids) → silent; **foreign flowId** (not `itg:`-prefixed) → silent ignore (pi-ask's business); `itg:` unknown/stale → `flow_not_found` NACK via `emitSubmitResult` (:297-307); `kind:"cancel"` → ACK + `completeFlow` (zero state change); `kind:"answer"` → `getState()` → `mapWireAnswers(state, response.answers)` (D-R4, :371-395; `parseWireAnswer` :177-183 keeps `values`+`customText`, drops `note`/`optionNotes`) → zero recordable → `invalid_answer` NACK + `emitFlow(state,"ask:replay")`; else `recordRemoteSubmission(pi, state, answers.applied, { lifecycle })` (:334) → `emitSubmitResult(ok)` → `completeFlow` → if `config.remote.resurface && liveQuestions>0` → `emitFlow(state,"ask:replay")` (:338-341).
- Flow emission sites: `emitFlow` (remote-bridge.ts:401-416) emits `:started`, completing prior flows first (D-R6). Emitted with source `"tool"` from index.ts's end-phase handler (index.ts:230), `"ask:resume"` from reconstruction `onRestored` (index.ts:176, session-start only), `"ask:replay"` from the submit paths. **The deferred tool_execution_end emission is index.ts:222-230** (deferred to END so lifecycle's rule-1 reasked flip — lifecycle.ts:207, registered earlier — lands first; args from the `pendingUpsertArgs` start-phase stash).
- `dispose()` (:425): unsub submit + complete all flows.

## 8. src/lifecycle.ts — auto-close / reopen

- Algorithm (module JSDoc h2.44, lifecycle.ts:10-28): delivery → `noteSubmissionDelivered()` sets `submittedRun=false`, clears `reaskedThisRun` (lifecycle.ts:239-242); end-of-upsert → rule-1 reasked flip (lifecycle.ts:207-220); `agent_settled` → `runClosePass` (lifecycle.ts:224, body :229-263): submitted-not-reasked → `closeSubmitted`, report `{closed, reasked, remainingActive}`, clear flags ALWAYS, then `onAfterClosePass(result)`.
- Completion flow (completion.ts via `onAfterClosePass`): `remainingActive` empty → inject one `interrogation-completion` record + `dismissPanel()` (→ host `suspendCurrent()`, panel.ts:1442: phase suspended, `done(null)`, suspend widget updated) + clear in-memory state; `onCompleted` → `remoteBridge.completeAll()` (FR-33). Batch notes drained into the record (NEW-004).
- Reopen handling: not in lifecycle — lives in index.ts `onReopen` (index.ts:232-246) → `resumePanel(resumeSurface)` → `resumeOpenPanel` (panel.ts:1728-1747: RESUME-001 focus ladder — first unanswered → lastFocusId if active → first active) → `openPanel` no-op-while-open / remount-while-stuck.
- `dispose()` (lifecycle.ts:268): run unsubscribers, clear flags/args.

## 9. src/tree-nav-repro.test.ts — every test

Harness: direct real-module simulation — `FakeTuiSurface` (replicates pi's `showExtensionCustom` savedText capture/restore), `FakeLifecycle`, real `createPanelHost`/`openPanel`/`maybeAutoOpen`; `pi` is a stub whose `on` stores handlers in a Map so tests fire `tool_execution_end` manually. NOT a full factory run.

| Test (line) | Behavior | Panel state asserted |
|---|---|---|
| `panel SUSPENDED at nav time…` (:86) | open → esc suspend → simulated tree nav (`retargetState` + suspend-if-open) → TUI text restore | `customCalls.length === 1` (NO new panel); editorText `"old prompt"` — **stays green** |
| `panel OPEN at nav time (tree keybinding)…` (:119) | open at nav → retarget+suspend → text restore | `customCalls.length === 1` (closed, not re-opened); editorText `"old prompt"` — **stays green** |
| `post-nav agent READ (interrogate {}): maybeAutoOpen POPS the panel (BUG — characterization)` (:143) | fires maybeAutoOpen's `tool_execution_end({toolName:"interrogate", isError:false})` after nav | `customCalls.length === 1` — **BUG characterization #1, must FLIP** to `0` |
| `post-nav agent READ after completion… POPS (BUG)` (:183) | state `clearForCompletion()`d but singleton installed; read end event | `customCalls.length === 1` — **BUG characterization #2, must FLIP** to `0` (comment at :206-208 names the bug: "checks only `state !== undefined`") |

## 10. Test files asserting opened:true / AC structure

**src/reconstruct.test.ts** — assertion shape is always `expect(result.opened).toBe(true)` on the `ReconstructResult` returned by `reconstructFromBranch(ctx, makeOpts(host, drafts))` (TUI ctx, non-empty state), usually paired with `expect(ctx.ui.custom).toHaveBeenCalledTimes(1)`:
- :178 `tool-result base beats everything; deltas after it replay (a)` → `result.opened === true` at **:204** + `ctx.ui.custom` called once (:205).
- :242 `no tool result → newest mirror entry wins (c)` → `result.opened === true` at **:260** (`// TUI + non-empty`).
- :354 `suspended host reopens through openPanel with the FRESH state (f — session-start origin)` → `result.opened === true` at **:370** + `ctx.ui.custom` once (:371).
Other rows already assert `opened:false` (non-TUI :348, tree-nav silent :394/:444/:473/:502, completed :502, empty :286).

**src/panel/ac-panel.test.ts** — `describe("AC-9 — reconstruction auto-opens the panel (FR-28)")` (:758):
- :846 `AC-9a_tool_result_base_plus_deltas_auto_opens_non_blocking` → `expect(result.opened).toBe(true)` at **:866** (`// FR-28 auto-open (TUI, non-empty)`).
- :881 `AC-9b_mirror_entry_fallback_auto_opens` → `result.opened === true` (~:899 area).
- :899 `AC-9c_session_start_event_path_invokes_the_reconstruction` → fires mock `session_start`; asserts custom was called (same opened path).
- :967 `AC-10_compact_preserves_plan_statements_and_read_is_full` → `expect(read.opened).toBe(true)` at **:1062** (`// FR-28 auto-open after the compact too`) — this row reconstructs from a read-after-compact branch.

**src/ac-scripted.test.ts** — structure: per-AC `describe("AC-n — <title> (FR-x)")` blocks; test names `AC-n_snake_case_scenario`; a header table (lines 18-24) maps AC → FR → test name → status. New SURFACE ACs should follow this (`AC-n_snake…` + FR citation in describe title + header-table row).

## 11. State singleton / lifecycle state

- `src/state.ts:564/573/581`: `getState()`/`setState()`/`resetState()` over a module-level singleton (`let stateSingleton`). Created by the first interrogate upsert (tool.ts); `resetState()` at the top of EVERY reconstruction run (reconstruct.ts:333, h2.43) and after session_shutdown — no caching across sessions.
- Second interrogation: `clearForCompletion()` empties questions but the singleton REMAINS installed (completed flag set) — the tree-nav-repro BUG #2 lever; completion flow clears in-memory state via the trigger.
- Lifecycle per-run state (`reaskedThisRun`, `submittedRun`, `pendingToolArgs`) lives in `createLifecycle`'s closure (lifecycle.ts:176-180), cleared on every close-pass exit and `noteSubmissionDelivered`.
- Tree-nav retargeting: reconstruct.ts:459-466 → `host.retargetState(state, ctx)` (panel.ts:1536-1555: swap `lastOpts.state`, re-arm the single `questions-upserted` subscription, refresh `activePi`) + suspend-if-open. The state singleton itself is re-`setState`d by reconstruction before that.

## Test-flip ledger (before → after)

| Test | File:line | Before | After |
|---|---|---|---|
| `post-nav agent READ (interrogate {}): maybeAutoOpen POPS the panel (BUG — characterization)` | src/tree-nav-repro.test.ts:143 (assertion :199 `expect(surface.customCalls.length).toBe(1)`) | read pops panel (`1`) | rename to no-open characterization; assert `.toBe(0)` — reads NEVER surface (SURFACE-001) |
| `post-nav agent READ after completion: state still installed → panel POPS (BUG)` | src/tree-nav-repro.test.ts:183 (assertion :208 `.toBe(1)`) | read over completed state pops panel | assert `.toBe(0)`; keep the completed-singleton setup |
| `panel SUSPENDED at nav time…` / `panel OPEN at nav time…` | src/tree-nav-repro.test.ts:86 / :119 | `customCalls.length === 1` (no new panel) | UNCHANGED — stay green |
| `tool-result base beats everything; deltas after it replay (a)` | src/reconstruct.test.ts:178, assert :204 | `result.opened).toBe(true)` + `ui.custom` once | SURFACE-002: session_start NEVER auto-opens → flip to `opened:false` (+ widget-line assertion if per PRD) |
| `no tool result → newest mirror entry wins (c)` | src/reconstruct.test.ts:242, assert :260 | `toBe(true)` | flip to `toBe(false)`; state still installed (`getState()` assertions unchanged) |
| `suspended host reopens through openPanel with the FRESH state (f — session-start origin)` | src/reconstruct.test.ts:354, assert :370 | `toBe(true)` + custom once | flip to `toBe(false)`; host retarget/still-suspended assertions replace the open ones |
| `AC-9a_tool_result_base_plus_deltas_auto_opens_non_blocking` | src/panel/ac-panel.test.ts:846, assert :866 | `result.opened).toBe(true)` | flip to `false` (suspend-widget-only per SURFACE-002); likely retitle AC-9 |
| `AC-9b_mirror_entry_fallback_auto_opens` | src/panel/ac-panel.test.ts:881 | `opened true` | flip to `false` |
| `AC-9c_session_start_event_path_invokes_the_reconstruction` | src/panel/ac-panel.test.ts:899 | custom called on session_start | flip: no `ui.custom` call; widget-line/resume-only |
| `AC-10_compact_preserves_plan_statements_and_read_is_full` | src/panel/ac-panel.test.ts:967, assert :1062 | `read.opened).toBe(true)` | flip to `false` |
| `subscribes BOTH session_start and session_tree; start opens, tree is silent` (:523) + `session_tree on a state-carrying branch installs state WITHOUT opening` (:547) | src/reconstruct.test.ts:523/547 | start path asserts open (via custom/host phase) | start side flips to no-open (tree side already silent) |

Also affected (behavioral, not flips): index.ts:222-230 bridge emission currently fires on any successful call incl. reads (`Array.isArray(args.questions)` gate passes `{questions: []}`; absent-questions reads already return) — remote parity review point. New tests needed for: maybeAutoSubmit at remote-submit.ts tail (deps injection), customText-only `custom:true` (RemoteAnswerInput + applyAnswer path), suspend-widget-only reconstruction (SURFACE-002).

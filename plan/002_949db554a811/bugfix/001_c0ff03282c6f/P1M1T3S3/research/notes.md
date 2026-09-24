# P1.M1.T3.S3 research — end-to-end AC-13 acceptance test

## Findings

### Root cause recap (bug-003-snapshots-changed.md / PRD h3.2)
- `computeDiff` sets `editedArchived = before?.status === "closed"` (src/snapshots.ts:209).
- Production baseline = last ring snapshot (`submissionBaselineOf`); snapshots historically only at submit-time sites (delivery.ts:185, fallback.ts:261) AFTER markSubmitted → never 'closed'.
- S2 (parallel, contract) fixes it: `runClosePass` in src/lifecycle.ts appends `takeSnapshot(state)` after `closeSubmitted` when `toClose.length > 0` — same-epoch, statuses 'closed'.

### Existing AC-13 test bypasses the pipeline (src/ac-scripted.test.ts:554-635)
- Uses `makePiHarness()` + `wireLifecycle(h)` + `registerDebugBridge(h, lifecycle)`; upsert via `executeInterrogate(..., tuiCtx(), DEFAULT_CONFIG)`; submit via `await h.invoke("interrogate-debug-submit", "q1=sqlite")`; close via `h.emit("agent_settled")` (REAL close pass — good).
- BUT the archived-edit diff is computed by hand: `const pre = state.serialize()` at the closed moment + `computeDiff(pre, ...)` + direct `buildSubmission`/`buildSubmissionCard` calls — the submission ring baseline is bypassed. KEEP as unit test (contract: do not delete).

### Panel harness (src/panel/actions.test.ts) — the real submit path
- `seed(specs)` builds state; `makePanel(state, extra?, config?)` → `new InterrogationPanel({tui:{requestRender}, theme: stubTheme, done, state, config, ...})`; `makeDeps(isIdle=true)` → `{deps: {sendMessage: vi.fn(), isIdle: () => true}, sendMessage}`.
- `submit(panel, deps)` (actions.ts:450) is the production submit → buildSubmission → sendMessage → takeSnapshot.
- `maybeAutoSubmit(panel, deps?)` (actions.ts:607) fires auto-submit on completeness; needs isIdle true.
- Write-in edit gesture (actions.test.ts ~760-820, 1476): `panel.currentId = "q1"; panel.cursorIndex = <past options = ✎ Other row>; accept(panel)` → `panel.focus === "text"`, `panel.textDuty === "writein"`; `panel.textField.setText("...")`; `panel.handleInput("\r")` → write-in enter COMMITS (+ maybeAutoSubmit tail).
- Actions tests operate on a locally seeded state; ac-scripted operates on the module SINGLETON (`getState()`). For the E2E test the panel must be constructed on `getState()!` so lifecycle/close pass and panel share one state.

### Lifecycle real close pass
- `createLifecycle(pi, {onAfterClosePass})` (lifecycle.ts:156); `agent_settled` event → `runClosePass()` (:212). `h.emit("agent_settled")` from makePiHarness drives the REAL close pass (no setStatus).
- Completion avoidance: keep one never-answered question (existing AC-13 test keeps q2 open) so the close pass does NOT trigger completion (which would clear questions).

### Assertions targets
- `sendMessage.mock.calls[1][0]` = second submission message: `.details.changed[0].editedArchived === true`, `.content` contains ` (changed)` (delivery.ts:147).
- Card: `buildSubmissionCard(msg, {expanded:false, outputPad:0}, stubTheme)` → lines include ` (changed)` (renderers.ts:177 CHANGED_MARKER).
- Ring invariant: after settle, `state.snapshots.at(-1)` has epoch === submit epoch (not bumped) and q1 status 'closed'.

### Decision on actions.test.ts:701 manufactured-baseline test
- That test (`bug008_edited_archived_entry_still_ships_ac13`) uses `state.setStatus("q1","closed")` to manufacture the baseline; it guards the BUG-008 filter interaction, a DIFFERENT concern. Contract allows convert-or-retain. Recommendation: RETAIN with a comment (documents the manufactured baseline; the real path is now covered by the new E2E test).

### Conventions
- vitest, colocated tests, `beforeEach(() => resetState())` (singleton hygiene — ac-scripted.test.ts:225), AUTOMATION-POLICY: no live TUI, no real pi process.
- ac-scripted.test.ts is shared across parallel suites — additive-only (header comment says sibling suites never edit it); the new test extends the existing AC-13 describe or adds a new describe — do not modify existing tests.

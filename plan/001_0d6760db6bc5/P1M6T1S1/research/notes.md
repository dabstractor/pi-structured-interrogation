# P1.M6.T1.S1 research notes — Suspend (done(null)) + widget + resume rehydration

## Verified pi API facts (architecture/pi-api-validation.md)
- `ctx.ui.setWidget(key, content: string[] | ((tui,theme)=>Component) | undefined, options?: {placement?})` — keyed; multiple widgets coexist; **`undefined` clears** (§pi-api-validation.md:41). Keyed `"interrogator"` (PRD h2.3).
- `custom()` done(null) resolves the promise; pi restores the editor region automatically. Main-editor text persistence across custom() sessions was flagged "verify in test" — that verification belongs to **P1.M6.T2.S3**, not this item.
- `custom()` returns a promise in TUI mode; openPanel already orphans it fire-and-forget with `.then/.catch` landing in `markSuspended()`.

## Existing code seams (verified by reading src/)
### src/panel/panel.ts (host, module-scoped)
- HostPhase `"closed"|"open"|"suspended"`; module state: `phase`, `currentPanel`, `activePi`, `lastOpts`, `upsertState`.
- `suspendCurrent()` (~:970): phase→suspended, dispose+done(null). Called by lifecycle dismiss callback (createPanelHost) and `host.suspend()`.
- `markSuspended()` (~:944): open→suspended edge, clears currentPanel.
- `openPanel(pi, opts)` (~:1036): mode guard `mode === "tui"`, single-instance guard (returns false when open), subscribes questions-upserted, fire-and-forget custom(), `.then(() => { currentPanel?.dispose(); markSuspended(); })`.
- `handleUpserted(ids)` (~:952): suspended + upsert → reopen fresh instance with `focusQuestionId: firstActiveUpsertedId(...)`.
- `maybeAutoOpen(pi, config, host, drafts)` (~:1120): tool_execution_end (interrogate, !isError) → openPanel(ctx, {config, state, drafts}) — this is ALREADY the resume path used by /interrogate reopen (no focus restore today).
- `PiUISurface` interface (~:154): narrow pick `ui.custom`, `ui.getEditorComponent?`, `mode`. **No setWidget yet — must add optional `setWidget?(key, content, options?)`.**
- Panel fields: `currentId` (getter/setter, re-seeds cursorIndex to ★ preselect), `deepSticky` (per session), `overviewCursor`, `batchNote`, private `draftSlots`.

### src/panel/keys.ts
- esc-descent ladder `escapeDescend` (:216): note → deep → overview → **`panel.suspend()` at top level (FR-16 already wired)**. `onBreakOut` → `p.suspend()`. So ALL suspend entries (esc, ctrl+shift+q inside panel, lifecycle dismiss) funnel through `panel.suspend()` → `done(null)` → openPanel's `.then` → `markSuspended()`. **Widget set belongs in that .then — single choke point.**

### src/config.ts
- `KeyAction` includes `breakOut`; default `"ctrl+shift+q"`; `resolveKeyLabels(config): Record<KeyAction,string>` (:360) → e.g. `"Ctrl+Shift+Q"` (pretty display form).

### src/state.ts / src/results.ts
- Statuses: open/answered/submitted/reasked/moot/withdrawn/closed. `state.order`, `orderedQuestions()`, `serialize()`. Counting convention precedent in results.ts statusLine (:88-98): `answered` counts status === "answered" ONLY; open = status === "open".

### src/draft-store.ts
- Class instance held outside panel; `lastOpts` spread in handleUpserted/maybeAutoOpen reuses the SAME store → drafts survive suspend/resume already (R4). Nothing to add.

### Parallel-item contract (P1.M5.T4.S1, ripple confirm)
- Adds `confirmMode` modal interception at top of `handleInput` and `src/panel/ripple-confirm.ts`. Independent of suspend paths; no conflicts. Do not touch ripple seams.

## Widget line spec (h2.3 / h2.35 — EXACT)
`{n} open · {m} answered — {breakOut key} to resume /interrogate`
- n = count status === "open" over orderedQuestions(); m = count status === "answered".
- breakOut key = `resolveKeyLabels(config).breakOut` (display form).
- Visibility rule: widget set ONLY when suspended AND n > 0; otherwise `setWidget("interrogator", undefined)` (covers completion → 0 open → cleared; full close → cleared).

## Focus restore on resume
- Capture `currentPanel.currentId` at suspend time (in the `.then` before markSuspended clears the reference — belt-and-braces: also capture in suspendCurrent). Store module-scoped `lastFocusId`.
- resume path = openPanel with `focusQuestionId: lastFocusId` (fall back to first active question — firstActiveUpsertedId pattern). Upsert-driven reopen keeps its own focus (first upserted active) per h2.37 — only explicit resume uses lastFocusId.

## Consumers (boundaries)
- /interrogate command + global ctrl+shift+q shortcut = P1.M6.T1.S2 (NOT this item). This item exports the suspend/resume functions they call.
- reopen:true agent action = P1.M6.T2.S1 (calls resumePanel). discuss = M6.T2.S2 (suspend + setEditorText — builds on suspendPanel).

## Test patterns
- panel.test.ts / actions.test.ts: fake PiUISurface objects, createInterrogationState + raw upsert fixtures, createPanelHost re-arm per scenario. Extend fakes with a `setWidget` recorder.

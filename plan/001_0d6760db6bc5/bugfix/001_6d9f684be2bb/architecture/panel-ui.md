# Panel UI Architecture — Bug-Fix Research Findings

Repo: /home/dustin/projects/pi-structured-interrogation. All line numbers verified by direct read.

## Files in scope (complete src/panel/ listing)

`ac-panel.test.ts, actions.test.ts, actions.ts, caps.test.ts (in src/, not panel), deep-view.test.ts, deep-view.ts, discuss.test.ts, discuss.ts, editor-preservation.test.ts, editor-preservation.ts, gate.test.ts, gate.ts, keys.test.ts, keys.ts, layout.test.ts, layout.ts, overview.test.ts, overview.ts, panel.test.ts, panel.ts, ripple-confirm.test.ts, ripple-confirm.ts, short-view.test.ts, short-view.ts, suspend.test.ts, suspend.ts, terminal-budget.test.ts, terminal-budget.ts, text-field.test.ts, text-field.ts, two-stage.test.ts`
Plus (src/): `command.ts` (145 ln), `index.ts` (~215 ln), `draft-store.ts` (148 ln), `renderers.ts` (487 ln).

## Files Retrieved
1. `src/command.ts` (lines 60–145) — `interrogateToggleAction` + `registerInterrogateCommand`
2. `src/index.ts` (lines 130–215) — factory wiring, `onReopen` hook, `registerInterrogateCommand`
3. `src/panel/suspend.ts` (1–121, whole file) — widget line + updateSuspendWidget + resumePanel façade
4. `src/panel/actions.ts` (1–382, whole file) — named actions incl. `submit` (lines 309–382)
5. `src/panel/keys.ts` (1–406, whole file) — router; focusText dispatch at 354–356
6. `src/panel/panel.ts` (1–1386, whole file) — InterrogationPanel class + host record
7. `src/draft-store.ts` (1–148, whole file)
8. `src/snapshots.ts` (lines 140–210) — `computeEntries` / `computeDiff` signature semantics
9. `src/merge.ts` (lines 150–200) — rule 2 answer reset → status "reasked", `answer: undefined`
10. `src/delivery.ts` (grep: lines 117–167) — `buildSubmission` does `takeSnapshot` then `bumpEpoch`
11. `src/renderers.ts` (1–40) — card renderers; user-only display
12. `src/panel/panel.test.ts` (1–60) — representative host-faking test setup

---

## BUG-005 — CONFIRMED (empty-state when open==0 even with pending answered questions)

- `src/command.ts:81` — inside `interrogateToggleAction`, suspended branch:
  ```ts
  const open = state?.orderedQuestions().filter((q) => q.status === "open").length ?? 0;
  if (open === 0) return "empty";
  ```
  (return `"empty"` is line 82). Counts **only** `status === "open"`; `answered` (pending submission), `submitted`, `reasked` are excluded, so a fully-answered-but-unsubmitted interrogation suspended → returns "empty" → caller notifies `EMPTY_STATE_MESSAGE` ("No active interrogation…") at command.ts:144/161.
- `src/index.ts:169–177` — `onReopen` tool hook:
  ```ts
  onReopen: () => {
    if (panelHost.isOpen()) return "already-open";
    if (panelHost.isSuspended()) {
      const open = getState()?.orderedQuestions().filter((q) => q.status === "open").length ?? 0;
      if (open === 0 || resumeSurface === undefined) return "no-state";   // line 173
      resumePanel(resumeSurface);
      return "reopened";
    }
    return "no-state";
  ```
- `src/panel/suspend.ts:103–105` — `updateSuspendWidget`:
  ```ts
  const { open } = countStatuses(state.orderedQuestions());
  const line = buildSuspendWidgetLine(state, resolveKeyLabels(config));
  setWidget.call(pi.ui, WIDGET_KEY, open > 0 ? [line] : undefined);   // line 105
  ```
  `countStatuses` (lines 42–54): `open` counts only "open"; `answered` counts only "answered" (but answered is never used for the visibility rule). Widget cleared when open==0.

### Open-question counting functions (two clones, same semantics)
- command.ts:81 and index.ts:172: `orderedQuestions().filter((q) => q.status === "open").length`
- suspend.ts `countStatuses` (line 42) — same "open"-only bucket.
Note panel.ts:172 `ACTIVE_STATUSES = ["open", "answered", "submitted", "reasked"]` (used for resume focus + firstActiveUpsertedId) — a broader notion exists but is not used by the empty-state gates.

### Question statuses (`src/state.ts:22–29`)
`QuestionStatus = "open" | "answered" | "submitted" | "reasked" | "moot" | "withdrawn" | "closed"` (7 total; task listed 6 — "closed" also exists).

### Suspend/resume end-to-end
1. User esc (short view) / ctrl+shift+q → keys.ts `escapeDescend` (line ~240) → `panel.suspend()` → `done(null)` (panel.ts:656–661, guarded by `resolved`).
2. `openPanel`'s floating `.then` (panel.ts:1300–1320): capture `lastFocusId`, dispose panel, `markSuspended()` (phase open→suspended, `currentPanel = undefined`), then `updateSuspendWidget(activePi, ...)` → widget line shown iff open>0.
3. Re-attach: three paths —
   - state `questions-upserted` while suspended → `handleUpserted` (panel.ts:1095–1108) → `openPanel(activePi, {...lastOpts, focusQuestionId: firstActiveUpsertedId(...)})` — **no open-count guard** (reopen on any upsert).
   - `resumeOpenPanel(pi)` (panel.ts:1338–1354) via suspend.ts `resumePanel` — restores `lastFocusId` if still ACTIVE_STATUSES, else first active question. Called from command.ts:83 (toggle) and index.ts:174 (onReopen).
   - `maybeAutoOpen` tool_execution_end (panel.ts:1365–1380) — opens when `!host.isOpen()` and state exists (no open-count guard either).
4. `interrogateToggleAction` per host state (command.ts:63–86): isOpen → suspendPanel → "suspended"; isSuspended ∧ open>0 → resumePanel → "resumed"; isSuspended ∧ open==0 → "empty"; closed → "empty".
5. `resetHostRecord` (panel.ts:1126–1138) — full close clears the widget, phase="closed".

---

## BUG-008 — CONFIRMED (reasked id in diff.changed → draft destroyed / delta misreports)

- `src/panel/actions.ts:355`: `panel.drafts?.shipDrafts?.(diff.changed.map((c) => c.id));`
- Baseline: `submissionBaseline(panel)` (actions.ts:141–149) = latest snapshot's `.state` (or empty pre-snapshot baseline). `computeDiff(pre, panel.state.serialize())` (actions.ts:312).
- `computeEntries` (snapshots.ts:148–167): entry exists iff `answerSignature(before) !== answerSignature(after)` where signature (line 84) = `answer.value` (+NUL+text) or `undefined` when no answer. **Answer reset to undefined vs a previously answered snapshot → signature "x" vs undefined → id appears in `changed` with `from: <old answer summary>, to: "(unanswered)"`.**
- Merge rule 2 (merge.ts:181–193): changed options on an existing id → `status = "reasked"`, `answer = undefined` (answerReset: true). merge.ts never touches drafts (draft-store.ts survival matrix: "merge.ts:17-19 never touches drafts and neither do we").
- Consequence chain at submit (actions.ts:309–377):
  1. zero-pending check on `diff.changed.length` — a reasked reset alone is non-empty, so submit proceeds.
  2. `pendingIds` = status "answered" only (line 343) → `markSubmitted(state, pendingIds)` — a reasked question is NOT marked submitted.
  3. `buildSubmission(panel.state, diff, note)` (delivery.ts:129; internally `takeSnapshot(state)` then `state.bumpEpoch()` — exactly once, delivery.ts:166–167). buildSubmission receives the diff computed pre-markSubmitted; per snapshots docs "The diff above is status-blind (answer signatures only)". So the shipped delta describes the reasked id as `from: "old answer" → to: "(unanswered)"` — misreporting an agent-initiated reset as a user change.
  4. `panel.drafts?.shipDrafts?.(diff.changed.map(c => c.id))` (line 355) — removes any surviving text draft slot for the reasked id even though nothing user-authored shipped for it. DraftStore.shipDrafts (draft-store.ts:134–148) deletes + returns the slots for the given ids.
- DraftStore API (draft-store.ts): `getDraft(id)` / `setDraft(id, text)` / `getNote/setNote` (seam); extended: `setDraftEntry(id, {value, text})`, `hasDraft(id)` (non-empty text only), `clearDraft(id, {explicit:true})` (no-op otherwise), `clearAll({explicit:true})`, `shipDrafts(ids?)`. Panel-side seam interface: panel.ts:113–126 (`DraftStore` with optional extended members).
- Draft preservation across upserts: the store is extension-closure-scoped (index.ts:100–103 `const drafts = new DraftStore()`), subscribes to nothing, merge.ts never touches it; `lastOpts.drafts` is reused on every reopen (openPanel/handleUpserted/resumeOpenPanel all spread `lastOpts`).

---

## BUG-011 — CONFIRMED (focusText has no view guard; TextField only rendered in short view/note mode)

- `src/panel/keys.ts:354–356`:
  ```ts
  if (matchesKey(data, b.focusText)) {
    actions.onFocusText(panel);
    return true;
  }
  ```
  No `panel.view` check — fires in deep and overview too (unlike externalEditor at 366 which gates on `panel.focus === "text"`, and digits at ~385 gating on view/focus).
- Default seam `onFocusText` (keys.ts:260–262) sets `p.focus = "text"`; panel.ts constructor refines it (line ~507): `routed.onFocusText = (p) => p.focusTextField();` — `focusTextField` (panel.ts:800–815) sets `focus = "text"`, focuses + seeds the embedded editor, invalidates.
- `buildLines` (panel.ts:1045–1145): branch order note → short → deep → overview (overview is the exhaustive tail).
  - note mode (1049–1061): renders `renderNoteHeader` + `textField.render(width)` — TextField shown.
  - short view (1062–1101): `if (this.focus === "text" || current.type === "text") lines.push(...this.textField.render(width));` (line ~1093) — TextField shown.
  - deep view (1102–1122): header + `renderDeepWindow(...)` + notice + footer — **no TextField render**.
  - overview (1123–1144): header + overview window + notice + footer — **no TextField render**.
  So ctrl+t in deep/overview sets text focus with no visible editor; typing forwards to `this.textField.handleInput(data)` (panel.ts handleInput tail, ~line 640: `if (this.focus === "text" || this.focus === "note")`) — invisible editing.
- View enum: `PanelView = "short" | "deep" | "overview"` (panel.ts:95). Focus: `PanelFocus = "options" | "text" | "note"` (panel.ts:98).
- handleInput routing (panel.ts:583–643): resolved guard → confirmMode modal (enter/esc only) → gateWarning dismissal → advanceArmed one-shot logic → stage-1 enter in text/note → `this.keys(data, this)` (router) → textField forwarding when text/note focus → false.

---

## Panel creation/registration by index.ts
- `panelHost = createPanelHost(lifecycle)` (index.ts:95); `const drafts = new DraftStore()` (index.ts:100); `maybeAutoOpen(pi, config, panelHost, drafts)` (index.ts:103) — subscribes tool_execution_end.
- Renderer registration: `registerSubmissionCardRenderer(pi)`, `registerCompletionRecapRenderer(pi)`, `registerStateEntryRenderer(pi)` (index.ts:196–199). All display-only; renderers.ts matches customType `"interrogation-submission"` etc., reads `message.details.card`.
- Command registration: `registerInterrogateCommand(pi, config, panelHost, drafts)` (index.ts:214) → `pi.registerCommand("interrogate", ...)` (command.ts:134) + `pi.registerShortcut(breakOutKey, ...)` (command.ts:153).
- Tool `pi.registerTool(createInterrogateTool(config, { onReopen }))` (index.ts:156–180) with the `tool_execution_start` resumeSurface stash (index.ts:150–154).
- `createReconstruction(pi, { config, host: panelHost, drafts })` (index.ts:109).

## How tests fake the host (panel.test.ts:1–60 header)
> "a bare mock stands in for pi (no runtime), handlers are captured by event name and driven via emit(), and fixture states are real InterrogationStates seeded through the raw primitives. The `ui.custom` mock captures the factory + done callback and returns a promise that never resolves until done() is called — exactly the blocking contract the fire-and-forget host must survive. The panel host record is module-scoped … every test re-arms it via createPanelHost(...) first."
Also: `vi.mock("../external-editor.js", ...)` module-boundary mocking (panel.test.ts:38–43). PiUISurface mock = `{ ui: { custom: vi.fn((factory) => { captured = factory; ... return new Promise(...) }), setWidget: vi.fn() }, mode: "tui" }`.

## Suspend/restore widget mechanics (suspend.ts summary)
- `WIDGET_KEY = "interrogator"` (line 34); keyed widget via `pi.ui.setWidget(WIDGET_KEY, [line] | undefined)`.
- `buildSuspendWidgetLine` (line 74): `` `${open} open · ${answered} answered — ${labels.breakOut} to resume /interrogate` `` with exact separators.
- `updateSuspendWidget` (line 97): only set/clear rule, called from openPanel `.then` AND `.catch` (panel.ts:1312–1328); no-op when surface lacks `setWidget`.
- `resumePanel(pi)` (line 118) = `resumeOpenPanel(pi)`.

## Start Here
`src/panel/panel.ts` (host record lines 1070–1386 + buildLines 1045–1145) — the hub for all three bugs; then `src/command.ts:60–90`, `src/panel/actions.ts:309–382`, `src/panel/keys.ts:340–370`.

## Fix-surface hints
- BUG-005: the open-count is duplicated in command.ts:81, index.ts:172, and suspend.ts:103 — a shared "resumable" predicate (e.g. any ACTIVE_STATUSES, or answered-pending > 0) would fix all three surfaces coherently; tests live in command.test.ts, panel.test.ts, suspend.test.ts.
- BUG-008: candidates are filtering `diff.changed` before shipDrafts (e.g. skip ids whose `to` is "(unanswered)"/answer undefined), and/or filtering the delta build in buildSubmission; snapshots.ts:148–167 is the diff core.
- BUG-011: gate keys.ts:354 on `panel.view === "short"` (or make buildLines render the field in deep/overview when focus==="text"); keys.test.ts covers the router.

## 15-line summary
1. BUG-005 CONFIRMED at command.ts:81–82, index.ts:172–173, suspend.ts:103–105 — all gate on status "open" only.
2. "answered" (pending) questions never count toward resumability; suspended+fully-answered panel is treated as dead.
3. Statuses are 7: open/answered/submitted/reasked/moot/withdrawn/closed (state.ts:22–29) — one more than the task listed.
4. A broader notion ACTIVE_STATUSES (open/answered/submitted/reasked, panel.ts:172) already exists and is the natural fix basis.
5. Suspend = done(null) → openPanel's floating .then → markSuspended + updateSuspendWidget (open>0 shows line, else clears).
6. Resume: resumeOpenPanel restores lastFocusId (if still active) else first active question; upsert path and maybeAutoOpen have NO open-count guard — only the toggle and onReopen do.
7. BUG-008 CONFIRMED: actions.ts:355 ships drafts for every `diff.changed` id; diff is signature-based (snapshots.ts:148–167).
8. Merge rule 2 (merge.ts:181–193) resets answer to undefined + status "reasked" — so the id re-enters diff.changed as answer→unanswered.
9. Result: the user's surviving text draft for a re-asked question is destroyed at submit and the shipped delta reports it as a user change "(unanswered)".
10. buildSubmission (delivery.ts:129–167) takes the diff + note, takeSnapshot + bumpEpoch exactly once; submit flushes only status==="answered" ids via markSubmitted.
11. DraftStore: clearDraft/clearAll are explicit-only no-ops; shipDrafts(ids) deletes+returns; the store lives in the index.ts closure and survives everything except submit/restart.
12. BUG-011 CONFIRMED: keys.ts:354 focusText dispatch has no view guard (contrast externalEditor's focus guard at 366 and digits' view guard at ~385).
13. buildLines renders TextField only in note mode and short view (text focus or text-type question); deep/overview branches (panel.ts:1102–1144) have no TextField render → invisible text editing with forwarding at handleInput's tail.
14. Tests fake the host with a bare pi mock whose `ui.custom` captures factory+done and returns a never-resolving promise; host record re-armed via createPanelHost per test; module mocks (vi.mock) for external-editor.
15. Fix surfaces are cleanly separated: BUG-005 in three duplicated count sites (consider a shared predicate), BUG-008 around actions.ts:349–355/snapshots computeEntries, BUG-011 at keys.ts:354 or buildLines deep/overview branches.

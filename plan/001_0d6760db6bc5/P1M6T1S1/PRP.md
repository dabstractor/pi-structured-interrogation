name: "P1.M6.T1.S1 — Suspend (done(null)) + widget + resume rehydration"
description: Suspend coordinator: done(null) suspend with editor restore, setWidget('interrogator') reminder line, and resume that rehydrates a fresh panel from state + drafts with focus restored.

---

## Goal

**Feature Goal**: Implement the suspend/resume core (h2.35, h3.10, FR-14/FR-16 panel-side, AC-4): suspending the panel via `done(null)` restores the editor region and sets the `"interrogator"` widget line (`{n} open · {m} answered — {breakOut key} to resume /interrogate`, EXACT per h2.3); resuming clears the widget and re-instantiates a fresh panel from state + DraftStore with focus restored to the last current question.

**Deliverable**:
- `src/panel/suspend.ts` — NEW: pure widget-line builder + `suspendPanel()` / `resumePanel()` coordinator functions ([Mode A] JSDoc on widget string generation).
- `src/panel/suspend.test.ts` — NEW: unit tests.
- Surgical edits: `src/panel/panel.ts` (extend `PiUISurface` with optional `setWidget`; set/clear the widget at the suspend choke point; capture `lastFocusId`; clear widget on open/close), `src/index.ts` (pass the setWidget-capable surface / wire nothing new beyond what panel.ts needs).

**Success Definition**: Every path that resolves `custom()` (esc ladder, ctrl+shift+q in-panel, lifecycle dismiss) leaves: host `suspended`, editor region restored (pi-side), state + drafts untouched, and widget showing the exact line whenever ≥1 open question exists. `resumePanel(pi)` clears the widget, reopens a fresh panel instance whose `currentId` equals the pre-suspend focus, drafts visible (✎ markers intact). Completion (0 open questions) and full host close both clear the widget. Full suite green (`npx vitest run`), `npx tsc --noEmit` clean.

## User Persona

**Target User**: The pi user mid-interrogation who needs the editor back (to run a command, paste something, think).
**Use Case**: Presses `esc` at the top level of the panel (or `ctrl+shift+q`).
**User Journey**: esc → panel vanishes, main editor restored → one-line widget above the editor: `3 open · 2 answered — Ctrl+Shift+Q to resume /interrogate` → later presses the resume key/command (P1.M6.T1.S2) → fresh panel opens on the SAME question, drafts intact.
**Pain Points Addressed**: losing the interrogation after break-out (ask_user-style state loss); drafts destroyed by suspend; no discoverable way back to a suspended panel.

## Why

- FR-14 (break-out), FR-16 (esc never destroys state — top-level esc = suspend), h2.0 commitment 3 (a widget above the main editor keeps the panel findable) and 6 (drafts sacred across suspend/resume).
- The existing host (P1.M3.T1.S1) already implements done(null) suspend and fresh-instance rehydration on upsert — this item adds the widget surface, focus restore on explicit resume, and the exported suspend/resume coordinator consumed by P1.M6.T1.S2 (/interrogate command + global key), P1.M6.T2.S1 (reopen:true), P1.M6.T2.S2 (discuss).
- Today: `panel.suspend()` → `done(null)` → openPanel's floating `.then` → `markSuspended()` — no widget, no focus memory. `maybeAutoOpen` reopens but always focuses the first active question.

## What

- **Widget line (EXACT, h2.3/h2.35)**: `` `${n} open · ${m} answered — ${breakOutKey} to resume /interrogate` `` where n = questions with status `"open"`, m = status `"answered"` over `state.orderedQuestions()`, and breakOutKey = `resolveKeyLabels(config).breakOut` (display form, e.g. `Ctrl+Shift+Q`).
- **Set/clear rule**: on ANY `custom()` resolution (suspend choke point — see Blueprint), if phase becomes `suspended` AND n > 0 → `pi.ui.setWidget("interrogator", [line])`; otherwise → `pi.ui.setWidget("interrogator", undefined)`. This one rule covers: suspend with open questions → set; completion/dismiss with 0 open → cleared; full close (`resetHostRecord`) → clear defensively.
- **On open**: a successful `openPanel` clears the widget (no stale reminder while the panel is live).
- **Focus memory**: at suspend time capture the live panel's `currentId` into module state (`lastFocusId`). `resumePanel` reopens with `focusQuestionId: lastFocusId` (fallback: first active question via the `firstActiveUpsertedId` pattern when lastFocusId is gone/moot). The upsert-driven auto-reopen (`handleUpserted`) KEEPS its existing first-upserted focus (h2.37) — do not change it.
- **Esc at top level = suspend** (FR-16): already wired (`escapeDescend` → `panel.suspend()`); no keys.ts change needed — verify in tests only.
- **Rehydration guarantees (R4)**: state lives in `InterrogationState`, drafts in the shared `DraftStore` — both outside the component already; `lastOpts` spread reuses the same instances. Per-session panel state (deepSticky, scroll, view) legitimately resets on resume (h2.29 — documented, intended).
- **NO global shortcut / command registration** — that is P1.M6.T1.S2. This item only exports `suspendPanel(host)` and `resumePanel(pi)` (plus the widget builder) for it to call.
- **[Mode A] JSDoc**: header JSDoc on the widget-line builder in `src/panel/suspend.ts` documents the exact-string contract (counts semantics mirror results.ts statusLine: `answered` = status "answered" ONLY; submitted/reasked excluded from both counts), the config-derived breakOut label, and the set/clear visibility rule.

### Success Criteria

- [ ] Suspend (esc top-level, ctrl+shift+q in panel, lifecycle dismiss) with 3 open / 2 answered → `setWidget("interrogator", ["3 open · 2 answered — Ctrl+Shift+Q to resume /interrogate"])` recorded on the fake surface
- [ ] Widget reflects REBOUND config: `keys.breakOut: "ctrl+alt+x"` → label `Ctrl+Alt+X`
- [ ] Suspend with 0 open questions (completion path) → widget cleared (`undefined`), never an "0 open" line
- [ ] `resumePanel` → widget cleared first, fresh panel instance opened (deepSticky/view reset), `currentId === lastFocusId`, drafts from the shared store still visible (`hasDraft` true)
- [ ] lastFocusId pointing at a withdrawn/moot question on resume → falls back to first active question (never a dead focus)
- [ ] A successful openPanel clears any stale widget even without a prior suspend
- [ ] `host.dispose()` (full close) clears the widget
- [ ] State, answers, epoch, drafts byte-identical across suspend→resume (R4)
- [ ] Full suite green; `npx tsc --noEmit` clean

## All Needed Context

### Context Completeness Check

An implementer with zero codebase knowledge gets: the exact choke point in openPanel's floating `.then`, the narrow-interface extension shape, the exact widget string with count semantics, the focus-capture timing (before `markSuspended` clears `currentPanel`), the resume entry to export, and the test harness pattern. ✅

### Documentation & References

```yaml
- file: src/panel/panel.ts
  why: THE host — HostPhase/module state (:929-946), markSuspended (:944), handleUpserted (:952), suspendCurrent (:970), createPanelHost (:997), openPanel + floating .then (:1036-1110), maybeAutoOpen (:1120+), PiUISurface (:154-172), firstActiveUpsertedId (:910-922)
  pattern: widget set/clear lives in the .then/.catch AFTER markSuspended() (single choke point for every done path); focus capture BEFORE (currentPanel is nulled by markSuspended/suspendCurrent)
  gotcha: suspendCurrent() already disposes + nulls currentPanel synchronously — capture currentId FIRST; .catch path (crashed panel) must also set/clear widget correctly; openPanel returns before the promise resolves, so widget clearing on OPEN is a direct call, not in .then

- file: src/panel/keys.ts
  why: escapeDescend (:216-228) — esc top-level → panel.suspend() (FR-16 ALREADY wired); onBreakOut (:268) → p.suspend()
  pattern: NO changes needed; add tests only
  gotcha: do not add any key handling here — global ctrl+shift+q is P1.M6.T1.S2

- file: src/config.ts
  why: resolveKeyLabels (:360) → Record<KeyAction,string> display labels; KeyAction includes breakOut (:47); DEFAULT_CONFIG keys.breakOut "ctrl+shift+q" (:128)
  pattern: widget line uses labels.breakOut — NEVER raw config.keys.breakOut

- file: src/results.ts
  why: statusLine count convention (:74-98) — answered = status "answered" ONLY; reuse the same semantics for the widget counts
  gotcha: "open" count is status "open" only; reasked/submitted join neither bucket

- file: src/panel/panel.test.ts
  why: existing host test harness — fake PiUISurface, createPanelHost re-arm per scenario, state fixtures
  pattern: extend the fake with a setWidget(key, content) recorder; assert calls with exact strings

- file: plan/001_0d6760db6bc5/architecture/pi-api-validation.md
  why: §custom (done(null) restores editor region automatically) and §setWidget (setWidget(key, string[] | undefined); undefined clears; keyed widgets coexist)
  critical: setWidget content is string[] (array of one line), key EXACTLY "interrogator" (h2.3)

- file: plan/001_0d6760db6bc5/P1M6T1S1/research/notes.md
  why: full verified line anchors + design decisions (choke point, visibility rule, focus fallback)

- file: plan/001_0d6760db6bc5/P1M5T4S1/PRP.md
  why: parallel ripple-confirm item adds confirmMode to handleInput — orthogonal; do not touch its seams
```

### Current Codebase tree (relevant excerpt)

```bash
src/
  panel/
    panel.ts        # host: phase machine, openPanel, suspendCurrent, maybeAutoOpen
    keys.ts         # esc ladder → panel.suspend() (already correct)
    layout.ts       # renderers (no changes)
    actions.ts      # (no changes)
  config.ts         # resolveKeyLabels, KeyAction.breakOut
  state.ts          # orderedQuestions, statuses (read-only)
  draft-store.ts    # shared store (read-only)
  index.ts          # factory wiring
```

### Desired Codebase tree with files to be added

```bash
src/panel/
  suspend.ts        # NEW: buildSuspendWidgetLine(state, labels) pure fn;
                    #      suspendPanel(host), resumePanel(pi) coordinator exports;
                    #      updateSuspendWidget(pi, state, config) set/clear helper
  suspend.test.ts   # NEW: widget string, visibility rule, focus restore, R4 survival
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: markSuspended() and suspendCurrent() NULL currentPanel — read
// panel.currentId BEFORE calling either, or the focus is lost.
// CRITICAL: setWidget content is string[] — one-element array, not a string.
// CRITICAL: PiUISurface.setWidget must be OPTIONAL (test fakes + RPC mode).
// openPanel is synchronous until the promise resolves: clear the widget via a
// direct call on the success path, and set it in .then/.catch after suspend.
// The .catch (crashed panel) path also suspends → same widget rule applies.
// never "0 open" — n === 0 ⇒ setWidget(key, undefined).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/panel/suspend.ts
  - IMPLEMENT (pure, exported): buildSuspendWidgetLine(ordered: {status}[] | state, labels: Record<KeyAction,string>): string
    → `${n} open · ${m} answered — ${labels.breakOut} to resume /interrogate`
    (n = status "open", m = status "answered"; count semantics mirror results.ts statusLine)
  - IMPLEMENT: updateSuspendWidget(pi: PiUISurface, state: InterrogationState, config: InterrogatorConfig): void
    → n>0 ? setWidget("interrogator", [line]) : setWidget("interrogator", undefined)
  - IMPLEMENT: suspendPanel(host: PanelHost): void → host.suspend()
    (thin, but the named export P1.M6.T1.S2 / M6.T2.S2 consume; keeps consumers off raw host)
  - IMPLEMENT: resumePanel(pi: PiUISurface): boolean → delegates to the host's resume entry (Task 3)
  - [Mode A] JSDoc on buildSuspendWidgetLine: exact-string contract (h2.3), count
    semantics, config-derived label, visibility rule (suspended ∧ open>0)
  - NAMING: file suspend.ts in src/panel/; functions as above

Task 2: MODIFY src/panel/panel.ts — PiUISurface extension + widget choke point + focus memory
  - ADD optional member to PiUISurface: setWidget?(key: string, content: string[] | undefined, options?: { placement?: string }): void
  - ADD module state: let lastFocusId: string | undefined
  - EDIT suspendCurrent(): capture currentPanel?.currentId into lastFocusId FIRST
  - EDIT openPanel's floating .then AND .catch (after markSuspended()):
    if (activePi?.ui.setWidget && lastOpts) updateSuspendWidget(activePi, lastOpts.state, lastOpts.config)
  - EDIT openPanel success path (before `return true`): activePi?.ui.setWidget?.("interrogator", undefined) — clear stale reminder on (re)open
  - EDIT resetHostRecord(): activePi?.ui.setWidget?.("interrogator", undefined) BEFORE activePi is dropped; also clear lastFocusId
  - GOTCHA: only clear via activePi (the live surface); resetHostRecord drops it first — order matters
  - PRESERVE: handleUpserted's firstActiveUpsertedId focus (h2.37) — unchanged

Task 3: MODIFY src/panel/panel.ts — resume entry with focus restore
  - ADD exported function resumeOpenPanel(pi: PiUISurface): boolean (or export via suspend.ts wrapper):
    like maybeAutoOpen's openPanel call but focusQuestionId: lastFocusId, with fallback —
    validate lastFocusId against state (question exists && ACTIVE_STATUSES.includes(status));
    invalid/undefined → firstActiveUpsertedId(state, state.order) (first active question)
  - GOTCHA: getState() from state.ts is the lazy singleton accessor already used by maybeAutoOpen; resume uses lastOpts' state/config when available
  - resumePanel (Task 1) delegates here; do NOT duplicate openPanel logic

Task 4: MODIFY src/index.ts (if needed)
  - Only if wiring changes: the setWidget surface flows through existing ctx objects
    passed to openPanel — verify PiUISurface structural typing picks up ctx.ui.setWidget
    automatically (narrow pick: as long as openPanel receives ctx, no index change needed).
    If index.ts constructs a literal PiUISurface object, add the setWidget passthrough there.

Task 5: CREATE src/panel/suspend.test.ts
  - FOLLOW pattern: src/panel/panel.test.ts (fake PiUISurface + createPanelHost per scenario, createInterrogationState fixtures)
  - EXTEND fake surface: widget recorder `setWidgetCalls: Array<[string, string[] | undefined]>`
  - TESTS:
    * widget string exact (3 open/2 answered fixture, default labels)
    * rebound keys.breakOut → relabeled line
    * esc top-level suspend (drive keys router or call panel.suspend()) → widget set
    * suspend with 0 open → cleared, not "0 open"
    * .catch path (custom() rejects) → widget still set/cleared correctly
    * resumePanel: widget cleared, fresh instance (deepSticky reset), currentId === pre-suspend currentId
    * lastFocusId → withdrawn question → fallback to first active
    * openPanel clears stale widget
    * host.dispose() clears widget
    * drafts survive suspend/resume (DraftStore spy: hasDraft true post-resume; R4)
  - NAMING: test_{subject}_{scenario}
```

### Implementation Patterns & Key Details

```ts
// Task 1 — the exact-string builder ([Mode A] JSDoc above it)
export function buildSuspendWidgetLine(
  state: InterrogationState,
  labels: Record<KeyAction, string>,
): string {
  let open = 0, answered = 0;
  for (const q of state.orderedQuestions()) {
    if (q.status === "open") open++;
    else if (q.status === "answered") answered++;
  }
  return `${open} open · ${answered} answered — ${labels.breakOut} to resume /interrogate`;
}

// Task 2 — choke point inside openPanel's .then (and .catch):
//   const panel = currentPanel;            // capture BEFORE dispose/markSuspended
//   currentPanel?.dispose();
//   markSuspended();
//   if (panel !== undefined) lastFocusId = panel.currentId;
//   if (activePi?.ui.setWidget && lastOpts)
//     updateSuspendWidget(activePi, lastOpts.state, lastOpts.config);
// PATTERN: mirror the existing "Belt-and-braces cleanup" comment block.
// CRITICAL: suspendCurrent() runs BEFORE .then for the host-forced path — it
// must capture lastFocusId itself (currentPanel non-null there), BEFORE dispose().
```

### Integration Points

```yaml
WIDGET:
  - key: "interrogator" (EXACT, h2.3); content: single-element string[]; clear: undefined

CONSUMERS (later items, do not implement here):
  - P1.M6.T1.S2: /interrogate command + global ctrl+shift+q → suspendPanel/resumePanel toggle
  - P1.M6.T2.S1: agent reopen:true → resumePanel
  - P1.M6.T2.S2: discuss → suspendPanel + setEditorText (setEditorText NOT in this item)

CONFIG:
  - no new config; widget label derived from existing keys.breakOut via resolveKeyLabels
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx tsc --noEmit          # Expected: zero errors
npx vitest run src/panel/suspend.test.ts   # component-level, run after Task 5
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/panel/suspend.test.ts -v
npx vitest run src/panel/ -v      # host + panel regression (esc ladder, upsert reopen)
npx vitest run                    # FULL suite — ripple/gate/text-field items must stay green
# Expected: all pass
```

### Level 3: Integration Testing (System Validation)

```bash
# Smoke-load the extension (factory must not throw with setWidget-capable ctx)
npx tsc --noEmit && node -e "console.log('typecheck ok')"
# Manual TUI spot-check belongs to the M6.T1.S2 runbook once /interrogate exists;
# scripted verification here is the fake-surface widget recorder assertions.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Optional manual: launch pi, use debug commands (interrogate-debug-upsert) to seed
# questions, open panel, press esc → observe widget line; verify exact copy.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` all green (incl. P1.M5 ripple/gate tests — parallel item unharmed)
- [ ] No keys.ts changes; esc ladder behavior unchanged apart from the widget side effect

### Feature Validation

- [ ] Widget line EXACT match incl. `·` separators and label casing
- [ ] Visibility rule: set ⟺ suspended ∧ open>0; cleared on open, completion (0 open), full close
- [ ] Resume: fresh instance, focus = pre-suspend currentId (fallback first active), drafts intact
- [ ] suspendPanel/resumePanel exported for P1.M6.T1.S2 / M6.T2.S1 / M6.T2.S2

### Code Quality Validation

- [ ] [Mode A] JSDoc on widget string generation
- [ ] No duplication of openPanel logic in resume; no new global state beyond lastFocusId
- [ ] Existing tests pass unmodified except where the fake surface gains setWidget

## Anti-Patterns to Avoid

- ❌ Don't set the widget from keys.ts or panel.suspend() — single choke point in openPanel's promise landing
- ❌ Don't render "0 open · …" — clear instead
- ❌ Don't use raw `config.keys.breakOut` in the line — use the resolved label
- ❌ Don't capture currentId after markSuspended/suspendCurrent — it's null by then
- ❌ Don't wire the global shortcut or /interrogate command (P1.M6.T1.S2's scope)

---

**Confidence Score**: 9/10 — every seam verified by direct code reading with line anchors; the only residual risk is P1.M5.T4.S1's parallel handleInput edits, which are orthogonal to the suspend choke point.

# PRP — P1.M3.T1.S1: `custom()` host: fire-and-forget open, view switching, `done(null)` suspend

---
name: "P1.M3.T1.S1 — Panel host (panel/panel.ts)"
description: "Create src/panel/panel.ts: the InterrogationPanel component class and openPanel/suspendPanel host functions. openPanel calls ctx.ui.custom() FIRE-AND-FORGET (never awaited, JSDoc'd why — Mode A), holds the panel while idle (commitment 1), supports view switching (short|deep|overview, deepSticky), exposes done(null) as the suspend contract, reopens on questions-upserted while suspended (h2.37), and wires lifecycle.onPanelDismiss. DraftStore is accepted as an interface param (implemented in P1.M4.T2.S1). Key dispatch delegates through a KeyHandler seam (P1.M3.T3.S1). Rendering in this task is minimal/structural — full header/question-line/footer labels are P1.M3.T1.S2."
---

## Goal

**Feature Goal**: A working non-blocking panel host: the interrogate flow can open a `ctx.ui.custom()` component that replaces the bottom editor region, keeps it alive while the agent is idle, switches between short/deep/overview views, and suspends via `done(null)` — without ever blocking the tool or turn.

**Deliverable**: `src/panel/panel.ts` (InterrogationPanel class, `openPanel`, `suspendPanel`, `PanelHost` interface, `DraftStore` interface, `KeyHandler` type), `src/panel/panel.test.ts`, minimal wiring in `src/index.ts`.

**Success Definition**: `npm test` + `npm run typecheck` green; unit tests prove fire-and-forget open (no await on the custom() promise), done(null) suspend, view switching with deepSticky per session, upsert-while-suspended reopen, and single-instance guard; `pi -e .` smoke-loads with the panel opening on an upsert (via debug command from P1.M2.T3.S1).

## User Persona

**Target User**: pi end user answering the agent's clarifying questions in the TUI.

**Use Case**: Agent calls `interrogate(...)` and ends its turn; the user sees the panel replace the editor, answers at their own pace (possibly across agent turns), and can suspend (`esc` / ctrl+shift+q via later tasks) leaving a resumable panel.

**User Journey**: model upserts questions → panel appears in editor region, transcript visible above → user toggles views (ctrl+d/ctrl+l stubs here) → user suspends → editor returns → model upserts again → panel reopens automatically.

**Pain Points Addressed**: ask_user-style blocking tools that stall the turn and lose drafts; panel disappearing when the agent goes idle.

## Why

- h2.0 commitment 1 (non-blocking tool) and 3 (replace-editor panel) require a panel that outlives the tool call — impossible with the stock `await ctx.ui.custom()` pattern (system-context.md §Verified architectural pattern).
- This is the host everything in M3–M7 plugs into: rendering (S2), navigation (T2), keys (T3), drafts (M4), views (M5), suspend ecosystem (M6), auto-open on reconstruction (M7.T1.S2).

## What

### Public surface (exact)

In `src/panel/panel.ts`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { InterrogationState, SerializedState } from "../state.js";
import type { InterrogatorConfig } from "../config.js";

/** Panel view modes (h2.29). deepSticky is per panel session, not global. */
export type PanelView = "short" | "deep" | "overview";

/** Focus region inside the panel (short view h2.29 layout). */
export type PanelFocus = "options" | "text" | "note";

/**
 * DraftStore seam — implemented by P1.M4.T2.S1. Accept a handle via
 * openPanel options; the host never constructs one.
 */
export interface DraftStore {
  getDraft(questionId: string): string | undefined;
  setDraft(questionId: string, text: string): void;
  /** Batch note (R3) — "" when unset. */
  getNote(): string;
  setNote(text: string): void;
}

/** Key dispatch seam — implemented by P1.M3.T3.S1 (keys.ts). */
export type KeyHandler = (data: string, panel: InterrogationPanel) => boolean;

export interface PanelHost {
  /** True while a panel component is mounted (custom() not yet done()-ed). */
  isOpen(): boolean;
  /** True after done(null) suspend, before the next openPanel. */
  isSuspended(): boolean;
  /** Force-close the current panel (dismiss path; fires lifecycle.dismissPanel via done). */
  suspend(): void;
  /** The live panel instance while open (renderers/tests may inspect). */
  getPanel(): InterrogationPanel | undefined;
  /** Teardown seam: unhook state listeners. */
  dispose(): void;
}

export interface OpenPanelOptions {
  config: InterrogatorConfig;
  state: InterrogationState;
  drafts?: DraftStore;               // optional until P1.M4.T2.S1
  keys?: KeyHandler;                 // optional until P1.M3.T3.S1
  /** Question id to focus on open; defaults to first open question. */
  focusQuestionId?: string;
}

export function createPanelHost(
  lifecycle: { onPanelDismiss(cb: () => void): void; dismissPanel(): void },
): PanelHost;

/** Open (or reopen) the panel. Fire-and-forget — NEVER await the custom() promise. */
export function openPanel(pi: PiUISurface, opts: OpenPanelOptions): boolean;
export function suspendPanel(host: PanelHost): void;
```

`PiUISurface` = narrow structural type `{ ui: { custom<T>(...): Promise<T | undefined> }; mode?: string }`-style pick of ExtensionAPI (define it in panel.ts; `ctx.mode === "tui"` guard — `custom()` returns `undefined` in RPC mode).

### InterrogationPanel component

Class-based (todo.ts `TodoListComponent` pattern), constructed inside the custom() factory:

- State: `view: PanelView` (starts "short"), `focus: PanelFocus` ("options"), `currentId: string | undefined` (first status-`open` question on open, else first question), `deepSticky: boolean` (false initially; once user toggles deep, returning from overview restores deep — sticky per panel session only, resets on reopen), `scrollOffset: number` (deep view, 0), cached `renderedLines: string[]`, `lastWidth: number`.
- Implements `{ render(width: number): string[]; invalidate(): void; handleInput(data: string): void; dispose?(): void }`.
- `render(width)`: if `width === lastWidth && cached` return cache; else build minimal structural lines in THIS task:
  - short: `["interrogation header (TODO S2)", "question line (TODO S2)", "options region (TODO M3.T2)", "focus: " + this.focus, "footer (TODO S2)"]` — placeholder one-liners, no config labels yet (those are S2).
  - deep / overview: a single line `[view] placeholder (TODO M5.T1/M5.T2)` plus for deep the scrollOffset.
  - Real renderers replace these; the host's job here is the caching + invalidate + requestRender machinery, correct height accounting, and view state.
- `invalidate()`: clear cache and call `tui.requestRender()` (store `tui` from factory args).
- `handleInput(data)`: if a `KeyHandler` seam was provided and it returns `true`, stop (consumed). Otherwise a MINIMAL built-in binding set so the host is testable pre-keys.ts: `ctrl+d` toggles short↔deep (sets `deepSticky = true` when entering deep), `ctrl+l` toggles overview↔(deepSticky ? "deep" : "short"), `esc` in overview/deep returns to short. When keys.ts (P1.M3.T3.S1) lands it replaces these via the seam.
- `done` is captured from the factory; panel exposes `suspend()` → `this.done(null)`.

### Host behavior (the contracts this task owns)

1. **Fire-and-forget open** — see Implementation Blueprint JSDoc requirement. `openPanel` stores the floating promise with `.then(result => ...)` / `.catch(...)`; resolution `null` = suspended, anything else (including undefined host quirk) treated as suspend too.
2. **Single-instance guard**: if `isOpen()` is true, `openPanel` is a no-op returning `false` (prevents double-editor-replacement if an upsert and reconstruction race).
3. **Suspend contract**: `done(null)` → host marks suspended (not open), keeps nothing needing disposal beyond component `dispose()`. State and drafts live in the state singleton / DraftStore — NOT in the host — so suspend loses nothing.
4. **Auto-reopen (h2.37)**: the host subscribes `state.on("questions-upserted")`; if suspended (or open-but-stale) when an upsert arrives → reopen (if open, just invalidate — the panel re-reads state on render; if suspended → `openPanel` again, fresh instance rehydrated from state, `focusQuestionId` = the first upserted id that is currently active). This requires the host to hold `pi` + last `OpenPanelOptions` — store them.
5. **Lifecycle wiring**: `createPanelHost(lifecycle)` calls `lifecycle.onPanelDismiss(() => hostSuspend())` — the auto-close/completion path (M2) can dismiss the panel by calling `dismissPanel()`.
6. **Persistence while idle (commitment 1)**: nothing in the host closes the panel on agent events; only `done()` (suspend) or `dismissPanel` (lifecycle) closes it.
7. Panel listens to `state.on("changed")` → `invalidate()` (renderers stay dumb; state is source of truth). Unsubscribe in `dispose()`.

### index.ts wiring (one block)

```ts
// P1.M3.T1.S1 — panel host: opens on first upsert in TUI mode, persists
// while idle, suspends via done(null) (h2.35), reopens on suspended upsert (h2.37).
const panelHost = createPanelHost(lifecycle);
pi.on("session_start", () => { /* no-op for now; M7.T1.S2 reconstruction auto-open reuses openPanel */ });
// open-on-upsert: subscribe to the state singleton's event lazily — the state
// may not exist yet; instead hook lifecycle by piggybacking tool flow:
// simplest correct point = state event. Since state is a singleton created on
// first upsert, openPanel subscription is registered inside createPanelHost
// via a state factory hook (see Blueprint).
```

The clean seam: extend `createLifecycle` is NOT allowed (don't modify M2 files beyond what its PRP already shipped — lifecycle already exposes what we need via events on state). Instead `createPanelHost` takes an additional `subscribeUpserts(cb: (ids: string[]) => void): () => void` option (an unsubscribe-returning subscriber over the CURRENT state singleton), and index.ts supplies a lazy version that (a) wires the existing singleton if present and (b) polls/wires via `setState` — concretely: state.ts exposes `getState()`; the state singleton is created by the tool executor on first upsert, and `state.emit("questions-upserted")` fires there. Provide `subscribeToStateEvents` helper in panel.ts that registers on the current singleton and ALSO on any future one by wrapping `setState` — simpler alternative (preferred): export a tiny `onStateEvents(type, cb)` registry from panel.ts that the tool path calls. **Decision (keep it minimal)**: index.ts wraps `getState()` at event time — since `openPanel` already holds the state reference, register the upsert listener on THAT state instance inside `openPanel`, and have index.ts trigger the first open from the `questions-upserted` event via a module-level helper `watchStateForPanel(pi, host, config)` exported from panel.ts that uses `pi.on("tool_execution_end")`-free logic: it monkey-wraps nothing; it subscribes via `state.on` after checking `getState()` on an interval-free hook — **FINAL, simplest and correct**: subscribe inside `openPanel` (state instance is live by then) AND export `maybeAutoOpen(pi, config, host)` that index.ts calls from a `tool_execution_end` subscription it already can add (same pattern lifecycle.ts:169-183 uses) when `toolName === "interrogate"`, `!event.isError`, mode tui, and `getState()` exists → `openPanel(pi, {config, state, ...})`. Auto-reopen-when-suspended is then naturally covered by calling `maybeAutoOpen` on every interrogate tool end (openPanel no-ops when already open, reopens when suspended). State-`changed` invalidation stays subscribed in the panel itself.

### Success Criteria

- [ ] `openPanel` never awaits the custom() promise (fire-and-forget with Mode A JSDoc explaining why).
- [ ] Panel replaces editor region in a live TUI; transcript stays visible (non-overlay default — do NOT pass overlay options).
- [ ] `esc`/dismiss → `done(null)` → editor restored; host `isSuspended()` true; state untouched.
- [ ] ctrl+d / ctrl+l switch views; deepSticky remembered within a session, reset after reopen.
- [ ] Interrogate upsert while suspended → panel reopens (h2.37) focused on an upserted active question.
- [ ] openPanel while already open = no-op, single panel.
- [ ] lifecycle.dismissPanel() suspends the panel (onPanelDismiss wiring).
- [ ] All unit tests pass; typecheck clean.

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the custom() contract + fire-and-forget rationale, the component interface, the existing lifecycle/state surfaces to consume, and what is deliberately deferred (S2 rendering, keys.ts, DraftStore impl). All specified below with file anchors.

### Documentation & References

```yaml
- file: plan/001_0d6760db6bc5/architecture/system-context.md
  why: §"Verified architectural pattern" — the fire-and-forget custom() resolution (lines ~11-16); module layout showing panel/ contents
  critical: "Only entry into `await ctx.ui.custom` is forbidden inside tool execute" — commands/events may open the panel the same way

- file: plan/001_0d6760db6bc5/architecture/pi-api-validation.md
  why: custom<T>() signature + "temporarily replaces the editor until done()" (line 39); non-overlay default = bottom editor region, transcript visible; RPC mode returns undefined → guard ctx.mode === "tui"

- file: plan/001_0d6760db6bc5/architecture/reference-patterns.md
  why: questionnaire.ts:131-137 closure factory; todo.ts TodoListComponent class pattern (constructor (data, theme, onClose)); question.ts custom<...|null> + done(null) cancel precedent; render caching + tui.requestRender()

- file: src/lifecycle.ts
  why: Lifecycle interface to consume — onPanelDismiss (line ~95), dismissPanel (line ~99, "no-op until M3 wires a panel" — THIS task is that consumer); note tool_execution_start/end pattern (lines 162-186) to mirror in index.ts auto-open wiring
  gotcha: pi.on returns void in the installed runtime — don't rely on unsubscribe returns (see lifecycle.ts:158-166 tolerant `track` helper; copy that pattern)

- file: src/state.ts
  why: InterrogationState typed events (StateEvents, lines ~131-146): "questions-upserted": [ids], "changed": [SerializedState]; orderedQuestions()/getQuestion() for currentId selection; getState() singleton (lines ~200-215 mutation/read discipline)

- file: src/index.ts
  why: factory wiring point — add createPanelHost + auto-open subscription after createLifecycle (line ~47)
  pattern: existing pi.on / registerCommand usage; config loaded once, passed down

- file: plan/001_0d6760db6bc5/P1M2T3S1/PRP.md
  why: the debug commands being implemented in parallel — use them for manual smoke testing (/interrogate-debug-upsert)
  contract: executeInterrogate is the production upsert path; treat as available

- file: src/config.ts
  why: InterrogatorConfig shape (hotkeys live there; S1's built-in ctrl+d/ctrl+l stubs should READ from config with hardcoded fallbacks so S2/S3 replace cleanly — check the hotkey field names before coding)

- file: src/state.test.ts
  why: test conventions — vitest, *.test.ts colocated, mock patterns for EventEmitter-based classes
```

### Current Codebase tree (relevant excerpt)

```bash
src/
  index.ts          # factory — wiring point
  config.ts         # InterrogatorConfig
  state.ts          # InterrogationState singleton + events
  lifecycle.ts      # auto-close engine + onPanelDismiss/dismissPanel
  tool.ts           # executeInterrogate (upsert path)
  delivery.ts       # buildSubmission/deliverSubmission (not used here)
  *.test.ts         # vitest, colocated
```

### Desired Codebase tree with files to be added

```bash
src/panel/
  panel.ts          # THIS TASK: InterrogationPanel, openPanel, suspendPanel,
                    # createPanelHost, DraftStore/KeyHandler seams, maybeAutoOpen
  panel.test.ts     # THIS TASK: host contract tests (mock ui.custom)
  (later: short-view.ts, deep-view.ts, overview.ts, text-field.ts, keys.ts)
```

### Known Gotchas of our codebase & pi API

```ts
// CRITICAL: custom() BLOCKS until done() — never await it anywhere reachable
// from tool execute or turn handling. Fire-and-forget + .then/.catch only.
// CRITICAL: custom() returns undefined in RPC mode — guard ctx.mode === "tui"
// (or check the returned promise resolution) before treating the panel as open.
// CRITICAL: non-overlay default — do NOT pass { overlay: true } (experimental).
// pi.on() returns void in the installed runtime — mirror lifecycle.ts's
//   tolerant track() helper; don't assume unsubscribers.
// render(width) must cache lines and only rebuild on invalidate(); always
//   tui.requestRender() after state/view changes.
// deepSticky is per PANEL SESSION — a fresh panel instance on reopen resets it.
// Don't store drafts/answers in the host — suspend must lose nothing; state
//   singleton + DraftStore own the data.
```

## Implementation Blueprint

### Data models and structure

No new persisted models — view/focus state lives on the panel instance; suspend state on the host. Interfaces to define: `PanelView`, `PanelFocus`, `DraftStore` (seam only), `KeyHandler` (seam only), `PanelHost`, `OpenPanelOptions`, `PiUISurface`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/panel/panel.ts — interfaces + InterrogationPanel skeleton
  - IMPLEMENT: PanelView/PanelFocus/DraftStore/KeyHandler/PanelHost/OpenPanelOptions types (exact shapes above)
  - IMPLEMENT: InterrogationPanel class with closure/class state {view, focus, currentId, deepSticky, scrollOffset}, render caching, invalidate→tui.requestRender(), handleInput with ctrl+d/ctrl+l/esc built-ins (config-read with hardcoded fallback), suspend() → done(null)
  - FOLLOW pattern: todo.ts TodoListComponent (class component, constructor takes dependencies + onClose) per reference-patterns.md §1
  - NAMING: InterrogationPanel (class), openPanel/suspendPanel/createPanelHost/maybeAutoOpen (functions)
  - PLACEMENT: src/panel/panel.ts

Task 2: fire-and-forget host in panel.ts
  - IMPLEMENT: openPanel(pi, opts): guard tui mode; single-instance no-op; call pi.ui.custom<null>((tui, theme, _kb, done) => new InterrogationPanel(...)) WITHOUT await; capture floating promise; .then(r => markSuspended())/.catch(log-safe swallow)
  - MODE A JSDoc: block comment on openPanel explaining WHY fire-and-forget (commitment 1: tool must return immediately; custom() blocks until done; awaiting anywhere in the turn path would re-create the ask_user stall; references system-context.md verified pattern)
  - GOTCHA: keep the done-callback path idempotent — custom() resolution after a manual suspend must not corrupt host flags

Task 3: lifecycle + state wiring
  - IMPLEMENT: createPanelHost(lifecycle) → registers lifecycle.onPanelDismiss(hostSuspend); subscribe state.on("changed") → panel.invalidate() inside openPanel; unsubscribe in dispose()
  - IMPLEMENT: maybeAutoOpen(pi, config, host): pi.on("tool_execution_end") → interrogate && !isError && getState() → openPanel (reuses stored opts; reopens when suspended per h2.37; no-op when open)
  - FOLLOW pattern: lifecycle.ts tool_execution_start/end subscription block (lines 162-186) + tolerant track() helper

Task 4: MODIFY src/index.ts
  - ADD after createLifecycle: `const panelHost = createPanelHost(lifecycle); maybeAutoOpen(pi, config, panelHost);` (keep `void panelHost` or use it — no unused-var lint failures)
  - PRESERVE: existing registerCommand/registerTool/lifecycle wiring

Task 5: CREATE src/panel/panel.test.ts
  - MOCK: fake ui surface `{ ui: { custom: async (factory) => { capture done + component; return new Promise(r => pending = r); } } }` — never resolves until done called
  - TESTS (naming test_{behavior}):
    - test_openPanel_does_not_await_custom (openPanel returns synchronously / resolves before done)
    - test_suspend_done_null_marks_suspended_and_editor_restored (call captured done(null))
    - test_view_switch_ctrl_d_sets_deepSticky / test_ctrl_l_overview_esc_returns
    - test_deepSticky_resets_on_reopen
    - test_upsert_while_suspended_reopens (fake state EventEmitter, emit questions-upserted or call maybeAutoOpen path)
    - test_open_while_open_is_noop (custom factory invoked exactly once)
    - test_lifecycle_dismissPanel_suspends (lifecycle mock, onPanelDismiss captured)
    - test_state_changed_invalidates (spy on requestRender)
    - test_render_caches_until_invalidate
  - FOLLOW pattern: src/state.test.ts / src/lifecycle.test.ts (fixtures, EventEmitter mocks)
  - PLACEMENT: src/panel/panel.test.ts

Task 6: VERIFY with existing suite
  - npm test && npm run typecheck (see Validation Loop)
```

### Implementation Patterns & Key Details

```ts
// THE core pattern — fire-and-forget open (Mode A JSDoc required):
/**
 * Opens the interrogation panel fire-and-forget.
 *
 * WHY NOT AWAIT: `ctx.ui.custom()` blocks until `done()` fires. The
 * interrogate tool must return immediately (h2.0 commitment 1 — non-blocking,
 * panel persists while idle). Awaiting the custom() promise anywhere
 * reachable from the tool execute or turn path would stall the turn exactly
 * like the ask_user extension. We deliberately orphan the promise and react
 * to its resolution (null = suspend, h2.35) via .then/.catch.
 * Ref: plan architecture/system-context.md §"Verified architectural pattern".
 */
export function openPanel(pi: PiUISurface, opts: OpenPanelOptions): boolean {
  if (host.isOpen()) return false;             // single instance
  const promise = pi.ui.custom<null>((tui, theme, kb, done) => {
    panel = new InterrogationPanel({ tui, theme, state: opts.state, ... , done });
    opts.state.on("changed", onChanged);       // invalidate on any mutation
    return panel;
  });
  void promise.then(() => markSuspended()).catch(() => markSuspended());
  return true;
}

// Component render caching:
render(width: number): string[] {
  if (this.cached !== undefined && width === this.lastWidth) return this.cached;
  this.lastWidth = width;
  this.cached = buildLines(width); // structural placeholders in S1 (S2 replaces)
  return this.cached;
}
invalidate(): void { this.cached = undefined; this.tui.requestRender(); }
```

### Integration Points

```yaml
EVENTS (consumed):
  - state: "changed" → panel.invalidate(); "questions-upserted" (optional direct use; maybeAutoOpen covers reopen via tool_execution_end)
  - pi: "tool_execution_end" (maybeAutoOpen) — same narrowing as lifecycle.ts
LIFECYCLE:
  - lifecycle.onPanelDismiss(hostSuspend); lifecycle.dismissPanel() triggers suspend
CONFIG:
  - read hotkey labels for ctrl+d/ctrl+l from InterrogatorConfig if present, else hardcoded fallbacks (verify field names in src/config.ts first)
INDEX:
  - src/index.ts: createPanelHost + maybeAutoOpen after createLifecycle
FUTURE SEAMS (do not implement):
  - DraftStore param (P1.M4.T2.S1), KeyHandler param (P1.M3.T3.S1), renderers (S2, M5)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck      # tsc, zero errors
npx eslint src/panel/  # if eslint configured; else skip
npm run format 2>/dev/null || true
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/panel.test.ts
npm test               # full suite — must stay green (no regressions in M1/M2)
```

### Level 3: Integration (live TUI smoke)

```bash
# In a terminal:
pi -e .                # loads extension
# then use the debug command from P1.M2.T3.S1:
/interrogate-debug-upsert '{"goal":"pick db","questions":[{"id":"q1","title":"engine","options":[{"id":"sqlite","label":"sqlite"}]}]}'
# EXPECT: panel replaces editor region (placeholder lines), transcript visible above.
# Press ctrl+d → deep placeholder; ctrl+l → overview; esc → back to short.
# Press esc (top level stub if wired, or call done path via test) → editor restored.
# Repeat the debug upsert → panel stays/reopens (h2.37).
# Type in main editor after suspend → text preserved.
```

### Level 4: Domain-Specific Validation

- Manually verify the fire-and-forget invariant: while the panel is open, run any agent turn (`/interrogate-debug-state`) — nothing blocks.
- Verify only ONE panel instance ever mounts (no double editor replacement) across repeated upserts.

## Final Validation Checklist

### Technical Validation

- [ ] `npm test` green (new + existing)
- [ ] `npm run typecheck` clean
- [ ] Live smoke: panel opens via `/interrogate-debug-upsert`, views toggle, esc suspends, re-upsert reopens

### Feature Validation

- [ ] Fire-and-forget JSDoc (Mode A) present on openPanel
- [ ] done(null) suspend contract honored; state/drafts survive (nothing stored in host)
- [ ] Single-instance guard + h2.37 reopen while suspended
- [ ] lifecycle.dismissPanel() suspends the panel
- [ ] Panel persists while agent idle (no agent-event close paths)

### Code Quality Validation

- [ ] No awaits on the custom() promise anywhere
- [ ] Seams (DraftStore, KeyHandler) are interfaces only — no stub implementations beyond what tests need
- [ ] Render caching + requestRender discipline followed

## Anti-Patterns to Avoid

- ❌ NEVER `await ctx.ui.custom(...)` — the whole point of this task
- ❌ Don't pass overlay options (experimental; spec requires replace-editor non-overlay)
- ❌ Don't store drafts/answers/currentQuestion content in the host (suspend must lose nothing)
- ❌ Don't implement S2's config-driven header/footer labels or M5's real deep/overview renderers — placeholders only
- ❌ Don't modify lifecycle.ts/state.ts (consume their existing surfaces)
- ❌ Don't rely on pi.on() returning an unsubscriber (void in installed runtime)

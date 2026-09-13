name: "P1.M6.T1.S2 — /interrogate command + global ctrl+shift+q + empty state"
description: Register the `/interrogate` toggle command and the global break-out/resume shortcut (default ctrl+shift+q, config-driven), with TUI-mode guard, idempotent phase toggling, and the exact h2.37 empty-state notification. Mode A JSDoc on the dual registration (global + panel-scoped).

---

## Goal

**Feature Goal**: Users can toggle the interrogation panel from anywhere in pi TUI: `/interrogate` command (toggle: open→suspend, suspended→resume) and a global `registerShortcut` on the configured `keys.breakOut` (default `ctrl+shift+q`). With no active interrogation, both surface the EXACT h2.37 info notification. Non-TUI invocations are guarded (`ctx.mode` check). h2.34/AC-4 break-out/resume cycle is fully wired end-to-end.

**Deliverable**:
- `src/command.ts` — NEW: `registerInterrogateCommand(pi, config, host, drafts)` — registers the `/interrogate` command AND the global break-out shortcut (one seam, [Mode A] JSDoc on the dual registration), with a pure `interrogateToggleAction(...)` core for testability.
- `src/command.test.ts` — NEW: unit tests (toggle matrix, empty state, mode guard, idempotency, config-rebound shortcut key).
- Surgical edit: `src/index.ts` — one call to `registerInterrogateCommand(pi, config, panelHost, drafts)` inside the factory.

**Success Definition**: With an active interrogation: `/interrogate` or global ctrl+shift+q while panel open → suspends (editor restored, widget set by S1's choke point); while suspended → resumes on the last-focused question via S1's `resumePanel`. With no state / 0 open questions: `notify("No active interrogation — ask the agent to interrogate you", "info")`. In rpc/json/print mode: TUI-only info notify, no crash. Repeated presses are all no-op-safe (idempotent guards). `npx tsc --noEmit` clean, `npx vitest run` fully green.

## User Persona

**Target User**: pi TUI user mid-interrogation who wants the editor back — or back into the panel — without remembering panel-internal keys.
**Use Case**: The user has broken out (esc) or the agent reopened state; a widget line says `3 open · 2 answered — Ctrl+Shift+Q to resume /interrogate`.
**User Journey**: type `/interrogate` (or press ctrl+shift+q anywhere) → panel toggles. No interrogation running → friendly info toast pointing at the agent-side entry point.
**Pain Points Addressed**: no discoverable entry point for the panel; app-level shortcuts swallowed while a custom component holds focus; commands that crash headless modes.

## Why

- h2.15 (`pi.registerCommand` "/interrogate" toggle; `pi.registerShortcut` break-out/resume global, default ctrl+shift+q), h2.34 (break out / resume row: `keys.breakOut` also `registerShortcut`, global context), h2.35 (resume via ctrl+shift+q or /interrogate), h2.37 (empty state notify).
- AC-4 (break-out/resume cycle) needs both surfaces: the in-panel ctrl+shift+q exists since P1.M3.T3.S1 (keys.ts `onBreakOut`); the GLOBAL registration is this item — the app-level shortcut may not fire while the custom panel component holds focus, which is exactly why the dual (global + panel-scoped) registration exists and must be documented.
- Consumes S1's exports (`suspendPanel`, `resumePanel`) and the host phase API (`isOpen()` / `isSuspended()`).

## What

- **Command `/interrogate`** (`pi.registerCommand("interrogate", ...)`):
  - Handler `(args: string, ctx)`. `ctx.mode !== "tui"` → `ctx.ui.notify("The interrogation panel requires TUI mode", "info")`, return (h2.15: `ctx.mode` guards throughout; `custom()` returns undefined in RPC — must never be reached).
  - Toggle core (shared with the shortcut):
    1. `host.isOpen()` → `suspendPanel(host)` (S1 export) — suspend, editor restored, widget set by S1's choke point.
    2. `host.isSuspended()` → `resumePanel(ctx)` (S1 export; `ctx`'s `ctx.ui` is the PiUISurface carrier — same pattern as maybeAutoOpen).
    3. Otherwise (host closed / no state / 0 open questions) → `ctx.ui.notify("No active interrogation — ask the agent to interrogate you", "info")` — EXACT string (h2.37, h2.3).
  - Args: any args string is ignored for toggling; with no active interrogation the same notify fires (h2.15: "with args when no state → notify"). Never throw on args.
  - Empty-state precision: after completion the host is closed and state cleared → branch 3 fires naturally. A suspended host with 0 open questions (pending-submission edge) → treat as empty state: notify instead of resuming a dead panel (widget is cleared by S1 in that case, so the two surfaces stay consistent).
- **Global shortcut** (`pi.registerShortcut(config.keys.breakOut, { description, handler })`):
  - Key string = the RAW config value `config.keys.breakOut` (default `"ctrl+shift+q"`; registerShortcut format `modifier+key` matches config format — no transformation).
  - Handler `(ctx) => ctx.ui !== undefined && interrogateToggle(ctx as PiUISurface-carrier)` — same toggle core, same guards. Shortcut registration is effectively TUI-only (validated: flat app-level, no mode scoping needed); guard `ctx.ui?.notify` defensively.
  - **Idempotency** (AC-4 cycle): `suspendPanel` → `host.suspend()` → done(null) already resolved on second call → no-op; `resumePanel` while open → openPanel no-op (phase `"open"` early-return). Guards make the dual registration (global + in-panel keys.ts) race-safe.
  - [Mode A] JSDoc block on `registerInterrogateCommand` documents: WHY two registrations (app shortcut may not fire while the custom component holds focus — keyRouter intercepts first; global covers the suspended state), the idempotent-guard contract, the config-rebind path, and the conflict re-verification note (ctrl+shift+q verified FREE in environment-and-conflicts.md:80; re-verify at build time per h2.34 and record in PR notes).
- **No changes** to keys.ts (in-panel breakOut already config-driven), panel.ts, suspend.ts (S1 contract), or the widget logic.

### Success Criteria

- [ ] `/interrogate` while open → suspended (widget set, editor restored); while suspended → resumed with focus on last question (S1 behavior, invoked through this command)
- [ ] Global shortcut registered with `config.keys.breakOut` value; a rebind to e.g. `ctrl+alt+x` registers `ctrl+alt+x` (test asserts the registered key string)
- [ ] No state + `/interrogate` (with or without args) → EXACT notify `"No active interrogation — ask the agent to interrogate you"`, severity `"info"`
- [ ] Non-TUI ctx.mode → TUI-only info notify, no `custom()` call, no throw
- [ ] Suspended host with 0 open questions → empty-state notify (consistent with cleared widget)
- [ ] Double-press suspend or double resume → second action is a no-op (no throw, no duplicate done())
- [ ] `npx tsc --noEmit` clean; `npx vitest run` all green

## All Needed Context

### Context Completeness Check

An implementer with zero codebase knowledge gets: the exact pi API signatures (validated in architecture docs), the S1 export contract to consume, the existing registration pattern to copy, the toggle decision table, exact strings, and the test-harness shape. ✅

### Documentation & References

```yaml
- file: src/panel/suspend.ts (P1.M6.T1.S1 deliverable — CONTRACT)
  why: suspendPanel(host) and resumePanel(pi) exports this item consumes
  pattern: suspendPanel → host.suspend() (done(null)); resumePanel reopens with focusQuestionId=lastFocusId and clears the widget
  gotcha: if S1 names the export differently at merge time, adapt imports — do not reimplement resume logic

- file: src/panel/panel.ts
  why: PanelHost phase API (:1097-1102 isOpen/isSuspended/suspend), openPanel no-op guards (:1133 `if (phase === "open") return false`), suspendPanel (:1192), PiUISurface (:154-172, gains optional setWidget in S1)
  pattern: host phase is the ONLY toggle state source — never read module-private `phase` directly
  gotcha: openPanel is synchronous-returning; suspend resolution is async (floating .then) — but phase flips synchronously in markSuspended/suspendCurrent, so back-to-back toggles are consistent

- file: src/panel/keys.ts
  why: onBreakOut (:268) + matchesKey(data, b.breakOut) (:360) — in-panel ctrl+shift+q ALREADY config-driven and intercepting before the embedded editor (h2.34 intercept rule)
  pattern: NO changes; the dual registration exists because this router consumes keys while the panel holds focus
  gotcha: do not remove or duplicate in-panel handling

- file: src/index.ts
  why: registration pattern (:39-44 interrogate-ping command) and factory closure holding config/panelHost/drafts (:100-110)
  pattern: add ONE call `registerInterrogateCommand(pi, config, panelHost, drafts)` after createPanelHost/maybeAutoOpen

- file: src/debug-commands.ts
  why: command-handler error/notify conventions (ctx.ui.notify with severity)
  pattern: handlers are async, catch-and-notify, never throw

- docfile: plan/001_0d6760db6bc5/architecture/pi-api-validation.md
  why: §registerCommand (:24-25 — args/ctx shape, ctx.mode, ctx.ui) and §registerShortcut (:27-28 — key format, flat app-level, effectively TUI-only, handler ctx has ctx.ui), §ctx.mode/hasUI (:54)
  critical: registerShortcut takes the config key string verbatim; handler ctx may lack ctx.mode — do not branch on it there

- docfile: plan/001_0d6760db6bc5/architecture/environment-and-conflicts.md
  why: :80 ctrl+shift+q FREE (no pi default, no installed extension); :66-68 no other extension registerShortcut conflicts
  critical: re-verify at build time and record findings in the PR notes (h2.34 requirement)

- file: plan/001_0d6760db6bc5/P1M6T1S1/PRP.md
  why: full S1 contract (suspend.ts exports, widget rule, focus restore) — read before implementing
- file: plan/001_0d6760db6bc5/P1M6T1S2/research/notes.md
  why: verified API facts, toggle truth table, prior-item seam notes
```

### Current Codebase tree (relevant excerpt)

```bash
src/
  index.ts             # factory: config, panelHost, drafts closure; registrations
  config.ts            # keys.breakOut default "ctrl+shift+q" (:128); KeyAction type
  state.ts             # getState() lazy singleton
  panel/
    panel.ts           # PanelHost isOpen/isSuspended/suspend; openPanel; suspendPanel
    keys.ts            # in-panel breakOut (config-driven, already done)
    suspend.ts         # S1: suspendPanel/resumePanel + widget line (CONTRACT)
  debug-commands.ts    # command registration/notify conventions
```

### Desired Codebase tree with files to be added

```bash
src/
  command.ts           # NEW: registerInterrogateCommand(pi, config, host, drafts);
                       #      pure toggle core interrogateToggleAction(host, ctx)
  command.test.ts      # NEW: fake pi/host/ctx; toggle matrix + edge tests
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: the shortcut handler ctx has ctx.ui but (per validation doc) NOT a
// documented ctx.mode — only the COMMAND handler guards on ctx.mode. The
// shortcut itself is "effectively TUI-only" per pi's flat registration.
// CRITICAL: registerShortcut key = RAW config.keys.breakOut ("ctrl+shift+q"),
// NOT the display label from resolveKeyLabels (labels are for rendering only).
// CRITICAL: resumePanel needs a PiUISurface carrier — pass the command ctx
// (ctx.ui) exactly like maybeAutoOpen passes ctx to openPanel (:1232).
// CRITICAL: state singleton may be undefined until first upsert — always
// short-circuit via host phase first; only consult getState() for the 0-open
// suspended edge.
// Command name is "interrogate" (user types /interrogate) — h2.3 naming.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/command.ts
  - IMPLEMENT pure core:
    export function interrogateToggleAction(
      host: PanelHost, pi: PiUISurface, state: InterrogationState | undefined,
    ): "suspended" | "resumed" | "empty"
      if (host.isOpen()) { suspendPanel(host); return "suspended"; }
      if (host.isSuspended()) {
        const open = state?.orderedQuestions().filter(q => q.status === "open").length ?? 0;
        if (open === 0) return "empty";           // dead panel edge (h2.37 pending edge)
        resumePanel(pi); return "resumed";
      }
      return "empty";
  - IMPLEMENT: registerInterrogateCommand(pi: ExtensionAPI, config: InterrogatorConfig,
      host: PanelHost, drafts?: DraftStore): void
    - pi.registerCommand("interrogate", { description: "Toggle the interrogation panel (suspend/resume)",
        handler: async (_args: string, ctx) => {
          if (ctx.mode !== "tui") { ctx.ui.notify("The interrogation panel requires TUI mode", "info"); return; }
          const outcome = interrogateToggleAction(host, ctx, getState());
          if (outcome === "empty") ctx.ui.notify("No active interrogation — ask the agent to interrogate you", "info");
        } })
    - pi.registerShortcut(config.keys.breakOut, { description: "interrogator: break out / resume the interrogation panel",
        handler: async (ctx) => { if (!ctx.ui) return;
          const outcome = interrogateToggleAction(host, ctx, getState());
          if (outcome === "empty") ctx.ui.notify("No active interrogation — ask the agent to interrogate you", "info"); } })
    - NAMING: file command.ts in src/; exports above; drafts param accepted for
      signature stability (resume path uses lastOpts internally) — pass through unused if so
  - [Mode A] JSDoc header on registerInterrogateCommand covering the DUAL REGISTRATION:
    why global registerShortcut alone is insufficient (may not fire while the
    custom panel component holds focus — keys.ts intercepts first), why the
    in-panel handler alone is insufficient (nothing fires while suspended),
    the idempotent guards on both paths, config rebinding, and the
    conflict-verification note (ctrl+shift+q FREE per environment-and-conflicts.md:80;
    re-verify at build time, record in PR notes per h2.34).

Task 2: MODIFY src/index.ts
  - ADD import { registerInterrogateCommand } from "./command.js";
  - ADD one call after maybeAutoOpen(...): registerInterrogateCommand(pi, config, panelHost, drafts);
  - PRESERVE: all existing registrations (ping, tool, lifecycle, debug commands, panel host)

Task 3: CREATE src/command.test.ts
  - FOLLOW pattern: src/debug-commands.test.ts (fake pi recording registerCommand/
    registerShortcut calls, fake ctx with mode/ui.notify recorder) + src/panel/panel.test.ts
    host-fixture approach (createPanelHost + createInterrogationState fixtures)
  - TESTS (name test_{subject}_{scenario}):
    * test_toggle_suspends_when_open (state with open questions, host open → suspendPanel called / host.isSuspended() true)
    * test_toggle_resumes_when_suspended (host suspended + open questions → resumePanel invoked with the ctx surface)
    * test_toggle_empty_state_notifies_exact_string (closed host / no state → notify "No active interrogation — ask the agent to interrogate you", "info")
    * test_toggle_empty_state_with_args_same_notify
    * test_toggle_suspended_zero_open_notifies (h2.37 edge)
    * test_command_non_tui_mode_guards (mode "rpc" → TUI-only notify, no toggle call)
    * test_shortcut_registered_with_config_key (registered shortcut key === config.keys.breakOut; rebind fixture "ctrl+alt+x" → registered as "ctrl+alt+x")
    * test_shortcut_handler_toggles (invoke recorded handler with fake ctx → same toggle outcomes)
    * test_double_press_idempotent (open → suspend → suspend again: no throw, host stays suspended)
  - MOCK: suspendPanel/resumePanel via a thin seam (vi.mock of ./panel/suspend.js OR
    inject via exported internal for tests — prefer vi.mock on the S1 module)
```

### Implementation Patterns & Key Details

```ts
// Toggle decision table ([Mode A] JSDoc anchor)
// ┌──────────────────────────────┬───────────────────────────────────────┐
// │ host.isOpen()                │ suspendPanel(host)  → "suspended"     │
// │ host.isSuspended() ∧ open>0  │ resumePanel(pi)     → "resumed"       │
// │ host.isSuspended() ∧ open=0  │ empty-state notify  → "empty"         │
// │ host closed (no/ended state) │ empty-state notify  → "empty"         │
// └──────────────────────────────┴───────────────────────────────────────┘
// CRITICAL: notify ONLY on "empty"; suspend/resume outcomes surface through
// S1's widget/panel mechanics — never notify on success (silent success).
```

### Integration Points

```yaml
REGISTRATIONS:
  - command name: "interrogate" (user-facing /interrogate)
  - shortcut key: config.keys.breakOut (raw value, default ctrl+shift+q)
CONFIG:
  - no new keys; shortcut follows existing keys.breakOut rebind (R5/AC-12)
CONSUMES (S1): suspendPanel, resumePanel from src/panel/suspend.ts
FUTURE (do not implement): P1.M6.T2.S1 reopen:true → resumePanel; P1.M6.T2.S2 discuss → suspendPanel
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx tsc --noEmit                              # Expected: zero errors
npx vitest run src/command.test.ts -v         # after Task 3
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/command.test.ts -v
npx vitest run src/panel/ -v                  # suspend.ts (S1) + host regression
npx vitest run                                # FULL suite green
```

### Level 3: Integration Testing (System Validation)

```bash
# Factory smoke-load: command+shortcut registration must not throw
npx tsc --noEmit && node --input-type=module -e "
import factory from './src/index.ts';
// minimal fake pi: record registerCommand/registerShortcut/registerTool/on
const calls = [];
const pi = new Proxy({}, { get: (_t, k) => {
  if (k === 'on') return () => {};
  if (k === 'registerTool') return () => calls.push('tool');
  return (name: string, def: any) => calls.push([String(k), name]);
}}) as any;
await factory(pi);
console.log('registered:', JSON.stringify(calls));
"
# Expected: includes ['registerCommand','interrogate'] and registerShortcut with ctrl+shift+q
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Manual TUI (optional, part of AC-4 runbook): launch pi with the extension,
# seed questions via /interrogate-debug-upsert, then:
#  1. panel open → ctrl+shift+q anywhere → suspends, widget line appears
#  2. ctrl+shift+q again → resumes on the same question
#  3. /interrogate toggles both directions; /interrogate with no state → toast
# Re-verify ctrl+shift+q is free in the target environment; record in PR notes (h2.34).
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` all green (S1 suspend tests unharmed)
- [ ] Factory smoke-load registers both the command and the shortcut

### Feature Validation

- [ ] Toggle matrix behaves per decision table; exact empty-state string
- [ ] Shortcut key follows config rebind (test-asserted)
- [ ] Non-TUI mode guarded; handlers never throw
- [ ] Double-press idempotent (AC-4 cycle safe)
- [ ] [Mode A] JSDoc on dual registration present in command.ts

### Code Quality Validation

- [ ] Follows debug-commands.ts registration/notify conventions
- [ ] No changes to keys.ts / panel.ts / suspend.ts internals
- [ ] No new global state; toggle reads host phase only

## Anti-Patterns to Avoid

- ❌ Don't reimplement resume/suspend logic — consume S1's suspendPanel/resumePanel
- ❌ Don't register the shortcut with the resolved display label (`Ctrl+Shift+Q`) — raw config value
- ❌ Don't notify on successful suspend/resume — success is visible via the panel/widget
- ❌ Don't branch the shortcut handler on ctx.mode (not documented on that ctx)
- ❌ Don't remove or weaken the in-panel keys.ts breakOut handler
- ❌ Don't parse/act on command args beyond the empty-state notify rule

---

**Confidence Score**: 9/10 — pi API signatures validated against architecture docs, S1 contract pinned via its PRP, existing registration pattern copied directly; residual risk is only naming drift in S1's exports at merge time (mitigated by an explicit gotcha note).

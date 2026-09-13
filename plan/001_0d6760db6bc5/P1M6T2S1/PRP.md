name: "P1.M6.T2.S1 — Wire reopen:true to the resume path"
description: FR-6/Q12 agent-judgment reopen — make the `interrogate({reopen:true})` action actually resume the suspended panel through the SAME lifecycle path as the hotkey (S1's resumePanel), with a confirmation status line, no deterministic guard, and an informative non-TUI no-op. [Mode A] JSDoc on judgment-trusted reopen.
---

## Goal

**Feature Goal**: When the model calls `interrogate({reopen:true})` in a TUI session with existing non-empty interrogation state, the suspended panel resumes through the exact same resume path as ctrl+shift+q / `/interrogate` (S1's `resumePanel` — widget cleared, focus restored to last-focused question, drafts intact). If the panel is already open, it's a no-op ack. In non-TUI modes, the action returns the current read view (informative no-op). There is NO deterministic guard beyond "state exists" — reopen is agent-judgment-trusted (FR-6/Q12); the suspend widget is always visible while suspended so the user is never stranded.

**Deliverable**:
- EDIT `src/tool.ts` — the `reopen` case (currently :241-254): replace the ack-only TUI branch with an invocation of a pluggable resume hook, keeping the result shape (status line + confirmation line + inline envelope). Extend `createInterrogateTool(config, deps?)` with an optional `deps.onReopen` seam (executor stays synchronous, never touches the UI surface itself). [Mode A] JSDoc on the judgment-trusted reopen.
- EDIT `src/index.ts` — pass the `onReopen` hook that closes over `panelHost`: already-open no-op; suspended → `resumePanel` (S1 export); 0-open-questions edge → ack only.
- EDIT `src/tool.test.ts` — new tests for the hook wiring (resume invoked, already-open no-op, empty-open edge, hook-absent default, non-TUI unchanged).

**Success Definition**: `{reopen:true}` while suspended (TUI, open questions > 0) → panel resumes via the same `resumePanel` path as the hotkey, and the tool returns a status-line confirmation (content includes the status line + a confirmation line like `Panel reopened.`). While open → no resume call, ack `Panel already open.` (no throw). No state / non-TUI → informative no-op exactly as today (`throw "no interrogation state to reopen"` / read result). `npx tsc --noEmit` clean, `npx vitest run` fully green including S1's suspend tests and S2's command tests (parallel item — do not touch `src/command.ts`).

## User Persona

**Target User**: pi TUI user who broke out of the panel (esc / ctrl+shift+q) and is working in the editor while the agent continues.
**Use Case**: The agent realizes it needs more answers and reopens the panel at its own judgment.
**User Journey**: agent calls `interrogate({reopen:true})` → widget disappears, panel reappears focused on the question the user was last on, drafts intact → agent receives a one-line confirmation status line.
**Pain Points Addressed**: previously the model believed it reopened the panel ("Panel resurfaced." ack) but nothing actually resumed a suspended panel — the user was stranded in the editor with only a widget hint.

## Why

- h3.10 / FR-6: "The agent may reopen the panel at its judgment via `interrogate({reopen:true})`. No deterministic guard. The suspend widget is always visible while suspended so the user is never stranded." Same resume path as the hotkey (`agent {reopen:true} → same resume path`).
- h2.35: "Resume: `ctrl+shift+q`, `/interrogate`, or agent `{reopen:true}` → fresh panel instance rehydrated from state + drafts (focus restored to last question)."
- AC-4 (break-out/resume cycle) needs the agent-side step; this item is that step's wiring.
- The current tool.ts reopen case is ack-only (comment at :250-252: "the panel host owns the actual resurface") — this item delivers that ownership wiring via a hook that preserves the tool executor's non-blocking invariant (h2.0 §1: synchronous, no UI surface calls).

## What

- **Tool side (`src/tool.ts`)**:
  - Extend `createInterrogateTool(config: InterrogatorConfig, deps?: ToolDeps)` where `ToolDeps = { onReopen?: () => "reopened" | "already-open" | "no-state" }`. Default when absent: behave as today's ack (needed so unit tests of the executor without wiring still pass — but see test task: assert the hook path).
  - In `case "reopen"`:
    - `!existing` → keep the existing `throw new Error("no interrogation state to reopen")` (this is existence, not a deterministic guard — FR-6 bans guards like "only if recently suspended").
    - non-TUI (`isNonTui(ctx.mode, ctx.hasUI)`) → KEEP exactly `return buildReadResult(serialized)` (informative no-op; h2.26).
    - TUI → `const outcome = deps.onReopen?.() ?? "reopened";` then return `{ content: statusLine + "\n" + lineFor(outcome), details: inlineEnvelope(serialized, "reopen", statusLine) }` where `lineFor`: `"reopened"` → `"Panel reopened."`, `"already-open"` → `"Panel already open."`, `"no-state"` → `"No open questions to reopen."`. The hook call is synchronous and fire-and-forget internally (openPanel flips phase synchronously, panel.ts:1174) — the non-blocking invariant holds.
  - [Mode A] JSDoc on the reopen case / `ToolDeps.onReopen`: WHY no deterministic guard (FR-6/Q12 decision — the agent's judgment is the only gate; the always-visible suspend widget is the user's safety net), WHY a hook instead of a direct UI call (executor invariant: no UI surface, sync-only; panel module retains `activePi`/`lastOpts` so the hook needs no surface), and that the hook routes through the SAME `resumePanel` as the hotkey (single resume path, h2.35).
- **Factory wiring (`src/index.ts`)**:
  - After `createPanelHost(lifecycle)` is created (before `pi.registerTool` OR by reordering: create host first, then `pi.registerTool(createInterrogateTool(config, { onReopen: ... }))`), pass:
    ```ts
    onReopen: () => {
      if (panelHost.isOpen()) return "already-open";
      if (panelHost.isSuspended()) {
        const open = getState()?.orderedQuestions().filter(q => q.status === "open").length ?? 0;
        if (open === 0) return "no-state";       // dead panel edge, mirrors S2's empty-state rule
        resumePanel(pi);                          // S1 export, src/panel/suspend.ts
        return "reopened";
      }
      return "no-state";                          // host closed (post-completion) — informative no-op
    }
    ```
  - Use the panel host phase API (`isOpen()`/`isSuspended()`, panel.ts:1099-1100) as the ONLY state source — never read the module-private `phase`.
  - `getState()` from `./state.js` — the existing singleton accessor already imported across the codebase.
  - If S1's export is `resumePanel(pi)` (PiUISurface carrier — the factory's `pi` is an ExtensionAPI which satisfies it, same as S2's command wiring), pass `pi`. If S1 merged with a different name/signature (e.g. host-scoped resume), adapt the call — do NOT reimplement resume logic.
- **Do NOT modify**: `src/command.ts` (S2, parallel — owns the user-side toggle), `src/panel/suspend.ts` internals, `src/panel/panel.ts`, `src/tool-schema.ts` (routing already correct), `src/fallback.ts`, `src/results.ts` (envelope() stays private; inline envelope keeps the documented shape).

### Success Criteria

- [ ] `{reopen:true}` + TUI + suspended host with ≥1 open question → `resumePanel` invoked; result content = status line + `Panel reopened.`; details envelope `action:"reopen"`
- [ ] Panel already open → hook returns no-resume; content includes `Panel already open.`; no throw
- [ ] Suspended with 0 open questions, or host closed → informative ack (`No open questions to reopen.`), no resume, no throw
- [ ] No interrogation state → existing `throw new Error("no interrogation state to reopen")` preserved
- [ ] Non-TUI → unchanged `buildReadResult` result; hook never invoked in non-TUI
- [ ] No deterministic guard added beyond state existence (no recency checks, no epoch checks on reopen)
- [ ] [Mode A] JSDoc present on the judgment-trusted reopen
- [ ] `npx tsc --noEmit` clean; `npx vitest run` all green

## All Needed Context

### Context Completeness Check

An implementer with zero codebase knowledge gets: the exact current reopen-case code and its line anchors, the hook design that preserves the non-blocking invariant, the S1/S2 contracts to consume (with drift-adaptation guidance), the factory wiring seam, exact ack strings, and the test fixture shape. ✅

### Documentation & References

```yaml
- file: src/tool.ts
  why: the reopen case to edit (:241-254), executor invariants (:16-23 header), ctx stub shape (:82-95), createInterrogateTool signature (search "export function createInterrogateTool"), inlineEnvelope usage
  pattern: mirror the record case's TUI/ack structure (:258-270); keep envelope shape exactly
  gotcha: executor must stay SYNCHRONOUS and must never import/call UI surface APIs — the hook pattern exists precisely for this

- file: src/tool-schema.ts
  why: routing already produces {action:"reopen"} for {reopen:true} (:183-186, :312-326) — no schema changes needed
  gotcha: do not touch; S1 contract file (P1.M1.T3.S1)

- file: src/index.ts
  why: factory wiring seam — createInterrogateTool(config) at :48, createPanelHost at ~:104; reorder so host exists before registerTool, then pass deps
  pattern: closure capture of panelHost/config exactly like maybeAutoOpen(pi, config, panelHost, drafts)
  gotcha: pi (ExtensionAPI) is the PiUISurface carrier for resumePanel — same value S2's command handler passes as ctx

- file: src/panel/panel.ts
  why: host phase API isOpen()/isSuspended() (:1099-1100); openPanel no-op-when-open (:1133); internal resume path retaining activePi/lastOpts (:1054-1058) proving a surface-less resume is possible
  pattern: consume phase API only; module-private `phase` is never read directly
  gotcha: openPanel is synchronous fire-and-forget; phase flips synchronously — hook return values are trustworthy

- file: src/panel/suspend.ts  (P1.M6.T1.S1 deliverable — CONTRACT, not yet merged)
  why: resumePanel export this item consumes — widget cleared, lastFocusId restored, no-op when open
  gotcha: if export names/signature drift at merge time, ADAPT the index.ts call — never reimplement resume

- file: plan/001_0d6760db6bc5/P1M6T1S1/PRP.md
  why: full S1 contract (exports, widget rule, focus restore)
- file: plan/001_0d6760db6bc5/P1M6T1S2/PRP.md
  why: parallel S2 contract — its toggle core must remain untouched; also demonstrates the resumePanel(pi) call pattern
- file: plan/001_0d6760db6bc5/P1M6T2S1/research/notes.md
  why: verified line anchors and the hook-vs-UI-call design rationale

- docfile: plan/001_0d6760db6bc5/prd_snapshot.md
  why: h3.10 (FR-6 reopen semantics), h2.35 (resume path unification), h2.20/26 (non-TUI reopen ≡ read)
  section: h3.10, h2.35
```

### Current Codebase tree (relevant excerpt)

```bash
src/
  index.ts            # factory — wiring seam for deps.onReopen
  tool.ts             # executor: reopen case ack-only today (EDIT)
  tool.test.ts        # executor tests; ctx stub {mode, hasUI, model} (EDIT)
  tool-schema.ts      # routing (no change)
  state.ts            # getState() singleton accessor
  panel/
    panel.ts          # PanelHost isOpen/isSuspended; openPanel
    suspend.ts        # S1: suspendPanel/resumePanel (contract)
```

### Desired Codebase tree with files to be added

```bash
src/
  tool.ts             # EDIT: ToolDeps {onReopen}; reopen case invokes hook; Mode A JSDoc
  tool.test.ts        # EDIT: hook-path tests (resume/already-open/no-state/absent-hook/non-TUI)
  index.ts            # EDIT: pass onReopen hook closing over panelHost + pi
  (no new files)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: the tool executor is SYNCHRONOUS and UI-free (h2.0 §1, tool.ts
// header). Never import panel/suspend.js inside tool.ts — the hook is
// injected from index.ts to preserve module boundaries and testability.
// CRITICAL: registerTool call in index.ts must come AFTER createPanelHost so
// the hook closure has a live host — verify ordering when editing.
// CRITICAL: getState() may be undefined pre-first-upsert, but reopen already
// throws on !existing before the hook runs — the hook's getState() call is
// defensive only for the 0-open suspended edge.
// CRITICAL: "no deterministic guard" means NO recency/epoch/cooldown checks.
// State-existence throw is preserved deliberately (matches h2.22 spirit, and
// the current behavior tests assert it).
// Non-TUI branch is already correct — a diff there is a red flag.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/tool.ts — deps seam + reopen case
  - ADD type: export interface ToolDeps { onReopen?: () => "reopened" | "already-open" | "no-state"; }
  - MODIFY createInterrogateTool(config, deps: ToolDeps = {}) — thread deps into executeInterrogate
    (executor already takes config; extend the internal call chain the same way
    config flows today — check how ctx/config reach executeInterrogate and mirror it)
  - REWRITE case "reopen" TUI branch:
      const outcome = deps.onReopen?.() ?? "reopened";
      const line = outcome === "already-open" ? "Panel already open."
                 : outcome === "no-state" ? "No open questions to reopen."
                 : "Panel reopened.";
      return { content: `${statusLine}\n${line}`, details: inlineEnvelope(serialized, "reopen", statusLine) };
  - KEEP: !existing throw; non-TUI buildReadResult branch VERBATIM
  - ADD [Mode A] JSDoc on the reopen case: judgment-trusted (FR-6/Q12 — no
    deterministic guard, widget is the user's safety net), hook-not-UI rationale
    (non-blocking invariant), single resume path shared with the hotkey (h2.35)

Task 2: EDIT src/index.ts — wire the hook
  - REORDER if needed: create panelHost (and lifecycle/drafts) BEFORE pi.registerTool
  - CHANGE registerTool call: pi.registerTool(createInterrogateTool(config, {
      onReopen: () => {
        if (panelHost.isOpen()) return "already-open";
        if (panelHost.isSuspended()) {
          const open = getState()?.orderedQuestions().filter(q => q.status === "open").length ?? 0;
          if (open === 0) return "no-state";
          resumePanel(pi);
          return "reopened";
        }
        return "no-state";
      } }))
  - ADD imports: { getState } from "./state.js"; { resumePanel } from "./panel/suspend.js"
  - PRESERVE: every existing registration (ping, debug commands, lifecycle, maybeAutoOpen,
    and S2's registerInterrogateCommand if already merged — parallel item)

Task 3: EDIT src/tool.test.ts — hook-path tests
  - FOLLOW pattern: existing tool.test.ts fixtures (ctx stub {mode:"tui",hasUI:true,model:{contextWindow}},
    seeded state via applyUpsert/createInterrogationState)
  - TESTS:
    * test_reopen_invokes_resume_hook_when_suspended (TUI + state + hook recorder → hook called once,
      content contains "Panel reopened." and the status line, details.action === "reopen")
    * test_reopen_already_open_ack (hook returns "already-open" → content "Panel already open.", no throw)
    * test_reopen_zero_open_ack (hook "no-state" → "No open questions to reopen.")
    * test_reopen_without_hook_defaults_to_ack (no deps → still returns status line + confirmation, no throw)
    * test_reopen_non_tui_returns_read_result (mode "rpc" → buildReadResult shape, hook NOT invoked)
    * test_reopen_without_state_throws (existing behavior preserved)
  - MOCK: the hook is a plain recorder function — no vi.mock needed at tool level
  - OPTIONAL integration-style test (index-level) only if cheap: skip; S1/S2 suites cover resumePanel itself
```

### Implementation Patterns & Key Details

```ts
// Reopen outcome table ([Mode A] JSDoc anchor)
// ┌──────────────────────────────────────┬──────────────────────────────────────┐
// │ no existing state                    │ throw "no interrogation state ..."   │
// │ non-TUI (any host state)             │ buildReadResult (informative no-op)  │
// │ host open                            │ "already-open" ack, no resume        │
// │ host suspended ∧ open questions > 0  │ resumePanel → "Panel reopened."      │
// │ host suspended ∧ 0 open / closed     │ "No open questions to reopen."       │
// └──────────────────────────────────────┴──────────────────────────────────────┘
// FR-6: NO other guard. No epoch, no cooldown, no "recently used" check —
// agent judgment is the gate; the always-visible suspend widget is the net.
```

### Integration Points

```yaml
REGISTRATIONS:
  - none new; pi.registerTool call signature extended with deps
CONSUMES (S1 contract): resumePanel from src/panel/suspend.ts
CONSUMES (host): panelHost.isOpen()/isSuspended(), getState()
COORDINATES WITH (S2, parallel): src/command.ts toggle — both call resumePanel;
  idempotency is S1's openPanel no-op guard; do not duplicate its logic here
FUTURE (do not implement): P1.M6.T2.S2 discuss-in-chat consumes suspendPanel; AC-4 runbook exercises this path
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx tsc --noEmit                              # Expected: zero errors
npx vitest run src/tool.test.ts -v
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/tool.test.ts -v            # new reopen tests + regression
npx vitest run src/panel/ -v                  # S1 suspend suite unharmed
npx vitest run                                # FULL suite green
```

### Level 3: Integration Testing (System Validation)

```bash
# Factory smoke-load: the reordered registerTool(with deps) must not throw
npx tsc --noEmit && node --input-type=module -e "
import factory from './src/index.ts';
const pi = new Proxy({}, { get: (_t, k) => {
  if (k === 'on') return () => {};
  return () => {};
}}) as any;
await factory(pi);
console.log('factory loaded ok');
"
# Expected: "factory loaded ok"

# Path check (grep-level): index.ts wires onReopen after host creation
grep -n "onReopen" src/index.ts src/tool.ts   # both files present in output
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Manual TUI (AC-4 agent-side step, part of P1.M7.T6 runbook):
# 1. seed questions via /interrogate-debug-upsert → panel opens
# 2. ctrl+shift+q → suspended, widget line visible
# 3. ask the agent (in chat) to call interrogate({reopen:true})
# 4. EXPECT: widget clears, panel resumes focused on the same question, drafts intact
# 5. agent result shows the confirmation status line
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` all green (tool, panel/suspend S1, command S2 suites unharmed)
- [ ] Factory smoke-load passes

### Feature Validation

- [ ] Reopen outcome table fully honored; exact ack strings
- [ ] Resume goes through S1's resumePanel (same path as hotkey), not a reimplementation
- [ ] No deterministic guard added; state-existence throw preserved
- [ ] Non-TUI branch byte-identical in behavior
- [ ] [Mode A] JSDoc present on the judgment-trusted reopen
- [ ] Error cases handled gracefully; executor stays synchronous and UI-free

### Code Quality Validation

- [ ] No changes to tool-schema.ts / suspend.ts / command.ts / panel.ts / results.ts / fallback.ts
- [ ] Hook injected at the factory seam (no panel imports in tool.ts)
- [ ] Naming follows codebase conventions (ToolDeps, snake-free TS interfaces)

## Anti-Patterns to Avoid

- ❌ Don't call resumePanel (or any UI API) from inside tool.ts — inject the hook
- ❌ Don't add an epoch/rev/recency guard to reopen (FR-6 explicitly forbids it)
- ❌ Don't reimplement panel resume logic — consume S1's export, adapt names if drifted
- ❌ Don't touch the non-TUI branch or the parallel item's src/command.ts
- ❌ Don't notify the user on success — the panel appearing IS the feedback
- ❌ Don't make the executor async or fire any floating promise it must await

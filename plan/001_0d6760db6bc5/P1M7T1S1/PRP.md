name: "P1.M7.T1.S1 — Debounced state mirror + shutdown flush"
description: h2.40 storage layer 3 — mirror every InterrogationState mutation into `interrogation-state` custom entries via pi.appendEntry (debounced 2s, flush on session_shutdown). Entries are an append-only audit trail (never rewritten), consumed by reconstruction fallback (S2) and the entry renderer (P1.M7.T3.S2).
---

## Goal

**Feature Goal**: Implement storage layer 3 of the three-layer persistence model (h2.40): every in-memory state mutation is mirrored into `interrogation-state` custom entries. On any mutation, a 2-second debounce window starts (or resets); when it elapses, `pi.appendEntry("interrogation-state", { state, epoch, at })` appends the latest snapshot. On `session_shutdown` (any reason), a pending debounce flushes immediately. Entries accumulate — they are NEVER edited, deduplicated, or removed.

**Deliverable**:
- CREATE `src/persistence.ts` — `createStateMirror(pi, opts)` returning a small controller (`flush()`, `dispose()`), plus the `interrogation-state` customType constant and payload type.
- CREATE `src/persistence.test.ts` — vitest suite with fake timers proving debounce coalescing, latest-wins payload, shutdown flush, no-flush-when-idle, append-only behavior.
- EDIT `src/index.ts` — instantiate the mirror once in the factory, subscribe it to the state's `changed` event, register the `session_shutdown` flush handler, and dispose on extension teardown if a teardown seam exists.

**Success Definition**: `npx vitest run src/persistence.test.ts` green; full `npx vitest run` green; `npx tsc --noEmit` clean. A burst of N mutations within 2s produces exactly ONE appended entry containing the final state. `session_shutdown` with a pending debounce appends immediately before shutdown completes. Idle session (no mutations) appends nothing. The mirror never mutates the state, never throws into the host (appendEntry failures are caught and logged/warned, never fatal).

## User Persona

**Target User**: pi user whose long interrogation session undergoes context compaction or restart.
**Use Case**: Compaction drops the tool-result entry that carried canonical `details.state` (h2.40 layer 2). Reconstruction (S2) then falls back to the latest `interrogation-state` entry on the branch (this module's output) so answers are never lost.
**User Journey**: agent upserts/answers questions → mirror appends snapshot ~2s after the last change → user quits/compacts → on restart or post-compaction refresh, S2 replays the newest mirror entry.
**Pain Points Addressed**: silent loss of all interrogation answers when compaction drops the canonical tool result (Q37 residue the three-layer design exists for).

## Why

- h2.40 layer 3 is the *explicitly required* fallback layer: "debounced (2s) appendEntry on mutation; not in model context; fallback when compaction drops the tool-result entry."
- h2.16 event table: `session_shutdown` → "flush mirror entry" — this item owns that subscription.
- FR-27 (h3.4): state "mirrored to `interrogation-state` custom entries on mutation (debounced)."
- Downstream contract: P1.M7.T1.S2 reconstruction reads these entries via `ctx.sessionManager.getEntries()`; P1.M7.T3.S2 registers the entry renderer for the same customType.

## What

- **Custom type**: constant `INTERROGATION_STATE_ENTRY_TYPE = "interrogation-state"` exported from `src/persistence.ts` (single source of truth; S2 and M7.T3.S2 import it — never hardcode the string elsewhere).
- **Entry payload** (exact shape, S2 depends on it):
  ```ts
  interface InterrogationStateEntryData {
    state: SerializedState;   // state.serialize() output, verbatim
    epoch: number;            // copy of state.epoch at flush time (redundant with state.epoch — cheap sanity check for S2)
    at: string;               // ISO 8601 timestamp of the FLUSH moment (not the mutation)
  }
  ```
- **Debounce**: leading-edge OFF, trailing-edge only — listen to the state's `changed` event (payload is the full `SerializedState`); each event stores the latest snapshot and (re)starts a 2000ms timer. Timer fire → appendEntry → clear pending snapshot. Subsequent mutations start a NEW window; entries are appended per window (audit trail).
- **Shutdown flush**: `pi.on("session_shutdown", ...)` — if a debounce is pending, append immediately (cancel the timer). Reasons `quit|reload|new|resume|fork` all flush identically (the next session's reconstruction may need it on any of them).
- **Append-only**: no API ever removes or rewrites entries. `dispose()` only clears the timer + unsubscribes.
- **Failure isolation**: wrap `appendEntry` in try/catch; on failure, notify nothing user-visible (a missing mirror entry is a degraded fallback, not an error state) — record via `console.error`/debug only. Never let mirror failure break a mutation path.
- **[Mode A] JSDoc**: the module header documents the THREE storage layers verbatim from h2.40 (in-memory authoritative / tool-result details canonical / custom entries mirror-fallback) and why the mirror exists (compaction residue, Q37).
- **Do NOT implement here**: reconstruction (S2), entry renderer (M7.T3.S2), compaction instructions (M7.T2.S1). Only the mirror + flush.

### Success Criteria

- [ ] Mutation burst within 2s → exactly one entry with the LAST state.
- [ ] Mutations spaced >2s apart → one entry per window.
- [ ] `session_shutdown` flushes a pending entry synchronously before returning.
- [ ] No `appendEntry` call when no mutation occurred since last flush.
- [ ] Mirror never throws into the `changed` emitter or shutdown handler.
- [ ] customType string imported by consumers via the exported constant.

## All Needed Context

### Context Completeness Check

Validated: implementer needs only `src/state.ts` (event/type surface), `src/index.ts` (wiring point), the pi API facts below, and vitest fake-timer patterns already used in this repo.

### Documentation & References

```yaml
- url: https://github.com/earendil-works/pi-coding-agent (installed: node_modules/@earendil-works/pi-coding-agent)
  why: pi ExtensionAPI surface — appendEntry and session_shutdown are verified in dist/core/extensions/types.d.ts
  critical: >
    pi.appendEntry(customType, data) creates a custom entry NOT in LLM context; user-visible
    via entry renderer; restorable via ctx.sessionManager.getEntries()/getBranch()
    (architecture/pi-api-validation.md:49). session_shutdown event: `event.reason:
    "quit"|"reload"|"new"|"resume"|"fork"` (pi-api-validation.md:35; types.d.ts:479 area).
    Handlers registered via pi.on("session_shutdown", (event, ctx) => void).

- file: src/state.ts
  why: >
    Source of `SerializedState`, `StateEvents` ("changed" carries the full serialized
    post-mutation state at line ~141), `serialize()` (deep-copies via structuredClone),
    and module-level `getState()` / state reset semantics (state is never cached across
    session_shutdown, lines ~204/556 — mirror subscriptions are per-factory, matching
    that lifetime).
  pattern: subscribe via state.on("changed", (s: SerializedState) => ...) — payload IS the snapshot; do not call serialize() again.
  gotcha: EventEmitter emits synchronously inside mutation methods — the mirror handler must be cheap (just store + restart timer) so it never slows mutations.

- file: src/index.ts
  why: wiring point. Factory `interrogatorExtension(pi)` already holds config, lifecycle,
    panelHost, and the shared state. Add the mirror AFTER getState-consuming setup, near
    the lifecycle block.
  pattern: follow existing `pi.on("tool_execution_start", ...)` registration style.
  gotcha: only ONE mirror instance per extension activation; the state object itself is
    module-singleton via getState() in state.ts — confirm by reading how tool.ts/lifecycle.ts obtain it.

- file: src/lifecycle.ts
  why: existing pi.on subscription pattern (tool_execution_start/end, agent_settled) and
    its test file's fake-pi approach.
  pattern: src/lifecycle.test.ts builds a minimal fake `pi` with an `on()` recorder — reuse that style for persistence.test.ts.
  gotcha: session_shutdown handler return value is ignored (non-blocking event) — flush must be synchronous.

- docfile: plan/001_0d6760db6bc5/architecture/pi-api-validation.md
  why: §Messaging (lines 49-51) — appendEntry semantics, sessionManager.getEntries/getBranch
    (what S2 will use to read these entries back); line 35 — shutdown reasons.
  section: Messaging / API quirks

- file: src/draft-store.ts
  why: parallel example of a factory-held, lifetime-scoped helper + its vitest suite; ALSO a
    boundary marker — persistence must NOT serialize drafts (Q6=B, index.ts comment).
```

### Current Codebase tree (relevant slice)

```bash
src/
  index.ts            # factory — wiring point for the mirror
  state.ts            # InterrogationState, SerializedState, "changed" event
  lifecycle.ts(.test) # existing pi.on subscription + fake-pi test pattern
  draft-store.ts      # NOT persisted (boundary)
  tool.ts             # produces canonical details.state (layer 2 — untouched here)
  panel/ ...
```

### Desired Codebase tree

```bash
src/
  persistence.ts       # NEW — mirror controller, entry type constant, payload type, [Mode A] JSDoc
  persistence.test.ts  # NEW — vitest fake-timer suite
  index.ts             # EDITED — wire mirror into factory (~5 lines + comment)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: vitest fake timers — existing suites (e.g. lifecycle.test.ts) use
// vi.useFakeTimers(); advance with vi.advanceTimersByTime(2000). Debounce must use
// setTimeout (fake-timer controllable), NOT pi scheduling.
// CRITICAL: appendEntry is fire-and-forget from the mirror's perspective; wrap in
// try/catch — a session in a weird state must not crash shutdown.
// GOTCHA: the "changed" payload is already a structuredClone'd snapshot (state.ts:214
// comment) — safe to hold across the debounce window without further copying.
// GOTCHA: shutdown handler must flush SYNCHRONOUSLY (no awaits) — the process may
// exit right after the event.
// DO NOT: cache state across session_shutdown (h2.43/state.ts:556) — the mirror's
// pending-snapshot slot is cleared after every flush, which is consistent.
// DO NOT: persist drafts, snapshots ring, or anything beyond serialize() output.
```

## Implementation Blueprint

### Data models and structure

```ts
// src/persistence.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { InterrogationState, SerializedState } from "./state.js";

export const INTERROGATION_STATE_ENTRY_TYPE = "interrogation-state";

export interface InterrogationStateEntryData {
  state: SerializedState;
  epoch: number;
  at: string;
}

export interface StateMirror {
  /** Immediate flush if a debounce is pending (used by session_shutdown). */
  flush(): void;
  /** Cancel timer + unsubscribe from state events. */
  dispose(): void;
}

export function createStateMirror(
  pi: ExtensionAPI,
  state: InterrogationState,
  opts: { debounceMs?: number } = {},
): StateMirror;
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/persistence.ts
  - IMPLEMENT: INTERROGATION_STATE_ENTRY_TYPE, InterrogationStateEntryData, StateMirror, createStateMirror
  - LOGIC: state.on("changed", s => { pending = s; restart timer(debounceMs ?? 2000) });
           timer fire / flush(): if pending, pi.appendEntry(TYPE, { state: pending, epoch: pending.epoch, at: new Date().toISOString() }); pending = undefined;
           flush() also clearTimeout. try/catch around appendEntry.
  - NAMING: createStateMirror, flush, dispose; snake-case-free, matches repo style.
  - PLACEMENT: src/persistence.ts, JSDoc [Mode A] documenting the three h2.40 layers.
  - DEPENDENCIES: types from ./state.js only. NO imports of panel/tool/lifecycle.

Task 2: CREATE src/persistence.test.ts
  - IMPLEMENT: fake pi ({ appendEntry: vi.fn(), on: vi.fn() recorder }); real InterrogationState from state.ts driven by upsert/answer mutations; vi.useFakeTimers.
  - CASES: (a) 3 mutations <2s → one appendEntry with final state, at/epoch correct;
    (b) mutations 2.5s apart → two entries (audit accumulation);
    (c) pending debounce + flush() → immediate append, timer cancelled (advance timers → no second append);
    (d) no mutations → no appendEntry ever, even after long timer advance;
    (e) appendEntry throws → caught, no unhandled rejection, subsequent windows still work;
    (f) dispose() → no further appends even after mutations + timer advance.
  - FOLLOW pattern: src/lifecycle.test.ts fake-pi construction.
  - PLACEMENT: alongside persistence.ts.

Task 3: EDIT src/index.ts
  - INTEGRATE: after lifecycle creation (state is the module singleton obtained the same
    way tool.ts obtains it — check state.ts getState() export), add:
      const mirror = createStateMirror(pi, state);
      pi.on("session_shutdown", () => mirror.flush());
  - FIND pattern: existing pi.on(...) registrations in this factory.
  - PRESERVE: everything else; keep the edit minimal (~5 lines + h2.40 comment).
  - NOTE: no pi teardown/dispose hook exists in the current factory — dispose() stays
    available but unused unless an extension dispose seam exists; document that.

Task 4: RUN gates
  - npx tsc --noEmit; npx vitest run; npx vitest run src/persistence.test.ts
```

### Implementation Patterns & Key Details

```ts
// Core debounce (trailing-edge, latest-wins)
state.on("changed", (s: SerializedState) => {
  pending = s;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => flush(), debounceMs);
});

// Synchronous shutdown flush — no awaits
function flush(): void {
  if (timer) { clearTimeout(timer); timer = undefined; }
  if (!pending) return;
  const data: InterrogationStateEntryData = {
    state: pending, epoch: pending.epoch, at: new Date().toISOString(),
  };
  try { pi.appendEntry(INTERROGATION_STATE_ENTRY_TYPE, data); }
  catch (err) { console.error("interrogator: state mirror append failed", err); }
  pending = undefined;
}
```

### Integration Points

```yaml
EVENTS:
  - pi.on("session_shutdown", () => mirror.flush())  # all reasons; flush is reason-agnostic
STATE:
  - state.on("changed", ...) inside createStateMirror  # subscription owned by the mirror
DOWNSTREAM CONTRACTS (do not implement here):
  - P1.M7.T1.S2 reads entries: ctx.sessionManager.getEntries() filtered by INTERROGATION_STATE_ENTRY_TYPE, take LAST per branch.
  - P1.M7.T3.S2 registers pi.registerEntryRenderer(INTERROGATION_STATE_ENTRY_TYPE, ...).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npx tsc --noEmit          # repo has no ruff; tsc + vitest are the gates
```

### Level 2: Unit Tests

```bash
npx vitest run src/persistence.test.ts -v
npx vitest run            # full suite — must stay green (state/tool/lifecycle untouched)
```

### Level 3: Integration (manual smoke, optional but recommended)

```bash
# Load the extension in a real pi TUI session; run a debug upsert:
#   /interrogate-debug-upsert ...
# wait >2s, quit pi; relaunch with the same session and confirm (via a temporary
# debug print or S2 when it lands) that an interrogation-state entry exists.
# Not scriptable pre-S2 — record findings in plan/.../P1M7T1S1/research/ if performed.
```

### Level 4: Domain validation

- Confirm no entry is appended for draft edits (drafts bypass state mutations by design).
- Confirm entries survive on the branch after /fork and /resume (appendEntry + sessionManager guarantee; cite pi-api-validation.md:49).

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` fully green
- [ ] persistence.test.ts covers all 6 cases in Task 2

### Feature Validation

- [ ] Burst → single latest-state entry; spaced mutations → accumulating entries
- [ ] session_shutdown flush synchronous and reason-agnostic
- [ ] appendEntry failures non-fatal
- [ ] Payload shape `{ state, epoch, at }` exactly as specified (S2 contract)
- [ ] customType exported constant used everywhere

### Code Quality Validation

- [ ] [Mode A] JSDoc documenting the three h2.40 storage layers
- [ ] No imports beyond state.ts types + pi types in persistence.ts
- [ ] No drafts/snapshot-ring serialization
- [ ] index.ts edit minimal and additive

## Anti-Patterns to Avoid

- ❌ Don't call `state.serialize()` in the handler — the `changed` payload already is the snapshot.
- ❌ Don't dedupe/rewrite/limit entries — the audit trail accumulates by design.
- ❌ Don't await anything in the shutdown flush.
- ❌ Don't create the mirror per-panel-open — one per extension activation.
- ❌ Don't let the mirror write to state or UI (layer 3 is write-only w.r.t. state).

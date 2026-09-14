name: "P1.M7.T1.S2 — Reconstruction on session_start + session_tree, auto-open"
description: h2.41/h2.43/h3.11 — rebuild InterrogationState from the current branch's entries (latest `interrogate` tool-result details.state → replay interrogation-submission deltas → fallback to newest `interrogation-state` mirror entry), recompute moot-ness, auto-open panel (TUI) or mark fallback active (non-TUI), no drafts restored (FR-28). Runs on BOTH `session_start` and `session_tree` (branch navigation mid-session).
---

## Goal

**Feature Goal**: Implement reconstruction exactly per h2.41: on `session_start` (and `session_tree`, per h2.43 branch-relativity), walk `ctx.sessionManager.getBranch()` (the RAW branch — compaction NOT applied, so compacted-away tool results are still reachable), find the base state, replay subsequent submission deltas, recompute dependsOn moot-ness, and auto-open the panel (TUI) or mark the non-TUI fallback active. Never cache state across `session_shutdown`.

**Deliverable**:
- CREATE `src/reconstruct.ts` — `reconstructFromBranch(pi, ctx): ReconstructResult` pure-ish function plus `createReconstruction(pi)` wiring helper; module fallback flag accessors (`isFallbackActive()`, `clearFallbackActive()`); `[Mode A]` JSDoc documenting the full algorithm including session_tree.
- CREATE `src/reconstruct.test.ts` — vitest suite with a fake `ctx.sessionManager.getBranch()` returning synthesized `SessionEntry[]` arrays covering: tool-result base, mirror-entry fallback, delta replay, both-absent, ordering/priority, session_tree re-run.
- EDIT `src/index.ts` — subscribe `session_start` and `session_tree` to the reconstruction coordinator; reset state via existing `resetState()` before each reconstruction.

**Success Definition**: `npx vitest run src/reconstruct.test.ts` green; full `npx vitest run` green; `npx tsc --noEmit` clean. A branch whose latest interrogate tool result carries `details.state` plus two later `interrogation-submission` custom messages reconstructs a state with those answers applied, moot-ness recomputed, and (TUI) the panel auto-opened via the existing resume path with NO drafts. A branch with only mirror entries falls back to the newest one. An empty/foreign branch yields no state and no panel. AC-9 (panel reopens with questions/answers; drafts gone) passes.

## User Persona

**Target User**: pi user who restarts pi, resumes a saved session, or navigates the session tree (`/tree`, `/fork`, `/resume`) mid-interrogation.
**Use Case**: Long interrogation, user quits; relaunches with `pi --resume`. Expectation (FR-28): the panel reopens with all questions/answers as they were on that branch — only in-progress drafts are lost.
**User Journey**: session_start fires → extension walks the raw branch → state installed → TUI panel auto-opens restored / non-TUI fallback flag set → user continues answering.
**Pain Points Addressed**: total loss of interrogation progress on restart/branch-switch (the Q37 residue problem the three-layer storage exists for).

## Why

- h2.16 event table: `session_start` → "reconstruct state; auto-open panel (FR-28)".
- h2.43: reconstruction is branch-relative — `session_tree` (branch navigation) fires mid-session, not just at start; forked/resumed sessions inherit exactly the questions/answers visible on that branch.
- h3.11 restart/resume flow names this module's algorithm verbatim.
- FR-28: auto-open on start with open questions (TUI); drafts not restored (documented limitation, Q6=B — index.ts already comments this).

## What

- **Base selection priority** (scan `getBranch()` — RAW branch, NOT `buildContextEntries()`, so compaction does not hide the tool result; note h2.41's pseudocode says buildContextEntries but the item contract and pi semantics mandate `getBranch()` — document this in the JSDoc):
  1. LAST `message` entry with `role === "toolResult"` && `toolName === "interrogate"` && `msg.details?.state` → `base = details.state` (layer 2 canonical, FR-27).
  2. Else scan `custom` entries with `customType === INTERROGATION_STATE_ENTRY_TYPE` (import the constant from `src/persistence.ts`, P1.M7.T1.S1 contract) NEWEST-FIRST → `base = entry.data.state` (layer 3 mirror fallback).
  3. Else: no state; call `resetState()`; done (no panel, no fallback flag).
- **Delta replay**: all `custom` entries with `customType === "interrogation-submission"` that appear on the branch AFTER the base entry (or from branch start when base came from a mirror entry, only accept ones with `details.epoch > base.epoch`): apply `details.changed` and `details.epoch` onto the base. See Gotchas — DiffEntry carries label summaries, not raw values; the replay is best-effort (status `answered` + summary as value) and the mirror entry (which carries the full `SerializedState`) usually supersedes it on restart.
- **Non-empty check**: if the reconstructed state has ANY question with status ∈ {open, reasked, answered, submitted, moot, withdrawn} (i.e., `orderedQuestions().length > 0` per h2.41's non-empty set):
  - `ctx.mode === "tui"` → auto-open panel via the EXISTING resume path (`resumePanel(ctx)` from `src/panel/suspend.ts`, or `openPanel(ctx, {config, state, drafts})` when no panel context exists yet — mirror `maybeAutoOpen`'s pattern in src/panel/panel.ts:1312). NO drafts restored (FR-28, Q6=B) — a FRESH `DraftStore` is acceptable since the factory's store is empty at session start anyway.
  - else → `setFallbackActive(true)` (non-TUI digest mode for the next tool call).
- **Moot recompute**: run `evaluateDependsOn(state)` (src/depends-on.ts:160) — cheap, idempotent (its own header says so).
- **Install**: `resetState()` then `setState(InterrogationState.deserialize(base))` (both exported from src/state.ts:554-570 — the docstring explicitly says this seam is for P1.M7.T1.S2). Replay deltas via the installed state's mutation methods so `changed` fires and the S1 mirror picks the reconstruction up (mirror then appends a fresh entry — harmless audit append).
- **session_tree**: same function, subscribed to `pi.on("session_tree", ...)`. The handler's `ctx.sessionManager` reflects the NEW leaf already (event fires after navigation). Old in-memory state is discarded — branch-relativity means the destination branch's history is the only truth. Also fire it on `session_start` for all reasons (`startup|reload|new|resume|fork`).
- **Never cache across session_shutdown**: reconstruction re-runs from entries every time; `resetState()` at the top of every run guarantees it.
- **Do NOT implement here**: the mirror itself (S1 owns persistence.ts), compaction instructions (M7.T2.S1), entry renderers (M7.T3).

### Success Criteria

- [ ] Tool-result base beats mirror entry even if the mirror entry is newer? NO — priority is: LAST interrogate tool result on the branch first (canonical FR-27); mirror only when absent. (Test both orders.)
- [ ] Mirror fallback picks the NEWEST `interrogation-state` entry on the branch.
- [ ] Submission deltas after the base are applied; deltas at/below base epoch ignored.
- [ ] Non-TUI mode → fallback active, no panel call attempted.
- [ ] TUI mode + non-empty question set → panel opens through the existing host path.
- [ ] `evaluateDependsOn` runs exactly once per reconstruction; idempotent (second call is a no-op).
- [ ] Empty branch / no interrogation traces → state cleared, no panel, no fallback flag.

## All Needed Context

### Context Completeness Check

Validated: implementer needs state.ts seams, persistence.ts contract (S1 PRP), delivery.ts entry shapes, panel resume path, and the pi entry-shape facts below.

### Documentation & References

```yaml
- file: examples/todo extension inside pi (node_modules/@earendil-works/pi-coding-agent/examples/.../todo.ts)
  why: THE canonical reconstruction pattern — todo.ts:110-127 `reconstructState(ctx)` iterates
    ctx.sessionManager.getBranch(), filters entry.type === "message", msg.role === "toolResult",
    msg.toolName === "todo", reads msg.details. Follow this loop shape exactly for base selection.
  pattern: for..of over getBranch(); type-narrow entries; apply in order.
  gotcha: getBranch() returns RAW branch entries — compaction is NOT applied — so a compacted-away
    interrogate tool result is still found here even though it left the LLM context.

- file: src/state.ts
  why: getState/setState/resetState seams (lines ~545-570) were built for THIS item; also
    `InterrogationState.deserialize(data: unknown)` (line ~429, tolerant of untrusted input),
    `applyAnswer(id, {value, at})` (line 339), `setStatus`, `bumpEpoch`, `orderedQuestions()`,
    `serialize()`. setState/reconstruct triggers `changed` only via real mutations.
  gotcha: resetState() BEFORE setState, never reuse a prior InterrogationState object.

- file: src/persistence.ts (P1.M7.T1.S1 — treat as implemented contract)
  why: import `INTERROGATION_STATE_ENTRY_TYPE` ("interrogation-state") and the
    `InterrogationStateEntryData` payload type `{ state: SerializedState; epoch: number; at: string }`.
    Mirror entries land via pi.appendEntry; read them back as custom SessionEntries with
    `customType` matching the constant, `data` matching the payload.
  gotcha: NEVER hardcode "interrogation-state" in reconstruct.ts.

- file: src/delivery.ts
  why: SubmissionMessage shape (line ~61): customType "interrogation-submission", details
    `{ changed: DiffEntry[]; note?; epoch: number; card: SubmissionCardData }`. Replay consumes
    details.changed + details.epoch. Also "interrogation-completion" exists — IGNORE it here.
  gotcha: DiffEntry (src/snapshots.ts:41) is `{id, title, from, to, editedArchived}` where
    from/to are label-preferred DISPLAY SUMMARIES, not raw answer values. Replay therefore
    applies `applyAnswer(id, { value: to, at: entry-derived timestamp })` as a best-effort
    approximation — acceptable because on real restarts the mirror/tool-result base already
    contains the true values; deltas only cover the gap AFTER the base. Document this in JSDoc.

- file: src/depends-on.ts
  why: `evaluateDependsOn(state): MootEvaluation` (line 160) — run once post-replay; idempotent,
    mutates via setStatus("moot") with h2.29 reasons.

- file: src/panel/suspend.ts + src/panel/panel.ts (maybeAutoOpen, line 1312; resumePanel via suspend.ts:119)
  why: auto-open reuses existing paths — do NOT invent a new opening mechanism.
    In the reconstruction handler, `ctx` IS a PiUISurface (same adaptation as every other panel
    entry point per index.ts's resumeSurface comment). Prefer openPanel(ctx, {config, state, drafts})
    when the host is closed (fresh session start), or resumePanel(ctx) when suspended.
  gotcha: panel no-ops when already open (openPanel idempotency is S1's concern — rely on it).

- file: src/fallback.ts
  why: non-TUI mode detection `isNonTui(mode, hasUI)` (line 57). The "mark fallback active"
    flag is NEW in this item: export isFallbackActive()/setFallbackActive() from reconstruct.ts;
    consumed later by the tool executor's digest decision (h2.26) — document the contract.

- url: pi types (installed): node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts
  why: SessionStartEvent (line 416: reason "startup"|"reload"|"new"|"resume"|"fork"),
    SessionTreeEvent (line ~500: {newLeafId, oldLeafId, summaryEntry?}); handlers receive
    (event, ctx: ExtensionContext) where ctx.sessionManager is ReadonlySessionManager with
    getBranch(fromId?) (session-manager.d.ts:140/262). Entry shape: { type: "message", message: {...} }
    or { type: "custom", customType, data, display? }.
  critical: session_tree fires AFTER navigation — getBranch() already reflects the new leaf;
    do not use event.newLeafId to filter, just walk ctx's branch.

- docfile: plan/001_0d6760db6bc5/P1M7T1S1/PRP.md
  why: the mirror contract this item consumes (payload shape, append-only audit trail).
```

### Current Codebase tree (relevant slice)

```bash
src/
  index.ts            # factory — add session_start + session_tree subscriptions
  state.ts            # getState/setState/resetState, deserialize, applyAnswer, orderedQuestions
  persistence.ts      # (S1) INTERROGATION_STATE_ENTRY_TYPE, mirror — read-only import
  delivery.ts         # interrogation-submission custom entry shape (details.changed/epoch)
  depends-on.ts       # evaluateDependsOn
  fallback.ts         # isNonTui
  panel/panel.ts      # openPanel, maybeAutoOpen pattern (PiUISurface = ctx)
  panel/suspend.ts    # resumePanel(pi)
```

### Desired Codebase tree

```bash
src/
  reconstruct.ts       # NEW — algorithm, fallback flag, [Mode A] JSDoc (incl. session_tree, raw-branch rationale)
  reconstruct.test.ts  # NEW — vitest suite over fake SessionEntry[] branches
  index.ts             # EDITED — createReconstruction wiring (~10 lines)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: use ctx.sessionManager.getBranch() (RAW) not buildContextEntries() —
// compaction must NOT hide the canonical tool result. h2.41's pseudocode says
// buildContextEntries(); the item contract overrides this; document the decision.
// CRITICAL: DiffEntry.to is a display summary, not a raw value — replay is
// best-effort; the base usually already carries true values.
// GOTCHA: deserialize() is tolerant of untrusted input — wrap in try/catch; on
// failure, fall through to the next candidate (mirror entry) rather than crashing session_start.
// GOTCHA: toolResult messages: entry.type === "message" && entry.message.role === "toolResult"
//   (todo.ts pattern); custom entries: entry.type === "custom".
// GOTCHA: reconstruction via setState does NOT emit "changed"; only real mutations
//   (applyAnswer/setStatus/evaluateDependsOn) do — so the S1 mirror appends only when
//   replay actually changed something. Fine either way.
// DO NOT: restore drafts (Q6=B, FR-28) — do not touch DraftStore contents.
// DO NOT: subscribe to session_shutdown here for caching purposes — resetState() at the
//   START of each reconstruction guarantees no cross-shutdown caching (h2.43).
// DO NOT: attempt panel opens when ctx.mode !== "tui" — ctx.ui may be absent headless.
```

## Implementation Blueprint

### Data models and structure

```ts
// src/reconstruct.ts
import { INTERROGATION_STATE_ENTRY_TYPE, type InterrogationStateEntryData } from "./persistence.js";

export interface ReconstructResult {
  /** Where the base state came from. */
  source: "tool-result" | "mirror-entry" | "none";
  /** Number of submission deltas replayed after the base. */
  replayed: number;
  /** Whether the panel auto-open path ran (TUI + non-empty). */
  opened: boolean;
  /** Whether the non-TUI fallback flag was set. */
  fallbackActive: boolean;
}

let fallbackActive = false;
export function isFallbackActive(): boolean;
export function setFallbackActive(v: boolean): void;

export function reconstructFromBranch(pi, ctx, opts: { config; host: PanelHost }): ReconstructResult;
export function createReconstruction(pi, opts): void; // subscribes session_start + session_tree
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/reconstruct.ts
  - IMPLEMENT: [Mode A] module JSDoc (algorithm incl. session_tree, raw-branch choice, delta
    best-effort caveat, FR-28 drafts limitation); reconstructFromBranch; flag accessors; createReconstruction.
  - LOGIC: resetState() → walk getBranch(): collect last interrogate toolResult details.state
    (entry.message.toolName === "interrogate" && details?.state), all custom entries by customType.
    Base = tool-result state if found, else newest mirror-entry .data.state (deserialize via
    InterrogationState.deserialize, try/catch → next candidate). If no base → return source "none".
    setState(state). Replay submissions after base index (or epoch > base.epoch for mirror base):
    for each details.changed entry with a known question id → state.applyAnswer(id, {value: e.to,
    at: now}); then state.bumpEpoch() if any applied. evaluateDependsOn(state).
    Non-empty check via state.orderedQuestions().length > 0 → if ctx.mode === "tui": openPanel
    (host closed) / resumePanel (host suspended) using ctx as PiUISurface; else setFallbackActive(true).
  - PLACEMENT: src/reconstruct.ts; imports limited to state/persistence/delivery-types/depends-on/panel paths.
  - GOTCHA: never mutate DraftStore; never cache across runs.

Task 2: CREATE src/reconstruct.test.ts
  - IMPLEMENT: fake ctx { sessionManager: { getBranch: () => entries }, mode } with hand-built
    SessionEntry arrays; fake pi ({ on: vi.fn() }) or directly call reconstructFromBranch.
  - CASES: (a) tool-result base + 2 subsequent submissions → answers applied, epoch bumped once,
    evaluateDependsOn called; (b) tool result AFTER submissions is last → base wins, zero replay;
    (c) no tool result, 2 mirror entries → newest used; (d) nothing interrogation-related →
    source "none", state undefined, no panel/fallback; (e) non-TUI mode → fallbackActive true,
    no open call; (f) TUI + non-empty → open/resume called once; (g) corrupt details.state →
    try/catch falls through to mirror; (h) createReconstruction subscribes BOTH session_start
    and session_tree (assert pi.on calls).
  - FOLLOW pattern: fake-pi construction in src/lifecycle.test.ts; entry fixtures modeled on
    delivery.ts SubmissionMessage and persistence payload.
  - NAMING: test_reconstruct_* style matching repo (describe/it, kebab file names already used).

Task 3: EDIT src/index.ts
  - INTEGRATE: after the panelHost/drafts block (post maybeAutoOpen), add:
      createReconstruction(pi, { config, host: panelHost });
    passing the same shared config + panelHost closure values.
  - PRESERVE: all existing registrations; minimal additive edit.

Task 4: RUN gates
  - npx tsc --noEmit; npx vitest run; npx vitest run src/reconstruct.test.ts
```

### Implementation Patterns & Key Details

```ts
// Base scan (todo.ts:110-127 pattern, adapted)
let base: SerializedState | undefined;
const submissions: Array<{ details: SubmissionMessage["details"]; afterBase: boolean }> = [];
for (const entry of ctx.sessionManager.getBranch()) {
  if (entry.type === "message" && entry.message.role === "toolResult"
      && entry.message.toolName === "interrogate") {
    const d = entry.message.details as { state?: unknown } | undefined;
    if (d?.state) { base = d.state as SerializedState; submissions.length = 0; } // last wins
  } else if (entry.type === "custom" && entry.customType === "interrogation-submission") {
    submissions.push({ details: entry.data.details, afterBase: base !== undefined });
  }
}
// Mirror fallback only when base === undefined: scan custom entries with
// customType === INTERROGATION_STATE_ENTRY_TYPE newest-first, InterrogationState.deserialize
// in try/catch; submissions then filtered by details.epoch > base.epoch.

// Replay — best-effort (DiffEntry.to is a display summary)
state.applyAnswer(e.id, { value: e.to, at: new Date().toISOString() }); // unknown ids skipped
if (applied > 0) state.bumpEpoch(); // one bump per replayed submission (h3.6)
```

### Integration Points

```yaml
EVENTS:
  - pi.on("session_start", handler)   # all reasons; handler ignores event fields, walks ctx branch
  - pi.on("session_tree", handler)    # post-navigation; ctx branch already reflects new leaf
STATE:
  - resetState()/setState() from state.ts (purpose-built seams)
PANEL:
  - openPanel(ctx, { config, state, drafts }) / resumePanel(ctx) — existing paths only
FALLBACK FLAG:
  - isFallbackActive() consumed later by tool executor digest decision (h2.26) — export contract documented
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npx tsc --noEmit
```

### Level 2: Unit Tests

```bash
npx vitest run src/reconstruct.test.ts -v
npx vitest run
```

### Level 3: Integration (manual smoke — record in research/)

```bash
# In a real pi TUI: /interrogate-debug-upsert a question, answer+submit, quit,
# relaunch resuming the session → panel should auto-open with the question set,
# answers intact, drafts empty (FR-28). Then /tree to an earlier branch → panel
# reflects that branch's state (or closes if no interrogation there).
```

### Level 4: Domain validation

- Verify compacted sessions: after a /compact, the tool result may leave LLM context but must STILL be found via getBranch() (raw) — assert in a test by simulating an entry list; real-compaction smoke optional.
- Verify AC-9 checklist wording: panel reopens with questions/answers; drafts gone.

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` clean; `npx vitest run` fully green
- [ ] All 8 test cases in Task 2 present and passing

### Feature Validation

- [ ] Base priority: last interrogate tool-result > newest mirror entry > none
- [ ] Deltas after base replayed; epoch handling correct; moot-ness recomputed once
- [ ] TUI auto-open via existing panel path, no drafts; non-TUI sets fallback flag
- [ ] session_tree triggers the same reconstruction (branch-relative, h2.43)
- [ ] No cross-shutdown caching (resetState at run start)

### Code Quality Validation

- [ ] [Mode A] JSDoc covering algorithm, session_tree, raw-branch decision, delta approximation caveat
- [ ] INTERROGATION_STATE_ENTRY_TYPE imported, never hardcoded
- [ ] index.ts edit minimal and additive; existing registrations untouched

## Anti-Patterns to Avoid

- ❌ Don't use buildContextEntries() — it applies compaction and can hide the canonical state.
- ❌ Don't restore or even read drafts (Q6=B, FR-28).
- ❌ Don't open the panel directly via ctx.ui.custom — reuse openPanel/resumePanel.
- ❌ Don't let a malformed entry crash session_start — every deserialize/details access guarded.
- ❌ Don't cache the reconstructed state or the fallback flag across session_shutdown.
- ❌ Don't duplicate mirror logic — persistence.ts owns writing; this module only reads.

# Research notes — P1.M4.T1.S2 (bugfix): command.ts toggle + index.ts onReopen use the resumable predicate

## Verified anchors (live code)

### src/command.ts — interrogateToggleAction suspended branch (lines ~79–88)
```ts
if (host.isSuspended()) {
  const open = state?.orderedQuestions().filter((q) => q.status === "open").length ?? 0;
  if (open === 0) return "empty";
  resumePanel(pi);
  return "resumed";
}
```
Signature: `(host: PanelHost, pi: PiUISurface, state: InterrogationState | undefined)` — state already passed. The branch comment ("dead panel… h2.37 edge") must be REWRITTEN (it documents the buggy open-only rule).
Type `InterrogateToggleOutcome = "suspended" | "resumed" | "empty"` unchanged.

### src/index.ts — onReopen hook (lines ~169–178)
```ts
onReopen: () => {
  if (panelHost.isOpen()) return "already-open";
  if (panelHost.isSuspended()) {
    const open = getState()?.orderedQuestions().filter((q) => q.status === "open").length ?? 0;
    if (open === 0 || resumeSurface === undefined) return "no-state";
    resumePanel(resumeSurface);
    return "reopened";
  }
  return "no-state";
}
```
CRITICAL: keep the `resumeSurface === undefined` half of the guard — unrelated to BUG-005, drop only the `open === 0` half. `ReopenOutcome` = "reopened" | "already-open" | "no-state" (tool.ts line ~112). Executor maps no-state → result line "No open questions to reopen." (tool.ts:343) — unchanged.

### src/panel/panel.ts — resumeOpenPanel (lines ~1339–1354)
Restores `lastFocusId` only when the question's status is in `ACTIVE_STATUSES` (line 214: `["open","answered","submitted","reasked"]`), else falls back to first-active. With the S1 contract, ACTIVE_STATUSES is imported from suspend.ts as RESUMABLE_STATUSES — resumeOpenPanel is ALREADY compatible with an all-answered suspended panel (focus falls to the first answered question). No panel.ts changes needed.

### Existing tests that assert the BUGGY behavior (must FLIP)
- src/command.test.ts "interrogateToggleAction — decision table" (line 238): Row 3 builds an answered-only state (`applyAnswer("q1", …)`) and asserts `'empty'` — this is the exact BUG-005 repro. After the fix it must assert `'resumed'`. A separate dead-panel row (terminal-only or cleared state → 'empty') must be kept/added for the negative case.
- Decision table conventions: `createPanelHost(makeMockLifecycle().lifecycle)`, `openOnSurface(state)`, `makeSurfacePi()`, `createInterrogationState("goal")`, `choiceQ("q1")`, `resetState()`/`setState()` helpers, `vi.clearAllMocks()`.
- src/tool.test.ts `describe("executeInterrogate: reopen")` (line 459): injects `onReopen` mock — the host-side hook is index.ts's; tests for the hook itself live where the index wiring is tested. Check whether an index-level test exists exercising onReopen (search src/index.test.ts / panel.test.ts for resumeOpenPanel/panelHost.isSuspended harnesses) and extend it with the answered-only → "reopened" row.
- applyAnswer seeds status "answered" (state.ts) — no need for setStatus gymnastics for the repro.

### S1 contract (parallel, treat as landed)
src/panel/suspend.ts exports `hasResumableQuestions(state: InterrogationState): boolean` and `RESUMABLE_STATUSES` (["open","answered","submitted","reasked"]). Single-definition grep gate (array literal only in suspend.ts). clearForCompletion empties the state map → predicate false → 'empty'/'no-state' remain correct.

### Semantics guard (FR-6 / h2.22 Issue-5)
The reopen path must gain NO recency/epoch/deterministic guard — this is purely "does live state exist" plumbing, keying on the four non-terminal statuses. Terminal statuses (moot/withdrawn/closed) and post-completion cleared state stay dead.

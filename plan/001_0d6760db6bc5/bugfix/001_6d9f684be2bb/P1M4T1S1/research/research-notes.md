# Research Notes — Bugfix P1.M4.T1.S1: Shared resumable predicate + suspend-widget visibility (BUG-005, part 1 of 2)

## Verified code anchors

- `src/panel/suspend.ts`
  - `countStatuses` (lines 42–54): buckets `open` (status "open" only) and `answered` ("answered" only).
  - `buildSuspendWidgetLine` (~line 71): `"${open} open · ${answered} answered — ${labels.breakOut} to resume /interrogate"` — exact-string contract; labels from `resolveKeyLabels(config).breakOut`; separators U+00B7 and U+2014.
  - `updateSuspendWidget` (lines ~99–111): `setWidget.call(pi.ui, WIDGET_KEY, open > 0 ? [line] : undefined)` — THE open-only gate to replace; no-op when `pi.ui.setWidget === undefined` (test fakes / RPC).
  - Module docstring documents the panel.ts ⇄ suspend.ts import cycle is safe (bindings only touched inside function bodies) — hoisting a const here and importing it into panel.ts keeps that property (const string-array init at module scope, no cross-module call at eval time).
- `src/panel/panel.ts` line 214: `const ACTIVE_STATUSES: readonly string[] = ["open","answered","submitted","reasked"];` — module-private, used at lines 1107 and 1345 for resume-focus. One-definition rule: hoist to suspend.ts, panel.ts imports it.
- The three open-only clones (BUG-005 report):
  - `src/command.ts` ~line 82: `state?.orderedQuestions().filter((q) => q.status === "open").length ?? 0` → `open === 0 → return "empty"` (inside `host.isSuspended()` branch).
  - `src/index.ts` ~line 173: same filter in `onReopen` → `open === 0 → "no-state"`.
  - `src/panel/suspend.ts` ~line 105: the widget visibility ternary.
  - THIS task fixes the suspend.ts clone only (widget + exported predicate); S2 (P1.M4.T1.S2) rewires command.ts + index.ts onto the predicate.
- `src/state.ts`: `QuestionStatus` (line 22), `orderedQuestions()`, `applyAnswer` (status "answered"), `clearForCompletion` empties the map → predicate false → "empty" stays correct after completion.
- Test conventions — `src/panel/suspend.test.ts`: `makeState(open, answered)` builds a real InterrogationState via raw primitives; `MockPi` interface + `makeMockPi()` fake surface capturing `setWidget` calls (`firstCall(mock)` helper); exact-string assertions on the widget line. Existing test `test_updateSuspendWidget_sets_line_then_clears_at_zero_open` (line 204) asserts the OLD open-only rule for all-answered → must be UPDATED (makeState(0, N) now shows the widget; makeState(0,0)/cleared state clears it).
- Post-`clearForCompletion`: map empty → `orderedQuestions()` = [] → predicate false → widget absent. Submitted/reasked also count as resumable (they're mid-flight, not terminal). moot/withdrawn/closed are terminal → NOT resumable.
- PRD anchors: bugfix PRD Issue 5 (h3.4) + h2.5 recommendation: "Treat 'answered-pending' as resumable: resume/`reopen:true`/widget visibility should key on active statuses (open/answered/submitted/reasked), not open-only."
- Parallel contract (P1.M3.T3.S2, tool.ts evaluateDependsOn after applyUpsert): orthogonal — no overlap; this task must not touch tool.ts.

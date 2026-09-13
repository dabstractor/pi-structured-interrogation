# Research — P1.M5.T2.S1 Overview list

Key findings (verified by direct file reads):

- **panel.ts**: `PanelView` already includes `"overview"`; `buildLines` has a placeholder `["[overview] placeholder (TODO M5.T2)"]` branch; `setView` exists; `deepSticky` bookkeeping done; `cursorIndex` re-seeded by `currentId` setter; `scrollOffset` field exists (deep); note mode branch renders view-agnostically first (overview must defer when `focus === "note"`).
- **keys.ts**: `onOverview` toggle already correct (`view === "overview" ? deepSticky?deep:short : overview`). `escapeDescend` handles overview → deepSticky?deep:short. Resolution order: 1 up/down, 2 esc, 3 enter, 4 config intercepts, digits. Step 4 `prevQuestion`/`nextQuestion` calls `panelActions.prev/nextQuestion` — in overview these must reroute to cursor movement (contract: "cursor up/down (or config question nav keys)").
- **layout.ts**: `ScreenKind` includes `"overview"`; `SCREEN_KEYS.overview = ["submit", "deep"]`; footer appends "enter jump · esc back" for overview — footer READY, no changes needed. `renderHeader(snapshot, theme, width)` reusable. `statusMarkers(q, theme)` exists but has wrong vocabulary for overview (no `·`/`★ answered`, uses `q.answer?.text` for moot reason).
- **short-view.ts**: `mootReason(q)` helper (falls back "dependency changed" off `q.answer?.value`); constants INSET/CURSOR/BLANK pattern; `initialCursorIndex`. NOTE: layout.ts's statusMarkers reads `q.answer?.text` for the moot reason; depends-on.ts writes h2.29-format reasons ("moot: storage=sqlite"). Prefer a reason helper reading `q.answer?.text ?? q.answer?.value ?? "dependency changed"`.
- **state.ts**: `Question` has `group?: string`, `gate?: boolean`, `status`, `answer`. `orderedQuestions()`, `groupSummaries()` (GroupSummary per group, first-appearance order, UNGROUPED_LABEL = "(none)") exist. Statuses: open/answered/submitted/reasked/moot/withdrawn/closed.
- **actions.ts**: `nextUnanswered` exported; `prevQuestion/nextQuestion` = clamped ±1 over orderedQuestions, no filtering (R1).
- **config.ts**: `KeyAction "overview"` = ctrl+l default; `digitQuickSelect` config exists.
- **tests**: panel.test.ts, keys.test.ts, short-view.test.ts colocated vitest patterns; `npx tsc --noEmit` + `npx vitest run` are the gates.
- **Parallel P1.M5.T1.S1 (deep view)** also edits keys.ts step 1/3 with view gating for `"deep"` — combine conditions; it also adds a note-focus gate check. Both PRPs agree keys edits must be surgical, order preserved.
- Marker semantics (h2.29): `·` open, `★` answered, `⟳` re-asked, `⊘` moot (+reason, dimmed), `⊗` withdrawn, `✎` has text answer; group headers; gate group marked `▲`.

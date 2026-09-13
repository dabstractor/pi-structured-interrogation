# Research notes — P1.M5.T1.S1 (deep view)

## Codebase facts verified

- `src/panel/panel.ts`:
  - `PanelView = "short" | "deep" | "overview"` already exists; `deepSticky` and `scrollOffset` fields already exist on `InterrogationPanel` (scrollOffset currently placeholder).
  - `buildLines(width)` deep branch is a placeholder: `["[deep] placeholder (TODO M5.T1)", ...]` — full replacement target.
  - Short view renders header (renderHeader from serialize()), question line, hint, options, editor, flash, footer. Deep view per h2.29 replaces EVERYTHING between header and footer.
  - `handleInput` order: resolved guard → two-stage enter stages → `this.keys(data, this)` router → textField forward.
  - Fresh panel instance on reopen resets deepSticky + scrollOffset (h2.29 sticky-per-session).
- `src/panel/keys.ts` (P1.M3.T3.S1):
  - Router resolution order: 1. fixed up/down → `actions.optionUp/optionDown` (currently always option-cursor); 2. esc → `escapeDescend` (deep→short already correct, does NOT clear deepSticky); 3. fixed enter (options focus) → `actions.accept` (currently short-view accept regardless of view); 4. config intercepts (deep toggle already wired via `onDeep` with deepSticky bookkeeping).
  - This task must make steps 1 and 3 view-aware: when `panel.view === "deep"`, up/down scroll the pane and enter selects the highlighted option from deep.
- `src/panel/short-view.ts`: pure renderer pattern `(input) => string[]`; marker vocabulary `▸` cursor, `★` recommendation; `INSET = "  "`; uses `truncateVisible`/`visibleWidth` from layout.ts. Deep view reuses ★/▸ style.
- `src/panel/layout.ts` exports: `truncateVisible`, `visibleWidth` (re-export from pi-tui), `firstSentence`, `renderHeader(state: SerializedState, theme, width) → {line, ...}`, `renderFooter(state, view, labels, theme, width)` (already view-aware — takes `PanelView`), `renderQuestionLine`, `renderHintLine`, `SCREEN_KEYS` (footer keys per screen — check whether `deep` entry exists).
- `src/panel/actions.ts`: `accept` is short-view-only (cursorIndex domain). `acceptOptionIndex` is private; ripple seam + applyAnswer + `advanceAfterAccept` is the commit path. `nextUnanswered` is exported. For select-from-deep we need a new exported action or a deep-specific accept that reuses the same commit semantics (ripple seam on answered/submitted, applyAnswer, advance, return to short view).
- `src/state.ts`: `Question` has `description?: string`, `options?: QuestionOption[]` with `label`, `value`, `ramification?: string`, `recommendation?`; `state.goal` readonly, full text; `serialize()` includes goal.
- `src/config.ts`: `KeyAction` includes `"deep"`; `caps.maxRamificationChars` default 600 exists (h2.23 caps engine truncates tool INPUT — deep view rendering cap is separate, h2.51 row 2: cap lines + ellipsize). Need a `deepViewHeight` cap constant (config or module default).
- Tests: colocated `*.test.ts` with vitest; panel tests use mock theme `{fg: (c,s)=>s}`-style and fake TUI `{requestRender: vi.fn()}`. See `src/panel/panel.test.ts`, `keys.test.ts`, `short-view.test.ts` patterns.
- P1.M4.T2.S2 PRP (batch note) is parallel; it touches `onBatchNote` seam in keys.ts defaultRoutedActions and panel note focus — deep view must not conflict; it doesn't (batch note is note-focus, orthogonal to view routing). Conflicts to avoid in keys.ts: don't reorder existing steps; only gate steps 1/3 by view.

## Spec anchors (PRD)

- h2.29: deep view = full replacement between header and footer; full description on top; each option as sticky section header `▸ sqlite` followed by ramification text wrapped; ↑/↓ scroll (bounded); highlight + enter selects → returns to short AND advances (Q14); sticky while panel open.
- FR-8, FR-16 (esc descends deep→short, never destroys), FR-30 (goal full text shown in deep view).
- h2.51 row 2: rendering risk — cap + ellipsize; overview is the escape hatch.
- h2.30: width <60 → ramifications wrap; <24 rows hint suppressed (fallbacks mostly M7.T5, but wrapping is inherent to deep rendering).
- Q19/Q20 merged: ONE deep toggle (already wired in keys.ts `onDeep`).

## Design decisions for the PRP

1. New module `src/panel/deep-view.ts`: pure renderer + scroll/selection model (like short-view.ts). No pi imports beyond Theme type.
2. Sticky headers: pi-tui has no native sticky; emulate via scroll algorithm — the viewport is a line window over flattened content lines; when the highlighted option's header scrolls above the window, clamp offset so the header (or a pinned clone) stays at/near the top of the viewport. Selection = index over option sections; up/down move selection (and scroll to keep header+first ramification lines visible), NOT question navigation. Scrolling beyond selection: allow free scroll within [0, contentLen - viewportH], with selection clamped into view.
3. Enter in deep view: exported `acceptFromDeep(panel)` in deep-view.ts (or actions re-export) that reuses ripple-confirm semantics + `state.applyAnswer` + advance + `panel.setView("short")` — deepSticky stays true (sticky per session).
4. keys.ts changes minimal + view-gated: step 1 up/down and step 3 enter dispatch to deep handlers when `panel.view === "deep"`; esc ladder unchanged; all config intercepts unchanged.
5. Goal full text: rendered at top of deep pane (FR-30) under the header, wrapped, dimmed.
6. Height budget: `deepViewHeight` default 20 lines (module constant or config.caps-adjacent); ramification text wrapped via a visibleWidth-aware word-wrap helper; per-line truncation fallback with `…`.

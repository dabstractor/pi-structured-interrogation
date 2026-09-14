# Research notes — BUG-011 fix: gate ctrl+t focusText on short view

## Defect location (verified)
- `src/panel/keys.ts:354-357`: the intercept block
  ```ts
  if (matchesKey(data, b.focusText)) {
    actions.onFocusText(panel);
    return true;
  }
  ```
  runs in EVERY view. Contrast: `b.externalEditor` gate two blocks later
  (`panel.focus === "text" && ...`, keys.ts:366-369) and the digit quick-select gate
  (~keys.ts:384-389: `panel.view !== "overview" && focus !== text/note`).
- `src/panel/panel.ts` `focusTextField()` (lines 800-822, called via the seam refined at
  panel.ts:483 `routed.onFocusText = (p) => p.focusTextField()`): sets `this.focus = "text"`,
  focuses + seeds the editor, invalidates. `buildLines` renders the TextField only in the
  short view and note-mode branches — in deep/overview the editor never draws, so ctrl+t
  there = invisible focus, blind typing, silent stage-1 draft saves (BUG-011 repro).
- Types: `PanelView = "short" | "deep" | "overview"`, `PanelFocus = "options" | "text" | "note"`
  (panel.ts ~95/98). `makePanel` stub in keys.test.ts accepts `view` override, default
  `"short"` (keys.test.ts:62-68).

## Fix shape
- Narrow ONLY the focusText intercept: `panel.view === "short" && matchesKey(data, b.focusText)`.
  In deep/overview, ctrl+t falls through to normal panel handling (arrows scroll/navigate;
  enter = overviewJump/acceptFromDeep per the comment at keys.ts:330-338).
- Defensive case: focus already `"text"` while view ≠ short is unreachable in practice
  (entering deep/overview from short-text blurs first; esc from short-text returns to options
  before descending). The gate makes it moot anyway — ctrl+t in a non-short view no longer
  reaches onFocusText at all.
- DO NOT gate `b.batchNote` (ctrl+shift+m): note mode is deliberately view-agnostic
  (panel.ts:978 comment) — note mode overlays from any view. Scope = focusText only.
- DO NOT gate `b.deep`/`b.overview`/`b.submit` etc. — those are intentionally valid in all
  views including focus === "text" (h2.34 intercept rule, keys.ts:348-349 comment).

## Test conventions
- keys.test.ts: `makeRouter(config, actions)`, `route(data, panel)`, `makeActions()` returns
  spied RoutedActions; line 284 asserts ctrl+t dispatches when focus already "text" (default
  view short — stays green). Existing test "intercepts in every view including text focus"
  uses default view short; our new cases add `view: "deep"` / `view: "overview"` panels
  asserting onFocusText is NOT called and route returns false (falls through).
- `DEFAULT_DATA.focusText` = "\u0014" (ctrl+t), config key `focusText` default "ctrl+t"
  (config.ts / keys.test.ts:31).

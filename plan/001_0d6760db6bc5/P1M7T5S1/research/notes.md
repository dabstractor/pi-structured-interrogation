# Research notes — P1.M7.T5.S1 Adaptive rendering (h2.30)

## Height discovery (pi-api-validation.md §Unknown 2 — RESOLVED)

`custom()` factory gives the component a live `TUI` object. From
`node_modules/@earendil-works/pi-tui/dist/tui.d.ts`:

- `TuiBase` (what `tui` is) has public field `terminal: Terminal`.
- `Terminal` (terminal.d.ts) exposes `get rows(): number` and `get columns(): number`.
- The TUI re-renders on terminal resize (Terminal.start(onInput, onResize)), so
  reading `this.tui.terminal.rows` **inside render(width)** picks up resizes
  with zero new event plumbing. Width comes in as `render(width)`; height must
  be read from `tui.terminal.rows` each render.

`src/panel/panel.ts` already stores `this.tui` (line ~440) and caches render
output keyed only on width (`render(width)` at ~line 505). The cache must be
invalidated when rows change too (add `lastRows` to the cache key), otherwise
a resize from 30→10 rows keeps serving the tall cached render.

## Current render budget architecture

- `src/panel/layout.ts` — PURE renderers: header, question line, hint line
  (`renderHintLine`, returns `[]` when no description — the natural
  suppression hook), footer (`renderFooter` with right-to-left hint dropping).
- `src/panel/short-view.ts` — options region; labels already truncate via
  `truncateVisible` at `width - 2` budget.
- `src/panel/deep-view.ts` — `DEEP_VIEW_HEIGHT = 20` content lines, sticky
  headers, ramifications wrapped (word-wrap helper inside module).
- `src/panel/overview.ts` — `OVERVIEW_HEIGHT = 20` window; both module JSDoc
  headers explicitly say "P1.M7.T5.S1 owns any dynamic sizing" — the seam was
  designed for this task. `buildOverviewContent` takes no height param today;
  callers use `content.viewportHeight` (constant). Need an optional
  `viewportHeight` override param (default OVERVIEW_HEIGHT).
- `src/panel/panel.ts buildLines(width)` (~line 937) — the composition point:
  note → short → deep → overview branches; hint line emitted at line ~967.

## Footer narrow rule gap

h2.30: width < 60 → footer shows max 2 keys: `submit`, `deep`. Current
`renderFooter` drops hints RIGHT-TO-LEFT; `SCREEN_KEYS.short = ["deep",
"overview", "submit"]` + unshifted "enter accept" means submit is dropped
FIRST — the existing degradation produces the wrong two keys. Need an explicit
narrow branch that filters to exactly `{submit, deep}` (using config labels)
before the fit loop.

## Test patterns

- `src/panel/panel.test.ts` (1528 lines) constructs `InterrogationPanel`
  directly with a mock tui — extend the mock with `terminal: { rows, columns }`
  (type-only import of TUI means structural typing; adding a plain object
  works if the test tui stub is a partial).
- Pure-renderer tests live next to each module (layout.test.ts etc.) — pure
  threshold function tests follow the same style (vitest-style? check:
  project uses `node --test`-style? panel tests use `test(...)` from
  `node:test` — verify in layout.test.ts before writing).

## Out of scope (guard against)

- P1.M7.T4.S1 (parallel): `src/detect.ts` plain-text round detection — do not
  touch.
- P1.M7.T5.S2: config surface validation — remap keys stays in
  resolveKeyLabels; this task only READS labels.

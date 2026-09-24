# Research — P3.M2.T2.S1 (flip reconstruction/ac-panel opened rows + rewrite AC-9)

## Authoritative flip ledger
`plan/002_949db554a811/architecture/surfacing-remote-seams.md` §"Test-flip ledger" (:137–151) maps
every row BEFORE→AFTER:

| Row | File:line (assert) | Before | After |
|---|---|---|---|
| `tool-result base beats everything; deltas after it replay (a)` | reconstruct.test.ts :178/:204 | `opened:true` + custom once | `opened:false`, widget-set, no custom |
| `no tool result → newest mirror entry wins (c)` | :242/:260 | `opened:true` | `opened:false`; state assertions unchanged |
| `suspended host reopens … (f — session-start origin)` | :354/:370 | `opened:true` + custom once | `opened:false`; host stays suspended; drafts untouched |
| AC-9a | ac-panel.test.ts :849/:866 | `opened:true`, custom×1, `host.isOpen()` | `opened:false`, widget line set, no custom, host NOT open |
| AC-9b | :884 | `opened:true` | `opened:false` |
| AC-9c | :902 | custom called on session_start | no `ui.custom`; widget line + resume-only |
| AC-10 | :970/:1062 | `read.opened:true` | `false` |
| wiring test `subscribes BOTH …` | reconstruct.test.ts :523ff | start path asserts custom×1 | start side flips to no-open + widget (tree side already silent) |

## Key code facts verified
- `src/reconstruct.ts` after P3.M2.T1.S1 (contract): session-start TUI block calls
  `updateSuspendWidget(ctx, state)` and returns `{ source, replayed, opened: false, fallbackActive: false }`;
  no `openPanel` import remains. `onRestored?.(state)` still fires BEFORE the widget set.
- `src/panel/suspend.ts`: `updateSuspendWidget(pi, state)` → `ui.setWidget("interrogator", [line])` when
  `hasResumableQuestions(state)` else `setWidget("interrogator", undefined)` (clear). **NO-OP if the
  surface lacks `ui.setWidget`** — the test fakes must implement `setWidget` for the widget assertions.
- `buildSuspendWidgetLine`: `` `${n} open · ${m} answered — /interrogate to resume` `` — n = status
  "open" only, m = status "answered" only; exact separators ` · ` and ` — `.
- **reconstruct.test.ts `makeCtx` (local helper, ~:831) has `ui: { custom }` ONLY** — flipped rows need
  `setWidget: vi.fn()` added to that fake (and possibly exposed for assertions).
- **ac-panel.test.ts `makeCtx` (AC-9/AC-10 local, ~:839) also has only `custom`** — the rich
  `makeMockPi` (~:202) already records `setWidget`; but the AC-9 tests use the simple `makeCtx`.
  AC-10's readCtx (~:1045) likewise needs `setWidget`.
- Widget assertion pattern (AC-4, ac-panel.test.ts :722): read `mock.setWidget.mock.calls.at(-1)`,
  expect key `"interrogator"` and line contents/regex.
- Reopen seam: `resumeOpenPanel(pi: PiUISurface): boolean` (src/panel/panel.ts:1791) — the
  `/interrogate` closed-host-with-live-state path; ac-panel.test.ts:735 shows usage
  (`expect(resumeOpenPanel(mock.pi)).toBe(true)` then a second `custom` call).
- Auto-submit: `maybeAutoSubmit(panel, deps?)` (src/panel/actions.ts:604), already wired after every
  commit (P2.M1.T1.S1, Complete). AC-9's pending-ship clause can be proven state-level: reconstructed
  answered questions keep `status:"answered"` (pending) → next commit fires the submission; the
  mechanism itself is AC-2c's domain — cite, don't rebuild.
- ac-panel.test.ts header results table (:13–26): AC-9 row currently says "reconstruction auto-opens
  (FR-28)" — must be rewritten to the SURFACE-002 wording; describe title at :761 likewise.
- AC-9 PRD wording (h2.10 #9): restart → NO panel (SURFACE-002); widget shows live counts;
  `/interrogate` reopens with questions/answers restored (any status mix); drafts gone (documented —
  assert empty); pending answers ship on next commit or submit (AUTOSUBMIT-001).
- DraftStore: `new DraftStore()`, `getDraft(id)`, `setDraft(id, text)` — AC-9a already asserts
  drafts-gone via `for (const q of …) expect(drafts.getDraft(q.id)).toBeUndefined()` — keep.
- P3.M2.T1.S1 PRP Task 4 expects these rows failing post-implementation; this item makes them green.
- Sibling P3.M1.T3S1 owns tree-nav-repro flips — do NOT touch that file or ac-scripted.test.ts.
- Vitest: `npx vitest run <file>`; typecheck `npm run typecheck`.

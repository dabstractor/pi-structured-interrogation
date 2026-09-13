# P1.M6.T2.S1 research notes — agent reopen:true → resume path

## Current code state (verified)

- `src/tool-schema.ts:183-186,312-326` — action routing already exists: `{reopen:true}` (no answers, no questions) → `{action:"reopen"}`.
- `src/tool.ts:241-254` — the `reopen` case:
  - `!existing` → `throw new Error("no interrogation state to reopen")`.
  - non-TUI (`isNonTui(ctx.mode, ctx.hasUI)`) → returns `buildReadResult(serialized)` (informative no-op). ALREADY CORRECT — do not change.
  - TUI → returns ack `{content: statusLine + "\nPanel resurfaced.", details: inlineEnvelope(...)}` but does NOT actually resume anything. Comment says "the panel host owns the actual resurface" — that wiring is THIS item.
- Non-blocking invariant (tool.ts header, h2.0 §1): executor is synchronous, never opens the panel, never calls UI surface. So the resume must happen via a hook invoked by the executor (still synchronous — `openPanel` is a synchronous fire-and-forget `custom()` per panel.ts:1131, phase flips synchronously at :1174).
- `src/panel/panel.ts:1027-1078` — module-private `phase`; `activePi` + `lastOpts` captured at last `openPanel`; `:1054` shows a resume path exists internally: `phase==="suspended" && activePi && lastOpts` → `openPanel(activePi, {...})`. `openPanel` returns `false` if already open (`:1133`) — natural no-op guard.
- `src/panel/panel.ts:1092-1100` — `createPanelHost(lifecycle)` exposes `isOpen()`/`isSuspended()`.
- P1.M6.T1.S1 (contract, suspend.ts not yet merged at research time): will export `suspendPanel(host)` and `resumePanel(pi: PiUISurface): boolean` from `src/panel/suspend.ts`; widget cleared first, focus restored to `lastFocusId`, no-op when open. Adapt import names at merge if they drift.
- P1.M6.T1.S2 (parallel, contract): `src/command.ts` toggle core uses host phase + `resumePanel`. It consumes the same S1 exports; no overlap with tool-side reopen wiring.
- `src/index.ts:48-110` — factory: `createInterrogateTool(config)` registered at :48; panelHost + maybeAutoOpen at the end. The wiring seam goes here.
- `src/tool.test.ts` — tests stub `{ mode, hasUI, model:{contextWindow} }` as ctx (tool.ts:88-95). Follow its fixture/expectation patterns.

## Design decision (hook, not direct UI call)

The tool executor has no `PiUISurface` and must not. The panel module already retains `activePi`/`lastOpts` from the last open, so a resume can be triggered without a new surface. Cleanest seam respecting module ownership:

- `createInterrogateTool(config, deps?)` gains optional `deps.onReopen?: () => ReopenOutcome` (or exported `setReopenHook`). The reopen case calls it and includes a confirmation status line in the result content regardless.
- `index.ts` wires it after `createPanelHost`: hook = TUI-open check (`panelHost.isOpen()` → "already-open" no-op) else `resumePanel(...)`; empty-state (0 open questions) → no-op ack.
- Non-TUI branch stays exactly as-is (read result). No deterministic guard beyond state-existence (FR-6/Q12: judgment trusted, NO guard).

Result content per contract: tool execute returns a confirmation status line; keep/extend the existing "Panel resurfaced." style line, e.g. `statusLine + "\nPanel reopened."` / `"...already open"` / non-TUI unchanged.

## Validation commands (verified working shapes)

- `npx tsc --noEmit`
- `npx vitest run src/tool.test.ts -v` ; `npx vitest run` full suite

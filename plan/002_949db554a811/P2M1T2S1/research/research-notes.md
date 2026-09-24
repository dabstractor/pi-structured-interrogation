# P2.M1.T2.S1 research — commit-time gate-hold line (AUTOSUBMIT-002)

## Seams audited (function-name anchored; lines drift)

- `src/panel/gate.ts`
  - `gateWarningLine(count)` (:94): legacy submit-time warning — `⚠ {n} foundational unanswered — later answers may shift`. KEEP unchanged.
  - `countUnansweredGate(ordered, gateGroupNames(ordered))` (:79): the count helper. Note its "unanswered" = `q.answer === undefined && status !== withdrawn/moot` — subtly different from completeness's open/reasked statuses, but per PRD the completeness rule already withholds when a gate question is unanswered-and-open; the count is display-only.
- `src/panel/panel.ts`
  - `gateWarning: { count: number } | null` field (:457) — non-expiring, any-key dismiss via handleInput stage 0 (:749-751 clears + continues processing, "dismiss + act").
  - `footerNoticeLine(width)` (:1179): renders gateWarning via `renderGateWarningLine(gateWarningLine(count), theme, width)`; wins over flash; suppressed in confirmMode.
  - `this.labels = resolveKeyLabels(args.config)` (:612) — `this.labels.submit` is the config-resolved label (e.g. "Ctrl+Enter").
- `src/panel/actions.ts`
  - `submit()` sets `panel.gateWarning = { count: unansweredGate }` (:509-511) only when `config.gateWarnings` on and n>0 — legacy ctrl+s-partial path. KEEP.
  - P2.M1.T1.S1 adds `maybeAutoSubmit(panel, deps?)` right after submit(): completeness predicate (zero open/reasked + ≥1 answered) → `submit()` + flash `submitted — {n} answer(s)`. THIS item wraps the firing decision with the gate check.
- `src/panel/layout.ts` `renderGateWarningLine(text, theme, width)` (:115) — presentation wrapper, text-agnostic. Reusable for the new string.
- `src/config.ts` `resolveKeyLabels(config)` (:449) — key labels; guard regex flags hardcoded `ctrl+[a-z0-9]` anywhere in non-test src, comments stripped → the hold line MUST interpolate the label, never a literal "ctrl+s".
- Tests homes: `src/panel/gate.test.ts`, `src/panel/actions.test.ts` (seed/makePanel/makeDeps :74/:100/:117), `src/panel/panel.test.ts` (:1957 legacy string assertions), `src/panel/layout.test.ts` (:440), `src/config-surface.test.ts` (:461 — check whether it calls gateWarningLine directly; if it asserts the legacy string it stays valid since gateWarningLine keeps its signature).

## Design decision

Extend `panel.gateWarning` payload with a kind discriminator rather than a second field (one shared non-expiring notice slot, stage-0 dismissal reused verbatim):

```ts
gateWarning:
  | { count: number; kind: "submit" }              // legacy (gate.ts:94 string)
  | { count: number; kind: "hold"; submitLabel: string } // NEW commit-time line
  | null
```

`submit()` continues to set `{ count, kind: "submit" }` (or bare count defaulted); `maybeAutoSubmit` sets the hold variant when gate unanswered → withhold submit + no flash. `footerNoticeLine` picks the string by kind; hold string interpolates `submitLabel`. ctrl+s override works for free: user presses submit → submit() runs unchanged, overwrites gateWarning with the legacy kind after delivery.

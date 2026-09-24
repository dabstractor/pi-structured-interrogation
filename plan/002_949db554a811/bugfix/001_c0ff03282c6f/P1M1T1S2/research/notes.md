# Research — P1.M1.T1.S2 (bugfix wave 1): pin gate-hold inheritance across commit entry points

Verified against working tree (1224 tests) + architecture/bug-001-gate-hold.md.

## S1 contract (previous PRP, in flight)
maybeAutoSubmit reordered: gate-hold `n > 0 && pending > 0` check runs BEFORE the completeness return; arms
`panel.gateWarning = {count:n, kind:"hold", submitLabel:panel.labels.submit}` (guarded by config.gateWarnings + invalidate), returns without submit/flash. S1's tests cover the direct maybeAutoSubmit call only — S2 pins that the OTHER entry points inherit it.

## All maybeAutoSubmit call sites (grep verified)
- src/panel/actions.ts:251 — accept() commit tail
- src/panel/actions.ts:311 — writeInEnter direct-commit exit
- src/panel/ripple-confirm.ts:160 and :304 — APPLIED ripple-edit commit tails (option edit / write-in edit; both end "maybeAutoSubmit as the last call, like any other commit" per h2.33 comment)
- src/remote-submit.ts:165 (nothing_shippable path) and :181 (shipped path) — via `deps.maybeAutoSubmit?.()` tail hook
- src/remote-bridge.ts:350 — passes `opts.maybeAutoSubmit` into remote-submit deps
- src/index.ts:107–109 — late-binding wiring: `maybeAutoSubmit: () => { const panel = panelHost.getPanel(); if (panel) maybeAutoSubmit(panel); }`

No other call sites; no commit path bypasses maybeAutoSubmit (accept/ripple/bridge all end in it). Grep gate: `rg -n "maybeAutoSubmit" src/` must show exactly these lines after the change.

## Test harnesses
- src/panel/actions.test.ts:29–112: stubTheme, choiceQ/seed helpers, makePanel(state, extra?, config?) → new InterrogationPanel({tui:{requestRender} stub, theme: stubTheme, done, state, config, ...}); makeDeps() supplies SubmitDeps (fake sendMessage).
  **CRITICAL GOTCHA**: maybeAutoSubmit returns at `d === undefined` BEFORE arming the hold (S1 keeps this early return). Headless makePanel panels have NO delivery — tests must call maybeAutoSubmit(panel, deps) with explicit deps (makeDeps pattern) OR pass delivery into the panel. Inheritance tests for accept/ripple paths go through panel.delivery — check what actions.test.ts:1937-2058 does (HOLD_FIXTURE tests call maybeAutoSubmit directly with deps; the accept tail uses panel.delivery — so panels in the accept-path test need `delivery` in InterrogationPanelArgs extra, see existing completeness tests at :1620–1933 for the pattern).
- src/panel/ripple-confirm.test.ts: own makePanel (lines ~30–136), seamMock, confirmRipple opts; ripple edit APPLIED path ends at ripple-confirm.ts:160/:304.
- src/remote-bridge.test.ts:21–75: FakeBus (on/emit/of), makePi (events: bus, sendMessage captured), makeBridge(config) → {bridge, bus, sent, ledger}; createRemoteBridge(pi, {config, lifecycle, ...}). To pin the hold through the BRIDGE, extend with a real panel + real maybeAutoSubmit:
  deps option `maybeAutoSubmit` — pass `() => maybeAutoSubmit(panel, deps)` where panel is an actions.test.ts-style panel over the SAME state singleton (setState shared). Never a real pi.

## Expected behavior per path (post-S1)
All commit paths behave identically: commit lands while gate unanswered (gate q open, later-group answer committed) → hold armed on panel.gateWarning, no auto-submit, exact line via gateHoldLine(n, panel.labels.submit).

## Bridge nuance
remote-submit.ts:165 fires the tail hook even on nothing_shippable — pin that the hold arms on the SHIPPED path (:181) when a later-group answer commits while gate open. The zero-change path is a no-commit (no hold expected — nothing landed).

## TDD requirement
Each new test must fail (or be absent) before S1's fix and pass after. Since S1 is landing in parallel, write tests against S1's specified semantics; if S1 hasn't landed, these tests fail — that's expected/acceptable at integration (P1.M3.T1 sweep triages).

# Research notes — BUG-007 (P1.M2.T4.S1): bridge submit internal-error nack

Primary source: plan/002_949db554a811/bugfix/001_c0ff03282c6f/architecture/bug-007-bridge-errors.md (verified at HEAD 613437d) — all claims CONFIRMED there. Verified against the current tree.

## Fix surface (verified anchors, src/remote-bridge.ts)

- Outer bare catch, listener registration: **:258–268** (`events.on(PI_ASK_SUBMIT, raw => { try { handleSubmit(raw); } catch { /* swallow */ } })`). KEEP as last-resort bus guard; its comment's "state consistency is guarded upstream" claim is FALSE today — reword.
- `emitSubmitResult`: **:287–298**; error union at the signature (`ok: true | { error: "flow_not_found" | "invalid_answer"; message: string }`) — widen with `"internal_error"`.
- `handleSubmit`: **:300–361**. requestId/flowId parsed at **:303–304** (after the isRecord/version check at :302). Valid-answer path: `recordRemoteSubmission(...)` at **:348** (with `{lifecycle: opts.lifecycle, maybeAutoSubmit: opts.maybeAutoSubmit}`), then `emitSubmitResult(requestId, flowId, true)` (:355), `completeFlow(flowId)` (:356), resurface (:357–359). **Wrap ONLY the recordRemoteSubmission call in try/catch**; on throw: `emitSubmitResult(requestId, flowId, { error: "internal_error", message: ... })` + `completeFlow(flowId)` + `return`.
- `completeFlow`: **:280–285** (flows.delete + emitCompleted). Reuse.
- Constants: PI_ASK_SUBMIT_RESULT = "@eko24ive/pi-ask:submit-result" (:69–74). Payload shape: `{version:1, requestId, flowId, ok:boolean, error?, message?}`. pi-ask contract permits arbitrary error strings (client surfaces ok:false as a warning) — widening is safe.
- Module docstring **:20–60** documents "A submit acks submit-result then completes the flow" — add the internal-error nack sentence. Also :230–238-ish `handleSubmit` docstring region ("never throws into the emitter").

## Why no rollback

remote-submit.ts `recordRemoteSubmission` (:121–184): applyAnswer ×n (:129–135) → baseline+diff → markSubmitted (:155) → buildSubmission = takeSnapshot + bumpEpoch (:170) → deliverSubmission (:173) → noteSubmissionDelivered (:176) → maybeAutoSubmit hook (:181). Snapshot ring + epoch are append-only; no undo API in state.ts. Throws from deliverSubmission propagate BY CONTRACT (remote-submit.ts:118). Fix = ack + completeFlow only; state half-mutated is the documented worst case, healed by the next upsert resurface.

## Test harness (src/remote-bridge.test.ts)

- `FakeBus` (:25–44 — on/emit/of(event) recording), `makePi(bus)` (:46–57 — `{events: bus, sendMessage}`), `makeBridge(config?)` (:60–75 — injects `lifecycle: {noteSubmissionDelivered}` ledger), `fixtureState()`/`setState()` (state singleton injection via `RemoteBridgeOptions.getState`), `submit(bus, flowId, response, requestId?)` (:244).
- Cleanest throw lever: pass `getState: () => throwingState` in `RemoteBridgeOptions` where throwingState wraps fixtureState with an applyAnswer that throws (or a proxy delegating everything else). Alternative per research doc: throwing `lifecycle.noteSubmissionDelivered`.
- Existing pins to keep green: describe "submit handling" (:248) — valid answers → ok:true + completed + resurface; cancel → defer; foreign flowId → silence; invalid answers → invalid_answer + replay; missing singleton → flow_not_found; tail-hook test (:613).
- Also assert flow registry: after the nack, a second submit with the same flowId nacks `flow_not_found` (completeFlow removed it) — proves completeFlow ran.

## Doc sync (Mode A; spec/ is living docs)

spec/tool-protocol.md does NOT document submit-result error literals (grep: zero hits) — nothing to add there. Touchpoints that mention ack behavior:
- spec/product-requirements.md:65–67 (FR-31/32/33) — add one sentence: internal errors nack `internal_error` and complete the flow.
- spec/decisions.md:41 (D-R6) — same one-liner.
- spec/architecture.md:158 (pipeline ASCII `emit submit-result ok:true → completed`) — note the internal_error branch.
- spec/ui-spec.md:41 — optional one-liner.
- README.md: verified NO bridge-ack passage → no change.
- Code docstrings: remote-bridge.ts module + handleSubmit ("never throws into the emitter" stays true; add the nack-on-internal-throw sentence) and remote-submit.ts:118 (unchanged — throws still propagate by contract; now the bridge acks them).

## Validation

`npm test` (vitest) — `npx vitest run src/remote-bridge.test.ts src/remote-submit.test.ts src/remote-compat.test.ts`; `npm run typecheck`.

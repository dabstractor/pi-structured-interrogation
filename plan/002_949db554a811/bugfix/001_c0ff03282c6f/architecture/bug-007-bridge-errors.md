# BUG-007 — Bridge submit internal errors swallowed with no submit-result ack; state half-mutated

Repo: pi-structured-interrogation (pi-interrogator). Verified at HEAD `613437d` ("Add bug report: 001_c0ff03282c6f").

## Verdict

- **Claim 1 CONFIRMED** — `src/remote-bridge.ts:261-267`: the `PI_ASK_SUBMIT` listener wraps `handleSubmit(raw)` in a bare `catch {}` "Never poison the shared bus … Swallow; state consistency is guarded upstream." It swallows UNEXPECTED internal throws (e.g. a throw out of `recordRemoteSubmission`) with no ack of any kind.
- **Claim 2 CONFIRMED** — `src/remote-submit.ts:129-135`: `recordRemoteSubmission` applies answers via `state.applyAnswer` (line 130) FIRST, before baseline/diff/markSubmitted (155) / delivery (173) / `noteSubmissionDelivered` (176) / `maybeAutoSubmit` (181). No guard, no rollback. If `deliverSubmission` (line 173) throws — its docstring says "Throws propagate from deliverSubmission by contract (no error-swallowing — the bridge's handler guards the bus)" — state is left answered→submitted but NO delta delivered, NO `noteSubmissionDelivered` (close-pass deadlock risk), and NO `submit-result`/`completed` emitted (client hangs until its own timeout). The module comment claims ordering is "load-bearing, never reorder" mirroring `panel/actions.ts submit()`.
- Note the file-level docstring at remote-bridge.ts:230-238 explicitly documents the swallow ("every branch defensive, never throws into the emitter"), so the fix must update that doc comment too.

## 1. Submit handler (remote-bridge.ts)

Constants (lines 69-74): `PI_ASK_STARTED`/`PI_ASK_SUBMIT`/`PI_ASK_SUBMIT_RESULT = "@eko24ive/pi-ask:submit-result"` (line 72)/`PI_ASK_COMPLETED` — copied verbatim from pi-ask's contract.

Registration (lines 258-268):
```ts
if (events !== undefined && opts.config.remote.enabled) {
  unsubSubmit = events.on(PI_ASK_SUBMIT, (raw) => {
    try {
      handleSubmit(raw);
    } catch {
      // Never poison the shared bus — a listener throw would break pi-ask's
      // listener too. Swallow; state consistency is guarded upstream.
    }
  });
}
```

Emit helper (lines 287-298):
```ts
function emitSubmitResult(
  requestId: string,
  flowId: string,
  ok: true | { error: "flow_not_found" | "invalid_answer"; message: string },
): void {
  const payload: Record<string, unknown> = { version: 1, requestId, flowId, ok: ok === true };
  if (ok !== true) { payload.error = ok.error; payload.message = ok.message; }
  events?.emit(PI_ASK_SUBMIT_RESULT, payload);
}
```
Payload shape: `{version:1, requestId, flowId, ok:true}` or `{version:1, requestId, flowId, ok:false, error, message}`. `error` is a string literal union — an internal-error nack would need to widen it (pi-ask contract permits arbitrary error strings; the client surfaces `ok:false` as a warning).

`handleSubmit(raw)` (lines 300-361) — today's paths:
- malformed / missing flowId|requestId / foreign flowId → **silent** (pi-ask owns nacking its own flows)
- unknown `itg:`-prefixed flow (line 305) or missing singleton state (line 326) → `flow_not_found` nack
- `kind:"cancel"` (line 315) → ack ok:true + `completeFlow`
- zero recordable answers (line 334) → `invalid_answer` nack + `emitFlow(state, "ask:replay")`
- valid answers (line 348): `recordRemoteSubmission(...)` → **then unconditionally** `emitSubmitResult(requestId, flowId, true)` (355), `completeFlow(flowId)` (356), resurface (357-359). If `recordRemoteSubmission` throws, none of 355-359 run.

`handleSubmit` is a module-local closure (not imported); `recordRemoteSubmission` is imported at line 62 from `./remote-submit.js`.

**Validation throws vs internal throws:** validation (D-R4 option check, recordable statuses, unknown ids) is done non-throwing in `mapWireAnswers` (lines 369-432) → the `invalid_answer` nack path. The only throwing surface on the happy path is *internal*: `state.applyAnswer`, `computeDiff`, `markSubmitted`, `buildSubmission` (takeSnapshot/bumpEpoch), `deliverSubmission` (sendMessage), `maybeAutoSubmit` hook, or a throwing injected lifecycle. `remote-submit.ts:118` documents that deliverSubmission throws propagate by design.

## 2. recordRemoteSubmission pipeline (remote-submit.ts:125-184)

Order (exact): 1. applyAnswer ×n (129-135) → 2. baseline+diff (137-139) → 3. pendingIds before flip (142-146) → 4. BUG-008 user-shipped filter (148-150) → 5. `markSubmitted(pendingIds)` status flush (155) → 6. nothing_shippable early return w/ conditional noteSubmissionDelivered + tail hook (159-167) → 7. `buildSubmission` = the ONLY takeSnapshot+bumpEpoch (170) → 8. `deliverSubmission` (173) → 9. `noteSubmissionDelivered` (176) → 10. `maybeAutoSubmit` hook (181). A throw from any of 2-8 interrupts everything after it; state mutations from steps 1 and 5 are already on the singleton.

## 3. Fix surface options

**(a) catch → nack (recommended, smallest):** in remote-bridge.ts lines 261-267, capture the throw and emit a nack. The catch is on the outer listener, but `requestId`/`flowId` are parsed inside `handleSubmit`; simplest insertion: wrap the *answer path* — inside `handleSubmit`, wrap `recordRemoteSubmission(...)` (line 348) in try/catch and on throw `emitSubmitResult(requestId, flowId, { error: "internal_error" (new literal — widen the union at line 289), message: ... })` + `completeFlow(flowId)`; keep the outer bare catch as the last-resort bus guard (it has no parsed ids). This acks the client and completes the flow so the client isn't stuck; state may be half-mutated (submitted w/o delta) but the D-R6 resurface on next upsert heals the surface. Also update the doc comments at lines 230-238 and 46 ("state consistency is guarded upstream" is false today).

**(b) validate-before-mutate:** largely already true — validation happens in mapWireAnswers before recordRemoteSubmission. Not the bug.

**(c) rollback on failure:** would require state-level rollback of applyAnswer+markSubmitted+snapshot/epoch (recorded via buildSubmission step 7). High risk: snapshots ring and epoch are append-only; no undo API exists in state.ts. Not recommended.

Correlation fields: submit wire carries `requestId` and `flowId` (both required strings, parsed at lines 303-304); the ack echoes both.

Also consider: on the nack path, should `noteSubmissionDelivered` fire if delivery succeeded but a later step threw? If the throw is from `maybeAutoSubmit` (after line 176), state+delta are fine — an `ok:true` ack would be more accurate; a message-reason check or ordering the ack before the tail hook is an option (move `emitSubmitResult` before `maybeAutoSubmit` — but that lives in remote-submit.ts; simpler: have recordRemoteSubmission return outcome and ack in the bridge, which it already does via `RemoteSubmitOutcome`).

## 4. Tests pinning this behavior

`src/remote-bridge.test.ts` (661 lines). Harness: **`FakeBus`** (lines 25-44: `on`/`emit`/`of(event)` recording bus) + `makePi(bus)` (46-57: `{events: bus, sendMessage: pushes to sent}`) + `makeBridge(config)` (60-75: wires `lifecycle: {noteSubmissionDelivered: () => ledger.calls++}`) + `submit(bus, flowId, response, requestId?)` helper (240-242). State seeded via `fixtureState()` + `setState()` (state.ts singleton injection through `RemoteBridgeOptions.getState` default).

Relevant tests in `describe("submit handling")` (line 244):
- "valid answers → ok:true + completed + resurface" (~246) — pins the happy ack path
- "cancel → defer" (~307), "cancel then answer → flow_not_found" (~324)
- "foreign flowId → total silence" (347), "malformed submits → silence (except well-routed itg: strays, which nack)" (354)
- "invalid option values … all-invalid → invalid_answer + replay" (~373) — pins the validation nack
- "missing singleton state → flow_not_found" (453)
- "bridge tail hook: injected maybeAutoSubmit fires once after the lifecycle call…" (613) — the closest to internal-error territory; NO test currently asserts the bare-catch/no-ack-on-throw behavior, so nothing pins the bug — a new test follows the FakeBus pattern (inject a throwing lifecycle or a throwing `getState` state whose applyAnswer throws; note recordRemoteSubmission can't easily be forced to throw without a custom state object — injecting a state whose applyAnswer throws via `opts.getState` is the clean lever, or a throwing `lifecycle.noteSubmissionDelivered`).

`src/remote-submit.test.ts` (328 lines): `describe("recordRemoteSubmission (D-R5 parity)")` (49) — "applies answers, ships ONE submission, bumps snapshot+epoch EXACTLY once" (50), "nothing_shippable on identical re-selection" (71), "BUG-008 parity" (104), "lifecycle.noteSubmissionDelivered fires AFTER delivery, exactly once" (136), "idle → followUp+triggerTurn; busy → steer" (149); flush describe (170); tail-hook describe (220) incl. "no double-ship" (271); WRITEIN-001 passthrough (305, 320). None test throw behavior.

`src/remote-compat.test.ts` (163 lines): one end-to-end-ish test "emitFlow → conformant extension_ui_request; respond → recorded; degraded label path works" (70) — FakeBus pattern again (line 55).

## 5. Spec/doc sync targets for FR-32 / D-R6

- `spec/product-requirements.md:66` — FR-32 (bridge submit rides same pipeline, one delta, epoch bumps once, noteSubmissionDelivered fires). A failure-ack behavior addition belongs here.
- `spec/decisions.md:41` — D-R6 ("submit acks then completes; cancel = defer …"). D-R5 at decisions.md:40 (panel pipeline parity).
- `spec/architecture.md:149-162` — §"Bridge submit (pi-ask contract; FR-32)" ASCII pipeline including `emit submit-result ok:true → completed`.
- `spec/ui-spec.md:39` — Bridge submit mapping paragraph (pipeline mirrors ctrl+s).
- `src/remote-bridge.ts:230-238` module docstring ("Submit handling order … never throws into the emitter") + `src/remote-submit.ts:118` ("the bridge's handler guards the bus") — both would need wording updates if the ack-on-throw fix lands.
- README.md does NOT document bridge submit acks (bridge mentioned only at 408-409 in Project structure; no user-facing doc change needed for this bug).

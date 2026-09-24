# P2.M1.T3.S1 research notes — bridge tail hook + customText parity

## recordRemoteSubmission (src/remote-submit.ts:90-135)
- 9-step pipeline; step 5 `markSubmitted(pendingIds)` flushes ALL answered→submitted
  BEFORE the `nothing_shippable` early return (:~121). Step 9
  `deps.lifecycle?.noteSubmissionDelivered()` (:~131) after deliverSubmission.
- `RemoteSubmitDeps` (:68) = { lifecycle?, isIdle? } — the injection seam. NO panel access
  (pure-data discipline documented at :~57). Extend with `maybeAutoSubmit?: () => void`.
- `RemoteAnswerInput` (:60) = { id, value, text? } — needs `custom?: boolean`;
  applyAnswer call at :~99 spreads text; add custom spread. state.applyAnswer already
  persists `custom` (state.ts:558, strict `=== true` guard — from P1.M1.T1.S1).

## mapWireAnswers (src/remote-bridge.ts:365-400)
- Current mapping: choice: `values[0]` validated against CURRENT options (D-R4);
  customText → `answer.text` only when it rides a valid picked value (:395-397);
  customText-only on choice → `value = custom` recorded as given but WITHOUT custom flag.
- Change: customText-only choice answers → `{ value: custom, custom: true }`.
  Text questions: `customText ?? values[0]` unchanged (text answers are already
  implicit-custom per state.ts:52 comment — do NOT set custom there unless P1 set it;
  panel parity: panel write-in sets custom:true, plain text answer value also custom:true
  per state.ts:52 "type:'text' → the answer value itself, custom: true" — CHECK: P1.M1.T1.S1
  may already make text commits custom:true; if panel sets it, bridge text answers should
  match for parity. Panel write-in commit path: `applyAnswer({value, custom:true})` (P1.M2.T2).
  For text questions the panel commits via writeInEnter — inspect src/panel/panel.ts
  text commit to mirror; if it sets custom:true, mirror it in mapWireAnswers for type:text.
- Validation acceptance (D-R4 + h2.42): custom values never checked against option lists —
  already true (freeform recorded as given); add explicit test.

## Wiring the hook without panel access
- createRemoteBridge (remote-bridge.ts:243) opts `RemoteBridgeOptions` (:200) =
  { config, lifecycle?, getState? } — extend with `maybeAutoSubmit?: () => void`,
  pass through to recordRemoteSubmission deps (remote-bridge.ts:343).
- index.ts:98 `remoteBridge = createRemoteBridge(pi, { config, lifecycle })` runs BEFORE
  panelHost creation (~:146). Late-binding closure pattern already used (onCompleted :87).
- Panel access: `PanelHost.getPanel(): InterrogationPanel | undefined` (panel.ts:137+).
- Wire: `maybeAutoSubmit: () => { const panel = panelHost.getPanel(); if (panel) maybeAutoSubmit(panel); }`
  — closure captures panelHost binding (assigned later; fine since arrow evaluates at call).
  maybeAutoSubmit(panel, deps?) no-ops without panel.delivery, and getPanel() undefined when
  closed → both no-op paths safe.
- P2.M1.T2.S1 (parallel, gate hold) adds gate-withhold INSIDE maybeAutoSubmit — bridge tail
  inherits it automatically; do not duplicate gate logic.

## Tail call sites (exact)
1. After step 9 `deps.lifecycle?.noteSubmissionDelivered();` (success path, before `return { ok: true }`).
2. Inside/after the nothing_shippable return path — after the conditional
   `if (pendingIds.length > 0) deps.lifecycle?.noteSubmissionDelivered();`, before `return`.
Ordering: hook AFTER noteSubmissionDelivered in both branches (h2.44 line-1 first).
Common case after a successful bridge submission: pending set already flushed →
maybeAutoSubmit no-ops (zero pending) → no double-ship. Test asserts sendMessage count stays 1.

## Tests
- src/remote-submit.test.ts + src/remote-bridge.test.ts harnesses exist; follow their
  fixtures (fake pi {sendMessage}, seeded state).
- P2.M1.T1.S1 contract: `maybeAutoSubmit(panel, deps?)` exported from src/panel/actions.ts:593.

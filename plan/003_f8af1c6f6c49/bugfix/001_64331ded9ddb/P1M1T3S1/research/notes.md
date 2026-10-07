# Research — P1.M1.T3.S1 (public-seam re-ask round-trip regression test)

## Verified machinery for the scripted test

### The model: src/regression-phantom-submissions.test.ts
Permanent colocated vitest suite driving ONLY public seams. Copy its harness wholesale:
- `makePiHarness()` — fake `pi.on` capturing handlers in a Map + `vi.fn()` sendMessage; `emit(event)` fires all handlers with `{type: event}` (extend it to accept a payload).
- `tuiCtx()` — `{ mode: "tui", hasUI: true, model: { contextWindow: 200_000 } }` for `executeInterrogate(args, ctx, DEFAULT_CONFIG)`.
- `makeWalkthrough()` — `createLifecycle(h.pi, { onAfterClosePass: createCompletionTrigger(h.pi, { lifecycle: { dismissPanel: () => lifecycle.dismissPanel() }, ctx: { isIdle: () => true } }) })` + `panelOf()` constructing `new InterrogationPanel({ tui: {requestRender: vi.fn()}, theme: stubTheme, done: ()=>{}, state: getState()!, config: DEFAULT_CONFIG, drafts: new DraftStore(), editorFactory: () => fakeEditor(), delivery: { sendMessage: h.sendMessage, isIdle: () => true, noteSubmissionDelivered: () => lifecycle.noteSubmissionDelivered() } })`. Write-in helper: currentId=id, cursorIndex=state options length (✎ Other row), ENTER, editor.setText, ENTER.
- `stubTheme = { fg: (_n,s)=>s, bold: s=>s }`; DOWN/ENTER/CTRL_S key constants; `beforeEach(resetState())`.

### The re-ask trigger (lifecycle flip) — event shapes verified
`src/lifecycle.ts:169-204`:
- `tool_execution_start` handler stashes `event.args` under `event.toolCallId` (only for `toolName === "interrogate"`).
- `tool_execution_end` handler: needs `event.toolName === "interrogate"`, `!event.isError`, matching toolCallId, and `isUpsertArgs(args)` (args.questions non-empty array). Then every touched id currently `submitted` → `setStatus(id, "reasked")` (answer KEPT — setStatus never touches q.answer), added to `reaskedThisRun`, `submittedRun = true`.
- Exact emit recipe (from lifecycle.test.ts :137-143): `emit("tool_execution_start", { toolCallId, toolName: "interrogate", args: upsertArgs })` then AFTER the real `executeInterrogate` upsert: `emit("tool_execution_end", { toolCallId, toolName: "interrogate", result: undefined, isError: false })`.
- IMPORTANT: executeInterrogate itself does NOT emit tool events — the harness does, simulating the host. Sequence: start → executeInterrogate(upsert) → end.
- `agent_settled` → `runClosePass()` (:213): closes `submitted` ids not in `reaskedThisRun`; then `opts.onAfterClosePass` = `createCompletionTrigger` → `attemptCompletion` (completion.ts ~:94-135): one-time guard + predicate BLOCKING = {open, reasked, answered, submitted, moot} (completion.ts:66-73). Order: buildCompletion → deliverSubmission → dismissPanel → clearForCompletion. Delivery customType: `"interrogation-submission"` for deltas; completion record has its own customType (verify via h.sendMessage captured arg — completion message content starts "INTERROGATION COMPLETE").

### Rule-1 vs rule-2 re-ask (merge.ts)
- Rule 1 (same option values, rev echoed, text edited): status stays `submitted` after applyUpsert → lifecycle end-event flips to `reasked`, answer KEPT.
- Rule 2 (changed options): applyUpsert itself sets status `reasked`, `answer = undefined`, `answerReset: true`.
- Epoch must be echoed on upserts touching existing ids (guard); rev must equal current rev.

### The fixed pipeline this test pins (contracts to consume, not touch)
- P1.M1.T1.S1 (COMPLETE): submit() pendingIds-keyed fall-through — flushes answered→submitted, synthesizes card entries, bumps epoch, delivers, even when the answer-signature diff is empty.
- P1.M1.T1.S2 (COMPLETE): maybeAutoSubmit empty-diff transition delivers + truthful flash.
- P1.M1.T2.S1 (Implementing): acceptOptionIndex no-op exclusion for `reasked` — enter/digit on the kept value re-marks `answered`.
- P1.M1.T2.S2 (this item's predecessor, in flight): writeInEnter byte-identical no-op exclusion for `reasked` + kind-preserving direct commit.

### Observable fingerprints to assert
- Deliveries: `h.sendMessage` call count + `customType === "interrogation-submission"` + content substrings (`q1: a`, epoch mentions `(state epoch 3)`).
- Epoch: `getState()!.epoch` after each step (sub1→2, sub2→3).
- Statuses: `getState()!.getQuestion("q1")!.status` after each step.
- Flash: panel flash is NOT "nothing to submit" (check how panel exposes flash — grep `flash(` in panel.ts; assert the flash string or the delivery count instead — delivery count + epoch is the hard fingerprint).
- Completion: exactly one final sendMessage with the completion record (content contains "INTERROGATION COMPLETE"); state cleared (`getQuestion` undefined / questions empty).

### Scenario A vs B deltas
- A (rule-1): re-ask keeps answer; user re-confirms with ENTER on the pinned recorded row (cursor seeds to recorded answer row per ANSWER-PIN-001) → status answered; ctrl+s delivers sub2 (epoch 3); agent_settled closes; completion fires.
- B (rule-2): options [a,b,c]→[a,b,d]; answer was RESET (undefined); re-accept 'a' → commit; with zero unanswered remaining, maybeAutoSubmit fires automatically (no ctrl+s) → delivery epoch 3; settle closes; completion fires.

### Residual-gap clause
If the composition exposes a gap (candidate: close-pass "epoch-proxy invariant" lifecycle.ts:53-57 — status `submitted` ≡ submitted at latest epoch; the S1 fall-through's markSubmitted now flushes ids the proxy may not expect), fix minimally IN THIS SUBTASK and note it in the decisions.md pin from P1.M1.T1.S1.

# P1.M2.T6.S1 research notes (plan 005)

## The two apply seams (current landed tree, verified)
- `acceptOptionIndex(panel, q, optionIndex)` — src/panel/actions.ts:268+. Chain: ANSWER-PIN same-value no-op (`recorded.value === opt.value && custom !== true && status !== "reasked"` → advance only, return "noop") → FR-18 ripple veto `panel.confirmRippleEdit` (answered/submitted/closed) → `applyAnswer` :315 → `evaluateDependsOn` :319 → `advanceAfterAccept` :320 → `stageSupersededWriteIn` :326 → `maybeAutoSubmit` :327. **optionIndex is a DISPLAY position** (`displayOptions(q)[optionIndex]` — D-R13 recommended-first; the mapping lives at this single seam).
- Write-in commit = `writeInEnter(panel)` — actions.ts:384–518. Reads the RAW buffer via `panel.textField.getText()` (commit is byte-verbatim, trim only gates emptiness). Byte-identical no-op branch (ANSWER-PIN), reasked re-confirm, FR-18 victims → `beginWriteInConfirm(panel, text)` deferral (applyWriteInConfirm owns it), direct commit tail :508–518 with same ordering (applyAnswer → evaluateDependsOn → consumeCommittedBuffer → advanceAfterAccept → blur → maybeAutoSubmit).
- `applyWriteInConfirm` (ripple-confirm.ts:300) is the text-parameterized apply but ONLY the modal victims path — not the general seam.

## ApplyDecision (sidechat.ts, landed P1.M1.T6.S2)
- `ApplyDecision = { seam: "acceptOptionIndex"; optionIndex: number } | { seam: "writeIn"; text: string }` (:139). `toApplyDecision` maps value→DISPLAY index; text carried VERBATIM (no trim).
- `settleApplyDecision(record, replyText, question, autoApply)` (:605): manual mode sets `record.pendingConfirm`; autoApply clears it and RETURNS the decision (engine hands to `onAutoApply`). `clearPendingConfirm(record)` (:635) = esc decline.

## Routing seam landed by P1.M2.T3.S1 (panel.ts)
- handleInput ~:1181–1199: while `focus !== "chat"` and `getSidechatRecord()?.pendingConfirm !== undefined` — enter → `this.onApplyConfirm?.(pending)` (return true); esc → `clearPendingConfirm(record)` (return true). Routed after ctrl+c and confirmMode, before duty fork and router.
- `panel.onApplyConfirm?: (decision: ApplyDecision) => void` — panel.ts:853–860, the ROUTING STUB: "Nullable: unset → confirm-enter is a consumed no-op... P1.M2.T6.S1 replaces it with the real acceptOptionIndex / write-in commit routing". NOT currently assigned anywhere (only declaration + call site). This item wires it.

## Engine deps gap (verified)
- `createSidechatEngine({port, registry, notify})` — panel.ts `resolveSidechatHostSeams` :486–508. `answerContext` and `onAutoApply` are NOT wired yet (sidechat-engine.ts :114/:120 optional deps; engine fires `onAutoApply(decision)` at :334 only when `ctx.autoApply`). This item wires them: `answerContext(qid)` → `{question, autoApply: config.sideChatAutoApply}` (question via lastOpts.state, matching buildSystemPrompt's pattern); `onAutoApply` → route into the LIVE panel (`currentPanel` module record — T5.S2 may relocate construction; re-read before editing).

## Write-in routing design decision
`writeInEnter` reads `panel.textField`, so the verbatim seam invocation is: ensure `panel.currentId === record.questionId` first (the setter re-seeds cursor and does buffer scoping write-through), then `panel.textField.setText(decision.text)` (raw bytes) and `writeInEnter(panel)` — the exact same arguments a keyboard write-in commit produces (buffer content). The commit consumes the buffer (`consumeCommittedBuffer`, VAL-002). Acceptable because currentId IS the chat's question while its confirm row is live (open path guarantees record.questionId === currentId at `e`; confirm routing only fires in the chat view).

## Post-apply lifecycle
- Applying answers the question → P1.M2.T5.S1's discard hook (state.on("changed") bus) fires: aborts stream if any, discards the record, closes the view where the advance already points, fires usage notify. This item MUST NOT add its own discard.
- Esc decline: `clearPendingConfirm` only — chat stays open, messages intact.

## Tests / fixtures
- src/panel/sidechat.test.ts, sidechat-engine.test.ts, chat-view.test.ts exist. Panel fixtures: `panelArgsFor(state)` pattern (deep/ac tests); makeMockPi harness for host wiring. Byte-identical provenance assertion: build the same state twice — one via keyboard accept (acceptOptionIndex / textField setText + writeInEnter), one via applyChatAnswer — compare `state.serialize()`, submission delta payloads (snapshots.ts), diff card render (renderers/snapshots answerSummary), completion record lines.

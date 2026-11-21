# P3.M2.T1.S3 Research Findings — Retirement semantics, no-side-effects audit, acceptance cases 2/3/4-send-half

Verified anchors (scout run 2026-01 + direct reads; line numbers at research time — locate by content).

## 1. The three retirement exits (architecture note §retirement, :222-251)

1. **Deliberate discard** — delete-to-empty BY THE USER. S1 already treats a deliberate
   deletion-to-empty as an edit: mints a seq and captures `""` (input-capture.ts:36-39).
   S2 stores `{text:"", seq}` (distinct from `undefined`). **No new gesture is needed and
   none exists**: research confirmed there is NO explicit "discard buffer" key today —
   esc exit `exitTextField()` (panel.ts:1621) STAGES the draft (`stageText` :1633), it
   does not clear; ctrl+u is pi-tui's internal readline clear (no panel branch). Therefore
   retirement-by-discard = replacement by the minted-seq empty save (P3.M3 relies on the
   `{text:""}` record to "preserve the empty editor, not the previous answer text" —
   spec :140). **Do NOT unlink on empty-save.**
2. **Replacement** — newer-seq save replaces in place (S2 monotonic guard). S3 audits +
   scripts it; no new code.
3. **Successful handoff** — retire AFTER the handoff is recorded (order load-bearing).

## 2. Handoff seams (verified)

### Write-in / text answer commit — `writeInEnter` (src/panel/actions.ts:422)
- Empty-buffer exit :431-437 `commitTextDraft` → NO retire (draft saved, not handed off).
- Byte-identical inert exit :482-489 → `panel.consumeCommittedBuffer(q.id)` → buffer
  already IS the answer → RETIRE here.
- Ripple deferral :503-507 `beginWriteInConfirm` → nothing applied yet → NO retire here;
  retire where ripple applies (ripple-confirm.ts apply seam ~:142 — applyAnswer +
  draft-slot consumption; verify exact consume call at implementation).
- Direct commit :517 `panel.state.applyAnswer(q.id, answer)` → :527
  `consumeCommittedBuffer` → RETIRE after applyAnswer returns.
- **Single hook point**: `panel.consumeCommittedBuffer(questionId)` (panel.ts:1803-1809)
  already runs at every buffer→answer consume site and already clears the memory draft
  (`draftSlots.delete` :1808, `drafts?.clearDraft?.(q.id,{explicit:true})` :1809).
  Retire the writein capture key RIGHT THERE, next to clearDraft.
- Elaboration duty NEVER commits via enter (`panel.ts:1550-1552`: textDuty "writein" →
  writeInEnter, else `saveTextDraft()`; "an elaboration alone never answers" FR-12).
- `acceptOptionIndex` (actions.ts:277, applyAnswer :322) can ATTACH a held elaboration
  draft as `answer.text` (actions.ts:708-725) → retire elaboration key at that attach.
- `submit` (actions.ts:811; shipDrafts consumption ~:936 — draft-store.ts:21
  "shipDrafts(diff.changed) in actions.ts") ships elaborations + batch note → retire
  elaboration/writein per shipped id + note key there.
- `applyChatAnswer` (actions.ts:592) hands off MODEL-authored text, not the editor
  draft → retires NOTHING.
- `stageSupersededWriteIn` (actions.ts:376-389) = replacement seam (re-binds as draft).

### Side-chat composer — `sendChatInput` (src/panel/panel.ts:2158)
- Command path (`/clear`,`/new`) → `chatField.setText("")` :2183 (accepted; suppresses
  capture via text-field :235-245 — programmatic clear is NOT a capture; retire
  explicitly there or treat as incidental — decide: retire note: conversation reset).
- Accept seam :2188-2192: `const sent = engine.sendTurn(text) ?? false; if (sent)
  { setText(""); startChatStreamTicker(); } else flash("reply in flight — esc aborts")`.
- **HAZARD (scout finding)**: engine `sendTurn` (sidechat-engine.ts:492) returns `true`
  on three FAILED-dispatch paths — registry throw :513-519, inert/undefined model
  :520-526, synchronous port/auth throw :540-546 (turn recorded, notice pushed,
  streamState idle). Panel clears the composer on those. Retiring at `sent===true`
  would violate "a failed send leaves the prompt recoverable" (spec :139, case 4).
- REFUSE: `record === undefined` :494-495 or `streamState !== "idle"` :496 → returns
  false → composer NOT cleared → capture intact. No retire.
- ABORT: engine `abort()` :551; abort pops the turn ("the turn never happened",
  :352-359). Panel `abortChatStream()` from escapeDescend (keys.ts:329, :600). No retire.
- Terminal routing: `route(record, turnUser, reason, ...)` at :455/:465 (model
  stopReason, e.g. "end_turn"), :484/:488 (`"error"`). `deps.onSettle?.()` fires at
  route (:334; def :136 `onSettle?: () => void`).
- **Design**: extend `onSettle` to `onSettle?: (stopReason: string) => void`
  (backward compatible — existing callers declare `() => void`). Panel handler retires
  the chat key ONLY on natural completion (stopReason not "error"; abort never routes
  a settle — verify abort path at implementation). This satisfies refuse/fail/abort →
  recoverable; clean completion → retired.

## 3. Resurrection hazard → tombstone (NEW requirement discovered)

After `retire` unlinks the file, S2's monotonic guard loses its reference (index entry
removed ⇒ `cur === undefined` ⇒ a still-pending/delayed OLDER capture write for that key
would be accepted and RECREATE the file = resurrection after handoff). Fix:
- `InputCaptureStore.retire(key, {explicit:true})`: DROP pending dirty state for the key
  (NEVER flush-then-retire — a pre-handoff flush after unlink is resurrection), keep the
  per-key seq counter (so a genuine post-handoff re-edit mints seq > tombstone and
  captures normally), then invoke injected `onRetire?.(key)`.
- `DurableInputStore.retire(key, {explicit:true})`: unlink file + replace index entry
  with a TOMBSTONE `{seq: lastSeq, retired: true}`; `latest()` → undefined for
  tombstoned; `lastSeq()` → tombstone seq (keeps seedSeq monotonic); writes with
  `seq <= tombstone.seq` → "ignored-stale" (same guard branch).
- Tombstones are in-memory only (post-restart there are no pending delayed writes; a
  post-restart fresh mint seeded from lastSeq continues above the tombstone).

## 4. S1 shipped shapes (src/input-capture.ts, landed)

`CaptureField = "writein"|"elaboration"|"note"|"sidechat-composer"` (:57);
`CaptureKey` (:65), `CaptureRecord extends CaptureKey` (:76), `CaptureSink` (:88);
`InputCaptureStore` (:108): constructor `{sink?, session?}` (:123), `setKeyDirty` (:152),
`forceFlush(key?)` (:181), `latest(key)` (:194), `dispose` (:204), `setSessionResolver`.
Docblock :46 says retirement is deliberately absent ("P3.M2.T1.S3 adds retirement").
Pacing: 250ms trailing debounce + 1000ms max-dirty-age deadline (:24, :165-166).
Construction: index.ts:149 `new InputCaptureStore()`; panel wiring panel.ts:1247-1253
(`setCapture(store, keyProvider)` on textField + chatField; `setSessionResolver`).
Key providers: panel.ts:1743 `captureKeyForTextField()` (note → `{questionId:"-",
field:"note"}`), :1757 `captureKeyForChatField()`. text-field.ts:178 `setCapture`,
:192-197 `fireCapture` → `setKeyDirty(key, () => getText())`, chained from onChange
:156-165. `setText`/`seed` suppress capture (:235-245, :253) — incidental empties
(init/navigation/cleanup) can never mint or retire anything.

## 5. S2 contract (in flight — PRP read; input-durability.ts not yet landed)

`DurableInputStore`: atomic tmp+fsync+rename, monotonic guard, incidental-empty guard,
load index + `.tmp` cleanup, `write/latest/lastSeq`, never-throw, no surface. Its
DOWNSTREAM note: "P3.M2.T1.S3: retire(key, {explicit:true}) as an ADDITIVE method
(delete file + index entry, mirroring draft-store.ts's explicit guard) — keep the index
a simple Map so this stays trivial" — S3 EXTENDS that with the tombstone (§3 above;
still a Map, still trivial). index.ts wiring site: near `new DraftStore()` :141 area /
capture :149; `session_shutdown` → `capture.forceFlush()` accelerator, NEVER dispose.

## 6. Static-scanner template — sidechat-cache-isolation.test.ts:1-110

Docblock :1-31; `node:fs/promises`+`node:path`+`node:url` imports; `PANEL_ROOT` (:38);
targeted file list (:44-52 `SIDECHAT_FILES = [...]`); banned tokens (:60-66
`BANNED_API`); `stripComments(src)` (:82+, string-aware comment blanker preserving line
numbers, cloned from src/no-hardcoded-keys.test.ts); word-boundary identifier greps.
Banned list for the recovery audit (architecture note §No-side-effects audit):
`applyAnswer|writeInEnter|acceptOptionIndex|panelActions.submit|setStatus|upsertQuestion
|sendMessage|sendUserMessage|SubmitDeps|streamSimple|appendEntry|shipDrafts|clearDraft
|clearAll|noteSubmissionDelivered` — scanner targets ONLY the recovery modules
(src/input-capture.ts, src/input-durability.ts) — panel/actions legitimately contain
those tokens; their retire call sites are the handoff seams themselves (allowed).
A behavioral test (panel harness) covers the composed no-side-effect guarantee.

## 7. Panel test harness pattern — ac-panel.test.ts / ac-sidechat.test.ts

`fakePanelEditor` (:309-325 stateful fake EditorComponent), `panelArgsFor(state, extra)`
(:327+ — fake TUI `{requestRender}`, stub theme, `done`, editorFactory, config, state,
drafts), `new InterrogationPanel(panelArgsFor(...))`, key simulation via
`panel.handleInput(ENTER/ESCAPE/...)`, macro-task settling `flush()` promise;
"BINDING: no live TUI, no real interrogate call" (docblock :1-9). ac-sidechat.test.ts
composes the engine via `getEditorComponent` factory (:208) and drives
`panel.chatField.setText(text); panel.handleInput(ENTER);` (:451-464).

## 8. Guard tests that must stay green (untouched)

no-hardcoded-keys.test.ts (src root), panel/sidechat-cache-isolation.test.ts,
panel/editor-preservation.test.ts, input-capture.test.ts (S1), input-durability.test.ts
(S2, once landed), keymap-ac.test.ts. MIRROR: session-file writes forbidden.

## 9. Misc verified facts

- state.ts:379 `applyAnswer(id, answer)` — the final mutation seam (P3.M4's blank guard).
- keys.ts:57-61 — enter never reaches the router in editor focus; panel.ts:1547-1553
  intercepts (`writeInEnter` / `saveTextDraft` / `exitNoteMode`).
- blurTextField resets textDuty to "elaboration" (panel.ts:845, actions.ts:527).
- DraftStore explicit guard precedent: draft-store.ts:27-29, :46-52, :111 clearDraft
  `{explicit:true}`, :121 clearAll, :133 shipDrafts.
- Acceptance-case ownership split (architecture note consumers map :305-315): S3 owns
  case 2 (typing progression), case 3 limbs (fail/delay/discard + file-level branch
  isolation), case 4 send-half (refuse/fail/abort/completion retire). Case 1, 3's
  ancestry restore gate, 4 commit-half, 5 → P3.M3/P3.M4.

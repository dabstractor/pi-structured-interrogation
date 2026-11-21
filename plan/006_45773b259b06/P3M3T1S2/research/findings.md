# P3.M3.T1.S2 research findings — session-start restore (FR-28), composer, cases 1 & 4-commit-half

## 1. Binding spec text (READ-ONLY)

- `spec/state-and-persistence.md` §Local input recovery (:133-149):
  - :137 "Capture on edit, before Enter" — five duties incl. side-chat composer; restore "only to its originating session, branch, question (if any) and field".
  - :139 "Drafts are not answers or messages" — restore must not advance/commit/send; retirement ordering.
  - :140 re-edit ladder (S1 owns).
  - :145 acceptance case 1 (Other/text/side-chat half-typed → hard-kill after completed save, no Enter/blur/suspend/graceful → resume same branch, reopen field → exact draft, no answer, no send; repeat elaboration + batch note).
  - :148 acceptance case 4 ("kill on either side of the save/commit handoff → saved text remains recoverable as draft or committed answer; restart neither repeats the commit nor triggers submission"; chat send refuse/fail/abort limb).
- `spec/product-requirements.md:60` FR-28 (updated): session start with live questions restores SILENTLY; panel NEVER auto-opens (SURFACE-002); "New requirement: restore matching editor drafts per §Local input recovery". Widget line remains the only cue.
- `spec/decisions.md:171` "Later decision — panel input recovery": Local input recovery supersedes Q6's restart limitation for editor input, NOT SIDECHAT-002's transient transcript.
- `spec/product-requirements.md:41` FR-15: "the conversation survives panel suspend/resume, not restart (composer recovery is separate; see FR-28)".
- SURFACE-002 also in list.0 commitment 3: "reads, navigation, and even session restart never surface it".

## 2. Architecture note (design authority) — `plan/006_45773b259b06/architecture/input-recovery.md`

- Consumers map :313: **P3.M3.T1.S2 — session-start restore + composer restore** implements keying (ancestry restore rule), captureSeams (chatField), failureSemantics, storagePath; unblocks case 1 (exact draft) + case 3 (no cross-branch restore).
- §keying "Restore matching": accept candidates whose stored branchTipId is ancestor-or-equal of CURRENT tip; shared-prefix captures restore into descendants intentionally; sibling-branch tips excluded by construction (case 3).
- §retirement #3 handoff order: handoff durably recorded FIRST, then file unlink; kill between leaves byte-identical double-record (harmless). Composer: refused/failed/aborted send retires NOTHING (:245).
- "Allowed surface: fs under storagePath, timers, getBranch() reads, and the two TextField hooks. Restored content is editor TEXT only (setText/seed), applied through the existing draft-seeding seams in P3.M3 — never through an answer path." → session_start may LOAD data but the only UI act is later field-open seeding.
- Storage: `<agentDir>/data/interrogator/` (DurableInputStoreOptions.dir default; input-durability.ts:176, :260).

## 3. Landed upstream contracts (verified in source)

- `src/input-capture.ts`: CaptureField = "writein" | "elaboration" | "note" | "sidechat-composer" (:62); CaptureKey {branchId (RAW walk-tip entry id), questionId | "-", field} (:70-74); TextField suppresses capture around programmatic setText (docblock :34-37).
- `src/input-durability.ts`: DurableKeyQuery {session?, branchId, questionId?, field} (:88-92); DurableValue {text, seq, savedAt?} (:96-99); `latest()` (:333) returns undefined for never-captured AND retired (tombstone, S3); deliberate empty = {text:"", seq}. Constructor default dir = `<agentDir>/data/interrogator` (:259-260).
- `src/panel/panel.ts`:
  - `captureKeyForTextField` (:1784-1794): note duty → `{branchId, questionId:"-", field:"note"}`.
  - `captureKeyForChatField` (:1799-1806): key = ACTIVE sidechat record's questionId, field "sidechat-composer"; no record → no capture.
  - `retireCapture(questionId, fields)` (:1817-1825); `consumeCommittedBuffer` (:1876-1899) — commit handoff: seed(""), slot+seam drop, THEN retireCapture(["writein"]) with the load-bearing-order comment.
  - `routed.onChat` (~:1341-1385, createPanelHost routing): guard `qid === undefined || args.chatRebindDeps === undefined` → return; cold-create branch `if (record === undefined || record.questionId !== qid)` → abort old stream → `openSidechatRecord(qid, args.chatRebindDeps)` (~:1367) → usage notice → `p.chatReturnView` → `p.setView("chat")` → `p.focusChatInput()` (:1385). **The composer-restore hook belongs inside the cold-create branch, right after openSidechatRecord.**
  - `enterNoteMode` (:2361-2368): seed `this.drafts?.getNote() || this.batchNote || ""` — unchanged by S2; finds the session_start-staged note through the DraftStore seam.
  - `branchReader` (:1752-1764): `Pick<SessionManager, "getBranch"|"getSessionId">` from args.pi, hostile-surface guarded — S1's PRP adds a private `walkIds()` helper on the same pattern (verify name at Task 0).
  - `openPanel` (:3172) → panel construction opts incl. `inputCapture: resolvedOpts.inputCapture` (:3227); `maybeAutoOpen` (:3396-3402, S1 threads durableInputs here).
  - Panel deps interfaces carry `inputCapture?` at :282 and :705 (S1 adds `durableInputs?: DurableRead` alongside per its PRP).
- `src/draft-store.ts`: `getNote(): string` (:80), `setNote(text)` (:85) — extension-lifetime store; `getDraft`/`setDraft` (:70-76); destruction needs `{explicit:true}`.
- `src/reconstruct.ts`: `ReconstructionOptions {config, host, drafts?}` (:233-242, drafts doc says "NEVER read or written by reconstruction itself (FR-28, Q6=B)" — STALE, must be updated); `reconstructFromBranch(ctx, opts, origin)` (:485) computes `walk = walkBranch(ctx.sessionManager.getBranch())`; non-empty tails: non-TUI early return (~:630), session-tree silent branch (~:636), session-start SURFACE-002 tail `updateSuspendWidget(ctx, state)` + return (~:643-652) with stale comment "Drafts are not restored either way (FR-28, Q6=B) — no DraftStore is touched here" (:649-651 — MUST be updated). Subscribed via `createReconstruction` (index.ts:204-208) to BOTH session_start (:679) and session_tree.
  - **answer.at is minted FRESH at replay** (replaySubmission :462 `at: new Date().toISOString()`) → post-restart, any reconstructed answer is newer than every pre-kill savedAt → S1's ladder prefers the answer whenever one exists; uncommitted drafts restore freely. Load-bearing for case-4 side B.
  - Reconstruction is read-only toward persistence: replay + markCompletedSilently; no submit, no auto-submit trigger, no panel open.
- `src/index.ts`: durableInputs + inputCapture wiring (:166-186; seedSeq/onRetire incl.); `createReconstruction(pi, {config, host, drafts})` (:204-208, stale "Drafts are NEVER restored (Q6=B)" comment :203-205); upsert/reopen fresh-open `openPanel(resumeSurface, { config, state, drafts, inputCapture })` (:274); `registerInterrogateCommand(pi, config, panelHost, { drafts, inputCapture, debug })` (:311); `registerPanelShortcut(pi, config, panelHost, { drafts, inputCapture })` (:320).
- `src/command.ts`: opts `{ drafts?, inputCapture? }` (:107-109); fresh-open row `openPanel(pi, {..., drafts: opts.drafts, inputCapture: opts.inputCapture})` (:157-162) — /interrogate is THE post-restart user path (SURFACE-002) and currently lacks durableInputs.
- `src/panel/actions.ts` (:971-976): submit ships → `retireCapture(id, ["writein","elaboration"])` + `retireCapture("-", ["note"])`.
- Test harness precedent: `src/panel/retirement-sidechat.test.ts` — direct-constructed REAL panel + real engine over fake port + shared InputCaptureStore (sink→durable write, onRetire→durable retire over tmpdir — the index.ts wiring shape) + fake sessionManager on `pi` (live branchReader). `src/input-durability.test.ts` — real os.tmpdir() fs + rmSync cleanup registry (:28-32), fake timers, fault-injectable fs adapter.

## 4. Design decisions (this PRP)

1. **No eager staging of question drafts** (writein/elaboration) at session_start: S1's ladder reads the durable tier lazily at field open (ancestry-scanned), which already resolves durable-vs-answer by savedAt. Eager seam staging would (a) clobber nothing but risks WRONG tier precedence — a stale draft staged into the seam (tier b) would beat a NEWER answer (applyChatAnswer commits without retiring), and (b) duplicate the ladder. Session_start stages ONLY the note (no field-open ladder tier exists for the note — S1 explicitly excluded it).
2. **Note staging seam**: `restoreSessionNote(durable, drafts, walkIds)` — ancestry scan `{questionId:"-", field:"note"}`, stage via `drafts.setNote(text)` ONLY when `drafts.getNote() === ""` (restart case; in-process reload keeps live memory — never clobber newer typing) and durable text nonempty. enterNoteMode's existing seed then finds it — zero panel.ts changes for the note.
3. **Session_start placement**: optional `restoreDrafts?: (walkIds: readonly string[]) => void` on ReconstructionOptions, invoked in `reconstructFromBranch` once state is installed + non-empty, for origin "session-start" ONLY (TUI and non-TUI both — staging is UI-less), never session-tree (tree nav is silent state-follow; drafts follow in-memory rules), never on no-state branches. Stale Q6=B comments in reconstruct.ts/index.ts/ReconstructionOptions updated.
4. **Composer restore at cold-create only**: inside `routed.onChat`'s `if (record === undefined || record.questionId !== qid)` branch, after `openSidechatRecord(qid, ...)`: `p.restoreComposerDraft(qid)` — panel method; guards: durableInputs present, `chatField.getText() === ""` (NEW-003 spirit — never clobber mid-sentence text), ancestry-scanned `sidechat-composer` value for THAT qid, text nonempty; seed via `chatField.setText` (capture-suppressed — never mints). Runs at EVERY cold create, not just post-restart — that IS the failed/aborted-send recovery limb (S3 retires nothing there). `/clear`/`/new` (resetChat) deliberately NOT seeded (fresh-start gesture). Conversation never restores (SIDECHAT-002).
5. **`latestFieldOnLineage`** (general field form incl. "note" and "sidechat-composer") added to input-restore.ts beside S1's narrowed `latestDraftOnLineage` (writein|elaboration) — S1's exported surface untouched; shared scan logic internal.
6. **Wiring gap S2 closes**: thread `durableInputs` into the panel paths S1 did not cover: `OpenPanelOptions` (+construction site :3227), index.ts :274 upsert/reopen fresh-open, command.ts opts/call (:107-162 /interrogate — the FR-28 user path), registerPanelShortcut (index.ts:320). Without this, /interrogate-after-restart panels have no durable tier and case 1 FAILS for Other/text/elaboration.
7. **Case 4-commit-half scripted sides**: A = kill after completed save, before the commit seam (no answer in restart walk; durable file intact) → reopen → exact draft, no answer; B = commit durably recorded (submission delta in restart walk) + capture retired → reopen → ladder seeds `answer.value` (replay-minted answer.at beats pre-kill savedAt), no resurrection (file gone), no repeat commit / no submission trigger (reconstruction read-only; auto-submit only fires at panel commit time).

## 5. Parallel-execution risk (S1 in flight)

S2 consumes S1's `src/input-restore.ts` (recoverySeedText, latestDraftOnLineage, DurableRead), the panel's `durableInputs` dep + private walkIds() helper, and maybeAutoOpen threading. Task 0 verifies shipped names; fallback documented in the PRP (add walkIds helper locally if S1 shipped a different name; do not widen S1's exported signatures).

---
name: "P3.M3.T1.S2 — Session-start restore (FR-28) incl. side-chat composer; acceptance cases 1 and 4-commit-half (Local input recovery)"
description: "EXTEND src/input-restore.ts (S1's module) with latestFieldOnLineage (general field form — note + sidechat-composer keys) and restoreSessionNote (ancestry-scanned note staging into the extension-lifetime DraftStore, absent-only guard). MODIFY src/reconstruct.ts: optional restoreDrafts hook on ReconstructionOptions invoked in the session-start tail (state non-empty; TUI AND non-TUI; NEVER session-tree, never no-state) + update the three stale 'Drafts are NEVER restored (Q6=B)' doc comments (reconstruct.ts:649-651, ReconstructionOptions.drafts :238-241, index.ts:203-205 — superseded by decisions.md 'Later decision — panel input recovery'). MODIFY src/panel/panel.ts: restoreComposerDraft(qid) method seeded at the routed.onChat COLD-CREATE branch (right after openSidechatRecord; guards: getText()===\"\", durable text nonempty, ancestry match for THAT questionId, chatField.setText capture-suppressed — conversation NEVER restores, SIDECHAT-002); thread durableInputs into OpenPanelOptions + the openPanel construction site. MODIFY src/index.ts + src/command.ts: wire restoreDrafts into createReconstruction; thread durableInputs into the upsert/reopen fresh-open (index.ts:274), registerInterrogateCommand (command.ts:107-162 — the post-restart /interrogate user path), registerPanelShortcut. Question drafts (writein/elaboration) restore LAZILY through S1's ladder — NO eager seam staging (stale-draft-beats-newer-answer hazard). CREATE src/panel/session-restore.test.ts (retirement-sidechat.test.ts harness: real panel + tmpdir DurableInputStore + index.ts-shaped capture wiring + fake sessionManager walk) scripting acceptance case 1 (Other, text, side-chat, elaboration, batch-note limbs) and case 4-commit-half (both sides of the save/commit handoff). SURFACE-002 invariant: NOTHING here opens the panel — the widget line stays the only cue. Consumed by P3.M5.T1.S1 (final gate)."
---

## Goal

**Feature Goal**: FR-28 (updated): on session start with live questions, state restores SILENTLY and the user's durable editor drafts restore across the restart for ALL five duties — Other/write-in and text answers and elaboration (lazily at field open through S1's ladder), the batch note (staged at session_start into the DraftStore seam), and the side-chat composer (seeded when a chat is cold-created on its question). The side-chat CONVERSATION is never restored (SIDECHAT-002); only the composer's saved edit. The panel NEVER auto-opens — restore is not a surface (SURFACE-002); the widget line remains the only ambient cue. Restart never repeats a commit, never triggers a submission, and never resurrects a retired value.

**Deliverable**:
1. `src/input-restore.ts` (extend, S1's module) — `latestFieldOnLineage(...)` (ancestry scan over `DurableInputStore.latest()` for ANY `CaptureField`, incl. `"note"` questionId `"-"` and `"sidechat-composer"`) and `restoreSessionNote(...)` (stage the ancestry-matched note into the DraftStore, absent-only).
2. `src/reconstruct.ts` (modify) — optional `restoreDrafts?: (walkIds: readonly string[]) => void` on `ReconstructionOptions`, invoked in the session-start tail; stale Q6=B doc comments updated.
3. `src/panel/panel.ts` (modify) — `restoreComposerDraft(qid)` + call at the `routed.onChat` cold-create branch; `durableInputs` added to `OpenPanelOptions` and the openPanel construction site.
4. `src/index.ts` + `src/command.ts` (modify) — `restoreDrafts` wiring into `createReconstruction`; `durableInputs` threaded into the upsert/reopen fresh-open, `registerInterrogateCommand`, and `registerPanelShortcut` panel paths.
5. `src/panel/session-restore.test.ts` (new) — scripted acceptance case 1 (all five limbs) and case 4-commit-half (both sides), plus SURFACE-002/cross-branch/no-send invariants; unit extensions in `src/input-restore.test.ts` and `src/reconstruct.test.ts`.

**Success Definition**: `npm test`, `npm run typecheck`, `npm run lint` green; S1/S2/S3 suites, sidechat-cache-isolation, editor-preservation, retirement-sidechat, no-hardcoded-keys untouched-green. Scripted green: case 1 (type half a response in the real Other, text, and side-chat editors → hard-kill after a completed save without Enter/blur/suspend/graceful shutdown → resume the same branch → reopen the field → EXACT draft, byte-for-byte, no answer recorded, nothing sent; repeat for elaboration and batch note) and case 4-commit-half (Enter on a nonblank write-in, kill on either side of the save/commit handoff → the saved text remains recoverable as draft or committed answer; restart neither repeats the commit nor triggers submission). Restore never opens the panel, never calls `applyAnswer`/submit/send/model, never mutates answers, never retires anything.

## User Persona (if applicable)

**Target User**: The pi user whose terminal/process died mid-interrogation (hard kill, OOM, laptop sleep) with half-typed text in an editor.

**Use Case**: Restart pi on the same branch → the interrogation state restores silently (widget line only) → run `/interrogate` → open the field they were typing in → their half-typed text is back, byte-exact, and nothing was answered or sent on their behalf.

**User Journey**: type → crash → restart → widget line shows live counts → `/interrogate` → reopen field (✎ row/`enter`, `ctrl+t`, `n` for note, `c` for chat on that question) → exact draft present → finish typing → commit/send as a fresh user gesture.

**Pain Points Addressed**: losing half-typed answers to a crash; retyping multiline Unicode elaborations; losing a side-chat prompt to a restart while the (correctly) dead conversation stays dead; restarts that duplicate sends/commits.

## Why

- Binding spec: `spec/state-and-persistence.md` §Local input recovery :137-140 + acceptance cases :145 (case 1) and :148 (case 4); `spec/product-requirements.md:60` FR-28 ("New requirement: restore matching editor drafts per local input recovery"; SURFACE-002 unchanged); `spec/decisions.md:171` "Later decision — panel input recovery" (supersedes Q6=B for editor input, NOT SIDECHAT-002's transcript) — all READ-ONLY.
- Upstream contracts (landed): `src/input-capture.ts` (five-duty capture, CaptureKey with RAW walk-tip `branchId`, capture-suppressed programmatic `setText`), `src/input-durability.ts` (`latest(DurableKeyQuery)`, tombstone-aware `undefined`, deliberate `{text:""}`, `<agentDir>/data/interrogator`), S3 retirement (handoff order; refused/failed/aborted chat send retires NOTHING).
- In-flight contract: P3.M3.T1.S1 (parallel) ships `src/input-restore.ts` (`recoverySeedText`, ancestry-gated `latestDraftOnLineage` narrowed to writein|elaboration, `DurableRead`), the panel `durableInputs` dep + private walk-id helper, and maybeAutoOpen threading. This item CONSUMES those exports and closes the remaining restore surfaces: the note (no ladder tier — S1 excluded it), the composer, and the session_start integration + panel-path wiring.
- Design authority: `plan/006_45773b259b06/architecture/input-recovery.md` — consumers map row P3.M3.T1.S2 (keying ancestry restore rule, captureSeams chatField, failureSemantics, storagePath → cases 1 and 3); "Restored content is editor TEXT only (setText/seed), applied through the existing draft-seaming seams in P3.M3 — never through an answer path."
- Downstream: P3.M5.T1.S1 runs the full acceptance gate (cases 1-5) over this integration.

## What

### Behavior

1. **Session-start note staging (the "load matching recovery values" step)**: when `reconstructFromBranch` runs with origin `session-start` and a non-empty installed state (TUI and non-TUI alike — staging is UI-less), it calls `opts.restoreDrafts?.(walkIds)` with the raw walk entry ids. index.ts wires that to `restoreSessionNote(durableInputs, drafts, walkIds)`: ancestry-scan `{questionId:"-", field:"note"}`; if the newest matching durable value has nonempty text AND the extension-lifetime DraftStore seam is empty (`drafts.getNote() === ""`), stage it via `drafts.setNote(text)`. The absent-only guard means an in-process reload/resume NEVER clobbers live newer typing with an older durable copy; after a restart the seam is empty so the note restores. A deliberate durable empty note stages nothing (blank editor == the user's last edit — there is no answer tier for the note). `enterNoteMode`'s existing seed (`drafts?.getNote() || batchNote || ""`, panel.ts:2363) then finds the staged note — NO panel change for the note.
2. **Question drafts restore lazily (S1's ladder — do NOT duplicate)**: writein/elaboration recovery values are read at field-open time through S1's `seedTextFor` → `latestDraftOnLineage` + `recoverySeedText`. This item's only duty for them is WIRING: every post-restart panel construction path must receive `durableInputs` (Task 4), else the ladder's durable tier is dead and case 1 fails for Other/text/elaboration.
3. **Side-chat composer restore (cold create)**: in `routed.onChat`'s cold-create branch (`record === undefined || record.questionId !== qid`), immediately after `openSidechatRecord(qid, args.chatRebindDeps)`, call `p.restoreComposerDraft(qid)`. The method: no-op when `durableInputs` is absent; no-op unless `chatField.getText() === ""` (never clobber mid-sentence typing — NEW-003's spirit); ancestry-scan `{questionId: qid, field: "sidechat-composer"}`; seed via `chatField.setText(v.text)` (capture-suppressed — the seed never mints a capture and never overwrites a deliberate durable `""` — skip empty values). This runs at EVERY cold create, not just post-restart: that IS the "refused or failed send or aborted turn leaves the prompt recoverable" limb (S3 retires nothing there; a clean send+settle retired the capture so nothing restores). `/clear`/`/new` (`resetChat`) deliberately do NOT re-seed — a fresh-start gesture. The CONVERSATION never restores (SIDECHAT-002); `openOrReplace` builds a fresh record exactly as today.
4. **SURFACE-002 is absolute**: nothing in this item opens, reopens, or focuses the panel; no widget changes beyond what reconstruction already does; restore emits no events, no notices, no model-visible output. The suspend widget line stays the only cue.
5. **No side effects (spec :139)**: restore paths call ONLY `durable.latest()` reads and `TextField.setText`/`drafts.setNote`. Never `applyAnswer`, never submit/auto-submit, never chat send, never retirement, never state mutation. Restart neither repeats a commit (reconstruction replays recorded deltas read-only, exactly once) nor triggers submission (auto-submit fires only at panel commit time).
6. **Cross-branch safety (case 3 boundary, inherited)**: the ancestry scan accepts only capture tips on the CURRENT walk; sibling-branch values are invisible by construction; `/tree` navigation (origin `session-tree`) NEVER runs the restore step — it stays silent state-follow with in-memory draft rules.
7. **Case 4-commit-half semantics (scripted, both sides)**: side A — kill after a completed save, before the commit seam: restart walk has no answer record, durable file intact → reopen field → exact draft as DRAFT, no answer. Side B — commit durably recorded (submission delta in the restart walk) and capture retired at the handoff: restart reconstructs the answer (replay mints `answer.at` = restart time, newer than any pre-kill `savedAt`), the durable file is gone → reopen field → S1's ladder seeds `answer.value` byte-exact; no draft resurrection; no repeat commit; no submission.

### Success Criteria

- [ ] Case 1 scripted green for all five limbs: Other, text question, elaboration, batch note, side-chat composer — exact expanded string (multiline/Unicode/whitespace included), no answer recorded, no send, after a simulated hard kill (abandoned stores, no dispose/forceFlush/shutdown) + fresh stores + same-branch walk.
- [ ] Case 4-commit-half scripted green on BOTH sides: draft-recoverable (side A) / answer-committed-and-no-resurrection (side B); restart replays the commit exactly once and triggers no submission.
- [ ] Session-start note staging: stages on empty seam after restart; never stages when the seam holds live text; never stages empty durable text; runs for non-TUI too; never runs for `session-tree` origin or no-state branches.
- [ ] Composer: seeds on cold create (incl. post-restart and post-failed-send); never clobbers nonempty composer text; seeds only the matching questionId; never sends or touches the engine; `/clear` does not seed.
- [ ] `durableInputs` reaches panels opened via `/interrogate` (command.ts fresh-open), the upsert/`{reopen:true}` fresh-open (index.ts:274), the panel shortcut, and maybeAutoOpen (S1) — assert the panel's durable tier is live on each path.
- [ ] Restore never opens the panel: scripted restart leaves the host closed; only the widget line appears (existing SURFACE-002 tests stay green untouched).
- [ ] No answer/submit/send/model surface is reachable from any restore path (static + behavioral audit).
- [ ] All pre-existing tests green untouched; S1's input-restore tests unaffected (its exported surface unchanged).

## All Needed Context

### Context Completeness Check

Validated: binding spec bullets + cases 1/4 read in full; FR-28 + decisions.md :171 + FR-15 SIDECHAT-002 boundary read; architecture note consumers map + keying/restore-matching + retirement order + allowed-surface read; landed S1/S2/S3 source verified (CaptureField incl. "note"/"sidechat-composer"; DurableKeyQuery/DurableValue/latest; tombstones; consumeCommittedBuffer handoff order; captureKeyForChatField/captureKeyForTextField; retireCapture "-" note key at submit); reconstruct.ts run tails + `answer.at` replay-fresh mint (:462) + stale Q6=B comments located; every panel-open path audited (maybeAutoOpen S1-threaded; openPanel :3172/:3227; index.ts :274; command.ts :107-162; registerPanelShortcut); onChat cold-create seam read at content anchors; enterNoteMode note seed read; DraftStore getNote/setNote read; harness precedents read (retirement-sidechat.test.ts composed wiring; input-durability.test.ts tmpdir/fs-fault patterns; panel.test.ts makeMockLifecycle). S1's PRP consumed as the in-flight contract (exports, panel deps, walk-id helper, phantom guard). Full detail: `plan/006_45773b259b06/P3M3T1S2/research/findings.md`.

### Documentation & References

```yaml
- file: spec/state-and-persistence.md
  why: §Local input recovery :137-140 (restore scope, no-side-effects, origin-only restore)
    + acceptance cases :145 (case 1) and :148 (case 4) — the binding behaviors this item scripts
  gotcha: READ-ONLY — never edit spec/

- file: spec/product-requirements.md
  why: :60 FR-28 (silent restore; panel NEVER auto-opens; "restore matching editor drafts");
    :41 FR-15 (conversation does not survive restart; composer recovery is separate)
  gotcha: READ-ONLY

- file: spec/decisions.md
  why: :171 "Later decision — panel input recovery" — the Q6=B supersession line the stale
    source comments must be updated to cite
  gotcha: READ-ONLY

- file: plan/006_45773b259b06/architecture/input-recovery.md
  why: consumers map :313 (this item = session-start + composer restore; cases 1 and 3);
    §keying "Restore matching" (ancestry-or-equal rule, sibling exclusion); §retirement #3
    (handoff order — the case-4 boundary); "Allowed surface ... editor TEXT only (setText/seed)"
  gotcha: the note's ancestry scan needs questionId "-"; S1's exported latestDraftOnLineage is
    NARROWED to writein|elaboration — add the general form, do not widen S1's signature

- file: plan/006_45773b259b06/P3M3T1S1/PRP.md
  why: the in-flight contract — input-restore.ts exports (recoverySeedText,
    latestDraftOnLineage, DurableRead, SeedAnswer), the panel durableInputs dep, the private
    walk-id helper (walkIds()-shaped), seedTextFor sites, maybeAutoOpen threading, phantom guard
  gotcha: S1 lands FIRST or in parallel — Task 0 verifies shipped names; if the walk-id helper
    has a different name, use the shipped one; never re-implement the ladder here

- file: src/input-durability.ts
  why: latest(DurableKeyQuery) read surface; DurableValue {text, seq, savedAt?};
    undefined = never-captured OR tombstoned; {text:""} = deliberate empty; default dir
    <agentDir>/data/interrogator (:176, :260)
  gotcha: DO NOT MODIFY (S1-S3 owned); DurableKeyQuery REQUIRES branchId — pass each walk id

- file: src/input-capture.ts
  why: CaptureField vocabulary (:62 — "note" and "sidechat-composer" included); CaptureKey
    branchId = RAW walk-tip entry id (:70-74); programmatic setText is capture-suppressed
  gotcha: DO NOT MODIFY; never read the capture store's in-memory pending state for restore

- file: src/reconstruct.ts
  why: the session_start integration site — ReconstructionOptions (:233-242),
    reconstructFromBranch run tails (~:625-652: non-TUI early return, session-tree silent
    branch, session-start SURFACE-002 tail), replaySubmission's FRESH answer.at mint (:462),
    stale "Drafts are not restored (Q6=B)" comment (:649-651)
  pattern: add the optional restoreDrafts hook; compute walk ids from
    ctx.sessionManager.getBranch() with per-entry typeof guards (session files are untrusted)
  gotcha: invoke for origin "session-start" ONLY, on the non-empty-state paths, BEFORE the
    TUI/non-TUI split; reconstruction itself stays read-only toward persistence

- file: src/index.ts
  why: wiring — durableInputs/inputCapture construction (:166-186, the seedSeq/onRetire shape
    restoreDrafts composes with), createReconstruction call (:204-208 + stale comment :203-205),
    upsert/reopen fresh-open openPanel (:274), registerPanelShortcut (:320)
  gotcha: keep durableInputs extension-lifetime (never disposed); pass it by the SAME narrow
    read type the panel uses (DurableRead-shaped)

- file: src/command.ts
  why: /interrogate — THE post-restart user path (SURFACE-002): opts {drafts, inputCapture}
    (:107-109) → openPanel fresh-open row (:157-162); thread durableInputs through both
  gotcha: this path currently has NO durable tier — without it case 1 fails for Other/text

- file: src/panel/panel.ts
  why: routed.onChat cold-create seam (~:1341-1385 — the composer-restore hook site, right
    after openSidechatRecord ~:1367); captureKeyForChatField (:1799-1806 — the composer key
    shape to mirror); enterNoteMode note seed (:2361-2368 — UNCHANGED, finds the staged note);
    openPanel (:3172) + construction opts (:3227); consumeCommittedBuffer handoff order
    (:1876-1899 — the case-4 boundary); branchReader/captureBranchId (:1752-1764)
  pattern: restoreComposerDraft mirrors captureKeyForChatField's key resolution + the
    hostile-surface walk-id guard; locate all sites by content (comments cite the rulings),
    line numbers drift
  gotcha: never seed when a live record matches qid (the cold-create if scopes it); never
    touch focusChatInput/setView ordering

- file: src/draft-store.ts
  why: getNote(): string / setNote(text) (:80-90) — the note staging seam; extension-lifetime
    store created once in index.ts
  gotcha: "" from getNote() = absent-or-empty (equivalent here); setNote is NOT destructive-
  guarded (only clearDraft/clearAll are) — the absent-only guard lives in restoreSessionNote

- file: src/panel/retirement-sidechat.test.ts
  why: THE harness precedent — direct-constructed real panel + real engine over a fake port +
    shared InputCaptureStore (sink→durable write, onRetire→durable retire over a tmpdir — the
    index.ts wiring shape) + fake sessionManager on pi (the live branchReader)
  gotcha: real timers for the engine; use forceFlush as the sanctioned completed-save seam —
    never timer-advance the engine

- file: src/input-durability.test.ts
  why: tmpdir lifecycle (mkdtempSync + rmSync registry :28-32) and fs fault-injection patterns
  gotcha: register every tmpdir for afterEach cleanup

- url: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date#date_time_string_format
  why: ISO-8601 extended strings compare chronologically as plain strings — savedAt ordering
    inside latestFieldOnLineage (same-format assumption documented in S1; reuse it)
```

### Current Codebase tree (relevant slice)

```bash
src/input-restore.ts               # S1 (in flight) — ladder + latestDraftOnLineage (writein|elaboration)
src/input-restore.test.ts          # S1 tests — EXTEND here
src/input-capture.ts               # landed S1-S3 — READ-ONLY here
src/input-durability.ts            # landed S1-S3 — READ-ONLY here
src/reconstruct.ts                 # session_start/session_tree reconstruction — ADD restoreDrafts hook
src/index.ts                       # activation wiring — restoreDrafts + durableInputs threading
src/command.ts                     # /interrogate — thread durableInputs
src/panel/panel.ts                 # onChat cold-create seed + OpenPanelOptions.durableInputs
src/panel/panel.test.ts            # panel harness (makeMockLifecycle) — untouched unless wiring asserts
src/panel/retirement-sidechat.test.ts  # composed harness precedent for the new test file
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/input-restore.ts               # EXTEND — latestFieldOnLineage (any CaptureField, questionId "-")
                                   #   + restoreSessionNote (absent-only DraftStore staging)
src/input-restore.test.ts          # EXTEND — units for both new functions
src/reconstruct.ts                 # MODIFY — restoreDrafts hook option + invocation + comment updates
src/index.ts                       # MODIFY — wire restoreDrafts; thread durableInputs (:274, :320)
src/command.ts                     # MODIFY — thread durableInputs into opts + openPanel call
src/panel/panel.ts                 # MODIFY — restoreComposerDraft + onChat cold-create call +
                                   #   OpenPanelOptions.durableInputs + construction-site pass-through
src/panel/session-restore.test.ts  # CREATE — scripted acceptance cases 1 and 4-commit-half +
                                   #   SURFACE-002 / cross-branch / no-send invariants
src/reconstruct.test.ts            # EXTEND — restoreDrafts hook firing matrix
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: NEVER stage question drafts (writein/elaboration) into the DraftStore seam at
// session_start. A staged draft would sit at ladder tier (b) and beat a NEWER committed answer
// (applyChatAnswer commits without retiring — S1's ladder resolves that only at tier (c) via
// savedAt > answer.at). The note is the ONLY eager staging (it has no answer tier and no S1
// ladder coverage).
// CRITICAL: the absent-only guard on setNote — session_start ALSO fires in-process
// (reload|resume|fork); staging over a live seam would resurrect an older note over newer
// typing. Stage only when drafts.getNote() === "" AND the durable text is nonempty.
// CRITICAL: answer.at is minted FRESH at reconstruction replay (reconstruct.ts:462) — after a
// restart every reconstructed answer is newer than every pre-kill savedAt. That is exactly why
// case-4 side B seeds answer.value (byte-identical to the retired draft) and why no
// draft-vs-answer special-casing is needed post-restart.
// CRITICAL: the composer seed must run ONLY inside the cold-create branch (record === undefined
// || record.questionId !== qid) AND only when chatField.getText() === "" — a live record's
// composer text is the live chat's; clobbering it violates NEW-003's never-hijack-typing rule.
// Seed via chatField.setText (captureSuppressed) — a seed that minted a capture would overwrite
// a deliberate durable "" (resurrection).
// GOTCHA: restoreDrafts fires for origin "session-start" on BOTH the TUI and non-TUI tails —
// the non-TUI branch returns early right after; put the hook call BEFORE that split. NEVER on
// session-tree, never on no-state/empty-state branches (nothing will ever open there).
// GOTCHA: walk ids come from ctx.sessionManager.getBranch() with per-entry typeof guards —
// session files are untrusted persisted data (reconstruct.ts's own posture); a malformed entry
// id must degrade to skipping that id, never crash session_start.
// GOTCHA: DurableKeyQuery REQUIRES branchId and takes ONE questionId — the ancestry scan loops
// latest() per walk id (S1's pattern); seq is per-key and comparable only within one branchId;
// order cross-branch candidates by savedAt (ISO), tie → later walk position (later loop index).
// GOTCHA: "hard kill" in tests = abandon store/panel references WITHOUT dispose/forceFlush
// (dispose/forceFlush are graceful accelerators, not the crash model). The completed save must
// already be on disk BEFORE the kill (forceFlush → write outcome asserted).
// GOTCHA: eslint unused vars need leading underscore; vitest fake timers only where no async
// engine is involved; the new test file follows retirement-sidechat.test.ts (real timers for
// engine paths, forceFlush for capture).
// GOTCHA: the three stale "Drafts are NEVER restored (Q6=B)" comments (reconstruct.ts :649-651,
// ReconstructionOptions.drafts doc, index.ts :203-205) MUST be rewritten to cite decisions.md
// :171 — a stale comment asserting the opposite of shipped behavior is a review blocker.
```

## Implementation Blueprint

### Data models and structure

```ts
// src/input-restore.ts — additions beside S1's exports (S1's surface UNTOUCHED)
import type { CaptureField } from "./input-capture.js";
import type { DurableValue } from "./input-durability.js";

/**
 * General ancestry scan — ANY CaptureField (adds "note" with questionId "-" and
 * "sidechat-composer"): newest durable value for {questionId, field} whose capture
 * tip is on the CURRENT walk. Same ordering rule as S1's latestDraftOnLineage
 * (savedAt ISO, missing = oldest, tie → later walk position; tombstoned/never-
 * captured keys return undefined and drop out). S1's narrowed export stays as-is.
 */
export function latestFieldOnLineage(
  durable: DurableRead,
  walkIds: readonly string[],
  key: { questionId: string | "-"; field: CaptureField },
): DurableValue | undefined;

/** The note-staging seam restoreSessionNote needs (DraftStore satisfies it). */
export interface NoteStageTarget { getNote(): string; setNote(text: string): void }

/**
 * P3.M3.T1.S2 — the session_start "load matching recovery values" step for the note
 * (the one duty with no field-open ladder tier). Stages the ancestry-matched note
 * into the extension-lifetime seam ONLY when the seam is empty and the durable text
 * is nonempty (never clobbers live typing; a deliberate durable empty stages nothing
 * — blank editor is the user's last edit). Returns whether it staged (tests).
 */
export function restoreSessionNote(
  durable: DurableRead,
  drafts: NoteStageTarget,
  walkIds: readonly string[],
): boolean;
// = latestFieldOnLineage(durable, walkIds, {questionId: "-", field: "note"}) —
//   if (v === undefined || v.text === "") return false;
//   if (drafts.getNote() !== "") return false;
//   drafts.setNote(v.text); return true;

// src/reconstruct.ts — ReconstructionOptions addition:
/** P3.M3.T1.S2 (FR-28): session-start draft-restore hook — invoked once state is
 *  installed and non-empty, origin "session-start" ONLY (never session-tree).
 *  Editor-input recovery per decisions.md "Later decision — panel input recovery";
 *  the ONLY UI act remains later field-open seeding (SURFACE-002 holds). */
restoreDrafts?: (walkIds: readonly string[]) => void;

// src/panel/panel.ts — panel method (uses S1's durableInputs dep + walk-id helper):
/** P3.M3.T1.S2 — seed the composer's recovery draft at a COLD chat create on qid
 *  (SIDECHAT-002: conversation never restores; input does — FR-28). Capture-suppressed. */
restoreComposerDraft(questionId: string): void;
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY contracts (read pass — S1 lands in parallel)
  - READ shipped src/input-restore.ts: confirm export names (recoverySeedText,
    latestDraftOnLineage, DurableRead), the panel durableInputs dep name, and the
    private walk-id helper's shipped name (PRP says walkIds()); adapt Task 3/5 to
    the shipped names — NEVER widen or rename S1's exported signatures
  - READ src/reconstruct.ts run tails + src/command.ts opts; GREP for any OTHER
    openPanel call site (expected complete set: panel.ts:3227-adjacent construction,
    index.ts:274, command.ts:157, maybeAutoOpen :3445/:3448) so the threading is total

Task 1: EXTEND src/input-restore.ts
  - IMPLEMENT: latestFieldOnLineage (general field form — share the scan loop with
    S1's function via a private core or an independent 10-line loop; KEEP S1's
    exported signature byte-identical) + restoreSessionNote (absent-only, nonempty
    durable, boolean return)
  - JSDoc: cite spec :137-140, FR-28, decisions.md :171, the architecture note's
    restore-matching rule, and the absent-only guard's in-process-clobber rationale
  - NAMING/PLACEMENT: exactly as in the data model; no panel/state/fs imports

Task 2: EXTEND src/input-restore.test.ts
  - UNITS: note key accepted (questionId "-"); composer key; empty-walk → undefined;
    tombstone-shaped absence (latest returns undefined → no stage); absent seam +
    nonempty durable → stages (setNote called with exact text); nonempty seam →
    NEVER stages; empty durable text → never stages; sibling-branch walk (id not in
    walk) → ignored; savedAt ordering + walk-position tie (two accepted candidates)

Task 3: MODIFY src/reconstruct.ts — the session-start hook
  - ADD optional restoreDrafts to ReconstructionOptions (doc comment per data model)
  - IN reconstructFromBranch: after the non-empty check (past both no-state returns),
    when origin === "session-start": compute walkIds from
    ctx.sessionManager.getBranch() (Array.isArray guard; per-entry typeof id ===
    "string" filter) and call opts.restoreDrafts?.(walkIds) — BEFORE the non-TUI
    early return so both TUI and non-TUI stage; session-tree keeps returning without it
  - UPDATE the three stale Q6=B comments (run tail :649-651, ReconstructionOptions.drafts
    doc, and index.ts's twin in Task 4) to: editor-input recovery now stages the note at
    session_start and restores question drafts lazily at field open (decisions.md :171);
    the transcript and answers are still never restored; the panel still never opens
  - PRESERVE: every existing return shape, updateSuspendWidget placement, replay logic

Task 4: WIRE src/index.ts + src/command.ts + panel path threading
  - index.ts createReconstruction: add restoreDrafts: (walkIds) =>
    { restoreSessionNote(durableInputs, drafts, walkIds); } (durableInputs/drafts from
    the activation closure :166+); update the stale comment at :203-205
  - index.ts :274 upsert/reopen fresh-open: add durableInputs to the openPanel opts
  - command.ts: add durableInputs?: DurableRead to the command opts interface
    (:107-109-adjacent) and pass it in the openPanel fresh-open call (:157-162);
    index.ts registerInterrogateCommand call gains durableInputs
  - index.ts registerPanelShortcut (:320): pass durableInputs through its opts → its
    openPanel path
  - panel.ts: OpenPanelOptions gains durableInputs?: DurableRead; the construction
    site passes it next to inputCapture (:3227-adjacent); the panel stores it in the
    SAME member S1 defined (verify Task 0) — no second dep field

Task 5: IMPLEMENT src/panel/panel.ts — restoreComposerDraft + the onChat hook
  - ADD restoreComposerDraft(questionId) per the data model: no-op without
    durableInputs; guard this.chatField.getText() === ""; v = latestFieldOnLineage(
    this.durableInputs, this.walkIds(), {questionId, field: "sidechat-composer"});
    if (v !== undefined && v.text !== "") this.chatField.setText(v.text)
  - CALL it inside routed.onChat's cold-create branch, immediately AFTER
    openSidechatRecord(qid, args.chatRebindDeps) and BEFORE the usage-notice/setView
    tail: p.restoreComposerDraft(qid) — the if already scopes record === undefined ||
    record.questionId !== qid; a live same-question record is NEVER touched
  - DO NOT touch: focusChatInput, setView ordering, resetChat, the engine, send
    cleanup, enterNoteMode (the staged note flows through its existing seed)

Task 6: CREATE src/panel/session-restore.test.ts (scripted cases — retirement-sidechat
        harness: real panel, tmpdir DurableInputStore, index.ts-shaped capture wiring,
        fake sessionManager on pi with controlled entry-id walks)
  - GROUP case 1 — question editors (Other): type multiline Unicode-with-whitespace
    into the ✎ Other field → forceFlush → assert write outcome (completed save) →
    HARD-KILL (drop refs; no dispose) → fresh DurableInputStore(same tmpdir) + fresh
    panel + walk [e1, e2] where e1 was the capture tip → reopen field (focusTextField
    duty "writein") → editor text BYTE-EXACT; assert NO answer in state, epoch
    unchanged, no submission
  - GROUP case 1 — text question + elaboration limbs: same shape with a type:"text"
    question (desiredTextDuty) and an option-answered question's elaboration duty
  - GROUP case 1 — batch note limb: type note → forceFlush → kill → fresh stores →
    run restoreSessionNote(durable, drafts, [e1, e2]) (the exact function the
    session_start hook calls) → enterNoteMode → editor text byte-exact; PLUS a
    reconstruct-level test (Task 7) proving the hook fires
  - GROUP case 1 — side-chat limb: open chat on q (chatRebindDeps) → type composer
    prompt → forceFlush → kill (engine never invoked) → fresh panel + stores →
    onChat(q) cold create → composer text byte-exact; assert ZERO model-port calls
    (no send), no messages, no sidechat submission
  - GROUP case 4-commit-half side A: nonblank write-in → forceFlush (save completed)
    → kill BEFORE the commit seam (no enter processing) → restart walk WITHOUT any
    answer/submission record → reopen → exact draft as DRAFT, no answer, no commit
    replay, no submission
  - GROUP case 4-commit-half side B: enter-commit through the real writeInEnter seam
    (applyAnswer + consumeCommittedBuffer retire ran; craft the restart walk WITH the
    submission delta entry) → fresh stores (tombstone lost, file unlinked by retire) →
    reconstruct-style state with the answer → reopen ✎ Other → ladder seeds
    answer.value byte-exact; assert the durable key is GONE (no resurrection), state
    applied exactly once, epoch stable, NO submission triggered by restore/reopen
  - GROUP invariants: SURFACE-002 (restart flow never constructs/opens a panel host —
    only the widget seam; assert the host stays closed through the restore wiring);
    cross-branch (capture tip NOT in walk → nothing restores on any duty); composer
    never clobbers nonempty live text; /clear-equivalent (resetChat) does not seed;
    staging never runs for session-tree origin (reconstruct-level)

Task 7: EXTEND src/reconstruct.test.ts
  - restoreDrafts fires: session-start origin + non-empty state + TUI (walk ids match
    ctx entries, order preserved); session-start + non-TUI (fires BEFORE the fallback
    return); does NOT fire: session-tree origin (any state), no-state branch, empty-
    questions branch, hook absent (no crash — optional chaining); malformed entry ids
    filtered (a non-string id entry cannot crash the hook invocation)
  - REUSE the existing fake-ctx/entry builders in that file

Task 8: VALIDATE
  - npm test && npm run typecheck && npm run lint
  - npx vitest run src/panel/session-restore.test.ts src/input-restore.test.ts
    src/reconstruct.test.ts src/input-durability.test.ts src/input-capture.test.ts
    src/panel/retirement-sidechat.test.ts src/panel/sidechat-cache-isolation.test.ts
    src/panel/editor-preservation.test.ts src/no-hardcoded-keys.test.ts   # all green
```

### Implementation Patterns & Key Details

```ts
// The general ancestry scan (input-restore.ts) — same rule as S1's, any field:
export function latestFieldOnLineage(durable, walkIds, key) {
  let best: DurableValue | undefined; let bestAt = "";
  for (const id of walkIds) {                          // oldest → newest
    const v = durable.latest({ branchId: id, questionId: key.questionId, field: key.field });
    if (v === undefined) continue;                     // never captured OR tombstoned
    const at = v.savedAt ?? "";                        // missing savedAt = oldest
    if (best === undefined || at >= bestAt) { best = v; bestAt = at; } // tie → later pos
  }
  return best;
}

// Session-start hook (reconstruct.ts) — BEFORE the TUI/non-TUI split:
  const nonEmpty = state.orderedQuestions().length > 0;
  // ... existing no-state returns ...
  if (origin === "session-start") {
    const ids: string[] = [];
    const raw = ctx.sessionManager.getBranch();
    if (Array.isArray(raw)) for (const e of raw) if (typeof e?.id === "string") ids.push(e.id);
    opts.restoreDrafts?.(ids); // silent load; the ONLY later UI act is field-open seeding
  }
  // ... existing non-TUI return / session-tree branch / updateSuspendWidget tail ...

// Composer restore (panel.ts) — capture-suppressed, cold-create only:
restoreComposerDraft(questionId: string): void {
  if (this.durableInputs === undefined) return;
  if (this.chatField.getText() !== "") return;         // never hijack live typing (NEW-003)
  const v = latestFieldOnLineage(this.durableInputs, this.walkIds(),
    { questionId, field: "sidechat-composer" });       // THIS question only (spec :137)
  if (v !== undefined && v.text !== "") this.chatField.setText(v.text); // never mints
}

// Hard-kill simulation shape (session-restore.test.ts):
//   const dir = mktmp(); const durable1 = new DurableInputStore({dir});
//   const capture1 = new InputCaptureStore({sink: r => durable1.write(r),
//     seedSeq: k => durable1.lastSeq(k), onRetire: k => durable1.retire(k, {explicit:true})});
//   ... panel1 = new InterrogationPanel({... args, inputCapture: capture1, pi: fakePi([e1])});
//   ... type ...; capture1.forceFlush(); expectWriteCompleted(durable1, key);
//   // KILL: drop refs — NO dispose(), NO forceFlush-after, NO shutdown handler
//   const durable2 = new DurableInputStore({dir});      // fresh process reads same disk
//   const panel2 = new InterrogationPanel({... , pi: fakePi([e1, e2])}); // same branch, grown tip
```

### Integration Points

```yaml
UPSTREAM (consumed, DO NOT modify):
  - DurableInputStore.latest() — the only durable read; tombstone-aware
  - InputCaptureStore — untouched; forceFlush is the test-side completed-save seam
  - S1's input-restore.ts ladder + panel durableInputs dep + walk-id helper
  - S3's retire seams (consumeCommittedBuffer, retireChatCaptureOnSettle, submit retires)

WIRING (this item):
  - reconstruct.ts ReconstructionOptions.restoreDrafts → index.ts createReconstruction →
    restoreSessionNote(durableInputs, drafts, walkIds)
  - OpenPanelOptions.durableInputs → openPanel construction site → panel args (S1's member)
  - index.ts:274 upsert/reopen fresh-open + registerPanelShortcut + registerInterrogateCommand
    (command.ts) — durableInputs reaches every post-restart panel path

DOWNSTREAM (design for, do NOT implement):
  - P3.M5.T1.S1 scripts the full cases 1-5 gate over this integration
  - P3.M4 blank rejection is NOT here — restore never applies answers

OUT OF SCOPE: question-draft eager staging (S1's lazy ladder owns it), transcript restore
  (SIDECHAT-002), session_tree draft restore, blank rejection (P3.M4), README/spec/docs
  (P3.M5.T1.S2), any new config keys or env vars
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck && npm run lint
# Expected: zero errors. Fix before proceeding.
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/input-restore.test.ts -v      # ladder (S1, untouched-green) + new units
npx vitest run src/reconstruct.test.ts -v        # hook firing matrix
npx vitest run src/panel/session-restore.test.ts -v   # scripted cases 1 + 4-commit-half
npm test                                         # full suite green
```

### Level 3: Boundary & Guard Checks

```bash
git diff --name-only
# Expected EXACTLY: src/input-restore.ts(+test), src/reconstruct.ts(+test),
#   src/index.ts, src/command.ts, src/panel/panel.ts, src/panel/session-restore.test.ts
grep -n "applyAnswer\|submit\|sendTurn\|setStatus\|retire" src/input-restore.ts   # no matches (inert)
git diff src/input-capture.ts src/input-durability.ts src/panel/actions.ts src/panel/text-field.ts src/state.ts
# Expected: empty (untouched)
npx vitest run src/panel/retirement-sidechat.test.ts src/panel/sidechat-cache-isolation.test.ts \
  src/panel/editor-preservation.test.ts src/no-hardcoded-keys.test.ts   # green, untouched
grep -rn "Q6=B" src/    # Expected: no remaining stale never-restored claims (comments updated)
```

### Level 4: Domain-Specific Validation (acceptance-casing)

```bash
# Optional real-disk spot check of the composed flow (mirrors session-restore.test.ts):
npx tsx -e 'import {DurableInputStore} from "./src/input-durability.js";
import {restoreSessionNote, latestFieldOnLineage} from "./src/input-restore.js";
import {DraftStore} from "./src/draft-store.js";
const d=new DurableInputStore({dir:"/tmp/restore-check"}); d.write({session:"s",branchId:"t1",questionId:"-",field:"note",text:"half-typed note",seq:1});
const drafts=new DraftStore();
console.log(restoreSessionNote(d,drafts,["t1"]), drafts.getNote());       // true + text
console.log(latestFieldOnLineage(d,["t1"],{questionId:"q1",field:"sidechat-composer"})); // undefined (no capture)'
# Expected: staged note restored; unmatched composer key yields undefined; rm -rf /tmp/restore-check after
```

## Final Validation Checklist

### Technical Validation

- [ ] All 4 validation levels completed; `npm test`, `npm run typecheck`, `npm run lint` green.
- [ ] Boundary diff confined to the six declared files; S1-S3 modules, actions.ts, text-field.ts, state.ts untouched.
- [ ] Stale Q6=B comments rewritten (reconstruct.ts ×2 sites, index.ts) citing decisions.md :171.

### Feature Validation

- [ ] Case 1 green on all five limbs (Other, text, side-chat composer, elaboration, batch note) — byte-exact restore after a simulated hard kill, no answer, no send.
- [ ] Case 4-commit-half green on both sides — draft recoverable pre-handoff; committed answer post-handoff with no resurrection, no repeat commit, no submission.
- [ ] Session-start hook fires exactly on session-start + non-empty state (TUI and non-TUI); never session-tree/no-state; malformed ids filtered.
- [ ] Composer: cold-create seed incl. failed/aborted-send recovery; no clobber of live text; matching question only; `/clear` never seeds; conversation never restores.
- [ ] `durableInputs` live on every post-restart panel path (maybeAutoOpen, /interrogate, upsert/reopen, panel shortcut).
- [ ] SURFACE-002 holds: no restore path opens or focuses the panel; widget line unchanged in behavior.

### Code Quality Validation

- [ ] input-restore.ts additions pure/inert (no panel/state/fs imports; no answer/submit/send surface).
- [ ] S1's exported signatures byte-identical; S1's tests untouched-green.
- [ ] Naming/placement match the desired tree; no new config keys, env vars, or user-visible strings.

### Documentation & Deployment

- [ ] JSDoc on every new/changed export cites the spec lines, FR-28, decisions.md :171, and the architecture note.
- [ ] No README/spec changes (P3.M5.T1.S2 owns them).

## Anti-Patterns to Avoid

- ❌ Don't stage question drafts into the DraftStore seam at session_start — a stale staged draft (tier b) would beat a newer committed answer (applyChatAnswer retires nothing); S1's lazy ladder owns writein/elaboration.
- ❌ Don't stage the note over a nonempty seam — in-process session_start (reload/resume/fork) must never clobber live typing with an older durable copy.
- ❌ Don't seed the composer when a live record matches the question or when the composer holds text — cold-create + empty-composer guards are load-bearing (NEW-003).
- ❌ Don't restore the side-chat conversation, usage, or confirm state — SIDECHAT-002; input only.
- ❌ Don't open, reopen, or focus anything from a restore path — SURFACE-002; restore is not a surface.
- ❌ Don't let restore call applyAnswer/submit/send/retire — restore is read-only toward state and destructive toward nothing (spec :139).
- ❌ Don't run restoreDrafts on session_tree or no-state branches, and don't skip the non-TUI session-start tail.
- ❌ Don't widen or rename S1's input-restore.ts exports; add beside them.
- ❌ Don't simulate hard kill with dispose()/shutdown handlers — the crash model is abandoned references after a COMPLETED save.
- ❌ Don't implement blank rejection (P3.M4) or docs (P3.M5.T1.S2) here.

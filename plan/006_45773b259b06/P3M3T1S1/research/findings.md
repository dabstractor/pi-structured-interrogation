# P3.M3.T1.S1 research findings — editor seeding rules

## 1. Binding requirements (READ-ONLY spec)

- `spec/state-and-persistence.md` §Local input recovery, "Re-edit and commit" bullet:
  "When opening Other or a text-answer editor, use the newer matching draft if present;
  otherwise use the exact recorded write-in or text `answer.value`, or blank if none
  exists. Never seed Other with an option value. An intentional deletion to empty is an
  edit, not an absent draft: preserve the empty editor, not the previous answer text.
  Discarding the edit leaves the recorded answer intact; no delayed save or replay may
  resurrect a discarded draft."
- Acceptance case 5 (this item's limbs): reopen committed Other/text answer → exact value
  seeded; delete-to-empty + blur (no commit) + reopen → the newer edit wins (blank editor,
  NOT the prior answer text). Blank *rejection* is P3.M4; restart replay is P3.M3.T1.S2.
- `spec/ui-spec.md:46` EXPLAIN-002 amendment: "…the editor re-seeds from the new question's
  freshest draft — for Other/text re-edits, fall back to the corresponding recorded answer"
  (replaces the old blank-when-none rule — the item description calls this out explicitly).

## 2. Upstream contracts (landed code, verified)

### InputCaptureStore — `src/input-capture.ts` (S1, landed at 5dea27e)
- `CaptureKey { branchId: string; questionId: string | "-"; field: CaptureField }`.
  **branchId is the RAW walk-tip entry id at capture time** (docblock; panel.ts:1717-1724
  `captureBranchId()` = `walk[walk.length-1].id`). Entry ids unique across sessions.
- `CaptureRecord extends CaptureKey { session; text; seq }`; `latest(key)` = in-memory
  newest record (test surface). `setKeyDirty/forceFlush/dispose`.
- Fields: `"writein" | "elaboration" | "note" | "sidechat-composer"`.

### DurableInputStore — `src/input-durability.ts` (S2, landed)
- `latest(query: DurableKeyQuery): DurableValue | undefined` — DurableKeyQuery
  `{ session?, branchId: string (REQUIRED), questionId?, field }`; session-less query =
  linear index scan. `DurableValue { text; seq; savedAt? }` — **savedAt is WRITE time**
  (flush), up to ~1s after the keystrokes (250ms debounce / 1000ms max dirty age).
- **`undefined` = never captured OR tombstoned (S3). `{text:"", seq}` = deliberate
  delete-to-empty.** Never conflate.
- Index holds ONE record per canonical key (in-place replacement on newer seq).
- Index.ts wiring: `const durableInputs = new DurableInputStore()` (index.ts:166),
  sink+seedSeq attached (:167-169), `inputCapture.forceFlush()` on session_shutdown (:110).

### S3 retirement (landing NOW — treat as contract)
- `retire(key,{explicit:true})` on both stores; durable tombstone `{seq, retired:true}` →
  `latest()` undefined; straggler writes `seq ≤ tombstone.seq` → "ignored-stale"
  (anti-resurrection). Handoff retires at: writeInEnter commit exits →
  `consumeCommittedBuffer` (panel.ts ~:1803-1809: seed("") + draftSlots.delete +
  drafts.clearDraft explicit), acceptOptionIndex elaboration attach, submit shipDrafts,
  side-chat clean settle. **`applyChatAnswer` (actions.ts ~:592, model-authored) retires
  NOTHING** — this is the one real "stale draft vs newer answer" case the savedAt-vs-at
  comparison must resolve. Esc stages, never clears (panel.ts `exitTextField`→`stageText`).
- Deliberate discard = user delete-to-empty → durable `{text:"", seq}` REPLACES the value
  (file stays) → this item's ladder must let that "" beat the recorded answer.

## 3. Seeding sites (verified anchors)

| Site | Anchor | Today |
|---|---|---|
| Editor entry (ctrl+t, ✎ affordance) | `panel.ts focusTextField` (~:2060) | `syncBufferToQuestion(currentId)` then `textField.seed(freshestDraftFor(currentId))`; explicit `duty` param applied after sync (caller pre-sets allowed) |
| ✎ Other accept / text-question entry | `actions.ts :216-218, :224-227` | `panel.textDuty = "writein"; panel.focusTextField()` — flows through focusTextField; **no direct seed call** |
| Question-change re-scope | `panel.ts syncBufferToQuestion` (~:1982-2014) | write-through owner slot first (gated by `existing = freshestDraftFor(owner)` — **draft-only, must stay so**), then `textField.seed(freshestDraftFor(id))`, then `textDuty = desiredTextDuty(this)` if `focus === "text"` |
| Post-commit consume | `consumeCommittedBuffer` (~:1803-1809) | `seed("")` — S3-owned, keep as-is |
| Draft read core | `freshestDraftFor(q)` = `draftSlots.get(q)?.text ?? drafts?.getDraft(q) ?? ""` | draft-only tiers |

- `draftTextFor` (public, submit reconciliation, actions.ts) — must STAY draft-only
  (answer fallback there would re-ship committed answers at submit).
- `TextField.setText`/`seed` are capture-SUPPRESSED (`captureSuppressed` flag,
  text-field.ts ~:230-253) — **load-bearing**: seeding the answer text must never mint a
  capture record (else the seeded answer overwrites a deliberate durable "" — resurrection
  by seed). No text-field.ts change needed.
- Panel capture wiring: `textField.setCapture(inputCapture, () => captureKeyForTextField())`
  (panel.ts:1251); `branchReader = {getBranch, getSessionId}` (:1713) — the walk is
  available at seed time.

## 4. Ladder design (resolutions)

1. **Tier order**: slot → seam → durable(ancestry) → answer → "". Slot-first is
   spec-sanctioned (drafts are sacred / WRITEIN-002 slot re-binding); slots are deleted at
   commit (`consumeCommittedBuffer`), so a slot coexisting with an answer = post-commit
   user work (newer by construction) or model-authored `applyChatAnswer` (user typing
   outranks the model-authored answer — ANSWER-PIN posture, editor prefill only).
2. **Ancestry lookup** (new `src/input-restore.ts`, zero changes to input-durability.ts →
   no S3 conflict): for `{questionId, field}`, iterate the CURRENT walk entry ids
   (`branchReader.getBranch().map(e => e.id)`), call `durable.latest({branchId: id,
   questionId, field})` per id; candidates accepted only when their capture tip IS on the
   current walk (sibling-branch tips fail by construction — acceptance case 3).
   **Ordering across branchIds: `savedAt` ISO compare (seq is per-key and NOT comparable
   across tips); tie → later position in the walk (newer tip).** Within one branchId,
   latest() already returns the newest seq record. Tombstones excluded automatically.
3. **Durable-vs-answer freshness**: only compared when BOTH exist (no answer → draft wins
   unconditionally, "" included). Draft wins iff `savedAt` exists and `savedAt > answer.at`
   (strict; tie/missing savedAt → recorded answer — conservative ANSWER-PIN choice).
   Deliberate `{text:""}` newer than the answer → blank editor wins ("preserve the empty
   editor"). Tolerance: savedAt lags keystrokes ≤1s — only load-bearing for
   applyChatAnswer (human-scale gap), never for handoffs (retire/tombstone handles those).
4. **Never-seed-Other-with-option-value gate**: answer fallback applies iff
   `duty === "writein" && answer?.custom === true`. state.ts:52 comment: **`custom: true`
   covers BOTH ✎ write-ins AND `type:"text"` answers** — one gate. Option answers
   (custom unset) NEVER seed the writein editor. Elaboration duty NEVER seeds from the
   answer at all (spec lists only write-in/text `answer.value`; `answer.text` is not a
   seed source).
5. **Phantom-draft guard** (new, defensive): seeding the answer tier puts answer text in
   the buffer; an un-edited navigation away would write it through as a "draft"
   (slot + seam), breaking absent-draft discipline and re-shipping the same value at
   submit (same-value no-op per ANSWER-PIN-001, but noisy). Guard: mark
   `answerSeed = {owner, text}` when the answer tier produced the seed; at the
   syncBufferToQuestion write-through AND stageText, skip the slot write when the buffer
   still byte-equals the un-edited answer seed AND no real draft exists
   (`freshestDraftFor(owner) === ""`). Any user edit breaks byte-equality → normal
   write-through. Clear the mark on owner change / consume.
6. **Non-resurrection**: seeds go only through capture-suppressed `seed()`; reads use only
   `durable.latest()` (completed saves; tombstone-aware) — never the capture store's
   in-memory pending state. S3's tombstone + drop-pending-dirty owns the write side.
7. **Duty at seed time**: focusTextField uses the explicit `duty` param (or pre-set
   `textDuty` when the caller omitted it); syncBufferToQuestion computes
   `desiredTextDuty(this)` BEFORE seeding when `focus === "text"` (the cursor is already
   re-seeded by the currentId setter before sync runs), else uses current `textDuty`.
8. **Note duty / side-chat composer / session-start**: out of scope (sync already
   early-returns for note; composer + FR-28 restore are P3.M3.T1.S2, which CONSUMES this
   item's input-restore.ts exports).

## 5. Wiring facts

- Panel deps: `drafts?` / `inputCapture?` (panel.ts:282 & :665 interfaces); threading
  chain: `index.ts:175-179 maybeAutoOpen(pi, config, panelHost, drafts, peek, inputCapture)`
  → `maybeAutoOpen(..., inputCapture?)` (panel.ts:3317) → panel construction. Thread a new
  optional `durableInputs` (narrow read type `Pick<DurableInputStore,"latest">`) the same
  way. `durableInputs` already constructed at index.ts:166.
- Test harness: panel.test.ts (`createPanelHost`, `makeMockLifecycle`, EXPLAIN-002 test
  blocks :1710, :2125, :2452); input-durability.test.ts (real tmpdir, fault-injectable
  DurableFs); vitest fake timers convention.
- `getAgentDir()` storage dir: `<agentDir>/data/interrogator` (S2 tests use tmpdir).

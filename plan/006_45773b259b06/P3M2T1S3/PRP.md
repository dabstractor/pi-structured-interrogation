---
name: "P3.M2.T1.S3 — Retirement semantics, no-side-effects audit, and acceptance cases 2/3/4-send-half (Local input recovery)"
description: "Retire a captured recovery value at EXACTLY three exits — (1) deliberate delete-to-empty discard (no new gesture: minted-seq empty save replaces the value, preserving P3.M3's empty-editor seeding), (2) replacement by newer-seq save (audited, S2 semantics), (3) successful handoff (write-in commit via consumeCommittedBuffer, elaboration/note ship at submit/attach, side-chat composer ONLY on clean turn completion) — never ahead of the handoff, with a tombstone anti-resurrection guard. Add InputCaptureStore.retire(key,{explicit:true}) + injected onRetire, DurableInputStore.retire with tombstone, engine onSettle(stopReason), panel retire hooks. Ship the no-side-effects static scanner (sidechat-cache-isolation anatomy) + behavioral audit, and script acceptance cases 2, 3, 4-send-half. Refuse/fail/abort never retire. Consumed by P3.M5.T1.S1 (final gate)."
---

## Goal

**Feature Goal**: A durable input-recovery value is retired — its recovery file gone and unresurrectable — at exactly the three deliberate exits: (1) deliberate discard by the user, (2) replacement by the user's newer save, (3) successful handoff of that exact text. Refused, failed, or aborted sends retire NOTHING (the prompt stays recoverable for manual retry, never overwriting newer typing). Saving/restoring/retiring stays inert: no answer application, no submission, no send, no model call, no session-file write — proven by a static scanner test plus a behavioral audit. Acceptance cases 2, 3 (discard/delay/branch limbs), and 4-send-half are scripted and green.

**Deliverable**:
1. `src/input-capture.ts` (additive) — `retire(key: CaptureKey, opts?: { explicit?: boolean }): void`: no-op unless `{explicit:true}` (DraftStore guard precedent); DROPS pending dirty state for the key (never flushes pre-handoff text); keeps the per-key seq counter; invokes injected `onRetire?.(key)`; plus constructor option `onRetire?: (key: CaptureKey) => void`. Still zero `node:fs` imports.
2. `src/input-durability.ts` (additive; file lands in S2 first) — `retire(key: DurableKey, opts?: { explicit?: boolean }): WriteOutcome | "retired"`: no-op unless explicit; `rmSync(file, {force:true})` inside try/catch (never throws); replaces the index entry with a TOMBSTONE `{seq: lastSeq, retired: true}`; `latest()` returns `undefined` for tombstoned keys; `lastSeq()` returns the tombstone seq; writes with `seq <= tombstone.seq` are `"ignored-stale"` (anti-resurrection).
3. `src/index.ts` (wiring) — `onRetire: (k) => durableInputs.retire(k)` on the capture store constructor (adapt to S2's shipped option surface).
4. `src/panel/sidechat-engine.ts` (additive, backward compatible) — `onSettle?: (stopReason: string) => void` (def :136; fired at route() :334) now receives the terminal stop reason; existing `() => void` callers unaffected.
5. `src/panel/panel.ts` + `src/panel/actions.ts` — retire hooks at the handoff seams (see Blueprint): `consumeCommittedBuffer`, elaboration-attach, submit ship, chat-settle clean completion. A single panel helper `retireCapture(questionId, fields)` composes the full key.
6. Tests — `src/input-retirement.test.ts` (retirement + tombstone + cases 2/3), `src/no-recovery-side-effects.test.ts` (static scanner), `src/panel/retirement-sidechat.test.ts` (case 4-send-half with the ac-sidechat harness).

**Success Definition**: `npm test`, `npm run typecheck`, `npm run lint` green; S1/S2 tests, no-hardcoded-keys, sidechat-cache-isolation, editor-preservation, keymap-ac all untouched-green; the three acceptance cases scripted and passing; no code path retires ahead of a handoff, on a refuse/fail/abort, or resurrects a retired value.

## User Persona

**Target User**: The interrogation user typing a long answer or side-chat prompt, and the implementing agent's correctness guarantee that committed/sent text never resurrects as a stale draft while failed sends are never lost.

**Use Case**: Press Enter on a write-in → the answer is durably committed → the draft file is retired (kill between commit and retire leaves the file — harmless, text identical). Send a side-chat prompt that is refused (reply in flight), fails (model/auth error), or is aborted → reopen with the prompt recoverable; a cleanly-completed send retires the composer draft.

**User Journey**: type → Enter/send → handoff recorded first → retire after → restart → neither a duplicate send/commit nor a resurrected stale draft; failed/aborted → prompt re-seedable (P3.M3 restore) for manual retry.

**Pain Points Addressed**: stale drafts resurrecting over committed answers after restart; lost prompts after failed/aborted side-chat sends; retirement racing a delayed older write (resurrection after unlink).

## Why

- Binding spec: `spec/state-and-persistence.md` §Local input recovery :139 — "Retire only the matching recovery value on deliberate discard, replacement by the user, or successful handoff of that text; do not clear the only durable copy ahead of the handoff… A refused or failed send or aborted turn leaves the prompt recoverable for manual retry without overwriting newer typing"; acceptance cases 2/3/4 :145-149 (READ-ONLY).
- Design authority: `plan/006_45773b259b06/architecture/input-recovery.md` §retirement (:222-251 — the three exits, load-bearing ORDER "handoff durably recorded, THEN unlink") + §No-side-effects audit (banned-API list) + §failureSemantics (:138 never claim saved).
- Upstream contracts: S1 shipped (`src/input-capture.ts` — sink/key/record shapes; its :46 docblock reserves retirement for THIS item) and S2 (`plan/006_45773b259b06/P3M2T1S2/PRP.md` — DurableInputStore; its DOWNSTREAM note specifies `retire(key,{explicit:true})` as additive; S3 adds the tombstone extension to that exact method).
- Downstream: P3.M3.T1.* consumes `latest()` (`undefined` vs `{text:""}`) and the retire semantics ("Discarding the edit leaves the recorded answer intact; no delayed save or replay may resurrect a discarded draft" — spec :140); P3.M5.T1.S1 runs the final acceptance gate over cases 1-5.

## What

### Behavior

1. **Retire ONLY at three exits.** (a) *Deliberate discard* = the user's own delete-to-empty: S1 mints a seq and captures `""`, S2 replaces the value in place with `{text:"", seq}` — the recovery VALUE is retired by replacement; the file stays so P3.M3 seeds a blank editor, not the prior answer (spec :140). Do NOT unlink on empty-save. NO new discard gesture is created (none exists today — esc stages, never clears: panel.ts:1621-1633, keys.ts:343-355). (b) *Replacement*: newer-seq save replaces in place (S2 monotonic guard) — S3 adds scripted coverage only. (c) *Successful handoff*: retire the matching key AFTER the handoff is recorded — write-in commit (`applyAnswer` returned / buffer consumed), elaboration/note shipped into answers, or side-chat turn cleanly completed.
2. **Handoff order is load-bearing.** Never call retire before the mutation seam (`applyAnswer`, ship, accepted turn). Kill between handoff and retire leaves the file (text identical to the answer ⇒ harmless double-record); kill before handoff leaves the file (recoverable draft). Never retire inside refuse/fail/abort paths.
3. **Side-chat composer retires ONLY on clean completion.** Engine `sendTurn` returns `true` on three FAILED-dispatch paths (registry throw :513-519, inert model :520-526, sync auth throw :540-546) — the panel already clears the composer on those; retiring at `sent===true` would lose the last copy. Therefore retire via the settle signal: `onSettle(stopReason)` fires at route (:334) with the terminal reason (:455/:465 model stopReason e.g. `"end_turn"`, :484/:488 `"error"`); retire only on natural completion (reason ≠ `"error"`; abort pops the turn at :352-359 without routing a settle — verify at implementation). Result: refuse (`false`, composer intact), fail (turn recorded, not dispatched, no retire), abort (turn popped, no retire) all leave the prompt recoverable; clean completion retires.
4. **Anti-resurrection tombstone.** Unlinking alone would let a still-pending older write recreate the file (S2's monotonic guard checks `cur !== undefined`). Retire therefore: capture-side drops pending dirty for the key (never flush-then-retire), durable-side unlinks AND tombstones `{seq: lastSeq, retired: true}`; straggler writes with `seq <= tombstone.seq` → `"ignored-stale"`. A genuine post-handoff re-edit mints seq above the tombstone and captures normally (restart is safe: no pending writes exist; seedSeq continues above).
5. **No side effects.** The recovery modules (`input-capture.ts`, `input-durability.ts`) reference NONE of the banned APIs (audit list below); retirement call sites in panel/actions are exactly the handoff seams; a behavioral test proves retire/flush on a live panel changes no state, sends nothing, calls no model. Guard tests no-hardcoded-keys, sidechat-cache-isolation, editor-preservation, MIRROR-isolation stay green untouched.
6. **Acceptance cases scripted** (S3-owned limbs): case 2 — continuous typing crossing the 1000ms max-dirty-age deadline with NO idle (250ms trailing debounce never fires) forces mid-typing flushes: durable seq progresses ≥2 without idle; final durable `latest()` equals the exact expanded string (multiline Unicode + surrounding whitespace). Case 3 — failed write ⇒ no false saved indication (both values kept — composed with S2); delayed older write past a newer edit AND past a discard ⇒ ignored (no clobber, no resurrection); same questionId on two branches ⇒ distinct durable files (file-level isolation; the ancestry restore gate is P3.M3.T1.S2's). Case 4-send-half — refuse / fail / abort a side-chat send ⇒ capture record intact (prompt recoverable), no duplicate send fired; clean completion ⇒ retired (file gone, no resurrection).
7. **Deliberate empties and programmatic clears are not discards.** `TextField.setText/seed` suppress capture (text-field.ts:235-245): init, navigation, view-change, send-cleanup empties never mint, never retire. `exitTextField` (esc) stages the draft — never retires.

### Success Criteria

- [ ] `InputCaptureStore.retire(key)` without `{explicit:true}` is a no-op (mirrors draft-store.ts:111 guard); with explicit: drops pending dirty (no flush), keeps seq counter, fires `onRetire`.
- [ ] `DurableInputStore.retire` unlinks the file, tombstones, never throws; `latest()` → `undefined`; `lastSeq()` → tombstone seq; delayed `seq ≤ tombstone` write → `"ignored-stale"`, file NOT recreated; genuine new edit (seq > tombstone) captures normally.
- [ ] Write-in commit retires exactly once per handoff: direct-commit exit (actions.ts:517→:527) and byte-identical exit (:482-489) via `consumeCommittedBuffer`; ripple path retires at its apply seam, NOT at `beginWriteInConfirm`; empty-buffer exit (:431-437) retires nothing.
- [ ] Elaboration/note retire at ship: submit's shipDrafts consumption (per shipped id: elaboration + writein; plus the note key), and the option-accept elaboration attach.
- [ ] Side-chat: refuse/fail/abort ⇒ no retire, capture intact, no duplicate send; clean settle ⇒ retire. `onSettle` extension compiles for existing `() => void` callers unchanged.
- [ ] Delete-to-empty discard replaces the value in place ({text:"", seq}); file NOT unlinked; prior text unresurrectable (monotonic).
- [ ] Static scanner green over recovery modules with the architecture-note banned list; behavioral audit green; all named guard tests untouched-green.
- [ ] Cases 2, 3 (S3 limbs), 4-send-half scripted and passing (fake timers + real tmpdir fs; panel harness for 4).
- [ ] `npm test`, `npm run typecheck`, `npm run lint` green; `src/input-capture.ts` still imports no `node:fs`.

## All Needed Context

### Context Completeness Check

Validated: spec :133-153 (recovery bullets + cases) read in full; architecture note §retirement/§No-side-effects audit/§consumers map read in full (S3 owns "retirement, No-side-effects audit" → cases 3 (discard/delay), 4 (handoff order, failed/aborted send)); S1 SHIPPED source verified (shapes, keying, suppression, pacing); S2 PRP consumed as contract (its retire sketch + tombstone gap identified and resolved here); every handoff seam verified with file:line anchors by scout subagent (writeInEnter exits, consumeCommittedBuffer, ripple, acceptOptionIndex attach, submit shipDrafts, sendChatInput, engine sendTurn/routes/abort/onSettle); scanner template anatomy verified (:1-110); panel test-harness pattern verified. Research notes: `plan/006_45773b259b06/P3M2T1S3/research/findings.md`.

### Documentation & References

```yaml
- file: plan/006_45773b259b06/architecture/input-recovery.md
  why: THE authority — §retirement (:222-251: three exits, explicit guard, ORDER "handoff
    durably recorded, THEN the file is unlinked", restore-does-not-retire), §No-side-effects
    audit (the exact banned-API list the scanner must encode), §consumers map (:305-315: S3's
    acceptance-case ownership split). READ FIRST; where it and this PRP conflict, IT wins —
    EXCEPT the tombstone extension here implements its own anti-resurrection requirement
    ("no delayed save or replay may resurrect a discarded draft", spec :140)
- file: spec/state-and-persistence.md
  why: §Local input recovery :139 (the binding retire-only-at-three-exits text) + acceptance
    cases 2/3/4 :145-149 (S3's scripted limbs). READ-ONLY — never edit spec/
- file: plan/006_45773b259b06/P3M2T1S2/PRP.md
  why: the S2 CONTRACT — DurableInputStore API (write/latest/lastSeq/index Map), its
    DOWNSTREAM note handing S3 `retire(key,{explicit:true})` as an additive method, the
    "never-throw sink / no surface" posture, index.ts wiring shape. S2 is landing in
    parallel — VERIFY its shipped shapes first (Task 0)
- file: src/input-capture.ts
  why: S1 SHIPPED — CaptureField/CaptureKey/CaptureRecord (:57-:88), InputCaptureStore
    (:108: constructor {sink,session} :123, setKeyDirty :152, forceFlush :181, latest :194,
    dispose :204), docblock :46 reserving retirement for S3, pacing (250ms debounce +
    1000ms max-dirty-age :24/:165-166), delete-to-empty mints (:36-39)
  gotcha: retire must drop pending dirty WITHOUT flushing — find the dirty map/timers and
    remove the key's entry; keep the seq counter map untouched
- file: src/panel/actions.ts
  why: handoff seams — writeInEnter :422 (exits :431-437 empty→no retire, :482-489 inert,
    :503-507 ripple deferral→no retire, :517 applyAnswer→:527 consume); acceptOptionIndex
    :277/:322 (+ elaboration attach :708-725); submit :811 + shipDrafts consumption ~:936;
    applyChatAnswer :592 (model-authored → retires NOTHING); stageSupersededWriteIn :376-389
- file: src/panel/panel.ts
  why: consumeCommittedBuffer :1803-1809 (seed("")/:1807, draftSlots.delete/:1808,
    drafts.clearDraft explicit/:1809 — THE single writein retire hook point, all three
    consume sites route here); capture wiring :1247-1253; key providers :1743/:1757;
    sendChatInput :2158 (accept :2188-2192, refuse flash :2194); exitTextField :1621-1633
    (esc STAGES — never retire); handleInput enter intercept :1547-1553
- file: src/panel/sidechat-engine.ts
  why: sendTurn :492 (refuse :494-496; TRUE-but-failed dispatch :513-519/:520-526/:540-546 —
    the hazard); route() terminal calls :455/:465/:484/:488; onSettle def :136 + fire :334;
    abort :551 + turn-pop :352-359
  gotcha: extend onSettle ADDITIVELY with a stopReason param; do not change boolean returns
- file: src/panel/sidechat-cache-isolation.test.ts
  why: the static-scanner template — file list (:44-52), BANNED_API (:60-66),
    stripComments (:82+, cloned from no-hardcoded-keys.test.ts), word-boundary greps
- file: src/panel/ac-panel.test.ts + src/panel/ac-sidechat.test.ts
  why: the panel test harness — fakePanelEditor (:309-325), panelArgsFor (:327+),
    handleInput key simulation, flush() macro-task settling; case-4 tests compose the
    engine + capture store through panelArgsFor extras
- file: src/draft-store.ts
  why: the {explicit:true} destruction-guard precedent (:27-29, :46-52, :111 clearDraft,
    :121 clearAll, :133 shipDrafts) — retire mirrors it at BOTH store layers
- url: https://github.com/npm/write-file-atomic
  why: not needed at runtime (S2 owns the protocol) — cited only if retire ever grows a
    write; retire is unlink+tombstone, no atomic write required
```

### Current Codebase tree (relevant slice)

```bash
src/input-capture.ts               # S1 shipped — capture store, pacing, keying (EXTEND additively)
src/input-durability.ts            # S2 (in flight) — atomic durable store (EXTEND additively)
src/index.ts                       # wiring (:149 capture construction) (MODIFY: onRetire)
src/panel/actions.ts               # handoff seams (MODIFY: retire hooks at ship/attach)
src/panel/panel.ts                 # consumeCommittedBuffer + sendChatInput + settle (MODIFY)
src/panel/sidechat-engine.ts       # onSettle (MODIFY: stopReason param, additive)
src/panel/sidechat-cache-isolation.test.ts  # scanner template (READ-ONLY reference)
src/panel/ac-sidechat.test.ts      # harness pattern (READ-ONLY reference)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/input-retirement.test.ts       # CREATE — retire units (explicit guard, drop-pending,
                                   #   tombstone, straggler-write, branch isolation) +
                                   #   acceptance cases 2 and 3 (composed stores, fake timers,
                                   #   real tmpdir fs)
src/no-recovery-side-effects.test.ts  # CREATE — static scanner over recovery modules
                                   #   (banned-API list from the architecture note)
src/panel/retirement-sidechat.test.ts  # CREATE — acceptance case 4-send-half: refuse/fail/
                                   #   abort keep capture intact + no duplicate send; clean
                                   #   completion retires (panel harness + engine)
src/input-capture.ts               # EXTEND — retire(key,{explicit}) + onRetire option
src/input-durability.ts            # EXTEND — retire(key,{explicit}) + tombstone semantics
src/index.ts                       # MODIFY — wire onRetire → durable.retire
src/panel/panel.ts                 # MODIFY — retireCapture helper; consumeCommittedBuffer
                                   #   hook; chat settle handler (clean completion only)
src/panel/actions.ts               # MODIFY — retire at elaboration-attach + submit ship
src/panel/sidechat-engine.ts       # MODIFY — onSettle(stopReason) additive param
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: retire ORDER — handoff recorded FIRST (applyAnswer returned / drafts shipped /
// turn settled clean), unlink AFTER. Retiring ahead of the handoff clears the only durable
// copy (spec :139 "do not clear the only durable copy ahead of the handoff").
// CRITICAL: sendTurn returns TRUE on three failed-dispatch paths (engine :513/:520/:540) —
// the panel already clears the composer on them. NEVER gate retirement on `sent===true`;
// gate on the settle outcome (clean completion) so failed sends stay recoverable.
// CRITICAL: never flush-then-retire — retire() must DROP the key's pending dirty state;
// a pending pre-handoff flush landing after unlink is resurrection.
// CRITICAL: tombstone, don't just unlink — with the index entry removed, S2's monotonic
// guard sees cur===undefined and accepts a delayed OLDER write (file recreated = resurrect).
// seq <= tombstone.seq → "ignored-stale". Tombstones are in-memory only.
// GOTCHA: delete-to-empty discard keeps the FILE as {text:"",seq} — P3.M3 must seed a blank
// editor (spec :140). Unlinking on empty-save would resurrect the prior answer text. The
// "retirement" for discard is replacement-by-empty, not unlink.
// GOTCHA: onSettle extension must stay backward compatible — existing handlers are typed
// `() => void` and ignore the new arg; changing the option TYPE to `(stopReason: string)
// => void` is source-compatible for them. Do NOT touch boolean returns (engine tests).
// GOTCHA: abort pops the turn ("the turn never happened", engine :352-359) and retires
// nothing; esc-exit of the editor STAGES the draft (panel.ts:1633) and retires nothing.
// GOTCHA: TextField.setText/seed suppress capture (text-field.ts:235-245) — programmatic
// clears (post-send :2191, post-commit :1807, command path :2183) mint nothing; retirement
// must be EXPLICIT at those seams, never capture-derived.
// GOTCHA: keep `grep "node:fs" src/input-capture.ts` empty — retire reaches the durable
// layer only through the injected onRetire callback wired in index.ts.
// GOTCHA: never-throw — retire() bodies fully try/catch'd (sink contract; a throwing retire
// inside consumeCommittedBuffer would break commit).
// GOTCHA: eslint unused vars/args need leading underscore; vitest fake timers for debounce
// windows; real os.tmpdir() fixtures with afterEach rm -r (config.test.ts convention).
// GOTCHA: line anchors drift (S2 lands in parallel) — locate seams by CONTENT (function
// names above), not line numbers.
```

## Implementation Blueprint

### Data models and structure

```ts
// src/input-capture.ts (additive)
export interface RetireOptions { explicit?: boolean; }
// constructor options gain: onRetire?: (key: CaptureKey) => void
// retire(key: CaptureKey, opts?: RetireOptions): void — no-op unless opts?.explicit;
//   removes key's pending-dirty entry + disarms its timers-for-that-key; does NOT reset
//   the per-key seq counter; calls this.onRetire?.(key) inside try/catch.

// src/input-durability.ts (additive)
// retire(key: DurableKey, opts?: RetireOptions): "retired" | "ignored" — no-op unless
//   explicit; rmSync(file, {force:true}) in try/catch; index entry becomes
//   { seq: <last seq for key>, retired: true } (a Map value union extension);
//   latest(key) → undefined when retired; lastSeq(key) → tombstone seq;
//   write() monotonic branch: record.seq <= tombstone.seq → "ignored-stale".

// src/panel/sidechat-engine.ts (additive)
// deps.onSettle?: (stopReason: string) => void   // was () => void — additive param

// src/panel/panel.ts (additive helper)
/** Retire capture keys for a question — handoff ONLY; explicit by construction. */
retireCapture(questionId: string, fields: CaptureField[]): void
// composes keys via captureKeyForTextField()'s branch/session resolution; no-op when
// inputCapture is absent (tests without capture wiring stay valid).
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY contract inputs (read pass — anchors drift, S2 lands in parallel)
  - READ the SHIPPED src/input-durability.ts: adapt retire/tombstone to its real index
    shape (S2 PRP sketches Map<canon, DurableValue>; the tombstone is a value variant)
  - READ research/findings.md §2 anchors against live source (writeInEnter exits,
    consumeCommittedBuffer, sendChatInput, engine sendTurn/routes/onSettle/abort,
    submit shipDrafts site) — locate by content, not line
  - RE-READ architecture note §retirement + §No-side-effects audit

Task 1: EXTEND src/input-capture.ts — retire + onRetire (additive ONLY)
  - IMPLEMENT per the data model; S1's tests must compile and pass UNCHANGED
  - GOTCHA: drop-pending must also clear the key's "last captured text" gate so a
    post-retire re-edit of the SAME text still mints a fresh seq (capturable again)

Task 2: EXTEND src/input-durability.ts — retire + tombstone (additive ONLY)
  - IMPLEMENT per the data model; never throws; S2's tests unchanged-green
  - VERIFY write()'s stale branch now also consults tombstones (seq <= tombstone.seq)

Task 3: MODIFY src/index.ts — wire onRetire
  - AT the capture construction (:149 area): add onRetire: (k) => durableInputs.retire(k)
    [adapt to S2's shipped construction order — durableInputs may be constructed there
    already for sink/seedSeq]

Task 4: MODIFY src/panel/sidechat-engine.ts — onSettle(stopReason)
  - PASS route()'s reason string through deps.onSettle?.(reason) at :334; NO behavior
    change otherwise; engine tests stay green UNCHANGED

Task 5: MODIFY src/panel/panel.ts + src/panel/actions.ts — handoff retire hooks
  - ADD retireCapture(questionId, fields) helper (key composition like :1743/:1757)
  - consumeCommittedBuffer (:1803): this.retireCapture(questionId, ["writein"]) — next to
    drafts?.clearDraft?.(…{explicit:true}); covers writeInEnter inert (:482) + direct
    (:527) + ripple apply (VERIFY ripple's consume call routes here; if ripple applies
    without consumeCommittedBuffer, add the retire hook at ITS applyAnswer seam)
  - actions.ts acceptOptionIndex elaboration-attach (~:322 area, attach described
    :708-725): retire ["elaboration"] where the draft text becomes answer.text
  - actions.ts submit (:811, shipDrafts consumption ~:936): for each SHIPPED id retire
    ["writein","elaboration"]; retire the note key (questionId "-", field "note") when
    the batch note ships — place AFTER the ship completes, never before
  - panel.ts sendChatInput/settle: pass an onSettle handler to the engine (creation site)
    that retires the CHAT key ({questionId:"-", field:"sidechat-composer"} via
    captureKeyForChatField) ONLY when stopReason !== "error" AND the turn was not popped
    (abort never routes a settle — VERIFY; if abort routes with a distinct reason, exclude
    it too)
  - DO NOT touch: empty-buffer exit (:431-437), beginWriteInConfirm (:503-507),
    exitTextField (:1621), applyChatAnswer (:592), acceptOptionIndex's option-value apply

Task 6: CREATE src/no-recovery-side-effects.test.ts — static scanner
  - CLONE anatomy from sidechat-cache-isolation.test.ts (stripComments from
    no-hardcoded-keys.test.ts); TARGETS = ["input-capture.ts", "input-durability.ts"]
  - BANNED (word-boundary, architecture-note list): applyAnswer, writeInEnter,
    acceptOptionIndex, submit, setStatus, upsertQuestion, InterrogationState, sendMessage,
    sendUserMessage, SubmitDeps, streamSimple, appendEntry, shipDrafts, clearDraft,
    clearAll, noteSubmissionDelivered, openPanel, nextUnanswered
  - GOTCHA: "submit" must be matched carefully (no false hits on unrelated words —
    match as panelActions.submit / function-call forms, or drop bare "submit" and assert
    the qualified forms + maybeAutoSubmit)
  - ALSO assert: no EventEmitter/.emit(, no "saved" status flag, no node:fs in
    input-capture.ts, no imports from panel/, state.ts, delivery.ts, persistence.ts

Task 7: CREATE src/input-retirement.test.ts — retirement units + cases 2 and 3
  - FIXTURES: real os.tmpdir() dirs (config.test.ts convention); fake timers where S1's
    store is composed; faulting fs adapter where a failed write is needed
  - RETIRE GROUP: explicit guard (no explicit → no-op, file intact); retire → file gone,
    latest() undefined, lastSeq() = tombstone seq; straggler write seq <= tombstone →
    "ignored-stale", file NOT recreated; genuine new edit seq > tombstone → captured;
    drop-pending (armed debounce + retire → no flush ever fires for the dropped text);
    never-throw through retire
  - CASE 2 GROUP (composed: InputCaptureStore + DurableInputStore + sink, fake timers):
    drive edits every 200ms for 3s (no 250ms idle gap) with a paste of multiline Unicode
    ("  lead\nline2\tあé…🜂\ntrail  ") — assert durable seq progressed ≥2 via the
    1000ms max-dirty-age deadline (no trailing-debounce flush), each flush durable, and
    the LAST completed save's latest() equals the exact expanded string
  - CASE 3 GROUP: (a) failed write (faulting fs) → no surface change, last durable value
    + live edit both kept (S2 composed guarantee); (b) delayed older write past a newer
    edit AND past a delete-to-empty discard → ignored-stale both times (no clobber, no
    resurrection of the discarded text); (c) branch isolation: same questionId captured
    under two branchIds → two distinct files, neither write touches the other (the
    ancestry restore gate itself is P3.M3.T1.S2's — assert file-level isolation only)

Task 8: CREATE src/panel/retirement-sidechat.test.ts — case 4-send-half
  - HARNESS: ac-sidechat.test.ts pattern (fakePanelEditor, panelArgsFor extras with
    inputCapture + a durable store over a tmpdir, composed engine)
  - REFUSE: streamState busy → sendTurn false → flash, composer intact, capture record
    intact (prompt recoverable), sendTurn call count unchanged after any capture/retire
    path (no duplicate send)
  - FAIL: faulting model port (engine catch paths) → turn recorded, not dispatched →
    NO retire (capture intact)
  - ABORT: mid-stream abort → turn popped → NO retire (capture intact)
  - CLEAN: normal completion settle → chat key retired (file gone), no resurrection,
    no second sendTurn
  - BEHAVIORAL AUDIT (same file or Task 6 file): on a live panel, running capture
    flush + retire paths mutates NO InterrogationState (serialize before/after equal),
    fires no send, no applyAnswer, no streamSimple

Task 9: VALIDATE
  - npm test && npm run typecheck && npm run lint
  - npx vitest run src/input-capture.test.ts src/input-durability.test.ts
    src/no-hardcoded-keys.test.ts src/panel/sidechat-cache-isolation.test.ts
    src/panel/editor-preservation.test.ts    # all green, UNTOUCHED
```

### Implementation Patterns & Key Details

```ts
// The retire pair — the heart of the item (both never-throw, both explicit-gated):
// input-capture.ts
retire(key: CaptureKey, opts?: RetireOptions): void {
  if (!opts?.explicit || this.disposed) return;          // draft-store.ts:111 precedent
  const canon = canonicalKey(key);
  this.pending.delete(canon); /* + disarm that key's timers if per-key armed */  // NEVER flush
  this.lastText.delete(canon);                            // same text re-typed re-mints
  try { this.onRetire?.(key); } catch { /* sink isolation */ }
}
// input-durability.ts
retire(key: DurableKey, opts?: RetireOptions): "retired" | "ignored" {
  if (!opts?.explicit) return "ignored";
  try {
    const canon = canonicalKey(key);
    const cur = this.index.get(canon);
    const file = this.filePath(canon, key);
    this.fs.rmSync(file, { force: true });
    this.index.set(canon, { seq: cur?.seq ?? 0, retired: true });  // TOMBSTONE
    return "retired";
  } catch (_e) { console.error("interrogator: retire failed", _e); return "ignored"; }
}
// write() stale branch extension: const cur = this.index.get(canon);
// if (cur && record.seq <= cur.seq) return "ignored-stale";   // covers tombstones

// panel hook (the single writein handoff point — all consume sites route here):
consumeCommittedBuffer(questionId: string): void {
  /* existing :1803-1809 unchanged */
  this.drafts?.clearDraft?.(questionId, { explicit: true });
  this.retireCapture(questionId, ["writein"]);           // AFTER the answer is recorded
}
// chat settle (clean completion only — refuse/fail/abort all no-op):
onSettle: (stopReason) => {
  if (stopReason === "error") return;                    // failed send: keep the prompt
  this.retireChatCapture();                              // compose key via :1757 provider
},
```

### Integration Points

```yaml
UPSTREAM:
  - S1 InputCaptureStore (shipped): sink/key/record shapes, seq minting, pacing timers
  - S2 DurableInputStore (contract): index Map, write monotonic branch, never-throw posture
  - sidechat-engine onSettle (:136/:334) — the ONLY engine change is the additive param

WIRING (src/index.ts):
  - capture construction site: onRetire: (k) => durableInputs.retire(k, { explicit: true })
    [explicit can be set here so panel hooks stay terse — ONE decision point]

DOWNSTREAM (design for, do NOT implement):
  - P3.M3.T1.*: latest() undefined-vs-{text:""} distinction + retire semantics for
    seeding (newer draft > recorded answer > blank; discarded drafts never resurrect)
  - P3.M4.T1.*: state.ts:379 applyAnswer blank guard — untouched here
  - P3.M5.T1.S1: runs cases 1-5 end-to-end over this + P3.M3/P3.M4

OUT OF SCOPE: restore/seeding/panel UX (P3.M3), blank rejection (P3.M4), config keys,
  README/spec edits (P3.M5.T1.S2), any transcript archive for side chat (spec :139 — the
  active draft/last user prompt suffices), time-based GC of non-current lineages
  (architecture note retirement §4: restore does not retire; files on other branches stay)
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck && npm run lint
# Expected: zero errors. Fix before proceeding.
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/input-retirement.test.ts -v            # retire + tombstone + cases 2/3
npx vitest run src/no-recovery-side-effects.test.ts -v    # static scanner
npx vitest run src/panel/retirement-sidechat.test.ts -v   # case 4-send-half + audit
npx vitest run src/input-capture.test.ts src/input-durability.test.ts  # S1/S2 unchanged
npm test                                                   # full suite green
```

### Level 3: Boundary & Guard Checks

```bash
git diff --name-only
# Expected: input-capture.ts, input-durability.ts, index.ts, panel/actions.ts,
#           panel/panel.ts, panel/sidechat-engine.ts + the three new test files
grep -n "node:fs" src/input-capture.ts                                   # no matches
grep -rn "retire(" src/panel src/index.ts | grep -v "explicit"           # review: every
#   panel-side retire routes through retireCapture (explicit set once in index.ts wiring)
npx vitest run src/no-hardcoded-keys.test.ts src/panel/sidechat-cache-isolation.test.ts \
  src/panel/editor-preservation.test.ts                                  # untouched-green
```

### Level 4: Domain-Specific Validation (acceptance casing)

```bash
# Case 2 — progression without idle (fake-timer driven, real tmpdir):
npx vitest run src/input-retirement.test.ts -t "case 2"
# Case 3 — fail/delay/discard/branch limbs:
npx vitest run src/input-retirement.test.ts -t "case 3"
# Case 4-send-half — refuse/fail/abort/completion:
npx vitest run src/panel/retirement-sidechat.test.ts -t "case 4"
# Optional manual spot-check of a retired key's file removal + tombstone effect:
npx tsx -e 'import { DurableInputStore } from "./src/input-durability.js"; const s = new DurableInputStore({dir:"/tmp/retire-check"}); const k={session:"s",branchId:"b",questionId:"q",field:"writein"}; s.write({...k,text:"x",seq:1}); console.log(s.retire(k,{explicit:true}), s.latest(k), s.lastSeq(k), s.write({...k,text:"zombie",seq:1}));' && ls /tmp/retire-check
# Expected: retired undefined 1 ignored-stale ; (empty dir listing)
```

## Final Validation Checklist

### Technical Validation

- [ ] All validation levels completed; `npm test`, `npm run typecheck`, `npm run lint` green.
- [ ] Retirement units green: explicit guard, drop-pending-never-flush, tombstone, straggler-stale, re-capture above tombstone, never-throw.
- [ ] Cases 2, 3 (S3 limbs), 4-send-half scripted green; guard tests untouched-green.

### Feature Validation

- [ ] Retire fires at exactly the handoff seams (consume sites, elaboration attach, submit ship, chat clean settle) and NOWHERE else — refuse/fail/abort/esc/empty-buffer/ripple-deferral verified non-retiring by test.
- [ ] Order verified: every retire call site executes after the mutation seam returns.
- [ ] Delete-to-empty discard preserves `{text:"", seq}` (no unlink); delayed older writes can never clobber or resurrect.
- [ ] Side-chat: `onSettle(stopReason)` additive; existing engine callers/tests unchanged.
- [ ] Behavioral audit: capture flush + retire on a live panel → state serialized before/after identical, zero sends/models.

### Code Quality Validation

- [ ] Additive-only to S1/S2 modules; draft-store.ts explicit-guard pattern mirrored at both layers.
- [ ] Diff confined to the declared files; naming/placement match the desired tree.
- [ ] No anti-patterns from the list below; no config keys, no UI surface, no "saved" indication.

### Documentation & Deployment

- [ ] Module doc blocks cite spec :139 + the architecture note §retirement; retire failure logs one degraded `console.error` line max.
- [ ] No new environment variables; no README/spec edits (P3.M5.T1.S2 owns the docs sync).

## Anti-Patterns to Avoid

- ❌ Don't gate retirement on `sendTurn() === true` — three failed-dispatch paths return true and must leave the prompt recoverable.
- ❌ Don't flush before retiring (drop the pending entry instead) and don't unlink without a tombstone — both resurrect retired text.
- ❌ Don't unlink on delete-to-empty discard — the `{text:""}` record is P3.M3's blank-editor seeding guarantee.
- ❌ Don't retire at `beginWriteInConfirm` (nothing applied yet), on esc exit (stages the draft), on `applyChatAnswer` (model-authored text), or on empty-buffer enter.
- ❌ Don't let any exception escape `retire()` — it runs inside commit/settle paths.
- ❌ Don't import `node:fs` into `input-capture.ts` or let the scanner targets import panel/state/delivery/persistence.
- ❌ Don't change `sendTurn`'s boolean contract or existing `onSettle` caller expectations.
- ❌ Don't add restore/seeding, blank rejection, config keys, or docs here — P3.M3/P3.M4/P3.M5 own those.
- ❌ Don't invent a new discard key/gesture — the spec's discard is the user's own delete-to-empty capture.

---

**Confidence Score: 9/10** — every seam verified with live-source anchors; the two residual uncertainties (S2's exact shipped index shape; whether abort routes a settle) are handled by explicit Task 0 verification instructions and defensive settle-handler conditions. One-pass implementable from this PRP + the two upstream contracts it cites.

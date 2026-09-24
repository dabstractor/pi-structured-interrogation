# PRP — Bugfix P1.M1.T2.S3: Note-mode swap (ctrl+shift+m) writes through both buffers symmetrically

## Goal

**Feature Goal**: Close BUG-002 gesture 3 (PRD h2.2/h3.1, R4/ESC-002): make the ctrl+shift+m note-mode swap non-destructive in BOTH directions. Entering note mode must stage the in-flight question buffer (slot + DraftStore) before `textField.seed(note)` overwrites the editor; exiting note mode already writes the note buffer through before re-seeding the question buffer (verified — keep, don't restructure). ctrl+c from note focus survives via S1's `suspend()` helper — asserted here, not re-fixed.

**Deliverable**: `src/panel/panel.ts` — one-line `writeThroughCurrentDraft()` call at the top of `enterNoteMode()` + Mode A JSDoc update — plus TDD tests in `src/panel/panel.test.ts` covering the three contract scenarios (question→note swap, note→question swap, ctrl+c from note focus). After this subtask the panel's draft machinery is FROZEN (serialization gate for P1.M2.T1.S1).

**Success Definition**:
- TDD: the new swap test fails before the `enterNoteMode` fix and passes after
- Both buffers survive every swap/exit gesture; nothing typed is ever destroyed (R4)
- `npm run typecheck` + full `npm test` green (including S1/S2's new draft tests and note-mode tests :1427, :1765+)

## Why

R4/commitment 6: "Typed-but-unsubmitted text survives … Never destroyed except by explicit user action." `enterNoteMode` (src/panel/panel.ts:1110-1116) calls `this.textField.seed(...)` which overwrites the in-flight question buffer with nothing written to `draftSlots`/DraftStore — the forward half of the swap is asymmetric. With WRITEIN-001, users type full hand-written answers in this editor; toggling to note mode mid-answer (a single ctrl+shift+m, reachable from ANY focus/view per keys.ts:116) silently destroys the answer. This is the third and last of the three BUG-002 editor-exit gestures (ctrl+c → S1, discuss → S2, note swap → S3).

## What

1. **`enterNoteMode()` fix** (src/panel/panel.ts:1110): insert `this.writeThroughCurrentDraft();` as the FIRST statement — before `this.focus = "note"` and before `this.textField.seed(...)`. At that moment `focus` is "text" (or "options") and `bufferOwner` is a question id, so S1's helper stages the question buffer to its slot + the DraftStore seam; the subsequent seed then loads the note draft over an already-persisted buffer.
2. **`exitNoteMode()`**: NO code change — it already writes the note buffer through (`batchNote` + `setNote`) before re-seeding the question buffer (panel.ts:1127-1141). Extend its JSDoc one sentence stating the symmetric guarantee.
3. **Mode A JSDoc on `enterNoteMode`** (required by item contract): state the swap write-through guarantee — entering note mode stages the in-flight question buffer via the write-through helper BEFORE the note text is seeded; combined with `exitNoteMode`'s existing write-through, BOTH directions of the swap are non-destructive (R4).
4. **ctrl+c from note focus**: covered by S1's `suspend()` → `writeThroughCurrentDraft()` note branch (`batchNote = text; drafts?.setNote(text)`); this subtask adds the assertion (test c) and changes nothing.

### Success Criteria

- [ ] (a) Type question text → `enterNoteMode()` → question draft survives (`panel.draftTextFor(id)` and `drafts.getDraft(id)` carry the text) AND the editor shows the seeded note text (existing note or "")
- [ ] (b) Type note text → exit note mode (esc, ctrl+shift+m re-press, or enter) → note draft survives (`batchNote` + `drafts.getNote()`) and the editor re-seeds from the question's freshest draft
- [ ] (c) Type note text → ctrl+c (`handleInput("\x03")`) → note draft survives; `done(null)` still called; `handleInput` still returns false
- [ ] Entering note mode from options focus with an empty/blurred buffer writes nothing (empty-buffer guard; no phantom `""` slot)
- [ ] Re-entering note mode after (b) re-seeds the editor with the surviving note text (idempotent round-trip)
- [ ] `test_note_mode_exit_rescopes_buffer_to_current_question` (:1427) and the note-mode describe (:1765+) stay green untouched
- [ ] Full suite + typecheck green; only `src/panel/panel.ts` + `src/panel/panel.test.ts` modified

## All Needed Context

### Context Completeness Check

Repo fully implemented (1224 tests green pre-changeset). This PRP quotes the exact current code of `enterNoteMode`/`exitNoteMode`, the key-routing sites, the S1 helper contract, and the test-harness anchors. An agent needs this PRP plus `src/panel/panel.ts` and `src/panel/panel.test.ts`.

### Documentation & References

```yaml
- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/P1M1T2S1/PRP.md
  why: "CONTRACT (Implementing, treat as landed): writeThroughCurrentDraft() — focus guard (text|note), empty-trim guard, note-owner branch (batchNote+setNote), question-owner branch (draftSlots.set + drafts.setDraft), NO blur/invalidate/FR-18 side effects"
  critical: "call it as the FIRST statement of enterNoteMode — AFTER `focus = 'note'` the buffer semantically belongs to the note and the question write-through would be misrouted; before the seed so the overwritten text is already persisted"

- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/P1M1T2S2/PRP.md
  why: sibling gesture (discuss) — establishes the pattern of consuming S1's helper without re-implementing it; its tests must stay green
  gotcha: S2 touches discuss.test.ts only — no overlap with S3's files

- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/P1M1T2S3/research/notes.md
  why: verbatim current code of enterNoteMode (:1110-1116) / exitNoteMode (:1127-1141), key routing (keys.ts:479→:322-327 toggle, :249/255 esc), test anchors, design decisions

- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/architecture/bug-002-draft-r4.md
  why: THE BUG-002 research doc — draft machinery inventory (draftSlots :402, DraftStore seam :126-135), bufferOwner semantics (EXPLAIN-002), full test inventory
  critical: exitNoteMode is ALREADY symmetric on the note side — do not restructure it

- file: src/panel/panel.ts
  why: "the only production file: enterNoteMode (:1110), exitNoteMode (:1127), writeThroughCurrentDraft (near commitTextDraft :881, from S1)"
  pattern: "JSDoc-heavy private/public methods; [Mode A] markers on doc blocks"
  gotcha: "bufferOwner is `string | 'note' | undefined` (:414) — at enterNoteMode entry it is the question id or undefined; the helper's question branch keys the slot on bufferOwner, NOT currentId"

- file: src/panel/panel.test.ts
  why: "harness conventions — makeSuspendPanel (:1300-1307, panelArgsFor + done spy), note-mode describe (:1765, drafts stub with setNote/getNote mocks :1818-1824, editor setText mock :1813), test at :1427 pins exit-side semantics"
  gotcha: "extend/add tests in the existing note-mode describe; do not flip :1427 or S1's extended :1339"

- docfile: PRD h2.2/h3.1 (BUG-002 verbatim, in the task prompt) + h2.5 recommendation ("call it at the top of suspend(), discussInChat, and enterNoteMode") — this subtask is the enterNoteMode call site
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
├── panel.ts           # MODIFY: enterNoteMode write-through + JSDoc (enter/exit)
├── panel.test.ts      # MODIFY: new TDD tests in the note-mode describe
├── keys.ts            # untouched (routing already calls enter/exitNoteMode)
└── text-field.ts      # untouched
src/draft-store.ts     # untouched
```

### Desired Codebase tree

```bash
src/panel/
├── panel.ts           # enterNoteMode(): writeThroughCurrentDraft() first statement + Mode A JSDoc
└── panel.test.ts      # + swap-survival tests (a), (b), (c), guards, round-trip
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: the helper call MUST precede `this.focus = "note"` AND `textField.seed(...)`.
//   After focus flips, the editor semantically belongs to note duty; after the seed,
//   the question text is already gone. First statement — nothing before it.
// CRITICAL: exitNoteMode is already correct (batchNote + setNote BEFORE re-seed) —
//   do not restructure it; a "fix" there is scope creep and regression risk.
// GOTCHA: entering note mode from OPTIONS focus: buffer may be blurred/empty → the
//   helper's empty-trim guard writes nothing. Correct: blurred buffers were synced
//   on blur by the existing commit/sync paths; do not force a write.
// GOTCHA: seed order in enterNoteMode is `drafts?.getNote() || this.batchNote || ""`
//   — after (b)'s exit wrote the note through, re-entry re-seeds from the seam.
//   Do not change the precedence.
// GOTCHA: ctrl+c handleInput returns false by design (pi's own ctrl+c flow resumes on
//   the restored editor) — do not change the return in test (c).
// GOTCHA: after this subtask the panel draft machinery is FROZEN — it is the
//   serialization gate for P1.M2.T1.S1. Keep the change minimal: one call + docs.
// GOTCHA: note-mode tests use a drafts stub with vi.fn() setNote/getNote — assert
//   calls with toHaveBeenCalledWith, and seed getNote's return for re-entry checks.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: WRITE FAILING TESTS FIRST (src/panel/panel.test.ts, note-mode describe :1765+)
  - ADD test_note_mode_swap_preserves_in_flight_question_draft (contract a):
    makeSuspendPanel/state + choiceQ("q1"); open editor in write-in duty (✎ Other-row
    accept path — focus "text", bufferOwner "q1"); textField.setText("precious elaboration
    in flight"); panel.enterNoteMode(); FAILS today:
      expect(panel.draftTextFor("q1")).toBe("precious elaboration in flight");
      expect(drafts.getDraft).toHaveBeenCalledWith("q1", "precious elaboration in flight");
      expect(panel.focus).toBe("note");
      expect(panel.textField.getText()).toBe(seeded note text — "" for a fresh panel)
  - ADD test_note_mode_exit_preserves_note_and_reseeds_question (contract b):
    enterNoteMode → setText("my batch note") → exitNoteMode() (call directly AND once via
    the ctrl+shift+m toggle handleInput route):
      expect(panel.batchNote).toBe("my batch note");
      expect(drafts.setNote).toHaveBeenCalledWith("my batch note");
      expect(panel.bufferOwner).toBe(currentId); editor re-seeded from question draft
  - ADD test_ctrl_c_from_note_focus_preserves_note (contract c):
    enterNoteMode → setText("note in flight") → expect(handleInput("\x03")).toBe(false);
      expect(done).toHaveBeenCalledWith(null);
      expect(panel.batchNote).toBe("note in flight");
      expect(drafts.getNote/… setNote called) (passes once S1 lands — run to confirm)
  - ADD test_enter_note_mode_from_options_empty_buffer_writes_nothing (guard):
    focus "options", no typed text → enterNoteMode → setDraft never called
  - ADD test_note_mode_round_trip (idempotence):
    question text → enter → type note → exit → enter → editor shows "the note",
    question draft still intact; single slot entry, latest text wins
  - RUN npx vitest run src/panel/panel.test.ts — contract (a) must FAIL pre-fix

Task 2: IMPLEMENT the fix (src/panel/panel.ts, enterNoteMode :1110)
  - INSERT `this.writeThroughCurrentDraft();` as the FIRST statement
  - UPDATE enterNoteMode JSDoc (Mode A): swap write-through guarantee — entering stages
    the in-flight question buffer (slot + seam) before the note text is seeded; with
    exitNoteMode's existing write-through, BOTH swap directions are non-destructive (R4)
  - EXTEND exitNoteMode JSDoc by one sentence stating the symmetric guarantee

Task 3: RUN gates
  - npx vitest run src/panel/panel.test.ts -v
  - npm run typecheck && npm test
```

### Implementation Patterns & Key Details

```ts
// enterNoteMode after the fix:
enterNoteMode(): void {
  // R4/ESC-002: stage the in-flight question buffer BEFORE the note seed
  // overwrites it — the forward half of the symmetric swap write-through.
  this.writeThroughCurrentDraft();
  this.focus = "note";
  this.textField.seed(this.drafts?.getNote() || this.batchNote || "");
  this.bufferOwner = "note"; // EXPLAIN-002
  this.textField.focus();
  this.invalidate();
}
// exitNoteMode: UNCHANGED — already writes batchNote + setNote before re-seeding.
```

### Integration Points

```yaml
MODULES:
  - P1.M1.T2.S1 (writeThroughCurrentDraft helper): consumed here — the third and final
    call-site family (suspend ctrl+c, discuss via suspend, note-mode swap)
  - keys.ts onBatchNote toggle (:322-327) and esc ladder (:255): UNTOUCHED — they already
    route to enter/exitNoteMode, so the fix covers all note-mode entry gestures
  - P1.M2.T1.S1: this subtask is its serialization gate — panel.ts draft machinery is
    FROZEN after this lands; keep the diff minimal
  - README/spec sweep: P1.M3.T2 — this subtask updates JSDoc only
NO CHANGES to: keys.ts, text-field.ts, draft-store.ts, discuss.ts, actions.ts, suspend()
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/panel.test.ts -v
npm run typecheck && npm test
```

### Level 3: Behavioral probe (PRD h3.1 repro, note-mode variant)

```bash
npx vitest run src/panel/panel.test.ts -t "note_mode" -v
# The new tests ARE the repro: question draft survives enterNoteMode; note survives
# exit and ctrl+c. Run once pre-fix to observe contract (a) fail.
```

### Level 4: Domain validation

- [ ] Mode A JSDoc on enterNoteMode states the swap write-through guarantee (both directions)
- [ ] `rg -n "writeThroughCurrentDraft" src/` — call sites: suspend() (S1) + enterNoteMode (S3) only
- [ ] exitNoteMode body byte-identical to pre-change (only JSDoc grew)

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green (1224+ tests, incl. S1/S2 additions)
- [ ] TDD: swap test (a) observed failing before the one-line fix
- [ ] Contracts (a)(b)(c) pass: question→note, note→question, ctrl+c-from-note all preserve their buffers
- [ ] Empty-buffer entry writes nothing; round-trip is idempotent; :1427 and :1765+ tests untouched and green
- [ ] Only `src/panel/panel.ts` + `src/panel/panel.test.ts` modified; enterNoteMode JSDoc updated (Mode A)
- [ ] Panel draft machinery now frozen for P1.M2.T1.S1

## Anti-Patterns to Avoid

- ❌ Don't place the helper call after `focus = "note"` or after the seed — the buffer is already lost/misrouted
- ❌ Don't restructure exitNoteMode — it is already symmetric on the note side
- ❌ Don't re-implement the staging inline — consume S1's helper exactly
- ❌ Don't key the slot on currentId instead of bufferOwner
- ❌ Don't write an empty buffer over an existing draft
- ❌ Don't touch keys.ts routing, suspend(), or discuss.ts — S1/S2 own those
- ❌ Don't flip existing note-mode tests (:1427, S1's extended :1339) — extend or add only
- ❌ Don't expand scope past the swap — the draft machinery freezes after this subtask

---

**Confidence Score**: 9/10 — the fix site, both swap directions, the S1 helper contract, every key-routing path (toggle/esc/enter/ctrl+c), and all test-harness anchors were verified line-by-line against the working tree; the change is a single first-statement call plus tests and JSDoc, with the reverse direction confirmed already correct.

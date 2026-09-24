# PRP — Bugfix P1.M1.T2.S1: Ungated write-through helper + suspend() integration (ctrl+c path)

## Goal

**Feature Goal**: Implement R4/ESC-002 (PRD h2.2/h3.1, BUG-002 gesture 1): a private `writeThroughCurrentDraft()` helper on `InterrogationPanel` that stages the editor's current buffer (question draft or note) to its slot + the DraftStore seam — with NO FR-18 modal, NO blur, NO invalidate — called at the top of `suspend()`, so ctrl+c (`panel.ts:748` → `suspend()`) from text or note focus never destroys typed-but-unsubmitted text.

**Deliverable**: Modified `src/panel/panel.ts` (new helper + `suspend()` integration + Mode A JSDoc) and extended tests in `src/panel/panel.test.ts`. No other files (discuss = S2, note-mode swap = S3 — they consume this helper's contract).

**Success Definition**:
- `npm run typecheck` + full `npm test` green
- TDD: ctrl+c from text focus with typed text → `panel.draftTextFor('q1')` AND a real DraftStore's `getDraft('q1')` both return the text (currently both empty — PRD h3.1 repro)
- Note focus + ctrl+c → note buffer survives via `batchNote`/`drafts.getNote()`
- Empty buffer → no slot created; options-focus suspend unchanged (no writes)
- `suspend.test.ts:585` (R4 store-survival money test) stays green; `panel.test.ts:1339` extended, not flipped

## Why

Hard requirement R4 / commitment 6 / ESC-002 principle: "Every exit is a draft write-through — backing out never loses typed text". `suspend()` (panel.ts:899-907) is only a resolved-guard + `done(null)` — it never stages the buffer. The ctrl+c branch (panel.ts:748-751) fires from ANY focus including editor focus (CTRL-C-001, checked before every other branch), so a user typing a WRITEIN-001 answer who hits ctrl+c loses the entire hand-written answer: `draftSlots` is panel-local (fresh panel on resume) and the DraftStore is never written. This subtask also ships the helper S2 (discuss) and S3 (note mode) will call.

## What

1. **New private helper** `writeThroughCurrentDraft(): void` on InterrogationPanel:
   - Guard: `if (this.focus !== "text" && this.focus !== "note") return;` and `const text = this.textField.getText(); if (text.trim() === "") return;`
   - `bufferOwner === "note"` → mirror `exitNoteMode`'s writes: `this.batchNote = text; this.drafts?.setNote(text);`
   - Else (question-id owner, `id = this.bufferOwner as string`): mirror `commitTextDraft`'s slot/seam writes ONLY — `this.draftSlots.set(id, { value: id, text }); this.drafts?.setDraft(id, text);`
   - SKIP: `blurTextField()` / `invalidate()` (the panel may be disposing during suspend), the EXPLAIN-003 cursor re-seed, and the FR-18 ripple modal (deliberate ungated — a modal would orphan pre-suspend; see Gotchas)
   - Idempotent-safe: resolved-guard ordering in suspend() makes a second call harmless (focus no longer applies after dispose)
2. **suspend() integration**: call `this.writeThroughCurrentDraft();` after the `if (this.resolved) return;` guard, BEFORE `this.done(null)`.
3. **Mode A JSDoc on suspend()**: state the R4 write-through guarantee — "every editor exit is a draft write-through: suspend stages the in-flight buffer (question draft or note) to its slot + DraftStore seam before resolving; ungated (no FR-18 modal — the panel is disposing)".

### Success Criteria

- [ ] ctrl+c from text focus (question buffer 'precious unsaved typing') → `drafts.getDraft('q1') === 'precious unsaved typing'` and `panel.draftTextFor('q1')` same; `done(null)` still called, `handleInput` still returns false
- [ ] ctrl+c from note focus with typed note → `drafts.getNote()` / `batchNote` carry the text (panel.test.ts:1339 extended with this assertion)
- [ ] ctrl+c with EMPTY buffer → no slot created (`draftTextFor` undefined), no setDraft call
- [ ] Suspend from options focus (esc descent) → zero draft writes (regression)
- [ ] `stageText`/`commitTextDraft`/`beginTextConfirm` NOT called by the helper (no modal can appear on suspend); helper does not blur or invalidate
- [ ] suspend.test.ts:585 green; full suite + typecheck green

## All Needed Context

### Context Completeness Check

Repo fully implemented (1224 tests green pre-changeset); all line references verified against the working tree (see research/notes.md for verbatim code excerpts). Agent needs this PRP plus `src/panel/panel.ts`, `src/panel/panel.test.ts`, `src/panel/suspend.test.ts`.

### Documentation & References

```yaml
- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/architecture/bug-002-draft-r4.md
  why: "THE research doc — verified-claims table, key-routing pipeline, full current code of suspend()/ctrl+c/enterNoteMode/commitTextDraft, DraftSlots+DraftStore inventory, complete test inventory"
  critical: "§2 explains why stageText must NOT be used here (FR-18 modal orphans pre-suspend) and gives the exact helper contract; §6 confirms no test asserts draft emptiness after ctrl+c — extend :1339, don't flip"

- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/P1M1T2S1/research/notes.md
  why: condensed verified excerpts: suspend() :899-907, ctrl+c :748-751, commitTextDraft :881-901 body, stageText :866-879, enterNoteMode/exitNoteMode writes, draftSlots :402, DraftStore seam :126-135, test anchors

- file: src/panel/panel.ts
  why: "the only source file. Mirror commitTextDraft (:881-901) slot/seam writes; mirror exitNoteMode's note writes (batchNote + setNote); place the helper near commitTextDraft"
  pattern: "private helper, JSDoc naming the mirrored writes and the skipped side effects"
  gotcha: "stageText (:866) adds the FR-18 ripple deferral — never call it from suspend; blurTextField/invalidate on a disposing panel are skipped deliberately"

- file: src/panel/panel.test.ts
  why: "extend test_ctrl_c_escapes_note_mode_and_editor_focus (:1339-1347, makeSuspendPanel harness) + add text-focus cases; conventions: choiceQ factory, done spy, handleInput('\\x03')"
  gotcha: ":1339 asserts suspend-only today — EXTEND with draft assertions, keep the done(null) expectation"

- file: src/panel/suspend.test.ts
  why: "test_state_epoch_and_drafts_survive_suspend_resume (:585) must stay green untouched (R4 store-survival baseline)"
  gotcha: "do not modify suspend.test.ts unless a fixture lacks a DraftStore stub — then add the minimal stub, don't rewrite the harness"

- docfile: PRD h2.2/h3.1 (BUG-002 verbatim, in this PRP's task prompt) + h2.5 recommendation "Add a single write-through helper ... call it at the top of suspend(), discussInChat, and enterNoteMode" — this subtask: helper + suspend() only
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
├── panel.ts           # MODIFY: writeThroughCurrentDraft + suspend() + JSDoc
├── panel.test.ts      # MODIFY: extend :1339 + new ctrl+c draft tests
└── suspend.test.ts    # verify green (untouched)
src/draft-store.ts     # untouched (seam impl; tests use a stub or real instance per harness)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: do NOT route through stageText — its FR-18 beginTextConfirm would
//   open a ripple modal the suspending panel can never service (orphaned).
//   The ungated write-through is deliberate; PRD accepts a pending-edit write
//   without modal at suspend time.
// CRITICAL: skip blurTextField() and invalidate() — the panel is disposing;
//   render side effects are both unnecessary and unsafe mid-teardown. Skip the
//   EXPLAIN-003 cursor re-seed for the same reason.
// GOTCHA: note focus — write batchNote AND drafts.setNote (mirror exitNoteMode,
//   panel.ts:~1120). S3 owns the full symmetric swap; here just don't LOSE the note.
// GOTCHA: bufferOwner (EXPLAIN-002) is the owner discriminator: "note" vs question id.
//   When focus === "text", bufferOwner is a question id (=== currentId via the
//   ✎ affordance path) — use bufferOwner, not currentId, for the slot key.
// GOTCHA: empty-buffer guard prevents resurrecting a cleared draft with "".
// GOTCHA: ctrl+c handleInput returns false by design (pi's own ctrl+c flow resumes
//   on the restored editor) — do not change the return.
// GOTCHA: idempotence — writeThroughCurrentDraft must be safe if focus is already
//   "options" (no-op) so suspend() from options focus is unchanged.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: WRITE FAILING TESTS FIRST (src/panel/panel.test.ts, near :1339)
  - EXTEND test_ctrl_c_escapes_note_mode_and_editor_focus: after handleInput("\\x03"),
    assert the note survived (drafts stub / batchNote carries the typed text)
  - ADD test_ctrl_c_from_text_focus_writes_through_draft (BUG-002/R4):
    makeSuspendPanel over choiceQ("q1"); open editor (focus "text", bufferOwner "q1"
    via the existing editor-open path used by text-field tests); setText
    "precious unsaved typing"; expect(handleInput("\\x03")).toBe(false);
    expect(done).toHaveBeenCalledWith(null);
    expect(panel.draftTextFor("q1")).toBe("precious unsaved typing");
    expect(draftsStub.getDraft("q1")).toBe("precious unsaved typing")   // FAILS today
  - ADD test_ctrl_c_empty_buffer_no_slot: same setup, empty buffer →
    draftTextFor("q1") === undefined, setDraft never called
  - ADD test_suspend_from_options_focus_writes_nothing (regression): esc-descent
    or direct suspend() with focus "options" → no draft writes
  - RUN npx vitest run src/panel/panel.test.ts — confirm the new assertions fail

Task 2: IMPLEMENT writeThroughCurrentDraft() in src/panel/panel.ts (near commitTextDraft :881)
  - PRIVATE helper, full JSDoc: mirrors commitTextDraft's slot/seam writes and
    exitNoteMode's note writes; skips blur/invalidate/EXPLAIN-003/FR-18; called
    by suspend() (and, in later subtasks, the discuss and note-mode exits)
  - Body per the Blueprint in What §1

Task 3: INTEGRATE into suspend() (:899-907)
  - After `if (this.resolved) return;` insert `this.writeThroughCurrentDraft();`
    before `this.resolved = true; this.done(null);`
  - UPDATE suspend() JSDoc (Mode A): add the R4 guarantee sentence

Task 4: RUN gates
  - npx vitest run src/panel/panel.test.ts src/panel/suspend.test.ts -v
  - npm run typecheck && npm test
```

### Implementation Patterns & Key Details

```ts
// The helper (exact shape):
private writeThroughCurrentDraft(): void {
  if (this.focus !== "text" && this.focus !== "note") return;
  const text = this.textField.getText();
  if (text.trim() === "") return;
  if (this.bufferOwner === "note") {
    // mirror exitNoteMode — never lose the note buffer on suspend
    this.batchNote = text;
    this.drafts?.setNote(text);
    return;
  }
  const id = this.bufferOwner; // question id (EXPLAIN-002)
  if (typeof id === "string") {
    this.draftSlots.set(id, { value: id, text });
    this.drafts?.setDraft(id, text);
  }
  // deliberately NOTHING else: no blur, no invalidate, no cursor re-seed, no FR-18 modal
}

// suspend() after integration:
suspend(): void {
  if (this.resolved) return;
  this.writeThroughCurrentDraft(); // R4/ESC-002: every editor exit is a write-through
  this.resolved = true;
  this.done(null);
}
```

### Integration Points

```yaml
MODULES (no changes now — contracts only):
  - P1.M1.T2.S2 (discuss gesture): "discussInChat calls panel.suspend() — it inherits the write-through for free; S2 adds its own tests/template concerns"
  - P1.M1.T2.S3 (note-mode swap): "calls writeThroughCurrentDraft() before enterNoteMode()'s re-seed, routing BOTH buffers symmetrically; helper must stay side-effect-free for that reuse"
  - README/spec wording: P1.M3.T2 — this subtask only updates suspend()'s JSDoc
NO CHANGES to: discuss.ts, keys.ts, stageText, commitTextDraft, exitNoteMode, draft-store.ts, text-field.ts
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/panel.test.ts src/panel/suspend.test.ts -v
npm test
```

### Level 3: Behavioral probe (PRD h3.1 repro, harness-level)

```bash
npx vitest run src/panel/panel.test.ts -t "ctrl_c" -v
# The extended/new tests ARE the repro: draft + store populated after \x03 from text focus.
```

### Level 4: Domain validation

- [ ] suspend() JSDoc states the R4 write-through guarantee (Mode A)
- [ ] `rg -n "writeThroughCurrentDraft" src/` — defined once, called from suspend() only (S2/S3 add their call sites later)

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green (incl. suspend.test.ts:585)
- [ ] TDD: new draft assertions observed failing before the fix
- [ ] ctrl+c from text focus writes question draft to slot + store; from note focus writes note; empty buffer writes nothing; options focus unchanged
- [ ] No blur/invalidate/modal/cursor side effects in the helper; stageText/commitTextDraft untouched
- [ ] Only src/panel/panel.ts + src/panel/panel.test.ts modified; suspend() JSDoc updated

## Anti-Patterns to Avoid

- ❌ Don't use stageText — the FR-18 modal orphans on a suspending panel
- ❌ Don't blur or invalidate from the helper — the panel may be disposing
- ❌ Don't gate the write-through on answer status — it is deliberately ungated
- ❌ Don't use currentId instead of bufferOwner for the slot key
- ❌ Don't write an empty buffer over an existing draft
- ❌ Don't touch discuss.ts/enterNoteMode in this subtask — S2/S3's contracts
- ❌ Don't flip panel.test.ts:1339 — extend it

---

**Confidence Score**: 9/10 — all code sites, the existing write-through machinery, seam interfaces, and test anchors verified line-by-line against the working tree (bug-002-draft-r4.md + fresh reads); the fix is a small mirror of two existing write patterns with explicitly enumerated skips.

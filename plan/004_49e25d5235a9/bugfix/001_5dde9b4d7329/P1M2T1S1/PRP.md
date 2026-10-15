---
name: "P1.M2.T1.S1 — openExternalEditor note-duty fork: completed text routes to batchNote/setNote, never the question slot (BUG-002 apply side)"
description: "Surgical routing fork in src/panel/panel.ts openExternalEditor: inside the 'result.status === \"complete\"' block, after textField.setText(result.content), branch on this.bufferOwner === 'note' → { this.batchNote = result.content; this.drafts?.setNote(result.content); } (mirroring exitNoteMode's write-through exactly) and leave bufferOwner === 'note'; else keep the existing question-draft block verbatim. Everything duty-blind stays as-is. TDD note-mode sibling of the :1905 clean-exit test via makeEditorHarness. JSDoc extended to name both routing targets (Mode A). Dormant until P1.M2.T1.S2 widens the ctrl+g gate — no corruption window."
---

## Goal

**Feature Goal**: openExternalEditor is duty-correct in note mode: an external-editor round-trip launched while `bufferOwner === "note"` routes the completed text to the note (`batchNote` + DraftStore `setNote`), never to the current question's draft slot, and never re-scopes `bufferOwner`.

**Deliverable**: Modified `src/panel/panel.ts` (routing fork in openExternalEditor + Mode A JSDoc) + one new test in `src/panel/panel.test.ts` (note-mode sibling of the clean-exit test).

**Success Definition**: `npm test` + `npm run typecheck` green; note-mode round-trip: `drafts.setNote` called with the edited text, `panel.batchNote` updated, `drafts.setDraft` NOT called, `draftSlots` untouched for the current question, `bufferOwner` stays `"note"`, `focus` stays `"note"`, TUI envelope (stop→edit→start) unchanged; the existing question-draft clean-exit test green verbatim.

## User Persona

**Target User**: TUI user composing a batch note (`m`) who wants to edit it in `$VISUAL`/`$EDITOR` like every other editor duty.

**Use Case**: Note mode → (after P1.M2.T1.S2 lands the gate) ctrl+g → $EDITOR seeded with the note draft → clean exit → the note text replaces the field AND persists as the held note that ships as `NOTE:` with the next submission.

**Pain Points Addressed**: BUG-002's apply-side half — the hardwired question-draft path would corrupt the current question's draft with note text and re-scope `bufferOwner` away from `"note"` (breaking EXPLAIN-002's question-scoping suspension).

## Why

- h2.5 recommendation (verbatim): "in openExternalEditor route the completed text to batchNote (not the current question's draft slot) while bufferOwner === 'note'."
- ui-spec hotkey context: "editor focus (any duty)" — one editor, three duties; the note is question-agnostic (`enterNoteMode` suspends question scoping by setting `bufferOwner = "note"`).
- `exitNoteMode` already defines the canonical note write-through pair (`this.batchNote = text; this.drafts?.setNote(text);`) and the note submit path reads exactly that pair (`actions.ts:703 panel.drafts?.getNote() || panel.batchNote`) — the fork mirrors it, keeping both consistent.
- Order-of-landing: this apply-side fix lands BEFORE the router gate widens (P1.M2.T1.S2), so the corrected routing is dormant-but-correct when the gate opens — no corruption window and no user-visible change from this item alone.

## What

### 1. The fork — `src/panel/panel.ts` openExternalEditor

Current complete-branch (grep `result.status === "complete"` inside openExternalEditor; ~:1330-1340):

```ts
if (result.status === "complete") {
  const id = this.currentId;
  this.textField.setText(result.content);
  if (id !== undefined) {
    this.draftSlots.set(id, { value: id, text: result.content });
    this.drafts?.setDraft(id, result.content);
    this.bufferOwner = id; // EXPLAIN-002: buffer now belongs to this question
  }
  this.invalidate();
}
```

New:

```ts
if (result.status === "complete") {
  this.textField.setText(result.content);
  if (this.bufferOwner === "note") {
    // BUG-002 note duty: the buffer held the NOTE — route the edited text
    // to the note write-through pair (mirrors exitNoteMode exactly: R4
    // persistence + the submit-read pair drafts.getNote() || batchNote).
    // NEVER the question slot (note text is not an answer draft), and
    // bufferOwner STAYS "note" (EXPLAIN-002: note duty suspends question
    // scoping until exitNoteMode re-scopes).
    this.batchNote = result.content;
    this.drafts?.setNote(result.content);
  } else {
    const id = this.currentId;
    if (id !== undefined) {
      this.draftSlots.set(id, { value: id, text: result.content });
      this.drafts?.setDraft(id, result.content);
      this.bufferOwner = id; // EXPLAIN-002: buffer now belongs to this question
    }
  }
  this.invalidate();
}
```

Rules:
- **Everything duty-blind stays as-is**: the re-entrancy guard, `draft = this.textField.getText()` read-before-suspend (correct in note mode — the note lives in the same TextField), the `tui.stop()` / `finally { …tui.start(); requestRender(true) }` envelope, the catch/finally swallow, `externalEditorInFlight` clearing. Touch NOTHING outside the complete-branch.
- `textField.setText` runs for BOTH branches (the text replaces the field — h2.31) before the fork.
- In the note branch, do NOT touch `draftSlots`, do NOT call `setDraft`, do NOT reassign `bufferOwner`.
- The else branch is the existing block VERBATIM (minus the now-shared setText line).

### 2. JSDoc — extend openExternalEditor's docblock (~:1306-1319)

Where it says "…replace the field text (BOM-stripped, one trailing newline dropped) and sync the draft slot + DraftStore seam", extend: the apply is DUTY-ROUTED on `bufferOwner` — question duty (write-in/elaboration) syncs the h2.45 draft slot + DraftStore draft seam and re-scopes the buffer to the question; NOTE duty (`bufferOwner === "note"`) writes the exitNoteMode-mirroring note pair (`batchNote` + `setNote`) and keeps the buffer note-scoped (BUG-002). One or two sentences, Mode A.

### 3. Test — `src/panel/panel.test.ts`, in the `openExternalEditor` describe (:1905+)

TDD: write it first, watch it fail (it corrupts q1's slot / re-scopes owner at HEAD).

```ts
test("test_note_duty_routes_edited_text_to_note_never_question_slot (BUG-002)", async () => {
  const h = makeEditorHarness();
  h.panel.enterNoteMode();          // focus "note", bufferOwner "note", seeded from getNote()=""
  h.editor.setText("note draft");
  editMock.mockResolvedValue({ status: "complete", content: "edited note" });

  await h.panel.openExternalEditor();

  // Note write-through pair (exitNoteMode mirror):
  expect(h.drafts.setNote).toHaveBeenCalledWith("edited note");
  expect((h.panel as unknown as { batchNote: string }).batchNote).toBe("edited note");
  // NEVER the question slot:
  expect(h.drafts.setDraft).not.toHaveBeenCalled();
  expect(draftSlotsOf(h.panel).has("q1")).toBe(false);
  // Duty state intact:
  expect((h.panel as unknown as { bufferOwner: string }).bufferOwner).toBe("note");
  expect(h.panel.focus).toBe("note");
  // Field replaced + envelope unchanged:
  expect(h.editor.setText).toHaveBeenCalledWith("edited note");
  expect(h.tui.stop).toHaveBeenCalledTimes(1);
  expect(h.tui.start).toHaveBeenCalledTimes(1);
});
```

(Access private fields the way `draftSlotsOf` does — same cast convention. If `batchNote`/`bufferOwner` already have exposed read paths in the harness, prefer them.)

### 4. Explicitly OUT of scope

- The router gate widening (keys.ts:566 `panel.focus === "text"` → editorFocused any duty) + its three stale comments + router-test flips — P1.M2.T1.S2.
- The end-to-end keymap-ac note-duty ctrl+g round-trip — P1.M2.T1.S3.
- README caps purge — P1.M3. WRITEIN-002 re-bind work (P1.M1, in flight) — different files/paths.
- Any change to `enterNoteMode` / `exitNoteMode` / `writeThroughCurrentDraft` / the DraftStore seam.

### Success Criteria

- [ ] Note-mode round-trip: setNote + batchNote updated; setDraft NOT called; draftSlots untouched; bufferOwner and focus stay "note"
- [ ] Question-duty behavior byte-identical (existing :1905 clean-exit test green verbatim; failed/rejected/in-flight tests green)
- [ ] Duty-blind envelope untouched (stop→edit→start ordering, guard, catch/finally)
- [ ] JSDoc names both routing targets; full suite + typecheck green

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets: the exact current block, the exact fork code with comments, the mirrored-precedent rationale (exitNoteMode pair + submit read path), the complete test with the harness and private-field cast convention, and the ordering story (dormant until S2). No guessing.

### Documentation & References

```yaml
- file: src/panel/panel.ts
  why: openExternalEditor ~:1306-1348 (JSDoc + complete-branch); bufferOwner decl :435; enterNoteMode :1265-1271 (note seed + bufferOwner="note"); exitNoteMode :1286-1291 (the write-through pair to mirror)
  pattern: the fork mirrors exitNoteMode's two writes exactly — no new persistence shape
  gotcha: read-before-suspend (textField.getText()) is CORRECT duty-blind — the note lives in the same TextField; do not "fix" it

- file: src/panel/actions.ts
  why: :703 note submit read path (drafts.getNote() || batchNote) and :763-764 post-ship clear — the consistency argument for writing BOTH fields
- file: src/panel/panel.test.ts
  why: makeEditorHarness :1881-1903 (enterNoteMode is the note-mode switch), draftSlotsOf helper, the :1905+ describe with editMock patterns (vi.mock('../external-editor.js') already at top of file)
  gotcha: seed the note via h.editor.setText AFTER enterNoteMode (enterNoteMode seeds from getNote() → "" and would overwrite your text otherwise)

- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/architecture/bug002-003-ctrlg-and-stale-caps.md
  why: §(b) — the verified analysis: duty-blind seed correct, apply side hardwired, routing-target corruption detail
- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/prd_snapshot.md (h2.3/h3.0 BUG-002, h2.5 rec 2)
  why: defect definition and the recommended fix locus
- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/P1M2.T1.S2 PRP (if present) / tasks.json ordering
  why: the gate-widening sibling — this item must land first so the widened gate exposes correct routing
```

### Current Codebase tree (relevant slice)

```bash
src/panel/ panel.ts (+ panel.test.ts)
```

### Desired Codebase tree

```bash
# no new files
src/panel/panel.ts        # routing fork in openExternalEditor + JSDoc extension
src/panel/panel.test.ts   # +1 note-duty test in the openExternalEditor describe
```

### Known Gotchas of our codebase & Library Quirks

```ts
// Line numbers drift (parallel M1 items in actions.ts) — grep `result.status === "complete"` inside openExternalEditor
// bufferOwner is the SOLE discriminator — never test focus alone (focus "note" implies owner "note" today, but the contract is owner-based)
// enterNoteMode seeds the field from getNote() — set your note text AFTER calling it
// draftSlotsOf-style casts are the established convention for private-field assertions in this test file
// ctrl+g is still gated to text focus until P1.M2.T1.S2 — the new test calls openExternalEditor DIRECTLY; do not route through handleInput for the note case
// the failed/rejected/in-flight/guard tests must stay green untouched — they exercise the duty-blind envelope this item does not modify
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: WRITE the failing note-duty test (What §3) in the openExternalEditor describe
  - RUN npx vitest run src/panel/panel.test.ts -t openExternalEditor → new test FAILS at HEAD (corrupts q1 slot / re-scopes owner)

Task 2: MODIFY src/panel/panel.ts — the routing fork + JSDoc (What §1-2)

Task 3: GATES
  - npx vitest run src/panel/panel.test.ts
  - npm test && npm run typecheck
```

### Implementation Patterns & Key Details

```ts
// The whole logic change (see What §1): one if/else inside the complete branch.
// Note branch = exitNoteMode's pair, verbatim semantics:
this.batchNote = result.content;
this.drafts?.setNote(result.content);
// …and NOTHING else — no slot write, no setDraft, no bufferOwner assignment.
```

### Integration Points

```yaml
DOWNSTREAM (do NOT implement):
  - P1.M2.T1.S2: keys.ts:566 gate → editorFocused (any duty) + stale-comment sync + router-test flips — exposes this fork to real ctrl+g presses
  - P1.M2.T1.S3: keymap-ac end-to-end note-duty round-trip
CONSISTENCY (read-only proof):
  - actions.ts:703 submit reads drafts.getNote() || batchNote — both fields written by the fork
  - actions.ts:763-764 post-ship clear — unaffected
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npx vitest run src/panel/panel.test.ts -t openExternalEditor
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/panel.test.ts
npm test   # full suite — the parallel P1.M1.T4.S3 auto-submit variant must stay green; no shared files with it
```

### Level 3: Integration Testing

None needed — the E2E is P1.M2.T1.S3's, and the router still gates ctrl+g to text focus until S2 (dormant by design).

### Level 4: Domain Validation

Trace: note mode → owner "note" → round-trip → setNote+batchNote, slot untouched, owner stays "note" → submit reads getNote() → `NOTE:` line ships. Pinned by the new test.

## Final Validation Checklist

- [ ] `npm test` + `npm run typecheck` green; all five existing openExternalEditor tests green verbatim
- [ ] Note branch writes exactly the exitNoteMode pair; no slot/setDraft/bufferOwner writes
- [ ] Question branch byte-identical; duty-blind envelope untouched
- [ ] JSDoc names both routing targets (Mode A, cites BUG-002 / exitNoteMode mirror)
- [ ] Only panel.ts + panel.test.ts modified; TDD order followed

## Anti-Patterns to Avoid

- ❌ Don't branch on `focus` — `bufferOwner` is the discriminator the rest of the panel uses
- ❌ Don't re-scope `bufferOwner` in the note branch — exitNoteMode owns the re-scope
- ❌ Don't touch the read-before-suspend line, envelope, guard, or catch/finally — all duty-blind by design
- ❌ Don't widen the router gate here — P1.M2.T1.S2 (this item must land first, gate second)
- ❌ Don't route through handleInput in the test — ctrl+g is still text-gated at HEAD

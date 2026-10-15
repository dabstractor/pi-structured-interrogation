---
name: "P1.M2.T1.S3 — End-to-end AC: note-duty ctrl+g round-trip (keymap-ac pattern) (BUG-002 acceptance proof)"
description: "Add ONE test to src/panel/keymap-ac.test.ts — test_ac1_ctrl_g_note_duty_round_trips_into_the_batch_note_style_b — proving the full BUG-002 stack: 'm'-entered note duty → handleInput(CTRL_G) consumed → real editInExternalEditor against the fake child_process spawn with REAL fs → completed text routed to batchNote/drafts.setNote, NEVER drafts.setDraft → tui stop/start envelope → focus stays 'note'. Uses the file's established AC-1 pattern: vi.hoisted spawnMock (already at module top), vi.stubEnv VISUAL='' EDITOR='fakeed', spawnWrites(...), spy on panel.openExternalEditor + await spy.mock.results[0].value for the fire-and-forget router action. Also add one coverage-table row to the header (keymap-ac.test.ts:22-23 area) citing this task ID. This is the full-stack acceptance proof P1.M3.T2's README sweep checks against. PREREQUISITES: P1.M2.T1.S1 (apply-side note fork) landed and P1.M2.T1.S2 (gate widened to editorFocused) landed."
---

## Goal

**Feature Goal**: Pin BUG-002 fixed end-to-end — a single acceptance test that drives the real `InterrogationPanel` through the entire note-duty ctrl+g round-trip (raw byte in → router → fire-and-forget `openExternalEditor` → real `editInExternalEditor` with fake spawn + real temp-file lifecycle → duty-correct apply), so no future change can re-narrow the gate or re-break the routing without going red.

**Deliverable**: Modified `src/panel/keymap-ac.test.ts` only — one new test inside the existing `describe("AC-1 …")` block plus one coverage-table row in the header audit table. No production code changes.

**Success Definition**: `npx vitest run src/panel/keymap-ac.test.ts` green with the new test present; `npm test` + `npm run typecheck` green; the test asserts every contract point: consumed byte, spawn args, seeded note draft, apply to `batchNote`/`drafts.setNote`, `drafts.setDraft` NOT called, stop/start envelope ×1 each, `focus === "note"` after.

## User Persona

**Target User**: The changeset's future maintainers (and P1.M3.T2's README sweep, which cites this AC as the BUG-002 guard). Secondarily the TUI user whose bug this proves fixed.

**Use Case**: Regression guard — any of the four failure modes of BUG-002 (gate re-narrowed to text-only, apply-side fork reverted so note text corrupts a question draft, seeding broken, focus escape) turns this test red.

**User Journey**: `m` (note mode) → ctrl+g → `$EDITOR` opens seeded with the note draft → edit → clean exit → note updated in place; the question's draft untouched.

**Pain Points Addressed**: BUG-002 shipped as two atomic halves (S1 router-fix apply fork, S2 gate widening) with unit coverage at each layer; this is the one test that proves the composed stack, in the file whose header table is the changeset's coverage ledger.

## Why

- Contract: "Full-stack acceptance proof for BUG-002 — the guard P1.M3.T2's README sweep checks against." Without it, BUG-002 is covered only at the seams (router stub test in keys.test.ts, module-mock test in panel.test.ts) — a regression that reintroduces the bug across BOTH files would pass each seam test individually.
- The keymap-ac header table (L22–23 area) is the file's stated gap-audit ledger ("this file adds ONLY the gaps"); the note-duty E2E is a genuine gap row — its AC-1 sibling row (`ctrl+g routed END-TO-END with mocked spawn`, text duty) has no note-duty twin.
- Architecture research (bug002-003-ctrlg-and-stale-caps.md §(d) layer 3) names this exact test as the sanctioned pattern: `vi.hoisted` spawnMock + real fs, `CTRL_G = "\u0007"` (keymap-ac.test.ts:96), AC-1 precedent at :313–341 including `await spy.mock.results[0].value` for the fire-and-forget router action.

## What

Add to `src/panel/keymap-ac.test.ts`, inside `describe("AC-1 — two-tier dispatch/typing + surviving chords (delta_prd §3.1)")`, immediately after the options-focus negative twin (~:354):

```ts
test("test_ac1_ctrl_g_note_duty_round_trips_into_the_batch_note_style_b", async () => {
  // BUG-002 E2E (P1.M2.T1.S3): ctrl+g is editor focus ANY duty — from note
  // duty the completed text must land in batchNote/drafts.setNote, NEVER the
  // current question's draft slot (the pre-fix corruption mode).
  const state = seedOpen(["q1"]);
  const { panel, editor, drafts, tui } = makePanel(state);
  panel.enterNoteMode(); // public seam — same as pressing 'm' (open-only)
  expect(panel.focus).toBe("note");
  editor.setText("note draft"); // seed the note buffer (typed-equivalent)

  vi.stubEnv("VISUAL", ""); // empty = unset → $EDITOR wins
  vi.stubEnv("EDITOR", "fakeed");
  spawnWrites("edited note\n");

  const spy = vi.spyOn(panel, "openExternalEditor");
  expect(panel.handleInput(CTRL_G)).toBe(true); // editorFocused gate (P1.M2.T1.S2)
  expect(spy).toHaveBeenCalledTimes(1);

  await spy.mock.results[0]!.value; // await the fire-and-forget round-trip

  // spawn: resolved $EDITOR command + one temp answer file, inherit stdio.
  expect(spawnMock).toHaveBeenCalledTimes(1);
  const [command, args, opts] = spawnMock.mock.calls[0] as [string, string[], { stdio: string }];
  expect(command).toBe("fakeed");
  expect(args).toHaveLength(1);
  expect(args[0]).toMatch(/answer\.md$/);
  expect(opts.stdio).toBe("inherit");
  // Seeded with the NOTE draft (duty-blind seeding side), applied to the note.
  expect(seededAtSpawn).toBe("note draft");
  expect(editor.setText).toHaveBeenCalledWith("edited note");
  expect(panel.textField.getText()).toBe("edited note"); // trailing \n stripped
  expect(drafts.setNote).toHaveBeenCalledWith("edited note"); // note write-through
  expect(panel.batchNote).toBe("edited note");
  expect(drafts.setDraft).not.toHaveBeenCalled(); // NEVER the question slot
  // Envelope + duty preserved: stop before, start after; still note focus.
  expect(tui.stop).toHaveBeenCalledTimes(1);
  expect(tui.start).toHaveBeenCalledTimes(1);
  expect(panel.focus).toBe("note");
});
```

And one header-table row (audit table, AC-1 block, after the existing ctrl+g rows at L22–23):

```
| 1   | ctrl+g note-duty E2E round-trip (BUG-002)          | keys.test.ts router legs (P1.M2.T1.S2) | ✅ full-stack round-trip → batchNote/setNote, never setDraft (P1.M2.T1.S3) |
```

### Implementation notes / gotchas

- `panel.enterNoteMode()` seeds from `drafts.getNote() || batchNote || ""` — the draftsStub returns undefined/"" so the field starts empty; `editor.setText("note draft")` after entering is the seeding step. recordingEditor's `setText` writes through so `panel.textField.getText()` reflects it (same mechanism the AC-1 text-duty test relies on).
- `openExternalEditor` reads the buffer BEFORE `tui.stop()` — `seededAtSpawn` must equal the note buffer, proving the duty-blind seeding side.
- Apply fork discriminator is `bufferOwner === "note"` (private; observable here only through behavior: `setNote` called / `setDraft` not called / focus unchanged).
- If P1.M2.T1.S1/S2 are NOT yet landed when implementing: this test will FAIL (red) on the current tree — that is expected TDD posture for this item's ordering; the implementation agent should verify both siblings landed (grep `bufferOwner === "note"` in panel.ts's openExternalEditor and `editorFocused && matchesKey(data, b.externalEditor)` in keys.ts) before expecting green, and report if either prerequisite is missing rather than weakening assertions.

### Success Criteria

- [ ] New test present, named `test_ac1_ctrl_g_note_duty_round_trips_into_the_batch_note_style_b`, passing
- [ ] All nine assertion groups pass: consumed, spawn args ×3, seeded content, setText, getText, setNote, batchNote, setDraft-NOT-called, stop/start, focus
- [ ] Header table gains the BUG-002 row citing P1.M2.T1.S3
- [ ] No production-code edits; no other test modified
- [ ] `npm test` + `npm run typecheck` fully green

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets: the exact test to write (code above), the harness functions it calls with their definitions' locations, the mock mechanics (spawnMock is already module-level; beforeEach/afterEach in the describe already reset it), the fire-and-forget awaiting idiom, the prerequisite verification greps, and the header-table convention. Nothing to invent.

### Documentation & References

```yaml
- file: src/panel/keymap-ac.test.ts
  why: THE file — copy its AC-1 ctrl+g E2E test (:313-341) and negative twin (:343-354) shape verbatim;
    harness: makePanel (:193-211), seedOpen (:213-218), spawnWrites + seededAtSpawn (:220-233),
    CTRL_G (:96), spawnMock vi.hoisted mock (:52-54), header table (:22-23).
  pattern: Style B (real panel + real state + recordingEditor + spy drafts/tui + raw bytes)
  gotcha: spawnMock is reset in the describe's beforeEach — do NOT re-mock child_process; just spawnWrites()

- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/architecture/bug002-003-ctrlg-and-stale-caps.md
  why: §(d) layer 3 documents this exact pattern (line cites); §(b) the apply-side fork semantics;
    §(f) risk 5 — "an editor round-trip in note duty leaves focus === 'note' (no blur/commit)" — the focus assertion

- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/P1M2T1S1/PRP.md
  why: CONTRACT — the apply-side fork (bufferOwner === "note" → batchNote + drafts.setNote,
    bufferOwner stays "note", never setDraft) that this test pins

- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/P1M2T1S2/PRP.md
  why: CONTRACT — the editorFocused gate widening that makes handleInput(CTRL_G) return true
    from note focus (the test's first assertion)

- file: src/panel/panel.ts
  why: enterNoteMode (public), openExternalEditor (post-S1 fork), batchNote (public field, read
    at submit), focus/exitNoteMode semantics
  gotcha: enterNoteMode calls writeThroughCurrentDraft FIRST — with an empty question buffer this
    is a no-op; do NOT pre-type into the question field in this test (setDraft-not-called must hold)

- file: src/panel/keys.test.ts
  why: the router-level note-focus legs land there via S2 — this test must NOT duplicate them
    (it is the composed E2E, not the router probe)
```

### Current Codebase tree

```bash
src/panel/ keys.ts panel.ts actions.ts … keymap-ac.test.ts (+ other tests)
# P1.M2.T1.S1 (apply fork) Complete; P1.M2.T1.S2 (gate widening) Implementing — contract in its PRP
```

### Desired Codebase tree

```bash
src/panel/keymap-ac.test.ts   # MODIFIED — +1 test, +1 header-table row. Nothing else.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// spawnMock: module-level vi.hoisted mock already in place — never re-declare; spawnWrites()
//   sets the implementation, describe-level beforeEach resets call history.
// The router action is FIRE-AND-FORGET (`void p.openExternalEditor()`) — the ONLY way to await
//   it is spy.mock.results[0].value (AC-1 precedent). handleInput returning true is sync and
//   does NOT mean the round-trip finished.
// vi.stubEnv with "" means UNSET — VISUAL must be stubbed empty or a real $VISUAL leaks in.
// spawnWrites content "edited note\n" — editInExternalEditor strips the trailing newline;
//   assert "edited note" (no \n), matching the text-duty precedent.
// beforeEach/afterEach in the AC-1 describe already handle reset + vi.unstubAllEnvs() — reuse
//   the existing block; do not add a second pair.
// ESM ".js" import suffixes; no new imports needed (all harness symbols already in scope).
```

## Implementation Blueprint

### Data models and structure

None — test-only; all types (`StyleBHandle`, `Mock`) already exported/inferred in the file.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: PREREQUISITE CHECK (fail fast, do not weaken)
  - grep 'bufferOwner === "note"' src/panel/panel.ts   # P1.M2.T1.S1 fork
  - grep 'editorFocused && matchesKey(data, b.externalEditor)' src/panel/keys.ts  # P1.M2.T1.S2 gate
  - Either missing → write the test anyway (it is the contract), run it to confirm RED,
    and report the missing prerequisite in the completion notes. NEVER relax an assertion
    to force green.

Task 1: ADD the test to src/panel/keymap-ac.test.ts
  - PLACE: inside describe("AC-1 …"), immediately after test_ac1_ctrl_g_from_options_focus_does_not_spawn_style_b
  - IMPLEMENT: verbatim per the What section (name, flow, assertions)
  - NAMING: test_ac1_ctrl_g_note_duty_round_trips_into_the_batch_note_style_b (house convention:
    test_ac<N>_<behavior>_style_<A|B>)

Task 2: ADD the header coverage-table row (AC-1 block, after the existing ctrl+g rows ~:22-23)
  - Row cites BUG-002 and P1.M2T1.S3 in the "added here" column per house convention

Task 3: RUN the gates
  - npx vitest run src/panel/keymap-ac.test.ts -v   # new test green
  - npm test && npm run typecheck                   # no regressions
```

### Implementation Patterns & Key Details

```ts
// The one non-obvious idiom — awaiting the fire-and-forget router action:
const spy = vi.spyOn(panel, "openExternalEditor");
expect(panel.handleInput(CTRL_G)).toBe(true);      // sync: routed + dispatched
await spy.mock.results[0]!.value;                   // async: the actual round-trip
// CRITICAL: assertions on spawn/editor/drafts/tui MUST come after the await —
// before it, the temp file may not even exist yet (queueMicrotask in spawnWrites).
// PATTERN: negative assertion is half the bug — drafts.setDraft not called is what
// distinguishes the FIXED routing from the pre-fix corruption (note text overwriting
// the current question's draft slot + DraftStore draft).
```

### Integration Points

```yaml
NO PRODUCTION EDITS: this item touches keymap-ac.test.ts ONLY (contract point 5: "none beyond
  the test header coverage-table row").
DOWNSTREAM: P1.M3.T2.S1/S2 README sweep cites this AC as BUG-002's guard; the test name and
  task ID should be findable via grep (test_ac1_ctrl_g_note_duty… / P1.M2.T1.S3).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck
npx vitest run src/panel/keymap-ac.test.ts
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/panel/keymap-ac.test.ts -v   # new test green + all AC-1..6 tests green
npm test                                        # full suite
# Expected: all green. If ONLY the new test is red, check Task 0 prerequisites.
```

### Level 3: Integration Testing (System Validation)

This test IS the integration test (real panel + real state + real editInExternalEditor + real fs, only spawn faked at the child_process boundary per house convention).

### Level 4: Creative & Domain-Specific Validation

Optional manual TUI twin: load extension, `/interrogate` debug upsert, `m`, ctrl+g → `$EDITOR` opens seeded with the note draft, edit, exit → note text replaces the buffer; next ctrl+s submission carries the `NOTE:` line. Cross-check write-in duty still works.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean
- [ ] `npm test` fully green (all suites)

### Feature Validation

- [ ] New test passes with ALL assertion groups (consumed / spawn×3 / seeded / setText / getText / setNote / batchNote / setDraft-NOT / stop+start / focus)
- [ ] Header coverage-table row added citing P1.M2.T1.S3
- [ ] Prerequisite greps (Task 0) recorded; missing prerequisites reported, not papered over

### Code Quality Validation

- [ ] Only keymap-ac.test.ts modified; existing tests untouched
- [ ] Test name follows `test_ac1_…_style_b` convention; placed in the AC-1 describe
- [ ] Reuses existing harness (makePanel/seedOpen/spawnWrites/CTRL_G) — nothing re-declared

### Documentation & Deployment

- [ ] Header table row is the only doc change (house convention; contract point 5)
- [ ] No new config keys, env vars, or production surface

---

## Anti-Patterns to Avoid

- ❌ Don't assert before `await spy.mock.results[0].value` — the round-trip is async
- ❌ Don't drop the `drafts.setDraft` NOT-called assertion — it is the corruption guard
- ❌ Don't weaken assertions (e.g. `focus` to "any") if prerequisites are missing — report instead
- ❌ Don't re-mock child_process or add a second beforeEach/afterEach pair — the file already has them
- ❌ Don't pre-type into the question buffer — it would make setDraft-not-called vacuous
- ❌ Don't add router-level assertions here (dispatch booleans on stub panels) — those live in keys.test.ts via S2

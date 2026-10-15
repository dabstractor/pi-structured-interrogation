---
name: "P1.M1.T4.S1 — User-held-draft-wins + deleted-to-empty-wins guard-4 scenarios"
description: "Two stabilization tests in src/panel/actions.test.ts pinning stageSupersededWriteIn guard 4's `!== undefined` semantics: a genuine user-held elaboration draft wins over re-staging, and a deliberate delete-to-empty (\"\") slot is equally user-held (no re-bind). Test-only; no source changes."
---

## Goal

**Feature Goal**: Pin guard 4 of `stageSupersededWriteIn` (src/panel/actions.ts:369, `if (panel.draftTextFor(questionId) !== undefined) return; // 4: user-held draft wins (incl. delete-to-empty "")`) with two real-gesture scenario tests, so the adjudicated WRITEIN-002 restore (BUG-001) keeps its most R4-faithful semantics through P1.M3.T2's coherence sweep: the helper re-stages a superseded write-in ONLY when the user holds no draft — any defined slot text (typed elaboration OR deliberate delete-to-empty `""`) is the user's and wins.

**Deliverable**: Two new tests in `src/panel/actions.test.ts`, inside the `describe("submit — WRITEIN-002 draft role binding (h2.32/h2.48)")` block, immediately after T3.S1's rewritten `test_submit_superseded_writein_rebinds_as_elaboration`: (a) `test_supersede_userheld_elaboration_draft_wins_over_restage`, (b) `test_supersede_deleted_to_empty_slot_wins_no_restage`. No source-file changes.

**Success Definition**:
- (a) After a real write-in commit, a GENUINE elaboration gesture (`focusTextField("elaboration")` + type "my reasons" + enter), then an option accept: the slot still reads "my reasons" (not clobbered with the old write-in value), and submit attaches `answer.text === "my reasons"` — shipped line `q1: Alpha — my reasons`, never containing "my custom take".
- (b) After a real write-in commit, entering the editor and deliberately committing an EMPTY buffer (stages `""`), then an option accept: the slot still reads `""` and submit attaches NO `answer.text` (`undefined`) — shipped line `q1: Alpha` with no trace of the superseded write-in.
- Both green on arrival (guard 4 + wiring landed in T2.S1/T3.S1); full `npm test` + `npm run typecheck` green; zero edits outside the two new tests.

## User Persona (if applicable)

**Target User**: The pi user who commits a write-in ("my custom take"), then reconsiders and accepts a real option — while having ALSO typed (or deliberately deleted) elaboration text in the editor since.

**Use Case**: Deciding the option is right but the reasons text they typed (or the act of clearing stale text) must be honored as their final word.

**User Journey**: Commit write-in → open editor on that question → type reasons (or clear to empty) + enter → accept option → submit ships exactly what the USER last held in the slot — the supersede never overwrites it.

**Pain Points Addressed**: Without guard 4, the helper would clobber user-typed reasons with the old write-in text, or resurrect text the user explicitly deleted — both R4 violations ("drafts are sacred").

## Why

- BUG-001's fix design (architecture/bug001-writein-supersede.md §(d) guard 4 rationale): `!== undefined` (not a trim-empty check) honors a deliberate delete-to-empty as user-held — "stricter and more R4-faithful". §(f) risk 2 flags this as a DECIDED semantics choice; these tests PIN it so later sweeps can't silently flip it.
- The sibling coverage matrix from §(e): test 1 = the rewritten :2213 (T3.S1), test 2 = user-held wins (THIS), test 3 = deleted-to-empty wins (THIS), test 4 = kind-flip (T4.S2), test 5 = modal path (T3.S2), test 6 = non-custom no-op (T4.S2), auto-submit variant (T4.S3). This task owns exactly tests 2-3 — no overlap.
- P1.M3.T2's coherence sweep reads the suite as the contract's voice; unpinned guard-edge semantics are the first thing a sweep "simplifies" into a regression.

## What

1. **Test (a) `test_supersede_userheld_elaboration_draft_wins_over_restage`** — seed(BASIC) + DraftStore + makeDeps; `commitWriteIn(panel, "my custom take")`; assert `panel.draftTextFor("q1")` is `undefined` (documents the VAL-002 consume); back to q1 (`panel.currentId = "q1"` — cursor auto-seeds to the ✎ row, ANSWER-PIN-001); `panel.focusTextField("elaboration")` + `panel.textField.setText("my reasons")` + `panel.handleInput("\r")` (elaboration-enter → stageText → zero victims in BASIC → commitTextDraft); assert slot `"my reasons"`; `panel.cursorIndex = 0` + `accept(panel)` (supersede; guard 4 sees a defined slot → NO re-stage); assert slot STILL `"my reasons"` and answer.value `"a"`; `submit(panel, deps)`; assert `answer.text === "my reasons"`, message contains `q1: Alpha — my reasons` and NOT `my custom take`.
2. **Test (b) `test_supersede_deleted_to_empty_slot_wins_no_restage`** — same seed/commit prologue; `panel.currentId = "q1"` (cursor seeds to ✎ row) + `accept(panel)` (✎ row → write-in editor, the same entry commitWriteIn uses); `panel.textField.setText("")` (the deliberate delete); `panel.handleInput("\r")` (writeInEnter's empty-first branch → `commitTextDraft("q1", "")`); assert slot `""` (DEFINED); `panel.cursorIndex = 0` + `accept(panel)` (guard 4 reads `""` → skips staging); assert slot still `""`; `submit(panel, deps)`; assert `answer.text` `undefined` (reconcile skips the empty draft), message contains `q1: Alpha` and NOT `my custom take`.
3. **Per-test comment headers cite this task** (house convention): `[Mode A] BUG-001 / P1.M1.T4.S1 — guard 4 …` one-liners stating which half each test pins.

### Success Criteria

- [ ] Both tests present at the specified location, green, real gestures only (no manual slot surgery, no mocks beyond house seams)
- [ ] No other file or test modified; `npm test` + `npm run typecheck` fully green
- [ ] Assertions cover BOTH the slot-survival (`draftTextFor` before/after the accept) AND the submit outcome (`answer.text` + shipped message line)
- [ ] Tests do NOT cover guards 1/3 (T4.S2's), the modal path (T3.S2's), or the auto-submit variant (T4.S3's)

## All Needed Context

### Context Completeness Check

The helper, its wiring, and every seam these tests drive were read in the working tree; verbatim test-body sketches (nearly copy-pasteable) are in research/notes.md. An agent needs this PRP + `src/panel/actions.test.ts` + the landed `src/panel/actions.ts`/`src/panel/panel.ts`. Everything else is context for judgment, not for discovery.

### Documentation & References

```yaml
- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/architecture/bug001-writein-supersede.md
  why: "THE DESIGN — §(d) guard 4 rationale (!== undefined honors delete-to-empty as user-held; stricter than trim-empty) + §(e) tests 2-3 (this task's exact scenarios) + §(a) flow trace (why the slot is undefined after commitWriteIn)"
  critical: "§(f) risk 2 names the semantics choice these tests pin; §(e) defines the sibling matrix — tests 1/4/5/6 and the auto-submit variant belong to OTHER tasks"

- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/P1M1T4S1/research/notes.md
  why: "VERBATIM test-body sketches for both scenarios + verified staging mechanics (commitTextDraft stages \"\" unconditionally; writeInEnter's empty branch is FIRST; stageText's FR-18 text gate sees zero victims in BASIC) + house fixture map with line anchors"
  critical: "the ANSWER-PIN-001 seeding fact: currentId='q1' on a write-in-answered question seeds cursor to the ✎ row (index 2) — drive cursorIndex = 0 explicitly before the option accept"

- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/P1M1T3S1/PRP.md
  why: "CONTRACT for the wired direct path my tests consume — acceptOptionIndex calls stageSupersededWriteIn at actions.ts:317 after applyAnswer; also rewrote test_submit_superseded_writein_rebinds_as_elaboration (real gestures, manual re-stage deleted) — my tests insert immediately AFTER it"
  gotcha: "do not modify that rewritten test; T3.S1 explicitly reserves the T4 scenario tests"

- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/P1M1T3S2/PRP.md
  why: "CONTRACT for the parallel modal-path work (applyConfirmedEdit in ripple-confirm.ts + its own test) — confirms zero file collision with this task (ripple-confirm.ts / ripple-confirm.test.ts untouched here)"

- file: src/panel/actions.ts
  why: "stageSupersededWriteIn :359-371 (guard 4 at :369), acceptOptionIndex wiring :317, writeInEnter's empty-buffer branch (text.trim().length === 0 → commitTextDraft, FIRST in the body — before the byte-identical inert check)"
  gotcha: "recorded custom answers can NEVER take the inert path (its check requires custom !== true) — the supersede accept always reaches the genuine apply; no ripple modal in BASIC (no dependsOn → zero victims)"

- file: src/panel/actions.test.ts
  why: "house fixtures: choiceQ/OPTS_AB (~:64-82), seed/BASIC (:86-132), makePanel/makeDeps, commitWriteIn (~:2215), the WRITEIN-002 describe block banner (~:2206) and T3.S1's rewritten supersede test (insertion anchor)"
  pattern: "test_snake_case names; sendMessage.mock.calls[0][0] as {content: string}; expect(msg.content).toContain('q1: Alpha — …') / not.toContain(…)"

- file: src/panel/panel.ts
  why: "commitTextDraft :903-925 (draftSlots.set UNCONDITIONAL — stages \"\" as defined; drafts?.setDraft seam; EXPLAIN-003 re-seed guarded to cursor ≥ options.length), draftTextFor :1208-1210 (slot-first), focusTextField(duty?) :1191, stageText :873-892 (elaboration-enter save core with the FR-18 victims gate)"
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
├── actions.ts          # stageSupersededWriteIn (landed) + :317 wiring (T3.S1) — READ ONLY here
├── panel.ts            # commitTextDraft / draftTextFor / focusTextField / stageText — READ ONLY
└── actions.test.ts     # ADD the two guard-4 scenario tests (ONLY file modified)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: These are STABILIZATION tests — guard 4 + wiring already landed.
#   If either test runs RED, the defect is in the landed helper/wiring (T2.S1/T3.S1)
#   or the gesture drive — NEVER "fix" it by weakening assertions. Diagnose: is
#   draftTextFor defined at the accept? did the elaboration save actually stage?
// GOTCHA: ANSWER-PIN-001 seeding — `panel.currentId = "q1"` on a question whose
#   recorded answer is a write-in seeds cursorIndex to the ✎ row (2), NOT 0.
#   Always set `panel.cursorIndex = 0` explicitly before the option accept
#   (the rewritten :2213 test does exactly this).
// GOTCHA: writeInEnter's EMPTY branch precedes the byte-identical inert check —
#   the "" enter in test (b) stages "" and blurs; it never commits, never
#   advances, never fires the modal. commitTextDraft("") sets a DEFINED slot
#   (draftSlots.set is unconditional) — that definedness is the entire point.
// GOTCHA: the elaboration save on an ANSWERED question passes through
#   stageText's FR-18 text gate — BASIC has no dependsOn, so zero victims and
#   no modal defer. Do not add dependsOn to these fixtures.
// GOTCHA: q2 must STAY OPEN through both scenarios — the supersede's commit
#   tail then never fires maybeAutoSubmit (completeness absent). The
//   same-gesture auto-submit variant is T4.S3's test, not these.
// GOTCHA: use `const store = new DraftStore(); makePanel(state, { drafts: store })`
#   (mirrors the rewritten :2213) so the DraftStore seam is exercised: commit
#   clears it, the elaboration/empty save re-populates it.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: VERIFY LANDED CONTRACT
  - READ src/panel/actions.ts:359-371 (guard 4 present at :369) and :317 (the
    acceptOptionIndex wiring from T3.S1). READ the rewritten
    test_submit_superseded_writein_rebinds_as_elaboration (insertion anchor).
  - RUN: npx vitest run src/panel/actions.test.ts -t "superseded" → green
    (T3.S1's test must pass before adding siblings).

Task 2: ADD test (a) — user-held draft wins
  - INSERT after the rewritten supersede test, inside the WRITEIN-002 describe.
  - BODY: research/notes.md "Scenario (a)" sketch — commit prologue + consume
    assertion, elaboration gesture via focusTextField("elaboration") + setText +
    handleInput("\r"), slot assertions before/after the supersede accept
    (cursorIndex = 0 first), submit assertions (answer.text + shipped line).
  - COMMENT HEADER: cite BUG-001 / P1.M1.T4.S1, guard 4 non-empty half.

Task 3: ADD test (b) — deleted-to-empty wins
  - BODY: research/notes.md "Scenario (b)" sketch — same prologue; ✎-row accept
    entry (currentId re-seeds cursor to 2) + setText("") + handleInput("\r") →
    slot "" (DEFINED); supersede accept skips staging (slot still ""); submit →
    answer.text undefined, line "q1: Alpha", no "my custom take".
  - COMMENT HEADER: cite BUG-001 / P1.M1.T4.S1, guard 4 "" half — the
    "!== undefined (not trim-empty) honors a deliberate delete-to-empty" choice.

Task 4: VALIDATE
  - npx vitest run src/panel/actions.test.ts -t "supersede" → 3 green
    (rewritten real-flow + these two)
  - npm test && npm run typecheck → fully green, zero other-file edits
    (git status: only actions.test.ts modified)
```

### Implementation Patterns & Key Details

```ts
// The two decisive assertion pairs (one per test) — copy these exactly:

// (a) user-held wins:
expect(panel.draftTextFor("q1")).toBe("my reasons"); // BEFORE accept
panel.cursorIndex = 0;
expect(accept(panel)).toBe(true);
expect(panel.draftTextFor("q1")).toBe("my reasons"); // STILL the user's — guard 4
// …submit…
expect(state.getQuestion("q1")?.answer?.text).toBe("my reasons");
expect(msg.content).toContain("q1: Alpha — my reasons");
expect(msg.content).not.toContain("my custom take");

// (b) deleted-to-empty wins:
expect(panel.draftTextFor("q1")).toBe(""); // DEFINED empty — the user's state
panel.cursorIndex = 0;
expect(accept(panel)).toBe(true);
expect(panel.draftTextFor("q1")).toBe(""); // guard 4 read "" and skipped
// …submit…
expect(state.getQuestion("q1")?.answer?.text).toBeUndefined(); // no elaboration
expect(msg.content).toContain("q1: Alpha");
expect(msg.content).not.toContain("my custom take");
```

### Integration Points

```yaml
PIPELINE: P1.M3.T2 (README/spec coherence sweep) treats this suite as the
  contract's voice — these tests are why "user-held wins (incl. delete-to-empty)"
  survives that sweep unchanged.
NO source/config/API surface changes (Mode: none — test header cites the task ID
  per house convention; that citation IS the documentation).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck     # tsc --noEmit — zero errors (test types included)
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/panel/actions.test.ts -t "supersede"   # 3 tests green (rewritten + 2 new)
npx vitest run src/panel/actions.test.ts                  # whole file green (VAL-002 pins intact)
npm test                                                  # FULL suite green
# Expected: all green. A red new test = landed-contract defect or gesture mis-drive —
# diagnose (draftTextFor state at each step), never weaken assertions.
```

### Level 3: Scope Proof (No Collateral)

```bash
git status --short        # ONLY src/panel/actions.test.ts modified
git diff --stat           # one file; additions only (no deletions outside insertion)
```

### Level 4: Contract Pin (Semantics)

```bash
# Guard-4's choice is now pinned: temporarily flip the helper's guard to a
# trim-empty check (panel.draftTextFor(qid)?.trim() === "") and re-run —
# test (b) must FAIL (the "" slot would be re-staged over). Restore the
# helper. This red-under-mutation check proves the pin (do NOT commit the
# mutation).
npx vitest run src/panel/actions.test.ts -t "deleted_to_empty"
```

## Final Validation Checklist

- [ ] Both tests green in the WRITEIN-002 describe block, after T3.S1's rewritten test
- [ ] Assertions cover slot-survival AND submit outcome in both tests; message-line checks use toContain/not.toContain
- [ ] Real gestures only: commitWriteIn, focusTextField/✎-row accept, setText, handleInput("\r"), accept, submit — no manual draftSlots surgery, no mocks beyond makeDeps/makePanel seams
- [ ] `npm test` + `npm run typecheck` green; `git status` shows only actions.test.ts
- [ ] Level-4 mutation check performed (and reverted)
- [ ] No coverage drift into T4.S2 (guards 1/3), T4.S3 (auto-submit), T3.S2 (modal) territory

## Anti-Patterns to Avoid

- ❌ Don't re-stage slots manually (`panel.commitTextDraft` in the test body) — that manufacturing is exactly what BUG-001's original test did wrong
- ❌ Don't add dependsOn to the fixtures (would route the elaboration save / supersede through the FR-18 modal — T3.S2's territory)
- ❌ Don't answer q2 (auto-submit territory — T4.S3)
- ❌ Don't weaken a failing assertion to force green — a red test here reports a landed-contract defect
- ❌ Don't touch source files, the rewritten :2213 test, or sibling-task test sites

---

**Confidence Score**: 9/10 — both scenarios were traced against the actual landed code (guard verbatim at actions.ts:369, wiring at :317, commitTextDraft's unconditional staging of "", writeInEnter's empty-first branch), the test bodies are sketched nearly copy-pasteable in research notes, and the house fixtures/anchors are verified. Residual risk: line-number drift from the parallel T3.S2 landing — mitigated by anchoring on test names, not line numbers.

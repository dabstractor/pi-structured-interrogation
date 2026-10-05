# PRP — P1.M1.T2.S5 (written to this dir per output paths): writeInEnter: byte-identical re-commit inert + buffer consume

> Note: the task tree calls this item **P1.M1.T2.S5**; the mandated output directory is
> `plan/003_f8af1c6f6c49/P1M1T2S2/` — this PRP lives there.

## Goal

**Feature Goal**: Implement FR-D9 / ANSWER-PIN-001 (h2.65, FR-35, h2.34 last sentence) for the editor path: `writeInEnter` with a buffer byte-identical to the question's recorded answer is an inert state NO-OP — no `beginWriteInConfirm`, no `applyAnswer` (no fresh `answer.at`), no `evaluateDependsOn`, no `maybeAutoSubmit` — advancing only, with the buffer **consumed** (`consumeCommittedBuffer`, VAL-002 pattern) so the advance's draft write-through can never stage committed text into a draft slot.

**Deliverable**: Modified `src/panel/actions.ts` (inert branch in `writeInEnter` + Mode A JSDoc + comment purge) and flipped/added tests in `src/panel/actions.test.ts` (+ `ripple-confirm.test.ts` if a same-value row lives there).

**Success Definition**:
- `npm run typecheck` + full `npm test` green
- Choice question with `answer = { value: T, custom: true }`, editor in write-in duty seeded/typed to exactly `T`, enter → consumed, `currentId` advances, `answer.at` byte-identical, epoch unchanged, `confirmMode` null, no submission, draft slot + DraftStore entry for the question cleared (consumed)
- Same for a `type:"text"` question with `answer.value === buffer`
- A DIFFERENT write-in text on an answered question still routes the FR-18 modal (regression); zero-victim different-text edits still commit directly
- The consumed-buffer guarantee is consumed by P1.M1.T5.S10's AC-16 write-in scenario

## Why

ANSWER-PIN-001 (h2.65): "a byte-identical write-in re-commit is equally inert" — the recorded write-in's caret sits on the `✎ Other` row (FR-D8, S1 landed), the editor seeds from the answer, and today pressing `enter` re-runs the FULL commit: a fresh `answer.at` (a state write ANSWER-PIN-001 forbids), possibly the FR-18 modal "accusing the user of invalidating their own work by keeping it", and an auto-submit trigger on a complete set. FR-18/h2.34: "An identical re-commit — enter or a digit on the already-recorded value, or a byte-identical write-in — is not a change: no modal, no state write, advance only." The buffer consume is required because `advanceAfterAccept`'s `currentId` setter runs `syncBufferToQuestion`, whose write-through would otherwise copy the (identical-but-committed) text into the next/current draft slot — the exact VAL-002 hazard the direct-commit path already guards at actions.ts:328.

## What

1. **Inert branch in `writeInEnter` (src/panel/actions.ts, :295)** — inserted AFTER the empty-buffer branch, BEFORE the FR-18 ripple-victims branch:
   ```ts
   const a = q.answer;
   if (a !== undefined && a.value === text && (a.custom === true || q.type === "text")) {
     // ANSWER-PIN-001 / FR-D9: byte-identical re-commit is NOT a change —
     // no applyAnswer, no fresh at, no FR-18 modal, no evaluate, no auto-submit.
     panel.consumeCommittedBuffer(q.id); // VAL-002 — BEFORE the advance
     advanceAfterAccept(panel);
     panel.blurTextField(); // editor exit: focus → options, textDuty → "elaboration"
     return true;
   }
   ```
   - Equality is against the RAW buffer `text` (the commit path commits raw — trim only gates emptiness)
   - Predicate covers BOTH shapes: `custom: true` write-ins AND `type:"text"` answers (`value`, no custom)
   - `blurTextField` IS needed here (unlike S1's options no-op): the editor holds focus on entry to writeInEnter
2. **Mode A JSDoc on `writeInEnter`**: add the inert-re-commit + buffer-consume contract (ANSWER-PIN-001/FR-35/FR-D9: byte-identical buffer → advance-only no-op with consumed buffer; the consume must precede advanceAfterAccept because syncBufferToQuestion's write-through fires inside it).
3. **Comment purge as touched**: refresh/purge stale status-agnostic-preselect comments in/around writeInEnter and its call paths in actions.ts (item cites ~:305/329/338-339/353/371 in the pre-D1 tree — now drifted; sweep every comment the diff touches; e.g. the "cursor ★ reset" phrasing in advanceAfterAccept's caller comments where the caret now seeds to the recorded answer per FR-D8).

### Success Criteria

- [ ] Inert branch fires only when an answer exists AND `answer.value === raw buffer` AND (`custom === true` or `type:"text"`)
- [ ] Inert path calls ONLY: `consumeCommittedBuffer`, `advanceAfterAccept`, `blurTextField` — zero `applyAnswer`/`evaluateDependsOn`/`beginWriteInConfirm`/`maybeAutoSubmit`; `answer` object reference and `.at` untouched; epoch unchanged; `confirmMode` null
- [ ] Buffer consumed: `panel.draftTextFor(qid) === undefined` (slot deleted), DraftStore draft cleared (`explicit: true`), editor seeded `""`, `bufferOwner` disowned — so navigating after the no-op write-throughs an EMPTY buffer
- [ ] Different text on answered/submitted with victims → still `beginWriteInConfirm` (modal, kind "writein"); different text zero-victims → direct commit; both regressions green
- [ ] Text-question inert case: `type:"text"`, `answer.value === buffer`, enter → advance-only, no state write
- [ ] Same-value write-in tests flipped (were asserting fresh `at`/modal/auto-submit — now assert inert); all other writein tests green
- [ ] `writeInEnter` return type stays `boolean` (no AcceptOutcome needed on the editor path — S6's triage is options-only)

## All Needed Context

### Context Completeness Check

Repo mature (post-D-changesets). This PRP quotes writeInEnter and consumeCommittedBuffer verbatim-current, gives the exact branch, and gives grep commands to locate the drifted test rows. Agent needs this PRP plus `src/panel/actions.ts`, `src/panel/actions.test.ts`, `src/panel/ripple-confirm.test.ts`, `src/panel/panel.ts` (consumeCommittedBuffer only).

### Documentation & References

```yaml
- file: plan/003_f8af1c6f6c49/P1M1T2S1/PRP.md
  why: "SIBLING CONTRACT (acceptOptionIndex no-op, landed/landing in parallel): branch placement BEFORE the ripple seam, advance-only semantics, AcceptOutcome triage — mirror its style; writeInEnter stays boolean"
  critical: "S1's no-op condition deliberately SKIPS custom answers (write-ins never match option values) — this subtask is the write-in/text counterpart"

- file: plan/003_f8af1c6f6c49/P1M1T2S2/research/notes.md
  why: verbatim current writeInEnter/consumeCommittedBuffer excerpts, test-anchor drift analysis, divergence guards

- file: plan/003_f8af1c6f6c49/architecture/panel-ui-seams.md
  why: the seams doc the item cites (writeInEnter post-commit sequence, confirmRippleEdit choice seam, VAL-002 staging)

- file: src/panel/actions.ts
  why: "writeInEnter :295-340 — the ONLY production change site; note the existing direct-commit path's consume placement (:328, comment explains the syncBufferToQuestion hazard) — copy that ordering"
  pattern: "existing VAL-002 comment block at :322-327 is the template for the inert branch's consume"
  gotcha: "the empty-buffer branch must stay FIRST (empty buffer is a draft save, never a no-op match — answer.value can never equal an empty-raw buffer anyway, but ordering keeps the read cheap and the semantics distinct)"

- file: src/panel/panel.ts
  why: "consumeCommittedBuffer :962-970 — guarded by bufferOwner === questionId (write-in duty always owns it); deletes draftSlots entry, clears DraftStore (explicit), seeds editor '', disowns buffer"

- file: src/panel/actions.test.ts
  why: "harness anchors: commitWriteIn helper (:1653-1660), writein modal tests (:918-960), auto-submit writein tests (:2065+)"
  gotcha: "the item's cited line refs (~:1684-1685, ~:1829-1836) DRIFTED — locate flip targets by grep, below"

- file: src/panel/ripple-confirm.test.ts
  why: "writein confirm/direct-commit rows (:600-700) — a same-value row may live here; esc-revert reseed test (:649-668) is about DIFFERENT text, leave it"

- docfile: PRD h2.65 / h2.8 h3.5 (FR-35 verbatim), h2.34 (identical re-commit is not a change), h2.62 (VAL-002 staging), AC-16 — in this PRP's task prompt
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
├── actions.ts             # MODIFY: inert branch + JSDoc + comment sweep (writeInEnter only)
├── actions.test.ts        # MODIFY: flip same-value writein rows + add inert/consume tests
└── ripple-confirm.test.ts # MODIFY only if a same-value row lives here (grep first)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: consume BEFORE advanceAfterAccept — the currentId setter runs
//   syncBufferToQuestion, whose write-through would otherwise stage the
//   (identical, committed) text into the draft slot; that slot text would
//   later ship as a bogus elaboration after an option accept (VAL-002).
// CRITICAL: blurTextField AFTER the advance (same ordering as the direct-commit
//   path :330-331) so the currentId setter's cursor seeding wins on the
//   repainted view; blur also resets textDuty to "elaboration".
// CRITICAL: equality against the RAW buffer — the commit path ships raw text
//   (whitespace is the user's); a trimmed compare would treat
//   buffer "T " as identical to answer "T" and wrongly no-op a real change.
// GOTCHA: don't gate the branch on status — FR-35 covers every status carrying
//   an answer (answered/submitted/closed). The FR-18 modal gate stays status-
//   gated exactly as-is for DIFFERENT text.
// GOTCHA: consumeCommittedBuffer is a guard no-op when bufferOwner ≠ qid —
//   harmless here; write-in duty always owns its question.
// GOTCHA: don't touch beginWriteInConfirm/applyWriteInConfirm/cancelWriteInConfirm —
//   different-text paths are frozen by their own tests.
// GOTCHA: don't add maybeAutoSubmit to the inert path even on a complete set —
//   ANSWER-PIN-001: "no auto-submit trigger".
// GOTCHA: test time mocking — existing tests use T0 constants and
//   expect.any(String) for at; inert assertions should capture the answer
//   OBJECT REFERENCE (toBe) and assert it survives, stronger than value equality.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: LOCATE the flip targets (drifted line refs — grep, don't trust)
  - rg -n "custom: true" src/panel/actions.test.ts | head -30
  - rg -n "writeInEnter|WriteInConfirm|commitWriteIn" src/panel/actions.test.ts
  - rg -n "prior writein|same value|same.value|re.?commit|identical" src/panel/actions.test.ts src/panel/ripple-confirm.test.ts
  - FLIP = any row asserting that enter with buffer === existing answer.value produces a fresh
    `at` (answer rewritten), the FR-18 modal, or an auto-submit delivery. Expect 2 clusters
    (the item's ~:1684-1685 and ~:1829-1836 of the pre-D1 tree). Rewrite them to the inert
    contract; KEEP different-text rows untouched.

Task 2: WRITE FAILING TESTS FIRST (src/panel/actions.test.ts, near the writein describes)
  - test_writein_recommit_identical_buffer_inert_no_state_change:
    seed(BASIC); applyAnswer("q1", {value: "a hybrid of A and B", custom: true, at: T0});
    capture const before = state.getQuestion("q1")?.answer;
    enter writein duty (cursorIndex 2, accept), setText("a hybrid of A and B");
    expect(panel.handleInput("\\r")).toBe(true);
    expect(state.getQuestion("q1")?.answer).toBe(before);        // same ref — no rewrite
    expect(state.epoch).toBe(epochBefore); expect(panel.confirmMode).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();                   // no auto-submit (wire makeDeps(true))
    expect(panel.focus).toBe("options"); expect(panel.textDuty).toBe("elaboration");
    expect(panel.currentId).not.toBe("q1");                       // advanced
  - test_writein_recommit_consumes_buffer (the VAL-002 money test):
    same setup; after enter: expect(panel.draftTextFor("q1")).toBeUndefined();
    drafts store cleared (setDraft not called with committed text / getDraft undefined);
    panel.textField.getText() === ""; then navigate (nextQuestion) and back — the outgoing
    buffer write-through stages NOTHING (slot still absent)
  - test_text_question_identical_recommit_inert: type:"text" question with
    applyAnswer({value: "plan text", at: T0}); focusTextField("writein"); setText("plan text");
    enter → inert assertions as above
  - REGRESSION (existing, must stay green): different-text modal (:918-960), different-text
    zero-victim direct commit (ripple-confirm.test.ts :670-687), WRITEIN-002 submit rows
  - RUN npx vitest run src/panel/actions.test.ts -v — confirm the new inert tests fail

Task 3: IMPLEMENT the inert branch (src/panel/actions.ts writeInEnter)
  - Exact code from What §1; place after the empty-buffer branch, before the FR-18 gate
  - UPDATE writeInEnter's JSDoc: add the ANSWER-PIN-001/FR-D9 inert-re-commit + consume
    contract paragraph (Mode A)

Task 4: COMMENT PURGE as touched
  - Sweep the comments the diff touches in writeInEnter + its immediate call path (pre-D1
    refs ~:305/329/338-339/353/371 → now drifted): remove any residual "cursor ★ re-seed /
    preselect" phrasing that contradicts FR-D8 (caret seeds to the recorded answer); the
    advanceAfterAccept helper's own doc comment "cursor → ★ preselect" is S1/S4/S8 sweep
    territory — only fix it if your diff touches its callers' comments

Task 5: FLIP the located test rows + RUN gates
  - Rewrite the same-value rows to inert expectations (pattern: Task 2's assertions)
  - npx vitest run src/panel/actions.test.ts src/panel/ripple-confirm.test.ts -v
  - npm run typecheck && npm test
```

### Implementation Patterns & Key Details

```ts
// The branch (exact):
const a = q.answer;
if (a !== undefined && a.value === text && (a.custom === true || q.type === "text")) {
  // ANSWER-PIN-001 (h2.65/FR-35): a byte-identical re-commit is NOT a change —
  // advance only, zero state writes. RAW-buffer equality (the commit ships raw).
  // VAL-002: consume BEFORE the advance — syncBufferToQuestion's write-through
  // fires inside advanceAfterAccept and must never stage committed text.
  panel.consumeCommittedBuffer(q.id);
  advanceAfterAccept(panel);
  panel.blurTextField(); // editor exit (this path ENTERS from text focus)
  return true;
}
// Ordering within: consume → advance → blur (mirrors the direct-commit path :328-331).
// PATTERN: strongest inert assertion in tests is answer-object identity (toBe), not toEqual.
```

### Integration Points

```yaml
SIBLINGS:
  - P1.M1.T2.S1 acceptOptionIndex no-op (parallel): options-side counterpart; do not unify the
    branches into one helper — the predicates differ (display-value mapping vs raw text; custom skip vs custom match)
  - P1.M1.T2.S6 acceptFromDeep: consumes S1's AcceptOutcome; writeInEnter is not on its path
DOWNSTREAM:
  - P1.M1.T5.S10 AC-16: "a byte-identical write-in re-commit is inert" — its scripted scenario
    relies on this branch AND on the consumed-buffer guarantee (no phantom draft afterwards)
NO CHANGES to: panel.ts, ripple-confirm.ts, begin/apply/cancelWriteInConfirm, maybeAutoSubmit,
acceptOptionIndex, digit path
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/actions.test.ts src/panel/ripple-confirm.test.ts -v
npm test
```

### Level 3: Behavioral probe (ANSWER-PIN-001 repro — the tests ARE the probe)

```bash
npx vitest run src/panel/actions.test.ts -t "recommit" -v
# Pre-fix: fresh answer.at / modal / submission observed; post-fix: inert + consumed buffer.
```

### Level 4: Domain validation

- [ ] `rg -n "ANSWER-PIN-001" src/panel/actions.ts` — writeInEnter JSDoc documents the inert-re-commit + consume contract
- [ ] `git diff --name-only` — src/panel/actions.ts + the test files only
- [ ] No comment in the touched hunks still claims ★-re-seed on advance (FR-D8 supersession)

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green
- [ ] TDD: inert tests observed red pre-fix; same-value rows flipped, different-text rows untouched
- [ ] Identical write-in/text re-commit: advance-only, answer ref + `.at` intact, no modal, no evaluate, no auto-submit, epoch unchanged
- [ ] Buffer consumed: slot deleted, DraftStore cleared, editor seeded "", buffer disowned; post-no-op navigation stages nothing
- [ ] Mode A JSDoc on writeInEnter; touched comments purged of status-agnostic-preselect residue
- [ ] Only actions.ts + tests modified

## Anti-Patterns to Avoid

- ❌ Don't compare trimmed text — the commit ships raw; "T " ≠ "T" is a real change
- ❌ Don't skip consumeCommittedBuffer — the advance's write-through WILL stage the text (VAL-002)
- ❌ Don't blur before the advance — the currentId setter's cursor seeding must win (existing ordering contract)
- ❌ Don't add maybeAutoSubmit/evaluateDependsOn to the inert path — "no auto-submit trigger" is verbatim FR-35
- ❌ Don't gate on status — every answer-carrying status is covered
- ❌ Don't touch the different-text modal/direct-commit paths or their tests
- ❌ Don't trust the item's pre-D1 line numbers — grep (Task 1) before flipping

---

**Confidence Score**: 9/10 — writeInEnter and consumeCommittedBuffer read verbatim-current, the branch mirrors an existing, tested ordering (consume→advance→blur at :328-331), and the sibling S1 PRP fixes the pattern. Only residual uncertainty: the drifted locations of the two flip clusters (mitigated by the Task 1 greps and the flip criteria).

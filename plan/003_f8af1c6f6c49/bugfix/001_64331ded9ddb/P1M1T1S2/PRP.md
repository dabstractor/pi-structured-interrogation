# PRP — Bugfix P1.M1.T1.S2: maybeAutoSubmit empty-diff transition delivers and flashes truthfully (AUTOSUBMIT-001/003, AC-2c)

## Goal

**Feature Goal**: PROVE via TDD that, with S1's fixed `submit()` (pendingIds-keyed fall-through), `maybeAutoSubmit`'s AUTOSUBMIT-003 transition firing now actually delivers on the empty-diff re-answer path (PRD BUG-002 repro step 4): rule-2 re-ask → user re-accepts the same value on the last remaining question → exactly ONE `sendMessage` with the re-confirmed answer, epoch bump, truthful `submitted — 1 answer(s)` flash, status `submitted`. Also pin that the gate hold still withholds BEFORE the transition firing, and that zero-pending silence is unchanged.

**Deliverable**: New tests in `src/panel/actions.test.ts` (next to `:2293` and `:2309`). No production change expected — fix a minimal seam in `maybeAutoSubmit` ONLY if test (a) fails because the transition context is lost on the empty-diff path.

**Success Definition**:
- (a) BUG-002 repro step 4 through the AUTO path (accept tail): one new sendMessage, epoch 2→3, q1 `submitted`, flash `submitted — 1 answer(s)`
- (b) Gate hold (config.gateWarnings on, open gate question) withholds before completeness: no submit, no flash, hold line armed
- (c) `test_auto_zero_pending_complete_set_noops_silently` (:2309) and `test_auto_reasked_question_blocks_the_firing` (:2293) green unchanged
- `npm run typecheck` + full `npm test` green

## Why

AUTOSUBMIT-001's contract is "the identical submission pipeline fires automatically" when the commit answers the last unanswered question — but on the empty-diff re-answer path the pipeline early-returned, so the auto firing was dead AND the flash machinery (`submit()` returns true even on the zero-shipped early return) risked lying. S1 fixed `submit()`; this subtask makes the auto-path contract test-pinned so P1.M1.T3.S1 (the full re-ask round-trip integration test) and the FR-5 completion unblock can rely on it.

## What

1. **Test (a) — the transition auto-fires truthfully** (public seam, no mocking beyond the delivery stub):
   - Fixture per PRD BUG-002 repro: q1 choice [a,b,c] → answer 'a' → `submit(panel, deps)` (epoch 2, snapshot S1) → rule-2 re-ask (options [a,b,d], answer deleted, status `reasked` — same seeding style as the bug008 tests at :953/:995/:1026) → re-accept 'a' via `accept(panel)` (cursorIndex on a's display row; applyAnswer → status `answered`; the accept tail calls `maybeAutoSubmit` with `{wasUnanswered: true, questionId: 'q1'}`).
   - Assert: `sendMessage` called exactly once MORE (total 2); the new message's content contains `q1` and `(state epoch 3)`; `state.epoch === 3`; `state.snapshots` grew by 1; `state.getQuestion('q1').status === 'submitted'`; `panel.footerFlash?.text === 'submitted — 1 answer(s)'`.
   - Cheap sibling: direct `maybeAutoSubmit(panel, deps, { wasUnanswered: true, questionId: 'q1' })` variant (same assertions) — pins the commit-contract seam independently of accept.
2. **Test (b) — gate hold precedes the transition firing**: fixture with an OPEN gate-group question + a later-group commit; `config.gateWarnings` on (default); commit lands → `panel.gateWarning` equals `{count, kind: 'hold', submitLabel: panel.labels.submit}`, no sendMessage, no flash, epoch unchanged.
3. **Test (c)**: run `:2309` and `:2293` — must stay green UNCHANGED (do not edit them).
4. **Contingency fix (only if (a) fails)**: the failure mode to look for is the transition context (`commit.wasUnanswered`) not reaching the firing on the empty-diff path (e.g. an early return between :775–:788 misreading the post-commit state). Fix the MINIMAL seam inside `maybeAutoSubmit` — do NOT restructure the pipeline, do NOT touch `submit()` (S1 owns it). If a production change lands, reword the docblock's zero-shipped/flash commentary (~:731–733, "can never flash a lie") to match the now-truthful path ([Mode A]).

### Success Criteria

- [ ] Test (a) green via the accept-path public seam (+ optional direct-call sibling)
- [ ] Test (b) green: hold armed, nothing ships, no flash
- [ ] :2293 and :2309 green unchanged
- [ ] If any production edit was needed: docblock commentary updated; otherwise zero source changes
- [ ] Full suite + typecheck green

## All Needed Context

### Context Completeness Check

Repo at 1265 green tests pre-changeset (S1 landing in parallel adds its own). All line anchors verified in the working tree and excerpted in research notes. The implementing agent needs this PRP plus `src/panel/actions.ts` (:725–:796 maybeAutoSubmit, :569–:665 submit post-S1), `src/panel/actions.test.ts` (:29–:112 harness, :2293/:2309 neighbors, :953 bug008 fixture pattern), and S1's PRP as the submit() contract.

### Documentation & References

```yaml
- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/P1M1T1S1/PRP.md
  why: "CONTRACT — S1's submit(): zero-pending early return keeps the heldDrafts flash; non-empty pending + empty diff falls through the FULL pipeline (markSubmitted → buildSubmission with augmented DiffEntries → deliverSubmission → suspend) and returns true WITH real delivery"
  critical: "S1's kept-green matrix (:854/:886/:900/:953/:995/:1026) must stay green — this subtask adds tests only around :2293/:2309"

- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/P1M1T1S2/research/notes.md
  why: "verbatim excerpt of maybeAutoSubmit's current ordering (gate hold :758-766 → completeness :767-768 → AUTOSUBMIT-003 gating :775-788 → submit :790 → flash), the test designs, and the stale-docblock location"

- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/architecture/reask-confirmation-loop.md
  why: "§1.4 the maybeAutoSubmit seam analysis (the dead auto path + the lying-flash mechanics); §1.5-1.8 status machine, lifecycle reasked flip, merge rule 2, completion BLOCKING set"
  section: "§1.4, §1.7"

- file: src/panel/actions.ts
  why: "maybeAutoSubmit :735-796 (gate hold BEFORE completeness — reordered in the earlier wave; AUTOSUBMIT-003 commit gating; submit+flash at :790+). accept()'s tail passes the commit context — check acceptOptionIndex's maybeAutoSubmit call for the exact arg shape"
  gotcha: "flash text is verbatim 'submitted — {n} answer(s)' — literal 'answer(s)', count = PRE-commit pending; assert the exact string"

- file: src/panel/actions.test.ts
  why: "harness :29-112 (seed/makePanel/makeDeps; makePanel(state, { delivery: deps }) wires maybeAutoSubmit's delivery); :2293 reasked-blocks neighbor; :2309 zero-pending-silence neighbor; :953/:995/:1026 bug008 rule-2 fixture pattern"
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
├── actions.ts        # maybeAutoSubmit :735-796 — tests target; minimal fix ONLY if (a) fails
└── actions.test.ts   # ADD tests (a)+(b) near :2293/:2309 — MODIFY (add only)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: headless panels need delivery — makePanel(state, { delivery: deps })
//   or maybeAutoSubmit's `d === undefined` early-out makes everything a no-op
//   (a false green for the wrong reason).
// GOTCHA: the transition gating is commit-context-keyed: accept() passes
//   { wasUnanswered, questionId } — wasUnanswered=true skips the
//   last-answerable check. If you call maybeAutoSubmit DIRECTLY, pass the
//   commit object or it returns at `commit === undefined` (:786).
// GOTCHA: pending count for the flash is computed BEFORE submit runs — with
//   exactly one answered question it's "submitted — 1 answer(s)" (exact string).
// GOTCHA: gate-hold test fixture must make the gate question count via
//   countUnansweredGate (gate-group membership; status open, answer undefined)
//   and the committed later-group answer must leave pending > 0.
// GOTCHA: the rule-2 re-ask fixture must DELETE the answer (answer undefined,
//   status 'reasked') — that's what makes the subsequent same-value re-accept
//   produce an empty diff vs snapshot S1 (the whole point of the path).
// GOTCHA: ordering with S1: if S1 hasn't landed, test (a) FAILS — that's the
//   expected TDD state; P1.M3/M1.T3.S1 integration verifies jointly. Do not
//   "fix" submit() here to make (a) pass.
```

## Implementation Blueprint

### Implementation Tasks (TDD-ordered)

```yaml
Task 1: ADD test (a) to src/panel/actions.test.ts (new describe or inside the AUTOSUBMIT describe near :2293)
  - name: test_auto_transition_same_value_reanswer_after_rule2_reask_delivers_and_flashes
  - SETUP: seed q1 [a,b,c]; applyAnswer 'a'; submit(panel, deps) → epoch 2, S1
  - RULE-2 RE-ASK: re-upsert q1 options [a,b,d], answer deleted, status
    'reasked' (bug008-style seeding)
  - RE-ACCEPT: panel.currentId='q1'; cursorIndex = a's display row;
    accept(panel)  // commit tail → maybeAutoSubmit(wasUnanswered:true)
  - ASSERT: sendMessage calls 2 (one new); new msg content has 'q1' and
    '(state epoch 3)'; epoch === 3; snapshots.length === 2;
    q1.status === 'submitted'; footerFlash?.text === 'submitted — 1 answer(s)'
  - SIBLING (cheap): direct maybeAutoSubmit(panel, deps, { wasUnanswered: true,
    questionId: 'q1' }) on a freshly seeded identical state — same assertions

Task 2: ADD test (b) — gate hold withholds before the transition firing
  - Fixture: g1 gate-group OPEN (no answer) + n1 later-group; commit n1 via
    accept; ASSERT panel.gateWarning { kind: 'hold', ... }, sendMessage
    not called, footerFlash undefined, epoch unchanged

Task 3: VERIFY neighbors unchanged
  - npx vitest run src/panel/actions.test.ts -t "test_auto_reasked_question_blocks_the_firing"
  - npx vitest run src/panel/actions.test.ts -t "test_auto_zero_pending_complete_set_noops_silently"
  - both green without edits

Task 4: TRIAGE test (a)
  - PASSES (expected once S1 is in): done — no production change
  - FAILS on lost transition context: inspect maybeAutoSubmit :775-:788; fix
    the minimal seam (e.g. the last-answerable lookup reading post-submit
    state); NEVER touch submit() or restructure; then reword the docblock
    commentary ~:731-733 to the truthful-path wording
  - FAILS for another reason: STOP and re-read S1's PRP — the bug is upstream,
    report rather than patch around it

Task 5: RUN gates
  - npm run typecheck && npm test
```

### Implementation Patterns & Key Details

```ts
// Test (a) core assertions:
expect(sendMessage).toHaveBeenCalledTimes(2);          // the auto firing is the 2nd
expect(state.epoch).toBe(3);
expect(state.getQuestion("q1")?.status).toBe("submitted");
expect(panel.footerFlash?.text).toBe("submitted — 1 answer(s)");  // exact string
const second = vi.mocked(sendMessage).mock.calls[1][0] as { content: string };
expect(second.content).toContain("q1");
expect(second.content).toContain("(state epoch 3)");
```

### Integration Points

```yaml
S1: "consumes the fixed submit() — do NOT modify it here"
DOWNSTREAM: "P1.M1.T3.S1 (public-seam re-ask round-trip: re-confirm → submit → settle → completion injection) treats these green tests as its dependency guarantee"
DOCS: "none unless production changed (then docblock ~:731-733 only) — README sweep is P1.M3.T2"
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/actions.test.ts -v        # new (a)/(b) + neighbors green
npm test                                            # full suite green
```

### Level 3: AUTOSUBMIT regression matrix

```bash
npx vitest run src/panel/actions.test.ts -t "test_auto_"   # every auto rule row
npx vitest run src/panel/actions.test.ts -t "bug008"       # rule-2 fixture family
```

### Level 4: Contract walkthrough

- [ ] Semantics table: transition commit + gate open → hold (no submit); transition commit, no gate, empty diff → delivers (a); zero pending → silent (c); reasked remains → blocked (:2293)

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green
- [ ] Test (a) green: one delivery, epoch 3, submitted, exact flash string
- [ ] Test (b) green: hold armed, nothing ships, no flash
- [ ] :2293 and :2309 green WITHOUT edits
- [ ] No changes to submit(), the pipeline, gate.ts, or delivery.ts
- [ ] Production change made ONLY if (a) failed on lost transition context (documented) + docblock reworded
- [ ] No external mocks — delivery stubs only (makeDeps)

## Anti-Patterns to Avoid

- ❌ Don't fix or weaken S1's submit() to make (a) pass — report upstream instead
- ❌ Don't restructure maybeAutoSubmit's ordering (gate hold before completeness is a pinned prior fix)
- ❌ Don't edit the :2293/:2309 neighbors to accommodate anything
- ❌ Don't run the auto test without delivery wired (headless no-op false-green)
- ❌ Don't assert an approximated flash string — it's verbatim `submitted — {n} answer(s)`

---

**Confidence Score**: 9/10 — expected no-production-change TDD pin: the maybeAutoSubmit ordering (verified verbatim in the working tree) already calls the same submit() pipeline S1 fixed; the test design mirrors the PRD's own repro steps and the file's existing fixture patterns. Residual risk (transition context lost on the empty-diff path) has a bounded contingency with a defined minimal seam.

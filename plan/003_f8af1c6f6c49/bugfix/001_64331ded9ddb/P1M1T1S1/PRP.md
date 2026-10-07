# PRP — Bugfix P1.M1.T1.S1: submit() pendingIds-keyed fall-through — flush, synthesize card entries, bump epoch, deliver

## Goal

**Feature Goal**: Fix PRD BUG-002 (h2.2/h3.1): after an agent rule-2 re-ask and a same-value re-answer, `submit()` (src/panel/actions.ts:569) early-returns at :595 (`if (diff.changed.length === 0 || userChanged.length === 0)`) because computeDiff is answer-signature-only — the pending (answered) answer is identical to the snapshot's, so the user sees the lying "nothing to submit" flash, nothing is ever delivered, epoch never bumps, q1 is stuck pending, and completion (FR-5) is permanently blocked. Fix per PRD §Recommendations bullet 1, first alternative: treat pending (answered) ids as user shipments even when the diff is empty — D-R6 bridge-parity ("flush answered→submitted even when the diff is empty").

**Deliverable**: Modified `src/panel/actions.ts` (submit early-return condition + synthetic card entries + docblocks), one small export in `src/snapshots.ts` (`answerSummary`), plus TDD tests in `src/panel/actions.test.ts`.

**Success Definition**:
- PRD BUG-002 repro (q1 [a,b,c]→answer a→submit→rule-2 re-ask [a,b,d]→re-accept a): ctrl+s delivers a real submission message, q1 → `submitted`, epoch 2→3, footer NOT "nothing to submit"
- Zero-pending paths byte-identical: tests at :886, :900 (test_j_second_submit…), :854 (zero-shipped post-submit-exit), :953/:995/:1026 (bug008 family) all stay green unchanged
- The zero-pending early return keeps the heldDrafts flash branch exactly as-is
- Full suite + typecheck green; `submit()` still returns `boolean` (now true-with-real-delivery on the pending+empty-diff path)

## Why

The re-ask/re-confirmation loop is a release blocker (PRD h2.0: "the standout release blockers"). The model re-asks with changed options (merge rule 2 deletes the answer, status `reasked`); the user re-selects the same still-present value; applyAnswer records it (status `answered`) — but the last snapshot holds the identical value and computeDiff (snapshots.ts:229 computeEntries, answer-signature-only) produces zero entries, so every submit attempt dies at :595. maybeAutoSubmit (P1.M1.T1.S2's target) calls the same pipeline and is equally dead — AUTOSUBMIT-001's "identical submission pipeline fires automatically" is violated with zero feedback. The decision ledger records this exact fix (D-R6) applied to the since-removed bridge path; the panel path retained the zero-diff early return. Do NOT widen computeDiff to statuses — rejected in the research (§4): it breaks digestSince and the BUG-008 filtering contracts.

## What

1. **Re-key the early return** (actions.ts:595): `if (diff.changed.length === 0 || userChanged.length === 0)` → `if (pendingIds.length === 0)` (pendingIds is already read at :583 BEFORE markSubmitted). The entire heldDrafts flash branch moves inside this zero-pending return, byte-identical.
2. **Fall through the existing pipeline unchanged** when pendingIds is non-empty and the diff is empty/fully-filtered: gate warning → note capture → `markSubmitted(panel.state, pendingIds)` → `buildSubmission(...)` → `shipDrafts(pendingIds)` → `deliverSubmission` → `noteSubmissionDelivered` → note clear → suspend.
3. **Synthesize card entries** for pending ids ABSENT from `userChanged` so k and `details.changed` stay consistent (buildSubmission derives k from `changed.length` — with an empty list it would render "Submitted 0:" and deliver an empty card). Augment the list passed to buildSubmission:
   - Export `answerSummary` from src/snapshots.ts (currently module-private at :168) — one-line change, keep behavior identical
   - In submit(), build the augmented list: `userChanged` entries first, then for each pendingId not already in it, a `DiffEntry` synthesized from live state: `{ id, title: q.title ?? q.prompt ?? id, from: UNANSWERED_SUMMARY, to: answerSummary(q), editedArchived: false, value: q.answer?.value }` — exactly the computeEntries shape (snapshots.ts :265-270); `from` is the UNANSWERED const because the baseline (pre-re-ask snapshot semantics) contributed no diff-visible prior
   - Pass `{ ...diff, changed: augmented }` to buildSubmission (the existing `{ ...diff }` spread pattern keeps epoch)
4. **Docs [Mode A]**: reword the inline comment at ~:641 ("Runs AFTER the early return: a submit with nothing user-shipped flushes nothing") to the pendingIds-keyed rule; update the submit() docblock. Append the one-line D-R6-parity pin to spec/decisions.md per repo convention.

### Success Criteria

- [ ] BUG-002 repro test green (delivery, submitted status, epoch 2→3, non-"nothing to submit" footer)
- [ ] Zero-pending early return (flash + `return true`, held note stays held) intact — :886 test green unchanged
- [ ] Synthetic entries render ids/titles/summaries consistent with buildSubmission's existing format ("Submitted 1: db: a (state epoch 3)")
- [ ] computeDiff, answerSignature, digestSince untouched
- [ ] bug008 family (:953/:995/:1026) and :854/:900 stay green unchanged

## All Needed Context

### Context Completeness Check

Repo at 1265 green tests. This is a targeted submit()-pipeline change with the exact decision points verified in the working tree. The implementing agent needs this PRP plus actions.ts :569-665, snapshots.ts :66/:160-285, delivery.ts buildSubmission (:148+), and the named test rows.

### Documentation & References

```yaml
- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/architecture/reask-confirmation-loop.md
  why: "dedicated research: §1.3-1.4 the submit() seam map and the D-R6 fix pattern; §4 why widening computeDiff to statuses is REJECTED (digestSince/BUG-008 breakage)"
- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/architecture/system_context.md
  why: "system-level context for the re-ask loop"

- file: src/panel/actions.ts
  why: "submit() :569-665. Key lines: pendingIds :583 (BEFORE markSubmitted — BUG-008 load-bearing), userChanged filter :591-594, early return :595-620 (heldDrafts flash branch moves inside), gate warning :623-628, note :633, markSubmitted :641-648, buildSubmission call :652 ({...diff, changed: userChanged} — becomes the augmented list), shipDrafts :660, deliverSubmission :665"
  pattern: "the pipeline after the early return is reused VERBATIM — only the return condition and the changed-list augmentation change"

- file: src/snapshots.ts
  why: "answerSummary :168-198 (module-private — EXPORT it, no behavior change; it already handles custom ✎, label-preferred choice, text, flattening); computeEntries :255-273 (the DiffEntry shape to synthesize: {id,title,from,to,editedArchived,value}); UNANSWERED_SUMMARY const :66"
  gotcha: "NEVER touch computeDiff/computeEntries/answerSignature — the rejection is deliberate"

- file: src/delivery.ts
  why: "buildSubmission :148+ — derives k from diff.changed.length, owns takeSnapshot + bumpEpoch exactly once (never reorder around it), formats 'Submitted {k}: {id}: {to} (state epoch {n})'"

- file: src/panel/actions.test.ts
  why: "test conventions: seed/makePanel/makeDeps at :29-112. Rows to KEEP GREEN unchanged: :854 test_post_submit_exit_real_delivery_suspends_zero_shipped_stays_open, :886 test_j_submit_with_zero_pending…, :900 test_j_second_submit…, :953/:995/:1026 bug008 family. New BUG-002 test goes next to :886"

- file: spec/decisions.md
  why: ":41 holds D-R6 verbatim — append the one-line panel-parity pin nearby per repo convention"
```

### Current Codebase tree (relevant excerpt)

```bash
src/
├── panel/actions.ts        # submit() rewrite of early-return keying + augmented card list — MODIFY
├── panel/actions.test.ts   # BUG-002 repro test + kept-green rows — MODIFY (add only)
├── snapshots.ts            # export answerSummary (one line) — MODIFY
├── delivery.ts             # buildSubmission — NO CHANGE
└── spec/decisions.md       # one-line D-R6 parity pin — MODIFY (append)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: pendingIds MUST stay captured BEFORE markSubmitted (:583) — the
//   filter reads status 'answered', and markSubmitted flips it. Reordering
//   breaks the BUG-008 tests.
// CRITICAL: buildSubmission performs takeSnapshot + bumpEpoch internally and
//   EXACTLY ONCE — never add another snapshot/bump for the synthesized path;
//   falling through the existing call is the whole fix.
// GOTCHA: the userChanged BUG-008 filter drops agent rule-2 resets whose
//   `to === "(unanswered)"` — on the empty-diff path userChanged is empty by
//   definition, so the augmented list is purely synthesized pending entries.
//   A pending id already present in userChanged must NOT be duplicated
//   (dedupe by id).
// GOTCHA: k = augmented.length must equal the number of shipped ids — the
//   model-visible line and details.changed stay consistent.
// GOTCHA: maybeAutoSubmit's flash ('submitted — {n} answer(s)') keys on the
//   boolean return; submit now returns true with a real delivery on this
//   path — S2 owns verifying the flash truthfully. Don't special-case it here.
// GOTCHA: answerSummary already flattens newlines (BUG-006) and prefixes ✎
//   for custom answers — reuse it; do NOT reformat summaries in actions.ts.
// GOTCHA: the heldDrafts flash branch text is verbatim-h2.39 pinned — move
//   it unchanged inside the zero-pending return.
// GOTCHA: spec/ and plan/ PRD files are read-only EXCEPT the decisions.md
//   one-line pin, which the item contract explicitly authorizes.
```

## Implementation Blueprint

### Implementation Tasks (TDD-ordered)

```yaml
Task 1: ADD failing BUG-002 repro test (actions.test.ts, next to :886)
  - name: test_bug002_same_value_reanswer_after_rule2_reask_ships_pending
  - SETUP (public seams, no mocking beyond makePanel/makeDeps):
    1. seed q1 choice [a,b,c]; applyAnswer q1='a'; submit → delivered, epoch 2
       (snapshot S1 holds answer=a)
    2. rule-2 re-ask: upsertQuestion/re-apply with options [a,b,d], answer
       deleted, status 'reasked' (use the same seeding style the bug008 tests
       use for agent resets — see :953 fixture for the pattern)
    3. applyAnswer q1='a' again (status 'answered' — identical value)
  - ASSERT after submit(panel, deps):
    - returns true; sendMessage called once MORE (total 2)
    - state.getQuestion('q1').status === 'submitted'
    - state.epoch === 3; state.snapshots.length grew by 1
    - panel.footerFlash?.text !== 'nothing to submit'
    - the delivered message content line contains 'q1' and '(state epoch 3)'

Task 2: VERIFY zero-pending rows stay green (pre-change sanity)
  - npx vitest run src/panel/actions.test.ts — all green before touching code

Task 3: EXPORT answerSummary (snapshots.ts :168)
  - change `function answerSummary(...)` → `export function answerSummary(...)`
  - plus JSDoc note: exported for the submit() synthetic-entry seam (BUG-002)

Task 4: REWRITE submit() (actions.ts :583-665)
  - Replace early-return condition with `if (pendingIds.length === 0) {`
    …heldDrafts flash branch + `return true;` verbatim inside…`}`
  - After the userChanged filter, build:
      const shippedIds = new Set(userChanged.map((e) => e.id));
      const augmented = [
        ...userChanged,
        ...pendingIds
          .filter((id) => !shippedIds.has(id))
          .map((id) => {
            const q = panel.state.getQuestion(id)!;
            return {
              id,
              title: q.title ?? q.prompt ?? id,
              from: UNANSWERED_SUMMARY,
              to: answerSummary(q),
              editedArchived: false,
              value: q.answer?.value,
            };
          }),
      ];
    (import answerSummary + UNANSWERED_SUMMARY from snapshots.js; `!` is safe —
    ids came from orderedQuestions)
  - Pass `{ ...diff, changed: augmented }` to buildSubmission (replacing
    userChanged); everything else in the pipeline stays byte-identical
  - REWORD the 'Runs AFTER the early return' comment (~:641) to the
    pendingIds-keyed rule; update the submit() docblock

Task 5: APPEND the decisions.md pin (spec/decisions.md, near :41 D-R6)
  - one line: D-R6 parity extended to the panel ctrl+s path — pending
    (answered) ids flush + deliver even when the answer-signature diff is
    empty (BUG-002, 2026 wave 001_64331ded9ddb)

Task 6: RUN all gates; triage any cross-suite flips
  - If another suite keys on 'nothing to submit' for a PENDING-empty-diff
    case, that assertion pins the bug — flip it and note it for S2/S3
```

### Implementation Patterns & Key Details

```ts
// The exact new early-return block (sketch):
if (pendingIds.length === 0) {
  const heldDrafts = /* existing computation, unchanged */;
  panel.flash(heldDrafts > 0 ? `nothing to submit — ${heldDrafts} question(s) have drafts awaiting an option or Other` : "nothing to submit");
  return true; // held note stays held — nothing user-shipped (R3)
}
// …existing gate-warning / note / markSubmitted blocks unchanged…
const msg = buildSubmission(panel.state, { ...diff, changed: augmented }, note || undefined);
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/actions.test.ts   # new BUG-002 test + kept rows
npm test                                    # full 1265+ suite
```

### Level 3: Kept-green regression matrix (run explicitly)

```bash
npx vitest run src/panel/actions.test.ts -t "test_j_"          # :886/:900 zero-pending
npx vitest run src/panel/actions.test.ts -t "bug008"           # :953/:995/:1026/:1049
npx vitest run src/panel/actions.test.ts -t "test_post_submit_exit_real_delivery"  # :854
npx vitest run src/snapshots.test.ts src/delivery.test.ts      # diff/card contracts untouched
```

### Level 4: Wedge-unblock walkthrough

Reason (or script) the full loop: re-ask → same-value re-answer → ctrl+s (this fix) → close pass archives submitted → attemptCompletion unblocked (FR-5). The end-to-end public-seam integration test is P1.M1.T3.S1 — do not build it here.

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green
- [ ] BUG-002 repro test green: delivery + submitted + epoch bump + truthful footer
- [ ] Zero-pending rows (:854/:886/:900) and bug008 family (:953/:995/:1026/:1049) green UNCHANGED
- [ ] computeDiff/answerSignature/digestSince untouched (snapshots tests green)
- [ ] Synthetic entries dedupe against userChanged and match the DiffEntry shape
- [ ] Docblock + inline comment reworded; decisions.md pin appended
- [ ] submit() signature/return unchanged

## Anti-Patterns to Avoid

- ❌ Don't widen computeDiff/computeEntries to statuses — explicitly rejected (breaks digestSince/BUG-008 contracts)
- ❌ Don't add a second takeSnapshot/bumpEpoch — buildSubmission owns both, exactly once
- ❌ Don't reorder pendingIds capture — it must precede markSubmitted
- ❌ Don't touch maybeAutoSubmit here — S2 owns the transition flash; S3 owns the round-trip test
- ❌ Don't reformat summaries in actions.ts — reuse the exported answerSummary
- ❌ Don't change the heldDrafts flash strings (verbatim h2.39 template)

---

**Confidence Score**: 8/10 — the fix is a well-scoped re-keying with a copy-able synthesis pattern and a named kept-green matrix; residual risk is a hidden cross-suite assertion pinning the old empty-diff behavior (triage path defined in Task 6) and title/entry-shape subtleties in the synthesized DiffEntry (mitigated by following computeEntries verbatim).

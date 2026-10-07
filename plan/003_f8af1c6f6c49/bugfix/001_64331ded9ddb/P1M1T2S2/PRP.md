# PRP — Bugfix P1.M1.T2.S2: writeInEnter byte-identical no-op exclusion for `reasked` (choice write-ins and text questions)

## Goal

**Feature Goal**: Fix PRD BUG-001 for the editor path: the ANSWER-PIN-001 byte-identical no-op in `writeInEnter` (src/panel/actions.ts:379-385) checks only answer presence + value/kind, so `enter` with a buffer identical to a rule-1 re-asked question's KEPT write-in (or kept text answer) is swallowed as an inert no-op and the question is stuck in `reasked` forever. Add `&& q.status !== "reasked"` to the condition so the same-value re-commit falls through to the direct-commit exit — and preserve the recorded answer's KIND in that commit (`custom: true` write-in re-commits custom; a plain fallback-shaped text answer re-commits plain, since writeInEnter's applyAnswer otherwise always stamps `custom: true`).

**Deliverable**: Modified `src/panel/actions.ts` (reasked exclusion on the no-op + kind-preserving direct commit + Mode A docblock update) and TDD tests in `src/panel/actions.test.ts`; optional one-line extension of S1's decisions.md pin if it names only acceptOptionIndex.

**Success Definition**:
- `npm run typecheck` + full `npm test` green
- Fixture (a): rule-1-reasked choice question, recorded custom write-in `'alpha'`, buffer `'alpha'`, enter → commits: status `answered`, `custom === true` (kind preserved), fresh `answer.at`, buffer consumed (no draft residue — VAL-002), advance, seam-free (no `beginWriteInConfirm`)
- Fixture (b): rule-1-reasked text question, recorded plain value `'alpha'`, buffer `'alpha'`, enter → commits: status `answered`, `custom` stays `undefined` ("text re-commits plain")
- Completing-the-set variant: the re-confirmed reasked id is the last unanswered → maybeAutoSubmit fires and DELIVERS (epoch bump + one sendMessage — relying on S1's fixed submit() pipeline, COMPLETE)
- Stay-green: the answered/submitted/closed byte-identical no-op pins, the :623 complete-set twin, :543, :610, :658 all green unchanged

## Why

The state machine requires `reasked → user answers → answered(pending)`, but the no-op — authored to stop re-PROPOSAL of SETTLED answers on revisit — applied verbatim to the hybrid reasked+kept-answer state (created by the lifecycle's rule-1 marker, not the user) breaks the re-ask confirmation loop: the question counts as unanswered everywhere, auto-submit can never fire, ctrl+s reports "nothing to submit", and completion (FR-5, the product's core deliverable) is blocked unless the user retypes a different answer. Commitment 8 ("Always keep the user's answer. No exceptions.") is violated by the wedge, not by the fix — re-committing the kept text IS keeping it. S1 (parallel, Implementing) lands the identical exclusion for `acceptOptionIndex`; this is the editor-path twin, and per the PRD's recommendation both seams need it.

## What

1. **Exclusion on the no-op condition** (actions.ts:380): add `&& q.status !== "reasked"` so a byte-identical buffer on a reasked question falls past the no-op. The FR-18 gate (:389-392, `answered || submitted`) already skips `reasked` — the fall-through is seam-free and lands in the direct-commit exit.
2. **Kind preservation in the direct commit** (:393): today `applyAnswer(q.id, { value: text, custom: true, at: … })` always stamps `custom: true`. For the same-value reasked re-confirm, derive the flag from the recorded answer: commit `custom: recorded.custom === true` when this is a byte-identical re-commit on a reasked question (choice custom write-in → `true`; plain text answer → `undefined`). Different-text commits and fresh answers keep today's `custom: true` semantics unchanged (a panel-typed text answer IS a write-in — test :2076-2082 pins this).
3. **Mode A docblock**: update writeInEnter's BYTE-IDENTICAL paragraph (:373-378 area) — the no-op covers SETTLED statuses (answered/submitted/closed carrying the identical write-in/text); a rule-1 re-ask same-value enter is a re-confirmation commit that re-marks pending with the recorded kind preserved and a fresh `at` (the answer signature at snapshots.ts:123 excludes `at`, so diffs are unaffected).
4. **decisions.md**: S1 appends the ANSWER-PIN-001 reasked-amendment pin; per the item contract it "covers both seams" — if its wording names only acceptOptionIndex, extend it to name writeInEnter (match the existing formatting; read the entry first).

### Success Criteria

- [ ] Same-value buffer on `reasked` → commit lands via the direct-commit exit (writeInEnter returns true); status `answered`; `custom` flag byte-equal to the recorded kind; fresh `answer.at`; advance; blur
- [ ] No `beginWriteInConfirm` on the same-value re-confirm (reasked skips the FR-18 gate — verify the gate is untouched)
- [ ] Buffer consumed: `panel.draftTextFor(qid) === undefined`, no draft residue staged by the advance's write-through (VAL-002 — the consume at :400 runs on the fall-through too)
- [ ] Completing transition: sole reasked question re-confirmed → one sendMessage, epoch bump, status `submitted`
- [ ] Same-value on answered/submitted/closed STILL inert (existing pins in the describe green unchanged); complete-set ANSWERED twin (:623) green; text-without-custom ANSWERED pin (:543) green; :610 and :658 green
- [ ] Different-text write-in commits unchanged (custom:true, FR-18 modal on answered/submitted with victims — regression)

## All Needed Context

### Context Completeness Check

Repo green (1265+ tests); all line references verified against the working tree this session (see research/notes.md for verbatim excerpts). Agent needs this PRP plus `src/panel/actions.ts`, `src/panel/actions.test.ts`, `spec/decisions.md`, and the architecture doc.

### Documentation & References

```yaml
- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/architecture/reask-confirmation-loop.md
  why: "THE research doc — §1.2 writeInEnter no-op verbatim, §4 fix (a) covers BOTH seams, §5 scope warnings"
  critical: "keep the exclusion reasked-ONLY; the sibling stay-green pins flip if widened"

- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/P1M1T2S2/research/notes.md
  why: current-code excerpts (no-op :379-385, FR-18 gate :389-392, direct commit :393, maybeAutoSubmit :408), kind-preservation analysis, stay-green anchor list with test names

- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/P1M1T2S1/PRP.md
  why: "SIBLING CONTRACT (in flight): acceptOptionIndex reasked exclusion — mirror its condition style, comment semantics, and decisions.md pin; parallel functions, NO shared code paths"
  gotcha: "S1's exclusion is `q.status !== \"reasked\"` appended to its own no-op condition — same one-line shape here"

- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/P1M1T1S1/PRP.md (T1.S1 + T1.S2 — COMPLETE)
  why: "CONTRACT: submit() pendingIds fall-through + maybeAutoSubmit empty-diff transition — what lets the re-marked answer actually DELIVER; consume, do not touch"

- file: src/panel/actions.ts
  why: "ONLY source file. no-op :379-385; FR-18 gate :389-392 (already skips reasked — leave untouched); direct commit :393 (kind derivation goes here); consume :400 runs on the fall-through already; maybeAutoSubmit :408 wasUnanswered includes reasked already"
  gotcha: "hoist or inline q.status before :380 — the `status` const is read later at :390; read it once or twice, do not reorder the FR-18 gate"

- file: src/panel/actions.test.ts
  why: "TDD placement: inside the write-in no-op describe next to :623; harnesses: writeInSeed (choice + custom write-ins), seed([{id:'t1',overrides:{type:'text',options:undefined}}]) for text; reasked seeding = applyAnswer then setStatus('reasked') keeping the answer (rule-1 lifecycle shape)"
  gotcha: "stay-green anchors: :543 (answered text-without-custom inert), :557 (closed stays closed), :610 (VAL-002 consume), :623 (answered-set complete twin), :658 (digit bounds)"

- file: spec/decisions.md
  why: "S1 appends the ANSWER-PIN-001 reasked amendment; extend its wording to name writeInEnter only if it names acceptOptionIndex alone — match repo formatting"

- docfile: PRD h2.1/h3.0 (BUG-001 verbatim) + h2.5 recommendation bullet 2 ("Exclude reasked … in acceptOptionIndex/writeInEnter") — in this PRP's task prompt
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
├── actions.ts        # MODIFY: no-op exclusion + kind-preserving commit + docblock
└── actions.test.ts   # MODIFY: TDD failing-first tests (both fixtures + completing-set variant)
spec/decisions.md     # MODIFY (conditional): extend S1's pin to name writeInEnter
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: scope is `reasked` ONLY — widening to other statuses flips the
//   settled-inertness pins (:543/:557/:623 and the answered/submitted rows).
// CRITICAL: KIND preservation is required or the text fixture regresses the
//   contract: writeInEnter's applyAnswer always stamps custom:true, which
//   would silently flip a fallback-recorded plain text answer into a
//   "write-in" on re-confirm. Derive custom from recorded.custom === true
//   ONLY for the byte-identical reasked re-commit.
// GOTCHA: don't touch the FR-18 gate (:389-392) — reasked skipping it IS the
//   seam-free re-confirm; P1.M2.T1.S2 must preserve that when widening to closed.
// GOTCHA: the VAL-002 consume at :400 runs on the direct-commit fall-through —
//   the same-value reasked path inherits buffer consumption for free; assert it.
// GOTCHA: maybeAutoSubmit's wasUnalready includes reasked at :408 — no change needed.
// GOTCHA: answer.at refresh is CORRECT for a re-confirmation and diff-invisible
//   (snapshots.ts:123 signature is value+text only).
// GOTCHA: test assertions use `toBe(T0)`-style at pins for inert rows and
//   `not.toBe(T0)` for the re-confirm; capture the answer ref BEFORE enter.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: WRITE FAILING TESTS FIRST (src/panel/actions.test.ts, in the write-in no-op describe near :623)
  - (a) test_wi_same_value_on_reasked_reconfirms (choice/custom fixture):
      writeInSeed([{id:'q2'}]); applyAnswer('q1',{value:'alpha',custom:true,at:T0});
      setStatus('q1','reasked') keeping the answer (rule-1 shape);
      panel.currentId='q1'; focusTextField('writein'); setText('alpha');
      expect(writeInEnter(panel)).toBe(true);
      q1.status === 'answered'; q1.answer.custom === true (kind preserved);
      q1.answer.at !== T0; panel.confirmMode === null; advanced to q2;
      panel.draftTextFor('q1') === undefined (VAL-002 consume)
  - (b) test_wi_same_value_on_reasked_text_question_recommits_plain:
      seed t1 type:'text', options undefined; applyAnswer({value:'alpha',at:T0}) NO custom;
      setStatus('t1','reasked'); focusTextField('writein'); setText('alpha'); enter →
      status 'answered'; answer.custom === undefined (NOT flipped); fresh at; advance stays
      (no other questions) or per harness
  - (c) test_wi_reasked_reconfirm_completing_set_auto_submits_and_delivers:
      sole question reasked; makeDeps(true) delivery; enter 'alpha' →
      sendMessage called once; epoch bumped; status 'submitted' (relies on
      T1.S1/S2 COMPLETE pipeline)
  - (d) regression matrix: rerun the describe — answered/submitted/closed inert rows,
      :543, :610, :623, :658 all still green (no edits to them)
  - RUN npx vitest run src/panel/actions.test.ts -v — (a)/(b)/(c) fail today (inert no-op)

Task 2: IMPLEMENT in src/panel/actions.ts
  - no-op condition (:380): append `&& q.status !== "reasked"`
  - direct commit (:393): kind derivation —
      const isReconfirm = q.status === "reasked" && recorded !== undefined && recorded.value === text;
      const customFlag = isReconfirm ? recorded!.custom === true : true;
      panel.state.applyAnswer(q.id, isReconfirm ? { value: text, custom: customFlag, at: … }
                                                 : { value: text, custom: true, at: … });
    (equivalently: when isReconfirm, spread the recorded kind; keep today's literal
     {value, custom:true, at} for every non-reconfirm commit — zero behavior change there)
  - NOTE: `recorded` is already in scope from the no-op check; `status` const at :390 —
    read q.status directly at :380 to avoid reordering

Task 3: UPDATE the writeInEnter docblock BYTE-IDENTICAL paragraph [Mode A]
  - settled-statuses no-op + reasked re-confirmation + kind preservation + the
    snapshots.ts:123 at-exclusion note; keep the VAL-002 consume paragraph true (it now
    also covers the reasked fall-through)

Task 4: decisions.md — extend S1's reasked-amendment pin to name writeInEnter
  (only if S1's wording names acceptOptionIndex alone; spec-wins formatting)

Task 5: RUN gates
  - npx vitest run src/panel/actions.test.ts -v
  - npm run typecheck && npm test
```

### Implementation Patterns & Key Details

```ts
// The condition after the fix:
const recorded = q.answer;
if (recorded !== undefined && recorded.value === text
    && (recorded.custom === true || q.type === "text")
    && q.status !== "reasked") {          // ← the one-line exclusion
  /* inert no-op, unchanged */
}

// Kind-preserving direct commit (only the reasked re-confirm changes):
const isReconfirm = q.status === "reasked"
  && recorded !== undefined && recorded.value === text;
panel.state.applyAnswer(q.id, {
  value: text,
  ...(isReconfirm ? { custom: recorded!.custom === true } : { custom: true as const }),
  at: new Date().toISOString(),
});
// FR-18 gate (:389) skips reasked → the re-confirm is seam-free; consume (:400),
// advance, blur, maybeAutoSubmit (:408, wasUnanswered includes reasked) all inherit.
```

### Integration Points

```yaml
SIBLINGS:
  - P1.M1.T2.S1 acceptOptionIndex exclusion (in flight): parallel twin; NO shared code;
    decisions.md pin shared/extended
  - P1.M1.T3.S1 round-trip integration test: consumes S1+S2+T1 — re-ask → re-confirm
    (option AND write-in flavors) → submission → settle → completion injection
  - P1.M2.T1.S2 widened FR-18 write-in gate (closed edits): MUST NOT capture the same-value
    reasked re-confirm — gate statuses stay answered/submitted(+closed), never reasked
UPSTREAM (complete): T1.S1 submit() pendingIds fall-through + T1.S2 maybeAutoSubmit
  empty-diff transition — the delivery the completing test asserts
NO CHANGES to: acceptOptionIndex, digit, the FR-18 gate, begin/apply/cancelWriteInConfirm,
maybeAutoSubmit, consumeCommittedBuffer, submit()
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/actions.test.ts -v
npm test
```

### Level 3: Behavioral probe (BUG-001 editor-path repro — the tests ARE the probe)

```bash
npx vitest run src/panel/actions.test.ts -t "reasked" -v
# Pre-fix: same-value enter leaves status 'reasked' (wedged); post-fix: 'answered', delivered.
```

### Level 4: Domain validation

- [ ] writeInEnter docblock states the reasked exclusion + kind preservation (Mode A)
- [ ] `git diff src/panel/actions.ts` — one condition line, the kind-preserving commit, comments only; the FR-18 gate byte-identical
- [ ] decisions.md pin names both seams

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green
- [ ] TDD: fixtures (a)/(b)/(c) observed failing (inert no-op / stuck reasked) before the fix
- [ ] Reasked same-value write-in → commit, custom kind preserved, fresh at, seam-free, consumed buffer, advance; text plain → stays plain
- [ ] Completing transition delivers (epoch bump, one sendMessage, submitted)
- [ ] All settled-inertness pins green unchanged (:543/:557/:610/:623/:658 + answered/submitted rows)
- [ ] Different-text commits unchanged (custom:true, FR-18 modal paths intact)

## Anti-Patterns to Avoid

- ❌ Don't widen the exclusion beyond `reasked` — the settled pins flip
- ❌ Don't stamp `custom: true` on the plain-text re-confirm — kind preservation is the contract
- ❌ Don't change different-text/fresh commit semantics — only the byte-identical reasked re-confirm derives its kind
- ❌ Don't touch the FR-18 gate, submit(), maybeAutoSubmit, or acceptOptionIndex — sibling/scope contracts
- ❌ Don't suppress the fresh `answer.at` — it's correct and diff-invisible (snapshots.ts:123)
- ❌ Don't skip the VAL-002 consume assertion — P1.M1.T3.S1's round trip depends on no draft residue
- ❌ Don't paraphrase decisions.md — extend S1's pin in the repo's formatting

---

**Confidence Score**: 9/10 — the no-op, gate, direct commit, consume, and maybeAutoSubmit sites all read verbatim this session; the sibling S1 PRP fixes the pattern (one-line exclusion + one comment rewrite); the only nontrivial addition (kind preservation for the plain-text re-confirm) is directly required by the item contract and analyzed against the custom:true text-answer pin (:2076). Sequencing: delivery test (c) relies on the COMPLETE T1 pipeline — no coordination risk.

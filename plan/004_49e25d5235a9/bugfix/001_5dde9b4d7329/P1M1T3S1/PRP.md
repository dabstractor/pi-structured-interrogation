---
name: "BUG-001 fix 1 of 2 — acceptOptionIndex direct-path supersede re-stage + rewrite the manufactured test at actions.test.ts:2213"
description: "Wire stageSupersededWriteIn (from P1.M1.T2.S1) into acceptOptionIndex's direct/zero-victim apply site, delete the manufactured re-staging line from the WRITEIN-002 regression test so it guards the real flow, and correct the stale design comment at actions.ts:538."
---

## Goal

**Feature Goal**: Restore WRITEIN-002's supersede re-bind on the DIRECT option-accept path (zero FR-18 victims — the PRD BUG-001 repro's exact path): immediately after `panel.state.applyAnswer(q.id, proposed)` in `acceptOptionIndex` (src/panel/actions.ts:268-321), call `stageSupersededWriteIn(panel, q.id, recorded, proposed.value)` using the `recorded` capture already at :294. Then convert `test_submit_superseded_writein_rebinds_as_elaboration` (src/panel/actions.test.ts:2213) from a manufactured-state test into the real-flow regression: delete the manual re-staging line (:2223) so the existing assertions prove the fix through the real commit (real consume) → real accept (fix stages) → submit (re-bind attaches).

**Deliverable**:
1. `src/panel/actions.ts` — one inserted call after :313 + extended design comment at :538 (Mode A).
2. `src/panel/actions.test.ts` — line 2223 deleted (+ optionally one explicit pre-state assertion that `draftTextFor("q1")` is `undefined` after the real commit, making the red state legible).

**Success Definition**: TDD red→green (test fails after the line deletion, passes after the wiring); the PRD's Steps-to-Reproduce (h2.2/h3.0) now deliver `q1: Alpha — my custom take` with `answer.text === "my custom take"` through real gestures only; VAL-002 pins (`:776`, `:816-840`, `:2174`) stay green; full `npm test` + `npm run typecheck` green. No mocks — real-modules scenario per house AUTOMATION-POLICY.

## User Persona (if applicable)

**Target User**: The pi user who commits a write-in, reconsiders, and accepts a real option.

**Use Case**: "I wrote my own answer, then saw a listed option that fits better" — the user's original words must survive as elaboration for the new choice, not vanish.

**User Journey**: Commit write-in "my custom take" on q1 → navigate back, accept option "a" → the ✎ draft marker lights with the kept text (user can edit/clear it — it's an ordinary draft) → submit ships `q1: Alpha — my custom take` with `answer.text` set.

**Pain Points Addressed**: The user's hand-written words silently disappearing from every surface (model delta, diff card, state) when superseded — an R4 "never destroyed" violation.

## Why

- PRD h2.2/h3.0 (BUG-001): the spec (ui-spec.md:37), AC-2b tail, and README all promise the re-bind; the implementation cannot deliver it in any real flow because VAL-002's `consumeCommittedBuffer` (correctly) deletes the slot at commit, and the accept path never re-stages. The shipped test passes only by manually re-creating the deleted state — the repo contradicts itself.
- The adjudicated fix (P1.M1.T1.S1 decisions.md ruling "restore"): keep the consume-at-commit AND re-create the slot at supersede time, from the recorded answer's value, only when no user-held draft exists. `stageSupersededWriteIn` (P1.M1.T2.S1) is that primitive — this subtask is its first call site (the modal path is S2's).
- `reconcileDraftsForSubmit` (:573-579) already attaches a staged slot as `answer.text` at submit when the answer is non-custom — the staged draft flows through with zero changes to submit/reconcile internals.

## What

1. **TDD flip first** — `src/panel/actions.test.ts:2213`: DELETE line 2223 (`panel.commitTextDraft("q1", "my custom take"); // kept slot text (R4)`). Optionally insert `expect(panel.draftTextFor("q1")).toBeUndefined();` immediately after `commitWriteIn(...)` to document the consume. Update the test's stale inline comments if they still claim "accept never touches the draft store" as the keep mechanism (the keep mechanism is now the explicit re-stage).
2. **Wire the call** — `src/panel/actions.ts` `acceptOptionIndex`: immediately after `panel.state.applyAnswer(q.id, proposed);` (:313), insert:
   ```ts
   stageSupersededWriteIn(panel, q.id, recorded, proposed.value);
   ```
   BEFORE `evaluateDependsOn`/`advanceAfterAccept` (:315-317) — matches the file's commit-tail conventions and guarantees staging precedes `maybeAutoSubmit`. `stageSupersededWriteIn` is exported from the SAME module (P1.M1.T2.S1) — plain call, no import. Add a one-line comment: WRITEIN-002 re-bind, direct path (modal path in ripple-confirm.ts is S2); guards inside the helper.
3. **Mode A comment at :538** — `reconcileDraftsForSubmit`'s design comment: the old claim "the slot text was KEPT (R4 — accept never touches the draft store)" was half-true since VAL-002's consume deletes the slot at commit. Rewrite that sentence to name `stageSupersededWriteIn` as the KEPT-text mechanism: the supersede path (direct + modal) explicitly re-stages the superseded write-in's value as an ordinary role-less draft, which this attach branch binds as `answer.text` at submit; a user-held draft always wins (helper guard 4).
4. **Do NOT touch**: `consumeCommittedBuffer` / the commit paths (VAL-002 stays), `reconcileDraftsForSubmit` code, `applyConfirmedEdit` in ripple-confirm.ts (S2's call site), the helper itself, or the T4 scenario tests.

### Success Criteria

- [ ] TDD: after deleting :2223 the test is RED (`draftTextFor("q1")` undefined at :2230); after the wiring it is GREEN with no other change
- [ ] The rewritten test exercises only real gestures: `commitWriteIn` helper (real accept on ✎ row + real enter → real consume) → real `accept(panel)` at cursorIndex 0 → submit
- [ ] Assertions unchanged in substance: slot kept (`draftTextFor === "my custom take"`), submit ships `q1: Alpha — my custom take`, `answer.text === "my custom take"`, `custom` undefined
- [ ] VAL-002 pins green: `:776` no-draft-residue, `:816-840` reasked variant, `:2174` write-in no-duplication
- [ ] `:538` comment names stageSupersededWriteIn as the KEPT-text mechanism
- [ ] `npm test` + `npm run typecheck` green

## All Needed Context

### Context Completeness Check

The PRP contains the verbatim current code of both touch points (:294/:313 insertion site, :538 comment), the verbatim manufactured test with the exact line to delete and the assertions that then become the fix's proof, the helper's full contract, the TDD sequence, and the stay-green pin list. An agent needs this PRP plus `src/panel/actions.ts`, `src/panel/actions.test.ts`, and (read-only) `src/panel/panel.ts`.

### Documentation & References

```yaml
- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/architecture/bug001-writein-supersede.md
  why: "THE research doc — §(a) acceptOptionIndex trace (:268-321, recorded :294, apply :313, tail :315-317), §(d) touch point 1 (the exact insert + why before-advance), §(d) 'Redundancy of the test's manual re-staging' (why deleting :2223 converts the test), §(e) test impact"
  critical: "guard-1 rationale: the inert branch requires recorded.custom !== true, so EVERY apply behind a custom:true answer is a genuine supersede — no extra value check at the call site"

- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/P1M1T2S1/PRP.md
  why: "PREDECESSOR CONTRACT (in flight): stageSupersededWriteIn — exported, same module, 4 ordered guards, stages via commitTextDraft. Consume exactly as specified; do not modify"
  gotcha: "if S1 hasn't landed when you start, the TDD-red test will fail to compile on the call — sequence accordingly (wire after S1 lands; the test flip can land first only if the helper exists)"

- file: src/panel/actions.ts
  why: "BOTH touch points — insertion after :313 in acceptOptionIndex; :538 reconcileDraftsForSubmit design comment (Mode A rewrite target)"
  pattern: "commit-tail ordering: state mutation → draft staging → evaluateDependsOn → advanceAfterAccept → maybeAutoSubmit"
  gotcha: "recorded at :294 is captured BEFORE the apply — it still holds the superseded custom answer at the insertion point; do not re-read state after applyAnswer"

- file: src/panel/actions.test.ts
  why: "the manufactured test (:2213-2245 verbatim in research/notes.md), the commitWriteIn helper (:2161-2167, real gestures), harness (seed(BASIC)/makePanel/makeDeps/submit/accept), stay-green pins :776/:816/:2174"
  gotcha: "the test already handles ANSWER-PIN-001 cursor re-seeding (drives cursorIndex=0 explicitly) — keep that gesture sequence byte-identical"

- file: src/panel/panel.ts
  why: "READ-ONLY context: consumeCommittedBuffer :982-991 (why the slot is gone after commit), commitTextDraft :903-926 (the staging seam, blur idempotent from options focus), draftTextFor :1205-1210"
  gotcha: "never call panel internals directly — the helper owns staging; this subtask only calls the helper"

- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/P1M1T3S1/research/notes.md
  why: "verified line-level excerpts of every touch point + the TDD sequence + stay-green list — this PRP's evidence base"
```

### Current Codebase tree (relevant slice)

```bash
src/panel/
  actions.ts         # acceptOptionIndex (:268-321) + stageSupersededWriteIn (S1) + reconcileDraftsForSubmit (:538 comment)
  actions.test.ts    # :2213 manufactured test, :2161 commitWriteIn helper, VAL-002 pins :776/:816, no-dup pin :2174
  panel.ts           # read-only seams (consumeCommittedBuffer, commitTextDraft, draftTextFor)
  ripple-confirm.ts  # S2's call site (applyConfirmedEdit) — NOT this subtask
spec/decisions.md    # the P1.M1.T1.S1 WRITEIN-002 restore ruling (cite, don't duplicate)
```

### Desired Codebase tree

```bash
# No new files — modifications only:
src/panel/actions.ts        # +1 call after :313, :538 comment rewrite
src/panel/actions.test.ts   # :2223 deleted (+ optional undefined pre-state assertion)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: insert AFTER applyAnswer but BEFORE evaluateDependsOn/advanceAfterAccept — the advance's
// write-through must not race the staging, and maybeAutoSubmit (same gesture, T4.S3) must find the slot staged.
// CRITICAL: pass the :294 `recorded` capture — re-reading state after applyAnswer returns the NEW answer.
// The test's cursor gesture: after currentId="q1" the setter re-seeds the cursor to the ✎ row (ANSWER-PIN-001);
// cursorIndex=0 must be set explicitly BEFORE accept — the existing sequence already does this.
// Deleting :2223 makes the test the fix's regression: :2230's draftTextFor assertion now depends on the wiring.
// Do not widen scope: no commit-path changes (VAL-002), no reconcile changes, no ripple-confirm.ts (S2).
// ESM relative imports use ".js" suffix (not needed here — same-module call).
```

## Implementation Blueprint

### Data models and structure

No data-model changes. The staged slot is an ordinary role-less draft (`h2.45`) — `{value?, text}` semantics owned by the DraftStore/slots machinery.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: TDD FLIP — src/panel/actions.test.ts (:2213 test)
  - DELETE :2223 (panel.commitTextDraft("q1", "my custom take"))
  - OPTIONAL: after commitWriteIn, add expect(panel.draftTextFor("q1")).toBeUndefined() (documents the consume)
  - FIX stale inline comment if it credits "accept never touches the draft store" as the keep mechanism
  - RUN: npx vitest run src/panel/actions.test.ts -t "superseded" → RED at the draftTextFor assertion
  - PREREQ: stageSupersededWriteIn must exist (P1.M1.T2.S1) before Task 2 compiles; the flip (Task 1) can land first only alongside S1's helper

Task 2: WIRE — src/panel/actions.ts acceptOptionIndex
  - INSERT after :313 (panel.state.applyAnswer(q.id, proposed)):
      stageSupersededWriteIn(panel, q.id, recorded, proposed.value);
  - ADD one-line comment (WRITEIN-002 re-bind, direct path; guards live in the helper; modal path = ripple-confirm.ts, S2)
  - RUN: npx vitest run src/panel/actions.test.ts -t "superseded" → GREEN

Task 3: MODE A COMMENT — actions.ts :538 (reconcileDraftsForSubmit design comment)
  - REWRITE the "slot text was KEPT (R4 …)" sentence: name stageSupersededWriteIn as the KEPT-text mechanism
    (supersede path re-stages the superseded write-in's value as a role-less draft; user-held drafts always win)
  - NOTE the half-truth history in one clause (VAL-002's consume deleted the slot the old comment assumed survived)

Task 4: FULL-SUITE GATE
  - RUN: npm test && npm run typecheck
  - STAY-GREEN pins: :776 (no-draft-residue), :816-840 (reasked consume), :2174 (write-in no-duplication), :2169 elaboration attach
  - IF a suite fails because it manufactured the same deleted-slot state, audit it: it is either a real-flow regression to
    extend (like :2213 was) or a scenario belonging to T4 — record which in the subtask result, fix accordingly
```

### Implementation Patterns & Key Details

```ts
// acceptOptionIndex tail (final shape, direct path):
panel.state.applyAnswer(q.id, proposed);
stageSupersededWriteIn(panel, q.id, recorded, proposed.value); // WRITEIN-002 re-bind (BUG-001; guards in helper)
evaluateDependsOn(panel.state);                                 // unchanged
advanceAfterAccept(panel);                                      // unchanged
// ... maybeAutoSubmit on the "accept" exit — staging has already happened

// Why before-advance: the advance's currentId change runs the draft write-through on the OUTGOING
// question; staging first means the slot exists (helper guard 4 sees user-held drafts win) regardless
// of write-through ordering, and maybeAutoSubmit's same-gesture delivery finds the slot staged.
```

### Integration Points

```yaml
CONSUMED:
  - "stageSupersededWriteIn (P1.M1.T2.S1, same module) — call as-is, no modification"
  - "reconcileDraftsForSubmit attach branch (:573-579) — untouched; the staged slot flows through it"
  - "spec/decisions.md P1.M1.T1.S1 ruling — cite in comments; do not create a second entry"
PARALLEL (do not duplicate):
  - "P1.M1.T3.S2: applyConfirmedEdit modal path (ripple-confirm.ts:142-166) — the FR-18 victims>0 twin"
  - "P1.M1.T4.S1-S3: edge-contract scenarios (user-draft-wins, delete-to-empty, kind-flip, non-custom, auto-submit gesture)"
DO-NOT-TOUCH:
  - "consumeCommittedBuffer / writeInEnter commit paths (VAL-002 contract)"
  - "submit()/reconcileDraftsForSubmit code, DraftStore internals, panel.ts"
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # clean
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/actions.test.ts -t "superseded" -v   # the rewritten regression, green
npx vitest run src/panel/actions.test.ts -v                   # stay-green pins hold
npm test                                                      # full suite
```

### Level 3: Integration Testing

Not applicable — the rewritten test IS the PRD repro's real-flow encoding (real commit → real accept → submit). PRD h2.2/h3.0 steps 1-5 map 1:1 onto `commitWriteIn` → accept → submit assertions.

### Level 4: Creative & Domain-Specific Validation

```bash
# Prove the regression test now guards the fix: comment out the inserted stageSupersededWriteIn call
# → the test must FAIL at draftTextFor. Restore. (Scratch edit only; never commit the sabotage.)
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean
- [ ] `npm test` fully green

### Feature Validation

- [ ] TDD red→green observed (delete :2223 → red; wire → green)
- [ ] Real-flow regression: real commit (consume) → real accept → slot kept → submit ships `q1: Alpha — my custom take` with `answer.text` set
- [ ] VAL-002 pins and the write-in no-duplication pin green unchanged

### Code Quality Validation

- [ ] One call + one comment in actions.ts production code; one deletion (+ optional assertion) in the test
- [ ] No mocks; real-modules gestures only (house AUTOMATION-POLICY)
- [ ] `recorded` capture reused — no post-apply state re-read

### Documentation & Deployment

- [ ] :538 comment names stageSupersededWriteIn as the KEPT-text mechanism (Mode A)
- [ ] No new dependencies, no config changes

---

## Anti-Patterns to Avoid

- ❌ Don't re-stage inside `commitTextDraft` calls at the call site — the helper owns ALL guard logic; the call site is one line
- ❌ Don't read state after `applyAnswer` to recover the old answer — the :294 `recorded` capture is the superseded answer
- ❌ Don't keep line 2223 or "fix" it — deletion is the point; keeping it makes the test bypass the fix via guard 4
- ❌ Don't touch the modal path (ripple-confirm.ts) — S2's contract, duplicating it here creates double-staging
- ❌ Don't relax `consumeCommittedBuffer` to keep the slot — that reopens VAL-002 (machine-copied buffers becoming elaboration)
- ❌ Don't reorder the call after `advanceAfterAccept` — commit-tail conventions and maybeAutoSubmit ordering depend on staging first

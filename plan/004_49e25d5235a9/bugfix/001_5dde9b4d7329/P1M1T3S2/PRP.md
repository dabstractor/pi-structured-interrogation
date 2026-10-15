---
name: "BUG-001 fix 2 of 2 — applyConfirmedEdit modal-path supersede re-stage (FR-18 victims>0) + modal supersede test"
description: "Wire stageSupersededWriteIn into applyConfirmedEdit (src/panel/ripple-confirm.ts:142-166) so the FR-18 deferred modal commit ALSO re-stages a superseded write-in, closing the coverage gap left by S1's direct-path wiring. Plus a new TDD modal-path supersede test."
---

## Goal

**Feature Goal**: Restore WRITEIN-002's supersede re-bind on the FR-18 MODAL path (victims>0): in `applyConfirmedEdit` (src/panel/ripple-confirm.ts), capture the recorded answer BEFORE `panel.state.applyAnswer(cm.questionId, cm.proposed)` and call `stageSupersededWriteIn(panel, cm.questionId, recorded, cm.proposed.value)` immediately after the apply. Without this, S1's direct-path fix (acceptOptionIndex) leaves the bug alive on every supersede that defers through the ripple modal — the modal defers the SAME apply via the confirmed-choice stash (ripple-confirm.ts:123-136, `createRippleConfirm` stashes `questionId`/`proposed`/`victims` and returns veto) and bypasses `acceptOptionIndex`'s body entirely (architecture/bug001-writein-supersede.md §(d) touch point 2, risk 1 of §(f)).

**Deliverable**:
1. `src/panel/ripple-confirm.ts` — the recorded capture + one helper call in `applyConfirmedEdit`, plus the one-line BUG-001/WRITEIN-002 Mode A comment.
2. New modal-path supersede test in `src/panel/ripple-confirm.test.ts` (or `actions.test.ts` — see Task 3), driving the REAL modal flow: write-in commit → option supersede with a dependsOn victim answered → veto/modal → enter applies → slot staged → submit attaches the elaboration.

**Success Definition**: TDD red→green on the new test; BOTH option-accept apply sites (direct :313 + modal) stage the superseded write-in with no coverage gap; full `npm test` + `npm run typecheck` green; S1's rewritten real-flow test and all VAL-002 pins stay green.

## User Persona

Same as BUG-001: the user who commits a write-in, reconsiders, and accepts a real option — except this time the accept invalidates other answered questions (FR-18 ripple), so the commit goes through the keep/cancel modal. Their original words must still survive as elaboration.

**User Journey**: Commit write-in "my own words" on q1 (whose answer is a dependsOn anchor for an answered q2) → navigate back to q1, accept option alpha → FR-18 modal appears (q2 is a victim) → enter (keep, apply) → the ✎ draft marker lights with "my own words" → submit ships `q1: Alpha — my own words` with `answer.text === "my own words"`.

## Why

- PRD h2.2/h3.0 (BUG-001): the spec/AC-2b/README promise the re-bind on EVERY supersede. S1 (in flight) fixes only the zero-victim direct path; the modal path (`applyConfirmedEdit`) mirrors `acceptOptionIndex`'s apply tail independently — missing it leaves the bug on every victims>0 supersede.
- `ripple-confirm.ts` already imports `maybeAutoSubmit, nextUnanswered` from `./actions.js` (ripple-confirm.ts:65), so importing `stageSupersededWriteIn` adds NO import cycle.
- The shipped suite has NO supersede-through-modal test today (research §(e): "Coverage gap to note in review").

## What

1. **The wiring** — `src/panel/ripple-confirm.ts` `applyConfirmedEdit` (:142-166). Current body order: clear mode → guard `cm` → `panel.state.applyAnswer(cm.questionId, cm.proposed)` (~:158) → `evaluateDependsOn` → nextUnanswered advance → invalidate → maybeAutoSubmit. Change:
   ```ts
   const recorded = panel.state.getQuestion(cm.questionId)?.answer; // BEFORE apply — holds the superseded write-in
   panel.state.applyAnswer(cm.questionId, cm.proposed);
   // BUG-001 / WRITEIN-002 re-bind (decisions.md P1.M1.T1.S1 restore ruling): the
   // modal defers the same supersede the direct path (actions.ts acceptOptionIndex) stages —
   // guards live inside stageSupersededWriteIn (custom-only, non-blank, no kind-flip, user-draft wins).
   stageSupersededWriteIn(panel, cm.questionId, recorded, cm.proposed.value);
   ```
   Insert the stage call AFTER applyAnswer and BEFORE `evaluateDependsOn` — same commit-tail ordering S1 uses on the direct path (staging precedes the moot recompute/advance/maybeAutoSubmit). Extend the import at :65: `import { maybeAutoSubmit, nextUnanswered, stageSupersededWriteIn, type RippleConfirmFn } from "./actions.js";`
2. **JSDoc touch**: `applyConfirmedEdit`'s doc block says it "mirrors acceptOptionIndex's tail EXACTLY ONCE" — extend one clause: the mirror now includes the superseded write-in re-stage (BUG-001). Keep it to one sentence.
3. **Do NOT touch**: `applyWriteInConfirm` (write-in → write-in: staging there is ✎-noise per the helper's own DO NOT note), `createRippleConfirm`/stash shape, `cancelConfirmedEdit`, `acceptOptionIndex` (S1 owns), the helper itself, `consumeCommittedBuffer`, or T4's scenario tests.
4. **TDD — the new modal-path supersede test** (research §(e) item 5): place in `src/panel/ripple-confirm.test.ts` (it has the panel harness, raw-bytes `handleInput` driving, and `fakeEditor()` — :108), or `actions.test.ts` if its `commitWriteIn` helper (:2161) is easier to reuse; either is acceptable, pick the file whose harness needs less new code and note the choice.
   - **Fixture**: seed a state with q1 (choice alpha/beta) and q2 with `dependsOn: [{id:"q1", notEquals:"alpha"}]`-style dependency such that accepting alpha on q1 makes answered q2 a VICTIM; set q2 answered (applyAnswer after upsert — actions.test.ts seeding convention :85-91). IMPORTANT: the victim must be an ANSWERED/SUBMITTED question (`VICTIM_STATUSES` filter, ripple-confirm.ts:107-116) whose dependsOn condition breaks under the new value.
   - **Flow (real gestures, no mocks except the delivery seam)**: on q1, open the ✎ Other row → type "my own words" → enter (real commitWriteIn, real consume — slot gone) → navigate back to q1, cursor to the alpha row, enter → the REAL `createRippleConfirm` must run (do NOT use `seamMock(false)` — a mocked veto never stashes `panel.confirmMode`, so `applyConfirmedEdit` would be unreachable; the existing suite's typed `seamMock` at actions.test.ts:97-101 is for seam-boundary tests only) → assert `panel.confirmMode?.kind === "choice"`, `questionId === "q1"`, victims include q2 → assert `panel.draftTextFor("q1") === undefined` (nothing staged while the modal is pending) → drive enter (`applyConfirmedEdit` via the modal's input branch or by calling the exported `applyConfirmedEdit(panel)` — the existing ripple tests drive raw bytes; raw bytes preferred) → assert: q1 answer `{value:"alpha", text:undefined at apply time}`, `panel.draftTextFor("q1") === "my own words"` (the fix), DraftStore seam holds it, then submit → delivered content contains `q1: Alpha — my own words` and `state.getQuestion("q1")?.answer?.text === "my own words"`.
   - Also assert the esc path (`cancelConfirmedEdit`) still stages NOTHING and changes no state (one cheap negative assertion while you're in the modal).
5. **Mode A comment**: the one-line call-site comment naming BUG-001/WRITEIN-002 + decisions.md ruling is the entire doc surface (per contract; no other docs).

### Success Criteria

- [ ] TDD: new modal test red before the wiring (draftTextFor undefined after modal-apply), green after — no other change
- [ ] Recorded captured BEFORE applyAnswer; stage call after apply, before evaluateDependsOn; import from ./actions.js (no cycle — already imported there)
- [ ] Test drives the REAL modal (createRippleConfirm stash → applyConfirmedEdit), not seamMock; delivery seam mocked per house AUTOMATION-POLICY, everything else real
- [ ] S1's rewritten direct-path test still green; VAL-002 pins (:776/:816/:2174 in actions.test.ts) green; full `npm test` + `npm run typecheck` green
- [ ] esc path: no staging, no state change (asserted)

## All Needed Context

### Context Completeness Check

This PRP embeds the verbatim current `applyConfirmedEdit` body, the stash shape (`panel.confirmMode` from createRippleConfirm :123-136), the helper's four guards verbatim, the real-vs-mocked modal pitfall, the victim-status requirement, and the full test scenario. An implementer needs this PRP plus `src/panel/ripple-confirm.ts`, `src/panel/actions.ts` (helper :355-371), and the two test files.

### Documentation & References

```yaml
- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/architecture/bug001-writein-supersede.md
  why: THE research doc — §(d) touch point 2 (applyConfirmedEdit capture-before-:158 + insert), §(e) item 5 (the exact modal test scenario this PRP encodes), §(f) risk 1 (why missing this site leaves the bug alive), §(d) commitTextDraft safety analysis (:187 — blur idempotent, EXPLAIN-003 re-seed cannot fire from the modal apply)
  critical: the modal apply runs with the cursor on an option row and focus "options" — commitTextDraft's side effects are harmless (same analysis S1 relies on)

- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/P1M1T3S1/PRP.md
  why: SIBLING CONTRACT (in flight) — wires the direct path in acceptOptionIndex after :313 and rewrites the :2213 test; keep its conventions identical (recorded-before-apply, stage-before-advance, one-line comment style)
  gotcha: if S1 hasn't landed, the helper still exists (P1.M1.T2.S1, landed) — this subtask is independent of S1's wiring and can proceed

- file: src/panel/actions.ts
  why: stageSupersededWriteIn (:355-371, landed) — exported from the SAME module ripple-confirm already imports from (:65 maybeAutoSubmit, nextUnanswered); four ordered guards in its JSDoc; call exactly as-is
  gotcha: pass the pre-apply captured answer; re-reading after applyAnswer returns the NEW answer (custom undefined → guard 1 no-ops)

- file: src/panel/ripple-confirm.ts
  why: BOTH touch points — applyConfirmedEdit (:142-166, apply at ~:158) and createRippleConfirm stash (:123-136: questionId, proposed, victims, kind:"choice"); VICTIM_STATUSES filter (:107-116) defines who counts for the fixture
  pattern: commit-tail mirror — applyAnswer → (NEW: stage) → evaluateDependsOn → nextUnanswered → invalidate → maybeAutoSubmit

- file: src/panel/ripple-confirm.test.ts
  why: harness — panels driven with raw terminal bytes through panel.handleInput (:9-11), fakeEditor (:108-126), existing confirmMode assertions (:161-176); reuse for the new test

- file: src/panel/actions.test.ts
  why: commitWriteIn real-gesture helper (:2161-2167), seeding convention (upsert then applyAnswer/setStatus :85-91), typed seamMock (:97-101) and WHY it can't drive the modal (mocked veto never stashes confirmMode), S1's rewritten real-flow test (:2213)

- file: spec/decisions.md
  why: the P1.M1.T1.S1 'WRITEIN-002 supersede re-bind restored (BUG-001)' ruling — cite in the call-site comment, don't duplicate

- file: src/panel/panel.ts (READ-ONLY)
  why: commitTextDraft :903-926 (the staging seam — the helper owns the call, this subtask never touches panel internals), draftTextFor :1205-1210, consumeCommittedBuffer :982-991
```

### Current Codebase tree (relevant slice)

```bash
src/panel/
  actions.ts          # stageSupersededWriteIn :355 (landed); acceptOptionIndex direct-path wiring = S1 (parallel)
  actions.test.ts     # :97 seamMock, :2161 commitWriteIn, :2213 real-flow test (S1)
  ripple-confirm.ts   # THIS ITEM — applyConfirmedEdit :142-166, createRippleConfirm :123-136, import line :65
  ripple-confirm.test.ts  # modal harness; the new test lands here (or actions.test.ts)
spec/decisions.md     # the restore ruling (cite)
```

### Desired Codebase tree

No new files — `src/panel/ripple-confirm.ts` (+1 import, 2 statements, comment) and one new test in `src/panel/ripple-confirm.test.ts` (or `actions.test.ts`).

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: capture `recorded` BEFORE applyAnswer — post-apply the answer is the new one and guard 1 no-ops silently
// CRITICAL: a seamMock(false) veto NEVER stashes panel.confirmMode — the new test must run the REAL createRippleConfirm
// CRITICAL: fixture victims must be answered/submitted/closed (VICTIM_STATUSES) whose dependsOn breaks under the new value — an open ripple id is NOT a victim and bypasses the modal
// ESM: "./actions.js" suffix — ripple-confirm.ts:65 already imports from it; just extend the named list (no cycle)
// commitTextDraft's blur + EXPLAIN-003 re-seed are harmless from the modal apply (research §(d) :187 analysis)
// maybeAutoSubmit fires at the tail of applyConfirmedEdit (AUTOSUBMIT-003 rule b) — staging must precede it, hence insert BEFORE evaluateDependsOn
// Do NOT stage from applyWriteInConfirm — reconcileDraftsForSubmit skips custom answers; staging there is ✎-noise (helper JSDoc DO NOT note)
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: WRITE the failing modal-path test (TDD red)
  - FILE: src/panel/ripple-confirm.test.ts (preferred — modal harness + raw-byte driving) or actions.test.ts if reusing commitWriteIn is materially simpler
  - FIXTURE: q1 choice alpha/beta; q2 dependsOn q1 (condition that alpha breaks) ANSWERED; seed per upsert-then-applyAnswer convention
  - FLOW: real write-in commit on q1 → real option accept at alpha → REAL createRippleConfirm (default panel confirm seam — do NOT inject seamMock) → assert confirmMode stashed + draftTextFor("q1") undefined → enter (applyConfirmedEdit) → RED assertions: draftTextFor("q1") === "my own words" → submit → content contains "q1: Alpha — my own words", answer.text set
  - NEGATIVE: esc path (cancelConfirmedEdit) stages nothing, zero state change

Task 2: MODIFY src/panel/ripple-confirm.ts — the wiring
  - IMPORT: add stageSupersededWriteIn to the existing ./actions.js named import (:65)
  - BODY (applyConfirmedEdit): const recorded = panel.state.getQuestion(cm.questionId)?.answer; before applyAnswer (~:158); stageSupersededWriteIn(panel, cm.questionId, recorded, cm.proposed.value); immediately after the apply, before evaluateDependsOn
  - COMMENT: one line naming BUG-001/WRITEIN-002 + decisions.md ruling; extend the "mirrors acceptOptionIndex's tail" JSDoc sentence to include the re-stage
  - VERIFY: Task 1 goes green; npm test + npm run typecheck green
```

### Implementation Patterns & Key Details

```ts
// The whole production diff (ripple-confirm.ts):
import { maybeAutoSubmit, nextUnanswered, stageSupersededWriteIn, type RippleConfirmFn } from "./actions.js";
// ...
  const recorded = panel.state.getQuestion(cm.questionId)?.answer;
  panel.state.applyAnswer(cm.questionId, cm.proposed);
  stageSupersededWriteIn(panel, cm.questionId, recorded, cm.proposed.value); // BUG-001/WRITEIN-002 — modal-path twin of the actions.ts direct call
  evaluateDependsOn(panel.state);
```

### Integration Points

```yaml
NO new exports, NO config, NO schema, NO state.ts changes.
CONSUMERS/GATES:
  - P1.M1.T4.S3 (auto-submit same-gesture variant) builds on BOTH apply sites being wired — land before it
  - P1.M1.T3.S1 (direct path, parallel) — independent code sites; only shared surface is the helper (landed) and conventions; do not re-edit its sites
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npx vitest run src/panel/ripple-confirm.test.ts src/panel/actions.test.ts
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/   # all panel suites — ripple, actions, keys, VAL-002 pins
npm test                    # full suite green
```

### Level 3: Integration

Covered by the new test's real-gesture flow (real consume → real modal → real apply → real submit seam). No external mocks beyond the delivery/sendMessage seam per AUTOMATION-POLICY.

### Level 4: Review checklist

- [ ] Both apply sites stage; grep confirms exactly two `stageSupersededWriteIn(panel` call sites (actions.ts + ripple-confirm.ts), none in applyWriteInConfirm
- [ ] decisions.md ruling cited at the call site; no other docs touched

## Final Validation Checklist

- [ ] `npm run typecheck` + `npm test` green; only intended diffs (ripple-confirm.ts + one test file)
- [ ] Modal-path test: red before wiring, green after; real createRippleConfirm flow, no seamMock veto
- [ ] recorded-before-apply; stage-before-evaluateDependsOn; import extended in place (no cycle)
- [ ] esc path negative assertion present and passing
- [ ] S1's direct-path test and VAL-002 pins (:776/:816/:2174) still green
- [ ] Mode A comment landed; scope respected (no commit-path, reconcile, applyWriteInConfirm, or T4 changes)

---

## Anti-Patterns to Avoid

- ❌ Don't capture the recorded answer AFTER applyAnswer — guard 1 silently no-ops and the test can't catch it via the value (it can: draftTextFor stays undefined — hence the TDD order)
- ❌ Don't drive the modal with seamMock(false) — it never stashes confirmMode; the real seam is required
- ❌ Don't stage from applyWriteInConfirm or cancelConfirmedEdit (esc must remain zero-mutation)
- ❌ Don't re-implement guards at the call site — the helper owns all four
- ❌ Don't duplicate S1's direct-path wiring or its test — this item is the modal twin only
- ❌ Don't touch the helper, commit paths, or reconcileDraftsForSubmit

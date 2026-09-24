---
name: "P2.M1.T4.S1 — Remove the submit-pending edge; assert epoch bumps per auto-submit firing"
description: "The 'submit pending answers first' footer edge is already absent from the codebase (grep-verified; superseded by maybeAutoSubmit from P2.M1.T1.S1). This subtask LOCKS that absence and adds the missing scripted FR-D4 assertions: (a) consecutive edit commits on a complete set = one submission + one epoch bump + one snapshot EACH; (b) the suspended-mid-delivery resume scenario — a complete set holding pending (answered) answers resumes to the pending-submit panel and flushes via ONE ctrl+s (submit) or any new commit (commit-tail maybeAutoSubmit), each exactly one epoch bump; (c) the epoch-bumped event fires once per firing. Consumed by P3.M2.T2.S1 (AC-9)."
---

## Goal

**Feature Goal**: FR-D4 cleanup + lock (PRD h2.39 empty/edge states, h2.41 epoch semantics, h2.33 edit trade-off). The old `submit pending answers first` footer edge is gone; nothing in the shipped code or tests may reintroduce or assert it. Every auto-submit firing is a full submission that bumps epoch exactly once.

**Deliverable**:
1. Grep-verified absence of the edge (no `submit pending answers first` string, branch, or test anywhere in `src/`) — recorded as a scripted regression check.
2. New/extended tests in `src/panel/actions.test.ts` (extend the existing `describe("maybeAutoSubmit — completeness hook", ...)` at :1620):
   - Consecutive-edit epoch-per-firing loop: N sequential edit commits on a complete set → N submissions, N epoch bumps (+1 each), N snapshots, N sendMessage calls, flash `submitted — 1 answer(s)` each time.
   - `epoch-bumped` event assertion: one emit per firing with the new value.
   - Suspended-mid-delivery resume: state = complete set with pending (answered) answers → ONE `submit()` flushes all pending in a single submission (one bump); alternatively ONE new commit fires `maybeAutoSubmit` and flushes (one bump). No interim partial ships.
3. JSDoc touch-up in `src/state.ts` / `src/panel/actions.ts` ONLY if writing the tests surfaces wording that contradicts behavior (Mode A) — expected: none beyond what P2.M1.T1.S1 already wrote.

**Success Definition**: `npx vitest run src/panel/actions.test.ts` and the full `npx vitest run` green; `npm run typecheck` clean; greps for the edge string over `src/` return zero hits; the new tests prove epoch increments exactly once per firing under consecutive edits and under both resume-flush paths.

## User Persona

**Target User**: A power user mid-interrogation who edits an already-answered question while the set is complete, and a user who suspends the panel between their last answer commit and the submission delivery.

**Use Case**: (1) Editing answered questions on a complete set — each edit deliberately costs one model turn (h2.33 trade-off). (2) Suspending at exactly the wrong moment: the panel reopens showing pending answers, and one `ctrl+s` (or any next answer) ships them.

**User Journey**: user answers everything → auto-submit fires → user edits q1 → immediate resubmission (epoch 2→3) → edits q2 → immediate resubmission (epoch 3→4) — every firing visible in the diff-card snapshot ring. Separately: user answers last question, suspends before the auto-submit can run (or delivery is pending), reopens via `/interrogate` → pending-submit panel → one `ctrl+s` ships everything once.

**Pain Points Addressed**: ambiguity about what happens to answers committed while suspended; silent or double epoch bumps; any lingering "submit pending answers first" affordance that completeness auto-submit made obsolete.

## Why

- PRD h2.39: "Set complete → auto-submit has already shipped (AUTOSUBMIT-001); the `submit pending answers first` edge is gone. A user who suspended between the last commit and delivery resumes to a pending-submit panel; one `ctrl+s` (or any new commit) flushes it."
- PRD h2.41: "epoch ... bumps on every submission — including every auto-submitted one (AUTOSUBMIT-001; each firing is a full submission)."
- PRD h2.33: "Edits included: re-committing an already-answered question while the set is complete ships the edit immediately (one submission per commit — the user opted into this knowing each is a model turn)."
- Downstream: P3.M2.T2.S1 rewrites AC-9 ("pending answers ship on the next commit or submit after restart") — the resume-flush tests written here define the semantics it consumes.
- Prior PRP contract: P2.M1.T1.S1 delivered `maybeAutoSubmit` (actions.ts:593) and initial hook tests; P2.M1.T3.S1 wires the bridge tail — neither covers consecutive-edit loops, the `epoch-bumped` event, or the suspended-mid-delivery resume scenario.

## What

### Behavior contract

1. **Edge absence (verification, not deletion).** `grep -rni "submit pending\|pending answers first\|submitPending" src/` must return ZERO hits. Research (research/findings.md) confirmed the edge exists only in spec prose (`spec/ui-spec.md:74`, `:138`) and plan docs — it never survived to code because `maybeAutoSubmit` (commit `fbe6942`) made it moot before any implementation of the edge landed. If — contrary to findings — a branch/flash/test asserting the edge IS found during implementation, DELETE it per the delta_prd removal note and re-run the greps. Do NOT edit `spec/*.md` (read-only for this item).

2. **Consecutive-edit epoch-per-firing assertions (extend `actions.test.ts`).** Extend the existing `test_auto_edit_of_answered_on_complete_set_fires_again` (:1661) or add a sibling test `test_auto_consecutive_edits_each_one_submission_one_epoch_bump`: after the first complete-set firing, loop 3 edits of already-submitted questions (set cursor, `accept(panel)`) and assert after EACH iteration: `sendMessage` call count +1, `state.epoch` +1, `state.snapshots.length` +1 (one snapshot per firing via `buildSubmission`), flash text `submitted — 1 answer(s)`. Total after loop: 4 sendMessages / epoch 5 (1 initial + 1 complete-set + 3 edits, starting from epoch 1 with 2 questions).

3. **`epoch-bumped` event once per firing.** Subscribe `state.on("epoch-bumped", cb)` (state.ts:151 emits `[epoch: number]`); across the consecutive-edit loop assert exactly one emit per firing and the payload equals the post-bump `state.epoch` (n = 2, 3, 4, 5). Unsubscribe/dispose per harness conventions.

4. **Suspended-mid-delivery resume flush (the h2.39 scenario).** Two tests, state-level (the AUTOMATION-POLICY forbids live TUI):
   - `test_resume_pending_panel_one_ctrl_s_flushes_once`: seed a complete set where ≥2 questions are `answered` (pending) and the rest `submitted`/`answered` with zero `open`/`reasked` — the exact post-suspend pre-delivery shape. Call `submit(panel, deps)` ONCE (the `ctrl+s` semantic — keys.ts binds it to `panelActions.submit` with host-pre-bound deps). Assert: exactly ONE `sendMessage`, `state.epoch` +1 (one bump), ALL pending ids now `submitted`, one new snapshot. The panel-level resume focus (rung 2, "pending-submit state", panel.ts:1716) is existing behavior — do not re-test rendering; optionally assert `resumeOpenPanel` focus via existing suspend.test.ts patterns only if cheap.
   - `test_resume_pending_panel_new_commit_flushes_once`: same seeded state, but instead of ctrl+s perform one new commit (edit an answered question: `panel.currentId`/`cursorIndex` + `accept(panel)`). The commit tail's `maybeAutoSubmit` (actions.ts:251) fires: exactly ONE `sendMessage`, one epoch bump, flash `submitted — {n} answer(s)` where n = the whole pending set (NOT just the edited question — h2.33 "the flash counts the whole pending set"), all pending now `submitted`.

5. **Mode A docs.** state.ts epoch JSDoc (:201-210) and actions.ts `maybeAutoSubmit` JSDoc (:562+) were written in P2.M1.T1.S1 and already state per-firing bump semantics. Touch ONLY if the new tests reveal a contradiction; otherwise no doc changes.

### Success Criteria

- [ ] Greps over `src/` for the edge string/branch return zero hits (scripted check recorded).
- [ ] Consecutive-edit test proves one submission + one epoch bump + one snapshot per firing, N times.
- [ ] `epoch-bumped` emits exactly once per firing with the post-bump value.
- [ ] Resume scenario: ONE ctrl+s → one submission, one bump, all pending shipped once.
- [ ] Resume scenario: one new commit → one submission, one bump, whole pending set shipped with full-count flash.
- [ ] Full `npx vitest run` green (no regressions to P2.M1.T1–T3 suites); `npm run typecheck` clean.

## All Needed Context

### Context Completeness Check

Validated: the edge was grep-verified absent from `src/`; all seams (`maybeAutoSubmit`, `submit`, `bumpEpoch`, `epoch-bumped`, resume focus ladder) located with exact anchors; the test harness (`seed`/`makePanel`/`makeDeps`) and its conventions quoted from `actions.test.ts:1-130`; existing per-firing tests enumerated so the new ones extend rather than duplicate.

### Documentation & References

```yaml
- file: src/panel/actions.ts
  why: maybeAutoSubmit (:593-607) — the firing under test; submit (:449-560) — the ctrl+s pipeline; commit tails calling the hook (:251 accept path, :311 write-in direct-commit exit)
  pattern: buildSubmission ALONE performs takeSnapshot + bumpEpoch (exactly once) — never bump in tests' code paths or around submit
  gotcha: flash counts the pending set captured BEFORE submit runs (:578, :601-606) — "submitted — 2 answer(s)" not 1 when a second answer rides the edit

- file: src/panel/actions.test.ts
  why: the harness and the existing describe block to extend (:75 seed, :101 makePanel, :118 makeDeps, :1620 "maybeAutoSubmit — completeness hook"); existing edit test (:1661 test_auto_edit_of_answered_on_complete_set_fires_again) is the pattern to loop
  pattern: panels constructed directly; dispose() when flash timers armed; epoch via state.epoch, snapshots via state.snapshots.length
  gotcha: re-setting panel.currentId re-seeds the cursor to the ★ preselect — explicitly set panel.cursorIndex after (see :1676-1678)

- file: src/state.ts
  why: bumpEpoch (:397-403) increments + emits "epoch-bumped" with the NEW value (:150-151); epoch starts 1 (:235); JSDoc :201-210 already documents AUTOSUBMIT per-firing semantics
  gotcha: user answers NEVER bump rev — assert rev unchanged if asserting rev at all

- file: src/delivery.ts
  why: buildSubmission module header (:15-21) — one call = one snapshot + one bump; the invariant the consecutive-edit test locks

- file: src/panel/panel.ts
  why: resumeOpenPanel (:1700-1731) rung 2 = the "pending-submit state" focus for the resume scenario; do not modify

- file: spec/ui-spec.md (READ-ONLY)
  why: h2.39/h2.33 prose defining the removed edge and resume semantics — authoritative behavior text; NEVER edit spec files in this item

- file: plan/002_949db554a811/P2M1T4S1/research/findings.md
  why: the grep evidence that the edge is absent + all anchors used here
```

### Current Codebase tree (relevant slice)

```bash
src/panel/actions.ts        # READ + optional JSDoc touch only
src/panel/actions.test.ts   # MODIFY — extend maybeAutoSubmit describe + new resume-flush tests
src/state.ts                # READ (+ JSDoc touch only if contradiction surfaces)
# NO production behavior changes expected — this is a verification/lock subtask
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: epoch bumps ONLY inside buildSubmission (delivery.ts) — one per
// firing. Never add a bump; the tests LOCK "exactly +1 per firing".
// GOTCHA: flash text uses the pending count captured BEFORE submit — an edit
// commit that makes another answered question pending ships BOTH and flashes
// "2 answer(s)".
// GOTCHA: seed() forces upserted ids to status "open" — non-open statuses
// (answered/submitted) are applied after upsert via applyAnswer/setStatus
// (actions.test.ts header comment).
// GOTCHA: panel.currentId setter re-seeds cursorIndex to the ★ recommendation
// preselect — always set panel.cursorIndex explicitly after changing currentId.
// GOTCHA: dispose() panels whose flash() armed a timer, or vitest hangs.
// GOTCHA: makeDeps(false) simulates a busy agent (steer branch) — use the
// default makeDeps(true) for these scenarios.
// GOTCHA: never launch a live pi TUI in tests (AUTOMATION-POLICY) — the
// "suspended-mid-delivery" scenario is modeled purely by STATE shape
// (complete + pending answered), not by actually suspending.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: VERIFY edge absence (scripted)
  - RUN: grep -rniE "submit pending|pending answers first|submitPending" src/
  - EXPECT zero hits; record output in the PR's verification notes
  - IF any hit is a code branch or test asserting the edge: DELETE it (delta_prd
    removals list), re-run until zero; spec/*.md stays untouched

Task 2: MODIFY src/panel/actions.test.ts — extend "maybeAutoSubmit — completeness hook"
  - ADD test_auto_consecutive_edits_each_one_submission_one_epoch_bump:
    seed BASIC (q1,q2), reach completeness, then loop 3 edits; per iteration
    assert sendMessage +1, state.epoch +1, state.snapshots +1, flash
    "submitted — 1 answer(s)"
  - ADD epoch-bumped event assertions: subscribe before the loop, collect
    payloads, assert one emit per firing with values 2..5
  - FOLLOW pattern: test_auto_edit_of_answered_on_complete_set_fires_again (:1661)

Task 3: MODIFY src/panel/actions.test.ts — resume-flush describe (or tests inside the same describe)
  - test_resume_pending_panel_one_ctrl_s_flushes_once: seed complete set,
    q1+q2 answered (pending), zero open/reasked; ONE submit(panel, deps);
    assert 1 sendMessage, epoch+1, both submitted, 1 new snapshot
  - test_resume_pending_panel_new_commit_flushes_once: same seed; accept() one
    edit; assert 1 sendMessage, epoch+1, flash "submitted — 2 answer(s)"
    (whole pending set), all pending submitted
  - NAMING: test_{scenario}_{expected} per file convention

Task 4: MODE A doc check (no-op expected)
  - READ state.ts :201-210 and actions.ts :562+ JSDoc; edit ONLY on contradiction

Task 5: VALIDATE — npm run typecheck; npx vitest run src/panel/actions.test.ts -v; full npx vitest run
```

### Integration Points

```yaml
NONE (no production changes, no schema/config/state changes):
  - downstream P3.M2.T2.S1 (AC-9 rewrite) consumes these semantics — name the
    two resume tests exactly as specified so its PRP can cite them
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/actions.test.ts -v
npx vitest run src/panel/ -v        # panel suites stay green (P2.M1.T1–T3)
npx vitest run                      # full suite
```

### Level 3: Behavioral spot-checks

```bash
grep -rniE "submit pending|pending answers first|submitPending" src/ | wc -l   # 0
npx vitest run src/panel/actions.test.ts -t "consecutive_edits" -v
npx vitest run src/panel/actions.test.ts -t "resume_pending" -v
```

## Final Validation Checklist

- [ ] `npm run typecheck` clean; full `npx vitest run` green.
- [ ] Edge grep over `src/` = 0 hits (or found remnants deleted with tests re-run).
- [ ] Consecutive-edit test: N edits → N submissions, N bumps, N snapshots, one flash each.
- [ ] `epoch-bumped` emitted once per firing with post-bump values.
- [ ] Resume: one ctrl+s → one submission/bump shipping ALL pending; one new commit → same via the commit tail.
- [ ] No production behavior changes beyond optional JSDoc wording.
- [ ] Spec files untouched; no live-TUI usage (AUTOMATION-POLICY).

## Anti-Patterns to Avoid

- ❌ Don't "implement" the edge removal as a code change when none is needed — the deliverable is verification + tests.
- ❌ Don't add epoch bumps anywhere outside buildSubmission, or assert epoch > +1 per firing.
- ❌ Don't write the resume test by actually suspending a TUI — model it as state shape (complete + pending).
- ❌ Don't duplicate P2.M1.T1.S1's existing tests — extend/loop them.
- ❌ Don't touch src/panel/actions.ts logic that P2.M1.T2.S1/P2.M1.T3.S1 own (gate hold, bridge tail).
- ❌ Don't edit spec/*.md or plan tasks.json.

---

**Confidence Score**: 9/10 — the surprising finding (edge already absent from code) is grep-verified from three angles; every test seam, harness fixture, and existing test is anchored by exact line; the only residual risk is line drift from the parallel P2.M1.T2.S1/P2.M1.T3.S1 implementations, which touch disjoint files/regions (gate.ts-internal and remote-*/index.ts) from this item's actions.test.ts additions.

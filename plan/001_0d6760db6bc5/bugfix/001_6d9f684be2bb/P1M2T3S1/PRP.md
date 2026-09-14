# PRP — bugfix P1.M2.T3.S1: draft-safe panel submit (BUG-008)

---
name: "bugfix P1.M2.T3.S1 — actions.ts submit: shipDrafts(pendingIds) and filter agent-reset entries"
description: "Fix src/panel/actions.ts submit (lines ~295–372, shipDrafts at 355): (a) ship text drafts ONLY for ids the user actually shipped — the pre-markSubmitted pendingIds ∩ hasDraft — instead of every diff.changed id, so agent-re-asked questions' preserved drafts survive per R4; (b) filter agent-caused rule-2 resets (`!pendingIds.includes(e.id) && e.to === '(unanswered)'`) out of the SubmissionCardData passed to buildSubmission so the model-visible delta lists only user shipments. buildSubmission still performs its own snapshot+bumpEpoch exactly once — do not reorder the side-effect tail. Regression tests in src/panel/actions.test.ts following its seed/makePanel/makeDeps conventions."
---

## Goal

**Feature Goal**: Panel ctrl+s submit no longer destroys the preserved drafts of agent-re-asked questions and no longer ships misleading `q1: (unanswered)` delta lines to the model (BUG-008, bug report h2.2/Issue 8). Drafts are destroyed only by submission of the text the user actually shipped (R4/commitment 6); the model-visible delta lists only user shipments.

**Deliverable**: Modified `src/panel/actions.ts` (the `submit` function only, ~10 changed lines) + regression tests in `src/panel/actions.test.ts` (a panel.test.ts-level end-to-end case if its harness reaches submit). No other file changes.

**Success Definition**: `npm run typecheck` + `npm test` green. Reproducing the bug report's steps to reproduce: after an agent rule-2 re-ask of q1 (draft preserved), user answers q2 and presses ctrl+s → `getDraft('q1')` still returns the draft; the delivered `msg.content` contains `q2` but NOT `q1: (unanswered)`; `msg.details.changed` likewise contains no agent-reset entry; ring +1 / epoch +1 exactly once; editedArchived entries and genuinely-pending `(unanswered)`→answered entries still ship.

## User Persona

**Target User**: The TUI user who typed a text draft on a question that the agent then re-asked — their draft must still be there when they revisit (R4: draft loss on revisit is the disqualifying defect class).

**Use Case**: Agent re-asks q1 (answer reset by merge rule 2, draft preserved); user answers q2 and hits ctrl+s; q1's draft must survive for when they revisit q1.

**User Journey**: answer q2 → ctrl+s → delta says only what the user shipped → reopen q1 → draft text still in the field.

**Pain Points Addressed**: (a) silent destruction of un-shipped drafts (R4 violation); (b) model told the user "retracted" an answer the agent itself reset — confusing the core submission→re-ask loop.

## Why

- Bug report h2.2 Issue 8 (BUG-008) + h2.5 recommendation: "Flush drafts only for ids the user actually shipped (pending answered ids), and filter agent-caused answer resets out of the shipped delta list."
- Root cause (verified in code): `submit` computes `diff = computeDiff(submissionBaseline(panel), panel.state.serialize())` at the top; after a rule-2 re-ask the baseline (latest snapshot) still holds q1's OLD answer while live state has it reset → q1 enters `diff.changed` as `from:'old answer', to:'(unanswered)'` even though the user shipped nothing for q1. Then line 355 ships drafts for every `diff.changed` id — destroying q1's draft — and `buildSubmission` derives `k` and the entry list from `diff.changed`, so the delta includes the agent-caused reset.
- Correct ship set is ALREADY in scope: `pendingIds` (status `'answered'` ids, computed at ~343 BEFORE `markSubmitted`) is by construction exactly what the user is shipping.
- No downstream changes: renderers read `details.card` which keeps user-caused entries (including editedArchived/AC-13 changed markers).

## What

### Exact edits in `src/panel/actions.ts` `submit()`

Current relevant code (verified, lines ~340–360):

```ts
const pendingIds = panel.state.orderedQuestions().filter((q) => q.status === "answered").map((q) => q.id);
if (pendingIds.length > 0) markSubmitted(panel.state, pendingIds);
const msg = buildSubmission(panel.state, diff, note || undefined);
panel.drafts?.shipDrafts?.(diff.changed.map((c) => c.id));
```

Change to:

```ts
const pendingIds = panel.state.orderedQuestions().filter((q) => q.status === "answered").map((q) => q.id);
if (pendingIds.length > 0) markSubmitted(panel.state, pendingIds);
// BUG-008 (a): ship drafts ONLY for ids the user actually shipped.
// diff.changed includes agent rule-2 resets (answered → unanswered) the
// user never touched; shipping those destroys preserved drafts (R4/h2.45).
panel.drafts?.shipDrafts?.(pendingIds.filter((id) => panel.drafts?.hasDraft?.(id)));
// BUG-008 (b): drop agent-caused resets from the model-visible delta: an
// entry the user did not ship whose answer went to "(unanswered)" is by
// construction the agent's own merge-rule-2 reset (merge.ts:181–193). Genuinely
// pending ids and editedArchived entries stay. k stays consistent —
// buildSubmission derives it from changed.length.
const userChanged = diff.changed.filter(
  (e) => pendingIds.includes(e.id) || !(e.to === "(unanswered)"),
);
const msg = buildSubmission(panel.state, { ...diff, changed: userChanged }, note || undefined);
```

Notes / edge handling:

- **Move `shipDrafts` BEFORE `buildSubmission`?** No — keep the existing placement rationale only if convenient; the safest is ship AFTER `buildSubmission` exactly as now (comment says message is built from state, not drafts — still true). You may keep `shipDrafts` after `buildSubmission`; just pass `pendingIds`-filtered ids, not `diff.changed` ids. Preferred final order: `markSubmitted` → filter `userChanged` → `buildSubmission` → `shipDrafts(pendingIds ∩ hasDraft)` → `deliverSubmission` (all existing ordering comments preserved).
- `hasDraft` is optional on the store interface (`panel.ts:120`); guard with `?.` as shown. If `hasDraft` is absent, shipping `pendingIds` unfiltered is still correct-and-safe (pendingIds ⊆ user-shipped) — the `?.` fallback `undefined` simply excludes nothing; acceptable. (`DraftStore` in `src/draft-store.ts` implements both; `getDraft`/`hasDraft` available.)
- The zero-pending early-return (`diff.changed.length === 0` → flash "nothing to submit") is computed BEFORE the filter and stays untouched: a diff consisting solely of agent resets still counts as "something happened" in state, but nothing user-shipped — with the filter applied it would deliver an empty-changed message. **Decision**: change the early-return guard to `if (userChanged.length === 0 && pendingIds.length === 0)` → flash and return; if `userChanged.length === 0 && pendingIds.length > 0` cannot occur (a pending answered id always diffs vs baseline unless already snapshotted — if it can occur, treat as zero-pending flash too). Simplest correct form: compute `pendingIds` FIRST (it only reads status, before markSubmitted), then `const userChanged = ...`, then `if (diff.changed.length === 0 || userChanged.length === 0) { flash; return true; }` — a submission with nothing user-shipped ships nothing (no snapshot/bump/delivery), which also preserves the R3 held-note contract.
- Do NOT touch `markSubmitted`, `submissionBaseline`, the gate-warning block, `note` capture/clear, `deliverSubmission`, `deps.noteSubmissionDelivered?.()` — all unchanged. `buildSubmission` still performs `takeSnapshot + bumpEpoch` itself exactly once (delivery.ts contract; never wrap it).
- If P1.M2.T2.S1's `DiffEntry.value?: string` field has landed, it flows through untouched — the filter reads only `id` and `to`.

### Success Criteria

- [ ] After a rule-2 re-ask of q1 with a stored draft, submit (answering q2) leaves `panel.drafts.getDraft('q1')` intact; q2's draft (if any) is destroyed.
- [ ] Delivered message content and `details.changed` contain q2's entry; no `q1: (unanswered)` entry anywhere.
- [ ] Ring +1, epoch +1, exactly one sendMessage — unchanged from before.
- [ ] A genuinely-pending answered id still appears; editedArchived `(changed)` entries still appear (AC-13 unaffected).
- [ ] Zero user-pending submit (e.g. only agent resets in diff) flashes "nothing to submit", no side effects, held note stays held.
- [ ] No changes outside `submit()` in actions.ts; no other src file modified.

## All Needed Context

### Context Completeness Check

An implementer with zero prior knowledge needs: the current submit code, the DraftStore interface, the diff/baseline semantics, merge rule 2's effect, buildSubmission's side-effect contract, and the existing test harness conventions. All anchored below.

### Documentation & References

```yaml
- file: src/panel/actions.ts
  why: THE file to edit — submit() at ~295–372; current buggy line 355 shipDrafts(diff.changed ids); pendingIds at ~343; diff computed at ~312 vs submissionBaseline
  pattern: keep every existing ordering comment and side-effect (gate warning block, note capture/clear, markSubmitted, noteSubmissionDelivered)
  gotcha: pendingIds MUST be read before markSubmitted mutates status (it already is)

- file: src/snapshots.ts
  why: DiffEntry shape (id/title/from/to/editedArchived, optional value after P1.M2.T2.S1); UNANSWERED constant = "(unanswered)" (line ~33, not exported — match on the literal or import if exported); SubmissionCardData {changed, note?}
  pattern: filtered card = { ...diff, changed: userChanged } — spread keeps epoch and any other fields
  gotcha: computeDiff is status-blind (answer signatures only); that's why agent resets appear in diff at all

- file: src/merge.ts:181-193
  why: merge rule 2 — re-ask resets answer→undefined + status 'reasked'; the mechanism producing the phantom diff entry
  gotcha: the reset happens at upsert time (agent), NOT at submit; draft preservation for re-asked ids is DraftStore's existing behavior

- file: src/panel/panel.ts:112-124
  why: DraftStore surface on the panel: getDraft(id), hasDraft?(id), shipDrafts?(ids?) (deletes+returns slots); drafts store itself = src/draft-store.ts
  pattern: optional chaining everywhere (?.) — tests/seams may omit the store

- file: src/delivery.ts
  why: buildSubmission(state, diff, note?) — performs takeSnapshot + bumpEpoch ITSELF (lines ~100–165); derives content "Submitted {k}: ..." and k from diff.changed.length
  gotcha: never snapshot/bump around it; pass the FILTERED card so both content and details.changed agree

- file: src/panel/actions.test.ts
  why: test conventions — seed(specs), makePanel(state, extra?) with stubTheme/requestRender, makeDeps(isIdle) returning {deps, sendMessage}; submit describe block at ~490 with exact side-effect assertions
  pattern: follow test_i_submit_with_pending_snapshots_bumps_and_delivers_once (assert snapshots.length, epoch, sendMessage call args)
  gotcha: DraftStore is imported there (from ../draft-store.js) — pass `drafts: new DraftStore(...)` via makePanel extra args; check how existing tests construct it (grep "drafts" in actions.test.ts) and mirror

- file: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/P1M2T2S1/PRP.md
  why: parallel contract — DiffEntry gains optional value?: string (raw post-change value); do not conflict; the filter here ignores it
  gotcha: if that work lands first, exact-match fixtures may already carry value — new tests should too when asserting full entries
```

### Current Codebase tree (relevant slice)

```bash
src/
  panel/actions.ts        # submit() — EDIT HERE (only function changed)
  panel/actions.test.ts   # ADD regression tests
  panel/panel.ts          # InterrogationPanel + DraftStore interface (read-only)
  draft-store.ts          # DraftStore impl: getDraft/hasDraft/shipDrafts (read-only)
  snapshots.ts            # computeDiff, DiffEntry, UNANSWERED (read-only)
  merge.ts                # rule 2 re-ask reset (read-only context)
  delivery.ts             # buildSubmission side-effect contract (read-only)
```

### Desired Codebase tree

```bash
src/panel/actions.ts        # MODIFIED — submit(): filtered shipDrafts + filtered diff
src/panel/actions.test.ts   # MODIFIED — 3–4 new regression tests (no new files)
```

### Known Gotchas

```ts
// CRITICAL: buildSubmission(state, diff, note) performs takeSnapshot + bumpEpoch
// itself, exactly once. Do NOT add snapshot/bump calls and do NOT reorder
// around it. Passing the filtered card is the ONLY change to the call.

// CRITICAL: pendingIds must be captured BEFORE markSubmitted flips statuses
// (already true in the current code — keep it that way when reordering).

// CRITICAL: keep shipDrafts AFTER buildSubmission (message built from state,
// not drafts — failure-safe per existing comment).

// "(unanswered)" literal: snapshots.ts UNANSWERED const — check whether it is
// exported; prefer importing it if so, else use the literal with a comment.

// The zero-pending early-return must now ALSO consider userChanged: a diff
// of pure agent resets ships nothing (flash + return; held note stays held).

// hasDraft is optional on the interface — use ?.; DraftStore implements it.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: READ src/panel/actions.ts submit() (~295–372) + src/panel/actions.test.ts submit block (~490–560) + grep "drafts" in actions.test.ts for DraftStore wiring
  - CONFIRM: whether UNANSWERED is exported from snapshots.ts; how existing tests attach a DraftStore to the panel

Task 2: MODIFY src/panel/actions.ts submit()
  - REORDER minimally: pendingIds → userChanged filter → early-return guard update → markSubmitted → buildSubmission({...diff, changed: userChanged}) → shipDrafts(pendingIds ∩ hasDraft) → deliverSubmission
  - PRESERVE: gate-warning block, note capture/clear, noteSubmissionDelivered, all existing comments (amend where the comment mentions diff.changed ids)
  - Mode A JSDoc: extend the submit docblock with the BUG-008 contract (drafts ship only with user-shipped ids; agent resets excluded from the delta)

Task 3: ADD regression tests to src/panel/actions.test.ts
  - TEST bug008_draft_of_reasked_question_survives_submit:
    seed q1,q2 → applyAnswer(q1) → submit (epoch 2; baseline snapshot now holds q1 answered)
    → simulate rule-2 re-ask: setStatus(q1,'reasked') + reset answer per merge rule 2 (mirror how tests elsewhere simulate re-ask — grep 'reasked' in the suite; if there's a helper, use it)
    → store draft for q1 ("my elaboration draft") via DraftStore.setDraft (check exact method name on the store)
    → applyAnswer(q2) → submit
    → assert: getDraft('q1') === the draft; sendMessage called once; msg.content does NOT contain "q1: (unanswered)"; msg.details.changed ids === ['q2']; epoch +1 once; snapshots +1 once
  - TEST bug008_zero_user_pending_pure_agent_reset_flashes_and_ships_nothing:
    same setup through the re-ask, NO new answer → submit → footerFlash "nothing to submit", no sendMessage, no epoch bump, draft intact
  - TEST bug008_shipped_draft_destroyed (guard against over-preserving):
    q1 answered WITH a stored draft → submit → getDraft('q1') === undefined (draft ships with the user's shipment)
  - TEST bug008_edited_archived_entry_still_ships (AC-13 guard):
    seed a closed/archived q edited to a new answer (mirror the editedArchived fixture patterns in snapshots/delivery tests) → submit → entry present with to !== "(unanswered)"
  - NAMING: bug008_* prefix; follow existing snake_case test names
  - PLACEMENT: inside the existing `describe("submit — flush pending answers")`

Task 4: RUN validation (below); fix until green
```

### Integration Points

```yaml
NONE:
  - No config, no state.ts, no delivery.ts, no snapshots.ts, no renderers.
  - renderers.ts reads details.card — unchanged shape, fewer/no phantom entries.
  - reconstruction (P1.M5.T1.S1) consumes details.changed — fewer entries is
    strictly more accurate (agent resets were never user data).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # tsc --noEmit — expected: zero errors
```

### Level 2: Unit Tests

```bash
npm test
npx vitest run src/panel/actions.test.ts -v   # targeted
# Expected: all new bug008_* tests pass + zero regressions across the suite
```

### Level 3: Integration (live TUI, optional manual confirmation)

```bash
pi -e .
# upsert q1,q2 → answer q1 + text draft → ctrl+s → agent re-asks q1 (rule 2)
# → answer q2 → ctrl+s → delta shows only q2; reopen q1 → draft still present
```

### Level 4: Regression sweep

```bash
npx vitest run   # full suite — submit, snapshots, delivery, panel suites
# Specifically confirm: test_i_submit_with_pending_snapshots_bumps_and_delivers_once,
# test_i_submit_flush_marks_pending_submitted_*, test_j_zero_pending tests
# still pass unchanged (they exercise no re-ask, so the filter is inert there).
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean
- [ ] `npm test` all green, zero regressions

### Feature Validation (BUG-008 exact)

- [ ] Re-asked question's draft survives a submit that ships other questions
- [ ] Model-visible delta (content AND details.changed) contains no agent-reset `(unanswered)` entries
- [ ] Shipped drafts ARE destroyed (no over-preservation)
- [ ] editedArchived entries still ship (AC-13)
- [ ] Zero user-pending submit: flash, no side effects, held note stays held (R3)
- [ ] Exactly one snapshot + one epoch bump + one sendMessage per real submit

### Code Quality Validation

- [ ] Only `submit()` changed in actions.ts; only tests added in actions.test.ts
- [ ] Existing comments/ordering contracts updated rather than deleted
- [ ] Mode A JSDoc on the new contract
- [ ] No mocks beyond the suite's existing makePanel/makeDeps conventions

## Anti-Patterns to Avoid

- ❌ Shipping drafts for `diff.changed` ids (the bug itself)
- ❌ Adding snapshot/epoch-bump calls around `buildSubmission` (it owns them)
- ❌ Filtering by `to === "(unanswered)"` ALONE (would drop a genuine pending edit that answers then clears — the `pendingIds.includes(e.id) ||` disjunct is load-bearing)
- ❌ Moving `pendingIds` capture after `markSubmitted`
- ❌ Changing buildSubmission/delivery.ts to do the filtering (submit owns the ship-set knowledge)
- ❌ Breaking the R3 held-note contract on the new zero-user-pending path

---

**Confidence Score**: 9/10 — the fix is a two-line semantic change inside one function whose full current code, contracts, and test harness are quoted/anchored above; the only verification point (Task 1) is how existing tests attach a DraftStore and simulate a rule-2 re-ask.

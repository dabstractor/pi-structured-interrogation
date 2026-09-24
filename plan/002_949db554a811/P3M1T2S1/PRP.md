---
name: "P3.M1.T2.S1 — Apply the unanswered gate to the questions-upserted suspended-reopen path (SURFACE-001 / FR-D6)"
description: "handleUpserted (src/panel/panel.ts:1466) reopens a suspended panel on EVERY questions-upserted event with no unanswered filter — and state.ts upsertQuestion emits the event even for description-only edits of existing answered questions, so such an edit over a fully-answered set pops the panel (SURFACE-001 / FR-D6 violation). This PRP adds the unanswered (open/reasked) gate to the suspended branch ONLY, using the SAME shared predicate as P3.M1.T1.S1 (nextUnanswered from src/panel/actions.ts — one helper, no duplication), plus a Mode A JSDoc with the same allow-list rationale as maybeAutoOpen. The open-phase branch (invalidate/stuck-open remount) stays ungated — it is a refresh of an already-open surface, not a surface act. Output consumed by P3.M1.T3.S1 assertions."
---

## Goal

**Feature Goal**: FR-D6 / SURFACE-001 (PRD h2.37, h2.39, h2.58): "Model upserts while panel suspended → panel reopens only when the upsert leaves unanswered questions; a description-only edit over an answered set surfaces nothing (panel stays suspended; widget unchanged)."

**Deliverable**: Gated suspended-reopen in `handleUpserted` (`src/panel/panel.ts`) + Mode A JSDoc + new unit tests in `src/panel/panel.test.ts` (including the explicit contract test: answered set + description-only upsert while suspended → no open).

**Success Definition**: suspended-reopen fires only when `nextUnanswered(state.orderedQuestions(), -1) !== undefined` (open/reasked statuses) post-upsert; description-only edits over an answered set leave the panel suspended and the widget untouched; the open-phase invalidate path and all existing suspended-reopen tests behave exactly as before; typecheck + full vitest suite green (tree-nav-repro exceptions owned by P3.M1.T3.S1 noted, not fixed here).

## User Persona

**Target User**: Interrogation user who suspended the panel (esc) and is working in the chat/prompt box.

**Use Case**: The agent edits a question's wording (description-only upsert) while every question is answered. Today the panel pops over the prompt box anyway — a SURFACE-001 violation of the same family as the read-pop data-loss trap (pi's `custom()` snapshot/restore makes every unplanned pop a potential editor-text loss).

**User Journey**: user suspends after answering everything pending → agent upserts a description tweak → NOTHING visibly changes (widget line keeps its counts; panel stays suspended) → later the agent re-asks or adds a question (leaving open/reasked) → panel reopens focused on the first upserted active question.

**Pain Points Addressed**: unplanned panel pops stealing the prompt box mid-turn; surfacing that doesn't correspond to new work.

## Why

- PRD h2.37 (surfacing allow-list): "an agent upsert that leaves unanswered questions … a description-only edit while everything is answered surfaces nothing … The suspended-reopen path (`handleUpserted`) carries the same unanswered gate."
- PRD h2.39: "Model upserts while panel suspended → panel reopens only when the upsert leaves unanswered questions (upsert-implies-visibility, gated — SURFACE-001); description-only edits over an answered set surface nothing."
- PRD h2.58 SURFACE-001 pin: same wording; root cause family found by the tree-nav characterization tests.
- Root-cause fact (verified): `state.upsertQuestion` (src/state.ts:329-343) emits `questions-upserted` unconditionally — including wholesale replace of an existing answered question (description-only edit) — so today's ungated suspended branch WILL pop on such edits.

## What

### Behavior contract

1. **Scope: suspended branch only.** In `handleUpserted` (panel.ts:1466), the `phase === "suspended" && activePi !== undefined && lastOpts !== undefined` branch gains a guard: reopen ONLY if an unanswered (status `open` or `reasked`) question exists post-upsert. The open-phase branch (`stuckOpen()` remount and `currentPanel?.invalidate()`) is NOT gated — the panel is already open; invalidating is a content refresh, never a surface act.
2. **Shared predicate — do not duplicate.** Use the SAME helper P3.M1.T1.S1 specifies for maybeAutoOpen gate (2): `nextUnanswered` from `src/panel/actions.ts:106` with `UNANSWERED_STATUSES = ["open","reasked"]` (actions.ts:85). Gate: `if (nextUnanswered(lastOpts.state.orderedQuestions(), -1) === undefined) return;` before the `openPanel` call. `nextUnanswered` is likely already imported in panel.ts (T1.S1 adds it for maybeAutoOpen; verify/keep one import). Do NOT use `hasResumableQuestions` (suspend.ts:66 — counts answered/submitted too) or `firstActiveUpsertedId`/`ACTIVE_STATUSES` (RESUMABLE_STATUSES — same problem) for the gate.
3. **Focus semantics unchanged.** When the gate passes, the existing `openPanel(activePi, { ...lastOpts, focusQuestionId: firstActiveUpsertedId(lastOpts.state, ids) })` stays verbatim — `firstActiveUpsertedId` is the FOCUS ladder (h2.37 first upserted currently-active question), not the gate.
4. **Explicit contract test (from item spec)**: answered set (all questions status `answered`) + description-only upsert (re-upsert an existing answered id with an edited description, caller-supplied status `answered` — state.ts preserves status on EXISTING ids) while suspended → NO open (`custom` call count unchanged, `host.isSuspended()` still true, widget line unchanged).
5. **Mode A docs**: JSDoc on `handleUpserted` stating the same allow-list rationale as maybeAutoOpen: the panel opens only via `/interrogate`, an agent upsert leaving unanswered questions, or `{reopen:true}`; reads never surface; description-only edits over an answered set surface nothing; cite SURFACE-001 and the empty-box-after-esc data-loss trap; note the open-phase branch is ungated because an open panel is a refresh, not a surface.

### Success Criteria

- [ ] Suspended + upsert leaving an `open` or `reasked` question → panel reopens, focused on the first upserted active id (existing behavior preserved; existing test at panel.test.ts:645 stays green).
- [ ] Suspended + all questions `answered`/`submitted` + description-only upsert (existing id) → NO open; host stays suspended; widget line unchanged.
- [ ] Suspended + upsert that RE-ASKS a question (`reasked` status) → panel reopens (reasked counts as unanswered).
- [ ] Open-phase invalidate/stuck-open paths unchanged and tests green (panel.test.ts `test_upsert_while_open_invalidates_single_panel`).
- [ ] One shared predicate: `nextUnanswered` imported once from `src/panel/actions.js`; no local re-implementation.
- [ ] Mode A JSDoc present with SURFACE-001 rationale.

## All Needed Context

### Context Completeness Check

Validated: exact current handler body and line anchors, why the gate is semantically necessary (state.ts emits on description-only edits), the shared predicate's location/signature, the pitfall predicates to avoid, the existing suspended-reopen test (and why it stays green — new ids are force-opened by state.ts), the description-only-upsert simulation recipe, and downstream ownership boundaries (T3.S1 owns tree-nav flips; T1.S1 owns maybeAutoOpen; P3.M2 owns reconstruction).

### Documentation & References

```yaml
- file: src/panel/panel.ts
  why: handleUpserted (:1466 JSDoc, body :1467-1491) — the modification site; module header comment at :16 mentions the suspended-reopen behavior (update the wording if it claims unconditional reopen); subscription lifecycle: armed in openPanel (:1654-1656), disarmed in resetHostRecord (:1505-1506), re-armed in retargetHostState (:1544-1546)
  pattern: insert the gate as the first statement of the suspended branch, before openPanel
  gotcha: the stuck-open remount inside the OPEN branch must remain ungated; do not touch subscription arming/disarming

- file: src/panel/actions.ts
  why: nextUnanswered (:106) and UNANSWERED_STATUSES (:85) — the SHARED predicate (same one P3.M1.T1.S1's maybeAutoOpen gate uses); nextUnanswered(ordered, -1) scans from index 0
  gotcha: do NOT use hasResumableQuestions (suspend.ts:66) or ACTIVE_STATUSES/firstActiveUpsertedId for the gate — both include answered/submitted

- file: src/state.ts
  why: upsertQuestion (:329-343) — NEW ids are forced to status "open" (why the existing reopen test stays green); EXISTING ids keep caller-supplied status (the description-only-edit recipe); emits questions-upserted unconditionally on both
  gotcha: simulating a description-only edit over an answered set requires re-upserting an EXISTING id with status "answered" and a changed description/rev — upserting a new id cannot test this (it becomes open)

- file: src/panel/panel.test.ts
  why: existing harness — test_upsert_while_suspended_reopens (:645, uses createPanelHost/makeMockPi/openPanel/firstCall(mock).done(null)/flush()), test_upsert_while_open_invalidates_single_panel (:679)
  pattern: makeMockPi(), optsFor(state), firstCall(mock).done(null) to suspend, flush() microtasks, mock.custom call counts

- file: plan/002_949db554a811/P3M1T1S1/PRP.md
  why: the sibling maybeAutoOpen PRP — its gate (2) defines the SAME nextUnanswered predicate; consume it, never re-define
  gotcha: T1.S1 may already import nextUnanswered into panel.ts (:52) — keep the single import

- file: plan/002_949db554a811/architecture/surfacing-remote-seams.md
  why: §3 — authoritative seam map for handleUpserted (subscription arming, branch semantics); §9-10 test-flip ledger (what T3.S1 owns)

- file: plan/002_949db554a811/P3M1T2S1/research/findings.md
  why: this item's research notes (anchors, predicate choice, emission semantics, test recipes)
```

### Current Codebase tree (relevant slice)

```bash
src/panel/panel.ts        # MODIFY — gate the suspended branch of handleUpserted + JSDoc
src/panel/panel.test.ts   # MODIFY — add gate tests (description-only no-open, reasked opens)
```

### Desired Codebase tree with file responsibilities

```bash
src/panel/panel.ts        # handleUpserted: suspended-reopen gated on nextUnanswered ≠ undefined; Mode A JSDoc
src/panel/panel.test.ts   # contract tests for the gate
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: state.ts upsertQuestion emits "questions-upserted" for EVERY upsert,
// including wholesale replace of an existing ANSWERED question (description-only
// edit) — that is exactly why this gate is needed.
// GOTCHA: NEW ids are force-set to status "open" (state.ts:337) — a test for the
// no-open case MUST re-upsert an EXISTING answered id, not add a new question.
// GOTCHA: never launch a live pi TUI in tests (AUTOMATION-POLICY) — use the
// makeMockPi handler-map pattern already in panel.test.ts.
// GOTCHA: gate the suspended branch only; the open-phase invalidate is a refresh
// of an already-open surface, never a surfacing act (PRD allow-list).
// GOTCHA: keep focus logic (firstActiveUpsertedId) untouched — it is the focus
// ladder, not the gate.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: VERIFY the shared predicate import
  - CHECK src/panel/panel.ts imports: nextUnanswered from "./actions.js" (P3.M1.T1.S1 adds it for maybeAutoOpen; if absent, add `import { nextUnanswered } from "./actions.js";`)
  - NO local re-implementation — one helper shared with maybeAutoOpen's gate

Task 2: MODIFY src/panel/panel.ts — gate handleUpserted's suspended branch
  - IN the `phase === "suspended" && activePi !== undefined && lastOpts !== undefined` branch, INSERT as the first check:
    `if (nextUnanswered(lastOpts.state.orderedQuestions(), -1) === undefined) return; // SURFACE-001`
  - PRESERVE verbatim: the open-phase branch (stuckOpen remount + currentPanel?.invalidate()), the openPanel call and its focusQuestionId (firstActiveUpsertedId), subscription arming/disarming (:1505, :1544, :1654)
  - JSDOC (Mode A, replace/extend the one-liner at :1466): suspended-reopen is on the SURFACE-001 allow-list — the panel opens only via /interrogate, an agent upsert leaving unanswered (open/reasked) questions, or {reopen:true}; a description-only edit over an answered set surfaces nothing (panel stays suspended, widget unchanged); rationale: reads/edits are pull, never surfaces — unplanned pops trap the editor (empty-box-after-esc); note the open-phase branch is ungated because an open panel is refreshed in place, not surfaced

Task 3: MODIFY src/panel/panel.test.ts — add gate tests (in the "upsert + state integration" describe, near :645)
  - ADD test_upsert_description_only_over_answered_set_does_not_reopen:
    state with q1 answered (upsert new q1, then setStatus("q1","answered")); openPanel; done(null) suspend; assert custom called once + host.isSuspended(); then `state.upsertQuestion(choiceQ("q1", { status: "answered", description: "edited wording", rev: 2 }))` (existing id — status preserved, description-only edit); await flush(); assert mock.custom STILL called once and host.isSuspended() true
  - ADD test_upsert_reasked_reopens (reasked counts as unanswered):
    suspended with all answered; re-upsert existing q1 with status "reasked"; assert custom called twice, host.isOpen() true
  - ADD test_upsert_new_question_over_answered_set_reopens (open counts):
    suspended with q1 answered; upsert NEW q2 (forced open by state.ts); assert custom called twice
  - KEEP test_upsert_while_suspended_reopens (:645) and test_upsert_while_open_invalidates_single_panel (:679) green, unmodified
  - NAMING: test_{scenario}_{expected} per file convention

Task 4: AUDIT other questions-upserted consumers
  - grep -n "questions-upserted" src/ — state tests, guards tests (off/on counting), tool.test.ts event capture: all pure-data assertions, no surfacing claims — expect no changes; fix ONLY if one asserts an ungated suspended reopen on an all-answered set

Task 5: VALIDATE
  - npm run typecheck
  - npx vitest run src/panel/panel.test.ts -v
  - npx vitest run   # note tree-nav-repro failures as owned by P3.M1.T3.S1 (expected after T1.S1 lands), do not flip
```

### Implementation Patterns & Key Details

```ts
// panel.ts — the gated suspended branch (shape):
function handleUpserted(ids: string[]): void {
  if (phase === "open") {
    // ... unchanged: stuckOpen remount / currentPanel?.invalidate()
    return;
  }
  if (phase === "suspended" && activePi !== undefined && lastOpts !== undefined) {
    // SURFACE-001 / FR-D6: reopen only when the upsert leaves unanswered
    // (open/reasked) questions — a description-only edit over an answered
    // set surfaces nothing. Same predicate as maybeAutoOpen (shared helper).
    if (nextUnanswered(lastOpts.state.orderedQuestions(), -1) === undefined) return;
    openPanel(activePi, {
      ...lastOpts,
      focusQuestionId: firstActiveUpsertedId(lastOpts.state, ids), // focus ladder, NOT the gate
    });
  }
}
```

### Integration Points

```yaml
NONE new — no schema/config/state-model changes:
  - UPSTREAM P3.M1.T1.S1: defines the shared nextUnanswered-based predicate usage in maybeAutoOpen; this item imports the same helper (one definition in actions.ts)
  - DOWNSTREAM P3.M1.T3.S1: its AC-15/tree-nav scripted assertions assume this suspended-reopen gate ("reopens only when the upsert leaves unanswered questions")
  - OUT OF SCOPE: maybeAutoOpen itself (T1.S1), reconstruction openPanel (P3.M2), {reopen:true} / onReopen hasResumableQuestions gate (unchanged by design)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck    # expect clean
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/panel.test.ts -v
npx vitest run src/panel/ -v
npx vitest run    # full suite — tree-nav-repro.test.ts :199/:208 exceptions are P3.M1.T3.S1's (post-T1.S1); note in PR, don't flip
```

### Level 3: Behavioral spot-checks

```bash
npx vitest run src/panel/panel.test.ts -t "upsert" -v
grep -n "questions-upserted" src/ -r   # every consumer audited; only panel.ts handleUpserted is a surfacing consumer
```

## Final Validation Checklist

- [ ] `npm run typecheck` clean; panel tests + full suite green (documented tree-nav-repro exceptions only).
- [ ] Explicit contract test passes: answered set + description-only upsert while suspended → no open, host stays suspended, widget unchanged.
- [ ] Reasked and open upserts still reopen; existing reopen/open-invalidate tests unmodified and green.
- [ ] One shared `nextUnanswered` helper; no duplicated predicate.
- [ ] Mode A JSDoc with SURFACE-001 allow-list rationale.
- [ ] No changes to subscription lifecycle, focus ladder, maybeAutoOpen, reconstruction, or spec files.

## Anti-Patterns to Avoid

- ❌ Don't gate the open-phase invalidate/stuck-open branch — it's a refresh, not a surface.
- ❌ Don't use hasResumableQuestions / ACTIVE_STATUSES for the gate — answered/submitted must not count.
- ❌ Don't duplicate the predicate inline — import nextUnanswered (shared with T1.S1).
- ❌ Don't flip tree-nav-repro.test.ts assertions (P3.M1.T3.S1 owns them) or touch maybeAutoOpen/reconstruction (other items).
- ❌ Don't test the no-open case with a NEW question id — state.ts forces new ids to "open", so it would still (correctly) reopen.

---
name: "P1.M2.T1.S2 — writeInEnter and stageText elaboration-save gates include closed edits (BUG-003, seams 2 & 3)"
description: "Two one-token gate widenings: (a) writeInEnter's FR-18 gate (src/panel/actions.ts:430) adds `|| status === \"closed\"` to the answered/submitted condition; (b) stageText's gate (src/panel/panel.ts:863) adds `|| q.status === \"closed\"` while KEEPING the `q.answer !== undefined` conjunct. The write-in byte-identical no-op ordering stays intact (it already covers closed and excludes reasked), so same-value write-in re-commits on closed stay inert and rule-1 re-confirms stay seam-free. TDD failing-first: closed-edit cases in src/panel/ripple-confirm.test.ts write-in describe (:557) and src/panel/panel.test.ts elaboration describe (:2595 pattern) — modal raised, esc = zero change, enter = applied. Docblocks at both gates updated (Mode A). The acceptOptionIndex seam is P1.M2.T1.S1 — NOT here."
---

## Goal

**Feature Goal**: Eliminate the two remaining BUG-003 bypasses — a write-in commit on a CLOSED (archived) question and an elaboration text-save on a CLOSED question both route through the FR-18 / Q39=B keep/cancel modal when ripple victims exist, instead of silently mooting answered dependents.

**Deliverable**: Modified `src/panel/actions.ts` (writeInEnter gate at :430 + its FR-18 comment block), modified `src/panel/panel.ts` (stageText gate at :856-871 comment block), new closed-edit tests in `src/panel/ripple-confirm.test.ts` (write-in describe) and `src/panel/panel.test.ts` (elaboration pattern), optional wording extension of the FR-18 decisions.md pin from P1.M2.T1.S1.

**Success Definition**: `npm test` + `npm run typecheck` green; both PRD BUG-003 sibling repros pass (closed db + dependent answered scale): write-in 'mysql' commit raises `confirmMode.kind === "writein"` with victims ["q2"], esc = zero state change, enter = q1 `{value:"mysql", custom:true}` + q2 moot; elaboration save on closed raises `kind === "text"`, esc = no draft, enter = draft saved with answer untouched. All stay-green pins hold: existing write-in modal tests, elaboration modal test, `test_h_accept_on_moot_and_withdrawn_is_noop`, and the BUG-001 reasked re-confirm tests.

## User Persona

**Target User**: TUI user revisiting an archived question (FR-2: "answers editable even archived", AC-13).

**Use Case**: (a) The 'db' question was answered postgres and closed by the close pass; the user opens the ✎ Other row and types 'mysql' — a different value that invalidates the dependent 'scale' answer. (b) Same closed question, the user adds/edits an elaboration draft (ctrl+t, enter) whose ripple would moot the dependent.

**User Journey**: navigate to the closed q1 → enter write-in duty / elaboration duty → type → enter → "⚠ Invalidates … enter=keep, esc=cancel" modal (instead of the old silent apply) → esc restores exactly, or enter commits with dependents mooted knowingly.

**Pain Points Addressed**: PRD h2.2/h3.2 BUG-003: "Same bypass on the write-in commit path (actions.ts:392) and the elaboration-save path (panel.ts:863)" — real user answers destroyed with no confirmation; the user-worded Q39=B UX violated for a whole class of edits.

## Why

- PRD h2.5 recommendation (verbatim): "Extend the FR-18 ripple-seam status gate (acceptOptionIndex:302, writeInEnter:392, stageText in panel.ts:863) to fire for ANY edited question carrying a recorded answer, including `closed`." P1.M2.T1.S1 lands the acceptOptionIndex third; this item lands the remaining two — after both, all three FR-18 entry points cover closed edits.
- A closed question still carries its recorded answer; a different-value write-in or a draft re-save can invalidate dependents exactly like an answered/submitted edit — the seam's premise holds identically, and the seam machinery (`beginWriteInConfirm`/`beginTextConfirm`, `applyWriteInConfirm`/`applyTextConfirm`, `rippleVictims`) needs ZERO logic change.
- Completes BUG-003 so P1.M3.T2.S1 (README sweep) and P1.M2.T2 (moot reasons shown in the modal's aftermath) build on all three seams being correct.

## What

### 1. The write-in gate — `src/panel/actions.ts` writeInEnter (~:430)

Current:

```ts
const status = q.status;
if ((status === "answered" || status === "submitted") && rippleVictims(panel, q.id).length > 0) {
  beginWriteInConfirm(panel, text);
  return true; // consumed — nothing applied yet
}
```

Change the condition to `(status === "answered" || status === "submitted" || status === "closed")`. Same status-list form P1.M2.T1.S1 uses — NOT answer-presence — so the BUG-001 `reasked` re-confirm path stays seam-free by construction.

**Ordering guarantees that MUST hold (assert via existing pins, no new machinery):**
- The ANSWER-PIN-001 byte-identical no-op (~actions.ts:400-425) runs BEFORE this gate and already treats closed as settled (`q.status !== "reasked"` exclusion only carves out reasked) → a byte-identical write-in re-commit on closed stays an inert advance-and-blur no-op. Do NOT reorder or modify that block.
- The KIND-PRESERVING reasked re-confirm tail below the gate is untouched.
- `maybeAutoSubmit` at the direct-commit exit is untouched (closed → `wasUnanswered: false`, same as answered/submitted — correct AUTOSUBMIT-003 context).
- `applyWriteInConfirm` (ripple-confirm.ts) commits `{value: text, custom: true, at}` — closed→answered(pending) re-mark is satisfied by the existing applyAnswer primitive; victims moot instantly via its evaluateDependsOn.

### 2. The elaboration gate — `src/panel/panel.ts` stageText (~:856-871)

Current:

```ts
if (
  q !== undefined &&
  q.answer !== undefined &&
  (q.status === "answered" || q.status === "submitted") &&
  rippleVictims(this, id).length > 0
) {
```

Change the status line to `(q.status === "answered" || q.status === "submitted" || q.status === "closed")`. **KEEP the `q.answer !== undefined` conjunct** — unlike writeInEnter, stageText has no earlier byte-identical no-op; answer-presence is what distinguishes a real edit-of-record from a first-time draft on a question that merely happens to be closed with… (note: closed always carries an answer, so the conjunct is belt-and-braces here, but it documents intent and matches the seam's design; the item contract explicitly requires keeping it).

Both stageText callers — `saveTextDraft` (elaboration enter, ~:833) and `exitTextField` (ctrl+t / double-esc editor-exit, ~:846) — inherit; no separate edits.

### 3. Doc updates (Mode A)

- `src/panel/actions.ts` FR-18 comment block above the writeInEnter gate (~:425-429, currently "a write-in commit on an answered/submitted question with ripple victims…"): extend to "answered/submitted/closed" with a sentence citing BUG-003 (closed edits carry recorded answers; different-text commits invalidate dependents identically; the byte-identical no-op above keeps same-value re-commits inert and the reasked exclusion keeps re-confirms seam-free).
- `src/panel/panel.ts` stageText docblock (~:852-856, "FR-18 text gate first (re-saving a draft on an answered/submitted question…") and the gate-site comment: same one-word extension plus a sentence.
- `spec/decisions.md`: the FR-18 closed-edit pin landed by P1.M2.T1.S1 covers all three seams — read its tail; only EXTEND wording if it names the accept seam alone (add "…and the writeInEnter commit / stageText elaboration-save seams identically"). Do not create a second pin.

### 4. Tests — TDD, write failing-first

Fixture (PRD BUG-003 repro, shared shape): q1 'db' options [sqlite, postgres], answer postgres via `state.applyAnswer` then `state.setStatus("q1", "closed")`; q2 'scale' answered pending with `dependsOn: [{id: "db", equals: "postgres"}]` — so `rippleVictims` = ["q2"].

In `src/panel/ripple-confirm.test.ts`, inside `describe("ripple confirm — write-in commit gate (h2.35, P1.M2.T2.S2)")` (:557), using the existing `enterWriteInDuty(handle, "mysql")` / `makePanel` / `seedRippleChain`-style helpers (build the closed fixture the way the neighbors build theirs; if `seed*` helpers can't carry closed, applyAnswer + setStatus before makePanel):

1. `test_wi_commit_on_closed_with_victims_defers_into_modal` — write-in enter on closed q1 → `confirmMode.kind === "writein"`, `questionId === "q1"`, `text === "mysql"`, `victims` contains "q2"; q1 answer still "postgres" (no custom), q2 still "answered", currentId/duty/focus unchanged.
2. `test_wi_closed_esc_cancels_zero_state_change` — esc → confirmMode cleared, answers/statuses byte-identical, editor re-seeded (cancelWriteInConfirm semantics — mirror the existing esc assertions in the answered write-in test).
3. `test_wi_closed_confirm_enter_applies_and_moots_dependent` — enter → `state.getQuestion("q1").answer` = `{value: "mysql", custom: true}` (assert custom === true), status "answered" (FR-2 re-mark pending), q2 status "moot" (reason string is P1.M2.T2's scope — assert status only), advanced, textDuty reset.
4. `test_wi_closed_byte_identical_recommit_stays_inert` (stay-green, explicit): closed q1 carrying custom write-in "mysql"; re-enter "mysql" → consumed, advanced, NO confirmMode, NO answer.at change — the no-op block's settled-statuses contract.

In `src/panel/panel.test.ts`, mirroring `elaboration_save_on_answered_with_ripple_victims_routes_through_FR18_modal` (~:2595) with `makeDutyPanel` + CTRL_T:

5. `elaboration_save_on_closed_with_ripple_victims_routes_through_FR18_modal` — closed q1 fixture; CTRL_T → textDuty "elaboration"; setText("fresh context"); "\r" → `confirmMode.kind === "text"`, `draftTextFor("q1")` undefined; ESCAPE → confirmMode null, draft still undefined, q1 answer untouched, q2 "answered"; retry "\r" then enter → draft saved (`draftTextFor("q1") === "fresh context"`), focus "options", `q1.answer.value === "postgres"` unchanged, `answer.text` undefined, q2 moot (applyTextConfirm path mutes victims via its evaluateDependsOn — assert q2 status "moot"; if the current applyTextConfirm does not moot (it never applies an answer), assert q2 still "answered" and leave the moot to the write-in/option seams — VERIFY against the actual applyTextConfirm implementation before pinning).

Stay-green (run, do not modify): existing write-in modal tests (:557 describe), the panel.test.ts elaboration modal test (:2595), `test_h_accept_on_moot_and_withdrawn_is_noop` (actions.test.ts:316), all BUG-001 reasked re-confirm tests.

### 5. Explicitly OUT of scope

- acceptOptionIndex/digit gate — P1.M2.T1.S1 (in flight).
- Moot reason rendering — P1.M2.T2.
- README sweep — P1.M3.T2.S1.
- Any change to `rippleVictims`, `beginWriteInConfirm`/`beginTextConfirm`, `applyWriteInConfirm`/`applyTextConfirm`, the no-op blocks, or `commitTextDraft`.

### Success Criteria

- [ ] Closed write-in commit with victims defers into the modal; esc = zero change; enter = {value, custom:true} applied + dependent mooted + advance
- [ ] Closed elaboration save with victims defers; esc = no draft; enter = draft saved, answer untouched
- [ ] Byte-identical write-in re-commit on closed stays inert (no modal)
- [ ] Reasked re-confirm stays seam-free on both paths (existing BUG-001 pins green, unmodified)
- [ ] Zero-victim closed edits apply directly (createRippleConfirm semantics — no spurious modal; covered by S1's ripple-confirm test pattern)
- [ ] Docblocks updated; decisions.md pin covers all three seams; `npm test` + `npm run typecheck` green

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets: both exact gate sites with current code, the ordering constraints that keep the no-op and reasked paths safe, the shared fixture shape from the PRD repro, the test files/describes/helpers with neighbor line numbers, the modal apply/cancel semantics (which function commits what), and the scope fence against the sibling item. No guessing.

### Documentation & References

```yaml
- file: src/panel/actions.ts
  why: writeInEnter — the byte-identical no-op block (~:396-425, must run BEFORE and unmodified), the gate (~:426-433, THE edit: add `|| status === "closed"`), the kind-preserving reconfirm tail, maybeAutoSubmit exit
  pattern: one-token condition change + comment block extension; touch NOTHING else in the function
  gotcha: status-list form, never answer-presence — reasked must stay seam-free by construction

- file: src/panel/panel.ts
  why: stageText (~:852-871, THE edit: add `|| q.status === "closed"` to the status line, KEEP `q.answer !== undefined` conjunct), saveTextDraft (~:833) and exitTextField (~:846) — both callers inherit
  gotcha: do not touch commitTextDraft or the modal key routing at :770-771

- file: src/panel/ripple-confirm.ts
  why: beginWriteInConfirm/beginTextConfirm (modal stash shape: kind, questionId, text, victims, priorCursorIndex), applyWriteInConfirm ({value, custom:true, at} + evaluateDependsOn + advance + blur), applyTextConfirm (commitTextDraft with stashed id — draft only, never applyAnswer), cancel* paths, rippleVictims, header comment :30-34 ("Open/reasked edits never reach the seam")
  gotcha: NO logic change here — the header comment already says the accept path gates on answered/submitted; extend that clause to name closed if S1 hasn't already

- file: src/panel/ripple-confirm.test.ts
  why: write-in describe :557 — enterWriteInDuty/makePanel/seed helpers, modal-stash + esc + enter assertion conventions, existing answered fixtures to mirror

- file: src/panel/panel.test.ts
  why: elaboration_save_on_answered_with_ripple_victims_routes_through_FR18_modal (~:2595) — the EXACT pattern for the closed elaboration test (makeDutyPanel, CTRL_T, setText, "\r", esc, retry, "\r" confirm, draftTextFor/focus/answer assertions)

- file: src/panel/actions.test.ts
  why: stay-green pins — :316 moot/withdrawn no-op, :422/:444/:467 reasked reconfirm, :496 closed same-value; HOW closed fixtures are built (applyAnswer then setStatus, per the FR-35/AC-13 fixtures)

- file: spec/decisions.md
  why: FR-18 closed-edit pin landed by P1.M2.T1.S1 — extend wording only if it names the accept seam alone (read tail for entry format first)

- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/prd_snapshot.md (h2.2/h3.2 BUG-003, h2.5 rec 3)
  why: defect definition, both named bypass paths, recommended gate extension
- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/P1M2T1S1/PRP.md
  why: sibling contract — status-list widening on acceptOptionIndex; do NOT duplicate its tests or rewrite its decisions.md pin
```

### Current Codebase tree

```bash
src/panel/ actions.ts panel.ts ripple-confirm.ts short-view.ts overview.ts layout.ts keys.ts (+ *.test.ts)
src/ ...state, snapshots, delivery, lifecycle, etc. (all green, 1265+ tests)
```

### Desired Codebase tree

```bash
src/panel/actions.ts           # MODIFIED — writeInEnter gate + FR-18 comment
src/panel/panel.ts             # MODIFIED — stageText gate + comment
src/panel/ripple-confirm.test.ts  # MODIFIED — closed write-in cases (tests 1-4)
src/panel/panel.test.ts        # MODIFIED — closed elaboration case (test 5)
spec/decisions.md              # OPTIONAL wording extension of the S1 pin
```

### Known Gotchas of our codebase & Library Quirks

```ts
// The write-in no-op's two-clause match: `recorded.custom === true || q.type === "text"` — an
//   OPTION answer byte-equal to the buffer is a different-KIND commit and must NOT no-op.
// custom is checked with `=== true` everywhere — never write custom:false; absent means plain.
// answer signature in diffs is value+text only (never `at`) — re-commits are diff-invisible.
// Closed fixtures: state.applyAnswer(...) then state.setStatus(id, "closed") BEFORE makePanel.
// ESM: relative imports use ".js" suffix.
// The modal stashes the FULL BFS victim closure, not the direct dependents.
// applyTextConfirm NEVER calls applyAnswer — text saves write draftSlots/DraftStore only.
```

## Implementation Blueprint

### Data models and structure

None — no type changes. `RippleConfirmState` already supports `kind: "writein" | "text"`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: PREREQUISITE CHECK
  - Read src/panel/actions.ts writeInEnter and src/panel/panel.ts stageText as they exist NOW
    (P1.M2.T1.S1 may have landed in parallel — line numbers may have drifted; locate by the
    `answered" || ... "submitted` conditions + rippleVictims call, not by line number).
  - Confirm S1's decisions.md pin exists; plan wording extension only if it is accept-only.

Task 1: TDD FAILING-FIRST — add tests 1-4 to src/panel/ripple-confirm.test.ts (closed fixture:
  applyAnswer postgres + setStatus closed; enterWriteInDuty(handle, "mysql"); "\r" → modal)
  and test 5 to src/panel/panel.test.ts (CTRL_T elaboration on closed). Run: npx vitest run
  src/panel/ripple-confirm.test.ts src/panel/panel.test.ts — expect exactly the new cases red.

Task 2: WIDEN writeInEnter gate in src/panel/actions.ts (add `|| status === "closed"`); extend
  the FR-18 comment block above it (Mode A, cite BUG-003; note no-op ordering + reasked safety).

Task 3: WIDEN stageText gate in src/panel/panel.ts (add `|| q.status === "closed"`; KEEP
  q.answer conjunct); extend stageText docblock + gate comment.

Task 4: VERIFY stay-green: full npm test + npm run typecheck; confirm the pinned neighbors
  (actions.test.ts :316/:422/:444/:467/:496, ripple-confirm.test.ts :557 describe, panel.test.ts
  :2595) pass UNMODIFIED. Extend spec/decisions.md pin wording if needed.
```

### Implementation Patterns & Key Details

```ts
// actions.ts writeInEnter — AFTER the byte-identical no-op and BEFORE the reconfirm tail:
const status = q.status;
// FR-18 / h2.35 (+ BUG-003): closed (archived) questions carry recorded answers; a
// different-text write-in commit invalidates dependents exactly like answered/submitted
// edits, so it routes through the same keep/cancel modal. The byte-identical no-op above
// keeps same-value re-commits on closed inert; the reasked exclusion keeps rule-1
// re-confirms seam-free by construction.
if ((status === "answered" || status === "submitted" || status === "closed") && rippleVictims(panel, q.id).length > 0) {
  beginWriteInConfirm(panel, text);
  return true; // consumed — nothing applied yet
}

// panel.ts stageText — keep every existing conjunct, widen only the status list:
if (
  q !== undefined &&
  q.answer !== undefined &&
  (q.status === "answered" || q.status === "submitted" || q.status === "closed") && // BUG-003: closed edits gate too
  rippleVictims(this, id).length > 0
) {
  beginTextConfirm(this, text);
  return; // deferred — applyTextConfirm runs on confirm-enter
}
```

### Integration Points

```yaml
NO API CHANGES: both edits are internal condition widenings; consumers (keys.ts modal routing,
  renderers reading panel.confirmMode, lifecycle) need nothing.
SIBLING (S1): acceptOptionIndex already widened — all three FR-18 entry points (choice accept/
  digit, write-in commit, elaboration save) then cover closed edits; BUG-003 fully closed.
DOWNSTREAM: P1.M2.T2 (moot reasons) will make the modal's aftermath show h2.29 reasons;
  P1.M3.T2.S1 README sweep documents the completed behavior.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx tsc --noEmit                       # npm run typecheck
# Expected: zero errors.
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/panel/ripple-confirm.test.ts src/panel/panel.test.ts -v
npm test                               # full suite
# Expected: new closed-edit cases green; ALL pre-existing tests unmodified and green.
```

### Level 3: Integration Testing (System Validation)

Optional but recommended (matches the PRD's probe methodology): a headless vite-node script
over the public seams — closed db fixture, panel write-in 'mysql' enter → confirmMode raised
(no silent moot), esc → byte-identical state, enter → q1 answered mysql, q2 moot; repeat via
ctrl+t elaboration. The unit tests already cover this at the seam level.

### Level 4: Creative & Domain-Specific Validation

Manual TUI pass if convenient: `/interrogate` on a session with a closed answered db question
and a dependent — edit via ✎ Other row and via ctrl+t elaboration; both must show the
keep/cancel footer; esc must leave everything untouched.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean
- [ ] `npm test` fully green (no skipped/modified pre-existing tests)

### Feature Validation

- [ ] Write-in on closed with victims: modal raised, esc zero-change, enter applies {custom:true} + moots dependent + advances
- [ ] Elaboration save on closed with victims: modal raised, esc no draft, enter saves draft with answer untouched
- [ ] Byte-identical write-in re-commit on closed: inert no-op (no modal)
- [ ] Reasked re-confirm: seam-free on both paths (BUG-001 pins green unmodified)
- [ ] Zero-victim closed edits: no spurious modal

### Code Quality Validation

- [ ] Status-list form (not answer-presence) in writeInEnter; answer conjunct preserved in stageText
- [ ] No changes outside the two gates, their comments, the two test files, and (optional) decisions.md wording
- [ ] No-op blocks, apply*/cancel* machinery, rippleVictims, commitTextDraft untouched

### Documentation & Deployment

- [ ] Both FR-18 comment blocks name the three-status gate and cite BUG-003
- [ ] decisions.md pin covers all three seams (S1's pin + optional extension)

---

## Anti-Patterns to Avoid

- ❌ Don't reorder the write-in no-op relative to the gate — same-value closed re-commits must stay inert
- ❌ Don't drop the `q.answer !== undefined` conjunct in stageText
- ❌ Don't switch to answer-presence gating in writeInEnter — it would capture reasked and break BUG-001
- ❌ Don't touch ripple-confirm.ts logic — the machinery already handles closed sources/victims
- ❌ Don't modify or delete the sibling S1 tests/pins — extend only
- ❌ Don't assert the h2.29 moot reason string — that's P1.M2.T2's deliverable; assert status only

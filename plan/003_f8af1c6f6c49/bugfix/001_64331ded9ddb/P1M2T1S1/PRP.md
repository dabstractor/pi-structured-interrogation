---
name: "P1.M2.T1.S1 — acceptOptionIndex/digit seam gate includes closed edits; same-value re-confirm stays seam-free (BUG-003, option path)"
description: "One-line gate widening in src/panel/actions.ts acceptOptionIndex: the FR-18 ripple-confirm seam condition (currently `q.status === 'answered' || q.status === 'submitted'`) adds `|| q.status === 'closed'` — status-list form, NOT answer-presence, so the P1.M1.T2.S1 reasked same-value re-confirm stays seam-free by construction and the ANSWER-PIN no-op (which already covers closed) keeps running first. Digit inherits for free. TDD: PRD BUG-003 repro tests (confirmMode raised on closed different-value edit; esc cancels; enter applies + moots dependents with h2.29 reason) in the existing AC-13 describe. Docblocks updated (Mode A) + spec/decisions.md FR-18 closed-edit pin. writeInEnter/stageText gates are P1.M2.T1.S2 — NOT here."
---

## Goal

**Feature Goal**: FR-18 / Q39=B invalidation confirmation fires for edits to CLOSED (archived) questions carrying a recorded answer on the option-accept and digit paths — no more silent mooting of answered dependents when the user edits an archived question to a different value.

**Deliverable**: Modified `src/panel/actions.ts` (gate at acceptOptionIndex + docblock updates at the gate and the shared-commit-path header), updated header comment in `src/panel/ripple-confirm.ts`, appended FR-18 closed-edit pin in `spec/decisions.md`, new tests in `src/panel/actions.test.ts` (extend the AC-13 describe) and `src/panel/ripple-confirm.test.ts`.

**Success Definition**: `npm test` + `npm run typecheck` green; the PRD BUG-003 repro passes (closed db + dependent scale: enter on 'sqlite' raises the modal with victims [scale], esc cancels with zero state change, enter applies with db→answered and scale→moot); same-value on closed stays inert (existing :496 green); reasked same-value re-confirm stays seam-free (existing :422/:467 green); moot/withdrawn stay unanswerable (:316 green).

## User Persona

**Target User**: TUI user revisiting an archived question (FR-2: "answers editable even archived").

**Use Case**: After the close pass archived 'db=postgres', the user navigates back (R1 — closed navigable, caret pinned to the recorded row per FR-35), moves to 'sqlite', presses enter → sees "⚠ Invalidates 1 answered questions… enter=keep, esc=cancel" instead of silently destroying the dependent's answer.

**Pain Points Addressed**: BUG-003 — real user answers mooted with no confirmation for a whole class of edits; the user-worded Q39=B UX and state-and-persistence.md's unconditional "Answer edits apply through the ripple confirm" were bypassed.

## Why

- PRD h2.5 recommendation (verbatim): "Extend the FR-18 ripple-seam status gate (acceptOptionIndex:302, writeInEnter:392, stageText in panel.ts:863) to fire for ANY edited question carrying a recorded answer, including `closed`." This item delivers the acceptOptionIndex third of that (the other two sites are P1.M2.T1.S2).
- Editing closed questions is fully supported (FR-2, AC-13) and a closed question still carries its recorded answer — the seam's premise (an edit that can invalidate dependents) holds identically.
- The seam machinery needs NO change: `createRippleConfirm` already computes victims from dependents' statuses; zero victims → apply directly (a closed edit with no dependents behaves exactly as today — no spurious modal); `applyConfirmedEdit` already mirrors the accept tail once.

## What

### 1. The gate — `src/panel/actions.ts` acceptOptionIndex

Current (the seam dispatch inside the shared commit path):

```ts
const wasUnanswered = q.status === "open" || q.status === "reasked";
if (q.status === "answered" || q.status === "submitted") {
  if (!panel.confirmRippleEdit(q.id, proposed)) return "veto";
}
```

Change the condition to:

```ts
if (q.status === "answered" || q.status === "submitted" || q.status === "closed") {
```

**Form decision (documented in the code comment)**: use the explicit status list, NOT `q.answer !== undefined` answer-presence. Rationale: answer-presence would also capture the `reasked` hybrid (rule-1 re-ask keeps the answer while flipping status) and would require explicit exemptions to keep the P1.M1.T2.S1 same-value re-confirm seam-free; the status list keeps that path seam-free by construction and reads as a whitelist of "edit" statuses.

**Ordering guarantees that MUST hold (verify in tests)**:
- The ANSWER-PIN-001 same-value no-op earlier in the function already covers `closed` (statuses "the user's own commit produced") and runs BEFORE this gate → same-value on closed stays inert (advance, no modal, no state write). No change needed there.
- The `reasked` exclusion inside that no-op condition is untouched — rule-1 re-confirms never reach the gate.
- `wasUnanswered` is unchanged: closed counts as an edit (correct maybeAutoSubmit context per AUTOSUBMIT-003).
- Post-seam tail unchanged: applyAnswer flips closed→answered(pending) (FR-2 "editing re-marks a question pending" — satisfied by the existing primitive), evaluateDependsOn mutes victims with h2.29 reasons instantly, advance, maybeAutoSubmit.

Digit path (`digit()` → acceptOptionIndex) inherits — no separate edit.

### 2. Doc updates (Mode A)

- `src/panel/actions.ts` shared-commit-path header (the AcceptOutcome docblock ~:268-285): "route answered/submitted edits through the ripple-confirm seam FIRST" → "route answered/submitted/closed edits…" — one word plus a sentence citing BUG-003/FR-18: closed (archived) questions carry recorded answers; their different-value edits invalidate dependents exactly like answered/submitted edits, so they route through the same seam; same-value re-commits remain inert no-ops (ANSWER-PIN-001 runs first).
- The gate site comment: add a short line noting the closed addition and the status-list-vs-answer-presence rationale (see What §1).
- `src/panel/ripple-confirm.ts` header (~:32 "Open/reasked edits never reach the seam"): extend — closed edits DO reach the seam when a recorded answer exists and the proposed value differs; the same-value no-op and reasked re-confirmation never do.
- `spec/decisions.md`: append the FR-18 closed-edit pin per repo convention — Q39=B force-accept wording extended to archived edits (a short dated bullet mirroring the file's existing entry style; read the file's tail for the format first).

### 3. Tests — TDD, write failing-first

In `src/panel/actions.test.ts`, extend the `"accept on answered — ripple-confirm seam (AC-13)"` describe (:339-390), reusing `seed` / `makePanel` / `seamMock` exactly as the neighbors do:

1. `test_g_seam_also_guards_closed_questions` (mirror of :383): seed q1 `{status: "closed"}` (with a recorded answer — check how `seed`'s overrides carry answers; if it doesn't, apply one via `state.applyAnswer` then `state.setStatus("q1","closed")` before makePanel, matching the FR-35 fixtures), q2 answered with `dependsOn: [{id:"q1", equals:"postgres"}]`; `seamMock(true)`; cursor to a different value; `accept(panel)` → `confirmRipple` called once with the proposed answer.
2. `test_bug003_closed_edit_default_seam_raises_modal_nothing_applied` (the PRD repro, default seam = createRippleConfirm): q1 'db' options sqlite/postgres, answer postgres, status closed; q2 'scale' answered with the dependsOn above. Cursor to 'sqlite' (different value), enter via `accept(panel)` → returns true (consumed) but: `panel.confirmMode` truthy with `kind: "choice"`, `questionId: "q1"`, `victims` containing "q2"; `state.getQuestion("q1").answer.value` still "postgres"; q2 still "answered"; panel.currentId still "q1" (no advance).
3. `test_bug003_closed_edit_esc_cancels_zero_state_change`: continue from the modal state — drive the esc branch the existing veto/cancel tests use (see the cancel-path test in ripple-confirm.test.ts for the exact invocation; do NOT re-implement the modal key routing, exercise it through the same seam the existing cancel test does) → statuses/answers byte-identical to before, confirmMode cleared.
4. `test_bug003_closed_edit_confirm_enter_applies_and_moots_dependent`: continue instead with confirm-enter → q1 `answered` with value "sqlite" (FR-2 re-mark pending satisfied), q2 `moot` (assert the h2.29 reason per whatever P1.M2.T2 exposes today — if the reason rendering is still the generic fallback at this point, assert `status === "moot"` only and leave the reason string to P1.M2.T2), advance happened.
5. `test_digit_on_closed_routes_through_the_ripple_seam` (mirror of the :698 digit pattern): same closed fixture, `digit(panel, n)` for a different-value option → seam invoked.

In `src/panel/ripple-confirm.test.ts`: one test asserting `createRippleConfirm` on a CLOSED edited question with zero dependents returns `true` (apply directly — no spurious modal for dependent-free closed edits).

### 4. Explicitly OUT of scope

- `writeInEnter` gate (actions.ts ~:392) and `stageText` (panel.ts :863) — P1.M2.T1.S2.
- Moot reason rendering (short-view/overview/layout) — P1.M2.T2.
- README/spec sweeps beyond the single decisions.md pin — P1.M3.T2.
- Any change to `rippleVictims`, `applyConfirmedEdit`, the no-op condition, or `wasUnanswered`.

### Success Criteria

- [ ] Different-value accept on closed routes through the seam; veto leaves state untouched; confirm-enter applies + moots dependents + advances
- [ ] Same-value on closed stays inert (existing :496 green, unmodified); reasked reconfirm seam-free (:422/:467 green); moot/withdrawn no-op (:316 green)
- [ ] Digit inherits; zero-victim closed edits apply directly (no modal)
- [ ] Docblocks + decisions.md pin updated; full suite + typecheck green

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets: the exact gate line and its one-token change, the ordering guarantees that make it safe (no-op first, reasked exclusion, wasUnanswered semantics), the zero-change seam machinery explanation, the repro fixture from the PRD, the test file/describe/helpers to extend with neighbor line numbers, and the scope fence. No guessing.

### Documentation & References

```yaml
- file: src/panel/actions.ts
  why: acceptOptionIndex — the ANSWER-PIN no-op condition (~:294-312, includes closed, reasked-excluded), the gate (~:322 `answered||submitted` → add `||closed`), the post-seam tail (~:324-333), the AcceptOutcome docblock (~:268-285)
  pattern: one-token condition change + comment; touch NOTHING else in the function
  gotcha: keep the status-list form; answer-presence gating would capture reasked and need exemptions

- file: src/panel/ripple-confirm.ts
  why: createRippleConfirm (:118-134 — zero victims → true), applyConfirmedEdit (mirrors the tail once), rippleVictims (:104), header comment :32 to extend
  gotcha: NO logic change in this file — only the header comment

- file: src/panel/actions.test.ts
  why: the AC-13 describe :339-390 (seamMock/makePanel/seed usage), digit seam pattern (~:698), stay-green pins :316 (moot/withdrawn), :422/:444/:467 (reasked reconfirm), :496 (closed same-value), :530 (different-value seam)
- file: src/panel/ripple-confirm.test.ts
  why: default-seam + cancel-path invocation conventions for tests 2-4

- file: spec/decisions.md
  why: repo convention for decision pins — append the FR-18 closed-edit pin (read the tail for entry format; dated bullet style)
- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/prd_snapshot.md (h2.2/h3.2 BUG-003, h2.5 rec 3)
  why: defect definition, repro steps, recommended gate extension
- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/P1M1.T2.S1 + P1M1.T3.S1 PRPs (landed/in-flight)
  why: the reasked no-op exclusion this fix must NOT capture; the re-ask round-trip integration test landing in parallel — do not conflict with its fixtures
```

### Current Codebase tree (relevant slice)

```bash
src/panel/ actions.ts ripple-confirm.ts (+ actions.test.ts ripple-confirm.test.ts)
spec/ decisions.md
```

### Desired Codebase tree

```bash
# no new files
src/panel/actions.ts             # gate += closed + comments
src/panel/ripple-confirm.ts      # header comment only
src/panel/actions.test.ts        # +5 tests in the AC-13 describe + digit mirror
src/panel/ripple-confirm.test.ts # +1 zero-victim closed test
spec/decisions.md                # +FR-18 closed-edit pin
```

### Known Gotchas of our codebase & Library Quirks

```ts
// Line numbers have drifted across waves — grep the condition `q.status === "answered" || q.status === "submitted"` for the live gate
// The no-op MUST stay ahead of the gate: same-value on closed is ANSWER-PIN inert, never a modal (existing test :496 enforces)
// `reasked` must NEVER hit the gate — the status-list form guarantees it; don't switch to answer-presence
// seed() overrides may not carry answers — check its shape; if not, applyAnswer + setStatus("closed") pre-makePanel (FR-35 fixtures do this)
// confirmMode kind is "choice" for this path (write-in modals are S2's concern)
// applyConfirmedEdit re-invokes the tail ONCE — never call the seam again from it; tests 3-4 drive the modal through the existing key/confirm branches, not by calling internals
// moot reason strings may still be the generic fallback until P1.M2.T2 — assert status only in test 4 unless the h2.29 reason is already live
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: WRITE the failing tests (What §3) — actions.test.ts AC-13 describe + digit mirror; ripple-confirm.test.ts zero-victim case
  - RUN npx vitest run src/panel/actions.test.ts src/panel/ripple-confirm.test.ts → the closed-gate tests FAIL, all existing pass

Task 2: MODIFY src/panel/actions.ts — gate condition += `|| q.status === "closed"` + the two comment updates (What §1-2)

Task 3: MODIFY src/panel/ripple-confirm.ts header comment + APPEND spec/decisions.md pin

Task 4: GATES
  - npx vitest run src/panel/ src/  # full panel suite then everything (P1.M1.T3.S1's integration test lands in parallel — expect it green)
  - npm test && npm run typecheck
```

### Implementation Patterns & Key Details

```ts
// The entire logic change:
const wasUnanswered = q.status === "open" || q.status === "reasked";
// BUG-003 / FR-18 / Q39=B: closed (archived) questions still carry recorded
// answers — a different-value edit invalidates dependents exactly like an
// answered/submitted edit, so it routes through the same seam. Status-list
// form (not answer-presence): keeps the reasked re-confirmation
// (P1.M1.T2.S1) seam-free by construction. Same-value re-commits never
// reach here (ANSWER-PIN-001 no-op above covers closed).
if (q.status === "answered" || q.status === "submitted" || q.status === "closed") {
  if (!panel.confirmRippleEdit(q.id, proposed)) return "veto";
}
```

### Integration Points

```yaml
DOWNSTREAM (do NOT implement):
  - P1.M2.T1.S2: mirrors this gate in writeInEnter (~:392) and stageText (panel.ts :863)
  - P1.M2.T2: moot reason rendering (test 4's reason assertion upgrades then)
  - P1.M3.T2: README sweep documents the closed-edit confirm
STATE: applyAnswer's closed→answered flip already implements FR-2's re-mark-pending — no state.ts change
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npx vitest run src/panel/actions.test.ts src/panel/ripple-confirm.test.ts
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/
npm test   # full suite — expect zero flips; P1.M1.T3.S1's re-ask round-trip test (parallel) must stay green
```

### Level 3: Integration Testing

Covered by the seam-level tests (default-seam repro drives the real modal state machine); no pi runtime needed.

### Level 4: Domain Validation

Manual trace vs PRD h2.2/h3.2 repro: closed db + dependent scale → enter 'sqlite' → modal (victims [scale]) → esc: byte-identical state → enter: db answered(sqlite), scale moot. Every link pinned by tests 2-4.

## Final Validation Checklist

- [ ] `npm test` + `npm run typecheck` green; zero existing-test flips
- [ ] Gate is the explicit status list `answered|submitted|closed`; no-op ordering intact; reasked untouched
- [ ] 5 new actions tests + 1 ripple-confirm test pass (repro, esc-cancel, confirm-apply, seam-invoked, digit, zero-victim)
- [ ] Docblocks (gate + AcceptOutcome header + ripple-confirm header) and spec/decisions.md pin updated (Mode A)
- [ ] Only actions.ts gate/comment, ripple-confirm.ts comment, the two test files, and decisions.md modified

## Anti-Patterns to Avoid

- ❌ Don't gate on `q.answer !== undefined` — it captures reasked and needs exemptions the status list avoids
- ❌ Don't touch the no-op condition, wasUnanswered, rippleVictims, or applyConfirmedEdit
- ❌ Don't widen into writeInEnter/stageText — P1.M2.T1.S2 owns those
- ❌ Don't assert the h2.29 moot-reason string yet — P1.M2.T2's territory; assert status
- ❌ Don't skip the zero-victim test — a spurious modal on dependent-free closed edits would be a regression

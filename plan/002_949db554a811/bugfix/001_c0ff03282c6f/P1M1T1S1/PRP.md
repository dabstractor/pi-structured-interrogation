# PRP — Bugfix P1.M1.T1.S1: Reorder maybeAutoSubmit — arm gate-hold before the completeness return

## Goal

**Feature Goal**: Fix BUG-001 (bug-hunt PRD h2.2/h3.0): the AUTOSUBMIT-002 gate-hold ⚠ line is dead code in every natural flow because `maybeAutoSubmit` (src/panel/actions.ts:604–641) early-returns on `unanswered > 0` (:611) BEFORE arming the hold (:624–635). In the canonical scenario (gate question itself open, user answers later groups), the user gets NO feedback that auto-submit is being held. FR-3/AC-2d require the hold line on every commit while gate questions are unanswered.

**Deliverable**: Reordered `maybeAutoSubmit` in `src/panel/actions.ts` + inverted/adjusted tests in `src/panel/actions.test.ts`.

**Success Definition**:
- Canonical scenario: g1 (gate, open) + n1/n2 (later group); accepting an answer on n1/n2 arms `panel.gateWarning = {count, kind: "hold", submitLabel}` and withholds auto-submit
- Non-gate silence preserved: an open NON-gate question alone triggers no warning (test at :2023 stays green)
- Zero-pending silence preserved: `n > 0` but nothing committed → no line
- Complete-with-n=0 → auto-submit fires as before (epoch bump, flash, sendMessage)
- Full 1224-test suite + typecheck green

## Why

FR-3 / AC-2d (and README.md:52-53, ui-spec.md:72 — which already promise this exact behavior): "while gate-group questions are unanswered, commits show the non-expiring `⚠ {n} foundational unanswered — answer them or {submit} to submit now` line instead of auto-submitting". decisions.md records the premise: the scenario is a user filling out later groups before finishing the foundational one — precisely the flow where the current code shows nothing. The hold branch at :624-635 is only reachable via a contrived "closed-without-answer" gate question that the natural state machine can't produce. This subtask fixes the ordering; P1.M1.T1.S2 pins inheritance across the other commit entry points.

## What

Restructure `maybeAutoSubmit` (src/panel/actions.ts:604) so the gate-hold computation runs BEFORE the completeness return:

1. Keep the early `if (d === undefined) return;`
2. Compute `ordered`, `unanswered`, `pending` as today
3. Compute `gate = gateGroupNames(ordered); const n = countUnansweredGate(ordered, gate);` BEFORE any return that would follow a real commit
4. New hold arm condition: `if (n > 0 && pending > 0)` → arm `panel.gateWarning = { count: n, kind: "hold", submitLabel: panel.labels.submit }` (guarded by `panel.config.gateWarnings`, then `panel.invalidate()`), return without submitting. This replaces both the old unreachable closed-no-answer branch and fires in the canonical scenario (gate open).
5. Then the completeness returns in their existing order: `if (unanswered > 0) return;` (silent — gate case already handled above), `if (pending === 0) return;`
6. Then the existing auto-submit firing (`submit(panel, d)` + verbatim flash) — now guaranteed `n === 0` here

Semantics summary (must match exactly):

| State after a commit | Behavior |
|---|---|
| n>0, pending>0 (gate unanswered, user committing answers) | ⚠ hold line, no submit — **canonical, previously dead** |
| n>0, pending==0 (nothing new committed) | silent return (zero-pending silence) |
| n==0, unanswered>0 (ordinary non-gate open) | silent return (h2.58 pin, test :2023) |
| n==0, unanswered==0, pending>0 | auto-submit fires |

Note: `countUnansweredGate` (gate.ts:95) counts gate-group questions with `answer === undefined` and status not withdrawn/moot — an OPEN gate question counts (n includes it), which is exactly why moving the check above the completeness return makes the canonical case work.

### Success Criteria

- [ ] Inverted pinned-deviation test (was `test_auto_open_gate_question_returns_at_completeness_no_hold_line` at :2042) now asserts the hold line arms and nothing ships in the g1-open canonical scenario
- [ ] HOLD_FIXTURE describe (actions.test.ts:1937-2058): the closed-no-answer hold tests, release test, and ctrl+s override test all still pass (the reorder makes that path MORE reachable, not less)
- [ ] `test_auto_nongate_open_skip_stays_completely_silent` (:2023-ish) unchanged and green
- [ ] Zero-pending gate case covered by a NEW test (n>0, pending==0 → gateWarning stays null)
- [ ] `npm run typecheck` + full `npm test` green

## All Needed Context

### Context Completeness Check

Repo fully implemented, 1224 tests green. This is a surgical reordering in one function plus test edits; every line reference below was verified against the working tree. The implementing agent needs this PRP plus `src/panel/actions.ts`, `src/panel/gate.ts`, `src/panel/actions.test.ts`.

### Documentation & References

```yaml
- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/architecture/bug-001-gate-hold.md
  why: "dedicated research doc for this bug (verified @ 613437d) — line map, root cause, natural-state-machine argument for why closed-no-answer is unreachable"
  critical: "maybeAutoSubmit at actions.ts:604-641; completeness return :611 precedes hold arming :624-635"

- file: src/panel/actions.ts
  why: "the function to rewrite (:604-641). Existing hold-arm code at :624-635 is reused VERBATIM, just moved. Doc comment above the function (:595-603) must be updated — it currently documents the WRONG ordering ('an ordinary non-gate skip never reaches this check')"
  pattern: "panel.gateWarning = { count: n, kind: 'hold', submitLabel: panel.labels.submit } inside `if (panel.config.gateWarnings)`, then panel.invalidate(), then return"

- file: src/panel/gate.ts
  why: "helpers :68 gateGroupNames(ordered) → GateGroups, :95 countUnansweredGate(ordered, gate) → number (answer-undefined, non-withdrawn/moot), :143 gateHoldLine(count, submitLabel)"
  critical: "countUnansweredGate counts OPEN gate questions — no helper change needed"

- file: src/panel/actions.test.ts
  why: "HOLD_FIXTURE describe :1937-2058. Test to INVERT at :2042; silence test to PRESERVE at ~:2023; harness stubs makePanel/seed/makeDeps at :29-112"
  pattern: "commitLast helper: set panel.currentId + cursorIndex, call accept() — the commit tail runs maybeAutoSubmit"

- file: src/panel/panel.ts
  why: "gateWarning field declared :479-481 ({count, kind:'submit'} | {count, kind:'hold', submitLabel} | null); rendered non-expiring by footerNoticeLine :1204-1220; any-key dismiss :778-781 — NO changes needed here, listed so the agent doesn't touch it"
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
├── actions.ts        # maybeAutoSubmit :604-641 — REWRITE ordering + doc comment
├── actions.test.ts   # HOLD_FIXTURE describe :1937-2058 — INVERT/ADJUST tests
├── gate.ts           # gateGroupNames/countUnansweredGate/gateHoldLine — NO CHANGE
├── panel.ts          # gateWarning field/render/dismiss — NO CHANGE
└── ... (ripple-confirm.ts, keys.ts, etc. — inherit behavior via the commit tail)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: the old closed-no-answer HOLD_FIXTURE path must keep working —
//   it reaches the SAME n>0 && pending>0 condition; do not delete those tests.
// GOTCHA: zero-pending gate silence is NEW semantics: with the hold check moved
//   up, guard with `pending > 0` or a bare gate-only maybeAutoSubmit call
//   (no commit) would arm the line out of nowhere. Test it.
// GOTCHA: non-gate silence: when n === 0, the hold branch must NOT arm —
//   then fall through to the ordinary completeness returns. The :2023 test
//   pins this (g1 answered, n1 open → gateWarning null).
// GOTCHA: panel.labels.submit is the config-resolved label (e.g. "Ctrl+S") —
//   never hardcode the chord (h2.52 keymap guard).
// GOTCHA: config.gateWarnings OFF ⇒ silent withhold (toggle governs both gate
//   strings) — preserve the existing conditional.
// GOTCHA: no flash on the hold path — the hold line itself is the notice.
// GOTCHA: update the function's doc comment — it currently explains the OLD
//   ordering and will read as false after the change.
// GOTCHA: commit entry points (actions.ts:251,311; ripple-confirm.ts:160,304;
//   remote-submit.ts:165,181; index.ts:107-109) all call maybeAutoSubmit at
//   their tails — they inherit the fix with zero edits (P1.M1.T1.S2 pins tests).
```

## Implementation Blueprint

### Implementation Tasks (TDD-ordered)

```yaml
Task 1: INVERT the pinned-deviation test (actions.test.ts :2042)
  - RENAME test_auto_open_gate_question_returns_at_completeness_no_hold_line
    → test_auto_open_gate_question_arms_hold_line_no_submit (canonical AC-2d)
  - Fixture: g1 {group:'foundation', gate:true} OPEN, g2 answered, n1 answered
  - ASSERT after maybeAutoSubmit(panel, deps): sendMessage NOT called,
    epoch unchanged, panel.gateWarning equals
    { count: 1, kind: 'hold', submitLabel: 'Ctrl+S' }, rendered line contains
    '⚠ 1 foundational unanswered — answer them or Ctrl+S to submit now'

Task 2: ADD zero-pending gate silence test
  - Fixture: g1 gate OPEN (or closed-no-answer), everything else non-pending
    (open or moot), pending === 0 → maybeAutoSubmit leaves gateWarning null

Task 3: REWRITE maybeAutoSubmit (actions.ts :604-641)
  - ORDER: undefined-deps return → ordered/unanswered/pending → gate+n
    computed → `if (n > 0 && pending > 0) { if (panel.config.gateWarnings) {
    panel.gateWarning = {count:n, kind:'hold', submitLabel:panel.labels.submit};
    panel.invalidate(); } return; }` → `if (unanswered > 0) return;` →
    `if (pending === 0) return;` → submit + flash (unchanged)
  - REUSE the existing hold-arm block at :624-635 verbatim (condition changes)
  - UPDATE the function doc comment to describe the new ordering

Task 4: ADJUST the HOLD_FIXTURE describe comment (:1937-1950)
  - It explains the contrived closed-no-answer workaround; now note the hold
    also fires in the canonical open-gate flow (link the new Task 1 test).
    Tests themselves should pass UNCHANGED — if any fails, investigate, don't tweak.

Task 5: VERIFY the three commit-entry inheritance call sites still compile & pass
  - actions.ts:251,311; ripple-confirm.ts:160,304; remote-submit.ts:165,181;
    index.ts:107-109 — no edits expected (P1.M1.T1.S2 adds dedicated tests)
```

### Implementation Patterns & Key Details

```ts
// New body order (sketch — keep all existing comments, updated where stale):
export function maybeAutoSubmit(panel: InterrogationPanel, deps?: SubmitDeps): void {
  const d = deps ?? panel.delivery;
  if (d === undefined) return;
  const ordered = panel.state.orderedQuestions();
  const unanswered = ordered.filter((q) => q.status === "open" || q.status === "reasked").length;
  const pending = ordered.filter((q) => q.status === "answered").length;
  const gate = gateGroupNames(ordered);
  const n = countUnansweredGate(ordered, gate);
  if (n > 0 && pending > 0) {           // MOVED UP — fires in the canonical flow
    if (panel.config.gateWarnings) {
      panel.gateWarning = { count: n, kind: "hold", submitLabel: panel.labels.submit };
      panel.invalidate();
    }
    return;                              // no submit, no flash
  }
  if (unanswered > 0) return;            // non-gate skip stays silent (n === 0 here)
  if (pending === 0) return;             // zero-pending silence
  const shipped = submit(panel, d);
  if (shipped) panel.flash(`submitted — ${pending} answer(s)`);
}
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/actions.test.ts   # the HOLD_FIXTURE describe + inverted test
npm test                                    # full 1224-test suite green
```

### Level 3: Focused regression (all behavior surfaces that consume gateWarning)

```bash
npx vitest run src/panel/gate.test.ts src/panel/panel.test.ts src/panel/keys.test.ts
npx vitest run src/remote-submit.test.ts src/ac-scripted.test.ts   # bridge tail + ACs
```

### Level 4: Behavior matrix walkthrough (manual, in-code reasoning or a scratch vitest)

Verify each row of the semantics table above with a fixture — especially the two silences (zero-pending gate, non-gate open) so the moved check doesn't over-warn.

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green (1224+)
- [ ] Canonical g1-open scenario arms the hold line and withholds submit (inverted test)
- [ ] Zero-pending gate silence covered and green
- [ ] Non-gate silence test (:2023) unchanged and green
- [ ] HOLD_FIXTURE hold/release/override tests pass unchanged
- [ ] Function doc comment updated to the new ordering
- [ ] No changes to gate.ts, panel.ts, or the other commit entry points
- [ ] panel.labels.submit used for the label (no hardcoded chord)

## Anti-Patterns to Avoid

- ❌ Don't delete or weaken the HOLD_FIXTURE tests — the closed-no-answer path still reaches the same condition
- ❌ Don't arm the hold without the `pending > 0` guard (bare maybeAutoSubmit calls would over-warn)
- ❌ Don't add a flash on the hold path (the hold line IS the notice)
- ❌ Don't bypass `config.gateWarnings` or hardcode "Ctrl+S"
- ❌ Don't touch footerNoticeLine/gateHoldLine rendering — already correct
- ❌ Don't add inheritance tests for accept/ripple/bridge here — that's P1.M1.T1.S2

---

**Confidence Score**: 9/10 — single-function reorder with the hold-arm block reused verbatim, exact line references, existing tests pinning every adjacent behavior, and the target test to invert is identified by name and line.

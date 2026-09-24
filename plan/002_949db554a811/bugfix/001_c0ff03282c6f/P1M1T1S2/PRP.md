# PRP — P1.M1.T1.S2: Pin gate-hold inheritance across all commit entry points (accept, ripple edit, bridge submit)

**Revision 2** — re-planned after attempt 1. The only defect in attempt 1 was a **PRP spec error**,
not a code error: Success Criterion (b) demanded that the bridge tail hook arm `gateWarning`
(kind "hold"), which is mechanically impossible with S1's semantics. This revision replaces that
criterion with the TRUE inherited semantics (see "Attempt-1 Postmortem"). Everything else from
attempt 1's approach is confirmed correct; the attempt-1 test files may already exist in the
working tree (uncommitted `src/panel/actions.test.ts`, `src/panel/ripple-confirm.test.ts`,
`src/remote-bridge.test.ts` modifications) — if they are present and green, this PRP validates
and finalizes them rather than rewriting.

## Goal

**Feature Goal**: Every commit entry point in the codebase provably inherits P1.M1.T1.S1's
gate-hold behavior through the shared `maybeAutoSubmit` tail — pinned by tests that drive the
REAL commit paths (not fixtures), with a grep audit proving no bypass.

**Deliverable**: Green tests in 3 existing test files (accept path, both ripple edit-commit
paths, bridge submit path) + documented grep audit. **Zero source changes** — this is a
test-pinning task only.

**Success Definition**:
- (a) Ripple modal edit commit (BOTH sites: choice-edit `ripple-confirm.ts:160` and write-in-edit
  `ripple-confirm.ts:304`) while a gate question is open → driven through the real modal
  `handleInput` flow → `panel.gateWarning` equals `{ count: 1, kind: "hold", submitLabel: "Ctrl+S" }`,
  no send, no flash, epoch unchanged.
- (b) **REVISED (attempt-2 semantics)**: Bridge submit (`recordRemoteSubmission`,
  `remote-submit.ts`) with later-group answers while a gate question is unanswered, with the REAL
  `maybeAutoSubmit` wired index.ts-style (`index.ts:107-109` → `remote-bridge.ts:350`) → the tail
  hook is invoked **exactly once**, **exactly one** submission ships (the remote user's deliberate
  submit — never a hook-driven second), and `panel.gateWarning` is **null**. The null is CORRECT
  and is documented in-test: `recordRemoteSubmission` step 5 (the full-pending `markSubmitted`
  flush, the load-bearing AUTOSUBMIT-001 "one bridge submission, never two" ordering,
  `remote-submit.ts:146-148`) runs BEFORE the `:165`/`:181` tail hooks, so `pending === 0` at hook
  time and S1's `n > 0 && pending > 0` hold guard can never fire on any bridge path. Do NOT
  reorder the flush vs the hook.
- (c) Grep audit: every commit tail funnels through the shared `maybeAutoSubmit`; fix any path
  that does not (none known — actions.ts:251 accept, :311 writeInEnter direct-commit exit,
  ripple-confirm.ts:160/:304, remote-submit.ts:165/:181 are the complete set).
- Full suite green; typecheck clean; TDD red-proof (temporarily reverting S1's reorder fails
  exactly the new hold tests; restore byte-exact).

## Why

BUG-001 (PRD h3.0): the AUTOSUBMIT-002 gate-hold ⚠ line was dead code in every natural flow.
S1 reordered `maybeAutoSubmit` so the hold arms before the completeness return (commit
`5985b71`). But S1's fix only helps paths that actually call `maybeAutoSubmit` at the right
moment — this task proves inheritance holds on every commit entry point and guards against
future regressions (a new commit tail that bypasses the hook would silently resurrect the bug).

## What

Test-only changes to three existing test files. No production source, no config, no docs
(docs covered by P1.M3.T2).

### Success Criteria

- [ ] (a) both ripple edit-commit tests green, asserting hold armed + nothing shipped
- [ ] (b) bridge test green, asserting hook-invoked-once + one-submission + `gateWarning` null
      with the flush-first cause documented in a test comment
- [ ] (c) grep audit recorded (in the PRP execution notes / test comments) — all commit tails
      call `maybeAutoSubmit`
- [ ] `npx vitest run` full suite green (1229/1229 expected: 1224 pre-existing + 5 new);
      `npx tsc --noEmit` (or project equivalent) 0 errors
- [ ] `git diff` touches ONLY the three test files

## All Needed Context

### Documentation & References

```yaml
- file: src/panel/actions.ts
  why: S1's reordered maybeAutoSubmit (line ~607): gate count computed BEFORE the
        `if (unanswered > 0) return` completeness return; hold guard is
        `n > 0 && pending > 0`. Commit tails at :251 (accept) and :311 (writeInEnter
        direct-commit exit ONLY — never empty-buffer or deferred exits).
  gotcha: The `pending > 0` guard means zero-pending calls stay silent — tests must
        commit at least one answer before expecting the hold.

- file: src/panel/ripple-confirm.ts
  why: Both edit-commit tails call maybeAutoSubmit: :160 (choice-edit APPLIED path),
        :304 (write-in-edit APPLIED path). Tests must drive the real modal
        `handleInput` flow to reach these — not call the internal commit directly.

- file: src/remote-submit.ts
  why: recordRemoteSubmission ordering contract (doc comment lines 107-185). Step 5
        markSubmitted full-pending flush (:146) runs BEFORE the tail hooks (:165,
        :181). This flush-first ordering is why gateWarning is null on bridge paths —
        it is the AUTOSUBMIT-001 "one submission, never two" guarantee.
  gotcha: NEVER reorder flush vs hook to make the hold fire — that is a double-ship
        regression risk and out of scope (see "Out of Scope" below).

- file: src/remote-bridge.test.ts
  why: Test harness at lines ~21-75: FakeBus + makePi + makeBridge. The existing
        tail-hook test at :613 ("bridge tail hook: injected maybeAutoSubmit fires
        once after the lifecycle call") pins the flush-first ordering — follow its
        wiring pattern (createRemoteBridge with lifecycle + maybeAutoSubmit opts).
        Attempt-1's bridge hold test lives near :640-729 (asserts gateWarning null
        at :729 with the cause documented at :662).

- file: src/index.ts
  why: The production wiring to mirror in the bridge test: lines 107-109 inject
        `maybeAutoSubmit: () => { ... maybeAutoSubmit(panel) }` into the bridge;
        remote-bridge.ts:350 passes it through to recordRemoteSubmission's deps.

- file: src/panel/actions.test.ts
  why: S1's hold tests at :1983-2147 (HOLD semantics, zero-pending silence,
        gateWarnings:false, remapped submit label). Attempt-1's accept-path test
        "test_auto_accept_commit_with_open_gate_arms_hold_no_submit" at :2077.
        Follow the fixture/panel construction pattern used there.

- docfile: plan/002_949db554a811/bugfix/001_c0ff03282c6f/architecture/bug-001-gate-hold.md
  why: Caller map for the grep audit (accept, writeInEnter, ripple x2, remote-submit x2,
        index.ts wiring).
```

### Current codebase state (verified this session)

- S1 is committed (`5985b71`): `maybeAutoSubmit` computes the gate count before the
  completeness return; hold guard `n > 0 && pending > 0`.
- Attempt-1's test changes are UNCOMMITTED in the working tree (`git status` shows the three
  test files modified). First step: verify they are green (`npx vitest run`); if green, keep
  and finalize them; if absent or failing, write them per the blueprint below.

### Known Gotchas

```text
# CRITICAL: Bridge hold-arm is IMPOSSIBLE by design (attempt-1 finding).
# recordRemoteSubmission flushes ALL pending to 'submitted' (step 5) before the
# tail hooks (:165/:181), so maybeAutoSubmit always sees pending === 0 there.
# Asserting gateWarning === {kind:'hold'} on a bridge path WILL fail forever.
# Pin the true semantics instead (hook once, one submission, gateWarning null).

# Ripple tests must reach :160/:304 via the real modal handleInput flow
# (delivery-injected panels) — calling internal commit helpers directly
# bypasses the tail and proves nothing.

# Zero-pending = silent: commit at least one later-group answer before
# expecting any hold behavior.
```

## Implementation Blueprint

### Attempt-1 Postmortem (why the spec changed)

Attempt 1 delivered everything green (1229/1229, typecheck clean, TDD red-proof done) except
Success Criterion (b) as originally written ("bridge submit → hold armed"). That assertion is
unachievable: S1's hold guard requires `pending > 0`, but `recordRemoteSubmission`'s step-5
flush zeroes pending before the hook runs — and that ordering is the load-bearing
AUTOSUBMIT-001 double-ship guard (already pinned by `remote-bridge.test.ts:613`).
Reordering would be a behavior change this task forbids. **Revision 2 therefore re-specifies
criterion (b) to pin the true inherited semantics.** The implementation from attempt 1 (if
present in the working tree) already matches this revision.

### Implementation Tasks (ordered)

```yaml
Task 0: VERIFY working-tree state
  - git status; if the three test files carry attempt-1 changes, run
    npx vitest run — if 1229/1229 green and the bridge test asserts the
    REVISED criterion (b), jump to Task 4 (validation); only fill gaps.

Task 1: GREP AUDIT (criterion c)
  - grep -n "maybeAutoSubmit" -r src --include=*.ts
  - Confirm the complete commit-tail set: actions.ts:251, :311;
    ripple-confirm.ts:160, :304; remote-submit.ts:165, :181 (via
    remote-bridge.ts:350 ← index.ts:107-109). Remaining hits are
    imports/types/docs. Record the result in the final report.

Task 2: ACCEPT-PATH HOLD TEST (criterion a, panel side)
  - FILE: src/panel/actions.test.ts (extend)
  - TEST: open gate question g1 + later-group n1; commit n1 through the
    real accept() tail (actions.ts:251) → gateWarning
    { count: 1, kind: "hold", submitLabel: "Ctrl+S" }, no submission,
    no flash, epoch unchanged. (Already present as :2077 from attempt 1 —
    verify, don't duplicate.)

Task 3: RIPPLE + BRIDGE HOLD-INHERITANCE TESTS
  - FILE: src/panel/ripple-confirm.test.ts (extend)
    - TWO tests, one per APPLIED commit site (:160 choice edit, :304
      write-in edit): build a delivery-injected panel with an open gate
      question + an answered later-group question; open the ripple edit
      modal on an archived answer; drive the REAL handleInput flow to the
      APPLIED commit → gateWarning { count: 1, kind: "hold",
      submitLabel: "Ctrl+S" }; assert no send, no flash, epoch unchanged.
  - FILE: src/remote-bridge.test.ts (extend)
    - ONE test using the FakeBus + makePi + makeBridge harness (:21-75):
      wire the REAL maybeAutoSubmit exactly like index.ts:107-109 into
      createRemoteBridge (via remote-bridge.ts:350), over a shared-state
      panel that has an unanswered gate question; FakeBus submit of
      later-group answers → assert: hook invoked exactly once (spy
      counter), exactly one submission message on the bus, gate question
      answer untouched, and panel.gateWarning === null, with an in-test
      comment documenting the flush-first cause (step 5 markSubmitted
      before :165/:181 → pending === 0 → S1's guard no-ops).

Task 4: VALIDATION
  - npx vitest run → 1229/1229 green (or the current full count, all green)
  - Typecheck (project command; e.g. npx tsc --noEmit per package scripts)
  - TDD red-proof: temporarily revert S1's reorder in actions.ts (move the
    gate-hold block back below the completeness return) → exactly the 3
    new hold tests (accept + 2 ripple) fail → restore actions.ts
    byte-exact (git diff vs index must be empty afterward)
  - git diff: ONLY the three test files changed
```

### Integration Points

None. No source, config, or doc changes. (If the grep audit in Task 1 finds a bypassing
commit path, STOP and report rather than patching — a new commit tail would be a scope
escalation for the orchestrator to triage.)

## Validation Loop

### Level 1: Syntax & Style

```bash
npx tsc --noEmit        # 0 errors
npx vitest run src/panel/actions.test.ts src/panel/ripple-confirm.test.ts src/remote-bridge.test.ts
```

### Level 2: Full Suite

```bash
npx vitest run          # all green (expect 1229 with attempt-1 changes in place)
```

### Level 3: TDD Red-Proof (gate for the hold tests)

```bash
# Temporarily move the gate-hold block in src/panel/actions.ts below the
# `if (unanswered > 0) return;` line (revert S1's reorder)
npx vitest run src/panel/actions.test.ts src/panel/ripple-confirm.test.ts
#   → exactly the 3 new hold tests FAIL
git checkout src/panel/actions.ts   # restore byte-exact
git diff src/panel/actions.ts       # must be empty
```

### Level 4: Scope Check

```bash
git status --short    # only the 3 test files modified (+ plan/ dirs)
```

## Final Validation Checklist

- [ ] Both ripple APPLIED commit sites pinned (hold armed, nothing shipped)
- [ ] Accept-path open-gate hold test green through the real accept() tail
- [ ] Bridge test pins REVISED criterion (b): hook once, one submission, gateWarning null
      with documented flush-first cause
- [ ] Grep audit recorded; no commit path bypasses maybeAutoSubmit
- [ ] TDD red-proof performed and actions.ts restored byte-exact
- [ ] Full suite green; typecheck 0 errors
- [ ] Only the three test files changed

## Anti-Patterns to Avoid

- ❌ Do NOT modify `maybeAutoSubmit` logic or `recordRemoteSubmission` ordering — this task
  pins behavior; it does not change it
- ❌ Do NOT assert `gateWarning` is armed on any bridge path — it cannot be (flush-first)
- ❌ Do NOT drive ripple commits by calling internal helpers — use the real modal handleInput
- ❌ Do NOT write new test harnesses when src/remote-bridge.test.ts:21-75 already has
  FakeBus/makePi/makeBridge
- ❌ Do NOT use a real pi in bridge tests — always the fake

## Out of Scope (explicitly deferred)

A visible hold signal on the bridge flow (if AC-2d is read to require one) is a **new design
decision** — e.g. pre-flush hold evaluation inside `recordRemoteSubmission` — requiring its own
PRP with double-ship regression analysis. This task documents and pins current semantics; it
does not redesign the bridge. Flag this in the final report for the orchestrator.

## Confidence Score

9/10 — the work already exists green in the working tree from attempt 1 and matches this
revision's corrected criterion (b); the remaining risk is only verifying/red-proofing.

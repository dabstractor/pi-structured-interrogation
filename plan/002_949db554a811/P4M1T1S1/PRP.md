---
name: "P4.M1.T1.S1 — Full verification sweep: vitest suite, typecheck, keymap guard (delta gate)"
description: "Final gate for Delta plan 002_949db554a811. Run npm test (vitest run, 48 files) + npm run typecheck (tsc --noEmit); confirm the keymap guards stay green (no-hardcoded-keys.test.ts regex ctrl+[a-z0-9] over non-test src, only DEFAULT_CONFIG allowlisted; keymap-guard.test.ts pins DEFAULT_CONFIG defaults + ALL_ACTIONS); triage and fix cross-subtask integration fallout — the known live instance is src/reload-invoke.test.ts:165 and :202 which still pin session-start auto-open (opened:true-style customCalls assertions) and are NOT covered by P3.M2.T2.S1's test-flip list; also verify registration order in src/index.ts, zero advanceArmed references (baseline: 0), and duplicate-summary sync between snapshots.ts answerSummary (:128) and delivery.ts completionAnswerSummary (:269, comment at :264 is the sync reference). AUTOMATION-POLICY binding: no live TUI, no real tool calls, no waiting on user answers."
---

## Goal

**Feature Goal**: The full delta (P1 write-ins, P2 auto-submit, P3 surfacing gates) lands green: `npm test` passes all 48 vitest files and `npm run typecheck` (tsc --noEmit) is clean, with the keymap guards specifically confirmed green. This is the gate that unblocks P4.M1.T1.S2 (README changeset sync).

**Deliverable**: Minimal fix-ups (test flips / small production repairs) wherever cross-subtask integration left fallout, plus a verification record written to `plan/002_949db554a811/P4M1T1S1/research/verification-record.md`. NO feature work, NO docs work (that is S2), NO new functionality.

**Success Definition**: `npm test` → 0 failed test files; `npm run typecheck` → exit 0; `src/no-hardcoded-keys.test.ts` and `src/keymap-guard.test.ts` individually green; every fix accounted for in the verification record with root cause + owner subtask attribution.

## User Persona

**Target User**: the automated pipeline itself (this is a gate task), then P4.M1.T1.S2's docs agent which consumes the green state.

**Use Case**: all implementing subtasks (P1.*, P2.M1.T1/T2/T4, P3.M1.*, P3.M2.*) are complete; the sweep proves the integrated delta.

## Why

- PRD h2.53 (Testing): the suite + typecheck is the delta's verification; the keymap guard runs as part of the suite and pins h2.36 defaults.
- PRD h2.51 M8 test bullets require the flipped characterizations to be green at delta close.
- The orchestrator marks S2 blocked on this gate; interactive-only ACs defer to the human runbook (MANUAL-TUI-AC-RUNBOOK.md) and NEVER block the pipeline.

## What

1. Run the sweep commands; capture output.
2. Confirm keymap guards (see Verification Detail below for the exact invariants).
3. Triage every failure: classify as (a) stale test asserting pre-SURFACE-002 behavior → flip per the same pattern P3.M2.T2.S1 applies; (b) genuine production integration bug → fix the production code; (c) in-flight sibling race → re-run after confirming sibling status, do not paper over.
4. Verify the specific integration seams listed in Known Gotchas (index.ts registration order, advanceArmed, duplicate-summary sync, labels.submit interpolation).
5. Write the verification record.

### Success Criteria

- [ ] `npm test` green (48 files, ~1224 tests, 0 failures)
- [ ] `npm run typecheck` exit 0
- [ ] `npx vitest run src/no-hardcoded-keys.test.ts src/keymap-guard.test.ts` green
- [ ] No literal chords added outside DEFAULT_CONFIG (grep confirm)
- [ ] `grep -rn advanceArmed src` → 0 hits (baseline: already 0)
- [ ] reload-invoke.test.ts :165/:202 fallout resolved (widget-based or reopened assertions, matching P3.M2.T2.S1 semantics)
- [ ] Verification record written to research/

## All Needed Context

### Context Completeness Check

Validated: the full suite was run in this repo at PRP time (baseline: 3 failed files / 10 failed tests / 1214 passed, typecheck clean, 48 files). Every failing assertion was inspected. The known failure set and the unclaimed reload-invoke rows are documented below with exact line numbers.

### Documentation & References

```yaml
- file: plan/001_0d6760db6bc5/AUTOMATION-POLICY.md
  why: BINDING — no live `pi -e .`, no real `interrogate` tool calls, never wait on user answers
  gotcha: interactive checks (AC runbook, TUI observation) are HUMAN-only, in MANUAL-TUI-AC-RUNBOOK.md — never attempted here

- file: plan/002_949db554a811/P3M2T2S1/PRP.md
  why: CONTRACT for the SURFACE-002 test flips in reconstruct.test.ts (:204/:260/:370/:523) and
    ac-panel.test.ts (AC-9a/b/c :849/:884/:902, AC-10 :1062) — assume landed exactly as specified;
    if those rows still fail at sweep time, the contract broke: investigate reconstruct.ts, not the test
  gotcha: its scope does NOT include src/reload-invoke.test.ts — that fallout is THIS sweep's job

- file: plan/002_949db554a811/architecture/surfacing-remote-seams.md
  why: §"Test-flip ledger" (:137-151) — the authoritative before→after map for auto-open assertion flips
  pattern: flip to opened:false + widget-set (ui.setWidget key "interrogator", counts line) + no ui.custom call

- file: src/no-hardcoded-keys.test.ts
  why: guard #1 — scans every non-test .ts under src/ (comments stripped by a string-aware scanner);
    fails on MODIFIER_STRING (alt+/super+ quote-anchored), CTRL_ANYWHERE (/ctrl+[a-z0-9]/i ANYWHERE in
    scannable code), SHIFT_TAB; allowlist = config.ts DEFAULT_CONFIG literal only
  gotcha: the P2.M1.T2 gate-hold line (src/panel/actions.ts:628) already interpolates panel.labels.submit
    (confirmed at PRP time) — comments mentioning ctrl+s are stripped, so comment mentions never trip it

- file: src/keymap-guard.test.ts
  why: guard #2 — pins DEFAULT_CONFIG defaults (none on TAKEN keys), accelerator grammar validity,
    and the complete 9-action ALL_ACTIONS map (deep, overview, focusText, batchNote, submit, discuss,
    externalEditor, prevQuestion, nextQuestion)
  gotcha: fixed keys (enter/esc/arrows/digits) are intentionally absent from config and not checked

- file: src/reload-invoke.test.ts
  why: KNOWN UNCLAIMED FALLOUT — :165 and :202 both `expect(pi2.customCalls.length).toBe(1)` after
    emitting session_start with reason "reload"; under SURFACE-002 (P3.M2.T1.S1) reconstruction never
    calls ui.custom — it calls ui.setWidget instead. These two rows fail TODAY (verified at PRP time)
    and belong to NO sibling PRP: fix here by asserting widget-set + no customCalls, keeping the
    existing /interrogate-immediate-invocation pins (the test's primary subject) intact
  gotcha: check whether the test fakes (pi2 surface) already expose setWidget; if not, add it, mirroring
    the ac-panel makeCtx pattern from P3.M2.T2.S1

- file: src/snapshots.ts (answerSummary :128) and src/delivery.ts (completionAnswerSummary :269, sync comment :264)
  why: duplicate-by-design summary rules that must stay behaviorally identical (both share the ✎ write-in
    branch per WRITEIN-001/h2.42); the delivery.ts comment is the sync reference
  gotcha: do NOT import the private across modules — if drift is found, fix the duplicate in place, not by importing

- file: src/index.ts
  why: registration order check — tool registration, session_start/session_tree subscriptions,
    command registrations must be intact and idempotent-safe across reload
```

### Current Codebase tree (relevant slice)

```bash
src/                      # 48 test files; production modules
  no-hardcoded-keys.test.ts, keymap-guard.test.ts   # the two guards
  reconstruct.test.ts, panel/ac-panel.test.ts        # P3.M2.T2.S1's flip targets
  reload-invoke.test.ts                              # :165/:202 = this sweep's known fallout
  index.ts, config.ts, panel/{panel,actions,gate,keys,suspend}.ts, snapshots.ts, delivery.ts
plan/002_949db554a811/P4M1T1S1/research/             # write verification-record.md here
```

### Known Gotchas of our codebase & Library Quirks

```text
# BASELINE (measured at PRP time, 2026 sweep): 3 failed files / 10 failed tests:
#   reconstruct.test.ts (a, c, f, wiring-h), ac-panel.test.ts (AC-9a/b/c, AC-10 :1065),
#   reload-invoke.test.ts (:165, :202). Typecheck: CLEAN. advanceArmed: 0 refs.
# If P3.M2.T2.S1 has landed, the first 8 should already be green — only reload-invoke remains.
# ANY failure outside this set is NEW regression: treat as production bug, root-cause it.

# The no-hardcoded-keys scanner is string-aware: a ctrl+X mention inside a TEMPLATE LITERAL
# (even interpolated display text) trips it. Display strings must interpolate labels, not literals.

# vitest runs ESM ("type":"module"); node >=22.19 required. Single file: npx vitest run <path>.

# P3.M2.T1.S1's reconstruct.ts calls updateSuspendWidget(ctx, state) which is a NO-OP on
# surfaces lacking ui.setWidget — a test fake without setWidget silently asserts nothing;
# add the fn and assert on it.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: BASELINE SWEEP (read-only)
  - RUN: npm test 2>&1 | tail -40 ; npm run typecheck
  - RUN: npx vitest run src/no-hardcoded-keys.test.ts src/keymap-guard.test.ts
  - RUN: grep -rn "advanceArmed" src --include=*.ts ; grep -rnE "ctrl\+[a-z0-9]" src --include=*.ts | grep -v test | grep -v config.ts
  - RECORD: exact failure list vs the PRP-time baseline above; classify each (stale-test / prod-bug / sibling-race)

Task 2: FIX stale auto-open assertions NOT covered by P3.M2.T2.S1
  - PRIMARY TARGET: src/reload-invoke.test.ts :165 and :202
  - CHANGE: replace customCalls.length===1 pins with widget-based assertions
    (ui.setWidget called with key "interrogator" + counts line; customCalls.length === 0),
    preserving the tests' primary pins (immediate /interrogate invocation, no key gate, drafts)
  - FOLLOW pattern: the flip ledger in plan/002_949db554a811/architecture/surfacing-remote-seams.md :137-151
    and P3.M2.T2.S1's ac-panel makeCtx setWidget additions
  - GOTCHA: add setWidget to the pi2 fake surface if missing

Task 3: TRIAGE any remaining failures
  - IF reconstruct.test.ts / ac-panel.test.ts still fail → P3.M2.T2.S1 contract broke;
    inspect src/reconstruct.ts (must return opened:false, call updateSuspendWidget, still emit onRestored)
  - IF guard failures → find the offending literal; replace with resolveKeyLabels(config) interpolation
  - IF genuine production fallout (registration order, dead refs, summary drift) → fix minimally in place,
    attribute in the record

Task 4: VERIFY integration seams
  - index.ts: tool + session_start/session_tree + command registrations present, order unchanged
  - snapshots.ts answerSummary ≡ delivery.ts completionAnswerSummary on the ✎ branch (write a quick
    comparison only if drift suspected — both are covered by existing suites)
  - actions.ts:628 gateWarning uses panel.labels.submit (already confirmed)

Task 5: WRITE plan/002_949db554a811/P4M1T1S1/research/verification-record.md
  - CONTENT: final npm test summary line, typecheck result, guard results, each fix (file:line,
    root cause, owning subtask), residual risks, confirmation S2 is unblocked
```

### Implementation Patterns & Key Details

```text
# Widget assertion pattern (copy from P3.M2.T2S1 / suspend.ts contract):
#   expect(pi.customCalls.length).toBe(0)                       // never opened
#   const w = fake.setWidget.mock.calls.at(-1)                  // key "interrogator"
#   expect(w[0]).toBe("interrogator")
#   expect(w[1].join(" ")).toMatch(/— \/interrogate to resume$/)  // counts line
```

## Validation Loop

### Level 1: Syntax & Style
```bash
npm run typecheck        # tsc --noEmit — expected exit 0
```

### Level 2: Unit / Full suite (THE GATE)
```bash
npm test                                            # vitest run — 0 failures expected
npx vitest run src/no-hardcoded-keys.test.ts        # guard green
npx vitest run src/keymap-guard.test.ts             # guard green
npx vitest run src/reload-invoke.test.ts            # post-fix green
```

### Level 3: Integration — NOT APPLICABLE per AUTOMATION-POLICY
No live TUI, no real tool calls. Interactive ACs belong to the human runbook.

### Level 4: Final delta gate
```bash
npm test && npm run typecheck && echo "P4.M1.T1.S1 GATE PASSED — S2 unblocked"
```

## Final Validation Checklist

- [ ] `npm test` fully green (48 files)
- [ ] `npm run typecheck` exit 0
- [ ] Both keymap guards individually green
- [ ] `grep -rn advanceArmed src` → 0 hits
- [ ] reload-invoke.test.ts :165/:202 fallout resolved with widget-based assertions
- [ ] No production behavior changed except minimal fallout repair (each justified in the record)
- [ ] verification-record.md written to `plan/002_949db554a811/P4M1T1S1/research/`
- [ ] AUTOMATION-POLICY respected throughout (no TUI, no tool calls, no waiting on humans)

## Anti-Patterns to Avoid

- ❌ Don't flip a failing assertion to make it pass without root-causing (stale-test vs prod-bug classification is mandatory)
- ❌ Don't delete tests; flip or rewrite them per the ledger pattern
- ❌ Don't "fix" reconstruct.ts if its tests fail — first check whether P3.M2.T2.S1 actually landed
- ❌ Don't add hardcoded key literals (even in display strings) — guards will catch you
- ❌ Don't defer failures to S2 or the human runbook unless they are interactive-only by nature

---

**Confidence Score**: 9/10 — the entire failure surface was measured at PRP time; the only residual unknown is whether P3.M2.T2.S1 lands exactly per its contract, and this PRP tells the implementer exactly how to check that.

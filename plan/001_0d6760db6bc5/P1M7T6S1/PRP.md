---
name: "P1.M7.T6.S1 — Scripted ACs via debug commands + fixtures"
description: Prove state-level acceptance criteria (AC-2, AC-3, AC-8, AC-11, AC-13, AC-14 state side) through vitest integration tests over executeInterrogate / the debug-command handlers / lifecycle / fallback, plus headless `pi -p` one-shot probes. Records per-AC pass/fail with the FR each proves; defects fixed in the owning module. Interactive-only leftovers stay in MANUAL-TUI-AC-RUNBOOK.md (human-only).
---

## Goal

**Feature Goal**: Execute the state-provable subset of ACs 1–14 (h2.10) as scripted
vitest integration tests over the SAME production code paths (executeInterrogate,
debug-command handlers, delivery, lifecycle, fallback, guards), record pass/fail
per criterion citing the FR it proves, and fix any defects found in the owning
module. Automation never opens a live TUI panel
(plan/001_0d6760db6bc5/AUTOMATION-POLICY.md — binding).

**Deliverable**:
1. `src/ac-scripted.test.ts` — the scripted AC suite covering AC-2, AC-3, AC-8,
   AC-11, AC-13, AC-14-state in dependency order, with a per-AC results table in
   the file JSDoc [Mode A notes]: AC → pass/fail → FR proven → evidence (test name).
2. `plan/001_0d6760db6bc5/P1M7T6S1/research/AC-RESULTS.md` — copied results
   table + defect list (what was found, where fixed) for P1.M7.T6.S2 to consume.
3. Headless `pi -p` one-shot probe instructions + (if feasible without network)
   a smoke check for AC-11 documented in the results file.
4. Defect fixes in owning modules (delivery.ts / merge.ts / guards.ts /
   lifecycle.ts / completion.ts / fallback.ts / snapshots.ts) as found.

**Success Definition**: `npm test` fully green including the new AC suite; every
targeted AC has a named passing test or an explicit recorded FAIL with a defect
note; interactive leftovers (AC-1, AC-4..7, AC-9, AC-10, AC-12 — covered by
P1.M7.T5.S2 / S2 / human runbook) are listed, not attempted live.

## Why

- h2.10 / h2.50 + AUTOMATION-POLICY.md: ACs must be proven by scripted tests;
  the pipeline NEVER launches `pi -e .` or calls the interrogate tool for real.
- This is the verification gate before P1.M7.T6.S2 (scripted panel AC pass) and
  P1.M7.T7 docs; it consumes P1.M2.T3.S1's debug commands and P1.M7.T1.S2's
  reconstruction.
- Per-module unit tests exist (state/merge/guards/caps/closure/reconstruction/
  digest); this task proves the END-TO-END flows the ACs describe.

## What

State-level ACs executed via the production code path:

- **AC-2**: answer 2 of 30 → submission delta ≤3 lines + SUBMISSION_REMINDER;
  28 remain open; epoch bumps exactly once (buildSubmission does
  takeSnapshot+bumpEpoch).
- **AC-3**: agent reply without upsert → auto-close (lifecycle agent_settled
  close pass) archives submitted answers; reply WITH a re-ask (changed options,
  merge rule 2) → status `reasked`, answer reset, draft preserved
  (draft-store slot untouched by merge).
- **AC-8**: stale upsert (wrong rev/epoch) → StaleError message contains current
  rev/text + delta digest; model re-applies with corrected rev → success.
- **AC-11**: `pi -p` non-TUI path: upsert returns markdown digest; answers
  recorded via fallback `answers[]` (recordAnswers); subsequent read consistent.
- **AC-13**: editing an archived (closed) answer re-marks it pending
  (`answered(pending)`); next submission diff entry carries
  `editedArchived: true` → renderer appends `(changed)`.
- **AC-14 (state side)**: all questions closed → completion record built once
  (buildCompletion content assertions); completion flag guarantees once-only
  (re-trigger attempt injects nothing).

### Success Criteria

- [ ] Each listed AC has ≥1 named test asserting the concrete AC language
      (e.g. "≤3 lines", "28 remain open", "(changed)", once-only).
- [ ] Per-AC results table written [Mode A]; FR citations included.
- [ ] Any defect found is FIXED in the owning module (not papered over in tests),
      with the fix recorded in AC-RESULTS.md.
- [ ] Interactive-only ACs enumerated and pointed at MANUAL-TUI-AC-RUNBOOK.md /
      P1.M7.T5.S2 / P1.M7.T6.S2 — no live TUI attempt.
- [ ] Full `npm test` green; `npm run typecheck` clean.

## All Needed Context

### Context Completeness Check

An implementer knowing nothing about this codebase can build this from the PRP +
files below: all entry points (executor, debug handlers, lifecycle, delivery,
fallback) are exported and already have test-pattern precedents cited.

### Documentation & References

```yaml
- file: src/tool.ts
  why: executeInterrogate(args, ctx, config, deps) — THE production executor;
        upsert route runs parse→assertFresh→applyCaps→applyUpsert→result;
        isNonTui(ctx.mode, ctx.hasUI) branches to fallback digest (AC-11)
  pattern: fake ExecutorContext {mode, hasUI, model?}; see src/tool.test.ts
  gotcha: executor is synchronous; state is a module singleton — reset between
          tests via setState(undefined) / createState helpers used by existing tests

- file: src/debug-commands.ts + src/debug-commands.test.ts
  why: registerDebugCommands handlers = same-path drivers; test file shows the
        notify-capturing ctx mock and fixture upsert JSON
  pattern: debug-commands.test.ts:94-345 — registerCommand spy, handler(args, ctx)
           invocation, "interrogate-debug-*" names

- file: src/delivery.ts + src/delivery.test.ts
  why: buildSubmission (delta lines, SUBMISSION_REMINDER="Consider how these
        affect your other questions.", SUBMISSION_LIST_MAX_CHARS=240),
        buildCompletion (completion record content, AC-14)
  gotcha: buildSubmission performs takeSnapshot+bumpEpoch ITSELF — never call
          them before it (double-bump)

- file: src/guards.ts
  why: StaleError + buildStaleMessage — AC-8 payload (current rev/text + digest);
        assertFresh called inside executeInterrogate upsert route
  pattern: guards.test.ts covers math; AC test proves the E2E rejection +
        self-heal re-apply through executeInterrogate

- file: src/lifecycle.ts + src/completion.ts
  why: createLifecycle(pi mock) subscribes agent_settled → close pass (AC-3
        archive) and completion trigger once-only (AC-14); completion.ts holds
        the exactly-once invariant
  gotcha: lifecycle events come from the state singleton — emit via the same
          upsert path (applyUpsert fires questions-upserted/changed), or drive
          pi.on-registered handlers with synthetic events

- file: src/fallback.ts + src/fallback.test.ts
  why: isNonTui truth table, buildFallbackDigest (AC-11 digest), recordAnswers
        (answers[] recording for non-TUI)

- file: src/merge.ts + src/state.ts
  why: AC-3 re-ask = merge rule 2 (changed options → reasked + answer reset);
        AC-13 = state.ts applyAnswer on closed → answered(pending), never bumps rev
  gotcha: WITHDRAWABLE statuses in merge.ts:67 — verify re-ask of a closed
        question behaves per AC-3's "draft preserved" (draft-store is separate
        from answers; assert draft-store slot survives merge)

- file: src/snapshots.ts
  why: computeDiff DiffEntry.editedArchived flag (line ~52: prev status was
        "closed" → "(changed)" marker) — the AC-13 assertion point

- file: src/draft-store.ts
  why: AC-3 "draft preserved" — the re-ask must not clear the draft slot

- file: plan/001_0d6760db6bc5/AUTOMATION-POLICY.md
  why: BINDING — never launch pi -e ., never call interrogate for real, never
        wait for user input. pi -p one-shot probes are the ONLY headless e2e.

- file: plan/001_0d6760db6bc5/MANUAL-TUI-AC-RUNBOOK.md
  why: the human-only leftovers; enumerate, never execute

- file: plan/001_0d6760db6bc5/P1M7T5S2/PRP.md
  why: parallel sibling adding src/config-surface.test.ts + src/no-hardcoded-keys.test.ts
        (AC-12) — keep your suite in a NEW file; additive-only edits elsewhere
```

### Current Codebase tree (relevant slice)

```bash
src/
  tool.ts tool.test.ts          # executeInterrogate (production path)
  debug-commands.ts/.test.ts    # same-path TUI command handlers + mock pattern
  delivery.ts delivery.test.ts  # buildSubmission/buildCompletion
  guards.ts guards.test.ts      # StaleError / assertFresh
  lifecycle.ts lifecycle.test.ts completion.ts completion.test.ts
  fallback.ts fallback.test.ts  # non-TUI digest + answers[]
  merge.ts state.ts snapshots.ts draft-store.ts (+tests)
  reconstruct.ts/.test.ts       # P1.M7.T1.S2 reconstruction
```

### Desired Codebase tree with files to be added

```bash
src/
  ac-scripted.test.ts           # NEW: scripted AC suite (AC-2,3,8,11,13,14-state)
                                # JSDoc header = per-AC results table [Mode A]
plan/001_0d6760db6bc5/P1M7T6S1/
  research/AC-RESULTS.md        # NEW: results table + defect log + pi -p probe notes
  # owning src/*.ts modules     # MODIFIED only if defects found
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: state is a MODULE SINGLETON (getState/setState). Every test must
// reset it first — copy the beforeEach from debug-commands.test.ts/tool.test.ts.

// GOTCHA: buildSubmission does takeSnapshot + bumpEpoch itself (strict order);
// calling them externally double-bumps the epoch and breaks AC-2's
// "epoch bumps exactly once" assertion.

// GOTCHA: delta "≤3 lines" = delivery.ts's rendered message shape (reminder
// line + list within SUBMISSION_LIST_MAX_CHARS=240 + "{open} remain" style
// lines) — assert on the built SubmissionMessage content, not on pi transports.

// GOTCHA: lifecycle needs a pi mock exposing .on() that captures handlers;
// then drive close-pass/completion via the events the state singleton fires.
// Never use a real ExtensionAPI.

// GOTCHA: AC-11 "pi -p": executeInterrogate with ctx {mode:"print"(or non-tui),
// hasUI:false} exercises fallback — that IS the scripted proof. The literal
// headless `pi -p` one-shot (real binary, offline model unavailable) is
// documented as a probe recipe in AC-RESULTS.md, not an automated test, unless
// the environment proves able to run it (agent-judgment; never let it hang —
// timeout + skip).

// GOTCHA: answers never bump rev (state.ts:336); stale-guard AC-8 hinges on
// rev/epoch mismatch from UPSERT params — construct the stale case by
// submitting (epoch bump) then upserting with the pre-submit rev.

// Concurrency: P1.M7.T5.S2 lands config-surface/no-hardcoded-keys tests in
// parallel — do not edit those files; shared test files additive-only.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/ac-scripted.test.ts — fixtures + AC-2
  - BUILD fixture: 30 questions across 4 groups incl. one gate group (reuse/extend
    the upsert JSON style from debug-commands.test.ts; ids q01..q30, one
    dependsOn edge for later ACs).
  - IMPLEMENT AC-2 "submission_delta_three_lines_reminder_epoch_28_open":
    upsert fixture → applyAnswer on 2 → computeDiff(pre,post) → buildSubmission →
    assert delta message ≤3 substantive lines, contains SUBMISSION_REMINDER,
    "{28} remain"-equivalent open count from the message/statusLine, and epoch
    bumped exactly +1 vs pre.
  - RESET pattern: beforeEach setState(undefined) like debug-commands.test.ts.

Task 2: AC-3 "close_vs_reask_draft_preserved"
  - SUBTEST a (close): record+submit 2 answers → run lifecycle close pass
    (agent settled, no new upsert) → both questions status "closed" (archived
    markers are overview rendering — assert status only).
  - SUBTEST b (re-ask): upsert one of them with changed options (new rev from
    the stale-guard-safe current rev) → status "reasked", answer undefined,
    draft-store slot for that id UNCHANGED.

Task 3: AC-8 "stale_upsert_rejected_then_self_heal"
  - upsert fixture → submit (epoch bumps) → upsert q01 with the STALE pre-bump
    rev via executeInterrogate → expect throw of StaleError whose message
    contains current rev and the delta digest (buildStaleMessage contract).
  - RE-APPLY: parse current rev from state, re-issue upsert → success; state
    consistent (q01 reasked/merged per rules).

Task 4: AC-11 "print_mode_digest_and_answers_consistency"
  - executeInterrogate(upsert, {mode:"print", hasUI:false}, config) → result
    content contains statusLine + numbered digest lines + relay sentence.
  - recordAnswers(answers[]) for 2 questions → serialize: answers recorded,
    epoch/status consistent → executeInterrogate(read, print ctx) digest reflects
    them (answered count / skipped-if-closed semantics per fallback.test.ts).
  - WRITE pi -p one-shot probe recipe into AC-RESULTS.md (do NOT run a hanging
    live probe; optional smoke only if trivially scriptable offline).

Task 5: AC-13 "archived_edit_re_pends_and_diff_flags_changed"
  - close a question (lifecycle) → applyAnswer on the closed id → assert status
    back to "answered"(pending) and rev untouched → submit → diff entry for it
    has editedArchived:true and old/new values; renderer string contains
    "(changed)" (renderers.ts submission diff card).

Task 6: AC-14 state side "completion_record_once"
  - Drive all questions to closed (answers + submissions + close passes, or
    lifecycle's completion trigger seam if exposed) → assert buildCompletion
    content (full record: goal, groups, answers) and the completion path fires
    exactly once; second trigger attempt injects nothing (completion.ts
    exactly-once flag / completed state).

Task 7: RESULTS + fixes
  - WRITE plan/001_0d6760db6bc5/P1M7T6S1/research/AC-RESULTS.md: table
    (AC | scripted test | pass/fail | FR proven | notes), defect log (defect →
    owning module → fix), interactive leftovers list (AC-1,4,5,6,7,9,10,12 →
    human runbook / P1.M7.T5.S2 / T6.S2), pi -p probe recipe.
  - FIX defects in owning modules as discovered; add regression coverage in the
    SAME module's existing unit test file (additive-only) where the defect is
    unit-level; keep the AC-level assertion in ac-scripted.test.ts.
  - README limitation updates ONLY if behavior deviates [Mode A].
```

### Implementation Patterns & Key Details

```ts
// Same-path driver pattern (AUTOMATION-POLICY "what to do instead"):
import { executeInterrogate } from "./tool.js";
const res = executeInterrogate(upsertFixture, { mode: "tui", hasUI: true }, config);
// stale path: await expect/promise rejection style — executor THROWS StaleError
expect(() => executeInterrogate(staleUpsert, ctx, config)).toThrow(StaleError);

// Debug-handler pattern (debug-commands.test.ts): register into a spy pi,
// capture handler, invoke with (args, mockCtx) and assert notify content —
// use for AC-8's verbatim stale message surfacing.

// Lifecycle driver: const pi = { on: vi.fn() }; createLifecycle(pi); grab the
// captured event handlers; close-pass is driven by the agent_settled flow the
// lifecycle subscribes to (see lifecycle.test.ts for the exact emission).
```

### Integration Points

```yaml
DOCS: [Mode A] results in-plan only (research/AC-RESULTS.md + test JSDoc).
      README (P1.M7.T7.S1) touched ONLY if a defect reveals behavioral deviation.
HANDOFF: AC-RESULTS.md consumed by P1.M7.T6.S2 (scripted panel AC pass) and
         P1.M7.T7 docs tasks.
NO new config, no new runtime modules — this is verification + targeted fixes.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck        # tsc --noEmit — expected clean
```

### Level 2: The AC suite (core gate)

```bash
npx vitest run src/ac-scripted.test.ts -v     # every AC test green
npm test                                      # full suite, no regressions
```

### Level 3: Headless probe (optional, non-blocking)

```bash
# AC-11 probe recipe (document, run only if environment supports it without
# network/hang): pi -p with the extension loaded, one-shot prompt that would
# upsert; assert digest in stdout. NEVER interactive; timeout-guard any attempt.
```

### Level 4: Results recording

- [ ] AC-RESULTS.md complete with per-AC verdicts + FR citations + defect log.

## Final Validation Checklist

- [ ] AC-2, AC-3, AC-8, AC-11, AC-13, AC-14-state each proven by a named test
- [ ] Results table [Mode A] written; defects fixed in owning modules and logged
- [ ] Interactive leftovers enumerated → MANUAL-TUI-AC-RUNBOOK.md (never executed)
- [ ] No live TUI, no real interrogate call, no turn ending on user input
      (AUTOMATION-POLICY.md)
- [ ] `npm test` green; `npm run typecheck` clean; no edits to PRD/tasks.json
- [ ] No conflicts with P1.M7.T5.S2 files (config-surface/no-hardcoded-keys tests)

## Anti-Patterns to Avoid

- ❌ Don't re-implement flow logic in tests — drive executeInterrogate /
  buildSubmission / lifecycle exactly as production does (h2.50 same-path rule)
- ❌ Don't double-bump epoch by calling takeSnapshot/bumpEpoch before
  buildSubmission
- ❌ Don't mark an AC passed by asserting a unit-level proxy when the AC
  describes an end-to-end flow — drive the full path
- ❌ Don't hide defects in test expectations — fix the owning module
- ❌ Don't run any interactive pi session; pi -p only, timeout-guarded, optional

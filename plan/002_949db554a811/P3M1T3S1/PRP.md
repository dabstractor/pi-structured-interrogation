---
name: "P3.M1.T3.S1 — Flip tree-nav-repro read-pop characterizations to no-open; add AC-15 (reads never surface) scripted test (SURFACE-001 / FR-28 / R6)"
description: "src/tree-nav-repro.test.ts holds two BUG characterizations of pre-gate maybeAutoOpen behavior: 'post-nav agent READ (interrogate {})' (test at :175, assertion :199) and 'post-nav agent READ after completion' (test at :206, assertion :229) — both assert `expect(surface.customCalls.length).toBe(1)` and BOTH CURRENTLY FAIL because P3.M1.T1.S1's gated maybeAutoOpen already returns early on pure reads. This PRP flips those assertions to `.toBe(0)`, retitles them from BUG characterizations to SURFACE-001 regression pins (reads NEVER surface), and adds the AC-15 scripted test to src/ac-scripted.test.ts per the file's AC-naming/FR-citation convention: with a live interrogation (panel suspended, questions open), a model `interrogate({})` read completes → panel stays closed and the editor text untouched; same for all-answered and completed states. The suspended-at-nav (:117) and open-at-nav (:151) tests MUST stay green and unmodified. Test-only; no production code changes."
---

## Goal

**Feature Goal**: Prove AC-15 / SURFACE-001 / FR-28 (PRD h2.10 #15, h2.37, h2.8/h3.4, h2.53): "Pure reads never surface, regardless of state" — the tree-nav BUG characterizations become regression pins asserting NO panel open on reads, and AC-15 gets a scripted test in ac-scripted.test.ts citing FR-28/SURFACE-001.

**Deliverable**:
1. `src/tree-nav-repro.test.ts`: the two read-pop tests flipped `1 → 0 customCalls`, retitled to no-open regression pins (drop "BUG — characterization" wording, cite SURFACE-001).
2. `src/ac-scripted.test.ts`: new `AC-15_*` tests covering the three states (open-questions suspended, all-answered, completed) with editor-untouched assertions.

**Success Definition**: `npx vitest run src/tree-nav-repro.test.ts src/ac-scripted.test.ts` fully green (the two currently-failing flips now pass, suspended-at-nav/open-at-nav stay green); `npm run typecheck` clean; AC-15 recorded as PASS/FR-28 in ac-scripted.test.ts's results header table; NO production files modified. Output consumed by P4.M1.T1.S1 (full-suite sweep).

## User Persona

**Target User**: Interrogation user who navigated `/tree`, had their prompt box text restored, and is mid-turn with the model re-orienting via `interrogate({})`.

**Use Case**: The model does a pure read to refresh state. Before the SURFACE-001 gates this popped the panel over the user's prompt box — and because pi's `custom()` snapshots/restores editor text, every unplanned pop was a data-loss trap (the empty-box-after-esc symptom, PRD h2.37 rationale).

**User Journey**: user navigates tree → model re-orients with a read → NOTHING visibly changes (no panel, editor text preserved) → the user's turn continues undisturbed; the panel returns only via the allow-list (`/interrogate`, unanswered-leaving upsert, `{reopen:true}`).

**Pain Points Addressed**: unplanned panel pops replacing the prompt box mid-turn; data loss from editor snapshot/restore collisions.

## Why

- PRD h2.10 AC-15: "**Reads never surface (SURFACE-001)**: with a live interrogation (panel suspended, questions open), a model `interrogate({})` read completes → panel stays closed, editor untouched; the same holds for all-answered and completed states (src/tree-nav-repro.test.ts characterizations flip to fixed)."
- PRD h2.37 allow-list + h2.8/h3.4 FR-28: "No event other than `/interrogate`, an agent upsert leaving unanswered questions, or `{reopen:true}` may open the panel — **reads never surface, whatever the state** (SURFACE-001)."
- PRD h2.53 AC runbook: "AC-15 (reads never surface) proves R6/SURFACE-001" — scripted in automation.
- Architecture ledger `plan/002_949db554a811/architecture/surfacing-remote-seams.md` §"Test-flip ledger" (rows :141-143) is the authoritative before→after map this PRP executes (row :143: the two nav-time tests stay green, UNCHANGED).

## What

### Behavior under test (already implemented upstream — this item only PINS it)

`maybeAutoOpen` (`src/panel/panel.ts:1836`) gates on: (1) upsert-call via `peekArgs` over the `pendingUpsertArgs` start-phase stash (default `() => undefined` ⇒ every unwired call classifies as READ ⇒ no open), (2) unanswered-exist (`nextUnanswered(ordered, -1)`, UNANSWERED_STATUSES = open/reasked only), (3) `!state.completed`. `handleUpserted`'s suspended branch (P3.M1.T2.S1, panel.ts:1466) carries the same unanswered gate. A pure `{}` read fails gate (1) in every state — open, all-answered, completed, or no state at all.

### Success Criteria

- [ ] tree-nav-repro read test (:175) asserts `customCalls.length === 0`; retitled e.g. `"post-nav agent READ (interrogate {}): panel stays closed (SURFACE-001 — reads never surface)"`; comment rewritten from "BUG characterization" to regression-pin rationale citing FR-28/SURFACE-001.
- [ ] tree-nav-repro completed-read test (:206) asserts `customCalls.length === 0`; retitled similarly; the `clearForCompletion()` completed-singleton setup is KEPT (it is exactly the ghost-state trap gate (3) blocks).
- [ ] tree-nav-repro suspended-at-nav (:117) and open-at-nav (:151) tests UNTOUCHED and green.
- [ ] ac-scripted.test.ts gains AC-15 tests in the file's naming/FR-citation convention, one per state (open/suspended, all-answered, completed), each asserting no panel open AND editor text untouched; header results table gains `AC-15 | PASS | FR-28/SURFACE-001` row.
- [ ] No production files modified; typecheck clean.

## All Needed Context

### Context Completeness Check

Validated: exact current test bodies and line anchors (test decls :175/:206; assertions :199/:229 — note the file's line numbers have drifted ~30 lines below the architecture ledger's :143/:183; the ledger's anchors are the same two tests), the current failing status (verified by running the suite), the FakeTuiSurface/FakeLifecycle harness reuse recipe, the AC naming/docblock convention from ac-scripted.test.ts, and the boundary against sibling items (T1.S1/T2.S1 own production gates; P3.M2 owns reconstruction flips — reconstruct.test.ts/ac-panel.test.ts rows are NOT ours).

### Documentation & References

```yaml
- file: src/tree-nav-repro.test.ts
  why: the file being flipped — FakeTuiSurface (savedText semantics, customCalls), FakeLifecycle, seeded()/allAnswered() builders, and the pi handler-map pattern (:179-193) used by the read test
  pattern: both read tests already call maybeAutoOpen(pi, DEFAULT_CONFIG, host, drafts) then fire the tool_execution_end handler with { toolName: "interrogate", isError: false }; ONLY the final expect and the title/comments change
  gotcha: do NOT restructure the tests beyond title/comment/assertion — the setups (all-answered state; clearForCompletion ghost) are the point. The read test with a REAL interrogation is exercised in ac-scripted; here the state shapes are fine.

- file: src/ac-scripted.test.ts
  why: AC naming/FR-citation pattern — header results table (lines ~14-37: `| AC-2| PASS | FR-3 | AC-2_submission_delta... |`), section banners like `// ------ AC-2 (FR-3)`, describe titles `describe("AC-2 — ... (FR-3)", ...)`, test names `AC-2_submission_delta_three_lines_reminder_epoch_27_open`, and the makeThirtyQuestions group-layout helper (:66) if needed
  pattern: add `// ------ AC-15 (FR-28 / SURFACE-001)` banner + `describe("AC-15 — reads never surface (FR-28, SURFACE-001 / R6)", ...)` + tests named `AC-15_read_with_open_questions_panel_stays_closed_editor_untouched` etc.
  gotcha: results table also lists which ACs are deferred to MANUAL-TUI-AC-RUNBOOK.md — AC-15 is scripted, so it must appear in the PASS table, not the runbook list. Update the table row; keep alphabetical/numeric order.

- file: src/panel/panel.ts
  why: READ-ONLY reference — maybeAutoOpen (:1836) and its gate JSDoc (:1746-1835) documenting peek-only args access and the read-conservative default; gate (1) is why unwired test surfaces see reads as reads
  pattern: default `peekArgs = () => undefined` means the ac-scripted FakePi/mocks need NO stash wiring to prove read-no-open — the production wiring already defaults conservative
  gotcha: do not modify this file; the gates landed with P3.M1.T1.S1 (Complete) and P3.M1.T2.S1 (in flight, parallel — its handleUpserted gate does not affect read paths)

- file: src/tree-nav-repro.test.ts FakeTuiSurface
  why: reuse for editor-untouched assertions in ac-scripted — set `surface.editorText` to a sentinel (e.g. "old prompt") before the read, assert it is unchanged after
  gotcha: pi's editor-restore semantics only fire on custom() open/done — if the panel never opens, editorText is never touched; asserting the sentinel survives IS the "editor untouched" proof

- file: plan/002_949db554a811/architecture/surfacing-remote-seams.md
  why: §"Test-flip ledger" rows :141-143 — authoritative flip map; row :143 mandates the two nav-time tests stay green; rows :144+ (reconstruct/ac-panel) belong to P3.M2 — DO NOT flip those here
  section: Test-flip ledger (before → after)

- file: plan/002_949db554a811/P3M1T2S1/PRP.md
  why: the parallel sibling contract — its handleUpserted gate (nextUnanswered predicate, suspended-branch-only) is upstream context; no overlap: read paths bypass handleUpserted entirely (no questions-upserted event on a read)

- file: plan/002_949db554a811/P3M1T1S1/PRP.md
  why: the completed maybeAutoOpen gates contract this PRP pins (upsert-call, unanswered-exist, not-completed)
```

### Current Codebase tree (relevant slice)

```bash
src/tree-nav-repro.test.ts   # MODIFY — flip :199 and :229 to .toBe(0); retitle/rewrite comments as regression pins
src/ac-scripted.test.ts      # MODIFY — add AC-15 describe + three scripted state tests + results-table row
src/panel/panel.ts           # READ-ONLY — gated maybeAutoOpen (landed P3.M1.T1.S1)
```

### Desired Codebase tree with file responsibilities

```bash
src/tree-nav-repro.test.ts   # SURFACE-001 regression pins: reads never pop the panel (open/all-answered/completed ghosts)
src/ac-scripted.test.ts      # AC-15 scripted proof: live/suspended read → no panel, editor untouched; all-answered; completed
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: the two tree-nav tests are CURRENTLY FAILING (verified:
// "2 failed | 2 passed") — T1.S1's gates already changed behavior; this PRP
// completes the flip the ledger mandates. Expect :199/:229 to fail BEFORE
// your edit and pass after.
// GOTCHA: ledger line anchors (:143/:183) predate T1.S1 edits — the tests
// now live at :175/:206 with assertions at :199/:229; locate by title, not line.
// GOTCHA: maybeAutoOpen's default peekArgs classifies EVERY call as a read —
// ac-scripted tests need NO pendingUpsertArgs wiring; conversely a test that
// wanted upsert-opens must wire the stash (NOT this PRP's job).
// GOTCHA: pi.on handlers receive (event, ctx) — the FakeTuiSurface is passed
// as ctx; the read tests already follow this shape.
// GOTCHA: awaiting `new Promise<void>((r) => setImmediate(r))` (microtask
// flush) after firing the handler is required before asserting — the panel
// open path is async. Follow the existing tests verbatim.
// GOTCHA: clearForCompletion() keeps the singleton installed with
// completed=true and zero questions — that ghost setup is the POINT of the
// completed test; keep it.
// GOTCHA: do NOT touch reconstruct.test.ts / ac-panel.test.ts "opened:true"
// rows — those are P3.M2.T2.S1's (SURFACE-002), not AC-15's.
// GOTCHA: never launch a live pi TUI (AUTOMATION-POLICY); all tests use the
// fake-surface harnesses already in these files.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: FLIP src/tree-nav-repro.test.ts read test (:175)
  - RENAME: "post-nav agent READ (interrogate {}): maybeAutoOpen POPS the panel (BUG — characterization)"
    → "post-nav agent READ (interrogate {}): panel stays closed (SURFACE-001 — reads never surface)"
  - FLIP assertion :199: expect(surface.customCalls.length).toBe(1) → .toBe(0)
  - REWRITE the trailing comment block (currently narrates "This is the unwanted surface") to a
    regression-pin rationale: reads are pull, never surfaces (FR-28/SURFACE-001, allow-list h2.37);
    maybeAutoOpen gate (1) classifies non-upsert calls as reads; the empty-box-after-esc data-loss
    trap is why. KEEP the setup verbatim (all-answered state, editorText clearing, handler fire,
    setImmediate flush).

Task 2: FLIP src/tree-nav-repro.test.ts completed-read test (:206)
  - RENAME: "post-nav agent READ after completion: state still installed → panel POPS (BUG)"
    → "post-nav agent READ after completion: ghost singleton surfaces nothing (SURFACE-001)"
  - FLIP assertion :229: .toBe(1) → .toBe(0)
  - KEEP the clearForCompletion() ghost-singleton setup and its explanatory comment (update only the
    "POPS"/"BUG" wording; note gates (1)+(3) each independently block this).
  - VERIFY :117 (suspended-at-nav) and :151 (open-at-nav) remain byte-identical.

Task 3: ADD AC-15 to src/ac-scripted.test.ts
  - HEADER: add results-table row `| AC-15| PASS | FR-28/SURFACE-001 | AC-15_read_with_open_questions... |`
    in numeric position; do NOT add AC-15 to the MANUAL-TUI-AC-RUNBOOK deferral list.
  - SECTION: `// ------ AC-15 (FR-28 / SURFACE-001)` banner + `describe("AC-15 — reads never surface (FR-28, SURFACE-001 / R6)", ...)`.
  - TEST 1 `AC-15_read_with_live_open_questions_panel_stays_closed_editor_untouched`:
    resetState(); setState(seeded-with-OPEN questions state); build a suspended host
    (openPanel → factoryDone(null) → flush, mirroring tree-nav's suspension recipe); set
    surface.editorText = "old prompt"; wire maybeAutoOpen with a handler-map FakePi
    (reuse tree-nav-repro's `pi` object pattern, or import/copy the minimal shape); fire
    pi.handlers.get("tool_execution_end")({ toolName: "interrogate", isError: false }, surface);
    await setImmediate flush; expect surface.customCalls.length === 0 AND
    surface.editorText === "old prompt" AND host still suspended.
  - TEST 2 `AC-15_read_all_answered_no_surface`: same shape with allAnswered()-style state
    (every question status answered) → customCalls 0, editorText sentinel unchanged.
  - TEST 3 `AC-15_read_completed_state_no_surface`: state.clearForCompletion() ghost →
    customCalls 0, editorText sentinel unchanged.
  - NAMING: AC-15_{scenario} snake_case per file convention; cite FR-28/SURFACE-001 in the
    describe title and a short docblock (the file's convention).
  - PLACEMENT: after the last existing AC section (file ends with AC-14 area); follow
    existing section-banner spacing.

Task 4: VALIDATE
  - npm run typecheck
  - npx vitest run src/tree-nav-repro.test.ts -v   # 4/4 pass
  - npx vitest run src/ac-scripted.test.ts -v      # all pass incl. new AC-15
  - npx vitest run                                  # note any remaining failures: they belong
    to P3.M1.T2.S1 (if mid-flight) or P3.M2 (reconstruction/ac-panel opened:true rows) —
    do not fix here
```

### Implementation Patterns & Key Details

```ts
// The flipped assertion pattern (both tree-nav read tests):
expect(surface.customCalls.length).toBe(0); // SURFACE-001: reads NEVER surface (FR-28)
expect(surface.editorText).toBe(/* whatever the scenario left — unchanged */);

// AC-15 core shape (per state):
test("AC-15_read_with_live_open_questions_panel_stays_closed_editor_untouched", async () => {
  resetState();
  setState(openQuestionsState());           // q1/q2 status "open" — a LIVE interrogation
  const surface = new FakeTuiSurface();
  const host = createPanelHost(new FakeLifecycle(), surface);
  openPanel(surface, { config: DEFAULT_CONFIG, state: getState()!, drafts: new DraftStore() });
  surface.customCalls[0]!.factoryDone(null);          // esc suspend
  await new Promise<void>((r) => setImmediate(r));
  expect(host.isSuspended()).toBe(true);

  surface.editorText = "old prompt";                  // sentinel: editor untouched by the read
  maybeAutoOpen(piWithHandlerMap, DEFAULT_CONFIG, host, new DraftStore());
  piWithHandlerMap.handlers.get("tool_execution_end")!({ toolName: "interrogate", isError: false }, surface);
  await new Promise<void>((r) => setImmediate(r));

  expect(surface.customCalls.length).toBe(0);         // SURFACE-001 / FR-28
  expect(surface.editorText).toBe("old prompt");      // editor untouched
});
// NOTE: whether FakeTuiSurface/FakeLifecycle are importable or must be minimally
// re-declared depends on whether tree-nav-repro exports them (it does NOT today —
// classes are file-local). EITHER re-declare the minimal surface shape in
// ac-scripted.test.ts OR move nothing — do NOT refactor tree-nav-repro to export
// helpers unless trivial; a local minimal FakeSurface (implements PiUISurface with
// customCalls/editorText) is the smaller change.
```

### Integration Points

```yaml
UPSTREAM (contracts consumed, already/imminently landed):
  - P3.M1.T1.S1 (Complete): gated maybeAutoOpen — gate (1) upsert-call via peekArgs,
    gate (2) nextUnanswered, gate (3) !state.completed
  - P3.M1.T2.S1 (implementing in parallel): handleUpserted suspended-reopen gate —
    orthogonal to read paths (reads emit no questions-upserted event); no ordering
    dependency for THIS item's tests
DOWNSTREAM:
  - P4.M1.T1.S1 full-suite sweep expects tree-nav-repro 4/4 + AC-15 green
OUT OF SCOPE:
  - reconstruct.test.ts / ac-panel.test.ts opened:true flips (P3.M2.T2.S1, SURFACE-002)
  - any production file; the results-table AC-15 row is the only doc-adjacent change
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # expect clean (test files are typechecked)
```

### Level 2: Unit Tests

```bash
npx vitest run src/tree-nav-repro.test.ts -v    # 4/4: two flipped pins + two unchanged nav tests
npx vitest run src/ac-scripted.test.ts -v       # existing ACs green + 3 new AC-15 tests
npx vitest run src/tree-nav-repro.test.ts src/ac-scripted.test.ts
```

### Level 3: Boundary check

```bash
git diff --stat   # ONLY the two test files changed
grep -rn "opened" src/reconstruct.test.ts | grep -c "toBe(true)"   # untouched (P3.M2 owns)
```

## Final Validation Checklist

- [ ] `npx vitest run src/tree-nav-repro.test.ts` → 4/4 (was 2/4).
- [ ] Both read tests assert `.toBe(0)`, retitled as SURFACE-001 regression pins; ghost/completed setup preserved.
- [ ] Suspended-at-nav (:117) and open-at-nav (:151) byte-identical and green.
- [ ] ac-scripted.test.ts: three AC-15 tests (live-open, all-answered, completed) with no-open + editor-untouched assertions; results-table row `AC-15 | PASS | FR-28/SURFACE-001`; NOT in the manual-runbook deferral list.
- [ ] `npm run typecheck` clean; full-suite remaining failures attributable only to P3.M1.T2.S1/P3.M2 items.
- [ ] No production files, no reconstruct/ac-panel flips, no spec/docs changes (behavior docs ride with P3.M1.T1.S1 Mode A).

## Anti-Patterns to Avoid

- ❌ Don't weaken the nav-time tests or delete the ghost-state setup — the setup IS the regression coverage.
- ❌ Don't "fix" the tests by wiring pendingUpsertArgs to make them open — reads must stay reads.
- ❌ Don't touch reconstruct.test.ts/ac-panel.test.ts `opened:true` rows (SURFACE-002, P3.M2's flip ledger rows).
- ❌ Don't refactor tree-nav-repro's fakes into shared exports unless trivial — a local minimal surface in ac-scripted is fine.
- ❌ Don't skip the setImmediate flush — the assert-before-flush race makes tests flaky-fail.
- ❌ Don't modify maybeAutoOpen/handleUpserted to make tests pass — the gates are the upstream contract.

---
name: "P1.M7.T6.S2 — Scripted panel AC pass (interactive TUI ACs moved to human-only runbook)"
description: Prove the UI-level acceptance criteria (AC-1 render, AC-4 suspend→widget→reopen draft survival, AC-5 deep scroll + select-from-deep, AC-6 moot + ⊘, AC-7 ripple confirm enter/esc, AC-9 auto-open on reconstruction, AC-10 compact handler output, AC-12 key remap footer labels) as scripted vitest tests over the panel/render components with fake tui/theme/keybindings. Genuinely interactive-only checks (real editor focus, real process restart) stay in MANUAL-TUI-AC-RUNBOOK.md (human-only, out of pipeline scope). This suite is the gate for P1.M7.T7 docs.
---

## Goal

**Feature Goal**: Cover the UI-level ACs from h2.10 in vitest against the
panel/render components with fake `tui`/`theme`/`KeybindingsManager` — proving
AC-1 (render/width), AC-4 (draft survival across suspend/reopen), AC-5 (deep
scroll + select-from-deep), AC-6 (instant moot + ⊘), AC-7 (ripple confirm
enter/esc), AC-9 (reconstruction → auto-open), AC-10 (compact handler output),
AC-12 (remap → footer labels) — while NEVER opening a live panel, NEVER calling
the `interrogate` tool for real, NEVER waiting for user answers
(plan/001_0d6760db6bc5/AUTOMATION-POLICY.md is BINDING).

**Deliverable**:
1. `src/panel/ac-panel.test.ts` — the scripted panel AC suite, dependency
   ordered, with a per-AC results table in the file JSDoc header [Mode A]:
   AC → scripted test name → pass → FR proven → evidence.
2. `plan/001_0d6760db6bc5/P1M7T6S2/research/PANEL-AC-RESULTS.md` — results
   table + defect log (defect → owning module → fix) + explicit list of
   interactive-only residuals pointed at MANUAL-TUI-AC-RUNBOOK.md.
3. Targeted defect fixes in the owning `src/panel/*` / `src/renderers.ts` /
   `src/compaction.ts` / `src/reconstruct.ts` modules as discovered
   (additive-only; never edit `src/config-surface.test.ts` or
   `src/no-hardcoded-keys.test.ts` owned by P1.M7.T5.S2, or
   `src/ac-scripted.test.ts` owned by P1.M7.T6.S1).

**Success Definition**: `npm test` fully green including the new panel AC suite;
every targeted AC has a named passing test or an explicit recorded FAIL with a
defect note and fix; residual interactive checks enumerated for the human
runbook; `npm run typecheck` clean. P1.M7.T7 (docs) is unblocked.

## Why

- h2.10 + h2.50 AUTOMATION AMENDMENT: "In automation, ACs are proven by
  scripted tests; interactive-only ACs are deferred to the human runbook and
  never block the pipeline." This task IS that scripted UI proof.
- Consumes: M3–M6 panel stack (`src/panel/*`), M7 persistence/compaction
  (`src/reconstruct.ts`, `src/compaction.ts`), renderers (`src/renderers.ts`),
  and `plan/001_0d6760db6bc5/P1M7T6S1/research/AC-RESULTS.md` (state-side
  results + fixture style from P1.M7.T6.S1 — treat that PRP as contract; its
  `src/ac-scripted.test.ts` fixture builders are reusable patterns).
- Gates P1.M7.T7 documentation (README records AC coverage).

## What

Scripted, component-level (no live TUI) coverage:

- **AC-1 (render proof)**: upsert 30 questions / 4 groups / one gate group →
  `InterrogationPanel` renders: gate group focused, other groups present and
  dim-styled, header/question/footer all within the width budget at 40/60/80/120
  cols via `visibleWidth` sweeps.
- **AC-4 (scripted side)**: suspend via `done(null)` → widget appears with
  counts → reopen via resume path → question drafts intact (draft-store slots
  unchanged) AND main-editor preservation seam intact
  (`src/panel/editor-preservation.ts`). Live "real editor focus" residual →
  runbook.
- **AC-5**: deep view toggled → scroll through all ramifications (drive the
  deep-view scroll offset across the full range) → select an option from deep
  view → view returns to short form, selection applied, cursor advanced.
- **AC-6**: answer a gate question contrary to a `dependsOn` → dependent
  question's UI state goes moot with reason INSTANTLY (synchronous state
  evaluation after the answer, no agent round-trip) → overview renders ⊘.
- **AC-7**: edit an answered question invalidating 3 others → ripple confirm
  rendered → ESC → no state change; re-enter → applied (invalidated answers
  removed/kept per FR-18/Q39=B).
- **AC-9 (scripted side)**: reconstruction from fixture entries (tool-result
  details + deltas + entry-mirror fallback) → `maybeAutoOpen` invoked on the
  session-start path → panel host opened non-blocking. Real process restart
  residual → runbook.
- **AC-10 (scripted side)**: `session_before_compact` handler output preserves
  user plan statements; a subsequent read returns full state (compaction.test.ts
  exists — prove the handler OUTPUT content + read-after-compact consistency in
  the AC style). Live `/compact` residual → runbook.
- **AC-12**: build config with a remapped hotkey (e.g. remap
  `deepViewToggle`) → `resolveKeyLabels` / footer renders the NEW label
  everywhere it appears (footer + hint line), no stale default label.

### Success Criteria

- [ ] Each listed AC has ≥1 named test asserting the concrete AC language
      ("within width budget", "drafts intact", "returns to short form",
      "instantly", "enter applies / esc cancels", "auto-open", "labels change").
- [ ] Per-AC results table in file JSDoc [Mode A] citing the FR proven.
- [ ] Defects fixed in owning modules (not papered over in tests), recorded.
- [ ] Interactive residuals enumerated → MANUAL-TUI-AC-RUNBOOK.md; pipeline
      never blocked on them.
- [ ] Full `npm test` green; `npm run typecheck` clean.

## All Needed Context

### Context Completeness Check

An implementer knowing nothing about this codebase can build this entirely from
the PRP plus the cited files: every component under test is exported, every
mock pattern (fake tui/theme/KeybindingsManager, `ui.custom` capture,
`done(null)` suspend) has a working precedent in `src/panel/panel.test.ts`.

### Documentation & References

```yaml
- file: src/panel/panel.test.ts
  why: THE pattern file — createPanelHost/openPanel, InterrogationPanel lifecycle,
        ui.custom mock capturing factory + done callback, never-resolving
        promise until done(), stubTheme (fg/bold identity), fixture builder
        choiceQ, module-scoped host re-arm per test
  pattern: copy its imports (resetState/setState/createInterrogationState,
           DEFAULT_CONFIG, resolveKeyLabels from ../config.js), key constants
           (CTRL_D/CTRL_L/ESCAPE), vi.mock of ../external-editor.js
  gotcha: panel host record is module-scoped — every test re-arms via
          createPanelHost(...) first

- file: src/panel/layout.ts + src/panel/layout.test.ts
  why: renderHeader/renderQuestionLine/renderFooter/renderHintLine — AC-1 width
        assertions and AC-12 label assertions run against these
  pattern: layout.test.ts shows render(width) + visibleWidth assertion style

- file: src/config.ts
  why: DEFAULT_CONFIG, resolveKeyLabels — AC-12: deep-merge a remap into a
        config clone and assert footer/hint strings change
  gotcha: labels are resolved centrally (resolveKeyLabels), footer must not
          hardcode default key names (P1.M7.T5.S2's no-hardcoded-keys test
          guards this — do not edit that file)

- file: src/panel/deep-view.ts + src/panel/deep-view.test.ts
  why: AC-5 — scrollable deep view, sticky headers, select-from-deep returns to
        short form; deep-view.ts:39 notes render(width) carries NO height —
        DEEP_VIEW height is a constant
  pattern: drive scroll offset through full range; assert selected option
           propagates + view resets to short

- file: src/panel/gate.ts + src/panel/gate.test.ts
  why: AC-1 gate group focus/dimming + AC-6 gate semantics surface

- file: src/panel/ripple-confirm.ts + src/panel/ripple-confirm.test.ts
  why: AC-7 — enter=keep / esc=cancel contract; follow its key-event driving
        pattern for ESC/ENTER handling

- file: src/panel/overview.ts + src/panel/overview.test.ts
  why: AC-6 ⊘ marker for moot questions + archived markers (AC-3 overlap —
        assert only the rendering here)

- file: src/panel/suspend.ts + src/panel/suspend.test.ts
  why: AC-4 — done(null) suspend, widget with counts, resume rehydration

- file: src/panel/editor-preservation.ts + .test.ts
  why: AC-4 main-editor draft preservation seam

- file: src/panel/keys.ts + src/panel/keys.test.ts
  why: config-driven dispatch, intercept-before-forward, esc descent — drive
        key events through this for AC-5/AC-7 navigation

- file: src/panel/terminal-budget.ts
  why: AC-1 width-budget math — reuse its helpers for the ≤width assertions

- file: src/reconstruct.ts + src/reconstruct.test.ts
  why: AC-9 — reconstruction from fixture entries + maybeAutoOpen seam

- file: src/compaction.ts + src/compaction.test.ts
  why: AC-10 — session_before_compact handler output (preservation
        instructions/user plan statements); assert output content and that
        read-after-compact returns full state

- file: src/renderers.ts + src/renderers.test.ts
  why: compact-handler output / recap card rendering surfaces

- file: plan/001_0d6760db6bc5/P1M7T6S1/PRP.md + research/AC-RESULTS.md
  why: parallel-sibling contract — state-side AC suite (src/ac-scripted.test.ts);
        reuse its 30-question fixture shape; DO NOT duplicate its ACs
        (AC-2,3,8,11,13,14-state) or edit its file

- file: plan/001_0d6760db6bc5/AUTOMATION-POLICY.md
  why: BINDING — never live TUI, never interrogate-for-real, never wait for
        answers; the scripted-equivalents table defines exactly these test
        patterns (render(width) + visibleWidth sweeps, ui.custom capture)

- file: plan/001_0d6760db6bc5/MANUAL-TUI-AC-RUNBOOK.md
  why: human-only residuals; enumerate, never execute, never edit its checklists
```

### Current Codebase tree (relevant slice)

```bash
src/panel/  panel.ts panel.test.ts layout(+test) short-view(+test) keys(+test)
            text-field(+test) two-stage.test actions(+test) deep-view(+test)
            overview(+test) gate(+test) ripple-confirm(+test) suspend(+test)
            discuss(+test) editor-preservation(+test) terminal-budget(+test)
src/        reconstruct.ts/.test compaction.ts/.test renderers.ts/.test
            config.ts/.test state.ts draft-store.ts ac-scripted.test.ts (T6.S1)
```

### Desired Codebase tree with files to be added

```bash
src/panel/ac-panel.test.ts        # NEW: scripted panel AC suite (this task)
plan/001_0d6760db6bc5/P1M7T6S2/
  research/PANEL-AC-RESULTS.md    # NEW: results table + defect log + residuals
# owning modules MODIFIED only where defects are found
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL (AUTOMATION-POLICY, binding): no live pi -e ., no real interrogate
// call, no waiting for user input. Every "observe the panel" step becomes a
// render(width) + assertion in vitest.

// GOTCHA: panel host is module-scoped — re-arm createPanelHost(...) in every
// test (panel.test.ts header documents this).

// GOTCHA: render(width) has NO height parameter; deep-view uses a constant
// height (deep-view.ts:39) — scroll-range assertions use that constant.

// GOTCHA: state is a module SINGLETON — beforeEach resetState() like
// panel.test.ts / debug-commands.test.ts.

// GOTCHA: theme must be the identity stubTheme {fg:(_n,s)=>s, bold:s=>s} cast
// as unknown as Theme or layout renderers throw in tests.

// GOTCHA: vi.mock("../external-editor.js") at module boundary (panel.test.ts
// pattern); never let a test spawn a real $EDITOR.

// GOTCHA: AC-6 "instantly" = synchronous dependsOn re-evaluation on
// applyAnswer — no lifecycle/agent event involved; assert the dependent's UI
// state + overview ⊘ in the same tick.

// Concurrency: P1.M7.T6.S1 (ac-scripted.test.ts) and P1.M7.T5.S2
// (config-surface/no-hardcoded-keys tests) land in parallel — additive-only
// everywhere; this task creates ONE new test file + research notes.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/panel/ac-panel.test.ts — scaffold + AC-1
  - COPY scaffolding from panel.test.ts: imports, vi.mock(external-editor),
    stubTheme, key constants, beforeEach { resetState(); createPanelHost(...) }.
  - BUILD fixture: 30 questions (q01..q30) across 4 groups, one gate group, ≥1
    dependsOn edge (mirror P1.M7.T6.S1's fixture shape from AC-RESULTS.md).
  - AC-1 "ac1_thirty_questions_gate_renders_within_width": seed state →
    InterrogationPanel render at widths [40,60,80,120] → every rendered line
    passes visibleWidth ≤ width (terminal-budget helpers); gate group focused,
    non-gate groups present with dim styling applied; footer present.

Task 2: AC-12 "ac12_remap_changes_footer_labels"
  - DEEP-merge a config clone remapping one hotkey (e.g. deepViewToggle) →
    resolveKeyLabels(config) → renderFooter + renderHintLine contain the NEW
    label and NOT the default → assert across panel footer render too.

Task 3: AC-6 "ac6_contrary_gate_answer_instant_moot_and_slash_O"
  - Answer the gate question contrary to a dependsOn (through the panel action
    seam / applyAnswer) → SAME TICK: dependent UI state moot with reason,
    overview render line contains ⊘.

Task 4: AC-7 "ac7_ripple_confirm_esc_cancel_enter_apply"
  - Edit an answered question invalidating 3 others → ripple confirm view
    rendered (names the 3) → drive ESC through keys dispatch → zero state
    change (snapshot compare) → re-enter confirm → drive ENTER → invalidation
    applied per FR-18.

Task 5: AC-5 "ac5_deep_scroll_and_select_from_deep"
  - Toggle deep view → scroll offset across the FULL range (assert last
    ramifications reachable) → select an option from deep → view returns to
    short form, option recorded, cursor advanced.

Task 6: AC-4 "ac4_suspend_widget_reopen_drafts_survive"
  - Open panel, set drafts (draft-store slots + text-field contents) →
    done(null) suspend → widget render shows open/answered counts → invoke
    resume/reopen path → drafts byte-identical; editor-preservation seam
    returns the preserved main-editor draft.

Task 7: AC-9 "ac9_reconstruction_auto_opens_panel"
  - reconstructFrom fixture entries (tool-result details, deltas, and the
    entry-mirror fallback variant) → session-start path calls maybeAutoOpen →
    host opened (non-blocking); assert opened state + reconstructed
    questions/answers counts.

Task 8: AC-10 "ac10_compact_preserves_user_plan_statements"
  - Run the session_before_compact handler (compaction.ts seam with mock pi
    context) → output contains the user plan statements / preservation
    instructions → subsequent read path returns full state.

Task 9: RESULTS + fixes
  - WRITE plan/001_0d6760db6bc5/P1M7T6S2/research/PANEL-AC-RESULTS.md:
    table (AC | test name | pass | FR proven | notes), defect log
    (defect → module → fix), residuals list (real editor focus, real restart,
    live /compact, live remap-without-restart → MANUAL-TUI-AC-RUNBOOK.md).
  - FIX defects in owning modules; add unit-level regression coverage
    additively in that module's existing test file.
```

### Implementation Patterns & Key Details

```ts
// Render proof (AUTOMATION-POLICY scripted equivalent):
const lines = panel.render(60); // or layout renderers
for (const line of lines) {
  expect(visibleWidth(stripAnsi(line))).toBeLessThanOrEqual(60);
}

// Suspend/reopen (panel.test.ts pattern): capture done() from the ui.custom
// mock; done(null) suspends; the widget + resume path are driven directly —
// never await a real user.

// Key driving (keys.test.ts / ripple-confirm.test.ts pattern): feed the
// intercepted key string ("\u001b" esc, "\r" enter) through the dispatch
// function with the fake keybindings manager and assert view/state.

// Instant moot (AC-6): const before = serialize(); answerGate(...);
// expect(dependentStatus(dep)).toBe("moot") — synchronous, no events awaited.
```

### Integration Points

```yaml
DOCS: [Mode A] results in-plan only (JSDoc header table + PANEL-AC-RESULTS.md).
      README belongs to P1.M7.T7 — untouched except defect-driven deviations.
HANDOFF: PANEL-AC-RESULTS.md consumed by P1.M7.T7 (docs record AC coverage).
NO new runtime code, NO config changes — verification + targeted fixes only.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck     # tsc --noEmit — expected clean
```

### Level 2: The panel AC suite (core gate)

```bash
npx vitest run src/panel/ac-panel.test.ts -v   # every AC test green
npm test                                       # full suite, no regressions
# (ac-scripted.test.ts from T6.S1 and config-surface tests from T5.S2 must
#  still pass — parallel siblings)
```

### Level 3: NONE — by policy

Per AUTOMATION-POLICY.md there is deliberately no live-TUI level. Any "observe
in a terminal" impulse maps back to a render(width) assertion in the suite;
interactive residuals are recorded for the human runbook instead.

## Final Validation Checklist

### Technical Validation

- [ ] `npm test` green (includes ac-panel.test.ts and all sibling suites)
- [ ] `npm run typecheck` clean

### Feature Validation

- [ ] AC-1/4/5/6/7/9/10/12 each have a named passing test (or recorded FAIL + fix)
- [ ] Width assertions run at 40/60/80/120 cols with visibleWidth
- [ ] Interactive residuals enumerated in PANEL-AC-RESULTS.md → runbook
- [ ] No live TUI, no real interrogate call, no user-input waits anywhere

### Code Quality Validation

- [ ] New code only in src/panel/ac-panel.test.ts + research/ (+ owning-module
      defect fixes, additive)
- [ ] Untouched: ac-scripted.test.ts, config-surface/no-hardcoded-keys tests,
      MANUAL-TUI-AC-RUNBOOK.md, PRD.md, tasks.json

---

## Anti-Patterns to Avoid

- ❌ Never "just quickly open a panel" — AUTOMATION-POLICY.md is binding
- ❌ Don't duplicate P1.M7.T6.S1's state-side ACs in this suite
- ❌ Don't assert on transport strings when the built message object is available
- ❌ Don't fix defects inside the test — fix the owning module
- ❌ Don't block on interactive-only residuals — record them and finish

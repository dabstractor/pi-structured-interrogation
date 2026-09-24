---
name: "P3.M2.T2.S1 — Flip opened:true rows (reconstruct.test.ts :204/:260/:370; ac-panel AC-9a/b/c + AC-10 :1062) and rewrite AC-9 (SURFACE-002 / FR-28 / AUTOSUBMIT-001)"
description: "P3.M2.T1.S1 removed openPanel from reconstruct.ts's session-start path (widget-only now). The tests asserting the OLD behavior fail: reconstruct.test.ts :204/:260/:370 (`opened:true`), reconstruct.test.ts :523 wiring (start side), ac-panel.test.ts AC-9a/b/c (:849/:884/:902) and AC-10 (:1062). This item flips every row to `opened:false` + widget-set/no-panel assertions, rewrites AC-9 per PRD h2.10 #9 (restart → NO panel; widget live counts; /interrogate reopens with questions/answers restored; drafts gone asserted empty; pending answers ship on next commit per AUTOSUBMIT-001), updates the AC-9 describe title + header results table, and adds setWidget to the test fakes that lack it. Test-only; NO production changes."
---

## Goal

**Feature Goal**: Make the test suite prove SURFACE-002 (PRD h2.44, h2.10 AC-9 rewritten, h2.37, h2.51 M8, h2.53): session-start reconstruction NEVER opens the panel — its only UI act is the suspend widget line. Consume P3.M2.T1.S1's production change (reconstruct.ts returns `opened:false` and calls `updateSuspendWidget`) by flipping every stale `opened:true`/auto-open assertion and rewriting AC-9 as the scripted restart test.

**Deliverable**: Modified test files ONLY — `src/reconstruct.test.ts` (4 test areas), `src/panel/ac-panel.test.ts` (AC-9 describe rewrite + AC-10 one-line flip + fake `setWidget` additions + header table row).

**Success Definition**: `npx vitest run src/reconstruct.test.ts src/panel/ac-panel.test.ts` fully green; `npm run typecheck` clean; `npx vitest run` full-suite delta accounted (no NEW failures beyond in-flight siblings); zero production files touched. Consumed by P4.M1.T1.S1 (full sweep expects green).

## User Persona

**Target User**: pi user who restarts pi (or reloads the extension) mid-interrogation.

**Use Case / Journey**: restart → NO panel appears; the widget line (`{n} open · {m} answered — /interrogate to resume`) shows live counts; `/interrogate` reopens deliberately with questions/answers restored (any status mix); drafts are gone (documented limitation, asserted empty); pending answers ship on the next commit or submit (AUTOSUBMIT-001).

**Pain Points Addressed**: session-start auto-open yanking the editor (SURFACE-002 pin).

## Why

- PRD h2.44 step 4: "TUI: NEVER open the panel (SURFACE-002 …). Set the suspend widget line directly when resumable questions exist — it is the ONLY cue."
- PRD h2.10 AC-9 (rewritten form, quoted in the item): restart → NO panel; widget live counts; `/interrogate` reopens with questions/answers restored; drafts gone; pending answers ship on next commit or submit (FR-28/SURFACE-002 + AUTOSUBMIT-001).
- PRD h2.51 M8 test bullet: "flip the reconstruction auto-open assertions (reconstruct.test.ts / ac-panel.test.ts `opened: true` session-start rows → widget-set, no panel)."
- P3.M2.T1.S1's PRP Task 4 EXPECTS exactly these rows failing post-implementation — this item is the designated consumer of that contract.
- Architecture ledger `plan/002_949db554a811/architecture/surfacing-remote-seams.md` §"Test-flip ledger" (:137–151) is the authoritative before→after map.

## What

Test-only changes (assertion flips, retitles, one rewritten describe, fake-surface additions):

1. `src/reconstruct.test.ts` — flip `opened:true` → `opened:false` + widget assertions in: test (a) `tool-result base beats everything` (:178, assert :204); test (c) `no tool result → newest mirror entry wins` (:242, assert :260); test (f) `suspended host reopens … (session-start origin)` (:354, assert :370); the wiring test `subscribes BOTH session_start and session_tree; start opens, tree is silent` (:523 — the start side flips; tree side already silent stays). The local `makeCtx` fake (~:831, `ui: { custom }` only) must gain `setWidget: vi.fn()` — `updateSuspendWidget` is a NO-OP on surfaces lacking `ui.setWidget`.
2. `src/panel/ac-panel.test.ts` — rewrite the AC-9 describe (title :761 `AC-9 — reconstruction auto-opens the panel (FR-28)` → SURFACE-002 restart semantics) and AC-9a/b/c bodies; flip AC-10's read-after-compact assertion (:1062 `read.opened` → `false`, no `custom`); the AC-9/AC-10 local `makeCtx` (~:839) and AC-10's `readCtx` (~:1045) gain `setWidget`; header results table AC-9 row (:24) updated.
3. NO production files. NO changes to `src/tree-nav-repro.test.ts` or `src/ac-scripted.test.ts` (P3.M1.T3.S1's domain).

### Success Criteria

- [ ] All flipped rows assert `opened` is `false` AND `ui.custom` NOT called (or `customCalls` count 0) on the session-start path.
- [ ] Where resumable questions exist, the test asserts the widget was set: last `setWidget` call key `"interrogator"`, line matching the counts of the fixture (`/ — \/interrogate to resume$/`).
- [ ] AC-9a additionally asserts: state restored (30 questions, replayed answer, epoch), drafts all empty (keep the existing loop), pending-ship clause (status stays `"answered"` post-reconstruction — the AUTOSUBMIT-001 tail ships it at the next commit; cite in comment).
- [ ] AC-9a/b/c end with a `resumeOpenPanel(pi)` reopen assertion per PRD AC-9 (fresh panel, state visible).
- [ ] Header results table AC-9 row cites FR-28/SURFACE-002.
- [ ] `npx vitest run src/reconstruct.test.ts src/panel/ac-panel.test.ts` green; typecheck clean.

## All Needed Context

### Context Completeness Check

Validated: full read of both test files at every cited line, suspend.ts's widget contract, the flip ledger, P3.M2.T1.S1's PRP (the production contract this consumes), resumeOpenPanel's signature/usage, and the AC-4 widget-assertion pattern to copy.

### Documentation & References

```yaml
- file: plan/002_949db554a811/architecture/surfacing-remote-seams.md
  why: §"Test-flip ledger" (:137-151) — authoritative per-row before→after; follow it EXACTLY
  gotcha: :151 flags the reconstruct.test.ts :523 wiring test start-side as a flip target too —
    easy to miss; the :547 tree test is already silent and stays untouched

- file: plan/002_949db554a811/P3M2T1S1/PRP.md
  why: the production CONTRACT being consumed — reconstruct.ts now returns opened:false and calls
    updateSuspendWidget(ctx, state); onRestored still fires before the widget set; the `opened`
    field stays in ReconstructResult (always false on session-start)
  gotcha: assume it landed exactly as specified; if a test still sees opened:true, the contract
    broke — investigate reconstruct.ts, not the test

- file: src/panel/suspend.ts
  why: updateSuspendWidget contract — gates on hasResumableQuestions internally, calls
    ui.setWidget(WIDGET_KEY="interrogator", [line]) or clear; NO-OP when surface lacks ui.setWidget
  pattern: buildSuspendWidgetLine emits `${n} open · ${m} answered — /interrogate to resume`;
    n counts status "open" ONLY, m counts "answered" ONLY

- file: src/panel/panel.ts
  why: resumeOpenPanel(pi: PiUISurface): boolean (:1791) — the /interrogate closed-host-with-live-state
    reopen seam for AC-9's reopen clause
  pattern: usage at src/panel/ac-panel.test.ts:735 — expect(resumeOpenPanel(pi)).toBe(true) then a
    second ui.custom call appears

- file: src/panel/ac-panel.test.ts
  why: the file being edited. Header results table :13-26 (AC-9 row :24); AC-4's widget-assertion
    pattern :719-725 to copy; local makeCtx (~:839) lacks setWidget; AC-10 readCtx (~:1045) lacks it
  pattern: widget check = const widgetCall = setWidget.mock.calls.at(-1); expect(widgetCall?.[0])
    .toBe("interrogator"); line via (widgetCall?.[1] as string[] | undefined)?.[0]

- file: src/reconstruct.test.ts
  why: the other file being edited. Rows at :178/:204, :242/:260, :354/:370, :523-547; local makeCtx
    (~:831) has ui:{custom} only — add setWidget: vi.fn()
  gotcha: the never-resolving custom() mock stays as-is (panel floats); flipped tests simply assert
    it was NOT called on session-start

- prd: h2.10 #9 (rewritten AC-9 text), h2.44 (reconstruction step 4), h2.37 (widget string/command
    surface), h2.33 (AUTOSUBMIT-001 — the pending-ship clause citation)
```

### Current Codebase tree (relevant slice)

```bash
src/reconstruct.test.ts      # MODIFY — flip 4 areas + add setWidget to makeCtx
src/panel/ac-panel.test.ts   # MODIFY — rewrite AC-9, flip AC-10 :1062, fakes, header table
src/reconstruct.ts           # READ-ONLY (P3.M2.T1.S1's contract — verify, never edit)
src/panel/suspend.ts         # READ-ONLY helper contract
src/panel/panel.ts           # READ-ONLY (resumeOpenPanel)
```

### Desired Codebase tree with file responsibilities

```bash
src/reconstruct.test.ts      # Proves session-start = silent install + widget-only (SURFACE-002)
src/panel/ac-panel.test.ts   # AC-9 = scripted restart semantics (no open, widget, reopen, drafts gone, pending ship)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: updateSuspendWidget is a NO-OP on surfaces without ui.setWidget —
// every fake used by a flipped test MUST add setWidget: vi.fn() or the widget
// assertion will see zero calls (and the flip would "pass" vacuously — assert
// the setWidget call, don't just assert opened:false).
// GOTCHA: "empty/foreign branch" (d, ~:277) and the completed-state test
// (~:500) already assert opened:false + no custom — UNCHANGED, stay green.
// GOTCHA: AC-10's flip is ONE assertion (read.opened false + no custom on the
// read path) — do not touch the compaction/flush assertions above it.
// GOTCHA: AUTOMATION-POLICY — never launch pi -p or a TUI in these tests;
// the "restart" is simulated by the reconstruction entry-walk over fixtures
// (the existing pattern).
// GOTCHA: parallel-sibling additive rule — this suite never edits
// ac-scripted.test.ts / tree-nav-repro.test.ts / config-surface.test.ts.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: src/reconstruct.test.ts — extend makeCtx (~:831)
  - ADD `setWidget: vi.fn()` next to `custom` in the ui object; type the return as
    ReconstructionContext & { ui: { custom: Mock; setWidget: Mock } }
  - All downstream widget assertions use `(ctx.ui.setWidget as Mock)`

Task 2: src/reconstruct.test.ts — flip the rows (per ledger :144-146, :151)
  - TEST (a) :178/:204: replace
      expect(result.opened).toBe(true); expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
    with:
      expect(result.opened).toBe(false);               // SURFACE-002: never auto-opens
      expect((ctx.ui.custom as Mock)).not.toHaveBeenCalled();
      const w = (ctx.ui.setWidget as Mock).mock.calls.at(-1);
      expect(w?.[0]).toBe("interrogator");
      expect(((w?.[1] as string[] | undefined)?.[0] ?? "")).toMatch(/open · .*answered — \/interrogate to resume$/);
    Fixture q1 answered("sqlite")+q2 open → line `1 open · 1 answered — /interrogate to resume`
    (verify against the seeded statuses; assert the exact line if deterministic).
    Retitle comment "TUI + non-empty → existing panel path opened" → SURFACE-002 wording.
  - TEST (c) :242/:260: `expect(result.opened).toBe(true); // TUI + non-empty` →
    `expect(result.opened).toBe(false)` + no-custom + widget-set; keep all getState() assertions.
  - TEST (f) :354/:370: flip `opened:true`/custom-once to `opened:false` + no custom + widget set;
    ADD host-stays-suspended: expect(host.isSuspended()).toBe(true); expect(host.isOpen()).toBe(false);
    KEEP fresh-state assertion (getState()?.goal === "test goal") and drafts-untouched
    (drafts.getDraft("q1") === "wip draft"). Retitle: "suspended host STAYS suspended at
    session-start; widget-only cue (f — SURFACE-002)".
  - WIRING test :523 "subscribes BOTH session_start and session_tree; start opens, tree is silent":
    flip the start side — expect((startCtx.ui.custom as Mock)).not.toHaveBeenCalled() and
    widget set on startCtx; the session_tree side (~:540-546) unchanged. Retitle to
    "…; start installs + widget, tree is silent".

Task 3: src/panel/ac-panel.test.ts — fakes
  - AC-9/AC-10 local makeCtx (~:839): add `setWidget: vi.fn()` (typed Mock) to ui.
  - AC-10 readCtx (~:1045): add `setWidget: vi.fn()`.
  - Import/typing unchanged otherwise.

Task 4: src/panel/ac-panel.test.ts — rewrite AC-9 describe (banner :759, title :761, tests :849/:884/:902)
  - HEADER TABLE row :24 → `| AC-9 | PASS | FR-28 / SURFACE-002 | AC-9a/b/c_restart_* (no auto-open; widget-only) |`
  - TITLE: `describe("AC-9 — restart mid-interrogation: silent install + widget-only (FR-28, SURFACE-002)", ...)`
  - AC-9a RETITLE `AC-9a_restart_tool_result_base_plus_deltas_no_panel_widget_only`:
    body: reconstruct → expect(result.opened).toBe(false); custom NOT called;
    host.isOpen() false; widget set ("interrogator", line contains counts + `— /interrogate to resume`);
    KEEP state assertions (30 questions, q01 alpha, q02 beta replayed, epoch+1) and the
    drafts-all-empty loop (FR-28 documented limitation).
    Pending-ship clause: expect(state.getQuestion("q01")?.status).toBe("answered") with a comment
    citing AUTOSUBMIT-001 (P2.M1.T1.S1) — pending answers ride the next commit's maybeAutoSubmit
    or any ctrl+s; the firing itself is AC-2c's domain, not duplicated here.
    REOPEN clause (end of test): expect(resumeOpenPanel(ctx-as-surface))… — NOTE: resumeOpenPanel
    takes a PiUISurface; the local makeCtx's ui object suffices if the ctx cast exposes it;
    expect a single ui.custom call afterwards and the panel component showing restored state
    (e.g. first unanswered focus). If the makeCtx surface lacks fields resumeOpenPanel needs,
    prefer calling resumeOpenPanel with the mock from Task 3 extended minimally — do NOT
    production-change anything; worst case assert reopen via openPanel's session singleton path
    the way AC-4 (:735) does with makeMockPi — an acceptable alternative is to put the reopen
    leg in AC-9c where createReconstruction wiring exists.
  - AC-9b RETITLE `AC-9b_restart_mirror_entry_no_panel_widget_only`: flip opened→false, no custom,
    widget set; keep q05 beta + 30-questions assertions.
  - AC-9c RETITLE `AC-9c_restart_session_start_event_fires_reconstruction_silently`: keep both
    handler-subscription assertions; flip the fire-result to: custom NOT called, widget set,
    host NOT open; then the /interrogate reopen: call the registered command handler OR
    resumeOpenPanel on that ctx → one custom call, panel live (questions/answers restored —
    assert via getState + panel component state).
  - Every rewritten test cites FR-28/SURFACE-002 (+AUTOSUBMIT-001 on the pending clause) in comments.

Task 5: src/panel/ac-panel.test.ts — AC-10 flip (:1062)
  - `expect(read.opened).toBe(true); // FR-28 auto-open after the compact too` →
    `expect(read.opened).toBe(false); // SURFACE-002: reads/reconstruction never surface` +
    no-custom assertion on readCtx's custom mock. Everything above (flush/epoch/values) unchanged.

Task 6: VALIDATE
  - npm run typecheck
  - npx vitest run src/reconstruct.test.ts src/panel/ac-panel.test.ts   # ALL green
  - npx vitest run 2>&1 | tail -15   # no NEW failures vs. pre-change baseline (in-flight siblings only)
  - git diff --stat   # exactly the two test files
```

### Implementation Patterns & Key Details

```ts
// Widget assertion pattern (copy from AC-4, ac-panel.test.ts:719-725):
const widgetCall = (ctx.ui.setWidget as Mock).mock.calls.at(-1);
expect(widgetCall?.[0]).toBe("interrogator");
const widgetLine = (widgetCall?.[1] as string[] | undefined)?.[0] ?? "";
expect(widgetLine).toContain("1 open · 1 answered"); // fixture-dependent counts
expect(widgetLine).toMatch(/— \/interrogate to resume$/);

// No-open pair (every flipped row):
expect(result.opened).toBe(false);                       // SURFACE-002
expect((ctx.ui.custom as Mock)).not.toHaveBeenCalled();  // no panel surface
```

### Integration Points

```yaml
UPSTREAM: P3.M2.T1.S1 reconstruct.ts contract (opened:false + updateSuspendWidget) — assumed landed.
DOWNSTREAM: P4.M1.T1.S1 full-suite sweep expects these suites green after this item.
OUT OF SCOPE: production files; tree-nav-repro.test.ts; ac-scripted.test.ts; the non-TUI
  fallback flag tests; compaction internals.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # clean
```

### Level 2: Tests

```bash
npx vitest run src/reconstruct.test.ts src/panel/ac-panel.test.ts 2>&1 | tail -10   # green
npx vitest run 2>&1 | tail -15   # delta accounting only
```

### Level 3: Boundary check

```bash
git diff --stat   # exactly: src/reconstruct.test.ts, src/panel/ac-panel.test.ts
grep -rn "toBe(true)" src/reconstruct.test.ts | sed -n '1,20p'  # audit remaining opened:true — none on session-start
```

## Final Validation Checklist

- [ ] Only the two test files modified.
- [ ] All ledger rows flipped per surfacing-remote-seams.md :144-151 (incl. the :523 wiring start side).
- [ ] Each flip asserts BOTH `opened:false` AND no `ui.custom` call AND (where resumable) the widget set.
- [ ] AC-9 rewritten: no-open + widget + reopen (resumeOpenPanel) + drafts-empty + pending-ship citation (AUTOSUBMIT-001).
- [ ] AC-10's single `read.opened` assertion flipped; compaction assertions untouched.
- [ ] Header results table + describe titles reflect SURFACE-002.
- [ ] makeCtx/readCtx fakes implement `setWidget` (no vacuous passes).
- [ ] `npx vitest run src/reconstruct.test.ts src/panel/ac-panel.test.ts` green; typecheck clean.

## Anti-Patterns to Avoid

- ❌ Don't edit any production file — if a flip can't go green, the P3.M2.T1.S1 contract broke; report, don't patch reconstruct.ts.
- ❌ Don't flip to `opened:false` without a positive widget assertion (vacuous pass risk).
- ❌ Don't touch the sibling suites (tree-nav-repro / ac-scripted) or the already-silent tree tests.
- ❌ Don't rebuild auto-submit machinery in AC-9 — cite AUTOSUBMIT-001; the mechanism is AC-2c's proof.
- ❌ Don't drop the drafts-empty loop or the state-restoration assertions while flipping.

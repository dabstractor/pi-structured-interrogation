# PRP — P3.M2.T1.S1: Swap reconstruct.ts openPanel for updateSuspendWidget; retain onRestored emission

> **REVISION 2 (re-planning after attempt 1).** Attempt 1's implementation was
> complete and correct (only `src/reconstruct.ts` modified; typecheck clean).
> It was reported as an issue ONLY because two test rows in
> `src/reload-invoke.test.ts` were missing from the flip ledger — rows that
> pin the OLD auto-open behavior and belong to **P3.M2.T2.S1's** flip scope
> (this task must NOT touch test files). This revision: (a) re-verifies the
> already-applied diff, (b) bakes the known-failure whitelist into the
> validation gates so the same correct diff cannot be reported as an issue
> again.

## Goal

**Feature Goal**: Session-start reconstruction (`session_start` on any reason) NEVER opens the interrogation panel (SURFACE-002 / FR-28 / FR-D7). Its only UI act is the suspend widget line, set via the existing `updateSuspendWidget` helper. The FR-34 `onRestored` bridge emission (`ask:resume`) is retained, BEFORE the widget set.

**Deliverable**: `src/reconstruct.ts` — the session-start TUI terminal block calls `updateSuspendWidget(ctx, state)` instead of `openPanel(...)`; the `openPanel` value import is removed; JSDoc updated per Mode A.

**Success Definition**:
- `grep -n openPanel src/reconstruct.ts` → 0 matches (code AND JSDoc).
- `updateSuspendWidget(ctx, state)` is the only UI call in the session-start TUI terminal path, executed AFTER `opts.onRestored?.(state)`.
- Result object still returns `opened: false` (field kept — consumers in tests/persistence read it).
- Non-TUI fallback flag path unchanged; `session_tree` silent path unchanged (byte-identical).
- Full suite green EXCEPT the exact known-failure set listed in Validation Level 2 (all of the same panel-open-class consequence SURFACE-002 mandates, all to be flipped by P3.M2.T2.S1).

## Why

SURFACE-002 (2026-09-19 completion elaboration): "Disable auto-open entirely. I don't want it. The user needs to run /interrogate to get it back. It's annoying." Reconstruction installs state silently and sets the widget line (the ONLY cue) when resumable questions exist. The panel may open only via the allow-list: `/interrogate`, an agent upsert leaving unanswered questions, or `{reopen:true}`. FR-34 keeps `onRestored` on restart so remote bridge clients re-render — only the local panel surface is suppressed.

## What

Single-file change in `src/reconstruct.ts`:

1. In the session-start TUI terminal block (after the `origin === "session-tree"` silent return and the non-TUI flag return), replace the `openPanel(ctx, opts.host, opts.drafts, …)` call with `updateSuspendWidget(ctx, state)` and return `{ source, replayed, opened: false, fallbackActive: false }`.
2. KEEP `opts.onRestored?.(state)` immediately BEFORE the widget set (order matters — FR-34 bridge flow fires first).
3. Remove the `openPanel` **value** import; KEEP `DraftStore` / `PanelHost` / `PiUISurface` **type** imports and the `drafts` field on `ReconstructionOptions` (consumed elsewhere / kept for API stability).
4. Add `import { updateSuspendWidget } from "./panel/suspend.js";`.
5. JSDoc (Mode A):
   - Module header step-5 session-start bullet: SURFACE-002 — reconstruction's only UI act is the widget line; allow-list (`/interrogate`, agent upsert, `{reopen:true}`).
   - Remove any openPanel mention from the session-tree bullet.
   - `ReconstructResult.opened`: always `false`, field retained.
   - `ReconstructionOptions.drafts`: retained, unused by reconstruction (FR-28: drafts not restored across restarts).
   - `reconstructFromBranch` `@param origin` and `createReconstruction` header comments updated.

### Success Criteria

- [ ] `src/reconstruct.ts` is the only modified source file (`git diff --stat`).
- [ ] No test files touched (anti-pattern; flips belong to P3.M2.T2.S1).
- [ ] Typecheck clean.
- [ ] Full suite matches the exact expected pass/fail fingerprint in Level 2 below.

## All Needed Context

### Documentation & References

```yaml
- file: src/reconstruct.ts
  why: THE file to change. Attempt-1 diff may already be applied in the worktree —
        verify each spec point below against the current file state first.
  pattern: session-start terminal block ~:478; onRestored at ~:472; non-TUI flag :455;
        session-tree silent path :459–466 (retarget + suspend)
  gotcha: keep onRestored BEFORE updateSuspendWidget; keep opened:false field.

- file: src/panel/suspend.ts
  why: helper to call — updateSuspendWidget (:~135), hasResumableQuestions (:66),
        WIDGET_KEY="interrogator" (:38), widget line format
        `${n} open · ${m} answered — /interrogate to resume` (:~94/117)
  pattern: helper owns set/clear visibility + BUG-005 "0 open · N answered" rule

- file: plan/002_949db554a811/architecture/surfacing-remote-seams.md
  why: seam research incl. the Test-flip ledger (which did NOT include reload-invoke rows)

- file: src/reload-invoke.test.ts
  why: NOT to modify — :165 and :202 pin old auto-open (customCalls.length === 1
        after session_start, "Pin 2" comments); they fail on this diff BY DESIGN
        and are flipped in P3.M2.T2.S1 (assert-to-0 + index-shift in the :202 flow).
```

### Known Gotchas

```python
# CRITICAL: do NOT touch any *.test.ts — the 10 expected failures are ledgered/adjacent
#   flip rows owned by P3.M2.T2.S1. The reload-invoke :165/:202 rows were missing from
#   the seam ledger; treat them as known-failures, not regressions.
# CRITICAL: updateSuspendWidget gates itself on hasResumableQuestions(state) — no extra gate.
# CRITICAL: session_tree path and non-TUI fallback path must remain byte-identical.
```

## Implementation Tasks

```yaml
Task 0: VERIFY current worktree state
  - git diff src/reconstruct.ts — if attempt-1's diff is present and complete, proceed
    straight to validation; only re-apply what is missing.
Task 1: EDIT src/reconstruct.ts terminal block (per "What" items 1–4)
Task 2: EDIT src/reconstruct.ts JSDoc (per "What" item 5)
Task 3: VALIDATE (below)
```

## Validation Loop

### Level 1: Typecheck

```bash
npx tsc --noEmit   # expect: clean, no output
```

### Level 2: Unit tests — EXACT expected fingerprint (do NOT report these as issues)

```bash
npx vitest run 2>&1 | tail -20
```

**Expected: exactly 10 failures, all panel-open-class on the session-start auto-open path:**

1. `src/reconstruct.test.ts` — 4 rows: :204, :260, :370, :537 (`opened: true` pins)
2. `src/ac-panel.test.ts` — 4 rows: AC-9a, AC-9b, AC-9c, AC-10
3. `src/reload-invoke.test.ts` — 2 rows (NOT in the ledger; same consequence class, to be added to P3.M2.T2.S1's flip scope by the orchestrator):
   - `test_reload_then_interrogate_invokes_panel_immediately_no_key_gate` (:165 — Pin 2 `customCalls.length === 1` right after session_start)
   - `test_reload_suspended_panel_interrogate_resumes_immediately` (:202 — same pin; downstream Pin 3/Pin 4 resume assertions encode the NEW allow-list behavior once flipped)

**Expected to PASS (must be green, else you regressed something):**
- FR-34 `onRestored` test (fires once on session-start, never on tree)
- non-TUI fallback-flag test
- session_tree silent path (byte-identical)
- `tree-nav-repro.test.ts` + `ac-scripted.test.ts` fully green

Any failure OUTSIDE the 10-row list above is a real regression — fix before finishing.

### Level 3: Structural greps

```bash
grep -n openPanel src/reconstruct.ts        # 0 matches
grep -n updateSuspendWidget src/reconstruct.ts  # import + call site
grep -n onRestored src/reconstruct.ts       # emitted before widget set on session-start only
```

## Final Validation Checklist

- [ ] `src/reconstruct.ts` sole modified source file
- [ ] No test files touched
- [ ] `npx tsc --noEmit` clean
- [ ] Vitest fingerprint = exactly the 10 known rows (4 + 4 + 2); everything else green
- [ ] `openPanel` absent from reconstruct.ts (code + JSDoc)
- [ ] onRestored retained, emitted before widget set, session-start only
- [ ] JSDoc Mode A updates present
- [ ] **Report note for orchestrator**: reload-invoke :165/:202 must be added to P3.M2.T2.S1's flip ledger (assert-to-0 + :202 index-shift) or the P4.M1.T1.S1 full-suite sweep will trip on them.

## Anti-Patterns to Avoid

- ❌ Do NOT "fix" the 10 failing test rows here — flipping tests is P3.M2.T2.S1's contract.
- ❌ Do NOT remove `opened` from `ReconstructResult` or `drafts` from `ReconstructionOptions`.
- ❌ Do NOT reorder onRestored after the widget set.
- ❌ Do NOT gate updateSuspendWidget with a duplicate hasResumableQuestions check.

**Confidence Score: 9/10** — implementation already proven in attempt 1; the only prior failure mode (misattributing the 2 un-ledgered reload-invoke rows) is neutralized by the explicit fingerprint.

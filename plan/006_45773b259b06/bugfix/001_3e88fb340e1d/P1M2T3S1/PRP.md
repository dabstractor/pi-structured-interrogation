# PRP — bugfix P1.M2.T3.S1: Fix the SURFACE-002 wiring comment + raw-source guard (BUG-004)

---
name: "bugfix P1.M2.T3.S1 — Fix the 'session_start auto-opens the panel' comment and guard it with a source-scan test"
description: "Comment-only fix at src/index.ts:148-149 (inside the createReconstruction wiring block ~:142-160): replace ONLY the stale 'session_start auto-opens the panel (TUI, FR-28) or sets the non-TUI digest fallback flag' clause with the truthful SURFACE-002 wording (session_start NEVER opens the panel — silent install + suspend-widget line only; panel returns only via /interrogate, agent upsert, or {reopen:true}); the session_tree sentence that follows is already correct and stays verbatim. Add a permanent raw-source guard test (fs.readFileSync + regex on RAW source — the no-hardcoded-keys.ts pipeline strips comments, so do NOT reuse it) asserting index.ts does NOT match /auto-opens the panel/ and DOES match /SURFACE-002/ and /NEVER opens the panel/. TDD: failing guard first, then the comment fix. No runtime changes; all behavior pins stay green untouched."
---

## Goal

**Feature Goal**: PRD h3.3 + h2.5 Recommendation 4 (BUG-004): the single wiring-site comment future maintainers read no longer documents the pre-SURFACE-002 auto-open behavior — eliminating the risk that a reader patching from the comment reintroduces the surprise-surfacing / empty-box-after-esc data-loss bug class R6/SURFACE-002 exists to prevent. A static guard test makes comment drift a build failure.

**Deliverable**: One rewritten comment clause in `src/index.ts` (:148-149) + one new test (in `src/reconstruct.test.ts`, or a small dedicated file — see Tasks) reading `src/index.ts` raw and asserting the corrected wording survives.

**Success Definition**: `npm test` + `npm run typecheck` green; the new guard passes; behavior pins untouched and green: ac-panel.test.ts:794 (AC-9), reconstruct.test.ts:302/:756/:897, tree-nav-repro.test.ts, README.md:367 (already documents the correct behavior — no-op).

## User Persona

**Target User**: The future maintainer reading the index.ts wiring block — the comment is the doc; it must tell the truth about a hard requirement (R6/SURFACE-002).

**Use Case**: Anyone touching reconstruction wiring reads the comment and cannot be misled into re-adding session_start auto-open.

**User Journey**: read the block → the comment now matches reconstruct.ts's actual behavior and the locked ruling → correct patches.

**Pain Points Addressed**: BUG-004 — a comment contradicting the locked SURFACE-002 ruling ("Disable auto-open entirely", 2026-09-19) at the exact wiring site.

## Why

- Bug report h3.3 (BUG-004) + h2.5 Recommendation 4: "Fix the stale 'session_start auto-opens the panel' comment in index.ts to match SURFACE-002 (widget-line only), and consider a static guard asserting the comment block no longer claims auto-open."
- Truth sources (verified this session): `src/reconstruct.ts` module JSDoc step 5 (~:95-110: "SURFACE-002 (FR-28 / FR-D7): the FR-28 panel auto-open is DISABLED ENTIRELY — session_start NEVER opens the panel. Reconstruction's ONLY UI act is the suspend widget line: updateSuspendWidget(ctx, state)… The panel returns only via the allow-list: /interrogate…, an agent upsert leaving unanswered questions, or {reopen:true}") and the session-tree tail (~:620-640, `opened: false`, retarget/suspend/widget only); locked ruling `spec/decisions.md:26` (SURFACE-002 verbatim), with the data-loss-trap context at `:25` (SURFACE-001, empty-box-after-esc).
- Comment-only: zero runtime effect; consumed by P1.M3.T1.S1 (final gate) and P1.M3.T2.S2 (README sweep — README.md:367 already correct, likely no-op).

## What

### (a) The comment rewrite — ONLY the stale clause

In `src/index.ts`, inside the createReconstruction block (verified at ~:142-160), the offending clause (at :148-149 within the long comment) currently reads:

```
// …then split BY ORIGIN: session_start auto-opens the
// panel (TUI, FR-28) or sets the non-TUI digest fallback flag; session_tree
// is SILENT — …
```

Replace ONLY the `session_start … flag;` clause; keep everything else in the block verbatim (the session_tree sentence is already correct). New wording (match the suggested contract shape):

```
// …then split BY ORIGIN: session_start NEVER opens the panel
// (SURFACE-002/FR-28: silent install + suspend-widget line only; the panel
// returns only via /interrogate, an agent upsert, or {reopen:true}); session_tree
// is SILENT — …(rest unchanged)
```

Adjust line wrapping to the file's existing comment style; the guarded substrings must appear literally: `SURFACE-002`, `NEVER opens the panel`. The non-TUI digest fallback flag still exists as behavior (reconstruct.ts sets it without any panel act) — folding it into "silent install" is fine, or keep a brief "non-TUI: digest fallback flag, no surface" mention; either is acceptable as long as no "auto-opens" claim remains.

### (b) The raw-source guard test

Add to `src/reconstruct.test.ts` (it already owns reconstruction behavior pins — natural home) a `describe("wiring-comment guard (BUG-004)")` — or, if preferred for isolation, a small `src/index-comment-guard.test.ts` following the same pattern:

```ts
test("index_ts_wiring_comment_matches_SURFACE_002_no_auto_open_claim", () => {
  const src = fs.readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  // (from reconstruct.test.ts the relative URL is "./index.ts"; from a root-
  // colocated file it's "./index.ts" under src/ — verify import.meta.url base)
  expect(src).not.toMatch(/auto-opens the panel/);
  expect(src).toMatch(/SURFACE-002/);
  expect(src).toMatch(/NEVER opens the panel/);
});
```

- Precedent (verified): `src/delivery.test.ts:287` (`fs.readFileSync(new URL("./delivery.ts", import.meta.url), "utf8")` module-hygiene scan), guards.test.ts:534, merge.test.ts:348, results.test.ts:344, snapshots.test.ts:483, state.test.ts:484, tool.test.ts:861.
- **CRITICAL**: scan the RAW file. `no-hardcoded-keys.test.ts` strips comments before scanning — do NOT reuse that pipeline or the guard can never see the comment.
- TDD order: write the test FIRST (it fails against the current comment — `/auto-opens the panel/` matches at :148), then fix the comment, then green.
- Mock nothing — the test reads a source file directly.

### Success Criteria

- [ ] Guard test written first and observed failing (red) against HEAD's comment
- [ ] Comment fixed (only the session_start clause); `SURFACE-002` + `NEVER opens the panel` present; no `auto-opens the panel` anywhere in index.ts
- [ ] Rest of the block verbatim (session_tree sentence, drafts note, resetState note untouched)
- [ ] Full suite green with zero behavior changes; pins untouched: ac-panel :794, reconstruct :302/:756/:897, tree-nav-repro
- [ ] README.md:367 already correct — no change needed (verify, don't edit)

## All Needed Context

### Context Completeness Check

Everything needed: exact comment location + current text, replacement text, truth-source quotes, guard pattern with a verified precedent path, TDD order, and the pins that must stay green. Below.

### Documentation & References

```yaml
- file: src/index.ts
  why: THE edit site — createReconstruction block ~:142-160; offending clause at :148-149 ("then split BY ORIGIN: session_start auto-opens the panel (TUI, FR-28) or sets the non-TUI digest fallback flag; session_tree is SILENT — …")
  pattern: keep surrounding comment lines verbatim; match existing // style and wrap width
  gotcha: change ONLY the session_start clause — the session_tree sentence and drafts/resetState notes are correct

- file: src/reconstruct.ts
  why: the truth being documented — module JSDoc step 5 (~:95-110, quoted verbatim in this PRP) + session-tree tail ~:620-640 (updateSuspendWidget only, opened:false); non-TUI digest fallback flag exists without any panel act
  gotcha: quote semantics from here, not from memory

- file: spec/decisions.md:24-27
  why: locked rulings — SURFACE-001 (:25, empty-box-after-esc data-loss trap) and SURFACE-002 (:26, "Disable auto-open entirely… nothing ever calls openPanel from session_start")

- file: src/delivery.test.ts:285-295
  why: THE guard precedent — "module hygiene" describe reading raw source via fs.readFileSync(new URL("./delivery.ts", import.meta.url), "utf8"); same pattern at guards.test.ts:534, merge.test.ts:348, results.test.ts:344, snapshots.test.ts:483, state.test.ts:484, tool.test.ts:861
  gotcha: raw read, NOT the comment-stripping pipeline used by no-hardcoded-keys.test.ts

- file: src/no-hardcoded-keys.test.ts
  why: anti-precedent — its pipeline strips comments; reusing it would make the comment invisible to the guard
```

### Current Codebase tree (relevant slice)

```bash
src/
  index.ts               # EDIT — one comment clause (:148-149)
  reconstruct.test.ts    # EDIT — add the guard test (or new index-comment-guard.test.ts)
```

### Desired Codebase tree

```bash
# no production-code changes beyond the comment; one test added/extended
```

### Known Gotchas

```ts
// CRITICAL: read the RAW source. no-hardcoded-keys.test.ts strips comments
// before regexing — its pipeline would never see the guarded text.

// CRITICAL: TDD order matters for the evidence trail: red first (the guard
// matches /auto-opens the panel/ at HEAD), then the fix, then green.

// import.meta.url base differs by test location — from src/reconstruct.test.ts
// the target is "./index.ts" (same directory). Verify with a console-free
// assertion failure message if unsure.

// Do not "improve" the rest of the comment block while there — verbatim
// preservation is part of the contract (minimal diff reviewability).
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: ADD the guard test (TDD red)
  - CREATE the describe/test in src/reconstruct.test.ts (or index-comment-guard.test.ts) per What §(b)
  - RUN it: npx vitest run src/reconstruct.test.ts -t "wiring-comment" → expect FAILURE on /auto-opens the panel/
  - ENSURE: fs + URL imports match the file's existing import style (delivery.test.ts precedent)

Task 2: FIX the comment (green)
  - EDIT src/index.ts :148-149 ONLY: replace the session_start clause with the What §(a) wording
  - VERIFY: grep -n "auto-opens the panel" src/index.ts → no match; grep -n "SURFACE-002\|NEVER opens the panel" src/index.ts → both present
  - RUN the guard → green

Task 3: FULL validation (below); confirm zero behavior diffs
```

### Integration Points

```yaml
NONE:
  - Comment-only; no config, no exports, no runtime path changes.
  - P1.M3.T1.S1 (final gate) consumes the green suite; P1.M3.T2.S2 (README
    sweep) verifies README.md:367 — already correct, expected no-op.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # zero errors
```

### Level 2: Unit Tests

```bash
npx vitest run src/reconstruct.test.ts -v   # guard green, pins :302/:756/:897 untouched
npx vitest run src/ac-panel.test.ts src/tree-nav-repro.test.ts -v  # AC-9 + tree pins green
npm test                                     # full suite — zero regressions
```

### Level 3: Not applicable (no runtime change)

```bash
# Sanity only: grep confirms the wording; no live session behavior can change.
grep -n "auto-opens the panel" src/index.ts || echo "clean"
```

### Level 4: Regression sweep

```bash
npx vitest run   # full suite green; note the baseline from P1.M1.T1.S1 for P1.M3.T1.S1's diff
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean; `npm test` green
- [ ] Guard observed red-before/green-after (TDD evidence)

### Feature Validation (BUG-004)

- [ ] index.ts contains `SURFACE-002` and `NEVER opens the panel`; no `auto-opens the panel`
- [ ] Only the session_start clause changed; session_tree sentence + surrounding notes verbatim
- [ ] Behavior pins green untouched (ac-panel :794, reconstruct :302/:756/:897, tree-nav-repro)
- [ ] README.md:367 verified correct (no edit)

### Code Quality Validation

- [ ] Guard reads RAW source (no comment-stripping pipeline)
- [ ] Minimal diff: one comment clause + one test
- [ ] No mocks, no runtime changes

## Anti-Patterns to Avoid

- ❌ Rewriting the whole comment block (only the stale clause)
- ❌ Using the no-hardcoded-keys comment-stripping pipeline for the guard
- ❌ Skipping the red-first TDD step (it proves the guard actually guards)
- ❌ Touching reconstruct.ts/README "while in there" — out of scope
- ❌ Matching on overly-broad regexes (e.g. /auto-open/) that could false-positive on the correct SURFACE-002 text itself — pin the exact offending phrase `auto-opens the panel`

---

**Confidence Score**: 10/10 — comment-only change with the exact current text, exact replacement wording, verified truth sources, and a verified guard-test precedent; nothing can regress at runtime.

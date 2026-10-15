# PRP — P1.M3.T1.S2: src/state.ts setGoal JSDoc — rewrite the stale "enforced at the tool call-site" sentence (BUG-003, part 2)

## Goal

**Feature Goal**: Purge the last live stale caps claim in the source: the `setGoal` JSDoc at src/state.ts:324-328 asserts "the 400-char cap (BUG-009) is enforced at the tool call-site (P1.M1.T1.S2)" — no such enforcement exists anywhere (CAPS-OUT-001 deleted the caps engine; tool.ts:201-204 stores goals verbatim, pinned by tool.test.ts:201/:208). Rewrite the sentence to state the truth: no caps or validation exist anywhere; goals of any length are stored verbatim (FR-23).

**Deliverable**: One JSDoc rewrite in `src/state.ts` (:324-328) + an optional one-attribute drop in `src/tool.ts:201` (`BUG-009` from "(FR-30; BUG-001/BUG-009)" — see What §2). Comment edits only, zero runtime change.

**Success Definition**: `grep -rn "400-char cap\|capped at 400\|BUG-009" src/ README.md` hits only the pinned test NAME at tool.test.ts:208 ("over-400-char goal" — a factual description of the input, keep it); `npm test` + `npx tsc --noEmit` green and unchanged.

## User Persona

**Target User**: Future maintainers (and model readers) of state.ts who rely on JSDoc to understand the mutation seams.

**Use Case**: A developer adding validation or investigating goal handling reads the setGoal JSDoc — it must not send them hunting for a nonexistent caps call-site.

**Pain Points Addressed**: The comment contradicts the code, the owner ruling (CAPS-OUT-001), and FR-23 — exactly the class of stale-claim rot BUG-003 catalogued.

## Why

- PRD h2.3 Issue 2 (BUG-003): "a code comment at src/state.ts:327 still references 'the 400-char cap (BUG-009) is enforced at the tool call-site' — also stale, since no call-site enforces it." h2.5 recommends deleting it.
- Architecture dossier `plan/004_49e25d5235a9/architecture/bug002-003-ctrlg-and-stale-caps.md` §(e) stale item 2 (this site) + borderline item 3 (tool.ts:201).
- P1.M3.T1.S1 (parallel) fixes the README half; this task completes the purge so zero live stale caps references remain repo-wide.

## What

### 1. The primary edit — src/state.ts:323-328

Current (verified in tree):

```ts
  /**
   * Updates the interrogation goal (agent re-upserts with a changed goal —
   * FR-30). Not a rev/epoch transition. Emits `changed`. No caps/validation
   * here — the 400-char cap (BUG-009) is enforced at the tool call-site
   * (P1.M1.T1.S2).
   */
```

Replace the last two lines' claim with:

```ts
  /**
   * Updates the interrogation goal (agent re-upserts with a changed goal —
   * FR-30). Not a rev/epoch transition. Emits `changed`. NO CAPS OR
   * VALIDATION anywhere (FR-23 / CAPS-OUT-001, 2026-10-08): the caps engine
   * is deleted; goals of any length are stored verbatim — same as the tool
   * call-site (see tool.ts setGoal plumbing, pinned by tool.test.ts).
   */
```

Keep `setGoal`'s body byte-identical. Mode A: the JSDoc on this exported state seam IS the documentation deliverable.

### 2. The borderline edit — src/tool.ts:201

Current: `` `state.setGoal(...)` (FR-30; BUG-001/BUG-009); `` — the line sits immediately before the correct "NO CAPS (CAPS-OUT-001…)" statement in the same doc block. Research ruling: `BUG-009` here is a historical attribution, not a live enforcement claim, but it names a caps bug directly above a no-caps ruling — drop it for consistency: `(FR-30; BUG-001);`. Do not touch anything else in that doc block (the NO CAPS sentence stays).

### 3. What NOT to touch

- `tool.test.ts:208` test name "reuse upsert stores an over-400-char goal verbatim" — describes the test INPUT; it is correct and stays.
- `README.md` — S1's territory (its :114 stale clause is being removed in parallel).
- `plan/` archives and `spec/decisions.md` historical ruling texts — legitimate historical mentions.

### Success Criteria

- [ ] `grep -n "BUG-009" src/` → zero hits; `grep -rn "400-char cap\|capped at 400" src/` → zero hits (tool.test.ts:208's "over-400-char" must not match these patterns — verify).
- [ ] `grep -rn "400-char cap\|capped at 400\|BUG-009" src/ README.md` → zero live hits overall (once S1 lands for README).
- [ ] `npm test` and `npx tsc --noEmit` green — no runtime change.

## All Needed Context

### Context Completeness Check

A fresh implementer needs only: the exact current comment text (quoted above, verified at src/state.ts:323-328 and tool.ts:201), the CAPS-OUT-001/FR-23 ruling text (selected PRD content + citations), and the boundary against S1/README. Fully contained here.

### Documentation & References

```yaml
- file: src/state.ts
  why: the primary edit target — setGoal JSDoc at :323-328 (the "No caps/validation here —" sentence)
  pattern: neighboring JSDoc blocks cite rulings inline as "(RULING-ID, date)" — mirror that style (e.g. "(FR-23 / CAPS-OUT-001, 2026-10-08)")
  gotcha: setGoal body must stay byte-identical; only the JSDoc changes

- file: src/tool.ts
  why: :201 — drop the BUG-009 attribution from "(FR-30; BUG-001/BUG-009)"; :201-204 stores the goal verbatim (the disproof of the stale claim)
  gotcha: the adjacent "NO CAPS (CAPS-OUT-001…)" sentence is CORRECT — leave it

- file: src/tool.test.ts
  why: :201/:208 — the pinned verbatim-goal tests proving no cap exists (50,000/500-char round-trips); also the one legit "over-400-char" string that must survive the grep audit
  gotcha: do NOT rename these tests — they are the regression pin for CAPS-OUT-001

- file: plan/004_49e25d5235a9/architecture/bug002-003-ctrlg-and-stale-caps.md
  why: dossier §(e) items 2-3 — provenance of this fix; read-only reference

- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/P1M3T1S1/PRP.md
  why: the PARALLEL sibling fixing README.md:113-116 — do not edit README
  gotcha: this task's grep audit expectation "zero live hits repo-wide" assumes S1 lands; run the audit scoped to src/ yourself and note the README dependency
```

### Current Codebase tree (relevant excerpt)

```bash
src/state.ts   # EDIT: setGoal JSDoc :323-328
src/tool.ts    # EDIT: drop BUG-009 from :201 attribution (one token)
```

### Desired Codebase tree

```bash
# No files added/removed — two comment edits.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// GOTCHA: comments only — but still run the gates; the repo's convention is
// that JSDoc on exported seams is contract documentation (Mode A), so the
// rewrite must cite the ruling, not just delete the sentence.
// GOTCHA: keep the "Emits `changed`" and "Not a rev/epoch transition" facts —
// they are live contract statements unrelated to caps.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/state.ts setGoal JSDoc (:323-328)
  - REWRITE: the two-line caps claim → the no-caps verbatim statement per What §1
  - PRESERVE: body, surrounding JSDoc facts, method signature

Task 2: EDIT src/tool.ts:201
  - DROP: "BUG-009/" from "(FR-30; BUG-001/BUG-009)" → "(FR-30; BUG-001)"
  - PRESERVE: the immediately following NO CAPS sentence

Task 3: GATES + AUDIT
  - RUN: npx tsc --noEmit && npm test
  - AUDIT: grep -rn "BUG-009\|400-char cap\|capped at 400" src/ → zero hits;
           grep -n "over-400-char" src/tool.test.ts → the pinned test name, unchanged
```

### Implementation Patterns & Key Details

```ts
// Final setGoal JSDoc (target state):
/**
 * Updates the interrogation goal (agent re-upserts with a changed goal —
 * FR-30). Not a rev/epoch transition. Emits `changed`. NO CAPS OR
 * VALIDATION anywhere (FR-23 / CAPS-OUT-001, 2026-10-08): the caps engine
 * is deleted; goals of any length are stored verbatim — same as the tool
 * call-site (see tool.ts setGoal plumbing, pinned by tool.test.ts).
 */
```

### Integration Points

```yaml
NO runtime integration points — comment-only change.
DOCS: this subtask IS the Mode A documentation fix (JSDoc on the exported seam).
DEPENDS: README half owned by P1.M3.T1.S1 (parallel); the repo-wide "zero live
stale hits" output holds once both land.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npx tsc --noEmit
# Expected: zero errors.
```

### Level 2: Unit Tests

```bash
npm test
# Expected: all green, byte-for-byte identical results (no runtime change).
# In particular tool.test.ts:201/:208 (verbatim-goal pins) pass untouched.
```

### Level 3: Residue audit (the real gate for this task)

```bash
grep -rn "BUG-009\|400-char cap\|capped at 400" src/
# Expected: zero hits.
grep -rn "BUG-009\|400-char cap\|capped at 400" src/ README.md
# Expected: zero hits after S1 lands (README.md:114 gone); until then only
# README's :114 line may remain — flag, don't fix (S1's file).
```

## Final Validation Checklist

- [ ] `npx tsc --noEmit` + `npm test` green, no runtime diff (`git diff` shows only comments).
- [ ] `grep -rn "BUG-009" src/` → zero.
- [ ] setGoal JSDoc states verbatim storage citing FR-23/CAPS-OUT-001; keeps the changed/rev-epoch facts.
- [ ] tool.test.ts test names untouched.
- [ ] README.md untouched (S1 owns it).

## Anti-Patterns to Avoid

- ❌ Don't delete the JSDoc sentence without replacement — cite the ruling (Mode A convention).
- ❌ Don't rename the "over-400-char" test — it's the regression pin, not residue.
- ❌ Don't touch README.md, tool bodies, or state.ts method bodies.
- ❌ Don't "add back" a cap because the old comment implied one — CAPS-OUT-001 forbids it.

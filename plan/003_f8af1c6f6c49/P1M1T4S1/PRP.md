---
name: "P1.M1.T4.S1 — Comment sweep: keys.ts, overview.ts, residuals"
description: "Purge every residual status-agnostic ★-preselect comment claim from the panel tree (keys.ts ~:440, overview.ts ~:390/405 + header :13, grep-found test-file residuals) so ANSWER-PIN-001's contract has a single voice. Comments ONLY — zero behavior edits; full suite stays green."
---

## Goal

**Feature Goal**: Complete the P1.M1.T4 documentation half of ANSWER-PIN-001 (FR-35 / h2.65): after T1.S1/S2/S3 (landed: `1fba337`, `886489c`, `6fd79f9`) and T2.S4/S5/S6 rewrote the code and their own sites, residual comments in `src/panel/keys.ts` and `src/panel/overview.ts` (plus grep-found residuals in test files) STILL claim the `currentId` setter "re-seeds to the ★ (R2 preselect)" — the dead status-agnostic contract. Sweep them so every reader-facing comment states the pinning rule: **a recorded answer owns the caret; ★ preselects only while unanswered.**

**Deliverable**: Comment/JSDoc-only edits in `src/panel/keys.ts` (~:437-443), `src/panel/overview.ts` (:13, :389-390, :405), and inline test-comment fixes at `src/panel/actions.test.ts:1863/:1870/:1912/:1982` and `src/ac-scripted.test.ts:770`; plus the exact grep report (greps run + zero stale hits) in the implementation notes.

**Success Definition**:
- The contract's five greps return zero stale hits (one documented exception: `panel.ts:893`'s intentional supersession quotation of "ACCEPT the recommendation")
- `rg -n "R2 preselect" src/panel/` returns 0
- Every remaining `preselect` hit in `src/` is accurately scoped (unanswered-only, landed spec-verbatim string, or documented historical note)
- Zero code-behavior changes: `npm run typecheck` + full `npm test` green with no test edits — assertions untouched

## User Persona (if applicable)

**Target User**: Future developers/AI agents reading the panel source (downstream tasks T5.S9/S10 and the AC-16 walk-through read these seams).

**Use Case**: Reading `overviewJump` or the fixed-enter router to understand where the cursor lands after a jump/enter.

**User Journey**: Reader opens keys.ts/overview.ts → every comment states the pinning contract → no one re-imports the dead "★ always preselects" behavior.

**Pain Points Addressed**: h2.65 — ANSWER-PIN-001 supersedes "every doc asserting status-agnostic preselect — those tests were testing the bug." Stale comments are the last vector for re-importing the bug.

## Why

- The code is already correct (S1 landed `initialCursorIndex`; seed sites inherit it), but keys.ts/overview.ts comments still describe the old seeding — a reader would "fix" correct code or copy the dead claim into new tests (T5.S9/S10 consume these files immediately after).
- Item contract: OUTPUT = "grep-clean tree (report the exact greps run + zero stale hits) — the contract now has a single voice for downstream readers."
- Mode A: the purge IS the doc fix — in-place rewrites, nothing separate.

## What

1. **keys.ts ~:437-443** (fixed-enter block): rewrite "overviewJump — restores options focus, R2 preselect via / the currentId setter" → overviewJump restores options focus; the currentId setter re-seeds the cursor — the recorded answer's row when the question carries one (FR-35/ANSWER-PIN-001), ★ preselect only while unanswered.
2. **overview.ts:13** (header): "(focus restored, R2 / preselect re-seeded via the currentId setter)" → "(focus restored; cursor re-seeded via the currentId setter — recorded answer when present, ★ only while unanswered)".
3. **overview.ts:389-390** (overviewJump JSDoc bullet): "`panel.currentId = q.id` re-seeds the short-view option cursor to the / ★ recommendation (R2 preselect) via the setter." → re-seeds via the setter to the RECORDED answer's display row when present (✎ Other row for write-ins; row 0 for stale values), ★ recommendation only while unanswered (FR-35).
4. **overview.ts:405** (inline): `// setter re-seeds cursorIndex (R2 preselect)` → `// setter re-seeds cursorIndex — recorded answer when present (FR-35); ★ only while unanswered`.
5. **Test residuals (comment text only)**: `actions.test.ts:1863` `// setter re-seeds the cursor to the ★ "a" preselect` (q1 ANSWERED "a") → `// setter re-seeds the cursor to the recorded answer "a" (FR-35)`; same for :1870, :1912 (`// … to the recorded answer (FR-35)`), :1982; `ac-scripted.test.ts:770` (q1 CLOSED, archived) → `// setter re-seeds cursorIndex to the recorded answer (FR-35)`.
6. **Residual re-grep**: T2.S4/S5/S6 sites (actions.ts ~:329/:339/:353/:371, deep-view.ts) should already be rewritten when this task starts — if their greps still surface stale setter/★ claims, they are "residuals found by grep": fix them the same way.

### Success Criteria

- [ ] All five contract greps clean (one accounted hit at panel.ts:893)
- [ ] `rg -n "R2 preselect" src/panel/` → 0; all remaining `preselect` hits accurately scoped
- [ ] `npm run typecheck` + `npm test` green, zero assertion/test-logic edits
- [ ] Exact greps + results reported in implementation notes

## All Needed Context

### Context Completeness Check

Repo fully implemented; suites green pre-changeset. Every target site was read in the working tree (@ `6fd79f9`) with verbatim excerpts in research notes. An agent needs this PRP + the named files. Line numbers drift as T2.S4/S5/S6/T3.S1 land — re-locate by content (grep), not line number.

### Documentation & References

```yaml
- file: plan/003_f8af1c6f6c49/P1M1T4S1/research/notes.md
  why: "VERBATIM current text of every stale site + the full accurate/stale classification of all 'preselect' hits in src/ + the grep gate + the no-code-changed diff check"
  critical: "the stale/accurate split for test files — actions.test.ts:131/195/245/541/824, ac-scripted:728, overview.test.ts:412/452, panel.test.ts:618/828/2176/2740, deep-view.test.ts:420/501, two-stage.test.ts:229 describe UNANSWERED fixtures (★ correct there) — DO NOT touch them"

- file: plan/003_f8af1c6f6c49/architecture/panel-ui-seams.md
  why: "§Comment purge sites — the authoritative site list (this task: keys.ts ~:440, overview.ts ~:390/405 + grep residuals); §Cursor seeding for the setter contract"
  critical: "actions.ts/deep-view.ts/short-view.ts/panel.ts sites belong to T1/T2 tasks — sweep them ONLY if a residual grep still flags them"

- file: plan/003_f8af1c6f6c49/P1M1T1S2/PRP.md
  why: "STYLE CONTRACT — how T1.S2 worded its seed-site rewrites (recorded-answer-first phrasing, ANSWER-PIN-001/FR-35 tags, h2.65 ruling references); match its voice"

- file: src/panel/keys.ts
  why: "fixed-enter comment block ~:437-443 — the keys.ts target"
  gotcha: "surrounding router logic (overviewJump/acceptFromDeep dispatch) is CORRECT — touch the comment only"

- file: src/panel/overview.ts
  why: "three targets: header :13 (grep-found residual, not in arch-note anchors), overviewJump JSDoc :383-391, inline :405"
  gotcha: "do NOT alter the marker-vocabulary docs (:8-30, :104-125) — accurate; T3.S1 (parallel) edits layout.ts statusMarkers parity docs, not these blocks"

- file: src/panel/actions.test.ts
  why: "inline comment fixes at :1863/:1870 (test_auto_edit_on_complete_set…), :1912 (test_auto_consecutive_edits…), :1982 — the setters there run on ANSWERED questions"
  gotcha: "BASIC fixture: q1 recommendation 'a'; the tests then set cursorIndex manually — the comment is the only wrong part; NEVER touch the expect() lines"

- file: src/ac-scripted.test.ts
  why: ":770 — archived-edit step: q1 is CLOSED with a recorded answer; comment claims ★ preselect"
  gotcha: "outside src/panel/ but a grep-found residual (in scope per 'plus any residual found by grep'); T5.S9/S10 flip ASSERTIONS later — comment-only here avoids collision"

- file: src/panel/short-view.ts
  why: "initialCursorIndex (:119-135) — the landed pinning implementation; its comments are the canonical wording to mirror"
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
├── keys.ts             # ~:437-443 fixed-enter comment — EDIT (comment only)
├── overview.ts         # :13 header, :389-390 JSDoc, :405 inline — EDIT
├── actions.test.ts     # :1863/:1870/:1912/:1982 inline comments — EDIT
└── (all other files)   # untouched: actions.ts/deep-view.ts are T2.S4/S5/S6's unless grep-flagged
src/ac-scripted.test.ts # :770 inline comment — EDIT
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: ZERO behavior edits. If any test fails after your edit, you
//   touched code — revert and re-apply the comment only.
// GOTCHA: re-locate sites by CONTENT grep, not line numbers — T2.S4/S5/S6
//   and T3.S1 land before this task and shift lines.
// GOTCHA: panel.ts:893 contains "ACCEPT the recommendation" INSIDE T1.S2's
//   supersession note ("Supersedes the old … clause") — an INTENTIONAL
//   historical quotation. Keep it; the gate expects exactly that one hit.
// GOTCHA: ★ IS still correct on unanswered questions (R2) — never delete
//   the preselect concept; SCOPE it. The rewrite pattern is always:
//   "recorded answer when present (FR-35/ANSWER-PIN-001); ★ only while
//   unanswered".
// GOTCHA: inline comments on code lines (overview.ts:405, actions.test.ts)
//   share the line with code — edit only the text after `//`; the code
//   before it must stay byte-identical.
// GOTCHA: tool-schema.ts:62 + tool-schema.test.ts:64 strings and
//   regression-phantom-submissions.test.ts:11 are landed/historical — NOT
//   stale; leave them.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: BASELINE
  - VERIFY preconditions: git log shows T2.S4/S5/S6 landed (their PRPs' commits);
    npm run typecheck && npm test green BEFORE any edit.
  - RUN the five contract greps + `rg -n "preselect" src/` and snapshot results
    (this is the "before" half of the grep report).

Task 2: EDIT src/panel/overview.ts (3 sites)
  - Header :13, overviewJump JSDoc :389-390, inline :405 — rewrites per What/§1-4.
  - Style: mirror short-view.ts :121-135 landed wording.

Task 3: EDIT src/panel/keys.ts (1 site)
  - Fixed-enter block ~:437-443 — rewrite per What/§1.

Task 4: EDIT test-file inline comments (5 sites)
  - actions.test.ts :1863/:1870/:1912/:1982, ac-scripted.test.ts :770 —
    comment text only; assertions and surrounding code byte-identical.

Task 5: RESIDUAL RE-GREP + fix
  - Re-run the gate greps. If actions.ts/deep-view.ts/panel.ts/short-view.ts
    still carry stale setter/★ claims (T2.* residuals), rewrite them the same
    way (in scope: "plus any residual found by grep").

Task 6: REPORT + VALIDATE
  - Record the exact greps + post-state (zero stale hits; panel.ts:893 the
    sole accounted hit) in the implementation notes.
  - npm run typecheck && npm test — green, zero test edits.
  - git diff review: only comment tokens changed (see research notes diff check).
```

### Implementation Patterns & Key Details

```ts
// Canonical rewrite voice (match T1.S2 / short-view.ts):
// BEFORE (overview.ts:405):  panel.currentId = q.id; // setter re-seeds cursorIndex (R2 preselect)
// AFTER:  panel.currentId = q.id; // setter re-seeds cursorIndex — recorded answer when present (FR-35); ★ only while unanswered
//
// BEFORE (actions.test.ts:1863):  panel.currentId = "q1"; // setter re-seeds the cursor to the ★ "a" preselect
// AFTER:  panel.currentId = "q1"; // setter re-seeds the cursor to the recorded answer "a" (FR-35)
```

### Integration Points

```yaml
DOCS: Mode A — the purge IS the doc fix; no separate doc files.
PIPELINE: T5.S9/S10 consume the swept comments immediately after — do not
  pre-flip any assertion (that is S9/S10's contract).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck        # tsc --noEmit — zero errors after every file edit
```

### Level 2: Unit Tests (Component Validation)

```bash
npm test                 # vitest run — FULL suite green, zero edits to any test logic
```

### Level 3: The Grep Gate (this task's actual deliverable)

```bash
rg -n "never pin" src/                       # → 0 hits
rg -ni "star preselect" src/                 # → 0 hits
rg -ni "status-agnostic" src/                # → 0 hits
rg -n "preselects it" src/                   # → 0 hits
rg -n "ACCEPT the recommendation" src/       # → exactly 1: panel.ts:893 (documented quote — keep)
rg -n "R2 preselect" src/panel/              # → 0 hits
rg -n "preselect" src/                       # → every hit unanswered-scoped / spec-verbatim / historical
# Expected: greps 1-4,6 zero; 5 exactly the accounted quotation; 7 classified clean
```

### Level 4: No-Behavior Proof

```bash
git diff -U0 | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' \
  | grep -vE '^[+-]\s*(//|\*)' | grep -vE '\s//.*$'   # → empty (comment-only edits)
```

## Final Validation Checklist

- [ ] Level 1-4 all pass; full `npm test` green with zero test edits
- [ ] Grep gate: five contract greps clean (panel.ts:893 sole accounted hit); `R2 preselect` zeroed
- [ ] keys.ts / overview.ts sites rewritten in the T1.S2 voice; test residuals fixed
- [ ] No code line changed (diff check empty); no files touched beyond the named ones (+ any grep-flagged T2 residuals)
- [ ] Exact greps + results reported

## Anti-Patterns to Avoid

- ❌ Don't delete the preselect concept — SCOPE it to unanswered (R2 stays true there)
- ❌ Don't touch assertions/test logic, spec-verbatim schema strings, or historical notes
- ❌ Don't purge panel.ts:893's intentional supersession quotation
- ❌ Don't "improve" accurate unanswered-fixture comments (the DO-NOT-TOUCH list in research notes)
- ❌ Don't fix failing tests by editing tests — a failure means you touched code; revert

---

**Confidence Score**: 9/10 — every stale site is identified with verbatim text, the accurate/stale split is pre-classified, the edits are comment-only, and the gate is deterministic. The one uncertainty: T2.S4/S5/S6 land state at implementation time (handled by the content-grep re-location + residual rule).

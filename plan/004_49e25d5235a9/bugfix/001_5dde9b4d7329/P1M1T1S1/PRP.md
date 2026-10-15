# PRP — P1.M1.T1.S1: Append dated ruling section "WRITEIN-002 supersede re-bind restored (BUG-001)" to spec/decisions.md

## Goal

**Feature Goal**: Record the BUG-001 owner-level adjudication (RESTORE the WRITEIN-002 supersede re-bind) as a dated ledger section in `spec/decisions.md`, in the house format, BEFORE P1.M1.T2/T3/T4 implement it. This section is the citable ruling the implementers reference in code comments and test headers.

**Deliverable**: One new `## {date} interrogation — WRITEIN-002 supersede re-bind restored (BUG-001)` section appended to the END of `spec/decisions.md`, containing a single `WRITEIN-002-RESTORE-001` bullet with six numbered sub-rulings.

**Success Definition**:
- Section appended at the file's end (after the 2026-10-14 DEEP-LAND-001 section), following the house format exactly
- All six required content points present (see What)
- `npm test` + `npm run typecheck` still green (docs-only change — the append must not disturb anything)
- spec/ui-spec.md:37, spec/product-requirements.md:84, and README.md untouched (already correct; they become true again when P1.M1.T2/T3 land)

## Why

BUG-001 (PRD h2.2/h3.0) is a spec-vs-implementation self-contradiction needing adjudication: three canonical sources (ui-spec.md:37 WRITEIN-002, PRD AC-2b tail, README ×2) promise that a committed write-in superseded by an option accept keeps its text and re-binds as `answer.text`, but the VAL-002 fix (consumeCommittedBuffer, delete-at-commit) destroyed the re-bind's carrier text as a side effect — and the shipped test only passes by hand-staging an unreachable slot state. The PRD §Recommendations defers restore-vs-amend to owner level; the adjudication (architecture/overview-and-adjudication.md, 5-point rationale) ruled RESTORE. The repo's convention (e.g. the 2026-10-05 ANSWER-PIN-001 amendment, itself a BUG-001-class adjudication) is that such rulings land in spec/decisions.md FIRST, as the authority the code changes cite.

## What

Append exactly one section. House format (verified against the existing 2026-10-08/2026-10-11/2026-10-14 sections):

- Header: `## {YYYY-MM-DD} interrogation — WRITEIN-002 supersede re-bind restored (BUG-001)` — use the current date at implementation time; the file is chronological and this section goes last
- One bullet: `- WRITEIN-002-RESTORE-001 — ...` (prose style: em-dash after the ID, rulings numbered `(1)…(6)`, verbatim quotes where specified, supersedes/amends chains, PRD + test cross-refs — mirror the BAREKEYS-001/DEEP-LAND-001 bullets)

Required content (the six sub-rulings):

1. **The three contract texts promising the re-bind** — cite and quote: spec/ui-spec.md:37 ("If a write-in is later superseded by accepting a real option, the slot's text is KEPT (R4 — never destroyed) and re-binds as elaboration for the new selection; it attaches at the next submit"), spec/product-requirements.md AC-2b tail ("accepting a real option after a committed write-in keeps the slot's text as elaboration (WRITEIN-002)"), README.md:225-228 + :279 ("a real option after a committed write-in re-binds the slot as elaboration")
2. **VAL-002 history** — consume-at-commit (`consumeCommittedBuffer`, panel.ts:982-991, wired at actions.ts:409/:460 + ripple-confirm.ts:305) correctly killed machine write-through (the advance's `syncBufferToQuestion` copying the just-committed buffer into the slot), but also destroyed the re-bind's carrier text (slot + DraftStore entry) with no doc amendment; note the validator's own alternative fix direction implicitly preserved the re-bind, the shipped form did not
3. **The ruling: RESTORE via re-stage-at-supersede** — new exported helper `stageSupersededWriteIn(panel, questionId, superseded, newValue)` in src/panel/actions.ts with four guards (custom-only / non-empty / not byte-equal to the new value / no user-held slot via `draftTextFor !== undefined`), staged through the public `panel.commitTextDraft` seam, wired at BOTH apply sites (`acceptOptionIndex` direct path actions.ts:~:313 after applyAnswer; `applyConfirmedEdit` FR-18 modal path ripple-confirm.ts:142-166). `reconcileDraftsForSubmit` needs no change — its kept-slot attach branch (actions.ts:573-578) was always correct
4. **VAL-002 protections explicitly UNCHANGED** — consume-at-commit stays (machine write-throughs never become drafts); the re-stage happens ONLY at supersede time, from the recorded answer's value, never over a user-held slot
5. **The rejected alternative** — amend spec/README/test to bless the drop: rejected because it would touch five surfaces (ui-spec:37, PRD AC-2b, README ×2, delete the shipped test at actions.test.ts:2213) and convert an advertised feature into silent data loss (R4 "never destroyed", AC-2b, severity Major)
6. **Cross-refs** — spec/ui-spec.md:37, spec/product-requirements.md AC-2b, src/panel/actions.ts (`stageSupersededWriteIn`), src/panel/actions.test.ts (the rewritten supersede regression test, P1.M1.T3.S1; the manual re-staging at :2223 becomes the bug's regression proof once deleted)

### Success Criteria

- [ ] Section appended at the end of spec/decisions.md, dated, house-formatted
- [ ] All six sub-rulings present; the three contract quotes verbatim
- [ ] The supersede/amend chain recorded (VAL-002's drop was a side effect, not a ruling; this section restores the promise without weakening VAL-002)
- [ ] NO edits to ui-spec.md, product-requirements.md, or README.md
- [ ] `npm test` + `npm run typecheck` green (no code touched)

## All Needed Context

### Context Completeness Check

Docs-only subtask. All content inputs (adjudication rationale, VAL-002 history, verbatim contract quotes, house format) are in two research files verified below — the implementing agent needs this PRP plus those two files and the tail of spec/decisions.md for format. No code knowledge required.

### Documentation & References

```yaml
- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/architecture/overview-and-adjudication.md
  why: "the 5-point adjudication rationale this section RECORDS — §BUG-001 adjudication: RESTORE; every numbered point maps to a required sub-ruling"
  critical: "point 4 (VAL-002 protections preserved) and point 5 (rejected alternative, five surfaces) must not be paraphrased away"

- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/architecture/bug001-writein-supersede.md
  why: "§(b) the four verbatim contract quotes (ui-spec:37, PRD:84, README:225-228/:279); §(c) VAL-002 history incl. the validator's alternative fix direction; §(a) the exact file:line citations for the cross-refs"

- file: spec/decisions.md (tail — sections 2026-10-08 through 2026-10-14)
  why: "house format precedent: dated '## YYYY-MM-DD interrogation — topic (ID)' header, '- ID — prose' bullets with (1)(2)(3) numbered rulings, verbatim owner quotes, supersedes/amends chains"
  pattern: "the 2026-10-05 ANSWER-PIN-001 amendment section is THE precedent — also a BUG-001-class spec-vs-implementation adjudication"

- file: spec/decisions.md (line 41 area, the D-R6 entry)  # read-only reference
  why: "older flat-bullet precedent; NOT needed — the dated-section format is the current convention"
```

### Current Codebase tree (relevant excerpt)

```bash
spec/
├── decisions.md            # APPEND one dated section at the end — the ONLY edit
├── ui-spec.md              # READ-ONLY (:37 already correct)
└── product-requirements.md # READ-ONLY (:84 / AC-2b already correct)
README.md                   # READ-ONLY (:225-228, :279 already correct)
```

### Known Gotchas of our codebase & Library Quirks

```text
# GOTCHA: spec/ is normally READ-ONLY for implementation subtasks — this
#   subtask's contract explicitly authorizes exactly ONE file: the append to
#   spec/decisions.md. Touch nothing else under spec/ or README.md.
# GOTCHA: the section must go at the END (chronological); the last existing
#   section is '## 2026-10-14 interrogation — landing scroll (DEEP-LAND-001)'.
# GOTCHA: use the CURRENT date at implementation time, matching the file's
#   ISO YYYY-MM-DD convention.
# GOTCHA: quotes must be VERBATIM from the sources (they are collected in
#   bug001-writein-supersede.md §(b) — copy from there, not from memory).
# GOTCHA: name the helper exactly `stageSupersededWriteIn` and the ID exactly
#   `WRITEIN-002-RESTORE-001` — P1.M1.T2.T3/T4 code comments and test headers
#   cite these strings.
# GOTCHA: do NOT promise implementation details beyond the adjudicated design
#   (4 guards, 2 wiring sites, commitTextDraft seam) — T2/T3 own the details;
#   this ledger records the ruling, not the diff.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: READ the inputs
  - plan/004_.../bugfix/001_5dde9b4d7329/architecture/overview-and-adjudication.md (§BUG-001)
  - plan/004_.../bugfix/001_5dde9b4d7329/architecture/bug001-writein-supersede.md §(b)/§(c)
  - tail of spec/decisions.md (last 3 sections) for format

Task 2: APPEND the section to spec/decisions.md
  - '## {today} interrogation — WRITEIN-002 supersede re-bind restored (BUG-001)'
  - blank line, then the single '- WRITEIN-002-RESTORE-001 —' bullet with the
    six numbered sub-rulings per the What section (use the research files'
    verbatim quotes and file:line citations)
  - keep the section to one bullet (house precedent: one ruling = one bullet;
    sub-rulings numbered inline like DEEP-LAND-001)

Task 3: VERIFY
  - git diff --stat → exactly one file: spec/decisions.md (append-only)
  - npm test && npm run typecheck → green (unchanged)
```

## Validation Loop

### Level 1: Format

```bash
tail -n 60 spec/decisions.md    # section reads as house-format prose; header dated; one bullet
git diff spec/decisions.md      # append-only: zero deletions
```

### Level 2: Content self-check

- Six sub-rulings present and numbered
- Three contract quotes verbatim against bug001-writein-supersede.md §(b)
- `stageSupersededWriteIn` and `WRITEIN-002-RESTORE-001` strings exact
- VAL-002 protections stated UNCHANGED; rejected alternative + five surfaces named

### Level 3: Repo untouched

```bash
git status --short    # ONLY spec/decisions.md modified
npm test && npm run typecheck
```

### Level 4: Not applicable (docs-only)

## Final Validation Checklist

- [ ] One dated section appended at the end of spec/decisions.md
- [ ] ID `WRITEIN-002-RESTORE-001`; helper name `stageSupersededWriteIn` cited
- [ ] Six sub-rulings; verbatim quotes; PRD/test cross-refs
- [ ] Append-only diff; no other file touched (ui-spec/PRD/README untouched)
- [ ] `npm test` + `npm run typecheck` green
- [ ] The section is citable by P1.M1.T2/T3/T4 (strings match their contracts)

## Anti-Patterns to Avoid

- ❌ Don't edit ui-spec.md:37 or product-requirements.md:84 — they are already correct and become true again when the fix lands
- ❌ Don't paraphrase the contract quotes — verbatim only
- ❌ Don't add implementation detail beyond the adjudicated design (4 guards, 2 sites, commitTextDraft)
- ❌ Don't restructure existing decisions.md sections or reflow the file — append only
- ❌ Don't date it 2026-10-14 or earlier — use the implementation date; the file is chronological
- ❌ Don't forget the VAL-002-protections-unchanged sub-ruling — it is the ruling's load-bearing safety clause

---

**Confidence Score**: 10/10 — documentation-only append with all content pre-collected in two verified research files and the house format demonstrated by on-disk precedent.

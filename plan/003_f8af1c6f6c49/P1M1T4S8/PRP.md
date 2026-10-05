---
name: "P1.M1.T4.S8 — Comment sweep: keys.ts, overview.ts, residuals (single voice for ANSWER-PIN-001)"
description: "Purge/rewrite every REMAINING status-agnostic-preselect comment claim in the panel tree (13 verified sites: overview.ts ×3, keys.ts ×1, actions.ts ×6, ripple-confirm.ts ×2, panel.ts ×1 residual + one duplicated-doc glitch) to the ANSWER-PIN-001 contract. COMMENTS ONLY — zero behavior edits; code lines stay byte-identical except trailing comment text; full suite stays green; report the exact greps run with zero stale hits."
---

## Goal

**Feature Goal**: Complete spec M9's final purge clause for the files NOT covered by S1–S7: every remaining comment/JSDoc that asserts the OLD status-agnostic ★-preselect contract ("the currentId setter / jump / nav / editor-close re-seeds the cursor to the ★ recommendation", unqualified) is rewritten to the ANSWER-PIN-001 contract (FR-35: a recorded answer OWNS the caret; the ★ preselect applies only while a question is UNANSWERED). After this task the panel tree has a SINGLE VOICE — a downstream reader (T5's test stabilization, future maintainers) can trust any cursor-seed comment without re-deriving the ruling.

**Deliverable**: Comment/JSDoc-only edits to `src/panel/overview.ts` (3 sites), `src/panel/keys.ts` (1 site), `src/panel/actions.ts` (6 sites + one duplicated doc-line glitch), `src/panel/ripple-confirm.ts` (2 sites), `src/panel/panel.ts` (1 residual site — the `setView` deep-entry comment :1032-1035, found by the gate grep beyond the seam doc's list). Plus the task-contract OUTPUT artifact: the exact verification greps and their zero-stale-hit results (report in the PR notes / commit message). Status flip of `P1.M1.T4.S8` → Complete in `plan/003_f8af1c6f6c49/tasks.json` (pipeline convention — every subtask commit carries it).

**Success Definition**: (1) The verification greps below return ZERO stale hits on non-test sources (pre-sweep count verified at 13; with exactly ONE allow-listed hit for the panel.ts:893 supersession quote under its own Gate B). (2) `npm run typecheck` green, `npm test` fully green — no behavioral change of any kind. (3) `git diff` shows only comment/JSDoc text changes (code portions of comment-bearing lines byte-identical). (4) No new key labels anywhere (`no-hardcoded-keys` + `keymap-guard` suites green).

## User Persona (if applicable)

**Target User**: The implementer/maintainer reading panel source six months from now (and the T5 test-stabilization agent, which reads these comments to decide what the suite should assert).

**Use Case**: Reading `overviewJump`, `advanceAfterAccept`, `prevQuestion`, or the write-in empty-buffer tail and trusting the comment about where the caret lands — without having to know that a 2026-10-04 ruling (h2.65 ANSWER-PIN-001) silently reversed half of them.

**User Journey**: Developer opens `actions.ts` to understand why `enter` on an answered question doesn't raise the FR-18 modal → the (now corrected) comments state the recorded-answer-first seeding and the FR-D9 inert no-op, consistent with `panel.ts`'s already-updated setter JSDoc.

**Pain Points Addressed**: The spec (h2.65) explicitly orders purging "every 'answers never pin the cursor'/status-agnostic-preselect comment" and flipping tests asserting them — S1–S7 covered short-view/panel/actions-accept-paths/deep-view/schema/marker, but the jump/nav/advance/empty-buffer sites still speak the pre-pin contract. Contradictory comments are exactly how the OLD behavior gets reintroduced by a future "fix".

## Why

- Spec M9 (h2.51): "Purge every 'answers never pin the cursor'/status-agnostic-preselect comment (short-view/panel/actions/deep-view/keys/tool-schema) and flip the tests asserting them (…)". The comment purge is THIS task (test flips are T5.S9/S10; README is T6.S11 — Mode A: "the purge IS the doc fix — in-place comment rewrites, nothing separate").
- ANSWER-PIN-001 (h2.65) reversed the pre-pin cursor-seeding contract, and EXPLAIN-003's "✎ cursor re-seeds to ★ when the editor closes" clause was explicitly superseded ("it re-seeds to the recorded answer when one exists").
- The stale comments are not harmless: several describe the SETTER (`currentId`) and the JUMP/NAV paths, whose targets CAN be answered questions (R1 full-list navigation, unfiltered overview jump) — exactly the paths where the old text is now flatly wrong, not just incomplete.
- Dependency contract (tasks.json): S8 consumes the landed pinning/no-op contracts from T1.S1, T1.S2, T2.S4, T2.S5, T2.S6 (commits `1fba337`…`7972f88`) and feeds T5.S9 (green panel suites) and T5.S10 (AC-16 test).

## What

Rewrite 13 comment sites + 1 doc glitch. **Comments ONLY — zero behavior edits.** Every `git diff` hunk must be pure comment text: for inline comments on code lines (`overview.ts:405`, `actions.ts:404/446`, `ripple-confirm.ts:158/304`), the code portion stays byte-identical; only the `// …` tail changes.

### The canonical replacement formula

All rewrites speak the contract in the SAME terms as the already-updated `panel.ts:347-356` setter JSDoc (landed S1/S2 — this is the voice to match):

> a recorded answer OWNS the caret (its display row, D-R13; the ✎ Other row for write-ins); the ★ recommendation preselect applies only while the question is UNANSWERED (FR-35 / ANSWER-PIN-001)

Site-specific accuracy rules (verified against HEAD — see research/inventory.md):

- **Jump/nav paths** (`overviewJump`, `prevQuestion`/`nextQuestion`/`stepQuestion`): targets come from the UNFILTERED list (R1) and may carry answers → the seed is the recorded answer's row when one exists, else ★. The old "re-seeds to ★ (R2)" text is FLATLY WRONG here.
- **Advance paths** (`advanceAfterAccept`, the two ripple-confirm applies): the target comes from `nextUnanswered` (`UNANSWERED_STATUSES = ["open","reasked"]`, actions.ts:85) → the target is unanswered BY CONSTRUCTION, so the seed DOES land on ★. Rewrite must keep that fact but name it as the pinning contract's unanswered case, not as the setter's general contract.
- **Editor-close/empty-buffer tails** (writeInEnter doc + empty-buffer branch): the `commitTextDraft` re-seed goes to the RECORDED answer's row when one exists, else ★ — EXPLAIN-003's re-seed-to-★ clause is superseded (h2.65 ruling 5).
- **Deep-entry seeding** (`panel.ts` `setView` :1032-1035, a residual BEYOND the seam doc's list — found by the gate grep): the code calls `deepSeedCursorIndex` (post-pin since S6), but the comment still says "seed the selection to the ★ recommendation (clamped into the deep cursor domain — no ✎ index)" — doubly stale: the recorded answer owns the selection, and the ✎ Other index IS legal (clamp bound is `count`).

### Success Criteria

- [ ] All 13 sites + the duplicated doc line rewritten per the table in Implementation Tasks; no stale claim remains
- [ ] Verification grep set (Validation Loop Level 4) returns zero stale hits on non-test sources (pre-sweep: 13); the panel.ts:893 quoted-supersession line is the sole allow-listed "ACCEPT the recommendation" hit (Gate B)
- [ ] `npm run typecheck` green; `npm test` fully green, UNCHANGED (no expectation edits — if any test fails, you changed behavior: revert)
- [ ] `git diff` hunks touch comment text only; code on comment-bearing lines byte-identical
- [ ] `P1.M1.T4.S8` status → Complete in `plan/003_f8af1c6f6c49/tasks.json`

## All Needed Context

### Context Completeness Check

This PRP carries the verified line-by-line inventory of every remaining stale site (grep-proven against HEAD `7972f88`, pre-sweep count 13), the exact current text of each, the canonical replacement formula with the already-landed `panel.ts` wording, the stale-vs-accurate semantics (which paths reach answered targets and which don't), the do-not-touch list of known-good look-alikes (including the three post-pin phrasings the gate grep must exclude), and the re-runnable gate greps. An implementer needs only the five named files + this document.

### Documentation & References

```yaml
- file: src/panel/overview.ts
  why: "3 stale sites — module docstring :13, overviewJump JSDoc bullet :389-390, inline :405 (code-adjacent)"
  pattern: "overviewJump jumps into the UNFILTERED R1 list — targets may carry answers; rewrite to recorded-answer-first seeding"
  gotcha: ":405 sits on a code line — keep `panel.currentId = q.id;` byte-identical, edit only the trailing comment"

- file: src/panel/keys.ts
  why: "1 stale site — router comment :440 (the overview-enter bullet naming 'R2 preselect via the currentId setter')"
  gotcha: "this comment block also documents deep-view/accept behavior — rewrite ONLY the overviewJump parenthetical; do not reflow neighbors"

- file: src/panel/actions.ts
  why: "6 sites + doc glitch — writeInEnter JSDoc :323-327 (duplicated 'EMPTY buffer' line + 'EXPLAIN-003 ★ re-seed'), empty-buffer branch :357-358, writeInEnter tail inline :404 (code-adjacent), advanceAfterAccept JSDoc :413-414, prevQuestion JSDoc :428, stepQuestion inline :446 (code-adjacent)"
  pattern: "advance targets are nextUnanswered → unanswered BY CONSTRUCTION (UNANSWERED_STATUSES = [open, reasked], :85) — keep the ★-for-target fact, drop the unqualified setter claim"
  gotcha: "the FR-D9 byte-identical no-op text in writeInEnter (:329-339, landed S5) is CORRECT — do not touch it; only the EXPLAIN-003 references and the duplicated line change"

- file: src/panel/ripple-confirm.ts
  why: "2 sites — inline :158 (applyConfirmedEdit) and :304 (applyWriteInConfirm), both `// setter re-seeds cursor (R2)` on code lines"
  gotcha: "same nextUnanswered construction as actions.ts — the ★ outcome is real for these targets; the fix is naming WHY"

- file: src/panel/panel.ts
  why: "1 stale site (setView deep-entry comment :1032-1035 — a residual beyond the seam doc's list) + the canonical post-pin voice: currentId setter JSDoc :347-356, cursorIndex JSDoc :367-380, commitTextDraft re-seed :885-896 (incl. the 'Supersedes the old …' quote :891-893)"
  pattern: "copy this phrasing style: 'a recorded answer OWNS the caret … ★ recommendation preselect applies only while UNANSWERED (FR-35 / ANSWER-PIN-001)'"
  gotcha: "edit ONLY :1032-1035; S1/S2 already landed the rest of panel.ts's language; :893's 'ACCEPT the recommendation' is inside the supersession QUOTE and must survive the greps; :376's 'while the ★ recommendation preselect applies only' (continues ':377 while the question is UNANSWERED') is CORRECT post-pin text — a gate-grep false positive, do not touch"

- file: plan/003_f8af1c6f6c49/architecture/panel-ui-seams.md
  why: "§Comment purge sites — the architecture seam list (keys.ts ~:440 · overview.ts ~:390/405 named as REMAINING; actions/short-view/panel/deep-view/tool-schema done in S1–S6)"
  section: "Comment purge sites (status-agnostic-preselect claims)"

- file: plan/003_f8af1c6f6c49/architecture/answer-pinning-contract.md
  why: "the binding contract extracts this sweep enforces (FR-D8 seeding rules, FR-D9 inert no-ops, 'Non-goals — do not drift' list)"
  section: "FR-D8 / Non-goals"

- file: plan/003_f8af1c6f6c49/P1M1T4S8/research/inventory.md
  why: "grep-proven inventory table with exact current text per site + the semantics that classify stale vs accurate + known-good look-alikes"

- file: spec/decisions.md
  why: "h2.65 ANSWER-PIN-001 rulings 1-5 (the supersession authority, incl. EXPLAIN-003's clause reversal)"
  section: "2026-10-04 interrogation — answer pinning (ANSWER-PIN-001)"
```

### Current Codebase tree (relevant slice)

```bash
src/panel/
├── overview.ts        # 409 lines — 3 stale sites (:13, :389-390, :405)
├── keys.ts            # 522 lines — 1 stale site (:440)
├── actions.ts         # 798 lines — 6 stale sites + doc glitch (:323-327, :357-358, :404, :413-414, :428, :446)
├── ripple-confirm.ts  # 332 lines — 2 stale sites (:158, :304)
├── panel.ts           # 1 stale site (:1032-1035) + read-only voice reference (:347-356, :367-380, :885-896)
├── short-view.ts      # READ-ONLY — already post-pin (S1; :121 is a correct gate-grep false positive)
├── deep-view.ts       # READ-ONLY — already post-pin (S6; :585 is a correct gate-grep false positive)
└── *.test.ts          # NOT in this task's scope (T5.S9/S10 own test edits)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# No new files. Comment-only edits to exactly five existing files:
# src/panel/overview.ts     — jump-path cursor-seed claims → ANSWER-PIN-001
# src/panel/keys.ts         — router comment's overviewJump parenthetical
# src/panel/actions.ts      — advance/nav/empty-buffer claims + doc glitch
# src/panel/ripple-confirm.ts — both apply-path inline comments
# src/panel/panel.ts        — setView deep-entry comment ONLY (:1032-1035)
# Plus the pipeline-convention status flip in plan/003_f8af1c6f6c49/tasks.json
```

### Known Gotchas of our codebase & Library Quirks

```text
# CRITICAL: This is a COMMENTS-ONLY sweep. If any test outcome changes, you edited
# code — revert. The suites are behavior pins, not comment pins (verified: no test
# asserts on comment text; the only source-scanning suite, no-hardcoded-keys.test.ts,
# STRIPS comments before matching, so comment edits cannot trip it — but keep `ctrl+…`
# accelerator spellings OUT of new comment text per its own stated review policy).

# CRITICAL: Five sites are trailing comments ON CODE LINES:
#   overview.ts:405, actions.ts:404, actions.ts:446, ripple-confirm.ts:158/304
#   The code prefix must remain byte-identical (only the `// …` tail changes).

# GOTCHA: panel.ts:893 legitimately contains "ACCEPT the recommendation" INSIDE the
# quoted old clause it supersedes ("Supersedes the old 're-seed to the ★ preselect /
# next enter should ACCEPT the recommendation' clause (EXPLAIN-003 — h2.65 ruling 5)").
# It is correct documentation, not a stale claim — never purge it; the gate greps
# allow-list exactly this one hit.

# GOTCHA: advance-path targets are UNANSWERED by construction (nextUnanswered over
# UNANSWERED_STATUSES = ["open","reasked"]) — the ★ seed outcome there is TRUE. The
# stale part is asserting it as the setter's contract. Do not "fix" these to say
# "recorded answer owns the caret" without the unanswered-target qualification, or
# you create a NEW inaccuracy.

# GOTCHA: three CORRECT post-pin phrasings are gate-grep false positives — excluded by
# the gate's UNANSWERED/while/never-to filter, never edited: short-view.ts:121
# ("UNANSWERED questions keep the R2 ★ preselect"), deep-view.ts:585 ("★ recommendation
# preselect applies only to UNANSWERED"), panel.ts:376-377 ("…applies only / while the
# question is UNANSWERED").

# GOTCHA: test-file comments (two-stage.test.ts:229, overview.test.ts:412/:441-452,
# deep-view.test.ts:420/:501, panel.test.ts:618/:828, short-view.test.ts:159) all
# reference UNANSWERED questions — verified accurate. Leave ALL test files alone;
# cross-cutting suite flips are T5.S9/S10's contract.

# GOTCHA: tool-schema.ts:62's recommendation description is the spec-verbatim string
# landed by S3 and pinned by tool-schema.test.ts — never touch it in a comment sweep.
```

## Implementation Blueprint

### Data models and structure

None — no runtime data changes. The only "model" is the canonical comment formula (panel.ts:347-356 voice): a recorded answer owns the caret (display row, D-R13; ✎ Other row for write-ins); ★ preselect applies only while UNANSWERED (FR-35 / ANSWER-PIN-001).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/panel/overview.ts (3 sites + docstring flow)
  - SITE :13 (module docstring, the `enter` bullet tail):
    OLD: "(focus restored, R2 preselect re-seeded via the currentId setter)"
    NEW: "(focus restored; the currentId setter re-seeds the option cursor per
          ANSWER-PIN-001/FR-35 — a recorded answer owns the caret, the ★
          preselect applies only while unanswered)"
  - SITE :389-390 (overviewJump JSDoc bullet):
    OLD: "- `panel.currentId = q.id` re-seeds the short-view option cursor to the
           ★ recommendation (R2 preselect) via the setter."
    NEW: "- `panel.currentId = q.id` re-seeds the short-view option cursor via the
           setter — ANSWER-PIN-001/FR-35: a recorded answer (any status carrying
           one) owns the caret — its display row, the ✎ Other row for write-ins;
           the ★ preselect applies only while the target is UNANSWERED. Jump
           targets are unfiltered (R1), so both cases occur."
  - SITE :405 (trailing comment; keep code prefix byte-identical):
    OLD: panel.currentId = q.id; // setter re-seeds cursorIndex (R2 preselect)
    NEW: panel.currentId = q.id; // setter re-seeds cursorIndex — recorded answer first, else ★ (ANSWER-PIN-001)

Task 2: EDIT src/panel/keys.ts (1 site)
  - SITE :440 (router comment, overview-enter parenthetical only):
    OLD: "short form (overviewJump — restores options focus, R2 preselect via
          the currentId setter)"
    NEW: "short form (overviewJump — restores options focus; the currentId setter
          re-seeds the cursor per ANSWER-PIN-001 — recorded answer first, ★ only
          while unanswered)"
  - Do NOT reflow the surrounding deep-view/accept sentences in the same block.

Task 3: EDIT src/panel/actions.ts (6 sites + doc glitch)
  - SITES :323-327 (writeInEnter JSDoc): remove the duplicated line
    ("…blur back to / Buffer: EMPTY buffer: save the draft + blur back to …"
    appears twice — keep ONE), and replace the EXPLAIN-003 reference:
    OLD: "commitTextDraft tail (draft slot + DraftStore seam + EXPLAIN-003 ★
          re-seed) with arming explicitly off"
    NEW: "commitTextDraft tail (draft slot + DraftStore seam + cursor re-seed —
          ANSWER-PIN-001: the recorded answer's row when one exists, else the ★
          preselect; supersedes EXPLAIN-003's re-seed-to-★ clause, h2.65 ruling 5)
          with arming explicitly off"
    (Rewrap the block's JSDoc lines cleanly; the FR-D9 byte-identical sentences
    at :329-339 are CORRECT — leave their content untouched.)
  - SITE :357-358 (empty-buffer branch comment):
    OLD: "reuse the existing save tail (draftSlots + DraftStore seam + EXPLAIN-003
          cursor re-seed to ★), explicitly NOT a commit"
    NEW: "reuse the existing save tail (draftSlots + DraftStore seam + cursor
          re-seed — ANSWER-PIN-001: recorded answer first, ★ only while
          unanswered), explicitly NOT a commit"
  - SITE :404 (trailing comment; code prefix byte-identical):
    OLD: advanceAfterAccept(panel); // Q14 parity: currentId → next unanswered, cursor → ★ preselect
    NEW: advanceAfterAccept(panel); // Q14 parity: currentId → next unanswered; its cursor seed is the ★ preselect (target is unanswered — ANSWER-PIN-001)
  - SITE :413-414 (advanceAfterAccept JSDoc final sentence):
    OLD: "Assigning currentId re-seeds cursorIndex to the ★ recommendation
          preselect via the panel's own setter."
    NEW: "Assigning currentId re-seeds cursorIndex via the panel's own setter
          (ANSWER-PIN-001/FR-35: a recorded answer owns the caret; ★ preselect
          only while unanswered — the nextUnanswered target is unanswered by
          construction, so its seed is the ★ when a recommendation exists, else
          display row 0)."
  - SITE :428 (prevQuestion JSDoc final sentence):
    OLD: "Cursor resets to the ★ preselect via the currentId setter on every change."
    NEW: "Cursor re-seeds via the currentId setter on every change (ANSWER-PIN-001:
          a recorded answer owns the caret — R1 navigation reaches answered
          questions, so the caret follows their recorded answers, not the ★)."
  - SITE :446 (trailing comment; code prefix byte-identical):
    OLD: panel.currentId = ordered[next].id; // setter re-seeds cursorIndex (R2)
    NEW: panel.currentId = ordered[next].id; // setter re-seeds cursorIndex — recorded answer first, else ★ (ANSWER-PIN-001)

Task 4: EDIT src/panel/ripple-confirm.ts (2 sites; code prefixes byte-identical)
  - SITE :158 (applyConfirmedEdit) and :304 (applyWriteInConfirm):
    OLD: if (nextId !== undefined) panel.currentId = nextId; // setter re-seeds cursor (R2)
    NEW: if (nextId !== undefined) panel.currentId = nextId; // setter seeds cursor — ★ for this unanswered target (ANSWER-PIN-001)

Task 5: EDIT src/panel/panel.ts (1 site — the setView deep-entry residual)
  - SITE :1032-1035 (setView, the `if (view === "deep")` comment):
    OLD: "// Deep entry (P1.M5.T1.S1): seed the selection to the ★ recommendation
          // (clamped into the deep cursor domain — no ✎ index) and reset the
          // scroll window ONCE per entry; deepSticky bookkeeping stays with the
          // router's onDeep/onOverview seams."
    NEW: "// Deep entry (P1.M5.T1.S1): seed the selection via deepSeedCursorIndex —
          // ANSWER-PIN-001/FR-35: a recorded answer owns the selection (its
          // display row; the ✎ Other section for write-ins — legal under the
          // count clamp), ★ preselect only while unanswered — and reset the
          // scroll window ONCE per entry; deepSticky bookkeeping stays with
          // the router's onDeep/onOverview seams."
  - TOUCH NOTHING ELSE in panel.ts (:347-356, :367-380, :885-896 incl. the
    :891-893 supersession quote are already post-pin).

Task 6: VERIFY comment-only diff
  - RUN: git diff --stat  → exactly 5 source files (+ tasks.json after Task 7)
  - RUN: git diff  → every hunk is comment/JSDoc text; the four code-adjacent
    lines keep identical code prefixes. Optional mechanical proof: strip comments
    from before/after versions (the string-aware stripComments pattern lives in
    src/no-hardcoded-keys.test.ts:48) and diff — must be empty.

Task 7: FLIP status in plan/003_f8af1c6f6c49/tasks.json (pipeline convention)
  - P1.M1.T4.S8: "Researching" → "Complete" (ONLY this field; every subtask
    commit in this plan carries its own flip — see git log 7972f88/4a9d277/2d7a98f)

Task 8: RUN + REPORT the gate greps (Level 4 below) with their zero-stale-hit
  output — this is the task contract's OUTPUT artifact; include it verbatim in
  the commit message body.
```

### Implementation Patterns & Key Details

```text
# The rewrites follow ONE voice — panel.ts:347-356 (landed S1/S2):
#   "a recorded answer OWNS the caret (its display row, D-R13; the ✎ Other row
#    for write-ins); the ★ recommendation preselect applies only while the
#    question is UNANSWERED (FR-35 / ANSWER-PIN-001)"
# Variant used on code-adjacent trailing comments (must stay short):
#   "recorded answer first, else ★ (ANSWER-PIN-001)"
# Variant for advance/apply sites (where the target is provably unanswered):
#   "★ for this unanswered target (ANSWER-PIN-001)" — keeps the TRUE ★ outcome
#   while naming the contract that licenses it.

# PATTERN: cite the authority compactly at each site — "ANSWER-PIN-001" (+
# "FR-35" or "h2.65 ruling 5" where the supersession itself is the point).
# The codebase's comment style is dense Mode A JSDoc with decision IDs; match it.

# CRITICAL: do not "improve" any neighboring comment beyond the named sites —
# scope creep in a comments-only task is how behavior accidentally changes.
```

### Integration Points

```yaml
NONE at runtime:
  - no exports, no schemas, no config, no UI strings change
DOWNSTREAM CONSUMERS:
  - tasks.json: P1.M1.T4.S8 → Complete unblocks T5.S9 (flip cross-cutting panel
    suite rows) and T5.S10 (AC-16 scripted test) — both read these comments as
    their spec-of-record for what the suite should assert
  - T6.S11 (README) is unaffected — Mode A: in-place comment rewrites only
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# NOTE: this repo has no ruff/mypy; typecheck is the gate (package.json verified)
npm run typecheck          # tsc --noEmit, strict — clean
# Expected: zero errors. Comment edits cannot introduce type errors; if any
# appear you touched code — revert and re-diff.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The four touched files' suites — must be green UNCHANGED
npx vitest run src/panel/overview.test.ts src/panel/keys.test.ts \
               src/panel/actions.test.ts src/panel/ripple-confirm.test.ts
# Expected: all green with ZERO test edits. Any failure = behavior change = revert.
```

### Level 3: Full Suite (System Validation)

```bash
npm test        # vitest run — full suite green, byte-for-byte same results as HEAD
# Specifically confirm the source-scanning guards stayed green (comments are
# stripped by the scanner, but this is the belt-and-braces proof):
npx vitest run src/no-hardcoded-keys.test.ts src/keymap-guard.test.ts
# Expected: fully green. No new key labels introduced anywhere.
```

### Level 4: Domain-Specific Validation (the task contract's OUTPUT artifact)

```bash
# Gate A — the tasks.json contract terms, non-test sources:
grep -rn -iE "never pin|star preselect|status-agnostic|preselects it" src/ --include="*.ts" | grep -v ".test.ts"
# Expected: ZERO hits.

# Gate B — "ACCEPT the recommendation" (allow-listed supersession quote):
grep -rn "ACCEPT the recommendation" src/ --include="*.ts" | grep -v ".test.ts"
# Expected: EXACTLY ONE hit — src/panel/panel.ts:893 (inside the
# "Supersedes the old '…' clause (EXPLAIN-003 — h2.65 ruling 5)" quote).

# Gate C — the broader stale-claim patterns, non-test sources, post-pin
# false positives excluded (short-view.ts:121, deep-view.ts:585, panel.ts:376):
grep -rnE "R2 preselect|preselect re-seeded|re-seeds cursorIndex \(R2|re-seeds cursor \(R2\)|★ recommendation preselect|★ preselect via|cursor → ★ preselect|re-seed to ★|EXPLAIN-003 ★|cursor re-seed to ★|to the ★ recommendation|resets to the ★ preselect|seed the selection to the ★" src/ --include="*.ts" | grep -v ".test.ts" | grep -vE "UNANSWERED|while|never to the ★"
# Expected: ZERO hits (pre-sweep count verified at 13 — see research/inventory.md;
# the panel.ts:891-893 supersession QUOTE does not match these patterns —
# "re-seed to the ★" contains "the ", which "re-seed to ★" does not match).

# Gate D — comment-only proof:
git diff --stat   # exactly: overview.ts, keys.ts, actions.ts, ripple-confirm.ts, panel.ts (+ tasks.json after flip)
git diff          # every hunk is comment/JSDoc text; code prefixes on
                  # comment-bearing lines byte-identical

# REPORT: paste Gates A–C outputs (zero/expected hits) into the commit message
# body — the contract's OUTPUT is "grep-clean tree (report the exact greps run
# + zero stale hits)".
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1: `npm run typecheck` clean
- [ ] Level 2: the four touched files' suites green with zero test edits
- [ ] Level 3: `npm test` fully green; `no-hardcoded-keys` + `keymap-guard` green
- [ ] Level 4: Gates A/C zero hits; Gate B exactly the one allow-listed quote; Gate D comment-only diff; greps reported

### Feature Validation

- [ ] All 13 sites + the duplicated doc line rewritten; every rewrite names ANSWER-PIN-001 (± FR-35 / h2.65 ruling 5)
- [ ] Jump/nav/deep-entry sites state recorded-answer-first (targets may carry answers); advance/apply sites keep the ★-for-unanswered-target fact; empty-buffer sites state the superseded EXPLAIN-003 clause
- [ ] Zero edits to: panel.ts beyond :1032-1035, short-view.ts, deep-view.ts, tool-schema.ts, any *.test.ts, README.md, spec/, any runtime code
- [ ] tasks.json: P1.M1.T4.S8 → Complete (this field only)

### Code Quality Validation

- [ ] Rewrites match the panel.ts:347-356 voice (single contract, single vocabulary)
- [ ] JSDoc blocks rewrap cleanly (no >100-col stragglers, no orphan `*` lines — the :323-327 duplication is gone)
- [ ] No new key-label spellings (`ctrl+…`, `shift+tab`) in comment text
- [ ] No behavior change of any kind (the suite is the proof)

### Documentation & Deployment

- [ ] Mode A satisfied: the in-place comment rewrites ARE the documentation fix — nothing separate to write
- [ ] Commit message carries the gate-grep outputs (the contract's OUTPUT artifact)

---

## Anti-Patterns to Avoid

- ❌ Don't touch ANY code — a comments-only task that changes a test outcome has failed, however "obvious" the code fix looks
- ❌ Don't purge the panel.ts:893 supersession quote — it documents the reversal itself (h2.65 ruling 5); the greps allow-list exactly that hit
- ❌ Don't rewrite accurate scoped comments: short-view.ts:100/121/130, deep-view.ts:583-590, panel.ts:347-356/367-380/885-896 (:376-377 is a gate false positive), tool-schema.ts:62, and every test-file comment (all verified accurate — test files are T5.S9/S10's scope)
- ❌ Don't "fix" advance-path sites to drop the ★ — the target IS unanswered there (nextUnanswered); state WHY the ★ is licensed, or you mint a new falsehood
- ❌ Don't reflow or "improve" neighboring comments beyond the named sites
- ❌ Don't add `ctrl+…` accelerator spellings to comment text (R5/AC-12 review policy)
- ❌ Don't skip the grep report — the task contract's OUTPUT is the grep-clean evidence, not just the diff

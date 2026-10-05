# PRP — P1.M1.T6.S11: README revisit usage + AC-16 in the acceptance list

name: "README Mode B sync — answer pinning (ANSWER-PIN-001)"
description: Documentation-only task. Sync README.md to the shipped answer-pinning changeset: one revisit paragraph in Usage, AC-16 in the acceptance-criteria summary. Exactly two hunks; nothing else changes.

---

## Goal

**Feature Goal**: README.md (the extension's user-facing doc) reflects the shipped ANSWER-PIN-001 behavior: revisits put the caret on the recorded answer, same-value commits are inert, and AC-16 is part of the tracked acceptance list.

**Deliverable**: Two edits to `README.md` only:
1. A revisit paragraph at the end of Usage step 2 (answering mechanics).
2. The acceptance-criteria summary gains item 16, plus its intro line updated from "2a–2d and 15" to "2a–2d, 15, and 16".

**Success Definition**: `git diff` shows exactly one file (`README.md`) with exactly these two hunks; `npm test` and `npm run typecheck` stay green; every factual claim in the new text matches the shipped code (cites below).

## User Persona

**Target User**: The planner (human) reading the README to learn panel behavior; also future maintainers using the acceptance summary as a regression index.

**Use Case**: A user answered a question earlier, navigates back (`←`/`→` or tab), and needs to know what revisiting an answered question does before they press `enter`.

**Pain Points Addressed**: Before ANSWER-PIN-001, revisits re-seeded the caret to the ★ recommendation and `enter` re-proposed it (the shipped bug — see spec/decisions.md §2026-10-04). The README currently says nothing about revisits, so the new correct behavior is undocumented.

## Why

- Phase D1 (answer pinning) is fully implemented (all sibling tasks Complete): cursor pinning, inert same-value commits, ★ answered marker, AC-16 scripted test. This is the final task — **Mode B changeset-level documentation sync** (delta_prd.md § "Sync changeset-level documentation").
- The README is the single user-facing doc; without this sync it documents stale revisit semantics by omission.

## What

From `plan/003_f8af1c6f6c49/delta_prd.md` (verbatim task definition):

> `README.md`: (1) Usage — a sentence/step covering revisits: the caret sits on the recorded answer in every view, `enter` on it just advances, and changing an answer requires an explicit different choice (which raises the invalidation confirm); (2) the acceptance-criteria summary list gains AC-16. No config keys, hotkey table rows, or limitations change in this delta.

### Success Criteria

- [ ] Usage step 2 ends with a revisit paragraph stating: caret/highlight sit on the recorded answer in every view; `enter` or a digit on the recorded value just advances (no state change, no resubmission, no confirm); changing an answer requires an explicit different choice, which raises the invalidation confirm when it would moot dependents; write-ins pin the caret to the `✎ Other` row; the question line carries the ★ answered marker.
- [ ] The acceptance summary intro line includes 16; the list has an item 16 in the same one-line compression style as items 1–15, citing ANSWER-PIN-001.
- [ ] No other README section changes (config block, keymap tables, limitations, install, development, project structure untouched); no `src/` or `spec/` file changes.

## All Needed Context

### Context Completeness Check

Docs-only task; the implementer needs (a) exact insertion anchors, (b) the shipped-behavior facts to paraphrase accurately, (c) the style contract of the surrounding text. All three are below — no codebase exploration beyond verifying the diff is required.

### Documentation & References

```yaml
- file: plan/003_f8af1c6f6c49/delta_prd.md
  why: Authoritative task definition (§ "Sync changeset-level documentation (Mode B)") + the full Phase D1 contract (FR-D8..D10, AC-16)
  pattern: The two-edit scope and the explicit "No config keys, hotkey table rows, or limitations change" boundary
  gotcha: Mode B is the FINAL task of the phase and depends on all above — all siblings are Complete, so document behavior as SHIPPED, not as planned

- file: README.md
  why: The file being edited — read Usage steps 1-5 and the "Acceptance criteria (spec)" section fully before editing
  pattern: Style contract — second person, em-dashes, `code` spans, wrapped prose (~80 cols), acceptance items are bold-tag one-liners ("16. **Answer pinning (ANSWER-PIN-001)**: … → …")
  gotcha: The write-in paragraph below the Keymap section ALREADY says the short view on revisit shows "✎ on the question line plus a dimmed preview of the recorded value" — the new Usage paragraph complements it; do not contradict or duplicate it

- file: spec/product-requirements.md
  why: AC-16 source text (line ~100) — the README entry is its one-line compression, like item 15 compresses AC-15
  pattern: Item 15's compression style: "15. **Reads never surface (SURFACE-001)**: a model `interrogate({})` read completes → panel stays closed, editor untouched — for live, all-answered, and completed states alike."
  gotcha: Do NOT paste the full spec AC-16 paragraph; compress to the README's house style

- file: src/panel/short-view.ts (initialCursorIndex, :113-127)
  why: Accuracy source for the caret claim — display row of answer.value; ✎ row (options.length) for custom write-ins; 0 for text questions; stale value clamps to row 0, never the ★
- file: src/panel/actions.ts (:182+ digit path, acceptOptionIndex, writeInEnter)
  why: Accuracy source for the inert-commit claim — same-value option/digit and byte-identical write-in re-commits advance with zero state change (no FR-18 modal, no answer.at rewrite, no auto-submit)
- file: src/panel/layout.ts (statusMarkers, :304-313)
  why: Accuracy source for the ★ answered marker — question line shows ★ for any status carrying an answer (⟳ re-asked overrides; moot/withdrawn excluded)
- file: src/ac-scripted.test.ts
  why: Contains the scripted AC-16 test — the "scripted tests proving each" clause of the acceptance intro applies to item 16 as well
```

### Current Codebase tree (README-adjacent region only)

```bash
README.md                  # EDIT THIS — Usage steps 1-5, "Acceptance criteria (spec)" section
spec/product-requirements.md  # READ-ONLY authority (AC-16 full text, line ~100)
plan/003_f8af1c6f6c49/delta_prd.md  # READ-ONLY task definition
src/…                      # READ-ONLY accuracy sources; no source changes in this task
```

### Known Gotchas

```text
# CRITICAL: Docs-only. Any change under src/ or spec/ is out of scope and fails the task.
# The `enter` row in the FIXED-keys table must NOT be edited — it is a hotkey table row and the
#   delta explicitly forbids hotkey-table changes in this changeset.
# Do not renumber Usage steps — the revisit paragraph belongs INSIDE step 2 (answering mechanics),
#   not as a new step 6 (revisiting is answering behavior, and renumbering churns the diff).
# README prose wraps at ~80 columns; acceptance list items are single long lines (house style — match each region).
# The acceptance intro line currently reads "this delta extends it to 2a–2d and 15." —
#   update to "2a–2d, 15, and 16" or the list and its framing disagree.
# No test parses README bodies (config-surface/keymap-guard mention README only in JSDoc comments);
#   npm test/typecheck are regression gates proving no accidental breakage, not README validators.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT README.md — Usage step 2, append the revisit paragraph
  - FIND: step 2 ends with "On a `type:\"text\"` question, `enter` on the
    `✎ answer…` affordance itself opens the editor in the write-in duty —
    `ctrl+t` is not the only entry."
  - APPEND (proposed wording — match README voice; facts are binding, prose is adjustable):
    Revisits are answer-first: on any question that already carries an
    answer, the caret and highlight sit on that recorded answer in every
    view (the ★ recommendation stays visible on its own row but never owns
    the caret once an answer exists), and `enter` or a digit on the
    recorded value just moves you along — no state change, no resubmission,
    no confirm. Changing an answer takes an explicit different choice
    (another row, a different digit, edited write-in text), which raises
    the invalidation confirm when it would moot dependent questions. A
    write-in pins the caret to its `✎ Other` row (with a dimmed preview of
    the text), and answered questions carry the ★ answered marker on the
    question line.
  - NAMING/PLACEMENT: inside step 2, after the text-question affordance sentence
  - GOTCHA: keep step 2's list numbering intact; do not touch steps 3-5

Task 2: EDIT README.md — acceptance-criteria summary gains AC-16
  - FIND: "this delta extends it to 2a–2d and 15." → REPLACE with
    "this delta extends it to 2a–2d, 15, and 16."
  - FIND: the list's final item 15 (SURFACE-001) → APPEND after it, house style:
    16. **Answer pinning (ANSWER-PIN-001)**: revisit an answered question
    → caret + highlight sit on the recorded answer (★ visible on its own
    row, never owning the caret); `enter`/digit on the recorded value is a
    zero-state-change advance; a byte-identical write-in re-commit is
    inert; a DIFFERENT choice raises the FR-18 invalidation confirm.
  - GOTCHA: single line per item (match items 1-15 formatting); compress the
    spec's AC-16 (spec/product-requirements.md:100), don't paste it

Task 3: VERIFY scope + accuracy
  - RUN: git diff --stat  → exactly README.md changed
  - RUN: git diff README.md  → exactly two hunks (Usage step 2 append; acceptance intro line + item 16)
  - CROSS-CHECK every claim in the new text against the cites in Documentation & References
    (short-view.ts pinning, actions.ts inert commits, layout.ts ★ marker)
```

### Integration Points

```yaml
CONFIG: none (forbidden by delta)
DATABASE: none
ROUTES: none
DOCS: README.md only — Mode B (changeset-level); Mode A (in-code JSDoc) already landed with the siblings
```

## Validation Loop

### Level 1: Scope & Content (docs gates)

```bash
# Exactly one file, exactly two hunks
git diff --stat                       # expect: README.md only
git diff README.md                    # expect: Usage step-2 paragraph append + acceptance intro line + item 16

# Content assertions (all must hit)
grep -c "ANSWER-PIN-001" README.md    # >= 2 (new Usage paragraph or item 16; item 16 required)
grep -n "16\. \*\*Answer pinning" README.md   # exactly one hit
grep -n "2a–2d, 15, and 16" README.md # the updated intro line
grep -n "invalidation confirm" README.md      # the revisit paragraph names the FR-18 confirm

# Forbidden-zone regression (all must be empty)
git diff README.md | grep -E '^[+-].*("keys"|ctrl\+d.*overview|Limitations|## Install)' | head
# Expected: no output — config block, keymap tables, limitations untouched
```

### Level 2: Regression (prove no breakage)

```bash
npm test            # vitest run — full suite green (AC-16 scripted test among them; no test parses README bodies)
npm run typecheck   # tsc --noEmit — green
```

### Level 3: Accuracy cross-check (manual)

Re-read the two new hunks against: `src/panel/short-view.ts` `initialCursorIndex`, `src/panel/actions.ts` same-value branches, `src/panel/layout.ts` `statusMarkers`, spec AC-16. Any claim not backed by one of those is wrong — fix the prose, not the code.

### Level 4: Not applicable (no runtime surface changes)

## Final Validation Checklist

- [ ] `git diff --stat` → README.md only; two hunks total
- [ ] Usage step 2 carries the revisit paragraph (caret on recorded answer; enter/digit = advance-only; different choice → invalidation confirm; write-in ✎ row pin; ★ answered marker)
- [ ] Acceptance intro line reads "…2a–2d, 15, and 16."; item 16 present in house style citing ANSWER-PIN-001
- [ ] Config block, keymap tables (incl. the fixed `enter` row), Limitations, Install, Development, Project structure untouched
- [ ] No `src/` or `spec/` files modified
- [ ] `npm test` green · `npm run typecheck` green
- [ ] Prose matches README voice (second person, em-dashes, `code` spans, ~80-col wrap in Usage; single-line acceptance item)
- [ ] New text does not contradict the existing write-in revisit sentence (✎ marker + dim preview)

## Anti-Patterns to Avoid

- ❌ Don't paste the full spec AC-16 paragraph into the README — compress to house style
- ❌ Don't "improve" the keymap tables or config block while in the file — explicitly out of scope
- ❌ Don't document planned behavior — document the SHIPPED behavior (siblings are Complete; cites in this PRP)
- ❌ Don't add a new Usage step or renumber steps — the paragraph lives inside step 2
- ❌ Don't edit spec/product-requirements.md to match the README — the spec is the authority; README compresses it

---

**Confidence Score**: 9/10 — docs-only, both hunks fully specified with exact anchors, proposed text, binding facts with file cites, and grep-verifiable gates. The 1-point residual: final prose taste (wrap/wording) belongs to the implementer within the stated factual constraints.

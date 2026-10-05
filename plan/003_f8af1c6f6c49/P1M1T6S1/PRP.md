# PRP — P1.M1.T6.S11: README.md — revisit usage + AC-16 in the acceptance list

## Goal

**Feature Goal**: README.md reflects the complete landed ANSWER-PIN-001 changeset (P1.M1.T1–T5) coherently: the Usage section documents revisits (recorded answer owns the caret; `enter` on it just advances; editing requires an explicit different choice guarded by the invalidation confirm), and the acceptance-criteria summary list gains AC-16 in the list's existing entry format.

**Deliverable**: `README.md` edited in exactly two spots — (1) one sentence appended to Usage step 2, (2) the AC summary list extended with entry 16 plus its preamble count updated. Zero other files touched; zero config/keymap/limitations content touched.

**Success Definition**: `git diff --name-only` shows only `README.md`; the AC list ends at 16 with the preamble saying "2a–2d, 15 and 16"; the Usage sentence covers all three binding clauses (caret pins / inert enter / explicit-different-choice + confirm); every grep gate below passes.

## User Persona (if applicable)

**Target User**: the pi user reading the README to learn how the interrogation panel behaves (this is shipped-product documentation, not internal spec).

**Use Case**: a user answered questions earlier in a session, navigates back to one (or resumes after `esc`), and wants to know what the caret sitting on their old answer means, what `enter` will do there, and how to actually change it.

**User Journey**: read Usage step 2 → answers questions → navigates back → sees caret on the recorded answer → README told them `enter` is safe (just advances) and changing requires picking something else (with a confirm when dependents are invalidated).

**Pain Points Addressed**: previously the README said nothing about revisits — a user landing on an answered question could fear `enter` re-answers/re-ships or that the ★ recommendation overrode their earlier choice.

## Why

- The answer-pinning changeset landed in production through T1–T4 (commits `1fba337`, `886489c`, `6fd79f9`, `d6d1553`, `2d7a98f`, `4a9d477`, `7972f88`, `f3e00c5`, `4e17456`); T5 stabilizes the test suites. README.md — the user-facing doc — still describes none of it and its AC summary stops at 15. This is the changeset-level documentation task (Mode B): the final item of the breakdown, depending on every implementing subtask.
- The parallel items (T5.S9 test flips, T5.S10 AC-16 scripted test) are confined to `src/**/*.test.ts` and explicitly hand the README update to this task — no file conflicts, no sequencing hazards beyond "write after reading current README state".

## What

Three precise edits to `README.md`, nothing else. Anchors verified against the working tree 2026-10-05 at commit `4e17456` (README clean); **locate by the quoted content, lines may drift** if parallel work lands first (it should not — no parallel item edits README).

### Edit A — Usage step 2: append the revisit sentence

End of numbered step 2 currently ends (line 47) with:

```
   in the write-in duty — `ctrl+t` is not the only entry.
```

Append, still inside step 2, as new wrapped prose (match the file's ~75–80 col hard-wrap and 3-space list-continuation indent):

```
   Revisits are answer-pinned (ANSWER-PIN-001): landing on an answered
   question in any view — navigation, overview jump, deep view, or resume —
   puts the caret on the recorded answer (the `✎ Other` row for
   write-ins), where `enter` just advances; changing the answer takes an
   explicit different choice, and a change that invalidates dependent
   answered questions raises the `⚠ Invalidates … — enter=keep, esc=cancel`
   confirm first.
```

This single sentence carries the three binding clauses from the item contract:
1. **caret pins** — "landing on an answered question in any view … puts the caret on the recorded answer (the `✎ Other` row for write-ins)" (FR-D8; "any view" enumerates navigation / overview jump / deep view / resume — every entry path FR-35 lists);
2. **inert enter** — "`enter` just advances" (FR-D9: no state change, no modal, no re-ship);
3. **explicit different choice → confirm** — with the exact scope nuance: the FR-18 confirm fires only when the change *invalidates dependent answered questions* (verbatim shipped string: `⚠ Invalidates {n} answered questions ({ids}) — enter=keep, esc=cancel`, see `src/panel/ripple-confirm.ts:14`). Do not imply every different choice confirms.

### Edit B — AC preamble: extend the delta count

Line 252 currently reads:

```
extends it to 2a–2d and 15. Summary (scripted where possible — see the spec
```

Change to:

```
extends it to 2a–2d, 15 and 16. Summary (scripted where possible — see the spec
```

(The `2a–2d` dash is an en-dash `–` — preserve it byte-for-byte; the markdown link on the preceding line stays untouched.)

### Edit C — AC list: append entry 16

After entry 15 (single line, line 273):

```
15. **Reads never surface (SURFACE-001)**: a model `interrogate({})` read completes → panel stays closed, editor untouched — for live, all-answered, and completed states alike.
```

append one blank-line-free next line (AC entries are **single unwrapped lines** — verified sibling lengths 67–233 chars; do NOT wrap this entry like Usage prose):

```
16. **Answer pinning (ANSWER-PIN-001)**: answer with a NON-recommended option, revisit → caret + accent highlight sit on the recorded answer (`★` visible on its own row, caret NOT on it); `enter` on it advances with zero state change; a write-in answer pins to the `✎ Other` row (byte-identical re-entry inert); a DIFFERENT option still raises the FR-18 confirm.
```

Format mirrors entry 15 exactly: `N. **Label (TAG)**: condensed spec text.` Content is the condensed spec AC-16 (spec h2.10 item 16) — same clauses, spec's vocabulary (`accent highlight`, `byte-identical`, `FR-18 confirm`), README-typical density. A blank line must remain between entry 16 and `## Limitations` (line 275).

### Success Criteria

- [ ] Usage step 2 ends with the revisit sentence containing all three binding clauses (caret pins in every view / `enter` just advances / explicit different choice raising the invalidation confirm)
- [ ] AC summary list ends at 16; entry 16 follows the `N. **Label (TAG)**:` single-line format of entry 15
- [ ] Preamble says "extends it to 2a–2d, 15 and 16"
- [ ] `git diff --name-only` → exactly `README.md`
- [ ] No diff hunks inside `## Configuration`, `## Keymap`, `## Limitations`, `## Development`, `## Project structure`
- [ ] Existing content (steps 1–5 semantics, entries 1–15, model behavior note, deep-view contract) unchanged apart from Edits A–C

## All Needed Context

### Context Completeness Check

An implementer who knows nothing about this repo can execute this PRP: both edit spots are located by unique verbatim anchors, the exact replacement text is prescribed (including wrap style, dash characters, and single-line-vs-wrapped conventions), and the gates are copy-pasteable greps. No other document must be read; references below are supporting rationale, not required reading.

### Documentation & References

```yaml
- file: README.md
  why: THE file being edited — Usage (lines 30–116), AC summary (lines 248–273)
  pattern: "Usage prose = hard-wrapped ~75–80 cols, 3-space list indent; AC entries = single unwrapped lines `N. **Label (TAG)**: …`"
  gotcha: "line 47 anchor is unique; the AC-15 line and the 'extends it to 2a–2d and 15.' line are unique; `2a–2d` uses en-dash U+2013, the confirm string uses `…` (U+2026) — copy them, don't retype"

- file: plan/003_f8af1c6f6c49/P1M1T6S1/research/notes.md
  why: today-verified anchors, line numbers, README anatomy, landed-commit map, exclusion reasoning
  gotcha: "README has NO ★/preselect claims outside the edit spots (grep-verified) — nothing else needs syncing"

- file: plan/003_f8af1c6f6c49/architecture/answer-pinning-contract.md
  why: binding extract of FR-D8/D9/D10 + AC-16 — the behavior the new prose must describe accurately
  pattern: "recorded answer owns the caret at its display row / ✎ Other row; ★ preselect only while unanswered; same-value commits inert; FR-18 confirm only on explicit DIFFERENT choice"

- file: spec/product-requirements.md
  why: authoritative AC-16 text (h2.10 item 16) being condensed into Edit C; FR-35 (h3.5) behind Edit A
  gotcha: READ-ONLY reference — never edit spec/

- file: src/panel/ripple-confirm.ts
  why: verbatim shipped confirm string `⚠ Invalidates {n} answered questions ({ids}) — enter=keep, esc=cancel` (line 14) quoted in Edit A
  gotcha: read-only; README quotes it abbreviated as `⚠ Invalidates … — enter=keep, esc=cancel`
```

### Current Codebase tree (README region only)

```bash
README.md            # 29,007 B, clean at 4e17456
├── ## Usage                     # EDIT SPOT 1 — step 2 ends line 47
├── ## Configuration / ## Keymap # DO NOT TOUCH (verified: no conflicting claims)
├── ## Acceptance criteria (spec)# EDIT SPOT 2 — preamble line 252, entry 16 after line 273
└── ## Limitations / Development / Project structure  # DO NOT TOUCH
```

### Desired changes (no new files)

```bash
README.md   # Edit A: +7 wrapped lines at end of Usage step 2
            # Edit B: 1 line modified (AC preamble)
            # Edit C: +1 line (AC-16 entry)
```

### Known Gotchas of our codebase & Library Quirks

```text
# CRITICAL: Two wrap conventions coexist in README.md — Usage prose is
# hard-wrapped (~75–80 cols, 3-space continuation indent for list items);
# acceptance-list entries are SINGLE UNWRAPPED LINES. Edit A wraps; Edit C
# must NOT wrap.

# CRITICAL: Unicode discipline — `2a–2d` uses en-dash (–), the confirm
# string uses `…` and `—`. Copy the exact characters from this PRP or the
# file; retyping with ASCII hyphens/dots breaks grep gates and diff review.

# GOTCHA: FR-18 scope — the confirm fires only when a DIFFERENT choice
# invalidates dependent answered/submitted questions via dependsOn. The
# Usage sentence must scope it ("a change that invalidates dependent
# answered questions raises the … confirm"), never "changing an answer
# raises the confirm".

# GOTCHA: Two different ★ meanings exist after this changeset — the
# option-row recommendation ★ (visible, never owns the caret once answered)
# and the new question-line answered ★ marker (FR-D10). The prescribed
# prose deliberately mentions only the option-row ★ (inside AC-16's "★
# visible on its own row, caret NOT on it"). Do NOT add a glyph legend or
# question-line-marker sentence to Usage — the README documents no status
# glyphs anywhere today, and conflating the two stars would confuse users.

# GOTCHA: Do not "improve" neighboring text. The item contract fixes the
# delta to two spots; sweeping rewrites of steps 3–5 or entries 1–15 are
# failures, not polish. The Model behavior note needs no edit — it makes no
# preselect/recommendation claim (grep-verified).

# NEVER: touch ## Configuration (config keys), ## Keymap (hotkey table),
# ## Limitations — the item contract states nothing else in this delta
# changes them. The keymap `← →` row (README:194) already reads correctly
# under pinning ("Previous / next question — the FULL list").
```

## Implementation Blueprint

### Data models and structure

Not applicable — documentation-only task; no code, schema, or state surface.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: READ README.md fully (29 KB, ~410 lines) — confirm the three anchors
  still match verbatim ("in the write-in duty — `ctrl+t` is not the only entry.",
  "extends it to 2a–2d and 15.", the entry-15 line). If any anchor drifted,
  locate it by content (grep the distinctive fragment); do not proceed blind.

Task 2: EDIT A — append the revisit sentence to Usage step 2 (after line 47)
  - INSERT the 7-line wrapped block from "What → Edit A" verbatim
  - MATCH: hard-wrap ~75–80 cols, 3-space continuation indent (copy a sibling
    line's indentation exactly)
  - VERIFY clauses: caret-pins-in-any-view / enter-just-advances /
    explicit-different-choice + scoped FR-18 confirm — all three present

Task 3: EDIT B — AC preamble (line 252)
  - REPLACE "extends it to 2a–2d and 15." → "extends it to 2a–2d, 15 and 16."
  - PRESERVE: en-dash in 2a–2d, the markdown link on the preceding line,
    the rest of the sentence ("Summary (scripted where possible …)")

Task 4: EDIT C — append AC-16 after entry 15 (line 273)
  - INSERT the single line from "What → Edit C" verbatim (no wrap)
  - MATCH: entry-15 format `16. **Label (TAG)**: …`
  - PRESERVE: blank line between the list and "## Limitations"

Task 5: RUN the validation gates (below) — all greps, then diff review
  - git diff --name-only → README.md only
  - git diff README.md → hunks exist ONLY in the Usage step-2 region and the
    AC preamble/list region
```

### Implementation Patterns & Key Details

```markdown
<!-- The entire implementation is three text edits. Concise diff shape: -->

 ## Usage
 ...
    in the write-in duty — `ctrl+t` is not the only entry.
+   Revisits are answer-pinned (ANSWER-PIN-001): landing on an answered
+   question in any view — navigation, overview jump, deep view, or resume —
+   puts the caret on the recorded answer (the `✎ Other` row for
+   write-ins), where `enter` just advances; changing the answer takes an
+   explicit different choice, and a change that invalidates dependent
+   answered questions raises the `⚠ Invalidates … — enter=keep, esc=cancel`
+   confirm first.
 3. Submitting is mostly automatic: ...

-extends it to 2a–2d and 15. Summary (scripted where possible — see the spec
+extends it to 2a–2d, 15 and 16. Summary (scripted where possible — see the spec

 15. **Reads never surface (SURFACE-001)**: …
+16. **Answer pinning (ANSWER-PIN-001)**: answer with a NON-recommended option, revisit → caret + accent highlight sit on the recorded answer (`★` visible on its own row, caret NOT on it); `enter` on it advances with zero state change; a write-in answer pins to the `✎ Other` row (byte-identical re-entry inert); a DIFFERENT option still raises the FR-18 confirm.
```

### Integration Points

```yaml
NONE: documentation-only. No config, schema, routes, state machine, or code.
COORDINATION: parallel items T5.S9 (in flight) and T5.S10 (planned) edit only
  src/**/*.test.ts — zero file overlap with README.md. Because they edit the
  panel suites concurrently, this task does NOT run vitest as a gate.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Markdown sanity — the file must still render as one coherent document:
grep -c "^## " README.md        # expect 8 (unchanged section count)
grep -n "not the only entry" -A 8 README.md   # revisit sentence follows, wrapped

# Unicode discipline — en-dash and ellipsis survived the edit:
grep -n "2a–2d, 15 and 16" README.md          # hit (en-dash, not hyphen)
grep -n "⚠ Invalidates …" README.md           # hit in Usage (…, not ...)

# Expected: all three greps hit; no test/typecheck applies (no code changed).
# Do NOT run vitest as a gate: panel suites are being edited in parallel
# (T5.S9) — a docs-only diff cannot break them, and their transient state
# is not this task's signal.
```

### Level 2: Content Contract (the real gate)

```bash
# AC list ends at 16, entry format matches, exactly one entry 16:
grep -c "^16\. \*\*Answer pinning (ANSWER-PIN-001)\*\*:" README.md   # 1
grep -n "^15\. \|^16\. " README.md                                   # consecutive

# The three binding clauses in Usage (each grep must hit; single quotes avoid
# backtick-escaping issues; "explicit$" catches the hard-wrapped clause):
grep -n 'Revisits are answer-pinned' README.md                        # hit
grep -n 'caret on the recorded answer' README.md                     # hit
grep -n 'just advances' README.md                                    # hit
grep -n 'explicit$' README.md                                        # hit (wrap point)
grep -n 'raises the .⚠ Invalidates' README.md                        # hit (scoped confirm)

# Forbidden zones untouched:
git diff --name-only                  # → README.md only
git diff README.md | grep -E "^@@"   # hunk headers only in Usage / AC regions
```

### Level 3: Diff Review (final)

```bash
git diff README.md
# Expected: exactly three change clusters —
#   1. +7 wrapped lines at end of Usage step 2 (Edit A)
#   2. 1 modified line in the AC preamble (Edit B)
#   3. +1 single line after AC-15 (Edit C)
# Any hunk inside Configuration/Keymap/Limitations/Development/Project
# structure, any modification to entries 1–15 or steps 1–5, any reflow of
# untouched lines → revert that hunk and redo surgically.
```

### Level 4: Reader Coherence (manual, 2 minutes)

Read Usage top to bottom: step 2 now flows …write-in duty → revisit sentence → step 3's "an edit made while the set is already complete ships immediately too" reads as the natural continuation (the revisit sentence explains HOW an edit happens; step 3 explains WHEN it ships). Read the AC list top to bottom: 15 → 16 reads as the natural delta finale. If either passage now repeats or contradicts itself, tighten the added sentence — not the pre-existing text.

## Final Validation Checklist

### Technical Validation

- [x] All validation levels completed (greps + diff review; no build/test gates apply to docs)
- [ ] `git diff --name-only` → exactly `README.md`
- [ ] `grep -c "^16\. \*\*Answer pinning" README.md` → 1; list ends at 16
- [ ] Preamble reads "extends it to 2a–2d, 15 and 16" (en-dash preserved)
- [ ] Unicode intact: `–` `—` `…` `★` `✎` `⚠` `→` all present as intended

### Feature Validation

- [ ] Usage revisit sentence covers all three binding clauses (pins / inert enter / explicit different choice + scoped confirm)
- [ ] AC-16 entry matches entry-15's `N. **Label (TAG)**:` single-line format
- [ ] Confirm scope is conditional ("a change that invalidates dependent answered questions"), not universal
- [ ] Reader-coherence pass (Level 4) done

### Code Quality Validation

- [ ] Wrap conventions respected (Usage wrapped; AC entry single-line)
- [ ] No changes outside the two spots; no "helpful" extras (no glyph legend, no keymap/config/limitations edits, no Model-behavior-note edit)
- [ ] Spec files, tasks.json, PRD artifacts untouched

### Documentation & Deployment

- [ ] README remains the single user-facing doc reflecting shipped behavior — no forward-looking claims (everything described is landed in T1–T4)

## Anti-Patterns to Avoid

- ❌ Don't rewrap or reflow surrounding paragraphs "while you're in there" — surgical hunks only
- ❌ Don't document the question-line answered ★ marker in Usage — README legends no glyphs; AC-16's option-row ★ mention suffices (two-star conflation risk)
- ❌ Don't quote the confirm string fully with `{n}`/`{ids}` placeholders in user docs — the prescribed `⚠ Invalidates … — enter=keep, esc=cancel` abbreviation matches README voice
- ❌ Don't convert the AC summary into spec-verbatim copies — entries are condensed (compare spec AC-15 vs README AC-15); Edit C is already the right density
- ❌ Don't run vitest/typecheck gates and chase their state — parallel test work owns those suites
- ❌ Don't touch spec/, plan/**/tasks.json, or PRD snapshots — read-only inputs

---

**Confidence Score: 9/10** — the entire implementation is three verbatim-prescribed text edits with unique anchors verified against today's clean tree, exact format models (entry 15 for the list, sibling prose for wrapping), and grep-level gates. Residual 1/10: markdown wrap-width judgment on Edit A (mitigated by the prescribed 7-line block) and the theoretical case of a parallel item touching README (none is scoped to).

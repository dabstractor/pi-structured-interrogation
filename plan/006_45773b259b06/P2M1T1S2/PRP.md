# PRP — P2.M1.T1.S2: README residue audit against the updated PRD; fix drift in README only

---
name: "P2.M1.T1.S2 — README residue audit + docs catch-up (Mode B, docs-only)"
description: "DOCS-ONLY: consume the P2.M1.T1.S1 conformance matrix, audit README.md section by section against the eight post-2026-10-19 rulings' strings, fix the pre-found drift spots (D1: Usage §3 delta shape/epoch position; D2: AC-2 summary row) in README.md ONLY with every fix citing its ruling, run the section-by-section sweep for anything the pre-audit missed, and fence the KNOWN INTENTIONAL RESIDUE (AC-9 'drafts gone' row + limitations drafts phrasing — P3.M5.T1.S2 owns those). Zero code, zero spec/ changes. Output: README consistent with shipped behavior; consumed by P3.M5.T1.S2 for the final docs flip."
---

## Goal

**Feature Goal**: README.md tells the truth about the eight post-2026-10-19 rulings (ANSWER-FIDELITY, KEEP-OPEN-001/002, DEEP-FULLSCREEN-001, PANELTOGGLE-001, CHAT-CONTEXT-001, LENIENT-ANSWER-001, EMPTY-REPLY-001, CHAT-STYLE-001): no prose contradicts the updated PRD's shipped behavior, and every fix names the ruling it reflects (Mode B docs catch-up).

**Deliverable**: `README.md` at the repo root with (a) two pre-found drift spots fixed — Usage §3 delta description (lines ~86-88) and the AC-2 summary row (line ~399) — plus (b) any additional drift a fresh section-by-section sweep finds, each fix citing its ruling tag. Nothing else changes: no source, no spec/, no other tracked file.

**Success Definition**: A re-audit grep pass over README finds zero statements contradicting the ruling strings (exact assertions in Validation Loop); `git diff --name-only` shows exactly `README.md` modified (plus untracked `plan/006_*` artifacts); the intentional-residue fence holds (AC-9 row and limitations drafts phrasing byte-identical to pre-edit); `npm test` / `npm run typecheck` / `npm run lint` stay green with counts matching the S1 conformance matrix.

## User Persona

**Target User**: The human owner reading README to learn what the extension actually does today, and the P3.M5.T1.S2 implementer who will later flip the drafts-limitation wording once local input recovery ships.

**Use Case**: After eight behavior-changing rulings landed (most silently — internal delta format, panel lifecycle), README is the only user-facing doc; it must not teach superseded behavior (budget-era deltas, epoch-at-the-end, reminder-always).

**User Journey**: Owner reads Usage §3 → learns the exact delta shape (header + full answer lines + reminder/PARTIAL nudge) and that the epoch rides the header they must have the model echo → reads AC summary → sees the spec's own AC-2 wording ("never a capped/partial delta") → trusts the doc.

**Pain Points Addressed**: README currently misplaces the epoch ("ending with `(state epoch {n})`" — it's in the header/first line) and calls the delta "compact" twice, resurrecting the deleted budget era; the AC-2 row says "+ reminder" where an early submit actually swaps in the PARTIAL nudge.

## Why

- The plan-006 PRD delta added eight rulings as already-implemented; S1 mechanically proved them landed in code — S2 is the docs catch-up half (Mode B): README is the delta's user-facing record and must not contradict shipped behavior.
- P3 (local input recovery) and specifically P3.M5.T1.S2 build directly on this: the final docs flip (limitations row → "memory-only drafts until local input recovery ships", AC-9 rewording) assumes README is otherwise already consistent — leftover drift would make that flip ambiguous.
- P1 (keymap refresh) already re-verified and rewrote the keymap/re-verification sections — this audit must not churn that landed work.

## What

### Behavior contract (exact)

1. **Consume the S1 matrix first.** Read `plan/006_45773b259b06/P2M1T1S1/research/conformance-matrix.md`. If it carries `"result": "bug"` or any ruling with `green: false`, STOP — README must not be aligned to behavior that isn't landed; report back instead. If the file is missing entirely, note it and proceed with the read-only spec as ground truth (S1 runs in parallel; its contract guarantees the matrix exists by completion).
2. **Fix the two pre-found drift spots** (exact current text, prescribed replacements, and ground truth are in the audit-findings research note and the Implementation Blueprint below). Both fixes cite their rulings inline (Mode B).
3. **Run the full sweep yourself** — section by section, the grep recipe below — to catch anything the pre-audit missed. The pre-audit found the rest CLEAN (verified-clean table in the research note): expect no further edits; a new find must cite the contradicting PRD string before you edit.
4. **Fence the intentional residue** — DO NOT TOUCH, even though the sweep pattern list names it: (a) the AC-9 row's "drafts gone (documented)" (README ~:404); (b) the Limitations section's drafts phrasing — "cross-restart draft persistence (documented limitation)" in the non-goals line and the "Drafts are in-session only" bullet. P3.M5.T1.S2 owns that flip (to the implementation-plan h2.56 wording "memory-only drafts until local input recovery ships") AFTER recovery ships. Editing them here would collide with that item.
5. **Docs-only hygiene**: fixes are minimal-diff prose edits; no reformatting of untouched lines, no reordering, no "completing" absent descriptions (absence is not contradiction — e.g. README need not describe DEEP-FULLSCREEN-001's fullscreen budget; it makes no contrary claim).

### Success Criteria

- [ ] D1 fixed: Usage §3 no longer says "compact delta … ending with `(state epoch {n})`"; describes header-line `Submitted {n} (state epoch {e})` + ONE full untruncated line per changed answer + reminder, with the PARTIAL nudge swap (KEEP-OPEN-002) and ANSWER-FIDELITY cited.
- [ ] D2 fixed: AC-2 summary row matches spec AC-2 ("header + every changed answer in full", "never a capped/partial delta", PARTIAL nudge swap), rulings cited.
- [ ] Sweep greps run section-by-section; every hit either judged clean against the verified-clean table or fixed with a ruling citation; no NEW contradicting prose introduced by the fixes.
- [ ] AC-9 row and Limitations drafts phrasing byte-identical to pre-edit (verify with the fence assertions below).
- [ ] `git diff --name-only` → exactly `README.md`; gates green matching S1's counts.

## All Needed Context

### Context Completeness Check

The audit is pre-run: both drift spots carry exact current text + prescribed replacement + the authoritative spec strings; the verified-clean table covers the other six ruling surfaces; the fence spots are named. The implementing agent verifies, edits two (or few) spots, and re-greps.

### Documentation & References

```yaml
- file: plan/006_45773b259b06/P2M1T1S2/research/readme-audit-findings.md
  why: THIS ITEM'S PRE-RUN AUDIT — D1/D2 exact text + prescribed fixes, verified-clean table, fence spots, ground-truth strings
  critical: the "VERIFIED CLEAN" table prevents churn on correct prose (e.g. "as the panel exits" IS correct per FR-3(d); "editor pins below the pane" IS correct per DEEP-EDITOR-001)

- file: plan/006_45773b259b06/P2M1T1S1/research/conformance-matrix.md
  why: INPUT CONTRACT — the ruling inventory + green baseline; a "bug" result there halts this item
  gotcha: produced by the parallel S1 run; read-don't-trust, but never edit it

- file: README.md
  why: THE ONLY WRITE TARGET; drift spots at :86-88 (Usage §3) and :399 (AC-2 row); fence at :404 (AC-9) and Limitations ~:424-435

- file: spec/product-requirements.md
  why: FR-3(a) exact delta shape; FR-3(d) post-submit auto-suspend; FR-5; FR-15; FR-36; AC list (AC-2 is D2's ground truth; AC-9 shows P3's future wording — do NOT sync it here)
  gotcha: READ-ONLY (hash-guarded PRD component)

- file: spec/decisions.md
  why: ruling texts — ANSWER-FIDELITY (h2.82 entry), KEEP-OPEN-001/002 (h2.86), DEEP-FULLSCREEN-001 + DUMP-ONCE-001 (h2.85, superseded half noted), PANELTOGGLE-001 (:154), CHAT rulings (h2.87/h2.88)
  gotcha: READ-ONLY; DUMP-ONCE-001's "ctrl+s ENDS the session" record is HISTORY superseded by KEEP-OPEN-001 — never cite it as behavior

- file: spec/implementation-plan.md
  why: h2.56 file checklist — the FUTURE limitations wording ("memory-only drafts until local input recovery ships") owned by P3.M5.T1.S2
  gotcha: that flip is NOT this item's edit

- file: src/delivery.ts
  why: ground truth for D1 — buildSubmission emits header `Submitted {k} (state epoch {postEpoch})` FIRST, entryLines (one full line per changed answer, newlines → " / "), then reminder OR partialNudge, optional NOTE line last
  gotcha: "SUBMISSION_LIST_MAX_CHARS" appears in DELETION-DOCUMENTING comments — correct, not residue
```

### Current Codebase tree (relevant slice)

```bash
README.md                            # THE write target
spec/*.md                            # read-only ground truth
src/delivery.ts                      # delta shape ground truth (read-only here)
plan/006_45773b259b06/P2M1T1S1/research/conformance-matrix.md   # input
plan/006_45773b259b06/P2M1T1S2/research/readme-audit-findings.md # this item's audit
```

### Desired Codebase tree

Unchanged except `README.md` content (no new tracked files; research notes under this item's plan dir are allowed).

### Known Gotchas of our codebase & Library Quirks

```bash
# CRITICAL: do NOT "fix" correct prose — the verified-clean table is binding:
#   "notification appears as the panel exits" (FR-3(d): panel auto-suspends
#   after every real delivery; the INTERROGATION stays live — different thing).
#   "editor pins below the pane" in the keys.elaborate row (ui-spec DEEP-EDITOR-001
#   still stands; DEEP-FULLSCREEN-001 changed the pane's height budget, not this).
#   Widget line naming /interrogate only (chord deliberately un-named there).
# CRITICAL: the fence — AC-9 row + limitations drafts phrasing are INTENTIONAL
#   residue; the sweep pattern "'drafts not persisted' as a permanent limitation"
#   MATCHES them by design. Record the match, leave the bytes alone.
# CRITICAL: don't sync AC-9 to the spec's new wording ("editor recovery is
#   tested separately (FR-28)") — that's P3's flip, not this item's.
# Prose ellipses like "PARTIAL — {n} question(s) still unanswered (…)" and
# "✎ answer…" are quoting real UI strings — never edit them as "bare … claims".
# The bare-… ban (DEEP-FULLSCREEN-001) governs the deep-view RENDERER, not README prose.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: READ inputs
  - plan/006_45773b259b06/P2M1T1S1/research/conformance-matrix.md (bug → STOP)
  - plan/006_45773b259b06/P2M1T1S2/research/readme-audit-findings.md (the audit map)
  - README.md in full (622 lines; sections: Usage, Configuration, Keymap,
    Subcommands, Panel toggle, Side chat, Acceptance criteria, Limitations,
    Development, Project structure)

Task 2: FIX D1 — README Usage §3 (~:86-88)
  - REPLACE "Each submit streams a compact delta message to the
    model (rendered as a diff card in your transcript), ending with
    `(state epoch {n})` — the epoch the model must echo when upserting
    existing questions afterwards."
    WITH:
    "Each submit streams a delta message to the model — a header line
    `Submitted {n} (state epoch {e})`, ONE full untruncated line per changed
    answer (ANSWER-FIDELITY: no budget, rollup, or ellipsis exists on this
    path), then the closing reminder; an early partial submit swaps the
    reminder for the `PARTIAL` nudge above (KEEP-OPEN-002). The header's
    `(state epoch {e})` is the epoch the model must echo when upserting
    existing questions afterwards."
  - WHY: epoch rides the HEADER (first line; src/delivery.ts buildSubmission,
    post-bump epoch); the message ends with reminder/nudge (+ optional NOTE);
    "compact" resurrects the deleted budget era (FR-3(a) ANSWER-FIDELITY).
  - PRESERVE: the surrounding PARTIAL-nudge paragraph (:74-80, already correct)
    and the FULL-TRANSCRIPT-001 diff-card paragraph (:88-93, already correct).

Task 3: FIX D2 — README Acceptance summary AC-2 row (:399)
  - REPLACE "2. Partial `ctrl+s` → compact delta + reminder; epoch bumps;
    remainder stays open."
    WITH:
    "2. Partial `ctrl+s` → header + every changed answer in full + the
    reminder (an early submit swaps in the `PARTIAL` nudge — KEEP-OPEN-002;
    ANSWER-FIDELITY: never a capped/partial delta); epoch bumps; remainder
    stays open."
  - WHY: spec AC-2 is the ground truth ("header + both full answer lines +
    reminder (ANSWER-FIDELITY: never a capped/partial delta)"); the canonical
    AC-2 flow IS an early submit, so "+ reminder" is wrong — the nudge
    replaces it (KEEP-OPEN-002).

Task 4: SWEEP — section-by-section re-audit for anything missed
  - Run the grep recipe below; judge every hit against the verified-clean
    table; fix only genuine contradictions, each citing its ruling
  - Also re-read Usage §3/§4/§5, Side chat, Acceptance summary, Limitations
    end-to-end (prose drift doesn't always grep)
  - NEW finds beyond D1/D2 are expected to be zero; if you find one, cite the
    exact PRD string it contradicts in an inline ruling tag

Task 5: FENCE verification + final gates
  - AC-9 row and limitations drafts phrasing byte-identical (assertions below)
  - git diff --name-only → exactly README.md (+ untracked plan/006_*)
  - npm test / npm run typecheck / npm run lint — green, counts match S1 matrix
```

### The sweep recipe (README only)

```bash
# Delta-shape / budget residue (expect hits ONLY where already-correct prose
# quotes UI strings; D1/D2 must be gone after the fix):
grep -n "compact\|3-line\|three-line\|two lines\|~2\|rollup\|ellipsis\|capped\|budget\|+ *[0-9Nm] more" README.md
# Submit-ends-session residue (expect 0 genuine hits):
grep -n "submit.*complet\|complet.*submit\|dumps\|ends the session\|forced" README.md
# Epoch placement (after D1, only the header-line mention remains):
grep -n "state epoch" README.md
# Chat layout / parser / empty-reply (expect the already-landed passages):
grep -n "replaces\|fenced\|answer block\|empty reply" README.md
# The fenced-residue matches (do not touch): 
grep -n "drafts gone\|cross-restart draft\|Drafts are in-session" README.md
```

### Integration Points

```yaml
NO code, config, or spec/ changes — README.md prose only.
CONSUMERS:
  - P3.M5.T1.S2 (final docs flip): expects this item's README as its base —
    it flips the limitations row + AC-9 wording AFTER local input recovery ships
  - The plan's final delta gate: diff confined to README.md per item
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

N/A (Markdown prose; no lint target). Keep line-wrapping style of the file (~80-col soft wrap) and the surrounding paragraph voice.

### Level 2: Post-fix assertions (docs-equivalent of unit tests)

```bash
# D1 gone — no "compact delta", no end-position epoch claim:
! grep -n "compact delta" README.md
! grep -n "ending with" README.md
# Header-line epoch claim present:
grep -n "Submitted {n} (state epoch {e})" README.md
# D2 gone / replaced:
! grep -n "compact delta + reminder" README.md
grep -n "never a capped/partial delta" README.md   # ANSWER-FIDELITY cited
grep -n "KEEP-OPEN-002" README.md                  # ruling citations present
# FENCE intact — AC-9 row + limitations drafts phrasing untouched:
grep -n "drafts gone (documented)" README.md                 # still present
grep -n "cross-restart draft persistence (documented limitation)" README.md  # still present
grep -n "Drafts are in-session only" README.md               # still present
```

### Level 3: Diff hygiene + gates (system validation)

```bash
git diff --name-only            # → exactly README.md (plan/006_* untracked ok)
git diff README.md | head -80   # eyeball: only D1/D2(+sweep) hunks, minimal prose diffs
npm test                        # green; "Test Files"/"Tests" counts match S1 matrix
npm run typecheck               # zero errors
npm run lint                    # zero problems
# Expected: all green — docs-only change cannot move these; a count change means
# something else was touched: investigate before proceeding.
```

### Level 4: Consumer hand-off check

Re-read the fixed Usage §3 end-to-end: header→answer-lines→reminder/nudge order, epoch-in-header, "as the panel exits" retained, interrogation-stays-live intact — the paragraph must teach one coherent story with no internal contradiction between the pre-existing PARTIAL paragraph and the new delta sentence.

## Final Validation Checklist

### Technical Validation
- [ ] Level 2 assertions all pass (D1/D2 fixed, citations present, fence intact)
- [ ] `git diff --name-only` → exactly `README.md`
- [ ] `npm test`, `npm run typecheck`, `npm run lint` green with S1-matching counts
- [ ] Sweep recipe run; every hit judged; no new contradicting prose introduced

### Feature Validation
- [ ] README contains no claim contradicting: FR-3(a) delta shape, ANSWER-FIDELITY (no budgets), KEEP-OPEN-002 (nudge replaces reminder), KEEP-OPEN-001 (submit ≠ completion; panel exits per FR-3(d) but state stays live), FR-36/PANELTOGGLE-001 strings, FR-15 chat-view strings (CHAT-CONTEXT-001/CHAT-STYLE-001/LENIENT-ANSWER-001/EMPTY-REPLY-001), DEEP-FULLSCREEN-001 (no contrary deep-view claims)
- [ ] Both fixes cite their ruling tags inline (Mode B)
- [ ] Intentional residue byte-identical: AC-9 "drafts gone (documented)", limitations drafts phrasing

### Code Quality Validation
- [ ] Minimal-diff edits; no reflow/reformat of untouched lines; no "helpful completions" of absent descriptions
- [ ] P1's landed keymap/re-verification sections untouched
- [ ] Verified-clean table honored — no churn on correct prose ("as the panel exits", "editor pins below the pane", widget `/interrogate`-only line)

### Documentation & Deployment
- [ ] README's Usage §3 reads as one coherent story (delta shape ↔ PARTIAL nudge ↔ diff card ↔ epoch echo)
- [ ] No environment variables, config, or code touched

## Anti-Patterns to Avoid

- ❌ Don't touch the fence (AC-9 row, limitations drafts phrasing) — P3.M5.T1.S2 owns it; "found = leave alone".
- ❌ Don't reword correct prose the patterns happen to match — check the verified-clean table before editing (esp. "as the panel exits", PARTIAL nudge prose ellipsis "(…)", "✎ answer…", "spent its whole budget thinking").
- ❌ Don't cite DUMP-ONCE-001 as behavior — its forced-completion half is superseded by KEEP-OPEN-001 (its record is history).
- ❌ Don't "complete" README with new DEEP-FULLSCREEN-001 descriptions — the audit fixes contradictions, not absences.
- ❌ Don't sync AC-9 to the spec's FR-28 wording — that's P3's flip.
- ❌ Don't edit spec/, src/, scripts/, or anything outside README.md.
- ❌ Don't proceed if the S1 matrix reports a bug — alignment target unproven; report and stop.

---

**Confidence Score**: 9/10 — the audit is pre-run at this tree: both drift spots carry exact current text, prescribed replacements, and spec ground truth; the verified-clean and fence tables prevent the two realistic failure modes (churning correct prose, touching P3's residue); the only residual risk is an ungrepapble prose contradiction the end-to-end re-read in Task 4 must catch.

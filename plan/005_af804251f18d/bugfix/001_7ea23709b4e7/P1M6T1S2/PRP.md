name: "P1.M6.T1.S2 — spec/ui-spec.md: minimal alignment pass over §Side chat and §Overview"
description: Record the bugfix round's genuinely-new behavior in the spec: `e` targets the overview cursor row (BUG-004) and the transition-aware discard rule with its accepted same-status-reanswer edge (BUG-002). Two targeted edits + one verification sweep; zero speculative rewrites — every other fix already conforms to existing wording.

---

## Goal

**Feature Goal**: `spec/ui-spec.md` remains the accurate authority after bugfix round 001. Exactly the two places where fixed behavior is genuinely undocumented gain minimal clauses: (a) §Side chat View & entry (:112) + the hotkey-table `side chat` row — `e` in the overview targets the cursor row's question (BUG-004 fix shape from P1.M4.T2.S1); (b) §Side chat Singleton lifecycle (:113) — one parenthetical sentence recording that discard is transition-aware (non-terminal→terminal) and that same-status re-answers do not discard (P1.M2.T1.S1 accepted edge). Everything else verified compliant and left byte-untouched.

**Deliverable**: edits to `spec/ui-spec.md` only (lines ~:84, :112, :113), plus a verification pass over :115/:116/:118 and `spec/implementation-plan.md`'s risk table confirming no further edits are needed (findings recorded in the PR notes, not in the spec).

**Success Definition**: Each of the 7 fixed bugs maps to either "spec already said this — no edit" or "new clause added at the exact anchor"; no section rewritten that the code now merely complies with; `npm test`, `npm run typecheck`, `npx eslint .` all green (docs-only change proves nothing else moved).

## User Persona

**Target User**: Future implementers/maintainers reading spec/ui-spec.md as the behavioral authority for the side-chat surface.
**Use Case**: Someone re-implements or extends the panel and reads §Side chat + the hotkey table to learn what `e` does and when chats discard.
**User Journey**: read :112 → learns `e` opens on the current question, and in the overview on the cursor row; read :113 → learns chats discard on real answer/close transitions, not on unrelated mutations of an already-terminal question.
**Pain Points Addressed**: spec/implementation drift — the round's fixes moved code toward the spec everywhere except two genuinely new shapes the spec never stated.

## Why

- The spec is the AUTHORITY the fixes move the code TOWARD (test-infra-and-docs.md §spec map :77-88: "Spec edits this round: MINIMAL — the code moves toward the spec, not vice versa"). Most fixes need NO change.
- [Mode B] companion to P1.M6.T1.S1 (README sync, in flight, forbidden from spec/) — this is the spec half of the changeset-level docs sweep; no further doc tasks follow in this round.

## What

**Edit 1 — overview `e` targeting (BUG-004 / P1.M4.T2.S1)**, two anchors, same clause family:
- :112 (§Side chat "View & entry"): extend the `e` description so entry targeting is complete. After "opens the chat view from any non-editor focus", add a clause to the effect: `in the overview list it targets the cursor-row question (BUG-004 — currentId would be the background question the panel sat on before entering the list; an empty/invalid cursor is a consumed no-op)`.
- Hotkey table `side chat` row (~:84): change the context cell's "opens on the current question" to "opens on the current question (overview: the cursor row)" — matching the existing cursor-row convention wording in the :75-76 rows.

**Edit 2 — transition-aware discard (BUG-002 / P1.M2.T1.S1)**: :113 (§Side chat "Singleton lifecycle") currently reads "The chat DISCARDS when its question is answered or closed by ANY path (panel accept/write-in, side-chat apply, moot/withdraw/upsert close)". Append ONE parenthetical sentence recording the transition semantics and the accepted edge: discard fires only on a real non-terminal→terminal transition (a chat opened on an already-terminal question survives unrelated mutations); same-status re-answers (e.g. FR-18 ripple edits, answered→answered; moot→moot churn) do not discard — a side-chat apply on an already-terminal question instead consumes the confirm row and closes the view through the apply path (P1.M2.T2.S1).

**Explicitly NO edits** (verified compliant — do not touch):
- :115 Esc ladder — P1.M1.T2.S1 chose the routing shape (chat-view esc outranks ESC-002 editor forwarding while streaming), so "Streaming: first `esc` aborts" is now literally true in the default focused state.
- :116 Answer protocol — enter=apply / esc=decline now work when focused (P1.M1.T1.S1/S2); no-op terminal apply closing the view is covered by :113's "answered … by ANY path (side-chat apply)".
- :118 Usage & close — "any close/discard notifies compactly" is now actually true on replace (`e` on another question) and `/clear`·`/new` (P1.M3.T1.S1/P1.M3.T2.S1).
- BUG-006 (input preserved on refused send) — spec never claimed otherwise.
- §Overview body / §Empty/edge states / product-requirements / architecture.md — out of scope this round (reference-only per the spec map).

**Verification sweep (no edits expected)**: cross-check `spec/implementation-plan.md`'s risk table — the "esc aborts; singleton + one-shot snapshot cap the blast radius" row (BUG-005 context) still holds (abort-before-replace strengthens it); confirm no other row is invalidated by Edit 1/Edit 2. Record the sweep outcome (row-by-row, "still true") in the PR notes, NOT in the spec.

**Style contract**: match the spec's amendment idiom — dense em-dash bullets, parenthetical caveats, decision/bug tags for traceability (e.g. `(BUG-004 …)`), exactly as existing amendments are written (see :112's "renamed from keys.discuss — the focusText→elaborate precedent"). Do not renumber or reflow surrounding lines; keep edits to the minimal clause.

### Success Criteria

- [ ] :112 mentions overview cursor-row targeting with the BUG-004 tag and the empty-cursor no-op
- [ ] hotkey-table side-chat row context cell reads "…current question (overview: the cursor row)"
- [ ] :113 carries one appended sentence covering transition-aware discard + the same-status-reanswer non-discard edge + the P1.M2.T2.S1 apply-path close
- [ ] :114, :115, :116, :117, :118 byte-identical (only :112, :113, and the one table cell changed)
- [ ] No other spec file modified; implementation-plan.md read-only cross-check recorded in PR notes
- [ ] `npm test`, `npm run typecheck`, `npx eslint .` green (proves docs-only)

## All Needed Context

### Context Completeness Check

An implementer with zero context gets: exact line anchors, the landed fix shapes quoted (so the clause content is fully determined), the explicit no-edit list with reasons, the spec's amendment style idiom, and the project validation commands. ✅

### Documentation & References

```yaml
- file: spec/ui-spec.md
  why: THE deliverable — :84 (hotkey table side-chat row), :112 (View & entry), :113 (Singleton lifecycle); NO-EDIT anchors :114-118
  pattern: amendment idiom of :112 (em-dash clauses, precedent tags like "focusText→elaborate precedent"); cursor-row convention wording at :75-76
  gotcha: [Mode B] — surgical clause edits only; never reflow/renumber surrounding lines; the spec is authoritative, fixes already conform everywhere else

- docfile: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/architecture/test-infra-and-docs.md
  why: §spec map (:77-88) — the authority map this task implements; line-by-line spec anchors + "MINIMAL" mandate
  section: "### spec/ (authority documents)"

- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/P1M4T2S1/PRP.md
  why: the authoritative contract for Edit 1 — overviewSelectedQuestionId accessor + onChat dispatch (`view === "overview" ? cursor-row id : currentId`), empty-cursor consumed no-op
  critical: the clause must describe the LANDED shape exactly (cursor row via overview cursor; NOT currentId)

- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/P1M2T1S1/PRP.md
  why: the authoritative contract for Edit 2 — non-terminal→terminal gate, last-seen status tracking, and the "documented accepted edge" (same-status re-answers do not discard)
  critical: P1.M2.T2.S1 covers the apply flavor of that edge (consume + close) — the :113 sentence must name both halves

- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/P1M1T2S1/PRP.md
  why: proves the routing shape (not hint-honesty) was chosen → :115 needs NO edit
- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/P1M3T1S1/PRP.md (and P1M3T2S1, P1M2T2S1, P1M1T1S1/S2, P1M4T1S1, P1M5T1S1)
  why: the no-edit evidence — each fix's shape vs the existing spec wording at :115/:116/:118 and BUG-006/008
- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/P1M6T1S1/PRP.md
  why: sibling contract — README.md only, explicitly forbidden from spec/; no overlap, keep terminology consistent (spec is authority)
- file: spec/implementation-plan.md
  why: read-only risk-table cross-check (BUG-005 row); record findings in PR notes
- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/P1M6T1S2/research/notes.md
  why: per-bug edit/no-edit matrix with verified line anchors and quoted landed shapes
```

### Current Codebase tree (relevant excerpt)

```bash
spec/
  ui-spec.md               # :84, :112, :113 — the ONLY file edited
  implementation-plan.md   # risk table — read-only cross-check
  product-requirements.md  # reference only — NOT touched
src/                       # NOT touched (docs-only task)
```

### Desired Codebase tree with files to be added

```bash
# No new files. spec/ui-spec.md gains two minimal clauses; PR notes record the sweep.
```

### Known Gotchas of our codebase & Library Quirks

```text
# CRITICAL: [Mode B] docs-only — do NOT touch src/, README.md (sibling's), or
# product-requirements/architecture.md. spec/ui-spec.md is the only write target.
# CRITICAL: line numbers shift once you edit — read the anchors first, edit :112/:113
# and the table cell last-to-first or re-locate by quoted text (grep the exact
# opening phrases: "**View & entry.**", "**Singleton lifecycle (SIDECHAT-002).**",
# "| side chat | `e` |").
# CRITICAL: the spec previously DRIFTED once already this round's territory — resist
# the pull to "improve" :114-:118 while in there; every one was verified compliant.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: RESEARCH-VERIFY anchors in spec/ui-spec.md
  - READ :108-120 (§Side chat) and the §Hotkeys table row for `e`
  - LOCATE by quoted text (line numbers may have drifted since research):
    "**View & entry.**", "**Singleton lifecycle (SIDECHAT-002).**",
    "| side chat | `e` | `keys.chat`"
  - CONFIRM each NO-EDIT anchor still reads as the research notes quote
    (if drifted, re-derive the no-edit verdict from the cited subtask PRP)

Task 2: EDIT spec/ui-spec.md — Edit 1 (overview targeting, BUG-004)
  - :112 "View & entry": after "opens the chat view from any non-editor focus",
    insert the clause: "; in the overview list it targets the cursor-row
    question (BUG-004 — currentId is the background question the panel sat on
    before entering the list; an empty/invalid cursor is a consumed no-op)"
    — adapt punctuation to flow with the existing sentence, keep the tag
  - hotkey table row context cell: "opens on the current question" →
    "opens on the current question (overview: the cursor row)"

Task 3: EDIT spec/ui-spec.md — Edit 2 (transition-aware discard, BUG-002)
  - :113 "Singleton lifecycle": append ONE sentence after the DISCARDS sentence:
    "Discard is transition-aware (BUG-002): it fires only on a real
    non-terminal→terminal transition, so a chat opened on an already-answered
    question survives unrelated mutations, and same-status re-answers
    (FR-18 ripple edits, answered→answered; moot→moot churn) never discard —
    a side-chat apply on an already-terminal question instead consumes the
    confirm row and closes the view through the apply path."
  - NAMING/STYLE: em-dash parenthetical idiom, bug tag, no new bullet

Task 4: VERIFICATION sweep (record in PR notes, not the spec)
  - READ spec/implementation-plan.md risk table; for each row touching the
    side chat / esc / singleton: confirm the new clauses don't invalidate it
    (expected: none — abort-before-replace only strengthens the BUG-005 row)
  - WRITE findings to the PR notes (bug-by-bug matrix: fix → spec anchor →
    edited clause | no-edit rationale)
  - CHECK spec diff contains ONLY the three surgical changes:
    git diff --stat spec/ → ui-spec.md only; git diff spec/ui-spec.md shows
    no reflow of untouched lines

Task 5: VALIDATE docs-only
  - npm test && npm run typecheck && npx eslint .   # all green, proves no code moved
```

### Implementation Patterns & Key Details

```text
# Amendment idiom (copy from :112's own precedent clause):
#   " — <what changed> (<TAG> — <why/gotcha>)"
# Two clauses total this task: (BUG-004 …) and (BUG-002 …).
# NO-EDIT matrix (the task's negative scope — cite in PR notes):
#   BUG-001 focused gestures  → :116 already says enter=yes/esc=no     → no edit
#   BUG-001 streaming esc     → :115 already says first esc aborts      → no edit
#   BUG-003 no-op apply close → :113 "answered … by ANY path (apply)"   → no edit
#   BUG-005 abort-on-replace  → risk-table row still true; :118 silent  → no edit
#   BUG-006 input preserved   → spec made no contrary claim             → no edit
#   BUG-007 usage notices     → :118 "any close/discard notifies"       → no edit
#   BUG-008 reconstruction    → spec map: reference-only                → no edit
#   BUG-002 transition gate   → genuinely new semantics                 → Edit 2
#   BUG-004 overview targeting→ genuinely new semantics                 → Edit 1
```

### Integration Points

```yaml
SPEC:
  - file: spec/ui-spec.md (ONLY write target)
  - anchors: §Side chat :112, :113; §Hotkeys side-chat row (~:84)
DOCS SWEEP:
  - companion: P1.M6.T1.S1 (README.md) — already in flight; terminology must
    not contradict the new clauses (README is the mirror, spec is authority)
VALIDATION:
  - npm test / npm run typecheck / npx eslint . green (regression: docs-only)
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Markdown sanity — the table row must keep exactly 4 pipe cells
grep -n "| side chat |" spec/ui-spec.md   # row intact, cell text updated
npx eslint .                              # no stray code changes
```

### Level 2: Unit Tests (Component Validation)

```bash
npm test                # full suite — unchanged and green (docs-only proof)
npm run typecheck       # clean
```

### Level 3: Integration Testing (System Validation)

```bash
# The diff IS the integration check — surgical changes only
git diff --stat        # spec/ui-spec.md only
git diff spec/ui-spec.md   # exactly 3 hunks (table cell, :112, :113); no reflow
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Consistency read: open spec/ui-spec.md §Side chat end-to-end and verify the
# section now describes the shipped behavior with no internal contradictions
# (e.g. :112's cursor-row clause vs :75-76's "overview: cursor row" convention).
# Cross-read the sibling README's side-chat section once P1.M6.T1.S1 lands —
# no contradiction; spec wording wins on any drift.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm test`, `npm run typecheck`, `npx eslint .` all green
- [ ] `git diff --stat` shows spec/ui-spec.md only; diff is exactly 3 surgical hunks

### Feature Validation

- [ ] Edit 1 present at :112 + hotkey row (BUG-004, cursor-row targeting, empty-cursor no-op)
- [ ] Edit 2 present at :113 (transition-aware discard, same-status edge, apply-path close)
- [ ] :114-:118 and every other spec section byte-identical
- [ ] implementation-plan.md risk-table sweep recorded in PR notes (expected: no invalidation)
- [ ] Bug-by-bug no-edit matrix recorded in PR notes

### Code Quality Validation

- [ ] Spec amendment idiom followed (tags, em-dash parentheticals, no new bullets/renumbering)
- [ ] [Mode B] respected — spec/ui-spec.md is the only file written
- [ ] No speculative edits; nothing the code merely complies with was rewritten

## Anti-Patterns to Avoid

- ❌ Don't rewrite :114-:118 or any compliant section while "in there"
- ❌ Don't touch product-requirements.md / architecture.md / implementation-plan.md (read-only)
- ❌ Don't duplicate or contradict the sibling README task's wording work
- ❌ Don't reformat the hotkey table beyond the one context cell
- ❌ Don't record the verification sweep inside the spec — PR notes are its home

---

**Confidence Score**: 9/10 — the edit set is fully determined by quoted landed contracts (P1.M4.T2.S1, P1.M2.T1.S1) and a verified no-edit matrix; the only residual risk is line drift between research and execution, mitigated by locate-by-quoted-text instructions.

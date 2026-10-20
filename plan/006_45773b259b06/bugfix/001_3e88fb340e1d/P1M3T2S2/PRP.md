# PRP — P1.M3.T2.S2: README staleness sweep — truncation, auto-submit confirmation, SURFACE-002 wording (BUG-002/003/004)

---
name: "P1.M3.T2.S2 — README staleness sweep (bugfix changeset 001_3e88fb340e1d, minor fixes)"
description: "The Mode B changeset-level doc sync for the three MINOR fixes, final task of the changeset. BUG-003's fix changed the observable confirmation channel: the auto-submit `submitted — {n} answer(s)` string now arrives as a POST-SUSPEND NOTIFY (panel.notify, src/panel/actions.ts:1071-1077), not a footer flash — README :70 ('footer flashes') and the AC-2c row :359 must be updated to match. BUG-002 made the ✎ Other row width-truncate like every option row — the :85 'Nothing is truncated, capped, or hidden' sentence is about DIFF CARDS (different surface), expected no-op with rationale. BUG-004 was comment-only; README :367 (AC-9 'NO panel appears (SURFACE-002)') and :527 are expected already-correct — verify and record. Minimal-diff edits in existing voice; an explicit no-op decision with rationale is acceptable per section. README.md only; spec/ untouched; BUG-001 passages (:105/:367 fidelity clause, :384, :402) are P1.M3.T2.S1's parallel scope — do not collide."
---

## Goal

**Feature Goal**: README.md is consistent with the shipped behavior of BUG-002 (Other-row width truncation), BUG-003 (post-suspend notify confirmation), and BUG-004 (SURFACE-002 comment truth — no README impact expected). No passage names the footer flash as the auto-submit confirmation mechanism or describes width behavior the Other-row fix changed; SURFACE-002 wording verified current.

**Deliverable**: Edited `README.md` (expected: the two confirmation-channel spots, :70 and :359; everything else verified-as-is) + a sweep record at `plan/006_45773b259b06/bugfix/001_3e88fb340e1d/P1M3T2S2/research/readme-staleness-sweep.md` (passage | status verified-as-is/corrected old→new | BUG id | rationale — no-op decisions recorded explicitly).

**Success Definition**: Every listed row walked and recorded; the auto-submit confirmation is described as the notify (or duty-accurate phrasing) everywhere it appears; `grep -n "footer flashes" README.md` returns no auto-submit-context hits; `git diff --stat` shows README.md only; `npm test` + `npm run typecheck` green (proves no source edits); no collision with P1.M3.T2.S1's parallel README edits (check `git status`/`git log` before editing — both tasks edit README.md).

## Why

- BUG-003's fix (P1.M2.T2.S1) deliberately changed the user-visible channel: submit() suspends the panel first (FR-3d), so the confirmation fires as a post-suspend notify — README :70's "(`footer flashes `submitted — {n} answer(s)`)" now describes dead behavior, the exact "documents what the code does not deliver" failure class this repo treats as a defect.
- BUG-002 and BUG-004 are expected README-neutral (different surface / comment-only), but the sweep must PROVE that with recorded rationale rather than assume it — the dossier's README map flags :85 and :163 as "check" rows precisely because "truncated" wording is ambiguous across surfaces.
- Mode B: this subtask IS the changeset-level doc sync for the minor fixes; nothing follows it in the changeset.

## What

### Sweep rows (verified current text at research time — navigate by QUOTE, not line)

**Row 1 — Usage auto-submit paragraph (:70) — BUG-003 — THE EXPECTED EDIT**
Current: "ships the submission for you (`footer flashes `submitted — {n} answer(s)`), and an edit made while the set is already complete ships immediately too…"
The confirmation is now a **post-suspend notify** (the panel exits after submitting, FR-3d; the notify appears after the editor restores). Rewrite the parenthetical minimally, e.g. "(a `submitted — {n} answer(s)` notification appears as the panel exits)". Keep the verbatim string `submitted — {n} answer(s)` — it is the literal UI copy (src/panel/actions.ts:1075). Also read the two sentences around it: the paragraph's other claims (gate hold ⚠ line, `ctrl+s` override, delta/epoch, diff card as durable record) are unchanged by all three fixes — verify, don't touch.

**Row 2 — AC-2c acceptance row (:359) — BUG-003 — THE SECOND EXPECTED EDIT**
Current: "2c. **Auto-submit (AUTOSUBMIT-001)**: answering the LAST question ships with no keypress beyond the answer (`submitted — {n} answer(s)`); editing while complete ships the edit immediately."
The parenthetical names the string without naming the channel — arguably already channel-silent. DECISION RULE: if you edited Row 1 to say "notification", add the same word here ONLY if it fits the terse AC voice ("(`submitted — {n} answer(s)` notification)"); otherwise record no-op with the rationale "AC line is channel-silent; the Usage paragraph carries the mechanism". One word max.

**Row 3 — Diff-card sentence (:85) — BUG-002 — EXPECTED NO-OP, RECORD RATIONALE**
Current: "Nothing is truncated, capped, or hidden behind the transcript's expand toggle — so you can always scroll back and read exactly what you said."
This sentence is about the FULL-TRANSCRIPT-001 DIFF CARD surface, not the panel. BUG-002's fix truncates the ✎ Other ROW label in the PANEL at narrow terminal widths — a different surface; the panel's own option labels always truncated (ui-spec terminal-fallback table). No contradiction. NO-OP with that rationale. If on re-reading you judge the sentence could be misread as covering panel rendering, add at most a "in the diff card" scoping phrase — otherwise leave.

**Row 4 — CAPS-OUT-001 claim (:139 region + config comment quote :163) — BUG-002 — EXPECTED NO-OP, RECORD RATIONALE**
:139 "through verbatim (CAPS-OUT-001)" and :163 "// unlimited — nothing is truncated or dropped (CAPS-OUT-001)." — both about ANSWER CONTENT limits (the deleted caps engine), not terminal width. Terminal-width truncation of display lines was ALWAYS the behavior (ui-spec: "option labels truncate with …"). NO-OP; record the content-vs-display distinction as the rationale. Do not weaken the CAPS-OUT-001 claims.

**Row 5 — AC-9 (:367) — BUG-004 (and S1's BUG-001 clause) — VERIFY ONLY**
Current: "9. Restart pi mid-interrogation → NO panel appears (SURFACE-002); the widget line shows live counts; `/interrogate` reopens restored state; drafts gone (documented); pending answers ship on the next commit or submit (AUTOSUBMIT-001)."
BUG-004 fixed only a src/index.ts comment — the README never claimed auto-open. EXPECTED: already correct; record verified-as-is. **DO NOT edit this line's restart content** — P1.M3.T2.S1 (parallel) may add its fidelity clause to "restored state"; a collision here breaks both tasks. Your verdict on this row is a READ, not a write.

**Row 6 — Project-structure reconstruct line (:527) — BUG-004 — VERIFY ONLY**
Current: "# suspend-widget cue, SURFACE-002 — NEVER opens the panel)" — already states the SURFACE-002 truth. Verified-as-is; no edit.

### Rules

- Minimal-diff edits in existing README voice (em-dash asides, backticked UI strings, `{submit}`-style placeholders preserved).
- The verbatim UI string `submitted — {n} answer(s)` (em-dash, "answer(s)") must survive any edit — it is literal copy.
- No implementation internals (panel.notify, FR-3d, suspend ordering) in user docs — describe the observable: the notification appears as the panel exits.
- No-op-with-rationale is the EXPECTED outcome for rows 3, 4, 5, 6; forced rewrites are a defect.
- README.md only. spec/ untouched. Do not touch S1's passages (:105-107 restart paragraph body, :384 drafts row, :402 compaction row) except the READ on :367.

### Success Criteria

- [ ] All six rows recorded (verified-as-is / corrected old→new) in research/readme-staleness-sweep.md.
- [ ] `grep -n "footer flashes" README.md` — no auto-submit-context hit remains (any other-context "flashes" hits judgment-checked, e.g. gate-hold/footer-counter language).
- [ ] The string `submitted — {n} answer(s)` still present verbatim wherever the confirmation is described.
- [ ] CAPS-OUT-001 claims (:139/:163) intact; :85 diff-card sentence unchanged (or scoped minimally).
- [ ] :367/:527 read-verified, not edited; no git collision with P1.M3.T2.S1 (check status before/after).
- [ ] `git diff --stat`: README.md only; `npm test` + `npm run typecheck` green.

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the current passage texts (quoted), the fixed behavior per bug (esp. BUG-003's channel change with code anchors), the content-vs-display truncation distinction, the parallel-task boundary, and the no-op rule. Fully contained below.

### Documentation & References

```yaml
- file: plan/006_45773b259b06/bugfix/001_3e88fb340e1d/architecture/bug004-surface002-comment.md
  why: §"README changeset-doc map" (:53-60) — the row map this sweep follows; BUG-004's README verdict (already correct)
- file: plan/006_45773b259b06/bugfix/001_3e88fb340e1d/architecture/bug002-003-panel-render-flash.md
  why: BUG-002 fix (otherLine → truncateVisible, same budget math as optionLine) and BUG-003 fix (post-suspend notify with verbatim string) — the shipped semantics each row must match
- file: src/panel/actions.ts
  why: :1071-1077 — the landed notify channel (comment cites BUG-003; panel.notify fires after submit()'s suspend); :988/:1075 — the verbatim flash/confirmation string contract. Read-only ground truth
- file: src/panel/panel.ts
  why: :922 region — the host notify seam JSDoc (the post-suspend observability rationale)
- file: plan/006_45773b259b06/bugfix/001_3e88fb340e1d/P1M3T2S1/PRP.md
  why: CONTRACT (parallel) — S1 edits README's restart passages (:105/:367-fidelity/:384/:402/:526-region); coordinate via git status; your :367 row is read-only
- file: plan/006_45773b259b06/bugfix/001_3e88fb340e1d/prd_snapshot.md
  why: h2.3/h3.1-h3.3 — each bug's OLD behavior (what stale wording would look like); h2.5 recommendations = landed fix semantics
- file: README.md
  why: THE artifact — rows quoted in What; research-time line numbers may shift (parallel tasks) — navigate by quote
```

### Current Codebase tree (relevant excerpt)

```bash
README.md   # THE artifact (edit only; S1 edits it too — coordinate)
spec/       # read-only
plan/006_45773b259b06/bugfix/001_3e88fb340e1d/P1M3T2S2/research/readme-staleness-sweep.md   # CREATE
```

### Known Gotchas of our codebase & Library Quirks

```bash
# BOTH M3.T2 subtasks edit README.md in parallel — run `git status` and
# `git log --oneline -3` before editing; if S1's edits are already staged,
# edit around them (your rows and its rows are disjoint except :367, which
# you only READ).
# The confirmation string uses an EM-DASH: `submitted — {n} answer(s)` —
# preserve it byte-for-byte in any rewrite.
# "footer flashes" may legitimately survive in OTHER contexts (e.g. the
# zero-pending `nothing to submit` flash, gate-hold language) — the grep
# gate is about the AUTO-SUBMIT confirmation context only.
# Don't conflate surfaces: diff-card fullness (:85, FULL-TRANSCRIPT-001),
# answer-content limits (:139/:163, CAPS-OUT-001), and panel display-width
# truncation (ui-spec terminal fallbacks) are three different guarantees;
# BUG-002 touched only the third.
# Line anchors are research-time — the parallel gate task (P1.M3.T1.S1)
# and S1 shift them.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: READ — the six rows by quoted text; actions.ts:1071-1077 (notify channel landed); bug002-003 dossier; git status (S1 collision check)
Task 2: EDIT Row 1 (:70 parenthetical) — "footer flashes" → post-exit notification phrasing, string verbatim
Task 3: DECIDE Row 2 (:359 AC-2c) — one-word "notification" if it fits AC voice, else no-op with rationale
Task 4: VERIFY rows 3/4 (:85, :139/:163) — content-vs-display distinction; no-op rationale recorded
Task 5: READ-VERIFY rows 5/6 (:367, :527) — SURFACE-002 already correct; record; do not edit
Task 6: WRITE research/readme-staleness-sweep.md — per-row status/old→new/BUG id/rationale
Task 7: GATE — greps; npm test && npm run typecheck; git diff --stat (README.md only, S1's disjoint rows respected)
```

### Implementation Patterns & Key Details

```markdown
<!-- Row 1 expected edit (minimal, voice-preserving): -->
<!-- OLD: "ships the submission for you (footer flashes `submitted — {n} answer(s)`)," -->
<!-- NEW: "ships the submission for you (a `submitted — {n} answer(s)` notification -->
<!--      appears as the panel exits)," -->
<!-- Row 2 optional: "(a `submitted — {n} answer(s)` notification)" — only if terse. -->
```

### Integration Points

```yaml
EDIT: README.md only (rows :70, :359 expected; others verified)
CREATE: plan/006_45773b259b06/bugfix/001_3e88fb340e1d/P1M3T2S2/research/readme-staleness-sweep.md
CONSUMED: landed P1.M2.T1/T2/T3 fixes (verify against src before claiming); P1.M3.T1.S1 gate record (context only)
DO NOT TOUCH: spec/, src/, S1's restart passages (:105-107, :384, :402, :526 region), :367 beyond reading
FOLLOWED BY: nothing — closes the changeset's doc sync (with S1)
```

## Validation Loop

### Level 1: Artifact integrity

```bash
git diff --stat    # README.md only; diff hunks confined to rows 1-2 (+any S1 hunks, disjoint)
```

### Level 2: No collateral damage

```bash
npm test && npm run typecheck    # green — zero source edits
```

### Level 3: Read-back gates

```bash
grep -n "footer flashes" README.md                # no auto-submit-context hit (other contexts judgment-checked)
grep -n "submitted — {n} answer(s)" README.md     # string verbatim wherever the confirmation appears
grep -n "CAPS-OUT-001" README.md                  # claims intact (:139/:163 unchanged)
grep -n "SURFACE-002" README.md                   # :367/:527 still state never-opens
grep -n "notification" README.md                  # the new channel word present in row 1
```

### Level 4: Not applicable — pure documentation task (AUTOMATION-POLICY: no live session).

## Final Validation Checklist

- [ ] Six rows walked; sweep record written with explicit no-op rationales for rows 3-6
- [ ] Auto-submit confirmation described as notification (row 1 edited; row 2 decided); verbatim string preserved
- [ ] CAPS-OUT-001 and diff-card claims untouched; SURFACE-002 wording verified current
- [ ] No collision with S1 (git status checked; :367 read-only)
- [ ] README voice/placeholders preserved; no implementation internals in prose
- [ ] `git diff --stat`: README.md only; `npm test` + `npm run typecheck` green

## Anti-Patterns to Avoid

- ❌ Don't force rewrites on already-correct rows — the no-op-with-rationale is the expected outcome for 4 of 6 rows
- ❌ Don't alter the verbatim `submitted — {n} answer(s)` copy (em-dash included)
- ❌ Don't conflate diff-card fullness, answer-content limits, and panel width truncation — three surfaces, three guarantees
- ❌ Don't edit :367 or S1's passages — read/verify only
- ❌ Don't mention panel.notify/FR-3d/suspend ordering internals in user prose
- ❌ Don't trust line anchors — navigate by quoted text; check git status for the parallel sweep

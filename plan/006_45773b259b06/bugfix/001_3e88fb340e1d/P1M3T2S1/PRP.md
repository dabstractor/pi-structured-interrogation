# PRP — P1.M3.T2.S1: README restart/reconstruction sections — restored replay fidelity (BUG-001)

---
name: "P1.M3.T2.S1 — README restart/reconstruction sections: restored replay fidelity"
description: "The Mode B changeset-level doc sync for BUG-001 (bugfix changeset 001_3e88fb340e1d): sweep README.md's restart/reconstruction passages — Usage :105-107, AC-9 (:367), Limitations drafts row (:383-385) and compaction row (:400-404) — for any statement implying restart replay is value-only or loses elaborations/write-ins, and update to state that replayed answers keep elaborations (answer.text) and ✎ write-in markers (answer.custom). Verified current text: NO passage claims value-only replay — the fidelity is simply UNSTATED, so the expected edit is one small additive clause (likely the Limitations drafts row or AC-9); if every sentence is already accurate at the fidelity level users see, record the explicit no-op decision instead of forcing a rewrite. Minimal edits, README voice, no implementation internals (DiffEntry) in user docs. README.md only; spec/ untouched. Gate: npm test + npm run typecheck green; git diff shows README.md only (this task must not collide with the parallel P1.M3.T2.S2 staleness sweep — coordinate via git status if both land together)."
---

## Goal

**Feature Goal**: README.md's restart/reconstruction prose is consistent with the landed BUG-001 fix (submission deltas carry `answer.text`/`answer.custom`; `replaySubmission` restores them), so no passage implies restart replay degrades to value-only or silently drops elaborations/write-ins.

**Deliverable**: Edited (or verified-current, explicitly recorded) `README.md` passages + a sweep record at `plan/006_45773b259b06/bugfix/001_3e88fb340e1d/P1M3T2S1/research/readme-sweep.md`.

**Success Definition**: All candidate passages walked and recorded (verified-as-is or corrected); the restart story states elaborations and ✎ write-in answers survive reconstruction; `git diff --stat` shows README.md only; `npm test` + `npm run typecheck` green.

## Why

- BUG-001 (PRD h2.2/h3.0): before the fix, replayed answers lost `answer.text` and `answer.custom` when the debounced mirror missed the flush window — the README never *claimed* that loss, so this sweep is verification + one small additive clause, not a correction of false claims.
- Mode B: this subtask IS the changeset-level doc sync for BUG-001; spec/ is read-only and per-file docs rode with P1.M1.T1.

## What

### Candidate passages (current text verified in tree — navigate by QUOTE, not line)

1. **Usage :105-107** — "A session restart/resume never opens it either: after a restart the suspend widget line (live counts, `/interrogate`) is the only cue — run `/interrogate` and the restored questions and answers come right back." — accurate, fidelity-silent. OPTIONAL: extend "restored questions and answers" → "restored questions and answers — elaborations and ✎ write-in answers included" if it reads naturally; otherwise leave.
2. **AC-9 (:367)** — "Restart pi mid-interrogation → NO panel appears (SURFACE-002); the widget line shows live counts; `/interrogate` reopens restored state; drafts gone (documented); pending answers ship on the next commit or submit (AUTOSUBMIT-001)." — "restored state" is fidelity-silent but AC lines are terse; a clause like "restored state (answers with their elaborations and ✎ write-ins)" fits the line's parenthetical style. One clause max.
3. **Limitations drafts row (:383-385)** — "…restarting pi mid-interrogation restores questions and submitted answers with their exact values — never in-progress drafts." — THE most natural home: "with their exact values" is where a value-only reading could attach. Extend to "…restores questions and submitted answers with their exact values — elaborations and ✎ write-in answers included — never in-progress drafts." This is the EXPECTED edit (one clause).
4. **Limitations compaction row (:400-404)** — "…state reconstructs afterwards from the append-only `interrogation-state` mirror. Reconstruction pools every state-carrying `interrogate` tool result, newest-first — if the newest one fails to deserialize, it degrades to the next-older valid result…" — describes candidate pooling, not answer fidelity. No edit needed for BUG-001 (its "degrade" refers to candidate selection, not answer shape). Verify only.
5. **Project structure (:526)** — the reconstruct.ts comment line ("state reconstruction: session start (silent install + …)"). Check the trailing description doesn't say "value-only replay"; if it's neutral, leave it.

### Rules

- **No-op is a legitimate outcome**: if you judge every sentence already accurate at the fidelity level users see (e.g. you add the single clause in passage 3 and nothing else), record exactly that decision — do NOT force rewrites.
- Minimal edits: one clause per passage at most; keep README voice (em-dash asides, parenthetical style); do NOT mention DiffEntry, replaySubmission, mirror debounce windows, or any implementation internals.
- README.md ONLY — spec/ untouched; BUG-002/003/004 staleness (:85, :163, :359-360 truncation/auto-submit/SURFACE-002 wording) is P1.M3.T2.S2's scope — do NOT touch those.

### Success Criteria

- [ ] All five candidate passages recorded as verified-as-is or corrected (old→new) in the sweep record.
- [ ] At least the drafts-row clause (or an equivalent single clause elsewhere) states elaborations + ✎ write-ins survive restart.
- [ ] No implementation internals; README voice preserved; BUG-002/003/004 passages untouched.
- [ ] `git diff --stat`: README.md only; `npm test` + `npm run typecheck` green.

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the current passage texts (quoted), the fixed behavior, the no-op rule, and the boundary vs. the parallel S2 sweep. Fully contained here.

### Documentation & References

```yaml
- file: plan/006_45773b259b06/bugfix/001_3e88fb340e1d/architecture/bug004-surface002-comment.md
  why: §"README changeset-doc map" (:53-60) — the candidate-section map this sweep follows (restart/reconstruction :105/:367/:384/:402-404/:526 = BUG-001 rows; :85/:163/:359-360 belong to S2's bugs)
- file: plan/006_45773b259b06/bugfix/001_3e88fb340e1d/prd_snapshot.md
  why: h2.2/h3.0 BUG-001 — the fixed behavior (replay restores answer.text + answer.custom); h2.5 recommendation 1 = the landed fix
- file: plan/006_45773b259b06/bugfix/001_3e88fb340e1d/architecture/bug001-submission-replay.md
  why: the BUG-001 dossier — user-visible consequences (read-surface elaboration lines, ✎ markers, answer pinning, completion record) = the fidelity vocabulary to use in prose
- file: src/reconstruct.ts
  why: read-only cross-check — replaySubmission now applies text/custom with legacy guards (P1.M1.T1.S4); confirm before claiming fidelity
- file: README.md
  why: THE artifact — current texts quoted in What §passages; line numbers are research-time, navigate by quote
```

### Current Codebase tree (relevant excerpt)

```bash
README.md   # THE artifact (edit only)
spec/       # read-only — untouched
plan/006_45773b259b06/bugfix/001_3e88fb340e1d/P1M3T2S1/research/readme-sweep.md   # CREATE
```

### Known Gotchas

```bash
# Line anchors are research-time; the parallel P1.M3.T1.S1 gate and
# P1.M3.T2.S2 sweep may shift them — navigate by QUOTED TEXT, and check
# `git status`/`git log` for S2 collisions before editing.
# The compaction row's "degrades to the next-older valid result" is about
# CANDIDATE POOLING, not answer fidelity — do not "fix" it.
# Do not restate the 2s-mirror hard-kill window — that's an internal;
# the user-facing truth is simply "restored answers keep elaborations and
# write-ins".
# npm test baseline ~1624+ tests; green run proves no accidental source edits.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: READ — the five passages (by quote); reconstruct.ts replay fidelity (confirm landed); bug001 dossier's user-visible consequence list
Task 2: DECIDE per passage — verified-as-is (record why) or one-clause edit (record old→new)
Task 3: EDIT — expected: the Limitations drafts-row clause; optionally AC-9's parenthetical
Task 4: WRITE research/readme-sweep.md (passage | status | old→new | rationale)
Task 5: GATE — git diff --stat (README.md only); npm test && npm run typecheck; grep read-backs below
```

### Implementation Patterns & Key Details

```markdown
<!-- Expected edit (passage 3, one clause): -->
<!-- OLD: "restarting pi mid-interrogation restores questions and
     submitted answers with their exact values — never in-progress drafts." -->
<!-- NEW: "restarting pi mid-interrogation restores questions and
     submitted answers with their exact values — elaborations and ✎
     write-in answers included — never in-progress drafts." -->
```

### Integration Points

```yaml
EDIT: README.md only
CREATE: research/readme-sweep.md
CONSUMED: landed BUG-001 fix (P1.M1.T1.S2-S5) — verify before claiming
DO NOT TOUCH: spec/, src/, BUG-002/003/004 passages (:85, :163, :359-360 — S2's)
```

## Validation Loop

### Level 1: Artifact integrity

```bash
git diff --stat     # README.md only
```

### Level 2: No collateral damage

```bash
npm test && npm run typecheck    # green — zero source edits
```

### Level 3: Read-back spot checks

```bash
grep -n "elaborations and ✎" README.md     # the new clause present
grep -n "exact values" README.md            # drafts row reads coherently
grep -n "value-only\|DiffEntry\|replaySubmission\|2s\|debounce" README.md   # empty — no internals
```

### Level 4: Not applicable — pure docs task.

## Final Validation Checklist

- [ ] All five passages walked; sweep record written with explicit no-op decisions where applicable
- [ ] Fidelity clause present in ≥1 restart passage (drafts row expected)
- [ ] No internals in user docs; README voice preserved
- [ ] BUG-002/003/004 passages (:85, :163, :359-360) untouched — S2's scope
- [ ] `git diff --stat`: README.md only; `npm test` + `npm run typecheck` green

## Anti-Patterns to Avoid

- ❌ Don't force a rewrite when a clause suffices — explicit no-op decisions are valid outcomes
- ❌ Don't document internals (DiffEntry, replaySubmission, mirror debounce, candidate pooling)
- ❌ Don't touch the compaction row's "degrade" sentence (candidate-pooling semantics, not answer fidelity)
- ❌ Don't stray into S2's truncation/auto-submit/SURFACE-002 passages
- ❌ Don't trust line anchors — navigate by quoted text

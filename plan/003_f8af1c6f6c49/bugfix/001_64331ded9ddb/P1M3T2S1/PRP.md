# PRP — P1.M3.T2.S1: README.md changeset sweep — re-ask loop, closed-edit confirm, moot reasons, epoch echo

---
name: "P1.M3.T2.S1 — README.md changeset sweep"
description: "The Mode B changeset-level docs task for bugfix wave 001_64331ded9ddb. Update README.md ONLY where the wave changed user-visible behavior: (a) Usage re-ask confirmation semantics — same-value enter/digit/write-in on a re-asked question re-confirms and ships (rule-1); a same-value re-answer after a changed-options re-ask delivers (rule-2); 'nothing to submit' is now reserved for genuinely zero-pending submits; (b) Usage/FR-18 area — editing an archived (closed) answer raises the same invalidation confirm as live edits (mirrors AC-16's live-edit language); (c) moot rendering — panel views now show the real `moot: {dep}={value}` reason; (d) epoch guidance near :98/:107 — a new interrogation after completion accepts the previous epoch on its first upsert (no spurious STALE). Mirror affected AC lines (2/2c/3/6/13/16 contexts). Keep the README's voice/format; no internals; no spec/ rewrites (per-file Mode A docs + decisions.md pins already rode with each subtask). Final gate: npm test + npm run typecheck green."
---

## Goal

**Feature Goal**: README.md is consistent with the shipped behavior of the five-bug changeset (re-ask confirmation loop BUG-001/BUG-002, closed-edit FR-18 confirm BUG-003, real moot reasons BUG-004, epoch-echo exemption BUG-005). Every behavior claim touched by the wave states the fixed semantics; no passage documents the wedges/friction the fixes removed.

**Deliverable**: Edited `README.md` (Usage §2/§3/Model-behavior-note, Acceptance-criteria mirrors where affected, Limitations if any entry is now stale) + a sweep record at `plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/P1M3T2S1/research/readme-sweep.md` (passage | status | old→new | BUG id).

**Success Definition**: All four doc-sync areas walked and recorded; the decisions.md pins appended by the implementing subtasks exist in `spec/decisions.md` and are consistent with README wording (flag gaps — do not rewrite spec/); `git diff --stat` shows README.md only (plus research note); `npm run typecheck` + `npm test` green (proves zero source edits).

## Why

- The wave's headline bugs are user-invisible wedges (spec-contracts.md: "re-ask wedge currently user-invisible") — the README never documented the buggy behavior, so most edits are **additive clarifications** of semantics the README implied but couldn't honestly promise before (re-confirm gestures, truthful delivery after re-answers, moot reason rendering, epoch-echo tolerance).
- Mode B discipline: per-file docs (Mode A docblocks/comments) and the decisions.md pins already rode with each subtask; this task is the single changeset-level README pass — "README.md (and nothing else)".

## What

### The four doc-sync areas (semantics each passage must state)

**(a) Re-ask confirmation — Usage §2/§3 (README ~:55-70) and Model-behavior note (~:98-104); AC-2c/AC-3 mirrors (~:267, :271)**

Fixed semantics (source: P1.M1.T1/T2 PRPs + decisions.md pins):
1. **Rule-1 re-ask (same options)**: re-visiting a re-asked question and pressing `enter`/digit on the SAME value (or committing a byte-identical write-in) is a **re-confirmation**, not a no-op — the question re-marks `reasked → answered`, the answer ships with the next commit. Note the interaction with AC-16's "zero-state-change advance" language (README :281 region): that ANSWER-PIN-001 rule now has an explicit **exception for `reasked`** — same-value on an ANSWERED question is still an inert advance; on a RE-ASKED question it re-confirms. If AC-16's summary line doesn't carry the exception, add a clause ("…except on a re-asked question, where same-value enter re-confirms and ships").
2. **Rule-2 re-ask (changed options)**: re-answering with the same value after the agent changed the options records the answer AND it **delivers** — pending (answered) ids ship even when the answer-signature diff is empty (D-R6 panel parity). Consequence for §3: the "nothing to submit" / zero-pending early return is now reserved for submits with **genuinely no pending answers**; a re-asked-then-re-answered question never strands.
3. AC-3's mirror ("Agent reply closes answered questions / re-asks preserve drafts") can gain "…and a re-asked question re-confirms on a same-value enter" if space allows — keep it one line.

**(b) Closed-edit invalidation confirm — Usage §2 ripple-confirm sentence (~:55) and AC-7/AC-13 mirrors (~:275, :280)**

Fixed semantics (P1.M2.T1): editing an answer to a **closed/archived** question now raises the same FR-18 invalidation confirm as live edits (acceptOptionIndex/digit, writeInEnter, and elaboration stageText gates all include closed). README :55's "confirm when it would moot dependent questions" is accurate but scope-silent — extend the sentence (or AC-13's line) to make clear the confirm applies to **any edited question with a recorded answer, including archived ones** (matching AC-16's "a DIFFERENT choice raises the FR-18 invalidation confirm"). One clause; do not document seam internals.

**(c) Real moot reasons — AC-6 mirror (~:274) and the Usage moot mention if any**

Fixed semantics (P1.M2.T2): panel views (short view, overview, layout markers) now render the dependency-derived reason in the `moot: {dep}={value}` format instead of a generic substitute. AC-6 currently says "dependent greys as moot instantly; overview shows ⊘" — extend with "…with the real reason (`moot: {dep}={value}`)". This is the only touch; there is no Usage-level moot passage to fix (verified: moot appears at :274/:301, the latter being the ignored-answers report — correct as-is).

**(d) Epoch echo on completed-swap — Model-behavior note (~:98, :107) and AC-8 context (~:276)**

Fixed semantics (P1.M3.T1.S1 — the parallel item, treat its PRP as contract): an upsert after completion starts a fresh interrogation (epoch restarts at 1) and the **first upsert of that fresh interrogation accepts any epoch value** — an honest echo of the previous interrogation's epoch no longer pays a spurious STALE round trip. README :107 already says "an upsert sent after completion starts a fresh interrogation (the epoch restarts at 1) that completes normally" — extend with "(the first upsert of the fresh interrogation may echo the previous epoch — it's accepted)" or equivalent. README :98's "epoch-guarded — upserts touching existing ids must echo the current epoch" stays true (the exemption applies only to the all-new-ids first upsert against a freshly swapped state). Do not weaken :98.

### Rules

- **Update ONLY user-visible behavior claims** — no internals (no pendingIds-keyed fall-through, no seam gate names, no fixture talk).
- **Keep voice/format**: second-person Usage walkthrough, backticked key names, `{submit}`-style placeholders for remappable keys, one-line AC summaries.
- **Verify decisions.md pins exist** (read `spec/decisions.md`): D-R6 panel-parity pin (P1.M1.T1.S1), ANSWER-PIN-001 reasked-exception pin (P1.M1.T2.S1), FR-18 closed-edit pin (P1.M2.T1), moot-reason pin (P1.M2.T2), epoch-exemption pin (P1.M3.T1.S1 — parallel; check at implementation time). If a pin is MISSING, flag it in the sweep record — do NOT write it yourself (spec/ is not this task's edit surface; per-file docs rode with each subtask).
- **Audit Limitations (:286+)** for entries invalidated by the wave (e.g. anything implying re-asked questions can strand or epoch echoes get rejected after completion). Verified candidates: none of the current Limitations bullets claim the wedges — but re-read at implementation time; remove/adjust only what the fixes changed.

### Success Criteria

- [ ] All four areas walked; sweep record written with old→new per edit and BUG ids (BUG-001/002 → a, BUG-003 → b, BUG-004 → c, BUG-005 → d).
- [ ] AC-16 line carries (or is consistent with) the reasked same-value exception.
- [ ] AC-6 line mentions the real `moot: {dep}={value}` reason.
- [ ] AC-13/ripple sentence covers archived edits.
- [ ] :107 passage covers the epoch-echo acceptance on the fresh interrogation's first upsert; :98 unchanged in strength.
- [ ] No internals documented; README voice/format preserved.
- [ ] decisions.md pins verified present; gaps flagged (not written).
- [ ] `git diff --stat`: README.md only; `npm test` + `npm run typecheck` green.

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the README section map with anchors, the exact fixed semantics per bug (with decisions.md pins as wording source of truth), the parallel P1.M3.T1.S1 contract for the epoch fix, and the no-spec-edits rule. All below.

### Documentation & References

```yaml
- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/architecture/spec-contracts.md
  why: §15 (:93-96) — README section map + doc-sync touch points (Usage :30 with auto-submit/gate-hold/epoch guidance :60-69/:98/:107, re-asks :78-80; AC :258 mirrors :266-281; Limitations :286)
  critical: line anchors are from HEAD at research time — navigate by quoted text, lines may have drifted

- file: README.md
  why: THE artifact. Read fully (~432 lines) once, then edit by area. Current relevant text verified: :55-57 ripple-confirm sentence; :60-69 submitting/auto-submit paragraph; :98 epoch-guarded; :104-107 re-ask + completed-swap passages; :267 AC-2c; :271 AC-3; :274 AC-6; :275 AC-7; :276 AC-8; :280 AC-13; :281 AC-16; :286+ Limitations

- file: spec/decisions.md
  why: the implementing subtasks' pins are the WORDING SOURCE OF TRUTH — read the D-R6 panel-parity pin, the ANSWER-PIN-001 reasked-exception amendment, the FR-18 closed-edit pin, the moot-reason pin, and (once landed) the epoch-exemption pin. Verify they exist; flag gaps

- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/prd_snapshot.md
  why: h2.5 Recommendations = the fixed semantics; h2.0 Overview names the re-ask wedges as the release blockers (context for wording urgency, not content)

- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/P1M3T1S1/PRP.md
  why: CONTRACT for the parallel epoch-exemption fix (guards.ts fresh-receiver + all-new-ids exemption) — the exact semantics for area (d)
  gotcha: it is landing in parallel; if the tree lacks it, that area's edit still describes the contracted behavior — verify with its tests

- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/P1M1T1S1/PRP.md (+ P1M1T2.S1/.S2, P1M2T1.S1/.S2 PRPs)
  why: the exact fixed semantics + user-visible surface for areas (a) and (b)/(c) — read each subtask's "What/Success Definition" before wording its passage

- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/architecture/system_context.md
  why: "Docs surfaces" cross-check — confirms README is the only changeset-level surface and per-file docs already rode
```

### Current Codebase tree (relevant excerpt)

```bash
README.md            # THE artifact (edit only)
spec/decisions.md    # READ-ONLY here — verify pins, flag gaps, never edit
src/                 # read-only reference
plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/
  architecture/spec-contracts.md, system_context.md   # maps
  P1M3T2S1/research/readme-sweep.md                   # CREATE: sweep record
```

### Known Gotchas

```bash
# Line numbers in all maps are research-time anchors — navigate by QUOTED TEXT.
# The suite is 1265 tests (this wave's baseline) — "npm test" green is the gate;
# README edits can't break it, but the run proves no accidental source edits.
# AC-16 (ANSWER-PIN-001) was added by the previous delta and its "zero-state-change
# advance" wording is now subtly WRONG without the reasked exception — this is
# the one place where existing text must be CORRECTED, not merely extended.
# Do not document: pendingIds fall-through, seam gate names, evaluateDependsOn,
# guards.ts internals, fixture changes. User-visible outcomes only.
# spec/ is NOT this task's edit surface — the wave's convention is per-file Mode A
# docs + decisions.md pins riding with each subtask; here: verify + flag only.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: READ — README.md fully; spec-contracts.md §15; spec/decisions.md pins
Task 2: VERIFY pins — all 5 decisions.md entries present? Record gaps in sweep notes
Task 3: EDIT area (a) — Usage §2/§3 re-confirm semantics + truthful delivery + AC-2c/3/16 mirrors (AC-16 correction is the priority edit)
Task 4: EDIT area (b) — ripple-confirm sentence + AC-13 (archived edits confirm)
Task 5: EDIT area (c) — AC-6 moot reason format
Task 6: EDIT area (d) — :107 completed-swap epoch acceptance (verify :98 untouched)
Task 7: AUDIT Limitations for stale entries
Task 8: WRITE research/readme-sweep.md (passage | status | old→new | BUG id | pin verified)
Task 9: GATE — npm run typecheck && npm test; git diff --stat shows README.md only
```

### Implementation Patterns & Key Details

```markdown
<!-- Wording templates (adapt to surrounding prose, keep one-line AC style): -->
<!-- (a) Usage §2: "…re-visiting a re-asked question and re-selecting your
     same answer (enter, digit, or an identical write-in) RE-CONFIRMS it —
     it ships with the next commit." -->
<!-- (a) AC-16 fix: "`enter`/digit on the recorded value is a zero-state-change
     advance — except on a RE-ASKED question, where same-value enter
     re-confirms and ships" -->
<!-- (d) :107: "…starts a fresh interrogation (the epoch restarts at 1; its
     first upsert may echo the previous epoch — accepted) that completes
     normally." -->
```

### Integration Points

```yaml
EDIT: README.md only
CREATE: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/P1M3T2S1/research/readme-sweep.md
CONSUMED: all ten implementing subtasks (Complete/Implementing per plan_status);
  P1.M3.T1.S1 lands in parallel — its PRP is area (d)'s contract
VERIFY-ONLY: spec/decisions.md (flag missing pins in the sweep record)
NOT THIS TASK: spec/ rewrites, source edits, per-file docs (already done per subtask)
```

## Validation Loop

### Level 1: Artifact integrity

```bash
git diff --stat          # README.md only
```

### Level 2: No collateral damage

```bash
npm run typecheck && npm test   # green (1265+ tests) — proves zero source edits
```

### Level 3: Read-back spot checks

```bash
grep -n "re-confirm\|re-confirms" README.md        # area (a) present
grep -n "re-asked" README.md                       # AC-16 exception carried
grep -n "moot: " README.md                         # area (c) reason format
grep -n "previous epoch\|echo" README.md           # area (d) acceptance
grep -n "archived" README.md                       # area (b) coverage (AC-13)
```

### Level 4: Not applicable — pure docs task (AUTOMATION-POLICY: no live TUI).

## Final Validation Checklist

- [ ] All four areas walked; readme-sweep.md written with old→new + BUG ids
- [ ] AC-16 same-value language corrected with the reasked exception
- [ ] AC-6 moot reason, AC-13/ripple archived-edit coverage, :107 epoch acceptance in
- [ ] :98 epoch-guard guidance not weakened; Limitations audited
- [ ] No internals; README voice/format/{key}-placeholder conventions preserved
- [ ] decisions.md pins verified (gaps flagged, spec/ untouched)
- [ ] `git diff --stat`: README.md only; `npm test` + `npm run typecheck` green

## Anti-Patterns to Avoid

- ❌ Don't document internals (pendingIds, seam gates, guards.ts, fixtures)
- ❌ Don't edit spec/ — verify pins and flag gaps only (per-file docs already rode)
- ❌ Don't weaken :98's epoch-guard guidance to accommodate (d) — the exemption is narrow
- ❌ Don't restructure sections or rewrite unaffected passages — minimal, voice-matched edits
- ❌ Don't trust research-time line anchors — navigate by quoted text
- ❌ Don't start P1.M3.T2.S2-style spec sweeps — this task is README.md and nothing else

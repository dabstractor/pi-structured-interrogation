# Validation Report — pi-interrogator (bugfix changeset 001_5dde9b4d7329)

**Snapshot validated**: HEAD `cb4057e` (working tree; fixer pipeline for the
PRD's three bugs had landed `e780a32`→`cb4057e`). Baseline suite 47 files /
1337 tests green, `tsc --noEmit` clean, keymap-conflict script exits 0.

## Validation approach

1. **Baseline re-run** — full vitest suite (1337 tests, +16 over the PRD
   baseline: the fix's own regressions), typecheck, `scripts/verify-keymap-conflicts.sh`,
   README grep gate (`ctrl+t|ctrl+d|ctrl+l|focusText|digit` → zero hits).
2. **Deep code review of the changed surfaces** — `stageSupersededWriteIn`
   (src/panel/actions.ts:367) and both call sites (direct `acceptOptionIndex`
   after `advanceAfterAccept`/before `maybeAutoSubmit`; modal
   `applyConfirmedEdit` in src/panel/ripple-confirm.ts:165), the
   `keys.ts` editorFocused gate widening, `openExternalEditor`'s
   `bufferOwner === "note"` routing fork, and the caps-comment purge.
3. **Independent adversarial E2E probes** (31 journeys, embedded in
   `validate.sh` Phase 5b, generated at runtime into `.ival-probes/` and
   auto-removed) driving the REAL modules through REAL gestures
   (`panel.handleInput` raw key bytes, real ripple modal, real auto-submit
   with delivery deps wired) — deliberately independent scenarios beyond
   the shipped tests, in the PRD's out-of-repo probe style.
4. **Doc-coherence sweep** — greps for stale caps claims, "text focus"-only
   external-editor wording, re-bind contract passages vs implementation.

## PRD bug-by-bug verdict

### BUG-001 (Major) — WRITEIN-002 supersede re-bind: **FIXED**
Verified through 13 real-flow journeys + 3 cross-cutting ones, all green:
- PRD's exact repro (J1): write-in on q1 → supersede via option → answer q2 →
  transition auto-submit delivers `q1: Alpha — my own words` with
  `answer.text` set and `custom` cleared.
- Same-gesture auto-submit on a complete set (rule b, J2) — exactly one
  delivery, one epoch bump, re-bound text shipped.
- FR-18 modal path (J3a keep applies + re-stages; J3b esc is zero-state-change,
  no re-stage).
- Guard matrix in real flows: user-held elaboration draft wins (J4),
  deliberate delete-to-empty wins (J5), kind-flip no-op — no "Alpha — a"
  echo (J6), closed/archived supersede re-binds (J7), reasked supersede
  re-binds (J8), write-in→write-in edit never re-stages (J9).
- VAL-002 consume-at-commit unregressed (J10: plain write-in commit leaves
  no slot and no durable-store entry).
- Post-ship lifecycle (J11): the re-bound draft ships, the durable store
  drains (`shipDrafts`), FR-3d post-submit exit disposes the panel
  (`done(null)`; the disposed panel consumes no input) — the shipped text
  cannot re-ship from any surface.
- R4 durability (J12): the re-staged draft survives `suspend()` in the store.
- Cross-cutting (X1–X3): deep-view accept re-stages through the same seam; a
  held batch note rides the re-bound submission (`NOTE:` line); gate hold
  blocks auto-submit until the gate is answered, then releases with the
  re-bound elaboration intact.
- The PRD's demanded owner-level adjudication is recorded:
  `spec/decisions.md:123` "WRITEIN-002 supersede re-bind restored (BUG-001)"
  (ruling WRITEIN-002-RESTORE-001, restore-via-re-stage, VAL-002 protections
  explicitly unchanged, rejected alternative documented).

### BUG-002 (Minor) — ctrl+g dead in note duty: **FIXED**
Verified through 6 journeys (E1–E6), all green: ctrl+g from note focus opens
the external editor seeded with the NOTE text and routes the completed text
to `batchNote` + `setNote` (never a question draft; TUI stop/start exactly
once; duty/focus unchanged); question duty still routes to the draft slot and
a subsequent enter commits the edited buffer; options focus stays free; a
failed round-trip mutates nothing; a bare remap types in editor focus and
never intercepts anywhere (tier 2); a chord remap intercepts in both editor
duties (tier 1) and still routes note text to the note. The shipped E2E
round-trip (commit `1bf6817`, real filesystem temp file, faked child process)
also passes.

### BUG-003 (Minor) — stale 400-char goal-cap claims: **FIXED**
README:114 now states verbatim storage citing CAPS-OUT-001 (commit `7d2e032`);
the stale `state.ts` setGoal JSDoc and the `tool.ts` BUG-009 attribution are
corrected (commit `cb4057e`). Greps repo-wide find zero live stale claims.
Verified behaviorally: 50,000- and 60,000-char goals round-trip byte-identical
through `executeInterrogate` (create + follow-up upsert with epoch echo);
8,000-char prompt/description and a 60-option set pass through verbatim.

## Issues found

### Issue 1 (Minor): tasks.json tracker regressed completed BUG-002 milestones back to "Ready"
**ID**: VAL-004
**Location**: `plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/tasks.json`

Commit `1bf6817` marked P1.M2 / P1.M2.T1 / P1.M2.T1.S3 (the BUG-002 note-duty
fix and its end-to-end AC) **Complete** — matching its landed deliverables
(`ba90100`, `951ea10`, `1bf6817`). The immediately following commit `7d2e032`
(the unrelated README caps fix) flipped those three entries back to **Ready**
while advancing the P1.M3 items, and they remain "Ready" at HEAD. Effect: the
fixer's tracker understates shipped work; an orchestrator resuming from
tasks.json could redo the completed note-duty fix or wait on a task whose
deliverable already exists. Process/bookkeeping inconsistency only — no code
or user-facing impact (all functionality verified above). The in-flight
documentation sweeps (P1.M3.T2.S1 "Ready" with an untracked research dir,
P1.M3.T2.S2 "Planned") are pending-but-started work whose mandatory gates my
probes confirm already hold.

## Testing summary

- Baseline: 47 test files / 1337 tests — all pass; `tsc --noEmit` clean.
- Repo gates: keymap-conflict script PASS (exit 0, 9 keys checked);
  README grep gate 0 hits.
- E2E probes: 31/31 pass (13 supersede journeys, 6 external-editor journeys,
  3 no-caps probes, 6 keymap-baseline gates, 3 cross-cutting journeys).
- Total bugs found this pass: 1 (0 critical, 0 major, 1 minor).

## Recommendations

- Restore the P1.M2 / P1.M2.T1 / P1.M2.T1.S3 statuses to "Complete" in
  `tasks.json` (or have the fixer's tracker reconciliation re-derive them
  from landed commits) so resumption does not redo the BUG-002 work.
- Land the two in-flight doc-sweep tasks (P1.M3.T2.S1/S2) as planned; their
  verification gates already pass against HEAD.

*Validation artifacts: `validate.sh` (self-contained: phases 0/2/4/5 with the
31 embedded E2E probes), this report, and `validation_result.json`. The probe
scratch directory is generated under `.ival-probes/` at runtime and removed
on exit; nothing else in the repo was modified.*

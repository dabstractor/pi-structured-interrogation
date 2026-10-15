# PRP — P1.M3.T2.S2: Spec coherence verification — ui-spec WRITEIN-002/hotkey table, product-requirements AC-2b, decisions.md cross-refs

---
name: "P1.M3.T2.S2 — spec coherence verification (bugfix changeset 001_5dde9b4d7329)"
description: "The Mode B spec-side sync, final subtask of the changeset. Per architecture/bug001-writein-supersede.md §(b), the three contract texts — spec/ui-spec.md:37 (WRITEIN-002), spec/product-requirements.md:84 (AC-2b tail), spec/ui-spec.md:84 hotkey external-editor row 'editor focus (any duty)' — were ALREADY correct and become true again once P1.M1/P1.M2 landed (they have: verified in research). Expected outcome: verification with ZERO-to-minimal edits. The deliverable is the verification RECORD (which passages verified, cross-ref audit results) plus any minimal amendment a mismatch forces. Gate: grep-verified verbatim matches, cross-ref audit clean, npm test + npx tsc --noEmit green, git diff shows spec/ only (README.md allowed — S1's parallel artifact)."
---

## Goal

**Feature Goal**: The spec/ suite is verified coherent with the landed changeset 001_5dde9b4d7329 (WRITEIN-002 re-bind restored end-to-end, ctrl+g live in note duty, caps purge). Zero spec-vs-code contradictions remain for BUG-001/002/003.

**Deliverable**: (1) `plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/P1M3T2S2/research/spec-coherence.md` — the check record: each target passage (verified-as-is / amended old→new), the decisions.md cross-ref audit, and the contradiction grep evidence. (2) Minimal spec edits ONLY where a mismatch is found (expected: none, per research).

**Success Definition**: All three check areas (a)/(b)/(c) below walked and recorded; every decisions.md WRITEIN-002-RESTORE-001 cross-reference (file paths, symbol names, test names) confirmed accurate against the implemented tree; contradiction greps clean; `npm test` + `npx tsc --noEmit` green; `git diff --stat` shows spec/*.md only (README.md allowed if S1 lands in the same tree).

## Why

- bug001-writein-supersede.md §(b) established the strategy: the spec texts were never wrong — the CODE was. The restore path was chosen (not the amend path) precisely so spec/ui-spec.md:37, PRD AC-2b, and the README all become true again without edits. This task is the closing proof of that strategy: verify, don't rewrite.
- The adjudication ruling (WRITEIN-002-RESTORE-001, decisions.md:125) is now a load-bearing historical record citing specific file paths and test names — if any cross-ref drifted during implementation (file moves, renamed tests), the ruling misleads future readers.
- House pattern: code+tests land, then README sync (S1, parallel) and spec sync (this task) close the changeset. Nothing follows this subtask.

## What

### Research-time ground truth (verified at current tree — the implementer re-verifies, doesn't redo)

All three contract texts are present and verbatim-correct, and the code honors them:

- **spec/ui-spec.md:37** — "**Draft role follows the selection (WRITEIN-002).** … If a write-in is later superseded by accepting a real option, the slot's text is KEPT (R4 — never destroyed) and re-binds as elaboration for the new selection; it attaches at the next submit." ✓ Restored semantics: `stageSupersededWriteIn` (src/panel/actions.ts:367) stages from the recorded answer at supersede time, wired at BOTH apply sites — `acceptOptionIndex` (actions.ts:332) and `applyConfirmedEdit` (src/panel/ripple-confirm.ts:165) — with the four guards; `reconcileDraftsForSubmit`'s kept-slot attach branch delivers it at submit (including auto-submit). "Attaches at the next submit" includes the same-gesture auto-submit on a complete set (AUTOSUBMIT rule b, P1.M1.T4.S3) — consistent.
- **spec/product-requirements.md:84 (AC-2b tail)** — "…accepting a real option after a committed write-in keeps the slot's text as elaboration (WRITEIN-002)." ✓ Satisfied verbatim.
- **spec/ui-spec.md:84 (hotkey table external-editor row)** — "external editor | `ctrl+g` | `keys.externalEditor` | editor focus (any duty) — MUST stay modifier-bearing … (BAREKEYS-001)" ✓ The widened gate landed: `editorFocused = panel.focus === "text" || panel.focus === "note"` (src/panel/keys.ts:426) and note-duty routing sends the completed text to the batch note (P1.M2.T1.S1). The row already reads "any duty" — no edit needed.
- **spec/decisions.md:125** — WRITEIN-002-RESTORE-001 ruling present with its six numbered points.

### Check areas (verify-first; amend only on mismatch)

**(a) WRITEIN-002 staged-slot-kept semantics** — re-verify ui-spec.md:37 against the implemented behavior, specifically: the staged slot behaves as an ordinary visible draft (✎ marker; user can edit or clear it before submit — "Visible" ruling, bug001 dossier :191); attach-at-next-submit includes the same-gesture auto-submit on an already-complete set. If either nuance is contradicted by wording on the line (it isn't per research), amend minimally. Also sweep ui-spec.md:135 (zero-pending flash held-elaboration naming) — unchanged by this changeset, verify no drift.

**(b) Hotkey table external-editor row** — confirm "editor focus (any duty)" matches the widened gate (focus text OR note), and that no OTHER spec file still scopes ctrl+g to text-focus-only (grep gate below: `grep -rn "text focus" spec/`). If a stale scope survives anywhere in spec/, fix that one phrase citing the ruling + BUG-002.

**(c) decisions.md WRITEIN-002-RESTORE-001 cross-ref audit** — walk every concrete reference in the ruling (decisions.md:125) and confirm each against the implemented tree. Expected matches (research-verified):

| Ruling reference | Implemented reality (verified) |
|---|---|
| `src/panel/actions.ts` `stageSupersededWriteIn` | exists, exported, :367 |
| four guards (custom-only / non-empty / not byte-equal / no user-held slot via `draftTextFor`) | in the guard chain, actions.ts:367+ |
| wired at `acceptOptionIndex` (~:313 → landed :332, after applyAnswer) | ✓ |
| wired at `applyConfirmedEdit` (ruling cites ripple-confirm.ts:142-166 → landed :164-165) | ✓ |
| `reconcileDraftsForSubmit` kept-slot attach branch (actions.ts:573-578 → may have shifted; verify it exists and is unchanged in spirit) | verify by reading |
| `consumeCommittedBuffer` protections unchanged (panel.ts ~:982-991) | verify it still consumes at commit and never re-arms |
| rewritten supersede regression test, P1.M1.T3.S1 | src/panel/actions.test.ts:889+ — `test_supersede_happy_path_stages_writein_text_as_draft` + guard tests (:900, :911, …) and modal supersede tests in ripple-confirm.test.ts (:872/:964 region) |

Historical line anchors inside the ruling (e.g. "actions.test.ts:2213", "actions.ts:409/:460") refer to PRE-changeset positions and are quoted as history — do NOT "correct" them; the ruling's job is to cite what was. Only flag/annotate if a cited FILE or SYMBOL no longer exists at all (a real misleading ref).

### Contradiction sweep (BUG-003 surface)

Confirm no spec file retains a caps claim: `grep -rn "capped at 400\|400-char\|caps engine" spec/` — expected clean or only historical decision-ledger mentions (D-ledger entries recording CAPS-OUT-001's deletion are history, not claims — verify each hit's framing: a ruling saying "the cap was deleted" is fine; an FR/AC/ui-spec line asserting a live cap is not).

### Rules

- **Verification is the deliverable.** Expected edit count: ZERO. Any edit must trace to a found mismatch and cite the ruling (WRITEIN-002-RESTORE-001 / BUG id) in its commit context.
- Never rewrite historical decision-ledger entries — append/annotate only if a cited symbol no longer exists.
- Preserve each file's voice and structure; no renumbering; navigate by QUOTED TEXT (parallel S1 edits may shift README lines, and this changeset shifted src anchors).
- spec/*.md only — README.md is S1's, src/ comments were P1.M3.T1.S2's, tests are done.

### Success Criteria

- [ ] research/spec-coherence.md written: (a)/(b)/(c) each recorded with verified/amended status + quoted text.
- [ ] Cross-ref audit table filled with real file:line confirmations (or flagged mismatches + fixes).
- [ ] `grep -rn "text focus" spec/` — no external-editor scoping hits (other uses of the phrase must be judgment-checked, not blindly flagged).
- [ ] `grep -rn "capped at 400\|400-char" spec/` — no live-cap claims.
- [ ] Any edits made cite the ruling; historical ledger anchors untouched.
- [ ] `git diff --stat`: spec/*.md only (+README.md from S1); `npm test` + `npx tsc --noEmit` green.

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the three contract texts (quoted), the implemented ground truth with anchors, the cross-ref audit checklist, the grep gates, and the zero-edit expectation. Fully contained below.

### Documentation & References

```yaml
- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/architecture/bug001-writein-supersede.md
  why: §(b) :95-99 — the three contract quotes and the "already correct, become true again" finding; :191 "Visible" ruling (✎ marker, editable/clearable); :227 same-gesture auto-submit UX note; :234 rejected amend-alternative (NOT this task's direction)
- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/architecture/bug002-003-ctrlg-and-stale-caps.md
  why: BUG-002 widened-gate + note-routing semantics; BUG-003 stale-caps site inventory
- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/architecture/conventions-and-testing.md
  why: house doc-sync pattern + test/typecheck gates (npm test, npx tsc --noEmit)
- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/prd_snapshot.md
  why: h2.2/h3.0 BUG-001 repro (the broken behavior these specs must NOT describe), h2.5 recommendations
- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/P1M3T2S1/PRP.md
  why: CONTRACT (parallel) — README sweep on the same semantics; don't touch README.md; keep spec wording convergent with what S1 lands (both trace to the same ruling)
- files: spec/ui-spec.md (:37, :84 hotkey row, :135), spec/product-requirements.md (:84 AC-2b), spec/decisions.md (:125 ruling), spec/architecture.md, spec/state-and-persistence.md, spec/tool-protocol.md
  why: the verification targets + the contradiction-sweep corpus
- files: src/panel/actions.ts (stageSupersededWriteIn :367, wiring :332), src/panel/ripple-confirm.ts (:164-165), src/panel/keys.ts (:426 editorFocused), src/panel/panel.ts (consumeCommittedBuffer ~:982), src/panel/actions.test.ts (:889+ supersede tests), src/panel/ripple-confirm.test.ts (modal supersede)
  why: ground truth for the cross-ref audit — read-only
```

### Current Codebase tree (relevant excerpt)

```bash
spec/                       # verification targets (+ minimal edits if forced)
  ui-spec.md                # :37 WRITEIN-002, :84 hotkey row, :135 flash
  product-requirements.md   # :84 AC-2b
  decisions.md              # :125 WRITEIN-002-RESTORE-001 ruling
src/panel/                  # read-only ground truth (actions, ripple-confirm, keys, panel)
plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/
  architecture/             # bug dossiers + conventions
  P1M3T2S2/research/spec-coherence.md   # CREATE: the check record
```

### Known Gotchas of our codebase & Library Quirks

```bash
# Expected edit count is ZERO — resist the urge to "improve" correct spec
# prose; the deliverable is the verification record.
# The ruling's inline line anchors (actions.test.ts:2213 etc.) are HISTORICAL
# pre-changeset positions quoted as evidence — never "fix" them; only act if
# a cited file/symbol is gone entirely.
# "text focus" as a phrase may legitimately appear for OTHER keys (e.g.
# keys whose valid context is genuinely the typing surface) — read each hit,
# don't blanket-delete.
# decisions.md ledger entries mentioning the deleted caps engine are HISTORY
# ("the cap was deleted"), not live claims — framing matters, not the keyword.
# Line anchors in this PRP were verified at research time but P1.M3.T2.S1
# (README) and P1.M3.T1.* (src comments) run parallel — navigate by quoted
# text; re-locate src anchors with grep before recording file:line evidence.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: READ — bug001 dossier §(b)/:191/:227; bug002-003 dossier; decisions.md:125 ruling in full; the three spec passages
Task 2: AUDIT (a) — re-read ui-spec.md:37 + :135 against src (stageSupersededWriteIn guards, both wiring sites, reconcileDraftsForSubmit attach, same-gesture auto-submit test P1.M1.T4.S3); record verbatim-match evidence
Task 3: AUDIT (b) — ui-spec hotkey row :84 vs keys.ts:426 editorFocused + note routing (P1.M2.T1.S1/S2); grep "text focus" across spec/; judgment-check each hit
Task 4: AUDIT (c) — walk the ruling's cross-ref table (fill the real file:line for every cited symbol/test); confirm consumeCommittedBuffer protections unchanged; confirm reconcileDraftsForSubmit attach branch intact
Task 5: SWEEP — caps contradiction greps; read every hit's framing
Task 6: AMEND (only if forced) — minimal spec edit per mismatch, citing the ruling; historical anchors untouched
Task 7: WRITE research/spec-coherence.md — (a)/(b)/(c) statuses, cross-ref table with evidence, grep outputs
Task 8: GATE — npm test && npx tsc --noEmit; git diff --stat (spec only, +README from S1)
```

### Implementation Patterns & Key Details

```markdown
<!-- Record format (research/spec-coherence.md), one row per target: -->
<!-- | spec/ui-spec.md:37 WRITEIN-002 | verified-as-is | code: stageSupersededWriteIn
     actions.ts:367, wired :332 + ripple-confirm.ts:165; attach branch
     actions.ts:{n}; same-gesture auto-submit test actions.test.ts:{n} | BUG-001 | -->
<!-- Amendment (only on mismatch) style: minimal sentence fix + the ruling id
     in the commit message, e.g. "(WRITEIN-002-RESTORE-001, BUG-002)". -->
```

### Integration Points

```yaml
EDIT: spec/*.md (expected: none; forced-only, citing the ruling)
CREATE: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/P1M3T2S2/research/spec-coherence.md
CONSUMED: complete landed changeset (P1.M1.*, P1.M2.T1.*, P1.M3.T1.*) + P1.M3.T2.S1 README sweep (parallel)
DO NOT TOUCH: README.md (S1), src/ (done — P1.M3.T1.S2 owned the last comment), tests, plan/ metadata
FOLLOWED BY: nothing — this closes the changeset (Mode A+B complete)
```

## Validation Loop

### Level 1: Artifact integrity

```bash
git diff --stat    # spec/*.md only (README.md allowed — S1's parallel artifact)
```

### Level 2: No collateral damage

```bash
npm test && npx tsc --noEmit    # green — proves zero source edits
```

### Level 3: Coherence gates (the core)

```bash
grep -n "slot's text is KEPT" spec/ui-spec.md            # present, verbatim
grep -n "keeps the slot's text as elaboration" spec/product-requirements.md   # AC-2b tail present
grep -n "editor focus (any duty)" spec/ui-spec.md        # hotkey row present
grep -rn "text focus" spec/                              # no external-editor scoping (judgment-check each hit)
grep -rn "capped at 400\|400-char" spec/                 # no live-cap claims (ledger history exempt)
grep -n "WRITEIN-002-RESTORE-001" spec/decisions.md      # ruling present; cross-refs audited
grep -rn "stageSupersededWriteIn" spec/ src/panel/actions.ts src/panel/ripple-confirm.ts   # ruling's symbol refs resolve
```

### Level 4: Not applicable — pure verification/docs task (AUTOMATION-POLICY: no live session).

## Final Validation Checklist

- [ ] research/spec-coherence.md written; (a)/(b)/(c) all recorded with evidence
- [ ] Three contract texts verified verbatim-satisfied (or amended with ruling citation)
- [ ] Cross-ref audit table complete: every cited file/symbol/test resolves
- [ ] Grep gates pass; every "text focus"/caps hit judgment-checked and explained
- [ ] Historical ledger anchors untouched; zero unforced edits
- [ ] `git diff --stat`: spec only (+README from S1); `npm test` + `npx tsc --noEmit` green
- [ ] Mode B closed — changeset 001 documentation complete

## Anti-Patterns to Avoid

- ❌ Don't rewrite correct spec prose — verification IS the deliverable; expected edits: zero
- ❌ Don't "correct" the ruling's historical line anchors (pre-changeset positions are cited as evidence)
- ❌ Don't blanket-delete "text focus" or caps-keyword hits without reading framing
- ❌ Don't touch README.md (S1), src/, tests, plan/ metadata
- ❌ Don't trust line anchors — re-locate by quoted text/grep before recording evidence
- ❌ Don't document implementation internals into spec (stageSupersededWriteIn belongs in the ruling, not the FR text)

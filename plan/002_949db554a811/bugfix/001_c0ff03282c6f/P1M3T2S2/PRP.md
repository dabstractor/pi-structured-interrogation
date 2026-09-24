# PRP — P1.M3.T2.S2: spec/ living-documents sweep — align FR/AC/decision records with fixed semantics

---
name: "P1.M3.T2.S2 — spec/ living-documents sweep"
description: "The Mode B documentation task for spec/ after Bugfix Wave 1 (BUG-001..BUG-008, fixed; P1.M3.T1.S1 certified the integrated tree green; P1.M3.T2.S1 swept README.md in parallel). spec/ is LIVING documentation — commits ride fixes (git log: 'Internal submit errors now nack remote clients', 'Snapshot ring cleared for close-pass entries'). Pre-research finding: MOST target passages ALREADY carry the fixed semantics via Mode A updates ridden with the fixes; this sweep VERIFIES each target against the shipped code and closes residual gaps (notably: ui-spec's remote-bridge section lacks the internal_error nack sentence that architecture.md and FR-32 already carry; tool-protocol.md's write-in/submit passages need a BUG-006 shape check). Cross-check no statement contradicts another spec file. Edit spec/*.md only; no code, no mocks."
---

## Goal

**Feature Goal**: The `spec/` corpus (7 files) is consistent with the shipped behavior of the integrated Bugfix Wave 1 changeset. Every FR, AC, decision-record, and architecture/persistence statement that touches the 8 fixed bugs states the FIXED semantics; no two spec files contradict each other; passages already updated via ridden Mode A commits are verified, not duplicated.

**Deliverable**: Edited `spec/*.md` files (wording corrections/gap-fills only where drift or omission exists), plus the sweep record `research/spec-sweep.md` with one row per target passage: verified-as-is / corrected (old → new) / gap-filled, with BUG id and cross-check note.

**Success Definition**: All target passages from the contract definition walked and recorded; at minimum the ui-spec remote-bridge `internal_error` gap is closed; a full cross-file consistency pass (grep-driven, per Blueprint) finds no contradictions; `npm test` + `npm run typecheck` still green and `git diff --stat` shows spec/ (and README.md from S1, which runs in parallel) only.

## Why

- The bug report cites spec-level documents as recording premises the code violated: decisions.md's AUTOSUBMIT-002 premise ("the scenario is a user filling out later groups…") was written on the understanding the hold line rendered — it didn't (BUG-001). After fixes, any spec passage still hedging, scoping narrowly, or omitting the fixed behavior is the same failure class in the other direction.
- spec/ is the SOURCE the README summarizes and future implementers read; a stale FR/AC re-introduces the bug at the next touch.
- This is the changeset's final subtask — "Modes A+B closed" — nothing follows it.

## What

### Pre-research finding (important — calibrates the work)

Riding Mode A updates, most targets are ALREADY aligned (verified during this PRP's research at current HEAD):

- `spec/product-requirements.md` FR-3 (gate-hold sentence, commit-scoped "commits show the ⚠ line"), FR-12 (write-in/elaboration duties, enter-commits, no two-stage), FR-32 (internal_error nack, BUG-007), AC-2/2c/2d, AC-13 — all already state fixed semantics.
- `spec/ui-spec.md` auto-submit section: gate-hold wording ("whenever a commit lands while gate questions remain unanswered"), exit-gesture write-throughs (ESC-002), write-in passages — aligned.
- `spec/decisions.md`: D-R6 already carries "An unexpected internal error in the submit pipeline nacks `internal_error` … (BUG-007)"; WRITEIN/AUTOSUBMIT pins updated.
- `spec/architecture.md` bridge submit flow diagram already shows "(internal throw → submit-result internal_error nack + completed; no rollback — BUG-007)".
- `spec/state-and-persistence.md` §snapshot invariants already documents close-pass snapshots powering AC-13 `(changed)` + digestSince no-op treatment.

So the task is **verify + residual gap-fill + cross-check**, NOT a rewrite. Known residual gaps found in research:

1. **ui-spec.md §Remote bridge** (the bridge-submit-mapping/flowId paragraph region): documents `flow_not_found` and foreign-flowId silence but (as of research HEAD) does NOT carry the `internal_error` nack sentence that FR-32, D-R6, and architecture.md all state — an internal cross-file inconsistency. Close it with one sentence referencing BUG-007/D-R6.
2. **product-requirements.md FR-3(a)** "`(a) delta message to the model (~2 lines + reminder line …)`" — BUG-006 restored the ≤3-line shape via flattening + per-entry caps. Verify "~2 lines" wording still acceptable (it is approximate), but confirm no nearby text implies long write-ins ship verbatim/multi-line; if the delta-shape statement lacks the single-line guarantee, add "(write-in entries flattened to one line and capped)".
3. **ui-spec.md :129 region (submission renderer)** — card `{title}: {old} → {new (changed)}` and `✎ {text}` truncated-to-fit: verify the `(changed)` reachability premise (BUG-003 fix) is reflected in the renderer section or its adjacent snapshot contract; if the renderer section says nothing about editedArchived, that's fine (state-and-persistence.md owns it) — record as verified-by-other-file.

### Sweep targets (from the contract definition; navigate by QUOTED TEXT, not line numbers)

| # | File | Target | What to verify |
|---|------|--------|----------------|
| 1 | product-requirements.md | FR-3 (gate-hold clause) | "commits show the ⚠ line" — commit-scope, any commit entry point (accept, ripple edit, bridge submit per P1.M1.T1.S2) |
| 2 | product-requirements.md | FR-12 (free-text duties) | duty follows entry path AND cursor position incl. after navigation (BUG-004); enter on text-question affordance opens editor (BUG-008); every exit is a write-through (BUG-002) |
| 3 | product-requirements.md | FR-32 (bridge) | internal_error nack sentence present (already is) |
| 4 | product-requirements.md | AC-13 :~91 | `Q3: sqlite → postgres (changed)` now reachable via close-pass snapshots — no hedge, no "best-effort" |
| 5 | product-requirements.md | AC-2 :~76-77 + AC-2c :~79 | ≤3-line delta (BUG-006 shape); text-answer `enter` flows |
| 6 | ui-spec.md | :~39 (Other row / write-in), :56-65 (duties/enter) | duty re-derivation on navigation; revisit visibility of recorded write-ins (BUG-005: ✎ parity `answer.custom`, dimmed preview of `answer.value`) |
| 7 | ui-spec.md | :~72 gate-hold wording | commit-scoped arming (already present — verify the "completeness rule already covers the common case" aside doesn't contradict the fix: the ⚠ line now arms EVEN when the completeness check returns, i.e. in exactly that common case; adjust the aside if it implies the line only matters in rare cases) |
| 8 | ui-spec.md | :~129 renderer + §Remote bridge | `(changed)` render; **the internal_error gap (residual gap #1)** |
| 9 | decisions.md | :~13 ESC-002 | "All exits are draft write-throughs" — confirm the exits enumerated/generic invariant covers ctrl+c, discuss, note-mode (BUG-002); CTRL-C-001 pin nearby may need "and preserves the draft" if absent |
| 10 | decisions.md | :~21 WRITEIN-001 cursor-follow | "the duty follows entry path and cursor position" — add/verify "including after question navigation" (BUG-004) |
| 11 | decisions.md | :~27 R4 / hard-requirements line | R4 statement consistent with every-exit write-through |
| 12 | decisions.md | :~40-41 D-R5/D-R6 | D-R6 internal-error nack (present); D-R5 pipeline description consistent with BUG-006 filtering/capping if it enumerates steps |
| 13 | architecture.md | :~149-162 bridge submit flow | already carries BUG-007 line — verify pipeline step list matches code (baseline → diff → BUG-008 filter → markSubmitted → buildSubmission → deliver → noteSubmissionDelivered → maybeAutoSubmit tail) |
| 14 | state-and-persistence.md | :~126-130 snapshot invariant | close-pass snapshots documented (present) — verify the "ONE snapshot per close pass, no epoch bump, `closed` statuses, digestSince no-op" contract matches src/lifecycle.ts / src/snapshots.ts as implemented by P1.M1.T3.S2 |
| 15 | tool-protocol.md | submit-result error values | verify the agent-facing/bridge-facing submit-result error VALUE SET is specified somewhere authoritative: `flow_not_found` (ui-spec), `invalid_answer` (D-R4), `internal_error` (D-R6/FR-32). If tool-protocol.md is agent-facing only (submit-results never reach the model), record verified-by-other-file rather than importing bridge detail — match the file's existing scope discipline |

### Cross-file consistency pass (mandatory)

After per-passage edits, run the contradiction sweep (Level 3 below). Every fixed semantic must read the same in ALL files that state it: gate-hold arming scope (FR-3 ↔ ui-spec ↔ decisions AUTOSUBMIT-002), write-through exits (R4 ↔ ESC-002 ↔ CTRL-C-001 ↔ FR-12), `(changed)` reachability (AC-13 ↔ state-and-persistence ↔ ui-spec renderer), delta shape (FR-3a/AC-2 ↔ tool-protocol :53 ↔ D-R5), nack values (FR-32 ↔ D-R4/D-R6 ↔ ui-spec ↔ architecture.md), duty re-derivation (WRITEIN-001 ↔ FR-12 ↔ ui-spec).

### Rules

- Correct drift / fill gaps only — every edit traces to one of the 8 fixes' final semantics (bug report h2.5 Recommendations + the implementing subtasks' PRPs + their ridden Mode A commits).
- Do NOT duplicate content a sibling spec file already owns — reference or leave it (spec files deliberately defer with "(details in …)" convention).
- Preserve each file's voice: decisions.md is terse pin-prose; product-requirements.md is FR/AC numbered lists; ui-spec.md is bulleted behavior specs. No restructuring, no renumbering.
- No changes to src/, tests, README.md (S1's artifact), or plan/.

### Success Criteria

- [ ] All 15 target rows recorded in `research/spec-sweep.md` (verified-as-is / corrected old→new / gap-filled).
- [ ] ui-spec §Remote bridge carries the `internal_error` nack semantics (gap closed).
- [ ] No spec passage documents undelivered behavior; none hedges a now-working behavior ("best-effort", "in practice", "should").
- [ ] Cross-file contradiction sweep clean (grep evidence in research notes).
- [ ] `git diff --stat` shows spec/*.md only (plus README.md if S1 landed in the same tree — expected, parallel task).
- [ ] `npm run typecheck` + `npm test` green (proves no source touched).

## All Needed Context

### Context Completeness Check

A fresh implementer needs: which spec files exist and their scopes, the per-passage targets with current-state pre-research, the fixed semantics per bug, the cross-check method, and the out-of-scope map. All below.

### Documentation & References

```yaml
- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/architecture/testing-and-docs.md
  why: repo conventions map — §1 test gates (npm test + typecheck, 1224 tests), §2 README structure; establishes the doc-sync discipline this task mirrors for spec/

- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/prd_snapshot.md
  why: h2.2/h2.3 each bug's OLD behavior (what drift looks like) + h2.5 Recommendations (the fixed semantics every passage must state)

- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/architecture/bug-00{1..8}-*.md
  why: per-bug dossiers — when a passage is ambiguous, the dossier states the fix's exact final semantics (esp. bug-001-gate-hold, bug-002-draft-r4, bug-003-snapshots-changed, bug-007-bridge-errors)

- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/P1M3T1S1/PRP.md (+ research/triage-note.md if present)
  why: certifies the green integrated tree; triage note records final test-asserted semantics

- file: plan/002_949db554a811/bugfix/001_c0ff03282c6f/P1M3T2S1/PRP.md
  why: CONTRACT (parallel) — README sweep on the same semantics; do not touch README.md, and keep spec edits from contradicting what S1 lands (both trace to h2.5, so they converge; if a judgment call diverges, prefer the spec as source and note it)

- files: spec/product-requirements.md · spec/ui-spec.md · spec/decisions.md · spec/architecture.md · spec/state-and-persistence.md · spec/tool-protocol.md · spec/SPEC.md · spec/implementation-plan.md
  why: the artifacts. Read each target region fully; check spec/SPEC.md and implementation-plan.md only via the contradiction grep (not named targets, but a stray stale claim would contradict)

- files: src/panel/actions.ts (maybeAutoSubmit ~:604) · src/snapshots.ts (computeDiff/answerSummary) · src/delivery.ts (budget loop) · src/lifecycle.ts (close pass snapshot) · src/remote-bridge.ts / src/remote-submit.ts · src/panel/layout.ts (hasTextAnswer) · src/panel/short-view.ts (preview line)
  why: read-only ground truth for verifying each claim; cite line anchors in the sweep record
```

### Current Codebase tree (relevant excerpt)

```bash
spec/
  product-requirements.md   # FR-1..FR-35 + AC list        (targets 1-5)
  ui-spec.md                # panel/deep/overview/bridge    (targets 6-8)
  decisions.md              # pin ledger Q/D/R entries      (targets 9-12)
  architecture.md           # module/event/flow diagrams   (target 13)
  state-and-persistence.md  # snapshot ring, drafts         (target 14)
  tool-protocol.md          # agent-facing schema/text      (target 15)
  SPEC.md / implementation-plan.md  # grep-sweep only
plan/002_949db554a811/bugfix/001_c0ff03282c6f/
  architecture/             # bug dossiers + conventions map
  P1M3T2S2/research/spec-sweep.md   # CREATE: the sweep record
```

### Known Gotchas of our codebase & Library Quirks

```bash
# Line numbers in the contract (FR-3 :27 etc.) are from the pre-wave snapshot;
# ridden Mode A edits shifted them — navigate by QUOTED TEXT (grep the
# distinctive phrase: "foundational unanswered", "two-stage arming",
# "internal_error", "(changed)", "draft write-through").
# Most targets are ALREADY correct (ridden Mode A commits 150b819, 3bdcfc8,
# 60826a2) — the deliverable is the verified RECORD + the residual gaps,
# not bulk edits. Resist rewriting correct prose.
# ui-spec.md gate-hold aside ("the completeness rule already covers the
# common case") predates BUG-001's insight that this is EXACTLY when the ⚠
# line must render — check whether the aside now reads wrong and tighten it.
# decisions.md pin entries are HISTORICAL records of user decisions — never
# delete a pin; corrections append or amend the pin's trailing parenthetical
# (existing convention: "(BUG-007)", "found by the live RPC itest").
# spec files deliberately defer detail across files ("details in ui-spec.md")
# — duplication is a defect; if two files state the same rule, one should
# reference the other.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: READ — all six target spec files' relevant regions + prd_snapshot h2.5 + bug dossiers for ambiguous calls
Task 2: BUILD the sweep table — one row per the 15 targets above (quote → current claim → required semantics → BUG id), in research/spec-sweep.md
Task 3: VERIFY per row against src/ ground truth (cite file:line); mark verified-as-is or draft the minimal edit
Task 4: EDIT the residuals — priority order: ui-spec internal_error gap → gate-hold aside tightening → duty-after-navigation wording → any hedge removals (AC-13 "best-effort" etc.) → delta-shape single-line note
Task 5: CROSS-FILE contradiction sweep (Level 3 greps); fix any divergence, prefer spec/product-requirements.md as FR source of truth
Task 6: RECORD final spec-sweep.md (status per row + grep evidence) and GATE: npm run typecheck && npm test; git diff --stat = spec/*.md (+README.md from S1) only
```

### Implementation Patterns & Key Details

```markdown
<!-- Gap-fill example (ui-spec §Remote bridge, after the flow_not_found sentence): -->
<!-- "An unexpected internal error in the submit pipeline nacks `internal_error`
     and completes the flow (no rollback; the next upsert resurface heals) —
     BUG-007, D-R6." — mirrors FR-32/architecture.md wording exactly. -->

<!-- Amendment example (decisions.md pin): append to WRITEIN-001's existing
     parenthetical style: "the duty follows entry path and cursor position
     (re-derived on every question change — BUG-004)". Never delete the pin. -->
```

### Integration Points

```yaml
EDIT: spec/product-requirements.md, spec/ui-spec.md, spec/decisions.md,
      spec/architecture.md, spec/state-and-persistence.md, spec/tool-protocol.md
CREATE: plan/002_949db554a811/bugfix/001_c0ff03282c6f/P1M3T2S2/research/spec-sweep.md
CONSUMED: certified green tree (P1.M3.T1.S1) + ridden Mode A spec commits
DO NOT TOUCH: src/, tests, README.md (S1), plan/ metadata, PRD
FOLLOWED BY: nothing — this closes the changeset (Modes A+B complete)
```

## Validation Loop

### Level 1: Artifact integrity

```bash
git diff --stat    # spec/*.md only (README.md allowed — S1's parallel artifact)
```

### Level 2: No collateral damage

```bash
npm run typecheck && npm test   # must stay green — proves zero source edits
```

### Level 3: Cross-file consistency (the core gate)

```bash
# Each fixed semantic must appear consistently everywhere it's stated:
grep -rn "foundational unanswered" spec/          # FR-3, ui-spec, AC-2d — same commit-scope wording
grep -rn "internal_error" spec/                   # FR-32, D-R6, architecture.md, AND ui-spec (post-gap-fill)
grep -rn "(changed)" spec/                        # AC-13, ui-spec renderer, state-and-persistence — no hedge
grep -rn "write-through\|draft write" spec/       # ESC-002, CTRL-C-001, R4 — generic invariant, all exits
grep -rn "two-stage" spec/                        # only as REMOVED/removal notes (WRITEIN-001), never as live behavior
grep -rn "flow_not_found\|invalid_answer" spec/   # consistent value set across ui-spec/D-R4/decisions
grep -rn "cursor position" spec/                  # WRITEIN-001, FR-12 — includes after-navigation
grep -rn "≤3-line\|~2 lines\|3-line" spec/        # delta shape statements agree; single-line write-in entries noted
# Read every hit; any pair that states the same rule differently is a defect to fix.
```

### Level 4: Not applicable — pure documentation task (AUTOMATION-POLICY: no live session).

## Final Validation Checklist

- [ ] All 15 target rows recorded (verified/corrected/gap-filled) in research/spec-sweep.md
- [ ] ui-spec `internal_error` nack gap closed; value set consistent across files
- [ ] Gate-hold wording commit-scoped everywhere; the "common case" aside no longer implies rarity
- [ ] AC-13 unhedged; AC-2 delta shape consistent with BUG-006 flattening/capping
- [ ] Draft write-through invariant covers ctrl+c/discuss/note-mode in decisions.md + FR-12/ui-spec
- [ ] Duty re-derivation on navigation stated in WRITEIN-001 + FR-12
- [ ] Cross-file grep sweep clean; evidence in research notes
- [ ] `git diff --stat`: spec only (+README from S1); typecheck + tests green
- [ ] No pin deleted from decisions.md; no spec file restructured

## Anti-Patterns to Avoid

- ❌ Don't rewrite correct prose — most targets are already aligned via ridden Mode A commits; verify and record
- ❌ Don't duplicate rules across spec files — defer/reference per the existing convention
- ❌ Don't delete or rewrite historical decision pins — append/amend only
- ❌ Don't touch src/, tests, README.md, plan/ metadata
- ❌ Don't trust the contract's line numbers — grep by quoted text
- ❌ Don't invent features or over-promise beyond h2.5's fixed semantics

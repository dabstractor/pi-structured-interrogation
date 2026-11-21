# PRP — P2.M1.T1.S1: Conformance inventory — map each ruling to its cross-refs; run the full gates

---
name: "P2.M1.T1.S1 — eight-ruling conformance verification runbook"
description: "VERIFICATION-ONLY (no source edits): for each of the eight post-2026-10-19 rulings (ANSWER-FIDELITY, KEEP-OPEN-001/002, DEEP-FULLSCREEN-001, PANELTOGGLE-001, CHAT-CONTEXT-001, LENIENT-ANSWER-001, EMPTY-REPLY-001, CHAT-STYLE-001), confirm every decisions.md cross-referenced file/test exists and the pinned describe/it blocks are present (grep by ruling tag), then run npm test / npm run typecheck / npm run lint with FRESH counts (one re-run on a one-off flake). Missing cross-ref or reproducible failure = BUG at the existing seam — report and STOP, never fix. Output: conformance matrix {ruling -> crossRefsPresent, pinnedTestsPresent, green} to research/, consumed by P2.M1.T1.S2 and P3."
---

## Goal

**Feature Goal**: Mechanically prove that the eight post-2026-10-19 PRD rulings are fully landed at the current working tree: every decisions.md cross-ref exists, every pinned test block is present, and all three gates (`npm test`, `npm run typecheck`, `npm run lint`) are green with fresh counts.

**Deliverable**: A conformance matrix written to `plan/006_45773b259b06/P2M1T1S1/research/conformance-matrix.md` of the shape `{ruling -> {crossRefsPresent, pinnedTestsPresent, green}}` plus gate output tails (fresh counts). Zero modifications to source, spec/, README, or any tracked file.

**Success Definition**: All eight rulings show crossRefsPresent=true and pinnedTestsPresent=true; the three gates pass (or a single re-run clears a flake); the matrix names its consumer seams (P2.M1.T1.S2 docs audit, P3 context). Any miss → the matrix instead records `"result": "bug"` with the ruling + missing cross-ref/test + gate evidence, and the agent STOPS.

## User Persona

**Target User**: The plan orchestrator / future implementer consuming P2.M1.T1.S2 (README residue audit) and P3 (local input recovery) — they need a trusted green baseline naming exactly which seams are already landed.

**Use Case**: Before auditing README drift and before building new work on these seams, verify the claimed conformance mechanically rather than trusting the decisions.md prose.

**Pain Points Addressed**: decisions.md cross-refs were written at HEAD ec61eb1; subsequent changesets (P1 keymap work) may have drifted files/lines. Unverified green claims propagate into later work.

## Why

- The PRD delta (plan 006) added eight rulings as "already implemented — green verification" (P2 header). This subtask is that verification.
- P2.M1.T1.S2 needs the verified ruling inventory to scope its README residue audit; P3 (local input recovery) builds on these seams (sidechat-engine, delivery, panel) and needs the trusted baseline.
- P1.M1.T3.S2's parallel gate run is scoped to the P1 changeset (diff confined to README.md) — this run re-verifies at its own tree and must NOT reuse T3.S2's counts.

## What

### Behavior contract (exact)

1. **For each ruling**, run the tag-grep and cross-ref existence check per the matrix table below. `pinnedTestsPresent` = the ruling tag (or its documented short tag) appears in at least the cross-referenced test file(s) named in decisions.md.
2. **ANSWER-FIDELITY special case**: the token `SUBMISSION_LIST_MAX_CHARS` legitimately appears in `src/delivery.ts` at :72 and :180 — in comments DOCUMENTING its deletion. The conformance assertion is `grep -n "const SUBMISSION_LIST_MAX_CHARS" src/delivery.ts` → NO hits (the const is gone), and `grep -n "+ {m} more\|+m more" src/delivery.ts` rollup machinery → no live rollup loop in buildSubmission (comment mentions are fine; assert against `const` declarations and the `.slice(`/drop loop, not prose).
3. **Run the gates** in order, capture fresh counts:
   ```bash
   npm test            # vitest run — record "Test Files"/"Tests" summary verbatim; ≥56 files
   npm run typecheck   # tsc --noEmit — zero errors
   npm run lint        # eslint src scripts *.ts — zero problems
   ```
   Failed gate → re-run ONCE (flake precedent, plan/006 architecture/system_context.md). Two consecutive failures → BUG, stop.
4. **Diff hygiene check (report-only)**: `git diff --name-only` and `git status --porcelain`. Expected: README.md modifications (P1.M1.T3.S1/S2 land in parallel/before) + untracked `plan/006_*` artifacts. Any OTHER modified tracked path → record it as an anomaly in the matrix (informational; it may be P1's README work — the P1 changeset gate owns that assertion, not this one).
5. **Emit the matrix** (exact shape) to `research/conformance-matrix.md`:
   ```json
   {
     "gates": { "test": "green (N files / M tests)", "typecheck": "green", "lint": "green" },
     "rulings": {
       "ANSWER-FIDELITY":   { "crossRefsPresent": true, "pinnedTestsPresent": true, "green": true },
       "KEEP-OPEN-001":     { ... }, "KEEP-OPEN-002": { ... },
       "DEEP-FULLSCREEN-001": { ... }, "PANELTOGGLE-001": { ... },
       "CHAT-CONTEXT-001":  { ... }, "LENIENT-ANSWER-001": { ... },
       "EMPTY-REPLY-001":   { ... }, "CHAT-STYLE-001": { ... }
     },
     "anomalies": []
   }
   ```
   Attach the per-ruling grep evidence (file:line lists) under the JSON. On any failure: `"result": "bug"`, `ruling`, `missing: <cross-ref or test>`, evidence — and STOP.

### Success Criteria

- [ ] All 8 rulings: every cross-referenced file exists; every pinned test file greps positive for its tag.
- [ ] `const SUBMISSION_LIST_MAX_CHARS` absent from src/delivery.ts (comments mentioning it are EXPECTED, not violations).
- [ ] Three gates green with fresh counts recorded (never the stale 54/1624 baseline; expect ≥56 test files).
- [ ] Matrix written to research/conformance-matrix.md; zero tracked-file modifications by this subtask.
- [ ] Any miss reported as a BUG with ruling + seam named; nothing "fixed".

## All Needed Context

### Context Completeness Check

Every cross-ref is pre-verified in the companion research note (file + symbol + line, audited at this tree): the implementing agent re-runs the greps from the table below, runs three commands, and writes one file. No discovery required.

### Documentation & References

```yaml
- file: plan/006_45773b259b06/P2M1T1S1/research/research-notes.md
  why: THIS ITEM'S PRE-VERIFIED AUDIT — per-ruling grep evidence with exact symbols/lines; the matrix table below is derived from it
  critical: the SUBMISSION_LIST_MAX_CHARS comment-vs-code gotcha (§What.2) came from this audit

- file: spec/decisions.md
  why: the rulings' authoritative cross-ref lists (ANSWER-FIDELITY :138, PANELTOGGLE-001 :154, KEEP-OPEN-001 :158, KEEP-OPEN-002 :159, CHAT-CONTEXT-001 :163, LENIENT-ANSWER-001 :167, EMPTY-REPLY-001 :168, CHAT-STYLE-001 :169)
  gotcha: READ-ONLY (hash-guarded PRD component); never edit

- file: plan/006_45773b259b06/P1M1T3S2/PRP.md
  why: PREDECESSOR CONTRACT (parallel) — establishes the baseline discipline this run reuses: fresh counts (≥56 test files, never 54/1624), one-flake re-run, report-don't-fix
  gotcha: do NOT reuse its gate counts; its diff==README.md assertion belongs to the P1 changeset, not this run

- file: package.json
  why: exact gate scripts (verified): "test": "vitest run", "typecheck": "tsc --noEmit", "lint": "eslint src scripts *.ts"

- prd: h2.10 AC-2 (ANSWER-FIDELITY), list.0 commitment 2, h2.56 file checklist
  why: the normative surface this inventory guards
```

### The conformance matrix table (pre-verified; re-run each check)

| Ruling | Cross-refs to confirm | Pinned-test greps (tag → file) |
|---|---|---|
| ANSWER-FIDELITY | `src/delivery.ts` (:72-75 DELETED comment, :180-188 full-line entryLines; `const SUBMISSION_LIST_MAX_CHARS` ABSENT), `src/results.ts` (full `answer:`/`elaboration:` lines) | `ANSWER-FIDELITY` → `src/delivery.test.ts`, `src/ac-scripted.test.ts`, `src/results.test.ts` |
| KEEP-OPEN-001 | `src/completion.ts` (NO-FORCE note; attemptCompletion has NO force param: `grep -n "force" src/completion.ts` → no param), `src/panel/actions.ts` (KEEP-OPEN-001 note; SubmitDeps.onSubmitted ABSENT: `grep -n "onSubmitted" src/panel/actions.ts src/panel/panel.ts src/index.ts` → no live refs) | `KEEP-OPEN-001` → `src/completion.test.ts` |
| KEEP-OPEN-002 | `src/delivery.ts` `partialNudge` (:66) + `NUDGE_UNANSWERED` | `KEEP-OPEN-002` → `src/delivery.test.ts`; AC-2/AC-13 refs in `src/ac-scripted.test.ts` |
| DEEP-FULLSCREEN-001 | `src/panel/deep-view.ts` `clampGlobal` (:623), `deepScrollBy` (:742), `deepScrollPage`; `src/panel/terminal-budget.ts` `deepViewportBudget` (:53); `src/panel/keys.ts` page keys + expandDescription | `DEEP-FULLSCREEN` → `src/panel/deep-view.test.ts` |
| PANELTOGGLE-001 | `src/shortcut.ts` (registerShortcut); `src/panel/keys.ts` `onToggle` (:185/:449); `src/config.ts` `keys.toggle` (:99, ctrl+n) + `panelShortcut` (:106/:157); `scripts/verify-keymap-conflicts.sh` toggle classification (:165) | `PANELTOGGLE` → `src/shortcut.test.ts`, `src/config-surface.test.ts`, `src/panel/keys.test.ts`, `src/panel/keymap-ac.test.ts` |
| CHAT-CONTEXT-001 | `src/panel/panel.ts` (chat branch); `src/panel/chat-view.ts` sixth `viewportHeight` param (:248) + `ChatRowStyler` (:178) | `CHAT-CONTEXT` → `src/panel/chat-view.test.ts`, `src/panel/panel.test.ts` |
| LENIENT-ANSWER-001 | `src/panel/sidechat.ts` `parseAnswerBlock` (:418), `gateShape` (:504), `matchOptionValue`; `src/panel/sidechat-prompt.ts` §Answer protocol | `LENIENT` → `src/panel/sidechat.test.ts`, `src/panel/sidechat-prompt.test.ts` |
| EMPTY-REPLY-001 | `src/panel/sidechat-engine.ts` `EMPTY_REPLY_NOTICE` (:210) + empty guard (:342) | `EMPTY-REPLY` → `src/panel/sidechat-engine.test.ts` |
| CHAT-STYLE-001 | `src/panel/chat-view.ts` `ChatRowStyler`/messageLines; `src/panel/panel.ts` styler binding | `CHAT-STYLE` → `src/panel/chat-view.test.ts`, `src/panel/panel.test.ts` |

(Line anchors are from the research audit at this tree; they may drift ±few lines as P1.M1.T3.S2 lands README-only work — grep by SYMBOL/TAG first, line second.)

### Current Codebase tree (relevant slice)

```bash
spec/decisions.md                    # read-only rulings + cross-refs
src/ (delivery, results, completion, panel/*, shortcut, config, scripts/)
scripts/verify-keymap-conflicts.sh
plan/006_45773b259b06/P2M1T1S1/research/   # the ONLY write target
```

### Desired Codebase tree

Unchanged. New files only: `research/conformance-matrix.md` (+ optional gate-output captures) under this item's plan dir.

### Known Gotchas of our Codebase & Library Quirks

```bash
# CRITICAL: ANSWER-FIDELITY — "SUBMISSION_LIST_MAX_CHARS" APPEARS in delivery.ts
# :72/:180 as DELETION-DOCUMENTING comments. Assert the CONST is absent
# ("const SUBMISSION_LIST_MAX_CHARS"), not the bare token, or you false-BUG.
# CRITICAL: never cite the stale 54-files/1624-tests baseline; fresh counts,
# expect ≥56 test files (P1.M1.T1.S3 re-baseline).
# Flake precedent: ONE re-run of a failed gate, then it's a bug.
# git status: README.md modifications are P1's parallel docs work — expected,
# informational only here (T3.S2 owns the diff-confinement assertion).
# Tag variants: grep LENIENT (not LENIENT-ANSWER-001), EMPTY-REPLY,
# CHAT-CONTEXT, CHAT-STYLE, DEEP-FULLSCREEN — decisions.md tests use the
# short tags; match the table above.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: PER-RULING greps (the matrix table above)
  - For each of 8 rulings: run the cross-ref existence checks + tag greps
  - Record file:line evidence per ruling in research notes
  - Any missing cross-ref or zero-hit test grep → collect as a candidate bug (verify spelling/tag variant before declaring)

Task 2: RUN the gates (fresh counts)
  - npm test 2>&1 | tail -25  → record "Test Files"/"Tests" verbatim
  - npm run typecheck; npm run lint → record exit codes
  - Failure → ONE re-run; second failure → bug, skip to Task 4

Task 3: DIFF hygiene (report-only)
  - git diff --name-only; git status --porcelain → anomalies list
    (README.md + plan/006_* untracked = expected)

Task 4: WRITE research/conformance-matrix.md (the JSON shape + evidence + anomalies) and finish
```

### Implementation Patterns & Key Details

```bash
# Per-ruling grep recipe (repeat per table row):
grep -n "onToggle" src/panel/keys.ts          # cross-ref symbol exists
grep -rln "PANELTOGGLE" src/ config* 2>/dev/null   # pinned tests present
grep -rn "PANELTOGGLE" src/shortcut.test.ts src/config-surface.test.ts | head -5  # block-level evidence

# ANSWER-FIDELITY negative assertion (the one easy false-BUG):
! grep -n "const SUBMISSION_LIST_MAX_CHARS" src/delivery.ts   # must SUCCEED (no const)
```

### Integration Points

```yaml
NO code/config/doc changes — verification only.
CONSUMERS:
  - P2.M1.T1.S2 (README residue audit): scopes its sweep to the eight rulings' README claims using this matrix's ruling inventory
  - P3 (local input recovery): trusted green baseline naming the landed seams it builds on (sidechat-engine, delivery, panel)
```

## Validation Loop

### Level 1: Syntax & Style
N/A — no repo files written.

### Level 2: Unit Tests
Task 2 IS the test run (`npm test` full suite, fresh counts).

### Level 3: Integration
Task 3 diff hygiene check (report-only).

### Level 4: Deliverable gate
`research/conformance-matrix.md` exists, carries all 8 rulings + gates JSON, and every claimed-present entry has file:line evidence in the notes.

## Final Validation Checklist

- [ ] All 8 rulings: crossRefsPresent=true with evidence; pinnedTestsPresent=true with at least one file:line tag hit each.
- [ ] `const SUBMISSION_LIST_MAX_CHARS` absent (comment mentions acknowledged, not flagged).
- [ ] Gates green, fresh counts recorded (≥56 test files); at most one flake re-run used.
- [ ] Diff anomalies recorded; README.md + plan/006_* recognized as expected.
- [ ] conformance-matrix.md written; ZERO modifications to tracked files by this subtask.
- [ ] Any failure → `"result": "bug"` with ruling + missing item + evidence; agent stopped without fixing.

## Anti-Patterns to Avoid

- ❌ Don't grep the bare token `SUBMISSION_LIST_MAX_CHARS` as a violation — the deletion comments are supposed to be there.
- ❌ Don't fix, patch, or "finish" anything — a miss is a BUG report naming the ruling/seam.
- ❌ Don't reuse P1.M1.T3.S2's gate counts or its diff-confinement assertion — re-run at this tree, README diffs are expected here.
- ❌ Don't re-run a failed gate more than once.
- ❌ Don't use long tag spellings where tests pin short ones (LENIENT, EMPTY-REPLY, CHAT-CONTEXT, CHAT-STYLE, DEEP-FULLSCREEN).
- ❌ Don't cite the stale 54/1624 baseline.

---

**Confidence Score**: 9/10 — every cross-ref and pinned-test grep was pre-verified at this tree (research-notes.md carries file:line evidence), the one false-positive trap (deleted-cap comments) is explicitly disarmed, and the deliverable is a mechanical matrix with its consumer seams named.

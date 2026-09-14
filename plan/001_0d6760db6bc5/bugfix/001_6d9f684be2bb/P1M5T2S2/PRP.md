# PRP — Docs P1.M5.T2.S2: spec/decisions.md — record the two pinned spec gaps

## Goal

**Feature Goal**: Append two short, dated decision entries to `spec/decisions.md` that pin the two spec gaps this bugfix changeset had to resolve, so future spec readers are not left at the same ambiguities:
1. **New-interrogation-after-completion semantics** (gap flagged in `architecture/spec-contracts.md` § "Second interrogation in one session / epoch semantics after completion"): a completed singleton is REPLACED by a fresh state — epoch 1, `completed=false`, empty questions/snapshots, goal retained unless the new interrogation's upsert supplies one. (Clarifies Q7 "one active set".)
2. **Epoch-presence guard scope** (Q38=A clarification): the rev+epoch guards require `epoch` only when an upsert **touches existing question ids**; the first upsert of an interrogation (all-new ids) may omit it.

**Deliverable**: Modified `spec/decisions.md` ONLY. No source code, no tests, no other spec files.

**Success Definition**: Two new one-paragraph entries appended (a) under the `## Protocol` H2 (or `## Defaulted` for the Q38 clarification — see Blueprint) in the same terse voice as existing entries, citing file + heading text (NOT h2.N numeric ids — the spec files have none), dated. `git diff` shows only `spec/decisions.md`. All 930 tests still pass (untouched).

## Why

The bug hunt found the spec was **partially silent** on both points (`architecture/spec-contracts.md` lines 131–137, 154: "epoch-reset-on-new-interrogation is UNSPECIFIED — open question for fix design", and Q38=A's "any questions/answers call must carry the session epoch" in `spec/tool-protocol.md` § Guards never spelled out the first-upsert carve-out). The implementation tasks P1.M1.T2.S1 and P1.M1.T3.S1 each **pinned** a decision to resolve their gap; this task records those pins in the repo's decision log. `decisions.md` states "decisions below are authoritative" — without these entries the implemented behavior and the decision log disagree.

## What

Append two entries to `spec/decisions.md` (structure and exact wording guidance in Blueprint). One short paragraph each, same voice as existing entries (terse, Q-numbered or dated resolution notes). No restructuring of the file; existing entries untouched.

### Success Criteria

- [ ] Entry (a) exists under an appropriate H2 and states: new interrogation after completion ⇒ fresh state, epoch restarts at 1, `completed=false`, goal retained unless replaced; cites `spec/state-and-persistence.md` §7 (auto-close, "clear in-memory state"), `decisions.md` Q7, and notes it resolves the gap flagged in `architecture/spec-contracts.md` § "Second interrogation in one session / epoch semantics after completion"
- [ ] Entry (b) exists under an appropriate H2 and states: epoch presence is required only when an upsert touches existing question ids; the first upsert may omit epoch; cites Q38=A and `spec/tool-protocol.md` § Guards ("any questions/answers call must carry the session epoch")
- [ ] Both entries dated, in the existing voice (lowercase-leaning, semicolon-separated clauses, · separators where lists appear — match the file, don't invent a new format)
- [ ] Citations use file + section heading text, never h2.N/h3.N ids
- [ ] Only `spec/decisions.md` changed; `npm test` still green (nothing depended on)

## All Needed Context

### Context Completeness Check

This is a docs-only task on a 4-file-changeset-max surface. The PRP quotes the exact current `decisions.md` H2 structure, the exact spec text being pinned, and the implemented behaviors (from the P1.M1 PRPs, which are contracts). An agent with this PRP needs nothing else.

### Documentation & References

```yaml
- file: spec/decisions.md
  why: the ONLY file to modify. H2 sections: "Architecture & data flow", "UI", "Protocol", "Staging philosophy (discussion resolution)", "Defaulted (user may veto)"
  pattern: existing entries are single-line bullets `· `-separated or short paragraphs; Q38 entry lives under "## Defaulted" as "- Q38 = A: rev + epoch guards (both). Rationale: ..."
  gotcha: no h2.N ids exist in spec files — cite heading TEXT; keep entries terse, matching voice

- file: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/architecture/spec-contracts.md
  why: lines 131–137 (§ "Second interrogation in one session / epoch semantics after completion") — the open design question entry (a) resolves; line 154 maps it to decisions Q7
  critical: entry (a) should explicitly say this gap is now PINNED by implementation (P1.M1.T2.S1)

- file: spec/tool-protocol.md
  why: § Guards ("epoch: any questions/answers call must carry the session epoch...") — the text entry (b) clarifies; § Schema line 34 epoch param description
  gotcha: don't edit tool-protocol.md itself — this changeset records the decision, spec-text updates are out of scope

- file: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/P1M1T2S1/PRP.md
  why: CONTRACT for the implemented behavior entry (a) records — completed-swap: fresh singleton via createInterrogationState, epoch 1, completed=false, snapshots empty, goal = upsert's capped goal if sent else retained

- file: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/P1M1T3S1/PRP.md
  why: CONTRACT for the implemented behavior entry (b) records — assertFresh rejects epoch-less upserts touching existing ids; first upsert (all-new ids) may omit epoch
```

### Current Codebase tree (relevant excerpt)

```bash
spec/
  decisions.md          # ← the only file modified (decision ledger, H2 sections, Q-numbered entries)
  tool-protocol.md      # read-only reference for Q38 clarification
  state-and-persistence.md  # read-only reference (§7 auto-close "clear in-memory state")
  ...
```

### Desired Codebase tree with files to be added

```bash
spec/decisions.md   # MODIFIED: +2 dated entries (no new files)
```

### Known Gotchas

- `spec/decisions.md` says the full deliberation history is intentionally discarded and entries are authoritative — write resolutions, not deliberations.
- Spec citations must use heading text (spec files have no numeric ids); the PRD index's h2.N/h3.N ids exist only in the PRD snapshot.
- Do NOT touch `spec/tool-protocol.md` or any other spec file — Mode B changeset docs record the pin; broader spec-text edits are out of scope.

## Implementation Blueprint

### Entry placement and content (the whole task)

**Entry (a) — new-interrogation-after-completion.** Append under `## Protocol` (it is a protocol/lifecycle semantic, sibling to Q7's "one active set" in Architecture — either H2 is defensible; choose Protocol because the observable contract is the tool's upsert behavior). Suggested form (adapt voice to file):

```
- 2025 bugfix pin (Q7 clarification): a new interrogation after completion REPLACES the completed singleton — fresh state, epoch 1, completed=false, goal retained unless the new upsert supplies one. Resolves the gap flagged in architecture/spec-contracts.md § "Second interrogation in one session / epoch semantics after completion" (epoch-reset was UNSPECIFIED); consistent with state-and-persistence.md §7 "clear in-memory state" — the exactly-once completion guard is per interrogation lifecycle, not per session.
```

**Entry (b) — epoch-presence guard scope.** Append under `## Defaulted (user may veto)` immediately after the existing `- Q38 = A:` line, as a dated clarification of that same decision:

```
- 2025 bugfix pin (Q38=A clarification): epoch is REQUIRED only when an upsert touches existing question ids; the first upsert of an interrogation (all-new ids) may omit it. tool-protocol.md § Guards ("any questions/answers call must carry the session epoch") reads stricter than intended — rev+epoch guards protect against stale UPDATES, not fresh sets.
```

Rules: keep each to one short paragraph; match the file's terse, semicolon/`·`-joined voice; use the actual current date; do not renumber or reword existing entries.

### Implementation Tasks (ordered)

```yaml
Task 1: MODIFY spec/decisions.md
  - APPEND entry (a) at the end of the "## Protocol" section (after the Q37 line)
  - APPEND entry (b) directly after the "- Q38 = A:" line in "## Defaulted (user may veto)"
  - VOICE: match existing entries; cite file + heading text; no h2.N ids
  - VERIFY: git diff shows only this file; markdown renders (single H2 structure unchanged)

Task 2: VALIDATE no collateral damage
  - RUN: npm test          # all green, nothing referenced decisions.md content
  - RUN: npx tsc --noEmit  # (or npm run typecheck) — sanity that no file changed
```

### Integration Points

None. Documentation-only; no config, routes, or database impact.

## Validation Loop

### Level 1: Syntax & Style

```bash
npx prettier --check spec/decisions.md 2>/dev/null || true   # repo may not format spec/; visual check suffices
git diff --stat            # expect: only spec/decisions.md
```

### Level 2: Unit Tests

```bash
npm test                   # expect: all green (no code changed)
```

### Level 3: Content review (the real gate)

```bash
grep -n "epoch" spec/decisions.md    # both new entries appear; both cite Q7/Q38 context
```

Manually confirm: both entries dated, one paragraph each, heading-text citations, existing entries byte-identical.

## Final Validation Checklist

- [ ] Only `spec/decisions.md` modified (`git status` clean otherwise)
- [ ] Entry (a): fresh-state/epoch-1/goal-retention semantics recorded under Protocol, citing the spec-contracts § "Second interrogation" gap
- [ ] Entry (b): epoch-required-only-when-touching-existing-ids recorded under Defaulted next to Q38=A
- [ ] Voice and formatting match existing entries; no numeric-id citations
- [ ] `npm test` green; no type/lint regressions (nothing code-side changed)

## Anti-Patterns to Avoid

- ❌ Don't rewrite or reword existing decision entries — append only
- ❌ Don't edit tool-protocol.md / state-and-persistence.md to "fix" the spec text — out of scope for Mode B docs
- ❌ Don't write multi-paragraph essays — the ledger is terse
- ❌ Don't invent a new H2 section — use Protocol / Defaulted

---

**Confidence Score: 9/10** — docs-only, exact placement and draft wording provided, all source behaviors pinned by completed upstream PRPs.

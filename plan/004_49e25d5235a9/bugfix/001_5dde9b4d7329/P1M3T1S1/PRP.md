# PRP — P1.M3.T1.S1: README.md — drop the stale "capped at 400 characters" clause (BUG-003, part 1)

---
name: "P1.M3.T1.S1 — README Model-behavior note: goal is stored verbatim, no length limits (CAPS-OUT-001)"
description: "One-sentence README fix (BUG-003 / PRD h2.3 Issue 2): README.md:113-116's Model behavior note claims the goal 'is capped at 400 characters and truncated with a warning beyond that', contradicting CAPS-OUT-001 (2026-10-08 owner ruling: spec/decisions.md:107, spec/tool-protocol.md:68-74 'No caps', product-requirements.md:53 FR-23), the implementation (tool.ts:201-204 stores goals verbatim, pinned by tool.test.ts:201/208), and README's OWN Configuration section (:~130 comment block, :~153-154 'No caps' JSONC comment). Drop the clause, replace with verbatim-storage wording citing CAPS-OUT-001, keep the surrounding sentences untouched. Verification: grep 'capped at 400' over README/src/spec returns only the pinned test name (tool.test.ts:208) — zero live stale hits. src/state.ts:327 is explicitly OUT of scope (P1.M3.T1.S2 owns it)."
---

## Goal

**Feature Goal**: README is internally consistent on no-caps: the Model behavior note states the goal is stored verbatim with no length limits, matching CAPS-OUT-001, the implementation, and the README's own Configuration section.

**Deliverable**: One edited sentence in `README.md` (~line 114, inside the Model behavior note paragraph). No other files.

**Success Definition**: `grep -n "capped at 400" README.md` → no hits; the sentence still correctly conveys "goal may be updated on any upsert" and the post-completion fresh-interrogation clause; `npm test` + `npm run typecheck` untouched-green (docs-only change — run them anyway as the standard gate).

## User Persona

**Target User**: Anyone (human or model) reading the README to learn the tool's guarantees.

**Use Case**: A user deciding how long their goal statement can be — the README must not promise a truncation/warning that does not exist.

**User Journey**: read the Model behavior note → sees verbatim storage, no limits, CAPS-OUT-001 citation → cross-checks the Configuration section → consistent.

**Pain Points Addressed**: Stale claim contradicts the owner ruling, the code, and the README's own config docs — a trust-eroding inconsistency (BUG-003).

## Why

- PRD h2.3 Issue 2 (BUG-003) + h2.5 recommendation: "Delete the stale 'capped at 400 characters' sentence in README.md:114".
- Architecture dossier `architecture/bug002-003-ctrlg-and-stale-caps.md` §(e) stale item 1 pinpoints the exact sentence and the contradictions.
- Verified today: the stale sentence is live at README.md:114; the implementation probe (50,000-char goal round-trips byte-identical) and the pinned tests (tool.test.ts:201/:208) confirm no cap.

## What

### The edit (exact)

Current text (README.md:113-116, verified in the current tree — the sentence spans a line break):

```
…reconciles contradictions and re-asks only the questions materially affected. The goal
statement may be updated on any upsert — it is capped at 400 characters and
truncated with a warning beyond that — and an upsert sent after completion
starts a fresh interrogation…
```

Replace ONLY the middle clause. New text:

```
…reconciles contradictions and re-asks only the questions materially affected. The goal
statement may be updated on any upsert — it is stored verbatim, with no length
limits (CAPS-OUT-001) — and an upsert sent after completion
starts a fresh interrogation…
```

- The "stored verbatim, with no length limits" phrasing deliberately echoes the Configuration section's JSONC comment (`// No caps: question count, option count, and text lengths are all unlimited — nothing is truncated or dropped (CAPS-OUT-001).`) for internal consistency, per the item contract ("reuse its phrasing/CAPS-OUT-001 citation").
- Keep byte-untouched: "The goal statement may be updated on any upsert" prefix, the trailing "and an upsert sent after completion starts a fresh interrogation (the epoch restarts at 1; its first upsert may echo the previous epoch — accepted) that completes normally" continuation, and every other sentence in the note.
- Re-wrap the paragraph only as far as the clause replacement requires (markdown prose — no lint gate on wrapping; keep the surrounding line rhythm).

### Out of scope (do not touch)

- `src/state.ts:327` — the stale `the 400-char cap (BUG-009) is enforced at the tool call-site` comment is **P1.M3.T1.S2's** deliverable. This subtask leaves it in place; its existence after this fix is expected, not a failure.
- `src/tool.test.ts:208` — "reuse upsert stores an over-400-char goal verbatim" is a PIN of the correct behavior (the test name legitimately contains "400-char"); it is not a stale reference.
- The README Configuration section, hotkey table, editor/AC-2b wording — P1.M3.T2.S1's changeset sweep owns those.
- The parallel item P1.M2.T1.S3 (note-duty ctrl+g E2E test, keymap-ac pattern) touches only `src/panel/*` tests — zero overlap.

### Success Criteria

- [ ] `grep -n "capped at 400" README.md` → no output.
- [ ] `grep -rn "capped at 400" README.md src/ spec/` → only `src/tool.test.ts:208`'s test name (a behavioral pin, kept).
- [ ] Goal-updatable + post-completion-fresh-interrogation sentences unchanged.
- [ ] `npm test` + `npm run typecheck` green (unchanged by a docs-only edit).
- [ ] `git diff` shows exactly one file: `README.md`.

## All Needed Context

### Context Completeness Check

A fresh implementer has the exact current sentence (verified), the exact replacement, the authoritative no-caps sources to cite, and the precise out-of-scope list. Nothing to research.

### Documentation & References

```yaml
- file: README.md
  why: the edit site — Model behavior note :113-116 (stale clause at :114); the Configuration section's 'No caps' JSONC comment (:~153-154, verbatim text quoted above) whose phrasing the replacement reuses
  gotcha: the paragraph wraps mid-sentence — match the surrounding prose, don't reflow the whole paragraph

- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/architecture/bug002-003-ctrlg-and-stale-caps.md
  why: §(e) stale item 1 — the dossier pinning this exact sentence, its contradictions, and the verified 50,000-char verbatim-storage probe
  section: §(e)

- file: spec/decisions.md
  why: :107 — the 2026-10-08 CAPS-OUT-001 owner ruling this fix cites

- file: spec/tool-protocol.md
  why: :68-74 'No caps' section — the FR-23 authority

- file: src/tool.test.ts
  why: :201/:208 — the pins proving verbatim storage (the :208 test name contains '400-char' and STAYS; do not 'fix' it)

- file: src/state.ts
  why: :327 — the OTHER stale reference; read to confirm you are NOT fixing it (S2's deliverable), and cite its line in the result as the handoff

- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/P1M2T1S3/PRP.md
  why: the parallel item's contract (note-duty ctrl+g E2E) — confirms zero overlap; no coordination needed
```

### Current Codebase tree (relevant excerpt)

```bash
README.md            # the single edit site (Model behavior note)
spec/decisions.md, spec/tool-protocol.md, spec/product-requirements.md  # CAPS-OUT-001 authorities (read-only)
src/tool.test.ts     # :208 behavioral pin — keep
src/state.ts         # :327 — OUT OF SCOPE (P1.M3.T1.S2)
```

### Desired Codebase tree

```bash
# No file additions. One modified file: README.md.
# Research note (optional, if evidence should be kept): research/edit-evidence.md
```

### Known Gotchas

```ts
// The '400-char' string in tool.test.ts:208 is a PIN of correct behavior —
//   grep verification must whitelist it (it is not a stale caps claim).
// Do NOT also 'helpfully' fix src/state.ts:327 — that is P1.M3.T1.S2's
//   contract; touching it here breaks the staged task split.
// Do NOT reflow/rewrite neighboring sentences — minimal-diff contract;
//   P1.M3.T2.S1 sweeps the rest of the README.
// The sentence wraps across lines 113-116; edit the clause, preserve the
//   em-dash parenthetical structure ('— it is stored verbatim, … —').
```

## Implementation Blueprint

### Data models

None — documentation-only.

### Implementation Tasks (ordered)

```yaml
Task 1: EDIT README.md:113-116 — replace the capped clause with the verbatim-storage wording (exact text in What)
Task 2: VERIFY — grep -n "capped at 400" README.md (expect empty);
        grep -rn "capped at 400" README.md src/ spec/ (expect only tool.test.ts:208's test name)
Task 3: GATE — npm test && npm run typecheck (docs-only; must stay green)
Task 4: HANDOFF — note in the result that src/state.ts:327 remains (P1.M3.T1.S2's target)
```

### Implementation Patterns & Key Details

The exact before/after text is in What — a single-clause substitution preserving the em-dash parenthetical structure.

### Integration Points

```yaml
DOCS:
  - README Model behavior note now cites CAPS-OUT-001 consistently with the Configuration section
DOWNSTREAM:
  - P1.M3.T1.S2 fixes src/state.ts:327 (the last live stale reference)
  - P1.M3.T2.S1 sweeps the rest of the README (hotkey rows, editor/AC-2b wording)
DO NOT TOUCH: src/state.ts, tool.test.ts, spec/ files, any src/ file
```

## Validation Loop

### Level 1: Syntax & Style

Not applicable — markdown prose edit; keep the surrounding wrap style.

### Level 2: Unit Tests

```bash
npm test             # green, unchanged (docs-only)
npm run typecheck    # green, unchanged
```

### Level 3: Consistency verification

```bash
grep -n "capped at 400" README.md                 # expect: no output
grep -rn "capped at 400" README.md src/ spec/ | grep -v node_modules
# expect: src/tool.test.ts:208 (behavioral pin — kept) ONLY
grep -n "CAPS-OUT-001" README.md                  # expect: ≥3 hits (note + config + deep-view contract)
```

### Level 4: Not applicable — documentation change.

## Final Validation Checklist

- [ ] `npm test` + `npm run typecheck` green
- [ ] "capped at 400" gone from README; only tool.test.ts:208's pin remains repo-wide
- [ ] Goal-updatable and fresh-interrogation sentences byte-untouched
- [ ] `git diff` = README.md only
- [ ] src/state.ts:327 left for P1.M3.T1.S2 (handoff noted)

## Anti-Patterns to Avoid

- ❌ Don't fix src/state.ts:327 or any other stale reference — staged contract; S2/S2-sweep own them
- ❌ Don't delete or rename tool.test.ts:208 — it pins the CORRECT behavior
- ❌ Don't rewrite or reflow the whole paragraph — minimal single-clause diff
- ❌ Don't restate the cap with softer wording ("very long goals…") — the fix is an unconditional no-limits statement

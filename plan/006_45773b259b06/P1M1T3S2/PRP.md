---
name: "P1.M1.T3.S2 — Final delta gate: suite/typecheck/lint green + diff confined to README.md"
description: "Verification-only subtask: run npm test / npm run typecheck / npm run lint, assert the working-tree diff touches ONLY README.md (untracked plan/006_* artifacts allowed), verify the README record content (10-default run, i/c/n unclaimed, table/sample vs config.ts), and emit a terminal delta verdict. On any failure: report as a BUG at the existing seam — NEVER rebuild or fix."
---

## Goal

**Feature Goal**: Close out the P1 docs-only changeset with a final verification gate proving three things: (ac1) the full gates are green at the working tree — `npm test`, `npm run typecheck`, `npm run lint`; (ac2) the README record is the refreshed one — keymap-conflict verification citing the 10-default run (keys.toggle, PANELTOGGLE-001), `i`/`c`/`n` verified-unclaimed columns present, keymap table and sample settings matching `src/config.ts` DEFAULT_CONFIG including the toggle; (ac3) the changeset's diff is confined to `README.md` — no code, no spec/, no plan/ writes beyond the expected untracked planning artifacts.

**Deliverable**: A terminal delta verdict (recorded in the subtask result / research notes) of the shape: `{ac1: <test/typecheck/lint results with FRESH counts>, ac2: <record-refresh findings, itemized>, ac3: <git diff --name-only result>}`. NO file modifications — this subtask is read-and-run only (research notes in `plan/006_45773b259b06/P1M1T3S2/research/` are the only writes).

**Success Definition**: All three ACs pass and the verdict is recorded; or, where an AC fails, the verdict names the failure as a BUG at the existing seam (which prior subtask's deliverable is deficient) without this agent changing anything. **Never fix, never rebuild — report.**

## Why

- The changeset (KEYMNEMONICS-001 docs sync: T1 baseline+record, T2 table/record rewrite, T3.S1 fossil sweep) claims docs-only; PRD AC-3-equivalent for this changeset is "no new code beyond the README record". The gate proves it mechanically instead of trusting it.
- The baseline figures drift: `architecture/system_context.md` records green-at-HEAD as 54 files / 1624 tests, but the PRD-delta note says those are STALE — the authoritative counts come from P1.M1.T1.S3's re-baseline (56+ test files at HEAD ec61eb1+). The gate must compare against the FRESH record, never the stale one.
- One-off flake precedent exists (system_context.md): re-run a failed gate ONCE before declaring failure.

## What

1. **Run the gates** (in order; capture full output to research notes):
   ```bash
   npm test              # expect ≥ the P1.M1.T1.S3 baseline counts (56+ test files); do NOT cite 54/1624
   npm run typecheck     # tsc --noEmit — expect zero errors
   npm run lint          # eslint src scripts *.ts — expect zero problems
   ```
   - A failed gate: re-run ONCE (flake precedent). Still failing → record as a BUG at the seam (which subtask could have caused it — for a docs-only changeset, a lint/test/typecheck failure means a PRIOR changeset's code leaked in; name it, don't touch it).
2. **Assert diff confinement (ac3)**:
   ```bash
   git diff --name-only          # must list ONLY README.md (tracked files)
   git diff --stat               # recorded in the verdict
   git status --porcelain        # untracked plan/006_* artifacts are EXPECTED and allowed;
                                 # any other untracked or modified path is a violation to REPORT
   ```
3. **Verify the record content (ac2)** — read README.md and confirm:
   - The keymap-conflict re-verification record block (research-time ~:428-504) is the REWRITTEN one (P1.M1.T2.S1): cites the 10-default run covering `keys.toggle` (PANELTOGGLE-001) — the old 5-default / `d o t m e` text (~:449-451, ~:480 at research time) must be GONE.
   - The record carries verified-unclaimed columns/claims for the mnemonic keys `i`, `c`, `n` (and the rest of the 10), not just the original set.
   - The keymap table (~:194-203) and sample settings (~:147-160) match `src/config.ts` `DEFAULT_CONFIG` exactly (P1.M1.T2.S2/S3 deliverable), including the toggle/panelShortcut row.
   - The fossil sweep (T3.S1) left zero stale letters: re-grep the README outside the record block for `` `t` ``-as-elaborate and `e`-as-chat fossils (T3.S1's table is the checklist; its post-sweep re-grep recipe is contractual). Any survivor → BUG against P1.M1.T3.S1.
   - Cross-check against `grep -n "toggle\|panelShortcut" src/config.ts` to confirm the 10th default's config name matches what the README claims.
4. **Emit the verdict** — write `plan/006_45773b259b06/P1M1T3S2/research/verdict.md` containing the JSON-shaped record plus the captured gate output tails:
   ```json
   {
     "ac1": { "test": "green (N files / M tests, baseline N0/M0)", "typecheck": "green", "lint": "green" },
     "ac2": { "record_refreshed_10_defaults": true, "icn_unclaimed_verified": true,
              "table_sample_match_config": true, "toggle_covered": true, "fossil_recheck_clean": true },
     "ac3": { "modified_files": ["README.md"], "untracked_allowed": "plan/006_* only", "violations": [] }
   }
   ```
   If anything fails, the verdict instead carries `"result": "bug"` with `seam: <subtask id>` and the evidence — and STOPS.

### Success Criteria

- [ ] All three gates run; fresh counts captured (never 54/1624); any failure re-run once, then reported as a BUG with the seam named
- [ ] `git diff --name-only` == README.md exactly; `git status --porcelain` shows no unexpected writes
- [ ] README record verified on all four content points (10-default citation, i/c/n unclaimed, table+sample vs DEFAULT_CONFIG, toggle row)
- [ ] Fossil re-grep clean outside the record block
- [ ] Verdict written to research/verdict.md; NO source/spec/README modifications made by this subtask

## All Needed Context

### Context Completeness Check

This is a run-and-verify subtask; the PRP embeds every command, the expected output shapes, the stale-baseline trap, the flake precedent, and the README verification checklist with research-time anchors. No discovery needed beyond reading the named files.

### Documentation & References

```yaml
- file: plan/006_45773b259b06/P1M1T3S1/PRP.md
  why: PREDECESSOR CONTRACT (parallel, assume landed) — the fossil sweep's checklist table (11 fossils, do-not-touch list, re-grep recipe) is this gate's ac2 fossil-recheck input
  gotcha: S1 also specifies that if the record block still shows old letters, that means T2.S1's rewrite didn't land — report, never double-edit

- file: plan/006_45773b259b06/architecture/system_context.md
  why: baseline note + flake precedent ("re-run once before declaring failure"); PRD-DELTA WARNING: its 54-files/1624-tests figures are STALE
  critical: always gate against the FRESH counts from P1.M1.T1.S3's re-baseline (56+ test files at HEAD ec61eb1+); read the plan/006_45773b259b06 P1M1T1S3 result/PRP for the exact numbers if recorded

- file: src/config.ts
  why: DEFAULT_CONFIG is the source of truth the README table/sample must match (keys.toggle / panelShortcut presence included)
  pattern: grep -n "toggle\|panelShortcut\|DEFAULT_CONFIG" src/config.ts

- file: README.md
  why: THE artifact under verification — record block (~:428-504 research-time), keymap table (~:194-203), sample settings (~:147-160), usage paragraph (~:37-38), side-chat section (~:287-301)

- file: package.json
  why: the exact gate scripts — "test": "vitest run", "typecheck": "tsc --noEmit", "lint": "eslint src scripts *.ts" (verified)
```

### Current Codebase tree (relevant slice)

```bash
README.md        # the changeset's single modified file
src/config.ts    # DEFAULT_CONFIG — verification reference (read-only)
plan/006_45773b259b06/   # untracked planning artifacts (allowed in git status)
```

### Desired Codebase tree

Unchanged — this subtask writes NOTHING to the repo (research/verdict.md under the plan dir only).

### Known Gotchas of our Codebase & Library Quirks

```bash
# CRITICAL: stale-baseline trap — never cite 54 files / 1624 tests; capture fresh numbers and compare to P1.M1.T1.S3's re-baseline
# CRITICAL: this subtask NEVER edits README.md or any file — it verifies; failures are BUG reports naming the seam (P1.M1.T2.S1/S2/S3/T3.S1 as applicable)
# Flake precedent: one failed gate → re-run ONCE; two failures → report
# git status --porcelain: untracked plan/006_* is expected; any OTHER modified/untracked path is a violation
# test counts may legitimately exceed baseline if P2/P3 changed nothing (they shouldn't — they're Planned); a count DROP below baseline is a failure to investigate, not a pass
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: RUN the gates, capture outputs
  - npm test > research/test-output.txt (or tail into notes); record file/test counts
  - npm run typecheck; npm run lint — record exit codes
  - On failure: re-run once; still failing → skip to Task 4 with result "bug" + seam

Task 2: ASSERT diff confinement
  - git diff --name-only → must equal ["README.md"]
  - git status --porcelain → only README.md modified + untracked plan/006_*
  - Violation → Task 4 with the offending path(s) listed

Task 3: VERIFY README record content (ac2 checklist)
  - Record block is the rewritten 10-default version (PANELTOGGLE-001 / keys.toggle cited; no "d o t m e" residue)
  - i/c/n verified-unclaimed present; keymap table + sample settings == DEFAULT_CONFIG (incl. toggle/panelShortcut)
  - Fossil re-grep per T3.S1's recipe — zero stale hits outside the record block
  - Any miss → BUG against the owning subtask (T2.S1/T2.S2/T2.S3/T3.S1)

Task 4: WRITE research/verdict.md (the JSON-shaped record) and finish
```

### Implementation Patterns & Key Details

```bash
# Fresh-count extraction (vitest run prints per-file suites + a summary line):
npm test 2>&1 | tail -20    # record the "Test Files" / "Tests" summary verbatim in the verdict
```

### Integration Points

```yaml
NO code, config, schema, or doc changes — verification only.
CONSUMERS: the P1 changeset's closing record; P2.M1.T1.S1 (conformance inventory) builds its own gate run AFTER this verdict and must NOT reuse this one's counts (it re-runs at its own HEAD).
```

## Validation Loop

### Level 1: Syntax & Style
N/A — no files written to the repo.

### Level 2: Unit Tests
This IS the test run (Task 1).

### Level 3: Integration Testing
N/A — the git-diff assertion (Task 2) is the integration check.

### Level 4: Verdict
research/verdict.md written; subtask result summarizes pass/bug.

## Final Validation Checklist

- [ ] Gates run with fresh counts recorded; flake re-run honored at most once
- [ ] Diff == README.md only; no unexpected untracked paths
- [ ] README record verified (10-default run cited, i/c/n unclaimed, table/sample == config.ts, toggle covered)
- [ ] Fossil re-grep clean outside the record block
- [ ] verdict.md written; zero repo modifications by this subtask
- [ ] Any failure reported as a BUG with the seam named — nothing "fixed"

---

## Anti-Patterns to Avoid

- ❌ Don't edit ANY file to make a gate pass — this is a verification gate; failures are reports
- ❌ Don't cite the stale 54/1624 baseline — fresh counts only, vs P1.M1.T1.S3's re-baseline
- ❌ Don't re-run a failing gate more than once (flake precedent is one retry, not a loop)
- ❌ Don't double-edit or "helpfully finish" the record block if T2.S1's rewrite is absent — report the miss
- ❌ Don't treat dropped test counts as a pass — investigate and report
- ❌ Don't conflate this verdict with P2's future gate run — each changeset re-verifies at its own tree

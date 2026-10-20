# PRP — P1.M1.T2.S1: Rewrite the keymap-conflict re-verification record block (README.md:428-504)

## Goal

**Feature Goal**: Refresh README's keymap-conflict re-verification record (README.md:428-504) to the KEYMNEMONICS-001 defaults (`d`/`i`/`e`/`n`/`c`) using P1.M1.T1.S2's fresh `VerificationRecord` — every fact (date, commit, pi version, per-key statuses, drift findings) comes from that run; nothing is copied forward from the 2026-10-16 record.

**Deliverable**: Edited README.md, changes confined to lines 428-504. Docs-only — no code, no tests, no spec/ or plan/ edits.

**Success Definition**:
- Header cites the fresh run date (post-2026-10-16), the ACTUAL verified HEAD sha (from `git rev-parse`, per S1's record — expect `eb09516`), the pi version from the run, and the method line unchanged (`bash scripts/verify-keymap-conflicts.sh`, exit 0, all 9 defaults clear)
- Per-key table rows show `d`/`i`/`e`/`n`/`c` (labels deep/overview/elaborate/batchNote/chat) with the fresh statuses; the :480 letter set reads "(`d` `i` `e` `n` `c`)"
- The stale :437 claim ("`e` unchanged — passes untouched") replaced with the panel-owned-by-construction statement for the five letters
- Drift prose re-derived from the fresh grep output (not the old sentence); pi-subagents variable-indirect note kept only if still true per the record
- Rows :448, :453-456 and the avoided-keys table :466-475 unchanged; block format preserved (intro → verified-defaults table → fixed-keys prose → avoided-keys table → regression-guard)

## Why

Spec h2.36: "Dev agent must re-verify at build time and record findings." KEYMNEMONICS-001 changed three defaults (`i`, `c`, `n` replacing the `o`/`t`/`m` set; `e` re-targeted from discuss/chat to elaborate), so the README record still cites 2026-10-16 / `378b9ee` and shows the pre-mnemonic letters — the block is the shipped evidence that the new defaults collide with nothing, and it currently documents the wrong keymap. S1 ran the verification; this subtask transcribes it.

## What

Edit ONLY within README.md:428-504:

1. **Header/intro (:428-437)**: fresh date, HEAD sha from the record (expected `eb09516` — the KEYMNEMONICS-001 changeset; if the record's actual hash differs, the RECORD wins), pi version, method line. Replace the "`e` unchanged — passes untouched" clause: all five bare letters are panel-owned by construction (bare keys never intercept in editor focus; no global claim possible).
2. **Per-key rows (:448-452)**: `d` (deep) / `i` (overview) / `e` (elaborate) / `n` (batchNote) / `c` (chat) — status + evidence from the record's perKeyStatus (bare-letter construction text remains valid; only letters/actions change). Config field names stay `keys.overview` etc. (KEYMNEMONICS-001 moved letters, not names — do not "fix" names to match letters).
3. **Letter set (:480)**: `(`d` `i` `e` `n` `c`)` in the panel-intercept rationale.
4. **Drift prose (:438-441)**: re-derive from the record's driftSince20261016 — expected "none; only pi-patty-bg-tasks' five (src/shortcuts.ts:28-49)"; keep the pi-subagents variable-indirect/manual-check sentence only if the record confirms it. Baseline phrase: "since the 2026-10-16 record".
5. **Unchanged**: `d` row wording, ctrl+s/ctrl+g/tab/shift+tab rows (:453-456), fixed-keys prose, avoided-keys table (:466-475), regression-guard section.

**Stop condition**: if S1's record shows a non-empty drift (a new source registration touching a default) or non-zero exit — that is S1's ruling-level BUG protocol; do NOT write a clean record around it. Report and stop.

### Success Criteria

- [ ] `git diff` confined to README.md, hunks within 428-504
- [ ] Every factual claim traceable to S1's VerificationRecord (date/commit/pi/statuses/drift)
- [ ] No `o`/`t`/`m`-as-default letters remain in the block; letter set updated; "e unchanged" clause gone
- [ ] Avoided-keys table, fixed-keys prose, regression-guard, and correct rows byte-identical
- [ ] spec/ and plan/ untouched

## All Needed Context

### Context Completeness Check

Docs-only edit with the full stale block read and every stale/fresh line identified in the research notes. Agent needs this PRP plus README.md:425-505, S1's delivered VerificationRecord, and read access to `src/config.ts` DEFAULT_CONFIG (to sanity-check letters) — nothing else.

### Documentation & References

```yaml
- file: plan/006_45773b259b06/architecture/keymap-verification-and-readme-drift.md
  why: "THE drift inventory — exact stale line numbers (430/437/449-452/480) and confirmed-correct rows (448, 453-456, 466-475)"

- file: plan/006_45773b259b06/P1M1T1S2/PRP.md
  why: "CONTRACT for the VerificationRecord shape {date, headCommit, piVersion, perKeyStatus[9], driftSince20261016, exitCode:0}; expected values (2026-10-20, eb09516, pi 1.0.2, drift empty) — RECORD wins over any expectation"

- file: plan/006_45773b259b06/P1M1T2S1/research/notes.md
  why: line-by-line edit checklist + what stays verbatim

- file: README.md
  why: "the ONLY file edited; block :428-504 (heading :428, next heading :505)"
  gotcha: "if you need more than ±3 lines of context beyond the block, you are editing outside scope — stop"

- docfile: spec h2.36 (hotkey table, authoritative letters d/i/e/n/c) + h2.83 (KEYMNEMONICS-001) — in this PRP's task prompt
  gotcha: "spec/'s own stale AC-2b/M8 `t` prose is DECLARED stale — never cite or 'fix' toward it"
```

### Current/Derived Codebase tree

```bash
README.md   # MODIFY: lines 428-504 only
```

### Known Gotchas

```text
# CRITICAL: the record's ACTUAL headCommit wins — the item contract's "expect
#   7377318" is stale (S1's PRP already flags eb09516 as expected). Never
#   hand-copy a sha that isn't in the record.
# CRITICAL: do not rename config fields — keys.overview stays keys.overview
#   with default `i` (letters moved, names did not).
# GOTCHA: keep the block's five-part format; this edit refreshes facts, not
#   structure. The regression-guard section is timeless — untouched.
# GOTCHA: docs-only — run nothing that writes; `npm test`/typecheck unaffected
#   (T3.S2 owns the final gate, which must show a README-only diff).
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: READ S1's VerificationRecord + README.md:425-505 (slice only)
Task 2: EDIT header/intro — fresh date/commit/pi + KEYMNEMONICS-001 framing;
  drop the "e unchanged" clause; panel-owned-by-construction statement
Task 3: EDIT the five bare-letter rows (d/i/e/n/c) + the :480 letter set
Task 4: RE-DERIVE the drift prose from driftSince20261016 (keep the
  pi-subagents manual-check sentence only if confirmed)
Task 5: VERIFY — git diff confined to README.md within 428-504; grep the block
  for ' o (', ' t (', ' m (' default rows and 'unchanged' → zero hits;
  correct rows byte-identical
```

### Implementation Patterns & Key Details

```markdown
# Row shape (keep): | `i` (`overview`) | panel-owned | bare letter — same
#   construction: collides with nothing in pi's or extensions' global vocabulary |
```

### Integration Points

```yaml
UPSTREAM: "P1.M1.T1.S2 VerificationRecord — sole fact source"
DOWNSTREAM: "P1.M1.T2.S2 cross-checks the keymap table/sample settings against config.ts; P1.M1.T3.S1 sweeps remaining fossils; P1.M1.T3.S2 verifies README-only diff"
NO CHANGES to: scripts/, src/, spec/, plan/
```

## Validation Loop

```bash
git diff --stat                 # README.md only
git diff README.md | head -80   # hunks within 428-504
sed -n '428,504p' README.md | grep -nE '`o` \(`overview`\)|`t` \(`elaborate`\)|`m` \(`batchNote`\)|unchanged — passes'   # expect no hits
```

## Final Validation Checklist

- [ ] Diff confined to README.md:428-504; all facts from the record; stale letters/clauses gone; correct sections byte-identical
- [ ] Format preserved; no spec/ or plan/ edits; no code touched

## Anti-Patterns to Avoid

- ❌ Don't copy the old drift sentence or the 2026-10-16 header facts forward
- ❌ Don't rename config fields to match letters
- ❌ Don't touch the avoided-keys table, correct rows, or regression guard
- ❌ Don't cite or "align to" spec/'s known-stale `t` prose
- ❌ Don't write a clean record if S1 reported drift/exit≠0 — stop and report

---

**Confidence Score**: 10/10 — docs-only edit; the full block was read, every stale and correct line is inventoried, and the fact source (S1's record) is a verified contract.

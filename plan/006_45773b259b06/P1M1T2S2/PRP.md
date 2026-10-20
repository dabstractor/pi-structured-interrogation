# PRP — P1.M1.T2.S2: Cross-check README keymap table and sample settings against config.ts defaults

## Goal

**Feature Goal**: Perform the PRD-mandated (AC-2, h2.36 "record findings") three-way cross-check of the 9 keymap defaults across README surfaces — the sample settings block (`README.md:147-179`, key lines `:152-160`), the keymap table rows (`:194-203`), and the refreshed keymap-conflict record block's per-key rows (delivered by S1) — against `DEFAULT_CONFIG.keys` (`src/config.ts:118-128`), fixing any drift in place in README.md only. Research verdict (verified this session): **9/9 match expected — verification no-op is the likely outcome**; the check is contractual regardless.

**Deliverable**: Per-action match verdict (9 rows) consumed by P1.M1.T3.S1; corrections to README.md only if drift is found. Docs-only — no code, no tests, no spec/ or plan/ edits.

**Success Definition**:
- All 9 actions verified against `src/config.ts` with each surface checked: deep `d`, overview `i`, elaborate `e`, batchNote `n`, submit `ctrl+s`, chat `c`, externalEditor `ctrl+g`, prevQuestion `tab`, nextQuestion `shift+tab`
- Any drift corrected in README.md (in place); if none: "none — verification confirmed no user-facing change" is the Docs deliverable
- `git diff` confined to README.md (and possibly empty); no spec/, plan/, or src/ changes

## Why

KEYMNEMONICS-001 (h2.83) moved the bare-letter defaults to mnemonics (`d`/`i`/`e`/`n`/`c`) — three changes plus the `e` re-target from discuss/chat to elaborate. README is the shipped user-facing reference for the keymap; the changeset's docs sync (this delta) must prove every README surface states the same defaults the code ships. The earlier verification research (architecture doc) already found the two main surfaces matching, but AC-2 requires the recorded cross-check, and S1's freshly rewritten record block adds a third surface that must agree.

## What

1. Read `DEFAULT_CONFIG.keys` from `src/config.ts:118-128` (the source of truth).
2. For each of the 9 actions, compare three README surfaces:
   - keymap table Default column (`:195-203` row by row)
   - sample settings values (`:152-160`)
   - the record block's per-key table (S1's output in `:428-504`) — verify only, do not edit that block (S1 owns it; if IT drifted, report to S1's contract rather than double-editing mid-flight)
3. Check the config FIELD NAMES too: `keys.overview`/`keys.chat` keep their historical names with new letters (KEYMNEMONICS-001: "Config-field names do not move") — a README "fix" that renames fields to match letters would be a bug, not a fix.
4. Fix any drift in place, README.md only (sample block or keymap table — NOT the record block).
5. Docs deliverable: Mode A note in the subtask result — either the per-row drift fixes, or "none — verification confirmed no user-facing change".

### Success Criteria

- [ ] 9-row verdict matrix produced (action × {config.ts, sample settings, keymap table, record block} → match)
- [ ] Drift (if any) corrected in README.md only, in the sample-block/keymap-table hunks
- [ ] Accelerator spelling matches pi's lowercase form verbatim (`ctrl+s`, `shift+tab` — not `Ctrl+S`/`Shift+Tab`, per the KEYMNEMONICS-001 lowercase amendment h2.83 for the sample-settings values; the keymap table's Default column also reads lowercase)
- [ ] Config field names unchanged everywhere (`keys.overview`, `keys.chat`…)
- [ ] `git diff` shows README.md at most; spec/, plan/, src/ untouched; suite/typecheck/lint still green (docs-only, but P1.M1.T3.S2 runs the final gate — a quick `npm test` sanity is enough here)

## All Needed Context

### Context Completeness Check

Docs-only. This PRP contains the verified current values of all three surfaces (research notes hold the full comparison). Agent needs this PRP plus `README.md:145-205` and `:425-505`, and read access to `src/config.ts:110-130`.

### Documentation & References

```yaml
- file: plan/006_45773b259b06/architecture/keymap-verification-and-readme-drift.md
  why: "THE research doc — research verdict that sample settings (:152-160) and keymap table (:194-203) already match DEFAULT_CONFIG; the fresh verified per-key run output (d/i/e/n/c all ok)"
  critical: "expected outcome is a no-op — do not 'find' drift that isn't there; report honestly"

- file: plan/006_45773b259b06/P1M1T2S2/research/notes.md
  why: the full 3-way comparison as verified this session, including the S1-hunk disjointness note

- file: plan/006_45773b259b06/P1M1T2S1/PRP.md
  why: "CONTRACT (parallel, Implementing): S1 rewrites README:428-504 (the record block) — disjoint from S2's hunks (:152-160/:194-203). Verify the record block's per-key rows against S1's delivered text; if the record block itself drifted, that's S1's fix, not yours"
  gotcha: "verify against the POST-S1 README (or coordinate) — a mid-flight record block is not drift"

- file: src/config.ts
  why: "DEFAULT_CONFIG.keys :118-128 — the source of truth; deep d, overview i, elaborate e, batchNote n, submit ctrl+s, chat c, externalEditor ctrl+g, prevQuestion tab, nextQuestion shift+tab"

- file: README.md
  why: "sample settings :147-179 (keys :152-160), keymap table :194-203; read-only elsewhere"

- docfile: PRD h2.36 (hotkey table — note its inline residue line 'bare-letter defaults (`d` `o` `t` `m` `e`…)' is a SPEC fossil, not README's — do NOT port it), h2.58 (config reference), h2.83 (KEYMNEMONICS-001 + lowercase amendment) — spec is READ-ONLY; scope is README only
```

### Current Codebase tree (relevant excerpt)

```bash
README.md      # at most: fix drift in :152-160 / :194-203 (expected: no edit)
src/config.ts  # READ-ONLY reference
```

### Known Gotchas of our Codebase & Library Quirks

```text
# CRITICAL: config FIELD NAMES do not move (h2.83): keys.overview (default i),
#   keys.chat (default c) — a README "correction" renaming fields to match the
#   new letters is a BUG. Only VALUES are cross-checked.
# CRITICAL: the PRD h2.36 section itself contains a fossil line ("bare-letter
#   defaults (`d` `o` `t` `m` `e`…)") — that is spec text, READ-ONLY, and NOT
#   evidence of README drift. Compare against src/config.ts, never against the
#   spec prose.
# GOTCHA: lowercase verbatim accelerators everywhere in the edited surfaces
#   (KEYMNEMONICS-001 amendment — capitalized letters imply shift).
# GOTCHA: S1 edits :428-504 concurrently — your hunks are disjoint; verify the
#   record block only after S1's text is present (or skip-edit it and just
#   note the verdict if S1 hasn't landed).
# GOTCHA: "no diff" is a SUCCESS outcome — do not invent edits to justify the
#   subtask; the verdict matrix is the deliverable.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EXTRACT the source of truth
  - sed -n '110,132p' src/config.ts → the 9 defaults; note field names + values

Task 2: BUILD the 9×3 verdict matrix
  - For each action (deep, overview, elaborate, batchNote, submit, chat,
    externalEditor, prevQuestion, nextQuestion):
      row = { action, configField, configValue,
              sampleSettings (:152-160), keymapTable (:194-203), recordBlock (:428-504) }
  - Compare VALUE + spelling (lowercase) + config FIELD NAME consistency

Task 3: FIX drift (if any) in README.md
  - Only :152-160 (sample values) or :194-203 (table Default column) hunks
  - Record block drift → report to S1's contract; do not edit :428-504
  - If 9/9 match: no edit; note "none — verification confirmed no user-facing change"

Task 4: SANITY gates
  - git diff --name-only → README.md at most
  - npm test (docs-only sanity; P1.M1.T3.S2 runs the final full gate)

Task 5: REPORT the per-action verdict consumed by P1.M1.T3.S1
```

### Implementation Patterns & Key Details

```text
Expected matrix (verified this session — confirm, don't copy blindly):
  deep           keys.deep           d           3× match
  overview       keys.overview      i           3× match
  elaborate      keys.elaborate     e           3× match
  batchNote      keys.batchNote     n           3× match
  submit         keys.submit        ctrl+s      3× match
  chat           keys.chat          c           3× match
  externalEditor keys.externalEditor ctrl+g     3× match
  prevQuestion   keys.prevQuestion  tab         3× match
  nextQuestion   keys.nextQuestion  shift+tab   3× match
```

### Integration Points

```yaml
UPSTREAM (contract, parallel): P1.M1.T2.S1 — owns README:428-504; disjoint hunks
UPSTREAM (complete): P1.M1.T1.S2 — the fresh VerificationRecord the record block cites
DOWNSTREAM: P1.M1.T3.S1 (stale-fossil sweep) consumes the verdict matrix; P1.M1.T3.S2
  runs the final gate and confirms diff confinement
NO CHANGES to: src/, spec/, plan/, scripts/
```

## Validation Loop

### Level 1-2: (docs-only — trivial gates)

```bash
npm run typecheck && npm test   # sanity; unaffected expected
```

### Level 3: Cross-check itself

```bash
sed -n '110,132p' src/config.ts      # source of truth
sed -n '147,179p' README.md          # sample settings
sed -n '190,205p' README.md          # keymap table
sed -n '428,504p' README.md          # record block (post-S1) — verify only
grep -n '"ctrl+s"\|"shift+tab"\|"ctrl+g"' README.md   # lowercase spelling sweep
```

### Level 4: Domain validation

- [ ] Verdict matrix produced and honest (no-op allowed and expected)
- [ ] `git diff --name-only` → README.md at most; hunks within :152-160/:194-203
- [ ] No field-name "corrections"; no capital letters introduced; record block untouched

## Final Validation Checklist

- [ ] 9/9 per-action verdict recorded (expected all-match)
- [ ] Any real drift fixed in README.md only; else explicitly "none — verification confirmed no user-facing change"
- [ ] Config field names, lowercase spelling, and S1's record block untouched by this subtask
- [ ] spec/, plan/, src/ untouched; suite green

## Anti-Patterns to Avoid

- ❌ Don't invent drift to justify the subtask — the verdict matrix IS the deliverable
- ❌ Don't rename config fields to match the new letters — KEYMNEMONICS-001 moved values, not names
- ❌ Don't edit the record block (:428-504) — S1's parallel scope
- ❌ Don't port the PRD h2.36 fossil letters (`o`/`t`/`m`) into README, or treat them as the target
- ❌ Don't introduce capitalized key spellings — the h2.83 lowercase amendment is binding

---

**Confidence Score**: 10/10 — all three surfaces read line-exact this session; the comparison is mechanical; the only moving part (S1's record block) is explicitly out of edit scope.

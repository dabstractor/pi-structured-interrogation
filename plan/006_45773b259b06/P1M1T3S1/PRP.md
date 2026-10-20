---
name: "README stale key-fossil sweep — changeset-level consistency with KEYMNEMONICS-001"
description: "Docs-only: fix the eleven listed README.md fossils outside the record block (elaborate t→e ×6, chat e→c ×5, one bare-key set rewrite), re-grep to zero stale hits, leave the already-correct surfaces and the DO-NOT-TOUCH list untouched. README.md only."
---

## Goal

**Feature Goal**: Make README.md fully consistent with the KEYMNEMONICS-001 changeset (`d` deep · `i` list · `e` explain · `n` note · `c` chat; `ctrl+s`/`ctrl+g` unchanged) by fixing every stale key fossil OUTSIDE the keymap-conflict record block, preserving sentence meaning at each site. After the sweep, a re-grep finds zero stale hits outside the DO-NOT-TOUCH list, and the usage paragraph (:37-38) and side-chat section (:287-301) read correctly with the new letters.

**Deliverable**: Modified `README.md` only — eleven fossil fixes (line numbers as of research time; re-locate by text if S1/S2 landed and shifted lines). No code, no tests, no spec/ or plan/ edits.

**Success Definition**: `git diff --name-only` shows only README.md; every fossil in the table below fixed with meaning preserved; re-grep clean; full `npm test`/`typecheck` untouched-and-green (docs-only, run once as sanity); P1.M1.T3.S2 (final delta gate) receives a consistent README.

## User Persona (if applicable)

**Target User**: A pi user reading the README to learn the panel's keys.

**Use Case**: "How do I attach an explanation to my answer?" — the README must say `e`, not the pre-changeset `t`; "how do I open the side chat?" — `c`, not the inherited `e`.

**User Journey**: User reads the usage paragraph → presses `e` to explain, `c` to chat → the keys do what the README said.

**Pain Points Addressed**: README currently teaches two dead keys (`t` elaborate, `e` chat) and one stale bare-key set — every reader following it hits wrong behavior (`e` now opens explain, `t` just types).

## Why

- KEYMNEMONICS-001 (h2.83) moved the defaults to mnemonics; S1 (record block, Complete) and S2 (table/sample cross-check) covered the structured surfaces, but prose throughout the README still carries the old letters — the changeset's docs sync is incomplete until they're gone.
- README is the repo's only overview doc (no docs/ directory) and the shipped user-facing keymap reference; inconsistency between its prose and `DEFAULT_CONFIG` is a user-facing bug, not cosmetics.
- The final delta gate (P1.M1.T3.S2) requires the diff confined to README.md with the changeset coherent — this sweep is its prerequisite.

## What

Fix each fossil below (text-anchored; line numbers from research time). Preserve sentence meaning; change ONLY the key letter/set.

**Elaborate `t` → `e` (6 sites):**

| Anchor (search text) | Current | Fixed |
|---|---|---|
| ~:45 "re-pressed `` `t` `` just types the letter" | `` `t` `` | `` `e` `` |
| ~:50 "in the write-in duty — `` `t` `` is not the only entry" | `` `t` `` | `` `e` `` |
| ~:83 "the elaborations you attached with `` `t` ``" | `` `t` `` | `` `e` `` |
| ~:263 "Bare config keys (`d`, `o`, `t`, `m`, `e`)" | `d`,`o`,`t`,`m`,`e` | (`d`, `i`, `e`, `n`, `c`) |
| ~:265-266 "typing `` `t` `` in an answer must insert a `` `t` ``" | `` `t` ``…`` `t` `` | `` `e` ``…an `` `e` `` |
| ~:358 AC 2b row "`` `t` ``, type, `` `enter` ``" | `` `t` `` | `` `e` `` |

**Chat `e` → `c` (5 sites — side-chat prose predates KEYMNEMONICS-001; `e` was discuss→chat before it became explain):**

| Anchor (search text) | Current | Fixed |
|---|---|---|
| ~:296 "Like every bare key, `` `e` `` works from non-editor focus" | `` `e` `` | `` `c` `` |
| ~:301 "Opening `` `e` `` on another question aborts the…" | `` `e` `` | `` `c` `` |
| ~:340 "pressing `` `e` `` again re-focuses the chat input" | `` `e` `` | `` `c` `` |
| ~:375 AC 17 "`` `e` `` opens the per-question in-panel chat" | `` `e` `` | `` `c` `` |
| ~:393 "in non-TUI modes `` `e` `` is inert" | `` `e` `` | `` `c` `` |

**Do NOT touch:**
- Already-correct surfaces: usage paragraph ~:37-38 (`d`/`i`/`e` correct), ~:288 ("Press `c`…"), ~:297 ("`keys.chat` (default `c`)"), keymap table ~:194-203, sample settings ~:147-160 — churn here is a defect, not a fix.
- The keymap-conflict record block (~:428-504) — S1's deliverable. Research-time state shows old letters at ~:449-451 (`o`/`t`/`m` rows) and ~:480 ("`d` `o` `t` `m` `e`") inside it; if still present at implementation time, S1's rewrite hasn't landed — VERIFY and REPORT in the subtask result; never double-edit that block.
- `spec/*.md` (declared stale prose, human-owned) and `plan/004_*/architecture/*.md` (past-changeset history).

**Post-sweep verification (contractual):** re-grep until zero stale hits outside DO-NOT-TOUCH (recipe below), then read the usage paragraph and the side-chat section end-to-end to confirm they flow with the new letters.

### Success Criteria

- [ ] All 11 fossil sites fixed with sentence meaning preserved
- [ ] Re-grep clean: no `` `t` ``/`` `o` ``/`` `m` `` prose fossils and no chat-`e` phrasing outside the record block
- [ ] Already-correct surfaces byte-unchanged
- [ ] `git diff --name-only` ⊆ {README.md}
- [ ] Record-block state (if stale letters remained) reported, not edited

## All Needed Context

### Context Completeness Check

Every fossil is quoted verbatim with its search anchor, current text, and fixed text; the canonical set, the boundaries (record block, spec/, plan/), and the re-grep recipe are all embedded. An agent needs this PRP plus README.md — nothing else.

### Documentation & References

```yaml
- docfile: plan/006_45773b259b06/architecture/keymap-verification-and-readme-drift.md
  why: "THE source — §fossils lists every site (verified this session against the live README); §DO-NOT-TOUCH defines the boundaries"
  section: "README fossils OUTSIDE the record block"

- file: README.md
  why: "the ONLY file to edit — 11 sites, text-anchored (line numbers drift if S1/S2 landed first; relocate by the quoted search text)"
  gotcha: ":288/:297 already say `c` — do not churn; the record block (~:428-504) is S1's, report-don't-edit"

- docfile: plan/006_45773b259b06/prd_snapshot.md §h2.83 (KEYMNEMONICS-001)
  why: "the canonical ruling — d deep / i list / e explain / n note / c chat; config FIELD names do not move (a README 'fix' renaming keys.overview would be a bug)"

- file: plan/006_45773b259b06/P1M1T2S2/PRP.md
  why: "PREDECESSOR CONTRACT (in flight): table/sample cross-check against DEFAULT_CONFIG — establishes the canonical set this sweep assumes; also confirms S1's record-block ownership"

- file: plan/006_45773b259b06/P1M1T3S1/research/notes.md
  why: "verified live-README excerpts of every site + the re-grep recipes — this PRP's evidence base"
```

### Current Codebase tree (relevant slice)

```bash
README.md   # the only file edited (11 sites)
src/config.ts  # read-only reference for DEFAULT_CONFIG letters (via S2's cross-check)
```

### Desired Codebase tree

```bash
# No structural change — README.md content edits only.
```

### Known Gotchas of our Codebase & Library Quirks

```markdown
# CRITICAL: line numbers in the tables are research-time; S1/S2 land in parallel — RE-LOCATE each site by its quoted anchor text, not the line number.
# CRITICAL: `e` is DOUBLE-LOADED in this sweep — elaborate prose gains `e` while chat prose LOSES it. Read each site's context before editing; a blind search-replace of `t`→`e` or `e`→`c` corrupts both families.
# The bare-key-set line (~:263) changes ALL FIVE letters (o→i, t→e, m→n, e→c) — order the rewrite as a set, not per letter.
# Config field names never change: keys.overview/i, keys.chat/c, keys.elaborate/e, keys.batchNote/n (KEYMNEMONICS-001: "Config-field names do not move").
# spec/ fossils (product-requirements.md:84, implementation-plan.md:29, ui-spec.md:94/:135) are DECLARED stale and human-owned — editing them violates the item contract.
```

## Implementation Blueprint

### Data models and structure

None — docs-only.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: RE-LOCATE the 11 sites
  - RUN: grep -n 're-pressed\|is not the only entry\|attached with\|Bare config keys\|in an answer must insert\|AC 2b\|Like every bare key\|Opening.*on another question\|re-focuses the chat input\|opens the per-question\|is inert' README.md
  - MAP each hit to the fix table; note any S1/S2 line drift

Task 2: EDIT elaborate family (6 sites)
  - APPLY the t→e fixes per table (each in its own sentence context; preserve meaning verbatim)
  - The :263 set rewrite: (`d`, `o`, `t`, `m`, `e`) → (`d`, `i`, `e`, `n`, `c`) — the whole tuple in one edit
  - The :265-266 pair: "typing `e` in an answer must insert an `e`" (grammar: "an `e`")

Task 3: EDIT chat family (5 sites)
  - APPLY the e→c fixes per table; read each sentence first — :296/:301/:340/:375/:393 all describe the CHAT key

Task 4: RE-GREP TO ZERO (contractual)
  - RUN: grep -n '`t`\|`o`\|`m`' README.md | grep -v 'ctrl\|shift'   → expect only record-block rows (~:449-451, ~:480)
  - RUN: grep -n '`e` opens\|`e` works\|`e` on\|`e` again\|`e` is inert\|bare.*`e`' README.md → expect no matches
  - IF record-block rows still show old letters: REPORT in the subtask result (S1's block), do NOT edit

Task 5: READ-THROUGH + GATE PREP
  - READ the usage paragraph (~:37-38) and side-chat section (~:287-301) end-to-end — confirm flow with new letters
  - RUN: git diff --name-only → must be README.md only
  - SANITY: npm test && npm run typecheck (untouched, must stay green)
```

### Implementation Patterns & Key Details

```markdown
# Each edit is surgical: quote-anchored letter substitution inside an unchanged sentence.
# The two families share the letter `e` across the sweep — elaborate prose ENDS with `e`,
# chat prose STARTS with `e` (being replaced by `c`). Never batch-replace; edit per site.
```

### Integration Points

```yaml
CONSUMED:
  - "Canonical set d/i/e/n/c established by P1.M1.T2.S1 (record block) + P1.M1.T2.S2 (table/sample cross-check)"
CONSUMED-BY:
  - "P1.M1.T3.S2 final delta gate — expects diff confined to README.md and a coherent changeset"
DO-NOT-TOUCH:
  - "record block ~:428-504 (S1), spec/ (human-owned), plan/004_* (history), already-correct surfaces (:37-38, :288, :297, :194-203, :147-160)"
```

## Validation Loop

### Level 1: Syntax & Style

Not applicable (Markdown prose).

### Level 2: Unit Tests

```bash
npm test && npm run typecheck   # sanity only — docs change must leave both green
```

### Level 3: Integration Testing

Not applicable — docs-only.

### Level 4: Creative & Domain-Specific Validation

```bash
# The contractual re-grep (zero stale hits outside DO-NOT-TOUCH):
grep -n '`t`\|`o`\|`m`' README.md | grep -v 'ctrl\|shift'
grep -n '`e` opens\|`e` works\|`e` on\|`e` again\|`e` is inert\|bare.*`e`' README.md
grep -n '`c`' README.md            # the five chat sites now read c; :288/:297 untouched
git diff --name-only               # README.md only
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm test` + `npm run typecheck` green (untouched)
- [ ] `git diff --name-only` ⊆ {README.md}

### Feature Validation

- [ ] All 11 fossil sites fixed; sentence meaning preserved at each
- [ ] Re-grep clean outside DO-NOT-TOUCH
- [ ] Bare-key set reads (`d`, `i`, `e`, `n`, `c`)
- [ ] Usage paragraph + side-chat section read correctly end-to-end
- [ ] Record-block staleness (if any) reported, not edited

### Code Quality Validation

- [ ] Already-correct surfaces byte-unchanged
- [ ] No spec/, plan/, or src/ edits; no field-name "fixes" (keys.overview keeps its name)

### Documentation & Deployment

- [ ] [Mode B] this sweep IS the changeset-level doc sync for prose; result records the 11 sites + any record-block report

---

## Anti-Patterns to Avoid

- ❌ Don't blind search-replace `t`→`e` or `e`→`c` — the two families cross-load `e`; edit per site with context read
- ❌ Don't touch the record block even if it still shows old letters — report to S1's contract instead
- ❌ Don't "improve" the already-correct surfaces (:37-38, :288, :297, table, sample) — churn is a defect
- ❌ Don't rename config fields to match letters (keys.overview stays with default `i`) — KEYMNEMONICS-001 forbids it
- ❌ Don't edit spec/ or plan/004_* — the PRD declares those fossils stale and human-owned/historical
- ❌ Don't fix line numbers by trusting this PRP blindly — re-locate every site by its quoted anchor (S1/S2 land in parallel)

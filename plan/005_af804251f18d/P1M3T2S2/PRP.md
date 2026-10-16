# PRP — P1.M3.T2.S2: Full gates — suite, typecheck, lint, keymap-conflict re-verification

---
name: "P1.M3.T2.S2 — full gate sweep (side-chat changeset 005_af804251f18d)"
description: "Run and fix until green every gate over the complete integrated changeset (P1.M1 engine/config + P1.M2 view/integration/discuss-removal + P1.M3.T1.S1 cache-isolation guard + P1.M3.T2.S1's AC-17 suite, implementing in parallel): (1) npm test — full vitest suite incl. the renamed keymap suites (keys.test.ts, keymap-ac.test.ts, keymap-guard.test.ts exhaustiveness over the chat action) and the new sidechat/ac-sidechat/cache-isolation files; (2) npm run typecheck; (3) npm run lint (eslint over src, scripts, *.ts — catches leftover discuss references, unused imports from the deletion, new-file style); (4) bash scripts/verify-keymap-conflicts.sh — expected: `e` unchanged, passes untouched (bare panel-owned letter, no AVOIDED entry, no live claim), exit 0. Plus the discuss residual grep gate (final state: `discuss` appears ONLY at the coerceKeys alias in config.ts). Output: green gates + a dated conflict-run record (research/keymap-run-record.md) consumed by P1.M3.T3.S1's README refresh. No docs written here."
---

## Goal

**Feature Goal**: Every gate is green over the fully integrated side-chat changeset, and the keymap-conflict verification is re-run and recorded so P1.M3.T3.S1 can refresh the README's `### Keymap conflict re-verification` section with a real run.

**Deliverable**: (1) Fixes (where needed) to make `npm test`, `npm run typecheck`, `npm run lint`, and `bash scripts/verify-keymap-conflicts.sh` all exit 0. (2) `plan/005_af804251f18d/P1M3T2S2/research/keymap-run-record.md` — date, command, exit code, the `e`-unchanged note, any findings. (3) `research/gate-sweep.md` — per-gate run results and every fix made (file, reason, subtask traced).

**Success Definition**: All four gates exit 0 in one final consecutive run; the discuss residual grep shows only the config.ts coerceKeys alias; the keymap run record exists with the expected-unchanged note; no new failures introduced for P1.M3.T3.* to inherit.

## Why

- This is the changeset's verification keystone: P1.M1.T1's keys rename (`discuss`→`chat`), P1.M2.T7's file deletion, and P1.M3.T1.S1's new guard test all land in parallel — the sweep is the first time the WHOLE tree is held to all gates at once. Renames and deletions are exactly where suites, type graphs, lint, and keymap guards drift.
- The PRD demands build-time keymap conflict re-verification (h2.34/h2.36; README §Keymap conflict re-verification is a live record, not prose). The `e` default became the side-chat key (SIDECHAT-001) — the script must confirm it still passes untouched and the run must be dated for the README refresh.

## What

### The four gates (in run order — cheapest diagnosis first)

1. **Typecheck** — `npm run typecheck` (tsc --noEmit). Expected failure classes: stale imports of the deleted `src/panel/discuss.ts` (panel.ts, keys.ts, any test not yet swept), renamed `KeyAction` member consumers (`keys.discuss` → `keys.chat`) missed in a fixture, new sidechat/engine/chat-view type seams. Fix at the owning file; do not loosen types.
2. **Lint** — `npm run lint` (`eslint src scripts *.ts`). Expected failure classes: unused imports/vars left by the discuss deletion (P1.M2.T7.S1), JSDoc/comment drift (e.g. panel.ts:224-225 setEditorText JSDoc rewording per the dossier), new-file rule violations in sidechat.ts/sidechat-engine.ts/sidechat-prompt.ts/chat-view.ts/ac-sidechat.test.ts/sidechat-cache-isolation.test.ts. Fix by editing the offending code/comments — never by disabling rules inline (follow existing eslint.config.js conventions).
3. **Full suite** — `npm test` (vitest run). Watch specifically:
   - **Renamed keymap suites**: `src/panel/keys.test.ts` (incl. the `e`-dispatches-per-view coverage at ~:389 that must stay green through the rename), `src/panel/keymap-ac.test.ts`, `src/config.test.ts` (:145 discuss-era expectations), `src/config-surface.test.ts` (new sideChatModel/sideChatAutoApply fields), `src/keymap-guard.test.ts` — the **exhaustiveness guard**: every KeyAction member must have a default + label + footer entry; the `chat` member and the discuss→chat alias must satisfy it.
   - **New files from parallel tasks** (treat as contracts, additive): `src/panel/sidechat*.test.ts`, `src/panel/ac-sidechat.test.ts` (P1.M3.T2.S1 — running in parallel; if it's mid-landing, run the suite excluding it, then rerun with it once present; do NOT edit its file), `src/panel/sidechat-cache-isolation.test.ts` (P1.M3.T1.S1 — landed, never edit).
   - **Deletion fallout**: any suite still importing discuss helpers; `ac-panel.test.ts`, `editor-preservation.test.ts`, `layout.test.ts`, `suspend.ts:22` fixtures/comments touched by the rename.
   - Failures get root-caused and fixed at the owning seam (minimal); if a parallel task's file is failing for its own reasons, STOP and report the conflict rather than editing its file.
4. **Keymap conflict script** — `bash scripts/verify-keymap-conflicts.sh` (from repo root or anywhere; it self-locates). **Expected: exit 0 with `e` unchanged** — `e` is a bare panel-owned letter: classified PANEL-OWNED by construction, no AVOIDED entry, the live `pi.registerShortcut` grep can't see it (the extension registers no global shortcut). The script also re-validates every OTHER default (d/o/t/m, tab/shift+tab, ctrl+s/ctrl+g) against the curated AVOIDED list and the live extension-tree grep — a newly installed/updated extension grabbing one of the chords WOULD fail here; if that happens, escalate to the owner (do not silently rebind a default). Record: date, commit hash, exit code, the full PASS table (or failure detail), and the explicit "expected: `e` unchanged — passes untouched" note.

### The residual grep gate (fifth, non-script)

```bash
grep -rin "discuss" --exclude-dir=node_modules --exclude-dir=plan --exclude-dir=.git .
```
Final state per the dossier (guards-tests-and-docs-surface.md): `discuss` appears ONLY at the `coerceKeys` compat alias in `src/config.ts`. Legit non-hits documented in the dossier (compaction.ts:100, tool-schema.ts:45 prose — "leave" verdicts) — verify each remaining hit against that list; anything off-list gets fixed here (code/comment) or, if it's README prose, LEFT for P1.M3.T3.S1/S2 (their scope — record it in gate-sweep.md instead of editing).

### Rules

- Fixes are minimal and traced to a subtask ("P1.M1.T1 rename fallout", "P1.M2.T7 deletion residual", …) in gate-sweep.md.
- Never edit parallel-task files (ac-sidechat.test.ts, sidechat-cache-isolation.test.ts) — coordinate/report instead.
- No README/spec edits here (P1.M3.T3.* owns docs; the keymap run record is DATA for them, written to research/ only).
- No rule disables, skips, or test deletions to force green — a test that must change gets changed with justification, not deleted.

### Success Criteria

- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `bash scripts/verify-keymap-conflicts.sh` — all exit 0, run in that order in one session, recorded.
- [ ] Keymap record written: date + commit + exit 0 + "`e` unchanged — passes untouched (bare panel-owned letter; no AVOIDED entry; no live registration claim)".
- [ ] Discuss residual grep: only the config.ts coerceKeys alias (+ documented leave-list hits).
- [ ] gate-sweep.md lists every fix with file/reason/subtask; zero fixes is a valid outcome (record "clean" per gate).
- [ ] Parallel-task files untouched; no tests deleted or weakened.

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the gate commands, the expected failure classes per gate (from the changeset's actual edits), the keymap script's semantics and the `e` expectation, the discuss residual final-state contract, and the sibling boundaries. All below.

### Documentation & References

```yaml
- file: plan/005_af804251f18d/architecture/guards-tests-and-docs-surface.md
  why: §Suite gates (gate command list + AUTOMATION-POLICY); §Discuss deletion inventory (the residual-sweep hit list incl. the "NOT real mentions — leave" verdicts); §README anchors (the :341/:364 conflict-record rows this run feeds)
- file: scripts/verify-keymap-conflicts.sh
  why: :1-52 header — exit codes (0/1/2), the PANEL-OWNED bare-letter reasoning, the AVOIDED list purpose (guards REBINDS, not defaults), the live-grep limitation (string-literal first args only)
- file: plan/005_af804251f18d/P1M3T2S1/PRP.md
  why: CONTRACT (parallel, implementing) — its ac-sidechat.test.ts lands concurrently; run gates without it if mid-flight, rerun with it when present; never edit its file
- file: plan/005_af804251f18d/P1M3T1S1/PRP.md
  why: CONTRACT (landed) — the cache-isolation guard test file; never edit
- file: plan/005_af804251f18d/architecture/config-and-keys-rename.md
  why: the rename map (KeyAction member, defaults, dispatch seam, label maps, fixtures) + the coerceKeys discuss→chat silent alias — what typecheck/lint/keymap-guard failures will look like
- file: src/keymap-guard.test.ts
  why: the exhaustiveness guard this sweep must satisfy (every KeyAction member: default + label + footer)
- file: package.json
  why: :scripts — test = vitest run, typecheck = tsc --noEmit, lint = "eslint src scripts *.ts" (note: scripts/ and root *.ts are linted — demo-deep-selection.ts included)
- file: README.md :335-365 (### Keymap conflict re-verification)
  why: the table + run-record format P1.M3.T3.S1 will refresh with this run's output — match its column shape in the record file
```

### Current Codebase tree (relevant excerpt)

```bash
package.json               # gate scripts
eslint.config.js           # lint rules
scripts/verify-keymap-conflicts.sh   # gate 4
src/config.ts              # coerceKeys discuss→chat alias (the ONLY allowed "discuss")
src/keymap-guard.test.ts   # exhaustiveness guard
src/panel/                 # renamed/deleted/new files under test
plan/005_af804251f18d/P1M3T2S2/research/
  gate-sweep.md            # CREATE
  keymap-run-record.md     # CREATE
```

### Known Gotchas of our codebase & Library Quirks

```bash
# Run order matters for cheap diagnosis: typecheck → lint → test → script.
# The suite count grew across the changeset (sidechat/engine/view/ac suites) —
# capture the passing count in gate-sweep.md; a count DROP vs. the pre-sweep
# run means a file was silently excluded (vitest config has
# passWithNoTests:true — a broken import can look like "0 tests" not a fail).
# verify-keymap-conflicts.sh exit 2 = environmental (config parse) — fix the
# environment/config read, don't treat it as a keymap verdict.
# If the live extension grep fails a CHORD (ctrl+s/ctrl+g/d/o/t/m...) because
# a new extension grabbed it — that's an OWNER decision (rebind vs. avoid),
# not a unilateral fix; record and escalate.
# Parallel-task coordination: ac-sidechat.test.ts may land DURING this task —
# rerun `npm test` after it appears; its failures are its own to fix.
# `grep -ri discuss` also matches "discussion" in prose — the dossier's
# leave-list (compaction.ts:100, tool-schema.ts:45) covers known legit prose.
# README hits from the residual grep are P1.M3.T3.S1/S2's edits — record, don't fix.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: BASELINE — run all four gates + the residual grep on the current tree; log raw results to research/gate-sweep.md (pass/fail per gate, failing files listed)
Task 2: FIX typecheck findings (rename fallout, deleted-module imports, new-file seams) — minimal, traced
Task 3: FIX lint findings (unused imports from deletion, comment drift, new-file style) — minimal, traced
Task 4: FIX suite findings — renamed keymap suites, keymap-guard exhaustiveness (chat member complete: default+label+footer), deletion fallout in fixtures; coordinate-not-edit for parallel files
Task 5: SWEEP discuss residual grep to final state (only the coerceKeys alias; README hits recorded for M3.T3, not fixed)
Task 6: RUN scripts/verify-keymap-conflicts.sh — capture full output; write research/keymap-run-record.md (date, commit hash, exit 0, `e`-unchanged note, PASS table)
Task 7: FINAL — rerun typecheck → lint → test → script consecutively, all exit 0; update gate-sweep.md with final counts and the fix inventory
```

### Implementation Patterns & Key Details

```markdown
<!-- keymap-run-record.md shape (P1.M3.T3.S1 consumes this verbatim): -->
<!-- ## Keymap conflict re-verification run (changeset 005_af804251f18d) -->
<!-- - Date: YYYY-MM-DD · Commit: <hash> -->
<!-- - Command: bash scripts/verify-keymap-conflicts.sh → exit 0 -->
<!-- - Expected and observed: `e` (keys.chat, SIDECHAT-001) UNCHANGED and -->
<!--   passes untouched — bare panel-owned letter: no AVOIDED entry, no live -->
<!--   pi.registerShortcut claim possible (panel owns the keyboard while open; -->
<!--   no global shortcut registered). -->
<!-- - Full default table: <paste script PASS output> -->
<!-- gate-sweep.md row shape: | gate | result | fixes (file → reason → subtask) | -->
```

### Integration Points

```yaml
GATES: npm run typecheck · npm run lint · npm test · bash scripts/verify-keymap-conflicts.sh
CREATE: plan/005_af804251f18d/P1M3T2S2/research/{gate-sweep.md, keymap-run-record.md}
CONSUMED: entire landed changeset (P1.M1.*, P1.M2.*, P1.M3.T1.S1) + P1.M3.T2.S1's AC suite (parallel)
DOWNSTREAM: P1.M3.T3.S1 README refresh reads keymap-run-record.md verbatim for the
  :341 label + :364 run-record rows; P1.M3.T3.S2's final discuss sweep consumes this
  task's residual-grep result
DO NOT EDIT: parallel-task test files, README.md, spec/ (record-only for their findings)
```

## Validation Loop

### Level 1: The gates ARE the validation

```bash
npm run typecheck                     # exit 0
npm run lint                          # exit 0
npm test                              # exit 0, full count recorded
bash scripts/verify-keymap-conflicts.sh   # exit 0
```

### Level 2: Residual contract

```bash
grep -rin "discuss" --exclude-dir=node_modules --exclude-dir=plan --exclude-dir=.git . \
  # → only src/config.ts coerceKeys alias (+ documented leave-list), everything else recorded
```

### Level 3: Downstream readiness

```bash
# The record P1.M3.T3.S1 needs exists and is complete:
test -s plan/005_af804251f18d/P1M3T2S2/research/keymap-run-record.md
grep -q "exit 0" plan/005_af804251f18d/P1M3T2S2/research/keymap-run-record.md
grep -q "unchanged" plan/005_af804251f18d/P1M3T2S2/research/keymap-run-record.md
```

### Level 4: Not applicable — AUTOMATION-POLICY: no live TUI session; the keymap script's live grep over installed extensions is script-sanctioned and is the only external observation.

## Final Validation Checklist

- [ ] All four gates exit 0 in one consecutive final run; counts recorded in gate-sweep.md
- [ ] keymap-run-record.md written: date, commit, exit 0, `e`-unchanged note, full PASS table
- [ ] Discuss residual grep at final state (alias-only + leave-list); README hits recorded, not edited
- [ ] Every fix traced (file → reason → subtask); zero-fixes-per-gate explicitly recorded
- [ ] Parallel-task files untouched; no tests deleted/weakened; no lint rules disabled
- [ ] Both research files exist and P1.M3.T3.S1 has everything it needs from them

## Anti-Patterns to Avoid

- ❌ Don't disable tests/rules/skips to force green — fix or escalate
- ❌ Don't edit parallel-task files (ac-sidechat.test.ts, sidechat-cache-isolation.test.ts) — report conflicts
- ❌ Don't unilaterally rebind a default when the script flags a chord collision — owner decision, record and escalate
- ❌ Don't write README/spec content here — the run record is data, not docs
- ❌ Don't accept a silently-smaller suite (passWithNoTests can mask a broken import as "passing")
- ❌ Don't treat script exit 2 (environmental) as a keymap verdict — fix the environment

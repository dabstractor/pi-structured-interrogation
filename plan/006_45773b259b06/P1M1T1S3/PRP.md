# PRP — P1.M1.T1.S3: Re-baseline at current HEAD and re-run keymap verification covering the toggle default (PANELTOGGLE-001)

## Goal

**Feature Goal**: Refresh the authoritative green baseline and keymap-conflict verification record at the CURRENT HEAD (which moved past the S1/S2 record's `eb09516` and past the contract's `ec61eb1`), now covering the post-2026-10-19 defaults — including the `toggle` global chord (ctrl+n, PANELTOGGLE-001) and the DEEP-FULLSCREEN-001 additions. Run `npm test`, `npm run typecheck`, `npm run lint`, and `bash scripts/verify-keymap-conflicts.sh`; record FRESH counts; emit one merged record that supersedes both the S1 baseline and the S2 VerificationRecord.

**Deliverable**: A refreshed **Baseline + VerificationRecord** delivered in the implementing agent's report (data only — NO files written):
`{ head, testFiles, tests, typecheck, lint, date, piVersion, perKeyStatus[11], drift[], anomalies[], exitCode }`

**Success Definition**:
- `npm test` → 56 test files / 1679 tests passed (fresh counts; do NOT assume the S1-era 54/1624)
- `npm run typecheck` → exit 0; `npm run lint` → exit 0
- `bash scripts/verify-keymap-conflicts.sh` → **exit 0** with **all 11 defaults clear** — the script's own summary line says `Checked 11 default key(s)`, and ctrl+n is reported **ok** under its picker-scoped-overlap classification (PANELTOGGLE-001 global registration, NOT a collision)
- Record carries the ACTUAL HEAD hash, date, and pi version at run time
- `drift[]` = empty (extension trees unchanged: only pi-patty-bg-tasks' five claims)
- Zero files modified (`git status` unchanged except plan/ bookkeeping)

## Why

The S1/S2 records were captured at `eb09516` with the 9-key KEYMNEMONICS-001 world (54 files / 1624 tests). Since then, eight rulings landed (74ebe39 DEEP-FULLSCREEN-001/DUMP-ONCE-001, 70b08ff PANELTOGGLE-001, 7fd63c2 ANSWER-FIDELITY, a4c6c9e KEEP-OPEN-001/002, 4baa95a CHAT-CONTEXT-001, 8f7255d+d4449f2 LENIENT-ANSWER-001/CHAT-STYLE-001/EMPTY-REPLY-001) plus the ec61eb1 PRD refresh — moving HEAD to `ec61eb1+` and changing the keymap surface: `DEFAULT_CONFIG.keys` now carries `expandDescription: "x"` and the tenth-plus-one default `toggle: "ctrl+n"` alongside the `panelShortcut: true` flag. Every downstream task in P1.M1 (the README record rewrite T2.S1, the keymap cross-check T2.S3, the final gate T3.S2) must cite a record that matches the tree it will be verified against — a stale record makes the README rewrite publish wrong counts and makes the final diff-gate unverifiable.

## What

Read-only verification in `/home/dustin/projects/pi-structured-interrogation`, one pass, in order:

1. **Record environment**: `date +%F` (expect ≥ 2026-11-20); `git rev-parse --short HEAD` (contract says `ec61eb1+`; live value during research was **`f2f5fdc`** — record whatever `git` returns, never a doc-cited hash); `git status --short` (expect only plan/ bookkeeping).
2. **`npm test`** — capture the `Test Files` and `Tests` summary lines + exit code. Expect **56 / 1679** (verified live). Flake protocol: on a failure, ONE re-run decides; pass-on-retry → `anomalies[]` note; fail-twice → reproducible bug → report exact failing tests and STOP (see Failure Protocol).
3. **`npm run typecheck`** and **`npm run lint`** — expect exit 0 on both.
4. **`bash scripts/verify-keymap-conflicts.sh`** — capture the FULL per-key table, the `Checked N default key(s)` summary, and exit code. **Require exit 0.**
5. **`piVersion`**: `grep -m1 '"version"' ~/.local/lib/node_modules/@earendil-works/pi-coding-agent/package.json` (expect 1.0.2; fall back to the `~/.pi/agent/npm/node_modules/@earendil-works/pi-coding-agent` copy if absent).
6. **Drift list**: the raw grep over the extension trees, `\.md:`-filtered (exact command in Task 7). Compare against the known five pi-patty-bg-tasks claims; anything NEW that touches a default is the script's exit-1 case anyway.
7. **Emit the merged record** in the report — nothing is written to any file.

### The 10-vs-11 count discrepancy (READ FIRST)

The work-item contract says "the 10th default — keys.toggle" and sketches `perKeyStatus[10]`. **The tree disagrees, and the tree wins**: `DEFAULT_CONFIG.keys` (src/config.ts:140-152) carries **11 entries**, because TWO keys landed after the 9-key S2 record — `expandDescription: "x"` (74ebe39) AND `toggle: "ctrl+n"` (70b08ff). The script's own summary line (verified live) says `Checked 11 default key(s)`. Rules:

- Record `perKeyStatus[11]` — every row the script prints, verbatim.
- The count mismatch is contract staleness, NOT a bug and NOT drift: do not "fix" it, do not drop the `x` row, do not report the run as anomalous. Note it once in the record (e.g. `contractSaid: 10, actual: 11`) and move on.
- Classification census to assert: 6 panel-owned bare letters (d, i, e, n, c, x) + 4 panel-safe reuses (ctrl+s, ctrl+g, tab, shift+tab) + 1 global registration (ctrl+n, PANELTOGGLE-001, picker-scoped built-in owner — this row's DETAIL names `app.session.toggleNamedFilter` and ends "extension wins at the main editor (startup diagnostic)").
- Also record `panelShortcut: true` presence (src/config.ts:157) — T2.S3 cross-checks that flag.

### Success Criteria

- [ ] Exit 0 on all four gates; fresh counts recorded (56 / 1679 / pass / pass at research-time HEAD)
- [ ] perKeyStatus[11] captured verbatim — including the `x (expandDescription)` and `ctrl+n (toggle)` rows
- [ ] ctrl+n classified as the PANELTOGGLE-001 picker-scoped global registration (an "ok" row — a FAIL row for ctrl+n means the script or config changed: report, do not patch)
- [ ] drift[] empty; date/headCommit/piVersion recorded live
- [ ] No files modified anywhere

## All Needed Context

### Context Completeness Check

Verification-only subtask — no code knowledge needed. **This research session already executed the entire run live** (2026-11-20, HEAD f2f5fdc): 56/1679 green, typecheck 0, lint 0, script exit 0 with 11/11 ok, drift empty, pi 1.0.2. The expected values in this PRP are verified facts, and the verbatim reference table is in the research notes. The implementing agent needs this PRP plus the research notes — nothing else.

### Documentation & References

```yaml
- file: plan/006_45773b259b06/P1M1T1S3/research/notes.md
  why: "THE verified-live run: verbatim 11-row per-key table, fresh counts (56/1679), pi 1.0.2, drift grep output, the 10-vs-11 count-discrepancy explanation, and the README:468 line-shift note"
  critical: "compare the fresh run's table line-by-line against this; only built-in DETAIL lists may drift harmlessly with pi doc updates"

- file: scripts/verify-keymap-conflicts.sh
  why: "the verifier — RUN, never edit. AVOIDED list (11 entries), EXT_TREES scanned, exit codes (0 clear / 1 collision / 2 config unreadable), the PANELTOGGLE-001 branch that classifies action=='toggle' as the global registration"
  gotcha: "the script parses DEFAULT_CONFIG.keys via sed — if it ever prints FAIL: could not parse (exit 2), the config format changed: report, do not edit the script"

- file: src/config.ts
  why: "lines 140-152: the 11 defaults incl. x and ctrl+n; :157 panelShortcut: true; :277 the panelShortcut coercion; :372 the config-table row documenting PANELTOGGLE-001"
  pattern: "read-only reference for the count assertion"

- file: plan/006_45773b259b06/P1M1T1S1/PRP.md
  why: "the superseded baseline contract (54/1624 at eb09516) — its flake protocol (single re-run on failure) is inherited here"

- file: plan/006_45773b259b06/P1M1T1S2/PRP.md
  why: "the superseded keymap record (perKeyStatus[9]) — this S3 record replaces it for T2.S1's consumption"

- file: README.md (:468 "Keymap conflict re-verification" section)
  why: "READ-ONLY — the record block T2.S1 rewrites from THIS subtask's output; note it currently says '9 defaults' and lists 10 rows vs config's 11: reconciling that is T2.S1's job, not yours"
  gotcha: "the block moved from :428-504 to :468 — cite the heading, not stale line numbers"

- file: src/keymap-guard.test.ts (:32-38)
  why: "the PANELTOGGLE-001 exception is already codified in the test suite (ctrl+n deliberately NOT in AVOIDED) — background for why ctrl+n's ok-row is correct"
```

### Current Codebase tree (relevant excerpt)

```bash
pi-structured-interrogation/          # run everything from here
├── package.json                      # :35-37  test = vitest run; typecheck = tsc --noEmit; lint = eslint src scripts *.ts
├── scripts/verify-keymap-conflicts.sh  # the verifier — RUN, never edit
├── src/config.ts                     # :140-152 DEFAULT_CONFIG.keys (11); :157 panelShortcut
├── src/                              # 56 *.test.ts files (32 root + 24 panel/), hermetic vitest
└── README.md                         # :468 record block — READ-ONLY this subtask
```

### Known Gotchas of our Codebase & Library Quirks

```bash
# GOTCHA: the contract's counts are stale THREE ways — head (ec61eb1 → f2f5fdc+),
#   tests (54/1624 → 56/1679), keys (10 → 11). Record live actuals everywhere;
#   the record exists precisely to supersede stale numbers.
# GOTCHA: vitest prints the 'Test Files'/'Tests' summary at the END — tail the
#   output; the exit code is authoritative.
# GOTCHA: src/persistence.test.ts may log a benign ERROR 'state mirror
#   appendEntry failed' line (a mocked path's expected log) — noise, not failure.
# GOTCHA: the drift grep ALSO hits bundled .md documentation examples
#   (docs/extensions.md, CHANGELOG.md: ctrl+x, ctrl+shift+p) — filter '\.md:'
#   out or the drift list looks non-empty for no reason.
# GOTCHA: the script's pi built-in hits (ctrl+s → app.session.toggleSort etc.)
#   are INFO by design — panel-scoped reuse via custom() intercept; they are NOT
#   conflicts. ctrl+n's built-in overlap (app.session.toggleNamedFilter) is
#   picker-scoped and classified ok — that is the contract's required outcome.
# GOTCHA: exit 2 from the script = environmental (config unreadable) — check
#   src/config.ts readability, re-run ONCE, then report+stop.
# CRITICAL: on exit 1 (real collision) do NOT rebind a default, extend AVOIDED,
#   or edit the script — that is a bug at an existing seam; report the key +
#   claim site verbatim and STOP. Same for a reproducible test/typecheck/lint
#   failure: report, never patch. This subtask writes NOTHING.
# GOTCHA: run from the repo root (the script resolves ROOT itself, but keeping
#   the report's captured paths consistent matters for T2.S1's citation).
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: RECORD environment
  - cd /home/dustin/projects/pi-structured-interrogation
  - date +%F                                  # ≥ 2026-11-20
  - git rev-parse --short HEAD                # actual hash (research saw f2f5fdc)
  - git status --short                        # expect plan/ bookkeeping only

Task 2: RUN npm test (fresh counts)
  - capture tail: 'Test Files' + 'Tests' lines and exit code
  - EXPECT 56 passed (56) / 1679 passed (1679), exit 0
  - on failure: ONE re-run; flake → anomalies[]; fail-twice → report exact
    failing tests + output and STOP

Task 3: RUN npm run typecheck    # expect exit 0, silent
Task 4: RUN npm run lint         # expect exit 0, silent

Task 5: RUN the keymap verifier
  - bash scripts/verify-keymap-conflicts.sh; echo "EXIT=$?"
  - capture the full table + 'Checked N default key(s)' summary + exit; REQUIRE 0
  - ASSERT: N == 11 and the census (6 panel-owned / 4 panel-safe / 1 global
    PANELTOGGLE-001 ctrl+n row) matches the research-notes table
  - N != 11 → the keymap surface moved again: record the ACTUAL rows, note the
    delta vs notes.md, and flag for T2.S1 (not a failure by itself)
  - exit 1 → record key + claim site, STOP (bug at the seam)
  - exit 2 → verify src/config.ts readable, re-run once, then report+stop

Task 6: RECORD pi version + panelShortcut
  - grep -m1 '"version"' \
      ~/.local/lib/node_modules/@earendil-works/pi-coding-agent/package.json
    # expect 1.0.2; fall back to the ~/.pi/agent/npm/node_modules copy
  - confirm src/config.ts:157 panelShortcut: true (grep -n 'panelShortcut' src/config.ts)

Task 7: CAPTURE the drift list
  - grep -rn 'pi.registerShortcut("' \
      ~/.pi/agent/npm/node_modules ~/.pi/agent/git ~/.pi/extensions 2>/dev/null \
      | grep -v '\.md:' | sed "s|$HOME|~|g"
  # expect exactly patty's five (src/shortcuts.ts:28/34/39/44/49) → drift []
  # any other source claim → include verbatim + flag (and the script should
  # already have caught a default-touching one with exit 1)

Task 8: EMIT the merged record (report only; no file writes)
  - { head, testFiles, tests, typecheck, lint, date, piVersion,
      perKeyStatus[11] (verbatim rows), drift[], anomalies[], exitCode: 0,
      supersedes: ["P1.M1.T1.S1 baseline (eb09516, 54/1624)",
                   "P1.M1.T1.S2 VerificationRecord (eb09516, perKeyStatus[9])"],
      contractSaid: "10 keys", actualKeys: 11 }
  - sanity: line-by-line diff vs research/notes.md §3 — only built-in DETAIL
    drift (pi doc updates) is acceptable variance
```

### Implementation Patterns & Key Details

```bash
# The whole subtask, in one block (run from the repo root):
date +%F; git rev-parse --short HEAD; git status --short
npm test 2>&1 | tail -6                       # Test Files / Tests summaries
npm run typecheck && npm run lint
bash scripts/verify-keymap-conflicts.sh; echo "EXIT=$?"
grep -m1 '"version"' ~/.local/lib/node_modules/@earendil-works/pi-coding-agent/package.json
grep -rn 'pi.registerShortcut("' ~/.pi/agent/npm/node_modules ~/.pi/agent/git ~/.pi/extensions 2>/dev/null | grep -v '\.md:' | sed "s|$HOME|~|g"
grep -n 'panelShortcut\|toggle:' src/config.ts | head -5
```

### Integration Points

```yaml
DOWNSTREAM: "P1.M1.T2.S1 rewrites the README 'Keymap conflict re-verification' block (now at README.md:468, NOT :428-504) from this record — it needs the 11 rows, fresh counts, live head/date/piVersion, and the 9-vs-10-vs-11 count reconciliation this record carries"
DOWNSTREAM: "P1.M1.T2.S3 cross-checks the PANELTOGGLE-001 surfaces (10th default + panelShortcut flag) against this record"
GATE: "P1.M1.T3.S2's final delta gate (suite/typecheck/lint green, diff confined to README.md) uses THIS record's counts as the reference — 56/1679, not 54/1624"
SUPERSEDES: "S1 baseline {eb09516, 54, 1624} and S2 VerificationRecord {eb09516, perKeyStatus[9], driftSince20261016: []}"
DOCS: "none — data only, by contract; the README citation is T2.S1's to write"
```

## Validation Loop

### Level 1: The runs ARE the validation

Exit 0 on all four gates with the asserted counts/census is the deterministic check.

### Level 2: Cross-check against the verified-live baseline

- [ ] Fresh per-key table matches research/notes.md §3 row-for-row; only pi-doc DETAIL lists may differ (harmless)
- [ ] Counts match §2 (56/1679) — any delta means the tree moved again: record actuals + flag

### Level 3: Environment cross-checks

- [ ] `git status` unchanged vs start; date gate (≥ 2026-11-20) satisfied; piVersion matches the doc-lookup tree the script consulted; `Checked 11 default key(s)` in the summary

### Level 4: Not applicable (data-only)

## Final Validation Checklist

- [ ] All four gates exit 0; full per-key table + `Checked N` summary captured verbatim
- [ ] Merged record complete: {head, testFiles, tests, typecheck, lint, date, piVersion, perKeyStatus[11], drift[], anomalies[], exitCode, supersedes[], contractSaid/actualKeys}
- [ ] ctrl+n present as the PANELTOGGLE-001 picker-scoped global row; `x (expandDescription)` row present; panelShortcut: true confirmed
- [ ] Drift = patty's five only (empty drift); .md documentation examples filtered
- [ ] Failure protocol honored on any gate failure (single retry for flake; report+stop otherwise — no rebind, no script/config/README edits)
- [ ] Zero files modified

### Code Quality Validation

- [ ] Record cites only live-captured values (no doc-stale hashes/counts)
- [ ] Report distinguishes verified facts from any observed deviations

## Anti-Patterns to Avoid

- ❌ Don't write ANY file — not the README record (T2.S1), not config, not the script
- ❌ Don't force the record to 10 rows because the contract said 10 — record the script's actual 11
- ❌ Don't rebind a colliding default or touch AVOIDED/the script on exit 1 — report and stop
- ❌ Don't count bundled .md prose examples as registerShortcut claims
- ❌ Don't treat pi built-in hits (or ctrl+n's picker-scoped overlap) as conflicts
- ❌ Don't assume 54/1624 — those are the superseded S1 counts; expect 56/1679
- ❌ Don't record a doc-cited hash, date, or version — capture live values
- ❌ Don't retry the test flake more than once

---

**Confidence Score**: 10/10 — the exact run was executed live during this research (2026-11-20, f2f5fdc: 56/1679 green, typecheck 0, lint 0, script exit 0 with 11/11 ok incl. the ctrl+n PANELTOGGLE-001 row, drift empty, pi 1.0.2); the implementing agent re-runs identical commands and transcribes against a verbatim reference table, with explicit handling for the one known discrepancy (contract's 10 vs actual 11).

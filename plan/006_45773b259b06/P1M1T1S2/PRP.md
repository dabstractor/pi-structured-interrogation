# PRP — P1.M1.T1.S2: Run scripts/verify-keymap-conflicts.sh and capture the fresh claim record

## Goal

**Feature Goal**: Produce the authoritative keymap-conflict verification record for the KEYMNEMONICS-001 defaults (d/i/e/n/c + ctrl+s/ctrl+g + tab/shift+tab): run `bash scripts/verify-keymap-conflicts.sh`, require exit 0, and capture the per-key status table, environment facts (date, HEAD, pi version), and the drift list of live string-literal `registerShortcut` claims in the extension trees since the 2026-10-16 record. Data-only — no files written.

**Deliverable**: A `VerificationRecord` delivered in the implementing agent's report, consumed verbatim by P1.M1.T2.S1 (README record block rewrite at README.md:428-504):
`{ date, headCommit, piVersion, perKeyStatus[9], driftSince20261016[], exitCode: 0 }`

**Success Definition**:
- Script exits 0; all 9 defaults pass (5 panel-owned bare letters, 4 panel-safe chord/tab reuses)
- Record captured with the ACTUAL HEAD hash at run time (expected `eb09516` — the contract's `7377318` is stale; record what `git rev-parse` returns)
- pi version recorded from the install the script actually consulted (expected **1.0.2** at `~/.local/lib/node_modules/@earendil-works/pi-coding-agent/package.json`)
- Drift list captured; expected **empty** (only pi-patty-bg-tasks' five claims at src/shortcuts.ts:28-49, unchanged since 2026-10-16)
- Zero files modified (`git status` unchanged)

## Why

Spec h2.36 demands build-time re-verification of the conflict-avoidance claims ("Dev agent must re-verify at build time and record findings"), and the README's record block (README.md:428-504) cites the last run (2026-10-20 per the architecture doc, previously 2026-10-16). The KEYMNEMONICS-001 changeset changed three defaults (i, c, n replacing o/t/m-era letters) — the refreshed record proves the new defaults collide with nothing and gives P1.M1.T2.S1 the exact data to cite.

## What

Run and capture (read-only; no mocking — the script reads the real installed trees by design):

1. **Pre-conditions**: green baseline from P1.M1.T1.S1 confirmed (54 files / 1624 tests / typecheck / lint); `date +%F` recorded (must be post-2026-10-16); `git rev-parse --short HEAD` recorded (actual hash, expect `eb09516`).
2. **The run**: `bash scripts/verify-keymap-conflicts.sh` from the repo root; capture the FULL per-key table + summary lines + exit code. **Require exit 0.**
3. **pi version**: `grep -m1 '"version"' ~/.local/lib/node_modules/@earendil-works/pi-coding-agent/package.json` (expected 1.0.2; if the script instead consulted the `~/.pi/agent/npm/node_modules` copy — it prints/warns on doc lookup — record THAT one).
4. **Drift list**: `grep -rn 'pi.registerShortcut("' ~/.pi/agent/npm/node_modules ~/.pi/agent/git ~/.pi/extensions 2>/dev/null | grep -v '\.md:'` — the surviving lines are real source registrations. Expected: exactly pi-patty-bg-tasks' five (src/shortcuts.ts:28/34/39/44/49) → `driftSince20261016: []`. Any NEW source registration touching a default = the script's exit 1 case.
5. **Failure protocol** (exit 1 — a default collides): that is a ruling-level BUG — REPORT (which key, which claim site) and STOP. Do NOT rebind keys, do NOT touch the AVOIDED list, do NOT edit the script. Exit 2 (config unreadable) = environmental: check src/config.ts readability, report, stop.
6. **Emit the record** in the report (no file writes — README citation is P1.M1.T2.S1's).

### Success Criteria

- [ ] exit 0; 9/9 keys "ok"; per-key table captured verbatim
- [ ] date (post-2026-10-16), actual HEAD, pi version recorded
- [ ] drift list captured and empty (or the exact new claims if any — then STOP per protocol)
- [ ] No files modified anywhere

## All Needed Context

### Context Completeness Check

Verification-only subtask. **This research session already executed the full run live** (2026-10-20, HEAD eb09516): exit 0, all 9 keys ok, drift empty, pi 1.0.2 — the expected values below are verified facts, not guesses. The implementing agent needs this PRP only.

### Documentation & References

```yaml
- file: plan/006_45773b259b06/P1M1T1S2/research/notes.md
  why: "THE verified-live run: the exact per-key table output, exit code, pi version, the drift-grep result (patty's five only), and the stale-hash warning"
  critical: "the expected table rows are recorded verbatim — compare the fresh run line-by-line"

- file: plan/006_45773b259b06/architecture/keymap-verification-and-readme-drift.md
  why: "the research doc behind this subtask: script mechanics, the 2026-10-20 verified run, the README record block (README.md:428-504) it feeds, and the drift baseline (2026-10-16: patty's five)"
  gotcha: "its HEAD references may lag — always record the live hash"

- file: scripts/verify-keymap-conflicts.sh
  why: "the script itself: AVOIDED list (11 entries), EXT_TREES scanned, exit-code semantics (0/1/2), the string-literal-only grep limitation (header comment)"
  pattern: "exit 2 = environmental (config unreadable); exit 1 = real collision → report+stop"

- file: plan/006_45773b259b06/P1M1T1S1/PRP.md
  why: "the green-baseline contract this subtask consumes (54/1624/typecheck/lint at the actual HEAD)"

- file: README.md (:428-504)
  why: "READ-ONLY here — the record block P1.M1.T2.S1 rewrites from this subtask's output; do not edit it now"
```

### Current Codebase tree (relevant excerpt)

```bash
pi-structured-interrogation/
├── scripts/verify-keymap-conflicts.sh   # the verifier — RUN, never edit
├── src/config.ts                        # DEFAULT_CONFIG.keys — parsed by the script
└── README.md                            # :428-504 record block — READ-ONLY this subtask
```

### Known Gotchas of our Codebase & Library Quirks

```bash
# GOTCHA: the contract's "expect 7377318" is STALE — the live HEAD is eb09516
#   (verified during research and flagged in S1's PRP). Record `git rev-parse`
#   output, never a doc value.
# GOTCHA: the raw drift grep also hits bundled DOCUMENTATION (docs/extensions.md
#   and CHANGELOG.md examples inside the installed pi copies: ctrl+x,
#   ctrl+shift+p). Those are prose, not registrations — filter '\.md:' out or
#   the drift list will look non-empty for no reason.
# GOTCHA: the script's built-in hits (ctrl+s → app.session.toggleSort etc.) are
#   INFO by design — panel-scoped reuse via custom() intercept is intentional;
#   they must NOT be reported as conflicts.
# GOTCHA: exit 2 (config unreadable) is environmental, not a keymap ruling —
#   check tree state and re-run once before reporting.
# CRITICAL: on exit 1 do NOT rebind a default, extend AVOIDED, or "fix" the
#   script — a collision is a ruling-level bug; report the key + claim site and
#   stop. The README rewrite (P1.M1.T2.S1) must not proceed on a failed run.
# GOTCHA: run from anywhere is supported (the script resolves ROOT), but run
#   from the repo root to keep captured paths in the report consistent.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: RECORD environment
  - cd /home/dustin/projects/pi-structured-interrogation
  - date +%F                                  # must be > 2026-10-16
  - git rev-parse --short HEAD                # actual hash (expect eb09516)
  - git status --short                        # clean except plan/

Task 2: RUN the verifier
  - bash scripts/verify-keymap-conflicts.sh; echo "EXIT=$?"
  - capture the full table + summary + exit code; REQUIRE 0
  - exit 1 → record key + claim site, STOP (ruling-level bug)
  - exit 2 → verify src/config.ts readable, re-run once, then report+stop

Task 3: RECORD pi version
  - grep -m1 '"version"' \
      ~/.local/lib/node_modules/@earendil-works/pi-coding-agent/package.json
  # expect 1.0.2; if absent, use the npm-tree copy the script's doc-lookup found

Task 4: CAPTURE the drift list
  - grep -rn 'pi.registerShortcut("' \
      ~/.pi/agent/npm/node_modules ~/.pi/agent/git ~/.pi/extensions 2>/dev/null \
      | grep -v '\.md:'
  # expect exactly patty's five (src/shortcuts.ts:28/34/39/44/49) → drift []
  # any other source claim → include verbatim in the report and flag

Task 5: EMIT the VerificationRecord (report only; no file writes)
  - { date, headCommit, piVersion, perKeyStatus[9] (verbatim rows),
      driftSince20261016[], exitCode: 0 }
  - sanity: compare against research notes' verified table — any row differing
    (beyond built-in doc drift in DETAIL text) is itself reportable drift
```

### Implementation Patterns & Key Details

```bash
# The whole subtask, in one block:
date +%F; git rev-parse --short HEAD
bash scripts/verify-keymap-conflicts.sh; echo "EXIT=$?"
grep -m1 '"version"' ~/.local/lib/node_modules/@earendil-works/pi-coding-agent/package.json
grep -rn 'pi.registerShortcut("' ~/.pi/agent/npm/node_modules ~/.pi/agent/git ~/.pi/extensions 2>/dev/null | grep -v '\.md:'
```

### Integration Points

```yaml
DOWNSTREAM: "P1.M1.T2.S1 rewrites README.md:428-504 from this record (date, HEAD, pi version, table, drift)"
GATE: "P1.M1.T3.S2's final diff-confined-to-README check depends on this subtask writing nothing"
DOCS: "none — data only, by contract"
```

## Validation Loop

### Level 1: The run IS the validation

Exit 0 with 9/9 "ok" rows is the deterministic gate.

### Level 2: Cross-check against the verified baseline

- [ ] Fresh table matches the research notes' verified rows (panel-owned ×5, panel-safe reuse ×4); built-in DETAIL lists may drift harmlessly with pi doc updates — flag but don't fail

### Level 3: Environment cross-checks

- [ ] `git status` unchanged; `date` gate satisfied; pi version matches the doc-lookup path the script used

### Level 4: Not applicable (data-only)

## Final Validation Checklist

- [ ] Exit 0; full per-key table + summary captured verbatim
- [ ] VerificationRecord complete {date, actual headCommit, piVersion, perKeyStatus[9], driftSince20261016, exitCode}
- [ ] Drift list = patty's five only (empty drift), documentation-example hits filtered
- [ ] No collision encountered (else: report+stop honored — no rebind, no script edit)
- [ ] Zero files modified; no README/script/config edits

## Anti-Patterns to Avoid

- ❌ Don't rebind a colliding default or touch AVOIDED/script on exit 1 — report and stop
- ❌ Don't count bundled .md documentation examples as registerShortcut claims
- ❌ Don't treat pi built-in hits as conflicts — panel-scoped reuse is intentional (INFO only)
- ❌ Don't record a doc-cited hash/date — capture the live values
- ❌ Don't write any file, including the README record — that's P1.M1.T2.S1
- ❌ Don't re-run past one retry on exit 2 without reporting

---

**Confidence Score**: 10/10 — the exact run was already executed live during this research (exit 0, 9/9 ok, drift empty, pi 1.0.2 at eb09516); the implementing agent re-runs the same commands and transcribes the same facts, with a line-by-line comparison baseline provided.

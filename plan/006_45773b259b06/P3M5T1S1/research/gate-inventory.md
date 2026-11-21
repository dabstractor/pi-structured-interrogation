# Gate inventory — P3.M5.T1.S1 (full gate: acceptance cases 1-5 + suite/typecheck/lint + static-guard audit)

Verified in-tree on 2026-11 research session. Everything below was read from the working tree
and git history, not assumed.

## 1. AUTOMATION-POLICY (binding)

`plan/001_0d6760db6bc5/AUTOMATION-POLICY.md` — no live TUI, never call `interrogate` for real,
never start interactive pi, never end a turn waiting for input. This gate is 100% scripted
(vitest + npm + git), so compliance is trivial — but the PRP must restate it so the implementer
never "helpfully" opens the panel to check recovery by hand.

## 2. The five acceptance cases (spec/state-and-persistence.md §Local input recovery, :133-150)

Case definitions live at spec lines ~145-149 (verified verbatim). Mapping to scripted suites
(verified `describe` strings via grep):

| Case | Suite file | describe string (exact) |
|---|---|---|
| 1 | `src/panel/session-restore.test.ts:247` | `acceptance case 1 — hard-kill draft restore, all five limbs` |
| 2 | `src/input-retirement.test.ts:307` | `acceptance case 2 — continuous typing progresses without idle, byte-exact final value` |
| 3 | `src/input-retirement.test.ts:353` | `acceptance case 3 — failed write keeps both values; delayed writes never clobber or resurrect; branches isolate at file level` |
| 4-send-half | `src/panel/retirement-sidechat.test.ts:329` | `acceptance case 4-send-half — chat retirement rides the settle, never the send` |
| 4-commit-half | `src/panel/session-restore.test.ts:383` | `acceptance case 4-commit-half — both sides of the save/commit handoff` |
| 5 | `src/blank-rejection.test.ts` (P3.M4.T1.S2 artifact — IN FLIGHT at research time, must exist at gate time) | file doc header cites spec :149; five sections |

Case 5 supporting units: `src/reconstruct.test.ts` describes "replay blank guards (P3.M4.T1.S2)"
and "base blank scrub (P3.M4.T1.S2)" (from P3M4T1S2 PRP Tasks 2-3).

vitest `-t` matches substrings of the full test name — `acceptance case 1` etc. selects precisely.

## 3. Static guards (all must be green AND the four pre-existing ones unmodified)

| Guard | File | describe |
|---|---|---|
| no-hardcoded-keys | `src/no-hardcoded-keys.test.ts:189` | `no-hardcoded-keys source guard (R5/AC-12)` |
| sidechat-cache-isolation | `src/panel/sidechat-cache-isolation.test.ts:185` | `side-chat cache-isolation guard (SIDECHAT-005, h2.16)` |
| keymap-guard | `src/keymap-guard.test.ts:93` | `keymap conflict guard (P1.M7.T7.S2, PRD h2.34/h2.50)` |
| config-surface | `src/config-surface.test.ts:339,359` | `AC-12 fixture round-trip…`, `AC-12 exhaustive remap…` |
| no-recovery-side-effects (NEW in P3) | `src/no-recovery-side-effects.test.ts:213` | `no-side-effects guard — recovery modules (P3.M2.T1.S3, §No-side-effects audit)` |

Contract emphasis: recovery writes are extension-local FILES — no sendMessage, no appendEntry of
draft/composer content, no session-file writes. That is exactly what no-recovery-side-effects +
sidechat-cache-isolation assert.

Verified: `git diff --name-only <base>..HEAD` on the four pre-existing guard files is EMPTY
(they are untouched by P3 so far and must remain so at the gate).

## 4. Changeset base + allow-list

- First P3 commit: `5dea27e` "capture-on-edit lands" → base = its parent `11e864d`
  ("seven recovery axes resolved; capture track opens" — plan-only commit).
- Robust discovery: `git log --format=%H --grep="capture-on-edit lands" -1` then `^`.
- Committed diff base..HEAD touches (verified): command.ts, index.ts, input-capture(.test).ts,
  input-durability(.test).ts, input-restore(.test).ts, input-retirement.test.ts,
  no-recovery-side-effects.test.ts, panel/actions.ts, panel/panel(.test).ts,
  panel/retirement-sidechat.test.ts, panel/session-restore.test.ts, panel/sidechat-engine.ts,
  panel/text-field(.test).ts, reconstruct(.test).ts, shortcut.ts.
- In-flight additions: P3.M4.T1.S1 (working tree now): state(.test).ts, panel/actions.test.ts,
  fallback(.test).ts, tool(.test).ts. P3.M4.T1.S2 (parallel): reconstruct.ts, reconstruct.test.ts,
  blank-rejection.test.ts (new).
- panel/sidechat.ts was declared in P3M2T1S1 Task 4 but is NOT in the committed diff — allow but
  don't require.
- README.md must NOT appear at this gate (owned by S2, which runs AFTER this gate).

## 5. Gate commands (package.json verified)

- `npm test` = `vitest run` (whole suite; summary line gives Test Files/Tests counts)
- `npm run typecheck` = `tsc --noEmit`
- `npm run lint` = `eslint src scripts *.ts`
- Per-suite: `npx vitest run <file> [-t pattern]`

## 6. Verdict output shape (precedent: P1M1T1S1 baseline record)

Delivered in the implementing agent's REPORT (no repo files written — keeps diff confinement
trivially clean). Shape: `{head, cases{1..5}, suite{files,tests}, typecheck, lint, guards{5},
diffConfined, anomalies[]}`. Consumed by P3.M5.T1.S2 (README sync pre-condition).

## 7. Failure playbook

- Missing artifact (e.g. blank-rejection.test.ts absent) → verdict FAIL + escalate; do NOT
  implement another subtask's work.
- Failing test → fix ONLY at the P3-owned seams (the allow-list files above); never weaken/delete
  assertions, never edit pre-existing guards, never touch spec/plan/scripts/package.json.
- Flake → one rerun, recorded as anomaly.

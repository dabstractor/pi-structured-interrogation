# Testing & verification map (binding: plan/001_0d6760db6bc5/AUTOMATION-POLICY.md)

## Policy
- Scripted vitest ONLY — no live TUI, no live tool calls, never waiting on user answers. Interactive/manual checks defer to the human runbook (`plan/001_0d6760db6bc5/MANUAL-TUI-AC-RUNBOOK.md` pattern).
- Every subtask implies TDD: failing test → implement → pass. No separate "write tests" work items.
- Green gates for the whole delta: `npm test` (full suite), `npm run typecheck`, `src/no-hardcoded-keys.test.ts`, `src/keymap-guard.test.ts` — NO new key labels ship.

## To-flip map (assertions pinning the OLD ★-preselect / same-value-edit behavior)
| Test location | Pins | Owner subtask |
|---|---|---|
| `src/panel/actions.test.ts:541` `test_d_cursor_resets_to_star_preselect_on_every_change` | cursor resets to ★ on every change | T1.S1 (seed) / T5.S9 |
| `actions.test.ts:~995` (EXPLAIN-003 re-seed) | re-seed to recommendation | T1.S2 |
| `actions.test.ts:~1684-1685, ~1829-1836` (same-value edit rows) | same-value edit ripple/rewrite | T2.S5 |
| `actions.test.ts:~1878, ~1948` | preselect/write-in rows | T2.S4 / T5.S9 |
| `src/panel/deep-view.test.ts:~420` | acceptFromDeep same-value = veto | T2.S6 |
| `src/panel/overview.test.ts:~412/452` | parity/ledger rows | T3.S7 / T5.S9 |
| `src/panel/panel.test.ts:~618` | currentId seed on revisit | T1.S2 |
| `src/panel/ac-panel.test.ts:~477` | AC-panel preselect row | T5.S9 |
| residual rows: short-view.test.ts, two-stage.test.ts | ★-preselect-on-revisit | T5.S9 |
| `src/ac-scripted.test.ts`, `src/regression-phantom-submissions.test.ts` | scripted flows; phantom submissions | T5.S10 |

Line anchors are from the delta PRD (files verified to exist and be of sufficient length: actions.test.ts 2323, deep-view.test.ts 701, overview.test.ts 527, panel.test.ts 2739, ac-panel.test.ts 1165 lines) — locate by content, lines may drift.

## New scripted tests (ride with owning subtask; AC-16 end-to-end in T5.S10)
- AC-16 (cite FR-35) — full scenario in architecture/answer-pinning-contract.md.
- digit-on-recorded-value no-op (consumed, advance, zero state change) — T2.S4.
- maybeAutoSubmit never fires from a no-op path — T2.S4.
- write-in byte-identical re-commit inert + buffer not staged into draft slot — T2.S5.
- acceptFromDeep same-value → short + advance vs veto → stays — T2.S6.
- stale answer value clamps to display row 0 with ★ recommendation present — T1.S1.
- `★ answered` question-line marker incl. write-in composition + moot/withdrawn/⟳ exclusions — T3.S7.

# Automation policy — pi-interrogator plan 001_0d6760db6bc5

**Audience:** every automated agent (PRP generation, subtask execution, validation,
bug hunt) that works on this plan. Humans doing a live TUI pass follow
[MANUAL-TUI-AC-RUNBOOK.md](MANUAL-TUI-AC-RUNBOOK.md) instead — that file is
human-only and is NEVER part of an automated run.

## Rule (hard, non-negotiable)

**No live interactive verification.** An automated run must never open a
question panel, never wait for a human, and never end a turn "waiting for the
user to answer" as part of testing. A stuck panel is a pipeline outage, not a
test result.

Specifically, during any automated execution of this plan:

1. **Never call the `interrogate` tool for real.** Not even "just one upsert
   question to see the panel". The tool's contract is to surface questions to a
   human and end the agent's turn — in automation that is a deadlock.
2. **Never start an interactive `pi` / `pi -e .` TUI session** and drive it by
   hand (typing `/interrogate-debug-*`, pressing keys, observing the panel).
   Automated agents cannot press keys or see the rendered TUI.
3. **Never treat a PRP "Level 3 / Level 4" instruction that says "live",
   "manual smoke", "in a terminal", or "observe" as permission to do it live.**
   Those instructions are rewritten to scripted equivalents; where stale copies
   remain, the scripted alternative below always wins.
4. **Never end a turn waiting for user input** as a verification step
   ("Question panel is up — waiting for your choice" is a failure mode, not a
   checkpoint).

## What to do instead (scripted equivalents)

| Old live step | Scripted replacement |
|---|---|
| `pi -e .` + `/interrogate-debug-upsert ...` and observe panel | vitest unit/integration test calling the same exported functions with a fake `ctx`/`tui` (see `src/panel/panel.test.ts` for the pattern: open, view switching, suspend via `done(null)`, reopen, single-instance guard) |
| "call the tool from a scratch session" | call `executeInterrogate(...)` (or the debug-command handler) directly in a vitest test and assert on the returned envelope + `serialize()` |
| observe TUI rendering / widths | render via the component's `render(width)` in tests and assert with `visibleWidth` sweeps (40/60/80/120 cols) |
| end-to-end model round trip | headless one-shot: `pi -p` (non-TUI fallback path — digest + `answers[]`), assertable from a script |
| manual AC pass | ACs provable at state/render level go into vitest; interactive-only ACs are deferred to the human runbook |

## Why

- The pipeline runs unattended. `interrogate` is non-blocking *for the model*
  but blocks *the pipeline* on a human answer — the run hangs until timeout and
  the subtask is marked `Failed` (which never auto-retries).
- `ctx.ui.custom()` panels replace the editor region; an automated agent can
  neither interact with nor verify them live.
- Every behavior the live smokes checked is already expressible as a vitest
  assertion against the same code path (h2.50: debug commands and tests invoke
  the SAME parse/guard/state/delivery functions as the tool executor).

## Incident record

2026-09-13: an automated subtask run satisfied a PRP "live TUI smoke" step by
calling `interrogate({action:"upsert", questions:[{id:"q1", title:"engine",
...}], goal:"pick db"})` and ending its turn to wait for the engine choice.
The pipeline stalled on the open panel; the subtask (P1.M3.T1.S1) was marked
`Failed`. This policy and the PRP/task rewrites below exist to make that
impossible to repeat:

- All pending PRP "Level 3: live TUI / Manual smoke" sections rewritten to
  scripted-only (`P1M3T1S1`, `P1M3T1S2`, `P1M3T2S1`).
- `P1.M7.T6.S2` (manual TUI AC pass) re-scoped: scripted ACs stay in the
  pipeline; the interactive pass moved to MANUAL-TUI-AC-RUNBOOK.md (human-only).
- `tasks.json` context_scopes that mentioned live/manual verification now cite
  this policy.

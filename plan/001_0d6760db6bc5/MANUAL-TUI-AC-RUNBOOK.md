# Manual TUI AC runbook — pi-interrogator plan 001_0d6760db6bc5

> **HUMAN-ONLY. Never executed by the automated pipeline.**
> If you are an automated agent reading this: stop, skip this file, and follow
> [AUTOMATION-POLICY.md](AUTOMATION-POLICY.md). Do not attempt any step below;
> do not "help" by calling the interrogate tool. Everything automation can
> prove is already covered by scripted ACs (P1.M7.T6.S1/S2 vitest coverage).

Run this whenever you (the human) have the repo open in a real terminal. It is
the interactive acceptance pass that used to be subtask P1.M7.T6.S2. Nothing in
the pipeline depends on it; results can be recorded at the bottom of this file.

Setup: `pi -e .` from the repo root (loads the extension), then use
`/interrogate-debug-upsert <json>` to create state without convincing the model.

- [ ] AC-1 — load 30 questions / 4 groups / gate: panel stays navigable, chat visible above
- [ ] AC-4 — break out → widget → side chat full turn → reopen → drafts intact both sides
- [ ] AC-5 — deep view scroll + select-from-deep, return to short
- [ ] AC-6 — contrary gate answer → instant moot + ⊘ markers
- [ ] AC-7 — ripple confirm: enter=keep invalidated answers, esc=cancel
- [ ] AC-9 — restart pi mid-interrogation → reconstruction auto-opens panel, state intact
- [ ] AC-10 — `/compact` → summary → model read returns full state
- [ ] AC-12 — remap a key in settings → footer labels reflect it without restart

## Results

| Date | AC | Pass | Notes |
|---|---|---|---|
| | | | |

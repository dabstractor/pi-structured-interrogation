# Validation Report — pi-interrogator

**Date:** 2026-10-14 · **Scope:** full codebase validation against the PRD/spec (8 spec docs + plan tasks) · **Head validated:** `7aca309` (README sync; final P1 commit)

## What was validated

The pi-interrogator extension: a structured-interrogation panel for the pi coding
agent (`interrogate` tool, `/interrogate` command, bottom-dock panel, non-TUI
fallback). The PRD's in-flight changeset — **P1 "keymap trilogy"**
(BAREKEYS-001 bare-letter defaults + `elaborate` rename + two-tier intercept,
VIMNAV-001 fixed `hjkl` aliases, DIGIT-OUT-001 digit quick-select removal) —
plus the eleven previously-shipped bundled rulings (TRUST/DEEP-PIN/GOAL-OUT/
MIRROR-SILENT/DEEP-FULL/CAPS-OUT/DEEP-STICKY/DEEP-LAND/BUG wave) were checked
against source, spec, tests, and live runtime.

## Validation performed

| Phase | Method | Result |
|---|---|---|
| Type checking | `tsc --noEmit` (strict) | ✅ clean |
| Unit + integration | `vitest run` — **47 files / 1320 tests** (AC suites, guards, regressions, tree-nav, phantom-submission, reask-roundtrip) | ✅ 1320/1320 pass |
| Keymap conflict guard | `scripts/verify-keymap-conflicts.sh` (9 defaults vs 11 avoided keys + live extension grep) | ✅ PASS |
| Static spec gates | README grep gate (`ctrl+t\|ctrl+d\|ctrl+l\|focusText\|digit` → zero matches); no `registerShortcut` in source; digit machinery absent from source AND config schema; `hjkl` absent from config schema (fixed family) | ✅ all pass |
| E2E — real runtime | Real `pi 1.0.2` print-mode probes: extension loads via jiti (`-e src/index.ts`), `/interrogate` + `/interrogate debug state` recognized (negative control discriminates), normal model operation unaffected | ✅ all pass |
| E2E — factory journey | Real factory + real tool executor + real event wiring + real `InterrogationPanel`, driven end-to-end through capture fakes (AUTOMATION-POLICY-compliant: no live TUI, no real model tool calls, never waits on a human). 54 assertions: factory wiring (1 command, 0 shortcuts, 1 tool, 7 events, ≤120-word description, 4 guidelines); non-TUI journey (numbered digest + relay line, full-state read, STALE epoch/rev rejections, surgical patch semantics, guarded `answers[]`, exactly-once completion injection with `triggerTurn`); TUI surfacing + keymap (session_start never auto-opens; upsert-opens-panel; `hjkl`/`d o t m e` contracts; digits inert; note/elaboration editor duties; ESC-002 single/double esc; accept-advance; ANSWER-PIN caret ownership + no-op re-enter; suspend widget format "command only, no chord"; read-never-surfaces; `{reopen:true}` resurfaces) | ✅ 54/54 pass |

**Spec spot-checks:** tool description ~105 words (≤120, spec-verbatim); 4
promptGuidelines bullets; status line `{n}/{t} answered · {r} re-asked · {m}
moot · epoch {e}` exact; widget line `{n} open · {m} answered — /interrogate
to resume` exact (no key chord anywhere); submission/completion `customType`s
correct; merge rules 1–4 (incl. flag-gated withdrawal) behave per spec;
rev/epoch guards reject with STALE + heal; non-TUI `answers[]` path ships no
redundant submission delta (model knows its own record) and injects completion
at settle — matches spec §Emission hooks.

**Plan traceability:** `plan/004_49e25d5235a9/tasks.json` — every P1 task and
subtask is Complete; README grep gate (P1.M4.T2.S1's binding output gate)
passes. No missing features found against the PRD.

## Issues found

All findings are minor; **zero functional defects** — the full suite, typecheck,
keymap guard, and 54-assertion E2E journey are green.

### 1. Resident guideline references a deleted warning channel (minor, doc/spec residue)

`src/tool.ts:73` — promptGuidelines bullet 3 ends: *"If the tool result warns a
deep-view field is thin, re-upsert it expanded with the current rev."*
CAPS-OUT-001 (2026-10-08 owner ruling) deleted the caps engine **including the
minimum-floor lints**; `spec/decisions.md` states the tool-result warnings
channel survives "only for withdrawal notices". The warning this sentence
instructs the model to watch for can never fire. The source matches
`spec/tool-protocol.md` verbatim — i.e., the **spec itself** carries the
inconsistency and the source faithfully mirrors it. Impact: cosmetic
resident-prompt noise; no functional effect. Fix would be a one-line spec +
source edit (out of scope for a validation agent; spec is read-only).

### 2. Stale "two-stage save" comment fossils (minor, comments only)

`src/panel/keys.ts:59` and `keys.ts:497` describe enter-in-text-focus
forwarding as "so the embedded text field can implement its two-stage save";
`src/panel/panel.ts:115` references "stage-1 enter (two-stage, h2.31)". The
two-stage arming machinery was removed by WRITEIN-001 (commit-at-enter); enter
in text/note focus is intercepted at panel level (`panel.ts handleInput`) and
never reaches the router, so the comments misdescribe the live mechanism.
Behavior is correct (E2E C16–C21 + suite). Impact: none at runtime; misleading
to future maintainers.

### 3. `focusText`→`elaborate` alias edge deviates from spec letter (minor, contrived corner)

`src/config.ts:198–205` — the subtask contract says "an explicit
`keys.elaborate` always wins", but the implementation treats
elaborate-equals-default as "user-absent" (the DEFAULT-first deep-merge makes
absence indistinguishable from an explicit default value), so with an explicit
`elaborate: "t"` (exactly the default) **and** a stale legacy `focusText`
present in the same settings, the legacy value wins. Contrived (requires
rebinding a key to exactly its default while a legacy name lingers), documented
in-code, and the tested behaviors (legacy feeds elaborate when new name absent;
differing explicit value wins; invalid elaborate falls back to legacy) all
pass. Impact: near-zero.

## Observations (not defects)

- **Concurrent writer mid-validation:** a worker agent committed `7aca309`
  ("README rewritten to the landed keymap contract", closing P1.M4.T2.S1) at
  22:42:06 while validation ran. All gates were re-verified against the final
  committed state; working tree clean.
- **TUI-interactive ACs deferred by policy:** per the binding
  `AUTOMATION-POLICY.md`, live visual verification (real editor composition
  with the user's vim modes, `$EDITOR` handoff, rendered layouts) belongs to
  the human runbook (`plan/001_0d6760db6bc5/MANUAL-TUI-AC-RUNBOOK.md`). The
  automatable slices are fully covered by the suite + factory E2E probe; the
  real-runtime load path is proven under pi 1.0.2. This is by design, not a gap.
- **Dependency note:** devDependency `@earendil-works/pi-coding-agent` is
  ~0.85.1 while the installed runtime is pi 1.0.2 — the extension loaded and
  operated correctly under both (0.85.1 in tests, 1.0.2 live), so no
  incompatibility was observed on any exercised path.

## Verdict

**PASS with 3 minor issues** (2 doc/comment residue, 1 contrived config-alias
corner). No functional defects: every automated gate is green — 1320 unit/
integration tests, strict typecheck, keymap conflict guard, static spec gates,
real-runtime load probes, and a 54-assertion end-to-end factory journey
covering the P1 keymap trilogy, surfacing policy (SURFACE-001/002), answer
pinning (ANSWER-PIN-001), write-in/elaboration duties (WRITEIN-001/002),
guards, merge rules, and the non-TUI completion lifecycle.

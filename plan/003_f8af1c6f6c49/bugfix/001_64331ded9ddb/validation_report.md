# Validation Report — pi-interrogator (bug-fix PRD wave 001_64331ded9ddb)

**Date:** 2026-10-07 · **Validator:** independent validation pass (`./validate.sh`, all phases green)
**Scope:** the five PRD bugs (BUG-001 critical, BUG-002/003/004 major, BUG-005 minor) plus regression validation of every adjacent contract the fixes touch.

## Verdict

**All five PRD bugs are FIXED in the current tree. Zero open issues found.**

The fix wave landed as commits `72424da` ("Same-value re-answer after re-ask now submits") through `8100235` ("Record BUG-005 fresh-receiver epoch exemption"), with the final README sweep (`P1M3T2S1`) present as staged-but-uncommitted changes to `README.md` + `plan/` files only (no source changes pending). Tasks in `plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/tasks.json` are marked Complete.

## How it was validated

`./validate.sh` (this repo, exits 0 only if every phase passes):

| Phase | Result |
|---|---|
| 1 Preflight (node ≥22, deps, vite-node) | PASS |
| 2 Static guards (no skipped/todo/only tests; no removed-surface residue) | PASS |
| 3 Type checking (`tsc --noEmit`) | PASS |
| 4 Unit tests (`vitest run`) | PASS — 47 files, **1306 tests** (up from the 1265 baseline; the fix wave added regression suites) |
| 5 Keymap guard (`scripts/verify-keymap-conflicts.sh`) | PASS |
| 6 E2E journeys — 4 scripted vite-node probe suites, **166 independent public-seam checks** driving only `executeInterrogate` + the lifecycle event bus + `InterrogationPanel.handleInput` + captured `sendMessage`, plus the REAL extension factory (`src/index.ts`) under a fake-ctx harness (AUTOMATION-POLICY compliant: no live TUI, no waiting on humans) | PASS (86 + 49 + 15 + 16 checks) |

## PRD bug verification (each repro journey re-run end-to-end)

### BUG-001 (Critical) — Re-asked question re-confirmable ✅ FIXED
- `acceptOptionIndex` (src/panel/actions.ts:317) now excludes `reasked` from the ANSWER-PIN-001 same-value no-op; `writeInEnter` (:429) carries the editor twin with kind preservation (`isReconfirm` keeps `custom` flag state).
- Probe journey (rule-1 re-ask, answer kept): same-value **enter** re-marks `answered` → auto-submit ships → epoch 2→3 → settle → completion injected exactly once. The **digit** path re-confirms identically. A further `ctrl+s` ships nothing (no double-ship). Caret still pins to the recorded value's row on reopen.
- ANSWER-PIN-001 no-ops remain inert on settled statuses: same-value enter on `submitted` performs no `answer.at` rewrite, no epoch bump, no delivery (regression-checked).

### BUG-002 (Major) — Same-value re-answer after rule-2 re-ask delivers ✅ FIXED
- `submit()`'s early return now keys on the **pending set** (`pendingIds.length === 0`), not the answer-signature diff (src/panel/actions.ts:683); pending ids missing from the diff get synthesized card entries so `k`/`details.changed` stay consistent.
- Probe journey: rule-2 re-ask (options `[a,b,c]`→`[a,b,d]`, answer deleted) → re-accept `a` → auto-submit **or** `ctrl+s` delivers the second submission, epoch bumps to 3, card reads `q1: a` → settle → completion. `maybeAutoSubmit`'s transition fires the identical pipeline truthfully.
- Zero-pending `ctrl+s` still flashes "nothing to submit" with no delivery/epoch bump (BUG-008 contract preserved); agent rule-2 reset entries stay filtered out of the shipped card while an unanswered reasked sibling is untouched.

### BUG-003 (Major) — FR-18 confirm on closed (archived) edits ✅ FIXED
- The ripple seam's status gate is now the explicit list `answered | submitted | closed` at all three seams: `acceptOptionIndex` (actions.ts:333), `writeInEnter`'s deferred commit (`beginWriteInConfirm`), and `stageText` (panel.ts:866).
- Probe journeys: editing a **closed** db question to a different value with an `answered` dependent raises the keep/cancel modal, applies nothing until confirmed, then moots the dependent. The **write-in** commit path (closed, different text, victims) defers into the `writein` modal and applies `custom: true` on keep. The **elaboration draft save** path (closed, victims) defers into the `text` modal; per the D-R pin, a draft save never moots victims — verified.
- Closed edits with zero victims still apply directly (no spurious modal); same-value re-commits on closed stay inert (no-op ordering preserved); reasked re-answers stay seam-free by construction (status-list form).

### BUG-004 (Major) — Moot reason rendered in panel views ✅ FIXED
- `evaluateDependsOn` now persists the h2.29 reason on `Question.mootReason` (survives serialize/deserialize; merge.ts defensively clears it for non-moot statuses; "a reason must never outlive moot" — verified cleared on un-moot).
- Probe: after `storage=sqlite`, the dependent's short view renders the reason line including `storage=sqlite`, and `buildOverviewContent`'s moot row names the dependency cause — not the moot question's own answer and not the generic "dependency changed". The completion record shows the cause without a doubled `moot: moot:` prefix.

### BUG-005 (Minor) — Spurious STALE on honest epoch echo ✅ FIXED
- `assertFresh` (guards.ts:267) exempts a **fresh receiver** (epoch 1, zero live questions — the completed-swap state) for all-new-id batches.
- Probe: completed interrogation (epoch 2) → new interrogation echoing epoch 2 → **accepted**, fresh epoch 1 reported. Guard integrity preserved: a mismatched epoch on a **non-empty** state still throws STALE and applies nothing (probe A4); correct epoch+rev edits accepted; bad rev still rejected; `withdrawOmitted` + echo on a completed state accepted.

## Adversarial / regression coverage (no new issues)

Beyond the five journeys, the probes pinned: the full multi-question journey (partial submits → auto-submit on last transition → close pass → completion record carries answers); gate hold withholds before completeness (AUTOSUBMIT-002) and a reasked **gate** question re-confirms and ships; closed re-ask revives as `answered`(pending) with answer kept (merge reopen-same) and the non-TUI `answers[]` same-value re-record ships (fallback path, epoch required per guard — spec'd); deep-view same-value re-confirm returns to the short form (acceptFromDeep outcome signal); write-in kind preservation across a rule-1 re-ask (`custom: true` kept); the REAL factory wiring (tool/command registration, panel mount via `ui.custom`, lifecycle marker, completion injection exactly once).

Two initially-suspicious behaviors were investigated and confirmed **spec-correct, not bugs**: (1) a `moot` question blocks completion until resolved (spec h3.9 moot-inclusive predicate; moots are resolved by re-upsert revival — they are not withdrawable, merge.ts), and (2) an elaboration draft save never invalidates dependents (decisions.md FR-18 closed-edit pin).

## Issues found

**None.** All five PRD bugs verified fixed; full suite (1306 tests) + typecheck + keymap guard green; 166 independent public-seam checks green; no regressions introduced by the fixes.

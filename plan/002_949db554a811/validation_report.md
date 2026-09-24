# Validation Report — pi-interrogator

**Date:** 2026-09-24 · **Validator scope:** deep codebase analysis, spec/PRD + `plan/002_949db554a811/tasks.json` conformance, scripted E2E, live RPC round trip.
**Repo state validated:** commit `782e2fe` (note: the tree advanced once during validation — `68da1a0` → `782e2fe`; findings re-verified against the final state).

## Verdict

**3 issues found (2 major, 1 minor).** The shipped *code* for all three delta phases (P1 write-ins, P2 auto-submit, P3 surfacing gates) is implemented and behaviorally correct — verified by the 1222 passing tests, a 38-check E2E walkthrough of the real factory, and a live model-backed RPC round trip. The issues are exactly the **unfinished P4 delta-closure work**: two stale tests leave the suite red, the README was never synced to the changeset, and `tasks.json` statuses have drifted.

## What was validated (evidence)

| Check | Result |
|---|---|
| `npm run typecheck` (tsc --noEmit) | ✅ clean |
| `npm test` (vitest run, 48 files / 1224 tests) | ❌ **2 failed** (`src/reload-invoke.test.ts`) — Issue 1 |
| `scripts/verify-keymap-conflicts.sh` | ✅ no default collides (9 keys vs 11 avoided + live extension claims) |
| Static residue greps (`advanceArmed`, `registerShortcut`, retired command registrations in non-test src, skipped/only tests) | ✅ clean |
| Scripted E2E — 6 journeys × 38 checks through the **real factory** (`src/index.ts` with fake-ctx harness, per the repo's AUTOMATION-POLICY) | ✅ 38/38 |
| Live RPC round trip (`scripts/remote-rpc-itest.mjs`, real `pi --mode rpc` + model) | ✅ PASS — model upserts 2 questions → `itg:` bridge flow → conformant client submits (option + customText write-in) → submission delta → agent reply → completion record |

**E2E journeys covered** (mirroring README "Usage" and the acceptance criteria):
- **J1 planner happy path (TUI):** upsert → panel auto-opens on the upsert → suspend → widget names `/interrogate` only (no key chord) → `interrogate({})` read completes **without** surfacing the panel → `/interrogate` resumes → answer-all via the debug submit surface (production pipeline) → one delta with epoch reminder → `agent_settled` → completion record injected exactly once, names goal + answers.
- **J2 restart (SURFACE-002):** reload reconstruction installs state silently — **no panel**, widget cue set, `/interrogate` reopens restored state.
- **J3 non-TUI digest (AC-11):** print mode returns numbered markdown digest, no panel; `answers[]` records chat answers; settle injects completion once.
- **J4 staleness guards (AC-8):** wrong `rev` → STALE rejection with current rev; re-apply heals.
- **J5 remote bridge (pi-ask contract):** `started` flow with all live questions (`itg:` namespace) → client submit → **one** submission delta through the same pipeline → `submit-result ok:true` → flow `completed` → resurface flow for remaining questions; customText-only answer lands as `custom: true` write-in (WRITEIN-001 bridge parity).
- **J6 foreign flowId:** submit for a non-`itg:` flow → no submission, no state change.

**PRD/task conformance sweep:** WRITEIN-001/002 (Other row, three editor duties, commit-at-enter, role-binding, `✎ {text}` display across diff/read/completion/overview surfaces), AUTOSUBMIT-001/002 (`maybeAutoSubmit` after every commit incl. bridge tail, gate-hold line with config-resolved submit label, `submit pending first` edge deleted, epoch-per-firing), and SURFACE-001/002 (three-gate `maybeAutoOpen`, gated suspended-reopen, widget-only reconstruction, silent tree-nav) are all present in code, pinned by the flipped tests, and exercised end-to-end above.

---

## Issues

### Issue 1 — MAJOR: 2 failing tests leave the suite red (unfinished P4.M1.T1.S1 sweep)

`npm test` exits 1. `src/reload-invoke.test.ts` fails at **:165** and **:202** (`test_reload_then_interrogate_invokes_panel_immediately_no_key_gate`, `test_reload_suspended_panel_interrogate_resumes_immediately`). Both pins assert that `session_start {reason:"reload"}` **auto-opens the panel** (`expect(pi2.customCalls.length).toBe(1)`), which is pre-SURFACE-002 behavior. The shipped production behavior (P3.M2.T1.S1, commit `68da1a0`) is correct: reconstruction never opens the panel and sets the suspend widget instead — verified by the E2E J2 journey and the already-flipped `reconstruct.test.ts` / `ac-panel.test.ts` (33/33 green).

These two pins are precisely the fallout the in-flight P4.M1.T1.S1 PRP documents as unresolved: *"src/reload-invoke.test.ts:165 and :202 … still pin session-start auto-open … and are NOT covered by P3.M2.T2.S1's test-flip list."* The verification sweep that must flip them was started (untracked `plan/002_949db554a811/P4M1T1S1/`) but not completed.

**Impact:** the delta's own gate ("`npm test` → 0 failed test files") is red; CI-style confidence and the P4.M1.T1.S2 docs task (blocked on this gate) cannot proceed.
**Fix:** flip both pins to the widget-set/no-panel semantics (same pattern P3.M2.T2.S1 applied elsewhere: assert `customCalls.length === 0` after reload `session_start` and the widget line present, then continue the `/interrogate` resume flow from the suspended state).

### Issue 2 — MAJOR: README.md contradicts the shipped behavior (P4.M1.T1.S2 never executed)

The changeset-level README sync required by the plan ("sync README to the whole changeset — write-ins, auto-submit, surfacing, hotkey table, AC list 2a–2d + 15, two-stage references removed") has not been done. A user reading the README today gets instructions that are wrong against the shipped code:

| Line | Stale claim | Shipped behavior |
|---|---|---|
| 36 | "Explain then press `enter`, `enter` — the highlighted option is accepted…" | Two-stage arming removed (WRITEIN-001, commit `1c434ea`); `enter` commits per editor duty. |
| 61 | "Auto-(re)open happens only on the first model upsert and **after a session restart/resume**." | SURFACE-002: restart/resume **never** auto-opens; the suspend widget is the only cue, `/interrogate` reopens. |
| 171 | "`enter` … in the editor: save + return to options" | In write-in/text duty `enter` **commits the answer** (commit-at-enter). |
| 181 | "The free-text 'explain' field is an elaboration, **not an answer of its own** (on choice questions)" | Superseded by the ✎ **Other — write your own** row: a write-in IS the answer (`custom: true`). README never mentions the Other row, completeness auto-submit (AUTOSUBMIT-001), or gate hold (AUTOSUBMIT-002) anywhere. |
| 202 | "bare use **toggles** the panel" | `/interrogate` is INVOKE-ONLY, never a toggle (contradicts the README's own step 4). |
| 247–250 | Development table lists retired top-level commands `/interrogate-ping`, `/interrogate-debug-upsert/submit/state` | Collapsed into `/interrogate ping` / `/interrogate debug …` subcommands (CMD-001); contradicts the README's own "Subcommands" section. |

Also missing: `remote-bridge.ts` / `remote-submit.ts` in the project-structure listing; the mandated AC-list extension (2a–2d, 15) and hotkey-table updates (`focusText` duty semantics, "real options only" digits note).

**Impact:** user-facing docs actively mislead (the toggle claim and the restart auto-open claim describe removed behavior; the two-stage recipe is a dead end). The delta's deliverable list is incomplete.
**Fix:** execute P4.M1.T1.S2 as specified. `validate.sh` Phase 6 machine-checks the five claim markers above and will pass once the sync lands.

### Issue 3 — MINOR: `plan/002_949db554a811/tasks.json` status drift + uncommitted in-flight artifacts

- `P2.M1.T3.S1` ("Bridge tail: maybeAutoSubmit + customText parity") is still `Ready` (and phase P2 `Ready`) although the work is **implemented and green** (commit `f126a42`; suite + E2E J5 verify the tail hook, the `customText`-only → `custom:true` mapping, and the auto-submit at the bridge tail). Status was never advanced.
- `P4.M1.T1.S1` is `Ready`/in-flight with the known red suite unresolved (Issue 1); `P4.M1.T1.S2` is `Planned` (Issue 2) — i.e. the delta is not closed, consistent with Issues 1–2.
- Untracked directory `plan/002_949db554a811/P4M1T1S1/` is left uncommitted.

**Impact:** an orchestrator resuming from `tasks.json` would re-dispatch the already-complete P2.M1.T3.S1 or mis-sequence the delta close.
**Fix:** advance `P2.M1.T3.S1` (and P2 milestone/phase) to reflect reality; commit the P4M1T1S1 artifacts (or finish the sweep, then commit).

---

## Non-issues (checked, clean)

- **Extension loading / factory:** registers exactly one command (`interrogate`), one tool, no global shortcut; correct `pi.on` subscriptions in the documented order (lifecycle end-handler before the deferred bridge emission; `maybeAutoOpen` peeks the args stash non-consumingly).
- **Label discipline:** every key-naming display string resolves through `resolveKeyLabels` (no hardcoded chords outside `DEFAULT_CONFIG` — `no-hardcoded-keys.test.ts` green).
- **Duplicate-summary sync:** `snapshots.ts answerSummary` and `delivery.ts completionAnswerSummary` both carry the `custom` write-in branch with the sync comment intact.
- **Live RPC itest:** PASS with a real model — the strongest end-to-end evidence available under the AUTOMATION-POLICY (no live TUI, no waiting on users).
- **Compaction/branching, drafts, debug subcommands, round detection, terminal fallbacks:** covered by the 1222 passing tests; no residue or deviation found.

## How to re-validate

```bash
./validate.sh
```

Phases: preflight → static guards → typecheck → unit tests → keymap guard → README drift → scripted E2E (38 checks) → live RPC round trip (SKIP-tolerant when no model is configured). Exit 0 only when everything passes. Current expected outcome: **FAIL** on `unittest` (2 stale pins) and `docs` (5 stale README markers) — the machine-checkable form of Issues 1 and 2.

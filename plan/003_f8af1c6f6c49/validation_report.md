# Validation Report — pi-interrogator

**Date:** 2026-10-07 · **Validator scope:** deep codebase analysis, spec/PRD + `plan/003_f8af1c6f6c49/tasks.json` conformance (including the completed ANSWER-PIN-001 delta and the 2026-10-02 remote-bridge removal), scripted E2E through the real extension factory.
**Repo state validated:** commit `67eecd7` plus uncommitted working-tree changes. Note: the tree advanced once during validation — a concurrent session landed an uncommitted **DEEP-PIN-001** change (pinned question region in the deep view; `src/panel/deep-view.ts`, its tests, `ac-panel.test.ts`, spec ui/decisions edits; suite grew 1258 → 1261 tests). All findings and every phase below were re-verified against the final settled state (last edit 17:13; final full run 17:29). Remaining uncommitted plan/ changes are bookkeeping only (renumbered plan/003 subtask ids, one stale PRP dir deleted).

## Verdict

**2 issues found (1 major, 1 minor).** The core product is in excellent shape: all 1261 unit tests green across 46 files (including the concurrent DEEP-PIN-001 change), typecheck clean, keymap guard clean, no residue of any removed surface (two-stage arming, global shortcut, retired commands, remote bridge), and the entire ANSWER-PIN-001 delta (plan/003) is implemented exactly to spec and verified end-to-end through the real factory. The two issues are both in panel **resurfacing edge paths** (unrelated to the deep-view work that landed mid-validation): (1) the model's `{reopen:true}` after a session restart silently fails while reporting success — the `/interrogate` command handles the identical state correctly; (2) `/tree` navigation never refreshes the displayed suspend-widget line, which the spec explicitly says must reflect the destination branch.

## What was validated (evidence)

| Check | Result |
|---|---|
| `npm run typecheck` (tsc --noEmit) | ✅ clean |
| `npm test` (vitest run, 46 files / 1261 tests) | ✅ all green |
| `scripts/verify-keymap-conflicts.sh` | ✅ no default collides (9 keys vs 11 avoided + live extension claims) |
| Static residue greps (advanceArmed, registerShortcut, retired commands, skip/only tests, remote-bridge artifacts, stale preselect claims, tool-schema pinning string byte-exact) | ✅ clean |
| README drift machine-checks (9 stale-claim absent checks + 6 current-contract present checks) | ✅ pass |
| Scripted E2E — 9 journeys × 105 checks through the **real factory** (`src/index.ts`, fake-ctx harness per the repo's AUTOMATION-POLICY; config isolated via `PI_CODING_AGENT_DIR`) | ❌ **2 failed** — Issues 1 & 2 (103/105 pass) |

**E2E journeys covered** (mirroring README "Usage" and the acceptance criteria):

- **J1 planner happy path (TUI):** upsert → panel opens on the upsert → suspend → widget names `/interrogate` only (no key chord) → `interrogate({})` read completes **without** surfacing → `/interrogate` resumes → answer-all via the debug submit surface (production pipeline) → one delta with epoch reminder → `agent_settled` → completion injected exactly once, names goal + answers.
- **J2 answer pinning (AC-16 / FR-35, the plan/003 delta):** non-recommended accept → dependent `dependsOn` question un-moots instantly (FR-17) → revisit pins the caret to the **recorded** answer's row (★ stays on row 0, caret on row 1) → `enter` on the recorded value is a zero-state-change advance (no `answer.at` rewrite, no epoch bump, no FR-18 modal, no auto-submit) → digit on the recorded value equally inert → a **different** choice raises the FR-18 invalidation confirm, `esc` cancels cleanly → write-in commits as `answer.value` with `custom:true`, pins the caret to the `✎ Other` row → byte-identical write-in re-commit inert → manual submit renders `✎ {text}` in the delta → post-submit auto-suspend (FR-3d).
- **J3 auto-submit (AC-2c/2d):** last-answer transition ships with no keypress beyond the answer (`submitted — 2 answer(s)` flash, exactly one epoch bump, panel suspends); gate hold withholds the auto-submit and arms the non-expiring `⚠ foundational unanswered` line; answering the gate releases the transition.
- **J4 elaboration duty (AC-2b):** `ctrl+t` → draft saved, question still unanswered; option accept attaches the draft as `answer.text` and ships.
- **J5 restart (SURFACE-002):** reconstruction installs state silently — no panel, widget cue set; `/interrogate` reopens restored state. **+ FR-6 reopen probe (Issue 1).**
- **J6 tree navigation:** `session_tree` never opens the panel; state follows the branch; teardown clears the widget on interrogation-free branches. **+ suspended-reminder-line probe (Issue 2).**
- **J7 non-TUI digest (AC-11):** print mode returns the numbered markdown digest; `answers[]` recorded epoch-guarded; completion injected on settle.
- **J8 staleness guards (AC-8):** wrong `rev` → STALE rejection; wrong `epoch` → rejected; re-apply with current rev+epoch heals.
- **J9 surfacing matrix (SURFACE-001) + phantom regression:** reads never surface with open/all-answered/completed states; a description-only edit over an answered set surfaces nothing; a re-ask upsert (unanswered remain) reopens; `{reopen:true}` on a *suspended* host resurfaces; a forged `@eko24ive/pi-ask:submit` event mutates nothing (bridge removal regression); `/interrogate` on dead state notifies instead of opening.

**PRD/task conformance sweep:** every plan/003 subtask's output contract was checked in code and behaves as specified — `initialCursorIndex` pins to the recorded answer (custom → `✎` row; stale value → row 0, never the ★), `acceptOptionIndex` three-outcome (`noop|accept|veto|false`) with the no-op branch **before** the ripple seam, `writeInEnter` byte-identical re-commit inert with buffer consume, `acceptFromDeep` treats no-op as accept (veto stays in deep), `statusMarkers` ★ answered marker with overview parity and ⟳ override, tool-schema string byte-identical to spec, `maybeAutoSubmit` carries the AUTOSUBMIT-003 transition gating with the BUG-001 gate-hold reorder, the comment sweep is complete (remaining "preselects the recommendation" mentions are explicit *supersedes* documentation, which is correct). Tool description is 119 words (≤120 contract); 4 promptGuidelines bullets per the amended spec. plan/003 `tasks.json` dependency graph is consistent after the uncommitted renumbering (no dangling ids), all statuses `Complete` and match reality.

---

## Issues

### Issue 1 — MAJOR: `{reopen:true}` after a session restart reports "Panel reopened." but opens no panel (FR-6)

**Spec citations:** FR-6 ("The agent may reopen the panel at its judgment via `interrogate({reopen:true})`"), ui-spec.md §Suspend/resume ("agent `{reopen:true}` → same resume path"), AC-4's reopen arm, tool-protocol.md's `{reopen:true}` action ("Resurface panel → Confirmation").

**Reproduction (E2E J5, deterministic):** a fresh process where reconstruction has installed live state and the panel has never been opened (exactly the post-restart state, which SURFACE-002 deliberately creates) → `interrogate({reopen:true})` → tool result text: `0/1 answered · 0 re-asked · 0 moot · epoch 1` + **"Panel reopened."** — while **zero** `ui.custom()` panels mount. The `/interrogate` **command** run against the identical state opens the panel correctly (`customCalls: 1`).

**Root cause:** `src/index.ts`'s `onReopen` hook only calls `resumePanel(resumeSurface)` → `resumeOpenPanel()` (`src/panel/panel.ts:1939`) which returns `false` when `lastOpts === undefined` (panel never opened this process). Two compounding defects:
1. The closed-host-with-live-state row is missing entirely from the tool path. `src/command.ts`'s `interrogateInvokeAction` has it ("Closed host (or the defensive resume miss above): with live state, open a FRESH panel from the session singleton — the reload row"); the tool's hook was never given the same fallback.
2. The hook ignores `resumePanel`'s boolean and unconditionally returns `"reopened"`, so the failure is reported as success — the model believes the panel is back, tells the user so, and ends its turn.

**Impact:** after any session restart mid-interrogation (the common "resume tomorrow" flow SURFACE-002 is designed around), the model's judgment-driven reopen — FR-6's entire purpose — silently does nothing while confirming success. The user must know to run `/interrogate` themselves. Unit coverage gap: `src/tool.test.ts` reopen tests mock `deps.onReopen`, and `src/reload-invoke.test.ts` covers only the command path — the real wiring of this row is untested.

**Fix sketch:** in `onReopen`, mirror the command's ladder — if `resumePanel(resumeSurface)` returns `false` and live state exists, `openPanel(resumeSurface, {config, state, drafts})` (the reload row); return `"no-state"` when neither opens anything. Add the never-opened-host reopen test to `reload-invoke.test.ts`.

### Issue 2 — MINOR: `/tree` navigation never refreshes the displayed suspend-widget line; spec §Branching requires it to "reflect the destination branch"

**Spec citation:** state-and-persistence.md §Branching: "Panel suspended → stays suspended, with the host's stored state references retargeted … and **the suspend reminder line reflects the destination branch**."

**Reproduction (E2E J6, deterministic):** panel open → suspended (`esc`; widget lands as `"1 open · 0 answered — /interrogate to resume"`) → `session_tree` to a branch whose interrogation has 5 open questions → widget still reads `"1 open · 0 answered"` indefinitely (until the next open/suspend cycle). The state itself, `lastOpts`, and the resume path all correctly follow the destination branch (verified: nothing opened, resume rehydrates branch-correct) — only the displayed line is stale.

**Root cause:** the session-tree branch of `src/reconstruct.ts` calls `retargetState()` (which swaps `lastOpts.state` and re-arms the upsert subscription but never writes the widget) and suspends an *open* panel (that landing path does rewrite the widget correctly — the open-at-navigation case works). For an *already-suspended* panel there is no suspend landing, and nothing else calls `updateSuspendWidget` — the displayed line is written only at suspend landing and at `session_start` reconstruction.

**Sub-case (observation, spec-silent):** a host whose panel was never opened this process (e.g. post-restart, widget set by `session_start`) that navigates to a *different* branch with a live interrogation also keeps the old branch's counts; and when the widget was never set (start branch without interrogation → destination with one), no cue appears at all, though the SURFACE-002 design names the widget line as the ambient indicator. I did not rate this sub-case separately since the spec does not explicitly pin it.

**Impact:** display-only. The user is never stranded (`/interrogate` always works and the line still names it whenever present), but the counts can be actively wrong (advertising the abandoned branch's workload) or absent. One-line fix: after the retarget in the session-tree branch, call `updateSuspendWidget(ctx, state)` when the host is suspended-or-never-opened and `hasResumableQuestions(state)` (set/clear rule already centralized in `panel/suspend.ts`).

---

## Non-issues (checked, clean)

- **Remote bridge removal (2026-10-02):** no `remote-bridge.ts`/`remote-submit.ts`/`scripts/remote-rpc-itest.mjs`; no `@eko24ive/pi-ask` references outside the phantom regression guard, which correctly pins both factory non-subscription and forged-submit inertness (re-verified live in J9).
- **ANSWER-PIN-001 comment purge:** zero stale status-agnostic-preselect claims; the two mentions of the old contract (`src/panel/panel.ts` editor-close re-seed, `src/command.ts` breakOut note) document the *supersession*, which is the required outcome.
- **Label discipline / hardcoded keys:** `no-hardcoded-keys.test.ts` + `keymap-guard.test.ts` green; every key-naming string resolves through config.
- **Widget contract:** names `/interrogate` only; no key chord appears anywhere in widget/footer strings (verified by regex in J1).
- **Autosubmit flash + post-submit exit coexistence:** the flash is set before the suspend landing disposes the panel — observable synchronously; the E2E driver asserts it in the right window (a driver-harness subtlety, not a product issue).
- **plan/003 bookkeeping:** the uncommitted `tasks.json` renumbering leaves a consistent dependency graph and truthful `Complete` statuses; deleted `P1M1T2S6/` PRP is superseded by the renumbered `P1M1T2S3/`.
- **Environmental observation (not a codebase issue):** the user's global `~/.pi/agent/settings.json` still carries `interrogator.remote.displayDigest: true` — residue of the removed bridge surface. Tolerant config loading ignores it (no code reads `remote`); harmless at runtime, but the stale key could be deleted by the user for hygiene.

## Bottom line

The codebase is production-solid for every flow a planner or agent exercises day-to-day — question rounds, write-ins, elaborations, auto-submit, gate hold, restart, surfacing discipline, staleness self-heal, completion — all proven through the real factory wiring, not just unit seams. The two findings sit in resurfacing edges introduced by the SURFACE-002 restart design (never-opened host) and the tree-navigation contract; both are small, precisely located, and have clean fix sketches. Until Issue 1 is fixed, the practical workaround is the `/interrogate` command, which handles the post-restart reopen correctly.

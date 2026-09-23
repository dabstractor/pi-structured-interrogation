# System Context — pi-interrogator delta (spec M8: WRITEIN / AUTOSUBMIT / SURFACE)

Derived from 4 research lanes (see sibling files). Ground truth: repo at commit `60826a2` (working tree clean), 48 vitest test files, `npm test` = `vitest run`, `npm run typecheck` = `tsc --noEmit`.

## Scope discipline

**Already shipped — do NOT rebuild** (cite only): remote bridge FR-31..34 (`ed8cc37`..`2563958`), patch-semantics upsert + `{}` full reads (`3272dfb`), deep-view quality floors (`9a1b880`), 2026-09-16 pins (ESC-002 `9e14e81`, EXPLAIN-001..003 `adf591c`/`87be571`/`51b05da`, CTRL-C-001 `677ec00`, CMD-001 `787bcda`, RESUME-001 `2be3a71`, ←/→ nav `37dee13`), ctrl+shift+q removal (`37103c7`), cold-resume heal (`0acd873`), silent `/tree` (`5a0559a`), 2026-09-14 singleton/epoch pins.

**This delta = the unshipped M8 remainder**: WRITEIN-001/002, AUTOSUBMIT-001/002, SURFACE-001/002, supporting shape/display/test-flips/docs.

## Verified seam map (exact symbols, file:line)

| Seam | Where | Current behavior |
|---|---|---|
| Explain affordance | `short-view.ts:64` `EXPLAIN_AFFORDANCE = "✎ explain…"`, rendered by `explainLine` (:220) | last row of choice questions, cursor index `options.length` |
| Cursor domain | `actions.ts:125` `cursorDomainSize` = options+1 | already includes the ✎ slot |
| Digits | `actions.ts:187` `digit` | already excludes index `options.length` — add explicit test only |
| Accept routing | `actions.ts:208` `accept`; index `options.length` → `panel.focusTextField()` (panel.ts ~:1035) | today opens the explain field |
| Option commit | `actions.ts:232` `acceptOptionIndex`: ripple seam (answered/submitted) → `applyAnswer(q.id, {value, at})` → `evaluateDependsOn` → `advanceAfterAccept` (`nextUnanswered` :105, open/reasked) | write-in commit must mirror this with `custom: true` |
| Two-stage machinery | `panel.ts:412` field, :742 disarm, :749–755 stage-2, :866 arm in `commitTextDraft`; `arm` threads through `saveTextDraft`/`stageText`/`exitTextField`/`beginTextConfirm`/ripple-confirm | REMOVE — full removal-safety map in `panel-ui-seams.md` |
| Submit pipeline | `actions.ts:358` `submit()` → `reconcileDraftsForSubmit` (:318) → `computeDiff` → BUG-008 filter (:372–383) → `markSubmitted` → `buildSubmission` (delivery.ts:140; takeSnapshot+bumpEpoch :185–186) → `deliverSubmission` (:497) → `noteSubmissionDelivered` | reused verbatim by `maybeAutoSubmit` |
| Draft flush | `reconcileDraftsForSubmit` :318 — text q → `{value: draft}`; choice → `{...answer, text}` | becomes role-binding (WRITEIN-002) |
| Footer flash | `panel.flash(text)` :910 (2.5 s) | use for `submitted — {n} answer(s)` |
| Gate warning | `gate.ts:105` `⚠ {n} foundational unanswered — later answers may shift` (submit-time, any-key dismiss) | KEEP (ctrl+s partial path); ADD commit-time hold line (FR-D5) — strings differ by design |
| Overview marker | `overview.ts:121` — `✎` currently = non-empty `answer.text` suffix | becomes: write-in (`answer.custom`) or text answer |
| Deep view | NO ✎ row today (`deepSeedCursorIndex` clamps to options−1) | add Other section + ramification |
| Answer types | `QuestionAnswer {value, text?, at}` state.ts:42–49; `AnswerInput {id, value, text?}` tool-schema.ts:156; `narrowAnswer` tool-schema.ts:494 | no `custom` concept anywhere yet |
| State commit | `applyAnswer` state.ts:354 (copies answer, status→answered, emits); `bumpEpoch` :392; `reviveQuestion` :557 | `reviveQuestion` must carry `custom` or reconstruction drops it |
| Display chokepoints | `snapshots.ts answerSummary` :124 AND its BY-DESIGN duplicate `delivery.ts completionAnswerSummary` :269 (sync comment — change BOTH); card line `renderers.ts:171`; read one-liner `results.ts:240`; completion lines `delivery.ts:355` + recap `renderers.ts:371`; fallback digest shows no answers (no change needed beyond schema) | `✎ {text}` branches |
| maybeAutoOpen | `panel.ts:1759`, wired at `index.ts:152` | SURFACE-001 BUG: opens on ANY successful interrogate end (toolName + !isError + host-closed + state exists) — reads and post-completion reads pop the panel |
| Args stash | `index.ts:215` `pendingUpsertArgs` Map; populated at tool_execution_start (:219), consumed+deleted by the bridge emission handler (:224–225) which is registered LAST (after lifecycle's rule-1 flip) | SURFACE-001 needs a non-consuming peek for the lifecycle handler registered EARLIER — do not break the deferred bridge emission order |
| handleUpserted | `panel.ts:1429` (suspended-reopen on `questions-upserted`) | needs same unanswered gate |
| Reconstruction | `reconstruct.ts:478` `openPanel(...)` on session-start TUI, no unanswered filter; `onRestored` (FR-34) at :472; non-TUI flag :455; session_tree silent path already exists (:459–466) | SURFACE-002: replace openPanel with widget; keep onRestored |
| Widget | `suspend.ts:117` line `` `${n} open · ${m} answered — /interrogate to resume` ``, `WIDGET_KEY="interrogator"`, `updateSuspendWidget` :135, `hasResumableQuestions` :66 | reuse for SURFACE-002 |
| Bridge submit | `remote-submit.ts:90` `recordRemoteSubmission` — 9 steps; `customText` maps via `mapWireAnswers` (remote-bridge.ts:371–395) to `answer.text` or freeform `value`, NO custom flag; maybeAutoSubmit slot after step-9 `noteSubmissionDelivered` (:131) + `nothing_shippable` return (:121) | has NO panel access — inject a dep via `RemoteSubmitDeps`/`RemoteBridgeOptions` |

## Binding constraints

- **AUTOMATION-POLICY** (plan/001_0d6760db6bc5/AUTOMATION-POLICY.md): scripted vitest only — never live TUI, never real `interrogate` calls, never waiting on user answers. ACs proven by vitest with fake ctx/tui + `render(width)` sweeps; interactive-only checks defer to MANUAL-TUI-AC-RUNBOOK.md.
- **no-hardcoded-keys guard** (`src/no-hardcoded-keys.test.ts`): regex `ctrl+[a-z0-9]` anywhere in non-test src, comments stripped; only `DEFAULT_CONFIG` allowlisted. Every key mention in runtime strings must interpolate `resolveKeyLabels(config)` (config.ts:449). `keymap-guard.test.ts` separately pins defaults + `ALL_ACTIONS` completeness.
- **Implicit TDD**: every subtask = failing test → implement → pass. No "write tests" subtasks.
- **Test-flip ledger** (exact rows): `tree-nav-repro.test.ts` :143 & :183 flip `1→0 customCalls` (reads-never-surface); :86/:119 stay green. `reconstruct.test.ts` :204/:260/:370 and `ac-panel.test.ts` AC-9a/b/c (:846/:881/:899) + AC-10 (:1062) flip `opened:true → false`.
- **two-stage.test.ts** rewrite: drop describes at :175 & :265; keep :294 (newline), :362 (note), :442 (refocus), :491 (history).
- **Panel test harness pattern**: `new InterrogationPanel` directly + `{requestRender: vi.fn()}` TUI stub + `stubTheme` (see actions.test.ts / panel.test.ts).
- **Final strings ledger** (verbatim UI strings incl. Other row label, region labels, flashes, gate-hold line): `config-tests-docs.md § Final strings ledger`. Use verbatim.
- **No new config surface, no new pi API** (delta non-goals). README hotkey table 151–162, config ref 98–150, Limitations 214–234; delta touchpoints at lines 34/36/42, 107–114, 159–162, 181–184, 274–275.

## Build order rationale

P1.M1 (state/display) has no UI dependency and unlocks P1.M2 + P2 in parallel. P1.M2 removes two-stage only after both new duties exist (removal-safety map). P2 reuses `submit()` verbatim. P3 is independent of P1/P2 except AC-9 (pending-ship semantics need P2.M1.T1). Final task sweeps suite + README (Mode B).

# Delta PRD — pi-interrogator: write-ins, completeness auto-submit, surfacing gates (spec M8)

**Driver:** spec commit `60826a2` ("Spec: pin write-in, auto-submit, and surfacing gates", 2026-09-19 pins). The spec/ directory already contains the full amended PRD; this delta covers ONLY the gap between the shipped code and that spec.

## Diff analysis (previous PRD → current PRD)

The PRD diff is large in raw lines, but **most of it is already implemented**. Verified against the repo (git log through `60826a2`; working tree clean):

**Already shipped — NO tasks in this delta** (cite, don't rebuild):
- Remote bridge FR-31..34 (`remote-bridge.ts`, `remote-submit.ts`, config `interrogator.remote`, live-RPC deadlock fixes) — commits `ed8cc37`..`2563958`.
- Patch-semantics upsert (`withdrawOmitted`, surgical `questions[]`) + full-content `{}` reads — `3272dfb`.
- Deep-view quality floors (`minDescription`/`minRamification`), expanded schema prose, 3rd/4th promptGuidelines bullets — `9a1b880`, `3272dfb`.
- 2026-09-16 pins: ESC-002 (`9e14e81`), EXPLAIN-001/002/003 (`adf591c`, `87be571`, `51b05da`), CTRL-C-001 (`677ec00`), CMD-001 (`787bcda`), RESUME-001 (`2be3a71`), ←/→ fixed-key nav (`37dee13`).
- ctrl+shift+q removal + invoke-only `/interrogate` (`37103c7`), command-only widget line, cold-resume phantom-panel heal (`0acd873`), silent `/tree` suspension + state retarget (`5a0559a`).
- 2026-09-14 pins: second-interrogation singleton reset, epoch-only-on-existing-ids.

**This delta — the unshipped remainder (spec M8):**
1. **WRITEIN-001/002** — synthetic `✎ Other — write your own` write-in row; one editor, three duties (write-in | elaboration | note); enter commits wherever text completes an answer; **remove** the `advanceArmed` two-stage machinery; draft role binds to the selection at commit/submit.
2. **AUTOSUBMIT-001/002** — every answer commit auto-submits through the exact `ctrl+s` pipeline when zero open/reasked questions remain; gate hold with ⚠ line + `ctrl+s` override.
3. **SURFACE-001/002** — panel opens ONLY via `/interrogate`, an upsert leaving unanswered questions, or `{reopen:true}`; reads NEVER surface; session-start auto-open disabled entirely (widget line instead).
4. Supporting: `answer.custom` state marker + `✎ {text}` display everywhere; bridge customText-only parity; test flips/rewrites; docs sync.

**Removals (awareness, no tasks beyond the above):** two-stage arming (`panel.ts:412`, `:735-760`, `:866`; `src/panel/two-stage.test.ts`); reconstruction `openPanel` call (`reconstruct.ts:478`); the "submit pending answers first" edge (completeness ships itself).

## Existing work to modify (seams verified in code)

| Seam | Location | Change |
|---|---|---|
| `EXPLAIN_AFFORDANCE` const | `src/panel/short-view.ts:64` (`"✎ explain…"`) | becomes `✎ Other — write your own` row at cursor index `options.length` |
| `cursorDomainSize` / `accept` / `acceptOptionIndex` / `digit` | `src/panel/actions.ts:125/208/232/187` | Other row semantics; digits already exclude index `options.length` (keep + test); write-in commit path |
| Two-stage machinery | `src/panel/panel.ts:412, 735-760, 866` | REMOVE; enter commits write-ins directly |
| `submit()` + `reconcileDraftsForSubmit` | `src/panel/actions.ts:358` | role binding (WRITEIN-002); reused verbatim by `maybeAutoSubmit` |
| `maybeAutoOpen` | `src/panel/panel.ts:1759` (called from `src/index.ts:152`) | add SURFACE-001 gates (upsert-call, unanswered-exist, not-completed) |
| `pendingUpsertArgs` stash | `src/index.ts:215-224` (already exists for bridge emission) | reuse to detect "call was an upsert" |
| `handleUpserted` suspended-reopen | `src/panel/panel.ts:1429` | same unanswered gate |
| Reconstruction auto-open | `src/reconstruct.ts:478` (`openPanel(...)` on session_start) | replace with widget set; keep `onRestored` bridge emission (FR-34) |
| Widget helper | `src/panel/suspend.ts:124-140` (`hasResumableQuestions` → `setWidget`) | reuse for SURFACE-002 restart cue |
| `recordRemoteSubmission` | `src/remote-submit.ts:90` | `maybeAutoSubmit` at tail; customText-only → `custom: true` |
| Answer shape | `src/tool-schema.ts:156` (`AnswerInput`), `src/state.ts` (`QuestionAnswer`) | add `custom?: boolean` |
| Display of answers | `src/renderers.ts`, `src/completion.ts`, `src/results.ts`, `src/fallback.ts`, `src/snapshots.ts` | write-ins render `✎ {text}` |
| Deep view / overview | `src/panel/deep-view.ts`, `src/panel/overview.ts:121` | Other section + extension-supplied ramification; `✎` marker = write-in/text answer |

## Phase D1 — Write-ins, editor duties, answer shape (WRITEIN-001/002)

### Milestone D1.M1 — The write-in row and three editor duties

**FR-D1 (modifies FR-12, FR-7/8/11):** Every choice question's option list ends in a synthetic `✎ Other — write your own` row (last row, cursor index `options.length`, fixed, not digit-selectable — `digit()` already excludes it; add the explicit test).
- Accepting Other makes the embedded editor the **write-in duty**: region labeled `OTHER — this text is the answer`; seeds from the question's draft (existing `focusTextField` seeding path, `actions.ts:208` seam); `enter` COMMITS `applyAnswer({ value: <text>, custom: true })` → status `answered` → dependsOn recompute → advance (Q14 parity). Empty buffer + enter = save draft + blur, NO commit.
- `ctrl+t` (`keys.focusText`, existing toggle) enters **elaboration duty**: region labeled `EXPLAIN — attaches to your selection`; `enter` saves + blurs, never advances, never answers. While the cursor sits on the Other row (or the question is `type:"text"`), `ctrl+t` enters write-in duty instead — the duty follows entry path and cursor position.
- Note duty unchanged (R3). All existing exit gestures (enter per-duty, `ctrl+t` re-press, double-esc, ctrl+c) remain draft write-throughs (R4).
- Deep view gains the Other section after the last option with the extension-supplied ramification verbatim from ui-spec.md; selectable from deep view like any option. Overview `✎` marker = write-in (`answer.custom`) or text answer.
- Ripple confirm (FR-18): a write-in commit on an answered question routes through the same keep/cancel modal as any edit (the applied commit then runs the D2 auto-submit check).

**FR-D2 (WRITEIN-002, modifies FR-21 flush):** One draft slot per question; role binds at commit/submit from the selection: real option → draft ships as `answer.text`; Other/text → draft IS the answer (`answer.value`, `custom: true`). Superseding a write-in with an option accept KEEPS the slot (R4) and re-binds it as elaboration. Held elaboration with no answer ships nothing; the zero-pending `ctrl+s` flash becomes `nothing to submit — {n} question(s) have drafts awaiting an option or Other`.
- **REMOVE** the two-stage machinery (`advanceArmed` arming at `panel.ts:866`, stage blocks at `:735-760`): enter commits in write-in/text duty, saves+blurs in elaboration/note duty. Multi-line typing unchanged (`shift+enter`/`ctrl+j`).
- **Docs Mode A:** JSDoc updates on `short-view.ts` (affordance const → Other row), `deep-view.ts` (Other section), `overview.ts` (marker semantics), `panel.ts`/`actions.ts` (three duties, commit-at-enter, role binding), `tool-schema.ts`/`state.ts` (`custom` field).

**FR-D3 (answer shape + display plumbing):** `AnswerInput`/`QuestionAnswer` gain `custom?: true`. Write-ins display as `✎ {text}` (truncated to fit) in: submission diff cards (`renderers.ts`, expanded shows full text), completion record + recap card (`completion.ts`), `{}` read one-liners + status output (`results.ts`), non-TUI digest (`fallback.ts`), snapshot diffs (`snapshots.ts`). Replay/reconstruction stays value-first (no special case). Bridge answer validation accepts custom values as-is (not checked against option lists).

**Acceptance (from spec AC-2a/2b):** accept Other, type, enter → answered with `answer.value = <text>`, `custom: true`, no option selected; card/delta render `✎ {text}`; advances. `ctrl+t` elaboration: draft saved, question still unanswered; option accept attaches it as `answer.text`; accepting an option after a committed write-in keeps the slot text as elaboration.

### Milestone D1.M2 — State/display support (can build first if preferred)

Tasks for FR-D3 plus `state.ts` commit path accepting `{value, custom}` (mirroring `applyAnswer`), renderers/completion/results/fallback display, and unit tests. No UI dependency — enables D1.M1 and D2 in parallel if the breakdown agent splits that way.

## Phase D2 — Completeness auto-submit (AUTOSUBMIT-001/002)

**FR-D4 (modifies FR-3, FR-14):** After EVERY answer commit — option accept (incl. edits of answered questions), Other write-in commit, text `enter`, edit re-commit — run `maybeAutoSubmit(panel, deps)`: if zero questions with status `open`/`reasked` remain AND ≥1 is pending (`answered`), fire the EXACT `ctrl+s` pipeline (`reconcileDraftsForSubmit → baseline/diff → BUG-008 filter → gate check → markSubmitted → buildSubmission → deliverSubmission → noteSubmissionDelivered` — i.e., the existing `submit()` in `actions.ts:358`), flash footer `submitted — {n} answer(s)`, held batch note rides (R3). One submission per commit (deliberate: q2 = every-commit). Epoch bumps per firing (FR — epoch semantics unchanged, just more firings).
- `ctrl+s` remains for partial submits and the gate override; the `submit pending answers first` edge is deleted (completeness ships itself; a user suspended between last commit and delivery resumes to a pending panel — one `ctrl+s` or new commit flushes).
- **Bridge tail:** `recordRemoteSubmission` (`remote-submit.ts:90`) runs `maybeAutoSubmit` at its tail — a bridge partial submit completing the set ships once through the same pipeline; customText-only bridge answers set `custom: true` (WRITEIN-001 parity with the panel's Other row).
- **Docs Mode A:** JSDoc on `maybeAutoSubmit` (the one shared hook; no-ops on zero-pending), `remote-submit.ts` parity note, `state.ts` epoch note (auto-submits bump epoch).

**FR-D5 (AUTOSUBMIT-002, modifies FR-9 soft gate):** While any gate-group question is `open`/`reasked`, auto-submit withholds; the observable behavior is the non-expiring footer warning on commits: `⚠ {n} foundational unanswered — answer them or {submit} to submit now` (any key dismisses, never blocks; `{submit}` from resolved config labels — reuse `resolveKeyLabels`). The completeness rule already covers the common case; ctrl+s is the deliberate override. Ordinary non-gate skips get no warning.

**Acceptance (spec AC-2c/2d):** answering the LAST question submits with no keypress beyond the answer; editing while complete ships the edit immediately; with a gate question unanswered commits show the ⚠ line and do NOT auto-submit; answering the gate question releases the next commit; `ctrl+s` submits anyway.

## Phase D3 — Surfacing gates (SURFACE-001/002)

**FR-D6 (SURFACE-001, new R6; modifies FR-28):** The panel opens ONLY via: `/interrogate`, an agent upsert that leaves unanswered (open/reasked) questions, or `{reopen:true}`. Implement in `maybeAutoOpen` (`panel.ts:1759`): (1) the call was an upsert (`questions[]` non-empty — read the `pendingUpsertArgs` stash in `index.ts:215-224`), (2) unanswered questions exist post-upsert, (3) interrogation not completed. Reads (`{}`) NEVER surface, whatever the state (all-answered, completed, post-`/tree`). `handleUpserted` (`panel.ts:1429`, suspended-reopen path) carries the same unanswered gate — a description-only edit over an answered set surfaces nothing.
- **FLIP the two BUG characterizations** in `src/tree-nav-repro.test.ts` (post-nav read pops panel; read after completion pops panel) to assert no-open; the suspended-at-nav and open-at-nav tests stay green.

**FR-D7 (SURFACE-002, modifies FR-28):** `session_start` reconstruction NEVER opens the panel. Replace `openPanel(...)` at `reconstruct.ts:478` with: set the suspend widget line via the existing `suspend.ts` helper (`hasResumableQuestions(state)` → `setWidget("interrogator", [line])`) — the widget is the only cue; the user runs `/interrogate` (closed-host-with-live-state path already exists) to get the panel back. Keep the FR-34 `onRestored` bridge emission (remote clients still re-render; the panel is the only suppressed surface). Non-TUI fallback flag unchanged. `session_tree` stays silent as shipped.
- **FLIP** the `opened: true` session-start rows in `src/reconstruct.test.ts` (lines ~204/260/370) and the ac-panel restart row to widget-set/no-panel.
- **Rewrite AC-9:** restart pi mid-interrogation → NO panel appears; widget shows live counts; `/interrogate` reopens with questions/answers restored; drafts gone (documented); pending answers ship on next commit/submit.

**Docs Mode A:** JSDoc on `maybeAutoOpen` (allow-list + rationale), `reconstruct.ts` module header (SURFACE-002 — reconstruction's only UI act is the widget line).

**Acceptance (spec AC-15):** with a live interrogation (panel suspended, questions open), a model `interrogate({})` read completes → panel stays closed, editor untouched; same for all-answered and completed states.

## Verification (binding: plan/001_0d6760db6bc5/AUTOMATION-POLICY.md still applies)

- Scripted vitest only — no live TUI, no live tool calls, never waiting on user answers. New ACs 2a/2b/2c/2d/15 + rewritten AC-9 as scripted tests citing the FR each proves; interactive-only checks defer to the human runbook (already outside the repo).
- Rewrite `src/panel/two-stage.test.ts` for commit-at-enter semantics (remove stage arming/disarm cases; keep multi-line and note-exit coverage).
- Full suite (48 test files) + `npm run typecheck` + keymap guard (`src/no-hardcoded-keys.test.ts` — the new ⚠ line names `{submit}` from config, never hardcoded) stay green.

## Sync changeset-level documentation (Mode B — final task, depends on all above)

`README.md`: (1) write-in answers (`✎ Other` row, `custom` answers, elaboration vs write-in distinction); (2) completeness auto-submit — including the deliberate one-model-turn-per-edit trade-off while the set is complete, and gate hold; (3) surfacing policy — restart no longer auto-opens the panel, run `/interrogate`; reads never pop the panel; (4) hotkey table rows updated (`focusText` = elaborate toggle / write-in-on-Other, `enter` context incl. Other row, digits note "real options only"); (5) remove any two-stage references; (6) AC list extended to 2a–2d and 15. No new config keys ship in this delta (verify README needs no config-reference change beyond behavior text).

## Non-goals for this delta

No new config surface · no new pi API usage beyond the already-consumed events · no bridge-side draft preservation (in-surface progress expendable, per D-R6) · no drill-down for ripple confirms · no changes to the FR-25 digest fallback contract.

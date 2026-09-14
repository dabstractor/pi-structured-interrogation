# PANEL-AC-RESULTS — P1.M7.T6.S2 (scripted panel AC pass)

> [Mode A] Results recorded in-plan only. Consumed by P1.M7.T7 (docs record
> AC coverage). Executed under plan/001_0d6760db6bc5/AUTOMATION-POLICY.md
> (BINDING): no live TUI, no real `interrogate` call, no turn ended waiting on
> a user. Every verdict below is backed by a named vitest test driving the
> SAME production panel/render components a real session uses (h2.50) —
> `InterrogationPanel` via `openPanel`/direct construction, the h2.29 layout
> renderers, the keys router, the ripple-confirm flow, `resumeOpenPanel`/the
> suspend widget, `reconstructFromBranch`/`createReconstruction`, the
> `session_before_compact` guard with a REAL `StateMirror`, and
> `createStateMirror`'s `appendEntry` transport.
>
> Suite: `src/panel/ac-panel.test.ts` (10 tests). Full run at time of
> recording: `npm run typecheck` clean; `npm test` 42 files / 924 tests, all
> green (P1.M7.T6.S1's `ac-scripted.test.ts` and P1.M7.T5.S2's
> `config-surface`/`no-hardcoded-keys` suites untouched and passing).

## Per-AC results

| AC | Verdict | FR proven | Evidence (test in src/panel/ac-panel.test.ts) | Notes |
|----|---------|-----------|-----------------------------------------------|-------|
| AC-1 | **PASS** | FR-1 / FR-9 | `AC-1_thirty_questions_gate_renders_within_width_budget` | 30 questions / 4 groups (8/8/8/6) / gate group "data" (q09 `gate:true`): panel opens focused on **q09** (gate ladder, FR-1); every rendered line passes `visibleWidth ≤ width` at **40/60/80/120** cols with header first / footer last; overview lists ALL group headers (`scope`, `data ▲` gate-marked, `delivery`, `process` — two-window sweep, the list is never filtered); soft-gate dimming is byte-exact vs `renderQuestionLine`/`renderHintLine` `dim=true` for a non-gate current question AND `dim=false` for the gate-focused one; a dimmed question stays fully answerable (enter applies, R1). Chat visibility above the panel is interactive-only → runbook. |
| AC-4 | **PASS** (scripted side) | FR-14 / R4 | `AC-4_suspend_widget_reopen_drafts_survive_both_sides` | Real DraftStore + real suspend/reopen seams: stage-1 draft saved on a text question + a choice answer, then `done(null)` → host suspended and the keyed widget line renders **`1 open · 1 answered — Ctrl+Shift+Q to resume /interrogate`** (h2.3 counts: open-only/answered-only buckets); `resumeOpenPanel` mounts a FRESH panel rehydrated from the SAME state + store with pre-suspend focus restored; draft-store slots byte-identical across suspend/resume and the refocus re-seeds the saved draft; main-editor side proven via the `getEditorText`/`setEditorText` seams (`snapshotEditorText` + the `restoreEditorTextIfEmpty` never-clobber guard, both directions) per editor-preservation.ts's native-preservation finding. Real editor focus + side-chat turn → runbook. |
| AC-5 | **PASS** | FR-8 | `AC-5_deep_view_full_scroll_select_returns_short` | 6-option question with multi-line ramifications → content exceeds `DEEP_VIEW_HEIGHT` (20). Selection driven ↓ across EVERY option: window stays ≤ header+pane+footer and each selected option's **sticky header** is visible; the scroll offset then driven across the FULL clamp range `[0..maxOffset]` — at the top of the range the LAST ramification line is inside the window (nothing clipped); `enter` from deep applies with short-form commit semantics: view **returns to short**, `scrollOffset` reset, answer `opt5` recorded, advanced to the next unanswered question, sticky retained. |
| AC-6 | **PASS** | FR-17 | `AC-6_contrary_gate_answer_instant_moot_and_slash_O` | Gate question q09 answered `beta` through the REAL accept path while q10 `dependsOn q09 == alpha`: in the SAME tick (synchronous `evaluateDependsOn` inside `acceptOptionIndex`, no awaited events, no agent round-trip) q10 flips **moot** and stays in the map (audit trail); overview renders the **⊘** row with an on-screen reason (`⊘ Question q10 — …`); short form greys it with the `⊘ moot —` reason line. The rendered reason body is the display default ("dependency changed") — the h2.29-style `moot: q09=beta` string is the evaluator's in-memory `MootEvaluation` payload, deliberately not persisted (reasons are re-derived; see reconstruct.ts step 4). |
| AC-7 | **PASS** | FR-18 / Q39=B | `AC-7_ripple_confirm_esc_cancels_enter_applies` | Answered 4-chain r1←r2←r3←r4; editing answered r1 vetoes into the modal confirm naming exactly **3 victims** `(r2, r3, r4)` in BFS order and the footer is REPLACED by `⚠ Invalidates 3 answered questions (r2, r3, r4) — enter=keep, esc=cancel`. Modal: any other key is a consumed no-op. **ESC → byte-identical state** (serialized JSON compare), no epoch bump, cursor restored to the recorded answer, user stays on r1. Re-edit + **ENTER → applied exactly once**: r1 = beta; r2 unmet → moot instantly with its answer KEPT (audit trail, FR-17/FR-19); r3/r4 conditions still hold against the kept answers → untouched (dependsOn is instant-local, never a cascade); epoch untouched. |
| AC-9 | **PASS** (scripted side) | FR-28 | `AC-9a_tool_result_base_plus_deltas_auto_opens_non_blocking`, `AC-9b_mirror_entry_fallback_auto_opens`, `AC-9c_session_start_event_path_invokes_the_reconstruction` | (a) tool-result base (30 questions, q01 answered) + one submission delta AFTER it → source `tool-result`, delta replayed (q02=beta), exactly one epoch bump (h3.6), `opened: true`, `ui.custom` mounted the panel, host open, **non-blocking** (never-resolving custom() promise); drafts NOT restored (fresh store stays empty — documented FR-28 limitation). (b) mirror-entry fallback (`interrogation-state` custom entry) → source `mirror-entry`, auto-open. (c) `createReconstruction` subscribes BOTH `session_start` and `session_tree`; firing `session_start` runs the same reconstruction → auto-open. Real process restart → runbook. |
| AC-10 | **PASS** (scripted side) | FR-29 | `AC-10_compact_preserves_plan_statements_and_read_is_full` | The `session_before_compact` guard with a REAL `StateMirror` (appendEntry captured) and a mock `modelRegistry.complete`: handler output = the summarizer prompt, which **starts with `PRESERVATION_INSTRUCTIONS` verbatim** (h2.42 prepend) and carries the user plan statements inside `<conversation>`; the mock summarizer's returned summary echoes the plan and the handler hands it to pi as `{compaction:{summary,…}}`; the mirror **flush landed before the summary** (fresh `interrogation-state` entry with full state: 30 questions, q02=beta, correct epoch). READ-AFTER-COMPACT consistency: that flushed entry walked back through the REAL `reconstructFromBranch` returns the FULL state (30 questions, both answers, epoch) and auto-opens — nothing depends on what the summary keeps. Live `/compact` in a real session → runbook. |
| AC-12 | **PASS** | R5 / h2.52 | `AC-12_remap_updates_footer_and_widget_labels` | Config clone remapping `deep → ctrl+shift+d` and `breakOut → ctrl+q`: `resolveKeyLabels` yields `Ctrl+Shift+D` / `Ctrl+Q`; the NEW labels render in the short footer AND overview footer (`Ctrl+Shift+D deep` present, stale `Ctrl+D deep` absent) at panel level (labels memoized from the remapped config at construction) and the suspend widget line carries `Ctrl+Q to resume /interrogate` with no `Ctrl+Shift+Q` residue. Every display string flows from the resolved config — no hardcoded key names (guarded by P1.M7.T5.S2's no-hardcoded-keys suite, untouched here). Live remap-while-running (settings reload without restart) → runbook. |

## Defect log (found by this task, fixed in owning modules)

**None.** Every targeted AC passed against the production modules as-is; no
owning-module fixes were required and none were made. Two behaviors were
initially mis-expectationed in tests and are recorded here as CONTRACT
clarifications (the tests were corrected to the production contract, not the
modules):

1. **Ripple apply is instant-local, not a moot cascade** (AC-7): after
   `enter=keep`, only the DIRECTLY unmet dependents flip moot. Transitives
   whose `dependsOn` still holds against the KEPT answers stay
   answered/submitted. This is exactly FR-17 ("conditions are evaluated
   locally and instantly"), FR-19 ("dependsOn covers instant, local effects
   only"), and the h2.38 "answers kept" audit-trail rule (Q34=A) — the panel's
   `applyConfirmedEdit` (ripple-confirm.ts) implements it correctly via
   `applyAnswer` + one `evaluateDependsOn` pass.
2. **Overview/short moot rows render the display-default reason** (AC-6):
   `evaluateDependsOn` returns per-question h2.29 reasons (`moot: q09=beta`)
   as its in-memory `MootEvaluation` payload but persists only the status
   flip; renderers re-derive a display reason (`overviewMootReason` /
   short-view `mootReason` → "dependency changed" when no answer text/value
   exists). Matches reconstruct.ts step 4 ("reasons are never persisted") —
   no defect.

## Interactive-only residuals (enumerated, NEVER attempted — AUTOMATION-POLICY)

Human-only: `plan/001_0d6760db6bc5/MANUAL-TUI-AC-RUNBOOK.md`. The pipeline is
never blocked on any of these.

| AC | Residual (why it cannot be scripted) | Scripted coverage |
|----|--------------------------------------|-------------------|
| AC-1 | chat visibility above the panel; live layout feel at real terminal sizes | width sweeps + dim/overview assertions (this suite) |
| AC-4 | real main-editor focus; a full side-chat agent turn while suspended | suspend widget + resume + DraftStore/preservation seams (this suite) |
| AC-5 | scroll/select ergonomics in a live TUI | full-range scroll + select-from-deep assertions (this suite) |
| AC-6 | on-screen greying as the user perceives it | same-tick moot + ⊘ render assertions (this suite) |
| AC-7 | the modal dialog interaction itself | esc/enter driven through `handleInput` (this suite) |
| AC-9 | real process restart of pi | reconstruction from all three base variants + event path (this suite) |
| AC-10 | live `/compact` in a real session | guard output + mirror flush + read-after-compact (this suite) |
| AC-12 | settings remap WITHOUT restart (live reload) | remapped-config footer/widget assertions (this suite; config-surface.test.ts owns the config layer) |

## Final validation checklist (PRP)

- [x] AC-1/4/5/6/7/9/10/12 each have a named passing test asserting the
      concrete AC language ("within width budget", "drafts intact", "returns
      to short form", "instantly", "esc cancels / enter applies", "auto-open",
      "labels change")
- [x] Width assertions run at 40/60/80/120 cols with `visibleWidth`
- [x] Per-AC results table [Mode A] in the file JSDoc + this file, citing the
      FR proven
- [x] No defects found in owning modules → nothing to fix, nothing papered
      over; two contract clarifications recorded above
- [x] Interactive residuals enumerated → MANUAL-TUI-AC-RUNBOOK.md (never
      executed; pipeline not blocked)
- [x] No live TUI, no real `interrogate` call, no user-input waits anywhere
- [x] `npm test` green — 42 files / 924 tests (includes this suite,
      `ac-scripted.test.ts`, and the T5.S2 config suites); `npm run typecheck`
      clean
- [x] Untouched: `src/ac-scripted.test.ts`, `src/config-surface.test.ts`,
      `src/no-hardcoded-keys.test.ts`, `MANUAL-TUI-AC-RUNBOOK.md`, `PRD.md`,
      `tasks.json`

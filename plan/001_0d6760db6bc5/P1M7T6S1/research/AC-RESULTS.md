# AC-RESULTS — P1.M7.T6.S1 (scripted state-level ACs)

> [Mode A] Results recorded in-plan only. Consumed by P1.M7.T6.S2 (scripted
> panel AC pass) and P1.M7.T7 (docs). Executed under
> plan/001_0d6760db6bc5/AUTOMATION-POLICY.md (BINDING): no live TUI, no real
> `interrogate` call, no turn ended waiting on a user. Every verdict below is
> backed by a named vitest test driving the SAME production code paths
> (h2.50) — `executeInterrogate`, the `/interrogate-debug-*` handlers, the
> merge/state primitives, `buildSubmission`/`buildCompletion`, the h2.44
> lifecycle engine, and the completion trigger.
>
> Suite: `src/ac-scripted.test.ts` (8 tests). Full run at time of recording:
> `npm run typecheck` clean; `npm test` 41 files / 914 tests, all green.

## Per-AC results

| AC | Verdict | FR proven | Evidence (test in src/ac-scripted.test.ts) | Notes |
|----|---------|-----------|---------------------------------------------|-------|
| AC-2 | **PASS** | FR-3 | `AC-2_submission_delta_three_lines_reminder_epoch_28_open` | 2-of-30 answer set → delta content exactly 2 lines (`Submitted 2: q01: Alpha; q02: Beta` + byte-exact reminder ≤3-line budget); user-only card shows both answers and the `28 remain open` footer; epoch bumped **exactly once** (state 1→2, one ring snapshot labeled pre-bump, `details.epoch` = 1); status line `2/30 answered · 0 re-asked · 0 moot · epoch 2`. |
| AC-3 | **PASS** (after DEF-1/DEF-2 fix) | FR-4 (+FR-21 rule 2, R4) | `AC-3a_agent_settled_without_upsert_closes_submitted`, `AC-3b_reask_resets_answer_and_preserves_draft` | (a) Real flow (executor upsert → `/interrogate-debug-submit` → `agent_settled`, no upsert): both submitted ids archived to `closed`; untouched id stays `open`; completion correctly does NOT fire (28 active). (b) Closed question re-upserted with changed options (current rev echoed) → `reasked`, answer deleted, rev +1 (reopen-changed rule); DraftStore slot byte-identical (merge never touches drafts). |
| AC-8 | **PASS** | FR-22 | `AC-8_stale_upsert_rejected_then_self_heals`, `AC-8_debug_upsert_surfaces_the_verbatim_stale_message` | Stale round-1 view (q01 rev 1, epoch 1) vs state at rev 2 / epoch 3 → executor throws `StaleError` UNCAUGHT with the full h3.8 payload: `STALE: q01 is at rev 2 (you sent 1); session epoch is 3 (you sent 1). Current q01: Decide q01 (revised). Changes since epoch 1: q03: (unanswered)→Beta. Re-apply against current state.` Guard fired before ANY mutation. Re-apply with current rev/epoch → success (changed options → `reasked`, rev 3). Debug command surfaces the identical message verbatim at `error` level. |
| AC-11 | **PASS** (scripted half) | FR-25 | `AC-11_print_mode_digest_answers_and_consistent_read` | Print-mode upsert → status line + numbered h2.26 digest (`**1. Question q01** (\`q01\`)`, `1) Alpha (\`alpha\`) ★`, `Recommendation: Alpha`, all 30 numbered) ending with the relay sentence. `answers[]` via the record route records 2 answers (+ tolerant `unknown ids: zz`), never bumps rev, exactly one epoch bump; subsequent read is consistent (`2/30 answered · … epoch 2`, per-question lines). Headless probe recipe: see below. |
| AC-13 | **PASS** | FR-2 / Q24=B | `AC-13_editing_archived_answer_re_pends_and_flags_changed` | Closed (`sqlite`) answer edited via the panel commit primitive → status back to `answered` (pending), rev untouched (1). Next submission diff entry: `{id:"q1", from:"SQLite", to:"Postgres", editedArchived:true}`; model-visible delta `Submitted 1: q1: Postgres (changed)`; user-only card renders `Database: SQLite → Postgres (changed)`. |
| AC-14 (state side) | **PASS** (after DEF-1/DEF-2 fix) | FR-5 | `AC-14_completion_record_fires_exactly_once` | Real lifecycle+completion wiring: last questions closed by the settle close pass → `interrogation-completion` injected exactly once (h2.46 record verified: goal header, `[scope] q1 Question q1: Alpha ★` label-preferred + ★, NOTES/Withdrawn trailers, `details.groups`, epoch) via the idle delivery branch (`triggerTurn+followUp`). State side: `completed=true`, questions cleared, goal/epoch/snapshots retained; second `agent_settled` + direct `attemptCompletion` → `{fired:false, reason:"already-completed"}`, no additional injection. Fresh state re-arms the flag (per-instance guard). |

Recap-card rendering of AC-14's message is P1.M7.T3.S2 territory
(recap-card.test.ts); the interactive panel-dismissal step is human-runbook.

## Defect log (found by this task, fixed in owning modules)

### DEF-1 — ctrl+s flush never performed the h2.38 `answered → submitted` transition (AC-3 / AC-14 blocking)

- **Symptom**: driven end-to-end, a submission left answered questions in
  status `answered` forever. The h2.44 close pass archives ONLY
  status-`submitted` ids, so nothing ever closed and the FR-5 completion
  predicate (which blocks on `answered`) could never fire in the panel flow.
- **Root cause**: `merge.ts markSubmitted` — documented as "the ctrl+s submit
  flush applies this to all pending (answered) ids before the epoch bump" —
  had **zero production callers**. Both submit implementations skipped the
  transition. Per-module tests masked it: `lifecycle.test.ts` hand-seeds
  `markSubmitted` for "the shape right after ctrl+s", so the engine tested
  green while the flow that should feed it never did.
- **Fix (owning modules of the flush)**:
  - `src/panel/actions.ts` `submit()` — after the zero-pending early return,
    flush ALL pending (`answered`) ids via `markSubmitted` between
    `computeDiff` and `buildSubmission` (the diff is answer-signature-based
    and status-blind; the flush window is exactly "before the epoch bump").
  - `src/debug-commands.ts` submit handler — identical flush.
- **Regression coverage**: `src/panel/actions.test.ts`
  (`test_i_submit_flush_marks_pending_submitted_and_calls_noteSubmissionDelivered`),
  `src/debug-commands.test.ts`
  (`submit_flush_marks_all_pending_answered_submitted_and_notifies_lifecycle`,
  `submit_without_lifecycle_handle_still_delivers`), both additive; one
  pre-existing assertion that encoded the defective behavior
  (post-submit status `answered`) was corrected to the fixed `submitted`.
  AC-level end-to-end assertions live in `ac-scripted.test.ts`.

### DEF-2 — submit flows never notified the auto-close engine (h2.44 line 1)

- **Symptom**: `lifecycle.ts` documents a MUST-call contract
  (`noteSubmissionDelivered()` "immediately after `deliverSubmission`",
  h2.44 line 1 "on submission delivery: submittedRun = false"); neither
  submit flow called it, so the engine's per-run flags survived into the
  settle that answered a submission.
- **Impact**: low (flags are also cleared on every close-pass exit, and the
  completion trigger recomputes its predicate from state), but the h2.50
  same-path evidence chain requires the driver to honor the algorithm.
- **Fix**: optional seams — `registerDebugCommands(pi, config, lifecycle?)`
  (wired in `src/index.ts` with the live engine) and
  `SubmitDeps.noteSubmissionDelivered?` (called after a real delivery; the
  zero-pending early return never calls it).

### Observations recorded, NOT fixed here (outside this task's module list)

1. **Panel delivery deps are still unwired in production**:
   `OpenPanelOptions.delivery` (`SubmitDeps`) is not constructed by
   `maybeAutoOpen` or the reconstruction path — panel.ts documents it
   "optional until a later task wires the production transport". Until that
   lands, the real TUI ctrl+s is inert and `/interrogate-debug-submit` is the
   only live submission path. Flagged for P1.M7.T6.S2 / the human runbook.
2. **Non-TUI close semantics**: `recordAnswers` (print mode) leaves recorded
   answers `answered`; nothing auto-closes in non-TUI, so FR-5 completion in
   pure print mode is reachable via the model's withdrawals (FR-19, rule 4).
   Consistent with AC-11's scope (digest + recording + consistency only);
   noted for the spec owners.

## Interactive-only leftovers (enumerated, NEVER attempted — AUTOMATION-POLICY)

Human-only: `plan/001_0d6760db6bc5/MANUAL-TUI-AC-RUNBOOK.md`.

| AC | Why interactive | Covered elsewhere (scripted) |
|----|-----------------|------------------------------|
| AC-1 | live panel layout, gate focus, chat visibility, group dimming | gate/panel module tests (panel/, gate) |
| AC-4 | break-out widget, side chat, reopen, editor draft survival | suspend.test.ts / editor-preservation.test.ts |
| AC-5 | deep-view scroll + select-from-deep feel | deep-view.test.ts |
| AC-6 | instant moot greying + ⊘ markers on screen | depends-on.test.ts / renderers |
| AC-7 | ripple confirm dialog interaction (esc/enter) | ripple-confirm.test.ts |
| AC-9 | restart → reconstruction auto-opens panel | reconstruct.test.ts (state level) |
| AC-10 | `/compact` behavior in a live session | compaction.test.ts (guard + instructions) |
| AC-12 | footer/widget strings reflecting a settings remap live | config-surface.test.ts + no-hardcoded-keys.test.ts (P1.M7.T5.S2); live pass = runbook |

The scripted panel AC pass (render-level, no live TUI) is P1.M7.T6.S2's
re-scoped ownership.

## Headless `pi -p` probe recipe (AC-11, optional, non-blocking — NOT executed here)

The scripted AC-11 test above proves the print-mode fallback against the
production executor. The literal headless one-shot requires a live model
backend, which this offline environment cannot provide without hanging, so
per the PRP it is documented as a probe recipe (never interactive; always
timeout-guarded):

```bash
# From the repo root (extension auto-loads via package.json "pi" field).
# One-shot, non-interactive, hard-timeboxed. NEVER run without `timeout`.
timeout 90 pi -p \
  'Call the interrogate tool with action "upsert": goal "probe", one choice question id "p1" ("Pick one", options a/A and b/B). Relay the tool result digest verbatim in your reply, then stop.'

# Expected in stdout: the relayed h2.26 digest —
#   "INTERROGATION — probe (epoch 1)", the "**1. …** (`p1`)" numbered block,
#   the option lines "1) A (`a`)", and the relay sentence
#   "Relay this digest verbatim to the user in chat; they will answer in their next message."

# Follow-up one-shot recording an answer (new session, re-seed first or reuse
# the same prompt then answer): answers[] recording shows the status line
# "1/1 answered · 0 re-asked · 0 moot · epoch 2".
```

Any hang is a probe failure by definition — the timeout is the assertion
backstop, not a retry invitation.

## Final validation checklist (PRP)

- [x] AC-2, AC-3, AC-8, AC-11, AC-13, AC-14-state each proven by a named test
- [x] Results table [Mode A] written; defects fixed in owning modules and logged
- [x] Interactive leftovers enumerated → MANUAL-TUI-AC-RUNBOOK.md (never executed)
- [x] No live TUI, no real interrogate call, no turn ending on user input
- [x] `npm test` green (41 files / 914 tests); `npm run typecheck` clean; no edits to PRD/tasks.json
- [x] No conflicts with P1.M7.T5.S2 files (config-surface / no-hardcoded-keys untouched)

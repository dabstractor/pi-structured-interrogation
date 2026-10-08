# Validation Report — pi-interrogator (2026-10-07)

**Scope:** comprehensive validation of the pi-interrogator extension against the
PRD (SPEC + product-requirements/architecture/tool-protocol/ui-spec/
state-and-persistence/implementation-plan/decisions), including every 2026-10
amendment: ANSWER-PIN-001 + the BUG-001 re-ask re-confirmation amendment,
DEEP-PIN-001, BUG-002 flush parity, BUG-003 closed-edit ripple, BUG-004 moot
reason persistence, BUG-005 fresh-receiver epoch acceptance, the remote-bridge
removal, SURFACE-001/002, WRITEIN-001/002, AUTOSUBMIT-001/002/003, and the two
issues found by the prior wave ({reopen:true} after restart; /tree widget
refresh).

**Method:** `validate.sh` (7 phases) — static residue guards, `tsc --noEmit`,
full vitest suite, keymap conflict guard, README drift machine-checks, and 17
scripted E2E journeys (229 checks) driven through the **real extension factory**
(`src/index.ts`) plus direct `InterrogationPanel` probes, per the repo's
AUTOMATION-POLICY (fake-ctx harness; no live TUI, no real interrogate turn, no
waiting on humans). Adversarial probing beyond the scripted journeys used
one-off vite-node scripts over the same public seams.

**Baseline:** typecheck clean; 47 test files / **1306 tests all green**;
keymap guard clean; README machine-checks clean.

## Executive summary

The codebase is in excellent shape: all 16 acceptance criteria pass end-to-end
where the flows are reachable, every prior-wave bug fix is verified fixed
(BUG-001..005, DEEP-PIN-001, the prior `{reopen:true}`/tree-widget issues),
and the newest contracts (answer pinning with the re-ask re-confirmation
exception, closed-edit ripple on all four seams, persisted moot reasons, deep
glyph contract) behave exactly as specified. The validation nevertheless found
**4 issues (2 major, 2 minor)** — two of them deterministic wedges of the
product's core deliverable (the one-time completion record): a session-start
code path that permanently severs the submission→lifecycle wiring (Issue 1),
and a standing `moot` question that blocks completion with no agent-side
escape hatch (Issue 3).

## What was validated (evidence)

| Check | Result |
|---|---|
| `npm run typecheck` (tsc --noEmit) | ✅ clean |
| `npm test` (vitest run, 47 files / 1306 tests) | ✅ all green |
| `scripts/verify-keymap-conflicts.sh` | ✅ no default collides |
| Static residue greps (advanceArmed, registerShortcut, retired commands, skip/only tests, remote-bridge artifacts, stale preselect claims, tool-schema pin string byte-exact, DEEP-PIN constants, mootReason persistence) | ✅ clean |
| README drift machine-checks (8 stale-claim absent + 8 current-contract present) | ✅ pass |
| E2E — 17 journeys × 229 checks through the real factory + direct panel probes | ❌ **5 failed** — all five are the reproducible Issue 1/2/3 checks below (224/229 pass) |

**E2E journeys covered** (mirroring README "Usage" + all acceptance criteria):

- **J1 planner happy path (TUI):** upsert → panel opens focused on the gate
  question → suspend → widget names `/interrogate` only → `interrogate({})`
  read returns full content without surfacing → `/interrogate` resumes on the
  first unanswered → answer-all by keystrokes (digit, arrows+enter, text
  write-in) → auto-submit delta ≤3 lines + reminder + epoch → settle →
  completion injected exactly once with goal, labels, `✎ {write-in}`.
- **J2 answer pinning + re-ask round trips (AC-16/FR-35/BUG-001/BUG-002):**
  non-recommended answer owns the caret on revisit; same-value `enter`/digit
  are zero-state-change advances (no `answer.at` rewrite, no epoch bump, no
  modal, no submission); write-in pins the ✎ row; rule-1 re-ask keeps the
  answer and same-value enter RE-CONFIRMS and ships; rule-2 re-ask + same-value
  re-answer SHIPS through the empty-diff flush (BUG-002); both interrogations
  complete.
- **J3 auto-submit rules (AUTOSUBMIT-001/002/003 + BUG-003 + AC-13):**
  transition fires only on the last unanswered; non-last edits of a complete
  set ship nothing (manual `ctrl+s` only) and the diff card marks them
  `(changed)`; review-flow exit (edit of the last sequential answerable on a
  complete set) ships immediately; closed-edit different choice raises the
  FR-18 modal with an answered victim, esc cancels cleanly, apply re-pends and
  moots the dependent; gate hold withholds with the non-expiring ⚠ line and
  `ctrl+s` overrides; answering the gate releases the transition.
- **J4 editor duties (WRITEIN-001/002):** elaboration attaches as
  `answer.text`; ✎ Other write-in commits as `answer.value custom:true`;
  option accept supersedes the write-in; held-elaboration zero-pending flash
  names it; post-submit auto-suspend everywhere.
- **J5 restart (SURFACE-002/FR-6):** reconstruction installs state silently,
  widget is the only cue; **`{reopen:true}` on a never-opened host now OPENS
  the panel (prior-wave Issue 1 verified fixed)**; `/interrogate` reopens.
- **J6 tree navigation:** silent branch follow; **suspended widget line
  refreshes to the destination branch (prior-wave Issue 2 verified fixed)**;
  open panel suspends; interrogation-free branch tears down (widget cleared).
- **J7 non-TUI digest (AC-11):** numbered markdown digest; stale-epoch
  `answers[]` rejected; recorded answers complete on settle.
- **J8 guards (AC-8/BUG-005):** stale rev/epoch rejected with STALE + current
  state; re-apply heals; fresh receiver accepts an honest echoed epoch;
  rotation guard still enforced on live non-empty state.
- **J9 surfacing matrix (SURFACE-001):** reads never surface (open /
  all-answered / completed); description-only edit surfaces nothing; re-ask
  reopens; forged pi-ask bridge submit mutates nothing; dead-state
  `/interrogate` notifies.
- **J10 BUG-003 seams (direct panel probes):** different-value edits of CLOSED
  questions raise the FR-18 confirm on the option, digit, and write-in paths;
  esc cancels; same-value/digit/byte-identical write-in re-commits stay inert.
- **J11 BUG-004 moot reasons:** `moot: {dep}={value}` persisted on
  `Question.mootReason`, rendered verbatim in short view + overview (⊘), the
  completion record entry renders `d2 (moot: d1=a)` (prefix stripped), and the
  reason is cleared on reopen.
- **J12 DEEP-PIN-001:** pinned question region renders on every scroll offset
  (verified at max scroll); giant descriptions truncate bottom-first with the
  dimmed `…` marker and keep priority over the goal; MIN_OPTIONS_VIEWPORT (4)
  floor holds; text questions use the full pane; select-from-deep returns to
  short + advances.
- **J13 deep-view glyph contract (D-R14 amendment 9):** selected section
  carries `▸` + heavy `┃` pipes; unselected plain `│`; the ✎ Other section
  gets the same treatment.
- **J14 D-R13 display order:** ★ renders first (display-only); digit 1 maps
  through display positions; caret pins to the recorded row after answering.
- **J15/J16/J17:** the deterministic repros for Issues 1–3 below.

---

## Issues

### Issue 1 — MAJOR: `session_start` on a branch without interrogation permanently severs the panel↔lifecycle submission wiring; a same-run re-ask + re-confirm then wedges the question in `submitted` and completion never fires

**Spec citations:** FR-4 (auto-close on `agent_settled`), FR-5 (completion
injection — the product's core deliverable), state-and-persistence.md §Auto-close
("on submission delivery: submittedRun = false"; the h2.44 line-1
`noteSubmissionDelivered` caller contract: "submit flows MUST call it
immediately after `deliverSubmission`"), the BUG-001 re-ask round-trip contract
(re-ask → re-confirm → settle → close → completion).

**Reproduction (deterministic, real factory — E2E J15 / probe
`/tmp/probe-wedge2.ts`):**

1. `session_start` with an empty branch — **the normal pi startup**.
   Reconstruction's no-traces branch (`src/reconstruct.ts`, `state === undefined`
   → `opts.host.dispose()`) resets the module-scoped panel host record, which
   **nulls `hostNoteSubmissionDelivered`** (`src/panel/panel.ts`
   `resetHostRecord()`). Nothing ever re-arms it (`createPanelHost` runs only at
   factory load).
2. Upsert 2 questions; answer both (transition auto-submits, statuses
   `submitted`).
3. The agent re-asks q1 (rule 1, same options) **in the same run** while the
   user answers the reopened panel (the `isIdle() === false` steer branch of
   `deliverSubmission`); the user re-confirms q1 with the same value →
   submission #2 delivered as `{"deliverAs":"steer"}`.
4. `agent_settled` fires. Observed: `q1:submitted q2:closed`, `completions: 0`,
   `completed: false` — **q1 is never closed and the completion record is never
   injected.** Counterfactual (identical flow without the empty-branch
   `session_start`): `panel.delivery.noteSubmissionDelivered === "function"`,
   everything closes, `completions: 1`.

**Root cause:** every panel opened after step 1 builds its `SubmitDeps` via
`surfaceSubmitDeps(pi, hostNoteSubmissionDelivered)` with the hook `undefined`
(verified: `panel.delivery.noteSubmissionDelivered === undefined` after a
normal startup; `=== "function"` when session_start found live state). The
delivery therefore never resets the auto-close engine's per-run
`reaskedThisRun`/`submittedRun` flags, so the run's close pass skips the
re-confirmed question (it was re-asked earlier in the same run), and no later
event ever closes it. The no-traces dispose also runs on `/tree` navigation to
interrogation-free branches and on completed-branch reconstruction, so the
severing re-arms in those flows too.

**Impact:** any interrogation in a session that started without live state
(the overwhelmingly common case) loses the h2.44 line-1 contract. The visible
wedge requires a submission delivered inside a run that also re-asked the
question (the steer branch — user answers the auto-reopened panel mid-turn,
which is exactly the flow the re-ask reopen enables); then the re-confirmed
question wedges in `submitted` forever, the completion record is never
injected, and the suspend widget keeps advertising a live interrogation.

**Fix sketch:** stop clearing the lifecycle hook in `resetHostRecord()` (it is
factory-time wiring, not branch state), or have `openPanel` re-resolve the
hook from the live lifecycle instead of the captured module variable; add the
severed-wiring regression test (panel deps after an empty-branch
session_start).

### Issue 2 — MINOR: the panel auto-reopened by a rule-1 re-ask of a submitted question focuses `ordered[0]` instead of the re-asked question

**Spec citations:** ui-spec.md §Suspend/resume/widget ("h2.37: fresh instance
rehydrated from state, **focused on the first upserted currently-active
question**"), RESUME-001 (explicit resumes focus the first unanswered —
open/reasked), FR-14's reopen contract.

**Reproduction (deterministic, real factory — E2E J16 / probe
`/tmp/probe-focus3.ts`):** answer q0+q1 (both `submitted`, no settle yet), then
re-ask q1 with the same options. During `execute` the merge keeps q1
`submitted`, so the `questions-upserted` handler (`handleUpserted`) early-
returns (nothing open/reasked yet); the lifecycle flips q1 → `reasked` at
`tool_execution_end`, and `maybeAutoOpen` reopens the panel — **without a
`focusQuestionId`**. The focus ladder (`pickGateInitialQuestionId`) matches
only `status === "open"` in its `firstOpen` step (reasked is skipped) and its
fallback is status-blind `ordered[0]`. Observed: the reopened panel focuses
`q0` (a merely-submitted question; with prior epochs in state it is a CLOSED
question — verified with a closed `r1` at order position 0). Expected: `q1`.

**Impact:** after the canonical BUG-001 scenario (agent re-asks a submitted
question while the user is between submissions), the panel reopens on the
wrong question — potentially a long-archived one — instead of the ⟳ question
the user needs to re-confirm. Recoverable via `←`/`→` and the overview, no
state corruption; UX/navigation only.

**Fix sketch:** in `maybeAutoOpen`, pass `focusQuestionId` (the batch's first
newly-active id — the upsert args are already available through the
start-phase stash), and/or extend `pickGateInitialQuestionId`'s `firstOpen`
step to match `open` **or** `reasked` and make the final fallback skip
terminal statuses.

### Issue 3 — MAJOR: a standing `moot` question permanently blocks completion and cannot be withdrawn — the completion record is never injected and the interrogation hangs in limbo

**Spec citations:** FR-5 ("When the last open question closes, the extension
injects the complete Q&A record **once**"), FR-17/AC-6 (contradicting a
`dependsOn` moots the dependent — the spec's own scenario), FR-19/the
patch-semantics pin (`withdrawOmitted: true` is the agent's deliberate prune
tool), state-and-persistence.md §Auto-close (the moot-inclusive completion
predicate — which the implementation matches literally, but see the
contradiction below).

**Reproduction (deterministic, real factory — E2E J17 / probe
`/tmp/probe-moot2.ts`):**

1. Upsert q1 (choice a/b) and q2 with `dependsOn: [{id:"q1", equals:"b"}]`.
2. Answer q1 = a → q2 moots (`moot: q1=a`) → the completeness transition
   ships q1 (moot does not block completeness — correct per AUTOSUBMIT-001).
3. `agent_settled` → q1 closed; q2 is a **standing moot**.
4. **`completions: 0`, `completed: false` — forever.** `moot` is in the
   completion BLOCKING set (`src/completion.ts`), so FR-5's one-time record is
   never injected, the model never receives the deliverable it is supposed to
   write the spec from.
5. The agent's only prune tool fails: a kept-set resend with
   `withdrawOmitted: true` succeeds as a tool call but leaves q2 `moot` —
   `WITHDRAWABLE` in `src/merge.ts` excludes `moot` ("moot is S3's domain").
   There is **no agent-side escape hatch**.
6. The suspend widget still shows `0 open · 1 answered — /interrogate to
   resume` (set at the post-submit suspend landing, never refreshed after the
   close pass archived everything), advertising an interrogation in which
   nothing is answerable.

The only resolutions are user-side and undocumented: the user re-answers q1
with `b` (re-metting the moot, which re-opens a question they deliberately
mooted), or the agent rewrites the moot question's options (a rule-2 re-ask
forcing the user to answer a question that was mooted as irrelevant). The
repo's own tests expose the contradiction: `src/completion.test.ts:278`
resolves a standing moot via `st.setStatus("q1", "withdrawn")` — "moot
resolved via **withdrawal path**" — a path `merge.ts` refuses in production.
The completion record's `Withdrawn/moot:` section likewise cannot ever list a
moot question (moots block completion), so that section is dead for moots.

**Impact:** every interrogation whose `dependsOn` structure moots any question
— the exact scenario AC-6 scripts — cannot complete. The product's core
deliverable (the injected full record the model writes the spec from) never
arrives; the session lingers with a stale resume cue.

**Fix sketch (either):** (a) exclude `moot` from the completion BLOCKING set —
terminal-by-design questions should not gate the record (matches FR-5's "last
open question" letter and lets the record's moot section actually populate);
or (b) let `withdrawOmitted` withdraw `moot` ids (matching the withdrawal path
`completion.test.ts` already assumes). Either resolves the wedge; (a) also
fixes the dead moot arm of the record.

### Issue 4 — MINOR: the deep-pane pinned question region renders the goal ABOVE the description; ui-spec specifies description above goal

**Spec citation:** ui-spec.md §Layout, DEEP-PIN-001: "a PINNED question region
on top (moot reason line when moot, full `description`, full `goal` below it,
dimmed)" — the description first, the goal **below it**.

**Reproduction (probe `/tmp/probe-deep.ts`, `buildDeepContent`):** with both a
description and a goal present, `questionLines` renders `[goal, "", desc, ""]`
— goal above description (`src/panel/deep-view.ts`: `questionLines = [...head,
...goalKept, ""]; if (descKept.length) push(...descKept, "")`). The
truncation-priority contract is implemented correctly (the description keeps
priority over the goal when the region overflows — verified with a giant
description); only the render order deviates from the spec text. No test pins
the order.

**Impact:** cosmetic/spec-conformance only; the deep view remains fully
usable. Worth either swapping the two blocks or amending the spec sentence.

---

## Non-issues (checked, clean)

- **All prior-wave fixes verified fixed:** `{reopen:true}` on a never-opened
  host opens the panel (J5); the `/tree` suspended-widget line refreshes to
  the destination branch and clears on teardown (J6).
- **Remote-bridge removal:** no bridge modules; the forged pi-ask submit
  mutates nothing (J9); no references outside the phantom regression guard.
- **Answer pinning (ANSWER-PIN-001) including the re-ask amendment:** pinning,
  inert same-value commits (enter/digit/byte-identical write-in), buffer
  consumption, FR-18 only on a different choice, stale-value clamp, ★
  display-only after an answer — all verified on every path probed.
- **BUG-003 closed-edit ripple:** all four seams (option, digit, write-in
  commit, elaboration-save) raise the modal for different-value edits of
  closed questions with answered victims; esc cancels with zero state change.
  Note: victims must be `answered`/`submitted` (PRD FR-18's letter — "answered
  or submitted"); closed/moot victims apply directly, matching the PRD text.
- **BUG-004 moot reasons:** persisted silently, rendered verbatim in both
  views, stripped (not doubled) in the completion record, cleared on reopen.
- **BUG-005:** fresh receivers accept honest echoed epochs; the rotation guard
  still fires on live non-empty state.
- **BUG-002:** same-value re-answers after a rule-2 re-ask ship through the
  empty-diff flush.
- **Auto-submit discipline (AUTOSUBMIT-001/002/003):** transition, gate hold,
  review-flow exit, and the non-last-edit manual-only rule all behave per the
  narrowed trigger; footer flash and post-submit exit coexist correctly.
- **Surfacing discipline (SURFACE-001/002):** reads and navigation never
  surface in any state; restart installs silently with the widget as the only
  cue; the surfacing allow-list is exactly the spec's three entries.
- **Guards, caps, digest fallback, compaction instructions, keymap
  conflict guard, README contract:** all green (phases 2–6 + J7/J8).

## Bottom line

Everything a planner or agent exercises day-to-day — question rounds,
write-ins, elaborations, answer pinning, re-ask round trips, auto-submit,
gate hold, staleness self-heal, restart/tree-nav discipline, print-mode
fallback — works exactly as specified, with an unusually rigorous test suite
beneath it. The two major findings are precise, small-rooted wedges of the
completion flow (a one-line wiring loss at startup; a status-set
contradiction around moots), and both have clean, contained fix sketches.
Until Issue 1 is fixed, the practical workaround for the steer-branch wedge
is any additional agent turn (an upsert or reopen) after a same-run re-ask —
its settle re-runs the idempotent close pass. Until Issue 3 is fixed, the
workaround is the rule-2 re-ask of the standing moot (rewrite its options so
the user can answer it), which the E2E itself demonstrates (J3's recovery
path).

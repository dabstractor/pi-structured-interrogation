# Bug Fix Requirements

## Overview
Creative end-to-end PRD validation of pi-interrogator (1624 existing tests green throughout). I drove the real executor, panel, merge/guards, delta delivery, renderers, reconstruction, sidechat parser, config loader, and lifecycle seams through adversarial journeys: happy paths (gate focus, moot-on-contrary-answer, ripple confirm with transitive victims, closed-edit ripple, reasked re-confirm, write-in commit + supersede re-bind with elaboration attach, deep-view landing/scroll/sticky-advance invariants, answer pinning incl. stale-value clamp, gate hold/release, auto-submit transition + review-flow exit, digit inertness, hjkl/arrow/tab navigation and clamping, esc ladder, double-esc editor exit, note mode, config remaps incl. legacy aliases and bare-submit rejection, malformed-settings robustness, withdrawal semantics across all statuses, completed-swap goal retention, BUG-005 epoch exemptions, duplicate-batch atomicity, FULL-TRANSCRIPT-001 cards, TRUST-001 surrogate-safe delta caps, 200-question scale renders). The implementation is exceptionally faithful to the PRD; most adversarial probes passed. One major defect found: restart reconstruction replays submission deltas value-only, silently dropping answer elaborations and write-in custom markers when the debounced full-state mirror missed the flush window (hard kill/SSH drop) — degrading the read surface, answer pinning, ✎ markers, and the completion record the model writes the spec from. Three minor findings: untruncated ✎ Other row label at ultra-narrow widths, the dead auto-submit footer flash (set after suspend), and a SURFACE-002-contradicting wiring comment.


## Critical Issues (Must Fix)
Issues that prevent core functionality from working.

None.


## Major Issues (Should Fix)
Issues that significantly impact user experience or functionality.

### Issue 1: Restart reconstruction loses answer elaborations (answer.text) and write-in markers (answer.custom) when replaying submission deltas
**Severity**: Major
**ID**: BUG-001
**Location**: src/reconstruct.ts:420 (replaySubmission); src/snapshots.ts:90 (DiffEntry)

**Description**:
Reconstruction (session_start / session_tree) replays interrogation-submission deltas via replaySubmission(), which applies only `entry.value` as the answer value. The DiffEntry shape carried in submission details has `value` but NO `text` and NO `custom` fields, so after a restart whose base candidate (last state-carrying tool result or mirror entry) predates a submission, every replayed answer loses its elaboration (`answer.text`) and its write-in marker (`answer.custom`). This violates FR-27 (branch-correct canonical state), TRUST-001 (the read result's `elaboration:` detail lines vanish — user-authored words are never truncated-only on any model-visible surface), WRITEIN-001 (✎ markers gone), ANSWER-PIN-001 (a replayed write-in's value matches no option, so the caret clamps to display row 0 instead of the ✎ Other row — the user's write-in LOOKS replaced by the first option), and FR-5/commitment 2 (the one-time completion record — the model's sole spec source — is built from state and silently omits the elaboration entirely and renders the write-in as a plain answer). Reachability: the debounced (2s) `interrogation-state` mirror normally lands a full-fidelity snapshot, but a hard process death inside that window (SSH drop, SIGKILL, crash — session_shutdown's synchronous flush never runs) or an appendEntry failure leaves the branch with only the older tool result plus the submission entries; reconstruction then degrades to value-only replay. Verified end-to-end against the real panel/delivery/reconstruct machinery: after replay, q1.answer = {value:"alpha"} (text gone) and q2.answer = {value:"Neither — we use a custom vector store"} (custom gone).

**Steps to Reproduce**:
1. Model upserts two choice questions (tool result details.state = reconstruction base candidate). 2. User answers q1 = option alpha with an elaboration (draft via `e` + commit) and q2 = ✎ Other write-in; auto-submit delivers interrogation-submission (details.changed carries only {id,title,prompt,from,to,value,editedArchived}). 3. Process dies hard within the 2s mirror debounce (no session_shutdown flush) — branch = base tool result + submission custom_message. 4. Restart/resume (or /tree): reconstructFromBranch picks the tool-result base, replaySubmission applies entry.value only → q1.answer.text === undefined, q2.answer.custom === undefined. Repro probe (vitest, real seams): build state via executeInterrogate upsert; answer via acceptOptionIndex + commitTextDraft + writeInEnter with delivery capturing the message; reconstruct with branch [toolResultEntry(base), submissionEntry(msg.details)] → assert answer.text/answer.custom — both fail. Key code: src/reconstruct.ts replaySubmission (~line 420) reads only entry.value/entry.to; src/snapshots.ts DiffEntry (~line 90) lacks text/custom.


## Minor Issues (Nice to Fix)
Small improvements or polish items.

### Issue 1: Synthetic ✎ Other row label is never width-truncated — panel lines exceed terminal width below ~31 columns
**Severity**: Minor
**ID**: BUG-002
**Location**: src/panel/short-view.ts:280

**Description**:
short-view.ts's otherLine() renders OTHER_AFFORDANCE ("✎ Other — write your own", 28 visible cols + 4-col inset) without any truncateVisible call, unlike real option labels (optionLine truncates) and the text affordance (truncates its placeholder). At terminal widths < 32 the line exceeds the width (verified: overflow at widths 1–20; the label is 28+4=32 cols wide). The ui-spec terminal-fallback table says "Width < 60 cols: option labels truncate with …" — the Other row is an option row of the list and is the one label that never truncates. terminal-budget.ts's own contract states "the renderers' existing truncation keeps every line inside the terminal", which this renderer violates; pi-tui's Text word-wraps overlong elements into extra rows, shifting panel layout on ultra-narrow terminals. The footer's minimal form ("└ 0/2 answered ⏎ ┘", 18 cols) similarly overflows below width 18, but the Other-row label is the unambiguous spec violation.

**Steps to Reproduce**:
Create a panel over one choice question; call panel.render(w) for w in [10, 20, 30]; measure visibleWidth of every returned line — the "✎ Other — write your own" line is 32 visible columns in each, exceeding w (< 32). Compare with a long real option label at the same widths: it correctly truncates with …. Code: src/panel/short-view.ts otherLine() (~line 280-303) — no truncateVisible on the label; every sibling renderer (optionLine ~line 252, textAffordanceLine ~line 311) truncates.

### Issue 2: Auto-submit 'submitted — {n} answer(s)' footer flash is set after the panel already suspended — never observable
**Severity**: Minor
**ID**: BUG-003
**Location**: src/panel/actions.ts:1063

**Description**:
maybeAutoSubmit() calls submit(panel, d) and only afterwards calls panel.flash("submitted — {n} answer(s)"). But submit() ends with panel.suspend() (FR-3d post-submit exit: done(null), the panel unmounts and pi restores the main editor), so the flash is staged on an unmounted component and the user never sees it. AUTOSUBMIT-001/AC-2c specify the footer flash as the observable confirmation of a no-keypress delivery ("footer flashes `submitted — {n} answer(s)`"); in practice only the transcript diff card remains (which FR-3d names the confirmation), so the user-facing result is close to intent, but the specified flash is dead code on every auto-submit firing. Either render the flash before suspending (a final frame), or route the confirmation through a post-suspend notify.

**Steps to Reproduce**:
Headless: construct a panel with delivery deps, answer the last open question via acceptOptionIndex → maybeAutoSubmit → submit() runs panel.suspend() (done(null) fires), then panel.flash(...) executes on the resolved/unmounting panel. Inspect ordering in src/panel/actions.ts: submit() tail (panel.suspend(), ~line 955) vs maybeAutoSubmit tail (panel.flash after submit returns, ~line 1063).

### Issue 3: index.ts wiring comment claims session_start auto-opens the panel — contradicts the locked SURFACE-002 ruling it sits next to
**Severity**: Minor
**ID**: BUG-004
**Location**: src/index.ts:132

**Description**:
The createReconstruction wiring comment in index.ts says reconstruction splits "BY ORIGIN: session_start auto-opens the panel (TUI, FR-28) or sets the non-TUI digest fallback flag". That is the pre-SURFACE-002 behavior and the opposite of what the code does: reconstruct.ts's session-start path NEVER opens the panel (updateSuspendWidget only), as the SURFACE-002 ruling (2026-09-19, "Disable auto-open entirely") and the tree-nav/reconstruct tests pin. A reader patching the wiring from the comment could reintroduce the exact surprise-surfacing bug class R6/SURFACE-002 exists to prevent (the empty-box-after-esc data-loss trap). Comment-only, no runtime effect — but it documents a hard requirement (R6) incorrectly at the single wiring site future maintainers will read.

**Steps to Reproduce**:
Read src/index.ts createReconstruction block (~line 128-140): "then split BY ORIGIN: session_start auto-opens the panel (TUI, FR-28) or sets the non-TUI digest fallback flag; session_tree is SILENT". Compare src/reconstruct.ts reconstructFromBranch session-start tail: updateSuspendWidget(ctx, state) only, plus the module-level SURFACE-002 JSDoc ("session_start NEVER opens the panel").

## Testing Summary
- Total bugs found: 4
- Critical: 0
- Major: 1
- Minor: 3

## Recommendations
- Extend DiffEntry (src/snapshots.ts computeEntries + the synthetic-entry seam in src/panel/actions.ts) with optional `text` and `custom` fields and apply them in replaySubmission (src/reconstruct.ts) so replayed answers restore the full answer shape; add a regression test replaying a submission carrying an elaborated option answer and a custom write-in.
- Route otherLine's OTHER_AFFORDANCE label through truncateVisible with the same budget math as optionLine so every panel line fits sub-60-col terminals.
- Move the auto-submit confirmation before submit()'s panel.suspend() (or emit it via the post-suspend notify channel) so the AUTOSUBMIT-001 flash is observable.
- Fix the stale 'session_start auto-opens the panel' comment in index.ts to match SURFACE-002 (widget-line only), and consider a static guard asserting the comment block no longer claims auto-open.

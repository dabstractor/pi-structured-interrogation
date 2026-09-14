# Validation Report — pi-interrogator (Round 2)

## Overview

Validated the codebase end-to-end against the round-1 bug report (PRD) and the
underlying spec set (`spec/*.md`). Method:

- Read all core modules and the 15 bugfix commits (`f958f86..6ae4343`) plus
  the decision-ledger pins (`f3c2564`).
- Ran the full unit suite: **1028 tests, 43 files, all green** (`vitest run`),
  plus `tsc --noEmit` (clean) and the repo's keymap-conflict guard (clean).
- Re-ran **every round-1 reproduction step** as scripted probes against the
  real code paths (executor, lifecycle, panel actions, key router,
  reconstruction) — 19 regression probes, all passing.
- Drove the **real pi runtime** headless: the extension loads cleanly in
  `pi -p -e ./src/index.ts`, and the model executed the real `interrogate`
  tool in print mode (upsert → numbered digest → epoch 1 returned).
- Hunted for new defects through the **production wiring** (how `index.ts`
  actually opens panels and delivers submissions), which unit tests mock away.

**Result: all 12 round-1 bugs are verified FIXED. 4 new issues found
(1 critical, 2 major, 1 minor).** The critical one means the TUI submission
loop — the product's core interaction — is inert in a real session.

## Round-1 Bug Status (all verified fixed)

| ID | Round-1 issue | Verification (probe) |
|---|---|---|
| BUG-001 | Goal never updatable | Goal on later upsert replaces stored goal, reaches read result; omitted goal retained |
| BUG-002 | Second interrogation never completes | Completed singleton swapped for fresh state (epoch 1, goal retained, `completed=false`); second interrogation fires its completion record |
| BUG-003 | Submission delta omits epoch | Content ends `(state epoch {n})` with POST-bump epoch; echoing it passes `assertFresh` in one round trip |
| BUG-004 | Non-TUI never closes/completes | `recordAnswers` marks `submitted`; close pass archives; completion fires in print mode |
| BUG-005 | Pending answers stranded after suspend | `/interrogate` toggle on a suspended 0-open/answered-pending panel returns `resumed`; all-terminal stays `empty` |
| BUG-006 | dependsOn moot-ness stale / stuck moot | Agent upsert re-evaluates instantly (result state shows `moot`); re-upsert removing dependsOn reopens (`moot → open`) |
| BUG-007 | Reconstruction stores labels as values | Replay uses `DiffEntry.value` (raw); value `b` restored when label is `Beta`; dependent stays open |
| BUG-008 | Submit destroys re-asked drafts / ships `(unanswered)` | Only user-shipped ids flush and appear in the delta; preserved draft survives submit; agent-only resets no-op without epoch burn |
| BUG-009 | Goal cap unenforced | Create and update paths truncate stored goal to 400 with warning in result |
| BUG-010 | Missing-epoch upserts accepted | Upsert touching existing ids without epoch rejected with current epoch; all-new-id first upserts stay exempt |
| BUG-011 | Blind ctrl+t text focus in deep/overview | ctrl+t inert in deep/overview (router returns false), live in short view |
| BUG-012 | answers[] resurrects terminal questions | Recording against withdrawn/moot/closed ids → `not recordable`, status untouched, no epoch burn |

Guards around the fixes also hold: stale-epoch rejection still fires
(`STALE: session epoch is 2`), the integrated TUI loop (upsert → panel answer
→ submit → close → completion) fires the completion record exactly once with
the full h2.46 grammar, and the print-mode `answers[]` epoch guard still
throws.

## Critical Issues (Must Fix)

### Issue 1: ctrl+s is inert in production — no SubmitDeps is ever wired
**Severity**: Critical
**ID**: NEW-001
**Location**: `src/panel/panel.ts:1385` (`maybeAutoOpen`: `openPanel(ctx, { config, state, drafts })` — no `delivery`); same omission in `resumeOpenPanel` (spreads `lastOpts`, panel.ts:1351) and `handleUpserted` (panel.ts:1153); `src/panel/keys.ts:246` (`defaultRoutedActions` submit returns `false` when deps undefined); `src/index.ts:128` (the only factory wiring, passes no delivery). No non-test, non-debug code in the repo constructs a `SubmitDeps` (`{ sendMessage, isIdle, noteSubmissionDelivered }`).

**Description**:
FR-3 / commitment 1-2 / AC-2 make ctrl+s the heartbeat of the product: submit
pending answers → delta message to the model → epoch bump → auto-close →
completion. The panel's submit action requires a `delivery` (SubmitDeps)
object carrying `pi.sendMessage`; the panel opened by the production path
(`maybeAutoOpen`, triggered by `tool_execution_end`) never receives one, so
`defaultRoutedActions`'s submit closure hits its `deps !== undefined` guard
and **returns false — ctrl+s is not even consumed by the panel**. In a real
TUI session the user can answer questions, but no submission ever fires: no
delta, no diff card, no epoch bump, no auto-close, no completion. The
interrogation can never finish through the documented UI. All 1028 unit tests
pass because they inject mock deps; the scripted ACs pass because the debug
commands (`/interrogate-debug-submit`) build their own delivery; the manual
TUI runbook's results table is empty (never executed), and it doesn't even
list AC-2/AC-3 (submit).

**Steps to Reproduce** (probe `NEW-1`, driven through the exact production wiring):
1. `maybeAutoOpen(surface, config, host, drafts)` — exactly what `index.ts` registers.
2. Real executor upsert (`executeInterrogate({goal, questions}, {mode:'tui'})`).
3. Fire `tool_execution_end` with the run ctx → panel mounts via `pi.ui.custom`.
4. Answer q1 via real keystrokes (`\r`) — status becomes `answered` (this works).
5. Press ctrl+s (`\x13`): **consumed=false, 0 messages sent, epoch stays 1,
   status stays `answered`**. Verified via vitest probe against the real
   `maybeAutoOpen` → `openPanel` → `InterrogationPanel` chain.

**Fix direction**: construct one `SubmitDeps` in the factory
(`{ sendMessage: pi.sendMessage.bind(pi), isIdle: (ctx) => ctx.isIdle?.(), noteSubmissionDelivered: () => lifecycle.noteSubmissionDelivered() }`),
thread it through `maybeAutoOpen`/`openPanel`/`lastOpts`, and add a wiring
test that drives submit through the production open path (not injected mocks).

## Major Issues (Should Fix)

### Issue 2: `type:"text"` questions cannot be answered from the panel — the interrogation can never complete
**Severity**: Major
**ID**: NEW-002
**Location**: `src/panel/actions.ts:219` (`accept` returns early for text questions without applying an answer); `src/panel/actions.ts:330` (submit's pending set = `status === "answered"` ids only); no code path calls `applyAnswer` for a text question in TUI.

**Description**:
The tool schema, spec (Q16: "types: choice, text"), and completion-record
grammar all support free-text questions. In the TUI panel the user types the
answer into the embedded editor (the primary affordance for text questions)
and presses enter — stage-1 saves a panel-local draft and nothing else. The
question's status never leaves `open`, so submit's pending set is empty:
ctrl+s (once NEW-001 is fixed) flashes `nothing to submit`, the typed text
never enters state, never reaches the model (answers[] is ignored in TUI),
and the question blocks completion forever (`open` ∈ BLOCKING). Verified via
probe `NEW-2`: type → enter → submit ⇒ answer `undefined`, status `open`,
nothing sent. Non-TUI mode is unaffected (chat `answers[]` records values and
text). Root cause is shared with NEW-003: drafts never reconcile into
answers at submit time (h2.45: "destroyed only by submission — **text answers
ship**").

**Steps to Reproduce**:
1. Upsert `{id:'t1', prompt:'describe', type:'text'}`.
2. Panel: focus text field, type "my detailed answer", enter (draft saved:
   `getDraft('t1') === 'my detailed answer'`).
3. ctrl+s ⇒ `state.questions.t1.answer` is `undefined`, status `open`, no
   message sent, epoch unchanged. The draft is never deliverable by any means.

### Issue 3: typed elaborations (✎ drafts) are silently discarded at submit
**Severity**: Major
**ID**: NEW-003
**Location**: `src/panel/actions.ts:389` (`shipDrafts(...)` return value unused — slots deleted, content dropped); `src/panel/actions.ts:243` (`proposed = { value, at }` — `answer.text` never attached).

**Description**:
R4 (hard requirement) and ui-spec h2.45 state drafts are "destroyed only by
submission (**text answers ship**)": the ✎ elaboration a user types next to a
choice answer is supposed to ship with it as `answer.text`, appear in the
delta, and show in the completion record's `{— free text}` segment. The
implementation deletes the draft at submit and discards its content:
`answer.text` stays `undefined`, the delta line shows only the option label,
and the completion record's free-text segment can never appear for TUI
answers. The user's reasoning silently vanishes. Verified via probe `NEW-3`:
answer 'a' + draft "because of latency" → submit ⇒ sent content
`Submitted 1: q1: Alpha (state epoch 2)` (no elaboration), answer
`{value:'a', at}` (no `text`), draft gone. Same root cause as NEW-002.

**Steps to Reproduce**:
1. Upsert choice q1; answer it via `accept`; focus ✎ field, type
   "because of latency", enter (draft saved).
2. ctrl+s ⇒ delta omits the text, `answer.text` undefined, draft deleted.

## Minor Issues (Nice to Fix)

### Issue 4: batch notes never reach the completion record (`NOTES: (none)` always)
**Severity**: Minor
**ID**: NEW-004
**Location**: `src/index.ts:73-77` (`createCompletionTrigger(pi, { lifecycle })` — `getBatchNotes` never supplied); `src/completion.ts:125` (notes come solely from `opts.getBatchNotes`).

**Description**:
h2.46 requires the completion record to collect the batch notes in order
(`NOTES: {batch notes in order}`), and `buildCompletion` supports it — but the
production trigger wiring never passes `getBatchNotes` (grep confirms no
non-test call site supplies it). Every real completion record therefore reads
`NOTES: (none)` and the recap card's notes list is empty, even when the user
shipped notes with submissions. Impact is bounded (each NOTE: line did reach
the model in its submission delta), but the completion record is what the
model writes the spec from, and post-compaction it is the only consolidated
source.

**Steps to Reproduce**:
1. Submit with a batch note (delta content includes `NOTE: ...`).
2. Complete the interrogation ⇒ record content contains `NOTES: (none)`.

## Testing Summary

- Round-1 bugs re-verified: 12/12 fixed (19 scripted regression probes, all passing).
- New bugs found: 4 (1 critical, 2 major, 1 minor).
- Unit suite: 1028 tests / 43 files, green. Typecheck: clean. Keymap guard: clean.
- Real-pi E2E: extension loads headless; real tool execution in print mode returns the epoch.
- Reproductions for all new issues are embedded in `validate.sh` Phase 4
  (`[BUG] NEW-1/2/3` probes fail loudly while the defects exist; NEW-004 is a
  wiring-gap finding evidenced by the missing `getBatchNotes` call site).

## Recommendations

- Wire a production `SubmitDeps` once in the factory and thread it through
  every `openPanel` path (`maybeAutoOpen`, `resumeOpenPanel`,
  `handleUpserted`); include `noteSubmissionDelivered: () =>
  lifecycle.noteSubmissionDelivered()`. Add a wiring-level test that mounts
  the panel via `maybeAutoOpen` and asserts ctrl+s delivers a submission.
- Reconcile drafts into answers at submit: for `type:"text"` questions apply
  `applyAnswer(id, { value: draftText, at })` when the user ships; for choice
  questions attach the shipped draft as `answer.text` so deltas and the
  completion record carry elaborations per R4/h2.45.
- Supply `getBatchNotes` to `createCompletionTrigger` in `index.ts` (collect
  from delivered submission messages' `details.note`).
- Re-run `./validate.sh` after fixes: Phases 1-3 and the 19 `[OK]` probes
  must stay green and the 3 `[BUG]` probes must flip to passing.

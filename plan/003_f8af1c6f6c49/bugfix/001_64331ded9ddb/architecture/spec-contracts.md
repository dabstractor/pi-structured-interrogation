# Spec Contracts — Bugfix 001_64331ded9ddb (BUG-001..005)

All anchors verified TODAY by reading spec/*.md in the working tree. Short verbatim excerpts; longer clauses paraphrase-checked.

## 1. FR-2 Archived editing — spec/product-requirements.md:20
> "FR-2 The user answers any subset, in any order, editing earlier answers freely (including archived ones — archived means 'not pending', not 'immutable'). Editing re-marks a question pending."

## 2. FR-3 ctrl+s submits ALL pending — product-requirements.md:22
> "FR-3 `ctrl+s` submits all pending answers immediately (no review screen). Each submission: (a) delta message… (b) user-only diff card… (c) epoch bump, (d) post-submit exit…"
Auto-submit clause same line: fires "after an answer commit — option accept, Other write-in commit, text-answer enter, ripple-confirm applied edit — when zero unanswered (open/reasked) questions remain AND the commit is either (a) the last-unanswered TRANSITION… or (b) an edit of the last sequential ANSWERABLE question…" Gate hold: "while gate-group questions are unanswered, commits show the non-expiring `⚠ {n} foundational unanswered — answer them or {submit} to submit now` line instead of auto-submitting".

## 3. FR-5 completion — product-requirements.md:25
> "FR-5 When the last open question closes, the extension injects the complete Q&A record once (`interrogation-completion` message) and the panel auto-dismisses."

## 4. FR-17 moot reason — product-requirements.md:34
> "FR-17 Questions may declare `dependsOn: [{id, equals?, notEquals?}]`. Conditions are evaluated locally and instantly: unmet questions grey out as moot with reason (`moot: storage=sqlite`), kept in the map (audit trail), never silently removed."

## 5. FR-18 ripple confirm — product-requirements.md:35
> "FR-18 When the user changes an answer to an *answered* question and the change invalidates other answered/submitted questions via `dependsOn`, the panel shows an inline confirm before applying: `⚠ Invalidates 3 answered questions (Q7, Q12, Q19) — enter=keep, esc=cancel`. No drill-down in v1. A same-value re-commit is not a change — no confirm, no state write (ANSWER-PIN-001)."

### Q39=B force-accept wording — spec/decisions.md:70
> "Q39 = B: dependsOn in v1 → edit-time ripple confirm with forced accept/cancel. Rationale: user explicitly specified this UX."
(Human wording per BUG-003 verdict: "give them an overview of how many previously-answered questions they're invalidating… force them to accept or cancel" — a defaulted decision the user explicitly worded.)

## 6. FR-21 merge rules — product-requirements.md:37
> "FR-21 Merge rules on upsert, by id: same options → silent text update, answers kept; changed options → answer reset + re-asked marker; new id → appended open; omitted id → withdrawn. Typed drafts always survive upserts."
(Rule 1 = same options: answers KEPT; rule 2 = changed options: answer deleted, status reasked.)

## 7. FR-35 answer pinning — product-requirements.md:57-58 (full block)
> "**A recorded answer owns the cursor; the recommendation never displaces or re-proposes it.** Whenever a question carrying an answer is rendered or entered — any status with `answer` present… `enter` (and digit quick-select) on the already-recorded value is a state NO-OP that may advance (Q14 rhythm): no `applyAnswer`, no fresh `answer.at`, no ripple modal, no auto-submit trigger…"

**Tension (BUG-001):** ANSWER-PIN-001's no-op collides with FR-3/AUTOSUBMIT ("ripple-confirm applied edits" and rule-1 re-asks keeping the answer) — spec doesn't say whether a no-op on a `reasked` question confirms the re-ask. This is the underspecified seam.

## 8. Acceptance criteria — product-requirements.md:59-73
- AC-2 (:61): "Answer 2 of 30, `ctrl+s` → model receives a ≤3-line delta + reminder… epoch bumps."
- AC-2c (:63) **Auto-submit**: "answer the LAST remaining question (accept / write-in / text `enter`) → submission delivers with no keypress beyond the answer itself; footer flashes `submitted — {n} answer(s)`; editing an already-answered question while the set is complete ships the edit immediately (one submission per commit)."
- AC-3 (:64): "Agent replies without upsert → the 2 close… Agent replies with a re-ask of one → that one shows re-asked, answer reset, draft preserved."
- AC-6 (:67): "Answer a gate question contrary to a `dependsOn` → dependent greys as moot with reason, instantly; overview shows ⊘."
- AC-13 (:74): "Editing an archived answer re-marks it pending; next submission diff card highlights the change (`Q3: sqlite → postgres (changed)`)."
- AC-16 (:76) **Answer pinning**: "…`enter` advances to the next unanswered with zero state change (no modal, no epoch bump, no `answer.at` rewrite)."

## 9. Commitment 8 — spec/SPEC.md:16 ("Core commitments")
> "8. **The user's answer is the user's work — nothing re-proposes or displaces it (ANSWER-PIN-001).** Once a question carries an answer (any status), the caret/highlight sits on that answer… `enter` or a digit on the already-recorded value is a state no-op (advance only) — never a re-proposal, never the FR-18 modal, never an `answer.at` rewrite, never a submission trigger… No exceptions."
(User's words, decisions.md:61: "DO NOT RE-PROPOSE ANYTHING AFTER A USER HAS SELECTED AN ANSWER… Always keep the user's answer. No exceptions.")

## 10. AUTOSUBMIT-001/002/003 exact texts
- **AUTOSUBMIT-001** — decisions.md:47: "every answer commit (accepts, write-ins, text enters, EDITS of answered questions) auto-submits through the exact ctrl+s pipeline whenever zero open/reasked questions remain; footer flashes `submitted — {n} answer(s)`; held notes ride…"
- **AUTOSUBMIT-002** — decisions.md:48 (gate hold; non-expiring ⚠ line, ctrl+s override).
- **AUTOSUBMIT-003** — decisions.md:58-59 (§ 2026-09-30): "New trigger, both rules require zero open/reasked + ≥1 pending first: (a) the TRANSITION… (b) the review-flow exit — the set was already complete and the commit edited the last sequential ANSWERABLE question… All other edits of a complete set ship nothing — manual ctrl+s."
- ANSWER-PIN-001 text — decisions.md:59-61 (§ 2026-10-04); ruling (2): "enter/digit on the recorded value is a state no-op — no applyAnswer, no `answer.at` rewrite, no ripple modal, no auto-submit trigger; advance only." FR-35 = PRD :57-58.

## 11. state-and-persistence.md
- **State machine (:7-30)** — includes `reasked → (user answers) → answered(pending)` and "user answers/edits … open→answered(pending)"; moot/withdrawn "terminal-until-re-upsert; both stay visible (dimmed, with reason) — the audit trail (Q34=A)"; "Editing the closed answer re-marks it `answered(pending)`".
- **Ripple clause (:32) VERBATIM**: "Answer edits apply through the ripple confirm (ui-spec.md) before entering `answered(pending)`. A same-value re-commit is not an edit — no confirm, no state write (ANSWER-PIN-001)." (Note: unconditional — no status carve-out for closed; this is BUG-003's binding quote.)
- **rev/epoch (:34-37)**: rev bumps on content mutations only; "epoch… bumps on every submission — including every auto-submitted one… Read is never guarded." Both guards reject with current state + delta digest.
- **Auto-close algorithm (:99-108) VERBATIM core**:
  ```
  on submission delivery: submittedRun = false
  on tool_execution_end (interrogate, action=upsert): mark each touched submitted question reasked; submittedRun = true
  on agent_settled:
     for q in submitted-at-current-epoch:
        if q not reasked this run → status = closed (archived)
     if no open/reasked/answered/moot questions remain → completion flow:
        inject interrogation-completion (full record, once) → dismiss panel → clear in-memory state
  Aborted runs count as settled…
  ```
  Plus (:110): auto-submit fires "the same pipeline more often"; close-pass snapshots (no epoch bump) supply the `before.status === "closed"` side for AC-13 `(changed)` diffs; digestSince treats close-pass pairs as no-ops when answer signatures are identical.
- **Persistence schema (:44-48, :57)**: `answer = { value, at, text?, custom? }`. Storage layers = in-memory state / tool-result `details` / custom entries. **Question moot reason: no dedicated persisted field** — mootness is *recomputed*: reconstruction step 5 (:78) "recompute dependsOn moot-ness from current answers (cheap, idempotent)"; the FR-17 reason string is derived (depends-on.ts `dependencyMet`/failReason). So BUG-004 is render-only; no schema change needed.
- **Epoch after completion**: 2026-09-14 pin (decisions.md:64): "a new interrogation after completion REPLACES the completed singleton — fresh state, epoch 1, completed=false… the exactly-once completion guard is per interrogation lifecycle." Plus (:69): "epoch is REQUIRED only when an upsert touches existing question ids; the first upsert of an interrogation (all-new ids) may omit it" — this is the intent BUG-005 violates (spurious STALE on honest echo).

## 12. decisions.md — D-R6 and bridge removal
- **D-R6 (:41) VERBATIM (key clause)**: "bridge submissions flush answered→submitted even when the diff is empty (identical re-selections after a rule-1 re-ask — conformant clients re-submit the full set) and honor the h2.44 line-1 contract on that flush path too; all four variants found by the live RPC itest as completion deadlocks."
- **Bridge removal (:62-66, 2026-10-02)**: "Removed: remote-bridge.ts, remote-submit.ts, their tests, and scripts/remote-rpc-itest.mjs"; ruling (3): "the panel, tool executor, lifecycle, close pass, and completion trigger are exonerated — unchanged." The panel path retained `submit()`'s zero-diff early return (actions.ts:595) — the D-R6 flush fix was bridge-only → BUG-002.
- **D-R13 display mapping (:73, 2026-09-30 §, listed as "Recommended-first display order")**: option rows/sections render recommended-first, stable sort, display-only; digit quick-select follows displayed order; "accept maps display→option internally (`displayOptions`)." (Also ui-spec.md:90.)
- **Same-value no-ops (FR-D9/ANSWER-PIN-001)**: decisions.md ANSWER-PIN-001 block (:59-61) — no explicit status list beyond "every status carrying `answer`"; FR-35 (:57) lists "answered, submitted, closed; moot keeps its dimmed answer too".

## 13. ui-spec.md contracts
- **Moot rendering**: overview (:20): "`⊘` moot (+reason, dimmed)". Ripple confirm section (:69) verbatim: "…footer becomes `⚠ Invalidates {n} answered questions ({ids}) — enter=keep, esc=cancel`; `esc` reverts the edit; `enter` applies… An identical re-commit… is not a change: no modal, no state write, advance only (ANSWER-PIN-001)."
- **Short view line format** (:15 layout block): question line `{group label} · Q7/{id} {title}  [⟳ re-asked]`, hint line, option rows, `✎ Other` row. Moot dims the whole pane (D-R14 note, :91).
- **Overview contract** (:20): markers `· ★ ⟳ ⊘ ⊗ ✎`, group headers, gate `▲`, `enter` jumps.
- **Footer flashes**: :55 "the footer flashes `submitted — {n} answer(s)`"; :134 "Zero-pending `ctrl+s` → no-op footer flash `nothing to submit` — or, when drafts sit on unanswered questions, `nothing to submit — {n} question(s) have drafts awaiting an option or Other`."
- **Auto-submit section** (:52-56) — pipeline spelled: "reconcile → baseline/diff → BUG-008 filter → gate check → markSubmitted → buildSubmission → deliverSubmission → noteSubmissionDelivered"; "maybeAutoSubmit runs after panel commits — the commit context (`wasUnanswered`, `questionId`) is load-bearing".

## 14. Test conventions & regression-test homes
- Colocated vitest (`*.test.ts`), scripted only — plan/003_f8af1c6f6c49/architecture/testing-verification.md: "Scripted vitest ONLY — no live TUI, no live tool calls… Every subtask implies TDD: failing test → implement → pass." Green gates: `npm test`, `npm run typecheck`, plus `src/no-hardcoded-keys.test.ts`, `src/keymap-guard.test.ts`.
- **Fixture anti-pattern to avoid (BUG-004 mask)**: overview.test.ts:205-279 pre-bakes the literal reason string into fixture `answer.text` — never happens on the production path; tests must derive reasons via `evaluateDependsOn`.
- **vite-node headless probe pattern** (from bugfix/001_64331ded9ddb/prd_snapshot.md + bug-hunt-transcript.log): scripts run from /tmp via `vite-node`, driving ONLY public seams — `executeInterrogate` (tool) + lifecycle event bus (`tool_execution_start/end`, `agent_settled`) + `InterrogationPanel` (accept/submit/renderers) — asserting status strings, footer flash text, delivery counts, epochs.
- **Regression-test file mapping**:
  - BUG-001/002 (re-ask no-op + zero-diff early return): `src/panel/actions.test.ts` (acceptOptionIndex/submit/maybeAutoSubmit), `src/lifecycle.test.ts` (tool_execution_end reasked flip), `src/snapshots.test.ts`/`src/delivery.test.ts` (diff/close-pass).
  - BUG-003 (closed-edit ripple): `src/panel/ripple-confirm.test.ts`, `src/panel/actions.test.ts`, `src/panel/panel.ts stageText path` covered by `src/panel/text-field.test.ts`.
  - BUG-004 (moot reason render): `src/panel/short-view.test.ts`, `src/panel/overview.test.ts`, `src/panel/layout.test.ts` (statusMarkers), `src/depends-on.test.ts` (reason format), `src/delivery.test.ts` (completion already correct).

## 15. README.md (432 lines) — sections & doc-sync touch points
Sections: Install(:11) · Usage(:30) · Configuration(:127) · Keymap(:180) · Subcommands(:242) · Acceptance criteria(:258) · Limitations(:286) · Development(:307) · Project structure(:398).
Already documents: auto-submit + gate hold + epoch echo guidance (:60-69, :98 "epoch-guarded — upserts touching existing ids must echo the current epoch"; :107 fresh interrogation "the epoch restarts at 1"), moot via dependsOn (:274 AC-6, no reason-format detail), re-ask (:78-80 "re-asks… survive"), archived-answer editing (:281 AC-13).
Doc-sync for these fixes: **Usage** (re-ask confirmation semantics if BUG-001 adds a confirm gesture; "nothing to submit" behavior after re-ask), **Acceptance criteria** (:266-281, mirror AC updates), **Limitations** (:286 — re-ask wedge currently user-invisible), possibly a note near :98/:107 for BUG-005 epoch echo behavior.

## 16. plan/003_f8af1c6f6c49/architecture/*.md (cross-reference, don't duplicate)
- **system_context.md** — repo/stack, scripts, spec-commit/code-commit lineage; "everything else already shipped — cite, don't rebuild" list (BUG-001..008 wave, D-R11–14, AUTOSUBMIT-003 `2bc2e7c`, bridge removal `f4969c7`, FR-3d post-submit exit `2aae6ea`).
- **panel-ui-seams.md** — cursor-seeding seams (initialCursorIndex short-view.ts:119, seed sites panel.ts:354, ~888-896, displayOptions) — anchors dated 2026-10-05/HEAD c7d44c0; RE-VERIFY before use (may have drifted).
- **answer-pinning-contract.md** — FR-D8/D9/D10 extraction; FR-D9 inert no-op is the contract BUG-001 must reconcile (no-op "may advance" but must not wedge completion).
- **testing-verification.md** — AUTOMATION-POLICY policy + to-flip test map (for the PREVIOUS delta; lists actions.test.ts:541 `test_d_cursor_resets_to_star_preselect_on_every_change` etc. — already flipped in delta 003).
- **external_deps.md** — no new dependencies; vitest/ts-only stack.

## 17. Risks / open spec questions
1. **BUG-001 spec gap**: ANSWER-PIN-001's "no-op, advance only" vs rule-1 re-ask (answer kept, status reasked). Spec never says enter-on-recorded-value should confirm a re-ask; fixing requires choosing semantics (e.g., no-op only on answered/submitted/closed; on `reasked`, re-commit the kept answer or ship it) — a product decision needing supervisor/owner sign-off, or minimally documented as pin amendment.
2. **BUG-002 fix**: relax `submit()` zero-diff early return (actions.ts:595) when pending answers exist (D-R6 parity for the panel path) — must not break digestSince's "identical signatures contribute zero segments" close-pass no-op contract (state-and-persistence.md:110) or the AC-13 `(changed)` diff logic.
3. **BUG-003 fix**: widen FR-18 seam to closed-edited questions (state doc quote is already unconditional; PRD FR-18 says "*answered* question" — PRD wording may need a one-line amendment too).
4. **BUG-004 fix**: render `evaluateDependsOn`'s reason in short-view/overview; flip masked fixtures first.
5. **BUG-005 fix**: assertFresh after completed-swap in tool.ts:300 — align with the 2026-09-14 pin (first upsert of a new interrogation is guard-friendly); keep guards.test.ts's existing staleness rejections intact.
6. Baseline is green (1265 tests); no test may regress without an explicit flip + rationale.

# Research — P1.M1.T1.S2 (bugfix 001_64331ded9ddb): maybeAutoSubmit empty-diff transition delivers + flashes truthfully

Verified against working tree + architecture/reask-confirmation-loop.md §1.4.

## maybeAutoSubmit today (src/panel/actions.ts:735–796)
Order: `d = deps ?? panel.delivery; if (!d) return` → unanswered (open|reasked) :742-745 → pending (answered) :746 → **gate hold** :758-766 (`n>0 && pending>0` → arm panel.gateWarning, return; no flash) → `if (unanswered>0) return` :767 → `if (pending===0) return` :768 → **AUTOSUBMIT-003 gating** :775-788 (`commit === undefined` → return; `!commit.wasUnanswered` → only fires when commit.questionId is the last ANSWERABLE id) → `const shipped = submit(panel, d)` :790 → `if (shipped) panel.flash("submitted — ${pending} answer(s)")` — literal "answer(s)", count = pre-commit pending.

Pre-S1, submit() early-returned true-with-no-delivery on pending+empty-diff → the auto path was dead AND the "can never flash a lie" comment (docblock ~:731-733) is now half-stale: with S1's pendingIds-keyed fall-through, submit REALLY delivers on that path, so the flash becomes truthful — the docblock's zero-shipped commentary needs rewording ONLY if production code changes (per item contract: no production change expected).

## S1 contract consumed
submit() :583-665 re-keyed: `if (pendingIds.length === 0) { heldDrafts flash; return true; }`; non-empty pending + empty diff falls through the FULL pipeline (markSubmitted, buildSubmission with augmented DiffEntries, shipDrafts, deliverSubmission, noteSubmissionDelivered, note clear, suspend) → returns true WITH real delivery. Signature/return unchanged.

## Test sites (actions.test.ts)
- :2293 `test_auto_reasked_question_blocks_the_firing` (reasked blocks — keep green, the neighbor)
- :2309 `test_auto_zero_pending_complete_set_noops_silently` (keep green — zero-pending silence)
- Harness: seed/makePanel/makeDeps at :29-112; `makePanel(state, { delivery: deps })` wires the delivery stub so maybeAutoSubmit's `d` resolves; accept(panel) drives the commit tail which passes the commit context `{wasUnanswered, questionId}`.
- Rule-2 re-ask fixture pattern: bug008 tests (:953/:995/:1026) show agent-reset seeding style; S1's new BUG-002 ctrl+s test (next to :886) shows the full round: answer → submit (snapshot S1, epoch 2) → rule-2 re-ask (answer deleted, status reasked) → re-accept same value (answered).

## Test (a) design — BUG-002 repro step 4 via the AUTO path
1. seed q1 [a,b,c]; applyAnswer a; submit (deps) → delivered, epoch 2, snapshot S1 (answer=a).
2. Rule-2 re-ask: options [a,b,d], answer undefined, status reasked.
3. panel.currentId='q1', cursorIndex=0 (a's display row), accept(panel) → applyAnswer 'a', status answered, commit tail calls maybeAutoSubmit with wasUnanswered=true.
ASSERT: sendMessage total 2 (one NEW call), state.epoch === 3, snapshots length 2, q1.status === 'submitted', panel.footerFlash?.text === 'submitted — 1 answer(s)'.
Equivalent direct call: maybeAutoSubmit(panel, deps, { wasUnanswered: true, questionId: 'q1' }) — use the accept path (public seam) for the main test; the direct call variant is a cheap extra.

## Test (b) gate hold precedence — same fixture + gate
Add g1 gate-group OPEN + n1 later; commit on n1 with gate unanswered → hold armed (panel.gateWarning {kind:'hold'}), no submit, no flash, epoch unchanged. (Mirrors the reordered-hold tests from the earlier wave; here it pins that the hold still precedes the transition firing.)

## Test (c)
:2309 unchanged and green (zero-pending complete set silent).

## Doc note
Only if a minimal fix lands in maybeAutoSubmit: reword docblock ~:731-733 ("can never flash a lie" commentary) to match the truthful path. No other docs.

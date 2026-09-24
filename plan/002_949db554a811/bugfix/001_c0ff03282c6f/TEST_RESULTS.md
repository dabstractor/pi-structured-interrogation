# Bug Fix Requirements

## Overview
Tested the pi-interrogator implementation end-to-end against the PRD delta scope (WRITEIN-001/002 write-ins, AUTOSUBMIT-001/002 completeness auto-submit + gate hold, SURFACE-001/002 surfacing gates, remote bridge parity, plus the surrounding lifecycle/protocol). The repo's own suite (1224 tests) and typecheck pass; I additionally drove 12 adversarial harnesses against the real modules: full write-in journeys (Other-row commit, empty-buffer, elaboration, supersede/rebind, multi-line/unicode/3000-char inputs), ripple modals for option and write-in edits, key routing (esc-esc, ctrl+t toggle, digits, note mode), executor actions (read/record/upsert/stale guards/caps), bridge submits on a fake events bus (customText write-ins, invalid answers, resurface), a full extension-factory E2E (upsert→panel open→suspend/widget→read-no-surface→/interrogate resume→bridge submit→agent settle→completion record), and draft-sacredness gestures. SURFACE-001/002, the core auto-submit pipeline (epoch-per-firing, one submission per commit, note rides), bridge parity (customText→custom:true, one submission for mixed panel+bridge answers), write-in plumbing (✎ in reads/cards/completion, digit exclusion, deep-view Other section, overview markers), and the stale-guard self-heal all work as specified. Found 8 real issues: 3 major — (1) the AUTOSUBMIT-002 gate-hold ⚠ line is dead code in every natural flow (the canonical 'answering later groups before the foundational one' scenario shows nothing, contradicting FR-3/AC-2d and the README), (2) three editor-exit gestures (ctrl+c, discuss, note mode) destroy typed-but-unsubmitted text in violation of hard requirement R4, and (3) AC-13's '(changed)' marker for edited archived answers can never fire through the real submit pipeline because snapshots never capture the closed status; plus 5 minor (duty not re-derived after navigation, write-in answers invisible on revisit / inconsistent ✎ markers, unbounded and multi-line model delta for long write-ins, swallowed bridge errors without ack, enter no-op on text-question affordance).


## Critical Issues (Must Fix)
Issues that prevent core functionality from working.

None.


## Major Issues (Should Fix)
Issues that significantly impact user experience or functionality.

### Issue 1: Gate-hold ⚠ line (AUTOSUBMIT-002) never renders in the canonical scenario — hold branch is dead code in natural flows
**Severity**: Major
**ID**: BUG-001
**Location**: src/panel/actions.ts:611 (early return) and src/panel/actions.ts:624-635 (unreachable hold branch); fixture workaround pinned at src/panel/actions.test.ts:1947

**Description**:
FR-3 and ui-spec §Auto-submit require that 'while gate-group questions are unanswered, commits show the non-expiring `⚠ {n} foundational unanswered — answer them or {submit} to submit now` line instead of auto-submitting' (AC-2d: 'with a gate question unanswered, commits show ⚠ … foundational unanswered and do NOT auto-submit'). decisions.md records the premise: 'the scenario is a user filling out later groups before finishing the foundational one'. In maybeAutoSubmit (src/panel/actions.ts:604), the completeness check at line 611 (`if (unanswered > 0) return;`) fires BEFORE the gate-hold arming at lines 624-635. When the gate question itself is open/reasked (the canonical scenario), the function returns with NO hold line. The hold branch is only reachable when a gate question has `answer === undefined` while NOT being open/reasked — i.e. a 'closed' question without an answer, a status the natural state machine cannot produce (`closed` only comes from markClosed on submitted ids, which always have answers; merge.ts:284). Verified live: with g1 (gate, open) + n1/n2 (later group), accepting answers on n1/n2 left panel.gateWarning null and no ⚠ anywhere in the render, while auto-submit correctly withheld. The README (lines 52-53) and AC-2d (line 253) document the behavior the code does not deliver. The repo's own AC-2d test (actions.test.ts:1935-2058) only exercises the hold via a contrived HOLD_FIXTURE with a 'closed'-no-answer gate question, and test_auto_open_gate_question_returns_at_completeness_no_hold_line (:2042) explicitly pins the deviation. User impact: while a foundational question is unanswered, the user gets no feedback that completeness auto-submit is being held and no discoverability of the ctrl+s override.

**Steps to Reproduce**:
1. Panel with questions: g1 {group:'foundation', gate:true, open}, n1 {group:'later', open}, n2 {group:'later', open}, delivery wired. 2. currentId='n1', cursorIndex=0, accept(panel) → commit lands while g1 is unanswered. 3. Repeat for n2. Observed: panel.gateWarning === null; rendered footer shows no '⚠ … foundational unanswered — answer them or Ctrl+S to submit now'. Expected per FR-3/AC-2d: the non-expiring hold line. Root cause: src/panel/actions.ts:611 early-returns before the gate-hold check at :624-635.

### Issue 2: R4 draft loss: ctrl+c, discuss (ctrl+shift+e), and note mode (ctrl+shift+m) exit/swap the editor without the draft write-through
**Severity**: Major
**ID**: BUG-002
**Location**: src/panel/panel.ts:748 (ctrl+c branch), src/panel/panel.ts:903 (suspend without write-through), src/panel/discuss.ts:116, src/panel/panel.ts:1110 (enterNoteMode)

**Description**:
Hard requirement R4/commitment 6: 'Typed-but-unsubmitted text survives … Never destroyed except by explicit user action' and ESC-002's principle: 'Every exit is a draft write-through — backing out never loses typed text (R4)'. Three gestures bypass that discipline: (1) ctrl+c — panel.ts:748 calls this.suspend() directly from ANY state including editor focus (CTRL-C-001), and suspend() (:903) never stages the buffer; (2) ctrl+shift+e (discuss) — a config-level intercept that fires even while the editor holds focus (keys.ts step 4), discuss.ts:116 calls panel.suspend() with no write-through; (3) ctrl+shift+m (note mode) — enterNoteMode (panel.ts:1110) reseeds the shared editor with the note text, overwriting the in-flight question buffer without writing it to its draft slot/store first. Verified live for all three: typed text 'precious elaboration in flight' / 'precious unsaved typing' → draftSlots empty AND DraftStore empty after the gesture; after note-mode exit the editor re-seeds blank. With write-ins (WRITEIN-001) users now type full answers in this editor, so the loss can destroy a complete hand-written answer.

**Steps to Reproduce**:
1. Panel on choice question q1; cursor to the ✎ Other row; accept → editor opens in write-in duty. 2. textField.setText('precious unsaved typing'). 3. handleInput('\x03') (ctrl+c). 4. Observed: panel resolved (done(null) called), drafts.getDraft('q1') === undefined, panel.draftTextFor('q1') === undefined — text destroyed. Same result substituting step 3 with discussInChat(pi, panel) (ctrl+shift+e path, discuss.ts:116) or panel.enterNoteMode() (ctrl+shift+m path, panel.ts:1110 — buffer is reseeded with '' before the note).

### Issue 3: AC-13 '(changed)' marker for edited archived answers is unreachable through the real submit pipeline
**Severity**: Major
**ID**: BUG-003
**Location**: src/snapshots.ts:209 (editedArchived condition) with src/delivery.ts:185 / src/fallback.ts:261 (only snapshot sites, both pre-close)

**Description**:
AC-13/FR-2: 'Editing an archived answer re-marks it pending; next submission diff card highlights the change (`Q3: sqlite → postgres (changed)`)'. computeDiff sets editedArchived = (baseline status === 'closed') (src/snapshots.ts:209), and the panel submit's baseline is always the LAST SNAPSHOT (submissionBaselineOf). But snapshots are only taken inside buildSubmission (delivery.ts:185) and recordAnswers (fallback.ts:261) — both AFTER markSubmitted, when statuses are 'submitted' — and the agent_settled close pass (which flips submitted → closed) never takes a snapshot. So every real submission after an archived edit diffs against a non-closed baseline and editedArchived is always false; the '(changed)' suffix never renders in the model delta or the user card. Verified live: answered q1/q2 → auto-submit (snapshot 1 holds q1 'submitted') → setStatus closed (simulating the settle close pass) → edit q1 via write-in → auto-submit fires → card entry shows editedArchived:false and the content line has no '(changed)'. The repo's AC-13 test (ac-scripted.test.ts:554-635) passes only because it hand-builds `pre` via state.serialize() at the closed moment and calls computeDiff directly, bypassing the snapshot-ring baseline the production submit uses.

**Steps to Reproduce**:
1. Panel with q1 (choice a/b) + q2; answer both (q2 via ctrl+t + enter); auto-submit delivers (1 message, epoch 2). 2. Simulate agent settle close pass: state.setStatus('q1','closed'). 3. Edit q1: currentId='q1', cursor to Other row, accept, type 'edited archived answer', enter → commit + auto-submit. 4. Observed second submission card: {"editedArchived":false}; content line 'Submitted 1: q1: ✎ edited archived answer (state epoch 3)' — no '(changed)'. Expected per AC-13: editedArchived true + '(changed)' suffix.


## Minor Issues (Nice to Fix)
Small improvements or polish items.

### Issue 1: Write-in duty persists across question navigation — enter commits a write-in on a question whose cursor sits on a real option
**Severity**: Minor
**ID**: BUG-004
**Location**: src/panel/panel.ts:1056 (focusTextField/duty reset only on blur :1086); syncBufferToQuestion does not re-derive textDuty

**Description**:
WRITEIN-001 (FR-12): 'the duty follows entry path and cursor position'. textDuty is per-focus-session and only reset on blur (panel.ts:1086), but question navigation (tab/shift+tab — config keys intercepted even in text focus) changes currentId and re-seeds the cursor to the ★ preselect WITHOUT re-deriving the duty. Verified live: accept Other on q1 (duty=writein) → shift+tab to q2 (cursorIndex resets to option 1/★) → type → enter → q2 is answered as a WRITE-IN ({value: text, custom:true}), bypassing option selection, even though the cursor is on a real option (where the duty should be elaboration → enter saves+blurs, never answers). The visible 'OTHER — this text is the answer' label mitigates surprise, but the commit semantics contradict the cursor-follow rule.

**Steps to Reproduce**:
1. Panel q1 (choice, recommendation a) + q2 (choice, recommendation b), editor in write-in duty via Other-row accept on q1. 2. handleInput('\x1b[Z') (shift+tab) → currentId=q2, cursorIndex=1 (★), textDuty still 'writein', buffer re-seeded ''. 3. textField.setText('x'); handleInput('\r'). 4. Observed: q2 status answered, answer {value:'x', custom:true} — a write-in commit while the cursor is on option b.

### Issue 2: Recorded write-in answers are invisible in the short view on revisit; ✎ marker inconsistent between question line and overview
**Severity**: Minor
**ID**: BUG-005
**Location**: src/panel/layout.ts:181-186 (hasTextAnswer misses answer.custom); src/panel/short-view.ts:259 (answerPreviewLine reads answer.text, never set for text/write-in answers)

**Description**:
Two related display gaps: (1) layout.ts hasTextAnswer (:181-186, feeds the short-view question-line ✎ marker) checks `q.type === 'text' || answer.text` but not `answer.custom` — a CHOICE write-in answer gets NO ✎ on the question line while the overview marker (overview.ts markerParts, `custom === true || type text`) shows ✎: inconsistent marker semantics for the same answer. (2) On revisit the cursor re-seeds to the ★ option preselect (not the recorded answer) and answerPreviewLine (short-view.ts:259) reads `q.answer?.text` — but text/write-in answers are committed to `answer.value` (custom:true), so the 'dimmed current-value preview' is dead code and never renders. Net effect: there is no way to see what a recorded write-in answer says anywhere in the panel (short view shows nothing, overview shows only the ✎ glyph, deep view shows options not answers) — review requires the transcript card or a model read.

**Steps to Reproduce**:
1. State: q1 choice with answer {value:'my write-in', custom:true} (committed via Other), q2 text with {value:'text answer'}. 2. panel.currentId='q1'; render(100). Observed: question line '(none) · Q1/q1 Pick' — no ✎, no preview, cursor on option A although the recorded answer is the write-in 'my write-in' (verified the answer text appears nowhere in the render). Overview row shows '★ ✎ Pick'.

### Issue 3: Model-visible submission delta line unbounded and multi-line for write-in answers (AC-2 '≤3-line delta' violated)
**Severity**: Minor
**ID**: BUG-006
**Location**: src/delivery.ts:170-180 (budget loop keeps one untruncated entry); src/snapshots.ts answerSummary does not flatten newlines

**Description**:
buildSubmission's budget loop (delivery.ts:170-180) shrinks the entry LIST from the end but always keeps ≥1 entry whole, so SUBMISSION_LIST_MAX_CHARS (240) never bounds a single long entry — pre-delta entries were short option labels, but write-in answers are arbitrary user text with no length cap. Verified: a 3000-char write-in produced a 3044-char first content line with no truncation/ellipsis (and the full 3002-char string in the card). Additionally, write-ins commit with raw newlines preserved (documented: 'multi-line values keep their newlines') and are embedded verbatim into the single 'Submitted {k}: …' line: a two-line write-in rendered a 3-line content block + reminder (4 lines total), violating FR-3/AC-2's '≤3-line delta + reminder' shape; the card's `to` field also carries raw newlines/tabs.

**Steps to Reproduce**:
1. Panel q1 choice + q2; accept Other on q1, type 'X'.repeat(3000) (or 'line one\nline two 🚀'), enter; answer q2. 2. Auto-submit fires. Observed content line lengths: 3044 chars (no '…'), and for the multi-line case content = 'Submitted 2: q1: ✎ line one\nline two 🚀 …; q2: A (state epoch 2)' — 3 content lines + reminder.

### Issue 4: Bridge submit internal errors are swallowed with no submit-result ack and leave state half-mutated
**Severity**: Minor
**ID**: BUG-007
**Location**: src/remote-bridge.ts:264 (bare catch); src/remote-submit.ts:130 (state mutated before delivery, no guard)

**Description**:
FR-32/D-R6: bridge submissions ride the panel pipeline and submit acks (ok or nack) flow back to the client. The pi-ask submit handler wraps handleSubmit in a bare `catch {}` (remote-bridge.ts:264) to protect the shared bus — but that also swallows UNEXPECTED internal errors after answers were already applied to state (recordRemoteSubmission step 1 mutates before any delivery). Demonstrated live: an exception thrown by a state-change listener during applyAnswer propagated out of recordRemoteSubmission, was swallowed, and the client received NO submit-result (would hang until timeout) while state kept q1 'answered' (not submitted, no delta delivered, no noteSubmissionDelivered). Robustness gap: an internal failure mid-pipeline produces neither delivery nor nack nor rollback.

**Steps to Reproduce**:
1. Factory-wired bridge with an open panel whose TUI lacks requestRender (any internal listener throw reproduces the class of failure). 2. Emit a valid pi-ask submit. Observed: answers applied to state (q1 answered), pi.sendMessage never called, no '@eko24ive/pi-ask:submit-result' emitted on the bus, no error surfaced.

### Issue 5: Enter on a text question's primary affordance is a silent no-op (pre-existing)
**Severity**: Minor
**ID**: BUG-008
**Location**: src/panel/actions.ts:217 (accept no-op for type 'text'); affordance at src/panel/short-view.ts (textAffordanceLine)

**Description**:
On `type:'text'` questions the short view renders a single cursor-target affordance '✎ answer…' (short-view.ts textAffordanceLine: 'the primary affordance … cursor index 0, the only focus target') and the footer advertises 'enter accept', but accept() short-circuits text questions as a consumed no-op (actions.ts:217, unchanged pre-delta). Pressing enter does nothing; the only documented entry is ctrl+t (duty-follows-question-type → writein). Discoverability gap: a user following the rendered affordance + footer hint gets no feedback. Not a regression of this delta, but it now also blocks the AC-2c 'text-answer enter' flow for anyone who tries enter first.

**Steps to Reproduce**:
1. Panel on a type:'text' question, cursorIndex 0 (on '✎ answer…'). 2. handleInput('\r') via the key router (or accept(panel)). Observed: returns true, focus stays 'options', editor never opens, nothing answered.

## Testing Summary
- Total bugs found: 8
- Critical: 0
- Major: 3
- Minor: 5

## Recommendations
- In maybeAutoSubmit, arm the gate-hold line (and withhold) whenever countUnansweredGate > 0 on a commit — including when the completeness check would return anyway — matching FR-3's 'commits show the ⚠ line while gate questions are unanswered'; keep the zero-pending silence.
- Add a single write-through helper (stage current buffer to its owner question's slot + DraftStore) and call it at the top of suspend(), discussInChat, and enterNoteMode so every editor exit honors R4.
- Either snapshot at the close pass (or diff archived-edit flags against pre-close state) so editedArchived can be true through the real pipeline, or drop the '(changed)' promise from AC-13/README.
- Re-derive textDuty from the new question's cursor position in syncBufferToQuestion (or reset to elaboration on question change) so enter after navigation matches the cursor-follow rule.
- Include answer.custom in hasTextAnswer and render the recorded value (first line) in the revisit preview for text/write-in answers; flatten newlines and enforce a per-entry cap in the submission list line so the model delta stays ≤3 short lines.
- In the bridge submit handler, emit a submit-result nack (or re-emit the flow) when an unexpected internal error escapes the pipeline, so remote clients never hang without an ack.

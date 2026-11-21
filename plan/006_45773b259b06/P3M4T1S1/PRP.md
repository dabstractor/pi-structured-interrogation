---
name: "P3.M4.T1.S1 — Shared rejection guard at applyAnswer + editor inline reason (Local input recovery)"
description: "MODIFY src/state.ts: export isBlankAnswerValue (trim-only emptiness test) and reject blank values inside InterrogationState.applyAnswer (throw, before ANY answer/status mutation — the shared final mutation, per spec :141 + architecture note 'blank rejection lives at applyAnswer'). MODIFY src/panel/actions.ts: writeInEnter's blank branch flips from 'save draft + blur' (old h2.32 rule) to 'stay in the editor' — keep focus/buffer/duty/cursor, flash the inline reason 'Answer cannot be blank', NO commitTextDraft/advance/blur/auto-submit (rewrite its stale JSDoc); reconcileDraftsForSubmit gains a belt-and-braces nonblank check on the PRIOR answer's value in the elaboration-attach branch. MODIFY src/fallback.ts: recordAnswers gains a rejected bucket (blank check before the terminal-status check; prior answer preserved; zero-side-effect rejected-only calls) + MODIFY src/tool.ts: render 'blank value not recorded: {ids}' status line. Per-ingress unit tests: panel write-in (rewrite 4 old-rule tests in actions.test.ts), side-chat apply (hand-built blank ApplyDecision through applyChatAnswer), answers[] record (fallback.test.ts + tool.test.ts), submit reconciliation (blank drafts never applied/attached). Nonblank values store UNTRIMMED (raw). No semantic validation, no model calls, no reconstruct.ts changes (P3.M4.T1.S2 owns replay + case-5 restart halves), no README/spec changes (P3.M5.T1.S2 owns docs). Consumed by P3.M4.T1.S2 and P3.M5.T1.S1."
---

## Goal

**Feature Goal**: A blank answer value (`""` or whitespace-only, tested via `value.trim()` — the ONLY trim use) can never be recorded as an answer, regardless of ingress. The guard lives at the ONE shared final mutation — `InterrogationState.applyAnswer` — so every current and future caller (panel option accept, panel write-in, ripple-confirm modal, side-chat apply, non-TUI `answers[]`, submit reconciliation, debug command) is structurally covered. At the editor ingress a rejected attempt STAYS in the editor (focus, buffer, duty, cursor all preserved) with an inline reason `Answer cannot be blank`; at non-editor ingress the rejection is a benign status-line error that preserves any prior answer. Nonblank values (including leading/trailing whitespace and multiline text) store UNTRIMMED, byte-exact. No semantic validation, no additional model calls.

**Deliverable**:
1. `src/state.ts` (modify) — exported `isBlankAnswerValue(value: string): boolean` predicate + blank rejection inside `applyAnswer` (throw before any mutation, mirroring the existing unknown-id throw).
2. `src/panel/actions.ts` (modify) — `writeInEnter` blank branch rewritten to stay-in-editor + inline flash (its stale "EMPTY buffer: save the draft + blur" JSDoc rewritten to the new rule); `reconcileDraftsForSubmit` elaboration-attach branch skips a blank prior answer value (belt-and-braces).
3. `src/fallback.ts` (modify) — `recordAnswers` returns a fourth bucket `rejected: string[]` (blank values skipped before apply; prior answers untouched; epoch/snapshot/markSubmitted untouched by rejects).
4. `src/tool.ts` (modify) — the `record` action renders `blank value not recorded: {ids}` alongside the existing `unknown ids:` / `not recordable` lines.
5. Tests — `src/state.test.ts` (guard units), `src/panel/actions.test.ts` (rewrite the 4 old-rule empty-buffer tests + new per-ingress rejections + reconciliation blanks + side-chat blank decision), `src/fallback.test.ts` (rejected bucket semantics), `src/tool.test.ts` (rejected status line).

**Success Definition**: `npm test`, `npm run typecheck`, `npm run lint` all green. `state.applyAnswer(id, {value: ""|" "|\n\t", ...})` throws and leaves prior answer/status/`changed`-emissions untouched; whitespace-padded nonblank values record raw. Blank enter in the write-in/text editor consumes the key, flashes `Answer cannot be blank`, and changes NOTHING else (no commit, no draft write-through at the rejected enter, no advance, no blur, no modal, no auto-submit). Blank `answers[]` entries land in `rejected`, apply nothing, burn no epoch. Blank drafts at submit neither become answers nor elaborations nor crash submit.

## User Persona (if applicable)

**Target User**: The pi user answering structured questions in the panel, and the model recording `answers[]` in non-TUI (fallback) mode.

**Use Case**: The user opens the ✎ Other editor (or a text question), clears it or types only whitespace, presses `enter` — expecting either a real commit or a clear explanation — and must not lose their editor state or accidentally record a blank "answer" that later ships to the model.

**User Journey**: open ✎ Other → buffer holds whitespace → `enter` → footer-adjacent flash "Answer cannot be blank" → editor still focused, buffer/duty/cursor intact → user types a real answer → `enter` commits raw text (byte-exact, untrimmed) and advances.

**Pain Points Addressed**: the old rule silently blurred to options on empty+enter (a whitespace-only buffer committed nothing but LOOKED like an escape hatch with no explanation); the non-TUI `answers[]` path recorded blank values verbatim ("recorded AS GIVEN"), shipping empty "answers" to the model with no feedback; after crash-recovery restore (P3.M3), a recovered whitespace draft could become a blank committed answer.

## Why

- Binding spec: `spec/state-and-persistence.md` §Local input recovery bullet :141 (the rejection rule, verbatim in research/findings.md) + acceptance case 5 (:149) — this item owns the LIVE halves (editor rejection kept focus + explained why; blank rejection through non-editor ingress); P3.M4.T1.S2 owns the replay/restart halves. All spec files READ-ONLY.
- Architecture authority: `plan/006_45773b259b06/architecture/input-recovery.md` P3.M4 boundary — "recovered blank drafts seed the editor but never become answers — blank rejection lives at `applyAnswer` (sibling item)."
- Supersession: the ui-spec (h2.32) is ALREADY updated to "Blank answer attempts stay in the editor" — this item makes the CODE match; the old rule survives only in `writeInEnter`'s blank branch + its JSDoc + 4 tests.
- Closes the recovery loop: P3.M2 (capture) + P3.M3 (restore) can resurrect a whitespace-only draft into an editor; without this guard, `enter` on it commits a blank answer (the exact hazard the recovery feature would have introduced).
- Downstream: P3.M4.T1.S2 (replay guards + case-5 restart halves) consumes the exported predicate + throw contract; P3.M5.T1.S1 runs scripted acceptance cases 1–5 over it.

## What

### Behavior

1. **Shared guard (state.ts)**: `applyAnswer` throws `blank answer value rejected (question {id}) — state-and-persistence.md :141` (message wording free, must contain "blank") when `isBlankAnswerValue(answer.value)`, checked AFTER the unknown-id check and BEFORE `q.answer`/status mutation — no `changed` emission, prior answer/status fully preserved. `isBlankAnswerValue(v)` is exactly `v.trim() === ""`; exported for pre-checks (fallback, S2's replay filter). Throw (not silent return) keeps forgotten ingresses loud — the codebase's established refuse idiom (unknown-id throw; guards.ts StaleError).
2. **Editor ingress (writeInEnter)**: the `text.trim().length === 0` branch (actions.ts:427-436) becomes: `panel.flash("Answer cannot be blank")` + `return true` (consumed). Keep focus ("text"), textDuty ("writein"), the buffer (byte-exact, whitespace included), cursorIndex, currentId. NO `commitTextDraft` at the rejected enter (the buffer is unchanged and still live; capture-on-edit holds the durable copy; the eventual blur/navigation write-through stages the slot), NO advance, NO blur, NO modal (blank never reaches the FR-18 gate), NO auto-submit, NO `consumeCommittedBuffer`. Rewrite the function's stale JSDoc ("EMPTY buffer: save the draft + blur back to options, NO commit") to the new rule with the supersession note. Applies identically to `type:"text"` questions (same function, same branch).
3. **Side-chat apply (applyChatAnswer)**: unchanged code — protected BY CONSTRUCTION (the writeIn seam seeds the buffer then calls `writeInEnter`, whose blank branch now rejects; the parser's "empty-text" rule at sidechat.ts:518 already refuses whitespace-only replies). A hand-built blank `ApplyDecision` in tests proves the chain: consumed, no answer, no advance, flash set, offer row retired by the existing consume tail.
4. **Non-TUI `answers[]` (fallback.ts recordAnswers)**: new `rejected: string[]` bucket. For each entry, after the unknown-id check and BEFORE the terminal-status check: `if (isBlankAnswerValue(answer.value)) { rejected.push(answer.id); continue; }`. No apply, prior answer preserved, and a rejected entry never counts toward `recorded` (epoch/snapshot/markSubmitted untouched — a rejected-only call stays zero-side-effect per the BUG-012 rule). Return type gains `rejected: string[]` (required field).
5. **Status-line error (tool.ts)**: in the `record` action, after the `not recordable` line: `if (rejected.length > 0) lines.push(\`blank value not recorded: ${rejected.join(", ")}\`)` — same shape as `unknown ids:`; the result stays a SUCCESS (benign — no isError); `no answers recorded` still renders when nothing was recorded.
6. **Submit reconciliation (reconcileDraftsForSubmit)**: the existing blank-draft skip (`text === undefined || text.trim() === "" → continue`) stays — it already guards both apply sites against blank DRAFTS. ADD one belt-and-braces clause to the elaboration-attach branch (actions.ts:757-764): skip when the PRIOR answer's value is blank (`q.answer !== undefined && isBlankAnswerValue(q.answer.value)`) so a legacy in-session blank (pre-guard singleton state surviving an in-place extension reload) can neither enter a submission nor trip the shared throw inside submit.
7. **OUT OF SCOPE (hard boundaries)**: `src/reconstruct.ts` — replay guards are P3.M4.T1.S2 (its existing `resolved === ""` check only catches fully-empty; S2 widens it with `isBlankAnswerValue`); README/spec/docs sync — P3.M5.T1.S2; elaboration `enter` (save+blur duty — a blank elaboration is legitimate, NOT an answer); batch note; retirement/capture seams (P3.M2 owns); any semantic validation beyond emptiness; any model call.

### Success Criteria

- [ ] `state.applyAnswer` throws on `""`, `"   "`, `"\n\t "` values; prior answer/status unchanged; no `changed` event on reject; `isBlankAnswerValue` exported and exact (`trim() === ""`).
- [ ] Nonblank values record UNTRIMMED everywhere (existing raw-commit tests stay green untouched — e.g. actions.test.ts `test_wi_enter_commits_custom_answer_and_advances`).
- [ ] Blank/whitespace enter in write-in duty (choice ✎ Other AND `type:"text"`): consumed `true`, `footerFlash.text === "Answer cannot be blank"`, focus stays `"text"`, `textDuty` stays `"writein"`, buffer byte-unchanged, `cursorIndex`/`currentId` unchanged, no answer recorded, status unchanged, no draft-slot write-through (`draftTextFor` stays `undefined`), no modal, no auto-submit.
- [ ] Blank enter on an answered question WITH ripple victims: still no modal (rewritten `test_wi_enter_empty_buffer_on_answered_with_victims_never_gates`).
- [ ] Side-chat ingress: hand-built `{seam:"writeIn", text:"  "}` decision through `applyChatAnswer` → no answer, no advance, flash set, consumed.
- [ ] `answers[]` ingress: blank value → `rejected` bucket, no apply, prior answer preserved; mixed batch (blank + valid) records only the valid one; rejected-only call burns no epoch, pushes no snapshot, marks nothing, reports `blank value not recorded: {ids}` + `no answers recorded`.
- [ ] Submit reconciliation: blank draft on an open text question applies nothing (zero-pending path, no throw); blank draft on an answered choice question attaches no elaboration and ships the choice answer alone; a legacy blank prior answer value is skipped (no throw inside submit).
- [ ] All pre-existing tests EXCEPT the 4 old-rule empty-buffer tests green untouched; `npm run typecheck` + `npm run lint` clean.

## All Needed Context

### Context Completeness Check

Validated: spec :141 + case :149 read verbatim; ui-spec h2.32's current text confirmed (already new-rule); architecture-note P3.M4 boundary read; EVERY `state.applyAnswer` caller audited (9 sites, table in research/findings.md) with blank-possibility determined per site; `writeInEnter` blank branch + JSDoc located (actions.ts:392-436); `recordAnswers` + tool.ts `record` rendering read (fallback.ts:202-256, tool.ts:393-414); option values proven nonblank at upsert (tool-schema.ts:441); side-chat "empty-text" parser rule confirmed (sidechat.ts:518); `panel.flash` mechanism + assertion precedent confirmed (panel.ts:2076-2086, actions.test.ts "nothing to submit" tests); the 4 old-rule tests located (:286, :1564, :1648, :1667); reconstruct.ts:438's partial guard confirmed as S2's widening target; parallel-item file overlap checked (NONE: P3.M3.T1.S1/S2 touch panel.ts/reconstruct.ts/index.ts/command.ts/input-restore.ts; this item touches state.ts/actions.ts/fallback.ts/tool.ts); validation commands verified in package.json. Full detail: `plan/006_45773b259b06/P3M4T1S1/research/findings.md`.

### Documentation & References

```yaml
- file: spec/state-and-persistence.md
  why: §Local input recovery :141 — the verbatim rejection rule (shared final mutation, trim-only
    emptiness test, untrimmed storage, reject-before-mutation, editor keeps focus/content +
    inline reason, no semantic validation) and acceptance case 5 :149 (live halves = this item)
  gotcha: READ-ONLY — never edit spec/; the replay half of :141 is P3.M4.T1.S2's, do not implement it here

- file: spec/ui-spec.md
  why: §Free-text field (h2.32) — already says "Blank answer attempts stay in the editor"; the
    write-in duty's commit contract ("enter COMMITS: applyAnswer({value: <text>, custom: true})")
  gotcha: READ-ONLY; the OLD rule ("save draft + blur") lives only in code/JSDoc/tests now

- file: plan/006_45773b259b06/architecture/input-recovery.md
  why: P3.M4 boundary line — "blank rejection lives at applyAnswer"; confirms the guard's placement
    INSIDE the state seam, not per-caller
  gotcha: READ-ONLY plan artifact

- file: src/state.ts
  why: applyAnswer :379-386 (the seam — throw idiom precedent at :382, mutation at :384-385,
    emitChanged tail); QuestionAnswer.value is a REQUIRED string (:44-47) so blanks arrive as
    ""/whitespace, never undefined
  pattern: mirror the unknown-id throw; export the predicate beside the type definitions
  gotcha: state.ts imports NOTHING but node:events (h2.13 contract) — the predicate is pure, no new
    imports; NO emitChanged on the reject path

- file: src/panel/actions.ts
  why: writeInEnter :422-436 (the branch + its JSDoc :392-418 documenting the OLD rule — rewrite
    both); reconcileDraftsForSubmit :740-766 (blank-draft skip at :746-747 stays; elaboration
    branch :757-764 gains the prior-value skip); acceptOptionIndex :277-330 (structurally safe —
    no change); applyChatAnswer :592-640 (chain-protected — no change)
  pattern: flash for the inline reason (see panel.ts); keep the branch position FIRST — before the
    byte-identical no-op, before the FR-18 victims gate, so blank NEVER reaches a modal
  gotcha: do NOT reorder the nonblank tail (no-op check → victims gate → commit → dependsOn →
    consume → advance → blur → maybeAutoSubmit); the rejected branch returns BEFORE all of them

- file: src/fallback.ts
  why: recordAnswers :202-256 — loop shape, TERMINAL_ANSWER_STATUSES gate :188-199, epoch rule
    "recorded.length > 0" :254-262, the "recorded AS GIVEN — no validation" doc line :190-192
    (update it to name the ONE exception: blank rejection)
  pattern: bucket-then-continue, exactly like `unknown`/`ignored`
  gotcha: blank check goes BEFORE the terminal-status check (value hygiene precedes status
    questions — a blank is rejected whatever the status); rejected ids NEVER enter `recorded`

- file: src/tool.ts
  why: the `record` action :393-414 — destructure at :398, line-rendering block :408-413
    (`not recordable (moot/withdrawn/closed): …`, `unknown ids: …`, `no answers recorded`)
  pattern: one new `lines.push` in the same shape; keep the result a success (benign)
  gotcha: recordAnswers is consumed ONLY here (verified) — the return-type change is additive

- file: src/panel/panel.ts
  why: flash(text) :2076-2086 — the established transient footer-adjacent message channel
    (h2.37); self-invalidating; visible while the editor holds focus
  pattern: `panel.flash("Answer cannot be blank")` — NO new notice mechanism
  gotcha: confirmMode suppresses flashes, but blank never opens a modal — unreachable here

- file: src/panel/sidechat.ts
  why: ApplyDecision type :141-143 ({seam:"writeIn"; text:string} | {seam:"acceptOptionIndex"});
    parser "empty-text" rule :518 (whitespace-only replies never become decisions)
  gotcha: do NOT touch the parser — the per-ingress test builds a blank decision by hand to prove
    the chain anyway (defense against future parser regressions)

- file: src/panel/actions.test.ts
  why: the 4 old-rule tests to REWRITE (:286-291 inside the text-question accept test,
    :1564, :1648, :1667) + the harness (makePanel/seed) + footerFlash assertion precedent
    (:1138 `panel.footerFlash?.text`)
  pattern: `test("test_snake_case_name", ...)` naming; assert state + panel fields directly
  gotcha: the rewritten tests must assert focus==="text", textDuty==="writein",
    draftTextFor===undefined (NO write-through at the rejected enter), cursorIndex unchanged

- file: src/fallback.test.ts + src/tool.test.ts
  why: recordAnswers describe :258+ (bucket assertions at :266/:307/:323/:336/:349 — mixed batches,
    zero-side-effect calls); tool.test.ts record tests :531-573 (line-by-line content assertions)
  pattern: extend the existing mixed-batch and zero-side-effect tests with rejected entries

- file: src/state.test.ts
  why: applyAnswer describe :163-186 — the seam's unit block (throw assertion precedent :179);
    add blank-rejection units beside them
```

### Current Codebase tree (relevant slice)

```bash
src/state.ts                  # applyAnswer seam (:379) — ADD predicate + guard
src/panel/actions.ts          # writeInEnter blank branch (:427), reconcileDraftsForSubmit (:740)
src/fallback.ts               # recordAnswers (:202) — ADD rejected bucket
src/tool.ts                   # record action render (:393) — ADD rejected line
src/state.test.ts             # applyAnswer describe (:163) — EXTEND
src/panel/actions.test.ts     # 4 old-rule tests (:286/:1564/:1648/:1667) — REWRITE + EXTEND
src/fallback.test.ts          # recordAnswers describe (:258) — EXTEND
src/tool.test.ts              # record tests (:531) — EXTEND
src/panel/sidechat.ts         # ApplyDecision + parser (READ-ONLY here)
src/reconstruct.ts            # replay guard — P3.M4.T1.S2's, DO NOT TOUCH
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/state.ts                  # MODIFY — export isBlankAnswerValue; applyAnswer throws on blank
src/panel/actions.ts          # MODIFY — writeInEnter reject branch + JSDoc; reconcile prior-value skip
src/fallback.ts               # MODIFY — recordAnswers rejected bucket (+ doc line update)
src/tool.ts                   # MODIFY — "blank value not recorded: {ids}" line
src/state.test.ts             # EXTEND — guard units (blank/whitespace throw, prior preserved, untrimmed store)
src/panel/actions.test.ts     # REWRITE 4 + ADD — editor ingress, side-chat ingress, reconciliation ingress
src/fallback.test.ts          # EXTEND — answers[] ingress bucket semantics
src/tool.test.ts              # EXTEND — rejected status line rendering
# NO new files; NO changes to reconstruct.ts / merge.ts / ripple-confirm.ts / debug-commands.ts /
# sidechat*.ts / panel.ts / input-*.ts / README / spec / scripts
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: trim() is the ONLY emptiness test — NEVER trim the stored value. A write-in
// "  alpha  " records as "  alpha  " byte-exact (spec :141; existing raw-commit tests pin it).
// CRITICAL: the guard must fire BEFORE q.answer/status assignment AND before emitChanged —
// a rejected applyAnswer leaves ZERO observable trace in state (tests spy "changed").
// CRITICAL: writeInEnter's reject branch must NOT call commitTextDraft (old rule did), NOT
// blurTextField, NOT advanceAfterAccept, NOT consumeCommittedBuffer, NOT maybeAutoSubmit —
// focus/buffer/duty/cursor all stay; the ONLY panel mutation is footerFlash via flash().
// CRITICAL: blank is checked BEFORE the FR-18 victims gate in writeInEnter — a blank never
// opens the keep/cancel modal (rewritten :1564 test pins this).
// CRITICAL: reconcileDraftsForSubmit's elaboration branch spreads {...q.answer, text} — a legacy
// blank prior value would trip the shared THROW inside submit (crash). The added prior-value skip
// is load-bearing, not cosmetic.
// GOTCHA: recordAnswers' rejected check runs BEFORE the terminal-status check — a moot question
// with a blank value reports BLANK (the actionable signal), not "not recordable".
// GOTCHA: state.ts's only import is node:events (h2.13) — the predicate is a pure function in
// the same file; do not import it from elsewhere.
// GOTCHA: reconstruct.ts:443 calls applyAnswer with a resolved historical value whose existing
// guard (:438) only catches ""—a whitespace-only LEGACY delta would now throw at replay. That is
// P3.M4.T1.S2's widening target (isBlankAnswerValue(resolved)); this item must NOT touch it, and
// S2 lands immediately after — note the handoff in code comments ONLY if useful, no code.
// GOTCHA: sidechat parser never mints blank decisions (:518) — the apply ingress is chain-safe;
// the per-ingress test hand-builds the decision to future-proof the chain, do not "fix" the parser.
// GOTCHA: eslint unused vars need leading underscore; vitest fake timers only where no async
// engine is involved (these are all synchronous paths — real timers fine).
// GOTCHA: option values are validated nonblank at upsert (tool-schema.ts:441) — acceptOptionIndex
// cannot propose a blank; do not add a redundant pre-check there (the state guard is the backstop).
```

## Implementation Blueprint

### Data models and structure

```ts
// src/state.ts — beside the QuestionAnswer interface (types region):
/**
 * P3.M4.T1.S1 (spec state-and-persistence.md :141): the shared blank-answer
 * predicate. Trim is the ONLY emptiness test — nonblank values are stored
 * UNTRIMMED (raw user text, whitespace and all). No semantic validation.
 */
export function isBlankAnswerValue(value: string): boolean {
  return value.trim() === "";
}

// src/state.ts — applyAnswer, after the unknown-id throw, before ANY mutation:
if (isBlankAnswerValue(answer.value)) {
  throw new Error(
    `blank answer value rejected (question ${id}) — state-and-persistence.md :141`,
  );
}
// (throw mirrors the unknown-id refusal idiom; prior answer/status untouched,
//  no emitChanged — rejection is state-invisible)

// src/panel/actions.ts — module const + the rewritten branch:
const BLANK_ANSWER_FLASH = "Answer cannot be blank"; // spec :141 example text, pinned

const text = panel.textField.getText();
if (isBlankAnswerValue(text)) {
  // P3.M4.T1.S1 (spec :141 — supersedes h2.32's old empty-buffer rule): a
  // blank answer attempt STAYS IN THE EDITOR. Keep focus, buffer, duty and
  // cursor; flash the inline reason; NO draft write-through at the rejected
  // enter (capture-on-edit holds the durable copy; the eventual blur or
  // question-navigation write-through stages the slot), NO commit, NO
  // advance, NO blur, NO FR-18 modal (blank never reaches the victims gate
  // below), NO auto-submit.
  panel.flash(BLANK_ANSWER_FLASH);
  return true; // consumed — the enter key did its (rejecting) job
}

// src/fallback.ts — inside the recordAnswers loop, after the unknown-id check,
// BEFORE the TERMINAL_ANSWER_STATUSES check:
if (isBlankAnswerValue(answer.value)) {
  rejected.push(answer.id); // benign status-line error; prior answer preserved
  continue;
}
// return type: { recorded: string[]; unknown: string[]; ignored: string[]; rejected: string[] }

// src/tool.ts — in the record action's line block, after "not recordable":
if (rejected.length > 0) lines.push(`blank value not recorded: ${rejected.join(", ")}`);

// src/panel/actions.ts — reconcileDraftsForSubmit elaboration-attach branch guard:
if (
  q.status === "answered" &&
  q.answer !== undefined &&
  !isBlankAnswerValue(q.answer.value) && // P3.M4.T1.S1: a legacy blank prior value never enters a submission (nor trips the shared throw)
  q.answer.custom !== true
) { ... }
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/state.ts — the shared guard
  - ADD isBlankAnswerValue (pure, exported, exactly value.trim() === "")
  - ADD the blank throw inside applyAnswer (AFTER the unknown-id throw, BEFORE
    q.answer assignment + status flip + emitChanged); extend applyAnswer's JSDoc
    ("Raw primitive" note gains the blank-refusal line, citing spec :141 and
    noting merge-rules/P3.M4.T1.S2 consumers pre-check via the predicate)
  - NAMING: isBlankAnswerValue / message contains "blank answer value rejected"
  - NO new imports (h2.13: node:events only)

Task 2: EXTEND src/state.test.ts — guard units (describe applyAnswer, :163+)
  - UNITS: "" throws; "   " throws; "\n\t " throws (multiline whitespace);
    message matches /blank/; prior answer + status PRESERVED after the throw
    (seed answered, attempt blank overwrite, re-read); NO "changed" emission
    on reject (on listener spy, count unchanged); "  alpha  " records raw
    (value === "  alpha  " byte-exact); predicate units ("" / " " / "\t\n"
    true; "a" / " a " / "\n" false — note "\n" alone is blank, "a\n" is not)
  - NAMING: test("test_apply_answer_blank_*", ...)

Task 3: MODIFY src/panel/actions.ts — editor ingress + reconciliation skip
  - REWRITE writeInEnter's blank branch per the data model (flash + return
    true; delete the commitTextDraft call + old comment)
  - REWRITE writeInEnter's JSDoc §"EMPTY buffer" paragraph to the new rule
    (cite spec :141 supersession; note focus/buffer/duty/cursor preservation
    and that drafts still reach the slot via the eventual blur/navigation
    write-through — R4 holds)
  - ADD the reconcileDraftsForSubmit prior-value skip (data model above)
  - DO NOT touch: acceptOptionIndex, applyChatAnswer, the nonblank commit
    tail's ordering, stageSupersededWriteIn, ripple-confirm paths

Task 4: REWRITE the 4 old-rule tests + ADD ingress tests in src/panel/actions.test.ts
  - REWRITE :286-291 (text-question accept test tail): enter on the open empty
    editor → consumed, focus stays "text", textDuty stays "writein", no answer
  - REWRITE :1564 (answered + victims): enter on blank → no modal, answer
    untouched, flash "Answer cannot be blank", focus stays "text" (the
    never-gates property is preserved — blank still never opens the modal)
  - REWRITE :1648 → test_wi_enter_blank_rejected_stays_in_editor: consumed,
    footerFlash.text === "Answer cannot be blank", focus "text", textDuty
    "writein", cursorIndex unchanged (2), currentId unchanged, no answer,
    status "open", draftTextFor("q1") === undefined (NO write-through), and a
    FOLLOW-UP enter after typing real text still commits (the editor survived)
  - REWRITE :1667 → blank enter on the ANSWERED question with recorded "a":
    answer + status untouched, focus STAYS "text" (no re-seed-to-answer-row —
    there is no blur), cursorIndex unchanged
  - ADD whitespace-only buffer (" \n ") same rejection; "  alpha  " commits
    raw (already pinned by existing tests — extend only if not covered)
  - ADD side-chat ingress: open a record on q1 (open status), hand-build
    {seam:"writeIn", text:"  "}, call applyChatAnswer → consumed true, no
    answer on q1, currentId unchanged, panel.footerFlash?.text ===
    "Answer cannot be blank" (writeInEnter ran through the shared chain)
  - ADD reconciliation ingress A: open text question + blank draft slot
    (commitTextDraft(q,"  ")) → submit → NO answer applied, zero-pending
    "nothing to submit" flash path, no throw
  - ADD reconciliation ingress B: answered choice (option answer) + blank
    draft → submit → ships the choice answer alone, answer.text never set to
    the blank draft
  - ADD reconciliation ingress C: answered choice with a LEGACY blank answer
    value (hand-seed state: applyAnswer via raw state mutation or construct
    then force) + nonblank draft → submit → skipped (no throw, nothing
    attached) — pins the belt-and-braces clause

Task 5: MODIFY src/fallback.ts — the answers[] ingress
  - ADD the rejected bucket + check per the data model (before the terminal
    check); add `rejected: string[]` to the return (init at top, return at
    bottom); update the "recorded AS GIVEN" doc bullet to name the single
    exception (blank rejection, spec :141)
  - PRESERVE: epoch/snapshot/markSubmitted gating on recorded.length > 0;
    the GUARD ORDERING CONTRACT note; assertFresh stays the caller's job

Task 6: EXTEND src/fallback.test.ts + src/tool.test.ts
  - fallback: blank value → rejected bucket, not recorded; prior answer
    preserved (seed answered, send blank overwrite, answer byte-unchanged);
    mixed batch [valid, blank, unknown] → recorded=[valid], rejected=[q2],
    unknown=[zz], ONE epoch bump (valid only); rejected-only call → zero
    epoch/snapshot/markSubmitted side effects (BUG-012 parity); blank BEFORE
    terminal (moot q + blank value → rejected, NOT ignored)
  - tool: record with one blank entry → line `blank value not recorded: q2`
    (exact), statusLine still first, result NOT isError; all-blank call →
    rejected line + `no answers recorded`

Task 7: FULL GATE
  - npm test && npm run typecheck && npm run lint — all green
  - GREP audit: `rg "applyAnswer\(" src --type ts | grep -v test` — every
    production caller either pre-checks nonblank or is structurally safe
    (acceptOptionIndex/ripple via validated option values; writeInEnter/
    recordAnswers/reconcile via explicit checks; debug-commands throws
    visibly = acceptable; reconstruct = S2's, handoff noted)
```

### Implementation Patterns & Key Details

```ts
// PATTERN: the throw contract (state.ts) — refusal mirrors the unknown-id idiom;
// callers that can carry blanks PRE-CHECK with the exported predicate (never
// catch the throw on hot paths):
state.applyAnswer(q.id, answer); // safe ONLY when !isBlankAnswerValue(answer.value)

// PATTERN: bucket-then-continue in recordAnswers (existing unknown/ignored shape):
if (isBlankAnswerValue(answer.value)) { rejected.push(answer.id); continue; }

// PATTERN: stay-in-editor rejection (writeInEnter) — flash is the ONLY effect:
panel.flash(BLANK_ANSWER_FLASH); // self-invalidating ~2.5s; visible with editor focus
return true;                      // consumed; nothing else mutates

// GOTCHA: do not "helpfully" write the draft at the rejected enter — the buffer
// is still live in the editor; R4 is preserved by the existing write-through on
// blur/navigation (syncBufferToQuestion) and by capture-on-edit (P3.M2) for crashes.
```

### Integration Points

```yaml
STATE SEAM (the core integration):
  - state.ts applyAnswer: blank → throw, prior state preserved, no events
  - export: isBlankAnswerValue (consumed by fallback.ts now; reconstruct.ts in
    P3.M4.T1.S2; keep signature (value: string) => boolean exactly)

PANEL:
  - actions.ts writeInEnter: reject branch replaces the draft-save branch
  - actions.ts reconcileDraftsForSubmit: prior-value skip in the elaboration branch
  - no panel.ts changes (flash already exists); no keys.ts changes (enter routing untouched)

TOOL:
  - tool.ts record action: rejected line; recordAnswers return-type extension

NO DATABASE / CONFIG / ROUTES: pure in-process logic; no settings surface, no
  new strings beyond the flash const and the rejected-line format
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run lint            # eslint src scripts *.ts — zero errors
npm run typecheck       # tsc --noEmit — zero errors (watch the recordAnswers return type)
# Run after each file change; fix before proceeding.
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/state.test.ts -t applyAnswer          # guard units
npx vitest run src/panel/actions.test.ts                  # rewritten + new ingress tests
npx vitest run src/fallback.test.ts                       # rejected bucket
npx vitest run src/tool.test.ts                           # rejected status line
# Expected: all green. Then the full component neighborhood:
npx vitest run src/panel src/state.test.ts src/fallback.test.ts src/tool.test.ts src/merge.test.ts src/reconstruct.test.ts
# reconstruct.test.ts MUST stay green untouched (replay = S2's; existing fixtures
# carry no whitespace-only replay values — verify, and if one exists, coordinate
# with S2's scope rather than widening reconstruct.ts here).
```

### Level 3: Integration Testing (System Validation)

```bash
npm test                # the entire suite — the real gate (100%-ish coverage harness)
# Watch specifically for collateral: editor-preservation, keymap-ac, ac-sidechat,
# ac-panel, two-stage, ripple-confirm, sidechat-cache-isolation, input-* suites
# must be green UNTOUCHED (this item changes no capture/retirement/restore behavior).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Static seam audit — every production applyAnswer caller is blank-safe or S2's:
rg "\.applyAnswer\(" src --type ts | grep -v test
# Expected sites: state.ts(def) + merge.ts + ripple-confirm.ts×2 + actions.ts×4 +
# fallback.ts + debug-commands.ts + reconstruct.ts(=S2, untouched)
# Manual logic walk (no TUI harness needed — all paths are unit-covered):
# 1) ✎ Other → type "  " → enter → flash + still editing → type "x" → enter → commits "  x" raw
# 2) text question → clear buffer → enter → flash + still editing (prior answer intact)
# 3) non-TUI: record [{id:q1, value:"  "}] → "blank value not recorded: q1", epoch unchanged
```

## Final Validation Checklist

### Technical Validation

- [ ] All 4 validation levels completed; `npm test`, `npm run typecheck`, `npm run lint` green
- [ ] The 4 old-rule tests rewritten (not deleted) — old assertions replaced, coverage preserved
- [ ] No changes outside state.ts / actions.ts / fallback.ts / tool.ts + their 4 test files

### Feature Validation

- [ ] All Success Criteria boxes checked (shared throw, stay-in-editor rejection, rejected bucket, status line, reconciliation skips, side-chat chain)
- [ ] Nonblank values store untrimmed everywhere (raw-commit tests untouched-green)
- [ ] reconstruct.ts, merge.ts, ripple-confirm.ts, debug-commands.ts, sidechat*.ts, panel.ts byte-untouched
- [ ] Guard fires BEFORE any answer/status change, advance, or submission on every ingress

### Code Quality Validation

- [ ] Stale JSDoc rewritten (writeInEnter's EMPTY-buffer paragraph; fallback's "recorded AS GIVEN" bullet; applyAnswer's raw-primitive note)
- [ ] Follows existing patterns (throw idiom, bucket-then-continue, flash channel, test naming)
- [ ] No new mechanisms: no new notice type, no parser change, no config surface
- [ ] Supersession cited in comments (spec :141 over old h2.32 rule)

### Documentation & Deployment

- [ ] No README/spec/docs changes (owned by P3.M5.T1.S2); no new env vars; no config

## Anti-Patterns to Avoid

- ❌ Don't trim, normalize, or otherwise "fix" nonblank values — raw bytes only; trim is a TEST, never a transform
- ❌ Don't add per-caller guards where the state seam already covers (acceptOptionIndex) — that's the point of the shared mutation
- ❌ Don't silently no-op the state rejection — throw (forgotten ingresses must be loud, not invisible)
- ❌ Don't write the draft/blur/consume anything at the rejected editor enter — staying in the editor means NOTHING else mutates
- ❌ Don't touch reconstruct.ts (P3.M4.T1.S2) or the sidechat parser (:518 already refuses blanks)
- ❌ Don't add semantic validation (length caps, option matching) or model calls — emptiness only, per spec :141
- ❌ Don't reorder writeInEnter's nonblank tail (no-op → victims gate → commit → dependsOn → consume → advance → blur → auto-submit)

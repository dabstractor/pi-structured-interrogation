# PRP — P1.M2.T4.S1: Delete advanceArmed machinery; rewrite two-stage.test.ts for commit-at-enter

---
name: "P1.M2.T4.S1 — Delete advanceArmed machinery per removal-safety map; rewrite two-stage.test.ts for commit-at-enter (FR-D2, WRITEIN-001)"
description: "Remove the two-stage arming machinery wholesale from panel.ts and ripple-confirm.ts per the removal-safety map in plan/002_949db554a811/architecture/panel-ui-seams.md (§'Removal-safety map for advanceArmed'): the advanceArmed field, handleInput stage (a) disarm + stage (b) armed stage-2 advance (KEEP the `const enter` definition and stage (c) — they are the commit-at-enter seam), the `{arm}` param collapsing out of commitTextDraft/stageText/saveTextDraft/exitTextField/beginTextConfirm's stashed payload, the now-dead advanceToNextUnanswered, and JSDoc rewrites. Rewrite src/panel/two-stage.test.ts for commit-at-enter semantics (DROP the describes at :175 arming and :266 disarm; KEEP :294 newline, :363 note, :442 refocus, :491 history — with arming assertions stripped and enter flows re-seeded). Scrub every advanceArmed test assertion in panel.test.ts / actions.test.ts / ripple-confirm.test.ts. Full panel suite + typecheck must be green. Mode A JSDoc: enter commits per duty, no arming stages (cite WRITEIN-001 removal)."
---

## Goal

**Feature Goal**: FR-D2 / h2.32 (WRITEIN-001): "The two-stage arming machinery (`advanceArmed`, stage-2 advance, EXPLAIN-003's explain→enter→enter flow) is REMOVED: commits apply the answer at `enter`, so the armed second `enter` has no remaining purpose." Enter now commits wherever text completes an answer (write-in duty, `type:"text"` questions — P1.M2.T2.S1/T3.S1 already landed those paths); saves + blurs otherwise (elaboration, note). `shift+enter`/`ctrl+j` newlines unchanged.

**Deliverable**: Modified `src/panel/panel.ts` (delete field + stages (a)/(b) + `{arm}` plumbing + dead `advanceToNextUnanswered` + JSDoc rewrites), `src/panel/ripple-confirm.ts` (drop the `arm` field/payload), rewritten `src/panel/two-stage.test.ts`, scrubbed `advanceArmed` assertions in `panel.test.ts` / `actions.test.ts` / `ripple-confirm.test.ts`. No new files.

**Success Definition**: `npm run typecheck` clean and `npm test` green; `grep -rn advanceArmed src/` returns NOTHING; the kept two-stage.test.ts describes (newline, note, refocus, history) pass with commit-at-enter expectations; no behavior change to write-in commits, elaboration save+blur, note mode, FR-18 modal, or newline insertion.

## User Persona

**Target User**: The TUI answerer; this item is invisible polish — one `enter` now does the whole job with no second-press ritual.

**Use Case**: User types a text answer (or write-in) and presses enter once → question answered + advance; user types an elaboration and presses enter → draft saved + blur. No armed second enter ever fires or misfires.

**Pain Points Addressed**: EXPLAIN-003's original bug class ("explained it but nothing was submittable") and the fragile one-shot flag whose ordering was load-bearing; superseded by duty-based commit semantics.

## Why

- PRD h2.32: the removal sentence quoted above; h2.51 M8: "REMOVE `advanceArmed` two-stage machinery … existing two-stage tests (`two-stage.test.ts`) rewrite for commit-at-enter semantics."
- Upstream contracts (landed / landing in parallel, treat as done): P1.M2.T2.S1's `writeInEnter(panel)` + `textDuty` (write-in enter: empty → save draft + blur no commit; non-empty → `applyAnswer({value, custom:true})` + advance) and P1.M2.T3.S1's duty-follows-cursor (`type:"text"` or cursor-on-Other ⇒ write-in duty; ctrl+t elsewhere ⇒ elaboration whose enter saves + blurs, never advances).
- Downstream: P2.M1.T1.S1 (`maybeAutoSubmit` after every commit path) consumes the single-enter commit semantics; leaving arming residue would create a dead second-enter path that must not survive into P2.

## What

### Behavior contract (exact)

1. **Delete** `advanceArmed` field (panel.ts:428 in the current tree — the work item's `:412` is pre-T2/T3 drift), stage (a) one-shot disarm block (panel.ts:759–762), stage (b) armed stage-2 block (panel.ts:764–773 including its `advanceToNextUnanswered()` call and "runs BEFORE the keys seam" comment), and the now-dead private `advanceToNextUnanswered` (panel.ts ~:891).
2. **KEEP** the `const enter = key === "enter" && data !== "\n";` definition (~:757) and stage (c) (the text/note enter fork calling `exitNoteMode`/`writeInEnter`/`saveTextDraft`) — that IS the commit-at-enter seam. KEEP the confirm-mode check, gate-warning dismissal, ctrl+c check, and `"\n"` newline exclusion exactly as they are.
3. **Collapse the `{arm}` plumbing**: `saveTextDraft()` loses its `q?.type === "text"` arming conditional (body becomes the stageText call); `exitTextField()` calls `stageText(text)` (no `false`); `stageText(text)` drops the `arm` param and passes no opts to `beginTextConfirm`; `commitTextDraft(questionId, text)` drops `opts?: { arm?: boolean }` entirely and the `if (opts?.arm !== false) this.advanceArmed = true;` line. In ripple-confirm.ts: delete `TextConfirmMode.arm`, `beginTextConfirm`'s opts param + stashed `arm` payload, and `applyTextConfirm`'s `{ arm: cm.arm !== false }` argument. All EXPLAIN-003 cursor-reseed / FR-18 gate logic inside these functions stays byte-identical.
4. **JSDoc rewrites ([Mode A])**: handleInput ladder description (~:668–704) without stages (a)/(b) — new ordering: resolved guard → ctrl+c → confirm modal → gate dismissal → enter-per-duty fork → keys seam → editor forwarding, and the enter narrative = "enter commits per duty (WRITEIN-001), no arming stages"; saveTextDraft/exitTextField/stageText/commitTextDraft JSDoc ("arm the one-shot advance flag" wording); openExternalEditor ~:1153 ("does NOT touch advanceArmed"); draftSlots class JSDoc ~:388 ("armed by stage-1 enter"); ripple-confirm.ts header ~:38–54 and the arm field JSDoc.
5. **Rewrite two-stage.test.ts** per the classification below; rename the file's header comment to the commit-at-enter contract (file NAME stays — h2.51 references it).
6. **Scrub cross-file assertions**: every `panel.advanceArmed` expectation (panel.test.ts:1337/:1504, actions.test.ts:847, ripple-confirm.test.ts:222/:265/:412/:427/:443/:474). Delete the assertion; keep the surrounding behavioral assertions (they still pass — backing out never armed anything observable). ripple-confirm.test.ts:443 asserts `toBe(true)` — its test (arm carry-through through the modal) is obsolete: delete or repurpose to assert the deferred save still commits on confirm-enter with no advance side effect.

### two-stage.test.ts keep/drop classification

- **DROP** describe "stage 1 save, stage 2 advance (h2.31)" (:175) — all four tests assert arming / stage-2 / third-enter fallthrough. Replace with commit-at-enter equivalents:
  - `test_text_question_enter_commits_custom_answer_and_advances`: seedOpenText(["q1","q2"]), ctrl+t (duty = writein on type:"text" per T3), type, "\r" → `status === "answered"`, `answer.value === text`, `answer.custom === true`, focus "options", currentId "q2" (advance), `drafts.setDraft` written (write-through) or per writeInEnter's actual seam — follow the LANDED writeInEnter behavior.
  - `test_elaboration_enter_on_choice_saves_blurs_no_commit_no_advance`: seedOpen, ctrl+t on an option cursor, type, "\r" → draft saved, question still open/undefined answer, focus "options", currentId unchanged, cursorIndex re-seeded to ★ preselect (0).
  - `test_empty_writein_enter_saves_draft_blurs_no_commit` (escape hatch): empty buffer + enter in writein duty → no answer applied, focus "options".
- **DROP** describe "one-shot disarm" (:266) — no flag exists. Property "text/note enter intercepted before the keys seam" is already covered by the note test `test_note_enter_never_reaches_router_accept` (KEEP); optionally add the text-focus analogue: `\r` in text focus → `keys` spy not called with "\r".
- **KEEP** describe "newline safety (R4)" (:294): strip `advanceArmed` assertions; `test_kitty_plain_enter_is_stage1_not_newline` → rewrite: on a TEXT question "\x1b[13u" COMMITS (status answered, focus options) — not a newline; `test_ctrl_j_while_armed_disarms…` → replace with `test_ctrl_j_inserts_newline_never_commits` (editor still focused, text contains "\n", no draft write, no answer).
- **KEEP** describe "note mode (R3)" (:363) — strip the one `advanceArmed` assertion (:391 area); everything else unchanged.
- **KEEP** describe "refocus seeding + draft survival" (:442): in `test_draft_slot_survives_navigation_and_reseeds_on_return`, the second `handleInput("\r")` (was stage-2 advance) must become a navigation key (`"\x1b[Z"` shift+tab = nextQuestion, as its sibling test already uses) or an option accept; first `\r` on a choice elaboration still saves + blurs. Other two tests unchanged.
- **KEEP** describe "history isolation (h2.31)" (:491): rework the flow — focus on a type:"text" question, type, enter (now COMMITS), then note save; still assert `editor.addToHistory` never called and `panel.textField.editor.onSubmit` undefined (panel-level interception remains the single trigger).

### Success Criteria

- [ ] `grep -rn "advanceArmed" src/` → zero matches (field, stages, tests, JSDoc)
- [ ] `grep -n "arm" src/panel/ripple-confirm.ts | grep -v disarm` → no `{arm}`/`arm?:` field or payload (prose words like "warm" excluded)
- [ ] Single enter on writein/text commits + advances; elaboration/note enter saves + blurs — no second-enter behavior anywhere
- [ ] shift+enter / ctrl+j / alt+enter still insert newlines and never save/commit; kitty "\x1b[13u" still parses as enter
- [ ] FR-18 text confirm modal still defers + applies elaboration saves on answered questions (ripple-confirm.test.ts green after scrub)
- [ ] `npm run typecheck` + `npm test` green (full panel suite)

## All Needed Context

### Context Completeness Check

Every touchpoint is enumerated with CURRENT-tree line anchors (the work item's numbers pre-date T2/T3 landing), the exact code shapes to delete are quoted in the research notes, and the test classification is per-describe. An implementer needs nothing beyond this PRP + the repo.

### Documentation & References

```yaml
- file: plan/002_949db554a811/architecture/panel-ui-seams.md
  why: §"Removal-safety map for advanceArmed (two-stage deletion)" (:430+) — the authoritative 10-item delete list, incl. the safety note that stage (c) and the "\n" exclusion live in the same handleInput region and MUST survive
  pattern: follow items 1–10 in order; item 10 confirms arming is fully encapsulated (no runtime reads outside panel.ts + tests)
  gotcha: its anchors (:412, :736–755, :866, :877–886, :683–710, :1131, :390) are pre-T2/T3 — the current-tree anchors are in research/removal-safety-notes.md; "landed code wins"

- file: plan/002_949db554a811/P1M2T4S1/research/removal-safety-notes.md
  why: verified current-tree anchors for EVERY touchpoint (panel.ts 428/757/759–762/764–773/805–817/828–830/840–854/867–889/~891/1153/~388; ripple-confirm.ts 84–95/200/226–230), the full advanceArmed test-assertion list to scrub, and the per-describe two-stage.test.ts classification
  pattern: use it as the work checklist

- file: src/panel/panel.ts
  why: handleInput ladder (:668–797) — ctrl+c check, confirm-mode modal, gate dismissal, `const enter` (:757), stages (a)/(b)/(c); saveTextDraft/exitTextField/stageText/commitTextDraft (:805–889); advanceToNextUnanswered (~:891, dead after (b)); textDuty (:419) + writeInEnter fork (:781)
  pattern: delete (a)/(b) as one contiguous block between the `enter` definition and the stage-(c) comment; keep everything else byte-identical
  gotcha: `commitTextDraft` is PUBLIC and called by ripple-confirm's applyTextConfirm and applyWriteInConfirm paths — after dropping opts, fix ALL call sites (grep `commitTextDraft(`)

- file: src/panel/ripple-confirm.ts
  why: TextConfirmMode.arm field (:84–95 JSDoc block), beginTextConfirm opts (:200–214), applyTextConfirm tail (:226–230); header JSDoc (:38–54) already anticipates this removal ("the two-stage machinery is being removed, P1.M2.T4.S1")
  pattern: drop the field + payload; applyTextConfirm still calls commitTextDraft(cm.questionId, cm.text)
  gotcha: the `writein` confirm kind (P1.M2.T2.S2) has NO arm — do not touch applyWriteInConfirm/cancelWriteInConfirm

- file: src/panel/two-stage.test.ts (513 lines)
  why: the file being rewritten; fixtures to REUSE verbatim: stubTheme, choiceQ/OPTS_AB, seedOpen/seedOpenText, draftsSpy, fakeEditor (raw byte sequences), makePanel(keysSpy), focusText (ctrl+t "\u0014")
  pattern: keep the harness; the describes at :175/:266 are dropped, :294/:363/:442/:491 kept with edits (classification above)
  gotcha: seedOpenText + ctrl+t now lands in WRITE-IN duty (T3's duty-follows-cursor) — text-question enter COMMITS, it no longer "stage-1 saves"

- file: src/panel/actions.ts
  why: writeInEnter + nextUnanswered exports — the landed commit-at-enter primitives this item leans on; advanceToNextUnanswered in panel.ts duplicates nextUnanswered privately and becomes dead
  pattern: read-only; do not modify actions.ts
  gotcha: if writeInEnter's draft-write-through seam differs from drafts.setDraft expectations, follow the landed code

- files: src/panel/panel.test.ts (:1337, :1504), src/panel/actions.test.ts (:847), src/panel/ripple-confirm.test.ts (:222, :265, :412, :427, :443, :474)
  why: advanceArmed assertions that break at typecheck/runtime once the field is deleted — scrub each (delete the assertion line; keep behavioral neighbors)
  gotcha: ripple-confirm.test.ts:443 asserts armed TRUE through the modal — that whole test's premise dies; repurpose or delete it

- file: plan/002_949db554a811/P1M2T3S1/PRP.md
  why: the parallel-item contract for elaboration duty — confirms elaboration enter already never arms (its tests assert no advance), so this deletion cannot regress it
  gotcha: if T3 has NOT fully landed when you start, its changes touch the same handleInput region — re-read panel.ts immediately before editing

- doc: PRD h2.32 + h2.51 (M8) + h2.58 (WRITEIN-001 pin) — quoted in full in this PRP's PRD context; the removal sentence is the spec
```

### Current Codebase tree (relevant slice)

```bash
src/panel/
  panel.ts            # field + stages + arm plumbing + dead advance — EDIT
  ripple-confirm.ts   # TextConfirmMode.arm + begin/applyTextConfirm — EDIT
  two-stage.test.ts   # full rewrite per classification — EDIT
  panel.test.ts       # 2 advanceArmed assertions — EDIT (scrub)
  actions.test.ts     # 1 advanceArmed assertion — EDIT (scrub)
  ripple-confirm.test.ts # 6 advanceArmed assertions — EDIT (scrub)
  actions.ts, keys.ts # read-only (no runtime advanceArmed reads — verified)
```

### Desired Codebase tree

```bash
# same files, same names; zero new files
src/panel/panel.ts            # arming gone; enter fork = note | writein | elaboration
src/panel/ripple-confirm.ts   # text-confirm modal without arm
src/panel/two-stage.test.ts   # commit-at-enter contract tests (name kept)
```

### Known Gotchas of our codebase

```ts
// CRITICAL: line anchors here are from the CURRENT tree (post T2 partial
// landing); the work item + safety map cite pre-T2 numbers. If T3 lands
// while you work, re-grep before editing — T3 touches focusTextField/keys.

// CRITICAL: do NOT delete the `const enter = key === "enter" && data !== "\n"`
// line or stage (c) while removing (a)/(b) — they sit in the same handleInput
// region (explicit warning in the safety map). Also keep the "\n" raw-byte
// exclusion: legacy parseKey resolves ctrl+j "\n" to plain "enter".

// CRITICAL: commitTextDraft is public with external callers
// (applyTextConfirm, applyWriteInConfirm) — after dropping opts, fix every
// call site; typecheck will catch stragglers but read them first.

// CRITICAL: advanceArmed is PUBLIC and asserted in 4 test files — deleting
// the field breaks typecheck of those tests; the scrub is part of THIS task,
// not follow-up.

// Deleting advanceToNextUnanswered: ONLY safe because stage (b) was its sole
// caller. Verify with lsp_references / grep before deleting; do NOT delete
// actions.ts's nextUnanswered/advanceAfterAccept (write-in commits use them).

// test nuance: on seedOpenText (type:"text"), ctrl+t now enters WRITE-IN duty
// (T3), so enter COMMITS with answer.custom true — old tests' "stage 1 saves,
// stays open" expectations are wrong under the new semantics, not just their
// arming assertions.

// Label/harness reuse: never re-implement fakeEditor/draftsSpy — they encode
// terminal realities (kitty/xterm/alt sequences) the whole file exists to cover.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 0: RE-READ landed state
  - grep -n "advanceArmed" src/panel/panel.ts; read handleInput (:668–797) and the save/stage/commit block (:805–895) in the CURRENT file (T2/T3 may have shifted anchors)
  - grep -rn "advanceArmed" src/ → collect the full assertion list

Task 1: MODIFY src/panel/panel.ts — machinery deletion
  - DELETE field advanceArmed (:428); stage (a) block (:759–762); stage (b) block (:764–773); advanceToNextUnanswered (~:891, verify sole-caller first)
  - COLLAPSE arm plumbing: saveTextDraft (drop type==="text" conditional), exitTextField, stageText (drop param + opts), commitTextDraft (drop opts + arming line)
  - REWRITE [Mode A] JSDoc: handleInput ladder, saveTextDraft, exitTextField, stageText, commitTextDraft, openExternalEditor, draftSlots class doc — enter commits per duty, no arming stages, cite WRITEIN-001

Task 2: MODIFY src/panel/ripple-confirm.ts
  - DELETE TextConfirmMode.arm (+ JSDoc); beginTextConfirm opts param + payload; applyTextConfirm {arm} arg; reword header + applyTextConfirm JSDoc
  - leave writein confirm kind untouched

Task 3: REWRITE src/panel/two-stage.test.ts
  - keep fixtures + file header (rewritten prose); apply the per-describe classification (see What §classification): drop :175/:266 describes, add the 3 replacement commit-at-enter tests, keep/patch :294/:363/:442/:491
  - every dropped arm assertion goes; navigation via "\x1b[Z"/"\t", focus via focusText/ctrl+t

Task 4: SCRUB cross-file assertions
  - panel.test.ts :1337/:1504, actions.test.ts :847, ripple-confirm.test.ts :222/:265/:412/:427/:443/:474 — delete/repurpose per research notes

Task 5: VALIDATE
  - npm run typecheck; npm test; grep -rn advanceArmed src/ (expect empty); fix until green
```

### Implementation Patterns & Key Details

```ts
// handleInput AFTER the deletion (shape only — keep every other comment/branch):
const key = parseKey(data);
const enter = key === "enter" && data !== "\n";   // "\n" = newline request (R4)
// (c) Enter per duty (WRITEIN-001 — commit-at-enter, no arming stages):
//   note → exitNoteMode; writein duty → writeInEnter (commits + advances);
//   elaboration → saveTextDraft (save + blur, never advances).
if (enter && (this.focus === "text" || this.focus === "note")) {
  if (this.focus === "note") this.exitNoteMode();
  else if (this.textDuty === "writein") writeInEnter(this);
  else this.saveTextDraft();
  return true;
}
if (this.keys(data, this)) return true;
if (this.focus === "text" || this.focus === "note") {
  this.textField.handleInput(data);
  return true;
}

// Collapsed tails:
private saveTextDraft(): void {
  this.stageText(this.textField.getText());      // arm conditional gone
}
exitTextField(): void {
  this.stageText(this.textField.getText());      // ESC-002 write-through, unchanged behavior
}
private stageText(text: string): void {
  // FR-18 gate unchanged; beginTextConfirm(this, text) with no opts
  ...
  this.commitTextDraft(id, text);
}
commitTextDraft(questionId: string | undefined, text: string): void {
  // slot + seam write + ✎→★ cursor reseed + blurTextField — all unchanged;
  // the arming line is simply gone
}
```

### Integration Points

```yaml
NO new config, state, or renderer surface. Consumers:
  - P2.M1.T1.S1 (maybeAutoSubmit): hooks every commit path — writeInEnter's
    commit and elaboration saves now flow through a single enter gesture;
    leaving no dead second-enter path is the point of this item.
  - ripple-confirm apply paths: signature changes only (arm arg removed).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # zero errors — catches leftover advanceArmed/opts references
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/ -v        # full panel suite (advanceArmed was cross-referenced)
npm test                            # whole repo — zero regressions
grep -rn advanceArmed src/          # expect NO output
```

### Level 3: Integration (live TUI manual — human runbook item, not automation)

```bash
pi -e .
# text question: ctrl+t, type, enter → answered + advanced (one enter)
# choice question: ctrl+t, type, enter → draft saved, still on question, cursor on ★
# type a second enter after elaboration save → accepts the ★ option (normal router path)
# shift+enter / ctrl+j inside editor → newline, no save, no commit
# answered question + dependents: ctrl+t, edit, enter → keep/cancel modal still works
```

### Level 4: Contract sweep

```bash
# Dispatch-ordering property that survives: text/note enter never reaches the
# keys seam (keys-spy flavor asserts keys not called with "\r" in text focus)
# — covered by the kept/added tests in two-stage.test.ts.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean; `npm test` green; `grep -rn advanceArmed src/` empty
- [ ] No `{ arm }` residue in panel.ts / ripple-confirm.ts call chain

### Feature Validation

- [ ] Write-in / text-question enter commits (`custom:true`) + advances; elaboration / note enter saves + blurs — no second enter does anything special
- [ ] Newline sequences (kitty/xterm shift+enter, ctrl+j, alt+enter) still insert newlines only; kitty plain enter still parses as enter
- [ ] FR-18 text confirm modal still defers + applies (ripple-confirm.test.ts green post-scrub)
- [ ] Cursor ✎→★ reseed and draft write-through behaviors unchanged

### Code Quality Validation

- [ ] Only the six listed files modified; actions.ts / keys.ts / text-field.ts untouched
- [ ] Stage (c) enter fork + `"\n"` exclusion preserved (safety-map warning honored)
- [ ] [Mode A] JSDoc rewritten citing WRITEIN-001 removal; no dangling `{@link advanceArmed}` references (grep)

## Anti-Patterns to Avoid

- ❌ Deleting stage (c) or the `const enter` line along with (a)/(b) — that would kill commit-at-enter entirely
- ❌ Keeping a "harmless" advanceArmed field for compatibility — the spec says REMOVED; grep-clean is the acceptance bar
- ❌ Touching writein confirm (P1.M2.T2.S2) or actions.ts advance primitives while removing panel.ts's dead duplicate
- ❌ Rewriting two-stage.test.ts expectations from memory instead of the landed writeInEnter/duty behavior (read actions.ts + T2/T3 PRPs first)
- ❌ Changing the fakeEditor/draftsSpy harness — terminal-realities coverage is the file's whole point

---

**Confidence Score**: 9/10 — the removal-safety map plus verified current-tree anchors enumerate every touchpoint, the keep/drop test classification is per-describe with replacement tests specified, and the only residual risk (T3 landing in parallel shifting anchors) is handled by Task 0's re-read and the "landed code wins" rule.

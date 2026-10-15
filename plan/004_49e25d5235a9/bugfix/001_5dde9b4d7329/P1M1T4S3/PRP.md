# PRP — P1.M1.T4.S3: Auto-submit same-gesture variant (AUTOSUBMIT-003 rule b)

## Goal

**Feature Goal**: Pin, end-to-end, that when a complete answer set's supersede edit (a committed write-in on the LAST answerable question superseded by a real option accept) triggers AUTOSUBMIT-003 rule (b), the same-gesture auto-submission carries the re-bound elaboration — delivered message contains `<qid>: Alpha — <write-in text>` AND state `answer.text` is set. This closes architecture §(f) risk 3 ("the re-bound elaboration ships in the same gesture… 'attaches at the next submit' includes the auto path") as INTENDED, DOCUMENTED behavior instead of an undefined UX corner.

**Deliverable**: ONE new test `test_supersede_writein_same_gesture_auto_submit_ships_rebound_elaboration` appended at the END of the `describe("submit — WRITEIN-002 draft role binding (h2.32/h2.48)")` block in `src/panel/actions.test.ts` (after T4.S2's two no-op tests, before the closing brace). No source-file changes expected; no doc changes (test comment header cites the task ID).

**Success Definition**: Test green on arrival (staging + wiring landed in T2.S1/T3.S1); it asserts BOTH the delivered `sendMessage` content (`q2: Alpha — my custom take`) AND state (`answer.text === "my custom take"`, epoch 2, statuses submitted); it drives only real gesture seams (currentId + explicit cursorIndex + accept — NO manual `submit()` call, the auto-submission is the point); full `npm test` + `npm run typecheck` green; `git status` shows only `src/panel/actions.test.ts` modified. If the test is red because maybeAutoSubmit's ordering bypasses staging, the fix is the call order in `acceptOptionIndex` — NEVER weakened assertions.

## User Persona (if applicable)

**Target User**: The pi user who answered every question (one via a committed write-in on the last question), then reconsiders that write-in and accepts a real option instead.

**Use Case**: The review-flow exit — the user walks back to the last question, replaces their write-in with an option. AUTOSUBMIT-003 rule (b) fires the submission in that same gesture (that is the rule's design: finish at the end of the list and it ships). WRITEIN-002's promise — "accepting a real option after a committed write-in keeps the slot's text as elaboration, attaches at the next submit" — must hold on the AUTO path too: the user's words reach the model as `q2: Alpha — my custom take`, not as silent data loss.

**User Journey**: Answer q1 (option) → answer q2 (write-in, committed) → return to q2 (cursor seeds to the ✎ row) → move to option "Alpha" → enter. One gesture: submission fires, flash `submitted — 2 answer(s)`, the model receives both answers with the write-in preserved as elaboration.

**Pain Points Addressed**: Without this pin, the auto path is undefined UX (architecture §(f) risk 3): a future reordering of `acceptOptionIndex`'s commit tail (staging after `maybeAutoSubmit`, or staging removed) would ship `q2: Alpha` with `answer.text` undefined and the user's committed words vanish on exactly the flow they most likely hit — no test would notice.

## Why

- **Architecture §(f) risk 3** (`plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/architecture/bug001-writein-supersede.md:223`, risk 3): on a complete set the supersede edit itself triggers maybeAutoSubmit → the re-bound elaboration ships in the same gesture, with no chance to edit/clear the staged draft first. This test documents that intended UX.
- **Architecture §(e) "Modified" row** (same doc): "optionally strengthen with the auto-submit variant (supersede as the last-answerable edit on a complete set fires `maybeAutoSubmit` immediately; the *same-gesture* submission should carry `q1: Alpha — my custom take` — 'attaches at the next submit' includes the auto path)". This task IS that variant.
- **The landed wiring's own comment** (actions.ts:322-331): staging must sit AFTER `advanceAfterAccept` and BEFORE `maybeAutoSubmit`, "whose same-gesture delivery must find the slot staged". T3.S1's regression test (`:2277`) pins staging on the manual-submit path only — nothing pins the auto path's ordering today. This is the "edge-contract coverage" P1.M1.T4 exists for.
- **BUG-001 adjudication** (decisions.md, P1.M1.T1.S1 "restore" ruling): the WRITEIN-002 re-bind is the restored product contract; the auto-submit variant is its last uncovered delivery path.

## What

One scenario test (all gestures real; the delivery `sendMessage` seam is the only mock — AUTOMATION-POLICY):

1. Seed a COMPLETE pending set with the write-in on the LAST answerable question: `seed([{id:"q1", overrides:{status:"answered"}}, {id:"q2", overrides:{status:"answered"}}])` then `state.applyAnswer("q2", {value:"my custom take", custom:true, at:T0})` (the `writeInSeed` house pattern, actions.test.ts:680-687 — models exactly what a committed write-in leaves behind, since the real commit consumed the slot: VAL-002). q1 carries `{value:"a", at:T0}` non-custom.
2. `makeDeps(true)` + `new DraftStore()` + `makePanel(state, {delivery: deps, drafts: store})`.
3. Preconditions: `q2.answer.custom === true`, `panel.draftTextFor("q2") === undefined` (no user-held draft — guard 4 must not fire).
4. Gesture: `panel.currentId = "q2"` (ANSWER-PIN-001: the setter re-seeds the cursor to the ✎ row because the recorded answer is custom) then `panel.cursorIndex = 0` (option "a") — ALWAYS currentId FIRST, then cursorIndex. `expect(accept(panel)).toBe(true)` (recorded custom → inert branch impossible → genuine supersede; zero victims → direct apply, no modal).
5. SAME-GESTURE auto-submission assertions (NO manual `submit()` anywhere in the test):
   - `expect(sendMessage).toHaveBeenCalledTimes(1)` — rule (b) fired once, inside `accept`.
   - `state.epoch === 2`; `q1`/`q2` statuses `"submitted"`.
   - `msg = sendMessage.mock.calls[0][0] as {content: string}`; `msg.content` contains `"q2: Alpha — my custom take"` (custom cleared → label + " — " + text, no ✎ marker) and contains `"q1: Alpha"` (the whole pending set ships).
   - `panel.footerFlash?.text === "submitted — 2 answer(s)"`.
   - State: `q2.answer` = `{value:"a", text:"my custom take"}` with `custom` undefined — BOTH the delivered content and the state, per the task contract.
6. Comment header cites the task: `[Mode A] BUG-001 / P1.M1.T4.S3 — AUTOSUBMIT-003 rule (b) same-gesture …` one-liner naming the pinned invariant (staging precedes maybeAutoSubmit, so the auto path's submit finds the slot staged and attaches it).

**If the elaboration assertions fail because auto-submit's ordering bypassed staging**: fix the call order in `acceptOptionIndex` (stageSupersededWriteIn must run BEFORE the maybeAutoSubmit call — while staying AFTER advanceAfterAccept per the :2277 write-through constraint). Do NOT weaken the test.

### Success Criteria

- [ ] One new test at the end of the WRITEIN-002 submit describe block, green, driving only real gesture seams (seeded state + currentId/cursorIndex/accept); no manual submit() call
- [ ] Asserts BOTH `msg.content` (`q2: Alpha — my custom take`, `q1: Alpha`) AND state (`answer.text === "my custom take"`, `answer.value === "a"`, `custom` undefined, epoch 2, both submitted, flash text)
- [ ] Test comment header cites `P1.M1.T4.S3`; placement anchored by sibling test NAMES (after `test_supersede_non_custom_elaborated_answer_stages_nothing`), never line numbers
- [ ] No other file or test modified (T4.S1/T4.S2/T3.S1/T3.S2 tests, unit guards, source files untouched unless the ordering-fix branch is genuinely triggered); `npm test` + `npm run typecheck` fully green; `git status` shows only `src/panel/actions.test.ts` (or that + `actions.ts` IF and only if the ordering fix fired)

## All Needed Context

### Context Completeness Check

Every seam this test drives was read in the working tree: `maybeAutoSubmit` rule-(b) gating verbatim (actions.ts:886-955), the landed commit tail order `applyAnswer → evaluateDependsOn → advanceAfterAccept → stageSupersededWriteIn(:332) → maybeAutoSubmit(:333)`, the helper guards (:367-379), `reconcileDraftsForSubmit` attach branch (:619-655), fixtures (actions.test.ts:52-135), the sibling gesture patterns (:2277 rewritten rebind, :2715 rule-(b) last-sequential edit). An agent needs this PRP + `src/panel/actions.test.ts` + the landed `src/panel/actions.ts` — nothing else for discovery. Verbatim traces: `research/notes.md`.

### Documentation & References

```yaml
- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/architecture/bug001-writein-supersede.md
  why: "THE DESIGN — §(f) risk 3 (lines ~223+): same-gesture elaboration shipping is INTENDED, 'attaches at the next submit' includes the auto path; §(e) 'Modified' row assigns the auto-submit variant to this exact strengthening"
  critical: "the write-in must live on the LAST ANSWERABLE question — rule (b) fires only when commit.questionId === lastAnswerable.id; supersede on a NON-last question ships nothing (manual ctrl+s territory)"

- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/P1M1T4S3/research/notes.md
  why: "full mechanic trace: rule-(b) gate walk, the tail order, why guards 1-4 all pass in this scenario, the exact assertion set, failure triage for the 'do not weaken' branch"
  critical: "notes §3 records the discrepancy: the work-item text says 'staging precedes evaluateDependsOn/advanceAfterAccept' but the LANDED order is after both — the only load-bearing invariant here is staging BEFORE maybeAutoSubmit"

- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/P1M1T4S2/PRP.md
  why: "CONTRACT for the parallel sibling that lands immediately before this test — defines the insertion anchor (its LAST test, test_supersede_non_custom_elaborated_answer_stages_nothing, at the END of the describe block)"
  gotcha: "same file, same describe block; T4.S2 may still be in flight — anchor by test NAME and append after it (or at the block end if not yet present), never by line number"

- file: src/panel/actions.ts
  why: "acceptOptionIndex commit tail :295-335 (recorded capture, inert branch custom-exclusion, wasUnanswered pre-apply, FR-18 zero-victim direct apply, tail order with the :322-331 ORDERING comment); stageSupersededWriteIn :367-379 (4 guards); maybeAutoSubmit :886-955 (rule-(b) lastAnswerable check, one firing = one epoch bump, flash verbatim); reconcileDraftsForSubmit :619 (attaches text for answered + custom !== true + non-blank draft)"
  gotcha: "recorded.custom === true makes the ANSWER-PIN-001 inert branch IMPOSSIBLE — the accept is a genuine supersede by construction; applyAnswer REPLACES the whole answer (custom flag cleared), which is what lets reconcile attach"

- file: src/panel/actions.test.ts
  why: "fixtures: T0 :52, OPTS_AB :60-63 ({value:'a',label:'Alpha'},{value:'b',label:'Beta'}), seed :83 (status:'answered' → applyAnswer {value:'a',at:T0}), makePanel :109, makeDeps :126 ({sendMessage mock, isIdle:()=>true}), writeInSeed pattern :680-687; the WRITEIN-002 describe :2219 (insertion target — append at END, before the closing brace that precedes the maybeAutoSubmit describe at :2605); rule-(b) precedent test_auto_edit_on_complete_set_fires_only_on_last_sequential (~:2576) seeds BOTH answered and edits q2 — mirror that seed shape; message-assertion pattern sendMessage.mock.calls[0][0] as {content: string}"
  gotcha: "panel.currentId = 'q2' re-seeds cursor to the ✎ row (custom recorded answer) — the explicit cursorIndex = 0 AFTER currentId is mandatory or the accept opens the write-in editor instead of superseding"
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
├── actions.ts          # landed: stageSupersededWriteIn :367 + wiring :332 + maybeAutoSubmit :886 — READ ONLY (unless ordering fix fires)
├── panel.ts            # draftTextFor / commitTextDraft / consumeCommittedBuffer — READ ONLY
└── actions.test.ts     # ADD the one same-gesture auto-submit test at the END of the WRITEIN-002 submit describe (ONLY file modified)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/panel/
└── actions.test.ts     # +1 test in the existing submit—WRITEIN-002 describe:
                        #   test_supersede_writein_same_gesture_auto_submit_ships_rebound_elaboration
                        #   (AUTOSUBMIT-003 rule b × WRITEIN-002 re-bind: one accept gesture fires
                        #    the auto-submit AND the delivered message carries the re-bound elaboration)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: rule (b) fires ONLY when the edited question is the LAST
//   sequential ANSWERABLE one (maybeAutoSubmit: reversed find of first
//   non-moot/non-withdrawn). With q1+q2 both answered, lastAnswerable is q2
//   — the write-in MUST be on q2. Superseding a write-in on q1 (non-last)
//   on a complete set ships NOTHING (silent edit) and the test would be
//   pinning the wrong rule position.
// GOTCHA: ANSWER-PIN-001 cursor seeding — panel.currentId = "q2" re-seeds
//   cursorIndex to the recorded answer's row; a CUSTOM answer seeds the ✎
//   row (2). Set currentId FIRST, then cursorIndex = 0 explicitly. An
//   accept on the ✎ row opens the write-in editor — not a supersede.
// GOTCHA: the seeded write-in is state.applyAnswer'd (writeInSeed house
//   pattern), NOT gestured — a gestured commit on a complete set would
//   itself fire rule (a)/(b) in writeInEnter's tail (actions.ts:519) and
//   pollute sendMessage counts with an EARLIER firing. The seed models the
//   committed write-in's residue exactly (answer only; slot consumed).
// GOTCHA: makeDeps(true) + panel {delivery: deps} is REQUIRED — no
//   delivery surface means maybeAutoSubmit no-ops (d === undefined return)
//   and NOTHING fires.
// GOTCHA: this is a STABILIZATION test — wiring landed in T2.S1/T3.S1. A
//   red test = landed-contract defect (ordering regression) or gesture
//   mis-drive. Triage: sendMessage 0× → rule (b) didn't fire (wrong
//   question / incomplete set); 1× but no elaboration → staging bypassed
//   by maybeAutoSubmit order → FIX acceptOptionIndex call order (stage
//   BEFORE maybeAutoSubmit, AFTER advanceAfterAccept), NEVER weaken.
// GOTCHA: do NOT add dependsOn overrides — victims > 0 routes through the
//   FR-18 modal (T3.S2's territory); zero-victim direct path is the point.
// GOTCHA: this test makes NO manual submit() call — assert sendMessage
//   times(1) IMMEDIATELY after accept(panel); any second call would be a
//   double-firing bug (FR-D4: one firing = one submission, one bump).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: VERIFY LANDED CONTRACT + SIBLING ANCHORS
  - READ src/panel/actions.ts:295-335 (commit tail: applyAnswer →
    evaluateDependsOn → advanceAfterAccept → stageSupersededWriteIn(:332)
    → maybeAutoSubmit(:333)) and :886-955 (rule-(b) lastAnswerable gate).
  - READ the WRITEIN-002 submit describe (:2219 → just before :2605):
    rewritten rebind test (:2277 region), T4.S1's guard-4 tests, T3.S2's
    modal test, and T4.S2's two no-op tests if already landed. Identify
    the CURRENT last test in the block — the append anchor.
  - RUN: npx vitest run src/panel/actions.test.ts -t "supersede" → all
    green before adding the sibling.

Task 2: ADD test_supersede_writein_same_gesture_auto_submit_ships_rebound_elaboration
  - APPEND at the END of the submit—WRITEIN-002 describe block, AFTER
    T4.S2's test_supersede_non_custom_elaborated_answer_stages_nothing
    (anchor by NAME — line numbers shift with T4.S2's landing), before
    the closing brace.
  - BODY (verbatim mechanic trace in research/notes.md §4):
    seed q1+q2 answered; applyAnswer q2 {value:"my custom take",
    custom:true, at:T0}; makeDeps(true); new DraftStore(); makePanel;
    precondition asserts (custom === true, draftTextFor undefined);
    currentId="q2" then cursorIndex=0; expect(accept(panel)).toBe(true);
    SAME-GESTURE asserts: sendMessage times(1), epoch 2, both submitted,
    msg.content toContain("q2: Alpha — my custom take") AND
    toContain("q1: Alpha"), footerFlash?.text "submitted — 2 answer(s)",
    q2.answer {value:"a", text:"my custom take"} custom undefined.
  - COMMENT HEADER: [Mode A] BUG-001 / P1.M1.T4.S3 — AUTOSUBMIT-003 rule
    (b): superseding a committed write-in on the LAST answerable question
    of a complete set fires maybeAutoSubmit in the same gesture; the auto
    path's submit finds the slot staged (acceptOptionIndex orders staging
    BEFORE maybeAutoSubmit) and attaches it — "attaches at the next
    submit" includes the auto path (architecture §(f) risk 3, intended).

Task 3: VALIDATE
  - npx vitest run src/panel/actions.test.ts -t "supersede" → all green
    (unit pins + every scenario pin + rebind + modal + this test)
  - npx vitest run src/panel/actions.test.ts -t "same_gesture" → 1 passed
  - npm test && npm run typecheck → fully green
  - git status --short → ONLY src/panel/actions.test.ts modified (unless
    the ordering-fix branch of the task contract fired — then actions.ts
    too, and re-run the FULL suite)
  - Level-4 mutation checks (see Validation Loop) — perform and REVERT
```

### Implementation Patterns & Key Details

```ts
// The complete test body pattern — copy these seams exactly:

test("test_supersede_writein_same_gesture_auto_submit_ships_rebound_elaboration", () => {
  // [Mode A] BUG-001 / P1.M1.T4.S3 — comment header per Task 2
  const state = seed([
    { id: "q1", overrides: { status: "answered" } }, // {value:"a", at:T0} via seed's applyAnswer
    { id: "q2", overrides: { status: "answered" } },
  ]);
  state.applyAnswer("q2", { value: "my custom take", custom: true, at: T0 }); // recorded WRITE-IN on the LAST answerable
  const store = new DraftStore();
  const { deps, sendMessage } = makeDeps(true);
  const { panel } = makePanel(state, { delivery: deps, drafts: store });
  expect(state.getQuestion("q2")?.answer?.custom).toBe(true);
  expect(panel.draftTextFor("q2")).toBeUndefined(); // committed write-in holds no slot (VAL-002 consume)

  panel.currentId = "q2"; // ANSWER-PIN-001: custom answer re-seeds cursor to the ✎ row
  panel.cursorIndex = 0; // option "a" — explicit
  expect(accept(panel)).toBe(true); // genuine supersede → tail: stage → maybeAutoSubmit FIRES

  // SAME GESTURE — no manual submit() call anywhere above this line:
  expect(sendMessage).toHaveBeenCalledTimes(1);
  expect(state.epoch).toBe(2);
  expect(state.getQuestion("q1")?.status).toBe("submitted");
  expect(state.getQuestion("q2")?.status).toBe("submitted");
  const msg = sendMessage.mock.calls[0][0] as { content: string };
  expect(msg.content).toContain("q2: Alpha — my custom take"); // the re-bound elaboration DELIVERED
  expect(msg.content).toContain("q1: Alpha"); // whole pending set ships
  expect(panel.footerFlash?.text).toBe("submitted — 2 answer(s)");
  const a = state.getQuestion("q2")?.answer;
  expect(a?.value).toBe("a");
  expect(a?.text).toBe("my custom take"); // AND held in STATE
  expect(a?.custom).toBeUndefined(); // custom cleared by the supersede applyAnswer
});
```

### Integration Points

```yaml
TEST REGISTRATION:
  - add to: src/panel/actions.test.ts, describe("submit — WRITEIN-002 draft role binding (h2.32/h2.48)") (:2219)
  - pattern: append after T4.S2's last test (by name), before the block's closing brace

SOURCE (CONDITIONAL — only if the test lands red on elaboration):
  - file: src/panel/actions.ts acceptOptionIndex tail
  - constraint: stageSupersededWriteIn must run BEFORE maybeAutoSubmit (currently :332 → :333) and AFTER advanceAfterAccept (:322-331 comment explains why — the advance's write-through would wipe a pre-advance staging)
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | head -20   # or: npm run typecheck
npx vitest list src/panel/actions.test.ts 2>/dev/null | grep -c same_gesture  # compiles + test found
# Expected: zero type errors; the new test name listed
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/panel/actions.test.ts -t "same_gesture"   # the new test — green
npx vitest run src/panel/actions.test.ts -t "supersede"      # the whole re-bind family (rebind + guards + no-ops + modal + this)
npm test                                                      # full suite
npm run typecheck
# Expected: all green. If "q2: Alpha — my custom take" is missing from content:
# triage per research/notes.md §6, fix acceptOptionIndex order, NEVER weaken.
```

### Level 3: Integration Testing (System Validation)

Not applicable — single-file test addition; `npm test` IS the system check (vitest, node:test-free repo; no server/process to start).

### Level 4: Mutation Checks (contract strength — perform then REVERT)

```bash
# M1 (ordering — the core pin): in src/panel/actions.ts, swap the :332 stageSupersededWriteIn
#   call to AFTER the :333 maybeAutoSubmit call → the new test MUST fail on
#   msg.content / answer.text (the :2277 manual-path test still passes — only
#   the auto path notices). REVERT.
# M2 (rule position): in the test copy only, move the write-in to q1 and edit
#   q1 (non-last) → sendMessage times(1) fails (0 calls — rule (b) narrowing).
#   Confirms the test sits on rule (b), not accidental completeness. Discard.
# M3 (staging removal): delete the stageSupersededWriteIn call → new test
#   fails, :2277 also fails. REVERT. Run: npx vitest run src/panel/actions.test.ts -t "same_gesture"
```

## Final Validation Checklist

### Technical Validation

- [ ] All validation levels completed; `npm test` + `npm run typecheck` fully green
- [ ] New test green: `npx vitest run src/panel/actions.test.ts -t "same_gesture"`
- [ ] Whole family green: `npx vitest run src/panel/actions.test.ts -t "supersede"`
- [ ] Mutation checks M1/M3 performed and REVERTED; `git diff` clean afterward

### Feature Validation

- [ ] Test asserts BOTH delivered content (`q2: Alpha — my custom take`, `q1: Alpha`) AND state (`answer.text`, `answer.value`, `custom` undefined, epoch 2, statuses, flash)
- [ ] Exactly ONE sendMessage call, produced by the accept gesture itself (no manual submit() in the test)
- [ ] Write-in lives on the LAST answerable question (q2) — rule (b) position verified via mutation M2 reasoning
- [ ] Ordering-fix branch fired ONLY if genuinely red on arrival; documented in the test comment if so

### Code Quality Validation

- [ ] Follows house conventions: test_snake_case naming, `[Mode A] BUG-001 / P1.M1.T4.S3` comment header, fixtures reused (T0/seed/makePanel/makeDeps), message-cast pattern `sendMessage.mock.calls[0][0] as {content: string}`
- [ ] Placement: end of the WRITEIN-002 submit describe, anchored by sibling test names; no other test touched
- [ ] `git status --short` → only `src/panel/actions.test.ts` (default) — no PRD/spec/tasks.json/source drift

### Documentation & Deployment

- [ ] No doc changes required (task contract: "none — no surface change; test header cites task ID")

## Anti-Patterns to Avoid

- ❌ Do NOT weaken assertions to make a red test green — the ordering fix belongs in `acceptOptionIndex`, not the test
- ❌ Do NOT call `submit(panel, deps)` manually anywhere in the test — that converts the same-gesture pin into a manual-submit duplicate of `:2277`
- ❌ Do NOT put the write-in on a non-last question — rule (b) will not fire and the test silently pins nothing
- ❌ Do NOT gesture the write-in commit in-test — its own commit tail fires maybeAutoSubmit and pollutes the call count; seed via `applyAnswer` (writeInSeed pattern)
- ❌ Do NOT set `cursorIndex` before `currentId` (ANSWER-PIN-001 re-seed overwrites it) or omit it (the ✎ row opens the editor, not a supersede)
- ❌ Do NOT add `dependsOn` overrides (FR-18 modal is T3.S2's territory) or duplicate T4.S1/T4.S2 guard scenarios
- ❌ Do NOT anchor insertion by line numbers — T4.S2 lands in parallel; anchor by test names

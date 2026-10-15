---
name: "P1.M1.T4.S2 — Kind-flip no-op + non-custom supersede no-op scenarios"
description: "Two scenario tests in src/panel/actions.test.ts pinning stageSupersededWriteIn guards 3 and 1 END-TO-END through the wired acceptOptionIndex direct path: (a) a write-in byte-equal to the accepted option's value stages nothing and never ships 'Alpha — a'; (b) an option→option switch on an elaboration-carrying (non-custom) answer stages nothing. Test-only; no source changes."
---

## Goal

**Feature Goal**: Pin the two NO-OP edges of the restored WRITEIN-002 re-bind (BUG-001) — guard 3 (kind-flip: superseded write-in text byte-equals the new option's value → never stage, never ship "q1: Alpha — a") and guard 1 (non-custom: an option→option switch, even when the superseded answer carried elaboration text → never stage) — as END-TO-END scenario tests through the wired direct path (`acceptOptionIndex` → `stageSupersededWriteIn` at actions.ts:332, the T3.S1 deliverable), including the submit outcome. The unit pins from T2.S1 (actions.test.ts:888-945) call the helper directly; these tests prove the no-ops survive the real gesture path (commit → supersede accept → submit) so a future "helpful" widening of the helper or a call-site regression cannot silently stage over-eagerly.

**Deliverable**: Two new tests appended at the END of the `describe("submit — WRITEIN-002 draft role binding (h2.32/h2.48)")` block in `src/panel/actions.test.ts`: `test_supersede_kind_flip_writein_equals_option_value_stages_nothing` and `test_supersede_non_custom_elaborated_answer_stages_nothing`. No source-file changes; no doc changes (test comment headers cite the task ID).

**Success Definition**: Both tests green on arrival (guards + wiring landed in T2.S1/T3.S1); each pins BOTH the slot state (`panel.draftTextFor("q1") === undefined` at accept time AND after submit) AND the shipped submission line (no duplication in (a); no resurrected elaboration in (b)); full `npm test` + `npm run typecheck` green; `git status` shows only `src/panel/actions.test.ts` modified.

## User Persona (if applicable)

**Target User**: The pi user who (a) typed a write-in that happens to byte-equal a real option's value (e.g. "a" when option "a" exists), then accepts that option — a pure "kind flip" with zero information change; or (b) answered option "a" WITH elaboration already attached as `answer.text`, then switches to option "b".

**Use Case**: (a) The user's answer value doesn't change — only its KIND (custom → option). Shipping `q1: Alpha — a` would present their own value back to them as a fake rationale. (b) The user's old elaboration was rationale for the OLD option; the switch drops it, and no phantom draft slot appears demanding attention (✎ marker) for text they never typed in a slot.

**User Journey**: (a) Commit write-in "a" → return to q1 → accept option "a" → submit ships a clean `q1: Alpha`, no "— a" tail. (b) q1 answered "a" with elaboration text → switch to "b" → no ✎ draft marker lights, no slot appears → submit ships `q1: Beta` and the old elaboration is simply gone (superseded, not resurrected).

**Pain Points Addressed**: Over-eager staging regressions — a future edit widening `stageSupersededWriteIn` (or its call site passing a stale `recorded`) would manufacture drafts the user never held, ship value-as-elaboration duplication, and light ✎ markers for nothing.

## Why

- Architecture/bug001-writein-supersede.md §(d) guard rationale 1 and 3: guard 3 exists because staging a byte-equal kind flip "would ship `q1: Alpha — Alpha`" (§(d) point 3); guard 1 exists because non-custom superseded answers are "a plain option→option edit with no kept-text contract" (§(d) point 1) — and because the ANSWER-PIN-001 inert branch requires `recorded.custom !== true`, a custom answer can NEVER take the no-op path, so guard 3's kind-flip case is the one genuine-apply scenario where value does not change.
- §(e) new-test matrix: test 4 (kind-flip no-op) and test 6 (non-custom supersede stages nothing) are THIS task's exact scenarios; tests 1/2/3/5 and the auto-submit variant belong to T3.S1/T4.S1/T3.S2/T4.S3.
- The T2.S1 unit tests pin the guards in isolation; they cannot catch a wiring regression (call site passing the wrong `recorded`, guard reorder, bypass of the helper) or a submit-path interaction. Scenario pins close that gap — this is the "edge-contract coverage" task P1.M1.T4 exists for.
- P1.M3.T2's documentation coherence sweep reads the suite as the contract's voice; these two no-ops are the semantics most likely to be "simplified" into a regression (why not always re-stage?).

## What

1. **Test (a) `test_supersede_kind_flip_writein_equals_option_value_stages_nothing`** — `seed(BASIC)` + `new DraftStore()` + `makePanel(state, { drafts: store })` + `makeDeps(true)`; `commitWriteIn(panel, "a")` (the in-describe helper — text byte-equals option "a"'s VALUE); assert `answer.custom === true` and `draftTextFor("q1") === undefined` (VAL-002 consume documented); `panel.currentId = "q1"` then `panel.cursorIndex = 0` (the setter re-seeds cursor to the ✎ row because the recorded answer is custom — ANSWER-PIN-001); `expect(accept(panel)).toBe(true)`; assert `answer` is `{value:"a"}` with `custom` undefined, `draftTextFor("q1") === undefined`, `store.getDraft("q1") === undefined` (nothing staged in either seam); `submit(panel, deps)` → assert `answer.text === undefined`, message contains `q1: Alpha`, message NOT contains `Alpha — a` (the kind-flip duplication), `draftTextFor("q1")` still undefined.
2. **Test (b) `test_supersede_non_custom_elaborated_answer_stages_nothing`** — `seed(BASIC)`; seed the elaboration-carrying answer via the raw primitive: `state.applyAnswer("q1", { value: "a", text: "because of the latency profile", at: T0 })` (models "elaboration already shipped as text" — what a prior submit leaves behind; see the CRITICAL gotcha below for why this must NOT be gestured); make panel/store/deps; assert precondition `draftTextFor("q1") === undefined`; `panel.currentId = "q1"` then `panel.cursorIndex = 1` (recorded "a" re-seeds cursor to row 0 — drive to option "b" explicitly); `expect(accept(panel)).toBe(true)`; assert `answer` is `{value:"b"}` with `text` undefined (applyAnswer REPLACED the whole answer — old elaboration dropped) and `custom` undefined, `draftTextFor("q1") === undefined` (guard 1: non-custom stages NOTHING), `store.getDraft("q1") === undefined`; `submit(panel, deps)` → assert `answer.text === undefined`, message contains `q1: Beta`, message NOT contains `because of the latency profile`, `draftTextFor("q1")` still undefined.
3. **Per-test comment headers cite this task** (house convention): `[Mode A] BUG-001 / P1.M1.T4.S2 — guard 3: kind-flip …` and `— guard 1: non-custom …` one-liners stating which no-op each test pins and why.

### Success Criteria

- [ ] Both tests present at the end of the WRITEIN-002 submit describe block, green, driving ONLY the real gesture seams (commitWriteIn, currentId/cursorIndex + accept, submit) plus the one sanctioned raw `state.applyAnswer` seed in (b)
- [ ] Both tests pin `draftTextFor("q1") === undefined` at BOTH the accept and the post-submit points, plus the store seam (`store.getDraft("q1") === undefined`)
- [ ] Test (a) pins the shipped-line duplication absence (`not.toContain("Alpha — a")`) AND `answer.text === undefined`; test (b) pins `answer.text === undefined` after the switch AND the elaboration string's absence from the shipped message
- [ ] No other file or test modified (unit guard tests, the rewritten :2277 test, modal tests, T4.S1's tests all untouched); `npm test` + `npm run typecheck` fully green
- [ ] No drift into T4.S1 (guard-4 scenarios), T4.S3 (auto-submit — q2 stays OPEN), T3.S2 (modal — no dependsOn added)

## All Needed Context

### Context Completeness Check

Every seam these tests drive was read in the working tree (helper guards verbatim at actions.ts:367-379, wiring at :332, submit's store-only flush at :813, draftTextFor's slot-first read at panel.ts:1209, fixtures at actions.test.ts:52-135). An agent needs this PRP + `src/panel/actions.test.ts` + the landed `src/panel/actions.ts`/`src/panel/panel.ts` — nothing else for discovery. Verbatim mechanic traces are in research/notes.md.

### Documentation & References

```yaml
- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/architecture/bug001-writein-supersede.md
  why: "THE DESIGN — §(d) guard rationale points 1 (custom-only: plain option→option edits carry no kept-text contract; custom answers can never take the inert path) and 3 (kind-flip: byte-equal staging would ship 'Alpha — Alpha'); §(e) new-test matrix rows 4 and 6 are this task's exact scenarios"
  critical: "§(e) assigns tests 1/2/3/5 + auto-submit to OTHER tasks — do not duplicate them; §(d) point 5 explains why applyWriteInConfirm never calls the helper (write-in→write-in edits keep custom:true)"

- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/P1M1T4S2/research/notes.md
  why: "VERBATIM step-by-step mechanic traces for both scenarios (why writeInEnter's inert branch cannot fire at commit time; why the custom answer re-seeds the cursor to the ✎ row; why applyAnswer drops the old text) + the submit-flush finding that dictates scenario (b)'s seeded design"
  critical: "§4 is the decisive constraint: submit flushes ONLY the DraftStore — the panel-local draftSlots map survives submit, so a gestured elaboration makes draftTextFor permanently defined and the undefined pin UNPINNABLE"

- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/P1M1T3S1/PRP.md
  why: "CONTRACT for the wired direct path these tests consume — acceptOptionIndex calls stageSupersededWriteIn at actions.ts:332 AFTER applyAnswer, BEFORE maybeAutoSubmit; also owns the rewritten test_submit_superseded_writein_rebinds_as_elaboration (:2277) whose gesture pattern (currentId + explicit cursorIndex + accept) these tests mirror"
  gotcha: "do not modify that rewritten test; T4.S1 also inserts after it (parallel) — this task appends at the END of the describe block instead, precisely to avoid collision"

- file: plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/P1M1T4S1/PRP.md
  why: "CONTRACT for the parallel guard-4 scenario tests (user-held wins / delete-to-empty wins) — defines the boundary: this task never creates a defined slot, so guard 4 is never the pin here"
  gotcha: "same file, same describe block — anchor insertion by test NAMES (end of block, after test_zero_pending_flash_names_held_drafts_verbatim), never by line numbers (T4.S1's landing will shift them)"

- file: src/panel/actions.ts
  why: "stageSupersededWriteIn :367-379 (guard 1 = custom-only, guard 3 = text === newValue), acceptOptionIndex wiring :332, writeInEnter's byte-identical-FIRST inert branch (fires only on RE-commit with a recorded answer — NOT at first commit), reconcileDraftsForSubmit's attach branch (answer.custom !== true + draftTextFor non-blank), submit's shipDrafts :813"
  gotcha: "the ANSWER-PIN-001 inert check in acceptOptionIndex requires recorded.custom !== true — a custom answer ALWAYS takes the genuine-supersede path, which is exactly why scenario (a) reaches guard 3 with an unchanged value"

- file: src/panel/actions.test.ts
  why: "house fixtures: T0 :52, OPTS_AB :60-63 ({value:'a',label:'Alpha'},{value:'b',label:'Beta'}), seed :83, makePanel :109, makeDeps :126, BASIC :132-135 (q1+q2 both OPEN, NO dependsOn); the in-describe commitWriteIn helper :2224-2231; the WRITEIN-002 submit describe :2219 (insertion target — append at its END); unit guard tests :888-945 (do not touch); message-assertion pattern sendMessage.mock.calls[0][0] as {content: string}"

- file: src/panel/panel.ts
  why: "draftTextFor :1209 (slot-FIRST: draftSlots.get(qid)?.text ?? drafts?.getDraft(qid)), draftSlots.delete ONLY in consumeCommittedBuffer :985, commitTextDraft :903-925 (sets BOTH panel slot :905 and store seam)"
  gotcha: "nothing in the submit path deletes from draftSlots — this is why scenario (b) seeds rather than gestures (research notes §4)"
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
├── actions.ts          # stageSupersededWriteIn (:367) + acceptOptionIndex wiring (:332) — landed, READ ONLY
├── panel.ts            # draftTextFor / commitTextDraft / consumeCommittedBuffer — READ ONLY
├── ripple-confirm.ts   # modal-path twin (:164-165) — landed, untouched here
└── actions.test.ts     # ADD the two no-op scenario tests at the END of the WRITEIN-002 submit describe (ONLY file modified)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/panel/
└── actions.test.ts     # +2 tests in the existing submit—WRITEIN-002 describe:
                        #   test_supersede_kind_flip_writein_equals_option_value_stages_nothing   (guard 3, end-to-end)
                        #   test_supersede_non_custom_elaborated_answer_stages_nothing            (guard 1, end-to-end)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL (scenario b design): submit flushes ONLY the DraftStore
#   (actions.ts:813 shipDrafts); the panel-local draftSlots map is deleted
#   ONLY by consumeCommittedBuffer (panel.ts:985). draftTextFor is slot-FIRST
#   (panel.ts:1209). So a gestured elaboration + intermediate submit leaves
#   draftTextFor("q1") DEFINED forever — the switch would then be a GUARD-4
#   skip (T4.S1's territory) and the "=== undefined" pin would be impossible.
#   SEED the elaboration-carrying answer via state.applyAnswer (house
#   pattern — the elaboration-attach test seeds applyAnswer directly).
// GOTCHA: writeInEnter's byte-identical inert branch fires only on RE-commit
#   (a RECORDED custom write-in / recorded value on text questions). At first
#   commit q1 is OPEN — no recorded answer — so commitWriteIn(panel, "a") is a
#   GENUINE commit (applyAnswer {value:"a", custom:true} + consume). Do not
#   "fix" the test because you expected the inert no-op.
// GOTCHA: ANSWER-PIN-001 cursor seeding — panel.currentId = "q1" re-seeds
#   cursorIndex to the recorded answer's row. In (a) the recorded answer is
#   CUSTOM → the ✎ row (2): set cursorIndex = 0 explicitly. In (b) the
#   recorded answer is option "a" → row 0: set cursorIndex = 1 explicitly.
#   Always set currentId FIRST, then cursorIndex.
// GOTCHA: q2 must STAY OPEN in both tests — completeness absent → the
#   maybeAutoSubmit call at actions.ts:333 no-ops. The same-gesture
#   auto-submit variant is T4.S3's test, not these.
// GOTCHA: do NOT add dependsOn overrides — the FR-18 modal path (victims>0)
#   is T3.S2's territory; BASIC's zero-victim direct path is the point here.
// GOTCHA: these are STABILIZATION tests — guards + wiring already landed. A
#   red new test = landed-contract defect or gesture mis-drive. Diagnose
#   (draftTextFor / store.getDraft at each step); NEVER weaken assertions.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: VERIFY LANDED CONTRACT
  - READ src/panel/actions.ts:367-379 (guards 1-4 present) and :332 (the
    acceptOptionIndex wiring). READ the WRITEIN-002 submit describe
    (:2219+) including the in-describe commitWriteIn helper and the
    rewritten supersede test (:2277) — the gesture pattern to mirror.
  - RUN: npx vitest run src/panel/actions.test.ts -t "supersede" → all green
    (unit guard pins + rewritten rebind + modal tests) before adding siblings.

Task 2: ADD test (a) — kind-flip no-op (guard 3, end-to-end)
  - APPEND at the END of the submit—WRITEIN-002 describe block (after
    test_zero_pending_flash_names_held_drafts_verbatim), inside the closing
    brace — the collision-free spot given T4.S1's mid-block insertion.
  - BODY: research/notes.md §3 trace — commitWriteIn(panel, "a"); assert
    custom:true + draftTextFor undefined; currentId="q1" + cursorIndex=0 +
    accept; assert answer {value:"a"} custom undefined, draftTextFor
    undefined, store.getDraft undefined; submit; assert answer.text
    undefined, msg toContain("q1: Alpha"), not.toContain("Alpha — a"),
    draftTextFor still undefined.
  - COMMENT HEADER: [Mode A] BUG-001 / P1.M1.T4.S2 — guard 3 kind-flip: a
    write-in byte-equal to the accepted option's value is a pure kind flip;
    staging would ship "q1: Alpha — a" (the value echoed as elaboration).

Task 3: ADD test (b) — non-custom supersede stages nothing (guard 1, end-to-end)
  - BODY: research/notes.md §4 trace — seed(BASIC); state.applyAnswer("q1",
    {value:"a", text:"because of the latency profile", at:T0}) BEFORE
    makePanel (the seeded "already shipped" elaboration); assert
    precondition draftTextFor undefined; currentId="q1" + cursorIndex=1 +
    accept; assert answer {value:"b"} text undefined custom undefined
    (applyAnswer replaced the whole answer), draftTextFor undefined,
    store.getDraft undefined; submit; assert answer.text undefined, msg
    toContain("q1: Beta"), not.toContain("because of the latency profile"),
    draftTextFor still undefined.
  - COMMENT HEADER: [Mode A] BUG-001 / P1.M1.T4.S2 — guard 1: only
    write-ins re-bind; an option→option switch carries no kept-text
    contract, and the seeded answer is state-applyAnswer'd because submit
    flushes only the DraftStore (a gestured elaboration would make the slot
    permanently defined — guard-4 territory, T4.S1).
  - NAMING: test_snake_case; placement: end of describe block.

Task 4: VALIDATE
  - npx vitest run src/panel/actions.test.ts -t "supersede" → all green
    (unit pins + scenario pins + rebind + modal)
  - npm test && npm run typecheck → fully green
  - git status --short → ONLY src/panel/actions.test.ts modified
  - Level-4 mutation checks (see Validation Loop) — perform and REVERT
```

### Implementation Patterns & Key Details

```ts
// The decisive assertion sets (one per test) — copy these exactly:

// (a) kind-flip no-op — guard 3 through the real path:
commitWriteIn(panel, "a"); // text byte-equals option "a"'s VALUE
expect(state.getQuestion("q1")?.answer?.custom).toBe(true);
expect(panel.draftTextFor("q1")).toBeUndefined(); // VAL-002: commit consumed the slot
panel.currentId = "q1"; // re-seeds cursor to the ✎ row (custom answer, ANSWER-PIN-001)
panel.cursorIndex = 0; // option "a" row — explicit
expect(accept(panel)).toBe(true); // custom:true → inert branch impossible → genuine supersede
expect(state.getQuestion("q1")?.answer?.value).toBe("a");
expect(state.getQuestion("q1")?.answer?.custom).toBeUndefined(); // kind flipped
expect(panel.draftTextFor("q1")).toBeUndefined(); // guard 3: nothing staged
expect(store.getDraft("q1")).toBeUndefined(); // neither seam
expect(submit(panel, deps)).toBe(true);
expect(state.getQuestion("q1")?.answer?.text).toBeUndefined(); // no elaboration attached
const msg = sendMessage.mock.calls[0][0] as { content: string };
expect(msg.content).toContain("q1: Alpha");
expect(msg.content).not.toContain("Alpha — a"); // the kind-flip duplication never ships
expect(panel.draftTextFor("q1")).toBeUndefined(); // still nothing post-submit

// (b) non-custom supersede stages nothing — guard 1 through the real path:
const state = seed(BASIC);
state.applyAnswer("q1", { value: "a", text: "because of the latency profile", at: T0 }); // elaboration already shipped as text
const store = new DraftStore();
const { panel } = makePanel(state, { drafts: store });
const { deps, sendMessage } = makeDeps(true);
expect(panel.draftTextFor("q1")).toBeUndefined(); // precondition: no live slot
panel.currentId = "q1"; // recorded "a" → cursor re-seeds to row 0
panel.cursorIndex = 1; // option "b" — the switch
expect(accept(panel)).toBe(true); // values differ → not inert → genuine apply
const a = state.getQuestion("q1")?.answer;
expect(a?.value).toBe("b");
expect(a?.text).toBeUndefined(); // applyAnswer REPLACED the answer — old elaboration dropped
expect(a?.custom).toBeUndefined();
expect(panel.draftTextFor("q1")).toBeUndefined(); // guard 1: non-custom stages NOTHING
expect(store.getDraft("q1")).toBeUndefined();
expect(submit(panel, deps)).toBe(true);
expect(state.getQuestion("q1")?.answer?.text).toBeUndefined();
const msg = sendMessage.mock.calls[0][0] as { content: string };
expect(msg.content).toContain("q1: Beta");
expect(msg.content).not.toContain("because of the latency profile"); // dropped, never resurrected
expect(panel.draftTextFor("q1")).toBeUndefined();
```

### Integration Points

```yaml
PIPELINE: P1.M3.T2 (README/spec coherence sweep) treats this suite as the
  contract's voice — these no-op pins are why "only write-ins re-bind" and
  "never a kind-flip duplication" survive that sweep unchanged.
NO source/config/API surface changes (Mode: none — the test comment headers
  citing BUG-001 / P1.M1.T4.S2 ARE the documentation, per the item's DOCS: none).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck     # tsc --noEmit — zero errors (test types included)
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/panel/actions.test.ts -t "supersede"   # unit guard pins + rewritten rebind + modal + BOTH new scenario tests green
npx vitest run src/panel/actions.test.ts                  # whole file green (VAL-002 pins + ANSWER-PIN-001 pins intact)
npm test                                                  # FULL suite green
# Expected: all green. A red new test = landed-contract defect or gesture
# mis-drive — diagnose draftTextFor/store.getDraft at each step; never weaken.
```

### Level 3: Scope Proof (No Collateral)

```bash
git status --short        # ONLY src/panel/actions.test.ts modified
git diff --stat           # one file; additions only
```

### Level 4: Contract Pin (Semantics — mutation checks, then REVERT)

```bash
# Guard 3 pin: temporarily delete `if (text === newValue) return; // 3` from
# stageSupersededWriteIn (src/panel/actions.ts) and re-run —
npx vitest run src/panel/actions.test.ts -t "kind_flip"
#   → MUST FAIL (draftTextFor would read "a"; the line would ship "Alpha — a").
# Guard 1 pin: temporarily delete the `superseded.custom !== true` clause from
# guard 1 and re-run —
npx vitest run src/panel/actions.test.ts -t "non_custom_elaborated"
#   → MUST FAIL (recorded.value "a" ≠ "b" → guard 3 passes → stages "a").
# RESTORE src/panel/actions.ts exactly (git diff src/panel/actions.ts must be
# empty afterwards). Do NOT commit either mutation.
```

## Final Validation Checklist

### Technical Validation

- [ ] All 4 validation levels completed; both mutation checks failed red under mutation and were reverted
- [ ] `npm test` fully green; `npm run typecheck` zero errors
- [ ] `git status` shows only `src/panel/actions.test.ts` modified; additions only

### Feature Validation

- [ ] Test (a): draftTextFor undefined at commit, at accept, and post-submit; `answer.text` undefined; shipped line has `q1: Alpha` and NOT `Alpha — a`
- [ ] Test (b): precondition undefined; answer `{value:"b"}` with text/custom undefined after the switch; shipped line has `q1: Beta` and NOT the elaboration string
- [ ] Both store-seam assertions present (`store.getDraft("q1") === undefined`)
- [ ] Both comment headers cite `[Mode A] BUG-001 / P1.M1.T4.S2` + the guard number

### Code Quality Validation

- [ ] Placement: END of the `submit — WRITEIN-002 draft role binding` describe block; test names exactly as specified
- [ ] Real gesture seams only (commitWriteIn / currentId+cursorIndex+accept / submit) + the one sanctioned `state.applyAnswer` seed in (b)
- [ ] No drift into guard-4 scenarios (T4.S1), auto-submit (T4.S3 — q2 stays open), modal path (T3.S2 — no dependsOn)
- [ ] Unit guard tests (:888-945), the rewritten :2277 test, and T4.S1's tests untouched

### Documentation & Deployment

- [ ] No doc changes needed (no surface change); test headers cite the task ID per house convention

---

## Anti-Patterns to Avoid

- ❌ Don't gesture the elaboration in scenario (b) and submit it mid-test — the panel-local draftSlots survive submit (only the store is flushed), leaving `draftTextFor` permanently defined: the pin becomes impossible and you'd be re-testing guard 4 (T4.S1's scenario)
- ❌ Don't expect writeInEnter's byte-identical inert branch in scenario (a)'s commit — it fires only on RE-commit with a recorded answer; the first commit of "a" is genuine
- ❌ Don't set cursorIndex before currentId — the currentId setter re-seeds the cursor (ANSWER-PIN-001); always `currentId` first, then explicit `cursorIndex`
- ❌ Don't answer q2 or add dependsOn — auto-submit (T4.S3) and the modal path (T3.S2) are sibling territory
- ❌ Don't manually call `panel.commitTextDraft` or `stageSupersededWriteIn` inside these tests — these are SCENARIO pins through the real path; the unit pins already exist
- ❌ Don't weaken a failing assertion to force green — a red test here reports a landed-contract defect (diagnose, then report per pipeline rules)
- ❌ Don't touch source files, sibling tests, or the unit guard describe block

---

**Confidence Score**: 9/10 — both scenarios were traced step-by-step against the landed code (guards verbatim at actions.ts:367-379, wiring at :332, the inert-branch precondition in writeInEnter and acceptOptionIndex, applyAnswer's whole-answer replacement, submit's store-only flush, slot-first draftTextFor), the assertion sets are copy-pasteable, and the one design subtlety (scenario (b) seeding) is fully justified with code citations. Residual risk: line-number drift from the parallel T4.S1 landing in the same describe block — mitigated by anchoring on test names and appending at the block's end.

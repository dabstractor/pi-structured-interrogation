---
name: "P1.M1.T5.S10 — AC-16 scripted test + binding green gates (rev 2)"
description: "REVISED after attempt 1: identical scope (AC-16 end-to-end scripted test in src/ac-scripted.test.ts citing FR-35; stabilize ac-scripted + regression-phantom to no-op semantics; binding green gates; zero production edits), with three corrections — (1) the count gate is EXACTLY 1258 (1257 baseline + 1 AC-16 test; phantom additive-only), never ≥1260; (2) answer.value stores the wire VALUE not the label; (3) the FR-18 confirm footer copy always uses the plural noun and theme-wraps ⚠ separately (assert 'accent:⚠' + 'Invalidates 1 answered questions (q4)'). Attempt 1 already delivered the full changeset green — a fresh implementer should VERIFY-FIRST against this PRP and only fill genuine gaps."
---

## Goal

**Feature Goal**: The answer-pinning changeset (ANSWER-PIN-001 / FR-35, spec M9) gets its acceptance evidence: AC-16 exists as an end-to-end scripted test driving the real panel action paths, the two root-level scripted suites carry no stale ★-preselect/same-value-edit residue, and every binding green gate passes with honest arithmetic.

**Deliverable**: Edited test files ONLY —
1. `src/ac-scripted.test.ts`: `describe("AC-16 — answer pinning: recorded answer owns the caret (FR-35, ANSWER-PIN-001/R7)")` with one end-to-end test (`AC-16_answer_pinning_end_to_end_noop_advance_and_ripple_guard`), an AC-16 row in the Mode A per-AC results table, the ~:770 comment flipped + discriminating assertion, the ~:728 comment relabeled.
2. `src/regression-phantom-submissions.test.ts`: one additive no-op row inside "accept + explicit ctrl+s ships exactly the one; no completion" (+ clarifier on the ~:290 comment).
Zero production-file changes.

**Success Definition** (corrected arithmetic — the v1 "≥ 1260" was internally unsatisfiable and is RETIRED):
- `npm test`: **46 files / exactly 1258 tests green** (= 1257 baseline + 1 new AC-16 test; phantom stays 4 — additive row inside an existing test). Binding invariant: the count may NEVER drop below the 1257 baseline; do NOT pad the suite with extra tests to reach any number — the blueprint's one-test + one-additive-row shape is the contract.
- `npm run typecheck` green; both guard suites green; all residual-claim greps zero hits; `git status` shows only the two test files changed (plus pre-existing plan/ artifacts).

## User Persona

**Target User**: The pi-interrogator maintainer and CI. No end-user surface changes.

**Use Case**: Every future edit to cursor seeding, accept paths, or the ripple seam is pinned by an acceptance-level test that fails loudly on regression (the live bug ANSWER-PIN-001 fixed: caret re-seeding to ★ on revisit re-proposing the recommendation).

**Pain Points Addressed**: AC list stopped at AC-15; two root-suite rows still named the superseded behavior.

## Why

- Spec h2.10 ends at "16. **Answer pinning (ANSWER-PIN-001)**…" — AC-16 must be resident in the suite for the D1 delta's acceptance evidence (tasks.json: "OUTPUT: AC-16 resident in the suite + all gates green").
- `plan/003_f8af1c6f6c49/architecture/testing-verification.md` assigns exactly this to T5.S10 (to-flip map row: "`src/ac-scripted.test.ts`, `src/regression-phantom-submissions.test.ts` | scripted flows; phantom submissions").
- Stale residue at `src/ac-scripted.test.ts:770` (`// setter re-seeds cursorIndex to the ★ preselect` on a CLOSED answered question) — under the landed contract the setter seeds the recorded answer's row; the test passed only via an explicit cursorIndex override. Per the decision ledger: "those tests were testing the bug."
- The phantom suite is the natural home for the pinning × no-phantom bridge: a same-value re-commit must never ship anything.

## What

### Prior-attempt state (attempt 1/3 — DELIVERED; verify-first)

Attempt 1 implemented this PRP's entire scope successfully; the only failure was the v1 PRP's own unsatisfiable count figure. As of this revision the working tree already contains (verified 2026-10-05: `git status` shows both test files modified; suite 46/1258 green):

- `src/ac-scripted.test.ts` — AC-16 describe block + end-to-end test (~:1095/:1115), Mode A table row (~:26), :770 flipped with `expect(panel2.cursorIndex).toBe(1)`, :728 relabeled.
- `src/regression-phantom-submissions.test.ts` — additive no-op row + :290 clarifier.

**Procedure for the fresh implementer**: run the Verification Loop below FIRST. If the tree still holds attempt 1's changeset and every gate passes with exactly 1258 tests, the task is COMPLETE — report done; change nothing. If the tree was reverted (or any gate/ assertion deviates from this PRP's corrected contract), re-implement per the Blueprint below.

### The contract under test (binding — FR-35 / ANSWER-PIN-001, spec h2.10 AC-16)

> Answer q1 with a NON-recommended option, advance, `←` back → caret + accent highlight sit on the chosen option (★ visible on its own row, caret NOT on it); `enter` advances to the next unanswered with ZERO state change (no modal, no epoch bump, no `answer.at` rewrite). A write-in answer pins the caret to the `✎ Other` row with its dim preview; a byte-identical write-in re-commit is inert. Choosing a DIFFERENT option on the answered question still raises the FR-18 confirm.

Supporting pins (`architecture/answer-pinning-contract.md` §AC-16/§FR-D9): no-op = skip ripple seam, applyAnswer (never rewrite `answer.at`), evaluateDependsOn, maybeAutoSubmit entirely — advance only; FR-18 confirm fires only on an explicit DIFFERENT choice; epoch bumps only inside buildSubmission.

### Success criteria

- [ ] AC-16 describe + end-to-end test present in `src/ac-scripted.test.ts`, citing FR-35, asserting every clause (phases A–F)
- [ ] Mode A header table carries the AC-16 row; `:770` flipped + discriminating `expect(panel2.cursorIndex).toBe(1)`; `:728` relabeled
- [ ] Phantom suite additive row present; no existing assertion deleted/skipped/weakened
- [ ] Full suite **exactly 1258** green (never < 1257; no padding); typecheck green; guards green; greps zero; zero production edits

## All Needed Context

### Context Completeness Check

An implementer who knows nothing about this repo can execute (or verify) this PRP: exact contract, every edit site by file + content + line, complete fixture and phase walkthrough with the TWO attempt-1 seam corrections already folded in, and every gate command with corrected arithmetic.

### Documentation & References

```yaml
- file: plan/003_f8af1c6f6c49/architecture/answer-pinning-contract.md
  why: binding extract of FR-D8/D9/D10 + the AC-16 scenario
- file: plan/003_f8af1c6f6c49/architecture/testing-verification.md
  why: green-gate list + to-flip map row assigning the two root suites to T5.S10
- file: plan/003_f8af1c6f6c49/P1M1T5S10/research/notes.md
  why: session research — anchors, seams, fixture derivation (rev-2 deltas in the PRP body override it)
- file: src/ac-scripted.test.ts
  why: primary target — harness (makePiHarness, tuiCtx, makeDeps, recording/identity themes, resetState beforeEach), AC-13 e2e panel-ctor precedent (~:708), stabilization sites (:728/:770), Mode A table (:16–35)
- file: src/regression-phantom-submissions.test.ts
  why: additive target — makeWalkthrough/panelOf/writeIn helpers; choiceQ values rec/alt, recommendation "rec"
- file: src/panel/actions.ts        # READ-ONLY
  why: accept (:218), AcceptOutcome (:260), acceptOptionIndex no-op branch (~:288–296, BEFORE ripple seam), writeInEnter inert byte-identical path (:349)
- file: src/panel/short-view.ts     # READ-ONLY
  why: initialCursorIndex (:127), displayOptions D-R13 (:104), optionLine accent (~:266), answerPreviewLine dim preview (:308), OTHER_AFFORDANCE (:83)
- file: src/panel/layout.ts         # READ-ONLY — ATTEMPT-1 CORRECTION SOURCE
  why: renderConfirmFooter (:144) — the plain copy ALWAYS reads "answered questions" (plural, no singular branch); theme-wraps the ⚠ separately: `${theme.fg("accent", body.slice(0,1))}${theme.fg("dim", body.slice(1))}`
- file: src/panel/ripple-confirm.ts # READ-ONLY
  why: confirmMode (:68), rippleVictims BFS (:104)
- file: src/panel/keys.ts           # READ-ONLY
  why: fixed ←/→ question navigation (~:399–410; full list, clamped)
- file: src/panel/ac-panel.test.ts  # READ-ONLY (S9's — DO NOT EDIT)
  why: AC-7 modal-assertion pattern (~:510)
```

### Current Codebase tree (scope only)

```bash
src/
├── ac-scripted.test.ts                    # AC-16 home + 2 stabilization sites + header table
├── regression-phantom-submissions.test.ts # additive no-op row
├── no-hardcoded-keys.test.ts              # gate (scans NON-test .ts only)
├── keymap-guard.test.ts                   # gate (DEFAULT_CONFIG.keys)
└── panel/                                 # S9 owns ALL *.test.ts here — DO NOT TOUCH
```

### Desired changes (no new files)

```bash
src/ac-scripted.test.ts                  # + AC-16 describe/test; +1 header row; :728 relabel; :770 flip + assertion
src/regression-phantom-submissions.test.ts # + additive no-op row; :290 clarifier
```

### Known Gotchas of our codebase & Library Quirks

```text
# CRITICAL (attempt-1 lesson 1 — GATE ARITHMETIC): the blueprint produces EXACTLY
# +1 test (AC-16) — ac-scripted 12 → 13, phantom 4 → 4 — for 1258 total. The
# "≥ 1260" figure from PRP v1 was unsatisfiable without padding and is RETIRED.
# Never add tests just to move the counter; never drop below 1257.

# CRITICAL (attempt-1 lesson 2 — VALUE vs LABEL): state stores the wire VALUE,
# not the display label. With option {value:"x", label:"Ex"}, an accepted option
# records answer.value === "x" (NOT "Ex"). Assert values, not labels.

# CRITICAL (attempt-1 lesson 3 — CONFIRM FOOTER COPY): layout.ts:144 always
# renders the plural noun — "Invalidates 1 answered questions (q4)" is CORRECT
# for one victim — and wraps the ⚠ separately; under the recording theme assert
# both pieces: contains("accent:⚠") AND contains("Invalidates 1 answered questions (q4)").

# CRITICAL: coincidental passes — every pinning assertion needs the discriminating
# fixture shape: recorded answer at a display row ≠ ★ row ≠ 0 (D-R13 recommended-first).

# CRITICAL: a dependsOn question whose dependency is UNANSWERED at upsert arrives
# MOOT; moot→open re-met happens automatically via evaluateDependsOn after every
# panel applyAnswer. Order the fixture phases dependency-first.

# GOTCHA: keep one question permanently OPEN — completeness never holds,
# maybeAutoSubmit stays silent, sendMessage must record ZERO calls across the
# whole AC-16 flow (that silence IS an assertion).

# GOTCHA: accent/dim are invisible under the identity stubTheme. Recording theme
# (text-field.test.ts:31): fg: (name, s) => `${name}:${s}`.

# GOTCHA: state is a module singleton — the suite's beforeEach resetState() is
# load-bearing. panel.dispose() at test end (footer-flash timers).

# NEVER: edit production files (red test ⇒ fixture mistake or production bug —
# in the latter case STOP and report), src/panel/*.test.ts, README.md (T6.S11),
# tasks.json; never delete/skip/weaken a test; never name a new key label.
```

## Implementation Blueprint

### Data models and structure

No new models. Fixture wire shape: `{ id, title?, prompt, type: "choice", group?, recommendation?, options: [{value, label, ramification}], dependsOn? }` — give every option the ~150-char ramification string from the AC-13 e2e fixture (caps minRamification=120); descriptions optional (never lint).

### Implementation Tasks (verify-first ordering)

```yaml
Task 0: VERIFY PRIOR ATTEMPT (do this FIRST)
  - git status --short          # expect only the two test files + pre-existing plan/ artifacts
  - grep -n "AC-16" src/ac-scripted.test.ts | head    # expect describe + test + header-table row
  - npm test                    # expect 46 files / 1258 tests green
  - IF ALL PASS per the Success Definition: DONE — report complete; no edits.
  - ELSE (reverted tree or drift): continue with Tasks 1–3.

Task 1: STABILIZE src/ac-scripted.test.ts rows
  - :770 (STALE): flip to "ANSWER-PIN-001 (FR-35): closed WITH a recorded answer —
    the setter seeds the recorded \"b\" (display row 1; rec \"a\" is ★ row 0)" and ADD
    `expect(panel2.cursorIndex).toBe(1);` BEFORE the existing `cursorIndex = 2` override.
  - :728 (accurate): relabel "unanswered path — ★ preselect survives ANSWER-PIN-001
    while no answer exists".
  - GATE: grep -n "setter re-seeds cursorIndex to the ★ preselect" src/ac-scripted.test.ts → 0 hits.

Task 2: ADD AC-16 end-to-end test to src/ac-scripted.test.ts
  - describe("AC-16 — answer pinning: recorded answer owns the caret (FR-35, ANSWER-PIN-001/R7)")
    / test("AC-16_answer_pinning_end_to_end_noop_advance_and_ripple_guard")
  - PLACEMENT: after the AC-15 block. HEADER TABLE row: | AC-16| PASS | FR-35 | <test name> |
  - FIXTURE + PHASES A–F below. RUN: npx vitest run src/ac-scripted.test.ts — 12 → 13.

Task 3: ADD phantom-suite no-op row (+ :290 clarifier " (unanswered — FR-35)")
  - RUN: npx vitest run src/regression-phantom-submissions.test.ts — stays 4.

Task 4: GATES (Verification Loop) — all green at EXACTLY 1258.
```

### AC-16 fixture (exact)

```ts
// Via the REAL executor (executeInterrogate, tuiCtx(), DEFAULT_CONFIG, epoch 1):
// q1  choice [a=Alpha, b=Beta], recommendation "a" — PIN TARGET, answered "b" (NON-rec)
//     → D-R13 rows: 0=Alpha(★), 1=Beta, 2=✎ Other. Recorded "b" owns row 1.
// q2  choice [x=Ex, y=Why], recommendation "x"   — WRITE-IN TARGET (custom pins ✎ row 2)
// q3  choice [a=Alpha, b=Beta], NO recommendation — PERMANENTLY OPEN blocker
// q4  choice [x=Ex, y=Why], dependsOn [{id:"q1", equals:"b"}] — FR-18 VICTIM;
//     arrives moot (q1 unanswered), re-mets open after q1="b", answered (value "x") in phase B.
//
// ONE panel, RECORDING theme: fg: (name, s) => `${name}:${s}`, bold identity.
// makeDeps() → { deps: { sendMessage, isIdle: () => true }, sendMessage } (arms the
// auto-submit tail). delivery: deps on the ctor (AC-13 e2e convention ~:708).
// Keys: LEFT "\u001b[D", ENTER "\r", ESCAPE "\u001b". panel.dispose() at end.
```

### AC-16 walkthrough (phases — with attempt-1 corrections folded in)

```ts
// PHASE A — answer q1 with the NON-recommended option:
panel.currentId = "q1";                    // unanswered → seeds ★ row 0
expect(panel.cursorIndex).toBe(0);
panel.cursorIndex = 1;                     // Beta
expect(accept(panel)).toBe(true);
expect(state.getQuestion("q1")!.answer!.value).toBe("b");   // WIRE VALUE, not label
expect(state.getQuestion("q4")!.status).toBe("open");       // re-met (was moot)
expect(panel.currentId).toBe("q2");                        // advance
expect(sendMessage).toHaveBeenCalledTimes(0);

// PHASE B — establish the ripple victim (travel however: currentId or arrows):
panel.currentId = "q4";
expect(accept(panel)).toBe(true);          // cursorIndex 0; no recommendation
expect(state.getQuestion("q4")!.answer!.value).toBe("x");  // VALUE "x" — NOT "Ex"

// PHASE C — ← back to q1: recorded answer owns the caret (AC CORE):
panel.currentId = "q1";                    // (or real handleInput(LEFT) presses — clamped)
expect(panel.cursorIndex).toBe(1);         // caret on recorded "b" — NOT ★ row 0
panel.invalidate();
const lines = panel.render(120);
expect(lines.find((l) => l.includes("Beta"))!).toContain("▸");          // caret prefix
expect(lines.find((l) => l.includes("Beta"))!).toContain("accent:Beta"); // accent (recording theme)
const alphaRow = lines.find((l) => l.includes("Alpha"))!;
expect(alphaRow).toContain("★");           // ★ visible on its own row…
expect(alphaRow).not.toContain("▸");       // …caret NOT on it

// PHASE D — enter on the recorded value: ZERO state change, advance only:
const before = JSON.stringify(state.serialize());
const atBefore = state.getQuestion("q1")!.answer!.at;
expect(panel.handleInput(ENTER)).toBe(true);
expect(panel.currentId).toBe("q2");
expect(panel.confirmMode).toBeNull();
expect(JSON.stringify(state.serialize())).toBe(before);
expect(state.getQuestion("q1")!.answer!.at).toBe(atBefore);
expect(state.epoch).toBe(1);
expect(sendMessage).toHaveBeenCalledTimes(0);

// PHASE E1 — write-in commits; ✎ row pinned with dim preview on revisit:
panel.cursorIndex = 2;                     // ✎ Other row
expect(accept(panel)).toBe(true);
expect(panel.focus).toBe("text");
expect(panel.textDuty).toBe("writein");
panel.textField.setText("hand-written answer");
expect(panel.handleInput(ENTER)).toBe(true);
expect(state.getQuestion("q2")!.answer).toMatchObject({ value: "hand-written answer", custom: true });
panel.handleInput(LEFT);                   // advance went to q3; ← back
expect(panel.currentId).toBe("q2");
expect(panel.cursorIndex).toBe(2);         // custom answer pins ✎ row (★ "Ex" is row 0)
panel.invalidate();
const q2Lines = panel.render(120);
expect(q2Lines.some((l) => l.includes("✎ Other"))).toBe(true);
expect(q2Lines.some((l) => l.includes("dim:") && l.includes("hand-written answer"))).toBe(true);

// PHASE E2 — byte-identical write-in re-commit is inert:
const beforeE2 = JSON.stringify(state.serialize());
expect(accept(panel)).toBe(true);
panel.textField.setText("hand-written answer");
expect(panel.handleInput(ENTER)).toBe(true);
expect(panel.currentId).toBe("q3");
expect(JSON.stringify(state.serialize())).toBe(beforeE2);
expect(sendMessage).toHaveBeenCalledTimes(0);

// PHASE F — DIFFERENT choice still raises the FR-18 confirm:
panel.currentId = "q1";
expect(panel.cursorIndex).toBe(1);         // seeds recorded "b"
panel.cursorIndex = 0;                     // ★ Alpha — explicit different choice
panel.handleInput(ENTER);
expect(panel.confirmMode).not.toBeNull();
expect(panel.confirmMode?.kind).toBe("choice");
expect(panel.confirmMode?.victims).toEqual(["q4"]);
panel.invalidate();
const confirmFooter = panel.render(120).at(-1)!;
// ATTEMPT-1 CORRECTION (layout.ts:144): ⚠ is accent-wrapped SEPARATELY; the copy
// ALWAYS uses the plural noun — "1 answered questions" is the real rendering:
expect(confirmFooter).toContain("accent:⚠");
expect(confirmFooter).toContain("Invalidates 1 answered questions (q4)");
expect(confirmFooter).toContain("enter=keep, esc=cancel");
const beforeF = JSON.stringify(state.serialize());
expect(panel.handleInput("x")).toBe(true);               // modal consumes stray keys
expect(panel.handleInput(ESCAPE)).toBe(true);            // cancel
expect(panel.confirmMode).toBeNull();
expect(JSON.stringify(state.serialize())).toBe(beforeF);
expect(panel.cursorIndex).toBe(1);                      // restored to recorded answer
panel.cursorIndex = 0;
panel.handleInput(ENTER);                                // modal again
panel.handleInput(ENTER);                                // keep — applied exactly once
expect(state.getQuestion("q1")!.answer!.value).toBe("a");
expect(state.getQuestion("q4")!.status).toBe("moot");    // instant-local moot
expect(state.getQuestion("q4")!.answer?.value).toBe("x");// answer KEPT
expect(state.epoch).toBe(1);
expect(sendMessage).toHaveBeenCalledTimes(0);            // q3 open blocks completeness
panel.dispose();
```

Travel legs between phases may use real arrow presses or direct `panel.currentId = id` (AC-13 e2e precedent); the AC-verbatim ← leg inside phases C/D/E1 and the seeding assertions are the core.

### Additive phantom-suite row (exact)

```ts
// Inside "accept + explicit ctrl+s ships exactly the one; no completion", after the
// existing completions assertion. State: cancel-trigger CLOSED with "alt" (non-rec;
// D-R13 rows: 0=rec(★), 1=alt), epoch 2, sendMessage called exactly once.
const atBefore = getState()!.getQuestion("cancel-trigger")!.answer!.at;
const callsBefore = h.sendMessage.mock.calls.length;
const revisit = panelOf();
revisit.currentId = "cancel-trigger";
expect(revisit.cursorIndex).toBe(1);       // recorded "alt" owns the caret — NOT ★ row 0
expect(revisit.handleInput(ENTER)).toBe(true);   // same-value on closed: inert
expect(revisit.currentId).toBe("cancel-semantics"); // no-op advance (next unanswered)
expect(h.sendMessage.mock.calls.length).toBe(callsBefore); // no phantom submission
expect(getState()!.epoch).toBe(2);
expect(getState()!.getQuestion("cancel-trigger")!.answer!.at).toBe(atBefore);
revisit.dispose();
```

### Integration Points

```yaml
NONE — test-only changeset. No config, schema, production module, or keymap surface.
```

## Verification Loop (run Task 0's checks in order; re-run after any edit)

### Level 1: Syntax & Type

```bash
npm run typecheck
npx vitest run src/ac-scripted.test.ts src/regression-phantom-submissions.test.ts
# Expected: green. Counts: ac-scripted 13; phantom 4.
```

### Level 2: Targeted

```bash
npx vitest run src/ac-scripted.test.ts -t "AC-16"
# A red AC-16 test means fixture/seam drift — reread the cited seam lines before
# changing assertions. A red test implying a PRODUCTION bug: STOP and report.
```

### Level 3: Full Binding Gates

```bash
npm test                    # 46 files / EXACTLY 1258 tests green (never < 1257; no padding)
npm run typecheck
npx vitest run src/no-hardcoded-keys.test.ts src/keymap-guard.test.ts

grep -rn "cursor_resets_to_star" src/                                   # 0 hits (S9's gate)
grep -n "setter re-seeds cursorIndex to the ★ preselect" src/ac-scripted.test.ts  # 0 hits
grep -rn "re-seeds the cursor to the ★" src/panel/*.test.ts            # 0 hits

git status --short          # only the two test files (+ pre-existing plan/ artifacts)
```

### Level 4: Contract Review

```bash
# Confirm each AC-16 clause maps to an assertion: (1) non-rec answer + ← back +
# caret/accent on chosen row; (2) ★ visible, caret NOT on it; (3) enter advances with
# zero state change (serialize + epoch + answer.at + confirmMode + sendMessage);
# (4) write-in pins ✎ row + dim preview; (5) byte-identical write-in inert;
# (6) different choice → FR-18 modal, esc byte-identical, enter applies once.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm test`: 46 files / **exactly 1258** green (binding floor 1257; no counter padding)
- [ ] `npm run typecheck` green; both guard suites green
- [ ] All three grep sweeps zero hits; `git status` shows only the two test files

### Feature Validation

- [ ] AC-16 describe/test present citing FR-35; every clause asserted (phases A–F)
- [ ] Mode A table row; `:770` flip + discriminating assertion; `:728` relabel
- [ ] Phantom additive row; no existing assertion deleted/skipped/weakened
- [ ] Attempt-1 seam corrections honored: value-not-label asserts; plural-noun + `accent:⚠` footer asserts

### Code Quality Validation

- [ ] `AC-16_<snake>` naming; comments cite FR/decision ids; discriminating fixtures throughout
- [ ] Recording-theme convention reused; no new key labels; no hardcoded user-visible key strings

### Documentation & Deployment

- [ ] None — README is T6.S11's deliverable; do not touch

## Anti-Patterns to Avoid

- ❌ Don't add tests to move a counter — the count gate is exactly 1258, and the v1 "≥ 1260" figure is retired as unsatisfiable
- ❌ Don't re-run implementation on an already-green tree — Task 0 verify-first; if all gates pass, report complete
- ❌ Don't "fix" production code for a red test — fixture mistake or STOP-and-report
- ❌ Don't assert labels where state stores values (`"x"`, not `"Ex"`)
- ❌ Don't singularize the confirm-footer noun — layout.ts:144 has no singular branch
- ❌ Don't edit `src/panel/*.test.ts`, README.md, or tasks.json; never weaken a test

---

**Confidence Score: 10/10** — the entire changeset was already implemented and verified green in attempt 1 (46/1258, typecheck, guards, greps); this revision only corrects the PRP's own arithmetic (1258) and folds in the two verified seam corrections. A fresh implementer either confirms the green tree (Task 0) or re-applies a blueprint whose every assertion has already passed once against the real code.

---
name: "P1.M1.T5.S10 — AC-16 scripted test + binding green gates"
description: "Add the AC-16 end-to-end scripted test (ANSWER-PIN-001 / FR-35, cited) to src/ac-scripted.test.ts and stabilize src/ac-scripted.test.ts + src/regression-phantom-submissions.test.ts to the no-op semantics (one stale comment/assertion site at :770; one additive no-op row in the phantom suite). Binding gates: npm test full-suite green, npm run typecheck green, src/no-hardcoded-keys.test.ts + src/keymap-guard.test.ts green, ZERO new key labels, zero production edits. This task's output IS the delta's acceptance evidence: AC-16 resident in the suite with every gate green."
---

## Goal

**Feature Goal**: Make acceptance criterion AC-16 (spec h2.10 §16, FR-35 / ANSWER-PIN-001) resident in the scripted acceptance suite as an end-to-end test driving the REAL production paths (executor upsert → `InterrogationPanel` → `accept`/`handleInput` seams), and bring the two suites named by the task contract — `src/ac-scripted.test.ts` and `src/regression-phantom-submissions.test.ts` — fully onto the landed no-op semantics so the whole delta ships with every binding gate green.

**Deliverable**:
1. New `describe("AC-16 — answer pinning …")` block in `src/ac-scripted.test.ts` covering the full §AC-16 scenario (verbatim from `plan/003_f8af1c6f6c49/architecture/answer-pinning-contract.md`): answer q1 with a NON-recommended option → advance → `←` back → caret + accent highlight on the chosen option (★ visible on its own row, caret NOT on it); `enter` advances to the next unanswered with ZERO state change (no modal, no epoch bump, no `answer.at` rewrite); write-in pins the `✎ Other` row with dim preview; byte-identical write-in re-commit inert; a DIFFERENT choice still raises the FR-18 confirm.
2. Stabilization edits: flip the stale ★-preselect comment/assertion site at `src/ac-scripted.test.ts:770` (q1 carries a recorded answer there — the setter seeds the RECORDED row under FR-35, never the ★) and relabel the accurate-but-ambiguous `:728` site (unanswered case); add the AC-16 row to the file's Mode A per-AC results table.
3. One additive no-op row in `src/regression-phantom-submissions.test.ts` pinning "no phantom submissions from no-op paths" (reopen → caret seeds the recorded row, `enter` ships nothing, epoch/`answer.at` frozen), plus an audit pass of that suite per the flip decision rule (expected: zero behavioral flips — verified in research).
4. Pipeline status flip `P1.M1.T5.S10` → `"Complete"` in `plan/003_f8af1c6f6c49/tasks.json` (note: the PRP directory is `P1M1T5S2`; the tasks.json id is `P1.M1.T5.S10` — locate by title "AC-16 scripted test + binding green gates").

**Success Definition**: `npm test` (full suite) green including the new AC-16 test; `npm run typecheck` clean; `npx vitest run src/no-hardcoded-keys.test.ts src/keymap-guard.test.ts` green; zero new key labels (zero config/keys edits — test-only diff); `git diff --stat` touches ONLY `src/ac-scripted.test.ts`, `src/regression-phantom-submissions.test.ts`, and `plan/003_f8af1c6f6c49/tasks.json`.

## User Persona (if applicable)

**Target User**: The maintaining agent / human auditor proving the ANSWER-PIN-001 delta (spec M9) is done — AC-16 is the acceptance evidence for the whole milestone.

**Use Case**: CI or a reviewer runs `npm test`: the AC-16 scripted test proves end-to-end (through the real tool executor, panel class, accept paths, write-in path, and ripple seam) that a recorded answer owns the cursor, same-value commits are inert, and only a DIFFERENT choice raises the FR-18 modal — with no phantom submissions from any no-op path.

**User Journey**: Answer a question with a non-recommended option → navigate away and back → the answer (not the ★) owns the caret → `enter` on it just advances, changing nothing → write-ins pin the `✎` row → re-committing identical text does nothing → changing the answer the hard way (different row) still gets the FR-18 safety confirm.

**Pain Points Addressed**: Pre-ANSWER-PIN-001, revisiting an answered question re-proposed the ★ recommendation (displacing the user's recorded work) and same-value commits rewrote `answer.at`/rippled/auto-submitted. AC-16 is the scripted proof those days are gone.

## Why

- Spec h2.10 AC-16 is the acceptance criterion for FR-35 (h3.5); `architecture/testing-verification.md` §Green-gates names the binding gates and assigns "AC-16 end-to-end in T5.S10" plus ownership of `src/ac-scripted.test.ts` and `src/regression-phantom-submissions.test.ts` to this subtask.
- All input contracts have landed (plan status): pin seeding (T1.S1/T1.S2, commit 1fba337), tool-schema string (T1.S3), inert no-ops on accept/write-in/deep paths (T2.S4/S5/S6, commits d6d1553/2d7a98f/4a9d277), ★ answered marker (T3.S7, commit 7972f88), comment purge (T4.S8, commit f3e00c5). The parallel task T5.S9 (PRP at `plan/003_f8af1c6f6c49/P1M1T5S1/PRP.md`) flips the remaining `src/panel/*.test.ts` rows and is the precondition for the full-suite gate — its contract states T5.S10 runs `npm test` over the FULL suite including these two files.
- This task is test-only: the production code already implements the contract (the panel suite is 630/630 green at the T5.S9 baseline). Any red that implies a production defect is a STOP-and-report, not a test-side workaround.

## What

### New AC-16 test (the core deliverable)

An end-to-end scripted test in `src/ac-scripted.test.ts`, following the file's established harness (`makePiHarness`, `wireLifecycle` only if needed, `executeInterrogate` upsert, `InterrogationPanel` on the singleton state, `makeSubmitDeps`-style delivery, `stubTheme`) — see the AC-13 e2e block (:665-815) as the structural template. The scenario (fixture + phases detailed in the Implementation Blueprint):

- **Fixture**: q1 choice [a,b] with `recommendation: "a"` (the pin target); q2 choice [x,y] with `recommendation: "x"` (the write-in target — its ★ row makes the `✎`-row pin discriminating); q3 choice, never answered (the completeness blocker that keeps auto-submit silent for the whole test); q4 choice [x,y] with `dependsOn: [{id: "q1", equals: "b"}]`, answered early via the panel (the FR-18 ripple victim).
- **Phase 1 — non-recommended answer**: enter q1 (unanswered → seeds ★ row 0), move to row 1 ("b"), `accept` → committed `answer: {value: "b"}`; auto-advance lands on the next unanswered; epoch unchanged; nothing shipped.
- **Phase 2 — ← back pins the recorded row**: `←` returns to q1; caret sits on display row 1 (the recorded "b"), ★ "a" remains visible on row 0 — caret NOT on it.
- **Phase 3 — enter is a state no-op that advances**: `enter` on the recorded row advances to the next unanswered with ZERO state change: epoch frozen, `answer.at` byte-identical, `confirmMode === null` (no FR-18 modal), no `sendMessage` call, answer value/status untouched.
- **Phase 4 — write-in pin**: commit a write-in on q2 via the real `✎ Other` path; `←` back → caret seeds the `✎ Other` row (display row `options.length`, NOT ★ row 0) and the row's dim preview shows the written text.
- **Phase 5 — byte-identical re-commit inert**: re-enter the identical write-in text → advance only: `answer.at` frozen, epoch frozen, no modal, nothing shipped.
- **Phase 6 — different choice still confirms (FR-18)**: on answered q1, move the caret to row 0 ("a" ≠ recorded "b") and `enter` → the ripple-confirm modal appears (q4 invalidates); nothing applied yet; `esc` cancels with zero state change; re-raise and `enter`=keep → applied: q1 records "a", q4 mootered instantly (FR-17), still zero submissions (q3 open).
- **Closing assertion**: `sendMessage` was NEVER called — the whole AC-16 flow, including both no-op paths, ships nothing ("no phantom submissions from no-op paths").

### Stabilization edits (no-op semantics)

- `src/ac-scripted.test.ts:770` — stale: flip the comment AND add the discriminating seed assertion (details below).
- `src/ac-scripted.test.ts:728` — accurate (target unanswered): relabel the comment to name the unanswered case.
- `src/ac-scripted.test.ts` header (:16-35) — add the AC-16 row to the Mode A per-AC results table.
- `src/regression-phantom-submissions.test.ts` — one additive no-op row in "regression: one genuine answer fabricates nothing" (details below); audit the remaining rows per the flip decision rule (an assertion/comment credits ★ preselect (or a same-value side effect) at a moment the target question carries an `answer` → flip to the recorded-answer contract; unanswered target → accurate, leave). Research verdict: every existing row targets an unanswered question at its assertion moment or sets `cursorIndex` explicitly — expected ZERO behavioral flips; record the audit outcome in the commit message.

### Success Criteria

- [ ] AC-16 test present, green, and cited (FR-35 / ANSWER-PIN-001 / AC-16 in the describe title and comments)
- [ ] Caret-on-recorded-row asserted for: option answer (row 1 with ★ on row 0), write-in answer (`✎` row with ★ on row 0)
- [ ] No-op `enter` asserted inert: advance happened, epoch frozen, `answer.at` byte-identical, `confirmMode === null`, zero submissions
- [ ] Byte-identical write-in re-commit asserted inert (advance only, `answer.at` frozen)
- [ ] Different choice raises FR-18 modal; `esc` cancels with no state change; `enter`=keep applies + mootered victim
- [ ] :770 flipped with seed assertion; :728 relabeled; Mode A table carries the AC-16 row
- [ ] Phantom suite: no-op row added; audit recorded; suite green
- [ ] `npm test` full suite green; `npm run typecheck` clean; both guard suites green; zero new key labels; diff walls hold

## All Needed Context

### Context Completeness Check

This PRP carries the verified production-seam map (exact function signatures, the no-op branch order, the modal field, the write-in commit path, raw key sequences, epoch/`answer.at` bump rules, auto-submit silencing strategy), the row-by-row stale/accurate audit of both suites with current anchors, the discriminating-fixture design, and the binding gates. An implementer needs only the two test files, the production seams named below, and this document.

### Documentation & References

```yaml
- file: plan/003_f8af1c6f6c49/architecture/answer-pinning-contract.md
  why: "the AC-16 scenario verbatim + FR-D8/D9/D10 contract (seeding rules, inert no-ops, modal-only-on-different)"
  section: "AC-16 (acceptance, scripted)"

- file: plan/003_f8af1c6f6c49/architecture/testing-verification.md
  why: "BINDING: green gates for the whole delta + the to-flip map row assigning both suites to T5.S10"
  section: "Policy / Green gates / To-flip map"

- file: plan/003_f8af1c6f6c49/P1M1T5S2/research/findings.md
  why: "verified seam map + stale-row audit + fixture design (all anchors checked at HEAD f3e00c5)"

- file: src/ac-scripted.test.ts
  why: "PRIMARY TARGET: new AC-16 describe; :728/:770 comment sites; :16-35 Mode A table; AND the structural template — the AC-13 e2e block (:665-815) shows the harness: makePiHarness/makeSubmitDeps, InterrogationPanel ctor, accept() import, textField.setText, handleInput(\"\\r\"), stubTheme, renderLines"
  pattern: "one describe per AC, header table row, real-path driving (executeInterrogate + InterrogationPanel on the singleton)"
  gotcha: "state is a MODULE SINGLETON — beforeEach resetState() already present (:239-241); no panel is ever opened via maybeAutoOpen — construct InterrogationPanel directly"

- file: src/regression-phantom-submissions.test.ts
  why: "SECONDARY TARGET: additive no-op row in 'one genuine answer' (:277-324); audit the rest; ALSO the constant convention (DOWN/ENTER/CTRL_S at :28-30) to mirror for LEFT/ESC"
  gotcha: "writeIn helper (:174-181) sets cursorIndex explicitly — immune to seeding; after the ctrl+s submission the epoch is 2 (buildSubmission bumped once)"

- file: src/panel/actions.ts
  why: "READ-ONLY seam reference: AcceptOutcome (:260), the no-op branch (~:288-296, BEFORE the ripple seam), confirmRippleEdit call (~:303), advanceAfterAccept"
  gotcha: "accept(panel) coerces outcome !== false → boolean true — assert toBe(true), never toBe(\"noop\") at the handleInput/accept level"

- file: src/panel/panel.ts
  why: "READ-ONLY: confirmMode field (~:507, RippleConfirmState | null — THE no-modal assertion), public settable cursorIndex, focus/textDuty/textField fields used by the write-in path"
  gotcha: "confirmMode non-null ⇒ handleInput is MODAL (enter=keep, esc=cancel) — esc inside the modal never suspends the panel"

- file: src/panel/keys.ts
  why: "READ-ONLY: fixed ←/→ route to prevQuestion/nextQuestion (~:404); enter/digit routing into accept"
  gotcha: "raw sequences only in TEST files — no-hardcoded-keys scans non-test .ts exclusively"

- file: src/panel/short-view.test.ts
  why: "the landed FR-35 unit pattern (:79-135): initialCursorIndex pin rows incl. the write-in ✎-row and clamp rows — comment voice + AT timestamp constant style to mirror"

- file: plan/003_f8af1c6f6c49/P1M1T5S1/PRP.md
  why: "the PARALLEL task's contract (T5.S9): owns ALL src/panel/*.test.ts flips; its gate greps must not regress (cursor_resets_to_star stays 0-hit); its landing is the full-suite precondition"
  gotcha: "never edit src/panel/*.test.ts in this task — even a comment you think is stale there belongs to T5.S9; report, don't touch"

- url: spec/product-requirements.md (h3.5 FR-35; h2.10 AC-16; in-repo spec/)
  why: "the authoritative wording the test cites"
```

### Current Codebase tree (relevant slice)

```bash
src/
├── ac-scripted.test.ts                    # EDIT: +AC-16 describe, :728/:770, :16-35 table row
├── regression-phantom-submissions.test.ts # EDIT: +no-op row, audit
├── no-hardcoded-keys.test.ts              # GATE (run; scans non-test .ts only)
├── keymap-guard.test.ts                   # GATE (run; asserts DEFAULT_CONFIG.keys)
├── panel/
│   ├── actions.ts                         # READ-ONLY seam (acceptOptionIndex/AcceptOutcome)
│   ├── panel.ts                           # READ-ONLY seam (confirmMode/cursorIndex/textField)
│   └── *.test.ts                          # T5.S9's — NEVER touch
plan/003_f8af1c6f6c49/tasks.json           # EDIT: P1.M1.T5.S10 → Complete
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# No new files. Edits only:
# src/ac-scripted.test.ts — AC-16 describe (end-to-end pinning proof) + stabilization + table row
# src/regression-phantom-submissions.test.ts — no-op-path phantom row + audit
# plan/003_f8af1c6f6c49/tasks.json — status flip
```

### Known Gotchas of our codebase & Library Quirks

```text
# CRITICAL — the coincidence trap: in fixtures where the recommendation is "a"
# and the answer is also "a", row 0 is BOTH the ★ row and the recorded row —
# toBe(0) passes under both contracts. AC-16's fixture deliberately answers
# "b" on q1 and write-ins on q2 (which has its own ★ "x" on row 0) so every
# pin assertion DISCRIMINATES (row 1 / ✎ row ≠ ★ row 0).

# CRITICAL — auto-submit must stay silent: answer the LAST open/reasked
# question and maybeAutoSubmit fires a REAL submission (epoch bump, sendMessage,
# post-submit panel exit — FR-3d). q3 NEVER gets answered in AC-16, so
# completeness never holds and sendMessage must have ZERO calls at test end.

# CRITICAL — epoch semantics: epoch bumps ONLY inside buildSubmission (a
# submission). Commits, edits, no-ops, mooting, the close pass: all epoch-frozen.
# Assert epoch === its pre-phase value after every non-submission step.

# CRITICAL — answer.at: applyAnswer stamps new Date().toISOString() on every
# REAL commit; the no-op paths skip applyAnswer entirely. Capture at-strings
# and assert toBe() identity across no-op phases; assert the CHANGED at only
# after the FR-18 keep-apply (a real edit).

# GOTCHA — accept(panel) returns a COERCED boolean; the raw "noop"/"veto"/
# "accept" strings live one level down in acceptOptionIndex. At the
# handleInput/accept level assert toBe(true); the no-op is proven by STATE
# (advance + frozen at/epoch + confirmMode null), not by the return string.

# GOTCHA — write-in path (AC-13 e2e pattern): cursor to options.length (the
# ✎ row), accept(panel) → true → panel.focus === "text" && panel.textDuty ===
# "writein" → panel.textField.setText(text) → panel.handleInput("\r") commits.

# GOTCHA — the FR-18 leg needs q1 status "answered" (not open) when the
# different choice is proposed: the seam fires only for answered/submitted
# questions (actions.ts ~:302). Answer q1 in Phase 1, edit it in Phase 6.

# GOTCHA — line anchors in this PRP are exact at HEAD f3e00c5; T5.S9 lands in
# parallel (panel test files only) — your two files should be untouched by it,
# but LOCATE BY CONTENT regardless ("setter re-seeds cursorIndex to the ★
# preselect", "seeds to ★ recommended").

# GOTCHA — the phantom suite's fakeEditor/editorFactory is NOT wired in the
# AC-13 e2e panel; the e2e write-in uses panel.textField directly. Reuse the
# e2e pattern in AC-16 (textField.setText), not the phantom writeIn helper.

# GOTCHA — escape sequences: LEFT "\u001b[D", ESC "\u001b", ENTER "\r" —
# define named constants beside the existing DOWN/ENTER/CTRL_S convention.
```

## Implementation Blueprint

### Data models and structure

No runtime data changes. The only "model" is the AC-16 fixture and the zero-state-change evidence triple captured per phase: `epochBefore`, `atBefore = state.getQuestion(id)!.answer!.at`, `sendBefore = sendMessage.mock.calls.length` — asserted identical after every no-op, plus `panel.confirmMode === null`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/ac-scripted.test.ts — Mode A table + key constants
  - ADD table row (after the AC-15 row, :16-35):
      | AC-16| PASS | FR-35 | AC-16_answer_pinning_recorded_answer_owns_cursor |
  - ADD constants near the imports/fixtures (mirror the phantom suite convention):
      const LEFT = "\u001b[D"; const ESC = "\u001b"; // ENTER stays "\r" inline (file convention)

Task 2: CREATE the AC-16 describe in src/ac-scripted.test.ts (after the AC-15 block, ~:1007-1062)
  - STRUCTURE: follow the AC-13 e2e block (:665-815) — local makeSubmitDeps-style
    delivery { sendMessage, isIdle: () => true }, InterrogationPanel on the
    singleton via the e2e ctor { tui: { requestRender: vi.fn() }, theme: stubTheme,
    done: () => {}, state, config: DEFAULT_CONFIG, delivery: deps }
  - FIXTURE (executeInterrogate upsert, epoch 1, tuiCtx()):
      q1: choice [a("Alpha"), b("Beta")], recommendation "a"        // pin target
      q2: choice [x("Xylo"), y("Yield")], recommendation "x"        // write-in target (★ row 0 exists)
      q3: choice [u("Up"), d("Down")], NO recommendation            // NEVER answered (completeness blocker)
      q4: choice [x2("Keep"), y2("Drop")], dependsOn [{id:"q1", equals:"b"}]  // ripple victim
  - PHASE 0 — seed the FR-18 victim: panel.currentId = "q4"; cursorIndex = 0;
    expect(accept(panel)).toBe(true); → q4 answered "x2"; epoch 1; ZERO sendMessage
  - PHASE 1 — non-recommended answer on q1:
      panel.currentId = "q1";
      expect(panel.cursorIndex).toBe(0); // ★ row 0 — q1 UNANSWERED (FR-35 keeps ★ preselect while unanswered)
      panel.cursorIndex = 1;             // option "b" — NOT the ★ "a"
      expect(accept(panel)).toBe(true);
      ASSERT: q1.answer {value:"b"} (custom undefined); at1 = answer.at (capture);
              epoch === 1; sendMessage 0 calls; panel.currentId === "q2" (auto-advance to next unanswered)
  - PHASE 2 — ← back pins the recorded row:
      panel.handleInput(LEFT) → consumed; panel.currentId === "q1";
      expect(panel.cursorIndex).toBe(1); // the RECORDED "b" owns display row 1 —
                                         // ★ "a" stays visible on row 0, caret NOT on it (FR-35)
  - PHASE 3 — enter on the recorded value is a NO-OP that advances:
      panel.handleInput("\r") → true;
      ASSERT: panel.currentId === "q2" (advanced to next unanswered);
              state.epoch === 1 (no bump); q1.answer.at === at1 (byte-identical);
              panel.confirmMode === null (no FR-18 modal);
              q1.answer.value === "b" && q1.status === "answered" (no re-proposal);
              sendMessage 0 calls (no submission from a no-op path)
  - PHASE 4 — write-in pins the ✎ row with dim preview:
      panel.currentId = "q2";           // unanswered → seeds ★ row 0
      panel.cursorIndex = 2;            // the ✎ Other row (options.length)
      expect(accept(panel)).toBe(true); // opens the write-in editor
      ASSERT panel.focus === "text" && panel.textDuty === "writein";
      panel.textField.setText("my own take");
      panel.handleInput("\r");          // commits the write-in
      ASSERT: q2.answer {value:"my own take", custom: true}; at2 captured; epoch 1; 0 submissions;
              panel.currentId === "q3" (next unanswered)
      panel.handleInput(LEFT); panel.handleInput(LEFT);  // back to q2 via R1 nav
      ASSERT panel.currentId === "q2" && panel.cursorIndex === 2; // ✎ row seeded — NOT ★ row 0
      ASSERT dim preview: the current view's rendered lines contain "my own take"
      (render via the panel's component render(width) surface — grep src/panel/panel.test.ts
       for the `.render(` convention and mirror it; wide width → no wrap)
  - PHASE 5 — byte-identical write-in re-commit is INERT:
      panel.handleInput("\r");          // caret already on ✎ row → editor opens
      panel.textField.setText("my own take");  // BYTE-IDENTICAL
      panel.handleInput("\r");
      ASSERT: panel.currentId === "q3" (advance only);
              q2.answer.at === at2 (frozen); q2.answer.value === "my own take"; custom === true;
              epoch === 1; panel.confirmMode === null; sendMessage 0 calls
  - PHASE 6 — a DIFFERENT choice still raises the FR-18 confirm:
      panel.handleInput(LEFT);          // q3 → q2
      panel.handleInput(LEFT);          // q2 → q1 (seeds recorded row 1)
      expect(panel.cursorIndex).toBe(1);
      panel.cursorIndex = 0;            // EXPLICIT different choice: "a" ≠ recorded "b"
      panel.handleInput("\r");
      ASSERT panel.confirmMode !== null;            // the FR-18 modal is up (victim: q4)
      ASSERT nothing applied: q1.answer.value === "b"; epoch === 1; at === at1
      panel.handleInput(ESC);           // cancel
      ASSERT panel.confirmMode === null && q1.answer.value === "b" && q2/q4 untouched
      panel.cursorIndex = 0; panel.handleInput("\r");   // re-raise the modal
      panel.handleInput("\r");          // enter = keep
      ASSERT applied: q1.answer.value === "a" (fresh at — a REAL edit); q4.status === "moot";
              epoch === 1 (still no submission — q3 open); panel advanced
  - CLOSING: expect(depsSendMessage).not.toHaveBeenCalled(); // ZERO submissions from the whole flow,
                                                            // no-op paths included (phantom guarantee)
  - panel.dispose() at test end (footer timers — AC-13 e2e convention)

Task 3: FLIP the stale site src/ac-scripted.test.ts:770 (+ relabel :728)
  - :770 (AC-13 e2e, archived-edit step — q1 CLOSED with recorded "b"):
      OLD: panel2.currentId = "q1"; // setter re-seeds cursorIndex to the ★ preselect
      NEW: panel2.currentId = "q1"; // setter seeds the RECORDED "b" display row 1 (FR-35 — ★ "a" never owns the caret post-answer)
      ADD immediately after: expect(panel2.cursorIndex).toBe(1); // recorded-answer seed, not ★
  - :728 (same test, FIRST answer — q1 unanswered there): comment-only relabel
      NEW: … // setter seeds ★ row 0 — q1 UNANSWERED at this first answer (FR-35)
  - PRESERVE every assertion around both sites (the AC-13 e2e contracts own them)

Task 4: ADD the no-op row in src/regression-phantom-submissions.test.ts
  - IN "regression: one genuine answer fabricates nothing" (:277-324), after the
    settle + statuses assertion:
      const panel2 = panelOf();                       // reopen model (production: /interrogate | reopen:true)
      panel2.currentId = "cancel-trigger";            // CLOSED with recorded "alt"
      expect(panel2.cursorIndex).toBe(1);             // RECORDED "alt" row 1 — ★ "rec" stays row 0;
                                                      //   a phantom re-proposal would sit row 0
      const sendCount = h.sendMessage.mock.calls.length;   // post-ctrl+s baseline
      const epochBefore = getState()!.epoch;          // 2 (the one real submission bumped it)
      const atBefore = getState()!.getQuestion("cancel-trigger")!.answer!.at;
      panel2.handleInput(ENTER);                      // enter on the recorded value
      ASSERT: h.sendMessage.mock.calls.length === sendCount;   // no phantom submission from the no-op path
              getState()!.epoch === epochBefore;
              getState()!.getQuestion("cancel-trigger")!.answer!.at === atBefore;  // no rewrite
              panel2.currentId === next-unanswered id (advance did run)
  - AUDIT the remaining rows per the flip decision rule (answered target at the
    assertion moment ⇒ flip; research verdict: all rows target unanswered questions
    or set cursorIndex explicitly — expected zero flips). Optional clarifier on :290:
    "// seeds to ★ recommended (unanswered — FR-35 keeps ★ preselect)". Record the
    audit outcome in the commit message.

Task 5: FLIP plan/003_f8af1c6f6c49/tasks.json
  - P1.M1.T5.S10 ("AC-16 scripted test + binding green gates") status → "Complete"
    (ONLY that field; enum literal "Complete" — verified against neighbors)

Task 6: RUN the binding gates + greps (Validation Loop below); paste outputs into
    the commit message body — this task's OUTPUT is the acceptance evidence
```

### Implementation Patterns & Key Details

```typescript
// PATTERN — the zero-state-change evidence triple (assert after EVERY no-op):
expect(state.epoch).toBe(epochBefore);                       // submissions are the ONLY epoch writers
expect(state.getQuestion("q1")!.answer!.at).toBe(atBefore);  // no-ops skip applyAnswer entirely
expect(panel.confirmMode).toBeNull();                        // no FR-18 modal from a same-value path
expect(sendMessage).not.toHaveBeenCalled();                  // no phantom submission from any path

// PATTERN — discriminating pin assertion (never the coincidence row):
// q1 rec "a" → D-R13 rows: 0=a(★), 1=b, 2=✎ Other. Recorded "b" ⇒ expect(cursorIndex).toBe(1)
// q2 rec "x" → rows: 0=x(★), 1=y, 2=✎. Custom write-in ⇒ expect(cursorIndex).toBe(2) // options.length

// PATTERN — the write-in commit (e2e style, AC-13 :770-775 — NOT the phantom helper):
panel.cursorIndex = q.options!.length;   // the ✎ Other row
expect(accept(panel)).toBe(true);        // editor opens
expect(panel.focus).toBe("text");
expect(panel.textDuty).toBe("writein");
panel.textField.setText("my own take");
expect(panel.handleInput("\r")).toBe(true);  // commits (first time) / inert-advances (byte-identical re-commit)

// CRITICAL — if a red test implies the PRODUCTION pinning/no-op code is wrong
// (not the test), STOP and report: production edits are outside this task's
// walls. The landed commits 1fba337/d6d1553/2d7a98f/4a9d277/7972f88/f3e00c5
// are the contract; the suite proves them.
```

### Integration Points

```yaml
RUNTIME: NONE — zero production edits, zero config/schema/keymap/UI-string changes
PIPELINE:
  - consumes the landed contracts: T1.S1 (seed), T1.S2 (seed-site flips), T1.S3 (schema string),
    T2.S4/S5/S6 (inert no-ops), T3.S7 (★ answered marker), T4.S8 (comment purge)
  - consumes T5.S9 (parallel, src/panel/*.test.ts flips) via the shared full-suite gate
  - produces the delta's acceptance evidence consumed by T6.S11 (README AC-16 row)
GATES (binding, from architecture/testing-verification.md):
  - npm test                       # FULL suite green
  - npm run typecheck              # green
  - src/no-hardcoded-keys.test.ts  # green (scans non-test .ts only — test-file constants safe)
  - src/keymap-guard.test.ts       # green (DEFAULT_CONFIG.keys untouched)
  - NO new key labels              # enforced by the diff walls + the two guard suites
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# This repo has no ruff/mypy — typecheck is the gate (package.json scripts)
npm run typecheck
# Expected: zero errors. Test files type under the same strict tsconfig; a red
# here is usually a fixture typo (missing ramification/label field) — fix before proceeding.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Immediately after Tasks 2-3:
npx vitest run src/ac-scripted.test.ts
# Immediately after Task 4:
npx vitest run src/regression-phantom-submissions.test.ts
# Expected: green. A red AC-16 leg: diagnose the phase — if the fixture's premise
# is right and the PRODUCTION seam disagrees, STOP and report (see CRITICAL note).
```

### Level 3: Integration Testing (System Validation) — THE BINDING GATES

```bash
npm test    # FULL suite green — the delta gate (panel suites land via T5.S9)
npm run typecheck
npx vitest run src/no-hardcoded-keys.test.ts src/keymap-guard.test.ts
# Expected: all green, zero skips introduced. These four are the task contract's
# binding gates; their outputs go verbatim into the commit message body.
```

### Level 4: Domain-Specific Validation (gate greps + diff walls)

```bash
# Gate 1 — the stale preselect phrasing is gone from this task's suites:
grep -rn "re-seeds cursorIndex to the ★ preselect" src/
# Expected: ZERO hits (:728 relabeled, :770 flipped).

# Gate 2 — T5.S9's greps did not regress (parallel-task safety):
grep -rn "cursor_resets_to_star" src/
grep -rn "re-seeds the cursor to the ★" src/panel/*.test.ts
# Expected: ZERO hits both.

# Gate 3 — no new key labels (the contract's "NO new key labels"):
git diff --stat
# Expected: ONLY src/ac-scripted.test.ts, src/regression-phantom-submissions.test.ts,
# plan/003_f8af1c6f6c49/tasks.json. Zero src/panel/*.test.ts, zero production sources,
# zero config.ts / README.md / spec/.

# REPORT: paste Gates 1-3 + the four Level-3 gate outputs + the phantom-suite audit
# outcome into the commit message body — the task's OUTPUT is this evidence.
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1: `npm run typecheck` clean
- [ ] Level 2: both edited suites green immediately after their tasks
- [ ] Level 3: `npm test` full-suite green; typecheck green; both guard suites green
- [ ] Level 4: Gate greps 1-2 zero hits; Gate 3 diff walls hold; evidence in commit message

### Feature Validation

- [ ] AC-16 test covers every clause: non-recommended answer pin (row 1 ≠ ★ row 0), enter no-op advance (epoch/at/modal/submission all frozen), write-in ✎-row pin + dim preview, byte-identical re-commit inert, different-choice FR-18 modal (esc-cancel clean, enter-keep applies + victim mootered)
- [ ] Test cites FR-35 / ANSWER-PIN-001 / AC-16 in its title and comments
- [ ] Closing zero-submissions assertion present (no phantom submissions from no-op paths)
- [ ] :770 flipped with the discriminating seed assertion; :728 relabeled; Mode A table row added
- [ ] Phantom suite no-op row added; audit recorded in the commit message
- [ ] tasks.json: P1.M1.T5.S10 → "Complete" (that field only)

### Code Quality Validation

- [ ] Follows the file's harness/conventions (e2e panel ctor, accept import, textField path, named key constants, stubTheme)
- [ ] Every pin assertion discriminates (recorded row ≠ ★ row — no coincidence rows added)
- [ ] No assertion deleted or weakened anywhere; existing AC-13/phantom contracts preserved verbatim
- [ ] No production source, src/panel/*.test.ts (T5.S9's), README (T6.S11's), or spec/ file touched

### Documentation & Deployment

- [ ] Mode A: the AC-16 test IS the documentation (task contract: "DOCS: none — test work only; README handled by P1.M1.T6.S11")
- [ ] Commit message carries all gate outputs + the phantom-suite audit outcome — the delta's acceptance evidence

---

## Anti-Patterns to Avoid

- ❌ Don't answer the LAST open question in the AC-16 fixture (q3 stays open) — auto-submit would fire a real submission and destroy the zero-state-change assertions
- ❌ Don't assert `toBe("noop")` at the `accept(panel)`/`handleInput` level — the wrapper coerces to boolean; prove no-ops by STATE (advance + frozen at/epoch + `confirmMode === null` + silent sendMessage)
- ❌ Don't build pin assertions where the recorded value coincides with the ★ row — answer "b" on q1, write-in on q2 (own ★ "x") so every pin discriminates
- ❌ Don't touch production sources, src/panel/*.test.ts, README, spec/, or config — a red that implies a production bug is a STOP-and-report, never a test-side workaround
- ❌ Don't regress T5.S9's gate greps (`cursor_resets_to_star`, panel-suite ★-reseed comments stay 0-hit)
- ❌ Don't delete or weaken the AC-13 e2e / phantom assertions while stabilizing — flips assert the NEW contract; additions are additive
- ❌ Don't skip the guard suites because "it's test-only" — no-hardcoded-keys + keymap-guard are BINDING gates; run them and paste the outputs

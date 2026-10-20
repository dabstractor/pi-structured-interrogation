# PRP — Bugfix P1.M1.T1.S3: Synthetic-entry seam copies text/custom (src/panel/actions.ts submit path)

## Goal

**Feature Goal**: Producer half B of BUG-001's fix (PRD h3.0, Recommendation 1): the synthetic DiffEntry producer inside `submit()` (src/panel/actions.ts:904-922) must copy the FULL answer shape — `text` (elaboration) and `custom` (WRITEIN-001 write-in marker) from the live question `q.answer` — using the same conditional-spread convention as `prompt`, so delivered `interrogation-submission` messages' `details.changed` entries carry complete machine-readable answer data for reconstruction (consumed by S4's `replaySubmission` and S5's e2e regression).

**Deliverable**: Two conditional spreads added to the synthetic-entry object literal + seam-comment update in `src/panel/actions.ts`; three test additions/extensions in `src/panel/actions.test.ts` (elaboration row, write-in row, plain-omission row).

**Success Definition**:
- A synthetic entry for a question whose live answer is `{value, text}` carries `text` (non-empty string) and has NO `custom` key
- A synthetic entry for a write-in answer (`custom: true`) carries `custom: true` and has NO `text` key
- A synthetic entry for a plain answer carries NEITHER key (byte-identical legacy shape — existing bug002 assertions stay green)
- `from: UNANSWERED_SUMMARY`, `to: answerSummary(q)`, `editedArchived: false`, `value`, `prompt`, `id`, `title` unchanged; no reordering around `buildSubmission`'s `takeSnapshot`/`bumpEpoch`
- Full suite + typecheck + lint green

## User Persona

**Target User**: The restarting user (SSH drop / hard kill inside the 2s mirror debounce) whose branch reconstruction falls back to replaying submission deltas — and the model whose read surface, ✎ markers, answer pinning, and completion record are built from replayed state.

**Use Case**: User answered with an elaboration ("alpha — because we already ship SQLite") and a ✎ Other write-in; the process died before the mirror flushed; restart replays the submission entries. Today those entries carry only `value` — the elaboration and the write-in marker are lost forever. After S3 (+S4), the delivered entries carry the full shape and replay restores it.

**Pain Points Addressed**: TRUST-001 (user-authored words vanish from the read surface), WRITEIN-001 (✎ markers gone), ANSWER-PIN-001 (replayed write-in clamps to row 0, looking replaced), FR-5 (completion record omits the elaboration).

## Why

- BUG-001 (PRD h2.2/h3.0): reconstruction replays submission deltas value-only because BOTH DiffEntry producers never carried `text`/`custom`. S2 fixed producer A (`computeEntries`); this subtask fixes producer B — the synthetic seam named in snapshots.ts's FULL-TRANSCRIPT-001 JSDoc ("BOTH DiffEntry producers").
- The seam's own comment claims "Synthesized entries mirror computeEntries' DiffEntry shape exactly" — after S2 that claim is FALSE until this subtask lands. The comment must state the FULL-shape mirror (value/text/custom) — [Mode A] docs ride with the change.
- `buildSubmission` (delivery.ts:163) packs `details.changed` UNTRUNCATED by contract (delivery.ts:128, :200 — `SUBMISSION_LIST_MAX_CHARS` caps the display line only), so growing entries is contract-safe.

## What

1. **src/panel/actions.ts:912-920** — in the synthetic-entry object literal, after `value: q.answer?.value,` add two conditional spreads mirroring S2's `computeEntries` convention exactly:
```ts
...(q.answer?.text !== undefined && q.answer.text !== "" ? { text: q.answer.text } : {}),
...(q.answer?.custom === true ? { custom: true } : {}),
```
Keep `from: UNANSWERED_SUMMARY` and every existing field byte-identical. Do NOT hoist/reorder anything; do NOT reorder around `buildSubmission` (takeSnapshot/bumpEpoch order is contractual).
2. **Seam comment (~:898-903)** — update the "Synthesized entries mirror computeEntries' DiffEntry shape exactly" sentence to name the FULL answer shape: entries mirror computeEntries' FULL DiffEntry shape — `value` plus elaboration `text` and write-in `custom` (BUG-001 producer B). Everything else in the comment block (UNANSWERED sentinel rationale, never-reorder warning) stays.
3. **Tests (src/panel/actions.test.ts)** — three rows, each reaching the SYNTHETIC path specifically (a producer-A entry would false-green: S2 already covers it). The verified trigger: the last ring snapshot holds the identical answer signature, so `computeDiff` yields no entry for a pending id. Reach it via rule-1 re-ask + byte-identical re-confirm (REASKED EXCEPTION — implemented at actions.ts:288-291/:468-471), or rule-2 re-ask + same-value re-answer (bug002 pattern). See Blueprint for exact flows.

### Success Criteria

- [ ] Elaboration synthetic row: entry carries `text: "<the draft>"`, `"custom" in entry === false`
- [ ] Write-in synthetic row: entry carries `custom: true`, `"text" in entry === false`
- [ ] Plain row: `"text" in entry === false && "custom" in entry === false` (extend the existing bug002 test)
- [ ] Existing bug002 assertions (`from === "(unanswered)"`, `to`, `prompt`) green unchanged
- [ ] `npm run typecheck` + `npm test` + `npm run lint` green
- [ ] Only `src/panel/actions.ts` + `src/panel/actions.test.ts` modified

## All Needed Context

### Context Completeness Check

Repo green at HEAD; S2 (DiffEntry += `text?`/`custom?` + computeEntries spreads in src/snapshots.ts) is a HARD PRECONDITION — its extended interface is what these literals type-check against; S2 does not touch actions.ts so the line refs here are stable. The seam code, both re-confirm seams, the baseline mechanics, and every test harness helper were read verbatim from the working tree and are quoted in the research notes. An implementing agent needs this PRP plus `src/panel/actions.ts`, `src/panel/actions.test.ts`, and read-only `src/snapshots.ts` (post-S2) / `src/delivery.ts`.

### Documentation & References

```yaml
- file: plan/006_45773b259b06/bugfix/001_3e88fb340e1d/architecture/bug001-submission-replay.md
  why: "§4 quotes the seam verbatim; §'Size/caps risk — CLEARED' proves growing details.changed is contract-safe; fix-surface item 2 IS this subtask"
  critical: "answerSignature = value+text only (at/custom excluded) — this is why the re-ask + byte-identical re-confirm produces an empty diff and hits the synthetic path"

- file: plan/006_45773b259b06/bugfix/001_3e88fb340e1d/P1M1T1S2/PRP.md
  why: "The input contract: DiffEntry gains text?:string (non-empty only) and custom?:boolean (===true only) after value?; S2's computeEntries spread pattern is the convention to mirror EXACTLY"
  gotcha: "S2 owns snapshots.ts — S3 must not touch it"

- file: plan/006_45773b259b06/bugfix/001_3e88fb340e1d/P1M1T1S3/research/notes.md
  why: "Verified line refs, both re-confirm seams quoted, baseline mechanics (empty ring → all-unanswered baseline → producer A on first submit), test-harness precedents with line numbers"

- file: src/panel/actions.ts
  why: ":904-922 the seam (object literal :912-920); :898-903 the comment to update; :808 reconcileDraftsForSubmit runs FIRST in submit() (drafts attach as answer.text before baseline/diff); :828 pendingIds = status 'answered'; REASKED EXCEPTION at :288-291 (option) and :468-471 (write-in — kind-preserving: recorded.custom===true → custom stays true); isReconfirm :500-507"
  pattern: "conditional spread ...(cond ? { key: val } : {}) — keys ABSENT, never null/false/empty"
  gotcha: "acceptOptionIndex's proposed = {value, at} ONLY — an option re-confirm WIPES answer.text; recovery: re-stage via panel.commitTextDraft(qid, text) AFTER the accept (currentId-agnostic), reconcileDraftsForSubmit re-attaches at submit. Stage drafts AFTER advanceAfterAccept — the advance's syncBufferToQuestion write-through wipes pre-advance stagings (:339-347)"

- file: src/panel/actions.test.ts
  why: "Harness: makeDeps :125, makePanel :108 (pass {delivery: deps} to wire auto-submit), choiceQ :64, seed :82, T0 :51; writeInSeed :675 (scoped INSIDE the writeIn describe); PRECEDENTS: test_bug002... :1157-1211 (synthetic shape + two-cycle structure + inline cast type at :1208) and test_wi_reasked_reconfirm... :862-884 (setStatus('reasked') + focusTextField/setText/writeInEnter + auto-submit delivery)"

- file: src/snapshots.ts
  why: "READ-ONLY post-S2: DiffEntry (extended), answerSummary :196 (to is display-only — ✎ value / label; machine keys are S3's job), submissionBaselineOf :49-55 (empty ring → all-unanswered baseline)"
  gotcha: "UNANSWERED_SUMMARY === '(unanswered)' — tests hardcode the literal like bug002 does"

- file: src/delivery.ts
  why: "READ-ONLY: buildSubmission :163 packs details.changed UNTRUNCATED (:128, :200) — growing entries needs no caps work"
```

### Current Codebase tree (relevant excerpt)

```bash
src/
├── panel/
│   ├── actions.ts         # :904-922 seam — MODIFY (literal + comment)
│   └── actions.test.ts    # ADD 2 tests + EXTEND bug002 — MODIFY
├── snapshots.ts           # S2 owns (post-S2: DiffEntry text?/custom?) — DO NOT TOUCH
├── delivery.ts            # buildSubmission — READ-ONLY
└── reconstruct.ts         # S4 owns (replaySubmission) — DO NOT TOUCH
```

### Desired Codebase tree with files to be added

```bash
# No new files — MODIFY only:
src/panel/actions.ts        # +2 conditional spreads, comment sentence update
src/panel/actions.test.ts   # +2 tests (elaboration, write-in), +2 expects in bug002 test
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: keys must be ABSENT, not null/false/"" — guard text with BOTH
//   !== undefined AND !== ""; custom with strict === true (S2's convention).
// GOTCHA: TS narrowing — `q.answer?.text !== undefined && q.answer.text !== ""`
//   narrows correctly (same shape S2 uses for after?.answer); keep it verbatim.
// GOTCHA: a first-answer-then-submit test hits producer A (computeEntries —
//   EMPTY ring baseline = all-unanswered, so computeDiff ALWAYS emits the first
//   answer). The synthetic seam fires ONLY when the last snapshot holds the
//   identical signature → tests MUST use the two-cycle re-ask pattern.
// GOTCHA: option re-confirm wipes text (proposed = {value, at}) — the
//   elaboration test must re-stage the draft after the accept; write-in
//   re-confirm preserves custom by construction (isReconfirm kind preservation).
// GOTCHA: stage drafts AFTER advanceAfterAccept (write-through wipe hazard,
//   actions.ts:339-347) but BEFORE submit/auto-submit (same-gesture delivery
//   must find the slot staged).
// GOTCHA: writeInEnter's re-confirm on the LAST unanswered question triggers
//   maybeAutoSubmit (auto-delivery inside the call) — the write-in test's
//   second delivery arrives via the auto-submit, not a manual submit() call.
// GOTCHA: pendingIds = status "answered" only — after setStatus("q1","reasked")
//   the question is NOT pending until the re-confirm applyAnswer re-marks it.
// GOTCHA: eslint covers src/ — keep spread formatting consistent with the
//   existing prompt spread line style.
```

## Implementation Blueprint

### Implementation Tasks (TDD-ordered)

```yaml
Task 0: PRECONDITION CHECK
  - Confirm S2 merged: src/snapshots.ts DiffEntry has text?:string / custom?:boolean
    and computeEntries spreads them. If absent, STOP — S3 depends on S2.

Task 1: ADD failing tests to src/panel/actions.test.ts
  - TEST A (write-in → custom): inside the writeInEnter describe (writeInSeed in
    scope), right after test_wi_reasked_reconfirm_completing_set_auto_submits_and_delivers (:862-884):
      1. const state = writeInSeed();              // q1 answered {value:"alpha", custom:true, at:T0}
      2. const { deps, sendMessage } = makeDeps(true);
         const { panel } = makePanel(state, { delivery: deps });
         expect(submit(panel, deps)).toBe(true);   // CYCLE 1: ring empty → producer A entry;
                                                   // snapshot 1 now holds the "alpha" signature
         expect(sendMessage).toHaveBeenCalledTimes(1);
      3. state.setStatus("q1", "reasked");         // rule-1 simulation (public API, :877 precedent)
      4. panel.currentId = "q1";
         panel.focusTextField("writein");
         panel.textField.setText("alpha");          // byte-identical
         expect(writeInEnter(panel)).toBe(true);    // REASKED EXCEPTION → re-confirm keeps
                                                    // custom:true → answered(pending) → auto-submit
         expect(sendMessage).toHaveBeenCalledTimes(2);
      5. const msg = sendMessage.mock.calls[1][0] as SubmissionMessage;
         const e = msg.details.changed[0]!;
         expect(e.id).toBe("q1");
         expect(e.from).toBe("(unanswered)");       // synthetic shape (baseline matched)
         expect(e.value).toBe("alpha");
         expect(e.custom).toBe(true);               // ← S3's fix
         expect("text" in e).toBe(false);
         expect(msg.content).toContain("✎ alpha");
      (extend the inline cast type at :1208-style with text?:string; custom?:boolean,
       or cast details.changed as DiffEntry[] importing the type from ../snapshots.js)

  - TEST B (elaboration → text): in the submit-path describe, right after
    test_bug002_same_value_reanswer_after_rule2_reask_ships_pending (:1157-1211):
      1. const state = seed([
           { id: "q1", overrides: { title: "Choice One", options: OPTS } },
           { id: "q2", overrides: { type: "text", prompt: "p2" } },   // blocks auto-submit
         ]);
         const { deps, sendMessage } = makeDeps(true);
         const { panel } = makePanel(state, { delivery: deps });
      2. CYCLE 1 (panel-driven elaborated answer):
         panel.currentId = "q1"; panel.cursorIndex = 0;        // option "a" (no recommendation → natural order)
         expect(panel.handleInput("\r")).toBe(true);            // accept "a" → applyAnswer {value:"a"}; advance → q2
         panel.commitTextDraft("q1", "because");                 // stage AFTER the advance (write-through hazard)
         expect(submit(panel, deps)).toBe(true);                 // reconcile attaches → {a, text:"because"};
                                                                // ring empty → producer A entry; snapshot 1 = a+because
         expect(sendMessage).toHaveBeenCalledTimes(1);
         (optional joint check: delivery-1 entry also carries text — S2's half)
      3. CYCLE 2 (re-ask + re-confirm + re-stage → synthetic):
         state.setStatus("q1", "reasked");                       // answer kept: {a, "because"}
         panel.currentId = "q1";                                  // cursor seeds to recorded "a" (ANSWER-PIN-001)
         expect(panel.handleInput("\r")).toBe(true);             // REASKED EXCEPTION → applyAnswer {value:"a", at:fresh}
                                                                // (text wiped in state); advance → q2; no auto-submit (q2 open)
         panel.commitTextDraft("q1", "because");                  // re-stage AFTER the advance
         expect(submit(panel, deps)).toBe(true);                  // reconcile re-attaches text → signature matches
                                                                // snapshot 1 → diff EMPTY → SYNTHETIC entry
         expect(sendMessage).toHaveBeenCalledTimes(2);
      4. const e2 = (sendMessage.mock.calls[1][0] as SubmissionMessage).details.changed[0]!;
         expect(e2.id).toBe("q1");
         expect(e2.from).toBe("(unanswered)");
         expect(e2.value).toBe("a");
         expect(e2.text).toBe("because");                         // ← S3's fix
         expect("custom" in e2).toBe(false);
      - If handleInput("\r") routing differs in this context, drive the accept via the
        exported acceptOptionIndex(panel, q, 0) (display row of "a") — same semantics.

  - TEST C (plain omission): EXTEND test_bug002... (:1157-1211) with two expects on its
    synthetic entry: expect("text" in e).toBe(false); expect("custom" in e).toBe(false);
    (q1 there is a plain option answer — the legacy shape must stay byte-identical)

Task 2: MODIFY src/panel/actions.ts — the seam (:912-920)
  - After `value: q.answer?.value,` add:
      ...(q.answer?.text !== undefined && q.answer.text !== "" ? { text: q.answer.text } : {}),
      ...(q.answer?.custom === true ? { custom: true } : {}),
  - No other line in the literal changes; no reordering anywhere in submit().

Task 3: UPDATE the seam comment (~:898-903)
  - "Synthesized entries mirror computeEntries' DiffEntry shape exactly" →
    "Synthesized entries mirror computeEntries' FULL DiffEntry shape — value plus
    elaboration text and write-in custom (BUG-001 producer B)". Rest of the block intact.

Task 4: RUN gates (see Validation Loop)
```

### Implementation Patterns & Key Details

```ts
// The extended synthetic entry (src/panel/actions.ts:912-920, excerpt — everything else unchanged):
return {
  id,
  title,
  ...(prompt !== undefined ? { prompt } : {}),
  from: UNANSWERED_SUMMARY,
  to: answerSummary(q),
  editedArchived: false,
  value: q.answer?.value, // RAW post-change value; undefined when unanswered/missing
  ...(q.answer?.text !== undefined && q.answer.text !== "" ? { text: q.answer.text } : {}),
  ...(q.answer?.custom === true ? { custom: true } : {}),
};

// WHY the tests need two cycles (the false-green trap):
// submissionBaselineOf returns the LAST ring snapshot; empty ring → all-unanswered
// baseline → computeDiff ALWAYS emits a first answer (producer A — S2's code).
// The synthetic seam fires ONLY for pending ids whose signature already matches the
// last snapshot. The re-ask + byte-identical re-confirm (REASKED EXCEPTION) recreates
// the identical signature while re-marking the question pending — the exact production
// scenario (agent re-asks, user re-confirms, submit ships a synthetic entry).
```

### Integration Points

```yaml
MESSAGE PAYLOAD: "details.changed entries gain text/custom keys only when the live answer
  carries them — downstream JSON consumers (S4 replaySubmission reads entry.text/entry.custom
  with legacy guards; S5 e2e regression; the card renderer reads display-only to/from) are
  additive-key tolerant"
NO CHANGES: "config surface, renderers, delivery.ts caps (details.changed is UNTRUNCATED by
  contract), snapshots.ts (S2 owns), reconstruct.ts (S4 owns)"
DOCS: "[Mode A] the seam comment update rides with the change — no other docs work"
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # tsc --noEmit — 0 errors (requires S2's extended DiffEntry)
npm run lint        # eslint src scripts *.ts — 0 errors
```

### Level 2: Unit Tests (the new rows)

```bash
npx vitest run src/panel/actions.test.ts -v
# Expected: all existing rows green (incl. test_bug002 and test_wi_reasked_reconfirm)
# + the 3 new/extended rows green
```

### Level 3: Downstream & Full Suite

```bash
npx vitest run src/delivery.test.ts src/snapshots.test.ts src/renderers.test.ts src/reconstruct.test.ts
npm test   # full suite — zero regressions
```

### Level 4: Shape matrix (manual review of the diff)

- [ ] Synthetic entry with elaborated answer: `text` present, `custom` key absent
- [ ] Synthetic entry with write-in: `custom: true` present, `text` key absent
- [ ] Synthetic entry with plain answer: neither key present — legacy JSON key-for-key identical
- [ ] `git diff` touches only the object literal (2 spreads), the comment sentence, and the test file

## Final Validation Checklist

### Technical Validation

- [ ] All 4 validation levels completed; `npm run typecheck`, `npm test`, `npm run lint` all green
- [ ] S2 precondition confirmed (extended DiffEntry present) before starting

### Feature Validation

- [ ] Test A (write-in → `custom: true`), Test B (elaboration → `text`), Test C (plain → neither key) all green and each demonstrably hits the SYNTHETIC path (`from === "(unanswered)"` with an empty diff for that id)
- [ ] Existing bug002 assertions unchanged and green; from/to/prompt/value/editedArchived byte-identical for plain answers
- [ ] No reordering around buildSubmission's takeSnapshot/bumpEpoch (git diff confirms)
- [ ] Seam comment states the FULL answer-shape mirror ([Mode A])

### Code Quality Validation

- [ ] Conditional-spread convention matches S2's computeEntries spreads exactly (keys absent, never null/false/"")
- [ ] Only `src/panel/actions.ts` + `src/panel/actions.test.ts` modified
- [ ] Test flows use the existing harness helpers (makeDeps/makePanel/seed/writeInSeed/choiceQ) and real panel seams (focusTextField/setText/writeInEnter/handleInput/commitTextDraft)

## Anti-Patterns to Avoid

- ❌ Don't write `text: undefined` / `custom: false` into entries — keys must be ABSENT
- ❌ Don't test with a first-answer-then-submit flow — it exercises producer A (S2) and false-greens this subtask
- ❌ Don't touch snapshots.ts (S2), reconstruct.ts (S4), delivery.ts, or any caps — the payload growth is already contract-cleared
- ❌ Don't stage drafts before advanceAfterAccept — the write-through wipes them (actions.ts:339-347)
- ❌ Don't reorder anything in submit() around buildSubmission — takeSnapshot/bumpEpoch order is contractual
- ❌ Don't skip the S2 precondition check — the literals document the extended interface

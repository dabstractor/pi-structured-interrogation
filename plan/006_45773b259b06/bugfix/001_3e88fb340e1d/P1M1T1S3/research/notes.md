# Research notes — P1.M1.T1.S3 (synthetic-entry seam copies text/custom)

Verified against working tree. All line refs checked live. S2 (snapshots.ts DiffEntry
extension) is treated as a contract per the parallel-execution context; S2 does NOT
touch actions.ts, so the line refs below are stable.

## 1. The seam (src/panel/actions.ts)

`submit()` synthetic-entry block, :904-922:

```ts
const shippedIds = new Set(userChanged.map((e) => e.id));
const augmented = [
  ...userChanged,
  ...pendingIds
    .filter((id) => !shippedIds.has(id))
    .map((id) => {
      const q = panel.state.getQuestion(id)!; // ids came from orderedQuestions
      const title = q.title ?? q.prompt ?? id;
      const prompt = transcriptPrompt(q.prompt, title); // FULL-TRANSCRIPT-001 mirror
      return {
        id,
        title,
        ...(prompt !== undefined ? { prompt } : {}),
        from: UNANSWERED_SUMMARY,
        to: answerSummary(q),
        editedArchived: false,
        value: q.answer?.value,
      };
    }),
];
const msg = buildSubmission(panel.state, { ...diff, changed: augmented }, note || undefined);
```

The seam comment block :898-903 (BUG-008 (b) + BUG-002): "Synthesized entries mirror
computeEntries' DiffEntry shape exactly; `from` is the UNANSWERED sentinel ...
buildSubmission still performs its own takeSnapshot + bumpEpoch exactly once — never
reorder around it." → the "mirror ... exactly" sentence is the one to update.

## 2. When the synthetic seam fires (verified)

- `pendingIds` = `orderedQuestions().filter(q => q.status === "answered")` (:828) — captured
  before markSubmitted.
- Baseline: `submissionBaseline(panel)` → `submissionBaselineOf` (snapshots.ts:49-55) —
  returns the LAST ring snapshot; with an EMPTY ring returns `{goal:"",epoch:0,order:[],questions:{},completed:false}`
  (all-unanswered) → FIRST submit's entries always come from computeEntries (producer A).
- Synthetic entries fire ONLY when the last snapshot already holds the identical answer
  signature (`answerSignature` = value+text — at and custom are NOT in it).
- The canonical trigger: **rule-1 re-ask + byte-identical re-confirm** (REASKED EXCEPTION,
  already implemented — actions.ts:288-291 option path, :468-471 writeIn path):
  a rule-1 re-ask flips status "reasked" KEEPING the answer; a same-value/same-text
  commit then falls past the ANSWER-PIN-001 inert branch, applyAnswers with a fresh `at`
  (diff-invisible), re-marks status "answered" (pending). Signature matches baseline →
  diff empty → synthetic entry.
- Alternative trigger (bug002 test's): rule-2 re-ask (answer deleted) + same-value
  re-answer via raw `state.applyAnswer`.

## 3. The two re-confirm seams (verified code)

- **acceptOptionIndex** (:285-330): `recorded.custom !== true && recorded.value === opt.value
  && q.status !== "reasked"` → inert; reasked falls through → ripple seam skipped
  (status-list form: answered/submitted/closed only) → `applyAnswer(q.id, { value: opt.value, at })`
  — NOTE: `proposed` carries ONLY {value, at}: an elaborated answer's `text` is WIPED by the
  option re-confirm. Recovery path: re-stage the draft via `panel.commitTextDraft(q.id, text)`
  AFTER the accept (currentId-agnostic) — `reconcileDraftsForSubmit` (first line of submit(),
  :808) re-attaches it as `answer.text` BEFORE baseline/diff/pending are read.
- **writeInEnter** (:422-529): reasked byte-identical → `isReconfirm` (:500) → kind
  preservation: `recorded.custom === true → answer.custom = true` (:506) → applyAnswer →
  `maybeAutoSubmit` on the direct-commit exit (:528). Custom is PRESERVED by construction.
- Ordering hazard (stageSupersededWriteIn docs :339-347): stage drafts AFTER
  advanceAfterAccept (the advance's syncBufferToQuestion write-through would wipe a
  pre-advance staging); commitTextDraft takes an explicit questionId and is
  currentId-agnostic.

## 4. Test harness precedents (src/panel/actions.test.ts, 3323 lines)

- `makeDeps(isIdle=true)` :125-128 → `{ deps: {sendMessage: vi.fn(), isIdle}, sendMessage }`.
- `makePanel(state, extra?)` :108 → `new InterrogationPanel({tui, theme, done, state, config, ...extra})`;
  passing `{ delivery: deps }` wires auto-submit delivery (see :871).
- `choiceQ(id, overrides?)` :64, `seed(specs)` :82, `T0` :51 — module-level.
- `writeInSeed(extra?)` :675 — INSIDE the writeIn describe: `seed([{id:"q1"},...extra])` +
  `applyAnswer("q1", {value:"alpha", custom:true, at:T0})`.
- **Synthetic-shape precedent** — `test_bug002_same_value_reanswer_after_rule2_reask_ships_pending`
  :1157-1211: two-cycle structure; asserts `msg.details.changed[0]?.from === "(unanswered)"`,
  `to === "Alpha"`, `prompt === "prompt:q1"` (inline cast type at :1208:
  `Array<{id: string; from: string; to: string; prompt?: string}>`).
- **Write-in reconfirm precedent** — `test_wi_reasked_reconfirm_completing_set_auto_submits_and_delivers`
  :862-884: `writeInSeed()` → `state.setStatus("q1","reasked")` (rule-1 simulation, public API)
  → `makePanel(state, {delivery: deps})` → `panel.currentId="q1"; panel.focusTextField("writein");
  panel.textField.setText("alpha"); writeInEnter(panel)` → auto-submit delivers exactly once,
  `state.epoch` bumps by 1, content contains "✎ alpha". NOTE: in that test the ring is EMPTY
  at the auto-submit (no prior submit) → its entry is producer A. For a SYNTHETIC write-in
  entry, cycle 1 must submit FIRST (snapshot the signature), then re-ask, then re-confirm.
- Editor driving: `panel.focusTextField("writein"); panel.textField.setText("...")`;
  option accept via `panel.handleInput("\r")` (cursor seeded on the recorded answer —
  ANSWER-PIN-001) or the exported `acceptOptionIndex(panel, q, displayRow)`.

## 5. answerSummary (snapshots.ts:196+) — `to` is display-only

custom → `✎ ${value}` (+ ` — ${text}` when non-empty); else label-preferred. The `to`
summary ALREADY reflects text/custom cosmetically; the machine-readable keys are what S3 adds.

## 6. delivery packing — growing entries is contract-safe (verified)

buildSubmission (delivery.ts:163): `details.changed` keeps the UNTRUNCATED entries
(delivery.ts:128, :200 — "details.changed/details.card keep the UNTRUNCATED to";
SUBMISSION_LIST_MAX_CHARS=240 caps the content LINE only). details = {changed, note?, epoch, card}.

## 7. package.json scripts

`npm test` (vitest run), `npm run typecheck` (tsc --noEmit), `npm run lint` (eslint src scripts *.ts).

## 8. S2 contract dependency (hard precondition)

S2 adds `text?: string` / `custom?: boolean` to DiffEntry (snapshots.ts) + computeEntries
spreads. S3's seam literals must type-check against the EXTENDED interface; S3 must not
re-modify snapshots.ts. If S2 is unmerged when S3 starts, typecheck may still pass
(structural extra-property tolerance via the `augmented` variable) but the seam would be
writing undocumented keys — treat S2-merged as the precondition.

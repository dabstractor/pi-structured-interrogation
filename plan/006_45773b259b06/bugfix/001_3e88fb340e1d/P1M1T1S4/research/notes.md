# Research Notes — P1.M1.T1.S4: replaySubmission applies text/custom (src/reconstruct.ts)

All line numbers verified against the working tree at research time
(S2 merged; S3 in parallel — S4 shares NO files with S3).

## 1. The bug site — replaySubmission (src/reconstruct.ts:415-441)

```ts
function replaySubmission(state: LiveState, details: SubmissionMessage["details"]): boolean {
  const changed = Array.isArray(details?.changed) ? details.changed : [];
  let applied = 0;
  for (const entry of changed) {
    const id = entry?.id;
    if (typeof id !== "string" || state.getQuestion(id) === undefined) continue;
    // Value-first resolution (BUG-007): `value` is the RAW post-change
    // answer.value (DiffEntry.value, snapshots.ts — P1.M2.T2.S1), ... 
    // `at` timestamps are not carried in deltas either. See module JSDoc.   ← :425-433 comment block
    const raw = entry.value;
    const resolved = typeof raw === "string" && raw !== "" ? raw : entry.to;
    // The sentinel check applies to the RESOLVED value: it skips answer
    // CLEARANCES (`to` sentinel) ...
    if (typeof resolved !== "string" || resolved === "" || resolved === UNANSWERED_SUMMARY) continue;
    state.applyAnswer(id, { value: resolved, at: new Date().toISOString() });   // ← :439 the fix site
    applied++;
  }
  if (applied > 0) state.bumpEpoch();
  return applied > 0;
}
```

- Caller: reconstructFromBranch :565 `if (replaySubmission(state, submission.details)) replayed++;`
- UNANSWERED_SUMMARY defined locally :196 `= "(unanswered)"` (not imported from snapshots).
- Invariant to preserve EXACTLY: value-first resolution, sentinel/clearance
  skip, unknown-id skip, `applied>0 → one bumpEpoch()` (h3.6 one submission =
  one bump), fresh `at` per replay, return-bool semantics.

## 2. applyAnswer passes fields through (src/state.ts:379-387)

```ts
applyAnswer(id: string, answer: QuestionAnswer): void {
  const q = this.questions.get(id);
  if (q === undefined) throw new Error(`unknown question id: ${id}`);
  q.answer = { ...answer };        // shallow copy — text/custom pass through
  q.status = "answered";
  this.emitChanged();
}
```

QuestionAnswer (state.ts:43-54): `{ value: string; text?: string; custom?: boolean; at: string }`
→ adding the two conditional spreads to the literal typechecks with NO cast
changes anywhere.

## 3. Strict-guard precedent (src/state.ts:591-598, deserialize)

```ts
const answer: QuestionAnswer = { value: value.answer.value, at: value.answer.at };
if (typeof value.answer.text === "string") answer.text = value.answer.text;
if (value.answer.custom === true) answer.custom = true; // strict true — corrupt truthy values must not leak into state
```

The item contract tightens the text guard with a non-empty check (matches the
S2 producer convention — key present ONLY when non-empty):

```ts
...(typeof entry.text === "string" && entry.text !== "" ? { text: entry.text } : {}),
...(entry.custom === true ? { custom: true } : {}),
```

## 4. Input contract — DiffEntry post-S2 (src/snapshots.ts:88-141, VERIFIED MERGED)

- `value?: string` (:117) — RAW post-change answer.value
- `text?: string` (:132) — elaboration, "Key present ONLY when a non-empty string"
- `custom?: boolean` (:140) — WRITEIN-001 marker, `true` only
- computeEntries spreads (S2, :321-322):
  `...(after?.answer?.text !== undefined && after.answer.text !== "" ? { text: after.answer.text } : {})`,
  `...(after?.answer?.custom === true ? { custom: true } : {})`
- SubmissionMessage (delivery.ts:66-85): `details.changed: DiffEntry[]` —
  so inside replaySubmission `entry.text`/`entry.custom` are typed
  (`string | undefined` / `boolean | undefined`); the guards need NO casts.
- S3 (in parallel) extends producer B (panel actions.ts seam) — S4 has ZERO
  file overlap with S3 and NO runtime dependency (tests hand-build fixture
  entries; S5 does the e2e through the real seam).

## 5. Test harness (src/reconstruct.test.ts, 1087 lines)

Module-scope helpers (all verified):
- `OPTS_AB` :48, `choiceQ(id, overrides?)` :54
- `seededState(build)` :66 — real state via merge primitives, `.serialize()`
- `toolResultEntry(state)` :73 — role "toolResult", toolName "interrogate", details.state
- `submissionEntry(details)` :115 — `custom_message` + customType
  "interrogation-submission" + `details: {...details, card: {...}}`.
  **Its inline `changed` element type currently declares only
  `{id,title,from,to,editedArchived,value?}` — MUST be extended with
  `text?: string; custom?: boolean` or new tests won't compile.**
- `diff(id, to, value?)` :138-144 — returns
  `{ id, title: id, from: "(unanswered)", to, editedArchived: false, value }`.
  **Return type + params MUST be extended for text/custom (keys ABSENT when
  not provided — use a trailing `extra?: {text?, custom?}` object spread,
  NOT unconditional keys).**
- `makeCtx(entries, mode?)` :175, `makeHost()` :193, `makeOpts(host)` :200
- `beforeEach` :206 — setFallbackActive(false), makeHost(), resetState()
- imports already include `markAnswered` (merge.js), `getState`, `resetState`

Model to copy — BUG-007 describe :939-1003 with LOCAL helper `branchWithSubmission`
(:945-958): seeds q1 = choice {value:"b", label:"Beta"} + q2 = choice dependsOn
q1==="b"; base = toolResultEntry(seeded); branch = [toolResultEntry(base),
submissionEntry({changed, epoch:1})]; runs reconstructFromBranch(makeCtx(entries),
makeOpts(makeHost())); returns {base, result, state: getState()!}.

Existing rows that MUST stay green unchanged:
- :961 "replay prefers raw value over label summary (h3.6 repro)"
- :971 "legacy entries without value fall back to the label summary"
- :983 "unanswered sentinel stays skipped without phantom answers or epoch bumps"
- :993 "empty-string value falls back to the label summary"

New describe placement: immediately after :1003 (before the BUG-008 describe
at :1004). Convention: local helper scoped inside the describe.

## 6. Downstream consumers (CONTEXT ONLY — do not modify)

- buildCompletion (delivery.ts): `answer.custom === true → \`✎ ${answer.value}\``
  (:373) and `q.answer?.text` free-text (:469) — read from live state, so
  replay fidelity is what feeds the FR-5 record.
- Read surface / digest elaboration lines (TRUST-001), ANSWER-PIN-001 caret
  pinning to the ✎ Other row — all read state, fixed transitively by this change.

## 7. Comment blocks to update ([Mode A] rides with the change)

1. **In-function BUG-007 comment, reconstruct.ts :425-433** (REQUIRED):
   currently ends "`at` timestamps are not carried in deltas either. See
   module JSDoc." — must now state text/custom ARE carried (strict guards),
   `at` still is not.
2. **Module JSDoc step 3 CAVEAT, reconstruct.ts :57-61** (accuracy):
   "CAVEAT: entries replay VALUE-FIRST — ... answer `at` timestamps are not
   carried." — extend with text/custom carried (BUG-001).

## 8. Validation commands (package.json)

- `npm run typecheck` → tsc --noEmit
- `npm test` → vitest run
- `npm run lint` → eslint src scripts *.ts
- targeted: `npx vitest run src/reconstruct.test.ts -v`

# P3.M4.T1.S2 research findings — replay/reconstruction blank guards + acceptance case 5

## Spec authority

`spec/state-and-persistence.md` §Local input recovery:
- **:141 (rule)**: "Reject blank answer values at the shared final mutation (`applyAnswer`), regardless of ingress... On reconstruction/replay, a historical blank must neither replace a valid answer nor count or appear as validly answered/submitted; do not fabricate missing text."
- **:149 (case 5, verbatim)**: "Reopen a committed Other/text answer; verify its exact value. Clear or enter only whitespace, attempt commit, then restart and reopen: the newer edit wins, the prior answer is unchanged, and rejection kept focus and explained why. Repeat blank rejection through non-editor ingress; replay a legacy blank with and without a prior valid answer and verify the resulting answer and counts."

S1's PRP (contract, landed in working tree) owns the LIVE halves; S2 owns the **replay/restart halves**. S1's applyAnswer JSDoc already names "P3.M4.T1.S2's replay filter" as a predicate consumer.

## Surface 1 — delta replay: `src/reconstruct.ts` `replaySubmission` (:446-483)

```ts
const raw = entry.value;
const resolved = typeof raw === "string" && raw !== "" ? raw : entry.to;   // :462
if (typeof resolved !== "string" || resolved === "" || resolved === UNANSWERED_SUMMARY) continue;  // :466
state.applyAnswer(id, { value: resolved, ... })                            // :467
```

- **THE CRASH HAZARD**: S1's `applyAnswer` throws on blank (verified in working tree: state.ts:396-404). `raw = "  "` passes `raw !== ""` at :462 → resolved = `"  "` → :466's `resolved === ""` does NOT catch it → **applyAnswer throws inside replay → reconstruction crashes** on any legacy session containing a whitespace delta. S2's primary fix: widen :466 to `isBlankAnswerValue(resolved)`.
- Resolution semantics to PRESERVE (pinned tests in reconstruct.test.ts BUG-007 describe :954-1018):
  - `value: ""` → falls back to `to` (test "empty-string value falls back to the label summary" :1011) — `""` means "no raw recorded" (pre-P1.M2.T2.S1 legacy). UNCHANGED by the widening (resolved is `to`, nonblank there).
  - `value: "  "` (whitespace) → raw is a REAL blank answer from the guard-less era → **SKIP, never fall back to `to`** ("do not fabricate missing text"). The widening achieves exactly this: raw wins resolution (nonempty), then isBlankAnswerValue skips.
  - raw absent + `to` blank/whitespace → widened check skips (today only `""` skips).
  - `to` = UNANSWERED_SUMMARY sentinel → still skips (answer clearance).
- Epoch rule: `applied > 0` → `state.bumpEpoch()` (:482). A blank-skipped-only submission returns false → no replayed count, no epoch burn (h3.6: one submission one bump, only when something applied).
- Replay loop (:595-606): chronological over `walk.submissions`, position/epoch filters intact — blanks are skipped per-entry; **prior valid answers from earlier submissions stay in place automatically** ("prior valid answer wins" is structural).
- Import: reconstruct.ts already imports from `./state.js` (type imports) — add `isBlankAnswerValue` to the value imports (verified state.ts:46 `export function isBlankAnswerValue`).

## Surface 2 — base-restored blanks (scrub)

- `InterrogationState.deserialize` (state.ts:512) accepts ANY string `answer.value` (strict shape guard at :611-618 checks `typeof value === "string"` only) → a **legacy base snapshot can carry `answer: {value: "  "}` with status `answered`** and reconstruction installs it verbatim → counters read it as answered → violates ":141 counts never read it as answered". Delta-skip alone does NOT cover this.
- `questions` is **private** (state.ts:274) → reconstruct cannot scrub a deserialized state's fields. Scrub must happen at the **payload level**: a `scrubLegacyBlankAnswers(data)` pass on `candidate.data` (plain parsed JSON) BEFORE `tryDeserialize(candidate.data)` inside the candidates loop (:555-566). Payload shape: `data.questions` plain object map, each with optional `answer` + `status` string.
- Scrub rule per question: if `answer.value` is a blank string → `delete answer`; if `status` was `"answered"` or `"submitted"` → `"open"` (only these two count as validly answered in `groupSummaries`). Terminal statuses (`moot`/`withdrawn`/`closed`) and `reasked` stay — clearing the answer must not resurrect/un-terminal anything. No epoch involvement (pre-state).
- In-place mutation of the parsed-JSON candidate is safe (walk data is freshly parsed); precedents for strict handling of untrusted persisted data: deserialize guards, BUG-001 strict-guards in replaySubmission.
- Ordering: scrub runs before deserialize → plausibility + replay all see the clean base; a later VALID delta still applies normally (scrubbed-open question becomes answered).

## Surface 3 — the counters (status-line single source of truth)

- `state.groupSummaries()` (state.ts:310-334): `summary[q.status]++` — answered/submitted/open/moot/... per group. This IS the counter source the status line renders. Since blanks are now never applied (delta skip) and never installed (base scrub), the counters can never read a blank as answered; tests assert `groupSummaries()` tallies directly.

## S1 contract dependencies (verified in working tree / S1 PRP)

- `isBlankAnswerValue(value: string): boolean` exported from state.ts (:46) = `value.trim() === ""`.
- `applyAnswer` throws `blank answer value rejected (question {id}) — state-and-persistence.md :141` BEFORE any mutation, no `changed` emission.
- Editor ingress: `writeInEnter` blank branch → `panel.flash("Answer cannot be blank")` + stay in editor. Fallback `recordAnswers` → `rejected: string[]` bucket; tool.ts renders `blank value not recorded: {ids}`. Submit reconciliation skips blank drafts + blank prior values.
- S1's PRP explicitly assigns reconstruct.ts:438/:466 widening to S2 and forbids S1 from touching reconstruct.ts. No file overlap.

## Test harness patterns

- **reconstruct.test.ts** :954-1018 (BUG-007 describe): `branchWithSubmission(changed: diff[])` fixture — `seededState()`, `toolResultEntry(base)`, `submissionEntry({changed, epoch})`, `makeCtx(entries)`, `makeHost()`, `reconstructFromBranch(ctx, makeOpts(host))`, then assert `result.source/replayed`, `state.getQuestion(id).answer/status`, `state.epoch`. The `diff(id, to, value?)` helper builds DiffEntry-like objects. EXTEND this describe + add new describes.
- **session-restore.test.ts** (P3.M3.T1.S2): module docs :1-56; fixtures :56-120 (`tmpDir`, `textQ`, `choiceQ`, `typedEditor`, `PROBE`, ENTER="\r", T0); harness :125-380 (`makeSession({dir, walkIds, questions, extra})` → `{panel, state, durable, capture, key}`; `rebindDeps`, `inertEngine`, `typeInto`); **case-4 commit-half restart pattern :383-430** — session1 types/commits through the REAL writeInEnter seam, capture retired at handoff, then session2 = fresh stores over the SAME tmpdir + GROWN walk (`[e1]` → `[e1, e2]`) with the base + submission delta scripted into the walk. This is the exact shape for case 5's restart half — EXCEPT in case 5 the whitespace draft is NOT retired (no commit) → the durable draft survives → reopen seeds the NEWER draft over the recorded answer (P3.M3.T1.S1 seeding precedence: newer draft > recorded answer > blank; "intentional deletion to empty is an edit").
- Restart reopen flow: reconstruction's `restoreDrafts` hook (reconstruct.test.ts:1240 describe, P3.M3.T1.S2) seeds durable drafts after replay.

## Case-5 script decomposition (5 sentences → test sections)

1. Reopen committed Other/text answer → editor seeds the EXACT recorded value (no newer draft — retired at commit handoff); byte-exact probe (reuse PROBE-style value).
2. Clear / whitespace + enter → S1 rejection (consumed, `footerFlash.text === "Answer cannot be blank"`, focus stays `"text"`, textDuty `"writein"`, buffer intact) → capture-on-edit holds the whitespace/empty draft durably → hard-kill model (abandoned references, no dispose/flush) → restart with walk = base + original commit's submission delta (the rejected blank NEVER entered history — zero-trace) → reopen: editor seeds the NEWER (blank-ish) draft; state still carries the prior answer (replayed); counts answered=1.
3. Non-editor ingress: real `fallback.recordAnswers` blank entry → rejected bucket, prior preserved, `tool.ts` status line renders `blank value not recorded: {ids}`.
4. Replay legacy blank WITHOUT prior valid answer → skipped: no answer, open, replayed 0, epoch unchanged, groupSummaries answered=0.
5. Replay legacy blank WITH prior valid answer (two submissions) → prior answer kept, answered=1.

## Commands (verified)

`npm test`, `npm run typecheck`, `npm run lint` (same as S1's PRP; package.json).

---
name: "P3.M4.T1.S2 — Reconstruction/replay blank guards + acceptance case 5 (Local input recovery)"
description: "MODIFY src/reconstruct.ts: (a) widen replaySubmission's skip check (:466) from `resolved === \"\"` to `isBlankAnswerValue(resolved)` (imported from state.ts) so a legacy whitespace delta is SKIPPED instead of crashing reconstruction on P3.M4.T1.S1's new applyAnswer throw — raw blanks never fabricate from `to`; the pinned `value: \"\"` → `to` fallback stays untouched; (b) add a scrubLegacyBlankAnswers payload pass over base candidates (BEFORE tryDeserialize, in the candidates loop) that clears blank `answer` objects and reverts `answered`/`submitted` → `open` — legacy BASE snapshots can carry blanks (deserialize accepts any string) and would otherwise count as validly answered (groupSummaries is status-keyed). EXTEND src/reconstruct.test.ts: replay-blank-guard units (blank-only skipped; prior-valid-wins across two submissions; no fabrication from to; counts/epoch assertions) + base-scrub units. CREATE src/blank-rejection.test.ts: scripted acceptance case 5 (spec :149) — reopen committed answer → exact value; clear/whitespace + enter → S1 rejection (focus kept, flash), restart + reopen → newer draft wins, prior answer unchanged (zero-trace: the rejected blank never entered history), counts correct; blank rejection through non-editor ingress (real fallback recordAnswers + tool status line); replay legacy blank with/without prior valid answer. Consumed by P3.M5.T1.S1 (full gate cases 1-5). No README/spec changes (P3.M5.T1.S2 owns docs)."
---

## Goal

**Feature Goal**: On reconstruction/replay, a historical blank answer can NEVER replace a valid answer, never count or appear as validly answered/submitted, and never fabricate missing text (spec `state-and-persistence.md` :141). Two guards in `src/reconstruct.ts`: (1) **delta replay skip** — `replaySubmission`'s resolved-value check widens from `resolved === ""` to `isBlankAnswerValue(resolved)` (the predicate exported by P3.M4.T1.S1), which is also a CRASH FIX: S1's `applyAnswer` now throws on blank, and a legacy whitespace delta (`raw = "  "` passes the `raw !== ""` structural check at :462) would otherwise throw inside replay and break reconstruction entirely; (2) **base scrub** — legacy base snapshots can carry `answer: {value: "  "}` with status `answered`/`submitted` (deserialize accepts any string), so a payload-level pass clears blank answers and reverts those statuses to `open` before the base is deserialized — the answered/submitted counters (`groupSummaries()`, the status-line single source of truth) can never read a blank as answered. Plus the scripted **acceptance case 5** (spec :149), the last case P3.M5.T1.S1's full gate consumes.

**Deliverable**:
1. `src/reconstruct.ts` (modify) — widen the :466 skip check with `isBlankAnswerValue`; add `scrubLegacyBlankAnswers(data)` (payload pass, before `tryDeserialize` in the candidates loop); JSDoc updates (replaySubmission's resolution comment + the module JSDoc replay step).
2. `src/reconstruct.test.ts` (extend) — a "replay blank guards" describe (delta-borne units) + a "base blank scrub" describe; the BUG-007 pinned tests (`""` → `to` fallback, sentinel skip) stay green UNTOUCHED.
3. `src/blank-rejection.test.ts` (new) — acceptance case 5 as five scripted sections, harness adapted from `session-restore.test.ts` (restart pattern, case-4 commit-half) + `reconstruct.test.ts` (`branchWithSubmission` fixtures).

**Success Definition**: `npm test`, `npm run typecheck`, `npm run lint` all green. A restart whose history contains a whitespace delta reconstructs WITHOUT throwing: the blank entry is skipped (`replayed` does not count it, no epoch burn), any prior valid answer survives, a blank-only question stays `open`. A base carrying a blank answer reconstructs to no-answer + `open` (or its terminal status preserved) and `groupSummaries()` never counts it as answered/submitted. Case 5's script passes end to end: exact-value reopen, rejected blank edit (focus kept + flash), restart → newer draft wins + prior answer unchanged, non-editor rejection surfaces `blank value not recorded: {ids}`, replay blanks correct with and without prior answers.

## User Persona (if applicable)

**Target User**: The pi user who restarts (or branch-navigates into) a session whose history predates the blank-rejection guard, and the model that later reads the reconstructed state.

**Use Case**: A legacy session file contains a submission delta (or base snapshot) recording a whitespace-only answer — an artifact of the guard-less era. On restart, reconstruction must not crash (the S1 throw), must not show the blank as a real answer, must keep any earlier valid answer, and must not invent text from the entry's label summary.

**User Journey**: restart pi → reconstruction replays history → blank deltas skip silently, blank base answers scrub to open → panel/reopen shows the prior valid answer (or an unanswered question) and honest counts → the user never sees a phantom blank "answer".

**Pain Points Addressed**: S1's shared throw turns any legacy whitespace delta into a reconstruction crash; without the base scrub, a legacy blank keeps counting as answered/submitted; naive `to`-fallback would fabricate an answer the user never gave.

## Why

- Binding spec: `spec/state-and-persistence.md` :141 — "On reconstruction/replay, a historical blank must neither replace a valid answer nor count or appear as validly answered/submitted; do not fabricate missing text" — and acceptance case 5 :149 (S2 owns the replay/restart halves; S1's PRP pinned this split). READ-ONLY spec.
- Completes P3.M4.T1: S1 landed the shared `applyAnswer` throw + live-ingress rejections and EXPLICITLY assigned this item the replay widening (its applyAnswer JSDoc names "P3.M4.T1.S2's replay filter" as a predicate consumer; its PRP says "reconstruct.ts:443 calls applyAnswer with a resolved historical value whose existing guard only catches '' — a whitespace-only LEGACY delta would now throw at replay. That is P3.M4.T1.S2's widening target").
- Crash fix is load-bearing: without this item, S1 alone makes legacy-session restarts THROW inside `replaySubmission` — a regression hazard shipped the moment S1 lands.
- Architecture authority: `plan/006_45773b259b06/architecture/input-recovery.md` P3.M4 boundary ("recovered blank drafts seed the editor but never become answers — blank rejection lives at `applyAnswer`"); this item extends the same guarantee to RESTORED HISTORY.
- Downstream: P3.M5.T1.S1 runs scripted acceptance cases 1–5 over this item's script; P3.M5.T1.S2 syncs docs (not this item).

## What

### Behavior

1. **Delta replay skip (replaySubmission, :446-483)**: the skip condition at :466 becomes `if (typeof resolved !== "string" || isBlankAnswerValue(resolved) || resolved === UNANSWERED_SUMMARY) continue;`. The :462 resolution rule is UNCHANGED: `value: ""` still means "no raw recorded" → falls back to `to` (pinned BUG-007 test); a whitespace `value` resolves to ITSELF (it passes `raw !== ""`) and is then skipped by the widened check — it must NOT fall back to `to` ("do not fabricate missing text": the raw post-change value says the answer was blank). A raw-absent entry whose `to` is blank/whitespace is skipped too (today only `""`/sentinel skip). Skipped entries: no `applyAnswer`, no `applied++`, no `replayed` credit, no epoch burn (h3.6 one-bump-only-when-applied holds). Chronological replay order means an earlier submission's valid answer automatically survives a later blank entry — "prior valid answer wins" is structural.
2. **Base scrub (candidates loop, :555-566)**: a `scrubLegacyBlankAnswers(data: unknown): void` pass runs on `candidate.data` (the plain parsed-JSON payload) BEFORE `tryDeserialize(candidate.data)`. For each question object in `data.questions`: if `answer` is an object whose `value` is a string and `isBlankAnswerValue(value)` → delete `answer`; then if `status` was `"answered"` or `"submitted"` → set `"open"`. Terminal statuses (`moot`, `withdrawn`, `closed`) and `reasked` keep their status (answer cleared only) — the scrub must never resurrect or un-terminal a question; only `answered`/`submitted` count as validly answered in `groupSummaries()`. No epoch involvement (pre-deserialize). Mutating the parsed-JSON candidate in place is safe (walk data is freshly parsed); the strict-guards-toward-untrusted-persisted-data precedent is deserialize itself and BUG-001.
3. **Counters**: `groupSummaries()` (state.ts:310-334, `summary[q.status]++`) is the counter source the status line renders. With the two guards, no blank can hold `answered`/`submitted` — counters are correct by construction; tests assert the tallies directly.
4. **Acceptance case 5 script (new file `src/blank-rejection.test.ts`)** — five sections mirroring :149's sentences verbatim (see Implementation Tasks for the exact scenarios).
5. **OUT OF SCOPE (hard boundaries)**: `src/state.ts` (S1 owns; its exported predicate is consumed, not modified), `src/panel/actions.ts` / `fallback.ts` / `tool.ts` (S1's live ingresses — the case-5 script only CALLS them), the sidechat parser, `merge.ts` / `ripple-confirm.ts` / `debug-commands.ts`, capture/retirement/restore seams (P3.M2/P3.M3 own), README/spec/docs sync (P3.M5.T1.S2), any semantic validation beyond blankness, any model calls, any changes to the `""` → `to` pinned fallback behavior.

### Success Criteria

- [ ] A submission delta with `value: "  "` (and `"\n\t"`, and a `PROBE`-style whitespace-only string) on an unanswered question: skipped — no answer, status stays prior, `result.replayed` unchanged, `state.epoch` unchanged, `groupSummaries()` answered/submitted unchanged; NO throw anywhere.
- [ ] No-fabrication: delta `value: "  "` with `to: "Beta"` → skipped, NOT answered `"Beta"`.
- [ ] Prior-valid-wins: two chronological submissions (valid `"alpha"`, then blank `"  "`) → answer stays `"alpha"`, status `answered`, counts answered=1; the blank submission earns no `replayed` credit and no epoch bump beyond the first's.
- [ ] Blank `to` fallback (raw absent, `to: "  "`) → skipped; `UNANSWERED_SUMMARY` sentinel skip unchanged.
- [ ] The pinned BUG-007 tests (`""` → `to` label fallback; sentinel skip) pass UNTOUCHED.
- [ ] Base scrub: base payload with `answer: {value: "  "}, status: "answered"` → reconstructed state has NO answer, status `open`, counts answered=0; `"submitted"` variant → `open`; `moot`+blank variant → answer cleared, status stays `moot`; base-blank + later valid delta → delta applies (question becomes answered — scrub does not block legitimate replay).
- [ ] Case 5 script green: exact-value reopen (byte-exact probe); rejected blank edit stays in the editor (`footerFlash.text === "Answer cannot be blank"`, focus `"text"`, `textDuty === "writein"`, buffer intact); restart → reopen seeds the NEWER blank-ish draft, prior answer byte-unchanged in state, counts answered=1; non-editor ingress → `rejected` bucket + `blank value not recorded: {ids}` line, prior preserved.
- [ ] `npm test`, `npm run typecheck`, `npm run lint` all green; S1's tests untouched-green; no changes outside `src/reconstruct.ts`, `src/reconstruct.test.ts`, `src/blank-rejection.test.ts`.

## All Needed Context

### Context Completeness Check

Validated: spec :141/:149 read verbatim; S1's PRP read as contract and its landed seams verified in the working tree (`isBlankAnswerValue` exported at state.ts:46; `applyAnswer` throw at :396-404); `replaySubmission` read line-by-line (:446-483) with the crash path proven (`raw="  "` → :462 passes → :466 misses → :467 throws); the candidates loop + `tryDeserialize` + `setState` read (:555-585); `deserialize`'s answer guard (:611-618) confirmed to accept blank strings (the base-borne hazard) and `questions` confirmed PRIVATE (state.ts:274 — why the scrub is payload-level); `groupSummaries` confirmed status-keyed (:310-334); the replay loop's chronological order + epoch rule read (:595-606, :482); both test harnesses read (reconstruct.test.ts BUG-007 fixtures :954-1018; session-restore.test.ts fixtures/harness/case-4 restart :1-430); pinned tests identified ("" → to fallback, sentinel skip); parallel-item file overlap checked (NONE: S1 owns state.ts/actions.ts/fallback.ts/tool.ts + their tests; P3.M3 owns session-restore.test.ts — read-only precedent here; this item owns reconstruct.ts/reconstruct.test.ts + one new file). Full detail: `plan/006_45773b259b06/P3M4T1S2/research/findings.md`.

### Documentation & References

```yaml
- file: spec/state-and-persistence.md
  why: §Local input recovery :141 — the reconstruction/replay sentence ("neither replace a valid
    answer nor count or appear as validly answered/submitted; do not fabricate missing text") and
    acceptance case 5 :149 (verbatim) — the two halves this item implements
  gotcha: READ-ONLY — never edit spec/; the LIVE halves of :141/:149 are S1's, already landed

- file: plan/006_45773b259b06/P3M4T1S1/PRP.md
  why: the SIBLING CONTRACT — defines isBlankAnswerValue (exactly value.trim() === "", exported
    from state.ts), the applyAnswer throw contract (before any mutation, no changed emission),
    the editor flash string "Answer cannot be blank", the fallback rejected bucket, and the
    tool.ts "blank value not recorded: {ids}" line the case-5 script asserts against
  gotcha: treat as already-implemented EXACTLY as specified; do not modify its files; its PRP
    explicitly assigns this item the :466 widening

- file: plan/006_45773b259b06/architecture/input-recovery.md
  why: P3.M4 boundary — blank rejection lives at applyAnswer; recovered/restored blanks never
    become answers; S2 = replay guards + case-5 restart halves
  gotcha: READ-ONLY plan artifact

- file: src/reconstruct.ts
  why: replaySubmission :446-483 (raw resolution :462, THE widening target :466, applyAnswer :467,
    bumpEpoch :482); candidates loop :555-566 (tryDeserialize call site — where the payload scrub
    goes); setState :585; replay loop :595-606 (chronological; position/epoch filters); module
    JSDoc steps (update the replay step's wording)
  pattern: widen the existing guard in place; keep the resolution rule ("" → to) untouched; the
    skip is `continue` — never an exception toward persisted data
  gotcha: value imports come from "./state.js" — add isBlankAnswerValue there (type imports
    already exist); reconstruct NEVER writes to persistence (scrub mutates only the in-memory
    parsed candidate, not any file)

- file: src/state.ts (READ-ONLY here)
  why: isBlankAnswerValue :46 (the predicate — consume, don't redefine); applyAnswer :396-404
    (the throw this item must never trip from replay); deserialize :512 + answer shape guard
    :611-618 (accepts any string value — the proof base-borne blanks are reachable);
    groupSummaries :310-334 (status-keyed counters — the "counts" assertion seam); questions map
    is PRIVATE :274 (why the scrub is payload-level, pre-deserialize)
  gotcha: state.ts belongs to S1 — zero modifications in this item

- file: src/reconstruct.test.ts
  why: BUG-007 describe :954-1018 — branchWithSubmission(diff(...)) fixture, seededState,
    toolResultEntry, submissionEntry({changed, epoch}), makeCtx, makeHost, makeOpts, and the
    assertion vocabulary (result.replayed, state.epoch, getQuestion answer/status); the restoreDrafts
    describe :1240 (restart-draft seeding context); base-selection describe :227 (payload fixture
    shapes for the scrub tests)
  pattern: extend the BUG-007 describe for replay-rule units; add NEW describes for the guards
    and the scrub; keep the "" → to and sentinel tests byte-untouched
  gotcha: diff(id, to, value?) builds the entry; TWO submissionEntry's in the entries array model
    chronological submissions for prior-valid-wins

- file: src/panel/session-restore.test.ts (READ-ONLY precedent — P3.M3's file)
  why: the restart harness the case-5 script adapts — module docs + crash model :1-56 ("abandoned
    references — NO dispose, NO forceFlush-after, NO shutdown handler"), fixtures :56-120 (tmpDir,
    textQ, choiceQ, typedEditor, PROBE, ENTER="\r"), harness :125-380 (makeSession({dir, walkIds,
    questions, extra}) → {panel, state, durable, capture, key}; rebindDeps; inertEngine; typeInto),
    and the case-4 commit-half restart pattern :383-430 (session1 commits through the REAL
    writeInEnter seam; session2 = fresh stores over the SAME tmpdir + GROWN walk [e1]→[e1,e2]
    with base + submission delta scripted into the walk)
  gotcha: do NOT modify this file; copy/adapt the harness into the new blank-rejection.test.ts;
    case 5 differs from case-4 side B in that the whitespace draft is NOT retired (no commit) —
    the durable draft survives the kill and must win the reopen seeding

- file: src/input-restore.ts (READ-ONLY context)
  why: the seeding precedence the restart half exercises — newer matching draft > recorded
    answer > blank; "an intentional deletion to empty is an edit, not an absent draft: preserve
    the empty editor" (the cleared variant seeds EMPTY, the whitespace variant seeds the
    whitespace — both beat the recorded answer)

- file: src/fallback.ts + src/tool.ts (READ-ONLY here — S1's)
  why: recordAnswers' rejected bucket + the record action's "blank value not recorded: {ids}"
    line — the real seams the case-5 non-editor-ingress section calls
```

### Current Codebase tree (relevant slice)

```bash
src/reconstruct.ts            # MODIFY — widen :466 skip; add payload scrub; JSDoc
src/reconstruct.test.ts       # EXTEND — replay-blank + base-scrub describes
src/blank-rejection.test.ts   # CREATE — scripted acceptance case 5
src/state.ts                  # READ-ONLY (S1) — isBlankAnswerValue, applyAnswer throw, groupSummaries
src/fallback.ts               # READ-ONLY (S1) — rejected bucket (called by case-5 script)
src/tool.ts                   # READ-ONLY (S1) — record status line (asserted by case-5 script)
src/panel/session-restore.test.ts  # READ-ONLY precedent — restart harness (cases 1/4)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/reconstruct.ts            # replay skip widened to isBlankAnswerValue; scrubLegacyBlankAnswers
                              #   payload pass in the candidates loop; module/replay JSDoc updated
src/reconstruct.test.ts       # "replay blank guards (P3.M4.T1.S2)" + "base blank scrub" describes
src/blank-rejection.test.ts   # NEW — acceptance case 5 (:149), five scripted sections; own lean
                              #   makeSession-style harness adapted from session-restore.test.ts
# NO other files change: state.ts / actions.ts / fallback.ts / tool.ts / sidechat* / panel.ts /
# input-*.ts / session-restore.test.ts / README / spec / scripts are all untouched
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: the widened check must NOT change the resolution rule at :462 — `value: ""` still
// falls back to `to` (pinned BUG-007 test "empty-string value falls back to the label summary");
// only whitespace strings are NEWLY skipped, and they must skip WITHOUT consulting `to`
// (fabrication ban). Widen :466 only; leave :462 byte-identical.
// CRITICAL: S1's applyAnswer THROWS on blank — replay must never reach it with a blank; a
// whitespace delta that escapes the widened check is a reconstruction CRASH, not a soft skip.
// Test the exact crash shape (raw "  " with to "Beta") before and after the fix.
// CRITICAL: the base scrub runs on the PLAIN JSON payload BEFORE tryDeserialize — `questions`
// is private on InterrogationState (state.ts:274), a deserialized state cannot be scrubbed from
// reconstruct.ts, and this item must not add methods to state.ts (S1's file).
// CRITICAL: scrub statuses conservatively — ONLY "answered" and "submitted" revert to "open";
// moot/withdrawn/closed/reasked keep their status (a blank answer must never resurrect or
// un-terminal a question; only answered/submitted count as validly answered in groupSummaries).
// GOTCHA: skipped blank entries burn NO epoch and earn NO replayed credit — h3.6 bumps once per
// APPLIED submission; assert state.epoch and result.replayed in every replay unit.
// GOTCHA: `at: new Date().toISOString()` in replaySubmission stays fresh — irrelevant to blanks.
// GOTCHA: the restart-half crash model is "abandoned references" (session-restore.test.ts :9-11):
// no dispose, no forceFlush-after, no shutdown handler on the killed side; the whitespace edit
// must be forceFlushed to durable BEFORE the kill (the sanctioned completed-save seam).
// GOTCHA: in the restart half the rejected blank NEVER entered history (S1's reject is
// zero-trace: no mutation, no delta) — the walk must contain ONLY the original valid commit's
// submission delta; asserting the prior answer after restart pins the zero-trace property.
// GOTCHA: eslint unused vars need leading underscore; these are synchronous paths — real timers
// fine (no fake timers needed); ENTER is "\r" in the harness precedent.
// GOTCHA: reconstruct.ts never persists — the scrub mutates only the in-memory parsed candidate
// object; session files on disk are untouched (read-only toward persistence).
```

## Implementation Blueprint

### Data models and structure

```ts
// src/reconstruct.ts — imports (extend the existing "./state.js" import):
import { ..., isBlankAnswerValue, ... } from "./state.js";

// replaySubmission :466 — the widening (ONLY change in this function):
// BEFORE:  if (typeof resolved !== "string" || resolved === "" || resolved === UNANSWERED_SUMMARY) continue;
// AFTER:
if (
  typeof resolved !== "string" ||
  isBlankAnswerValue(resolved) || // P3.M4.T1.S2 (spec :141): a historical blank neither
  // replaces a valid answer nor counts as answered — and never fabricates from `to`
  // (the raw resolution above keeps `value: ""` → `to` legacy fallback intact).
  resolved === UNANSWERED_SUMMARY
) {
  continue;
}
// Update replaySubmission's comment block: note that S1's applyAnswer throws on blank,
// so this skip is load-bearing (a missed blank = reconstruction crash), and that a
// whitespace `value` skips WITHOUT consulting `to` (fabrication ban).

// src/reconstruct.ts — the base scrub (new module-level helper, near isPlausibleBase):
/**
 * P3.M4.T1.S2 (spec state-and-persistence.md :141): legacy base snapshots
 * (serialized before the applyAnswer blank guard existed) can carry blank
 * answer values. Scrub them at the PAYLOAD level, before deserialize —
 * `questions` is private on InterrogationState, and reconstruct never
 * writes back to persistence (the session file itself is untouched).
 * A cleared blank reverts `answered`/`submitted` → `open` (only those two
 * count as validly answered — groupSummaries is status-keyed); terminal
 * statuses keep their status (a blank never resurrects/un-terminals).
 */
function scrubLegacyBlankAnswers(data: unknown): void {
  if (!isObj(data) || !isObj(data.questions)) return;
  for (const q of Object.values(data.questions)) {
    if (!isObj(q) || !isObj(q.answer)) continue;
    const value = (q.answer as Record<string, unknown>).value;
    if (typeof value !== "string" || !isBlankAnswerValue(value)) continue;
    delete q.answer;
    if (q.status === "answered" || q.status === "submitted") q.status = "open";
  }
}

// candidates loop :555-566 — call it first (scrub every candidate is harmless and
// keeps the plausibility check + deserialize reading the same clean payload):
for (const candidate of candidates) {
  scrubLegacyBlankAnswers(candidate.data); // P3.M4.T1.S2 — before tryDeserialize
  const candidateState = tryDeserialize(candidate.data);
  ...
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/reconstruct.ts — the delta-replay widening
  - ADD isBlankAnswerValue to the "./state.js" value import
  - WIDEN the :466 skip condition per the data model (resolution rule :462 untouched)
  - UPDATE replaySubmission's comment block + the module JSDoc's replay step (a
    historical blank skips: prior valid wins, blank-only stays unanswered, no
    fabrication, no epoch burn, and the skip protects against S1's throw)

Task 2: EXTEND src/reconstruct.test.ts — "replay blank guards (P3.M4.T1.S2)" describe
  - Reuse branchWithSubmission/fixtures from the BUG-007 describe (:954-1018)
  - UNITS (all assert result.replayed, state.epoch, getQuestion answer+status, AND
    groupSummaries() tallies):
    a. whitespace value skipped, no fabrication: diff("q1", "Beta", "  ") → no
       answer, open, replayed 0, epoch unchanged, ungrouped summary answered=0
       (also "\n\t " and a whitespace-only PROBE-style multiline string)
    b. blank-only via to: diff("q1", "  ") (raw absent) → skipped (widened check)
    c. prior-valid-wins: entries = [toolResultEntry(base), submissionEntry(valid
       "alpha"), submissionEntry(blank "  ")] → answer "alpha", answered, replayed 1,
       ONE epoch bump (from the first submission only), counts answered=1
    d. blank on an ALREADY-answered base (base carries a valid answer; delta blank)
       → prior answer survives the blank delta
  - VERIFY untouched: the "" → to fallback test and the sentinel skip test stay green

Task 3: MODIFY src/reconstruct.ts + EXTEND src/reconstruct.test.ts — the base scrub
  - ADD scrubLegacyBlankAnswers + the candidates-loop call per the data model
  - UNITS ("base blank scrub (P3.M4.T1.S2)" describe, payload fixtures shaped like
    the base-selection describe's :227 envelopes):
    a. base answer {value: "  "}, status "answered" → no answer, open, answered=0
    b. same with status "submitted" → open, submitted=0
    c. blank answer + status "moot" → answer cleared, status STAYS "moot" (counts
       moot=1, answered=0) — the no-resurrection rule
    d. base blank + later valid delta → scrub does not block replay: answered
  - JSDoc on the helper cites spec :141 and the payload-level rationale

Task 4: CREATE src/blank-rejection.test.ts — scripted acceptance case 5 (:149)
  - HARNESS: adapt session-restore.test.ts's fixtures + makeSession (tmpDir/afterEach
    cleanup, resetState + resetSidechatForTests in beforeEach, textQ/choiceQ,
    typedEditor/typeInto, ENTER="\r", durable capture composition, GROWN-walk
    restart [e1]→[e1,e2] with base + submission delta scripted — see :56-430)
  - SECTION 1 — "reopen a committed Other/text answer → exact value": commit a
    write-in with a byte-exact PROBE-style value through the REAL writeInEnter
    seam (handleInput(ENTER)), reopen (focusTextField("writein") again — capture
    retired at the commit handoff, no newer draft) → getText() === exact value
  - SECTION 2 — the restart half: reopen → clear (or type only whitespace) →
    handleInput(ENTER) → S1 rejection: consumed true, footerFlash.text ===
    "Answer cannot be blank", focus "text", textDuty "writein", buffer intact,
    no answer change, no advance; forceFlush the whitespace edit (completed save);
    HARD KILL (abandoned references); RESTART with walk = base + the original
    commit's submission delta (the rejected blank never entered history); reopen →
    the editor seeds the NEWER blank-ish draft (empty for the cleared variant /
    whitespace for the typed variant — P3.M3.T1.S1 precedence), the prior answer
    byte-unchanged in state, groupSummaries answered=1, replay completed without
    any blank reaching applyAnswer
  - SECTION 3 — non-editor ingress: real fallback recordAnswers on a fresh state —
    record a valid answer, then a blank overwrite entry → rejected bucket, prior
    answer preserved, and the record action's rendered lines include
    "blank value not recorded: {ids}" (call the real tool.ts seam or its render
    helper exactly as S1's tool.test.ts does)
  - SECTION 4 — replay legacy blank WITHOUT prior valid answer: reconstruct.test.ts
    Task-2a scenario re-run here at acceptance grain → resulting answer undefined,
    open, counts answered=0
  - SECTION 5 — replay legacy blank WITH prior valid answer: Task-2c scenario →
    resulting answer "alpha", answered=1
  - FILE DOC HEADER: cite spec :149 verbatim and the S1/S2 half-split; note the
    file is the case-5 artifact P3.M5.T1.S1's full gate consumes

Task 5: FULL GATE + static audit
  - npm test && npm run typecheck && npm run lint — all green
  - AUDIT: `rg "applyAnswer\(" src --type ts | grep -v test` — reconstruct.ts is now
    blank-safe (skip via the predicate + payload scrub); every production caller
    either pre-checks, is structurally safe, or throws loudly (S1's audit table +
    this item's two guards = full coverage)
  - CONFIRM no diff outside src/reconstruct.ts, src/reconstruct.test.ts,
    src/blank-rejection.test.ts
```

### Implementation Patterns & Key Details

```ts
// PATTERN: the skip (not throw) toward persisted data — replay treats untrusted
// history with strict guards and CONTINUES; only the live seam (applyAnswer) throws:
if (typeof resolved !== "string" || isBlankAnswerValue(resolved) || resolved === UNANSWERED_SUMMARY) continue;

// PATTERN: prior-valid-wins is STRUCTURAL — replay walks submissions chronologically;
// skipping a blank leaves whatever an earlier submission applied. No look-ahead,
// no per-question special casing in the loop.

// PATTERN: payload-level scrub (mirror deserialize's own isObj strictness):
if (!isObj(data) || !isObj(data.questions)) return; // tolerate any garbage silently
// GOTCHA: scrub BEFORE tryDeserialize so plausibility, replay, and the surface
// decision all see the same clean payload — never scrub twice or after install.
```

### Integration Points

```yaml
RECONSTRUCTION SEAM (the only production integration):
  - reconstruct.ts replaySubmission: blank resolved values skip (imports
    isBlankAnswerValue from ./state.js — signature (value: string) => boolean, S1's)
  - reconstruct.ts candidates loop: scrubLegacyBlankAnswers(candidate.data) first
  - NO persistence writes; no events beyond replay's ordinary applyAnswer emissions

COUNTERS:
  - groupSummaries() needs NO change — guards upstream keep blanks out of
    answered/submitted statuses; the status line keeps rendering the same counters

CONSUMERS:
  - P3.M5.T1.S1 runs acceptance cases 1-5; case 5 = src/blank-rejection.test.ts
    (+ the reconstruct.test.ts guard units). No interface changes for it.

NO DATABASE / CONFIG / ROUTES / STRINGS: pure in-process logic; no settings
  surface; no user-visible strings added (S1's flash + status line are reused)
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run lint            # eslint src scripts *.ts — zero errors
npm run typecheck       # tsc --noEmit — zero errors
# Run after each file change; fix before proceeding.
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/reconstruct.test.ts -t "blank"        # new guard + scrub units
npx vitest run src/reconstruct.test.ts -t "BUG-007"      # pinned resolution rules stay green
npx vitest run src/blank-rejection.test.ts               # case 5, all five sections
# Expected: all green. Then the component neighborhood (S1's seams must be untouched-green):
npx vitest run src/reconstruct.test.ts src/blank-rejection.test.ts src/state.test.ts src/fallback.test.ts src/tool.test.ts
```

### Level 3: Integration Testing (System Validation)

```bash
npm test                # the entire suite — the real gate
# Watch specifically for collateral: session-restore (P3.M3 cases 1/4), input-*,
# editor-preservation, two-stage, keymap-ac, ac-* suites must be green UNTOUCHED
# (this item changes no capture/retirement/restore/live-ingress behavior).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Static seam audit — replay can no longer reach applyAnswer with a blank:
rg "applyAnswer\(" src --type ts | grep -v test
# reconstruct.ts's call site must sit behind the isBlankAnswerValue skip (read it).
# Crash-fix proof: temporarily revert ONLY the :466 widening in a scratch check (do
# not commit) and confirm Task-2a fails with the S1 throw — the test pins the crash.
# Manual logic walk (no TUI harness needed — all paths unit-covered):
# 1) legacy walk: submission delta {value: "  ", to: "Beta"} → restart → q unanswered
# 2) legacy base: snapshot answer "  " answered → restart → open, counts answered=0
# 3) case 5 end-to-end: commit → reopen (exact) → whitespace + enter (flash, focus
#    kept) → kill → restart → reopen (newer blank draft wins; prior answer intact)
```

## Final Validation Checklist

### Technical Validation

- [ ] All 4 validation levels completed; `npm test`, `npm run typecheck`, `npm run lint` green
- [ ] Diff confined to `src/reconstruct.ts`, `src/reconstruct.test.ts`, `src/blank-rejection.test.ts`
- [ ] BUG-007 pinned tests (`""` → `to` fallback, sentinel skip) byte-untouched and green

### Feature Validation

- [ ] All Success Criteria boxes checked (skip widening, no-fabrication, prior-valid-wins, base scrub incl. no-resurrection, counts, case-5 script)
- [ ] No blank can reach `applyAnswer` from replay, and no base blank can hold `answered`/`submitted` after reconstruction
- [ ] S1's files (state.ts, actions.ts, fallback.ts, tool.ts) and P3.M3's session-restore.test.ts byte-untouched
- [ ] Zero-trace property pinned: a rejected blank never appears in any walk/delta/state after restart

### Code Quality Validation

- [ ] JSDoc updated where behavior changed (replaySubmission comment, module JSDoc replay step, scrub helper) citing spec :141
- [ ] Follows existing patterns (strict isObj guards toward untrusted data, continue-not-throw in replay, harness reuse)
- [ ] No new mechanisms, no new strings, no state.ts surface changes

### Documentation & Deployment

- [ ] No README/spec/docs changes (owned by P3.M5.T1.S2); no new env vars; no config

## Anti-Patterns to Avoid

- ❌ Don't change the :462 resolution rule — `value: ""` → `to` is a PINNED legacy tolerance; only the :466 skip widens
- ❌ Don't fall back to `to` when the raw value is whitespace — that fabricates an answer the user never gave (spec :141 ban)
- ❌ Don't catch/absorb S1's applyAnswer throw around the replay call — prevent reaching it (skip); a swallowed throw would hide real bugs
- ❌ Don't scrub a DESERIALIZED state (private fields) or add methods to state.ts — payload-level, pre-deserialize, reconstruct.ts only
- ❌ Don't revert terminal statuses when scrubbing — a blank never un-moots/un-withdraws/un-closes a question
- ❌ Don't burn epoch or `replayed` credit on skipped blanks — h3.6 bumps only per APPLIED submission
- ❌ Don't touch S1's files, session-restore.test.ts, the sidechat parser, or any capture/retirement/restore seam
- ❌ Don't add semantic validation, trimming of stored values, or model calls — blankness only, per spec :141

---

**Confidence Score: 9/10** — the crash path, both guard placements, the private-fields constraint forcing payload-level scrub, the pinned tests to preserve, and both harness precedents were all verified line-by-line in the working tree; the only residual uncertainty is incidental harness detail in the new case-5 file (session-restore.test.ts's makeSession internals are read-adapted, not copied blind), which the implementer resolves by reading the cited ranges.

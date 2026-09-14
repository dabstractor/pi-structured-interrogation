# Scout findings — bug-fix plan research (repo: pi-structured-interrogation)

## Files read (exact locations)
- `src/delivery.ts` (1-140, 129-175) — buildSubmission, SubmissionMessage, SUBMISSION_REMINDER
- `src/completion.ts` (full) — attemptCompletion, BLOCKING set, createCompletionTrigger
- `src/lifecycle.ts` (full) — close pass, ACTIVE_STATUSES, agent_settled wiring
- `src/fallback.ts` (full) — isNonTui, buildFallbackDigest, recordAnswers
- `src/depends-on.ts` (full) — evaluateDependsOn, dependencyMet, SKIP_EVALUATION
- `src/snapshots.ts` (full) — DiffEntry, SubmissionCardData, answerSummary, computeDiff
- `src/reconstruct.ts` (200-360) — walkBranch, replaySubmission, reconstructFromBranch
- `src/detect.ts` (full) — round detector (TUI-only turn_end; NOT submission detection)
- `src/state.ts` (330-360, 385-400, QuestionStatus union ~lines 168-176) — applyAnswer, clearForCompletion
- `src/merge.ts` (245-270) — markSubmitted, closeSubmitted
- `src/index.ts` (grep: 62-75) — lifecycle + completion trigger wiring
- `src/tool.ts` (grep: 325) — recordAnswers call site
- `src/debug-commands.ts` (grep: 170-203) — the TUI submit flush DOES call markSubmitted

---

## BUG-003 — CONFIRMED: buildSubmission content lacks the epoch segment
`src/delivery.ts:129-175`
```ts
export function buildSubmission(state: InterrogationState, diff: SubmissionCardData, note?: string): SubmissionMessage
```
Content built at line 162:
```ts
const content = `Submitted ${k}: ${k === 0 ? "(no changes)" : list}\n${SUBMISSION_REMINDER}${noteLine}`;
```
- Reminder line (line 43): `export const SUBMISSION_REMINDER = "Consider how these affect your other questions.";`
- No `(state epoch {n})` anywhere in content. `state` param is used ONLY for `takeSnapshot(state); state.bumpEpoch();` (lines ~167-170). `diff.epoch` (pre-bump, same as snapshot label) goes only into `details.epoch`.
- **DiffEntry shape** (`src/snapshots.ts:31-55`): `{ id, title, from, to, editedArchived }` where `to`/`from` are label-preferred display summaries produced by the module-PRIVATE `answerSummary` (snapshots.ts ~lines 86-100): choice → option label whose `value === answer.value`, falling back to raw value; text → raw value; missing → `"(unanswered)"`. **No raw value is carried anywhere on DiffEntry.**
- details vs content: `details = { changed: DiffEntry[], note?, epoch, card }` (lines ~168-174); card is the full `SubmissionCardData`. Model sees only `content`.
- Fix implication: content line should become e.g. `Submitted {k}: {list} (state epoch {diff.epoch})` — `diff.epoch` is already available and is the pre-bump epoch.

## BUG-002 — CONFIRMED: `state.completed` never reset → completion fires at most once per singleton
`src/completion.ts:110-138` — `attemptCompletion(pi, opts, result): CompletionResult`
- Guard at ~line 118: `if (state.completed === true) return { fired: false, reason: "already-completed" };`
- `reason` values: `"no-state" | "already-completed" | "active-questions-remain"` (CompletionResult, lines ~49-53). Fired: `{ fired: true }` after buildCompletion → deliverSubmission → dismissPanel → clearForCompletion (h3.9 order, never reorder).
- Blocking predicate (lines ~70-76): `BLOCKING = {"open","reasked","answered","submitted","moot"}` (moot-INCLUSIVE, deliberately broader than lifecycle's `remainingActive` which excludes moot). Zero-question rule: needs `snapshots.length > 0 || epoch > 1`.
- `clearForCompletion` (`src/state.ts:390-397`): clears `questions`+`order`, retains goal/epoch/snapshots, sets `this.completed = true` (the ONLY live assignment site), emits `completed-cleared` then `changed`. Deserialization restores it (state.ts:436 `state.completed = raw.completed === true`) — deliberately preserving exactly-once across restart.
- Note: the "exactly once" is DOCUMENTED INTENT (module JSDoc: "fires EXACTLY once per interrogation"), so whether BUG-002 is a bug depends on whether a new interrogation is expected to share the singleton `state.completed`. A new `createInterrogationState` starts `completed = false` (state.ts:232), but `reconstructFromBranch` resets via `resetState()`; if no reconstruction/new-state path runs between interrogations on the same session, `completed` stays true. Key files for the fix: `src/state.ts` (reset site) and wherever a fresh interrogation begins (tool.ts upsert / index.ts).

## BUG-004 — CONFIRMED (both halves)
1. Close pass archives only `submitted`: `src/lifecycle.ts:203-223` — `const submitted = state.orderedQuestions().filter((q) => q.status === "submitted");` then `closeSubmitted(state, toClose)`. Questions left in `answered` (never marked submitted) are NEVER closed; they remain in `remainingActive` (ACTIVE_STATUSES line ~90: `["open","answered","submitted","reasked"]`) and BLOCK completion forever (completion.ts BLOCKING includes both `answered` and `submitted`).
2. `recordAnswers` never marks submitted: `src/fallback.ts:197-222` — applies `state.applyAnswer(id, {value, at})` for each known id (→ status `"answered"`), then `takeSnapshot(state); state.bumpEpoch();`. Its docstring (line 168) claims "markAnswered + markSubmitted-equivalent" but **`merge.ts markSubmitted` (lines 254-258: `state.setStatus(id, "submitted")`) is never called**, and `lifecycle.noteSubmissionDelivered()` is also never invoked from the non-TUI record path (only submit flows call it per lifecycle.ts JSDoc; tool.ts:325 calls recordAnswers without it). Result: non-TUI answers stay `answered` → never closed → completion can never fire.
3. "Detection of submission messages in non-TUI chat": this claim is MISDIRECTED — `src/detect.ts` is the TUI-only round-question detector (`turn_end`, `ctx.mode !== "tui"` → return, lines ~160-175); it does NOT detect submissions and has no non-TUI role. The fallback flow is: digest via `buildFallbackDigest` (fallback.ts:73-120, `isNonTui` at 47-50: `mode !== "tui" || !hasUI`), user answers in chat, model calls `{answers:[...]}` → tool.ts:325 → recordAnswers. No submission-message detection exists anywhere.

## BUG-006 — CONFIRMED: no terminal-status checks
- `fallback.ts recordAnswers` (197-222): no status check at all; only `getQuestion(id) === undefined` → unknown. `applyAnswer` will happily overwrite `withdrawn`/`moot`/`closed` answers.
- `state.ts applyAnswer` (339-346): raw primitive, only throws on unknown id; sets `q.answer` and `q.status = "answered"` unconditionally. `setStatus` (349-356) is likewise unguarded ("v1 does not hard-enforce priors" per merge.ts:248-252).
- Terminal statuses: per state.ts:187 comment, `moot`/`withdrawn` are "terminal-until-re-upsert"; `closed` is also treated as terminal (depends-on.ts SKIP_EVALUATION = `{"withdrawn","closed"}`). So terminal set = `withdrawn | closed | moot(?)` — moot is re-evaluated by depends-on, but chat answers should arguably not revive it. QuestionStatus union (state.ts ~168-176): `open | answered | submitted | reasked | moot | withdrawn | closed`.
- Compare: lifecycle's close pass only closes `submitted` (its own narrow bug, BUG-004).

## BUG-006 adjacent — depends-on BUG (BUG-006 in task = depends-on ~165?) — the dependsOn-empty moot bug: CONFIRMED
`src/depends-on.ts:163-164`:
```ts
if (!q.dependsOn || q.dependsOn.length === 0) continue;
```
- `evaluateDependsOn(state): MootEvaluation` — signature at line ~163; skips SKIP_EVALUATION (`withdrawn`,`closed`, line ~78).
- Moot/open rules: met && status==="moot" → `setStatus(id,"open")` + reopened; unmet && status ∉ {moot,withdrawn,closed} → `setStatus(id,"moot")` + mootered entry; unmet && moot → listed only (idempotent); `answered`/`submitted`/`reasked` DO go moot when unmet.
- **equals/notEquals compare against the raw `answer.value`, NOT the label** (dependencyMet lines ~118-135: `conjunctMet = value === cond.equals` / `value !== cond.notEquals`, where `value = dep.answer?.value`). failReason formats `moot: {id}={actualValue}`.
- The bug: a moot question whose `dependsOn` was removed (or emptied) by an upsert stays moot forever — the `continue` skips both the met-check and the moot→open reopen. Fix: questions in status `moot` with empty/absent dependsOn must be reopened (`setStatus(id,"open")`) instead of `continue`.

## BUG-007 — CONFIRMED: replaySubmission applies label summary as value
`src/reconstruct.ts:279-296` (`replaySubmission`):
```ts
state.applyAnswer(id, { value: to, at: new Date().toISOString() });
```
with its own comment: "Best-effort: `to` is the label-preferred display summary, not the raw value". Line 286 skips `to === UNANSWERED_SUMMARY` ("(unanswered)", const at line 134).
- Branch-scan flow (`reconstructFromBranch`, ~314-370): `resetState()` → `walkBranch(ctx.sessionManager.getBranch())` collecting (a) last interrogate toolResult `details.state` (FR-27 last-wins, toolIndex anchor), (b) mirror entries (`custom` INTERROGATION_STATE_ENTRY_TYPE), (c) submission entries (`custom_message`/`custom` with customType SUBMISSION_ENTRY_TYPE via `submissionDetails`, lines ~215-235). Base priority: tool-result → newest mirror → none (dispose stale surfaces).
- Delta detection: NO detect.ts involvement. Deltas come from `walk.submissions`' `details` (SubmissionMessage.details = `{changed: DiffEntry[], note?, epoch, card}`), filtered: tool-result base → only submissions with `index > toolIndex`; mirror base → epoch filter (`submission.details.epoch >= state.epoch`). Each replay that applies ≥1 answer does one `bumpEpoch()` (h2.39 one-submission-one-bump). Then `evaluateDependsOn(state)` once, then surface decisions.
- **Does DiffEntry carry the raw value? NO.** `{id,title,from,to,editedArchived}` only; `to` is label-preferred (snapshots.ts answerSummary). A correct value-carrying fix must either (a) add a raw `value`/`answer` field to DiffEntry in `computeEntries` (snapshots.ts ~line 172) so it flows into `details.changed` consumed by reconstruct, and/or (b) replay from `details.card` / snapshot ring instead. Note reconstruct also loses `answer.text` and timestamps entirely.

## Close-pass trigger points / wiring
- `src/index.ts:73-75`: `lifecycle = createLifecycle(pi, { onAfterClosePass: createCompletionTrigger(pi, {...}) })` — the completion trigger is plugged into the lifecycle's seam; late-binding resolves a circular dep.
- `createLifecycle` subscribes (`src/lifecycle.ts` ~175-205): `tool_execution_start` (stash interrogate args by toolCallId), `tool_execution_end` (isUpsertArgs → setStatus reasked for touched submitted ids, `submittedRun = true`), `agent_settled` → `runClosePass()`. Flags cleared on EVERY pass exit (incl. no-state) and by `noteSubmissionDelivered()`.
- All-answered decision: entirely completion.ts's local predicate (BLOCKING set, moot-inclusive), never `ClosePassResult.remainingActive` (which excludes moot by design).

---

## 15-line summary
1. BUG-003 CONFIRMED: delivery.ts:162 content = `Submitted {k}: {list}\n{reminder}[NOTE:…]` — no epoch; `diff.epoch` and `state.epoch` both available; reminder = "Consider how these affect your other questions." (line 43).
2. DiffEntry = {id,title,from,to,editedArchived}; `to`/`from` are label-preferred summaries from snapshots.ts private `answerSummary`; raw value is NOT carried anywhere.
3. buildSubmission signature: `(state, diff: SubmissionCardData, note?) => SubmissionMessage`; side effects takeSnapshot→bumpEpoch; details = {changed, note?, epoch, card}.
4. BUG-002 CONFIRMED with nuance: `completed=true` set only by clearForCompletion (state.ts:395), restored by deserialize; "exactly-once" is documented intent — fix must decide where a NEW interrogation resets it (resetState/new-state path), not blindly clear it.
5. attemptCompletion: `(pi, opts, result: ClosePassResult) => CompletionResult {fired, reason: "no-state"|"already-completed"|"active-questions-remain"}`; BLOCKING = open/reasked/answered/submitted/moot; zero-question rule needs snapshots or epoch>1.
6. BUG-004 CONFIRMED: lifecycle.ts:203 close pass filters `status === "submitted"` only; `answered` ids are never closed and block completion forever.
7. BUG-004 CONFIRMED: fallback.ts:197 recordAnswers calls applyAnswer only (+snapshot+bump), never merge.ts markSubmitted (254) nor lifecycle.noteSubmissionDelivered — despite docstring "markSubmitted-equivalent"; TUI path (debug-commands.ts:203) does call markSubmitted.
8. CONTRADICTION in claim: detect.ts has NO non-TUI submission detection — it is the TUI-only round-question nudge (turn_end, `ctx?.mode !== "tui"` early-return). Non-TUI answers arrive via `{answers:[...]}` tool action (tool.ts:325).
9. BUG-006 CONFIRMED: recordAnswers has no status guard; state.ts applyAnswer (339) is a raw primitive — only unknown-id throw, unconditionally sets status "answered".
10. Terminal statuses: withdrawn/closed (state.ts:187, depends-on SKIP_EVALUATION); moot is re-derivable only via depends-on, but should not be resurrectable by chat answers.
11. Depends-on bug CONFIRMED: depends-on.ts:163-164 `if (!q.dependsOn || q.dependsOn.length === 0) continue;` — moot question with removed dependsOn never reopens; fix = reopen moot on empty dependsOn.
12. equals/notEquals match raw `answer.value` (NOT label) — dependencyMet compares `value === cond.equals`; failReason shows raw value in `moot: {id}={value}`.
13. BUG-007 CONFIRMED: reconstruct.ts:289 `applyAnswer(id, { value: to, ... })` — `to` is a display label; reconstruct's own comment admits "best-effort". Fix needs a raw-value field added to DiffEntry/computeEntries (snapshots.ts) or replay from snapshot ring; `text` and timestamps are also lost.
14. Reconstruction flow: resetState → walkBranch (last toolResult details.state → newest mirror → none) → position/epoch-filtered submission replay (one bump per applied submission) → evaluateDependsOn once → surface wiring; deltas from details.changed, not detect.ts.
15. Wiring: index.ts:73 `createLifecycle(pi, {onAfterClosePass: createCompletionTrigger(pi, …)})`; agent_settled → runClosePass → onAfterClosePass → attemptCompletion; all-answered decision is completion.ts's local moot-inclusive predicate, never lifecycle's `remainingActive`.

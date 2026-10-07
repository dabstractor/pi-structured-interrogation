# BUG-001 / BUG-002 — Re-ask / Re-confirmation Loop: Seam Map

All line anchors verified today by direct read of the working tree at `/home/dustin/projects/pi-structured-interrogation`.

## 1. Seam map (verified anchors)

### 1.1 `src/panel/actions.ts` — `acceptOptionIndex` same-value no-op (ANSWER-PIN-001)

- Function: `src/panel/actions.ts:280`. The no-op condition is **lines 293–297**:

```ts
// actions.ts:293-297
const recorded = q.answer;
if (recorded !== undefined && recorded.custom !== true && recorded.value === opt.value) {
  advanceAfterAccept(panel); // Q14 rhythm: advance only, no state write
  return "noop";
}
```

- Condition: **answer presence only** (`recorded !== undefined`), non-custom, and value byte-equality. **There is NO status exclusion**: `submitted` (comment even names it), `closed`, and crucially **`reasked`** all hit the no-op. For a rule-1 re-asked question (answer kept, status `reasked`), pressing enter on the same value:
  - skips `confirmRippleEdit` (status is `reasked`, not answered/submitted — would skip anyway),
  - skips `applyAnswer` → **status stays `reasked`**, never becomes `answered`,
  - skips `evaluateDependsOn` (line 311),
  - skips `maybeAutoSubmit` (line 313 — only called on the `"accept"` path),
  - only `advanceAfterAccept` runs (line 423–428 → `nextUnanswered`, `UNANSWERED_STATUSES = ["open","reasked"]` at line 85).
- Result: the question stays `reasked` forever; the user's "re-confirmation" is a pure no-op — **the confirmation never lands**. Also blocks completion (`reasked` ∈ `completion.ts` BLOCKING set).

### 1.2 `src/panel/actions.ts` — `writeInEnter` byte-identical no-op

- Function: `src/panel/actions.ts:349`. No-op at **lines 379–385**:

```ts
// actions.ts:379-385
const recorded = q.answer;
if (recorded !== undefined && recorded.value === text && (recorded.custom === true || q.type === "text")) {
  panel.consumeCommittedBuffer(q.id); // BEFORE advance: kill the write-through source
  advanceAfterAccept(panel); // Q14 rhythm: advance only, no state write
  panel.blurTextField(); // AFTER advance (commit-tail parity): editor closes, duty resets
  return true;
}
```

- Same shape: **no `reasked` exclusion**. Two-clause match: choice questions need `custom === true`; **text questions match on value alone** (line 380, `(recorded.custom === true || q.type === "text")` — the text-question path is explicitly included). Skips `applyAnswer`/modal/`evaluateDependsOn`/`maybeAutoSubmit` (which only fires on the direct-commit exit, line 408). Same bug as 1.1 for both write-ins and text re-confirmation.

### 1.3 `src/panel/actions.ts` — `submit()` early return

- Function: `src/panel/actions.ts:569`. Key lines:

```ts
// actions.ts:574-583
const pre = submissionBaseline(panel);
const diff = computeDiff(pre, panel.state.serialize());
...
const pendingIds = panel.state.orderedQuestions().filter((q) => q.status === "answered").map((q) => q.id);
```

```ts
// actions.ts:592-595
const userChanged = diff.changed.filter(
  (e) => pendingIds.includes(e.id) || !(e.to === "(unanswered)"),
);
if (diff.changed.length === 0 || userChanged.length === 0) {
```

- **`computeDiff` is status-blind** (`src/snapshots.ts:229`, "answer-signature changes, so status-only flips contribute zero entries"; signature = `answer.value` + optional NUL+text, `snapshots.ts:123`). After a rule-1 re-ask with a same-value re-accept, live state's answer signature **byte-equals the last snapshot's**, so `diff.changed.length === 0` → early return fires even though `pendingIds` is non-empty (…in the no-op case pendingIds is *also* empty because the no-op never re-marks `answered` — that's the coupling between the two bugs; and in a rule-2 case where user re-answers identically to a *baseline that already held that value from a prior epoch*, same outcome).
- Early return (lines 595–619): flashes `"nothing to submit"`, `return true`. Skipped: gate warning, note shipping, **`markSubmitted` flush (line 648, `if (pendingIds.length > 0) markSubmitted(...)` — unreachable when the early return fired)**, `buildSubmission` (which owns `takeSnapshot` + `bumpEpoch`, `state.ts:397–405`), `deliverSubmission`, `noteSubmissionDelivered`, note clear, `panel.suspend()`. So pending `answered` ids are **never flushed to `submitted`** when the diff is empty; the h2.44 close pass (`lifecycle.ts:226`, filters `status === "submitted"`) will neither close nor re-mark them, and completion never fires.
- Last-submission snapshots: `submissionBaseline` → `submissionBaselineOf` (`snapshots.ts`, imported at `actions.ts:26`) = latest snapshot ring entry or empty pre-first baseline. `buildSubmission` performs `takeSnapshot` + `bumpEpoch` **exactly once, itself** (actions.ts:651 comment; epoch semantics `state.ts:234–235, 397–405` — epoch bumps per submission).

### 1.4 `maybeAutoSubmit` (AUTOSUBMIT-001) — `src/panel/actions.ts:735`

- Unanswered predicate lines 742–745: `q.status === "open" || q.status === "reasked"`; pending = `status === "answered"` (line 746). Gate hold (lines 758–766), then `if (unanswered > 0) return` (767), `if (pending === 0) return` (768), AUTOSUBMIT-003 transition gating (commit context; lines ~775–788), then `const shipped = submit(panel, d)` (line 790) + flash `submitted — {n} answer(s)`.
- "Shipped" = `submit()` returned true. But `submit()` **returns `true` on the zero-shipped early return too** (line 619 `return true`), so the flash fires "submitted — n answer(s)" **even when nothing was delivered** when reached via a path that didn't early-return; conversely, when the no-op suppressed the commit (1.1/1.2), `maybeAutoSubmit` is never called at all, and when called after a real re-answer whose diff is empty (identical signature vs baseline), `submit` early-returns → no epoch bump, no delivery, no flush — the auto-submit's "shipped" is a lie in both directions. The comment at 731–733 claims "a zero-shipped early-return inside submit can never flash a lie" — it does flash the lie when `submit` returns true without delivering (empty-diff early return path *before* the flash? no — the flash is guarded by `shipped` truthiness only; empty-diff return is `true`, so `panel.flash("submitted — {n} answer(s)")` fires with zero delivery when maybeAutoSubmit calls submit on a pending-but-empty-diff set, e.g. rule-1 re-answered identical + another pending answered id).

### 1.5 `src/state.ts` — status vocabulary and epoch

- Status union at `state.ts:26` area: `"open" | "answered" | "submitted" | "reasked" | "moot" | "withdrawn" | "closed"` (`STATUSES` array `state.ts:499–507`).
- `applyAnswer` `state.ts:363` — stores answer, status → `answered`, never bumps rev. `setStatus` `state.ts:376`. `bumpEpoch` `state.ts:397–405` (`this.epoch++`, emits `epoch-bumped`). `epoch = 1` initial (`state.ts:235`). Snapshot ring push happens in bumpEpoch path (h2.41: epoch bumps per submission, including auto-submits).
- "Unanswered" = `open`/`reasked` everywhere (`UNANSWERED_STATUSES` actions.ts:85; maybeAutoSubmit 742–745; submit heldDrafts filter 608; state.ts:504 lists `reasked` in STATUSES). `answered` = pending; `submitted` = flushed. No submitted-epoch field (lifecycle.ts:53–57 epoch-proxy invariant).

### 1.6 `src/lifecycle.ts` — re-ask marker on `tool_execution_end`

- Subscription `lifecycle.ts:188–204`; the flip at **line 197–199**:

```ts
// lifecycle.ts:196-199
if (q !== undefined && q.status === "submitted") {
  state.setStatus(id, "reasked"); // rule-1 same-options upserts land here
  reaskedThisRun.add(id);
}
```

- Runs for every touched id of a successful interrogate upsert; rule-1 upserts leave status `submitted` after merge, and this pass flips them to `reasked` **keeping the answer** (`setStatus` never touches `q.answer`). `agent_settled` (line 208) → `runClosePass` (213): closes `submitted` ids not in `reaskedThisRun` (line 226–227); `noteSubmissionDelivered` clears the run flags (line 385 test).

### 1.7 `src/merge.ts` — rule 1 vs rule 2

- `applyUpsert` `merge.ts:139`. Rule 1 (same options, lines 186–195): status kept (`existing.status` — so a `submitted` row stays `submitted` until lifecycle flips it), `answer` kept via `structuredClone`, `answerReset: false`. Rule 2 (lines 196–202):

```ts
// merge.ts:199-201
status = "reasked";
answer = undefined;
answerReset = true;
```

- `markSubmitted` `merge.ts:268` — flushes pending `answered` → `submitted` (legal prior: `answered` or reasked-then-answered).

### 1.8 `src/delivery.ts` — submission, completion (FR-5)

- `buildSubmission` `delivery.ts:148` — takes the diff, performs takeSnapshot + bumpEpoch (per actions.ts contract). `deliverSubmission` `delivery.ts:~526–576` — one `sendMessage`, steer vs triggerTurn by idle probe; also appends to the batch-notes ledger (lines 597–601).
- Completion (FR-5) is NOT in delivery.ts — the trigger is `src/completion.ts:attemptCompletion` (lines ~94–135): one-time guard, then predicate **`completion.ts:66–73`**: `BLOCKING = new Set(["open","reasked","answered","submitted","moot"])` — **`reasked` and `answered` both block**. So a stuck-`reasked` question (BUG-001) or an unflushable pending `answered` question (BUG-002) permanently blocks the FR-5 completion record. Order: buildCompletion → deliverSubmission → dismissPanel → clearForCompletion.

### 1.9 `spec/decisions.md`

- **D-R6 (verbatim, decisions.md:41):**

> "…plus the AC-11 record path calls noteSubmissionDelivered so re-asked-then-re-answered ids close at the settle; **bridge submissions flush answered→submitted even when the diff is empty (identical re-selections after a rule-1 re-ask — conformant clients re-submit the full set)** and honor the h2.44 line-1 contract on that flush path too…"

- **ANSWER-PIN-001 (decisions.md:80–81)** — heading "2026-10-04 interrogation — answer pinning (ANSWER-PIN-001)". Ruling (2) verbatim: "(2) enter/digit on the recorded value is a state no-op — no applyAnswer, no `answer.at` rewrite, no ripple modal, no auto-submit trigger; advance only". Ruling (1): "a recorded answer owns the caret on every view and entry path … **every status carrying `answer`**". The intended coverage was `answered`/`submitted` revisit ergonomics (the doc explicitly discusses `submitted` and `closed` in the tests); **`reasked` is not called out** — the loop is an unhandled intersection of ruling (2) with rule-1 re-ask semantics. `FR-D9` does **not** appear in `spec/decisions.md` (grep: no matches; FR-D9 appears only in code comments, e.g. actions.ts:284, 374).

## 2. Data / control flow (the loop)

1. User submits; `submit()` flushes `answered`→`submitted`, snapshots, bumps epoch, delivers.
2. Agent upserts same-options batch (rule 1): `merge.ts` keeps status `submitted` + answer; on `tool_execution_end`, `lifecycle.ts:198` flips it to `reasked` (answer retained).
3. User re-confirms by pressing enter on the same value (or byte-identical write-in / text re-entry): `actions.ts:294` / `379` no-op fires — status stays `reasked`, never `answered`; no `maybeAutoSubmit`.
4. Even if the user re-answers and status becomes `answered`: on `submit()`, `computeDiff` (answer-signature only, `snapshots.ts:229`) sees no change vs the last snapshot → `diff.changed.length === 0` → early return at `actions.ts:595` — **no flush, no epoch bump, no delivery**; ids stay `answered`.
5. `agent_settled` close pass only touches `submitted` ids; completion BLOCKING set includes `reasked`/`answered` → interrogation can never complete; the agent sees no re-confirmation and (per rules) may re-ask again → loop.

## 3. Tests pinning current behavior

`src/panel/actions.test.ts`:
- `test_same_value_on_submitted_is_inert` (line 422) — accept on a `submitted` question's recorded value: no seam call, **status stays "submitted"**, `answer.at` unchanged, advance to q2. Pins the no-op for submitted. A `reasked` variant does not exist — adding `reasked` exclusion (or re-mark) does not conflict.
- `test_same_value_on_closed_stays_closed_not_remarked_pending` (line 438) — same-value on `closed` stays `closed` ("AC-13's editing re-marks pending applies to CHANGES only"). **A fix must keep `closed` inert** — only `reasked` should re-mark.
- `test_same_value_on_complete_set_does_not_auto_submit` (line 481) — complete all-`answered` set, same-value accept on last question: 0 sendMessage, no epoch bump, no flash. Pins no-op suppression of phantom submits for `answered`. A `reasked` re-mark fix changes the pre-status here? No — these are `answered`, not `reasked`; if the fix re-marks `reasked`→`answered` + fires maybeAutoSubmit with `wasUnanswered: true`, this test is unaffected (status was `answered` → no-op still inert). **But if the fix is a global status exclusion rather than reasked-only, these flip** — hence fix must be scoped to `reasked`.
- `test_wi_same_value_on_complete_set_does_not_auto_submit` (line 623) — same for write-in path. Same reasoning.
- `test_h_accept_on_moot_and_withdrawn_is_noop` (316), `test_e_digit_beyond_option_count_is_noop_false` (658) — unaffected.
- `test_auto_reasked_question_blocks_the_firing` (line 2293) — a `reasked` question in the set blocks auto-submit (unanswered>0). **Preserved by fix (a)** only until the re-confirm re-marks it `answered`; after re-mark, the same accept completes the set and SHOULD fire — this test uses a *different* question still reasked (q2 reasked while accepting q1), so it remains valid.
- `test_auto_zero_pending_complete_set_noops_silently` (2309), `test_j_submit_with_zero_pending_flashes_nothing_to_submit_no_side_effects` (886), `test_j_second_submit_after_a_flush_is_zero_pending_again` (900), `test_post_submit_exit_real_delivery_suspends_zero_shipped_stays_open` (854) — pin the zero-`pending` early return. **Fix (b) keys on `pendingIds`, not diff alone; zero-pending tests unaffected** since pendingIds=0 there.
- BUG-008 tests: `bug008_zero_user_pending_pure_agent_reset_flashes_and_ships_nothing` (995), `bug008_draft_of_reasked_question_survives_submit_that_ships_other_questions` (953) — pin that agent rule-2 resets ship nothing. Fix (b) must keep the `userChanged` filter semantics: with fix (b), pending `answered` ids (rule-2 re-answered) ship even if diff empty — check 995: it asserts a *flash* + nothing shipped with zero user pending; pendingIds empty there → safe.

`src/regression-phantom-submissions.test.ts`: `no phantom recommended answers ship; no completion on open questions` (190), `accept + explicit ctrl+s ships exactly the one; no completion` (278) — pin no phantom shipment; both have real pending diffs, unaffected.

`src/lifecycle.test.ts`: `rule-1 same-options upsert keeps status submitted — engine still flips it to reasked` (193), `upsert touching some ids reasks them; untouched ids close` (179), `re-ask then in-run answers[] record re-arms the close pass — completion fires at settle` (657), `noteSubmissionDelivered clears the run's reask set` (385) — pin lifecycle semantics; fixes are upstream (panel), these stay green.

`src/merge.test.ts`: `test_rule1_keeps_status_for_submitted_and_reasked_rows` (101), `test_rule2_changed_options_delete_answer_and_reask` (114) — pin merge rules; untouched by both fixes.

`src/panel/panel.test.ts:718` `test_upsert_reasked_reopens` — panel reopen on reasked upsert; unaffected.

## 4. Recommended fix

**(a) BUG-001 — re-confirmation no-op (minimal risk):** in both no-op guards, treat `status === "reasked"` as a real commit of the same value: re-mark `answered` (via `state.applyAnswer(q.id, {...recorded, at: new Date().toISOString()})` or `setStatus`) then run the normal tail (`evaluateDependsOn` → advance → `maybeAutoSubmit` with `wasUnanswered: true`). Concretely:
- `actions.ts:294`: add `&& q.status !== "reasked"` to the no-op condition, and instead of falling into the full seam path, add a small reasked-recommit branch: since the value is unchanged, skip `confirmRippleEdit` (not a change, FR-18) but do `applyAnswer` + tail. Simplest surgical form: change condition to `if (recorded !== undefined && recorded.custom !== true && recorded.value === opt.value && q.status !== "reasked")`, and let the existing body handle reasked (it already computes `wasUnanswered` including `reasked` at line 301 and skips the seam for non-answered/submitted statuses) — **this is a ~1-line change per seam** (`actions.ts:294` and `actions.ts:380`).
- Same at `writeInEnter` `actions.ts:380`: `&& status !== "reasked"` (the `status` const is read later at line 390; hoist or read `q.status` inline). Body then applyAnswers with `{ value: text, custom: true }` — for a text question re-confirm this keeps kind consistent; the existing two-clause match guard already distinguishes kinds.
- Flip/add tests: add `reasked` variants next to `test_same_value_on_submitted_is_inert`; assert status → `answered`, `answer.at` refreshed, advance, and auto-submit fires when it completes the set. `test_same_value_on_closed_stays_closed...` must stay green (closed excluded).

**(b) BUG-002 — submit early return:** prefer the **D-R6 pattern**: treat non-empty `pendingIds` as user shipments even when the diff is empty. Change `actions.ts:595` to:

```ts
if (diff.changed.length === 0 || userChanged.length === 0) {
  if (pendingIds.length === 0) { /* existing flash + return true */ }
  /* else: fall through — pending answered ids ship even with an empty diff */
}
```

- Falling through runs `markSubmitted` (648), `buildSubmission` with `userChanged` possibly empty → **must synthesize the changed entries for pending ids** (buildSubmission derives `k` from `changed.length`; an empty card is meaningless). Minimal construction: for pending ids absent from `userChanged`, synthesize `{ id, title, from: UNANSWERED_SUMMARY, to: answerSummary(q) }`-style entries — or simpler, pass `diff.changed` augmented with pendingIds' current answer summaries. This honors h2.44 line 1 (flush → close pass → completion) exactly as D-R6 already does for the bridge, and fixes `maybeAutoSubmit`'s lie (submit then really delivers; "shipped" becomes true).
- Alternative (status in the diff signature) is **wider risk**: it changes `computeDiff`'s contract (`snapshots.ts:229` "status-only flips contribute zero entries") used by `digestSince`, BUG-008 filtering, snapshots tests — many more pinned tests; not recommended.
- Tests to flip: none of the pinned zero-pending tests break (they key on `pendingIds === 0`). Add: rule-1-reask → re-answer identical → submit ships, flushes to submitted, epoch bumps; and the maybeAutoSubmit empty-diff path delivering + flashing truthfully. Watch `bug008_zero_user_pending_pure_agent_reset_flashes_and_ships_nothing` (995): zero pending → still early-returns; safe.

**Interaction:** fix (a) alone converts the re-asked re-confirm into `answered` (pending); fix (b) is then required or the identical answer still hits the empty-diff early return (baseline holds the same signature from the prior epoch). **Both fixes are needed together to break the loop.**

## 5. Risks / interactions

- `test_same_value_on_complete_set_does_not_auto_submit` (481) / write-in twin (623): all-`answered` set — with (a) scoped to `reasked` only, no-op for `answered` stays inert → green. If someone widens (a) to all statuses, these flip — keep scope tight.
- Fix (b) fall-through: `buildSubmission` performs snapshot+bump — an auto-submit on an empty diff with pending ids will now deliver a card with synthesized entries; ensure `changed.length`/`k` consistency and that `shipDrafts` (line 660) still uses `pendingIds`.
- Flash lie in `maybeAutoSubmit` (790–792) is resolved by (b) but verify: `submit` returning true with the new pendingIds fall-through now really delivers.
- BUG-008 semantics: agent rule-2 resets (answer → undefined) yield `to === "(unanswered)"` and pendingIds excludes them (their status is `reasked`, not `answered`) — preserved.
- The `heldDrafts` flash (601–615) only runs on the zero-pending branch; keep it there.
- Panel reopen flow (`panel.ts:1945` nextUnanswered focus) benefits automatically: re-marked `answered` ids stop being reopen blockers.
- `answer.at` rewrite on re-confirm changes the answer signature only if the signature includes `at` — it does **not** (`snapshots.ts:123`: value + text only), so (a) does not perturb diffs; (b) is what makes them ship.

## Files retrieved
1. `src/panel/actions.ts` (85–110, 260–410, 520–680, 690–800)
2. `src/state.ts` (26–120, 176–235, 360–460, 495–530)
3. `src/lifecycle.ts` (1–60, 100–290)
4. `src/merge.ts` (1–130, 139–270)
5. `src/delivery.ts` (grep anchors; 148, 298–490, 526–630)
6. `src/completion.ts` (55–135)
7. `src/snapshots.ts` (grep anchors 36–70, 104–130, 229–320)
8. `src/panel/actions.test.ts` (415–500, 620–660, 2290–2325, test list)
9. `src/lifecycle.test.ts` (179–260, 385, 657)
10. `src/merge.test.ts` (87–150)
11. `src/regression-phantom-submissions.test.ts` (test list, 190–220, 277–311)
12. `spec/decisions.md` (41, 80–81)

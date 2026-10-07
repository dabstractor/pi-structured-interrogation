# Scout Report — BUG-003 (FR-18 ripple-confirm seam status gate) & BUG-004 (FR-17 moot reason rendering)

All anchors re-verified today by direct read. Repo: pi-interrogation, cwd `/home/dustin/projects/pi-structured-interrogation`.

---

## 1. Seam Map (verified anchors)

### TOPIC A — BUG-003: FR-18 ripple-confirm status gates

**A1. Choice-accept seam gate — `src/panel/actions.ts:302`** (inside `acceptOptionIndex`, fn starts at line 280):

```ts
// actions.ts:299-305
  const wasUnanswered = q.status === "open" || q.status === "reasked";
  if (q.status === "answered" || q.status === "submitted") {
    if (!panel.confirmRippleEdit(q.id, proposed)) return "veto"; // seam vetoed — nothing applied, no advance
  }
  panel.state.applyAnswer(q.id, proposed);
```
Gate list is **answered | submitted only**. `closed` (and any status) falls through to `applyAnswer` directly — no modal. Same-value inert re-commit check (lines 294–298, ANSWER-PIN-001) runs BEFORE the gate: recorded non-custom value === option value → advance-only noop. Note: a closed question with a recorded answer whose new value differs will NOT match the noop branch, so it goes straight to `applyAnswer`.

**A2. Write-in commit gate — `src/panel/actions.ts:392`** (inside `writeInEnter`, fn starts line 349):

```ts
// actions.ts:391-394
  const status = q.status;
  if ((status === "answered" || status === "submitted") && rippleVictims(panel, q.id).length > 0) {
    beginWriteInConfirm(panel, text);
    return true; // consumed — nothing applied yet
  }
```
Same two-status gate; a `closed` write-in commit applies directly (line 395 `applyAnswer`), then `evaluateDependsOn(panel.state)` at **actions.ts:399** mutes dependents silently.

**A3. Elaboration/text stage-1 save gate — `src/panel/panel.ts:856` (`stageText`, private; exact gate condition at line 863):**

```ts
// panel.ts:856-871
  private stageText(text: string): void {
    const id = this.currentId;
    if (id !== undefined) {
      const q = this.state.getQuestion(id);
      if (
        q !== undefined &&
        q.answer !== undefined &&
        (q.status === "answered" || q.status === "submitted") &&
        rippleVictims(this, id).length > 0
      ) {
        beginTextConfirm(this, text);
        return; // deferred — applyTextConfirm runs on confirm-enter
      }
    }
    this.commitTextDraft(id, text);
  }
```
Callers of `stageText`: `panel.ts:833` and `panel.ts:846` (enter/elaboration save + editor-exit gestures via `exitTextField` at panel.ts:847). Note the text gate additionally requires `q.answer !== undefined`.

**A4. Seam entry on the panel — `src/panel/panel.ts:991-994` (`confirmRippleEdit`)** → delegates to `this.rippleConfirm` (field declared panel.ts:513, default `createRippleConfirm()` at panel.ts:650).

**A5. Victims computation — `src/panel/ripple-confirm.ts:93-107`:**

```ts
export const VICTIM_STATUSES: readonly string[] = ["answered", "submitted"];
...
export function rippleVictims(panel: InterrogationPanel, questionId: string): string[] {
  return computeRipple(panel.state, questionId).filter((id) => {
    const q = panel.state.getQuestion(id);
    return q !== undefined && VICTIM_STATUSES.includes(q.status);
  });
}
```
`computeRipple` (depends-on.ts:213-258) returns the full transitive closure unfiltered. Victim filter: **closed/submitted-then-closed dependents are excluded from the warning copy** (docblock ripple-confirm.ts:96-102: "Open/moot/withdrawn/closed ripple ids are not victims… closed are terminal").

**A6. The default seam — `src/panel/ripple-confirm.ts:120-134` (`createRippleConfirm`)**: zero victims → return true (apply directly); else stash `panel.confirmMode = {questionId, kind:"choice", proposed, victims, priorCursorIndex}` and return false. Modal keys consumed in `panel.ts:765-776` (enter→applyConfirmedEdit/applyTextConfirm/applyWriteInConfirm; esc→cancelConfirm/cancelTextConfirm/cancelWriteInConfirm). Applied commits run `evaluateDependsOn` immediately (ripple-confirm.ts:154, 262) — "victims grey out as moot with reasons instantly (AC-6)". Keep/cancel semantics: enter = deferred commit exactly once, never re-invokes the seam; esc = zero state change (cursor/text-field restore only).

**Statuses of the EDITTED question the seam expects**: only `answered`/`submitted` (VICTIM gate + the three call-site gates). `reasked` edits are ungated by design (treated as unanswered, `wasUnanswered` includes reasked); `closed` is the leak.

### A7. Closed-question editing re-mark (FR-2 / AC-13)

- `src/state.ts:363-370` — `applyAnswer` sets `q.answer` and **unconditionally `q.status = "answered"`** (docblock state.ts:195: "Editing a `closed` answer re-marks it `answered(pending)`; the next submission diff marks it editedArchived"). No status guard.
- `src/merge.ts:178, 193-197` — agent re-upsert of a withdrawn/closed question with same options reopens it (`answered` if answer kept, else `open`) — the agent-side path, distinct from panel edit.
- `src/merge.ts:284` (`closeSubmitted`) and `src/snapshots.ts:45` ("`before.status === "closed"` that `editedArchived` needs (BUG-003/AC-13)") — the diff machinery already expects closed→edited flows.
- Navigation: `nextUnanswered` (actions.ts:~414) skips closed as advance targets, but keys/cursor can land on closed questions (`acceptOptionIndex` handles any status except the moot/withdrawn noop path — see A9).

**CONFIRMED BUG PATH**: navigate to a CLOSED question that has a recorded answer, accept a different option → gate at actions.ts:302 does not fire (closed ∉ {answered,submitted}) → `applyAnswer` re-marks it `answered` → `evaluateDependsOn` (actions.ts:311) silently flips answered/submitted dependents to `moot` — **no confirm, no warning**. Same for write-in (actions.ts:392) and text stage (panel.ts:863).

### A8. `evaluateDependsOn` muting — `src/depends-on.ts:170-207`

```ts
const SKIP_EVALUATION: ReadonlySet<QuestionStatus> = new Set(["withdrawn", "closed"]); // line 77
...
    if (SKIP_EVALUATION.has(q.status)) continue;   // line 173
    ...
    if (!conjunctMet) return { met: false, reason: failReason(cond, dep) }; // dependencyMet, line 141
...
      if (q.status !== "moot") state.setStatus(q.id, "moot");   // line 199
      mootered.push({ id: q.id, reason: result.reason });        // line 200
```
- Unmet + status ∉ {moot, withdrawn, closed} → `setStatus(id,"moot")`. `answered`/`submitted`/`reasked` DO go moot (docblock depends-on.ts:186-188: "moot wins").
- **The reason is NOT persisted on the question** — it only lives in the returned `MootEvaluation.mootered` array. `setStatus` (state.ts:376) carries no reason; the Question interface (state.ts:68-91) has no reason field.

### A9. Tests pinning the current gate (would need flipping/extending)

- `src/panel/actions.test.ts:339-390` `describe("accept on answered — ripple-confirm seam (AC-13)")` — 4 tests, all seed `status: "answered"` or `"submitted"` (`test_g_seam_invoked_with_proposed_answer_then_remarks_answered`, `test_g_default_seam_remarks_answered_pending_and_advances`, `test_g_seam_veto_skips_applyAnswer_and_advance`, `test_g_seam_also_guards_submitted_questions`). **None covers closed.** These pin that the gate EXISTS for answered/submitted — a fix adding `closed` does not flip them, only extends.
- `src/panel/actions.test.ts:316-337` `test_h_accept_on_moot_and_withdrawn_is_noop` — pins moot/withdrawn as unanswerable; closed deliberately absent (closed is editable).
- `src/panel/actions.test.ts:698` `test_digit_on_answered_routes_through_the_ripple_seam` — digit path inherits the same gate (calls `acceptOptionIndex`).
- `src/panel/actions.test.ts:470` `test_different_value_still_routes_through_seam` (same-value describe block) — pins seam invocation for answered edits.
- `src/panel/ripple-confirm.test.ts` — describes at lines 166 (choice gate), 391 (text stage-1 gate), 472 (footer + seams), 557 (write-in commit gate), 715 (deferred auto-submit), 800 (BUG-001 gate hold). **Grep for "closed" in this file returns zero matches** — closed-edit leakage is un-pinned.
- `src/panel/panel.test.ts:2595` `elaboration_save_on_answered_with_ripple_victims_routes_through_FR18_modal` — pins the panel.ts:863 text gate for answered; and panel.test.ts:1362 `test_ctrl_c_escapes_the_ripple_confirm_modal`.
- `src/panel/panel.test.ts` has NO closed-edit tests (grep "closed" → no hits on question status; only overview.test.ts:141 pins the `closed` ★ marker).
- `src/merge.test.ts:311` pins the agent-side reopen path ("FR-2 / Q24=B: re-marks answered(pending)") — not the panel edit path.

---

### TOPIC B — BUG-004: FR-17 moot reason rendering

**B1. `src/panel/short-view.ts:149-152` (`mootReason`; DEFAULT_MOOT_REASON = "dependency changed" at line 87):**

```ts
export function mootReason(q: Question): string {
  const cause = q.answer?.value;
  return cause !== undefined && cause !== "" ? cause : DEFAULT_MOOT_REASON;
}
```
Reads the **moot question's own stale answer.value** — never the h2.29 `moot: {dep}={value}` reason. Rendered at short-view.ts:324-332: line `` `${INSET}${theme.fg("dim", MOOT_HEAD + reason)}` `` (`MOOT_HEAD = "⊘ moot — "` line 89), prepended in `renderShortViewOptions` (fn line 194).

**B2. `src/panel/overview.ts:166-172` (`overviewMootReason`; DEFAULT at line 91):**

```ts
export function overviewMootReason(q: Question): string {
  const text = q.answer?.text;
  if (text !== undefined && text !== "") return text;
  const value = q.answer?.value;
  if (value !== undefined && value !== "") return value;
  return DEFAULT_MOOT_REASON;
}
```
Prefers `answer.text` (elaboration!), then `answer.value`, then generic. Consumed by the overview row (`panel.test.ts:586` expects `"⊘ Moot Q — moot: storage=sqlite"` only because the fixture manually put the reason into `answer.text`).

**B3. `src/panel/layout.ts:329-333` (`statusMarkers` fragment):**

```ts
  if (q.status === "moot") {
    const reason = truncateVisible(q.answer?.text ?? "", MARKER_REASON_CAP);
    parts.push(reason === "" ? "⊘ moot" : `⊘ moot ${reason}`);
  }
```
Reads `answer.text`, cap 24 cols (line 337). **Question-only input** — no reason field exists to read.

**B4. `src/depends-on.ts:83-87, 112-145`** — `failReason` + `dependencyMet` produce the true h2.29 reason `moot: {depId}={actualValue}` / `=unanswered` / `=missing`. Surfaced ONLY in the return value of `dependencyMet`/`evaluateDependsOn`; **never persisted** on the Question.

**B5. `src/delivery.ts:410-419` (`buildCompletion`) — the ONLY true-reason consumer:**

```ts
  const mootReasons = new Map(evaluateDependsOn(state).mootered.map((m) => [m.id, m.reason] as const));
```
(then stripped `moot: ` prefix per delivery.ts:396-403; fallback "dependency unmet"). Confirmed sole consumer: grep `dependencyMet|evaluateDependsOn` in panel renderers → no hits; only actions/ripple-confirm/delivery/depends-on call them, and the panel-side calls discard the return value.

**B6. Tests masked by fixtures:**
- `src/panel/overview.test.ts:202-220` `describe("overviewMootReason — depends-on reason read")`: `test_reason_prefers_answer_text_h229_format` (line 204) builds `answer("sqlite", "moot: storage=sqlite")` — the **fixture pre-bakes the h2.29 literal into `answer.text`**, which `overviewMootReason` happens to read first. The fallback tests (lines 210, 213) pin `answer.value` fallback → "sqlite" and "dependency changed".
- `src/panel/overview.test.ts:270-279` — full-row render test uses the same baked fixture, asserts `${DIM}  ⊘ Title m — moot: storage=sqlite${RESET}`.
- `src/panel/short-view.test.ts:167-175` `describe("mootReason")` — pins value-fallback ("postgres chosen") and "dependency changed"; short-view.test.ts:403 pins `⊘ moot — dependency changed`.
- `src/panel/panel.test.ts:567-586` — fixture `applyAnswer("moot", { value: "a", text: "moot: storage=sqlite", ...})` + `setStatus("moot")`, asserts the row shows the reason — again only because text was baked in.
- These tests DON'T pin wrong behavior so much as pin the **derivation contract** (text→value→generic); fixing the source means these fixtures' assumptions change if renderers switch to a real reason field — tests at overview.test.ts:204/270, panel.test.ts:572-586 flip; short-view.test.ts:167-175 flip entirely (short-view never reads text today).

---

## 2. Data / Control Flow

- Answer gesture (enter/digit/deep-view) → `acceptOptionIndex` (actions.ts:280): noop check → **gate (answered|submitted)** → `applyAnswer` (status→answered) → `evaluateDependsOn` (state-only; return value discarded by the panel) → advance → maybeAutoSubmit.
- Write-in enter → `writeInEnter` (actions.ts:349): gate → `applyAnswer({custom:true})` → `evaluateDependsOn` → consume buffer → advance → blur → maybeAutoSubmit.
- Elaboration save / editor exit → `panel.stageText` (panel.ts:856): gate (answered|submitted AND answer present AND victims) → `beginTextConfirm` or `commitTextDraft` (never touches state).
- Modal: `createRippleConfirm` stashes `panel.confirmMode`; handleInput (panel.ts:765-776) routes enter/esc; applied commits re-run `evaluateDependsOn` then advance/auto-submit.
- `evaluateDependsOn` mutates status via `setStatus` (emits `changed` with full serialized snapshot — state.ts:222-224) — renderers are "dumb," re-render from `orderedQuestions()`.
- Render: panel `buildLines` → `renderShortViewOptions`/`layout.statusMarkers`/`buildOverviewContent` — all **pure Question-only inputs (no state access)**; that is why reasons are guessed from `answer.text`/`answer.value`.
- Delivery: `buildCompletion` recomputes reasons itself (the only correct surface).

## 3. Existing Tests Pinning Behavior (summary — see A9 / B6)

| Test | File:line | Asserts | Flips on fix? |
|---|---|---|---|
| test_g_seam_* (×4) | actions.test.ts:339-390 | seam fires for answered/submitted, veto blocks apply | no (extend with closed) |
| test_h_accept_on_moot_and_withdrawn_is_noop | actions.test.ts:316 | moot/withdrawn inert | no |
| test_digit_on_answered_routes_through_the_ripple_seam | actions.test.ts:698 | digit inherits gate | no |
| choice/text/writein gate describes | ripple-confirm.test.ts:166,391,557 | modal stash/apply/cancel | no (add closed-edit cases) |
| elaboration_save_on_answered_with_ripple_victims_routes_through_FR18_modal | panel.test.ts:2595 | text gate | no |
| overviewMootReason tests | overview.test.ts:202-220 | text→value→generic derivation | **yes** if reason source changes |
| overview row render w/ baked reason | overview.test.ts:270-279 | reason rides answer.text | **yes** |
| mootReason tests | short-view.test.ts:167-175, 403 | value fallback + generic | **yes** |
| moot row in panel render | panel.test.ts:567-586 | reason from baked answer.text | **yes** |
| FR-2/Q24=B re-mark | merge.test.ts:311 | agent-side reopen | no |

## 4. Recommended Fix Approach

### BUG-003 (minimal, low-risk): extend the three gates to include `closed` (when a recorded answer exists).
- actions.ts:302 → `if (q.status === "answered" || q.status === "submitted" || q.status === "closed")` (closed questions are only editable when they have a recorded answer; a closed+unanswered question can't reach accept meaningfully — but harmless to include).
- actions.ts:392 → add `|| status === "closed"` to the write-in gate.
- panel.ts:863 → add `|| q.status === "closed"` (answer-present check already there).
- Optionally also include `closed` in `VICTIM_STATUSES` (ripple-confirm.ts:93) if the PRD's intent is that dependents archived as closed still warn — but note the deliberate docblock (ripple-confirm.ts:96-102) declaring closed victims terminal by design; the safer read is: the EDITED question's `closed` status must gate, victims stay as-is. **Decision point for the parent.**
- `applyConfirmedEdit` etc. need no change — `applyAnswer` already re-marks closed→answered. Docblocks to update: ripple-confirm.ts header ("Open/reasked edits never reach the seam"), actions.ts:268-272, panel.ts:852-855.
- New tests: closed-edit choice/writein/text each route through the modal; victims muted only after enter.

### BUG-004: persist the reason — Option A (recommended) vs Option B.
- **Option A — persist `mootReason?: string` on Question** (`state.ts` Question interface). Set in `evaluateDependsOn` right where `setStatus(id,"moot")` fires (depends-on.ts:199) and also for still-moot entries (line 199-200 block); clear it on reopen (`setStatus(open)` branch, lines 175-183) and when the empty-dependsOn reopen fires (line 176). Then:
  - short-view.ts:149 `mootReason` reads `q.mootReason ?? q.answer?.value ?? DEFAULT` (helper already isolated "so a structured reason refines in exactly one place" — short-view.ts:144-147 says exactly this).
  - overview.ts:166 prefers `q.mootReason` first.
  - layout.ts:329-331 reads `q.mootReason` instead of `answer.text` (removes the elaboration-as-reason conflation).
  - Persistence: `serialize()` structuredClones the whole question (state.ts:~100) — new field flows automatically. `reviveQuestion` (state.ts:514) must add `if (typeof value.mootReason === "string") q.mootReason = value.mootReason;` for round-trip. snapshots.ts reads `before.status`/answers generically — no change expected (verify `answerSignature` isn't field-exhaustive; it reads answer.value/text only). reconstruct.ts runs `evaluateDependsOn` as step 5 (per depends-on.ts:21-23) so a stale persisted reason self-heals on restore. delivery.ts buildCompletion can read the map as today (or the field) — keep its recompute; reasons must be consistent either way.
  - Caveat: `evaluateDependsOn` currently claims idempotence via "no setStatus on still-moot" (depends-on.ts:186, 197-201). Writing `q.mootReason` directly bypasses `setStatus` and won't emit `changed` — either accept a silent field write (serialize stays accurate since field lives on the stored object) or route through a state helper; must NOT emit changed for still-moot or panels re-render on no-op passes (pinned by depends-on.test.ts idempotence tests — check before changing).
- **Option B — compute at render time**: `dependencyMet(state, q)` per moot row. Rejected as primary: `renderShortViewOptions` (ShortViewInput, short-view.ts:154-170), `statusMarkers` (layout.ts:~320), and `buildOverviewContent` (OverviewInput, overview.ts:174-206) are pure Question-only signatures — no state plumbed; the panel (panel.ts buildLines) has `this.state`, so plumbing is possible but changes three public pure-renderer contracts and every consumer/test. Also repeats per-render O(conjuncts) and re-derives reasons that delivery already computes differently.
- Tests that flip under Option A: overview.test.ts:204-220, 270-279; short-view.test.ts:167-175, 403; panel.test.ts:567-586; plus depends-on.test.ts additions for reason persistence/clearing.

## 5. Risks / Interactions

- BUG-003 gate extension: closed questions are reachable by cursor only (never advance targets — actions.ts:83/414). Verify keys.ts doesn't block landing on closed rows before assuming the path is user-reachable (grep showed no closed filtering in keys.ts).
- `test_h_accept_on_moot_and_withdrawn_is_noop` intentionally excludes closed — a fix keeping closed editable-but-gated preserves that.
- FR-18 docblocks (ripple-confirm.ts:44-47 "Open/reasked edits never reach the seam") become stale; multiple long docblocks across actions.ts/panel.ts reference the two-status gate — update to avoid reviewer confusion.
- If VICTIM_STATUSES gains `closed`, the footer copy "Invalidates {n} answered questions" becomes inaccurate for closed victims; delivery/snapshots treat closed as terminal elsewhere (merge.ts:284 closeSubmitted).
- Option A reason persistence: interaction with merge.ts rules — an agent re-upsert (rule 2) resets answer/status to reasked/undefined; a lingering `mootReason` must be cleared there (merge.ts builds fresh status/answer around lines 178-200) or guarded at render (only show when status==="moot").
- `delivery.test.ts` has purity assertions (zero changed events, byte-identical serialize) on `buildCompletion`'s evaluateDependsOn call — adding field writes inside evaluateDependsOn for still-moot questions would break "byte-identical serialize" if it changes output; must keep still-moot writes idempotent (same string) or skip.
- persistence.ts consumes `changed` payloads verbatim (persistence.ts:42, 66) — no schema allowlist, so a new field is safe.

## Start Here
`src/panel/actions.ts:280-315` (acceptOptionIndex gate) — the single clearest expression of the BUG-003 leak; then `src/depends-on.ts:170-207` for the mute mechanics, and `src/panel/overview.ts:166-172` for BUG-004.

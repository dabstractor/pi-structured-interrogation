# P1.M1.T4.S1 research — guard-4 scenario tests (user-held wins, deleted-to-empty wins)

Working tree @ e780a32 + T3.S1 in-flight wiring visible at actions.ts:317.

## The landed contract (inputs)

- `stageSupersededWriteIn` (src/panel/actions.ts:359-371, landed P1.M1.T2.S1) — guard 4 at
  :369: `if (panel.draftTextFor(questionId) !== undefined) return;` — user-held draft
  (ANY defined slot text, including a deliberate `""`) always wins; the helper never
  re-stages over it.
- Wiring (T3.S1 contract): `acceptOptionIndex` calls
  `stageSupersededWriteIn(panel, q.id, recorded, proposed.value)` at actions.ts:317,
  immediately after `applyAnswer`, before evaluateDependsOn/advanceAfterAccept/maybeAutoSubmit.
- `recorded` captured before the apply; the ANSWER-PIN inert branch requires
  `recorded.custom !== true`, so a committed write-in supersede ALWAYS reaches the
  genuine-apply path (no inert interference in these scenarios).

## Staging mechanics (verified in code)

- `commitTextDraft(qid, text)` (panel.ts:903-925): UNCONDITIONAL
  `draftSlots.set(qid, {value: qid, text})` + `drafts?.setDraft` — stages `""` as a
  DEFINED slot. Then EXPLAIN-003 re-seed (guarded: only when cursor ≥ options.length)
  and `blurTextField()`.
- `draftTextFor` (panel.ts:1208-1210): `draftSlots.get(qid)?.text ?? this.drafts?.getDraft(qid)`.
- Write-in-duty empty enter: `writeInEnter` actions.ts — `text.trim().length === 0`
  branch is FIRST in the body → `panel.commitTextDraft(q.id, text)` with text = "" →
  slot `""`, no commit. (Byte-identical inert check comes later — no interference.)
- Elaboration-duty enter: routes to `stageText` (panel.ts:873-892, "Shared save core
  for the elaboration-enter and the editor-exit gestures") → FR-18 text gate
  (`rippleVictims(...) > 0` → modal defer; BASIC has NO dependsOn → zero victims)
  → `commitTextDraft(id, text)`.
- Editor entry seams for tests: `panel.focusTextField(duty?: "writein" | "elaboration")`
  (panel.ts:1191; house precedent actions.test.ts:686 `panel.focusTextField("writein")`),
  or the ✎-row `accept(panel)` route (what commitWriteIn itself uses).

## House fixtures (src/panel/actions.test.ts)

- `choiceQ(id, overrides)` (:67-82 area) — options OPTS_AB = [{a, Alpha}, {b, Beta}].
- `seed(specs)` (:86-103) — BASIC (:132) = q1 (recommendation "a") + q2, both open.
- `makePanel(state, {drafts?: store}, config?)`, `makeDeps(true)` → `{deps, sendMessage}`.
- `commitWriteIn(panel, text)` (in the WRITEIN-002 describe, ~:2215-2222 now):
  `panel.currentId = "q1"; panel.cursorIndex = 2; accept(panel);` (✎ row → write-in
  editor) `panel.textField.setText(text); panel.handleInput("\r")` → REAL commit;
  consumeCommittedBuffer deletes slot + clears store entry.
- ANSWER-PIN-001 (landed plan 003): `panel.currentId = "q1"` on an ANSWERED write-in
  question re-seeds cursorIndex to the ✎ row (index 2) — drive `cursorIndex = 0`
  explicitly before an option accept (the rewritten :2213 test does exactly this).
- Naming: `test_snake_case`; banner comments cite origin task IDs
  (`// ----------- WRITEIN-002 submit-time draft role binding (P1.M2.T5.S1)`); my tests
  cite P1.M1.T4.S1 / BUG-001 in their comment headers.
- Message assertion pattern: `sendMessage.mock.calls[0][0] as {content: string}`;
  shipped line format `q1: Alpha — <elaboration>`.

## Insertion point

Inside `describe("submit — WRITEIN-002 draft role binding (h2.32/h2.48)")`, immediately
after the REWRITTEN `test_submit_superseded_writein_rebinds_as_elaboration` (T3.S1's
contract: real gestures, manual re-stage line DELETED, asserts the fix itself). My two
tests are its guard-4 siblings. Sibling boundaries: guards 1/3 scenarios = T4.S2;
auto-submit same-gesture = T4.S3; modal path = T3.S2 (ripple-confirm.test.ts).

## Scenario (a) — user-held draft wins (test body sketch)

```ts
const state = seed(BASIC);
const store = new DraftStore();
const { panel } = makePanel(state, { drafts: store });
const { deps, sendMessage } = makeDeps(true);

commitWriteIn(panel, "my custom take");                       // q1 = {value, custom:true}
expect(panel.draftTextFor("q1")).toBeUndefined();             // VAL-002 consume documented

panel.currentId = "q1";                                       // cursor seeds to ✎ row
panel.focusTextField("elaboration");                          // genuine elaboration gesture
panel.textField.setText("my reasons");
expect(panel.handleInput("\r")).toBe(true);                   // elaboration-enter → stageText → commitTextDraft
expect(panel.draftTextFor("q1")).toBe("my reasons");          // user-held draft exists

panel.cursorIndex = 0;                                        // option "a" row
expect(accept(panel)).toBe(true);                             // supersede; guard 4 sees defined slot → NO re-stage
expect(panel.draftTextFor("q1")).toBe("my reasons");          // NOT clobbered with "my custom take"
expect(state.getQuestion("q1")?.answer?.value).toBe("a");

expect(submit(panel, deps)).toBe(true);
expect(state.getQuestion("q1")?.answer?.text).toBe("my reasons");
const msg = sendMessage.mock.calls[0][0] as { content: string };
expect(msg.content).toContain("q1: Alpha — my reasons");
expect(msg.content).not.toContain("my custom take");
```

## Scenario (b) — deleted-to-empty wins (test body sketch)

```ts
commitWriteIn(panel, "my custom take");
expect(panel.draftTextFor("q1")).toBeUndefined();

panel.currentId = "q1";      // cursor auto-seeds to ✎ row (recorded write-in)
expect(accept(panel)).toBe(true);   // ✎ row → write-in editor (same entry as commitWriteIn)
panel.textField.setText("");        // the deliberate delete-to-empty
expect(panel.handleInput("\r")).toBe(true);   // writeInEnter empty branch → commitTextDraft("q1", "")
expect(panel.draftTextFor("q1")).toBe("");    // DEFINED empty — the user's state

panel.cursorIndex = 0;
expect(accept(panel)).toBe(true);   // supersede; guard 4 reads "" (defined) → skips staging
expect(panel.draftTextFor("q1")).toBe("");    // still the user's empty

expect(submit(panel, deps)).toBe(true);
expect(state.getQuestion("q1")?.answer?.text).toBeUndefined(); // reconcile skips "" — no elaboration
const msg = sendMessage.mock.calls[0][0] as { content: string };
expect(msg.content).toContain("q1: Alpha");
expect(msg.content).not.toContain("my custom take");
```

## Why these must stay GREEN-ON-ARRIVAL (not red-first)

Guard 4 + wiring already landed (T2.S1 commit e780a32; T3.S1 wiring at :317). These are
STABILIZATION tests pinning the landed semantics for P1.M3.T2's coherence sweep. If RED:
the defect is in the helper/wiring (or the test mis-drove a gesture) — NEVER weaken the
assertions; report against T2.S1/T3.S1.

## Verified non-interference

- q1 has no dependsOn in BASIC → FR-18 seam never fires (direct apply; also stageText's
  text gate sees zero victims).
- q2 stays OPEN through both scenarios → maybeAutoSubmit never fires on the supersede
  (that variant is T4.S3's, not mine).
- consumeCommittedBuffer + store: the elaboration save re-populates both slot and store
  ("my reasons") / ("") — draftTextFor's slot-first read makes either authoritative.

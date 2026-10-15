# P1.M1.T4.S2 research notes — kind-flip + non-custom no-op scenario tests

All findings verified against the working tree on this branch (T2.S1 helper + T3.S1 wiring landed; T3.S2 modal landed).

## 1. What exists vs what this task adds

`describe("stageSupersededWriteIn — WRITEIN-002 re-bind guards")` (actions.test.ts:888-945) already has
UNIT pins calling the helper directly with hand-built answers:
- `test_supersede_guard1_non_custom_or_missing_superseded_never_stages` (:900)
- `test_supersede_guard3_kind_flip_same_value_never_stages` (:919)

These do NOT exercise the real gesture path (acceptOptionIndex → :332 wiring), the real write-in
commit (writeInEnter → consumeCommittedBuffer), or the submit outcome (reconcile + shipped message).
T4.S2's two tests are the SCENARIO versions of guards 3 and 1 — end-to-end no-ops through the
wired direct path from T3.S1 (item INPUT).

## 2. Guard code (src/panel/actions.ts:367-379, verbatim order)

```ts
export function stageSupersededWriteIn(panel, questionId, superseded, newValue): void {
  if (superseded === undefined || superseded.custom !== true) return; // 1: only write-ins re-bind
  const text = superseded.value;
  if (text.trim() === "") return; // 2: degenerate
  if (text === newValue) return; // 3: kind-flip — never "Alpha — Alpha"
  if (panel.draftTextFor(questionId) !== undefined) return; // 4: user-held draft wins
  panel.commitTextDraft(questionId, text);
}
```

Wired at actions.ts:332 inside acceptOptionIndex — AFTER applyAnswer, BEFORE maybeAutoSubmit.
Guard 1 rationale (architecture §(d) point 1): non-custom recorded answers with a DIFFERENT value
are plain option→option edits with no kept-text contract. Guard 3 rationale (§(d) point 3): a
write-in byte-equal to the accepted option's value is a pure kind flip; staging would ship
"q1: Alpha — a" (label — staged text) at the next submit.

## 3. Scenario (a) — kind-flip no-op. Mechanic trace (all verified)

1. `commitWriteIn(panel, "a")` (helper INSIDE the WRITEIN-002 submit describe, :2224-2231):
   currentId="q1", cursorIndex=2 (✎ row), accept → write-in duty, setText("a"), handleInput("\r").
   writeInEnter: q1 OPEN → the byte-identical inert branch (fires only on RE-commit with a
   recorded answer) does NOT trigger → genuine commit: answer {value:"a", custom:true},
   consumeCommittedBuffer (slot + store cleared), advance to q2.
2. `panel.currentId = "q1"` — ANSWER-PIN-001 setter re-seeds cursor to the recorded answer's row.
   Recorded is CUSTOM → seeds to the ✎ row (2), NOT option row 0. Must set cursorIndex = 0
   explicitly (the rewritten :2277 test does exactly this).
3. `accept(panel)` → acceptOptionIndex: recorded {value:"a",custom:true}; the ANSWER-PIN-001 inert
   branch requires `recorded.custom !== true` → SKIPPED → genuine supersede. FR-18 gate: q1
   answered, BASIC has no dependsOn → zero victims → direct apply (no modal). applyAnswer replaces
   the whole answer → {value:"a"}, custom gone. stageSupersededWriteIn(text="a", newValue="a")
   → guard 3 returns → NOTHING staged.
4. submit: reconcile draftTextFor → undefined → skip → answer.text stays undefined. Shipped line
   `q1: Alpha`, never `q1: Alpha — a`.

## 4. Scenario (b) — non-custom supersede stages nothing. THE KEY DESIGN CONSTRAINT

**submit flushes ONLY the DraftStore, never the panel-local draftSlots map.**
- actions.ts:813: `panel.drafts?.shipDrafts?.(pendingIds.filter(...))` — store-only.
- panel.ts: draftSlots.delete exists ONLY in consumeCommittedBuffer (:985). Nothing in the
  submit path touches panel.draftSlots.
- draftTextFor (panel.ts:1209) is slot-FIRST: `draftSlots.get(qid)?.text ?? drafts?.getDraft(qid)`.

Consequence: a "real gesture" elaboration (type + enter) followed by an intermediate submit leaves
`draftTextFor("q1")` DEFINED forever — the switch to 'b' would then be a guard-4 skip (T4.S1's
territory), and the contract's `draftTextFor === undefined` pin would be UNPINNABLE.

Therefore the elaboration-carrying answer is SEEDED via `state.applyAnswer("q1", { value: "a",
text: "...", at: T0 })` — the same raw primitive the house already uses
(test_submit_elaboration_attaches_to_real_option_answer seeds `applyAnswer("q1", {value:"a", at:T0})`
directly). This models "elaboration already shipped as text" (what a prior submit leaves behind)
while guaranteeing the precondition draftTextFor === undefined.

Trace: currentId="q1" (seeds cursor to recorded row = option "a", index 0), cursorIndex = 1
(option "b"). accept → inert check: values differ ("a" ≠ "b") → genuine apply. Zero victims →
direct. applyAnswer REPLACES the whole answer (state.ts:374-380) → text DROPPED.
stageSupersededWriteIn(recorded non-custom) → guard 1 returns → no slot. submit ships
`q1: Beta`; the dropped elaboration string appears nowhere.

## 5. Fixtures (verified, actions.test.ts:52-135)

- `T0 = "2025-01-01T00:00:00.000Z"` (:52)
- `OPTS_AB = [{value:"a",label:"Alpha"},{value:"b",label:"Beta"}]` (:60) — labels render in the
  submission line: value "a" → "Alpha", value "b" → "Beta".
- `seed(specs)` (:83): upsert then applyAnswer/setStatus.
- `makePanel(state, { drafts: store })` (:109), `makeDeps(isIdle=true)` → {deps, sendMessage} (:126).
- `BASIC` (:132): q1 (recommendation "a") + q2, both OPEN, NO dependsOn → FR-18 never fires.
- `commitWriteIn` is declared INSIDE the submit describe block (:2224-2231) — usable by any test
  in that block without new imports.
- Message assertions house pattern: `sendMessage.mock.calls[0][0] as { content: string }`,
  `expect(msg.content).toContain("q1: Alpha")` / `not.toContain(...)`.

## 6. Placement + sibling collision avoidance

Insertion point: END of `describe("submit — WRITEIN-002 draft role binding (h2.32/h2.48)")`
(:2219) — after `test_zero_pending_flash_names_held_drafts_verbatim` (~:2413, currently the
block's last test). T4.S1 (parallel, same file) inserts its two guard-4 tests immediately after
the rewritten `test_submit_superseded_writein_rebinds_as_elaboration` (:2277) — end-of-block
append is collision-free in content terms; line numbers will drift (anchor by test NAMES).
Modal tests (T3.S2, landed :2315/:2370) are untouched.

## 7. Boundary with siblings (do NOT drift)

- T4.S1 owns guard-4 scenarios (user-held wins, delete-to-empty wins) — scenario (b) here
  deliberately seeds the answer to keep draftTextFor undefined, so guard 4 is never the pin.
- T4.S3 owns the auto-submit same-gesture variant — q2 STAYS OPEN in both tests (completeness
  absent → maybeAutoSubmit no-ops at actions.ts:333).
- T3.S2 owns the FR-18 modal path — do NOT add dependsOn overrides.
- Unit guard tests (:888-945) stay untouched — scenario tests are additive, not replacements.

## 8. Mutation checks that prove the pins

- Guard 3 removed (delete `if (text === newValue) return;`) → scenario (a) FAILS at
  draftTextFor ("a" staged) and/or at submit ("Alpha — a" ships).
- Guard 1 removed (delete the custom check) → scenario (b) FAILS: recorded.value "a" ≠ "b" →
  stages "a" → draftTextFor "a".
Both mutations must be reverted after the check.

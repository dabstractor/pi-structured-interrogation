# P1.M1.T4.S3 research — auto-submit same-gesture variant (AUTOSUBMIT-003 rule b)

## 1. The scenario (architecture/bug001-writein-supersede.md)

- §(f) risk 3: "on a complete set, the supersede edit itself can trigger `maybeAutoSubmit` (AUTOSUBMIT-003 rule b) → the re-bound elaboration ships in the same gesture, with no chance to edit/clear the staged draft first. This matches the letter of the contract ('attaches at the next submit')."
- §(e) "Modified" row: "optionally strengthen with the auto-submit variant (supersede as the last-answerable edit on a complete set fires `maybeAutoSubmit` immediately; the *same-gesture* submission should carry `q1: Alpha — my custom take`)".
- Task description placeholder "q1: <Option> — <write-in text>" — q1 is generic; the superseded question must be the LAST ANSWERABLE one (see §2), so in a 2-question set the write-in lives on q2.

## 2. Rule (b) gating — actions.ts maybeAutoSubmit (:886-955)

After no-deps return, gate-hold (n>0 && pending>0 → return), `unanswered > 0 → return`, `pending === 0 → return`:
- `commit === undefined → return` (probe/direct call never fires).
- If `!commit.wasUnanswered` (edit commit): `lastAnswerable = [...ordered].reverse().find(q => q.status !== "moot" && q.status !== "withdrawn")`; fires ONLY if `commit.questionId === lastAnswerable?.id`.
- Fires: `submit(panel, d)`; if shipped → `panel.flash("submitted — {pending} answer(s)")`.

acceptOptionIndex computes `wasUnanswered = q.status === "open" || q.status === "reasked"` PRE-apply and passes `{wasUnanswered, questionId: q.id}`.

## 3. Landed wiring order — actions.ts acceptOptionIndex (~:295-335)

```
recorded = q.answer                                   // PRE-apply capture
inert branch: recorded.custom !== true && same value && not reasked → advance, "noop"
proposed = {value, at}
wasUnanswered = ...
FR-18: status answered/submitted/closed → confirmRippleEdit (zero victims → applies directly)
panel.state.applyAnswer(q.id, proposed)
evaluateDependsOn(panel.state)
advanceAfterAccept(panel)
stageSupersededWriteIn(panel, q.id, recorded, proposed.value)   // :332
maybeAutoSubmit(panel, undefined, {wasUnanswered, questionId: q.id})  // :333
```

The landed comment at :322-331: staging MUST FOLLOW advanceAfterAccept (the advance's syncBufferToQuestion write-through honors the consumed "" buffer as delete-to-empty and would wipe a pre-advance staging) and MUST PRECEDE maybeAutoSubmit ("whose same-gesture delivery must find the slot staged").

NOTE: the work-item text says "staging precedes evaluateDependsOn/advanceAfterAccept" — inaccurate vs the landed code. The load-bearing invariant for THIS task is only: **stageSupersededWriteIn precedes maybeAutoSubmit**. The "fix the call order" clause means restore THAT invariant (staging before the maybeAutoSubmit call), keeping staging after advanceAfterAccept.

stageSupersededWriteIn guards (:367-379): (1) custom-only, (2) non-whitespace, (3) text !== new option value, (4) draftTextFor === undefined. Stages via commitTextDraft (both panel slot + DraftStore seam).

## 4. Scenario construction (verified against fixtures + sibling tests)

Seeded design (mirrors test at actions.test.ts:2715 `test_auto_edit_on_complete_set_fires_only_on_last_sequential` + writeInSeed house pattern :680-687):

```ts
const state = seed([
  { id: "q1", overrides: { status: "answered" } },  // → answer {value:"a", at:T0} non-custom
  { id: "q2", overrides: { status: "answered" } },
]);
state.applyAnswer("q2", { value: "my custom take", custom: true, at: T0 }); // recorded WRITE-IN on LAST answerable
```

applyAnswer REPLACES the whole answer → q2 = {value:"my custom take", custom:true, at:T0}. Status stays "answered" (pending). Set complete, no gate group in seed → rule (b) eligible.

Gesture:
- `panel.currentId = "q2"` — ANSWER-PIN-001: setter re-seeds cursor to the recorded answer's row; custom → the ✎ row (index 2 for 2 options). MUST then set `panel.cursorIndex = 0` explicitly (option "a").
- `accept(panel)` → recorded.custom === true → inert branch impossible → genuine supersede; status "answered" → confirmRippleEdit; zero victims (no dependsOn) → applies directly (no modal — T3.S2 territory).
- Tail: applyAnswer {value:"a"} (custom gone) → evaluateDependsOn → advance → stageSupersededWriteIn(q2, recorded, "a"): guards 1✓ 2✓ 3✓ ("my custom take" ≠ "a") 4✓ → commitTextDraft("q2", "my custom take") → maybeAutoSubmit({wasUnanswered:false, questionId:"q2"}) → lastAnswerable = q2 → FIRES → submit():
  - reconcileDraftsForSubmit (:619): q2 status "answered", answer.custom !== true, draftTextFor = "my custom take" non-blank → applyAnswer {value:"a", text:"my custom take"}; q1 no draft → unchanged.
  - epoch 1→2, sendMessage once, statuses → "submitted".
  - flash "submitted — 2 answer(s)".

Assertions: sendMessage times(1) (the auto-submission itself — NO manual `submit(panel, deps)` call in the test, that's the same-gesture point); epoch 2; q2 answer {value:"a", text:"my custom take"}, custom undefined; msg.content toContain("q2: Alpha — my custom take") (delivery renders `<label> — <text>`; the ✎ marker is gone — custom cleared) and toContain("q1: Alpha") (whole pending set ships); footerFlash?.text "submitted — 2 answer(s)".

## 5. Sibling/anchor facts

- describe block: `describe("submit — WRITEIN-002 draft role binding (h2.32/h2.48)")` at :2219, ends just before `describe("maybeAutoSubmit — completeness hook ...")` at :2605.
- Already landed inside it: rewritten `test_submit_superseded_writein_rebinds_as_elaboration` (:2277 region), T4.S1's `test_supersede_userheld_elaboration_draft_wins_over_restate`… (exact: `..._over_restage`) + `test_supersede_deleted_to_empty_slot_wins_no_restage`, T3.S2's `test_submit_superseded_writein_rebinds_through_fR18_modal`.
- T4.S2 (parallel, in flight) appends `test_supersede_kind_flip_writein_equals_option_value_stages_nothing` and `test_supersede_non_custom_elaborated_answer_stages_nothing` at the END of the block → this task appends AFTER those, before the closing brace. Anchor by test names, never line numbers.
- Comment-header convention: `[Mode A] BUG-001 / P1.M1.T4.S3 — …`.
- Fixtures: T0 :52, OPTS_AB :60-63 ({value:"a",label:"Alpha"},{value:"b",label:"Beta"}), seed :83, makePanel :109, makeDeps :126, BASIC :132-135. makeDeps(true) → {sendMessage mock, isIdle:()=>true}.
- Runner: `npx vitest run src/panel/actions.test.ts -t "supersede"`; full `npm test` + `npm run typecheck`.

## 6. Failure triage ("do not weaken")

If msg.content lacks " — my custom take" while state carries no text: check (a) `sendMessage` called 0× → rule-(b) didn't fire (wrong question / not last answerable / set incomplete); (b) called once but no elaboration → staging ran AFTER maybeAutoSubmit or not at all → fix acceptOptionIndex order (stage before maybeAutoSubmit, after advanceAfterAccept), never weaken assertions.

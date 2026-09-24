# Research notes — P1.M2.T4.S1 (two-stage removal)

## Removal-safety map verification (against current tree, post-T2/T3 partial landing)

Anchor drift: the work-item description cites pre-T2/T3 line numbers. Current tree (1818-line panel.ts):

- `advanceArmed = false` field: **panel.ts:428** (description said :412). Public — referenced by tests.
- `textDuty` field: panel.ts:419 (T2/T3 landed); write-in branch in stage (c): panel.ts:781 (`writeInEnter`).
- Stage (a) one-shot disarm: **panel.ts:759–762** (`const enter` is defined at ~:757 — KEEP it, stage (c) and the confirm-mode/`"\n"` newline exclusion use it).
- Stage (b) armed stage-2 block: **panel.ts:764–773** (incl. `advanceToNextUnanswered()` call + "runs BEFORE the keys seam" comment). DELETE.
- `saveTextDraft` (**:805–817**): the `q?.type === "text"` arming conditional collapses to `this.stageText(this.textField.getText())`; JSDoc "arm the one-shot advance flag" rewording.
- `exitTextField` (**:828–830**): `stageText(text, false)` → `stageText(text)`; JSDoc "do NOT arm the advance flag" rewording.
- `stageText` (**:840–854**): drop `arm: boolean` param; `beginTextConfirm(this, text, { arm })` → `beginTextConfirm(this, text)`.
- `commitTextDraft` (**:867–889**): drop `opts?: { arm?: boolean }` param entirely (no caller passes arm after stageText collapses); delete `if (opts?.arm !== false) this.advanceArmed = true;` (**:887**); JSDoc rewrite.
- `advanceToNextUnanswered` (**:891+**): dead code after stage (b) deletion — DELETE (actions.ts `advanceAfterAccept`/`nextUnanswered` remain the advance primitives; T2's write-in commit already uses them).
- handleInput [Mode A] JSDoc (~:668–704): rewrite stage ladder description (confirm modal → gate dismissal → (c) enter handling → keys seam → editor forwarding).
- `openExternalEditor` JSDoc ~:1153: "Deliberately does NOT … touch advanceArmed" rewording.
- draftSlots class JSDoc ~:388: "armed by stage-1 enter ({@link saveTextDraft})" rewording.

## ripple-confirm.ts (EDIT REQUIRED — map item 4)

- TextConfirmMode field `arm?: boolean` (**:84–95**): DELETE field + its JSDoc block.
- `beginTextConfirm(panel, text, opts?: {arm?})` (**:200**): drop opts; drop `arm: opts?.arm !== false` from the stashed payload.
- `applyTextConfirm` (**:226–230**): `panel.commitTextDraft(cm.questionId, cm.text, { arm: cm.arm !== false })` → `panel.commitTextDraft(cm.questionId, cm.text)`; JSDoc "arm the one-shot advance flag" rewording.
- Header JSDoc :38–54 mentions arm/the two-stage machinery — reword (already has a "machinery is being removed, P1.M2.T4.S1" note).

## External test references to `panel.advanceArmed` (must be scrubbed — field is deleted)

- src/panel/panel.test.ts:1337, :1504 — `expect(panel.advanceArmed).toBe(false)` assertions (back-out tests; delete the assertion, keep the behavioral ones around them).
- src/panel/actions.test.ts:847 — same.
- src/panel/ripple-confirm.test.ts:222, :265, :412, :427, :443 (`toBe(true)` — armed case!), :474.
- two-stage.test.ts: throughout (rewritten per keep/drop classification).

grep confirms NO runtime reads of `panel.advanceArmed` outside panel.ts and these tests.

## two-stage.test.ts classification (verified against full file read)

- DROP describe "stage 1 save, stage 2 advance" (:175): all four tests assert arming/stage-2/third-enter behavior. Superseded by: text-question enter now COMMITS (writeInEnter via textDuty "writein" — on type:"text" the duty is writein per T3's duty-follows-cursor) — add replacement tests under the new semantics (enter on type:"text" → applyAnswer value=text custom:true, advance; elaboration enter on choice → save+blur, unanswered, no advance — mirrors AC-2b already covered by T3's tests; keep a minimal regression here or rely on T3's).
- DROP describe "one-shot disarm" (:266): both tests — no flag exists. The "armed enter intercepted before keys seam" property is gone by design (WRITEIN-001 removal).
- KEEP describe "newline safety" (:294): strip `advanceArmed` assertions (5 occurrences); `test_kitty_plain_enter_is_stage1_not_newline` — on a CHOICE-question seed it's elaboration save+blur; on text seed it's a commit — rewrite expectation (seedOpenText + enter now commits: status answered, focus options); `test_ctrl_j_while_armed_disarms…` → replace with ctrl+j never saves/commits (editor still focused, text unchanged).
- KEEP describe "note mode" (:363): strip `advanceArmed` assertion in first test; rest unchanged.
- KEEP describe "refocus seeding + draft survival" (:443): `test_draft_slot_survives_navigation_and_reseeds_on_return` uses `handleInput("\r")` twice (stage1+stage2) to advance — replace second `\r` with a real navigation key (e.g. "\x1b[Z" shift+tab = nextQuestion, matching the third test) or an option accept; first `\r` on a choice elaboration still saves+blurs (unchanged).
- KEEP describe "history isolation" (:492): flow does stage-1 + stage-2 enters — rework: with commit-at-enter, the writein/text enter path must also never addToHistory; drive a type:"text" question (enter commits) + note save, assert addToHistory never called + onSubmit undefined.

## Test harness facts (reuse)

- Fixtures: `seedOpen`/`seedOpenText`/`choiceQ`, `stubTheme`, `draftsSpy()`, `fakeEditor()` (raw byte strings: "\r" enter, "\x1b[13;2u" kitty shift+enter, "\x1b[13;2~" xterm, "\n" ctrl+j, "\x1b\r" alt+enter, "\x1b[13u" kitty plain enter), `makePanel(state, keysSpy)`, `focusText(panel)` (ctrl+t "\u0014").
- Keys-spy flavor only for dispatch-ordering assertions.
- Upstream contracts: T2's `writeInEnter(panel)` (actions.ts) — enter on writein duty: empty buffer → save draft + blur, NO commit; non-empty → applyAnswer({value, custom:true}) + advance. T3's `textDuty` decision: type:"text" ⇒ "writein"; cursor on Other row ⇒ "writein"; else "elaboration".

## Validation

- `npm test` (vitest), `npm run typecheck`. Full panel suite required (advanceArmed is public/referenced cross-file).

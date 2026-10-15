# Research — P1.M1.T3.S1 (acceptOptionIndex direct-path wiring + manufactured-test rewrite)

## Verified code (live read)
- `src/panel/actions.ts` acceptOptionIndex (:268-321):
  - :294 `const recorded = q.answer;` (captured for the ANSWER-PIN-001 inert check; the inert branch :296 requires `recorded.custom !== true` — so every apply behind a `custom:true` answer is a genuine supersede; no extra value check needed).
  - :299 `const proposed = { value: opt.value, at: new Date().toISOString() };`
  - :310 FR-18 seam gate (answered/submitted/closed + victims>0 → modal/veto — S2's path)
  - :313 `panel.state.applyAnswer(q.id, proposed);` — **INSERTION POINT: `stageSupersededWriteIn(panel, q.id, recorded, proposed.value);` immediately after, before evaluateDependsOn/advanceAfterAccept (:315-317)**. Ordering before advance matches commit-tail conventions and guarantees staging precedes maybeAutoSubmit (T4.S3's same-gesture variant).
- `reconcileDraftsForSubmit` (:557-585, called from submit :634): attach branch :573-579 fires when `q.status==="answered" && q.answer.custom !== true`, attaching `draftTextFor(q.id)` as `answer.text` — the staged slot flows through unchanged. Stale design comment at **:538** to extend (Mode A): name stageSupersededWriteIn as the KEPT-text mechanism (the old "slot text was KEPT (R4)" claim was half-true since VAL-002).
- `stageSupersededWriteIn` — CONTRACT from P1.M1.T2.S1 (assume landed exactly):
  ```ts
  export function stageSupersededWriteIn(panel, questionId, superseded: QuestionAnswer|undefined, newValue: string): void
  // guards: 1 custom-only; 2 non-whitespace; 3 kind-flip (text===newValue); 4 user-draft-wins (draftTextFor !== undefined, incl. delete-to-empty "")
  // then panel.commitTextDraft(questionId, text)
  ```
  Exported from src/panel/actions.ts — same module as the call site; plain call, no import needed.

## The manufactured test (src/panel/actions.test.ts:2213, verified verbatim)
`test_submit_superseded_writein_rebinds_as_elaboration`:
- `commitWriteIn(panel, "my custom take")` — REAL commit (helper :2161-2167: currentId="q1", cursorIndex=2 (✎ row), accept(panel), textField.setText, handleInput("\r")) → real consumeCommittedBuffer deletes slot+store.
- **:2223 `panel.commitTextDraft("q1", "my custom take"); // kept slot text (R4)` — THE MANUFACTURED LINE.** Delete it. With the fix, it would also be actively misleading: it is exactly the "user-held draft" guard 4 defers to, so the test would pass without exercising the fix.
- :2226-2230 supersede via real accept (currentId="q1" re-seeds cursor to ✎ row per ANSWER-PIN-001; test explicitly drives cursorIndex=0); asserts `draftTextFor("q1") === "my custom take"` — after the line-2223 deletion this assertion IS the fix's regression check.
- :2236-2242 submit asserts `a?.text === "my custom take"`, custom undefined, content `q1: Alpha — my custom take`.

## TDD sequence
1. DELETE :2223 → run `-t "superseded"` → RED at :2230 (draftTextFor undefined — consume deleted it, nothing re-staged).
2. Wire the call at actions.ts after :313 → GREEN with zero other changes.
3. Extend :538 comment (Mode A).

## Test-harness conventions (verified)
- `seed(BASIC)` (q1/q2 choice, options a/b presumably alpha/beta), `makePanel(state, { drafts: store })`, `makeDeps(true)` → `{ deps, sendMessage }` (vi.fn sendMessage), `submit(panel, deps)`, `accept(panel)` wrapper, `T0` timestamp const. Real modules — no mocks (house AUTOMATION-POLICY).

## Scope boundaries
- S2 (parallel/later): applyConfirmedEdit modal path in ripple-confirm.ts:142-166 — NOT here (direct path only).
- T4.S1-S3: user-held-draft-wins, delete-to-empty, kind-flip, non-custom supersede, auto-submit same-gesture scenarios — unit coverage belongs there; this subtask only wires + de-manufactures.
- P1.M1.T1.S1 decisions.md ruling — already landed/landing (cite in comment if it exports a section name; don't create a second entry).
- VAL-002 pins to stay green: `test_wi_same_value_recommit_consumes_buffer_no_draft_residue` (:776) and reasked variant (:816-840); also `test_submit_writein_ships_value_custom_no_text_duplication` (:2174) — the reconcile `custom !== true` guard is untouched.

# BUG-008 — Enter on a text question's primary affordance is a silent no-op

Verified against HEAD 613437d.

## 1. Current code paths

### accept() — `src/panel/actions.ts:213-228`

```ts
export function accept(panel: InterrogationPanel): boolean {
  const q = currentQuestion(panel);
  if (q === undefined) return false;
  if (q.status === "moot" || q.status === "withdrawn") return true;
  if (q.type === "text") return true;   // ← consumed silent no-op (line 218)
  const optionCount = q.options?.length ?? 0;
  if (panel.cursorIndex >= optionCount) {
    // ✎ Other row: write-in duty + editor focus
    panel.textDuty = "writein";
    panel.focusTextField();
    return true;
  }
  return acceptOptionIndex(panel, q, panel.cursorIndex);
}
```
JSDoc (actions.ts:201-212) explicitly documents "Text question → consumed no-op (field composition is P1.M4.T1.S2)". CONFIRMED.

### textAffordanceLine — `src/panel/short-view.ts:245-252`

```ts
function textAffordanceLine(cursorIndex: number, theme: Theme, budget: number, dimAll: boolean): string {
  const prefix = cursorIndex === 0 ? CURSOR : BLANK;
  const placeholderBudget = Math.max(1, budget - visibleWidth(prefix) - visibleWidth("✎ "));
  const placeholder = truncateVisible(TEXT_PLACEHOLDER, placeholderBudget);
  const content = `${prefix}✎ ${placeholder}`;
  return dimAll ? `${INSET}${theme.fg("dim", content)}` : `${INSET}${content}`;
}
```
Rendered as the ONLY focus target for text questions (renderShortViewOptions short-view.ts:169-172; cursorIndex always 0 per initialCursorIndex short-view.ts:98-100). Renders `  ▸ ✎ answer…` full intensity — "the question's primary affordance" per its JSDoc.

### Footer hint — `src/panel/layout.ts:440-462` renderFooter

`if (screen === "short") hints.unshift("enter accept"); // enter is not remappable` — unconditional for the short screen; there is no text-question-specific hint swap (the editorExit variant only applies when the editor already has focus). So the footer advertises "enter accept" while enter on a text question does nothing. CONFIRMED. (Pinned by layout.test.ts:251/288/572 "enter accept"; editor-focus variant at layout.test.ts:307-318 swaps to "enter save".)

### ctrl+t entry — the documented way in

- Keymap: ctrl+t → `onFocusText` routed action (keys.ts defaultRoutedActions ~keys.ts:297: `onFocusText: (p) => { p.focus = "text"; }`).
- Panel refinement — `src/panel/panel.ts:616-628`: on ctrl+t, `p.focusTextField(desiredTextDuty(p))`.
- `desiredTextDuty` — `src/panel/keys.ts:288-294`:

```ts
export function desiredTextDuty(panel: InterrogationPanel): "writein" | "elaboration" {
  const q = panel.currentId !== undefined ? panel.state.getQuestion(panel.currentId) : undefined;
  if (q?.type === "text") return "writein";
  if (panel.cursorIndex === (q?.options?.length ?? 0)) return "writein"; // ✎ Other row
  return "elaboration";
}
```
So for a text question ctrl+t opens the editor in WRITE-IN duty (seeded from the freshest draft via focusTextField). It is a toggle: re-press while focused closes the editor (ESC-002, panel.ts:616 comment). Enter in write-in duty commits via `writeInEnter` (panel.ts:800: `else if (this.textDuty === "writein") writeInEnter(this);`).

## 2. Natural fix

In accept() (actions.ts:218) replace the no-op with the same pair the ✎ Other row uses:

```ts
if (q.type === "text") {
  panel.textDuty = "writein";
  panel.focusTextField();
  return true;
}
```
Or, to stay symmetric with ctrl+t's duty-declaration site: `panel.focusTextField(desiredTextDuty(panel))` — desiredTextDuty returns "writein" for text questions anyway (keys.ts:290), so both are equivalent; the explicit pair matches the adjacent Other-row branch exactly and avoids importing keys.ts into actions.ts (keys.ts already imports actions — reverse import would cycle; note actions.ts does NOT currently import keys.ts, and panel.ts:39 imports desiredTextDuty from keys — keep the assignment inline in accept()).

`focusTextField(duty?)` — panel.ts:1056-1059: sets focus + textDuty + seeds the buffer from the freshest draft (draftSlots/DraftStore, R4 revisit restore).

Ripple/modal side effects to consider:
- Ripple seam: writeInEnter (actions.ts:282-313) already routes answered/submitted + rippleVictims > 0 through beginWriteInConfirm; opening the editor is pre-ripple, so no new seam needed.
- Editing an already-answered text question now becomes one extra gesture away from a real edit (previously re-edit required ctrl+t anyway — same behavior, just reachable via the advertised key).
- ESC-002 toggle semantics unchanged (enter no longer reaches the editor path differently).
- Footer statics: while editor focused, footer already swaps to "enter save" (layout.ts editorExit) — correct after the fix.
- moot/withdrawn no-op branch stays before the text branch (correct ordering).

## 3. Tests pinning the no-op + spec wording

- actions.test.ts:268 `test_accept_on_text_question_is_noop_seam_for_m4` — PINS the no-op; must be rewritten to assert editor focus + textDuty "writein".
- actions.test.ts:258 `test_f_accept_on_explain_affordance_sets_text_focus_no_answer` (related: explain affordance focus), :211 `test_option_movement_on_text_question_domain_is_single_index`, :1293 NEW-002 re-asked text draft.
- short-view.test.ts:197 "(f) primary affordance renders..." pins the affordance render (unchanged by fix).
- keys.test.ts:947 `test_ctrl_t_in_short_view_still_dispatches_options_and_text_focus`; panel.test.ts:2256 desiredTextDuty preference tests.
- Spec: `spec/product-requirements.md:27` FR-3 AUTOSUBMIT-001 lists "text-answer enter" as an answer-commit gesture, and :79 AC-2c: "answer the LAST remaining question (accept / write-in / text `enter`) → submission delivers" — the spec treats text-enter as a commit gesture (via the editor's enter), not a panel-level no-op; nothing mandates the panel-level no-op. P1.M4.T1.S2 (field composition) was the cited rationale — already implemented.

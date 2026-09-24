# Research notes — bugfix P1.M2.T2.S1 (✎ marker parity: hasTextAnswer honors answer.custom)

## Verified code (src/panel/layout.ts, overview.ts)

- `hasTextAnswer(q)` (layout.ts:181–186, module-PRIVATE):
  ```ts
  function hasTextAnswer(q: Question): boolean {
    if (q.status !== "answered" && q.status !== "submitted") return false;
    if (q.answer === undefined) return false;
    return q.type === "text" || (q.answer.text !== undefined && q.answer.text !== "");
  }
  ```
  SOLE call site: `statusMarkers(q, theme)` (layout.ts:298–309) → `if (hasTextAnswer(q)) parts.push("✎ text answer");`. statusMarkers is EXPORTED and feeds the short-view question line (short-view.ts docblock :13 confirms; renderQuestionLine composes it).
- Overview vocabulary (overview.ts `markerParts` ~:130–141): `isWriteIn = q.answer?.custom === true` (STRICT — comment: "corrupt truthy values must not leak"); `isTextAnswer = q.type === "text" && q.answer !== undefined`; either → suffix `" ✎"`, kind "writein"; elaboration (`answer.text` non-empty, neither of the above) → `" ≡"`. So the overview shows ✎ for write-ins while the question line shows nothing — the inconsistency (BUG-005 part 1).
- Write-in answers are committed `{ value: text, custom: true, at }` with NO `text` field (actions.ts writeInEnter :281; research note in contract). Text answers likewise commit to `value`.
- The marker STRING on the question line stays `"✎ text answer"` — the contract asks for vocabulary PARITY (the ✎ glyph), NOT importing the overview's ✎/≡ split; elaboration (`answer.text`) semantics unchanged (existing pinned test: choiceWithNote → `" ✎ text answer"`).
- `moot` branch of statusMarkers also reads `q.answer?.text` for the reason — unaffected by this change (custom answers on moot questions have no text field; reason stays "" → bare "⊘ moot"). No interaction.

## Test conventions

- layout.test.ts: `statusMarkers(q, theme)` describe at :147; `mkQuestion(id, overrides)` helper; pinned exact strings (`" ✎ text answer"`) at :173/:178. The parallel sibling test style: plain vitest, stubTheme, render(width) sweeps, NO mocks.
- The elaboration case at :176–178 (`choiceWithNote`, value "a" + text "elaboration", status submitted) pins unchanged behavior — do not flip it to ≡.
- BUG report repro shape: q1 choice, answer `{value: 'my write-in', custom: true, at}` → question line today has NO ✎; after fix it must show `" ✎ text answer"`.

## Boundaries

- Sibling P1.M2.T2.S2 (revisit preview rendering, short-view answerPreviewLine) is the OTHER half of BUG-005 — different function/file region; do not touch answerPreviewLine here.
- Parallel P1.M2.T1.S1 (bugfix wave) touches panel.ts syncBufferToQuestion/textDuty only — zero overlap.
- README write-in passages swept later in P1.M3.T2 — no docs here.

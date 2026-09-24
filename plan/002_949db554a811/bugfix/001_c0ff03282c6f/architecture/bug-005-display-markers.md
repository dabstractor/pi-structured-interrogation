# BUG-005 — Recorded write-in answers invisible in short view; ✎ marker inconsistent

Verified against HEAD 613437d.

## 1. Exact current code

### `src/panel/layout.ts:181-186` — hasTextAnswer (CONFIRMED: no `custom` check)

```ts
/** True when the question's answer carries (or is) free text. */
function hasTextAnswer(q: Question): boolean {
  if (q.status !== "answered" && q.status !== "submitted") return false;
  if (q.answer === undefined) return false;
  return q.type === "text" || (q.answer.text !== undefined && q.answer.text !== "");
}
```

Call site — only one — `src/panel/layout.ts:301` inside `statusMarkers(q, theme)` (layout.ts:297-311):

```ts
export function statusMarkers(q: Question, theme: Theme): string {
  const parts: string[] = [];
  if (q.status === "reasked") parts.push("⟳ re-asked");
  if (hasTextAnswer(q)) parts.push("✎ text answer");
  ...
}
```
`statusMarkers` is appended right-aligned to the question line (questionLine, layout.ts ~316+). So a CHOICE write-in (`{value: <text>, custom: true}`, no `text` field) gets no `✎ text answer` fragment.

### `src/panel/overview.ts:130-141` — markerParts (CONFIRMED: stricter/different semantics)

```ts
function markerParts(q: Question): { base: string; suffix: "" | " ✎" | " ≡"; kind: ... } {
  ...
  const isWriteIn = q.answer?.custom === true; // STRICT — corrupt truthy values must not leak
  const isTextAnswer = q.type === "text" && q.answer !== undefined;
  if (isWriteIn || isTextAnswer) return { base, suffix: " ✎", kind: "writein" };
  if ((q.answer?.text ?? "") !== "") return { base, suffix: " ≡", kind: "elaboration" };
  return { base, suffix: "", kind: "none" };
}
```
Overview also differs in elaboration semantics: option answer + `answer.text` shows ` ≡`, while layout's hasTextAnswer shows `✎ text answer` for the same data. Two different vocabularies for the same fact.

### `src/panel/short-view.ts:259-269` — answerPreviewLine (CONFIRMED: reads only `answer.text`)

```ts
function answerPreviewLine(q: Question, theme: Theme, budget: number, dimAll: boolean): string | undefined {
  const text = q.answer?.text;
  if (text === undefined || text === "") return undefined;
  const firstLine = text.split("\n", 1)[0] ?? "";
  const preview = truncateVisible(firstLine, Math.max(1, budget - INSET.length - BLANK.length));
  if (preview === "") return undefined;
  return `${INSET}${theme.fg("dim", `${BLANK}${BLANK}${preview}`)}`;
}
```
Call site — only one — `renderShortViewOptions` short-view.ts:169-172:

```ts
if (q.type === "text") {
  lines.push(textAffordanceLine(cursorIndex, theme, budget, dimAll));
  const preview = answerPreviewLine(q, theme, budget, dimAll);
  if (preview !== undefined) lines.push(preview);
}
```
Render shape for an answered text question: line 1 = `  ▸ ✎ answer…` (full intensity), line 2 = dimmed first-line preview. A write-in commit stores `{value: <raw buffer>, custom: true}` with NO `text` field → preview returns undefined. And for text questions, write-in commits also store `{value: text, custom: true}` (writeInEnter, actions.ts:304) → `answer.text` is undefined → preview never renders even for type:text. CONFIRMED: the only preview trigger is an `answer.text` elaboration, which text/write-in commits never set.

### Answer type — `src/state.ts:42-54`

```ts
export interface QuestionAnswer {
  /** Chosen option value (choice questions) or raw text (text questions). */
  value: string;
  /** Free-text elaboration the user attached. */
  text?: string;
  /** WRITEIN-001: value holds free text, not an option value; renders as ✎ {text}. */
  custom?: boolean;
  /** ISO 8601 timestamp of when the answer was recorded. */
  at: string;
}
```
No `note` field, no status on the answer. Write-in commit path (`writeInEnter`, src/panel/actions.ts:304): `panel.state.applyAnswer(q.id, { value: text, custom: true, at: ... })` — value holds raw text, `custom: true`, `text` undefined. State normalization (state.ts:558) preserves strict-true `custom`.

## 2. Revisit cursor re-seed

- `initialCursorIndex` (short-view.ts:98-102): text → 0; else `recommendation` option index. Answer NEVER pins the cursor (by design; test short-view.test.ts:88 "text questions → 0; answers never pin the cursor (revisited answered)").
- `currentId` setter (panel.ts:346/368-370) seeds cursorIndex via initialCursorIndex ("answers never pin the cursor").
- No recorded-answer cursor-sync exists for option answers either — revisit always re-seeds to ★ preselect. So on revisit: CHOICE write-in shows no ★ on any option (the value matches no option) and no ✎ anywhere; TEXT question shows `✎ answer…` with no preview.

## 3. Tests pinning these renders

- layout.test.ts:167 "text-answer marker for answered text questions and elaborated choices" — pins `✎ text answer` for type:text and for choice+`answer.text` (does NOT cover choice write-in → gap).
- short-view.test.ts:197 "(f) primary affordance renders; answered preview is dimmed first line only" — pins the preview but seeds `answer: { value, text: "first line\nsecond line" }` — i.e. it only passes because it hand-sets `answer.text`, which real commits never do. This test needs updating.
- short-view.test.ts:88, 306, 358 — cursor seeding / dimming / width.
- overview.test.ts:153 "test_marker_write_in_appends_pencil", 167 "test_marker_text_question_answer_appends_pencil" — pin the overview ✎ semantics.

## 4. Fix sketch

- layout.ts hasTextAnswer: add `|| q.answer.custom === true` (strict, mirroring overview.ts:137). Keep the status gate.
- short-view.ts answerPreviewLine: read the write-in value when appropriate — e.g. `const text = q.answer?.custom === true ? q.answer.value : (q.answer?.text ?? "")` (and for type:text with `custom` true the same branch covers it; type:text commits also store value+custom). First-line split and `truncateVisible(firstLine, …)` already exist in the function — reuse unchanged.
- Nearby helpers: `truncateVisible(text, maxWidth)` exported at layout.ts:95 (ANSI/wide-char safe, `…` terminator); `visibleWidth` same module. No shared `firstLine` helper — inline `split("\n",1)[0]`.
- Consider aligning the two vocabularies (overview ` ≡` vs layout `✎ text answer`) or at least documenting the difference; minimum fix is the `custom` gap in layout.
- Update short-view.test.ts:197 to seed a realistic commit shape (`{value, custom:true}`) and add a layout.test case for choice write-in marker.

Risk: none structural — both functions are pure leaf renderers with direct tests.

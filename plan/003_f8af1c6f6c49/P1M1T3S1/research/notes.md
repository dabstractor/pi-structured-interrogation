# Research — P1.M1.T3.S7 (statusMarkers ★ answered marker, FR-D10)

## Verified code
- `src/panel/layout.ts:313` `export function statusMarkers(q: Question, theme: Theme): string` — builds `parts: string[]`, current order: `⟳ re-asked` (status==="reasked"), `✎ text answer` (hasTextAnswer(q)), `⊘ moot (+reason, MARKER_REASON_CAP=24)`, `⊗ withdrawn`. Joins with `" · "`, wraps in `theme.fg("dim", " " + …)`, "" when empty. Consumed at layout.ts:362 in `renderQuestionLine` (markers right-aligned, never truncated except pathological widths).
- `hasTextAnswer(q)` (layout.ts:192): status ∈ {answered, submitted} AND answer present AND (answer.custom === true STRICT || type==="text" || non-empty answer.text). NOTE: closed+answer gets NO ✎ today; ★ will cover closed.
- Parity source: `src/panel/overview.ts` markerParts JSDoc (:107-127) + `overviewMarker` (:151). Vocabulary: `★` answered = any status carrying q.answer EXCEPT moot/withdrawn (answered/submitted/closed); `⟳` re-asked OVERRIDES ★; `⊘`/`⊗` highest precedence; `✎` composes with ★ (overview.test.ts:139-141 pins ★ per status, :156-171 pins "★ ✎").
- Architecture: plan/003_f8af1c6f6c49/architecture/panel-ui-seams.md §Markers — "Add `★ answered`. … Compose with existing `✎` text-answer marker for write-ins."

## Insert rule (derived)
In statusMarkers, add BEFORE `hasTextAnswer` push (order in parts: ⟳ first as today, then ★, then ✎ — visual order must match tests you write):
```ts
if (
  q.answer !== undefined &&
  (q.status === "answered" || q.status === "submitted" || q.status === "closed")
) {
  parts.push("★ answered");
}
```
- ⟳ override: status==="reasked" never satisfies the ★ condition → automatically excluded (no explicit suppression needed). reasked with answer → " ⟳ re-asked" only.
- moot/withdrawn excluded by the status whitelist even when answer present (moot keeps ⊘ + dimmed answer text as today).
- Compose: answered write-in → " ★ answered · ✎ text answer". Closed+answer → "★ answered" (hasTextAnswer doesn't cover closed — fine, ★ alone).
- Reasked also currently precedes ✎; keep existing relative order, insert ★ after ⟳, before ✎ so write-in answered reads "★ answered · ✎ text answer".

## Test blast radius (layout.test.ts:147-210, exact-string pins that FLIP)
- :173/:178/:186/:194 ` ✎ text answer` cases (answered/submitted, text/elaborated/writein) → ` ★ answered · ✎ text answer`
- :202 corrupt-truthy custom, answered → ` ★ answered` (✎ still correctly absent)
- :210 `plain_option_answer_still_no_marker` → NOW ` ★ answered` (rename the test — the "no marker" premise is what FR-D10 deletes)
- :149 open → "" (unchanged), :153 reasked/withdrawn (unchanged), :156 moot cases (unchanged — moot never ★)
- renderQuestionLine test at :244 uses statusMarkers(q,theme) output dynamically — self-consistent, unchanged.
- overview.test.ts ~:412/:452 checked: cursor/preselect assertions, NOT question-line parity → leave to P1.M1.T5.S9 per item contract.
- Also grep other suites for literal " ✎ text answer" / marker-string pins (renderQuestionLine integration tests may embed full lines): implementer must run full npm test and update exact-string expectations to the new vocabulary.

## Conventions
- vitest, colocated src/panel/layout.test.ts; mkQuestion(id, overrides) helper at :44; shared `theme` fixture. Plain strings asserted (theme.fg wraps dim — tests assert the full themed string, see existing).
- Mode A JSDoc on statusMarkers required (marker semantics + overview-parity rule).
- No mocks.

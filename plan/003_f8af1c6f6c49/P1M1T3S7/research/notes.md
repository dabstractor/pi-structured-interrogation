# Research — P1.M1.T3.S7 (statusMarkers ★ answered marker, FR-D10)

Verified against the CURRENT codebase (post S1–S6: commits 1fba337…2d7a98f).
Note: an earlier draft PRP for this same item lives at
`plan/003_f8af1c6f6c49/P1M1T3S1/PRP.md` from the task-breakdown session (stale
dir numbering); this research re-validated every claim against today's files.
`src/panel/layout.ts` has NOT been touched since 98398af (wayfinding
restructure) — statusMarkers is exactly as the seam doc describes.

## Verified code
- `src/panel/layout.ts:313` `export function statusMarkers(q, theme): string`
  — builds `parts: string[]` in order: `⟳ re-asked` (status==="reasked"),
  `✎ text answer` (hasTextAnswer(q)), `⊘ moot (+reason, MARKER_REASON_CAP=24)`,
  `⊗ withdrawn`. Joins with `" · "`, returns `""` when empty, else
  `theme.fg("dim", " " + parts.join(" · "))`. NO ★ today.
- `hasTextAnswer` (layout.ts:192): requires status ∈ {answered, submitted}
  (NOT closed) AND answer present AND (custom === true STRICT, or type==="text",
  or non-empty answer.text). ★ must be gated on its OWN status whitelist
  (answered/submitted/closed) — do not reuse hasTextAnswer (it drops closed).
- Parity source (READ-ONLY): `src/panel/overview.ts:130` `markerParts` + JSDoc
  :107-127 — `★` = any status carrying `q.answer` EXCEPT moot/withdrawn;
  `⟳` overrides ★; `⊘`/`⊗` highest precedence; `✎`/`≡` suffixes compose with ★.
- `renderQuestionLine` (layout.ts:346) consumes markers ~:362 — measures via
  `visibleWidth`, ANSI-safe; no width changes needed.
- `src/panel/short-view.ts:13` module JSDoc ALREADY documents "★ … question
  lines reuse it as the answered/text-answer marker (layout.ts statusMarkers)"
  — the vocabulary table anticipates this change; short-view.ts needs NO edit.
- Seam doc: `plan/003_f8af1c6f6c49/architecture/panel-ui-seams.md` §Markers
  (FR-D10): "Add `★ answered`. … Compose with existing `✎`."

## Insert rule (derived, verified against current body)
Insert between the reasked push and the hasTextAnswer push:
```ts
if (
  q.answer !== undefined &&
  (q.status === "answered" || q.status === "submitted" || q.status === "closed")
) {
  parts.push("★ answered");
}
```
- ⟳ mutual exclusion is BY CONSTRUCTION (status "reasked" fails the whitelist)
  — no explicit suppression needed. Reasked-with-answer → " ⟳ re-asked" only.
- Moot/withdrawn excluded by the whitelist even when answer present.
- Composition: answered write-in / text / elaborated → " ★ answered · ✎ text
  answer" (★ before ✎). Closed plain answer → " ★ answered" alone.
- Deliberate asymmetry kept: closed + write-in shows ★ but NOT ✎ (hasTextAnswer
  excludes closed — existing contract; do NOT widen hasTextAnswer here).

## Test blast radius (ALL inside src/panel/layout.test.ts, describe :147-210)
- :173 textQ (answered, type text) → ` ★ answered · ✎ text answer`
- :178 choiceWithNote (submitted, elaboration) → ` ★ answered · ✎ text answer`
- :186 answered write-in → ` ★ answered · ✎ text answer`
- :194 submitted write-in → ` ★ answered · ✎ text answer`
- :202 corrupt-truthy custom (answered, custom:"yes") → ` ★ answered` (✎ absent)
- :210 `plain_option_answer_still_no_marker` (answered plain option) →
  ` ★ answered` AND the test NAME's premise is deleted by FR-D10 → RENAME
- Unchanged: :149 open → "", :153 reasked/withdrawn, :156/:162 moot cases.
- :244 "markers render per status" loop builds expectations dynamically from
  statusMarkers() — self-consistent, unaffected.
- ~:237 BUG-005 composed-line test asserts `toContain("✎ text answer")` —
  still passes (substring); strengthen to also assert "★ answered".
- Grep-verified: NO other suite pins statusMarkers output or " ✎ text answer"
  (panel.test.ts:583 is an overview ≡-suffix comment; short-view.test.ts:301
  is the answer.value preview, not the marker).

## Conventions
- vitest, colocated; `mkQuestion(id, overrides)` helper at :44 (defaults:
  type "choice", status "open", rev 1); identity `theme` stub (fg/bold
  pass-through) → tests assert full strings INCLUDING the leading space.
- Mode A JSDoc discipline: statusMarkers' doc block (~:296-312) must list ★
  and state the parity rule.
- Gates: `npm run typecheck`, `npm test` (package.json confirmed).

# PRP — P1.M2.T6.S2: Overview `✎` marker = write-in (`answer.custom`) or text answer

---
name: "P1.M2.T6.S2 — FR-11 overview marker redefinition"
description: "Redefine the overview `✎` marker in src/panel/overview.ts (overviewMarker, ~:121): `✎` now means WRITE-IN or TEXT ANSWER — appended when `q.answer?.custom === true` OR (`q.type === \"text\"` and the row is answer-carrying). Plain elaboration (`answer.text` on an option answer) NO LONGER earns `✎`; it instead gets a NEW dimmed trailing suffix ` ≡` (elaboration cue relocated so the information is not lost — FR-11's marker list names no elaboration glyph, so this PRP fixes one). Update the Mode A JSDoc (module glyph vocabulary + overviewMarker doc) to the new semantics. Mock nothing."
---

## Goal

**Feature Goal**: FR-11 / h2.42 parity in the overview: the `✎` status marker flags write-ins — `answer.custom === true` — and free-text answers on `type:"text"` questions. An option answer with elaboration text alone no longer earns `✎`; its cue relocates to a new dimmed ` ≡` suffix so the elaboration fact stays visible. Suppression rules on ⊘/⊗ rows are unchanged.

**Deliverable**: Modified `src/panel/overview.ts` — `overviewMarker()` logic + JSDoc (module glyph-vocabulary block and the function's doc comment) — and updated assertions in `src/panel/overview.test.ts`. No new files. No mocks. No changes to layout.ts `hasTextAnswer` or any other surface (those were settled in P1.M1.T2.*; overview is the last ✎ surface to redefine).

**Success Definition**: `npm run typecheck` + full `npx vitest run` green; overview.test.ts asserts: custom answer → `★ ✎` (and `⟳ ✎` on re-asked); text-question answer → `★ ✎`; option answer with `answer.text` only → `★ ≡` (dimmed in the rendered row, plain in the marker string); suppression on `⊘`/`⊗` rows applies to BOTH suffixes; open question stays `·`.

## User Persona

**Target User**: The TUI answerer scanning the overview (ctrl+l) to see which questions are done and which answers were hand-written.

**Use Case**: User jumps to overview, reads markers per row, spots `✎` and knows at a glance: "that one I wrote myself" (write-in or free-text), vs `≡`: "that one has my explanation attached".

**Pain Points Addressed**: Today `✎` fires on ANY non-empty `answer.text`, so a plain elaboration looks identical to a hand-written answer — the overview lies about what shipped as the answer. After this item the glyph matches the answer shape (h2.42: `custom: true` = write-in).

## Why

- PRD h2.8/FR-11: overview list shows status markers `open/answered★/re-asked⟳/moot⊘/withdrawn⊗/write-in or text answer ✎` — `✎` is defined as write-in/text, NOT elaboration. The current implementation (elaboration = ✎) predates WRITEIN-001 and contradicts FR-11.
- PRD h2.42 (Answer shape): `custom: true` marks a write-in; "Renderers, diff cards, and the completion record display write-ins as `✎ {text}`." P1.M1.T2.S1/S2 already did the diff/completion/renderers surfaces; the overview marker is the remaining surface (M8 bullet: "`overview.ts`: … `✎` marker = write-in/text answer").
- Item contract: "plain elaboration (answer.text on an option answer) no longer earns ✎ (choose a dimmed suffix … do not lose the elaboration cue entirely … relocate it per spec h2.8/FR-11 marker list)". FR-11 names no elaboration glyph, so this PRP FIXES one: the dimmed ` ≡` suffix (rationale below).

## What

### Behavior contract (exact)

All changes are in `overviewMarker(q: Question): string` and its docs, plus row rendering for the dimming.

1. **New `✎` rule (replaces the old append)**: after base-marker precedence (unchanged: `⊗ > ⊘ > ⟳ > ★ > ·`), append `" ✎"` when the row is answer-carrying and is a write-in or text answer:
   ```ts
   const isWriteIn = q.answer?.custom === true;
   const isTextAnswer = q.type === "text" && q.answer !== undefined;
   const elaborated =
     (q.answer?.text ?? "") !== "" && !isWriteIn && !isTextAnswer;
   if ((isWriteIn || isTextAnswer) && m !== "⊗" && m !== "⊘") m += " ✎";
   else if (elaborated && m !== "⊗" && m !== "⊘") m += " ≡";
   ```
   - `custom === true` is a STRICT check (state.ts :551 already normalizes to strict boolean; corrupt truthy values must not leak).
   - `type:"text"` questions: any answer (answered/submitted/closed) is a text answer → `★ ✎`. (Parity with layout.ts `hasTextAnswer`, which uses `q.type === "text"` OR non-empty text — but the ✎ glyph per FR-11 is write-in/text only, hence the split here.)
   - A write-in ALSO carrying `answer.text` still shows just `✎` (write-in wins; one suffix).
2. **Elaboration relocation**: pure elaboration (option answer with non-empty `answer.text`, `custom` not true, not `type:"text"`) appends `" ≡"` instead. Chosen glyph: `≡` (U+2261, "identical/has note") — 1 visible col, not in the panel glyph vocabulary (no collision with ·★⟳⊘⊗✎▲▸), ASCII-keyboard-safe to type in tests, and semantically "attached note". In the RENDERED row (`questionRow`), the `≡` suffix must render DIMMED — it is a secondary cue, visually subordinate to the full-intensity `✎`. Implementation: `overviewMarker` returns the plain string (callers/tests see `★ ≡`); `questionRow` composes the row so the elaboration case gets the `≡` segment wrapped in `theme.fg("dim", " ≡")` when NOT already dimmed (moot/withdrawn rows drop the suffix entirely anyway, same as today's ✎). Keep the prefix/marker/headW math correct: compute `headW` from the base marker + suffix widths — simplest is to keep `overviewMarker` as the single string and split only for styling if needed; alternatively style the whole row's suffix via a small helper `markerParts(q)` returning `{base, suffix, suffixKind: "writein" | "elaboration" | "none"}` used by both `overviewMarker` and `questionRow` — PREFERRED: add unexported `markerParts` helper, `overviewMarker` composes from it, `questionRow` styles the suffix dim for `elaboration`. Do not change the exported signature of `overviewMarker`.
3. **Suppression unchanged**: `⊘`/`⊗` rows suppress BOTH suffixes (a moot/withdrawn row never shows `✎` or `≡`).
4. **JSDoc [Mode A]**: update BOTH doc sites in overview.ts:
   - Module glyph-vocabulary block: change the `✎` bullet to "`✎` write-in or text answer — appended whenever `q.answer?.custom === true` or the question is `type:"text"` with an answer; composes with ⟳ and ★ only", and ADD a bullet: "`≡` elaboration (dimmed suffix) — appended when an option answer carries non-empty `answer.text` and is not a write-in/text answer (P1.M2.T6.S2: the ✎ elaboration cue relocated; FR-11 has no elaboration glyph, this is the panel-wide choice)".
   - `overviewMarker` doc comment: mirror the same semantics; note the strict `custom === true` check and that a write-in-with-text shows only `✎`.
5. **No other surface changes**: layout.ts `statusMarkers` (`✎ text answer`), short-view, deep-view, renderers, completion — all landed in prior items; do NOT touch them. `overviewMootReason`, cursor/scroll/jump logic: untouched.
6. **Mock nothing**: tests use the existing `choiceQ`/`textQ`/`answer` fixtures in overview.test.ts. Check the fixture helper's `answer()` shape — if it doesn't already accept a `custom` field (QuestionAnswer carries `custom?: boolean` per P1.M1.T1.S1, src/state.ts :48), extend the fixture locally to pass it.

### Success Criteria

- [ ] Option answer, no text → `★` (unchanged).
- [ ] Write-in (`custom: true`, with or without `answer.text`) → `★ ✎`; re-asked write-in → `⟳ ✎`.
- [ ] `type:"text"` question, answered → `★ ✎`.
- [ ] Option answer with elaboration text only (`custom` absent/false) → `★ ≡` (and rendered row shows the `≡` dimmed; `⟳ ≡` composes the same way).
- [ ] Moot (`⊘`) and withdrawn (`⊗`) rows: neither suffix appears (unchanged rule, both glyphs).
- [ ] Open question → `·` (unchanged).
- [ ] Module + function JSDoc state the new ✎/≡ semantics; no stale "has-text answer" ✎ claim remains in overview.ts (`grep -n "has-text" src/panel/overview.ts` empty).
- [ ] Existing overview suites (scroll, jump, buildOverviewContent) stay green except deliberately updated ✎ assertions.

## All Needed Context

### Context Completeness Check

The single edit site (`overviewMarker` + `questionRow` styling + two JSDoc blocks) is quoted with anchors; the new logic is given verbatim; test fixtures and the exact assertions to flip are enumerated. No prior codebase knowledge required beyond this PRP.

### Documentation & References

```yaml
- file: src/panel/overview.ts
  why: the entire item — overviewMarker (~:121, the ✎ append line), questionRow (~:300, suffix dimming), module glyph-vocabulary JSDoc (top), overviewMarker JSDoc
  pattern: current append is `if ((q.answer?.text ?? "") !== "" && m !== "⊗" && m !== "⊘") m += " ✎";` — replace with the contract §1 logic
  gotcha: suppression checks must test the BASE glyph (m before suffix) exactly as today; keep "·" composable (an open question with a stale draft shows nothing — drafts live on the panel, not on q)

- file: src/state.ts
  why: Question/QuestionAnswer shape — `custom?: boolean` on answers (:48); commit path normalizes to strict true (:551)
  pattern: read `q.answer?.custom === true` — strict equality, never truthiness
  gotcha: upsertQuestion normalizes status to "open"; answered fixtures need upsert+applyAnswer or direct fixture-field injection (tests construct Question objects directly — fine)

- file: src/panel/layout.ts
  why: read-only — hasTextAnswer (:181) shows the OTHER surfaces' rule (type==="text" OR non-empty text); this item deliberately DIVERGES for the ✎ glyph per FR-11 (✎ = write-in/text only) while layout.ts statusMarkers stays as landed in P1.M1.T2
  gotcha: do NOT "unify" overviewMarker with hasTextAnswer — the glyph vocabulary differs by contract

- file: src/panel/overview.test.ts
  why: the suite to update — describe("overviewMarker — glyph semantics + precedence") (:127); current ✎ assertions at :149-153, :158-159, :286 must flip; answer()/choiceQ()/textQ() fixtures at top
  pattern: copy the existing `answer(value, text)` fixture calls; add a third param or object form for `custom` (e.g. `answer("sqlite", "why", true)`)
  gotcha: :153 asserts an EMPTY-value answer with text renders `★ ✎` — under the new rule that row (no custom, choice type, text only) becomes `★ ≡`; flip it deliberately

- file: plan/002_949db554a811/architecture/panel-ui-seams.md
  why: §5 documents the OLD contract — "✎ is an APPEND-only suffix meaning 'non-empty q.answer.text'"; this item supersedes it (research note only — do not edit the architecture doc)

- prd: h2.8/FR-11 (marker list: write-in or text answer ✎), h2.42 (answer shape, custom marker, ✎ {text} display), h2.51 M8 (overview.ts ✎ = write-in/text)
  why: the normative definition this implementation must match
```

### Current Codebase tree (relevant slice)

```bash
src/panel/
  overview.ts         # MODIFY — overviewMarker logic, questionRow suffix dimming, 2× JSDoc
  overview.test.ts    # MODIFY — flip ✎ assertions, add custom/text/≡ cases
  layout.ts           # read-only (hasTextAnswer — deliberately divergent)
  short-view.ts       # read-only (OTHER_AFFORDANCE; S1 exports it)
src/state.ts          # read-only (custom field, strict-true commit normalization)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: `custom === true` STRICT — state normalization already strips
// corrupt truthy values; never write `if (q.answer?.custom)`.
// CRITICAL: glyph widths — never assume `✎`/`≡` are 1 col in MATH;
// questionRow already routes widths through visibleWidth(). The `≡` suffix
// adds 2 visible cols (" ≡") to headW — keep the headW computation fed by
// the FULL marker string (it already is; just don't hand-count).
// GOTCHA: moot-row reason path and the plain path both build rows — add the
// dimmed-suffix styling to the PLAIN path only (moot/withdrawn suppress the
// suffix entirely, and their row is already wholesale-dimmed).
// GOTCHA: write-in with elaboration text (custom:true + answer.text) shows
// ONLY ✎ — one suffix, write-in wins; assert this case explicitly.
// GOTCHA: overviewMarker is EXPORTED and asserted by exact string — keep its
// signature and plain-string return; new helper markerParts stays unexported.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/panel/overview.ts — marker logic
  - ADD unexported helper `markerParts(q: Question): { base: string; suffix: "" | " ✎" | " ≡"; kind: "none" | "writein" | "elaboration" }`
    implementing contract §1 (base precedence unchanged; isWriteIn/isTextAnswer/elaborated per the quoted logic; suppression on ⊘/⊗)
  - REWRITE overviewMarker to compose `base + suffix` from markerParts (exported signature unchanged)
  - JSDoc: update overviewMarker doc comment + module glyph-vocabulary block per contract §4

Task 2: MODIFY src/panel/overview.ts — questionRow suffix dimming
  - In the NON-moot branch of questionRow: when kind === "elaboration", wrap the
    " ≡" segment in theme.fg("dim", " ≡") (row NOT already dimmed there);
    writein suffix renders full-intensity like today's ✎
  - Keep headW/budget math correct (feed it the full marker string)

Task 3: MODIFY src/panel/overview.test.ts
  - EXTEND the answer() fixture to carry `custom?: boolean`
  - FLIP: :149-150 (`★ ✎` elaboration rows → `★ ≡`; add a custom:true twin that stays `★ ✎`),
    :153 (empty value + text → `★ ≡`), :286 rendered-line `★ ✎` → assert per new fixture
  - ADD: custom:true → `★ ✎` (+ reasked `⟳ ✎`); custom:true with text → `★ ✎` only;
    type:"text" answered → `★ ✎`; ⊘/⊗ suppress `≡` too (extend :158-159);
    elaboration row's rendered line contains theme-dim-wrapped " ≡"
  - ADD: write-in row via buildOverviewContent renders `★ ✎` in the actual line (AC-2a parity at overview level)

Task 4: VALIDATE
  - npm run typecheck; npx vitest run src/panel/overview.test.ts -v; full suite
```

### Implementation Patterns & Key Details

```ts
// The marker core (contract §1, verbatim):
function markerParts(q: Question): { base: string; suffix: "" | " ✎" | " ≡"; kind: "none" | "writein" | "elaboration" } {
  let base = "·";
  if (q.answer !== undefined && q.status !== "moot" && q.status !== "withdrawn") base = "★";
  if (q.status === "reasked") base = "⟳";
  if (q.status === "moot") base = "⊘";
  if (q.status === "withdrawn") base = "⊗";
  if (base === "⊗" || base === "⊘") return { base, suffix: "", kind: "none" };
  const isWriteIn = q.answer?.custom === true; // STRICT (state.ts :551 parity)
  const isTextAnswer = q.type === "text" && q.answer !== undefined;
  if (isWriteIn || isTextAnswer) return { base, suffix: " ✎", kind: "writein" };
  if ((q.answer?.text ?? "") !== "") return { base, suffix: " ≡", kind: "elaboration" };
  return { base, suffix: "", kind: "none" };
}

export function overviewMarker(q: Question): string {
  const { base, suffix } = markerParts(q);
  return base + suffix;
}

// questionRow, plain branch:
const { base, suffix, kind } = markerParts(q);
const marker = base + suffix; // headW math unchanged (uses marker)
// compose body with prefix + marker; when kind === "elaboration", instead
// compose `${prefix}${base}` + theme.fg("dim", suffix) + ` ${title}` — i.e.
// dim only the ≡ segment (ensure headW still counts the FULL suffix width
// so truncation math matches the rendered string).
```

### Integration Points

```yaml
NONE:
  - no state/schema change (custom landed P1.M1.T1.S1)
  - no config change; no new exports required (markerParts stays private)
  - AC-2a scripted assertions (ac-panel.test.ts) that render overview consume
    the new marker automatically — verify they don't pin the OLD ✎ semantics
    (grep ac-panel.test.ts / ac-scripted.test.ts for "✎" before finishing)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck        # zero errors
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/overview.test.ts -v   # updated + new assertions
npx vitest run src/panel/ -v                    # panel-wide (S1's deep-view tests land in parallel — rebase if both touch panel suites)
npx vitest run                                   # full suite green
grep -rn "✎" src/panel/ac-panel.test.ts src/ac-scripted.test.ts   # audit for stale ✎ pins
```

### Level 3: Documentation gate

```bash
grep -n "has-text" src/panel/overview.ts        # must be empty (stale ✎ semantics doc removed)
grep -n "≡" src/panel/overview.ts               # new elaboration bullet + helper present
```

## Final Validation Checklist

- [ ] `npm run typecheck` clean; full `npx vitest run` green.
- [ ] `✎` fires ONLY on `custom === true` or `type:"text"` answers; composes with ★/⟳.
- [ ] Elaboration-only answers show dimmed ` ≡` in rendered rows (plain `★ ≡` from overviewMarker).
- [ ] Write-in with elaboration text shows a single `✎`.
- [ ] ⊘/⊗ suppress both suffixes; open stays `·`.
- [ ] Mode A JSDoc updated in both doc sites; no stale claims.
- [ ] No other surface touched (layout.ts, renderers, completion unchanged).

## Anti-Patterns to Avoid

- ❌ Don't reuse `hasTextAnswer` from layout.ts — the glyph contracts deliberately differ (FR-11).
- ❌ Don't test `custom` with truthiness (`if (q.answer?.custom)`).
- ❌ Don't export `markerParts` or change `overviewMarker`'s signature — tests and other callers pin it.
- ❌ Don't add the dimmed `≡` styling to the moot/withdrawn branch (suffix is suppressed there entirely).
- ❌ Don't migrate S1's deep-view Other-section work — overview only.

---

**Confidence Score**: 9/10 — single-function change with the exact logic quoted, the FR-11 normative marker list in hand, the test file's flip-points enumerated by line, and the only free choice (the `≡` elaboration glyph + dimming) fixed explicitly in the contract.

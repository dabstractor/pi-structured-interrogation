# PRP — P1.M2.T5.S1: reconcileDraftsForSubmit role binding + held-elaboration zero-pending flash

---
name: "P1.M2.T5.S1 — FR-D2 / WRITEIN-002 draft role binding at submit"
description: "Rework reconcileDraftsForSubmit (src/panel/actions.ts:381) to evaluate each draft slot's ROLE from the CURRENT selection at commit/submit (h2.32 'Draft role follows the selection', h2.48): (1) type:\"text\" open/reasked → applyAnswer({value: text, custom: true, at}) — the draft IS the answer, now with the custom marker (h2.42); (2) answered choice whose answer came from a REAL option (answer.custom !== true) → draft is elaboration shipping as answer.text ({...answer, text} — unchanged behavior); (3) answered choice with answer.custom === true (write-in committed at enter, P1.M2.T2.S1) → the draft already IS the answer value — attach NOTHING as text; (4) open/reasked choice → held elaboration, ships nothing (unchanged). Rebind: accepting a real option after a committed write-in keeps the slot text (R4, DraftStore untouched by accept) and step (2) naturally re-binds it as elaboration. Replace the EXPLAIN-003 zero-pending flash at actions.ts:463–466 with the WRITEIN-002 verbatim string `nothing to submit — {n} question(s) have drafts awaiting an option or Other` (n = post-reconcile questions with a non-empty draft but no answer — i.e. open/reasked choice questions with drafts; text drafts reconcile into answers and never count); plain `nothing to submit` otherwise. Rewrite the JSDoc on reconcileDraftsForSubmit citing WRITEIN-002; add a state.ts draft-slots note. Update actions.test.ts:675 flash assertion + add scripted AC-2b submit-time tests."
---

## Goal

**Feature Goal**: FR-D2 (h2.32/h2.48, WRITEIN-002): one draft slot per question; its ROLE is bound at commit/submit time by the current selection. Real option → elaboration (`answer.text`). Other / `type:"text"` → the draft IS the answer (`answer.value`, `custom: true`). Superseding a write-in with an option accept KEEPS the slot (R4) and re-binds it as elaboration. A draft with no answer stays held — ships nothing — and the zero-pending `ctrl+s` flash names it verbatim.

**Deliverable**: Modified `src/panel/actions.ts` (reconcileDraftsForSubmit role binding + new flash string + JSDoc), `src/panel/actions.test.ts` (flash assertion update + new submit-time binding tests), `src/state.ts` (draft-slots JSDoc note only). No new files. No mocks introduced ("Mock nothing" — tests use the real state/draft seams like the rest of actions.test.ts).

**Success Definition**: `npm run typecheck` + `npm test` green; scripted AC-2b submit-time assertions pass: elaboration attaches as `answer.text` to a real-option answer; write-in ships as `answer.value` with `custom: true`; a custom-answered question's slot is NOT duplicated into `answer.text`; a superseded write-in (option accept after write-in commit) re-binds as elaboration at submit; held drafts on unanswered questions ship nothing and produce the exact flash `nothing to submit — {n} question(s) have drafts awaiting an option or Other`.

## User Persona

**Target User**: The TUI answerer who types before/instead of selecting options.

**Use Case**: User writes free text on a choice question but never selects (or selects Other and commits); at `ctrl+s` the text ships in the role the current selection dictates — never silently dropped or duplicated.

**Pain Points Addressed**: Ambiguity of "what does the box mean" resolved at flush time (WRITEIN-002's rejection of submit-time disambiguation prompts); the old EXPLAIN-003 flash wording ("explained question still needs an option choice") predates the Other row and no longer tells the whole story.

## Why

- PRD h2.32 "Draft role follows the selection (WRITEIN-002)" and h2.48 "Drafts lifecycle" — the binding rules quoted above; h2.39 zero-pending flash wording; h2.42 answer shape.
- Upstream (treat as landed / landing in parallel, landed code wins): P1.M2.T2.S1's `writeInEnter` (actions.ts:280–311) commits `applyAnswer({value: text, custom: true})` at enter with advance; P1.M2.T3.S1's elaboration duty (`ctrl+t`, enter = save + blur, never answers); P1.M2.T4.S1 deletes the arming machinery and collapses `commitTextDraft(questionId, text)` to two params (`{arm}` gone) — **if T4 has landed, `writeInEnter`'s `commitTextDraft(q.id, text, { arm: false })` call at actions.ts:289 also loses its third argument** (T4 owns that edit; re-read the file before editing).
- Downstream: P2.M1.T1.S1 (`maybeAutoSubmit` reuses `submit()` verbatim) consumes this role-bound flush — it must not need any special casing. AC-2b asserts the elaboration re-bind path.

## What

### Behavior contract (exact)

1. **reconcileDraftsForSubmit role binding** (actions.ts:381–398, called from `submit` at :425 BEFORE baseline/diff):
   For each ordered question with a non-empty `panel.draftTextFor(q.id)`:
   - `q.type === "text"` AND status open/reasked → `panel.state.applyAnswer(q.id, { value: text, custom: true, at: new Date().toISOString() })`. (NEW: `custom: true` per h2.42/FR-D2 — the draft IS the answer. Rationale for re-asked inclusion is unchanged and stays in the JSDoc.)
   - `q.type === "text"` answered/submitted → skip (the answer was already committed at enter; a later-held draft edit on an ANSWERED text question routes through the FR-18 confirm modal and commits at enter, so there is no held case to flush — do not attach anything here).
   - Choice, status `"answered"`, `q.answer !== undefined`, **and `q.answer.custom !== true`** → `panel.state.applyAnswer(q.id, { ...q.answer, text })` (unchanged elaboration bind — the answer came from a real option; the CURRENT answer object is spread so a write-in later superseded by an option accept re-binds correctly: the option accept already replaced the answer with the option's value and cleared `custom`, so this branch fires and the KEPT slot text attaches as elaboration — R4 satisfied, zero extra code).
   - Choice, answered, `q.answer.custom === true` → **skip** (the write-in already shipped its value at commit via `writeInEnter`; attaching the slot text again as `answer.text` would duplicate the write-in into the elaboration field).
   - Choice, open/reasked → held elaboration, ships nothing (current behavior, unchanged; BUG-008 re-ask rule unchanged).
   - Empty/whitespace drafts skipped (unchanged).
2. **Zero-pending flash** (actions.ts:448–467, inside the `diff.changed.length === 0 || userChanged.length === 0` early return): replace the EXPLAIN-003 compound string with the WRITEIN-002 verbatim template, no pluralization games — the literal text is `nothing to submit — {n} question(s) have drafts awaiting an option or Other`. Compute n AFTER reconcileDraftsForSubmit has run (it has — same function scope, reconcile is the first statement of submit): count orderedQuestions where status is open/reasked, `q.type !== "text"`, and `(panel.draftTextFor(q.id)?.trim() ?? "") !== ""`. That set is exactly "questions with drafts but no answer": text drafts reconcile into answers (so they never appear), answered choice drafts either attach (submitting) or are custom-answered (not counted — they HAVE an answer). n > 0 → the named flash; n === 0 → plain `nothing to submit`. Update the surrounding comment (the EXPLAIN-003 narrative) to WRITEIN-002 held-elaboration wording.
3. **JSDoc [Mode A]** on reconcileDraftsForSubmit: rewrite the two duty bullets to the WRITEIN-002 binding rules — real option → `answer.text`; Other / `type:"text"` → `answer.value` + `custom: true`; superseded write-ins re-bind as elaboration at the next submit; held drafts ship nothing. Cite WRITEIN-002 (h2.32/h2.48) explicitly; keep the BUG-008 re-ask bullet and the empty-draft rule.
4. **state.ts note**: one short comment addition where answers/draft-slots are documented (near the `custom?: boolean` field at state.ts:48 or the answer-preservation block ~:551) stating: draft ROLE is not stored — slots are role-less `{value, text}`; binding is evaluated at commit/submit time in `reconcileDraftsForSubmit` from the current selection (WRITEIN-002). Comment only; no code change to state.ts.
5. **No mocks**: tests construct real InterrogationPanel/state/draft seams like existing actions.test.ts fixtures. Nothing about DraftStore changes; `shipDrafts(pendingIds...)` at actions.ts:513 is untouched (slot destruction at submit is already correct — a custom answer's slot is destroyed on submit along with everything shipped, per h2.48 "cleared on submit").

### Success Criteria

- [ ] Choice question, draft typed, real option accepted, `ctrl+s` → submission answer has `{value: optionValue, text: draft}` and no `custom`.
- [ ] Choice question, Other accepted, write-in committed at enter, `ctrl+s` → answer `{value: writeInText, custom: true}` and `answer.text` is NOT the draft again (no duplication).
- [ ] Write-in committed, then user re-accepts a REAL option (supersede), `ctrl+s` → answer `{value: optionValue, text: <kept write-in text>}`, `custom` absent — the slot survived (R4) and re-bound.
- [ ] `type:"text"` open question with draft, `ctrl+s` → answer `{value: draft, custom: true}` (NEW custom marker).
- [ ] Draft on an unanswered choice question, `ctrl+s` → nothing ships for it AND flash is exactly `nothing to submit — 1 question(s) have drafts awaiting an option or Other` (n=1; the "(s)" is literal in the template — no pluralization logic).
- [ ] No drafts, no pending → flash exactly `nothing to submit` (existing tests at actions.test.ts:553/570/931/1234 must stay green).

## All Needed Context

### Context Completeness Check

Every edit site is enumerated with current-tree anchors, the exact role-binding truth table, the verbatim flash string, and the fixture patterns for new tests. An implementer needs nothing beyond this PRP + the repo.

### Documentation & References

```yaml
- file: src/panel/actions.ts
  why: reconcileDraftsForSubmit (:381–398) — the function being re-bound; submit (:420–526) — the zero-pending early-return (:448–467) whose flash string changes; writeInEnter (:280–311) — the landed custom-commit path (read-only)
  pattern: keep reconcile as the FIRST statement of submit; keep the pendingIds/userChanged BUG-008 logic byte-identical
  gotcha: draftTextFor (panel.ts:1068) returns `string | undefined` ("" from an empty slot is possible via the drafts seam fallback at :1036) — the `?.trim() ?? ""` guard is load-bearing; do not "simplify" it away

- file: src/panel/panel.ts
  why: draftSlots Map (:394) + draftTextFor (:1068–1070) — the slot read seam; commitTextDraft (:869 area) — slot write-through
  pattern: read-only for this item; T4 (parallel) is editing the commit path's signature
  gotcha: T4 deletes `{arm}` from commitTextDraft/writeInEnter's call — if T4 has landed, do not "restore" a third argument

- file: src/state.ts
  why: QuestionAnswer shape (custom?: boolean at :48), applyAnswer (:356), custom preservation (:551) — applyAnswer already accepts and preserves custom; NO code change needed, only the draft-slots role-less note
  pattern: add the note near the custom field or the answer-copy block; keep it to 2–4 lines citing WRITEIN-002

- file: src/panel/actions.test.ts
  why: existing flash assertions (:553, :570, :675, :931, :1081–1097, :1234) and the submit/draft test fixtures to copy for the new tests
  pattern: follow the existing seed/panel-construction helpers in this file; new tests assert against panel.state serialize()/orderedQuestions() answer objects — real seams, no mocks
  gotcha: :675 asserts the OLD EXPLAIN-003 string — must be updated to the new verbatim string; :1081–1097 are flash-rendering tests using panel.flash directly (string-agnostic) — leave unless they hardcode the old named variant (they use the plain one)

- file: src/draft-store.ts
  why: DraftStore contract — hasDraft/shipDrafts semantics; confirms slots are role-less {value, text} and that nothing in the store needs a role field
  pattern: read-only; DO NOT add a role/type to DraftEntry — the whole point of WRITEIN-002 is binding-from-selection, not stored roles

- file: plan/002_949db554a811/architecture/panel-ui-seams.md
  why: § around :65–77 documents the current reconcile flow (text → applyAnswer; choice → {...answer, text}) and the submit ordering reconcile → baseline → computeDiff
  pattern: keep that ordering; only the binding rules and flash change

- files: plan/002_949db554a811/P1M2T2S1/PRP.md, P1M2T3S1/PRP.md, P1M2T4S1/PRP.md
  why: the parallel-item contracts — writeInEnter (custom commit + advance), elaboration duty (save+blur never answers), arming removal (commitTextDraft signature)
  gotcha: landed code wins; re-read actions.ts immediately before editing

- doc: PRD h2.32 (WRITEIN-002 bullet), h2.48, h2.39 (flash), h2.42 (answer shape) — quoted in this PRP's PRD context; the binding sentence is the spec
```

### Current Codebase tree (relevant slice)

```bash
src/panel/actions.ts        # reconcileDraftsForSubmit + submit flash — EDIT
src/panel/actions.test.ts   # flash assertion + new binding tests — EDIT
src/state.ts                # draft-slots role-less note (comment only) — EDIT
src/panel/panel.ts          # draftTextFor seam — read-only (T4 may edit neighbors)
src/draft-store.ts          # read-only
```

### Desired Codebase tree

```bash
# same files; zero new files
src/panel/actions.ts        # WRITEIN-002 role binding + new flash + JSDoc
src/panel/actions.test.ts   # updated flash assertion + AC-2b submit-time tests
src/state.ts                # one JSDoc/comment note
```

### Known Gotchas of our codebase

```ts
// CRITICAL: do NOT attach elaboration to a custom answer. The current
// `{ ...q.answer, text }` branch fires for ANY answered choice — under
// write-ins that DUPLICATES the committed write-in into answer.text.
// Guard with `q.answer.custom !== true`.

// CRITICAL: the flash string is VERBATIM per h2.39: no pluralization.
// `nothing to submit — ${n} question(s) have drafts awaiting an option or Other`

// CRITICAL: reconcile must stay the first statement of submit() — the flash
// count is only "questions with drafts but NO answer" AFTER text drafts have
// been applied. Count AFTER reconcile (same tick, same function scope).

// CRITICAL: compute n with q.type !== "text" — a text draft reconciles into
// an answer and can never be "awaiting an option or Other".

// P1.M2.T4.S1 is landing in parallel and collapses commitTextDraft's
// {arm} opts. If typecheck flags writeInEnter's third argument, T4 owns
// that fix — don't fork the signature; re-read and follow landed code.

// applyAnswer never touches rev (state.ts:200) and is the sanctioned raw
// primitive for the text branch — same as today, now with custom: true.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 0: RE-READ landed state
  - read src/panel/actions.ts :280–400 and :420–530 in the CURRENT tree
    (T2/T3 landed; T4 parallel) — re-anchor before editing
  - grep -n "commitTextDraft(" src/ to confirm current signature

Task 1: MODIFY src/panel/actions.ts — reconcileDraftsForSubmit
  - text branch: applyAnswer({ value: text, custom: true, at })
  - choice-answered branch: add `q.answer.custom !== true` guard
  - rewrite JSDoc: WRITEIN-002 role-binding rules (real option → answer.text;
    Other/text → answer.value + custom:true; superseded write-in re-binds;
    held drafts ship nothing), keep BUG-008 + empty-draft bullets

Task 2: MODIFY src/panel/actions.ts — zero-pending flash
  - replace :463–466 string assembly with the verbatim template; keep the
    n>0 / plain-string fork and the early-return semantics (note stays held)
  - update the EXPLAIN-003 comment to WRITEIN-002 held-elaboration wording

Task 3: MODIFY src/state.ts — draft-slots note
  - one 2–4 line comment near custom? (:48) or the answer-copy block (:551):
    slots are role-less; role binds at commit/submit in reconcileDraftsForSubmit (WRITEIN-002)

Task 4: MODIFY src/panel/actions.test.ts
  - UPDATE :675 to the new verbatim string (adjust fixture if it seeds 2+ drafts → n accordingly)
  - ADD (real seams, no mocks — follow existing submit-test fixtures):
    test_submit_elaboration_attaches_to_real_option_answer
    test_submit_writein_ships_value_custom_no_text_duplication
    test_submit_superseded_writein_rebinds_as_elaboration   # AC-2b tail
    test_submit_text_draft_ships_with_custom_marker
    test_zero_pending_flash_names_held_drafts_verbatim      # exact string, n=1 and n=2
    test_zero_pending_plain_when_no_drafts                  # if not already covered

Task 5: VALIDATE
  - npm run typecheck && npm test; grep -n "explained question still needs" src/ → empty
```

### Implementation Patterns & Key Details

```ts
// reconcileDraftsForSubmit AFTER (shape):
for (const q of panel.state.orderedQuestions()) {
  const text = panel.draftTextFor(q.id);
  if (text === undefined || text.trim() === "") continue;
  if (q.type === "text") {
    if (q.status === "open" || q.status === "reasked") {
      // WRITEIN-002: the draft IS the answer — now carrying the custom marker (h2.42).
      panel.state.applyAnswer(q.id, { value: text, custom: true, at: new Date().toISOString() });
    }
    continue;
  }
  if (
    q.status === "answered" &&
    q.answer !== undefined &&
    q.answer.custom !== true // a write-in's draft already IS answer.value — never also attach as text
  ) {
    panel.state.applyAnswer(q.id, { ...q.answer, text });
  }
}

// Flash AFTER (verbatim template — "(s)" is literal, no pluralization):
const heldDrafts = panel.state
  .orderedQuestions()
  .filter(
    (q) =>
      q.type !== "text" &&
      (q.status === "open" || q.status === "reasked") &&
      (panel.draftTextFor(q.id)?.trim() ?? "") !== "",
  ).length;
panel.flash(
  heldDrafts > 0
    ? `nothing to submit — ${heldDrafts} question(s) have drafts awaiting an option or Other`
    : "nothing to submit",
);
```

### Integration Points

```yaml
NO new config, schema, renderer, or persistence surface. Consumers:
  - P2.M1.T1.S1 (maybeAutoSubmit) calls submit() verbatim — role-bound flush
    must therefore be fully encapsulated inside submit(), which it is.
  - Renderers/diff (P1.M1.T2): already render custom answers as ✎ {text};
    the text-branch custom marker flows through existing snapshots paths.
  - shipDrafts(pendingIds…) (actions.ts:513): untouched — submit-time slot
    destruction already covers custom-shipped ids.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # zero errors
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/actions.test.ts -v
npm test
grep -rn "explained question still needs" src/   # expect empty
grep -n "awaiting an option or Other" src/panel/actions.ts   # expect the one flash site
```

### Level 3: Integration (live TUI manual — human runbook item)

```bash
pi -e .
# choice q: ctrl+t, type elaboration, enter, accept real option, ctrl+s
#   → card shows answer with the elaboration; ✎ renderers unaffected
# choice q: accept ✎ Other, type, enter (commits), ctrl+s
#   → ships value=text custom; no duplicate text
# supersede: after the write-in commit, navigate back, accept a real option, ctrl+s
#   → elaboration = the kept write-in text
# draft on unanswered choice q + ctrl+s → footer flash names it verbatim
# no drafts + ctrl+s → plain "nothing to submit"
```

### Level 4: Contract sweep

```bash
# AC-2b scripted tail: the supersede re-bind test IS the acceptance
# assertion (accepting a real option after a committed write-in keeps the
# slot's text as elaboration) — it lives in actions.test.ts (Task 4).
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean; `npm test` green (whole repo — submit is cross-referenced by ac-panel/lifecycle tests)
- [ ] Old EXPLAIN-003 flash string absent from src/; new string present exactly once in runtime code

### Feature Validation

- [ ] All six Success Criteria tests pass; existing plain "nothing to submit" assertions (:553/:570/:931/:1234) still green
- [ ] reconcile remains the first statement of submit; BUG-008 pendingIds/userChanged filter untouched
- [ ] No mocks added; DraftStore/DraftEntry unchanged (no role field)

### Code Quality Validation

- [ ] Only actions.ts, actions.test.ts, state.ts modified (comments in state.ts only)
- [ ] [Mode A] JSDoc cites WRITEIN-002 (h2.32/h2.48); state.ts note added
- [ ] Flash template verbatim, no pluralization branching

## Anti-Patterns to Avoid

- ❌ Attaching elaboration to a custom answer (duplication bug — the guard is the heart of this item)
- [ ] Pluralizing the flash string (spec template has literal "question(s)")
- [ ] Storing a role in DraftEntry or answer — binding is derived from selection at flush, never persisted
- [ ] Counting text-question drafts in the held count, or counting before reconcile runs
- [ ] Touching writeInEnter/commitTextDraft signatures while T4 lands in parallel — landed code wins
- [ ] Mocking state/drafts in the new tests — the file's whole pattern is real-seam scripted tests

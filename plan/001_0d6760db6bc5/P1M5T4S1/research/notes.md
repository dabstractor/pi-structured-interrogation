# Research — P1.M5.T4.S1: Invalidation confirm (enter=keep, esc=cancel)

## Existing seams (verified by reading source)

### `RippleConfirmFn` seam — src/panel/actions.ts:36-44
```ts
export type RippleConfirmFn = (
  panel: InterrogationPanel,
  questionId: string,
  proposed: { value: string; at: string },
) => boolean; // false = veto the edit (no applyAnswer, no advance)
```
- Invoked by `acceptOptionIndex` (actions.ts:226-236) BEFORE `applyAnswer`, only when
  `q.status === "answered" || "submitted"`. Used by accept, digit quick-select,
  and deep-view `acceptFromDeep` (deep-view.ts:429-448 — detects veto by
  `q.answer` reference identity, stays in deep view on veto).
- Panel default: `defaultRippleConfirm = () => true` (panel.ts:176), stored as
  `panel.rippleConfirm` (panel.ts:302, wired at 405 from `args.confirmRipple`).
  `panel.confirmRippleEdit(id, proposed)` (panel.ts:552) is the invocation point.
- **This task replaces the default with the real flow.**

### `computeRipple` — src/depends-on.ts:217-241
- `computeRipple(state, changedId): string[]` — transitive closure via reverse
  adjacency BFS, cycle-safe, EXCLUDES changedId, PURE (no mutation).
- Returns ALL rippled ids **unfiltered** — the panel must filter to
  `answered`/`submitted` for the `⚠ Invalidates {n} answered questions ({ids})` copy.
- Comment at depends-on.ts:27 explicitly names P1.M5.T4.S1 as the caller and says
  call it BEFORE applying the edit.

### `evaluateDependsOn` — src/depends-on.ts:160-184
- Mutates state via setStatus; emits one `changed` per actual flip
  (answered/submitted/reasked → moot; moot → open when re-met).
- Currently called ONLY from delivery.ts (snapshot lines) — the panel does NOT
  re-run it after `applyAnswer` today. FR-17 "instant" greying therefore needs
  this task to run it after the confirmed apply (and ideally after every panel
  applyAnswer — no other task in the tree owns that; AC-6 depends on it).

### Panel input pipeline — src/panel/panel.ts handleInput (~466-496)
Load-bearing order: `resolved` guard → (a) advanceArmed disarm → (b) armed
stage-2 enter (advance) → (c) stage-1 enter in text/note focus (`saveTextDraft`
/ `exitNoteMode`) → `this.keys(data, this)` router seam → embedded editor
forwarding → false.
- **Confirm mode must intercept FIRST** (right after the resolved guard): while
  `confirmMode` is active, enter applies, esc cancels, everything else is a
  consumed no-op (modal).

### Text stage-1 — panel.ts `saveTextDraft` (~508-517)
- Writes panel-local `draftSlots` + `drafts.setDraft`, blurs, arms advance.
- Does NOT applyAnswer (text answers reach state only via agent upsert today —
  two-stage.test.ts:179-180 asserts status stays `open`). So "same gate on
  stage-1 save" applies when an ANSWERED/SUBMITTED text question (answer came
  from an agent upsert or prior flow) is being edited: gate BEFORE the draft
  save; esc restores the editor to the recorded answer's text and keeps text focus.

### Footer rendering — src/panel/layout.ts `renderFooter` (:314)
- One line, width-bounded; panel `buildLines` pushes it at 4 call sites
  (panel.ts:765, 802, 825, 852) for note mode / short / deep / overview.
- Flash line (`renderFlashLine`) sits ABOVE the footer, auto-expires.
- Plan: when confirmMode active, replace the footer line with the confirm copy
  (add `renderConfirmFooter` to layout.ts, mirroring renderFlashLine's width
  truncation via `truncateVisible`), and suppress the flash line.
- `enter`/`esc` are FIXED keys (never config-remappable — keys.ts Mode A), so the
  footer copy needs no config surface → AC-12 unaffected.

### Cursor/selection state to restore on esc
- `panel.cursorIndex` (options cursor), `panel.currentId` setter re-seeds cursor
  to ★ preselect. Prior selection restore: cursorIndex → index of the option
  whose value === `q.answer.value`; fallback to the pre-edit cursorIndex snapshot.
- For text: `panel.textField.seed(text)`-style restore — check
  `focusTextField` (panel.ts:618+) for the seeding pattern (`draftSlots` freshest read).

### deep-view veto interplay (deep-view.ts:429-448)
`acceptFromDeep` returns true (consumed) when the seam vetoes; the user stays in
deep view. With a DEFERRED apply (seam returns false, apply happens later on
confirm-enter), deep view already returned — the confirm apply must perform
apply + evaluateDependsOn + advance itself (mirroring acceptOptionIndex tail) via
exported `nextUnanswered`. Acceptable: view stays deep; note in PRP.

## Test infrastructure
- vitest (`npx vitest run`), typecheck `npx tsc --noEmit`. No ruff/mypy (TS).
- Existing patterns: `src/panel/actions.test.ts`, `two-stage.test.ts` (fake
  editor + DraftStore spies, `seedOpen` helper, `createInterrogationState` +
  `upsertQuestion` raw seeding, `state.applyAnswer(...)` to pre-answer).
- Test naming: `test_snake_case_descriptive`.

## PRD anchors
- FR-18 / h2.33: footer copy `⚠ Invalidates {n} answered questions ({ids}) — enter=keep, esc=cancel`; esc reverts, enter applies, no drill-down v1.
- FR-17 / h3.2: unmet → moot with reason, kept in map, instant local evaluation.
- Q39=B (h2.57): user-specified UX — edit-time ripple confirm with forced accept/cancel.
- AC-7: edit an answered question invalidating 3 others → confirm; esc = no state
  change; enter applies.
- AC-6 (adjacent): answering contrary to dependsOn greys dependent instantly —
  satisfied by running evaluateDependsOn after every panel-side applyAnswer.

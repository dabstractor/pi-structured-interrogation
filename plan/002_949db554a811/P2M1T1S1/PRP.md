# PRP — P2.M1.T1.S1: Implement `maybeAutoSubmit(panel, deps)` and wire it after every panel commit path

---
name: "P2.M1.T1.S1 — AUTOSUBMIT-001 core hook"
description: "Add exported `maybeAutoSubmit(panel, deps?)` to src/panel/actions.ts: when zero questions have status open/reasked AND ≥1 has status answered (pending), call the EXISTING `submit(panel, deps)` EXACTLY once (no parallel pipeline) and flash verbatim `submitted — {n} answer(s)`. No-op (no flash, no submit) on zero pending. Wire it after all four panel commit tails: acceptOptionIndex (actions.ts), writeInEnter applied branch (actions.ts), applyWriteInConfirm (ripple-confirm.ts), applyConfirmedEdit (ripple-confirm.ts). Gate-hold withholding and the ⚠ line are P2.M1.T2.S1 — NOT this item. Mock delivery deps exactly as existing submit tests."
---

## Goal

**Feature Goal**: AUTOSUBMIT-001 (PRD h2.33, FR-3, AC-2c): every answer commit — option accept (incl. edits of answered questions), Other write-in commit, text enter — auto-submits through the exact `ctrl+s` pipeline whenever the question set is complete (zero `open`/`reasked`) and at least one answer is pending (`answered`). One submission per commit, deliberately.

**Deliverable**: One new exported function `maybeAutoSubmit(panel: InterrogationPanel, deps?: SubmitDeps): void` in `src/panel/actions.ts` (+ Mode A JSDoc), wiring calls at the four commit tails listed below, one JSDoc note in `src/state.ts` (epoch), and new tests in `src/panel/actions.test.ts` (+ ripple-confirm tests where the deferred-commit tails live).

**Success Definition**: `npm run typecheck` + full `npx vitest run` green. New tests prove: last-question accept → `submit` pipeline fires with no keypress beyond the answer, footer flash is exactly `submitted — {n} answer(s)`, `sendMessage` called once, epoch bumped by 1; edit of an answered question on a complete set fires again (one submission per commit); zero-pending commit no-ops (no flash, no sendMessage); write-in and modal-deferred commits trigger from their applied tails; cancel paths never trigger. No behavior change to `submit()` itself.

## User Persona

**Target User**: The TUI answerer working through an interrogation panel.

**Use Case**: User answers the last remaining question (accept / write-in / text enter) — the submission ships immediately; no `ctrl+s` needed.

**User Journey**: answer → answer → answer last question → submission delta reaches the model automatically → footer flashes `submitted — 3 answer(s)` → agent reply closes the set.

**Pain Points Addressed**: Zero required hotkeys at completeness; the "did I press ctrl+s?" ambiguity disappears.

## Why

- PRD h2.33 (AUTOSUBMIT-001) and FR-3 (h2.8): completeness ships itself through the EXACT ctrl+s pipeline (reconcile → baseline/diff → BUG-008 filter → gate check → markSubmitted → buildSubmission → deliverSubmission → noteSubmissionDelivered); footer flashes `submitted — {n} answer(s)`; held batch note rides (R3 — submit already carries it).
- PRD h2.41: epoch bumps on every submission INCLUDING every auto-submitted one (each firing is a full submission) — automatic since `bumpEpoch` lives inside `buildSubmission`.
- Core commitment 6 (h2.0): "Completeness auto-submits: every answer commit ships immediately while zero questions remain unanswered — no required hotkey."
- This hook is THE shared seam consumed by P2.M1.T2.S1 (gate hold wraps the call), P2.M1.T3.S1 (bridge tail in remote-submit.ts), P3.M2.T2.S1 (AC-9 pending-ship).

## What

### Behavior contract (exact)

1. **New function in `src/panel/actions.ts`** (place it directly after `submit()`, ~line 560, before the export list; add `maybeAutoSubmit` to that export list):

   ```ts
   export function maybeAutoSubmit(panel: InterrogationPanel, deps?: SubmitDeps): void {
     const d = deps ?? panel.delivery;
     if (d === undefined) return; // no delivery surface (e.g. headless tests) — no-op
     const ordered = panel.state.orderedQuestions();
     const unanswered = ordered.filter(
       (q) => q.status === "open" || q.status === "reasked",
     ).length; // same statuses nextUnanswered skips; moot/withdrawn/closed never count
     if (unanswered > 0) return;
     const pending = ordered.filter((q) => q.status === "answered").length;
     if (pending === 0) return; // no-op on zero pending — NO flash, NO submit call
     // One firing = one full submission (h2.41: epoch bumps per firing).
     const shipped = submit(panel, d);
     if (shipped) {
       panel.flash(`submitted — ${pending} answer(s)`); // verbatim, literal "answer(s)"
     }
   }
   ```

   - The count `n` = number of pending (answered) questions captured BEFORE `submit` runs (submit's `markSubmitted` flips them to `submitted`; capturing after would read 0).
   - Flash AFTER `submit` returns true, so a zero-shipped early-return inside submit (shouldn't happen given pending ≥ 1, but defensively) doesn't flash a lie.
   - Gate-hold withholding (FR-D5) is P2.M1.T2.S1 — it will wrap/extend this call site. Do NOT add any gate logic here.

2. **Wire after every commit tail.** Call `maybeAutoSubmit(panel)` (panel-scoped; deps come from `panel.delivery`) at the END of these four applied-commit paths, AFTER `evaluateDependsOn`/`advanceAfterAccept`/blur — i.e. the last statement before `return`:
   - `acceptOptionIndex` (actions.ts:236 tail) — covers accept(), digit(), deep-view selection, edits of answered/submitted questions.
   - `writeInEnter` (actions.ts:280) — ONLY the direct-commit branch (after `panel.blurTextField()`), NOT the empty-buffer branch (no commit) and NOT the `beginWriteInConfirm` deferred branch (hook belongs in the applied tail).
   - `applyWriteInConfirm` (ripple-confirm.ts:282 tail, after blur) — its docblock already reserves this hook ("do not implement it here" was for P1; now implement it).
   - `applyConfirmedEdit` (ripple-confirm.ts:145 tail) — deferred choice-edit commit.
   - NEVER hook: `applyTextConfirm` (draft save only), `cancelConfirm`/`cancelWriteInConfirm`/`cancelTextConfirm`, the empty-buffer writeInEnter branch.
   - ripple-confirm.ts imports from actions.js already exist? — check; if not, import `maybeAutoSubmit` from `"./actions.js"` (existing sibling imports follow the `.js` suffix convention).

3. **No changes to `submit()`** — call it EXACTLY; no parallel implementation. The held batch note rides (submit picks it up at :511-513). The existing "nothing to submit" flash cannot fire from this path (pending ≥ 1 guarantees user-shipped change).

4. **Docs [Mode A]**:
   - JSDoc on `maybeAutoSubmit`: the one shared hook; completeness predicate (zero open/reasked, ≥1 answered); calls the exact submit pipeline (one epoch bump per firing, h2.41); flashes `submitted — {n} answer(s)`; no-ops on zero pending; consumed by gate hold (P2.M1.T2.S1), bridge tail (P2.M1.T3.S1), AC-9 pending-ship (P3.M2.T2.S1).
   - `src/state.ts` epoch doc block (~:201-210, "rev/epoch semantics"): append one line — auto-submits bump epoch (AUTOSUBMIT-001; each firing is a full submission, h2.39/h2.41).

### Success Criteria

- [ ] Answering the LAST open question (accept, write-in enter, text enter) delivers a submission with no further keypress: `sendMessage` exactly once, footer flash exactly `submitted — {n} answer(s)`.
- [ ] Editing an already-answered question while the set is complete fires again — one submission per commit.
- [ ] A commit while any open/reasked question remains: no submit, no flash.
- [ ] A commit on a complete set with zero pending: no submit, no flash.
- [ ] Epoch bumps exactly once per firing (`state.getEpoch()` +1 after each auto-submit).
- [ ] Deferred commits (ripple-confirm modal enter for choice AND write-in) trigger the auto-submit; modal ESC/cancel never does.
- [ ] Existing `submit()` behavior and tests unchanged; `ctrl+s` path untouched.

## All Needed Context

### Context Completeness Check

All four hook sites are identified by function and current tail content; the hook logic is given verbatim; the completeness predicate, flash string, deps sourcing (`panel.delivery`, panel.ts:475), and test fixtures (`seed`/`makePanel`/`makeDeps` in actions.test.ts:74/:100/:117) are named. No prior codebase knowledge needed.

### Documentation & References

```yaml
- file: src/panel/actions.ts
  why: hook home; submit() (:448) is the EXACT pipeline to call; nextUnanswered (:106) defines the open/reasked predicate; acceptOptionIndex (:236) + writeInEnter (:280) are hook sites; SubmitDeps (:54); export list tail (~:567)
  pattern: mirror submit()'s JSDoc density (Mode A): contract refs + sequence + "EXACTLY once" invariants
  gotcha: capture `pending` count BEFORE calling submit (markSubmitted flips statuses); deps ?? panel.delivery; do NOT reimplement any pipeline step

- file: src/panel/ripple-confirm.ts
  why: applyConfirmedEdit (:145) and applyWriteInConfirm (:282) tails are hook sites; applyWriteInConfirm's docblock already reserves the hook
  pattern: append maybeAutoSubmit(panel) as the last statement of each APPLIED path
  gotcha: never hook cancel/applyTextConfirm paths (zero-answer or zero-state-change by contract)

- file: src/panel/panel.ts
  why: panel.delivery (:475, SubmitDeps | undefined, populated via surfaceSubmitDeps at open :1601-1608); flash() (:894, non-stacking, ~2.5s FLASH_MS :288); footerFlash field read by tests
  gotcha: commit fns don't receive deps — the panel-scoped hook must fall back to panel.delivery and no-op when undefined

- file: src/state.ts
  why: epoch doc block (~:201-210) gets the one-line auto-submit epoch note; getEpoch() for test assertions; bumpEpoch lives in buildSubmission (delivery.ts:186) — never call it from the hook
  pattern: Mode A doc edit only, no logic

- file: src/panel/actions.test.ts
  why: test home — seed (:74, status injection via overrides), makePanel (:100, pass delivery via extra Partial<InterrogationPanelArgs>), makeDeps (:117, { sendMessage: vi.fn(), isIdle }); existing submit tests (describe "submit — flush pending answers" :511) show sendMessage/epoch assertion patterns
  pattern: expect(panel.footerFlash?.text).toBe("submitted — 2 answer(s)") — exact string, literal "answer(s)"

- file: src/panel/ripple-confirm.test.ts (check exact name — ripple confirm tests live alongside)
  why: add deferred-commit trigger tests (applyConfirmedEdit/applyWriteInConfirm on a complete set)
  pattern: existing begin/apply/cancel modal tests — reuse their panel fixtures

- file: plan/002_949db554a811/P2M1T1S1/research/research-notes.md
  why: this item's audit — exact line anchors for every seam above
  gotcha: line numbers drift as P1.M2.T6.S2 lands in parallel; anchor by function name first, line second

- prd: h2.33 (AUTOSUBMIT-001), h2.8/FR-3, h2.41 (epoch per firing), h2.10 AC-2c, h2.51 M8 (maybeAutoSubmit bullet), h2.47 (per-submission contracts unchanged)
```

### Current Codebase tree (relevant slice)

```bash
src/panel/
  actions.ts            # MODIFY — add maybeAutoSubmit + wire 2 tails + JSDoc + export
  ripple-confirm.ts     # MODIFY — wire 2 deferred-commit tails (+1 import)
  actions.test.ts       # MODIFY — new describe block
  ripple-confirm.test.ts# MODIFY — deferred-commit trigger tests
src/state.ts            # MODIFY — one-line epoch JSDoc note
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: never reimplement the pipeline — one call to submit(). The
// held batch note, BUG-008 filter, snapshot+epoch ordering, markSubmitted
// flush, and delivery transport all live there.
// CRITICAL: capture pending count BEFORE submit (markSubmitted flips
// answered → submitted inside).
// GOTCHA: flash string is literal "answer(s)" — no pluralization logic
// (matches existing "question(s)" precedent, actions.ts:493).
// GOTCHA: panel.flash never stacks (h2.37) — the auto-submit flash replaces
// any live flash; that's fine and intended.
// GOTCHA: writeInEnter has THREE exits — hook only the direct-commit exit;
// empty-buffer (draft write-through) and beginWriteInConfirm (deferred) exits
// do NOT hook.
// GOTCHA: moot/withdrawn/closed NEVER count as unanswered — filter ONLY on
// "open"/"reasked" (nextUnanswered parity, actions.ts:106).
// GOTCHA: P1.M2.T6.S2 (overview ✎ marker) lands in parallel — do not touch
// overview.ts; expect possible test-file drift, rebase on function anchors.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/panel/actions.ts — implement + export maybeAutoSubmit
  - ADD maybeAutoSubmit after submit() per contract §1 (verbatim logic above)
  - ADD to export list (~:567)
  - MODE A JSDoc per contract §4

Task 2: MODIFY src/panel/actions.ts — wire tails
  - acceptOptionIndex: append `maybeAutoSubmit(panel);` after advanceAfterAccept, before `return true`
  - writeInEnter: append after `panel.blurTextField();` in the direct-commit branch only

Task 3: MODIFY src/panel/ripple-confirm.ts — wire deferred tails
  - IMPORT maybeAutoSubmit from "./actions.js" (check existing imports; follow .js suffix convention)
  - applyConfirmedEdit: append after its apply+evaluate+advance tail
  - applyWriteInConfirm: append after blurTextField

Task 4: MODIFY src/state.ts — epoch JSDoc one-liner (contract §4)

Task 5: MODIFY src/panel/actions.test.ts — new describe("maybeAutoSubmit — completeness hook")
  - last-open accept fires: seed 2 open, accept q1, accept q2 → sendMessage once, flash "submitted — 1 answer(s)", epoch 1→2
  - multi-pending fires with all pending: seed q1 answered (via direct state seeding or a prior accept), q2 open; accept q2 → flash "submitted — 2 answer(s)", one sendMessage
  - edit-on-complete-set fires again: after the above, accept a different option on q2 → second firing, epoch +1 again (one submission per commit)
  - incomplete set: 1 open remains → no sendMessage, no flash
  - complete set zero pending (all submitted, edit rejected/cancelled scenario): craft state all submitted + one open? no — zero pending + zero open via all-submitted state + direct call: maybeAutoSubmit(panel, deps) → no-op, no flash
  - no panel.delivery + no deps arg → no-op (no throw)
  - text enter fires: seed text question as last open, commit via writeInEnter path
  - held note rides: set panel batch note, auto-submit, assert NOTE in delivered message (pattern from submit tests)
Task 6: MODIFY ripple-confirm tests — deferred triggers
  - applyConfirmedEdit on complete set → one firing; applyWriteInConfirm likewise; both cancel paths → zero sendMessage

Task 7: VALIDATE — npm run typecheck; npx vitest run src/panel/ -v; full suite
```

### Implementation Patterns & Key Details

```ts
// The hook (contract §1). Placement: after submit(), before the export list.
// Test-side deps injection follows the existing makeDeps() mock pattern
// (actions.test.ts:117) — mock delivery deps EXACTLY as submit() tests do.

// Wiring pattern (acceptOptionIndex tail):
  evaluateDependsOn(panel.state);
  advanceAfterAccept(panel);
  maybeAutoSubmit(panel); // P2.M1.T1.S1 — AUTOSUBMIT-001, completeness check
  return true;
```

### Integration Points

```yaml
NONE new:
  - no state/schema/config change; no new exports beyond the function itself
  - downstream consumers (P2.M1.T2.S1 gate hold, P2.M1.T3.S1 bridge tail)
    call maybeAutoSubmit(panel, deps) — the optional deps param is their seam
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/actions.test.ts -v
npx vitest run src/panel/ripple-confirm.test.ts -v 2>/dev/null || npx vitest run src/panel/ -v
npx vitest run        # full suite — no regressions in submit/keys/two-stage suites
```

### Level 3: Behavioral spot-checks (via tests, this is headless)

```bash
npx vitest run src/panel/actions.test.ts -t "maybeAutoSubmit" -v
grep -n "submitted — " src/panel/actions.ts src/panel/actions.test.ts  # verbatim string present
grep -rn "maybeAutoSubmit(panel" src/panel/actions.ts src/panel/ripple-confirm.ts  # exactly 4 wired tails + definition
```

## Final Validation Checklist

- [ ] `npm run typecheck` clean; full `npx vitest run` green.
- [ ] `maybeAutoSubmit` exported with Mode A JSDoc; called from exactly 4 commit tails; never from cancel/draft paths.
- [ ] Fires the EXACT `submit()` pipeline — grep confirms no snapshot/bumpEpoch/markSubmitted duplication in the hook.
- [ ] Flash verbatim `submitted — {n} answer(s)`; zero-pending no-ops silently.
- [ ] Epoch bumps once per firing; sendMessage exactly once per firing.
- [ ] state.ts epoch JSDoc notes auto-submit firings.
- [ ] `submit()` and `ctrl+s` (keys.ts:306) untouched.

## Anti-Patterns to Avoid

- ❌ Don't reimplement any pipeline step — one `submit()` call, nothing else.
- ❌ Don't capture the pending count after submit runs.
- ❌ Don't pluralize "answer(s)".
- ❌ Don't add gate-hold logic (next subtask) or bridge wiring (P2.M1.T3.S1).
- ❌ Don't hook the empty-buffer writeInEnter exit or any confirm-cancel path.
- ❌ Don't call `panel.flash` before confirming submit actually shipped.

---

**Confidence Score**: 9/10 — hook logic quoted verbatim, all four wiring sites identified with current tail content and pre-reserved docblocks, deps sourcing and test fixtures named, and the boundary against the three sibling subtasks drawn explicitly.

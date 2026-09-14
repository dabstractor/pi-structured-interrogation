# PRP — Bugfix P1.M4.T1.S1: Shared resumable predicate + suspend-widget visibility (BUG-005)

## Goal

**Feature Goal**: Fix the suspend-widget half of BUG-005: the suspend reminder widget no longer hides when all questions are answered-but-unsubmitted. Export a single shared predicate `hasResumableQuestions(state): boolean` from `src/panel/suspend.ts` (true iff any question has status ∈ {open, answered, submitted, reasked}) and use it — instead of `open > 0` — as the widget visibility rule in `updateSuspendWidget`. Keep exactly ONE definition of the status set (hoist `ACTIVE_STATUSES` from `src/panel/panel.ts` into `suspend.ts` as `RESUMABLE_STATUSES` and have `panel.ts` import it). Do NOT touch `command.ts` / `index.ts` — P1.M4.T1.S2 rewires those two clones onto the predicate.

**Deliverable**: Modified `src/panel/suspend.ts` (exported `RESUMABLE_STATUSES` const + `hasResumableQuestions()`; `updateSuspendWidget` keys on the predicate), a one-line import swap in `src/panel/panel.ts` (delete its private `ACTIVE_STATUSES` definition, import `RESUMABLE_STATUSES`), updated `src/panel/suspend.test.ts` (plus any `panel.test.ts` reference that breaks).

**Success Definition**: Suspend with all questions answered (0 open, N answered) → widget line `"0 open · N answered — Ctrl+Shift+Q to resume /interrogate"` is SET; state after `clearForCompletion` (empty map) → widget cleared (undefined); a state with only moot/withdrawn/closed questions → widget cleared; `hasResumableQuestions` exported for S2; `npm run typecheck` + `npm test` green.

## User Persona (if applicable)

**Target User**: The interrogation panel user who answers every question, then presses esc (suspend — a primary FR-16 flow) before ctrl+s.

**Use Case**: User finishes answering but isn't ready to submit; breaks out to chat with the agent; needs the reminder widget to still say "0 open · 3 answered — Ctrl+Shift+Q to resume /interrogate" so they can find their way back and submit.

**User Journey**: Answer all → esc (suspend) → widget above the editor still visible (0 open · N answered) → `ctrl+shift+q` (S2 will make the toggle honor it) → panel back → ctrl+s submit.

**Pain Points Addressed**: BUG-005 (part 1): widget cleared at open==0 stranded pending answers invisibly; user had no way to resurface the panel.

## Why

- Bugfix PRD Issue 5 (h3.4) + h2.5 recommendation: "Treat 'answered-pending' as resumable: resume/`reopen:true`/widget visibility should key on active statuses (open/answered/submitted/reasked), not open-only."
- h2.37 explicitly handles "0 open questions but pending submissions" as a live state, not an empty state.
- The predicate export is the contract S2 (P1.M4.T1.S2: command.ts toggle + index.ts onReopen) consumes — one definition, three call sites fixed across the two subtasks.

## What

### Predicate contract

```ts
// src/panel/suspend.ts
export const RESUMABLE_STATUSES: readonly string[] =
  ["open", "answered", "submitted", "reasked"];

export function hasResumableQuestions(state: InterrogationState): boolean {
  return state.orderedQuestions().some((q) => RESUMABLE_STATUSES.includes(q.status));
}
```

- Status set mirrors panel.ts's existing `ACTIVE_STATUSES` exactly (resume-focus notion, panel.ts:214). Terminal statuses (`moot`, `withdrawn`, `closed`) are NOT resumable.
- Single definition: `suspend.ts` owns `RESUMABLE_STATUSES`; `panel.ts` deletes its local `ACTIVE_STATUSES` and imports `RESUMABLE_STATUSES` (alias as `ACTIVE_STATUSES` locally if it minimizes diff churn — `import { RESUMABLE_STATUSES as ACTIVE_STATUSES } from "./suspend.js"`). The panel.ts ⇄ suspend.ts import cycle is pre-existing and documented safe (bindings touched only inside function bodies; a plain const array at module scope does not break it).

### Widget visibility rule change

In `updateSuspendWidget` (suspend.ts ~lines 99–111), replace:

```ts
const { open } = countStatuses(state.orderedQuestions());
...
setWidget.call(pi.ui, WIDGET_KEY, open > 0 ? [line] : undefined);
```

with:

```ts
setWidget.call(pi.ui, WIDGET_KEY, hasResumableQuestions(state) ? [line] : undefined);
```

- The LINE STRING is unchanged (`buildSuspendWidgetLine` keeps its exact-string contract: `"${open} open · ${answered} answered — ${labels.breakOut} to resume /interrogate"`; open/answered buckets unchanged — `0 open` is a legitimate line now).
- The JSDoc "Visibility rule" paragraphs on `buildSuspendWidgetLine` and `updateSuspendWidget` must be updated to describe the resumable-predicate rule (Mode A: suspended AND `hasResumableQuestions`; cleared after `clearForCompletion` empties the map, and when only terminal statuses remain).
- `countStatuses` stays as-is (feeds the line's n/m).
- No-op-without-setWidget behavior preserved.

### Explicitly OUT of scope (S2 / other items)

- `src/command.ts` (interrogateToggleAction open==0 → "empty") and `src/index.ts` (onReopen open==0 → "no-state") — S2 rewires them onto `hasResumableQuestions`.
- Anything in tool.ts / state.ts / depends-on.ts (parallel item P1.M3.T3.S2 owns `evaluateDependsOn` after applyUpsert — do not touch).
- The widget line format, key labels, or `resumePanel`.

### Success Criteria

- [ ] `hasResumableQuestions` exported from suspend.ts; true for states containing any of open/answered/submitted/reasked; false for empty state, all-terminal (moot/withdrawn/closed) state, and post-`clearForCompletion` state.
- [ ] `updateSuspendWidget`: answered-only suspended state → widget SET with "0 open · N answered — ..."; empty/terminal-only → cleared (undefined).
- [ ] Exactly one definition of the status set (grep `ACTIVE_STATUSES\|RESUMABLE_STATUSES` → definition only in suspend.ts).
- [ ] `npm run typecheck` + `npm test` green.

## All Needed Context

### Context Completeness Check

All anchors verified against the live codebase: the three open-only clones, `countStatuses`, the widget builder, panel.ts's `ACTIVE_STATUSES` and its two use sites, and the existing test conventions/fakes. A fresh implementer needs nothing beyond this PRP + the files listed.

### Documentation & References

```yaml
- file: src/panel/suspend.ts
  why: THE target module. countStatuses (lines 42-54) feeds the line; buildSuspendWidgetLine (~71) exact-string contract (U+00B7 " · " and U+2014 " — " separators, resolveKeyLabels(config).breakOut, lowercase /interrogate); updateSuspendWidget (~99-111) contains the open>0 gate to replace; module docstring documents the safe panel.ts⇄suspend.ts import cycle.
  gotcha: setWidget may be undefined (test fakes / RPC) — keep the early return. Update the two JSDoc "Visibility rule" paragraphs (they currently document the open-only rule and "a '0 open' line is never rendered" — now stale).

- file: src/panel/panel.ts
  why: line 214 `const ACTIVE_STATUSES: readonly string[] = ["open","answered","submitted","reasked"];` — DELETE and import RESUMABLE_STATUSES from "./suspend.js" (alias locally as ACTIVE_STATUSES to keep use sites at lines 1107/1345 untouched). This keeps ONE definition of the status set.
  gotcha: the import cycle panel.ts → suspend.ts already exists in the reverse direction and is documented safe; a plain const array at module scope does not evaluate cross-module bindings at load time.

- file: src/panel/suspend.test.ts
  why: test conventions: makeState(open, answered) builds a REAL InterrogationState via raw primitives; MockPi/makeMockPi fake surface capturing setWidget calls; firstCall(mock) helper; exact-string line assertions (line 24 builds expected strings). Existing test at line 204 ("sets line then clears at zero open") asserts the OLD rule for the answered case — must be updated, not just extended.
  pattern: extend makeState (or add a variant) to produce submitted/reasked/moot/withdrawn statuses — study how the file seeds statuses today (createInterrogationState forces new ids to "open"; non-open statuses are applied AFTER via applyAnswer/setStatus per actions.test.ts's convention).

- file: src/state.ts
  why: QuestionStatus union (line 22) — "open"|"answered"|"submitted"|"reasked"|"moot"|"withdrawn"|"closed" (verify exact members); orderedQuestions(); applyAnswer sets "answered"; clearForCompletion empties the map (predicate → false, "empty" stays correct — completion/pending-submission territory per h2.37 belongs to LIVE states only).

- file: src/command.ts (lines ~81-82) and src/index.ts (~line 173)
  why: the OTHER two open-only clones — READ ONLY for this task; S2 consumes hasResumableQuestions there. Do not modify them here (scope guard; S2's PRP owns those edits).

- docfile: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/P1M4T1S1/research/research-notes.md
  why: verified line anchors for every clone and the test conventions.
```

### Current Codebase tree (relevant excerpt)

```bash
src/
  panel/
    suspend.ts        # MODIFY: RESUMABLE_STATUSES + hasResumableQuestions + visibility rule
    suspend.test.ts   # MODIFY: predicate tests + updated widget rule tests
    panel.ts          # MODIFY (tiny): import RESUMABLE_STATUSES, delete local ACTIVE_STATUSES
    panel.test.ts     # MODIFY only if compilation/assertions reference the moved const
```

### Desired Codebase tree

```bash
src/panel/
  suspend.ts          # exports: WIDGET_KEY, buildSuspendWidgetLine, updateSuspendWidget,
                      # suspendPanel, resumePanel, RESUMABLE_STATUSES, hasResumableQuestions
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: single-definition rule — panel.ts must IMPORT, not re-declare.
// (grep gate: `grep -n "RESUMABLE_STATUSES\|ACTIVE_STATUSES" src/ -r` shows the
//  array literal only once, in suspend.ts.)
// GOTCHA: panel.ts ⇄ suspend.ts import cycle — safe ONLY because cross-module
// bindings are touched inside function bodies; keep RESUMABLE_STATUSES a plain
// const (no computed init referencing panel.ts).
// GOTCHA: new ids from createInterrogationState are forced to status "open";
// seed answered/submitted/reasked/moot/withdrawn via applyAnswer/setStatus
// AFTER creation (actions.test.ts precedent).
// GOTCHA: buildSuspendWidgetLine string is UNCHANGED — "0 open · N answered"
// is now a legitimate rendered line; do not "fix" the builder to hide zero.
// GOTCHA: setWidget(WIDGET_KEY, undefined) is the CLEAR call — keep the exact
// ternary shape so the no-setWidget early return stays first.
// GOTCHA: do not touch command.ts/index.ts — S2 lands next and will consume
// the exported predicate; leaving them open-only after THIS task is expected
// (widget half of the fix ships first).
```

## Implementation Blueprint

### Data models and structure

No new models — one exported const and one pure predicate (signature above in "What").

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/panel/suspend.ts — predicate + visibility rule
  - ADD: export const RESUMABLE_STATUSES (["open","answered","submitted","reasked"]) with Mode A JSDoc: mirrors the resume-focus notion; terminal statuses moot/withdrawn/closed are never resumable; single definition consumed by panel.ts resume-focus and (S2) command.ts/index.ts gates
  - ADD: export function hasResumableQuestions(state: InterrogationState): boolean (orderedQuestions().some(...))
  - MODIFY updateSuspendWidget: setWidget(WIDGET_KEY, hasResumableQuestions(state) ? [line] : undefined); drop the now-unused `open` destructure (keep countStatuses — buildSuspendWidgetLine uses it)
  - UPDATE the stale JSDoc "Visibility rule" paragraphs on buildSuspendWidgetLine + updateSuspendWidget (resumable-predicate wording; "0 open" lines DO render when answered/submitted/reasked remain)
  - NAMING: RESUMABLE_STATUSES, hasResumableQuestions — exact (S2 contract)

Task 2: MODIFY src/panel/panel.ts — one definition
  - DELETE line 214 ACTIVE_STATUSES const
  - ADD import { RESUMABLE_STATUSES as ACTIVE_STATUSES } from "./suspend.js" (local alias keeps use sites at ~1107/~1345 diff-free)
  - NOTHING else changes in panel.ts

Task 3: MODIFY src/panel/suspend.test.ts
  - ADD describe("hasResumableQuestions"): true for open-only, answered-only, submitted-only, reasked-only, mixed; false for empty state (no questions) and terminal-only (moot/withdrawn/closed)
  - UPDATE the visibility-rule describe: answered-only suspended state (makeState(0, N)) → setWidget SET with exact "0 open · N answered — Ctrl+Shift+Q to resume /interrogate"; empty/terminal-only → setWidget called with undefined; existing open>0 case keeps passing; the old "clears at zero open" assertion for the answered case must FLIP (this is the bugfix — update, don't delete, keeping a true zero-state clear case via an empty or all-terminal state)
  - FOLLOW pattern: existing MockPi/makeMockPi/firstCall helpers and exact-string expectations (line 24 `line()` builder)
  - NAMING: test_hasResumableQuestions_* / test_updateSuspendWidget_* matching file style

Task 4: VERIFY src/panel/panel.test.ts + full suite
  - Run npm test; fix only breakage caused by the moved const (expected: none beyond imports)
```

### Implementation Patterns & Key Details

```ts
// updateSuspendWidget after the fix (abridged — preserve the early return first):
export function updateSuspendWidget(pi, state, config): void {
  const setWidget = pi.ui.setWidget;
  if (setWidget === undefined) return;
  const line = buildSuspendWidgetLine(state, resolveKeyLabels(config));
  // BUG-005: answered/submitted/reasked-but-unsubmitted questions are LIVE —
  // the widget must stay findable so the user can resurface and ctrl+s.
  setWidget.call(pi.ui, WIDGET_KEY, hasResumableQuestions(state) ? [line] : undefined);
}

// panel.ts: import { RESUMABLE_STATUSES as ACTIVE_STATUSES } from "./suspend.js";
```

### Integration Points

```yaml
WIDGET (suspend.ts): visibility rule only — line format, WIDGET_KEY, choke-point callers (panel.ts openPanel .then/.catch) unchanged
RESUME-FOCUS (panel.ts:1107,1345): now backed by the shared const — behavior identical by construction (same four statuses)
FUTURE P1.M4.T1.S2: command.ts interrogateToggleAction + index.ts onReopen replace their open-only filters with hasResumableQuestions (do NOT pre-apply here)
PARALLEL P1.M3.T3.S2 (tool.ts evaluateDependsOn after applyUpsert): no overlap — do not touch tool.ts/depends-on.ts
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck    # zero errors (import alias resolves; cycle stays safe)
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/suspend.test.ts -v
npm test             # full suite green
```

### Level 3: Integration — SCRIPTED ONLY (AUTOMATION-POLICY)

> No live pi session. The full BUG-005 widget scenario is assertable in vitest: real state, applyAnswer all questions, updateSuspendWidget on a MockPi → widget line present. A tsx probe is optional; the existing test fakes suffice.

### Level 4: Domain-specific gates

```bash
# Single-definition gate:
grep -rn "\"open\", \"answered\", \"submitted\", \"reasked\"" src/   # exactly one hit (suspend.ts)
# No stray open-only clone left in suspend.ts:
grep -n "open > 0" src/panel/suspend.ts   # no hits
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean; `npm test` all green.
- [ ] Single-definition grep gate passes (status array literal exists only in suspend.ts).
- [ ] `open > 0` gate removed from suspend.ts.

### Feature Validation (BUG-005 widget half)

- [ ] All-answered suspended state → widget SET, exact line "0 open · N answered — Ctrl+Shift+Q to resume /interrogate" (labels config-driven).
- [ ] Post-clearForCompletion / empty / terminal-only states → widget cleared.
- [ ] submitted / reasked also keep the widget alive; moot/withdrawn/closed do not.
- [ ] `hasResumableQuestions` + `RESUMABLE_STATUSES` exported (S2 contract).
- [ ] Line builder string contract unchanged (existing exact-string tests pass unmodified except the flipped visibility case).

### Code Quality Validation

- [ ] Mode A JSDoc updated on the visibility rule; stale "0 open never rendered" wording removed.
- [ ] No changes outside suspend.ts(+test) and panel.ts(+test-if-needed) — command.ts/index.ts left for S2; tool.ts untouched (parallel item).

### Documentation & Deployment

- [ ] No README/doc changes required (item spec: "DOCS: none — ui-spec 'Suspend / resume / widget' conformance").

## Anti-Patterns to Avoid

- ❌ Don't fix command.ts/index.ts "while you're there" — that's S2's contract and its PRP.
- ❌ Don't duplicate the status array in panel.ts (import it) or in S2 later.
- ❌ Don't change buildSuspendWidgetLine's buckets or separators — only visibility flips.
- ❌ Don't evaluate anything cross-module at module scope in the panel.ts⇄suspend.ts cycle.
- ❌ Don't treat "0 open · N answered" as a rendering bug to hide — it is the fix.

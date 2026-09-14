# PRP — P1.M4.T1.S2: command.ts toggle + index.ts onReopen use the resumable predicate (BUG-005, resume half)

## Goal

**Feature Goal**: Replace the two remaining open-only resume gates with the shared resumable predicate from P1.M4.T1.S1, so a suspended panel whose questions are all in a live-but-unsubmitted status (answered/submitted/reasked, 0 open) can be resurfaced via `/interrogate`, the global break-out shortcut, and the agent's `{reopen:true}` — letting the user press ctrl+s to ship pending answers.

**Deliverable**: Two surgical edits — `src/command.ts` `interrogateToggleAction` suspended branch (`open === 0 → 'empty'` becomes `!hasResumableQuestions(state) → 'empty'`) and `src/index.ts` `onReopen` hook (drop the `open === 0` half of the guard, keep `resumeSurface === undefined`) — plus the corresponding test flips/extensions in `src/command.test.ts` (and the index/onReopen test harness if one exists). No other files.

**Success Definition**: BUG-005 repro from the PRD (h2.2/h3.4): upsert q1 → `applyAnswer` (status "answered", 0 open) → suspend → `interrogateToggleAction(host, pi, state)` returns **`'resumed'`** (was `'empty'`) and the host reopens; `onReopen` on the same state returns **`'reopened'`** (was `'no-state'`). Truly-dead states (post-`clearForCompletion` / empty / all-terminal moot/withdrawn/closed) still return `'empty'`/`'no-state'`. `npm run typecheck` + `npm test` green.

## User Persona (if applicable)

**Target User**: pi user who answered every interrogation question and suspended (esc) before submitting.

**Use Case**: User finishes answering, hits esc (FR-16 top-level suspend), chats with the agent, then returns via `/interrogate` or ctrl+shift+q — or the agent calls `interrogate({reopen:true})` — to resurface the panel and press ctrl+s.

**User Journey**: answer all → esc → (work in editor) → ctrl+shift+q → panel reopens focused on the answered question → ctrl+s submits → epoch bumps, model receives the answers.

**Pain Points Addressed**: BUG-005 — pending answers stranded with no path back to the panel; the model never receives them; the epoch never advances.

## Why

- h2.2/h3.4 Issue 5 (BUG-005): open==0 refused resume in both surfaces, stranding answered-pending state.
- FR-6: the agent reopen has "no deterministic guard" — this fix is state-existence plumbing (live statuses exist?), NOT a recency/epoch gate; that property must be preserved.
- Completes P1.M4.T1: S1 landed `hasResumableQuestions` + the widget-visibility half; this is the remaining two consumers.
- Suspend.ts's own comment previously documented "a dead panel is never resumed" with open-only semantics — now the rule is "resumable-predicate dead" (no live statuses).

## What

### Contract (authoritative)

1. **`src/command.ts` `interrogateToggleAction` suspended branch**:
```ts
if (host.isSuspended()) {
  // BUG-005: a suspended panel is dead ONLY when no live questions remain
  // (post-completion cleared / all terminal). Answered-pending panels
  // (0 open, N answered/submitted/reasked) MUST resurface so the user can
  // ctrl+s. This is state-existence plumbing, not a guard (FR-6).
  if (!hasResumableQuestions(state)) return "empty";
  resumePanel(pi);
  return "resumed";
}
```
   - Note: `state` is `InterrogationState | undefined`; `hasResumableQuestions(undefined)` is handled by S1's signature — verify it (S1 PRP declares `hasResumableQuestions(state: InterrogationState): boolean`; pass `state` only when defined, e.g. `state !== undefined && hasResumableQuestions(state)`, or match whatever S1 landed — an optional-state overload is acceptable; do NOT reinvent a fallback open-count).
   - REWRITE the branch's stale JSDoc/comment ("Suspended with 0 open questions = dead panel…") to the resumable-predicate rule.
   - Row 4 (closed host) unchanged.

2. **`src/index.ts` `onReopen` hook**: replace
   `if (open === 0 || resumeSurface === undefined) return "no-state";`
   with
   `if (!hasResumableQuestions(getState()) || resumeSurface === undefined) return "no-state";`
   (same optional-state handling as above). **Keep the `resumeSurface === undefined` guard** — it is surface-carrier plumbing, unrelated to BUG-005. The preceding comment block explaining the carrier adaptation stays.

3. **Imports**: `import { hasResumableQuestions, resumePanel, … } from "./panel/suspend.js"` in command.ts (resumePanel is already imported from there — extend the import); index.ts imports `hasResumableQuestions` alongside its existing `resumePanel` import from `./panel/suspend.js` (verify the existing import path and extend it).

4. **Do NOT touch**: `resumeOpenPanel` (panel.ts:1339–1354 — already restores `lastFocusId` when the status is in RESUMABLE_STATUSES, else first-active; compatible with all-answered panels), tool.ts (the `"No open questions to reopen."` line mapping and `ReopenOutcome` type stay), suspend.ts (S1's territory), widget format.

5. **Semantics preserved (FR-6)**: no epoch/rev/recency condition is introduced anywhere — only the live-status existence predicate.

### Success Criteria

- [ ] BUG-005 repro: answered-only suspended state → `interrogateToggleAction` returns `'resumed'`, host `isOpen()` true; `onReopen` returns `'reopened'`.
- [ ] Empty state (`state === undefined` / no questions) → `'empty'` / `'no-state'` (both surfaces).
- [ ] All-terminal state (moot/withdrawn/closed only) → `'empty'` / `'no-state'`.
- [ ] Post-`clearForCompletion` state → predicate false → `'empty'` / `'no-state'`.
- [ ] Open>0 suspended → `'resumed'` (existing row keeps passing).
- [ ] No open-only count remains: `grep -n '"open"' src/command.ts src/index.ts` → no status-filter clones (import-only usage).
- [ ] `npm run typecheck` + `npm test` green.

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the exact two gate sites (with their surrounding guards that must NOT change), the S1 predicate signature, the test harness conventions for both surfaces, and the dead-state seeding technique. All verified against the live code and anchored below.

### Documentation & References

```yaml
- file: src/command.ts (lines ~55–90)
  why: InterrogateToggleOutcome type + interrogateToggleAction with the suspended branch's open-count clone (line ~82) to replace, plus the stale "dead panel" comment to rewrite.
  pattern: pure toggle core, throws nothing, returns outcome for the registration layer's notify.
  gotcha: Row 4 (closed host → 'empty') and the isOpen()→suspend branch are untouched.

- file: src/index.ts (lines ~150–178)
  why: onReopen hook with `if (open === 0 || resumeSurface === undefined) return "no-state"` — drop ONLY the open half; the resumeSurface carrier-adaptation comment above it explains why the guard exists (ExtensionAPI has no ui; ctx is stashed per tool_execution_start).
  critical: removing `resumeSurface === undefined` would crash resumePanel(undefined) — keep it.

- file: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/P1M4T1S1/PRP.md
  why: CONTRACT (parallel, treat as landed): suspend.ts exports hasResumableQuestions(state) + RESUMABLE_STATUSES (["open","answered","submitted","reasked"]); true for any live status, false for empty/terminal-only/post-clearForCompletion. Single-definition grep gate (array literal only in suspend.ts).
  gotcha: check the LANDED signature for optional state; adapt call sites without reintroducing an open-count fallback.

- file: src/panel/suspend.ts
  why: after S1 lands, this is the import source for hasResumableQuestions; resumePanel(pi: PiUISurface) also lives here (both consumers already import it).

- file: src/panel/panel.ts (lines 214, 1107, 1328–1354)
  why: READ ONLY — resumeOpenPanel already focuses lastFocusId when its status ∈ RESUMABLE_STATUSES else first active; confirms no panel.ts change is needed for all-answered resume (focus falls to the first answered question).

- file: src/tool.ts (lines ~108–125, 343)
  why: READ ONLY — ReopenOutcome union and the no-state → "No open questions to reopen." line mapping stay exactly as-is (the message wording is now slightly conservative but its behavior — dead state → informative line — is correct; wording updates are NOT in scope).
  gotcha: do not "improve" the message string here; P1.M5.T2 owns README/docs.

- file: src/command.test.ts (describe "interrogateToggleAction — decision table", line 238)
  why: THE existing matrix — Row 3 currently asserts the BUG ('empty' for an answered-only suspended state via applyAnswer). That row must FLIP to 'resumed' (assert host.isOpen() too), and a new dead-panel row (terminal-only or cleared state → 'empty') must replace the negative coverage.
  pattern: createPanelHost(makeMockLifecycle().lifecycle), openOnSurface(state), makeSurfacePi() (cast `surface.surface as never`), choiceQ("q1"), createInterrogationState("goal"), resetState()/setState(), vi.clearAllMocks() in beforeEach.

- file: src/panel/panel.test.ts / any index-level onReopen test
  why: locate the existing harness that exercises the host-side onReopen hook (search for isSuspended + onReopen/reopenPanel harnesses); extend with the answered-only → "reopened" row. If none exercises the real hook, add one at the seam the existing tests already use (MockPi conventions per panel.test.ts) rather than a new harness style.
  gotcha: applyAnswer("q1", {value:"a", at: new Date().toISOString()}) is how tests seed "answered" (command.test.ts line ~268 shows the exact shape).

- file: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/research (bugfix-level PRD, h2.2/h3.4 + h2.5 recommendation "Treat 'answered-pending' as resumable")
  why: authoritative repro steps and the recommendation this task implements.
```

### Current Codebase tree (relevant excerpt)

```bash
src/
  command.ts        # MODIFY: suspended-branch gate → hasResumableQuestions + comment rewrite
  command.test.ts   # MODIFY: flip Row 3, add dead-panel row
  index.ts          # MODIFY: onReopen gate → hasResumableQuestions (keep resumeSurface guard)
  (index-side onReopen test wherever it lives today — extend)
```

### Desired Codebase tree

No new files — two production edits + test updates.

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: keep `resumeSurface === undefined` in onReopen's guard — it is
// surface-carrier plumbing (pi factory has no ui), NOT part of BUG-005.
// GOTCHA: optional state — `state` in command.ts is `InterrogationState | undefined`
// and getState() can return undefined; undefined state = NOT resumable = 'empty'/
// 'no-state'. Match S1's landed signature; if it doesn't accept undefined, guard
// with `state !== undefined && hasResumableQuestions(state)`.
// GOTCHA: command.test.ts Row 3 is the PRD's literal repro — flipping it IS the
// acceptance test; don't delete the negative coverage, RE-TARGET it at a truly
// dead state (empty or moot/withdrawn/closed-only).
// GOTCHA: applyAnswer seeds "answered" directly — no setStatus needed for the repro.
// GOTCHA: resumePanel(pi) in command.ts vs resumePanel(resumeSurface) in index.ts —
// different carriers by design (see index.ts comment); do not unify them.
// GOTCHA: FR-6 — do NOT add epoch/rev/recency conditions; the predicate is pure
// live-status existence.
// GOTCHA: panel.ts ⇄ suspend.ts import cycle is documented safe; command.ts and
// index.ts already import from suspend.ts (resumePanel) so no new cycle risk.
```

## Implementation Blueprint

### Data models and structure

None — no new types. Both edits consume `hasResumableQuestions` (S1 export).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/command.ts — toggle gate
  - REPLACE the open-count clone in the suspended branch with hasResumableQuestions(state) (optional-state handling per S1's landed signature)
  - REWRITE the branch's stale comment to the resumable-predicate rule (dead = no live statuses: post-completion cleared or all-terminal; answered-pending resurfaces so the user can ctrl+s; FR-6: no deterministic guard)
  - EXTEND the existing suspend.js import with hasResumableQuestions
  - PRESERVE: isOpen→suspend branch, closed-host 'empty' row, InterrogateToggleOutcome type, throw-nothing contract

Task 2: MODIFY src/index.ts — onReopen gate
  - REPLACE `open === 0` with !hasResumableQuestions(getState()) in the suspended-host condition, KEEPING `|| resumeSurface === undefined`
  - EXTEND the suspend.js import; PRESERVE the carrier-adaptation comment, the isOpen 'already-open' branch, and the closed-host 'no-state' fallthrough

Task 3: MODIFY src/command.test.ts — decision table flip
  - FLIP Row 3: answered-only suspended state → expect 'resumed' + host.isOpen() true (this is the PRD h2.3.4 repro, PROBE6)
  - ADD a dead-panel row: state with only terminal statuses (or a cleared/empty state) → 'empty', host stays suspended (negative coverage replacing the flipped assertion)
  - ADD (cheap): submitted-only and reasked-only rows → 'resumed'
  - FOLLOW pattern: existing harness (createPanelHost, openOnSurface, makeSurfacePi, choiceQ, resetState/setState); seed statuses via applyAnswer + setStatus AFTER createInterrogationState (new ids are forced "open")

Task 4: EXTEND the onReopen host-side test
  - LOCATE the existing harness exercising index.ts's onReopen (search panel.test.ts / command.test.ts / index tests for isSuspended + resume wiring); ADD: answered-only suspended state → hook returns 'reopened' (was 'no-state'); post-clearForCompletion / terminal-only → 'no-state'; resumeSurface-missing case unchanged
  - If no real-hook harness exists, test the seam the codebase already fakes (MockPi) rather than building a pi runtime — AUTOMATION-POLICY.md forbids live-session tests

Task 5: VERIFY
  - npm run typecheck && npm test
  - grep gates: `grep -n 'status === "open"' src/command.ts src/index.ts` → no hits; `grep -rn '"open", "answered", "submitted", "reasked"' src/` → single hit in suspend.ts (S1's gate, re-verified)
```

### Implementation Patterns & Key Details

```ts
// command.ts (after):
if (host.isSuspended()) {
  // BUG-005: dead = NO live questions (post-completion cleared or all
  // terminal). Answered/submitted/reasked-pending panels resurface so the
  // user can ctrl+s. Pure state-existence check — FR-6 forbids adding any
  // deterministic (epoch/rev) guard here.
  if (!(state !== undefined && hasResumableQuestions(state))) return "empty";
  resumePanel(pi);
  return "resumed";
}

// index.ts onReopen (after):
if (panelHost.isSuspended()) {
  const state = getState();
  if (!(state !== undefined && hasResumableQuestions(state)) || resumeSurface === undefined)
    return "no-state";
  resumePanel(resumeSurface);
  return "reopened";
}
```

### Integration Points

```yaml
SUSPEND.TS (S1, read-only): hasResumableQuestions consumed by both sites
PANEL.TS (read-only): resumeOpenPanel/resumePanel already focus correct question for all-answered panels
TOOL.TS (read-only): ReopenOutcome + "No open questions to reopen." mapping unchanged
WIDGET (S1, landed): already keyed on hasResumableQuestions — /interrogate, shortcut, reopen now agree with it
FUTURE P1.M4.T2.S1 (ctrl+t gating): no interaction
FUTURE P1.M5.T2 (docs): README/spec notes about resumability behavior — NOT this task
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck    # zero errors
```

### Level 2: Unit Tests

```bash
npx vitest run src/command.test.ts -v
npx vitest run src/ -v   # wherever the onReopen extension landed
npm test
```

### Level 3: Integration — SCRIPTED ONLY (AUTOMATION-POLICY.md)

The full BUG-005 scenario is vitest-assertable (real InterrogationState, applyAnswer, suspended MockPanelHost, outcome assertions) — exactly what Task 3/4 encode. No live pi session; interactive confirmation belongs to the human TUI runbook.

### Level 4: Domain-specific gates

```bash
grep -n 'status === "open"' src/command.ts src/index.ts        # no hits (open-only clones gone)
grep -rn '"open", "answered", "submitted", "reasked"' src/     # exactly one hit (suspend.ts)
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean; `npm test` all green.
- [ ] Level 4 grep gates pass.

### Feature Validation (BUG-005 resume half)

- [ ] Answer-all → suspend → `interrogateToggleAction(host, pi, state)` = `'resumed'`; `onReopen` = `'reopened'`; panel reopens and ctrl+s can submit.
- [ ] Empty / undefined state → `'empty'` / `'no-state'`; terminal-only state → `'empty'` / `'no-state'`; post-completion cleared state → `'empty'` / `'no-state'`.
- [ ] `resumeSurface === undefined` guard retained; open>0 and closed-host rows unchanged.
- [ ] No epoch/rev/recency condition introduced (FR-6 preserved).

### Code Quality Validation

- [ ] Predicate imported, not re-implemented (no inline status filters).
- [ ] Only command.ts, index.ts, and test files touched.
- [ ] Stale comments rewritten (the "dead panel" JSDoc in command.ts).

### Documentation & Deployment

- [ ] No README/spec edits (P1.M5.T2 owns changeset-level docs).
- [ ] Comment updates are accurate to the new behavior.

## Anti-Patterns to Avoid

- ❌ Don't re-implement a status filter inline — consume S1's `hasResumableQuestions`.
- ❌ Don't drop the `resumeSurface === undefined` guard in onReopen.
- ❌ Don't add an epoch/rev/recency condition (FR-6 violation).
- ❌ Don't touch tool.ts message wording, resumeOpenPanel, or suspend.ts.
- ❌ Don't delete the decision-table's negative coverage — re-target it at genuinely dead states.
- ❌ Don't build a live-pi harness; stay within the existing MockPi/MockPanelHost conventions.

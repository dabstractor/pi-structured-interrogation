---
name: "P3.M1.T1.S1 — Add upsert-call + unanswered-exist + not-completed gates to maybeAutoOpen (SURFACE-001)"
description: "maybeAutoOpen (src/panel/panel.ts:1797, wired at src/index.ts:165) currently opens the panel on ANY successful interrogate end event (toolName + !isError + host-closed + state-exists) — including pure {} reads and reads over completed/all-answered states. This PRP adds the three-gate SURFACE-001 allow-list: (1) the call was an upsert (non-empty questions[] from the args stash), (2) unanswered (open/reasked) questions exist post-upsert, (3) the interrogation is not completed. Args reach the handler by peeking the existing pendingUpsertArgs Map (populated at tool_execution_start, consumed+deleted by the LAST-registered end handler) — peek WITHOUT delete, no second stash, no change to the deferred bridge emission (D-R6). {reopen:true} and /interrogate paths untouched. Output consumed by P3.M1.T3.S1 (test flips) and P3.M1.T2.S1 (same unanswered predicate)."
---

## Goal

**Feature Goal**: FR-D6 / SURFACE-001 (PRD h2.37 surfacing allow-list, h2.16 event table, h2.10 AC-15, h2.39, h2.58 SURFACE-001 pin): the panel may be opened only by the user (`/interrogate`), an agent upsert that leaves unanswered questions, or agent `{reopen:true}`. Pure reads never surface, regardless of state.

**Deliverable**: Gated `maybeAutoOpen` in `src/panel/panel.ts` with a new optional `peekArgs` dependency (args access without consumption), hoisted `pendingUpsertArgs` declaration in `src/index.ts` + peek wiring, exported (or shared) upsert-args predicate, Mode A JSDoc, and updated unit tests in `src/panel/panel.test.ts` proving all three gates.

**Success Definition**: after this change, a successful `interrogate({})` read over ANY state (open questions, all-answered, completed, post-/tree) never opens the panel; an upsert leaving unanswered questions still auto-opens (first open and suspended-reopen); an upsert/description-only edit over a fully answered set surfaces nothing; `{reopen:true}` (index.ts `onReopen`) and `/interrogate` behave identically to before. Full vitest suite + typecheck green, with the KNOWN exception that `src/tree-nav-repro.test.ts` characterization assertions at :199/:208 (owned by P3.M1.T3.S1) may now fail — do not flip them here (see Gotchas).

## User Persona

**Target User**: The interrogation power user mid-conversation with the agent.

**Use Case**: After `/tree` navigation or any agent re-orientation, the model calls `interrogate({})` to read state. Previously this popped the panel over the user's prompt box mid-turn; pi's `custom()` editor snapshot/restore then turned every `esc` into a data-loss trap (the empty-box-after-esc symptom).

**User Journey**: user is typing in the prompt box → agent runs a read → nothing visibly changes (reads are pull) → later the agent upserts new/re-asked questions → panel opens with visibility on the new work → user answers.

**Pain Points Addressed**: the panel stealing the editor mid-turn; completed/all-answered interrogations popping up on reads; post-`/tree` re-orient reads hijacking the box.

## Why

- PRD h2.37: "Pure reads never surface, regardless of state — maybeAutoOpen requires (1) the call was an upsert (questions[] non-empty — the tool_execution_start args stash already exists for the bridge emission), (2) unanswered (open/reasked) questions exist post-upsert, (3) the interrogation is not completed."
- PRD h2.16 (event table, `tool_execution_end`): "maybeAutoOpen opens the panel ONLY for upsert calls leaving unanswered questions (SURFACE-001 — reads never surface)."
- PRD h2.39 + h2.10 AC-15: reads never surface in every state; the tree-nav characterizations flip (P3.M1.T3.S1).
- Root cause found by characterization tests in `src/tree-nav-repro.test.ts` (:175, :183) — see plan/002_949db554a811/architecture/surfacing-remote-seams.md §2.

## What

### Behavior contract

1. **Gate (1) — upsert-call.** The end handler must determine whether the ended call was an upsert. End events carry no args, so read the existing stash: `pendingUpsertArgs` (`src/index.ts:228`), populated by the factory's `tool_execution_start` handler (:231) and consumed+deleted by the LAST-registered end handler (:236-243, the deferred bridge emission, D-R6). maybeAutoOpen's handler is registered EARLIER (wired at index.ts:165) so it fires first — **peek with `.get(toolCallId)` only; NEVER delete; NEVER create a second stash**. Recommended mechanism: add an optional param `peekArgs?: (toolCallId: string) => unknown` to `maybeAutoOpen` (default `() => undefined`); index.ts passes `(id) => pendingUpsertArgs.get(id)`. Hoist the `pendingUpsertArgs` Map declaration above the `maybeAutoOpen(...)` call (index.ts:160-ish) — only the declaration moves; the start/end handler registrations stay put. An upsert = args where `Array.isArray(args.questions) && args.questions.length > 0` (reuse `isUpsertArgs`, `src/lifecycle.ts:126` — export it rather than duplicating; lifecycle.ts:190 is its existing consumer). `questions: []` and absent questions are reads → no open. Missing stash entry (no peekArgs / unknown toolCallId) → treat as read → no open.
2. **Gate (2) — unanswered-exist.** After the state-exists check, require an unanswered (status `open` or `reasked`) question: `nextUnanswered(state.orderedQuestions(), -1) !== undefined` (`src/panel/actions.ts:106`, exported; `UNANSWERED_STATUSES = ["open","reasked"]`, actions.ts:85). An upsert that only edits descriptions over an answered set surfaces nothing (PRD h2.37).
3. **Gate (3) — not-completed.** `state.completed === true` (state.ts:245, set by `clearForCompletion()`, state.ts:419) → never open. Note `clearForCompletion()` leaves the singleton installed with zero questions — gates (2) and (3) each independently block the post-completion read pop (tree-nav BUG #2); implement BOTH.
4. **Untouched paths**: `{reopen:true}` (index.ts `onReopen` → `resumePanel`), `/interrogate` command (`command.ts`), `handleUpserted` suspended-reopen (panel.ts:1429 — P3.M1.T2.S1's scope), reconstruction openPanel (P3.M2's scope), the deferred bridge emission handler (index.ts:236-243).
5. **Mode A docs**: JSDoc on `maybeAutoOpen` stating the three-gate allow-list and the rationale: reads are pull, never surfaces; cite SURFACE-001 and the empty-box-after-esc data-loss trap; note the peek-without-delete contract (the last-registered end handler still consumes+deletes for D-R6).

### Success Criteria

- [ ] Upsert (non-empty `questions[]` in stash) leaving open/reasked questions, host closed → panel opens (both first-open and suspended-reopen).
- [ ] Pure read `{}` (no stash entry / no questions) over open-question state → NO open, editor untouched.
- [ ] Upsert or read over an all-answered (no open/reasked) state → NO open.
- [ ] Read or upsert over a `completed` state (singleton still installed post-`clearForCompletion`) → NO open.
- [ ] `questions: []` end event → NO open.
- [ ] Deferred bridge emission still fires exactly as before (stash consumed once, by the last handler only).
- [ ] `{reopen:true}` and `/interrogate` tests unchanged and green.

## All Needed Context

### Context Completeness Check

Validated: bug site, current handler body, args-stash mechanics and handler registration order, all three predicates with exact anchors, existing test harnesses (`panel.test.ts` arm(), `tree-nav-repro.test.ts`, `reload-invoke.test.ts`) and which callers must keep compiling (optional param), plus the downstream items' contracts (T2.S1, T3.S1).

### Documentation & References

```yaml
- file: src/panel/panel.ts
  why: maybeAutoOpen (:1797) — the function to modify; handler body :1801+; also imports nextUnordered? (nextUnanswered already imported at :52 from ./actions.js); openPanel retry logic (NEW-001) stays intact behind the gates
  pattern: keep the NEW-001 stale-record retry exactly as-is AFTER the three gates pass
  gotcha: maybeAutoOpen is called in tests WITHOUT the new param (panel.test.ts:922/:968/:975, reload-invoke.test.ts:252) — param MUST be optional with a read-conservative default (no peek ⇒ no open)

- file: src/index.ts
  why: wiring site (:165), pendingUpsertArgs Map (:228), start handler (:231-234), consuming end handler (:236-243)
  pattern: hoist ONLY the Map declaration above :160; pass peek closure as the new arg; leave both handler registrations untouched
  gotcha: deleting from the Map inside maybeAutoOpen would starve the bridge emission (D-R6) — forbidden

- file: src/lifecycle.ts
  why: isUpsertArgs (:126, module-private) — export it and import in panel.ts (single definition); existing consumer at :190 (rule-1 flip)
  gotcha: isUpsertArgs requires length > 0 — empty array is a read

- file: src/panel/actions.ts
  why: nextUnanswered (:106) + UNANSWERED_STATUSES (:85) — the unanswered predicate; nextUnanswered(ordered, -1) scans from index 0 (wrap semantics, see resumeOpenPanel comment panel.ts:1762-1766)
  gotcha: do NOT use hasResumableQuestions (suspend.ts:66) — it counts answered/submitted too; SURFACE-001 needs open/reasked ONLY

- file: src/state.ts
  why: completed flag (:245, set in clearForCompletion :419; serialized :440/:460) — gate (3)
  gotcha: clearForCompletion leaves the singleton installed with completed=true and zero questions

- file: src/panel/panel.test.ts
  why: describe("maybeAutoOpen — tool-path auto open/reopen") (:903); harness arm() (:917-926) fires bare endEvent() — MUST be updated to wire a peekArgs (or fire a matching start stash) so upsert tests still open
  pattern: endEvent() factory (:915); mock.emit(...); afterEach resetState()

- file: src/tree-nav-repro.test.ts
  why: the two SURFACE-001 BUG characterizations (:175, :183) — assertions at :199/:208 are OWNED BY P3.M1.T3.S1
  gotcha: do NOT flip or rewrite these assertions in this item; if they fail after the gate lands, leave them (T3.S1 flips them) — note it in the PR. Same for reload-invoke.test.ts:252 ONLY if it asserts opening via a read path; if it upserts via a start stash, wire the peek and keep it green.

- file: plan/002_949db554a811/architecture/surfacing-remote-seams.md
  why: sections §1 (wiring order), §2 (bug site), test-flip ledger — authoritative seam map; §2 quotes the exact handler body
- file: plan/002_949db554a811/P3M1T1S1/research/findings.md
  why: this item's research notes (anchors, predicate choices, harness survey)
- file: plan/002_949db554a811/P2M1T4S1/PRP.md
  why: parallel-implementing sibling — touches only src/panel/actions.test.ts (+optional JSDoc); disjoint files from this item; assume it lands as specified
```

### Current Codebase tree (relevant slice)

```bash
src/panel/panel.ts          # MODIFY — gate maybeAutoOpen + JSDoc + new optional peekArgs param
src/index.ts                # MODIFY — hoist pendingUpsertArgs declaration, pass peek closure
src/lifecycle.ts            # MODIFY (export only) — export isUpsertArgs
src/panel/panel.test.ts     # MODIFY — update arm() harness; add gate tests
# possibly reload-invoke.test.ts harness wiring if its scenario is upsert-based
```

### Desired Codebase tree with file responsibilities

```bash
src/panel/panel.ts    # maybeAutoOpen: 3 gates (upsert-call, unanswered-exist, not-completed) + JSDoc
src/index.ts          # pendingUpsertArgs declared before maybeAutoOpen; peekArgs wired
src/lifecycle.ts      # isUpsertArgs exported (logic unchanged)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL ORDERING: end-handler fire order = registration order. maybeAutoOpen
// (index.ts:165) fires BEFORE the factory's last end handler (index.ts:236)
// which consumes+deletes the stash for the D-R6 bridge emission. PEEK ONLY.
// GOTCHA: pendingUpsertArgs is declared at index.ts:228 — AFTER the
// maybeAutoOpen call at :165. Hoist the declaration; don't move handlers.
// GOTCHA: optional peekArgs with default () => undefined ⇒ no stash ⇒ gate (1)
// fails ⇒ read ⇒ no open. All pre-existing test callers keep compiling; the
// panel.test.ts arm() must pass a real peek (or start-event stash) for the
// open-asserting tests to stay green.
// GOTCHA: use nextUnanswered/UNANSWERED_STATUSES ("open","reasked"), NOT
// hasResumableQuestions (which includes answered/submitted).
// GOTCHA: never launch a live pi TUI in tests (AUTOMATION-POLICY) — mock pi
// with handler maps (panel.test.ts makeMockPi pattern).
// GOTCHA: questions: [] is a read (length > 0 required by isUpsertArgs).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EXPORT isUpsertArgs from src/lifecycle.ts
  - CHANGE: `function isUpsertArgs` → `export function isUpsertArgs` (:126)
  - PRESERVE: logic verbatim; existing consumer (:190) untouched

Task 2: MODIFY src/panel/panel.ts — gate maybeAutoOpen (:1797)
  - ADD param: `peekArgs: (toolCallId: string) => unknown = () => undefined` (last position, after drafts)
  - GATES (insert after `event.isError` check, before `host.isOpen()` or alongside):
    1. `if (!isUpsertArgs(peekArgs(event.toolCallId))) return;`
    2. keep `host.isOpen()` / `state === undefined` checks
    3. `if (state.completed) return;`
    4. `if (nextUnanswered(state.orderedQuestions(), -1) === undefined) return;`
  - PRESERVE: the NEW-001 stale-record openPanel retry block verbatim after the gates
  - IMPORT: isUpsertArgs from ../lifecycle.js (check for import cycles: lifecycle.ts does not import panel.ts — verified in seams doc §1)
  - JSDOC (Mode A): three-gate allow-list, SURFACE-001 citation, reads-are-pull rationale, peek-without-delete contract (D-R6 bridge emission owns consumption)

Task 3: MODIFY src/index.ts — hoist + wire
  - HOIST: `const pendingUpsertArgs = new Map<string, unknown>();` to just above the `maybeAutoOpen(pi, config, panelHost, drafts);` call (~:160)
  - PASS: `maybeAutoOpen(pi, config, panelHost, drafts, (id) => pendingUpsertArgs.get(id));`
  - PRESERVE: start handler (:231-234) and end handler (:236-243) bodies verbatim (get+delete stays there ONLY)

Task 4: MODIFY src/panel/panel.test.ts — harness + gate tests
  - UPDATE arm() (:917): accept a `startArgs?: unknown` and stash it in a local Map; call maybeAutoOpen with `(id) => stash.get(id)`; fire a matching start event or pre-seed the map before emit
  - UPDATE existing open-asserting tests (:922 NEW-001 test, :968/:975 second-surface test) to seed upsert args (`{ questions: [{ id: "q1" }] }`-shaped)
  - ADD (new tests in the describe):
    - test_read_no_stash_never_opens (bare endEvent, open-question state → 0 custom calls)
    - test_read_empty_questions_array_never_opens (stash `{ questions: [] }` → 0)
    - test_upsert_leaving_unanswered_opens (stash non-empty questions, open state → opens)
    - test_upsert_all_answered_no_open (state all answered/submitted, stash upsert args → 0)
    - test_completed_state_never_opens (clearForCompletion'd singleton, stash upsert args → 0)
    - test_peek_does_not_consume (after maybeAutoOpen fires, the map entry still present — assert peek-preserving consumption contract)
  - NAMING: test_{scenario}_{expected} per file convention

Task 5: CHECK src/reload-invoke.test.ts (:252 comment) and any other maybeAutoOpen caller
  - grep -n "maybeAutoOpen(" src/ — every non-index caller: if the scenario is an upsert, wire a peek; if a read, the no-open default is the FIX — update the assertion only if it asserted the old pop behavior AND is not owned by T3.S1 (tree-nav-repro.test.ts rows ARE owned by T3.S1 — leave failing/flipping to it)

Task 6: VALIDATE
  - npm run typecheck
  - npx vitest run src/panel/panel.test.ts -v
  - npx vitest run src/panel/ -v
  - npx vitest run  # note any tree-nav-repro failures in the PR (expected, owned by P3.M1.T3.S1)
```

### Implementation Patterns & Key Details

```ts
// The gated handler (shape — panel.ts maybeAutoOpen):
void pi.on("tool_execution_end", (event, ctx) => {
  if (event.toolName !== "interrogate" || event.isError) return;
  // SURFACE-001 gate (1): upsert-call — PEEK the start-phase args stash
  // (never delete; the LAST-registered end handler consumes it for the
  // D-R6 bridge emission).
  if (!isUpsertArgs(peekArgs(event.toolCallId))) return;
  if (host.isOpen()) return;
  const state = getState();
  if (state === undefined) return;
  if (state.completed) return;                       // gate (3)
  if (nextUnanswered(state.orderedQuestions(), -1) === undefined) return; // gate (2)
  // ... existing openPanel + NEW-001 retry, verbatim
});
```

### Integration Points

```yaml
NONE new — no schema/config/state-model changes:
  - DOWNSTREAM P3.M1.T2.S1: applies the same unanswered predicate to handleUpserted (panel.ts:1429) — name/import nextUnanswered identically
  - DOWNSTREAM P3.M1.T3.S1: flips tree-nav-repro.test.ts :199/:208 to .toBe(0) and adds the AC-15 scripted test — the default read-conservative peekArgs default is what makes those flips safe
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck    # expect clean
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/panel.test.ts -v
npx vitest run src/lifecycle.test.ts -v   # export touched
npx vitest run src/panel/ -v
npx vitest run                          # full suite
# Expected: all green EXCEPT possibly src/tree-nav-repro.test.ts :199/:208 —
# those characterizations are P3.M1.T3.S1's to flip; note them in the PR.
```

### Level 3: Behavioral spot-checks

```bash
npx vitest run src/panel/panel.test.ts -t "maybeAutoOpen" -v
grep -n "maybeAutoOpen(" src/ -r   # every caller audited for peek wiring
```

## Final Validation Checklist

- [ ] `npm run typecheck` clean; panel + lifecycle + full vitest green (tree-nav-repro exceptions documented).
- [ ] All three gates individually tested; upsert path still opens (first-open and suspended-reopen).
- [ ] Stash consumed exactly once (by the last end handler); peek-only verified by test.
- [ ] `{reopen:true}` / `/interrogate` paths untouched and their tests green.
- [ ] Mode A JSDoc on maybeAutoOpen with allow-list + SURFACE-001 rationale.
- [ ] No second stash; no config/schema changes; no spec file edits.

## Anti-Patterns to Avoid

- ❌ Don't delete or write the stash in maybeAutoOpen — consumption belongs to the bridge-emission end handler (D-R6).
- ❌ Don't use hasResumableQuestions for gate (2) — answered/submitted must not count as unanswered.
- ❌ Don't flip tree-nav-repro.test.ts assertions — P3.M1.T3.S1 owns them.
- ❌ Don't touch handleUpserted (P3.M1.T2.S1) or reconstruction openPanel (P3.M2).
- ❌ Don't make peekArgs required — existing test callers must keep compiling.

---

**Confidence Score**: 9/10 — the bug site, handler-body, stash mechanics, registration order, all three predicates, and every test harness/caller are anchored to exact lines (verified against the current tree); the only residual risks are line drift from the parallel P2.M1.T4.S1 work (disjoint files) and coordinating the two expected tree-nav characterization failures with P3.M1.T3.S1, both mitigated by explicit scope notes.

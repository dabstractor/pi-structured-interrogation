# PRP — bugfix P1.M3.T1.S1: recordAnswers skips terminal-status ids, reports `ignored`

---
name: "bugfix P1.M3.T1.S1 — fallback.ts: skip moot/withdrawn/closed ids, report an `ignored` bucket"
description: "Fix BUG-012 in src/fallback.ts recordAnswers (~lines 185–222): ids resolving to a question whose status ∈ {moot, withdrawn, closed} are NOT applied — collected into a new `ignored: string[]` bucket (return shape becomes {recorded, unknown, ignored}). Snapshot+bumpEpoch run only when recorded.length > 0 (a fully-ignored call must not burn an epoch — mirrors panel zero-pending early-return). Fix the false 'markSubmitted-equivalent' docstring claim. Wire the bucket into src/tool.ts record case: append 'not recordable (moot/withdrawn/closed): id1, id2' when non-empty. Pure-function tests in src/fallback.test.ts (real InterrogationState + upsertQuestion + setStatus, no mocks)."
---

## Goal

**Feature Goal**: Non-TUI `answers[]` recording can no longer resurrect terminal-status questions (BUG-012, bug report h2.3/Issue 4). A withdrawn/moot/closed id is skipped and surfaced in an `ignored` bucket instead of flipping to `answered`, preserving the h2.38 terminal-until-re-upsert rule and the withdrawal audit marker.

**Deliverable**: Modified `src/fallback.ts` (`recordAnswers` + its JSDoc), modified `src/tool.ts` (record case, one appended line), tests in `src/fallback.test.ts` (+ one executor-level case in `src/tool.test.ts` if its harness covers record). No other files.

**Success Definition**: `npm run typecheck` + `npm test` green. Repro from the bug report: withdraw q1 via upsert omission, then non-TUI `executeInterrogate({answers: [{id: "q1", value: "x"}], ...})` → q1.status stays `withdrawn`, result content contains `not recordable (moot/withdrawn/closed): q1`, epoch unchanged. Mixed call (1 recordable + 1 ignored + 1 unknown) still bumps epoch exactly once and snapshots once.

## User Persona

**Target User**: The agent relaying chat answers via `answers[]` in non-TUI mode (`pi -p`/rpc/json).

**Use Case**: A stale digest relay or mistaken model re-records an answer for a question the agent deliberately withdrew — it must be a visible no-op, not a resurrection.

**User Journey**: model sends `answers[]` containing a withdrawn id → tool result line tells it which ids were not recordable and why → state untouched for those ids, epoch only moves if something was actually recorded.

**Pain Points Addressed**: Terminal-until-re-upsert rule bypassed on the only unguarded path (state.ts applyAnswer has no terminal check by design; recordAnswers was the missing gate).

## Why

- Bug report h2.3 Issue 4 (BUG-012): recordAnswers applies `applyAnswer` for any known id; `state.ts` applyAnswer (~339–346) unconditionally sets status `answered`.
- Consistency: the panel's accept path already treats moot/withdrawn as consumed no-ops — this makes the non-TUI path match (h2.38: moot/withdrawn terminal-until-re-upsert; `SKIP_EVALUATION = {withdrawn, closed}` in depends-on.ts:75 is the same terminal-set idea; here `moot` is included because it shares the terminal-until-re-upsert rule).
- Foundation for P1.M3.T2.S1 (non-TUI completion, BUG-004), which adds markSubmitted on the `recorded` bucket and relies on this return shape.

## What

### Exact edits

**1. `src/fallback.ts` — `recordAnswers` (currently ~lines 185–222)**

```ts
const TERMINAL_ANSWER_STATUSES: ReadonlySet<QuestionStatus> = new Set(["moot", "withdrawn", "closed"]);

export function recordAnswers(
  state: InterrogationState,
  answers: AnswerInput[],
): { recorded: string[]; unknown: string[]; ignored: string[] } {
  const recorded: string[] = [];
  const unknown: string[] = [];
  const ignored: string[] = [];
  const at = new Date().toISOString();

  for (const answer of answers) {
    const q = state.getQuestion(answer.id);
    if (q === undefined) {
      unknown.push(answer.id);
      continue;
    }
    // BUG-012: terminal-until-re-upsert (h2.38) — moot/withdrawn/closed ids
    // are consumed no-ops, matching the panel's accept path. Closed reopens
    // ONLY via re-upsert (rev+1), never via answers[].
    if (TERMINAL_ANSWER_STATUSES.has(q.status)) {
      ignored.push(answer.id);
      continue;
    }
    const applied: QuestionAnswer = { value: answer.value, at };
    if (answer.text !== undefined) applied.text = answer.text;
    state.applyAnswer(answer.id, applied);
    recorded.push(answer.id);
  }

  // One call = one submission — but ONLY if something was recorded. A fully
  // ignored/unknown call burns no epoch and pushes no snapshot (mirrors the
  // panel's zero-pending ctrl+s early-return flash).
  if (recorded.length > 0) {
    takeSnapshot(state);
    state.bumpEpoch();
  }

  return { recorded, unknown, ignored };
}
```

Note this REMOVES the unconditional snapshot+bump tail: `takeSnapshot`/`bumpEpoch` move inside the `recorded.length > 0` guard. Existing tests that record at least one answer keep passing unchanged; any existing test asserting epoch/snapshot movement for all-unknown calls must be UPDATED to the new zero-side-effect contract (check `src/fallback.test.ts` — the docstring currently says "An all-unknown call is still one submission"; that claim dies here too).

**2. `src/fallback.ts` — JSDoc fix (Mode A)**

Rewrite the recordAnswers docstring (~lines 168–184). Required content:
- Remove the false `markSubmitted-equivalent` claim. Truthful description: recorded ids move to `answered` (pending) only; markSubmitted is added by P1.M3.T2.S1 so the agent_settled close pass can fire in non-TUI mode.
- Buckets: `recorded` (applied), `unknown` (id not in state), `ignored` (id exists but status ∈ {moot, withdrawn, closed} — terminal-until-re-upsert, h2.38; answer NOT applied, question untouched).
- Epoch rule: one snapshot + one bump per call **iff recorded.length > 0**; otherwise no side effects.
- Keep the GUARD ORDERING CONTRACT paragraph (assertFresh before; no re-check here) verbatim.

**3. `src/tool.ts` — record case (~lines 366–374)**

```ts
const { recorded, unknown, ignored } = recordAnswers(state, parsed.action.answers);
const serialized = state.serialize(); // POST-record: epoch bumped inside (iff anything recorded)
const statusLine = buildStatusLine(serialized);
const lines = [statusLine];
if (recorded.length > 0) lines.push(`recorded: ${recorded.join(", ")}`) — ONLY if that line already exists; otherwise do not add new output beyond:
if (ignored.length > 0) lines.push(`not recordable (moot/withdrawn/closed): ${ignored.join(", ")}`);
if (unknown.length > 0) lines.push(`unknown ids: ${unknown.join(", ")}`);
if (recorded.length === 0) lines.push("no answers recorded");
```

(Match the existing line set exactly — currently `unknown ids` + `no answers recorded`; insert the `not recordable` line after statusLine and before/alongside `unknown ids` as shown. Do not change `inlineEnvelope` usage or the TUI ignored-answers branch above it.)

### Success Criteria

- [ ] Withdrawn/moot/closed ids are untouched (status, answer, rev unchanged) and appear in `ignored`.
- [ ] Fully-ignored call: no snapshot pushed, epoch unchanged, result says `no answers recorded` + the `not recordable` line.
- [ ] Mixed call with ≥1 recordable: exactly one snapshot + one epoch bump.
- [ ] tool.ts record result includes the `not recordable (moot/withdrawn/closed): ...` line when non-empty.
- [ ] Return shape `{recorded, unknown, ignored}` — consumed by tool.ts now; P1.M3.T2.S1 adds markSubmitted on `recorded`.
- [ ] Docstring no longer claims markSubmitted-equivalence.

## All Needed Context

### Context Completeness Check

A fresh implementer needs: current recordAnswers source + its call site, the terminal-status rationale, the epoch rule change, and test conventions. All anchored below.

### Documentation & References

```yaml
- file: src/fallback.ts
  why: recordAnswers implementation (~185–222) + JSDoc to rewrite (~168–184); takeSnapshot/bumpEpoch tail to make conditional; truncate/isRecord-style module conventions
  gotcha: the existing docstring paragraph "An all-unknown call is still one submission" is now FALSE — delete/replace it

- file: src/tool.ts
  why: record case call site (~366–374): destructure ignored, append the not-recordable line; existing line formats (`unknown ids: ${join(", ")}`, `no answers recorded`)
  gotcha: the TUI branch above (h2.20 answers ignored in TUI) must remain untouched

- file: src/state.ts
  why: QuestionStatus union (line 22); getQuestion/applyAnswer semantics — applyAnswer (~339–346) unconditionally sets answered and bumps nothing on rev; do NOT add a terminal guard to applyAnswer itself (panel's own accept path relies on current semantics elsewhere)
  gotcha: never modify applyAnswer in this task

- file: src/depends-on.ts
  why: SKIP_EVALUATION = {withdrawn, closed} (line 75) — the existing terminal-set constant idea; our set adds 'moot' per h2.38 (moot/withdrawn terminal-until-re-upsert; closed reopens only via re-upsert)
  gotcha: do NOT import/reuse SKIP_EVALUATION — different semantics (evaluation skip vs answer-record skip); define TERMINAL_ANSWER_STATUSES locally in fallback.ts

- file: src/fallback.test.ts
  why: test conventions — real InterrogationState, mixedState() fixture, describe("recordAnswers") at ~185; existing assertions to preserve (rev untouched, one timestamp, snapshot at pre-bump epoch)
  pattern: pure-function tests, no mocks; expect(result).toEqual({recorded: [...], unknown: []}) shapes — update these to include ignored: []

- file: src/fallback.test.ts mixedState fixture
  why: how statuses are seeded (upsertQuestion + setStatus) — reuse it to build a withdrawn/moot/closed question in new tests

- file: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/prd_snapshot.md
  why: h2.3 Issue 4 (BUG-012) reproduction steps; h2.38 state machine (terminal-until-re-upsert) referenced via item description
```

### Current Codebase tree (relevant excerpt)

```bash
src/
  fallback.ts        # recordAnswers (this task's main edit)
  fallback.test.ts   # recordAnswers tests (extend/update)
  tool.ts            # record case result lines (small edit)
  state.ts           # QuestionStatus, applyAnswer (read-only)
  depends-on.ts      # SKIP_EVALUATION precedent (read-only)
```

### Desired Codebase tree

```bash
# No new files — edits only in fallback.ts, fallback.test.ts, tool.ts
# (one tool.test.ts record-case test optional if the harness covers non-TUI record)
```

### Known Gotchas of our codebase

```ts
// applyAnswer has NO status guard by design — recordAnswers is the gate here.
// 'moot' is terminal-until-re-upsert like 'withdrawn' (state-and-persistence §1);
// 'closed' reopens ONLY via re-upsert with rev+1 — never via answers[].
// takeSnapshot BEFORE bumpEpoch (ring labels the epoch being LEFT) — preserve order.
// Zero-recorded calls now have ZERO side effects (no snapshot, no epoch bump).
// P1.M2.T3.S1 (parallel) touches src/panel/actions.ts submit only — zero overlap.
// P1.M3.T2.S1 will build on the new return shape (markSubmitted on recorded) —
//   do not add markSubmitted here.
```

## Implementation Blueprint

### Data models

No new models. Return type of `recordAnswers` widens to `{ recorded: string[]; unknown: string[]; ignored: string[] }`. Local const `TERMINAL_ANSWER_STATUSES: ReadonlySet<QuestionStatus>` in fallback.ts.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/fallback.ts — recordAnswers body
  - ADD: TERMINAL_ANSWER_STATUSES set; ignored bucket; status check between the unknown check and applyAnswer
  - MOVE: takeSnapshot + bumpEpoch inside `if (recorded.length > 0)`
  - FOLLOW: existing loop structure and tolerant patterns in the same function
Task 2: EDIT src/fallback.ts — JSDoc (Mode A)
  - REWRITE docstring: truthful behavior (answered-pending only, no markSubmitted), three buckets, conditional epoch rule, keep guard-ordering paragraph
Task 3: EDIT src/tool.ts — record case
  - DESTRUCTURE ignored; append `not recordable (moot/withdrawn/closed): ...` line when non-empty, positioned with the other advisory lines
Task 4: EDIT src/fallback.test.ts
  - UPDATE: existing toEqual assertions to include ignored: [] (three-ish call sites in describe("recordAnswers"))
  - UPDATE: any test asserting epoch/snapshot movement for all-unknown calls → now asserts NO side effects
  - ADD tests: withdrawn id ignored & untouched; moot ignored; closed ignored; mixed call (recorded+ignored+unknown) one snapshot/one bump; fully-ignored call zero side effects; answers to ignored ids never appear in snapshot
  - ADD (optional, if tool.test.ts covers non-TUI record): result content contains the not-recordable line
Task 5: VALIDATE — npm run typecheck && npm test
```

### Implementation Patterns & Key Details

Shown in full in the What section above — the exact loop and conditional side-effect tail. Key ordering inside the loop: `unknown check → terminal check → apply`.

### Integration Points

```yaml
CONSUMERS:
  - src/tool.ts record case (this task): surfaces ignored in result text
  - P1.M3.T2.S1 (next): adds markSubmitted(panel-state equivalent) on the recorded bucket for BUG-004
DO NOT TOUCH:
  - state.ts applyAnswer (no terminal guard there)
  - panel accept path (already correct)
  - delivery.ts / actions.ts (P1.M2.T3.S1 territory)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # zero errors — the widened return type must compile against tool.ts
```

### Level 2: Unit Tests

```bash
npx vitest run src/fallback.test.ts src/tool.test.ts
npm test            # full suite green
```

### Level 3: Bug-report repro (non-TUI probe)

```bash
# tsx probe mirroring the bug report steps:
# 1. upsert q1,q2  2. withdraw q1 via upsert omitting it
# 3. executeInterrogate({answers:[{id:"q1",value:"x"}], epoch}, non-TUI ctx)
# EXPECT: q1.status === "withdrawn" (unchanged), result content contains
# "not recordable (moot/withdrawn/closed): q1", state.epoch unchanged.
```

## Final Validation Checklist

- [ ] `npm test` + `npm run typecheck` green
- [ ] BUG-012 repro passes (no resurrection; visible ignored line)
- [ ] Epoch burned only when something recorded (assert in tests)
- [ ] Docstring truthful; guard-ordering paragraph preserved
- [ ] No changes outside fallback.ts / tool.ts record case / their tests
- [ ] Return shape ready for P1.M3.T2.S1 (recorded bucket, no markSubmitted yet)

## Anti-Patterns to Avoid

- ❌ Don't add a terminal guard inside `state.applyAnswer` — wrong layer; panel paths depend on current semantics
- ❌ Don't snapshot/bump on zero-recorded calls
- ❌ Don't throw on ignored ids — tolerant bucket pattern throughout
- ❌ Don't reuse depends-on.ts's SKIP_EVALUATION (different concept)
- ❌ Don't implement markSubmitted (P1.M3.T2.S1's scope)

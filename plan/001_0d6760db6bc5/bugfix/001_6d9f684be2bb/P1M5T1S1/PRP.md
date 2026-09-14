# PRP — P1.M5.T1.S1: reconstruct.ts replaySubmission: prefer DiffEntry.value, tolerate legacy

---

## Goal

**Feature Goal**: Fix BUG-007's reconstruction half: `replaySubmission` in `src/reconstruct.ts` must apply the RAW answer value (`DiffEntry.value`, landed by P1.M2.T2.S1) instead of the label-preferred display summary (`DiffEntry.to`), falling back to `to` only for legacy history written before the `value` field existed. After restart, reconstructed `answer.value`s are canonical, so dependsOn evaluation (`evaluateDependsOn`) and the completion record's ★-recommendation check operate on real values (AC-9).

**Deliverable**:
- `src/reconstruct.ts` — ~4-line logic change inside `replaySubmission` (~lines 279–296) + updated "Best-effort" comment ([Mode A] doc contract).
- `src/reconstruct.test.ts` — new tests using existing branch-fixture conventions.

**Success Definition**: The PRD h3.6 repro passes: reconstruct from `[toolResult(details.state), custom_message(details of submission with changed[].value='b', to='Beta')]` yields `q1.answer.value === 'b'` and `q2` (dependsOn q1 equals 'b') status `'open'` — not `'Beta'` + moot.

## User Persona

**Target User**: The pi user who restarts/resumes a session mid-interrogation.
**Use Case**: User answered and submitted after the last interrogate tool result (the normal case — model replies to submissions without an interrogate call), then restarted pi.
**User Journey**: restart → session_start reconstruction → panel reopens with the EXACT canonical answers; conditional questions show correct moot/open state.
**Pain Points Addressed**: answers silently corrupted to display labels after restart; questions wrongly greyed moot; wrong values in the read digest and completion record.

## Why

- BUG-007 (h3.6, Major): replay of submission deltas applies `entry.to` — the option LABEL — as `answer.value`. Any question whose label differs from its value restores wrong on restart.
- Foundation already landed: P1.M2.T2.S1 added `value?: string` (raw post-change `answer.value`) to `DiffEntry` in `src/snapshots.ts`, and P1.M2.T3.S1 filtered agent-resets out of new shipped deltas — this task consumes those outputs.
- History is UNTRUSTED: entries written before P1.M2.T2.S1 carry NO `value`; the label fallback stays deliberately (best-effort, commented legacy tolerance).

## What

In `replaySubmission` (src/reconstruct.ts ~279–296):

- Resolve the answer value as `entry.value` when it is a non-empty string, else `entry.to` (legacy).
- Skip the entry when the RESOLVED value is not a non-empty string or equals `UNANSWERED_SUMMARY` (`"(unanswered)"` const at ~line 134) — this preserves the existing answer-clearance skip and additionally guards a hypothetical legacy/edge entry where `value` is unset and `to` is the sentinel.
- Apply via `state.applyAnswer(id, { value: resolved, at: new Date().toISOString() })` — unchanged shape.
- Update the "Best-effort" comment (currently above the applyAnswer call) to describe the value-first / legacy-label-fallback rule ([Mode A] docs contract).
- Nothing else changes: position/epoch filtering, one `bumpEpoch()` per applied submission, the boolean return, and the single post-replay `evaluateDependsOn(state)` (~line 368) are untouched.

### Success Criteria

- [ ] New history (entry carries `value`): reconstructed `answer.value` === raw value, even when the label differs
- [ ] Legacy history (no `value`): falls back to `to` (existing best-effort behavior preserved)
- [ ] `(unanswered)` / empty resolved values are still skipped (no phantom answers; no epoch bump)
- [ ] h3.6 repro test passes: q1 value 'b', q2 open (not moot)
- [ ] Full existing test suite green

## All Needed Context

### Context Completeness Check

Verified by direct read of `src/reconstruct.ts` (lines ~120–380) and `src/snapshots.ts`: an agent with only this PRP has the exact current code shape, the DiffEntry contract, and the test conventions.

### Documentation & References

```yaml
- file: src/reconstruct.ts
  why: THE file to modify — replaySubmission (~279–296), UNANSWERED_SUMMARY (~134), the engine's replay loop + evaluateDependsOn (~360–370)
  pattern: tolerant entry guards (typeof checks) already in the loop; keep them
  gotcha: replaySubmission returns boolean (applied>0) and the caller counts `replayed` — don't change the signature; bumpEpoch stays inside replaySubmission

- file: src/snapshots.ts
  why: DiffEntry contract (landed by P1.M2.T2.S1) — `value?: string` is the RAW post-change answer.value, undefined when the post-change side is unanswered; line ~170 `value: after?.answer?.value`; displaySummary (~line 110) shows why `to` is a label for choice questions
  pattern: read-only reference — do NOT modify snapshots.ts
  gotcha: `"(unanswered)"` sentinel is snapshots-module-private; reconstruct deliberately duplicates it as UNANSWERED_SUMMARY with a sync-reference comment — keep that

- file: src/reconstruct.test.ts
  why: Test conventions — vitest; helpers makeCtx(entries, mode), makeHost(), makeOpts(host, drafts), seededState(mutator) for serialized base states; message entries carry details.state; submission entries carry SubmissionMessage-shaped details (customType "interrogation-submission")
  pattern: build real changed arrays [{id, from, to, value}] — no snapshot mocks
  gotcha: entries are walked newest-to-oldest / position-filtered — place the toolResult BEFORE the custom_message in the branch fixture (see existing base-selection tests)

- file: src/state.ts
  why: applyAnswer(id, {value, at}) canonical write; state.epoch; bumpEpoch(); Question shape (options value/label, dependsOn, status)
  pattern: read-only reference

- file: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/prd_snapshot.md (h3.6)
  why: The exact repro scenario that becomes the acceptance test
  critical: q1 (value 'b'/label 'Beta') + q2 dependsOn q1 equals 'b'; baseline toolResult(details.state) + custom_message(details of submission with changed[].value='b') → q1.answer.value === 'b', q2 open
```

### Current Codebase tree (relevant slice)

```bash
src/
  reconstruct.ts        # MODIFY — replaySubmission value-first resolution + comment
  reconstruct.test.ts   # EXTEND — value-preferred, legacy fallback, skip, h3.6 repro tests
  snapshots.ts          # READ-ONLY — DiffEntry.value contract (P1.M2.T2.S1, landed)
  delivery.ts           # READ-ONLY — SubmissionMessage shape (details.changed, details.epoch)
  state.ts              # READ-ONLY — applyAnswer/bumpEpoch/dependsOn semantics
```

### Desired Codebase tree

```bash
# No new files — surgical modification + tests only.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: `value: undefined` on a DiffEntry is MEANINGFUL (post-change unanswered) —
//   the legacy fallback to `to` must only run when value is not a non-empty string, and
//   the UNANSWERED_SUMMARY check must apply to the RESOLVED value, not just `to`.
// CRITICAL: do not add imports from snapshots.ts for the sentinel — reconstruct.ts
//   deliberately duplicates it (sync-reference comment at the const).
// CRITICAL: one bumpEpoch per applied submission (h3.6) — the existing placement
//   inside replaySubmission stays.
// CRITICAL: entries with unknown ids are skipped (existing `state.getQuestion(id) === undefined`
//   guard) — keep it before value resolution.
// CRITICAL: history is untrusted — every field access stays typeof-guarded; a malformed
//   entry degrades to skip, never throws (session_start must not crash).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/reconstruct.ts — replaySubmission
  - REPLACE the value resolution:
      const to = entry.to;
      if (typeof to !== "string" || to === "" || to === UNANSWERED_SUMMARY) continue;
      ... applyAnswer(id, { value: to, ... })
    WITH:
      const raw = entry.value;
      const resolved =
        typeof raw === "string" && raw !== "" ? raw : entry.to;
      if (typeof resolved !== "string" || resolved === "" || resolved === UNANSWERED_SUMMARY) continue;
      state.applyAnswer(id, { value: resolved, at: new Date().toISOString() });
  - UPDATE the "Best-effort" comment above the applyAnswer call: describe value-first
    (DiffEntry.value — raw answer.value since P1.M2.T2.S1) with legacy fallback to the
    label-preferred display summary `to` for history written before the field existed
    ([Mode A] doc contract)
  - PRESERVE: unknown-id skip, boolean return, bumpEpoch placement, epoch/position filtering

Task 2: EXTEND src/reconstruct.test.ts
  - TEST value-preferred (h3.6 repro): seededState with q1 (options value 'b'/label 'Beta')
    and q2 dependsOn [{id:'q1', equals:'b'}] both open; branch = [toolResult entry carrying
    details.state, submission entry with details.changed = [{id:'q1', from:'(unanswered)',
    to:'Beta', value:'b'}] and a valid details.epoch]; assert reconstructFromBranch →
    q1.answer.value === 'b' AND q2.status === 'open' (evaluateDependsOn ran on the raw value)
  - TEST legacy fallback: same fixture but entry WITHOUT `value` → q1.answer.value === 'Beta'
    (documented tolerance; assert the fallback is exercised, not the corruption)
  - TEST skip semantics: entry with value undefined + to '(unanswered)' → no answer applied,
    replayed count reflects it, epoch not bumped for it
  - TEST value-present-but-empty string ('') → falls back to `to` (resolution rule, not error)
  - FOLLOW pattern: existing describe blocks + makeCtx/makeHost/makeOpts/seededState helpers;
    NAMING: test("replay prefers raw value over label summary", ...) style matching the file
  - PLACEMENT: new describe block "reconstructFromBranch — submission replay values (BUG-007)"

Task 3: VERIFY no regressions
  - npx tsc --noEmit && npx vitest run
```

### Implementation Patterns & Key Details

```typescript
// The resolved-value rule (the whole change):
const raw = entry.value;                                    // raw answer.value (may be undefined)
const resolved = typeof raw === "string" && raw !== "" ? raw : entry.to; // legacy label fallback
if (typeof resolved !== "string" || resolved === "" || resolved === UNANSWERED_SUMMARY) continue;
state.applyAnswer(id, { value: resolved, at: new Date().toISOString() });
// Comment update: value-first since DiffEntry.value (P1.M2.T2.S1); `to` (label-preferred
// display summary) only for legacy history predating the field — best-effort, may restore
// a label when labels differ; new history is exact.
```

### Integration Points

```yaml
NO new integration points. Consumes:
  - DiffEntry.value — src/snapshots.ts (landed, read-only)
  - SubmissionMessage.details.changed — src/delivery.ts shape (read-only)
Unchanged: reconstruct engine flow, state mutations, panel auto-open.
Parallel task P1.M4.T2.S1 (keys.ts focusText gating) shares no files — no coordination needed.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npx tsc --noEmit
# Expected: zero errors.
```

### Level 2: Unit Tests

```bash
npx vitest run src/reconstruct.test.ts
npx vitest run            # full suite — zero regressions
# Expected: all pass, including the four new tests.
```

### Level 3: Scenario validation (scripted in tests)

```bash
npx vitest run src/reconstruct.test.ts -t "BUG-007"   # h3.6 repro: value 'b', q2 open
```

The h2.6/h3.6 repro (tsx probe style) is fully covered by the Task 2 fixture test; no live TUI run needed — reconstruction is pure + fixture-driven.

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` full suite green
- [ ] No files modified beyond `src/reconstruct.ts` + `src/reconstruct.test.ts`

### Feature Validation

- [ ] Value-carrying entries replay the RAW value (labels never win when value present)
- [ ] Legacy entries (no value) still replay via `to` — tolerance intact and commented
- [ ] Unanswered/reset entries still skipped; epoch bumped only per applied submission
- [ ] h3.6 repro passes: q1 'b', q2 open, not moot
- [ ] dependsOn and ★-checks now operate on real values post-restart

### Code Quality Validation

- [ ] Tolerant untrusted-input guards preserved (typeof checks, no throws)
- [ ] [Mode A] comment updated (value-first / legacy-fallback rule documented)
- [ ] Sentinel duplication + sync-reference comment preserved

## Anti-Patterns to Avoid

- ❌ Don't import the sentinel from snapshots.ts — the deliberate duplication stays
- ❌ Don't change replaySubmission's signature, return semantics, or bumpEpoch placement
- ❌ Don't filter/validate against current question options (value need not match any option — text answers and edited-archived cases)
- ❌ Don't mock snapshots/computeDiff in tests — build real `changed` arrays
- ❌ Don't drop the legacy fallback — history before P1.M2.T2.S1 has no `value`

---

**Confidence Score**: 9/10 — the change is ~4 lines in one function whose exact current code, the landed DiffEntry contract, and the test conventions were all read directly; the only residual risk is fixture-construction detail in the new tests, mitigated by pointing at the existing helpers.

# PRP — Bugfix P1.M1.T1.S4: replaySubmission applies text/custom with legacy guards (src/reconstruct.ts)

## Goal

**Feature Goal**: Consumer half of BUG-001's fix (PRD h3.0, Recommendation 1, item 3): `replaySubmission` (src/reconstruct.ts:420-441) must apply the elaboration (`text`) and write-in marker (`custom`) carried on DiffEntry entries — with STRICT guards so corrupt persisted values never leak into state — while keeping value-first resolution (BUG-007), the sentinel/clearance skip, the one-submission-one-epoch-bump rule (h3.6), and fresh-`at` behavior EXACTLY as-is. Legacy history entries carrying neither key must replay byte-identically to today.

**Deliverable**: Two conditional spreads inside the `state.applyAnswer(id, {...})` literal at src/reconstruct.ts:439 + two comment-block updates (in-function BUG-007 comment :425-433, module JSDoc CAVEAT :57-61) + helper extensions (`diff`, `submissionEntry`) and a new `describe` with 5 tests in src/reconstruct.test.ts.

**Success Definition**:
- A replayed submission entry carrying `{value:"b", text:"because sqlite"}` restores `answer.text === "because sqlite"`; an entry carrying `{value:"<free text>", custom:true}` restores `answer.custom === true`
- Entries WITHOUT the keys (all legacy history) replay exactly as today — no `text`/`custom` keys materialize on the answer
- Clearance entries (`to === "(unanswered)"` sentinel) still skip entirely — even if stray text/custom keys are present on the entry
- Corrupt values (`text: 42`, `text: ""`, `custom: "yes"`) do NOT attach — the value still replays
- `at` timestamps remain NOT carried (fresh ISO per replay); `replayed` count and epoch-bump semantics unchanged
- `npm run typecheck` + `npm test` + `npm run lint` green; only `src/reconstruct.ts` + `src/reconstruct.test.ts` modified

## User Persona

**Target User**: The restarting user (SSH drop / hard kill / SIGKILL inside the 2s mirror debounce — or an appendEntry failure) whose branch reconstruction falls back to replaying submission deltas — plus the model whose read surface, ✎ markers, answer pinning, and completion record are built from replayed state.

**Use Case**: User answered q1 = option with elaboration "because sqlite" and q2 = ✎ Other write-in; the process died before the mirror flushed; the branch holds the tool-result base + submission entries (which, post S2+S3, carry `text`/`custom`). On restart, replaySubmission now restores the FULL answer shape instead of value-only.

**User Journey**: hard kill → restart → session_start reconstruction → base (tool result) installed → submission deltas replayed with `{value, text?, custom?}` → read surface shows elaboration lines (TRUST-001), ✎ markers restored (WRITEIN-001), caret pins to the ✎ Other row (ANSWER-PIN-001), completion record carries the elaboration (FR-5, delivery.ts:373/:469).

**Pain Points Addressed**: user-authored words vanishing from every model-visible surface; replayed write-ins LOOKING replaced by the first option (caret clamp to row 0); the one-time completion record permanently omitting elaborations.

## Why

- BUG-001 (PRD h2.2/h3.0): reconstruction replays submission deltas value-only, silently dropping `answer.text` and `answer.custom` whenever the debounced full-state mirror missed its flush window. S2 (merged) extended the DiffEntry carrier + producer A; S3 (parallel) extends producer B (panel seam); THIS subtask is the consumer that makes the carried fields reach state — without it, S2/S3's data is dead weight on the wire.
- `applyAnswer` (state.ts:379-387) does `q.answer = { ...answer }` — passing the fields through in the literal is the entire fix; no state.ts change needed or allowed.
- The state.ts deserialize precedent (:595-596) guards untrusted persisted data with `typeof === "string"` / `=== true` — session files are untrusted input; corrupt truthy values must not leak into state. The item contract tightens the text guard with a non-empty check, matching S2's producer convention (key present ONLY when non-empty).
- S5 (e2e regression: delivered submission reconstructs with full answer shape) consumes this change — S4 must land its unit coverage first so S5's e2e has a narrow failure surface.

## What

1. **src/reconstruct.ts:439** — in `replaySubmission`, the `state.applyAnswer(id, { value: resolved, at: new Date().toISOString() })` call becomes:
```ts
state.applyAnswer(id, {
  value: resolved,
  ...(typeof entry.text === "string" && entry.text !== "" ? { text: entry.text } : {}),
  ...(entry.custom === true ? { custom: true } : {}),
  at: new Date().toISOString(),
});
```
   Keys ABSENT (never `null`/`false`/`""`) when the entry lacks them — identical convention to S2's computeEntries spreads (snapshots.ts:321-322) and S3's seam spreads. NO other statement in `replaySubmission` changes: keep the unknown-id skip, value-first resolution (`resolved = typeof raw === "string" && raw !== "" ? raw : entry.to`), the sentinel check on the RESOLVED value, `applied++`, and `if (applied > 0) state.bumpEpoch()`.
2. **In-function BUG-007 comment (reconstruct.ts:425-433)** — currently ends: "`at` timestamps are not carried in deltas either. See module JSDoc." Update to state: elaboration `text` and write-in `custom` ARE carried when the entry has them (BUG-001; strict guards — persisted data is untrusted, state.ts deserialize precedent); answer `at` timestamps are STILL not carried. Keep the value-first/legacy-fallback sentences intact.
3. **Module JSDoc CAVEAT (reconstruct.ts:57-61)** — "CAVEAT: entries replay VALUE-FIRST — ... answer `at` timestamps are not carried." Extend with: elaboration `text` / write-in `custom` are carried when present (BUG-001, strict guards); `at` still is not. ([Mode A] both comment updates ride WITH the change.)
4. **Test harness extensions (src/reconstruct.test.ts)** — extend the module-scope helpers so fixture entries can carry the new keys:
   - `diff(id, to, value?)` (:138-144) gains a trailing `extra?: { text?: string; custom?: boolean }` object spread into the returned literal, and its inline return type gains `text?: string; custom?: boolean`. CRITICAL: spread `...extra` (keys ABSENT when not passed) — never unconditional `text`/`custom` keys.
   - `submissionEntry(details)` (:115-136): add `text?: string; custom?: boolean` to the inline `changed` Array element type (otherwise new tests won't compile).
5. **New describe in src/reconstruct.test.ts** — `describe("reconstructFromBranch — submission replay fidelity (BUG-001)")` placed immediately after the BUG-007 describe (ends :1003, before the BUG-008 describe :1004), with a LOCAL `branchWithSubmission(changed)` helper copying the existing one at :945-958 (base seeds q1 = choice `{value:"b", label:"Beta"}` + q2 = choice on the same options; entries = `[toolResultEntry(base), submissionEntry({changed, epoch:1})]`; returns `{base, result, state: getState()!}`). Five tests (full specs in Blueprint): elaboration+write-in restore, text-only-edit restore, legacy value-only, clearance-skip with stray keys, corrupt-value guards.

### Success Criteria

- [ ] Replay of `{value:"b", text:"because sqlite"}` → `answer.text === "because sqlite"`, `"custom" in answer === false`, `typeof answer.at === "string"`
- [ ] Replay of `{value:"Neither — ...", custom:true}` → `answer.custom === true`, `"text" in answer === false`
- [ ] Text-only edit entry (same value, new text) → elaboration restored, `result.replayed === 1`, epoch bumped exactly once
- [ ] Legacy entry (no keys) → value-only answer; `"text" in answer === false && "custom" in answer === false`
- [ ] Clearance entry (`to:"(unanswered)"`, no value) with stray `text`/`custom` → entry skipped: `result.replayed === 0`, `answer === undefined`, epoch unchanged
- [ ] Corrupt entry (`text: 42`, `text: ""`, `custom: "yes"`) → nothing attaches; value still replays
- [ ] All 4 existing BUG-007 rows (:961/:971/:983/:993) green UNCHANGED
- [ ] `npm run typecheck` + `npm test` + `npm run lint` green; only `src/reconstruct.ts` + `src/reconstruct.test.ts` modified

## All Needed Context

### Context Completeness Check

S2 is MERGED in the working tree (verified: DiffEntry `text?: string`/`custom?: boolean` at snapshots.ts:132/:140, computeEntries spreads at :321-322), so `entry.text`/`entry.custom` already typecheck inside `replaySubmission` via `SubmissionMessage["details"].changed: DiffEntry[]` (delivery.ts:76) — NO cast changes needed in reconstruct.ts. S3 runs in parallel on `src/panel/actions.ts`/`actions.test.ts` — ZERO file overlap with S4 and NO runtime dependency (tests hand-build fixture entries; the S3 seam is exercised only by S5's e2e). Every quoted code block below was read verbatim from the working tree. An implementing agent needs this PRP plus `src/reconstruct.ts`, `src/reconstruct.test.ts`, and read-only `src/snapshots.ts` / `src/state.ts` / `src/delivery.ts`.

### Documentation & References

```yaml
- file: plan/006_45773b259b06/bugfix/001_3e88fb340e1d/architecture/bug001-submission-replay.md
  why: "§5 quotes replaySubmission verbatim and names it 'the bug'; fix-surface item 3 IS this subtask (guards specified); §'Test harness' documents every reconstruct.test.ts helper with line numbers; §'Size/caps risk — CLEARED' proves the payload growth that feeds this consumer is contract-safe"
  critical: "§1 proves applyAnswer's `{...answer}` shallow copy passes text/custom through — the fix is purely the two spreads in the literal"

- file: plan/006_45773b259b06/bugfix/001_3e88fb340e1d/P1M1T1S3/PRP.md
  why: "Producer-B contract (in parallel): the synthetic seam emits text/custom with the SAME conditional-spread convention S4 consumes; confirms disjoint files (actions.ts/actions.test.ts) — no merge conflict with S4"
  gotcha: "S3 also updates its own seam comment; S4 must NOT touch actions.ts"

- file: src/reconstruct.ts
  why: "THE file to modify. replaySubmission :420-441 (fix site :439); in-function BUG-007 comment :425-433; module JSDoc CAVEAT :57-61; caller at :565 (`if (replaySubmission(state, submission.details)) replayed++`); UNANSWERED_SUMMARY local const :196"
  pattern: "guard-then-continue defensive style for untrusted persisted entries (unknown-id skip, typeof guards, sentinel check on RESOLVED value)"
  gotcha: "do NOT reorder/alter value-first resolution or the sentinel check — BUG-007 tests :961-:1003 pin them; do NOT touch bumpEpoch semantics (h3.6)"

- file: src/reconstruct.test.ts
  why: "Test file to extend. Helpers: choiceQ :54, seededState :66, toolResultEntry :73, submissionEntry :115 (inline changed type needs text?/custom?), diff :138 (needs extra param), makeCtx :175, makeHost :193, makeOpts :200; MODEL describe (BUG-007) :939-1003 with local branchWithSubmission :945-958; new describe goes right after :1003"
  pattern: "local helper scoped inside describe; assert result.source/result.replayed/state getters; markAnswered(s, id, {value, at}) already imported from merge.js"
  gotcha: "diff() currently spreads nothing — extend with `...extra` so keys stay ABSENT for legacy rows; existing tests must stay green UNCHANGED"

- file: src/state.ts
  why: "READ-ONLY. applyAnswer :379-387 (`q.answer = {...answer}` — passthrough proof); QuestionAnswer :43-54 (`{value; text?; custom?; at}` — at REQUIRED string); strict-guard precedent :591-598 (`typeof === \"string\"` / `=== true` — 'corrupt truthy values must not leak into state')"
  gotcha: "applyAnswer THROWS on unknown id — replaySubmission's getQuestion guard already prevents that; never widen applyAnswer's signature"

- file: src/snapshots.ts
  why: "READ-ONLY post-S2. DiffEntry :88-141 (value? :117, text? :132 'Key present ONLY when a non-empty string', custom? :140); computeEntries spreads :321-322 — the exact convention S4's spreads mirror; answerSignature :166-175 (value+text — why text-only edits produce entries at all)"
  gotcha: "S2 owns this file — S4 must not touch it"

- file: src/delivery.ts
  why: "READ-ONLY context. SubmissionMessage :66-85 (`details.changed: DiffEntry[]` — why entry.text/entry.custom typecheck without casts); buildCompletion consumers :373 (`answer.custom === true → ✎ ${answer.value}`) and :469 (`q.answer?.text`) — the FR-5 record this fix feeds"
```

### Current Codebase tree (relevant excerpt)

```bash
src/
├── reconstruct.ts          # :420-441 replaySubmission — MODIFY (2 spreads + 2 comments)
├── reconstruct.test.ts     # :115/:136 helper types, new describe after :1003 — MODIFY
├── snapshots.ts            # S2 owns (post-S2 DiffEntry) — DO NOT TOUCH
├── state.ts                # applyAnswer/deserialize — READ-ONLY
├── delivery.ts             # SubmissionMessage/buildCompletion — READ-ONLY
└── panel/actions.ts        # S3 owns (producer B) — DO NOT TOUCH
```

### Desired Codebase tree with files to be added

```bash
# No new files — MODIFY only:
src/reconstruct.ts          # +2 conditional spreads (:439), comment updates (:425-433, :57-61)
src/reconstruct.test.ts     # helper extensions (:115-:136, :138-:144) + new describe (~:1004, 5 tests)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: keys must be ABSENT, not null/false/"" — guard text with BOTH
//   typeof === "string" AND !== ""; custom with strict === true.
//   (Session files are UNTRUSTED persisted data — state.ts:595-596 precedent:
//   corrupt truthy values must not leak into state.)
// GOTCHA: entry.text/entry.custom are typed string?|boolean? via DiffEntry — the
//   guards typecheck with NO casts; only the CORRUPT-value TEST needs
//   `as unknown as string` casts to simulate hostile persisted data.
// GOTCHA: the sentinel check runs on the RESOLVED value BEFORE applyAnswer —
//   a clearance entry with stray text/custom is skipped WHOLE (text ignored);
//   do not move the spreads before the sentinel check.
// GOTCHA: `at` is required on QuestionAnswer — keep passing fresh
//   new Date().toISOString(); never read an `at` off the entry (not carried).
// GOTCHA: bumpEpoch is ONE per submission with applied>0 — adding fields to
//   the answer literal must not touch the applied counter or the return bool.
// GOTCHA: extending diff() with unconditional text/custom keys would break
//   legacy-row assertions ("text" in ...) — spread `...extra` only.
// GOTCHA: eslint covers src/ — keep the spread style on its own lines
//   matching snapshots.ts:321-322 formatting.
```

## Implementation Blueprint

### Implementation Tasks (dependency-ordered, TDD-friendly)

```yaml
Task 0: PRECONDITION CHECK
  - Confirm S2 merged: src/snapshots.ts DiffEntry declares text?:string (~:132)
    and custom?:boolean (~:140) and computeEntries spreads them (:321-322).
    If absent, STOP — S4's spreads typecheck against S2's interface.

Task 1: EXTEND test helpers in src/reconstruct.test.ts
  - submissionEntry (:115): add `text?: string; custom?: boolean;` to the inline
    changed-element type (after `value?: string;`).
  - diff (:138-144): add trailing param `extra?: { text?: string; custom?: boolean }`,
    spread it (`...extra`) into the returned literal, and extend the inline
    return type with `text?: string; custom?: boolean`. Existing call sites are
    unaffected (extra omitted → keys ABSENT — verify by the untouched legacy rows).

Task 2: ADD failing tests — new describe right after :1003
  - Local helper branchWithSubmission(changed) copying :945-958, but seeding BOTH
    q1 and q2 as choice questions on `{value:"b", label:"Beta"}` (q2 as plain
    second choice — it receives the write-in; no dependsOn needed for these rows):

  - TEST 1 "elaboration and write-in markers replay from a submission delta":
      changed = [
        diff("q1", "Beta — because sqlite", "b", { text: "because sqlite" }),
        diff("q2", "✎ Neither — we use a custom vector store",
             "Neither — we use a custom vector store", { custom: true }),
      ]
      expect(result.source).toBe("tool-result"); result.replayed === 1;
      state.epoch === base.epoch + 1;
      q1.answer.value === "b"; q1.answer.text === "because sqlite";
      "custom" in q1.answer === false; typeof q1.answer.at === "string";
      q2.answer.value === "Neither — we use a custom vector store";
      q2.answer.custom === true; "text" in q2.answer === false.

  - TEST 2 "text-only elaboration edit (same value, new text) restores the elaboration":
      base seeds q1 ALREADY answered: markAnswered(s, "q1", { value: "b", at: "t0" })
      (inside the local helper's seededState build for this row — or seed inline);
      changed = [diff("q1", "Beta — new reason", "b", { text: "new reason" })];
      result.replayed === 1; q1.answer.value === "b"; q1.answer.text === "new reason".

  - TEST 3 "legacy entries without text/custom replay exactly as before":
      changed = [diff("q1", "Beta", "b")];
      q1.answer.value === "b"; "text" in answer === false; "custom" in answer === false.
      (Distinct from :971 which tests the value-legacy fallback; this pins key-absence.)

  - TEST 4 "clearance entries still skip — stray text/custom ignored":
      changed = [diff("q1", "(unanswered)", undefined, { text: "stray", custom: true })];
      result.replayed === 0; q1.answer === undefined; state.epoch === base.epoch.

  - TEST 5 "corrupt text/custom values do not leak into state (strict guards)":
      const hostile = { ...diff("q1", "Beta", "b"),
        text: 42 as unknown as string, custom: "yes" as unknown as boolean };
      changed = [hostile, diff("q2", "Beta — x", "b", { text: "" })];  // "" must not attach either
      q1.answer.value === "b" (value still replays); q1.answer.text === undefined;
      "custom" in q1.answer === false; q2.answer.text === undefined.

Task 3: MODIFY src/reconstruct.ts:439 — the two spreads (see What §1)
  - Insert between `value: resolved,` and `at: new Date().toISOString(),`:
      ...(typeof entry.text === "string" && entry.text !== "" ? { text: entry.text } : {}),
      ...(entry.custom === true ? { custom: true } : {}),
  - NOTHING else in the function changes.

Task 4: UPDATE the two comment blocks ([Mode A])
  - :425-433 in-function: rewrite the trailing sentences to "Elaboration `text`
    and write-in `custom` ARE carried when the entry has them (BUG-001 — strict
    guards; persisted data is untrusted, state.ts deserialize precedent).
    Answer `at` timestamps are still not carried. See module JSDoc."
    (value-first/legacy-fallback sentences unchanged).
  - :57-61 module JSDoc CAVEAT: extend with text/custom carried (BUG-001,
    strict guards); `at` still not carried.

Task 5: RUN gates (see Validation Loop)
```

### Implementation Patterns & Key Details

```ts
// The fixed apply site (src/reconstruct.ts:439 — everything around it unchanged):
state.applyAnswer(id, {
  value: resolved,
  // BUG-001 consumer half: carry the elaboration / write-in marker when the
  // entry has it. STRICT guards — session files are untrusted persisted data
  // (state.ts:595-596 deserialize precedent): a corrupt truthy `custom` or a
  // non-string/empty `text` must NOT leak into state. Keys stay ABSENT for
  // legacy entries (identical convention to the producers: snapshots.ts
  // computeEntries, panel actions.ts seam — BUG-001 producer halves).
  ...(typeof entry.text === "string" && entry.text !== "" ? { text: entry.text } : {}),
  ...(entry.custom === true ? { custom: true } : {}),
  at: new Date().toISOString(), // still fresh — `at` is never carried in deltas
});
applied++;

// The extended diff() helper (src/reconstruct.test.ts:138-144):
function diff(
  id: string,
  to: string,
  value?: string,
  extra?: { text?: string; custom?: boolean },
): { id: string; title: string; from: string; to: string; editedArchived: boolean;
     value?: string; text?: string; custom?: boolean } {
  return { id, title: id, from: "(unanswered)", to, editedArchived: false, value, ...extra };
}

// WHY strict guards matter here (the corrupt-data threat): reconstruction reads
// whatever is in the session file; a hand-edited/corrupted entry with
// custom:"yes" or text:42 would otherwise serialize straight into state and
// poison every downstream render (✎ markers, completion record). The
// state.ts:595-596 precedent exists for exactly this reason; test 5 pins it.
```

### Integration Points

```yaml
STATE: "NONE — applyAnswer's {...answer} already passes optional fields through;
  state.ts is untouched"
CARRIERS: "NONE — S2 (merged) extended DiffEntry/computeEntries; S3 (parallel)
  extends the actions.ts seam; S4 must not touch snapshots.ts or panel/actions.ts"
DOWNSTREAM (transitive, no code changes): "read surface/digest elaboration lines
  (TRUST-001), ANSWER-PIN-001 ✎ Other row pinning, buildCompletion delivery.ts
  :373/:469 (FR-5 record), S5 e2e regression (next subtask)"
DOCS: "[Mode A] the two reconstruct.ts comment blocks ride WITH the change — no
  other docs work in this subtask (README sweep is P1.M3.T2)"
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # tsc --noEmit — 0 errors (guards typecheck via post-S2 DiffEntry)
npm run lint        # eslint src scripts *.ts — 0 errors
```

### Level 2: Unit Tests (the new + existing rows)

```bash
npx vitest run src/reconstruct.test.ts -v
# Expected: ALL existing rows green (esp. BUG-007 describe :939-1003 UNCHANGED)
# + the 5 new BUG-001 rows green
```

### Level 3: Full Suite (zero regressions)

```bash
npm test   # full suite (1624+ tests) — must stay green; S3's parallel work may
           # also be landing in panel tests — a failure there is NOT this subtask's
```

### Level 4: Diff review (manual)

- [ ] `git diff src/reconstruct.ts` touches ONLY: the applyAnswer literal (+2 spread lines + optional comment), the :425-433 comment block, the :57-61 JSDoc caveat
- [ ] `git diff src/reconstruct.test.ts` touches ONLY: the two helper signatures/types + the new describe block
- [ ] No changes to value-first resolution, sentinel skip, `applied`/`bumpEpoch`/return semantics

## Final Validation Checklist

### Technical Validation

- [ ] All 4 validation levels completed; `npm run typecheck`, `npm test`, `npm run lint` green
- [ ] S2 precondition confirmed (extended DiffEntry present) before starting

### Feature Validation

- [ ] Test 1 (elaboration + write-in restore), Test 2 (text-only edit), Test 3 (legacy key-absence), Test 4 (clearance skip w/ stray keys), Test 5 (corrupt guards) all green
- [ ] All 4 existing BUG-007 rows green UNCHANGED (no edits to :939-1003)
- [ ] `at` never read off entries; fresh ISO always passed
- [ ] Both comment blocks updated ([Mode A]): in-function BUG-007 block + module JSDoc CAVEAT

### Code Quality Validation

- [ ] Conditional-spread convention mirrors S2's computeEntries spreads exactly (keys absent, never null/false/"")
- [ ] Only `src/reconstruct.ts` + `src/reconstruct.test.ts` modified (NOT snapshots.ts / state.ts / delivery.ts / panel/actions.ts)
- [ ] Tests drive `reconstructFromBranch` with fixture entries via the existing helpers — nothing mocked, no real panel/delivery machinery needed

## Anti-Patterns to Avoid

- ❌ Don't attach `text: undefined` / `custom: false` / empty-string text — keys must be ABSENT
- ❌ Don't loosen the guards (`truthy` checks, `typeof entry.text === "string"` without the non-empty check) — corrupt persisted data must not leak
- ❌ Don't move the spreads before the sentinel/unknown-id checks — clearance entries skip WHOLE
- ❌ Don't carry `at` from the entry or touch bumpEpoch/applied/return semantics — h3.6 invariants are pinned by existing tests
- ❌ Don't touch snapshots.ts (S2), panel/actions.ts (S3), state.ts, or delivery.ts
- ❌ Don't extend diff() with unconditional text/custom keys — legacy rows assert key-absence
- ❌ Don't "fix" the existing BUG-007 tests to accommodate the change — they must pass unchanged

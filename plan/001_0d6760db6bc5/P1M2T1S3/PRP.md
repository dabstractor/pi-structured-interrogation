---
name: "P1.M2.T1.S3 — Completion record builder (the one full injection) (delivery.ts: buildCompletion)"
description: "Add to src/delivery.ts an exported, pure, unit-testable `buildCompletion(state, notes?)` that turns the full InterrogationState into the pi.sendMessage payload `{customType: 'interrogation-completion', content: the h2.46 record VERBATIM, display: true, details: recap card data}`. This is the ONE full record injection (core commitment h2.0 §2); per-request injection is forbidden (h2.4). NO transport (S2's deliverSubmission carries it), NO state mutation, NO clearForCompletion (lifecycle P1.M2.T2.S2 owns clearing). Include Mode A JSDoc quoting the record format."
---

## Goal

**Feature Goal**: Produce the completion message — the single full Q&A record the model receives exactly once when the interrogation completes (commitment 2, Q30). Content is the h2.46 record format verbatim; details carries the structured recap card data for the user-only renderer (P1.M7.T3.S2).

**Deliverable**: In `src/delivery.ts`:

```ts
export interface CompletionRecapEntry {
  id: string;              // question id
  title: string;           // title ?? prompt
  answer: string;          // label-preferred summary; "(unanswered)" if none
  star: boolean;           // answer.value === q.recommendation
  freeText?: string;       // answer.text (key omitted when absent/empty)
  answeredAt?: string;     // answer.at ISO timestamp (omitted when unanswered)
}
export interface CompletionRecapGroup {
  group: string;           // q.group ?? UNGROUPED_LABEL
  questions: CompletionRecapEntry[]; // order[] order within group
}
export interface CompletionMessage {
  customType: "interrogation-completion";
  content: string;         // h2.46 record, VERBATIM
  display: true;
  details: {
    goal: string;
    groups: CompletionRecapGroup[];   // first-appearance order
    notes: string[];                  // batch notes in order (may be [])
    withdrawnMoot: Array<{ id: string; status: "withdrawn" | "moot"; reason: string }>;
    completedAt: string;              // ISO timestamp of record build
    epoch: number;                    // state.epoch at build time
  };
}
export function buildCompletion(state: InterrogationState, notes?: string[]): CompletionMessage;
```

plus `src/delivery.test.ts` additions covering the record format byte-exactly, grouping/order, ★ marks, withdrawn/moot reasons, notes, and purity (no snapshot/bump/clear).

**Success Definition**: `npm test` + `npm run typecheck` green; content matches h2.46 exactly (header line, grouped per-question lines, NOTES line, Withdrawn/moot line); `SendableMessage` (S2's alias) widened to `SubmissionMessage | CompletionMessage` so `deliverSubmission` can carry it unchanged.

## User Persona

**Target User**: The LLM agent — it writes the final spec FROM this record (Q30, commitment 2: "the model writes the spec from it"). Secondarily the TUI user, whose recap card is rendered from `details` by P1.M7.T3.S2.

**Use Case**: Last open question closes (agent_settled, no re-ask, h3.9); the completion trigger (P1.M2.T2.S2) calls `buildCompletion(state, notes)` then `deliverSubmission(pi, msg, ctx)`; lifecycle then dismisses the panel and clears state (keeping entries for audit).

**User Journey**: agent_settled → trigger collects batch notes → `buildCompletion` → `deliverSubmission` → model sees the full record once and writes the deliverable → user sees the recap card (from details).

**Pain Points Addressed**: Context bloat — the model has only seen ≤3-line deltas until now; this is the single, deliberate full injection so it can author the final spec without re-reading everything.

## Why

- h2.0 commitment §2: "The full record is injected into the conversation exactly once, at completion. Per-request context injection is explicitly forbidden (user veto)." This builder is that one injection's producer.
- h2.46 names the record format and states: "`content` is this record verbatim — the model writes the spec from it (commitment 2, Q30)."
- h3.9 completion flow: `delivery.ts: sendMessage customType "interrogation-completion"` with `content = full Q&A record` and `details = recap card data`.
- Consumers: P1.M2.T2.S2 (completion trigger — calls buildCompletion + deliverSubmission + clearForCompletion) and P1.M7.T3.S2 (recap card renderer — reads `details`; h2.36: "goal, every question with final answer (grouped), timestamps; `expanded` shows withdrawn/moot with reasons").

## What

`buildCompletion(state, notes?)`:

1. **Header line**: `INTERROGATION COMPLETE — {state.goal}` (em-dash, exactly one space each side).
2. **Question lines, grouped, in `order[]` order**: iterate `state.orderedQuestions()`; group key is `q.group ?? UNGROUPED_LABEL` (`"(none)"`, exported from state.ts); groups appear in first-appearance order; questions within a group stay in `order[]` order. Line per question (ALL questions regardless of status, h2.46 "every question, grouped, in order"):
   `[group] {id} {title}: {answer} {★?} {— freeText?}`
   - `title` = `q.title ?? q.prompt`.
   - `answer` = label-preferred summary: choice → option label whose `value === answer.value` (fallback: raw value); text → raw `answer.value`; no answer → `(unanswered)`. (Replicate snapshots.ts's private `answerSummary` rule locally — do NOT import a private.)
   - `★` appears (single space-separated token) iff `q.recommendation !== undefined && q.answer?.value === q.recommendation`.
   - `{— freeText}` appears iff `q.answer?.text` is a non-empty string: ` — {text}` (space, em-dash, space, text).
   - Group label is printed on EVERY question line (h2.46 shows `[group]` per line), not as standalone headers.
3. **NOTES line**: `NOTES: {n1}; {n2}; …` — joined with `"; "` from the `notes` argument in order. When `notes` is undefined/empty: `NOTES: (none)` (line is always present — h2.46 format shows it unconditionally). Batch notes are NOT stored in state (S1 passes note only in message details), so the completion trigger (P1.M2.T2.S2) collects and passes them here.
4. **Withdrawn/moot line**: `Withdrawn/moot: {ids + reasons}` — entries from `orderedQuestions()` filtered to `status === "withdrawn"` or `status === "moot"`, in order. Entry format: `{id} ({status}: {reason})`.
   - Withdrawn reason: the fixed string `withdrawn` (merge.ts WithdrawalInfo) → `{id} (withdrawn: withdrawn)` reads poorly, so use reason `"omitted by agent"` for withdrawn questions (documented mapping of merge.ts's fixed reason). 
   - Moot reason: computed fresh via `evaluateDependsOn(state).mootered` (reasons are NOT persisted on Question); map `MootReason.reason` (e.g. `moot: storage=sqlite`) → `{id} (moot: moot: storage=sqlite)` is doubled, so strip the leading `moot: ` prefix from the reason before formatting → `{id} (moot: storage=sqlite)`. If a moot question has no matching `MootEvaluation` entry, use reason `dependency unmet`.
   - None present → `Withdrawn/moot: (none)` (line always present).
5. **Purity contract**: no `takeSnapshot`, no `bumpEpoch`, no `clearForCompletion`, no event emissions, no mutation of `state` or its stored questions. `completedAt` = `new Date().toISOString()` at build; `details.epoch` = `state.epoch`.
6. **Type widening**: change S2's `SendableMessage` alias to `SubmissionMessage | CompletionMessage` (one line; S2's PRP explicitly reserves it as "the single widening point"). If S2 has not landed yet, define the alias yourself in S2-specified form and widen it.
7. **JSDoc (Mode A, contract point 5)**: quote the h2.46 record format verbatim in the doc comment, document the exact line grammars, the notes-collection responsibility split with P1.M2.T2.S2, the withdrawn/moot reason derivation, and that delivery is S2's `deliverSubmission`.

### Success Criteria

- [ ] `content` for a fixture state matches the expected h2.46 record byte-for-byte (test with a golden string)
- [ ] `display: true`, `customType: "interrogation-completion"` exactly
- [ ] Groups in first-appearance order; questions in `order[]` order; ALL questions included (open/unanswered included with `(unanswered)`)
- [ ] ★ iff answer value equals recommendation; ` — text` iff non-empty free text
- [ ] NOTES line always present; joins notes in order with `"; "`; `(none)` when empty
- [ ] Withdrawn/moot line always present; reasons per the mapping above; `(none)` when empty
- [ ] details carries goal, groups, notes, withdrawnMoot, completedAt, epoch
- [ ] No state mutation: `state.serialize()` before === after; `snapshots.length` unchanged; `state.epoch` unchanged
- [ ] `SendableMessage` widened to the union; existing `deliverSubmission`/`buildSubmission` tests still pass
- [ ] `npm test` + `npm run typecheck` green

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets: the exact record grammar (h2.46 quoted), the exact input types (state.ts Question/answer fields), the label-preference rule (replicated from snapshots.ts since it's private), the moot-reason recomputation path, the notes-collection responsibility split with P1.M2.T2.S2, and the test conventions. No guessing about line formats or where reasons come from.

### Documentation & References

```yaml
- file: src/state.ts
  why: InterrogationState API — goal, epoch, orderedQuestions(), serialize(), snapshots; Question/QuestionAnswer field names; UNGROUPED_LABEL export
  pattern: reads only; NEVER call clearForCompletion/bumpEpoch/takeSnapshot here
  gotcha: orderedQuestions() returns stored objects — do not mutate; group via q.group ?? UNGROUPED_LABEL

- file: src/snapshots.ts
  why: answerSummary label-preference rule to replicate (it is module-private — copy the logic, cite it in a comment); Snapshot type
  pattern: choice → label for value (fallback raw), text → raw value, missing → "(unanswered)"
  gotcha: do NOT import internals; do NOT use computeDiff here (wrong shape — it diffs two states)

- file: src/depends-on.ts
  why: evaluateDependsOn(state).mootered — the ONLY source of moot reasons (not persisted on Question)
  pattern: MootReason {id, reason: "moot: dep=value"}; strip "moot: " prefix for the record line
  gotcha: withdrawn/closed questions are never in mootered; call once, build a Map<id, reason>

- file: src/delivery.ts  (S1 landed; S2 arriving in parallel — CONTRACT)
  why: append buildCompletion to this same file; follow existing JSDoc/export style; widen S2's SendableMessage alias
  pattern: SUBMISSION_LIST_MAX_CHARS-style exported consts + Mode A JSDoc
  gotcha: buildCompletion is PURE — unlike buildSubmission it does NO snapshot/bump side effects (completion is not a submission; the epoch is frozen at completion)

- file: plan/001_0d6760db6bc5/P1M2T1S2/PRP.md
  why: S2 contract — SendableMessage alias + deliverSubmission(pi, msg, ctx) exist when this lands; buildCompletion's output must be deliverable through it unchanged
  gotcha: do not duplicate deliverSubmission; only widen the type

- file: src/merge.ts
  why: withdrawal semantics — WithdrawalInfo.reason is the fixed string "withdrawn"; withdrawn questions stay in the map (audit trail Q34=A)
  gotcha: no reason text beyond the fixed string exists; the human-readable "omitted by agent" mapping is documented here and in JSDoc

- file: plan/001_0d6760db6bc5/prd_snapshot.md (h2.46, h3.9, h2.36, h2.0 §2)
  why: the record format VERBATIM; the completion flow; the recap card's details contract; the one-injection commitment
```

### Current Codebase tree

```bash
src/ index.ts config.ts state.ts merge.ts depends-on.ts snapshots.ts tool-schema.ts guards.ts caps.ts results.ts fallback.ts tool.ts delivery.ts (+ *.test.ts)
# deliverSubmission added to delivery.ts by S2 (parallel, contract in P1M2T1S2/PRP.md)
```

### Desired Codebase tree

```bash
src/
  delivery.ts        # MODIFIED: add CompletionMessage + buildCompletion (+ types); widen SendableMessage
  delivery.test.ts   # MODIFIED: add buildCompletion test suite (golden-record tests)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// ESM: relative imports use ".js" suffix (`from "./state.js"`).
// h2.46 record uses EM-DASHES (—) in the header and free-text prefix — not hyphens. Tests must assert exact bytes.
// snapshots.ts answerSummary is private — replicate, don't import; keep the two rules in sync by comment reference.
// Moot reasons are computed, not stored — evaluateDependsOn(state) at build time; a moot question missing from
//   mootered (defensive) gets reason "dependency unmet".
// Batch notes live only in submission messages' details.note — state has none. P1.M2.T2.S2 collects them; this
//   function only formats. Passing undefined === [].
// buildCompletion must NOT clear state — "lifecycle: dismiss panel; clear state (keep entries for audit)" is
//   P1.M2.T2.S2's line, AFTER sending.
// ★ check: q.recommendation may be a value that is NOT among options — compare against answer.value directly.
// display is the literal type true (not boolean) to match SubmissionMessage.
// Tests: plain vitest, construct InterrogationState via createInterrogationState + upsertQuestion/applyAnswer/setStatus.
```

## Implementation Blueprint

### Data models and structure

Types as specified in the Goal section (CompletionRecapEntry/Group, CompletionMessage). Plain data only — safe for renderers and persistence.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: PREREQUISITE CHECK
  - src/delivery.ts exists (S1 landed): extend it. Preserve buildSubmission and its tests.
  - IF S2's deliverSubmission/SendableMessage present: widen SendableMessage to the union.
     IF NOT: define SendableMessage = SubmissionMessage | CompletionMessage yourself (S2's contract
     explicitly says "S3 will widen it to a union" — defining it widened satisfies both).

Task 1: ADD types + local helpers to src/delivery.ts
  - IMPLEMENT: CompletionRecapEntry, CompletionRecapGroup, CompletionMessage (shapes in Goal)
  - IMPLEMENT private labelSummary(q: Question): string replicating snapshots.ts answerSummary
     (choice → option label for answer.value, fallback raw value; text → raw value; no answer → "(unanswered)")
  - IMPORT: { InterrogationState, Question, UNGROUPED_LABEL } from "./state.js";
     { evaluateDependsOn } from "./depends-on.js"

Task 2: IMPLEMENT buildCompletion(state, notes?)
  - LOGIC: per What §1–5; PURE (no snapshot/bump/clear/events)
  - NAMING: buildCompletion (contract-mandated); exported
  - JSDOC: Mode A — quote h2.46 record format verbatim; document line grammars, reason derivations,
     notes-collection split with P1.M2.T2.S2, delivery via deliverSubmission

Task 3: WIDEN SendableMessage (if not already the union) — one line

Task 4: ADD tests to src/delivery.test.ts
  - IMPLEMENT: describe("buildCompletion") with cases:
      * golden record: multi-group fixture (grouped + ungrouped "(none)"), answered/star/free-text/
        unanswered/open/moot/withdrawn questions → exact content string match (template-literal expected)
      * header em-dash byte-exactness (assert content startsWith "INTERROGATION COMPLETE — ")
      * ★ appears only when answer.value === recommendation; no ★ without recommendation
      * free text " — {text}" only when non-empty; absent when undefined or ""
      * NOTES: multiple notes joined "; " in order; "(none)" when empty/undefined
      * Withdrawn/moot: moot reason from dependsOn ("moot: storage=sqlite" → "(moot: storage=sqlite)"),
        withdrawn → "(withdrawn: omitted by agent)", "(none)" when empty
      * grouping/order: groups first-appearance; within group order[] order
      * details shape: goal, groups entries (id/title/answer/star/freeText?/answeredAt?), notes,
        withdrawnMoot, completedAt (ISO parseable), epoch === state.epoch
      * purity: serialize() deep-equal before/after; snapshots.length unchanged; epoch unchanged
  - PATTERN: build fixture via createInterrogationState("goal") + upsertQuestion({...}) +
     applyAnswer(id, {value, at: "2025-01-01T00:00:00.000Z"}) + setStatus(id, "moot"|"withdrawn")
     (moot fixture needs a dependsOn pair so evaluateDependsOn derives the reason)
  - NAMING: test("buildCompletion renders grouped record with stars and free text", ...) style
  - PLACEMENT: extend delivery.test.ts; keep S1/S2 tests intact
```

### Implementation Patterns & Key Details

```ts
// Question-line grammar (one space between tokens; optional segments omitted, not blank):
//   `[${group}] ${id} ${title}: ${answer}` + (star ? ` ★` : "") + (text ? ` — ${text}` : "")
//
// NOTES line:  `NOTES: ${notes.length ? notes.join("; ") : "(none)"}`
// Withdrawn line: `Withdrawn/moot: ${entries.length ? entries.join("; ") : "(none)"}`
//   entry: `${id} (${status}: ${reason})`; status ∈ {"withdrawn","moot"};
//   withdrawn reason "omitted by agent"; moot reason = MootReason.reason with leading "moot: " stripped.
//
// Moot reasons (computed, NOT stored):
const mootReasons = new Map(evaluateDependsOn(state).mootered.map((m) => [m.id, m.reason]));
// ... reason = mootReasons.get(id)?.replace(/^moot:\s*/, "") ?? "dependency unmet"
//
// GOTCHA: call evaluateDependsOn ONCE, before iterating (it may emit events internally via setStatus
// for still-moot questions? No — verify: it only emits for newly-mootered; a state at completion has
// stable statuses, so the call is effectively read-only. Purity assertion in tests guards this.)
// CRITICAL: never call clearForCompletion here — lifecycle (P1.M2.T2.S2) clears AFTER deliverSubmission.
```

### Integration Points

```yaml
NO REGISTRATION: pure exported function; index.ts NOT modified.
CONSUMER 1: P1.M2.T2.S2 completion trigger — buildCompletion(state, collectedNotes) →
  deliverSubmission(pi, msg, ctx) → state.clearForCompletion().
CONSUMER 2: P1.M7.T3.S2 recap card renderer — reads details (h2.36): compact = goal + grouped answers +
  timestamps; expanded adds withdrawnMoot reasons. details must therefore carry BOTH compact and expanded data.
FUTURE: none — the record is injected exactly once by design (h2.0 §2).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck          # tsc --noEmit — zero errors
npx vitest run src/delivery.test.ts
```

### Level 2: Unit Tests (Component Validation)

```bash
npm test                                  # full suite — no regressions in S1/S2 tests
npx vitest run src/delivery.test.ts -t buildCompletion -v
# Expected: all pass, including golden-record and purity assertions.
```

### Level 3: Integration Testing (System Validation)

Deferred to P1.M2.T2.S2 (completion trigger) and P1.M2.T3 debug commands: live session where buildCompletion's message is delivered and the model demonstrably writes the spec from it. This item has no runtime surface of its own.

### Level 4: Creative & Domain-Specific Validation

Manual byte-inspection: print `buildCompletion(fixture).content` in a scratch vitest test (or `npx tsx` one-off) and diff against h2.46 by eye — em-dashes, spacing, ordering.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean
- [ ] `npm test` green (all suites, including S1 buildSubmission + S2 deliverSubmission tests)

### Feature Validation

- [ ] Golden-record test passes byte-exactly
- [ ] All success criteria in "What" checked (grouping, ★, free text, NOTES, withdrawn/moot, details shape)
- [ ] Purity assertions pass (no state/snapshot/epoch change)
- [ ] SendableMessage widened; deliverSubmission carries CompletionMessage unchanged

### Code Quality Validation

- [ ] `.js` ESM import suffixes
- [ ] Mode A JSDoc quoting h2.46 verbatim
- [ ] No mutation of stored question objects; reads via orderedQuestions()/getQuestion only
- [ ] label-summary rule duplicated with comment reference to snapshots.ts (kept in sync)

### Documentation & Deployment

- [ ] JSDoc names consumers (P1.M2.T2.S2 trigger, P1.M7.T3.S2 recap renderer)
- [ ] No new env vars or config keys

---

## Anti-Patterns to Avoid

- ❌ Don't clear/bump/snapshot state in buildCompletion — completion is not a submission; lifecycle owns clearing
- ❌ Don't skip open/unanswered questions in the record — h2.46 says "every question, grouped, in order"
- ❌ Don't render group standalone headers — `[group]` rides on every question line per h2.46
- ❌ Don't use hyphens instead of em-dashes (—) in the header or free-text prefix
- ❌ Don't try to import snapshots.ts's private answerSummary — replicate and cite
- ❌ Don't store moot reasons or batch notes on state to "help" this function — reasons are recomputed, notes are passed in
- ❌ Don't add transport (pi.sendMessage) inside buildCompletion — S2's deliverSubmission is the only path

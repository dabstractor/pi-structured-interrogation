---
name: "P1.M1.T3.S4 — Read action, status line, result details snapshot"
description: "Create src/results.ts — pure buildResult helpers producing every interrogate tool result: status line (h2.28), read digest (h3.7), upsert end-your-turn text (h3.5), and the canonical details envelope {state, epoch, statusLine, action} (h2.40 layer 2). Consumed by executors S5/S6, lifecycle, and reconstruction (P1.M7.T1.S2)."
---

## Goal

**Feature Goal**: A pure, fully unit-tested result-builder module for the `interrogate` tool. Every interrogate result carries (a) human/model-facing content text and (b) a `details` envelope whose `state` field is the **canonical persistence layer** (h2.40 layer 2): the full post-call `serialize()` output, branch-correct by construction.

**Deliverable**: `src/results.ts` + `src/results.test.ts`. Exports:
- `buildStatusLine(state: SerializedState): string` — the shared h2.28 format `{answered}/{total} answered · {reasked} re-asked · {moot} moot · epoch {n}`
- `buildReadResult(state: SerializedState): InterrogateResult` — goal, epoch, group summary lines, per-question one-liners (h3.7)
- `buildUpsertResult(state: SerializedState, warnings: string[]): InterrogateResult` — status line + `"Questions visible to the user."` + end-your-turn instruction + caps warnings
- `type InterrogateResult = { content: string; details: ResultDetails }` with `ResultDetails = { state: SerializedState; epoch: number; statusLine: string; action: "upsert" | "read" | "reopen" | "record" }`

**Success Definition**: vitest green, `npm run typecheck` clean; status line matches h2.28 byte-for-byte (including the ` · ` middle-dot separators); read one-liners are ~1 line each in the `{id, title, status, rev, answer?}` shape; every result's `details.state` is a deep copy of `serialize()` output (mutation-isolation asserted); upsert text ends with the exact end-your-turn sentence.

## User Persona

**Target User**: The AI agent consuming `interrogate` results (status line + read digest are its working memory); the extension developer wiring the executors (S5/S6) and reconstruction (P1.M7.T1.S2).

**Use Case**: Model upserts questions → gets a compact status line and instructions to end its turn. Model calls `interrogate({})` → gets the full one-line-per-question digest to re-orient after compaction or a stale rejection. User's session is resumed later → reconstruction replays the latest tool result's `details.state` (h2.40) — this module is where that canonical payload is minted.

**User Journey**: upsert → status line + "Questions visible to the user. End your turn with a one-line note; do not call further tools." → user answers in the panel → model calls `interrogate({})` → digest refresh → model proceeds with full current state.

**Pain Points Addressed**: results that omit state force extra reads and break branch-correct reconstruction; ad-hoc result shapes across executors; no shared status line between results and the future panel footer (h2.28 is shared by design).

## Why

- h2.40 layer 2: tool-result `details` are the CANONICAL persistence layer — "every interrogate result carries the full post-call state. Branch-correct by construction." This module is the single mint point for that envelope.
- h2.20: the upsert return is "Status line + 'end your turn' instruction + caps warnings if any"; the read return is "goal, epoch, group summary, per-question one-liners".
- h3.5 (ask, non-blocking): the agent must be told `End your turn with a one-line note; do not call further tools.` — the upsert result text is where that resident instruction lands.
- Downstream: S5 (non-TUI digest + answers action), S6 (tool registration/render rows), lifecycle, and P1.M7.T1.S2 (reconstruction scans `toolResult.details.state`) all consume these helpers — building them here once guarantees one contract.

## What

1. **`buildStatusLine(state: SerializedState): string`** (h2.28, verbatim): `"{answered}/{total} answered · {reasked} re-asked · {moot} moot · epoch {n}"` where counts come from the questions in `state.questions` (total = `state.order.length`; count statuses `answered`, `reasked`, `moot`); `{n}` = `state.epoch`. Note `submitted`/`closed`/`withdrawn`/`open` do NOT appear in the line. Exact separators: ` · ` (space, middle dot U+00B7, space). Empty state → `0/0 answered · 0 re-asked · 0 moot · epoch {n}`.

2. **`buildReadResult(state)`** content text, multi-line, in this order (h3.7):
   - Line 1: `Goal: {state.goal}` (omit the line entirely when goal is `""`)
   - Line: status line (from `buildStatusLine`)
   - Group summary lines, first-appearance order following `state.order` — one per group: `{group}: {answered}/{total} answered` (mirror `state.ts` `groupSummaries()` semantics but computed from the SerializedState — pure, no live state; questions without `group` bucket under `"(none)"`, the `UNGROUPED_LABEL` from state.ts — import that constant).
   - Per-question one-liners, in `state.order`: `{id}: {title ?? prompt-truncated} — {status} (rev {rev}){ = answer.value if answer?}` — format precisely: `{id}: {title} — {status} (rev {rev})` and append ` · answered: {answer.value}` when `q.answer` exists. Keep it to ~1 line: when `title` is absent use `prompt` truncated to 60 chars (plain slice, no ellipsis). Titles are short by contract; do not truncate `title`.
   - `details = { state, epoch: state.epoch, statusLine, action: "read" }`.

3. **`buildUpsertResult(state, warnings)`** content text, in this exact line order (h2.20 + h3.5):
   1. Status line (h2.28)
   2. `Questions visible to the user.` (exact sentence)
   3. `End your turn with a one-line note; do not call further tools.` (exact sentence, h3.5 verbatim)
   4. Each caps warning from `warnings[]`, one per line, in order (the executor — S6 — passes `applyCaps` warnings filtered by `config.gateWarnings`; this module renders whatever it receives, gate-suppression is the CONSUMER's job, mirroring the caps PRP's policy)
   - `details = { state, epoch: state.epoch, statusLine, action: "upsert" }`.

4. **Canonical details contract (h2.40)**: every builder returns `details.state` as the caller-provided `SerializedState` deep-copied via `structuredClone` — results must be inert snapshots; later state mutations can never leak into a previously built result. `details.epoch` duplicates `state.epoch` for convenient scanning (reconstruction and the S5 digest read it without digging into state). `details.statusLine` duplicates the rendered line so the panel footer (h2.28 shared) and renderers can reuse it without re-parsing content.

5. **Purity**: no pi imports, no state mutation, no events, no I/O. Inputs: `SerializedState` (from `state.serialize()` — P1.M1.T2.S1, already implemented) and a `string[]`. Imports allowed: `type { SerializedState, Question }` and `UNGROUPED_LABEL` from `./state.js` only.

6. **JSDoc (Mode A)** on `InterrogateResult`/`ResultDetails` and each builder documenting the details contract: "`details.state` is the canonical persistence layer (h2.40 layer 2) — reconstruction (P1.M7.T1.S2) replays the latest interrogate result on the current branch via `details.state`; therefore `details` MUST carry the FULL post-call state on EVERY action, including read."

### Success Criteria

- [ ] h2.28 status line asserted byte-for-byte for mixed-status fixtures and the empty state
- [ ] Read digest: goal/status-line/group/per-question ordering asserted; group buckets include `"(none)"`; one-liner shape `{id}: {title} — {status} (rev {rev})[ · answered: {value}]`
- [ ] Upsert text: exact three fixed lines in order + appended warnings; ends with the h3.5 sentence
- [ ] `details = {state, epoch, statusLine, action}` on all builders; `details.state` deep-copied (mutating the input SerializedState after building does not change the result)
- [ ] Pure module: no pi/state-mutation imports; `npm test` + `npm run typecheck` pass

## All Needed Context

### Context Completeness Check

An agent with no codebase knowledge gets: the exact string formats, the `SerializedState`/`Question` types (already in `src/state.ts`), the `UNGROUPED_LABEL` constant, and the consumer contracts (S3 caps warnings, S5/S6 executors, P1.M7.T1.S2 reconstruction). No guessing.

### Documentation & References

```yaml
- file: src/state.ts
  why: SerializedState {goal, epoch, order, questions: Record<id, Question>} — the input to every builder; Question fields (id, title?, prompt, status, rev, answer?)
  pattern: import { UNGROUPED_LABEL } from "./state.js"; import type { SerializedState, Question } from "./state.js"
  gotcha: serialize() already deep-copies — but builders deep-copy AGAIN on intake so tests/callers passing hand-made SerializedState literals are also isolated

- file: plan/001_0d6760db6bc5/P1M1T3S3/PRP.md
  why: CONTRACT for applyCaps — returns {questions, goal, warnings}; the upsert executor (S6) passes those warnings in; gateWarnings suppression belongs to the consumer, NOT this module
  gotcha: S3 implemented IN PARALLEL — assume its exact signature from that PRP; this module only takes string[]

- file: plan/001_0d6760db6bc5/P1M1T3S1/PRP.md (and src/tool-schema.ts, already landed)
  why: ParsedAction union — the action string for details.action; reuse the literal union "upsert" | "read" | "reopen" | "record"
  gotcha: import type ParsedAction or just declare the literal union locally to keep results.ts dependency-light

- file: src/state.ts groupSummaries()
  why: group-bucket semantics to mirror on SerializedState (pure re-implementation — builders take serialized state, NOT the live class)
  pattern: iterate state.order, bucket by q.group ?? UNGROUPED_LABEL, first-appearance order

- file: plan/001_0d6760db6bc5/prd_snapshot.md (h2.20, h2.28, h3.5, h3.7, h2.40)
  why: authoritative text for the strings — reproduced verbatim in "What" above

- file: src/state.test.ts
  why: vitest conventions — colocated *.test.ts, describe/it, createInterrogationState fixtures
```

### Current Codebase tree

```bash
src/
  index.ts config.ts state.ts merge.ts depends-on.ts snapshots.ts tool-schema.ts guards.ts (+ *.test.ts)
  # caps.ts arriving from S3 (parallel)
```

### Desired Codebase tree

```bash
src/
  results.ts        # NEW — InterrogateResult, ResultDetails, buildStatusLine, buildReadResult, buildUpsertResult
  results.test.ts   # NEW — string-format, ordering, details-contract, purity tests
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// ESM: relative imports need .js suffix ("./state.js")
// Status line separators are " · " (U+00B7 middle dot with single spaces) — NOT hyphens or "•"
// answered count in h2.28 counts status==="answered" ONLY — not submitted/closed
// details.state must be a structuredClone of the input — results are inert
// Do NOT suppress warnings via config.gateWarnings here — the executor (S6) filters before calling
// read result MUST also carry full details.state — reconstruction depends on EVERY action snapshotting (h2.40)
// Do not truncate `title`; only `prompt`-fallback gets the 60-char slice
```

## Implementation Blueprint

### Data models and structure

```ts
// src/results.ts
import { UNGROUPED_LABEL } from "./state.js";
import type { SerializedState, Question } from "./state.js";

/** Result action tag — mirrors ParsedAction's discriminant (tool-schema.ts). */
export type ResultAction = "upsert" | "read" | "reopen" | "record";

/** Canonical details envelope (h2.40 layer 2). */
export interface ResultDetails {
  /** Full post-call state — THE canonical persistence payload. */
  state: SerializedState;
  epoch: number;
  statusLine: string;
  action: ResultAction;
}

export interface InterrogateResult {
  content: string;
  details: ResultDetails;
}

export function buildStatusLine(state: SerializedState): string;
export function buildReadResult(state: SerializedState): InterrogateResult;
export function buildUpsertResult(state: SerializedState, warnings: string[]): InterrogateResult;
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/results.ts — types + buildStatusLine
  - IMPLEMENT: InterrogateResult, ResultDetails, ResultAction; buildStatusLine per "What" §1 (middle-dot separators, answered/total/reasked/moot/epoch)
  - MODE A JSDoc on ResultDetails: details.state is canonical (h2.40 layer 2); reconstruction replays latest result's details.state
  - PLACEMENT: src/results.ts

Task 2: CREATE src/results.ts — buildReadResult
  - IMPLEMENT: line order Goal → statusLine → group summaries → per-question one-liners per "What" §2; group bucketing mirrors state.ts groupSummaries() but pure on SerializedState; UNGROUPED_LABEL for absent groups
  - GOTCHA: omit Goal line when goal === ""; prompt-fallback truncated to 60 chars; answer suffix " · answered: {value}"
  - DEPENDENCIES: buildStatusLine

Task 3: CREATE src/results.ts — buildUpsertResult
  - IMPLEMENT: exact three fixed lines + warnings[] per "What" §3; details action "upsert"
  - GOTCHA: all builders structuredClone the input state into details.state

Task 4: CREATE src/results.test.ts
  - FOLLOW pattern: src/state.test.ts (describe/it, createInterrogationState + upsertQuestion + serialize() for fixtures)
  - CASES: status line byte-exact (mixed statuses incl. reasked/moot; empty state 0/0; epoch passthrough); read digest full-content assertion (goal present/absent, group order incl. "(none)", one-liner with and without answer, prompt fallback truncation at 61 chars); upsert text exact 3 lines + 2 warnings order + no-warnings case; details envelope fields on all builders; input-mutation isolation (mutate fixture after build, result unchanged); purity (module has no state/pi imports — verified by typecheck)
```

### Implementation Patterns & Key Details

```ts
// One-liner rendering:
function questionLine(q: Question): string {
  const label = q.title ?? (q.prompt.length > 60 ? q.prompt.slice(0, 60) : q.prompt);
  let line = `${q.id}: ${label} — ${q.status} (rev ${q.rev})`;
  if (q.answer !== undefined) line += ` · answered: ${q.answer.value}`;
  return line;
}

// Shared envelope:
function envelope(state: SerializedState, action: ResultAction, statusLine: string): ResultDetails {
  return { state: structuredClone(state), epoch: state.epoch, statusLine, action };
}
```

### Integration Points

```yaml
CONSUMERS (do NOT implement here):
  - P1.M1.T3.S5 non-TUI digest + answers action: wraps buildUpsertResult/buildStatusLine for the digest path; answers result uses action "record" (build a thin local wrapper or extend this module then — record/reopen builders are S5/S6's call sites, NOT this item)
  - P1.M1.T3.S6 tool executor: upsert → applyCaps → merge → buildUpsertResult(state.serialize(), gateWarnings ? warnings : []); read → buildReadResult(state.serialize())
  - P1.M7.T1.S2 reconstruction: scans toolResult.details.state
EXPORTS: module-local for now (index.ts wiring is S6)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npx vitest run src/results.test.ts
```

### Level 2: Unit Tests

```bash
npm test   # full suite green — no regressions to state/merge/snapshots/tool-schema/guards
```

### Level 3: Integration Testing

Not applicable until S6 registers the tool. Fixture equivalence covered in tests: a state built via createInterrogationState + upsertQuestion + applyAnswer + serialize() round-trips through builders.

### Level 4: Domain Validation

String-contract spot-checks asserted byte-exact in tests (h2.28 line, h3.5 sentence, "Questions visible to the user.") — no runtime integration possible pre-S6.

## Final Validation Checklist

- [ ] `npm run typecheck` clean; `npm test` all green
- [ ] h2.28 status line byte-exact; h3.7 read digest line order + one-liner shape asserted
- [ ] Upsert text: status line + "Questions visible to the user." + h3.5 sentence + warnings, in order
- [ ] Every builder returns details {state (deep copy), epoch, statusLine, action}
- [ ] Pure module: no pi imports, no mutation, `.js` import suffixes
- [ ] Mode A JSDoc documenting the canonical details contract

---

## Anti-Patterns to Avoid

- ❌ Don't skip `details.state` on the read result — reconstruction needs EVERY action snapshotted (h2.40)
- ❌ Don't return the caller's SerializedState object — deep-copy via structuredClone
- ❌ Don't filter warnings with `config.gateWarnings` inside this module — the executor decides
- ❌ Don't count `submitted`/`closed` in the h2.28 "answered" bucket
- ❌ Don't use live `InterrogationState` class methods (groupSummaries) on the class instance — builders are pure over the serialized projection
- ❌ Don't build reopen/record results here beyond the shared envelope — their call sites (S5/S6) own the content text

---
name: "P1.M1.T3.S2 — rev/epoch stale guards (throw with current state)"
description: "Guard functions for the interrogate upsert/answers paths. On stale rev/epoch they THROW Error with a message carrying current rev/epoch, current text, and the delta digest since the caller's epoch — pi converts the throw into an isError result (AC-8)."
---

## Goal

**Feature Goal**: Create `src/guards.ts` exporting `assertFresh(state, parsed)` — a pure guard layer that checks, for a `ParsedAction` of `"upsert"` or `"record"`, that (a) each question touching an existing id carries that question's current `rev`, and (b) a caller-supplied top-level `epoch` (when required) matches `state.epoch`. On mismatch it **throws** `Error` with the exact h3.8-shaped message so pi converts it into an `isError` tool result that lets the model self-heal in one round trip.

**Deliverable**: `src/guards.ts` + `src/guards.test.ts`. Exports:
- `assertFresh(state: InterrogationState, parsed: ParsedAction): void` (throws on stale; returns silently otherwise)
- `class StaleError extends Error` carrying `{ id?, sentRev?, currentRev?, sentEpoch?, currentEpoch }` for testability/telemetry
- `buildStaleMessage(...)` internal helper (exported for tests) that renders the h3.8 string

**Success Definition**: All vitest tests pass, `npm run typecheck` clean; the exact h3.8 message shape is asserted string-for-string; `read` and `reopen` actions pass through unguarded; both rev-only, epoch-only, and combined mismatches throw with current state + digest.

## User Persona

**Target User**: The AI agent calling `interrogate` (primary) — the STALE message is written for it; the extension developer wiring the executor (secondary).

**Use Case**: Agent upserts with a rev/epoch it read several turns ago; meanwhile the user submitted (epoch bumped) and the agent re-asked a question (rev bumped). The guard rejects with enough state for the model to re-apply correctly without a separate read.

**User Journey**: model sends `{questions:[{id:"q3",rev:2,...}], epoch:4}` → guard sees rev 5 / epoch 9 → throws `"STALE: q3 is at rev 5 (you sent 2); session epoch is 9 (you sent 4). Current q3: {text}. Changes since epoch 4: {delta digest}. Re-apply against current state."` → pi surfaces isError → model re-reads, re-applies with rev 5 / epoch 9 → success (AC-8).

**Pain Points Addressed**: lost-update races between user submissions and agent edits; opaque rejection messages that force multiple round trips.

## Why

- AC-8 (h2.10): "Stale upsert (wrong rev/epoch) → rejected; result contains current text/rev and delta digest; model re-applies successfully."
- pi sets `isError` on tool results ONLY when `execute` THROWS (plan/001_0d6760db6bc5/architecture/pi-api-validation.md:21, extensions.md:2068) — so throwing is the protocol, not a bug.
- `digestSince` (P1.M1.T2.S4, `src/snapshots.ts`) already exists specifically to fill the `{delta digest}` slot — this item is its only in-tree consumer.

## What

1. `assertFresh(state, parsed)`:
   - `read` and `reopen`: **never guarded** — return immediately (h2.22: "Read (`{}`) is always allowed"). Guards apply identically in TUI and non-TUI; there is no mode parameter.
   - `record` (answers): requires `epoch` — `parsed.epoch` present and `=== state.epoch`, else throw. No per-question rev check on answers (answers never bump rev — h2.39).
   - `upsert`: for each incoming question whose `id` already exists in state (`state.getQuestion(id)`), `parsed.rev` must be present and `=== current.rev`; AND if the upsert carries `epoch`, it must match `state.epoch`. New ids (not in state) require NO rev. Missing `rev` on an existing id = stale (the schema makes rev optional precisely for new questions).
2. Error message, exact shape (h3.8, one string, single spaces after periods):
   `STALE: {id} is at rev {n} (you sent {m}); session epoch is {e} (you sent {x}). Current {id}: {text}. Changes since epoch {x}: {delta}. Re-apply against current state.`
   - For a rev-only failure (epoch matched/absent): keep the same template; use the actual current epoch and — because the epoch slot is only meaningful when a mismatch exists — for the epoch clause use `session epoch is {e} (you sent {e})` is WRONG. Instead: when epoch matched or was omitted, emit the rev-only variant per h2.22: `STALE: {id} is at rev {n} (you sent {m}). Current {id}: {text}. Re-apply against current state.` (no epoch clause, no digest clause — nothing changed since the caller's view that the epoch would catch... but rev changed, which implies the AGENT's own stale memory). Do NOT append a digest in the rev-only variant; the digest is defined as "changes since epoch", and only meaningful for epoch mismatch.
   - For an epoch-only failure (all revs fine): `STALE: session epoch is {e} (you sent {x}). Changes since epoch {x}: {delta}. Re-apply against current state.` (no rev clause, no per-question "Current" line).
   - Combined failure (rev AND epoch mismatched): full h3.8 template with both clauses, digest, and current text.
   - Multiple stale question ids in one upsert: report the FIRST stale id encountered (agent-supplied array order) — one throw per call; the model fixes all stale revs after its next read anyway.
   - `{text}` = current question's `prompt` (raw; truncation is the model's/render's concern — keep verbatim, no cap here).
   - `{delta}` = `digestSince(state, sentEpoch)` (src/snapshots.ts); when it returns `""` (nothing changed), render `Changes since epoch {x}: (none).`
   - `answers` with missing epoch entirely: treat sent epoch as 0 → epoch mismatch message with `(you sent 0)`... NO — missing epoch on answers is a required-param violation, not staleness. Throw `Error("answers requires epoch: include the epoch from your last read/result")` (plain Error, not the STALE shape).
   - `upsert` with missing epoch: h2.19 makes epoch REQUIRED with questions, but the guard is tolerant — an absent epoch on upsert with only NEW ids passes (nothing can be stale); an absent epoch on upsert touching existing ids fails the rev check naturally if rev is also absent, else passes rev and skips the epoch clause. Do not over-enforce here; schema-level requirements are S1's domain.
3. `StaleError extends Error` with `name: "StaleError"` and typed fields (`id?`, `sentRev?`, `currentRev?`, `sentEpoch?`, `currentEpoch?`, `digest?`) — message is the h3.8 string. The executor (S4/S5) simply lets it propagate out of `execute`.
4. **JSDoc (Mode A)** on `assertFresh` and `StaleError` explaining the throw-to-isError semantics: "pi sets isError on the tool result ONLY when execute throws (extensions.md:2068). Never return an isError field — the rejection message is the model's only healing signal, so it must carry current state."

### Success Criteria

- [ ] h3.8 combined-mismatch message matches the template byte-for-byte in a test (rev 2/epoch 4 vs rev 5/epoch 9 with a known digest)
- [ ] Rev-only and epoch-only variants asserted; digest `""` renders `(none)`
- [ ] Read (`{}`) and `reopen` pass through with any/missing epoch
- [ ] New-id upsert without rev passes; existing-id upsert without rev throws
- [ ] Answers with matching epoch passes; wrong epoch throws; missing epoch throws the plain "answers requires epoch" error
- [ ] `npm test` + `npm run typecheck` pass; guards.ts imports only from `./state.js` (types) and `./snapshots.js`

## All Needed Context

### Context Completeness Check

An agent with no codebase knowledge gets: the exact message templates, the upstream `ParsedAction` contract from S1, the exact `digestSince` signature, pi's throw-to-isError rule, and test conventions. No guessing.

### Documentation & References

```yaml
- file: plan/001_0d6760db6bc5/P1M1T3S1/PRP.md
  why: CONTRACT for parseInterrogateParams / ParsedAction — assume it exists exactly as specified
  pattern: "ParsedAction = { action: 'upsert'; goal?; epoch?; questions: QuestionInput[] } | { action: 'read' } | { action: 'reopen' } | { action: 'record'; epoch?; answers: AnswerInput[] }"
  gotcha: S1 is being implemented IN PARALLEL — import ParsedAction (type-only) from src/tool-schema.ts per that PRP's export list. If the type name differs at integration time, adapt the import, not the logic.

- file: src/state.ts
  why: InterrogationState — state.epoch, getQuestion(id).rev, .prompt; getState() singleton
  pattern: read-only usage; guards NEVER mutate state, NEVER emit events
  gotcha: import type-only where possible; .js suffix on relative imports

- file: src/snapshots.ts
  why: digestSince(state, epochFrom): string — fills the {delta digest} slot; returns "" when epochFrom >= state.epoch
  pattern: call with the caller's sentEpoch; render "" as "(none)"

- file: plan/001_0d6760db6bc5/architecture/pi-api-validation.md
  why: line 21 + 66 — isError set ONLY by throwing from execute; stale rejections throw, never return a field
  critical: this is WHY the guard throws instead of returning a result object

- file: src/state.test.ts / src/snapshots.test.ts
  why: vitest conventions — colocated *.test.ts, describe/it, createInterrogationState + takeSnapshot/bumpEpoch to build fixtures
  pattern: build state via createInterrogationState("goal"), upsertQuestion(...), takeSnapshot(state), state.bumpEpoch()

- file: plan/001_0d6760db6bc5/prd_snapshot.md (h2.22, h2.39, h3.8)
  why: authoritative guard semantics — quoted verbatim in "What" above
```

### Current Codebase tree

```bash
src/
  index.ts config.ts state.ts merge.ts depends-on.ts snapshots.ts (+ *.test.ts)
  # tool-schema.ts arriving from S1 (parallel)
```

### Desired Codebase tree

```bash
src/
  guards.ts        # NEW — StaleError, buildStaleMessage, assertFresh
  guards.test.ts   # NEW — message-shape + pass/throw matrix
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: pi's isError ONLY comes from a thrown error — never return { isError: true }
// ESM: relative imports need .js suffix ("./state.js")
// Guards are PURE reads: no state mutation, no events, no UI, no pi imports — this module must stay unit-testable without an extension context
// digestSince(state, sentEpoch) returns "" when nothing changed — render "(none)"
// Do not enforce schema-level "epoch required" on upsert here (S1's validation domain); guards check CONSISTENCY, not presence
// state.getQuestion returns the live object — read it, never mutate
```

## Implementation Blueprint

### Data models and structure

```ts
// src/guards.ts
import type { InterrogationState } from "./state.js";
import { digestSince } from "./snapshots.js";
import type { ParsedAction } from "./tool-schema.js";

export class StaleError extends Error {
  override readonly name = "StaleError";
  constructor(
    message: string,
    readonly details: {
      id?: string; sentRev?: number; currentRev?: number;
      sentEpoch?: number; currentEpoch?: number; digest?: string;
    },
  ) { super(message); }
}

export function assertFresh(state: InterrogationState, parsed: ParsedAction): void;
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/guards.ts — StaleError + buildStaleMessage
  - IMPLEMENT: three message variants (rev-only, epoch-only, combined) exactly per "What" §2; JSDoc Mode A on throw-to-isError semantics
  - NAMING: StaleError, buildStaleMessage (exported for tests), assertFresh
  - PLACEMENT: src/guards.ts; pure module (state + snapshots + type-only tool-schema imports)

Task 2: CREATE src/guards.ts — assertFresh
  - IMPLEMENT: read/reopen → return; record → epoch check (missing → plain Error "answers requires epoch..."); upsert → first existing-id rev mismatch OR epoch mismatch → throw StaleError with rendered message
  - GOTCHA: check revs in incoming array order; new ids skipped; absent caller epoch on upsert skips epoch clause
  - DEPENDENCIES: digestSince for the delta slot

Task 3: CREATE src/guards.test.ts
  - FOLLOW pattern: src/snapshots.test.ts (fixtures via createInterrogationState, upsertQuestion, takeSnapshot, bumpEpoch)
  - CASES: byte-exact h3.8 combined message; rev-only variant; epoch-only variant; digest "(none)"; read/reopen unguarded; new-id no-rev passes; existing-id no-rev throws; answers happy/stale/missing-epoch; multiple stale ids reports first; no mutation of state during guard (snapshot state.serialize() before/after compare)
```

### Implementation Patterns & Key Details

```ts
// Core shape:
export function assertFresh(state: InterrogationState, parsed: ParsedAction): void {
  if (parsed.action === "read" || parsed.action === "reopen") return; // never guarded (h2.22)

  if (parsed.action === "record") {
    if (parsed.epoch === undefined)
      throw new Error("answers requires epoch: include the epoch from your last read/result");
    if (parsed.epoch !== state.epoch) throw new StaleError(epochMsg(state, parsed.epoch), {...});
    return;
  }
  // upsert:
  for (const q of parsed.questions) {
    const cur = state.getQuestion(q.id);
    if (cur && q.rev !== cur.rev) throw new StaleError(...); // includes absent rev (undefined !== n)
  }
  if (parsed.epoch !== undefined && parsed.epoch !== state.epoch) throw new StaleError(...);
}
```

### Integration Points

```yaml
CONSUMERS (do NOT implement here):
  - P1.M1.T3.S4 (upsert executor) and P1.M1.T3.S5 (answers action): call assertFresh(state, parsed.action) before mutating via merge.ts; let StaleError propagate out of execute → pi renders isError
  - P1.M2.T3.S1 debug commands reuse assertFresh for scripted AC-8 verification
EXPORTS: keep module-local in index.ts for now (registration is S6)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npx vitest run src/guards.test.ts
```

### Level 2: Unit Tests

```bash
npm test   # full suite green — no regressions to state/merge/snapshots
```

### Level 3: Integration Testing

Not applicable until S4/S5 wire the executor. Optional fixture check (already covered by tests): construct state, takeSnapshot + bumpEpoch twice, assert digestSince content appears in the thrown message.

### Level 4: Domain Validation

```bash
# Byte-exact AC-8 fixture asserted in tests; no runtime integration possible pre-S6.
```

## Final Validation Checklist

- [ ] `npm run typecheck` clean; `npm test` all green
- [ ] h3.8 combined template string asserted exactly; three variants tested
- [ ] Read/reopen never guarded; guards identical for TUI/non-TUI (no mode input)
- [ ] StaleError carries typed details + Mode A JSDoc on throw-to-isError semantics
- [ ] Pure module: no mutation, no events, no UI/pi imports
- [ ] `.js` import suffixes; colocated test file

---

## Anti-Patterns to Avoid

- ❌ Don't return an isError field — pi only sets it when execute THROWS (pi-api-validation.md:21)
- ❌ Don't guard `read`/`reopen` (h2.22: pull refresh is never guarded)
- ❌ Don't mutate state or emit events from guards
- ❌ Don't check revs on answers — answers are epoch territory (h2.39)
- ❌ Don't duplicate digest logic — use `digestSince` from src/snapshots.ts
- ❌ Don't enforce "epoch required" on upsert here (schema validation is S1); guards check consistency only
- ❌ Don't collect multiple stale ids into one mega-message — throw on the first (one round-trip heal via read is the designed path)

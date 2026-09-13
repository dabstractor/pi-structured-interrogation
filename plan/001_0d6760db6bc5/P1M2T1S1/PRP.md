---
name: "P1.M2.T1.S1 — Submission delta builder (delivery.ts: buildSubmission)"
description: "Create src/delivery.ts exporting buildSubmission(state, diff, note): builds the pi.sendMessage payload for an interrogation submission ({customType:'interrogation-submission', content ≤3 lines per h3.6, display:true, details:{changed, note?, epoch, card}}) and performs the h3.6 side effects in order — build first, then takeSnapshot(state) BEFORE state.bumpEpoch(). The flush of pending answers into state is the caller's (panel, P1.M3/M4) documented precondition; the actual pi.sendMessage call + triggerTurn is P1.M2.T1.S2."
---

## Goal

**Feature Goal**: Implement the submission delta builder — the function that turns a computed diff (S4 `computeDiff` output) plus optional batch note into the compact ≤3-line custom message the model receives on ctrl+s, with full card data in `details` for the user-only renderer (P1.M7.T3.S1), and that advances the state epoch exactly once per submission with a ring snapshot labeled at the submitted epoch.

**Deliverable**: `src/delivery.ts` + `src/delivery.test.ts`. `src/delivery.ts` exports:

```ts
export interface SubmissionMessage {
  customType: "interrogation-submission";
  content: string;   // <=3 lines, format fixed by h3.6
  display: true;
  details: {
    changed: DiffEntry[];   // re-exported shape from snapshots.ts
    note?: string;
    epoch: number;          // PRE-bump epoch (the epoch being submitted)
    card: SubmissionCardData;
  };
}
export const SUBMISSION_REMINDER: string; // "Consider how these affect your other questions."
export function buildSubmission(
  state: InterrogationState,
  diff: SubmissionCardData,
  note?: string,
): SubmissionMessage;
```

**Success Definition**: `npm test` + `npm run typecheck` green; unit tests verify the exact content format, ≤3-line budget enforcement (long answer lists truncate, never overflow), epoch semantics (content/details epoch = pre-bump, `state.epoch` incremented by exactly 1 after the call, one snapshot pushed labeled with the pre-bump epoch), note passthrough, and `(changed)` markers on `editedArchived` entries.

## User Persona

**Target User**: The LLM agent (receives the ≤3-line delta + reminder and re-orients) and the TUI user (sees the card drawn from `details.card` by P1.M7.T3.S1).

**Use Case**: User answers k questions in the panel and hits ctrl+s → the delta arrives in the model's context; the transcript shows a user-only diff card.

**User Journey**: (future panel, P1.M3) flush pending answers into state → computeDiff(prevSnapshot.state, state.serialize(), note) → buildSubmission(state, diff, note) → P1.M2.T1.S2 sends it → model replies → lifecycle closes submitted answers.

**Pain Points Addressed**: Without this builder there is no compact submission path — the model would otherwise receive full state dumps (violating pull-based commitment h2.0 §2 and the ≤3-line budget).

## Why

- h3.6 defines the submit flow verbatim; this item owns the "build" step plus the epoch++/snapshot bookkeeping named there.
- h2.36: the user-only card is drawn from `details` by a renderer, NOT from content (decision Q2=A) — hence card data rides in details.
- h2.39 / snapshots.ts caller contract: `takeSnapshot` MUST run BEFORE `bumpEpoch()` (snapshot labels the pre-bump epoch; subscribing to `epoch-bumped` would mislabel). snapshots.ts's own JSDoc names P1.M2.T1.S1 as the wiring owner.
- `src/fallback.ts` `recordAnswers` already established the discipline: one submission = exactly one snapshot + one bump. `buildSubmission` must match so ring digests (stale guards) stay coherent regardless of submission surface (panel vs non-TUI record).

## What

### Content format (h3.6, byte-exact structure)

```
Submitted {k}: {id: value; id: value (changed)…}
Consider how these affect your other questions.
```

- Line 1: `Submitted {k}: ` + one entry per changed answer: `{id}: {to}` using `DiffEntry.to` (already label-preferred by computeDiff), appending ` (changed)` when `DiffEntry.editedArchived` is true (AC-13). Entries joined with `"; "`. `k` = `diff.changed.length`.
- Line 2 (the reminder): exactly `Consider how these affect your other questions.`
- **Length budget (≤3 lines total, Mode A documented)**: line 1 must never wrap into more than 2 display lines. Enforce with a character budget on the entry list (e.g. `SUBMISSION_LIST_MAX_CHARS = 240`): while the joined list exceeds the budget and there are >1 entries, drop the last entry and append `+{m} more`. The reminder line is never truncated. If `diff.changed.length === 0`, line 1 is `Submitted 0: (no changes)` — still exactly 2 lines.
- `note` does NOT appear in content (it lives only in `details.note`; the renderer draws the `NOTE:` line per h2.36).

### Side-effect order (h3.6, strict)

Inside `buildSubmission`, after composing the message:

1. (Precondition, caller-owned — document in JSDoc) pending answers are already flushed into `state` by the panel (ripple confirms happened at edit time). `buildSubmission` does NOT flush; it receives post-flush state.
2. `takeSnapshot(state)` — captures state at the CURRENT (pre-bump) epoch. Call exactly once.
3. `state.bumpEpoch()` — call exactly once. The returned/`state.epoch` value is the post-submission epoch; the message's `details.epoch` stays the pre-bump value (matches `diff.epoch` and the snapshot label).
4. Return the message object. The function must NOT call `pi.sendMessage` (S2's job) and must NOT touch UI.

### details shape

```ts
details: {
  changed: diff.changed,            // same array reference is fine (pure data)
  ...(note && note.length ? { note } : {}),
  epoch: diff.epoch,                // pre-bump, same as content's {n}
  card: diff,                       // FullCardData = SubmissionCardData (S4)
}
```

### Success Criteria

- [ ] Content always ≤3 lines (2 by construction); budget truncation tested with 30 long answers
- [ ] `details.card` is the SubmissionCardData passed in; note omitted when undefined/empty
- [ ] Exactly one snapshot pushed (ring length +1) labeled with the pre-bump epoch; `state.epoch` +1 after call
- [ ] `(changed)` suffix present iff `editedArchived` on that entry
- [ ] customType `"interrogation-submission"`, `display: true`, reminder line byte-exact
- [ ] No pi/UI/sendMessage dependency — importable and unit-testable with a bare InterrogationState

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets: the exact upstream types (snapshots.ts exports quoted below), the exact content format and side-effect order from h3.6, the pi.sendMessage message shape this object feeds, and the test conventions. No guessing on epoch semantics — the pre/post-bump distinction is spelled out.

### Documentation & References

```yaml
- file: src/snapshots.ts
  why: computeDiff / SubmissionCardData / DiffEntry / takeSnapshot definitions — THE upstream contract
  pattern: re-use types via `import type`; do NOT re-derive summaries
  critical: takeSnapshot MUST be called BEFORE bumpEpoch (its JSDoc caller contract names this item); diff.epoch = next.epoch computed pre-bump

- file: src/state.ts
  why: InterrogationState, state.epoch, bumpEpoch() (emits epoch-bumped then changed), snapshots ring, serialize()
  gotcha: applyAnswer/bumpEpoch are raw primitives — buildSubmission must add no other state mutation beyond snapshot+bump

- file: src/fallback.ts (recordAnswers, ~lines 175-225)
  why: precedent for the ONE-snapshot + ONE-bump-per-submission discipline; mirror it exactly

- file: src/state.test.ts / src/snapshots.test.ts
  why: test conventions — plain vitest, fixtures built via createInterrogationState + applyAnswer, no pi runtime imports

- url: /home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md#pisendmessagemessage-options
  why: the target message shape pi.sendMessage({customType, content, display, details}, {triggerTurn, deliverAs}) — P1.M2.T1.S2 will call it with this builder's return value
  critical: display:true makes it user-visible; details carries the card for registerMessageRenderer (P1.M7.T3.S1)

- file: plan/001_0d6760db6bc5/prd_snapshot.md (h3.6, h2.36, h2.3, h2.0)
  why: submit flow verbatim; user-only card from details; customType naming; ≤3-line + pull-based commitments

- file: plan/001_0d6760db6bc5/architecture/pi-api-validation.md
  why: sendMessage validated surface; confirms triggerTurn/deliverAs semantics for the NEXT item (S2) — builder stays transport-agnostic
```

### Current Codebase tree

```bash
src/ index.ts config.ts state.ts merge.ts depends-on.ts snapshots.ts tool-schema.ts guards.ts caps.ts results.ts fallback.ts (+ *.test.ts)
# src/tool.ts arriving from P1.M1.T3.S6 (parallel — registration; unrelated to this file)
```

### Desired Codebase tree

```bash
src/
  delivery.ts        # NEW — buildSubmission + SubmissionMessage + SUBMISSION_REMINDER
  delivery.test.ts   # NEW
```

### Known Gotchas of our codebase & Library Quirks

```ts
// ESM: import with ".js" suffix — `import { takeSnapshot } from "./snapshots.js";`
// takeSnapshot BEFORE bumpEpoch — never wire this onto the "epoch-bumped" event (fires post-increment → mislabeled snapshot)
// details.epoch / content "(state epoch {n})" use the PRE-bump epoch; only state.epoch ends up post-bump
// one buildSubmission call = exactly one snapshot + one bump, even with zero changed entries (matches recordAnswers)
// do NOT call pi.sendMessage / any pi API here — S2 owns transport; keep delivery.ts's builder half framework-free (sendMessage lives in the same file only in S2)
// note is details-only — putting it in content breaks the ≤3-line budget
// DiffEntry.to is already label-preferred and UNtruncated (snapshots.ts) — truncation to the line budget is THIS module's job
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/delivery.ts
  - EXPORT SUBMISSION_REMINDER = "Consider how these affect your other questions."
  - EXPORT interface SubmissionMessage per Goal; reuse DiffEntry/SubmissionCardData types from ./snapshots.js
  - EXPORT const SUBMISSION_LIST_MAX_CHARS = 240 (tunable const; Mode A JSDoc on buildSubmission documents the ≤3-line content budget and the truncation rule "+{m} more")
  - IMPLEMENT buildSubmission(state, diff, note?):
      1. entries = diff.changed.map(e => `${e.id}: ${e.to}${e.editedArchived ? " (changed)" : ""}`)
      2. budget loop: while joined.length > SUBMISSION_LIST_MAX_CHARS && entries.length > 1 → pop last, count dropped; append `+{m} more` when dropped > 0
      3. content = `Submitted ${diff.changed.length}: ${joined}\n` + SUBMISSION_REMINDER
      4. takeSnapshot(state); state.bumpEpoch()
      5. return { customType: "interrogation-submission", content, display: true, details: { changed: diff.changed, ...(note ? {note} : {}), epoch: diff.epoch, card: diff } }
  - NAMING: snake-free, file delivery.ts per h2.12 module layout

Task 2: CREATE src/delivery.test.ts
  - FOLLOW pattern: src/snapshots.test.ts (fixture states via createInterrogationState + applyAnswer + takeSnapshot for prev side)
  - CASES:
    (a) happy path: 2 changed answers → content exactly "Submitted 2: q1: SQLite; q2: Postgres\nConsider how these affect your other questions."; details.card === diff object; display true; customType correct
    (b) editedArchived entry gets " (changed)" suffix; non-archived does not
    (c) epoch: state.epoch before = n; after call = n+1; message details.epoch = n; snapshot ring last entry .epoch === n
    (d) exactly-one-snapshot: ring length delta === 1
    (e) note passthrough: present when non-empty string; key absent when undefined or ""
    (f) truncation: 30 entries with 60-char values → line 1 ends "+{m} more", total content ≤3 lines, k still 30 in "Submitted {k}"
    (g) zero changes: "Submitted 0: (no changes)" + reminder; still one snapshot + one bump
    (h) reminder byte-exactness vs SUBMISSION_REMINDER constant
```

### Implementation Patterns & Key Details

```ts
// Budget loop core (the only non-trivial logic):
let list = entries.join("; ");
let dropped = 0;
while (`Submitted ${k}: ${list}`.length > SUBMISSION_LIST_MAX_CHARS && entries.length - dropped > 1) {
  dropped++;
  list = entries.slice(0, entries.length - dropped).join("; ");
}
if (dropped > 0) list += `; +${dropped} more`;

// Side-effect tail (order is the contract):
takeSnapshot(state);   // pre-bump epoch label — snapshots.ts caller contract
state.bumpEpoch();
return message;
```

### Integration Points

```yaml
DOWNSTREAM (do NOT implement here):
  - P1.M2.T1.S2: pi.sendMessage(buildSubmission(...), { triggerTurn: true, deliverAs: "steer" })
  - P1.M7.T3.S1: registerMessageRenderer("interrogation-submission") reads message.details.card
  - P1.M3 panel ctrl+s: flush drafts via applyAnswer → computeDiff → buildSubmission
STATE: none beyond takeSnapshot + bumpEpoch (already-implemented primitives)
CONFIG: none
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npx vitest run src/delivery.test.ts
```

### Level 2: Unit Tests

```bash
npm test   # full suite green; no regressions in S4 snapshot tests
```

### Level 3: Integration Testing

None possible yet (transport is S2, panel is M3). Verify importability from a scratch vitest file or via typecheck only.

### Level 4: Domain Validation

Manual review checklist against h3.6: content 2 lines; epoch semantics documented; side-effect order matches spec order (build → snapshot → bump).

## Final Validation Checklist

- [ ] `npm run typecheck` clean; `npm test` all green
- [ ] Content format matches h3.6 exactly; reminder byte-exact; ≤3 lines always (test f)
- [ ] takeSnapshot before bumpEpoch; exactly one of each per call (tests c, d)
- [ ] details carries {changed, note?, epoch (pre-bump), card}; display: true; customType "interrogation-submission"
- [ ] No pi API / UI / transport calls in delivery.ts's builder
- [ ] Mode A JSDoc on buildSubmission documenting the ≤3-line content budget and caller flush precondition

## Anti-Patterns to Avoid

- ❌ Don't snapshot after bumpEpoch (mislabels the ring; breaks digestSince chains)
- ❌ Don't include the note in content — details only
- ❌ Don't re-derive from/to summaries — computeDiff already did (label-preferred); this module only formats and truncates
- ❌ Don't call pi.sendMessage here — S2 owns transport
- ❌ Don't bump epoch per answer — one submission = one bump
- ❌ Don't skip snapshot on empty diffs — ring consistency matters to stale guards

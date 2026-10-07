# PRP — P1.M3.T1.S1: guards.ts fresh-receiver + all-new-ids exemption from the epoch-equality throw (BUG-005)

---
name: "P1.M3.T1.S1 — Accept honest epoch echoes on the completed-swap first upsert"
description: "Fix PRD h2.3/h3.4 BUG-005: after completion swaps in a fresh receiver (src/tool.ts:282-303, epoch 1, empty questions), a model echoing its last-read epoch (per tool-schema.ts:114's own guidance) hits the epoch-equality throw at src/guards.ts:245-246 with a meaningless STALE ('Changes since epoch 2: (none)'). Add the scoped exemption: skip the epochStale throw when `state.epoch === 1 && state.orderedQuestions().length === 0` AND `parsed.questions.every(q => state.getQuestion(q.id) === undefined)` (fresh receiver + all-new-ids batch). Do NOT exempt all-new-id batches on non-empty states (would flip guards.test.ts:169 and weaken rotation guards). Fix the false 'trivially passes' comment at tool.ts:297-300. TDD new tests in tool.test.ts (completed-swap describe ~:275-345) and guards.test.ts; purity pins (:431, :500) must stay green. Mode A doc updates: guards.ts module docblock, tool.ts comment, spec/decisions.md BUG-005 companion pin."
---

## Goal

**Feature Goal**: The first upsert of a NEW interrogation after completion accepts an honest epoch echo (any sent epoch) when the receiver is freshly swapped (epoch 1, zero live questions) and the batch introduces only new ids — eliminating the one spurious STALE round-trip per new interrogation that every epoch-echoing model currently pays (BUG-005). All other guard behavior is byte-identical.

**Deliverable**: One conditional change in `src/guards.ts:245-246` (the epoch-equality throw), corrected comment in `src/tool.ts:297-300`, updated guards.ts module docblock, appended BUG-005 companion pin in `spec/decisions.md` (next to the 2026-09-14 line at :32), plus new TDD tests in `src/tool.test.ts` and `src/guards.test.ts`. No state fields, no new imports, no schema/executor changes.

**Success Definition**: `npm test` + `npm run typecheck` green. Post-completion, `executeInterrogate({epoch: 2, questions: [qi("n1")]}, tuiCtx())` succeeds with `getState().epoch === 1` and envelope reporting epoch 1 (self-correcting echo). Existing pins untouched: epoch-less swap variants (tool.test.ts:277, :297), non-completed stale tests (:220, :349), record-path epoch guards, guards.test.ts:169 (non-empty-state new-id mismatch still throws), purity/hygiene pins (:431, :500).

## User Persona

**Target User**: The agent model following the tool's own epoch guidance across interrogation boundaries.

**Use Case**: Interrogation 1 completes (model last saw `epoch 2`); model starts interrogation 2 by echoing that epoch on an all-new-questions upsert, exactly as tool-schema.ts:114 instructs ("include the epoch from your last read/result").

**User Journey**: complete → new upsert with `epoch: 2` → **succeeds** (was: spurious `STALE: session epoch is 1 (you sent 2). Changes since epoch 2: (none). Re-apply against current state.`) → result envelope reports `epoch: 1` → model's next echo self-corrects.

**Pain Points Addressed**: one wasted error round-trip per new interrogation for every conforming model; a staleness signal whose own digest proves nothing changed ("(none)").

## Why

- PRD h2.3/h3.4 (BUG-005) + h2.5 last recommendation: "Exempt the completed-swap fresh-state path from the epoch equality check (accept any epoch on the first upsert against a freshly swapped state) so honest epoch echoes stop paying a spurious STALE round trip."
- The spec's guard contract promises one-round-trip self-healing — this removes a round trip that was pure friction, not healing.
- Aligns behavior with the schema's own guidance (tool-schema.ts:114: epoch is "optional for a first upsert of brand-new questions") — currently the batch-level equality check fires anyway.
- Output consumed by P1.M3.T2.S1 (README epoch-guidance note must describe the new exemption).

## What

### The edit (exact — verified against current source)

**1. `src/guards.ts:245-246`** — replace:

```ts
  // upsert — epoch guard (every rev passed; caller sent a mismatched epoch).
  const sentEpoch = parsed.epoch;
  if (sentEpoch !== undefined && sentEpoch !== state.epoch) throw epochStale(state, sentEpoch);
```

with:

```ts
  // upsert — epoch guard (every rev passed; caller sent a mismatched epoch).
  // BUG-005 exemption: a FRESH receiver (epoch 1, zero live questions — the
  // completed-swap state from tool.ts, or a genuine session-first create)
  // accepts ANY sent epoch when the batch is all-new ids: nothing on such a
  // state can be stale (digestSince returns "" — the old signal said
  // "(none)"), and the schema's own guidance tells models to echo their
  // last-read epoch. Deliberately NOT a blanket all-new-ids exemption: on a
  // non-empty state, an epoch mismatch still guards question-set rotations
  // (guards.test.ts:169 pins this).
  const sentEpoch = parsed.epoch;
  const allNewIds = parsed.questions.every((q) => state.getQuestion(q.id) === undefined);
  const freshReceiver = state.epoch === 1 && state.orderedQuestions().length === 0;
  if (
    sentEpoch !== undefined &&
    sentEpoch !== state.epoch &&
    !(freshReceiver && allNewIds)
  ) {
    throw epochStale(state, sentEpoch);
  }
```

**Placement note**: keep this AFTER the presence guard (guards.ts:229-243) exactly where the current check sits — ordering pins (stale rev wins first, presence guard second, equality last) are test-enforced. `epochStale`/`digestSince` are already in scope — **no new imports** (hygiene pin guards.test.ts:500).

**Verified no-op interactions on a fresh receiver** (dossier §4): every parsed id is new → rev loop (190-226) no-ops; the batch either sends epoch (presence guard only fires when epoch is absent) or is all-new-id exempt. Re-sent OLD ids from the previous interrogation are also "new" to the fresh state — exempting is correct (the old state no longer exists).

**Record path untouched** (guards.ts:183-188): a stale-epoch `answers[]` call right after the swap still STALEs — that is a true heal (the model must read the fresh state); pins at guards.test.ts:372/:388 stay green.

**2. `src/tool.ts:297-300`** — fix the false comment. Replace the trailing claim in:

```ts
      // StaleError propagates (h2.22) — BEFORE any mutation. Runs against the
      // state that will RECEIVE the upsert (guards belong to the receiver): on
      // a fresh swap state this trivially passes (epoch 1, no existing ids).
```

with a truthful version:

```ts
      // StaleError propagates (h2.22) — BEFORE any mutation. Runs against the
      // state that will RECEIVE the upsert (guards belong to the receiver).
      // BUG-005: a fresh swap state (epoch 1, no live ids) EXEMPTS an
      // epoch-mismatched all-new-id batch in assertFresh — an honest echo of
      // the completed interrogation's last epoch passes; the result envelope
      // reports epoch 1 so the next echo self-corrects.
```

**3. `src/guards.ts` module docblock** — [Mode A] extend the upsert epoch-guard description with the exemption rule (fresh receiver + all-new-ids accepts any epoch; non-empty states unchanged; record path unchanged). Keep every other sentence of the docblock intact.

**4. `spec/decisions.md`** — append a BUG-005 companion pin directly after the 2026-09-14 line at :32, following the file's bullet style:

```
- 2026-10-XX bugfix pin (BUG-005, companion to the 2026-09-14 swap pin): "guard-friendly first upserts" extends to epoch-carrying ones on a freshly swapped state — assertFresh accepts ANY sent epoch when the receiver is fresh (epoch 1, zero live questions) and the batch is all-new ids; the digest is provably empty ("(none)") so the mismatch signal carried no information. Deliberately scoped: all-new-id batches on NON-empty states still epoch-STALE (rotation guard, guards.test.ts:169); the record path is untouched (a stale-epoch answers call is a true heal). Detected by invariant (no new state field — serialize/hygiene pins forbid one).
```

(Date: use the current date; match the file's existing pin voice.)

### TDD tests

**`src/tool.test.ts`** — completed-swap describe (~:275-345), write failing-first:

- `test_completed_swap_first_upsert_with_epoch_echo_succeeds`: complete interrogation 1 (upsert q1 → answer → submit → settle → complete, reuse the describe's existing completion helper), then `executeInterrogate({goal: "g2", epoch: 2, questions: [qi("n1")]}, tuiCtx())` → no throw; `getState().epoch === 1`; `result.details.epoch === 1` (or `details.state.epoch === 1` — match the envelope assertions at tool.test.ts:373-375); n1 present in state.
- `test_completed_swap_epoch_echo_envelope_self_corrects` (can fold into the above): the result's status line / envelope carries epoch 1 so the model's next echo is correct.
- Keep green unchanged: `:277` (epoch-less second completion), `:297` (fresh singleton swap assertions — extend, don't flip), `:320/:327/:336/:340`, and the NON-completed stale tests `:220` and `:349` (still `toThrow(StaleError)`, state unchanged).

**`src/guards.test.ts`**:

- `test_fresh_state_all_new_ids_accepts_mismatched_epoch`: `createInterrogationState("g")` (epoch 1, empty), `assertFresh(state, {questions: [newQ("n1"), newQ("n2")], epoch: 42})` → returns without throwing.
- `test_fresh_state_with_one_existing_id_still_throws_on_mismatch` (cannot occur via the swap, but pins the conjunction): seed one question into a state at epoch 1, send `{questions: [newQ("n2")], epoch: 2}` → still throws epochStale.
- `test_nonempty_state_all_new_ids_mismatched_epoch_still_throws` (the control): non-empty state (≥1 live question), `{questions: [newQ("x")], epoch: 999}` → throws — this is the existing `:169` behavior; **first verify the `:169` fixture** (research §5.1): if `:169`'s state is non-empty, it IS this control — keep it green as-is and add the fresh-state sibling; if it is empty, narrow/rename it with a rationale comment (it pinned pre-BUG-005 behavior) and add the non-empty control.
- Purity pins `:431` (guards never mutate/emit) and `:500` (import hygiene: type-only state/tool-schema imports + digestSince) must pass unmodified.

### Success Criteria

- [ ] Post-completion epoch-echo upsert succeeds; state epoch stays 1; envelope reports epoch 1.
- [ ] Non-empty-state new-id mismatched epoch still throws (rotation guard intact).
- [ ] Record-path epoch guards unchanged (stale answers after swap still STALE).
- [ ] tool.ts:297-300 comment truthful; guards.ts docblock updated; decisions.md pin appended.
- [ ] All existing pins listed above green; purity/hygiene pins unmodified.
- [ ] `npm test` + `npm run typecheck` green.

## All Needed Context

### Context Completeness Check

A fresh implementer has: the exact seam (verified source snippets), the exact patch, the test map with line anchors, the fixture-verification caveat, and the docs convention. Everything below was verified by read against the current tree.

### Documentation & References

```yaml
- docfile: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/architecture/epoch-completed-swap.md
  why: THE dossier — full seam map with verbatim source at every anchor (§1), guard mechanics incl. the throw site and message assembly (§1b), tests pinning current behavior with line anchors (§3), the recommended patch (§4), risks incl. the :169 fixture caveat (§5)
  critical: §4 "Rev-guard interaction: none" — on a fresh state the rev loop and presence guard are no-ops; only line 246 can fire. §5.1 — verify the :169 fixture's state before deciding to keep/narrow it

- file: src/guards.ts
  why: assertFresh (180-239): rev loop 190-226, presence guard 229-243, THE throw site 245-246, epochStale 248-257; record path 183-188 untouched
  pattern: existing comment style (BUG-id'd rationale blocks) — match it
  gotcha: NO new imports (hygiene pin :500); no state mutation (purity pin :431)

- file: src/tool.ts
  why: completed-swap block 282-303 (createInterrogationState keeps ONLY the goal; epoch 1, completed=false, empty questions/snapshots); assertFresh call at 300 with the FALSE 'trivially passes' comment to fix; result envelope shape at 177
  gotcha: goal handling on swap (capped.goal vs retained) is BUG-001/BUG-009 territory — do not touch

- file: src/tool-schema.ts
  why: epoch field description at :114 — the guidance that CAUSES honest echoes ("include the epoch from your last read/result"); the fix aligns behavior with it. Do NOT edit the schema text in this task (P1.M3.T2.S1 sweeps docs)

- file: src/snapshots.ts
  why: digestSince (361-375) returns "" when epochFrom >= state.epoch — why the STALE digest renders "(none)" (the meaningless-signal proof cited in the decisions pin)

- file: src/tool.test.ts
  why: completed-swap describe ~:275-345 — existing tests to keep green (:277, :297, :320, :327, :336, :340) and the non-completed stale pins (:220, :349); envelope epoch assertions at :373-375
  pattern: reuse the describe's completion helper and tuiCtx()/qi() fixtures

- file: src/guards.test.ts
  why: :146 and :169 (epoch-only mismatch pins — :169 is the fixture-verify target), :226/:259 (pass cases), :372/:388 (record path — must be untouched), :431 (purity), :500 (import hygiene)

- file: spec/decisions.md
  why: :32 the 2026-09-14 BUG-002 swap pin — append the BUG-005 companion directly after it, matching the bullet-pin voice (see dossier §1d for the verbatim existing pin)
  gotcha: NEVER modify existing pins — append only

- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/P1M2T2S2/PRP.md
  why: the parallel item (moot-reason test de-masking) touches only panel UI tests — zero overlap; no coordination needed beyond not colliding in guards/tool test files (it doesn't)
```

### Current Codebase tree (relevant excerpt)

```bash
src/guards.ts        # assertFresh + the throw site (main edit)
src/tool.ts          # swap block + false comment (comment edit only)
src/tool-schema.ts   # epoch guidance text (:114) — read-only here
src/snapshots.ts     # digestSince — read-only
src/tool.test.ts     # new TDD tests (completed-swap describe)
src/guards.test.ts   # new tests + fixture verification of :169
spec/decisions.md    # appended BUG-005 pin
```

### Desired Codebase tree

```bash
# No new files. Edits: guards.ts (conditional + docblock), tool.ts (comment),
# decisions.md (append), tool.test.ts + guards.test.ts (new tests).
```

### Known Gotchas

```ts
// NO new imports into guards.ts (hygiene pin :500 scans imports).
// NO state fields — serialize() would persist one and the hygiene pin forbids
//   the pattern; the epoch-1+empty invariant is the detector.
// Do NOT blanket-exempt allNewIds on non-empty states — :169 pins rotation
//   guards; the PRD explicitly scopes the exemption to the fresh receiver.
// Keep the check AFTER the presence guard — ordering is pinned.
// record path (183-188) is a different branch — untouched, its pins are :372/:388.
// StaleError still propagates uncaught from tool.ts (Mode A; pi sets isError).
// qi()/tuiCtx()/completion helper names live in tool.test.ts — reuse, don't invent.
```

## Implementation Blueprint

### Data models

None changed. The exemption is a derived predicate (`freshReceiver && allNewIds`), not a model.

### Implementation Tasks (ordered)

```yaml
Task 1: TDD — write the failing tests first
  - tool.test.ts completed-swap describe: epoch-echo success test (assert no throw, epoch 1, envelope epoch 1)
  - guards.test.ts: fresh-state exemption test + non-empty control; FIRST read the :169 fixture and decide keep-vs-narrow (per dossier §5.1)
Task 2: EDIT src/guards.ts:245-246 — the scoped conditional (exact patch in What §1)
Task 3: EDIT src/guards.ts module docblock — extend the upsert epoch-guard description (Mode A)
Task 4: EDIT src/tool.ts:297-300 — truthful comment (exact text in What §2)
Task 5: APPEND spec/decisions.md BUG-005 companion pin after the :32 line
Task 6: VALIDATE — npx vitest run src/guards.test.ts src/tool.test.ts; then npm test + npm run typecheck
```

### Implementation Patterns & Key Details

The exact patch and comment text are in What §1–§2 — copy them. The predicate must be computed at the guard site, not passed in (guards are pure functions of `(state, parsed)`; purity pin).

### Integration Points

```yaml
GUARD CALLER: src/tool.ts:300 assertFresh(state, parsed.action) — no signature change
CONSUMERS:
  - P1.M3.T2.S1 README sweep: must document the exemption in the epoch-guidance note
DO NOT TOUCH:
  - tool-schema.ts text, tool.ts swap/goal logic, record path, snapshots.ts
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # zero errors
```

### Level 2: Unit Tests

```bash
npx vitest run src/guards.test.ts src/tool.test.ts
npm test            # full suite green — esp. :169 (or its narrowed rename), :431, :500, tool :220/:277/:297/:349
```

### Level 3: Bug-report repro (headless, public seam — matches repo's probe style)

```bash
# vite-node probe: upsert q1 → answer → submit → settle → complete →
# executeInterrogate({goal:'g2', epoch:2, questions:[{id:'n1',...}]}, tuiCtx())
# EXPECT: succeeds (no StaleError), getState().epoch === 1, details epoch 1.
# Control: same but with a question id that EXISTS on a non-empty live state + wrong epoch → still StaleError.
```

### Level 4: Not applicable — pure guard logic, no UI/bridge surface.

## Final Validation Checklist

- [ ] `npm test` + `npm run typecheck` green
- [ ] BUG-005 repro passes (epoch echo accepted, envelope self-corrects)
- [ ] Rotation guard control passes (non-empty + new-ids + wrong epoch throws)
- [ ] Record-path pins, purity pins, hygiene pins green and unmodified
- [ ] `git diff` shows: guards.ts conditional+docblock, tool.ts comment, decisions.md append, two test files only
- [ ] decisions.md pin reads as companion to the 2026-09-14 swap pin

## Anti-Patterns to Avoid

- ❌ Don't exempt `allNewIds` without the freshReceiver conjunct — flips :169 and weakens live-state rotation guards
- ❌ Don't add a state field, import, or flag — invariant detection only (hygiene/purity pins)
- ❌ Don't touch the record path, schema text, or swap/goal logic
- ❌ Don't edit or weaken existing decision pins — append only
- ❌ Don't assert success without the envelope-epoch self-correction assertion — that's the contract P1.M3.T2.S1 documents

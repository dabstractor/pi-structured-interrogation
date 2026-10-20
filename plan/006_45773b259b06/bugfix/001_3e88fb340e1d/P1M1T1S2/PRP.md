# PRP — Bugfix P1.M1.T1.S2: DiffEntry += optional `text`/`custom`; computeEntries copies them (src/snapshots.ts)

## Goal

**Feature Goal**: Producer half A of BUG-001's fix (PRD h3.0, Recommendation 1): submission diffs must carry the FULL answer shape so replay can restore it. Extend `DiffEntry` (src/snapshots.ts:90-115) with optional `text?: string` (elaboration) and `custom?: boolean` (WRITEIN-001 write-in marker), and copy both in `computeEntries` (:284-309) from the next-side answer — using the interface's conditional-spread convention so legacy shapes stay byte-identical when no elaboration/write-in exists.

**Deliverable**: Extended `DiffEntry` interface + enriched `entries.push` in `src/snapshots.ts` (+JSDoc) and new rows in `src/snapshots.test.ts`.

**Success Definition**:
- Elaborated choice answer → entry carries `text: "<elaboration>"`, no `custom` key
- Custom write-in → entry carries `custom: true`, no `text` key
- Plain/absent answer → NEITHER key present (`"text" in entry === false`) — legacy byte-identical
- Text-only elaboration edit (same value, changed text) still produces an entry (answerSignature) and now carries `text`
- `from`/`to`/`editedArchived`/`value` behavior unchanged; full suite + typecheck + lint green

## Why

BUG-001: restart reconstruction replays submission deltas value-only because DiffEntry never carried `answer.text`/`answer.custom` — after a hard kill inside the 2s mirror debounce, replayed answers lose elaborations (TRUST-001 read surface, completion record) and write-in markers (✎ rendering, ANSWER-PIN-001 ✎-row pinning). This subtask is the carrier half; the synthetic seam (S3) and `replaySubmission` application (S4) follow, with the end-to-end regression in S5.

## What

1. **DiffEntry** (snapshots.ts:90-115): add two optional fields after `value?`, each with JSDoc mirroring `value?`'s "machine-readable reconstruction data" contract:
   - `text?: string` — present ONLY when the next-side `answer.text` is a non-empty string
   - `custom?: boolean` — present ONLY when next-side `answer.custom === true`
2. **computeEntries** (:284-309): extend the `entries.push` with conditional spreads in the same style as the existing `prompt` spread:
```ts
...(after?.answer?.text !== undefined && after.answer.text !== "" ? { text: after.answer.text } : {}),
...(after?.answer?.custom === true ? { custom: true } : {}),
```
3. **Do NOT touch**: `from`/`to` (display-only summaries), `editedArchived`, `value`, `answerSignature`, `computeDiff`'s contract. Pure module — no mocks, no state changes.
4. **Docs [Mode A]**: the two field JSDocs (and the computeEntries doc block's answer-fields sentence, if present) ride with this change — no separate docs task; README sync is P1.M3.T2's.

### Success Criteria

- [ ] 5 test rows green (elaborated / write-in / plain-absent / text-only edit / existing-fields-unchanged)
- [ ] Legacy entries byte-identical (no `text`/`custom` keys when not applicable)
- [ ] Existing snapshots.test.ts rows untouched and green
- [ ] `npm run typecheck` + `npm test` + `npm run lint` green

## All Needed Context

### Context Completeness Check

Repo green at HEAD (S1 confirms baseline). The DiffEntry interface, the computeEntries push, and the answer shape were read verbatim from the working tree and are quoted in the research notes; the implementing agent needs this PRP plus `src/snapshots.ts`, `src/snapshots.test.ts`, and (read-only) `src/state.ts:43-49`.

### Documentation & References

```yaml
- file: plan/006_45773b259b06/bugfix/001_3e88fb340e1d/architecture/bug001-submission-replay.md
  why: "§1-§3 the verified pipeline: answer shape, DiffEntry (quoted verbatim), producer A computeEntries, producer B (S3's synthetic seam — explicitly named in snapshots.ts's FULL-TRANSCRIPT-001 JSDoc ~:70-73)"
  critical: "answerSignature is value+text — a text-only edit already produces an entry; today's entry then DROPS the text, which this subtask fixes"

- file: plan/006_45773b259b06/bugfix/001_3e88fb340e1d/P1M1T1S2/research/notes.md
  why: "verbatim current code + the exact new field JSDoc drafts + the 5-row test matrix"

- file: src/snapshots.ts
  why: "DiffEntry :90-115 (value? JSDoc :105-113 is the mirror-contract template), computeEntries :284-309 (push at :301-308; the prompt conditional-spread :303 is the convention to copy)"
  pattern: "conditional spread `...(cond ? { key: val } : {})` — keep keys ABSENT, never null/false/empty"

- file: src/state.ts (:43-49, read-only)
  why: "QuestionAnswer { value, text?, custom?, at? } — the source fields; applyAnswer spreads {...answer}, so replay application (S4) needs no state.ts change"

- file: src/snapshots.test.ts
  why: "existing computeDiff/computeEntries test conventions (serialized-state fixtures) — extend with the new rows; existing rows pin the legacy shape and must stay green unchanged"
```

### Current Codebase tree (relevant excerpt)

```bash
src/
├── snapshots.ts          # DiffEntry + computeEntries — MODIFY (only file)
├── snapshots.test.ts     # ADD rows — MODIFY (add only)
└── state.ts              # READ-ONLY (answer shape reference)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: keys must be ABSENT, not null/false/"" — the optional-key
//   convention (prompt?, value?) is what lets legacy entries and consumers
//   stay byte-identical; never write text: undefined into the pushed object.
// GOTCHA: `value` today is pushed unconditionally (undefined serializes away)
//   — that is value's established convention; the NEW fields use the explicit
//   conditional-spread (prompt's convention) per the contract wording.
// GOTCHA: guard `text` with BOTH !== undefined AND !== "" — an empty-string
//   elaboration must leave the key absent (non-empty string only, per contract).
// GOTCHA: `custom` ONLY when strictly === true — a legacy/false value must
//   leave the key absent.
// GOTCHA: don't touch answerSignature or the changed-list filtering — the
//   text-only-edit row depends on answerSignature ALREADY including text.
// GOTCHA: downstream JSON consumers (delivery details, card renderer, S4's
//   replay) tolerate unknown keys; adding keys only-when-meaningful keeps
//   every pinned byte-equality test green.
// GOTCHA: lint covers src/ — keep the spread formatting consistent with the
//   existing prompt spread line to avoid eslint line-length complaints.
```

## Implementation Blueprint

### Implementation Tasks (TDD-ordered)

```yaml
Task 1: ADD failing rows to src/snapshots.test.ts (extend the computeDiff/computeEntries describe)
  - Row 1 elaborated: next q1 answer {value:"a", text:"because"} (prev unanswered)
    → entry has text:"because", "custom" in entry === false
  - Row 2 write-in: answer {value:"free text", custom:true}
    → entry has custom:true, "text" in entry === false
  - Row 3 plain: answer {value:"a"} → neither key present
  - Row 4 text-only edit: prev {value:"a"}, next {value:"a", text:"updated"}
    → entry STILL produced (answerSignature) and text === "updated"
  - Row 5 legacy-parity: plain answer → id/title/from/to/editedArchived/value
    exactly as before (existing rows already pin this; keep them green)

Task 2: EXTEND DiffEntry (snapshots.ts :90-115)
  - Add text?/custom? after value? with the JSDoc drafts from the research
    notes (machine-readable reconstruction contract; optional-for-legacy)

Task 3: EXTEND the computeEntries push (:301-308)
  - Two conditional spreads per the What §2 sketch, matching the prompt
    spread's style; no other line touched

Task 4: RUN gates
  - npx vitest run src/snapshots.test.ts
  - npx vitest run src/delivery.test.ts src/panel/actions.test.ts src/renderers.test.ts
    (downstream consumers of the card/delta — additive keys must not flip any
    byte-equality assertion; if one flips on a NEW key being present where the
    test fixture has an elaboration, that test pinned the BUG — flip it and
    note it for S3/S5)
  - npm run typecheck && npm test && npm run lint
```

### Implementation Patterns & Key Details

```ts
// The extended push (excerpt; everything else unchanged):
entries.push({
  id,
  title,
  ...(prompt !== undefined ? { prompt } : {}),
  from: answerSummary(before),
  to: answerSummary(after),
  editedArchived: before?.status === "closed",
  value: after?.answer?.value, // RAW post-change value; undefined when unanswered/missing
  ...(after?.answer?.text !== undefined && after.answer.text !== ""
    ? { text: after.answer.text } : {}),
  ...(after?.answer?.custom === true ? { custom: true } : {}),
});
```

### Integration Points

```yaml
DOWNSTREAM: "S3 copies the same two fields in the panel's synthetic-entry seam (src/panel/actions.ts submit path — named in snapshots.ts's FULL-TRANSCRIPT-001 JSDoc as the OTHER producer); S4's replaySubmission reads entry.text/entry.custom with legacy guards; S5 runs the end-to-end regression"
CONSUMERS: "card renderer + delivery delta builder read from/to (display-only) — unaffected; details JSON gains keys only when elaboration/write-in present"
DOCS: "field JSDoc rides here; README restart/reconstruction sync is P1.M3.T2.S1"
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npm run lint
```

### Level 2: Unit Tests

```bash
npx vitest run src/snapshots.test.ts -v    # new rows + existing pin rows
npm test                                    # full 1624+ suite
```

### Level 3: Downstream consumer regression

```bash
npx vitest run src/delivery.test.ts src/renderers.test.ts src/panel/actions.test.ts src/reconstruct.test.ts
# additive keys only — all green; any flip = a test pinning the bug → flip + note for S3/S5
```

### Level 4: Shape matrix (manual)

- [ ] elaborated / write-in / plain / absent-answer / text-only-edit rows each verified; legacy JSON key-for-key identical for plain answers

## Final Validation Checklist

- [ ] `npm run typecheck` → 0; `npm test` green; `npm run lint` → 0
- [ ] DiffEntry has text?/custom? with mirror-contract JSDoc ([Mode A])
- [ ] computeEntries copies both via conditional spread; keys absent when not applicable
- [ ] from/to/editedArchived/value/answerSignature untouched
- [ ] Existing snapshots rows green unchanged; downstream suites green
- [ ] Only src/snapshots.ts (+snapshots.test.ts) modified

## Anti-Patterns to Avoid

- ❌ Don't write `text: undefined` or `custom: false` into entries — keys must be ABSENT
- ❌ Don't touch from/to summaries (display-only) or editedArchived
- ❌ Don't modify answerSignature or computeDiff's filtering logic
- ❌ Don't extend the synthetic seam here — that's S3 (actions.ts)
- ❌ Don't apply anything in replaySubmission here — that's S4
- ❌ Don't let an empty-string elaboration produce a key — non-empty only

---

**Confidence Score**: 10/10 — two optional fields + two conditional spreads in a pure module, with the current code quoted verbatim, the convention (prompt's spread) identified in-tree, JSDoc drafts provided, and a 5-row test matrix; downstream risk is bounded to additive JSON keys.

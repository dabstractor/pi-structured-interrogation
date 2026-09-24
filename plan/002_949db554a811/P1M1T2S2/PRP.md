# PRP — P1.M1.T2.S2: ✎ {text} in read results, completion record lines, recap card, fallback digest

## Goal

**Feature Goal**: Complete FR-D3 / WRITEIN-001 (h2.42, h2.38) display plumbing for the surfaces NOT covered by the parallel S1: the `read` result per-question one-liner (`src/results.ts questionLine`) shows `✎ {value}` (truncated) for `custom: true` answers instead of the raw value; the completion record lines and recap card render write-ins as `✎ {text}` — inherited for free from S1's `completionAnswerSummary` branch, so S2 verifies + documents rather than re-implements; the fallback digest is asserted unchanged (it never displays answers). Replay/reconstruction stays value-first with no special casing.

**Deliverable**: Modified `src/results.ts` (✎ branch in `questionLine` + Mode A docblocks on the read one-liner formatter), `src/delivery.ts` (Mode A docblock on the completion record builder noting write-in rendering — no logic change), plus additive tests in `results.test.ts`, `delivery.test.ts`, `renderers.test.ts`, `fallback.test.ts`. Mock nothing.

**Success Definition**:
- `npm run typecheck` + full vitest suite green
- A custom answer on a choice question renders ` · answered: ✎ my own text` in the `read` result one-liner (value sliced to 60 chars when longer, no ellipsis, no option lookup)
- The completion record line and recap card line for a custom answer contain `✎ ` (flowing from S1's `completionAnswerSummary` — no duplicate branch added)
- Fallback digest output is byte-identical with and without custom answers (regression assertions)
- Reconstruction/replay path untouched (value-first — verified by existing tests staying green)

## Why

WRITEIN-001 (h2.42): "Renderers, diff cards, and the completion record display write-ins as `✎ {text}`" and h2.38: recap card shows "write-ins as `✎ {text}` (truncated to fit)". S1 (parallel, Ready) covers the diff surfaces (`snapshots.answerSummary`, `delivery.completionAnswerSummary`, diff card). The read `{}` one-liner is the model's pull-refresh between auto-submits (h2.20) — a raw value there makes a write-in indistinguishable from a real option value exactly when the model is re-orienting. The completion record is the ONE full injection the model writes the spec from (h2.49) — its ✎ rendering is contractual for AC-2a's "card and delta render ✎ {text}" family.

## What

1. `src/results.ts` `questionLine` (:234-242): when `q.answer.custom === true`, render the answered segment as `` `✎ ${q.answer.value.slice(0, 60)}` `` (plain slice, no ellipsis — matches the function's existing prompt-fallback convention); non-custom answers keep the raw value exactly as today. Update the `buildReadResult` docblock (:100-127) where the one-liner format is documented, plus a JSDoc note on `questionLine` itself (Mode A).
2. `src/delivery.ts` completion record builder: **no logic change** — the record line already composes `entry.answer` from `completionAnswerSummary(q)`, which S1's PRP gives the ✎ branch. ADD a Mode A docblock note on the record line assembly (~:378): write-in answers arrive as `✎ {text}` from the summary helper; `— freeText` elaboration composes after it unchanged.
3. `src/renderers.ts` recap card: **no logic change** — line at :353 uses `q.answer` from the entry (summary-layer output); collapsed truncation via `truncateToWidth(line, COLLAPSED_LINE_BUDGET)` already satisfies "truncated to fit" and is ANSI-aware. Docblock already correct; no edit required unless phrasing drifts — optional one-line note allowed.
4. `src/fallback.ts`: **no change at all** — the digest displays questions/options only, never answers (h2.26). Add regression tests asserting the digest string is identical whether recorded answers are custom or not.
5. Tests: additive cases in the four named test files (see Tasks).

### Success Criteria

- [ ] `questionLine` for `{ value: "my own text", custom: true, at }` on a choice question → ` · answered: ✎ my own text`; a 100-char write-in shows `✎ ` + first 60 chars, no ellipsis
- [ ] Non-custom one-liners byte-identical to before (existing results tests untouched, green)
- [ ] Completion record line for a custom answer: `[group] {id} {title}: ✎ my own text` (+ ` — elaboration` when `answer.text` present) — via S1's branch, no duplicate ✎ code in delivery line assembly
- [ ] Recap card collapsed line for a custom answer contains `✎ ` and respects `COLLAPSED_LINE_BUDGET`; expanded contains the full write-in text
- [ ] Fallback digest string identical with custom vs non-custom recorded answers (asserted)
- [ ] Mode A docblocks present on the read one-liner formatter and the completion record builder
- [ ] `reconstruct.ts`, `state.ts`, `snapshots.ts`, `tool-schema.ts` NOT modified; `grep -rn "✎" src/` shows the literal in: snapshots.ts (S1), delivery.ts summary (S1) + record docblock, results.ts, renderers doc — no new logic-layer duplicates

## All Needed Context

### Context Completeness Check

The repo is fully implemented (930+ green tests). This PRP quotes the exact current code of every touchpoint, the S1 PRP contract for `custom` data flow and `completionAnswerSummary`, and the truncation conventions. An agent needs only this PRP plus the named files.

### Documentation & References

```yaml
- file: plan/002_949db554a811/P1M1T1S1/PRP.md
  why: "CONTRACT: answer.custom?: boolean flows schema → applyAnswer → serialize → revive; q.answer.custom === true is reliable in results/delivery/renderers"
  gotcha: strict `=== true` check (legacy payloads lack the key)

- file: plan/002_949db554a811/P1M1T2S1/PRP.md
  why: "CONTRACT (parallel, Ready): completionAnswerSummary gains `if (answer.custom === true) return `✎ ${answer.value}`;` — the completion record and recap card INHERIT it; do NOT re-add"
  gotcha: S1 also adds ✎+NEW-003 suffix in snapshots.answerSummary — not this item's surface

- file: plan/002_949db554a811/P1M1T2S2/research/notes.md
  why: line-exact excerpts of all four touchpoints + the 60-char-slice truncation decision + S1/S2 division of labor

- file: src/results.ts
  why: "questionLine :234-242 (THE raw-value display); buildReadResult docblock :100-127 documents the one-liner format — update both"
  pattern: "local truncation precedent: `q.prompt.slice(0, 60)` plain slice, no ellipsis (same function)"
  gotcha: "one-liner is model-facing PLAIN text — never ANSI/theme, never truncateToWidth here; title segment is contractually never truncated (don't change that)"

- file: src/delivery.ts
  why: "record line ~:378 composes `[{group}] {id} {title}: {entry.answer}` from completionAnswerSummary (:269) — S1's branch makes it ✎; add docblock only"
  gotcha: "`— freeText` suffix composes AFTER entry.answer — a custom answer with elaboration reads `✎ {text} — {elaboration}` with zero new code"

- file: src/renderers.ts
  why: "buildCompletionRecapCard :314, line :353 `q.answer ?? \"\"`; collapsed → truncateToWidth(line, COLLAPSED_LINE_BUDGET=80), expanded full — already WRITEIN-correct via entry.answer"
  gotcha: "truncateToWidth is ANSI-aware and runs AFTER theme composition — never String.slice in renderers"

- file: src/fallback.ts
  why: "digest = questions/options only; answers never rendered (h2.26) — zero code change, regression tests only"

- spec h2.42 (answer shape / WRITEIN-001), h2.38 (Renderers: recap card write-ins ✎ truncated to fit), h2.49 (completion record format), h2.20 (read action = full-content blocks; NEVER surfaces panel), h2.26 (fallback digest), h2.10 AC-2a — all in this PRP's task prompt
```

### Current Codebase tree (relevant excerpt)

```bash
src/
├── results.ts        # MODIFY: questionLine ✎ branch + docblocks (:115, :234-242)
├── delivery.ts       # MODIFY (docblock only, ~:378 record line assembly)
├── renderers.ts      # no change (line flows from entry.answer; truncation already correct)
├── fallback.ts       # no change
├── results.test.ts   # ADD: custom one-liner cases
├── delivery.test.ts  # ADD: completion record ✎ inheritance assertions
├── renderers.test.ts # ADD: recap card ✎ collapsed/expanded assertions
└── fallback.test.ts  # ADD: digest invariant w/ custom answers
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: do NOT add a second ✎ branch to delivery's record line or renderers' card line —
//   both compose from completionAnswerSummary/CompletionRecapEntry, which S1's branch already
//   prefixes. Duplicate logic here = drift risk the sync comments exist to prevent.
// CRITICAL: questionLine is plain model-facing text — slice(0,60), NOT truncateToWidth
//   (ANSI-aware helper is renderer-side only; results.ts has no pi-tui import and must not gain one).
// GOTCHA: `answer.custom === true` strict (legacy/persisted payloads lack the key).
// GOTCHA: slice applies to answer.value ONLY; keep the "✎ " prefix (U+2712 + space) always visible.
// GOTCHA: don't truncate or otherwise touch the title/id/status segments — "titles are short by
//   contract and never truncated" is documented behavior with existing tests.
// GOTCHA: don't touch buildStatusLine or group summaries — they count statuses, never render answers.
// GOTCHA: fallback tests must exercise the SAME digest input modulo answer customness — the digest
//   builder takes question state; record custom answers via the existing recordAnswers test seam
//   and assert digest equality, or assert the digest contains no "answered:" segment at all.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: src/results.ts — questionLine ✎ branch + Mode A docs
  - MODIFY questionLine (:234-242): replace
      `if (q.answer !== undefined) line += ` · answered: ${q.answer.value}`;`
    with:
      if (q.answer !== undefined) {
        // WRITEIN-001 (h2.42): value holds free text — ✎ prefix, sliced to 60 (plain, no
        // ellipsis, same convention as the prompt fallback above), never an option lookup.
        const shown = q.answer.custom === true ? `✎ ${q.answer.value.slice(0, 60)}` : q.answer.value;
        line += ` · answered: ${shown}`;
      }
  - UPDATE questionLine JSDoc (:233): document the write-in segment + 60-char slice rule
  - UPDATE buildReadResult docblock one-liner bullet (:115): ` · answered: {value}` gains
    "`✎ {value}` (sliced to 60) when the answer is a write-in (custom)"
  - REGRESSION: non-custom lines byte-identical; no pi-tui import introduced

Task 2: src/delivery.ts — Mode A docblock on the record builder (no logic)
  - On/above the `lines.push(`[${groupKey}] ...`)` site (~:378): docblock noting
    "write-in answers arrive as `✎ {text}` from completionAnswerSummary (WRITEIN-001, h2.42;
    ✎ branch lives THERE — do not re-derive here); ` — freeText` elaboration composes after it"
  - NO code change; the sync docblock on completionAnswerSummary (:264) is S1's scope

Task 3: tests — results.test.ts
  - ADD (follow existing describe/test style):
    * custom answer on a choice question → read result one-liner contains ` · answered: ✎ my own text`
    * 100-char custom value → `✎ ` + first 60 chars, no ellipsis, title/id segments intact
    * non-custom regression: existing assertions untouched and green

Task 4: tests — delivery.test.ts + renderers.test.ts (inheritance assertions)
  - delivery: build completion for a state with a custom answer → record content contains
    `✎ my own text`; with elaboration → `✎ my own text — because`; star still composes (`★`)
    when recommendation matched
  - renderers: recap card (buildCompletionRecapCard on the completion details) — collapsed line
    contains `✎ ` and respects COLLAPSED_LINE_BUDGET; expanded contains the full write-in text
  - NOTE: if S1 has NOT landed when implementing, these two tasks will fail on the missing
    summary branch — coordinate via plan status (S1 is a dependency; its PRP is the contract)

Task 5: tests — fallback.test.ts (non-regression)
  - Record (or stub-state) custom vs non-custom answers → digest markdown identical / contains
    no per-answer rendering; assert no "✎" appears in digest output (answers aren't shown —
    the digest is the ask-surface only)

Task 6: RUN gates
  - npm run typecheck && npm test
```

### Implementation Patterns & Key Details

```ts
// The one new branch (results.ts — plain text, local slice convention):
const shown =
  q.answer.custom === true
    ? `✎ ${q.answer.value.slice(0, 60)}`   // plain slice, no ellipsis — prompt-fallback precedent
    : q.answer.value;
// PATTERN: strict `=== true`; slice value only; prefix always visible.
// CRITICAL: NO second ✎ branch in delivery record assembly or renderers —
// both consume completionAnswerSummary output (S1 contract). Inheritance is the feature.
```

### Integration Points

```yaml
UPSTREAM (contracts, do not re-implement):
  - P1.M1.T1.S1: answer.custom end-to-end (state/revive/serialize)
  - P1.M1.T2.S1: completionAnswerSummary ✎ branch (feeds record lines + recap card entries)
DOWNSTREAM:
  - AC-2a scripted tests (ac-scripted.test.ts family): "card and delta render ✎ {text}" —
    this item makes the read one-liner consistent so the model's pull-refresh agrees with the cards
  - P2.M1.T1 auto-submit: small deltas + read between them — the ✎ one-liner is what the model
    sees between auto-submits; keep the literal stable
NO CHANGES to: state.ts, snapshots.ts, tool-schema.ts, fallback.ts, reconstruct.ts, renderers.ts logic
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run src/results.test.ts src/delivery.test.ts src/renderers.test.ts src/fallback.test.ts -v
npm test    # full suite green
```

### Level 3: Behavioral probe (pure formatting)

```bash
npx tsx -e "
import { buildReadResult } from './src/results.js';
const state = { goal: 'g', epoch: 1, order: ['q1'],
  questions: { q1: { id: 'q1', prompt: 'DB?', type: 'choice', rev: 1, status: 'answered',
    options: [{ value: 'pg', label: 'Postgres' }],
    answer: { value: 'my own take', custom: true, at: new Date().toISOString() } } } };
console.log(buildReadResult(state).content ?? JSON.stringify(buildReadResult(state)));
"   # expect the one-liner to contain ' · answered: ✎ my own take'
```

### Level 4: Domain validation

- [ ] Mode A docblocks present on questionLine (and its buildReadResult format bullet) + delivery record line assembly
- [ ] `grep -rn "✎" src/` — literal appears in snapshots.ts, delivery.ts (summary + docblock), results.ts, renderers doc/tests; NO logic-layer duplicate in delivery line assembly or renderers
- [ ] `git diff --name-only` — only results.ts, delivery.ts (docblock) + the four test files

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green
- [ ] Read one-liner shows `✎ {value}` (60-char slice) for custom; raw value otherwise, byte-identical to before
- [ ] Completion record + recap card render `✎ {text}` via S1's summary branch (inheritance verified by tests, no duplicate branch)
- [ ] Fallback digest unchanged with custom answers (asserted, no code change)
- [ ] Reconstruction/replay untouched; existing reconstruct tests green
- [ ] Mode A JSDoc on read one-liner formatter + completion record builder

## Anti-Patterns to Avoid

- ❌ Don't re-derive ✎ in delivery's record assembly or renderers' card line — inherit from completionAnswerSummary
- ❌ Don't use truncateToWidth/ANSI helpers in results.ts — the read result is plain text; slice(0,60)
- ❌ Don't add label lookup for custom values — write-ins bypass option lists entirely (h2.42)
- ❌ Don't touch answerSignature, state.ts, snapshots.ts, or reconstruct.ts — replay is value-first by design
- ❌ Don't change the "✎ " literal or slice budget without checking P2.M1.T1/AC-2a assertions
- ❌ Don't special-case reconstruction for ✎ — custom is data, not display

---

**Confidence Score**: 9/10 — every touchpoint read line-exact against the working tree; the only new logic is one plain-text branch in `questionLine`; the completion record/recap card inheritance from S1's `completionAnswerSummary` branch is verified in code. Residual risk: S1 must land first (explicitly sequenced in Task 4 with a coordination note).

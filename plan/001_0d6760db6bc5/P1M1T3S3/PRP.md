---
name: "P1.M1.T3.S3 — Caps engine: formula, truncation warnings"
description: "Create src/caps.ts exporting applyCaps(questions, goal, config, contextWindow) — a PURE soft-cap engine that truncates over-budget question/goal content and returns warnings. Soft caps ONLY: never reject (h2.23). Consumed by the upsert path (S4) which appends warnings to the result text."
---

## Goal

**Feature Goal**: A pure, fully unit-tested caps engine implementing PRD h2.23: per-question `description` capped by `max(config.caps.description, budget/questionCount)` chars where the shared description budget scales with the model's context window; `ramification` ≤ cap; options truncated to cap (recommendation always kept); question count hard-listed at cap with a warning; `goal` ≤ cap. All truncations produce human-readable warnings; over-budget content is NEVER rejected.

**Deliverable**: `src/caps.ts` + `src/caps.test.ts`. Exports:
- `applyCaps(questions: QuestionInput[], goal: string, config: InterrogatorConfig, contextWindow: number): { questions: QuestionInput[]; goal: string; warnings: string[] }`
- `descriptionCap(config: CapsConfig, contextWindow: number, questionCount: number): number` (exported for tests/docs)
- `CHARS_PER_TOKEN = 4` and `DESCRIPTION_BUDGET_CEILING = 60000` constants (exported — they ARE the formula)

**Success Definition**: vitest green, `npm run typecheck` clean; the h2.23 formula (budget = min(pct/100 × contextWindow × 4, 60000) chars, split across the batch) asserted numerically; the exact warning string format asserted; recommendation survives options truncation; module is pure (no pi imports, no state mutation).

## User Persona

**Target User**: The AI agent calling `interrogate` with oversized content; the extension developer wiring the upsert executor (S4).

**Use Case**: Model upserts 50 questions with 2100-char descriptions on a small-context model. Caps truncate content, keep 40 questions, and warn — the model restructures on the next turn instead of being hard-rejected.

**User Journey**: model upserts oversized batch → applyCaps trims → S4 appends warnings (`q7 description truncated at 2100 chars — restructure if essential`) to the result text → model sees exactly what was cut and why → adjusts or restructures.

**Pain Points Addressed**: silent context-window blowouts; opaque hard rejections that stall the interrogation loop.

## Why

- h2.23 (Q27=A): over-budget content truncates with an explicit warning in the tool result — NEVER a hard reject; all numbers overridable via config.
- Context-window hygiene: interrogator content must stay ≤ `contextBudgetPct` % of the model's window (h2.52 defaults: 4%).
- This is the only consumer of `config.caps` besides JSDoc — the caps engine IS the config-caps contract.

## What

1. **Signature**: `applyCaps(questions, goal, config, contextWindow)` — `questions` is the `QuestionInput[]` from S1's parsed upsert action (pass `parsed.questions`); `goal` is the goal string from the same action; `config` is the resolved `InterrogatorConfig` from `src/config.ts`; `contextWindow` is `ctx.model.contextWindow` (tokens), read by the executor (S4) and passed as a plain number. **Purity**: no state, no events, no pi imports — only `src/config.ts` and `src/tool-schema.ts` (type-only) imports.

2. **Description cap (h2.23 formula, chars)**:
   - `totalDescriptionBudget = min(config.caps.contextBudgetPct / 100 × contextWindow × CHARS_PER_TOKEN, DESCRIPTION_BUDGET_CEILING)` where `CHARS_PER_TOKEN = 4`, `DESCRIPTION_BUDGET_CEILING = 60000`.
   - `perQuestionBudget = floor(totalDescriptionBudget / max(questionCount, 1))` where `questionCount` is the count of questions in the INPUT array (before question-count truncation).
   - `cap = max(config.caps.description, perQuestionBudget)` — e.g. defaults: 128k window → budget 5120 chars → per-question 128 @ 40 questions → cap stays 1200; huge window → budget 60000 → 1500/question at 40 → cap 1500.
   - Per question: if `description.length > cap`, truncate the string to `cap` chars (plain `.slice(0, cap)`, no ellipsis logic — the WARNING carries the meaning) and push `` `${id} description truncated at ${originalLength} chars — restructure if essential` `` (match h2.23's tone exactly: `q7 description truncated at 2100 chars — restructure if essential`). Skip (no warning) when `description` is absent or already ≤ cap.

3. **Ramification cap**: each option's `ramification` string ≤ `config.caps.ramification`; on truncation push `` `${id} ramification truncated at ${originalLength} chars` ``. Absent/short values pass silently.

4. **Options cap**: keep the FIRST `config.caps.options` options in array order, PLUS the option whose `value === question.recommendation` if it was cut (re-append it at the end — recommendation must survive). If any options were dropped, push `` `${id} options truncated to ${keptCount} (recommendation preserved)` ``. Also clear/keep `recommendation` untouched — it names a surviving option by construction.

5. **Questions cap**: keep the FIRST `config.caps.questions` questions in input order; if any were dropped, push `` `questions truncated to ${config.caps.questions} — ${droppedCount} dropped` ``. Recompute nothing — description caps use the ORIGINAL count per §2 (budget was computed for the batch the model intended).

6. **Goal cap**: if `goal.length > config.caps.goal`, truncate and push `` `goal truncated at ${originalLength} chars` ``.

7. **Warnings toggle**: applyCaps ALWAYS returns warnings (it does not know about `gateWarnings`); the CONSUMER (S4) suppresses appending them to result text when `config.gateWarnings === false`. Document this in JSDoc so S4 doesn't re-derive the policy.

8. **Never throw**: malformed/absent optional fields are skipped, not errors. Return value questions are NEW objects (deep-copy the input questions before mutating — never mutate the caller's array or objects).

9. **JSDoc (Mode A)** on `applyCaps` including: the full formula in words and code, the config override names (`interrogator.caps.description|ramification|options|questions|goal|contextBudgetPct` in settings.json), the soft-cap philosophy ("truncates with warning, never rejects — h2.23"), and the warning string formats.

### Success Criteria

- [ ] Budget formula numeric assertions: default caps @ 128000-token window → cap 1200; @ 1M-token window → budget floors at 60000 → 1500/question @ 40 → cap 1500
- [ ] Exact warning strings asserted (including the h2.23 exemplar `q7 description truncated at 2100 chars — restructure if essential`)
- [ ] Recommendation survives options truncation even when it is the LAST option past the cap
- [ ] Question-count truncation keeps first N + warns; description budget uses pre-truncation count
- [ ] Inputs never mutated (deep-equal check before/after)
- [ ] `npm test` + `npm run typecheck` pass

## All Needed Context

### Context Completeness Check

An agent with no codebase knowledge gets: the exact formula, exact warning strings, the `QuestionInput`/`CapsConfig` contracts, and the consumer contract (S4). No guessing.

### Documentation & References

```yaml
- file: src/config.ts
  why: CapsConfig + InterrogatorConfig + DEFAULT_CONFIG.caps (1200/600/7/40/400/4) + gateWarnings
  pattern: import type { InterrogatorConfig, CapsConfig } from "./config.js"
  gotcha: config is ALREADY coerced/shape-guaranteed — no defensive parsing needed here

- file: plan/001_0d6760db6bc5/P1M1T3S1/PRP.md
  why: CONTRACT for QuestionInput / ParsedAction (action "upsert" carries goal? + questions)
  pattern: "type-only import from src/tool-schema.js"
  gotcha: S1 is implemented in PARALLEL — if the QuestionInput field names differ at integration time (e.g. option ramification), adapt the import/type, not the logic

- file: src/state.ts
  why: canonical field names for questions/options (Question, QuestionOption {value,label,ramification?}, recommendation)
  pattern: caps operates on QuestionInput (pre-merge), which mirrors these field names

- file: plan/001_0d6760db6bc5/architecture/pi-api-validation.md (line 55)
  why: ctx.model.contextWindow (tokens) confirmed — the executor reads it, applyCaps receives the number
  critical: keeps this module pure/unit-testable — no pi context import

- file: src/config.test.ts
  why: vitest conventions — colocated *.test.ts, describe/it, plain-object fixtures
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
  caps.ts        # NEW — CHARS_PER_TOKEN, DESCRIPTION_BUDGET_CEILING, descriptionCap, applyCaps
  caps.test.ts   # NEW — formula, warnings, recommendation-survival, purity
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// ESM: relative imports need .js suffix ("./config.js")
// PURE module: no pi imports, no state mutation, never throws — S4/S5 own orchestration
// Deep-copy inputs before truncating — callers' objects must stay pristine
// questionCount for the budget = INPUT count (before question truncation), per h2.23 "divided across the batch"
// gateWarnings suppression is the CONSUMER's job (S4) — applyCaps always reports
// Never append an ellipsis to truncated text — the warning carries the signal
```

## Implementation Blueprint

### Data models and structure

```ts
// src/caps.ts
import type { CapsConfig, InterrogatorConfig } from "./config.js";
import type { QuestionInput } from "./tool-schema.js";

export const CHARS_PER_TOKEN = 4;
export const DESCRIPTION_BUDGET_CEILING = 60000;

export interface CapsResult {
  questions: QuestionInput[];
  goal: string;
  warnings: string[];
}

export function descriptionCap(caps: CapsConfig, contextWindow: number, questionCount: number): number;
export function applyCaps(
  questions: QuestionInput[],
  goal: string,
  config: InterrogatorConfig,
  contextWindow: number,
): CapsResult;
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/caps.ts — formula primitives
  - IMPLEMENT: CHARS_PER_TOKEN, DESCRIPTION_BUDGET_CEILING, descriptionCap (floor division; max(1, questionCount))
  - NAMING: exact export names above; Mode A JSDoc with the formula + settings.json override names
  - PLACEMENT: src/caps.ts

Task 2: CREATE src/caps.ts — applyCaps
  - IMPLEMENT: deep-copy questions (structuredClone); description/ramification/options/questions/goal truncation + warnings per "What" §2-§9, in that order; recommendation-preserving options keep
  - GOTCHA: description cap computed from ORIGINAL input count BEFORE question truncation
  - DEPENDENCIES: descriptionCap

Task 3: CREATE src/caps.test.ts
  - FOLLOW pattern: src/config.test.ts (describe/it, plain fixtures, inline partial configs via { ...DEFAULT_CONFIG, caps: {...} })
  - CASES: budget formula @128k (cap 1200) and @1M (cap 1500); ceiling at absurd windows; questionCount 0/1 edge; exact h2.23 warning string; ramification truncation; options truncation keeps recommendation including when it's last; question-count truncation warning; goal truncation; no-warning paths (all-under-cap); input immutability (deep-equal before/after); config override respected (caps.description 2000)
```

### Implementation Patterns & Key Details

```ts
// Core skeleton (see "What" for exact strings/order):
export function applyCaps(questions, goal, config, contextWindow): CapsResult {
  const warnings: string[] = [];
  const count = questions.length;
  const descCap = descriptionCap(config.caps, contextWindow, count);
  const kept = structuredClone(questions).slice(0, config.caps.questions);
  if (count > config.caps.questions) warnings.push(`questions truncated to ...`);
  for (const q of kept) {
    // description > descCap → slice + warn; options → ramification cap, then keep-first-N + recommendation; goal last
  }
  return { questions: kept, goal: cappedGoal, warnings };
}
```

### Integration Points

```yaml
CONSUMERS (do NOT implement here):
  - P1.M1.T3.S4 upsert executor: const capped = applyCaps(parsed.questions, parsed.goal ?? "", config, ctx.model.contextWindow);
    merge capped.questions; append capped.warnings to result text UNLESS config.gateWarnings === false
  - P1.M2.T3.S1 debug commands: reuse applyCaps for scripted cap verification
EXPORTS: module-local for now (index.ts wiring is S6)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npx vitest run src/caps.test.ts
```

### Level 2: Unit Tests

```bash
npm test   # full suite green — no regressions
```

### Level 3: Integration Testing

Not applicable until S4 wires the executor. Fixture equivalence (covered in tests): applyCaps output feeds merge.upsert cleanly.

### Level 4: Domain Validation

Formula spot-check asserted in tests (1200 default / 1500 @ 1M window) — no runtime integration possible pre-S6.

## Final Validation Checklist

- [ ] `npm run typecheck` clean; `npm test` all green
- [ ] h2.23 formula asserted numerically; exact warning strings asserted byte-for-byte
- [ ] Recommendation survives options truncation; question-count truncation warns and keeps first N
- [ ] Pure module: never throws, never mutates inputs, no pi imports, `.js` import suffixes
- [ ] Mode A JSDoc on applyCaps with formula + config override names
- [ ] gateWarnings policy documented as the consumer's (S4) responsibility

---

## Anti-Patterns to Avoid

- ❌ Don't reject or throw on over-cap content — soft caps only (h2.23)
- ❌ Don't compute the description budget from the POST-truncation question count
- ❌ Don't drop the recommended option when truncating options
- ❌ Don't mutate the caller's questions array/objects — deep-copy first
- ❌ Don't suppress warnings inside applyCaps based on `gateWarnings` — the consumer decides rendering
- ❌ Don't hardcode cap numbers — everything flows from `config.caps`

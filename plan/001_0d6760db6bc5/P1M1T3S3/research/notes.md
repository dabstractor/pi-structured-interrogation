# P1.M1.T3.S3 research — caps engine

## Findings

- **Config contract (P1.M1.T1.S2, src/config.ts)** — `CapsConfig` = `{ description: 1200, ramification: 600, options: 7, questions: 40, goal: 400, contextBudgetPct: 4 }`, delivered shape-guaranteed by `loadConfig()` (coerced, never throws). `gateWarnings: boolean` exists and gates warnings rendering (h2.52).
- **Upstream input shape (S1, src/tool-schema.ts)** — `ParsedAction = { action: "upsert"; goal?: string; epoch?: number; questions: QuestionInput[] } | read | reopen | record`. `QuestionInput` is the pre-merge question payload (id, prompt, description?, type, options? (value/label/ramification?), recommendation?, rev?, ...). S1 already does question-count truncation per its PRP (line 29) — caps engine must OWN that per the contract here; coordination note: S1 may pre-trim count, caps re-enforce idempotently.
- **contextWindow access** — `ctx.model.contextWindow` (tokens) confirmed, pi-api-validation.md:55. Tool `execute(ctx)` reads it; `applyCaps` takes it as a plain number param so it stays unit-testable.
- **Formula (h2.23, verbatim)** — `description ≤ max(1200, budget/questionCount)` chars per question where `totalDescriptionBudget = min(0.04 × contextWindow, 60000)` tokens-equivalent, chars ≈ 4 × tokens. Warning format: `q7 description truncated at 2100 chars — restructure if essential`. NEVER hard reject; all numbers config-overridable.
- **Consumers** — upsert path (S4) calls `applyCaps` before merge; warnings appended to result text (S4). `gateWarnings` toggle suppresses warnings globally.
- **Question type (src/state.ts)** — `Question`, `QuestionOption {value,label,ramification?}`; recommendation is `question.recommendation` (option value string) — options truncation must "keep the recommendation", i.e. never drop the recommended option.
- **Test conventions** — vitest, colocated `*.test.ts`, plain object fixtures, no pi imports.
- **ESM** — relative imports need `.js` suffix; pure module: no pi imports, no state mutation.

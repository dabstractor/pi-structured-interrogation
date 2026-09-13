# Research — P1.M1.T3.S1 (Schema + action routing + validation)

## Codebase facts verified
- `src/state.ts` exports: `Question`, `QuestionOption`, `QuestionAnswer`, `DependsOn`, `InterrogationState`, `SerializedState`, `getState()/setState()/resetState()`. Question fields match h2.17 verbatim (id/title/prompt/description/type/options/recommendation/group/gate/dependsOn/rev/status/answer).
- `src/merge.ts` exports `applyUpsert(state, incoming: Question[]): UpsertResult`, `markAnswered`, `markSubmitted`, `closeSubmitted`. `UpsertResult = { transitions, revBumped, withdrawn, appended }`. `applyUpsert` expects full `Question[]` — tool layer must synthesize rev/status for new ids? NO: state.ts `upsertQuestion` forces rev 1/status "open" for new ids; merge.ts handles existing-id legality. Tool layer passes questions as-is; staleness guards (rev/epoch mismatch) are P1.M1.T3.S2, NOT this item.
- `src/config.ts` exports `InterrogatorConfig`, `CapsConfig` (`description`, `ramification`, `options`, `questions`, `goal`, `contextBudgetPct`), `DEFAULT_CONFIG`, `loadConfig`.
- Tests: vitest, colocated `src/*.test.ts` (see `src/state.test.ts`, `src/merge.test.ts`). Scripts: `npm test`, `npm run typecheck`. No lint configured.
- Imports: ESM `.js` suffix on relative imports (merge.ts uses `./state.js`).
- typebox: bare `import { Type } from "typebox"` (v1.3.7, pi dep). `StringEnum` from `@earendil-works/pi-ai` (root export, Google-compatible enum). Confirmed in plan/001_0d6760db6bc5/architecture/external-deps.md.
- Tool registration pattern (questionnaire example): `pi.registerTool({ name, label, description, parameters: <TypeBox schema>, async execute(toolCallId, params, signal, onUpdate, ctx) {...} })`. Registration itself is P1.M1.T3.S6 — this item only builds the schema + parse/route layer.

## PRD facts (h2.19/20/17 + h2.21–23 pulled from prd_snapshot)
- Four action shapes: `{questions:[...], goal?}` → upsert; `{}` → read; `{reopen:true}` → reopen; `{answers:[...]}` → record (non-TUI only, ignored in TUI).
- Validation: type=choice requires options with unique `value`s; recommendation must match an option value; ids non-empty; `rev` REQUIRED when updating existing question (enforcement in S2 guards; schema marks optional).
- Caps: truncate-with-warning, never reject. Question count cap = `caps.questions` (default 40).
- Guards h2.22 (rev/epoch stale throws) are S2's scope — S1's `parseInterrogateParams` must surface epoch + revs so S2 can compare, but must not throw stale errors itself.

## Routing precedence decision
Precedence (documented in PRP): `questions` present (non-empty array) → upsert; else `answers` present → record; else `reopen === true` → reopen; else read. Empty `questions: []` = read-with-withdraw-nothing → treat as read (nothing to withdraw); document as read action.

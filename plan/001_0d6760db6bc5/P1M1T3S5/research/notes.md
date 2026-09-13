# Research Notes — P1.M1.T3.S5 (Non-TUI fallback digest + answers action)

## Codebase facts verified
- `src/state.ts`: primitives are `applyAnswer(id, {value, text?, at})` (→ status "answered", never touches rev), `setStatus`, `bumpEpoch()` (emits epoch-bumped + changed, returns new epoch), `snapshots: Snapshot[]` ring, `serialize()`, `getQuestion`, `orderedQuestions`. There are NO `markAnswered`/`markSubmitted` methods — the work-item's "markAnswered + markSubmitted-equivalent" maps to: `applyAnswer` + `takeSnapshot`/ring push + `bumpEpoch` (answers delivered immediately since user already spoke — no delivery layer involvement; delivery.ts is P1.M2.T1 and is NOT used here).
- `src/tool-schema.ts`: `parseInterrogateParams` returns `ParsedAction` incl. `{action:"record", answers, epoch?}`; routing precedence questions→answers→reopen→read. `AnswerInput {id, value, text?}`.
- `src/guards.ts`: `assertFresh(state, parsed)` — record action is epoch-only guarded, throws `StaleError` with h3.8-shaped healing message. Executors let it propagate out of `execute` (pi sets isError only on throw — pi-api-validation.md:21).
- `src/snapshots.ts`: exports `digestSince(state, epoch)` (used by guards).
- S4 (parallel, contract): `src/results.ts` exports `buildStatusLine`, `buildReadResult`, `buildUpsertResult`, `InterrogateResult {content, details}`, `ResultDetails {state(structuredClone), epoch, statusLine, action: "upsert"|"read"|"reopen"|"record"}`. action "record" is reserved for THIS item's call site.
- S3 (parallel, contract): `src/caps.ts` exports `applyCaps(questions, goal, config, contextWindow) → {questions, goal, warnings}`.
- Mode guard: `ctx.mode !== "tui" || !ctx.hasUI` (pi-api-validation.md:54 — modes tui|rpc|json|print; hasUI false in print/json).
- Non-TUI guard reference pattern: reference-patterns.md:45 `if (ctx.mode !== "tui") return errorResult(...)` (questionnaire.ts:117-119).
- Tooling: vitest (`npm test`), `npm run typecheck`. Colocated `*.test.ts`.
- Statuses: open, answered, submitted, reasked, moot, withdrawn, closed.
- Snapshot ring: takeSnapshot exists? Verified `snapshots` field; ring push helper lives in snapshots.ts — check exports at implementation time (`digestSince` confirmed; a takeSnapshot/push may be state-internal — S4's guards.test mentions `takeSnapshot` in fixtures, so it exists in snapshots.ts or state.ts).

## PRD anchors
- h2.26 (FR-25): non-TUI fallback — numbered markdown digest (id, title, prompt, options with ★ marks, recommendation); description instructs model to relay verbatim in chat; user answers in next prompt; model records via answers[] epoch-guarded; read/completion identical; completion record injected once at close.
- h2.20: answers[] action → returns Status line; "Record user answers (non-TUI only; ignored in TUI)".
- h3.3 FR-20: four action shapes; answers is non-TUI only.
- AC context: M1 plan requires "Non-TUI fallback digest renders in `-p` mode" (AC-11 verified via `pi -p`).
- Status line format (h2.28, from S4): `{answered}/{total} answered · {reasked} re-asked · {moot} moot · epoch {n}`.

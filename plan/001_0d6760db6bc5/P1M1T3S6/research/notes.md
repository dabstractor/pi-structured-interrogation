# Research notes — P1.M1.T3.S6 (tool registration)

## Verified codebase facts (2025-XX, read directly)
- `src/index.ts`: factory registers only `interrogate-ping`; async factory is viable (pi extension entry supports async init; verify against docs/extensions.md extension entry shape during implementation).
- Upstream contracts confirmed by reading source:
  - `tool-schema.ts`: `InterrogateParams` (typebox), `ParsedAction` union (`upsert|read|reopen|record`), `ParseResult {ok, action?, errors, warnings}`, routing precedence questions→answers→reopen→read.
  - `guards.ts`: `assertFresh(state, parsed)` — read/reopen never guarded; record epoch-only (missing epoch = plain Error); StaleError propagates by design.
  - `caps.ts`: `applyCaps(questions, goal, config, contextWindow) → CapsResult {questions, goal, warnings}`.
  - `results.ts`: `buildStatusLine`, `buildReadResult`, `buildUpsertResult`, `InterrogateResult`, `ResultDetails`; `envelope()` is PRIVATE → tool.ts builds reopen/record/non-TUI envelopes inline.
  - `state.ts`: `getState/setState/resetState`, `createInterrogationState(goal)`, `StateEvents` incl. `questions-upserted` (the panel trigger), `bumpEpoch`.
  - `merge.ts`: `applyUpsert(state, Question[]) → UpsertResult`.
- `fallback.ts` does not exist yet — S5 in parallel; PRP treats its contract (isNonTui, buildFallbackDigest, recordAnswers) as given.

## pi API (from plan architecture/pi-api-validation.md, verified vs pi 0.85.1)
- `pi.registerTool({name, label, description, promptSnippet, promptGuidelines, parameters, execute(toolCallId, params, signal, onUpdate, ctx), renderCall(args, theme, context), renderResult(result, {expanded}, theme, context)})`.
- isError ONLY via throw (extensions.md:2068).
- `ctx.mode: tui|rpc|json|print`; `ctx.hasUI` false in print/json.
- Adaptation #5: promptGuidelines on the tool is THE mechanism — no global-guidelines API; description always resident for active tools.

## Renderer reference
- pi examples `todo.ts:15, 216-234`: `import { Text } from "@earendil-works/pi-tui"`; `renderCall` → `new Text(theme.fg("toolTitle", theme.bold(...)) + theme.fg("muted", …), 0, 0)`; `renderResult` branches on `{expanded}`, falls back to `result.content[0].text`.

## Resident text source
- h2.24 verbatim description (~115 words) + 2 guideline bullets — copied byte-exact into PRP constant specs.

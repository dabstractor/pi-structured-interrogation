# Research notes — P1.M7.T4.S1 (Round heuristic + throttled notify)

## Event API (verified in `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`)

```ts
// line 585-590
export interface TurnEndEvent {
    type: "turn_end";
    turnIndex: number;
    message: AgentMessage;        // completed assistant message
    toolResults: ToolResultMessage[];
}
// line 930
on(event: "turn_end", handler: ExtensionHandler<TurnEndEvent>): void;
```

- `turnIndex` is a natural throttle counter — no manual turn bookkeeping needed.
- Handlers are `ExtensionHandler<E>` = `(event, ctx) => ...` — the second arg `ctx`
  carries `ctx.ui.notify(msg, level)` (used identically in src/debug-commands.ts) and
  `ctx.mode` ("tui" | "rpc" | "json" | "print").
- reference-patterns.md §5: "turn_end receives the completed message: event.message
  (plan-mode/index.ts:209-217)". Assistant text extraction: iterate `message.content`
  blocks, concatenate `{type:"text"}.text` parts (AgentMessage content is block array).
  Keep extraction defensive-tolerant (string content also tolerated).

## Ordering: turn_end vs agent_settled

- `turn_end` fires when the assistant message completes; `agent_settled` fires when the
  run will not continue. Within a multi-turn run, every `turn_end` precedes the final
  `agent_settled`. lifecycle.ts clears `submittedRun` only in the `agent_settled` close
  pass (line ~213) and in `noteSubmissionDelivered`.
- CONSEQUENCE: at `turn_end` time, `lifecycle`'s internal `submittedRun` is still true
  if the model upserted in this run → expose it via a new getter rather than tracking
  a duplicate flag. Risk (h2.51 row 3 style): if ordering ever differed, detection
  would fire spuriously — mitigate with a dedicated unit test documenting the
  assumption and a tolerant `?? false` read.
- Note `submittedRun` is set ONLY on a successful (non-error, upsert-args) interrogate
  tool_execution_end (lifecycle.ts ~line 187) — exactly the "model used interrogate"
  signal required by FR-26.

## Config

- `config.roundDetection: boolean` already exists with default `true` and full
  deep-merge coercion (src/config.ts lines 87, 150, 254; JSDoc already names
  detect.ts as consumer). NO config changes needed.

## Conventions observed

- Module pattern: `[Mode A] JSDoc` header mapping PRD clauses → code sites
  (see src/lifecycle.ts, src/gate.ts). detect.ts must follow this.
- Event-subscription modules take `pi: ExtensionAPI` + options, track unsubscribers
  via a `track()` helper, and return `{ dispose() }` (lifecycle.ts ~lines 160-170).
- Test pattern: bare mock `{ on }` pi with handler registry + `emit(event, payload)`
  (src/lifecycle.test.ts `makeOnMock`); detect needs a mock `ctx` too — pass it as the
  second emit arg or call handlers with (event, ctx).
- `ctx.ui.notify(msg, "info")` is the established level for user nudges
  (debug-commands.ts uses "info"/"warning"/"error").
- index.ts wiring: factory registers everything inline with a per-feature comment
  block naming the subtask ID (P1.M2.T2.S1 pattern).

## Regex (PRD h2.27, verbatim)

`/^\s*(?:Q?\d+[\).:]|[❓\-•*])\s+.+\?/` per line; fire when ≥3 matching lines in the
final assistant message text. Never transform content — read-only heuristic; output is
one `ctx.ui.notify` only. Throttle "once per 3 turns": compare `turnIndex` against
`lastNotifiedTurn`; notify only when `turnIndex - lastNotifiedTurn >= 3` (initialize
lastNotifiedTurn = -3 so the first detection can fire at turnIndex 0).

## Scope boundaries

- Do NOT touch: panel, renderers.ts (P1.M7.T3), config.ts (already has the toggle),
  persistence. The only modified live file is src/index.ts (one wiring block) and
  src/lifecycle.ts (one getter + JSDoc line).

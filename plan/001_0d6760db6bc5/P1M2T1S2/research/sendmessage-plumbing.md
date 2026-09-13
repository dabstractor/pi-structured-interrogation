# Research: sendMessage plumbing (triggerTurn + streaming delivery)

## pi.sendMessage exact semantics (extensions.md §pi.sendmessagemessage-options, lines ~1416–1437; types.d.ts:971–981)

```typescript
pi.sendMessage({ customType, content, display, details }, {
  triggerTurn?: boolean,
  deliverAs?: "steer" | "followUp" | "nextTurn",
});
```

- Custom messages are `role: "custom"` and DO participate in LLM context.
- sendMessage does NOT trigger a reply by default — must pass `triggerTurn: true`.
- deliverAs modes:
  - `"steer"` (default) — queues while streaming; delivered after current assistant turn finishes its tool calls, before next LLM call.
  - `"followUp"` — waits for agent to finish; delivered only when agent has no more tool calls.
  - `"nextTurn"` — queued for next user prompt; does NOT trigger anything (triggerTurn ignored for nextTurn).
- `triggerTurn: true` — if agent is idle, triggers an LLM response immediately. Only applies to "steer" and "followUp".
- pi-api-validation.md Mismatch 2: "Submission must trigger a reply: sendMessage requires `{ triggerTurn: true, deliverAs: 'followUp' }` (steer if streaming)."

## ctx.isIdle()

extensions.md §ctxisidle--ctxabort--ctxhaspendingmessages (line 1044–1046): "ctx.isIdle() is false while Pi is processing an agent run, automatic retry, auto-compaction retry, or queued continuation." Command/shortcut/event handler ctx has it. Also agent_settled: "ctx.isIdle() true unless another extension started a run."

Implication: `isIdle() === false` (streaming/busy) → `{ deliverAs: "steer" }` (triggerTurn irrelevant, agent already running). `isIdle() === true` → `{ triggerTurn: true, deliverAs: "followUp" }`.

## Sibling PRP contract (P1.M2.T1.S1 — delivery.ts)

`src/delivery.ts` exports `buildSubmission(state, diff, note?) => SubmissionMessage` where SubmissionMessage = `{ customType: "interrogation-submission"; content: string; display: true; details: {...} }`. buildSubmission does snapshot+bumpEpoch and does NOT call pi.sendMessage — that is THIS item's job. So deliverSubmission receives the already-built SubmissionMessage (or the completion record from S3, later).

## Codebase conventions

- ESM imports with `.js` suffix.
- Vitest, plain fixtures, no pi runtime in unit tests → mock ExtensionAPI object with a vi.fn() sendMessage.
- Existing files: src/{index,config,state,snapshots,tool,fallback,...}.ts; delivery.ts arriving from S1.
- Consumers: P1.M2.T3.S1 debug submit command, P1.M3.T2.S2 panel ctrl+s (via lifecycle).

## Signature decision

Item contract says `deliverSubmission(pi, msg)` but isIdle lives on ctx, not on pi. Resolve: `deliverSubmission(pi, msg, ctx?)` — ctx optional; when absent or `ctx.isIdle` unavailable, default to the always-safe `{ triggerTurn: true, deliverAs: "followUp" }` (followUp is valid whether idle or busy: it waits for finish then delivers + triggers). When ctx present and `ctx.isIdle() === false`, use `{ deliverAs: "steer" }`.

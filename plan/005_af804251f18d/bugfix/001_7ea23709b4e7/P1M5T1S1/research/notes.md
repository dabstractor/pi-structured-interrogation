# Research notes — bugfix P1.M5.T1.S1 (array-collect tool results in walkBranch)

## Verified codebase facts (src/reconstruct.ts, read directly)

- `WalkResult` (~lines 282–297): `toolState: unknown` (singular), `toolIndex: number` (singular), plus arrays `mirrors`, `submissions`, `completions`. Docs say "Raw details.state of the LAST interrogate tool result".
- `walkBranch` (~326–350): initializes `toolState: undefined, toolIndex: -1`; on each state-carrying interrogate tool result (message entry, `msg.role === "toolResult"`, `msg.toolName === "interrogate"`, `details.state` non-null) it OVERWRITES both fields — comment `// LAST occurrence wins (FR-27)` (~342–343).
- Candidate pool in `reconstructFromBranch` (~449–470): `Candidate {index, data, source}`; pushes the SINGLE tool entry when `walk.toolIndex >= 0`, then loops mirrors (skipping `data.state` null/undefined); `candidates.sort((a,b) => b.index - a.index)` (newest-first, stable); `tryDeserialize` loop breaks on first success — "one corrupt entry degrades to the next-older candidate".
- `tryDeserialize` (~360–369): try/catch around `InterrogationState.deserialize`; hostile getter payload throws at first read (`raw.goal`, state.ts:493) → undefined → next candidate. All fail → `{source: "none"}` path (~489+).
- Module JSDoc (~41–43) promises deserialize failures degrade to the next-older candidate — the contract this fix makes true for tool results.
- Consumers of `toolState`/`toolIndex`: re-grepped — ONLY the pool construction inside reconstructFromBranch; zero uses in any other file (tests never reference the fields; they assert via `result.source` and `getState()`). Safe to replace the fields with an array.
- `baseIndex` (winning candidate index) is used downstream for: submission position filter (`submission.index > baseIndex` for tool-result base) and completion marker (`walk.completions.find(i => i > baseIndex)`). Collecting ALL tool results does not change baseIndex semantics — it's the winning candidate's index.

## Tests (src/reconstruct.test.ts conventions)

- Helpers: `makeCtx(entries, mode)`, `makeHost()`, `makeOpts(host)`, `seededState(mutator)` (serialized base states), `applyUpsert`, `choiceQ`, `diff`, `toolResultEntry(state)`, `submissionEntry`, `completionEntry`.
- ~line 372: corrupt getter payload — `toolResultEntry({ get goal() { throw new Error("corrupt payload"); } })` — the hostile-entry fixture pattern to copy.
- ~line 738: "a NEW interrogation after the completion REPLACES" — branch with TWO valid tool results; asserts `result.source === "tool-result"` and the NEWEST (fresh n1 instance) wins. This pins last-wins and MUST stay green.
- Tests reset state between runs (module-level getState/resetState used through reconstructFromBranch itself).

## PRD anchors

- h2.3/h3.7 BUG-008: newest tool result corrupt + no mirror → currently `{source:'none'}` though a valid older tool result exists. Fix = collect every state-carrying tool result into the pool, newest-first.
- h2.5 recommendation: "Collect every state-carrying interrogate tool result into the reconstruction candidate pool so the documented degrade-to-next-older behavior actually holds (BUG-008)."

## Parallel-task check (P1.M4.T2.S1)

Overview cursor-row chat targeting — touches src/panel/keys.ts, panel.ts accessor, overview.ts. Zero overlap with reconstruct.ts. No coordination needed.

## Design

- `WalkResult.toolResults: Array<{index: number; data: unknown}>` replaces toolState/toolIndex (append in walk order = ascending index).
- Pool: `for (const tr of walk.toolResults) candidates.push({index: tr.index, data: tr.data, source: "tool-result"})` before the mirror loop. Existing sort + tryDeserialize loop unchanged — newest-first index competition preserves FR-27 last-wins when all entries are valid.
- Docs contract: update walkBranch JSDoc, WalkResult field docs, module JSDoc step-2 prose (~41–43 and the pool comment ~435–457) to say every state-carrying tool result is a candidate.

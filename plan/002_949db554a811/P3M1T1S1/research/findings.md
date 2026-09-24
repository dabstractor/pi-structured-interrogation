# Research findings — P3.M1.T1.S1 (SURFACE-001 gates on maybeAutoOpen)

## The bug site

`maybeAutoOpen(pi, config, host, drafts?)` — `src/panel/panel.ts:1797` (doc note in item said :1759; current tree :1797). Handler body (panel.ts:1801+):

```ts
if (event.toolName !== "interrogate" || event.isError) return;
if (host.isOpen()) return;
const state = getState();
if (state === undefined) return;
if (!openPanel(ctx, { config, state, drafts }) && phase === "open") { /* NEW-001 stale-record retry */ }
```

Only conditions: toolName + !isError + host-closed + state-exists. Pure `{}` reads and reads over completed/all-answered states pop the panel (SURFACE-001 root cause).

## Args availability — the ordering contract

- End events carry NO args. `src/index.ts:228` declares `const pendingUpsertArgs = new Map<string, unknown>()`; the factory's own `tool_execution_start` handler (index.ts:231-234) stashes `event.args` under `toolCallId` (interrogate calls only); its `tool_execution_end` handler (index.ts:236-243, **registered LAST**) consumes + DELETES, then does the deferred bridge emission `remoteBridge.emitFlow(state, "tool")` (D-R6).
- `maybeAutoOpen` is wired at index.ts:165 — its end handler is registered BEFORE the factory's last one, so at its fire time the stash entry is still present → **peek (get without delete)** is safe and must NOT delete (the last handler's consume+emit must keep working).
- Blocker: `pendingUpsertArgs` is declared at index.ts:228, AFTER the maybeAutoOpen call at :165. Must hoist the Map declaration above index.ts:160 (or pass a peek callback). Keep the start/end handler registrations where they are — only the declaration moves.
- Alternative per contract: shared helper. Either approach OK; peek via a small exported accessor avoids maybeAutoOpen importing index internals. Recommended: change maybeAutoOpen's signature to accept an optional `peekArgs?: (toolCallId: string) => unknown` (default `() => undefined`, keeping all existing tests/other callers compiling), and in index.ts pass `(id) => pendingUpsertArgs.get(id)`. No second stash, no delete, no behavior change to the bridge path.

## Predicates to reuse (do not invent new ones)

- **upsert-call gate**: `isUpsertArgs` at `src/lifecycle.ts:126` is module-private (not exported): `isRecord(args) && Array.isArray(args.questions) && args.questions.length > 0`. Either export it from lifecycle.ts (preferred — single definition; lifecycle.ts:190 uses it for the rule-1 flip) or duplicate a tiny local predicate in panel.ts. Empty `questions: []` is a read/must NOT count.
- **unanswered-exist gate**: `UNANSWERED_STATUSES = ["open","reasked"]` (private, `src/panel/actions.ts:85`); `nextUnanswered(ordered, -1) !== undefined` (exported, actions.ts:106) scans from index 0 — use `nextUnanswered(state.orderedQuestions(), -1) === undefined ⇒ no unanswered ⇒ return`. (Sibling h2.37 wording: "reuse the status predicate family from hasResumableQuestions/nextUnanswered".)
- **not-completed gate**: `state.completed === true` after `clearForCompletion()` (state.ts:245/:419) — return before opening. Serialize/deserialize round-trips it (state.ts:440/:460).

## What must NOT change

- `{reopen:true}` path (index.ts onReopen) — untouched.
- `/interrogate` command path — untouched.
- Deferred bridge emission (index.ts:236-243) — untouched; stash still consumed+deleted there exactly once.
- `handleUpserted` suspended-reopen (panel.ts:1429) — that is P3.M1.T2.S1's scope; do not add the gate there in this item.
- Reconstruction openPanel — P3.M2's scope.

## Test patterns

- `src/panel/panel.test.ts:903` `describe("maybeAutoOpen — tool-path auto open/reopen")`: harness `arm()` builds mock pi (`makeMockPi`, handlers map), `createPanelHost(makeMockLifecycle())`, real state via `setState`, fires `mock.emit("tool_execution_end", endEvent())`. `endEvent()` factory at :915. Extend here with peekArgs-passing tests (upsert opens; read `{}` doesn't; empty questions[] doesn't; all-answered upsert? — per FR gate (2), an upsert leaving nothing unanswered does NOT open; completed state never opens).
- `src/tree-nav-repro.test.ts:175/:183` — the two BUG characterizations (assert `customCalls.length === 1`) are flipped by P3.M1.T3.S1, NOT this item. But those tests fire end events with NO start stash — with a default `peekArgs` returning undefined, they'd already stop popping; leave their assertions alone (T3.S1 owns the flips) unless implementation forces it — coordinate: this item must NOT flip assertions in tree-nav-repro.test.ts.
- Backward compat: `maybeAutoOpen(mock.pi, DEFAULT_CONFIG, host)` called without peekArgs in panel.test.ts:922/:968/:975 and reload-invoke.test.ts:252 — keep param optional; default behavior with no peek = read ⇒ never open (gate (1) fails). panel.test.ts existing tests at :922 fire endEvent() with no stash → they WILL now not open; check: :922's test relies on the panel opening! So existing tests must be updated to pass a peekArgs that returns upsert args (or fire a matching start event). That is in-scope: update the harness `arm()` to include a start-event fire + peekArgs wiring, mirroring production.
- reload-invoke.test.ts:252 comment "mounts via maybeAutoOpen on tool_execution_end" — check and update its harness similarly.

## Config/docs

- Mode A: JSDoc on maybeAutoOpen documenting the three-gate allow-list + SURFACE-001 rationale (reads are pull, never surfaces; cite the empty-box-after-esc data-loss trap).
- No config changes, no schema changes, no state-model changes.

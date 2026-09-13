# PRP — P1.M2.T3.S1: `/interrogate-debug-upsert | submit | state` commands

---
name: "P1.M2.T3.S1 — Debug commands for scripted verification"
description: "Create src/debug-commands.ts registering three TUI slash commands that invoke the SAME parse/guard/state/delivery functions as the interrogate tool executor — `/interrogate-debug-upsert <json>` (full upsert path), `/interrogate-debug-submit [id=value,...]` (flush answers + full submission path), `/interrogate-debug-state` (status line + per-question one-liners). Used by the P1.M7.T6.S1 scripted AC runbook (AC-2, 3, 8, 13, 14 state-level) and manual testing through M3–M6. No new logic — pure composition of existing exports. Mode A JSDoc on every command."
---

## Goal

**Feature Goal**: Provide deterministic, scriptable entry points into the interrogate state machine from the TUI, because scripted model turns are unreliable (h2.50). Each debug command reuses the exact production code paths (`parseInterrogateParams`, `assertFresh`, `applyCaps`, `applyUpsert`, `applyAnswer`, `computeDiff`, `buildSubmission`, `deliverSubmission`, `buildStatusLine`) so a passing debug-command run is evidence the tool path works.

**Deliverable**: `src/debug-commands.ts` exporting `registerDebugCommands(pi: Pick<ExtensionAPI, "registerCommand" | "sendMessage">, config: InterrogatorConfig): void`; `src/debug-commands.test.ts`; one-line wiring in `src/index.ts`.

**Success Definition**: `npm test` + `npm run typecheck` green; the three commands load in a live `pi -e .` session; upsert/submit produce the identical state side effects (epoch bumps, snapshots, delivered messages) as the corresponding tool calls; state command prints status line + one-liner per question; all commands are harmless with empty state.

## User Persona

**Target User**: The developer/AI verifying pi-interrogator acceptance criteria without relying on scripted model turns.

**Use Case**: Running the AC runbook (P1.M7.T6.S1): upsert a fixture question set, submit answers, observe epoch/status transitions — entirely from the keyboard.

**User Journey**: `/interrogate-debug-upsert '{"goal":"...","questions":[...]}'` → notify shows status line or guard/parse errors → `/interrogate-debug-submit q1=postgres q2=sqlite` → submission message delivered to the model + epoch bump → `/interrogate-debug-state` → full one-line dump.

**Pain Points Addressed**: Cannot drive the tool deterministically via scripted model turns (h2.50 explicitly calls this out and mandates the debug-command approach).

## Why

- h2.50 "Integration (launch `pi -e .`)": "scripted model turns are unreliable — drive the tool directly via a debug command (`/interrogate-debug-upsert <json>`) that invokes the same code path as the tool".
- Enables state-level scripting of AC-2, AC-3, AC-8, AC-13, AC-14 in P1.M7.T6.S1.
- Manual testing companion for M3–M6 panel work (any state the dev needs can be created without convincing the model).

## What

### Public surface (exact)

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { InterrogatorConfig } from "./config.js";

export function registerDebugCommands(
  pi: Pick<ExtensionAPI, "registerCommand" | "sendMessage">,
  config: InterrogatorConfig,
): void;
```

Registers exactly three commands (handler signature `(args: string, ctx) => Promise<void>`, `ctx.ui.notify(text, level)` available — see pi-api-validation.md §registerCommand, same pattern as the existing `interrogate-ping` command in `src/index.ts:32-37`):

### `/interrogate-debug-upsert <json>`

1. `JSON.parse(args.trim())`; on failure notify `"interrogate-debug: invalid JSON: <message>"` level `"error"` and return (no state touched).
2. Call `executeInterrogate(parsedJson, { mode: "tui", hasUI: true }, config)` — **the production executor itself** (imported from `tool.ts`). This guarantees parse → `assertFresh` → caps → `applyUpsert` → result building run identically to a model call. Do NOT re-implement the upsert path.
3. On success: `ctx.ui.notify(<result.statusLine equivalent>)` — for the TUI result shape from `buildUpsertResult`, extract the status line from `result.details.statusLine` — level `"info"`. Append any warnings (from the result content or by recomputing `upsertWarnings`-equivalents — prefer reading them from the result; `buildUpsertResult` packs warnings into the render rows, so simplest is to keep the warnings list by ALSO calling the pure pieces… see Implementation Blueprint for the exact minimal approach).
4. On throw (`Error` for malformed params / no-state cases, `StaleError` for stale rev/epoch): notify the FULL `error.message` (StaleError's message is the self-heal payload: current text/rev + digest — exactly what AC-8 needs to observe), level `"error"`. Catch both with a single `catch (err)` and `String((err as Error).message)`; never rethrow into pi's command runner unhandled.

### `/interrogate-debug-submit [id=value,...]`

1. Parse `args` as comma/whitespace-separated `id=value` pairs (value runs to the next comma; trim both sides). Empty/whitespace-only id → notify parse error, return. Zero pairs → notify `"interrogate-debug-submit: nothing to submit"` level `"warn"`, return.
2. `const state = getState()`; if undefined → notify `"interrogate-debug-submit: no interrogation state"` level `"error"`, return.
3. Flush each pair as a user answer (this is the "panel precondition" that `buildSubmission`'s JSDoc documents as caller-owned): for each pair, if `state.getQuestion(id) === undefined` collect into an `unknown` list; else `state.applyAnswer(id, { value, at: new Date().toISOString() })` (same applied-shape as `recordAnswers` in `src/fallback.ts:197-215` — reuse the pattern, including free-form values with NO option validation).
4. Notify a summary line: `"recorded: <ids or (none)>; unknown: <ids or (none)>"` level `"info"`.
5. Full submission path (h2.14 h3.6): `const diff = computeDiff(state, /* pre-answer snapshot */)` — computeDiff takes the diff against the ring's latest snapshot; pass the pre-flush snapshot captured in step 3 BEFORE any `applyAnswer` (see Blueprint). Then `const msg = buildSubmission(state, diff)` — this itself performs `takeSnapshot` + `bumpEpoch` in strict order (delivery.ts:100-110 contract; do NOT duplicate them). Then `deliverSubmission(pi, msg, { isIdle: () => true })` (force the idle branch → `{triggerTurn: true, deliverAs: "followUp"}` so the debug submission triggers an agent turn exactly like a real panel submission).
6. Notify the submission status: `"submitted epoch " + state.epoch` (post-bump) level `"info"`.
7. Errors from guards/builders: same notify-error policy as upsert.

### `/interrogate-debug-state`

1. `const state = getState()`; if undefined → notify `"interrogate-debug-state: no interrogation state (epoch 0)"` level `"info"` and return — harmless-empty requirement.
2. Notify (level `"info"`) a multi-line string: first line `buildStatusLine(state.serialize())` (results.ts:87 — h2.28 shared format), then one line per question from `state.orderedQuestions()`: `- <id> [<status>] rev<r> <first 60 chars of prompt>` (plus ` = <value>` when an answer exists: `q.getAnswer?.()` / the `answer` field on the serialized question — read from `state.serialize()`'s question list, whichever the state API exposes; state.ts `SerializedState` is the stable shape, prefer it).

### Success Criteria

- [ ] Three commands registered and loadable in `pi -e .` (ping-style smoke proof).
- [ ] `/interrogate-debug-upsert` with a valid fixture JSON produces the same state (questions, epoch, snapshots) as calling `executeInterrogate` with the same args.
- [ ] Stale upsert (wrong rev) notifies the StaleError message containing current rev/text (AC-8 observable).
- [ ] `/interrogate-debug-submit q1=a` records the answer, delivers exactly one `sendMessage` (customType `interrogation-submission`), bumps epoch exactly once, pushes exactly one new snapshot.
- [ ] `/interrogate-debug-state` shows status line + one-liner per question; harmless when empty.
- [ ] No logic duplicated from tool/delivery/state modules — imports only.

## All Needed Context

### Context Completeness Check

If someone knew nothing about this codebase: they need the exact import list, the executor/flush/snapshot-ordering contracts, and the registerCommand pattern. All are specified below with file:line anchors.

### Documentation & References

```yaml
- file: src/tool.ts
  why: executeInterrogate(args, ctx, config) is THE upsert path to call (line ~185); ExecutorContext shape ({mode, hasUI, model?}) at line ~90
  pattern: call it with { mode: "tui", hasUI: true } and the registered config; catch its throws (Error | StaleError)
  gotcha: it is synchronous and side-effect rich (fires questions-upserted events consumed by lifecycle) — that is desired here

- file: src/index.ts
  why: registerCommand handler pattern (interrogate-ping, lines 32-37): handler: async (args: string, ctx) => { ctx.ui.notify(msg, "info") }
  pattern: wiring point for registerDebugCommands(pi, config) — add after createLifecycle
  gotcha: config is loaded once in the factory; pass it down, never reload

- file: src/delivery.ts
  why: buildSubmission(state, diff) — performs takeSnapshot + bumpEpoch itself (lines 100-165); deliverSubmission(pi, msg, ctx) — delivery matrix, idle → {triggerTurn:true, deliverAs:"followUp"} (lines 465-481)
  pattern: never duplicate snapshot/bump; force idle via { isIdle: () => true }
  gotcha: buildSubmission MUST receive the diff computed against the PRE-answer snapshot; buildSubmission then takes a NEW snapshot of the post-answer state before bumping

- file: src/snapshots.ts
  why: computeDiff(...) signature + takeSnapshot(state) (lines 126, 200); SubmissionCardData/DiffEntry shapes
  pattern: capture `const pre = state.snapshots.at(-1)` BEFORE applyAnswer; computeDiff uses the ring — verify exact param list at line 200 and pass the pre-flush snapshot/epoch accordingly
  gotcha: subscribing to epoch-bumped would mislabel snapshots — ordering is caller-owned (delivery.ts documents this)

- file: src/fallback.ts
  why: recordAnswers (lines 197-215) shows the canonical answer-flush: applyAnswer(id, {value, at: new Date().toISOString()}), unknown-id collection, no option validation
  pattern: mirror it for the submit flush; optionally refactor recordAnswers to a shared helper ONLY if trivially clean — otherwise duplicate the 8-line loop in debug-commands.ts (acceptable for a debug surface, note it in JSDoc)

- file: src/results.ts
  why: buildStatusLine(SerializedState) (line 87) — h2.28 shared status line used by results AND panel footer
  pattern: state command line 1

- file: src/state.ts
  why: getState/setState/resetState (lines 524-541), serialize() → SerializedState, orderedQuestions(), getQuestion(id), applyAnswer(id, applied), epoch
  pattern: read-only access for state command; applyAnswer for submit flush

- file: src/tool-schema.ts
  why: parseInterrogateParams is reached via executeInterrogate — do NOT call it separately for upsert (double parse is wasted); only the submit command parses its own id=value mini-format

- file: src/config.ts
  why: InterrogatorConfig type for the registerDebugCommands signature

- file: vitest.config.ts / src/tool.test.ts
  why: test conventions — stub pi object ({registerCommand: vi.fn capture, sendMessage: vi.fn}), stub ctx ({ui: {notify: vi.fn}}); assert on captured notify/sendMessage payloads
  pattern: follow src/tool.test.ts stubbing style (ExecutorContext stubs) and src/delivery.test.ts sendMessage assertions (deep-equal options objects)
```

### Current Codebase tree (src/)

```
src/
  index.ts          # factory: config load, interrogate-ping command, tool registration, lifecycle wiring
  config.ts         # InterrogatorConfig, loadConfig, DEFAULT_CONFIG
  tool-schema.ts    # InterrogateParams, parseInterrogateParams, ParseResult
  tool.ts           # executeInterrogate (executor core), createInterrogateTool
  guards.ts         # assertFresh, StaleError
  caps.ts           # applyCaps, CapsResult
  merge.ts          # applyUpsert
  state.ts          # InterrogationState class + singleton accessors
  snapshots.ts      # takeSnapshot, computeDiff, digestSince, DiffEntry, SubmissionCardData
  delivery.ts       # buildSubmission, buildCompletion, deliverSubmission
  lifecycle.ts      # createLifecycle (auto-close engine)
  fallback.ts       # recordAnswers, buildFallbackDigest, isNonTui
  results.ts        # buildStatusLine, buildReadResult, buildUpsertResult, InterrogateResult
  *.test.ts         # colocated vitest suites
```

### Desired Codebase tree with files to be added

```bash
src/debug-commands.ts        # NEW — registerDebugCommands(pi, config); the three command definitions
src/debug-commands.test.ts   # NEW — vitest suite (stubbed pi + ctx)
src/index.ts                 # MODIFIED — one line: registerDebugCommands(pi, config)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: buildSubmission(state, diff) ITSELF calls takeSnapshot + bumpEpoch
// (delivery.ts side-effect tail). Calling them again in the debug command
// double-bumps the epoch. The ONLY things the submit command does manually:
// applyAnswer flush (pre) → computeDiff(pre-snapshot) → buildSubmission → deliverSubmission.

// CRITICAL: computeDiff must describe the flush as a diff against the LAST
// snapshot BEFORE applyAnswer. Capture the pre-flush reference first; read
// computeDiff's exact parameters at src/snapshots.ts:200 before coding.

// CRITICAL: do NOT reimplement the upsert path. executeInterrogate(json, {mode:"tui", hasUI:true}, config)
// IS the path (parse → guards → caps → merge → results). Duplicating it
// defeats the entire h2.50 purpose (same-code-path evidence).

// CRITICAL: StaleError and plain Errors must BOTH be caught and notified
// (message verbatim); rethrowing crashes pi's command runner display.

// registerCommand handler is async: async (args: string, ctx) => {...} —
// ctx.ui.notify(text, "info" | "error" | "warn").

// Live-session upserts fire questions-upserted/changed events consumed by
// lifecycle (auto-close engine) — intended; do not suppress.

// Submit with triggerTurn:true starts a real agent turn in a live session —
// that is the point (h3.6) but note it in JSDoc for testers.
```

## Implementation Blueprint

### Module skeleton

```ts
/**
 * src/debug-commands.ts — TUI debug commands driving the interrogate code
 * paths deterministically (P1.M2.T3.S1, h2.50). Scripted model turns are
 * unreliable; these commands invoke the SAME functions the tool executor
 * uses, so a passing debug run is evidence about the production path.
 *
 * /interrogate-debug-upsert <json>  → executeInterrogate (full upsert path)
 * /interrogate-debug-submit [id=v…] → applyAnswer flush + buildSubmission +
 *                                     deliverSubmission (full submit path)
 * /interrogate-debug-state          → buildStatusLine + per-question one-liners
 *
 * TUI-only convenience; all commands are harmless with empty state.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { InterrogatorConfig } from "./config.js";
import { buildSubmission, deliverSubmission } from "./delivery.js";
import { buildStatusLine } from "./results.js";
import { computeDiff, type Snapshot } from "./snapshots.js";
import { executeInterrogate } from "./tool.js";
import { getState, type InterrogationState } from "./state.js";

type Ctx = { ui: { notify: (msg: string, level?: string) => void } };

export function registerDebugCommands(
  pi: Pick<ExtensionAPI, "registerCommand" | "sendMessage">,
  config: InterrogatorConfig,
): void {
  pi.registerCommand("interrogate-debug-upsert", { /* Mode A JSDoc */ ... });
  pi.registerCommand("interrogate-debug-submit", { /* ... */ ... });
  pi.registerCommand("interrogate-debug-state", { /* ... */ ... });
}
```

### Upsert command body (sketch)

```ts
handler: async (args: string, ctx: Ctx) => {
  let json: unknown;
  try { json = JSON.parse(args.trim()); }
  catch (e) { ctx.ui.notify(`interrogate-debug-upsert: invalid JSON: ${(e as Error).message}`, "error"); return; }
  try {
    const result = executeInterrogate(json, { mode: "tui", hasUI: true }, config);
    ctx.ui.notify(result.details?.statusLine ?? "interrogate-debug-upsert: ok", "info");
  } catch (err) {
    // Includes StaleError — message is the AC-8 self-heal payload.
    ctx.ui.notify(`interrogate-debug-upsert: ${(err as Error).message}`, "error");
  }
}
```

Note on warnings: `buildUpsertResult` embeds warnings in render rows; the notify line may append them only if cheaply extractable from the result — otherwise the status line alone is acceptable (caps/truncation warnings are still observable via `/interrogate-debug-state`). Prefer a one-line approach; do not re-run caps.

### Submit command body (sketch — order is the contract)

```ts
handler: async (args: string, ctx: Ctx) => {
  const state = getState();
  if (!state) { ctx.ui.notify("interrogate-debug-submit: no interrogation state", "error"); return; }
  const pairs = args.split(",").map(s => s.trim()).filter(Boolean)
    .map(s => { const i = s.indexOf("="); return i < 0 ? null : [s.slice(0, i).trim(), s.slice(i + 1).trim()] as const; });
  if (pairs.length === 0 || pairs.some(p => p === null)) {
    ctx.ui.notify("interrogate-debug-submit: expected id=value[,id=value...]", "error"); return;
  }
  const pre = lastSnapshotOf(state);            // capture BEFORE any applyAnswer
  const unknown: string[] = []; const recorded: string[] = [];
  for (const [id, value] of pairs as ReadonlyArray<readonly [string, string]>) {
    if (state.getQuestion(id) === undefined) { unknown.push(id); continue; }
    state.applyAnswer(id, { value, at: new Date().toISOString() });
    recorded.push(id);
  }
  ctx.ui.notify(`interrogate-debug-submit: recorded: ${recorded.join(", ") || "(none)"}; unknown: ${unknown.join(", ") || "(none)"}`, "info");
  // Full submission path — buildSubmission does snapshot + epoch bump itself.
  const diff = computeDiffAgainst(state, pre);   // exact call per snapshots.ts:200
  const msg = buildSubmission(state, diff);
  deliverSubmission(pi, msg, { isIdle: () => true });
  ctx.ui.notify(`interrogate-debug-submit: submitted epoch ${state.epoch}`, "info");
}
```

Resolve `lastSnapshotOf`/`computeDiffAgainst` against the real `computeDiff` signature (snapshots.ts:200) during implementation — the ring lives on the state object; if computeDiff already diffs against `state.snapshots.at(-1)` internally, capture that reference pre-flush and pass exactly what the signature asks for. Add a short JSDoc note at each helper stating the ordering contract.

### State command body (sketch)

```ts
handler: async (_args: string, ctx: Ctx) => {
  const state = getState();
  if (!state) { ctx.ui.notify("interrogate-debug-state: no interrogation state (epoch 0)", "info"); return; }
  const s = state.serialize();
  const lines = [buildStatusLine(s)];
  for (const q of s.questions /* or orderedQuestions() — match SerializedState shape */) {
    const ans = q.answer ? ` = ${q.answer.value}` : "";
    lines.push(`- ${q.id} [${q.status}] rev${q.rev} ${truncate(q.prompt, 60)}${ans}`);
  }
  ctx.ui.notify(lines.join("\n"), "info");
}
```

### index.ts wiring

```ts
import { registerDebugCommands } from "./debug-commands.js";
// after pi.registerTool / createLifecycle:
registerDebugCommands(pi, config);
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: READ src/snapshots.ts computeDiff (line 200) + src/delivery.ts buildSubmission JSDoc
  - CONFIRM: exact computeDiff parameters and how the pre-answer snapshot is supplied
  - CONFIRM: SerializedState question list field name for the state command

Task 2: CREATE src/debug-commands.ts
  - IMPLEMENT: registerDebugCommands(pi, config) with the three handlers per sketches above
  - FOLLOW pattern: src/index.ts interrogate-ping command (handler signature, ctx.ui.notify)
  - NAMING: interrogate-debug-upsert | interrogate-debug-submit | interrogate-debug-state (h2.3 final strings)
  - PLACEMENT: src/debug-commands.ts, imports only from existing modules — zero logic duplication except the 8-line answer flush
  - Mode A JSDoc on each command description AND on the module

Task 3: MODIFY src/index.ts
  - ADD: import + registerDebugCommands(pi, config) after createLifecycle wiring
  - PRESERVE: existing registrations verbatim

Task 4: CREATE src/debug-commands.test.ts
  - IMPLEMENT: vitest suite with stubbed pi ({registerCommand: captures defs, sendMessage: vi.fn()}) and ctx ({ui: {notify: vi.fn()}})
  - FOLLOW pattern: src/tool.test.ts stubs + src/delivery.test.ts deep-equal sendMessage assertions
  - CASES:
    - upsert: valid fixture → status-line notify; invalid JSON → error notify, no state change; stale rev → notify contains current rev (AC-8 shape); no-args → executor read path on empty session is harmless
    - submit: no state → error; unknown ids → unknown list; happy path → exactly one sendMessage with customType "interrogation-submission" and options deep-equal {triggerTurn:true, deliverAs:"followUp"}; epoch bumped exactly once; snapshot count +1
    - state: empty → "(epoch 0)" info notify; populated → first line is buildStatusLine output, one line per question with status+rev
    - registration: pi.registerCommand called with the three exact command names
  - NOTE: use resetState() (state.ts:539) between tests; follow existing suites' setup/teardown conventions
```

### Integration Points

```yaml
EXTENSION REGISTRATION:
  - add to: src/index.ts (factory, after lifecycle wiring)
  - pattern: "registerDebugCommands(pi, config);"

NONE elsewhere:
  - no config, no state.ts changes, no delivery.ts changes, no tool.ts changes.
    If implementation feels a need to modify those, STOP — the contract is
    wrong; re-read this PRP.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npx tsc --noEmit          # project typecheck (npm run typecheck)
# Expected: zero errors
```

### Level 2: Unit Tests

```bash
npm test
# and targeted: npx vitest run src/debug-commands.test.ts -v
# Expected: all pass, including pre-existing suites (regression: index.ts wiring compiles)
```

### Level 3: Integration (live TUI)

```bash
pi -e .
# in session:
/interrogate-debug-state            # → "no interrogation state (epoch 0)"
/interrogate-debug-upsert '{"goal":"test","questions":[{"id":"q1","prompt":"DB?","type":"single","options":["sqlite","postgres"],"rev":1}]}'
# → status line notify; auto-close lifecycle subscribes to the upsert events
/interrogate-debug-state            # → q1 line, epoch 1
/interrogate-debug-submit q1=postgres
# → one submission message to the model, agent turn triggers, epoch 2
/interrogate-debug-upsert '{"goal":"x","questions":[{"id":"q1","prompt":"DB?","type":"single","options":["a"],"rev":1}]}'  # stale: rev must be current
# → StaleError message with current rev + digest (AC-8 observable)
```

### Level 4: Domain-Specific

```bash
# Same-code-path proof (the h2.50 raison d'être): in vitest, run the same
# upsert args through executeInterrogate directly and through the captured
# command handler; assert identical resulting serialize() output (minus timestamps).
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean
- [ ] `npm test` all green (new suite + no regressions)
- [ ] Level 3 live-session sequence works in `pi -e .`

### Feature Validation

- [ ] All three commands registered with exact h2.3 names
- [ ] Upsert goes through `executeInterrogate` (no duplicated parse/guard/caps/merge)
- [ ] Submit bumps epoch exactly once, one snapshot, one sendMessage (AC-2/AC-13 state-level observable)
- [ ] Stale rejection surfaces the full self-heal message (AC-8)
- [ ] Empty-state invocations are harmless info/error notifies
- [ ] Mode A JSDoc present on module + each command description

### Code Quality Validation

- [ ] No modification to state.ts / delivery.ts / tool.ts / tool-schema.ts / results.ts / snapshots.ts / fallback.ts / lifecycle.ts
- [ ] Only new files: debug-commands.ts + test; index.ts gains import + one call
- [ ] Anti-patterns avoided: no reimplementation, no swallowed errors, no extra epoch bumps

## Anti-Patterns to Avoid

- ❌ Re-implementing the upsert path instead of calling `executeInterrogate`
- ❌ Calling `takeSnapshot`/`bumpEpoch` around `buildSubmission` (it does both)
- ❌ Computing the submit diff AFTER `buildSubmission` (post-bump snapshot ≠ pre-answer baseline)
- ❌ Letting StaleError/parse errors escape uncaught into the command runner
- ❌ Adding config knobs or touching production modules for a debug surface
- ❌ Skipping the `isIdle: () => true` probe (busy branch would deliver via steer and skip the agent turn)

---

**Confidence Score**: 8/10 — the only open verification point is `computeDiff`'s exact parameter shape (snapshots.ts:200), which Task 1 resolves before any code is written; everything else is pinned to existing, tested exports with file:line anchors.

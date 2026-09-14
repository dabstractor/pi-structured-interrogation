# PRP — P1.M7.T4.S1: Round heuristic + throttled notify

## Goal

**Feature Goal**: Implement FR-26 / h2.27 plain-text question-round detection (TUI only): after each assistant turn, if the final assistant message contains ≥3 lines matching the PRD regex AND no interrogate upsert occurred in this run, notify the user `Question round detected in chat — /interrogate to move it into the panel`. Throttled to once per 3 turns, config-toggleable (`roundDetection`, default on), and NEVER transforms message content.

**Deliverable**: New module `src/detect.ts` exporting `createRoundDetector(pi, opts)` (subscribes `turn_end`, returns `{ dispose() }`); one small addition to `src/lifecycle.ts` (public getter `upsertedThisRun()` reading the existing `submittedRun` flag); one wiring block in `src/index.ts`; tests in `src/detect.test.ts` + one appended lifecycle test.

**Success Definition**: In TUI mode with `roundDetection: true`, an assistant reply containing a numbered question block (and no interrogate upsert that run) produces exactly one `ctx.ui.notify(...)` nudge; consecutive detections are suppressed until 3 turns pass; detection is silent when the model used the interrogate tool, in non-TUI modes, or when the config toggle is off. No message content is ever modified.

## User Persona (if applicable)

**Target User**: pi TUI user mid-conversation with a model that asks a batch of clarifying questions in plain chat instead of using the interrogate panel.

**Use Case**: The user misses that a structured panel exists for this exact situation.

**User Journey**: Model replies with "1) ...? 2) ...? 3) ...?" → user sees a one-line notification naming `/interrogate` → user invokes the command, moving the round into the panel. Repeated rounds don't nag (3-turn throttle).

**Pain Points Addressed**: Structured interrogation never gets adopted because the model forgets the tool; this is the designed nudge (behavior changes via user action only — the model is never auto-modified).

## Why

- h2.27 / FR-26 mandates it verbatim; it is the safety net for the whole extension's adoption loop.
- P1.M7.T4 is the only remaining piece of the "detection" surface; everything it consumes already exists (config toggle from P1.M1.T1.S2, upsert flag from P1.M2.T2.S1).
- It is deliberately read-only: detection nudges the user, never rewrites the model's output (h2.0 core commitment — no content transformation).

## What

1. **`src/lifecycle.ts` addition** (INPUT: per-run upsert flag from P1.M2.T2.S1):
   - Extend the `Lifecycle` interface with `upsertedThisRun(): boolean` — returns the existing closure `submittedRun` flag. Add the method to the returned object. One JSDoc line: "True when a successful (non-error) interrogate upsert ended in the current run; consumed by detect.ts (P1.M7.T4.S1) at turn_end, which precedes agent_settled's flag-clearing close pass."
   - Do NOT change any existing lifecycle logic, subscription, or reset path.
2. **`src/detect.ts` — `createRoundDetector(pi, { config, lifecycle })`**:
   - `config: InterrogatorConfig` (import from `./config.js`), `lifecycle: Pick<Lifecycle, "upsertedThisRun">`.
   - Subscribes `pi.on("turn_end", (event, ctx) => ...)` using the same `track()` + unsubscriber pattern as lifecycle.ts (~lines 160–170); returns `{ dispose() }`.
   - Logic, in order:
     1. `if (!config.roundDetection) return;`
     2. `if (ctx?.mode !== "tui") return;` (tolerant: no ctx → no-op)
     3. Throttle FIRST (cheap) using `event.turnIndex`: `if (turnIndex - lastNotifiedTurn < 3) return;` (init `lastNotifiedTurn = -3` so the first detection may fire at turn 0).
     4. Suppress when the model used interrogate: `if (lifecycle.upsertedThisRun()) return;` (safe at turn_end: `submittedRun` is only cleared on `agent_settled` close pass or submission delivery — both happen after turn_end; see research/notes.md ordering section).
     5. Extract assistant text from `event.message` (completed assistant message, types.d.ts:585-590): defensively iterate `message.content` — for block objects with `type === "text"` take `.text`; tolerate a bare string content. Non-string/missing → return.
     6. Count lines matching the h2.27 regex **verbatim**: `/^\s*(?:Q?\d+[\).:]|[❓\-•*])\s+.+\?/` (test each line; split on `\n`).
     7. If `count >= 3` → `ctx.ui.notify("Question round detected in chat — /interrogate to move it into the panel", "info")` and set `lastNotifiedTurn = turnIndex`.
   - **[Mode A] JSDoc** on the module (PRD-clause → code-site map, following src/lifecycle.ts's header style) and specifically on the regex constant and the throttle constant/initializer, documenting: what each regex alternative matches (`Q?\d+[\).:]` numbered "1)" / "Q3." lists; `❓`, `-`, `•`, `*` bullets), why ≥3 lines (a round, not a stray question), and why the throttle is measured in `turnIndex` deltas of 3 with the `-3` bootstrap.
   - Export the regex as `ROUND_LINE_RE` and the notify string as `ROUND_NOTIFY_MESSAGE` (both `const`) for tests and documentation; the notify string must match h2.27 exactly.
3. **`src/index.ts` wiring**: after the `lifecycle = createLifecycle(...)` assignment (which precedes everything that needs it), add a block:
   ```ts
   // P1.M7.T4.S1 — plain-text round detection (FR-26, h2.27): TUI-only,
   // config-gated (roundDetection), throttled once per 3 turns; never
   // transforms content — notifies only.
   const roundDetector = createRoundDetector(pi, { config, lifecycle });
   ```
   Follow the existing per-feature comment-block convention. (`dispose` stays unwired per the existing mirror precedent — subscriptions die with the runtime.)

### Success Criteria

- [ ] `createRoundDetector` registered on `turn_end` in index.ts; no other event
- [ ] Nudge fires exactly at: TUI + roundDetection on + ≥3 regex-matching lines + `upsertedThisRun() === false`
- [ ] Silent when any of: toggle off, non-TUI ctx.mode, upsert happened this run, <3 matching lines
- [ ] Throttled: a second qualifying detection within 3 turnsIndex does not notify; one at +3 does
- [ ] Message content never mutated anywhere (pure read of `event.message`)
- [ ] `lifecycle.upsertedThisRun()` added; no lifecycle behavior otherwise changed; existing lifecycle tests still pass
- [ ] Notify string matches h2.27 exactly
- [ ] [Mode A] JSDoc on regex + throttle

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, could they implement this successfully?" — Yes: the event payload shape is verified against the installed type declarations, the input flag and config toggle already exist in live code, the module/test conventions are quoted from sibling files, and the PRD clause is reproduced verbatim.

### Documentation & References

```yaml
- file: src/lifecycle.ts
  why: (a) the `submittedRun` flag to expose; (b) the exact track()/unsubscriber
        subscription pattern + `dispose()` shape to copy; (c) the [Mode A] JSDoc
        header style (PRD-clause → code-site map)
  pattern: createLifecycle(pi, opts) → { dispose() } with track(pi.on(...))
  gotcha: submittedRun is set ONLY on non-error upsert tool_execution_end
        (~line 187) and cleared on agent_settled close pass / submission
        delivery — turn_end fires before both, so the read is race-free.

- file: src/lifecycle.test.ts
  why: the makeOnMock bare-mock-pi test pattern (handler registry + emit);
        detect.test.ts extends it with a mock ctx second argument
  pattern: makeOnMock + emit(event, payload); assert registrations via pi.on mock
  gotcha: emit must pass BOTH (event, ctx) — handlers are ExtensionHandler<E>

- file: src/config.ts
  why: config.roundDetection already exists (lines 87/150/254) with default true
        and deep-merge coercion — DO NOT modify config.ts
  pattern: import { InterrogatorConfig } from "./config.js"
  gotcha: JSDoc already names detect.ts as the consumer (line 22)

- file: src/debug-commands.ts
  why: established ctx.ui.notify(message, "info") usage for user nudges

- file: src/index.ts
  why: wiring point — after lifecycle assignment; per-feature comment-block style

- file: node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts
  why: TurnEndEvent (lines 585-590): { type, turnIndex, message: AgentMessage,
        toolResults }; on("turn_end") at line 930; ExtensionHandler passes
        (event, ctx)
  gotcha: message.content is a block array — extract {type:"text"}.text parts,
        tolerate string, ignore everything else (never `as any`)

- file: plan/001_0d6760db6bc5/architecture/reference-patterns.md
  why: §5 events — "turn_end receives the completed message: event.message"
  section: Events

- file: plan/001_0d6760db6bc5/P1M7T4S1/research/notes.md
  why: full research: ordering analysis, regex/throttle design, conventions
```

### Current Codebase tree (relevant slice)

```bash
src/
  index.ts            # factory — wiring point (Task 3)
  config.ts           # roundDetection toggle EXISTS (no change)
  lifecycle.ts        # submittedRun flag — add getter (Task 1)
  detect.ts           # NEW (Task 2)
  detect.test.ts      # NEW (Task 4)
```

### Desired Codebase tree with files to be added

```bash
src/
  detect.ts           # NEW — createRoundDetector: turn_end heuristic + throttle + notify (pure detection, no transforms)
  detect.test.ts      # NEW — mock-pi + mock-ctx event tests
  lifecycle.ts        # MODIFIED — + upsertedThisRun() getter only
  index.ts            # MODIFIED — + one wiring block
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: turn_end fires BEFORE agent_settled's close pass clears submittedRun.
// Do the upsertedThisRun() read inside the turn_end handler only — never later.
// CRITICAL: ctx may be undefined in some host/mock configurations — guard
// `ctx?.mode !== "tui"` and `ctx?.ui?.notify` tolerantly (lifecycle precedent:
// unsubscribers are captured tolerantly because hosts differ).
// CRITICAL: throttling uses event.turnIndex (monotonic per session), NOT a
// manual counter — a manual counter would also count non-assistant events.
// GOTCHA: pi has no extension dispose seam in the factory — leave detector.dispose()
// unwired like the persistence mirror (index.ts precedent comment).
// GOTCHA: event.message.content blocks — only type === "text" contribute;
// reasoning/tool blocks must be ignored.
```

## Implementation Blueprint

### Data models and structure

No new data models. Only constants + closure state:

```ts
export const ROUND_LINE_RE = /^\s*(?:Q?\d+[\).:]|[❓\-•*])\s+.+\?/;
export const ROUND_NOTIFY_MESSAGE =
  "Question round detected in chat — /interrogate to move it into the panel";
const NOTIFY_EVERY_N_TURNS = 3;

export interface RoundDetectorOptions {
  config: Pick<InterrogatorConfig, "roundDetection">;
  lifecycle: Pick<Lifecycle, "upsertedThisRun">;
}
export interface RoundDetector { dispose(): void; }
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/lifecycle.ts
  - ADD to `Lifecycle` interface: `upsertedThisRun(): boolean`
  - ADD to returned object: `upsertedThisRun: () => submittedRun`
  - JSDoc: one line citing P1.M7.T4.S1 + the turn_end-before-agent_settled ordering
  - PRESERVE: every existing flag reset path untouched

Task 2: CREATE src/detect.ts
  - IMPLEMENT: createRoundDetector(pi, opts): RoundDetector (logic order in What §2)
  - FOLLOW pattern: src/lifecycle.ts track()/unsubscriber subscription + dispose
  - NAMING: ROUND_LINE_RE, ROUND_NOTIFY_MESSAGE, NOTIFY_EVERY_N_TURNS exports
  - PLACEMENT: src/detect.ts (flat module, sibling of lifecycle.ts)
  - [Mode A] JSDoc: module header (clause→site map) + regex + throttle docs

Task 3: MODIFY src/index.ts
  - INTEGRATE: const roundDetector = createRoundDetector(pi, { config, lifecycle });
    placed after lifecycle assignment; per-feature comment block "P1.M7.T4.S1"
  - PRESERVE: all existing wiring; no reorder

Task 4: CREATE src/detect.test.ts
  - IMPLEMENT: extend makeOnMock pattern (copy from lifecycle.test.ts) with
    mock ctx `{ mode: "tui", ui: { notify: vi.fn() } }` passed as emit's 2nd arg
  - FIXTURES: assistant message content block arrays (text blocks), incl. mixed
    blocks; matching fixture = 3+ lines like "1) What scope?\n2) Who...?\nQ3. Deadline?"
    and bullet variants "- Where?\n* Why?\n❓ When?"
  - CASES: fires (happy); off toggle; rpc mode; missing ctx; upsertedThisRun true;
    2 matching lines (no fire); consecutive detection throttled at turnIndex+1, +2;
    fires again at turnIndex+3; content untouched (message object frozen/identity)
  - NAMING: test_{behavior}_{scenario}
  - PLACEMENT: src/detect.test.ts

Task 5: MODIFY src/lifecycle.test.ts (append only)
  - ADD: test that upsertedThisRun() is true after a successful upsert end and
    false after the agent_settled close pass / noteSubmissionDelivered
```

### Implementation Patterns & Key Details

```ts
// Event handler skeleton — order of guards is the contract
track(
  pi.on("turn_end", (event, ctx) => {
    if (!opts.config.roundDetection) return;
    if (ctx?.mode !== "tui") return;
    if (event.turnIndex - lastNotifiedTurn < NOTIFY_EVERY_N_TURNS) return;
    if (opts.lifecycle.upsertedThisRun()) return;
    const text = assistantText(event.message); // defensive block-array extraction
    if (text === undefined) return;
    if (countRoundLines(text) < 3) return;
    ctx.ui.notify(ROUND_NOTIFY_MESSAGE, "info");
    lastNotifiedTurn = event.turnIndex;
  }),
);
// PATTERN: track() + unsubscribers + dispose() — copy from lifecycle.ts
// CRITICAL: NEVER write to event.message or call pi.sendMessage from here —
// FR-26 "never transforms content"; nudges user action only.
```

### Integration Points

```yaml
EVENTS:
  - subscribe: "pi.on(\"turn_end\") — the ONLY new subscription"
LIFECYCLE:
  - extend: "Lifecycle interface + implementation with upsertedThisRun()"
CONFIG:
  - consume only: "config.roundDetection (exists; no config.ts changes)"
INDEX:
  - add to: src/index.ts, one wiring block after lifecycle creation
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npx tsc --noEmit          # or the project's check script — see package.json scripts
npx eslint src/detect.ts src/lifecycle.ts src/index.ts 2>/dev/null || true
# Expected: zero type errors
```

### Level 2: Unit Tests

```bash
npx vitest run src/detect.test.ts -v
npx vitest run src/lifecycle.test.ts -v
npx vitest run               # full suite — no regressions (renderers work from P1.M7.T3 may be mid-flight; ensure only your files' failures are yours)
# Expected: all pass
```

### Level 3: Integration (manual TUI smoke)

```bash
# In a TUI session with the extension loaded:
# 1. Ask the model something that yields a numbered question list (3+ questions)
#    without letting it call interrogate → expect one info nudge naming /interrogate
# 2. Repeat the ask in the next turn → expect NO nudge (throttle)
# 3. Turn roundDetection off in .pi/settings.json "interrogator" → expect silence
```

### Level 4: Contract-specific validation

```bash
# Confirm the notify string matches the PRD verbatim:
grep -n "Question round detected in chat — /interrogate to move it into the panel" src/detect.ts
# Confirm regex verbatim:
grep -n 'Q?\\d+\[\\).:\]' src/detect.ts
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx vitest run` green (new + existing)
- [ ] `npx tsc --noEmit` clean
- [ ] Only src/detect.ts, src/detect.test.ts created; lifecycle.ts/index.ts minimally modified; config.ts untouched

### Feature Validation

- [ ] All What §2 guard orderings implemented and tested
- [ ] Throttle verified at turnIndex deltas 1, 2 (suppressed) and 3 (fires)
- [ ] No content mutation — detection is read-only
- [ ] Notify string + regex byte-identical to h2.27

### Code Quality Validation

- [ ] [Mode A] JSDoc on regex + throttle (module header follows lifecycle.ts style)
- [ ] track()/dispose() pattern matches lifecycle.ts convention
- [ ] No new dependencies; no `as any`

---

## Anti-Patterns to Avoid

- ❌ Don't duplicate upsert tracking inside detect.ts — consume the lifecycle flag (single source of truth)
- ❌ Don't notify during streaming/message_update — only the completed message at turn_end
- ❌ Don't auto-run `/interrogate` or sendMessage on detection — user action only
- ❌ Don't reset `lastNotifiedTurn` on session events not specified here (keep the module minimal)
- ❌ Don't count a user message — turn_end's `event.message` is the assistant message

## Confidence Score: 9/10 — every input (event shape, config flag, upsert flag) is verified against live code/types; the only residual risk is the turn_end-before-agent_settled ordering assumption, which is covered by a dedicated test and the tolerant getter read.

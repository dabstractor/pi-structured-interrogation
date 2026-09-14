name: "P1.M7.T2.S1 — session_before_compact handler with preservation instructions"
description: h2.42/FR-29 (ADAPTED per pi-api-validation §Mismatch 1) — pi 0.85.1 SessionBeforeCompactResult has NO customInstructions return, so implement FR-29 via the custom-compaction.ts pattern: on session_before_compact with an active interrogation, flush the state mirror, run summarization ourselves with the PRD's preservation text PREPENDED to the summarizer prompt, and return {compaction:{summary, firstKeptEntryId, tokensBefore, usage}}. On ANY failure return undefined (default compaction). Config toggle defaults on. AbortSignal-respecting.
---

## Goal

**Feature Goal**: When pi compacts the context mid-interrogation, the compaction summary verbatim-preserved the user's goals/plan constraints, all interrogation answers/changes, the interrogation goal, and the pointer that state is available via `interrogate({})` — implementing FR-29 through the only mechanism pi 0.85.1 offers (running the summarization ourselves), never blocking or breaking compaction.

**Deliverable**:
- CREATE `src/compaction.ts` — `createCompactionGuard(pi, { config, mirror })` subscribing `session_before_compact`; module exports `PRESERVATION_INSTRUCTIONS` (verbatim PRD text) and `buildPreservationPrompt(...)` (pure, testable); `[Mode A]` JSDoc documenting the PRD adaptation rationale.
- CREATE `src/compaction.test.ts` — vitest suite with fake `pi`/`ctx`/`modelRegistry`.
- EDIT `src/config.ts` — add toggle `compactionPreservation: true` (default, coerceBoolean, doc table row).
- EDIT `src/index.ts` — wire `createCompactionGuard(pi, { config, mirror })` in the factory.

**Success Definition**: `npx vitest run src/compaction.test.ts` green; full `npx vitest run` green; `npx tsc --noEmit` clean. AC-10: `/compact` mid-interrogation produces a summary generated with the preservation instructions prepended; a fresh interrogation-state mirror entry is appended BEFORE the compaction runs; on missing model / empty summary / thrown error / aborted signal / disabled toggle / no active interrogation, the handler returns `undefined` and default compaction proceeds untouched.

## User Persona

**Target User**: pi user deep in a long interrogation whose context has hit the compaction threshold (or who runs `/compact` manually).
**Use Case**: Questions were asked and answered 40k tokens ago; compaction fires; without this feature the summary could drop the user's stated plan constraints and answer history precisely when they matter most.
**User Journey**: interrogation active → `/compact` (or threshold/overflow compaction) → extension flushes mirror, summarizes with preservation instructions → session continues, model still knows the goal/answers and that `interrogate({})` re-reads full state.
**Pain Points Addressed**: amnesia after compaction — the Q37 residue problem's compaction half.

## Why

- h2.42 (verbatim spec): handler supplies preservation instructions to the summarizer; "No other compaction machinery"; post-compaction the model pull-refreshes and reconstruction survives via the entry mirror.
- FR-29 + h2.53: "Compaction: goal field + session_before_compact customInstructions (preserve user plan statements verbatim) + entry backup mirror; no injection machinery."
- **Adaptation (contract, RESEARCH NOTE)**: pi 0.85.1 `SessionBeforeCompactResult` = `{cancel?, compaction?}` — there is NO instructions-return field (unlike `session_before_tree`). Therefore FR-29 is implemented by running the summarization ourselves per `examples/extensions/custom-compaction.ts:23-45` with the preservation text PREPENDED to the prompt, returning `{compaction: {...}}`. Document this in JSDoc.

## What

- Subscribe `session_before_compact`. Handler logic:
  1. If `!config.toggles.compactionPreservation` → return `undefined`.
  2. If no active interrogation (`getState()` is `undefined` OR `orderedQuestions().length === 0`) → return `undefined` (zero-cost default compaction).
  3. `mirror.flush()` — append a FRESH `interrogation-state` entry NOW so post-compaction `read()`/reconstruction finds the mirror regardless of what compaction discards (item contract INPUT clause).
  4. Resolve a summarizer model from `ctx.modelRegistry`. If none → return `undefined`.
  5. Build the summarizer prompt: `PRESERVATION_INSTRUCTIONS` PREPENDED (verbatim, PRD h2.42) to a faithful rendition of pi's default summarization ask (structure, concision, `<conversation>` wrapping per custom-compaction.ts:37-52; include `previousSummary` when present). Export the pure builder for tests.
  6. `await ctx.modelRegistry.complete(model, { messages }, { maxTokens: 8192, signal: event.signal, cacheRetention: "none", sessionId: uuidv7() })` — AbortSignal always forwarded.
  7. Join text blocks; if empty/blank or `signal.aborted` → return `undefined`.
  8. Return `{ compaction: { summary, firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: event.preparation.tokensBefore, usage: response.usage } }`.
  9. Wrap steps 4-8 in try/catch → on ANY error `console.error` a single line and return `undefined`. **Never throw, never `cancel`, never block compaction.**
- Summarize `[...messagesToSummarize, ...turnPrefixMessages]` (custom-compaction.ts:31 pattern).
- Config toggle `compactionPreservation` (default `true`) following the exact `coerceBoolean`/DEFAULT_CONFIG/doc-table pattern of `gateWarnings` (src/config.ts:84,142,245,321).

### Success Criteria

- [ ] Preservation text is VERBATIM (see Gotchas — copy character-for-character).
- [ ] Mirror flushed synchronously before returning any compaction result.
- [ ] Disabled toggle / no active interrogation / no model / empty summary / abort / exception → `undefined` returned; default compaction unaffected.
- [ ] `signal` forwarded to `complete`; abort mid-request results in `undefined`, not a throw.
- [ ] AC-10 scriptable: unit test proves the prompt contains the preservation text and the returned `compaction` shape is correct.

## All Needed Context

### Context Completeness Check

Validated: implementer needs the pi event/result types, the canonical custom-compaction example, persistence.ts mirror seam, state.ts accessor, and config.ts toggle pattern — all cited with exact lines below.

### Documentation & References

```yaml
- file: node_modules/@earendil-works/pi-coding-agent/examples/extensions/custom-compaction.ts
  why: THE canonical pattern this item adapts. Lines 23-45: modelRegistry.find →
    serializeConversation(convertToLlm([...messagesToSummarize, ...turnPrefixMessages])) →
    single user message wrapping <conversation> + previousSummary context →
    modelRegistry.complete(model, {messages}, {maxTokens: 8192, signal, cacheRetention: "none",
    sessionId: uuidv7()}) → filter/join text blocks → return {compaction: {summary,
    firstKeptEntryId, tokensBefore, usage: response.usage}}. Error/missing-model/empty →
    plain `return;` (undefined → default compaction).
  pattern: copy this skeleton; PREPEND preservation instructions; keep the fall-through discipline.
  gotcha: the example picks a hardcoded gemini model — this item instead resolves the ACTIVE
    conversation model when reachable on the event ctx (check ctx fields at implementation;
    e.g. ctx.model), else any registry model, else undefined fall-through. Never hardcode a provider.

- file: node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts
  why: SessionBeforeCompactEvent (line 442: preparation, branchEntries, customInstructions?,
    reason "manual"|"threshold"|"overflow", willRetry, signal) and SessionBeforeCompactResult
    (line 857: {cancel?, compaction?} — NO customInstructions field; contrast
    SessionBeforeTreeResult at 861-866 which HAS one). ExtensionContext exposes
    modelRegistry (+ mode, sessionManager, ui).
  critical: returning `undefined` from the handler makes pi run default compaction — that is
    the designed failure mode for EVERYTHING going wrong.

- file: src/persistence.ts
  why: createStateMirror returns {flush(), dispose()}; flush() synchronously appends the pending
    `interrogation-state` entry (or no-ops). index.ts:81-82 already holds `mirror` in the
    factory closure — pass it into createCompactionGuard. Entry appends survive compaction
    (custom entries are never in LLM context).
  gotcha: flush() BEFORE building/returning anything — order matters per the item contract.

- file: src/state.ts
  why: getState() singleton accessor; state.orderedQuestions() for the active check.
    NO new state mutations here — read-only.

- file: src/config.ts
  why: toggle pattern to replicate exactly: interface field (line ~84
    `gateWarnings: boolean;`), DEFAULT_CONFIG entry (line ~142), coerceBoolean load
    (line ~245), toggles doc table (line ~318-324). Add `compactionPreservation` to all four.

- file: src/index.ts (lines 71-82)
  why: factory wiring point — `const mirror = createStateMirror(pi); pi.on("session_shutdown",
    () => mirror.flush());` exists there; add `createCompactionGuard(pi, { config, mirror });`
    right after so both share the same mirror instance.

- docfile: plan/001_0d6760db6bc5/P1M7T2S1/research/api-notes.md
  why: verified API shapes incl. CompactionPreparation fields and the internal
    customInstructions plumbing (default compact() accepts customInstructions as an
    "Additional focus:" suffix — extensions cannot pass it without doing the call themselves;
    that is the documented mismatch rationale).
```

### Current Codebase tree (relevant slice)

```bash
src/
  index.ts          # factory — mirror created at line 81; wire guard after line 82
  config.ts         # InterrogatorConfig.toggles {gateWarnings, roundDetection, digitQuickSelect}
  persistence.ts    # createStateMirror → {flush()}; INTERROGATION_STATE_ENTRY_TYPE
  state.ts          # getState(), orderedQuestions()
  lifecycle.test.ts # fake-pi construction pattern for tests
```

### Desired Codebase tree

```bash
src/
  compaction.ts       # NEW — createCompactionGuard, PRESERVATION_INSTRUCTIONS,
                      #      buildPreservationPrompt, [Mode A] JSDoc
  compaction.test.ts  # NEW — vitest suite (fake pi/ctx/modelRegistry/mirror)
  config.ts           # EDITED — + compactionPreservation toggle (4 sites)
  index.ts            # EDITED — ~1-line wiring
```

### Known Gotchas of our codebase & Library Quirks

```ts
// PRESERVATION INSTRUCTIONS — VERBATIM from PRD h2.42 (FR-29). Copy exactly:
export const PRESERVATION_INSTRUCTIONS =
  "Preserve verbatim: the user's stated goals and plan constraints from all messages " +
  "(including side conversations), all interrogation answers and later changes, the " +
  "interrogation goal, and the fact that current interrogation state is available via " +
  "interrogate({}).";
// (Keep as a single exported string constant; test asserts it byte-for-byte.)

// CRITICAL: NEVER return {cancel: true} from this handler — the spec says compaction
// must always be allowed to proceed; preservation is additive, never blocking.
// CRITICAL: event.signal must be passed to modelRegistry.complete — user-cancelled
// compaction must abort the summarization call; check signal.aborted after await.
// GOTCHA: response.content is a block array — filter type === "text" then join("\n")
// (custom-compaction.ts:63-66). Blank summary → undefined.
// GOTCHA: uuidv7 comes from "@earendil-works/pi-ai" (example import line 16);
// serializeConversation + convertToLlm from "@earendil-works/pi-coding-agent".
// GOTCHA: handler is async — pi awaits it; keep the total work one model call + one flush.
// GOTCHA: include previousSummary context when event.preparation.previousSummary exists
// (iterative compaction) so repeated compactions don't lose earlier preservation.
// DO NOT: modify state, open/close panels, or append anything beyond the mirror flush.
// DO NOT: hardcode a model provider — resolve from ctx (active model if exposed, else registry).
```

## Implementation Blueprint

### Data models and structure

```ts
// src/compaction.ts
import { uuidv7 } from "@earendil-works/pi-ai";
import { convertToLlm, serializeConversation, type ExtensionAPI, type SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import type { StateMirror } from "./persistence.js";
import { getState } from "./state.js";
import type { InterrogatorConfig } from "./config.js";

export const PRESERVATION_INSTRUCTIONS = /* verbatim, see Gotchas */;

/** Pure prompt builder — unit-testable without a model. */
export function buildPreservationPrompt(
  preparation: Pick<SessionBeforeCompactEvent["preparation"], "messagesToSummarize" | "turnPrefixMessages" | "previousSummary">,
): Array<{ role: "user"; content: [{ type: "text"; text: string }]; timestamp: number }>;

export function createCompactionGuard(
  pi: Pick<ExtensionAPI, "on">,
  opts: { config: InterrogatorConfig; mirror: Pick<StateMirror, "flush"> },
): void;
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/config.ts — add toggle compactionPreservation
  - FOUR sites: interface field (toggles block ~line 84), DEFAULT_CONFIG (~142, value true),
    loadConfigFrom coerceBoolean (~245), toggles doc table (~318, consumer "compaction.ts").
  - FOLLOW pattern: gateWarnings exactly (coerceBoolean(src.compactionPreservation, ...)).

Task 2: CREATE src/compaction.ts
  - IMPLEMENT: [Mode A] module JSDoc — explain the PRD adaptation (FR-29 assumed an
    instructions-return; SessionBeforeCompactResult has none; hence self-run summarization
    per custom-compaction.ts, preservation text prepended, undefined on any failure).
  - IMPLEMENT: PRESERVATION_INSTRUCTIONS const; buildPreservationPrompt (serialize
    [...messagesToSummarize, ...turnPrefixMessages], wrap in <conversation>, add
    <previous-summary> block when present, THEN the summarization ask with
    PRESERVATION_INSTRUCTIONS PREPENDED); createCompactionGuard subscribing
    pi.on("session_before_compact", handler) with the 9-step logic in What.
  - PLACEMENT: src/compaction.ts; no imports from panel/* or delivery.ts.

Task 3: EDIT src/index.ts
  - ADD after line 82 (mirror creation + shutdown flush):
      createCompactionGuard(pi, { config, mirror });
  - PRESERVE everything else; one-line additive edit plus import.

Task 4: CREATE src/compaction.test.ts
  - FOLLOW pattern: fake pi ({on: vi.fn() capturing handler}) like src/lifecycle.test.ts;
    fake ctx { modelRegistry: { complete: vi.fn(), find/model resolution } , mode };
    fake mirror { flush: vi.fn() }; hand-built preparation objects.
  - CASES:
    (a) disabled toggle → handler returns undefined, complete NOT called, mirror NOT flushed;
    (b) no state (getState undefined) → undefined, no calls;
    (c) empty orderedQuestions → undefined;
    (d) active interrogation happy path → flush called BEFORE complete; prompt text contains
        PRESERVATION_INSTRUCTIONS verbatim; returns {compaction:{summary, firstKeptEntryId,
        tokensBefore, usage}} with values from preparation/response;
    (e) model resolution fails → undefined;
    (f) complete rejects → undefined, no throw (console.error once);
    (g) signal.aborted after complete → undefined;
    (h) blank summary text → undefined;
    (i) previousSummary present → prompt contains it;
    (j) buildPreservationPrompt pure test: conversation wrapped, preservation text first.
  - STATE SETUP: use the state.ts seams (setState with a minimal state) or inject a
    stateGetter option — prefer an injectable `getState` opt (mirror the StateMirrorOptions
    pattern in persistence.ts) to avoid module-singleton coupling in tests.

Task 5: RUN gates
  - npx tsc --noEmit; npx vitest run; npx vitest run src/compaction.test.ts
```

### Implementation Patterns & Key Details

```ts
// Handler skeleton (adapted from custom-compaction.ts:23-45)
pi.on("session_before_compact", async (event, ctx) => {
  if (!config.toggles.compactionPreservation) return;
  const state = resolveState?.() ?? getState();
  if (!state || state.orderedQuestions().length === 0) return;
  try {
    mirror.flush();                                   // fresh mirror entry pre-compaction
    const model = resolveModel(ctx);                  // active model if reachable, else registry, else undefined
    if (!model) return;
    const messages = buildPreservationPrompt(event.preparation);
    const response = await ctx.modelRegistry.complete(model, { messages }, {
      maxTokens: 8192, signal: event.signal, cacheRetention: "none", sessionId: uuidv7(),
    });
    const summary = response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text).join("\n");
    if (!summary.trim() || event.signal.aborted) return;
    return {
      compaction: {
        summary,
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
        usage: response.usage,
      },
    };
  } catch (err) {
    console.error("interrogator: preservation compaction failed, using default", err);
    return; // undefined → default compaction — NEVER throw, NEVER cancel
  }
});
```

### Integration Points

```yaml
EVENTS:
  - pi.on("session_before_compact", handler)   # reason-agnostic: manual /compact, threshold, overflow
CONFIG:
  - config.toggles.compactionPreservation (NEW, default true) — h2.52 config surface
MIRROR:
  - shares the factory's single StateMirror instance (index.ts:81) — flush() only, never dispose()
STATE:
  - read-only via getState(); no mutations in this module
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npx tsc --noEmit
```

### Level 2: Unit Tests

```bash
npx vitest run src/compaction.test.ts -v
npx vitest run
```

### Level 3: Integration (manual smoke — record in research/)

```bash
# Real pi TUI: /interrogate-debug-upsert a question, answer it, then /compact.
# Expect: no errors; post-compact, ask the model what the interrogation goal/answers
# were (summary should preserve them); interrogate({}) read still returns full state
# (mirror reconstruction path, AC-10). Repeat with "interrogator": {"toggles":
# {"compactionPreservation": false}} → default compaction runs, handler inert.
```

### Level 4: Domain validation

- AC-10 checklist: summary preserves user plan statements verbatim-focus; subsequent `read` returns full state (mirror + reconstruction from P1.M7.T1).
- Verify no interference with `session_compact` / `session_compact_failed` consumers (none in this extension — confirm no double-subscription).

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` clean; `npx vitest run` fully green (incl. all 10+ new cases)
- [ ] Config tests still pass after the 4-site toggle addition

### Feature Validation

- [ ] Preservation text verbatim, exported, asserted byte-for-byte in a test
- [ ] Mirror flushed before summarization; fresh entry lands even if summary later fails
- [ ] All six undefined-return paths exercised (toggle, no state, empty set, no model, error, abort/empty)
- [ ] Returned `compaction` shape matches `CompactionResult` field-for-field
- [ ] Never cancels, never throws across the handler boundary

### Code Quality Validation

- [ ] [Mode A] JSDoc documents the PRD adaptation (no customInstructions in SessionBeforeCompactResult)
- [ ] No hardcoded model provider; no panel/delivery imports; state read-only
- [ ] index.ts edit is a one-line wiring; config.ts edit follows the gateWarnings pattern at all four sites

## Anti-Patterns to Avoid

- ❌ Don't return `{cancel: true}` — preservation must never block compaction.
- ❌ Don't run custom summarization when there's no active interrogation (wasted model call; default compaction is fine).
- ❌ Don't let an exception escape the handler — the try/catch + undefined return is the contract.
- ❌ Don't drop `signal` from the `complete` options — user-cancelled compaction must abort cleanly.
- ❌ Don't append mirror entries from this module directly — call `mirror.flush()`, persistence.ts owns entry writing.
- ❌ Don't modify state, open panels, or send messages here — compaction-time only.

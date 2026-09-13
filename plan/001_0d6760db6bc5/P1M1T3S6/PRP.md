---
name: "P1.M1.T3.S6 — Tool registration: resident text, guidelines, render rows, index wiring"
description: "Create src/tool.ts — the interrogate tool definition (resident description + 2 promptGuidelines verbatim from h2.24, InterrogateParams, renderCall/renderResult Text rows per h2.25) plus the execute() executor that routes all four actions through S1–S5 modules. Wire pi.registerTool in src/index.ts. Execute is strictly non-blocking: it never opens the panel and never awaits anything user-driven (panel opening is event-driven via state 'questions-upserted' → lifecycle, P1.M2.T2.S1)."
---

## Goal

**Feature Goal**: Register the `interrogate` tool on the pi extension API with the h2.24 agent-facing text VERBATIM (≤120-word description, 2 promptGuidelines bullets), the S1 typebox schema, compact TUI render rows (h2.25), and a complete `execute()` that routes read/upsert/reopen/record through parse (S1) → guards (S2) → caps (S3) → result builders (S4) → fallback (S5), with state creation/lookup and mode detection. Wire it in `src/index.ts` alongside the existing ping command.

**Deliverable**: `src/tool.ts` + `src/tool.test.ts` + modified `src/index.ts`. `src/tool.ts` exports:
- `INTERROGATE_TOOL_DESCRIPTION: string` — the h2.24 resident text, verbatim.
- `INTERROGATE_PROMPT_GUIDELINES: string[]` — the h2.24 2 bullets, verbatim.
- `createInterrogateTool(config: InterrogatorConfig): ToolDefinition` (or a plain object matching `pi.registerTool`'s parameter type) — name/description/promptGuidelines/parameters/execute/renderCall/renderResult.
- `executeInterrogate(args: unknown, ctx: ToolContext): InterrogateResult` — the testable executor core (pure-ish: reads ctx.mode/hasUI/model.contextWindow; no UI calls).
- `renderCallRow(args: unknown, n/newIds/updatedIds computed from state?): string` and `renderResultRows(...)` helpers if useful for unit tests — tests may instead call the registered render hooks directly with a fake theme (todo.ts example does this; see Context).

**Success Definition**: `npm test` + `npm run typecheck` green; the tool object carries the verbatim h2.24 strings (byte-exact test against a fixture in tool.test.ts); all four action paths return correct `InterrogateResult`s (including stale-throw and parse-error-throw); execute never awaits user input and never calls `ctx.ui.custom` (asserted by design + test: executor has no ui dependency beyond mode flags); index.ts registers the tool without breaking the ping command.

## User Persona

**Target User**: The LLM agent (consumer of the tool definition and results) and the pi TUI user (consumer of the compact tool rows).

**User Journey**: Model calls `interrogate({...})` → executor parses/routes/guards → returns a compact result immediately → turn ends → (later milestones) panel opens from the `questions-upserted` state event. In the transcript, the call renders as `interrogate 4 questions +4 new ~0 updated` and the result renders as the status line + epoch; expanded shows the full state summary.

**Pain Points Addressed**: No tool exists yet — everything from S1–S5 is unwired library code; renderers missing means default noisy tool rows; resident text drives correct model behavior (non-blocking, rev/epoch discipline, first-round breadth).

## Why

- h2.15: `pi.registerTool` (interrogate; `renderCall`/`renderResult` compact rows) is the single LLM entry point.
- h2.24: the description is the model's contract — must be resident and verbatim; `promptGuidelines` is the CONFIRMED field for the 2 bullets (pi-api-validation.md §registerTool, adaptation #5 — no standalone global-guidelines API exists, and none is needed since description is always resident for active tools).
- h2.0 commitments 1 (non-blocking) and 2 (pull-based): execute returns immediately; full state only in results/completion, never per-request injection.
- This is the integration point for ALL of P1.M1.T3; lifecycle (P1.M2.T2.S1) subscribes to state events the executor's merges already emit.

## What

### 1. Resident text (VERBATIM, byte-exact)

`INTERROGATE_TOOL_DESCRIPTION` — copy the h2.24 tool description block EXACTLY (the single paragraph starting "Structured interrogation: plan by asking the user questions…" and ending "…If unsure your view is current, read before upserting."). It is ~115 words — within the ≤120 convention. Do not paraphrase, do not add mode-specific text. [Mode A] JSDoc on the constant: "Resident description contract (h2.24): ≤120 words, verbatim from the PRD; pi keeps tool descriptions always resident for active tools, so no extra injection API is used (per-request injection is vetoed, h2.4)."

`INTERROGATE_PROMPT_GUIDELINES` — the two h2.24 bullets verbatim as a 2-element array:
1. `Use interrogate for structured planning questions instead of plain-text question blocks; send the full set in one call.`
2. `After answers arrive, re-ask only questions materially affected by the new answers, then let the interrogation complete.`

Also set `promptSnippet` (one-liner, pi-api-validation confirms the field): `Ask structured planning questions via the interrogate tool; users answer in a persistent panel.` (small addition, keeps discovery cheap; mark in JSDoc as ours, not PRD-verbatim).

### 2. Tool registration shape (h2.15 + pi-api-validation.md)

```ts
pi.registerTool({
  name: "interrogate",
  label: "interrogate",
  description: INTERROGATE_TOOL_DESCRIPTION,
  promptSnippet: INTERROGATE_PROMPT_SNIPPET,
  promptGuidelines: INTERROGATE_PROMPT_GUIDELINES,
  parameters: InterrogateParams,            // src/tool-schema.ts — S1 typebox schema
  execute: ...,                             // see §4
  renderCall: ...,                          // see §3
  renderResult: ...,                        // see §3
});
```

Naming per h2.3: tool `interrogate`. (customTypes `interrogation-submission`/`interrogation-completion` and entry `interrogation-state` belong to P1.M2/P1.M7 — do NOT create them here.)

### 3. Render rows (h2.25 verbatim)

- `renderCall(args, theme, _context)`: one-line row `interrogate {n} questions {+m new ~k updated}`.
  - `n` = number of questions in `args.questions` (0 for read/record/reopen → `interrogate 0 questions …`? NO — when `questions` is absent/empty render just `interrogate` + optional suffix for record (`record answers`) and reopen (`reopen panel`); keep it one compact line).
  - `m`/`k` for upserts: m = questions with no `rev`-bearing match among… — renderCall only receives ARGS, not state. Compute from args alone: `+m new` = questions whose `id` is present without `rev` (or `rev` absent); `~k updated` = questions carrying a `rev`. This is an approximation by design — the row is display-only (h2.25: "Renderers stay compact — the panel is the display, not the tool row"). Omit the `+m new ~k updated` suffix entirely when both are 0.
  - Theme it like todo.ts: `theme.fg("toolTitle", theme.bold("interrogate "))` + `theme.fg("muted", …)` suffix. Return `new Text(text, 0, 0)` — import `{ Text }` from `@earendil-works/pi-tui`.
- `renderResult(result, { expanded }, theme, _context)`:
  - Collapsed: `details.statusLine` (the h2.28 line already carried in the envelope) — `new Text(theme.fg("muted", statusLine), 0, 0)`.
  - `expanded`: the full state summary — reuse the read-result line format: render `details.state` through the same per-question one-liners as `buildReadResult`. Since that logic is private to results.ts, ADD a small exported helper there OR (preferred, zero touching of S4 files): import `buildReadResult` and extract — simplest compliant approach: `expanded` renders `buildReadResult(details.state).content` as multiple `Text` children in a `Box` (todo.ts:224-234 pattern; `Box` also from pi-tui). Prefer calling `buildReadResult(state).content` — it IS the full state summary (goal, status line, group summaries, per-question lines). Defensive: `details` may be undefined (stale/foreign results) → fall back to `result.content[0].text`.
  - Both stay compact: no borders, no boxes beyond the expanded list.

### 4. Executor — `execute(toolCallId, params, signal, onUpdate, ctx)`

Signature per pi-api-validation.md. Core flow (implement as `executeInterrogate(args, ctx)` for testability; `execute` wraps it and maps the result to pi's `{ content: [{type:"text", text}], details }`):

```
1. config: use the InterrogatorConfig passed to createInterrogateTool (loaded once in index.ts — see §6).
2. state: const existing = getState();
   - read/record/reopen with no existing state:
     * read → synthesize an empty state view WITHOUT persisting: createInterrogationState("").serialize()
       → buildReadResult → return (content shows `0/0 answered · 0 re-asked · 0 moot · epoch 0`; the model learns there is nothing yet).
     * record → throw new Error("no interrogation in progress — call interrogate with questions[] first") (plain Error; pi sets isError).
     * reopen → throw new Error("no interrogation state to reopen") (same).
   - upsert with no existing state: state = createInterrogationState(parsed.goal ?? "") and setState(state).
     With existing state: parsed.goal (when present) replaces the goal (setGoal or equivalent state method — verify exact method name on InterrogationState before use).
3. parse: const parsed = parseInterrogateParams(args, config) — always first, before any state work:
   if (!parsed.ok) throw new Error("invalid interrogate params:\n" + parsed.errors.map(e => `- ${e.path}: ${e.message}`).join("\n"))
   (throw = isError = correct: malformed input must not look like success; h2.22 guards never see it).
   Prepend parse warnings (parsed.warnings) to the caps warnings passed to the upsert result.
4. assertFresh(state, parsed.action) — S2; StaleError/Errors propagate out of execute unchanged (pi sets isError; the message already carries current state — do NOT catch).
5. Route by parsed.action:
   - read: buildReadResult(state.serialize()).
   - upsert:
     a. const capped = applyCaps(parsed.questions, parsed.goal ?? "", config, ctx.model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW)
        (define DEFAULT_CONTEXT_WINDOW = 200_000 locally; ctx.model is documented on ToolContext — guard defensively).
     b. Convert QuestionInput[] → merge.ts Question[] via whatever mapping merge.ts/S2 expects (applyUpsert takes `Question[]`; check src/merge.ts's input coercion — reuse the mapping already used in guards/caps tests).
     c. const merged = applyUpsert(state, questions) — fires `questions-upserted` + `changed` events. THE EVENT IS THE PANEL TRIGGER (P1.M3 / P1.M2.T2.S1) — execute does NOT open any panel, does NOT call ctx.ui.*, returns immediately after building the result. NEVER await anything user-driven.
     d. TUI (isNonTui(ctx.mode, ctx.hasUI) === false): buildUpsertResult(state.serialize(), [...parsed.warnings, ...capped.warnings, ...merged-derived warnings if any — check UpsertResult shape in merge.ts; if it carries warnings/withdrawals info the model must see, append them as plain lines after the builder's content via a small local append]).
     e. Non-TUI: status line + buildFallbackDigest(state.serialize()) + same warnings. Compose: take buildUpsertResult(...) content lines, replace/append — simplest: content = [buildStatusLine(serialize), ...digest lines, ...warnings].join("\n") with details envelope action "upsert" (build inline: {state: structuredClone(serialize), epoch, statusLine, action:"upsert"} — envelope() is private; building inline in tool.ts is acceptable and documented, do NOT modify results.ts).
   - reopen: TUI → content = statusLine + "\nPanel resurfaced." (the panel host subscribes later; today this is the model-facing ack), details action "reopen" built inline like (e). Non-TUI → same as read (buildReadResult) — nothing to resurface.
   - record:
     a. TUI → IGNORED per h2.20: return content = statusLine + "\nanswers ignored in TUI — answers arrive via the panel." action "record". No state change.
     b. Non-TUI → recordAnswers(state, parsed.answers) (assertFresh already ran in step 4), then content = [statusLine, ...(unknown.length ? [`unknown ids: ${unknown.join(", ")}`] : []), ...(recorded.length ? [] : ["no answers recorded"])].join("\n"), details action "record" inline envelope.
6. Return mapping: { content: [{ type: "text", text: result.content }], details: result.details }.
```

Non-blocking invariants (assert in tests): execute contains no `await` except trivially none; no `ctx.ui` calls; no `pi.sendMessage`; state events are the only side-channel.

### 5. index.ts wiring

- Replace/extend the factory: keep the `interrogate-ping` command (P1.M1.T1.S1 contract — do not remove).
- Load config once at factory time: `const config = await loadConfig(process.cwd())` — the factory may be async (verify ExtensionAPI factory signature: default export can be `async (pi) => {...}`; if not async, use `.then` or make loadConfigFrom synchronous-seamed — check how other extensions in pi examples handle async init; the config PRP's `loadConfig(cwd)` is async). If the factory must be sync, wrap: register the tool with a lazily-resolved config captured in a mutable holder, or call `loadConfigFrom` with sync fs reads — CHECK `src/config.ts` `loadConfigFrom` (it reads files; if fs/promises, the cleanest is an async factory — pi extension factories DO support async, confirmed in docs/extensions.md extension entry shape).
- `pi.registerTool(createInterrogateTool(config))`.

### Success Criteria

- [ ] Description + guidelines byte-identical to h2.24 (fixture test)
- [ ] All four actions return correct InterrogateResult; parse errors and stale guards throw (isError); record without state throws; read with no state returns empty view
- [ ] renderCall/renderResult produce the h2.25 rows (unit-tested with a stub theme: `{ fg: (_n, s) => s, bold: (s) => s }`)
- [ ] index.ts registers both ping and interrogate; typecheck + full test suite green
- [ ] Execute path has zero UI/await dependencies (grep-able: no `ctx.ui`, no `await` in executor body)

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets: the verbatim resident text, exact registration field names (from the validated API doc), the render-row formats with a reference implementation pattern (todo.ts), the full executor routing including state bootstrap and mode split, and every upstream module's export contract. No guessing.

### Documentation & References

```yaml
- file: plan/001_0d6760db6bc5/architecture/pi-api-validation.md
  why: §registerTool exact signature (name/label/description/promptSnippet/promptGuidelines/parameters/execute/renderCall/renderResult); isError ONLY via throw (extensions.md:2068); ctx.mode/ctx.hasUI; adaptation #5 (promptGuidelines is THE mechanism)
  critical: execute signature is (toolCallId, params, signal, onUpdate, ctx); renderResult's second arg is { expanded }

- file: /home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/todo.ts (lines 200-240)
  why: renderCall/renderResult reference pattern — theme.fg("toolTitle", theme.bold(...)), new Text(text, 0, 0), expanded flag branching, result.content[0] fallback
  gotcha: import { Text } from "@earendil-works/pi-tui" (todo.ts:15) — NOT from pi-coding-agent

- file: src/tool-schema.ts
  why: InterrogateParams (typebox), ParsedAction union + routing precedence, ParseResult {ok, action?, errors, warnings}
  gotcha: routing returns record in ALL modes — the TUI-ignore decision is THIS executor's job

- file: src/guards.ts
  why: assertFresh(state, parsed) — call before record/upsert; read/reopen never guarded; StaleError propagates (never catch)
- file: src/caps.ts
  why: applyCaps(questions, goal, config, contextWindow) → CapsResult {questions, goal, warnings}
- file: src/merge.ts
  why: applyUpsert(state, Question[]) → UpsertResult (check exact field names — withdrawals/warnings if any); QuestionInput→Question mapping
- file: src/results.ts
  why: buildStatusLine / buildReadResult / buildUpsertResult / InterrogateResult / ResultDetails (action union incl. "record"/"reopen"); envelope() is PRIVATE — reopen/record envelopes are built inline in tool.ts (documented decision, do not edit results.ts)
- file: src/fallback.ts  (arriving from S5 — CONTRACT, assume its PRP exactly)
  why: isNonTui(mode, hasUI), buildFallbackDigest(state.serialize()), recordAnswers(state, answers) → {recorded, unknown}
- file: src/state.ts
  why: getState/setState/resetState module singletons; createInterrogationState(goal); StateEvents (questions-upserted is the panel trigger); goal-setting method (verify name)
- file: src/config.ts
  why: loadConfig(cwd) / loadConfigFrom(paths) — async; resolveKeyLabels not needed here
- file: src/index.ts
  why: current factory — keep interrogate-ping, add async config load + pi.registerTool(createInterrogateTool(config))
- file: plan/001_0d6760db6bc5/prd_snapshot.md (h2.24, h2.25, h2.15, h2.3, h2.0)
  why: verbatim resident text and render-row formats; naming; non-blocking core commitment
```

### Current Codebase tree

```bash
src/ index.ts config.ts state.ts merge.ts depends-on.ts snapshots.ts tool-schema.ts guards.ts caps.ts results.ts (+ *.test.ts)
# fallback.ts arriving from S5 (parallel — assume its PRP contract exactly)
```

### Desired Codebase tree

```bash
src/
  tool.ts          # NEW — resident text consts, createInterrogateTool, executeInterrogate, render hooks
  tool.test.ts     # NEW — verbatim-string fixture, all action routes, renderer rows, registration wiring
  index.ts         # MODIFIED — async config load + registerTool (ping preserved)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// ESM: relative imports need ".js" suffix ("./tool-schema.js")
// isError is set ONLY by throwing from execute — never return an isError field (pi-api-validation.md)
// StaleError must propagate UNCAUGHT — its message is the model's self-heal signal (h2.22)
// renderCall receives ARGS ONLY (no state access) — new/updated counts are args-derived approximations, fine per h2.25
// Text/Box come from "@earendil-works/pi-tui"; theme helpers theme.fg(name, s), theme.bold(s) — stub them in tests
// NEVER await user input or open panels in execute (h2.0 §1); the state event does it later
// description ≤120 words is a convention, not an API limit — the h2.24 text already fits
// envelope() in results.ts is private; reopen/record/non-TUI-upsert envelopes are built inline ({state: structuredClone(serialize), epoch, statusLine, action}) — do NOT modify results.ts (S4/S5 parallel ownership)
// recordAnswers bumps epoch itself; assertFresh runs BEFORE it (S5's documented ordering contract)
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/tool.ts — constants + registration object
  - INTERROGATE_TOOL_DESCRIPTION / INTERROGATE_PROMPT_GUIDELINES / INTERROGATE_PROMPT_SNIPPET verbatim per What §1, Mode A JSDoc quoting the ≤120-word resident-description contract
  - createInterrogateTool(config): {name:"interrogate", label, description, promptSnippet, promptGuidelines, parameters: InterrogateParams, execute, renderCall, renderResult}
  - execute delegates to executeInterrogate(params, ctx) and maps to pi result shape

Task 2: IMPLEMENT executeInterrogate routing
  - per What §4: parse → errors-throw → state bootstrap (getState/createInterrogationState/setState; goal update method verified on InterrogationState) → assertFresh (propagate) → per-action build
  - upsert: applyCaps → input mapping → applyUpsert → TUI buildUpsertResult / non-TUI digest composite (inline envelope)
  - record: TUI ignore-note / non-TUI recordAnswers + status line
  - read/reopen per §4
  - NO ctx.ui, NO awaits, NO sendMessage

Task 3: IMPLEMENT renderCall/renderResult
  - renderCall: themed one-liner `interrogate {n} questions {+m new ~k updated}` (+record/reopen variants when questions absent); Text from pi-tui
  - renderResult: collapsed = details.statusLine; expanded = buildReadResult(details.state).content as Text/Box children; details-undefined fallback

Task 4: MODIFY src/index.ts
  - async factory: const config = await loadConfig(process.cwd()); pi.registerTool(createInterrogateTool(config)); PRESERVE interrogate-ping

Task 5: CREATE src/tool.test.ts
  - FOLLOW pattern: src/results.test.ts / src/guards.test.ts (fixtures, no pi runtime imports)
  - CASES: (a) description/guidelines byte-equal to h2.24 fixture string; word count ≤120; (b) read empty-state result; (c) upsert TUI result incl. warnings order; (d) upsert non-TUI digest composite; (e) record TUI ignore / non-TUI apply + unknown ids + no-state throw; (f) reopen both modes; (g) parse-error throw message format; (h) stale propagation (rev mismatch → StaleError escapes executeInterrogate); (i) renderCall rows for upsert/read/record/reopen + counts; (j) renderResult collapsed/expanded/undefined-details; (k) epoch/rev side-effects via getState() after upsert; questions-upserted event fired
  - Stub theme: { fg: (_n, s) => s, bold: (s) => s }; stub ctx: { mode, hasUI, model: { contextWindow } }
```

### Implementation Patterns & Key Details

```ts
// Renderer (todo.ts:216-234 adaptation):
renderCall(args, theme, _context) {
  let text = theme.fg("toolTitle", theme.bold("interrogate "));
  if (Array.isArray(args?.questions) && args.questions.length > 0) {
    const upds = args.questions.filter((q: any) => typeof q.rev === "number").length;
    const news = args.questions.length - upds;
    const parts = [`${args.questions.length} questions`];
    if (news) parts.push(`+${news} new`);
    if (upds) parts.push(`~${upds} updated`);
    text += theme.fg("muted", parts.join(" "));
  } else if (Array.isArray(args?.answers)) text += theme.fg("muted", "record answers");
  else if (args?.reopen) text += theme.fg("muted", "reopen panel");
  return new Text(text, 0, 0);
}

// Executor skeleton — non-blocking by construction (sync body):
function executeInterrogate(args: unknown, ctx: ToolCtx): InterrogateResult {
  const parsed = parseInterrogateParams(args, config);
  if (!parsed.ok) throw new Error(...);
  let state = getState();
  /* bootstrap per §4 step 2 */
  assertFresh(state, parsed.action!);           // throws propagate
  switch (parsed.action!.action) { /* read | upsert | reopen | record */ }
}
```

### Integration Points

```yaml
REGISTRATION:
  - src/index.ts factory: pi.registerTool(createInterrogateTool(config)) — alongside existing interrogate-ping
DOWNSTREAM CONSUMERS (do NOT implement):
  - P1.M2.T2.S1 lifecycle: subscribes to state 'questions-upserted' / pi.on("tool_execution_end") for auto-close
  - P1.M3 panel host: opens on state events emitted by applyUpsert inside this executor
  - P1.M2.T3.S1 debug commands: will call executeInterrogate directly
CONFIG: none new (caps read via existing config object)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npx vitest run src/tool.test.ts
```

### Level 2: Unit Tests

```bash
npm test   # full suite green, no regressions in S1–S5 tests
```

### Level 3: Integration Testing

Load-test the real registration (no full session needed):

```bash
# In a scratch dir with the extension linked, start pi and check the tool is listed / callable:
echo 'What tools do you have?' | pi -p 2>&1 | head -5
# Or minimal smoke: pi starts without extension-load errors and /interrogate-ping still answers.
```

Verify no load errors in pi's extension log output. Full end-to-end (panel etc.) belongs to later milestones.

### Level 4: Domain Validation

Manual transcript check (post-load): call the tool from a scratch pi session with a 2-question upsert; confirm the tool row shows `interrogate 2 questions +2 new` and the result row shows the h2.28 status line; confirm execute returned instantly (non-blocking).

## Final Validation Checklist

- [ ] `npm run typecheck` clean; `npm test` all green
- [ ] h2.24 description + 2 guidelines byte-verbatim (fixture test); description ≤120 words
- [ ] Registration uses exactly: name interrogate, promptGuidelines, parameters InterrogateParams (h2.3/h2.15)
- [ ] renderCall/renderResult match h2.25 formats; Text from @earendil-works/pi-tui; todo.ts pattern followed
- [ ] Executor: parse-error → throw; assertFresh → propagate; all 4 actions routed; state bootstrap + module singletons used
- [ ] Non-TUI: digest composite on upsert, recordAnswers on record; TUI: record ignored (h2.20)
- [ ] Non-blocking: no ctx.ui, no awaits, no sendMessage in execute; panel triggering left to state events (P1.M2.T2.S1)
- [ ] index.ts: ping preserved, config loaded once, tool registered; reopen/record envelopes built inline (results.ts untouched)
- [ ] Mode A JSDoc on the tool registration quoting the resident-description contract

## Anti-Patterns to Avoid

- ❌ Don't open the panel (or await anything) inside execute — h2.0 §1 non-blocking is absolute
- ❌ Don't catch StaleError or reformat it — propagation IS the healing mechanism
- ❌ Don't return isError fields — pi only honors throws
- ❌ Don't modify results.ts / fallback.ts / tool-schema.ts (parallel-owned S1–S5 contracts); compose inline in tool.ts
- ❌ Don't invent customTypes (`interrogation-submission` etc.) — they belong to P1.M2/P1.M7
- ❌ Don't paraphrase the h2.24 text — byte-exact fixture test will fail
- ❌ Don't make renderCall state-dependent — it only receives args

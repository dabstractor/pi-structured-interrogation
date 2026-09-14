# PRP — P1.M7.T3.S2: Completion recap card + state entry renderer

## Goal

**Feature Goal**: Register two TUI renderers: (a) a `registerMessageRenderer` for `customType: "interrogation-completion"` that draws the user-only recap card (goal, every question with final answer grouped, timestamps; `expanded` reveals withdrawn/moot with reasons) from `message.details`; (b) a `registerEntryRenderer` for `customType: "interrogation-state"` that draws a dimmed, non-interactive one-line mirror marker `· interrogation state @ epoch {n}` in the transcript audit trail.

**Deliverable**: Extensions to `src/renderers.ts` (created by P1.M7.T3.S1 — do NOT restructure its submission-card code): two new pure build functions (`buildCompletionRecapCard`, `buildStateEntryMarker`) + two thin registration shims (`registerCompletionRecapRenderer`, `registerStateEntryRenderer`), wired from `src/index.ts`; tests appended to `src/renderers.test.ts`.

**Success Definition**: When `buildCompletion` (src/delivery.ts, live) delivers its `CompletionMessage`, the TUI shows the recap card satisfying AC-14 — goal header, grouped questions with final answers and ★ marks, timestamps; expanded adds withdrawn/moot with reasons. When persistence.ts's debounced `appendEntry("interrogation-state", data)` fires, the transcript shows one dimmed line `· interrogation state @ epoch {n}` that is not interactive (no expanded difference required beyond optional timestamp detail). Both cards are user-only; the model reads `message.content`, never the render.

## Why

- h2.36 mandates both renderers. Without them, the completion message falls back to raw `content` text (no visual recap, no AC-14) and `interrogation-state` mirror entries render with pi's default (or nothing) — breaking the visible audit trail promised by h2.40 layer 3.
- The recap card is the user's payoff moment of the whole interrogation: everything answered, grouped, in one card.
- This is the final piece of P1.M7.T3; it consumes S1's freshly-created `src/renderers.ts` and completes the renderer surface.

## User Persona (if applicable)

**Target User**: pi TUI user who answered an interrogation in the panel.

**Use Case**: Interrogation completes (auto-close h2.44); user scrolls the transcript to review every final answer, and sees dimmed `interrogation state` markers that mutations happened (audit trail).

**User Journey**: Panel closes on completion → recap card appears in transcript → user expands it (pi's transcript expand interaction) to see withdrawn/moot reasons and full free-text. Later, mirror markers appear after each debounced mutation window.

**Pain Points Addressed**: raw-text fallback for the completion record; invisible state-mirror entries.

## What

Per h2.36 + h2.46:

1. **`interrogation-completion` message renderer** (registerMessageRenderer): compact recap card from `message.details` —
   - Header: `INTERROGATION COMPLETE — {goal}` (title-styled, follow S1's header pattern)
   - One line per question, grouped in order, with group label: `{group} {id} {title}: {answer}{ ★?}` — collapsed shows this compactly (truncate long free-text via `truncateToWidth`; full free-text only when expanded)
   - Footer: `{n} withdrawn/moot` summary hint when `withdrawnMoot.length > 0` (details only when expanded), plus `completed {localeString}` timestamp
   - `expanded`: every question untruncated including `— {freeText}`, per-question answeredAt timestamps dimmed, full `Withdrawn/moot:` lines `{id} ({status}: {reason})`, all `NOTES:` lines
   - Defensive fallback: message without `details` (or missing groups) renders plain `message.content`
2. **`interrogation-state` entry renderer** (registerEntryRenderer): one dimmed line `· interrogation state @ epoch {epoch}` using `theme.fg("dim", ...)`; audit trail, NOT interactive. (`expanded` may add a dimmed `at` timestamp line — optional, keep minimal.) Defensive: `entry.data` missing/epoch absent → still render a marker with `?`.
3. **[Mode A] JSDoc** on both build functions documenting the card data contracts (CompletionMessage.details fields, InterrogationStateEntryData fields) and collapsed/expanded budgets.

### Success Criteria

- [ ] Renderer registered for exact customType `"interrogation-completion"` via `pi.registerMessageRenderer` in `src/index.ts`
- [ ] Renderer registered for exact customType `"interrogation-state"` via `pi.registerEntryRenderer` in `src/index.ts` (use `INTERROGATION_STATE_ENTRY_TYPE` from `./persistence.js`)
- [ ] Collapsed recap: goal header + every grouped question with final answer + ★ marks + completion timestamp (AC-14)
- [ ] Expanded recap: withdrawn/moot with reasons (h2.36), full free-text, NOTES, per-question answeredAt
- [ ] Entry marker: single dimmed line `· interrogation state @ epoch {n}`; not interactive
- [ ] Both build functions pure — no live-state reads, no pi API calls inside the build function
- [ ] Defensive fallbacks for missing `details` / `entry.data`
- [ ] S1's `buildSubmissionCard` / `registerSubmissionCardRenderer` untouched and still passing
- [ ] JSDoc documents card data contracts (Mode A)

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, could they implement this successfully?" — Yes: both input shapes are fully defined in live code (`src/delivery.ts`, `src/persistence.ts`), the pi API signatures are validated in `architecture/pi-api-validation.md` line 50, and S1's PRP (contract) defines the exact file/pattern this extends.

### Documentation & References

```yaml
- url: file:///home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md
  section: "pi.registerEntryRenderer(customType, renderer)" and "Message and Entry Rendering"
  why: exact signatures — registerMessageRenderer gets (message, { expanded, outputPad }, theme);
        registerEntryRenderer<T> gets (entry, { expanded }, theme) — NO outputPad for entries
  critical: entry renderer receives entry.data as the payload; match is by EXACT customType string;
        entries are durable and NOT sent to the LLM

- url: file:///home/dustin/projects/pi/packages/coding-agent/examples/extensions/entry-renderer.ts
  why: canonical entry-renderer example — defensive `entry.data ?? default`, Box+Text per line,
        `new Date(iso).toLocaleString()` for timestamps, theme.fg("dim") styling
  pattern: pi.registerEntryRenderer<StatusCardData>("status-card", (entry, { expanded }, theme) => {...})
  gotcha: entry.data may be undefined — always default

- file: src/delivery.ts
  why: THE input contract — CompletionMessage (lines ~217–244) with details { goal, groups, notes,
        withdrawnMoot, completedAt, epoch } and CompletionRecapEntry { id, title, answer, star,
        freeText?, answeredAt? } (lines ~195–215)
  pattern: import type { CompletionMessage } from "./delivery.js"; read message.details (cast or guard)
  gotcha: freeText/answeredAt keys are OMITTED when absent — use truthiness, never .length;
        groups are in first-appearance order; notes may be []

- file: src/persistence.ts
  why: entry input contract — INTERROGATION_STATE_ENTRY_TYPE const (line 59) and
        InterrogationStateEntryData { state: SerializedState; epoch: number; at: string } (lines 65–76)
  pattern: import { INTERROGATION_STATE_ENTRY_TYPE } from "./persistence.js";
        type StateMirrorData = { epoch: number; at: string } — only epoch/at are needed to render
  gotcha: do NOT render the full SerializedState — the mirror is a one-line marker (h2.36)

- file: src/renderers.ts (created by P1.M7.T3.S1 — parallel; treat as contract)
  why: EXTEND this file — follow its buildSubmissionCard pattern exactly: pure exported build
        function taking (data, { expanded, outputPad }, theme) returning Text|Box, plus a thin
        registerX(pi) shim; append tests to src/renderers.test.ts
  pattern: build function asserts nothing, imports only types; shim is 3–6 lines
  gotcha: S1 runs in parallel — add NEW exports only; do not edit, rename, or move S1's code

- file: src/index.ts
  why: registration point — S1 adds registerSubmissionCardRenderer(pi); you add
        registerCompletionRecapRenderer(pi) and registerStateEntryRenderer(pi) right after it
  pattern: named-import the register functions from "./renderers.js" and call inside the factory
  gotcha: keep your index.ts edit to imports + two calls (minimal merge-conflict surface with S1)

- file: src/tool.ts
  why: repo's established Box/Text/theme pattern (renderResult): new Text(line, 0, 0) per line,
        theme.fg("toolTitle", theme.bold(...)), theme.fg("dim", ...)

- url: file:///home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/tui.md
  section: "ANSI-safe text helpers"
  why: truncateToWidth / visibleWidth from "@earendil-works/pi-tui" for collapsed free-text truncation
  gotcha: never String.slice (ANSI-unsafe); reapply theme.fg per line

- docfile: plan/001_0d6760db6bc5/P1M7T3S2/research/contracts.md
  why: this item's full research — exact line references and shapes for every contract above
```

### Current Codebase tree (relevant slice)

```bash
src/
  index.ts            # factory — S1 adds submission renderer registration; you add 2 more
  delivery.ts         # buildCompletion → CompletionMessage with details (READ-ONLY contract)
  persistence.ts      # INTERROGATION_STATE_ENTRY_TYPE + InterrogationStateEntryData (contract)
  renderers.ts        # created by S1: submission card — you EXTEND with 2 build fns + 2 shims
  renderers.test.ts   # created by S1: stub-theme tests — you append suites
```

### Desired Codebase tree

```bash
src/
  renderers.ts        # + buildCompletionRecapCard(details, {expanded, outputPad}, theme): Text|Box (pure, exported)
                      # + registerCompletionRecapRenderer(pi)
                      # + buildStateEntryMarker(data, {expanded}, theme): Text|Box (pure, exported)
                      # + registerStateEntryRenderer(pi)
  renderers.test.ts   # + vitest suites for both build functions (stub theme)
  index.ts            # + 2 imports + 2 registration calls
```

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL: customType literals must match EXACTLY: "interrogation-completion" (delivery.ts)
#   and "interrogation-state" (use the exported INTERROGATION_STATE_ENTRY_TYPE const).
# CRITICAL: entry renderer options = { expanded } ONLY — no outputPad (message renderer only).
# GOTCHA: freeText / answeredAt / note keys are OMITTED when absent — truthiness checks, not .length.
# GOTCHA: relative imports in src/ MUST use ".js" extension (repo-wide ESM convention).
# GOTCHA: multi-line styled text: theme styles do not carry across lines — reapply per Text line.
# GOTCHA: S1 is implementing renderers.ts in parallel — additive changes only; if the file
#   doesn't exist yet when you start, create it matching S1's PRP structure (build fn + shim).
# GOTCHA: withdrawn/moot reasons come pre-computed in details.withdrawnMoot — do NOT recompute
#   dependency evaluation in the renderer (it must stay pure/cheap).
```

## Implementation Blueprint

### Data models and structure

No new data models — this item CONSUMES existing contracts. Type imports only:

```ts
import type { CompletionMessage } from "./delivery.js";
import { INTERROGATION_STATE_ENTRY_TYPE } from "./persistence.js";
// recap data type: CompletionMessage["details"]
// entry data type: { epoch: number; at: string } (structural subset of InterrogationStateEntryData —
//   accept `Partial<InterrogationStateEntryData>`-ish defensively; epoch may be missing → render "?")
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD to src/renderers.ts — buildCompletionRecapCard(details, { expanded, outputPad }, theme): Text | Box
  - IMPLEMENT: pure function taking CompletionMessage["details"]
  - COLLAPSED: header `INTERROGATION COMPLETE — {goal}` (toolTitle+bold); one line per question per group
    `[group] {id} {title}: {answer}{ ★?}` (★ via theme.fg("accent","★")); freeText truncated to
    outputPad-aware width via truncateToWidth when present; footer dimmed `completed {new Date(completedAt).toLocaleString()}`
    + `{withdrawnMoot.length} withdrawn/moot` hint when > 0
  - EXPANDED: every line untruncated with `— {freeText}` in full; dimmed per-question answeredAt
    (omit when absent); NOTES section (one line per notes[] entry, skip silently when empty);
    `Withdrawn/moot:` lines `{id} ({status}: {reason})` per details.withdrawnMoot (or `(none)`);
    dimmed `epoch {epoch}` line
  - FOLLOW pattern: S1's buildSubmissionCard in the same file (collapsed→budgeted Text lines,
    expanded→Box with Text children; theme.fg per line; truncateToWidth for truncation)
  - GOTCHA: defensive — details undefined or groups empty → render fallback: split message content
    (the renderer receives the full message; pass content in for the fallback)
  - PLACEMENT: src/renderers.ts, in a new "completion recap card (P1.M7.T3.S2)" section

Task 2: ADD to src/renderers.ts — buildStateEntryMarker(data, { expanded }, theme): Text | Box
  - IMPLEMENT: one line `· interrogation state @ epoch {epoch}` all inside theme.fg("dim", ...)
  - EXPANDED: optionally add dimmed `{new Date(data.at).toLocaleString()}` second line
  - GOTCHA: data/epoch may be undefined → render `· interrogation state @ epoch ?`; NEVER render
    data.state (mirror is a marker, not a dump)
  - PLACEMENT: same file, "state mirror entry marker" section

Task 3: ADD registration shims to src/renderers.ts
  - IMPLEMENT: export function registerCompletionRecapRenderer(pi: ExtensionAPI): registers
    pi.registerMessageRenderer("interrogation-completion", (message, opts, theme) =>
      buildCompletionRecapCard(message.details, opts, theme, message.content))
    — pass content as fallback param (adjust Task 1 signature accordingly: (details, opts, theme, fallbackContent))
  - IMPLEMENT: export function registerStateEntryRenderer(pi: ExtensionAPI): registers
    pi.registerEntryRenderer<{ epoch?: number; at?: string }>(INTERROGATION_STATE_ENTRY_TYPE,
      (entry, opts, theme) => buildStateEntryMarker(entry.data, opts, theme))
  - FOLLOW pattern: S1's registerSubmissionCardRenderer shim

Task 4: MODIFY src/index.ts
  - ADD: import + call registerCompletionRecapRenderer(pi) and registerStateEntryRenderer(pi)
    immediately after S1's registerSubmissionCardRenderer(pi)
  - PRESERVE: everything else; keep edit minimal (merge-friendly with S1)

Task 5: APPEND tests to src/renderers.test.ts
  - FOLLOW pattern: S1's tests — stub theme { fg: (k,t)=>t, bold: t=>t } (see src/tool.test.ts);
    assert on plain strings in Text children / Box child counts
  - CASES (completion): collapsed shows goal, every grouped question line, ★, timestamp;
    withdrawn/moot hint present; expanded shows reasons, free-text, NOTES, epoch; empty
    withdrawnMoot/notes render nothing/`(none)` appropriately; details-undefined fallback renders content
  - CASES (entry): renders `· interrogation state @ epoch {n}`; undefined data → `epoch ?`;
    never includes state dump content
  - NAMING: describe("buildCompletionRecapCard"), test("...") matching repo style
```

### Implementation Patterns & Key Details

```ts
// Recap line pattern (per question)
const line = `[${g.group}] ${q.id} ${q.title}: ${q.answer}` + (q.star ? ` ${theme.fg("accent", "★")}` : "");
lines.push(new Text(line + (q.freeText ? ` — ${expanded ? q.freeText : truncateToWidth(q.freeText, budget)}` : ""), 0, 0));
// expanded: push dimmed answeredAt line per question (omit when undefined)

// Entry marker — the whole spec
new Text(theme.fg("dim", `· interrogation state @ epoch ${data?.epoch ?? "?"}`), 0, 0);
```

### Integration Points

```yaml
REGISTRATION:
  - add to: src/index.ts factory body
  - pattern: "registerCompletionRecapRenderer(pi); registerStateEntryRenderer(pi);"
NO new config, NO database, NO routes. Pure display layer.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx tsc --noEmit          # or the repo's typecheck script (check package.json scripts)
npx biome check src/renderers.ts src/index.ts 2>/dev/null || npx eslint src/renderers.ts src/index.ts 2>/dev/null || true
# Use whichever linter the repo actually uses — check package.json "scripts"
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/renderers.test.ts -v
# Full suite — must include S1's submission tests still passing
npx vitest run
# Expected: all green; zero regressions in S1's suites
```

### Level 3: Integration Testing (System Validation)

```bash
# Manual TUI check (human runbook item, matches MANUAL-TUI-AC-RUNBOOK.md):
# run pi with the extension loaded, use debug commands (P1.M2.T3.S1) to upsert/answer all
# questions, drive to completion → recap card appears in transcript (AC-14);
# expanded shows withdrawn/moot with reasons; mirror markers appear as dimmed one-liners.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# AC-14 traceability: collapsed card contains goal + every question + final answers.
# Purity check: build functions import only types + pi-tui helpers — grep that
# src/renderers.ts build functions never call pi.* or read module-level mutable state.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` all pass, including S1's suites
- [ ] No lint errors on changed files

### Feature Validation

- [ ] AC-14: recap card in transcript at completion (goal, grouped Q&A, timestamps)
- [ ] Expanded shows withdrawn/moot with reasons (h2.36)
- [ ] `interrogation-state` marker: dimmed one-liner, audit-trail only, epoch rendered
- [ ] Defensive fallbacks work (missing details / missing entry.data)
- [ ] Model-visible behavior unchanged (content untouched; entries never in LLM context)

### Code Quality Validation

- [ ] Additive-only changes to S1's renderers.ts (no renames/moves of S1 exports)
- [ ] `.js` relative imports; theme.fg applied per line; truncateToWidth not String.slice
- [ ] JSDoc on both build functions documenting card data contracts (Mode A)

## Anti-Patterns to Avoid

- ❌ Don't render `entry.data.state` — the mirror is a one-line marker (h2.36)
- ❌ Don't recompute moot reasons / dependency evaluation in the renderer — use `details.withdrawnMoot`
- ❌ Don't truncate with String.slice — ANSI-unsafe; use truncateToWidth
- ❌ Don't duplicate S1's submission-card logic — reuse its structural style, not copy-paste bodies where a shared helper fits
- ❌ Don't register in more than one place — exactly two calls in src/index.ts
- ❌ Don't touch delivery.ts / persistence.ts — they are read-only contracts

---

**Confidence Score**: 9/10 — both input contracts are live and precisely documented (delivery.ts, persistence.ts), the pi API signature is validated, and the S1 PRP defines the exact file structure being extended. Residual risk: S1 parallel merge in renderers.ts (mitigated by additive-only rule).

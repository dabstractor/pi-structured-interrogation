# PRP — P1.M7.T3.S1: Submission diff card renderer

## Goal

**Feature Goal**: Register a `registerMessageRenderer` for `customType: "interrogation-submission"` that draws a compact, user-only diff card in the TUI from `message.details.card` (a `SubmissionCardData`), with a collapsed budget by default and a full submission when `expanded`.

**Deliverable**: New file `src/renderers.ts` exporting `registerSubmissionCardRenderer(pi)` (pure, testable build function + thin registration shim), wired once from `src/index.ts` factory, plus unit tests `src/renderers.test.ts`.

**Success Definition**: A submission delivered via `delivery.ts` `buildSubmission` (already live, P1.M2.T1.S1) renders in the TUI as: header line, one line per changed answer `{title}: {from} → {to}` with `(changed)` marker (AC-13) on `editedArchived` entries, optional `NOTE: {note}` line, and `{open} remain open` footer; `expanded` shows the full untruncated submission including epoch. The card is USER-ONLY visual — the model reads `message.content`, never the card.

## Why

- The submission message (h3.6) ships `details.card` precisely so the TUI can draw a rich diff card while the model gets the ≤3-line delta. Without this renderer, the custom message falls back to pi's default rendering (raw content text) — no `(changed)` highlighting (AC-13), no `NOTE:` visual distinction, no `remain open` footer (AC-2 user-only card per h2.36).
- This unblocks P1.M7.T3.S2 (completion recap card + `interrogation-state` entry renderer), which will extend `src/renderers.ts` using the same patterns.

## What

Per h2.36 (ui-spec Renderers): `interrogation-submission` (registerMessageRenderer): user-only card from `details.card` — each changed answer `{title}: {old} → {new (changed)}` + any `NOTE:` line + `{open} remain open`; compact by default, `expanded` shows full submission.

### Success Criteria

- [ ] Renderer registered for exact `customType` `"interrogation-submission"` in `src/index.ts` factory
- [ ] Collapsed: header + each changed answer + `NOTE:` line (when present) + `{remainOpen} remain open` — compact (see budgets below)
- [ ] `editedArchived: true` entries render with `(changed)` marker styled distinctly (AC-13)
- [ ] `expanded`: full submission — all changed entries untruncated, note in full, `remain open`, plus epoch line `epoch {n}`
- [ ] Renderer never reads or mutates live interrogation state — pure function of `(message, {expanded, outputPad}, theme)`
- [ ] Defensive fallback: message without `details.card` renders the plain `message.content` text
- [ ] [Mode A] JSDoc documenting collapsed/expanded budgets on the build function

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, could they implement this successfully?" — Yes: input shape (`SubmissionCardData`) is fully defined in `src/snapshots.ts`; the pi API signature and theme usage are documented below with exact patterns from working code in this repo (`src/tool.ts` renderer, `src/panel/layout.ts`).

### Documentation & References

```yaml
- url: file:///home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md
  section: "pi.registerMessageRenderer(customType, renderer)" (~line 1593) and "Message and Entry Rendering" (~line 2840)
  why: exact signature pi.registerMessageRenderer(customType, (message, { expanded, outputPad }, theme) => Component);
        message has .customType/.content/.details; options carries {expanded, outputPad}; theme.fg/bold helpers
  critical: renderer returns a pi-tui Component (Text or Box+Text); match is by EXACT customType string

- url: file:///home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/tui.md
  section: "ANSI-safe text helpers" (~line 333)
  why: visibleWidth(str), truncateToWidth(str, width, ellipsis?) — import from "@earendil-works/pi-tui"
  critical: strings from computeDiff are NOT truncated upstream; display truncation is THIS renderer's job.
        Multi-line styled text: styles do not carry across lines — reapply theme.fg per line

- file: src/snapshots.ts
  why: THE input contract — SubmissionCardData { changed: DiffEntry[]; note?: string; epoch: number; remainOpen: number }
        and DiffEntry { id, title, from, to, editedArchived } (lines 38–72, 170–215)
  pattern: import type { SubmissionCardData } from "./snapshots.js"; entries are plain data, safe for renderers
  gotcha: `note` is ABSENT (not empty string) when no note shipped — use `card.note` truthiness, never card.note.length

- file: src/delivery.ts
  why: the message shape actually sent — SubmissionMessage (lines 60–80): customType "interrogation-submission",
        content (model-visible ≤3-line delta), display: true, details.card = SubmissionCardData
  pattern: renderer reads message.details.card; defensive when missing
  gotcha: message participates in LLM context via content — the renderer is display-only for the user (user-only card)

- file: src/tool.ts
  why: the repo's established renderer pattern (lines 336–405): theme.fg("toolTitle", theme.bold(...)),
        theme.fg("muted", ...), new Text(line, 0, 0), new Box(0,0) + addChild(new Text(...)) per line
  pattern: renderResult collapsed→single Text; expanded→Box with one Text child per line; defensive fallback
        when details missing → render raw content
  gotcha: use .js extension in relative imports (ESM + tsc project convention — see every existing src file)

- file: src/tool.test.ts
  why: the test pattern — call render hooks directly with a stub theme (todo.ts pattern), no pi runtime
  pattern: import type { Theme } from "@earendil-works/pi-coding-agent"; stub theme { fg: (k,t)=>t, bold: t=>t };
        assert on Text/Box children
  gotcha: stub theme returns text unmodified, so assert on plain strings / child counts

- file: src/index.ts
  why: registration point — factory already registers tool/commands/persistence; add registerSubmissionCardRenderer(pi) here
  pattern: named-import a register* function and call it inside the factory (see registerInterrogateCommand usage)
  gotcha: index.ts comment says "message renderers land in later milestones" — update that comment

- docfile: plan/001_0d6760db6bc5/architecture/pi-api-validation.md
  section: line 50 (registerMessageRenderer signature) and line 47 (sendMessage/participates in LLM context)
  why: validated pi API facts for this repo

- docfile: plan/001_0d6760db6bc5/P1M7T2S1/PRP.md
  why: parallel work item (session_before_compact handler) — touches lifecycle/index wiring only; NO overlap with
        renderers.ts. Consume nothing from it; avoid editing the same index.ts lines it touches (its changes are
        event subscriptions, not registrations — conflict risk is minimal; keep your index.ts edit a single
        registerSubmissionCardRenderer(pi) call + import)
```

### Current Codebase tree (relevant slice)

```bash
src/
  index.ts            # factory: registers tool, commands, persistence — ADD renderer registration here
  snapshots.ts        # SubmissionCardData / DiffEntry / computeDiff  (READ-ONLY input contract)
  delivery.ts         # buildSubmission → SubmissionMessage with details.card
  tool.ts             # established renderCall/renderResult pattern + Box/Text/theme usage
  renderers.ts        # ← NEW (this item)
  renderers.test.ts   # ← NEW (this item)
```

### Desired Codebase tree

```bash
src/
  renderers.ts        # buildSubmissionCard(card, {expanded, outputPad}, theme): Text|Box (pure, exported)
                      # + registerSubmissionCardRenderer(pi) — thin pi.registerMessageRenderer shim
  renderers.test.ts   # vitest unit tests using stub theme (tool.test.ts pattern)
```

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL: registerMessageRenderer matches by EXACT customType string "interrogation-submission"
#   (same literal as delivery.ts SubmissionMessage["customType"]).
# GOTCHA: relative imports in src/ MUST use ".js" extension (repo-wide ESM convention).
# GOTCHA: pi-tui Text does not re-apply ANSI across wrapped lines — apply theme.fg per line,
#   and use truncateToWidth from "@earendil-works/pi-tui" (never String.slice — ANSI-unsafe).
# GOTCHA: card.note is optional and ABSENT when no note — `if (card.note)` not `if (card.note.length)`.
# GOTCHA: renderer must be synchronous, cheap, and never throw on sparse shapes (defensive
#   details-missing fallback → render message.content).
# GOTCHA: this card is USER-ONLY (h2.36): do not add content here expecting the model to see it —
#   the model reads message.content only.
```

## Implementation Blueprint

### Data models

No new models — import `SubmissionCardData`/`DiffEntry` types from `./snapshots.js`. Define (locally, exported) only:

```ts
/** Renderer options as delivered by pi (extensions.md registerMessageRenderer). */
export interface CardRenderOptions {
  expanded: boolean;
  outputPad: number;
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/renderers.ts
  - IMPLEMENT: export function buildSubmissionCard(
      message: { content: string; details?: { card?: SubmissionCardData } },
      options: CardRenderOptions,
      theme: Theme,
    ): Text | Box
    - FOLLOW pattern: src/tool.ts renderResult (collapsed single Text; expanded Box + one Text child per line;
      defensive fallback when details/card missing → new Text(message.content, 0, 0))
    - NAMING: buildSubmissionCard (pure, testable); registerSubmissionCardRenderer (shim)
    - COLLAPSED layout (h2.36, compact by default):
        line 1: theme.fg("toolTitle", theme.bold("Submitted")) + theme.fg("muted", ` ${k} changed · epoch {card.epoch}`)  (k = card.changed.length)
        per entry: `  {title}: {from} → {to}` where {to} gets ` (changed)` suffix themed theme.fg("warning", " (changed)")
          when entry.editedArchived (AC-13); truncate each line to a compact budget (e.g. 80 cols) with truncateToWidth
        if card.note: `  NOTE: {note}` themed theme.fg("accent", "NOTE:") + plain note (truncateToWidth)
        footer: theme.fg("muted", `{card.remainOpen} remain open`)
    - EXPANDED layout ("full submission"): same lines UNTRUNCATED, plus keep all entries even past any collapsed
        cap, plus a dim `epoch {card.epoch}` footer line
    - JSDoc [Mode A]: document collapsed budget (one line per change, per-line ~80-col truncation, entry cap ~8
        with `+{m} more` when exceeded) and expanded budget (no truncation, no cap)
    - DEPENDENCIES: type-only imports from ./snapshots.js; Box, Text, truncateToWidth, visibleWidth from @earendil-works/pi-tui; type Theme from @earendil-works/pi-coding-agent
  - IMPLEMENT: export function registerSubmissionCardRenderer(pi: Pick<ExtensionAPI, "registerMessageRenderer">): void
    - thin shim: pi.registerMessageRenderer("interrogation-submission", (message, options, theme) =>
        buildSubmissionCard(message, options, theme))

Task 2: MODIFY src/index.ts
  - INTEGRATE: import { registerSubmissionCardRenderer } from "./renderers.js"; call registerSubmissionCardRenderer(pi)
    alongside the other register* calls in the factory
  - PRESERVE: all existing registrations; update the header comment line "The panel host and message renderers land
    in later milestones" to reflect that the submission card renderer has landed (completion/entry renderers still pending P1.M7.T3.S2)

Task 3: CREATE src/renderers.test.ts
  - IMPLEMENT: unit tests calling buildSubmissionCard directly with a stub theme ({ fg: (_k, t) => t, bold: t => t } as Theme)
  - FOLLOW pattern: src/tool.test.ts (stub theme, no pi runtime, assert on Text content / Box children)
  - CASES (minimum):
    a) happy path: 2 changed entries → collapsed shows both lines `{title}: {from} → {to}` + footer `{n} remain open`
    b) editedArchived entry → line contains "(changed)" (AC-13)
    c) note present → `NOTE: {note}` line present; note absent → no NOTE line
    d) expanded → all entries + epoch line present; long strings NOT truncated
    e) collapsed truncation: very long `to` string is truncated (visibleWidth of rendered line ≤ budget)
    f) defensive: message without details (or details.card) → renders message.content verbatim, no throw
    g) empty changed[] → header "Submitted 0 changed" + remain-open footer (no crash)
  - NAMING: test_{scenario} functions under describe("buildSubmissionCard")
  - PLACEMENT: src/renderers.test.ts
```

### Implementation Patterns & Key Details

```ts
// Core pattern (adapted from src/tool.ts renderResult):
import { Box, Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { SubmissionCardData } from "./snapshots.js";

// Collapsed entry line — per-line theming (styles don't carry across lines):
let line = `  ${e.title}: ${e.from} → ${e.to}`;
if (e.editedArchived) line += theme.fg("warning", " (changed)");   // AC-13
box.addChild(new Text(truncateToWidth(line, budget), outputPad, 0));

// GOTCHA: apply truncateToWidth AFTER composing the themed string — it is ANSI-aware.
// GOTCHA: one Text child per line inside Box (tool.ts expanded pattern), not one
// multi-line Text — per-line style application.
```

### Integration Points

```yaml
REGISTRATION:
  - add to: src/index.ts (factory body)
  - pattern: "registerSubmissionCardRenderer(pi);"  (next to registerInterrogateCommand / registerDebugCommands calls)

NO other integration points: no config, no state, no persistence changes. Pure display layer.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx tsc --noEmit          # repo uses tsc; zero errors expected
npx vitest run src/renderers.test.ts   # see package.json scripts; adjust if repo defines `npm test`
```

(Check package.json for the exact scripts; this repo uses vitest + tsc per existing tests.)

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/renderers.test.ts -v
npx vitest run   # full suite — MUST stay green (no regressions in delivery/snapshots/index tests)
```

### Level 3: Integration (manual smoke, optional)

```bash
# If a pi session is available: /interrogate-debug-upsert then /interrogate-debug-submit —
# the TUI transcript should show the card (header, diff lines, remain open) instead of raw content.
# Verified automatically at P1.M7.T6 via scripted debug commands.
```

### Level 4: Domain Validation

- AC-13: `(changed)` marker styled distinctly on `editedArchived` entries — verified by unit test (b).
- AC-2 user-only: renderer reads only `details.card`/`content`; no model-visible additions — verified by code inspection + test (a) asserting no content mutation.

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` passes
- [ ] `npx vitest run` — all tests pass (new + existing)
- [ ] No new dependencies added (Box/Text/truncateToWidth already used in repo)

### Feature Validation

- [ ] Collapsed: compact card — header, per-change lines (truncated to budget), NOTE line when present, remain-open footer
- [ ] Expanded: full submission, untruncated, with epoch
- [ ] AC-13 `(changed)` marker on `editedArchived` entries
- [ ] Defensive fallback when `details.card` missing (no throw)
- [ ] Registration in `src/index.ts` for exact customType `"interrogation-submission"`

### Code Quality Validation

- [ ] Follows repo patterns: `.js` imports, JSDoc [Mode A] on budgets, one-Text-per-line Box, theme.fg helpers
- [ ] Pure function separated from the thin registration shim (testable without pi runtime)
- [ ] No changes to snapshots.ts / delivery.ts / any existing source besides index.ts registration

## Anti-Patterns to Avoid

- ❌ Don't re-derive diff logic — computeDiff already produced everything; the renderer formats only
- ❌ Don't use String.slice for truncation — ANSI-unsafe; use truncateToWidth
- ❌ Don't read live state (getState) inside the renderer — pure function of the message
- ❌ Don't mutate `message` or `card`
- ❌ Don't theme a whole multi-line block once — reapply per line
- ❌ Don't extend scope into completion recap / entry renderers — that is P1.M7.T3.S2

---

**Confidence Score**: 9/10 — input contract (`SubmissionCardData`) is implemented and tested upstream; pi renderer API is validated in `pi-api-validation.md`; the repo already contains an exactly analogous renderer (tool.ts renderResult) with a matching test pattern.

---
name: "P1.M1.T4.S2 — Side-chat system prompt builder (question verbatim, goal, digest, answer protocol)"
description: "New pure module src/panel/sidechat-prompt.ts: buildSideChatSystemPrompt(question, goal, questionsWithAnswers) — the SIDECHAT-003 system prompt with five fixed sections (role framing, question VERBATIM incl. full description + every ramification, goal, one-line-per-question answers digest, answer protocol with the fenced ```answer block instruction). Type-only imports; no wiring (M2.T4.S1 owns the call site)."
---

## Goal

**Feature Goal**: Implement SIDECHAT-003's system-prompt half as a pure function the side-chat store consumes at chat creation via the landed `SidechatRebindDeps.buildSystemPrompt` seam (sidechat.ts:75, invoked once per record creation at :135). The prompt gives the side model everything it needs to advise on exactly ONE question: role framing, the question VERBATIM (prompt + full description + EVERY option's full ramification — the deep-view quality contract, NO truncation anywhere, CAPS-OUT-001 spirit), the session goal, a one-line-per-question answers digest, and the SIDECHAT-004 answer protocol (fenced ` ```answer ` block, strict JSON). Its own system prompt (vs. the main conversation's) is what structurally guarantees no cache-prefix share.

**Deliverable**:
1. New file `src/panel/sidechat-prompt.ts` — `export function buildSideChatSystemPrompt(question: Question, goal: string, questionsWithAnswers: readonly Question[]): string` (pure, deterministic; type-only import from `../state.js`).
2. New file `src/panel/sidechat-prompt.test.ts` — verbatim-inclusion rows (long description head+tail), digest shape rows, protocol rows, goal row, determinism row.

**Success Definition**: All rows green; the output string contains every input text in full (pinned by head+tail substring asserts on 600+ char fixtures); digest renders exactly one line per question; the protocol section names ` ```answer ` and the correct JSON form for the question's type; `npm test` + `npm run typecheck` green; module is SIDECHAT-005/M3.T1-clean (zero `@earendil` imports, zero banned-API identifiers).

## User Persona (if applicable)

**Target User**: The pi user who presses `e` on a question to discuss it with the side model.

**Use Case**: The side model must see the SAME question the user sees in deep view — full description, every consequence note — plus what's already answered elsewhere, so its advice is grounded without any main-conversation leakage.

**User Journey**: User opens chat on q3 → chat creation invokes the builder once → the side model answers from the verbatim question + digest + goal → when advice converges, the model ends its reply with the ` ```answer ` block → the panel (T6.S1) parses it.

**Pain Points Addressed**: Truncated/elided question text (side model advising on a summary instead of the real contract); missing context of prior answers; model replies that never terminate in a machine-parseable answer.

## Why

- SIDECHAT-003 (sidechat-contracts.md:49-58, the verbatim authority): "System prompt carries: role (private advisor for ONE question); the question VERBATIM with full description and every ramification (deep-view quality contract); the goal; a one-line-per-question answers digest; the answer protocol. Own system prompt → deliberately NO prefix share with the main conversation's cache."
- ui-spec.md:117 (§Side chat → Model & context) lists the same five elements; the snapshot half is T4.S1's sibling deliverable (this PRP consumes its shape only as "Context = systemPrompt + frozen snapshot").
- The landed store (T3.S1) already holds `record.systemPrompt: string` and re-invokes `deps.buildSystemPrompt()` only at record creation — this task is the producer behind that seam; M2.T4.S1 wires `buildSystemPrompt: () => buildSideChatSystemPrompt(...)` later. T5.S1 feeds `record.systemPrompt` into pi-ai `Context.systemPrompt`.
- SIDECHAT-004's apply path (M2.T6.S1, byte-match option / write-in commit) is only possible if the model was INSTRUCTED to emit the ` ```answer ` block — this builder carries that instruction.

## What

1. **`src/panel/sidechat-prompt.ts`** (new, pure) — `buildSideChatSystemPrompt(question, goal, questionsWithAnswers)` returning a deterministic string with FIVE fixed sections in order (headings make each test's `toContain` unambiguous):
   1. **Role framing**: the model is the user's private advisor for exactly ONE question (this one); help think it through; other questions appear only in the digest.
   2. **The question verbatim**: the question's `id`, `type`, the full `prompt` string as-is, the full `description` (when present) as-is, then for EVERY option a line `- {label} (value: {value})` followed by the option's full `ramification` text on its own indented line (when present). For `type:"text"` (or no options): no Options block — a note that this is a free-text question whose answer is the user's own words.
   3. **The goal**: a heading + the goal string verbatim on its own line.
   4. **Answers digest**: heading + EXACTLY one line per entry of `questionsWithAnswers`: `- {id} · {prompt} → {answer ? "answered: " + answer.value : status}` where prompt has runs of whitespace collapsed to single spaces (keeps the line one line; NEVER elide text), `answer.value` carries write-in text verbatim (custom answers), and status is the plain status word (`open`, `moot`, `withdrawn`, …) when no answer is recorded.
   5. **Answer protocol**: instruct that ONCE converged with the user, the reply must END with a fenced code block tagged `answer` containing strict JSON and nothing after it: on a `choice` question `{"value": "<exact option value>"}` where the value byte-matches one of the question's options, or `{"text": "…"}` when the converged answer is the user's own words (a write-in); on a `text` question always `{"text": "…"}`. Until converged, keep discussing without the block.
2. **`src/panel/sidechat-prompt.test.ts`** (new) — the matrix in Implementation Blueprint Task 2.
3. **NOT in scope**: any edit to `src/panel/sidechat.ts` (the seam + Mode A header already name this task as producer); wiring into `openOrReplace` (M2.T4.S1); the snapshot builder (T4.S1); the answer-block parser (T6.S1); the nested loop (T5.*).

### Success Criteria

- [ ] Long multi-line description (600+ chars, punctuation/unicode) appears in full — head AND tail substrings asserted
- [ ] Every option's ramification appears in full; prompt with embedded newlines round-trips verbatim
- [ ] Digest renders exactly one line per question; each line matches the `id · prompt → answered: value | status` shape; custom write-in values ship verbatim
- [ ] Protocol section contains ` ```answer `, the value-form example on choice questions (with the byte-match instruction), the text-form example on text questions
- [ ] Goal string present; two calls with identical inputs produce `===` identical strings
- [ ] Module greps clean: no `@earendil` import, none of `sendMessage|sendUserMessage|setActiveTools|registerTool|setModel`

## All Needed Context

### Context Completeness Check

The contract text was quoted verbatim from sidechat-contracts.md §SIDECHAT-003/004 and ui-spec.md:117; every input shape was read from src/state.ts (:22-110); the landed seam (`SidechatRebindDeps.buildSystemPrompt`, creation-only invocation at buildFresh:135) was read in sidechat.ts. An agent needs this PRP + `src/state.ts` + the two named sibling files for convention — nothing else.

### Documentation & References

```yaml
- file: plan/005_af804251f18d/architecture/sidechat-contracts.md
  why: "VERBATIM authority — §SIDECHAT-003 (:49-58) enumerates the five prompt elements + the no-prefix-share rationale; §SIDECHAT-004 (:59-66) defines the answer-protocol block the prompt must instruct"
  critical: "the quality contract is VERBATIM + FULL (no truncation) — CAPS-OUT-001 spirit; 'every ramification' means each option's, not a summary"

- file: spec/ui-spec.md
  why: ":117 §Side chat → 'Model & context' — the second verbatim source for the five elements (spec already synced; source-only changeset)"
  section: "Side chat (e — SIDECHAT-001…005) → Model & context"

- file: plan/005_af804251f18d/P1M1T4S2/research/notes.md
  why: "Verified shape inventory (Question/QuestionOption/QuestionAnswer/QuestionStatus with line anchors), the landed seam mechanics, the deterministic five-section layout, and the full test matrix with fixture specifics"

- file: plan/005_af804251f18d/P1M1T4S1/PRP.md
  why: "CONTRACT for the parallel sibling — takeBranchSnapshot in src/panel/branch-snapshot.ts; same module family (pure panel/ sibling + colocated test), same creation-only builder discipline, same SIDECHAT-005 guard surface. T5.S1 assembles Context = { systemPrompt: record.systemPrompt, messages: [...snapshot, ...turns] }"
  gotcha: "do not duplicate its snapshot work or touch its files; keep both modules sibling-shaped"

- file: src/panel/sidechat.ts
  why: "The landed store — SidechatRebindDeps.buildSystemPrompt (:75), buildFresh's creation-only invocation (:128-136), the consumers paragraph (:38-41) naming T4.S2 as this seam's producer. READ ONLY — no edits"
  gotcha: "the store invokes builders ONCE per record (same-question reuse returns the record untouched) — the builder must therefore be pure and deterministic; it will never be called mid-chat"

- file: src/state.ts
  why: "Input shapes: QuestionOption (:32 value/label/ramification?), QuestionAnswer (:42 value/text?/custom?/at), Question (:68 id/title?/prompt/description?/type/options?/status/answer?), QuestionStatus (:22), InterrogationState.goal getter (:243) + orderedQuestions() (:286) — what M2.T4.S1 passes in"
  pattern: "type-only import: `import type { Question } from \"../state.js\"` — zero runtime dependency, zero pi imports"

- file: src/delivery.ts
  why: "House precedent for pure string builders — buildSubmission (:159), buildCompletion (:436): deterministic assembly + colocated test files asserting exact substrings"
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
├── sidechat.ts              # landed store — buildSystemPrompt seam exists; NO edits
├── sidechat.test.ts         # landed — untouched
├── branch-snapshot.ts       # T4.S1 (parallel) — sibling pattern, untouched
└── (new) sidechat-prompt.ts      # buildSideChatSystemPrompt — this task
    (new) sidechat-prompt.test.ts # verbatim/digest/protocol/goal/determinism rows
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/panel/
└── sidechat-prompt.ts       # PURE builder: Question + goal + Question[] → SIDECHAT-003 system prompt string
└── sidechat-prompt.test.ts  # pins the five sections, verbatim inclusion, digest shape, protocol instruction
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: NO truncation anywhere — the deep-view quality contract. The one
#   temptation spot is the digest's prompt: collapse whitespace runs to single
#   spaces ONLY (keeps one line); never elide or cap characters.
// GOTCHA: import ONLY types from ../state.js (`import type`). Any runtime pi
#   import (@earendil*) breaks the M3.T1 static guard surface and the cache-
#   isolation contract (SIDECHAT-005) — this module must stay pure data-in/string-out.
// GOTCHA: the builder runs ONCE per chat record (sidechat.ts buildFresh:135;
#   same-question reuse never re-invokes) — it must NOT read live state at
#   call time beyond its arguments; staleness is accepted v1 (same as T4.S1's snapshot).
// GOTCHA: digest answers — `answer.value` on custom write-ins IS the user's
#   text; ship it verbatim. Optional `text` elaboration is NOT part of the
#   one-line shape (keep lines short); `at` timestamps are ignored.
// GOTCHA: choice vs text protocol — the instruction differs by question.type;
#   for choice, BOTH forms are legitimate (option byte-match value form OR
#   write-in text form) because apply (M2.T6.S1) routes write-ins through the
#   write-in commit path; for text, only the text form.
// GOTCHA: headings/labels are part of the tested surface — use the exact
#   section headings from Implementation Patterns so tests stay unambiguous.
```

## Implementation Blueprint

### Data models and structure

```ts
// src/panel/sidechat-prompt.ts — the entire surface:
import type { Question } from "../state.js";

/** [Mode A] SIDECHAT-003 system prompt (P1.M1.T4.S2): ... five fixed sections ... */
export function buildSideChatSystemPrompt(
  question: Question,
  goal: string,
  questionsWithAnswers: readonly Question[],
): string;
// Consumed downstream (no wiring here): M2.T4.S1 passes
//   buildSystemPrompt: () => buildSideChatSystemPrompt(
//     state.getQuestion(id)!, state.goal, state.orderedQuestions())
// T5.S1 reads record.systemPrompt into pi-ai Context.systemPrompt.
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/panel/sidechat-prompt.ts
  - IMPLEMENT: buildSideChatSystemPrompt per What §1 — five sections, fixed
    order, deterministic; [Mode A] JSDoc citing SIDECHAT-003 + P1.M1.T4.S2.
  - NAMING: sidechat-prompt.ts (kebab, panel/ family, mirrors branch-snapshot.ts);
    export buildSideChatSystemPrompt.
  - PLACEMENT: src/panel/; import type { Question } from "../state.js" ONLY.
  - VERIFY: npm run typecheck.

Task 2: CREATE src/panel/sidechat-prompt.test.ts
  - FIXTURES: one choice Question with 3 options (two with long 200+ char
    ramifications), a 600+ char multi-line description (head/tail substrings),
    embedded newlines + unicode in prompt; one text Question (options
    undefined); a 3-question digest fixture (answered / custom write-in /
    open-moot statuses).
  - ROWS:
    1. verbatim: toContain(description head) AND toContain(description tail);
       every ramification string in full; prompt round-trips.
    2. goal: toContain(goal string) under the goal heading.
    3. digest: exactly one line per question (count section lines); shape
       `id · prompt → answered: value` / `→ open` / `→ moot`; custom value
       verbatim.
    4. protocol: toContain("```answer"); choice → value-form example +
       byte-match wording + a literal option value; text → text-form example
       and NO value-form example.
    5. choice has an Options block; text question has the free-text note and
       no Options block.
    6. determinism: two calls → === identical strings.
  - NAMING: test_snake_case; colocated beside the module.

Task 3: VALIDATE
  - npx vitest run src/panel/sidechat-prompt.test.ts -v
  - npm test && npm run typecheck
  - grep -nE "sendMessage|sendUserMessage|setActiveTools|registerTool|setModel" src/panel/sidechat-prompt.ts || echo CLEAN
  - grep -n "@earendil" src/panel/sidechat-prompt.ts || echo CLEAN
```

### Implementation Patterns & Key Details

```ts
// Section skeletons (headings are the tested anchors — keep them verbatim):
const ROLE = "You are the user's private advisor for exactly ONE question ...";
`## The question (${q.id} · type: ${q.type})`  // then q.prompt, q.description AS-IS, then per option:
`- ${o.label} (value: ${o.value})` + (o.ramification ? `\n    ${o.ramification}` : "")
`## The goal` + goal line
`## Answers so far` + questionsWithAnswers.map(digestLine).join("\n")
  // digestLine = `- ${q.id} · ${q.prompt.replace(/\s+/g, " ").trim()} → ${
  //   q.answer ? `answered: ${q.answer.value}` : q.status}`
`## Answer protocol` + the fenced-block instruction ending the reply; choice:
  '{"value": "<exact option value>"}' (byte-match an option) OR write-in
  '{"text": "…"}'; text: '{"text": "…"}' only; nothing after the block.
// GOTCHA: build digestLine from q.status/q.answer as shown — statuses with no
// answer render the bare status word; NEVER truncate any string.
```

### Integration Points

```yaml
CONSUMED-BY (no wiring in this task):
  - M2.T4.S1 (onChat open path): deps.buildSystemPrompt = () => buildSideChatSystemPrompt(...)
  - T5.S1 (context assembly): Context = { systemPrompt: record.systemPrompt, messages: [...branchSnapshot, ...turns] }
  - T6.S1 (parser): relies on this prompt's ```answer instruction to make the protocol reachable
GUARDS:
  - M3.T1 banned-API scan will include sidechat-prompt.ts — clean by construction (pure)
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck     # tsc --noEmit — zero errors (new module + tests)
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/panel/sidechat-prompt.test.ts -v   # all rows green
npx vitest run src/panel/sidechat.test.ts -v          # store untouched — still green
npm test                                              # FULL suite green
```

### Level 3: Seam & Guard Verification

```bash
grep -nE "sendMessage|sendUserMessage|setActiveTools|registerTool|setModel" src/panel/sidechat-prompt.ts || echo CLEAN
grep -n "@earendil" src/panel/sidechat-prompt.ts || echo CLEAN
git status --short   # exactly two new files; zero edits elsewhere
```

### Level 4: Contract Pin (Semantics)

```bash
# Verbatim pin: temporarily wrap the description in .slice(0, 200) inside the
# builder and re-run — the tail-substring row MUST fail. Restore.
# Determinism pin: two-call === row already proves purity.
npx vitest run src/panel/sidechat-prompt.test.ts -t "verbatim"
```

## Final Validation Checklist

### Technical Validation

- [ ] All 4 validation levels completed; Level-3 greps CLEAN; `git status` shows only the two new files
- [ ] `npm test` + `npm run typecheck` green

### Feature Validation

- [ ] Five sections present in fixed order; question id/type/prompt/description/every ramification verbatim (head+tail asserts)
- [ ] Digest: one line per question, exact shape, write-in values verbatim, status words for unanswered
- [ ] Protocol: ` ```answer ` + correct JSON form(s) per type; byte-match wording on choice
- [ ] Determinism row (`===`) green

### Code Quality Validation

- [ ] Naming/placement per house conventions (kebab file in src/panel/, colocated test, test_snake_case)
- [ ] Type-only import from ../state.js; no runtime imports beyond it; no pi imports
- [ ] Anti-patterns avoided (see below)

### Documentation & Deployment

- [ ] [Mode A] JSDoc cites SIDECHAT-003 + P1.M1.T4.S2; no other docs needed (item DOCS: none — spec sections are the authority)

## Anti-Patterns to Avoid

- ❌ Don't truncate/summarize ANY input string (description, ramification, digest prompt, write-in value) — whitespace-collapse in the digest is the only transformation
- ❌ Don't import from @earendil* or add runtime imports — purity is load-bearing for the M3.T1 guard and the no-prefix-share contract
- ❌ Don't edit sidechat.ts / branch-snapshot.ts / their tests — the seam and sibling are landed contracts
- ❌ Don't wire the builder into openOrReplace or the nested loop — M2.T4.S1 / T5.* own that
- ❌ Don't parse answers or implement the confirm row here — T6.* territory; this task only INSTRUCTS the protocol
- ❌ Don't read live InterrogationState inside the builder — arguments only (one-shot at creation; staleness accepted v1)

---

**Confidence Score**: 9/10 — the five sections are transcribed from the two verbatim contract sources (sidechat-contracts.md §SIDECHAT-003/004, ui-spec.md:117), every input shape was read from src/state.ts with line anchors, the consumption seam (sidechat.ts:75/:135, creation-only) and downstream consumers (M2.T4.S1, T5.S1) are verified landed/named facts, and the sibling module pattern (branch-snapshot.ts) fixes placement and conventions. Residual risk: none material — the only free choices (section headings, digest line format) are fully specified here and pinned by tests.

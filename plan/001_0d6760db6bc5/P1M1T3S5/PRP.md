---
name: "P1.M1.T3.S5 — Non-TUI fallback digest + answers action"
description: "Create src/fallback.ts — pure non-TUI formatting + answers recording: buildFallbackDigest (numbered markdown, h2.26/FR-25) and recordAnswers (epoch-guarded applyAnswer + snapshot + bumpEpoch, returns status line via S4 helpers). Consumed by the tool executor (S6); AC-11 verifies via `pi -p`."
---

## Goal

**Feature Goal**: In non-TUI sessions (`ctx.mode !== "tui" || !ctx.hasUI`), the `interrogate` tool degrades to a pure chat-based flow: an upsert result carries a **numbered markdown digest** the model relays verbatim, and the model records the user's chat answers via `{answers:[...]}` — epoch-guarded, applied immediately, returning the shared status line.

**Deliverable**: `src/fallback.ts` + `src/fallback.test.ts`. Exports:
- `buildFallbackDigest(state: SerializedState): string` — numbered markdown digest (id, title, prompt, options with ★ marks, recommendation) ending with the relay instruction.
- `isNonTui(mode: string, hasUI: boolean): boolean` — the h2.26 guard predicate.
- `recordAnswers(state: InterrogationState, answers: AnswerInput[]): { recorded: string[]; unknown: string[] }` — applies answers (markAnswered + markSubmitted-equivalent) and bumps epoch once.

**Success Definition**: vitest green, `npm run typecheck` clean; digest format matches h2.26 byte-for-byte for fixture states; recordAnswers applies answers → status "answered" → snapshot pushed → exactly one epoch bump; unknown ids reported, not thrown; answers path delegates epoch guarding to S2's `assertFresh` (executor's job, documented).

## User Persona

**Target User**: The AI agent running `pi -p` / rpc / json sessions (no panel exists); the end user answering in chat.

**User Journey**: Model upserts questions in a `pi -p` session → tool result contains the numbered markdown digest + instruction "relay it verbatim in chat" → user replies with answers in their next prompt → model calls `interrogate({answers:[...], epoch})` → status line back → model continues; read and completion behave identically to TUI (completion record still injected once at close by P1.M2.T2.S2 — not this item).

**Pain Points Addressed**: Without a fallback, non-TUI sessions have no interrogation at all (FR-25); ad-hoc per-mode result shapes; answers recorded without epoch protection or snapshots break the audit trail.

## Why

- h2.26/FR-25: "no panel. The upsert result contains a numbered markdown digest …; the description instructs the model to relay it verbatim in chat. The user answers in their next prompt; the model records via `{answers:[...]}` (epoch-guarded). Read/completion work identically."
- h2.20: `{answers:[...]}` returns a **Status line**; "non-TUI only; ignored in TUI".
- AC-11 verifies the fallback via `pi -p` — the digest must exist before S6 wires the executor.

## What

1. **`isNonTui(mode, hasUI)`**: returns `mode !== "tui" || !hasUI` (pi-api-validation.md:54: modes `tui|rpc|json|print`; `hasUI` false in print/json). The executor (S6) uses this to pick digest-vs-upsert-result; in TUI, `{answers:[...]}` is **ignored** (h2.20) — this module provides the digest/record helpers; the ignore decision belongs to S6's executor routing, documented in JSDoc.

2. **`buildFallbackDigest(state: SerializedState): string`** (h2.26 verbatim fields: id, title, prompt, options with ★ marks, recommendation). Pure — input is a `SerializedState` (from `state.serialize()`), no mutation, imports type-only from `./state.js` and `UNGROUPED_LABEL` optionally. Line format:

   ```
   INTERROGATION — {goal} (epoch {n})
   (omit goal line when goal === "")

   **1. {title ?? prompt-truncated-60}** (`{id}`)
   {prompt}
   1) {label} (`{value}`)[ ★]
      2) …
   Recommendation: {recommendation value — rendered as its option label}
   (omit Recommendation line when absent)
   …numbered sequentially by state.order…
   ```

   - Numbers are **1-based positional** over `state.order` (the "numbered markdown digest"); option ordinals are `1) 2) …` so the user can answer "1.2" or by value — the digest is agent-relayed text, not parsed.
   - ★ (U+2605, single leading space) marks the option whose `value === q.recommendation`.
   - Only `type: "choice"` questions render option lists; `type: "text"` questions render just the prompt.
   - Questions with status `withdrawn`/`moot`/`closed` are **skipped** (nothing to ask); `answered`/`submitted`/`reasked`/`open` render (reasked and answered are still relevant — the model re-relays on re-ask).
   - Final line (exact sentence): `Relay this digest verbatim to the user in chat; they will answer in their next message.`

3. **`recordAnswers(state: InterrogationState, answers: AnswerInput[])`** — the markAnswered + markSubmitted-equivalent path ("delivered immediately since user already spoke"):
   - For each `{id, value, text?}`: if `state.getQuestion(id)` exists → `state.applyAnswer(id, { value, text, at: new Date().toISOString() })` (applyAnswer sets status "answered", never touches rev — h2.39). Collect applied ids in `recorded`.
   - Unknown ids collect into `unknown` (tolerant — never throw; the executor surfaces them in the result text).
   - After applying: push a submission snapshot via the existing snapshot-ring mechanism (see `src/snapshots.ts` / the state's snapshot helpers used by guards fixtures) and `state.bumpEpoch()` **exactly once** per call — one call is one submission (h2.39).
   - Answer-matching/validation (choice value vs options) is the merge-rules layer's domain for upserts; here the value is recorded as given (chat answers are free-form; the model relays user words). Do NOT validate against option values.
   - Epoch guard is NOT called here: the executor (S6) runs `assertFresh(state, parsed)` BEFORE `recordAnswers` — record is epoch-only guarded (guards.ts contract) and `StaleError` propagates out of `execute` so pi sets isError. JSDoc must state this ordering contract.

4. **Result assembly (S6's job, documented here)**: the non-TUI upsert result = status line (S4 `buildStatusLine`) + digest (this module) + caps warnings; the answers result = status line only (h2.20) via S4's envelope with `action: "record"`. This module returns strings/data; S6 builds `InterrogateResult`. Read/completion: identical to TUI — S4's `buildReadResult` is mode-agnostic; completion injection is P1.M2.T2.S2. Do not duplicate.

5. **Mode A JSDoc** on `buildFallbackDigest` documenting the digest format (numbering, ★ placement, skip list, relay sentence) and on `recordAnswers` documenting the guard-ordering and single-epoch-bump contract.

### Success Criteria

- [ ] Digest renders numbered markdown for a fixture state with mixed types, recommendation ★, absent recommendation, withdrawn (skipped), and text question; ends with the exact relay sentence
- [ ] Goal line omitted when goal empty; epoch shown
- [ ] recordAnswers: answers applied (status "answered", answer object with ISO `at`, `text` passthrough), snapshot pushed, epoch +1 exactly once, recorded/unknown split correct
- [ ] No throw on unknown ids; module has no pi imports; `npm test` + `npm run typecheck` pass

## All Needed Context

### Context Completeness Check

An agent with no codebase knowledge gets the exact digest format, the exact state primitives to call (`applyAnswer`, snapshot ring, `bumpEpoch`), the guard-ordering contract, and the S4/S6 consumer contracts. No guessing.

### Documentation & References

```yaml
- file: src/state.ts
  why: InterrogationState primitives — applyAnswer(id, {value,text?,at}) → status "answered" (never bumps rev), bumpEpoch() (one per submission, returns new epoch), getQuestion, orderedQuestions, serialize(); SerializedState/Question types; UNGROUPED_LABEL
  pattern: snapshot ring lives on state.snapshots — push via the same mechanism guards.test.ts fixtures use (takeSnapshot/bumpEpoch)
  gotcha: there are NO markAnswered/markSubmitted methods — "markSubmitted-equivalent" = snapshot push + single bumpEpoch, because answers are delivered immediately (no delivery.ts involvement; that is P1.M2.T1 for panel submissions only)

- file: src/tool-schema.ts
  why: ParsedAction {action:"record", answers: AnswerInput[], epoch?}; AnswerInput {id, value, text?}; parseInterrogateParams routing (answers only routes to record when non-empty)
  gotcha: routing returns record in ALL modes — the TUI-ignore decision is the executor's (S6), never here

- file: src/guards.ts
  why: assertFresh contract — record is epoch-only guarded, missing epoch on answers = required-param violation, StaleError propagates out of execute (pi sets isError only on throw, pi-api-validation.md:21)
  gotcha: executor calls assertFresh BEFORE recordAnswers; this module must not re-guard (double epoch semantics would break)

- file: plan/001_0d6760db6bc5/P1M1T3S4/PRP.md
  why: CONTRACT (implemented in parallel) — results.ts exports buildStatusLine / buildReadResult / buildUpsertResult / InterrogateResult / ResultDetails with action union incl. "record" reserved for this item's call site
  gotcha: do not build the record InterrogateResult here — S6 assembles it; fallback.ts returns the digest string and recordAnswers data

- file: plan/001_0d6760db6bc5/P1M1T3S3/PRP.md
  why: CONTRACT — applyCaps(questions, goal, config, contextWindow) → {questions, goal, warnings}; the non-TUI upsert result (S6) appends those warnings after the digest; this module ignores caps entirely

- file: src/snapshots.ts
  why: digestSince + snapshot-ring helpers — reuse the push mechanism for the record path so the ring stays consistent with panel submissions
  gotcha: verify exported helper names before use (takeSnapshot used in guards.test.ts fixtures)

- file: plan/001_0d6760db6bc5/architecture/pi-api-validation.md (line 54)
  why: ctx.mode values tui|rpc|json|print; ctx.hasUI false in print/json — the isNonTui predicate

- file: plan/001_0d6760db6bc5/prd_snapshot.md (h2.26, h2.20, h3.3 FR-25, h2.28)
  why: authoritative fallback text — digest fields, relay-verbatim instruction, answers action returns status line, epoch-guarded recording

- file: src/state.test.ts / src/guards.test.ts
  why: vitest conventions — colocated *.test.ts, createInterrogationState fixtures, applyAnswer/takeSnapshot/bumpEpoch usage patterns
```

### Current Codebase tree

```bash
src/
  index.ts config.ts state.ts merge.ts depends-on.ts snapshots.ts tool-schema.ts guards.ts (+ *.test.ts)
  # results.ts arriving from S4, caps.ts from S3 (both parallel — assume their PRP contracts exactly)
```

### Desired Codebase tree

```bash
src/
  fallback.ts        # NEW — isNonTui, buildFallbackDigest, recordAnswers
  fallback.test.ts   # NEW — digest format, record semantics, epoch/snapshot contract
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// ESM: relative imports need .js suffix ("./state.js")
// ★ is U+2605 BLACK STAR, single space before it — same mark the panel uses (h2.33/Q15)
// Skip withdrawn/moot/closed in the digest; keep open/answered/submitted/reasked
// bumpEpoch exactly ONCE per recordAnswers call even for multiple answers (one call = one submission)
// applyAnswer never bumps rev — answers are epoch territory (h2.39)
// Unknown answer ids: collect, never throw (tolerant pattern throughout this codebase)
// Do NOT validate answer values against option lists — chat answers are free-form
// The digest is a STRING (result content), not a result object — S6 wraps it with buildStatusLine + envelope
```

## Implementation Blueprint

### Data models and structure

```ts
// src/fallback.ts
import { UNGROUPED_LABEL } from "./state.js"; // only if grouping appears in digest — it doesn't; omit
import type { InterrogationState, Question, SerializedState } from "./state.js";
import type { AnswerInput } from "./tool-schema.js";

/** h2.26 guard predicate (pi-api-validation.md:54). */
export function isNonTui(mode: string, hasUI: boolean): boolean;

/** FR-25 numbered markdown digest — see module JSDoc for the exact format. */
export function buildFallbackDigest(state: SerializedState): string;

/** markAnswered + markSubmitted-equivalent for chat answers. */
export function recordAnswers(
  state: InterrogationState,
  answers: AnswerInput[],
): { recorded: string[]; unknown: string[] };
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/fallback.ts — isNonTui + buildFallbackDigest
  - IMPLEMENT: per "What" §1–2; 1-based numbering over state.order (skip withdrawn/moot/closed); option ordinals "1)"; ★ on recommendation-matching option value; Recommendation line with the option's LABEL; text questions render prompt only; header line with goal+epoch; exact final relay sentence
  - MODE A JSDoc: full digest format spec + skip list + relay sentence
  - PLACEMENT: src/fallback.ts; pure — only type imports + no pi

Task 2: CREATE src/fallback.ts — recordAnswers
  - IMPLEMENT: per "What" §3 — applyAnswer per known id (ISO at, text passthrough), snapshot-ring push, single bumpEpoch, recorded/unknown split
  - GOTCHA: no epoch guard here (executor runs assertFresh first — JSDoc the ordering contract); no option-value validation
  - DEPENDENCIES: state.ts primitives, snapshots.ts ring helper (verify export names in Task 2 before use)

Task 3: CREATE src/fallback.test.ts
  - FOLLOW pattern: src/state.test.ts (createInterrogationState fixtures via upsertQuestion, serialize() for digest input)
  - CASES: isNonTui truth table (4 modes × hasUI); digest full-content assertion (mixed fixture: choice+★, choice w/o recommendation, text, withdrawn-skipped; goal present/absent; epoch passthrough; relay sentence last; numbering 1..n over rendered questions only); recordAnswers happy path (status "answered", answer fields, snapshot length +1, epoch +1 once for multi-answer batch); unknown ids (tolerant, no throw, state unchanged for them); rev unchanged after recording; purity via typecheck
```

### Implementation Patterns & Key Details

```ts
// Digest option rendering:
function optionLine(q: Question, opt: QuestionOption, ordinal: number): string {
  const star = opt.value === q.recommendation ? " ★" : "";
  return `${ordinal}) ${opt.label} (\`${opt.value}\`)${star}`;
}

// recordAnswers core (guard ordering documented, not enforced):
export function recordAnswers(state, answers) {
  const recorded: string[] = [], unknown: string[] = [];
  const at = new Date().toISOString();
  for (const a of answers) {
    if (state.getQuestion(a.id) === undefined) { unknown.push(a.id); continue; }
    const answer: QuestionAnswer = { value: a.value, at };
    if (a.text !== undefined) answer.text = a.text;
    state.applyAnswer(a.id, answer);
    recorded.push(a.id);
  }
  // one call = one submission: snapshot + single epoch bump
  // (use the snapshots.ts ring push used by guards.test.ts fixtures)
  state.bumpEpoch();
  return { recorded, unknown };
}
```

### Integration Points

```yaml
CONSUMERS (do NOT implement here):
  - P1.M1.T3.S6 executor: switch on ParsedAction — non-TUI upsert → status line + buildFallbackDigest(state.serialize()) + applyCaps warnings; record → assertFresh first (StaleError propagates) → recordAnswers → status line via S4 envelope action "record"; TUI record → ignored per h2.20
  - P1.M2.T2.S2 lifecycle: completion record injection is mode-independent — this item changes nothing there
  - AC-11: verified post-S6 via `pi -p` end-to-end
EXPORTS: module-local for now (index.ts wiring is S6)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npx vitest run src/fallback.test.ts
```

### Level 2: Unit Tests

```bash
npm test   # full suite green — no regressions
```

### Level 3: Integration Testing

Not applicable until S6 registers the tool. The executor sequence (assertFresh → recordAnswers → status line) is exercised by S6's tests; here, assert the data-level contract only.

### Level 4: Domain Validation

AC-11 spot-check (post-S6, documented for the executor PRP): run `pi -p "…"` in a scratch session; confirm the relayed digest renders as numbered markdown and a follow-up `answers[]` call returns a status line. String contracts (relay sentence, ★ placement) asserted byte-exact in tests now.

## Final Validation Checklist

- [ ] `npm run typecheck` clean; `npm test` all green
- [ ] Digest: h2.26 fields (id, title, prompt, options with ★, recommendation), 1-based numbering, skip withdrawn/moot/closed, exact relay sentence last
- [ ] recordAnswers: answers → "answered", snapshot pushed, exactly one epoch bump, recorded/unknown split, no throws
- [ ] Guard-ordering contract JSDoc'd (executor: assertFresh before recordAnswers; StaleError propagates)
- [ ] Pure module: no pi imports; TUI-ignore decision left to S6; `.js` import suffixes
- [ ] Mode A JSDoc on the digest format

---

## Anti-Patterns to Avoid

- ❌ Don't re-guard epoch inside recordAnswers — the executor's assertFresh is the single guard (double-guard breaks healing flows)
- ❌ Don't bump epoch per answer — one bump per submission/call (h2.39)
- ❌ Don't validate answer values against option lists — chat answers are free-form
- ❌ Don't render withdrawn/moot/closed questions in the digest
- ❌ Don't build InterrogateResult here — S6 owns result assembly with S4's envelope
- ❌ Don't wire anything into index.ts — registration is S6

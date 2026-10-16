# P1.M1.T4.S2 research notes — side-chat system prompt builder

## 1. Contract authority (verbatim)

- sidechat-contracts.md §SIDECHAT-003 (:49-58): "System prompt carries: role (private advisor for ONE
  question); the question VERBATIM with full description and every ramification (deep-view quality
  contract); the goal; a one-line-per-question answers digest; the answer protocol. Own system prompt →
  deliberately NO prefix share with the main conversation's cache."
- ui-spec.md:117 (Model & context): same five elements; snapshot/staleness is T4.S1's half.
- SIDECHAT-004 (:59-66): answer protocol = fenced ` ```answer ` block, strict JSON,
  `{"value": "<exact option value>"}` (choice, byte-match an option) or `{"text": "…"}` (text/write-in).
- Item contract: prompt VERBATIM + full description + EVERY ramification, no truncation
  (CAPS-OUT-001 spirit). Pure function. Consumed by T5.S1 as `Context.systemPrompt`.

## 2. Input shapes (src/state.ts, verified)

- `QuestionOption` (:32): `{ value: string; label: string; ramification?: string }`.
- `QuestionAnswer` (:42): `{ value: string; text?: string; custom?: boolean; at: string }`.
- `Question` (:68): `{ id, title?, prompt: string, description?: string, type: "choice"|"text",
  options?: QuestionOption[], recommendation?, group?, gate?, dependsOn?, rev, status, answer?,
  mootReason? }`.
- `QuestionStatus` (:22): "open" | "answered" | "submitted" | "reasked" | "moot" | "withdrawn" | "closed".
- `InterrogationState`: `get goal(): string` (:243), `orderedQuestions(): Question[]` (:286),
  `getQuestion(id)`. Callers (M2.T4.S1) pass plain data; builder itself takes NO state object.

Signature (per item contract "plain data"):
`buildSideChatSystemPrompt(question: Question, goal: string, questionsWithAnswers: readonly Question[]): string`

## 3. The landed seam (src/panel/sidechat.ts, verified)

- `SidechatRebindDeps` (:73): `{ buildSystemPrompt: () => string; buildBranchSnapshot: () => BranchSnapshot; ... }`.
- `buildFresh` (:128) invokes both builders ONLY at record creation (:135-136); same-question reuse
  returns the record untouched — so the prompt is one-shot per chat, mirroring the snapshot.
- Header (:27-33, :38-41): "Consumers (all inject their builders — no config/ctx knowledge here):
  ... T4.S1/S2 branch builders, T5.S1 model resolution (the deps bag is their injection seam),
  M2.T4.S1 open path". → T4.S2 delivers the BUILDER MODULE ONLY; no sidechat.ts edits, no wiring
  (M2.T4.S1 owns the call site `buildSystemPrompt: () => buildSideChatPrompt(...)`).
- sidechat.ts purity: zero `@earendil` imports (T3.S2 gate) — the builder likewise must import
  NOTHING from pi; only `import type { Question } from "../state.js"` (type-only, in-repo).
- Sibling pattern: branch-snapshot.ts (T4.S1, same subtask family) — kebab-case panel/ module +
  colocated test. Builder mirrors it: `src/panel/sidechat-prompt.ts` + `sidechat-prompt.test.ts`.

## 4. Deterministic prompt layout (what the tests pin)

Five sections in fixed order (headings make each test's toContain unambiguous):
1. Role framing — "private advisor ... exactly ONE question".
2. The question verbatim — `{id}`, type, full `prompt`, full `description` (when present),
   every option as `- {label} (value: {value})` + full `ramification` on its own indented line.
   type:"text"/no options → a free-text note line instead of an Options block.
3. Goal — the goal string on its own line.
4. Digest — exactly one line per question: `- {id} · {prompt} → {answer ? "answered: " + value : status}`
   (prompt whitespace runs collapsed to single spaces so the line stays one line; custom write-ins
   ship their value text).
5. Answer protocol — the fenced-block instruction: end converged replies with ` ```answer ` +
   strict JSON; for THIS question's type: choice → `{"value": "<exact option value>"}` byte-matching
   an option, or `{"text": "…"}` when the converged answer is the user's own words (write-in);
   text → `{"text": "…"}`. Nothing after the block.

## 5. Test matrix (per item contract)

- VERBATIM: 600+ char multi-line description with punctuation/unicode → exact `.toContain` of head
  AND tail strings (proves no truncation); every ramification string present in full; prompt with
  newlines round-trips.
- Digest: 3-question fixture → exactly 3 digest lines (count lines in the section); each line shape
  `id · prompt → answered: value` or `→ open`; moot/withdrawn show the status word.
- Protocol: contains "```answer"; choice question → contains the value-form JSON example and the
  byte-match instruction + one literal option value; text question → contains the text-form example.
- Goal: contains the goal string.
- Purity/determinism: two calls with same inputs → `===` identical strings.
- Choice question with options present → Options block rendered; text question → no Options block,
  free-text note present.
- Cache/guard hygiene: module has zero banned identifiers (sendMessage|sendUserMessage|
  setActiveTools|registerTool|setModel) and zero `@earendil` strings.

## 6. Boundaries

- NO changes to sidechat.ts (seam exists; Mode A header already names this task as producer).
- NO wiring into openOrReplace (M2.T4.S1), no parser (T6.S1), no loop (T5.*).
- No truncation anywhere — the one place a "truncate long prompt" temptation may appear is the
  digest; collapse whitespace only, never elide.

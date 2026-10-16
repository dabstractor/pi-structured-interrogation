---
name: "P1.M1.T6.S1 — parseAnswerBlock: the LAST fenced ```answer block (strict JSON, byte-match)"
description: "ADD to src/panel/sidechat.ts (pure leaf store, zero pi imports): the ParsedAnswer union + AnswerBlockRejection enum + export function parseAnswerBlock(replyText: string, optionValues: readonly string[]): ParsedAnswer — a pure, state-free SIDECHAT-004 parser that scans a COMPLETED side-chat reply for fenced blocks whose info string is exactly `answer`, takes the LAST, strict-JSON-parses its body, and validates exactly one of {\"value\": string} (byte-match === against optionValues) or {\"text\": string} (non-empty); every other outcome returns {kind:\"none\", reason} from a stable five-value enum that P1.M2.T1.S2 renders as the in-view notice. EXTEND src/panel/sidechat.test.ts with a dedicated describe block (valid shapes, last-block-wins incl. malformed-last, byte-match strictness, malformed JSON, unknown shapes, empty text, no-block/unterminated/fence-tolerance vectors). Two files, additive only; consumed next by P1.M1.T6.S2 (ApplyDecision/pendingConfirm)."
---

## Goal

**Feature Goal**: Implement the SIDECHAT-004 answer-block parser as a pure function: given a completed side-chat reply's frozen text and the target question's option-value set, decide whether the reply carries an applicable answer (`{"value": <byte-matched option>}` or `{"text": <non-empty write-in>}`) or not (`{kind:"none", reason}`), deterministically and with zero engine/UI state.

**Deliverable**:
1. EDIT `src/panel/sidechat.ts` — add `AnswerBlockRejection` (5-value string-literal union), `ParsedAnswer` (3-arm discriminated union), and `export function parseAnswerBlock(replyText: string, optionValues: readonly string[]): ParsedAnswer` with a Mode A doc comment; append the parser's consumers to the header Consumers list. Additive only; zero pi imports (load-bearing).
2. EXTEND `src/panel/sidechat.test.ts` — a new `describe("parseAnswerBlock — SIDECHAT-004 answer-block parsing", ...)` block covering: valid value shape, valid text shape (verbatim), last-block-wins (two valid blocks), malformed-LAST block (no fallback to an earlier valid one), byte-match strictness (case/whitespace variants → mismatch), malformed JSON → none+reason, unknown shapes → none, empty/whitespace-only text → none, no-block (missing / wrong info string / unterminated), fence tolerance (4 backticks OK; ```answer with trailing space OK; ```answer json NOT a block), value on an options-less (text) question → mismatch.

**Success Definition**: `npx vitest run src/panel/sidechat.test.ts` green (existing rows unregressed); `npx vitest run src/panel/` green; `npm test`, `npm run typecheck`, `npm run lint` clean; walls hold (`grep @earendil src/panel/sidechat.ts` clean; banned-API names absent even in comments; `parseAnswerBlock` has exactly one non-test reference — its definition — until T6.S2 lands); `git diff --stat` touches exactly the two files.

## User Persona (if applicable)

**Target User**: The pi user side-chatting about one interrogation question (SIDECHAT-001), converging on an answer with the side model.

**Use Case**: The side model ends a converged reply with a ` ```answer ` block; the panel (later: T6.S2 + M2.T6.S1) turns the parsed answer into a confirm row and, on `enter`, applies it through the ordinary accept seams. When the model botches the block (malformed JSON, non-matching value, empty text), the user sees one in-view notice and keeps chatting — the chat never silently swallows or misapplies an answer.

**User Journey**: chat turns → model emits ```answer block → T6.S2 calls parseAnswerBlock(frozenText, optionValues) → `{kind:"value"|"text"}` powers the `apply ★ sqlite? · enter = yes · esc = no` confirm row → or `{kind:"none", reason}` becomes M2.T1.S2's notice line; chat stays open.

**Pain Points Addressed**: Free-form model output being trusted loosely (fuzzy matching would apply "Sqlite" where the option is `sqlite` — byte-match strictness is the guard); partial streamed text being parsed mid-flight (structurally impossible — only frozen text is ever passed); malformed blocks breaking the flow (notice, not a crash, not a silent apply).

## Why

- Spec authority (verbatim): ui-spec §Side chat → Answer protocol — "The panel parses the LAST such block in a completed reply (strict JSON; choice values must byte-match an option; malformed blocks are ignored with an in-view notice)"; sidechat-contracts.md §SIDECHAT-004 — same, plus "malformed → in-view notice, chat stays open".
- The upstream seam exists: P1.M1.T5.S2 (landed) freezes only completed replies into `record.messages` (`joinTextParts(done.message.content)` — sidechat-engine.ts ~267-277; the store header already documents "the answer parser (P1.M1.T6.S1) structurally never sees partial text"). T4.S2's prompt builder (landed, src/panel/sidechat-prompt.ts §"Answer protocol") already teaches the model the exact block format the parser recognizes — the two must stay mirror images.
- Downstream dependents: P1.M1.T6.S2 consumes `ParsedAnswer` for ApplyDecision + pendingConfirm + autoApply bypass; P1.M2.T1.S2 maps `reason` → the in-view notice text; M2.T6.S1 applies value/text through `acceptOptionIndex` / the write-in commit path. This task is the pure hinge — no UI, no engine wiring.
- DOCS: none (task contract) — pure internal function; the protocol text itself lives in the system prompt (P1.M1.T4.S2). README coverage is M3.T3.S1 (Mode B).

## What

**The contract being implemented** (item + SIDECHAT-004 + ui-spec, consolidated):

```
parseAnswerBlock(replyText: string, optionValues: readonly string[]): ParsedAnswer

ParsedAnswer =
  | { kind: "value"; value: string }        // {"value": v} where v === some optionValues entry (byte-match)
  | { kind: "text";  text:  string }        // {"text": t} where t.trim() !== "" — returned VERBATIM (no trim)
  | { kind: "none";  reason: AnswerBlockRejection }

AnswerBlockRejection =
  | "no-block"        // no valid fenced ```answer block anywhere in the reply
  | "malformed-json"  // the LAST block's body fails strict JSON.parse
  | "unknown-shape"   // parses, but is not EXACTLY {value: string} xor {text: string}
  | "value-mismatch"  // {value: string} that byte-matches no entry of optionValues
  | "empty-text"      // {text: ""} or whitespace-only text
```

**Scanner semantics** (line-based; pinned where the authorities were silent — see research/notes.md):

1. Split `replyText` on `\n`. Scan top-to-bottom. An **opening fence** line matches `/^(`{3,})answer[ \t]*$/` — backticks only (≥3), info string EXACTLY `answer` (case-sensitive; `Answer`, `answer json`, `answers` are NOT matches), trailing spaces tolerated. A **closing fence** line matches `/^`{3,}[ \t]*$/`. A block = opening fence, body lines, next closing fence. **Unterminated** (EOF before a closing fence) ⇒ not a valid block — discarded.
2. Collect every valid block. **Zero blocks → `no-block`.** Otherwise take the **LAST** block (position-agnostic: trailing prose after the block is fine — "NOTHING may follow it" is prompt discipline for the model, not parser strictness) and join its body lines with `\n`.
3. `JSON.parse(body)` in try/catch — throw ⇒ `malformed-json`. (JSON.parse is already strict: no comments, no trailing commas, no single quotes; multi-line/pretty-printed JSON parses fine.)
4. Shape gate: the parsed value must be a non-null, non-array plain object whose own keys are EXACTLY `{value}` with a string, or EXACTLY `{text}` with a string. Arrays, `null`, scalars, both keys, extra keys (`{"value":"x","why":"z"}`), non-string values (`{"value":42}`) ⇒ `unknown-shape`.
5. `{value: v}`: `optionValues.includes(v)` (strict `===` byte-match) ⇒ `{kind:"value", value:v}`, else `value-mismatch`. Note this also covers text questions naturally: their option set is empty, so any `{"value": ...}` mismatches.
6. `{text: t}`: `t.trim() !== ""` ⇒ `{kind:"text", text:t}` (verbatim — the returned string keeps any leading/trailing spaces; apply-side ships it byte-identically), else `empty-text`.
7. **Last-block-wins is absolute**: if the last block is malformed, the result is `malformed-json` even when an earlier block was valid — NO fallback to earlier blocks.

Purity: no engine state, no `get()`, no record reads, no time, no randomness. Identical inputs → `===`-deep identical outputs.

### Success Criteria

- [ ] `parseAnswerBlock('text\n```answer\n{"value":"sqlite"}\n```', ["postgres","sqlite"])` → `{kind:"value", value:"sqlite"}`
- [ ] `{"text":"use streaming, but batch the writes"}` → `{kind:"text", text:"use streaming, but batch the writes"}`; `{"text":" padded "}` → text `" padded "` verbatim
- [ ] Two valid blocks (`a` then `b`) → `b`; valid-then-malformed → `{kind:"none", reason:"malformed-json"}` (no fallback)
- [ ] `{"value":"Sqlite"}` / `{"value":" sqlite"}` / `{"value":"SQLITE"}` against `["sqlite"]` → `value-mismatch`
- [ ] `{"value":"x",}` / `{'value':'x'}` / `{"value": 42}` → `malformed-json` / `malformed-json` / `unknown-shape` respectively
- [ ] `[]` / `42` / `"x"` / `null` / `{}` / `{"value":"x","text":"y"}` → `unknown-shape`
- [ ] `{"text":""}` and `{"text":"   "}` → `empty-text`
- [ ] No block / ```` ```json ```` block / ```` ```ANSWER ```` / ```` ```answer json ```` / unterminated ```` ```answer ```` at EOF → `no-block`
- [ ] ```` ````answer ```` (4 backticks) and ```` ```answer␣ ```` (trailing space) ARE blocks; text question + `{"value":"x"}` → `value-mismatch`
- [ ] Sidechat.ts stays zero-pi-import; parser references nothing but its arguments

## All Needed Context

### Context Completeness Check

This PRP carries: the full scanner spec (every decision the authorities left open is pinned), the exact union/enum shapes T6.S2 codes against, the mirror relationship to the landed prompt text (what the model was taught to emit), the frozen-text input contract (T5.S2's freeze site), insertion anchors safe against the parallel T5.S3 edits (same-file collision mapped), and runnable gates. An implementer needs only the two named files plus this document.

### Documentation & References

```yaml
- file: src/panel/sidechat.ts
  why: "THE file — the pure leaf store the parser joins; classifyChatCommand is the placement precedent (pure protocol logic lives here); header/Consumers-list convention to extend"
  pattern: "zero pi imports (load-bearing for the M3.T1 banned-API guard); Mode A doc comments citing contract + subtask ids"
  gotcha: "T5.S3 lands formatChatCloseNotice + ChatUsage doc edits in the SAME file, in parallel — insert by CONTENT anchors, never line numbers; do not touch its regions"

- file: src/panel/sidechat-prompt.ts
  why: "the landed protocol teacher (T4.S2) — its §'## Answer protocol' defines EXACTLY the shapes/info-string the parser must accept; the two are mirror images (choice accepts value OR text form; text question accepts ONLY the text form)"
  pattern: "read-only reference; the parser's fence/shape rules are the strict inverse of what this prompt instructs"
  gotcha: "if you are tempted to loosen the fence rule (e.g. accept `answer json`), re-read this file — the model is taught a single canonical form"

- file: src/panel/sidechat-engine.ts
  why: "the input producer — freeze site (~line 267-277): only stop|length|toolUse|deferred turns push a frozen ChatMessage whose .text is joinTextParts(done.message.content); aborted turns roll back fully"
  critical: "the parser NEVER sees streamingText or partials BY CONSTRUCTION — do not add a completeness check; purity is the contract. T6.S2 owns WHEN to call it (at the settle seam)"

- file: plan/005_af804251f18d/architecture/sidechat-contracts.md
  section: "§SIDECHAT-004 — answer protocol + indistinguishable provenance"
  why: "verbatim binding contract: LAST block, strict JSON, byte-match, malformed → in-view notice + chat stays open"

- file: spec/ui-spec.md
  section: "§Side chat (`e` — SIDECHAT-001…005) → 'Answer protocol' bullet"
  why: "spec authority for parse semantics + the confirm row string T6.S2/M2.T6.S1 build on this parser's output"

- file: plan/005_af804251f18d/P1M1T5S3/PRP.md
  why: "the PARALLEL contract — T5.S3 edits sidechat.ts + sidechat.test.ts concurrently (formatChatCloseNotice, ChatUsage docs, formatter vectors); additive-only, different sites; its walls (banned-API grep, definition-only grep) are shared and must stay clean for BOTH"
  gotcha: "do not gate on sidechat-engine suites mid-flight; final `npm test` assumes sequential landing"

- file: plan/005_af804251f18d/P1M1T6S1/research/notes.md
  why: "full research record: every scanner decision + its justification, collision map, test-vector enumeration"
```

### Current Codebase tree (relevant slice)

```bash
src/panel/
├── sidechat.ts             # pure store — EDIT: types + parseAnswerBlock + header consumers row
├── sidechat.test.ts        # store suite — EXTEND: new describe block (T5.S3 adds formatter rows in parallel)
├── sidechat-prompt.ts      # T4.S2 landed — READ ONLY (the protocol teacher)
├── sidechat-engine.ts      # T5.S1/S2 landed, T5.S3 in flight — READ ONLY (freeze site = input producer)
├── sidechat-engine.test.ts # T5.S3 extends in parallel — DO NOT TOUCH
└── branch-snapshot.ts      # T4.S1 — untouched
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# No new files. Two edits:
# src/panel/sidechat.ts        — AnswerBlockRejection + ParsedAnswer + parseAnswerBlock (pure, ~70 lines incl. docs)
# src/panel/sidechat.test.ts   — "parseAnswerBlock — SIDECHAT-004 answer-block parsing" describe (~15 test rows)
```

### Known Gotchas of our codebase & Library Quirks

```text
# CRITICAL: sidechat.ts must remain 100% pi-import-free — `grep -n "@earendil" src/panel/sidechat.ts`
#   must stay empty. The parser takes (string, readonly string[]) and returns plain unions; if you find
#   yourself importing ANYTHING, stop — purity of this module is the M3.T1 cache-isolation guard surface.

# CRITICAL: the five SIDECHAT-005-banned mutation APIs (message-send / user-message-send / active-tools /
#   tool-registration / model-switch) appear NOWHERE in the module — NOT EVEN IN COMMENTS. Describe the
#   ban, never spell it (existing sidechat.ts header precedent).

# CRITICAL: LAST-block-wins with NO FALLBACK. A malformed last block after a valid earlier block is
#   `malformed-json`, not the earlier block's answer. The model's LATEST intent governs; silently
#   applying a superseded earlier answer would be the worst failure mode this parser exists to prevent.

# CRITICAL: byte-match means ===. No case-folding, no trimming, no normalization of the value before the
#   match. "Sqlite" ≠ "sqlite"; " sqlite" ≠ "sqlite". The FR-35/worldview of this codebase is byte-strict
#   everywhere (ANSWER-PIN-001's "byte-identical", classifyChatCommand's "no case-folding" — same species).

# CRITICAL: the text form's VALIDITY check (trim() !== "") and its CARRIED value (verbatim, untrimmed)
#   are different things. Do not return the trimmed text — apply-side (M2.T6.S1) ships it through the
#   write-in seam byte-identically; trimming here would corrupt provenance indistinguishability.

# GOTCHA: JSON.parse is ALREADY strict — do not pre-validate with regexes or hand-rolled JSON sniffing.
#   try { JSON.parse(body) } catch { → "malformed-json" } is the entire JSON layer.

# GOTCHA: shape gate is EXACT-KEY-SET, not "has a value key". {"value":"x","why":"z"} → unknown-shape
#   (both keys / extra keys / non-string values all fail). The prompt teaches exactly-one-key forms.

# GOTCHA: unterminated ```answer at EOF is NOT a block (streaming partials never parse anyway, but a
#   COMPLETED reply can still end mid-block if the model was cut by stop=length — that's no-block, and
#   the notice path handles it; do NOT treat it as malformed-json).

# GOTCHA: insertion anchors — T5.S3 is editing this file in parallel. Anchor on unique CONTENT:
#   types go right after the `SidechatNotice` interface block; the function goes right after
#   `classifyChatCommand`'s closing brace (before resetChat's JSDoc). Never `line N`.

# GOTCHA: optionValues is `readonly string[]` — callers (T6.S2) map `question.options.map(o => o.value)`.
#   Empty array = text question = every value form mismatches. No question-type parameter exists; do not add one.
```

## Implementation Blueprint

### Data models and structure

```typescript
// src/panel/sidechat.ts — additions (Mode A doc comments on each):

/** Why a completed side-chat reply carried no applicable answer block (P1.M1.T6.S1).
 *  Stable enum: P1.M2.T1.S2 maps each value to its in-view notice text. */
export type AnswerBlockRejection =
  | "no-block"
  | "malformed-json"
  | "unknown-shape"
  | "value-mismatch"
  | "empty-text";

/** SIDECHAT-004 parse outcome. "value" ⇒ apply via the option seam (T6.S2 resolves
 *  the display index); "text" ⇒ apply via the write-in commit seam; "none" ⇒ in-view
 *  notice, chat stays open. Consumed by P1.M1.T6.S2 (ApplyDecision/pendingConfirm). */
export type ParsedAnswer =
  | { kind: "value"; value: string }
  | { kind: "text"; text: string }
  | { kind: "none"; reason: AnswerBlockRejection };
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/panel/sidechat.ts — types + the parser
  - INSERT AnswerBlockRejection + ParsedAnswer after the SidechatNotice interface
    (content anchor: the interface's closing brace + doc block; NOT a line number)
  - IMPLEMENT parseAnswerBlock after classifyChatCommand's closing brace:

      const OPEN_FENCE = /^(`{3,})answer[ \t]*$/;
      const CLOSE_FENCE = /^`{3,}[ \t]*$/;

      export function parseAnswerBlock(
        replyText: string,
        optionValues: readonly string[],
      ): ParsedAnswer {
        // 1) collect valid fenced blocks (open fence, body, close fence; unterminated → discarded)
        // 2) zero blocks → { kind: "none", reason: "no-block" }
        // 3) body = LAST block's lines joined "\n"
        // 4) try JSON.parse → catch → { kind: "none", reason: "malformed-json" }
        // 5) shape: non-null, non-array, exact key set {value:string} xor {text:string}
        //    → else { kind: "none", reason: "unknown-shape" }
        // 6) value: optionValues.includes(v) ? {kind:"value", value:v} : value-mismatch
        // 7) text: t.trim() !== "" ? {kind:"text", text:t} (VERBATIM) : empty-text
      }

    (helper functions module-local if wanted — export ONLY the two types + parseAnswerBlock)
  - DOC: Mode A comment citing SIDECHAT-004 (sidechat-contracts.md), ui-spec §Side chat
    "Answer protocol", the mirror relationship to sidechat-prompt.ts §"## Answer protocol",
    the frozen-text input contract (T5.S2 freeze site; partials structurally never parse),
    and consumers (P1.M1.T6.S2, P1.M2.T1.S2, M2.T6.S1)
  - HEADER: append the parser to the Consumers list paragraph
  - RUN: npm run typecheck

Task 2: EXTEND src/panel/sidechat.test.ts — the parser suite
  - DESCRIBE "parseAnswerBlock — SIDECHAT-004 answer-block parsing" (test() style matches
    the file's descriptive-sentence names; import parseAnswerBlock + types from ./sidechat.js)
  - ROWS (each a standalone test; every none-row asserts the FULL object
    {kind:"none", reason} — toEqual, not toMatchObject):
    1. valid value: '…\n```answer\n{"value":"sqlite"}\n```' + ["postgres","sqlite"] → {kind:"value", value:"sqlite"}
    2. valid text: '{"text":"use streaming, but batch the writes"}' → {kind:"text", text:"use streaming, but batch the writes"}
    3. text verbatim: '{"text":" padded "}' → {kind:"text", text:" padded "} (untrimmed)
    4. last-block-wins: block(a) + prose + block(b) → {kind:"value", value:"b"}
    5. malformed LAST: block({"value":"a"}) + block({'value':'b'} single-quoted) → {kind:"none", reason:"malformed-json"}
    6. byte-match strictness: "Sqlite" / " sqlite" / "SQLITE" vs ["sqlite"] → {kind:"none", reason:"value-mismatch"} (three asserts, one test)
    7. malformed JSON: trailing comma '{"value":"x",}' → malformed-json
    8. unknown shapes: '[]' / '42' / '"x"' / 'null' / '{}' / '{"value":"x","text":"y"}' / '{"value":42}' /
       '{"value":"x","why":"z"}' → unknown-shape
    9. empty text: '{"text":""}' and '{"text":"   "}' → {kind:"none", reason:"empty-text"}
    10. no-block: plain reply (no fence) → no-block; '```json\n{"value":"x"}\n```' → no-block;
        '```ANSWER\n{"value":"x"}\n```' → no-block; '```answer json\n{"value":"x"}\n```' → no-block
    11. unterminated: reply ending '```answer\n{"value":"sqlite"}' (no close) → no-block
    12. fence tolerance: '````answer\n{"value":"a"}\n````' (4 backticks) → {kind:"value", value:"a"} (close fence ≥3
        backticks suffices); '```answer \n{"value":"a"}\n```' (trailing space after answer) → parses
    13. text-question value form: '{"value":"x"}' + [] → {kind:"none", reason:"value-mismatch"}
    14. pretty JSON: '{"value":\n  "a"\n}' across body lines → {kind:"value", value:"a"}
    15. trailing prose after the block still parses the LAST block (position-agnostic)
  - MODE A comments citing SIDECHAT-004 + P1.M1.T6.S1 at the describe head
  - RUN: npx vitest run src/panel/sidechat.test.ts

Task 3: VALIDATE walls + gates
  - npx vitest run src/panel/ ; npm test ; npm run typecheck ; npm run lint
  - grep -n "@earendil" src/panel/sidechat.ts || echo CLEAN
  - grep -nE "sendMessage|sendUserMessage|setActiveTools|registerTool|setModel" src/panel/sidechat.ts || echo CLEAN
  - grep -rn "parseAnswerBlock" src/ --include="*.ts" | grep -v "\.test\.ts"
    # exactly ONE hit: the definition (consumers arrive with T6.S2)
  - git diff --stat   # ONLY src/panel/sidechat.ts + src/panel/sidechat.test.ts
```

### Implementation Patterns & Key Details

```typescript
// PATTERN — the scanner loop (line-based, single pass, collect-then-take-last):
const lines = replyText.split("\n");
const bodies: string[] = [];
let i = 0;
while (i < lines.length) {
  if (OPEN_FENCE.test(lines[i])) {
    const body: string[] = [];
    i++;
    while (i < lines.length && !CLOSE_FENCE.test(lines[i])) body.push(lines[i++]);
    if (i < lines.length) bodies.push(body.join("\n")); // closed → valid; EOF → discarded
  }
  i++;
}
if (bodies.length === 0) return { kind: "none", reason: "no-block" };
// …strict JSON.parse of bodies[bodies.length - 1] — the LAST, never an earlier one…

// PATTERN — the shape gate (exact-key-set, both arms):
const parsed: unknown = JSON.parse(body);
const isObj = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
const keys = isObj ? Object.keys(parsed as Record<string, unknown>) : [];
const valueOk = keys.length === 1 && keys[0] === "value" && typeof (parsed as any).value === "string";
const textOk  = keys.length === 1 && keys[0] === "text"  && typeof (parsed as any).text  === "string";

// CRITICAL: no normalization ANYWHERE — no .toLowerCase(), no .trim() before the includes(),
//   no trim on the RETURNED text. Strictness IS the feature.
// CRITICAL: pure — never import, never read the singleton, never call get(); this function
//   knows nothing about records, questions, or the engine.
```

### Integration Points

```yaml
RUNTIME: NONE this task — nothing calls parseAnswerBlock yet (definition-only grep is a gate)
CONSUMED NEXT:
  - P1.M1.T6.S2: ApplyDecision contract + pendingConfirm state + autoApply bypass — its
    input type is ParsedAnswer; it invokes parseAnswerBlock at T5.S2's settle seam (frozen
    assistant message only — never streamingText)
  - P1.M2.T1.S2: in-view notice text per AnswerBlockRejection value (stable enum = the API)
  - P1.M2.T6.S1: confirm-row apply — kind:"value" → acceptOptionIndex(displayRow of v);
    kind:"text" → the write-in commit path; provenance stays indistinguishable (SIDECHAT-004)
PARALLEL: T5.S3 edits sidechat.ts/.test.ts concurrently at different sites (formatter) —
  content-anchored insertion, additive-only; shared walls stay clean for both
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck     # tsc --noEmit strict — catches union/param-type slips
npm run lint          # eslint src scripts *.ts
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/panel/sidechat.test.ts -v     # new describe + all existing rows
# Expected: every row green; existing store rows (singleton lifecycle, classifyChatCommand,
# T5.S3's formatter rows if landed) unregressed.
```

### Level 3: Neighbor & Full Suite

```bash
npx vitest run src/panel/    # whole panel tree green (sidechat-engine rows may be T5.S3's
                             # in-flight state — if ONLY engine rows fail, re-run after its
                             # landing; parser rows themselves must be green regardless)
npm test                     # full suite — the final gate after parallel work has landed
```

### Level 4: Purity & Scope Walls (domain-specific)

```bash
grep -n "@earendil" src/panel/sidechat.ts || echo CLEAN                    # M3.T1 guard surface
grep -nE "sendMessage|sendUserMessage|setActiveTools|registerTool|setModel" \
  src/panel/sidechat.ts || echo CLEAN                                      # SIDECHAT-005 (comments included)
grep -rn "parseAnswerBlock" src/ --include="*.ts" | grep -v "\.test\.ts"   # exactly ONE hit (the definition)
grep -n "get()\|getRecord" src/panel/sidechat.ts | grep -A0 "parseAnswerBlock" || true   # parser never reads the singleton
git diff --stat    # ONLY src/panel/sidechat.ts, src/panel/sidechat.test.ts
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1: typecheck + lint clean
- [ ] Level 2: `npx vitest run src/panel/sidechat.test.ts` green (existing rows unregressed)
- [ ] Level 3: `npx vitest run src/panel/` green; `npm test` green (after parallel T5.S3 lands)
- [ ] Level 4: all four greps as specified; diff = exactly 2 files

### Feature Validation

- [ ] All 15 test-row groups from Task 2 pass, each none-row asserting the full `{kind:"none", reason}` object
- [ ] Last-block-wins with no fallback (malformed last → malformed-json) is pinned by a test
- [ ] Byte-match strictness pinned (case + whitespace variants)
- [ ] Text returned verbatim (trim only for validity, never for the carried value)
- [ ] Nothing fires the parser outside tests; no UI, no notice, no state change anywhere

### Code Quality Validation

- [ ] sidechat.ts remains zero-pi-import; parser is pure (arguments → unions only)
- [ ] Mode A doc comments cite SIDECHAT-004, ui-spec §Side chat, P1.M1.T6.S1, consumers
- [ ] Only the two types + parseAnswerBlock exported; helpers module-local
- [ ] T5.S3's regions (ChatUsage docs, formatChatCloseNotice, formatter rows) untouched

### Documentation & Deployment

- [ ] Mode A only — no README/spec/config changes (M3.T3.S1 owns Mode B docs); no new config surface

## Anti-Patterns to Avoid

- ❌ Don't fall back to an earlier valid block when the last is malformed — LAST governs, period
- ❌ Don't normalize before matching — no case-folding, no trimming of `value`; strict `===`/`includes` only
- ❌ Don't return trimmed text — validity checks `trim() !== ""`, the payload stays verbatim
- ❌ Don't accept loose shapes — extra keys, both keys, non-string values are `unknown-shape`, not lenient parses
- ❌ Don't recognize tilde fences, case variants, or info-string suffixes (`answer json`) — info string is EXACTLY `answer`, backticks only
- ❌ Don't treat an unterminated block as malformed-json — it is not a block at all (`no-block`)
- ❌ Don't import anything into sidechat.ts or read the singleton/engine — purity is the M3.T1 guard surface
- ❌ Don't wire the parser anywhere (settle seam, notice, confirm row) — T6.S2 / M2.T1.S2 / M2.T6.S1 own every consumer
- ❌ Don't spell the five banned SIDECHAT-005 API names even in comments
- ❌ Don't add a question-type parameter — the empty optionValues array already encodes text questions
- ❌ Don't gate on sidechat-engine suite greenness mid-parallel-work; your rows are independent

---

**Confidence Score: 9/10** — the parser is fully specified (every scanner decision pinned with test vectors), the upstream seam (T5.S2 freeze) and downstream consumer (T6.S2) contracts are read from landed code, and the mirror prompt (T4.S2) fixes the exact block grammar. Residual 1/10: same-file parallel edits from T5.S3 — mitigated by content-anchored insertion and the additive-only scope wall.

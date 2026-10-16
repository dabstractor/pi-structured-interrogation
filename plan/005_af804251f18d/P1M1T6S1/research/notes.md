# Research notes — P1.M1.T6.S1 (parseAnswerBlock — LAST fenced ```answer block)

Verified 2026-10-16 against working tree (sidechat.ts, sidechat-prompt.ts, sidechat-engine.ts, sidechat.test.ts all read in full or in relevant part).

## Binding authorities (verbatim)

1. **sidechat-contracts.md §SIDECHAT-004** (item's research note): "The side model is instructed to end a converged reply with a fenced ```answer block: `{"value": "<exact option value>"}` (choice) or `{"text": "…"}` (text/write-in). Panel parses the LAST such block in a COMPLETED reply — strict JSON; choice values must byte-match an option; malformed → in-view notice, chat stays open."
2. **spec/ui-spec.md §Side chat → Answer protocol bullet** (read verbatim): same, plus "malformed blocks are ignored with an in-view notice" and the confirm row / autoApply / ordinary-seams apply rules (T6.S2 + M2.T6.S1's territory).
3. **Item contract**: `parseAnswerBlock(replyText, optionValues)`; find ALL fenced blocks whose info string is exactly `answer`; take the LAST; strict JSON.parse; `{"value": v}` valid iff v byte-matches (===) an option value; `{"text": t}` valid for write-in/text (non-empty); everything else → `{kind:"none", reason}`; reason feeds M2.T1.S2's in-view notice. Pure function — no engine state.

## What the model is told to emit (src/panel/sidechat-prompt.ts — T4.S2, landed)

Section 5 "## Answer protocol" of buildSideChatSystemPrompt:
- Block "opens with ```answer, closes with ```, contains strict JSON, and NOTHING may follow it".
- Choice question WITH options: one of `{"value": "<exact option value>"}` (byte-match demanded, with an example: `{"value": "sqlite"}`) OR `{"text": "..."}` (write-in — "the text IS the answer").
- Text question (or choice with no options): ONLY `{"text": "..."}`.
- "Until you have converged, keep discussing without emitting the block."
⇒ The parser must accept BOTH shapes on choice questions; `{"value"}` on a text question naturally fails byte-match (empty optionValues) — the 2-param signature suffices, no question-type param.

## Input: the frozen reply text (P1.M1.T5.S2 — landed in sidechat-engine.ts:267-277)

- Only `stop|length|toolUse|deferred` turns freeze: `record.messages.push({role:"assistant", text: joinTextParts(message.content), ...})` — canonical text from `done.message`, NEVER the streaming buffer (sidechat.ts header: "Only completed replies ever enter `messages`, so the answer parser (P1.M1.T6.S1) structurally never sees partial text").
- So parseAnswerBlock's `replyText` = a frozen assistant ChatMessage's `.text`. The parser itself does NOT check completeness (pure, no engine state) — T6.S2 invokes it at the settle seam on frozen text only.

## Placement decision

- `src/panel/sidechat.ts` — the pure leaf store (ZERO pi imports is load-bearing for the M3.T1 banned-API guard). Precedent: `classifyChatCommand(input)` — pure side-chat protocol logic already lives there. The parser is the same species: plain strings in, plain union out. Keeps the guarded module set (sidechat.ts, chat-view.ts, helpers) unchanged; no new file in spec's module layout (spec/architecture.md §Module layout lists panel/sidechat.ts + panel/chat-view.ts only).
- Tests extend `src/panel/sidechat.test.ts` (new describe block). Conventions observed: vitest `describe(...)`/`test("descriptive sentence", ...)`, imports from `./sidechat.js`, `beforeEach(() => { resetSidechatForTests(); })`.

## Parallel-work collision map (P1.M1.T5.S3 in flight — ITS PRP read)

T5.S3 edits the SAME two files: sidechat.ts (adds `formatChatCloseNotice` after ChatUsage docs; updates header Consumers list) + sidechat.test.ts (formatter vectors), plus sidechat-engine.ts/.test.ts. All additive, different sites than mine. Consequences for this PRP:
- Insert by CONTENT anchors (classifyChatCommand end, SidechatNotice interface), never line numbers.
- Do not touch ChatUsage/formatChatCloseNotice regions or the header's T5.S3 rows.
- Header Consumers list: both tasks append — mine adds T6.S2/M2.T6.S1 rows.
- Don't gate on sidechat-engine suites being green mid-flight; my gates: sidechat.test.ts, src/panel/, then npm test at final validation (sequential landing makes this safe).

## Scanner semantics pinned (decisions where authorities were silent)

- Fence chars: BACKTICKS ONLY (prompt teaches ```answer; a `~~~answer` block is off-protocol → not recognized).
- Opening fence: `/^(`{3,})answer[ \t]*$/` — ≥3 backticks, info string exactly `answer` (case-sensitive; `Answer`, `answer json`, `answerjson` all fail), trailing spaces tolerated.
- Closing fence: `/^`{3,}[ \t]*$/` (bare fence ≥3 backticks). Unterminated (EOF first) → NOT a valid block (discarded).
- Block position is IRRELEVANT ("take the LAST" — the model's "NOTHING may follow it" is prompt discipline, not parser strictness; trailing prose after the last block still parses).
- Body = lines between fences joined with `\n`; JSON.parse handles multi-line/pretty-printed JSON natively.
- Shape = plain object with EXACTLY one key: `{value: string}` XOR `{text: string}`. Arrays/null/scalars/extra keys/non-string values/both keys → `unknown-shape`.
- Taxonomy of reasons (stable enum, M2.T1.S2 maps to notice text): `no-block` | `malformed-json` | `unknown-shape` | `value-mismatch` | `empty-text`.
- Byte-match = `optionValues.includes(v)` (=== on strings; case/whitespace differences mismatch).
- Text validity: `t.trim() !== ""` (empty AND whitespace-only rejected); the RETURNED text stays verbatim (no trim) — apply-side ships it byte-identical through the write-in seam.
- LAST block governs even when malformed: first-valid + last-malformed → `none + malformed-json` (NO fallback to an earlier valid block — item pins "take the LAST; strict JSON.parse of the body").

## npm scripts (package.json, verified)

- `npm test` = `vitest run`; `npm run typecheck` = `tsc --noEmit`; `npm run lint` = `eslint src scripts *.ts` (lint EXISTS in this plan era).

## Out of scope (owned by siblings)

- T6.S2: ApplyDecision contract, pendingConfirm state, autoApply bypass — consumes ParsedAnswer.
- M2.T1.S2: in-view notice rendering from reason.
- M2.T6.S1: confirm-row apply through acceptOptionIndex / write-in commit.
- Engine changes (freeze site, settle hooks), prompt changes, config, view code.

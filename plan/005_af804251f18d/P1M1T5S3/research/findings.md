# P1.M1.T5.S3 research findings — usage tally + close notice

## Verified pi-ai facts (node_modules/@earendil-works/pi-ai/dist/types.d.ts:265–283)

- `Usage` = `{ input, output, cacheRead, cacheWrite, totalTokens, cost: { input, output, cacheRead, cacheWrite, total } }`.
- The side-chat tally maps: `usage.input` → `record.usage.input`, `usage.output` → `record.usage.output`,
  `usage.cost.total` → `record.usage.totalCost`. **NAME TRAP**: record field is `totalCost`, pi-ai nested path is
  `cost.total` (NOT flat `usage.total`).
- Precedent for reading usage off a nested result: `src/compaction.ts` settle block (`usage: response.usage` at the
  compaction return) — the nested read is normal in this repo.
- `AssistantMessage` carries `usage: Usage` — so `done.message.usage` (event branch) and `(await promise).usage`
  (promise branch) are the same single accumulation point: the freeze site.

## Landed store facts (src/panel/sidechat.ts, verified read)

- `ChatUsage { input: number; output: number; totalCost: number }` already exists; `buildFresh` zeroes it
  (`usage: { input: 0, output: 0, totalCost: 0 }`); `/clear`+`/new` reset and openOrReplace replacement re-zero via
  `buildFresh` — S3 adds NO reset logic.
- `ChatMessage` deliberately carries NO usage ("usage live on the record's tally, not per-message") — S3 must NOT
  add per-message usage.
- sidechat.ts must stay 100% `@earendil`-free (M3.T1 guard precondition) → `formatChatCloseNotice(usage: ChatUsage)`
  (plain numbers in, string out) is legal here; the pi-ai `Usage` → `ChatUsage` read happens in sidechat-engine.ts.

## Spec-pinned string (ui-spec.md §Side chat line 118; sidechat-contracts.md:83–85)

> Each turn's usage accumulates; any close/discard notifies compactly (`chat closed · 12.4K in · 3.1K out · $0.07`).
> Usage never enters session stats, entries, or tool results.

Derived exact humanization rules (deterministic, testable):

- tokens `n < 1000` → `String(n)`; `n >= 1000` → `(n/1000).toFixed(1)` with a trailing `".0"` stripped, + `"K"`.
  (1000→"1K", 3100→"3.1K", 12400→"12.4K", 12499→"12.5K", 123456→"123.5K"; no "M" tier — spec shows K only.)
- cost → `"$" + c.toFixed(2)` ($0.00, $0.07, $1.20).
- Separator ` · ` (space U+00B7 space). fp accumulation noise (0.03+0.04=0.07000000000000001) absorbed by
  display-only `toFixed(2)` — no cent-rounding accumulator needed.

## S2 contract (PRP at plan/005_af804251f18d/P1M1T5S2/PRP.md — landing in parallel; treat as landed)

- S2 lands the terminal router: settle-idle+clear-buffer first; `"aborted"` → rollbackTurn (user turn popped, no
  assistant, no notice); `"error"` → notice; stop|length|toolUse|deferred → `freeze(message)`.
- `freeze(message)` pushes `ChatMessage {role:"assistant", text: joinTextParts(message.content), at, stopReason}`
  and S2 explicitly leaves usage untouched ("T5.S3's tally, fed by the frozen message" — i.e. at the freeze site the
  canonical AssistantMessage is in hand; S3 reads `message.usage` there).
- S2's liveness guard `if (getRecord() !== record) return;` runs BEFORE freeze → accumulation placed inside freeze
  is automatically skipped for dead (replaced/discarded) records.
- Abort/error paths never reach freeze → contribute zero structurally (S2's routing table: "Usage residue: none").

## Test harness facts (src/panel/sidechat-engine.test.ts, verified read)

- `assistantReply(text)` builder already carries `usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0,
  totalTokens: 3, cost: { …, total: 0 } }`; `doneStream(text)` pushes `{type:"done", reason:"stop", message}`.
- No existing row asserts `record.usage` → giving the builder a usage override param cannot break S1 rows.
- Fake dep bag: `openOrReplace` fixtures `{resolveModelSnapshot, buildSystemPrompt, buildBranchSnapshot}`,
  `resetSidechatForTests()` in beforeEach, `fakePort(behavior)`, `fakeRegistry(models)`, `fakeModel()`.
- `createAssistantMessageEventStream()` from pi-ai builds fake streams in tests (push/end).

## Gates (package.json:33–37)

- `npm test` = `vitest run`; `npm run typecheck` = `tsc --noEmit`; `npm run lint` = eslint.
- Walls: banned-API grep over the side-chat module set; `grep "@earendil" src/panel/sidechat.ts` clean;
  `grep "cacheRetention" src/panel/sidechat-engine.ts` clean.

## Boundaries (plan tree)

- This task: tally at freeze + `formatChatCloseNotice`. NOT: firing the notice (P1.M2.T5.S1 owns every
  discard/close path), parsing (T6.S1), rendering (M2.T1), wiring (M2.T4).
- SIDECHAT-005 structural guarantee: the engine writes only to the sidechat singleton record — usage cannot reach
  session stats/entries/tool results because no such API appears in the module (grep wall proves it).

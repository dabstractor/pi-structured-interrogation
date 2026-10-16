---
name: "P1.M1.T5.S3 — Per-chat usage tally and compact close notification"
description: "Add the usage half of the side-chat engine: (1) EDIT src/panel/sidechat.ts — export formatChatCloseNotice(usage: ChatUsage): the spec-pinned close string `chat closed · {in} in · {out} out · ${cost}` with K-humanized tokens (one decimal, trailing .0 stripped) and 2-decimal cost — pure, pi-free, consuming nothing new. (2) EDIT src/panel/sidechat-engine.ts — at S2's freeze site (the ONLY place a completed turn's canonical AssistantMessage lands), accumulate message.usage.input/output/cost.total into record.usage (name map: cost.total → totalCost); abort/error/dead-record turns contribute zero structurally because they never reach freeze. (3) EXTEND sidechat.test.ts (formatter exactness vectors) and sidechat-engine.test.ts (accumulation math — the spec example 12.4K/3.1K/$0.07 becomes a test — abort contributes zero, promise branch, dead record untouched). Do NOT fire the notice (P1.M2.T5.S1 owns every discard/close path), do NOT add per-message usage, usage enters nothing but record.usage and the returned string (SIDECHAT-005)."
---

## Goal

**Feature Goal**: Complete the SIDECHAT-003/005 usage contract (PRD h2.38 "Usage & close", h2.80): every completed side-chat turn's `usage` accumulates into the singleton record's `ChatUsage` tally, and a pure formatter produces the spec-pinned compact close notice string that P1.M2.T5.S1 will fire on every discard/close path. Aborted turns contribute nothing (structurally — they never reach the freeze site).

**Deliverable**:
1. EDIT `src/panel/sidechat.ts` — `export function formatChatCloseNotice(usage: ChatUsage): string` with exact humanization rules (below); update the `ChatUsage` doc comment ("T5.S3 accumulates" → landed state) and the header Consumers list (add M2.T5.S1). Additive only; zero pi imports.
2. EDIT `src/panel/sidechat-engine.ts` — inside S2's `freeze(message)` path: three `+=` lines reading `message.usage.input`, `message.usage.output`, `message.usage.cost.total` → `record.usage.input/output/totalCost`, with a Mode A comment citing the name map and SIDECHAT-005. No new functions, no new state, no behavior change outside the freeze branch.
3. EXTEND `src/panel/sidechat.test.ts` — formatter exactness rows (vector table below).
4. EXTEND `src/panel/sidechat-engine.test.ts` — accumulation rows: multi-turn sum, spec-example string, abort-contributes-zero, error-contributes-zero, promise-branch tally, dead-record (replaced mid-flight) untouched.

**Success Definition**: All new rows green plus S1/S2 rows unregressed (`npx vitest run src/panel/sidechat.test.ts src/panel/sidechat-engine.test.ts`); `npx vitest run src/panel/` green; `npm test` green; `npm run typecheck` clean; `npm run lint` clean; banned-API grep clean; `grep "@earendil" src/panel/sidechat.ts` clean; no `cacheRetention` in the engine; `git diff --stat` touches exactly the four files above; the notice is fired NOWHERE (M2.T5.S1's job).

## User Persona (if applicable)

**Target User**: The pi user side-chatting about one interrogation question (SIDECHAT-001).

**Use Case**: After a several-turn chat, the question gets answered (any path) or the chat is discarded — the user sees one compact line, `chat closed · 12.4K in · 3.1K out · $0.07`, and knows exactly what the private chat cost. An esc-aborted turn cost nothing and silently adds nothing.

**User Journey**: sendTurn → reply completes → tally grows invisibly → question answered / chat discarded / `/clear` replaced by a new chat → M2.T5.S1 calls `formatChatCloseNotice(record.usage)` and shows the string → user moves on.

**Pain Points Addressed**: Nested model calls silently costing money with no visibility; verbose usage dumps breaking the compact panel aesthetic; usage leaking into the main session's stats/entries (SIDECHAT-005 forbids it).

## Why

- Spec: ui-spec §Side chat "Usage & close" (spec/ui-spec.md:118, verbatim authority via sidechat-contracts.md:83-85): "Each turn's usage accumulates; any close/discard notifies compactly (`chat closed · 12.4K in · 3.1K out · $0.07`). Usage never enters session stats, entries, or tool results."
- Dependency chain: consumes S2's terminal router + freeze site (plan/005_af804251f18d/P1M1T5S2/PRP.md — landing in parallel; treat as landed contract; its PRP says "usage untouched — T5.S3's tally, fed by the frozen message"); produces the string + tally consumed by P1.M2.T5.S1 (discard hooks fire it on every close path).
- SIDECHAT-005 (architecture h2.16, binding): cache-isolation makes "usage never enters session stats/entries/tool results" STRUCTURAL — the engine writes only to the sidechat singleton record; the banned-API grep wall proves no other write surface exists.
- Docs: none this task (task contract) — the string format is spec-pinned in ui-spec; README coverage is M3.T3.S1 (Mode B).

## What

**The tally** (engine, at the freeze site only):

```typescript
// inside freeze(message) — after/with the ChatMessage push:
record.usage.input += message.usage.input;
record.usage.output += message.usage.output;
record.usage.totalCost += message.usage.cost.total;  // NAME MAP: pi-ai cost.total → ChatUsage.totalCost
```

- Only completed turns tally: `freeze` is reached exclusively from the `stop|length|toolUse|deferred` branch of S2's terminal router. Abort (all three trigger shapes) rolls the turn back before routing; `error` paths push notices without freezing; S2's liveness guard (`getRecord() !== record` → return) runs BEFORE freeze, so a record replaced/discarded mid-flight never accumulates.
- No reset logic: `buildFresh` already zeroes `usage` on create/replace/reset — untouched.

**The formatter** (store, pure):

```typescript
// tokens: n < 1000 → String(n); else (n/1000).toFixed(1) with trailing ".0" stripped + "K"
// cost:   "$" + n.toFixed(2)
formatChatCloseNotice(usage) ===
  `chat closed · ${humanizeTokens(usage.input)} in · ${humanizeTokens(usage.output)} out · $${usage.totalCost.toFixed(2)}`
```

**Exact test vectors** (pin these verbatim):

| usage (in / out / totalCost) | expected string |
|---|---|
| 12400 / 3100 / 0.07 | `chat closed · 12.4K in · 3.1K out · $0.07` (the spec example) |
| 0 / 0 / 0 | `chat closed · 0 in · 0 out · $0.00` |
| 999 / 999 / 0.006 | `chat closed · 999 in · 999 out · $0.01` |
| 1000 / 1000 / 1.2 | `chat closed · 1K in · 1K out · $1.20` |
| 12499 / 2801 / 0.066 | `chat closed · 12.5K in · 2.8K out · $0.07` |
| 123456 / 0 / 0 | `chat closed · 123.5K in · 0 out · $0.00` |

Separator is ` · ` (space, U+00B7 middle dot, space). No "M" tier — K only (spec shows K only; side chats are short).

### Success Criteria

- [ ] Two completed turns (in 1200/out 300/$0.03, then in 11200/out 2800/$0.04) → `record.usage` deep-equals `{input: 12400, output: 3100, totalCost: 0.07}` and `formatChatCloseNotice(record.usage)` === the spec example string
- [ ] Every formatter vector row above passes byte-exactly (including `1K` not `1.0K`, `$1.20` not `$1.2`)
- [ ] Aborted turn (via `error{reason:"aborted"}`) after a completed turn: `record.usage` unchanged (deep-equal); aborted-only chat stays `{0, 0, 0}`
- [ ] Other-error turn (`error{reason:"rate_limited"}` and `done{stopReason:"error"}`): no accumulation
- [ ] Promise-branch port (resolving an `AssistantMessage` with usage): tallied identically to the stream branch
- [ ] Record replaced mid-flight, old stream then resolves `done`: the NEW record's usage stays `{0, 0, 0}` (liveness guard precedes freeze+accumulate)
- [ ] `ChatMessage` still carries NO usage; usage appears nowhere but `record.usage` and the formatter's return value
- [ ] The notice string is fired nowhere in this change (no `notify`, no view call) — M2.T5.S1 owns firing
- [ ] Walls hold: banned-API grep CLEAN, `@earendil` absent from sidechat.ts, no `cacheRetention`, diff = 4 files

## All Needed Context

### Context Completeness Check

This PRP carries: the verified pi-ai `Usage` shape (nested `cost.total`), the name-map trap (`totalCost` vs `total`), S2's freeze-site contract (treated as landed — parallel task), the exact humanization algorithm with byte-exact vectors (the spec's one example leaves the sub-1000 / trailing-.0 / rounding questions open; the pinned rules close them), the existing test-harness facts (`assistantReply` already carries usage; no existing row asserts `record.usage`), and the scope walls (fire-free, parse-free, render-free). An implementer needs only the named files + this document.

### Documentation & References

```yaml
- file: plan/005_af804251f18d/P1M1T5S2/PRP.md
  why: "THE upstream contract — S2's terminal router and freeze(message) are where the tally lands; its routing table (abort=rollback, error=notice, freeze=stop|length|toolUse|deferred) and liveness guard are assumed exactly as specified"
  critical: "S2 lands in parallel; if its freeze-site code differs cosmetically, follow its INTENT: accumulate wherever the canonical AssistantMessage is frozen, after the getRecord() !== record guard"

- file: plan/005_af804251f18d/architecture/nested-llm-and-snapshot-seams.md
  why: "verified pi-ai facts: Usage = {input, output, cacheRead, cacheWrite, totalTokens, cost:{…, total}}; AssistantMessage.usage; 'The close-notify string maps usage.input→in, usage.output→out, usage.cost.total→$…'"

- file: plan/005_af804251f18d/P1M1T5S3/research/findings.md
  why: "full research record: name-map trap, spec-string derivation, humanization rounding checks, harness inventory, boundaries"

- file: spec/ui-spec.md
  section: "§Side chat (`e` — SIDECHAT-001…005) — 'Usage & close' bullet (line ~118)"
  why: "the verbatim spec authority for the notice string and the never-enters-stats rule"

- file: plan/005_af804251f18d/architecture/sidechat-contracts.md
  section: "§SIDECHAT-005 — cache-isolation (binding) + usage (lines ~74-85)"
  why: "usage tallies per chat; close/discard notifies compactly; usage NEVER enters session stats, entries, or tool results"

- file: src/panel/sidechat.ts
  why: "the store you extend: ChatUsage interface, buildFresh zeroing, header Consumers list, ChatMessage's no-usage rule"
  gotcha: "must stay 100% @earendil-free — formatChatCloseNotice takes ChatUsage (plain numbers), never a pi-ai Usage object"

- file: src/panel/sidechat-engine.ts
  why: "S1-landed engine + S2's contract freeze path; the ONLY file reading the nested pi-ai usage shape"
  pattern: "src/compaction.ts settle block — precedent for reading usage off a nested result (response.usage)"

- file: src/panel/sidechat-engine.test.ts
  why: "harness to extend: assistantReply(text) already carries usage {input:1, output:2, cost.total:0} (line ~76) — add an override param; doneStream/pendingStream/fakePort builders; resetSidechatForTests() in beforeEach"
  gotcha: "no existing row asserts record.usage — overriding usage defaults cannot break S1 rows"

- file: src/panel/sidechat.test.ts
  why: "the store's own suite — formatter exactness rows belong here (function lives in sidechat.ts)"
```

### Current Codebase tree (relevant slice)

```bash
src/panel/
├── sidechat.ts             # T3 store + S1/S2 types — EDIT: formatChatCloseNotice + doc comments
├── sidechat.test.ts        # store suite — EXTEND: formatter vectors
├── sidechat-engine.ts      # S1 landed + S2 landing — EDIT: accumulate at freeze site
├── sidechat-engine.test.ts # S1 rows + S2 rows — EXTEND: accumulation rows
├── sidechat-prompt.ts      # T4.S2 — untouched
└── branch-snapshot.ts      # T4.S1 — untouched
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# No new files. Edits only:
# src/panel/sidechat.ts             — formatChatCloseNotice(usage: ChatUsage): string (pure, spec-pinned)
# src/panel/sidechat-engine.ts      — 3-line tally inside freeze(); comment citing the name map + SIDECHAT-005
# src/panel/sidechat.test.ts        — formatter exactness vector rows
# src/panel/sidechat-engine.test.ts — accumulation / abort-zero / promise / dead-record rows
```

### Known Gotchas of our codebase & Library Quirks

```text
# CRITICAL NAME MAP: pi-ai nests cost — read message.usage.cost.total and write record.usage.totalCost.
#   There is NO usage.total and NO record field named "total". Writing `record.usage.total` fails typecheck
#   (good); reading `message.usage.total` compiles to undefined only if types are bypassed — don't bypass.

# CRITICAL: accumulate ONLY inside freeze() (or wherever S2 landed the canonical-message freeze). Abort and
#   error paths must remain untouched — they contribute zero BY CONSTRUCTION (no code needed there), which is
#   the SIDECHAT-005 guarantee. Adding "compensation" logic for aborted/error turns is an anti-pattern: there
#   is nothing to compensate.

# CRITICAL: keep the accumulation AFTER S2's liveness guard (getRecord() !== record → return). A replaced or
#   discarded record's stream resolving late must not mutate ANY record — the old one is dead, the new one
#   never saw the turn.

# CRITICAL: do NOT fire the notice. No ctx.ui.notify call, no record.notices entry, no view call — the close
#   notice is P1.M2.T5.S1's discard/close hook. This task's output is the STRING (formatter) + the TALLY
#   (record.usage). Nothing here consumes formatChatCloseNotice except tests.

# CRITICAL: do NOT add usage to ChatMessage. The store's pinned rule: "usage live on the record's tally,
#   not per-message". The tally is the only usage home; the formatter is the only usage reader.

# GOTCHA: sidechat.ts stays @earendil-free — formatChatCloseNotice takes ChatUsage (this module's own type),
#   so the pi-ai → plain-number translation happens in the engine, never in the store.

# GOTCHA: humanization edge rules (pinned, byte-exact): 1000 → "1K" (strip ".0"), NOT "1.0K";
#   sub-1000 → plain digits, no padding ("0", "850"); cost ALWAYS 2 decimals ("$0.00", "$1.20", not "$1.2");
#   toFixed does the rounding (12499 → "12.5K"); fp accumulation noise (0.03+0.04 → 0.07000…1) is absorbed
#   by display-only toFixed(2) — do NOT add cent-rounding arithmetic.

# GOTCHA: banned identifiers (the five SIDECHAT-005 mutation APIs) must not appear in either module —
#   not even in comments. Describe the ban, never spell it (sidechat.ts header precedent).

# GOTCHA: no cacheRetention anywhere in the engine; the tally code never touches sessionId or controllers.
```

## Implementation Blueprint

### Data models and structure

```typescript
// src/panel/sidechat.ts — NO shape changes. ChatUsage is already:
export interface ChatUsage { input: number; output: number; totalCost: number; }
// ChatMessage gains NOTHING this task (usage stays off messages — store rule).

// NEW export (pure, pi-free):
export function formatChatCloseNotice(usage: ChatUsage): string;

// src/panel/sidechat-engine.ts — no new types; the tally is three lines at the freeze site.
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/panel/sidechat.ts — the formatter (pure, landed first, independently testable)
  - IMPLEMENT formatChatCloseNotice(usage: ChatUsage): string:
      tokens(n) = n < 1000 ? String(n)
                : ((n / 1000).toFixed(1).replace(/\.0$/, "")) + "K"
      format   = `chat closed · ${tokens(usage.input)} in · ${tokens(usage.output)} out · $${usage.totalCost.toFixed(2)}`
    (inline the token helper or a module-local function — either fine; do NOT export it)
  - UPDATE ChatUsage doc comment: "Zeroed at creation; T5.S3 accumulates" → landed truth
    ("zeroed at creation, accumulated per COMPLETED turn at the engine's freeze site (P1.M1.T5.S3);
    aborted/error/replaced turns contribute nothing")
  - UPDATE header Consumers list: add P1.M2.T5.S1 (formatChatCloseNotice consumer — the close hook)
  - KEEP zero pi imports; no banned identifiers, even in comments
  - RUN: npx vitest run src/panel/sidechat.test.ts   # existing rows green (additive)

Task 2: EXTEND src/panel/sidechat.test.ts — formatter exactness rows
  - IMPORT formatChatCloseNotice (and ChatUsage type if needed)
  - DESCRIBE "formatChatCloseNotice": one test per vector row from the What-section table —
    spec example, zero chat, sub-1000 boundary (999), 1000→"1K" strip, rounding (12499→"12.5K",
    2801→"2.8K", 0.006→"$0.01", 1.2→"$1.20"), 123456→"123.5K"
  - MODE A comments citing ui-spec §Side chat "Usage & close" + SIDECHAT-005
  - RUN: npx vitest run src/panel/sidechat.test.ts

Task 3: EDIT src/panel/sidechat-engine.ts — the tally at the freeze site
  - LOCATE S2's freeze path (the stop|length|toolUse|deferred branch of the terminal router /
    freeze(message) helper — the ONE place a canonical AssistantMessage lands in the live record)
  - ADD (with the canonical message in hand, AFTER the liveness guard):
      record.usage.input += message.usage.input;
      record.usage.output += message.usage.output;
      record.usage.totalCost += message.usage.cost.total;
  - MODE A comment at the site: name map (pi-ai cost.total → ChatUsage.totalCost), completed-turns-only
    (abort/error never reach here; SIDECHAT-005: usage lives only on the record tally), cite P1.M1.T5.S3
  - TOUCH NOTHING ELSE: no abort/error path changes, no ChatMessage changes, no new exports,
    no sessionId/controller/cache logic
  - RUN: npm run typecheck

Task 4: EXTEND src/panel/sidechat-engine.test.ts — accumulation rows
  - HARNESS: give assistantReply(text) an optional usage override —
      assistantReply(text, usage?: { input: number; output: number; total: number }) merging over the
      existing defaults {input: 1, output: 2, cost.total: 0} (S1 rows keep their semantics)
  - ROW accumulation-math (stream): two sendTurns with doneStream messages carrying usage
    {1200, 300, 0.03} then {11200, 2800, 0.04} → record.usage deep-equals
    {input: 12400, output: 3100, totalCost: 0.07}; then formatChatCloseNotice(record.usage) ===
    "chat closed · 12.4K in · 3.1K out · $0.07" (the SPEC EXAMPLE as a live end-to-end row —
    import the formatter from ./sidechat.js)
  - ROW abort-contributes-zero: happy turn (usage {1200, 300, 0.03}), then a turn whose stream ends
    error{reason:"aborted"} → record.usage deep-equals {1200, 300, 0.03} (unchanged); user turn popped
  - ROW abort-only-chat-zero: single aborted turn from a fresh record → usage {0, 0, 0}
  - ROW error-contributes-zero: error{reason:"rate_limited"} turn (and a done{stopReason:"error"} turn)
    → usage stays at prior value; notices gained the error row
  - ROW promise-branch-tally: port returning Promise.resolve(assistantReply(text, {11200, 2800, 0.04}))
    after a stream turn → both tallied (same total as the stream-only row)
  - ROW dead-record-untouched: pendingStream in flight → openOrReplace(different questionId) →
    release done (usage {1200, 300, 0.03}) on the OLD stream → NEW record usage {0, 0, 0};
    old record object's usage also unchanged is acceptable to assert but not required
  - RUN: npx vitest run src/panel/sidechat-engine.test.ts   # S1 + S2 rows + new rows green

Task 5: VALIDATE walls + full gates
  - npx vitest run src/panel/ ; npm test ; npm run typecheck ; npm run lint
  - grep -nE "sendMessage|sendUserMessage|setActiveTools|registerTool|setModel" \
      src/panel/sidechat-engine.ts src/panel/sidechat.ts || echo CLEAN
  - grep -n "@earendil" src/panel/sidechat.ts || echo CLEAN
  - grep -n "cacheRetention" src/panel/sidechat-engine.ts || echo CLEAN
  - grep -rn "formatChatCloseNotice" src/ --include="*.ts" | grep -v test   # exactly ONE non-test hit:
    #   the definition in sidechat.ts (consumers arrive with M2.T5.S1)
  - git diff --stat   # ONLY the four files
```

### Implementation Patterns & Key Details

```typescript
// PATTERN — the formatter (sidechat.ts, pure; byte-exact rules are the contract):
function formatChatCloseNotice(usage: ChatUsage): string {
  const tokens = (n: number): string =>
    n < 1000 ? String(n) : `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `chat closed · ${tokens(usage.input)} in · ${tokens(usage.output)} out · $${usage.totalCost.toFixed(2)}`;
}
// 12400/3100/0.07 → "chat closed · 12.4K in · 3.1K out · $0.07"  (ui-spec §Side chat, verbatim)
// 1000 → "1K" (NOT "1.0K"); $1.2 → "$1.20"; 0 → "0 in"/"0 out"/"$0.00".

// PATTERN — the tally (sidechat-engine.ts, at S2's freeze site ONLY):
//   ... S2 liveness guard already returned for dead records ...
//   record.messages.push({ role: "assistant", text: joinTextParts(message.content), at, stopReason });
//   record.usage.input += message.usage.input;                  // completed turns only —
//   record.usage.output += message.usage.output;                // abort/error/replaced never reach
//   record.usage.totalCost += message.usage.cost.total;         // NAME MAP: cost.total → totalCost
// SIDECHAT-005: the tally is the ONLY usage home (record.usage); nothing here writes stats,
//   entries, or tool results — the module has no such API (grep wall proves it).

// CRITICAL: no compensation logic on abort/error paths — they contribute zero BY CONSTRUCTION.
// CRITICAL: the formatter is consumed by tests now and by P1.M2.T5.S1 later; nothing fires it here.
```

### Integration Points

```yaml
RUNTIME: NONE this task — no wiring, no notify call, no view change
CONSUMED NEXT:
  - P1.M2.T5.S1 (discard hooks at the state mutation seams): fires
    formatChatCloseNotice(record.usage) on EVERY discard/close path (question answered/closed by any
    path, mid-stream close abort→discard, /clear+new resets keep the view open — whether those notify
    is M2.T5.S1's call, reading the SAME formatter)
  - M3.T3.S1 (README): documents the string; this task changes no docs (Mode B)
STRUCTURAL GUARANTEE (SIDECHAT-005):
  - usage enters nothing but record.usage and the formatter's return value; the engine's only write
    surface is the sidechat singleton record (banned-API grep wall)
PIPelines: none — no config, no keys, no storage layers, no banned APIs
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck        # tsc --noEmit strict — zero errors (catches the totalCost/total name map)
npm run lint             # eslint src scripts *.ts
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/sidechat.test.ts -v          # formatter vectors + existing store rows
npx vitest run src/panel/sidechat-engine.test.ts -v   # S1 + S2 rows + accumulation rows
```

### Level 3: Integration (scripted only — no live TUI, no provider; the fake port IS the seam)

```bash
npx vitest run src/panel/     # whole panel tree green
npm test                      # full suite green
```

### Level 4: Domain-Specific (cache-isolation + scope walls)

```bash
grep -nE "sendMessage|sendUserMessage|setActiveTools|registerTool|setModel" \
  src/panel/sidechat-engine.ts src/panel/sidechat.ts || echo CLEAN   # SIDECHAT-005
grep -n "@earendil" src/panel/sidechat.ts || echo CLEAN              # store purity (M3.T1 precondition)
grep -n "cacheRetention" src/panel/sidechat-engine.ts || echo CLEAN  # no one-shot pattern
grep -rn "formatChatCloseNotice" src/ --include="*.ts" | grep -v "\.test\.ts"
# expected: exactly the definition site in src/panel/sidechat.ts
git diff --stat   # ONLY sidechat.ts, sidechat-engine.ts, sidechat.test.ts, sidechat-engine.test.ts
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1: typecheck + lint clean
- [ ] Level 2: both side-chat suites green (new + S1/S2 rows unregressed)
- [ ] Level 3: `npx vitest run src/panel/` + `npm test` green
- [ ] Level 4: three greps CLEAN; formatter grep shows definition-only; diff = 4 files

### Feature Validation

- [ ] Spec-example end-to-end row passes: two scripted turns → `chat closed · 12.4K in · 3.1K out · $0.07`
- [ ] All six formatter vectors byte-exact (`1K` strip, `$1.20` padding, `12.5K` rounding, zero chat)
- [ ] Abort contributes zero (unchanged tally; aborted-only chat stays zeroed)
- [ ] Error turns contribute zero; promise branch tallies; dead records never accumulate
- [ ] No per-message usage; no notice fired anywhere; usage outside record.usage + the string: nowhere

### Code Quality Validation

- [ ] sidechat.ts remains @earendil-free; formatter is pure (ChatUsage in → string out)
- [ ] Engine change is the 3-line tally + comments — nothing else moved
- [ ] Mode A comments cite SIDECHAT-005, the name map, ui-spec §Side chat "Usage & close", P1.M1.T5.S3
- [ ] S1/S2 contracts unregressed (routing table, rollback, notices, guards, sessionId stability)

### Documentation & Deployment

- [ ] Mode A only — store doc comments updated (ChatUsage landed state, Consumers list gains M2.T5.S1);
      no README/config/docs changes (M3.T3.S1 owns Mode B docs)

---

## Anti-Patterns to Avoid

- ❌ Don't read `usage.total` or write `record.usage.total` — the map is `usage.cost.total` → `record.usage.totalCost`
- ❌ Don't add abort/error "compensation" logic — those turns contribute zero by never reaching freeze
- ❌ Don't fire the notice, don't touch notify, don't add a close hook — P1.M2.T5.S1 owns every discard/close path
- ❌ Don't put usage on ChatMessage or into session stats/entries/tool results — SIDECHAT-005 is structural
- ❌ Don't import pi-ai types into sidechat.ts (formatter takes ChatUsage, plain numbers)
- ❌ Don't add an "M" tier, pad sub-1000 tokens, keep trailing ".0", or 1-decimal costs — the vectors are pinned
- ❌ Don't add cent-rounding arithmetic for accumulated cost — display-only `toFixed(2)` absorbs fp noise
- ❌ Don't tally before the liveness guard — dead records (replaced/discarded mid-flight) stay untouched
- ❌ Don't touch sessionId/controllers/cache options while adding the tally; don't regress S1/S2 rows

---

**Confidence Score: 9/10** — the only variable is S2's exact freeze-site shape (landing in parallel); the PRP pins the intent (accumulate where the canonical AssistantMessage freezes, after the liveness guard) so cosmetic drift in S2's code cannot derail this task. Everything else — Usage shape, name map, spec string, humanization rules, harness, walls — is verified against the repo.

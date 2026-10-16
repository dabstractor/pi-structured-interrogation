---
name: "P1.M1.T3.S2 — /clear and /new byte-exact first-token reset commands for the side-chat store"
description: "Pure classifyChatCommand(input) → '/clear' | '/new' | null (byte-exact first whitespace-delimited token) plus resetChat(questionId, deps) on the sidechat.ts store: discards messages AND usage, rebinds FRESH to the CURRENT question via the injected builders, view never closes. Consumed by the P1.M2.T3.S1 enter/send pipeline."
---

## Goal

**Feature Goal**: Add the SIDECHAT-002 slash-escape layer to the side-chat store (src/panel/sidechat.ts, created by P1.M1.T3.S1):
1. `classifyChatCommand(input: string): "/clear" | "/new" | null` — pure; byte-exact match of the **first whitespace-delimited token** against `"/clear"` or `"/new"`. `/clear extra words` is still a command; `/usr/bin/env`, `/clearance`, `see /clear below`, and a markdown heading `## /clear` are messages (null).
2. `resetChat(questionId: string, deps: SidechatRebindDeps): SidechatRecord` — discard the current record's messages AND usage and REBIND FRESH to the CURRENT question: a new snapshot + system prompt + model resolution via the injected builders, fresh AbortController, `streamState: "idle"`. Bypasses `openOrReplace`'s same-question reuse deliberately — a reset is a rebuild even when the questionId is unchanged. The engine never touches the view (view stays open; that's P1.M2's concern — this module just has no view code).

**Deliverable**: `src/panel/sidechat.ts` (+2 exports, ~30 lines) and `src/panel/sidechat.test.ts` (+2 describes). No new files, no config/API surface.

**Success Definition**: `npm run typecheck` + `npm test` green; every classification case from the contract asserts correctly (both commands, trailing-words variant, the four null cases); resetChat proven to zero messages/usage, invoke all three builders exactly once, produce a FRESH AbortController and new builder values, and never require a prior record to exist; S1's existing lifecycle tests stay green; module remains zero-pi-imports (cache-isolation clean).

## User Persona

**Target User**: The pi user mid-side-chat who wants a clean slate without losing their place — typed `/clear` means "restart this conversation", typed `/usr/bin/env foo` means "I'm quoting a path, send it as a message".

**User Journey**: User types `/clear` + enter → the enter/send pipeline (P1.M2.T3.S1) calls `classifyChatCommand` first → gets `"/clear"` → calls `resetChat(record.questionId, deps)` → transcript empties, usage zeroes, a fresh branch snapshot/prompt/model bind → the view (unchanged, still open) renders the empty transcript. User types `see /clear below` → classify returns null → the pipeline sends it as an ordinary chat message.

**Pain Points Addressed**: Slash false-positives (shell paths, markdown headings becoming destructive resets); stale snapshots surviving a "clear" because the store reused the same-question record.

## Why

- SIDECHAT-002 verbatim (sidechat-contracts.md:45-46): "`/clear` and `/new`: byte-exact match on the FIRST whitespace-delimited input token only (a `/usr/bin` path or markdown heading is a message) → discard messages + usage, rebind fresh to the CURRENT question, view stays open." Both names are aliases for the same reset — no behavioral difference.
- The reset is the ONLY sanctioned way to refresh a chat's frozen context: SIDECHAT-003 pins the snapshot at creation ("NOT refreshed mid-chat"); `/clear`/`/new` is the user-facing escape valve, which is why `resetChat` must re-invoke the builders even on an unchanged questionId.
- P1.M2.T3.S1's enter interception consumes both functions; landing them here (with the store) keeps the view layer a thin caller.

## What

1. **`classifyChatCommand(input: string): "/clear" | "/new" | null`** — pure function in sidechat.ts:
   - Split on whitespace: `const first = input.split(/\s+/)[0] ?? ""` (empty input → `""` → null).
   - Return `"/clear"` or `"/new"` on EXACT equality of the first token; else `null`.
   - NO trimming beyond whitespace splitting (leading whitespace is consumed by the split naturally), NO case-folding (`/Clear` is a message), NO prefix matching (`/clearance`, `/clear-x` are messages). A token containing `/clear` as a substring but not equal (`## /clear` splits to `##` first anyway) is never a command.
2. **`resetChat(questionId: string, deps: SidechatRebindDeps): SidechatRecord`**:
   - Unconditionally build a FRESH record via the exact creation path `openOrReplace` uses for a new question (extract the shared `buildFresh(questionId, deps)` internal so openOrReplace and resetChat can't diverge) and assign it to the module singleton. Messages `[]`, usage `{input: 0, output: 0, totalCost: 0}`, fresh `new AbortController()`, `streamState: "idle"`, each builder invoked exactly once.
   - Works whether or not a record already exists (first-ever input being `/clear` is a legal no-op-ish reset that creates the record).
   - NO abort of the old record's stream — same caller-owns-abort rule as `discard()` (mid-stream close abort ordering is P1.M2.T5.S1). One-line comment stating this.
   - Returns the new record.
3. **JSDoc**: one block on each export. `classifyChatCommand`: cite SIDECHAT-002 first-token rule + the four null exemplars. `resetChat`: cite the SIDECHAT-003 freeze escape-valve rationale (reset = the only snapshot refresh) + caller-owns-abort + view-stays-open (engine has no view).
4. **Tests** (append to `src/panel/sidechat.test.ts`, same `beforeEach(resetSidechatForTests)` + fake-builder conventions S1 established):
   - classify: `"/clear"` → "/clear"; `"/new"` → "/new"; `"/clear extra words"` → "/clear"; `"/new   "` → "/new"; `"/usr/bin/env"` → null; `"/clearance"` → null; `"see /clear below"` → null; `"## /clear"` → null; `"/Clear"` → null (case-sensitive); `""` → null; `"  /clear"` → "/clear" (leading whitespace is not part of the token).
   - resetChat: with an existing record holding messages and non-zero usage → returns a record with empty messages, zeroed usage, fresh AbortController (`!==` old), NEW builder outputs (make the fakes sequence-aware so second calls return different values), all three builder vi.fns called exactly once MORE; identity: `get()` now returns the new record; with NO prior record → still builds and returns fresh; same questionId does NOT take the reuse path (builder call counts prove it); old record's mutated messages not carried over.
5. **Docs**: none beyond the JSDoc — command names are user-facing behavior documented Mode B in the README side-chat section by P1.M3.T3.S1. Do not add README/spec edits here.

### Success Criteria

- [ ] All classify cases above assert correctly, including the case-sensitivity and leading-whitespace pins
- [ ] resetChat: zeroed messages/usage, fresh AbortController, builders exactly once, no reuse path, no carry-over — all pinned
- [ ] resetChat with no prior record works; first-input `/clear` is legal
- [ ] No abort logic added; no view/UI code; module still imports nothing from pi
- [ ] S1's lifecycle tests untouched and green; `npm test` + `npm run typecheck` green

## All Needed Context

### Context Completeness Check

This PRP embeds the verbatim SIDECHAT-002 slash-escape clause, the full classification truth table, the resetChat semantics (including the SIDECHAT-003 freeze rationale and the shared buildFresh refactor), and the test matrix. It assumes only what P1.M1.T3.S1's PRP specifies (its type/API surface is quoted below). An implementer needs this PRP plus `src/panel/sidechat.ts` — nothing else.

### Documentation & References

```yaml
- docfile: plan/005_af804251f18d/architecture/sidechat-contracts.md
  why: THE authority — §SIDECHAT-002 :45-46 (slash escapes, byte-exact first token, the /usr/bin + markdown exemplars, discard messages+usage, rebind fresh, view stays open); §SIDECHAT-003 :49-58 (snapshot frozen at creation — why resetChat MUST re-invoke builders)
  critical: "byte-exact" means === on the whitespace-split first token; substring/prefix/case-insensitive matching are all bugs

- file: plan/005_af804251f18d/P1M1T3S1/PRP.md
  why: PREDECESSOR CONTRACT (in flight; assume landed as specified) — defines SidechatRecord {questionId, messages, streamState, abortController, modelSnapshot, systemPrompt, branchSnapshot, usage}, SidechatRebindDeps {resolveModelSnapshot, buildSystemPrompt, buildBranchSnapshot}, openOrReplace (same-question reuse, builders-once), discard, resetSidechatForTests
  gotcha: resetChat is the DELIBERATE bypass of openOrReplace's reuse — refactor the creation body into a shared internal so both call it; do not duplicate the literal
  pattern: if S1's implementation names things slightly differently, adapt to ITS names — the semantics are the contract, not the identifiers

- file: src/panel/sidechat.test.ts
  why: the suite this PRP extends — reuse its fake-deps (vi.fn) and beforeEach(resetSidechatForTests) conventions; make the fakes sequence-aware (a counter in the closure) so resetChat's fresh outputs are distinguishable from the originals

- file: src/state.ts
  why: house pattern for module-singleton JSDoc discipline (nothing to copy beyond comment tone)
```

### Current Codebase tree (relevant slice)

```bash
src/panel/
  sidechat.ts        # from P1.M1.T3.S1 (parallel) — this PRP adds classifyChatCommand + resetChat
  sidechat.test.ts   # from P1.M1.T3.S1 — this PRP appends two describes
```

### Desired Codebase tree

No new files — `src/panel/sidechat.ts` +2 exports (and one internal `buildFresh` extraction), `src/panel/sidechat.test.ts` +2 describes.

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: byte-exact === on the FIRST whitespace-delimited token — split(/\s+/), no trim-games, no toLowerCase
// CRITICAL: "/clear" and "/new" are the SAME behavior (aliases); classify distinguishes only so callers could differ later
// CRITICAL: resetChat must NOT go through openOrReplace's same-question reuse branch — builders MUST re-run (SIDECHAT-003 refresh valve)
// No abortController.abort() anywhere here — mid-stream abort ordering is the caller's (P1.M2.T5.S1), same rule as discard()
// Zero pi imports in sidechat.ts (M3.T1 static guard scans this module set for sendMessage|sendUserMessage|setActiveTools|registerTool|setModel|@earendil)
// Empty string input: split(/\s+/)[0] on "" is "" (split returns [""]) — null; "  " splits to ["",""] → first "" → null. Cover both in tests.
// vitest module state leaks — every new describe must run under beforeEach(resetSidechatForTests)
// This module NEVER closes or references the view — "view stays open" is structural (no view code exists here)
```

## Implementation Blueprint

### Data models and structure

No new types. New signatures on the S1 module:

```ts
export function classifyChatCommand(input: string): "/clear" | "/new" | null;
export function resetChat(questionId: string, deps: SidechatRebindDeps): SidechatRecord;
// internal (not exported): function buildFresh(questionId: string, deps: SidechatRebindDeps): SidechatRecord
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: TDD — append the two describes to src/panel/sidechat.test.ts (red)
  - classifyChatCommand truth table: "/clear", "/new", "/clear extra words", "/new   ", "  /clear", "/usr/bin/env", "/clearance", "see /clear below", "## /clear", "/Clear", "", "  "
  - resetChat: sequence-aware fake deps (closure counter → distinct outputs per call); existing-record reset (messages emptied, usage zeroed, fresh AbortController, NEW builder values, builder vi.fn called exactly once more, get() identity swaps, old mutated messages not carried); no-prior-record reset; same-questionId bypasses reuse (builder counts prove)
  - RUN: npx vitest run src/panel/sidechat.test.ts → new cases red, S1 cases green

Task 2: IMPLEMENT in src/panel/sidechat.ts
  - EXTRACT: the record-creation body of openOrReplace into internal buildFresh(questionId, deps) — openOrReplace's else-branch now calls it (behavior identical; S1 tests must stay green untouched)
  - ADD: classifyChatCommand (pure, split(/\s+/)[0], exact === against the two literals)
  - ADD: resetChat = current = buildFresh(questionId, deps); return current — with the caller-owns-abort + view-stays-open comments
  - JSDoc per What §3 (cite SIDECHAT-002 :45-46 and the SIDECHAT-003 refresh rationale)

Task 3: GATES
  - npx vitest run src/panel/sidechat.test.ts -v → all green
  - npm test && npm run typecheck → green
  - grep -nE "sendMessage|sendUserMessage|setActiveTools|registerTool|setModel|@earendil" src/panel/sidechat.ts || echo CLEAN
```

### Implementation Patterns & Key Details

```ts
// The whole logic, in miniature:
export function classifyChatCommand(input: string): "/clear" | "/new" | null {
  const first = input.split(/\s+/)[0] ?? "";
  if (first === "/clear") return "/clear";
  if (first === "/new") return "/new";
  return null;
}

export function resetChat(questionId: string, deps: SidechatRebindDeps): SidechatRecord {
  // SIDECHAT-003 refresh valve: the ONLY path that re-runs the builders for a
  // question. Caller owns aborting any in-flight stream (P1.M2.T5.S1). The
  // engine never touches the view — "view stays open" holds by construction.
  current = buildFresh(questionId, deps);
  return current;
}
```

### Integration Points

```yaml
CONSUMERS (do NOT implement here):
  - P1.M2.T3.S1 (enter/send pipeline): calls classifyChatCommand(input) BEFORE send; on non-null calls
    resetChat(record.questionId, deps) and re-renders — the only in-changeset consumer
  - P1.M3.T3.S1 documents the command names in the README (Mode B)
NO-WIRING-THIS-SUBTASK:
  - nothing new imports these exports yet
DO-NOT-TOUCH:
  - openOrReplace/discard/get signatures (extraction only), config, view code, discuss.ts
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npx vitest run src/panel/sidechat.test.ts
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/sidechat.test.ts -v   # S1 + new describes green
npm test                                       # full suite
```

### Level 3: Integration Testing

Deliberately N/A — pure store functions; the enter/send pipeline integration lands in P1.M2.T3.S1 and exercises these through the view.

### Level 4: Guards

```bash
grep -nE "sendMessage|sendUserMessage|setActiveTools|registerTool|setModel|@earendil" src/panel/sidechat.ts || echo CLEAN
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean; `npm test` fully green
- [ ] Cache-isolation grep CLEAN

### Feature Validation

- [ ] classify truth table fully asserted (incl. case-sensitivity, leading whitespace, empty/whitespace-only, all four contract null-exemplars)
- [ ] resetChat: builders re-run (bypasses reuse), messages/usage zeroed, fresh AbortController, no carry-over, works with no prior record
- [ ] No abort logic, no view code, no config reads added
- [ ] S1's lifecycle tests untouched and green (buildFresh extraction is behavior-neutral)

### Code Quality Validation

- [ ] openOrReplace and resetChat share ONE creation path (no duplicated record literal)
- [ ] JSDoc cites SIDECHAT-002/SIDECHAT-003 contracts
- [ ] Only sidechat.ts + sidechat.test.ts modified

### Documentation & Deployment

- [ ] No README/spec edits (Mode B docs are P1.M3.T3.S1's scope)

---

## Anti-Patterns to Avoid

- ❌ Don't case-fold, prefix-match, or substring-match the token — byte-exact `===` only
- ❌ Don't route resetChat through openOrReplace — the same-question reuse branch would silently skip the builder re-run
- ❌ Don't abort the old stream in resetChat — caller-owns-abort (same rule as discard)
- ❌ Don't touch the view, config, or any send pipeline here — P1.M2.T3.S1 owns the call site
- ❌ Don't duplicate the record-creation literal — extract buildFresh and share it
- ❌ Don't treat `/clear` and `/new` differently — they are aliases

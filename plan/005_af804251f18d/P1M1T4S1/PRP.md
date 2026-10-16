---
name: "P1.M1.T4.S1 — One-shot branch snapshot pipeline (getBranch → context messages)"
description: "New pure module src/panel/branch-snapshot.ts: takeBranchSnapshot(sessionManager) = getBranch() → flatMap(sessionEntryToContextMessages) → convertToLlm → Object.freeze — the frozen Message[] replay stored once at side-chat creation (SIDECHAT-003). Plus the Mode A snapshot-once note in sidechat.ts's header. No wiring (that is M2.T4.S1)."
---

## Goal

**Feature Goal**: Implement SIDECHAT-003's context half: a pure, one-shot branch-snapshot pipeline that converts the main session's current branch (`getBranch()` — ALL entry types, root→leaf path order) into a frozen `Message[]` replay suitable for `Context.messages` (pi-ai), snapshotted ONCE per side-chat creation and never re-read mid-chat (accepted staleness, v1). This unblocks P1.M1.T5.S1 (context assembly: system prompt + snapshot + chat turns).

**Deliverable**:
1. New file `src/panel/branch-snapshot.ts` — `takeBranchSnapshot(sessionManager: Pick<ReadonlySessionManager, "getBranch">): BranchSnapshotMessages` (the frozen `readonly Message[]`) + the exported `BranchSnapshotMessages` type.
2. New file `src/panel/branch-snapshot.test.ts` — mixed-SessionEntry fixtures (only conversation-bearing entries survive, order preserved), freeze/purity rows, and the never-re-read identity pin through the landed `openOrReplace`.
3. `src/panel/sidechat.ts` — Mode A ONLY: header paragraph gains the snapshot-once/accepted-staleness note naming `branch-snapshot.ts` as the producer; `BranchSnapshot` comment updated (type stays `readonly unknown[]`).

**Success Definition**:
- `takeBranchSnapshot` output equals pi's own context projection for the branch: `message`/`custom_message`/`branch_summary`/`compaction` entries contribute messages in path order; `model_change`/`thinking_level_change`/`custom`/`label`/`session_info` contribute nothing; `AgentMessage[]` narrowed to `Message[]` via `convertToLlm`.
- Result is `Object.freeze`n; pure per call; stored on the singleton exactly once at creation (same-question reuse never re-reads — pinned by test).
- No session WRITES anywhere; zero banned-API identifiers (SIDECHAT-005/M3.T1-compatible); sidechat.ts keeps ZERO pi imports (T3.S2's gate stays green).
- `npm test` + `npm run typecheck` green.

## User Persona (if applicable)

**Target User**: The pi user discussing one interrogation question in the side chat.

**Use Case**: Opening `e` on a question — the side model needs the full main-branch conversation as context, captured at that instant.

**User Journey**: User presses `e` on q3 → the chat opens with the branch replayed once into the snapshot → turns stream against system prompt + snapshot + turns → mid-chat submissions in the main panel do NOT alter the snapshot (staleness accepted v1).

**Pain Points Addressed**: Without a one-shot frozen snapshot, every turn would re-read a mutating branch — changing context mid-conversation and risking cache thrash; SIDECHAT-003 freezes it once by contract.

## Why

- SIDECHAT-003 (prd_snapshot h2.80 / sidechat-contracts.md §49-56): "Context = side-chat system prompt + FULL main-branch replay snapshotted ONCE at chat creation: `ctx.sessionManager.getBranch()` replayed via `sessionEntryToContextMessages`. Snapshot NOT refreshed mid-chat (staleness accepted v1)."
- The landed store (T3.S1, commit 34e76e9) already freezes `branchSnapshot` at creation via the injected `buildBranchSnapshot` — but the real pipeline and shape are THIS task's output ("The real shape lands with P1.M1.T4.S1").
- T5.S1's context assembly needs `Message[]` (pi-ai `Context.messages`); `sessionEntryToContextMessages` yields `AgentMessage[]` — the sanctioned narrowing is `convertToLlm` (in-repo precedent `src/compaction.ts:44,91`).
- Placement: sidechat.ts is contractually pure ("ZERO pi imports"; T3.S2's in-flight gate greps `@earendil` in it) and lists "T4.S1/S2 branch builders" as CONSUMERS of its deps-bag seam — hence the sibling module `panel/branch-snapshot.ts` (spec's M10 module family), not sidechat.ts itself.

## What

1. **`src/panel/branch-snapshot.ts`** (new, pure):
   ```ts
   import { convertToLlm, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
   import type { ReadonlySessionManager } from "@earendil-works/pi-coding-agent";
   import type { Message } from "@earendil-works/pi-ai";

   /** The frozen branch replay: pi-ai Messages, captured once at chat creation (SIDECHAT-003). */
   export type BranchSnapshotMessages = readonly Message[];

   /** [Mode A] ONE-SHOT branch snapshot (SIDECHAT-003): getBranch() (ALL entry types,
    * root→leaf path order, NOT compaction-aware — full replay by design) →
    * sessionEntryToContextMessages (pi's own context projection: message/custom_message/
    * branch_summary/compaction contribute; model_change/custom/label/session_info/
    * thinking_level_change contribute nothing) → convertToLlm (AgentMessage[] → Message[],
    * custom messages become user messages — compaction.ts:91 precedent) → Object.freeze.
    * READ-ONLY: only getBranch() is called; never writes the session (SIDECHAT-005).
    * Stored on the SidechatRecord ONCE at creation by openOrReplace's deps bag; NEVER
    * re-read mid-chat — mid-chat submissions leave it stale (accepted v1, SIDECHAT-003). */
   export function takeBranchSnapshot(
     sessionManager: Pick<ReadonlySessionManager, "getBranch">,
   ): BranchSnapshotMessages {
     const agentMessages = sessionManager.getBranch().flatMap(sessionEntryToContextMessages);
     return Object.freeze(convertToLlm(agentMessages));
   }
   ```
   Notes: flatMap over ALL entries — the helper IS the filter (returns `[]` for non-bearing types), byte-identical to pi's own `buildSessionContext` projection (session-manager.js:235). Do NOT hand-roll an `entry.type === "message"` filter (would drop custom_message/branch_summary/compaction contributions). Shallow `Object.freeze` only (nested messages stay as pi produced them).
2. **`src/panel/branch-snapshot.test.ts`** (new): the test matrix below — plain-object `SessionEntry` fixtures (SessionEntryBase = `{type, id, parentId, timestamp}` + per-type payload), a stateful fake session manager for the identity pin, and `resetSidechatForTests()` beforeEach where the store is exercised.
3. **`src/panel/sidechat.ts`** (Mode A only): extend the header's "SIDECHAT-003 extension" paragraph with the accepted-staleness sentence ("mid-chat submissions leave the snapshot stale — accepted v1") and name `panel/branch-snapshot.ts` / `takeBranchSnapshot` as the producer; update the `BranchSnapshot` type comment ("real runtime shape: pi-ai `Message[]`, produced by `takeBranchSnapshot`; held opaque here — zero pi imports is load-bearing for the M3.T1 guard"). The TYPE stays `readonly unknown[]` — do not import pi types into sidechat.ts.
4. **NOT in scope** (explicitly): the `e`/onChat wiring that calls `openOrReplace` with `buildBranchSnapshot: () => takeBranchSnapshot(ctx.sessionManager)` (M2.T4.S1); the system-prompt builder (T4.S2); the nested loop (T5.*); any change to `openOrReplace`/`discard` semantics.

### Success Criteria

- [ ] Mixed-fixture test: only message-bearing entries (message/custom_message/branch_summary/compaction) survive, ROOT→LEAF order preserved
- [ ] `Object.isFrozen === true`; empty branch → `[]` frozen; purity (two calls: deep-equal, distinct references)
- [ ] Identity pin: after creation, branch mutations do NOT appear in `record.branchSnapshot`; same-question reuse invokes the builder exactly once (toBe-same record)
- [ ] branch-snapshot.ts has zero banned identifiers; sidechat.ts still has zero `@earendil` strings
- [ ] `npm test` + `npm run typecheck` green

## All Needed Context

### Context Completeness Check

Every seam was verified against the installed package's dist (signatures, implementation behavior, entry-type truth table) and the landed store's source. The full pipeline is written out above; test fixture shapes and expectations are enumerated in the research notes. An agent needs this PRP + the named files — nothing else.

### Documentation & References

```yaml
- file: plan/005_af804251f18d/P1M1T4S1/research/notes.md
  why: "VERIFIED seam inventory: sessionEntryToContextMessages behavior per entry type (impl-read), getBranch semantics (raw path, NOT compaction-aware), ReadonlySessionManager param type, convertToLlm precedent, the full test matrix, placement rationale"
  critical: "the entry-type truth table (which types contribute messages) and the fixture assertion strategy (projection asserts, not deep equality)"

- file: plan/005_af804251f18d/architecture/nested-llm-and-snapshot-seams.md
  why: "§Branch-snapshot pipeline (SIDECHAT-003) — the 4-step design this task implements; §Exact API signatures (Context.messages: Message[]); the package-name correction (@earendil-works/pi-coding-agent)"

- file: plan/005_af804251f18d/architecture/sidechat-contracts.md
  why: "SIDECHAT-003 verbatim authority (context = system prompt + full replay snapshotted once; staleness accepted v1; getBranch + sessionEntryToContextMessages named)"

- file: src/panel/sidechat.ts
  why: "The landed store: SidechatRebindDeps.buildBranchSnapshot seam, openOrReplace's once-per-creation guarantee, BranchSnapshot placeholder type, resetSidechatForTests, and the zero-pi-imports header this task extends (Mode A)"
  gotcha: "DO NOT import anything from @earendil* into sidechat.ts — T3.S2's gate greps for it; the snapshot pipeline lives in the NEW module"

- file: src/panel/sidechat.test.ts
  why: "House conventions for the store's tests (fake-builder deps bags, resetSidechatForTests beforeEach, toBe identity asserts) — mirror for the identity-pin test"

- file: src/compaction.ts
  why: "In-repo precedent: :44 imports convertToLlm; :91 serializeConversation(convertToLlm(allMessages)) — the sanctioned AgentMessage[]→Message[] narrowing pattern"

- file: node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts
  why: "SessionEntry union (:105), SessionEntryBase (:17), entry payload shapes, sessionEntryToContextMessages (:151), getBranch (:257-262), ReadonlySessionManager (:140)"
  critical: "getBranch doc says 'Use buildSessionContext() to get the RESOLVED messages' — the spec deliberately chooses getBranch for FULL replay; do not switch seams"

- file: node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js
  why: "Impl truth: :166-187 sessionEntryToContextMessages (null-content patch; custom_message/branch_summary/compaction message construction; [] for the rest); :235 buildSessionContext's identical flatMap; :958-966 getBranch's leaf→root walk + reverse"

- file: node_modules/@earendil-works/pi-coding-agent/examples/extensions/qna.ts
  why: "Upstream walk precedent (:45-50 getBranch + entry.type === 'message') — note our pipeline deliberately flatMaps ALL entries via the helper instead (custom_message/branch_summary/compaction also bear context)"
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
├── sidechat.ts            # landed store (T3.S1) — Mode A header note + BranchSnapshot comment ONLY
├── sidechat.test.ts       # landed — untouched
├── branch-snapshot.ts     # NEW — takeBranchSnapshot + BranchSnapshotMessages (this task)
└── branch-snapshot.test.ts# NEW — filtering/order, freeze, purity, identity pin
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: sidechat.ts must NEVER import @earendil* (T3.S2's landed/in-flight gate +
//   T3.S1's zero-pi-imports contract). The pipeline lives in branch-snapshot.ts.
// GOTCHA: getBranch() is NOT compaction-aware (raw leaf→root path reversed). After a
//   compaction the replay includes summarized history AND the compaction summary —
//   that IS SIDECHAT-003's "FULL replay"; do not "fix" it with buildContextEntries.
// GOTCHA: sessionEntryToContextMessages returns [] for model_change / thinking_level_change /
//   custom / label / session_info — flatMap-everything needs NO hand filter; a
//   type === "message" filter (qna.ts style) would WRONGLY drop custom_message /
//   branch_summary / compaction contributions.
// GOTCHA: message entries with user/assistant/toolResult role and content == null are
//   patched by the helper itself to content: [] — include one fixture row, expect [].
// GOTCHA: convertToLlm may map custom AgentMessages into user-shaped Messages — assert
//   via projections (role + text-in-order), not deep equality on every field.
// GOTCHA: Object.freeze is SHALLOW (the array, not nested messages) — pin
//   Object.isFrozen(result); do not deep-freeze.
// GOTCHA: fixtures need SessionEntryBase fields ({type, id, parentId, timestamp}) or
//   the helper's guards may misread them; model real parentId chains for path order.
```

## Implementation Blueprint

### Data models and structure

```ts
// branch-snapshot.ts — the full surface (also shown in What §1):
export type BranchSnapshotMessages = readonly Message[];
export function takeBranchSnapshot(
  sessionManager: Pick<ReadonlySessionManager, "getBranch">,
): BranchSnapshotMessages;
// Consumed downstream: M2.T4.S1 wires it as deps.buildBranchSnapshot for openOrReplace;
// T5.S1 reads record.branchSnapshot (runtime Message[]) into Context.messages.
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/panel/branch-snapshot.ts
  - IMPLEMENT: takeBranchSnapshot + BranchSnapshotMessages exactly as in What §1
    (flatMap all entries → convertToLlm → Object.freeze; Mode A JSDoc with SIDECHAT-003).
  - NAMING: file branch-snapshot.ts (kebab, panel/ family); export takeBranchSnapshot.
  - PLACEMENT: src/panel/ (spec M10 module family; sibling of sidechat.ts).
  - VERIFY imports resolve: npm run typecheck after creation.

Task 2: CREATE src/panel/branch-snapshot.test.ts (TDD-ready — write first if preferred)
  - FIXTURES: plain SessionEntry objects (SessionEntryBase + payload) — mixed branch:
    [model_change, user msg, custom(plain), custom_message, assistant msg, compaction,
    label, session_info, thinking_level_change, msg(null content)] with a real
    parentId chain (e1..e10) so path order is meaningful.
  - TEST filtering+order: only bearing types contribute; roles/text appear in path
    order; non-bearing types contribute nothing (projection asserts).
  - TEST null-content patch: user msg {content: null} → survives with content [].
  - TEST empty branch → [] frozen; Object.isFrozen true; purity (deep-equal, ≠ refs).
  - TEST identity pin (imports openOrReplace + resetSidechatForTests from sidechat.ts):
    stateful fake (entries array captured by closure) → openOrReplace("q1", deps with
    buildBranchSnapshot: () => takeBranchSnapshot(fake)) → append an entry to the fake →
    openOrReplace("q1", same deps) → toBe SAME record; branchSnapshot has NO trace of
    the appended entry; builder called exactly once → openOrReplace("q2", deps) → new
    record; builder called twice; snapshot reflects the mutated branch.
  - GUARD greps (assertions or just run them): branch-snapshot.ts free of
    sendMessage|sendUserMessage|setActiveTools|registerTool|setModel; sidechat.ts free of @earendil.

Task 3: MODE A note in src/panel/sidechat.ts
  - EXTEND the "SIDECHAT-003 extension" header paragraph: accepted-staleness sentence +
    producer naming (panel/branch-snapshot.ts takeBranchSnapshot).
  - UPDATE the BranchSnapshot type comment: real runtime shape = pi-ai Message[]
    (produced by takeBranchSnapshot); static type stays readonly unknown[] (zero
    pi imports is load-bearing). NO type/code change.

Task 4: VALIDATE
  - npx vitest run src/panel/branch-snapshot.test.ts src/panel/sidechat.test.ts -v
  - npm test && npm run typecheck
  - grep -nE "sendMessage|sendUserMessage|setActiveTools|registerTool|setModel" src/panel/branch-snapshot.ts || echo CLEAN
  - grep -n "@earendil" src/panel/sidechat.ts || echo CLEAN
```

### Implementation Patterns & Key Details

```ts
// The pipeline (the entire production surface — keep it this small):
export function takeBranchSnapshot(
  sessionManager: Pick<ReadonlySessionManager, "getBranch">,
): BranchSnapshotMessages {
  const agentMessages = sessionManager.getBranch().flatMap(sessionEntryToContextMessages);
  return Object.freeze(convertToLlm(agentMessages));
}

// Identity-pin test core (the NEVER-re-read contract through the landed store):
const fake = { getBranch: () => entries };            // closure over `entries`
const deps = { ..., buildBranchSnapshot: () => takeBranchSnapshot(fake) };
const rec = openOrReplace("q1", deps);
entries.push(newUserMessage);                          // main session moves on
expect(openOrReplace("q1", deps)).toBe(rec);           // reuse — no rebuild
expect(rec.branchSnapshot).not.toContainTraceOf(newUserMessage); // still the old replay
expect(deps.buildBranchSnapshot).toHaveBeenCalledTimes(1);
```

### Integration Points

```yaml
CONSUMED-BY (no wiring in this task):
  - M2.T4.S1 (onChat open path): openOrReplace(q, { ..., buildBranchSnapshot: () => takeBranchSnapshot(ctx.sessionManager) })
  - T4.S2 (system prompt builder): sibling module; same deps-bag family
  - T5.S1 (context assembly): Context = { systemPrompt: record.systemPrompt, messages: [...record.branchSnapshot, ...chatTurnsAsMessages] }
GUARDS:
  - M3.T1 banned-API scan will include branch-snapshot.ts — clean by construction
    (only getBranch, a read); sidechat.ts purity gate untouched
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck        # tsc --noEmit — zero errors (new module + tests typecheck)
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/panel/branch-snapshot.test.ts -v   # all new rows green
npx vitest run src/panel/sidechat.test.ts -v          # T3.S1/S2 rows still green (header edit only)
npm test                                              # FULL suite green
```

### Level 3: Seam & Guard Verification

```bash
grep -nE "sendMessage|sendUserMessage|setActiveTools|registerTool|setModel" src/panel/branch-snapshot.ts || echo CLEAN
grep -n "@earendil" src/panel/sidechat.ts || echo CLEAN
# Expected: both CLEAN — SIDECHAT-005 compatibility and the landed purity gate hold
```

### Level 4: Contract Pin (Semantics)

```bash
# The freeze-once semantics are pinned by the identity test (branch mutation after
# creation never reaches the record). Optional mutation check: temporarily add a
# re-read inside the fake's buildBranchSnapshot (call takeBranchSnapshot twice with
# mutation between) — the purity/identity rows prove the design; do NOT commit any
# mutation of production code.
npx vitest run src/panel/branch-snapshot.test.ts -t "identity"
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm test` + `npm run typecheck` green; Level 3 greps CLEAN
- [ ] branch-snapshot.ts exactly the two exports (type + function); no other file changed except sidechat.ts's header/comments

### Feature Validation

- [ ] Mixed-fixture filtering + path-order assertions pass (message/custom_message/branch_summary/compaction bear; the other five types don't)
- [ ] Null-content patch row passes; empty-branch row passes
- [ ] `Object.isFrozen` + purity rows pass
- [ ] Identity pin passes: same-question reuse → same record, builder once, no branch mutation leakage; different-question replace → rebuild

### Code Quality Validation

- [ ] Naming/placement per house conventions (kebab file, src/panel/ family, test_colocated)
- [ ] No hand-rolled entry-type filter (flatMap + helper only); no session writes; shallow freeze only
- [ ] Anti-patterns avoided (see below)

## Anti-Patterns to Avoid

- ❌ Don't put pi imports in sidechat.ts (breaks the landed purity gate) — the pipeline lives in branch-snapshot.ts
- ❌ Don't filter `entry.type === "message"` before flatMap — custom_message/branch_summary/compaction entries BEAR context (pi's own projection includes them)
- ❌ Don't switch to buildSessionContext/buildContextEntries for "compaction-awareness" — SIDECHAT-003 wants the FULL raw-path replay via getBranch
- ❌ Don't deep-freeze or mutate nested messages — shallow Object.freeze of the array only
- ❌ Don't wire the open path (onChat/openOrReplace call sites) — M2.T4.S1 owns it
- ❌ Don't hand-narrow AgentMessage types (instanceof/role checks) — convertToLlm is the sanctioned narrowing

---

**Confidence Score**: 9/10 — the pipeline is written verbatim from seam-verified facts (helper behavior read from dist JS, param type from the exported ReadonlySessionManager, narrowing precedent from compaction.ts), the placement conflict (spec module layout vs. landed purity gate) is resolved and documented, and the test matrix enumerates exact fixtures. Residual risk: T3.S2 landing in parallel shifts sidechat.ts's header text (the Mode A edit anchors on the "SIDECHAT-003 extension" paragraph by content, not line number).

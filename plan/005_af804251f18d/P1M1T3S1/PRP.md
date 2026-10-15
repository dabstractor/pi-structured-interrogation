---
name: "SIDECHAT-002 store — module-scoped singleton record with create/replace/discard lifecycle"
description: "New UI-free, ctx-free src/panel/sidechat.ts: the ONE-chat-in-memory singleton record plus get/openOrReplace/discard lifecycle. Replacement is wholesale with builder deps injected as arguments; discard is a plain in-memory delete (abort is the caller's job). Consumed by the chat view, the reset commands, the open path, and the discard hooks."
---

## Goal

**Feature Goal**: Implement SIDECHAT-002's storage primitive: a module-scoped singleton holding exactly one side-chat record `{questionId, messages, streamState, abortController, modelSnapshot, systemPrompt, branchSnapshot, usage}` with three lifecycle operations — `get()`, `openOrReplace(questionId, deps)` (same question → reuse unchanged; different → replace WHOLESALE via lazily-invoked injected builders, no confirm, no carry-over of messages/usage), and `discard()` (plain in-memory delete; aborting an in-flight stream is explicitly the caller's job, P1.M2.T5.S1). Module scope is LOAD-BEARING: the panel instance dies on suspend, so only sidechat.ts module memory makes "survives suspend, dies on restart" true with zero persistence code.

**Deliverable**: New `src/panel/sidechat.ts` (types + singleton + lifecycle + [Mode A] header doc block stating the SIDECHAT-002 singleton + ephemerality contracts) and `src/panel/sidechat.test.ts` (singleton identity, wholesale replacement with no carry-over, discard clears everything, replacement needs no confirmation, same-question reuse does not re-invoke builders).

**Success Definition**: `npm run typecheck` + full `npm test` green; the module imports NOTHING from pi (UI-free, ctx-free — trivially satisfying the M3.T1 cache-isolation banned-API guard); all four contracted behaviors proven by unit tests with fake builders; no persistence of any kind (no InterrogationState fields, no details, no custom entries, no renderer — by construction, since nothing else is touched).

## User Persona (if applicable)

**Target User**: The pi user pressing `e` to think out loud about one question with a private advisor.

**Use Case**: Open a side chat on q3, suspend the panel, resume via `/interrogate` — the chat is still there. Open a chat on q7 — the q3 chat is gone, instantly, no confirmation.

**User Journey**: `e` on q3 → record created (snapshot frozen, model bound, empty usage) → chat turns accumulate → user opens chat on q7 → wholesale replacement → q3's question is later answered/closed → the caller-side hook discards the q7 record.

**Pain Points Addressed**: One-chat-at-a-time without UI baggage; suspend/resume must not lose the chat; restart must lose it silently; no storage-layer contamination.

## Why

- SIDECHAT-002 (sidechat-contracts.md:35-47, verbatim authority): "Exactly ONE chat in extension memory … Opening on another question replaces it wholesale (no confirm, no carry-over) … Survives panel suspend/resume (module memory …); Pi restart loses it — NO session-file writes of any kind."
- Architecture constraint (panel-view-integration.md §Suspend): `done(null)` suspends; `resumeOpenPanel` rebuilds the panel INSTANCE from `lastOpts` — anything stored on the panel dies with it. Module scope is the only zero-code way to satisfy "survives suspend, dies on restart".
- Storage ruling (spec/state-and-persistence.md §Side chat, h2.51): the chat lives in NONE of the three storage layers — a pure module singleton satisfies this by construction.
- Every downstream subtask (T3.S2 reset commands, T4 builders, M2.T4.S1 open path, M2.T5.S1 discard hooks) consumes this store's API; landing it first keeps them thin.

## What

1. **New file `src/panel/sidechat.ts`** — pure module, ZERO pi imports:
   - `ChatMessage` — one chat turn: `{ role: "user" | "assistant"; text: string; at: string }` (assistant `stopReason`/usage live on the record's tally, not per-message; T5's loop owns freezing turns).
   - `ChatStreamState = "idle" | "streaming"` (start `"idle"`; T5.S2 refines if needed — keep the union open to extension by T5 without breaking this store).
   - `ChatUsage = { input: number; output: number; totalCost: number }` (zeroed at creation; T5.S3 owns accumulation into it).
   - `ModelSnapshot = { provider: string; modelId: string }` (opaque here beyond identity).
   - `BranchSnapshot` = readonly array of context messages (type it as `readonly unknown[]` or a minimal structural type — T4.S1 produces the real shape; this module only freezes and holds it).
   - `SidechatRebindDeps` — the injected builder bag (called ONLY when creating a new record): `{ resolveModelSnapshot: () => ModelSnapshot; buildSystemPrompt: () => string; buildBranchSnapshot: () => BranchSnapshot }`.
   - `SidechatRecord` — `{ questionId; messages: ChatMessage[]; streamState; abortController: AbortController; modelSnapshot; systemPrompt: string; branchSnapshot: BranchSnapshot; usage: ChatUsage }`. (SIDECHAT-002's list plus `systemPrompt`/`branchSnapshot`: the SIDECHAT-003 "snapshot NOT refreshed mid-chat" freeze must live somewhere — the record is that somewhere; document the extension in the header.)
   - `get(): SidechatRecord | undefined`.
   - `openOrReplace(questionId: string, deps: SidechatRebindDeps): SidechatRecord` — same questionId → return the existing record byte-unchanged (builders NOT invoked); different (or none) → build fresh (`streamState: "idle"`, fresh `AbortController`, zeroed usage, empty messages, builders invoked exactly once each) and replace wholesale. No confirmation parameter exists anywhere in the API.
   - `discard(): void` — `current = undefined`. NO abort call (comment: mid-stream abort is the caller's contract, P1.M2.T5.S1).
   - `resetSidechatForTests(): void` — module-scope reset for vitest beforeEach (state.ts `resetState` precedent).
   - [Mode A] header doc block: the SIDECHAT-002 contracts (one chat; wholesale replacement no-confirm/no-carry-over; survives suspend via module scope, lost on restart; lives in none of the three storage layers; discard is caller-abort) + the SIDECHAT-003 once-at-creation freeze note for systemPrompt/branchSnapshot.
2. **New file `src/panel/sidechat.test.ts`** — vitest, colocated, `beforeEach(resetSidechatForTests)`, fake builders (vi.fn returning fixed values):
   - Singleton identity: two `get()` calls return the SAME object; absent before first open.
   - Same-question reuse: `openOrReplace("q1", deps)` twice → identical record; builder vi.fns NOT called the second time; messages/usage mutated externally are preserved (reuse, not rebuild).
   - Wholesale replacement: open q1, mutate messages/usage, open q2 → fresh record (empty messages, zeroed usage, fresh AbortController, different modelSnapshot when the fake returns different values); NOTHING carried over; no throw, no confirm artifact.
   - Replacement needs no confirmation: the API has no confirm surface — assert the second open returns immediately with the new record (structural: no callback/flag consumed).
   - Discard: clears everything (`get()` → undefined); a subsequent openOrReplace builds fresh.
   - Builders called exactly once per creation (vi.fn call counts).

### Success Criteria

- [ ] `sidechat.ts` imports nothing (or only types) — no pi packages, no DOM/UI, no ctx — cache-isolation-guard-clean by construction
- [ ] Same questionId → identity-stable reuse, builders not re-invoked, record not rebuilt
- [ ] Different questionId → wholesale replacement: no message/usage/snapshot carry-over, fresh AbortController
- [ ] `discard()` clears the singleton; no abort logic in this module
- [ ] `resetSidechatForTests` seam exists and is used in the suite's beforeEach
- [ ] [Mode A] header states the SIDECHAT-002 singleton + ephemerality (+ SIDECHAT-003 freeze extension) contracts
- [ ] `npm test` + `npm run typecheck` green

## All Needed Context

### Context Completeness Check

The PRP contains the full contract quotes (SIDECHAT-002 verbatim, h2.51 storage ruling, the suspend/resume module-scope constraint), the complete derived type/l API design with rationale for the two record extensions, the test matrix, and the downstream consumer map. An agent needs this PRP alone for a greenfield single-file module — by design it depends on NO existing code beyond house conventions.

### Documentation & References

```yaml
- docfile: plan/005_af804251f18d/architecture/sidechat-contracts.md
  why: "THE verbatim authority — §SIDECHAT-002 (:35-47) record shape, wholesale-replacement rule, discard/suspend/restart semantics; §SIDECHAT-003 (:49-58) the once-at-creation snapshot freeze justifying the record's systemPrompt/branchSnapshot fields"
  section: SIDECHAT-002 singleton lifecycle

- docfile: plan/005_af804251f18d/architecture/panel-view-integration.md
  why: "§Suspend — WHY module scope is load-bearing: done(null) kills the panel instance; resumeOpenPanel rebuilds from lastOpts; the singleton must not ride the panel"
  section: Suspend/resume + non-TUI

- docfile: plan/005_af804251f18d/architecture/nested-llm-and-snapshot-seams.md
  why: "Usage/ModelSnapshot/message conventions the record types must accommodate; the injected-port testability rule (builders/ctx behind arguments, never module imports)"
  section: Branch-snapshot pipeline; Loop

- file: src/state.ts
  why: "HOUSE PATTERN — module-scoped singleton with get/reset test seam (getState/resetState); header doc-block discipline to mirror"
  pattern: "module-level `let current`, tiny API, test-only reset export"

- file: plan/005_af804251f18d/prd_snapshot.md §h2.51
  why: "the ephemeral-storage ruling verbatim (none of the three layers; exactly two exits: replacement + discard)"

- file: plan/005_af804251f18d/P1M1T2S1/PRP.md
  why: "PREDECESSOR CONTRACT (in flight): config fields sideChatModel/sideChatAutoApply — the model-resolution builder (T5.S1) reads them; this store never touches config directly"
  gotcha: "keep deps injected so config knowledge stays OUT of sidechat.ts"

- file: plan/005_af804251f18d/P1M1T3S1/research/notes.md
  why: "derived design rationale (record extensions, builder laziness, test seam) — this PRP's evidence base"
```

### Current Codebase tree (relevant slice)

```bash
src/panel/
  panel.ts        # suspend/resume machinery (why the store can't live here)
  discuss.ts      # to be DELETED in M2.T7 — do not model after it
src/state.ts      # the module-singleton house pattern to mirror
```

### Desired Codebase tree

```bash
src/panel/
  sidechat.ts         # NEW — types + singleton + get/openOrReplace/discard + test reset
  sidechat.test.ts    # NEW — the four contracted behaviors + builder call-count pins
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: module scope, NOT panel-instance field — the panel dies on suspend; only module memory survives.
// CRITICAL: builders are invoked ONLY on creation — same-question reuse must NOT re-read getBranch (SIDECHAT-003 staleness rule).
// CRITICAL: discard() does NOT call abortController.abort() — mid-stream abort ordering belongs to the caller (P1.M2.T5.S1).
// Wholesale replacement: NO fields carry over — assert empty messages + zeroed usage + fresh AbortController in tests.
// Zero pi imports — the M3.T1 static guard scans for sendMessage|sendUserMessage|setActiveTools|registerTool|setModel
// across the side-chat module set; a pure module is trivially clean.
// ESM relative imports use ".js" suffix (none expected — the module should import nothing).
// vitest 1.x; beforeEach(resetSidechatForTests) is mandatory (module state leaks across tests otherwise).
```

## Implementation Blueprint

### Data models and structure

```ts
export interface ChatMessage { role: "user" | "assistant"; text: string; at: string }
export type ChatStreamState = "idle" | "streaming";
export interface ChatUsage { input: number; output: number; totalCost: number }
export interface ModelSnapshot { provider: string; modelId: string }
export type BranchSnapshot = readonly unknown[]; // real shape lands with P1.M1.T4.S1

export interface SidechatRebindDeps {
  resolveModelSnapshot: () => ModelSnapshot;
  buildSystemPrompt: () => string;
  buildBranchSnapshot: () => BranchSnapshot;
}

export interface SidechatRecord {
  questionId: string;
  messages: ChatMessage[];
  streamState: ChatStreamState;
  abortController: AbortController;
  modelSnapshot: ModelSnapshot;
  systemPrompt: string;      // SIDECHAT-003: frozen at creation
  branchSnapshot: BranchSnapshot; // SIDECHAT-003: frozen at creation, never re-read
  usage: ChatUsage;
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: TDD — src/panel/sidechat.test.ts first
  - SETUP: beforeEach(resetSidechatForTests); fake deps = { resolveModelSnapshot: vi.fn(() => ({provider:"p", modelId: seq++})),
    buildSystemPrompt: vi.fn(() => `sys-${seq}`), buildBranchSnapshot: vi.fn(() => [{i: seq}]) }
  - CASES: absent-before-open; singleton identity; same-question reuse (builders called once total, mutated messages preserved);
    wholesale replacement (no carry-over, fresh AbortController, builder call counts = 2 each);
    no-confirm surface (open returns the new record directly); discard clears; post-discard open builds fresh
  - WATCH red (module doesn't exist / exports missing)

Task 2: CREATE src/panel/sidechat.ts
  - IMPLEMENT: types above; module-scope `let current: SidechatRecord | undefined`
  - openOrReplace: if (current?.questionId === questionId) return current; else build fresh via deps (each builder once) and assign
  - discard: current = undefined (comment: caller owns abort — P1.M2.T5.S1)
  - resetSidechatForTests export
  - [Mode A] header doc block per What §1
  - IMPORTS: none from pi; no relative imports expected

Task 3: GATES
  - RUN: npx vitest run src/panel/sidechat.test.ts -v → green
  - RUN: npm test && npm run typecheck → green
  - VERIFY: grep -n "sendMessage\|sendUserMessage\|setActiveTools\|registerTool\|setModel\|@earendil" src/panel/sidechat.ts → no matches (cache-isolation clean)
```

### Implementation Patterns & Key Details

```ts
// The whole lifecycle in miniature (mirrors state.ts's singleton discipline):
let current: SidechatRecord | undefined;

export function get(): SidechatRecord | undefined { return current; }

export function openOrReplace(questionId: string, deps: SidechatRebindDeps): SidechatRecord {
  if (current !== undefined && current.questionId === questionId) return current; // reuse: NO rebind
  current = {
    questionId,
    messages: [],
    streamState: "idle",
    abortController: new AbortController(),
    modelSnapshot: deps.resolveModelSnapshot(),   // exactly once per creation
    systemPrompt: deps.buildSystemPrompt(),
    branchSnapshot: deps.buildBranchSnapshot(),
    usage: { input: 0, output: 0, totalCost: 0 },
  };
  return current;
}

export function discard(): void { current = undefined; } // abort is the CALLER's job (SIDECHAT-002; P1.M2.T5.S1)
```

### Integration Points

```yaml
NO-WIRING-THIS-SUBTASK:
  - "nothing imports sidechat.ts yet — T3.S2 (reset commands), T4/T5 (builders), M2.T4.S1 (open path), M2.T5.S1 (discard hooks) are the consumers"
CONTRACTS-OUT:
  - "openOrReplace's deps bag is the injection seam T4.S1/T4.S2/T5.S1 implement against — keep signatures minimal and stable"
  - "ChatStreamState may be EXTENDED by T5.S2 (finer states) — never narrowed"
DO-NOT-TOUCH:
  - "no config reads (sideChatModel resolution is T5.S1's builder), no InterrogationState, no persistence, no discuss.ts"
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # clean
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/sidechat.test.ts -v   # all four contracted behaviors green
npm test                                       # full suite — no regressions (new isolated module)
```

### Level 3: Integration Testing

Not applicable — deliberate: this subtask is the pure leaf; suspend-survival is proven structurally (module scope) and exercised later by M2.T5.S2's tests. Do not build a panel harness here.

### Level 4: Creative & Domain-Specific Validation

```bash
# Cache-isolation guard pre-check (the M3.T1 scanner's banned list):
grep -nE "sendMessage|sendUserMessage|setActiveTools|registerTool|setModel|@earendil" src/panel/sidechat.ts || echo CLEAN
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean
- [ ] `npm test` fully green

### Feature Validation

- [ ] Singleton identity + same-question reuse (no rebind, builders once) proven
- [ ] Wholesale replacement (no carry-over, fresh controller) proven
- [ ] Discard clears everything; no abort in this module
- [ ] Module survives suspend BY CONSTRUCTION (module scope; no panel dependency to break)

### Code Quality Validation

- [ ] Zero pi imports; deps fully injected; UI-free and ctx-free
- [ ] state.ts singleton discipline mirrored (tiny API + test reset seam)
- [ ] Types open for T5 extension (stream states) without breaking consumers

### Documentation & Deployment

- [ ] [Mode A] header block states SIDECHAT-002 singleton + ephemerality contracts (+ the SIDECHAT-003 freeze fields)
- [ ] No new dependencies, no config changes

---

## Anti-Patterns to Avoid

- ❌ Don't store the record on the panel or the InterrogationState — suspend kills the panel; state persistence would violate the none-of-three-layers ruling
- ❌ Don't invoke builders on same-question reuse — re-reading getBranch mid-chat violates SIDECHAT-003's frozen-snapshot rule
- ❌ Don't abort in discard() — the mid-stream abort ordering belongs to the caller (P1.M2.T5.S1); doing it here double-aborts or aborts the wrong controller after replacement
- ❌ Don't add confirmation/plumbing for replacement — SIDECHAT-002 says no confirm, ever; the API must not even have the surface
- ❌ Don't import pi packages "for the types" — re-declare minimal structural types or use injected generics; the static guard and the port-injection rule both depend on purity
- ❌ Don't persist anything "for convenience" — no custom entries, no details, no renderer hooks; restart-loss is the contract

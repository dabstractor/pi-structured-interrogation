# Research — P1.M1.T3.S1 (sidechat.ts module-scoped singleton store)

## Contract sources (verbatim authority)
- `plan/005_af804251f18d/architecture/sidechat-contracts.md` §SIDECHAT-002 (:35-47):
  - Exactly ONE chat in extension memory: `{questionId, messages, streamState, abortController, modelSnapshot, usage}`.
  - Opening on another question replaces it WHOLESALE (no confirm, no carry-over).
  - Discards when its question is answered/closed by ANY path; mid-stream close aborts then discards (ABORT IS THE CALLER'S JOB — P1.M2.T5.S1; this store's discard is a plain in-memory delete).
  - Survives panel suspend/resume (module memory); pi restart loses it — NO session-file writes, no InterrogationState fields, no details, no custom entries, no renderer.
- `plan/005_af804251f18d/architecture/panel-view-integration.md` §Suspend: panel INSTANCE dies on suspend (`done(null)`; host record panel.ts ~:1830-1850); `resumeOpenPanel` rebuilds from `lastOpts`. → the singleton MUST live in sidechat.ts MODULE scope, never on the panel instance.
- `prd_snapshot.md` §h2.51 Side chat (ephemeral): "lives in NONE of the three storage layers … exactly two exits: replacement (opening a chat on another question) and discard". Note h2.51 names TWO exits; /clear & /new are byte-exact first-token RESETS (view stays open) — that's P1.M1.T3.S2's command, NOT a store concern beyond what discard covers.
- `plan/005_af804251f18d/architecture/nested-llm-and-snapshot-seams.md`:
  - Usage type (pi-ai types.d.ts:265-283): `Usage = { input, output, cacheRead, cacheWrite, …, cost: { input, output, cacheRead, cacheWrite, total } }` — the store's `usage` is an ACCUMULATED Usage-like tally (per-chat, T5.S3 owns accumulation math; store just holds it).
  - Snapshot frozen ONCE at chat creation; turns appended after it; array rebuilt per turn — `modelSnapshot` + messages live on the record.
  - Unit-testability: model-call seam injected as a port; ctx usage behind the same port bag → this store must be UI-free and ctx-free; builders injected as ARGUMENTS (item contract).

## Design derived
- New file `src/panel/sidechat.ts`. Module-soped `let current: SidechatRecord | undefined` — the state.ts singleton precedent (getState/setState/resetState) is the codebase pattern; but here mutation is via openOrReplace/discard only (no raw setState seam; export a test-only reset following house test conventions).
- `SidechatRecord`:
  ```ts
  interface SidechatRecord {
    questionId: string;
    messages: ChatMessage[];        // user/assistant turns only; snapshot is separate
    streamState: ChatStreamState;   // "idle" | "streaming" (T5 owns finer states; start "idle")
    abortController: AbortController;
    modelSnapshot: ModelSnapshot;    // {provider, modelId} — opaque to this module (typed generically)
    usage: ChatUsage;                // starts zeroed; T5.S3 accumulates
  }
  ```
  Keep `modelSnapshot`/`usage` structurally minimal but opaque: this module only creates/replaces/deletes them via injected builders — define narrow local types (e.g. `ModelSnapshot = { provider: string; modelId: string }`, `ChatUsage = { input: number; output: number; totalCost: number }`) OR accept them as generics/injected-builder return values; the item contract says builders come from T4.S1/T4.S2/T5.S1 and are INJECTED, so this subtask defines the parameter TYPE, not the builder implementations.
- `openOrReplace(questionId, deps)`:
  - deps (all lazy, called ONLY when creating a NEW record — same question reuses and does NOT rebind):
    - `resolveModelSnapshot: () => ModelSnapshot` (T5.S1)
    - `buildSystemPrompt: () => string` — wait: the record shape per SIDECHAT-002 has NO prompt field. Rebind = "snapshot/prompt/model" per item description. The system prompt and branch snapshot are rebuilt per turn by the T5 loop from modelSnapshot + frozen snapshot. To keep the record exactly as contracted ({questionId, messages, streamState, abortController, modelSnapshot, usage}) while honoring "rebinds snapshot/prompt/model", either (a) add non-contracted fields `systemPrompt`/`branchSnapshot` (justified: SIDECHAT-002's list is described as the minimum; the snapshot MUST be frozen once at creation per SIDECHAT-003) or (b) treat builders as returns stored in extended fields. RECOMMEND (a): extend the record with `systemPrompt: string` and `branchSnapshot: ContextMessage[]` (frozen once), documented as the SIDECHAT-003 once-at-creation freeze; messages stay pure turns. This keeps "never re-read getBranch mid-chat" structurally true.
  - Same questionId → return existing record unchanged (identity-stable).
  - Different questionId → build fresh via deps, replace wholesale. No confirmation flag exists at all.
- `discard()`: `current = undefined` (plain delete; no abort — callers own it).
- `get(): SidechatRecord | undefined`.
- Test seam: `resetSidechatForTests()` (module-scope reset, mirroring state.ts resetState discipline) — vitest beforeEach.

## Consumers (per item contract)
- P1.M1.T3.S2 (/clear, /new) — discard-messages + rebind via the same builder deps.
- P1.M1.T4.S1/S2 — provide buildSnapshot/buildSystemPrompt implementations injected here.
- P1.M2.T4.S1 — panel onChat action calls openOrReplace.
- P1.M2.T5.S1 — discard hooks (with abort before calling discard).
- M3.T1 cache-isolation static guard: sidechat.ts must never import sendMessage/sendUserMessage/setActiveTools/registerTool/setModel — this module imports NOTHING from pi (pure, UI/ctx-free), which trivially satisfies the guard.

## Conventions
- Header doc block stating contracts (state.ts/config.ts precedent — dense Mode A headers).
- ESM `.js` relative imports; vitest colocated src/panel/sidechat.test.ts.
- Pure module: no EventEmitter needed (no events contracted; view polls).

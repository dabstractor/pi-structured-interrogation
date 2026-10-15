# System context — plan 005 (per-question side chat, SIDECHAT-001…005)

Repo: `pi-structured-interrogator` (a pi coding-agent extension) at HEAD `d18bc39`
("Spec sync: per-question side-channel chat replaces discuss-in-chat"). Spec in `spec/` is ALREADY
SYNCED to the target state — this changeset is SOURCE-ONLY. Prior plan 004 (keymap trilogy) is
Complete; its architecture notes (`plan/004_49e25d5235a9/architecture/`) remain useful for the
rename slice but pre-date HEAD line numbers and the silent-alias mechanism.

## What exists today (verified at HEAD)

- `src/panel/discuss.ts` (119 lines) + `src/panel/discuss.test.ts` (583 lines) — the OLD
  discuss-in-chat handoff (suspend + `pi.ui.setEditorText` preload). Still live, still wired.
- `src/config.ts` — `KeyAction` includes `"discuss"` (:54); `KEY_ACTIONS` (:91–101);
  `DEFAULT_CONFIG.keys.discuss: "e"` (:114); focusText→elaborate silent alias in `coerceKeys`
  (:194–205) is the precedent to copy.
- `src/panel/keys.ts` — `RoutedActions.onDiscuss` (:144–146), default stub (:372–377),
  bare-tier table `discuss: isBareBinding(b.discuss)` (:414), dispatch arm (:558–561).
- `src/panel/panel.ts` — `PanelView = "short" | "deep" | "overview"` (:108); host-side
  `routed.onDiscuss` refinement calling `discussInChat(pi, p)` (:652–661); ONE `TextField`
  per panel instance (:615–629); non-TUI guard `pi.mode !== "tui"` → `return false` (:1861).
- `src/compaction.ts` — the nested-call precedent: `resolveModel(ctx) = ctx.model ??
  ctx.modelRegistry.getAvailable()[0]` (:123–126), `ctx.modelRegistry.complete(model, {messages},
  {maxTokens, signal, cacheRetention:"none", sessionId: uuidv7()})` (:172–175), usage off the
  result (:187–191), try/catch → `console.error` + `return undefined` (:193–197).
- NO `sideChat`/`sidechat`/`chat-view` code exists anywhere in `src/` — clean namespace.

## Feasibility verdict

The PRD is implementable as specified. Four PRD-vs-reality corrections (verified in node_modules):

1. **Package name.** The installed package is `@earendil-works/pi-coding-agent` (with
   `@earendil-works/pi-ai`, `pi-agent-core`, `pi-tui` as siblings). There is NO
   `@earendil-works/pi-agent`. `sessionEntryToContextMessages` IS exported — from
   `@earendil-works/pi-coding-agent` (`dist/index.d.ts:19`). All imports must use the real name.
2. **`streamSimple` is NOT on `ModelRegistry`.** The registry exposes `complete` (plus `find`,
   `hasConfiguredAuth`, `getAvailable`, `getProviderAuthStatus`). Streaming lives in
   `@earendil-works/pi-ai` (`dist/compat.d.ts:65`):
   `streamSimple<TApi>(model, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream`.
   The spec's "`ctx.modelRegistry.complete/streamSimple`" means *nested model calls only* — satisfy
   it with `modelRegistry.complete` (non-streaming) and/or pi-ai `streamSimple(model, …)`; both are
   nested calls that never touch the session. Streaming is preferred (ui-spec requires a streaming
   cursor); `complete` is the proven fallback.
3. **`setEditorText` does NOT die with discuss.** `src/panel/editor-preservation.ts:99` still
   consumes `pi.ui.setEditorText` (main-editor text preservation across suspend). Only discuss.ts's
   consumer is deleted; the seam declaration at `panel.ts:229` and the editor-preservation consumer
   STAY (reword the "ONLY sanctioned writer" JSDoc at :224–225).
4. **Config count string.** The rename keeps 9 keys (not 10 as the delta PRD's R1.3 summary says);
   the loadConfig JSDoc count at `config.ts:263` must state the true final surface: 9 keys + 3
   toggles (`gateWarnings`, `roundDetection`, `compactionPreservation`) + `editorMode` +
   `escExitWindowMs` + `sideChatModel` + `sideChatAutoApply`.

## Shape of the change (mirrors spec implementation-plan M10 + PRD §6)

- **M1 engine + config (UI-free, unit-testable):** rename+alias+2 config fields; `src/panel/sidechat.ts`
  (module-memory singleton store, one-shot branch snapshot, system-prompt builder, nested loop with
  abort, ` ```answer ` parser, usage tally).
- **M2 view + integration + deletion:** `src/panel/chat-view.ts`, `PanelView "chat"`, open/replace/
  discard hooks, esc ladder, second editor, apply-through-ordinary-seams, delete discuss end-to-end.
- **M3 guards + ACs + docs:** cache-isolation static guard (no-hardcoded-keys clone), AC-17 scripted
  coverage, suite gates, README + keymap-conflict re-verification record.

## Cross-cutting invariants (binding)

- SIDECHAT-005: side-chat modules never call `sendMessage`/`sendUserMessage`/`setActiveTools`/
  `registerTool`/`setModel`; enforced by a static guard (see guards-and-docs notes).
- SIDECHAT-004: provenance indistinguishable — apply routes through `acceptOptionIndex` / write-in
  commit seams (`src/panel/actions.ts:268–331`, `:384–518`); no code path marks an answer
  chat-derived anywhere model-facing.
- SIDECHAT-002: singleton in MODULE memory (`sidechat.ts` module scope) — NOT panel-instance state,
  because suspend kills the panel instance and `resumeOpenPanel` builds a fresh one; module scope is
  what makes "survives suspend, dies on restart" true for free.
- Docs Mode A ride with the work (config.ts JSDoc, keys.ts module docs, header doc blocks, alias
  comment); Mode B (README sweep) is the final task.

## Architecture notes index

| File | Contents |
| --- | --- |
| `sidechat-contracts.md` | Verbatim authority digest of every SIDECHAT contract (spec sections table) |
| `config-and-keys-rename.md` | Rename touchpoint inventory, alias mechanism, new-config recipe |
| `nested-llm-and-snapshot-seams.md` | Exact pi-coding-agent/pi-ai signatures, snapshot pipeline, usage shape |
| `panel-view-integration.md` | Add-a-view recipe, second editor, discard hooks, esc ladder, suspend |
| `guards-tests-and-docs-surface.md` | Guard-scanner clone recipe, discuss test inventory, README anchors |

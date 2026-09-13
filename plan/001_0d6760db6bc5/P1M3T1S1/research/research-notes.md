# Research — P1.M3.T1.S1: custom() host (fire-and-forget, view switching, done(null) suspend)

## Verified codebase facts

- `src/lifecycle.ts` exports `Lifecycle` interface with `onPanelDismiss(cb)`, `dismissPanel()`, `noteSubmissionDelivered()`, `runClosePass()`, `dispose()`. `dismissPanel()` fires a single callback slot, "no-op until M3 wires a panel" — this PRP is the consumer that registers itself.
- Lifecycle detects upserts via `tool_execution_start/end` events (toolCallId correlation), NOT via state events. But `InterrogationState` (src/state.ts) emits typed events: `changed: [SerializedState]`, `questions-upserted: [ids]`, `epoch-bumped`, `completed-cleared` (positional tuple types, declaration-merged onto EventEmitter).
- `src/index.ts` factory currently: loadConfig → registerCommand ping → registerTool → `createLifecycle(pi)`. Panel host wiring goes here.
- Singleton access: `getState()` / `setState()` from `state.ts`.
- Vitest is the test framework (`*.test.ts` next to source, `npm test`, `npm run typecheck`).

## pi API facts (from architecture/pi-api-validation.md + system-context.md + reference-patterns.md)

- `ctx.ui.custom<T>(factory: (tui, theme, keybindings, done: (result: T) => void) => Component & { dispose?() }, options?)` — BLOCKS until done() is called. Non-overlay (default) replaces the bottom editor region; transcript stays visible. Overlay mode NOT used. In RPC mode returns undefined → guard `ctx.mode === "tui"`.
- Fire-and-forget resolution (system-context.md): call custom() without awaiting, store floating promise, `.then/.catch` on resolution. Only `await ctx.ui.custom` INSIDE a tool execute is forbidden.
- Component contract: `{ render(width): string[], invalidate(): void, handleInput(data): void, dispose?(): void }`. Cache rendered lines; call `tui.requestRender()` on change.
- Reference component: questionnaire.ts:131-137 (closure factory); todo.ts `TodoListComponent` (class alternative, constructor takes `(todos, theme, onClose)`).
- `question.ts` uses `custom<... | null>` and `done(null)` for cancel — precedent for the suspend contract.
- Panel owns raw keyboard focus; app keybindings do not fire while custom() component is active.

## Upstream/downstream contracts

- Upstream inputs: state events (`questions-upserted`, `changed`) from M1.T2.S1; lifecycle hooks (`onPanelDismiss`, `dismissPanel`) from M2.T2.
- Downstream consumers: P1.M3.T1.S2 (header/question-line/footer rendering with config labels), P1.M3.T3.S1 (keys.ts dispatch — leave a `KeyHandler` seam), P1.M4.T2.S1 (DraftStore — accept an interface param now), M6 (suspend/resume widget uses suspendPanel), M7.T1.S2 (reconstruction auto-open reuses openPanel).
- h2.37: model upsert while suspended → panel REOPENS (openPanel must be callable when a panel is already conceptually suspended and must be idempotent-ish: not double-open).

## Key spec excerpts applied

- h2.35: suspend = done(null); state + drafts held in extension memory; main editor text preserved.
- h2.29: views = short | deep | overview; deep sticky per panel session; overview full-screen-in-panel.
- Commitment 1 (h2.0): panel persists while idle.

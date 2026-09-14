# Test Infrastructure — pi-structured-interrogation

## Setup
- **vitest.config.ts** (`/home/dustin/projects/pi-structured-interrogation/vitest.config.ts`): minimal — `defineConfig({ test: { passWithNoTests: true } })`. No aliases, no setup files, default node environment, colocated `*.test.ts`.
- **package.json scripts**: `"test": "vitest run"`, `"typecheck": "tsc --noEmit"`. Dev deps: vitest ^1, typescript ^5, typebox 1.3.7, @earendil-works pi-ai / pi-coding-agent / pi-tui ~0.85.x, @types/node ^22. ESM (`"type": "module"`), Node >=22.19.0.
- **tsconfig.json**: `strict: true`, target es2022, module esnext, moduleResolution bundler, noEmit, skipLibCheck, esModuleInterop, `include: ["src/**/*"]` (tests typechecked too).
- **Test file count**: **43 test files** (13 under `src/panel/`, 30 in `src/`).

## Baseline (RUN, must stay green)
- `npm run typecheck` → **PASS** (exit 0, no errors).
- `npm test` → **43 files passed, 930 tests passed, 0 failed**, ~3.6s duration (wall ~4s).

## Dominant patterns

### 1. Fake TUI host for panel tests (`src/panel/panel.test.ts`, lines ~70–140; same `MockPi`/`makeMockPi` pattern)
Bare mock stands in for the pi runtime — no runtime started. Handlers captured by event name into a `Map`, `ui.custom` is a `vi.fn` that invokes the factory with a stub TUI (`{ requestRender }`), a stub theme (`{ fg: (_n,s)=>s, bold: s=>s } as unknown as Theme`), empty keybindings, and a `done` callback resolving a floating promise that only resolves when `done()` is called (the blocking contract). Component methods then driven directly; `flush()` helper = `setTimeout(resolve, 0)` to drain microtasks. Panel host is module-scoped, so every test re-arms `createPanelHost(...)` first (see header comment, lines 1–15). Module boundaries mocked with `vi.mock("../external-editor.js", ...)`.

### 2. Non-TUI/fallback tests (`src/fallback.test.ts`)
No pi mock at all — direct pure-function testing of `buildFallbackDigest`, `recordAnswers`, `isNonTui` against real `InterrogationState` objects built with `createInterrogationState` + `state.upsertQuestion({ id, prompt, type, rev: 1, status: "open", ... })` and `state.setStatus(id, "withdrawn")`. Assertions are byte-exact on digest text and on epoch/snapshot side effects.

### 3. Tool tests (`src/tool.test.ts`)
`executeInterrogate` driven directly with a minimal `ExecutorContext` stub (lines ~76–85):
```ts
function tuiCtx(): ExecutorContext {
  return { mode: "tui", hasUI: true, model: { contextWindow: 200_000 } };
}
function printCtx(): ExecutorContext {
  return { mode: "print", hasUI: false, model: { contextWindow: 200_000 } };
}
```
State seeded via `setState(createInterrogationState(goal))` after `resetState()` in `beforeEach`; results asserted via `buildReadResult` output and state side effects (epoch/rev/events). Render hooks called directly with the stub theme and asserted against `Box`/`Text` trees.

### 4. Delivery/completion tests (`src/delivery.test.ts`, `src/completion.test.ts`)
`buildSubmission(state, diff, note?)` tested as a pure function returning a `SubmissionMessage` with `customType: "interrogation-submission"`; diffs via `computeDiff(prev, next)`. Transport half (`deliverSubmission`) tested with a minimal `makeMockPi()`:
```ts
const sendMessage = vi.fn((_msg: unknown, _options?: Record<string, unknown>): void => {});
return { pi: { sendMessage } as unknown as Pick<ExtensionAPI, "sendMessage">, sendMessage };
```
Assertions read the captured message via a `sentMessage(pi)` accessor and delivery options via `sentOptions(pi)`.

## Shared utilities
- **No shared test helper files** — there is no `src/test-utils.ts` etc. Instead, idioms are copy-propagated: `MockPi`/`makeMockPi` (10 files: lifecycle, completion, panel, suspend, discuss, ac-panel, persistence, reconstruct, compaction, detect), the stub theme, `flush()`, `choiceQ()`/`q()`/`qi()` fixture builders, `OPTS_AB`. Comments explicitly say "follows fallback.test.ts mock conventions" / "caps.test.ts pattern".
- Tests assert on: returned tool results (`buildReadResult`), state (epoch/rev/events via the real `InterrogationState` primitives), captured mock calls (`expect(...).toHaveBeenCalledWith`, message accessors), and rendered `Box`/`Text` trees.

## scripts/
Only one file: **`scripts/verify-keymap-conflicts.sh`** (bash, not a tsx probe). It greps `DEFAULT_CONFIG.keys` in src/config.ts against an AVOIDED list and a live grep of `pi.registerShortcut("` across installed extension trees; built-in collisions are INFO-only; exit 1 on genuine collision. **No tsx probe pattern exists** — if the plan calls for probes, they'd be new (`tsx` is not even a devDependency; tests would be the cheaper vehicle).

## Constraints/risks for the fix
- `strict: true` + tests in tsconfig means any type looseness in a fix fails typecheck.
- `passWithNoTests: true` — accidental test-file deletion won't fail the suite; the 930 count is the real guard.
- Panel host is a module-scoped singleton → test isolation depends on re-arming `createPanelHost` / `resetState` in each test; fixes touching state must respect `beforeEach` resets.

# Repo conventions map — testing, docs, spec, wiring, git state

Repo: /home/dustin/projects/pi-structured-interrogation (pi-interrogator). HEAD `613437d`.

## 1. Test conventions

- **Runner:** vitest. `vitest.config.ts` is minimal (`passWithNoTests: true`). `npm test` = `vitest run` (currently 1224 tests); `npm run typecheck` = `tsc --noEmit` (package.json:30-33). No lint script.
- **Style:** vitest `describe`/`test` (not `it`); heavy block comments at file top explaining conventions; fixtures built inline per test file (no shared test-utils dir); AUTOMATION-POLICY: no live pi session — everything through stubs/mocks/fakes.
- **Panel harness pattern** (`src/panel/actions.test.ts:1-120`, the canonical example):
  - `stubTheme` (lines 29-33): identity `Theme` stub (`fg`/`bold` identity fns).
  - `choiceQ(id, overrides)` (38-50): question factory.
  - `seed(specs)` (56-73): real `createInterrogationState` + `upsertQuestion` (new ids forced "open"), then applyAnswer/setStatus for non-open states.
  - `makePanel(state, extra?, config?)` (88-105): `new InterrogationPanel({tui: {requestRender: vi.fn()}, theme: stubTheme, done, state, config, ...})` — panels constructed directly, NOT via openPanel; `dispose()` where flash timers arm.
  - `makeDeps(isIdle)` (108-112): `{deps: {sendMessage: vi.fn(), isIdle}, sendMessage}` — submit path asserted via snapshot ring + epoch + mocked sendMessage.
- **Bridge harness pattern** (`src/remote-bridge.test.ts:21-75`): `FakeBus` class (handlers map + emitted log + `of(event)` filter), `makePi(bus)` ({events: bus, sendMessage capture}), `makeBridge(config)` injecting a counting `lifecycle.noteSubmissionDelivered`; state seeded through `setState()` (state.ts singleton) or `RemoteBridgeOptions.getState`.
- **scripts/ dir:** `scripts/remote-rpc-itest.mjs` (live RPC itest) and `scripts/verify-keymap-conflicts.sh`. NO validate.sh / check.sh — the verification loop is `npm test && npm run typecheck` (README §Development, line 289ff).

## 2. README.md structure (headings + doc-sync targets)

Headings: `# pi-interrogator` (1) · `## Install` (11) · `## Usage` (30) · `## Configuration` (115) · `## Keymap` (168) · `### Subcommands (one command, no autocomplete noise)` (225) · `## Acceptance criteria (spec)` (241) · `## Limitations` (268) · `## Development` (289) · `### Keymap conflict re-verification` (309) · `## Project structure` (380).

Doc-sync passages (quote targets):
- **Gate-hold ⚠ line** — README:52-54: "While a foundational gate question is unanswered, auto-submit holds: commits show `⚠ {n} foundational unanswered — answer them or {submit} to submit now` (any key dismisses it), and `ctrl+s` is the deliberate override." Also AC 2d at README:253.
- **Draft sacredness / R4** — README:66-68: "a submission … flushes only the answers that actually shipped — drafts of questions [survive]"; README:212 ("switching questions while typing saves the [draft]"); README:254-255 (AC 3/4 "re-asks preserve drafts", "drafts intact").
- **AC-13 '(changed)' marker** — README:262 (AC 13): "Editing an archived answer re-marks it pending; next diff card highlights the change." (the `(changed)` string itself lives in spec/ui-spec.md:129, not README).
- **Write-in ✎ markers** — README:36 ("the `✎ Other` row is [never digit-selectable]"), 43-44 ("on the `✎ Other — write your own` row (and on `type:"text"` questions) it is the **write-in** duty"), 47, 176, 188, 198-204 ("synthetic `✎ Other — write your own` row … renders it as `✎ {text}`"), 250 (AC 2a).
- **Submission delta shape** — README:55-57: "Each submit streams a compact delta message to the model (rendered as a diff card in your transcript), ending with `(state epoch {n})`". (The "~2 lines" sizing lives in spec FR-3a, product-requirements.md:27; README says only "compact delta".)
- **Bridge submit acks** — README does NOT document them (bridge appears only at README:408-409, Project structure). No README sync needed for BUG-007.
Total README doc-sync targets across the 8-bug changeset: ~8 passages (gate-hold ×2 spots, drafts ×4, AC-13 ×1, write-ins ×7, delta shape ×1).

## 3. spec/ directory — living docs

`git log --oneline -5 -- spec/` shows spec commits riding WITH code fixes (`60826a2 Spec: pin write-in…`, `8c4c62c Spec: record itest deadlocks…`, `f1a8e31 Fix two completion deadlocks…`, `b836c7d Spec: revise remote surface…`): **spec/ is a living source of truth — behavior fixes DO update it** (same commit or follow-up "Spec:" commit). Files: architecture.md, decisions.md, implementation-plan.md, product-requirements.md, SPEC.md, state-and-persistence.md, tool-protocol.md, ui-spec.md.

Section map (exact lines):
- FR-3 / AC-2d (gate hold): `spec/product-requirements.md:27` (FR-3 incl. AUTOSUBMIT-002 gate-hold sentence); README:253 (AC 2d). FR-2 (edit freely) at product-requirements.md:26.
- R4 / ESC-002 (drafts): `spec/decisions.md:27` (hard reqs R1-R5), `decisions.md:13` (ESC-002); `spec/ui-spec.md:56,62,63,65` (draft role, exit gestures, buffer scoping, R4 preservation); `spec/state-and-persistence.md:126,130` (drafts lifecycle).
- AC-13 / FR-2 ('(changed)' marker): `spec/product-requirements.md:91` (AC-13: "highlights the change (`Q3: sqlite → postgres (changed)`)"); `(changed)` render shape at `spec/ui-spec.md:129`.
- FR-12 (write-in duty / cursor-follow): `spec/product-requirements.md:38` (long FR-12 paragraph).
- AC-2 / FR-3 (delta ~2-line): `spec/product-requirements.md:27` ("~2 lines + reminder line").
- FR-32 / D-R5 / D-R6 (bridge acks): `spec/product-requirements.md:66` (FR-32), `spec/decisions.md:40-41` (D-R5, D-R6), `spec/architecture.md:149-162` (§Bridge submit pipeline), `spec/ui-spec.md:39` (bridge mapping).
- AC-2c (text enter / auto-submit): README:252 (AC 2c); text-enter-commit semantics in `spec/ui-spec.md:58`.
- AC-15/SURFACE-001, AC-9 (restart) live in product-requirements.md acceptance list (~lines 75-95) — recently rewritten per git log ("AC-9 rewritten", "AC-15 scripted").

## 4. Extension wiring (src/index.ts, 303 lines)

Factory `interrogatorExtension(pi)`: `loadConfig` → `createLifecycle` (subscribes tool_execution_start/end + agent_settled close pass, h2.44; `onCompleted: () => remoteBridge.completeAll()`) → **`createRemoteBridge(pi, {config, lifecycle, maybeAutoSubmit: () => maybeAutoSubmit(panelHost.getPanel())})`** (index.ts:99-107, created BEFORE tool wiring) → `createRoundDetector` → `createStateMirror(pi)` + `pi.on("session_shutdown", … mirror.flush(); remoteBridge.dispose())` (~line 122) → `pi.on("tool_execution_start"/"tool_execution_end")` interrogate upsert hooks → `emitFlow(state, "tool")` at end phase (after rule-1 flip; RPC deadlock #2 comment) → `pi.registerTool(createInterrogateTool(...))` with `onLiveQuestions`/`onReopen`/`onAnswersRecorded` hooks → card renderers → `registerInterrogateCommand`. The events bus is `pi.events` (structural `EventBus` interface in remote-bridge.ts:217-220); agent_settled close pass hooks in via `createLifecycle` (h2.44) with `onCompleted` completing bridge flows.

## 5. Git state

HEAD `613437d` (bug report commit) on top of `abe5103  Reload pins go silent…`, `782e2fe  Restart rows flip to widget-only…`, `68da1a0  Session-start never opens…`, `ef872ae  Tree-nav read tests pin no-open…`. Working tree: tracked files CLEAN; only untracked `plan/002_949db554a811/…` planning artifacts (this changeset's plan/ dir — expected, do not commit as part of fixes unless the changeset says so). Fix tasks start from a known HEAD.

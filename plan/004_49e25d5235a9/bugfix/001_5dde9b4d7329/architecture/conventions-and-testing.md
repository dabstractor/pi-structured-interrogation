# Repo conventions & test infrastructure — pi-interrogator

Reference map for the BUG-001 fix (plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329). Researched 2026-10; repo state = commit `16d9f65`.

## (a) Build / test / typecheck commands

| Command | What it does |
|---|---|
| `npm test` | `vitest run` (single pass, no watch). 47 test files currently. |
| `npm run typecheck` | `tsc --noEmit`. |

- **No linter/formatter exists** — no eslint/prettier/biome config anywhere; prior `validate.sh` phases state this explicitly (plan/002_949db554a811/bugfix/001_c0ff03282c6f/validate.sh: "No linter/formatter configs exist in this repo… intentionally absent"). Style is enforced by convention/review only.
- `vitest.config.ts` is minimal: only `test.passWithNoTests: true`; default include → co-located `*.test.ts` anywhere under root, in practice all under `src/`.
- `tsconfig.json`: `strict: true`, target es2022, module esnext + `moduleResolution: bundler`, `noEmit: true`, `include: ["src/**/*"]`, `types: ["node"]`.
- `package.json`: `"type": "module"`, engines node ≥22.19.0, peerDeps `@earendil-works/pi-coding-agent` + `typebox`. Imports use `.js` specifiers from TS. Extension entry `./src/index.ts` under the `pi.extensions` key.
- Prior plans run validation via their own `validate.sh` (typecheck + vitest + a runtime-materialized E2E journey file `.validate-e2e.tmp.test.ts`) and record results in `validation_report.md` / `validation_result.json` / `TEST_RESULTS.md`.

## (b) Test conventions & fixture patterns

- **Layout**: 47 test files (`find src -name '*.test.ts' | wc -l` → 47), co-located next to the module under test: `src/*.test.ts` (34) and `src/panel/*.test.ts` (13). Notable: regression tests live at src root with descriptive names (`regression-phantom-submissions.test.ts`, `regression-reask-roundtrip.test.ts`, `tree-nav-repro.test.ts`).
- **Header doc comments** cite the owning plan task ID and convention lineage, e.g. src/panel/keys.test.ts:1-13 ("config-driven key dispatch tests (P1.M3.T3.S1)… Conventions follow panel.test.ts / actions.test.ts").
- **AUTOMATION-POLICY** (recurring house rule, stated in headers): all behavior asserted in vitest with fakes; never a live pi session. Real modules where cheap (state, key router), narrow structural fakes where a real one is heavy (TUI, Theme, ExtensionAPI).
- **Fixture patterns** (no shared harness file — helpers are re-declared per test file, deliberately):
  - `makePanel()` — src/panel/keys.test.ts:63: a plain object exposing exactly the router-visible surface (`view`, `focus`, `deepSticky`, `setView`, `suspend`, `isResolved` with REAL transition semantics), typed as `PanelStub extends InterrogationPanel`. A richer constructor-based variant at src/panel/actions.test.ts:108.
  - `seed()` + `choiceQ()` — src/panel/actions.test.ts:64,82: build REAL `createInterrogationState("goal")` and seed via the raw primitive `upsertQuestion` (which forces new ids to status `"open"`), then apply non-open statuses *after* the upsert through `applyAnswer`/`setStatus` — the documented state.ts raw-primitive contract.
  - `stubTheme` — src/panel/actions.test.ts:54 and panel.test.ts:66: identity theme stub (`fg: (_n, s) => s`, `bold: s => s`) cast `as unknown as Theme` so renderers run.
  - Raw terminal bytes: keys.test.ts:33-49 maps every `KeyAction` to its raw escape-sequence data (`"d"`, `"\u0013"` ctrl+s…) and round-trips through the REAL `matchesKey` from `@earendil-works/pi-tui` so fixture drift fails loudly.
  - `T0` frozen timestamp — src/panel/actions.test.ts:51 (`"2025-01-01T00:00:00.000Z"`).
  - Module-level mocks: src/external-editor.test.ts:18-22 — `const { spawnMock } = vi.hoisted(...)` + `vi.mock("node:child_process", ...)`; `node:fs`/`os`/`path` stay REAL so the temp-dir lifecycle is asserted against the actual filesystem.
  - Submit-path assertions go through the snapshot ring + epoch + a mocked `sendMessage` (debug-commands.test.ts precedent); ripple seams use typed `seamMock(result)` vi.fn mocks (actions.test.ts:97).
- Style: `describe`/`test` (some files `it`), `vi.fn` spies with typed signatures, `afterEach` cleanup, `Mock` type imported from vitest. Panels are constructed directly (not via `openPanel`) so each scenario owns its instance; `dispose()` called where flash timers arm.

## (c) Spec suite map + owner-ruling format

`spec/SPEC.md` is the index and owns the 8 numbered **Core commitments** (non-blocking tool, pull-based state, deliberate surfacing, commit-everything-up-front, rev/epoch guards, drafts-are-sacred + auto-submit, configurable hotkeys w/ fixed-family exception, ANSWER-PIN-001 answer sanctity) plus naming/strings and non-goals. Its **Deliverable files** table assigns ownership:

| Doc | Owns |
|---|---|
| product-requirements.md | PRD: goals, FRs, UX flows, acceptance criteria, non-goals |
| architecture.md | Components, module layout, event/message flows, config surface |
| tool-protocol.md | `interrogate` schema, actions, guards, agent-facing text, caps (→ "No caps"), fallbacks |
| ui-spec.md | Panel layout, screens, hotkey table, editor embedding, renderers, terminal fallbacks |
| state-and-persistence.md | State machine, rev/epoch semantics, storage, reconstruction, compaction |
| implementation-plan.md | Build order, file-by-file checklist, test plan, risks |
| decisions.md | Decision ledger — authoritative dispositions |

**Owner-ruling format (spec/decisions.md)** — decisions.md is the canonical ledger ("decisions below are authoritative"), and it IS the right place for the BUG-001 restore-vs-amend adjudication. Recorded shape:

- Dated section header per interrogation session: `## YYYY-MM-DD interrogation — short topic (RULING-ID / RULING-ID)` — e.g. `## 2026-10-12 interrogation — vim navigation, bare-key defaults, digit quick-select removed (VIMNAV-001 / BAREKEYS-001 / DIGIT-OUT-001)`.
- Under it, one bullet per ruling: `- ID-NNN — <ruling prose>` where ID is CAPS-HYPHEN-NNN. Elements a strong ruling includes: the owner report / live experience that motivated it (owner's words quoted **verbatim** — e.g. CAPS-OUT-001: `Owner ruling (2026-10-08, verbatim): "I NEVER ASKED FOR LIMITS ON ANYTHING…"`), numbered sub-rulings (1)(2)(3), what it SUPERSEDES/amends (CAPS-OUT-001 supersedes DEEP-FULL-001's compromise and h2.23; DIGIT-OUT-001 supersedes every digit-accept reference), rationale, cross-references to PRD sections and test files, and "unchanged" clauses protecting adjacent behavior.
- Amendments to an existing ruling get their own dated section naming the original ID — precedent: `## 2026-10-05 interrogation — answer pinning re-ask amendment (ANSWER-PIN-001)` (itself a BUG-001-class spec-vs-implementation conflict resolution, citing "BUG-001, PRD h2.1/h3.0"). A new BUG-001 ruling should follow exactly this pattern.

## (d) README structure (for changeset-level doc sync)

`grep '^#' README.md`: `# pi-interrogator` → `## Install` → `## Usage` → `## Configuration` → `## Keymap` (incl. `### Subcommands (one command, no autocomplete noise)`) → `## Acceptance criteria (spec)` → `## Limitations` → `## Development` (incl. `### Keymap conflict re-verification`) → `## Project structure`. The README was last swept to the landed keymap contract (commit `7aca309`) — a behavior change touching hotkeys, config, or model-visible behavior needs the matching section updated in the same wave.

## (e) Prior plan/ structure

- `plan/002_949db554a811/bugfix/001_c0ff03282c6f/`: per-bug architecture notes in `architecture/` (`bug-001-gate-hold.md` … `bug-007-bridge-errors.md`), `P1MxTxSx/` step dirs, `prd_snapshot.md` + `prd_index.txt` + `prd_manifest.txt`, `tasks.json`, `validate.sh`, `validation_report.md` + `validation_result.json`, `TEST_RESULTS.md`, `bug_hunt_result.json`, `bug-hunt-transcript.log`, `docs/`.
- `plan/003_f8af1c6f6c49/`: same shape at top level (task dirs, delta_prd.md, validate.sh, validation_report.md) plus `bugfix/001_64331ded9ddb/` (architecture/epoch-completed-swap.md + the same artifact set).
- `plan/004_49e25d5235a9/` mirrors 003 at top level (architecture/{config-surface,external_deps,keys-and-actions}.md, task dirs P1M1–P1M4, validate.sh, validation_report.md). `bugfix/001_5dde9b4d7329/` currently holds only `prd_index.txt`, `prd_manifest.txt`, `prd_snapshot.md` — our bugfix artifacts (architecture/, validation, tasks) are yet to be written; this file starts that.
- `validation_report.md` pattern: Date + Validator scope, Executive Summary (fix-by-fix verdict through the REAL modules), Validation Approach table (typecheck / unit / E2E phases), then findings. `validate.sh` materializes an E2E `.validate-e2e.tmp.test.ts` at runtime.

## (f) Git state summary

- HEAD `16d9f65` "Add bug report: 001_5dde9b4d7329" — the bug report for our target bug is already committed.
- Working tree otherwise clean; only untracked files are the three PRD artifacts under `plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329/` (`prd_index.txt`, `prd_manifest.txt`, `prd_snapshot.md`).
- Recent arc (last 30): the P1 keymap trilogy landed (letters-only defaults BAREKEYS-001 → hjkl fixed VIMNAV-001 → digit quick-select removed DIGIT-OUT-001, commits `78b751..f0a3eaa/61f99bf`) followed by a validation pass closing AC gaps (`a6865e7`, `53c92e9`) and a README sweep (`7aca309`). Before that: DEEP-LAND-001 landing scroll (`182f4ce`), deep-view framing/answered-visibility waves, CAPS-OUT-001 caps deletion (`e6e2f3a`), ANSWER-PIN + re-ask amendment, remote-bridge removal. Pattern: each wave lands code + tests, then a validation pass commit, then doc/README sync.

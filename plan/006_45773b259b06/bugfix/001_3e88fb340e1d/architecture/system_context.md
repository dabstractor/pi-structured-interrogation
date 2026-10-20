# System Context — bugfix changeset 001_3e88fb340e1d

Repo: `/home/dustin/projects/pi-structured-interrogation` — **pi-interrogator**, a pi
extension (TypeScript ESM, `type: "module"`, exports `./src/index.ts`). HEAD at research
time: `3a302a9` ("Add bug report: 001_3e88fb340e1d"). Suite is green (1624 tests across
54 files, per prior plan `plan/006_45773b259b06/architecture/system_context.md`).

## Commands (package.json)
- `npm test` → `vitest run` (hermetic unit suite, no external services)
- `npm run typecheck` → `tsc --noEmit`
- `npm run lint` → `eslint src scripts *.ts`
- Known benign noise: `src/persistence.test.ts` logs a mocked "state mirror appendEntry
  failed" error in verbose mode; prior plan noted a one-off timeout flake — re-run once
  before concluding a failure is real.

## Layout & conventions
- Source in `src/`, tests colocated as `*.test.ts`. ESM imports use `.js` suffix
  (`import { truncateVisible } from "./layout.js"`).
- `spec/` (product-requirements.md, ui-spec.md, decisions.md, tool-protocol.md, …) is
  **read-only historical/locked prose** — never edit spec/ in this changeset.
- No `docs/` dir at repo root; user-facing docs = `README.md` (headings: Install 11,
  Usage 30, Configuration 141, Keymap 189, Side chat 286, Acceptance criteria 348,
  Limitations 377, Development 408, Project structure 506).
- Regression tests live as `src/regression-*.test.ts` (e.g. `regression-phantom-submissions.test.ts`).
- Source-scanning guard tests are an established pattern: `fs.readFileSync(new URL("./x.ts",
  import.meta.url), "utf8")` + regex asserts (src/delivery.test.ts:287, guards.test.ts:534,
  merge.test.ts:348, results.test.ts:344, snapshots.test.ts:483, state.test.ts:484,
  tool.test.ts:861). NOTE: `no-hardcoded-keys.test.ts` strips comments before matching —
  a comment-content guard must scan RAW source.
- Commit style: terse lowercase imperative ("validation lands; README key fixes + atomic install").

## Key state shapes (src/state.ts)
- `Answer` (state.ts:43-49): `{ value: string; text?: string; custom?: boolean; at?: string }`.
  `value` = chosen option value OR raw text (text questions / write-ins); `text` = free-text
  elaboration; `custom: true` = WRITEIN-001 write-in (renders `✎ {value}`).
- `applyAnswer(id, answer)` (state.ts:379-386): `q.answer = { ...answer }` shallow copy +
  status→"answered" — anything passed in is preserved verbatim.
- Deserialize guards precedent (state.ts:595-596): `if (typeof value.answer.text === "string")
  answer.text = value.answer.text; if (value.answer.custom === true) answer.custom = true;`
  — strict guards; corrupt truthy values must not leak into state.

## Reconstruction pipeline (overview — details in bug001-submission-replay.md)
- Debounced (2s, `STATE_MIRROR_DEBOUNCE_MS`, persistence.ts:61) `interrogation-state`
  appendEntry mirror carries FULL serialized state; `session_shutdown` flushes synchronously
  (index.ts:88-103). Hard kill inside the window ⇒ mirror entry missing ⇒ reconstruction
  falls back to older tool-result base + replay of `interrogation-submission` deltas.
- `reconstructFromBranch(ctx, opts, origin)` (reconstruct.ts:465+): resetState → pick newest
  plausible base (tool result `details.state` or mirror entry) → replay submissions newer
  than base → SURFACE-002: session_start NEVER opens the panel (widget line only).

## PRD scope of this changeset
4 bugs: BUG-001 major (replay loses answer.text/answer.custom), BUG-002 (Other-row label
not width-truncated), BUG-003 (auto-submit footer flash dead — set after suspend),
BUG-004 (stale SURFACE-002-contradicting wiring comment in index.ts). Architecture notes:
bug001-submission-replay.md, bug002-003-panel-render-flash.md, bug004-surface002-comment.md.

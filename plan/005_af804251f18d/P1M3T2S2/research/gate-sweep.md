# Gate sweep — P1.M3.T2.S2 (side-chat changeset 005_af804251f18d)

Full-gate verification over the integrated changeset (P1.M1 engine/config +
P1.M2 view/integration/discuss-removal + P1.M3.T1.S1 cache-isolation guard +
P1.M3.T2.S1's AC-17 suite). Run order: typecheck → lint → test → keymap script
(cheapest diagnosis first).

## Final consecutive run (all four in one session, in order)

| Gate | Command | Result |
|---|---|---|
| 1. Typecheck | `npm run typecheck` | **exit 0** |
| 2. Lint | `npm run lint` | **exit 0** (after fixes below) |
| 3. Full suite | `npm test` | **exit 0** — 53 files, **1544 tests passed** (no count drop vs. baseline run) |
| 4. Keymap script | `bash scripts/verify-keymap-conflicts.sh` | **exit 0** — PASS table in `keymap-run-record.md` |

## Fix inventory

| File | Fix | Reason | Traced to |
|---|---|---|---|
| src/panel/panel.test.ts | removed unused `writeInEnter` from the actions.js import (:50) | rename/deletion-era leftover (only remaining occurrences are comments at :3189/:3629) | P1.M1.T1 rename fallout / P1.M2.T7 deletion residual |
| src/panel/panel.test.ts | `const { panel, state }` → `const { state }` in `test_discard_on_upsert_close` | unused destructure binding | P1.M2 suite fallout (unused var after test shaping) |
| src/panel/chat-view.test.ts | 3× `no-regex-spaces`: `/^  …/` → `/^ {2}…/` (:92, :243, :329) | identical semantics ({2} = two literal spaces); new-file style rule | P1.M2.T* new-file lint debt |
| src/panel/ac-sidechat.test.ts | removed 4 unused imports: `resolveKeyLabels` (:54), `buildChatContent` (:59), `type PanelHost` (:66), `formatChatCloseNotice` (:71) | new-file unused-import violations — gate 2's expected failure class for this file | P1.M3.T2.S1 new-file lint debt — **file landed/committed** (378b9ee "T2.S1 done"), no in-flight writer; edited per the gate-2 directive ("fix by editing the offending code"), no rules disabled |
| src/panel/ac-sidechat.test.ts | deleted dead `deferred<T>()` helper (:266–272) | defined but never used | P1.M3.T2.S1 new-file lint debt |
| src/panel/ac-sidechat.test.ts | `let panelRef` → `const panelRef: { current: InterrogationPanel \| undefined }` holder (declaration :404, closure read :418, assignment :431) | prefer-const: single assignment + closure read-before-assign (`ignoreReadBeforeAssign` default); holder keeps semantics identical (callback fires only post-assignment) without disabling the rule | P1.M3.T2.S1 new-file lint debt |

No parallel-task-file conflict remained at fix time: `git log` confirmed
P1.M3.T2.S1's file was committed ("T2.S1 done") and the working tree was clean,
so the coordination rule's rationale (in-flight writer) no longer applied.
`sidechat-cache-isolation.test.ts` (P1.M3.T1.S1) was **never edited** and passes.

## Per-gate baseline notes

- **Typecheck:** clean at baseline — no stale discuss.ts imports, no missed
  `keys.discuss` consumers, sidechat type seams sound.
- **Lint:** 11 errors at baseline (6 ac-sidechat.test.ts, 3 chat-view.test.ts,
  2 panel.test.ts) → 0 after the fixes above. No rule disables, no eslint
  config changes.
- **Suite:** green at baseline AND after fixes — 53 files / 1544 tests both
  runs (count stable; `passWithNoTests` masking ruled out).
- **Keymap script:** exit 0 at baseline and final run; `e (chat)` PANEL-OWNED
  by construction — unchanged, passes untouched (see `keymap-run-record.md`).
  No chord collision vs. the AVOIDED list or live extension greps — nothing to
  escalate.

## Discuss residual grep (Level 2 contract)

`grep -rin "discuss" --exclude-dir=node_modules --exclude-dir=plan --exclude-dir=.git .`
— classified against the dossier's inventory (guards-tests-and-docs-surface.md):

| Hit(s) | Class | Verdict |
|---|---|---|
| src/config.ts:216/:221/:224 | the `coerceKeys` discuss→chat compat alias | **THE allowed site** (final-state contract satisfied) |
| src/config.test.ts:257–337 | the alias's own test suite (legacy `"discuss"` key in fixtures — the feature under test) | leave — part of the alias surface |
| src/compaction.ts:100 ("goals and objectives discussed") | ordinary-English prose | leave (documented in dossier's NOT-real-mentions list) |
| src/tool-schema.ts:45 ("as discussed") | ordinary-English prose | leave (documented in dossier's NOT-real-mentions list) |
| src/panel/sidechat-prompt.ts:120 ("keep discussing without emitting the block") | ordinary-English prose in the side-chat system prompt (same class as compaction/tool-schema; new file, not a discuss-in-chat reference) | leave — recorded here |
| src/panel/ac-sidechat.test.ts:34–36, :522 ("discuss successor" lineage comments) | historical/feature-lineage prose in the landed AC suite | leave — recorded here |
| spec/*.md (ui-spec :84/:106/:110/:112, decisions Q36/:115/:129, architecture :75/:88/:176, implementation-plan :23/:38, product-requirements :12/:19/:41) | rename/historical pins + supersession prose | **M3.T3 docs scope — recorded, not edited** |
| README.md :39/:148/:189/:237/:364 | exactly the dossier's README anchor table | **P1.M3.T3.S1/S2 scope — recorded, not edited** |

Net: the only real `discuss` reference in shipped code is the coerceKeys alias;
no undeclared live references remain. No tests deleted or weakened; no lint
rules disabled; suite count stable at 1544.

## Downstream readiness (Level 3)

- `research/keymap-run-record.md` exists (non-empty), contains "exit 0" and the
  "`e` … unchanged" note + full PASS table — P1.M3.T3.S1 can refresh the README
  `### Keymap conflict re-verification` rows (:341 label, :364 run record) and
  the `e (discuss)` → `e (chat)` label verbatim from it.
- This file's residual-grep table is the input for P1.M3.T3.S2's final sweep.

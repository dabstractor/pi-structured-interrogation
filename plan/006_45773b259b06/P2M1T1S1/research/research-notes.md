# Research — P2.M1.T1.S1: Conformance inventory of the eight post-2026-10-19 rulings

## Verified at working tree (post-HEAD 07947ec, P1.M1.T2.S3 landed)

All cross-referenced files/symbols from spec/decisions.md entries exist. Per-ruling grep evidence:

### ANSWER-FIDELITY (decisions.md :138)
- `src/delivery.ts` — :72-75 module comment "SUBMISSION_LIST_MAX_CHARS (240) and every truncation/rollup mechanic it justified are DELETED"; :180-188 entryLines = one full line per changed answer, no budget. **GOTCHA: the string "SUBMISSION_LIST_MAX_CHARS" DOES appear in delivery.ts (:72, :180) — in DELETION-DOCUMENTING comments, not live code.** The conformance check must grep for the CAP as live mechanics (rollup loop `+m more`, ellipsis cap) or assert absence of the const declaration (`const SUBMISSION_LIST_MAX_CHARS`), never the bare token.
- `src/results.ts` — ANSWER-FIDELITY full `answer:`/`elaboration:` lines (grep ANSWER-FIDELITY in src/ hits results.ts, snapshots.ts, renderers.ts, ac-scripted.test.ts, delivery.test.ts — all pinned).

### KEEP-OPEN-001 (decisions.md :158)
- `src/completion.ts` — NO-FORCE module note; no `force` param on attemptCompletion. `src/panel/actions.ts` mentions KEEP-OPEN-001 (SubmitDeps.onSubmitted deletion). `src/completion.test.ts` has the KEEP-OPEN-001 regression block.

### KEEP-OPEN-002 (:159)
- `src/delivery.ts` — `partialNudge` (:66) + `NUDGE_UNANSWERED` (4 hits total). `src/delivery.test.ts` KEEP-OPEN-002 describe; `src/ac-scripted.test.ts` AC-2/AC-13 references.

### DEEP-FULLSCREEN-001 (:~150)
- `src/panel/deep-view.ts` — `clampGlobal` (:623), `deepScrollBy` (:742), deepScrollPage present. `src/panel/terminal-budget.ts` — `deepViewportBudget` (:53). `src/panel/keys.ts` — page keys + expandDescription.

### PANELTOGGLE-001 (:154)
- `src/shortcut.ts` (registerShortcut, ctrl+n), `src/panel/keys.ts` `onToggle` (:185 interface, :449 impl), `src/config.ts` `keys.toggle` default ctrl+n (:99) + `panelShortcut` (:106, default true :157). `scripts/verify-keymap-conflicts.sh` — toggle classification at :165 (`if [[ "$action" == "toggle" ]]`). Tests: `src/shortcut.test.ts`, `src/config-surface.test.ts` (both grep-positive for PANELTOGGLE).

### CHAT-CONTEXT-001 (:163)
- `src/panel/panel.ts` chat branch; `src/panel/chat-view.ts` — `viewportHeight` sixth SHRINK-ONLY arg (:248 doc), ChatRowStyler (:178). Tests: `src/panel/chat-view.test.ts` + `src/panel/panel.test.ts` (CHAT-CONTEXT-001 describe present).

### LENIENT-ANSWER-001 (:167)
- `src/panel/sidechat.ts` — `parseAnswerBlock` (:418), `gateShape` (:504), `matchOptionValue` (referenced :491). `src/panel/sidechat-prompt.ts` §Answer protocol. `src/panel/sidechat.test.ts` LENIENT pins.

### EMPTY-REPLY-001 (:168)
- `src/panel/sidechat-engine.ts` — `EMPTY_REPLY_NOTICE` (:210) + routeTerminal empty guard (:342). `src/panel/sidechat-engine.test.ts` EMPTY-REPLY-001 rows.

### CHAT-STYLE-001 (:169)
- `src/panel/chat-view.ts` `ChatRowStyler` type + messageLines/transcriptLines; `src/panel/panel.ts` styler binding (theme.fg); `src/panel/chat-view.test.ts` CHAT-STYLE-001 describe.

## Gates (package.json verified)
- `"test": "vitest run"`, `"typecheck": "tsc --noEmit"`, `"lint": "eslint src scripts *.ts"`.
- Baseline discipline per P1.M1.T3.S2: never cite the stale 54-files/1624-tests figures; P1.M1.T1.S3 re-baseline is 56+ test files at ec61eb1+. This subtask captures FRESH counts at its own tree and re-runs a failed gate ONCE (flake precedent) before declaring a bug.

## Boundary vs P1.M1.T3.S2 (parallel, docs-only final gate)
- T3.S2 asserts `git diff --name-only == README.md` for the P1 changeset. This subtask runs AFTER that closes; its own tree may include T3.S1/T3.S2 README edits — README diffs are expected and NOT a conformance failure. Do not reuse T3.S2's gate counts; re-run fresh.

## Output shape
Conformance matrix consumed by P2.M1.T1.S2 (README residue audit scope) and P3 (context):
{ruling: {crossRefsPresent: bool, pinnedTestsPresent: bool, green: bool}} + gate results + the two expected "missing-file=0 / missing-test=0" grep tallies.

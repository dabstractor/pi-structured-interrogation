# Conformance Matrix — P2.M1.T1.S1 (eight post-2026-10-19 rulings)

Verification-only run. Captured fresh at working tree HEAD `b7f4f28` ("final delta
gate passes; P1 closes, P2 opens"). Zero tracked-file modifications by this
subtask; the only write is this file. Consumers: P2.M1.T1.S2 (README residue
audit scope) and P3 (trusted green baseline for sidechat-engine / delivery /
panel work).

```json
{
  "result": "success",
  "gates": {
    "test": "green (56 files / 1679 tests)",
    "typecheck": "green (tsc --noEmit, exit 0)",
    "lint": "green (eslint src scripts *.ts, exit 0)"
  },
  "rulings": {
    "ANSWER-FIDELITY":     { "crossRefsPresent": true, "pinnedTestsPresent": true, "green": true },
    "KEEP-OPEN-001":       { "crossRefsPresent": true, "pinnedTestsPresent": true, "green": true },
    "KEEP-OPEN-002":       { "crossRefsPresent": true, "pinnedTestsPresent": true, "green": true },
    "DEEP-FULLSCREEN-001": { "crossRefsPresent": true, "pinnedTestsPresent": true, "green": true },
    "PANELTOGGLE-001":     { "crossRefsPresent": true, "pinnedTestsPresent": true, "green": true },
    "CHAT-CONTEXT-001":    { "crossRefsPresent": true, "pinnedTestsPresent": true, "green": true },
    "LENIENT-ANSWER-001":  { "crossRefsPresent": true, "pinnedTestsPresent": true, "green": true },
    "EMPTY-REPLY-001":     { "crossRefsPresent": true, "pinnedTestsPresent": true, "green": true },
    "CHAT-STYLE-001":      { "crossRefsPresent": true, "pinnedTestsPresent": true, "green": true }
  },
  "anomalies": [
    "informational: git diff --name-only shows plan/006_45773b259b06/tasks.json modified — orchestrator-owned status tracking, not this subtask's edit (this run writes nothing outside its research/ dir)",
    "informational: no README.md diff present — P1.M1.T3 docs work already landed at HEAD b7f4f28 (P1 closed), so the PRP's expected README modifications do not apply at this tree"
  ]
}
```

## Gates (fresh counts, first pass — no flake re-run used)

- `npm test` → `Test Files  56 passed (56)` / `Tests  1679 passed (1679)` — ≥56-file
  baseline held; NOT the stale 54/1624 figures.
- `npm run typecheck` → `tsc --noEmit`, exit 0, zero errors.
- `npm run lint` → `eslint src scripts *.ts`, exit 0, zero problems.

## Per-ruling grep evidence (file:line at this tree)

### ANSWER-FIDELITY (decisions.md :138) — crossRefsPresent=true
- `src/delivery.ts:72-75` — module comment: SUBMISSION_LIST_MAX_CHARS (240) and every
  truncation/rollup mechanic DELETED (deletion-documenting comment — expected).
- `src/delivery.ts:180-196` — ANSWER-FIDELITY comment + `entryLines = diff.changed.map(...)`
  one full untruncated line per changed answer.
- Negative assertion PASS: `grep -n "const SUBMISSION_LIST_MAX_CHARS" src/delivery.ts` → no hits
  (the const is gone). PASS: no `.slice(` in delivery.ts; the only "+m more" hit (:181) is
  inside the deletion-documenting comment.
- `src/results.ts:245,248` — full `answer:` / `elaboration:` detail lines (never
  truncated-only; contract doc :136-138, :280-281).
- Pinned tests: `src/delivery.test.ts` ×8 `ANSWER-FIDELITY` hits (decisions.md pins exactly
  this file). Supplemental: `src/ac-scripted.test.ts` ×1. Note (informational, NOT a miss):
  `src/results.test.ts` greps 0 for the literal tag — decisions.md does not pin it there;
  it pins the BEHAVIOR via full `answer:`/`elaboration:` line asserts (e.g. :179 long
  write-in value round-trips untruncated).

### KEEP-OPEN-001 (decisions.md :158) — crossRefsPresent=true
- `src/completion.ts:26` — "NO-FORCE AMENDMENT (2026-11-06…)" module note; :30 "There is no
  `force`" doc line; signature `attemptCompletion(` at :121-125 has NO force param (compiler guard).
- `src/panel/actions.ts:963` — KEEP-OPEN-001 note at the suspend-after-submit tail.
- Negative assertion PASS: `grep -n "onSubmitted" src/panel/actions.ts src/panel/panel.ts src/index.ts`
  → no hits (SubmitDeps.onSubmitted deletion is complete).
- Pinned test: `src/completion.test.ts:418-420` — KEEP-OPEN-001 regression block
  ("attemptCompletion — KEEP-OPEN-001 (submitting does not complete)").

### KEEP-OPEN-002 (decisions.md :159) — crossRefsPresent=true
- `src/delivery.ts:54` `NUDGE_UNANSWERED` (open/reasked set), `:65` `partialNudge(ids, hasNote)`,
  used at :216-221 (replaces the reminder line on partial submits).
- Pinned tests: `src/delivery.test.ts:223-225` — "buildSubmission — KEEP-OPEN-002 partial nudge
  (early submit)" describe (plus :203 in-test comment); `src/ac-scripted.test.ts` ×14 AC-2/AC-13 refs
  (canonical "answer 2 of 30, ctrl+s" shape).

### DEEP-FULLSCREEN-001 (decisions.md ~:150) — crossRefsPresent=true
- `src/panel/deep-view.ts:623` `clampGlobal`, `:742` `deepScrollBy`, `:759` `deepScrollPage`.
- `src/panel/terminal-budget.ts:53` `deepViewportBudget` (used at :102).
- `src/panel/keys.ts:131,547-548` — page keys wired (`Key.pageUp`/`Key.pageDown` →
  `deepScrollPage(panel, ∓1)`); `:678-679` `expandDescription` binding.
- Pinned test: `src/panel/deep-view.test.ts` ×2 `DEEP-FULLSCREEN` hits.

### PANELTOGGLE-001 (decisions.md :154) — crossRefsPresent=true
- `src/shortcut.ts:4,90` — `registerShortcut` (the open/resume leg).
- `src/panel/keys.ts:185` `onToggle` interface member, `:449` implementation, `:731` dispatch.
- `src/config.ts` — dual-surface toggle doc :41-42, `keys.toggle` default ctrl+n :53,
  `panelShortcut` field :106, default true :157, coercion :277.
- `scripts/verify-keymap-conflicts.sh:165` — toggle classification
  (`if [[ "$action" == "toggle" ]]`).
- Pinned tests (all four grep-positive): `src/shortcut.test.ts` ×3, `src/config-surface.test.ts` ×5,
  `src/panel/keys.test.ts` ×1, `src/panel/keymap-ac.test.ts` ×1.

### CHAT-CONTEXT-001 (decisions.md :163) — crossRefsPresent=true
- `src/panel/panel.ts:149,2396,2421` — chat-branch doc + composition comments (question block
  appended under the header, transcript beneath).
- `src/panel/chat-view.ts:248,265,288` — sixth optional SHRINK-ONLY `viewportHeight` param
  (`Math.max(1, Math.min(base, viewportHeight))` — floor 1, never grows);
  `:178` `ChatRowStyler` type.
- Pinned tests: `src/panel/chat-view.test.ts` ×1, `src/panel/panel.test.ts` ×2 (CHAT-CONTEXT-001).

### LENIENT-ANSWER-001 (decisions.md :167) — crossRefsPresent=true
- `src/panel/sidechat.ts:418` `parseAnswerBlock`, `:504` `gateShape`, `:531` `matchOptionValue`
  (used at :491/:511 — cascade → canonical option value).
- `src/panel/sidechat-prompt.ts:93,103` — "## Answer protocol" section, eased by LENIENT-ANSWER-001.
- Pinned tests: `src/panel/sidechat.test.ts` ×3 LENIENT hits, `src/panel/sidechat-prompt.test.ts` ×1.

### EMPTY-REPLY-001 (decisions.md :168) — crossRefsPresent=true
- `src/panel/sidechat-engine.ts:210` `EMPTY_REPLY_NOTICE`, empty guard at :342 (docblock)
  with the notice path at :402 (after the usage tally).
- Pinned test: `src/panel/sidechat-engine.test.ts` ×2 EMPTY-REPLY hits.

### CHAT-STYLE-001 (decisions.md :169) — crossRefsPresent=true
- `src/panel/chat-view.ts:178` `ChatRowStyler` type, `:334` `messageLines`, `:361`
  `transcriptLines` (styler threaded through :290/:365).
- `src/panel/panel.ts:2514,2518` — CHAT-STYLE-001 styler binding:
  `(role, row) => this.theme.fg(role === "user" ? "userMessageText" : "text", row)`.
- Pinned tests: `src/panel/chat-view.test.ts` ×5 CHAT-STYLE hits, `src/panel/panel.test.ts` ×1.

## Diff hygiene (report-only)

- `git diff --name-only` → `plan/006_45773b259b06/tasks.json` (orchestrator-owned status
  tracking; informational anomaly, not this subtask's edit).
- `git status --porcelain` → untracked `plan/006_45773b259b06/P2M1T1S1/`, `P2M1T1S2/`,
  `agents/*` artifacts (expected pipeline outputs, incl. this file's directory).
- No README.md modification at this tree — P1.M1.T3 docs work already landed (HEAD
  "P1 closes, P2 opens"); the P1 changeset's diff-confinement assertion belongs to
  P1.M1.T3.S2, not this run.
- Tracked-file modifications by THIS subtask: none.

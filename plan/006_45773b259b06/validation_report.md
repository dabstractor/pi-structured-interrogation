# Validation Report — pi-interrogator

**Date:** 2026-10-20 · **HEAD at validation:** `9c6fa3f` (analysis began at `1bf3ddb`; the
plan-006 orchestration committed twice during validation — no product code changed)
· **Validator:** `./validate.sh` (final run: **ALL PHASES GREEN, 24 passed / 0 failed**, exit 0)

## Validation methodology

Per `plan/001_0d6760db6bc5/AUTOMATION-POLICY.md` (binding for automated runs): no live
TUI sessions, no real `interrogate` tool calls that wait on a human. Validation drove:

1. **The project's own gates** — eslint, `tsc --noEmit`, vitest (54 files / 1624 tests).
2. **Static spec guards** — keymap-conflict script, README consistency gates, caps-engine
   deletion, side-chat cache-isolation ban list, no-global-shortcut rule.
3. **Headless `pi -p` E2E (12 live probes)** — REAL pi processes, REAL extension, REAL
   model (`zai/glm-5.3`) calling the REAL `interrogate` tool: extension load + digest,
   ★ recommendation rendering, `answers[]` epoch bumps, completion injection, stale-guard
   self-heal, TRUST-001 write-in fidelity, moot/withdraw/re-ask merge rules,
   moot-doesn't-block-completion, cross-process restart reconstruction,
   description-required (both layers), elaboration fidelity.
4. **Direct executor/renderer harness probes** (jiti, outside the repo) — edge cases and
   user journeys beyond the scripted suite.
5. **Live multi-turn session journey** — upsert → record → settle close-pass → read →
   re-ask with changed options → re-answer → completion, chained across two real
   `pi -p --session` processes.

### Green results (all verified this run)

- Lint, typecheck: clean. Unit suite: 54 files / 1624 tests green.
- Extension loads and the tool registers in a REAL pi process — both via explicit `-e`
  and via the **global install path** (settings `packages` entry) from an unrelated cwd.
- Non-TUI fallback journey (FR-25/AC-11) works end-to-end live: digest relay, chat
  answers, epoch bumps, auto-close after settle, one-time completion injection
  (verified **exactly once** in the session file — the doubled JSON-stream sighting was
  `message_start`/`message_end` of one message).
- Stale-guard self-heal round trip works live (AC-8): STALE message → model re-applies
  with correct epoch → success.
- TRUST-001: a 400+-char write-in ships fully — read detail `  answer:` line, `✎` scan
  line, and the budget-capped delta's full-text continuation line all verified.
- FULL-TRANSCRIPT-001: submission cards render full elaborations, prompts, and notes in
  BOTH collapsed and expanded modes; newlines flatten row-safely (`" / "`); epoch stays
  metadata-only.
- Merge rules live: moot-on-dependency with persisted reason, `withdrawOmitted`
  set-replace keeping answers, options-change re-ask (rev 2, ⟳), `withdrawOmitted`
  alone never withdraws.
- Restart reconstruction (FR-28 read side / AC-9): fresh process + `--session` resume
  rebuilds goal/questions/revs; no panel surfaces (non-TUI).
- Description-required (2026-10-20 ruling): enforced at BOTH layers — pi's typebox wire
  schema (absent field) and the extension's parse gate (whitespace-only, names the id).
- Multi-turn re-ask journey: FR-4 close-pass archives q1 after settle, the re-ask keeps
  q2 open with answer reset, final answer completes the interrogation.

---

## Issues found (3 — all Minor; none block production use)

### 1. [Minor · user-facing docs bug] README teaches dead keys — KEYMNEMONICS-001 fossil sweep not landed

The KEYMNEMONICS-001 changeset (commit `a2f1d70`) moved the defaults to
`d` deep · `i` list · `e` explain · `n` note · `c` chat, but README prose still carries
the pre-changeset letters. A user following the README presses dead keys (`t` and the
old `e` now just type; `e` opens **explain**, not chat). This is exactly the
`plan/006_45773b259b06` P1M1T3S1 sweep (PRP filed, status not landed at HEAD) — the
PRP itself classifies it as "a user-facing bug, not cosmetics". Sites at HEAD:

| README line | Current (wrong) | Should be |
|---|---|---|
| :45 | "a re-pressed `` `t` `` just types the letter" | `` `e` `` |
| :50 | "`` `t` `` is not the only entry" | `` `e` `` |
| :83 | "the elaborations you attached with `` `t` ``" | `` `e` `` |
| :263 | "Bare config keys (`d`, `o`, `t`, `m`, `e`)" | "(`d`, `i`, `e`, `n`, `c`)" |
| :265–266 | "typing `` `t` `` in an answer must insert a `` `t` ``" example | re-derive for the new letter set |
| :301 | "Opening `` `e` `` on another question aborts…" (chat) | `` `c` `` |
| :340 | "pressing `` `e` `` again re-focuses the chat input" | `` `c` `` |
| :358 | AC-2b: "`` `t` ``, type, `enter` → draft saved" | `` `e` `` |
| :375 | AC-17: "`` `e` `` opens the per-question in-panel chat" | `` `c` `` |
| :393 | "in non-TUI modes `` `e` `` is inert" (chat) | `` `c` `` |

Also in the same Usage paragraph (~:41–42), a broken sentence reads "The editor's duty
follows context: focused\n   from a selected option it is the **elaboration** duty" —
an edit artifact that should read smoothly.

**Fix:** complete the P1M1T3S1 sweep as specced (README.md only; the keymap table,
sample settings, and record block are already correct — validate.sh Phase 5.4 now gates
them).

### 2. [Minor · docs accuracy] Keymap record block cites the wrong commit as "the KEYMNEMONICS-001 changeset"

README "Keymap conflict re-verification" header says: *Re-verified … (commit `eb09516`,
the KEYMNEMONICS-001 changeset)*. `eb09516` is the plan-docs-only commit "Add task
breakdown and architecture research" (touches only `plan/006_*` files). The
KEYMNEMONICS-001 changeset is `a2f1d70` ("Mnemonic bare-letter defaults…"). The
verification run did occur at `eb09516` (the HEAD of that moment), so the citation
conflates the run commit with the changeset. **Fix:** one-line README correction — cite
`eb09516` as the run commit and `a2f1d70` as the changeset (or drop the parenthetical
label). Belongs in the same P1M1T3 sweep scope.

### 3. [Minor · robustness] Merge-rejected upsert leaves an installed empty state (non-atomic state creation)

`executeInterrogate` installs the state singleton (`setState`) **before** `applyUpsert`
runs. If the merge layer rejects the batch — e.g. duplicate ids in one batch
(`duplicate question id in upsert batch: q1`, merge.ts:144) — the isError result leaves
behind a live, goal-bearing, question-less state (epoch 1, 0/0 questions). A read in
between then reports `Goal: X · 0/0 answered · epoch 1` instead of the epoch-0 "no
interrogation" view. Verified by direct harness probe:

```
S1: batch [q1, q1] → rejected (isError)
    read → "Goal: dup / 0/0 answered · 0 re-asked · 0 moot · epoch 1"   ← state leaked
```

Containment (why Minor): no user-visible surface (`hasResumableQuestions(empty) ===
false` — no widget, no panel); the next upsert heals cleanly with the goal retained
(spec-compliant goal retention); epoch guards are unaffected (fresh-state epoch echo is
exempt per BUG-005). Parse-level rejections (missing/whitespace description, empty
options, bad recommendation) correctly mutate nothing — the stated
"malformed input never mutates" contract holds; only merge-level throws leak.
**Fix (small, tool.ts):** install the singleton only after `applyUpsert` succeeds (or
`resetState()` in a catch around the merge call).

---

## Observations (no action required)

- **No style gate exists** (no prettier/biome config). This is a deliberate repo
  posture (eslint.config.js machine-gates the bug classes tsc misses); validate.sh
  notes it as a warning each run.
- **E2E model-variance flakiness:** one E8 failure in three full runs was traced to
  model choice variance (not product code — identical code passed the other two runs
  plus 3/3 manual retries); the probe prompt is now pinned ("the user chose fs; record
  exactly that") and the final recorded run is green. E10's initial failure was a probe
  design flaw (asserted the extension's parse message for the *absent*-description
  flavor, which pi's typebox layer rejects first); split into E10 (schema layer) +
  E10b (extension gate, whitespace flavor) — both green.
- **Plan-pipeline bookkeeping:** `plan/006_*/tasks.json` statuses trail the work
  committed by the orchestrator mid-validation (normal for an in-flight plan; not a
  product issue, and plan/ is read-only for this validator).
- Session-file inspection of the live journeys shows **exactly one**
  `interrogation-completion` entry per interrogation and no side-chat/usage residue —
  matching SIDECHAT-002/MIRROR-SILENT-001 contracts.

## Verdict

The codebase is production-solid: every scripted gate, static spec guard, and all 12
live end-to-end probes pass. The three findings are documentation debt from the
in-flight KEYMNEMONICS-001 docs sync (issues 1–2, one README-only sweep) and one minor
executor atomicity wart (issue 3). None are Critical or Major.

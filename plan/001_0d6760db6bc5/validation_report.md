# Validation Report — pi-interrogator

**Date:** 2026-09-13 · **Validator scope:** full codebase analysis + scripted validation (`./validate.sh`) · **pi:** 0.85.1 · **node:** v26.7.0

## Verdict

**2 issues found (1 major, 1 minor).** The codebase is otherwise in excellent
shape: typecheck clean, 928/928 unit tests green, keymap guard green, extension
loads headless, and 28/30 end-to-end journey assertions pass — including two
real-model `pi -p` probes that exercise the full non-TUI loop
(model→tool→digest→`answers[]`→read). The major issue is a production-only
integration bug that the unit suite masks with a wrong event-arg shape.

---

## Issues

### Issue 1 — MAJOR: `isUpsertArgs` never matches real tool args → rule-1 re-asks get archived, round-detection suppression dead

**Location:** `src/lifecycle.ts:122-124` (consumed at `lifecycle.ts:186`)

```ts
function isUpsertArgs(args: unknown): args is { questions: unknown[] } {
  return isRecord(args) && args.action === "upsert" && Array.isArray(args.questions);
}
```

**Root cause:** The `interrogate` tool schema (`src/tool-schema.ts`, PRD h2.19)
has **no `action` field**. The model sends `{questions: [...], epoch}` and the
action is *derived* inside `parseInterrogateParams`. pi's
`ToolExecutionStartEvent.args` (`dist/core/extensions/types.d.ts:608-613`) is
the raw params object — so `args.action` is always `undefined` in production
and `isUpsertArgs` always returns false.

**Spec violations (proven by `validate.sh` Phase 5 / J3, real arg shape):**

1. **h2.44 auto-close algorithm, line 2** — "on tool_execution_end
   (interrogate, action=upsert): mark each touched submitted question reasked;
   submittedRun = true". With the flag never recorded, a **rule-1 re-ask**
   (agent re-sends a submitted question with the same options, refining text —
   merge rule 1 deliberately keeps status `submitted`) is **closed (archived)
   by the `agent_settled` close pass** instead of staying open for the user.
   Observed: `q1 status=closed`, spec expects `reasked`. This breaks AC-3's
   second half ("Agent replies with a re-ask of one → that one shows
   re-asked") for the same-options re-ask path (changed-options re-asks still
   work — merge rule 2 flips status during the upsert itself).
2. **FR-26 / h2.27 round detection** — `detect.ts:168` suppresses the
   "Question round detected in chat" notification when
   `lifecycle.upsertedThisRun()` is true. That flag is now always false in
   production, so the user gets a false nudge even when the model *did* use
   interrogate.

**Why the test suite missed it:** `src/lifecycle.test.ts:103` fakes events as
`{ action: "upsert", questions }` — an arg shape the real tool schema never
produces. The 928 tests validate the engine against a fictional input
contract.

**Fix direction:** mirror the schema routing — treat
`isRecord(args) && Array.isArray(args.questions) && args.questions.length > 0`
as an upsert (presence-based routing, exactly as `parseInterrogateParams`
does), and update the lifecycle tests to use the real arg shape.

### Issue 2 — MINOR: `gateWarnings` config is semantically overloaded; caps-warning suppression contradicts h2.23; docs describe a third meaning

**Locations:** `src/tool.ts:171-176` (suppression), `src/config.ts:330` +
`README.md` (docs), `src/panel/actions.ts:331` (the legitimate FR-9 use)

- **Spec:** h2.23 requires over-budget content to be truncated "with a
  warning in the tool result (never a hard reject)" — unconditional; no
  suppression toggle is specified. h2.52/FR-9's `gateWarnings` is the panel's
  dismissible "⚠ {n} foundational unanswered" submit warning.
- **Code:** `tool.ts` also strips the caps/parse truncation warnings from the
  tool result when `gateWarnings === false`. A user who disables the panel
  footer warning **silently also hides truncation warnings from the model** —
  the model then cannot know its 3000-char description was cut to 1600
  (h2.23's self-correction path is lost).
- **Docs:** `config.ts:330` JSDoc and the README describe `gateWarnings` as
  "warn when a gate/cap truncates or drops content" — a third meaning matching
  neither the FR-9 behavior nor the tool-result effect. Pure documentation
  drift on top of the semantic overload.

**Fix direction:** either drop the `gateWarnings` gate from `upsertWarnings`
(make h2.23 warnings unconditional, matching spec), or introduce a separate
`capsWarnings` toggle; and align config JSDoc + README with whatever is
chosen. (With defaults — `gateWarnings: true` — no behavior deviation occurs,
hence Minor.)

---

## What was validated (all passing)

| Phase | Check | Result |
|---|---|---|
| 1 | `tsc --noEmit` | ✅ clean |
| 2 | vitest suite | ✅ 928 tests / 43 files |
| 3 | `scripts/verify-keymap-conflicts.sh` | ✅ no default collides (10 keys vs 11 avoided + live grep) |
| 4 | Headless extension load (`pi -p --no-session -e src/index.ts`) | ✅ factory + tool + commands + renderers register |
| 5 | Scripted E2E journey (jiti, real modules, **real event arg shapes**) | 28/30 ✅ (2 failures = Issue 1) |
| 6 | Real-model `pi -p` probes | ✅ P1 digest relay with ★ marks; ✅ P2 upsert→`answers[]`(epoch-guarded)→read → `STATUS: 1/1 answered · epoch 2` |

Journey coverage (Phase 5): J1 first upsert (30q/4 groups/gate, non-blocking,
details.state canonical) · J2 partial submit (≤3-line delta + verbatim
reminder + model-visible NOTE line, exactly one epoch bump, idle→
`{triggerTurn,followUp}` / busy→`{steer}` delivery matrix, 28 remain open) ·
J3 auto-close vs re-ask (Issue 1) · J4 stale rev/epoch rejection with STALE
self-heal messages + one-round-trip re-apply (AC-8) · J5 non-TUI `answers[]`
recording + TUI ignore (h2.20) · J6 completion injected exactly once, h2.46
record format, state cleared + completed flag, double-settle idempotent
(AC-14) · J7 scaled caps truncation with warning at 1600 chars (h2.23).

Additional verified behaviors: merge rule 4 withdrawal on partial upsert
(re-asks must resend the full set — commitment 4), rule-1 silent text update
keeps answer/status, status-line format `{a}/{t} answered · {r} re-asked ·
{m} moot · epoch {n}` per h2.28, non-blocking executor (no UI calls in the
tool path), event subscriptions all match pi 0.85.1's API surface
(`turn_end`, `session_before_compact`, `session_tree` included; typecheck
green against the installed types).

## Coverage gaps & notes (not issues)

- **Interactive TUI surfaces** (panel rendering, focus, suspend widget,
  external `$EDITOR`, real restart) are covered by scripted component tests
  (render-width sweeps, fake `tui`/`theme`) plus the human-only
  `MANUAL-TUI-AC-RUNBOOK.md` — per the binding AUTOMATION-POLICY, automated
  runs never open a live TUI. `validate.sh` respects this.
- **Worktree state:** validation ran against the staged working tree
  (README.md, tasks.json, `scripts/verify-keymap-conflicts.sh`,
  `src/keymap-guard.test.ts` + plan files are staged but uncommitted). The
  tree is self-consistent (all phases green except Issue 1).
- **Stale embedded task list:** the task snapshot supplied with this
  validation request showed M3–M7 as "Planned"; the on-disk `tasks.json`
  marks every P1.M1–M7 subtask Complete, consistent with the implemented
  code and git history.
- Phase 6 probes invoke the configured LLM; set `SKIP_LLM_PROBES=1` to skip
  them in CI-like environments.

## How to re-run

```bash
./validate.sh          # exits 0 only if every phase passes
```

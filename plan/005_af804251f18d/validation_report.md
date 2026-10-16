# pi-interrogator — Validation Report

**Date:** 2026-10-16 · **Validator:** automated deep validation (static + dynamic) · **HEAD validated:** `0a51abd` ("sidechat project tree lands; T3.S2 done", plan/005 phase P1 fully Complete)

---

## Methodology

1. **Workflow discovery** — README.md (usage flows, keymap table, install), spec/ (SPEC.md + 7 deliverable docs), plan/005 tasks + PRPs, scripts/ (verify-keymap-conflicts.sh, demo-deep-selection.ts).
2. **Codebase analysis** — full src/ tree (~40 modules, 53 test files), package.json gates (vitest / tsc / eslint), version surfaces (local devDeps vs installed runtime).
3. **Scripted gates** — lint, typecheck, 1544 unit/integration tests, keymap-conflict script.
4. **Structural conformance** — `discuss` sweep (P1.M3.T3.S2 contract), `registerShortcut` ban, SIDECHAT-005 banned-API scan over the complete side-chat cluster, README-vs-config cross-check.
5. **Live E2E (print mode, real model, real pi 1.0.2)** — full user journeys from the README/spec driven through the actual installed `pi` binary with the extension loaded (`pi -p -e src/index.ts`), asserting against session-file ground truth (tool results, custom messages, state mirrors): upsert→digest relay→answers→completion; stale-epoch rejection→self-heal; restart reconstruction with live questions; deliberate withdrawal; read-on-empty; restart-after-completion. Plus a pty TUI load smoke (startup only, per the project's AUTOMATION-POLICY which forbids live TUI automation).

All findings below were reproduced on the real machinery (live sessions inspected entry-by-entry) or verified directly in source.

---

## Issues Found

### 1. [CRITICAL] Repeatable duplicate `interrogation-completion` injections — exactly-once contract broken across every restart

**Reproduced live (3 injections in one session, +1 per restart, indefinitely).**

Journey: complete an interrogation → restart pi (or resume the session) → send any plain message (no tool calls at all) → a brand-new full `INTERROGATION COMPLETE` record is injected again. Observed session trace (session file entries): completion #1 at index 20, completion #2 at 41 (after a post-restart answer turn), completion #3 at 49 (after a plain "just say hello" turn). The model itself reported: *"Same completion record received again … Looks like a duplicate injection."* Each additional restart adds another injection.

**Root cause** (src/reconstruct.ts, base selection step 2a): reconstruction prefers the LAST interrogate toolResult carrying `details.state` and only falls back to `interrogation-state` mirror entries when no tool result exists. But completion fires at `agent_settled` — *after* the last tool call — so the canonical tool-result state **always predates the completion**, while the *newer* mirror entry written at completion time (`{completed: true, questions: {}}`) is ignored (it is only a fallback, never compared by position). `interrogation-completion` custom messages are not replayed either. Result: the resurrected state has `completed: false` with every question `submitted`; the next `agent_settled` close pass archives them; `attemptCompletion`'s one-time guard is `state.completed` (src/completion.ts), which is false → the full record is re-injected and state re-cleared. Loop repeats on every process start.

**Spec violations:** Core commitment 2 ("The full record is injected into the conversation exactly once, at completion"), FR-5 ("injects the complete Q&A record once"), and completion.ts's own docblock claim: *"reconstruction restores completed=true to preserve exactly-once across restart"* — it does not.

**Test gap:** `reconstruct.test.ts:598` ("completed (empty) state installs but opens nothing") only covers a toolResult that *itself* carries a completed/emptied state — a payload no production path ever writes (completion never happens inside a tool call). The real-world shape — `[toolResult(completed:false, all submitted), interrogation-completion message, mirror(completed:true)]` — is untested, and that gap is where the bug lives.

**Impact:** model-context pollution with duplicate full records (each one triggers a model turn), user-visible duplicate recap cards, corrupted epoch semantics, and re-cleared state on every restart.

### 2. [MAJOR] Completed interrogation resurrects as live after restart — "new interrogation starts fresh" pin defeated post-restart

**Reproduced live.** Same root cause as Issue 1 (reconstruction loses the `completed` flag). Two user-visible consequences:

- **Fresh-replacement broken (2026-09-14 pin).** The pin: *"a new interrogation after completion REPLACES the completed singleton — fresh state, epoch 1, completed=false, empty questions/snapshots."* In-process this works (src/tool.ts:259 swaps when `existing.completed === true`). After a restart, reconstruction hands the tool a resurrected `completed: false` state still holding the old questions, so a new upsert **appends**: observed "2/3 answered · epoch 2" with the completed q1/q2 restored and the new question n1 joined, instead of a fresh "0/1 · epoch 1". The subsequent (duplicate) completion record then re-lists the old answers as part of the "new" interrogation.
- **Stale suspend widget / zombie panel in TUI.** `RESUMABLE_STATUSES` includes `submitted`, and the resurrected state is all-`submitted`, so after a restart of a *completed* interrogation the widget line `0 open · 3 answered — /interrogate to resume` appears (spec: a completed interrogation must leave "no widget, no resumable record"), and `/interrogate` opens a panel over the completed set.

### 3. [MINOR] SIDECHAT-005 cache-isolation guard omits `branch-snapshot.ts` from its file set

`SIDECHAT_FILES` in `src/panel/sidechat-cache-isolation.test.ts` scans `sidechat.ts`, `chat-view.ts`, `sidechat-engine.ts`, `sidechat-prompt.ts` — but not `src/panel/branch-snapshot.ts`, which is side-chat cluster machinery (its own docblock cites SIDECHAT-003/005; it builds the chat's frozen branch replay and is consumed by sidechat.ts and panel.ts). The guard's own contract says *"Grow this list when the cluster grows a non-test helper module"* — it didn't. The module is currently clean by inspection (its only session call is `getBranch()`), so this is an enforcement gap, not a live violation: a future edit adding a banned call to branch-snapshot.ts would pass the shipped guard silently. (validate.sh re-checks all five modules independently.)

### 4. [MINOR] Stale, self-contradictory docblock on `buildSuspendWidgetLine`

`src/panel/suspend.ts` (~lines 102–104), the "Exact-string contract" block, states: *"`m` = status `"answered"` ONLY (submitted/reasked/moot/withdrawn/closed join neither bucket — same count semantics as results.ts buildStatusLine)."* Both clauses are false: `countStatuses` (same file, directly below) counts the answered bucket record-derived (`answer` present and status `answered`/`submitted`/`closed`) — exactly what `results.ts buildStatusLine` does and what the 2026-10-02 ruling mandates for the widget line ("single source of truth"). The *behavior* is spec-correct; the docblock that a maintainer would consult first (it is the "exact contract" section for a spec-pinned string) misdescribes it. The sibling `countStatuses` docblock is correct, making the file self-contradictory.

### 5. [MINOR] Tests validate against pi-coding-agent 0.85.1 while the installed runtime is 1.0.2

`package.json` devDependencies pin `@earendil-works/pi-coding-agent ~0.85.1`; the installed `pi` binary is **1.0.2**. At runtime, pi's extension loader aliases `@earendil-works/*` (and typebox) imports inside extensions to its **own 1.0.2 dist** (verified in pi 1.0.2 `dist/core/extensions/loader.js` `getAliases()`), so the 1544-test suite and typecheck exercise a different library surface than production. Everything live-probed passes under 1.0.2 (tool, events, sendMessage, session entries, reconstruction, completion delivery; TUI factory/registration smoke), and pi deliberately maintains a compat entrypoint — but any 1.0.x-only behavioral change in the TUI/panel APIs (which automated runs cannot exercise per AUTOMATION-POLICY) would be invisible to the gates. Recommend bumping the devDependency to the installed version and re-running the full suite.

---

## Verified Working (no action needed)

- **All scripted gates green:** eslint clean, `tsc --noEmit` clean, **1544/1544 vitest tests pass**, keymap-conflict script PASS (9 defaults, no collisions).
- **Live extension load under installed pi 1.0.2:** print mode and TUI (pty smoke) both start cleanly with the extension; tool + command + renderers register without errors.
- **Full non-TUI lifecycle (FR-25) end-to-end:** upsert → numbered digest with ★ marks + relay instruction → user answers in chat → `answers[]` record (epoch 1→2, statuses submitted) → `agent_settled` close pass → exactly-one completion at first pass with correct record format (`✎` write-in rendering, NOTES/Withdrawn sections).
- **Staleness guards (FR-22) live:** wrong-epoch upsert rejected with `STALE: session epoch is 2 (you sent 1) …`; model self-healed in the same turn; changed-options edit correctly reset the answer and marked the question re-asked (merge rule 2).
- **Restart reconstruction with LIVE questions (AC-9 core):** partial state (1/2 answered, epoch 2) restored correctly in a fresh process; read `{}` returns full question content blocks with statuses/revs; close-pass re-archive after restart is idempotent and benign.
- **Deliberate withdrawal:** `withdrawOmitted: true` resend produced `withdrew (withdrawOmitted): r1` with the record kept; surgical patch semantics confirmed.
- **Read on stateless session:** graceful `0/0 answered · 0 re-asked · 0 moot · epoch 0`.
- **Structural conformance:** `discuss` sweep exactly matches the P1.M3.T3.S2 whitelist (alias site, alias fixtures, English prose; README at zero); `src/panel/discuss.ts` gone; no `registerShortcut` call anywhere; tool description/promptGuidelines byte-match the spec (FR-24); README keymap table and sample settings match `config.ts` defaults; suspend widget string matches the spec format; state mirror entries are transcript-invisible with no renderer (MIRROR-SILENT-001).
- **No phantom-submission regression:** the removed remote-bridge behavior (BUG-panel-phantom) shows no residue; `interrogation-state` mirrors carry no recommended-option auto-answers.

---

## Reproduction Artifacts

- Live sessions: `/tmp/itg-e2e/` (completion-duplication chain, entries 20/41/49 in the session JSONL), `/tmp/itg-e2e2/` (reconstruction, stale-heal, withdrawal), `/tmp/itg-e2e3/` (empty read), `/tmp/itg-tui-smoke.log` (TUI smoke).
- `validate.sh` (this directory) re-runs everything, including a purpose-built regression detector for Issue 1/2 (`Phase 6` probes 6.4/6.5) that currently fails by design.

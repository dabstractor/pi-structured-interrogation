# PRP — P1.M3.T2.S1: Scripted AC-17 scenario tests (side chat)

---
name: "P1.M3.T2.S1 — Scripted AC-17 scenario tests"
description: "Create src/panel/ac-sidechat.test.ts — scripted vitest coverage of AC-17 (spec/product-requirements.md:101, SIDECHAT-001…005) item-for-item, over the REAL landed modules (panel.ts view plumbing, sidechat.ts store, sidechat-engine.ts with an injected fake SidechatModelPort, chat-view.ts render) using the ac-panel.test.ts harness precedent (real InterrogationPanel + fake tui/theme/mock pi; AUTOMATION-POLICY: no live TUI). Eight scenario groups: (1) `e` opens chat view with NO suspend; (2) two-turn exchange streams in-view + /clear resets on current question; (3) `e` on another question replaces the singleton wholesale; (4) converged ```answer block → confirm row → enter → byte-identical delta/card vs a user-selection fixture, advance + auto-submit, chat vanishes; sideChatAutoApply:true skips the confirm; (5) panel answer while chat open → chat discarded; (6) esc-suspend + /interrogate → chat returns; restart simulation → no chat and no session-file residue; (7/8) malformed answer JSON → in-view notice + chat stays open; esc aborts streaming; /usr/bin/env is a message. Plus the discuss-successor pins from P1.M2.T7.S1 if not already landed. Every test names the AC item it proves; results table in the file header (Mode A, ac-panel precedent)."
---

## Goal

**Feature Goal**: AC-17 is proven by scripted, deterministic vitest tests over the same code paths the real UI uses — no live TUI (AUTOMATION-POLICY, plan/001). Every item of the AC-17 sentence (spec/product-requirements.md:101) maps to at least one named test.

**Deliverable**: One new test file `src/panel/ac-sidechat.test.ts` (header results table + scenario tests). No production code changes (if a scenario exposes a real defect, fix it at the owning seam per the P1.M2 subtask PRPs — minimally — and record it).

**Success Definition**: `npm test` + `npm run typecheck` green; every AC-17 clause has a passing test whose name cites it; the byte-identity test proves delta/card equivalence between chat-applied and user-selected answers; the restart test proves zero persistence residue; `git diff` shows the one new test file (plus any justified seam fix).

## User Persona / Why

- **Target user**: the maintainer needing AC-17 evidence for the changeset's validation gate (consumed by P1.M3.T2.S2's full gate sweep).
- ACs in this repo are proven scripted-where-possible (h2.10; ac-panel.test.ts precedent with its per-AC results table). The side chat is TUI-only, so ALL of AC-17 must be scripted via the panel harness + a fake model port — interactive residuals (real streaming feel, real $EDITOR) go to the human runbook.

## What

### Test file & conventions

`src/panel/ac-sidechat.test.ts`, cloning `src/panel/ac-panel.test.ts` conventions:
- Real `InterrogationPanel` constructed directly (`InterrogationPanelArgs` with fake `tui: { requestRender: vi.fn() }`, identity `theme`, `done` capture, real `state` via `createInterrogationState`/`upsertQuestion`) — NOT via openPanel, except where a scenario needs the host (suspend/resume), where `createPanelHost`/`openPanel`/`resumeOpenPanel` with the mock `PiUISurface` from panel.test.ts/ac-panel.test.ts is used.
- Header Mode A results table: `| AC-17 item | verdict | evidence (test) |` + pointer to a research results file `plan/005_af804251f18d/P1M3T2S1/research/AC17-RESULTS.md` (defect log, manual-residual list).
- `resetState()`/`resetSidechatForTests()` in `beforeEach` (both exist for exactly this).
- Fake model port: inject a scriptable `SidechatModelPort` (`sidechat-engine.ts:79` — `(model, context, options) => …`) into `createSidechatEngine` deps (`:106 SidechatEngineDeps`); emit scripted deltas/stop reasons; capture usage. The port signature is the seam P1.M1.T5.S1 built for this.

### Scenario groups (each test name cites its AC clause)

**(1) Open without suspend** — `AC-17.1_chat_open_no_suspend`: panel on q3 (state seeded, view short); drive `e` (`keys.chat`, config default) through the panel's key router → assert `panel.view === "chat"`, host `isSuspended() === false`, `done` never called, main-editor surface untouched (the fake pi surface records no editor interaction). This pins the no-suspend/no-preload replacement of discuss-in-chat.

**(2) Two-turn exchange + /clear** — `AC-17.2_two_turn_exchange_streams_in_view` and `AC-17.2_slash_clear_resets_on_current_question`: send a user message via the chat input/editor seam; the fake port streams two assistant replies across two turns; assert transcript lines grow in the chat-view render (`buildChatContent` output) and messages accumulate in `sidechat.get()`. Then input exactly `/clear` (via `classifyChatCommand`, first-token byte match) → `resetChat(currentQuestion, deps)` → messages/usage cleared, view stays open, rebound to the CURRENT question (navigate to q4 first, then `/clear`, assert `record.questionId === "q4"`).

**(3) Singleton replacement** — `AC-17.3_chat_on_other_question_replaces_singleton`: open chat on q3; then drive `e` on q5 → `sidechat.get()?.questionId === "q5"`, the q3 messages are GONE (wholesale replace, no carry-over), no confirm interposed.

**(4) Apply indistinguishability (the core SIDECHAT-004 proof)** — three tests:
- `AC-17.4_confirm_row_and_apply_byte_identical`: fake port returns a reply ending in a fenced ```answer block `{"value":"sqlite"}`; `parseAnswerBlock` yields a `ParsedAnswer`; the confirm row renders (`apply ★ sqlite? · enter = yes · esc = no` family — assert via chat-view content); drive `enter` → applies via `acceptOptionIndex` (assert q3 answered `sqlite`); assert **byte identity**: capture the delivered delta via the mocked `sendMessage` (makeDeps pattern, actions.test.ts:108) for BOTH this chat-applied answer and a fixture where the user selected sqlite by cursor+enter — `expect(chatDelta).toEqual(userDelta)` on content AND details (card bytes). Then assert advance happened, auto-submit fired when it was the last answerable question, and the chat record is discarded (`get() === undefined`) with the compact close-notice usage line available (`formatChatCloseNotice`).
- `AC-17.4_esc_declines_keeps_chat`: `esc` on the confirm row → answer NOT applied, chat stays open, pendingConfirm cleared (`clearPendingConfirm`).
- `AC-17.4_autoapply_skips_confirm`: `config.sideChatAutoApply: true` → no confirm row; the parsed answer applies directly (`settleApplyDecision`/`toApplyDecision` path).

**(5) Discard on panel answer** — `AC-17.5_panel_answer_discards_open_chat`: chat open on q7; answer q7 via the ordinary option-accept path (NOT the chat) → `get() === undefined` immediately (the P1.M2.T5.S1 discard hooks at the state mutation seams).

**(6) Suspend survival + restart loss** —
- `AC-17.6_suspend_resume_returns_chat`: host-based panel; chat open; `done(null)` suspend; `resumeOpenPanel`/`/interrogate` path → `get()` still holds the record; the chat view is reachable again (footer `e reopens the chat on {q}` rebinding language when current ≠ bound is renderable).
- `AC-17.6_restart_no_chat_no_residue`: simulate restart = discard module state (`resetSidechatForTests()` + fresh state) after a chat with turns and usage; then assert the persistence surface shows NOTHING: `createStateMirror`'s entries contain no side-chat entry type (grep the mirror/`SessionEntry` types — the chat has no entry writer by design), no usage records anywhere, and the transcript fake shows no chat-derived messages. Prove absence structurally: the only chat state is the module singleton (state-and-persistence.md:129 — "no InterrogationState fields, no details, no custom entries").

**(7/8) Malformed answer, abort, non-command** —
- `AC-17.7_malformed_answer_notice_chat_stays_open`: fake port reply with a malformed ```answer block (bad JSON, and a second case: choice value not byte-matching an option) → `AnswerBlockRejection` surfaces the in-view notice (`ANSWER_REJECTION_NOTICES`), chat stays open, no pendingConfirm.
- `AC-17.8_esc_aborts_streaming`: while the port has an unresolved stream promise, `esc` → abort controller fires, partial text discarded, the turn never entered `messages`, footer hint returns to `exit`.
- `AC-17.8_usr_bin_path_is_a_message`: input `/usr/bin/env bash` → `classifyChatCommand` returns `null` → sent as a message, never treated as a command.

**Discuss-successor pins**: check P1.M2.T7.S1's PRP/landed tests — if its successor assertions (discuss.ts deleted, no `setEditorText` consumers outside history, `discuss` appears only at the coerceKeys alias) are not already pinned somewhere, add one compact test here citing that PRP; if landed, note it in the results file and skip.

### Success Criteria

- [ ] Every AC-17 clause (open-no-suspend, two-turn + /clear, singleton replace, confirm+apply+byte-identity+vanish, autoApply, panel-answer discard, suspend/resume return, restart-no-residue, malformed notice, abort, non-command) has ≥1 passing named test.
- [ ] Byte-identity proven on delta content AND card details.
- [ ] Restart test proves zero session-file/persistence residue structurally.
- [ ] `npm test` + `npm run typecheck` green; only `ac-sidechat.test.ts` added (+ research results file; + minimal seam fix if a real defect surfaced, justified in the results file).
- [ ] No edits to sibling suites (`ac-panel.test.ts`, `sidechat-cache-isolation.test.ts` — P1.M3.T1.S1's, parallel).

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the exact AC-17 text, the harness precedents, the landed side-chat API surface, the engine's injectable port, and the sibling-task boundaries. All below.

### Documentation & References

```yaml
- file: spec/product-requirements.md
  why: :101 — AC-17 verbatim (the item list these tests prove); :41 — FR-15 full side-chat contract (byte-match rules, discard paths, provenance indistinguishability)
- file: spec/ui-spec.md
  why: :108-119 — §Side chat UX rules (esc ladder, /clear first-token rule, confirm row copy family, footer hints, non-TUI inertness)
- file: spec/state-and-persistence.md
  why: :129-131 — §Side chat ephemeral-by-design: the structural absence the restart test proves (no fields, no details, no entries)
- file: src/panel/ac-panel.test.ts
  why: THE harness precedent — imports/fakes (:1-80), fake PiUISurface + done-capture, per-AC results table convention, AUTOMATION-POLICY header
- file: src/panel/actions.test.ts
  why: makeDeps/makePanel/seed fixtures (:1-120) — the sendMessage-capture pattern for the byte-identity test
- file: src/panel/sidechat.ts
  why: the store API — get/openOrReplace/resetChat/classifyChatCommand/parseAnswerBlock/discard/toApplyDecision/settleApplyDecision/clearPendingConfirm/formatChatCloseNotice/resetSidechatForTests (exports at :269-:642)
- file: src/panel/sidechat-engine.ts
  why: :79 SidechatModelPort (the injectable fake seam), :106 SidechatEngineDeps, :244 createSidechatEngine, :137 resolveSideChatModel, :168 modelSnapshotFromModel
- file: src/panel/chat-view.ts
  why: :126 ANSWER_REJECTION_NOTICES, :143 ChatViewState, :200 buildChatContent — render assertions
- file: src/panel/panel.ts
  why: :524 sideChatAutoApply read, :1055 routed.onChat — the open-or-replace panel action the `e` key drives; the view === "chat" branch
- file: src/panel/keys.test.ts / keymap-ac.test.ts
  why: how key routing is driven in tests (raw handleInput bytes like "\x1b"/"\r" or routed key actions — match whichever pattern the landed chat rungs use)
- file: plan/005_af804251f18d/architecture/guards-tests-and-docs-surface.md
  why: §Suite gates (:40-43) — AUTOMATION-POLICY + gate commands; discuss residual-sweep list (for the successor-pin decision)
- file: plan/005_af804251f18d/P1M2T7.S1/PRP.md (or its landed tests)
  why: discuss deletion successor pins — check before duplicating
- file: plan/005_af804251f18d/P1M3T1S1/PRP.md
  why: CONTRACT for the parallel cache-isolation guard test — additive-only; never edit its file
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
  sidechat.ts sidechat-engine.ts sidechat-prompt.ts chat-view.ts   # landed P1.M1/M2
  panel.ts keys.ts actions.ts                                      # integration seams
  ac-panel.test.ts actions.test.ts sidechat.test.ts sidechat-engine.test.ts chat-view.test.ts
  ac-sidechat.test.ts            # CREATE (this task)
plan/005_af804251f18d/P1M3T2S1/research/AC17-RESULTS.md            # CREATE
```

### Known Gotchas

```ts
// AUTOMATION-POLICY: no live TUI, no real model calls — the ONLY model
// behavior allowed is the injected fake SidechatModelPort.
// resetSidechatForTests() + resetState() in beforeEach — the sidechat
// singleton is module memory and WILL leak between tests otherwise.
// Byte-identity test: compare BOTH content and details of the captured
// sendMessage payloads; provenance must be indistinguishable everywhere.
// The chat discard on answer fires at the state-mutation seams (P1.M2.T5.S1)
// — test through the public accept path, never by calling the hook directly.
// The engine's port resolves streams — keep fake port promises
// controllable (deferred resolvers) so the abort test can hold a stream open.
// sideChatAutoApply default is FALSE — the confirm row is the default path.
// Don't duplicate: cache-isolation guard (P1.M3.T1.S1, parallel),
// discuss-successor pins (P1.M2.T7.S1) — check landed state first.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: READ — AC-17 text, FR-15, ui-spec §Side chat, ac-panel.test.ts harness, sidechat exports, P1.M2.T7.S1 landed tests (successor-pin decision)
Task 2: SCAFFOLD src/panel/ac-sidechat.test.ts — imports, beforeEach resets, fake PiUISurface + theme + done capture, scriptable SidechatModelPort helper (deferred stream control)
Task 3: WRITE scenarios 1-3 (open-no-suspend; two-turn + /clear; singleton replace)
Task 4: WRITE scenario 4 (confirm/apply/byte-identity/autoApply/decline) — the core SIDECHAT-004 proof
Task 5: WRITE scenarios 5-6 (panel-answer discard; suspend/resume return; restart no-residue)
Task 6: WRITE scenarios 7-8 (malformed notice; streaming abort; /usr/bin/env message) + optional discuss-successor pin
Task 7: WRITE research/AC17-RESULTS.md (results table, defect log, manual-residual list)
Task 8: GATE — npm test && npm run typecheck; git diff shows the new file (+ justified seam fixes only)
```

### Implementation Patterns & Key Details

```ts
// Scriptable fake port (the seam P1.M1.T5.S1 built):
function fakePort(script: Array<{ deltas: string[]; stop: ChatStopReason }>) {
  const calls: unknown[] = [];
  let i = 0;
  return {
    port: (async (_model, _ctx, opts) => {
      const turn = script[Math.min(i++, script.length - 1)];
      for (const d of turn.deltas) opts.onDelta?.(d);
      return { stopReason: turn.stop, usage: { inputTokens: 10, outputTokens: 5 } };
    }) as SidechatModelPort,
    calls,
  };
}
// Byte identity: run the SAME state fixture twice (fresh state each time),
// capture sendMessage payloads, expect(chatPayloads).toEqual(userPayloads).
```

### Integration Points

```yaml
CREATE: src/panel/ac-sidechat.test.ts; plan/005_af804251f18d/P1M3T2S1/research/AC17-RESULTS.md
CONSUMED: complete P1.M1/P1.M2 feature (store, engine, view, panel plumbing, discard hooks)
DO NOT EDIT: sibling suites (ac-panel/ac-scripted/sidechat-cache-isolation), production files
  (unless a scenario exposes a real defect — fix at the owning seam, minimally,
  record in AC17-RESULTS.md)
DOWNSTREAM: P1.M3.T2.S2 full gate sweep consumes this evidence
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck    # zero errors
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/ac-sidechat.test.ts -v
npm test             # full suite green — no regressions, guard tests untouched
```

### Level 3: AC mapping audit

```bash
grep -n "AC-17\." src/panel/ac-sidechat.test.ts   # every clause has a named test
```

### Level 4: Not applicable — AUTOMATION-POLICY forbids live TUI; interactive residuals are enumerated in AC17-RESULTS.md for the human runbook.

## Final Validation Checklist

- [ ] `npm test` + `npm run typecheck` green; `git diff` = new test file (+ research file, + justified seam fixes only)
- [ ] Every AC-17 clause covered by a named, passing test; results table in the header
- [ ] Byte-identity (content + details) proven for chat-applied vs user-selected answers
- [ ] Restart-no-residue proven structurally (no entries/usage/transcript traces)
- [ ] Fake-port-only model behavior (no real calls); beforeEach resets the singleton
- [ ] Sibling suites untouched; discuss-successor pins either landed-verified or added once
- [ ] AC17-RESULTS.md written with the manual-residual list

## Anti-Patterns to Avoid

- ❌ No live TUI / real model calls / real pi sessions (AUTOMATION-POLICY)
- ❌ Don't test internal hooks directly — drive the public seams (`e` routing, accept paths, `enter`)
- [ ] ❌ Don't weaken or duplicate the parallel cache-isolation guard
- ❌ Don't hand-stage singleton states the real flow can't produce (the bug-class this repo has hit before — e.g. the manufactured re-bind fixture)
- ❌ Don't compare only content strings for byte identity — details/card bytes too
- ❌ Don't skip the results-table header (ac-panel precedent is the evidence format)

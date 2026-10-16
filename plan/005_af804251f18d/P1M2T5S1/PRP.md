# PRP — P1.M2.T5.S1: Discard-on-answer/close hooks at the state mutation seams (mid-stream abort)

---
name: "P1.M2.T5.S1 — Discard the side chat when its question reaches a terminal-for-chat state, via the universal state.on('changed') bus (SIDECHAT-001/002; AC-17.5 discard guarantee)"
description: "Architecture ruling (plan/005_af804251f18d/architecture/panel-view-integration.md §Open/replace/discard): 'Discard when its question is answered/closed by ANY path (option accept, write-in, side-chat apply, moot/withdraw/upsert close): agent-side upserts never pass through keys.ts — hook the STATE mutation seams … or the universal state.on(\"changed\") bus (panel.ts :669-670 already invalidates on it). Mid-stream: abort the AbortController FIRST, then discard. On discard: close the view (land where the accept machinery's advance already points), fire the usage notify.' Implementation: extend the panel's existing state.on('changed') handler (panel.ts:722, this.onChanged) with a sidechat-discard check — when sidechat.get() exists AND its questionId's status ∈ {answered, submitted, moot, withdrawn, closed}: (1) if record.streamState === 'streaming' → record.abortController.abort() FIRST, (2) sidechat.discard(), (3) if panel.view === 'chat' → setView(this.chatReturnView ?? 'short') (no new navigation — accept machinery already moved currentId), (4) fire the compact usage notify formatChatCloseNotice(record.usage) through a nullable args seam, exactly once per record (inherent: discard clears get(), so repeated mutations no-op; belt-and-braces flag not needed but assert once-ness in tests). sidechat.discard() is a plain in-memory delete that deliberately does NOT abort (sidechat.ts:21-24 — caller-owns-abort is THIS item's contract). Tests: discard via option accept, via write-in commit, via moot (dependsOn flip), via upsert close (handleUpserted), via side-chat apply; mid-stream close aborts THEN discards; view closes landing on chatReturnView; notify fires exactly once. No docs — panel.ts header block (P1.M2.T4.S1) already declares the contract."
---

## Goal

**Feature Goal**: SIDECHAT-001's discard guarantee (architecture doc §Open/replace/discard, quoted above): the per-question side chat dies the moment its question becomes terminal-for-chat (answered/submitted/moot/withdrawn/closed) — from EVERY path, including agent-side upserts that never touch keys.ts — with in-flight streams aborted FIRST, the chat view closed (landing where the accept machinery's advance already points), and the compact usage notify fired once.

**Deliverable**: Modified `src/panel/panel.ts` (the onChanged handler gains the discard check + close-view + notify; a nullable `args.sidechatNotify` seam), tests in `src/panel/panel.test.ts`. No new files, no sidechat.ts changes, no docs.

**Success Definition**: `npm run typecheck` + `npm test` green; scripted: each of the five mutation paths (option accept, write-in commit, dependsOn moot flip, agent upsert close via handleUpserted, side-chat apply via the T6.S1 seams) discards a live record; a streaming record is aborted before discard (abort spy order); an open chat view closes to chatReturnView with currentId already advanced by the existing machinery; the notify (formatChatCloseNotice) fires exactly once across repeated mutations; no record → no-op; view ≠ "chat" → no view change.

## User Persona

**Target User**: The TUI answerer chatting about a question while the interrogation moves on.

**Use Case**: User opens `e` chat on q3, asks "why sqlite?", and while streaming they (or the agent, via an upsert close / a dependsOn flip elsewhere) make q3 answered/moot — the stream stops, the chat vanishes, the panel lands on the next question, one footer line says `chat closed · …`.

**Pain Points Addressed**: A zombie chat about an already-settled question (stale transcript, stale frozen snapshot per SIDECHAT-003, streamed tokens burning usage into nothing); mid-stream streams left running after the question died.

## Why

- Architecture doc §Open/replace/discard (verbatim in the description above) is THE ruling; the PRD selectors for this item resolved to no direct matches — the side-chat spec lives in h2.38/h3.9 and the milestone plan, and this item's contract is exactly the architecture ruling + the item description.
- Upstream landed: `sidechat.ts` store — `get()` :267, `discard()` :484 (plain delete, caller-owns-abort per :21-24), `SidechatRecord` :221+ (`streamState` :224, `abortController` :225, `usage` :229), `formatChatCloseNotice(usage)` :506 (spec-pinned string, P1.M1.T5.S3); P1.M1.T5.S2's streaming/abort semantics (aborted turns roll back fully — the user turn is popped, zero usage); P1.M2.T4.S1 (parallel, treat as landed) — PanelView "chat", `chatReturnView`, `setView`, the onChat open path, the panel.ts header doc block that already declares this contract.
- Downstream: AC-17.5 (the scripted discard scenario, P1.M3.T2.S1) and P1.M2.T6.S1 (apply-from-confirm-row) RELY on this guarantee — the apply path itself lands in the discard set (side-chat apply is one of the five paths), which is exactly why the hook must be at the state seam, not in any single gesture.

## What

[User-visible: a side chat silently disappears when its question is settled; a footer notify `chat closed · <usage>` appears once; if the chat view was open, the panel returns to the pre-chat view with the cursor where the accept/advance machinery left it.]

### Behavior contract (exact)

1. **Hook point — the universal bus**: the panel already subscribes `this.state.on("changed", this.onChanged)` (panel.ts:722; the handler invalidates the cached render). Extend the handler (or wrap it) with the discard check — it sees EVERY mutation path by construction (applyAnswer from option accept / write-in / side-chat apply, evaluateDependsOn moot flips, merge.ts upsert closes via handleUpserted, setStatus). Do NOT hook keys.ts or individual action functions; do NOT touch `applyAnswer`/`evaluateDependsOn`/state.ts internals.
2. **The check** (after or before the existing invalidate — order irrelevant, but keep the handler cheap and synchronous):
   ```ts
   const record = sidechat.get();
   if (record !== undefined) {
     const q = this.state.getQuestion(record.questionId);
     const terminal = q !== undefined &&
       (q.status === "answered" || q.status === "submitted" ||
        q.status === "moot" || q.status === "withdrawn" || q.status === "closed");
     if (terminal) {
       if (record.streamState === "streaming") record.abortController.abort(); // FIRST (ruling order)
       const usage = record.usage;                    // read before discard
       sidechat.discard();                            // plain delete (sidechat.ts:484)
       if (this.view === "chat") this.setView(this.chatReturnView && this.chatReturnView !== "chat" ? this.chatReturnView : "short");
       this.args.sidechatNotify?.(formatChatCloseNotice(usage)); // exactly once — get() is now undefined
     }
   }
   ```
   (Treat the shape as the contract, not byte-exact code: read the landed panel.ts — T4.S1 may have introduced different field/arg names — and follow its actual `chatReturnView` seam and args discipline.)
3. **Mid-stream order**: abort() BEFORE discard() — mandated by the ruling and by sidechat.ts's caller-owns-abort doc (:21-24: "aborting an in-flight stream, in the right order, is the CALLER's contract (P1.M2.T5.S1 discard hooks)"). abort() is idempotent-safe; after discard the record (and its controller) is gone. Aborted-turn rollback (P1.M1.T5.S2: user turn popped, no assistant record, zero usage) means the notify's usage tally reflects only completed turns — correct by construction; nothing to compensate.
4. **View close — no new navigation**: "land where the accept machinery's advance already points". When the terminal mutation came from acceptOptionIndex/writeInEnter, `advanceAfterAccept` has ALREADY moved currentId before the changed event reaches this handler — the discard hook must NOT touch currentId, cursorIndex, or invent navigation. Only `setView(away-from-chat)`: target = `chatReturnView` (T4.S1's field, never "chat" by its seeding rule) with "short" fallback. When the chat view is NOT open (chat alive in background while user answers elsewhere), no view change at all — just discard + notify.
5. **Notify seam**: nullable `InterrogationPanelArgs.sidechatNotify?: (message: string) => void` (mirror the nullable-deps inertness discipline from T4.S1 — tests/non-TUI pass undefined → silent). The host wires it to the same notify surface the engine's `SidechatEngineDeps.notify` uses (check sidechat-engine.ts:106-114 and the host wiring T4.S1 landed — REUSE that seam's destination rather than inventing a second one; only add the args field if no equivalent exists). Fire `formatChatCloseNotice(record.usage)` (sidechat.ts:506 — the spec-pinned `chat closed · …` string; do NOT format by hand).
6. **Double-notify guard**: inherent — after discard(), `sidechat.get()` is undefined so subsequent changed events no-op. The abort() of a streaming record triggers the engine's settle path, which may itself emit changed events (re-entrant!) — the handler must be safe under re-entrancy: the check re-reads `sidechat.get()` each time, so the second pass sees undefined. Verify no synchronous re-entrancy hazard in the abort→settle chain (P1.M1.T5.S2's settle runs through the injected seam — in tests, drive it with a synchronous fake to prove the re-entrant pass no-ops).
7. **HandleUpserted path**: agent-side upserts (merge rule 4 withdraw / rule-2 reset + close pass) mutate state and emit "changed" — covered by the bus hook with ZERO extra code. Do not add a second hook in handleUpserted (panel.ts:1880-1883 region); assert coverage with a test that upserts a closing mutation through the real host seam.
8. **Edge — question removed entirely** (upsert delete): `state.getQuestion(id) === undefined` → NOT terminal (do not discard on transient absence if the merge rebuilds; follow the ruling's "answered/closed" wording — treat undefined as no-op unless a test shows the close pass removes questions, in which case treat removal as closed). Read merge.ts's actual removal behavior before deciding; default: undefined → no-op.
9. **No docs** — panel.ts's header block (landed by T4.S1) already declares the discard contract; this item implements it.

### Success Criteria

- [ ] Discard fires via: option accept, write-in commit (writeInEnter), dependsOn moot flip (answering a gate contrary), agent upsert close (withdraw/closed through the real host/handleUpserted path), side-chat apply (T6.S1 seam — testable by calling the same accept seams directly)
- [ ] Mid-stream: abortController.abort() called BEFORE discard() (order-asserted via spies/fakes); aborted-turn rollback semantics untouched (P1.M1.T5.S2 tests stay green)
- [ ] Chat view open at discard → setView(chatReturnView); currentId/cursor UNTOUCHED by the hook (already advanced by the machinery); chat view not open → view unchanged
- [ ] `formatChatCloseNotice(record.usage)` delivered through the notify seam exactly ONCE across repeated post-discard mutations; seam undefined → silent no-op
- [ ] No record / non-terminal question → handler no-ops (existing invalidate behavior byte-identical)
- [ ] `npm run typecheck` + `npm test` green

## All Needed Context

### Context Completeness Check

The hook point (panel.ts:722 bus subscription), the ruling (quoted verbatim), the store API surface with anchors (get/discard/record fields/formatChatCloseNotice), the caller-owns-abort contract, the view-close non-navigation rule, and the five test paths are all enumerated. An implementer needs nothing beyond this PRP + the repo.

### Documentation & References

```yaml
- file: plan/005_af804251f18d/architecture/panel-view-integration.md
  why: THE ruling — §"Open/replace/discard wiring" (:19-23): the discard sentence verbatim, the state-seam reasoning ("agent-side upserts never pass through keys.ts"), the abort-then-discard order, and the no-new-navigation view-close rule; §"Suspend/resume + non-TUI" (:25-28) for why the singleton is module-scoped (this hook must survive exactly as the store does)
  pattern: implement the ruling literally; the changed-bus option is the chosen one (cheapest single point)

- file: src/panel/sidechat.ts
  why: the store being discarded — get() :267, discard() :484 (plain delete), SidechatRecord :221+ (streamState :224, abortController :225, usage :229), formatChatCloseNotice :506 (spec-pinned string), openOrReplace :284 (fresh controller per record)
  pattern: READ-ONLY for this item; call only get()/discard()/formatChatCloseNotice
  gotcha: discard() deliberately does NOT abort (:21-24 caller-owns-abort is THIS item's contract); openOrReplace/resetChat also do NOT abort the OLD record's controller — if T4.S1's onChat didn't add abort-on-replace, flag it but do not fix here (T4.S1's ownership; note in the handoff)

- file: src/panel/panel.ts
  why: the hook site — state.on("changed", this.onChanged) :722 and the onChanged handler; PanelView/view/chatReturnView/seView seams landed by T4.S1 (parallel — re-read); InterrogationPanelArgs for the nullable notify field; handleUpserted :1880-1883 (upsert path that must be covered WITHOUT a second hook); the header doc block declaring this contract
  pattern: extend the existing handler; no new subscription, no second listener
  gotcha: T4.S1 is Implementing in parallel — its exact field names (chatReturnView, sidechatDeps) may differ; landed code wins; re-read before editing

- file: src/panel/sidechat-engine.ts
  why: SidechatEngineDeps :106-114 (notify destination — REUSE for sidechatNotify's host wiring); the abort/settle path P1.M1.T5.S2 landed (what record.abortController.abort() triggers downstream — rollback, zero usage, possible re-entrant changed events)
  pattern: host wiring mirrors the engine's notify seam; read-only for engine internals
  gotcha: abort() may synchronously run the engine's abort branch (fake seam in tests) — the handler must tolerate the re-entrant changed emission (see What §6)

- file: src/panel/actions.ts
  why: read-only — the mutation paths the tests drive: acceptOptionIndex (applyAnswer → evaluateDependsOn → advanceAfterAccept), writeInEnter; PROVENANCE: advance happens BEFORE this hook runs (the changed event from applyAnswer may actually fire BEFORE advanceAfterAccept — see gotcha)
  pattern: tests drive these real seams; the hook itself never calls them
  gotcha: if state.applyAnswer emits "changed" SYNCHRONOUSLY before advanceAfterAccept runs, the discard hook fires mid-accept with currentId not yet advanced — that is FINE: the hook must not navigate (it doesn't); the view-close target is chatReturnView regardless. Assert landing via the post-accept currentId, not inside the hook

- file: src/merge.ts + src/panel/panel.ts (handleUpserted)
  why: the agent-side upsert path (rule-2 reset, rule-4 withdraw) that keys.ts never sees — covered by the bus hook; read merge.ts to resolve the What §8 edge (are questions ever REMOVED, or only status-flipped?)
  pattern: read-only

- file: plan/005_af804251f18d/P1M2T4S1/PRP.md
  why: the parallel-item contract — PanelView "chat", chatReturnView seeding ("never 'chat' itself"), setView, nullable-deps inertness discipline, the header doc block that pre-declares this contract
  gotcha: treat as landed; adapt names to the landed code

- files: src/panel/sidechat.test.ts (:219 formatChatCloseNotice spec pin), src/panel/sidechat-engine.test.ts (:715+ usage-reader pin)
  why: the notify string is SPEC-PINNED — assert the exact formatChatCloseNotice output, never a hand-written string; the usage-tally tests prove the aborted-turn zero-usage invariant this hook relies on
```

### Current Codebase tree (relevant slice)

```bash
src/panel/panel.ts            # onChanged handler + args sidechatNotify seam — EDIT
src/panel/panel.test.ts       # the five-path discard tests — EDIT (add)
src/panel/sidechat.ts         # get/discard/formatChatCloseNotice — read-only
src/panel/sidechat-engine.ts  # notify seam reference, abort semantics — read-only
src/panel/actions.ts          # real accept/writeIn seams for tests — read-only
```

### Desired Codebase tree

```bash
# same files; zero new files
src/panel/panel.ts            # discard check in onChanged + nullable notify seam
src/panel/panel.test.ts       # discard-path test suite
```

### Known Gotchas of our codebase

```ts
// CRITICAL: abort() BEFORE discard() — the ruling's order AND sidechat.ts's
// caller-owns-abort contract. After discard() the controller is unreachable.

// CRITICAL: read record.usage BEFORE discard() — the record object survives
// (JS reference) but reading it first keeps the intent obvious and avoids
// any future store change that nulls fields on discard.

// CRITICAL: do NOT navigate. The accept machinery owns currentId/cursor
// advancement; the hook only setView()s away from "chat". Touching
// currentId here would fight advanceAfterAccept.

// CRITICAL: the changed event may fire synchronously DURING applyAnswer,
// before advanceAfterAccept — and abort() may synchronously trigger the
// engine's abort branch which emits its own changed events. The handler
// must be re-entrancy-safe: every pass re-reads sidechat.get() (undefined
// after the first discard → no-op).

// formatChatCloseNotice output is SPEC-PINNED — never hand-format the
// "chat closed ·" line; assert the exact function output in tests.

// setView("chat")→X must keep T4.S1/S2.S1's blur-chat-focus hook working —
// exiting the chat view through the discard path is just another setView.

// The notify fires through a NULLABLE seam — undefined args (tests, non-TUI)
// mean silent discard. Non-TUI never mounts the panel anyway (openPanel
// guard), so the seam's absence is belt-and-braces.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 0: READ landed state
  - READ panel.ts: the onChanged handler + :722 subscription + T4.S1's landed
    PanelView/chatReturnView/setView/args code; sidechat.ts :217-310/:456-510;
    sidechat-engine.ts :106-160 (notify seam + abort settle); merge.ts removal
    behavior (What §8 edge); actions.ts acceptOptionIndex/writeInEnter order

Task 1: MODIFY src/panel/panel.ts — the seam + the hook
  - InterrogationPanelArgs += sidechatNotify?: (message: string) => void
    (or reuse the equivalent seam T4.S1 landed, if any)
  - EXTEND onChanged with the discard check (What §2): get() → terminal
    status check → abort-first → discard → setView away from chat → notify

Task 2: TESTS (src/panel/panel.test.ts) — real seams, no record mocks
  - test_discard_on_option_accept: openOrReplace (fake deps) on q1, view chat,
    acceptOptionIndex q1 → get() undefined; view === chatReturnView; notify
    called once with formatChatCloseNotice output; currentId = machinery's advance
  - test_discard_on_writein_commit: writeInEnter path answers q1 → discarded
  - test_discard_on_moot_flip: q1 dependsOn q2; answer q2 contrary → q1 moot →
    a chat on q1 discarded
  - test_discard_on_upsert_close: drive the real handleUpserted/host seam (or
    state's merge path) with a withdraw/close mutation → discarded (proves the
    keys.ts-independence claim)
  - test_discard_on_sidechat_apply: call the same accept seams the T6.S1
    confirm-row apply will route through → discarded (the apply discards its
    own chat — one live chat, provenance-indistinguishable)
  - test_midstream_abort_order: record with streamState "streaming" + a
    spy-wrapped controller → assert abort() called before get() === undefined
    (order via call log)
  - test_no_discard_when_open: question still open after mutations (draft
    save, navigation) → record alive, no notify
  - test_notify_once_across_repeated_mutations: post-discard applyAnswer
    again → notify count still 1 (re-entrancy guard)
  - test_no_record_noop / test_seam_undefined_silent / test_view_unchanged_when_chat_not_open

Task 3: HOST WIRING (panel.ts host site)
  - wire sidechatNotify to the same destination the engine's notify uses
    (grep the openPanel/extension site T4.S1 landed)

Task 4: VALIDATE
  - npm run typecheck; npx vitest run src/panel/ -v; npm test
  - grep -n "discard()" src/panel/panel.ts   # exactly one call site
```

### Implementation Patterns & Key Details

```ts
// The handler extension (shape — adapt to landed names):
private onChanged = () => {
  this.invalidate(); // existing behavior, unchanged
  const record = sidechat.get();
  if (record === undefined) return;
  const q = this.state.getQuestion(record.questionId);
  if (q === undefined) return; // What §8: transient absence → no-op (verify merge.ts)
  const terminal = q.status === "answered" || q.status === "submitted" ||
    q.status === "moot" || q.status === "withdrawn" || q.status === "closed";
  if (!terminal) return;
  if (record.streamState === "streaming") record.abortController.abort(); // FIRST
  const usage = record.usage;
  sidechat.discard();
  if (this.view === "chat") {
    const target = this.chatReturnView !== "chat" ? this.chatReturnView : "short";
    this.setView(target); // no currentId/cursor writes — machinery owns those
  }
  this.args.sidechatNotify?.(formatChatCloseNotice(usage)); // once — get() now undefined
};
```

### Integration Points

```yaml
ARGS: sidechatNotify? — nullable; host wires to the engine-notify destination
CONSUMERS:
  - P1.M3.T2.S1 AC-17.5 scripted scenario drives this guarantee end-to-end
  - P1.M2.T6.S1 (apply from confirm row): its apply routes through the
    ordinary accept seams → THIS hook discards the chat automatically —
    T6.S1 must NOT add its own discard call (would double-notify/abort)
  - P1.M2.T5.S2 (suspend survival): reads the same module-scoped singleton;
    independent — no shared edits beyond none
CONFIG: none; DOCS: none (T4.S1's header block pre-declares the contract)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/panel.test.ts -v
npx vitest run src/panel/ -v     # sidechat/sidechat-engine/chat-view suites must stay green
npm test
grep -n "sidechat.discard()" src/panel/*.ts   # exactly one runtime call site (panel.ts)
```

### Level 3: Manual (live TUI — human runbook item; needs T3.S1 routing + host engine wired)

```bash
pi -e .
# e on q1 → chat; while streaming, accept an option on q1 from... (requires
# exiting chat first) — the practical live check: answer q1 normally with the
# chat alive in background (esc out, accept) → notify line "chat closed · …"
# moot flip: answer a gate question contrary while its dependent's chat is live
# upsert close: agent withdraws the question mid-chat
```

### Level 4: Contract sweep

```bash
# AC-17.5 alignment: the five-path discard tests ARE the scripted guarantee;
# keep them driving the REAL seams (acceptOptionIndex / writeInEnter /
# dependsOn / the host upsert path), never direct discard() calls.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean; `npm test` green (whole suite)
- [ ] Exactly one `sidechat.discard()` call site in runtime code (panel.ts handler); none in actions.ts/keys.ts

### Feature Validation

- [ ] All five discard paths proven; mid-stream abort-before-discard order asserted
- [ ] View closes to chatReturnView; hook never writes currentId/cursor; no view change when chat not open
- [ ] Notify fires once via formatChatCloseNotice through the nullable seam; silent when seam undefined
- [ ] Re-entrant changed events no-op post-discard; existing invalidate behavior unchanged

### Code Quality Validation

- [ ] Only panel.ts + panel.test.ts modified (host wiring inside panel.ts's host site); sidechat.ts/sidechat-engine.ts/actions.ts read-only
- [ ] No new navigation, no second subscription, no hook in handleUpserted/keys.ts
- [ ] Spec-pinned notify string used verbatim (no hand-formatting)

## Anti-Patterns to Avoid

- ❌ discard() without abort() when streamState is "streaming" (order is the contract)
- [ ] Hooking keys.ts or individual action functions instead of the state bus (agent upserts bypass them — the bug the ruling exists to prevent)
- [ ] Navigating (currentId/cursor/advance) inside the hook — that's the accept machinery's job
- [ ] A second discard call in T6.S1's apply path later — this hook already covers side-chat apply
- [ ] Hand-formatting the "chat closed" string or reading usage after discard
- [ ] Treating getQuestion() === undefined as terminal without checking merge.ts (upsert rebuild vs removal)
- [ ] Mocking the sidechat record in tests — openOrReplace with fake deps is the established real-seam pattern
- [ ] Editing sidechat.ts to make discard() abort (explicitly forbidden by its own docstring — caller owns abort)

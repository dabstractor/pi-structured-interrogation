# PRP — P1.M2.T5.S2: Suspend/resume survival and non-TUI / no-model-seam inertness

---
name: "P1.M2.T5.S2 — Verify/wire AC-17.6's survival + inertness guarantees: a suspended panel's side chat survives in the sidechat.ts module-scoped singleton and rebinds when the FRESH panel (rebuilt by resumeOpenPanel from lastOpts) re-`e`s the same question (messages intact, byte-unchanged reuse; the chat editor's unsent buffer is NOT preserved — messages are sent, not drafted); pi restart loses the chat with ZERO session-file residue (no entries, no details fields, no usage records, no transcript-renderer involvement — grep-verify the engine writes nowhere); non-TUI stays inert by construction (openPanel's first-line `pi.mode !== \"tui\"` guard UNTOUCHED — the panel never mounts so `e` cannot dispatch); no-model-seam (RPC surfaces / test fakes / !ctx.model) opens the chat view INERT with the one-line notice (P1.M2.T1.S2) and never blocks. Input contract: P1.M2.T4.S1's view-rebind mechanics (PanelView \"chat\", onChat open-or-replace, host sidechat deps/engine wiring). Tests: suspend→resume chat intact; fresh-panel rebind; restart simulation leaves no persistence artifacts; inert view without model. Output: AC-17.6 behavior. No docs — the README limitations entry is Mode B (P1.M3.T3.S1)."
---

## Goal

**Feature Goal**: AC-17.6's four guarantees, verified end-to-end and wired where verification finds a gap: (1) suspend→resume keeps the chat alive in module memory and the fresh panel rebinds to it with the transcript intact; (2) pi restart loses it with zero persistence residue; (3) non-TUI stays inert with the existing mode guard untouched; (4) a model-less surface opens the chat INERT with the one-line notice and the panel never blocks.

**Deliverable**: Verification/wiring edits confined to `src/panel/panel.ts` (host-site engine/deps placement if needed — see Task 2), plus a scripted test block in `src/panel/panel.test.ts` covering the four scenarios and a small source-scan (persistence/renderer non-involvement of the side-chat module set). Zero new files, zero edits to sidechat.ts / sidechat-engine.ts / chat-view.ts.

**Success Definition**: `npm run typecheck` + `npm test` green; scripted: done(null) with a live chat → resumeOpenPanel → fresh panel in "short" view, record surviving, `e` on its question → same record identity, messages intact, builders NOT invoked, no unsent-buffer preload; simulated restart (resetSidechatForTests) → get() undefined AND a full chat lifecycle leaves `state.serialize()` deep-equal to before with no renderer/details/usage writes anywhere; makeMockPi("rpc") → openPanel false, no record ever created; empty-marker model snapshot → chat view opens, inert banner rendered, dispatch refused with a notice, no throw.

## User Persona

**Target User**: The TUI answerer who suspends the interrogation panel (esc / completion dismiss / lifecycle dismiss) mid-side-chat and later resumes — and the non-TUI / model-less user who must never see the chat surface misbehave.

**Use Case**: User is chatting about q3 (`e`), presses esc twice (panel suspends), runs `/interrogate` (or the agent fires `{reopen:true}`) — the panel returns on the first unanswered question; pressing `e` on q3 shows the SAME transcript, still able to continue the chat. A pi restart simply loses the chat — silently, with nothing written anywhere.

**Pain Points Addressed**: chats dying with the panel instance (the pre-module-scope hazard); zombie persistence residue (session files polluted by a deliberately ephemeral feature — SIDECHAT-002); RPC/test surfaces crashing or blocking when no model exists.

## Why

- Architecture ruling (plan/005_af804251f18d/architecture/panel-view-integration.md §"Suspend/resume + non-TUI", verbatim authority): "Suspend: `done(null)` → module-scoped host record survives (panel.ts ~:1830-1850: `phase`, `currentPanel`, `activePi`, `lastOpts`, `lastFocusId`, `openSeq`); `resumeOpenPanel` reuses `lastOpts` (same state/config/drafts) — the panel INSTANCE dies, so the sidechat singleton MUST live in `sidechat.ts` module scope (not on the panel) to survive; the fresh panel's chat view rebinds to it. Completion dismissal / esc-suspend keep it; pi restart loses it (nothing to do — no persistence by design). Non-TUI: `openPanel` first line `panel.ts:1861` (`pi.mode !== "tui"` → return false) — the panel never mounts, the router is unreachable → `e` is inert by construction; keep the guard untouched. No-model-seam (RPC/test fakes, `!ctx.model`): chat view opens INERT with a one-line notice (spec edge state)."
- The survival substrate is LANDED: sidechat.ts's module-scoped `current` ("Module scope is LOAD-BEARING" — its header pins "survives suspend, dies on restart" with zero persistence code), the panel.ts host record + resumeOpenPanel, and the inert chain (resolveSideChatModel → modelSnapshotFromModel's empty marker → chat-view.ts's INERT_BANNER → engine dispatch refusal). This item proves they compose and fixes the one composition risk: engine/settle-forwarding placement across suspend (research notes §6).
- Parallel contract: P1.M2.T5.S1 (discard hooks, being implemented NOW) rides the panel-instance `state.on("changed")` handler — independent seams; do not touch its hook. P1.M2.T4.S1 (view/open path) is this item's declared INPUT — treat as landed.
- Downstream: AC-17.6 scripted coverage folds into P1.M3.T2.S1's suite; the restart-residue scan complements (does not duplicate) P1.M3.T1.S1's cache-isolation guard.

## What

[User-visible: suspending the panel and resuming it (via `/interrogate`, `{reopen:true}`, or an upsert-driven reopen) keeps a live side chat alive — re-`e` on its question continues the same transcript. The chat editor's unsent text does NOT come back (messages are sent, not drafted). A pi restart silently loses the chat; no session-file traces exist. In RPC/non-TUI mode `e` never does anything. With no resolvable model, `e` still opens the chat view showing the one-line inert notice and every send is refused with a notice — never a crash, never a blocked panel.]

### Behavior contract (exact)

1. **Suspend keeps the chat — mechanism already landed, VERIFY only**: every suspend path (`done(null)` from esc/completion dismissal via `suspendCurrent()` panel.ts:1804, and the custom()-resolution `.then` → `markSuspended()` :1751) nulls `currentPanel` but never touches sidechat.ts module state. The stream in flight at suspend time is NOT aborted (by design — the chat survives; abort belongs to T5.S1's discard paths only).
2. **Resume rebuilds a FRESH panel; the chat view is NOT auto-restored**: `resumeOpenPanel(pi)` (panel.ts:2086) runs the RESUME-001 focus ladder (first unanswered → lastFocusId-if-active → first active) and opens in the DEFAULT view ("short") — the ladder's JSDoc explicitly rules "take me to what needs answering", not "where you were standing". Do NOT add view restoration. The chat is reached by `e`: T4.S1's onChat default → `record.questionId === currentId` → openOrReplace's reuse branch returns the record BYTE-UNCHANGED (builders not invoked — SIDECHAT-003), then setView("chat") shows the intact transcript. Messages survive because they live on the record; the chat editor's unsent buffer does NOT (it was panel-instance state) — assert no preload happens (no `setEditorText`, no chat-input restore call) on the fresh panel.
3. **Engine/deps placement — the one wiring requirement**: for a mid-stream suspend→resume to keep working, the side-chat engine (and the SidechatRebindDeps' model seam) must be constructed ONCE per host lifetime — module scope near the host record or an equivalent single-construction site — with its `notify`/settle forwarding targeting `currentPanel?.invalidate()` (the module record's LIVE panel), so settles of a pre-suspend stream reach the FRESH panel. If T4.S1's landed wiring already constructs once per host, VERIFY and leave it; if it constructs per `openPanel` call, relocate the construction (and route invalidate through `currentPanel?.invalidate()`). `resetHostRecord()` must NOT discard the sidechat record (its lifecycle is replace/discard only — the T5.S1/T4.S1 seams).
4. **Model seam tolerance**: the host-built `resolveModelSnapshot` must be the `resolveSideChatModel` (sidechat-engine.ts:137) → `modelSnapshotFromModel` (:168) chain — a model-less surface (test fakes, RPC ctx, `!ctx.model`) yields the EMPTY marker `{provider: "", modelId: ""}` and NEVER throws. The chat then opens inert: chat-view.ts renders the inert banner (`modelSnapshot.provider === ""`, text byte-pinned to the engine's `INERT_NOTICE`), and every send is refused by the engine with an `error` notice, settling idle. The panel never blocks. VERIFY the landed host wiring has no crash path on a model-less pi surface; fix if it does.
5. **Non-TUI stays inert BY CONSTRUCTION**: the guard `if (pi.mode !== undefined && pi.mode !== "tui") return false;` is the FIRST line of `openPanel` — keep it untouched, add NO sidechat-specific mode checks anywhere else. Because the panel never mounts, the router is unreachable and `e` cannot dispatch; additionally no non-panel code path may create a record (the only sanctioned `openOrReplace`/`resetChat` call sites are the panel's onChat default and the panel-internal chat routing).
6. **Restart loses the chat with ZERO residue**: pi restart = fresh module load → `current` starts undefined; nothing else exists (sidechat.ts header: "the chat lives in NONE of the three storage layers", h2.51). The tests must PROVE the absence: (a) runtime — a full chat lifecycle (open, one settled turn via the fake port, discard) around a real `createInterrogationState` leaves `state.serialize()` deep-equal to before; (b) simulated restart — `resetSidechatForTests()` → `get() === undefined`; (c) static scan — sidechat.ts + sidechat-engine.ts (+ chat-view.ts) contain no involvement with the persistence surfaces: no `upsertEntry`/entries writes, no tool-result `details` writes, no session usage-record writes, no renderers.ts registration (scanner pattern per src/no-hardcoded-keys.test.ts; scoped to persistence/renderer surfaces — the banned-main-session-API list is P1.M3.T1.S1's, do not duplicate).
7. **No docs** — the README limitations entry is Mode B (P1.M3.T3.S1).

### Success Criteria

- [ ] Suspend→resume: `done(null)` → `resumeOpenPanel` → fresh panel (different instance) in "short" view; `sidechat.get()` still the SAME record object; `e`/onChat on its question → record identity `toBe` preserved, messages array intact (length + contents), fake-deps builders NOT invoked on rebind, chat view shows the transcript
- [ ] No unsent-buffer preload across resume: no setEditorText / chat-input restore call anywhere in the resume path
- [ ] Mid-stream suspend: record's stream keeps running; after resume a settle reaches the FRESH panel (invalidate forwarded via the host-record placement — Task 2)
- [ ] Restart simulation: `resetSidechatForTests()` → `get() === undefined`; full lifecycle leaves `state.serialize()` deep-equal; source scan finds zero persistence/renderer involvement in the side-chat module set
- [ ] Non-TUI: `makeMockPi("rpc")` → openPanel false, custom never called, `sidechat.get() === undefined`; the mode guard line is byte-unchanged; no openOrReplace/resetChat call site outside the panel layer
- [ ] No-model-seam: empty-marker snapshot → onChat opens view "chat", buildLines contains the inert banner line, a send attempt produces an error notice and settles idle, no throw, panel alive
- [ ] `npm run typecheck` + `npm test` green

## All Needed Context

### Context Completeness Check

Every seam is anchored to landed code (host record fields, suspendCurrent/markSuspended/resumeOpenPanel, the openPanel guard, sidechat's module singleton + reuse branch, the inert chain functions with line refs), the parallel contracts (T4.S1 input, T5.S1 boundary) are stated, the four test scenarios are decomposed into concrete assertions, and the harness patterns (makeMockPi/firstCall/flush, fake deps, fake port, source-scan precedent) are named. An implementer needs nothing beyond this PRP + the repo.

### Documentation & References

```yaml
- file: plan/005_af804251f18d/architecture/panel-view-integration.md
  why: THE ruling — §"Suspend/resume + non-TUI" (verbatim quoted in Why); §"Open/replace/discard wiring" for onChat's reuse branch this item's rebind rides on
  pattern: implement/verify the ruling literally; nothing here overrides it

- file: plan/005_af804251f18d/P1M2T5S2/research/suspend-resume-inertness-notes.md
  why: verified anchors for every claim in this PRP — host record fields with lines, resume ladder, singleton reuse branch, inert chain, engine-placement risk analysis, harness facts, out-of-scope edges
  pattern: use as the work checklist; re-verify anchors against the landed tree first (T4.S1/T5.S1 shift lines)

- file: src/panel/panel.ts
  why: host record :1698-1721; suspendCurrent :1804; markSuspended :1751; resetHostRecord :1833; openPanel :1950+ (guard = FIRST line; custom() .then suspend choke point :2011-2043; args construction site for T4.S1's deps/engine seams); resumeOpenPanel :2086 (RESUME-001 ladder — read its JSDoc before assuming view restoration); the landed onChanged handler (T5.S1, parallel — DO NOT EDIT)
  pattern: verification reads + the single possible edit (engine placement) live in the openPanel host site
  gotcha: T4.S1 and T5.S1 land in parallel — re-read; landed names win

- file: src/panel/sidechat.ts
  why: the surviving singleton — module-scoped `current`, get(), openOrReplace (same-question reuse BYTE-UNCHANGED, builders skipped), discard(), resetSidechatForTests() (the restart-simulation seam); header pins "survives suspend, dies on restart, zero persistence"
  pattern: READ-ONLY; tests call openOrReplace/discard/resetSidechatForTests/get only
  gotcha: do not "fix" anything here — the no-persistence property is by construction

- file: src/panel/sidechat-engine.ts
  why: resolveSideChatModel :137 (config→registry→session→first-available→undefined); modelSnapshotFromModel :168 (undefined → empty marker, never throws); INERT_NOTICE :183 (module-private; byte-pinned by chat-view); createSidechatEngine :244 + SidechatEngineDeps :106 (port/registry/notify/answerContext?/onAutoApply? — the notify seam Task 2 may forward); sendTurn's inert refusal :412
  pattern: read-only; tests inject the fake port from sidechat-engine.test.ts's pattern to drive one settled turn

- file: src/panel/chat-view.ts
  why: the inert banner the no-model test asserts — modelSnapshot.provider === "" → banner (:208-212, inertBannerLine :347, INERT_BANNER :116 byte-pinned)
  pattern: read-only; assert the rendered line, never hand-copy the banner text (import/duplicate per chat-view's own pinning comment)

- file: src/panel/panel.test.ts
  why: the harness — makeMockPi(mode) :118, firstCall/flush, createPanelHost(makeMockLifecycle().lifecycle), optsFor(state); precedents: test_suspend_done_null_marks_suspended_and_editor_restored :308, test_non_tui_mode_is_guarded :339, test_upsert_while_suspended_reopens :713
  pattern: new tests mirror these; snake_case test names; sidechat.resetSidechatForTests() in the new tests' setup
  gotcha: T2.S1 (second TextField) FAILED — the chat-input seam may not match S2.S1's chatField contract; write buffer-loss assertions against whatever seam exists, conditionally

- file: plan/005_af804251f18d/P1M2T4S1/PRP.md
  why: the INPUT contract — PanelView "chat", onChat default (open-or-replace + reuse branch), chatReturnView, host wiring of SidechatRebindDeps + createSidechatEngine + onSettled→invalidate; this item verifies those seams compose across suspend
  gotcha: treat as landed; adapt names to the tree

- file: plan/005_af804251f18d/P1M2T5S1/PRP.md
  why: the PARALLEL item's boundary — its discard hook rides the panel-instance onChanged handler; terminal-while-suspended is documented as its handoff edge, NOT this item's to fix
  gotcha: do not edit the onChanged handler or duplicate its discard logic

- file: src/no-hardcoded-keys.test.ts
  why: the source-scanner precedent for the restart-residue static scan (readFileSync + assertions over source text)
  pattern: small describe block; scope the regex list to persistence/renderer surfaces only

- file: src/panel/suspend.ts
  why: resumePanel :23 (delegates to resumeOpenPanel) — the /interrogate + {reopen:true} funnel; tests target resumeOpenPanel directly (the funnel point both entries share)
```

### Current Codebase tree (relevant slice)

```bash
src/panel/panel.ts             # host record, suspend/resume, openPanel guard, host wiring — VERIFY (+ possible engine-placement edit)
src/panel/panel.test.ts        # the four-scenario test block + source scan — EDIT (add)
src/panel/sidechat.ts          # module singleton, resetSidechatForTests — read-only
src/panel/sidechat-engine.ts   # model resolution, inert chain, engine — read-only
src/panel/chat-view.ts         # inert banner — read-only
src/panel/suspend.ts           # resume funnel — read-only
```

### Desired Codebase tree

```bash
# no new files
src/panel/panel.ts             # (only if verification finds the gap) engine/deps constructed once per host, notify → currentPanel?.invalidate()
src/panel/panel.test.ts        # suspend/resume survival + rebind, restart no-residue, non-TUI inert, no-model inert + persistence source scan
```

### Known Gotchas of our codebase

```ts
// CRITICAL: the fresh panel after resume starts in "short" view — RESUME-001
// deliberately lands on "what needs answering". Do NOT restore view "chat",
// chatScroll, or chatReturnView; the rebind happens on the next `e` via
// openOrReplace's byte-unchanged reuse branch.

// CRITICAL: never assert the inert banner text by hand — it is byte-pinned
// (chat-view INERT_BANNER ↔ engine INERT_NOTICE); derive or compare against
// the pinned constant's source, per chat-view.ts's own duplication rule.

// CRITICAL: resetSidechatForTests() is the ONLY restart simulation — a pi
// restart is a fresh module load and there is no other state (grep-verified).
// Do not add fake "session file" fixtures; assert ABSENCE (serialize()
// deep-equal, scan clean), never the presence of a tombstone.

// CRITICAL: do not abort the stream on suspend — survival is the feature;
// abort ordering belongs to T5.S1's discard paths exclusively.

// CRITICAL: T5.S1's onChanged discard hook is panel-instance-scoped; a
// question going terminal DURING suspend leaves the record alive until the
// next post-resume mutation. That is a documented handoff edge — do NOT add
// a mount-time sweep here (would duplicate/conflict with T5.S1).

// The non-TUI guard is the FIRST LINE of openPanel — keep byte-identical;
// adding any second mode check elsewhere duplicates the guard and invites
// drift between the two.

// makeMockPi's fake surfaces carry no model — the model-seam tests must
// ensure the host resolver chain tolerates that (empty marker, no throw),
// which is exactly production's !ctx.model shape.

// panel.test.ts tests run against module singletons — call
// sidechat.resetSidechatForTests() (and the state reset precedent) in the
// new tests' setup or cross-test leakage fakes the survival.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: READ landed state (anchors shift — T4.S1/T5.S1 land in parallel)
  - READ panel.ts: host record block, suspendCurrent/markSuspended/resetHostRecord,
    openPanel (guard + args construction + .then choke point), resumeOpenPanel JSDoc,
    the landed onChat default + sidechat deps/engine wiring (T4.S1), the landed
    onChanged discard hook (T5.S1 — boundary only); sidechat.ts singleton block;
    sidechat-engine.ts :104-260; chat-view.ts banner block; panel.test.ts harness
    + precedents (:308/:339/:713)

Task 1: VERIFY the four guarantees against the landed tree (checklist)
  - suspend path never touches sidechat module state (grep suspendCurrent/markSuspended/resetHostRecord bodies)
  - resumeOpenPanel → openPanel re-wires sidechat deps/engine through the SAME construction path (or once-per-host — see Task 2)
  - resolveModelSnapshot chain tolerates a model-less surface (empty marker, no throw)
  - the openPanel guard is intact and first

Task 2: WIRE only what verification found missing (expected: zero-to-one edit)
  - IF the engine/settle-forwarding is per-openPanel-call: relocate construction to
    once-per-host (module scope near the host record; survives suspend; resetHostRecord
    may clear the ENGINE reference but must NEVER touch the sidechat record), with
    notify/onSettled forwarding to currentPanel?.invalidate() so post-resume settles
    reach the fresh panel
  - IF the model resolver can throw on a model-less pi: route it through
    resolveSideChatModel → modelSnapshotFromModel (never-throw chain)
  - DO NOT: restore view state, abort on suspend, touch sidechat.ts, touch T5.S1's
    onChanged handler, weaken the non-TUI guard

Task 3: TESTS — src/panel/panel.test.ts (setup: sidechat.resetSidechatForTests())
  - test_suspend_resume_chat_survives_and_rebinds:
    openPanel → routed.onChat(panel1, fake deps) → record with ≥1 message (drive one
    real engine turn via the sidechat-engine.test.ts fake-port pattern, OR assert
    identity when only rebind is under test) → firstCall(mock).done(null) → flush →
    resumeOpenPanel(mock.pi) → fresh component ≠ panel1, view "short" →
    routed.onChat(panel2, fake deps) → sidechat.get() toBe the original record,
    messages intact, builders NOT called (spy counts), view "chat"; assert no
    setEditorText/chat-input restore call anywhere in the resume sequence
  - test_suspend_midstream_settle_reaches_fresh_panel (if Task 2 wired forwarding;
    else assert the forwarding seam exists): record streaming at done(null); after
    resume, complete the fake-port turn → fresh panel invalidated (render picks up
    the frozen assistant message)
  - test_restart_simulation_no_residue: full lifecycle (openOrReplace + one settled
    turn + discard) around a real createInterrogationState → state.serialize()
    deep-equal before/after; then resetSidechatForTests() → sidechat.get() undefined
  - test_sidechat_module_set_writes_nothing_persistent (source scan, no-hardcoded-keys
    precedent): read sidechat.ts + sidechat-engine.ts (+ chat-view.ts) source; assert
    no entries/details/usage-record/renderer-surface involvement (regex list: upsertEntry,
    details, renderResult/Renderers registration, persistence imports)
  - test_non_tui_e_inert: makeMockPi("rpc") → openPanel false, custom not called,
    sidechat.get() undefined; guard line unchanged (source assert optional)
  - test_no_model_seam_opens_inert: fake deps resolveModelSnapshot → {provider:"",modelId:""}
    → onChat → view "chat", buildLines output contains the inert banner line; send
    attempt (engine seam with fake port) → error notice appended, streamState "idle",
    no throw, panel component alive

Task 4: VALIDATE
  - npm run typecheck; npx vitest run src/panel/ -v; npm test
  - grep -n 'pi.mode !== "tui"' src/panel/panel.ts   # exactly one, first line of openPanel
  - grep -rn "openOrReplace\|resetChat" src --include=*.ts | grep -v test | grep -v sidechat.ts
    # call sites only in the panel layer (onChat default + chat routing)
```

### Implementation Patterns & Key Details

```ts
// The rebind test's core assertions (identity — the SIDECHAT-003 reuse contract):
const before = sidechat.get();           // record live pre-suspend
firstCall(mock).done(null);              // suspend — panel instance dies
await flush();
expect(resumeOpenPanel(mock.pi)).toBe(true);
const panel2 = secondCall(mock).component;
expect(panel2).not.toBe(panel1);
expect(panel2.view).toBe("short");       // RESUME-001 — no chat-view restore
panel2.routed.onChat(panel2);            // re-`e` on the record's question
expect(sidechat.get()).toBe(before);     // BYTE-UNCHANGED reuse, same object
expect(sidechat.get().messages).toEqual(beforeMessages);   // transcript intact
expect(fakeDeps.buildBranchSnapshot).not.toHaveBeenCalled(); // no rebind rebuild

// Engine forwarding (ONLY if Task 2 finds per-open construction — shape):
// module scope, near the host record:
let sidechatEngineHost: { sendTurn: ...; abort: ... } | undefined;   // once per host
// deps.notify routes to the LIVE panel — currentPanel is the module record's:
const engineDeps = { port, registry, notify: (m) => { currentPanel?.invalidate(); notifySurface?.(m); }, ... };
// resetHostRecord(): may clear sidechatEngineHost (stateless wrapper) but
// NEVER calls sidechat.discard() — the record's exits are replace/discard only.
```

### Integration Points

```yaml
PANEL HOST (panel.ts):
  - engine/deps construction placement (Task 2, conditional) + notify forwarding
TESTS:
  - panel.test.ts gains the AC-17.6 scenario block + the persistence source scan
CONSUMERS:
  - P1.M3.T2.S1 (AC-17 scripted suite) folds these scenarios into AC-17.6 coverage
  - P1.M3.T1.S1's banned-API scanner is a DIFFERENT list — keep the scans disjoint
HANDOFF NOTES (do not implement):
  - terminal-while-suspended edge → T5.S1's owner (mount-time sweep is its call)
  - unsent-buffer loss is DESIGNED behavior; the README limitations entry is
    P1.M3.T3.S1 (Mode B)
CONFIG: none; DOCS: none
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/panel.test.ts -v
npx vitest run src/panel/ -v      # sidechat/sidechat-engine/chat-view suites stay green
npm test
```

### Level 3: Manual (live TUI — human runbook; needs T3.S1 routing + T4.S1 host wiring landed)

```bash
pi -e .
# upsert questions → e on q1 → send a message → esc-ladder out / completion dismiss
# /interrogate → panel returns on first unanswered (short view) → e on q1 →
#   transcript intact, continue chatting; unsent-typed-text loss is expected
# restart: exit pi, relaunch with the session → e → fresh empty chat (no residue)
# non-TUI: pi -p "..." (RPC) → interrogate upsert → results text only, `e` moot
```

### Level 4: Contract sweep

```bash
grep -n 'pi.mode !== "tui"' src/panel/panel.ts          # one hit, openPanel's first line
grep -rn "openOrReplace\|resetChat(" src --include="*.ts" | grep -v "\.test\." | grep -v "src/panel/sidechat.ts"
# → only the panel layer (onChat default / chat routing)
grep -rn "sidechat" src/persistence.ts src/renderers.ts  # → empty (no persistence/renderer involvement)
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean; `npm test` green (whole suite — parallel items' suites included)
- [ ] No new files; edits confined to panel.ts (conditional Task 2) + panel.test.ts

### Feature Validation

- [ ] Suspend→resume: record survives (same object), fresh panel "short", re-`e` rebinds byte-unchanged (builders not called), messages intact, no unsent-buffer preload
- [ ] Mid-stream suspend: settle reaches the fresh panel (forwarding seam verified/wired)
- [ ] Restart simulation: get() undefined after resetSidechatForTests; serialize() deep-equal across a lifecycle; source scan clean (no entries/details/usage/renderers in the module set)
- [ ] Non-TUI: openPanel false on mode "rpc", no custom call, no record; guard untouched
- [ ] No-model: chat opens with inert banner, send refused with notice, settles idle, no throw
- [ ] Success-criteria checkboxes in "What" all pass

### Code Quality Validation

- [ ] sidechat.ts / sidechat-engine.ts / chat-view.ts / suspend.ts read-only; T5.S1's onChanged handler untouched; no view restoration, no suspend-abort
- [ ] Banner text asserted via the pinned constants' pattern, never hand-copied
- [ ] Tests use the real seams (routed.onChat / done(null) / resumeOpenPanel / openOrReplace), fake deps/port per the established patterns, resetSidechatForTests in setup

## Anti-Patterns to Avoid

- ❌ Restoring the chat view (or any view/scroll/focus state) on resume — RESUME-001 lands on "what needs answering"; the rebind is `e`'s job
- ❌ Aborting the in-flight stream on suspend — survival is the feature; abort ordering is T5.S1's discard contract only
- ❌ Adding a mount-time terminal sweep (terminal-while-suspended) — duplicates T5.S1's parallel work; hand off instead
- ❌ Editing sidechat.ts to add persistence/cleanup — the zero-persistence property is the contract being proven, not a gap
- ❌ Weakening, moving, or duplicating the non-TUI guard (`e` is inert BY CONSTRUCTION — one guard, first line, untouched)
- ❌ Hand-copying the inert banner / notice strings in tests (byte-pinned constants)
- ❌ Creating fake session-file fixtures to "check" restart — assert absence (deep-equal serialize, clean scan), never presence
- ❌ Letting tests share module-singleton state without resetSidechatForTests — leakage would fake survival
- ❌ Blocking the panel on a model-less surface — the inert notice path must settle idle without throwing

---

**Confidence Score**: 8/10 — the survival substrate and inert chain are landed with verified anchors, the four scenarios decompose into concrete assertions with harness precedents, and the only open risk is sequencing drift against the parallel T4.S1/T5.S1 landings (mitigated by Task 0's read-first step, the boundary rules, and the conditional-only Task 2 edit).

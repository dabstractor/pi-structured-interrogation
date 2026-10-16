# Research notes — P1.M2.T5.S2: Suspend/resume survival + non-TUI / no-model-seam inertness

All line anchors verified against the working tree on research day. T4.S1 (view/open path)
and T5.S1 (discard hooks) are contracts in flight — treat their PRPs as landed truth;
re-read the tree at implementation time.

## 1. Suspend/resume mechanics (panel.ts, LANDED and verified)

Module-scoped host record (panel.ts ~:1698-1721):
- `phase: HostPhase` :1698 ("closed" | "open" | "suspended")
- `currentPanel: InterrogationPanel | undefined` :1699
- `activePi: PiUISurface | undefined` :1700
- `lastOpts: OpenPanelOptions | undefined` :1703 (RESOLVED opts — delivery included)
- `lastFocusId` :1717 (focus memory captured at every suspend path)
- `openSeq` :1721 (stale-landing guard for superseded custom() promises)

Paths:
- `suspendCurrent()` :1804 — phase→"suspended", currentPanel=undefined, dispose+suspend
  (done(null)). Called by lifecycle.onPanelDismiss wiring (createPanelHost :1908+) and
  PanelHost.suspend().
- Every custom() resolution lands in openPanel's `.then` (:2011-2043): capture
  lastFocusId → dispose → markSuspended (:1751, comment: "fresh instance on reopen") →
  updateSuspendWidget (h2.37 reminder line).
- `resumeOpenPanel(pi)` :2086 — RESUME-001 focus ladder: first UNANSWERED (open/reasked)
  in state order → else lastFocusId when still ACTIVE_STATUSES → else first active.
  Then `openPanel(pi, { ...lastOpts, focusQuestionId })`. Same state/config/drafts
  instances ride the spread (R4 survival precedent).
- Explicit resume entries: `/interrogate` command (command.ts → suspend.ts:23
  `resumePanel` → resumeOpenPanel) and `{reopen:true}` (index.ts:164-179 onReopen →
  same funnel). Upsert-driven: maybeAutoOpen (tool_execution_end three-gate).
- `resetHostRecord()` :1833 — clears the whole record (phase "closed"); production
  call site is createPanelHost (factory time, once per extension session).

KEY CONSEQUENCE: the panel INSTANCE dies on suspend; anything on the class
(view, chatScroll, chatReturnView, focus, the chat editor's text) dies with it.
lastOpts carries NO view state — by design. RESUME-001's JSDoc explicitly rules
"take me to what needs answering", NOT "where you were standing" → the fresh panel
always starts in the default ("short") view. Chat survival therefore means: the
record lives in sidechat.ts module scope and REBINDS when the user re-`e`s — not
that the chat view auto-restores. (This is the reading consistent with the
architecture doc §Suspend/resume: "the fresh panel's chat view rebinds to it".)

## 2. The singleton (sidechat.ts, LANDED)

- `let current: SidechatRecord | undefined` — module scope, comment "LOAD-BEARING".
- `get()` :267 / `openOrReplace(questionId, deps)` :284 — same-questionId → returns
  the existing record BYTE-UNCHANGED, builders NOT invoked (SIDECHAT-003 frozen
  snapshot); different/none → buildFresh (each builder exactly once).
- `discard()` :484 plain delete (caller owns abort — T5.S1's contract).
- `resetSidechatForTests()` — module-scope reset (state.ts `resetState` precedent).
  THIS is the in-process restart simulation: a pi restart is a fresh module load;
  there is no other state anywhere (grep-verified: zero persistence refs).
- Header pins the whole contract: "Pi restart loses the chat silently — NO
  session-file writes of any kind; the chat lives in NONE of the three storage
  layers (h2.51). No persistence exists here by construction."

## 3. Restart no-residue surfaces (what "writes nowhere" means)

The three storage layers (h2.45): InterrogationState entries (state.ts), tool-result
`details` fields (tool.ts/results.ts), usage records / renderers (renderers.ts).
Verified: persistence.ts, state.ts, snapshots.ts, reconstruct.ts contain ZERO
sidechat references (grep). The engine's only I/O is the INJECTED nested model port
(SIDECHAT-005) — usage tallies onto the record's ChatUsage (module memory), never
the session. Source-scan test precedent: src/no-hardcoded-keys.test.ts (reads source
files and asserts). P1.M3.T1.S1 later adds the banned-main-session-API guard — a
DIFFERENT list; keep this item's scan scoped to persistence/renderer surfaces.

## 4. Non-TUI guard (panel.ts openPanel FIRST LINE)

`if (pi.mode !== undefined && pi.mode !== "tui") return false;` — architecture doc
cites :1861; in the current tree it is the first line of openPanel (:1951 region).
KEEP UNTOUCHED. Consequence chain: panel never mounts → custom() body never runs →
no InterrogationPanel → keys router unreachable → `e` cannot dispatch → inert by
construction. Existing test precedent: `test_non_tui_mode_is_guarded`
(panel.test.ts:339) — makeMockPi("rpc"), openPanel false, custom never called.

## 5. No-model-seam inertness (LANDED pieces this item verifies end-to-end)

- sidechat-engine.ts `resolveSideChatModel(...)` :137 — config.sideChatModel →
  registry find → session model → first available → undefined when nothing resolvable.
- `modelSnapshotFromModel(model | undefined)` :168 — undefined maps to the EMPTY
  marker `{provider: "", modelId: ""}`. Never throws.
- chat-view.ts: `chat.modelSnapshot.provider === ""` → inert banner (:208-212,
  `inertBannerLine` :347), text BYTE-PINNED to engine's module-private
  `INERT_NOTICE` (:183): "no side chat model available — check sideChatModel in
  your config and provider auth".
- Engine sendTurn on an inert record: refuses dispatch, appends an `error` notice
  (engine :412), settles idle. The panel NEVER blocks.
- T4.S1's host wiring builds `SidechatRebindDeps.resolveModelSnapshot` from this
  chain — with a model-less surface (test fakes, RPC ctx) it must yield the empty
  marker, not throw. VERIFY the landed wiring does exactly this.

## 6. Engine placement across suspend (the one real wiring risk)

T5.S1's discard hook and T4.S1's onSettled→invalidate live on the PANEL instance /
per-open wiring. But the record is shared module state, and a stream in flight at
suspend time keeps running into the OLD engine's closure. For "suspend→resume chat
intact" INCLUDING mid-stream: the engine (or at least the notify/settle forwarding)
must be constructed ONCE per host (module scope near the host record, reset nothing
sidechat-related in resetHostRecord), with notify/onSettled forwarding to
`currentPanel?.invalidate()` — currentPanel is the module record's live panel, so
the FRESH panel receives settles after resume. If T4.S1 landed per-open construction,
relocate to once-per-host. Fresh-panel mount renders from the live record anyway
(buildLines reads sidechat.get()), so only LATER settles need the forwarding.

## 7. Test harness facts (panel.test.ts)

- `makeMockPi(mode: string | undefined = "tui")` :118 → { pi, custom, ... };
  `firstCall(mock)` → { component, done, resolved, resolution }; `flush()` for
  microtasks; `createPanelHost(makeMockLifecycle().lifecycle)`; `optsFor(state)`.
- Precedents to mirror: test_suspend_done_null_marks_suspended_and_editor_restored
  :308; test_non_tui_mode_is_guarded :339; test_upsert_while_suspended_reopens :713;
  test_maybe_auto_open_reopens_while_suspended :1194.
- Fake SidechatRebindDeps pattern (from T4.S1 PRP): spies for builder call counts.
- Fake model port for driving a real settled turn: sidechat-engine.test.ts's
  port fakes (a port returning a pre-completed event stream).
- Naming: `test_snake_case_description`.

## 8. Out-of-scope edges (documented, not implemented here)

- Terminal-while-suspended: T5.S1's discard hook rides the panel's state.on("changed")
  subscription, which dies with the panel instance — a question that goes terminal
  DURING suspend leaves the record alive until the next post-resume mutation (or a
  later `e` on a different question replaces it). A mount-time sweep is the discard
  owner's call — do NOT duplicate T5.S1's logic here; hand off the observation.
- P1.M2.T2.S1 (second TextField) FAILED — the chat-input seam may differ from
  S2.S1's `chatField` contract on re-plan. Buffer-loss assertions must be written
  against whatever input seam exists, conditionally.
- README limitations entry is P1.M3.T3.S1 (Mode B) — no docs here.

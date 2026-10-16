# PRP — P1.M2.T4.S1: PanelView union, setView seeding, render branch, footer set, and the onChat open-or-replace action

---
name: "P1.M2.T4.S1 — PanelView 'chat' union, setView seeding, buildLines render branch, footer action set, and the onChat open-or-replace action (SIDECHAT-001/R3; AC-17.1/17.3 open path)"
description: "Add 'chat' as the fourth PanelView (panel.ts:108) with panel-owned chatScroll + chatReturnView state; setView('chat') seeding branch (scroll to bottom/latest — once-only via the unchanged-view no-op; focusChatInput via S2.S1); a buildLines 'chat' branch (shared header → chat-view.ts buildChatContent → view-aware footer with the new chat ScreenKind/action set + ACTION_WORDS entries in layout.ts); and the actions.onChat default + host wiring: singleton lives on the CURRENT question → just setView('chat'); otherwise sidechat.openOrReplace(qid, deps) (snapshot taken NOW, once — SIDECHAT-003) then setView. REPLACE the interim discussInChat call at panel.ts:652-661 — no suspend, no editor preload, main editor untouched (AC-17.1). 'e' reaches onChat from any view at non-editor focus via the existing dispatch arm. Mode A: panel.ts header doc block listing the SIDECHAT-00x contracts the panel now implements."
---

## Goal

**Feature Goal**: SIDECHAT-001 (h2.38 / h3.9): `e` opens (or reopens) a per-question side chat as a full panel view — the complete open path behind AC-17.1 (open without suspend, main editor untouched) and AC-17.3 (re-open retained, replace on question switch).

**Deliverable**: Modified `src/panel/panel.ts` (PanelView union + chatScroll/chatReturnView fields + setView "chat" branch + buildLines "chat" branch + the routed.onChat default replacing the discussInChat host refinement + [Mode A] header doc block), `src/panel/layout.ts` (ScreenKind "chat", SCREEN_KEYS chat set + narrow variant, ACTION_WORDS entries, renderFooter static hints), plus host wiring of the real sidechat deps/engine at the openPanel site, and tests in `panel.test.ts` / `layout.test.ts`.

**Success Definition**: `npm run typecheck` + `npm test` green; scripted: `e` on a question with no chat → openOrReplace called once (snapshot built once) → view "chat", scroll seeded bottom, chat input focused, header names the current question, footer shows the chat action set; `e` again on the same question → setView only, NO record rebuild (snapshot frozen); `e` on a different question → openOrReplace replaces; no discussInChat reference remains in the open path; short/deep/overview rendering byte-identical.

## User Persona

**Target User**: The TUI answerer who wants to interrogate a side model about one question ("why is sqlite recommended?") without leaving the panel or losing their place.

**Use Case**: press `e` → chat view opens against the current question → type + enter (T3.S1) → esc-exit returns to the exact prior view (`e` reopens with the transcript retained).

**Pain Points Addressed**: discuss-in-chat suspended the panel and hijacked the main editor; the chat view keeps the panel live (AC-17.1) and the transcript per-question and retained (SIDECHAT-002/003).

## Why

- h2.38 Side chat (SIDECHAT-001…005) + h3.9 Side chat flow + architecture doc `plan/005_af804251f18d/architecture/panel-view-integration.md` §"Open/replace/discard wiring": "`e` (non-editor focus, any view) → `actions.onChat(panel)` seam … if singleton lives on CURRENT question → just `setView('chat')`; else replace wholesale (snapshot NOW, once) then open. No suspend, no editor preload, main editor untouched."
- Consumes the landed engine/store contracts: `openOrReplace` (sidechat.ts:284 — same-question reuse skips ALL builder calls, SIDECHAT-003 frozen snapshot), `SidechatRebindDeps` (:211–215 — `{resolveModelSnapshot, buildSystemPrompt, buildBranchSnapshot}`), prompt/snapshot builders (P1.M1.T4.S1/S2), `createSidechatEngine` (sidechat-engine.ts:244 — UNWIRED in the host; this item wires it), chat-view renderers (P1.M2.T1.S1/S2), the second TextField + focus discipline (P1.M2.T2.S1, parallel).
- Feeds: P1.M2.T5.S1/S2 (discard hooks + suspend survival read the same view/open seams) and the AC-17 suites (P1.M3.T2.S1).

## What

[User-visible: `e` from any view (non-editor focus) opens a chat view scoped to the current question; re-`e` on the same question reopens the retained transcript; `e` on a new question starts a fresh chat (previous one replaced — one live chat). The panel never suspends for this; the main editor is untouched.]

### Behavior contract (exact)

1. **Union + state** (panel.ts:108 / state block ~:344–413): `PanelView = "short" | "deep" | "overview" | "chat"`; add panel-owned `chatScroll: number` (transcript offset, clamped via `clampChatScroll` before every store/render — chat-view.ts:178) and `chatReturnView: PanelView` (the pre-chat view; esc-exit target for T3.S1's rung; never "chat" itself).
2. **setView seeding** (panel.ts:1053–1083): add a `"chat"` branch — seed `chatScroll` to the tail (bottom/latest: set a large offset and clamp, or track "bottom" until first ↑ scroll per the T1.S1 tail-pin contract) and call `focusChatInput()` (S2.S1; no-op unless view === "chat"). The unchanged-view early return (`if (this.view === view) return;`) already guarantees once-only seeding — mirror the deep/overview branch comments. S2.S1's "setView to a non-chat view blurs chat focus FIRST" hook must keep working with the new member.
3. **Render branch** (buildLines :1445+): after the note-mode swap, add a `view === "chat"` branch alongside short (:1462)/deep (:1529)/overview (:1563): shared header (`renderHeader(snapshot, theme, width)` — same as short), then delegate the body to `buildChatContent(...)` from chat-view.ts:200 (it owns CHAT_VIEW_HEIGHT ≈ 20, scroll windowing via clampChatScroll, notices, confirm row; the chat input renders via the public readonly `chatField` per S2.S1), then `footerLine(snapshot, width, budget.narrow)` with the new chat ScreenKind. Height budget flows from the same `terminalBudget(width, this.currentRows())` call at the top of buildLines.
4. **Footer** (layout.ts): add `"chat"` to `ScreenKind` (:38); add the chat row to `SCREEN_KEYS` (:46–50) — per the architecture doc the chat footer reads `enter send · /clear · esc`, with the esc hint `abort` while streaming and `exit` idle, and names the binding when the current key ≠ the default (`e reopens the chat on q3` — the resolveKeyLabels-naming pattern, never hardcoded); add the narrow-width variant (:61 region) and ACTION_WORDS entries for any new KeyAction members; extend renderFooter's static-hint appending (:43–49 precedent: short prefixes "enter accept"; deep appends "esc back · ↑/↓ scroll") with the chat static hints. FR-10: 3–4 hints max.
5. **onChat default + host wiring** (panel.ts routed-actions block; the refinement site :652–661):
   - Default `routed.onChat = (p) => { const qid = p.currentId; if (qid === undefined) return; const record = sidechat.get(); if (record === undefined || record.questionId !== qid) sidechat.openOrReplace(qid, deps); p.chatReturnView = p.view; p.setView("chat"); }` — where `deps` is the panel-held `SidechatRebindDeps` (new nullable constructor-args field, e.g. `args.sidechatDeps`); when null the default is an inert no-op (non-TUI/test safety).
   - **REPLACE** the host refinement `if (args.pi !== undefined) { routed.onChat = (p) => { discussInChat(pi, p); }; }` (:652–661) and its "until the side-chat view lands (P1.M2.T4.S1)" comment — the real host now passes `sidechatDeps` (+ the engine wiring, see Integration) through InterrogationPanelArgs instead of overriding the action. `args.keys` (host override) still wins wholesale below — preserve that ordering. The discussInChat deletion itself is P1.M2.T7.S1 — remove the CALL here; leave discuss.ts alone.
   - NO suspend, NO editor preload (no PiUISurface / setEditorText), main editor untouched (AC-17.1).
6. **Host engine wiring** (openPanel site ~panel.ts:1861–1900 / extension setup): construct the REAL `SidechatRebindDeps` (resolveModelSnapshot via the model seam, buildSystemPrompt via sidechat-prompt.ts, buildBranchSnapshot via the P1.M1.T4.S1 pipeline) and pass via args; construct the engine once via `createSidechatEngine` (sidechat-engine.ts:244) and hand `sendTurn`/`abort` to whatever nullable seams T3.S1 defined (coordinate — if T3.S1's seams are `args.sidechatEngine`, fill them here). Also ensure record mutations invalidate the render: the engine settle path / `resetChat` must reach `panel.invalidate()` (cached-render discipline — architecture doc §4); wire an onSettled→invalidate hook at the host site if no seam exists.
7. **[Mode A] docs**: panel.ts header doc block — list the SIDECHAT-00x contracts the panel now implements (chat as a view, open-or-replace per question, frozen snapshot on reuse, no-suspend open, return-view restore).

### Success Criteria

- [ ] `e` (non-editor focus, any view) → onChat → openOrReplace exactly once when no/foreign record; setView("chat"); scroll seeded bottom; chat input focused (focus === "chat")
- [ ] Re-`e` on the SAME question → setView only; openOrReplace NOT called (builders not invoked — assert via fake deps)
- [ ] `e` on a DIFFERENT question → openOrReplace called once with the new questionId (record replaced)
- [ ] chatReturnView seeded to the pre-chat view; setView away from chat blurs chat focus (S2.S1 hook intact)
- [ ] buildLines "chat": header + buildChatContent + chat footer; short/deep/overview + note-mode branches byte-identical
- [ ] layout: chat ScreenKind renders 3–4 hints; esc hint varies with streamState (abort streaming / exit idle); binding-named when remapped
- [ ] No discussInChat call anywhere in the open path; grep `discussInChat` in panel.ts → gone (discuss.ts itself untouched — T7.S1)
- [ ] `npm run typecheck` + `npm test` green

## All Needed Context

### Context Completeness Check

Every site is anchored (union :108, setView :1053, buildLines :1445+, layout :38/:43–61, host refinement :652–661, openPanel :1861–1900), the upstream APIs are named with signatures, and the parallel-item contracts (S2.S1 chatField/focus, T3.S1 chatReturnView/engine seams) are explicitly handed off. An implementer needs nothing beyond this PRP + the repo.

### Documentation & References

```yaml
- file: plan/005_af804251f18d/architecture/panel-view-integration.md
  why: THE add-a-view recipe — union/setView/buildLines/footer/key-routing sites with anchors; the open/replace/discard wiring ruling (verbatim: if singleton lives on CURRENT question → just setView; else replace wholesale (snapshot NOW, once) then open; no suspend, no editor preload); suspend-survival ruling (singleton lives in sidechat.ts module scope — the panel instance dies on suspend); non-TUI inertness (openPanel guard :1861 untouched)
  pattern: follow the "deep"/"overview" precedents for every step

- file: plan/005_af804251f18d/P1M2T4S1/research/panel-view-integration-notes.md
  why: verified current-tree anchors + the exact onChat default pseudocode + the engine host-wiring gap (createSidechatEngine is grep-verified UNWIRED) + invalidate hookup need
  pattern: use as the work checklist

- file: src/panel/panel.ts
  why: PanelView :108; PanelFocus :111; view/focus/state block :344–413; routed-actions construction + host refinement :640–661 (the discussInChat interim to replace); render()/invalidate() cached-render discipline :679–703; setView :1053–1083 (deep/overview seeding branches to mirror); buildLines :1445+ (note swap, short :1462, deep :1529, overview :1563); openPanel/constructor args :321/:1861–1900 (editorFactory capture precedent for the new args fields)
  pattern: new view code goes where the deep/overview code lives; every setView branch documents its once-only seeding
  gotcha: buildLines reads budget ONCE at the top and threads it — the chat branch must reuse that call, not re-derive

- file: src/panel/layout.ts
  why: ScreenKind :38; SCREEN_KEYS :46–50 (+ narrow :61); ACTION_WORDS; renderFooter :488 (static-hint appending documented :43–49)
  pattern: add the chat set exactly like overview's; hints ≤4 (FR-10); esc hint is STATE-dependent (streamState) — renderFooter may need the streaming flag threaded (follow how gate warnings/flash lines pass state today)
  gotcha: never hardcode key labels — resolveKeyLabels; the "e reopens the chat on q3" naming only when current ≠ bound

- file: src/panel/sidechat.ts
  why: get() :267; openOrReplace(questionId, deps) :284 (same-question reuse skips builders — SIDECHAT-003); SidechatRebindDeps :211–215; SidechatRecord :217+ (streamState, messages, pendingConfirm); resetChat :473 (also consumes deps)
  pattern: the panel calls openOrReplace/resetChat ONLY; never mutates the record directly

- file: src/panel/sidechat-engine.ts
  why: createSidechatEngine(deps) :244 → { sendTurn, abort }; SidechatEngineDeps :106–114 (port/registry/notify/answerContext); UNWIRED — this item constructs it host-side
  gotcha: engine construction needs the model port/registry — build at the extension/openPanel site where ctx lives, NOT in panel.ts (UI-free discipline)

- file: src/panel/chat-view.ts
  why: buildChatContent :200, ChatViewState :143, clampChatScroll :178 (tail-pinned), CHAT_VIEW_HEIGHT; the S1.S2 notices/confirm row (:69 notes T3.S1/T4.S1 consumers)
  pattern: buildLines delegates body rendering wholesale — the panel only supplies header/footer/state

- files: plan/005_af804251f18d/P1M2T2S1/PRP.md (S2.S1 contract) + plan/005_af804251f18d/P1M2T3S1/PRP.md (T3.S1 contract)
  why: S2.S1 lands `chatField` (PUBLIC readonly), PanelFocus "chat", focusChatInput/blurChatInput, setView blur hook, interim handleInput branch; T3.S1 lands keys routing, the esc rung READING chatReturnView, editorFocused including "chat", engine sendTurn/abort seams
  pattern: treat both as landed; if either is missing at start, re-read the landed code and adapt (their PRPs pin the exact seams)
  gotcha: chatReturnView is READ by T3.S1's esc rung and WRITTEN by this item's onChat — define it here, "short" fallback there

- files: src/panel/panel.test.ts, src/panel/layout.test.ts, src/panel/keys.test.ts
  why: harness — makePanel-style fixtures with fake deps (mirror two-stage.test.ts/actions.test.ts fake-editor pattern); layout footer tests; the keys `e` dispatch test (P1.M1.T1.S1 landed it)
  pattern: fake SidechatRebindDeps = { resolveModelSnapshot: vi.fn(), buildSystemPrompt: vi.fn(() => "sys"), buildBranchSnapshot: vi.fn(() => []) } — assert builder CALL COUNTS for the once-only rule
```

### Current Codebase tree (relevant slice)

```bash
src/panel/
  panel.ts         # union, state, setView, buildLines, routed.onChat, host refinement — EDIT
  layout.ts        # ScreenKind, SCREEN_KEYS, ACTION_WORDS, renderFooter — EDIT
  chat-view.ts     # buildChatContent/ChatViewState/clampChatScroll — read-only (landed by T1)
  sidechat.ts      # get/openOrReplace/resetChat/records — read-only
  sidechat-engine.ts # createSidechatEngine — read-only (constructed host-side here)
  text-field.ts    # chatField construction landed by S2.S1 — read-only
  panel.test.ts / layout.test.ts — EDIT (new tests)
```

### Desired Codebase tree

```bash
# no new files
src/panel/panel.ts    # +PanelView "chat", chatScroll/chatReturnView, seeding, render branch, real onChat, Side A header doc
src/panel/layout.ts   # +chat ScreenKind/SCREEN_KEYS/ACTION_WORDS/footer hints
```

### Known Gotchas of our codebase

```ts
// CRITICAL: parallel sequencing — S2.S1 (chatField/focus "chat") is
// Implementing and T3.S1 (routing) lands next. READ the landed panel.ts
// first; if S2.S1 is absent, land the view/focus-independent parts (union,
// state, footer, deps seams) and adapt — never shadow its seams.

// CRITICAL: openOrReplace's same-question reuse skips ALL builder calls
// (SIDECHAT-003 frozen snapshot) — the once-only snapshot is the STORE's
// invariant, not the panel's; the onChat default must simply not call
// openOrReplace when record.questionId === currentId. Assert builder call
// counts in tests.

// CRITICAL: no suspend, no editor preload in onChat — the OLD discussInChat
// needed PiUISurface + setEditorText; the chat view touches NOTHING outside
// the panel (AC-17.1). Do not import discuss.ts's helpers.

// CRITICAL: chatScroll is panel-owned but CLAMPED by chat-view.ts's pure
// clampChatScroll before every store — the view module owns windowing; the
// panel owns the offset (deep-view precedent).

// The singleton lives in sidechat.ts MODULE scope — it survives suspend
// (the panel instance dies; resumeOpenPanel builds a fresh panel that
// re-reads get()). Never stash the record on the panel class.

// invalidate(): sidechat record mutations (engine settle, resetChat) are
// invisible to the cached-render discipline (render() rebuilds only on
// width/rows/state change) — wire an onSettled → panel.invalidate() hook at
// the host site or the transcript will not update after a streamed turn.

// setView's unchanged-view no-op is the once-only seeding guarantee — do
// not add a re-seed path for chat (re-entering chat keeps the scroll
// position per SIDECHAT-002 retention... EXCEPT the first entry seeds
// bottom; re-entry after esc-exit should restore, not re-seed — the no-op
// gives exactly that for view stays; entering from another view re-seeds,
// which matches "open fresh at latest").
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 0: READ landed state
  - READ panel.ts :108/:344-413/:640-661/:1053-1083/:1445-1600/:1861-1900; layout.ts :38-61/:488+; S2.S1's landed chatField/focus code; sidechat.ts :211-300; sidechat-engine.ts :106-260; confirm what engine/deps seams T3.S1 defined

Task 1: MODIFY src/panel/panel.ts — view plumbing
  - PanelView += "chat"; chatScroll + chatReturnView fields
  - setView "chat" branch: seed scroll bottom (clamp), focusChatInput, comment (once-only via no-op; mirrors deep/overview)
  - buildLines "chat" branch: renderHeader → buildChatContent(state: view/scroll/record/chatField/budget) → footerLine(chat screen)
  - [Mode A] header doc block: SIDECHAT-00x contracts implemented

Task 2: MODIFY src/panel/layout.ts — footer
  - ScreenKind += "chat"; SCREEN_KEYS.chat + narrow variant; ACTION_WORDS entries; renderFooter chat static hints + streaming-aware esc hint (thread a streaming flag if renderFooter needs it)

Task 3: MODIFY src/panel/panel.ts — the open path
  - InterrogationPanelArgs += sidechatDeps (nullable) + any T3.S1 engine seam fields
  - routed.onChat default (open-or-replace per contract); DELETE the discussInChat host refinement (:652-661) + its stale comment; args.keys override ordering preserved

Task 4: HOST WIRING (openPanel site / extension setup)
  - Build the real SidechatRebindDeps (model snapshot seam, buildSideChatSystemPrompt, branch-snapshot pipeline) and pass via args
  - Construct createSidechatEngine once host-side; wire sendTurn/abort into the seams; wire engine-settle → panel.invalidate()

Task 5: TESTS (panel.test.ts, layout.test.ts)
  - open: e via keys router (or routed.onChat directly) with fake deps → openOrReplace once (builder counts: 1 each), view "chat", focus "chat", chatScroll at bottom, chatReturnView = prior view
  - reuse: same question, second onChat → NO builder calls (frozen snapshot)
  - replace: switch currentId, onChat → openOrReplace with new qid
  - render: buildLines in chat view contains header + transcript lines + chat footer hints; note-mode + short/deep/overview byte-identical (render-compare snapshots)
  - footer: layout tests for the chat set (idle + streaming esc hints; remapped-binding naming); FR-10 count ≤4
  - no-suspend: onChat never calls suspend/done; editor text untouched
  - inert: sidechatDeps undefined → onChat no-ops (no throw)

Task 6: VALIDATE — npm run typecheck; npm test; npx vitest run src/panel/ -v; grep discussInChat src/panel/panel.ts → empty
```

### Implementation Patterns & Key Details

```ts
// The onChat default (shape only — deps via nullable args field):
routed.onChat = (p) => {
  const qid = p.currentId;
  if (qid === undefined || sidechatDeps === undefined) return; // inert safety
  const record = sidechat.get();
  if (record === undefined || record.questionId !== qid) {
    sidechat.openOrReplace(qid, sidechatDeps); // snapshot built NOW, once (SIDECHAT-003)
  }
  p.chatReturnView = p.view === "chat" ? p.chatReturnView : p.view; // keep prior on re-open
  p.setView("chat"); // seeds scroll bottom + focusChatInput (S2.S1)
};

// setView "chat" branch (mirrors deep/overview):
if (view === "chat") {
  // Tail-pin: seed past the end; clampChatScroll windows to the newest
  // lines (chat-view.ts T1.S1 contract). Once-only via the no-op above.
  this.chatScroll = Number.MAX_SAFE_INTEGER; // clamped at render via clampChatScroll
  this.focusChatInput();
}

// buildLines "chat" branch:
if (this.view === "chat") {
  const snapshot = this.state.serialize();
  const lines = [renderHeader(snapshot, this.theme, width)];
  const record = sidechat.get();
  lines.push(...buildChatContent(/* ChatViewState: record, chatField, chatScroll(clamped), budget, width */));
  const notice = this.footerNoticeLine(width);
  if (notice !== undefined) lines.push(notice);
  lines.push(this.footerLine(snapshot, width, budget.narrow));
  return lines;
}
```

### Integration Points

```yaml
ARGS (InterrogationPanelArgs):
  - sidechatDeps?: SidechatRebindDeps — host-built (model/prompt/branch builders); nullable ⇒ inert onChat
  - engine seams as T3.S1 defined them (sidechatEngine? / sendTurn/abort fields) — host fills with createSidechatEngine output

HOST (openPanel/extension):
  - construct deps + engine once per host lifetime; wire settle → panel.invalidate()

CONSUMERS:
  - P1.M2.T5.S1 discard hooks + P1.M2.T5.S2 suspend survival read get()/setView seams — do not mutate the record here
  - P1.M3.T2.S1 AC-17 scripted suite drives this open path end to end
CONFIG: none new (keys.chat landed by P1.M1.T1.S1)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # catches union/ScreenKind exhaustiveness misses (Record<ScreenKind,…> etc.)
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/panel.test.ts src/panel/layout.test.ts src/panel/keys.test.ts -v
npm test   # full suite — chat-view/sidechat/keys suites from parallel items must stay green
```

### Level 3: Scenario walkthrough (manual once routing lands; unit-level before)

```bash
pi -e .
# upsert questions → e on q1 → chat view (header q1, input focused, footer hints)
# type "why sqlite?" + enter → stream → footer esc hint flips to "abort"
# esc → back to short view where you were; e → transcript retained at same scroll
# tab to q2 → e → fresh chat (q1's replaced); /clear + enter → reset
```

### Level 4: Contract sweep

```bash
grep -n "discussInChat" src/panel/panel.ts            # expect empty
grep -rn "PanelView" src/panel/*.ts | grep -c '"chat"' # union member used across panel/layout/keys
npx vitest run                                       # regression: keymap-ac, no-hardcoded-keys gates
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean; `npm test` green (incl. parallel items' suites)

### Feature Validation

- [ ] Open path: openOrReplace-once (builder counts), reuse-without-rebuild, replace-on-switch (AC-17.1/17.3 open semantics)
- [ ] setView seeding: bottom scroll, chat focus; once-only; away-from-chat blurs (S2.S1 hook intact)
- [ ] Render: header + transcript + chat footer; other views byte-identical
- [ ] Footer: 3–4 hints; streaming-aware esc; remap-named binding
- [ ] No suspend / no editor preload / main editor untouched; discussInChat gone from the open path

### Code Quality Validation

- [ ] Only panel.ts + layout.ts + tests modified (host wiring in the openPanel site within panel.ts)
- [ ] [Mode A] header doc block listing SIDECHAT-00x contracts
- [ ] No record mutation outside sidechat.ts entry points; singleton stays module-scoped
- [ ·] Render-invalidate hookup for engine settles exists

## Anti-Patterns to Avoid

- ❌ Suspending or preloading the editor in onChat (the discuss-in-chat legacy — explicitly forbidden)
- ❌ Calling openOrReplace on same-question reopen (rebuilds the frozen snapshot — SIDECHAT-003 violation)
- ❌ Stashing the SidechatRecord or building the engine inside panel.ts's render path (module-scope singleton + host-held engine)
- ❌ Hardcoding `e`/esc hint strings (resolveKeyLabels + ACTION_WORDS; the esc hint varies with streamState)
- ❌ Re-seeding chatScroll on every render (seeding is setView's job — once-only)
- ❌ Deleting discuss.ts itself (P1.M2.T7.S1 owns the file removal; this item removes only the call)
- ❌ Shadowing S2.S1/T3.S1 seams if they haven't landed — read first, adapt

---

**Confidence Score**: 8/10 — the add-a-view recipe is fully documented with precedents, the open-or-replace contract is stated verbatim in the architecture ruling, and all upstream APIs are landed except the two parallel view items (S2.S1 implementing, T3.S1 next), whose seams are pinned by their PRPs; residual risk is sequencing drift, mitigated by Task 0's read-first step and the nullable-deps inert fallback.

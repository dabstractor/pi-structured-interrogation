# PRP — P1.M3.T1.S1: onChat abort-before-replace + usage-close notice (BUG-005 replace half + BUG-007 replace half)

---
name: "P1.M3.T1.S1 — Abort the replaced side-chat record's in-flight stream before openOrReplace and notify its usage"
description: "Fix the replace path in src/panel/panel.ts onChat (the routed.onChat handler, ~:1140-1152 — grep 'routed.onChat', the PRD's :1057-1066 anchor predates M2 drift): when a live record on a DIFFERENT question is about to be replaced, (1) abort its in-flight stream if streamState==='streaming' (record.abortController.abort()), (2) read record.usage BEFORE openSidechatRecord replaces the singleton, (3) openSidechatRecord(qid, args.chatRebindDeps), (4) p.sidechatNotify?.(formatChatCloseNotice(usage)). This mirrors the terminal-status discard hook's exact ruling order (abort FIRST → usage before discard → notify once — panel.ts onChanged hook, the landed P1.M2.T1.S1 precedent). Decide AND pin one zero-usage policy (fresh-chat replacement toasting 'chat closed · 0 in · 0 out · $0.00' — consistency with the hook's unconditional notify is recommended). Tests in src/panel/ac-sidechat.test.ts using the existing gatedStream()/convergePort()/makeHarness() helpers. /clear path is P1.M3.T2.S1 — NOT here."
---

## Goal

**Feature Goal**: Opening a side chat on a different question can never orphan an in-flight LLM call (BUG-005), and the destroyed chat's accumulated usage is always announced (BUG-007 replace half): abort-then-notify-before-replace, mirroring the close path's ruling order.

**Deliverable**: Modified `routed.onChat` handler in `src/panel/panel.ts` (+ JSDoc/comment update) + tests in `src/panel/ac-sidechat.test.ts`. No engine/sidechat.ts changes (their JSDoc already says "caller's job").

**Success Definition**: `npm test` + `npm run typecheck` green; PRD BUG-005 repro scripted: a held-open streaming chat on q3 replaced by `e` on q4 → `record.questionId === "q4"` AND the q3 port call's `signal.aborted === true`; a usage-carrying replacement fires exactly one notify with the exact humanized string; the same-question reopen path (record reused byte-unchanged) does NOT abort/notify.

## User Persona

**Target User**: TUI user who jumps mid-chat to discuss another question.

**Use Case**: Streaming reply on q3's chat; user blurs, jumps to q4, presses `e` — the old provider call must stop (no invisible token spend) and the old chat's cost must be reported.

**User Journey**: `e` on a new question → aborted stream (no leak) → new chat opens → `chat closed · 10 in · 5 out · $0.07` toast for the destroyed one.

**Pain Points Addressed**: BUG-005 — the engine's `abort()` signals the LIVE singleton only and settle's liveness guard silently no-ops the orphan, so NO user gesture could stop the replaced call; BUG-007 — replacement silently evaporated the usage tally.

## Why

- PRD h2.3/h3.4 (BUG-005) + h3.6 (BUG-007, replace half) + h2.5 recommendation: "Abort the replaced record's stream and fire the usage-close notice in onChat … mirroring the close-path ordering".
- The architecture dossier (`architecture/sidechat-engine.md` §BUG-005/§BUG-007) verified the seam firsthand: `openOrReplace` (sidechat.ts ~:283-291) JSDoc says "The old record's controller is NOT aborted (caller's job)"; the engine's `abort()` (sidechat-engine.ts ~:441-448) reads `getRecord()` — the LIVE record only; settle's liveness guard (~:360/372/385/391) makes the orphan's completion a silent no-op. onChat is the only caller with the replaced record in hand — the fix belongs there.
- Ordering precedent landed and green: the terminal-status discard hook (`panel.ts` `onChanged`, P1.M2.T1.S1) — abort-if-streaming FIRST, read usage BEFORE discard, notify once via `sidechatNotify(formatChatCloseNotice(usage))`.
- Independent seam: the replace path is not status-driven; no dependency on the parallel P1.M2.T2.S1 (applyChatAnswer terminal-consume) beyond both sharing the hook's ordering convention. `/clear`//`new` is P1.M3.T2.S1 — do NOT touch sendChatInput.

## What

### The edit (exact — against the CURRENT tree)

Locate `routed.onChat` in `src/panel/panel.ts` (grep `routed.onChat` — ~:1140; the item description's :1057-1066 anchor predates M2's drift). Current replacing branch:

```ts
    routed.onChat = (p) => {
      const qid = p.currentId;
      if (qid === undefined || args.chatRebindDeps === undefined) return;
      const record = getSidechatRecord();
      if (record === undefined || record.questionId !== qid) {
        openSidechatRecord(qid, args.chatRebindDeps); // snapshot NOW, once
      }
```

Change to:

```ts
    routed.onChat = (p) => {
      const qid = p.currentId;
      if (qid === undefined || args.chatRebindDeps === undefined) return;
      const record = getSidechatRecord();
      if (record === undefined || record.questionId !== qid) {
        // BUG-005/BUG-007: replacing a live record ABORTS its in-flight
        // stream and announces its usage — mirroring the discard hook's
        // ruling order (abort FIRST, usage BEFORE the record is gone,
        // notify once). openOrReplace deliberately does neither (its JSDoc:
        // "caller's job"); the engine's abort() reaches only the LIVE
        // singleton, so THIS is the last handle the replaced record has.
        // The aborted turn's settle rolls back onto the dead record via the
        // liveness guard — a harmless no-op.
        if (record.streamState === "streaming") record.abortController.abort();
        const closedUsage = record.usage;
        openSidechatRecord(qid, args.chatRebindDeps); // snapshot NOW, once
        p.sidechatNotify?.(formatChatCloseNotice(closedUsage));
      }
```

Notes:
- `formatChatCloseNotice` must be imported alongside the existing `openOrReplace as openSidechatRecord` / `getSidechatRecord` imports from `./sidechat.js` (panel.ts ~:93 — check which are already there).
- The notify goes AFTER `openSidechatRecord` (matching the hook's discard-then-notify order) and is unconditional-within-the-branch (zero-usage policy, below).
- **Same-question reopen path untouched**: when `record.questionId === qid` the branch is skipped entirely — no abort, no notify, record reused byte-unchanged (SIDECHAT-003 anti-rebuild).
- The aborted stream's settle fires asynchronously on the dead record; the `onChanged` hook no-ops it (`getSidechatRecord()` is the NEW record — questionId mismatch → re-seed baseline and return, per the landed seeding rule 3). Do not add anything for it.
- `p.sidechatNotify?.` — optional-chained exactly like the hook's call site.

### Zero-usage policy (decide, document, pin)

When a FRESH chat (no turns sent, `usage = {input:0, output:0, totalCost:0}`) is replaced, the notify fires `chat closed · 0 in · 0 out · $0.00`. **Recommended: keep the unconditional notify** — consistency with the discard hook (which also notifies unconditionally, including zero-usage records), simpler code, and the toast is the only feedback that a previous chat existed and was replaced. Alternative: suppress all-zero notices. Either is defensible per the item contract; pick ONE, document it in the handler comment block, and pin it in a test. If deviating from the recommendation, add `const isEmpty = (u: ChatUsage) => u.input === 0 && u.output === 0 && u.totalCost === 0;` — but do NOT suppress only some zero cases (no half policies).

### JSDoc / comment update (Mode A)

Update the comment block above `routed.onChat` (the "SIDECHAT-001 open path" paragraph, ~:1134-1139) — append after "Otherwise replace wholesale: the snapshot builders run NOW, exactly once.":

```
     * BUG-005/BUG-007: the replacement ABORTS the old record's in-flight
     * stream first and fires its usage-close notice after — the discard
     * hook's ruling order, on the one path the hook can never see (replace
     * is not status-driven). Zero-usage replacements notify too (policy:
     * unconditional, hook-consistent — <or your chosen policy wording>).
```

### Tests (src/panel/ac-sidechat.test.ts — reuse the harness)

All in the existing style (`makeHarness({ focusQuestionId, port })`, `openChat`, `sendChat`, `flush()`, `gatedStream()`, `convergePort()` — see :333/:618):

1. `test_replace_aborts_inflight_stream_and_rebinds` (BUG-005 repro, PRD steps verbatim):
   - Harness on q3; open chat; send a message over a **gatedStream** port; hold the stream open (push a delta, no terminal) until `streamState === "streaming"` is observable.
   - Blur the chat input (esc, esc per the file's blur idiom), then `o` (overview), ↓↓↓ to q4, enter (jump — sets currentId q4), then `e`.
   - Assert: `getSidechat()?.questionId === "q4"`; the q3 port call's captured AbortSignal `signal.aborted === true` (the gatedStream/fake-port fixture must expose the signal the engine passed — if the existing port fake doesn't capture it, extend the harness fake to record the `signal` argument; keep the extension local to this test's port).
   - Release the gate with a terminal event; `await flush()` — assert no throw, no extra notify from the dead settle (exactly the replace notify).
2. `test_replace_notifies_usage_close_notice_exact_string` (BUG-007): harness on q3 with `convergePort()` (its first turn carries usage `{input:10, output:5, totalCost:0.07}`); open chat, send, `await flush()` (settled, usage tallied); navigate to q4, `e` → assert `notify` called exactly once with `"chat closed · 10 in · 5 out · $0.07"` (formatChatCloseNotice's exact output — pinned format from sidechat.ts:508-511).
3. `test_same_question_reopen_does_not_abort_or_notify`: chat on q3, one settled turn; blur, exit view (esc), `e` again on q3 → record is the SAME object, `notify` NOT called with a close notice, streamState untouched.
4. `test_replace_zero_usage_policy_pin` (per the chosen policy): fresh chat on q3 (no turns), jump to q4, `e` → assert the pinned behavior (recommended: one notify `"chat closed · 0 in · 0 out · $0.00"`).
5. Keep green: all existing AC-17 suites, the discard-hook suites, and BUG-002 transition tests (the replace path must not disturb the hook's baseline seeding — note the existing `p.sidechatLastSeen` seeding AFTER the branch stays exactly where it is).

### Out of scope

- `/clear` / `/new` abort + notify — P1.M3.T2.S1 (sendChatInput command branch). Do NOT touch it.
- Overview cursor-row chat targeting — P1.M4.T2.S1 (the repro's `o ↓↓↓ enter` route is fine BECAUSE the jump syncs currentId; the fix here is orthogonal).
- sidechat.ts / sidechat-engine.ts — their contracts already delegate to the caller.
- README — P1.M6.T1.

### Success Criteria

- [ ] Held-open q3 stream replaced by q4 chat → old signal aborted, new record on q4.
- [ ] Usage-carrying replacement → exactly one notify, exact humanized string.
- [ ] Same-question reopen → no abort, no notify, record identity preserved.
- [ ] Zero-usage policy decided, documented, pinned.
- [ ] `npm test` + `npm run typecheck` green; existing side-chat suites unbroken.

## All Needed Context

### Context Completeness Check

A fresh implementer has: the exact current code at the edit site (verified), the ordering precedent (verified), the engine/sidechat contract quotes explaining WHY onChat owns this, the test harness inventory with line anchors, and the zero-usage decision framework. Line numbers shift — every site is given with a grep key.

### Documentation & References

```yaml
- docfile: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/architecture/sidechat-engine.md
  why: THE dossier — §BUG-005/§BUG-007: verified firsthand seam map (onChat no-abort/no-notify; openOrReplace JSDoc 'caller's job'; engine abort() live-record-only at ~:441-448; settle liveness guard sites ~:360/372/385/391; the terminal-status hook as ordering precedent)
  critical: the engine and store deliberately do NOT own this — only onChat holds the replaced record; do not 'fix' abort() in the engine

- file: src/panel/panel.ts
  why: BOTH the edit site (routed.onChat, grep 'routed.onChat', ~:1140-1152) and the ordering precedent (the onChanged discard hook — abort → usage-before-discard → setView close → sidechatNotify(formatChatCloseNotice(usage)), grep 'SIDECHAT-001 discard guarantee')
  pattern: copy the hook's abort/usage/notify idiom verbatim into the replace branch
  gotcha: keep the sidechatLastSeen seeding and chatReturnView/setView lines AFTER the branch exactly as-is; imports from ./sidechat.js at ~:93 (add formatChatCloseNotice if absent)

- file: src/panel/sidechat.ts
  why: openOrReplace (~:283-291 — 'The old record's controller is NOT aborted (caller's job)'); SidechatRecord fields streamState/abortController/usage (~:226-231); formatChatCloseNotice (~:508-511 — the exact string format `chat closed · N in · N out · $X.XX`, tokens humanized)
  gotcha: usage is read from the OLD record before replacement — after openSidechatRecord the old object is unreachable via getSidechatRecord()

- file: src/panel/sidechat-engine.ts
  why: abort() (~:441-448, live-record-only — quote in the comment justifying the caller-side abort); settle liveness guard — why the dead record's settle is a harmless no-op
  gotcha: DO NOT modify

- file: src/panel/ac-sidechat.test.ts
  why: the test home — makeHarness (:389-439, notify mock at :399/:435 sidechatNotify), gatedStream (:333 — test-controlled held-open stream), convergePort (:618 — first turn with usage {input:10, output:5, totalCost:0.07}), openChat/sendChat/flush idioms (see AC-17.4 suite :636+)
  pattern: follow the AC-17.4 suite's setup/await-flush rhythm; assert notify with toHaveBeenCalledWith exact string
  gotcha: the fake port must capture the AbortSignal the engine passes per-call to prove signal.aborted — extend the harness port locally if the existing fake doesn't record it

- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/P1M2T2S1/PRP.md
  why: the parallel item's contract (applyChatAnswer terminal-consume in actions.ts) — shares the hook's ordering convention but a different function/file; zero conflict; its tests live in actions.test.ts, yours in ac-sidechat.test.ts
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/panel.ts          # onChat edit + comment update (the ONLY production file)
src/panel/ac-sidechat.test.ts  # new tests (gatedStream/convergePort/makeHarness reuse)
src/panel/sidechat.ts       # read-only (formatChatCloseNotice, openOrReplace)
src/panel/sidechat-engine.ts   # read-only (abort/settle contracts quoted in comments)
```

### Desired Codebase tree

```bash
# No new files. One production file edited (panel.ts) + one test file extended.
```

### Known Gotchas

```ts
// Line anchors in the PRD/item description are STALE (onChat is ~:1140 now,
//   not :1057) — grep 'routed.onChat' for the live site.
// Read usage BEFORE openSidechatRecord — the old record becomes unreachable.
// Abort only when streamState === "streaming" (abort() on an idle record is
//   harmless but the guard documents intent and matches the hook).
// Same-question reopen MUST stay abort-free/notify-free (SIDECHAT-003).
// The dead settle's async completion is a no-op via the liveness guard —
//   do not await or handle it; just assert no EXTRA notify fires.
// sidechatNotify is optional (?.) — mirror the hook's call.
// /clear path (sendChatInput) belongs to P1.M3.T2.S1 — hands off.
// vitest fake timers/flush idioms differ per suite — use THIS file's flush().
```

## Implementation Blueprint

### Data models

None — a handler restructure; no type changes (ChatUsage flows through formatChatCloseNotice unchanged).

### Implementation Tasks (ordered)

```yaml
Task 1: TDD — write the four tests first (they fail: no abort, no notify)
  - extend the harness port to capture the per-call AbortSignal if needed
Task 2: EDIT src/panel/panel.ts routed.onChat — the abort/usage/open/notify sequence (exact code in What)
Task 3: EDIT the onChat comment block — abort-then-notify-before-replace + the zero-usage policy (Mode A)
Task 4: VERIFY imports (formatChatCloseNotice from ./sidechat.js)
Task 5: VALIDATE — npx vitest run src/panel/ac-sidechat.test.ts; npm test + npm run typecheck
```

### Implementation Patterns & Key Details

The exact replacement code and comment text are in What. The pattern is the discard hook's ruling order compressed into the replace branch: abort-if-streaming → snapshot usage → replace → notify.

### Integration Points

```yaml
CALLERS: routed.onChat fires from keys.ts chat dispatch (`e`, non-editor focus) — unchanged
CONSUMERS:
  - P1.M4.T2.S1 (overview cursor-row targeting) builds on this replace path — its tests use the natural repro route
  - P1.M6.T1 README §Side chat documents the close notice on replace
DO NOT TOUCH: sidechat.ts, sidechat-engine.ts, sendChatInput (/clear = P1.M3.T2.S1), the onChanged hook
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck    # zero errors (optional-call ?. typing, ChatUsage import only if used)
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/ac-sidechat.test.ts
npm test             # full suite — esp. AC-17.* suites and the discard-hook/BUG-002 suites
```

### Level 3: Bug-report repro (scripted, already Task 1's test 1)

The PRD's exact steps (gated stream on q3 → blur → o → ↓↓↓ → enter → e) are test 1; Level 3 IS the suite.

### Level 4: Not applicable — deterministic panel-harness tests only (AUTOMATION-POLICY: no live TUI).

## Final Validation Checklist

- [ ] `npm test` + `npm run typecheck` green
- [ ] BUG-005 repro pinned: replaced record's signal aborted; new record bound to the new question
- [ ] BUG-007 replace half pinned: one notify, exact `chat closed · 10 in · 5 out · $0.07` string
- [ ] Same-question reopen: no abort/notify; record identity preserved
- [ ] Zero-usage policy documented in the comment block + pinned test
- [ ] `git diff` = panel.ts + ac-sidechat.test.ts only
- [ ] /clear path and engine/store modules untouched

## Anti-Patterns to Avoid

- ❌ Don't move the abort into sidechat.ts/engine — the contracts explicitly delegate to the caller; the engine cannot see the replaced record
- ❌ Don't notify before openSidechatRecord's ordering rationale — hook parity is abort → usage-read → discard → notify
- ❌ Don't touch the same-question reopen path (SIDECHAT-003 anti-rebuild)
- ❌ Don't handle/await the dead record's settle — the liveness guard owns it
- ❌ Don't fix /clear or overview targeting here — P1.M3.T2.S1 / P1.M4.T2.S1 own them
- ❌ Don't trust the PRD's :1057-1066 anchor — grep `routed.onChat` for the live site

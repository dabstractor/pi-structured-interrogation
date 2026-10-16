# PRP — P1.M3.T2.S1: Abort-before-reset + usage notice in sendChatInput's command branch (BUG-005/BUG-007, /clear half)

---
name: "P1.M3.T2.S1 — /clear · /new: abort the in-flight stream before resetChat and notify its usage"
description: "Fix the reset path in src/panel/panel.ts sendChatInput (the command branch, ~:1849-1860 — grep 'private sendChatInput'): when classifyChatCommand returns '/clear' or '/new', the current code calls resetChat(this.currentId ?? '', this.chatRebindDeps) with NO abort of the in-flight stream (resetChat is caller-owns-abort by JSDoc, rebuilds with a NEW AbortController — the old controller is orphaned; the engine's abort() reaches only the LIVE singleton) and NO usage-close notice. Mirror the P1.M3.T1.S1 onChat ordering: (1) read the record; if streaming, record.abortController.abort(); (2) capture record.usage BEFORE resetChat; (3) resetChat(...); (4) this.sidechatNotify?.(formatChatCloseNotice(usage)) — with the SAME zero-usage policy P1.M3.T1.S1 pinned. 'The view stays open' and the input clearing are unchanged. Tests in src/panel/ac-sidechat.test.ts: held-open streaming on q3 with a captured signal + accumulated usage → '/clear' + enter → old signal.aborted === true, record.messages empty, usage zeroed ({input:0,output:0,totalCost:0}), view still 'chat', notify fired once with the humanized string; plus '/new' alias parity."
---

## Goal

**Feature Goal**: The `/clear`//`new` reset path can never orphan an in-flight LLM call (BUG-005 reset half), and the destroyed chat's accumulated usage is always announced (BUG-007 reset half) — identical ruling order to the landed close-path hook and the parallel onChat replace fix: abort-if-streaming FIRST, usage BEFORE the record is replaced, notify once.

**Deliverable**: Modified `sendChatInput` command branch in `src/panel/panel.ts` (+ doc-comment update) + tests in `src/panel/ac-sidechat.test.ts`. No sidechat.ts / engine changes (their JSDoc already assigns this to the caller).

**Success Definition**: `npm test` + `npm run typecheck` green; scripted: chat on q3 held-open streaming with accumulated usage → send `/clear` → the OLD AbortController's `signal.aborted === true`, the new record is fresh on the current question (`messages` empty, `usage` zeroed), `panel.view` still `"chat"`, the chat input cleared, and `notify` fired exactly once with `formatChatCloseNotice`'s humanized string; `/new` behaves identically.

## Why

- PRD h2.3/h3.4 (BUG-005) + h3.6 (BUG-007): the reset destroys the record wholesale — without an abort the orphaned provider call keeps generating unaborted with NO user gesture able to stop it (the esc rung and `abortChatStream` read the LIVE singleton only), and the usage tally silently evaporates.
- ui-spec.md:114 — slash hatches "discard all messages and usage and rebind fresh; the view stays open" (unchanged here — only abort + notice are added); ui-spec.md:118 — "any close/discard notifies compactly".
- The seam is verified firsthand: `resetChat` (sidechat.ts ~:475-478) is explicitly caller-owns-abort ("the old record's in-flight stream is NOT aborted here"); `sendChatInput` is the only `/clear` caller with the old record in hand.

## What

### The edit (exact — against the CURRENT tree)

`src/panel/panel.ts`, `private sendChatInput()` (grep `private sendChatInput` — ~:1849). Current command branch:

```ts
    const command = classifyChatCommand(text);
    if (command !== null) {
      if (this.chatRebindDeps !== undefined) {
        resetChat(this.currentId ?? "", this.chatRebindDeps);
      }
    } else if (text.trim().length > 0) {
```

Change to:

```ts
    const command = classifyChatCommand(text);
    if (command !== null) {
      if (this.chatRebindDeps !== undefined) {
        // BUG-005/BUG-007 (reset half): the slash reset replaces the record
        // wholesale — abort the old record's in-flight stream FIRST (resetChat
        // is caller-owns-abort and builds a NEW AbortController; the engine's
        // abort() reaches only the LIVE singleton, so this is the old record's
        // last handle), capture its usage BEFORE the reset eats it, then
        // notify once. Mirrors the discard hook + onChat replace ordering
        // (P1.M3.T1.S1); the aborted turn's settle no-ops via the liveness
        // guard. The view stays open (ui-spec:114) — only abort + notice.
        const record = getSidechatRecord();
        let closedUsage: ChatUsage | undefined;
        if (record !== undefined) {
          if (record.streamState === "streaming") record.abortController.abort();
          closedUsage = record.usage;
        }
        resetChat(this.currentId ?? "", this.chatRebindDeps);
        if (closedUsage !== undefined) {
          this.sidechatNotify?.(formatChatCloseNotice(closedUsage));
        }
      }
    } else if (text.trim().length > 0) {
```

- **Zero-usage policy**: follow whatever P1.M3.T1.S1 pinned for the replace path (read its PRP/landed code first) — this PRP's sketch notifies whenever a record existed (consistent with the hook's unconditional-notify lean); if S1 chose skip-when-zero-usage, match it here for coherence. Record the decision in the doc comment.
- Imports: `formatChatCloseNotice` and `ChatUsage` from `./sidechat.js` (`get as getSidechatRecord` and `formatChatCloseNotice` are already imported — verify; add `type ChatUsage` if needed). `resetChat` already imported.
- **Unchanged**: `this.chatField.setText("")` and `this.invalidate()` at the tail (input clears on the command path); the text-send and empty no-op branches; BUG-006 (input preservation on the sendTurn-refused path) is P1.M4.T1.S1's — do NOT touch the else-branch.

### Doc comment update (Mode A)

Rewrite sendChatInput's doc block (~:1832-1848): the numbered-path list gains the reset ordering — "1. `/clear`//`new` → abort the old record's in-flight stream if any, capture its usage, reset fresh on the CURRENT question, then notify the close (`chat closed · …`) — the view stays open". The "The input clears on EVERY path" paragraph is being revised by P1.M4.T1.S1 in parallel — coordinate: write YOUR paragraph so it doesn't contradict a future "input preserved on refusal" carve-out (scope your claim to the command path: "the input clears on the command and empty paths" is safe), and leave a `// P1.M4.T1.S1:` coordination note if the parallel task hasn't landed.

### Tests (src/panel/ac-sidechat.test.ts — extend the existing AC-17.2 describe)

Use the existing harness (`makeHarness`, `gatedStream`, `sendChat`, `openChat`, `blurChatBox`, `flush` — all present):

1. `AC-17.2_slash_clear_aborts_stream_and_notifies_usage`: port over `gatedStream()` with a CAPTURED signal (wrap the port to record `options.signal`); open chat on q3; send a message and push one delta but do NOT terminate (streamState "streaming"); push a prior COMPLETED turn first (or seed usage via one settled turn then start the held-open turn) so `usage` is non-zero; `sendChat(panel, "/clear")` → assert: captured `signal.aborted === true`; the (new) record `messages` empty and `usage` `{input: 0, output: 0, totalCost: 0}`; `record.questionId === "q3"` (rebound to current); `panel.view === "chat"`; chat input cleared; `notify` called exactly once with `formatChatCloseNotice(preResetUsage)` (build the expected string via the same function — byte-exact); then `finishWith` a terminal event and `flush()` — the orphaned settle no-ops (record still fresh, no extra notify).
2. `AC-17.2_slash_new_alias_parity`: identical scenario with `/new` — same assertions (byte-exact first-token alias).
3. `AC-17.2_slash_clear_idle_no_abort_still_notifies`: idle record with accumulated usage → `/clear` → no abort path taken (no throw), notify fired once, record fresh. (Pins the zero-usage / idle corners per the chosen policy.)
4. Keep the existing `AC-17.2_slash_clear_resets_on_current_question` green — it must still pass unchanged (view stays open, rebound, zeroed).

### Success Criteria

- [ ] `/clear`//`new` on a streaming chat aborts the OLD controller (signal.aborted true).
- [ ] Usage captured pre-reset → exactly one notify with the humanized string; record fresh (messages empty, usage zeroed).
- [ ] View stays "chat"; input cleared; rebound to the current question.
- [ ] Zero-usage policy matches P1.M3.T1.S1's pinned choice; doc comment records it.
- [ ] `npm test` + `npm run typecheck` green; existing AC-17 tests unbroken.

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the current sendChatInput source, the caller-owns-abort contract on resetChat, the sibling ordering precedent (P1.M3.T1.S1's landed onChat edit), the test helpers that already exist, and the coordination boundary with P1.M4.T1.S1. All below.

### Documentation & References

```yaml
- file: src/panel/panel.ts
  why: sendChatInput (~:1832-1860 — grep 'private sendChatInput'): the command branch, the doc block to revise, the tail setText/invalidate to preserve; getSidechatRecord/formatChatCloseNotice already imported (:91-92); sidechatNotify seam (:626)
  gotcha: the enter-interception above (~:1358-1375) routes chat-focus enter to sendChatInput — no changes needed there

- file: src/panel/sidechat.ts
  why: resetChat (:475-478) — caller-owns-abort JSDoc, rebuilds with a fresh AbortController; formatChatCloseNotice (:508+) — humanization rules, spec-pinned string; SidechatRecord (streamState/abortController/usage fields); ChatUsage shape {input, output, totalCost}

- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/P1M3T1S1/PRP.md
  why: THE mirrored contract — onChat abort-before-replace + notify; read its zero-usage decision and match it; if landed, read the actual code (grep 'BUG-005/BUG-007' in panel.ts) and mirror the style
  gotcha: parallel/landed — this task can land independently but MUST adopt the same policy

- file: src/panel/sidechat-engine.ts
  why: abort() reads the LIVE record only; settle's liveness guard makes the orphaned turn a harmless no-op — the reason direct record.abortController.abort() (not engine.abort()) is used

- file: src/panel/ac-sidechat.test.ts
  why: the harness — makeHarness (:389, notify capture), gatedStream (:333), sendChat/openChat/blurChatBox/flush helpers; the AC-17.2 describe (:526+) where the new tests land; the existing /clear test (:565-580) that must stay green

- file: spec/ui-spec.md
  why: :114 (slash hatches — discard + rebind fresh, view stays open) and :118 (Usage & close — any close/discard notifies compactly): the two clauses this fix reconciles

- file: plan/005_af804251f18d/bugfix/001_7ea23709b4e7/architecture/sidechat-engine.md
  why: §BUG-005/§BUG-007 — the dossier that verified the seam firsthand (caller-owns-abort, single notify site)
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
  panel.ts            # sendChatInput command branch — the edit + doc comment
  sidechat.ts         # resetChat / formatChatCloseNotice / ChatUsage (read-only)
  ac-sidechat.test.ts # extend AC-17.2 describe with 3 new tests
```

### Known Gotchas

```ts
// resetChat works with NO prior record (a first-ever /clear legally creates
// one) — guard the abort/usage/notify on record !== undefined.
// Abort the record's OWN controller directly (record.abortController.abort()),
// NOT engine.abort() — the engine reads the LIVE singleton, which after
// reset is the NEW record; aborting it would kill nothing (or the wrong thing).
// Capture usage BEFORE resetChat — the fresh record zeroes it.
// The orphaned stream's settle MUST be allowed to no-op: finish the gated
// stream after the reset in tests and assert no extra notify (liveness guard).
// Don't touch: the sendTurn-refused branch (P1.M4.T1.S1's BUG-006 fix),
// onChat (P1.M3.T1.S1's), the enter-interception above sendChatInput.
// ChatUsage field names: {input, output, totalCost} (ac-sidechat.test.ts:581
// pins the zeroed shape).
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: READ — P1M3T1S1 PRP + landed onChat code (zero-usage policy, comment style); sendChatInput current source; existing AC-17.2 tests
Task 2: EDIT src/panel/panel.ts — command branch: read record → abort-if-streaming → capture usage → resetChat → notify (record-exists guard; S1-matched zero-usage policy)
Task 3: EDIT sendChatInput doc block — reset-path ordering paragraph; command-path-scoped "input clears" claim; P1.M4.T1.S1 coordination note
Task 4: ADD tests (3) to ac-sidechat.test.ts AC-17.2 describe — streaming-abort+notify (captured signal), /new parity, idle+notify corner
Task 5: GATE — npx vitest run src/panel/ac-sidechat.test.ts src/panel/panel.test.ts; npm test; npm run typecheck
```

### Implementation Patterns & Key Details

```ts
// Captured-signal port wrapper for the abort test:
let captured: AbortSignal | undefined;
const port: SidechatModelPort = (model, ctx, opts) => {
  captured = opts.signal;         // verify the option name in sidechat-engine.ts:79-98
  return gated.stream;            // gatedStream() held open
};
// After '/clear': expect(captured?.aborted).toBe(true);
```

### Integration Points

```yaml
EDIT: src/panel/panel.ts (command branch + doc comment); src/panel/ac-sidechat.test.ts (extend)
CONSUMED: resetChat/formatChatCloseNotice/getSidechatRecord (sidechat.ts, unchanged)
POLICY MIRROR: P1.M3.T1.S1 (onChat replace) — same ordering + zero-usage decision
DOWNSTREAM: P1.M6.T1 README sync mentions the close notice on reset
DO NOT TOUCH: sendTurn branch (P1.M4.T1.S1), onChat (S1), sidechat.ts, engine
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck    # zero errors (ChatUsage import if added)
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/ac-sidechat.test.ts -v
npm test             # full suite green
```

### Level 3: Scenario replay (scripted — AUTOMATION-POLICY, no live TUI)

```bash
# The new tests ARE the replay: held-open gated stream + '/clear' →
# aborted signal, fresh record, one notify, view stays chat.
```

### Level 4: Not applicable — AUTOMATION-POLICY.

## Final Validation Checklist

- [ ] `npm test` + `npm run typecheck` green; existing AC-17.2 tests unmodified and passing
- [ ] Abort-before-reset proven (captured signal.aborted); usage notified exactly once, byte-exact string
- [ ] Record-exists guard; first-ever `/clear` with no record doesn't throw or notify
- [ ] Zero-usage policy matches P1.M3.T1.S1's pin; doc comment records it
- [ ] View stays "chat"; input cleared; no changes to sendTurn branch / onChat / sidechat.ts
- [ ] Doc comment coordinated with P1.M4.T1.S1's upcoming revision

## Anti-Patterns to Avoid

- ❌ Don't call engine.abort() — it signals the LIVE (post-reset) singleton; abort the old record's own controller
- ❌ Don't capture usage AFTER resetChat (it's zeroed by then)
- ❌ Don't add a second notify site for the same close — exactly one per discarded record
- ❌ Don't change "view stays open", the input clearing, or the /new alias semantics
- ❌ Don't implement BUG-006 input preservation here (P1.M4.T1.S1's seam — keep the else-branch byte-identical)

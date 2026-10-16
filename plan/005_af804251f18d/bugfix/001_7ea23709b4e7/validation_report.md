# Validation Report — pi-interrogator

**Validated at**: HEAD `b4c66cc` (12 commits after the PRD's `e298920` bugfix round)
**Scope**: PRD bugfix verification (BUG-001..008) + creative end-to-end validation of the side-chat surface, reconstruction, and core lifecycle.
**Method**: `validate.sh` (7 phases) — gates (eslint, tsc, vitest 1592/1592, keymap script), structural conformance, 37 runtime E2E probes driving the REAL panel + REAL side-chat engine over fake model ports through the REAL key router (two port shapes: the shipped harness's thenable `.result()` shape AND the production shape `streamSimple` actually returns — a non-thenable `AssistantMessageEventStream`), plus live `pi -p` journeys against the installed pi 1.0.2 with a real model (session-file ground truth).

## PRD Bugfix Verification — ALL 8 VERIFIED AS DESIGNED

Every bug from the prior validation round is fixed and pinned by a FIX-PIN probe (28/28 pass):

| PRD bug | Fix commit | Probe evidence |
| --- | --- | --- |
| BUG-001 confirm-row gestures dead in default focused state | f98c850, 4c1e0f7, d3e6dcc | A1a enter applies right after settle with NO manual blur; A1b single esc declines, chat stays open; A1c refocused-input + empty buffer enter applies (S2 belt); A1d/A1d2 single esc aborts a streaming reply in both focus states |
| BUG-002 chat on answered question destroyed by unrelated mutations | 1a1ea3d | A2a answering q2 keeps the q1 chat; A2b own-question transition discards; A2c re-ask survives, re-answer discards |
| BUG-003 same-value no-op apply leaves a stuck confirm row | c8b986e | A3a no-op apply consumes the row, closes the chat, fires the usage notice |
| BUG-004 overview `e` binds the wrong question | 9872a43 | A4a `e` targets the cursor-row question; A4b esc returns to the overview |
| BUG-005 mid-stream replacement orphans an unabortable LLM call | f53d0c2 | A5a the replaced record's abort controller is signalled before replacement |
| BUG-006 typed input destroyed on mid-stream enter | e38088c | A6a the draft survives with a flash; re-enter after settle sends it |
| BUG-007 missing usage-close notices on replace//clear | f53d0c2, d456757 | A7a replace notifies; A7b `/clear` notifies + resets + keeps the view; A7c mid-stream `/clear` aborts first and notifies zero usage |
| BUG-008 reconstruction drops older valid tool results | 0d06fad | A8a-hostile a throwing newest state degrades to the older VALID tool result; A8b degrades to a mirror; A8c FR-27 last-wins preserved; A8d completed-mirror exactly-once base preserved |

Live E2E (real model, session-file ground truth) also passed: extension load under pi 1.0.2, upsert digest + epoch 1, mirror persistence, answers[] → epoch 2, completion exactly-once, restart + plain turn still exactly 1 completion, post-completion upsert fresh at epoch 1, restart reconstruction of partial state (1/2 answered, epoch 2).

**However** — the runtime probes found that one of these fixes (BUG-001) is **inert against the production port shape** (NEW-001 below), and the fix round introduced/left four new defects.

## Critical Issues (Must Fix)

None.

## Major Issues (Should Fix)

### Issue 1: BUG-001's settle-blur fix is dead code in production — `settleInvalidatingPort` never fires for real streams (esc-decline dead; settled reply + confirm row never repaint)
**Severity**: Major
**ID**: NEW-001
**Location**: src/panel/panel.ts:437-459 (`settleInvalidatingPort` fires only when the port result is thenable), src/panel/panel.ts:547 (production wiring binds `streamSimplePort`), node_modules @earendil-works/pi-ai dist/api/anthropic-messages.js:713 + dist/utils/event-stream.js (`streamSimple` returns a non-thenable `AssistantMessageEventStream` — the class has no `then`/`finally`), src/panel/ac-sidechat.test.ts:739-751 (the shipped harness's `convergePort` returns `.result()` promises — thenable — so the tests exercise a port shape production never produces)

**Description**:
The BUG-001 fix (P1.M1.T1.S1) blurs the chat input from `sidechatSettleObservation`, which is only ever invoked as the `fire` callback inside `settleInvalidatingPort` — and that callback is gated on `typeof result.finally === "function"`. In production the port is `streamSimplePort` → `streamSimple(...)`, which returns an `AssistantMessageEventStream`. That class (read from the installed pi-ai 1.0.2 dist) is a plain async-iterable event queue with no `then`/`finally` — NOT thenable — so the fire callback NEVER runs for a real model reply. Reproduced at runtime with the production port shape over the real panel + real engine: after a converged reply settles, focus REMAINS `"chat"` (probe P1), a single `esc` forwards to the editor and does NOT decline (`pendingConfirm` still set — probe P3; enter survives thanks only to the S2 empty-buffer belt, probe P2), and because the fire's `invalidate()` also never runs, the render cache keeps serving the pre-settle lines — the final reply text and the `apply ★ …` confirm row never paint until an unrelated invalidation (probe P4: the render after settle is byte-identical to the mid-stream render and contains no confirm row). Net effect in a real TUI session: the user is asked to press `enter` on a row that was never drawn, `esc = no` requires the old undocumented double-esc blur workaround, and the settled reply text is invisible until the next keypress. The shipped 1592-test suite passes because the ac-sidechat harness's fake ports return `.result()` promises (thenable), diverging from the production port shape. Violates ui-spec §Side chat ("shows an inline confirm (`enter` apply · `esc` keep chatting)") and the README's "the input blurs itself the moment the row appears … no pre-blur needed".

**Steps to Reproduce** (validate.sh Phase 6, probes DEFECT-N1a/N1b/N1c):
1) Build the panel with a port returning a raw `AssistantMessageEventStream` (the exact production shape) whose reply converges on ```answer {"value":"sqlite"}`. 2) `e` → chat opens; send a message; await settle. 3) `pendingConfirm` is set but `panel.focus` is still `"chat"` — no blur (N1a). 4) Single `esc` → pendingConfirm unchanged (no decline); the stream is idle so the abort rung falls through and esc forwards to the editor (N1b). 5) Render once mid-stream, settle, render again → byte-identical cached lines; the confirm row and final reply never appear (N1c). Fix directions: fire the settle observation from the engine's own settle path (e.g. an `onSettle` dep invoked in `route()` after every terminal), or detect stream-shaped results and hook the stream's `result()` promise / end of iteration; and make the shipped harness use the stream shape for at least the blur/settle tests.

### Issue 2: The pendingConfirm key gate is not view-gated — enter/esc in OTHER views apply/decline an invisible confirm row
**Severity**: Major
**ID**: NEW-002
**Location**: src/panel/panel.ts:1361-1377 (panel-level gate: `if (this.focus !== "chat") { const pending = …pendingConfirm; … enter → onApplyConfirm; escape → clearPendingConfirm }` — no `view === "chat"` condition)

**Description**:
The confirm-row gate routes enter→apply and esc→decline whenever focus is outside the chat editor and the retained side-chat record has a `pendingConfirm` — regardless of which VIEW the panel is in. The confirm row renders only in the chat view, but a pending confirm survives leaving the view: the bare keys `o`/`d` open the overview/deep view from options focus without touching the record (unlike esc, which declines first). Reproduced at runtime: with a confirm pending and the input blurred (the fixed settle-blur state), pressing `o` then `enter` in the OVERVIEW — the documented gesture for "jump to the cursor row" — silently APPLIES the invisible confirm (q3 answered `postgres`, the chat discarded, a close notice fires; probe B1a). The same happens from the DEEP view, where enter means "select the highlighted option" (probe B1b). And `esc` in the overview — the documented "back to short view" gesture — silently DECLINES the invisible confirm (probe B1c: pendingConfirm cleared, view still overview). A user who left the chat undecided can apply an answer they cannot see from a view where enter/esc have entirely different documented meanings; there is no visual indication the confirm still exists.

**Steps to Reproduce** (probes DEFECT-N2a/N2b/N2c):
1) Chat on q3; send a message over a converging port; await settle → pendingConfirm set, input blurred, view `chat`. 2) `o` → overview (record retains pendingConfirm). 3) `enter` → q3.answer.value becomes `postgres` (the side model's value), chat discarded, notify "chat closed" — the intended cursor-row jump never happens. 4) Repeat with `d` + enter (deep view) — same invisible apply. 5) Repeat with `o` + `esc` — pendingConfirm silently cleared (invisible decline), view unchanged. Fix directions: gate the panel-level confirm branch on `this.view === "chat"`, or clear pendingConfirm when the chat view is left by any path.

## Minor Issues (Nice to Fix)

### Issue 3: No gesture refocuses the chat input after blur — "keep chatting" after a decline requires exit + reopen, and mid-sentence keystrokes get hijacked
**Severity**: Minor
**ID**: NEW-003
**Location**: src/panel/panel.ts:1846-1855 (`focusChatInput` is only called from `setView("chat")`'s seeding branch, which no-ops when the view is already chat), src/panel/panel.ts:1191 (`setView("chat")` early-returns on unchanged view), src/panel/keys.ts (bare keys d/o/t/m/e intercept from non-editor focus)

**Description**:
After the settle-blur (NEW-001's fixed path, i.e. when it works) or after declining a confirm with `esc`, the chat input is blurred (`focus = "options"`) while the view stays `chat` — and there is NO user gesture that refocuses it: pressing `e` re-enters `onChat`, but `setView("chat")` no-ops on the unchanged view so `focusChatInput` never runs; typing letters routes to the panel router where `h`/`l`/`d`/`o`/`t`/`m`/`e` are navigation/action keys and other letters fall through to the main editor — none reach the chat box (probe B4h: after decline, typing 'h','e','x' leaves the buffer empty and focus `options`). The README's confirm row advertises `esc = no` as "keep chatting", but keeping chatting requires `esc` (exit view) + `e` (reopen) — and the draft text survives only because the buffer is untouched. Worse, when the settle-blur lands WHILE the user is typing a follow-up (documented flow: typing during a stream), their NEXT keystroke is hijacked: probe B3a — mid-sentence, the reply converges, the blur fires, and the user's next letter `o` (an ordinary letter of their sentence) opens the OVERVIEW instead of typing. Fix directions: refocus the chat input on any printable key while `view === "chat"` and focus is options (or make `e` re-run `focusChatInput`), and defer the settle-blur while the buffer is non-empty.

**Steps to Reproduce** (probes DEFECT-N3a/N3b):
1) Converging reply settles (thenable path) → blurred, row shown. 2) `esc` declines the row. 3) Type `h`,`e`,`x` — nothing reaches `panel.chatField.getText()`; `h` moved the question cursor; focus stays `options`. 4) Or: while a reply streams, type `wait, what about ` and let the reply converge mid-typing → the blur fires and the next letter (`o`) opens the overview mid-sentence.

### Issue 4: Reconstruction robustness gap — a realistically corrupt (non-throwing) newest `details.state` still silently loses the whole interrogation
**Severity**: Minor
**ID**: NEW-004
**Location**: src/state.ts:491-522 (`deserialize` is fully tolerant: a non-state object yields an EMPTY state, never throws), src/reconstruct.ts:471-486 (candidate competition treats any non-throwing deserialize as a valid newest candidate)

**Description**:
The BUG-008 fix pools every state-carrying tool result and degrades "to the next-older candidate" only when `tryDeserialize` returns undefined — which only happens when `deserialize` THROWS. But `deserialize` never throws for plain objects: any object-ish payload (a hand-edited `{garbage:true}`, a wrong-typed `questions` field, a truncated-but-valid-JSON state) "deserializes" into an empty state (epoch 1, zero questions) and, being the NEWEST candidate, WINS over a perfectly valid older tool result. Probe A8a-garbage: branch `[toolResult(valid q1 state), user turn, toolResult({garbage:true})]` → the garbage candidate wins, 0 questions are installed, no panel — exactly the silent loss BUG-008 was filed to prevent. The shipped regression test passes only because its fixture uses a throwing getter (`get goal() { throw … }`), which cannot occur in a JSON-parsed session file. The realistic corruption cases (hand-edited or partially overwritten state envelopes that remain valid JSON objects) all take the tolerant-empty path. Fix directions: treat a deserialized candidate with zero questions AND no completion marker as invalid for base selection (degrade to next-older), or make `deserialize` throw for non-state shapes (empty `goal` + no `questions` key + no `order` key is not a state anyone ever wrote).

**Steps to Reproduce** (probe DEFECT-N4):
1) Craft a branch: `[message toolResult(interrogate, details.state = serialized live state with q1), plain user turn, message toolResult(interrogate, details.state = {garbage:true})]`, no mirror entries. 2) `reconstructFromBranch` → source `tool-result`, zero questions installed — the valid older tool result is ignored and the interrogation is lost, though the documented contract is degrade-to-next-older.

## Testing Summary

- Gates: eslint clean, `tsc --noEmit` clean, vitest 1592/1592, `scripts/verify-keymap-conflicts.sh` PASS.
- Runtime E2E probes (real panel + real engine, fake ports, real key router): 37 probes — 28 FIX-PIN pass (all 8 PRD bugfixes verified, both port shapes where applicable), 9 DEFECT-pinned probes fail, mapping to the 4 issues above (NEW-001 ×3 probes, NEW-002 ×3, NEW-003 ×2, NEW-004 ×1).
- Live `pi -p` journeys (real model, session-file ground truth): 9/9 pass — extension load, upsert digest/epoch, mirror persistence, answers[] epoch bump, completion exactly-once, restart exactly-once, fresh-after-completion, restart reconstruction.
- Not bugs (checked, working): FR-18 different-value apply consumes the confirm row; write-in `{text}` answers apply byte-identically; chat on a withdrawn question does not crash; `/clear` rebind semantics; supersede of a pending confirm by a later no-block reply; suspend keeps the chat record.

**Total bugs found: 4 (0 critical, 2 major, 2 minor). All 8 PRD bugs verified FIXED as designed — with NEW-001 showing the BUG-001 fix does not engage on the production port shape.**

## Recommendations

- Fix NEW-001 first: move the settle observation into the engine's terminal routing (an `onSettle` seam fired in `route()`) instead of keying off port-result thenability, and add at least one shipped test whose fake port returns the production stream shape. This single change also restores the post-settle repaint (the settle `invalidate()`).
- View-gate the panel-level pendingConfirm branch on `view === "chat"` (or clear the pending confirm when the chat view is left), so enter/esc keep their documented meanings in the overview/deep/short views (NEW-002).
- Add a chat-input refocus gesture (printable-key refocus, or make `e` re-run `focusChatInput`) and defer the settle-blur while the user's buffer is non-empty (NEW-003).
- Reject zero-question, non-completed deserialized candidates during base selection so realistically corrupt newest envelopes degrade to the older valid snapshot (NEW-004).

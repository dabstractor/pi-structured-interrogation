# Research notes — P1.M2.T2.S1 (terminal-consume: applyChatAnswer ends the chat on a no-op apply)

Primary source: `architecture/sidechat-focus.md` §BUG-003 + PRD h2.3/h3.2 — anchors verified firsthand.

## Verified anchors

### applyChatAnswer — src/panel/actions.ts :531-578
- JSDoc :531-561 explicitly delegates discard/notify/pendingConfirm-clearing: "Deliberately NOT here … pendingConfirm clearing (the hook removes the whole record when the question answers — manual clearing would race a same-value no-op)". THIS paragraph is rewritten by this item.
- Body :562-578: `record = getSidechatRecord()` (note: named `getSidechatRecord`, not `getSidechat` — PRD text says `getSidechat()`; use the real name); missing record/question → `return true`; `panel.currentId` reassignment first; writeIn seam: `panel.textField.setText(decision.text); return writeInEnter(panel);` (returns boolean, early return — the consume tail must be inserted so BOTH seams flow through it); accept seam: `return acceptOptionIndex(panel, q, decision.optionIndex) !== false` (AcceptOutcome).
- **Structural trap**: the writeIn branch `return`s directly — the new post-sequence tail must restructure both branches to fall through to it.

### acceptOptionIndex no-op — actions.ts :245-299
- `AcceptOutcome = "noop" | "accept" | "veto" | false` (:245); same-value path returns `"noop"` (:299) — advance only, NO applyAnswer, NO `changed` emit. "veto" = FR-18 modal deferral (confirmMode stashed on the panel).

### The hook to mirror — src/panel/panel.ts onChanged :961-993
Ordering: `record.streamState === "streaming" → record.abortController.abort()` FIRST → `const usage = record.usage` (read BEFORE discard) → `discardSidechatRecord()` → `if (this.view === "chat") this.setView(this.chatReturnView !== "chat" ? this.chatReturnView : "short")` → `this.sidechatNotify?.(formatChatCloseNotice(usage))`. Exactly-once via discard clearing get().

### sidechat.ts exports
- `clearPendingConfirm(record: SidechatRecord): void` (:636) — currently the esc/decline path only.
- `discardSidechatRecord()`, `formatChatCloseNotice(usage)` :508-511 (`chat closed · {n} in · {n} out · $…`), `getSidechatRecord()`, record fields `usage` (:231), `streamState`, `abortController`, `pendingConfirm` (:244).

## The decision table (why "record still alive + status terminal + no modal" is the right guard)

Post-sequence state after the seam runs, vs who closes the chat:

| scenario | seam result | record after seam | closer |
|---|---|---|---|
| real write on non-terminal q | "accept" → applyAnswer emits `changed` → hook discards synchronously | undefined | hook (unchanged) |
| real write on answered q, FR-18 victims | "veto" → confirmMode stashed, NOTHING applied | alive, modal open | applyWriteInConfirm/applyConfirmedEdit tail → real write → hook (old hook) or consume path re-entry (new hook) — do NOT close now |
| **no-op (same value, ANSWER-PIN)** | "noop" — NO emit, NO modal | **alive, status still terminal** | **THIS consume path (the fix)** |
| writeIn no-op / byte-identical | same shape as noop | alive, terminal | consume path |

So the terminal-branch condition is: `getSidechatRecord() === record` (hook did not fire) AND `panel.confirmMode === undefined` (no deferral pending) AND question status ∈ terminal-for-chat. `clearPendingConfirm(record)` runs unconditionally-on-apply when the record is alive (the offer was consumed either way — even the deferred case retires the confirm row while the FR-18 modal takes over).

## Interaction with parallel P1.M2.T1.S1 (transition-aware hook)
T1.S1 makes the hook discard only on non-terminal→terminal transitions. Consequence for THIS item: an answered-question DIFFERENT-value direct apply (no victims) no longer triggers the hook (answered→answered is not a transition) — the record stays alive, status terminal, no modal → THIS consume path closes it. The guard design above works IDENTICALLY under both hook versions (record-alive check does the discrimination). This is the contract's point 2: "the chat on answered q3 SURVIVES until this consume path ends it".

## Test recipe (PRD repro, no mocks beyond the standard fake-port)
markAnswered(q3, sqlite) → chat on q3 via convergePort proposing sqlite → send turn → pendingConfirm set → `handleInput("\r")` directly (P1.M1.T1.S1 made focused-enter route to the confirm) → assert: no-op (state unchanged, no new answer.at), `getSidechatRecord() === undefined`, view === chatReturnView, exactly ONE sidechatNotify call, render has no "apply ★"; second enter inert. AC-17.4 ordinary path (open q3 → hook-driven) stays green.

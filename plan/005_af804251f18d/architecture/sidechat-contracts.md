# Side-chat contracts — verbatim authority digest (SIDECHAT-001…005)

Source of truth: `spec/` at HEAD `d18bc39` (spec already synced; this changeset is SOURCE-ONLY).
Every downstream subtask that cites a SIDECHAT contract should quote these files, not paraphrase.

## Where each contract lives

| Contract | File / section |
| --- | --- |
| FR-15 (full side-chat functional contract) | `spec/product-requirements.md` §Functional requirements → Panel UX |
| AC-17 (acceptance runbook) | `spec/product-requirements.md` §Acceptance criteria, item 17 |
| Commitment 9 (side chats never touch the main conversation) | `spec/SPEC.md` §Core commitments |
| Key flow diagram (e → singleton → complete → parse → apply) | `spec/architecture.md` §Key flows → Side chat |
| Cache-isolation contract (SIDECHAT-005, BINDING) | `spec/architecture.md` §Side chat cache-isolation contract |
| pi API surface incl. `ctx.modelRegistry`, `getBranch()` + `sessionEntryToContextMessages`, `getEditorComponent` dual duty | `spec/architecture.md` §pi API surface used |
| Components row for `panel/sidechat.ts` | `spec/architecture.md` §Components and responsibilities |
| Module layout incl. `panel/chat-view.ts` + `panel/sidechat.ts` | `spec/architecture.md` §Module layout |
| UX rules (view/entry, singleton lifecycle, slash escapes, esc ladder, answer protocol, model & context, usage & close, non-TUI) | `spec/ui-spec.md` §Side chat (`e` — SIDECHAT-001…005) |
| Hotkey row `keys.chat` (renamed from `discuss`), two-tier intercept | `spec/ui-spec.md` §Hotkeys |
| Non-key config (`sideChatModel`, `sideChatAutoApply`) | `spec/ui-spec.md` §Hotkeys (non-key config para) |
| Empty/edge states (inert without model seam; mid-stream close aborts) | `spec/ui-spec.md` §Empty/edge states |
| Ephemeral storage ruling (NONE of the three layers) | `spec/state-and-persistence.md` §Side chat |
| M10 build note | `spec/implementation-plan.md` §Milestones → M10 |
| Risk row (nested calls: auth, cost, runaway) | `spec/implementation-plan.md` §Risks |
| Config reference JSONC (`keys.chat: "e"`, `sideChatModel`, `sideChatAutoApply`) | `spec/implementation-plan.md` §Config reference |
| Rulings SIDECHAT-001…005 | `spec/decisions.md` §2026-10-15 interrogation |

## SIDECHAT-001 — entry + discuss removal
- `e` (`keys.chat`, default `e`, TIER-2 bare key — types while an editor holds focus) opens an IN-PANEL
  chat about the current question from any non-editor focus. No suspend, no editor preload, no reopen
  round-trip. Break-out (`esc` ladder terminus) main-conversation flow is UNTOUCHED.
- `panel/discuss.ts` and its `setEditorText` preload seam are DELETED. `keys.discuss` → `keys.chat`
  with a silent deprecated alias (the focusText→elaborate precedent from plan 004).

## SIDECHAT-002 — singleton lifecycle
- Exactly ONE chat in extension memory: `{questionId, messages, streamState, abortController,
  modelSnapshot, usage}`. Opening on another question replaces it wholesale (no confirm, no
  carry-over).
- Discards when its question is answered or closed by ANY path: option accept, write-in, side-chat
  apply, moot/withdraw/upsert close. The view closes with it, landing where the accept machinery's
  advance already points. Mid-stream close aborts the stream then discards.
- Survives panel suspend/resume (module memory; `/interrogate` / `{reopen:true}` returns it).
  Pi restart loses it — NO session-file writes of any kind; no `InterrogationState` fields, no
  tool-result `details`, no custom entries, no transcript renderer may exist for it.
- `/clear` and `/new`: byte-exact match on the FIRST whitespace-delimited input token only (a
  `/usr/bin` path or markdown heading is a message) → discard messages + usage, rebind fresh to the
  CURRENT question, view stays open.

## SIDECHAT-003 — context + model
- Context = side-chat system prompt + FULL main-branch replay snapshotted ONCE at chat creation:
  `ctx.sessionManager.getBranch()` replayed via `sessionEntryToContextMessages` (exported by
  `@earendil-works/pi-agent`). Snapshot NOT refreshed mid-chat (staleness accepted v1).
- System prompt carries: role (private advisor for ONE question); the question VERBATIM with full
  description and every ramification (deep-view quality contract); the goal; a one-line-per-question
  answers digest; the answer protocol. Own system prompt → deliberately NO prefix share with the
  main conversation's cache (first turn pays full input, writes its own small prefix cache).
- Model = session's current model at chat open, overridable by `interrogator.sideChatModel`
  ("provider/model-id"). Invalid override → `notify` + fall back to session model.

## SIDECHAT-004 — answer protocol + indistinguishable provenance
- The side model is instructed to end a converged reply with a fenced ` ```answer ` block:
  `{"value": "<exact option value>"}` (choice) or `{"text": "…"}` (text/write-in).
- Panel parses the LAST such block in a COMPLETED reply — strict JSON; choice values must byte-match
  an option; malformed → in-view notice, chat stays open.
- Inline confirm row (footer-height, ripple-confirm family): `apply ★ sqlite? · enter = yes · esc = no`.
  `sideChatAutoApply: true` (default false) bypasses the confirm.
- `enter` applies through the ORDINARY seams — `acceptOptionIndex` / the write-in commit path — so
  ripple confirms, ANSWER-PIN-001 no-ops, advance, and auto-submit behave exactly as for a user
  selection. Owner ruling: submission deltas, diff cards, completion record, and tool results stay
  BYTE-IDENTICAL to user-made answers; no marker anywhere model-facing. No code path may mark an
  answer chat-derived.
- `esc` declines, keeps the chat open.

## SIDECHAT-005 — cache-isolation (binding) + usage
- The chat talks to the model EXCLUSIVELY via nested `ctx.modelRegistry` calls
  (`complete`/`streamSimple`). Banned in side-chat modules: `sendMessage` / `sendUserMessage`,
  `registerTool` / `setActiveTools`, system-prompt changes, `setModel`. Discard = plain in-memory
  delete. Rationale: providers cache by exact prefix; a nested call stream mutates none of the
  main conversation's request bytes → cache preservation is structural, not probabilistic.
- Static guard test (the `src/no-hardcoded-keys.test.ts` source-scan pattern, comments stripped):
  side-chat modules (`sidechat.ts`, `chat-view.ts`, non-test helpers) contain NO reference to
  `sendMessage` / `sendUserMessage` / `setActiveTools` / `registerTool` / `setModel`.
- Usage tallies per chat; any close/discard notifies compactly:
  `chat closed · {in} in · {out} out · ${cost}`. Usage NEVER enters session stats, entries, or
  tool results.

## UX details (ui-spec §Side chat) the view must implement
- Header: one line `chat · q3 — {prompt, truncated}`. Transcript: scrollable, user lines prefixed
  `you ›`, assistant lines plain, streaming cursor while a reply is in flight.
- Chat input: a SECOND composed-editor instance from the same `getEditorComponent()` factory —
  separate history, NO buffer scoping (messages are sent, not drafted). `enter` sends;
  `shift+enter`/`ctrl+j` newline.
- Footer `enter send · /clear · esc` — esc hint reads `abort` while streaming, `exit` when idle;
  names the binding when current ≠ bound (`e reopens the chat on q3`). Render budget + terminal
  fallbacks per the existing view discipline; ↑/↓ route to transcript scroll.
- Esc ladder: streaming → first `esc` aborts (partial text discarded — the turn never happened);
  idle → `esc` exits the view (chat retained); from the underlying view the existing ladder
  continues unchanged.
- Empty/edge: no model seam (RPC/test fakes) or no model selected → chat view opens INERT with a
  one-line notice; the panel never blocks.
- Non-TUI: `e` does nothing outside TUI (same guard as other panel-only actions).

## Config surface (exact)
```jsonc
{
  "keys": { /* … */ "chat": "e" /* renamed from "discuss"; silent alias maps old name */ },
  "sideChatModel": "anthropic/claude-sonnet-4-5",  // default: session model at chat open
  "sideChatAutoApply": false                        // default false
}
```
Config surface totals after this delta: 10 keys + 3 toggles + 2 side-chat fields (per delta PRD R1.3).

## Non-goals of this delta (do not build)
No bounded-context chat mode; no side-chat persistence; no multi-chat; no transcript renderer; no
changes to delivery / persistence / tool-protocol / renderers / state machine.

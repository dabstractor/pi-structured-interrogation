# Delta PRD — pi-interrogator: per-question side chat (SIDECHAT-001…005)

Delta from the previous PRD (completed through plan 004 — keymap trilogy, backlog P1 Complete) to the
current PRD (spec synced at `d18bc39`: "Spec sync: per-question side-channel chat replaces
discuss-in-chat (SIDECHAT-001..005)"). **Verified against the working tree at HEAD `d18bc39`.**

## 1. Diff analysis — what actually changed

The diff is ONE new feature plus its rename fallout: an **in-panel per-question side chat** driven by
nested model calls that never touch the main conversation, replacing the discuss-in-chat handoff
(Q36/old FR-15: suspend panel + `setEditorText` preload). Spec-only sync — **zero source moves**
(verified: no `sideChat`/`sidechat`/`chat-view` match in `src/`; `src/panel/discuss.ts` +
`discuss.test.ts` still present; `src/config.ts` still carries `keys.discuss: "e"`).

### Added (the whole delta)
- **SPEC.md**: intro clause ("discusses a single question in an in-panel side chat that never touches
  the main conversation"); **commitment 9** (side chats never touch the main conversation,
  SIDECHAT-001/005); non-goals (side-chat persistence/transcript visibility — ephemeral by design;
  never more than one chat at a time).
- **product-requirements.md**: goal 4 amended; **FR-15 rewritten** (full side-chat contract);
  **AC-17 added**; non-goals.
- **architecture.md**: module layout gains `panel/chat-view.ts` + `panel/sidechat.ts`; components
  row for `sidechat.ts`; new key flow "Side chat"; new binding section **§Side chat cache-isolation
  contract (SIDECHAT-005)**; pi API surface gains `ctx.modelRegistry`, `ctx.sessionManager.getBranch()`
  + `sessionEntryToContextMessages`; `getEditorComponent` now also serves the chat input; config
  surface gains `keys.chat` (renamed from `keys.discuss`), `sideChatModel`, `sideChatAutoApply`.
- **ui-spec.md**: layout bullet for the chat view; hotkey row `keys.chat` (renamed from `discuss`);
  non-key config; the "Discuss-in-chat" suspend-section bullet replaced; **new §Side chat
  (SIDECHAT-001…005)** section (view & entry, singleton lifecycle, slash escape hatches, esc ladder,
  answer protocol, model & context, usage & close, non-TUI); empty/edge states (inert without a model
  seam; mid-stream close aborts).
- **state-and-persistence.md**: new §Side chat — lives in NONE of the three storage layers; module
  singleton; two exits (replace, discard); no renderer may exist.
- **implementation-plan.md**: M6 note (discuss replaced); **new M10 milestone**; file checklist line;
  AC runbook 1–17; risk row (nested calls: auth, cost, runaway); config reference (`keys.chat`,
  `sideChatModel`, `sideChatAutoApply`).
- **decisions.md**: §2026-10-15 — SIDECHAT-001…005 rulings.

### Incidental spec corrections (already shipped — cite, no work)
- architecture.md renderers line: `pi.registerEntryRenderer ×1` → "NO entry renderer
  (MIRROR-SILENT-001)" — shipped in `e6e2f3a` (plan 004 cited it; `src/renderers.ts` has no entry
  renderer today). `config.ts` module comment losing "caps" — shipped with CAPS-OUT-001.
  `ctx.model.contextWindow` → `ctx.model` — same wave.

### Removed
- Discuss-in-chat handoff: old FR-15 (suspend + `setEditorText` preload + reopen round-trip) and its
  ui-spec block. Source: `src/panel/discuss.ts` (119 lines), `discuss.test.ts` (583 lines), the
  panel.ts:658 host-side `onDiscuss` override wiring, and the `setEditorText` seam consumer.

## 2. Scope

Implement SIDECHAT-001…005 in source: new engine module, new panel view, key/config surface, delete
discuss, static cache guard, tests, README. No state-machine, delivery, persistence, tool-protocol, or
renderers changes (the chat is invisible to all of them by design).

### R1 — Key rename and config surface
1. **Rename** `keys.discuss` → `keys.chat`: `KeyAction` union (`src/config.ts:54`), `KEY_ACTIONS`
   (:97), `DEFAULT_CONFIG.keys.discuss: "e"` (:114), `loadConfig` JSDoc row (:289),
   `RoutedActions.onDiscuss`/dispatch (`src/panel/keys.ts:145`/:372/:560), label maps
   (`src/panel/layout.ts`), keymap-guard ALL_ACTIONS list, test fixtures. Default stays `e`; still a
   TIER-2 bare key (types in editor focus — BAREKEYS-001 two-tier rule).
2. **Silent compat alias**: a settings file still carrying `keys.discuss` maps silently onto `chat`
   (exact `focusText`→`elaborate` precedent from plan 004, `coerceKeys` in `src/config.ts`); explicit
   `keys.chat` wins; the old name disappears from types and docs.
3. **New config**: `sideChatModel?: string` (default: the session model at chat open; invalid →
   `notify` + session model) and `sideChatAutoApply: boolean` (default `false`) — interface, defaults,
   coercion, JSDoc rows. Config now 10 keys + 3 toggles + 2 side-chat fields.

### R2 — `panel/sidechat.ts`: singleton store + nested LLM loop + answer parser (the engine)
1. **Singleton** `{questionId, messages, streamState, abortController, modelSnapshot, usage}` in
   module memory — exactly one, ever (SIDECHAT-002). Opening on another question replaces it
   wholesale (no confirm, no carry-over). `/clear` / `/new` (byte-exact first-token match — a
   `/usr/bin` path never triggers) discard messages+usage and rebind fresh to the CURRENT question,
   view stays open.
2. **Context (SIDECHAT-003)**: one-shot snapshot at chat creation — `ctx.sessionManager.getBranch()`
   replayed via `sessionEntryToContextMessages` (exported by the installed `@earendil-works/pi-agent`
   — verified in node_modules .d.ts) + the side-chat system prompt (question VERBATIM with full
   description and every ramification — the deep-view quality contract; the goal; a one-line-per-
   question answers digest; the answer protocol). Own system prompt → no prefix share with the main
   conversation's cache. Snapshot is NOT refreshed mid-chat (accepted v1 staleness).
3. **Loop**: nested `ctx.modelRegistry.complete/streamSimple` calls only (in-repo precedent:
   `src/compaction.ts:172`; upstream precedent: pi's `qna.ts` example — AbortController signal,
   stopReason handling). Model = session model at open unless `sideChatModel`. Auth errors surface as
   in-view notices; the panel never blocks.
4. **Answer protocol (SIDECHAT-004)**: parse the LAST fenced ` ```answer ` block in a completed
   reply — strict JSON, `{"value": "<exact option value>"}` (byte-match an option) or
   `{"text": "…"}`; malformed → in-view notice, chat stays open. Confirm row
   `apply ★ sqlite? · enter = yes · esc = no`; `sideChatAutoApply: true` bypasses. Apply routes
   through the ordinary seams (`acceptOptionIndex` / write-in commit) so ripple confirms,
   ANSWER-PIN-001 no-ops, advance, and auto-submit behave exactly as for a user selection.
   **Provenance is indistinguishable**: no code path may mark an answer chat-derived anywhere
   model-facing (deltas, cards, completion record, tool results).
5. **Usage tally** per chat; compact close/discard notify `chat closed · {in} in · {out} out · ${cost}`;
   never enters session stats, entries, or tool results.

### R3 — `panel/chat-view.ts`: the view + second editor + esc ladder
1. **View**: one-line header (`chat · q3 — {prompt, truncated}`), scrollable transcript (user lines
   `you ›` prefixed, assistant plain, streaming cursor while in flight), chat input, footer
   `enter send · /clear · esc` (esc hint reads `abort` while streaming, `exit` when idle). Render
   budget + terminal fallbacks per the existing view discipline; footer names the binding when
   current ≠ bound (`e reopens the chat on q3`).
2. **Input**: a SECOND composed-editor instance from the same `getEditorComponent()` factory
   (`src/panel/text-field.ts` `EditorFactory` — separate history, NO buffer scoping: messages are
   sent, not drafted). `enter` sends, `shift+enter`/`ctrl+j` newline.
3. **Esc ladder**: streaming → first `esc` aborts (partial text discarded); idle → `esc` exits the
   view (chat retained); from the underlying view the existing ladder continues unchanged.

### R4 — Panel integration: open/replace/discard hooks, suspend survival, non-TUI inert
1. `PanelView` gains `"chat"` (`src/panel/panel.ts:108`); `e` (non-editor focus, any view) opens on
   the current question — no suspend, no editor preload.
2. **Discard when its question is answered or closed by ANY path** (option accept, write-in,
   side-chat apply, moot/withdraw/upsert close): hook the accept/close seams to discard the singleton
   and close the view, landing where the accept machinery's advance already points. A chat whose
   question closes MID-STREAM aborts the stream and discards.
3. **Survives suspend/resume** like drafts (module memory); `/interrogate` / `{reopen:true}` resume
   returns it. Restart loses it — no session-file writes of any kind.
4. **Non-TUI**: inert (`e` does nothing outside TUI — same guard as other panel-only actions).

### R5 — Cache-isolation static guard test
New guard (the `src/no-hardcoded-keys.test.ts` pattern — source-scan, comments stripped): side-chat
modules (`sidechat.ts`, `chat-view.ts`, and their non-test helpers) contain no reference to
`sendMessage` / `sendUserMessage` / `setActiveTools` / `registerTool` / `setModel`. Binding contract:
SIDECHAT-005 (architecture.md).

### R6 — Delete discuss-in-chat end-to-end
Delete `src/panel/discuss.ts` + `src/discuss.test.ts` seams (the panel.test-level `discuss.test.ts`
in `src/panel/`), the `panel.ts:658` host-side `onDiscuss` override (`discussInChat` + its
`PiUISurface` injection), and every `setEditorText` consumer that exists only for the handoff. The
esc break-out main-conversation flow is UNTOUCHED.

## 3. Documentation impact

**Mode A (ride with the work):**
- `src/config.ts` `loadConfig` JSDoc: keys-table row `chat` (renamed, purpose: open the per-question
  side chat) + `sideChatModel` / `sideChatAutoApply` rows.
- `src/panel/keys.ts` module docs: dispatch + two-tier note for the chat key; `panel.ts`/`sidechat.ts`
  /`chat-view.ts` header doc blocks stating the SIDECHAT-00x contracts they implement (the codebase's
  existing Mode A discipline).
- Silent-alias maintainer comment at the `coerceKeys` alias site (one line; the name `discuss` must
  NOT appear in any doc).

**Mode B (changeset-level, final task — depends on all above):**
- `README.md`: new Side chat section (entry key, singleton/replacement semantics, `/clear` `/new`,
  answer-block confirm + autoApply, usage-on-close, ephemerality); keymap table row `discuss → chat`;
  sample settings gains `sideChatModel`/`sideChatAutoApply`; limitations list gains side-chat
  ephemerality; keymap-conflict re-verification re-run and recorded (`scripts/verify-keymap-conflicts.sh`
  — expected: `e` unchanged, no new conflicts).

## 4. Acceptance criteria (AC-17, from product-requirements.md — plus scripted coverage)

1. `e` on q3 → chat view opens on q3 with NO suspend (panel stays host; main editor untouched).
2. A two-turn exchange streams in-view; `/clear` resets it fresh on the current question.
3. `e` on q5 → the q3 chat is gone (singleton, replaced wholesale).
4. Converge on a ` ```answer ` block → confirm row → `enter` → the answer applies indistinguishably
   from a panel selection (identical delta/card bytes), advance + auto-submit flow as usual, the chat
   vanishes. With `sideChatAutoApply: true` no confirm appears.
5. Answering q7 via the panel while its chat is open → that chat is gone.
6. `esc`-suspend + `/interrogate` → the surviving chat returns; pi restart → no chat and NO
   session-file residue (no entries, no usage records, transcript shows nothing).
7. Static guard: side-chat modules contain none of the banned session-mutating calls.
8. Malformed ` ```answer ` JSON → in-view notice, chat stays open; `esc` while streaming aborts;
   `/usr/bin/env` types as a message (never a command).

## 5. Reference completed work / prior research

- **Rename precedent**: plan 004 P1.M1.T1.S2 (focusText→elaborate silent alias in `coerceKeys`) —
  copy the pattern exactly.
- **Editor composition**: `src/panel/text-field.ts` (`EditorFactory`, `TextField`) — instantiate a
  second instance for the chat input; history separation precedent already there.
- **Nested model calls**: `src/compaction.ts:125–180` (model resolution fallback
  `ctx.model ?? modelRegistry.getAvailable()[0]`, `complete` with signal) + pi's `examples/extensions/qna.ts`
  (getBranch walk, AbortController, stopReason handling).
- **View discipline**: `deep-view.ts`/`overview.ts` render-budget, terminal fallbacks, cached-render
  pattern; `keys.ts` two-tier intercept + fixed branches (chat view must route ↑/↓ to transcript
  scroll, `enter`/`esc` per §Side chat).
- **Guard-test pattern**: `src/no-hardcoded-keys.test.ts` scanner (string-aware comment stripping,
  targeted file set).
- **Prior research**: `plan/004_49e25d5235a9/architecture/` covers the keymap/config surface (keys-and-
  actions.md §6/§7, config-surface.md §1–§3) — still accurate for the rename slice; nothing there
  covers side chat (new research needed for the modelRegistry/streamSimple seam and branch snapshot).

## 6. Suggested build order (breakdown input)

1. **M1 — engine + config** (R1, R2): rename+alias+config; `sidechat.ts` store, snapshot, system
   prompt, loop, parser, usage — all unit-testable UI-free.
2. **M2 — view + integration** (R3, R4, R6): `chat-view.ts`, PanelView `"chat"`, open/replace/discard
   hooks, esc ladder, delete discuss.
3. **M3 — guards, ACs, docs** (R5 + Mode B): static guard, AC-17 scripted coverage, suite sweep,
   README + conflict re-verification.

Non-goals of this delta: no bounded-context chat mode, no side-chat persistence, no multi-chat, no
transcript renderer, no changes to delivery/persistence/tool-protocol.

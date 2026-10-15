# Architecture — pi-interrogator

Single pi extension (TypeScript, jiti-loaded), TUI-first with graceful non-TUI fallback. No pi core changes; public extension APIs only.

## Module layout

```
pi-interrogator/
├── index.ts                  # factory: registers tool, command, events, renderers
├── config.ts                 # defaults + settings load (keymap, toggles)
├── state.ts                  # InterrogationState: questions, answers, drafts, rev/epoch, snapshots
├── tool.ts                   # interrogate tool: schema, guards, actions, fallback formatting
├── panel/
│   ├── panel.ts              # InterrogationPanel component (ctx.ui.custom host)
│   ├── short-view.ts         # short form rendering
│   ├── deep-view.ts          # scrollable deep view rendering
│   ├── overview.ts           # `o` list
│   ├── text-field.ts         # embedded editor wrapper (factory composition)
│   ├── chat-view.ts          # side-chat view rendering (SIDECHAT-001)
│   ├── sidechat.ts           # singleton chat store + nested LLM loop + answer parser
│   └── keys.ts               # key routing: config-driven, panel-intercept rules
├── fallback.ts             # non-TUI digest + chat answer recording
├── lifecycle.ts              # auto-close on agent_settled, reopen, suspend/resume, widget
├── renderers.ts              # registerMessageRenderer cards (submission + completion); NO entry renderer (MIRROR-SILENT-001)
├── persistence.ts            # details mirroring, session_start reconstruction
└── detect.ts                 # plain-text question-round heuristic + notify (FR-26)
```

## Components and responsibilities

| Component | Responsibility |
|---|---|
| `tool.ts` | Validates params, enforces rev/epoch guards, mutates state via `state.ts`, returns result text + `details` (full state snapshot) |
| `state.ts` | Single in-memory source of truth. Never touches UI. Emits change events for panel/widget/renderers |
| `panel/*` | The bottom-dock UI while open. Owns drafts (typed-not-submitted answers + batch note), the Other write-in row + two editor duties (WRITEIN-001), and the completeness auto-submit hook (AUTOSUBMIT-001) |
| `panel/sidechat.ts` | The ONE live side chat (SIDECHAT-001): singleton store, one-shot branch snapshot + system-prompt builder, nested `modelRegistry` loop with abort, ` ```answer ` parser, usage tally. Never touches the session (cache-isolation contract below) |
| `delivery.ts` | Builds delta custom messages (`interrogation-submission`) and the one-time completion record |
| `lifecycle.ts` | Panel open/suspend/resume orchestration, `agent_settled` auto-close, suspend widget, reopen handling |
| `persistence.ts` | Mirrors state to `interrogation-state` custom entries (debounced); reconstructs on `session_start` |

## Key flows

### Ask (non-blocking)
```
model → interrogate({goal, questions[]})
  tool.ts: validate → guards (rev/epoch on updates) → state.upsert (merge rules)
         → mirror to custom entry
  lifecycle.ts: open panel (TUI) / mark pending (non-TUI)
  tool returns: "Questions visible to the user. {status line}
                 End your turn with a one-line note; do not call further tools."
  agent ends turn. Panel persists while idle.
```

### Submit (partial, immediate; auto-submits at completeness — AUTOSUBMIT-001)
```
user ctrl+s (panel) — OR maybeAutoSubmit after ANY answer commit (option accept,
  Other write-in, text enter, edit re-commit) while zero open/reasked questions remain
  panel flushes pending answers into state (applying FR-18 ripple confirms already done at edit time)
  gate questions unanswered → NO auto-submit; ⚠ footer line instead (ctrl+s overrides)
  delivery.ts: sendMessage customType "interrogation-submission"
      content  = "Submitted {k}: {id→value list, changed marked} (state epoch {n})\n
                  Consider how these affect your other questions."
      details  = full diff card data (renderer draws user-only card)
  state: epoch++, snapshot for revert-style diffs (and post-hoc recovery)
  model replies → lifecycle watches tool_execution_end for upserts
  agent_settled → close submitted unless re-asked this run (aborts count as settled)
```

### Read / refresh
```
model → interrogate({})
  returns: goal, epoch, group summary, per-question {id, title, status, rev, answer?}, ~1 line each
```

### Side chat (SIDECHAT-001; replaces discuss-in-chat)
```
e (panel, non-editor focus) → sidechat.ts singleton ← {questionId, branch snapshot, system prompt}
  live chat on this question → reuse (view opens on it)
  chat on another/no question → replace/create (branch snapshot taken NOW, once)
enter (chat input) → modelRegistry.complete/streamSimple(model, {system, branch+turns})
  streamed into chat-view.ts · esc aborts (AbortController) · /clear|/new resets the singleton
reply ends with fenced ```answer block → parse (LAST block, strict JSON, value byte-match)
  confirm row (sideChatAutoApply bypasses) → acceptOptionIndex / write-in seam
  → ordinary ripple/advance/auto-submit · chat discards (question answered)
question answered/closed by ANY path → singleton discarded, view closes
```
NO write ever reaches the session from this path: no sendMessage, no appendEntry,
no transcript entries, no usage records. (discuss.ts + its setEditorText seam: DELETED)

### Stale guard rejection
```
model upsert carries rev 2 / epoch 4; actual rev 5 / epoch 9
  tool returns isError result:
  "STALE: q3 is at rev 5 (you sent 2); session epoch is 9 (you sent 4).
   Current q3: {text}. Changes since epoch 4: {delta digest}. Re-apply against current state."
```

### Completion
```
last open question closes (agent_settled, no re-ask)
  delivery.ts: sendMessage customType "interrogation-completion"
      content  = full Q&A record (goal + every question, answer, note) — the ONE full injection
      details  = recap card data
  lifecycle: dismiss panel; clear state (keep entries for audit)
```

### Suspend / resume / reopen
```
esc (view-descent terminus) or completion dismissal → panel.done(null) (suspend) → setWidget reminder line
   line: "{n} open · {m} answered — /interrogate to resume" (command only; NO key chord)
/interrogate → INVOKE-ONLY, immediate in every scenario:
   open → silent no-op (never suspends) · suspended ∧ live → resume · closed ∧ live state → fresh open
resume: re-instantiate panel from state + preserved drafts
agent {reopen:true} → same resume path (no guard; judgment trusted)
side chat survives suspend like drafts do (module memory — §Side chat cache-isolation contract)
```

### Restart / resume session
```
session_start → persistence: walk buildContextEntries()
    latest interrogate tool-result details = base state
    replay subsequent interrogation-submission messages (deltas) on top
    fallback: scan interrogation-state custom entries
  mode==="tui" → NEVER auto-open the panel (SURFACE-002)
    set the suspend widget line when resumable questions exist (the only cue);
    /interrogate opens on demand (drafts not restored)
```

### Tree navigation (`session_tree`) — SILENT
```
session_tree → same reconstruction walk against the new branch
  state follows the branch (reset + rebuild + replay + moot recompute)
  NEVER open/reopen the panel
  panel open → suspend (stale-branch content must not linger)
  panel suspended → stays suspended; host state refs retargeted
    (next /interrogate, model upsert, {reopen:true} resumes branch-correct)
  branch without (live) interrogation → full teardown (widget + record)
```

## pi API surface used

- `pi.registerTool` (interrogate; `renderCall`/`renderResult` compact rows)
- `pi.registerCommand` ("/interrogate": invoke panel — open/resume, never toggle; no live state → notify)
- (no `pi.registerShortcut` — the ctrl+shift+q global chord was removed: window managers claim it to close windows on many desktop environments)
- `pi.on`: `session_start`, `session_tree` (silent reconstruction — never a surface), `agent_settled`, `tool_execution_end` (detect upserts for auto-close), `session_before_compact`, `session_shutdown`
- `ctx.ui.custom` (panel host), `ctx.ui.setWidget` (suspend reminder), `ctx.ui.getEditorComponent` (compose user's editor — the answer duties AND the side-chat input), `ctx.ui.notify`
- `ctx.modelRegistry` (side chat ONLY — provider-neutral nested model calls), `ctx.sessionManager.getBranch()` + `sessionEntryToContextMessages` (one-shot branch snapshot for the chat context)
- `pi.sendMessage` (submission/completion custom messages), `pi.appendEntry` (state mirror)
- `pi.registerMessageRenderer` ×2 (submission delta + completion recap cards); NO entry renderer — the `interrogation-state` mirror entries stay durable but transcript-invisible (MIRROR-SILENT-001)
- `ctx.mode` / `ctx.hasUI` guards throughout; `ctx.model` for compaction model resolution

## Side chat cache-isolation contract (SIDECHAT-005 — binding)

The side chat talks to the model exclusively through nested `ctx.modelRegistry` calls. It MUST NOT call `pi.sendMessage` / `pi.sendUserMessage`, register or activate tools (`registerTool` / `setActiveTools`), change the system prompt, or switch the session model; discarding a chat is a plain in-memory delete. Rationale: pi re-sends the full conversation per turn and providers cache by exact prefix (anthropic-style `cache_control` at system / last tool / tail); the main conversation's cached prefix breaks only via message-prefix mutation, system/tool-set change, model switch, or idle TTL — a nested call stream does none of those, so the main session's next request is byte-identical and cache preservation is structural, not probabilistic. The chat runs under its own system prompt (deliberately no prefix share with the main conversation): the first turn of each new chat pays full input for the replayed branch and writes its own small prefix cache; later turns hit it. The main conversation is idle whenever the panel is open regardless (the tool returns immediately; submissions are the only turn trigger), so the side chat adds no idle-TTL risk. A static guard test (the `no-hardcoded-keys.test.ts` pattern) enforces the ban list: side-chat modules contain no `sendMessage` / `sendUserMessage` / `setActiveTools` / `registerTool` / `setModel` reference.

## Event subscriptions table

| Event | Handler |
|---|---|
| `session_start` | reconstruct state; set the suspend widget when resumable questions exist — NEVER auto-open the panel (FR-28, SURFACE-002) |
| `session_tree` | reconstruct state SILENTLY — never opens/reopens the panel; open panel suspends; no-residue teardown on branches without interrogation (FR-28 scope) |
| `agent_settled` | auto-close pass (FR-4); completion check (FR-5) |
| `tool_execution_end` | record whether this agent run upserted (feeds auto-close); `maybeAutoOpen` opens the panel ONLY for upsert calls leaving unanswered questions (SURFACE-001 — reads never surface) |
| `session_before_compact` | return customInstructions (FR-29) |
| `session_shutdown` | flush mirror entry |

## Data shapes (authoritative in tool-protocol.md / state-and-persistence.md)

- `InterrogationState`: `{ goal, epoch, questions: Map<id, Question>, order: string[], snapshots: Snapshot[] }`
- `Question`: `{ id, title?, prompt, description?, type, options?[], recommendation?, group?, gate?, dependsOn?[], rev, status, answer? }`
- `Draft` (panel-local): `{ value, text }` per question + `batchNote`
- Submission message `details`: `{ changed: [{id, from, to}], note?, epoch, card: FullCardData }`

## Config surface (all hotkeys + toggles)

Loaded from pi `settings.json` under `"interrogator"` key; deep-merged over defaults. See ui-spec.md §Config for the full reference including every keymap entry and toggle flags (`gateWarnings`, `roundDetection`). Side chat: `keys.chat` (renamed from `keys.discuss`), `sideChatModel`, `sideChatAutoApply`.

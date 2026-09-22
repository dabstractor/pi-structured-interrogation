# Architecture — pi-interrogator

Single pi extension (TypeScript, jiti-loaded), TUI-first with graceful non-TUI fallback. No pi core changes; public extension APIs only.

## Module layout

```
pi-interrogator/
├── index.ts                  # factory: registers tool, command, events, renderers
├── config.ts                 # defaults + settings load (keymap, caps, toggles)
├── state.ts                  # InterrogationState: questions, answers, drafts, rev/epoch, snapshots
├── tool.ts                   # interrogate tool: schema, guards, actions, caps, fallback formatting
├── panel/
│   ├── panel.ts              # InterrogationPanel component (ctx.ui.custom host)
│   ├── short-view.ts         # short form rendering
│   ├── deep-view.ts          # scrollable deep view rendering
│   ├── overview.ts           # ctrl+l list
│   ├── text-field.ts         # embedded editor wrapper (factory composition)
│   └── keys.ts               # key routing: config-driven, panel-intercept rules
├── fallback.ts             # non-TUI digest + chat answer recording
├── remote-bridge.ts        # pi-ask bridge contract: event emission + submit handling (FR-31..34)
├── remote-submit.ts        # bridge-submission pipeline (mirrors panel ctrl+s ordering)
├── lifecycle.ts              # auto-close on agent_settled, reopen, suspend/resume, widget
├── renderers.ts              # registerMessageRenderer / registerEntryRenderer cards
├── persistence.ts            # details mirroring, session_start reconstruction
└── detect.ts                 # plain-text question-round heuristic + notify (FR-26)
```

## Components and responsibilities

| Component | Responsibility |
|---|---|
| `tool.ts` | Validates params, enforces caps + rev/epoch guards, mutates state via `state.ts`, returns result text + `details` (full state snapshot) |
| `state.ts` | Single in-memory source of truth. Never touches UI. Emits change events for panel/widget/renderers |
| `panel/*` | The bottom-dock UI while open. Owns drafts (typed-not-submitted answers + batch note), the Other write-in row + two editor duties (WRITEIN-001), and the completeness auto-submit hook (AUTOSUBMIT-001) |
| `delivery.ts` | Builds delta custom messages (`interrogation-submission`) and the one-time completion record |
| `lifecycle.ts` | Panel open/suspend/resume orchestration, `agent_settled` auto-close, suspend widget, reopen handling |
| `remote-bridge.ts` | Speaks the pi-ask bridge contract on `pi.events` (`started`/`submit`/`submit-result`/`completed`); accepts bridge submits; resurface-after-partial-submit; flow registry with foreign/stale filtering |
| `remote-submit.ts` | Bridge answers → state → submission delta (same ordering contract as `panel/actions.submit`) |
| `persistence.ts` | Mirrors state to `interrogation-state` custom entries (debounced); reconstructs on `session_start` |

## Key flows

### Ask (non-blocking)
```
model → interrogate({goal, questions[]})
  tool.ts: validate → caps → guards (rev/epoch on updates) → state.upsert (merge rules)
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
discuss-in-chat: like suspend, plus setEditorText with quoted question + options
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
  NEVER open/reopen the panel; never re-emit the bridge flow
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
- `ctx.ui.custom` (panel host), `ctx.ui.setWidget` (suspend reminder), `ctx.ui.getEditorComponent` (compose user's editor), `ctx.ui.setEditorText` (discuss handoff), `ctx.ui.notify`
- `pi.sendMessage` (submission/completion custom messages), `pi.appendEntry` (state mirror)
- `pi.events.on/emit` (`@eko24ive/pi-ask:*` contract; emission inert without remote-pi listening)
- `pi.registerMessageRenderer` ×2, `pi.registerEntryRenderer` ×1
- `ctx.mode` / `ctx.hasUI` guards throughout; `ctx.model.contextWindow` for cap scaling

## Event subscriptions table

| Event | Handler |
|---|---|
| `session_start` | reconstruct state; set the suspend widget when resumable questions exist — NEVER auto-open the panel (FR-28, SURFACE-002) |
| `session_tree` | reconstruct state SILENTLY — never opens/reopens the panel; open panel suspends; no-residue teardown on branches without interrogation (FR-28 scope) |
| `agent_settled` | auto-close pass (FR-4); completion check (FR-5) |
| `tool_execution_end` | record whether this agent run upserted (feeds auto-close); `maybeAutoOpen` opens the panel ONLY for upsert calls leaving unanswered questions (SURFACE-001 — reads never surface) |
| `session_before_compact` | return customInstructions (FR-29) |
| `session_shutdown` | flush mirror entry; dispose remote bridge (complete outstanding flows) |

### Bridge submit (pi-ask contract; FR-32)

```
bridge client submit → remote-pi (or any conformant bridge) emits @eko24ive/pi-ask:submit
  remote-bridge.ts: parse → flowId registry check (foreign/stale/malformed filtered)
  remote-submit.ts: validate answers vs current options → applyAnswer ×n
      → baseline/computeDiff/pendingIds (BUG-008 filter) → markSubmitted
      → buildSubmission (snapshot+bump once) → deliverSubmission (steer|followUp)
      → lifecycle.noteSubmissionDelivered()
  emit submit-result ok:true → completed (resolve the flow)
  → remaining live questions + remote.resurface? emit fresh flow (ask:replay)
model receives interrogation-submission delta → replies (identical to panel ctrl+s)
```
| `session_shutdown` | flush mirror entry |

## Data shapes (authoritative in tool-protocol.md / state-and-persistence.md)

- `InterrogationState`: `{ goal, epoch, questions: Map<id, Question>, order: string[], snapshots: Snapshot[] }`
- `Question`: `{ id, title?, prompt, description?, type, options?[], recommendation?, group?, gate?, dependsOn?[], rev, status, answer? }`
- `Draft` (panel-local): `{ value, text }` per question + `batchNote`
- Submission message `details`: `{ changed: [{id, from, to}], note?, epoch, card: FullCardData }`

## Config surface (all hotkeys + caps + toggles)

Loaded from pi `settings.json` under `"interrogator"` key; deep-merged over defaults. See ui-spec.md §Config for the full reference including every keymap entry, cap formula parameters, and toggle flags (`gateWarnings`, `roundDetection`, `digitQuickSelect`).

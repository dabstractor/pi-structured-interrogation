# pi-interrogator — SPEC

Structured interrogation for the pi coding agent: the model asks dozens of planning questions through a single `interrogate` tool; the user answers them in a persistent bottom-dock panel that never scrolls away, submits partial answers any time, breaks out for side conversations, and edits answers as understanding evolves. The extension is the source of truth for question/answer state; the model reads and updates it through guards that make stale views fail loudly (like `edit`'s oldText and `write`'s read-before-write).

**Package:** `pi-interrogator` · **Tool:** `interrogate` · **Command:** `/interrogate`

## Core commitments (do not deviate)

1. **Non-blocking tool** — `interrogate` returns immediately after loading questions; the turn ends; the panel persists while idle. Answers flow back later as small delta messages that trigger a new reply. No tool call ever waits on the user.
2. **Pull-based state** — the extension's in-memory JSON is the single source of truth. Submissions deliver *deltas* (~2 lines) plus a reminder line. The model refreshes by calling `interrogate({})`. The full record is injected into the conversation exactly once, at completion. Per-request context injection is explicitly forbidden (user veto).
3. **Replace-editor panel** — while questions are open, the panel *is* the bottom editor region (`ctx.ui.custom()`, non-overlay); the chat transcript stays visible above. Break-out suspends it; a widget above the main editor keeps it findable.
4. **Commit-everything-up-front** — the model sends *all* questions in the first upsert. Gating (soft) controls interaction order only, never what exists. Display gating is never commit gating.
5. **Staleness guards** — every question has a `rev` (content version); the session has an `epoch` (bumped per submission). State-changing calls must echo both; mismatches are rejected with current state so the model self-heals in one round trip.
6. **Drafts are sacred** — typed-but-unsubmitted text survives question navigation, agent re-asks (upserts), suspend/resume, and view toggles. Never destroyed except by explicit user action. (Hard-won lesson: the ask_user extension loses drafts on tab switches — disqualifying.)
7. **All hotkeys configurable, no exceptions.** Defaults chosen against pi built-ins and popular extensions (ctrl+b is taken by patty-bg-tasks; ctrl+m sends `\r`).

## Deliverable files

| File | Contents |
|---|---|
| product-requirements.md | PRD: goals, functional requirements, UX flows, acceptance criteria, non-goals |
| architecture.md | Components, module layout, event/message flows, config surface |
| tool-protocol.md | `interrogate` schema, actions, guards, agent-facing text, caps, fallbacks |
| ui-spec.md | Panel layout, screens, hotkey table, editor embedding, renderers, terminal fallbacks |
| state-and-persistence.md | State machine, rev/epoch semantics, storage, reconstruction, compaction, branching |
| implementation-plan.md | Build order, file-by-file checklist, test plan, risks |
| decisions.md | Decision ledger extracted from the interrogation session |

Decision traceability: every requirement traces to a decision in spec/decisions.md (extracted from the interrogation session; original Q&A artifacts discarded).

## Defaulted decisions (user may veto)

- **Q38 = A**: rev + epoch guards both active. (User endorsed the file-tool analogy; no final pick given.)
- **Q39 = B**: `dependsOn` conditions in v1, powering edit-time ripple warnings with forced accept/cancel. (User explicitly specified this UX: "give them an overview of how many previously-answered questions they're invalidating... force them to accept or cancel.")

## Naming and strings (final)

- Extension/package: `pi-interrogator`. Tool: `interrogate`. Command: `/interrogate`.
- Submission message `customType`: `interrogation-submission`. Completion message: `interrogation-completion`. State mirror entry: `interrogation-state`.
- Suspend widget line: `{n} open · {m} answered — {breakOut key} to resume /interrogate`

## Non-goals (confirmed)

Answering by parsing chat text while the panel is open · multiple concurrent interrogations · images in answers · mouse input · cross-restart draft persistence (documented limitation) · modifying pi core (public extension APIs only) · per-request state injection (vetoed).


# Product Requirements — pi-interrogator

## Problem

In default pi, when a model asks dozens of planning questions, the question list scrolls off screen as soon as the user answers the first batch. The user must scroll up to re-read, losing the input box. Requirements end up scattered, contradictory, and forgotten. Iterative spec-building (structured interrogation) needs the question set to stay front-and-center while the user answers at their own pace.

## Goals

1. Overload the user with dozens of questions *without them getting lost*: one persistent panel, always at the bottom where the prompt lives.
2. Partial submissions: answer as few or as many as wanted per submit; unanswered questions stay open.
3. Agent ingests answers between submissions, revises/re-opens/re-asks affected questions; answered questions auto-close after the agent's next reply unless re-asked.
4. Side conversations without losing the interrogation: break out, chat, resume — user- or agent-initiated.
5. Typed-answer experience identical to normal pi prompting (user's actual editor, vim modes included).
6. Minimal agent-facing token cost; terse instructions; no per-request state spam.

## Users

- **The planner** (human): answering questions, editing answers, requesting side discussions. On any terminal, including low-height remote sessions.
- **The agent** (model): asks questions via one tool, reads state on demand, reconciles contradictions, writes the final spec from the injected record.

## Functional requirements

### Interrogation lifecycle
- FR-1 The model calls `interrogate` with a full question set (upsert). The tool returns immediately; the panel opens focused on the gate group if one is declared, else the first group.
- FR-2 The user answers any subset, in any order, editing earlier answers freely (including archived ones — archived means "not pending", not "immutable"). Editing re-marks a question pending.
- FR-3 `ctrl+s` submits all pending answers immediately (no review screen). Each submission: (a) delta message to the model (~2 lines + reminder line "consider how these affect your other questions"), (b) user-only diff card in the transcript, (c) epoch bump.
- FR-4 After the agent's reply to a submission (`agent_settled`), submitted questions close unless that reply upserted (re-asked) them. Aborted replies count as settled.
- FR-5 When the last open question closes, the extension injects the complete Q&A record once (`interrogation-completion` message) and the panel auto-dismisses. The model writes the spec from that record.
- FR-6 The agent may reopen the panel at its judgment via `interrogate({reopen:true})`. No deterministic guard. The suspend widget is always visible while suspended so the user is never stranded.

### Panel UX (details in ui-spec.md)
- FR-7 Short form by default: question one-liner, first sentence of the description dimmed beneath, options with unmistakable recommendation marks (★ + preselect).
- FR-8 One toggle (default `ctrl+d`) opens the deep view: full replacement of the Q&A section with the full description plus every option's ramification text, each option as a sticky header, scrollable, options selectable, `enter` selects and returns to short form advancing to the next unanswered question. Toggle is sticky while the panel is open.
- FR-9 Navigation freedom (hard requirement R1): forward/back among questions at all times; nothing locks the user onto a question. Soft gate only: all groups visible and answerable; gate group focused first, later groups dimmed; submitting with gate unanswered shows a dismissible warning line.
- FR-10 Progress footer: `3/12 answered · 2 re-asked ·` plus the 3–4 keys relevant to the current screen, reflecting actual configuration.
- FR-11 Overview list (`ctrl+l`): all questions with status markers (open/answered★/re-asked⟳/moot⊘/withdrawn⊗/text✎); `enter` jumps.
- FR-12 Free-text "explain" field on any question via the composed active editor (`getEditorComponent()` factory — the user's vim keybindings work). `enter` saves and returns focus to options; `shift+enter`/`ctrl+j` newline; separate history. `ctrl+g` opens `$EDITOR` seeded with the draft.
- FR-13 Batch note (hard requirement R3): `ctrl+shift+m` opens a note field at any time; the note is held and delivered as a `NOTE:` line with the next submission.
- FR-14 Break-out (`ctrl+shift+q`, also `/interrogate` toggles): suspends the panel; main editor becomes available; drafts and panel state preserved; widget shows open/answered counts and resume key.
- FR-15 Per-question "discuss in chat" handoff: suspends the panel and preloads the current question + options into the main editor as a quoted prompt for a focused side chat.
- FR-16 `esc` descends: deep view → short form; overview → panel; at top level → suspend. Esc never destroys any state.

### Dependency and ripple semantics
- FR-17 Questions may declare `dependsOn: [{id, equals?, notEquals?}]`. Conditions are evaluated locally and instantly: unmet questions grey out as moot with reason (`moot: storage=sqlite`), kept in the map (audit trail), never silently removed.
- FR-18 When the user changes an answer to an *answered* question and the change invalidates other answered/submitted questions via `dependsOn`, the panel shows an inline confirm before applying: `⚠ Invalidates 3 answered questions (Q7, Q12, Q19) — enter=keep, esc=cancel`. No drill-down in v1.
- FR-19 The agent still prunes semantically between submissions (upsert with omissions = withdrawals); `dependsOn` covers instant, local effects only.

### Agent protocol (details in tool-protocol.md)
- FR-20 One tool, four action shapes: upsert (`questions[]`, optional `goal`), read (`{}`), reopen (`{reopen:true}`), fallback answers (`answers[]`, non-TUI only).
- FR-21 Merge rules on upsert, by id: same options → silent text update, answers kept; changed options → answer reset + re-asked marker; new id → appended open; omitted id → withdrawn. Typed drafts always survive upserts.
- FR-22 Guards: upserts touching existing questions must echo each question's `rev` and the session `epoch`; stale calls are rejected with current state. Read returns revs/epoch.
- FR-23 Soft caps, configurable, scaled by question count and `ctx.model.contextWindow`; over-budget content is truncated with a warning in the tool result (never a hard reject).
- FR-24 Agent-facing text: ≤120-word tool description (always active, Q26=A) + 2 promptGuidelines bullets. No other prompt additions.
- FR-25 Non-TUI modes (rpc/json/print): no panel; the tool returns a numbered markdown digest; the model relays it in chat; the user answers in their next prompt; the model records via `answers[]`.
- FR-26 Light plain-text question-round detection (TUI only, throttled, configurable off): if an assistant reply contains a numbered question block, notify the user "question round detected in chat — /interrogate to move it into the panel". Never transforms content.

### Persistence and recovery (details in state-and-persistence.md)
- FR-27 Canonical state in the interrogate tool result `details` (branch-correct), mirrored to `interrogation-state` custom entries on mutation (debounced).
- FR-28 On session start with open questions (TUI): panel auto-reopens with state restored. Drafts are not persisted across restarts (documented limitation).
- FR-29 `session_before_compact` supplies custom instructions: preserve verbatim the user's stated goals and plan constraints from all messages, all interrogation answers and changes, and the goal field.
- FR-30 Goal field: agent-supplied, updatable, shown in the panel header at all times; anchors re-asks and compaction summaries.

## Hard requirements (from user tooling evaluations)
- R1 navigation freedom (FR-9) · R2 unmistakable recommendation marks (FR-7) · R3 batch note (FR-13) · R4 draft preservation (commitment 6) · R5 all hotkeys configurable (commitment 7).

## Acceptance criteria (all must pass; scripted where possible)

1. Model upserts 30 questions across 4 groups with one gate group → panel opens; chat visible above; gate focused; other groups dimmed but answerable.
2. Answer 2 of 30, `ctrl+s` → model receives a ≤3-line delta + reminder; user-only card shows both answers; 28 remain open; epoch bumps.
3. Agent replies without upsert → the 2 close (archived markers in overview). Agent replies with a re-ask of one → that one shows re-asked, answer reset, draft preserved.
4. Mid-panel: break out → widget appears with counts → side chat runs a full agent turn → agent `{reopen:true}` → panel returns with drafts intact; main editor draft also intact.
5. Deep view: toggle, scroll all ramifications, select an option from deep view → returns to short form, advances.
6. Answer a gate question contrary to a `dependsOn` → dependent greys as moot with reason, instantly; overview shows ⊘.
7. Edit an answered question that invalidates 3 others → confirm dialog appears; esc cancels with no state change; enter applies.
8. Stale upsert (wrong `rev`/`epoch`) → rejected; result contains current text/rev and delta digest; model re-applies successfully.
9. Restart pi mid-interrogation → panel reopens with questions/answers; drafts gone (documented).
10. `/compact` mid-interrogation → summary preserves user plan statements; subsequent read returns full state.
11. `pi -p` (print mode): interrogate returns markdown digest; model asks in text; `answers[]` records; state consistent.
12. Every default hotkey remappable via config; footer/widget strings reflect the remap.
13. Editing an archived answer re-marks it pending; next submission diff card highlights the change (`Q3: sqlite → postgres (changed)`).
14. All questions closed → completion record injected once; panel dismissed; recap card in transcript.

## Non-goals
See SPEC.md. Additionally: no multi-select questions in v1 (schema reserves `type` for growth); no conditional question *generation* (agent composes sets); no analytics.
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
├── delivery.ts               # submission deltas, completion record, reminder line
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
| `panel/*` | The bottom-dock UI while open. Owns drafts (typed-not-submitted answers + batch note) |
| `delivery.ts` | Builds delta custom messages (`interrogation-submission`) and the one-time completion record |
| `lifecycle.ts` | Panel open/suspend/resume orchestration, `agent_settled` auto-close, suspend widget, reopen handling |
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

### Submit (partial, immediate)
```
user ctrl+s (panel)
  panel flushes pending answers into state (applying FR-18 ripple confirms already done at edit time)
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
ctrl+shift+q or /interrogate → lifecycle: panel.done(null) (suspend) → setWidget reminder line
resume: same key/command → re-instantiate panel from state + preserved drafts
agent {reopen:true} → same resume path (no guard; judgment trusted)
discuss-in-chat: like suspend, plus setEditorText with quoted question + options
```

### Restart / resume session
```
session_start → persistence: walk buildContextEntries()
    latest interrogate tool-result details = base state
    replay subsequent interrogation-submission messages (deltas) on top
    fallback: scan interrogation-state custom entries
  if open questions && mode==="tui" → auto-open panel (drafts not restored)
```

## pi API surface used

- `pi.registerTool` (interrogate; `renderCall`/`renderResult` compact rows)
- `pi.registerCommand` ("/interrogate": toggle panel; with args when no state → notify)
- `pi.registerShortcut` (break-out/resume, global; default `ctrl+shift+q`)
- `pi.on`: `session_start`, `agent_settled`, `tool_execution_end` (detect upserts for auto-close), `session_before_compact`, `session_shutdown`
- `ctx.ui.custom` (panel host), `ctx.ui.setWidget` (suspend reminder), `ctx.ui.getEditorComponent` (compose user's editor), `ctx.ui.setEditorText` (discuss handoff), `ctx.ui.notify`
- `pi.sendMessage` (submission/completion custom messages), `pi.appendEntry` (state mirror)
- `pi.registerMessageRenderer` ×2, `pi.registerEntryRenderer` ×1
- `ctx.mode` / `ctx.hasUI` guards throughout; `ctx.model.contextWindow` for cap scaling

## Event subscriptions table

| Event | Handler |
|---|---|
| `session_start` | reconstruct state; auto-open panel (FR-28) |
| `agent_settled` | auto-close pass (FR-4); completion check (FR-5) |
| `tool_execution_end` | record whether this agent run upserted (feeds auto-close) |
| `session_before_compact` | return customInstructions (FR-29) |
| `session_shutdown` | flush mirror entry |

## Data shapes (authoritative in tool-protocol.md / state-and-persistence.md)

- `InterrogationState`: `{ goal, epoch, questions: Map<id, Question>, order: string[], snapshots: Snapshot[] }`
- `Question`: `{ id, title?, prompt, description?, type, options?[], recommendation?, group?, gate?, dependsOn?[], rev, status, answer? }`
- `Draft` (panel-local): `{ value, text }` per question + `batchNote`
- Submission message `details`: `{ changed: [{id, from, to}], note?, epoch, card: FullCardData }`

## Config surface (all hotkeys + caps + toggles)

Loaded from pi `settings.json` under `"interrogator"` key; deep-merged over defaults. See ui-spec.md §Config for the full reference including every keymap entry, cap formula parameters, and toggle flags (`gateWarnings`, `roundDetection`, `digitQuickSelect`).
# Tool Protocol — `interrogate`

One tool, four action shapes. The goal is fewest context tokens without losing performance: the description is resident (~110 words, always active per Q26=A); everything else is pay-per-use.

## Schema (typebox)

```ts
const OptionSchema = Type.Object({
  value: Type.String({ description: "Option value returned when selected" }),
  label: Type.String({ description: "One-line display label (short form)" }),
  ramification: Type.Optional(Type.String({ description: "Deep-view text: consequences, blast radius" })),
});

const QuestionSchema = Type.Object({
  id: Type.String({ description: "Stable identity you choose; never reuse for a different question" }),
  title: Type.Optional(Type.String({ description: "Short label used in digests and overview" })),
  prompt: Type.String({ description: "Short-form question text shown by default" }),
  description: Type.Optional(Type.String({ description: "Long-form context; first sentence shows as a hint in short form" })),
  type: StringEnum(["choice", "text"]),
  options: Type.Optional(Type.Array(OptionSchema, { description: "Required for type=choice" })),
  recommendation: Type.Optional(Type.String({ description: "Recommended option value; marked ★ and preselected" })),
  group: Type.Optional(Type.String({ description: "Grouping label; groups render as sections" })),
  gate: Type.Optional(Type.Boolean({ description: "Mark this question's group as the foundational gate group" })),
  dependsOn: Type.Optional(Type.Array(Type.Object({
    id: Type.String({ description: "Question this one depends on" }),
    equals: Type.Optional(Type.String()),
    notEquals: Type.Optional(Type.String()),
  }), { description: "Moot conditions evaluated locally as the user answers" })),
  rev: Type.Optional(Type.Integer({ description: "REQUIRED when updating an existing question: the rev you last saw" })),
});

const InterrogateParams = Type.Object({
  goal: Type.Optional(Type.String({ description: "What these questions drive toward; shown in the panel header" })),
  epoch: Type.Optional(Type.Integer({ description: "REQUIRED with questions/answers: the session epoch you last saw (guards stale updates)" })),
  questions: Type.Optional(Type.Array(QuestionSchema, { description: "Upsert. Omitting an existing id withdraws it" })),
  reopen: Type.Optional(Type.Boolean({ description: "Resurface the panel with existing state" })),
  answers: Type.Optional(Type.Array(Type.Object({
    id: Type.String(), value: Type.String(), text: Type.Optional(Type.String()),
  }), { description: "Non-TUI fallback only: record the user's chat answers" })),
});
```

## Actions

| Call | Action | Returns |
|---|---|---|
| `{questions:[...], goal?}` | Upsert (merge rules below) | Status line + "end your turn" instruction + caps warnings if any |
| `{}` | Read | goal, epoch, group summary, per-question one-liners `{id, title, status, rev, answer?}` |
| `{reopen:true}` | Resurface panel | Confirmation |
| `{answers:[...]}` | Record user answers (non-TUI only; ignored in TUI) | Status line |

## Merge rules on upsert (by id)

1. Existing id, same option values → text/description/ramification updates apply silently; existing answer and rev-bump; drafts untouched.
2. Existing id, changed options → answer reset, status `reasked` (⟳ marker), rev-bump; panel draft *preserved* (surfaces when the user revisits).
3. New id → appended, status `open`, rev 1.
4. Existing id omitted → withdrawn (⊗ marker, kept in map with reason "withdrawn").

## Guards (Q38=A)

- **rev**: every mutation of an existing question requires its current `rev`; mismatch → `isError` result: `STALE: {id} is at rev {n} (you sent {m}). Current: {text}. Re-apply.`
- **epoch**: any `questions`/`answers` call must carry the session `epoch` it was based on (top-level optional `epoch` param; read/submission results always include it); mismatch → `isError` with the delta digest since the model's epoch and current epoch.
- Read (`{}`) is always allowed — pull refresh is never guarded.

## Caps (Q27=A, configurable + scaled)

- Defaults: `description ≤ max(1200, budget/questionCount)` chars; `ramification ≤ 600`; `options ≤ 7`; `questions ≤ 40`; `goal ≤ 400`.
- Budget scaling: `totalDescriptionBudget = min(0.04 × ctx.model.contextWindow, 60000)` tokens-equivalent (chars ≈ 4×tokens), divided across the batch.
- Over-budget content is **truncated with an explicit warning in the tool result** ("q7 description truncated at 2100 chars — restructure if essential"). Never a hard reject; all numbers overridable via config.

## Agent-facing text (resident; ≤120 words)

**Tool description:**

> Structured interrogation: plan by asking the user questions they answer in a persistent panel. Upsert `questions[]` (stable ids; existing questions require their current `rev`; omitting an id withdraws it). Call with `{}` to read current state, goal, and epoch. Answers arrive as submission messages — consider how they affect your other questions and re-ask only those materially affected (upsert with new rev). First round: few broad foundational questions with key ramifications; refine in later rounds; send the full set up front. The question set is the plan: when it completes, the full record is injected — derive the spec from it, don't re-plan. If unsure your view is current, read before upserting.

**promptGuidelines (2 bullets):**

- Use interrogate for structured planning questions instead of plain-text question blocks; send the full set in one call.
- After answers arrive, re-ask only questions materially affected by the new answers, then let the interrogation complete.

## Result rendering (TUI)

`renderCall`: one-line row `interrogate {n} questions {+m new ~k updated}`. `renderResult`: status line + epoch; `expanded` shows full state summary. Renderers stay compact — the panel is the display, not the tool row.

## Non-TUI fallback (FR-25)

`ctx.mode !== "tui" || !ctx.hasUI` → no panel. The upsert result contains a numbered markdown digest (id, title, prompt, options with ★ marks, recommendation); the description instructs the model to relay it verbatim in chat. The user answers in their next prompt; the model records via `{answers:[...]}` (epoch-guarded). Read/completion work identically. Completion record is still injected once at close.

## Plain-text round detection (FR-26, TUI only)

After `agent_settled`, if the final assistant message contains ≥3 lines matching `/^\s*(?:Q?\d+[\).:]|[❓\-•*])\s+.+\?/` and no interrogate upsert occurred this run → `ctx.ui.notify("Question round detected in chat — /interrogate to move it into the panel")`. Throttled to once per 3 turns; config toggle `roundDetection` (default on); never transforms content.

## Status line format (shared by results and panel footer)

`{answered}/{total} answered · {reasked} re-asked · {moot} moot · epoch {n}`
# UI Spec — the panel and renderers

## Layout (TUI, replace-editor mode)

The panel is hosted by `ctx.ui.custom()` (non-overlay): it *is* the bottom editor region; the transcript stays visible above. Structure, top→bottom:

```
┌ interrogation · {goal} ─────────────── 3/12 answered · 1 re-asked ┐   ← header (1 line)
│ {group label} · Q7/{id} {title}                        [⟳ re-asked]  │   ← question line
│   {first sentence of description, dimmed}                           │   ← hint (short form only)
│   ▸ ★ sqlite   — Tool result details; branch-correct                 │   ← options (short form)
│     postgres   — Custom entries; simpler                             │
│     ✎ explain…                                                        ← free-text affordance
├──────────────────────────────────────────────────────────────────────┤
│ [embedded editor when ctrl+t focused | batch-note field when open]    │   ← 3 lines default
└ enter accept · ctrl+d deep · ctrl+l list · ctrl+s submit · … ⏎       ┘   ← footer (1 line)
```

- **Deep view** (`ctrl+d` toggle, sticky per panel session): replaces everything between header and footer with a scrollable pane — full `description` on top, then each option as a sticky section header (`▸ sqlite`) followed by its `ramification` text. Options remain selectable: highlight + `enter` selects, returns to short form, advances (Q14). `↑/↓` scroll here (they don't navigate questions while in deep view).
- **Overview** (`ctrl+l`): full-screen-in-panel list of all questions with markers — `·` open, `★` answered, `⟳` re-asked, `⊘` moot (+reason, dimmed), `⊗` withdrawn, `✎` has text answer; group headers; gate group marked `▲`. `enter` jumps; `esc` returns.
- **Gate rendering (soft, Q32=B)**: gate group renders normal; non-gate groups dimmed (still navigable/answerable — R1). Submitting with gate questions unanswered → dismissible footer warning: `⚠ {n} foundational unanswered — later answers may shift`.
- **Goal**: always in the header (FR-30). Truncated to fit, full text in deep view.

## Terminal fallbacks

- Height < 24 rows: hint line suppressed; deep view still available (it's a full replacement). Height < 12: overview list paginates 5 rows.
- Width < 60 cols: option labels truncate with `…`; ramifications wrap; footer shows 2 keys max (`submit`, `deep`).

## Free-text field (Q17=A)

- Instantiated once per panel via `ctx.ui.getEditorComponent()(tui, theme, keybindings)` — composes the user's active editor (vim modes etc.). Not focused by default; `ctrl+t` (or clicking the `✎` affordance region) focuses it.
- `enter` saves the draft and returns focus to options; the *next* `enter` advances (two-stage, so multi-line typing with `shift+enter`/`ctrl+j` is safe). Separate history (never calls `addToHistory`).
- `ctrl+g` (mirrors `app.editor.external`): opens `$VISUAL`/`$EDITOR` (nano fallback) seeded with the draft via temp file; on clean exit the text replaces the field.
- **Draft preservation (R4)**: one draft slot per question (`{value, text}`) + one `batchNote`, held in panel memory for the panel's lifetime: survives navigation, deep/overview toggles, upserts (including answer resets — merge rule 2), suspend/resume. Destroyed only by submission (text answers ship) or user-initiated clear. Not persisted across restarts (documented).

## Batch note (R3)

`ctrl+shift+m` swaps the editor area into note mode (header shows `NOTE — ships with next submission`); same embedded editor; `esc`/re-press exits. Stored as `batchNote`; delivered as a `NOTE:` line in the delta and shown on the card; cleared after shipping.

## Ripple confirm (FR-18, Q39=B)

On committing an answer change to an *answered* question in the panel (the moment `enter` finalizes), if `dependsOn` ripple (transitive closure) hits answered/submitted questions: footer becomes `⚠ Invalidates {n} answered questions ({ids}) — enter=keep, esc=cancel`; `esc` reverts the edit; `enter` applies. No drill-down in v1.

## Hotkeys — defaults and config

**Intercept rule**: panel-level keys are intercepted *before* the embedded editor sees them, whenever the panel is open (including text focus). Everything else forwards to the embedded editor. All keys rebindable via config `interrogator.keys.*`; no exceptions (R5).

| Action | Default | Config key | Context |
|---|---|---|---|
| prev/next question | `tab` / `shift+tab` | `keys.prevQuestion`/`nextQuestion` | short form |
| move among options | `↑`/`↓` | fixed | short form |
| quick-select 1–9 | `1`–`9` | `digitQuickSelect` toggle | short form |
| accept + advance | `enter` | fixed | options focus |
| toggle deep view | `ctrl+d` | `keys.deep` | panel |
| overview list | `ctrl+l` | `keys.overview` | panel |
| focus text field | `ctrl+t` | `keys.focusText` | panel |
| batch note | `ctrl+shift+m` | `keys.batchNote` | panel |
| submit | `ctrl+s` | `keys.submit` | panel |
| break out / resume | `ctrl+shift+q` | `keys.breakOut` (also `registerShortcut`, global) | global |
| discuss in chat | `ctrl+shift+e` | `keys.discuss` | panel |
| external editor | `ctrl+g` | `keys.externalEditor` | text focus |
| back / suspend | `esc` | fixed | descends, never destroys |

Conflict avoidance (verified against pi defaults + installed extensions): `ctrl+b`, `ctrl+shift+b`, `ctrl+shift+x`, `ctrl+shift+j`, `shift+down` are taken by others — avoided. `ctrl+m` avoided (sends `\r`). Dev agent must re-verify at build time and record findings in the PR notes.

## Suspend / resume / widget

- Suspend: `esc` at top level, `ctrl+shift+q` anywhere, or `/interrogate`. Panel `done(null)`; state + drafts held in extension memory; **main editor text preserved** (pi's editor instance persists across `custom()` sessions; verify in test).
- Widget (`setWidget("interrogator", [...])`, visible whenever suspended with open questions): `{n} open · {m} answered — {configured breakOut key} to resume /interrogate`.
- Resume: `ctrl+shift+q`, `/interrogate`, or agent `{reopen:true}` → fresh panel instance rehydrated from state + drafts (focus restored to last question).
- Discuss-in-chat (`ctrl+shift+e`): suspend + `setEditorText` with:
  ```
  > {prompt}
  {options one per line, ★ marked}
  (discussing q{id} — agent: side-chat freely; reopen panel when done)
  ```

## Renderers

- `interrogation-submission` (registerMessageRenderer): user-only card from `details.card` — each changed answer `{title}: {old} → {new (changed)}` + any `NOTE:` line + `{open} remain open`; compact by default, `expanded` shows full submission.
- `interrogation-completion`: recap card — goal, every question with final answer (grouped), timestamps; `expanded` shows withdrawn/moot with reasons.
- `interrogation-state` (registerEntryRenderer): dimmed one-line mirror marker (audit trail; not interactive).
- Tool row renderers per tool-protocol.md.

## Empty/edge states

- `/interrogate` with no state → `notify("No active interrogation — ask the agent to interrogate you", "info")`.
- 0 open questions but pending submissions → footer `submit pending answers first`; completion triggers after close pass.
- Model upserts while panel suspended → panel reopens (upsert implies visibility).
- User presses `ctrl+s` with zero pending → no-op footer flash `nothing to submit`.
# State & Persistence — pi-interrogator

## Question state machine

```
                 upsert(new id)                    user answers/edits
   ┌──────────┐ ───────────────► ┌───────────┐ ────────────────────► ┌──────────────────┐
   │ (absent) │                  │   open    │                      │ answered(pending) │
   └──────────┘                  └─────┬─────┘ ◄──────────────────── └────────┬─────────┘
                                       │ upsert changed options              │ ctrl+s
        dependsOn unmet (local)        │ (answer reset + marker)             ▼
   ┌──────────┐ ◄──────────────────────┤                          ┌──────────────────┐
   │   moot   │        ┌───────────┐   │                          │    submitted     │
   └────┬─────┘        │  reasked  │ ◄─┘                          └────────┬─────────┘
        │ re-met       └─────┬─────┘                                       │ agent_settled
        ▼                    │ user answers                                │ (no re-ask)
      open ◄─────────────────┘                                             ▼
                                                                        ┌──────────────────┐
   ┌───────────┐  upsert omission                                        │ closed (archived) │
   │ withdrawn │ ◄──────────────────── any status                        └────────┬─────────┘
   └───────────┘                                                                  │ user edits
        closed+reopen via re-upsert with same id (rev+1) ─────────────────────────┘
```

- `moot`/`withdrawn` are terminal-until-re-upsert; both stay visible (dimmed, with reason) — the audit trail (Q34=A).
- Editing a closed answer re-marks it `answered(pending)`; next submission diff marks it `(changed)` (Q24=B).
- Answer edits apply through the ripple confirm (ui-spec.md) before entering `answered(pending)`.

## rev and epoch semantics

- `rev` (per question, integer, starts 1): bumps on any content mutation (agent upsert text/options/dependsOn, or withdrawal-re-add). The model must echo the current rev when upserting an existing question. User answers do **not** bump rev (answers are epoch territory).
- `epoch` (session, integer, starts 1): bumps on every submission. Any `questions`/`answers` call must carry the epoch it was based on (top-level `epoch` param). Read is never guarded. Both guards reject with current state + delta digest (tool-protocol.md).
- Snapshots: full state copied on every submission (bounded ring of 10) — powers diff cards and post-hoc recovery; not user-facing undo in v1.

## Storage (three layers, one source of truth)

1. **In-memory `InterrogationState`** (state.ts) — authoritative while the process lives. Mutations emit change events consumed by panel/widget/renderers.
2. **Tool result `details`** (canonical, Q5=A) — every interrogate result carries the full post-call state. Branch-correct by construction: reconstruction replays the *latest interrogate result on the current branch*, then applies subsequent `interrogation-submission` messages' `details.changed` deltas.
3. **`interrogation-state` custom entries** (mirror, Q37 residue) — debounced (2s) `appendEntry` on mutation; not in model context; fallback when compaction drops the tool-result entry behind the boundary.

## Reconstruction (`session_start`)

```
1. entries = buildContextEntries()
2. find last entry: toolResult for "interrogate" with details.state → base = details.state
   else scan custom entries type "interrogation-state" (newest first) → base
   else: no state; done
3. replay subsequent interrogation-submission messages: apply details.changed (answers, epochs)
4. if any question status ∈ {open, reasked, answered, submitted, moot, withdrawn} (non-empty set):
     if ctx.mode === "tui": open panel (no drafts) [FR-28]
     else: mark fallback active
5. recompute dependsOn moot-ness from current answers (cheap, idempotent)
```

## Compaction (`session_before_compact`)

Handler returns custom instructions for the summarizer (FR-29), verbatim:

> Preserve verbatim: the user's stated goals and plan constraints from all messages (including side conversations), all interrogation answers and later changes, the interrogation goal, and the fact that current interrogation state is available via `interrogate({})`.

No other compaction machinery. Post-compaction, the model pull-refreshes; reconstruction survives via the entry mirror; the completion injection is unaffected.

## Branching (/tree, /fork, /resume)

`session_start` reconstruction is branch-relative (`buildContextEntries()`), so forked/resumed sessions inherit exactly the questions/answers visible on that branch. The entry-mirror fallback scans the same branch. Never cache state across `session_shutdown`.

## Auto-close algorithm (Q9=B)

```
on submission delivery: submittedRun = false
on tool_execution_end (interrogate, action=upsert): mark each touched submitted question reasked; submittedRun = true
on agent_settled:
   for q in submitted-at-current-epoch:
      if q not reasked this run → status = closed (archived)
   if no open/reasked/answered/moot questions remain → completion flow:
      inject interrogation-completion (full record, once) → dismiss panel → clear in-memory state
Aborted runs count as settled (agent_settled fires; the model saw the answers before abort and can re-ask).
```

## Drafts lifecycle (R4)

Panel-local `{questionId → {value, text}}` + `batchNote`. Preserved across navigation, view toggles, upserts, suspend/resume. Flushed into state on submit; cleared on submit or explicit clear. **Not** written to any persistent layer — restart loses drafts by design (documented limitation, Q6=B).

## Completion record format (the one full injection)

```
INTERROGATION COMPLETE — {goal}
[group] {id} {title}: {answer value/label} {★ if recommendation followed} {— free text}
…every question, grouped, in order…
NOTES: {batch notes in order}
Withdrawn/moot: {ids + reasons}
```
Rendered as the recap card (renderer); `content` is this record verbatim — the model writes the spec from it (commitment 2, Q30).
# Implementation Plan — pi-interrogator

Target: a single competent dev agent one-shots this. Build in order; each milestone ends in a runnable, manually verifiable state.

## Prerequisites

- pi extension dev: read pi docs `extensions.md`, `tui.md`, `keybindings.md` before starting.
- Reference examples (in pi install): `questionnaire.ts` (embedded `Editor` inside `ctx.ui.custom` — proven pattern), `todo.ts` (tool-result-details state), `entry-renderer.ts`, `message-renderer.ts`, `qna.ts`, `plan-mode/` (event orchestration).
- TypeScript via jiti; typebox for schemas; `StringEnum` from `@earendil-works/pi-ai` for enums (Google compat).

## Milestones

**M1 — Tool + state core (no UI).** `config.ts`, `state.ts`, `tool.ts`, `index.ts` registration. Verify: in a scratch session the model upserts questions, reads state, gets merge-rule behavior and rev/epoch rejections; caps truncate with warnings; `details` carries full state. Non-TUI fallback digest renders in `-p` mode.

**M2 — Delivery + lifecycle.** `delivery.ts`, `lifecycle.ts` (auto-close on `agent_settled`, completion injection), renderers for tool rows. Verify with acceptance criteria 2, 3, 13, 14 (state-level, without panel: submissions still deliver from fallback path in `-p`).

**M3 — Panel short form.** `panel/panel.ts`, `short-view.ts`, `keys.ts`: replace-editor hosting, header/goal, options with ★ marks + preselect, digits/enter accept-advance, tab navigation, footer status. Verify AC-1 (minus gate dimming), AC-5 partially.

**M4 — Text field + drafts.** `text-field.ts`: compose `getEditorComponent()`, two-stage enter, `ctrl+g` `$EDITOR`, per-question drafts + batch note + `ctrl+shift+m`. Verify draft survival across navigation and upserts (R4).

**M5 — Deep view, overview, gate, ripples.** `deep-view.ts` (scrollable pane, sticky option headers, select-from-deep), `overview.ts`, group dimming + gate warnings, `dependsOn` evaluator + moot marks + ripple confirm. Verify AC-5, 6, 7.

**M6 — Suspend/resume ecosystem.** `ctrl+shift+q` + `/interrogate` + widget, reopen action, discuss-in-chat handoff with `setEditorText`, editor-text preservation across suspend. Verify AC-4.

**M7 — Persistence + polish.** `persistence.ts` (mirror, reconstruction, auto-open), compaction instructions, message/entry renderers (cards), round detection (FR-26), terminal fallbacks (<24/<12 rows, <60 cols), config reference, README. Verify AC-8, 9, 10, 11, 12.

## File checklist

- [ ] `index.ts` — factory; registers tool/command/shortcut/events/renderers; mode guards
- [ ] `config.ts` — defaults + settings load; keymap table (ui-spec §Hotkeys), caps (tool-protocol §Caps), toggles (`gateWarnings`, `roundDetection`, `digitQuickSelect`)
- [ ] `state.ts` — state machine, rev/epoch, snapshots, change events, dependsOn evaluator
- [ ] `tool.ts` — schema, guards, merge rules, caps, fallback formatting, status line
- [ ] `panel/panel.ts` — `ctx.ui.custom` host, view switching, focus model, draft store
- [ ] `panel/short-view.ts`, `deep-view.ts`, `overview.ts`
- [ ] `panel/text-field.ts` — editor composition, `$EDITOR`
- [ ] `panel/keys.ts` — config-driven routing; intercept-before-forward rule
- [ ] `delivery.ts` — delta messages, completion record, reminder line
- [ ] `lifecycle.ts` — open/suspend/resume/reopen, widget, auto-close, completion trigger
- [ ] `renderers.ts` — submission/completion cards, state entry, tool rows
- [ ] `persistence.ts` — mirror, reconstruction, compaction instructions
- [ ] `detect.ts` — round heuristic + throttled notify
- [ ] `README.md` — install, config reference, keymap table, limitations (drafts not persisted; TUI-first)

## Testing

- **Unit (node/tsx script or vitest)**: state machine transitions; merge rules 1–4; rev/epoch guard math; dependsOn closure (transitive ripples); caps formula; reconstruction from fixture entries (tool-result details + deltas + entry-mirror fallback); delta digest formatting.
- **Integration (launch `pi -e .`)**: scripted model turns are unreliable — drive the tool directly via a debug command (`/interrogate-debug-upsert <json>`) that invokes the same code path as the tool; then manual verification per the AC runbook below.
- **AC runbook**: execute acceptance criteria 1–14 from product-requirements.md in order; each cites the FR it proves. AC-12 (rebinding) proves R5. AC-4 includes verifying the *main editor's* draft survives panel suspend/resume.
- **Regression guard**: keymap conflict re-verification (grep installed extensions' `registerShortcut` + pi `keybindings.md`) recorded in README.

## Risks

| Risk | Mitigation |
|---|---|
| Embedded editor double-instance quirks (history, IME, paste) | M4 isolated; fall back to stock pi-tui `Editor` if composition misbehaves (config flag `editorMode: "composed" \| "stock"`) |
| Deep-view scroll pane rendering bugs at odd widths | Cap + ellipsize; overview list is the escape hatch |
| `agent_settled` ordering vs tool_execution_end | Track per-run flags set in `tool_execution_end`; close pass reads them (state-and-persistence algorithm) |
| Compaction dropping tool-result details | Entry-mirror fallback path (tested via fixture) |
| Ctrl+shift+m/e terminal variability | Config-rebindable; documented; `\r` collision avoided |
| Model ignores "end your turn" instruction | Harmless (instruction-only, Q28=B); never `terminate` |

## Config reference (settings.json → `"interrogator"`)

```jsonc
{
  "keys": { "deep": "ctrl+d", "overview": "ctrl+l", "focusText": "ctrl+t",
            "batchNote": "ctrl+shift+m", "submit": "ctrl+s", "breakOut": "ctrl+shift+q",
            "discuss": "ctrl+shift+e", "externalEditor": "ctrl+g",
            "prevQuestion": "tab", "nextQuestion": "shift+tab" },
  "caps": { "description": 1200, "ramification": 600, "options": 7,
            "questions": 40, "goal": 400, "contextBudgetPct": 4 },
  "gateWarnings": true, "roundDetection": true, "digitQuickSelect": true,
  "editorMode": "composed"
}
```

Every display string that names a key (footer, widget, dialogs) is generated from the resolved config — never hardcode a key label.
# Decision Ledger — extracted from the structured interrogation session

Every decision that shaped this spec, with its disposition. (Full deliberation history intentionally discarded; decisions below are authoritative.)

## Architecture & data flow
- Q1 non-blocking tool · Q2 custom message + renderer (digest to model, card from details) · Q3 one-line digest per answer (superseded: deltas) · Q4 card per submission · Q5 tool-result details canonical · Q6 auto-reopen panel on restart; drafts not persisted v1 · Q7 one active set · Q8 merge rules 1-4 (same-id/same-options silent update; changed options reset + re-ask; new appended; omitted withdrawn) · Q9 close after agent_settled on the reply, unless re-asked; aborts count.
- State delivery redesign (user-directed): extension JSON is source of truth; submissions are deltas + reminder; model pull-refreshes via read; full record injected once at completion; per-request context injection vetoed.
- Compaction: goal field + session_before_compact customInstructions (preserve user plan statements verbatim) + entry backup mirror; no injection machinery.

## UI
- Q10 replace-editor panel (non-overlay custom) · Q11 suspend + reminder widget · Q12 agent-judgment reopen via `{reopen:true}`, no guard, widget always visible · Q13 hotkey map approved, ALL configurable; ctrl+b avoided (patty-bg-tasks), ctrl+m avoided (\r); panel intercepts its keys before embedded editor · Q14 enter = accept + advance · Q15 recommendations marked ★ + preselected (no bulk-accept) · Q16 types: choice, text, explain-field on any · Q17 compose user's active editor via getEditorComponent(); two-stage enter · Q18 ctrl+g $EDITOR seeded with draft · Q19/Q20 merged: one deep toggle; short form default with first-sentence hint; deep view = full replacement (description + all ramifications, sticky option headers, scrollable, selectable); sticky while panel open · Q21 footer counter + ctrl+l overview with jump · Q22 esc descends, never destroys · Q23 immediate submit + card · Q24 answers editable even archived; supersede via delta + latest-wins contract · Q32 soft gate: visible + answerable, gate focused, later dimmed, submit warning.
- Hard requirements: R1 navigation freedom · R2 unmistakable recommendation marks · R3 batch note (held until submit) · R4 draft preservation (from ask_user evaluation: state loss on revisit is disqualifying) · R5 all hotkeys configurable, no exceptions.

## Protocol
- Q25 one tool, four action shapes (upsert / read / reopen / fallback-answers) · Q26 always-active description ≤120 words + 2 bullets (chosen over session-scoped: cache stability + discoverability) · Q27 soft caps, configurable, scaled by question count + ctx.model.contextWindow · Q28 instruction-only return, never terminate:true · Q29 non-TUI: numbered markdown digest, user answers next prompt, model records via answers · Q30 completion = full record injection; naming pi-interrogator / interrogate / /interrogate · Q31 guidelines + light plain-text-round detection nudge (throttled, non-transforming) · Q33 agent prunes between submissions (semantics) · Q34 moot/withdrawn dimmed with reason, kept in map · Q36 discuss-in-chat handoff (preloads question into editor) · Q37 goal field + compaction instructions + backup mirror.

## Staging philosophy (discussion resolution)
- Gate the interaction, never the commitment: all questions sent in the first upsert (anti-loss anchor); grouping is display+focus only; contradictions self-heal via re-ask; contract carries broad-first ordering.

## Defaulted (user may veto)
- Q38 = A: rev + epoch guards (both). Rationale: user's own file-tool analogy (read-before-write, exact-oldText).
- Q39 = B: dependsOn in v1 → edit-time ripple confirm with forced accept/cancel. Rationale: user explicitly specified this UX.

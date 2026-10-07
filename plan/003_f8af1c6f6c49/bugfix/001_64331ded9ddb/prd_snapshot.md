# pi-interrogator — SPEC

Structured interrogation for the pi coding agent: the model asks dozens of planning questions through a single `interrogate` tool; the user answers them in a persistent bottom-dock panel that never scrolls away, submits partial answers any time, breaks out for side conversations, and edits answers as understanding evolves. The extension is the source of truth for question/answer state; the model reads and updates it through guards that make stale views fail loudly (like `edit`'s oldText and `write`'s read-before-write).

**Package:** `pi-interrogator` · **Tool:** `interrogate` · **Command:** `/interrogate`

## Core commitments (do not deviate)

1. **Non-blocking tool** — `interrogate` returns immediately after loading questions; the turn ends; the panel persists while idle. Answers flow back later as small delta messages that trigger a new reply. No tool call ever waits on the user.
2. **Pull-based state** — the extension's in-memory JSON is the single source of truth. Submissions deliver *deltas* (~2 lines) plus a reminder line. The model refreshes by calling `interrogate({})`. The full record is injected into the conversation exactly once, at completion. Per-request context injection is explicitly forbidden (user veto).
3. **Replace-editor panel, deliberate surfacing** — while questions are open, the panel *is* the bottom editor region (`ctx.ui.custom()`, non-overlay); the chat transcript stays visible above. `esc` suspends it; a widget above the main editor keeps it findable. `/interrogate` invokes/resumes it immediately in every scenario (never toggles, never demands a keypress); no global key shortcut exists (the historical `ctrl+shift+q` chord closes windows on many desktop environments and was removed). The panel NEVER opens itself outside the allow-list: `/interrogate`, an agent upsert leaving unanswered questions, or `{reopen:true}` — reads, navigation, and even session restart never surface it (SURFACE-001/002; the suspend widget line is the only ambient cue).
4. **Commit-everything-up-front** — the model sends *all* questions in the first upsert. Gating (soft) controls interaction order only, never what exists. Display gating is never commit gating.
5. **Staleness guards** — every question has a `rev` (content version); the session has an `epoch` (bumped per submission). State-changing calls must echo both; mismatches are rejected with current state so the model self-heals in one round trip.
6. **Drafts are sacred** — typed-but-unsubmitted text survives question navigation, agent re-asks (upserts), suspend/resume, and view toggles. Never destroyed except by explicit user action. (Hard-won lesson: the ask_user extension loses drafts on tab switches — disqualifying.) Every choice question ends in a synthetic `✎ Other — write your own` row whose committed text IS the answer (write-in, `custom`); `ctrl+t` elaboration attaches to the selection instead (WRITEIN-001/002). Completeness auto-submits: every answer commit ships immediately while zero questions remain unanswered (AUTOSUBMIT-001/002) — no required hotkey.
7. **All hotkeys configurable, no exceptions.** Defaults chosen against pi built-ins and popular extensions (ctrl+b is taken by patty-bg-tasks; ctrl+m sends `\r`).
8. **The user's answer is the user's work — nothing re-proposes or displaces it (ANSWER-PIN-001).** Once a question carries an answer (any status), the caret/highlight sits on that answer in every view and on every revisit: the option row matching `answer.value`, the `✎ Other` row for write-ins, the text affordance for text questions. `enter` or a digit on the already-recorded value is a state no-op (advance only) — never a re-proposal, never the FR-18 modal, never an `answer.at` rewrite, never a submission trigger. The ★ recommendation is display-only after an answer exists; ★ preselect applies only to unanswered questions. Changing an answered question requires an explicit, different user choice. No exceptions.

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
- Suspend widget line: `{n} open · {m} answered — /interrogate to resume` (names the command only — never a key chord)

## Non-goals (confirmed)

Answering by parsing chat text while the panel is open · multiple concurrent interrogations · images in answers · mouse input · cross-restart draft persistence (documented limitation) · modifying pi core (public extension APIs only) · per-request state injection (vetoed).


# Product Requirements — pi-interrogator

## Problem

In default pi, when a model asks dozens of planning questions, the question list scrolls off screen as soon as the user answers the first batch. The user must scroll up to re-read, losing the input box. Requirements end up scattered, contradictory, and forgotten. Iterative spec-building (structured interrogation) needs the question set to stay front-and-center while the user answers at their own pace.

## Goals

1. Overload the user with dozens of questions *without them getting lost*: one persistent panel, always at the bottom where the prompt lives.
2. Partial submissions: answer as few or as many as wanted per submit; unanswered questions stay open. **When every question is answered, the submission happens by itself** — no extra hotkey (2026-09-18 interrogation: the user "already answered everything" and must not be asked to do more).
3. Agent ingests answers between submissions, revises/re-opens/re-asks affected questions; answered questions auto-close after the agent's next reply unless re-asked.
4. Side conversations without losing the interrogation: break out, chat, resume — user- or agent-initiated.
5. Typed-answer experience identical to normal pi prompting (user's actual editor, vim modes included).
6. Minimal agent-facing token cost; terse instructions; no per-request state spam.
7. **No surprise surfacing**: the panel never opens itself unless the user asks, the model adds new work, or the model explicitly reopens it (2026-09-18 interrogation: reads and navigation must never replace the prompt box).

## Users

- **The planner** (human): answering questions, editing answers, requesting side discussions. On any terminal, including low-height remote sessions.
- **The agent** (model): asks questions via one tool, reads state on demand, reconciles contradictions, writes the final spec from the injected record.

## Functional requirements

### Interrogation lifecycle
- FR-1 The model calls `interrogate` with a full question set (upsert). The tool returns immediately; the panel opens focused on the gate group if one is declared, else the first group.
- FR-2 The user answers any subset, in any order, editing earlier answers freely (including archived ones — archived means "not pending", not "immutable"). Editing re-marks a question pending.
- FR-3 `ctrl+s` submits all pending answers immediately (no review screen). Each submission: (a) delta message to the model (~2 lines + reminder line "consider how these affect your other questions"; the ≤3-line shape is enforced — write-in/text entries flattened to one line and per-entry capped, BUG-006), (b) user-only diff card in the transcript, (c) epoch bump, (d) **post-submit exit** — after every REAL delivery (both `ctrl+s` and auto-submit firings; the zero-shipped early return stays open) the panel auto-suspends back to the normal prompt (`done(null)`, the same esc suspend contract — FR-14): the diff card is the confirmation and the suspend widget shows the resume cue, so the panel never parks on the same question waiting for esc; the next upsert leaving unanswered questions (SURFACE-001/FR-D6), `{reopen:true}` (FR-6), or `/interrogate` (FR-14) resurfaces it. **Auto-submit (AUTOSUBMIT-001, narrowed by AUTOSUBMIT-003 2026-09-30)**: after an answer commit — option accept, Other write-in commit, text-answer enter, ripple-confirm applied edit — when zero unanswered (open/reasked) questions remain AND the commit is either (a) the last-unanswered TRANSITION (it answered the final open/reasked question, anywhere in the list) or (b) an edit of the last sequential ANSWERABLE question on an already-complete set (the review-flow exit), the identical submission pipeline fires automatically with a footer flash; a held batch note rides it. Other edits of a complete set ship nothing (manual ctrl+s). Gate hold (AUTOSUBMIT-002): while gate-group questions are unanswered, commits show the non-expiring `⚠ {n} foundational unanswered — answer them or {submit} to submit now` line instead of auto-submitting; `ctrl+s` overrides deliberately.
- FR-4 After the agent's reply to a submission (`agent_settled`), submitted questions close unless that reply upserted (re-asked) them. Aborted replies count as settled.
- FR-5 When the last open question closes, the extension injects the complete Q&A record once (`interrogation-completion` message) and the panel auto-dismisses. The model writes the spec from that record.
- FR-6 The agent may reopen the panel at its judgment via `interrogate({reopen:true})`. No deterministic guard. The suspend widget is always visible while suspended so the user is never stranded.

### Panel UX (details in ui-spec.md)
- FR-7 Short form by default: question one-liner, first sentence of the description dimmed beneath, options with unmistakable recommendation marks (★ + preselect — preselect applies only while the question is unanswered; once answered, the recorded answer owns the caret, FR-35).
- FR-8 One toggle (default `ctrl+d`) opens the deep view: full replacement of the Q&A section with the full description plus every option's ramification text, each option as a sticky header, scrollable, options selectable, `enter` selects and returns to short form advancing to the next unanswered question. Toggle is sticky while the panel is open.
- FR-9 Navigation freedom (hard requirement R1): forward/back among questions at all times; nothing locks the user onto a question. The `←` / `→` arrow keys navigate the FULL question list (every status — open, answered, re-asked, moot, withdrawn, closed — clamped at the ends, no wrap), view-aware like the config prev/next keys (overview: cursor row); they are fixed keys and are not intercepted in text/note focus (the editor caret owns them there). Soft gate only: all groups visible and answerable; gate group focused first, later groups dimmed; submitting with gate unanswered shows a dismissible warning line.
- FR-10 Progress footer: `3/12 answered · 2 re-asked ·` plus the 3–4 keys relevant to the current screen, reflecting actual configuration.
- FR-11 Overview list (`ctrl+l`): all questions with status markers (open/answered★/re-asked⟳/moot⊘/withdrawn⊗/write-in or text answer ✎); `enter` jumps.
- FR-12 Free-text on any question via the composed active editor (`getEditorComponent()` factory — the user's vim keybindings work), in TWO duties (WRITEIN-001, 2026-09-18 interrogation): **write-in** — every choice question's options list ends in a synthetic `✎ Other — write your own` row; accepting it makes the editor the answer surface (`enter` commits `answer.value = text` with `custom: true`, advances — a hand-written answer ships by itself, no option required); **elaboration** — `ctrl+t` (the "ctrl+ key to enter an explanation"; existing `keys.focusText` binding, refined) attaches the draft to the selected option at submit (`answer.text`); it never answers alone. One draft slot per question; its role binds to the selection at commit/submit (WRITEIN-002). Enter commits in every duty where the text completes an answer — the two-stage arming machinery is removed. The duty is re-derived from the cursor position on every question change (BUG-004) — `enter` after navigation follows the fresh cursor, never the stale entry duty. `shift+enter`/`ctrl+j` newline; separate history; `ctrl+g` opens `$EDITOR` seeded with the draft. While the editor is focused, single `esc` and arrows forward to the editor (vim semantics); exiting the field never suspends the panel.
- FR-13 Batch note (hard requirement R3): `ctrl+shift+m` opens a note field at any time; the note is held and delivered as a `NOTE:` line with the next submission.
- FR-14 Break-out (`esc` from the short view): suspends the panel; main editor becomes available; drafts and panel state preserved; widget shows open/answered counts and the `/interrogate` resume cue; resume focuses the first unanswered question. `/interrogate` is INVOKE-ONLY: with an existing session it invokes the panel immediately in every scenario (open stays open, suspended resumes, closed host opens fresh) — it never suspends, and no global key shortcut exists (the historical `ctrl+shift+q` chord closes windows on many desktop environments and was removed).
- FR-15 Per-question "discuss in chat" handoff: suspends the panel and preloads the current question + options into the main editor as a quoted prompt for a focused side chat.
- FR-16 `esc` descends: deep view → short form; overview → panel; at top level → suspend. Esc never destroys any state. Exception: while the embedded editor is focused, a single `esc` forwards to the editor; `esc` twice within the configured window closes the prompt box only (no suspend).

### Dependency and ripple semantics
- FR-17 Questions may declare `dependsOn: [{id, equals?, notEquals?}]`. Conditions are evaluated locally and instantly: unmet questions grey out as moot with reason (`moot: storage=sqlite`), kept in the map (audit trail), never silently removed.
- FR-18 When the user changes an answer to an *answered* question and the change invalidates other answered/submitted questions via `dependsOn`, the panel shows an inline confirm before applying: `⚠ Invalidates 3 answered questions (Q7, Q12, Q19) — enter=keep, esc=cancel`. No drill-down in v1. A same-value re-commit is not a change — no confirm, no state write (ANSWER-PIN-001).
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
- FR-28 On session start with live questions (any resumable status): state restores SILENTLY and the suspend widget line appears — **the panel NEVER auto-opens (SURFACE-002: session-start auto-open is disabled entirely; the user runs `/interrogate` to get the panel back — 2026-09-19 completion elaboration, stronger than the unanswered-only option value)**. Drafts are not persisted across restarts (documented limitation). Mid-session `/tree` navigation (`session_tree`) reconstructs state silently and never opens or reopens the panel — a user browsing the tree who is not using the interrogation must never see it appear (details: state-and-persistence.md §Branching). No event other than `/interrogate`, an agent upsert leaving unanswered questions, or `{reopen:true}` may open the panel — **reads never surface**, whatever the state (SURFACE-001).
- FR-29 `session_before_compact` supplies custom instructions: preserve verbatim the user's stated goals and plan constraints from all messages, all interrogation answers and changes, and the goal field.
- FR-30 Goal field: agent-supplied, updatable, shown in the panel header at all times; anchors re-asks and compaction summaries.

- FR-31..34 (remote bridge surface) REMOVED 2026-10-02 — the default-on bridge
  emitted every upsert as a pi-ask flow whose wire marked each question's
  recommended option, and committed every wire answer as a user shipment; a
  conformant client with preselected form widgets therefore fabricated
  "answers" for every question the user never touched (see
  BUG-panel-phantom-recommended-submissions.md and spec/decisions.md §Remote
  bridge surface removed). No usable remote experience existed; removed
  entirely rather than gated.

### Answer pinning (ANSWER-PIN-001, 2026-10-04 interrogation)
- FR-35 **A recorded answer owns the cursor; the recommendation never displaces or re-proposes it.** Whenever a question carrying an answer is rendered or entered — any status with `answer` present (answered, submitted, closed; moot keeps its dimmed answer too) — the caret/highlight sits on the recorded answer: the option row whose value equals `answer.value`, the `✎ Other` row for write-ins (`custom: true`; its dim preview shows the text), the text affordance for `type:"text"`. Every entry path: `←`/`→` and prev/next navigation, resume/reopen rehydration, deep view, editor close. `enter` (and digit quick-select) on the already-recorded value is a state NO-OP that may advance (Q14 rhythm): no `applyAnswer`, no fresh `answer.at`, no ripple modal, no auto-submit trigger; a byte-identical write-in re-commit is equally inert. The ★ recommendation stays visible on its own row but may never own the caret, preselect, or re-propose once an answer exists; ★ preselect survives only on unanswered questions. Editing an answered question requires an explicit, DIFFERENT choice (caret moved to another row, different digit, changed write-in text) — the FR-18 confirm guards exactly that. Defensive edge: an answer value no longer in `options` clamps the caret to display row 0 — never to the recommendation. The short-view question line carries the answered marker (★, per the glyph vocabulary — parity with the overview's answered rows).

## Hard requirements (from user tooling evaluations)
- R1 navigation freedom (FR-9) · R2 unmistakable recommendation marks (FR-7) · R3 batch note (FR-13) · R4 draft preservation (commitment 6) · R5 all hotkeys configurable (commitment 7) · R6 no surprise surfacing (goal 7 / FR-28, SURFACE-001/002) · R7 recorded answers own the cursor; nothing re-proposes them (FR-35, ANSWER-PIN-001, commitment 8).

## Acceptance criteria (all must pass; scripted where possible)

1. Model upserts 30 questions across 4 groups with one gate group → panel opens; chat visible above; gate focused; other groups dimmed but answerable.
2. Answer 2 of 30, `ctrl+s` → model receives a ≤3-line delta + reminder; user-only card shows both answers; 28 remain open; epoch bumps.
2a. **Write-in (WRITEIN-001)**: on a choice question, accept `✎ Other`, type free text, `enter` → question answered with `answer.value = <text>`, `custom: true`, NO option selected; card and delta render `✎ {text}`; advance moves on; the write-in ships by itself at the auto-submit.
2b. **Elaboration (WRITEIN-001)**: `ctrl+t`, type, `enter` → draft saved, question still unanswered; accept a real option → elaboration attaches as `answer.text` at submit; accepting a real option after a committed write-in keeps the slot's text as elaboration (WRITEIN-002).
2c. **Auto-submit (AUTOSUBMIT-001)**: answer the LAST remaining question (accept / write-in / text `enter`) → submission delivers with no keypress beyond the answer itself; footer flashes `submitted — {n} answer(s)`; editing an already-answered question while the set is complete ships the edit immediately (one submission per commit).
2d. **Gate hold (AUTOSUBMIT-002)**: with a gate question unanswered, commits show `⚠ … foundational unanswered` and do NOT auto-submit; answering the gate question releases the next commit's auto-submit; `ctrl+s` submits anyway.
3. Agent replies without upsert → the 2 close (archived markers in overview). Agent replies with a re-ask of one → that one shows re-asked, answer reset, draft preserved.
4. Mid-panel: break out → widget appears with counts → side chat runs a full agent turn → agent `{reopen:true}` → panel returns with drafts intact; main editor draft also intact.
5. Deep view: toggle, scroll all ramifications (incl. the Other section), select an option from deep view → returns to short form, advances.
6. Answer a gate question contrary to a `dependsOn` → dependent greys as moot with reason, instantly; overview shows ⊘.
7. Edit an answered question that invalidates 3 others → confirm dialog appears; esc cancels with no state change; enter applies.
8. Stale upsert (wrong `rev`/`epoch`) → rejected; result contains current text/rev and delta digest; model re-applies successfully.
9. Restart pi mid-interrogation → NO panel appears (SURFACE-002); the widget line shows live counts; `/interrogate` reopens with questions/answers restored (any status mix); drafts gone (documented); pending answers ship on the next commit or submit (AUTOSUBMIT-001).
10. `/compact` mid-interrogation → summary preserves user plan statements; subsequent read returns full state.
11. `pi -p` (print mode): interrogate returns markdown digest; model asks in text; `answers[]` records; state consistent.
12. Every default hotkey remappable via config; footer/widget strings reflect the remap.
13. Editing an archived answer re-marks it pending; next submission diff card highlights the change (`Q3: sqlite → postgres (changed)`).
14. All questions closed → completion record injected once; panel dismissed; recap card in transcript.
15. **Reads never surface (SURFACE-001)**: with a live interrogation (panel suspended, questions open), a model `interrogate({})` read completes → panel stays closed, editor untouched; the same holds for all-answered and completed states (src/tree-nav-repro.test.ts characterizations flip to fixed).
16. **Answer pinning (ANSWER-PIN-001)**: answer q1 with a NON-recommended option, advance, `←` back → caret + accent highlight sit on the chosen option (★ visible on its own row, caret NOT on it); `enter` advances to the next unanswered with zero state change (no modal, no epoch bump, no `answer.at` rewrite). A write-in answer pins the caret to the `✎ Other` row with its dim preview; a byte-identical write-in re-commit is inert. Choosing a DIFFERENT option on the answered question still raises the FR-18 confirm.

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
├── fallback.ts             # non-TUI digest + chat answer recording
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
- `ctx.ui.custom` (panel host), `ctx.ui.setWidget` (suspend reminder), `ctx.ui.getEditorComponent` (compose user's editor), `ctx.ui.setEditorText` (discuss handoff), `ctx.ui.notify`
- `pi.sendMessage` (submission/completion custom messages), `pi.appendEntry` (state mirror)
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
  label: Type.String({ description: "One-line short-view label; the detail belongs in ramification" }),
  ramification: Type.Optional(Type.String({ description: "Deep-view prose: standalone consequences of picking this option — what changes, effort, risk, trade-offs. Assume the reader sees ONLY this text: expand your reasoning, define terms, no shorthand/codewords, no 'as discussed'" })),
});

const QuestionSchema = Type.Object({
  id: Type.String({ description: "Stable identity you choose; never reuse for a different question" }),
  title: Type.Optional(Type.String({ description: "Short label used in digests and overview" })),
  prompt: Type.String({ description: "Short-form question text shown by default" }),
  description: Type.Optional(Type.String({ description: "Deep-view context, fully standalone: assume the reader has NOT seen the conversation. Take the explanation you would normally give and EXPAND it — define terms/acronyms, state concrete facts, lay out the decision space — never compress to shorthand. First sentence doubles as the short-view hint" })),
  type: StringEnum(["choice", "text"]),
  options: Type.Optional(Type.Array(OptionSchema, { description: "Required for type=choice" })),
  recommendation: Type.Optional(Type.String({ description: "Recommended option value; marked ★; preselected only while unanswered — a recorded answer always owns the cursor" })),
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
  questions: Type.Optional(Type.Array(QuestionSchema, { description: "Upsert (surgical): only the ids sent are created or updated — omitted live questions are untouched. To prune by omission, resend the full live set with withdrawOmitted: true" })),
  withdrawOmitted: Type.Optional(Type.Boolean({ description: "Set-replace mode: live ids omitted from this batch withdraw (answers kept). Only meaningful alongside questions[]; omission alone NEVER withdraws" })),
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
| `{}` | Read | goal, epoch, group summary, per-question FULL content blocks (one-liner + prompt/description/options/meta — 2026-09-15 pin). NEVER surfaces the panel (SURFACE-001) |
| `{reopen:true}` | Resurface panel | Confirmation |
| `{answers:[...]}` | Record user answers (non-TUI only; ignored in TUI) | Status line |

Answer values in results and deltas may be WRITE-INS (WRITEIN-001): the user's own text, committed via the Other row, shown as `✎ {text}` and flagged `custom`. Submissions may arrive without any user submit keypress — the panel auto-submits the moment every question is answered, and again on every subsequent answer commit while the set stays complete (AUTOSUBMIT-001): expect several small deltas during an edit pass instead of one batch; the read `{}` is the pull-refresh between them.

## Merge rules on upsert (by id)

1. Existing id, same option values → text/description/ramification updates apply silently; existing answer and rev-bump; drafts untouched.
2. Existing id, changed options → answer reset, status `reasked` (⟳ marker), rev-bump; panel draft *preserved* (surfaces when the user revisits).
3. New id → appended, status `open`, rev 1.
4. FLAG-GATED (2026-09-15 pin): omitted live ids withdraw (⊗ marker, kept in map with reason "withdrawn") ONLY when `withdrawOmitted: true` is sent. Default is patch semantics — omitted live ids are UNTOUCHED, so a surgical 1–2 question edit can never withdraw the plan.

## Guards (Q38=A)

- **rev**: every mutation of an existing question requires its current `rev`; mismatch → `isError` result: `STALE: {id} is at rev {n} (you sent {m}). Current: {text}. Re-apply.`
- **epoch**: any `questions`/`answers` call must carry the session `epoch` it was based on (top-level optional `epoch` param; read/submission results always include it); mismatch → `isError` with the delta digest since the model's epoch and current epoch.
- Read (`{}`) is always allowed — pull refresh is never guarded.

## Caps (Q27=A, configurable + scaled)

- Defaults: `description ≤ max(1200, budget/questionCount)` chars; `ramification ≤ 600`; `options ≤ 7`; `questions ≤ 40`; `goal ≤ 400`.
- Minimums (2026-09-15 deep-view quality pin, warn-only): a provided `description` under `minDescription` (200), an option `ramification` under `minRamification` (120), or an option with NO ramification at all — each produces a warning in the upsert result naming the field and instructing an expanded re-upsert. Never mutates, never rejects; `0` disables each floor.
- Budget scaling: `totalDescriptionBudget = min(0.04 × ctx.model.contextWindow, 60000)` tokens-equivalent (chars ≈ 4×tokens), divided across the batch.
- Over-budget content is **truncated with an explicit warning in the tool result** ("q7 description truncated at 2100 chars — restructure if essential"). Never a hard reject; all numbers overridable via config.

## Agent-facing text (resident; ≤120 words)

**Tool description:**

> Structured interrogation: plan by asking the user questions they answer in a persistent panel. Upsert `questions[]` surgically — only sent ids are created or updated (stable ids; existing questions require their current `rev`); omitted questions are untouched. To prune, resend the full live set with `withdrawOmitted: true` so omitted ids withdraw. Call with `{}` to read full current state, goal, and epoch. Answers arrive as submission messages — re-ask only those materially affected. First round: few broad foundational questions with key ramifications; send the full set up front. The question set is the plan: when it completes, the full record is injected — derive the spec from it, don't re-plan. If unsure your view is current, read before upserting.

**promptGuidelines (4 bullets — third added by the 2026-09-15 deep-view quality pin, fourth by the 2026-09-15 patch-semantics pin):**

- Use interrogate for structured planning questions instead of plain-text question blocks; send the full set in one call.
- After answers arrive, re-ask only questions materially affected by the new answers, then let the interrogation complete.
- The user decides from description/ramification alone — they must not need the conversation or external docs. Write them as fully expanded, self-contained prose (define terms, concrete facts, no shorthand or codewords). If the tool result warns a deep-view field is thin, re-upsert it expanded with the current rev.
- Omission never withdraws: edit surgically by resending only the questions you are changing (with their current revs). Prune deliberately by resending the kept set with withdrawOmitted: true.

## Result rendering (TUI)

`renderCall`: one-line row `interrogate {n} questions {+m new ~k updated}`. `renderResult`: status line + epoch; `expanded` shows full state summary. Renderers stay compact — the panel is the display, not the tool row.

## Non-TUI fallback (FR-25)

`ctx.mode !== "tui" || !ctx.hasUI` → no panel. The upsert result contains a numbered markdown digest (id, title, prompt, options with ★ marks, recommendation); the description instructs the model to relay it verbatim in chat. The user answers in their next prompt; the model records via `{answers:[...]}` (epoch-guarded). Read/completion work identically. Completion record is still injected once at close. The digest is the no-panel surface.

**Emission hooks:** A non-TUI record that records ≥1 answer invokes `onAnswersRecorded` (wired to `lifecycle.noteSubmissionDelivered`) so re-asked-then-re-answered ids close at that run's settle (AC-11). The executor stays UI-free and event-free — hooks only.

## Plain-text round detection (FR-26, TUI only)

After `agent_settled`, if the final assistant message contains ≥3 lines matching `/^\s*(?:Q?\d+[\).:]|[❓\-•*])\s+.+\?/` and no interrogate upsert occurred this run → `ctx.ui.notify("Question round detected in chat — /interrogate to move it into the panel")`. Throttled to once per 3 turns; config toggle `roundDetection` (default on); never transforms content.

## Status line format (shared by results and panel footer)

`{answered}/{total} answered · {reasked} re-asked · {moot} moot · epoch {n}`

`answered` counts questions with a decision on record: `answer` present and
status one of `answered`/`submitted`/`closed`. `withdrawn`/`moot` never count
as answered (their own segments report them). The same record-derived rule
governs the panel header, group summary lines, and the suspend widget line
(2026-10-02: single source of truth — the counter can no longer read `0/6`
above six questions that all display recorded answers).
# UI Spec — the panel and renderers

## Layout (TUI, replace-editor mode)

The panel is hosted by `ctx.ui.custom()` (non-overlay): it *is* the bottom editor region; the transcript stays visible above. Structure, top→bottom:

```
┌ interrogation · {goal} ─────────────── 3/12 answered · 1 re-asked ┐   ← header (1 line)
│ {group label} · Q7/{id} {title}                        [⟳ re-asked]  │   ← question line
│   {first sentence of description, dimmed}                           │   ← hint (short form only)
│   ▸ ★ sqlite   — Tool result details; branch-correct                 │   ← options (short form)
│     postgres   — Custom entries; simpler                             │
│     ✎ Other — write your own                                          ← synthetic write-in row (WRITEIN-001)
├──────────────────────────────────────────────────────────────────────┤
│ [embedded editor: write-in | elaboration | batch-note duty]           │   ← 3 lines default
└ enter accept · ctrl+d deep · ctrl+l list · ctrl+s submit · … ⏎       ┘   ← footer (1 line)
```

- **Deep view** (`ctrl+d` toggle, sticky per panel session): replaces everything between header and footer with a two-region pane — a PINNED question region on top (moot reason line when moot, full `description`, full `goal` below it, dimmed) that NEVER scrolls (DEEP-PIN-001: scrolling the answer choices can never hide the question being answered; the pre-pin single-scroll-pane layout let the sticky selection floor strand the question above the window with no way back short of toggling the view), and a scrollable options region under it — each option a sticky section header followed by its `ramification` text, then the synthetic Other section (`✎ Other — write your own`) with the extension-supplied ramification: "None of the listed options fit — write your own answer; it ships as the official answer for this question, not as an attachment to one of them." When the question region alone would overflow the pane, it is line-truncated bottom-first with a dimmed `…` marker — the description keeps priority over the goal (the goal is context already summarized in the header), and the options window never shrinks below a minimum height (4 lines). The highlighted section is marked by characters, not color alone (D-R14 amendment 9): `▸ sqlite` header prefix plus heavy `┃` pipes on its ramification rows (unselected sections: plain header, `│` pipes), in addition to accent+bold. Rows remain selectable: highlight + `enter` selects, returns to short form, advances (Q14). `↑/↓` scroll here (they don't navigate questions while in deep view).
- **Overview** (`ctrl+l`): full-screen-in-panel list of all questions with markers — `·` open, `★` answered, `⟳` re-asked, `⊘` moot (+reason, dimmed), `⊗` withdrawn, `✎` write-in/text answer; group headers; gate group marked `▲`. `enter` jumps; `esc` returns.
- **Gate rendering (soft, Q32=B)**: gate group renders normal; non-gate groups dimmed (still navigable/answerable — R1). Submitting with gate questions unanswered → dismissible footer warning: `⚠ {n} foundational unanswered — later answers may shift`.
- **Goal**: always in the header (FR-30). Truncated to fit, full text in deep view.

## Terminal fallbacks

- Height < 24 rows: hint line suppressed; deep view still available (it's a full replacement). Height < 12: overview list paginates 5 rows.
- Width < 60 cols: option labels truncate with `…`; ramifications wrap; footer shows 2 keys max (`submit`, `deep`).

## Free-text field (Q17=A, as amended by WRITEIN-001/002 — 2026-09-18 interrogation)

**Two duties, one editor (WRITEIN-001).** The single embedded editor per panel (h2.31) serves three duties, and the ACTIVE duty decides what the text MEANS. The two answer-side duties are entered by different, visibly labeled paths so "attach context" and "this text is my answer" can never be confused:

- **Write-in duty** — reached by accepting the synthetic **`✎ Other — write your own`** row (the LAST row of every choice question's options list, cursor index `options.length` — the same slot the old explain affordance occupied; fixed, not configurable, not digit-selectable). The editor seeds from the question's draft; the editor region is labeled `OTHER — this text is the answer`. `enter` COMMITS: `applyAnswer({ value: <text>, custom: true })` → status `answered` → dependsOn recompute → advance (Q14 parity — write-in commits behave exactly like option accepts). Empty buffer + `enter` = save draft + blur back to options, NO commit (nothing answered). This is the escape hatch: a hand-written answer ships BY ITSELF as `answer.value` with the `custom` marker — no option selection required. Recorded write-ins stay visible on revisit: the question line's `✎` marker covers `answer.custom` (parity with text answers — BUG-005) and a dimmed first-line preview of `answer.value` renders under the Other row.
- **Elaboration duty** — reached via `keys.focusText` (default `ctrl+t`, toggle as today; the user-requested "ctrl+ key to enter an explanation" — the existing binding, refined, not a new chord). The editor seeds from the question's draft; the region is labeled `EXPLAIN — attaches to your selection`. `enter` saves the draft + blurs to options. NO advance, NO commit: an elaboration alone never answers a question. While the cursor sits on the Other row (or the question is `type:"text"`), `ctrl+t` enters write-in duty instead — the duty follows where the user is, and is re-derived from the new cursor position on every question change (BUG-004: `enter` after navigation follows the fresh cursor, never the stale entry duty). (FR-18: saving an elaboration on an answered question whose ripple would invalidate answered/submitted questions routes through the same keep/cancel modal as any edit — simplified from the old arm-flag carry-through, which the two-stage removal obsoletes.)
- **Note duty** — unchanged (`ctrl+shift+m`, R3).

**Draft role follows the selection (WRITEIN-002).** ONE draft slot per question (R4, unchanged). Its role is bound at commit/submit time by what is selected: a real option → the draft is elaboration, shipping as `answer.text`; Other (or `type:"text"`) → the draft IS the answer, shipping as `answer.value` (`custom: true`). If a write-in is later superseded by accepting a real option, the slot's text is KEPT (R4 — never destroyed) and re-binds as elaboration for the new selection; it attaches at the next submit. A draft with NO answer on its question stays held (unattached elaboration) — it ships nothing, and the zero-pending flash names it: `nothing to submit — {n} question(s) have drafts awaiting an option or Other`.

**Enter is commit-and-advance everywhere the text completes an answer** — write-in duty and `type:"text"` questions alike. The two-stage arming machinery (`advanceArmed`, stage-2 advance, EXPLAIN-003's explain→enter→enter flow) is REMOVED: commits apply the answer at `enter`, so the armed second `enter` has no remaining purpose. Multi-line typing is unchanged and safe (`shift+enter`/`ctrl+j` insert newlines; plain `enter` commits). Elaboration `enter` saves + blurs only — it never advances and never arms anything.

- Instantiated once per panel via `ctx.ui.getEditorComponent()(tui, theme, keybindings)` — composes the user's active editor (vim modes etc.). Not focused by default; `ctrl+t` (elaboration) or accepting `Other` (write-in) focuses it.
- Separate history (never calls `addToHistory`).
- **Exit gestures (ESC-002)** — three ways back to normal question selection, none of which suspend the panel: `enter` (per-duty: write-in and text questions commit + advance; elaboration saves + blurs), `ctrl+t` re-press (save + blur, no commit), and `esc` twice in a row within `escExitWindowMs` (save + blur, no commit). While the editor is focused a single `esc` and `↑`/`↓` forward to the editor (pi-vim users keep their keys). Every exit is a draft write-through — backing out never loses typed text (R4). `ctrl+c` (CTRL-C-001) closes the whole prompt — suspend, unconsumed — from any state including modals, handing pi's normal SIGINT flow back to the restored editor.
- **Buffer scoping (EXPLAIN-002)**: the embedded editor is ONE component per panel session (h2.31), but its contents are **per-question**. Whenever the current question changes, the outgoing buffer is written through to *its* question's draft (R4 — tab-away-and-back is lossless) and the editor re-seeds from the new question's freshest draft — **blank when none exists**. Note duty suspends scoping (the note is question-agnostic); exiting note mode re-scopes to the current question.
- `ctrl+g` (mirrors `app.editor.external`): opens `$VISUAL`/`$EDITOR` (nano fallback) seeded with the draft via temp file; on clean exit the text replaces the field.
- **Draft preservation (R4)**: one draft slot per question (`{value, text}`) + one `batchNote`, held in panel memory for the panel's lifetime: survives navigation, deep/overview toggles, upserts (including answer resets — merge rule 2), suspend/resume. Destroyed only by submission (text answers ship) or user-initiated clear. Not persisted across restarts (documented).

## Auto-submit at completeness (AUTOSUBMIT-001/002 — 2026-09-18 interrogation)

`ctrl+s` is no longer the only way a submission happens, and it is no longer required when the user has answered everything:

- **Auto-submit fires on the LAST-ANSWERED TRANSITION (AUTOSUBMIT-001 as amended by AUTOSUBMIT-003, 2026-09-30).** After every commit — option accept, Other write-in commit, text-answer `enter`, ripple-confirm applied edits — the panel runs the completeness check: zero questions with status `open`/`reasked` remain (moot/withdrawn/closed never count as unanswered), AND at least one question is pending (`answered`). Completeness alone is NO LONGER sufficient (the premature-fill experience: with every question pre-answered, each corrective edit re-shipped the full group). The submission fires automatically only when:
  - **(a) the transition** — THIS commit answered the last remaining unanswered question, anywhere in the list (the commit's question was `open`/`reasked` pre-commit and zero remain post-commit); or
  - **(b) the review-flow exit** — the set was already complete and THIS commit edited the last sequential ANSWERABLE question (last non-moot/non-withdrawn row in list order — moot/withdrawn tails can never be committed, so the last answerable is the effective end of the list).
  Every other edit of a complete set ships nothing — manual `ctrl+s` territory. When it fires, it runs through the EXACT `ctrl+s` pipeline (reconcile → baseline/diff → BUG-008 filter → gate check → markSubmitted → buildSubmission → deliverSubmission → noteSubmissionDelivered), the footer flashes `submitted — {n} answer(s)`, and any held batch note rides it (R3). Then the panel suspends itself (FR-3d post-submit exit) — every firing, manual or automatic, ends back at the normal prompt.
- **Gate hold (AUTOSUBMIT-002).** While any gate-group question is `open`/`reasked`, auto-submit is withheld. The common case is exactly what the hold line exists FOR: a gate question is itself unanswered, so the completeness check would return and nothing would fire — the ⚠ line is what makes that hold visible instead of silent (BUG-001: it arms on EVERY commit while gate questions are unanswered, including commits the completeness check already withholds). So whenever a commit lands while gate questions remain unanswered, the non-expiring footer warning shows `⚠ {n} foundational unanswered — answer them or {submit} to submit now` (any key dismisses, never blocks — the soft-gate philosophy holds; `ctrl+s` is the deliberate override).
- **One shared hook, context-carrying.** The check (`maybeAutoSubmit`) runs after panel commits — the commit context (`wasUnanswered`, `questionId`) is load-bearing: a context-free call never auto-submits. It no-ops on zero-pending.
- **`ctrl+s` remains** for partial submissions at any time, as the gate-hold override, and as the manual ship path for non-last edits of a complete set.

## Batch note (R3)

`ctrl+shift+m` swaps the editor area into note mode (header shows `NOTE — ships with next submission`); same embedded editor; `enter` saves + exits, `ctrl+shift+m` re-press or `esc` twice in a row exits (single `esc` forwards to the editor — ESC-002). Stored as `batchNote`; delivered as a `NOTE:` line in the delta and shown on the card; cleared after shipping.

## Ripple confirm (FR-18, Q39=B)

On committing an answer change to an *answered* question in the panel (the moment `enter` finalizes — option accept, write-in commit, or a text/write-in re-commit on an answered question), if `dependsOn` ripple (transitive closure) hits answered/submitted questions: footer becomes `⚠ Invalidates {n} answered questions ({ids}) — enter=keep, esc=cancel`; `esc` reverts the edit; `enter` applies — and the applied commit then runs the auto-submit check like any other. No drill-down in v1. An identical re-commit — `enter` or a digit on the already-recorded value, or a byte-identical write-in — is not a change: no modal, no state write, advance only (ANSWER-PIN-001).

## Hotkeys — defaults and config

**Intercept rule**: panel-level keys are intercepted *before* the embedded editor sees them, whenever the panel is open (including text focus). Everything else forwards to the embedded editor. **Exception — fixed keys while the editor is focused (ESC-002)**: when the editor holds focus, `↑`/`↓` and a single `esc` forward to the editor itself (caret movement; pi-vim mode exit) instead of driving the panel. All keys rebindable via config `interrogator.keys.*`; no exceptions (R5).

| Action | Default | Config key | Context |
|---|---|---|---|
| prev/next question | `tab` / `shift+tab` | `keys.prevQuestion`/`nextQuestion` | short form |
| prev/next question | `←` / `→` | fixed (not configurable) | panel (all views; full list incl. moot/withdrawn; overview: cursor row) |
| move among options | `↑`/`↓` | fixed | short form (cursor domain includes the Other row) |
| quick-select 1–9 | `1`–`9` | `digitQuickSelect` toggle | short form — REAL options only (never the Other row) |
| accept + advance | `enter` | fixed | options focus (Other row → write-in duty); write-in/text editor focus (commits the answer); on the already-recorded answer: state no-op, advance only (ANSWER-PIN-001) |
| toggle deep view | `ctrl+d` | `keys.deep` | panel |
| overview list | `ctrl+l` | `keys.overview` | panel |
| elaborate on selection | `ctrl+t` | `keys.focusText` | panel — TOGGLE into the editor: elaboration duty by default; write-in duty when the cursor is on the Other row or the question is `type:"text"`; press again to close the prompt box (draft saved) |
| batch note | `ctrl+shift+m` | `keys.batchNote` | panel |
| submit (partial / gate override) | `ctrl+s` | `keys.submit` | panel — partial submissions and the deliberate gate-hold override; completeness auto-submits (AUTOSUBMIT-001); every real delivery auto-suspends the panel (FR-3d post-submit exit — the upsert gate, `{reopen:true}`, or `/interrogate` resurfaces it) |
| discuss in chat | `ctrl+shift+e` | `keys.discuss` | panel |
| external editor | `ctrl+g` | `keys.externalEditor` | editor focus (any duty) |
| back / suspend | `esc` | fixed | OPTIONS focus: descends (deep→short, overview→back, short→suspend), never destroys. EDITOR focus: single `esc` forwards to the editor (pi-vim); `esc` twice in a row (within `escExitWindowMs`, default 500 ms, 0 disables) closes the prompt box ONLY — draft write-through, blur to options, no suspend |
| interrupt / escape | `ctrl+c` | fixed | closes the prompt (suspend) and stays unconsumed so pi's own ctrl+c flow (clear; double-press shutdown) resumes on the restored editor; works from any panel state including modals (CTRL-C-001) |

Non-key config: `escExitWindowMs` (ms, default 500) — the double-esc window for closing the embedded editor without suspending.

Conflict avoidance (verified against pi defaults + installed extensions): `ctrl+b`, `ctrl+shift+b`, `ctrl+shift+x`, `ctrl+shift+j`, `shift+down` are taken by others — avoided. `ctrl+m` avoided (sends `\r`). NO global shortcut is registered (the historical `ctrl+shift+q` break-out/resume chord was removed — window managers claim it to close windows on many desktop environments, so it never reliably reaches the terminal). Dev agent must re-verify at build time and record findings in the PR notes.

Fixed-key notes: `←`/`→` navigate the FULL question list (every status navigable, clamped at the ends — no wrap), view-aware exactly like the config prev/next keys (overview: cursor row; short/deep: current question), and are NOT intercepted while the embedded editor holds focus (text/note) — the editor caret owns horizontal movement there.

## Suspend / resume / widget

- Suspend: `esc` at top level (the fixed view-descent ladder's terminus) or the completion flow's dismissal. Panel `done(null)`; state + drafts held in extension memory; **main editor text preserved** (pi's editor instance persists across `custom()` sessions; verify in test).
- **Command surface (CMD-001 + breakOut removal)**: `/interrogate` is the ONE registered command — bare invocation opens or resumes the panel (INVOKE-ONLY, never a suspend toggle); `ping` (smoke test) and `debug upsert|submit|state` (the h2.50 verification surface) are subcommands with argument completion, keeping `/interrogate` the top (and only) autocomplete hit for "/inter".
- Widget (`setWidget("interrogator", [...])`, visible whenever suspended with open questions): `{n} open · {m} answered — /interrogate to resume`. The line names the command ONLY — no key chord ever appears (the historical `ctrl+shift+q` chord closes windows on many desktop environments and was removed; there is no `keys.breakOut` action and no global `registerShortcut`).
- Resume: `/interrogate` or agent `{reopen:true}` → fresh panel instance rehydrated from state + drafts, focused on the **first unanswered question** (open/reasked, in state order — RESUME-001); when nothing is unanswered (pending-submit state), the last-focused question; else the first resumable one.
- Tree navigation (`/tree` → `session_tree`): NEVER opens or reopens the panel — navigation is a read-only act and never a surface trigger. State follows the branch silently; an open panel suspends (stale-branch content must not linger), a suspended one stays suspended with its resume references retargeted, so resume stays deliberate (`/interrogate`, model upsert, `{reopen:true}`) and branch-correct. A branch without (live) interrogation leaves no widget, no resumable record.
- **Surfacing allow-list (SURFACE-001 — 2026-09-18 interrogation).** The panel may be opened ONLY by: the user (`/interrogate`), an agent upsert that leaves unanswered questions (new or re-asked — visibility follows new work; a description-only edit while everything is answered surfaces nothing), or agent `{reopen:true}` (explicit intent; the hasResumableQuestions gate stays). **Pure reads never surface, regardless of state** — `maybeAutoOpen` requires (1) the call was an upsert (`questions[]` non-empty — via the tool_execution_start args stash), (2) unanswered (open/reasked) questions exist post-upsert, (3) the interrogation is not completed. The suspended-reopen path (`handleUpserted`) carries the same unanswered gate. Rationale (dogfood finding): any successful interrogate call — including a pure `{}` read — used to pop the panel whenever a state object existed, even all-answered or completed; after `/tree` navigation the model's re-orient read then replaced the user's prompt box mid-turn, and pi's custom() snapshot/restore of editor text made every such pop a data-loss trap (the empty-box-after-esc symptom). Reads are pull; they are never surfaces.
- `/interrogate` is INVOKE-ONLY (immediate in every scenario): panel open → silent no-op (never suspends); panel suspended with live questions → resume; closed host with live state (e.g. after an extension reload) → fresh open from the session singleton; no/dead state → the empty-state notify below. Typing `/interrogate` must NEVER leave the user behind a "press X to resume" gate.
- Discuss-in-chat (`ctrl+shift+e`): suspend + `setEditorText` with:
  ```
  > {prompt}
  {options one per line, ★ marked}
  (discussing q{id} — agent: side-chat freely; reopen panel when done)
  ```

## Color, order & breathing room (LOCKED 2026-09-30 — interrogation D-R11–D-R13 + live-review D-R14)

The visual contract below is LOCKED as of 2026-09-30; amendment history and reversion rationale live in decisions.md (D-R14), not here.

- **Footer names the explain chord (D-R11).** The short-view footer permanently carries `ctrl+t explain` (resolved via `keys.focusText`), appended after the existing hints — first casualty of the narrow-width right-to-left drop loop, and dropped (not swapped) while the editor holds focus, where `focusText close` already owns the label.
- **No explain surface for Other (D-R12).** A write-in (or `type:"text"`) answer is the whole answer; explaining means writing it into the value. The custom-skip rule in the submit pipeline stands.
- **Selected answer highlight (short view).** The recorded answer's option row renders its label in `accent` AND owns the caret whenever the question carries an answer (ANSWER-PIN-001): cursor seeding prefers the recorded answer (option row; `✎ Other` row for write-ins; text affordance for text questions) over the ★ preselect — which applies only to unanswered questions. Write-in previews stay dim; the ★ recommendation stays visible on its own row.
- **Recommended-first display order (D-R13).** Option rows (short) and option sections (deep) render recommended-first — the ★ option leads, the rest keep state order (stable sort; display-only — state stores nothing about the order). The cursor domain, digit quick-select (1..9 follow displayed order), and the ★ preselect all speak display positions; accept maps display→option internally (`displayOptions`). The ★ preselect applies only while the question is unanswered — a recorded answer owns the cursor (ANSWER-PIN-001).
- **Deep-view visual contract (D-R14, locked).** On expand the explanation is the primary element: ramification text RAW full-intensity; titles PRIMARY (theme `text`), both at the INSET column (col 2). Every explanation row carries a `│` pipe one char right of the titles (bar col 3, text col 4); bars render PRIMARY (theme `text`). The selected section is shown BY COLOR — `accent` + `bold` on its title AND its bars; no ▸ arrow glyph (bold is the no-color fallback: color degrades harmlessly in colorless terminals while bold still differentiates; the short view keeps its ▸ cursor). `accent` otherwise appears only in the short-view highlight. Moot still dims the whole pane.
- **Padding (variations A + B, locked).** One blank line below every view's scroll area — ABOVE the footer, not after it; transient gate-warning/flash lines stay adjacent to the footer, directly on top of it — plus a 2-col right margin on the options region (short) and deep pane content so answers sit equidistant from the frame edges. One blank line between each deep-view answer section (after every option's ramification block, including before the ✎ Other section); the separator rides the content and scrolls with it.

## Renderers

- `interrogation-submission` (registerMessageRenderer): user-only card from `details.card` — each changed answer renders `{title}: {new}` when first answered (NEVER `(unanswered) → …`: an answered question must not read as unanswered) and `{title}: {old} → {new (changed)}` only when a prior answer existed (re-answer/edit; an answer clearance shows `→ (unanswered)`, which is honest — it IS unanswered now), plus any `NOTE:` line + `{open} remain open`; write-in answers render as `✎ {text}` (truncated to fit); compact by default, `expanded` shows full submission including full write-in text.
- `interrogation-completion`: recap card — goal, every question with final answer (grouped; write-ins as `✎ {text}`), timestamps; `expanded` shows withdrawn/moot with reasons.
- `interrogation-state` (registerEntryRenderer): dimmed one-line mirror marker (audit trail; not interactive).
- Tool row renderers per tool-protocol.md.

## Empty/edge states

- `/interrogate` with no state → `notify("No active interrogation — ask the agent to interrogate you", "info")`.
- `/interrogate` with an existing session → panel invoked immediately in EVERY scenario (see Suspend/resume above); repeated invocations are silent no-ops while the panel is open.
- Set complete → auto-submit has already shipped (AUTOSUBMIT-001); the `submit pending answers first` edge is gone. A user who suspended between the last commit and delivery resumes to a pending-submit panel; one `ctrl+s` (or any new commit) flushes it.
- Zero-pending `ctrl+s` → no-op footer flash `nothing to submit` — or, when drafts sit on unanswered questions, `nothing to submit — {n} question(s) have drafts awaiting an option or Other` (WRITEIN-002 held-elaboration guidance).
- Reads and completed interrogations never open the panel (SURFACE-001); session restart/resume/fork never reopens it either (SURFACE-002 — auto-open disabled entirely) — the suspend widget line is the ambient indicator while questions remain resumable, and `/interrogate` brings the panel back.
- Model upserts while panel suspended → panel reopens only when the upsert leaves unanswered questions (upsert-implies-visibility, gated — SURFACE-001); description-only edits over an answered set surface nothing.
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
- Answer edits apply through the ripple confirm (ui-spec.md) before entering `answered(pending)`. A same-value re-commit is not an edit — no confirm, no state write (ANSWER-PIN-001).

## rev and epoch semantics

- `rev` (per question, integer, starts 1): bumps on any content mutation (agent upsert text/options/dependsOn, or withdrawal-re-add). The model must echo the current rev when upserting an existing question. User answers do **not** bump rev (answers are epoch territory).
- `epoch` (session, integer, starts 1): bumps on every submission — including every auto-submitted one (AUTOSUBMIT-001; each firing is a full submission). Any `questions`/`answers` call must carry the epoch it was based on (top-level `epoch` param). Read is never guarded. Both guards reject with current state + delta digest (tool-protocol.md).
- Snapshots: full state copied on every submission (bounded ring of 10) — powers diff cards and post-hoc recovery; not user-facing undo in v1.

## Answer shape (WRITEIN-001)

`answer = { value, at, text?, custom? }`. `custom: true` marks a WRITE-IN: `value` holds the user's own text (not an option value), committed via the synthetic Other row (panel), shown as `✎ {text}`. Renderers, diff cards, and the completion record display write-ins as `✎ {text}`. Replay/reconstruction is value-first and needs no special case.

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
     TUI: NEVER open the panel (SURFACE-002 — session-start auto-open is
       disabled entirely; the user runs /interrogate). Set the suspend widget
       line directly when resumable questions exist — it is the ONLY cue.
       [The `session_tree` run of the same algorithm never opens anything
       either, see Branching.]
     non-TUI: mark fallback active
5. recompute dependsOn moot-ness from current answers (cheap, idempotent)
```

## Compaction (`session_before_compact`)

Handler returns custom instructions for the summarizer (FR-29), verbatim:

> Preserve verbatim: the user's stated goals and plan constraints from all messages (including side conversations), all interrogation answers and later changes, the interrogation goal, and the fact that current interrogation state is available via `interrogate({})`.

No other compaction machinery. Post-compaction, the model pull-refreshes; reconstruction survives via the entry mirror; the completion injection is unaffected.

## Branching (/tree, /fork, /resume)

`session_start` reconstruction is branch-relative (`buildContextEntries()`), so forked/resumed sessions inherit exactly the questions/answers visible on that branch. The entry-mirror fallback scans the same branch. Never cache state across `session_shutdown`.

### Tree navigation (`session_tree`) — silent, never a surface

Mid-session `/tree` navigation fires `session_tree` — NOT `session_start`
(pi reserves `session_start` for session replacement: startup | reload | new |
resume | fork). The same reconstruction algorithm re-runs against the
destination branch (raw branch walk, same base selection, same delta replay,
same moot recompute), with one absolute rule:

> **The panel NEVER auto-opens or reopens on tree navigation.** Surfacing is
> user-driven (`/interrogate`) or model-driven (an upsert while suspended,
> `{reopen:true}`) — never navigation-driven. A user who is not using the
> interrogation must never see it appear because they browsed the tree.

Consequences:

- State still follows the branch — branch-relativity is not optional: the
  singleton is reset and rebuilt from the destination branch; the non-TUI
  digest fallback flag is recomputed (it shapes tool results, never surfaces).
- Panel open at navigation time → suspends (descend, never destroy): an open
  panel must never keep rendering the abandoned branch's questions.
- Panel suspended → stays suspended, with the host's stored state references
  retargeted onto the reconstructed instance (and the current UI surface), so
  the next deliberate resume rehydrates from the branch the user is on now —
  never the pre-navigation state — and the suspend reminder line reflects the
  destination branch.
- Destination branch has no interrogation (or only a completed one) → full
  teardown: open panel suspended, reminder widget cleared, resume record
  disposed — nothing may stay resumable advertising a foreign branch's
  questions.

Design rationale: navigation is a read-only act on the user's part. Any
surprise surface movement on a read-only act is a bug, not a convenience.

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

Submissions now also arrive via auto-submit (AUTOSUBMIT-001) — the per-submission contracts (one epoch bump, one delta, one close-pass arming via `noteSubmissionDelivered`) are unchanged; auto-submit simply fires the same pipeline more often. A model turn triggered by an auto-submission may interleave with further user edits; each submission's snapshot ring keeps the diffs correct. The ring also captures the agent-settled close pass: every close pass that actually closes ids appends ONE snapshot at the submission's existing epoch — no epoch bump — whose question statuses are `closed` (a close pass with nothing to close appends nothing). These close-pass entries are what let post-archive edits diff as `(changed)` (AC-13: the archived snapshot supplies the `before.status === "closed"` side), and `digestSince` treats them as no-ops: consecutive same-epoch pairs whose answer signatures are identical contribute zero segments, so a submitted→closed status flip is digest-invisible.

## Drafts lifecycle (R4)

Panel-local `{questionId → {value, text}}` + `batchNote`. Preserved across navigation, view toggles, upserts, suspend/resume. Flushed into state on submit; cleared on submit or explicit clear. **Not** written to any persistent layer — restart loses drafts by design (documented limitation, Q6=B).

Role binding (WRITEIN-002): a slot's text is elaboration (`answer.text`) when its question's answer is a real option, and the answer itself (`answer.value`, `custom: true`) when the answer came via Other or the question is `type:"text"`; the binding is evaluated at commit/submit time from the current selection. Superseding a write-in with an option accept keeps the slot (R4) and re-binds it as elaboration.

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

**M4 — Text field + drafts.** `text-field.ts`: compose `getEditorComponent()`, `ctrl+g` `$EDITOR`, per-question drafts + batch note + `ctrl+shift+m`. ~~Two-stage enter~~ REMOVED (WRITEIN-001): the editor has three duties (write-in via the Other row / elaboration via `ctrl+t` / note), `enter` commits wherever the text completes an answer. Verify draft survival across navigation and upserts (R4).

**M5 — Deep view, overview, gate, ripples.** `deep-view.ts` (scrollable pane, sticky option headers, select-from-deep), `overview.ts`, group dimming + gate warnings, `dependsOn` evaluator + moot marks + ripple confirm. Verify AC-5, 6, 7.

**M6 — Suspend/resume ecosystem.** `esc` suspend + invoke-only `/interrogate` (immediate in every scenario) + widget naming `/interrogate`, reopen action, discuss-in-chat handoff with `setEditorText`, editor-text preservation across suspend. The `ctrl+shift+q` chord and its global shortcut were removed (window managers claim it on many desktops). Verify AC-4.

**M7 — Persistence + polish.** `persistence.ts` (mirror, reconstruction; auto-open removed per SURFACE-002 — widget line only), compaction instructions, message/entry renderers (cards), round detection (FR-26), terminal fallbacks (<24/<12 rows, <60 cols), config reference, README. Verify AC-8, 9, 10, 11, 12.

**M8 — Write-ins, auto-submit, surfacing gates (2026-09-19 interrogation; spec/decisions.md post-session pins).**
- `short-view.ts`/`deep-view.ts`/`overview.ts`: synthetic `✎ Other — write your own` trailing row (cursor index `options.length` — the old ✎ slot), extension-supplied deep-view ramification, `✎` marker = write-in/text answer; digits never select Other.
- `panel/panel.ts` + `panel/actions.ts`: editor duties (write-in commit = `applyAnswer({value, custom:true})` + advance; elaboration save+blur, never advances; `ctrl+t` duty follows cursor-on-Other/text); REMOVE `advanceArmed` two-stage machinery; `maybeAutoSubmit(panel, deps)` after every commit (zero open/reasked + ≥1 pending → exact submit pipeline + flash; gate questions unanswered → ⚠ hold line + no auto-submit); `reconcileDraftsForSubmit` role-binding (real option → `answer.text`; Other/text → `answer.value custom`); zero-pending flash: held-elaboration wording.
- `panel/panel.ts` `maybeAutoOpen` + `handleUpserted`: SURFACE-001 gates (upsert-call via the `pendingUpsertArgs` stash, unanswered-exist, not-completed); reads never surface.
- `reconstruct.ts`: SURFACE-002 — session_start NEVER opens the panel (auto-open disabled entirely); set the suspend widget line when resumable questions exist (non-TUI fallback flag unchanged: it shapes tool results, not surfaces).
- `state.ts`/`snapshots.ts`/`renderers.ts`/`completion.ts`: `answer.custom` marker; `✎ {text}` display in diff cards + completion record; replay stays value-first.
- Tests: FLIP the four characterizations in `src/tree-nav-repro.test.ts` (reads/all-answered/completed must NOT open; suspended-at-nav and open-at-nav stay green); flip the reconstruction auto-open assertions (reconstruct.test.ts / ac-panel.test.ts `opened: true` session-start rows → widget-set, no panel); new ACs 2a–2d, 15 (AC-9 rewritten: restart opens nothing); existing two-stage tests (`two-stage.test.ts`) rewrite for commit-at-enter semantics.
- Verify AC-2a/2b/2c/2d/15 + rewritten AC-9 (product-requirements.md).

**M9 — Answer pinning (ANSWER-PIN-001, 2026-10-04 interrogation).** `panel/short-view.ts` `initialCursorIndex`: a recorded answer (any status carrying `answer`) pins the cursor — display row of `answer.value`, `options.length` (✎ row) for `custom`, 0 for text; ★ preselect only when no answer; stale value → clamp to row 0 (never the recommendation). All three seed sites inherit it (panel.ts `currentId` setter + the EXPLAIN-003 editor-close re-seed; deep-view.ts `deepSeedCursorIndex`). `panel/actions.ts` `acceptOptionIndex` + `writeInEnter`: same-value short-circuit BEFORE the ripple seam — no applyAnswer, no `answer.at` rewrite, no maybeAutoSubmit; advance only. `panel/layout.ts`: answered marker (★) on the short-view question line — parity with the overview's answered rows. Purge every "answers never pin the cursor"/status-agnostic-preselect comment (short-view/panel/actions/deep-view/keys/tool-schema) and flip the tests asserting them (short-view, two-stage, deep-view, overview, ac-panel, actions, panel, ac-scripted, regression-phantom). Verify AC-16.

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
  - **AUTOMATION AMENDMENT (binding, supersedes the above in automated runs — see plan/001_0d6760db6bc5/AUTOMATION-POLICY.md)**: automated pipeline runs NEVER launch a live `pi -e .` TUI session, NEVER call the `interrogate` tool for real, and NEVER wait for user answers. Automation drives the same code paths via vitest integration tests over `executeInterrogate`/the debug handlers plus headless `pi -p` one-shot probes. "Launch `pi -e .`" and "manual verification" above describe the HUMAN test procedure (recorded in MANUAL-TUI-AC-RUNBOOK.md), not an automated step.
- **AC runbook**: execute acceptance criteria 1–15 (incl. 2a–2d) from product-requirements.md in order; each cites the FR it proves. AC-12 (rebinding) proves R5; AC-15 (reads never surface) proves R6/SURFACE-001. AC-4 includes verifying the *main editor's* draft survives panel suspend/resume. In automation, ACs are proven by scripted tests; interactive-only ACs are deferred to the human runbook and never block the pipeline.
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
            "batchNote": "ctrl+shift+m", "submit": "ctrl+s",
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
- Post-session user pins (2026-09-16, dogfood feedback):
  - ESC-002 — explain-field exit semantics: while the embedded editor holds focus, a single `esc` and `↑`/`↓` forward to the editor (pi-vim keeps its keys; the panel was swallowing esc and suspending the whole session from inside the prompt box). Closing the prompt box only: `esc` twice in a row within `escExitWindowMs` (new config, default 500, 0 disables) or `ctrl+t` re-press (focusText is now a toggle). All exits are draft write-throughs and never arm the two-stage advance; the FR-18 text gate applies with `arm: false`.
  - EXPLAIN-001 — the explain field is an elaboration, never an answer of its own (choice questions): ships as `answer.text` attached to the selected option; option selection stays fully available. On text questions it IS the answer (unchanged).
  - EXPLAIN-002 — the editor buffer is question-scoped: one editor component per panel, but switching questions writes the outgoing buffer through to its own question's draft and re-seeds (blank when the new question has no draft). Reported leak: a submitted long-form answer still visible when opening the box for another question.
  - EXPLAIN-003 — explain → enter → enter on a choice question ANSWERS it: stage-1 arming is text-question-only (an armed advance on a choice question skipped it unanswered — the reported "explained it but nothing was submittable"); the ✎ cursor re-seeds to ★ when the editor closes; the zero-pending submit flash names explained-but-unselected questions.
  - CTRL-C-001 — ctrl+c closes the prompt (suspend) and returns unconsumed, so pi's own ctrl+c semantics (app.clear: clear; double-press shutdown) resume on the restored editor. The panel was swallowing it — no way out, no shutdown. The suspend is itself a write-through: the in-flight editor draft stages to its slot before `done(null)` (R4 — BUG-002).
  - CMD-001 — ONE /interrogate command (was: /interrogate + /interrogate-ping + three /interrogate-debug-* registrations competing in the "/inter" autocomplete, ties broken by registration order burying the main command). `ping` and `debug upsert|submit|state` are now subcommands with getArgumentCompletions; the former "args are ignored" toggle contract retired.
  - RESUME-001 — `/interrogate` (and every explicit resume) reopens focused on the FIRST UNANSWERED question in state order (open/reasked), not the first question; pre-suspend focus memory is the fallback when nothing is unanswered.
- Post-session user pins (2026-09-19, second dogfood interrogation — 5/5 answered, epoch 2; session record: write-in answers, auto-submit, surfacing policy):
  - WRITEIN-001 — the options list's ✎ explain affordance is REPLACED by a true synthetic `✎ Other — write your own` row on every choice question: accepting it makes the embedded editor the WRITE-IN surface (`enter` commits `answer.value = <text>` with `custom: true`, advances — Q14 parity; a hand-written answer ships by itself). Explanation entry moves to the existing `ctrl+t` (`keys.focusText`) binding as ELABORATION duty (the user's "give the user a ctrl+ key" — binding reused, not a new chord; veto-able swap if a dedicated key is preferred). One editor, three duties (write-in | elaboration | note), each visibly labeled in the editor region; the duty follows entry path and cursor position (re-derived on every question change — BUG-004). Enter commits wherever the text completes an answer — the two-stage arming machinery (advanceArmed, EXPLAIN-003's explain→enter→enter) is REMOVED as obsolete.
  - WRITEIN-002 — draft role follows the selection: ONE slot per question binds at commit/submit time (real option → `answer.text`; Other/text → `answer.value`). Superseding a write-in with an option accept keeps the slot's text (R4) and re-binds it as elaboration. A draft with no answer stays held elaboration — ships nothing; the zero-pending flash names it. Chosen over submit-time disambiguation (rejected: the box's meaning must be unambiguous WHILE typing) and over one-box-two-gestures ctrl+enter (rejected: legacy terminals collapse ctrl+enter into plain enter, making "attach" vs "answer" unreliable).
  - AUTOSUBMIT-001 — every answer commit (accepts, write-ins, text enters, EDITS of answered questions) auto-submits through the exact ctrl+s pipeline whenever zero open/reasked questions remain; footer flashes `submitted — {n} answer(s)`; held notes ride. Edits included deliberately (q2 = every-commit): the user prefers zero required hotkeys over batching, accepting one model turn per edit. ctrl+s survives for partial submits and the gate override.
  - AUTOSUBMIT-002 — gate hold: while gate-group questions are open/reasked, auto-submit withholds and the non-expiring ⚠ line explains (`answer them or {submit} to submit now`); the completeness rule already covers the common case (a gate question IS unanswered), so the observable change is the explanation + ctrl+s override. Soft-gate philosophy preserved (never a hard block). Completion-record elaboration confirmed the premise: the scenario is a user filling out later groups before finishing the foundational one — hold was chosen on that understanding. Ordinary non-gate skips get no warning; the set is simply incomplete (footer counts show the remainder), ctrl+s ships partials.
  - SURFACE-001 — surfacing allow-list: the panel opens ONLY via `/interrogate`, an agent upsert leaving unanswered questions, or `{reopen:true}`. Reads NEVER surface (maybeAutoOpen gains: upsert-call, unanswered-exist, not-completed; the suspended-reopen upsert path carries the same gate). Root cause (found by characterization tests, src/tree-nav-repro.test.ts): any successful interrogate call — including pure `{}` reads — popped the panel whenever a state object existed, even all-answered or completed; after /tree the model's re-orient read then stole the prompt box mid-turn, and pi's custom() snapshot/restore of editor text turned every such pop into the empty-box-after-esc data-loss trap.
  - SURFACE-002 — session-start auto-open is DISABLED ENTIRELY (completion-record elaboration: "Disable auto-open entirely. I don't want it. The user needs to run /interrogate to get it back. It's annoying." — stronger than the recorded unanswered-only option value): reconstruction installs state silently and sets the suspend widget line (the only cue) when resumable questions exist; the panel opens only via `/interrogate` (closed-host-with-live-state path), an agent upsert, or `{reopen:true}`. Consequence: nothing ever calls openPanel from session_start — reconstruction's only UI act is the widget line.
- Hard requirements: R1 navigation freedom · R2 unmistakable recommendation marks · R3 batch note (held until submit) · R4 draft preservation (from ask_user evaluation: state loss on revisit is disqualifying) · R5 all hotkeys configurable, no exceptions.

## Protocol
- Q25 one tool, four action shapes (upsert / read / reopen / fallback-answers) · Q26 always-active description ≤120 words + 2 bullets (chosen over session-scoped: cache stability + discoverability) · Q27 soft caps, configurable, scaled by question count + ctx.model.contextWindow · Q28 instruction-only return, never terminate:true · Q29 non-TUI: numbered markdown digest, user answers next prompt, model records via answers · Q30 completion = full record injection; naming pi-interrogator / interrogate / /interrogate · Q31 guidelines + light plain-text-round detection nudge (throttled, non-transforming) · Q33 agent prunes between submissions (semantics) · Q34 moot/withdrawn dimmed with reason, kept in map · Q36 discuss-in-chat handoff (preloads question into editor) · Q37 goal field + compaction instructions + backup mirror.
- 2026-09-15 deep-view quality pin (Q26/Q27 amendment): observed shortcut — the model dumps its conversational shorthand into `description`/`ramification` and compresses further for `prompt`/`label`, leaving the deep view undecipherable without the chat. Fix is three layers, all soft: (1) schema field descriptions now state an expand-don't-compress contract with a standalone-reader assumption ("the reader has NOT seen the conversation"), replacing the old rendering-only text ("first sentence shows as a hint"); (2) a third promptGuidelines bullet makes the self-containment rule resident and names the re-upsert self-heal; (3) warn-only minimum floors (`minDescription` 200, `minRamification` 120, both 0-disable) lint present-but-thin deep-view text and options with missing or thin ramifications — every answer choice must carry its own standalone explanation — on the same h2.23 warning+self-correct path as truncation. Rationale: floors that mutate would fabricate detail, floors that reject would stall batches; the model's rev/epoch self-heal loop already exists. Missing descriptions do NOT lint (a question may be self-evident); a missing ramification on an option DOES — the per-choice explanation is the deep view's core guarantee.
- 2026-09-14 bugfix pin (Q7 clarification): a new interrogation after completion REPLACES the completed singleton — fresh state, epoch 1, completed=false, empty questions/snapshots; goal retained unless the new upsert supplies one. Resolves the gap flagged in architecture/spec-contracts.md § "Second interrogation in one session / epoch semantics after completion" (epoch-reset-on-new-interrogation was UNSPECIFIED); consistent with state-and-persistence.md § "Auto-close algorithm" "clear in-memory state" — the exactly-once completion guard is per interrogation lifecycle, not per session.
- 2026-10-07 bugfix pin (BUG-005, companion to the 2026-09-14 swap pin): "guard-friendly first upserts" extends to epoch-carrying ones on a freshly swapped state — assertFresh accepts ANY sent epoch when the receiver is fresh (epoch 1, zero live questions) and the batch is all-new ids; the digest is provably empty ("(none)") so the mismatch signal carried no information. Deliberately scoped: all-new-id batches on NON-empty states still epoch-STALE (rotation guard, guards.test.ts "epoch-only mismatch with only new ids"); the record path is untouched (a stale-epoch answers call is a true heal). Detected by invariant (no new state field — serialize/hygiene pins forbid one).
- 2026-09-15 patch-semantics pin (protocol amendment, supersedes rule-4-by-omission): first agent to use the tool edited one question with a 1-id batch and rule 4 withdrew the entire live plan — the wire format contradicted the tool's own "re-ask only materially affected" guideline. Panel decision (4 answers): (1) `questions[]` is surgical — omitted live ids are untouched by default; (2) withdrawal is opt-in set-replace mode: resend the kept set with `withdrawOmitted: true` (chosen over an explicit `withdraw: [ids]` list for muscle-memory continuity; full-content reads below offset the resend cost after compaction); (3) tolerant posture — withdrawals report as an informational result line (`withdrew (withdrawOmitted): …`), never a hard refusal (no unknown-id surface exists under flag semantics; inert ids stay no-ops); (4) `{}` read now returns FULL question content blocks (one-liner + prompt/description/options/meta) so surgical edits and full-set resends are compaction-proof. Rationale: patch semantics matches model priors, makes edit cost O(changed) not O(set), and removes the compaction fragility where an agent that cannot reconstruct the full set cannot safely edit anything.

## Remote bridge surface (2026-09-18; FR-31..34; REMOVED 2026-10-02 — see §Remote bridge surface removed below)
- D-R1 Speak pi-ask's documented bridge contract verbatim (`@eko24ive/pi-ask:*` on `pi.events` — pi-ask's remote-events.md designs the channel for "local bridges: status cards, desktop helpers, or approval UIs"; remote-pi's extension_ui_bridge is one conformant client): any conformant client renders the question set with ZERO bespoke integration; emission is inert with no listener. No runtime listener detection, no existence acks — the contract has none. Cost: bounded co-install cross-talk (a co-installed pi-ask nacks our flowIds → one transient client-side warning; our `completed` still resolves the flow) and a lossy wire mapping (D-R3).
- D-R2 FlowIds namespaced `itg:<rand>:<seq>` — stray submits attributable; foreign flowIds ignored silently (never nacked — pi-ask owns its own flows); malformed submits ignored (pi-ask owns nacking them; two nacks would double-warn).
- D-R3 Lossy field mapping (protocol conformance): prompt+description→prompt (bridge-side readers are the standalone readers the deep-view contract targets), title→label with explicit empty string (never omit — remote-pi's bridge duplicates the prompt into label otherwise), ramification→option description, ★ suffix on recommended option label, text questions = options:[], open+reasked questions only. gate/dependsOn/rev/epoch stay extension-side. Bridge clients cannot edit past answers in v1 (the panel's role).
- D-R4 Bridge answers validated against CURRENT option values (re-asks may have changed them); invalid entries dropped, all-invalid submit nacks `invalid_answer` and re-emits a fresh flow.
- D-R5 Bridge submits ride the PANEL pipeline (baseline→diff→BUG-008 filter→markSubmitted→buildSubmission→deliverSubmission→noteSubmissionDelivered), NOT the chat-fallback `recordAnswers` path — bridge answers are user shipments that must trigger a model reply.
- D-R6 Flow lifecycle: every upsert/reopen/restore with live questions re-emits (completing the prior flow; upsert emission runs at the tool_execution_end phase — after the lifecycle's rule-1 submitted→reasked flip, which lands only after the executor returns — plus the AC-11 record path calls noteSubmissionDelivered so re-asked-then-re-answered ids close at the settle; bridge submissions flush answered→submitted even when the diff is empty (identical re-selections after a rule-1 re-ask — conformant clients re-submit the full set) and honor the h2.44 line-1 contract on that flush path too; all four variants found by the live RPC itest as completion deadlocks); submit acks then completes; cancel = defer (ack + complete, zero state change, zero model message — recovery is the model's next upsert/reopen or bridge-side replay for unresolved flows); completion/shutdown complete all outstanding flows. `remote.resurface` (default true) re-emits remaining questions after a partial submit — the bridge analogue of the panel staying open. An unexpected internal error in the submit pipeline nacks `internal_error` and completes the flow (never a client hang; no rollback — half-mutated state is healed by the next upsert resurface; BUG-007). In-surface progress is expendable (draft sacredness is a panel commitment, not a bridge one). The FR-25 digest fallback is NEVER altered by bridge activity (v1's `phoneSeen` latch/device-speak result variant was cut as over-specification).
- D-R6 parity, panel path (2026 wave 001_64331ded9ddb / BUG-002): the panel ctrl+s submit now honors the same flush rule — pending (answered) ids flush → submitted, synthesize card entries, bump the epoch, and deliver even when the answer-signature diff is empty (identical re-selection after a rule-2 re-ask); the zero-pending early return ("nothing to submit") is unchanged.
- D-R7 Config `interrogator.remote = { enabled: true, resurface: true }`, coerced like existing nested sections.

## 2026-09-30 interrogation — auto-submit trigger narrowed (AUTOSUBMIT-003)
- D-R15 REVERSES the 2026-09-19 AUTOSUBMIT-001 pin's "edits included" clause (q2 = every-commit). Live experience: a bug prematurely filled every answer with the recommended option; every corrective edit of the complete set then re-shipped the full group — one model turn per keystroke-level fix. New trigger, both rules require zero open/reasked + ≥1 pending first: (a) the TRANSITION — the commit answered the last remaining unanswered question anywhere in the list; (b) the review-flow exit — the set was already complete and the commit edited the last sequential ANSWERABLE question (non-moot/withdrawn; moot/withdrawn tails can never be committed). All other edits of a complete set ship nothing — manual ctrl+s. Gate hold (AUTOSUBMIT-002) unchanged; bridge tail carries the transition flag (bridge surface since removed 2026-10-02, below). The "review the whole list then finish at the end" interaction that rule (b) hints at is deliberately NOT specified yet — the user deferred defining that interaction.

## Remote bridge surface removed (2026-10-02; supersedes D-R1..D-R7 / FR-31..34)

BUG-panel-phantom-recommended-submissions: the default-on bridge emitted every
upsert as a pi-ask flow whose wire marked each question's recommended option
(D-R3), and D-R5 committed every wire answer as a user shipment — the design
even expected full-set re-submits (D-R6). A conformant client rendering the
form with the ★-marked option preselected therefore shipped, for every
question the user never touched on that client, exactly the recommendation
value; the extension applied, submitted, archived, and completed on them
(phantom "Submitted N: … (recommended)" deltas, a completion record with ★
phantoms, panel closed, no user-side reopen). Reproduced deterministically on
the real machinery. Rulings: (1) the remote surface had no usable experience
and no users — remove it entirely (emission and submit acceptance both)
rather than gate it; (2) the FR-31 "inert without a listener" rationale
covered emission only and is retired with the feature; (3) the panel, tool
executor, lifecycle, close pass, and completion trigger are exonerated —
unchanged. Removed: remote-bridge.ts, remote-submit.ts, their tests, and
scripts/remote-rpc-itest.mjs.

## Staging philosophy (discussion resolution)
- Gate the interaction, never the commitment: all questions sent in the first upsert (anti-loss anchor); grouping is display+focus only; contradictions self-heal via re-ask; contract carries broad-first ordering.

## Defaulted (user may veto)
- Q38 = A: rev + epoch guards (both). Rationale: user's own file-tool analogy (read-before-write, exact-oldText).
- 2026-09-14 bugfix pin (Q38=A clarification): epoch is REQUIRED only when an upsert touches existing question ids; the first upsert of an interrogation (all-new ids) may omit it. tool-protocol.md § Guards ("any questions/answers call must carry the session epoch") reads stricter than intended — rev+epoch guards protect against stale UPDATES, not fresh sets.
- Q39 = B: dependsOn in v1 → edit-time ripple confirm with forced accept/cancel. Rationale: user explicitly specified this UX.

## 2026-09-30 interrogation — explain-any-answer
- D-R11 Explain entry = footer-hint-only: keep the ctrl+t chord as the only explain entry; the footer permanently names it (`{keys.focusText} explain`). No explain affordance row; accept-and-advance (Q14) untouched. Rationale: zero layout/flow cost beats maximal discoverability for a power-user surface.
- D-R12 Other answers are single-field: a write-in (custom:true) or type:"text" answer ships its value alone; the submit pipeline's custom-skip rule stands (no separate elaboration attachable to a write-in). Draft slots stay one-per-question (R4), role bound by current selection (WRITEIN-002 unchanged).
- D-R13 Deep-view explain parity mooted with D-R11: no affordance exists to mirror (q4 mooted by dependency, not answered).
- D-R14 Deep-view visual contract, locked 2026-09-30 after a six-amendment live-review: explanation text raw full-intensity; titles primary (theme text) at the inset column; │ pipes on every explanation row, primary, one char right of titles (bar col 3, text col 4); selection = accent + bold on the selected title AND its bars, no arrow glyph (bold = no-color fallback; short view keeps its ▸ cursor). Reverted experiments and why: success-green pipes (replaced by primary bars on request), ▸ accent prefix on titles (replaced by color+bold selection), title/explanation color swap (bars and explanation text ended up sharing a color, killing bar distinctness — the state we locked is the amendment-4 palette plus the 1-char explanation indent). Padding locked alongside: blank line above the footer on every view (initially placed after the footer — corrected from the user's preferred render), 2-col right margins, blank separators between deep sections (variation B). AMENDMENT 9 (2026-10-04, owner ruling — supersedes the “no arrow glyph” clause and the reverted “▸ accent prefix” experiment's rationale): deep-view selection must carry a character-level signal on top of accent+bold, because the bold-as-no-color-fallback assumption failed on a color-broken TTY — the user could not tell which answer was selected, and at least one character in the selected answer must change (parity with the compressed view's `▸` cursor). The highlighted section now renders `▸ ` in place of its header inset (labels stay column-aligned; the ✎ Other section gets it too when focused) and its pipes render `┃` (heavy) instead of `│` — same 3 visible cols, so all locked geometry (bar col 3, text col 4, amendment-8 trailing `Title ★`, variation-B separators) is untouched. Color treatment unchanged: glyphs are an additive channel. Demo of the considered alternatives (status quo, ▸ prefix, ▌ section rail, heavy bars, combo, inverse-video): scripts/demo-deep-selection.ts — the combo won. Fossil fixes landed with it: renderDeepWindow's docstring and a deep-view test name already claimed the ▸ prefix that the amendment-4 state had removed.

## 2026-10-04 interrogation — answer pinning (ANSWER-PIN-001)
- ANSWER-PIN-001 REVERSES the status-agnostic ★ preselect contract ("a revisited answered question still preselects the recommendation — answers never pin the cursor") and the same-value ripple path. Live experience: on revisit the caret re-seeded to the ★ recommendation, so (a) the user could not tell what they had answered (the accent highlight alone carried the signal), and (b) `enter` on the revisit RE-PROPOSED the recommendation as an edit — the modal accusing the user of invalidating their own work by keeping it, with the recommendation one keypress from overwriting a deliberately different answer. Rulings: (1) a recorded answer owns the caret on every view and entry path (option row; ✎ Other row for write-ins; text affordance), every status carrying `answer`; (2) enter/digit on the recorded value is a state no-op — no applyAnswer, no `answer.at` rewrite, no ripple modal, no auto-submit trigger; advance only; (3) the ★ recommendation is display-only after an answer exists — it may never preselect, own the caret, or re-propose; ★ preselect survives only on unanswered questions (R2's unmistakability is preserved: ★ stays visible on its row); (4) the FR-18 confirm fires only on an explicit DIFFERENT choice; (5) the stale-answer edge clamps to display row 0, never to the recommendation. Supersedes residue: EXPLAIN-003's "✎ cursor re-seeds to ★ when the editor closes" clause (it re-seeds to the recorded answer when one exists) and every doc/test asserting status-agnostic preselect — those tests were testing the bug. User's words: "DO NOT RE-PROPOSE ANYTHING AFTER A USER HAS SELECTED AN ANSWER. THESE QUESTIONS TAKE HARD WORK. Always keep the user's answer. No exceptions."

## 2026-10-05 interrogation — pinned deep-view question (DEEP-PIN-001)
- DEEP-PIN-001 splits the deep pane into two regions: the question (moot reason line, full description, full goal) is PINNED above and NEVER scrolls; only the answer sections scroll under it. Live experience (owner report): scrolling down to read the later answer choices scrolled the question out of view, and the sticky selection floor (`offset ≥ headerIdx − viewportHeight + 2`, AC-5's keep-the-selected-header-visible clamp) made it structurally unreachable — offset could not rise back above the floor while the cursor sat on a low section, so the question came back only by exiting and re-entering deep view. User's words: "The question shouldn't scroll out of view at all." Rulings: (1) `scrollOffset` indexes the OPTIONS region only; `DeepContent` grows a `questionLines` region rendered on every offset; (2) when the question region alone would overflow `DEEP_VIEW_HEIGHT` it is whole-line truncated bottom-first with a dimmed `…` marker — the DESCRIPTION keeps priority over the goal (the goal is context already summarized in the header, FR-30), never by slicing styled lines (ANSI-safe whole-line cut); (3) the options window never shrinks below `MIN_OPTIONS_VIEWPORT` (4 lines) — a pane with no visible options would strand the selection; (4) text questions (no options region) let the question use the full pane height; (5) the sticky-header clamp itself is unchanged — it now operates inside the options region where its floor can no longer hide the question. Render budget contract (h2.51 row 2) unchanged: pinned + window ≤ DEEP_VIEW_HEIGHT, every line width-bounded.

## 2026-10-05 interrogation — answer pinning re-ask amendment (ANSWER-PIN-001)
- ANSWER-PIN-001 ruling (2) gains a REASKED EXCEPTION (BUG-001, PRD h2.1/h3.0): a rule-1 re-ask flips status to `reasked` while KEEPING the answer — the lifecycle marker, not the user, created that hybrid — so enter/digit on the recorded value of a reasked question is a RE-CONFIRMATION commit, not a no-op: it re-marks answered(pending) with a fresh `answer.at` (diff-invisible — the answer signature is value+text only, never `at`), runs the moot recompute, and may fire the auto-submit transition, letting the re-ask → re-confirm → settle → completion loop close. Live experience: enter on the kept value was swallowed as an inert no-op; the question counted unanswered everywhere, ctrl+s said "nothing to submit", and completion was permanently blocked unless the user changed their answer — a wedge that defeats commitment 8's purpose ("Always keep the user's answer. No exceptions." — re-confirming the kept value IS keeping it). Unchanged: the settled-statuses no-op (answered/submitted/closed), the FR-18 different-value ripple, and the custom write-in exclusion (write-in reasked parity is the write-in commit path's own fix). Editor-path twin landed in the same amendment: `writeInEnter` gains the identical `q.status !== "reasked"` exclusion on its byte-identical no-op, and its direct commit is KIND-PRESERVING on that path — the re-confirm derives `custom` from the recorded answer (a choice write-in re-commits `custom: true`; a fallback-shaped plain text answer re-commits plain with the key absent, never flipped into a write-in), so this pin covers both seams, `acceptOptionIndex` and `writeInEnter`.

## 2026-10-06 interrogation — FR-18 closed-edit ripple (BUG-003)
- FR-18 closed-edit pin (BUG-003, Q39=B extension): the ripple-confirm seam fires for different-value edits to CLOSED (archived) questions on the option-accept and digit paths — a closed question still carries its recorded answer (FR-2: "answers editable even archived"), so silently mooting its answered dependents was an unconfirmed invalidation of real user work, exactly the class Q39=B's forced accept/cancel modal exists to prevent. Gate form is the explicit status list `answered|submitted|closed`, NOT answer-presence: answer-presence would also capture the `reasked` hybrid (rule-1 re-ask keeps its answer) and require exemptions to keep the P1.M1.T2.S1 same-value re-confirm seam-free; the status list keeps that path seam-free by construction. Ordering is load-bearing: the ANSWER-PIN-001 same-value no-op (which already covers closed) runs BEFORE the gate, so same-value re-commits on closed stay inert (advance, no modal, no state write); zero-victim closed edits still apply directly with no modal. Editor-path twin landed identically (P1.M2.T1.S2): the writeInEnter commit and stageText elaboration-save seams widen to the same `answered|submitted|closed` status list — writeInEnter's gate sits behind its byte-identical no-op (closed same-value re-commits stay inert), stageText keeps its `answer !== undefined` conjunct (a draft-only save never applies an answer or mutes victims — the deferred draft save is cancel/commit only).

## 2026-10-06 interrogation — moot reason persistence (BUG-004, Option A)
- PERSISTED MOOT REASON (BUG-004, FR-17/AC-6): the h2.29 reason (`moot: {depId}={value}`) is PERSISTED on `Question.mootReason` at the evaluateDependsOn mute/still-moot site (Option A, architecture/ripple-moot-seams.md §4) rather than recomputed at render time (Option B REJECTED: `dependencyMet` render-time plumbing would force state into three public pure-renderer signatures — short-view mootReason, overview overviewMootReason, layout statusMarkers all stay pure Question-only readers). Rulings: (1) the field write is SILENT — never routed through setStatus/emitChanged — so still-moot passes stay zero-event and serialize byte-identical when the reason string is unchanged (the depends-on zero-event pins and the delivery buildCompletion purity pin enforce this); a CHANGED reason on a still-moot question updates the field silently too (intentional: the next natural emit carries it); (2) a reason never outlives moot — both reopen branches (re-met; removed/emptied dependsOn, BUG-006b) clear the field BEFORE the setStatus flip so the emitted reopen snapshot already shows it absent, and merge rebuilds clear defensively (reasons are evaluator-owned; rules 1–3/reopens never produce moot); (3) renderers read the field first with their legacy fallback chains intact (pre-persistence history/state has no field) and only while `status === "moot"` — the field alone never triggers a moot line/marker; (4) the panel renders the reason VERBATIM with its `moot: ` prefix (h2.29) — only buildCompletion strips the prefix for the record format; (5) buildCompletion keeps its recompute as the evaluator-truth cross-check (an agreement test pins record reasons === persisted fields, prefix-stripped); (6) reconstruction step 5 re-runs evaluateDependsOn, so a persisted field cannot go stale after restart — self-healing by construction. `answerSignature` is untouched: the field never perturbs submission diffs, and withdrawn/closed questions may retain a stale field harmlessly (never rendered; cleared on rebuild).

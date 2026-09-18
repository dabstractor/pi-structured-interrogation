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
- FR-12 Free-text "explain" field on any question via the composed active editor (`getEditorComponent()` factory — the user's vim keybindings work). On choice questions the explanation is an ELABORATION — it attaches to the selected option at submit (`answer.text`), never replaces it; on text questions it IS the answer. `enter` saves and returns focus to options; `shift+enter`/`ctrl+j` newline; separate history. `ctrl+g` opens `$EDITOR` seeded with the draft. While the editor is focused, single `esc` and arrows forward to the editor (vim semantics); exiting the field never suspends the panel.
- FR-13 Batch note (hard requirement R3): `ctrl+shift+m` opens a note field at any time; the note is held and delivered as a `NOTE:` line with the next submission.
- FR-14 Break-out (`esc` from the short view): suspends the panel; main editor becomes available; drafts and panel state preserved; widget shows open/answered counts and the `/interrogate` resume cue; resume focuses the first unanswered question. `/interrogate` is INVOKE-ONLY: with an existing session it invokes the panel immediately in every scenario (open stays open, suspended resumes, closed host opens fresh) — it never suspends, and no global key shortcut exists (the historical `ctrl+shift+q` chord closes windows on many desktop environments and was removed).
- FR-15 Per-question "discuss in chat" handoff: suspends the panel and preloads the current question + options into the main editor as a quoted prompt for a focused side chat.
- FR-16 `esc` descends: deep view → short form; overview → panel; at top level → suspend. Esc never destroys any state. Exception: while the embedded editor is focused, a single `esc` forwards to the editor; `esc` twice within the configured window closes the prompt box only (no suspend).

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

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
- FR-3 `ctrl+s` submits all pending answers immediately (no review screen). Each submission: (a) delta message to the model (~2 lines + reminder line "consider how these affect your other questions"; the ≤3-line shape is enforced — write-in/text entries flattened to one line and per-entry capped, BUG-006), (b) user-only diff card in the transcript, (c) epoch bump. **Auto-submit (AUTOSUBMIT-001)**: after EVERY answer commit — option accept, Other write-in commit, text-answer enter, including edits of already-answered questions — when zero unanswered (open/reasked) questions remain, the identical submission pipeline fires automatically with a footer flash; a held batch note rides it. Gate hold (AUTOSUBMIT-002): while gate-group questions are unanswered, commits show the non-expiring `⚠ {n} foundational unanswered — answer them or {submit} to submit now` line instead of auto-submitting; `ctrl+s` overrides deliberately.
- FR-4 After the agent's reply to a submission (`agent_settled`), submitted questions close unless that reply upserted (re-asked) them. Aborted replies count as settled.
- FR-5 When the last open question closes, the extension injects the complete Q&A record once (`interrogation-completion` message) and the panel auto-dismisses. The model writes the spec from that record.
- FR-6 The agent may reopen the panel at its judgment via `interrogate({reopen:true})`. No deterministic guard. The suspend widget is always visible while suspended so the user is never stranded.

### Panel UX (details in ui-spec.md)
- FR-7 Short form by default: question one-liner, first sentence of the description dimmed beneath, options with unmistakable recommendation marks (★ + preselect).
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
- FR-28 On session start with live questions (any resumable status): state restores SILENTLY and the suspend widget line appears — **the panel NEVER auto-opens (SURFACE-002: session-start auto-open is disabled entirely; the user runs `/interrogate` to get the panel back — 2026-09-19 completion elaboration, stronger than the unanswered-only option value)**. Drafts are not persisted across restarts (documented limitation). Mid-session `/tree` navigation (`session_tree`) reconstructs state silently and never opens or reopens the panel — a user browsing the tree who is not using the interrogation must never see it appear (details: state-and-persistence.md §Branching). No event other than `/interrogate`, an agent upsert leaving unanswered questions, or `{reopen:true}` may open the panel — **reads never surface**, whatever the state (SURFACE-001).
- FR-29 `session_before_compact` supplies custom instructions: preserve verbatim the user's stated goals and plan constraints from all messages, all interrogation answers and changes, and the goal field.
- FR-30 Goal field: agent-supplied, updatable, shown in the panel header at all times; anchors re-asks and compaction summaries.

### Remote bridge surface (pi-ask contract; details in ui-spec.md §Remote bridge)
- FR-31 The extension speaks the pi-ask bridge contract on `pi.events` (`@eko24ive/pi-ask:started|completed|submit|submit-result`, verbatim names and payload shapes): every successful upsert/reopen/restore with ≥1 live question emits a `started` flow; any conformant client (remote-pi's app, status cards, desktop helpers) renders it natively with zero bespoke integration. Config gate `interrogator.remote.enabled` (default true; inert without a listener).
- FR-32 A bridge submission rides the SAME pipeline as a panel `ctrl+s`: answers apply to state, one submission delta message is delivered (triggers a model reply), epoch bumps once, `noteSubmissionDelivered` fires. Partial submissions leave remaining questions open; `remote.resurface` (default true) re-emits a fresh flow with them. An unexpected internal error mid-pipeline emits an `internal_error` submit-result nack and completes the flow — the client is always acked (ok or nack), never hangs; state may stay half-mutated (no rollback) and the next upsert resurface heals the surface (BUG-007, D-R6).
- FR-33 Bridge cancel = defer: the flow resolves, the interrogation stays open, no model-visible message. Interrogation completion and session shutdown complete all outstanding flows (no lingering client surface). Stale `itg:` flows nack `flow_not_found`; submits for foreign flowIds are ignored silently (pi-ask's business).
- FR-34 Session restart with open questions re-emits a flow (`ask:resume`) after reconstruction. Non-TUI behavior is otherwise unchanged: the FR-25 digest fallback stays exactly as is — no model-facing result text ever depends on bridge activity.

## Hard requirements (from user tooling evaluations)
- R1 navigation freedom (FR-9) · R2 unmistakable recommendation marks (FR-7) · R3 batch note (FR-13) · R4 draft preservation (commitment 6) · R5 all hotkeys configurable (commitment 7) · R6 no surprise surfacing (goal 7 / FR-28, SURFACE-001/002).

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

## Non-goals
See SPEC.md. Additionally: no multi-select questions in v1 (schema reserves `type` for growth); no conditional question *generation* (agent composes sets); no analytics.

# pi-interrogator — SPEC

Structured interrogation for the pi coding agent: the model asks dozens of planning questions through a single `interrogate` tool; the user answers them in a persistent bottom-dock panel that never scrolls away, submits partial answers any time, breaks out for side conversations, and edits answers as understanding evolves. The extension is the source of truth for question/answer state; the model reads and updates it through guards that make stale views fail loudly (like `edit`'s oldText and `write`'s read-before-write). The extension also speaks pi-ask's documented bridge contract on `pi.events`, so any conformant remote client (e.g. the remote-pi app) renders the question set natively — bridge submissions ride the identical state/submission pipeline as the panel.

**Package:** `pi-interrogator` · **Tool:** `interrogate` · **Command:** `/interrogate`

## Core commitments (do not deviate)

1. **Non-blocking tool** — `interrogate` returns immediately after loading questions; the turn ends; the panel persists while idle. Answers flow back later as small delta messages that trigger a new reply. No tool call ever waits on the user.
2. **Pull-based state** — the extension's in-memory JSON is the single source of truth. Submissions deliver *deltas* (~2 lines) plus a reminder line. The model refreshes by calling `interrogate({})`. The full record is injected into the conversation exactly once, at completion. Per-request context injection is explicitly forbidden (user veto).
3. **Replace-editor panel** — while questions are open, the panel *is* the bottom editor region (`ctx.ui.custom()`, non-overlay); the chat transcript stays visible above. `esc` suspends it; a widget above the main editor keeps it findable. `/interrogate` invokes/resumes it immediately in every scenario (never toggles, never demands a keypress); no global key shortcut exists (the historical `ctrl+shift+q` chord closes windows on many desktop environments and was removed).
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
- Suspend widget line: `{n} open · {m} answered — /interrogate to resume` (names the command only — never a key chord)

## Non-goals (confirmed)

Answering by parsing chat text while the panel is open · multiple concurrent interrogations · images in answers · mouse input · cross-restart draft persistence (documented limitation) · modifying pi core (public extension APIs only) · per-request state injection (vetoed).

@./SPEC.md
@./product-requirements.md
@./architecture.md
@./tool-protocol.md
@./ui-spec.md
@./state-and-persistence.md
@./implementation-plan.md
@./decisions.md

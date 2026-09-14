# Spec-Contract Research — bugfix plan 001_6d9f684be2bb

Source: `/home/dustin/projects/pi-structured-interrogation/spec/` (8 files, all read in full).
All quotes below are verbatim from the spec.

## 0. Spec section-numbering conventions (IMPORTANT for citation)

The spec files use **plain, unnumbered markdown headings — there are NO `h2.37`-style numeric ids anywhere in the repo's spec/**. Any prior bug IDs referencing "h2.37", "h3.6", "h2.38", etc. are using positional H2/H3 indices. Downstream agents should cite as `file.md → "Heading text" (H2/H3 #n)`. The positional indices are:

- **architecture.md** H2: 1 Module layout · 2 Components and responsibilities · 3 Key flows · 4 pi API surface used · 5 Event subscriptions table · 6 Data shapes · 7 Config surface. H3 under Key flows: 3.1 Ask (non-blocking) · **3.2 Submit (partial, immediate)** · 3.3 Read / refresh · 3.4 Stale guard rejection · 3.5 Completion · 3.6 Suspend / resume / reopen · 3.7 Restart / resume session.
- **tool-protocol.md** H2: 1 Schema · 2 Actions · 3 Merge rules on upsert · 4 Guards (Q38=A) · 5 Caps (Q27=A) · 6 Agent-facing text · 7 Result rendering (TUI) · 8 Non-TUI fallback (FR-25) · 9 Plain-text round detection · 10 Status line format.
- **ui-spec.md** H2: 1 Layout · 2 Terminal fallbacks · 3 Free-text field (Q17=A) · 4 Batch note (R3) · 5 Ripple confirm · 6 Hotkeys · 7 Suspend / resume / widget · 8 Renderers · 9 Empty/edge states.
- **state-and-persistence.md** H2: 1 Question state machine · 2 rev and epoch semantics · 3 Storage · 4 Reconstruction (`session_start`) · 5 Compaction · 6 Branching · 7 Auto-close algorithm (Q9=B) · 8 Drafts lifecycle (R4) · 9 Completion record format.
- **product-requirements.md** H2: 1 Problem · 2 Goals · 3 Users · 4 Functional requirements — H3: 4.1 Interrogation lifecycle · 4.2 Panel UX · 4.3 Dependency and ripple semantics · 4.4 Agent protocol · 4.5 Persistence and recovery · 5 Hard requirements · 6 Acceptance criteria · 7 Non-goals.
- **decisions.md** H2: 1 Architecture & data flow · 2 UI · 3 Protocol · 4 Staging philosophy · 5 Defaulted (Q38=A rev+epoch guards; Q39=B dependsOn ripple confirm).
- **SPEC.md** H2: Core commitments (7, numbered) · Deliverable files · Defaulted decisions · Naming and strings · Non-goals.

---

## BUG-001 — goal updatable

- `product-requirements.md` → "Persistence and recovery" (H3 4.5), **FR-30**: "Goal field: agent-supplied, updatable, shown in the panel header at all times; anchors re-asks and compaction summaries."
- `tool-protocol.md` → "Schema": `goal: Type.Optional(Type.String({ description: "What these questions drive toward; shown in the panel header" }))`.
- `ui-spec.md` → "Layout": "**Goal**: always in the header (FR-30). Truncated to fit, full text in deep view."
- Cap: `tool-protocol.md` → "Caps": "`goal ≤ 400`" (see BUG-009).
- Header format (ui-spec Layout diagram): `┌ interrogation · {goal} ─── 3/12 answered · 1 re-asked ┐`.

## BUG-002 — completion injected exactly once per interrogation

- `product-requirements.md` → "Interrogation lifecycle" (H3 4.1), **FR-5**: "When the last open question closes, the extension injects the complete Q&A record **once** (`interrogation-completion` message) and the panel auto-dismisses. The model writes the spec from that record."
- `decisions.md` → "State delivery redesign (user-directed)": "full record injected once at completion; per-request context injection vetoed." And **Q30**: "completion = full record injection".
- SPEC.md → Core commitment 2 ("Pull-based state"): "The full record is injected into the conversation **exactly once, at completion**. Per-request context injection is explicitly forbidden (user veto)."
- **Scope of "once" — per interrogation, not per session**: state-and-persistence.md → "Auto-close algorithm": "if no open/reasked/answered/moot questions remain → completion flow: inject interrogation-completion (full record, once) → dismiss panel → **clear in-memory state** (keep entries for audit)". The once-guard is per-completion-event (per interrogation lifecycle); after state is cleared, a new interrogation can complete and inject again. Acceptance criterion 14 (product-requirements §Acceptance criteria): "All questions closed → completion record injected once; panel dismissed; recap card in transcript."

## BUG-003 — submission delta content format

`architecture.md` → "Key flows → Submit (partial, immediate)" (H3 3.2), verbatim:

```
  delivery.ts: sendMessage customType "interrogation-submission"
      content  = "Submitted {k}: {id→value list, changed marked} (state epoch {n})\n
                  Consider how these affect your other questions."
      details  = full diff card data (renderer draws user-only card)
  state: epoch++, snapshot for revert-style diffs (and post-hoc recovery)
```

Supporting: FR-3 (PRD 4.1): "Each submission: (a) delta message to the model (~2 lines + reminder line \"consider how these affect your other questions\"), (b) user-only diff card in the transcript, (c) epoch bump." Changed marking: state-and-persistence.md §1: "Editing a closed answer re-marks it `answered(pending)`; next submission diff marks it `(changed)` (Q24=B)"; AC-13: "diff card highlights the change (`Q3: sqlite → postgres (changed)`)". `details` shape (architecture.md §Data shapes): "`{ changed: [{id, from, to}], note?, epoch, card: FullCardData }`".

## BUG-004 — non-TUI parity

- `product-requirements.md` → **FR-25** (H3 4.4): "Non-TUI modes (rpc/json/print): no panel; the tool returns a numbered markdown digest; the model relays it in chat; the user answers in their next prompt; the model records via `answers[]`."
- `tool-protocol.md` → "Non-TUI fallback (FR-25)": "…Read/completion work identically. **Completion record is still injected once at close.**" Also: "`{answers:[...]}` | Record user answers (non-TUI only; ignored in TUI)"; "`ctx.mode !== \"tui\" || !ctx.hasUI` → no panel."
- **FR-4**: "After the agent's reply to a submission (`agent_settled`), submitted questions close unless that reply upserted (re-asked) them. Aborted replies count as settled."
- **AC-11**: "`pi -p` (print mode): interrogate returns markdown digest; model asks in text; `answers[]` records; state consistent."
- Architecture §Components: `tool.ts` "fallback formatting"; §Event table: `agent_settled` → "auto-close pass (FR-4); completion check (FR-5)" — no TUI qualification.
- `implementation-plan.md` M2: "submissions still deliver from fallback path in `-p`".

## BUG-005 — suspend edge (0 open questions, pending submissions)

- `ui-spec.md` → "Empty/edge states" (H2 9): "**0 open questions but pending submissions → footer `submit pending answers first`; completion triggers after close pass.**"
- `product-requirements.md` → **FR-6**: "The agent may reopen the panel at its judgment via `interrogate({reopen:true})`. **No deterministic guard.** The suspend widget is always visible while suspended so the user is never stranded."
- **FR-16**: "`esc` descends: deep view → short form; overview → panel; at top level → suspend. Esc never destroys any state." (also state machine: esc not modeled as state transition.)
- `ui-spec.md` → "Suspend / resume / widget": suspend via "esc at top level, ctrl+shift+q anywhere, or /interrogate. Panel `done(null)`; state + drafts held in extension memory; main editor text preserved". Widget visible "whenever suspended with open questions". Reopen: "agent `{reopen:true}` → fresh panel instance rehydrated from state + drafts". architecture.md 3.6: "agent {reopen:true} → same resume path (no guard; judgment trusted)".

## BUG-006 — dependsOn re-evaluation

- `product-requirements.md` → **FR-17**: "Questions may declare `dependsOn: [{id, equals?, notEquals?}]`. Conditions are **evaluated locally and instantly**: unmet questions grey out as moot with reason (`moot: storage=sqlite`), kept in the map (audit trail), never silently removed."
- `state-and-persistence.md` → "Question state machine" (H2 1) transition table (verbatim diagram):

```
   ┌──────────┐ ───────────────► ┌───────────┐ ────────────────────► ┌──────────────────┐
   │ (absent) │   upsert(new id) │   open    │  user answers/edits  │ answered(pending) │
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

  Key transitions: `dependsOn unmet (local)` → moot (from open); `re-met` → moot→open. Reconstruction step 5 (§4): "recompute dependsOn moot-ness from current answers (cheap, idempotent)". FR-19: "dependsOn covers instant, local effects only."

## BUG-007 — reconstruction

- `product-requirements.md` → **FR-28**: "On session start with open questions (TUI): panel auto-reopens with state restored. Drafts are not persisted across restarts (documented limitation)."
- `state-and-persistence.md` → "Reconstruction (`session_start`)" (H2 4), steps verbatim: "1. entries = buildContextEntries() / 2. find last entry: toolResult for \"interrogate\" with details.state → base = details.state; else scan custom entries type \"interrogation-state\" (newest first) → base; else: no state; done / **3. replay subsequent interrogation-submission messages: apply details.changed (answers, epochs)** / 4. if any question status ∈ {open, reasked, answered, submitted, moot, withdrawn} (non-empty set): if ctx.mode === \"tui\": open panel (no drafts) [FR-28]; else: mark fallback active / 5. recompute dependsOn moot-ness from current answers".
- `architecture.md` → "Restart / resume session" (H3 3.7): "session_start → persistence: walk buildContextEntries() / latest interrogate tool-result details = base state / replay subsequent interrogation-submission messages (deltas) on top / fallback: scan interrogation-state custom entries / if open questions && mode===\"tui\" → auto-open panel (drafts not restored)".
- **AC-9**: "Restart pi mid-interrogation → panel reopens with questions/answers; drafts gone (documented)."

## BUG-008 — draft preservation

- `ui-spec.md` → "Free-text field (Q17=A)" → "Draft preservation (R4)", full verbatim: "one draft slot per question (`{value, text}`) + one `batchNote`, held in panel memory for the panel's lifetime: **survives navigation, deep/overview toggles, upserts (including answer resets — merge rule 2), suspend/resume. Destroyed only by submission (text answers ship) or user-initiated clear. Not persisted across restarts (documented).**"
- SPEC.md → Core commitment **6** ("Drafts are sacred"): "typed-but-unsubmitted text survives question navigation, agent re-asks (upserts), suspend/resume, and view toggles. Never destroyed except by explicit user action."
- Merge rule 2 (`tool-protocol.md` §3): "Existing id, changed options → answer reset, status `reasked` (⟳ marker), rev-bump; **panel draft *preserved*** (surfaces when the user revisits)." Rule 1: "drafts untouched."
- `state-and-persistence.md` → "Drafts lifecycle (R4)": "Panel-local `{questionId → {value, text}}` + `batchNote`. Preserved across navigation, view toggles, upserts, suspend/resume. Flushed into state on submit; cleared on submit or explicit clear. Not written to any persistent layer."
- PRD §Hard requirements: "R4 draft preservation (commitment 6)". FR-21: "Typed drafts always survive upserts." AC-3: "re-ask of one → that one shows re-asked, answer reset, draft preserved." AC-4: "drafts intact" after break-out/resume.

## BUG-009 — goal cap 400

`tool-protocol.md` → "Caps (Q27=A, configurable + scaled)": "Defaults: `description ≤ max(1200, budget/questionCount)` chars; `ramification ≤ 600`; `options ≤ 7`; `questions ≤ 40`; **`goal ≤ 400`**." Over-budget handling: "Over-budget content is **truncated with an explicit warning in the tool result** … Never a hard reject; all numbers overridable via config." Config (`implementation-plan.md` §Config reference): `"caps": { … "goal": 400, … }`. Note: goal cap is a flat 400 (not budget-scaled).

## BUG-010 — epoch+rev echo requirement

`tool-protocol.md` → "Guards (Q38=A)" (H2 4), verbatim:
- "**rev**: every mutation of an existing question requires its current `rev`; mismatch → `isError` result: `STALE: {id} is at rev {n} (you sent {m}). Current: {text}. Re-apply.`"
- "**epoch**: any `questions`/`answers` call must carry the session `epoch` it was based on (top-level optional `epoch` param; read/submission results always include it); mismatch → `isError` with the delta digest since the model's epoch and current epoch."
- "Read (`{}`) is always allowed — pull refresh is never guarded."

`state-and-persistence.md` → "rev and epoch semantics" (H2 2): "rev (per question, integer, starts 1): bumps on any content mutation … The model must echo the current rev when upserting an existing question. User answers do **not** bump rev (answers are epoch territory). epoch (session, integer, starts 1): bumps on every submission. Any `questions`/`answers` call must carry the epoch it was based on … Read is never guarded. Both guards reject with current state + delta digest." Also FR-22, AC-8, SPEC.md commitment 5, decisions.md Q38=A ("rev + epoch guards (both)"), architecture.md 3.4 "Stale guard rejection" (rejects only on mismatch).

## BUG-011 — text focus views

- `ui-spec.md` → "Hotkeys" (H2 6) intercept rule: "**panel-level keys are intercepted *before* the embedded editor sees them, whenever the panel is open (including text focus)**. Everything else forwards to the embedded editor." Keymap: `focus text field` = `ctrl+t` / `keys.focusText`; `external editor` = `ctrl+g` (context: text focus); `esc` "fixed … descends, never destroys". Accept/advance `enter` (context: options focus); `↑/↓` move among options "short form" (in deep view: "`↑/↓` scroll here (they don't navigate questions while in deep view)").
- Free-text field (H2 3): "Not focused by default; `ctrl+t` … focuses it. `enter` saves the draft and returns focus to options; the *next* `enter` advances (two-stage …). Separate history (never calls `addToHistory`)."
- `product-requirements.md` **FR-12**: "Free-text \"explain\" field on any question via the composed active editor (`getEditorComponent()` factory — the user's vim keybindings work). `enter` saves and returns focus to options; `shift+enter`/`ctrl+j` newline; separate history. `ctrl+g` opens `$EDITOR` seeded with the draft."

## BUG-012 — terminal statuses

`state-and-persistence.md` → "Question state machine" (H2 1): "**`moot`/`withdrawn` are terminal-until-re-upsert**; both stay visible (dimmed, with reason) — the audit trail (Q34=A)." Also: "closed+reopen via re-upsert with same id (rev+1)" (from closed) and "user edits" → closed→answered(pending). FR-17: moot "kept in the map … never silently removed"; merge rule 4: "Existing id omitted → withdrawn (⊗ marker, kept in map with reason \"withdrawn\")"; Q34 (decisions.md): "moot/withdrawn dimmed with reason, kept in map". Overview markers (FR-11 / ui-spec Layout): `·` open, `★` answered, `⟳` re-asked, `⊘` moot (+reason, dimmed), `⊗` withdrawn, `✎` has text answer.

---

## Second interrogation in one session / epoch semantics after completion

The spec is **partially silent**; what exists:
- `decisions.md` Q7: "**one active set**" (only one interrogation active at a time). SPEC.md Non-goals: "multiple concurrent interrogations" excluded.
- After completion, state-and-persistence.md §7 (auto-close): "inject interrogation-completion (full record, once) → dismiss panel → **clear in-memory state (keep entries for audit)**". Architecture.md 3.5 "Completion": "lifecycle: dismiss panel; clear state (keep entries for audit)".
- **No spec text explicitly says whether a second interrogation resets `epoch` to 1 or continues.** Epoch is defined as "(session, integer, starts 1)" and "bumps on every submission" (state-and-persistence.md §2); since in-memory state is cleared at completion, the natural reading is a fresh state (epoch 1, new revs), but this is NOT stated verbatim — flag as an ambiguity a fix may need to decide (reconstruction §4 also implies state is derived from entries, and step 2 takes the *latest* interrogate result as base, so a post-completion new interrogation becomes the new base).
- Compaction safety: state-and-persistence.md §5 — "the completion injection is unaffected" by compaction.

## 15-line BUG → citation map

1. BUG-001 goal updatable → PRD FR-30 (4.5); ui-spec §Layout "**Goal**: always in the header"; tool-protocol §Schema `goal` param.
2. BUG-002 once-per-interrogation → PRD FR-5; SPEC.md commitment 2 ("exactly once, at completion"); decisions.md Q30; state §7 "clear in-memory state" ⇒ once is per interrogation lifecycle.
3. BUG-003 delta format → architecture.md §Key flows → Submit (H3 3.2) full content template; PRD FR-3(a-c); state §1 "(changed)" marking; AC-13.
4. BUG-004 non-TUI parity → PRD FR-25; tool-protocol §Non-TUI fallback ("Read/completion work identically. Completion record is still injected once at close."); FR-4; AC-11.
5. BUG-005 suspend edge → ui-spec §Empty/edge states ("0 open questions but pending submissions → footer `submit pending answers first`; completion triggers after close pass"); PRD FR-6, FR-16.
6. BUG-006 dependsOn → PRD FR-17 ("evaluated locally and instantly"); state §1 full transition diagram (unmet→moot, re-met→open); state §4 step 5 recompute.
7. BUG-007 reconstruction → PRD FR-28; state §Reconstruction steps 1-5 (step 3 = replay `details.changed` deltas); architecture.md §3.7; AC-9.
8. BUG-008 drafts → ui-spec §Free-text field "Draft preservation (R4)" (full quote above); SPEC.md commitment 6; merge rule 2 "panel draft *preserved*"; state §Drafts lifecycle.
9. BUG-009 goal cap → tool-protocol §Caps "`goal ≤ 400`"; config reference `"goal": 400`; truncation-with-warning, never hard reject.
10. BUG-010 epoch+rev echo → tool-protocol §Guards (Q38=A) both bullets verbatim; state §rev and epoch semantics; PRD FR-22; AC-8; read never guarded.
11. BUG-011 text focus views → ui-spec §Hotkeys intercept rule ("including text focus") + keymap table (ctrl+t/ctrl+g/enter two-stage); PRD FR-12.
12. BUG-012 terminal statuses → state §1 "`moot`/`withdrawn` are terminal-until-re-upsert"; PRD FR-17, merge rule 4; decisions Q34; overview markers FR-11.
13. Numbering caveat → spec has no h2.N ids; cite file + heading text (index table in §0 above).
14. Second interrogation → decisions Q7 "one active set"; completion clears state (state §7); epoch-reset-on-new-interrogation is UNSPECIFIED — open question for fix design.
15. Best single starting file → `state-and-persistence.md` (state machine, epoch/rev, reconstruction, completion) + `tool-protocol.md` (guards, caps, fallback).

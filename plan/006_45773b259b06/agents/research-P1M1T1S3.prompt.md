Create a PRP for Subtask P1.M1.T1.S3 of the PRD. Store it at plan/006_45773b259b06/P1M1T1S3/PRP.md.

SCOPE: Write ONLY this item's PRP (P1.M1.T1.S3). You were asked for ONE PRP. Writing PRPs for other items in this session is allowed ONLY after you clear the MULTI-PRP BATCHING POLICY in the prompt (full task tree + full PRD + thorough per-item research for EVERY PRP you write). When in doubt, write one.
<item_title>UPDATE REQUIRED: Re-baseline at current HEAD and re-run keymap verification covering the 10th default (keys.toggle, PANELTOGGLE-001)</item_title>
<item_description>CONTRACT DEFINITION:
1. RESEARCH NOTE: PRD delta at spec commit ec61eb1 ('input recovery specced; chat ephemerality narrowed') — eight rulings landed AFTER the 7377318 baseline (git: 74ebe39 DEEP-FULLSCREEN-001/DUMP-ONCE-001, 70b08ff PANELTOGGLE-001, 7fd63c2 ANSWER-FIDELITY, a4c6c9e KEEP-OPEN-001/002, 4baa95a CHAT-CONTEXT-001, 8f7255d+d4449f2 LENIENT-ANSWER-001/CHAT-STYLE-001/EMPTY-REPLY-001). src/config.ts DEFAULT_CONFIG.keys now carries a 10th default — keys.toggle 'ctrl+n' plus the panelShortcut toggle (PANELTOGGLE-001) — and scripts/verify-keymap-conflicts.sh already classifies it (ctrl+n's pi built-in collision, app.session.toggleNamedFilter, is PICKER-SCOPED; extension wins at the main editor, one startup diagnostic). HEAD is ec61eb1+ with 56 src test files (was 54).
2. INPUT: current HEAD (`git rev-parse --short HEAD`); src/config.ts DEFAULT_CONFIG.keys (10 entries incl. toggle ctrl+n) and the panelShortcut flag.
3. LOGIC: Re-run `npm test`, `npm run typecheck`, `npm run lint` and record the FRESH counts (do not assume 54/1624 — 56+ files expected). Re-run `bash scripts/verify-keymap-conflicts.sh`; require exit 0 with all 10 defaults clear (ctrl+n reported under its picker-scoped-overlap classification). A reproducible failure or a genuine collision is a BUG at the existing seam — report and stop; do NOT rebind keys and do NOT rebuild anything.
4. OUTPUT: refreshed Baseline + VerificationRecord {head, testFiles, tests, typecheck, lint, date, piVersion, perKeyStatus[10], drift[]} that supersedes the S1/S2 records for P1.M1.T2.S3 and P1.M1.T3.S2.
5. DOCS: none — data only; the README record block citation is reconciled by P1.M1.T2.S1.</item_description>
<prd_selectors>["h2.83","h2.10","h2.56","table.0"]</prd_selectors>
<selected_prd_content>
heading:h2.83:
## 2026-10-16 interrogation — feature-discovery footer (FOOTER-001)

* FOOTER-001 — the footer advertises FEATURES, not key mechanics. Owner report (verbatim intent): the side chat shipped INVISIBLE — "they have NO IDEA that a side chat is even a feature if we don't advertise it to them here. Just like detailed view, just like adding a note to the answer with the `t` button." Rulings: (1) every remappable action relevant to the screen is listed — short carries deep/list/chat/explain/note/submit, deep carries list/chat/explain/submit, overview carries deep/chat/submit, chat carries `/clear` + the binding-named reopen clause; (2) UBIQUITOUS KEYS ARE NEVER HINTED — enter ("the only thing Enter ever does") and esc ("right in the name") earn no labels anywhere; deleted: "enter accept", "esc back", "enter jump", "↑/↓ scroll", "enter save", "esc esc back", "enter send", and the chat footer's esc-abort/exit word (now state-invariant `/clear`); (3) while the editor holds focus the footer collapses to the only hints that stay TRUE — the chords `{submit} submit · {externalEditor} editor` (externalEditor's only valid context is editor focus, its one advertised home; bare-key feature hints would lie — they type, BAREKEYS-001); (4) the narrow/tiny right-to-left drop ladder and sacred progress are unchanged, and `/clear` never drops in the chat view (the confused-chat escape hatch, SIDECHAT-005). Supersedes D-R11's letter ("the footer permanently names `{elaborate} explain` as an appended static") — the explain key is now a plain SCREEN\_KEYS entry on short and deep: same visibility, uniform mechanism. The ripple-confirm and answer-confirm rows keep their `enter=/esc=` wording — they are contextual decision prompts, not footer chrome.
heading:h2.10:
## Acceptance criteria (all must pass; scripted where possible)

1. Model upserts 30 questions across 4 groups with one gate group → panel opens; chat visible above; gate focused; other groups dimmed but answerable.
2. Answer 2 of 30, `ctrl+s` → model receives the header + both full answer lines + reminder (ANSWER-FIDELITY: never a capped/partial delta); user-only card shows both answers; 28 remain open; epoch bumps.
   2a. **Write-in (WRITEIN-001)**: on a choice question, accept `✎ Other`, type free text, `enter` → question answered with `answer.value = <text>`, `custom: true`, NO option selected; card and delta render `✎ {text}`; advance moves on; the write-in ships by itself at the auto-submit.
   2b. **Elaboration (WRITEIN-001)**: `t`, type, `enter` → draft saved, question still unanswered; accept a real option → elaboration attaches as `answer.text` at submit; accepting a real option after a committed write-in keeps the slot's text as elaboration (WRITEIN-002).
   2c. **Auto-submit (AUTOSUBMIT-001)**: answer the LAST remaining question (accept / write-in / text `enter`) → submission delivers with no keypress beyond the answer itself; footer flashes `submitted — {n} answer(s)`; editing an already-answered question while the set is complete ships the edit immediately (one submission per commit).
   2d. **Gate hold (AUTOSUBMIT-002)**: with a gate question unanswered, commits show `⚠ … foundational unanswered` and do NOT auto-submit; answering the gate question releases the next commit's auto-submit; `ctrl+s` submits anyway.
3. Agent replies without upsert → the 2 close (archived markers in overview). Agent replies with a re-ask of one → that one shows re-asked, answer reset, draft preserved.
4. Mid-panel: break out → widget appears with counts → side chat runs a full agent turn → agent `{reopen:true}` → panel returns with drafts intact; main editor draft also intact.
5. Deep view: toggle, scroll all ramifications (incl. the Other section), select an option from deep view → stays in deep view on the advanced-to question (DEEP-STICKY-ADVANCE), advances.
6. Answer a gate question contrary to a `dependsOn` → dependent greys as moot with reason, instantly; overview shows ⊘.
7. Edit an answered question that invalidates 3 others → confirm dialog appears; esc cancels with no state change; enter applies.
8. Stale upsert (wrong `rev`/`epoch`) → rejected; result contains current text/rev and delta digest; model re-applies successfully.
9. Restart pi mid-interrogation → NO panel appears (SURFACE-002); the widget line shows live counts; `/interrogate` reopens with questions/answers restored (any status mix); editor recovery is tested separately (FR-28); pending answers ship on the next commit or submit (AUTOSUBMIT-001).
10. `/compact` mid-interrogation → summary preserves user plan statements; subsequent read returns full state.
11. `pi -p` (print mode): interrogate returns markdown digest; model asks in text; `answers[]` records; state consistent.
12. Every default hotkey remappable via config; footer/widget strings reflect the remap.
13. Editing an archived answer re-marks it pending; next submission diff card highlights the change (`Q3: sqlite → postgres (changed)`).
14. All questions closed → completion record injected once; panel dismissed; recap card in transcript (FULL-TRANSCRIPT-001: full answers, free text, prompts, and batch notes in both modes).
15. **Reads never surface (SURFACE-001)**: with a live interrogation (panel suspended, questions open), a model `interrogate({})` read completes → panel stays closed, editor untouched; the same holds for all-answered and completed states (src/tree-nav-repro.test.ts characterizations flip to fixed).
16. **Answer pinning (ANSWER-PIN-001)**: answer q1 with a NON-recommended option, advance, `←` back → caret + accent highlight sit on the chosen option (★ visible on its own row, caret NOT on it); `enter` advances to the next unanswered with zero state change (no modal, no epoch bump, no `answer.at` rewrite). A write-in answer pins the caret to the `✎ Other` row with its dim preview; a byte-identical write-in re-commit is inert. Choosing a DIFFERENT option on the answered question still raises the FR-18 confirm.
17. **Side chat (SIDECHAT-001)**: `c` on q3 → the chat view opens on q3 with NO suspend; a two-turn exchange streams in-view; `/clear` resets it; reaching `c` on q5 → the q3 chat is gone (singleton, replaced); converge on an answer block → confirm row → `enter` → the answer applies indistinguishably from a panel selection (identical delta/card bytes), advance + auto-submit flow as usual, the chat vanishes; with `sideChatAutoApply: true` no confirm appears. Answering q7 via the panel while its chat is open → that chat is gone. `esc`-suspend + `/interrogate` → the surviving chat returns; pi restart → no chat and NO session-file residue (no entries, no usage records, transcript shows nothing).
heading:h2.56:
## File checklist

* [ ] `index.ts` — factory; registers tool/command/shortcut/events/renderers; mode guards
* [ ] `config.ts` — defaults + settings load; keymap table (ui-spec §Hotkeys), toggles (`gateWarnings`, `roundDetection`)
* [ ] `state.ts` — state machine, rev/epoch, snapshots, change events, dependsOn evaluator
* [ ] `tool.ts` — schema, guards, merge rules, fallback formatting, status line
* [ ] `panel/panel.ts` — `ctx.ui.custom` host, view switching, focus model, draft store
* [ ] `panel/short-view.ts`, `deep-view.ts`, `overview.ts`
* [ ] `panel/text-field.ts` — editor composition, `$EDITOR`
* [ ] `panel/sidechat.ts` + `panel/chat-view.ts` — singleton side chat, nested LLM loop, answer parser (M10)
* [ ] `panel/keys.ts` — config-driven routing; intercept-before-forward rule
* [ ] `delivery.ts` — delta messages, completion record, reminder line
* [ ] `lifecycle.ts` — open/suspend/resume/reopen, widget, auto-close, completion trigger
* [ ] `renderers.ts` — submission/completion cards, state entry, tool rows
* [ ] `persistence.ts` — mirror, reconstruction, compaction instructions
* [ ] `detect.ts` — round heuristic + throttled notify
* [ ] `README.md` — install, config reference, keymap table, shipped limitations (TUI-first; memory-only drafts until local input recovery ships)
block:table.0:
| File                     | Contents                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------ |
| product-requirements.md  | PRD: goals, functional requirements, UX flows, acceptance criteria, non-goals        |
| architecture.md          | Components, module layout, event/message flows, config surface                       |
| tool-protocol.md         | `interrogate` schema, actions, guards, agent-facing text, caps, fallbacks            |
| ui-spec.md               | Panel layout, screens, hotkey table, editor embedding, renderers, terminal fallbacks |
| state-and-persistence.md | State machine, rev/epoch semantics, storage, reconstruction, compaction, branching   |
| implementation-plan.md   | Build order, file-by-file checklist, test plan, risks                                |
| decisions.md             | Decision ledger extracted from the interrogation session                             |
</selected_prd_content>
<prd_index>
h1.0 pi-interrogator — SPEC
 h2.0 Core commitments (do not deviate)
 h2.1 Deliverable files
 h2.2 Defaulted decisions (user may veto)
 h2.3 Naming and strings (final)
 h2.4 Non-goals (confirmed)
h1.1 Product Requirements — pi-interrogator
 h2.5 Problem
 h2.6 Goals
 h2.7 Users
 h2.8 Functional requirements
  h3.0 Interrogation lifecycle
  h3.1 Panel UX (details in ui-spec.md)
  h3.2 Dependency and ripple semantics
  h3.3 Agent protocol (details in tool-protocol.md)
  h3.4 Persistence and recovery (details in state-and-persistence.md)
  h3.5 Answer pinning (ANSWER-PIN-001, 2026-10-04 interrogation)
 h2.9 Hard requirements (from user tooling evaluations)
 h2.10 Acceptance criteria (all must pass; scripted where possible)
 h2.11 Non-goals
h1.2 Architecture — pi-interrogator
 h2.12 Module layout
 h2.13 Components and responsibilities
 h2.14 Key flows
  h3.6 Ask (non-blocking)
  h3.7 Submit (partial, immediate; auto-submits at completeness — AUTOSUBMIT-001)
  h3.8 Read / refresh
  h3.9 Side chat (SIDECHAT-001; replaces discuss-in-chat)
  h3.10 Stale guard rejection
  h3.11 Completion
  h3.12 Suspend / resume / reopen
  h3.13 Restart / resume session
  h3.14 Tree navigation (session_tree) — SILENT
 h2.15 pi API surface used
 h2.16 Side chat cache-isolation contract (SIDECHAT-005 — binding)
 h2.17 Event subscriptions table
 h2.18 Data shapes (authoritative in tool-protocol.md / state-and-persistence.md)
 h2.19 Config surface (all hotkeys + toggles)
h1.3 Tool Protocol — interrogate
 h2.20 Schema (typebox)
 h2.21 Actions
 h2.22 Merge rules on upsert (by id)
 h2.23 Guards (Q38=A)
 h2.24 No caps (CAPS-OUT-001, 2026-10-08 owner ruling)
 h2.25 Agent-facing text (resident; ≤120 words)
 h2.26 Result rendering (TUI)
 h2.27 Non-TUI fallback (FR-25)
 h2.28 Plain-text round detection (FR-26, TUI only)
 h2.29 Status line format (shared by results and panel footer)
h1.4 UI Spec — the panel and renderers
 h2.30 Layout (TUI, replace-editor mode)
 h2.31 Terminal fallbacks
 h2.32 Free-text field (Q17=A, as amended by WRITEIN-001/002 — 2026-09-18 interrogation)
 h2.33 Auto-submit at completeness (AUTOSUBMIT-001/002 — 2026-09-18 interrogation)
 h2.34 Batch note (R3)
 h2.35 Ripple confirm (FR-18, Q39=B)
 h2.36 Hotkeys — defaults and config
 h2.37 Suspend / resume / widget
 h2.38 Side chat (e — SIDECHAT-001…005, 2026-10-15)
 h2.39 Color, order & breathing room (LOCKED 2026-09-30 — interrogation D-R11–D-R13 + live-review D-R14)
 h2.40 Renderers
 h2.41 Empty/edge states
h1.5 State & Persistence — pi-interrogator
 h2.42 Question state machine
 h2.43 rev and epoch semantics
 h2.44 Answer shape (WRITEIN-001)
 h2.45 Storage (three layers, one source of truth)
 h2.46 Reconstruction (session_start)
 h2.47 Compaction (session_before_compact)
 h2.48 Branching (/tree, /fork, /resume)
  h3.15 Tree navigation (session_tree) — silent, never a surface
 h2.49 Auto-close algorithm (Q9=B)
 h2.50 Drafts lifecycle (R4)
 h2.51 Side chat (ephemeral by design — SIDECHAT-002)
 h2.52 Local input recovery
 h2.53 Completion record format (the one full injection)
h1.6 Implementation Plan — pi-interrogator
 h2.54 Prerequisites
 h2.55 Milestones
 h2.56 File checklist
 h2.57 Testing
 h2.58 Risks
 h2.59 Config reference (settings.json → "interrogator")
h1.7 Decision Ledger — extracted from the structured interrogation session
 h2.60 Architecture & data flow
 h2.61 UI
 h2.62 Protocol
 h2.63 Remote bridge surface (2026-09-18; FR-31..34; REMOVED 2026-10-02 — see §Remote bridge surface removed below)
 h2.64 2026-09-30 interrogation — auto-submit trigger narrowed (AUTOSUBMIT-003)
 h2.65 Remote bridge surface removed (2026-10-02; supersedes D-R1..D-R7 / FR-31..34)
 h2.66 Staging philosophy (discussion resolution)
 h2.67 Defaulted (user may veto)
 h2.68 2026-09-30 interrogation — explain-any-answer
 h2.69 2026-10-04 interrogation — answer pinning (ANSWER-PIN-001)
 h2.70 2026-10-05 interrogation — pinned deep-view question (DEEP-PIN-001)
 h2.71 2026-10-05 interrogation — answer pinning re-ask amendment (ANSWER-PIN-001)
 h2.72 2026-10-06 interrogation — FR-18 closed-edit ripple (BUG-003)
 h2.73 2026-10-06 interrogation — moot reason persistence (BUG-004, Option A)
 h2.74 2026-10-07 interrogation — deep-view question framing (DEEP-PIN-002)
 h2.75 2026-10-07 interrogation — answered visibility, both views (DEEP-PIN-003)
 h2.76 2026-10-08 interrogation — transcript noise removal (GOAL-OUT-001 / MIRROR-SILENT-001)
 h2.77 2026-10-11 interrogation — deep-sticky advance (DEEP-STICKY-ADVANCE)
 h2.78 2026-10-12 interrogation — vim navigation, bare-key defaults, digit quick-select removed (VIMNAV-001 / BAREKEYS-001 / DIGIT-OUT-001)
 h2.79 2026-10-14 interrogation — landing scroll (DEEP-LAND-001)
 h2.80 2026-10-14 interrogation — WRITEIN-002 supersede re-bind restored (BUG-001)
 h2.81 2026-10-15 interrogation — per-question side-channel chat (SIDECHAT-001…005)
 h2.82 2026-10-19 interrogation — full-transcript cards (FULL-TRANSCRIPT-001)
 h2.83 2026-10-16 interrogation — feature-discovery footer (FOOTER-001)
 h2.84 2026-10-19 interrogation — mnemonic bare-letter defaults (KEYMNEMONICS-001)
 h2.85 2026-10-24 interrogation — deep pane goes fullscreen; submit dumps once and lets go (DEEP-FULLSCREEN-001, DUMP-ONCE-001)
 h2.86 2026-11-06 interrogation — submitting does not complete; the close pass owns completion (KEEP-OPEN-001)
 h2.87 2026-11-08 interrogation — the chat view keeps the question on screen (CHAT-CONTEXT-001)
 h2.88 2026-11-08 interrogation — the side chat stops making the model jump through hoops; transcript styling; empty replies surfaced (LENIENT-ANSWER-001, CHAT-STYLE-001, EMPTY-REPLY-001)
---
code:17 para:63 list:67 table:6 quote:3
</prd_index>
<issue_feedback>

</issue_feedback>
<plan_status>Task Status Summary
==================================================

P1: Delta residue: keymap-conflict re-verification record refresh and README changeset sync (docs-only) - Planned
  P1.M1: Keymap verification re-run recorded; README fully synced to the KEYMNEMONICS-001 changeset - Planned
    P1.M1.T1: Re-establish green baseline and produce the authoritative keymap-conflict verification record - Researching
      P1.M1.T1.S1: Confirm green baseline at HEAD (npm test, typecheck, lint) - Complete (1 points)
      P1.M1.T1.S2: Run scripts/verify-keymap-conflicts.sh and capture the fresh claim record - Complete (1 points)
      P1.M1.T1.S3: UPDATE REQUIRED: Re-baseline at current HEAD and re-run keymap verification covering the 10th default (keys.toggle, PANELTOGGLE-001) - Researching (1 points)
    P1.M1.T2: Refresh the README keymap-conflict re-verification record and cross-check keymap doc rows - Researching
      P1.M1.T2.S1: Rewrite the keymap-conflict re-verification record block (README.md:428-504) - Researching (2 points)
      P1.M1.T2.S2: Cross-check README keymap table and sample settings against config.ts defaults - Complete (0.5 points)
      P1.M1.T2.S3: UPDATE REQUIRED: Extend the keymap cross-check to the PANELTOGGLE-001 surfaces (10th default + panelShortcut) - Planned (0.5 points)
    P1.M1.T3: Sync changeset-level documentation - Planned
      P1.M1.T3.S1: Sweep README for remaining stale key fossils (changeset-level consistency) - Ready (1 points)
      P1.M1.T3.S2: Final delta gate: suite/typecheck/lint green, diff confined to README.md - Planned (0.5 points)

P2: PRD-delta conformance: eight post-2026-10-19 rulings (already implemented) — green verification + README residue audit - Planned
  P2.M1: Ruling-by-ruling conformance verification and README residue audit - Planned
    P2.M1.T1: Verify the eight newer rulings are fully landed and green at current HEAD - Planned
      P2.M1.T1.S1: Conformance inventory: map each ruling to its cross-refs; run the full gates - Ready (1 points)
      P2.M1.T1.S2: README residue audit against the updated PRD; fix drift in README only - Planned (1 points)

P3: Local input recovery — NEW unshipped PRD requirement: durable editor-input capture, restore, retirement, blank-answer rejection - Planned
  P3.M1: Research and architecture: durable capture design (storage, atomicity, pacing, keying) - Planned
    P3.M1.T1: Produce the input-recovery architecture note - Planned
      P3.M1.T1.S1: Research storage mechanism, edit-event seams, and write pacing; write the architecture note - Planned (2 points)
  P3.M2: Core capture + recovery-point engine - Planned
    P3.M2.T1: Implement the durable input-recovery store and wire capture into every editor duty - Planned
      P3.M2.T1.S1: Capture-on-edit wiring: full expanded string for all five editor duties - Planned (3 points)
      P3.M2.T1.S2: Atomic persistence, durability, monotonicity, and honest failure - Planned (3 points)
      P3.M2.T1.S3: Retirement semantics, no-side-effects audit, and acceptance cases 2/3/4-send-half - Planned (2 points)
  P3.M3: Restore + seeding integration - Planned
    P3.M3.T1: Restore drafts on field open and session start; never resurrect discarded edits - Planned
      P3.M3.T1.S1: Editor seeding rules: newer draft > recorded answer > blank; intentional empty preserved - Planned (2 points)
      P3.M3.T1.S2: Session-start restore (FR-28) incl. side-chat composer; acceptance cases 1 and 4-commit-half - Planned (2 points)
  P3.M4: Blank-answer rejection at the shared final mutation (all ingress) - Planned
    P3.M4.T1: Reject blank values at applyAnswer regardless of ingress - Planned
      P3.M4.T1.S1: Shared rejection guard at applyAnswer + editor inline reason - Planned (2 points)
      P3.M4.T1.S2: Reconstruction/replay blank guards + acceptance case 5 - Planned (1 points)
  P3.M5: Acceptance gate + changeset documentation - Planned
    P3.M5.T1: Final verification and docs sync - Planned
      P3.M5.T1.S1: Full gate: scripted acceptance cases 1-5 + suite/typecheck/lint + static-guard audit - Planned (1 points)
      P3.M5.T1.S2: README + docs sync: limitations row flips, AC-9 wording, config reference - Planned (1 points)</plan_status>

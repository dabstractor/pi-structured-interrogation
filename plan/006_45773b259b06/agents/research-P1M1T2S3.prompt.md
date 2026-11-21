Create a PRP for Subtask P1.M1.T2.S3 of the PRD. Store it at plan/006_45773b259b06/P1M1T2S3/PRP.md.

SCOPE: Write ONLY this item's PRP (P1.M1.T2.S3). You were asked for ONE PRP. Writing PRPs for other items in this session is allowed ONLY after you clear the MULTI-PRP BATCHING POLICY in the prompt (full task tree + full PRD + thorough per-item research for EVERY PRP you write). When in doubt, write one.
<item_title>UPDATE REQUIRED: Extend the keymap cross-check to the PANELTOGGLE-001 surfaces (10th default + panelShortcut)</item_title>
<item_description>CONTRACT DEFINITION:
1. RESEARCH NOTE: PRD delta ec61eb1 — PANELTOGGLE-001 (implemented, commit 70b08ff) added `keys.toggle` (default ctrl+n) and the `panelShortcut` config flag (default on); early greps show README already carries them (sample settings ~:166 '"toggle": "ctrl+n"', ~:174 '"panelShortcut": true', keymap table row ~:211 'Toggle panel', dedicated section ~:294). The completed S2 cross-check covered only the original 9 actions.
2. INPUT: refreshed VerificationRecord from P1.M1.T1.S3 (10 defaults); src/config.ts DEFAULT_CONFIG.keys + panelShortcut.
3. LOGIC: Extend the three-surface comparison (keymap table, sample settings, record block per-key table) to the 10th action and the panelShortcut flag: toggle ctrl+n everywhere config.ts declares it. Fix any drift in place, README.md only; verify the sample settings and table rows stay consistent with the ui-spec hotkey row for keys.toggle (dual-surface: in-panel suspend leg + global main-editor open/resume leg, gated by panelShortcut).
4. OUTPUT: Extended per-action match verdict (10/10 + panelShortcut match expected) consumed by P1.M1.T3.S1 and P1.M1.T3.S2.
5. DOCS: [Mode A] any drifted row is corrected here, with the work; if all surfaces already match: 'none — verification confirmed no user-facing change'.</item_description>
<prd_selectors>["h2.36","h2.19","h2.58","h2.83"]</prd_selectors>
<selected_prd_content>
heading:h2.36:
## Hotkeys — defaults and config

**Intercept rule — two tiers (BAREKEYS-001)**: panel-level keys are intercepted *before* the embedded editor sees them, whenever the panel is open. Modifier-bearing config keys (`ctrl+s`, `ctrl+g`) intercept even in text focus — a chord is never a typed character. BARE config keys (`d`, `i`, `e`, `n`, `c` — KEYMNEMONICS-001) and the fixed `h`/`j`/`k`/`l` are PRINTABLE: they intercept only from NON-editor focus and always forward while the editor holds focus (typing `e` in an answer must insert an `e`) — the same gating the removed digit quick-select followed (DIGIT-OUT-001). **Fixed keys while the editor is focused (ESC-002)**: `↑`/`↓` and a single `esc` forward to the editor itself (caret movement; pi-vim mode exit) instead of driving the panel. All non-fixed keys rebindable via config `interrogator.keys.*` (R5 as amended: the fixed family — `↑`/`↓`/`←`/`→` + `h`/`j`/`k`/`l`, `enter`, `esc`, `ctrl+c` — is the documented exception; VIMNAV-001).

| Action                           | Default               | Config key                                  | Context                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------- | --------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| move among options               | `↑`/`↓` + `k`/`j`     | fixed aliases (not configurable)            | view-aware: short form option cursor (domain includes the Other row); deep: selection; overview: cursor row                                                                                                                                                                                                                                                                                                                                                                                      |
| prev/next question               | `←` / `→` + `h` / `l` | fixed aliases (not configurable)            | panel (all views; full list incl. moot/withdrawn; overview: cursor row)                                                                                                                                                                                                                                                                                                                                                                                                                          |
| prev/next question               | `tab` / `shift+tab`   | `keys.prevQuestion`/`nextQuestion`          | short form                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| accept + advance                 | `enter`               | fixed                                       | options focus (Other row → write-in duty); write-in/text editor focus (commits the answer); on the already-recorded answer: state no-op, advance only (ANSWER-PIN-001)                                                                                                                                                                                                                                                                                                                           |
| toggle deep view                 | `d`                   | `keys.deep`                                 | non-editor focus                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| overview list                    | `i`                   | `keys.overview`                             | non-editor focus                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| elaborate on selection           | `e`                   | `keys.elaborate` (renamed from `focusText`) | short + deep views, non-editor focus — enters the editor: elaboration duty by default; write-in duty when the cursor is on the Other row or the question is `type:"text"`; in the deep view the editor pins BELOW the pane (pane stays rendered as context — DEEP-EDITOR-001); overview stays excluded (BUG-004 cursor ambiguity); no re-press close (an `e` while focused must type) — close via `enter` or double-`esc`                                                                        |
| batch note                       | `n`                   | `keys.batchNote`                            | non-editor focus (opens); close via `enter` or double-`esc` — same re-press caveat                                                                                                                                                                                                                                                                                                                                                                                                               |
| submit (partial / gate override) | `ctrl+s`              | `keys.submit`                               | panel including text focus — partial submissions and the deliberate gate-hold override; completeness auto-submits (AUTOSUBMIT-001); every real delivery auto-suspends the panel (FR-3d post-submit exit — the upsert gate, `{reopen:true}`, or `/interrogate` resurfaces it)                                                                                                                                                                                                                     |
| side chat                        | `c`                   | `keys.chat` (renamed from `discuss`)        | non-editor focus — opens on the current question (overview: the cursor row); opening on another question replaces the live chat (singleton)                                                                                                                                                                                                                                                                                                                                                      |
| external editor                  | `ctrl+g`              | `keys.externalEditor`                       | editor focus (any duty) — MUST stay modifier-bearing: its only valid context is editor focus, where a bare key would have to type, never act (BAREKEYS-001)                                                                                                                                                                                                                                                                                                                                      |
| back / suspend                   | `esc`                 | fixed                                       | OPTIONS focus: descends (deep→short, overview→back, short→suspend), never destroys. EDITOR focus: single `esc` forwards to the editor (pi-vim); `esc` twice in a row (within `escExitWindowMs`, default 500 ms, 0 disables) closes the prompt box ONLY — draft write-through, blur to options, no suspend                                                                                                                                                                                        |
| interrupt / escape               | `ctrl+c`              | fixed                                       | closes the prompt (suspend) and stays unconsumed so pi's own ctrl+c flow (clear; double-press shutdown) resumes on the restored editor; works from any panel state including modals (CTRL-C-001)                                                                                                                                                                                                                                                                                                 |
| toggle the panel (close leg)     | `ctrl+n`              | `keys.toggle` (PANELTOGGLE-001)             | inside an open panel, any focus (chord = tier 1; a bare remap forwards while the editor holds focus — BAREKEYS-001 tier rules) — suspends via the same `done(null)` exit as the esc ladder's terminal rung. The OPEN/RESUME leg of the same chord is GLOBAL: from pi's main editor the registered shortcut invokes the panel exactly like `/interrogate` (an explicit user resume affordance — SURFACE-001's allow-list is unchanged); empty state (nothing resumable) notifies the h2.37 string |

Digit quick-select (1–9) is REMOVED (DIGIT-OUT-001, 2026-10-12): with `hjkl` + `enter` the digits were a redundant second accept path, and a stray digit instantly answered + advanced — an accidental-answer footgun. The `digitQuickSelect` toggle is deleted; digits are inert at panel level (they only ever type, where typing is possible).

Non-key config: `escExitWindowMs` (ms, default 500) — the double-esc window for closing the embedded editor without suspending; `sideChatModel` (string, default: the session model) and `sideChatAutoApply` (boolean, default `false`) — §Side chat.

Conflict avoidance (verified against pi defaults + installed extensions): `ctrl+b`, `ctrl+shift+b`, `ctrl+shift+x`, `ctrl+shift+j`, `shift+down` are taken by others — avoided. `ctrl+m` avoided (sends `\r`). The bare-letter defaults (`d` `o` `t` `m` `e`, plus fixed `h` `j` `k` `l`) collide with nothing in the panel's own vocabulary and cannot fight pi or other extensions — the panel owns the whole keyboard while open, and bare keys never intercept in editor focus. The ONE global registration is the `toggle` chord `ctrl+n` (PANELTOGGLE-001, `panelShortcut` config, default on): it shares the key with pi's `app.session.toggleNamedFilter` — a PICKER-SCOPED built-in (fires only inside the session resume picker) with no focus overlap; pi's runner does not reserve the key (extension wins at the main editor, one startup diagnostic). The historical `ctrl+shift+q` break-out/resume chord stays DEAD — window managers claim it to close windows on many desktop environments, so it never reliably reaches the terminal; nothing may rebind onto it as a default. Dev agent must re-verify at build time and record findings in the PR notes.

Fixed-key notes: `←`/`→` (and `h`/`l`) navigate the FULL question list (every status navigable, clamped at the ends — no wrap), view-aware exactly like the config prev/next keys (overview: cursor row; short/deep: current question), and are NOT intercepted while the embedded editor holds focus (text/note) — the editor caret owns horizontal movement there. `k`/`j` are checked in the same fixed branch as `↑`/`↓` — identical view-aware semantics and identical editor-focus forwarding; together with `h`/`l` they give vim-style navigation through questions and answer choices (VIMNAV-001).
heading:h2.19:
## Config surface (all hotkeys + toggles)

Loaded from pi `settings.json` under `"interrogator"` key; deep-merged over defaults. See ui-spec.md §Config for the full reference including every keymap entry and toggle flags (`gateWarnings`, `roundDetection`). Side chat: `keys.chat` (renamed from `keys.discuss`), `sideChatModel`, `sideChatAutoApply`.
heading:h2.58:
## Risks

| Risk                                                         | Mitigation                                                                                                                                                                       |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Embedded editor double-instance quirks (history, IME, paste) | M4 isolated; fall back to stock pi-tui `Editor` if composition misbehaves (config flag `editorMode: "composed" \| "stock"`)                                                      |
| Deep-view scroll pane rendering bugs at odd widths           | Cap + ellipsize; overview list is the escape hatch                                                                                                                               |
| `agent_settled` ordering vs tool\_execution\_end             | Track per-run flags set in `tool_execution_end`; close pass reads them (state-and-persistence algorithm)                                                                         |
| Compaction dropping tool-result details                      | Entry-mirror fallback path (tested via fixture)                                                                                                                                  |
| Ctrl+shift+m/e terminal variability                          | Config-rebindable; documented; `\r` collision avoided                                                                                                                            |
| Model ignores "end your turn" instruction                    | Harmless (instruction-only, Q28=B); never `terminate`                                                                                                                            |
| Side-chat nested calls (auth, cost, runaway replies)         | `modelRegistry` resolves auth (qna.ts pattern); usage tallied + shown on close; `esc` aborts; singleton + one-shot snapshot cap the blast radius; feature-inert without the seam |
heading:h2.83:
## 2026-10-16 interrogation — feature-discovery footer (FOOTER-001)

* FOOTER-001 — the footer advertises FEATURES, not key mechanics. Owner report (verbatim intent): the side chat shipped INVISIBLE — "they have NO IDEA that a side chat is even a feature if we don't advertise it to them here. Just like detailed view, just like adding a note to the answer with the `t` button." Rulings: (1) every remappable action relevant to the screen is listed — short carries deep/list/chat/explain/note/submit, deep carries list/chat/explain/submit, overview carries deep/chat/submit, chat carries `/clear` + the binding-named reopen clause; (2) UBIQUITOUS KEYS ARE NEVER HINTED — enter ("the only thing Enter ever does") and esc ("right in the name") earn no labels anywhere; deleted: "enter accept", "esc back", "enter jump", "↑/↓ scroll", "enter save", "esc esc back", "enter send", and the chat footer's esc-abort/exit word (now state-invariant `/clear`); (3) while the editor holds focus the footer collapses to the only hints that stay TRUE — the chords `{submit} submit · {externalEditor} editor` (externalEditor's only valid context is editor focus, its one advertised home; bare-key feature hints would lie — they type, BAREKEYS-001); (4) the narrow/tiny right-to-left drop ladder and sacred progress are unchanged, and `/clear` never drops in the chat view (the confused-chat escape hatch, SIDECHAT-005). Supersedes D-R11's letter ("the footer permanently names `{elaborate} explain` as an appended static") — the explain key is now a plain SCREEN\_KEYS entry on short and deep: same visibility, uniform mechanism. The ripple-confirm and answer-confirm rows keep their `enter=/esc=` wording — they are contextual decision prompts, not footer chrome.
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
    P1.M1.T1: Re-establish green baseline and produce the authoritative keymap-conflict verification record - Complete
      P1.M1.T1.S1: Confirm green baseline at HEAD (npm test, typecheck, lint) - Complete (1 points)
      P1.M1.T1.S2: Run scripts/verify-keymap-conflicts.sh and capture the fresh claim record - Complete (1 points)
      P1.M1.T1.S3: UPDATE REQUIRED: Re-baseline at current HEAD and re-run keymap verification covering the 10th default (keys.toggle, PANELTOGGLE-001) - Complete (1 points)
    P1.M1.T2: Refresh the README keymap-conflict re-verification record and cross-check keymap doc rows - Researching
      P1.M1.T2.S1: Rewrite the keymap-conflict re-verification record block (README.md:428-504) - Complete (2 points)
      P1.M1.T2.S2: Cross-check README keymap table and sample settings against config.ts defaults - Complete (0.5 points)
      P1.M1.T2.S3: UPDATE REQUIRED: Extend the keymap cross-check to the PANELTOGGLE-001 surfaces (10th default + panelShortcut) - Researching (0.5 points)
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

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

- **Deep view** (`ctrl+d` toggle, sticky per panel session): replaces everything between header and footer with a scrollable pane — full `description` on top, then each option as a sticky section header (`▸ sqlite`) followed by its `ramification` text, then the synthetic Other section (`✎ Other — write your own`) with the extension-supplied ramification: "None of the listed options fit — write your own answer; it ships as the official answer for this question, not as an attachment to one of them." Rows remain selectable: highlight + `enter` selects, returns to short form, advances (Q14). `↑/↓` scroll here (they don't navigate questions while in deep view).
- **Overview** (`ctrl+l`): full-screen-in-panel list of all questions with markers — `·` open, `★` answered, `⟳` re-asked, `⊘` moot (+reason, dimmed), `⊗` withdrawn, `✎` write-in/text answer; group headers; gate group marked `▲`. `enter` jumps; `esc` returns.
- **Gate rendering (soft, Q32=B)**: gate group renders normal; non-gate groups dimmed (still navigable/answerable — R1). Submitting with gate questions unanswered → dismissible footer warning: `⚠ {n} foundational unanswered — later answers may shift`.
- **Goal**: always in the header (FR-30). Truncated to fit, full text in deep view.

## Remote bridge surface (pi-ask contract; 2026-09-18)

Emission contract: pi-ask's documented bridge events, verbatim names + payload shapes (`@eko24ive/pi-ask:started|completed|submit|submit-result`), emitted on the shared `pi.events` bus. pi-ask's docs design this channel for local bridges generally ("status cards, desktop helpers, or approval UIs"); remote-pi's `extension_ui_bridge` is one conformant client (it translates the contract into `extension_ui_request` frames its Flutter app renders natively). pi-ask is NOT a dependency; the contract is copied with citation. Zero remote-pi/app changes.

| Extension field | Wire field | Notes |
|---|---|---|
| question.prompt (+ `\n\n` + description) | AskQuestion.prompt | bridge-side readers are the standalone readers the deep-view contract targets; never truncated |
| question.title | AskQuestion.label | `""` when absent (never omit — the bridge would duplicate the whole prompt into label) |
| type choice/text | AskQuestion.type "single" | text questions send `options: []` (app still shows the free-text field) |
| option.value/label | AskOption.value/label | label gets `" ★"` appended on the recommended option (no native star in the app) |
| option.ramification | AskOption.description | muted prose under the label |
| goal | flow title | `goal || "Interrogation"`, ~80-char soft cap |
| gate/dependsOn/rev/epoch | not carried | state machine stays extension-side |
| statuses open+reasked | questions[] | answered/terminal excluded — bridge clients cannot edit past answers in v1 (desktop panel's role) |

Bridge submit mapping: `values[0]` → answer.value (validated against CURRENT option values); `customText` → answer.text and, when values empty, answer.value — the bridge's customText-only submission IS the write-in path and maps to `answer.custom: true` exactly like the panel's Other row (WRITEIN-001 parity: phone and desktop produce identical answers); text questions take `customText ?? values[0]`; `note`/`optionNotes` dropped. Submit pipeline mirrors panel `ctrl+s` exactly (baseline → computeDiff → pendingIds → BUG-008 filter → markSubmitted → buildSubmission [snapshot+bump once] → deliverSubmission → noteSubmissionDelivered) and runs `maybeAutoSubmit` at its tail (AUTOSUBMIT-001 bridge parity). The FR-25 digest fallback is unchanged — bridge activity never alters model-facing result text.

FlowIds are namespaced `itg:<rand>:<seq>`; submits for foreign flowIds are ignored silently (pi-ask's business), stale `itg:` flows nack with `flow_not_found`. Co-installed pi-ask cross-talk (its `flow_not_found` nack on our submits → one transient client warning) is bounded and accepted. An unexpected internal error in the submit pipeline nacks `internal_error` and completes the flow — the client is always acked (ok or nack), never hangs; no rollback, the next upsert resurface heals the surface (BUG-007, D-R6). Every upsert with live questions re-emits (completing the previous flow) (completing the previous flow) — surface replacement is self-healing; in-surface progress is expendable (draft sacredness is a panel commitment, not a bridge one).

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

- **Every answer commit auto-submits while the set is complete.** After every commit — option accept (including edits of answered questions), Other write-in commit, text-answer `enter` — the panel runs the completeness check: zero questions with status `open`/`reasked` remain (moot/withdrawn/closed never count as unanswered). When the set is complete AND at least one question is pending (`answered`), the submission fires automatically through the EXACT `ctrl+s` pipeline (reconcile → baseline/diff → BUG-008 filter → gate check → markSubmitted → buildSubmission → deliverSubmission → noteSubmissionDelivered), the footer flashes `submitted — {n} answer(s)`, and any held batch note rides it (R3). Edits included: re-committing an already-answered question while the set is complete ships the edit immediately (one submission per commit — the user opted into this knowing each is a model turn).
- **Gate hold (AUTOSUBMIT-002).** While any gate-group question is `open`/`reasked`, auto-submit is withheld. The common case is exactly what the hold line exists FOR: a gate question is itself unanswered, so the completeness check would return and nothing would fire — the ⚠ line is what makes that hold visible instead of silent (BUG-001: it arms on EVERY commit while gate questions are unanswered, including commits the completeness check already withholds). So whenever a commit lands while gate questions remain unanswered, the non-expiring footer warning shows `⚠ {n} foundational unanswered — answer them or {submit} to submit now` (any key dismisses, never blocks — the soft-gate philosophy holds; `ctrl+s` is the deliberate override).
- **One shared hook.** The check (`maybeAutoSubmit`) runs after panel commits AND at the tail of bridge submissions (remote-submit.ts) — a bridge partial submit that completes the set alongside panel-pending answers ships once, through the same pipeline. It no-ops on zero-pending.
- **`ctrl+s` remains** for partial submissions at any time and as the gate-hold override. The old `submit pending answers first` footer edge is gone in practice (completeness ships itself).

## Batch note (R3)

`ctrl+shift+m` swaps the editor area into note mode (header shows `NOTE — ships with next submission`); same embedded editor; `enter` saves + exits, `ctrl+shift+m` re-press or `esc` twice in a row exits (single `esc` forwards to the editor — ESC-002). Stored as `batchNote`; delivered as a `NOTE:` line in the delta and shown on the card; cleared after shipping.

## Ripple confirm (FR-18, Q39=B)

On committing an answer change to an *answered* question in the panel (the moment `enter` finalizes — option accept, write-in commit, or a text/write-in re-commit on an answered question), if `dependsOn` ripple (transitive closure) hits answered/submitted questions: footer becomes `⚠ Invalidates {n} answered questions ({ids}) — enter=keep, esc=cancel`; `esc` reverts the edit; `enter` applies — and the applied commit then runs the auto-submit check like any other. No drill-down in v1.

## Hotkeys — defaults and config

**Intercept rule**: panel-level keys are intercepted *before* the embedded editor sees them, whenever the panel is open (including text focus). Everything else forwards to the embedded editor. **Exception — fixed keys while the editor is focused (ESC-002)**: when the editor holds focus, `↑`/`↓` and a single `esc` forward to the editor itself (caret movement; pi-vim mode exit) instead of driving the panel. All keys rebindable via config `interrogator.keys.*`; no exceptions (R5).

| Action | Default | Config key | Context |
|---|---|---|---|
| prev/next question | `tab` / `shift+tab` | `keys.prevQuestion`/`nextQuestion` | short form |
| prev/next question | `←` / `→` | fixed (not configurable) | panel (all views; full list incl. moot/withdrawn; overview: cursor row) |
| move among options | `↑`/`↓` | fixed | short form (cursor domain includes the Other row) |
| quick-select 1–9 | `1`–`9` | `digitQuickSelect` toggle | short form — REAL options only (never the Other row) |
| accept + advance | `enter` | fixed | options focus (Other row → write-in duty); write-in/text editor focus (commits the answer) |
| toggle deep view | `ctrl+d` | `keys.deep` | panel |
| overview list | `ctrl+l` | `keys.overview` | panel |
| elaborate on selection | `ctrl+t` | `keys.focusText` | panel — TOGGLE into the editor: elaboration duty by default; write-in duty when the cursor is on the Other row or the question is `type:"text"`; press again to close the prompt box (draft saved) |
| batch note | `ctrl+shift+m` | `keys.batchNote` | panel |
| submit (partial / gate override) | `ctrl+s` | `keys.submit` | panel — partial submissions and the deliberate gate-hold override; completeness auto-submits (AUTOSUBMIT-001) |
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
- **Surfacing allow-list (SURFACE-001 — 2026-09-18 interrogation).** The panel may be opened ONLY by: the user (`/interrogate`), an agent upsert that leaves unanswered questions (new or re-asked — visibility follows new work; a description-only edit while everything is answered surfaces nothing), or agent `{reopen:true}` (explicit intent; the hasResumableQuestions gate stays). **Pure reads never surface, regardless of state** — `maybeAutoOpen` requires (1) the call was an upsert (`questions[]` non-empty — the tool_execution_start args stash already exists for the bridge emission), (2) unanswered (open/reasked) questions exist post-upsert, (3) the interrogation is not completed. The suspended-reopen path (`handleUpserted`) carries the same unanswered gate. Rationale (dogfood finding): any successful interrogate call — including a pure `{}` read — used to pop the panel whenever a state object existed, even all-answered or completed; after `/tree` navigation the model's re-orient read then replaced the user's prompt box mid-turn, and pi's custom() snapshot/restore of editor text made every such pop a data-loss trap (the empty-box-after-esc symptom). Reads are pull; they are never surfaces.
- `/interrogate` is INVOKE-ONLY (immediate in every scenario): panel open → silent no-op (never suspends); panel suspended with live questions → resume; closed host with live state (e.g. after an extension reload) → fresh open from the session singleton; no/dead state → the empty-state notify below. Typing `/interrogate` must NEVER leave the user behind a "press X to resume" gate.
- Discuss-in-chat (`ctrl+shift+e`): suspend + `setEditorText` with:
  ```
  > {prompt}
  {options one per line, ★ marked}
  (discussing q{id} — agent: side-chat freely; reopen panel when done)
  ```

## Renderers

- `interrogation-submission` (registerMessageRenderer): user-only card from `details.card` — each changed answer `{title}: {old} → {new (changed)}` + any `NOTE:` line + `{open} remain open`; write-in answers render as `✎ {text}` (truncated to fit); compact by default, `expanded` shows full submission including full write-in text.
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

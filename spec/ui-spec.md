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

Bridge submit mapping: `values[0]` → answer.value (validated against CURRENT option values); `customText` → answer.text and, when values empty, answer.value; text questions take `customText ?? values[0]`; `note`/`optionNotes` dropped. Submit pipeline mirrors panel `ctrl+s` exactly (baseline → computeDiff → pendingIds → BUG-008 filter → markSubmitted → buildSubmission [snapshot+bump once] → deliverSubmission → noteSubmissionDelivered). The FR-25 digest fallback is unchanged — bridge activity never alters model-facing result text.

FlowIds are namespaced `itg:<rand>:<seq>`; submits for foreign flowIds are ignored silently (pi-ask's business), stale `itg:` flows nack with `flow_not_found`. Co-installed pi-ask cross-talk (its `flow_not_found` nack on our submits → one transient client warning) is bounded and accepted. Every upsert with live questions re-emits (completing the previous flow) — surface replacement is self-healing; in-surface progress is expendable (draft sacredness is a panel commitment, not a bridge one).

## Terminal fallbacks

- Height < 24 rows: hint line suppressed; deep view still available (it's a full replacement). Height < 12: overview list paginates 5 rows.
- Width < 60 cols: option labels truncate with `…`; ramifications wrap; footer shows 2 keys max (`submit`, `deep`).

## Free-text field (Q17=A)

**Semantics — the explanation is EXTRA, not an answer of its own** (on choice questions): it is an elaboration that attaches to whichever option the user selects, shipping at submit as `answer.text` alongside `answer.value`. Selecting options remains fully available before, during, and after explaining — the draft and the option choice are orthogonal (the draft is stored per question, R4, and attaches to whatever option is pending at submit; changing the selection re-attaches the same draft). A choice question with an explanation but no selected option does not ship. On `type:"text"` questions the editor IS the answer (there are no options) — the draft becomes `answer.value` at submit.

- Instantiated once per panel via `ctx.ui.getEditorComponent()(tui, theme, keybindings)` — composes the user's active editor (vim modes etc.). Not focused by default; `ctrl+t` (or accepting the `✎` affordance) focuses it.
- `enter` saves the draft and returns focus to options. **Two-stage arming is text-question-only (EXPLAIN-003)**: on `type:"text"` questions the *next* `enter` advances (the draft completes the answer — multi-line typing with `shift+enter`/`ctrl+j` is safe). On choice questions the next `enter` is a NORMAL accept of the highlighted option — the ✎ cursor re-seeds to the ★ preselect when the editor closes — so explain → enter → enter answers the question with the elaboration attached, making it submittable. A zero-pending ctrl+s flashes `nothing to submit — {n} explained question(s) still need an option choice` when drafts sit on unanswered choice questions. Separate history (never calls `addToHistory`).
- **Exit gestures (ESC-002)** — three ways back to normal question selection, none of which suspend the panel: `enter` (save + arm the two-stage advance on text questions), `ctrl+t` re-press (save + blur, no arm), and `esc` twice in a row within `escExitWindowMs` (save + blur, no arm). While the editor is focused a single `esc` and `↑`/`↓` forward to the editor (pi-vim users keep their keys). Every exit is a draft write-through — backing out never loses typed text (R4). `ctrl+c` (CTRL-C-001) closes the whole prompt — suspend, unconsumed — from any state including modals, handing pi's normal SIGINT flow back to the restored editor.
- **Buffer scoping (EXPLAIN-002)**: the embedded editor is ONE component per panel session (h2.31), but its contents are **per-question**. Whenever the current question changes, the outgoing buffer is written through to *its* question's draft (R4 — tab-away-and-back is lossless) and the editor re-seeds from the new question's freshest draft — **blank when none exists**. A submitted answer, another question's draft, or the batch note never bleeds into the box for the question being viewed. Note duty suspends scoping (the note is question-agnostic); exiting note mode re-scopes to the current question.
- `ctrl+g` (mirrors `app.editor.external`): opens `$VISUAL`/`$EDITOR` (nano fallback) seeded with the draft via temp file; on clean exit the text replaces the field.
- **Draft preservation (R4)**: one draft slot per question (`{value, text}`) + one `batchNote`, held in panel memory for the panel's lifetime: survives navigation, deep/overview toggles, upserts (including answer resets — merge rule 2), suspend/resume. Destroyed only by submission (text answers ship) or user-initiated clear. Not persisted across restarts (documented).

## Batch note (R3)

`ctrl+shift+m` swaps the editor area into note mode (header shows `NOTE — ships with next submission`); same embedded editor; `enter` saves + exits, `ctrl+shift+m` re-press or `esc` twice in a row exits (single `esc` forwards to the editor — ESC-002). Stored as `batchNote`; delivered as a `NOTE:` line in the delta and shown on the card; cleared after shipping.

## Ripple confirm (FR-18, Q39=B)

On committing an answer change to an *answered* question in the panel (the moment `enter` finalizes), if `dependsOn` ripple (transitive closure) hits answered/submitted questions: footer becomes `⚠ Invalidates {n} answered questions ({ids}) — enter=keep, esc=cancel`; `esc` reverts the edit; `enter` applies. No drill-down in v1.

## Hotkeys — defaults and config

**Intercept rule**: panel-level keys are intercepted *before* the embedded editor sees them, whenever the panel is open (including text focus). Everything else forwards to the embedded editor. **Exception — fixed keys while the editor is focused (ESC-002)**: when the explain/note editor holds focus, `↑`/`↓` and a single `esc` forward to the editor itself (caret movement; pi-vim mode exit) instead of driving the panel. All keys rebindable via config `interrogator.keys.*`; no exceptions (R5).

| Action | Default | Config key | Context |
|---|---|---|---|
| prev/next question | `tab` / `shift+tab` | `keys.prevQuestion`/`nextQuestion` | short form |
| prev/next question | `←` / `→` | fixed (not configurable) | panel (all views; full list incl. moot/withdrawn; overview: cursor row) |
| move among options | `↑`/`↓` | fixed | short form |
| quick-select 1–9 | `1`–`9` | `digitQuickSelect` toggle | short form |
| accept + advance | `enter` | fixed | options focus |
| toggle deep view | `ctrl+d` | `keys.deep` | panel |
| overview list | `ctrl+l` | `keys.overview` | panel |
| focus text field | `ctrl+t` | `keys.focusText` | panel — TOGGLE: press to focus, press again to close the prompt box (draft saved) |
| batch note | `ctrl+shift+m` | `keys.batchNote` | panel |
| submit | `ctrl+s` | `keys.submit` | panel |
| discuss in chat | `ctrl+shift+e` | `keys.discuss` | panel |
| external editor | `ctrl+g` | `keys.externalEditor` | text focus |
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
- `/interrogate` is INVOKE-ONLY (immediate in every scenario): panel open → silent no-op (never suspends); panel suspended with live questions → resume; closed host with live state (e.g. after an extension reload) → fresh open from the session singleton; no/dead state → the empty-state notify below. Typing `/interrogate` must NEVER leave the user behind a "press X to resume" gate.
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
- `/interrogate` with an existing session → panel invoked immediately in EVERY scenario (see Suspend/resume above); repeated invocations are silent no-ops while the panel is open.
- 0 open questions but pending submissions → footer `submit pending answers first`; completion triggers after close pass.
- Model upserts while panel suspended → panel reopens (upsert implies visibility).
- User presses `ctrl+s` with zero pending → no-op footer flash `nothing to submit`.

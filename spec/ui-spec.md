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

**Semantics — the explanation is EXTRA, not an answer of its own** (on choice questions): it is an elaboration that attaches to whichever option the user selects, shipping at submit as `answer.text` alongside `answer.value`. Selecting options remains fully available before, during, and after explaining — the draft and the option choice are orthogonal (the draft is stored per question, R4, and attaches to whatever option is pending at submit; changing the selection re-attaches the same draft). A choice question with an explanation but no selected option does not ship. On `type:"text"` questions the editor IS the answer (there are no options) — the draft becomes `answer.value` at submit.
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
| focus text field | `ctrl+t` | `keys.focusText` | panel — TOGGLE: press to focus, press again to close the prompt box (draft saved) |
| batch note | `ctrl+shift+m` | `keys.batchNote` | panel |
| submit | `ctrl+s` | `keys.submit` | panel |
| break out / resume | `ctrl+shift+q` | `keys.breakOut` (also `registerShortcut`, global) | global |
| discuss in chat | `ctrl+shift+e` | `keys.discuss` | panel |
| external editor | `ctrl+g` | `keys.externalEditor` | text focus |
| back / suspend | `esc` | fixed | OPTIONS focus: descends (deep→short, overview→back, short→suspend), never destroys. EDITOR focus: single `esc` forwards to the editor (pi-vim); `esc` twice in a row (within `escExitWindowMs`, default 500 ms, 0 disables) closes the prompt box ONLY — draft write-through, blur to options, no suspend |
| interrupt / escape | `ctrl+c` | fixed | closes the prompt (suspend) and stays unconsumed so pi's own ctrl+c flow (clear; double-press shutdown) resumes on the restored editor; works from any panel state including modals (CTRL-C-001) |

Non-key config: `escExitWindowMs` (ms, default 500) — the double-esc window for closing the embedded editor without suspending.

Conflict avoidance (verified against pi defaults + installed extensions): `ctrl+b`, `ctrl+shift+b`, `ctrl+shift+x`, `ctrl+shift+j`, `shift+down` are taken by others — avoided. `ctrl+m` avoided (sends `\r`). Dev agent must re-verify at build time and record findings in the PR notes.

## Suspend / resume / widget

- Suspend: `esc` at top level, `ctrl+shift+q` anywhere, or `/interrogate`. Panel `done(null)`; state + drafts held in extension memory; **main editor text preserved** (pi's editor instance persists across `custom()` sessions; verify in test).
- **Command surface (CMD-001)**: `/interrogate` is the ONE registered command — bare invocation toggles the panel; `ping` (smoke test) and `debug upsert|submit|state` (the h2.50 verification surface) are subcommands with argument completion, keeping `/interrogate` the top (and only) autocomplete hit for "/inter".
- Widget (`setWidget("interrogator", [...])`, visible whenever suspended with open questions): `{n} open · {m} answered — {configured breakOut key} to resume /interrogate`.
- Resume: `ctrl+shift+q`, `/interrogate`, or agent `{reopen:true}` → fresh panel instance rehydrated from state + drafts, focused on the **first unanswered question** (open/reasked, in state order — RESUME-001); when nothing is unanswered (pending-submit state), the last-focused question; else the first resumable one.
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

# pi-interrogator

Structured interrogation for [pi](https://github.com/earendil-works/pi-coding-agent):
when a model needs clarifying questions, they stay in a panel — not scrolled-away chat text.

Long question lists scroll off screen as soon as you answer the first batch; you
scroll up to re-read and lose the input box; requirements end up scattered,
contradictory, and forgotten. pi-interrogator keeps the question set
front-and-center in a panel while you answer at your own pace.

## Install

Option A — quick, single session:

```bash
pi -e src/index.ts
```

Option B — persistent local package reference. Append to `packages` in
`~/.pi/agent/settings.json` (paths resolve against the settings file's
directory; the directory resolves to a package via its `pi.extensions` manifest):

```jsonc
{ "packages": [ "../../projects/pi-structured-interrogation" ] }
```

Then run `npm install` in the package once so devDependencies (typecheck/vitest)
materialize; runtime loads via jiti against pi's tree.

## Usage

1. Ask the agent to interrogate you (e.g. *"interrogate me about the migration
   plan"*). The model upserts questions through the `interrogate` tool and the
   panel **auto-opens** on the first upsert.
2. Answer in the panel: move between questions with `←` / `→` (or `h` / `l`,
   `tab` / `shift+tab`), pick an option with `↑` / `↓` (or `k` / `j`) and
   accept with `enter`; `d` opens the deep-dive view, `o` the overview, `t`
   enters the free-text editor (short view), `m` attaches a batch note, `e`
   opens the side chat on the current question (see
   [Side chat](#side-chat)), `ctrl+g` finishes the draft in an
   external editor, `ctrl+s` submits a partial set. The editor's duty follows
   context: focused
   from a selected option it is the **elaboration** duty — `enter` saves the
   text and returns to the options (double-`esc` also closes the editor — a
   re-pressed `t` just types the letter), and the option you then accept
   ships with your explanation attached; on the `✎ Other — write your own`
   row (and on `type:"text"` questions) it is the **write-in** duty — the
   text IS the answer and `enter` commits it immediately. On a `type:"text"`
   question, `enter` on the `✎ answer…` affordance itself opens the editor
   in the write-in duty — `t` is not the only entry.
   Revisits are answer-first: on any question that already carries an answer,
   the caret and highlight sit on that recorded answer in every view — the
   ★ recommendation stays visible on its own row but never owns the caret
   once an answer exists — and `enter` on the recorded value
   just moves you along — no state change, no resubmission, no confirm.
   Re-asks are the exception: when the agent re-asks a question, re-selecting
   your answer re-confirms it — the same value (`enter`, or a
   byte-identical write-in) on an unchanged option list, or a re-answer
   after the options changed — and the re-confirmed answer ships; a
   re-asked question never strands.
   Changing an answer takes an explicit different choice (another row,
   edited write-in text), which raises the invalidation
   confirm when it would moot dependent questions — any edited question
   with a recorded answer counts, archived (closed) ones included. A
   write-in answer pins
   the caret to its `✎ Other` row (with a dimmed preview of the text), and
   answered questions carry the ★ answered marker on the question line.
3. Submitting is mostly automatic: answering the last open question — by
   option accept, `✎ Other` write-in, or text `enter` — ships the submission
   for you (footer flashes `submitted — {n} answer(s)`), and an edit made
   while the set is already complete ships immediately too (one submission
   per commit — the deliberate one-model-turn-per-edit trade-off while
   complete). `ctrl+s` still submits partial sets — unanswered questions
   stay open. While a foundational gate question is unanswered, auto-submit
   holds: commits show `⚠ {n} foundational unanswered — answer them or
   {submit} to submit now` (any key dismisses it), and `ctrl+s` is the
   deliberate override. Each submit streams a compact delta message to the
   model (rendered as a diff card in your transcript), ending with
   `(state epoch {n})` — the epoch the model must echo when upserting
   existing questions afterwards. The diff card is your durable record of
   what you told the model (FULL-TRANSCRIPT-001): every changed answer in
   full — option labels, ✎ write-ins, and the elaborations you attached
   with `t` — each under its full question prompt when the short title
   doesn't already show it, plus the full batch note. Nothing is
   truncated, capped, or hidden behind the transcript's expand toggle —
   so you can always scroll back and read exactly what you said.
4. Break out any time with `esc` (from the short view): the panel suspends,
   a widget with question counts stays visible, and you can run side chats.
   Type `/interrogate` to get the panel back immediately — it invokes the
   panel in every scenario (never toggles, never asks you to press a key
   combo; the old `ctrl+shift+q` chord was removed because window managers
   claim it to close windows on many desktop environments). Drafts are
   intact, and resume works even when every question is answered but not
   yet submitted — reopening on the first unanswered question; the model
   can also reopen the panel itself when it has follow-ups. A submit
   flushes only the answers that actually shipped — drafts of questions
   the agent re-asked survive. Navigating the conversation tree (`/tree`)
   never opens or reopens the panel: the interrogation state silently
   follows the branch you land on (and clears away on branches without
   one), so resurfacing stays deliberate — the panel opens ONLY via
   `/interrogate`, a model upsert that leaves unanswered (open/reasked)
   questions, or the model's `{reopen:true}`. Reads (`{}`) never surface
   the panel, whatever the state (all-answered, completed, after `/tree`)
   — a description-only edit over an answered set surfaces nothing. A
   session restart/resume never opens it either: after a restart the
   suspend widget line (live counts, `/interrogate`) is the only cue — run
   `/interrogate` and the restored questions and answers come right back.
5. When every question is closed, the panel dismisses and the model receives
   **one full completion record** (a recap card lands in the transcript —
   every question with its final answer, free text, full prompts, and all
   batch notes, in full in both compact and expanded modes).

**Model behavior note** — the model drives the `interrogate` tool, not you: it
upserts questions **surgically** — only the ids it sends are created or
updated; omitted live questions are untouched (stable ids, `rev`- and
epoch-guarded — upserts touching existing ids must echo the current epoch).
Pruning is deliberate: the model resends the kept set with
`withdrawOmitted: true`, and the result reports what withdrew. It reads
current state with `{}` — full question content, so edits survive
compaction — receives your submissions as delta messages, and gets one full
completion record when the interrogation completes. Between submissions it
reconciles contradictions and re-asks only the questions materially affected. The goal
statement may be updated on any upsert — it is stored verbatim, with no length
limits (CAPS-OUT-001) — and an upsert sent after completion
starts a fresh interrogation (the epoch restarts at 1; its first upsert may
echo the previous epoch — accepted) that completes normally. You answer in
the panel; you never invoke the tool.

With `editorMode: "composed"` (the default) the panel composes its own editor
experience around your draft; `"stock"` defers to pi's stock editor behavior
for text entry.

**Deep-view quality contract** — every deep-view field (`description`, option
`ramification`) must stand alone: the schema and the tool's resident
guidelines instruct the model to *expand* the explanation it would normally
give — define terms and acronyms, state concrete facts, lay out trade-offs —
assuming you have not seen the conversation, instead of pasting its working
shorthand. Nothing is length-limited or linted — content of any size passes
through verbatim (CAPS-OUT-001).

## Configuration

All settings live under a top-level `"interrogator"` key in either
`~/.pi/agent/settings.json` (global) or `<project>/.pi/settings.json`
(project). Defaults (JSONC, with the meaning of each field):

```jsonc
{
  "interrogator": {
    // Accelerators, in pi's lowercase form (bare letters or chords like "ctrl+s").
    "keys": {
      "deep": "d",                // open the deep-dive (ramification) view
      "overview": "o",            // open the question overview list
      "elaborate": "t",           // enter the editor (elaboration / write-in duty)
      "batchNote": "m",           // attach a batch note
      "submit": "ctrl+s",         // submit answers (partial ok; gate-hold override)
      "chat": "e",                // open the in-panel side chat on the current question
      "externalEditor": "ctrl+g", // open the draft in an external editor
      "prevQuestion": "tab",      // previous question
      "nextQuestion": "shift+tab" // next question
    },
    // No caps: question count, option count, and text lengths are all
    // unlimited — nothing is truncated or dropped (CAPS-OUT-001).
    "gateWarnings": true,           // FR-9: gate warnings — the submit-time "later answers may shift" line AND the auto-submit hold line (display-only, never blocks)
    "roundDetection": true,         // detect interrogation rounds from plain chat text (TUI)
    "compactionPreservation": true, // prepend preservation instructions to mid-interrogation compaction summaries
    "editorMode": "composed",       // "composed" (panel's own editor) or "stock" (pi's stock editor)
    "sideChatModel": "",            // optional "provider/model-id" for the side chat (default: the session's current model)
    "sideChatAutoApply": false      // apply the side chat's converged answer without the confirm row
  }
}
```

- **Precedence**: defaults ← global `~/.pi/agent/settings.json` ← project
  `.pi/settings.json` (project wins). Nested objects (`keys`) merge
  per-key; scalars replace.
- **Tolerant loading**: missing files, malformed JSON, non-object bodies, and
  ill-typed keys contribute nothing — the default survives and loading never
  throws. `"true"` / `"false"` strings coerce to booleans; unknown
  `editorMode` values fall back to `"composed"`.
- **Labels follow config**: every displayed string that names a key — footer,
  widget, dialogs — is generated from the resolved config, so a remap shows up
  consistently everywhere.
- **Renamed key, silent alias**: the editor action's config key is now
  `elaborate` (it enters the editor for elaboration/write-in duty). A
  pre-rename `focus`-text binding from an older config is silently honored as
  `keys.elaborate` when the new name is not rebound.

## Keymap

Remappable actions (`interrogator.keys.*`):

| Action               | Config key            | Default         | Effect                                        |
| -------------------- | --------------------- | --------------- | --------------------------------------------- |
| Deep-dive view       | `keys.deep`           | `d`             | Open the deep-dive (ramification) view        |
| Overview list        | `keys.overview`       | `o`             | Open the question overview list               |
| Elaborate            | `keys.elaborate`      | `t`             | Enter the editor — duty follows context (elaboration on a selected option, write-in on the `✎ Other` row or a text question); **works in the short AND deep views** — in deep, the editor pins below the pane (the pane stays as context); close via `enter` or double-`esc` (a re-pressed `t` types the letter) |
| Batch note           | `keys.batchNote`      | `m`             | Attach a batch note shipped with the next submit; close via `enter` or double-`esc` |
| Submit               | `keys.submit`         | `ctrl+s`        | Submit answers now (partial ok — also the deliberate override while the gate hold blocks auto-submit) |
| Side chat            | `keys.chat`           | `e`             | Open the in-panel side chat on the current question — in the overview, on the cursor row's question (one chat at a time; applies converged answers through the confirm row) |
| External editor      | `keys.externalEditor` | `ctrl+g`        | Open the draft in an external editor — any editor duty (answer, elaboration, or note; in note duty the finished text lands in the batch note) |
| Previous question    | `keys.prevQuestion`   | `tab`           | Move to the previous question                 |
| Next question        | `keys.nextQuestion`   | `shift+tab`     | Move to the next question                     |

Fixed keys (not configurable):

| Key      | Effect                                              |
| -------- | --------------------------------------------------- |
| `enter`  | Accept + advance; confirm dialogs; on a text question's `✎ answer…` affordance it opens the editor (write-in duty); in the editor, per duty: COMMIT the answer (write-in on `✎ Other` / text questions — commit-at-enter), save + return to options (elaboration/note) |
| `esc`    | Back / suspend — descends, never destroys. While the text/note editor is focused, a single `esc` goes to the editor (vim modes); `esc` twice in a row (within `escExitWindowMs`, default 500 ms, `0` disables) closes the editor only |
| `ctrl+c` | Closes the prompt (suspend) — the in-flight text is written to its question's draft first (R4) — and stays unconsumed; pi's own ctrl+c flow (clear editor; double-press shuts down) resumes on the restored editor |
| `↑` `↓` (+ `k` / `j`) | Move among options; scroll — view-aware (short option cursor including the `✎ Other` row; deep: selection; overview: cursor row). In the editor `↑`/`↓` move the caret; `k`/`j` type |
| `←` `→` (+ `h` / `l`) | Previous / next question — the FULL list (every status navigable, clamped at the ends), view-aware (overview: cursor row). In the editor `←`/`→` move the caret; `h`/`l` type |

The fixed family — `↑`/`↓`/`←`/`→` and their `h`/`j`/`k`/`l` aliases,
`enter`, `esc`, `ctrl+c` — is not configurable (R5 as amended: all NON-fixed
keys are remappable; the fixed family is the documented exception). hjkl
mirror the arrows exactly — identical view-aware navigation, identical
editor-focus forwarding. Remapping a config key ONTO a fixed key (e.g.
`"deep": "j"`) is deterministically shadowed by the fixed branch — choose a
free key.

Non-key option: `"escExitWindowMs": 500` under `"interrogator"` in settings —
the double-esc window for closing the embedded editor without suspending.

Every choice question's option list ends in a synthetic `✎ Other — write
your own` row (fixed last row — arrows reach it; number keys never select
it). Accepting
it puts the editor in the **write-in** duty (region labeled `OTHER — this
text is the answer`): what you type IS the answer — `enter` commits it as
`answer.value` with `custom: true`, and every surface that shows the answer
(submission diff cards, `{}` reads, the completion record and recap card,
the overview, and the short view on revisit — `✎` on the question line plus
a dimmed preview of the recorded value) renders it as `✎ {text}`. Focused
on a real option, the
editor is the **elaboration** duty: the text attaches to whichever option
you select and ships as the answer's text — an elaboration, not an answer
of its own. The shipped elaboration rides the model-visible delta
(`answer — text`) AND the diff card in full (FULL-TRANSCRIPT-001) — scroll
back to any submission card to reread exactly the elaboration you sent.
Accepting an option after a committed write-in supersedes the
answer and re-binds the kept slot text as elaboration — the re-bound text
is that question's draft (✎ marker; edit or clear it any time before it
ships), and on an already-complete set the same gesture can auto-submit it
verbatim, with no chance to edit first. On `type:"text"`
questions the editor is likewise the answer. Selecting options stays
available before/after elaborating. The editor's contents are
**per-question** — opening it on another question starts blank (or that
question's own saved draft); switching questions while typing saves the
text to its question automatically. Every editor exit is a draft
write-through (R4): question switches, `esc`, `ctrl+c`, the side chat,
note mode — typed-but-unsubmitted text always lands in its question's
draft; no exit gesture destroys it.

Navigation defaults: questions move with `←` / `→` (fixed keys, above) or
`tab` / `shift+tab` (`keys.prevQuestion` / `keys.nextQuestion`, remappable
above). Suspending is `esc`; resuming is `/interrogate` (invoke-only — never
a toggle, never a key combo).

While the panel is open, panel keys are intercepted before the embedded
editor sees them — in two tiers. Modifier-bearing config keys (`ctrl+s`,
`ctrl+g`) intercept everywhere, including while the editor holds focus: a
chord is never a typed character. Bare config keys (`d`, `o`, `t`, `m`, `e`)
and the fixed `h`/`j`/`k`/`l` are printable: they intercept only from
non-editor focus and always type while the editor holds focus — typing `t`
in an answer must insert a `t`. Number keys do nothing at panel level; they
only ever type inside the editor. A single `esc` and `↑`/`↓` forward to the
focused editor (caret movement, pi-vim mode exit).

### Subcommands (one command, no autocomplete noise)

`/interrogate` is the only command this extension registers — bare use
invokes the panel (opens or resumes it immediately; never a toggle, never
a key combo). It also carries the dev surface:

```
/interrogate ping                      # smoke test: extension loaded
/interrogate debug upsert <json>       # upsert via the tool's exact code path
/interrogate debug submit [id=value,…] # record answers + full submission path
/interrogate debug state               # status line + one line per question
```

Argument completion lists them (`/interrogate ` → `ping`, `debug`; …).
Unknown subcommands print a usage line — nothing ever throws.

## Side chat

Press `e` on any question to open the side chat — a short private
conversation about that one question, rendered inside the panel: a one-line
header (`chat · q3 — {prompt, truncated}`), a transcript with your lines
prefixed `you ›`, and its own input where `enter` sends and `shift+enter` /
`ctrl+j` inserts a newline. It never suspends the panel and never writes to
the main conversation — the model is reached through nested calls only,
using the session's current model at chat open (`sideChatModel` pins an
override; an invalid id notifies and falls back to the session model).
Like every bare key, `e` works from non-editor focus and types inside the
editor. The config key is `keys.chat` (default `e`); a settings file
carrying the pre-rename key name is silently honored — the same alias
precedent as the editor key's rename.

- **One chat at a time.** Opening `e` on another question aborts the
  current chat's in-flight reply, announces its usage, and replaces it
  without confirm. The chat is discarded when its question *becomes*
  answered or closed by any path (panel accept, write-in, the chat's own
  apply, moot/withdraw/upsert close) — a chat opened on an already-answered
  question survives unrelated changes (answers to other questions,
  re-asks), and a same-value re-answer keeps it. It survives
  suspend/resume (`esc`, then `/interrogate`).
- **Escape hatches.** `/clear` and `/new` — byte-exact first input tokens
  (a `/usr/bin` path is just a message) — reset the chat fresh on the
  current question. Resetting while a reply is streaming aborts the
  in-flight stream first and still fires the usage-close notice —
  unconditionally, even for a chat that never sent a token
  (`chat closed · 0 in · 0 out · $0.00`). While a reply is streaming,
  `esc` aborts it; when idle, `esc` leaves the view with the chat retained.
- **Converged answers.** The side model ends a converged reply with a
  fenced `answer` block (`{"value": …}` byte-matching an option, or
  `{"text": …}` for a write-in). The panel shows an inline confirm row —
  `apply ★ sqlite? · enter = yes · esc = no` — and the input blurs itself
  the moment the row appears, so `enter` and `esc` work right away in the
  default focused state — no pre-blur needed (unless you were mid-sentence
  typing a follow-up when the reply landed: the blur waits until the input
  is empty, and your next keystroke keeps typing). `enter` applies through
  the ordinary accept seams: ripple confirms, advance, auto-submit, and
  every record behave (and look) exactly as for a hand-made selection.
  Applying a value the question already has is a clean no-op: the confirm
  row is consumed and the chat closes with its usage notice — never a
  stuck `apply ★` row. The row belongs to the chat view: leaving it
  (overview, deep, esc) keeps the pending answer safely out of the way —
  `enter`/`esc` keep their documented meanings there — and returning to
  the chat re-renders it. `"sideChatAutoApply": true` skips the confirm.
- **Usage on close.** Any close or discard notifies compactly
  (`chat closed · 12.4K in · 3.1K out · $0.07`); chat usage never enters
  session stats.

While a reply is streaming, pressing `enter` is refused and your typed
text stays in the input — press `enter` again once the stream settles (or
abort the stream with `esc`) to send it. `/clear`, `/new`, and `enter` on
an empty buffer still clear the input. After the settle blur — or after
declining with `esc` — pressing `e` again re-focuses the chat input
without leaving the view or touching the transcript, so "keep chatting"
needs no exit-and-reopen.

The chat lives in extension memory only — nothing about it is written to
the session file — and it is TUI-only (inert in `pi -p` and other non-TUI
modes). See [Limitations](#limitations).

## Acceptance criteria (spec)

The acceptance list lives in
[`spec/product-requirements.md`](spec/product-requirements.md); this delta
extends it to 2a–2d, 15, 16, and 17. Summary (scripted where possible — see
the spec for the full text and the scripted tests proving each):

1. Model upserts questions across groups with one gate group → panel opens; gate focused; other groups dimmed but answerable.
2. Partial `ctrl+s` → compact delta + reminder; epoch bumps; remainder stays open.
2a. **Write-in (WRITEIN-001)**: accept `✎ Other`, type, `enter` → `answer.value = <text>`, `custom: true`, no option selected; card/delta render `✎ {text}`.
2b. **Elaboration (WRITEIN-001/002)**: `t`, type, `enter` → draft saved, still unanswered; option accept attaches it as `answer.text`; a real option after a committed write-in re-binds the slot as elaboration.
2c. **Auto-submit (AUTOSUBMIT-001)**: answering the LAST question ships with no keypress beyond the answer (`submitted — {n} answer(s)`); editing while complete ships the edit immediately.
2d. **Gate hold (AUTOSUBMIT-002)**: with a gate question unanswered, commits show `⚠ … foundational unanswered` and do NOT auto-submit; answering it releases the next commit; `ctrl+s` submits anyway.
3. Agent reply closes answered questions / re-asks preserve drafts; a re-asked question re-confirms on same-value `enter`.
4. Break out → widget with counts → side chat → agent `{reopen:true}` → panel returns, drafts intact.
5. Deep view: scroll ramifications (incl. the Other section), select from deep view → stays in deep view on the advanced-to question (DEEP-STICKY-ADVANCE).
6. Contradicting a `dependsOn` → dependent greys as moot instantly, with the real reason (`moot: {dep}={value}`); overview shows ⊘.
7. Edit invalidating dependents → confirm dialog; esc cancels cleanly.
8. Stale upsert (wrong `rev`/`epoch`) → rejected with current text/rev; re-apply heals.
9. Restart pi mid-interrogation → NO panel appears (SURFACE-002); the widget line shows live counts; `/interrogate` reopens restored state; drafts gone (documented); pending answers ship on the next commit or submit (AUTOSUBMIT-001).
10. `/compact` mid-interrogation → preservation flow; state reconstructs from the append-only mirror.
11. `pi -p` print mode → numbered markdown digest; `answers[]` records chat answers; completion record on settle.
12. Every default hotkey remappable; footer/widget strings reflect the remap.
13. Editing an archived answer re-marks it pending; a different choice raises the same invalidation confirm as a live edit; the next diff card highlights the change.
14. All questions closed → completion record injected once; recap card in transcript.
15. **Reads never surface (SURFACE-001)**: a model `interrogate({})` read completes → panel stays closed, editor untouched — for live, all-answered, and completed states alike.
16. **Answer pinning (ANSWER-PIN-001)**: revisit an answered question → caret + highlight sit on the recorded answer (★ visible on its own row, never owning the caret); `enter` on the recorded value is a zero-state-change advance and a byte-identical write-in re-commit is inert — except on a re-asked question, where same-value `enter` (or a byte-identical write-in) re-confirms and ships; a DIFFERENT choice raises the FR-18 invalidation confirm.
17. **Side chat (SIDECHAT-001)**: `e` opens the per-question in-panel chat (in the overview, on the cursor row's question); a streaming reply aborts with a single `esc` in the default focused state; `enter` on a refused mid-stream send keeps the typed input; a converged answer shows a confirm row that works immediately (the input self-blurs on settle) — `enter` applies indistinguishably from a panel selection and a same-value no-op apply consumes the row and closes the chat; `/clear` and `/new` reset the chat, aborting any in-flight reply with the usage notice always firing (zero usage included); the chat dies when its question becomes answered/closed and survives suspend/resume.

## Limitations

From the spec's confirmed non-goals — pi-interrogator does **not** do any of these:

> Answering by parsing chat text while the panel is open · multiple concurrent interrogations · images in answers · mouse input · cross-restart draft persistence (documented limitation) · modifying pi core (public extension APIs only) · per-request state injection (vetoed).

- Drafts are in-session only: they survive suspend/resume and panel
  close/reopen, but restarting pi mid-interrogation restores questions and
  submitted answers with their exact values — never in-progress drafts.
  Drafts of questions the agent re-asked survive a panel submit (only
  shipped answers flush).
- The side chat is ephemeral: it lives only for the session — restarting pi
  mid-interrogation restores questions and answers but never an open chat,
  and nothing about a chat is written to the session file.
- The side chat's view of the main conversation is snapshotted once at chat
  creation; submissions made while chatting do not refresh it (accepted v1).
- The side chat is TUI-only: in non-TUI modes `e` is inert (and without a
  model seam it opens with an inert notice).
- TUI-first: in non-TUI modes (`pi -p` print mode, rpc, json) there is no
  panel — the tool returns a numbered markdown digest that the model relays in
  chat, and you answer in your next message; once recorded, the interrogation
  closes and the completion record is injected when the agent settles
  (moot/withdrawn/closed questions are reported as ignored).
- Compaction: `/compact` mid-interrogation triggers the preservation flow
  (the summary is generated with the interrogation preservation instructions
  prepended) and state reconstructs afterwards from the append-only
  `interrogation-state` mirror. Reconstruction pools every state-carrying
  `interrogate` tool result, newest-first — if the newest one fails to
  deserialize, it degrades to the next-older valid result, so a single
  unreadable entry never loses the restoration.

## Development

```bash
npm install        # materialize devDependencies (vitest, typescript)
npm test           # vitest run
npm run typecheck  # tsc --noEmit
```

Debug commands (drive the same code paths the tool executor uses):

| Command                               | Effect                                                            |
| ------------------------------------- | ----------------------------------------------------------------- |
| `/interrogate ping`                   | Smoke test — proves the extension loaded                          |
| `/interrogate debug upsert <json>`    | Run the full upsert path from the keyboard (merge, stale handling) |
| `/interrogate debug submit id=value,…`| Flush answers and run the real submission path; `note=<text>` adds a batch note |
| `/interrogate debug state`            | Print the status line and one line per question                   |

Human acceptance runbook:
[`plan/001_0d6760db6bc5/MANUAL-TUI-AC-RUNBOOK.md`](plan/001_0d6760db6bc5/MANUAL-TUI-AC-RUNBOOK.md)

### Keymap conflict re-verification

Re-verified at build time on **2026-10-16** (commit `378b9ee`, the side-chat
changeset) against pi **1.0.2**
(`~/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/keybindings.md`)
and all installed extension trees (`~/.pi/agent/npm/node_modules`,
`~/.pi/agent/git`, `~/.pi/extensions`). Method:
`bash scripts/verify-keymap-conflicts.sh` — exit 0, all 9 defaults clear (the
run this section records). Result: **no default collides with a genuinely
global claim; `e` unchanged — passes untouched** (bare panel-owned letter, no
global claim possible). Drift since the 2026-10-14 record: none — the only
string-literal global registrations in the extension trees remain
pi-patty-bg-tasks' five (`src/shortcuts.ts:28-49`); pi-subagents' fleet-open
shortcut is still registered variable-indirectly (invisible to the
string-literal grep — re-checked manually; overlaps no interrogator key).

Verified defaults (`src/config.ts` `DEFAULT_CONFIG.keys`):

| Key (action)                                   | Status             | Owner / evidence                                                                                       |
| ---------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------ |
| `d` (`deep`)                                   | panel-owned        | bare letter — no global claim possible: the panel owns the whole keyboard while open, and bare keys never intercept in editor focus |
| `o` (`overview`)                               | panel-owned        | bare letter — same construction: collides with nothing in pi's or extensions' global vocabulary        |
| `t` (`elaborate`)                              | panel-owned        | bare letter — same construction                                                                        |
| `m` (`batchNote`)                              | panel-owned        | bare letter — same construction                                                                        |
| `e` (`chat`)                                   | panel-owned        | bare letter — same construction                                                                        |
| `ctrl+s` (`submit`)                            | panel-safe reuse   | pi: `app.session.toggleSort`, `app.models.save`, `app.thinking.save` (keybindings.md:141,154,156) — stays a chord: submit must fire from text focus, where a bare key could never be typed |
| `ctrl+g` (`externalEditor`)                    | panel-safe reuse   | pi: `app.editor.external`, `tui.altScreen.searchNext` (keybindings.md:115,129) — stays a chord: its only valid context is editor focus, where a bare key would have to type, never act |
| `tab` (`prevQuestion`)                         | fixed/nav (panel)  | pi: `tui.input.tab` (keybindings.md:65) — consumed inside the panel only                               |
| `shift+tab` (`nextQuestion`)                   | panel-safe reuse   | pi: `app.thinking.cycle` (keybindings.md:155) — shadowed by the panel                                  |

Fixed panel keys (`enter` / `esc` / `ctrl+c` / arrows + `hjkl` aliases) are
not config keys — they are consumed only while the panel is open (core
navigation pi regains as soon as the panel suspends). There is NO global
shortcut registration: the historical `breakOut` chord (`ctrl+shift+q`, via
`pi.registerShortcut`) was removed entirely — on many desktop environments
the window manager claims that chord to close windows before the terminal
ever sees the bytes.

Avoided keys — a default must never be set to any of these:

| Key                                          | Owner              | Evidence                                                      |
| -------------------------------------------- | ------------------ | ------------------------------------------------------------- |
| `ctrl+b`, `ctrl+shift+b`, `ctrl+shift+j`, `shift+down`, `ctrl+shift+x` | pi-patty-bg-tasks  | global `registerShortcut` calls (`src/shortcuts.ts:28-49`)    |
| `ctrl+shift+s`, `ctrl+shift+w`               | pi-web-access      | `DEFAULT_SHORTCUTS` (`index.ts:99`), registered (`index.ts:1044/1057`) |
| `ctrl+m`                                     | terminal           | sends `\r` (carriage return) — unusable as a modifier chord   |
| `ctrl+shift+f`                               | pi built-in        | `tui.altScreen.search` — transcript search (keybindings.md:114) |
| `ctrl+shift+up` / `ctrl+shift+down`          | pi built-in        | `tui.altScreen.previousPrompt` / `nextPrompt` — transcript nav (keybindings.md:112,113) |

**Panel-intercept rationale**: interception is two-tier. Modifier-bearing
config keys (`ctrl+s`, `ctrl+g`, `shift+tab`) intercept everywhere in-panel —
pi's binding layer never sees them while the panel is open — so their
panel-safe reuse of pi built-ins costs nothing outside the panel. Bare
config keys (`d` `o` `t` `m` `e`) intercept only from non-editor focus and
always type in the editor, so they are panel-scope-only by construction —
and the panel owns the whole keyboard while open regardless
(`ctx.ui.custom()` raw-input dispatch; `src/panel/keys.ts` header, "Mode A —
the intercept rule"; wiring in `src/index.ts`). Collisions therefore exist
only while the panel is open and vanish on suspend.

**Regression guard** — before adding or rebinding any default key:

```bash
bash scripts/verify-keymap-conflicts.sh   # grep-based guard; exits nonzero on a taken key
```

The script re-parses `DEFAULT_CONFIG.keys` (bare letters and chords alike),
checks them against the avoided
list above AND a live grep for `pi.registerShortcut("<key>"` string literals
across the installed extension trees (pi's own docs/examples excluded). It
degrades to a warning — not a failure — when `docs/keybindings.md` is not
found, and only string-literal registrations are visible to the grep
(variable-indirect ones like pi-web-access/pi-subagents are covered by the
avoided list — re-check manually). `src/keymap-guard.test.ts` additionally
fails CI if any default lands on the avoided list or breaks pi's accelerator
grammar. Rule: any new default key MUST pass this script and a manual check of
pi's `docs/keybindings.md` before shipping.

## Project structure

```
src/
├── index.ts           # extension factory — registers command, tool, renderers, lifecycle, persistence
├── config.ts          # DEFAULT_CONFIG, settings loading / deep-merge / coercion, key labels
├── state.ts           # the single in-memory interrogation state (source of truth)
├── tool.ts            # the interrogate tool executor (parse → guards → merge → result)
├── tool-schema.ts     # typebox tool schema + parameter parsing
├── merge.ts           # upsert merge rules (by id) + markSubmitted
├── guards.ts          # rev/epoch staleness guards
├── results.ts         # pure result builders + shared status line
├── fallback.ts        # non-TUI markdown digest + chat answer recording
├── snapshots.ts       # snapshot ring + submission diff computation
├── delivery.ts        # submission delta builder + completion record + transport
├── lifecycle.ts       # auto-close engine (agent_settled close pass)
├── completion.ts      # one-time completion record injection
├── detect.ts          # plain-text round detection
├── compaction.ts      # compaction preservation guard
├── persistence.ts     # interrogation-state mirror (append-only audit trail)
├── reconstruct.ts     # state reconstruction: session start (silent install +
│                      # suspend-widget cue, SURFACE-002 — NEVER opens the panel)
│                      # + /tree navigation (silent branch follow —
│                      # NEVER opens/reopens the panel)
├── renderers.ts       # transcript cards (submission diff, completion recap, mirror markers)
├── command.ts         # /interrogate invoke command (open/resume — never toggles)
├── debug-commands.ts  # keyboard-driven debug commands (`/interrogate debug …`)
├── draft-store.ts     # in-session draft survival across panel open/close
├── external-editor.ts # external editor handoff
├── depends-on.ts      # question dependency / moot-ness data layer
└── panel/             # the TUI panel: layout, key routing, actions, views
                               # (short / deep / overview / chat), text field, gates,
                               # ripple confirm, suspend widget, terminal budget
    ├── sidechat.ts            # side-chat singleton store + lifecycle
                               # (open/replace/discard, /clear + /new reset,
                               # answer apply)
    ├── sidechat-engine.ts     # nested LLM loop: turn dispatch, streaming,
                               # abort, usage tally
    ├── sidechat-prompt.ts     # side-chat system prompt builder (question,
                               # goal, answers digest, answer protocol)
    ├── branch-snapshot.ts     # one-shot frozen branch replay feeding the
                               # chat's context
    ├── chat-view.ts           # chat view renderer: transcript window, stream
                               # cursor, footer + confirm row
    ├── panel.ts               # panel host: non-blocking custom() lifecycle
                               # (open / suspend / resume)
    ├── layout.ts              # pure renderers: header, question line, hints,
                               # footer
    ├── keys.ts                # config-driven raw-key dispatch (at most one
                               # action per input)
    ├── actions.ts             # named key-agnostic actions (cursor, accept,
                               # navigate, submit)
    ├── short-view.ts          # short view: options, recommendation star,
                               # write-in row, text affordance
    ├── deep-view.ts           # deep view: full question/options regions +
                               # scroll/selection model
    ├── overview.ts            # overview list: every question, cursor + jump
    ├── text-field.ts          # embedded free-text editor (composed editor or
                               # stock pi-tui Editor)
    ├── gate.ts                # soft gate: detection, unanswered counting,
                               # warning/hold strings, gate focus
    ├── ripple-confirm.ts      # dependsOn invalidation ripple confirm
                               # (forced accept/cancel)
    ├── suspend.ts             # suspend widget line + resume coordinators
    ├── terminal-budget.ts     # adaptive fallbacks for narrow terminals
    └── editor-preservation.ts # editor preserve/restore across open/close
```

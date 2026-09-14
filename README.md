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
2. Answer in the panel: move between questions with `tab` / `shift+tab`, pick
   an option with digits `1`–`9` or arrows + `enter`, press `ctrl+t` to focus
   the free-text editor, `ctrl+d` for the deep-dive view, `ctrl+l` for the
   overview, `ctrl+shift+m` to attach a batch note, `ctrl+g` to finish the
   draft in an external editor.
3. Press `ctrl+s` to submit. Partial submissions are fine — unanswered
   questions stay open. Each submit streams a compact delta message to the
   model (rendered as a diff card in your transcript).
4. Break out any time with `ctrl+shift+q`: the panel suspends, a widget with
   question counts stays visible, and you can run side chats. Resume via
   `/interrogate` or the same key — drafts intact; the model can also reopen
   the panel itself when it has follow-ups.
5. When every question is closed, the panel dismisses and the model receives
   **one full completion record** (a recap card lands in the transcript).

**Model behavior note** — the model drives the `interrogate` tool, not you: it
upserts questions (stable ids, `rev`-guarded), reads current state with `{}`,
receives your submissions as delta messages, and gets one full completion
record when the interrogation completes. Between submissions it reconciles
contradictions and re-asks only the questions materially affected. You answer
in the panel; you never invoke the tool.

With `editorMode: "composed"` (the default) the panel composes its own editor
experience around your draft; `"stock"` defers to pi's stock editor behavior
for text entry.

## Configuration

All settings live under a top-level `"interrogator"` key in either
`~/.pi/agent/settings.json` (global) or `<project>/.pi/settings.json`
(project). Defaults (JSONC, with the meaning of each field):

```jsonc
{
  "interrogator": {
    // Accelerators, in pi's lowercase form (e.g. "ctrl+shift+q").
    "keys": {
      "deep": "ctrl+d",             // open the deep-dive (ramification) view
      "overview": "ctrl+l",         // open the question overview list
      "focusText": "ctrl+t",        // focus the free-text editor
      "batchNote": "ctrl+shift+m",  // attach a batch note
      "submit": "ctrl+s",           // submit answers / close the panel
      "breakOut": "ctrl+shift+q",   // break out (suspend) / resume — also a global shortcut
      "discuss": "ctrl+shift+e",    // discuss the current question in chat
      "externalEditor": "ctrl+g",   // open the draft in an external editor
      "prevQuestion": "tab",        // previous question
      "nextQuestion": "shift+tab"   // next question
    },
    // Limits enforced by the interrogate tool.
    "caps": {
      "description": 1200,    // max characters for the free-text description answer
      "ramification": 600,    // max characters for ramification / deep-dive text
      "options": 7,           // max multiple-choice options per question
      "questions": 40,        // max questions in one interrogation
      "goal": 400,            // max characters for the goal statement
      "contextBudgetPct": 4   // max % of the context window budgeted for interrogator content
    },
    "gateWarnings": true,           // warn when a gate/cap truncates or drops content
    "roundDetection": true,         // detect interrogation rounds from plain chat text (TUI)
    "digitQuickSelect": true,       // allow 1–9 to quick-select an option
    "compactionPreservation": true, // prepend preservation instructions to mid-interrogation compaction summaries
    "editorMode": "composed"        // "composed" (panel's own editor) or "stock" (pi's stock editor)
  }
}
```

- **Precedence**: defaults ← global `~/.pi/agent/settings.json` ← project
  `.pi/settings.json` (project wins). Nested objects (`keys`, `caps`) merge
  per-key; scalars replace.
- **Tolerant loading**: missing files, malformed JSON, non-object bodies, and
  ill-typed keys contribute nothing — the default survives and loading never
  throws. Numeric caps given as strings (`"2000"`) coerce to numbers;
  `"true"` / `"false"` strings coerce to booleans; unknown `editorMode`
  values fall back to `"composed"`.
- **Labels follow config**: every displayed string that names a key — footer,
  widget, dialogs — is generated from the resolved config, so a remap shows up
  consistently everywhere.

## Keymap

Remappable actions (`interrogator.keys.*`):

| Action               | Config key            | Default         | Effect                                        |
| -------------------- | --------------------- | --------------- | --------------------------------------------- |
| Deep-dive view       | `keys.deep`           | `ctrl+d`        | Open/close the ramification view              |
| Overview list        | `keys.overview`       | `ctrl+l`        | Open the question overview list               |
| Focus text editor    | `keys.focusText`      | `ctrl+t`        | Focus the free-text editor                    |
| Batch note           | `keys.batchNote`      | `ctrl+shift+m`  | Attach a batch note shipped with the next submit |
| Submit               | `keys.submit`         | `ctrl+s`        | Submit answers (partial ok) / close the panel |
| Break out / resume   | `keys.breakOut`       | `ctrl+shift+q`  | Suspend to chat / resume — also a global shortcut |
| Discuss in chat      | `keys.discuss`        | `ctrl+shift+e`  | Discuss the current question in chat          |
| External editor      | `keys.externalEditor` | `ctrl+g`        | Open the draft in an external editor          |
| Previous question    | `keys.prevQuestion`   | `tab`           | Move to the previous question                 |
| Next question        | `keys.nextQuestion`   | `shift+tab`     | Move to the next question                     |

Fixed keys (not configurable):

| Key      | Effect                                              |
| -------- | --------------------------------------------------- |
| `enter`  | Accept + advance; confirm dialogs                   |
| `esc`    | Back / suspend — descends, never destroys           |
| `↑` `↓`  | Move among options; scroll                          |
| `1`–`9`  | Quick-select an option (when `digitQuickSelect` is on) |

Navigation defaults: questions move with `tab` / `shift+tab`
(`keys.prevQuestion` / `keys.nextQuestion`, remappable above).

While the panel is open, panel keys are intercepted before the embedded
editor sees them; everything else forwards to the editor.

## Limitations

From the spec's confirmed non-goals — pi-interrogator does **not** do any of these:

> Answering by parsing chat text while the panel is open · multiple concurrent interrogations · images in answers · mouse input · cross-restart draft persistence (documented limitation) · modifying pi core (public extension APIs only) · per-request state injection (vetoed).

- Drafts are in-session only: they survive suspend/resume and panel
  close/reopen, but restarting pi mid-interrogation restores questions and
  submitted answers — never in-progress drafts.
- TUI-first: in non-TUI modes (`pi -p` print mode, rpc, json) there is no
  panel — the tool returns a numbered markdown digest that the model relays in
  chat, and you answer in your next message.
- Compaction: `/compact` mid-interrogation triggers the preservation flow
  (the summary is generated with the interrogation preservation instructions
  prepended) and state reconstructs afterwards from the append-only
  `interrogation-state` mirror.

## Development

```bash
npm install        # materialize devDependencies (vitest, typescript)
npm test           # vitest run
npm run typecheck  # tsc --noEmit
```

Debug commands (drive the same code paths the tool executor uses):

| Command                               | Effect                                                            |
| ------------------------------------- | ----------------------------------------------------------------- |
| `/interrogate-ping`                   | Smoke test — proves the extension loaded                          |
| `/interrogate-debug-upsert <json>`    | Run the full upsert path from the keyboard (caps, merge, stale handling) |
| `/interrogate-debug-submit id=value,…`| Flush answers and run the real submission path; `note=<text>` adds a batch note |
| `/interrogate-debug-state`            | Print the status line and one line per question                   |

Human acceptance runbook:
[`plan/001_0d6760db6bc5/MANUAL-TUI-AC-RUNBOOK.md`](plan/001_0d6760db6bc5/MANUAL-TUI-AC-RUNBOOK.md)

### Keymap conflict re-verification

Re-verified at build time on **2026-09-13** against pi **0.85.1**
(`~/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/keybindings.md`),
all installed extension trees (`~/.pi/agent/npm/node_modules`, `~/.pi/agent/git`,
`~/.pi/extensions`), and the user rebinds in `~/.pi/agent/keybindings.json`
(cursor-left/right, pageUp rebinds only — none touch our keys). Result: **no
default collides with a genuinely global claim**. Drift since the planning
baseline: pi-patty-bg-tasks' shortcut lines moved (`shortcuts.ts:27-44` →
`:28-49`) and **pi-subagents now registers a global shortcut** (`ctrl+alt+f`,
fleet open — `src/shared/shortcuts.ts:3`, registered in
`src/slash/slash-commands.ts:978`); neither overlaps any interrogator key.

Verified defaults (`src/config.ts` `DEFAULT_CONFIG.keys`):

| Key (action)                                   | Status             | Owner / evidence                                                                                       |
| ---------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------ |
| `ctrl+d` (`deep`)                              | panel-safe reuse   | pi: `tui.editor.deleteCharForward`, `app.exit`, `app.session.delete`, `app.tree.filter.default` (keybindings.md:53,127,144,176) |
| `ctrl+l` (`overview`)                          | panel-safe reuse   | pi: `app.model.select`, `app.tree.filter.labeledOnly` (keybindings.md:151,179)                          |
| `ctrl+t` (`focusText`)                         | panel-safe reuse   | pi: `app.thinking.toggle`, `app.tree.filter.noTools` (keybindings.md:157,177)                           |
| `ctrl+s` (`submit`)                            | panel-safe reuse   | pi: `app.session.toggleSort`, `app.models.save`, `app.thinking.save` (keybindings.md:141,154,156)       |
| `ctrl+g` (`externalEditor`)                    | panel-safe reuse   | pi: `app.editor.external`, `tui.altScreen.searchNext` (keybindings.md:115,129)                          |
| `ctrl+shift+m` (`batchNote`)                   | free               | no pi default, no extension claim                                                                       |
| `ctrl+shift+q` (`breakOut`)                    | free               | no pi default, no extension claim (the one GLOBAL registration — verified unclaimed)                    |
| `ctrl+shift+e` (`discuss`)                     | free               | no pi default, no extension claim                                                                       |
| `tab` (`prevQuestion`)                         | fixed/nav (panel)  | pi: `tui.input.tab` (keybindings.md:65) — consumed inside the panel only                                |
| `shift+tab` (`nextQuestion`)                   | panel-safe reuse   | pi: `app.thinking.cycle` (keybindings.md:155) — shadowed by the panel                                   |

Fixed panel keys (`enter` / `esc` / arrows / digits `1`-`9`) are not config
keys — they are consumed only while the panel is open (digits have no pi
default; arrows/enter/esc are core navigation pi regains as soon as the panel
suspends).

Avoided keys — a default must never be set to any of these:

| Key                                          | Owner              | Evidence                                                      |
| -------------------------------------------- | ------------------ | ------------------------------------------------------------- |
| `ctrl+b`, `ctrl+shift+b`, `ctrl+shift+j`, `shift+down`, `ctrl+shift+x` | pi-patty-bg-tasks  | global `registerShortcut` calls (`src/shortcuts.ts:28-49`)    |
| `ctrl+shift+s`, `ctrl+shift+w`               | pi-web-access      | `DEFAULT_SHORTCUTS` (`index.ts:99`), registered (`index.ts:1044/1057`) |
| `ctrl+m`                                     | terminal           | sends `\r` (carriage return) — unusable as a modifier chord   |
| `ctrl+shift+f`                               | pi built-in        | `tui.altScreen.search` — transcript search (keybindings.md:114) |
| `ctrl+shift+up` / `ctrl+shift+down`          | pi built-in        | `tui.altScreen.previousPrompt` / `nextPrompt` — transcript nav (keybindings.md:112,113) |

**Panel-intercept rationale**: the panel-scoped defaults deliberately reuse pi
built-ins (`ctrl+d/l/t/s/g`, `ctrl+g` also text-focus, plus the fixed
enter/esc/arrows/digits/tab). This is safe because the panel owns raw keyboard
focus via `ctx.ui.custom()` and intercepts config keys BEFORE forwarding —
including in text focus — so pi's binding layer never sees those keystrokes
while the panel is open (`src/panel/keys.ts` header, "Mode A — the intercept
rule"; wiring in `src/index.ts`). Collisions therefore exist only while the
panel is open and vanish on suspend. The single genuinely GLOBAL registration
is `breakOut` (`ctrl+shift+q`, via `pi.registerShortcut` in `src/command.ts`),
which is why it must be, and was verified to be, fully unclaimed.

**Regression guard** — before adding or rebinding any default key:

```bash
bash scripts/verify-keymap-conflicts.sh   # grep-based guard; exits nonzero on a taken key
```

The script re-parses `DEFAULT_CONFIG.keys`, checks them against the avoided
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
├── tool.ts            # the interrogate tool executor (parse → guards → caps → merge → result)
├── tool-schema.ts     # typebox tool schema + parameter parsing
├── merge.ts           # upsert merge rules (by id) + markSubmitted
├── guards.ts          # rev/epoch staleness guards
├── caps.ts            # cap enforcement
├── results.ts         # pure result builders + shared status line
├── fallback.ts        # non-TUI markdown digest + chat answer recording
├── snapshots.ts       # snapshot ring + submission diff computation
├── delivery.ts        # submission delta builder + completion record + transport
├── lifecycle.ts       # auto-close engine (agent_settled close pass)
├── completion.ts      # one-time completion record injection
├── detect.ts          # plain-text round detection
├── compaction.ts      # compaction preservation guard
├── persistence.ts     # interrogation-state mirror (append-only audit trail)
├── reconstruct.ts     # state reconstruction on session start / branch
├── renderers.ts       # transcript cards (submission diff, completion recap, mirror markers)
├── command.ts         # /interrogate toggle + global break-out/resume shortcut
├── debug-commands.ts  # keyboard-driven debug commands
├── draft-store.ts     # in-session draft survival across panel open/close
├── external-editor.ts # external editor handoff
├── depends-on.ts      # question dependency / moot-ness data layer
└── panel/             # the TUI panel: layout, key routing, actions, views
                       # (short / deep / overview), text field, gates, ripple
                       # confirm, suspend widget, terminal budget
```

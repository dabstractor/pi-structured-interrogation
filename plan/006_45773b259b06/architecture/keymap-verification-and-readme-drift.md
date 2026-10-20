# Keymap verification toolchain + README drift inventory (2026-10-20)

## The verification script — `scripts/verify-keymap-conflicts.sh`

- Parses `DEFAULT_CONFIG.keys` live out of `src/config.ts` (`sed`/`grep` over the
  `export const DEFAULT_CONFIG` block — handles bare letters and chords alike).
- Checks each of the 9 defaults against:
  1. an 11-entry curated `AVOIDED` list (script lines 56–68): pi-patty-bg-tasks ×5,
     pi-web-access ×2, terminal `ctrl+m`, pi built-ins `ctrl+shift+f/up/down`;
  2. a **live grep** for `pi.registerShortcut("<key>"` across the extension trees
     `~/.pi/agent/npm/node_modules`, `~/.pi/agent/git`, `~/.pi/extensions`
     (string-literal first args only — known limitation; variable-indirect
     registrations are covered by the AVOIDED list).
- Pi built-in bindings (docs/keybindings.md) are INFO only — panel-scoped chords
  intentionally reuse pi built-ins (panel `custom()` consumes input first). Bare
  single letters are classified PANEL-OWNED **by construction** (no docs lookup):
  the panel owns the keyboard while open and the extension registers no global
  shortcut.
- Exit codes: 0 = all clear, 1 = collision, 2 = config unreadable.
- Sync guard: `AVOIDED` list is mirrored in `src/keymap-guard.test.ts:57–73`
  (verified in sync, both 11 entries).

## Fresh verified run (scout, 2026-10-20, HEAD 7377318) — EXIT 0

```
d (deep)           ok  panel-owned — bare letter, collides with nothing by construction
i (overview)       ok  panel-owned
e (elaborate)      ok  panel-owned
n (batchNote)      ok  panel-owned
ctrl+s (submit)    ok  panel-safe reuse — pi built-ins: app.session.toggleSort; app.models.save; app.thinking.save
c (chat)           ok  panel-owned
ctrl+g (externalEditor) ok panel-safe reuse — tui.altScreen.searchNext; app.editor.external
tab (prevQuestion) ok  panel-safe reuse — pi built-in: tui.input.tab
shift+tab (nextQuestion) ok panel-safe reuse — pi built-in: app.thinking.cycle
PASS: no default key collides with an avoided or extension-claimed key.
```

- pi install used: `~/.local/lib/node_modules/@earendil-works/pi-coding-agent`
  (version **1.0.2**); docs at `.../docs/keybindings.md`.
- String-literal global registrations in extension trees at run time: unchanged from
  the 2026-10-16 record (pi-patty-bg-tasks five, `src/shortcuts.ts:28-49`; plus the
  pi-subagents fleet-open constant noted in the old record's drift prose).

## README record block anatomy — `README.md:428–504`

Heading `### Keymap conflict re-verification` at :428; next heading
(`## Project structure`) at :505.

- :430 header — **STALE**: "Re-verified at build time on **2026-10-16** (commit
  `378b9ee`, the side-chat changeset) against pi **1.0.2**".
- :432–444 method prose (script, exit 0, "all 9 defaults clear", drift-since-2026-10-14
  prose, pi-patty-bg-tasks note) — :437 **STALE** claim "`e` unchanged — passes
  untouched" (predates KEYMNEMONICS-001; chat is now `c`).
- :446 "Verified defaults …:" + per-key table :448–456 — **STALE ROWS** :449–452 show
  `o`/`t`/`m`/`e`; must be `i` (overview) / `e` (elaborate) / `n` (batchNote) /
  `c` (chat). Rows :448, :453–456 (`d`, `ctrl+s`, `ctrl+g`, `tab`, `shift+tab`) correct.
- :458–465 fixed-panel-keys prose — fine.
- :466–475 avoided-keys table — matches the script's AVOIDED list; fine.
- :476–504 regression-guard section — :480 **STALE** letter set "(`d` `o` `t` `m` `e`)"
  must be "(`d` `i` `e` `n` `c`)".

## README surfaces that ALREADY match `src/config.ts:118–128` (do not churn)

- Sample settings block `README.md:147–179` (keys at :152–160) — 9/9 match.
- Keymap table header :194, rows :195–203 — 9/9 match (incl. :197 "a re-pressed `e`
  types the letter" — correct).
- Usage paragraph :37–38 and :288 "Press `c`…" / :297 "default `c`" — correct.

## README fossils OUTSIDE the record block (fix in the changeset sweep)

Elaborate `t` → `e` (KEYMNEMONICS-001 amendment):
- :45 "a re-pressed `t` just types the letter"
- :50 "`t` is not the only entry"
- :83 "the elaborations you attached with `t`"
- :263 bare-key set "(`d`, `o`, `t`, `m`, `e`)" → "(`d`, `i`, `e`, `n`, `c`)"
- :265–266 "typing `t` in an answer must insert a `t`"
- :358 AC 2b "`t`, type, `enter`"

Chat `e` → `c` (side-chat prose predates KEYMNEMONICS-001):
- :296 "Like every bare key, `e` works from non-editor focus"
- :301 "Opening `e` on another question aborts the…"
- :340 "pressing `e` again re-focuses the chat input"
- :375 AC 17 "`e` opens the per-question in-panel chat"
- :393 "in non-TUI modes `e` is inert"

## DO-NOT-TOUCH list (declared stale prose / historical records)

- `spec/product-requirements.md:84` (AC 2b `t`), `spec/implementation-plan.md:29`,
  `spec/ui-spec.md:94,:135` — PRD declares these fossils stale; spec is human-owned.
- `plan/004_49e25d5235a9/architecture/*.md` — past-changeset history (old d/o/t/m/e).
- No other non-spec/plan doc names a default key. No `docs/` dir exists.

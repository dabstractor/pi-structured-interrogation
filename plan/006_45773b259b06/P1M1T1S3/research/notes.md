# Research notes — P1.M1.T1.S3 (re-baseline + keymap re-verification covering the toggle default)

Live verified run on **2026-11-20** at HEAD **f2f5fdc** (repo
`/home/dustin/projects/pi-structured-interrogation`). All commands were
executed during this PRP's research session; the values below are facts, not
expectations. The implementing agent re-runs the same commands and records
what it observes (values may drift if HEAD moves again — record actuals).

## 1. HEAD and tree state

- `git rev-parse --short HEAD` → **f2f5fdc**
- Contract said "HEAD is ec61eb1+" — true but stale: two plan-bookkeeping
  commits landed after ec61eb1 (`2e681ca` tasks update, `f2f5fdc` prd_snapshot
  refresh). Neither touches src/, so counts are unaffected; still, record the
  live hash.
- `git status --short` → only plan/ bookkeeping (prd_index.txt,
  prd_manifest.txt, tasks.json modified; agents/ untracked). No src/README
  modifications.

## 2. Fresh gate counts (npm test / typecheck / lint)

- `npm test` → **Test Files 56 passed (56)** / **Tests 1679 passed (1679)**,
  exit 0, duration ~5.4s. Was 54/1624 at the S1/S2 baseline (eb09516) — the
  eight post-2026-10-19 rulings added 2 files / 55 tests.
  - File census: 32 `src/*.test.ts` + 24 `src/panel/*.test.ts` = 56.
- `npm run typecheck` (`tsc --noEmit`) → exit 0, no output.
- `npm run lint` (`eslint src scripts *.ts`) → exit 0.

## 3. Keymap verification — CRITICAL COUNT DISCREPANCY

`bash scripts/verify-keymap-conflicts.sh` → **exit 0**, and its summary line
says `Checked 11 default key(s)` — **ELEVEN, not the ten the work-item
contract claims**. The contract's "10th default (keys.toggle)" is off by one:
TWO keys landed after the 9-key S2 record —

- `x` (`expandDescription`) — commit 74ebe39 (DEEP-FULLSCREEN-001 /
  DUMP-ONCE-001)
- `ctrl+n` (`toggle`) — commit 70b08ff (PANELTOGGLE-001)

DEFAULT_CONFIG.keys (src/config.ts:140-152) has exactly 11 entries: deep d,
overview i, elaborate e, batchNote n, submit ctrl+s, chat c, externalEditor
ctrl+g, prevQuestion tab, nextQuestion shift+tab, expandDescription x,
toggle ctrl+n.

Verbatim per-key table from the live run:

```
KEY                STATUS    DETAIL
------------------ --------- --------------------------------------------------
d (deep)           ok        panel-owned — bare letter, collides with nothing by construction (custom() raw-input dispatch)
i (overview)       ok        panel-owned — bare letter, collides with nothing by construction (custom() raw-input dispatch)
e (elaborate)      ok        panel-owned — bare letter, collides with nothing by construction (custom() raw-input dispatch)
n (batchNote)      ok        panel-owned — bare letter, collides with nothing by construction (custom() raw-input dispatch)
ctrl+s (submit)    ok        panel-safe reuse — pi built-in(s): app.session.toggleSort; app.models.save; app.thinking.save
c (chat)           ok        panel-owned — bare letter, collides with nothing by construction (custom() raw-input dispatch)
ctrl+g (externalEditor) ok   panel-safe reuse — pi built-in(s): tui.altScreen.searchNext; app.editor.external
tab (prevQuestion) ok        panel-safe reuse — pi built-in(s): tui.input.tab
shift+tab (nextQuestion) ok  panel-safe reuse — pi built-in(s): app.thinking.cycle
x (expandDescription) ok     panel-owned — bare letter, collides with nothing by construction (custom() raw-input dispatch)
ctrl+n (toggle)    ok        global registration (PANELTOGGLE-001) — pi built-in app.session.toggleNamedFilter is picker-scoped; no focus overlap; extension wins at the main editor (startup diagnostic)
```

Classification census: 6 panel-owned bare letters (d i e n c x), 4 panel-safe
reuses (ctrl+s, ctrl+g, tab, shift+tab), 1 global registration (ctrl+n,
PANELTOGGLE-001, picker-scoped built-in owner — reported ok under its
picker-scoped-overlap classification, exactly as the contract requires).

`panelShortcut: true` confirmed at src/config.ts:157 (DEFAULT_CONFIG) with the
coercion at :277; `keys.toggle` is the 11th entry at :151.

## 4. Environment facts

- pi version: **1.0.2** (`grep -m1 '"version"'
  ~/.local/lib/node_modules/@earendil-works/pi-coding-agent/package.json`) —
  the same tree whose docs/keybindings.md the script's built-in INFO lookups
  consulted.
- Date: 2026-11-20.

## 5. Drift list (live string-literal registerShortcut claims)

```
~/.pi/agent/npm/node_modules/pi-patty-bg-tasks/src/shortcuts.ts:28:    pi.registerShortcut("ctrl+b", {
~/.pi/agent/npm/node_modules/pi-patty-bg-tasks/src/shortcuts.ts:34:    pi.registerShortcut("ctrl+shift+b", {
~/.pi/agent/npm/node_modules/pi-patty-bg-tasks/src/shortcuts.ts:39:    pi.registerShortcut("ctrl+shift+j", {
~/.pi/agent/npm/node_modules/pi-patty-bg-tasks/src/shortcuts.ts:44:    pi.registerShortcut("shift+down", {
~/.pi/agent/npm/node_modules/pi-patty-bg-tasks/src/shortcuts.ts:49:    pi.registerShortcut("ctrl+shift+x", {
```

Identical to the 2026-10-16/2026-10-20 baselines → **drift: []** (empty).
Filter `\.md:` out of the raw grep or bundled docs/extensions.md +
CHANGELOG.md prose examples (ctrl+x, ctrl+shift+p) pollute the list.

## 6. Downstream notes (for the record's drift[] metadata)

- The README "Keymap conflict re-verification" section now lives at
  **README.md:468** (NOT 428-504 as the T2.S1-era line refs claimed — the
  README has shifted). Its current text is triply inconsistent with config:
  says "all 9 defaults clear", tabulates 10 rows, config carries 11 (no `x`
  row). That rewrite is P1.M1.T2.S1's job; this record hands it the true 11-row
  data and the count reconciliation.
- src/keymap-guard.test.ts:32-38 already documents the PANELTOGGLE-001
  exception (ctrl+n deliberately NOT in AVOIDED because the built-in owner is
  picker-scoped).
- Supersedes the S1 baseline record {eb09516, 54, 1624} and the S2
  VerificationRecord {eb09516, perKeyStatus[9]}.

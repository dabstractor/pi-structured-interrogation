# Verdict — P1.M1.T2.S3: keymap cross-check extended to PANELTOGGLE-001 surfaces

**Verdict: 10/10 actions + panelShortcut — MATCH. No drift found. README.md untouched (verification no-op). DOCS line: `none — verification confirmed no user-facing change`.**

## 1. Baseline (Task 1, live)

- `git rev-parse --short HEAD` → **ffcf873** (2026-11-20 work session)
- `src/config.ts` live values (source of truth, read directly):
  - `DEFAULT_CONFIG.keys.toggle = "ctrl+n"` (config.ts:151 — last keys entry, declaration order confirmed)
  - `DEFAULT_CONFIG.panelShortcut = true` (config.ts:157)
  - `DEFAULT_CONFIG.keys` carries **ELEVEN** entries (incl. `expandDescription: "x"` — out of scope, see hand-off notes)
- Record-block state found: **STALE pre-S1** (Gotcha 3 second branch) — header reads
  "Re-verified at build time on **2026-10-20** at run commit `eb09516` … all 9 defaults clear",
  per-key table has **10 rows** (`ctrl+n` present, `expandDescription`/`x` absent).
  P1.M1.T2.S1's 2026-11-20/f2f5fdc/11-row rewrite has NOT landed in this tree.
  Per Gotcha 3: the block was NOT rewritten here; the present `ctrl+n` row was verified, and the
  stale header/count is flagged below for T3.S1/T3.S2.

## 2. Per-surface comparison — `keys.toggle` (value `ctrl+n`, field `keys.toggle`)

| Surface | Anchor (live line) | Observed | vs `src/config.ts` / T1.S3 record | Verdict |
| --- | --- | --- | --- | --- |
| A — sample settings (`## Configuration` jsonc) | README:166 | `"toggle": "ctrl+n"` + comment `// toggle the panel (in-panel: suspend; main editor: open/resume)`; LAST keys entry | value `ctrl+n` = config.ts:151; comment names BOTH legs; declaration order matches config | **MATCH** |
| B — keymap table (`## Keymap`, Remappable actions) | README:211 | `\| Toggle panel \| keys.toggle \| ctrl+n \| **Dual-surface toggle (PANELTOGGLE-001):** … \|` | field name + value exact; effect cell carries all four ui-spec h2.36 content points (below) | **MATCH** |
| C — record block per-key table | README:498 | `` `ctrl+n` (`toggle`) │ global (extension) │ pi: app.session.toggleNamedFilter (keybindings.md:139) — PICKER-SCOPED … `` | classification "global (extension)" + picker-scoped evidence = T1.S3's live record (plan/006_45773b259b06/P1M1T1S3/research/notes.md:60) verbatim-in-substance | **MATCH** |

### Surface B vs the four ui-spec h2.36 content points

1. **CLOSE LEG** — "inside an open panel, suspend it (any focus — the chord is never a typed character)": present; chord-as-tier-1-intercept framing; no bare-key-in-editor-focus promise. ✓
2. **OPEN/RESUME LEG** — "from pi's main editor, the globally registered shortcut opens or resumes the panel through the exact `/interrogate` invoke ladder (nothing resumable → the \"No active interrogation\" notice)": present. ✓
3. **GATE** — "The registration is gated by the `panelShortcut` toggle (default on)": present. ✓
4. **KEY SHARE** — "`ctrl+n` shares its key with pi's picker-scoped `app.session.toggleNamedFilter` — no focus overlap (pi logs one startup diagnostic; this extension wins at the main editor)": present. ✓

## 3. `panelShortcut` comparison (value `true`, field `panelShortcut`)

| Mention | Anchor | Observed | Verdict |
| --- | --- | --- | --- |
| Sample settings | README:174 | `"panelShortcut": true,` + `// register the keys.toggle global main-editor shortcut (PANELTOGGLE-001)` — camelCase, value matches config.ts:157 | **MATCH** |
| Keymap row gate | README:211 | gate named with default-on | **MATCH** |
| Dedicated section | README:301 | `"panelShortcut": false` to unregister + rebind example (`alt+q`) — gate scoped to the global registration; no conflation with the in-panel close leg | **MATCH** |
| Record fixed-keys prose | README:503-504 | "The ONE global shortcut registration is the `toggle` chord (`ctrl+n`, `keys.toggle` + the `panelShortcut` gate, default on — PANELTOGGLE-001): it fires from pi's main editor only." — matches expected text | **MATCH** |

## 4. Semantic net (verify-only) — implementation-evidence cross-check

- Dedicated section (README:294-303): dual-surface wording, in-panel suspend = "same exit as the
  `esc` ladder's end", `/interrogate` ladder + empty-state notice, `"panelShortcut": false`
  unregister guidance, `alt+q` rebind example, TUI-only (never fires in RPC/print modes). ✓
- Empty-state: "No active interrogation" shorthand is consistent with
  `EMPTY_STATE_MESSAGE = "No active interrogation — ask the agent to interrogate you"`
  (src/command.ts:51; src/shortcut.ts reuses the byte-identical string on its empty outcome). ✓
- src/shortcut.ts corroborates every README claim: ONE `pi.registerShortcut` on
  `parseAccelerator(config.keys.toggle)` (shortcut.ts:69), gated by `panelShortcut`
  (shortcut.ts:5,73-75 fallback path), main-editor-only; `toggleNamedFilter` is picker-scoped,
  not in RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS, one startup diagnostic, extension wins
  at the main editor. ✓
- Spelling census: zero instances of `Ctrl+N` / `ctrl-N` / `C-n` / `panel_shortcut` /
  `panelshortcut` anywhere in README.md (lowercase `ctrl+n` + camelCase `panelShortcut`
  everywhere, per Gotcha 5). ✓
- Anchor counts (Level 1): `"toggle": "ctrl+n"` = 1; `| Toggle panel ` = 1;
  `` `ctrl+n` (`toggle`) `` = 1; `"panelShortcut": true` = 1. ✓

## 5. Count reconciliation (Gotcha 1)

**10/10 actions + panelShortcut — MATCH.** The contract's "10" counts the 9 KEYMNEMONICS-001
actions verified by T2.S2 plus `toggle`. `DEFAULT_CONFIG.keys` actually carries **11** entries:
`expandDescription` ("x", 10th entry, commit 74ebe39) landed between the S2 record and
PANELTOGGLE-001 (`toggle`, 11th entry, commit 70b08ff). The 11th key is OUT OF SCOPE for this
task — see hand-off notes.

## 6. Hand-off notes for T3.S1 / T3.S2

1. **expandDescription ("x") residue**: `x` is absent from the README sample settings, keymap
   table, AND the record block's per-key table. That absence is REAL drift but belongs to the
   DEEP-FULLSCREEN-001/DUMP-ONCE-001 changeset — owned by P2.M1.T1.S2 (README residue audit) /
   P1.M1.T3.S1 (stale-fossil sweep). Deliberately NOT fixed here (Gotcha 2 scope guard held).
2. **Record-block state**: still the STALE pre-S1 block (2026-10-20 / `eb09516` / "all 9 defaults
   clear", 10 rows, `x` absent) at this task's HEAD `ffcf873`. P1.M1.T2.S1's rewrite
   (2026-11-20 / `f2f5fdc` / 11 rows) has not landed here. Per Gotcha 3 the block was NOT
   rewritten by this task; only its `ctrl+n` row was verified (MATCH against T1.S3's record).
   T3.S1's sweep must treat the header/count ("all 9" vs 11; missing `x` row) as known residue,
   not new drift introduced by T2.S3.
3. **Otherwise clean**: no other toggle/panelShortcut-related residue found in README.md
   (mention census :166/:174/:211/:296/:301/:498/:503-505/:512/:559 — all consistent).

## 7. Gates (Task 6, observed at ffcf873)

- `npm test` → **56 files / 1679 tests, all green** (matches T1.S3's f2f5fdc baseline actuals)
- `npm run typecheck` → exit 0, no output
- `npm run lint` → exit 0, no output
- `bash scripts/verify-keymap-conflicts.sh` → **exit 0**; summary "Checked 11 default key(s)";
  `ctrl+n (toggle)  ok  global registration (PANELTOGGLE-001) — pi built-in
  app.session.toggleNamedFilter is picker-scoped; no focus overlap; extension wins at the
  main editor (startup diagnostic)` — the documented toggle default is conflict-clear at this HEAD
- `git status --short` → tracked modifications: NONE by this task (README.md diff = 0 lines —
  byte-identical no-op); the only modified tracked file is the orchestrator-owned
  `plan/006_45773b259b06/tasks.json`. Untracked additions: this verdict.md (sole output artifact)
- src/keymap-guard.test.ts corroborates the contract: 11-key completeness list incl.
  `expandDescription` + `toggle` (:59-60) and the PANELTOGGLE-001 picker-scoped ctrl+n
  exception note (:32-36)

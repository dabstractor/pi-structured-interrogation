# Research notes — P1.M1.T2.S3 (PANELTOGGLE-001 surface cross-check)

Live state verified this session in `/home/dustin/projects/pi-structured-interrogation`
(git log HEAD: `ffcf873` — "P1M1T2S1 impl agent dispatched; task marked Complete";
working tree clean of src/README modifications).

## Source of truth (src/config.ts)

- `keys.toggle: "ctrl+n"` — :151, LAST of 11 keys entries
- `panelShortcut: true` — :157 (DEFAULT_CONFIG); coercion :277; doc rows :346/:372
- **11 keys total** (T1.S3 record): d i e n ctrl+s c ctrl+g tab shift+tab **x** ctrl+n.
  Contract's "10th default = toggle" is off by one: `expandDescription: "x"` (:150)
  is the 10th entry (DEEP-FULLSCREEN-001, commit 74ebe39); toggle is 11th
  (PANELTOGGLE-001, 70b08ff). "10/10" = 9 S2 actions + toggle.

## Surface census (README, line numbers at research time — re-anchor by grep)

| Surface | Line | Content | vs config |
|---|---|---|---|
| A sample settings `"toggle": "ctrl+n"` + dual-leg comment | :166 | ctrl+n, "in-panel: suspend; main editor: open/resume" | MATCH |
| A sample settings `"panelShortcut": true` + PANELTOGGLE-001 comment | :174 | true | MATCH |
| B keymap table `Toggle panel \| keys.toggle \| ctrl+n` row | :211 | all four ui-spec points (dual-surface, /interrogate ladder, "No active interrogation" notice, panelShortcut gate default on, picker-scoped toggleNamedFilter share) | MATCH |
| C record block `` `ctrl+n` (`toggle`) `` row | :498 | "global (extension)" + picker-scoped evidence | MATCH |
| Dedicated section `### Panel toggle shortcut (PANELTOGGLE-001)` | :294-303 | notice, `"panelShortcut": false` unregister, alt+q rebind, TUI-only | MATCH |
| Record fixed-keys prose (gate mention) | :503-504 | "keys.toggle + the panelShortcut gate, default on — PANELTOGGLE-001" | MATCH |

Semantic anchors: ui-spec h2.36 toggle row (4 content points) ✓ all present;
EMPTY_STATE_MESSAGE = "No active interrogation — ask the agent to interrogate you"
(src/command.ts:51) — README shorthand is faithful.

## Two findings that shaped the PRP

1. **S1 not landed**: record block still reads 2026-10-20 / eb09516 / "all 9
   defaults clear" with 10 rows (ctrl+n present, x absent) — the pre-rewrite text.
   PRP handles both branches (Gotcha 3): verify the ctrl+n row either way; never
   rewrite S1's block; flag staleness as dependency note.
2. **expandDescription `x` absent** from sample settings + keymap table — real
   drift but OUT of T2.S3 scope (DEEP-FULLSCREEN-001 residue; owned by
   P2.M1.T1.S2 / T3.S1). PRP scope-guards it (Gotcha 2) and mandates a hand-off note.

## Expected outcome

All toggle/panelShortcut surfaces match → verification no-op, DOCS: 'none —
verification confirmed no user-facing change'. Verdict artifact:
plan/006_45773b259b06/P1M1T2S3/research/verdict.md (10/10 + panelShortcut,
per-surface anchors, count-reconciliation + hand-off notes) for T3.S1/T3.S2.

Confidence 9/10 (residual risk: S1 record-block state, handled both ways).

# Keymap conflict re-verification run (changeset 005_af804251f18d)

- **Date:** 2026-10-16
- **Commit:** 378b9ee ("sidechat scripted AC-17 proof arrives; T2.S1 done")
- **Command:** `bash scripts/verify-keymap-conflicts.sh` → **exit 0**
- **Expected and observed:** `e` (`keys.chat`, SIDECHAT-001) **UNCHANGED and
  passes untouched** — bare panel-owned letter: no AVOIDED entry, no live
  `pi.registerShortcut` claim possible (the panel owns the whole keyboard while
  open via `custom()` raw-input dispatch; the extension registers no global
  shortcut). The script classifies it PANEL-OWNED by construction, same as
  d/o/t/m.

## Full default table (script PASS output, verbatim)

```
KEY                STATUS    DETAIL
------------------ --------- --------------------------------------------------
d (deep)           ok        panel-owned — bare letter, collides with nothing by construction (custom() raw-input dispatch; no global shortcut registered)
o (overview)       ok        panel-owned — bare letter, collides with nothing by construction (custom() raw-input dispatch; no global shortcut registered)
t (elaborate)      ok        panel-owned — bare letter, collides with nothing by construction (custom() raw-input dispatch; no global shortcut registered)
m (batchNote)      ok        panel-owned — bare letter, collides with nothing by construction (custom() raw-input dispatch; no global shortcut registered)
ctrl+s (submit)    ok        panel-safe reuse — pi built-in(s): app.session.toggleSort; app.models.save; app.thinking.save
e (chat)           ok        panel-owned — bare letter, collides with nothing by construction (custom() raw-input dispatch; no global shortcut registered)
ctrl+g (externalEditor) ok        panel-safe reuse — pi built-in(s): tui.altScreen.searchNext; app.editor.external
tab (prevQuestion) ok        panel-safe reuse — pi built-in(s): tui.input.tab
shift+tab (nextQuestion) ok        panel-safe reuse — pi built-in(s): app.thinking.cycle

Checked 9 default key(s) from src/config.ts against 11 avoided keys + live extension registerShortcut claims.
[Mode A] Bare-letter defaults (d/o/t/m/e) are panel-owned by construction: the panel owns the whole keyboard while open (custom() raw-input dispatch) and no global shortcut is registered — the AVOIDED list guards REBINDS onto taken chords, not the defaults.
Known limitation: the live grep sees string-literal registerShortcut arguments only; variable-indirect registrations are covered by the curated AVOIDED list (re-check manually when rebinding).
PASS: no default key collides with an avoided or extension-claimed key.
```

## Notes for the README refresh (P1.M3.T3.S1)

- The `e` row label is now `e (chat)` — the `### Keymap conflict re-verification`
  table row `| e (discuss) | panel-owned | … |` becomes `| e (chat) | … |` with
  this run's date + commit.
- `tab`/`shift+tab` and `ctrl+s`/`ctrl+g` remain panel-safe reuses (their pi
  built-in collision sets are unchanged from the prior run).
- No chord collision was found against the live extension tree — nothing to
  escalate to the owner.

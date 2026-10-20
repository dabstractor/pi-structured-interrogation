# Research — P1.M1.T1.S2 (plan 006): run verify-keymap-conflicts.sh, capture the fresh claim record

VERIFIED LIVE during this research session (2026-10-20, HEAD `eb09516`, clean tree):

## Live run output (exact)
```
KEY                STATUS    DETAIL
d (deep)           ok   panel-owned — bare letter (custom() raw-input; no global shortcut)
i (overview)       ok   panel-owned — bare letter
e (elaborate)      ok   panel-owned — bare letter
n (batchNote)      ok   panel-owned — bare letter
ctrl+s (submit)    ok   panel-safe reuse — pi built-ins: app.session.toggleSort; app.models.save; app.thinking.save
c (chat)           ok   panel-owned — bare letter
ctrl+g (externalEditor) ok panel-safe reuse — pi built-ins: tui.altScreen.searchNext; app.editor.external
tab (prevQuestion) ok   panel-safe reuse — pi built-in: tui.input.tab
shift+tab (nextQuestion) ok panel-safe reuse — pi built-in: app.thinking.cycle
Checked 9 default key(s) from src/config.ts against 11 avoided keys + live extension registerShortcut claims.
PASS: no default key collides with an avoided or extension-claimed key.
EXIT=0
```

## Script facts (read + executed)
- scripts/verify-keymap-conflicts.sh: parses DEFAULT_CONFIG.keys from src/config.ts; 11-entry AVOIDED list (pi-patty-bg-tasks ×5, pi-web-access ×2, ctrl+m terminal, pi built-ins ctrl+shift+f/up/down); live grep for `pi.registerShortcut("` across $HOME/.pi/agent/npm/node_modules, $HOME/.pi/agent/git, $HOME/.pi/extensions. Exit 0 clear / 1 collision / 2 config unreadable.
- Keybindings doc lookup: tries ~/.local/lib/node_modules/... and ~/.pi/agent/npm/node_modules/... layouts; INFO only for built-ins (panel-scoped reuse is intentional).
- Known limitation (script header): live grep sees STRING-LITERAL args only; variable-indirect registrations (pi-web-access DEFAULT_SHORTCUTS, pi-subagents Key.ctrlAlt) covered by AVOIDED.

## Live string-literal registerShortcut claims in the extension trees
Real registrations (source files): ONLY pi-patty-bg-tasks' five at src/shortcuts.ts:28/34/39/44/49 (ctrl+b, ctrl+shift+b, ctrl+shift+j, shift+down, ctrl+shift+x) — NO DRIFT since the 2026-10-16 record. (A raw grep also hits docs/*.md and CHANGELOG.md examples like ctrl+x / ctrl+shift+p inside bundled pi copies — those are documentation text, not registrations; the script/record must filter to source claim sites, e.g. exclude .md.)

## Environment
- pi install: ~/.local/lib/node_modules/@earendil-works/pi-coding-agent, package.json version 1.0.2 (confirmed).
- HEAD at research time: eb09516 (the item contract's "expect 7377318" is STALE — S1's PRP already flagged this; record the ACTUAL hash at run time).
- Date gate: run date must be post-2026-10-16 (research date 2026-10-20 qualifies).

## Deliverable shape (data only, no files)
VerificationRecord { date, headCommit (actual), piVersion: "1.0.2", perKeyStatus[9] (verbatim table rows), driftSince20261016: [] (only patty's five, unchanged), exitCode: 0 }.
If EXIT 1: ruling-level BUG — report and stop; do NOT rebind keys (contract §3).

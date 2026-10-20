# Research notes — bugfix P1.M2.T3.S1 (BUG-004 SURFACE-002 comment truth + guard)

## Verified facts (this session)

- **Offending text**: src/index.ts:148-149, inside the createReconstruction wiring block (~:142-160): "then split BY ORIGIN: session_start auto-opens the panel (TUI, FR-28) or sets the non-TUI digest fallback flag; session_tree is SILENT — …" The session_tree sentence and the drafts/resetState notes that follow are CORRECT and must stay verbatim.
- **Truth source (code)**: src/reconstruct.ts module JSDoc step 5 (~:95-110): "SURFACE-002 (FR-28 / FR-D7): the FR-28 panel auto-open is DISABLED ENTIRELY — session_start NEVER opens the panel. Reconstruction's ONLY UI act is the suspend widget line: updateSuspendWidget(ctx, state)… The panel returns only via the allow-list: /interrogate…, an agent upsert leaving unanswered questions, or {reopen:true}." Session-tree tail (~:620-640): retarget + suspend/updateSuspendWidget, `opened: false`. Non-TUI digest fallback flag still set — with no panel act.
- **Locked ruling**: spec/decisions.md:26 (SURFACE-002, 2026-09-19, "Disable auto-open entirely… nothing ever calls openPanel from session_start"); :25 = SURFACE-001 empty-box-after-esc data-loss trap context.
- **Guard precedent (raw-source scan)**: src/delivery.test.ts:285-295 "module hygiene" — `fs.readFileSync(new URL("./delivery.ts", import.meta.url), "utf8")` + regex; same pattern at guards.test.ts:534, merge.test.ts:348, results.test.ts:344, snapshots.test.ts:483, state.test.ts:484, tool.test.ts:861.
- **Anti-precedent**: no-hardcoded-keys.test.ts strips comments before scanning — must NOT be reused or the guard can't see the comment.
- **Pins to keep green untouched**: ac-panel.test.ts:794 (AC-9), reconstruct.test.ts:302/:756/:897, tree-nav-repro.test.ts, README.md:367 (already correct → no-op for P1.M3.T2.S2).

## Fix design

- Replace ONLY the session_start clause with: "session_start NEVER opens the panel (SURFACE-002/FR-28: silent install + suspend-widget line only; the panel returns only via /interrogate, an agent upsert, or {reopen:true})". Guarded literals: `SURFACE-002`, `NEVER opens the panel`; banned phrase: `auto-opens the panel` (exact, so the correct SURFACE-002 text can't false-positive).
- TDD: guard first (red against HEAD), comment fix, green.
- Placement: reconstruct.test.ts describe block (owns reconstruction pins) or a small dedicated file — either, with import.meta.url base verified.

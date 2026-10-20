# BUG-004 — stale SURFACE-002 wiring comment (src/index.ts) + conventions

## The stale comment
`src/index.ts:142-160`, the `createReconstruction` wiring block. The offending clause at
**index.ts:148-149**:
```
 * ... recompute moot-ness, then split BY ORIGIN: session_start auto-opens the
 * panel (TUI, FR-28) or sets the non-TUI digest fallback flag; session_tree
```
The session_tree sentence right after ("is SILENT — state follows the branch but NO
surface ever appears") is already correct — ONLY the session_start clause is stale
(pre-SURFACE-002 behavior, the opposite of the code).

## The truth it must match
- `src/reconstruct.ts` module JSDoc (~95-110): "SURFACE-002 (FR-28 / FR-D7): the FR-28
  panel auto-open is DISABLED ENTIRELY — session_start NEVER opens the panel.
  Reconstruction's ONLY UI act is the suspend widget line: `updateSuspendWidget(ctx,
  state)` ... The panel returns only via the allow-list: `/interrogate`, an agent upsert
  leaving unanswered questions, or {reopen:true}."
- Session-start tail (reconstruct.ts:627-636): comment + `updateSuspendWidget(ctx, state);
  return { source, replayed, opened: false, fallbackActive: false };`
- Locked ruling — `spec/decisions.md:26`: "SURFACE-002 — session-start auto-open is
  DISABLED ENTIRELY ('Disable auto-open entirely. I don't want it. The user needs to run
  /interrogate to get it back. It's annoying.') ... nothing ever calls openPanel from
  session_start — reconstruction's only UI act is the widget line."
- Root-cause context — spec/decisions.md:25 (SURFACE-001): "...pi's custom() snapshot/
  restore of editor text turned every such pop into the empty-box-after-esc data-loss
  trap." (Why a reader "fixing" the wiring from the comment could reintroduce the bug.)

## Replacement text (accurate, minimal diff)
Rewrite ONLY the session_start clause, e.g.: "then split BY ORIGIN: session_start NEVER
opens the panel (SURFACE-002/FR-28: silent install + suspend-widget line only; the panel
returns only via /interrogate, an agent upsert, or {reopen:true}); session_tree is
SILENT — ..." Keep the rest of the block verbatim.

## Static guard (PRD: "consider a static guard")
Pattern: raw-source `fs.readFileSync(new URL("./index.ts", import.meta.url), "utf8")` +
regex asserts (precedents: delivery.test.ts:287, guards.test.ts:534, merge.test.ts:348,
results.test.ts:344, snapshots.test.ts:483, state.test.ts:484, tool.test.ts:861).
Assertions: the createReconstruction wiring block no longer matches /auto-opens the
panel/ AND positively matches /SURFACE-002/ + /NEVER opens the panel/. CAUTION: scan RAW
source — no-hardcoded-keys.test.ts strips comments before matching; a comment guard must
NOT reuse that pipeline.

## Behavior pins (must stay green, no runtime change)
- src/panel/ac-panel.test.ts:794 — `describe("AC-9 — restart mid-interrogation: silent
  install + widget-only (FR-28, SURFACE-002)")` (asserts ui.custom never called from
  reconstruction; setWidget gets the cue — lines 866, 905, 966, 1008, 1176).
- src/reconstruct.test.ts:302, :756 (`expect(ctx.ui.custom as Mock).not.toHaveBeenCalled()`),
  :897. src/tree-nav-repro.test.ts pins tree-nav silence. README.md:367 (AC 9: "NO panel
  appears (SURFACE-002)") already documents the correct behavior.

## README changeset-doc map (for the final Mode B task)
- Restart/reconstruction (BUG-001 relevance): README.md:105 ("session restart/resume
  never opens it either"), :348-376 (Acceptance criteria; :367 AC-9 restart, :368
  /compact), :377-407 (Limitations; :384 restart restores questions, :402-404 reconstructs
  from append-only mirror), :526 (project-structure line for reconstruct.ts).
- Truncation claims (BUG-002): README.md:85 ("truncated, capped, or hidden"), :163
  (CAPS-OUT-001 nothing truncated).
- Auto-submit (BUG-003): README.md:359-360 (AUTOSUBMIT-001/002 rows).
- Commands: npm test / npm run typecheck / npm run lint. No docs/ dir; spec/ read-only.

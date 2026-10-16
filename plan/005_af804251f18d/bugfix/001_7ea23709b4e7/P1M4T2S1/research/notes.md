# Research notes — P1.M4.T2.S1 (bugfix round 001): cursor-row chat targeting (BUG-004)

- Chat dispatch: `src/panel/keys.ts` `b.chat` block — `if (bare.chat && editorFocused) return false; actions.onChat(panel); return true;` — no view/overview branch (contrast prev/next overview branches, and the elaborate `panel.view === "short"` gate).
- `routed.onChat` (panel.ts:1150): `const qid = p.currentId; if (qid === undefined || args.chatRebindDeps === undefined) return;` — then singleton reuse (same qid → setView) else abort-usage-notice + `openSidechatRecord(qid, ...)` (BUG-005/007 fix landed, P1.M3.T1.S1 complete). chatReturnView seeded from p.view in the setView path below (find via `grep -n "chatReturnView" src/panel/panel.ts`).
- Overview cursor: `panel.overviewCursor` public (panel.ts:709 default 0). `overviewJump` (overview.ts ~405-418) reads `ordered[panel.overviewCursor]` with `ordered.length === 0 → flash("no questions"), return true` and `q === undefined → return false` (out-of-range defensive). `stepOverviewCursor` (overview.ts ~363-376) NEVER touches currentId.
- No accessor exists for the cursor row's id (grep verified in item contract); only the inline read at overviewJump.
- Tests: keys.test.ts:405 `'e dispatches in ${view}'` loops views with makePanel({view, focus:"options"}), spies onChat only — stays green (dispatch unchanged; only qid resolution inside panel). Repro per PRD h3.3: panel on q1, `o`, ↓, `e` → questionId 'q1' (wrong).
- Guards unaffected: verify-keymap-conflicts.sh (config values only), no-hardcoded-keys/keymap-guard (b.chat stays config-driven).
- PRD preferred shape (h2.5 recommendation + item contract): target the cursor row (gating `e` out of the overview was the rejected alternative).

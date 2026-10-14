# Research notes — P1.M1.T2.S2 (remove re-press-to-close gestures for elaborate & note)

## Verified facts (working tree, line-exact)

1. **panel.ts OVERRIDE (~:645-648)** — `routed.onElaborate = (p) => {
     if (p.focus === "text") p.exitTextField(); else p.focusTextField(desiredTextDuty(p)); }`
   preceded by a comment block ("The re-press exit is duty-agnostic: save + blur,
   never a commit, from either duty (R4 write-through)") — the toggle arm + comment
   are the removal site. Becomes entry-only: `if (p.focus !== "text") p.focusTextField(desiredTextDuty(p));`
2. **keys.ts default onFocusText/onElaborate (:319-321)** — already entry-only:
   `onElaborate: (p) => { p.focus = "text"; }` (comment says M4.T1.S2 refines). No change
   needed there beyond comment hygiene if it mentions toggling.
3. **keys.ts onBatchNote (:322-328)** — toggle: `if (p.focus === "note") p.exitNoteMode();
   else p.enterNoteMode();` with comment "re-press while in note mode exits". Flatten to
   open-only with defensive focus guard.
4. **keys.ts :418 comment** — escWindow doc: "(escWindow === 0 disables the pair (every esc
   forwards; close via the ctrl+t toggle or enter)" — PURGE: close is enter or double-esc;
   also references ctrl+t (renamed 't'/elaborate) — rewrite. Also check the ESC-002 module
   JSDoc near :230-242 (escapeDescend + escExitEditor docs) for toggle mentions.
5. **Surviving closes** (verified): enter per-duty (writeInEnter commit / elaboration
   save+blur / note save+exit) and double-esc via escExitEditor (keys.ts :236-242 area,
   escExitWindowMs window) — independent of the removed toggles, gesture-removal-safe.
6. **S1 CONTRACT (parallel, Implementing)**: defaults flip to bare d/o/t/m/e and
   buildKeyRouter step 7 becomes two-tier — bare bindings FORWARD (route===false) while
   editor focus holds. So the exit arms become unreachable dead code from the DEFAULT
   keymap; they remain reachable ONLY via a chord REMAP (e.g. batchNote:'ctrl+shift+m'
   intercepts even in note focus). Hence: flatten arms AND keep a defensive idempotence
   guard rather than relying on unreachability.
7. **Test anchors to rework (current lines)**:
   - panel.test.ts :1964 `test_repress_exits_preserving_draft_and_reentry_reseeds_from_store`
     (BATCH_NOTE constant = old chord; note-mode re-press exit + reseed assertions)
   - panel.test.ts :2769 `ctrl_t_repress_exits_writein_duty_with_draft_write_through_never_commits`
     (CTRL_T re-press exit in write-in duty)
   - two-stage.test.ts :385 `test_note_draft_survives_esc_exit_and_reseeds_on_reentry` —
     esc-pair exit, NOT a toggle test → KEEP GREEN as-is (it's the new-exit pin)
   - two-stage.test.ts :413 `test_ctrl_shift_m_repress_exits_note_mode_preserving_draft`
     (kitty CSI-u re-press) → rework to "types, does not exit"
   - Note: panel.test constants CTRL_T/BATCH_NOTE may still encode OLD chord bytes;
     after S1's default flip they may already be broken/flipped by S1 — rework to the
     post-S1 default ('t'/'m') or panel-method-level calls (enterNoteMode/exitTextField)
     for the close-semantics tests.
8. **Exit-without-commit in WRITE-IN duty**: enter COMMITS there — the old re-press test's
   "never a commit" exit survives ONLY as double-esc in write-in duty. New test matrix:
   elaborate duty enter → save+blur; write-in duty double-esc → write-through, no commit;
   't' while text-focused → types (route false, buffer grows); 'm' while note-focused → types.
9. Downstream: P1.M1.T2.S3 footer stops advertising close hints; P1.M4.T1.S1 suite sweep.
   desiredTextDuty digit mention (~:276) is P1.M3.T1.S1's — leave.

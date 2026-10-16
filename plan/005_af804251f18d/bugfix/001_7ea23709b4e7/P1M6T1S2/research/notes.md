# Research notes — P1.M6.T1.S2 (spec/ui-spec.md minimal alignment pass)

## Spec map (verified line numbers, spec/ui-spec.md at HEAD)
- :108 `## Side chat` heading; :112 View & entry; :113 Singleton lifecycle; :114 Slash escape hatches; :115 Esc ladder; :116 Answer protocol; :117 Model & context; :118 Usage & close.
- Hotkey table row (in §Hotkeys, ~:84): `| side chat | e | keys.chat | non-editor focus — opens on the current question; opening on another question replaces the live chat (singleton) |` — also silent on overview targeting.
- Overview cursor-row convention: §Hotkeys :75-76 (`↑/↓` and `←/→` context cells say "overview: cursor row") and §Layout ~:20.
- test-infra-and-docs.md §spec map (:77-88): "Spec edits this round: MINIMAL — the code moves toward the spec, not vice versa."

## Landed fix shapes (from subtask PRPs — contracts)
1. **P1.M4.T2.S1 (BUG-004)**: overview branch in `routed.onChat` — `qid = view === "overview" ? overviewSelectedQuestionId(p) : p.currentId` (cursor row via `ordered[overviewCursor]?.id`; undefined → consumed no-op). GENUINELY NEW behavior not in spec → needs a clause at :112 and/or the hotkey table row.
2. **P1.M1.T2.S1 (BUG-001 streaming esc)**: chose shape (i) — chat-view esc rule OUTRANKS ESC-002 editor forwarding while streaming (single focused esc aborts; abortChatStream gates on streaming, idle falls through to forwarding). ui-spec:115 already says "Streaming: first `esc` aborts the in-flight reply" — implementation now matches spec verbatim. NO spec edit needed. (The hint-honesty alternative was not chosen.)
3. **P1.M2.T1.S1 (BUG-002)**: discard hook is transition-aware — discards ONLY on non-terminal→terminal; already-terminal-at-open chats survive unrelated mutations; ACCEPTED EDGE: same-status re-answers (answered→answered ripple edits, moot→moot churn) do NOT discard. Spec :113 says "DISCARDS when its question is answered or closed by ANY path" — the transition refinement + accepted edge deserves ONE parenthetical sentence.
4. **P1.M2.T2.S1 (BUG-003)**: apply on an already-terminal question consumes pendingConfirm and closes the view. Spec :113's "answered or closed by ANY path (… side-chat apply …)" already covers this (the fix brings code INTO compliance) — no edit.
5. **P1.M3.T1.S1 / P1.M3.T2.S1 (BUG-005/007)**: abort-before-replace/reset + usage notice on replace and /clear·/new. Spec :118 "any close/discard notifies compactly" — now actually true; NO edit (already documented).
6. **P1.M4.T1.S1 (BUG-006)**: buffer kept when sendTurn refuses. Spec is silent on this; it's a bug fix with no doc claim contradicting it — no edit needed (spec never said input was destroyed).
7. **BUG-001 confirm-row gestures (P1.M1.T1.S1/S2)**: :116 says "enter = yes · esc = no" — fixed behavior = spec. No edit.

## Sibling contract (P1.M6.T1.S1, in flight — README sync)
- README.md ONLY; explicitly forbidden from touching spec/. No overlap. ui-spec edits here must stay consistent with the README wording choices but spec/ is authoritative.

## Cross-check obligations
- spec/implementation-plan.md risk table ("esc aborts; singleton + one-shot snapshot cap the blast radius" — BUG-005 context): reference only; verify no row is invalidated by the new spec clauses (expected: none — abort-before-replace strengthens the mitigation, wording still true).
- Spec style: dense em-dash bullets, parenthetical caveat pattern like "(accepted v1)", decisions referenced by tag (e.g. "SIDECHAT-001", "BUG-004"). New clauses should carry the bug tag for traceability, matching how existing amendments are written (e.g. "renamed from keys.discuss — the focusText→elaborate precedent").

## Validation commands (project)
`npm test`, `npm run typecheck`, `npx eslint .` (docs-only change — must stay green; no code touched).

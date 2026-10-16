# P1.M6.T1.S1 research notes — README sync for bugfix round 001

## Docs map (architecture/test-infra-and-docs.md §Docs map, :56-70)
README headings + line anchors:
- `## Configuration` :133 (`sideChatAutoApply` :161, `escExitWindowMs`)
- `## Keymap` :181 — the `e` / `keys.chat` row :192
- `## Side chat` :275 — PRIMARY section (confirm row ~:301-306, `/clear` :295, usage-close :307)
- `## Acceptance criteria (spec)` :314 (AC-17.x mirror — AC 16 "Answer pinning" tail mentions same-value enter; side-chat AC text lives in spec/product-requirements.md AC-17.x)
- `## Limitations` :342
- `## Development` :370 (gates incl. verify-keymap-conflicts.sh — no changes)
- double-esc wording also at README :216 (escExitWindowMs note, editor context — NOT the side-chat workaround; leave it)

## Stale claims found in README (grep 'confirm row', 'double-esc', 'chat closed', '/clear')
1. §Side chat :279-281 "One chat at a time" — says chat "discarded automatically when its question is answered or closed by any path". Post P1.M2.T1.S1: discard fires only on a non-terminal→terminal TRANSITION; chats on already-answered questions survive unrelated mutations and same-status re-answers. Also missing: replacement now aborts the replaced stream + fires usage notice (M3.T1.S1).
2. §Side chat :295 `/clear`/`/new` — missing: reset aborts an in-flight stream + fires the usage-close notice (M3.T2.S1); zero-usage policy = unconditional notify even at `0 in · 0 out · $0.00`.
3. §Side chat :296 "While a reply is streaming, `esc` aborts it" — NOW TRUE in the default focused state (M1.T2.S1, shape (i): single esc aborts while `view === "chat"` and streaming; no double-esc needed). Wording is already correct — verify, don't change.
4. §Side chat confirm row :301-305 — gestures enter/esc now work in the DEFAULT focused state (M1.T1.S1: decision-bearing settle blurs the chat input). Missing: same-value no-op apply consumes the confirm and closes the chat (M2.T2.S1); refused send preserves typed input (M4.T1.S1 — buffer kept when enter pressed mid-stream).
5. §Keymap :192 `e` row — needs the overview clause: in the overview, `e` opens the chat on the CURSOR ROW's question (M4.T2.S1).
6. §Limitations :342+ — reconstruction degradation: add/adjust that deserialize failures degrade to the next-older state-carrying tool result (BUG-008 fix — every state-carrying interrogate tool result is pooled newest-first).
7. §Acceptance criteria :314 — AC-17.x side-chat behavioral items mirror the fixes (17.4 tail: no-op apply consumes; esc-abort in default state; input preservation). Keep the summary honest vs. spec deltas.

## Final behaviors to document (from landed subtask PRPs, treated as contract)
- M1.T1.S1: decision-bearing settle (pendingConfirm appears) BLURS chat input → confirm row's enter/esc work with no pre-blur; no double-esc workaround needed.
- M1.T2.S1: streaming esc in chat view = single `esc` aborts (footer hint now true); idle esc leaves view with chat retained.
- M2.T1.S1: discard hook is transition-aware (non-terminal→terminal). Same-status re-answers keep the chat.
- M2.T2.S1: no-op same-value apply → consumes pendingConfirm, discards chat, closes view, usage notice once.
- M3.T1.S1: `e` on another question → abort replaced stream, usage notice (unconditional, zero-usage included), then replace.
- M3.T2.S1: `/clear`·`/new` → abort in-flight stream + usage notice, then reset. Zero-usage policy: notify even `chat closed · 0 in · 0 out · $0.00`.
- M4.T1.S1: enter mid-stream refuses + PRESERVES the typed buffer; re-press after settle (or abort) sends it. Command path + empty buffer still clear.
- M4.T2.S1: overview `e` → cursor-row question via `overviewSelectedQuestionId(panel)`.
- M5.T1.S1: reconstruction pools EVERY state-carrying interrogate tool result, newest-first; deserialize failure degrades to next-older candidate.

## Gates (unchanged, final check)
npm test · npm run typecheck · lint · scripts/verify-keymap-conflicts.sh — README-only change must keep these green (it will; no code touched).

## Verification greps to run post-edit
grep -n 'confirm row\|double-esc\|chat closed\|/clear' README.md — ensure no stale gesture claims remain outside the editor-context double-esc note (:216, correct).

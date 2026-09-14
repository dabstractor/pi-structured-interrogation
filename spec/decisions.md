# Decision Ledger — extracted from the structured interrogation session

Every decision that shaped this spec, with its disposition. (Full deliberation history intentionally discarded; decisions below are authoritative.)

## Architecture & data flow
- Q1 non-blocking tool · Q2 custom message + renderer (digest to model, card from details) · Q3 one-line digest per answer (superseded: deltas) · Q4 card per submission · Q5 tool-result details canonical · Q6 auto-reopen panel on restart; drafts not persisted v1 · Q7 one active set · Q8 merge rules 1-4 (same-id/same-options silent update; changed options reset + re-ask; new appended; omitted withdrawn) · Q9 close after agent_settled on the reply, unless re-asked; aborts count.
- State delivery redesign (user-directed): extension JSON is source of truth; submissions are deltas + reminder; model pull-refreshes via read; full record injected once at completion; per-request context injection vetoed.
- Compaction: goal field + session_before_compact customInstructions (preserve user plan statements verbatim) + entry backup mirror; no injection machinery.

## UI
- Q10 replace-editor panel (non-overlay custom) · Q11 suspend + reminder widget · Q12 agent-judgment reopen via `{reopen:true}`, no guard, widget always visible · Q13 hotkey map approved, ALL configurable; ctrl+b avoided (patty-bg-tasks), ctrl+m avoided (\r); panel intercepts its keys before embedded editor · Q14 enter = accept + advance · Q15 recommendations marked ★ + preselected (no bulk-accept) · Q16 types: choice, text, explain-field on any · Q17 compose user's active editor via getEditorComponent(); two-stage enter · Q18 ctrl+g $EDITOR seeded with draft · Q19/Q20 merged: one deep toggle; short form default with first-sentence hint; deep view = full replacement (description + all ramifications, sticky option headers, scrollable, selectable); sticky while panel open · Q21 footer counter + ctrl+l overview with jump · Q22 esc descends, never destroys · Q23 immediate submit + card · Q24 answers editable even archived; supersede via delta + latest-wins contract · Q32 soft gate: visible + answerable, gate focused, later dimmed, submit warning.
- Hard requirements: R1 navigation freedom · R2 unmistakable recommendation marks · R3 batch note (held until submit) · R4 draft preservation (from ask_user evaluation: state loss on revisit is disqualifying) · R5 all hotkeys configurable, no exceptions.

## Protocol
- Q25 one tool, four action shapes (upsert / read / reopen / fallback-answers) · Q26 always-active description ≤120 words + 2 bullets (chosen over session-scoped: cache stability + discoverability) · Q27 soft caps, configurable, scaled by question count + ctx.model.contextWindow · Q28 instruction-only return, never terminate:true · Q29 non-TUI: numbered markdown digest, user answers next prompt, model records via answers · Q30 completion = full record injection; naming pi-interrogator / interrogate / /interrogate · Q31 guidelines + light plain-text-round detection nudge (throttled, non-transforming) · Q33 agent prunes between submissions (semantics) · Q34 moot/withdrawn dimmed with reason, kept in map · Q36 discuss-in-chat handoff (preloads question into editor) · Q37 goal field + compaction instructions + backup mirror.
- 2026-09-14 bugfix pin (Q7 clarification): a new interrogation after completion REPLACES the completed singleton — fresh state, epoch 1, completed=false, empty questions/snapshots; goal retained unless the new upsert supplies one. Resolves the gap flagged in architecture/spec-contracts.md § "Second interrogation in one session / epoch semantics after completion" (epoch-reset-on-new-interrogation was UNSPECIFIED); consistent with state-and-persistence.md § "Auto-close algorithm" "clear in-memory state" — the exactly-once completion guard is per interrogation lifecycle, not per session.

## Staging philosophy (discussion resolution)
- Gate the interaction, never the commitment: all questions sent in the first upsert (anti-loss anchor); grouping is display+focus only; contradictions self-heal via re-ask; contract carries broad-first ordering.

## Defaulted (user may veto)
- Q38 = A: rev + epoch guards (both). Rationale: user's own file-tool analogy (read-before-write, exact-oldText).
- 2026-09-14 bugfix pin (Q38=A clarification): epoch is REQUIRED only when an upsert touches existing question ids; the first upsert of an interrogation (all-new ids) may omit it. tool-protocol.md § Guards ("any questions/answers call must carry the session epoch") reads stricter than intended — rev+epoch guards protect against stale UPDATES, not fresh sets.
- Q39 = B: dependsOn in v1 → edit-time ripple confirm with forced accept/cancel. Rationale: user explicitly specified this UX.

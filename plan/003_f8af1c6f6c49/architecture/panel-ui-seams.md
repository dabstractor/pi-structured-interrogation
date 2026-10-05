# Panel UI seams — verified 2026-10-05 (supersedes 002 anchors for this delta)

All line anchors re-verified against working tree (HEAD c7d44c0).

## Cursor seeding (FR-D8)
- `src/panel/short-view.ts:119` — `export function initialCursorIndex(q: Question): number`. TODAY: status-agnostic ★ preselect — returns display row of `recommendation` regardless of `q.answer`. Comment block ~22-28 ("wanders; initialCursorIndex ALSO preselects it…") + ~117-123 = the "WHY ★ AND PRESELECT COEXIST" block to rewrite.
- `displayOptions` (short-view.ts) implements D-R13 recommended-first DISPLAY order — pinning must map `answer.value` → DISPLAY row through this order (not raw `options` index).
- ✎ `Other` write-in row sits at index `options.length`; write-in dim preview already renders (BUG-005).
- Accent highlight on the recorded answer's row already exists (`32a1f6e`) — visual half done; caret placement is NOT.
- Seed sites inherit `initialCursorIndex` automatically; only comments change:
  - `src/panel/panel.ts:354` — `set currentId(id: string | undefined)` seeds cursor.
  - `src/panel/panel.ts:~888-896` — editor-close re-seed (EXPLAIN-003 site; comment claims "next enter should ACCEPT the recommendation").
  - `src/panel/deep-view.ts:568` — `deepSeedCursorIndex(q: Question | undefined): number`; clamp bound `count` already tolerates the ✎ index.

## Accept paths (FR-D9)
- `src/panel/actions.ts:196` — `digit` routes through `return acceptOptionIndex(panel, q, n - 1)` → inherits any no-op short-circuit.
- `src/panel/actions.ts:244` — `acceptOptionIndex(panel, q, optionIndex): boolean`; `:255` ripple seam `if (!panel.confirmRippleEdit(q.id, proposed)) return true; // seam vetoed`; `:265` `maybeAutoSubmit(panel, undefined, { wasUnanswered, questionId: q.id })` (AUTOSUBMIT-001/003 transition-gated). Same-value no-op must short-circuit BEFORE :255 — skips confirmRippleEdit, applyAnswer, evaluateDependsOn, maybeAutoSubmit, and any `answer.at` rewrite; advance only (Q14 rhythm). Return shape must expose a third outcome (NO-OP vs ACCEPT vs VETO) for acceptFromDeep.
- `src/panel/actions.ts:295` — `writeInEnter(panel): boolean`; docs ~273-293 describe post-commit sequence + "confirmRippleEdit (that is the choice seam…)" and maybeAutoSubmit tail. Byte-identical write-in re-commit (`answer.custom === true && buffer === answer.value`, likewise text questions) must be inert BEFORE the ripple-victims branch; consume/neutralize the buffer per the VAL-002 pattern so the advance's draft write-through can't stage committed text into the draft slot.
- `src/panel/deep-view.ts:528` — `acceptFromDeep(panel): boolean`; `:552` `if (q.answer === before) return true;` — the heuristic that reads a same-value no-op as a VETO (user stuck in deep view). Needs the explicit signal from acceptOptionIndex: NO-OP → return to short + advance; VETO → stay in deep. Comments ~559-566 to purge.

## Markers (FR-D10)
- `src/panel/layout.ts:313` — `statusMarkers(q: Question, theme: Theme): string`; consumed at layout.ts:362 for the short-view question line. Add `★ answered`.
- Parity source: `src/panel/overview.ts:111-112` — "`★` answered — any status carrying `q.answer` EXCEPT moot/withdrawn (answered/submitted/closed — h2.38 archived questions still show ★)" (implementation ~:132; ⟳ re-asked overrides). Compose with existing `✎` text-answer marker for write-ins.

## Agent-facing schema
- `src/tool-schema.ts:62` — TODAY: `recommendation: Type.Optional(Type.String({ description: "Recommended option value; marked ★ and preselected" }))`. Target (spec-verbatim, delta PRD): `"Recommended option value; marked ★; preselected only while unanswered — a recorded answer always owns the cursor"` — carry the description sentence over EXACTLY as the spec mandates (spec h2.19/h2.24; if spec text differs, spec wins). tool-schema.test.ts constrains schema strings.

## Comment purge sites (status-agnostic-preselect claims)
short-view.ts:22-28 & 117-123 · panel.ts:~354-360 & ~888-896 · actions.ts:~278/305/329/338-339/353/371 · deep-view.ts:559-566 · keys.ts:~440 · overview.ts:~390/405.

## Q14 advance
Advance-to-next-unanswered after enter lives in the accept tail (actions.ts); skips moot/withdrawn; see spec h2.65 Q14. No-op paths must reuse the same advance.

# P2.M1.T1.S2 research — README residue audit findings (pre-audited at this tree)

Audit target: `README.md` (622 lines at audit time). Ground truth: updated
spec/*.md (read-only) + the P2.M1.T1.S1 conformance matrix (parallel item).
HEAD context: P1 keymap-refresh work (README keymap section, re-verification
record) is COMPLETE and landed — do not re-audit keymap rows.

## DRIFT FOUND (fix these — README.md only)

### D1 — README:86-88 (Usage §3, delta shape + epoch position) — FR-3(a) / ANSWER-FIDELITY / KEEP-OPEN-002

Current text:

> Each submit streams a compact delta message to the
> model (rendered as a diff card in your transcript), ending with
> `(state epoch {n})` — the epoch the model must echo when upserting
> existing questions afterwards.

Problems:
1. "ending with `(state epoch {n})`" — WRONG POSITION. The epoch rides the
   HEADER, the FIRST line: `Submitted {k} (state epoch {n})` (src/delivery.ts
   `buildSubmission`, post-bump epoch per BUG-003). The message ENDS with the
   reminder line (complete submit), the PARTIAL nudge (early submit,
   KEEP-OPEN-002 — replaces the reminder line-for-line), and an optional
   trailing `NOTE: {note}` line.
2. "compact" implies a size property the ruling deleted. ANSWER-FIDELITY
   (2026-11-01): content is a header + ONE untruncated line per changed
   answer + reminder — "NO budget, drop-to-`+m more` rollup, or ellipsis cap
   exists on the model-visible path".
3. Missed docs catch-up: the FR-3(a) shape and both rulings go un-named
   (Mode B requires each fix to cite its ruling).

### D2 — README:399 (Acceptance summary, AC-2 row) — FR-3(a) / ANSWER-FIDELITY / KEEP-OPEN-002

Current: `2. Partial \`ctrl+s\` → compact delta + reminder; epoch bumps; remainder stays open.`

Spec AC-2 (authoritative): "Answer 2 of 30, `ctrl+s` → model receives the
header + both full answer lines + reminder (ANSWER-FIDELITY: never a
capped/partial delta); user-only card shows both answers; 28 remain open;
epoch bumps." A partial submit's reminder is REPLACED by the PARTIAL nudge
(KEEP-OPEN-002 — spec AC-2's canonical shape is itself an early submit).

## VERIFIED CLEAN (audit these, expect no change)

| Ruling | README surface | Verdict |
|---|---|---|
| KEEP-OPEN-001 | §3 "`ctrl+s` still submits partial sets — unanswered questions stay open" (:74-76); "a `submitted — {n} answer(s)` notification appears as the panel exits" (:71-72, correct per FR-3(d) post-submit auto-suspend — panel exits, interrogation state STAYS LIVE); §5 completion only "when every question is closed" (:113-116) | clean — no "submit completes/dumps the session" residue anywhere (grep: submit.*complet, dumps, ends the → 0 hits) |
| KEEP-OPEN-002 | §3 PARTIAL nudge paragraph (:74-80) — "delta closes with a `PARTIAL — {n} question(s) still unanswered (…)` nudge ... note variant" | clean |
| PANELTOGGLE-001 | Keymap table "Toggle panel / ctrl+n / Dual-surface toggle (PANELTOGGLE-001)" row; "Panel toggle shortcut" section; config `"toggle": "ctrl+n"` + `"panelShortcut": true` | clean (P1 landed) |
| Widget line | §4 "the suspend widget line (live counts, `/interrogate`) is the only cue" — src/panel/suspend.ts:99 `${n} open · ${m} answered — /interrogate to resume` — chord deliberately un-named | clean |
| FR-15/CHAT-CONTEXT-001 | Side chat §: "The question and its answer options stay on screen exactly as initially presented ... the chat appends below them (never replaces them)" (:305-309); project tree "under the panel-drawn question block" | clean |
| CHAT-STYLE-001 | "your lines prefixed `you ›` and colored like your main-chat messages ... one blank line between messages" (:313-315) | clean |
| LENIENT-ANSWER-001 | "capture never depends on the model getting the form right: the panel accepts any fenced block (any tag, or none), a block cut off mid-fence, a bare JSON object at the end of the reply, prose wrapped around the JSON, and near-miss spellings" (:341-347) | clean |
| EMPTY-REPLY-001 | "Empty replies are visible" bullet w/ exact notice string (:363-370) | clean |
| DEEP-FULLSCREEN-001 | README makes NO deep-view height/scroll/truncation claims to contradict it (keymap `d` row is bare; AC-5 row matches spec). Keymap `keys.elaborate` row's "in deep, the editor pins below the pane (the pane stays as context)" is CORRECT — ui-spec hotkey table keeps DEEP-EDITOR-001 wording; panel.ts carries the editor reserve | clean — absence, not contradiction; do not "complete" it |
| FULL-TRANSCRIPT-001 | §3 diff-card paragraph (:88-93): "every changed answer in full ... Nothing is truncated, capped, or hidden"; §5 recap card | clean |

## INTENTIONAL RESIDUE — DO NOT TOUCH (owned by P3.M5.T1.S2)

1. README:404 AC-9 row — "drafts gone (documented)" stays verbatim.
2. Limitations section drafts phrasing — "cross-restart draft persistence
   (documented limitation)" (non-goals line, :~428) and the "Drafts are
   in-session only" bullet (:~430-435) stay verbatim.
   The implementation-plan h2.56 file-checklist target wording ("shipped
   limitations (TUI-first; memory-only drafts until local input recovery
   ships)") is the flip P3.M5.T1.S2 applies AFTER recovery ships — not this
   item's edit.

## Ground-truth strings (from read-only spec — carry into fixes)

- FR-3(a): delta = header line `Submitted {k} (state epoch {n})` + ONE full
  line per changed answer + the reminder line; ANSWER-FIDELITY: no budget /
  rollup / ellipsis; write-in newline runs flatten to " / " within their line.
- KEEP-OPEN-002 nudge (delivery.ts partialNudge): `PARTIAL — {m} question(s)
  still unanswered ({ids}). …` (note variant names the NOTE: line as extra
  context) — replaces SUBMISSION_REMINDER line-for-line.
- FR-3(d): after every REAL delivery the panel auto-suspends (done(null),
  esc-suspend contract); zero-shipped early return stays open.
- KEEP-OPEN-001: submit never completes; the close pass (every question
  answered → submitted → archived on agent settle) owns completion.
- Spec AC-2: "header + both full answer lines + reminder (ANSWER-FIDELITY:
  never a capped/partial delta)".

## Prescribed fixes (exact replacement text — see PRP)

D1 → "Each submit streams a delta message to the model — a header line
`Submitted {n} (state epoch {e})`, ONE full untruncated line per changed
answer (ANSWER-FIDELITY: no budget, rollup, or ellipsis exists on this
path), then the closing reminder; an early partial submit swaps the reminder
for the `PARTIAL` nudge above (KEEP-OPEN-002). The header's
`(state epoch {e})` is the epoch the model must echo when upserting existing
questions afterwards."

D2 → "2. Partial `ctrl+s` → header + every changed answer in full + the
reminder (an early submit swaps in the `PARTIAL` nudge — KEEP-OPEN-002;
ANSWER-FIDELITY: never a capped/partial delta); epoch bumps; remainder
stays open."

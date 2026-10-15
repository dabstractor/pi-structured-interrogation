# README.md sweep — verification record (Mode B, P1.M3.T2.S1 / changeset 001_5dde9b4d7329)

Swept the three areas (a–c) from the PRP, navigating by quoted text (line
anchors had drifted from the parallel subtasks; the keymap is now on
single-letter bare keys). The README already promised the changeset's
behavior — per the minimal-edit rule, most passages verified as-is.

Result: **2 one-line edits, 11 verified as-is.** `git diff --stat` shows
README.md only; `npm test` + `npx tsc --noEmit` green (zero source edits).

## Area (a) — external-editor hotkey contexts (BUG-002: ctrl+g any-duty + note routing)

| # | Passage (quote anchor) | Status | Change |
|---|------------------------|--------|--------|
| 1 | Usage :39-40 ("`ctrl+g` finishes the draft in an external editor") | verified-as-is | Duty-silent — correct post-fix. |
| 2 | Config block :149 ("`"externalEditor": "ctrl+g"` // open the draft in an external editor") | verified-as-is | Duty-silent. |
| 3 | Keymap External-editor row ("Open the draft in an external editor") | **edited** | OLD was duty-silent (accurate but silent about the newly live note duty + routing) → NEW: "Open the draft in an external editor — any editor duty (answer, elaboration, or note; in note duty the finished text lands in the batch note)". One table cell; user-visible outcome only (no keys.ts gate / routing-fork internals). BUG-002. |
| 4 | Keymap Batch-note row ("Attach a batch note shipped with the next submit; close via `enter` or double-`esc`") | verified-as-is | Left un-edited (minimal-edit discipline): the note-routing is documented once, in the external-editor row — adding "editable via `ctrl+g`" here would duplicate it. |
| 5 | Keymap-conflict table :363 ("its only valid context is editor focus") | verified-as-is | TRUE post-fix — editor focus now spans text OR note duty. |
| 6 | Two-tier intercept paragraph ("`ctrl+s`, `ctrl+g` … intercept everywhere, including while the editor holds focus") | verified-as-is | TRUE, duty-agnostic by construction. |
| 7 | Panel-intercept rationale ("(`ctrl+s`, `ctrl+g`, `shift+tab`) intercept everywhere in-panel") | verified-as-is | Same. |
| 8 | `grep -n "text focus" README.md` | verified-as-is | Single hit :362 — the `ctrl+s` submit row ("submit must fire from text focus, where a bare key could never be typed"): typing-context reasoning, explicitly EXEMPT by the PRP. No external-editor context carries a text-focus-only claim. |

## Area (b) — editor re-bind sentences (BUG-001: WRITEIN-002 restored)

| # | Passage (quote anchor) | Status | Change |
|---|------------------------|--------|--------|
| 9 | Editor paragraph ("Accepting an option after a committed write-in supersedes the answer and re-binds the kept slot text as elaboration.") | **edited (one clarifying line)** | Sentence verified TRUE (restored semantics). Appended the at-most-one-line nuance from bug001-writein-supersede.md §(b) item 3 + the "Visible" ruling: "— the re-bound text is that question's draft (✎ marker; edit or clear it any time before it ships), and on an already-complete set the same gesture can auto-submit it verbatim, with no chance to edit first." "can" (not "will") matches the AUTOSUBMIT-003 rule-(b) trigger semantics — only the review-flow-exit commit auto-ships. BUG-001. |
| 10 | AC-2b ("a real option after a committed write-in re-binds the slot as elaboration") | verified-as-is | True as-is; left one-line terse per the PRP (the Usage paragraph carries the nuance). |

## Area (c) — caps purge coherence (BUG-003; P1.M3.T1.S1 owns the main edit)

| # | Passage (quote anchor) | Status | Change |
|---|------------------------|--------|--------|
| 11 | Model note ("it is stored verbatim, with no length limits (CAPS-OUT-001)") | verified-as-is | Confirmed P1.M3.T1.S1's parallel edit HAS landed — not redone. |
| 12 | Configuration "No caps" comment ("// No caps: question count, option count, and text lengths are all // unlimited — nothing is truncated or dropped (CAPS-OUT-001).") | verified-as-is | Coherent with the model note; no contradiction, no duplication. |
| 13 | `grep -n "capped at 400\|400-char\|truncated with a warning" README.md` | verified-as-is | Empty — zero residual caps claims. Only remaining "caps" token is the intentional CAPS-OUT-001 tag + the No-caps comment. |

## Discipline notes

- No internals documented (stageSupersededWriteIn, keys.ts gates, note-routing
  forks) — user-visible outcomes only ("the finished text lands in the batch note").
- Voice/format preserved: table-cell brevity, backticked keys, one-line AC summaries;
  no section rewrites; `{key}` placeholders untouched.
- spec/ (P1.M3.T2.S2) and src/ (P1.M3.T1.S2) untouched.
- The :362 "text focus" hit deliberately NOT "fixed" (typing context, correct).

## Gate

- `git diff --stat` → README.md only.
- `npx tsc --noEmit` → exit 0; `npm test` → all green (zero source edits).

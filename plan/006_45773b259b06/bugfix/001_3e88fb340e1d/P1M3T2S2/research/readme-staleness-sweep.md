# README staleness sweep — P1.M3.T2.S2 (bugfix changeset 001_3e88fb340e1d, minor fixes)

Mode B changeset-level doc sync for BUG-002 (Other-row width truncation),
BUG-003 (post-suspend notify confirmation), BUG-004 (SURFACE-002 comment
truth). Navigated by quoted text (parallel edits shifted line anchors — post-edit
refs below include my +1 reflow from Row 1). Edits: README.md only; spec/
untouched; no source edits.

**Parallel-task coordination (checked before + after editing):** S1's README
edits were STAGED in the index at task start (`git status` → `M  README.md`;
staged hunks at @@ -364 (the :367 AC-9 fidelity clause) and @@ -382 (drafts
row)) — disjoint from my rows; I edited the working tree around them, never
touching :367 or S1's passages. `git diff` (working tree vs index) shows exactly
my two hunks: @@ -67,8 (Row 1) and @@ -356,7 (Row 2).

## Per-row results

| # | Row (post-edit ref) | Status | Detail |
|---|---|---|---|
| 1 | Usage auto-submit paragraph (:70–72) | **corrected (old → new)** | OLD: "ships the submission for you (footer flashes `submitted — {n} answer(s)`), and an edit made while the set is already complete ships immediately too (one submission…" → NEW: "ships the submission for you (a `submitted — {n} answer(s)` notification appears as the panel exits), and an edit made while the set is already complete ships immediately too (one submission…". Ground truth: src/panel/actions.ts ~:1071–1077 — `panel.notify(confirmation)` is the only user-observable channel because submit() already suspended the panel (FR-3d; "a sync invalidate never paints once resolved — BUG-003"); the verbatim string `submitted — {n} answer(s)` (em-dash, literal "answer(s)") preserved byte-for-byte. Rest of the paragraph (gate-hold ⚠ line, `ctrl+s` override, one-submission-per-commit) verified unchanged. | 
| 2 | AC-2c acceptance row (:360) | **corrected (old → new)** — per the decision rule | OLD: "…ships with no keypress beyond the answer (`submitted — {n} answer(s)`); editing…" → NEW: "…beyond the answer (a `submitted — {n} answer(s)` notification); editing…". Row 1 was edited to name the channel, so the one-word "notification" was added here for consistency; it fits the terse AC voice. String verbatim. |
| 3 | Diff-card sentence (:85–86) | **verified-as-is — NO-OP** | "Nothing is truncated, capped, or hidden behind the transcript's expand toggle — so you can always scroll back and read exactly what you said." This is the FULL-TRANSCRIPT-001 diff-card surface. BUG-002's fix truncates the ✎ Other ROW label in the PANEL at narrow terminal widths (otherLine → truncateVisible, same budget math as optionLine) — a different surface; the sentence scopes itself to the transcript toggle, so it cannot reasonably be misread as covering panel rendering. No scoping phrase added. BUG-002 |
| 4 | CAPS-OUT-001 claims (:124, :140, :164) | **verified-as-is — NO-OP** | ":124 limits (CAPS-OUT-001)", ":139→140 through verbatim (CAPS-OUT-001)", ":163→164 // unlimited — nothing is truncated or dropped (CAPS-OUT-001)." — all about ANSWER-CONTENT limits (the deleted caps engine: stored/shipped content is verbatim, unlimited). Terminal-width truncation of DISPLAY lines was always the behavior (ui-spec terminal fallbacks: option labels truncate with `…`) and is a different guarantee; BUG-002 touched only display. Claims intact, not weakened. BUG-002 |
| 5 | AC-9 restart row (:368 post-S1-stage) | **verified-as-is — READ ONLY** | "9. Restart pi mid-interrogation → NO panel appears (SURFACE-002); the widget line shows live counts; `/interrogate` reopens restored state (answers with their elaborations and ✎ write-ins); drafts gone (documented); pending answers ship on the next commit or submit (AUTOSUBMIT-001)." The README never claimed auto-open, so BUG-004 (src comment truth only) has no README impact. S1's staged fidelity clause is inside this line — NOT edited by me (collision avoidance). BUG-004 |
| 6 | Project-structure reconstruct line (:529) | **verified-as-is — READ ONLY** | "# suspend-widget cue, SURFACE-002 — NEVER opens the panel" — already states the SURFACE-002 truth. BUG-004 |

## Level 3 read-back gate evidence

- `grep -n "footer flashes" README.md` → **no hits** (exit 1) — the only
  "flash"-family hit in the file was the auto-submit confirmation, now gone;
  no other-context flashes existed to judgment-check.
- `grep -c "submitted — {n} answer(s)" README.md` → **2** (rows 1 and 2),
  em-dash verbatim.
- `grep -n "CAPS-OUT-001" README.md` → 3 hits (:124/:140/:164), claims intact.
- `grep -c "SURFACE-002" README.md` → 2 (:368 AC-9, :529 project structure).
- `grep -n "notification" README.md` → rows 1 and 2 only — no implementation
  internals (panel.notify / FR-3d / suspend ordering) in user prose.

## Gates

- `npm test` → 55 files, **1643 passed**. `npm run typecheck` → clean
  (zero source edits).
- `git diff --stat` (working tree) → README.md only (4 insertions, 3 deletions
  = my two hunks; S1's changes are staged, disjoint). No spec/ or src/ edits.

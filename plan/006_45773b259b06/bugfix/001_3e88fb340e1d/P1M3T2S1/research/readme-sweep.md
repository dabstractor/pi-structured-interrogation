# README.md sweep — verification record (Mode B, P1.M3.T2.S1 / BUG-001 replay fidelity)

Swept the five candidate restart/reconstruction passages (bug004-surface002-
comment.md §"README changeset-doc map" BUG-001 rows), navigating by quoted
text. Fixed behavior verified landed BEFORE claiming fidelity:
`src/reconstruct.ts` replaySubmission now carries `answer.text` and
`answer.custom` through strict guards (BUG-001 consumer half; keys stay
absent for legacy entries).

Result: **2 one-clause edits, 3 explicit no-ops.** `git diff --stat` shows
README.md only; `npm test` + `npm run typecheck` green (zero source edits).
No collision with the parallel P1.M3.T2.S2 sweep: README was unmodified at
sweep start and this task's passages (AC-9, Limitations drafts row) are
disjoint from S2's BUG-002/003/004 rows (:85, :163, :359-360 — untouched).

| # | Passage (quote anchor) | Status | Decision |
|---|------------------------|--------|----------|
| 1 | Usage — "run `/interrogate` and the restored questions and answers come right back." | verified-as-is (explicit no-op) | Accurate and fidelity-silent — it claims nothing value-only. Adding the clause here too would duplicate the Limitations row's canonical fidelity statement; the no-op is the minimal-edit discipline, not an oversight. |
| 2 | AC-9 — "`/interrogate` reopens restored state; drafts gone (documented); …" | **corrected (one clause)** | OLD: "reopens restored state" (fidelity-silent) → NEW: "reopens restored state (answers with their elaborations and ✎ write-ins)". Fits the line's existing parenthetical style ("(documented)", "(SURFACE-002)"); the fidelity is now asserted where restart behavior is accepted. BUG-001. |
| 3 | Limitations drafts row — "…restores questions and submitted answers with their exact values — never in-progress drafts." | **corrected (the expected edit)** | OLD left "with their exact values" as the natural attach point for a value-only reading → NEW: "…with their exact values — elaborations and ✎ write-in answers included — never in-progress drafts." States the restored fidelity in the exact sentence users would consult about what survives restart. BUG-001. |
| 4 | Limitations compaction row — "…if the newest one fails to deserialize, it degrades to the next-older valid result…" | verified-as-is (explicit no-op) | "Degrades" is about CANDIDATE POOLING (which tool result is selected), not answer shape — the anti-pattern warning applies verbatim. No fidelity claim is made or missing here. |
| 5 | Project structure — reconstruct.ts one-liner ("state reconstruction: session start (silent install + …) + /tree navigation …") | verified-as-is (explicit no-op) | Describes SURFACING behavior only; neutral on replay fidelity. Nothing value-only to correct. |

## Discipline notes

- No internals documented: no DiffEntry, replaySubmission, mirror debounce
  windows, candidate pooling, or the 2s hard-kill window — the user-facing
  truth stated is exactly "restored answers keep elaborations and ✎ write-ins".
- README voice preserved: em-dash asides, parenthetical AC style, one clause
  per passage at most.
- spec/ untouched; per-file docs rode with P1.M1.T1 (Mode B boundary).
- BUG-002/003/004 passages (:85, :163, :359-360) untouched — P1.M3.T2.S2's scope.

## Gate

- `git diff --stat` → README.md only.
- `npm run typecheck` → exit 0; `npm test` → all green (zero source edits).

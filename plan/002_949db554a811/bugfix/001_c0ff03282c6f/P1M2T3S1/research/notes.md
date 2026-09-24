# Research notes — bugfix P1.M2.T3.S1 (BUG-006 flatten half)

## Verified code facts

- `src/snapshots.ts`:
  - `answerSummary(q)` :135-154 — composes `✎ ${value}` (custom) or label/raw summary, plus optional ` — ${answer.text}` elaboration; returns `"(unanswered)"` for missing. JSDoc: "No truncation — display truncation is the renderer's job."
  - `answerSignature` ~:120 — `${answer.value}\u0000${answer.text ?? ""}` RAW (change predicate — must NOT be flattened).
  - `computeEntries` :219-231 — the ONE diff core; `from: answerSummary(before)`, `to: answerSummary(after)` (:229-230). Feeds `computeDiff` (card + delta entries) and `digestSince` (:238).
- `src/delivery.ts`:
  - Precedent: note line :176-178 `note.replace(/\n+/g, " / ")` — the " / " flatten grammar.
  - `buildSubmission` :162-186: content line 1 = "Submitted {k}: {entries}{epoch}"; budget loop :170-180 shrinks list from the end, keeps ≥1 entry whole (S2's cap site). details.card = the diff (DiffEntry to/from carry raw newlines today).
- Golden pins: delivery.test.ts :90 (exact happy-path content), ~:600 (golden multi-group byte-exact), :144 (UNBOUNDED 2*MAX entry, no ellipsis — pins the ABSENCE of S2's cap; must keep passing), :791/:823 epoch-suffix lines.
- Write-ins commit raw newlines (actions.ts:255-region JSDoc: "multi-line values keep their newlines") — state values must stay raw.
- `src/panel/actions.ts:355` region: not relevant here (bugfix-001 changeset from earlier session already shipped).

## Fix design

- `flatten = (s) => s.replace(/[\n\t]+/g, " / ")` applied to answerSummary's composed returns only (custom base, choice/text summary, and both ` — text` composites). Runs collapse; unicode untouched.
- One seam covers delta entries + card to/from + digestSince — zero consumer edits.
- Boundary vs S2 (per-entry cap): NO truncation, no `…`, no MAX_CHARS logic; :144 stays green.
- Boundary vs parallel P1.M2.T2.S2 (revisit preview): it renders RAW values in panel (layout.ts/short-view.ts) — different surface, no conflict.

## Open verification (PRP Task 1)

- Grep delivery/snapshots tests for fixtures containing literal \n/\t in values/text → list tests that legitimately flip to " / ".
- Check whether buildCompletion's completion summaries route through snapshots.answerSummary (flatten free) or duplicate it (divergence → note for S2, don't expand scope).

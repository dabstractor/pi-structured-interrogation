# Research notes — P1.M1.T2.S2 (✎ in read results, completion record, recap card, fallback digest)

## Verified touchpoints (working tree, line-exact)

1. **src/results.ts `questionLine` (:234-242)** — THE ONLY raw-value display left:
   `if (q.answer !== undefined) line += ` · answered: ${q.answer.value}`;` — raw value today.
   Docblock at :115 documents the one-liner format ("titles are short by contract and
   never truncated; prompt fallback gets 60-char plain slice, no ellipsis").
   `buildReadResult(state: SerializedState)` — pure, takes serialized state.
2. **src/delivery.ts completion record lines (~:365-385)** — line is composed from
   `entry.answer = completionAnswerSummary(q)`, then `[${groupKey}] ${q.id} ${entry.title}:
   ${entry.answer}` + ` ★` + ` — ${freeText}`. **S1's PRP already adds the ✎ branch to
   completionAnswerSummary** → record lines inherit ✎ with NO code change here.
3. **src/renderers.ts `buildCompletionRecapCard` (:314, line at :353)** — `q.answer` comes
   from `CompletionRecapEntry` (built in delivery from completionAnswerSummary) → inherits ✎.
   Collapsed truncates the whole themed line via `truncateToWidth(line, COLLAPSED_LINE_BUDGET=80)`
   (ANSI-aware, composed-then-truncated); expanded never truncates. NO code change needed.
4. **src/fallback.ts** — digest renders questions/options ONLY; answers are never displayed
   (verified: `answer` matches are all in doc comments about recordAnswers). S2 = regression
   assertions only.

## Division of labor vs S1 (parallel contract)
S1 (diff surfaces): snapshots.answerSummary + delivery.completionAnswerSummary ✎ branches.
S2 (this): results.questionLine ✎ branch (the read one-liner / status output), Mode A docblocks
on read formatter + completion record builder, fallback non-regression assertions, recap-card
✎ inheritance tests. Do NOT re-add ✎ to completionAnswerSummary (S1 owns it; drift risk).

## Truncation decision for the read one-liner
- questionLine is plain model-facing text, no ANSI. Existing convention in the same function:
  prompt fallback = `prompt.slice(0, 60)` plain slice, no ellipsis.
- DECISION: write-in segment = `✎ ${value.slice(0, 60)}` — 60-char plain slice of the VALUE,
  no ellipsis, matching the local convention. Only the value is sliced; ✎ prefix always present.
- Non-custom answers: keep raw value as today (option VALUES are short identifiers by contract;
  label lookup is deliberately absent in the one-liner — status-oriented, not display-oriented).

## Replay/reconstruction
Item says value-first, NO special casing — reconstruction replays `details.state` verbatim;
custom is data, not display. `details.state` is serialize() output; questionLine operates on
deserialized state. No changes to reconstruct.ts.

## Test seams
- results.test.ts: existing buildReadResult tests assert lines — add custom-answer case.
- delivery.test.ts / renderers.test.ts: completion record + recap card ✎ inheritance
  (depend on S1's branch — if S1 hasn't landed, these tests land in S1's scope; keep
  inheritance assertions minimal and additive).
- fallback.test.ts: digest output contains no answer rendering regardless of custom.

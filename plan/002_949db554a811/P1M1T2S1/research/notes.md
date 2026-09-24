# Research notes — P1.M1.T2.S1 (✎ write-in in diff surfaces)

## Verified code facts
- `src/snapshots.ts:124` `answerSummary(q)`: label-preferred for choice (`q.options?.find(o => o.value === answer.value)?.label ?? answer.value`), raw value for text; `(unanswered)` when absent; NEW-003 suffix ` — ${answer.text}` when answer.text non-empty; **no truncation** ("display truncation is the renderer's job"). Consumed by computeDiff at :193-194 (`from`/`to` DiffEntry fields).
- `src/delivery.ts:269` `completionAnswerSummary(q)`: BY-DESIGN duplicate of the private answerSummary; docblock at :264-268 is THE sync comment ("Duplicated by design; THIS comment is the sync reference... do NOT import the private"). Used at :373 for completion record answer lines.
- `src/renderers.ts:171` card entry line: `let line = ${INDENT}${title}: ${from} → ${to}` — from/to come straight from DiffEntry (i.e. answerSummary output). Collapsed → `truncateToWidth(line, COLLAPSED_LINE_BUDGET)` (ANSI-aware, from pi-tui); expanded → full line, never truncated. So once the summary helpers emit `✎ {text}`, the card line, truncation-to-fit, and expanded-shows-full-text are all automatic — no logic change needed in renderers.ts, only a doc/test touch.
- `answerSignature` (snapshots.ts:110-116) compares `${value}\u0000${text}` — custom answers already diff correctly; do NOT add custom to the signature (would break changed-detection semantics? no — value differs anyway; leave untouched).
- S1 contract (plan/002_949db554a811/P1M1T1S1/PRP.md): `QuestionAnswer.custom?: boolean` added, round-trips schema → applyAnswer → serialize → revive. Downstream can rely on `q.answer.custom === true`.
- Conventions: vitest co-located `src/*.test.ts`; snapshots.test.ts and renderers.test.ts assert summary/diff strings today.
- Truncation decision: summaries NEVER truncate (existing JSDoc rule); "✎ truncated to fit" is satisfied by the renderer's existing truncateToWidth — keep that division.

## Branch semantics decided
In BOTH helpers, before the choice/text dispatch:
`if (answer.custom === true) summary = "✎ " + answer.value;`
Then keep the NEW-003 elaboration suffix behavior in snapshots.answerSummary (custom write-in + later real-option… n/a — text answer with custom is unusual; still apply suffix if answer.text present, same grammar). completionAnswerSummary: same branch; it has no text suffix today (h2.49 shows `{— free text}` handled by the record's own line assembly) — add ONLY the ✎ branch there.

## Tests
- snapshots.test.ts: diff from/to for custom answer shows `✎ text`; label lookup bypassed (value not in options); elaboration suffix composes `✎ v — elab`; unanswered unchanged.
- delivery.test.ts: completionAnswerSummary custom → `✎ text`; choice label path regression.
- renderers.test.ts: card line contains `✎ ` for a custom diff entry; collapsed line respects COLLAPSED_LINE_BUDGET via truncateToWidth (existing pattern), expanded shows full text.
- Keep sync comment TRUE: update both docblocks (Mode A) to mention the ✎ write-in branch.

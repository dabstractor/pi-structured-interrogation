# Research notes — bugfix P1.M2.T2.S1 (DiffEntry raw `value`)

## Verified current state of src/snapshots.ts

- `DiffEntry` (lines ~37–55): `{ id, title, from, to, editedArchived }` — all required, no optional fields. No raw value anywhere.
- `answerSummary(q)` is module-PRIVATE (~line 86): choice → label of option whose `value === answer.value`, fallback raw `answer.value`; text → raw `answer.value`; missing question/answer → `"(unanswered)"`.
- `answerSignature(q)` = `` `${answer.value}\u0000${answer.text ?? ""}` `` or undefined — the change predicate.
- `computeEntries(prev: SerializedState, next: SerializedState)` (private, ~148–167): union of question ids; entry emitted iff `answerSignature(before) !== answerSignature(after)`; `from = answerSummary(before)`, `to = answerSummary(after)`, `title` next-side preferred, `editedArchived = before?.status === "closed"`. Pure.
- Public consumers: `computeDiff(prev, next): SubmissionCardData` and `digestSince(...)` both delegate to computeEntries — the single change core, so ONE edit propagates everywhere by design.

## Test-fixture ripple (verified)

- snapshots.test.ts uses **`toEqual` with exact object literals** for `diff.changed` entries (lines ~122–226). Vitest `toEqual` treats `{value: undefined}` as equal to key-absent, BUT entries whose `after` question IS answered will now carry a defined `value` — those literals MUST be extended with `value: <raw post-change value>` or the suite fails. Affected known cases: `choice_value_change_uses_labels_exact_entry` (add `value: "postgres"`), `value_matching_no_option_falls_back_to_raw_value` (`value: "mysql"`), `text_only_edit_...` (`value: "sqlite"`), cleared-answer case (`to: "(unanswered)"` → `value` stays absent/undefined — passes either way, add explicitly for clarity), `editedArchived` case (`value: "b"`-style post value), `(unanswered)→answered` cases.
- delivery.test.ts: `SubmissionMessage.details.changed` is `DiffEntry[]` re-exported (delivery.ts:66–67). Any fixture asserting `changed` entry literals byte-exactly needs the same `value` additions. buildSubmission passes `diff.changed` through unmutated — delivery.ts itself needs NO logic change (type flows through the import).

## Downstream consumers (do NOT touch in this item)

- `src/renderers.ts:144,183` — sparse-shape guards read `changed` as array; new optional field is additive, no change needed.
- `src/reconstruct.ts:289` — currently `state.applyAnswer(id, { value: to, ... })` using the LABEL (BUG-007 root). P1.M5.T1.S1 changes it to prefer `entry.value`. Its module JSDoc (line ~46) documents `to` as display-only — that comment gets updated THERE, not here.
- Delivery content line (h3.6 format `{id}: {to}`) keeps using `to` — labels remain the model-visible summary; `value` is data-only (flows via details into session history).

## Legacy tolerance boundary

- History written before this change has DiffEntries without `value` — reconstruction fallback is P1.M5.T1.S1's explicit concern ("prefer DiffEntry.value, tolerate legacy"). This item only makes `value` optional (`value?: string`) so old payloads type-check.

## Contract notes

- P1.M2.T1.S1 (parallel) touches buildSubmission's content string only — no overlap with DiffEntry shape.
- answerSignature comparison, from/to semantics, UNANSWERED constant: unchanged (renderers + user-only diff card keep label summaries).

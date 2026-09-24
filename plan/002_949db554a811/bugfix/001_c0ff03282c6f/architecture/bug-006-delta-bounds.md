# BUG-006 — Model-visible submission delta unbounded / multi-line for write-ins (AC-2 ≤3-line violated)

Verified against HEAD 613437d.

## 1. buildSubmission budget loop — `src/delivery.ts:145-201` (function starts ~145; key lines 156-181)

```ts
const k = diff.changed.length;
const entries = diff.changed.map(
  (e) => `${e.id}: ${e.to}${e.editedArchived ? " (changed)" : ""}`,
);
const postEpoch = diff.epoch + 1;
const epochSuffix = ` (state epoch ${postEpoch})`;
let list = entries.join("; ");
let dropped = 0;
while (
  `Submitted ${k}: ${list}${epochSuffix}`.length > SUBMISSION_LIST_MAX_CHARS &&
  entries.length - dropped > 1
) {
  dropped++;
  list = entries.slice(0, entries.length - dropped).join("; ");
}
if (dropped > 0) list += `; +${dropped} more`;
const noteLine = typeof note === "string" && note.length > 0
  ? `\nNOTE: ${note.replace(/\n+/g, " / ")}` : "";
const content = `Submitted ${k}: ${k === 0 ? "(no changes)" : list}${epochSuffix}\n${SUBMISSION_REMINDER}${noteLine}`;
```
Constant: `SUBMISSION_LIST_MAX_CHARS = 240` (delivery.ts:53, exported). `SUBMISSION_REMINDER` is the byte-exact reminder string (see delivery.ts near line 53-60; pinned by delivery.test.ts:164).

CONFIRMED: the guard `entries.length - dropped > 1` keeps ≥1 entry whole, so a single 3000-char write-in entry passes through unbounded (test delivery.test.ts:133 even pins this: `single_huge_entry_still_fits_budget_rule_at_least_one_survives` expects the full 480-char line — that test encodes the bug).

Multi-line: `answer.to` comes verbatim from answerSummary. Note the builder already flattens newlines for the NOTE line (`note.replace(/\n+/g, " / ")` — the in-module precedent to reuse) but NOT for entries.

### answerSummary — `src/snapshots.ts:128-154` (CONFIRMED: no newline flattening, no cap)

```ts
function answerSummary(q: Question | undefined): string {
  const answer = q?.answer;
  if (q === undefined || answer === undefined) return UNANSWERED;
  if (answer.custom === true) {
    const base = `✎ ${answer.value}`;
    if (typeof answer.text === "string" && answer.text.trim() !== "")
      return `${base} — ${answer.text}`;
    return base;
  }
  const summary = q.type === "choice"
    ? (q.options?.find((o) => o.value === answer.value)?.label ?? answer.value)
    : answer.value;
  if (typeof answer.text === "string" && answer.text.trim() !== "")
    return `${summary} — ${answer.text}`;
  return summary;
}
```
`answer.value` for write-ins is the RAW editor buffer (writeInEnter JSDoc: "the commit is the RAW buffer … multi-line values keep their newlines"). So raw `\n` and tabs flow into `to` and hence into the single content line.

### Where the card is built/sent

- `SubmissionCardData` (snapshots.ts:90; entries `{id, from, to}` snapshots.ts:67, 207-208) sits on `details.card` (delivery.ts:191-195 `details = { changed, epoch, card: diff }`), sent via `{ customType: "interrogation-submission", content, display: true, details }` — the card renderer (renderers.ts submission card) consumes `details`, user-only; `content` is model-visible. The card thus also carries raw newlines in `to`.
- Sending path: pi.sendMessage (delivery.ts later half; transport-free builder per delivery.test.ts:279).

## 2. Existing truncation helpers to reuse

- `truncateVisible(text, maxWidth): string` — `src/panel/layout.ts:95` (exported; ANSI/wide-char safe, `…` terminator). Panel-side; delivery/snapshots are panel-free, so if layering forbids importing panel/, replicate or lift it.
- `truncateToWidth` — imported from `@earendil-works/pi-tui` (src/renderers.ts:55); `COLLAPSED_LINE_BUDGET` constant in renderers.ts (card renderer side).
- `note.replace(/\n+/g, " / ")` — delivery.ts:176-178, in-module newline-flattening precedent.
- No `firstLine`/`ellipsize`/`sanitize` helper exists in delivery/snapshots.

## 3. Spec lines for AC-2 / ≤3-line delta

- `spec/product-requirements.md:27` (FR-3): "(a) delta message to the model (~2 lines + reminder line ...)".
- `spec/product-requirements.md:76` (AC-2): "model receives a ≤3-line delta + reminder".
- `spec/product-requirements.md:77` (AC-2a WRITEIN-001): "card and delta render `✎ {text}`".
- Recommendation language: fix should "flatten newlines and enforce a per-entry cap in the submission list line" (per the bug-report recommendation; consistent with FR-3/AC-2).

## 4. Tests pinning delta shape/budget

delivery.test.ts:
- :79 happy_path_two_answers_exact_content_and_envelope (byte-exact content)
- :115 truncation_30_long_answers_keeps_3_line_budget_and_true_k
- :133 single_huge_entry_still_fits_budget_rule_at_least_one_survives — PINS the unbounded single entry; must change
- :149 zero_changes…, :164 reminder_line_is_byte_exact_vs_constant, :176 note_passthrough
snapshots.test.ts / delivery.test.ts :540/:567/:583 — answerSummary write-in rendering (`✎ {text}`, `✎ {text} — {elaboration}`) — pin the summary grammar; a cap/flatten must keep these passing (short strings unaffected).
delivery.test.ts:600 golden_record_multi_group_byte_exact_content_and_envelope.

## 5. Fix sketch

- In answerSummary (or in buildSubmission's entry formatting — answerSummary is shared with the diff card, so capping there changes the card too; PRD says card should show `✎ {text}` verbatim-ish): prefer formatting-time in delivery.ts — flatten and cap the ENTRY, not the summary:
  - `const flat = (s: string) => s.replace(/\s*\n+\s*/g, " ")` (tabs via `\t` → space, or `\s` generally)
  - per-entry cap, e.g. `truncateEntry(flat(to), ENTRY_CAP)` with `…` suffix; ENTRY_CAP sized so `id: <cap>` + epochSuffix fits 240 even with 1 entry (e.g. 160-180 chars, accounting for id + " (changed)").
- Keep the existing list-shrink loop for many-entries compression (still correct once entries are bounded); update delivery.test.ts:133 to expect the capped line.
- Card `to`: PRD FR-3(b)/AC-2a render `✎ {text}` on the card; recommend flatten newlines on the card too (raw newlines break the card line layout) but keep the card cap looser (renderer already truncates via truncateToWidth at COLLAPSED_LINE_BUDGET). Decision point: cap in answerSummary (model+card uniform, simplest) vs entry-time only (card keeps full text). Given renderers.ts already truncates card lines, entry-time-only is lower-risk; but flattening belongs in BOTH.
- Riskiest unknown: byte-exact golden tests (delivery.test.ts:600, :79) — any grammar change near answerSummary breaks them; keep the `✎ {text}` and `{answer} — {free text}` grammar untouched and only add flatten+cap for long/multi-line values.

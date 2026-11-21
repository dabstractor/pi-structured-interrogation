# P3.M4.T1.S1 research findings — shared blank-answer rejection guard at applyAnswer

## Binding spec (READ-ONLY)

- `spec/state-and-persistence.md` §Local input recovery, bullet :141 (verbatim):
  "Reject blank answer values at the shared final mutation (`applyAnswer`), regardless of ingress
  (panel, side-chat apply, non-TUI `answers[]`, or submit reconciliation). Use `value.trim()` only
  to test emptiness; store nonblank values untrimmed. Reject before any answer/status change,
  advance or submission; preserve any prior answer. In the editor, keep focus and content and show
  an inline reason, e.g. `Answer cannot be blank`. On reconstruction/replay, a historical blank
  must neither replace a valid answer nor count or appear as validly answered/submitted; do not
  fabricate missing text. No semantic validation or additional model calls."
- Acceptance case 5 (:149) — SPLIT: the live halves (clear/whitespace commit attempt → kept focus +
  explained why; blank rejection through non-editor ingress) are THIS item; the restart/replay
  halves (newer edit wins after restart; legacy blank replay with/without prior answer) are
  P3.M4.T1.S2's.
- `spec/ui-spec.md` §Free-text field (h2.32) is ALREADY updated to the new rule: "Blank answer
  attempts stay in the editor (see linked rejection rule)" — the CODE lags, not the spec. Old rule
  text ("Empty buffer + enter = save draft + blur back to options, NO commit") survives only in
  code + comments.
- Architecture note `plan/006_45773b259b06/architecture/input-recovery.md` P3.M4 boundary:
  "recovered blank drafts seed the editor but never become answers — blank rejection lives at
  `applyAnswer` (sibling item)."

## The seam and every caller (audited)

`InterrogationState.applyAnswer` (src/state.ts:379-386) — raw primitive; sets `q.answer`, flips
status to `answered`, emits `changed`; throws on unknown id ONLY. Callers:

| Site | Value source | Blank possible? | S1 action |
|---|---|---|---|
| src/panel/actions.ts:322 acceptOptionIndex | option value (tool-schema rejects blank option values at upsert, tool-schema.ts:441 `opt.value.trim() === ""` → structured error) | No (structurally) | none (guard = defense) |
| src/panel/actions.ts:516 writeInEnter | editor buffer | YES — the editor ingress | branch rewrite (see below) |
| src/panel/actions.ts:749 reconcileDraftsForSubmit (text draft → answer) | draft slot | pre-skipped today (`text.trim() === ""` continue) | keep skip; guard = defense |
| src/panel/actions.ts:763 reconcileDraftsForSubmit (elaboration attach `{...q.answer, text}`) | prior answer's value | only LEGACY in-session blanks | belt-and-braces skip |
| src/panel/ripple-confirm.ts:161 / :304 | option value / cm.text captured from nonblank buffer | No (by construction) | none |
| src/fallback.ts:252 recordAnswers | model's `answers[]` value — "recorded AS GIVEN — no validation" | YES — the non-TUI ingress | NEW rejected bucket |
| src/debug-commands.ts:221 | dev tool input | possible | throw surfaces as error — acceptable |
| src/reconstruct.ts:443 replay | historical delta `value`/`to` | legacy blanks (only whitespace passes the existing `resolved === ""` check at :438) | **DO NOT TOUCH — P3.M4.T1.S2 owns** |
| src/merge.ts:261 markAnswered | wrapper, no live callers | n/a | covered structurally |

## Editor ingress today (actions.ts:427-436) — the code that changes

```ts
const text = panel.textField.getText();
if (text.trim().length === 0) {
  panel.commitTextDraft(q.id, text);  // draft write-through + blur back to options — OLD RULE
  return true;
}
```
New: keep focus + buffer + duty + cursor, flash inline reason, NO commitTextDraft, NO advance,
NO blur, NO auto-submit. No draft is lost: capture-on-edit (P3.M2, landed) holds the latest
durable copy; the eventual blur/navigation write-through (syncBufferToQuestion) stages the slot.

## Non-editor ingress surface (fallback)

- `recordAnswers(state, answers)` returns `{recorded, unknown, ignored}` (fallback.ts:202-256);
  answer applied via `state.applyAnswer(answer.id, applied)` with NO value check
  ("Answer values are recorded AS GIVEN").
- Epoch rule: `recorded.length > 0` → markSubmitted + takeSnapshot + bumpEpoch. A rejected-only
  call must stay zero-side-effect.
- Caller/render: src/tool.ts:398-414 — statusLine + `not recordable (moot/withdrawn/closed): {ids}`
  + `unknown ids: {ids}` + `no answers recorded`. New `rejected` bucket renders the same shape.
- Side-chat apply: `applyChatAnswer` (actions.ts:592) seeds buffer with decision.text then calls
  writeInEnter — chain-protected. The parser NEVER produces blank ApplyDecisions ("empty-text"
  rule, sidechat.ts:518 `text.trim() !== ""`). Test injects a hand-built decision for
  defense-in-depth proof. ApplyDecision = `{seam:"acceptOptionIndex";optionIndex} |
  {seam:"writeIn";text}` (sidechat.ts:141-143).

## Inline reason mechanism (no new pattern needed)

`panel.flash(text)` (panel.ts:2076-2086) — transient line one above the footer, ~2.5s
(FLASH_MS), self-invalidating; assertion precedent `panel.footerFlash?.text` (actions.test.ts
"nothing to submit" tests). Pin the exact string `Answer cannot be blank` (spec's example).

## Tests that assert the OLD rule (must be rewritten)

- actions.test.ts:286-291 (accept→empty-enter→blur, inside a text-question test)
- actions.test.ts:1564 test_wi_enter_empty_buffer_on_answered_with_victims_never_gates
- actions.test.ts:1648 test_wi_enter_empty_buffer_saves_draft_no_commit
- actions.test.ts:1667 test_wi_enter_empty_buffer_reseeds_to_recorded_answer_row
Also JSDoc: writeInEnter's block (actions.ts:392-418) documents the old empty rule — must be
rewritten (stale-comment = review blocker per codebase norms).

## State throw idiom

`applyAnswer` already throws on unknown id (`unknown question id: ${id}`); guards.ts uses typed
throws (StaleError) — throwing on blank is the established "refuse" idiom and keeps forgotten
ingresses loud. Export a shared predicate (e.g. `isBlankAnswerValue`) so fallback + S2 pre-check.

## Interplay with parallel/landed items (no file overlap)

- P3.M3.T1.S1 (in flight): editor seeding ladder (panel.ts focusTextField/seed) — no conflict.
- P3.M3.T1.S2 (in flight): reconstruct.ts/index.ts/command.ts/panel.ts/input-restore.ts —
  no overlap with this item's files (state.ts/actions.ts/fallback.ts/tool.ts).
- P3.M4.T1.S2 (next): consumes `isBlankAnswerValue` + throw contract to guard replay
  (reconstruct.ts:438 `resolved === ""` → widen to blank predicate) + case-5 replay halves.
- Case 5 first gesture ("Reopen a committed Other/text answer; verify its exact value") works
  via P3.M3.T1.S1's ladder (no newer draft → answer.value seeds) — nothing here.

## Validation commands

- `npm test` (vitest run), `npm run typecheck` (tsc --noEmit), `npm run lint` (eslint src scripts *.ts)
- Targeted: `npx vitest run src/state.test.ts src/panel/actions.test.ts src/fallback.test.ts src/tool.test.ts`

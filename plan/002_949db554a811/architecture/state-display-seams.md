# STATE + DISPLAY + PROTOCOL seams — write-in answer marker (`answer.custom: true`) delta PRD research

Repo: `/home/dustin/projects/pi-structured-interrogation`. Read-only audit of `src/`; all line refs are exact as of this pass. The PRD delta adds `answer.custom: true` where `value` holds free text displayed as `✎ {text}`.

---

## 1. src/state.ts

**QuestionAnswer type — `src/state.ts:42-49`:**
```ts
export interface QuestionAnswer {
  value: string;   // :44 chosen option value (choice) or raw text (text)
  text?: string;   // :46 free-text elaboration
  at: string;      // :48 ISO timestamp
}
```
- Carried on `Question.answer?: QuestionAnswer` (`:80`), serialized verbatim by `serialize()` (`:456-465`).

**applyAnswer — `src/state.ts:354-360`:**
```ts
applyAnswer(id: string, answer: QuestionAnswer): void {
  const q = this.questions.get(id);
  if (q === undefined) throw new Error(`unknown question id: ${id}`);
  q.answer = { ...answer };   // :357 fresh copy
  q.status = "answered";      // :358 status → answered (pending)
  this.emitChanged();         // :359
}
```
- Statuses (`QuestionStatus`, `:20-28`): open/answered/submitted/reasked/moot/withdrawn/closed. Transitions live in merge.ts (`markSubmitted`) and lifecycle close pass (`submitted → closed`); `setStatus` is the raw primitive (`:364-371`).
- **Epoch bump**: `bumpEpoch()` `:392-397` — emits `epoch-bumped` then `changed`; called by `delivery.buildSubmission:186` and `fallback.recordAnswers:261`, never by applyAnswer.
- **Snapshot ring**: `snapshots: Snapshot[]` field `:246`; `takeSnapshot` (snapshots.ts:196) pushes, ring of 10 (`SNAPSHOT_RING_SIZE`, snapshots.ts:24). Ordering contract: takeSnapshot BEFORE bumpEpoch.
- **Change events**: typed `StateEvents` map `:117-124` — `changed: [SerializedState]`, `questions-upserted`, `epoch-bumped`, `completed-cleared`. Every mutation funnels through private `emitChanged()` `:547-549`.
- **"custom" concept**: NONE. `grep custom src/state.ts` only hits the deserialize docblock comment ("persisted custom entries", `:437`). No `custom`/write-in flag exists anywhere in state.
- **Deserialize tolerance**: `reviveQuestion` `:499-566` rebuilds `answer` at `:557-563` (value/at required, text optional) — a new `custom?: true` field must be added here to survive reconstruction.
- **Who calls applyAnswer** (panel commit path):
  - `src/panel/actions.ts:239` — accept path (`panel.state.applyAnswer(q.id, proposed)`), then `evaluateDependsOn` immediately after (`:243`).
  - `src/panel/ripple-confirm.ts:139` — confirmed ripple edit (`panel.state.applyAnswer(cm.questionId, cm.proposed)`).
  - `src/panel/actions.ts:324/329` — `reconcileDraftsForSubmit` flushes typed-draft answers and ✎ elaborations (`applyAnswer(q.id, { value: text, at })` for text drafts; `{ ...q.answer, text }` to attach elaboration) BEFORE the submit diff is computed (`actions.ts:362`).
  - Non-panel: `fallback.recordAnswers` `fallback.ts:250`, `remote-submit.ts:99`.

## 2. src/tool-schema.ts

**AnswerInput — `src/tool-schema.ts:156-163`:**
```ts
export interface AnswerInput {
  id: string;    // :158
  value: string; // :159 chosen option value (choice) or raw text (text)
  text?: string; // :161 free-text elaboration
}
```
- TypeBox wire schema for `answers[]` — `InterrogateParams` `:118-121`:
```ts
answers: Type.Optional(Type.Array(Type.Object({
  id: Type.String(), value: Type.String(), text: Type.Optional(Type.String()),
}), { description: "Non-TUI fallback only: record the user's chat answers" })),
```
- Routing: `parseInterrogateParams` `:266` — answers parsed at `:313-324` via `narrowAnswer`; routing precedence `:334-342` (questions → answers → reopen → read). `narrowAnswer` `:494-518`: requires non-empty `id` and non-empty `value` strings; optional `text` string; never throws, pushes `{path, message}` errors.
- **A new optional `custom` field flows**: add `Type.Optional(Type.Boolean())` in the schema object (`:118`), a `custom?: boolean` on `AnswerInput` (`:156`), and a tolerant `if (raw.custom !== undefined) { typeof === "boolean" ? a.custom = raw.custom : error }` in `narrowAnswer` (`:494`).
- Executor consumption: `tool.ts:420-452` `case "record"` — `assertFresh(existing, parsed.action)` at `tool.ts:424` (epoch guard, guards.ts); TUI → ignored (`:428-433`); non-TUI → `recordAnswers(state, parsed.action.answers)` `:437` which passes each AnswerInput to `applyAnswer` (fallback.ts:250).

## 3. src/renderers.ts

**Submission diff card — `buildSubmissionCard` `src/renderers.ts:130`:**
- Entry line construction at `:171`:
```ts
let line = `${INDENT}${e?.title ?? ""}: ${e?.from ?? ""} → ${e?.to ?? ""}`;
if (e?.editedArchived) line += theme.fg("warning", CHANGED_MARKER); // :172 (changed) AC-13
```
- Truncation: collapsed lines through `truncateToWidth(line, COLLAPSED_LINE_BUDGET)` (`:173`; budget const `:61` = 80 cols, ANSI-aware); expanded = no truncation (`:169`).
- Entry cap: `COLLAPSED_ENTRY_CAP = 8` (`:67`); `shown = entries.slice(0, CAP)` (`:169`), `+{m} more` rollup (`:177-179`).
- NOTE line `:182-185` (`card.note` truthiness — key omitted, never empty).
- **✎ slot for write-ins**: `e.from`/`e.to` come pre-summarized from `snapshots.answerSummary`. For `answer.custom`, either (a) `answerSummary` emits `✎ {value}` itself (single change, propagates everywhere), or (b) `DiffEntry` gains `custom?: boolean` and renderers.ts:171 renders `${INDENT}${title}: ${from} → ✎ ${to}`. Option (a) also covers the completion record and digest with zero renderer changes; option (b) keeps the raw text in `value`/`to` clean.
- Completion recap card `buildCompletionRecapCard` `:314` — question line at `:371`:
```ts
let line = `[${g?.group ?? ""}] ${q?.id ?? ""} ${q?.title ?? ""}: ${q?.answer ?? ""}`;
if (q?.star) line += ` ${theme.fg("accent", "★")}`;      // :372
if (q?.freeText) line += ` — ${q.freeText}`;              // :373
```
  `freeText` key is omitted when absent → truthiness check (`:373`). A write-in `✎ {text}` would slot into `q.answer` (built by `completionAnswerSummary`, delivery.ts:269) or as a new `customText` field on `CompletionRecapEntry` rendered like the ★ branch.

## 4. src/completion.ts

- `attemptCompletion` `src/completion.ts:107-144` — side-effect order (`:138-142`): `buildCompletion(state, notes)` → `deliverSubmission(pi, msg, ctx)` → `opts.lifecycle.dismissPanel()` → `state.clearForCompletion()`. Builds from the FULL state BEFORE clearing.
- The completion RECORD format function is `buildCompletion` in **delivery.ts** (`src/delivery.ts:310`); completion.ts only triggers. Recap card data is `CompletionMessage.details` (delivery.ts:246-258): `goal`, `groups: CompletionRecapGroup[]`, `notes`, `withdrawnMoot`, `completedAt`, `epoch`.
- `CompletionRecapEntry` (delivery.ts:214-226): `{ id, title, answer, star, freeText?, answeredAt? }` — `answer` is label-preferred via `completionAnswerSummary` (delivery.ts:269-275); `freeText` set from `q.answer?.text` when non-empty (delivery.ts:349-352). Write-in `✎ {text}` renders here: either in `completionAnswerSummary` (needs the Question to detect `answer.custom`) or as a new entry field.

## 5. src/results.ts

- `buildReadResult` `src/results.ts:129` — content: `Goal:` line, `buildStatusLine` (`:82`, `"{answered}/{total} answered · {reasked} re-asked · {moot} moot · epoch {n}"`), group summaries (`groupSummaryLines` `:189`), then per-question `questionBlock` (`:213`).
- Answer appears in the one-liner — `questionLine` `:235-241`:
```ts
let line = `${q.id}: ${label} — ${q.status} (rev ${q.rev})`;
if (q.answer !== undefined) line += ` · answered: ${q.answer.value}`;  // :240 RAW value
```
  Note: read output shows the **raw `answer.value`** (no label mapping, no `text`). For a write-in, this line should become `· answered: ✎ {value}` when `answer.custom` — the single seam is `questionLine:240`. `details.state` (envelope `:180-183`, structuredClone) carries the answer verbatim so `custom` flows automatically.
- `buildUpsertResult` `:167` carries no answers.

## 6. src/fallback.ts

- `buildFallbackDigest` `src/fallback.ts:125` — non-TUI numbered markdown digest. Renders QUESTION state (heading `**{n}. {title ?? prompt[0..60]}** (\`{id}\`)` `:151`, prompt, option lines `optionLine` `:174`, `Recommendation:` `:166`) — it does **NOT display existing answers** (it's the ask surface). Write-in display would land in the `record` result path instead: `recordAnswers` `:223-263` applies answers (`:250` `applyAnswer(answer.id, applied)` with `text` passthrough at `:249`), then `markSubmitted` → `takeSnapshot` → `bumpEpoch` (`:259-261`). The record result text is assembled by tool.ts (`:437-452`: recorded/unknown/ignored lines + status line). If the non-TUI digest ever shows answers (re-relay), the heading block at `:148-170` is the seam. `TERMINAL_ANSWER_STATUSES` gate at `:239-244` (moot/withdrawn/closed ignored).

## 7. src/snapshots.ts

- Model: `Snapshot = { epoch, at, state: SerializedState }` (type in state.ts:110-115). `takeSnapshot` `snapshots.ts:196` pushes `state.serialize()` into the ring, drops oldest past `SNAPSHOT_RING_SIZE = 10` (`:24`). MUST run before `bumpEpoch`.
- `submissionBaselineOf(state)` `:43-48` — latest snapshot's `.state` or a fresh empty baseline (`{goal:"", epoch:0, order:[], questions:{}, completed:false}`).
- **Diff derivation**: `computeEntries(prev, next)` `:180-199` — for the union of ids, entry iff `answerSignature` differs. `answerSignature` `:111-115`: `` `${answer.value}\u0000${answer.text ?? ""}` `` (text-only edits count). **A `custom` boolean alone won't change the signature** — but a write-in changes `value` anyway, so it diff-diffs naturally.
- `answerSummary` `:124-135` — label-preferred for choice (`options.find(o.value===answer.value)?.label ?? answer.value`), **raw value for text**, `"(unanswered)"` (`:51`) when missing; NEW-003 appends ` — {answer.text}` when text non-empty (`:132-134`). **Yes — a write-in value shows raw text** in `from`/`to`; the `✎ {text}` prefix would be added here (single chokepoint for card + digestSince) or via a new `DiffEntry.custom` flag.
- `DiffEntry` `:56-88`: `{ id, title, from, to, editedArchived, value? }` — `value` (`:80-88`) is the RAW post-change `answer.value` for machine consumers (replaySubmission); `to` stays display-only.
- `computeDiff` `:236-250` → `SubmissionCardData { changed, note?, epoch, remainOpen }` (`:98-105`). `digestSince` `:288+` joins `` `${e.id}: ${e.from}→${e.to}` `` per submission.
- **BUG-008 filter**: NOT in snapshots.ts — it's in the panel submit path, `src/panel/actions.ts:372-383`. `pendingIds` = ids with status `"answered"` captured BEFORE `markSubmitted`; then:
```ts
const userChanged = diff.changed.filter(
  (e) => pendingIds.includes(e.id) || !(e.to === "(unanswered)"),
);
```
  i.e. drop entries the user didn't ship whose answer went to "(unanswered)" (agent rule-2 resets). computeDiff itself is status-blind.

## 8. src/delivery.ts

- `buildSubmission(state, diff, note?)` `src/delivery.ts:140-198`:
  - Content line 1: `Submitted {k}: {id}: {to}[ (changed)]; … (state epoch {postEpoch})` — entries from `diff.changed` (`:143-144`), budget `SUBMISSION_LIST_MAX_CHARS = 240` (`:56`) with end-drop + `+{m} more` loop (`:165-173`); epoch suffix is POST-bump (`diff.epoch + 1`, BUG-003) at `:157`.
  - Line 2: `SUBMISSION_REMINDER` (`:46`). Line 3 (optional, model-visible): `NOTE: {note}` (`:180-184`).
  - **Pipeline order (side effects inside the builder, `:185-186`)**: `takeSnapshot(state)` THEN `state.bumpEpoch()` — exactly once each, after formatting.
  - `details` shape (`:188-194`): `{ changed: DiffEntry[], note?, epoch: diff.epoch (PRE-bump), card: SubmissionCardData }`.
- `buildCompletion(state, notes?)` `:310+` — pure; produces h2.46 record content + `details` recap (`:246-258`); moot reasons recomputed via `evaluateDependsOn` (`:338`).
- `deliverSubmission(pi, msg, ctx?)` `:497+` — busy → `{deliverAs:"steer"}`; idle → `{triggerTurn:true, deliverAs:"followUp"}`; one `pi.sendMessage` call; also appends shipped `details.note` to the batch-note ledger; `drainBatchNotes()` `:540` drains it for the completion record.
- Panel caller: `src/panel/actions.ts:submit()` (`:358`) — reconcileDraftsForSubmit → computeDiff → BUG-008 filter → gate warning → `markSubmitted(pendingIds)` (`:436`) → `buildSubmission(panel.state, { ...diff, changed: userChanged }, note)` → `deliverSubmission` → clear note.

## 9. src/depends-on.ts

- Exported recompute entry point: **`evaluateDependsOn(state: InterrogationState): MootEvaluation`** — `src/depends-on.ts:168`. Invoked after every applied answer: panel accept (`actions.ts:243`, right after `applyAnswer`), ripple confirm (`ripple-confirm.ts` docblock `:19`), reconstruction step 5, and `buildCompletion` (`delivery.ts:338`). Other exports: `dependencyMet` `:113`, `computeRipple` `:234`. (Property is `mootered` on MootEvaluation — see `delivery.ts:338` `.mootered.map(...)`; check exact field name when writing tests.)
- A write-in that satisifies a `dependsOn.equals` compares against `answer.value` (raw free text) — no display logic here.

## 10. Existing tests (patterns for new ✎ display tests)

| File | Asserts about answer display |
|---|---|
| `src/state.test.ts` | `describe("applyAnswer")` :163 — answer copy, status → answered, throw on unknown id; revive/round-trip of `text` (:320). Custom-field round-trip test belongs here. |
| `src/tool-schema.test.ts` | `narrowAnswer`/answers parsing (routing, error paths) — pattern for a `custom` boolean guard test. |
| `src/renderers.test.ts` | `describe("buildSubmissionCard")` :91 — collapsed/expanded line snapshots, `(changed)` styling, truncation, NOTE line; also recap card groups (calls pure builder with stub theme, `lines()` helper :86). ✎ line tests follow the same literal-shape assertions. |
| `src/delivery.test.ts` | `buildSubmission — content` :78, `— details` :175, epoch suffix :236, NOTE line :716, `buildCompletion` :539 (record grammar incl. ` — {free text}` segments and ★), transport :315. |
| `src/results.test.ts` | `buildStatusLine` :48, `buildReadResult` :87 (per-question blocks incl. `· answered: {value}` one-liners), details contract :182. |
| `src/fallback.test.ts` | `buildFallbackDigest` :141 (heading/options/★), `recordAnswers` :230 (apply+submit side effects, ignored/unknown buckets). |
| `src/snapshots.test.ts` | `computeDiff` :95 (label-preference :340, raw-value fallback :353, text-question raw value :363, text-elaboration changes :154-156), `diff entry value semantics` :327, `digestSince` :285. |
| `src/completion.test.ts` | `attemptCompletion` decision/fires-once/order :150-285. |
| `src/panel/actions.test.ts` | submit path incl. BUG-008 filter, accept→applyAnswer (:226), draft reconciliation (✎ elaboration → `answer.text`). |
| `src/tool.test.ts` | `executeInterrogate: record` :495 (TUI ignore vs non-TUI record), read :146. |

## custom-flag flow map

Where `answer.custom` must be read for display, surface by surface (assuming `QuestionAnswer.custom?: boolean`, `value` holds the write-in text):

1. **Wire/parse** — `tool-schema.ts:118` schema + `AnswerInput` (:156) + `narrowAnswer` (:494): optional boolean passthrough. (If write-ins only originate in the panel, this may be validation-only.)
2. **State** — `state.ts:42` QuestionAnswer gains `custom?: boolean`; `applyAnswer` (:354) already copies verbatim (`{ ...answer }`); **`reviveQuestion` :557-563 MUST revive it** or reconstruction silently drops it (deserialize tolerance gotcha).
3. **Snapshots/diffs** — `snapshots.ts:111 answerSignature` (no change needed — value differs) and **`answerSummary` :124 is the ✎ chokepoint**: choice branch must not label-lookup a write-in value; emit `✎ ${answer.value}` when `answer.custom` (or new `DiffEntry.custom?: boolean` from `computeEntries` :180 if display should stay renderer-side). `digestSince` (:288) and `value` (raw, :188) inherit automatically.
4. **Submission card (TUI)** — `renderers.ts:171` `{title}: {from} → {to}`: if ✎ is baked into `to` by answerSummary, zero changes; otherwise add a `custom` branch here (and in collapsed truncation — `✎ ` prefix eats 2 cols of the 80 budget).
5. **Submission content (model-visible)** — `delivery.ts:143-144` `{id}: {to}` entries: inherits via `to`; no per-entry change needed if answerSummary carries ✎.
6. **Completion record + recap** — `delivery.ts:269 completionAnswerSummary` (label-preferred; needs a `custom → ✎ value` branch) feeding both `content` question lines (delivery.ts:355-358) and `CompletionRecapEntry.answer` (:343-348); recap card renders it at `renderers.ts:371` unchanged.
7. **Read result** — `results.ts:240` `questionLine` `· answered: {q.answer.value}`: branch to `✎ {value}` when custom. `details.state` carries `custom` for free.
8. **Fallback / non-TUI** — `fallback.ts:250 recordAnswers` passthrough (add `custom` to the `applied` object); digest (`buildFallbackDigest` :125) shows no answers, so no display change unless re-relay format is added; the record result text is built in `tool.ts:437-452`.
9. **Panel** — `✎` glyph already exists as the elaboration affordance in `panel/short-view.ts:64` (`"✎ explain…"`); write-in display in the panel itself (short/deep view) reuses that visual vocabulary — outside the 10 audited files but the glyph precedent is there.
10. **Persistence/reconstruct** — `custom` rides `SerializedState` automatically via `serialize()`; only `reviveQuestion` (state.ts:557) needs the explicit revive (see #2).

Gotchas: `answerSummary` vs `completionAnswerSummary` are DUPLICATED BY DESIGN (delivery.ts:269 replicates the snapshots.ts:124 private; comment marks the sync reference) — a ✎ branch must be added to BOTH. Display strings are never truncated in snapshots/delivery; truncation belongs to renderers (80-col collapsed budget) and the delivery content line (240-char budget). `answerSignature` uses `value\0text` — a pure `custom` toggle with identical value/text would NOT diff.

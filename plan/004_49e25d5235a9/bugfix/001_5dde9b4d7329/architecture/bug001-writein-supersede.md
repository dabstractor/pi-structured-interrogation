# BUG-001 (Major): Write-in supersede re-bind (WRITEIN-002) unreachable in real flows

Research report — plan/004_49e25d5235a9/bugfix/001_5dde9b4d7329 · read-only investigation of src/, spec/, README.md, plan/002_949db554a811 history.

**Claim under test.** WRITEIN-002 promises: commit a write-in → later accept a real option on that question → the write-in text is KEPT in the draft slot and re-binds as `answer.text` at the next submit. The shipped test passes, but only because it manually re-creates the slot state that the real commit path destroys. Verified below with file:line citations.

---

## (a) Current flow trace

### The write-in commit destroys the slot (both commit paths)

`src/panel/actions.ts:357` — `export function writeInEnter(panel: InterrogationPanel): boolean`

Real-commit tail (non-empty, non-inert buffer):

- `actions.ts:447` `panel.state.applyAnswer(q.id, answer);` where `answer = { value: text, at: … }` + `custom: true` (unless the reasked kind-preservation re-confirm at :437-444).
- `actions.ts:460` `panel.consumeCommittedBuffer(q.id);` — comment above it (":456-459"): *"VAL-002: the buffer text just BECAME the answer — consume it so the advance's draft write-through can never copy committed text into q's draft slot (a later option accept would ship it as a bogus elaboration of the new choice). Must precede advanceAfterAccept."*
- Inert byte-identical path does the same: `actions.ts:409` `panel.consumeCommittedBuffer(q.id); // BEFORE advance: kill the write-through source`.

`src/panel/panel.ts:982-991` — `consumeCommittedBuffer(questionId: string): void`:

```ts
982  consumeCommittedBuffer(questionId: string): void {
983    if (this.bufferOwner !== questionId) return;
984    this.textField.seed("");
985    this.draftSlots.delete(questionId);
986    this.drafts?.clearDraft?.(questionId, { explicit: true });
987    this.bufferOwner = undefined;
988  }
```

So after a real write-in commit the question has **no panel-local slot and no DraftStore entry**. The deferred modal commit path is identical: `src/panel/ripple-confirm.ts:293-316` (`applyWriteInConfirm`) calls `panel.consumeCommittedBuffer(cm.questionId)` at `:305`.

The only path that leaves a slot is the **empty-buffer** save (`actions.ts:369` `panel.commitTextDraft(q.id, text)` — a draft, never a commit) or a genuine user elaboration gesture (`panel.commitTextDraft`, `panel.ts:903-926`).

### The option accept does not re-stage anything

`src/panel/actions.ts:268` — `export function acceptOptionIndex(panel: InterrogationPanel, q: Question, optionIndex: number): AcceptOutcome`

- `:294` `const recorded = q.answer;` (captured for the ANSWER-PIN-001 inert check; requires `recorded.custom !== true` at `:296`, so a **write-in answer can never take the inert path** — every apply that follows a `custom:true` recorded answer is a genuine supersede).
- `:299` `const proposed = { value: opt.value, at: new Date().toISOString() };`
- `:310` FR-18 seam gate for answered/submitted/closed (victims > 0 → modal, `ripple-confirm.ts:123-136` stashes `kind:"choice"` and returns `"veto"`).
- `:313` `panel.state.applyAnswer(q.id, proposed);` — `state.ts:374-380` **replaces the whole answer** (`q.answer = { ...answer }`), so the old custom answer's text (if any) is dropped and nothing is staged into the draft slot.
- `:315-317` evaluateDependsOn → advanceAfterAccept → maybeAutoSubmit.

No draft-slot logic anywhere in this function. The superseded write-in's value is simply gone.

### The submit-time re-bind that never finds the text

`src/panel/actions.ts:557-585` — `function reconcileDraftsForSubmit(panel: InterrogationPanel): void` (module-private; called only from `submit` at `:634`). Attach branch:

```ts
573    if (
574      q.status === "answered" &&
575      q.answer !== undefined &&
576      q.answer.custom !== true // a write-in's draft already IS answer.value — never also attach as text
577    ) {
578      panel.state.applyAnswer(q.id, { ...q.answer, text });
579    }
```

with `const text = panel.draftTextFor(q.id)` at `:559` (`panel.ts:1208-1210`: `draftSlots.get(questionId)?.text ?? this.drafts?.getDraft(questionId)` — `undefined` when both are gone).

The function's own design comment at `actions.ts:538` states the broken assumption verbatim: *"Spreading the CURRENT answer re-binds superseded write-ins for free: a write-in later superseded by an option accept replaced the answer with the option's value and cleared `custom`, while the slot text was KEPT (R4 — accept never touches the draft store), so this branch attaches the kept text as elaboration at the next ctrl+s."* — **true about `accept` (it never touches the store) but false about the *commit* that preceded it (which deleted both slot and store entry)**. The half of the invariant VAL-002's fix created ("accept never touches drafts") silently relied on the half it destroyed ("the slot text was kept").

### Net flow

1. User commits write-in "my custom take" on q1 → answer `{value:"my custom take", custom:true}`; **slot deleted, store entry cleared** (`actions.ts:460` → `panel.ts:985-986`).
2. User revisits q1 (ANSWER-PIN-001 seeds cursor to the ✎ row), moves to option row 0, enter → `acceptOptionIndex` applies `{value:"a", at}` → answer now non-custom; slot still absent.
3. ctrl+s / auto-submit → `reconcileDraftsForSubmit:559` reads `draftTextFor("q1")` → `undefined` → `:560` `continue` → **no elaboration attached**. Ships `q1: Alpha` — the write-in text is lost, contradicting WRITEIN-002.

### The shipped test manufactures the unreachable state

`src/panel/actions.test.ts:2213` `test("test_submit_superseded_writein_rebinds_as_elaboration", …)`:

- `:2219-2221` `commitWriteIn(panel, "my custom take")` (helper at `:2161-2167`: real `accept(panel)` on the ✎ row + `handleInput("\r")` → **runs the real commit, i.e. the real consume**).
- `:2223` `panel.commitTextDraft("q1", "my custom take"); // kept slot text (R4)` — **manual re-staging of exactly what `consumeCommittedBuffer` just deleted**. No real gesture produces this state after a commit; only a *pre-commit* elaboration save would, which is a different scenario (test at `:2169`).
- `:2226-2230` supersede via real accept; asserts slot KEPT (`:2230` — passes only because of `:2223`); `:2236-2242` submit asserts `a?.text === "my custom take"` and the shipped line `q1: Alpha — my custom take`.

Verified green today: `npx vitest run src/panel/actions.test.ts -t "superseded"` → 1 passed. Remove line 2223 and the test fails (slot `undefined` after commit; no re-bind) — confirming the promise is unreachable through the real commit path.

---

## (b) Contract texts (verbatim)

**spec/ui-spec.md:37** (WRITEIN-002):

> **Draft role follows the selection (WRITEIN-002).** ONE draft slot per question (R4, unchanged). Its role is bound at commit/submit time by what is selected: a real option → the draft is elaboration, shipping as `answer.text`; Other (or `type:"text"`) → the draft IS the answer, shipping as `answer.value` (`custom: true`). **If a write-in is later superseded by accepting a real option, the slot's text is KEPT (R4 — never destroyed) and re-binds as elaboration for the new selection; it attaches at the next submit.** A draft with NO answer on its question stays held (unattached elaboration) — it ships nothing, and the zero-pending flash names it: `nothing to submit — {n} question(s) have drafts awaiting an option or Other`.

**spec/product-requirements.md:84** (AC-2b):

> 2b. **Elaboration (WRITEIN-001)**: `t`, type, `enter` → draft saved, question still unanswered; accept a real option → elaboration attaches as `answer.text` at submit; **accepting a real option after a committed write-in keeps the slot's text as elaboration (WRITEIN-002)**.

**README.md:225-228** (Editor section):

> … editor is the **elaboration** duty: the text attaches to whichever option you select and ships as the answer's text — an elaboration, not an answer of its own. **Accepting an option after a committed write-in supersedes the answer and re-binds the kept slot text as elaboration.**

**README.md:279** (Acceptance list):

> 2b. **Elaboration (WRITEIN-001/002)**: `t`, type, `enter` → draft saved, still unanswered; option accept attaches it as `answer.text`; **a real option after a committed write-in re-binds the slot as elaboration.**

Supporting R4 framing, spec/ui-spec.md:43: "Every exit is a draft write-through — backing out never loses typed text (R4)" and the DraftStore survival matrix (draft-store.ts header): destroyed only by submission or explicit user clear.

---

## (c) VAL-002 history

`plan/002_949db554a811/bugfix/001_c0ff03282c6f/validation_report.md`, **Issue B / VAL-002 (Minor)**:

> **Issue B: Superseding a committed write-in with an option silently ships the stale write-in as an "elaboration"** · Severity: Minor · ID: VAL-002 · Location: `src/panel/panel.ts` (`syncBufferToQuestion` write-through firing from `writeInEnter`'s advance) + `src/panel/actions.ts` (`reconcileDraftsForSubmit`'s kept-slot re-binding); amplified by `draftSlots` not being cleared when `shipDrafts` flushes the store.
>
> When a write-in commits, `writeInEnter` → `advanceAfterAccept` changes `currentId`, and the setter's draft write-through copies the just-committed buffer into the outgoing question's draft slot (+ DraftStore). The user never performed a draft gesture — the text already became the answer. If the user later changes their mind and accepts a real option on that question, `reconcileDraftsForSubmit` finds the stale slot and attaches it as `answer.text`, so the submission ships `q1: Alpha — my custom answer` — presenting the abandoned write-in as the rationale for the new choice.
>
> **Fix direction**: skip the write-through when the buffer was just committed as the answer (or clear the question's slot when an option accept supersedes a `custom:true` answer), so only user-held drafts re-bind.

Two fix directions were offered. The implemented fix chose the first, in its strongest form: `consumeCommittedBuffer` (delete slot + explicit-clear store + disown buffer) at every commit exit (`actions.ts:409, 460`; `ripple-confirm.ts:305`), pinned by tests `test_wi_same_value_recommit_consumes_buffer_no_draft_residue` (`actions.test.ts:776-786`) and the reasked variant (`:816-840`). The fix is correct for its own bug — a *machine-copied* buffer must not become elaboration — but it also deleted the only carrier of the superseded write-in's text, which WRITEIN-002's re-bind promise depends on. The validator's own alternative ("clear the slot when an option accept supersedes a custom:true answer, so only user-held drafts re-bind") implicitly preserved the re-bind for genuinely-held text; the implemented form did not. The shipped supersede test (`:2213`, added in the same era) papered over the gap by re-staging the slot by hand.

---

## (d) Recommended fix design — "restore rebind" (per PRD recommendation)

**Principle.** Keep VAL-002's consume-at-commit (machine-copied buffers never become drafts) and re-create the slot **at supersede time, from the recorded answer's value, only when no user-held draft exists**. The staged slot is then an ordinary role-less draft (`h2.45`) that `reconcileDraftsForSubmit:573-579` binds as `answer.text` at the next submit — no changes to reconcile, submit, or the panel's draft internals.

### Touch point 1 — `acceptOptionIndex` (src/panel/actions.ts:268-321, direct/zero-victim + deep-view path)

`recorded` is already captured at `:294`. After `panel.state.applyAnswer(q.id, proposed)` (`:313`), insert:

```ts
stageSupersededWriteIn(panel, q.id, recorded, proposed.value);
```

(before `evaluateDependsOn`/`advanceAfterAccept` — order is not load-bearing since staging touches only drafts, but before-advance matches the file's commit-tail conventions).

### Touch point 2 — `applyConfirmedEdit` (src/panel/ripple-confirm.ts:142-166, FR-18 modal path)

The modal defers the same apply, bypassing `acceptOptionIndex`'s body. Capture before `:158`:

```ts
const recorded = panel.state.getQuestion(cm.questionId)?.answer;
```

and after `panel.state.applyAnswer(cm.questionId, cm.proposed)` (`:158`):

```ts
stageSupersededWriteIn(panel, cm.questionId, recorded, cm.proposed.value);
```

(`ripple-confirm.ts` already imports from `./actions.js` — `nextUnanswered` — so exporting the helper from actions.ts adds no cycle.)

### The helper (new, exported from src/panel/actions.ts)

```ts
/**
 * WRITEIN-002 re-bind (BUG-001 fix): an option accept just superseded a
 * committed write-in (`recorded.custom === true`). VAL-002's consume-at-commit
 * deleted the slot the text lived in; re-stage the write-in's value as a
 * role-less draft so reconcileDraftsForSubmit attaches it as answer.text at
 * the next submit — but NEVER over a user-held draft (any existing slot,
 * including a deleted-to-empty one, is the user's and wins).
 */
export function stageSupersededWriteIn(
  panel: InterrogationPanel,
  questionId: string,
  superseded: QuestionAnswer | undefined,
  newValue: string,
): void {
  if (superseded === undefined || superseded.custom !== true) return; // 1: only write-ins
  const text = superseded.value;
  if (text.trim() === "") return;                                   // 2: degenerate
  if (text === newValue) return;                                    // 3: no "Alpha — Alpha"
  if (panel.draftTextFor(questionId) !== undefined) return;          // 4: user-held draft wins
  panel.commitTextDraft(questionId, text);
}
```

### Guard rationale (answering the PRD's open questions)

1. **`custom !== true` return** — only superseded *write-ins* re-bind. Non-custom recorded answers took the ANSWER-PIN-001 inert branch already when byte-equal, so any apply here is a plain option→option edit with no kept-text contract. Note the inert branch at `:296` requires `recorded.custom !== true`, so a `custom:true` recorded answer **cannot** reach the no-op — every apply behind a custom answer is a genuine supersede; no extra "did the value change" check is needed for that purpose.
2. **Empty/whitespace guard** — reconcile skips whitespace-only drafts anyway (`:560`), but staging garbage would light the ✎ marker for nothing.
3. **`text === newValue` return** — the one real overlap case: a write-in whose text byte-equals the accepted option's value (a pure kind flip). Staging would ship `q1: Alpha — Alpha`. Skip.
4. **`draftTextFor(questionId) !== undefined` return** — the "no user-held draft" guard. After `consumeCommittedBuffer` both slot and store entry are gone (`undefined` exactly); any subsequent user gesture creates a defined slot — a typed elaboration (non-empty) *or a deliberate delete-to-empty* (`""`, honored by `syncBufferToQuestion`'s absent-draft discipline). Either way the user's slot wins and is never clobbered. This is stricter than a `.trim() === ""` check, which would resurrect text the user explicitly deleted.
5. **New-answer kind is implicit** — the helper is only called from option-accept sites; `applyWriteInConfirm` (write-in→write-in edit, custom stays `true`) must NOT call it: reconcile skips custom answers (`:576`), so staging there would light the ✎ marker and never ship — pure noise.

### Why `commitTextDraft` is the right staging primitive

`panel.ts:903-926` writes the panel-local slot (`:905`), the DraftStore seam (`:906`), then `blurTextField()` (`:925`). In the option-accept context: focus is already `"options"` (enter on an option row never runs with the editor focused; the modal path likewise), so the blur is an idempotent reset of `textDuty`/`lastEscAt` + one `invalidate` — the same side effects the file already treats as harmless ("double invalidate is harmless", actions.ts header). The EXPLAIN-003 cursor re-seed inside `commitTextDraft` (`:910-923`) is guarded by `currentId === questionId && cursorIndex >= options.length` — the supersede gesture has the cursor on an option row (`cursorIndex < options.length`), and `applyConfirmedEdit` runs from the modal, so the re-seed cannot fire. Direct `draftSlots.set` is not available (private, `panel.ts:423`); `commitTextDraft` is the sanctioned public seam.

### Visible or hidden?

**Visible.** The staged slot is a real draft: the ✎ marker lights (`hasDraft`, draft-store.ts), the editor seeds from it on `t`/✎-row entry, and the user can edit or clear it before submit. This is what the contract describes ("the slot's text is KEPT … re-binds as elaboration") and what README advertises. A hidden/parallel mechanism would add a second draft concept and an R4-destruction surface for zero benefit. One UX note (not a defect): after a supersede the question shows a ✎ draft marker the user never typed *in that slot* — acceptable, since the text is verbatim what the user themselves wrote as the write-in.

### Redundancy of the test's manual re-staging

With the fix, `actions.test.ts:2223` (`panel.commitTextDraft("q1", "my custom take")`) becomes redundant *and actively misleading* — it is exactly the "user-held draft" that guard 4 defers to, so the test would still pass but would no longer exercise the fix. Deleting the line converts the test into the real-flow regression test: `commitWriteIn` (real consume) → real accept (fix stages) → `:2230`'s `expect(panel.draftTextFor("q1")).toBe("my custom take")` now asserts the fix itself, and the submit assertions at `:2236-2242` assert the end-to-end WRITEIN-002 promise.

---

## (e) Test impact analysis

**Unchanged / still green (no source change to their paths):**
- `actions.test.ts:776-786` `test_wi_same_value_recommit_consumes_buffer_no_draft_residue` (VAL-002 pin) — commit path untouched.
- `actions.test.ts:816-840` reasked re-confirm consume — commit path untouched.
- `actions.test.ts:2189-2211` `test_submit_writein_ships_value_custom_no_text_duplication` — manual `commitTextDraft` after commit, no option accept; reconcile's `custom !== true` guard already covers it.
- `actions.test.ts:2169-2187` `test_submit_elaboration_attaches_to_real_option_answer` — non-custom answer + user draft; unaffected.
- All ANSWER-PIN-001 / FR-18 / AUTOSUBMIT tests — behavior identical except the new staging (drafts are diff-invisible; the answer signature is value+text only, and the text attaches only at submit, which is the promise).

**Modified:**
- `actions.test.ts:2213-2242` — delete line 2223 (+ its comment); optionally strengthen with the auto-submit variant (supersede as the last-answerable edit on a complete set fires `maybeAutoSubmit` immediately; the *same-gesture* submission should carry `q1: Alpha — my custom take` — "attaches at the next submit" includes the auto path).

**New tests to add (all in the existing describe blocks, same fixtures):**
1. Real-flow re-bind (the rewritten 2213 covers this; keep as one test).
2. User-held draft wins: after write-in commit, `t` + type "my reasons" + enter, then accept option → `answer.text === "my reasons"` (old write-in value NOT staged over it).
3. Deleted-to-empty wins: after write-in commit, enter editor, clear buffer, enter (stages `""`), then accept option → no `answer.text` (guard 4 reads `""`, skips).
4. Kind-flip no-op: write-in whose text byte-equals option "a"'s value, accept "a" → no `answer.text`, shipped line has no `a — a` duplication.
5. Modal path: write-in on q1 with a dependsOn victim answered, supersede via option (FR-18 modal), enter to apply (`applyConfirmedEdit`) → slot staged, elaboration attaches at submit. (Zero-victim path is covered by 1.)
6. Non-custom supersede stages nothing: option "a" answered (with elaboration already shipped as text), switch to option "b" → no draft slot appears (`draftTextFor` stays `undefined`).

**Coverage gap to note in review:** tests must construct the FR-18 modal path explicitly (5); the shipped suite has no supersede-through-modal test today.

---

## (f) Open risks

1. **Second apply site** (`applyConfirmedEdit`, ripple-confirm.ts:158) — missing it leaves the bug alive on every victims>0 supersede. The fix must touch both call sites (or the helper call must be inlined identically in both).
2. **Guard-4 semantics choice**: `!== undefined` honors a deleted-to-empty slot as "user-held" (no re-bind). If product instead wants "any non-empty absence re-binds", the guard flips to `(panel.draftTextFor(questionId) ?? "").trim() === ""` — decision needed, but `undefined` is the more conservative R4 reading (recommended).
3. **Auto-submit timing**: on a complete set, the supersede edit itself can trigger `maybeAutoSubmit` (AUTOSUBMIT-003 rule b) → the re-bound elaboration ships in the same gesture, with no chance to edit/clear the staged draft first. This matches the letter of the contract ("attaches at the next submit") and README's framing, but is a UX call worth flagging in the PRD review.
4. **✎ marker surprise**: a superseded question lights a draft marker whose text the user last saw as an *answer*. Mitigated by the marker's existing semantics and the verbatim-identity of the text; still, release notes should mention it.
5. **VAL-002 E2E pin**: the validation harness pinned Issue B as a failing E2E (validate.sh, plan/002). The new fix reintroduces elaboration shipping on supersede *by design* — the old pinned scenario (stale machine-copied buffer) stays fixed because consume-at-commit is untouched, but any resurrected E2E from that harness must distinguish user-committed write-ins (re-bind wanted) from machine write-throughs (still suppressed). Re-run that harness against the fix.
6. **Comment debt**: `actions.ts:538` ("re-binds superseded write-ins for free … slot text was KEPT") is now half-true by design and half-true by the new staging; the fix should extend the comment to name `stageSupersededWriteIn` as the KEPT-text mechanism, so the next reader doesn't re-derive this bug.

### Alternative (rejected per PRD): amend docs to match implementation

Would require: `spec/ui-spec.md:37` (delete/rewrite "If a write-in is later superseded … attaches at the next submit"), `spec/product-requirements.md:84` (delete AC-2b tail "accepting a real option after a committed write-in keeps the slot's text as elaboration (WRITEIN-002)"), `README.md:227-228` and `README.md:279` (delete the re-bind sentences), `actions.ts:538` comment rewrite, and **deleting** the shipped test at `actions.test.ts:2213-2242` (it encodes the promise). Five documents/tests vs. two source sites + one helper — and it converts an advertised feature into silent data loss (the user's committed write-in text disappears on supersede, contra R4's "never destroyed" framing that the spec itself cites). Not recommended; recorded here for completeness.

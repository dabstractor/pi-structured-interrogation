# Research notes — P1.M4.T2.S1 Draft store

## Seam already waiting in the codebase
- `src/panel/panel.ts:67-76` defines `export interface DraftStore` with exactly:
  `getDraft(questionId: string): string | undefined`, `setDraft(questionId, text): void`,
  `getNote(): string`, `setNote(text): void`. Comment: "implemented by P1.M4.T2.S1. Accept a
  handle via openPanel options; the host never constructs one."
- `OpenPanelOptions.drafts?: DraftStore` (panel.ts ~line 96-98) and forwarded at line 673
  (`drafts: opts.drafts`) — so passing a store from the extension requires NO panel changes.
- Panel seeds text field from the seam on focus: panel.ts:438-440
  `this.drafts?.getDraft(this.currentId)`.
- panel.test.ts already stubs a DraftStore (getNote/getNote vi.fn) at lines 740/767.

## Parallel contracts (treat as landed)
- **P1.M4.T1.S2** (Implementing): adds `draftSlots: Map<string,{value,text}>` panel-local,
  `saveTextDraft()` calling `this.drafts?.setDraft(currentId, text)`, `saveNote()` calling
  `this.drafts?.setNote(text)`, refocus seeding `draftSlots.get(id)?.text ?? drafts.getDraft(id) ?? ""`.
- **P1.M4.T1.S3** PRP: external editor applies via `this.draftSlots?.set(...)` +
  `this.drafts?.setDraft(...)` — both optional-chained; our class satisfies both.

## Survival analysis (why survival is by omission)
- Drafts die with the panel component on suspend/resume (done(null) → new InterrogationPanel).
  Therefore the store MUST live outside the panel — extension memory in `src/index.ts`
  (one instance per extension activation), passed as `drafts` to every `openPanel` call.
  This alone gives: navigation survival (no clearing on question change), view-toggle survival
  (view state only), suspend/resume survival (panel recreated, store persists),
  upsert/rev-bump survival (merge.ts by design never touches drafts — see merge.ts:17-19).
- `state.ts` events: `changed`, `questions-upserted`, `epoch-bumped`, `completed-cleared`.
  There is NO `questionRevBumped` event in the shipped code (item text names the concept from
  the plan); drafts need NO subscription to any of them. Preservation = not subscribing.
- Restarts: index.ts creates the store at activation; nothing writes it to disk
  (persistence.ts is P1.M7.T1 and per h2.45 must NOT persist drafts). Documented limitation Q6=B.

## Submit flush integration point
- `src/panel/actions.ts:294 submit()` — computes `diff = computeDiff(pre, state.serialize())`;
  if `diff.changed.length > 0` → `buildSubmission(state, diff)` + `deliverSubmission`.
  Destruction-on-submit goes here: `panel.drafts?.shipDrafts(diff.changed)` AFTER
  buildSubmission succeeds (builds the message from state, not from drafts — deleting drafts
  cannot affect the message, but ordering after keeps failure semantics trivially safe).
- `src/completion.ts:56-58` — `CompletionTriggerOptions.getBatchNotes?: () => string[] | undefined`
  comment says "draft store in P1.M4.T2.S2" — note DELIVERY wiring belongs to T2.S2, not us.

## ✎ marker data for short view
- `src/panel/layout.ts:204` currently marks `✎ text answer` via `hasTextAnswer(q)` (state answers).
- Draft presence for the short-view affordance: expose `hasDraft(id): boolean` on the concrete
  class (extra methods beyond the 4-method interface are fine structurally). Rendering use of
  it belongs to T2/panel view tasks; we supply the data + panel accessor.

## Conventions
- Flat `src/*.ts` with colocated `*.test.ts`, vitest, `[Mode A]` JSDoc tags with spec citations
  (h2.45/h2.0 commitment 6), plain classes, no external deps. Validation: `npm run typecheck`,
  `npx vitest run <file>`, `npm test`.

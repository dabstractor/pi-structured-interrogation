# S5 research — e2e regression for BUG-001 replay fidelity

Sources read verbatim: `plan/.../architecture/bug001-submission-replay.md` (108 lines, full),
`src/regression-phantom-submissions.test.ts` (409 lines, full), `src/panel/actions.test.ts`
(seams at :286-305, :687-854, :931-942, :2224-2340, :2580-2660, makeDeps :125),
`src/reconstruct.test.ts` (:40-236 fixtures + ctx mocks), `src/reconstruct.ts` (grep: result
shape :214-216, reconstructFromBranch :470, base selection :491-507), `src/delivery.ts`
(buildSubmission :159-200, deliverSubmission :616-640, SubmissionMessage :66),
`src/persistence.ts` (INTERROGATION_STATE_ENTRY_TYPE :59, STATE_MIRROR_DEBOUNCE_MS=2000 :62),
`src/tool.ts` (executeInterrogate :219, inlineEnvelope :177-178 → `{state: structuredClone,
epoch, statusLine, action}`; upsert return :342 `return { content, details: inlineEnvelope(...) }`),
S4 PRP (full read).

## Key facts

1. **Regression file convention** (`regression-phantom-submissions.test.ts`): header comment
   block naming the incident + what the suite pins; `makePiHarness()` (sendMessage vi.fn +
   host-event map); `makeWalkthrough()` with `panelOf()` factory constructing a REAL
   `InterrogationPanel` (stubTheme, fakeEditor via editorFactory, DraftStore, delivery seam
   `{sendMessage, isIdle: () => true, noteSubmissionDelivered: () => lifecycle...}`); `writeIn()`
   helper (cursorIndex = options.length → ENTER → setText → ENTER).
2. **SIDECHAT-001 gotcha** (comment in phantom file's writeIn): editorFactory now builds TWO
   editors (answer textField + chat input); the ANSWER editor is addressed via
   `panel.textField` — `panel.textField.setText(text)` is the actions.test.ts
   `commitWriteIn` pattern (works, typed).
3. **Elaboration attach path** (actions.test.ts :2232 `test_submit_elaboration_attaches_to_real_option_answer`,
   :2325-2333): option answer already applied + DraftStore slot (via `focusTextField("elaboration")`
   + `textField.setText` + `handleInput("\r")` → stageText → `commitTextDraft`) → submit()
   binds slot as `answer.text`. Write-in guard: `custom !== true` prevents text duplication
   (WRITEIN-002). Same-gesture auto-submit attach proven at :2607 (`test_supersede_writein_same_gesture_auto_submit_ships_rebound_elaboration`).
4. **Auto-submit** (maybeAutoSubmit): fires SYNCHRONOUSLY in the committing gesture when the
   last open question transitions to answered and the set is complete — one sendMessage,
   epoch 1→2 (FR-D4), flash "submitted — {n} answer(s)". No fake timers needed. Panel's
   delivery seam read directly (`panel.delivery`) or via deps.
5. **reconstruct.test.ts fixtures** (module-private → S5 copies locally, ~30 lines):
   `toolResultEntry(state)` :73 (role "toolResult", toolName "interrogate", details.state),
   `submissionEntry(details)` :115 (type "custom_message", customType "interrogation-submission",
   details: {...details, card}), `makeCtx(entries)` :175 (`sessionManager.getBranch`,
   `ui.custom` never-resolving promise, `ui.setWidget` vi.fn — SURFACE-002), `makeHost()` :193
   (`createPanelHost({onPanelDismiss, dismissPanel})` — also RESETS panel.ts module-scoped
   host record), `makeOpts(host, drafts?)` :200 (`{config: DEFAULT_CONFIG, host, drafts}`).
   beforeEach: `setFallbackActive(false); makeHost(); resetState();`.
   NOTE: S4 will have extended submissionEntry's inline `changed` element type with
   `text?: string; custom?: boolean` in reconstruct.test.ts — S5's local copy should include
   those fields from the start (its e2e feeds REAL captured details, which carry them post-S3).
6. **Result contract**: `reconstructFromBranch(ctx, opts)` → `{ source: "tool-result"|"mirror-entry"|"none",
   replayed: number, opened, fallbackActive, state? }` (reconstruct.ts :214-216); base candidates
   :491-507 (tool result `details.state` beats mirror); caller replays submissions after base :565.
7. **Tool result envelope**: `executeInterrogate(args, ctx, config)` upsert returns
   `{ content, details: { state: structuredClone(serialized), epoch, statusLine, action } }` —
   `upsert.details` IS the faithful real tool-result details for the branch's base entry.
8. **DiffEntry wire shape post-S2/S3** (contract from sibling PRPs): entries carry
   `text?: string` (present only when non-empty) and `custom?: boolean` (true only);
   producers: computeEntries (snapshots.ts) + panel submit seam (actions.ts). Consumer:
   replaySubmission conditional spreads (S4). `details.changed` ships UNTRUNCATED by
   contract (delivery.ts :128/:200) — wire assertions safe for long elaborations.
9. **Scripts**: `npm test` (vitest run), `npm run typecheck` (tsc --noEmit), `npm run lint`
   (eslint src scripts *.ts). Single file: `npx vitest run src/regression-replay-fidelity.test.ts`.

## Design decisions

- ONE primary e2e test + wire-shape asserts inline (localizes producer vs consumer failures)
  + live-state pre-kill asserts (proves the loss is a REPLAY property).
- Harness = phantom-regression walkthrough (real executeInterrogate + real panel gestures)
  + reconstruct.test.ts ctx/host/opts mocks. Copy fixtures locally (they are not exported).
- Hard-kill modeling = simply omitting the mirror entry (the 2s debounce never flushed);
  resetState() before reconstruct = "process died".
- No timers, no persistence wiring, no completion trigger needed (noteSubmissionDelivered no-op).

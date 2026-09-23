# Panel UI Seams — pi-interrogator (research artifact for the delta PRD)

All line numbers are current against `src/panel/*` as of this research pass.
READ-ONLY repo; nothing here has been changed.

---

## 1. src/panel/short-view.ts

- `EXPLAIN_AFFORDANCE = "✎ explain…"` — **line 64** (const, module-private).
- Rendered by `explainLine(optionCount, cursorIndex, theme, dimAll)` — **line 220**:
  ```ts
  const prefix = cursorIndex === optionCount ? CURSOR : BLANK;
  const content = `${prefix}${EXPLAIN_AFFORDANCE}`;
  const focused = cursorIndex === optionCount && !dimAll;
  return `${INSET}${focused ? content : theme.fg("dim", content)}`;
  ```
  Called from `renderShortViewOptions` (line ~181, inside the choice branch —
  `lines.push(explainLine(options.length, cursorIndex, theme, dimAll))`). The ✎
  line is the LAST line of the options region on every choice question.
- `renderShortViewOptions(input: ShortViewInput): string[]` — **line 145**. Pure:
  `{question, cursorIndex, theme, width, dimmed?}` → lines. Branches:
  withdrawn → single `⊗ withdrawn` dim line; moot → prepend `⊘ moot — {reason}`
  (via `mootLine`, `mootReason(q)` prefers `q.answer?.value`) and dim all;
  `type:"text"` → `textAffordanceLine` (`✎ answer…` placeholder, cursor index 0)
  + optional dimmed `answerPreviewLine` (first line of `q.answer?.text`);
  choice → `optionLine` per option + `explainLine`. `dimmed?: boolean` wraps the
  FINISHED lines in `theme.fg("dim", …)` once (soft-gate seam).
- Option rows: `optionLine(...)` (line ~190): `INSET("  ") + (index===cursor ? "▸ " : "  ")
  + (opt.value===q.recommendation ? "★ " : "") + label + dimmed " — {ramification}"
  teaser`. Alignment contract: cursor prefix and blank prefix are both 2 visible
  cols; star adds 2; glyph widths always via `visibleWidth`/`truncateVisible`.
- Cursor domain: `initialCursorIndex(q)` — **line 87** — preselects the ★ option
  (index of option whose value === `q.recommendation`, clamped 0); text → 0.
  The ✎ row occupies index `options.length` in the domain (see §2
  `cursorDomainSize`).
- `TEXT_PLACEHOLDER = "answer…"` (line ~66) for text questions.

## 2. src/panel/actions.ts

Signatures + behavior (all exported except where noted):

- `nextUnanswered(ordered, fromIndex): string | undefined` — **line 105**.
  Forward scan from `fromIndex+1` to end, then wraps full cycle; returns first
  id with status in `UNANSWERED_STATUSES = ["open","reasked"]` (line ~93).
  This is THE advance primitive shared by accept-advance and panel's
  stage-2/resume paths.
- `cursorDomainSize(q: Question): number` — **line 125**: `text → 1`;
  else `(q.options?.length ?? 0) + 1` (the +1 = ✎ row).
- `digit(panel, n)` — **line 187**: requires `config.digitQuickSelect`, choice
  question, `n-1 < options.length` (✎ row NOT digit-selectable);
  moot/withdrawn → consumed no-op true; else `acceptOptionIndex(panel, q, n-1)`.
- `accept(panel): boolean` — **line 208** (Q14 enter = accept + advance):
  no question → false; moot/withdrawn → consumed true; text question → consumed
  true (no-op); `cursorIndex >= optionCount` → **`panel.focusTextField()`** and
  consumed true (the ✎ seam — the write-in PR must extend this); else
  `acceptOptionIndex(panel, q, panel.cursorIndex)`.
- `acceptOptionIndex(panel, q, optionIndex): boolean` — **line 232**: shared
  commit path for accept + digit + deep-view accept. Order:
  1. resolve option → `proposed = { value: opt.value, at: new Date().toISOString() }`
  2. if status `answered|submitted` → `panel.confirmRippleEdit(q.id, proposed)`;
     veto (false) → consumed true, nothing applied.
  3. `panel.state.applyAnswer(q.id, proposed)` — applyAnswer shape:
     **`{ value: string; at: string }`** (answer.text is an optional extra
     field; `reconcileDraftsForSubmit` spreads `{...q.answer, text}`).
  4. `evaluateDependsOn(panel.state)` (instant moot re-derivation).
  5. `advanceAfterAccept(panel)` (line **256**: `nextUnanswered` + set
     `panel.currentId` (setter re-seeds cursor) + invalidate).
- `reconcileDraftsForSubmit(panel): void` — **line 318** (private): reads
  `panel.draftTextFor(q.id)` per question; whitespace-only skipped. Text
  questions with status open/reasked → `applyAnswer(q.id, { value: draftText,
  at: now })` (the draft IS the answer). Choice questions with status
  `answered` and an existing answer → `applyAnswer(q.id, { ...q.answer, text })`
  (elaboration attaches as `answer.text`). Drafts on re-asked choice questions
  are NEVER shipped (BUG-008).
- `submit(panel, deps: SubmitDeps): boolean` — **line 358**:
  reconcileDraftsForSubmit → baseline (`submissionBaselineOf`) → `computeDiff`
  → pendingIds = ids with status `answered` → filter agent resets (BUG-008b) →
  zero user change → **`panel.flash("nothing to submit" | the EXPLAIN-003
  "explained question still needs an option choice" variant)`** and return.
  Gate warning: `countUnansweredGate > 0 && panel.config.gateWarnings` →
  `panel.gateWarning = { count }` (display-only, set BEFORE delivery) →
  `markSubmitted(state, pendingIds)` → `buildSubmission(state, {...diff,
  changed: userChanged}, note)` → `panel.drafts?.shipDrafts?.(pendingIds ∩ hasDraft)`
  → `deliverSubmission(deps, msg, { isIdle })` → `deps.noteSubmissionDelivered?.()`
  → clear note. **No auto-submit / completeness hook exists** — completeness
  auto-submit is new work; the seam would go after `markSubmitted` or in the
  accept-advance path.
- Footer flash API: there is no `flashFooter`/`setStatus`. It is
  **`panel.flash(text: string)`** (panel.ts:910, see §3). Consumed by actions.ts
  only at line 398 (nothing-to-submit).

## 3. src/panel/panel.ts

### Two-stage machinery (advanceArmed)

- **Field declaration: line 412** — `advanceArmed = false;` (public "so tests
  can assert the flag directly" — flag visibility is part of the contract).
- **Every read/write:**
  - **line 742** (handleInput, stage (a) one-shot disarm):
    `if (this.advanceArmed && !enter) this.advanceArmed = false;`
  - **lines 749–755** (handleInput, stage (b) stage-2): 
    `if (this.advanceArmed && enter && this.focus === "options") { flag=false;
    this.advanceToNextUnanswered(); this.invalidate(); return true; }`
    Runs BEFORE the keys seam so the armed enter is never shadowed by the
    router's enter→accept.
  - **line 866** (commitTextDraft): `if (opts?.arm !== false) this.advanceArmed = true;`
  - Arming decision points: `saveTextDraft` (line 784–795) calls
    `stageText(text, q?.type === "text")` — arms ONLY on text questions
    (EXPLAIN-003); `exitTextField` (line 807) calls `stageText(..., false)`
    (arm:false); `stageText` (line 819) may DEFER into the ripple modal via
    `beginTextConfirm(this, text, { arm })` (ripple-confirm.ts
    `applyTextConfirm` re-invokes `commitTextDraft` with the stashed arm).
  - `advanceToNextUnanswered` (line 877) is the stage-2 target — duplicates
    `advanceAfterAccept` via shared `nextUnanswered`.
  - handleInput JSDoc (~line 683–710) documents the order: resolved guard →
    ctrl+c → confirm modal → gate-warning dismissal → (a) disarm → (b) armed
    stage-2 → (c) text/note stage-1 enter → keys seam → editor forwarding.
  - `openExternalEditor` JSDoc (line ~1131) explicitly notes it does NOT touch
    `advanceArmed`.
- See "Removal-safety map" at the end for the full delete list.

### Focus / editor / note duties

- `PanelFocus = "options" | "text" | "note"` (line ~78). Duty model: ONE
  `TextField` instance per panel (`this.textField`, constructed in ctor ~line
  640); "note" duty is the SAME editor with `bufferOwner = "note"`.
- `focusTextField()` (line ~1035): focus="text", `syncBufferToQuestion(currentId)`,
  `textField.seed(freshestDraftFor(currentId))` (panel-local `draftSlots` →
  `drafts.getDraft` → ""), `bufferOwner = currentId`, `textField.focus()`,
  invalidate. **This is what opens/focuses the editor today** — called from the
  ✎ accept route (actions.ts:226) and the ctrl+t toggle (ctor refinement,
  lines ~577–585: focus==="text" → exitTextField, else focusTextField).
- `saveTextDraft()` (784), `exitTextField()` (807), `stageText(text, arm)` (819),
  `commitTextDraft(questionId, text, {arm?})` (846 — writes
  `draftSlots.set(id, {value:id, text})` + `drafts?.setDraft`, re-seeds cursor
  off the ✎ row to ★ when choice question, blur, arm), `blurTextField()`
  (1057 — focus="options", clears `lastEscAt`, blur, invalidate),
  `enterNoteMode()` (1083 — seeds from `drafts.getNote() || batchNote`,
  bufferOwner="note"), `exitNoteMode()` (1100 — write-through to
  `batchNote` + `drafts.setNote`, re-scope buffer to current question, blur),
  `openExternalEditor()` (1135 — ctrl+g; tui.stop → $VISUAL/$EDITOR/nano →
  setText + slot sync → tui.start in finally).
- EXPLAIN-002 buffer scoping: `currentId` setter (line ~310) calls
  `syncBufferToQuestion(id)` (line ~940): note owner ignores question switches;
  same owner no-op; different owner → UNGATED write-through of the old buffer to
  its owner's slot, then seed the incoming question's freshest draft.
- Drafts: `draftSlots: Map<string, {value, text}>` (private, TextDraft line ~85),
  read publicly via `draftTextFor(questionId)` (line ~1023).

### Transients / footer

- `flash(text)` — **line 910**: sets `footerFlash = { text, timer }`, timer
  clears after `FLASH_MS = 2500`, invalidate. Cancel-previous-timer built in.
- `footerFlash` field (~line 508), `gateWarning: {count}|null` (~line 522),
  `confirmMode: RippleConfirmState|null` (~line 535).
- Render path: `buildLines(width)` (line ~1218) composes header → question
  (renderQuestionLine) → optional hint → options region → editor region (when
  focus==="text" OR current question `type==="text"`) → `footerNoticeLine` →
  `footerLine`. `footerNoticeLine` (line ~1175): confirmMode suppresses;
  gateWarning wins over flash. `footerLine` (line ~1193): confirmMode →
  `renderConfirmFooter`; else `renderFooter(snapshot, view, this.labels, theme,
  width, narrow, editorExit?{mode, escEscHint})`.
- **Key labels**: `this.labels = resolveKeyLabels(config)` (ctor; import from
  `../config.js`; `resolveKeyLabels` is defined at **src/config.ts:449**,
  returns `Record<KeyAction, string>`). Memoized once per panel; never hardcoded
  key names in rendering.
- Note mode replaces the WHOLE body: `renderNoteHeader` + textField.render +
  notice + footer (buildLines, line ~1226).

### Host functions

- `handleUpserted(ids)` — **line 1429**: phase "open" → stuck-open phantom
  remount or `currentPanel?.invalidate()`; phase "suspended" && activePi &&
  lastOpts → `openPanel(activePi, {...lastOpts, focusQuestionId:
  firstActiveUpsertedId(state, ids)})`. Gated on ACTIVE_STATUSES
  (RESUMABLE_STATUSES from suspend.ts) for focus pick. Current gating has NO
  write-in/completeness consideration.
- `maybeAutoOpen(pi, config, host, drafts?)` — **line 1759**: subscribes
  `pi.on("tool_execution_end")`; guards `event.toolName === "interrogate" &&
  !event.isError`, `host.isOpen()` false, `getState()` defined; then
  `openPanel(ctx, {config, state, drafts})` with the stale-record self-heal
  retry (dispose + resetHostRecord + retry once when openPanel refused but
  `phase === "open"`). Called from index.ts at factory time (not in this repo
  dir's panel code).
- `resumeOpenPanel(pi)` (line ~1718): RESUME-001 ladder — first unanswered via
  `nextUnanswered(ordered, -1)`, else lastFocusId if active, else first active.

### Ripple-confirm triggers today

- Choice/option accept on `answered|submitted` question:
  `acceptOptionIndex` (actions.ts:236–239) → `panel.confirmRippleEdit(id,
  {value, at})` → default seam `createRippleConfirm()` (ripple-confirm.ts:108)
  → victims via `rippleVictims` (BFS over dependsOn closure filtered to
  answered/submitted) → opens `panel.confirmMode` modal (footer replaced;
  enter keep / esc cancel).
- Explain-field save: `stageText` (panel.ts:819–835) — answered/submitted with
  an existing answer AND `rippleVictims(...).length > 0` →
  `beginTextConfirm(this, text, { arm })` (the arm:false path = exitTextField
  / esc-esc / ctrl+t toggle; arm carried through to applyTextConfirm).
- Modal key handling: handleInput lines ~715–733 — `lastEscAt = undefined`,
  enter (≠"\n") → applyTextConfirm/applyConfirmedEdit, esc → cancel*, else
  consumed no-op.

## 4. src/panel/deep-view.ts

- **No ✎ affordance / explain section exists in deep view** — module contract
  states "NO `✎` … text questions in deep view render goal + description only
  and `enter` is a consumed no-op".
- Layout (`buildDeepContent`, line ~197): moot reason line (if moot) → full
  goal text (dim, capped by `capText`/`config.caps.ramification`, wrapped by
  `wrapText`) → blank → full description (full intensity) → blank → one sticky
  section per option: header `` ▸ `★ label` `` (cursor prefix `▸ ` vs two
  spaces; `★ ` when `opt.value === q.recommendation`) + wrapped dim
  ramification lines indented 4 (`RAM_INDENT`).
- Sticky headers: `clampScroll(content, scrollOffset, cursorIndex)` (line ~305)
  pins `offset = clamp(scrollOffset, headerIdx - viewportHeight + 2, headerIdx)`
  then global clamp. `renderDeepWindow` (line ~340) re-renders visible header
  lines with the CURRENT cursor prefix. Height cap `DEEP_VIEW_HEIGHT = 20`.
- Selection: `deepSelectionUp/Down` (lines ~395/398) move `panel.cursorIndex`
  in `[0, options.length-1]` — **the ✎ index does NOT exist in deep view** —
  recompute scrollOffset, never touch currentId.
- `acceptFromDeep(panel)` (line ~440): calls `acceptOptionIndex` (same ripple +
  commit + advance as short form); veto detection by `q.answer === before`
  object identity (stay in deep view on veto); else `panel.setView("short")`,
  `scrollOffset = 0`. Text/moot/withdrawn/no-options → consumed no-op.
- `deepSeedCursorIndex(q)` (line ~463): ★ preselect clamped to option domain;
  used by `panel.setView("deep")`.
- Scroll handling in panel: ↑/↓ in deep view → deepSelectionUp/Down (keys.ts
  route step 1); panel.lastWidth/scrollOffset drive clamping.

## 5. src/panel/overview.ts

`overviewMarker(q: Question): string` — **line 121**:
```ts
let m = "·";
if (q.answer !== undefined && q.status !== "moot" && q.status !== "withdrawn") m = "★";
if (q.status === "reasked") m = "⟳";
if (q.status === "moot") m = "⊘";
if (q.status === "withdrawn") m = "⊗";
if ((q.answer?.text ?? "") !== "" && m !== "⊗" && m !== "⊘") m += " ✎";
```
Markers: `·` open; `★` has answer (answered/submitted/closed);
`⟳` reasked (overrides ★); `⊘` moot; `⊗` withdrawn (highest precedence);
**`✎` is an APPEND-only suffix meaning "non-empty `q.answer.text`"** — the only
existing ✎ semantics in overview; composes with ⟳/★/·, suppressed on ⊘/⊗.
Question-line markers in layout.ts `statusMarkers` (line 271) similarly push
`"✎ text answer"` when `hasTextAnswer(q)`. Group headers render `{group} ▲`
for gate groups (`gateGroupNames`). Rows: `{▸ |  }{marker} {title-or-prompt}`,
moot rows append ` — {reason}`.

## 6. src/panel/text-field.ts

- Pure wrapper around ONE `EditorComponent` per panel:
  `createEditorComponent(factory, config, tui, theme, keybindings)` (line ~89):
  composed editor only when `config.editorMode === "composed"` AND factory
  defined (factory captured once per openPanel via `pi.ui.getEditorComponent?.()`);
  else stock pi-tui `Editor`. No `onSubmit` is ever set (deliberate — panel.ts
  intercepts enter at the panel level so composed editors and the stock
  submitValue-empty/trim problem are avoided).
- **Current duties: exactly two** — "text" (explain/write-in field for the
  current question) and "note" (batch note). Both are the SAME TextField
  instance; duty is tracked by `panel.focus` + `panel.bufferOwner`
  (`questionId | "note" | undefined`). There is no per-duty header/label INSIDE
  text-field.ts — the panel renders `renderNoteHeader` (layout.ts:253) above
  the editor for note duty; text duty renders bare (region label comes from the
  ✎ affordance / hint line).
- `TextField` API: `render(width)` (pads to `DEFAULT_TEXT_LINES = 3`, 1-col
  left margin), `handleInput(data)`, `getText()` (getExpandedText-aware),
  `setText`, `seed(text)` (idempotent setText-only-if-different, no history),
  `focus()`/`blur()` (feature-detected `focused` flag), `lineCount()`.
- `focusText (ctrl+t)` semantics: host-refined toggle (panel.ts ctor ~577–585):
  options→ `focusTextField()` (focus + seed freshest draft);
  text→ `exitTextField()` (write-through + blur, NO arming). Router gate
  (keys.ts): only `view === "short" && focus !== "note"` — ctrl+t from
  deep/overview does nothing (BUG-011: blind editor).
- Enter per mode — ALL handled in `panel.handleInput` stage (c) (lines
  ~757–763), before the router/editor:
  - text focus → `saveTextDraft()` (stage-1: snapshot + slot + blur + arm iff
    text question);
  - note focus → `exitNoteMode()` (write-through, no arming);
  - `"\n"` (ctrl+j / raw newline) is NEVER a stage transition — enter matching
    is `parseKey(data) === "enter" && data !== "\n"`.
- Buffer scoping on question switch (EXPLAIN-002): `currentId` setter →
  `syncBufferToQuestion` — write-through old buffer to its owner, seed new
  owner's draft; note owner is question-agnostic.
- Exit gestures: enter (per-duty above); ctrl+t re-press (toggle back);
  double-esc within `config.escExitWindowMs` (keys.ts `escExitEditor` —
  exitTextField/exitNoteMode, never suspend; escWindow 0 disables);
  ctrl+c (handleInput first check — `suspend()`, done(null), returns
  unconsumed so pi's ctrl+c flow continues).
- ctrl+g external editor: `panel.openExternalEditor()` (panel.ts:1135), router
  intercept only when `focus === "text"` (keys.ts `b.externalEditor` gate).
- Opens via: `panel.focusTextField()` (✎ accept / ctrl+t) and
  `panel.enterNoteMode()` (ctrl+shift+m). Seeds:
  `freshestDraftFor(currentId)` / `drafts.getNote() || batchNote || ""`.

## 7. src/panel/keys.ts

Router = `buildKeyRouter(config, actions): (data, panel) => boolean`
(line ~330). Dispatch order (module JSDoc lines 60–80 + code):

1. **Fixed ↑/↓** — NOT intercepted when editor focused (`focus==="text"||"note"`
   forwards to editor). View-aware: overview → `overviewUp/Down` (cursor row);
   deep → `deepSelectionUp/Down`; short → `actions.optionUp/optionDown`.
2. **Fixed ←/→** — only when NOT editor focus. Overview → cursor row;
   short/deep → `prevQuestion/nextQuestion`.
3. **Fixed esc** — options focus: `escapeDescend` ladder (deep→short,
   overview→deepSticky?deep:short, short→`suspend()`). Editor focus: single esc
   forwards (return false); second esc within `escExitWindowMs` →
   `escExitEditor`.
4. **Fixed enter** — `panel.focus !== "text"` only: overview → `overviewJump`;
   deep → `acceptFromDeep`; short → `actions.accept`. (Note-focus enter never
   reaches the router — panel.handleInput stage (c) consumes it first.)
5. **Config intercepts** (order = collision-winner order): `deep`,
   `overview`, `focusText` (gated `view==="short" && focus!=="note"`),
   `batchNote`, `submit`, `discuss`, `externalEditor` (only focus==="text"),
   `prevQuestion`, `nextQuestion` (overview → cursor movers), then digits 1–9
   (only when `config.digitQuickSelect && view!=="overview" && focus not
   text/note`). **Intercept-before-forward rule (h2.34): config keys are
   consumed even in editor focus** — except the fixed nav keys and enter above,
   which forward to the editor.
6. No match → return false → panel.handleInput forwards to the editor when
   focus is text/note.

Config → KeyId: `parseAccelerator` (line ~175) validates lowercase
"ctrl+shift+x" grammar; `resolveBindings` (line ~200) falls back per-action to
`DEFAULT_CONFIG.keys` with one console.warn. Display labels:
`resolveKeyLabels(config)` from **src/config.ts:449** (layout/footer use only).

## 8. src/panel/gate.ts

- Warning text: `gateWarningLine(count)` — **line 105**: 
  `` `⚠ ${count} foundational unanswered — later answers may shift` ``.
- Count: `countUnansweredGate(ordered, gateGroups)` (line ~84) — gate-group
  questions with `q.answer === undefined` and status not withdrawn/moot.
- Rendering: NOT inside gate.ts — panel.ts `footerNoticeLine` (line ~1178) →
  `renderGateWarningLine(gateWarningLine(count), theme, width)` (layout.ts:122)
  in the shared transient slot directly ABOVE the footer; wins over a live
  flash; suppressed during confirmMode.
- Dismissal: panel.handleInput "stage 0" (lines ~735–740): ANY key clears
  `gateWarning` and CONTINUES processing (dismiss + act), including during
  editor focus (it precedes everything after confirm modal + ctrl+c).
- Surfacing today is display-only (Q32=B): the soft gate also picks initial
  focus (`pickGateInitialQuestionId`, line ~118 ladder) and dims non-gate
  groups (panel.buildLines dimmed flag). No gate blocking exists anywhere —
  relevant because the PRD's "surfacing gates" builds on these seams.

## 9. src/panel/two-stage.test.ts — test inventory

Describes (line numbers):

1. `"two-stage enter — stage 1 save, stage 2 advance (h2.31)"` (175)
   - `test_stage1_enter_saves_draft_blurs_and_arms` (176) — ARMING (rewrite:
     stage-1 save/blur/slot assertions keep; arming assertion removes)
   - `test_stage2_enter_advances_to_next_unanswered_and_consumes_flag` (200) —
     ARMING (remove/rewrite to single-enter commit+advance)
   - `test_enter_after_stage2_is_normal_accept_again` (220) — ARMING (remove)
   - `test_stage1_on_choice_question_does_not_arm_next_enter_accepts` (238) —
     ARMING (keep the underlying "choice ✎ enter does not select an option"
     behavior, drop flag assertions)
2. `"two-stage enter — one-shot disarm"` (265)
   - `test_non_enter_key_disarms_and_next_enter_falls_through` (266) — ARMING
   - `test_armed_enter_in_options_focus_survives_disarm_check_order` (282) —
     ARMING (remove)
3. `"two-stage enter — newline safety (R4)"` (294)
   - `test_multiline_flow_shift_enter_then_enter_saves_both_lines` (321) —
     KEEP (multi-line editor behavior)
   - `test_kitty_plain_enter_is_stage1_not_newline` (336) — KEEP (newline
     vs enter discrimination), drop arming assertions
   - `test_ctrl_j_while_armed_disarms_rather_than_advancing` (351) — mixed:
     keep "\n is never a stage transition" coverage, drop arming mechanics
4. `"two-stage enter — note mode (R3)"` (362) — ALL KEEP:
   `test_enter_in_note_focus_saves_note_and_exits_without_arming` (363),
   `test_note_enter_never_reaches_router_accept` (380),
   `test_note_draft_survives_esc_exit_and_reseeds_on_reentry` (390),
   `test_ctrl_shift_m_repress_exits_note_mode_preserving_draft` (418),
   `test_unmatched_input_types_into_the_note_field` (431)
5. `"refocus seeding + draft survival"` (442) — ALL KEEP:
   `test_refocus_after_stage1_reseeds_saved_draft` (443),
   `test_draft_slot_survives_navigation_and_reseeds_on_return` (457),
   `test_cross_question_refocus_seeds_new_question_draft_not_stale_text` (475)
6. `"history isolation"` (491):
   `test_addToHistory_never_called_across_the_full_flow` (492) — KEEP

## 10. Test harness patterns

### actions.test.ts
- `stubTheme = { fg: (_n, s) => s, bold: s => s } as unknown as Theme`.
- Fixtures: `choiceQ(id, overrides)` builder + `seed(specs)` — real
  `createInterrogationState("goal")`, `state.upsertQuestion(...)` (forces new
  ids to "open"), then statuses applied AFTER: "answered" via
  `state.applyAnswer(id, {value, at: T0})`, others via `state.setStatus`.
- `makePanel(state, extra?: Partial<InterrogationPanelArgs>, config?)` —
  **constructs `new InterrogationPanel` DIRECTLY** with
  `tui: { requestRender: vi.fn() } as unknown as TUI`, stubTheme,
  `done: () => {}`, state, config; returns `{ panel, requestRender }`.
- `makeDeps(isIdle)` — `{ deps: { sendMessage: vi.fn(), isIdle: () => isIdle },
  sendMessage }` for submit.
- Ripple mocks: `seamMock(result)` typed `vi.fn((_panel, _questionId, _proposed)
  => result)` passed as `confirmRipple` in InterrogationPanelArgs.
- afterEach: `vi.useRealTimers(); vi.restoreAllMocks()`; dispose panels that
  arm flash timers.

### panel.test.ts
- Host-level: `makeMockPi(mode?)` (~line 90) builds a fake
  PiUISurface — `ui.custom` factory capturing the component + a resolvable
  `done`, `on` with a handler map + `emit(event, payload)` helper,
  `sendMessage` mock. `makeMockLifecycle()` for createPanelHost.
  `optsFor(state, extra)` → OpenPanelOptions. Host record reset via
  `createPanelHost` before each scenario.
- `fakePanelEditor()` (~line 1001) — EditorComponent stub with Mock
  handleInput/setText. `draftSlotsOf(panel)` (~line 1443) reads the private
  slot map via cast.

### ac-panel.test.ts (same pattern)
- `choiceQ/textQ/fixtureQuestion/fixtureState` fixture builders (lines
  118–196), `makeMockPi` (198), `makeMockLifecycle` (289),
  `fakePanelEditor` (313), and `panelArgsFor(...)` (327) which assembles full
  `InterrogationPanelArgs`; panels constructed directly with `new
  InterrogationPanel(panelArgsFor(state, {...}))`. ANSI-exact render assertions
  use a real ansi theme in some cases.

New tests should follow: direct `new InterrogationPanel` + `{ requestRender }`
TUI stub + stubTheme + seed-via-raw-primitives state; host-level behavior via
makeMockPi + createPanelHost.

---

## Removal-safety map for advanceArmed (two-stage deletion)

Every line that must change when two-stage arming is removed:

1. **panel.ts:412** — delete field `advanceArmed = false;` (public; tests in
   two-stage.test.ts reference it — see §9).
2. **panel.ts:736–742** — delete handleInput stage (a) one-shot disarm block
   (`const enter = …` definition at ~line 739 must SURVIVE if stage (c) enter
   interception remains for note/text commit-at-enter).
3. **panel.ts:744–755** — delete stage (b) armed stage-2 enter block (including
   its call to `this.advanceToNextUnanswered()` and the "runs BEFORE the keys
   seam" guarantee comment).
4. **panel.ts:866** — delete `if (opts?.arm !== false) this.advanceArmed = true;`
   in `commitTextDraft`; the `{ arm?: boolean }` opts param, the `arm` param of
   `stageText`/`saveTextDraft`, the `{ arm }` payload into
   `beginTextConfirm`/ripple-confirm.ts's text-confirm state
   (`applyTextConfirm` re-invokes commitTextDraft with the stashed arm —
   ripple-confirm.ts must drop the field), and `saveTextDraft`'s
   `q?.type === "text"` arming conditional all collapse.
5. **panel.ts:877–886** — `advanceToNextUnanswered()` becomes dead unless
   reused for the new single-enter commit+advance semantics (candidate reuse:
   it is identical to actions.advanceAfterAccept modulo privacy).
6. **panel.ts ~683–710** — handleInput [Mode A] JSDoc: rewrite the stage
   ordering description (confirm modal → gate dismissal → enter handling →
   router) without stages (a)/(b).
7. **panel.ts ~1131** — openExternalEditor JSDoc mention of "does NOT touch
   advanceArmed" must be reworded.
8. **panel.ts class JSDoc on draftSlots (~line 390)** says "armed by stage-1
   enter ({@link saveTextDraft})" — rewording only.
9. **two-stage.test.ts** — remove/rewrite per §9 classification (describes 1
   and 2 arming cases; keep note-mode, refocus-seeding, newline-safety,
   history-isolation coverage).
10. **actions.ts / keys.ts / ripple-confirm.ts runtime code**: no reads of
    `panel.advanceArmed` outside panel.ts and two-stage.test.ts (verified by
    grep) — arming is fully encapsulated, so no cross-module edits are needed
    beyond the ripple text-confirm `arm` field noted in (4).

Safety note: stage (c) enter interception (text/note commit) and the `"\n"`
newline exclusion live in the SAME handleInput region — do NOT delete them with
the arming blocks; they are the commit-at-enter seam the PRD reuses.

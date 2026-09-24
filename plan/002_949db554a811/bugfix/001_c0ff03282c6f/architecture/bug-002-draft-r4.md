# BUG-002 — R4 draft loss on ctrl+c / ctrl+shift+e (discuss) / ctrl+shift+m (note mode)

Verified at HEAD. All line numbers current.

## Verified-claims table

| # | Claim | Verdict | Correction / detail |
|---|---|---|---|
| 1 | `src/panel/panel.ts:748` ctrl+c branch calls `this.suspend()` from ANY state incl. editor focus | **CONFIRMED** | `panel.ts:748-751`, checked before the confirm-modal and gate-warning branches, before `this.keys(data,this)` — so it fires even when `focus === "text"` or `"note"` |
| 2 | `suspend()` (~:903) never stages the editor buffer | **CONFIRMED** | `panel.ts:903-907` — only `resolved` guard + `this.done(null)`. No `stageText`, no `commitTextDraft`, no DraftStore touch |
| 3 | ctrl+shift+e is a config-level intercept firing while editor focused (keys.ts routing step 4) | **CONFIRMED** | `src/panel/keys.ts` step 4 block (`if (matchesKey(data, b.discuss)) { actions.onDiscuss(panel); return true; }`) — the h2.34 intercept rule; only `focusText` and `externalEditor` are focus/view-gated; discuss is not |
| 4 | `discussInChat` calls `panel.suspend()` with no write-through | **CONFIRMED** | `src/panel/discuss.ts:116` (function body ~:116-126): reads `panel.currentId`, builds template, `panel.suspend()`, deferred `setEditorText`. Never touches drafts |
| 5 | `enterNoteMode` (~:1110) reseeds the shared editor with note text, overwriting the in-flight question buffer with no write-through | **CONFIRMED** | `panel.ts:1110-1116`: `this.textField.seed(this.drafts?.getNote() || this.batchNote || "")` then `this.bufferOwner = "note"`. If entered from text focus, `bufferOwner` was a question id whose buffer is silently replaced (buffer content lost — never written to `draftSlots` or `drafts`) |
| 6 | Result: draftSlots empty AND DraftStore empty after gesture; write-ins (WRITEIN-001) can lose a full hand-written answer | **CONFIRMED** | Neither `draftSlots` (panel-local, `panel.ts:402`) nor `DraftStore` (`src/draft-store.ts`) is written by any of the three paths. On resume a FRESH panel is created (suspend.ts `resumePanel`), so the panel-local slot is gone too. Write-in duty users type whole answers here (FR-12/FR-D1) |

Note on severity nuance: ctrl+c from **note** focus also loses the note buffer (same mechanism — no `exitNoteMode()` write-through before suspend).

## 1. Key-routing pipeline (`src/panel/keys.ts`, `buildKeyRouter` ~:360-510)

Order inside `route(data, panel)`:
1. `isResolved()` guard.
2. `editorFocused = focus === "text" || "note"` (ESC-002 flag).
3. Fixed ↑/↓ (~:395-410) — skipped when `editorFocused` (forwarded to editor).
4. Fixed ←/→ question nav (~:414-427) — NOT intercepted in text/note focus.
5. Fixed esc (~:431-448): options focus → `escapeDescend` (ladder ending in `panel.suspend()`); editor focus → single esc forwards (`return false`); second esc within `escExitWindowMs` → `escExitEditor(panel)` — **this is where esc-esc write-through lives today** (keys.ts:253-259: note focus → `panel.exitNoteMode()`, else `panel.exitTextField()`).
6. Fixed enter (~:452-460) — options focus only (router level; the text/note enter fork is earlier, in `panel.handleInput`).
7. **Step 4 config intercepts — valid INCLUDING editor focus (h2.34 rule)**: `deep`, `overview`, `focusText` (gated to short view + not note focus), `batchNote` (ungated), `submit`, `discuss` (ungated), `externalEditor` (text focus only), `prevQuestion`/`nextQuestion` (ungated — view-aware).
8. Digit quick-select — never in text/note focus.
9. Unmatched → `return false` → `panel.handleInput` forwards to `textField.handleInput` (panel.ts:806-810).

So while the editor is focused: `deep`, `overview`, `batchNote`, `submit`, `discuss`, `prev/next` all bypass the editor without write-through; `esc-esc` and `ctrl+t` re-press (`onFocusText` → panel's `exitTextField` path) DO write through.

## 2. The existing write-through mechanism (the helper to reuse)

- **`panel.ts:866-879 private stageText(text: string): void`** — FR-18 gate first (ripple modal deferral via `beginTextConfirm` on answered/submitted questions with victims), then `this.commitTextDraft(id, text)`.
- **`panel.ts:881-901 public commitTextDraft(questionId: string | undefined, text: string): void`** — the unconditional tail: `draftSlots.set(questionId, {value: questionId, text})` + `drafts?.setDraft(questionId, text)` + EXPLAIN-003 cursor re-seed to ★ when closing on the ✎ row + `blurTextField()`.
- **`panel.ts:838-841 exitTextField(): void`** (`this.stageText(this.textField.getText())`) — ctrl+t re-press + esc-esc exit. Not a "blur handler" per se; blur (`blurTextField`, :1083-1090) does NOT write through — write-through is in the gesture methods.
- **`panel.ts:985-1019 private syncBufferToQuestion(id)`** — cross-question write-through (R4): persists outgoing owner's buffer (empty-slot discipline: writes only if `text.trim()!=="" || existing.trim()!==""`), then re-seeds.

**Helper contract for the fix:** `commitTextDraft(questionId, text)` is the public, self-contained write-through (slot + seam + blur). `stageText(text)` adds the FR-18 ripple deferral — desirable for suspend/discuss/note-mode entry from text focus on an answered question. Recommended: a small guard at the top of `suspend()`, `discussInChat`, and `enterNoteMode`: if `focus === "text"` and `bufferOwner !== "note"`, call `this.stageText(this.textField.getText())` (panel-internal) / the panel equivalent. For `enterNoteMode` (panel method) and `suspend()` (panel method) this is direct; for `discussInChat` (discuss.ts) call a new/existing public panel seam, e.g. `panel.commitEditorDraft()` wrapping `stageText`, before `panel.suspend()`. Note `stageText` uses `currentId` — if the editor was focused via the ✎ affordance, `bufferOwner === currentId` always, so this is safe. `stageText` → `commitTextDraft` also calls `blurTextField()`, which is harmless pre-suspend and correct pre-note-mode (note mode then re-focuses).

## 3. Full current code

### ctrl+c branch — `src/panel/panel.ts:748-751`
```ts
    if (parseKey(data) === Key.ctrl("c")) {
      this.suspend();
      return false;
    }
```
(Preceded by JSDoc at ~:731-747: "checked before the ripple confirm modal and every other branch".)

### suspend() — `src/panel/panel.ts:899-907`
```ts
  /**
   * Suspend contract (h2.35): resolve custom() with null. The editor region
   * is restored by pi; the host's floating .then marks the host suspended.
   * Idempotent — a second call after resolution is a no-op.
   */
  suspend(): void {
    if (this.resolved) return;
    this.resolved = true;
    this.done(null);
  }
```

### enterNoteMode() — `src/panel/panel.ts:1110-1116`
```ts
  enterNoteMode(): void {
    this.focus = "note";
    this.textField.seed(this.drafts?.getNote() || this.batchNote || "");
    this.bufferOwner = "note"; // EXPLAIN-002: note duty suspends question scoping
    this.textField.focus();
    this.invalidate(); // the note header + editor region appear immediately
  }
```

### discussInChat — `src/panel/discuss.ts:~105-126`
```ts
export function discussInChat(pi: PiUISurface, panel: InterrogationPanel): boolean {
  const id = panel.currentId;
  const question = id !== undefined ? panel.state.getQuestion(id) : undefined;
  if (question === undefined) return false;

  const text = buildDiscussTemplate(question);

  // Suspend FIRST (done(null)), then write — never the reverse: the write
  // must land after the panel has begun yielding the editor back to pi.
  panel.suspend();
  void Promise.resolve().then(() => pi.ui.setEditorText?.(text));
  return true;
}
```

## 4. DraftSlots + DraftStore

- `panel.ts:402` — `private draftSlots = new Map<string, TextDraft>()` — per-question (`{value: questionId, text}`), panel-instance lifetime; survives nothing across suspend (fresh panel on resume), hence the DraftStore seam.
- `panel.ts:126-135` — `DraftStore` **seam interface**: `getDraft(id): string|undefined`, `setDraft(id, text): void`, `getNote(): string`, `setNote(text): void`. `drafts?: DraftStore` on panel opts; real impl `src/draft-store.ts` class `DraftStore` (extension memory, one instance in `index.ts:164`; NO disk persistence by design, Q6=B). Extended API: `setDraftEntry`, `hasDraft` (text non-empty), `clearDraft(id, {explicit:true})` (no-op otherwise), `clearAll({explicit:true})`, `shipDrafts(ids?)`.
- `panel.ts:1073-1075` — `draftTextFor(questionId): string|undefined` = `draftSlots.get(id)?.text ?? drafts?.getDraft(id)`. Private twin `freshestDraftFor` (:1021-1025) with `""` default.

## 5. Note mode

Note mode = the SAME embedded `TextField` swapped to "note duty" (`focus = "note"`, `bufferOwner = "note"`), seeded from `drafts.getNote() || batchNote || ""` via `TextField.seed` (text-field.ts:183-185 — no-history `setText`). It is NOT a per-question draft slot; the note is question-agnostic (R3, EXPLAIN-002) and holds until shipped. The **pre-overwrite moment** is exactly `enterNoteMode`'s `textField.seed(...)` at panel.ts:1112 — the fix must run the write-through before that line (guard: only when `focus === "text"`; from note focus `onBatchNote` already routes to `exitNoteMode`).

## 6. Test inventory (what pins current behavior)

### `src/panel/suspend.test.ts`
- `test_esc_top_level_suspend_sets_widget_exact_line` (:318) — esc-descent suspend → widget.
- `test_removed_breakOut_chord_no_longer_suspends` (:336), `test_lifecycle_dismiss_suspend_sets_widget_and_keeps_focus` (:353), `test_suspend_answered_only_...` (:380), `test_suspend_submitted_and_reasked_...` (:397), `test_crashed_panel_...` (:418) — widget/host bookkeeping.
- `test_resumePanel_*` (:436, :481, :497, :534) — resume rehydration from state + DraftStore.
- **`test_state_epoch_and_drafts_survive_suspend_resume`** (:585) — R4 money test: state + DraftStore survive; does NOT cover the in-flight editor buffer (the gap BUG-002 exposes). None assert drafts are empty after suspend — safe.

### `src/panel/discuss.test.ts`
- `test_discussInChat_happy_path_suspend_then_deferred_exact_write` (:251), `..._undefined_currentId_false...` (:271), `..._missing_question_false...` (:282), `..._optional_setEditorText_suspend_still_happens` (:293), `test_discuss_key_from_short_view_suspends_and_preloads_exact_template` (:307), `test_discuss_key_same_template_from_deep_and_overview_views` (:340). None assert draft emptiness — safe.

### `src/panel/editor-preservation.test.ts`
- `test_native_preservation_constant_records_finding` (:230), `test_open_suspend_done_null_preserves_editor_text` (:234) — **MAIN editor** (pi's) text preserved across custom() — different concern from the panel's embedded editor buffer. `test_text_typed_while_suspended_survives_next_cycle` (:249), `test_discuss_preload_survives_resume_cycle` (:274), fallback-helper tests (:300-380). Safe.

### `src/panel/panel.test.ts`
- `test_ctrl_c_escapes_note_mode_and_editor_focus` (:1339-1347) — **pins the buggy behavior** (ctrl+c in note focus → done(null)); compatible with a write-through fix (asserts suspend only). Extend rather than flip.
- `test_ctrl_c_after_suspend_is_inert` (:1349), `test_suspend_done_null_marks_suspended_and_editor_restored` (:278), `test_panel_suspend_is_idempotent` (:338), `test_esc_in_short_suspends_via_router_descent` (:401).
- Note mode: `test_ctrl_shift_m_enters_note_mode_and_swaps_editor_area` (:1775), `test_note_mode_swaps_from_deep_view_too` (:1792), `test_repress_exits_preserving_draft_and_reentry_reseeds_from_store` (:1805), `test_esc_exits_note_mode_and_unmatched_input_types_into_it` (:1828), `test_esc_exit_window_zero_disables_double_esc_in_note_mode` (:1852), `test_note_survives_suspend_resume_via_store_seam_money_test` (:1869), `test_note_mode_still_wins_over_deep_pane` (:1999), `test_note_mode_exit_rescopes_buffer_to_current_question` (:1427). None assert the entering-from-text-focus buffer is discarded — the gap; add coverage.
- Editor exit: `test_ctrl_t_repress_closes_field_saving_draft_without_arming` (:1506), `test_refocus_reseeds_saved_draft_over_stale_buffer` (:1545).

## 7. Doc references for sync

- `spec/ui-spec.md:62` — Exit gestures (ESC-002): "Every exit is a draft write-through — backing out never loses typed text (R4). `ctrl+c` (CTRL-C-001) closes the whole prompt — suspend, unconsumed — from any state including modals…" (currently silent on write-through for ctrl+c/discuss/note-mode entry).
- `spec/ui-spec.md:63` — Buffer scoping (EXPLAIN-002); `:65` — Draft preservation (R4) matrix.
- `spec/decisions.md:27` — "R4 draft preservation (from ask_user evaluation: state loss on revisit is disqualifying)".
- `spec/decisions.md:21-22` — WRITEIN-001/002 (write-in = the editor is the answer surface; hand-written answer ships by itself) — why loss is severe.
- `src/draft-store.ts:4-8` — "R4 'drafts are sacred' (h2.45; h2.0 commitment 6)"; destruction-safety note.
- `README.md:40,176` — duty-follows-context wording (editor duty). No explicit R4/commitment-6 paragraph in README; check `README.md` limitations section for restart-loss wording when syncing.

## Fix sketch

1. Add a private `commitEditorDraftIfFocused()` on `InterrogationPanel`: if `this.focus === "text"` (and `bufferOwner !== "note"`), `this.stageText(this.textField.getText())` — reuse, no new logic. (For note focus, ctrl+c should instead call `exitNoteMode()`-equivalent write-through: `batchNote = text; drafts?.setNote(text)` without the re-scope seed — or simply call `this.exitNoteMode()` when `focus === "note"` before suspending in the ctrl+c branch.)
2. Call it at the top of `suspend()` — single choke point covers ctrl+c, esc-descent suspend, discuss, and lifecycle dismissPanel (all route through `suspend()`/`done(null)`; but only `suspend()` needs it since done() callers all pass through it). Caveat: `stageText` may open the ripple confirm modal on an answered question — pre-suspend that modal would be instantly orphaned; for the suspend path prefer the ungated `commitTextDraft(this.bufferOwner ?? this.currentId, this.textField.getText())` directly (navigation precedent `syncBufferToQuestion` is also ungated).
3. `enterNoteMode`: before `textField.seed(...)`, run the same ungated write-through when `focus === "text"`.
4. `discussInChat`: covered automatically if fix lives in `suspend()`; otherwise call a new public panel method before `panel.suspend()`.

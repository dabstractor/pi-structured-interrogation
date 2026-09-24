# BUG-004 — Write-in duty persists across question navigation (tab/shift+tab)

Verified at HEAD. All line numbers current.

## Verified-claims table

| # | Claim | Verdict | Correction / detail |
|---|---|---|---|
| 1 | `textDuty` is per-focus-session, reset only on blur | **CONFIRMED** | `panel.ts:1086` (`blurTextField`: `this.textDuty = "elaboration"`) is the only reset. Declared `panel.ts:427` (`"writein" \| "elaboration"` union, default `"elaboration"`) |
| 2 | Question navigation changes `currentId` and re-seeds cursor to ★ WITHOUT re-deriving `textDuty`; `syncBufferToQuestion` doesn't derive duty | **CONFIRMED** | `panel.ts:352-363` setter sets `cursorIndex = initialCursorIndex(q)` then `syncBufferToQuestion(id)` (:985-1019) — duty untouched. Navigation is NOT intercepted in editor focus (keys.ts step 4 `prevQuestion`/`nextQuestion` ungated) |
| 3 | Repro: Other-accept on q1 (writein) → shift+tab to q2 → cursor resets to ★ → enter commits `{value, custom:true}` even though cursor sits on a real option | **CONFIRMED by code-reading** | `handleInput` enter fork (panel.ts:794-803): `if (this.textDuty === "writein") writeInEnter(this); else this.saveTextDraft();` — duty, not cursor, decides. `writeInEnter` (actions.ts:296-341) commits `applyAnswer({value: text, custom: true})`. No automated test pins this specific repro; not executed here, but every link in the chain is confirmed in source |

## 1. `textDuty` type union + all assignment sites

Union: `"writein" | "elaboration"` — `panel.ts:427`.

| Site | Assignment | Seed source |
|---|---|---|
| `panel.ts:427` | field initializer `"elaboration"` | — |
| `panel.ts:1058` (`focusTextField(duty?)`) | `if (duty !== undefined) this.textDuty = duty` — set by ctrl+t entry via `desiredTextDuty` | `freshestDraftFor(currentId)` (:1059-1061) |
| `panel.ts:1086` (`blurTextField`) | reset to `"elaboration"` | — |
| `actions.ts:223` (accept on ✎ Other row, `accept()` :204-231) | `panel.textDuty = "writein"` then `panel.focusTextField()` | freshest draft |
| `keys.ts:~285-300 desiredTextDuty(panel)` (pure fn) | computes: `q.type === "text"` → writein; `panel.cursorIndex === (q.options?.length ?? 0)` → writein; else elaboration | — |
| `deep-view.ts:482` (deep-view Other selection) | `panel.textDuty = "writein"` (reuses the accept pair) | freshest draft |
| `ripple-confirm.ts` | documents that its tails reset via `blurTextField` (:282, :313) | — |

`writeInEnter`'s commit tail itself calls `panel.blurTextField()` (actions.ts:337) which resets duty — so the leak only manifests when the user navigates BEFORE committing.

## 2. Key code with lines

### `focusTextField` — `panel.ts:1051-1067`
```ts
  focusTextField(duty?: "writein" | "elaboration"): void {
    this.focus = "text";
    if (duty !== undefined) this.textDuty = duty; // per-focus-session — see JSDoc
    this.syncBufferToQuestion(this.currentId);
    this.textField.seed(this.freshestDraftFor(this.currentId));
    this.bufferOwner = this.currentId;
    this.textField.focus();
    this.invalidate();
  }
```

### `syncBufferToQuestion` — `panel.ts:985-1019`
```ts
  private syncBufferToQuestion(id: string | undefined): void {
    if (this.bufferOwner === "note") return; // note duty ignores question switches
    if (this.bufferOwner === id) return; // already showing this question's draft
    if (this.bufferOwner !== undefined) {
      const text = this.textField.getText();
      const existing = this.freshestDraftFor(this.bufferOwner);
      if (text.trim() !== "" || existing.trim() !== "") {
        this.draftSlots.set(this.bufferOwner, { value: this.bufferOwner, text });
        this.drafts?.setDraft(this.bufferOwner, text);
      }
    }
    this.bufferOwner = id;
    const draft = this.freshestDraftFor(id);
    this.textField.seed(draft);
  }
```
(No `textDuty` mention.)

### Blur — `panel.ts:1083-1090`
```ts
  blurTextField(): void {
    this.focus = "options";
    this.lastEscAt = undefined;
    this.textDuty = "elaboration"; // duty is per-focus-session (WRITEIN-001); next focus re-declares it
    this.textField.blur();
    this.invalidate();
  }
```

### Navigation path
`keys.ts` step 4: `if (matchesKey(data, b.prevQuestion)) { ... return actions.prevQuestion(panel); }` / `nextQuestion` — fired even when `editorFocused` (config intercept rule). `actions.ts:344-355` (`nextQuestion`/`prevQuestion`) → `panel.currentId = ordered[next].id` → setter `panel.ts:352-363`:
```ts
  set currentId(id: string | undefined) {
    this.currentIdValue = id;
    const q = id !== undefined ? this.state.getQuestion(id) : undefined;
    this.cursorIndex = q !== undefined ? initialCursorIndex(q) : 0;
    this.syncBufferToQuestion(id);
  }
```

## 3. Cursor preselect on question change

★ preselect = `initialCursorIndex(q)` from `src/panel/short-view.ts` (imported `panel.ts:95`), applied in the `currentId` setter **before** `syncBufferToQuestion` runs. Therefore inside `syncBufferToQuestion`, at the moment of the fix, `this.cursorIndex` already refers to the NEW question's ★ row, and the new question is fetchable (`this.state.getQuestion(id)`) — exactly the two inputs `desiredTextDuty` needs (`q.type === "text"` or `cursorIndex === options.length`). Full info available; no ordering change required.

## 4. Label + spec wording

- Label: `layout.ts:277-290 renderDutyLabel(duty, theme, width)` → `"OTHER — this text is the answer"` (writein) / `"EXPLAIN — attaches to your selection"` (elaboration). Rendered `panel.ts:1324`.
- Synthetic row: `short-view.ts:75 OTHER_AFFORDANCE = "✎ Other — write your own"` (cursor index `options.length`).
- Spec "duty follows entry path and cursor position": `spec/decisions.md:21` (WRITEIN-001, final sentence of that bullet). Also `spec/product-requirements.md:38` (FR-12) and `spec/ui-spec.md:53` ("the duty follows where the user is"); `README.md:40,176` (duty follows context).

## 5. Tests pinning duty semantics

`src/panel/actions.test.ts`:
- `test_wi_accept_other_row_enters_writein_duty_and_seeds_draft` (:734) — ✎ accept → writein.
- `test_blur_resets_duty_to_elaboration` (:883) — the ONLY duty-reset pin.
- `test_digit_never_selects_the_other_row_no_state_change_fr_d1` (:372).
- `test_submit_writein_ships_value_custom_no_text_duplication` (:1500), `test_submit_superseded_writein_rebinds_as_elaboration` (:1524).
- `test_auto_text_enter_via_writein_duty_fires` (:1878), `test_auto_empty_buffer_writein_exit_never_fires` (:1897).
- `bug008_draft_of_reasked_question_survives_submit...` (:613).

`src/panel/panel.test.ts`:
- `desiredTextDuty_prefers_the_type_check_over_the_Other_row_index` (:2256), `ctrl_t_on_option_cursor_opens_elaboration_duty_with_EXPLAIN_label` (:2277), `elaboration_enter_saves_draft_and_blurs_never_answers_or_advances_AC2b` (:2292), `ctrl_t_on_the_Other_row_opens_writein_duty_and_enter_commits_custom` (:2311), `ctrl_t_on_a_text_question_opens_writein_duty_and_enter_commits` (:2336), `ctrl_t_repress_exits_writein_duty_with_draft_write_through_never_commits` (:2395), `write-in duty renders the OTHER label above the editor (WRITEIN-001)` (:443).

**No test asserts that navigation preserves duty** — nothing to flip; only new coverage needed.

`src/panel/keys.test.ts` also covers prev/next interception in text focus (step-4 rule) — check its expectations if behavior of navigation changes (it should not: navigation still happens; only duty re-derives).

## Fix sketch

**Recommended: re-derive `textDuty` from the new question's cursor position inside `syncBufferToQuestion`, after the re-seed:**
```ts
    this.bufferOwner = id;
    const draft = this.freshestDraftFor(id);
    this.textField.seed(draft);
    // BUG-004 / WRITEIN-001 "duty follows cursor": a focus-session that
    // spans a question change re-declares its duty from the NEW question's
    // freshly-seeded cursor (★ preselect — actions.ts accept sets duty
    // itself and never routes through here).
    if (this.focus === "text") {
      const q = id !== undefined ? this.state.getQuestion(id) : undefined;
      this.textDuty =
        q?.type === "text" || this.cursorIndex === (q?.options?.length ?? 0)
          ? "writein"
          : "elaboration";
    }
```
This is more consistent with existing code than a blanket reset: (a) it mirrors `desiredTextDuty`'s exact rule (keys.ts — could even import/reuse it; keys.ts→panel.ts is type-only so no runtime cycle, though panel.ts currently does not import values from keys.ts — inline duplication of the 2-line predicate is the lower-risk option); (b) WRITEIN-001's stated contract ("duty follows entry path and cursor position", decisions.md:21) argues for cursor-derived duty at every scope change, not just entry; (c) a text-type question navigated-to while focused SHOULD be writein (its buffer is the answer), which a flat elaboration reset would get wrong. Guard on `focus === "text"` so options-focus navigation (no editor session) and note duty (early return above) are untouched; the `bufferOwner === id` early-return path (same-question) is unaffected.

Alternative (rejected): reset to `"elaboration"` in the `currentId` setter — simpler, but wrong for text questions and diverges from the cursor-derived principle.

Tests to add: navigate from Other-row writein focus to a fresh choice question → enter saves draft + blurs (elaboration); navigate to a `type:"text"` question while focused → enter commits writein.

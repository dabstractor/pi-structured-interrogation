# PRP — P1.M4.T1.S2: Two-stage enter, newlines, history isolation

## Goal

**Feature Goal**: Implement Mode A two-stage enter for the free-text field (h2.31): `enter` in text focus saves the draft (`{value, text}`) into the question's draft slot, blurs back to options focus, and arms a one-shot "advance on next enter" flag; the NEXT `enter` advances to the next unanswered question. `shift+enter`/`ctrl+j`/`alt+enter` insert newlines safely (R4 multi-line support). Enter in NOTE focus saves the batch note and exits note mode. History is fully isolated — `addToHistory` is never called.

**Deliverable**: Modified `src/panel/panel.ts` (two-stage state machine: `advanceArmed` flag, stage-1 save on enter in text/note focus, stage-2 advance, draft persistence via the `DraftStore` seam) + tests in `src/panel/panel.test.ts` (or a new `src/panel/two-stage.test.ts` if cleaner). Optionally a tiny helper method on `src/panel/text-field.ts` (from P1.M4.T1.S1) — no new files required, no changes to keys.ts, config.ts, actions.ts.

**Success Definition**: In text focus: enter → draft saved (`drafts.setDraft(currentId, text)` called, panel-local `{value, text}` slot updated), `focus === "options"`, `textField.focused === false`, flag armed; next enter → flag consumed, cursor advances to the next unanswered question, no option selected; any other key while armed → flag disarmed, normal behavior. shift+enter (`"\x1b[13;2u"` kitty / `"\x1b[13;2~"`), `"\n"` (ctrl+j), `"\x1b\r"` (alt+enter) reach `textField.handleInput` unmodified (newline inserted, nothing saved). In note focus: enter → `drafts.setNote(text)`, note mode exits. `grep -rn "addToHistory" src/` (panel files) returns nothing. `npm run typecheck` + `npm test` green.

## User Persona (if applicable)

**Target User**: pi user answering interrogation questions.

**Use Case**: User focuses the text field (ctrl+t), types a multi-line explanation, presses enter to save, then enter again to move on — without ever accidentally submitting early or losing a line to an enter keypress.

**User Journey**: ctrl+t → type "line1", shift+enter, "line2" → enter (draft saved, focus back on options, flag armed) → enter (advance to next question). If the user instead changes their mind and presses ↑ first, the flag disarms and enter behaves normally (select current option).

**Pain Points Addressed**: Single-enter UX that makes multi-line typing impossible (the classic "enter ate my draft" problem); history pollution of the user's main editor history.

## Why

- h2.31 (Q17=A): "enter saves the draft and returns focus to options; the *next* enter advances (two-stage, so multi-line typing with shift+enter/ctrl+j is safe). Separate history (never calls addToHistory)."
- FR-12 (h3.1): identical contract restated for the panel.
- Unblocks P1.M4.T1.S3 (ctrl+g reads the saved draft via getText/seed) and P1.M4.T2.S2 (batch note mode reuses the note-focus enter path).

## What

### Two-stage contract (Mode A) — authoritative

1. **Trigger location**: `InterrogationPanel.handleInput`, BEFORE the text is forwarded to the editor (i.e., before the `focus === "text" → textField.handleInput(data)` forwarding that P1.M4.T1.S1 added), check:
   - `this.focus === "text" || this.focus === "note"` AND `parseKey(data) === "enter"` (EXACT — `parseKey` returns `"shift+enter"` etc. with modifiers, so shifted/kitty variants never match).
   - This panel-level interception covers BOTH composed editors (pi-vim, whose `onSubmit` may not exist) and the stock editor uniformly, and prevents the stock editor's destructive `submitValue()` (which empties state and trims) from firing at all. **Rationale recorded in JSDoc** (see "Implementation Patterns").
2. **Stage 1 (enter in text focus)**: `saveTextDraft()` —
   - Read text via `textField.getText()` (S1 wrapper already prefers `getExpandedText?.() ?? getText()`).
   - Write to the panel-local draft slot: `this.draftSlots.set(questionId, { value: question.id, text })` (a `Map<string, {value: string, text: string}>` — the {value,text} shape per the contract; final store reconciliation is P1.M4.T2.S1).
   - Persist via the existing seam when present: `this.drafts?.setDraft(this.currentId, text)`.
   - `this.textField.blur()`; `this.focus = "options"`; `this.advanceArmed = true`; `this.invalidate()`.
   - Do NOT advance, do NOT select an option.
3. **Stage 2 (enter in options focus while armed)**: in `handleInput`, checked when `this.advanceArmed && this.focus === "options"` and `parseKey(data) === "enter"` → consume flag (`advanceArmed = false`), advance to the next unanswered question (reuse `actions.nextQuestion(this)` semantics — import from `./actions.ts` if it navigates to next unanswered; if `nextQuestion` is a plain step, advance until the next question in an open/unanswered status, matching the accept+advance behavior; inspect actions.ts and mirror it), `invalidate()`, return. This check must run BEFORE the `this.keys` seam dispatch so the armed flag cannot be shadowed by the router's normal enter→accept interception.
4. **One-shot disarm**: any OTHER input event while `advanceArmed === true` (and it is not the stage-2 enter) sets `advanceArmed = false` before normal dispatch proceeds. Implement as: at the top of handleInput after the `resolved` guard — `if (this.advanceArmed && parseKey(data) !== "enter") this.advanceArmed = false;` then run the stage-2 check.
5. **NOTE mode**: enter while `focus === "note"` → `saveNote()`: `this.batchNote = text; this.drafts?.setNote(text); this.textField.blur(); this.focus = "options";` NO advance arming (a note is not a question answer). The note-mode field itself (opening via ctrl+shift+m) is P1.M4.T2.S2 — this task only implements the enter-to-save-and-exit path so it exists when that task lands.
6. **Newline safety**: the panel-level check matches ONLY exact `"enter"`. Everything else (shift+enter kitty `"\x1b[13;2u"`, xterm `"\x1b[13;2~"`, ctrl+j `"\n"`, alt+enter `"\x1b\r"`) falls through: keys-router intercepts (ctrl+s etc.) still fire (h2.34), the remainder reaches `textField.handleInput` where the editor inserts a newline natively. No newline handling is implemented in this task.
7. **History isolation**: never call `addToHistory` anywhere (stock editor's internal up/down history therefore stays empty). Do NOT set `editor.onSubmit` in this task either — the panel-level interception is the single stage-1 trigger; setting onSubmit too would double-fire if the interception ever misses.
8. **Seed on refocus**: when focus returns to the text field (S1's `focusTextField()` path), the field must re-seed from the saved draft — extend the host wiring: `textField.seed(this.draftSlots.get(currentId)?.text ?? this.drafts?.getDraft(currentId) ?? "")`. If S1 already seeds via the drafts seam, keep both reads (local slot first — it is always freshest).

### Success Criteria

- [ ] Enter in text focus saves draft, blurs to options, arms flag; editor content preserved in the draft slot (panel-local + DraftStore when provided).
- [ ] Next enter advances to the next unanswered question; flag consumed (second consecutive enter after advance = normal accept behavior).
- [ ] Any non-enter key while armed disarms the flag (one-shot semantics).
- [ ] `shift+enter`, ctrl+j (`"\n"`), alt+enter (`"\x1b\r"`) in text focus reach `textField.handleInput` verbatim — no save, no blur.
- [ ] Enter in note focus saves batch note and exits note mode without arming.
- [ ] Refocusing the text field re-seeds the saved draft.
- [ ] grep gate: no `addToHistory` in any src/panel file; no `onSubmit` assignment to the editor.
- [ ] `npm run typecheck` + `npm test` green; `[Mode A]` JSDoc on the two-stage contract in panel.ts.

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the exact stock-Editor enter/newline internals (why panel-level interception is chosen), the keys-router forwarding contract, S1's TextField surface, panel.ts seams, and parseKey behavior. All anchored below.

### Documentation & References

```yaml
- url: (local) node_modules/@earendil-works/pi-tui/dist/components/editor.js (lines 700-740, 1124-1150)
  why: stock Editor key handling — newline sequences checked BEFORE submit; submit path (kb.matches "tui.input.submit") → submitValue() which RESETS state (lines:[""], undoStack.clear), TRIMS, fires onChange("") then onSubmit(result).
  critical: if enter reached the stock editor, the buffer would be emptied and trimmed by submitValue — intercepting at panel level avoids depending on that and works for composed editors too. disableSubmit must stay false ONLY if we relied on submit; we do NOT — but never set it true either (irrelevant once intercepted).

- url: (local) node_modules/@earendil-works/pi-tui/dist/keys.d.ts
  why: parseKey(data): string | undefined returns the FULL KeyId including modifiers — "shift+enter" for shifted enter, "enter" for plain. Key.enter helper. Use parseKey(data) === "enter" (exact string) — never raw data === "\r" (breaks under kitty protocol).
  gotcha: matchesKey(data, Key.enter) would also be fine but parseKey-exact makes the modifier distinction explicit and testable.

- url: (local) node_modules/@earendil-works/pi-tui/dist/editor-component.d.ts
  why: EditorComponent optionality — onSubmit?/onChange?/addToHistory?/getExpandedText? are ALL optional; a composed editor may lack onSubmit entirely (the reason stage-1 lives in panel.handleInput, not in editor.onSubmit).
  critical: never assume the composed component implements anything beyond getText/setText/handleInput/render.

- file: src/panel/panel.ts
  why: ALL integration points: PanelFocus incl. "text"/"note" (line 61); DraftStore seam getDraft/setDraft/getNote/setNote (lines 64-74); focus field (line 198); drafts field (line 265); handleInput with resolved guard + keys seam + (S1) textField forwarding (line ~333); openPanel option forwarding (lines 645-646).
  gotcha: stage-2 armed check must run BEFORE this.keys dispatch; stage-1 enter check must run BEFORE the textField forwarding added by S1. Keep the `resolved` guard first.

- file: plan/001_0d6760db6bc5/P1M4T1S1/PRP.md
  why: CONTRACT (parallel, treat as landed): src/panel/text-field.ts exports TextField { getText, setText, seed, focus, blur, handleInput, render, focused, editor }; panel gains textField field + focusTextField() (focus="text", textField.focus(), seed(draft)); handleInput forwards unmatched input to textField ONLY when focus==="text"; S1 explicitly does NOT set onSubmit and does NOT parse keys.
  gotcha: S1's forwarding is where stage-1 interception must be inserted — your enter check goes immediately before that forwarding block.

- file: plan/001_0d6760db6bc5/P1M3T3S1/PRP.md
  why: CONTRACT (parallel, treat as landed): keys.ts router intercepts panel accelerators BEFORE forwarding even in text focus (h2.34) but forwards enter/digits/letters in text focus; enter→accept interception applies only in OPTIONS focus; onFocusText seam → panel.focusTextField().
  gotcha: the router will call actions.accept(panel) for enter in options focus — your armed stage-2 check runs BEFORE the router in handleInput, so it wins exactly once (the armed enter never reaches the router). Verify order in the final merged handleInput.

- file: src/panel/actions.ts (P1.M3.T2.S2, landed)
  why: nextQuestion(panel) / accept(panel) navigation semantics — reuse nextQuestion for stage-2 advance; read it to match "next unanswered" vs "next" behavior.
  gotcha: if nextQuestion steps to the immediately-next question regardless of status, check how accept+advance picks the next UNANSWERED one and mirror that (h2.31 "advances").

- file: src/panel/panel.test.ts + src/panel/actions.test.ts
  why: test conventions: stub theme ({fg, bold} cast to Theme), stub TUI, real InterrogationState fixtures, vi.fn() spies, fake EditorComponent literals; AUTOMATION-POLICY.md — no live pi session, everything is vitest-assertable.
  pattern: drive handleInput with raw data strings ("\r" plain enter; "\x1b[13;2u" kitty shift+enter; "\n" ctrl+j; "\x1b\r" alt+enter) and assert on spies.

- file: plan/001_0d6760db6bc5/prd_snapshot.md (h2.31, h2.34, h2.45 drafts lifecycle)
  why: authoritative two-stage wording, hotkey table (enter fixed; nothing to config), draft survival rules (drafts survive navigation — the panel-local slot map must NOT be cleared on question change).
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
  panel.ts          # MODIFY: two-stage state machine + draft slots + saveTextDraft/saveNote + JSDoc
  panel.test.ts     # MODIFY/extend (or new two-stage.test.ts)
  text-field.ts     # from S1 (parallel) — READ-ONLY for this task (seed/read via its API)
  keys.ts           # from P1.M3.T3.S1 (parallel) — READ-ONLY
  actions.ts        # READ-ONLY (reuse nextQuestion)
```

### Desired Codebase tree

```bash
src/panel/
  panel.ts            # advanceArmed, draftSlots Map, saveTextDraft(), saveNote(), handleInput staging
  two-stage.test.ts   # CREATE (preferred: dedicated suite) — full contract coverage
  # (extending panel.test.ts is acceptable if the project prefers one suite per file)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: use parseKey(data) === "enter" — NOT data === "\r". Under the kitty
// keyboard protocol plain enter may arrive with different raw bytes; parseKey
// normalizes. And parseKey("shift+enter" bytes) === "shift+enter" — the exact
// match is what makes newlines safe by construction.
// GOTCHA: stock Editor submitValue() EMPTIES the buffer and TRIMS the text —
// if you ever fall back to onSubmit-based saving, you must re-seed and accept
// the trim. Panel-level interception avoids both.
// GOTCHA: stage-1 check must fire BEFORE S1's focus==="text" forwarding block;
// stage-2 armed check must fire BEFORE the this.keys seam. Both after `resolved`.
// GOTCHA: one-shot disarm must not disarm on the stage-1 enter itself — sequence
// is: disarm-check (skips, it IS enter) → stage-2 check (focus is still "text",
// not "options" → no match) → stage-1 check (matches) → arm. Order matters;
// test both consecutive enters and the disarm path.
// GOTCHA: draftSlots must survive question navigation (tab/shift+tab) — never
// clear it anywhere in this task (R4; destruction rules belong to M4.T2.S1).
// GOTCHA: NOTE focus enter does NOT arm the advance flag.
// GOTCHA: do not touch keys.ts/config.ts/actions.ts/text-field.ts — text-field's
// onSubmit stays unset; if S1's PRP said "FUTURE M4.T1.S2: sets editor.onSubmit",
// this task DELIBERATELY supersedes that with panel-level interception (works for
// composed editors lacking onSubmit) — record the deviation in the JSDoc.
// GOTCHA: "\x1b\r" is alt+enter (newline in stock editor) — it contains ESC but
// parseKey resolves it to "alt+enter", not "enter"; exact match keeps it safe.
```

## Implementation Blueprint

### Data models and structure

```ts
/** Panel-local draft record — {value, text} per the h2.45 contract shape.
 *  Reconciled into the real DraftStore by P1.M4.T2.S1; this map is the
 *  always-fresh source during the panel's lifetime. */
interface TextDraft { value: string; text: string }

// New fields on InterrogationPanel:
private draftSlots = new Map<string, TextDraft>(); // key: question id
/** One-shot two-stage enter flag (h2.31, Mode A). */
advanceArmed = false;
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/panel/panel.ts — two-stage state machine
  - ADD fields: draftSlots (Map<string, TextDraft>), advanceArmed (boolean, public for tests)
  - ADD [Mode A] JSDoc block above the enter-handling code: two-stage contract, why interception is panel-level (composed editors may lack onSubmit; stock submitValue() empties+trims), one-shot disarm rule, note-mode exception, newline safety via parseKey-exact matching, never-addToHistory
  - IMPLEMENT saveTextDraft(): void — getText via this.textField, slot write {value: currentId, text}, this.drafts?.setDraft(currentId, text), textField.blur(), focus="options", advanceArmed=true, invalidate()
  - IMPLEMENT saveNote(): void — this.batchNote = text; this.drafts?.setNote(text); blur; focus="options" (no arming)
  - MODIFY handleInput: after `resolved` guard insert, in order:
      (a) if (this.advanceArmed && parseKey(data) !== "enter") this.advanceArmed = false;
      (b) if (this.advanceArmed && this.focus === "options" && parseKey(data) === "enter") { this.advanceArmed = false; advanceToNextUnanswered(); this.invalidate(); return; }
      (c) if ((this.focus === "text" || this.focus === "note") && parseKey(data) === "enter") { this.focus === "note" ? this.saveNote() : this.saveTextDraft(); return; }
    — (c) MUST sit before S1's focus==="text" → textField.handleInput forwarding; (b) before the this.keys seam. Keep the keys seam call after these.
  - IMPLEMENT advanceToNextUnanswered(): reuse actions.nextQuestion if it targets the next unanswered question; otherwise mirror accept's advance logic from actions.accept — READ actions.ts first and do not duplicate logic (call it, don't copy it)
  - REFINES focus wiring: in the focusTextField path (S1), seed from this.draftSlots.get(currentId)?.text ?? this.drafts?.getDraft(currentId) ?? "" (local slot freshest)
  - IMPORT parseKey from "@earendil-works/pi-tui" (check the package export; keys.d.ts documents it — import alongside whatever panel.ts already imports from pi-tui)

Task 2: CREATE src/panel/two-stage.test.ts (or extend panel.test.ts)
  - FIXTURES: panel with stub theme/TUI (actions.test.ts pattern), real InterrogationState with ≥2 open questions, a drafts seam spy ({setDraft: vi.fn(), getDraft: vi.fn(), setNote: vi.fn(), getNote: vi.fn()}), keys seam vi.fn(() => false), and a fake textField (or real TextField with fake EditorComponent from S1's test pattern)
  - CASES (drive via panel.handleInput with raw data):
    (1) focus="text", handleInput("\r") → setDraft called with currentId+text, focus==="options", textField.focused false, advanceArmed true; then handleInput("\r") → cursor moved to next unanswered question, advanceArmed false, keys spy NOT called for this second enter (stage-2 intercepted first)
    (2) one-shot: focus text → enter (armed) → handleInput("\x1b[A") (arrow) → armed false; next "\r" goes to keys seam / normal accept path
    (3) newlines: focus="text", handleInput("\x1b[13;2u") / "\x1b[13;2~" / "\n" / "\x1b\r" → textField.handleInput received the data VERBATIM, no save, focus still "text", advanceArmed false
    (4) kitty plain enter "\x1b[13u" (if parseKey resolves to "enter" in tests — verify; else document) — at minimum test "\r"
    (5) note mode: focus="note", handleInput("\r") → setNote called with text, focus="options", advanceArmed stays false
    (6) refocus seeding: after stage-1 save, focusTextField() → textField.seed called with saved text (spy)
    (7) draft slot survives navigation: save draft on q1, nextQuestion to q2, back to q1, refocus → seeded with q1's draft
    (8) history isolation: after all operations, editor fake's addToHistory (if defined) never called; grep-gate style assertion
  - FOLLOW pattern: src/panel/panel.test.ts / actions.test.ts (bare stubs, vi.fn spies)

Task 3: VERIFY merged handleInput order against the LANDED keys.ts + text-field.ts
  - keys.ts (P1.M3.T3.S1) may have landed by implementation time and DELETED panel.ts's minimal matcher — re-read handleInput and ensure the staging inserts survive that merge: resolved guard → (a) disarm → (b) armed stage-2 → (c) text/note stage-1 → keys seam → textField forwarding → default. Add a comment pinning the order.
  - If keys.ts's onFocusText default already calls panel.focusTextField(), no change needed; if the host wires it, ensure the seed refinement (Task 1) is inside focusTextField, not duplicated.
```

### Implementation Patterns & Key Details

```ts
// [Mode A] Two-stage enter (h2.31, Q17=A) — insert at the top of handleInput
// after the `resolved` guard, BEFORE the keys seam and before textField
// forwarding. Stage 1 intercepts enter at the PANEL level rather than via
// editor.onSubmit because (1) composed editors (pi-vim) may not implement
// onSubmit, and (2) the stock Editor's submitValue() empties and trims the
// buffer. parseKey-exact matching ("enter") makes shift+enter/ctrl+j/alt+enter
// newlines safe by construction. History isolation: addToHistory is never
// called anywhere in this panel.

handleInput(data: string): void {
  if (!this.canAct()) return; // existing `resolved` guard
  const key = parseKey(data);
  if (this.advanceArmed && key !== "enter") this.advanceArmed = false; // one-shot
  if (this.advanceArmed && this.focus === "options" && key === "enter") {
    this.advanceArmed = false;
    this.advanceToNextUnanswered(); // actions.nextQuestion / accept's advance
    this.invalidate();
    return;
  }
  if ((this.focus === "text" || this.focus === "note") && key === "enter") {
    if (this.focus === "note") this.saveNote(); else this.saveTextDraft();
    return; // never reaches the editor: no stock submitValue, no onSubmit
  }
  // ... existing keys seam → textField forwarding (S1/keys.ts) unchanged
}
```

### Integration Points

```yaml
PANEL: draftSlots + advanceArmed + saveTextDraft/saveNote + handleInput staging
TEXT-FIELD (S1, read-only): getText/blur/seed/focused consumed; onSubmit stays UNSET
KEYS (P1.M3.T3.S1, read-only): no changes; router's enter→accept only fires in
  options focus and only AFTER the armed stage-2 check consumed the enter
ACTIONS (read-only): reuse nextQuestion (or accept's advance) — do not copy logic
FUTURE M4.T1.S3 (ctrl+g): reads the draft via draftSlots/drafts seam + textField.getText
FUTURE M4.T2.S1: DraftStore implementation lands; draftSlots may then delegate
  (keep the local {value,text} shape authoritative for the panel lifetime)
FUTURE M4.T2.S2: batch-note open path (ctrl+shift+m → focus="note") plugs into saveNote
NO changes to: config.ts (enter is fixed per h2.34), keys.ts, actions.ts, text-field.ts, state.ts
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck    # zero errors
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/two-stage.test.ts -v   # (or the extended panel.test.ts)
npx vitest run src/panel/ -v
npm test
```

### Level 3: Integration — SCRIPTED ONLY (AUTOMATION-POLICY.md)

All behavior is vitest-assertable via raw data strings + spies (no live pi session). Interactive two-stage feel in a real terminal belongs to MANUAL-TUI-AC-RUNBOOK.md — do not execute it.

### Level 4: Domain-specific

```bash
grep -rn "addToHistory" src/panel/ | grep -v test   # must be empty (h2.31)
grep -n "onSubmit" src/panel/panel.ts src/panel/text-field.ts  # no assignment to the editor
grep -n "Mode A" src/panel/panel.ts                  # JSDoc present
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean; `npm test` all green.
- [ ] Level 4 grep gates pass (no addToHistory, no editor onSubmit assignment, Mode A JSDoc present).

### Feature Validation

- [ ] Stage 1: enter in text focus saves draft (slot + DraftStore seam), blurs to options, arms flag.
- [ ] Stage 2: next enter advances to next unanswered question; flag consumed exactly once.
- [ ] One-shot: any non-enter key disarms; subsequent enter behaves normally.
- [ ] shift+enter (both kitty and xterm sequences), ctrl+j, alt+enter forwarded verbatim to the editor — multi-line typing safe (R4).
- [ ] NOTE focus: enter saves batch note and exits note mode, no arming.
- [ ] Refocus re-seeds the saved draft; slots survive question navigation.
- [ ] Merged handleInput order verified against landed keys.ts: resolved → disarm → armed stage-2 → text/note stage-1 → keys seam → textField forwarding.

### Code Quality Validation

- [ ] Reuses actions.nextQuestion instead of duplicating navigation logic.
- [ ] No changes outside panel.ts + test file.
- [ ] Raw-data-string tests (not abstracted-away key events) so terminal realities are covered.

### Documentation & Deployment

- [ ] [Mode A] JSDoc documents the two-stage contract AND the deliberate deviation from "onSubmit repurposed" (panel-level interception rationale).
- [ ] No new config keys (enter is fixed per h2.34).

## Anti-Patterns to Avoid

- ❌ Don't match enter with `data === "\r"` — breaks under kitty protocol; use `parseKey(data) === "enter"`.
- ❌ Don't set `editor.onSubmit` as the save trigger (double-fire risk + composed editors may not implement it; stock submitValue empties/trims).
- ❌ Don't intercept shift+enter/ctrl+j — they must fall through to the editor.
- ❌ Don't clear draftSlots on navigation or blur — R4 survival.
- ❌ Don't arm the flag in note mode.
- ❌ Don't modify keys.ts / actions.ts / text-field.ts / config.ts to make this work — the staging lives in panel.handleInput.
- ❌ Don't let the stage-1 enter reach the stock editor (destructive submitValue).

# PRP — P1.M4.T2.S2: Batch note (R3) — ctrl+shift+m note mode + NOTE: delivery

## Goal

**Feature Goal**: Implement hard requirement R3 (h2.32, FR-13): `ctrl+shift+m` (config key `batchNote`) swaps the panel into **note mode** at ANY time — the SAME embedded `TextField` instance becomes the note field (editor-area swap), the header reads `NOTE — ships with next submission`. `esc`/re-press exits note mode; the draft is preserved between opens (R4) and across suspend/resume (via the `DraftStore` seam from P1.M4.T2.S1). On the NEXT panel submission, the note ships as a `NOTE:` line in the delta content the MODEL receives, is carried on `details.note` for the user-only diff card (renderer lands P1.M7.T3.S1), and is then **cleared** ("cleared after shipping", h2.32).

**Deliverable**:
1. `src/panel/panel.ts` — add public `enterNoteMode()` / `exitNoteMode()` methods + note-mode branch in `buildLines()`.
2. `src/panel/keys.ts` — implement the `onBatchNote` stub as a toggle; `esc` in note focus exits.
3. `src/panel/layout.ts` — add `renderNoteHeader(theme, width): string`.
4. `src/delivery.ts` — `buildSubmission` appends a third `NOTE: {text}` content line when a note ships (keeps `details.note`).
5. `src/panel/actions.ts` — `submit()` reads the note, passes it to `buildSubmission`, clears it after delivery.
6. `src/debug-commands.ts` — `/interrogate-debug-submit` accepts a `note=text` token for scripted AC coverage.
7. Tests in `keys.test.ts`, `two-stage.test.ts`, `panel.test.ts`, `actions.test.ts`, `delivery.test.ts`, `debug-commands.test.ts`.

**Success Definition**: With a panel open, pressing `ctrl+shift+m` anywhere (options focus, text focus, any view) swaps the editor area into note mode with the note header; typing + `enter` saves and exits; `esc` or re-press exits with the typed text preserved (re-open shows it); suspending/resuming the panel preserves it (store seam); `ctrl+s` with a pending change + held note delivers a message whose `content` ends with `NOTE: {text}` and whose `details.note === text`, after which the note is empty and note-mode re-entry shows a blank field. Zero-pending submit holds the note. All tests + typecheck green.

## User Persona (if applicable)

**Target User**: pi user answering an interrogation panel who wants to attach context ("I picked B for everything because the deploy is Friday") without it belonging to any single question.

**Use Case**: Mid-panel, user hits `ctrl+shift+m`, types the note, `enter` (or esc), keeps answering; on the next `ctrl+s` the note rides along to the model.

**User Journey**: press `ctrl+shift+m` → header swaps to `NOTE — ships with next submission`, editor area becomes the note field (seeded with any earlier draft) → type → `enter` saves + exits (esc/re-press exits, text kept) → footer/`ctrl+s` → submission content gains `NOTE: …` line → note cleared.

**Pain Points Addressed**: No per-question field can carry cross-cutting context; holding it "in your head" until submit loses it. R3 exists because ask_user evaluations lacked any such channel.

## Why

- h2.9: R3 (FR-13) is a HARD requirement: "`ctrl+shift+m` opens a note field at any time; the note is held and delivered as a `NOTE:` line with the next submission."
- h2.32: mode swap semantics, header string, `esc`/re-press exit, stored as `batchNote`, `NOTE:` line in the delta, on the card, cleared after shipping.
- The plumbing is pre-built and tested: key `batchNote` routed (keys.ts:312), `PanelFocus` includes `"note"` (panel.ts:68), stage-1 enter in note focus already calls `saveNote()` (panel.ts:442-443, tests two-stage.test.ts:316-340), `DraftStore.getNote/setNote` seam exists (panel.ts:79-92, implemented in parallel P1.M4.T2.S1), `buildSubmission` already accepts a `note` param (delivery.ts:116).

## What

### Note-mode contract (authoritative)

1. **Open (toggle-on)**: `onBatchNote` fires when `panel.focus !== "note"`. `enterNoteMode()`: set `focus = "note"`, seed the SINGLE `TextField` with `drafts?.getNote() || panel.batchNote || ""` via `textField.seed()` (idempotent, no history pollution — text-field.ts:183), call `textField.focus()`, invalidate.
2. **Editor-area swap (h2.32)**: while `focus === "note"`, `buildLines()` short view renders: note header line + `textField.render(width)` (3-line editor region) + flash line + footer. The question line/hint/options region is REPLACED. Deep/overview views are M5 placeholders — note mode may enter from them (same swap: header + editor + footer).
3. **Header**: exact string `┌ NOTE — ships with next submission ┐` (h2.32 header text `NOTE — ships with next submission` inside the panel's existing border style; follow `renderHeader`'s border/corner conventions in layout.ts:155).
4. **Exit — enter** (existing `saveNote()`, panel.ts:478-488): write `panel.batchNote = text; drafts.setNote(text)`; blur → `focus = "options"`. Never arms advance.
5. **Exit — esc / re-press** (FR-16: esc never destroys state): SAME write-through (`exitNoteMode()` reads `textField.getText()`, writes store + field, blurs) — the typed text is a draft and must survive exit; only display focus changes. `esc` handling: the keys router's esc-descent chain must check `focus === "note"` FIRST (before deep/overview descent) — exiting note mode is the topmost esc action. Re-press of `ctrl+shift+m` while `focus === "note"` calls the same `exitNoteMode()`.
6. **Hold**: nothing ships the note until a real submission. Question navigation, view toggles, upserts, suspend/resume leave it alone (store-side survival is P1.M4.T2.S1's contract; the panel only mirrors).
7. **Ship**: in `actions.ts submit()`, after the zero-pending guard, read `const note = panel.drafts?.getNote() || panel.batchNote`; if non-empty pass to `buildSubmission(panel.state, diff, note)`. AFTER `deliverSubmission(...)`: `panel.drafts?.setNote(""); panel.batchNote = "";` (h2.32 "cleared after shipping"). **Zero-pending branch (`diff.changed.length === 0`): the note is HELD** — no submission occurs, nothing clears (R3: "with the NEXT submission").
8. **Delivery content (resolution of code/PRD conflict)**: landed `buildSubmission` currently treats the note as details-only ("note intentionally details-only", delivery.ts:82-99). h2.32 (authoritative, hard requirement R3) demands the note appear as a `NOTE:` line **in the delta** the model receives. h3.6's own header says "≤3-line custom message" — the 2-line content gains a THIRD line `NOTE: {note}` ONLY when a note ships (content stays exactly 2 lines otherwise). Collapse newlines in the note to `" / "`; the note line is never truncated (same rule as the reminder line). `details.note` stays for the card renderer (P1.M7.T3.S1) — keep both. Update the `buildSubmission` JSDoc (remove "note intentionally details-only", document the 2-or-3-line contract + citation h2.32).
9. **Debug coverage**: `/interrogate-debug-submit q1=a,note=hold this` — a `note=<text>` token is lifted out of the pairs as the batch note (write it through `drafts`-equivalent: pass directly to buildSubmission; also verify the command reports clearing). Unknown id `note` never reaches the state engine.

### Success Criteria

- [ ] `ctrl+shift+m` opens note mode from any focus/view; header shows `NOTE — ships with next submission`.
- [ ] Same TextField instance swaps (no second editor constructed).
- [ ] Enter saves + exits; esc and re-press exit with text preserved; re-entry re-seeds from the store.
- [ ] Submit with pending changes: `content` contains `NOTE: {text}` third line; `details.note === text`; note cleared after; S1's `shipDrafts(diff.changed)` line untouched.
- [ ] Zero-pending submit: note held, nothing delivered.
- [ ] `/interrogate-debug-submit ... note=...` covers the ship+clear path in tests.
- [ ] `npm run typecheck` + `npm test` green.

## All Needed Context

### Context Completeness Check

All anchors verified in the shipped code: the keybinding routing, the note-focus state, the enter-save path, the DraftStore seam, the buildSubmission note param, and the submit integration point. A fresh implementer needs nothing beyond the files below.

### Documentation & References

```yaml
- file: src/panel/panel.ts
  why: THE host — PanelFocus incl. "note" (line 68); batchNote field (line 260);
    saveNote() private (478-488) — the enter-exit path to reuse/rename;
    DraftStore seam interface (79-92: getDraft/setDraft/getNote/setNote);
    single TextField constructed in ctor (line 339, APIs: seed/focus/blur/getText/render);
    buildLines() short view (660-700) — add the note-mode branch BEFORE the idx>=0 region;
    stage-1 enter routing (439-447) already calls saveNote() for focus==="note".
  pattern: follow focusTextField()/blurTextField() (579-593) for focus transitions.
  gotcha: saveNote() is PRIVATE — either make enterNoteMode/exitNoteMode public methods on the
    panel (keys.ts actions take `(p: InterrogationPanel)`), or expose them via the routed
    action surface. Keep stage-1 enter behavior EXACTLY as-is (tests two-stage.test.ts:316-340
    assert setNote + batchNote + focus→"options" + no advanceArmed).

- file: src/panel/keys.ts
  why: THE stub — onBatchNote no-op (245-247); b.batchNote intercept (312-315) already fires in
    ALL focus modes; esc descent chain (FR-16) — find the esc handling and add note-focus exit
    as the highest-priority branch; PanelActions interface declares onBatchNote (line 88).
  pattern: look at onFocusText/onOverview for toggle style (`p.view === x ? ... : ...`).
  gotcha: the router's step 4 intercepts are valid while focus==="text" (h2.34) — make sure
    batchNote intercept also fires while focus==="note" for the re-press exit (it precedes
    text-forwarding, so it does — verify the note-focus early-return ordering around lines
    295-315 does not skip it).

- file: src/panel/layout.ts
  why: renderHeader (line 155) — border/corner/theme conventions for the new
    renderNoteHeader(theme, width): string → `┌ NOTE — ships with next submission ┐`;
    ACTION_WORDS already maps batchNote→"note" (line 57) for footer hints.
  gotcha: use the same dim/border styling as the degraded narrow header; the note header
    string is short so no truncation path is needed (still visibleWidth-guard).

- file: src/delivery.ts
  why: buildSubmission(state, diff, note?) (line 116-154) — append the third content line:
    `const content = base + (noteLine ? "\nNOTE: " + note.replace(/\n/g, " / ") : "")`.
    details.note already set (line 152). Update the format JSDoc (lines 82-99): 2-or-3 lines,
    note line model-visible per h2.32/R3, never truncated, newlines collapsed.
  gotcha: SUBMISSION_LIST_MAX_CHARS budget applies to line 1 ONLY — do NOT include the note
    in the truncation loop. Zero-change submissions with a note still show "Submitted 0:
    (no changes)" + reminder + NOTE line — but note: actions.ts never calls buildSubmission
    with zero changes (guard above); debug command follows the same guard.

- file: src/panel/actions.ts
  why: submit() (line 294-312) — read note, pass to buildSubmission, clear after
    deliverSubmission. Parallel P1.M4.T2.S1 adds `panel.drafts?.shipDrafts(diff.changed)`
    immediately after buildSubmission — KEEP BOTH lines adjacent, do not reorder around
    buildSubmission (it owns snapshot+epoch).
  gotcha: zero-pending branch (297-300) returns BEFORE any note work — held note survives.
  gotcha: reading note order `panel.drafts?.getNote() || panel.batchNote` (store wins; field
    is the pre-S1 fallback for tests without a store).

- file: src/panel/text-field.ts
  why: TextField API — seed(text) idempotent no-history (183), focus/blur, getText (170),
    render(width). seed() is THE re-entry mechanism (draft preserved between opens).

- file: src/debug-commands.ts
  why: parsePairs (52-70) + the interrogate-debug-submit registration (123+). Lift a
    `note=<text>` token out of the parsed pairs; pass as third arg to buildSubmission;
    nothing writes state for it. Document in the command description string.
  gotcha: value parsing trims and allows spaces up to the next comma — same rule applies to
    the note value; fine for scripted ACs.

- file: plan/001_0d6760db6bc5/P1M4T2S1/PRP.md
  why: CONTRACT (parallel, treat as landed): DraftStore lives in index.ts closure,
    getNote/setNote round-trip, note NOT cleared by clearAll, optional seam widening is the
    established pattern. setNote("") is the clear mechanism (no clearNote in the seam).
  gotcha: do NOT add clearNote to the panel.ts DraftStore interface — setNote("") suffices
    and avoids churning the seam while S1 lands.

- file: src/panel/two-stage.test.ts (lines 316-340)
  why: existing note-mode enter tests — they must keep passing unchanged (they set
    panel.focus="note" manually; enterNoteMode() must not break them).

- file: plan/001_0d6760db6bc5/prd_snapshot.md (h2.32, h2.9, h3.6, h3.1 FR-13)
  why: authoritative wording — quote h2.32 in the [Mode A] JSDoc on enterNoteMode.

- file: plan/001_0d6760db6bc5/P1M4T2S2/research/notes.md
  why: this item's research digest (verified line anchors, conflict resolution rationale).
```

### Current Codebase tree (relevant excerpt)

```bash
src/
  panel/panel.ts        # MODIFY: enterNoteMode/exitNoteMode + buildLines note branch
  panel/keys.ts         # MODIFY: onBatchNote toggle + esc exit
  panel/layout.ts       # MODIFY: renderNoteHeader
  panel/actions.ts      # MODIFY: submit() note pass + clear
  delivery.ts           # MODIFY: buildSubmission NOTE: content line + JSDoc
  debug-commands.ts     # MODIFY: note= token
  # tests alongside each
```

### Desired Codebase tree with responsibility of file

```bash
src/
  panel/panel.ts        # note mode host: open/exit methods, editor-area swap, header swap
  panel/keys.ts         # ctrl+shift+m toggle + esc-descent note exit (FR-16)
  panel/layout.ts       # renderNoteHeader — `NOTE — ships with next submission` border line
  panel/actions.ts      # submit: pass note, clear after ship
  delivery.ts           # NOTE: line in model-visible content (h2.32) + details.note kept
  debug-commands.ts     # note= token for scripted AC coverage
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: ONE TextField per panel lifetime (panel.ts:339 ctor) — note mode
// SWAPS that instance into note duty via seed(); NEVER construct a second editor.
// CRITICAL: the note must reach the MODEL (h2.32 "in the delta"), not just
// details. Landed buildSubmission is details-only — this task fixes that by
// appending the third content line. h3.6's "≤3-line" budget explicitly allows it.
// GOTCHA: exit (esc/re-press) WRITES THROUGH to the store — "draft preserved
// between opens" + FR-16 "esc never destroys any state". Do not blur without saving.
// GOTCHA: zero-pending submit holds the note. Only a real delivery clears it.
// GOTCHA: keep the two-stage.test.ts note tests passing — enter in note focus must
// still saveNote()+blur+focus→"options" with advanceArmed===false.
// GOTCHA: S1's shipDrafts line sits right after buildSubmission in submit();
// coordinate edits so both land adjacently (merge-conflict-safe ordering:
// buildSubmission → shipDrafts → deliverSubmission → clear note).
// GOTCHA: seed() not setText() for re-entry — seed is idempotent and pushes no
// editor history (vim-mode users keep clean undo).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: src/panel/layout.ts — renderNoteHeader
  - ADD export function renderNoteHeader(theme: Theme, width: number): string
  - OUTPUT: `┌ NOTE — ships with next submission ┐` using renderHeader's border
    style; visibleWidth-guarded (degrade to `┌ NOTE ┐` below ~30 cols)
  - TEST: exact string at wide width; degraded at narrow; in layout.test.ts

Task 2: src/panel/panel.ts — note mode host
  - ADD public enterNoteMode(): focus="note"; textField.seed(drafts?.getNote() || this.batchNote || "");
    textField.focus(); invalidate()
  - ADD public exitNoteMode(): const text = textField.getText(); this.batchNote = text;
    this.drafts?.setNote(text); this.blurTextField();  // write-through — esc/re-press keep the draft
  - REUSE saveNote() for the enter path (rename-safe: keep both, saveNote = exitNoteMode alias
    or route stage-1 enter to exitNoteMode — two-stage tests must still pass)
  - MODIFY buildLines(): FIRST branch `if (this.focus === "note")` →
    [renderNoteHeader(theme,width), ...this.textField.render(width), flash?, footer]
    (works for all views; Q&A region replaced per h2.32 editor-area swap)
  - [Mode A] JSDoc on enterNoteMode: hold-until-ship semantics citing h2.32/FR-13/R3:
    opened at any time; held (store-backed, survives suspend/resume); ships as NOTE: line
    with the NEXT submission; cleared after shipping; esc/re-press exit preserves the draft
    (FR-16)

Task 3: src/panel/keys.ts — toggle + esc exit
  - IMPLEMENT onBatchNote: (p) => { p.focus === "note" ? p.exitNoteMode() : p.enterNoteMode(); }
  - MODIFY esc descent (FR-16): if (panel.focus === "note") → exitNoteMode() BEFORE the
    deep→short/overview→panel chain (note exit is the innermost level)
  - VERIFY the b.batchNote intercept (line 312) fires while focus === "note" (re-press);
    adjust the focus-based early-returns above it if they would swallow it

Task 4: src/delivery.ts — NOTE: content line
  - MODIFY buildSubmission: after building the 2-line base, if note non-empty append
    `\nNOTE: ${note.replace(/\n+/g, " / ")}`; keep details.note passthrough (line 152)
  - UPDATE the format JSDoc (lines 82-99): content is 2 lines without a note, 3 with;
    note line model-visible (h2.32/R3), never truncated, newlines collapsed; delete the
    "note intentionally details-only" note

Task 5: src/panel/actions.ts — submit wiring
  - In submit(), after the zero-pending guard:
      const note = panel.drafts?.getNote() || panel.batchNote;
      const msg = buildSubmission(panel.state, diff, note || undefined);
      panel.drafts?.shipDrafts(diff.changed);        // ← S1's line (parallel) — keep adjacent
      deliverSubmission(deps, msg, { isIdle: deps.isIdle });
      if (note) { panel.drafts?.setNote(""); panel.batchNote = ""; }  // h2.32 cleared after shipping
  - PRESERVE: zero-pending early return untouched; no snapshot/epoch logic added

Task 6: src/debug-commands.ts — note= token
  - In the debug-submit handler: after parsePairs, extract any pair with id "note" as the
    batch note (remove from the answer pairs); pass to buildSubmission as third arg;
    update the command description to document `note=text`
  - TEST: submit with note → message content contains `NOTE: ...`; details.note set

Task 7: tests (vitest, follow existing files)
  - keys.test.ts: ctrl+shift+m in options focus → enterNoteMode; in note focus → exitNoteMode
    (update spy expectations at lines 101/223/450 to the real toggle); esc in note focus exits
  - panel.test.ts / two-stage.test.ts: enter in note focus (existing tests pass unchanged);
    NEW: enter→exit(esc)→re-enter shows preserved text; buildLines in note focus renders
    exactly note header + editor + footer (no question line)
  - actions.test.ts: submit with drafts.getNote()="n" → buildSubmission called with "n",
    setNote("") called after delivery; zero-pending → setNote NOT called
  - delivery.test.ts: with note → content has 3 lines ending `NOTE: {note}`; newlines
    collapsed; without note → 2 lines (existing tests); details.note both ways
  - debug-commands.test.ts: note= token flows into content + details.note
  - layout.test.ts: renderNoteHeader exact + degraded

Task 8: VALIDATE — npm run typecheck && npm test
```

### Implementation Patterns & Key Details

```ts
// panel.ts — the swap
enterNoteMode(): void {
  this.focus = "note";
  this.textField.seed(this.drafts?.getNote() || this.batchNote || "");
  this.textField.focus();
  this.invalidate();
}
exitNoteMode(): void {
  // FR-16: exit never destroys state — write-through so the draft survives close.
  const text = this.textField.getText();
  this.batchNote = text;
  this.drafts?.setNote(text);
  this.blurTextField();
}

// buildLines — first branch
if (this.focus === "note") {
  const snapshot = this.state.serialize();
  const lines = [renderNoteHeader(this.theme, width)];
  lines.push(...this.textField.render(width));
  const flash = this.flashLine(width);
  if (flash !== undefined) lines.push(flash);
  lines.push(renderFooter(snapshot, this.view, this.labels, this.theme, width));
  return lines;
}

// delivery.ts — the NOTE line
const noteLine =
  typeof note === "string" && note.length > 0 ? `\nNOTE: ${note.replace(/\n+/g, " / ")}` : "";
const content = `Submitted ${k}: ${k === 0 ? "(no changes)" : list}\n${SUBMISSION_REMINDER}${noteLine}`;
```

### Integration Points

```yaml
KEYS: batchNote intercept already routed (keys.ts:312) — only the action body + esc branch change
SUBMIT: actions.ts submit() — note read → buildSubmission 3rd arg → clear after deliver
DELIVERY: buildSubmission content contract becomes 2-or-3 lines; details.note unchanged
  (card renderer M7.T3.S1 consumes it)
COMPLETION: buildCompletion's notes collection reads delivered details.note (existing
  seam) — nothing to do here
FUTURE M7.T3.S1: diff card shows the note from details.note — data already lands
DEBUG: /interrogate-debug-submit note=text for scripted ACs
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck    # zero errors
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/keys.test.ts src/panel/two-stage.test.ts src/panel/panel.test.ts -v
npx vitest run src/panel/actions.test.ts src/delivery.test.ts src/debug-commands.test.ts -v
npm test
```

### Level 3: Integration (scripted)

```bash
# Scripted AC coverage via debug commands (same fixtures the M7.T6 runbook uses):
# upsert → debug-submit with note → verify NOTE: line + clearing semantics in tests
npm test src/debug-commands.test.ts -v
```

### Level 4: Domain-specific

```bash
grep -n "NOTE — ships with next submission" src/panel/layout.ts   # exact h2.32 header
grep -n "Mode A" src/panel/panel.ts                                # hold-until-ship JSDoc
grep -n "setNote(\"\")" src/panel/actions.ts                       # cleared-after-shipping
grep -rn "new TextField\|createEditorComponent" src/panel/panel.ts # still exactly ONE editor
grep -c "NOTE:" src/delivery.ts                                    # content line present
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean; `npm test` all green (incl. the pre-existing two-stage note tests unchanged).

### Feature Validation

- [ ] ctrl+shift+m opens note mode from any focus; header string exact; editor-area swapped (no question line rendered).
- [ ] Enter saves + exits; esc/re-press exits preserving text; re-entry re-seeds.
- [ ] Submit ships `NOTE:` line in content + `details.note`, then clears; zero-pending holds.
- [ ] Debug submit with `note=` covers the AC path in tests.
- [ ] Exactly one TextField instance per panel lifetime.

### Code Quality Validation

- [ ] No changes to the 4 required DraftStore seam members; no clearNote added.
- [ ] buildSubmission still performs takeSnapshot + bumpEpoch exactly once; truncation loop untouched.
- [ ] S1's shipDrafts line preserved adjacent to buildSubmission.

### Documentation & Deployment

- [ ] `[Mode A]` JSDoc on enterNoteMode documents hold-until-ship, cleared-after-shipping, esc-preserves-draft (h2.32, FR-13/R3, FR-16).
- [ ] buildSubmission format JSDoc updated to the 2-or-3-line contract.

## Anti-Patterns to Avoid

- ❌ Don't create a second editor component for the note — the SAME TextField swaps via seed().
- ❌ Don't ship the note as details-only — R3 requires the model-visible `NOTE:` line in the delta (h2.32).
- ❌ Don't clear the note on zero-pending submit — it ships with the NEXT submission.
- ❌ Don't destroy the draft on esc/re-press exit — write-through, then blur (FR-16).
- ❌ Don't use setText() for re-entry — seed() is the no-history idempotent path.
- ❌ Don't add snapshot/epoch logic around the note in submit — buildSubmission owns side effects.
- ❌ Don't widen the DraftStore seam beyond S1's optional members — setNote("") is the clear.

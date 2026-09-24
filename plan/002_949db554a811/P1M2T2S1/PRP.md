---
name: "P1.M2.T2.S1 — Write-in duty: accept Other opens editor in write-in mode; enter commits custom answer + advances (FR-D1, WRITEIN-001)"
description: "Add the editor-duty concept to src/panel (textDuty: 'writein' | 'elaboration', default elaboration) and the write-in commit path. accept() at the Other index sets duty='writein' then calls the existing focusTextField() seeding path (unchanged). The editor region gains the write-in label line 'OTHER — this text is the answer' (verbatim). In handleInput's text-focus enter branch, duty='writein' routes to a new exported actions.ts commitWriteIn(panel, q, text): empty buffer → save draft + blur (no commit); non-empty → applyAnswer({value: text, custom: true, at}) → evaluateDependsOn → advanceAfterAccept — mirroring acceptOptionIndex's post-commit sequence exactly (Q14 parity). Ripple routing for answered/submitted write-in commits is P1.M2.T2.S2 (NOT here). No new arm usage (P1.M2.T4.S1 deletes that machinery). Mode A JSDoc: three duties, commit-at-enter, custom answer shape."
---

## Goal

**Feature Goal**: FR-D1 / WRITEIN-001 (h2.32): accepting the synthetic `✎ Other — write your own` row (landed by P1.M2.T1.S1) opens the embedded editor in WRITE-IN duty with the labeled region `OTHER — this text is the answer`; `enter` commits the buffer as `answer.value` with `custom: true`, re-derives dependsOn, and advances — exactly like an option accept (Q14 parity). Empty buffer + `enter` saves the draft and blurs with NO commit.

**Deliverable**: Modified `src/panel/panel.ts` (duty field, focus routing, enter routing, duty label line), `src/panel/actions.ts` (accept rewiring + new `commitWriteIn`), plus tests in `src/panel/actions.test.ts` and `src/panel/panel.test.ts` using the existing no-mock harness.

**Success Definition**: `npm test` + `npm run typecheck` green; scripted: accept Other → editor focused with label line → type text → enter → question `answered` with `answer = { value: <text>, custom: true, at }`, dependsOn re-derived, panel advanced to next unanswered; empty buffer + enter → draft saved, question still unanswered, focus back on options; elaboration/two-stage paths (ctrl+t) completely unchanged.

## User Persona

**Target User**: TUI user none of whose options fit — "None of the listed options fit — write your own answer; it ships as the official answer for this question, not as an attachment" (h2.29 deep-view ramification).

**Use Case**: Choice question, 3 options, none right → cursor to last row (`✎ Other — write your own`) → `enter` → editor opens labeled `OTHER — this text is the answer` → type "a hybrid of A and B" → `enter` → question answered, panel advances.

**User Journey**: accept Other → labeled write-in editor (seeds from the question's draft — revisits restore) → type/multi-line via shift+enter / ctrl+j → `enter` commits + advances. Back-out gestures (esc-esc, ctrl+t re-press later) save the draft — never lose text (R4).

**Pain Points Addressed**: Before WRITEIN-001 the editor could only elaborate on a listed option; a hand-written answer had no path ("a hand-written answer ships BY ITSELF" was impossible).

## Why

- h2.32 (WRITEIN-001): write-in duty entered "by accepting the synthetic `✎ Other — write your own` row"; "`enter` COMMITS: `applyAnswer({ value: <text>, custom: true })` → status `answered` → dependsOn recompute → advance (Q14 parity)"; "Empty buffer + `enter` = save draft + blur back to options, NO commit".
- h2.42: `answer = { value, at, text?, custom? }` — `custom: true` marks a write-in; the `custom` field already exists end-to-end (P1.M1.T1.S1) and `✎ {text}` display landed (P1.M1.T2.S1/S2). This item is the panel commit path that produces such answers.
- h2.10 AC-2a: "accept `✎ Other`, type free text, `enter` → question answered with `answer.value = <text>`, `custom: true`, NO option selected; advance moves on".
- Consumed by: P1.M2.T2.S2 (ripple routing), P1.M2.T4.S1 (two-stage removal — must not depend on it), P1.M2.T5.S1 (draft role binding), P2.M1.T1.S1 (maybeAutoSubmit hooks after this commit).

## What

### 1. Duty state — `src/panel/panel.ts`

- Add a public field near `bufferOwner` (~:394):

```ts
/**
 * [Mode A] The embedded editor's answer-side duty (WRITEIN-001, h2.32).
 * ONE editor, three duties: "writein" (the buffer IS the answer — entered
 * by accepting the ✎ Other row; enter COMMITS `applyAnswer({value, custom:
 * true})` + advance, Q14 parity), "elaboration" (default — the buffer
 * attaches to the selected option at submit; entered via keys.focusText,
 * P1.M2.T3.S1), and note duty (focus === "note", R3 — question-agnostic,
 * unchanged). The ACTIVE duty decides what the text MEANS and what the
 * editor region label says; it is set at focus time and reset to
 * "elaboration" on every blur.
 */
textDuty: "writein" | "elaboration" = "elaboration";
```

- `blurTextField()` (~:1046): reset `this.textDuty = "elaboration"` (duty is per-focus-session; next focus re-declares it).
- `focusTextField()` stays byte-identical (the seeding path is shared: "The editor seeds from the question's draft" — h2.32). Callers set `textDuty` before/around calling it.

### 2. Accept routing — `src/panel/actions.ts` `accept()` (~:216)

Replace the Other-index branch:

```ts
if (panel.cursorIndex >= optionCount) {
  // ✎ Other row (WRITEIN-001): the editor becomes the WRITE-IN surface —
  // enter commits the buffer as the answer (commitWriteIn), not a draft.
  // focusTextField still seeds the freshest draft (R4 revisit restore).
  panel.textDuty = "writein";
  panel.focusTextField();
  return true;
}
```

Everything else in `accept` unchanged (text questions, moot/withdrawn, option accept).

### 3. Commit-at-enter — `src/panel/panel.ts` `handleInput` stage (c) (~:753)

Current: `if (this.focus === "note") this.exitNoteMode(); else this.saveTextDraft();`
New:

```ts
if (this.focus === "note") this.exitNoteMode();
else if (this.textDuty === "writein") writeInEnter(this);
else this.saveTextDraft();
```

(`writeInEnter` imported from actions.ts — keeps the commit sequence beside acceptOptionIndex.) The `enter` byte-guard (`data !== "\n"`) above already keeps newline inserts safe — multi-line typing is unchanged (`shift+enter`/`ctrl+j` never reach this branch).

### 4. The commit path — `src/panel/actions.ts` (new, beside acceptOptionIndex)

```ts
/**
 * [Mode A] Write-in enter (WRITEIN-001, FR-D1, Q14 parity): in write-in
 * duty, enter COMMITS the buffer as the answer — applyAnswer({ value: text,
 * custom: true }) → evaluateDependsOn → advanceAfterAccept — mirroring
 * {@link acceptOptionIndex}'s post-commit sequence exactly (h2.42 answer
 * shape: value holds the user's own text, custom: true marks the write-in;
 * no option is selected). EMPTY buffer: save the draft + blur back to
 * options, NO commit (nothing answered — h2.32). Ripple routing for
 * write-in commits on answered/submitted questions lands in P1.M2.T2.S2.
 * Consumed by: two-stage removal (P1.M2.T4.S1 must not break it), draft
 * role binding (P1.M2.T5.S1), maybeAutoSubmit (P2.M1.T1.S1 hooks here).
 */
export function writeInEnter(panel: InterrogationPanel): boolean {
  const q = currentQuestion(panel);
  if (q === undefined) { panel.blurTextField(); return true; }
  const text = panel.textField.getText();
  if (text.trim().length === 0) {
    // Empty: draft write-through + blur, no commit (R4) — reuse the
    // existing stage-1 tail (draftSlots + DraftStore seam + EXPLAIN-003
    // cursor re-seed to ★), explicitly NOT arming any advance.
    panel.commitTextDraft(q.id, text, { arm: false });
    return true;
  }
  panel.state.applyAnswer(q.id, { value: text, custom: true, at: new Date().toISOString() });
  evaluateDependsOn(panel.state); // FR-17: same once-per-commit placement as acceptOptionIndex
  advanceAfterAccept(panel);      // Q14 parity: currentId → next unanswered, cursor → ★ preselect
  panel.blurTextField();          // resets textDuty to "elaboration"
  return true;
}
```

Notes (binding decisions, documented in JSDoc):
- `text.trim()` gate for emptiness, but commit the RAW `text` (whitespace the user typed is theirs; only a blank-only buffer is "empty").
- Do NOT call `confirmRippleEdit` here — P1.M2.T2.S2 adds the answered/submitted ripple routing as its own diff.
- Blur AFTER the advance so `advanceAfterAccept`'s cursor reset (currentId setter) wins on the repainted short view; `blurTextField`'s invalidate is harmless after it.
- `commitTextDraft` (public, panel.ts :852) already handles the empty-path tail: draft slot write, DraftStore seam, blur, EXPLAIN-003 ★ re-seed when closing on the Other index. Do not reimplement it.

### 5. Editor region label — `src/panel/panel.ts` `buildLines`

Where the short (and deep) view pushes `...this.textField.render(width)` (~:1230, :1281), push a duty label line FIRST when `focus === "text"`:

```ts
if (this.focus === "text") lines.push(renderDutyLabel(this.textDuty, this.theme, width));
```

Add to `src/panel/layout.ts` (follow `renderNoteHeader`'s pattern — theme-dimmed one-liner):

```ts
/** [Mode A] Editor-region duty label (WRITEIN-001, h2.32): the ACTIVE duty
 *  decides what the buffer MEANS. Write-in: the text IS the answer. (The
 *  elaboration label lands in P1.M2.T3.S1.) Verbatim spec string. */
export function renderDutyLabel(duty: "writein" | "elaboration", theme: Theme, width: number): string {
  const label = duty === "writein" ? "OTHER — this text is the answer" : "EXPLAIN — attaches to your selection";
  // theme.fg("dim", label), truncated to width — mirror renderNoteHeader's exact styling
}
```

The elaboration string is rendered here for completeness (one-line switch — cheaper than a second item touching layout.ts), but no code path sets elaboration-label DISPLAY yet beyond the default duty: `ctrl+t` still calls plain `focusTextField()`; P1.M2.T3.S1 owns duty-follows-cursor and the ctrl+t label semantics. If you prefer minimal diff, render only the write-in branch and leave the elaboration case as the same string with a TODO-for-M2.T3.S1 comment — EITHER is acceptable; keep `renderDutyLabel` total.

Label is `OTHER — this text is the answer` VERBATIM (em-dash U+2014 with spaces, no trailing punctuation).

### 6. Explicitly OUT of scope (guard rails)

- Ripple-confirm routing for write-in commits (P1.M2.T2.S2).
- Elaboration duty label semantics + ctrl+t duty-follows-cursor-on-Other / type:text (P1.M2.T3.S1).
- Two-stage machinery deletion (P1.M2.T4.S1) — do not touch `advanceArmed`/`stageText`/`stage-2`; elaboration enter still saves-and-blurs via `saveTextDraft` exactly as today.
- Draft role binding at submit / WRITEIN-002 re-bind (P1.M2.T5.S1).
- Deep-view Other section selectability (P1.M2.T6.S1 — it will call the same `textDuty = "writein"; focusTextField()` pair; keep that pair cheap to invoke).
- maybeAutoSubmit (P2.M1.T1.S1 — hooks after `writeInEnter`'s commit later).

### Success Criteria

- [ ] accept at cursor index `options.length` → `focus === "text"`, `textDuty === "writein"`, label line `OTHER — this text is the answer` renders above the editor, buffer seeded from the question's draft (revisit restores)
- [ ] type + `enter` → `q.answer = { value: <text>, custom: true, at: <ISO> }`, status `answered`, NO option applied; dependsOn re-derived (a dependent moots instantly when the write-in value trips `notEquals`); panel advanced to next unanswered (or stays when none)
- [ ] Empty buffer + `enter` → no answer, draft slot + DraftStore seam written, focus back to options, cursor re-seeded to ★ (EXPLAIN-003 tail)
- [ ] Multi-line: `shift+enter`/`ctrl+j` still insert newlines inside write-in duty; committed value contains the newlines
- [ ] `blurTextField` resets `textDuty` to `"elaboration"` (verified via public field after blur)
- [ ] Elaboration path untouched: ctrl+t → type → enter still saves draft + blurs, never answers (two-stage.test.ts green as-is)
- [ ] `writeInEnter` exported from actions.ts; no new state on InterrogationState; no config keys
- [ ] `npm test` + `npm run typecheck` green

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets: exact current code of every seam touched (accept, handleInput stage (c), focusTextField/blurTextField, commitTextDraft, buildLines, acceptOptionIndex's sequence to mirror), the verbatim label, the full commit function to write, binding decisions (trim-gate/raw-commit, blur-after-advance, no ripple yet), the consumer chain, and the scope fence. No guessing.

### Documentation & References

```yaml
- file: src/panel/actions.ts
  why: accept (:205-223, the Other-index branch to rewire), acceptOptionIndex (:232-249 — the Q14 sequence to mirror: proposed → ripple seam → applyAnswer → evaluateDependsOn → advanceAfterAccept), advanceAfterAccept (:256, module-private — same module OK), digit exclusion (untouched)
  pattern: writeInEnter sits BESIDE acceptOptionIndex; reuse advanceAfterAccept, currentQuestion
  gotcha: do NOT call confirmRippleEdit in writeInEnter — that is P1.M2.T2.S2's diff

- file: src/panel/panel.ts
  why: textDuty placement near bufferOwner (:394); focusTextField (:1031 — UNCHANGED, shared seeding), blurTextField (:1046 — add duty reset), handleInput stage (c) (:753-760 — the enter branch to fork), commitTextDraft (:852, public — the empty-buffer tail), buildLines editor pushes (:1230, :1281 — label line insertion)
  gotcha: the enter byte-guard `data !== "\n"` above the branch is load-bearing (newline inserts); don't reorder stage (a)/(b)/(c)

- file: src/panel/layout.ts
  why: renderNoteHeader pattern (theme-dimmed one-line header above the editor) to copy for renderDutyLabel
  gotcha: label string VERBATIM with em-dash U+2014; labels never hardcoded keys — this is a fixed spec string (h2.32), not a hotkey label

- file: src/panel/text-field.ts
  why: TextField.getText() (buffer read — stock + composed both implement), seed() idempotency
  gotcha: onSubmit is deliberately NOT set on the editor — enter is intercepted at PANEL level; keep it that way

- file: src/state.ts
  why: QuestionAnswer.custom?: boolean (:48) + applyAnswer commit path — already lands custom through serialize (:551 strict-true revival); no state.ts change needed
- file: src/panel/actions.test.ts
  why: makePanel harness (:96-113 — stubTheme :45, { requestRender: vi.fn() } TUI stub, real InterrogationPanel + real state); BASIC seed fixture; digit-exclusion test (:360) as the no-mock style to follow

- file: plan/002_949db554a811/P1M2T1S1/PRP.md
  why: CONTRACT — the Other row label ✎ Other — write your own already landed at cursor index options.length; accept routing was deliberately left unchanged there for THIS item
- file: plan/002_949db554a811/prd_snapshot.md (h2.32, h2.42, h2.10 AC-2a, h2.36 enter row, h2.58 WRITEIN-001)
  why: verbatim duty contract, answer shape, acceptance scenario
```

### Current Codebase tree (relevant slice)

```bash
src/panel/ panel.ts actions.ts layout.ts text-field.ts short-view.ts (+ actions.test.ts panel.test.ts two-stage.test.ts)
```

### Desired Codebase tree

```bash
# no new files — modifications only
src/panel/panel.ts     # textDuty field, blur reset, enter fork, buildLines label
src/panel/actions.ts   # accept rewiring + writeInEnter (+ Mode A JSDoc)
src/panel/layout.ts    # renderDutyLabel
src/panel/actions.test.ts src/panel/panel.test.ts  # new write-in tests
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// ESM ".js" import suffixes; actions.ts imports from "./panel.js" type-only (InterrogationPanel) — writeInEnter lives in actions.ts to sit beside acceptOptionIndex.
// The two-stage machinery (advanceArmed, stage-2) still exists and two-stage.test.ts must stay green — writeInEnter must not read or write advanceArmed.
// commitTextDraft's EXPLAIN-003 branch re-seeds the cursor to ★ when closing on the Other index — reuse it for the empty path rather than hand-rolling a blur.
// blurTextField clears lastEscAt (esc-esc window anchor) — blur via it, never by assigning focus directly.
// Em-dash U+2014 in the label and in "✎ Other — write your own" — byte-exact test strings.
// advanceAfterAccept only moves currentId when a next unanswered EXISTS; the currentId setter is what resets cursorIndex to ★ — blur AFTER advance so the reset isn't clobbered.
// bufferOwner (EXPLAIN-002) is orthogonal to textDuty — do not conflate scope-tracking with duty.
```

## Implementation Blueprint

### Data models and structure

Only `textDuty: "writein" | "elaboration"` on InterrogationPanel (public field, default "elaboration", reset on blur). Answer payload shape is `{ value, custom: true, at }` — `custom` already exists on `AnswerInput`/`QuestionAnswer` (P1.M1.T1.S1).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD renderDutyLabel to src/panel/layout.ts (follow renderNoteHeader styling; verbatim strings)

Task 2: MODIFY src/panel/panel.ts
  - ADD textDuty field + Mode A JSDoc (What §1)
  - blurTextField: reset textDuty = "elaboration"
  - handleInput stage (c): fork writein → writeInEnter (import from ./actions.js)
  - buildLines: push renderDutyLabel before textField.render in BOTH short and deep editor pushes when focus === "text"

Task 3: MODIFY src/panel/actions.ts
  - accept(): Other-index branch sets panel.textDuty = "writein" before focusTextField()
  - ADD exported writeInEnter(panel) per What §4 (empty → commitTextDraft arm:false; else applyAnswer custom → evaluateDependsOn → advanceAfterAccept → blurTextField)

Task 4: TESTS — src/panel/actions.test.ts (reuse makePanel/BASIC)
  - accept_other_row_enters_writein_duty_and_labels_region (assert focus/textDuty; label via panel render or renderDutyLabel unit)
  - writein_enter_commits_custom_answer_and_advances (value/custom/at; status answered; currentId advanced; no option applied)
  - writein_enter_empty_buffer_saves_draft_no_commit (draftSlots/DraftStore seam called, answer undefined, focus options)
  - writein_commit_reruns_dependsOn (dependent moots when write-in value trips condition)
  - writein_value_keeps_newlines (shift+enter path → committed value contains \n)
  - blur_resets_duty_to_elaboration
- src/panel/panel.test.ts
  - label line renders above editor in short view while write-in focused; absent while elaboration default (or per chosen renderDutyLabel scope)

Task 5: GATES
  - npx vitest run src/panel/  (incl. two-stage.test.ts green — elaboration unchanged)
  - npm test && npm run typecheck
```

### Implementation Patterns & Key Details

See What §2–§5 for the exact code. The load-bearing ordering inside writeInEnter: applyAnswer → evaluateDependsOn → advanceAfterAccept → blurTextField (advance's cursor reset must land before blur's invalidate; ripple seam deliberately absent until P1.M2.T2.S2).

### Integration Points

```yaml
DOWNSTREAM SEAMS (do NOT implement, keep cheap to add):
  - P1.M2.T2.S2: wrap the applyAnswer in writeInEnter with the confirmRippleEdit answered/submitted gate (mirroring acceptOptionIndex)
  - P1.M2.T3.S1: ctrl+t sets textDuty by cursor position ("duty follows the user"); EXPLAIN label activation
  - P1.M2.T6.S1: deep-view Other select calls the same textDuty="writein" + focusTextField pair
  - P2.M1.T1.S1: maybeAutoSubmit(panel, deps) call after writeInEnter's commit tail
CONFIG: none (duty is interaction state, not configuration)
STATE: none (custom already on QuestionAnswer)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npx vitest run src/panel/actions.test.ts
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/    # two-stage.test.ts + keys.test.ts must stay green (no router changes)
npm test
```

### Level 3: Integration Testing

Manual TUI pass (optional here; AC-2a scripted in P4 sweep): open panel via debug upsert, navigate to Other row, accept, verify label line, type + enter, confirm advance and `✎ {text}` in the overview/footer via P1.M1.T2 display plumbing.

### Level 4: Domain Validation

Review JSDoc against contract point 5: three duties named, commit-at-enter stated, `{ value, custom: true }` shape documented, Q14 parity cited.

## Final Validation Checklist

- [ ] `npm test` + `npm run typecheck` green; two-stage suite untouched and green
- [ ] All Success Criteria boxes checked (esp. custom answer shape, empty-buffer no-commit, duty reset on blur)
- [ ] Label byte-exact `OTHER — this text is the answer`; renders only while write-in focus active
- [ ] No new config keys, no InterrogationState changes, no advanceArmed usage added
- [ ] Mode A JSDoc present on textDuty + writeInEnter (three duties, custom shape)
- [ ] Scope fence respected (no ripple routing, no ctrl+t duty-follow, no two-stage deletion)

---

## Anti-Patterns to Avoid

- ❌ Don't implement the ripple gate "while you're here" — P1.M2.T2.S2 is a planned item; premature coupling bloats its diff
- ❌ Don't touch advanceArmed/stageText — elaboration semantics belong to the still-standing two-stage world until P1.M2.T4.S1 removes it
- ❌ Don't set `focus` directly instead of via blurTextField/focusTextField (esc-esc anchor, buffer-owner bookkeeping live there)
- ❌ Don't trim/normalize the committed text — commit the raw buffer; trim only gates the empty check
- ❌ Don't conflate bufferOwner (EXPLAIN-002 scope) with textDuty (WRITEIN-001 meaning)
- ❌ Don't make the duty label configurable — h2.32 pins the string ("visibly labeled", fixed)
- ❌ Don't seed the write-in editor differently from elaboration — h2.32: both seed from the question's draft through the same path

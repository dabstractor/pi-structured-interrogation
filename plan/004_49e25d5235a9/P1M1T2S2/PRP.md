# PRP — P1.M1.T2.S2: Remove re-press-to-close gestures for the elaborate and note prompts

## Goal

**Feature Goal**: Implement BAREKEYS-001's gesture-removal half (h2.74 / ui-spec h2.31 Exit-gestures, h2.33, h2.35): the "re-press the entry key to close" toggles for the elaborate prompt and the note prompt are REMOVED — closes are `enter` (per-duty editor save) and double-`esc` (escExitEditor, escExitWindowMs window) only. With S1's two-tier intercept (parallel, Implementing) bare `t`/`m` are unreachable by the router while the editor holds focus (they type), so the exit arms are dead code from the default keymap — flatten them and keep defensive idempotence guards for chord remaps.

**Deliverable**: Modified `src/panel/panel.ts` (onElaborate override → entry-only + comment purge) and `src/panel/keys.ts` (onBatchNote → open-only + `:418` comment purge), plus reworked tests in `src/panel/panel.test.ts` and `src/panel/two-stage.test.ts`.

**Success Definition**:
- `npm run typecheck` + full `npm test` green
- Pressing `t` while the editor (text focus) holds focus TYPES (`route === false`, buffer grows by `t`), does NOT exit; same for `m` in note focus — no toggle reachability anywhere
- Elaborate prompt closes via `enter` (save + blur, no commit) and via double-`esc` (write-through + blur); note prompt closes via `enter` (save + exit) and double-`esc` — drafts preserved in all cases (R4)
- Write-in duty's exit-without-commit survives ONLY as double-`esc` (enter commits there) — write-through, never a commit
- The gesture-pinning tests reworked: panel.test.ts :1964 (note re-press) and :2769 (ctrl+t repress), two-stage.test.ts :413; :385 (esc-pair note exit) stays green untouched

## Why

h2.74/BAREKEYS-001 consequence (b): "the 're-press to close' toggle gestures for elaborate/note are gone (a re-press while focused types the letter) — closes stay `enter` and double-`esc`". ui-spec h2.31: "The third gesture — key re-press — died with the bare-key defaults: a `t`/`m` while the editor holds focus must type, never act"; h2.33: "no re-press close — a bare `m` while the editor holds focus must type". Leaving the toggle arms in place is a latent footgun: a user who REMAPS `batchNote` to a chord (chords intercept even in editor focus per the two-tier rule) would hit the toggle and mid-typing exit the note/elaborate editor with the very key they pressed to open it — the exact accidental-loss class R4 exists to prevent. Dead code plus a reachable-by-remap hazard is worse than removal.

## What

1. **panel.ts onElaborate override (~:645-648)** — becomes entry-only:
   ```ts
   routed.onElaborate = (p) => {
     // BAREKEYS-001: entry-only. Bare 't' forwards while the editor holds
     // focus (two-tier rule), so the router only reaches here from non-editor
     // focus; the guard keeps a chord-remapped elaborate idempotent.
     if (p.focus !== "text") p.focusTextField(desiredTextDuty(p));
   };
   ```
   PURGE the preceding comment block's toggle sentence ("The re-press exit is duty-agnostic: save + blur, never a commit, from either duty").
2. **keys.ts onBatchNote (:322-328)** — flattens to open-only with the same defensive guard:
   ```ts
   onBatchNote: (p) => {
     // R3/h2.33: OPEN-only (BAREKEYS-001 killed the re-press toggle — a bare
     // 'm' types while the editor holds focus). Valid from any non-editor
     // focus and any view (FR-13). The guard keeps a chord-remapped
     // batchNote idempotent instead of mid-typing-swapping the editor.
     if (p.focus !== "note") p.enterNoteMode();
   },
   ```
3. **Comment purges (Mode A)**: keys.ts `:418` area — the escWindow doc line "(escWindow === 0 disables the pair (every esc forwards; close via the ctrl+t toggle or enter)" → rewrite to "close via `enter` or the double-`esc` pair"; sweep the ESC-002/escapeDescend/escExitEditor doc block (~:230-242) and the module JSDoc for any remaining "toggle"/"re-press"/"ctrl+t" close-gesture phrasing. LEAVE the `desiredTextDuty` digit mention (~:276) — P1.M3.T1.S1's scope. Do NOT touch keys.ts :319-321 onElaborate default (already entry-only; refresh its comment only if it mentions toggling).
4. **Tests reworked** (see Tasks for exact matrix): re-press tests → typing assertions; close semantics pinned to enter + double-esc for both prompts and both duties.

### Success Criteria

- [ ] `t` (text focus) and `m` (note focus): `panel.handleInput('t')` → router returns false, editor buffer grows by `t`, focus unchanged (still text/note) — the toggle is unreachable
- [ ] Chord remap safety: `batchNote: 'ctrl+shift+m'` remap, note focus, press chord → idempotent no-op (focus stays note, buffer intact) — NOT an exit; likewise elaborate remap in text focus
- [ ] Elaborate close via `enter`: save + blur to options, draft in slot + DraftStore, no commit, no advance; close via double-`esc` within escExitWindowMs: same write-through
- [ ] Note close via `enter`: save (`batchNote` + `setNote`) + exit to options; double-`esc` same — `two-stage.test.ts :385` pins this (keep green)
- [ ] Write-in duty double-`esc`: write-through (`draftTextFor` populated), no `applyAnswer` (never a commit), blur
- [ ] Old gesture tests gone/reworked: panel.test :1964, :2769; two-stage.test :413 — no test anywhere asserts re-press exits
- [ ] `grep -n "re-press\|repress\|ctrl+t toggle" src/panel/*.ts` → only historical/BAREKEYS-explanatory comments, no behavior

## All Needed Context

### Context Completeness Check

Repo green; S1 (defaults flip + two-tier intercept) is the in-flight contract this builds on. All touchpoints verified line-exact this session (see research/notes.md). Agent needs this PRP plus `src/panel/panel.ts`, `src/panel/keys.ts`, `src/panel/panel.test.ts`, `src/panel/two-stage.test.ts`.

### Documentation & References

```yaml
- file: plan/004_49e25d5235a9/architecture/keys-and-actions.md
  why: "THE research doc — §6 documents the toggle sites (panel.ts override :645-648, keys.ts onBatchNote :322-328), the :418 purge site, and that the surviving closes (enter, escExitEditor :236-242) are gesture-removal-safe"

- file: plan/004_49e25d5235a9/P1M1T2S2/research/notes.md
  why: verbatim current code of all four touchpoints + reworked-test matrix + chord-remap hazard analysis

- file: plan/004_49e25d5235a9/P1M1T2S1/PRP.md
  why: "CONTRACT (parallel, Implementing): defaults are bare d/o/t/m/e and step 7 is two-tier — bare bindings FORWARD (return false) in text/note focus. The exit arms are dead from the DEFAULT keymap but reachable via chord remaps — hence flatten + guard, not delete-the-guard"
  gotcha: "S1 also flips test fixtures (DEFAULT_DATA etc.) — its flips and yours must compose; if panel.test's CTRL_T/BATCH_NOTE constants were chord bytes, S1's default flip may already break them — your rework lands on top"

- file: src/panel/panel.ts
  why: "the onElaborate OVERRIDE ~:645-648 inside the routed-actions refinement block — entry-only + purge the toggle comment sentence"
  gotcha: "keep the discuss refinement block directly below untouched (pi closure injection)"

- file: src/panel/keys.ts
  why: "onBatchNote :322-328 flatten; :418 comment rewrite; ESC-002 doc sweep ~:230-242; :319-321 onElaborate default already entry-only (comment refresh at most)"
  gotcha: "escExitEditor and the esc-pair logic are UNTOUCHED — they are the surviving close, not a casualty"

- file: src/panel/panel.test.ts
  why: "rework :1964 (note re-press + reseed → new-exit matrix) and :2769 (write-in duty re-press → typing + double-esc exit)"
  gotcha: ":2769's write-in-duty close-without-commit exists ONLY via double-esc now — enter COMMITS in write-in duty (writeInEnter); don't 'fix' that, test it"

- file: src/panel/two-stage.test.ts
  why: ":385 esc-pair note exit is the KEEP-GREEN pin of the new semantics; :413 re-press test reworked to a typing assertion"
  gotcha: ":413 drives the OLD kitty chord byte — under post-S1 defaults the test is doubly wrong (chord + toggle); rewrite against the default 'm' or enterNoteMode + 'm'-types"

- docfile: PRD h2.74 (BAREKEYS-001 consequence b), h2.31 Exit-gestures ("The third gesture — key re-press — died with the bare-key defaults"), h2.33, h2.35 table rows (elaborate/batchNote "no re-press close") — in this PRP's task prompt. spec/*.md READ-ONLY
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
├── panel.ts           # MODIFY: onElaborate override → entry-only + comment purge
├── keys.ts            # MODIFY: onBatchNote → open-only + :418/doc sweep
├── panel.test.ts      # MODIFY: rework :1964 and :2769
└── two-stage.test.ts  # MODIFY: rework :413 (:385 stays green)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: do NOT rely on unreachability alone — a chord REMAP makes a bare
//   binding tier-1 (intercepts even in editor focus) and would resurrect the
//   toggle mid-typing. Flatten AND guard (`if (p.focus !== "text"/"note"`).
// CRITICAL: enter in WRITE-IN duty commits (writeInEnter) — the only
//   close-without-commit there is double-esc; the old :2769 test's
//   "never commits" assertion must move to the double-esc path.
// GOTCHA: S1 lands the default flip in parallel — your tests must run green
//   against POST-S1 defaults (bare 't'/'m'), not the old chords. If S1 has
//   not landed when you start, write tests against the post-S1 contract
//   (they'll be red on both counts until S1 merges — coordinate via plan status).
// GOTCHA: double-esc tests must respect escExitWindowMs (default 500ms real
//   Date.now) — existing esc-pair tests show the pattern (two handleInput
//   calls back-to-back inside the window).
// GOTCHA: typing assertions: route === false from the router AND the composed
//   editor's buffer grows (setText seam or getText) — asserting only one is
//   half the contract.
// GOTCHA: leave desiredTextDuty's digit mention (~:276) and the digit branch
//   alone — P1.M3's scope.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: PRECONDITION — verify S1's shape
  - rg -n "editorFocused|isBare|bare" src/panel/keys.ts → two-tier gating present;
    rg -n "elaborate: \"t\"|batchNote: \"m\"" src/config.ts → defaults flipped.
  - If not landed: write tests against the post-S1 contract anyway (red on both),
    land after S1 merges; do not implement S1's half here.

Task 1: REWORK TESTS FIRST (TDD)
  - panel.test.ts :1964 test_repress_exits_preserving_draft_and_reentry_reseeds_from_store
    → split into:
      * test_note_close_via_enter_saves_and_exits (enter → batchNote + setNote called,
        focus options; re-entry reseeds from store — keep the reseed half)
      * test_note_close_via_double_esc_preserving_draft (two escs in window → same)
      * test_m_in_note_focus_types_and_does_not_exit (handleInput('m') → editor buffer
        grows, focus stays 'note', batchNote/setNote untouched)
  - panel.test.ts :2769 ctrl_t_repress_exits_writein_duty_... → split into:
      * test_t_in_text_focus_types_and_does_not_exit (buffer grows by 't',
        focus stays text, textDuty unchanged)
      * test_writein_duty_double_esc_exits_with_write_through_never_commits
        (two escs → draftTextFor populated, answer undefined, focus options,
         textDuty elaboration)
      * elaborate-duty enter exit is already covered elsewhere — verify, add only
        if missing
  - two-stage.test.ts :413 test_ctrl_shift_m_repress_exits_note_mode_preserving_draft
    → test_ctrl_shift_m_chord_remap_in_note_focus_is_idempotent (remap keys.batchNote
      to the chord, press in note focus → no exit, buffer intact) OR, if simpler,
      the plain 'm'-types variant; :385 stays untouched (keep-green)
  - RUN: npx vitest run src/panel/panel.test.ts src/panel/two-stage.test.ts -v —
    new typing/idempotence tests fail until the arms flatten (post-S1)

Task 2: FLATTEN panel.ts onElaborate override (~:645-648)
  - entry-only + defensive guard + purge the toggle comment sentence (What §1)

Task 3: FLATTEN keys.ts onBatchNote (:322-328)
  - open-only + defensive guard + rewrite the R3 comment (What §2)

Task 4: COMMENT PURGE (Mode A)
  - keys.ts :418 area: "close via the ctrl+t toggle or enter" → "close via `enter`
    or the double-`esc` pair"; sweep ESC-002 doc block (~:230-242) + module JSDoc
    for residual toggle/re-press phrasing; final grep (Success Criteria)

Task 5: RUN gates
  - npx vitest run src/panel/panel.test.ts src/panel/two-stage.test.ts src/panel/keys.test.ts -v
  - npm run typecheck && npm test
```

### Implementation Patterns & Key Details

```ts
// panel.ts — entry-only override:
routed.onElaborate = (p) => {
  // BAREKEYS-001: entry-only — bare 't' types while the editor holds focus
  // (two-tier rule); the guard keeps a chord-remapped binding idempotent.
  if (p.focus !== "text") p.focusTextField(desiredTextDuty(p));
};

// keys.ts — open-only note:
onBatchNote: (p) => {
  if (p.focus !== "note") p.enterNoteMode(); // h2.33: open-only; close via enter / double-esc
},

// Typing test shape (post-S1):
const before = panel.textField.getText();
expect(panel.handleInput("t")).toBe(false);       // router forwarded — it must TYPE
expect(panel.textField.getText()).toBe(before + "t");
expect(panel.focus).toBe("text");                 // no exit

// PATTERN: double-esc tests press two escs back-to-back (inside the default
// 500ms window) — the existing :385 test is the template.
```

### Integration Points

```yaml
UPSTREAM (contract, parallel): P1.M1.T2.S1 — bare defaults + two-tier intercept;
  the exit arms' unreachability under defaults is S1's doing; this subtask removes them
DOWNSTREAM:
  - P1.M1.T2.S3 (footer drop): footer stops advertising close hints — with the toggles
    gone, any "t to close"/"m to close" hint strings are now wrong; S3 owns the strings
  - P1.M4.T1.S1 (suite sweep): any residual gesture-pinning rows outside the two files
    named here land there
NO CHANGES to: escExitEditor/esc-pair logic, writeInEnter/enter forks, exitTextField,
exitNoteMode/enterNoteMode internals, desiredTextDuty, digit branch, config.ts
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/panel.test.ts src/panel/two-stage.test.ts src/panel/keys.test.ts -v
npm test
```

### Level 3: Behavioral probe

```bash
npx vitest run src/panel/panel.test.ts src/panel/two-stage.test.ts -t "types\|esc\|enter" -v
# typing assertions, enter closes, double-esc closes — the full new close matrix.
```

### Level 4: Domain validation

- [ ] `grep -n "re-press\|repress\|ctrl+t" src/panel/panel.ts src/panel/keys.ts` — no behavioral remnants; comments describe enter/double-esc only
- [ ] `git diff --name-only` — panel.ts, keys.ts, panel.test.ts, two-stage.test.ts only; spec/ untouched
- [ ] escExitEditor / enter forks byte-untouched (surviving closes)

## Final Validation Checklist

- [ ] `npm run typecheck` → 0 errors; `npm test` → all green (post-S1 defaults)
- [ ] `t`/`m` in editor focus type and never act; chord remaps are idempotent, never mid-typing exits
- [ ] Elaborate + note prompts close via enter and double-esc with R4 write-through; write-in duty's commit-free exit is double-esc only
- [ ] :1964/:2769/:413 reworked; :385 green untouched; no test asserts re-press exits
- [ ] Comments describe the gesture-free close semantics (Mode A); desiredTextDuty digit mention + digit branch untouched

## Anti-Patterns to Avoid

- ❌ Don't delete the guards along with the arms — chord remaps resurrect the hazard
- ❌ Don't touch escExitEditor, the enter forks, or the editor internals — they're the surviving closes
- ❌ Don't write tests against the old chord constants — post-S1 defaults are the contract
- ❌ Don't "fix" enter-in-write-in-duty committing — that's WRITEIN-001; the commit-free exit is double-esc
- ❌ Don't purge the desiredTextDuty digit mention or digit branch — P1.M3's scope
- ❌ Don't edit spec/*.md — READ-ONLY; README sweep is P1.M4.T2

---

**Confidence Score**: 9/10 — all four touchpoints read verbatim this session, the surviving exits verified independent of the toggles, the rework matrix enumerated per test, and the only external dependency (S1's default flip) is an explicit contract with a Task 0 check. Mild uncertainty: whether S1's fixture flips already collide with panel.test's CTRL_T/BATCH_NOTE constants — the rework absorbs either ordering.

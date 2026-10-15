# PRP — P1.M4.T1.S1: Flip residual scripted suites to the new keymap contract

## Goal

**Feature Goal**: Complete the keymap trilogy (VIMNAV-001 / BAREKEYS-001 / DIGIT-OUT-001, PRD h2.74/h2.35) at the TEST layer. All product behavior is already landed by P1.M1–P1.M3; the remaining stale test expectations must be mechanically flipped to the new contract: panel-action sends become bare letters (`d` deep, `o` overview, `t` elaborate, `m` batch note, `e` discuss), digit presses become inert, chord-in-editor-focus interception tests INVERT (bare letters forward/type), ctrl+s (`\u0013`) and ctrl+g (`\u0007`) bytes stay, toggle-exit-by-re-press scenarios switch to `enter`/double-`esc` or direct focus manipulation, and labels/naming that say "ctrl+t"/"focusText" become `t`/"elaborate".

**Deliverable**: Test-only edits to `src/panel/panel.test.ts` (~50 sites minus 2 already reworked), `src/panel/two-stage.test.ts` (~13 sites), `src/panel/ac-panel.test.ts` (8 sites), `src/panel/deep-view.test.ts` (4 sites), `src/panel/discuss.test.ts` (3 sends + 1 inverted intercept test), `src/panel/ripple-confirm.test.ts` (1 comment), `src/panel/layout.test.ts` (3 fixture lines + 1 comment), plus a grep-driven sweep of residuals in `keys.test.ts` / `actions.test.ts` / `config-surface.test.ts` / `keymap-guard.test.ts` / `no-hardcoded-keys.test.ts` NOT owned by earlier subtasks. NO production-code changes.

**Success Definition**: Full `npm test` green AND `npm run typecheck` green; no test file sends `\u0004`/`\u000c`/`\u0014`/`\u001b[109;6u`/`\u001b[101;6u` as a panel-action accelerator (grep gate); describe/test names no longer name chords; the suite is the precondition for P1.M4.T1.S2 (gates + AC) and P1.M4.T2.S1 (docs).

## User Persona (if applicable)

Developer-facing only (this is a test-stabilization task); the end-user persona is unchanged — the pi user navigating the interrogation panel with bare-key defaults and hjkl.

## Why

- The trilogy's implementing subtasks (P1.M1.T1.S1/S2, T2.S1/S2/S3, P1.M2.T1.S1, P1.M3.T1.S1/S2/S3) are Complete/Implementing and each flipped only the tests it directly owned; every other suite still sends old chord bytes and asserts the OLD intercept rule, so `npm test` is red across ~17 suites.
- Without a green suite, P1.M4.T1.S2 (scripted AC coverage + conflict re-verification + full gates) and every later item are blocked.

## What

### Flip contract (memorize before editing)

1. **Byte → letter map** (panel-action sends only):

| Const (old) | Old byte | New send |
|---|---|---|
| `CTRL_D` (deep) | `\u0004` | `"d"` |
| `CTRL_L` (overview) | `\u000c` | `"o"` |
| `CTRL_T` (elaborate) | `\u0014` | `"t"` |
| `BATCH_NOTE` | `\u001b[109;6u` | `"m"` |
| `DISCUSS` | `\u001b[101;6u` | `"e"` |
| submit / externalEditor | `\u0013` / `\u0007` | **UNCHANGED** (modifier-bearing by design — BAREKEYS-001) |

2. **Two-tier intercept (h2.35)**: bare config letters intercept ONLY from non-editor focus; while `focus === "text" | "note"` they must FORWARD (route/handleInput returns `false`, the letter types into the editor buffer). Chords (ctrl+s, ctrl+g) intercept in EVERY focus including editor. Tests asserting the old "intercept even in text focus" rule for bare keys INVERT.
3. **Digits**: `"1"`–`"9"` are inert at panel level from every view and focus (`handleInput("2") === false`, no state change); in editor focus they type.
4. **View gating**: `t` (elaborate) is short-view gated (BUG-011) — in deep/overview `t` falls through; `d`/`o`/`m`/`e` fire from deep/overview too.
5. **Toggle exits**: re-press-to-close is REMOVED (a `t`/`m` while the editor holds focus types). Rework such scenarios to exit via `enter` (duty-appropriate: commit/blur) or double-`esc`, or enter the mode directly via `panel.focusTextField("writein" | "elaboration")` / `panel.enterNoteMode()` (precedent: two-stage.test.ts:385).
6. **Renames**: `focusText` → `elaborate` in helper names, comments, and test labels; describe `"ctrl+t duty — EXPLAIN vs OTHER"` → name `t`/elaborate; test names citing chords get rewritten to the letter + action.
7. **Simulation styles stay as-is**: Style A router-level `route(data, stub)` and Style B full-panel `handleInput(data)` / `firstCall(mock).component.handleInput(data)` — both raw-string; only the strings and expectations change.

### File-by-file work list

(all line numbers from `plan/004_49e25d5235a9/architecture/readme-and-test-flows.md` §3 — RE-VERIFY each with grep before editing; earlier subtasks' edits may have shifted lines)

1. **src/panel/panel.test.ts** (~48 sites):
   - Consts :61-62 `CTRL_D`/`CTRL_L` → `"d"`/`"o"` (rename consts DEEP/OVERVIEW or inline), :1922 `BATCH_NOTE` → `"m"`, :2557 `CTRL_T` → `"t"` (rename ELABORATE).
   - **INLINE sends a sed would miss**: :1531, :1570, :2852 send `\u0014` literally → `"t"`.
   - Overview/deep suites :397-429, :458-466 (rendered-component harness), :498-708 (~12 `CTRL_L` one-liners), deep seeding :2224-2303.
   - Batch-note suite :1922-2317 (~10 `BATCH_NOTE` sends; any test entering note mode FROM text focus via the key must switch to `enterNoteMode()` directly — bare `m` can't fire from editor focus).
   - Elaborate-duty describe :2556 with tests at 2597, 2612, 2631, 2656, 2676, 2715, 2769**, 2813, 2846, 2868, 2898, 2852-inline.
   - **EXCLUDE** :1964 and :2769's re-press rework — P1.M1.T2.S2 already owns/reworked those tests; do not redo, just keep them green.
2. **src/panel/two-stage.test.ts** (~13 sites): helper `focusText(panel)` :181 → rename `elaborate(panel)` (comments updated); the real-seam send :441 `handleInput("\u0014")` → `handleInput("t")`; call sites 193, 218, 244, 285, 302, 320, 338, 435, 449, 467, 486 inherit via the helper. :413 was reworked by M1.T2.S2 — keep green. :385 (esc-pair note exit) stays green untouched.
3. **src/panel/ac-panel.test.ts** (8 sites): :379 & :426 (AC-12 remap footer — defaults fixtures become letters; remapped values like `"f9"` unchanged), :453 (AC-6 → `"o"`), :493 (`"o"`), :620 (AC-5 deep `"d"`), :722/:725/:769 (AC-4 `"t"` focus; the :725 toggle-exit re-press swaps gesture per contract rule 5).
4. **src/panel/deep-view.test.ts** (4): :818, :843, :898 `handleInput("\u0004")` → `"d"`; :863 comment.
5. **src/panel/discuss.test.ts**: const :35 → `"e"`; sends :327, :362, :567; **INVERT** the :552-567 "deliberately UNGATED ctrl+shift+e intercept" test — from editor focus a bare `e` must now forward (route false) and type `"e"` into the buffer; move the mid-edit discuss scenario to options focus or blur first.
6. **src/panel/ripple-confirm.test.ts**: :467 comment only (the :390 digit flip was P1.M3.T1.S2's — verify green).
7. **src/panel/layout.test.ts**: fixture :72-74 defaults (`deep:"ctrl+d"` → `"d"` etc. + `focusText`→`elaborate` field rename — footer labels render from these); :393 comment.
8. **Zero-flip verify-only**: `src/ac-scripted.test.ts` (ctrl+s `\u0013` :739 + fixed keys only), `src/panel/overview.test.ts` (direct focus), `src/panel/text-field.test.ts`, `src/panel/editor-preservation.test.ts`.
9. **Residual sweep (grep-driven, not line-pinned)**: after the above, run the gates and the grep below; fix any straggler in `keys.test.ts` (e.g. collision-order :445 letter-vs-letter coverage if S1/M2 left it thin — add letter-vs-letter and letter-vs-hjkl collision cases), `actions.test.ts` (write-in suite :709-897 is direct-focus — verify only), `config-surface.test.ts`, `keymap-guard.test.ts` (action list `focusText`→`elaborate` at :40; avoided-keys table :55-73 now moot for letters — minimal fix to green only), `no-hardcoded-keys.test.ts` (fixtures :232/:236-237 `deep:"ctrl+d"` stale; CTRL regex now matches nothing in src — repair to green only; guard REDESIGN is NOT this task).

### Success Criteria

- [ ] `npm test` fully green; `npm run typecheck` green.
- [ ] Grep gate: `grep -rn '\\u0004\|\\u000c\|\\u0014\|109;6u\|101;6u' src/*.test.ts src/panel/*.test.ts` → zero hits as panel-action sends (exception: keys.test.ts `DEFAULT_DATA`-adjacent or guard fixtures only if a landed subtask deliberately kept one — verify intent before touching).
- [ ] No test name/comment still says `ctrl+t`, `ctrl+d`, `ctrl+l`, `ctrl+shift+m`, `ctrl+shift+e`, or `focusText` (except deliberate historical/compat-alias tests owned by P1.M1.T1.S2 — the alias test itself stays).
- [ ] Inverted behaviors asserted: bare letters forward in editor focus; ctrl+s/ctrl+g still intercept there; digits inert everywhere at panel level.
- [ ] Zero production-source files modified (diff gate: only `*.test.ts` files touched).

## All Needed Context

### Context Completeness Check

All line anchors come from the architecture doc's verified inventory plus the prior subtask PRPs' explicit file-ownership claims; every flip rule is quoted from PRD h2.35/h2.31/h2.33/h2.74. The implementer needs this PRP, the architecture doc, and the listed test files.

### Documentation & References

```yaml
- docfile: plan/004_49e25d5235a9/architecture/readme-and-test-flows.md
  why: THE map. §2 defines both simulation styles (router-level route(data, stub) with DEFAULT_DATA/matchesKey round-trips; full-panel handleInput with per-file byte consts). §3 is the per-suite inventory with line numbers for every site this task flips, including the inline \u0014 sends at panel.test.ts:1531/1570/2852 and the per-suite flip-count table. §5 anomalies (editor-focus inversion, rename width, letter-vs-hjkl collisions, digitQuickSelect deletion, inline sends, no-hardcoded-keys guard) all bear on expectations.
  section: "2. Key-press simulation pattern" and "3. Affected-tests inventory"

- file: src/panel/panel.test.ts
  why: biggest residual (~48 sites). Consts :61-62, :1922, :2557; inline \u0014 :1531/:1570/:2852; batch-note suite :1922-2317; elaborate-duty describe :2556-2910. EXCLUDE :1964/:2769 rework (M1.T2.S2 owns).
  gotcha: re-verify line numbers with grep after earlier subtasks' edits; many tests assert consumed===true — bare letters from options focus still consume, so most flips are byte-swaps only.

- file: src/panel/two-stage.test.ts
  why: helper focusText(panel) :181 wrapping the real-seam send :441; 11 call sites. Rename helper to elaborate; send "t". :385 (esc-pair exit) and :413 (reworked) stay green.
  pattern: this file shows the direct-focus alternative (enterNoteMode) tests will imitate for note-mode entry.

- file: src/panel/discuss.test.ts
  why: 3 sends + the INVERTING intercept test :552-567 ("deliberately UNGATED"). New expectation: bare "e" in editor focus forwards and types; discuss fires from options/deep/overview focus.
  gotcha: mid-edit discuss scenario needs blur/options focus first — bare key can't fire while editing.

- file: src/panel/panel.ts (READ ONLY — for APIs only)
  why: focusTextField(duty?: "writein"|"elaboration") :1188 and enterNoteMode() :1262 are the direct-focus entry points replacing key-driven mode entry from editor focus.
  gotcha: DO NOT edit any src/*.ts production file in this task.

- file: plan/004_49e25d5235a9/P1M1T2S1/PRP.md (+ P1M1T2S2, P1M1T2S3, P1M2T1S1, P1M3T1S2, P1M3T1S3 PRPs)
  why: file-ownership contract — which test edits are ALREADY done (keys.test DEFAULT_DATA+inversions, config-surface :348, actions digit suite, ripple :390, panel :1964/:2769, two-stage :413, layout editor-exit). Prevents re-editing/re-breaking landed work.
  critical: keys.ts/keys.test.ts were S1's exclusive territory then; this task may touch keys.test.ts only for residuals S1 did not own (verify against its PRP's edit list before changing).

- file: src/panel/keys.ts (READ ONLY)
  why: landed two-tier intercept + short-view `t` gate define what expectations are now correct; its Mode A doc block is the behavioral spec the tests must mirror.

- url: (PRD, in <selected_prd_content>) h2.35 hotkeys table + h2.31 exit gestures + h2.33 batch note + h2.74 trilogy
  why: authoritative contract: two-tier intercept, BAREKEYS consequences (a)/(b)/(c), DIGIT-OUT, ESC-002 (single esc + arrows forward in editor focus), rename elaborate.
```

### Current Codebase tree (relevant excerpt)

```bash
src/
  panel/panel.test.ts        # MODIFY ~48 sites
  panel/two-stage.test.ts    # MODIFY ~13 sites
  panel/ac-panel.test.ts     # MODIFY 8 sites
  panel/deep-view.test.ts    # MODIFY 4 sites
  panel/discuss.test.ts      # MODIFY 3 sends + invert 1 test
  panel/ripple-confirm.test.ts # MODIFY 1 comment
  panel/layout.test.ts       # MODIFY 3 fixture lines + 1 comment
  panel/keys.test.ts         # residual sweep only
  panel/actions.test.ts      # residual sweep only
  panel/overview.test.ts     # verify only
  panel/text-field.test.ts   # verify only
  panel/editor-preservation.test.ts # verify only
  ac-scripted.test.ts        # verify only (ctrl+s unchanged)
  config.test.ts             # residual sweep only (S3 may have finished)
  config-surface.test.ts     # residual sweep only
  keymap-guard.test.ts       # residual sweep only
  no-hardcoded-keys.test.ts  # minimal repair to green only
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: inline chord bytes bypass const-rename seds — panel.test.ts
// :1531/:1570/:2852 send "\u0014" literally. Grep for the BYTES, not the consts:
//   grep -rn '\\u0004\|\\u000c\|\\u0014\|109;6u\|101;6u' src --include=*.test.ts
// GOTCHA: ctrl+s = "\u0013" and ctrl+g = "\u0007" KEEP their bytes — do not
// "clean them up" with the letters; they are chords by design (BAREKEYS-001).
// GOTCHA: bare letters still CONSUME from non-editor focus (handleInput true)
// — most flips are pure byte swaps; only editor-focus and digit tests change
// expectations, not just bytes.
// GOTCHA: batch-note/note-mode entry FROM text focus via the key is now
// impossible — use enterNoteMode() directly (two-stage.test.ts:385 pattern).
// GOTCHA: `t` is short-view gated — panel.test tests that sent \u0014 while in
// deep view expecting entry now expect fall-through.
// GOTCHA: digit tests aren't deleted here (that was M3T1S2) — residual digit
// EXPECTATIONS become "inert" assertions where they still exist.
// GOTCHA: keys.test.ts and config-surface.test.ts edits must not collide with
// landed subtask content — read their PRP edit lists first; prefer additive
// collision cases (letter-vs-letter, letter-vs-hjkl) over rewriting landed tests.
// GOTCHA: no-hardcoded-keys guard CTRL regex matches nothing after the flip —
// if its tests fail, repair minimally (fixture/expectation), redesign is S2/M4.T2
// territory. Same for keymap-guard's avoided-keys table.
```

## Implementation Blueprint

### Data models and structure

None — test-only task. The "model" is the flip contract table in "What".

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: RECONCILE against landed work
  - RUN: npm test 2>&1 | tail -40 — catalog current failures per suite
  - READ the edit lists in P1M1T2S1/S2/S3, P1M2T1S1, P1M3T1S2/S3 PRPs; mark every already-flipped test as untouchable
  - GREP: grep -rn '\\u0004\|\\u000c\|\\u0014\|109;6u\|101;6u' src --include=*.test.ts — the authoritative residual site list (trust this over stale line numbers)

Task 1: EDIT src/panel/panel.test.ts
  - FLIP consts :61-62/:1922/:2557 to letters with renamed consts (DEEP/OVERVIEW/ELABORATE/BATCH_NOTE)
  - FLIP the inline "\u0014" sends :1531/:1570/:2852 to "t"
  - FLIP all CTRL_D/CTRL_L/BATCH_NOTE/CTRL_T send sites per the contract; assert consumed-ness matches the two-tier rule
  - REWORK note-mode-entry-from-text-focus tests to enterNoteMode(); rename the :2556 describe to the elaborate/`t` wording; update chord-naming test labels
  - PRESERVE :1964/:2769 (M1.T2.S2's rework) — green only
  - RUN: npx vitest run src/panel/panel.test.ts

Task 2: EDIT src/panel/two-stage.test.ts
  - RENAME helper focusText → elaborate (:181), seam send :441 "\u0014" → "t", comments updated; call sites inherit
  - KEEP :385 and :413 green untouched
  - RUN: npx vitest run src/panel/two-stage.test.ts

Task 3: EDIT src/panel/ac-panel.test.ts + deep-view.test.ts + discuss.test.ts + ripple-confirm.test.ts + layout.test.ts
  - ac-panel: :379/:426/:453/:493 → "o"; :620 → "d"; :722/:725/:769 → "t" with the :725 exit-gesture swap (enter or double-esc)
  - deep-view: :818/:843/:898 → "d"; :863 comment
  - discuss: :35 const → "e"; sends :327/:362/:567; INVERT :552-567 — editor-focus "e" forwards (false) and types; discuss-from-options still consumes
  - ripple-confirm: :467 comment rewrite
  - layout: :72-74 fixture defaults to letters + elaborate field rename; :393 comment
  - RUN: npx vitest run src/panel/ac-panel.test.ts src/panel/deep-view.test.ts src/panel/discuss.test.ts src/panel/ripple-confirm.test.ts src/panel/layout.test.ts

Task 4: RESIDUAL SWEEP — keys.test.ts / actions.test.ts / config-surface.test.ts / config.test.ts / keymap-guard.test.ts / no-hardcoded-keys.test.ts
  - GREP again; fix only stragglers NOT in landed subtask edit lists
  - ADDITIVE: letter-vs-letter and letter-vs-hjkl collision cases in keys.test.ts :445 area if absent
  - keymap-guard :40 action-list rename; no-hardcoded-keys minimal repair to green (no redesign)
  - RUN: npx vitest run src/panel/keys.test.ts src/panel/actions.test.ts src/config-surface.test.ts src/config.test.ts src/keymap-guard.test.ts src/no-hardcoded-keys.test.ts

Task 5: FULL GATES
  - RUN: npm run typecheck && npm test — both green
  - Grep gate: no chord bytes as panel-action sends; no chord names in test labels (except the compat-alias test + historical comments owned elsewhere)
```

### Implementation Patterns & Key Details

```ts
// Typical Style B flip (byte swap, expectation unchanged — options focus consumes):
- panel.handleInput(CTRL_L);            // was: "\u000c"
+ panel.handleInput("o");               // BAREKEYS-001 default

// Inverted expectation (editor focus — bare keys type):
- expect(panel.handleInput(BATCH_NOTE)).toBe(true); // old: chord intercepts anywhere
+ panel.focusTextField("elaboration");
+ expect(panel.handleInput("m")).toBe(false);       // forwards; buffer gains "m"

// Toggle-exit rework (re-press is gone):
- panel.handleInput(CTRL_T); /* ... */ panel.handleInput(CTRL_T); // re-press exit
+ panel.handleInput("t"); /* ...type...*/ // exit via enter (commit/blur) or double-esc

// Digit now inert:
- expect(panel.handleInput("2")).toBe(true);   // quick-select
+ expect(panel.handleInput("2")).toBe(false);  // DIGIT-OUT-001; no state change
```

### Integration Points

```yaml
NO PRODUCTION CHANGES: diff gate — only *.test.ts files in the commit
PREDECESSORS (landed behavior): config.ts defaults (d/o/t/m/e, elaborate, no digitQuickSelect), keys.ts two-tier intercept + hjkl + short-view t gate, actions.ts (no digit), panel.ts/keys.ts re-press removal
SUCCESSORS: P1.M4.T1.S2 (scripted ACs + conflict re-verification + gates) requires this green suite; P1.M4.T2.S1 (README rewrite) consumes the final default table
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck    # zero errors (test fixtures using deleted config fields fail here first)
```

### Level 2: Unit Tests — THE deliverable

```bash
# Per-suite as edited (Task 1-4), then:
npm test             # FULL suite green — this is the task's definition of done
```

### Level 3: Integration — SCRIPTED ONLY (AUTOMATION-POLICY)

No live pi session; everything is vitest. `src/ac-scripted.test.ts` (ctrl+s + fixed keys, unchanged) must remain green — proof the flip didn't overreach.

### Level 4: Domain-specific gates

```bash
# No stale chord bytes as panel-action sends:
grep -rn '\\u0004\|\\u000c\|\\u0014\|109;6u\|101;6u' src --include=*.test.ts
# → zero hits (or documented deliberate exceptions only)
# No chord naming left in test labels (excluding the focusText compat-alias test):
grep -rniE 'ctrl\+t|ctrl\+d|ctrl\+l|ctrl\+shift\+m|ctrl\+shift\+e|focusText' src --include=*.test.ts
# Diff gate:
git diff --name-only | grep -v '\.test\.ts$'   # → empty
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm test` green (full suite) and `npm run typecheck` green.
- [ ] Grep gates pass: no chord bytes as action sends; no chord names in labels; no production files touched.

### Feature Validation (contract correctness of the tests)

- [ ] Two-tier intercept asserted both ways: letters forward in editor focus AND still intercept from options/deep/overview focus; ctrl+s/ctrl+g intercept everywhere.
- [ ] Digits inert at panel level in every view/focus (residual expectations flipped).
- [ ] `t` short-view gating asserted (deep/overview fall-through).
- [ ] Toggle-exit scenarios use enter/double-esc/direct focus; no re-press tests remain.
- [ ] hjkl alias tests (M2T1S1's) and elaborate rename tests (M1's) still green — untouched.

### Code Quality Validation

- [ ] Simulation styles unchanged (raw bytes → raw letters; no synthetic events introduced).
- [ ] Test/describe names updated to the new vocabulary (elaborate, `t`, bare letters).
- [ ] No landed subtask edits rewritten or reverted (Task 0 reconciliation documented).

### Documentation & Deployment

- [ ] [Mode A inline] comments updated where they name chords; no product docs (M4.T2.S1 owns README).

## Anti-Patterns to Avoid

- ❌ Don't sed-rename consts without grepping the raw escape bytes (inline `\u0014` at :1531/:1570/:2852).
- ❌ Don't flip ctrl+s/ctrl+g bytes — they stay chords by design.
- ❌ Don't rewrite tests owned by landed subtasks (reconcile in Task 0 first).
- ❌ Don't change any production file "while there" — diff gate fails the task.
- ❌ Don't redesign the no-hardcoded-keys guard — minimal green repair only.
- ❌ Don't turn byte swaps into expectation changes where none is due (options-focus letters still consume).

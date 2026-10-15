# PRP — P1.M4.T2.S1: Rewrite README usage prose, sample settings, keymap tables, and conflict section

## Goal

**Feature Goal**: Make README.md — the changeset's public face — match HEAD behavior after the keymap trilogy (VIMNAV-001 hjkl / BAREKEYS-001 bare-letter defaults + `elaborate` rename / DIGIT-OUT-001 digit removal). Rewrite the stale Usage prose, Configuration sample, Keymap section (tables + intercept prose), stale Acceptance refs, and the entire "Keymap conflict re-verification" section to the landed contract, consuming P1.M4.T1.S2's recorded conflict re-verification output.

**Deliverable**: Modified `README.md` ONLY (usage prose, sample settings.json, remappable/fixed keymap tables, two-tier intercept prose, AC refs, conflict-re-verification section). No source, spec, or script changes.

**Success Definition (the GATE, verbatim)**: `grep -n "ctrl+t\|ctrl+d\|ctrl+l\|focusText\|digit" README.md` returns ZERO lines — the word "digit" must not appear at all (number-key inertness phrased without it). All key references match `src/config.ts` `DEFAULT_CONFIG.keys` and the fixed family. The conflict section carries the fresh re-verification record from P1.M4.T1.S2. Clean sections (Install, Subcommands, Limitations, Development, Project structure, ctrl+s/ctrl+g prose) untouched. No spec/*.md edits.

## User Persona (if applicable)

**Target User**: pi user installing/upgrading pi-interrogator who reads the README to learn the keys and configure settings.json.

**Use Case**: After the trilogy lands, a user opens the README to relearn the panel keys (`d`/`o`/`t`/`m`/`e`, hjkl) and copy a valid settings sample — nothing in the doc may reference removed behavior (digit quick-select, `ctrl+t`, chords that no longer exist, re-press-to-close toggles).

**User Journey**: read Usage → try keys in the panel → copy the Configuration sample → consult the Keymap tables → (maintainer) consult the conflict section before rebinding a default.

**Pain Points Addressed**: The README currently documents a dead keymap: digit quick-select (removed), `ctrl+t`/`ctrl+d`/`ctrl+l`/`ctrl+shift+m`/`ctrl+shift+e` (now `t`/`d`/`o`/`m`/`e`), `keys.focusText` (renamed `elaborate`), toggle-close gestures (removed), and a chord-conflict analysis whose subject matter mostly vanished.

## Why

- This subtask IS the changeset-level documentation sync ([Mode B]) — the trilogy's public face.
- h2.74/h2.35 (2026-10-12 ruling) are the authoritative new contract; h2.35 explicitly demands: "Dev agent must re-verify at build time and record findings in the PR notes" — P1.M4.T1.S2 produces the recorded output; this task transcribes it into the README conflict section.
- h2.53 (testing) lists "keymap conflict re-verification … recorded in README" as a deliverable.

## What

### Section-by-section rewrite contract

**1. Usage item 2 (lines ~33–68)** — the "Answer in the panel" paragraph:
- Rewrite the opening key sentence: move between questions with `←`/`→` (and `h`/`l`) or `tab`/`shift+tab`; move among options with `↑`/`↓` (and `k`/`j`); accept with `enter`; `d` deep-dive view, `o` overview, `t` elaborate (enter the editor — elaboration duty from a selected option, write-in duty on the `✎ Other` row or a text question), `m` batch note, `e` discuss in chat, `ctrl+g` external editor, `ctrl+s` submit.
- DELETE the digit quick-select sentence ("pick an option with digits `1`–`9` …") entirely.
- Line ~47 "`ctrl+t` is not the only entry" → "`t` is not the only entry".
- Answer-pinning prose (lines ~49–60): "`enter` or a digit on the recorded value" → "`enter` on the recorded value"; "(`enter`, a digit, or a byte-identical write-in)" → "(`enter`, or a byte-identical write-in)"; "another row, a different digit, edited write-in text" → "another row, edited write-in text".
- Where the editor's closes are described: elaborate/note close via `enter` or double-`esc` — the re-press-to-close gesture is GONE (a re-press types the letter while focused). Do not describe `t`/`m` as toggles.

**2. Usage item 3 (~69–83)**: `ctrl+s` prose is still valid — leave as-is (verify only).

**3. Configuration sample (~137–155)**: replace the `keys` block with exactly the 9 landed keys, comments adapted:
  ```jsonc
  "keys": {
    "deep": "d",           // open the deep-dive (ramification) view
    "overview": "o",       // open the question overview list
    "elaborate": "t",      // enter the editor (elaboration / write-in duty)
    "batchNote": "m",      // attach a batch note
    "submit": "ctrl+s",    // submit answers (partial ok; gate-hold override)
    "discuss": "e",        // discuss the current question in chat
    "externalEditor": "ctrl+g", // open the draft in an external editor
    "prevQuestion": "tab", // previous question
    "nextQuestion": "shift+tab" // next question
  }
  ```
- DELETE the `"digitQuickSelect": true` line (~155). Keep the no-caps comment, `gateWarnings`, `roundDetection`, `compactionPreservation`, `editorMode`, and the precedence/tolerant-loading/labels-follow-config bullets (still accurate).
- ADD one line noting the silent legacy alias: a pre-rename `keys.focusText` binding still feeds `keys.elaborate` when the new name isn't rebound (config.ts coerceKeys, BAREKEYS-001). Phrasing must avoid the literal "focusText"? NO — the gate bans `focusText` in README.md entirely; phrase it as "a pre-rename `focus`-text binding from older configs is silently honored for the new name" WITHOUT the literal token. (Re-check against the gate grep after writing.)

**4. Keymap section (~173–233)** — adapt h2.35's table:
- Remappable table: 9 rows, new defaults (`d`, `o`, `t`, `m`, `ctrl+s`, `e`, `ctrl+g`, `tab`, `shift+tab`). The `elaborate` row's Effect column: "Enter the editor — duty follows context (elaboration on a selected option, write-in on the `✎ Other` row or a text question); close via `enter` or double-`esc` (a re-press types the letter)". No "toggle" language.
- Fixed-keys table: `enter`, `esc`, `ctrl+c` rows unchanged; `↑` `↓` row gains "and `k` / `j`"; `←` `→` row gains "and `h` / `l`"; DELETE the `1`–`9` row.
- Add a short fixed-family note (R5 as amended, h2.74): the fixed family — `↑`/`↓`/`←`/`→` + `h`/`j`/`k`/`l` aliases, `enter`, `esc`, `ctrl+c` — is the documented exception to "all hotkeys configurable"; all NON-fixed keys are remappable. Note that remapping a config key ONTO a fixed key (e.g. `"deep": "j"`) is deterministically shadowed by the fixed branch — choose free keys.
- Intercept prose (~231–233), rewrite to the two-tier rule (h2.35): modifier-bearing config keys (`ctrl+s`, `ctrl+g`) intercept whenever the panel is open, INCLUDING editor focus — a chord is never a typed character; bare config keys (`d` `o` `t` `m` `e`) and fixed `h`/`j`/`k`/`l` are printable — they intercept only from non-editor focus and always type while the editor holds focus (the same gate number keys follow: number keys do nothing at panel level — they only ever type inside the editor). Single `esc` and `↑`/`↓` forward to the focused editor (caret movement, pi-vim exit).
- The `✎ Other — write your own` prose block after the tables: "arrows reach it, number keys never select it" style — remove the old "digits never do" parenthetical (~line 204); the row is reachable via arrows only, and `enter` accepts it. Everything else in that block (duties, per-question drafts, write-through) stays.

**5. Acceptance refs (~261, ~277)**: AC 2b "`ctrl+t`, type, `enter`" → "`t`, type, `enter`". AC 16: "same-value `enter`/digit" → "same-value `enter`" (both occurrences; keep the byte-identical write-in clause). AC 2d `ctrl+s` — unchanged.

**6. "Keymap conflict re-verification" section (~320–389)** — full rewrite:
- Header: re-verified date from P1.M4.T1.S2's recorded run, pi version, and the same evidence sources (pi docs/keybindings.md, installed extension trees, user rebinds).
- Verified-defaults table: the 9 landed defaults. Bare letters (`d` `o` `t` `m` `e`): no global claim is possible — the panel owns the whole keyboard while open and bare keys never intercept in editor focus; they collide with nothing in pi's or extensions' global vocabulary. `ctrl+s`/`ctrl+g`: keep their existing panel-safe-reuse evidence rows (pi built-ins listed in the current table), plus the two surviving-chord REASONS (h2.74 / decisions ledger): submit must fire from text focus (a bare `s` could never be typed); externalEditor's only valid context is editor focus, where a bare key must type — a bare `g` would be permanently unpressable. `tab`/`shift+tab`: unchanged rows.
- Fixed family paragraph: fixed keys (`enter`/`esc`/`ctrl+c`/arrows/`hjkl`) are not config keys — consumed only while the panel is open; pi regains them on suspend. NO global shortcut is registered (the historical `ctrl+shift+q` was removed — keep that sentence; it explains the absence).
- Avoided-keys tables: UNCHANGED (ctrl+b family, ctrl+shift+s/w, ctrl+m, ctrl+shift+f, ctrl+shift+up/down — still accurate and still the rule).
- Panel-intercept rationale: rewrite for the two-tier rule — chords intercept everywhere in-panel (pi's binding layer never sees them while the panel is open); bare keys intercept only from non-editor focus, so panel-scope reuse costs nothing anywhere else. Collisions exist only while the panel is open and vanish on suspend.
- Regression-guard block: keep the `bash scripts/verify-keymap-conflicts.sh` block and the `src/keymap-guard.test.ts` sentence (both live; P1.M4.T1.S2 refreshed the script for bare keys). Update any wording that implies chord-only parsing.

**7. Do NOT edit**: `spec/*.md` (synced at 8c5f870 — report discrepancies, never diverge silently), Install, Subcommands, Limitations, Development, Project structure. If a spec file contradicts the landed code, report it in the task notes — do not "fix" it from here.

### Success Criteria

- [ ] GATE: `grep -n "ctrl+t\|ctrl+d\|ctrl+l\|focusText\|digit" README.md` → zero output.
- [ ] Every key named in README matches `src/config.ts` DEFAULT_CONFIG.keys and the fixed family (hjkl, enter, esc, ctrl+c).
- [ ] No toggle/re-press-to-close language for elaborate/note; closes documented as `enter`/double-`esc`.
- [ ] Sample settings shows exactly the 9 keys, no `digitQuickSelect`; legacy-alias note present without banned tokens.
- [ ] Conflict section carries P1.M4.T1.S2's fresh recorded output (date, pi version, results).
- [ ] Clean sections byte-identical to HEAD.

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the line-accurate stale map, the authoritative new-contract prose (h2.35/h2.74), the landed config reality, the parallel task's recorded output, and the banned-token gate. All anchored below.

### Documentation & References

```yaml
- file: plan/004_49e25d5235a9/architecture/readme-and-test-flows.md
  why: THE stale map — §1a heading/line table, §1b every grep hit with what changes,
    §1c-1e quoted stale prose (usage paragraph, sample keys block, fixed-keys table,
    intercept prose, conflict-section contents). Work through §1b line by line.
  critical: map was cut at HEAD 182f4ce — re-verify line numbers against the current
    README before editing (earlier M4 tasks may have shifted nothing in README, but check).

- file: README.md
  why: the document being rewritten. 424 lines at research time. Sections: Usage :30,
    Configuration :130, Keymap :173, Subcommands :235, Acceptance :251, Limitations :279,
    Development :300, conflict re-verification :320, Project structure :391. NO TOC exists
    (no anchor list to maintain).

- file: plan/004_49e25d5235a9/prd_snapshot.md — h2.35 (Hotkeys — defaults and config)
  why: AUTHORITATIVE new contract — the hotkey table (defaults + config keys + context
    column), the two-tier intercept rule prose, fixed-key notes (hjkl semantics, R5
    amendment), conflict-avoidance paragraph, escExitWindowMs. Adapt its wording; do not
    invent. Note: h2.35's table says elaborate "enters the editor" with no re-press close —
    mirror that.

- file: plan/004_49e25d5235a9/prd_snapshot.md — h2.55 (Config reference)
  why: the exact 9-key sample block to mirror in the Configuration section (the README adds
    inline comments + the surrounding settings prose it already has).

- file: plan/004_49e25d5235a9/prd_snapshot.md — h2.74 (2026-10-12 interrogation)
  why: the trilogy ruling itself — reasons for surviving chords (submit from text focus;
    externalEditor editor-focus-only context), two-tier intercept consequence, rename
    rationale, R5 amendment wording. Quote/adapt for the fixed-family and conflict notes.

- file: src/config.ts
  why: landed reality check — DEFAULT_CONFIG.keys (:109-116), KeyAction "elaborate" (:51),
    config reference comment table (:280-285), silent focusText→elaborate compat alias
    (:194-205, document WITHOUT the literal token). grep this file, not memory.

- file: src/panel/keys.ts
  why: fixed-family implementation evidence — hjkl bare-byte branches (:440-465),
    editor-focus gating, header comment citing h2.74. Cite as the source of the
    "remapping onto a fixed key is shadowed" note.

- file: plan/004_49e25d5235a9/P1M4T1S2/PRP.md
  why: CONTRACT (parallel, treat as landed): produces the recorded
    `bash scripts/verify-keymap-conflicts.sh` output (exit 0, bare letters clear,
    ctrl+s/ctrl+g unchanged) for the PR notes — THIS task transcribes that output into the
    README conflict section (P1.M4.T1.S2's PRP says so explicitly: "README rewrite is
    P1.M4.T2.S1's"). If its recorded output is unavailable at implementation time, run the
    script yourself and record date + pi version + result.

- file: scripts/verify-keymap-conflicts.sh
  why: the regression guard the README documents — confirm it still exists and its usage
    line before quoting it; P1.M4.T1.S2 may have refreshed its summary logic for bare keys.

- file: spec/decisions.md (2026-10-12 section, READ-ONLY)
  why: the ruling's canonical home — README prose must AGREE with it; never edit spec/*.
    The "decisions :113" externalEditor reason cited in the item contract lives in the
    2026-10-12 BAREKEYS-001 entry (surviving-chord rationale).
```

### Current Codebase tree (relevant excerpt)

```bash
README.md        # MODIFY — the only file this task touches
src/config.ts    # READ-ONLY (default keys source of truth)
src/panel/keys.ts# READ-ONLY (fixed family evidence)
spec/*.md        # READ-ONLY (synced separately — report divergence, never edit)
```

### Desired Codebase tree

```bash
README.md        # rewritten stale sections; clean sections byte-identical; gate grep clean
```

### Known Gotchas of our Codebase & Library Quirks

```text
CRITICAL — the GATE: `grep -n "ctrl+t\|ctrl+d\|ctrl+l\|focusText\|digit" README.md`
must return ZERO lines. "digit" is banned as a SUBSTRING — "digits", "digitQuickSelect",
"digit-selectable" all fail. Phrase number-key inertness as e.g. "number keys do nothing
at panel level — they only type inside the editor". The legacy-alias note must describe
the old binding name WITHOUT the literal "focusText" (e.g. "the old focus-the-editor key
name from pre-rename configs is silently honored").
GOTCHA: h2.35's own prose still says "digit" (DIGIT-OUT-001 supersession note) — the SPEC
keeps it; the README cannot. Do not copy h2.35's digit paragraph; write the inertness line
yourself.
GOTCHA: `ctrl+g` prose is VALID and must survive the rewrite (the gate bans ctrl+t/d/l,
NOT ctrl+g/ctrl+s). Same for `ctrl+shift+m`? NO — batchNote moved to `m`; only ctrl+s and
ctrl+g chords remain.
GOTCHA: "toggle" language for elaborate/focusText appears in the OLD remappable table row
("or (already focused) close it") — the re-press gesture is removed; closes are enter /
double-esc only.
GOTCHA: keep AC summary numbers/anchors intact (2a-2d, 15, 16) — only key references change.
GOTCHA: README has no TOC — do not add anchors or links that assume one.
```

## Implementation Blueprint

### Data models and structure

N/A — documentation task. The "model" is the section inventory in the stale map §1a.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: RE-VERIFY the stale map
  - grep README.md for the stale tokens (ctrl+t, ctrl+d, ctrl+l, ctrl+shift+m, ctrl+shift+e,
    focusText, digit, hjkl) and reconcile line numbers with
    plan/004_49e25d5235a9/architecture/readme-and-test-flows.md §1a/§1b (map cut at 182f4ce)

Task 2: REWRITE Usage item 2 (lines ~33-68)
  - new key sentence (←/→/h/l + tab/shift+tab for questions; ↑/↓/k/j + enter for options;
    d/o/t/m/e; ctrl+g; ctrl+s), delete quick-select sentence, fix :47/:51/:54/:59 refs,
    add "close via enter or double-esc" where editor closes are described

Task 3: REWRITE Configuration sample (~137-155)
  - the 9-key block (see What §3), delete digitQuickSelect line, add alias note
    (token-free), keep the rest of the section

Task 4: REWRITE Keymap section (~173-233)
  - remappable table (9 rows, new defaults, elaborate row without toggle language),
    fixed table (+ hjkl aliases, digit row deleted), fixed-family/R5 note + shadowing note,
    two-tier intercept prose (per What §4), fix the ✎ Other "digits never do" parenthetical

Task 5: FIX Acceptance refs (~261, ~277) — AC 2b `t`; AC 16 enter-only (×2)

Task 6: REWRITE "Keymap conflict re-verification" (~320-389)
  - fresh record from P1.M4T1S2's output (or run scripts/verify-keymap-conflicts.sh
    yourself and record date/pi-version/result), 9-default table with bare-letter
    rationale + surviving-chord reasons, fixed-family paragraph, unchanged avoided-keys
    tables, two-tier intercept rationale, keep regression-guard block

Task 7: GATES
  - grep -n "ctrl+t\|ctrl+d\|ctrl+l\|focusText\|digit" README.md   # MUST be empty
  - grep -nE 'ctrl\+s|ctrl\+g' README.md   # still present where intended
  - git diff README.md   # confirm clean sections untouched
  - cross-check every key named in README against src/config.ts DEFAULT_CONFIG.keys
```

### Implementation Patterns & Key Details

```text
Two-tier intercept prose template (adapt h2.35, digit-free):

  While the panel is open, panel keys are intercepted before the embedded editor
  sees them — in two tiers. Modifier-bearing config keys (`ctrl+s`, `ctrl+g`)
  intercept everywhere, including while the editor holds focus: a chord is never
  a typed character. BARE config keys (`d`, `o`, `t`, `m`, `e`) and the fixed
  `h`/`j`/`k`/`l` are printable: they intercept only from non-editor focus and
  always type while the editor holds focus — typing `t` in an answer must insert
  a `t`. Number keys do nothing at panel level; they only ever type inside the
  editor. A single `esc` and `↑`/`↓` forward to the focused editor (caret
  movement, pi-vim mode exit).

Fixed-family note template:

  The fixed family — ↑/↓/←/→ and their h/j/k/l aliases, enter, esc, ctrl+c — is
  not configurable (R5 as amended: all NON-fixed keys are remappable; the fixed
  family is the documented exception). hjkl mirror the arrows exactly
  (view-aware navigation, editor-focus forwarding). Remapping a config key ONTO
  a fixed key (e.g. "deep": "j") is deterministically shadowed by the fixed
  branch — choose a free key.
```

### Integration Points

```yaml
CONSUMES: P1.M4.T1.S2's recorded verify-keymap-conflicts.sh output (conflict-section record)
SOURCE OF TRUTH: src/config.ts DEFAULT_CONFIG.keys; src/panel/keys.ts fixed branches;
  prd_snapshot h2.35/h2.55/h2.74
DO NOT TOUCH: spec/*.md, src/**, scripts/**, package files — README.md only
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npx prettier --check README.md 2>/dev/null || true   # if README is prettier-managed; otherwise skip
```

### Level 2: Unit Tests

```bash
npm test && npm run typecheck   # unaffected, must stay green (proof nothing else changed)
```

### Level 3: Integration (the GATE)

```bash
grep -n "ctrl+t\|ctrl+d\|ctrl+l\|focusText\|digit" README.md     # MUST output nothing (exit 1)
grep -nE '"(deep|overview|elaborate|batchNote|submit|discuss|externalEditor|prevQuestion|nextQuestion)"' README.md
# 9 config keys present in the sample
grep -c "hjkl\|h`/`j\|`h`" README.md   # hjkl documented (fixed table + notes)
bash scripts/verify-keymap-conflicts.sh   # exits 0 — the record the README cites is live
```

### Level 4: Domain-specific

```bash
# Key-set fidelity: every default named in README == src/config.ts
grep -A12 '"keys"' src/config.ts | head -14        # compare against README sample/comments
# Clean sections untouched:
git diff --stat README.md                          # one file
git diff README.md | grep -E '^[-+].*(Install|Subcommands|Limitations|Development|Project structure)' || echo "clean sections untouched"
```

## Final Validation Checklist

### Technical Validation

- [ ] GATE grep returns zero lines; `npm test`/`npm run typecheck` still green; `verify-keymap-conflicts.sh` exits 0.

### Feature Validation

- [ ] All stale-map hits (§1b table) addressed; every key reference matches landed config.
- [ ] Conflict section carries the fresh re-verification record (date, pi version, script output).
- [ ] No toggle/re-press language; elaborate/note closes documented as enter/double-esc.
- [ ] Sample settings: exactly 9 keys, no digitQuickSelect, alias note token-free.

### Code Quality Validation

- [ ] Only README.md modified (`git status` clean otherwise); spec/*.md untouched.
- [ ] h2.35/h2.55/h2.74 wording adapted faithfully, not paraphrased into contradiction.

### Documentation & Deployment

- [ ] This task IS the changeset docs sync ([Mode B]) — no further doc debt for the trilogy.

## Anti-Patterns to Avoid

- ❌ Don't copy h2.35's digit paragraph verbatim — the spec keeps the word, the README cannot.
- ❌ Don't describe `t`/`m` as toggles or document re-press-to-close.
- ❌ Don't delete the ctrl+s/ctrl+g prose to "pass" the gate — the gate bans ctrl+t/d/l only.
- ❌ Don't invent a TOC/anchor list (README has none).
- ❌ Don't edit spec/*.md even where it disagrees — report, never diverge silently.
- ❌ Don't touch the avoided-keys tables or the regression-guard block — still accurate/live.

---

**Confidence Score**: 9/10 — line-accurate stale map, authoritative source prose (h2.35/55/74), landed config verified, and a machine-checkable gate; the only residual risk is the availability of P1.M4.T1.S2's recorded output at implementation time (fallback: run the script yourself).

# PRP — P1.M1.T2.S3: Extend the keymap cross-check to the PANELTOGGLE-001 surfaces (10th default + panelShortcut)

## Goal

**Feature Goal**: Extend P1.M1.T2.S2's three-surface keymap cross-check (README keymap table ↔ README sample settings ↔ README keymap-conflict record block, all against `src/config.ts` `DEFAULT_CONFIG`) from the original 9 actions to the PANELTOGGLE-001 additions: the `keys.toggle` action (`ctrl+n`) and the `panelShortcut` toggle flag (`true`). Verify every surface that names the toggle carries `ctrl+n` exactly where config.ts declares it, with semantics consistent with the ui-spec hotkey row (dual-surface: in-panel suspend leg + global main-editor open/resume leg, gated by `panelShortcut`). Fix drift in place — README.md only.

**Deliverable**: (a) A per-action match verdict — **10/10 actions + panelShortcut MATCH expected** (the 9 S2-verified actions + `toggle`), recorded for downstream consumption by P1.M1.T3.S1 and P1.M1.T3.S2; (b) if drift is found, a corrected README.md (Mode A); if all surfaces match, README.md untouched and the DOCS line reads `'none — verification confirmed no user-facing change'`.

**Success Definition**: Every README surface naming `keys.toggle` or `panelShortcut` agrees with `src/config.ts` (value `ctrl+n` / `true`, field names `keys.toggle` / `panelShortcut`, dual-surface semantics per ui-spec h2.36); the verdict artifact exists with the full per-surface table; `git diff` shows README.md only (or nothing in the no-op case); suite/typecheck/lint stay green.

## User Persona

**Target User**: The downstream verification tasks (P1.M1.T3.S1 stale-fossil sweep, P1.M1.T3.S2 final delta gate) and any future reader of README.md configuring the panel toggle.

**Use Case**: T3.S1 consumes this task's verdict to know the PANELTOGGLE-001 surfaces are already reconciled (so its fossil sweep can exclude them and chase only true residue); T3.S2 consumes it as evidence the README is fully synced to config at gate time.

**Pain Points Addressed**: The S2 cross-check (Complete) covered only the original 9 KEYMNEMONICS-001 actions; PANELTOGGLE-001 landed later and its README surfaces were never systematically compared against `config.ts` — this closes that gap.

## Why

- PRD h2.36 ("Hotkeys — defaults and config") rules the toggle row: `ctrl+n` / `keys.toggle` (PANELTOGGLE-001), dual-surface, and demands "Dev agent must re-verify at build time and record findings."
- PANELTOGGLE-001 (PRD delta ec61eb1, implemented in commit 70b08ff) added both `keys.toggle` and the `panelShortcut` config gate; P1.M1.T1.S3 re-baselined the verification record over them (task Complete).
- This subtask is the docs leg of that re-verification: the README is the shipped cross-check surface, and T3.S2's final gate ("diff confined to README.md, gates green") depends on the keymap documentation being internally consistent before the sweep.

## What

Docs-only verification (and conditional correction) of every README surface naming `keys.toggle` or `panelShortcut`:

1. **Surface A — sample settings block** (`## Configuration` jsonc): the `"toggle": "ctrl+n"` entry and the `"panelShortcut": true` entry.
2. **Surface B — keymap table** (`## Keymap`, "Remappable actions"): the `Toggle panel` / `keys.toggle` / `ctrl+n` row.
3. **Surface C — record block per-key table** (`### Keymap conflict re-verification`): the `` `ctrl+n` (`toggle`) `` row.
4. **Supporting semantic net** (verify-only): the dedicated `### Panel toggle shortcut (PANELTOGGLE-001)` section and the record block's fixed-keys prose naming the `panelShortcut` gate.
5. Semantic cross-check of A/B/C against the ui-spec h2.36 toggle row: dual-surface wording, `panelShortcut` gate mention, empty-state notice.

### Success Criteria

- [ ] Verdict recorded: per-surface MATCH/DRIFT for `toggle` (3 surfaces) and `panelShortcut` (sample settings + every prose mention), with line anchors
- [ ] Verdict states **10/10 + panelShortcut** using the contract's counting (see Gotcha 1), with the count reconciliation note
- [ ] Any drift fixed in README.md only, in place, minimal edits (Mode A); otherwise README.md byte-identical
- [ ] `expandDescription` (`x`) NOT added anywhere by this task (scope guard — see Gotcha 2); its absence REPORTED as a hand-off note instead
- [ ] `npm test` / `npm run typecheck` / `npm run lint` all green
- [ ] No edits to `src/`, `spec/`, `scripts/`, or `**/tasks.json`

## All Needed Context

### Context Completeness Check

This PRP embeds every expected string, anchor, and contingency: an agent with zero prior knowledge of this repo can execute the comparison mechanically. The only files it must open are README.md, src/config.ts, and (for confirmation) scripts/verify-keymap-conflicts.sh output.

### Documentation & References

```yaml
- file: src/config.ts
  why: "SOURCE OF TRUTH — DEFAULT_CONFIG.keys.toggle = \"ctrl+n\" (:151, last keys entry) and DEFAULT_CONFIG.panelShortcut = true (:157); boolean coercion at :277; in-file config-doc rows: keys table :346 (toggle row) and toggles table :372 (panelShortcut row)"
  pattern: "compare README surfaces verbatim against these values — lowercase chord spelling 'ctrl+n', field names keys.toggle/panelShortcut exactly"
  gotcha: "config.ts keys has ELEVEN entries (incl. expandDescription 'x' at :150) — do not 'complete' the README keymap table to 11 here; the 11th entry is out of scope (see Gotcha 2)"

- file: plan/006_45773b259b06/P1M1T1S3/research/notes.md
  why: "THE refreshed VerificationRecord (2026-11-20, HEAD f2f5fdc, pi 1.0.2): 11-key per-key table incl. the ctrl+n row verbatim ('global registration (PANELTOGGLE-001) — pi built-in app.session.toggleNamedFilter is picker-scoped; no focus overlap; extension wins at the main editor (startup diagnostic)'), script summary 'Checked 11 default key(s)', drift []"
  pattern: "Surface C's toggle row must be consistent with THIS record, not the older 2026-10-20/eb09516 text"

- file: plan/006_45773b259b06/P1M1T2S2/research/notes.md
  why: "the sibling 9-action cross-check this task EXTENDS — its method (direct string comparison, field names AND values, per-key comments) and verdict format ('9/9 MATCH') are the pattern to mirror as '10/10 + panelShortcut'"

- file: README.md
  why: "the ONLY file this task may edit. Surfaces (line numbers as of research time — RE-ANCHOR BY GREP, they shift): sample settings toggle ~:166 / panelShortcut ~:174; keymap table Toggle panel row ~:211; dedicated section ~:294; record block per-key ctrl+n row ~:498 and gate prose ~:503-504"
  gotcha: "P1.M1.T2.S1 (record block rewrite) was dispatched and marked Complete but had NOT landed in the shared tree at research time — the block you find may be pre- or post-rewrite. See Gotcha 3"

- file: src/shortcut.ts
  why: "implementation evidence for the semantic net: parseAccelerator(config.keys.toggle) :69, panelShortcut gate, main-editor-only registration, ctrl+n/toggleNamedFilter picker-scoped note in header :18"
  pattern: "use only to confirm semantics quoted in README are truthful; never edit"

- file: src/command.ts
  why: "EMPTY_STATE_MESSAGE = 'No active interrogation — ask the agent to interrogate you' (:51) — the h2.37 empty-state string the README's 'No active interrogation' notice shorthand references"

- file: src/keymap-guard.test.ts
  why: ":28-42 documents the 11-key completeness contract AND the PANELTOGGLE-001 ctrl+n exception (picker-scoped share → ctrl+n deliberately NOT in AVOIDED_KEYS)"

- prd: spec/ui-spec.md h2.36 ("Hotkeys — defaults and config") toggle row
  why: "the semantic authority Surface A/B/C wording must stay consistent with — four required content points listed under Implementation Patterns below"
```

### Current Codebase tree (relevant excerpt)

```bash
README.md                    # the doc under verification (only editable file)
src/config.ts                # DEFAULT_CONFIG — source of truth (keys.toggle :151, panelShortcut :157)
src/shortcut.ts              # global toggle shortcut impl (open/resume leg)
src/command.ts               # EMPTY_STATE_MESSAGE :51
src/keymap-guard.test.ts     # static guard + PANELTOGGLE-001 exception doc
scripts/verify-keymap-conflicts.sh   # runtime conflict guard (exit 0, "Checked 11 default key(s)")
plan/006_45773b259b06/P1M1T1S3/research/notes.md   # refreshed VerificationRecord (INPUT)
plan/006_45773b259b06/P1M1T2S2/research/notes.md   # 9-action cross-check pattern (INPUT)
plan/006_45773b259b06/P1M1T2S3/                     # this task (PRP + verdict output)
```

### Desired Codebase tree with files to be added

```bash
# No source files added or changed. Expected outcomes:
README.md                                          # UNCHANGED (no-op) or minimally corrected (Mode A)
plan/006_45773b259b06/P1M1T2S3/research/verdict.md # NEW — the extended per-action verdict (OUTPUT artifact)
```

### Known Gotchas of our codebase & Library Quirks

```python
# GOTCHA 1 — COUNT RECONCILIATION (from T1.S3's live record): the work-item contract
# says "10th default (keys.toggle)" but DEFAULT_CONFIG.keys carries ELEVEN entries.
# TWO keys landed after the 9-key S2 record: expandDescription "x" (10th entry,
# DEEP-FULLSCREEN-001/DUMP-ONCE-001, commit 74ebe39) and toggle "ctrl+n" (11th
# entry, PANELTOGGLE-001, commit 70b08ff). The contract's "10/10" counts the 9
# S2 actions + toggle. Use "10/10" in the verdict (contract framing) and append the
# reconciliation note: "config carries 11 keys; expandDescription (x) is out of
# scope for T2.S3 — see hand-off note."

# GOTCHA 2 — SCOPE GUARD: do NOT add the expandDescription "x" row to the sample
# settings or keymap table, and do NOT add an x row to the record block, even though
# its absence is real drift — that residue belongs to the DEEP-FULLSCREEN-001
# changeset and is owned by P2.M1.T1.S2 (README residue audit) / P1.M1.T3.S1
# (stale-fossil sweep). REPORT it in the verdict hand-off notes; do not fix it here.
# Fixing it here would blur the changeset-level accounting T3.S1/S2 gate on.

# GOTCHA 3 — S1 DEPENDENCY: P1.M1.T2.S1 (record block rewrite to the 2026-11-20 /
# f2f5fdc / 11-row record) was dispatched and marked Complete but had NOT landed in
# the tree at this PRP's research time — the block still read "2026-10-20 / eb09516 /
# all 9 defaults clear" with 10 rows (ctrl+n present at ~:498, x absent). RE-READ the
# live README at implementation time:
#   - If the block is the fresh 11-row record: verify its ctrl+n row against
#     T1.S3's record (values + classification "global (extension)" + picker-scoped
#     evidence) — this is Surface C.
#   - If the block is still the stale one: S1's rewrite is missing — do NOT rewrite
#     the block yourself (S1's 2-point deliverable); verify the ctrl+n ROW that is
#     present, and flag the stale header/count ("all 9 defaults" vs 11) in the
#     verdict as a dependency note for T3.S1/T3.S2.
# In BOTH states the toggle row's expected content is the same (Gotcha-free: the
# ctrl+n row text predates and survives the rewrite).

# GOTCHA 4 — ANCHOR BY CONTENT, NOT LINE NUMBERS: S1's rewrite shifts every line
# below ~:428. Grep for anchors: '"toggle": "ctrl+n"', '"panelShortcut": true',
# '| Toggle panel', '### Panel toggle shortcut', 'ctrl+n' (`toggle`)'.

# GOTCHA 5 — SPELLING: pi's accelerator form is lowercase 'ctrl+n' everywhere
# (config.ts :151, config.ts :346). 'Ctrl+N', 'ctrl-N', 'C-n' are drift if found.
# panelShortcut is camelCase as one word; 'panel_shortcut' / 'panelshortcut' are drift.

# GOTCHA 6 — the diff gate: T3.S2 requires the tracked-file diff confined to
# README.md. The verdict file lives under plan/006_45773b259b06/P1M1T2S3/research/
# (untracked research artifact — same class as the orchestrator's agents/ files);
# it does not violate that gate. Never touch **/tasks.json or spec/.
```

## Implementation Blueprint

### Data models and structure

Docs-only — no data models. The "data" is the verdict artifact (see Task 4): a per-surface MATCH/DRIFT table plus hand-off notes.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: RE-BASELINE the live state (read-only)
  - RUN: cd /home/dustin/projects/pi-structured-interrogation && git rev-parse --short HEAD && git status --short
  - GREP the five anchors (Gotcha 4) and record CURRENT line numbers for: sample
    settings toggle + panelShortcut entries, keymap Toggle panel row, dedicated
    PANELTOGGLE-001 section, record block ctrl+n row + panelShortcut gate prose
  - DETERMINE which state the record block is in (fresh 11-row post-S1 vs stale pre-S1 — Gotcha 3)
  - READ src/config.ts DEFAULT_CONFIG (:140-158) and record the live values of
    keys.toggle and panelShortcut (config wins over every expectation in this PRP)

Task 2: THREE-SURFACE COMPARISON for keys.toggle
  - COMPARE Surface A (sample settings) against config: expect `"toggle": "ctrl+n"`
    with a comment naming BOTH legs — current text: `// toggle the panel (in-panel: suspend; main editor: open/resume)`
  - COMPARE Surface B (keymap table) against config: expect row
    `| Toggle panel | keys.toggle | ctrl+n | <dual-surface effect …> |` whose effect
    cell carries all four ui-spec content points (see Patterns below)
  - COMPARE Surface C (record block per-key table) against T1.S3's record: expect a
    `ctrl+n` (`toggle`) row classified global-(extension) with the picker-scoped
    toggleNamedFilter evidence
  - RECORD MATCH/DRIFT per surface with line anchors

Task 3: PANELSHORTCUT FLAG COMPARISON + SEMANTIC NET
  - COMPARE sample settings: expect `"panelShortcut": true,` with comment
    `// register the keys.toggle global main-editor shortcut (PANELTOGGLE-001)`
  - VERIFY the gate is named where the toggle is explained: keymap row effect cell
    ("gated by the panelShortcut toggle (default on)"), dedicated section
    (`"panelShortcut": false` unregister guidance + rebind example), record block
    fixed-keys prose ("keys.toggle + the panelShortcut gate, default on — PANELTOGGLE-001")
  - SEMANTIC CROSS-CHECK Surfaces A/B + dedicated section against the four ui-spec
    h2.36 content points (Patterns below); check the empty-state notice references
    the "No active interrogation" string (src/command.ts:51)

Task 4: FIX DRIFT (Mode A) or CONFIRM NO-OP
  - IF any drift: edit README.md in place, minimal hunks, preserving surrounding
    table/JSONC format. Fix ONLY toggle/panelShortcut-relevant drift. See Patterns
    for the enumerated drift cases and their canonical fixes.
  - IF no drift (expected): README.md untouched; DOCS line for the report:
    'none — verification confirmed no user-facing change'
  - NEVER: add expandDescription/x rows (Gotcha 2); rewrite the record block beyond
    the toggle row (Gotcha 3); edit src/, spec/, scripts/, tasks.json

Task 5: WRITE the verdict artifact (OUTPUT)
  - CREATE plan/006_45773b259b06/P1M1T2S3/research/verdict.md containing:
    (1) baseline (HEAD sha, date, record-block state found); (2) per-surface
    MATCH/DRIFT table for toggle (A/B/C) and panelShortcut (sample settings +
    each prose mention); (3) the verdict line "10/10 actions + panelShortcut —
    MATCH" (or the drift corrections made) with the Gotcha-1 count-reconciliation
    note; (4) hand-off notes for T3.S1/T3.S2: expandDescription/x absence
    (out of scope, owned by P2.M1.T1.S2/T3.S1) and the record-block state found
  - ECHO the same verdict summary in the final implementation report (the
    orchestrator persists it; T3.S1/T3.S2 read both)

Task 6: GATES
  - RUN: npm test && npm run typecheck && npm run lint   # all green (docs-only; expected 56 files / 1679 tests per T1.S3 — record actuals)
  - RUN: bash scripts/verify-keymap-conflicts.sh          # exit 0, summary "Checked 11 default key(s)" — confirms toggle still clear
  - RUN: git status --short && git diff --stat            # README.md only (Mode A) or no tracked diff (no-op) + the new untracked verdict.md
```

### Implementation Patterns & Key Details

**The four ui-spec h2.36 content points** every toggle explanation must stay consistent with (a surface need not carry all four, but must not contradict any):

```text
1. CLOSE LEG:  inside an open panel, ANY focus (chord = tier-1 intercept — never a
               typed character); suspends via the same done(null) exit as the esc
               ladder's terminal rung. A BARE remap would forward while the editor
               holds focus (BAREKEYS-001 tier rules) — wording must not promise
               bare-key interception in editor focus.
2. OPEN/RESUME LEG: GLOBAL — from pi's main editor, the registered shortcut invokes
               the panel exactly like /interrogate (SURFACE-001 allow-list
               unchanged); nothing resumable → the "No active interrogation" notice.
3. GATE:       registration is gated by panelShortcut (default on).
4. KEY SHARE:  ctrl+n shares its key with pi's PICKER-SCOPED app.session.toggleNamedFilter
               (session resume picker only — no focus overlap; pi's runner does not
               reserve it; extension wins at the main editor; one startup diagnostic).
```

**Current expected strings** (verified in the working tree at research time — re-verify live; config wins on any mismatch):

```text
Surface A  (sample settings):
  "toggle": "ctrl+n"         // toggle the panel (in-panel: suspend; main editor: open/resume)
  "panelShortcut": true,     // register the keys.toggle global main-editor shortcut (PANELTOGGLE-001)
  — toggle is the LAST keys entry, matching config.ts declaration order.

Surface B  (keymap table row, one line):
  | Toggle panel | `keys.toggle` | `ctrl+n` | **Dual-surface toggle (PANELTOGGLE-001):** inside
  an open panel, suspend it (any focus — the chord is never a typed character); from pi's main
  editor, the globally registered shortcut opens or resumes the panel through the exact
  /interrogate invoke ladder (nothing resumable → the "No active interrogation" notice). The
  registration is gated by the `panelShortcut` toggle (default on); `ctrl+n` shares its key with
  pi's picker-scoped `app.session.toggleNamedFilter` — no focus overlap (pi logs one startup
  diagnostic; this extension wins at the main editor) |

Surface C  (record block per-key row):
  | `ctrl+n` (`toggle`) | global (extension) | pi: `app.session.toggleNamedFilter`
  (keybindings.md:139) — PICKER-SCOPED (session resume picker only), no focus overlap with the
  main-editor dispatch; pi's runner does not reserve it, the extension wins at the main editor
  (one startup diagnostic) |

Semantic net (verify-only):
  ### Panel toggle shortcut (PANELTOGGLE-001) — dedicated section: dual-surface, the
  "No active interrogation" notice, `"panelShortcut": false` to unregister, rebind
  example (e.g. alt+q), TUI-only (never fires in RPC/print modes).
  Record block fixed-keys prose: "The ONE global shortcut registration is the `toggle`
  chord (`ctrl+n`, `keys.toggle` + the `panelShortcut` gate, default on — PANELTOGGLE-001)".
```

**Enumerated drift cases → canonical fixes (Mode A)**:

```text
- Chord spelling drift (Ctrl+N / ctrl-N): normalize to lowercase `ctrl+n` (config.ts form).
- panelShortcut default misstated ("default off"): fix to true, keep the PANELTOGGLE-001 comment.
- A surface MISSING the toggle entry/row entirely:
    sample settings → add after "nextQuestion": `"toggle": "ctrl+n"` with the dual-leg comment (Surface A text above);
    keymap table    → append the Surface B row (full effect cell — all four content points);
    record block    → this only happens if S1's rewrite regressed it; restore the Surface C row
                      verbatim from T1.S3's record (Gotcha 3 still applies to the rest of the block).
- Semantic drift in an effect cell (e.g. open leg described as panel-scoped, gate not
  mentioned, wrong empty-state string): repair the cell to the four content points —
  the Surface B text above is canonical.
- panelShortcut prose drift (gate described as removing the in-panel close leg): the
  gate unregisters ONLY the global main-editor shortcut; the in-panel ctrl+n close leg
  is config-key driven and stays — fix wording that conflates them.
```

### Integration Points

```yaml
NONE — docs-only. No database, config code, or route changes. README.md is the only
mutable file; the verdict artifact is additive under plan/006_45773b259b06/P1M1T2S3/research/.
DOWNSTREAM: P1.M1.T3.S1 (fossil sweep) and P1.M1.T3.S2 (final gate) consume the verdict.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Docs-only — no linters apply to README.md. Structural sanity instead:
grep -c '"toggle": "ctrl+n"' README.md        # expect: 1 (sample settings)
grep -c '| Toggle panel ' README.md           # expect: 1 (keymap table)
grep -c '`ctrl+n` (`toggle`)' README.md       # expect: 1 (record block)
grep -c '"panelShortcut": true' README.md     # expect: 1 (sample settings)
# All four content points findable:
grep -n 'panelShortcut' README.md             # expect mentions in: sample settings, keymap row, dedicated section, record prose
```

### Level 2: Unit Tests (Component Validation)

```bash
npm test               # expect: all pass (56 files / 1679 tests at T1.S3's f2f5fdc baseline — record actuals)
npm run typecheck      # expect: exit 0, no output
npm run lint           # expect: exit 0
# Docs-only change: any failure means you edited something beyond README.md — revert and re-check scope.
```

### Level 3: Integration Testing (System Validation)

```bash
bash scripts/verify-keymap-conflicts.sh
# expect: exit 0; summary line "Checked 11 default key(s)"; ctrl+n row classified as the
# PANELTOGGLE-001 global registration with picker-scoped evidence. This is confirmation
# that the documented toggle default is still conflict-clear at your HEAD.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Final diff discipline:
git status --short    # tracked modifications: README.md only (Mode A) or none (no-op);
                      # untracked additions: ONLY plan/006_45773b259b06/P1M1T2S3/research/verdict.md
git diff README.md    # if Mode A: read every hunk — each must be toggle/panelShortcut-scoped
# Cross-artifact consistency (the OUTPUT contract):
# verdict.md exists, states 10/10 + panelShortcut with per-surface anchors, carries the
# count-reconciliation note and the two hand-off notes (expandDescription; record-block state)
```

## Final Validation Checklist

### Technical Validation

- [ ] All 4 validation levels completed
- [ ] `npm test` / `npm run typecheck` / `npm run lint` green
- [ ] `scripts/verify-keymap-conflicts.sh` exit 0, "Checked 11 default key(s)"
- [ ] Tracked diff: README.md only (Mode A) or empty (no-op); verdict.md is the sole untracked addition

### Feature Validation

- [ ] Surfaces A/B/C each compared against `src/config.ts` live values; MATCH/DRIFT recorded per surface
- [ ] `panelShortcut` compared at sample settings + every prose mention (keymap row, dedicated section, record prose)
- [ ] Semantic cross-check against the four ui-spec h2.36 content points done; empty-state notice consistent with src/command.ts:51
- [ ] Verdict: "10/10 actions + panelShortcut — MATCH" (or drift list + corrections made)
- [ ] DOCS line present: Mode A corrections listed, or `'none — verification confirmed no user-facing change'`
- [ ] Hand-off notes recorded for T3.S1/T3.S2 (expandDescription/x absence; record-block state found)

### Code Quality Validation

- [ ] No `expandDescription`/`x` rows added (Gotcha 2 scope guard held)
- [ ] No record-block rewrite beyond the toggle row (Gotcha 3 held)
- [ ] No edits to `src/`, `spec/`, `scripts/`, `**/tasks.json`, `.gitignore`
- [ ] All grep anchors re-resolved live (no reliance on this PRP's line numbers)

### Documentation & Deployment

- [ ] README edits (if any) preserve surrounding JSONC/table format and comment style
- [ ] verdict.md is self-contained (a reader with only it + README understands the verdict)

## Anti-Patterns to Avoid

- ❌ Don't add the `x`/`expandDescription` rows "while you're in there" — changeset accounting breaks (Gotcha 2)
- ❌ Don't rewrite or "refresh" the record block beyond the toggle row — that is S1's deliverable (Gotcha 3)
- ❌ Don't trust this PRP's line numbers — re-anchor by grep (Gotcha 4)
- ❌ Don't treat "expected MATCH" as proof — run every comparison against the LIVE config.ts and LIVE README; record what you observe, not what this PRP predicts
- ❌ Don't touch anything outside README.md + the verdict artifact
- ❌ Don't skip the gates because "it's only docs" — T3.S2 inherits your state

---

**Confidence Score: 9/10** — All four toggle/panelShortcut surfaces verified matching during this PRP's research session, so the overwhelmingly likely outcome is a verification no-op with a clean verdict artifact. The one residual risk is the S1 record-block state (Gotcha 3), which the PRP handles explicitly for both branches.

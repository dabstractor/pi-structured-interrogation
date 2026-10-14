# Delta PRD — pi-interrogator: keymap trilogy (VIMNAV-001 / BAREKEYS-001 / DIGIT-OUT-001)

Delta from the previous PRD (completed through plan 003, backlog P1–P4) to the current PRD
(spec synced at `8c5f870`..`182f4ce`). **Verified against the working tree at HEAD `182f4ce`.**

## 1. Diff analysis — what actually changed, and what is already shipped

The PRD diff bundles twelve decision changes dated 2026-10-07 → 2026-10-14 plus TRUST-001.
**Eleven of them are ALREADY IMPLEMENTED IN SOURCE** — cite, do not rebuild:

| Decision | Shipped by | Evidence at HEAD |
|---|---|---|
| TRUST-001 (full answer fidelity) | `3779383` | `src/results.ts` emits `  answer:` / `  elaboration:` detail lines; `src/delivery.ts` continuation line under capped line-1 entries |
| DEEP-PIN-002 (pinned-question framing) | `6e383c2` | `QUESTION_RAIL = "▌ "` in `src/panel/deep-view.ts` |
| DEEP-PIN-003 (answered = success-green title, both views) | `3779383` | `titleStyle()` in `deep-view.ts`; short-view row coloring |
| GOAL-OUT-001 (goal never renders in the pane) | `e6e2f3a` | zero `goal` matches in `deep-view.ts`; `DeepViewInput` is goal-blind |
| MIRROR-SILENT-001 (no state-entry renderer) | `e6e2f3a` | zero `buildStateEntryRenderer`/`registerEntryRenderer` matches in `src/renderers.ts` |
| DEEP-FULL-001 (deep view never truncates prose) | `e6e2f3a` | no `capText`/`maxChars` in `deep-view.ts` |
| CAPS-OUT-001 (caps engine deleted, FR-23) | `e6e2f3a` | `src/caps.ts` deleted; caps gone from config/tool |
| DEEP-STICKY-ADVANCE (answering deep stays deep) | `2b174b1` | `acceptFromDeep` honors `deepSticky` |
| DEEP-LAND-001 (landing scroll re-seed + defensive clamp) | `182f4ce` | `deepLandScroll`; `renderDeepWindow` re-clamps through `clampScroll` |
| BUG-001 / BUG-003 / BUG-005 / BUG-002-panel / BUG-004 | plan 003 (P1–P4) | backlog marked Complete |

**The ONLY unshipped change is the 2026-10-12 keymap trilogy.** Commit `8c5f870` synced the
spec documents (SPEC.md, PRD, ui-spec, architecture, implementation-plan, decisions.md) with
the explicit note *"No source moves; the living documents absorb the rulings in full."*
Verified gaps in source:

- `src/config.ts` — defaults still `deep: "ctrl+d"`, `overview: "ctrl+l"`, `focusText: "ctrl+t"`,
  `batchNote: "ctrl+shift+m"`, `discuss: "ctrl+shift+e"` (defaults block ~:111–116);
  `KeyAction` union still carries `"focusText"`; doc table (~:272–277) still shows chords;
  `digitQuickSelect` still exists (interface, default `true`, coercion, doc row).
- `src/panel/keys.ts` — no `h`/`j`/`k`/`l` handling anywhere; digit quick-select branch and
  `digit()` action still present (~:70–74, :103); intercept rule is single-tier
  ("config intercepts … valid whenever the panel is open, `focus === "text"` included", ~:11–19);
  elaborate (`onFocusText` ~:51, :475) and batch-note (~:116–117, :323) still close on re-press.
- `README.md` — STALE: usage prose (~:36–59) and sample config (~:139–143) still document the
  chords, `focusText`, and digit quick-select (`8c5f870` touched only `spec/`).

## 2. Scope

Implement the trilogy in source, sync code-level docs and README, stabilize the test suites.
One theme, no state-machine / lifecycle / rendering changes.

### R1 — BAREKEYS-001: bare-letter defaults, `elaborate` rename, two-tier intercept

1. **New defaults** (`src/config.ts`): `deep: "d"`, `overview: "o"`, `elaborate: "t"`,
   `batchNote: "m"`, `discuss: "e"`. `submit: "ctrl+s"` and `externalEditor: "ctrl+g"` stay
   modifier-bearing (submit must fire from text focus; externalEditor's only valid context is
   editor focus, where a bare key must type). `prevQuestion`/`nextQuestion` (`tab`/`shift+tab`)
   unchanged.
2. **Rename** `keys.focusText` → `keys.elaborate` everywhere: `KeyAction` union, defaults,
   coercion, keys.ts registry/actions, footer label resolution (D-R11 as amended). Compat:
   a settings file still carrying `keys.focusText` maps silently onto `elaborate`
   (deprecated alias — consistent with the codebase's tolerant-coercion posture); the name
   otherwise disappears from types and docs.
3. **Two-tier intercept rule** (`src/panel/keys.ts` — rewrite the "Mode A" doc block and the
   resolution-order step): modifier-bearing config values intercept in EVERY focus state
   including text/note (a chord is never a typed character); BARE config values (single
   printable char) and the fixed `h`/`j`/`k`/`l` intercept ONLY from non-editor focus and
   always forward to the embedded editor while `focus === "text" || "note"` — typing `t` in
   an answer must insert a `t`.
4. **Gesture removal**: the re-press-to-close toggles for the elaborate and note prompts die
   (a re-press while focused would insert the letter). Closes are `enter` and double-`esc`
   (ESC-002, `escExitWindowMs`) only. While the editor holds focus the footer drops (not
   swaps) the `{elaborate} explain` hint — bare keys never intercept there.

### R2 — VIMNAV-001: `h`/`j`/`k`/`l` join the fixed family

- `h`/`j`/`k`/`l` become fixed (not configurable) aliases of `←`/`↓`/`↑`/`→`, handled in the
  SAME fixed branch as the arrows: identical view-aware semantics — short view: option cursor
  (`j`/`k`, domain includes the ✎ Other row) + question navigation (`h`/`l`, full list,
  clamped, no wrap); deep view: selection; overview: cursor row — and identical editor-focus
  forwarding (printable keys never intercept while the embedded editor holds focus; they type).
- `k`/`j` are checked with `↑`/`↓` in the same branch; `h`/`l` with `←`/`→`.

### R3 — DIGIT-OUT-001: digit quick-select removed entirely

- Delete the digit quick-select path: keys.ts resolution-order digit branch and `digit()`
  action, the actions.ts digit routing (`acceptOptionIndex(panel, q, n - 1)`), the
  `digitQuickSelect` config field/default/coercion/doc row. Digits are inert at panel level —
  they only ever type, where typing is possible. Purge digit-accept residue from code comments
  (FR-35/ANSWER-PIN-001 "enter or a digit" phrasing) — the same-value no-op remains an `enter`
  behavior.

### R4 — Sync changeset-level documentation (Mode B; depends on R1–R3)

- `README.md`: rewrite the usage keymap prose (~:36–59) and the sample `settings.json` block
  (~:139–143) to the new contract — bare letters, fixed-family exception (arrows + `hjkl`,
  `enter`, `esc`, `ctrl+c`), `elaborate` naming, no digit quick-select, two surviving chords
  with their reasons. Verify no `focusText`/`digitQuickSelect`/chord references remain
  (`grep -n "ctrl+t\|ctrl+d\|ctrl+l\|focusText\|digit" README.md` → zero).
- **Spec files (`spec/*.md`) are ALREADY synced by `8c5f870` — do not re-edit** unless
  implementation reveals a spec error (then report it, don't silently diverge).

**Modified/removed requirements (awareness):** FR-8 (default `d`; stay-deep landing shipped),
FR-11 (`o`), FR-12 (`t`, `keys.elaborate`), FR-13 (`m`), FR-35 (digit parenthetical removed),
commitment 7 / R5 ("all NON-fixed hotkeys configurable"; fixed family documented), AC-2b/AC-12
wording. All spec-side edits landed; this delta closes the implementation gap only.

## 3. Acceptance criteria

1. From non-editor focus: `d` toggles deep, `o` overview, `t` elaboration duty, `m` note mode,
   `e` discuss handoff. While the editor holds focus: each of those letters TYPES into the
   buffer; `ctrl+s` still submits from text focus; `ctrl+g` still opens `$EDITOR`.
2. `h`/`j`/`k`/`l` navigate per view (short: options/questions; deep: selection; overview:
   cursor row), clamp at the ends, and type while the editor is focused; they appear nowhere
   in the config schema (fixed, like the arrows).
3. Pressing `1`–`9` at panel level does nothing (no accept, no advance, no state change);
   digits insert normally inside the editor; `digitQuickSelect` is absent from the config
   schema and settings load.
4. A settings file using `keys.focusText` still binds the elaboration key (compat alias);
   `keys.elaborate` drives the action and the footer label; `focusText` is gone from types,
   doc tables, and README.
5. Re-pressing `t`/`m` while the editor is focused types the letter (no toggle); elaborate
   and note prompts close via `enter` or double-`esc` only.
6. Gates: full `npm test` suite green; `npm run typecheck` green; `src/no-hardcoded-keys.test.ts`
   and `src/keymap-guard.test.ts` green with the new defaults; keymap-conflict re-verification
   recorded in the PR notes (bare letters collide with nothing — the panel owns the whole
   keyboard while open; no global shortcut exists).

## 4. Non-goals

- No changes to the fixed keys' configurability beyond the documented family; no new actions;
  no auto-submit / gate / surfacing / state-machine / persistence changes.
- No deep-view, renderer, or delivery work (shipped — §1 table).
- No `spec/*.md` edits (already synced).
- No re-verification of the eleven shipped rulings beyond the suite staying green.

## 5. Prior research

`plan/003_f8af1c6f6c49/architecture/` — `panel-ui-seams.md` documents the keys.ts resolution
order and actions registry patterns (verified 2026-10-05; line anchors have drifted — locate
by content). `testing-verification.md` §Green-gates still applies verbatim (full suite,
typecheck, no-hardcoded-keys, keymap-guard). Affected suites (~10+, grep-verified):
`config-surface`, `config`, `keymap-guard`, `no-hardcoded-keys`, `panel/keys`, `panel/actions`,
`panel/panel`, `panel/ac-panel`, `panel/layout`, `panel/overview`, `panel/discuss`, and any
suite pressing `ctrl+t`/digits in scripted flows.

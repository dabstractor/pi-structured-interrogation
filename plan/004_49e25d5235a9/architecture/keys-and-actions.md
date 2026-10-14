# Keys & Actions — architecture map (plan 004, HEAD 182f4ce)

Read-only research for R1 BAREKEYS-001 / R2 VIMNAV-001 / R3 DIGIT-OUT-001. All line numbers real at HEAD.

## 1. Intercept rule today (verbatim doc block, keys.ts:11-19)

> ```
> ## Mode A — the intercept rule (h2.34)
> ```
> (keys.ts ~line 11 onward)
>
> The panel owns raw keyboard focus (via `ctx.ui.custom()` —
> questionnaire.ts pattern), so pi's own keybinding layer never sees these
> keystrokes. Panel-level keys are therefore intercepted BEFORE any
> forwarding, and this INCLUDES text focus: `ctrl+s` submit while the user
> types in the embedded free-text field must submit, not insert a control
> char. Concretely, the config-driven intercepts in step 4 of the resolution
> order are valid whenever the panel is open, `focus === "text"` included.
> The one fixed-key exception is `enter` (see below).

Fixed-keys block (keys.ts:21-48) states up/down/left/right/esc/enter are fixed, arrows checked before esc (ESC-prefix), ←/→ NOT intercepted in text/note focus, enter forwards in text focus, editor-focus forwarding (ESC-002: up/down + single esc forward; double-esc within `escExitWindowMs` closes prompt via exitTextField/exitNoteMode; ctrl+t toggle is the single-key companion).

## 2. Resolution order (as coded, keys.ts buildKeyRouter, 355-523)

1. `panel.isResolved()` guard → false (362).
2. `editorFocused = focus === "text" || "note"` (367); non-esc input clears `panel.lastEscAt` (372).
3. **Fixed ↑/↓** (382-391): `!editorFocused && matchesKey(data, Key.up/down)` → ONE view-switch per key: `overviewUp/overviewDown(panel)` (overview), `deepSelectionUp/Down(panel)` (deep), else `actions.optionUp/optionDown(panel)`.
4. **Fixed ←/→** (401-410): gated `focus !== "text" && !== "note"` → overview: `overviewUp/Down`; else `actions.prevQuestion/nextQuestion`.
5. **Fixed esc** (419-435): options focus → `escapeDescend(panel)` + true; editor focus → double-esc window check (`escWindow>0 && lastEscAt && now-lastEscAt<=escWindow`) → `escExitEditor(panel)`; else set `lastEscAt`, `return false` (single esc forwards).
6. **Fixed enter** (446-450): `focus !== "text"` only (note focus still intercepted); overview `overviewJump`, deep `acceptFromDeep`, else `actions.accept`.
7. **Config intercepts** (455-506), collision order: `b.deep` → onDeep; `b.overview` → onOverview; `b.focusText` → onFocusText (gated: `view === "short" && focus !== "note"`, BUG-011 block 463-471); `b.batchNote` → onBatchNote; `b.submit` → submit; `b.discuss` → onDiscuss; `b.externalEditor` (gated `focus === "text"`); `b.prevQuestion`/`b.nextQuestion` (view-aware: overview → `overviewUp/Down`).
8. **Digit quick-select** (508-519): `config.digitQuickSelect && view !== "overview" && focus !== "text" && focus !== "note"`, `parseKey(data)` in "1".."9" → `actions.digit(panel, Number(k))`.
9. **No match → return false** (523) — forwards.

Bindings resolved ONCE in `buildKeyRouter` via `resolveBindings` (171-188; `parseAccelerator` 137-159 validates/normalizes to KeyId; invalid → default + one console.warn). Doc-comment resolution order block lives at keys.ts:60-76 (lists digits 1-9 as step 4 tail — purge site).

## 3. Fixed arrow branch structure & where hjkl slots in

ONE centralized branch family per arrow direction with inline view-switch if/else calling named per-view fns:
- up/down (382-391): `overviewUp`/`overviewDown` (overview.ts), `deepSelectionUp`/`deepSelectionDown` (deep-view.ts), `actions.optionUp/optionDown` (short incl ✎ Other row via short-view cursor).
- left/right (401-410): `overviewUp/Down` in overview, `actions.prevQuestion/nextQuestion` (clamped stepQuestion, no wrap).

VIMNAV-001 slot-in: add `matchesKey(data, Key.up) || parseKey/equals "k"` etc. into the SAME conditions (e.g. `if (!editorFocused && (matchesKey(data, Key.up) || isBareKey(data,"k")))`) — identical gates & dispatch, or a shared helper. h/l slot into the 401 block's key tests.

## 4. Editor-focus forwarding mechanism

There is no explicit `editor.onKey`/keyfeed call in keys.ts. Forwarding = `return false` from the router; `panel.ts`'s handleInput site hands the raw byte to the embedded editor (composed pi editor via `getEditorComponent()` — pi-vim works). Gating is by `editorFocused` flag (367) for ↑/↓/esc-single and explicit `focus !== "text"/"note"` checks for ←/→, enter, digits. Bare keys today DO intercept in text focus (e.g. ctrl+t, ctrl+g, and any bare config key like discuss) — BAREKEYS-001 changes step 7 to tier on modifier presence.

## 5. Digit sites (all `grep -rn digit src --include='*.ts' | grep -v test` hits)

- src/panel/keys.ts:70-74 — doc resolution-order comment (digit wording, purge); 93 — JSDoc mention; 103 — `RoutedActions.digit` iface; 132 — SINGLE_CHAR_BASES comment ("digits" in charset — KEEP, grammar); 260 — JSDoc; 276 — desiredTextDuty comment "digit quick-select never selects that row" (purge); 300 — defaultRoutedActions digit delegate; 351 — JSDoc; 508-519 — the dispatch branch (delete).
- src/panel/actions.ts:76 — `PanelActions.digit` iface; 185-208 — `digit()` implementation (quoted: `if (!panel.config.digitQuickSelect) return false; if (!Number.isInteger(n) || n<1 || n>9) return false; ... if (n-1 >= (q.options?.length ?? 0)) return false; ...` routes via `acceptOptionIndex(panel, q, n-1)`); 263-264, 269, 273, 285, 288, 294, 297 — comments in the shared accept path; **297 "ANSWER-PIN-001 / FR-D9: enter (or digit) on the ALREADY-RECORDED value" — FR-35 'enter or a digit' phrasing, purge**; 912 — registry export `digit,`.
- src/panel/panel.ts:541 — JSDoc "actions read digitQuickSelect off it".
- src/panel/short-view.ts:48, 77, 100 — comments mentioning digit select / "digit-selectable" / "digit quick-select (1..9)" (purge).
- src/config.ts:80, 123, 222, 287 — `digitQuickSelect` field, default `true`, coerce, config table row (delete all; invalidates `InterrogatorConfig` consumers incl. actions.ts:195 and panel.config reads).
- src/detect.ts:53 — unrelated (digit in prose detection regex; KEEP).
- Footer/other 'enter or a digit' comment sites: actions.ts:297 (only one found).

## 6. Elaborate & note re-press toggles + close paths

- Elaborate: keys.ts:472-479 intercept (short + not note) → `actions.onFocusText`. Default (keys.ts:319-321) just sets `focus="text"`, but panel.ts:645-648 OVERRIDES: `routed.onFocusText = (p) => { if (p.focus === "text") p.exitTextField(); else p.focusTextField(desiredTextDuty(p)); }` — the re-press-close toggle to remove (keep only the entry arm). `desiredTextDuty` (keys.ts:288-294): writein if type text or cursor on ✎ Other row, else elaboration. Open = `panel.focusTextField(duty)` (panel.ts:1185, draft seeding). Closes remaining: `enter` (per-duty save/commit inside editor) and double-esc → `escExitEditor` (keys.ts:236-242) → `panel.exitTextField()` / `exitNoteMode()`.
- Batch note: keys.ts:480-483 → `onBatchNote` (keys.ts:322-328): `if (p.focus === "note") p.exitNoteMode(); else p.enterNoteMode();` — toggle to flatten to open-only (bare `m` must type while focused). Open = `enterNoteMode` from any focus/view.
- Enter/esc/ctrl+c: see §2 steps 5-6; `escExitWindowMs` default 500 (0 disables) — escExitEditor is gesture-removal-safe (independent of re-press toggles). ctrl+c: not in keys.ts — handled at panel level (CTRL-C-001, spec ui-spec:43).

## 7. Footer label resolution & current editor-focus behavior

- Labels: `resolveKeyLabels(config)` (h2.52, memoized per panel — panel.ts `this.labels`); `KEY_LABELS`/`ACTION_WORDS` maps in layout.ts (63: "Human word for each KeyAction"). layout.ts:67 `focusText: "text"` label entry — rename target for `elaborate`.
- Hint construction: `renderFooter` (layout.ts ~478-530). Short screen: `hints.unshift("enter accept")` (500) and `hints.push(\`${labels.focusText} explain\`)` — D-R11 (501). Statics set at 510 includes the explain hint.
- CURRENT editor-focus behavior: `panel.ts:1387` `const editorExit = this.focus === "text" || this.focus === "note"` → passed to renderFooter (1401). layout.ts 511-521: SWAPS (not drops) — filters out screen statics incl `{focusText} explain`, pushes "enter save", "esc esc back" (if escEscHint), and `${labels.batchNote} close` (note) or **`${labels.focusText} close` (text)** — i.e. today the footer *replaces* the explain hint with a toggle-close hint. BAREKEYS-001 wants: explain hint DROPPED entirely (never shown while editor focused), no toggle-close hint.

## 8. SPEC contract quotes

### ui-spec.md (grep hits)
- :70 — Intercept rule two tiers (BAREKEYS-001): "**Intercept rule — two tiers**: panel-level keys are intercepted *before* the embedded editor sees them, whenever the panel is open. Modifier-bearing config keys (`ctrl+s`, `ctrl+g`) intercept even in text focus — a chord is never a typed character. BARE config keys (`d`, `o`, `t`, `m`, `e`) and the fixed `h`/`j`/`k`/`l` are PRINTABLE: they intercept only from NON-editor focus and always forward while the editor holds focus (typing `t` in an answer must insert a `t`) — the same gating the removed digit quick-select followed (DIGIT-OUT-001)." + fixed-while-editor-focused ESC-002 wording (↑/↓ + single esc forward) + R5-as-amended fixed family (`↑↓←→`+`hjkl`, `enter`, `esc`, `ctrl+c`).
- :84 — externalEditor row: "`ctrl+g` | editor focus (any duty) — MUST stay modifier-bearing ... a bare key would have to type, never act (BAREKEYS-001)".
- :88 — "Digit quick-select (1–9) is REMOVED (DIGIT-OUT-001, 2026-10-12) ... The `digitQuickSelect` toggle is deleted; digits are inert at panel level."
- :92 — conflict-avoidance incl bare-letter defaults `d o t m e` + fixed `h j k l`.
- :94 — fixed-key notes: "`k`/`j` are checked in the same fixed branch as `↑`/`↓` — identical view-aware semantics and identical editor-focus forwarding (VIMNAV-001)"; ←/→ & h/l full-list clamped no-wrap.
- :116 — footer: "short-view footer permanently carries `{elaborate} explain` (resolved via `keys.elaborate`, default `t`) ... first casualty of the narrow-width right-to-left drop loop, and **dropped (not swapped)** while the editor holds focus".
- :34 (defaults/use): `keys.elaborate` default `t`, "renamed from `focusText` — BAREKEYS-001"; :43 exit gestures: enter + double-esc; "The third gesture — key re-press — died with the bare-key defaults (BAREKEYS-001)". :62 note: "no re-press close — a bare `m` while the editor holds focus must type". Defaults table (near :80s): d deep, o overview, t elaborate, m batchNote, e discuss, ctrl+s submit, ctrl+g externalEditor.

### decisions.md 2026-10-12 (:112-116)
- VIMNAV-001: hjkl join FIXED family as aliases of ←↓↑→, identical semantics + identical editor-focus forwarding; fixed, not configurable.
- BAREKEYS-001: defaults lose chords — `d` deep, `o` overview (moved off `l`), `t` elaborate, `m` batch note, `e` discuss. Two surviving chords + reasons: **`ctrl+s` submit** ("submit must fire from text focus — a bare `s` could never be typed") and **`ctrl+g` external editor** ("only valid context is editor focus, where a bare key must type — a bare `g` would be permanently unpressable"). Consequences: (a) two-tier intercept; (b) re-press-close toggles for elaborate/note gone — closes stay `enter` and double-`esc`; (c) `keys.focusText` renamed `keys.elaborate`.
- DIGIT-OUT-001: digit quick-select + `digitQuickSelect` toggle removed entirely; redundant with hjkl+enter; stray digit = accidental-answer footgun; supersedes FR-35 parentheticals, D-R13 display-position clause minus digit mention, ui-spec hotkey row.

### product-requirements.md FRs (current wording, :33-39, :74)
- FR-8 (:34): "One toggle (default `d`) opens the deep view ... `enter` selects and advances ... STAYS in the deep view while the toggle is sticky (DEEP-STICKY-ADVANCE)."
- FR-11 (:37): "Overview list (`o`): all questions with status markers ...; `enter` jumps."
- FR-12 (:38): free text via composed editor, write-in vs elaboration duties; "`t` (`keys.elaborate`, renamed from `focusText` — BAREKEYS-001) attaches the draft to the selected option at submit ... never answers alone"; enter commits; `shift+enter`/`ctrl+j` newline; `ctrl+g` $EDITOR; single esc + arrows forward while focused.
- FR-13 (:39): "Batch note (hard requirement R3): `m` opens a note field at any time (non-editor focus — BAREKEYS-001); the note is held and delivered as a `NOTE:` line with the next submission."
- FR-35 (:74): recorded answer owns the caret; includes "(caret moved to another row, changed write-in text)" — no 'enter or a digit' phrasing found in FR-35 body at HEAD (already purged in spec; the phrasing lives only in code comments, actions.ts:297). R5 note (:77): fixed family — arrows + hjkl, enter, esc, ctrl+c exempt.

## 9. Anomalies vs the planned change

1. keys.ts module JSDoc (11-19, 60-76) still documents the ONE-tier intercept and the digit step — full doc-comment rewrite needed with the two-tier rule.
2. keys.ts:418 comment says "close via the ctrl+t toggle or enter" — gesture wording to purge (escWindow=0 note).
3. keys.ts:276 desiredTextDuty comment cites digit quick-select — stale after DIGIT-OUT-001.
4. panel.ts:645-648 host override carries the elaborate re-press toggle; keys.ts default onFocusText (:319) does not — removal must hit the panel.ts override (or push entry-only semantics down).
5. layout.ts:510-521 currently SWAPS the explain hint for `{focusText} close` / `{batchNote} close` while editor-focused — spec:116 requires DROP; the `FooterEditorExit.mode` close-toggle hints also die with the gesture removal.
6. config.ts still has focusText naming, digitQuickSelect (4 sites) — rename + delete cascade: KeyAction union (:51), DEFAULT order (:96, :113), config table (:274, :287), plus layout.ts:67 label map, keys.ts b.focusText sites (475, 501-layout), panel.ts:439/:1156 comments, config.ts:296 "close via the focusText toggle" comment.
7. Digit config plumbing (`panel.config.digitQuickSelect`, actions.ts:195) removal touches `InterrogatorConfig` consumers; short-view.ts:48/77/100 and keys.ts doc comments carry stale digit mentions.
8. keys.ts:446 enter gate is `focus !== "text"` — note focus enter is intercepted before the editor (spec :43: per-duty enter save — verify intended after change; unchanged by plan).
9. No ctrl+c branch exists in keys.ts — handled elsewhere (panel level); plan's gesture removal must not touch it. Confirmed consistent with CTRL-C-001.

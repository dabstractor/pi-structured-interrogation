# Spec coherence verification — P1.M3.T2.S2 (changeset 001_5dde9b4d7329)

Per bug001-writein-supersede.md §(b): the three contract texts were never wrong —
the code was — and the RESTORE path (ruling WRITEIN-002-RESTORE-001) makes them
true again without edits. This record is the closing proof: verification with
**ZERO spec edits** (the expected outcome held). Navigated by quoted text;
src anchors re-located by grep at verification time.

## (a) WRITEIN-002 staged-slot-kept semantics — VERIFIED AS-IS

**spec/ui-spec.md:37** (verbatim present):
> "**Draft role follows the selection (WRITEIN-002).** … If a write-in is later
> superseded by accepting a real option, the slot's text is KEPT (R4 — never
> destroyed) and re-binds as elaboration for the new selection; it attaches at
> the next submit."

Implemented reality (all anchors re-verified):
- `stageSupersededWriteIn` — exported, src/panel/actions.ts:367; called at BOTH
  apply sites: `acceptOptionIndex` actions.ts:332 (after applyAnswer) and
  `applyConfirmedEdit` src/panel/ripple-confirm.ts:165. Four guards live inside
  the helper (ripple-confirm.ts:164 comment names them: custom-only, non-blank,
  no kind-flip, user-draft wins) and are regression-pinned (see (c)).
- Staged slot behaves as an ordinary VISIBLE draft (bug001 dossier :191 ruling):
  it is a real draft via `panel.commitTextDraft`/`draftTextFor` — ✎ marker
  lights, editor seeds from it, user can edit/clear before submit; guard-4
  (`draftTextFor !== undefined`) honors a deleted-to-empty slot as user-held.
  The ui-spec line's "KEPT (R4 — never destroyed)" wording matches; no amendment
  needed.
- "Attaches at the next submit": `reconcileDraftsForSubmit` (actions.ts:619)
  kept-slot attach branch intact — `status === "answered" && answer.custom !==
  true` → attaches the slot text as `answer.text`; runs inside the submit
  pipeline ahead of the pending count, so the same-gesture auto-submit on an
  already-complete set ships the re-bound elaboration (bug001 dossier :227
  flags this as intended-per-contract; AUTOSUBMIT rule b). Regression-pinned by
  `test_supersede_writein_same_gesture_auto_submit_ships_rebound_elaboration`
  (actions.test.ts:2602, P1.M1.T4.S3).
- **ui-spec.md:135** zero-pending flash (held-elaboration naming):
  "`nothing to submit — {n} question(s) have drafts awaiting an option or Other`
  (WRITEIN-002 held-elaboration guidance)" — unchanged by this changeset; a
  staged post-supersede slot on an unanswered question is counted by the same
  `draftTextFor` read, consistent. No drift.

**(b) Hotkey table external-editor row — VERIFIED AS-IS**

**spec/ui-spec.md:84** (verbatim present):
> "| external editor | `ctrl+g` | `keys.externalEditor` | editor focus (any
> duty) — MUST stay modifier-bearing … (BAREKEYS-001) |"

Implemented reality: the widened gate landed — src/panel/keys.ts:426
`const editorFocused = panel.focus === "text" || panel.focus === "note";`;
routing at keys.ts:563–571 gates on `editorFocused` with the comment "any duty
(write-in, elaboration, note … ui-spec 'editor focus (any duty)') — in BOTH
text and note duty"; note-duty completion routes to the batch note (P1.M2.T1.S1).
The row's "any duty" matches. No other spec file scopes ctrl+g to
text-focus-only (grep below).

`grep -rn "text focus" spec/` — 3 hits, all judgment-checked CLEAN:
1. **decisions.md:115 (BAREKEYS-001)** — "submit must fire from text focus …
   externalEditor's ONLY valid context is editor focus, where a bare key must
   type" — this is the pin that KEEPS ctrl+g modifier-bearing and scopes it to
   editor focus; the opposite of a stale text-focus-only scope. Keep.
2. **ui-spec.md:70 (intercept rule)** — "Modifier-bearing config keys (`ctrl+s`,
   `ctrl+g`) intercept even in text focus — a chord is never a typed character."
   Consistent with the widened gate (chords fire anywhere, incl. editor focus).
   Keep.
3. **ui-spec.md:82 (submit row)** — "panel including text focus" — describes
   `ctrl+s`/`keys.submit`, not ctrl+g. Keep.

## (c) decisions.md:125 WRITEIN-002-RESTORE-001 cross-ref audit — ALL RESOLVE

| Ruling reference (as cited) | Implemented reality (re-verified file:line) | Status |
|---|---|---|
| `src/panel/actions.ts` `stageSupersededWriteIn` exported helper | actions.ts:367, exported, signature `(panel, questionId, superseded, newValue)` | ✓ resolves |
| four guards (custom-only / non-empty / not byte-equal / no user-held slot via `draftTextFor`) | in the helper's guard chain, actions.ts:367+; tests at :900/:911/:919/:929/:937 | ✓ |
| wired at `acceptOptionIndex` (ruling: "~:313, after applyAnswer") | actions.ts:332, after `applyAnswer` | ✓ (anchor drifted as the ruling anticipated; symbol + position-after-applyAnswer hold) |
| wired at `applyConfirmedEdit` (ruling cites ripple-confirm.ts:142-166) | ripple-confirm.ts:165, inside `applyConfirmedEdit` | ✓ |
| `reconcileDraftsForSubmit` kept-slot attach branch (ruling: "actions.ts:573-578 … always correct") | actions.ts:619; attach branch present and unchanged in spirit (`answered` + `custom !== true` → `applyAnswer({...answer, text})`) | ✓ |
| `consumeCommittedBuffer` protections unchanged (ruling: "panel.ts:982-991, wired at actions.ts:409/:460 and ripple-confirm.ts:305") | panel.ts:982 consume-at-commit intact; wired actions.ts:465, :516 and ripple-confirm.ts:312; never re-arms (consume happens BEFORE advance / after commit only) | ✓ (wiring anchors drifted; symbol + consume-at-commit semantics hold) |
| rewritten supersede regression test, P1.M1.T3.S1 (ruling: "actions.test.ts:2213 … manual re-staging at :2223 becomes regression proof once deleted") | actions.test.ts:889 `test_supersede_happy_path_stages_writein_text_as_draft` + guards :900/:911/:919/:929/:937 + modal-path tests :2441 (`test_supersede_modal_esc_stages_nothing_and_keeps_state`) and ripple-confirm supersede region; the manual re-staging is gone — the behavior is now produced by the shipped helper | ✓ |
| same-gesture auto-submit attach (P1.M1.T4.S3) | actions.test.ts:2602 `test_supersede_writein_same_gesture_auto_submit_ships_rebound_elaboration` | ✓ |

**Historical anchors policy:** the ruling's inline pre-changeset anchors
(actions.test.ts:2213/:2223, actions.ts:409/:460/:573-578, ripple-confirm.ts:305,
panel.ts:982-991) are quoted as history and left untouched — every cited FILE
and SYMBOL still exists, so no annotation was forced.

**AC-2b cross-check:** spec/product-requirements.md:84 tail — "accepting a real
option after a committed write-in keeps the slot's text as elaboration
(WRITEIN-002)" — verbatim-present, satisfied by the same implementation. ✓

## Contradiction sweep (BUG-003 stale-caps surface)

`grep -rn "capped at 400\|400-char\|caps engine" spec/` — 3 hits, all
deletion-framed HISTORY, zero live-cap claims:
1. **decisions.md:107 (CAPS-OUT-001)** — "the caps engine is DELETED … Deleted
   wholesale: caps.ts …" — the ruling recording the deletion. History. CLEAN.
2. **product-requirements.md:53 (FR-23)** — "NO CAPS (CAPS-OUT-001 …): the caps
   engine, the caps config block, and the minimum-floor lints are deleted." —
   an FR asserting the ABSENCE of caps. CLEAN.
3. **tool-protocol.md:73** — "(The former caps engine — …)" — removal note
   pointing at verbatim passthrough. CLEAN.

No FR/AC/ui-spec line asserts a live cap. **CLEAN.**

## Verdict

- (a) ui-spec.md:37 + :135 — **verified-as-is** (0 edits)
- (b) ui-spec.md:84 — **verified-as-is** (0 edits; all "text focus" hits clean)
- (c) ruling cross-refs — **all resolve** (0 edits; historical anchors untouched)
- BUG-003 caps sweep — **clean**

Zero spec amendments were forced; the restore strategy's premise ("the spec
texts become true again without edits") is confirmed against the implemented
tree.

## Gates

- `npm test` → 47 files, **1337 passed**.
- `npx tsc --noEmit` → clean (zero source edits).
- `git diff --stat` → spec/*.md only (spec/SPEC.md — a sibling subtask's
  artifact; README.md is S1's parallel surface) + the orchestrator's own
  tasks.json change. No src/, no tests, no plan/ metadata touched by this task.

# Research notes — P1.M1.T6.S1 (README.md: revisit usage + AC-16)

Verified 2026-10-05 against working tree at commit `4e17456` (README clean, no uncommitted changes).

## README.md anatomy (29,007 bytes)

```
1    # pi-interrogator
11   ## Install
30   ## Usage            ← EDIT SPOT 1 (numbered steps 1–5; step 2 = answering, ends line 47)
117  ## Configuration    ← DO NOT TOUCH
170  ## Keymap           ← DO NOT TOUCH (verified: no ★/preselect claims; ←/→ row is revisit-consistent)
248  ## Acceptance criteria (spec)  ← EDIT SPOT 2 (summary list, ends at 15 today)
275  ## Limitations      ← DO NOT TOUCH
296  ## Development
387  ## Project structure
```

## Edit spot 1 — Usage, step 2 (ends at line 47)

- Exact ending text: "   in the write-in duty — `ctrl+t` is not the only entry." (line 47, unique anchor).
- Step 2 describes answering mechanics; revisits/pinning are currently undocumented anywhere in Usage.
- Step 3 (line ~48) covers submission incl. "an edit made while the set is already complete ships immediately too" — mentions edit shipping but NOT how edits are made (explicit different choice / confirm). The revisit sentence complements it; place in step 2.
- Usage prose is hard-wrapped at ~75–80 cols (3-space continuation indent for list items). New prose must match.
- No ★ / preselect / recommendation / caret claims exist elsewhere in Usage, Configuration, or Keymap (verified by grep — only hits: keymap `↑ ↓` editor-caret row, `← →` prev/next row, dev note line 322). No contradictions to fix or avoid.

## Edit spot 2 — Acceptance criteria summary (lines 248–273)

- Preamble (lines 250–253): "The acceptance list lives in [`spec/product-requirements.md`](spec/product-requirements.md); this delta / extends it to 2a–2d and 15. Summary (scripted where possible — see the spec / for the full text and the scripted tests proving each):" → line 252 must become "extends it to 2a–2d, 15 and 16." (note: en-dash `–` in `2a–2d`, markdown link on line 251 must stay intact).
- Entries 1..14 plain; 2a–2d and 15 use the format `N. **Label (TAG)**: condensed spec text.` Entry 15 (line 273, single line, 176 chars) is the style model for AC-16.
- **AC entries are single unwrapped lines** (verified lengths 67–233 chars) — AC-16 goes on ONE line, unlike wrapped Usage prose.
- List currently ends at 15; `## Limitations` follows at line 275 (blank line 274).

## Binding source extracts

### AC-16 (spec h2.10, verbatim)

> **Answer pinning (ANSWER-PIN-001)**: answer q1 with a NON-recommended option, advance, `←` back → caret + accent highlight sit on the chosen option (★ visible on its own row, caret NOT on it); `enter` advances to the next unanswered with zero state change (no modal, no epoch bump, no `answer.at` rewrite). A write-in answer pins the caret to the `✎ Other` row with its dim preview; a byte-identical write-in re-commit is inert. Choosing a DIFFERENT option on the answered question still raises the FR-18 confirm.

### FR-35 clauses the Usage sentence must cover (item contract)

1. caret sits on the recorded answer in every view;
2. `enter` on it just advances;
3. changing an answer requires an explicit DIFFERENT choice, which raises the invalidation confirm.

### FR-18 confirm user-facing string (verified in code, src/panel/ripple-confirm.ts:14, layout.ts:129, ac-panel.test.ts:545)

`⚠ Invalidates {n} answered questions ({ids}) — enter=keep, esc=cancel`

Nuance: the confirm fires only when the different choice invalidates dependent answered/submitted questions via `dependsOn` — the sentence must scope it that way ("a change that invalidates dependent answered questions"), not imply every different choice confirms.

## Landed changeset this README sync documents (all Complete per plan_status)

| Piece | Commit | Note |
|---|---|---|
| FR-D8 cursor seeding pins to recorded answer | `1fba337` | initialCursorIndex + seed sites (`886489c` docs) |
| FR-D9 inert same-value commits | `d6d1553` (accept), `2d7a98f` (write-in), `4a9d477` (deep view) | |
| FR-D10 ★ answered marker on question line | `7972f88` | statusMarkers, overview parity |
| Spec-verbatim schema string | `6fd79f9` | tool-schema.ts:62 — agent-facing, NOT user docs |
| Comment sweep | `f3e00c5`, `4e17456` | |
| T5.S9 panel suite flips | in flight (parallel) | test-only, no README overlap |
| T5.S10 AC-16 scripted test | planned | test-only, no README overlap |

## Parallel-work contract (P1M1T5S9/PRP.md)

Test-only edits confined to `src/panel/*.test.ts`; its "out of scope" list explicitly hands the README update to this item (T6.S11). No file conflicts. Because panel suites are being edited concurrently, this docs task must NOT gate on `npx vitest run` results.

## Deliberate exclusions (reasoning)

- Keymap `←`/`→` row (README:194): already says "Previous / next question — the FULL list (every status navigable…)" — accurate under pinning; contract forbids touching it anyway.
- Configuration / Limitations / Development / Project structure: nothing in this delta changes them (contract).
- ★ answered question-line marker (FR-D10): README Usage does not legend status glyphs anywhere (overview markers ⟳⊘⊗★ are undocumented too); AC-16's "★ visible on its own row, caret NOT on it" covers the visible star semantics. Adding a glyph legend to Usage would be new practice + risks conflating the question-line answered ★ with the option-row recommendation ★. Excluded.
- Schema recommendation description (T1.S3): agent-facing text in tool-schema.ts; README's "Model behavior note" makes no preselect claim, so no edit needed there.

# Delta PRD — pi-interrogator: transcript cards, footer discovery, mnemonic keys, deep editor, sanitize, required descriptions

**Driver:** spec commits `d18bc39` (side-chat sync = previous PRD) → HEAD `7377318`. The delta is SMALL and surgical: ~49 insertions / 33 deletions across 6 spec files, carrying six rulings — FULL-TRANSCRIPT-001 (2026-10-19), FOOTER-001 (2026-10-16), KEYMNEMONICS-001 + its lowercase-hints amendment (2026-10-19), SANITIZE-001 (2026-10-17, inline pin), DEEP-EDITOR-001 (inline pin), and the `description`-REQUIRED tool-schema change (owner ruling 2026-10-20, "bare prompts rejected").

## Diff analysis (previous PRD → current PRD)

The spec diff (`git diff d18bc39..HEAD -- spec/`) bundles six changes. **All six are ALREADY IMPLEMENTED IN SOURCE at HEAD `7377318`** — verified by direct source inspection and a full green suite (54 files / 1624 tests / 7.2s). Cite, do not rebuild:

| Ruling | Shipped by | Evidence at HEAD |
|---|---|---|
| SANITIZE-001 (one line = one terminal row) | `1952841` | `sanitizeDisplayText` at the `truncateVisible`/`wrapText` choke points + footer composition (`src/panel/layout.ts`, 5 refs); `src/panel/sanitize-display-text.test.ts` |
| DEEP-EDITOR-001 (`e`/write-in editor works in deep view, pinned below the pane) | `fd07f1e`, refined `fe81962` | `src/panel/deep-view.ts` + `panel.ts` host editor; `deep-view.test.ts:1075–1106` (`enter` on ✎ Other opens write-in in deep, stays deep; `e` opens elaboration below the pane) |
| FULL-TRANSCRIPT-001 (cards render user input in full, both modes) | `d59372a` | `snapshots.ts:77` exported `transcriptPrompt`; called at `snapshots.ts:292` (`computeEntries`), `delivery.ts:478` (`CompletionRecapEntry.prompt`), `panel/actions.ts:911` (BUG-002 synthetic-entry mirror); `COLLAPSED_LINE_BUDGET`/`COLLAPSED_ENTRY_CAP` zero matches (deleted); renderers dedupe defensively |
| FOOTER-001 (footer advertises features, never key mechanics) | `231f365` | per-screen action sets in `layout.ts`; enter/esc statics deleted; editor-focus collapse to the `ctrl+s`/`ctrl+g` chords; chat footer state-invariant `/clear` |
| KEYMNEMONICS-001 + amendment (defaults `d`/`i`/`c`/`e`/`n`; bare-letter labels lowercase verbatim) | `a2f1d70`, `4507f31` | `config.ts:120–124` defaults `overview:"i"`, `elaborate:"e"`, `batchNote:"n"`, `chat:"c"`; `resolveKeyLabels`/`labelFor` in `layout.ts` (h2.52); legacy NAME aliases (focusText→elaborate, discuss→chat) unaffected |
| `description` REQUIRED (bare prompts rejected) | `7377318` | `tool-schema.ts:59` `Type.String({ description: "REQUIRED — never omit. …" })` + parse-level structured error for absent/blank/non-string (`tool-schema.ts:360–377`, owner ruling 2026-10-20); fixture/test sweep across `guards.test.ts`, `ac-scripted.test.ts`, `debug-commands.test.ts`, `delivery.test.ts` |

Non-goal deltas: none. Removals: none in code (the deleted statics/caps above are part of shipped rulings). The spec carries two cosmetic fossils the implementation must NOT copy: AC-2b and M8 prose still say the elaborate key is `` `t` `` — the shipped tests correctly use the resolved default (`e`); treat `` `t` `` as stale prose, and never assert it.

## This delta — the unshipped remainder

One residue only:

1. **Refresh the keymap-conflict re-verification record** (Mode B). The KEYMNEMONICS-001 changeset introduced three new default letters (`i` list, `c` chat, `n` note) but the README's "Keymap conflict re-verification" record still cites the 2026-10-16 side-chat run (`README.md:428–431`, pi 1.0.2). Re-run `scripts/verify-keymap-conflicts.sh`, confirm `i`/`c`/`n` (and `d`/`e`) claim nothing in pi built-ins or installed extensions' `registerShortcut`, and update the record block (date, commit, result). While there, verify the README keymap table and sample settings still match the resolved config (`i`/`e`/`n`/`c` — already synced at `README.md:153–157`, `:196–200`).
   - Mode A docs: none (the implementing commits carried their own JSDoc/spec sync; no other doc file names a default key).
   - Mode B docs: this task IS the changeset-level sync.

## Documentation impact (explicit)

- Mode A (doc-with-work): already complete — each shipped ruling landed with its spec sync and inline docs (`sanitizeDisplayText` contract in `layout.ts`, `transcriptPrompt` rule in `snapshots.ts`, label rule at `layout.ts:22/:516/:539`, required-description ruling comment at `tool-schema.ts:360–364`). Nothing outstanding.
- Mode B (changeset-level): the keymap-conflict record refresh above; README otherwise already reflects the full changeset (usage paragraph `:37–38`, side-chat `c` prose `:288–297`).

## Acceptance criteria for this delta

1. Full suite green (`npm test` — 54 files / 1624 tests at HEAD), typecheck + lint green.
2. `scripts/verify-keymap-conflicts.sh` re-run recorded in README with a post-2026-10-16 date; `i`/`c`/`n` verified unclaimed; table/sample-settings rows match `config.ts` defaults.
3. No new code beyond the README record — any gap found in the six rulings during verification is a BUG to fix at the existing seam, not a rebuild.

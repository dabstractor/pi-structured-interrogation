# Research notes — P1.M1.T6.S11 (README revisit usage + AC-16)

## Task source
`plan/003_f8af1c6f6c49/delta_prd.md` § "Sync changeset-level documentation (Mode B — final task, depends on all above)":
> `README.md`: (1) Usage — a sentence/step covering revisits: the caret sits on the recorded answer in every view, `enter` on it just advances, and changing an answer requires an explicit different choice (which raises the invalidation confirm); (2) the acceptance-criteria summary list gains AC-16. **No config keys, hotkey table rows, or limitations change in this delta.**

## Verified shipped behavior (all sibling tasks Complete; grep-verified 2026-10-04 working tree)
- `src/panel/short-view.ts:23,113,127` — `initialCursorIndex(q)`: recorded answer pins cursor (display row of `answer.value`; `options.length` ✎ row for `custom`; 0 for text; stale value clamps to row 0, never ★). ★ preselect = unanswered questions only.
- `src/panel/actions.ts:182+` — digit path + `acceptOptionIndex` + `writeInEnter`: same-value / byte-identical re-commit inert (advance only; no applyAnswer, no `answer.at` rewrite, no auto-submit).
- `src/panel/layout.ts:304-313` — `statusMarkers`: `★ answered` on the short-view question line (any status carrying `q.answer` except moot/withdrawn; ⟳ overrides ★; ★ composes with ✎).
- `src/ac-scripted.test.ts` — contains the scripted AC-16 test (proof cite for the acceptance entry).

## README.md anchors (read in full)
- Usage = numbered steps 1–5. **Step 2** covers answering mechanics (digits, arrows+enter, ctrl+t duties, ✎ Other write-in, text-question affordance) — the insertion point for the revisit sentence is the END of step 2 (after "…`ctrl+t` is not the only entry.").
- Existing write-in paragraph (below Keymap) already says the short view on revisit shows "✎ on the question line plus a dimmed preview" — new text complements, must not contradict.
- "Acceptance criteria (spec)" section: intro line reads "this delta extends it to 2a–2d and 15. Summary (scripted where possible — see the spec for the full text and the scripted tests proving each):" → must become "…to 2a–2d, 15, and 16." List ends at item 15 (SURFACE-001). Append item 16 after it.
- Spec authority for AC-16 text: `spec/product-requirements.md:100` (one paragraph; README summary entries are one-line compressions with bold tag — cf. item 15's style).

## Test coupling
No test parses README.md. `src/config-surface.test.ts` / `src/keymap-guard.test.ts` mention README only in JSDoc comments (they validate `src/config.ts`). `npm test` (vitest run) + `npm run typecheck` are regression gates only.

## Non-goals (from delta, binding)
Config JSONC block · keymap tables (remappable + fixed-key rows) · Limitations · Install · Development · Project structure · any src/ or spec/ file. `enter` fixed-key row stays as-is (it is a hotkey table row).

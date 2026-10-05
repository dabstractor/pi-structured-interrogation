# Answer-pinning contract (binding extracts — spec h2.8/h3.5, h2.10 AC-16, h2.65)

## FR-D8 (FR-35; modifies FR-7, FR-12) — the caret follows the recorded answer
`initialCursorIndex(q)` when `q.answer` present (ANY status carrying an answer — answered/submitted/closed; moot keeps its dimmed answer too):
- choice + `custom: true` → `options.length` (the ✎ Other row);
- choice + option value → DISPLAY row of `answer.value` (via `displayOptions` D-R13 recommended-first order);
- value no longer in `options` → clamp to row 0 (NEVER the recommendation);
- `type:"text"` → 0 (the text affordance).
No answer → today's ★ preselect unchanged (display row of `recommendation`, clamp 0).
All three seed sites (currentId setter, editor-close re-seed, deepSeedCursorIndex) inherit automatically — comment/JSDoc edits only.
R2 intact: the ★ recommendation stays VISIBLE on its own row everywhere, but may never own the caret or preselect once an answer exists.

## FR-D9 (FR-35/FR-18) — same-value commits are inert; modal guards only different choices
- `acceptOptionIndex`: answer exists && value equals proposed option value (non-custom recorded choice) → state NO-OP that ADVANCES (Q14 rhythm): skip ripple seam (`confirmRippleEdit`), `applyAnswer`, `evaluateDependsOn`, `maybeAutoSubmit` entirely; no fresh `answer.at`. `digit` inherits (same seam).
- `writeInEnter`: byte-identical write-in re-commit (`answer.custom === true && text === answer.value`; likewise `answer.value === text` on text questions) equally inert — checked BEFORE the ripple-victims branch; consume/neutralize the buffer (VAL-002 pattern) so the advance's draft write-through cannot stage committed text into the draft slot.
- `acceptFromDeep`: same-value no-op is an ACCEPT (return to short + advance); only a ripple veto stays in deep view — needs a third outcome or explicit signal from `acceptOptionIndex` (replaces the `q.answer === before` veto heuristic at deep-view.ts:552).
- FR-18 confirm fires ONLY on an explicit DIFFERENT choice (caret moved to another row, different digit, changed write-in text).

## FR-D10 (FR-35 final clause) — ★ answered marker on the short-view question line
Parity with overview (overview.ts:111-112): `answer` present && status ∈ {answered, submitted, closed}; moot/withdrawn excluded; ⟳ re-asked overrides. Implemented in `statusMarkers` (layout.ts:313); composes with the existing `✎ text answer` marker.

## AC-16 (acceptance, scripted)
Answer q1 with a NON-recommended option, advance, `←` back → caret + accent highlight on the chosen option (★ visible on its own row, caret NOT on it); `enter` advances to next unanswered with ZERO state change (no modal, no epoch bump, no `answer.at` rewrite). Write-in answer pins caret to ✎ Other row with dim preview; byte-identical write-in re-commit inert. Choosing a DIFFERENT option on the answered question still raises the FR-18 confirm.

## Status vocabulary & answer shape
- Statuses: answered / submitted / closed / moot / withdrawn / re-asked (⟳ overrides markers).
- `answer`: `{ value, custom?: true, at }` — `custom: true` marks write-ins; `at` must not be rewritten by no-ops.

## Non-goals (do not drift)
No config keys, no hotkey rows, no auto-submit trigger changes, no overview marker changes, no bulk-accept, no state-machine/rev/epoch/persistence edits, no bridge.

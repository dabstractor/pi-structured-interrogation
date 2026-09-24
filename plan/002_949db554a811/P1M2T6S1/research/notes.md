# P1.M2.T6.S1 research notes

## Current deep view (src/panel/deep-view.ts)
- `buildDeepContent`: goal (dim) + description + one sticky section per option (`sectionHeaders` = plain body e.g. `★ sqlite`; `sectionHeaderLineIndex` = line index). NO Other section today. Header JSDoc explicitly says "NO ✎".
- `clampScroll(content, scrollOffset, cursorIndex)`: uses `sectionHeaderLineIndex[cursorIndex]` — automatically works for a new section at index `options.length` if we register it.
- `renderDeepWindow`: re-renders visible headers with `▸ `/`  ` prefix from `sectionHeaders[s]` — also index-driven.
- `stepDeepSelection`: clamps `panel.cursorIndex` to `count - 1` — must become `options.length` (the Other row).
- `acceptFromDeep`: clamps index to `count - 1`, calls `acceptOptionIndex` (returns false for index==options.length since `q.options[i]` is undefined → falls to clamp; today unreachable). Must route index==options.length to the write-in duty: setView("short"), scrollOffset=0, textDuty="writein", focusTextField() — mirroring `accept()` in actions.ts:198–226.
- `deepSeedCursorIndex`: `Math.min(initialCursorIndex(q), count - 1)` — extend to `count` (allow Other index).

## Short-view Other row (P1.M2.T1.S1, landed)
- `src/panel/short-view.ts:73` `const OTHER_AFFORDANCE = "✎ Other — write your own";` (NOT exported).
- `src/panel/actions.ts` `cursorDomainSize(q)`: choice → `options.length + 1` (last index = Other row). `accept()` (actions.ts:198) sets `panel.textDuty = "writein"` + `panel.focusTextField()` when `cursorIndex >= optionCount`.

## Write-in duty seam (landed, P1.M2.T2.S1)
- `writeInEnter` (actions.ts:280+): enter in writein duty commits `applyAnswer({value: text, custom: true})` + evaluateDependsOn + advanceAfterAccept; FR-18 routing via beginWriteInConfirm.
- `panel.focusTextField(duty?)` (panel.ts:1027) sets textDuty if given, seeds from freshest draft.
- keys.ts:274–292 `desiredTextDuty`: cursorIndex === options.length → "writein" (duty follows cursor — already parity-ready).

## Verbatim ramification (PRD h2.29 + config-tests-docs.md final strings ledger)
`None of the listed options fit — write your own answer; it ships as the official answer for this question, not as an attachment to one of them.`
Section header title: `✎ Other — write your own`.

## Tests
- src/panel/deep-view.test.ts: fixtures `choiceQ`/`textQ` + `panelArgsFor`; suites for buildDeepContent, clampScroll, renderDeepWindow, deepSelectionUp/Down, acceptFromDeep, deepSeedCursorIndex. Extend these; no mocks.
- AC-5: "scroll all ramifications (incl. the Other section), select an option from deep view → returns to short form, advances."

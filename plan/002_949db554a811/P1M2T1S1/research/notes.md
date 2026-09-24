# Research notes — P1.M2.T1.S1 (Other row replaces EXPLAIN_AFFORDANCE)

## Code sites (verified)

- `src/panel/short-view.ts`
  - :4 module docblock mentions "`✎ explain…` affordance"
  - :64 `const EXPLAIN_AFFORDANCE = "✎ explain…";` (module-private, NOT exported)
  - :132 docblock (`✎ explain…` in render list)
  - :167 call site `lines.push(explainLine(options.length, cursorIndex, theme, dimAll));`
  - :214–224 `explainLine(optionCount, cursorIndex, theme, dimAll)` — cursor prefix at `cursorIndex === optionCount`, dim otherwise. Logic reused verbatim.
- `src/panel/actions.ts`
  - :122–125 `cursorDomainSize` comment says "last index = the ✎ explain affordance" — comment-only update; logic already `options.length + 1`.
  - :187 `digit()` already excludes `n - 1 >= options.length` (:197) — behavior correct; tests at actions.test.ts:350–366 cover no-op but the item contract asks for an EXPLICIT digit-exclusion test naming the Other row (assert no state change / no answer applied, not just `false`).
- Tests with the pinned string:
  - `src/panel/short-view.test.ts` :7 (docblock), :171 `"  ▸ ✎ explain…"`, :172 `"    ✎ explain…"`, :178 describe `"✎ explain… affordance"`, :184, :188
  - `src/panel/panel.test.ts` :455 `l.includes("✎ explain…")`

## Verbatim label (config-tests-docs.md Final strings ledger / PRD h2.32)

`✎ Other — write your own`

## Downstream consumers (do NOT implement here)

- P1.M2.T2.S1: accept routing at cursor index `options.length` → write-in duty (today accept on that index opens the explain field — UNCHANGED in this item; render-only rename).
- P1.M2.T3.S1: duty-follows-cursor (ctrl+t on Other row → write-in duty).
- P1.M2.T6.S1: deep view Other section (its own label/ramification).

## Parallel sibling (P1.M1.T2.S2, in flight)

Display plumbing for `✎ {text}` ANSWER rendering (results/completion/renderers). No overlap — this item only touches the short-view affordance ROW label and its tests. No shared files (short-view.ts untouched by S2).

## Rename choice

`OTHER_AFFORDANCE` (item contract suggests `OTHER_AFFORDANCE` or OTHER_ROW semantics); function `explainLine` → `otherLine`. Keep module-private const.

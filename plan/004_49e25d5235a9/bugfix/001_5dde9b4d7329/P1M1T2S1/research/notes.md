# Research notes — P1.M1.T2.S1 (stageSupersededWriteIn helper)

All facts verified in `architecture/bug001-writein-supersede.md` §(d)/(e) + source reads:
- Full helper code sketch exists in §(d) — copy verbatim (4 guards + commitTextDraft tail).
- Seams verified: `panel.draftTextFor` (panel.ts:1205-1210: `draftSlots.get(id)?.text ?? drafts?.getDraft(id)`), `panel.commitTextDraft` (panel.ts:903-926; EXPLAIN-003 re-seed guarded by `currentId === questionId && cursorIndex >= options.length` — cannot fire from an accept gesture), `draftSlots` PRIVATE (panel.ts:423) — commitTextDraft is the sanctioned seam.
- Why unreachable today: `consumeCommittedBuffer` (panel.ts:982-991) deletes slot + store at commit → draftTextFor === undefined exactly (guard 4's window).
- Guard rationale in §(d): (1) `superseded?.custom !== true` return — inert branch at actions.ts:296 requires custom !== true, so every apply behind a custom answer is a genuine supersede, no value-change check needed; (2) whitespace-only skip (reconcile skips anyway but ✎ marker would light); (3) `value === newValue` kind-flip skip ('Alpha — Alpha'); (4) `draftTextFor !== undefined` return — user-held slot wins INCLUDING deliberate delete-to-empty '' (stricter than trim check — never resurrect deleted text).
- commitTextDraft's blur is harmless in accept context (focus already "options"; "double invalidate harmless" convention); ripple-confirm.ts already imports from actions.js → no cycle.
- QuestionAnswer imported from state module. House fixtures: `seed()` actions.test.ts:82, `choiceQ()` :64.
- NO call sites in this subtask — S3 (acceptOptionIndex :313) and ripple-confirm :158 wire it; the manufactured test actions.test.ts:2213/:2223 rewrite is S3's, do NOT touch.
- P1.M1.T1.S1 (parallel) appends the WRITEIN-002 restore ruling to spec/decisions.md — JSDoc cites it.
- Still-green pin: `test_wi_same_value_recommit_consumes_buffer_no_draft_residue` (:776) — commit path untouched.

## Tests (TDD failing-first — new describe, house fixtures)
1. happy path: custom answer {value:'my own words', custom:true}, no existing draft → helper stages → `draftTextFor('q1') === 'my own words'`
2. guard 1: non-custom/undefined superseded → no stage
3. guard 2: custom with whitespace value → no stage
4. guard 3: custom value === newValue → no stage
5. guard 4a: existing non-empty draft → NOT clobbered
6. guard 4b: deliberate delete-to-empty '' draft → NOT clobbered (draftTextFor returns '' ≠ undefined)
Failing today: helper doesn't exist (import fails) — that IS the red state; happy path asserts staging.

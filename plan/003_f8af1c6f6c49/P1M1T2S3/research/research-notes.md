# Research — P1.M1.T2.S6 (acceptFromDeep: no-op returns to short + advances)

## The bug (verified in code)

`src/panel/deep-view.ts` `acceptFromDeep(panel)` (~line 528) commits the
highlighted deep-view option via `acceptOptionIndex(panel, q, index)` and then
decides whether to drop back to the short form with a REFERENCE-COMPARISON
heuristic:

```ts
const before = q.answer;
const accepted = acceptOptionIndex(panel, q, index);
// "Veto detection without re-invoking the seam: applyAnswer always assigns
//  a FRESH answer object; a vetoed edit leaves the old one in place."
if (q.answer === before) return true;   // ← line ~552: reads NO-OP as VETO
panel.setView("short");
panel.scrollOffset = 0;
return accepted;
```

S4 (commit d6d1553) made same-value re-commits INERT inside
`acceptOptionIndex`: no `applyAnswer`, so the answer object reference is
unchanged → `q.answer === before` still holds → deep view classifies the
no-op as a veto and the user is STUCK in deep view. FR-D9/ANSWER-PIN-001:
`enter` on the recorded value is a no-op that ADVANCES (Q14 rhythm) — from
deep view it must return to the short form (the advance already ran inside
`acceptOptionIndex`). Only a genuine ripple VETO stays in deep.

## Why the signal must change

`acceptOptionIndex` (src/panel/actions.ts) currently returns `boolean`:
- `false` — `opt === undefined` (out of range; falls through in digit/accept)
- `true` — same-value NO-OP (advanced, nothing written)
- `true` — ripple seam VETO (`if (!panel.confirmRippleEdit(...)) return true`)
- `true` — real commit (advanced)

Boolean cannot distinguish NO-OP from VETO — that distinction is exactly what
`acceptFromDeep` needs. Seam doc
(plan/003_f8af1c6f6c49/architecture/panel-ui-seams.md:17): "Return shape must
expose a third outcome (NO-OP vs ACCEPT vs VETO) for acceptFromDeep."

S4's PRP explicitly deferred this: "S6 only adjusts the deep-view CONSUMER's
outcome interpretation, not this function['s logic]" — i.e. S6 may change the
RETURN SHAPE of `acceptOptionIndex` but not its commit logic.

## Call sites of acceptOptionIndex (grep-verified)

1. `actions.ts` `accept()` — `return acceptOptionIndex(panel, q, panel.cursorIndex);`
   (typed `boolean` by `PanelActions` interface → needs coercion)
2. `actions.ts` `digit()` — `return acceptOptionIndex(panel, q, n - 1);` (same)
3. `deep-view.ts` `acceptFromDeep()` — the consumer being fixed
4. `actions.test.ts` — exactly ONE textual occurrence (S4's tests use the
   `accept()`/`digit()` wrappers and assert `toBe(true)`; a wrapper coercion
   keeps them green). Executor: verify with
   `grep -n acceptOptionIndex src/panel/actions.test.ts`.

`acceptFromDeep` itself is consumed only by `src/panel/keys.ts:446`
(`if (panel.view === "deep") return acceptFromDeep(panel);`) — its `boolean`
signature stays, keys.ts untouched.

## Fixture facts (deep-view.test.ts)

- `choiceQ(id, overrides)` (line 64): options `sqlite`(rec ★)/`postgres`,
  `recommendation: "sqlite"` → D-R13 display order: row 0 sqlite, row 1
  postgres, row 2 = ✎ Other.
- `setup(questions, statuses)` helper in the `acceptFromDeep` describe applies
  raw `setStatus` after upsert (upsert normalizes to open).
- Existing tests: `test_accept_applies_answer_returns_to_short_and_advances`
  (real commit), `test_ripple_veto_stays_in_deep_without_committing`
  (`panel.rippleConfirm = () => false`), text/moot/withdrawn consumed no-ops.
- Entering deep view seeds the cursor via `deepSeedCursorIndex` →
  `initialCursorIndex` (S1, complete): an answered question's cursor lands on
  the RECORDED answer's section (postgres → display row 1). This makes
  same-value enter-from-deep the natural revisit path — the exact UX S6 fixes.

## docs to purge (Mode A rides with the change)

- deep-view.ts `acceptFromDeep` JSDoc "No-op paths" bullet claims "ripple
  VETO … the view only changes on a real commit" and the inline comment block
  ~559-566 (reference-heuristic rationale). Both must state the
  no-op-vs-veto distinction after the fix.

## Validation (verified working)

- `npm test` → `vitest run`; `npm run typecheck` → `tsc --noEmit`.
- Targeted: `npx vitest run src/panel/deep-view.test.ts src/panel/actions.test.ts`.

## Sibling status (cite, don't rebuild)

- S1 seeding: complete (1fba337). S4 inert no-op in acceptOptionIndex:
  complete (d6d1553). S5 writeInEnter byte-identical: complete (in tree).
- AC-16 end-to-end scripted test belongs to P1.M1.T5.S10 — S6 ships the
  deep-view unit coverage only.

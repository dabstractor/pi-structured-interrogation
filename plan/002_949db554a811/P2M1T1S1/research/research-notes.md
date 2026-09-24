# Research — P2.M1.T1.S1: maybeAutoSubmit(panel, deps) + wiring after every commit path

## Commit paths that must hook (audit 2026-xx, exact)

1. **`acceptOptionIndex`** — `src/panel/actions.ts:236` (shared tail for accept(), digit(), deep-view selection). Sequence: ripple-confirm seam veto → `applyAnswer` (:243) → `evaluateDependsOn` (:247) → `advanceAfterAccept`. Covers option accepts AND edits of answered/submitted questions.
2. **`writeInEnter`** — `src/panel/actions.ts:280`. Empty buffer = draft write-through, NO commit (must not hook). Non-empty: ripple-with-victims defers to `beginWriteInConfirm` (returns early — hook belongs in the APPLIED path); otherwise `applyAnswer({value, custom:true, at})` (:304) → evaluateDependsOn → advanceAfterAccept → blur. Text questions route here too (keys.ts:291 duty = "writein" for `type:"text"`; accept() at :217 forwards text questions into the text duty).
3. **`applyWriteInConfirm`** — `src/panel/ripple-confirm.ts:282` (deferred write-in commit from the keep/cancel modal; docblock already says "P2.M1.T1.S1 hooks maybeAutoSubmit after this tail — do not implement it here").
4. **`applyConfirmedEdit`** — `src/panel/ripple-confirm.ts:145` (deferred choice edit commit; applyAnswer at :149).

Non-hooks: `applyTextConfirm` (:209, draft save only — no answer), `cancelConfirm`/`cancel*` (zero state change), empty-buffer writeInEnter branch, `commitTextDraft` (draft write-through).

## submit() pipeline (actions.ts:448) — must be called EXACTLY, not reimplemented

`reconcileDraftsForSubmit` (:452, already role-bound per P1.M2.T5.S1) → baseline/computeDiff → BUG-008 filter (:466-483) → zero-shipped early return with held-draft flash (:484-496 — already covers the zero-pending no-op flash) → soft-gate warning (:498-510) → note pickup (:511-513) → `markSubmitted(pendingIds)` (:527) → `buildSubmission` (delivery.ts:140; takeSnapshot+bumpEpoch inside at :185-186, EXACTLY once) → `deliverSubmission` (:544) → note cleared → auto-close engine reset (:546 tail). Returns boolean.

- `submit` already flashes "nothing to submit…" when nothing is pending — maybeAutoSubmit's no-op (zero pending) should NOT call submit at all, so no double flash.
- Held batch note rides automatically (submit picks it up at :511-513).
- Gate-hold withholding is P2.M1.T2.S1's job inside this hook's call site — this item only ships the hook + unconditional completeness firing.

## Completeness predicate

Same statuses `nextUnanswered` (actions.ts:106) treats as unanswered: `open` / `reasked`. moot/withdrawn/closed never count. Pending = `status === "answered"`. Fire when `unansweredCount === 0 && pendingCount > 0`.

## deps availability

- `SubmitDeps` — actions.ts:54 (`{ sendMessage, isIdle }`); production instance = `panel.delivery` (panel.ts:475 `readonly delivery: SubmitDeps | undefined`, set from `surfaceSubmitDeps` at open, panel.ts:1601-1608). Commit fns (`acceptOptionIndex`, `writeInEnter`) do NOT receive deps → the hook must source them from `panel.delivery` when the caller doesn't pass them.
- Bridge (remote-submit.ts) will call the hook explicitly with its own deps (P2.M1.T3.S1).

## Flash API

`panel.flash(text)` — panel.ts:894, non-stacking transient footer line, auto-clear after FLASH_MS (~2.5s, panel.ts:288). Existing exact-string assertions pattern: `expect(panel.footerFlash?.text).toBe("nothing to submit")` (actions.test.ts:553).

## Test patterns (src/panel/actions.test.ts)

- `seed(specs)` fixture (:74) — inject statuses via `overrides: { status: "answered" }`.
- `makePanel(state, extra)` (:100) — pass `delivery` via `extra` (Partial<InterrogationPanelArgs>).
- `makeDeps(isIdle=true)` (:117) — `{ deps: { sendMessage: vi.fn(), isIdle }, sendMessage }` — mock delivery deps exactly as existing submit tests (test_i_ :512).
- Epoch assertion: `state.getEpoch()` post-commit; sendMessage called exactly once per firing.

## Epoch semantics

bumpEpoch lives inside buildSubmission (delivery.ts:186); fires once per submit call → once per auto-submit firing automatically. No change needed; only tests assert it (per-firing assertion is shared with P2.M1.T4.S1 — keep a basic one here).

## Docs (Mode A)

- JSDoc on `maybeAutoSubmit` in actions.ts (exported, the one shared hook).
- state.ts epoch doc block (:201-210 area): add "auto-submits bump epoch (each firing is a full submission, h2.39/AUTOSUBMIT-001)".

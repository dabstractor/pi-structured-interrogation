# Research notes — P1.M2.T1.S1 (BUG-003 option path: closed edits route through the FR-18 seam)

## Verified in live source (src/panel/actions.ts)

- **The gate** — acceptOptionIndex :322 (after Wave-1 drift; contract cites :299-305): `if (q.status === "answered" || q.status === "submitted") { if (!panel.confirmRippleEdit(q.id, proposed)) return "veto"; }` — `closed` missing → closed edits apply directly, then `evaluateDependsOn(panel.state)` (:327) silently moots dependents. That's BUG-003.
- **Same-value no-op runs FIRST** (:294-312 area): `recorded !== undefined && recorded.custom !== true && recorded.value === opt.value && q.status !== "reasked"` → advance + return "noop". Closed is ALREADY included in the no-op (statuses "the user's own commit produced") and the `reasked` exception (P1.M1.T2.S1, landed) keeps rule-1 re-confirms seam-free. **Adding closed to the :322 gate does not affect the no-op ordering** — same-value on closed never reaches the gate. Pinned by `test_same_value_on_closed_stays_closed_not_remarked_pending` (actions.test.ts:496).
- `wasUnanswered = status open|reasked` (:319-320) — closed is an edit → correct context for maybeAutoSubmit, unchanged.
- Post-seam tail: applyAnswer (flips closed→answered(pending) = FR-2 re-mark), evaluateDependsOn, advanceAfterAccept, maybeAutoSubmit — mirrors the answered/submitted edit path exactly; nothing else changes.
- Digit inherits (routes through acceptOptionIndex via `digit()`); pinned pattern `test_digit_on_answered_routes_through_the_ripple_seam` (actions.test.ts:698 area).

## Seam machinery (ripple-confirm.ts)

- `createRippleConfirm` (:118-134): zero victims → true (apply directly — closed edits with NO dependents behave exactly as before, no spurious modal); else stashes `panel.confirmMode {questionId, kind:"choice", proposed, victims, priorCursorIndex}` + veto.
- `applyConfirmedEdit` (confirm-enter): mirrors the accept tail exactly once; esc-cancel leaves statuses untouched (existing tests :372-382).
- `rippleVictims(panel, id)` (:104) is status-driven on DEPENDENTS — no change needed.
- Header comment :32 "Open/reasked edits never reach the seam" — extend to document the closed gate + same-value exemption.

## Tests (actions.test.ts)

- Seam describe "accept on answered — ripple-confirm seam (AC-13)" :339-390 pins answered/submitted only; ZERO closed coverage (verified by grep). Extend it.
- Stay-green: :316 moot/withdrawn no-op; :393-561 same-value family incl. :422 reasked reconfirm, :496 closed same-value inert, :530 different-value seam.
- `makePanel(state, {confirmRipple})` / `seed([{id, overrides}])` / `seamMock(bool)` helpers exist — reuse.

## Scope fence

- writeInEnter gate (actions.ts ~:392) and stageText (panel.ts :863) = P1.M2.T1.S2 — NOT here.
- Moot reason rendering = P1.M2.T2; docs = P1.M3.T2.
- PRD h2.5 rec: "Extend the FR-18 ripple-seam status gate … to fire for ANY edited question carrying a recorded answer, including `closed`." Choose the STATUS-LIST form (`answered|submitted|closed`) over answer-presence: answer-presence would also capture the reasked hybrid and needs explicit exemptions — the status list keeps the P1.M1.T2.S1 reconfirm path seam-free by construction.

## PRD repro fixture

q1 'db' (options sqlite/postgres) answered+submitted then status closed; q2 'scale' answered(pending), dependsOn [{id:'db', equals:'postgres'}]. Cursor to 'sqlite' on closed q1 → enter → confirmMode raised (kind choice, victims [scale]); esc → nothing applied; enter → db answered(sqlite), scale moot with h2.29 reason.

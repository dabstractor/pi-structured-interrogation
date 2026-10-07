# System context — bugfix wave 001_64331ded9ddb (PRD BUG-001..BUG-005)

## Repo & baseline (verified 2026-10-07)
- `pi-interrogator` — TypeScript panel TUI extension for the pi coding agent (`package.json`: `main: src/index.ts`). Stack: `@earendil-works/pi-tui` ^0.85.1, `typebox` 1.3.7, Node >= 22.19.0, vitest ^1 colocated `*.test.ts`.
- Gates: `npm test` (vitest run; 46 files / 1265 tests GREEN at PRD time) and `npm run typecheck` (tsc --noEmit). Both must stay green; no test regresses without an explicit flip + rationale.
- Spec corpus in `spec/` is the binding contract set; `spec/decisions.md` is the living decision ledger (pins are appended per wave — repo convention). Code comments/docblocks are contract-grade: update them with every seam change.
- Detailed research (verified anchors, verbatim spec quotes, test-flip maps): `reask-confirmation-loop.md`, `ripple-moot-seams.md`, `epoch-completed-swap.md`, `spec-contracts.md` in this directory. Read the relevant one before implementing.

## The five defects (all verified against the working tree)
| PRD ID | Sev | Seam (verified) | Defect |
|---|---|---|---|
| BUG-001 | Critical | `src/panel/actions.ts:293-297` (accept), `:379-385` (writeInEnter) | ANSWER-PIN-001 same-value no-op has NO status exclusion; a rule-1 `reasked` question (answer kept) can never be re-confirmed → wedged in `reasked`, blocks completion (`reasked` ∈ completion.ts BLOCKING set). |
| BUG-002 | Major | `src/panel/actions.ts:595` early return in `submit()` | `computeDiff` is answer-signature-only (status-blind, `snapshots.ts:229`); a pending `answered` id whose value byte-equals the last snapshot hits `diff.changed.length === 0` → flash "nothing to submit", no flush/epoch/delivery — the D-R6 bridge fix never reached the panel path. |
| BUG-003 | Major | `src/panel/actions.ts:302`, `:392`; `src/panel/panel.ts:863` | FR-18 ripple gates fire only for `answered|submitted`; editing a `closed` question (FR-2/AC-13 supported) bypasses the modal and silently moots dependents via `evaluateDependsOn`. |
| BUG-004 | Major | `src/panel/short-view.ts:149-152`, `src/panel/overview.ts:166-172`, `src/panel/layout.ts:329-333` | Panel views derive the moot reason from the moot question's OWN answer/value or "dependency changed"; the true h2.29 reason (`moot: {dep}={value}`, computed in `depends-on.ts:83-90,112-145`) is only consumed by `delivery.ts:420` (completion record). |
| BUG-005 | Minor | `src/guards.ts:245-246` + swap at `src/tool.ts:282-303` | After completion, `executeInterrogate` swaps in a fresh state (epoch 1) then `assertFresh`; an honest epoch echo (≥2) — guided by `tool-schema.ts:114` — throws a spurious epoch-only STALE ("Changes since epoch 2: (none)"). |

## Fix directions (researched; see per-bug docs for detail)
1. **BUG-002 → M1.T1**: D-R6 pattern — in `submit()`, key the zero-ship early return on `pendingIds.length === 0`; with pending ids, fall through: `markSubmitted` flush + `buildSubmission` (synthesize `changed` entries for pending ids absent from the diff so card `k` stays consistent) + epoch bump + delivery. Rejected: widening `computeDiff` to statuses (breaks `digestSince`/BUG-008 contracts, many pins).
2. **BUG-001 → M1.T2**: exclude `reasked` from both no-op guards (`&& q.status !== "reasked"`); the existing fall-through already handles reasked (`wasUnanswered` includes it; seam gate skips it). Scope TIGHT to `reasked` — `closed` stays inert (`test_same_value_on_closed_stays_closed_not_remarked_pending`) and `answered` no-op pins (`test_same_value_on_complete_set_does_not_auto_submit` + write-in twin) must stay green. BUG-001 and BUG-002 fixes are co-required to break the loop.
3. **BUG-003 → M2.T1**: widen the three seam gates to include `closed` (edited question carries a recorded answer). **Ruling: `VICTIM_STATUSES` stays `answered|submitted`** (closed victims are terminal by design, ripple-confirm.ts:96-102; footer copy stays accurate). Interaction: after M1.T2, a `reasked` same-value re-confirm must STILL bypass the seam (same-value is not a change — FR-18 tail/ANSWER-PIN-001).
4. **BUG-004 → M2.T2**: **persist the reason** — add `mootReason?: string` to `Question` (state.ts), write it where `evaluateDependsOn` mutes (depends-on.ts:199-200), clear on reopen/empty-dependsOn/merge rule-2 reset, revive in `reviveQuestion` for round-trip; consume in short-view `mootReason`, overview `overviewMootReason`, layout `statusMarkers` (each prefers `q.mootReason` first). Rejected: render-time `dependencyMet` plumbing (changes three pure Question-only renderer contracts + all consumers). Preserve purity pins: still-moot reason writes must be idempotent (no `changed` emit, byte-identical serialize — delivery.test.ts purity assertions).
5. **BUG-005 → M3.T1**: exempt the epoch-equality throw (`guards.ts:245-246`) when the receiver is fresh (`state.epoch === 1 && orderedQuestions().length === 0`) AND every upserted id is new. No persisted flag needed; rev guard/presence guard unaffected (no-ops on fresh state); `record` path untouched. Fix the false "trivially passes" comment at tool.ts:297-300.

## Ordering & dependencies
M1.T1 (ship fix) → M1.T2 (confirm fix, needs T1 so the re-marked pending answer actually ships) → M1.T3 (round-trip regression). M2.T1 depends on M1.T2 (gate widening must preserve the reasked same-value seam-free path). M2.T2 and M3.T1 are independent. M3.T2 (Mode B docs) depends on everything.

## Test conventions (binding)
- Scripted vitest ONLY, colocated; every subtask implies TDD (failing test → implement → pass). No live TUI/tool calls in tests.
- Panel tests use headless panels + seam stubs (see `src/panel/actions.test.ts` `makePanel`/`seed`); delivery via captured `sendMessage` deps. No external services to mock.
- Fixture anti-pattern to eliminate (BUG-004): pre-baking the literal `moot: storage=sqlite` into `answer.text` (overview.test.ts:202-279, panel.test.ts:567-586) — masks the production derivation. Production-path scenarios: seed dep + dependent, answer the dep, let `evaluateDependsOn` moot, assert the rendered reason.
- End-to-end probes (PRD's harness): vite-node headless scripts driving ONLY public seams — `executeInterrogate` + lifecycle event bus (`tool_execution_start/end`, `agent_settled`) + `InterrogationPanel` accept/submit. M1.T3 encodes this as a permanent regression test.

## Docs surfaces
- Mode A (rides with work): seam docblocks/JSDoc in actions.ts / panel.ts / ripple-confirm.ts / short-view.ts / overview.ts / layout.ts / guards.ts / tool.ts / depends-on.ts / state.ts; `spec/decisions.md` pin lines per repo convention for each semantics change (ANSWER-PIN-001 reasked amendment, D-R6 panel parity, FR-18 closed gate, BUG-005 epoch-echo exemption).
- Mode B (final task M3.T2): README.md — Usage (:30, re-ask confirmation + "nothing to submit" behavior), Acceptance criteria (:258, AC mirrors), Limitations (:286, re-ask wedge removal), epoch guidance near :98/:107.

## Non-goals
No new config keys, no keymap changes, no auto-submit trigger redesign, no state-machine/rev/persistence redesign (beyond the additive `mootReason?` field), no `VICTIM_STATUSES` change, no bridge resurrection, no spec/*.md rewrites beyond additive decisions.md pins.

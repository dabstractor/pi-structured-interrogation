# Validation Report — pi-interrogator bugfix re-validation

**Cycle context.** The previous bug-hunt filed 4 defects (BUG-001 replay fidelity, BUG-002 Other-row truncation, BUG-003 dead auto-submit flash, BUG-004 stale SURFACE-002 comment). A bugfix agent landed fixes (commits `83fb067`…`cced85e`, touching `src/snapshots.ts`, `src/reconstruct.ts`, `src/panel/actions.ts`, `src/panel/panel.ts`, `src/panel/short-view.ts`, `src/index.ts`, plus 19 new tests and the `src/regression-replay-fidelity.test.ts` suite). This validation re-ran every gate, verified each fix with **independent probe code written fresh by the validator** (not the fix's own tests), and drove 13 live headless `pi -p` journeys — including a real cross-process restart-fidelity probe for BUG-001.

**Verdict: all four PRD bugs are correctly fixed; no regressions introduced. One new (minor, pre-existing) defect found that the previous hunt missed.**

---

## Fix Verification (all four PRD bugs)

| Bug | Status | Evidence |
|---|---|---|
| **BUG-001** — restart replay loses `answer.text` / `answer.custom` | **FIXED** | Independent probe P1 (22 checks): real `executeInterrogate` upsert → real panel gestures (option accept + committed elaboration, ✎ Other write-in) → auto-submit wire capture → hard-kill branch `[tool-result base, submission]` → `reconstructFromBranch` restores `q1.answer.text` and `q2.answer.custom` verbatim, no key duplication, epoch advances. Producers verified on both seams (`computeEntries` P4b/P4c; submit synthetic-entry spread P1e/P1h + static guard 5.8). Legacy value-only entries replay unchanged (P1r/P1s); corrupt persisted shapes (`text: 42`, `custom: "yes"`) are strictly guarded and never leak (P1t/P1u). Live E2E **E9b**: a REAL second pi process resuming the session reads back `elaboration: …` and `✎ …` intact. Regression suite `regression-replay-fidelity.test.ts` present and green in the unit run. |
| **BUG-002** — ✎ Other row label never truncates | **FIXED** | Independent probe P2: full-panel render sweep — every line fits at widths ≥ 18 for choice / write-in-answered / text panels; the Other row clips with `…` at width 10 and renders intact at 30 (`✎ Other — write your own`). Truncate-raw-then-color ordering preserved (green wrap covers the surviving string). Only the documented footer minimal-form residual remains below width 18 (see Residual Observations — explicitly out of the fix's scope per the PRD). |
| **BUG-003** — auto-submit flash set after suspend (never observable) | **FIXED** | Independent probe P3: answering the last open question fires `panel.notify("submitted — 1 answer(s)")` — verbatim AUTOSUBMIT-001 string — **after** `done(null)` (suspend), through the host `ui.notify` closure that remains callable post-unmount; the footer flash is still staged as the test receipt. Static wiring verified: `panel.notify` routes through the same log-safe `sidechatNotify` seam as the chat close notices. |
| **BUG-004** — index.ts comment claims session_start auto-opens the panel | **FIXED** | Static guard 5.7: no "auto-opens the panel" claim remains; both `src/index.ts` and `src/reconstruct.ts` document the SURFACE-002 "NEVER opens the panel" contract at the wiring site. |

---

## Critical Issues (Must Fix)

None.

## Major Issues (Should Fix)

None.

## Minor Issues (Nice to Fix)

### Issue 1: Question-header line renders one column wider than the terminal when combined status markers fill the budget
**Severity**: Minor
**ID**: VAL-001
**Location**: src/panel/layout.ts:446–471 (renderQuestionLine — `finish()`)

**Description**:
`renderQuestionLine` composes `2-col inset + left part + status markers` against `budget = width − 2`. When the marker string alone meets or exceeds the whole budget (the "pathological marker" path), the markers are truncated to the **full** budget (line 446) while `leftBudget` still floors at 1 column (line 451) — so the finished line measures `2 + 1 + budget = width + 1`. This violates the width contract the panel's renderers are held to (`terminal-budget.ts:63` "the renderers' existing truncation keeps every line inside the terminal"; the ui-spec sub-60-col fallback table BUG-002 was filed under) and lets pi-tui wrap the spill into an extra row.

Reachability (verified by probe P2f): a question carrying **combined** markers — `★ answered · ✎ text answer` (~27 visible cols), i.e. exactly a committed write-in/answered-text state — overflows by exactly +1 col at widths 18–30 (e.g. width 20 renders a 21-col `  … ★ answered · ✎ t…`). Widths ≥ 31 fit (the markers fit whole). This is **pre-existing** — `layout.ts` is untouched by the BUG-002 fix — and was missed by the previous hunt, which tested option/Other-row labels but not the question-header line under combined markers. Note the BUG-001 fix makes the trigger slightly more common: replay now correctly restores `custom` markers that drive the `✎ text answer` status part.

**Steps to Reproduce**:
Panel over a choice question answered with a committed write-in (`answer.custom === true`); `panel.render(20)`; measure `visibleWidth` of the question-header line (contains `★ answered`) — 21 columns at width 20, 19 at width 18, 26 at width 25. Fix direction: truncate markers to `budget − 1` when the left part would floor at 1 (or drop the left floor to 0 when markers fill the budget).

## Residual Observations (documented, out of fix scope — not counted as issues)

- **Footer minimal form** (`└ 0/1 answered ⏎ ┘`, 18 cols) overflows terminals narrower than 18 columns (probe sweep: widths 6–17). This was explicitly acknowledged in the previous PRD's BUG-002 text and scoped out of the fix ("the Other-row label is the unambiguous spec violation"); `renderFooter`'s own comment declares the minimal border "non-crashing" below ~19 cols. Left as-is by design; flagging only so it stays on the radar.

---

## Testing Summary

| Phase | Result |
|---|---|
| 1. Lint (eslint, typescript-eslint recommended) | PASS — clean |
| 2. Type check (tsc --noEmit, strict) | PASS — clean |
| 3. Style | No formatter configured in the repo (noted; no gate exists) |
| 4. Unit tests (vitest run) | PASS — 55 files / **1643 tests** (was 1624 pre-fix; +19 fix tests incl. the replay-fidelity regression suite) |
| 5. Static guards (9 gates) | PASS 9/9 — keymap conflicts, README chord vocabulary, no registerShortcut, README keymap sync 9/9, caps engine deleted, sidechat isolation, **BUG-004 comment gate**, **BUG-001 wiring gate (carrier + both producers + consumer)**, regression suite present |
| 6. Independent probes (fresh code, real seams, esbuild-bundled) | PASS — **37/37 checks**; 1 new finding (VAL-001) documented above |
| 7. E2E live headless pi (13 journeys) | PASS 13/13 — smoke/digest, ★ recommendation, answers + epoch bump, completion record injection, stale-epoch guard + self-heal, TRUST-001 long write-in + ✎ scan line, moot/withdraw/re-ask merge rules, standing-moot completion, **E9 real restart reconstruction**, **E9b BUG-001 live restart fidelity (elaboration + ✎ write-in survive a fresh process)**, wire-schema description gate ×2, elaboration read detail |

- Total new issues found: **1** (minor)
- Critical: 0 · Major: 0 · Minor: 1
- Regressions introduced by the bugfix: **0**

## Recommendations

- Fix VAL-001 by reserving one column for the left part when truncating pathological markers (or flooring `leftBudget` at 0 when `markerW >= budget`), and add a question-line width test with combined `★ answered · ✎ text answer` markers at widths 18–30 to the narrow-width family in `layout`-level tests.
- Optionally fold the footer minimal-form sub-18-col residual into the same width sweep if ultra-narrow terminals become a support target.

---

*Validation artifacts: `validate.sh` (this report's executable counterpart — reruns all seven phases), `validation_result.json` (structured verdict). Scratch probe work was bundled and executed from a temp dir; no repo files were modified.*

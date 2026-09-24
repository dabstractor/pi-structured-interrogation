# BUG-001 — Gate-hold ⚠ line (AUTOSUBMIT-002 / AC-2d) never renders in the canonical scenario

Verified against current HEAD, read-only. All line numbers exact.

## Verified-claims table

| # | Claim | Verdict |
|---|---|---|
| 1 | `maybeAutoSubmit` (~actions.ts:604) runs the completeness check `if (unanswered > 0) return;` (line **611**) BEFORE the gate-hold arming (lines **624–635**), so when a gate question is open/reasked the function returns with no hold line; `panel.gateWarning` stays null | **CONFIRMED** |
| 2 | Hold branch only reachable when a gate question has `answer === undefined` while NOT open/reasked — a state the natural state machine can't produce ('closed' only via `closeSubmitted` on submitted ids, which always have answers) | **CONFIRMED** (see nuance below) |
| 3 | AC-2d tests (~actions.test.ts:1935–2090) only pass via the contrived `HOLD_FIXTURE` (a 'closed'-no-answer gate question); `test_auto_open_gate_question_returns_at_completeness_no_hold_line` (~:2042) pins the deviation | **CONFIRMED** — the fixture's own comment admits it ("no longer open/reasked (agent-settled closed, answer reset) — the exact … shape of AC-2d") |

Nuance on claim 2: rule-2 merges (changed options) DO reset answers, but land as status `reasked` (merge.ts ~92, 162, 183–193), so they still trip the completeness return. `merge.ts:282 closeSubmitted` only fires on `status === "submitted"` ids (submitted via `markSubmitted`, merge.ts:268–271, which flushes only `answered` ids — always answered). Rule-1 re-upsert of a closed question keeps `existing.answer` (merge.ts:192–193). So `closed` + `answer === undefined` is unreachable in the natural flow.

## Exact code

### `src/panel/actions.ts:604–641` — `maybeAutoSubmit`

```ts
export function maybeAutoSubmit(panel: InterrogationPanel, deps?: SubmitDeps): void {
  const d = deps ?? panel.delivery;
  if (d === undefined) return; // no delivery surface (e.g. headless tests) — no-op
  const ordered = panel.state.orderedQuestions();
  const unanswered = ordered.filter(
    (q) => q.status === "open" || q.status === "reasked",
  ).length;
  if (unanswered > 0) return;                                   // line 611 ← BUG
  const pending = ordered.filter((q) => q.status === "answered").length;
  if (pending === 0) return;                                    // line 613 (zero-pending silence)
  // AUTOSUBMIT-002 gate hold (lines 624–635)
  const gate = gateGroupNames(ordered);
  const n = countUnansweredGate(ordered, gate);                 // line 625
  if (n > 0) {                                                  // line 626
    if (panel.config.gateWarnings) {
      panel.gateWarning = { count: n, kind: "hold", submitLabel: panel.labels.submit };
      panel.invalidate();
    }
    return; // no submit, no flash
  }
  const shipped = submit(panel, d);
  if (shipped) {
    panel.flash(`submitted — ${pending} answer(s)`);
  }
}
```

### Helpers — `src/panel/gate.ts`

- `countUnansweredGate(ordered, gate)` — gate.ts:100–110. Counts gate-group questions with `answer === undefined` and status not `withdrawn`/`moot`. (Open/reasked unanswered gate questions DO count here — the check just never runs for them.)
- `gateGroupNames` — gate.ts:68–74. `effectiveGroup` — gate.ts:60.
- `gateWarningLine(n)` — gate.ts:116–118: `⚠ {n} foundational unanswered — later answers may shift`
- `gateHoldLine(n, submitLabel)` — gate.ts:143–145: `⚠ {n} foundational unanswered — answer them or {submitLabel} to submit now`

### `panel.gateWarning` — declare / render / dismiss / expiry

- Declared: `src/panel/panel.ts:479–481` — `{ count, kind: "submit" } | { count, kind: "hold", submitLabel } | null = null`. Doc comment (455–478) states BOTH kinds are **non-expiring** (unlike `footerFlash`); any key dismisses.
- Rendered: `panel.ts:1204–1220 footerNoticeLine()` — picks `gateHoldLine`/`gateWarningLine` by `kind`, wraps via `renderGateWarningLine` (imported from `layout.ts`, panel.ts:80). Consumed above the footer in every view: panel.ts:1267 (note), 1331 (short), 1354 (deep), 1387 (overview). Hold wins over a live flash (h2.37).
- Dismissal: `panel.ts:778–781` — handleInput stage 0 clears `gateWarning` on any key, then CONTINUES normal processing.
- Submit-time warning setter (contrast): `src/panel/actions.ts:501–514` in `submit()` — `kind: "submit"` after a real delivery, only when a partial shipped.

### Status machine (state.ts statuses; merge.ts transitions)

Statuses: `open`, `answered`, `reasked`, `submitted`, `closed`, `moot`, `withdrawn`.
- `markSubmitted(state, ids)` — merge.ts:268–271: `setStatus(id, "submitted")` (legal prior `answered`).
- `closeSubmitted(state, ids)` — merge.ts:282–287: `setStatus(id, "closed")` (legal prior `submitted`); called only from lifecycle.ts:227 (agent_settled close pass).
- Rule-2 changed-option upsert: answer reset + status `reasked` (merge.ts:92, 162, 183–193).

## Test inventory (all gate-hold / gateWarning / AC-2d tests)

`src/panel/actions.test.ts` — describe "maybeAutoSubmit — gate hold (AUTOSUBMIT-002, AC-2d)" at :1937:
- :1959 `test_auto_gate_hold_withholds_commit_and_shows_exact_line` — pins the HOLD_FIXTURE withhold + exact hold string. Uses contrived fixture; **keeps working** under the fix (fixture also satisfies the reordered check).
- :1982 `test_auto_answering_gate_releases_next_commit_auto_submit` — hold then release. Still fine.
- :2023 `test_auto_nongate_open_skip_stays_completely_silent` (h2.58) — non-gate open ⇒ no warning. **Must keep passing** — the fix must still return silently when the only unanswered are non-gate… wait: under "arm whenever countUnansweredGate>0 at commit, even when completeness would return", this test has gate answered + non-gate open ⇒ n=0 ⇒ still silent. Safe.
- :2042 `test_auto_open_gate_question_returns_at_completeness_no_hold_line` — **PINS THE BUG** (gate question open ⇒ `gateWarning` null). Must be rewritten/inverted under the fix.
- :2062 `test_auto_gate_hold_respects_gateWarnings_false_silent_withhold` — gateWarnings off ⇒ silent. Fix must extend: silent (no line) but also still no submit when incomplete — semantics preserved.
- :2077 `test_auto_gate_hold_label_follows_remapped_submit_key` — hold string names config-resolved label (Ctrl+Enter).

Also:
- actions.test.ts:1620–1933 describe "maybeAutoSubmit — completeness hook" (AC-2c) — auto-submit-when-complete + zero-pending silence; must be unaffected (fix arms hold only when n>0).
- actions.test.ts:1380–1460 — submit-time `kind: "submit"` warning tests (`test_warning_*`), incl. `test_warning_moot_withdrawn_gate_questions_do_not_count` (:1435, pins countUnansweredGate exclusions via the submit path).
- `src/panel/panel.test.ts:2141–2240` — render tests setting `panel.gateWarning` by hand (both kinds, remapped label, shared-slot precedence). Pure render; unaffected.
- `src/panel/gate.test.ts:132–170` — pure `gateWarningLine`/`gateHoldLine` strings.
- `src/panel/ripple-confirm.test.ts:382` — hand-set submit-kind warning in render context.
- `src/config-surface.test.ts:460` — uses `gateWarningLine(3)` string.
- `src/remote-bridge.test.ts:613`, `src/remote-submit.test.ts:229–295` — bridge tail-hook no-op semantics (zero pending); unaffected unless hold semantics change for the bridge tail.

## Doc references (exact promise lines)

- `README.md:52–53`: "While a foundational gate question is unanswered, auto-submit holds: commits show `⚠ {n} foundational unanswered — answer them or {submit} to submit now` (any key dismisses it), and `ctrl+s` is the deliberate override." (part of the auto-submit paragraph beginning ~:47)
- `spec/ui-spec.md:72` (§ Auto-submit at completeness): "**Gate hold (AUTOSUBMIT-002).** While any gate-group question is `open`/`reasked`, auto-submit is withheld — but note the completeness rule already covers the common case (a gate question is itself unanswered, so the set is not complete and nothing would fire). The observable gate-hold behavior is the EXPLANATION: whenever a commit lands while gate questions remain unanswered, the non-expiring footer warning shows `⚠ {n} foundational unanswered — answer them or {submit} to submit now` …" — **the spec already promises the corrected behavior** ("whenever a commit lands while gate questions remain unanswered"), contradicting the code/test.
- `spec/product-requirements.md:27` (FR-3): "Gate hold (AUTOSUBMIT-002): while gate-group questions are unanswered, commits show the non-expiring `⚠ {n} foundational unanswered — answer them or {submit} to submit now` line instead of auto-submitting; `ctrl+s` overrides deliberately." — also promises the corrected behavior.
- `README.md:147` — config `gateWarnings` comment covers both lines.

## Fix surface

Single function: `src/panel/actions.ts maybeAutoSubmit` (lines 604–641). Reorder so the gate-hold check runs BEFORE (or alongside) the completeness return, e.g.:

1. Compute `unanswered`, `pending`, `gate`, `n = countUnansweredGate(...)` up front.
2. If `n > 0` → withhold (return, no submit, no flash), arming `kind: "hold"` when `panel.config.gateWarnings` — regardless of `unanswered`/`pending`. (This makes the canonical open-gate scenario show the line, matching ui-spec.md:72 and PRD FR-3.)
3. Keep zero-pending silence: if `n === 0 && pending === 0` → silent return. Decision point: should the hold line arm when `n > 0` but `pending === 0` (nothing to ship at all)? The current zero-pending contract says "NO flash, NO submit" (line 613 comment); docs say "whenever a commit lands while gate questions remain unanswered" — a commit landing with pending>0 implies answering something, so pending>0 will normally hold. Simplest faithful fix: arm hold when `n > 0 && pending > 0` (a commit actually landed with something shippable); zero-pending stays fully silent.
4. If `n === 0` fall through to existing completeness logic unchanged (`unanswered > 0` non-gate skip stays silent per h2.58 — that test survives because n=0 there).

Tests to update: `actions.test.ts:2042` (invert: gate open + commit ⇒ hold line armed, no submit); review :2023 (still n=0, passes); consider a new test for the canonical scenario (gate open, later-group commit). No other source changes needed — `gateWarning` plumbing already supports it.

### Callers of `maybeAutoSubmit` (all benefit automatically)
- `src/panel/actions.ts:251` (accept commit tail), `:311` (direct-commit exit), `:204`? no — only 251 & 311.
- `src/panel/ripple-confirm.ts:160, 304` (applied-commit tails).
- `src/index.ts:107–109` (wires panel tail for remote bridge) → `src/remote-submit.ts:165, 181` (bridge tail hook), `src/remote-bridge.ts:350`.

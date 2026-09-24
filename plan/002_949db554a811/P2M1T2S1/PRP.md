---
name: "P2.M1.T2.S1 — AUTOSUBMIT-002 commit-time gate-hold line"
description: "In maybeAutoSubmit (from P2.M1.T1.S1): before firing, count unanswered gate-group questions; if n > 0, WITHHOLD the auto-submit and instead set a new non-expiring, any-key-dismissable footer line `⚠ {n} foundational unanswered — answer them or {submit} to submit now` where {submit} is the config-resolved label from resolveKeyLabels (this.labels.submit — NEVER a hardcoded chord). ctrl+s still submits (override — submit() path untouched, it overwrites the hold line with the legacy submit-time warning). Ordinary non-gate skips: no warning (completeness predicate already returned). Mock nothing."
---

## Goal

**Feature Goal**: AUTOSUBMIT-002 (PRD h2.33 "Gate hold", FR-3, AC-2d): while any gate-group question is `open`/`reasked`, every answer commit withholds auto-submit and instead shows the non-expiring explanation line. The observable change is the explanation + ctrl+s override — soft-gate philosophy holds (never a hard block). The completeness rule (P2.M1.T1.S1) already withholds when a gate question is itself unanswered-and-counted-open; this item supplies the visible reason.

**Deliverable**: (1) new `gateHoldLine(count, submitLabel)` helper in `src/panel/gate.ts`; (2) discriminated `gateWarning` payload on the panel (`kind: "submit" | "hold"`) + rendering branch in `footerNoticeLine`; (3) gate check in `maybeAutoSubmit` (`src/panel/actions.ts`) that withholds and arms the hold line; (4) Mode A JSDoc distinguishing the commit-time hold from the legacy submit-time warning; (5) AC-2d tests in `gate.test.ts` / `actions.test.ts` / `panel.test.ts`.

**Success Definition**: `npm run typecheck` + full `npx vitest run` green. New tests prove: with a gate question unanswered, a commit on an otherwise-complete set shows `⚠ {n} foundational unanswered — answer them or {submit} to submit now` and does NOT call `sendMessage`; answering the gate question releases the next commit's auto-submit (flash `submitted — {n} answer(s)`, one `sendMessage`); ctrl+s submits anyway (legacy warning follows per existing behavior); non-gate skips show no warning; any key dismisses the hold line and the dismissing key still acts.

## User Persona

**Target User**: The TUI answerer filling out later groups before finishing the foundational (gate) group.

**Use Case**: User answers everything except a gate question; the panel explains why nothing shipped and how to force it, instead of silently doing nothing.

**User Journey**: answer later-group questions → commit on complete-except-gate set → footer shows `⚠ 1 foundational unanswered — answer them or Ctrl+S to submit now` (non-expiring) → any key dismisses / user answers the gate question → next commit auto-submits → or user presses ctrl+s to ship now.

**Pain Points Addressed**: silent withholding confusion; hard gates would trap the user (rejected by h2.56).

## Why

- PRD h2.33 (AUTOSUBMIT-002), h2.8/FR-3, h2.10 AC-2d, h2.51 M8 (`maybeAutoSubmit` bullet: "gate questions unanswered → ⚠ hold line + no auto-submit"), h2.58 AUTOSUBMIT-002 pin, h2.29 (soft-gate rendering).
- FR-D5 (verbatim): `⚠ {n} foundational unanswered — answer them or {submit} to submit now` — a DIFFERENT string from the legacy submit-time `…later answers may shift` by design; keep both.
- Consumes `maybeAutoSubmit` from P2.M1.T1.S1 (contract: exports `maybeAutoSubmit(panel, deps?)` in `src/panel/actions.ts`, placed after `submit()`, wired at the four commit tails; completeness predicate = zero open/reasked + ≥1 answered; flash `submitted — {n} answer(s)` after `submit()` returns true).

## What

### Behavior contract (exact)

1. **`gate.ts` — new helper** (place after `gateWarningLine`, add to exports):

   ```ts
   export function gateHoldLine(count: number, submitLabel: string): string {
     return `⚠ ${count} foundational unanswered — answer them or ${submitLabel} to submit now`;
   }
   ```

   `gateWarningLine` (gate.ts:94) stays VERBATIM — it is the legacy ctrl+s submit-time path. Mode A JSDoc on both: hold line = commit-time (maybeAutoSubmit withholding, names the override key); warning line = submit-time (post-delivery caveat `later answers may shift`, actions.ts submit() :509-511). Two strings, two moments, by design (h2.33).

2. **`panel.ts` — discriminated `gateWarning` payload.** Change the field type:

   ```ts
   gateWarning:
     | { count: number; kind: "submit" }
     | { count: number; kind: "hold"; submitLabel: string }
     | null = null;
   ```

   Update `footerNoticeLine(width)` (:1179) to pick the string by kind:
   - `kind: "submit"` → `renderGateWarningLine(gateWarningLine(count), theme, width)` (unchanged).
   - `kind: "hold"` → `renderGateWarningLine(gateHoldLine(count, submitLabel), theme, width)`.

   Presentation, stage-0 any-key dismissal (handleInput :749-751, "dismiss + act"), non-expiring semantics, confirmMode suppression, and flash-priority all reuse the existing `gateWarning` slot VERBATIM — no new field, no new dismissal logic. Import `gateHoldLine` next to the existing `gateWarningLine` import (:82).

3. **`actions.ts` — the gate check inside `maybeAutoSubmit`** (from P2.M1.T1.S1). Insert AFTER the zero-pending early-return (so zero-pending still no-ops silently) and BEFORE calling `submit()`:

   ```ts
   // AUTOSUBMIT-002 gate hold: while gate-group questions are unanswered,
   // withhold the auto-submit and explain (FR-D5). config.gateWarnings off
   // ⇒ withhold silently (display toggle governs both gate strings).
   const gate = gateGroupNames(ordered);
   const n = countUnansweredGate(ordered, gate);
   if (n > 0) {
     if (panel.config.gateWarnings) {
       panel.gateWarning = { count: n, kind: "hold", submitLabel: panel.labels.submit };
       panel.invalidate();
     }
     return; // no submit, no flash — ctrl+s is the deliberate override
   }
   ```

   - `panel.labels` is the `resolveKeyLabels(config)` map resolved at construction (panel.ts:612). NEVER interpolate a literal chord — the no-hardcoded-keys guard regex-matches `ctrl+[a-z0-9]` anywhere in non-test src (comments stripped).
   - No flash on the hold path (the hold line itself is the notice; flashes never stack over it).
   - The completeness predicate from T1.S1 runs FIRST: ordinary non-gate skips (any open/reasked non-gate question) return before this check — NO warning for them (footer counts already show the remainder; h2.58 AUTOSUBMIT-002 pin).

4. **ctrl+s override — zero changes.** `submit()` already sets `panel.gateWarning = { count: unansweredGate }` after delivery (:509-511). Update that assignment to `{ count: unansweredGate, kind: "submit" }` for the new type. Delivery behavior byte-identical whether gates are unanswered or not (h2.56). The hold line is simply overwritten by the submit-time warning when the user overrides.

5. **Docs [Mode A]**:
   - `gate.ts` module header + `gateHoldLine`/`gateWarningLine` JSDoc: the two-moment distinction (commit-time hold names the override key and withholds nothing manually; submit-time warning rides a delivered partial).
   - `maybeAutoSubmit` JSDoc (added in T1.S1): extend with the gate-hold branch — withholds + arms `kind:"hold"` line; ctrl+s overrides via the unchanged submit path; `config.gateWarnings` off = silent withhold.
   - `panel.ts` `gateWarning` field JSDoc: document the two kinds.

### Success Criteria (AC-2d)

- [ ] Gate question unanswered, otherwise-complete set, commit (accept/write-in/text enter) → footer shows exactly `⚠ {n} foundational unanswered — answer them or {submit} to submit now` (with the resolved label), `sendMessage` NOT called, no `submitted — …` flash.
- [ ] Answering the gate question, then committing the last non-gate question (or the gate question itself) → auto-submit fires (one `sendMessage`, flash `submitted — {n} answer(s)`, epoch +1).
- [ ] `ctrl+s` while the hold line shows → submission delivers anyway; gateWarning becomes the legacy `later answers may shift` line.
- [ ] Commit with a NON-gate question still open → no warning of any kind (pre-existing completeness return).
- [ ] Any key dismisses the hold line and the same keypress performs its own action (stage-0 reuse — assert via existing dismissal test pattern).
- [ ] With remapped `keys.submit` (e.g. `ctrl+enter`), the hold line shows the remapped label (`Ctrl+Enter`), never `ctrl+s`.
- [ ] `config.gateWarnings: false` → withhold silently, no line.
- [ ] Legacy submit-time warning string and its tests unchanged.

## All Needed Context

### Context Completeness Check

Every seam is named: the helper placement, the exact hold string, the panel field discriminated union and render branch, the insertion point inside maybeAutoSubmit (after zero-pending return, before submit()), the label source (`panel.labels.submit`), the dismissal reuse, the ctrl+s interplay, and the test homes with existing fixture names. No prior codebase knowledge needed.

### Documentation & References

```yaml
- file: src/panel/gate.ts
  why: home for gateHoldLine; countUnansweredGate (:79) + gateGroupNames (:58) are the count helpers; gateWarningLine (:94) stays verbatim (legacy); module-header Mode A doc gets the two-moment distinction
  pattern: existing JSDoc density (contract refs + consumption map)
  gotcha: do NOT touch gateWarningLine or its assertions (gate.test.ts:135-136, panel.test.ts:1957, layout.test.ts:440, config-surface.test.ts:461)

- file: src/panel/panel.ts
  why: gateWarning field (:457) becomes the discriminated union; footerNoticeLine (:1179) gains the kind branch; handleInput stage 0 (:749-751) any-key dismissal reused UNCHANGED; this.labels (:612); gateWarningLine import (:82) — add gateHoldLine
  pattern: keep the shared single notice slot (flashes never stack, h2.37); confirmMode suppression already covers both kinds
  gotcha: hold string must reach the renderer pre-interpolated or with submitLabel — footerNoticeLine has no config access, hence submitLabel stored on the payload

- file: src/panel/actions.ts
  why: maybeAutoSubmit (from P2.M1.T1.S1, placed after submit()) gains the gate check; submit() (:509-511) gateWarning assignment gains kind:"submit"; countUnansweredGate/gateGroupNames already imported (:28)
  pattern: set the notice + invalidate before returning (mirror submit()'s defensive invalidate)
  gotcha: insert AFTER the zero-pending early-return (zero-pending stays silent); never flash on the hold path

- file: src/config.ts
  why: resolveKeyLabels (:449) — label source; the no-hardcoded-keys guard regex-matches `ctrl+[a-z0-9]` in non-test src with comments stripped, so "ctrl+s" must never appear in the new code
  pattern: labels flow via panel.labels (config.ts:449 → panel.ts:612)

- file: src/panel/actions.test.ts
  why: AC-2d tests — seed (:74, inject gate:true via overrides), makePanel (:100), makeDeps (:117, { sendMessage: vi.fn(), isIdle }); existing submit describe (:511) shows assertion patterns
  pattern: expect(deps.sendMessage).not.toHaveBeenCalled(); expect(panel.footerFlash).toBeUndefined(); assert panel.gateWarning payload + rendered line via panel.render(80)

- file: src/panel/gate.test.ts
  why: gateHoldLine unit tests — exact strings incl. a custom label ("Ctrl+Enter") and the default ("Ctrl+S")

- file: src/panel/panel.test.ts
  why: rendering + dismissal test for kind:"hold" (mirror the :1957 legacy-warning block); any-key dismissal + dismiss-and-act assertion

- file: plan/002_949db554a811/P2M1T1S1/PRP.md
  why: CONTRACT — maybeAutoSubmit's shape, placement, wiring sites, and flash string; this item only inserts the gate check
  gotcha: anchor by function name; T1.S1 may still be landing — assume its contract verbatim

- prd: h2.33 (AUTOSUBMIT-002 verbatim), h2.8/FR-3 (FR-D5), h2.10 AC-2d, h2.29 (gate rendering), h2.51 M8, h2.58 (AUTOSUBMIT-002 pin: ordinary skips get no warning)
```

### Current Codebase tree (relevant slice)

```bash
src/panel/
  gate.ts            # MODIFY — add gateHoldLine + export + JSDoc (legacy untouched)
  panel.ts           # MODIFY — gateWarning union, footerNoticeLine branch, +1 import
  actions.ts         # MODIFY — gate check in maybeAutoSubmit; kind:"submit" on submit()'s assignment
  gate.test.ts       # MODIFY — gateHoldLine unit tests
  actions.test.ts    # MODIFY — AC-2d withhold/release/override tests
  panel.test.ts      # MODIFY — hold-line render + dismissal tests
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: the hold string is a DIFFERENT string from the legacy one BY
// DESIGN (h2.33) — do not unify them.
// CRITICAL: never write "ctrl+s" (any case) in src — the keymap guard
// regex-matches ctrl+[a-z0-9] with comments stripped. Interpolate
// panel.labels.submit only.
// GOTCHA: the completeness return (any open/reasked) runs BEFORE the gate
// check — that's what makes ordinary non-gate skips warning-free.
// GOTCHA: countUnansweredGate counts answer-undefined non-terminal gate
// questions; a re-asked gate question has its answer reset, so it counts —
// correct per FR-D5.
// GOTCHA: zero-pending early-return must stay silent (no hold line when
// there's nothing to ship — e.g. the completeness-with-gate-open case where
// maybeAutoSubmit returns at the unanswered check anyway).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/panel/gate.ts
  - ADD: gateHoldLine(count, submitLabel) with verbatim template `⚠ ${count} foundational unanswered — answer them or ${submitLabel} to submit now`
  - ADD: to exports; Mode A JSDoc on gateHoldLine + gateWarningLine distinguishing commit-time hold vs submit-time warning
  - KEEP: gateWarningLine byte-identical

Task 2: MODIFY src/panel/panel.ts
  - CHANGE: gateWarning field type to the discriminated union (kind:"submit" | kind:"hold" + submitLabel)
  - CHANGE: footerNoticeLine to branch on kind (import gateHoldLine)
  - UNCHANGED: stage-0 dismissal, non-expiring semantics, confirmMode suppression, field JSDoc updated for two kinds

Task 3: MODIFY src/panel/actions.ts
  - INSERT: gate check in maybeAutoSubmit after zero-pending return, before submit() call (code block in What §3)
  - CHANGE: submit()'s panel.gateWarning assignment (:509-511) to include kind:"submit"
  - EXTEND: maybeAutoSubmit JSDoc with the hold branch

Task 4: MODIFY src/panel/gate.test.ts
  - ADD: gateHoldLine exact-string tests (default label "Ctrl+S", remapped "Ctrl+Enter", n interpolation)

Task 5: MODIFY src/panel/actions.test.ts
  - ADD: AC-2d describe — withhold (no sendMessage, no flash, gateWarning kind:"hold"), release (answer gate → next commit fires), ctrl+s override (submit delivers; gateWarning becomes kind:"submit"), non-gate skip (no warning), gateWarnings:false silent withhold

Task 6: MODIFY src/panel/panel.test.ts
  - ADD: hold-line render test (exact rendered string incl. resolved label) + any-key dismiss-and-act test (mirror :1957 block)
```

### Implementation Patterns & Key Details

```ts
// footerNoticeLine branch (panel.ts)
if (this.gateWarning !== null) {
  const text =
    this.gateWarning.kind === "hold"
      ? gateHoldLine(this.gateWarning.count, this.gateWarning.submitLabel)
      : gateWarningLine(this.gateWarning.count);
  return renderGateWarningLine(text, this.theme, width);
}

// maybeAutoSubmit hold branch (actions.ts) — see What §3 for the verbatim block.
// PATTERN: display-only notice set + invalidate + early return; delivery
// machinery untouched. ctrl+s override needs NO code — submit() already
// overwrites gateWarning post-delivery.
```

### Integration Points

```yaml
CONFIG:
  - no new keys; consumes config.keys.submit (via resolveKeyLabels) and config.gateWarnings (governs the hold line like the legacy warning)
TESTS:
  - keymap guard (config-surface tests) must stay green — no hardcoded chords in src
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck        # union change touches panel.ts consumers — must be clean
npx vitest run src/panel/gate.test.ts src/panel/panel.test.ts src/panel/actions.test.ts
```

### Level 2: Unit / behavior tests

```bash
npx vitest run src/panel/            # all panel suites green
npx vitest run                       # full suite (legacy string assertions elsewhere must stay green)
```

### Level 3: Scenario walkthrough (scripted in actions.test.ts / panel.test.ts)

- complete-except-gate commit → hold line shown, no sendMessage
- answer gate → next commit auto-submits, flash, epoch +1
- ctrl+s while held → delivers; legacy warning line
- remapped submit key → label reflects remap

## Final Validation Checklist

- [ ] `npm run typecheck` clean; full `npx vitest run` green
- [ ] Hold line string EXACTLY `⚠ {n} foundational unanswered — answer them or {submit} to submit now` with resolved label
- [ ] Legacy `…later answers may shift` string + tests untouched
- [ ] No `ctrl+<key>` literal anywhere in non-test src (keymap guard)
- [ ] ctrl+s override, non-gate silence, zero-pending silence, gateWarnings-off silence all covered by tests
- [ ] AC-2d's three observables scripted: withhold+⚠, release, override

## Anti-Patterns to Avoid

- ❌ Don't gate/block ctrl+s — soft gate only (h2.56)
- ❌ Don't add a second notice field — one slot, discriminated payload
- ❌ Don't warn on ordinary non-gate skips
- ❌ Don't hardcode the chord in the string or tests of src code (tests may assert with resolved labels)
- ❌ Don't reimplement the warning logic in submit() — it already exists

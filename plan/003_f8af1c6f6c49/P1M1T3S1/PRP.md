---
name: "FR-D10 — statusMarkers: add ★ answered marker (overview parity)"
description: "Add the ★ answered marker to the short-view question line's statusMarkers vocabulary in src/panel/layout.ts, with exact overview parity (answered/submitted/closed with answer; moot/withdrawn excluded; ⟳ overrides; composes with ✎)."
---

## Goal

**Feature Goal**: Implement FR-D10 / ANSWER-PIN-001's last display clause: the short-view question line carries the answered marker (`★ answered`), with EXACT parity to the overview's answered-row vocabulary (`src/panel/overview.ts` markerParts: "★ answered — any status carrying `q.answer` EXCEPT moot/withdrawn (answered/submitted/closed)"). `⟳ re-asked` overrides ★; ★ composes with the existing `✎ text answer` marker for write-ins/text/elaborations.

**Deliverable**: Modified `src/panel/layout.ts` (`statusMarkers` + Mode A JSDoc) and updated/extended `src/panel/layout.test.ts`. No other production files.

**Success Definition**: marker present for answered/submitted/closed questions with an answer; absent for open/moot/withdrawn; `⟳ re-asked` alone on re-asked; `★ answered · ✎ text answer` for write-ins; `npm run typecheck` + `npm test` green (flipped exact-string expectations triaged, none deleted).

## User Persona (if applicable)

**Target User**: The pi user filling the interrogation panel.

**Use Case**: Revisiting an already-answered question — the question line now states at a glance which questions carry recorded answers, not just re-asks and moots.

**User Journey**: User answers q3 → its question line shows `★ answered`; a write-in shows `★ answered · ✎ text answer`; after submit it keeps ★; after agent settle (closed) it keeps ★.

**Pain Points Addressed**: ANSWER-PIN-001 live finding — "the accent highlight alone carried the signal" for which questions were answered; FR-35's final clause makes the question line state it explicitly.

## Why

- FR-35 (h2.8/h3.5, last sentence): "The short-view question line carries the answered marker (★, per the glyph vocabulary — parity with the overview's answered rows)." FR-11 (overview) already ships ★; the short view was missing it.
- h2.28's answered-count rule (answer present ∧ status ∈ {answered, submitted, closed}) established the single record-derived source of truth for "answered" — this marker reuses exactly that rule, so the question line can never disagree with the footer counter again.
- Consumed by the AC-16 walk-through (P1.M1.T5.S10); this subtask is the vocabulary change, S9/S10 handle cross-cutting flips.

## What

1. **`src/panel/layout.ts` `statusMarkers`** (~:313): add to `parts` —
   ```ts
   if (
     q.answer !== undefined &&
     (q.status === "answered" || q.status === "submitted" || q.status === "closed")
   ) {
     parts.push("★ answered");
   }
   ```
   Placement in `parts`: after the `⟳ re-asked` push, before the `✎ text answer` push, so an answered write-in renders `" ★ answered · ✎ text answer"`. The ⟳ override needs no explicit suppression — status `"reasked"` fails the whitelist by construction. moot/withdrawn with answers stay marker-★-free (they keep `⊘`/`⊗` exactly as today).
2. **Mode A JSDoc on `statusMarkers`**: add ★ to the marker list; state the parity rule verbatim ("★ answered — any status carrying `q.answer` EXCEPT moot/withdrawn (answered/submitted/closed), parity with overview.ts markerParts / FR-D10"); note ⟳ overrides ★ and that ★ composes with ✎ (joined with " · ").
3. **Tests — `src/panel/layout.test.ts`** (describe "statusMarkers", :147-210):
   - NEW: ★ per status (answered/submitted/closed with a plain option answer → `" ★ answered"`); exclusions (open → `""` unchanged; moot with answer → moot markers only; withdrawn → `⊗` only; reasked with answer → `" ⟳ re-asked"` only).
   - NEW: write-in composition — answered write-in (custom: true) → `" ★ answered · ✎ text answer"`; text question answered → same.
   - FLIP (TDD-first): the exact-string pins listed in the blast-radius table below.
4. **Do NOT touch**: `src/panel/overview.ts` (it is the parity SOURCE, already correct), `renderQuestionLine` width logic (markers are measured via `visibleWidth`, ANSI-safe — no change needed), and `overview.test.ts` ~:412/:452 (verified: those are cursor/preselect assertions, not question-line parity — they belong to P1.M1.T5.S9).

### Success Criteria

- [ ] `statusMarkers` emits `" ★ answered"` for answered/submitted/closed with answer; `""` for open; no ★ for moot/withdrawn/reasked
- [ ] Composition: answered write-in/text → `" ★ answered · ✎ text answer"`; closed option answer → `" ★ answered"` alone
- [ ] Corrupt-truthy `custom` (strict `=== true` discipline): answered with `custom: "yes"` → `" ★ answered"` (★ yes, ✎ no)
- [ ] Mode A JSDoc updated with semantics + parity rule
- [ ] Full suite green — flipped expectations updated (incl. any full-line `renderQuestionLine` integration pins that embed the marker string), none deleted

## All Needed Context

### Context Completeness Check

The PRP contains the exact current function body, the exact insert rule and parts ordering, the parity vocabulary quoted from overview.ts, the verified list of every exact-string test that flips, and the test helper shape. An agent needs only `src/panel/layout.ts` + `src/panel/layout.test.ts`.

### Documentation & References

```yaml
- file: src/panel/layout.ts
  why: "THE file — statusMarkers (:313, parts array + join + dim wrap), hasTextAnswer (:192, note: closed is NOT covered there — ★ covers closed independently), renderQuestionLine (:362 consumer, width accounting already ANSI-safe)"
  pattern: "parts: string[] pushes in order ⟳, [NEW ★], ✎, ⊘, ⊗; return parts.length===0 ? '' : theme.fg('dim', ' ' + parts.join(' · '))"
  gotcha: "do not gate ★ behind hasTextAnswer — closed answers must get ★ but hasTextAnswer excludes closed; and do not add explicit reasked suppression, the whitelist excludes it"

- file: src/panel/overview.ts
  why: "PARITY SOURCE — markerParts JSDoc :107-127 (the vocabulary), overviewMarker :151; read-only, do not modify"
  pattern: "★ = any status carrying q.answer EXCEPT moot/withdrawn; ⟳ overrides ★; ✎ suffix composes with ★"

- file: src/panel/layout.test.ts
  why: "test conventions + the exact pins that flip (see blast-radius table); mkQuestion(id, overrides) helper :44, shared theme fixture, full themed strings asserted"
  pattern: "expect(statusMarkers(mkQuestion('q1', {status:'answered', answer:{value:'a', at:'…'}}), theme)).toBe(' ★ answered')"

- file: plan/003_f8af1c6f6c49/architecture/panel-ui-seams.md
  why: "§Markers — the architecture seam contract for this exact change (layout.ts:313, parity source, ✎ composition)"
  section: Markers (FR-D10)

- file: plan/003_f8af1c6f6c49/P1M1T3S1/research/notes.md
  why: "verified line-by-line research — insert rule, ordering rationale, blast-radius list, overview vocabulary quotes"

- file: plan/003_f8af1c6f6c49/P1M1T2S4/PRP.md
  why: "parallel contract (same-value commits inert) — shares ANSWER-PIN-001 scope but touches accept paths, not rendering; no overlap, no dependency"
  gotcha: "if S4's inert-commit tests also pin marker strings, run the full suite and reconcile — marker flips belong to THIS subtask"
```

### Current Codebase tree (relevant slice)

```bash
src/panel/
  layout.ts           # statusMarkers, hasTextAnswer, renderQuestionLine (the only production file touched)
  layout.test.ts      # statusMarkers describe (:147-210) + renderQuestionLine tests
  overview.ts         # parity SOURCE (markerParts/overviewMarker) — read-only
  overview.test.ts    # :412/:452 verified as cursor tests — NOT parity, leave for S9
```

### Desired Codebase tree

```bash
# No new files — modifications only:
src/panel/layout.ts        # +★ push + JSDoc
src/panel/layout.test.ts   # +★ cases, flipped exact-string pins
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: ★ is gated ONLY on (answer !== undefined && status ∈ {answered, submitted, closed}) — the h2.28 answered-count rule, byte-for-byte.
// CRITICAL: hasTextAnswer excludes closed — do not reuse it for ★; closed answers get ★ alone.
// ⟳ override is implicit (reasked fails the whitelist) — do NOT add status checks that would also exclude reasked-with-answer from ⟳.
// Marker glyphs may be double-width — the existing visibleWidth accounting in renderQuestionLine handles this; never assume 1 col/glyph.
// strict custom === true discipline (corrupt truthy values must not earn ✎) — inherited from hasTextAnswer, unchanged.
// Answer shape in tests: { value, at: "2026-01-01T00:00:00Z", custom?, text? } per existing fixtures.
```

## Implementation Blueprint

### Data models and structure

No data-model changes — rendering only. Input: `Question` from state.ts (already carries `answer` + `status`).

### Test blast radius (verified exact-string pins in layout.test.ts that FLIP)

| Line | Current expectation | New expectation |
|------|--------------------|-----------------|
| :173 | answered text question → ` ✎ text answer` | ` ★ answered · ✎ text answer` |
| :178 | submitted choice + elaboration → ` ✎ text answer` | ` ★ answered · ✎ text answer` |
| :186 | answered write-in → ` ✎ text answer` | ` ★ answered · ✎ text answer` |
| :194 | submitted write-in → ` ✎ text answer` | ` ★ answered · ✎ text answer` |
| :202 | corrupt-truthy custom, answered → `""` | ` ★ answered` (✎ still absent) |
| :210 | plain answered option → `""` | ` ★ answered` — RENAME the test (`plain_option_answer_now_shows_star_answered`) — its old premise is what FR-D10 deletes |
| :149/:153/:156/:162 | open / reasked / withdrawn / moot | unchanged |

Also: run `npx vitest run src/panel/ -v` and reconcile ANY other suite embedding the marker string in full-line pins (e.g. renderQuestionLine integration tests, AC suites) — flip expectations there too; report anything beyond layout.test.ts in the subtask result.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: TDD — NEW tests first (src/panel/layout.test.ts, describe "statusMarkers")
  - ★ per status: answered/submitted/closed + plain option answer → " ★ answered"
  - exclusions: open ""; moot-with-answer → moot only; withdrawn → ⊗ only; reasked-with-answer → " ⟳ re-asked" only
  - composition: answered write-in → " ★ answered · ✎ text answer"; text-question answered → same
  - corrupt-truthy custom answered → " ★ answered" (no ✎)
  - WATCH them fail (★ never emitted today)

Task 2: MODIFY src/panel/layout.ts statusMarkers
  - INSERT the ★ push between the ⟳ push and the hasTextAnswer push (exact snippet in What §1)
  - UPDATE the JSDoc marker list + parity rule (Mode A)

Task 3: FLIP the blast-radius pins (table above)
  - rename the :210 test; update the six expectations
  - RUN: npx vitest run src/panel/layout.test.ts -v → green

Task 4: FULL-SUITE RECONCILIATION
  - RUN: npm test — any other suite pinning the marker string in full lines gets its expectation flipped (never deleted)
  - Leave overview.ts/overview.test.ts alone (parity source + S9's scope)
```

### Implementation Patterns & Key Details

```ts
// Final parts order inside statusMarkers (visual order on the line):
//   ⟳ re-asked | ★ answered | ✎ text answer | ⊘ moot (+reason) | ⊗ withdrawn
// Only mutually-applicable ones join (⟳ never coexists with ★; ⊘/⊗ never coexist with ★).
// Example renders (leading space + dim wrap, as today):
//   " ★ answered"                       — answered/submitted/closed, plain option
//   " ★ answered · ✎ text answer"       — write-in / text question / elaborated choice (answered|submitted)
//   " ⟳ re-asked"                       — reasked (with or without answer)
//   " ⊘ moot <reason>"                  — moot, answer text as reason, unchanged
```

### Integration Points

```yaml
NO-WIRING-CHANGES:
  - "renderQuestionLine (layout.ts:362) already consumes statusMarkers; width accounting (visibleWidth, marker-reserve) needs no change"
  - "overview.ts untouched — parity source"
CONSUMERS-DOWNSTREAM:
  - "P1.M1.T5.S9 (cross-cutting suite flips) and P1.M1.T5.S10 (AC-16 walk-through) consume the new vocabulary — this subtask must land first"
DO-NOT-TOUCH:
  - "hasTextAnswer (:192) — its closed-exclusion is correct for ✎ semantics; ★ covers closed separately"
  - "MARKER_REASON_CAP, truncateVisible, dim-wrap mechanics"
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck   # tsc --noEmit — clean
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/layout.test.ts -v   # statusMarkers describe fully green after flip
npm test                                     # full suite — reconcile any other marker-string pins
```

### Level 3: Integration Testing

Not applicable — pure rendering function; no runtime surface beyond the panel line (AC-16 walk-through is P1.M1.T5.S10's deliverable).

### Level 4: Creative & Domain-Specific Validation

```bash
# Parity spot-check against the overview vocabulary (same question shapes, both markers):
npx vitest run src/panel/overview.test.ts -v   # must stay green UNTOUCHED — proves parity without editing it
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean
- [ ] `npm test` fully green (flips reconciled, nothing deleted)

### Feature Validation

- [ ] ★ present for answered/submitted/closed with answer; absent otherwise
- [ ] ⟳ override and moot/withdrawn exclusions hold
- [ ] ★ + ✎ composition renders for write-ins
- [ ] overview parity verified (overview suite untouched and green)

### Code Quality Validation

- [ ] Only layout.ts + layout.test.ts modified in production/test terms
- [ ] ★ gating reuses the h2.28 answered rule verbatim (no new "answered" definition)
- [ ] Strict `custom === true` discipline preserved for ✎

### Documentation & Deployment

- [ ] statusMarkers JSDoc states marker semantics + parity rule (Mode A)
- [ ] No new dependencies, no config changes

---

## Anti-Patterns to Avoid

- ❌ Don't gate ★ behind `hasTextAnswer` — it excludes closed, and ★ must cover closed (h2.38 archived questions still show ★ per the overview vocabulary)
- ❌ Don't touch overview.ts "for consistency" — it IS the consistency source
- ❌ Don't add explicit reasked-suppression logic — the whitelist already excludes it; extra checks invite drift
- ❌ Don't delete or skip the flipped tests — rename/extend them (the :210 test's premise is obsolete, its replacement is mandatory)
- ❌ Don't hardcode a second "answered" definition — reuse the exact status whitelist from h2.28/overview markerParts
- ❌ Don't edit overview.test.ts :412/:452 — verified cursor tests, S9's territory

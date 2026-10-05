---
name: "P1.M1.T3.S7 — FR-D10: statusMarkers ★ answered marker (overview parity)"
description: "Add the `★ answered` marker to the short-view question line's statusMarkers vocabulary in src/panel/layout.ts, with exact overview parity (answered/submitted/closed carrying an answer; moot/withdrawn excluded; ⟳ overrides by construction; composes with ✎). Flip the exact-string test pins in layout.test.ts; touch nothing else."
---

## Goal

**Feature Goal**: Implement FR-D10 (ANSWER-PIN-001 / FR-35's final display clause, spec M9): the short-view question line carries the answered marker `★ answered`, with EXACT parity to the overview's answered-row vocabulary (`src/panel/overview.ts` markerParts: "★ answered — any status carrying `q.answer` EXCEPT moot/withdrawn (answered/submitted/closed)"). `⟳ re-asked` overrides ★; ★ composes with the existing `✎ text answer` marker.

**Deliverable**: Modified `src/panel/layout.ts` (`statusMarkers` body + its Mode A JSDoc) and updated `src/panel/layout.test.ts` (flipped exact-string pins + new coverage). NO other production or test files.

**Success Definition**: `statusMarkers` emits `" ★ answered"` for answered/submitted/closed questions carrying an answer; `""` for open; no ★ for moot/withdrawn/reasked; `" ★ answered · ✎ text answer"` for answered write-ins/text/elaborations; `npm run typecheck` and `npm test` fully green (flipped expectations updated, none deleted, one misleading test name renamed).

## User Persona (if applicable)

**Target User**: The planner (human) filling the interrogation panel.

**Use Case**: Revisiting or scanning the short view mid-interrogation — the question line now states at a glance which question carries a recorded answer, instead of only re-asks, moots, and write-ins being visible.

**User Journey**: User answers q3 with an option → its question line shows `★ answered`; a write-in shows `★ answered · ✎ text answer`; after `ctrl+s` (submitted) and after the agent settles (closed) the ★ persists; navigating back (FR-35 caret pinning, already shipped in S1–S6) the line and the caret now agree.

**Pain Points Addressed**: ANSWER-PIN-001 live finding — on revisit "the accent highlight alone carried the signal" for which questions were answered; FR-35's last clause makes the question line state it explicitly, matching the overview (FR-11).

## Why

- FR-35 (spec h3.5, final sentence): "The short-view question line carries the answered marker (★, per the glyph vocabulary — parity with the overview's answered rows)." Implementation-plan M9: "`panel/layout.ts`: answered marker (★) on the short-view question line — parity with the overview's answered rows."
- h2.28's record-derived answered rule (`answer` present ∧ status ∈ {answered, submitted, closed}) is already the footer/header counter's single source of truth — this marker reuses exactly that rule, so the question line can never disagree with the counts.
- Consumed by AC-16's scripted walk-through (P1.M1.T5.S10); this subtask is the vocabulary change only — cross-cutting suite flips belong to T5/S9–S10, comment sweeps to T4/S8.
- `src/panel/short-view.ts:13`'s module vocabulary table already documents "question lines reuse ★ as the answered/text-answer marker (layout.ts statusMarkers)" — the code is catching up to the documented vocabulary, so no doc drift is introduced.

## What

1. **`src/panel/layout.ts` `statusMarkers` (:313)** — insert a new part between the `⟳ re-asked` push and the `hasTextAnswer` push (exact insert below in Implementation Blueprint). Resulting parts order: `⟳ re-asked` (exclusive), `★ answered` (NEW), `✎ text answer`, `⊘ moot (+reason)`, `⊗ withdrawn` — mutually exclusive statuses mean ★ and ⟳ never co-occur; an answered write-in renders `" ★ answered · ✎ text answer"`.
2. **Mode A JSDoc on `statusMarkers` (~:296-312)** — add ★ to the marker list; state the parity rule (verbatim from overview.ts markerParts JSDoc :111-112: "★ answered — any status carrying `q.answer` EXCEPT moot/withdrawn (answered/submitted/closed — h2.38 archived questions still show ★)"); note ⟳ overrides ★ and that ★ composes with ✎ (joined with `" · "`).
3. **`src/panel/layout.test.ts`** — flip the five exact-string pins listed in the blast-radius table below; RENAME the one test whose name asserts the deleted premise; add new per-status coverage; strengthen the BUG-005 composed-line test to also assert `★ answered`.
4. **Do NOT touch**: `src/panel/overview.ts` (parity SOURCE, already correct), `hasTextAnswer` (its answered/submitted-only whitelist is an existing deliberate contract — ★ carries closed independently), `renderQuestionLine` width logic (markers measured via `visibleWidth`, ANSI-safe, already handles new content), `src/panel/short-view.ts` (its vocabulary comment is already correct), overview.test.ts / panel.test.ts / actions.test.ts (no marker pins there; cross-cutting flips are T5's scope).

### Success Criteria

- [ ] `statusMarkers`: answered/submitted/closed with answer → `" ★ answered"`; open → `""`; reasked (even with a residual answer) → `" ⟳ re-asked"` only; moot with answer → moot markers only; withdrawn → `" ⊗ withdrawn"` only
- [ ] Composition: answered/submitted write-in, text answer, or elaborated option → `" ★ answered · ✎ text answer"`; closed plain option answer → `" ★ answered"` alone
- [ ] Corrupt-truthy `custom` discipline preserved: answered with `custom: "yes"` → `" ★ answered"` (★ yes — record-derived; ✎ no — strict `=== true`)
- [ ] Mode A JSDoc updated with ★ semantics + the overview-parity rule
- [ ] `npm run typecheck` and `npm test` fully green — flipped expectations updated in place, none deleted, `plain_option_answer_still_no_marker` renamed (its "no marker" premise is exactly what FR-D10 deletes)

## All Needed Context

### Context Completeness Check

This PRP contains the exact current function body, the exact insert rule and parts ordering, the parity vocabulary quoted from overview.ts, the verified per-line list of every exact-string test that flips, the test helper shape, and the explicit do-not-touch list. An implementer needs only `src/panel/layout.ts` + `src/panel/layout.test.ts` + this document.

### Documentation & References

```yaml
- file: src/panel/layout.ts
  why: "THE file — statusMarkers (:313, parts array + join + dim wrap), hasTextAnswer (:192), renderQuestionLine (:346, consumes markers ~:362)"
  pattern: "parts: string[] pushes in order ⟳, [NEW ★], ✎, ⊘, ⊗; return parts.length === 0 ? '' : theme.fg('dim', ' ' + parts.join(' · '))"
  gotcha: "do NOT gate ★ behind hasTextAnswer — hasTextAnswer excludes closed, ★ must cover closed; do NOT add explicit reasked suppression — the status whitelist excludes it by construction"

- file: src/panel/overview.ts
  why: "PARITY SOURCE (READ-ONLY) — markerParts JSDoc :107-127 (the vocabulary), markerParts impl :130, overviewMarker :151"
  pattern: "★ = any status carrying q.answer EXCEPT moot/withdrawn; ⟳ re-asked OVERRIDES ★; ✎ suffix composes with ★"
  gotcha: "never modify this file in this subtask — it defines what parity means"

- file: src/panel/layout.test.ts
  why: "test conventions + every exact pin that flips (blast-radius table below); mkQuestion(id, overrides) helper :44; identity theme stub so tests assert full strings INCLUDING the leading space"
  pattern: "expect(statusMarkers(mkQuestion('q1', {status:'answered', answer:{value:'a', at:'2026-01-01T00:00:00Z'}}), theme)).toBe(' ★ answered')"

- file: plan/003_f8af1c6f6c49/architecture/panel-ui-seams.md
  why: "§Markers (FR-D10) — the architecture seam contract for this exact change (layout.ts:313, parity source, ✎ composition)"
  section: "Markers (FR-D10)"

- file: plan/003_f8af1c6f6c49/P1M1T3S7/research/notes.md
  why: "line-by-line verification of every claim in this PRP against the post-S1–S6 codebase (git 2d7a98f), incl. the grep proof that no suite outside layout.test.ts pins marker strings"

- file: spec/product-requirements.md
  why: "FR-35 final clause + AC-16 (the acceptance scenario this marker feeds)"
  section: "h3.5 Answer pinning"
```

### Current Codebase tree (relevant slice)

```bash
src/panel/
  layout.ts           # statusMarkers :313, hasTextAnswer :192, renderQuestionLine :346 — the ONLY production file touched
  layout.test.ts      # statusMarkers describe :147-210 + renderQuestionLine describe :215-263 — the ONLY test file touched
  overview.ts         # parity SOURCE (markerParts/overviewMarker) — read-only
  short-view.ts       # vocabulary comment :13 already correct — NO edit needed
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# No new files. Modified only:
src/panel/layout.ts        # statusMarkers: + "★ answered" part + JSDoc parity note
src/panel/layout.test.ts   # flipped pins (:173/:178/:186/:194/:202/:210), renamed test, new ★ coverage
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: statusMarkers composes theme-wrapping AFTER building the plain
// parts string ("layout.ts module contract"); push plain strings into parts[]
// — never pre-themed fragments.
// CRITICAL: markers carry a LEADING SPACE separator by contract (' ★ answered'),
// and the whole fragment is dim-wrapped; tests assert the full string with the
// leading space against the identity theme stub.
// GOTCHA: ⟳/★ mutual exclusion is structural (status is a single enum value) —
// a reasked question that somehow still carries an answer shows ⟳ ONLY; do not
// "fix" that with extra logic.
// GOTCHA: closed + write-in shows ★ but NOT ✎ (hasTextAnswer's answered/submitted
// whitelist excludes closed) — DELIBERATE existing contract; do not widen
// hasTextAnswer in this subtask.
// GOTCHA: MARKER_REASON_CAP (=24) only bounds the moot reason; ★ needs no cap
// (fixed-width string), and renderQuestionLine already measures marker width
// via visibleWidth (ANSI/wide-glyph safe) — no width-accounting changes.
// GOTCHA: vitest exact-string pins — every layout.test.ts expectation touching
// an answered/submitted question changes value this PRP; flip values in place,
// never delete assertions (the suite is the regression contract).
```

## Implementation Blueprint

### Data models and structure

No model changes. `statusMarkers` reads the existing `Question` shape (`src/state.ts`: `status: "open" | "answered" | "submitted" | "closed" | "reasked" | "moot" | "withdrawn"`, `answer?: { value, at, text?, custom? }`). The ★ rule reuses the h2.28 record-derived answered predicate (`answer !== undefined && status ∈ {answered, submitted, closed}`) — the same rule as `statusCounts` in this file and `isRecordAnswered` in results.ts.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/panel/layout.ts — statusMarkers (:313)
  - INSERT between the reasked push and the hasTextAnswer push:
      if (
        q.answer !== undefined &&
        (q.status === "answered" || q.status === "submitted" || q.status === "closed")
      ) {
        parts.push("★ answered");
      }
  - RESULTING parts order: ⟳ re-asked (exclusive) · ★ answered (NEW) · ✎ text answer · ⊘ moot · ⊗ withdrawn
  - WHY this position: an answered write-in must read "★ answered · ✎ text answer" (★ before ✎);
    ⟳/★ never co-occur (status enum), so position relative to the ⟳ push is display-neutral
  - FOLLOW pattern: the existing plain-string pushes in the same parts array

Task 2: MODIFY src/panel/layout.ts — statusMarkers Mode A JSDoc (~:296-312)
  - ADD to the marker list: `★ answered` — any status carrying `q.answer` EXCEPT
    moot/withdrawn (answered/submitted/closed — parity with overview.ts markerParts, FR-D10)
  - NOTE in prose: ⟳ re-asked overrides ★ (the re-ask is the freshest fact, same precedence
    as overview); ★ composes with ✎ text answer (joined with " · ")

Task 3: MODIFY src/panel/layout.test.ts — flip + extend the statusMarkers describe (:147-210)
  - FLIP exact strings (blast radius, verified line numbers):
      :173 textQ (answered, type:"text")              " ✎ text answer" → " ★ answered · ✎ text answer"
      :178 choiceWithNote (submitted, answer.text)     " ✎ text answer" → " ★ answered · ✎ text answer"
      :186 write-in answered (custom: true)            " ✎ text answer" → " ★ answered · ✎ text answer"
      :194 write-in submitted (custom: true)           " ✎ text answer" → " ★ answered · ✎ text answer"
      :202 corrupt-truthy custom:"yes" (answered)      ""                → " ★ answered"
      :210 plain option answered                       ""                → " ★ answered" AND RENAME the test
        (suggested: "plain_option_answer_shows_star_answered_marker") — its old name
        asserts the premise FR-D10 deletes
  - NEW tests (same describe, same helpers/style):
      ★ per status: answered/submitted/closed with a plain option answer → " ★ answered"
      exclusions: reasked with a residual answer → " ⟳ re-asked" only;
                  moot with answer → moot markers only; withdrawn → " ⊗ withdrawn" only
  - UNCHANGED (verify still green): :149 open → "", :153 reasked/withdrawn pins,
      :156/:162 moot pins, :244 dynamic per-status loop (builds expectations from
      statusMarkers() itself — self-consistent)

Task 4: MODIFY src/panel/layout.test.ts — strengthen the BUG-005 composed-line test (~:237)
  - KEEP expect(line).toContain("✎ text answer"); ADD expect(line).toContain("★ answered")
    (the answered write-in now carries both markers on the rendered question line)

Task 5: VALIDATE (see Validation Loop) — full typecheck + full test suite;
  if any expectation OUTSIDE layout.test.ts fails on a marker string (grep says none
  will), triage per the item contract: marker-vocabulary flips belong HERE, cursor/
  preselect assertion flips belong to P1.M1.T5.S9 — do not silently absorb T5's scope
```

### Implementation Patterns & Key Details

```ts
// EXACT current body (layout.ts:313-318) with the insert marked:
export function statusMarkers(q: Question, theme: Theme): string {
  const parts: string[] = [];
  if (q.status === "reasked") parts.push("⟳ re-asked");
  // ▼▼ INSERT (Task 1) ▼▼
  if (
    q.answer !== undefined &&
    (q.status === "answered" || q.status === "submitted" || q.status === "closed")
  ) {
    parts.push("★ answered");
  }
  // ▲▲ END INSERT ▲▲
  if (hasTextAnswer(q)) parts.push("✎ text answer");
  if (q.status === "moot") { /* ⊘ + capped reason, unchanged */ }
  if (q.status === "withdrawn") parts.push("⊗ withdrawn");
  return parts.length === 0 ? "" : theme.fg("dim", ` ${parts.join(" · ")}`);
}

// PATTERN: the ★ predicate is h2.28's record-derived answered rule — the SAME
// condition used by statusCounts() in this file. Do not invent a new rule.
// GOTCHA: never gate ★ on hasTextAnswer() — it excludes closed; ★ covers closed.
// GOTCHA: never gate ★ on q.answer.value !== "" — a recorded answer is an answer
// (moot uses value/text as a reason channel; ★ only consults answer !== undefined
// plus the status whitelist).
```

### Integration Points

```yaml
RENDERING:
  - consumer: renderQuestionLine (layout.ts:346) — zero changes needed; it already
    measures the marker fragment with visibleWidth() and never truncates markers
    except at pathological widths (truncateVisible is ANSI-safe)
DOCUMENTATION:
  - src/panel/short-view.ts:10-16 vocabulary table already names ★ for question
    lines — no edit; verify no contradiction after the change
NO OTHER INTEGRATION POINTS:
  - no state, config, tool, renderer, or lifecycle changes; overview.ts untouched
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck        # tsc --noEmit — zero errors
# NOTE: this repo has no ruff/mypy; typecheck + vitest are the gates (package.json verified)

# Expected: clean. Fix any type errors before proceeding.
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/panel/layout.test.ts   # the touched suite — all green after flips
npx vitest run src/panel/overview.test.ts # parity source must stay untouched & green

# Expected: layout.test.ts green with flipped expectations; overview.test.ts green
# (if overview tests fail, you modified overview.ts — stop and revert).
```

### Level 3: Full Suite (System Validation)

```bash
npm test                 # vitest run — entire repo

# Expected: fully green. Grep-verified expectation: no suite outside layout.test.ts
# pins statusMarkers output. If an out-of-suite failure mentions a marker string,
# triage per Task 5 — cross-cutting cursor/preselect flips are P1.M1.T5.S9's scope.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Vocabulary self-check (no live TUI required):
# 1. answered write-in question line renders BOTH markers in order:
npx vitest run src/panel/layout.test.ts -t "writein"
# 2. per-status parity vs overview vocabulary:
npx vitest run src/panel/layout.test.ts -t "statusMarkers"
# Manual (optional, human TUI runbook territory): answer a question in the panel,
# observe `★ answered` right-aligned on the question line; submit; observe it persist.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` — zero errors
- [ ] `npm test` — fully green (all suites)
- [ ] All flips applied in place; no assertions deleted; one test renamed

### Feature Validation

- [ ] ★ present for answered/submitted/closed with answer; absent for open/moot/withdrawn/reasked
- [ ] `" ★ answered · ✎ text answer"` composition for write-ins/text/elaborations
- [ ] Corrupt-truthy `custom` shows ★ but not ✎ (strict `=== true` for ✎, record-derived for ★)
- [ ] Mode A JSDoc lists ★ and states the parity rule
- [ ] `src/panel/overview.ts` byte-identical to HEAD (`git diff --stat src/panel/overview.ts` empty)

### Code Quality Validation

- [ ] Plain-string pushes into `parts` (theme wrapping stays at the join, module contract)
- [ ] No new helper functions; no changes to hasTextAnswer / renderQuestionLine / width logic
- [ ] Test names describe the NEW contract (no test asserts "no marker for answered")

### Documentation & Deployment

- [ ] No config or environment changes (none exist for markers)
- [ ] short-view.ts vocabulary comment remains accurate (verify, don't edit)

---

## Anti-Patterns to Avoid

- ❌ Don't gate ★ behind `hasTextAnswer` — it drops closed; ★ covers answered/submitted/closed
- ❌ Don't add explicit ⟳-suppresses-★ logic — the status whitelist already guarantees it
- ❌ Don't modify `overview.ts` (parity source), `hasTextAnswer`, `renderQuestionLine`, or `short-view.ts`
- ❌ Don't widen `hasTextAnswer` to cover closed (out of scope; the closed-no-✎ asymmetry is deliberate)
- ❌ Don't delete failing assertions — flip their expected values (the suite is the regression contract)
- ❌ Don't absorb P1.M1.T5.S9's cross-cutting flips (overview.test.ts cursor rows etc.) into this subtask
- ❌ Don't pre-theme marker fragments — theme wrapping composes only at the final join

---

## Confidence Score: 9/10

One-pass success is highly likely: single-function insert with a verified exact body, verified per-line test blast radius confined to one file, parity source quoted verbatim, and green gates confirmed working in this repo. The residual 1/10 covers unknown dynamic string assertions in rarely-run suites (grep says none exist; Task 5's triage rule handles a surprise).

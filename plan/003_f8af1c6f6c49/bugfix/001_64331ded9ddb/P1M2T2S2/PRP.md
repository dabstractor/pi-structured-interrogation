---
name: "P1.M2.T2.S2 — De-mask fixture-baked moot-reason tests to production-path scenarios (PRD BUG-004 test debt)"
description: "Test-only item. The UI moot-reason tests mask BUG-004 by pre-baking 'moot: storage=sqlite' into fixture answer.text (overview.test.ts:202-220, :270-279; short-view.test.ts mootReason describe :167-175 + render :403; panel.test.ts:567-586) — a state that never occurs on the production path. Rewrite them as production-path scenarios: real InterrogationState, seed dep + dependent, applyAnswer on the dep, run evaluateDependsOn (or drive the panel accept path), then assert the rendered reason comes from the REAL derivation persisted by P1.M2.T2.S1 (q.mootReason). Cover '=unanswered' and '=missing' variants at least once. Keep legitimately-reachable fallback pins (legacy field-absent chains), renamed to say so. No production changes expected; a revealed precedence gap gets a minimal fix within P1.M2.T2.S1's field-clearing rules."
---

## Goal

**Feature Goal**: The render contract for FR-17 moot reasons becomes **test-enforced through the production path**: seed state → answer the dependency → evaluateDependsOn (or panel accept) → render → the h2.29 reason string appears. These tests would have caught BUG-004 (the old fixtures passed while the production path rendered "dependency changed").

**Deliverable**: Rewritten/extended test blocks in `src/panel/overview.test.ts`, `src/panel/short-view.test.ts`, `src/panel/panel.test.ts` (+ one cross-surface agreement case if not already covered by S1's delivery agreement assertion). No production files.

**Success Definition**: `npm test` + `npm run typecheck` green; every formerly-baked literal `moot: storage=sqlite` in a UI assertion is now produced by a real `evaluateDependsOn` run; `=unanswered` and `=missing` variants each asserted at least once; fallback pins remain but are explicitly named as legacy/field-absent cases; no production diff (unless a precedence gap surfaced — see What §gap).

## User Persona

**Target User**: The next maintainer — the suite now proves the panel shows real dependency reasons, instead of green tests over unreachable fixtures (the bug report's exact masking mechanism).

## Why

- PRD h2.2/h3.3: "The UI tests are masked by fixtures that pre-bake the literal string 'moot: storage=sqlite' into the fixture's answer.text … which never happens on the production path."
- h2.5 recommendation tail: "…and replace the fixture-baked 'moot: storage=sqlite' strings in the tests with production-path scenarios."
- Consumes P1.M2.T2.S1: renderers read `q.mootReason` (persisted at the evaluateDependsOn mute site) FIRST, with legacy fallback chains behind it. This item proves that pipeline end-to-end.
- Output consumed by P1.M3.T2.S1 (docs) as evidence the render contract is test-enforced.

## What

### The production-path scenario helper (per file, or shared inline — match each file's existing style)

The canonical scenario (used everywhere the baked literal appeared):

```ts
function seedMootScenario(reasonCase: "equals" | "unanswered" | "missing" = "equals") {
  const state = createInterrogationState("goal");
  state.upsertQuestion(choiceQ("storage", { /* options sqlite/postgres */ }));
  state.upsertQuestion(choiceQ("dep", {
    dependsOn: [{ id: "storage", equals: "postgres" }],
  }));
  switch (reasonCase) {
    case "equals":      // dep answered with the WRONG value → moot: storage=sqlite
      state.applyAnswer("storage", { value: "sqlite", at: "t" }); break;
    case "unanswered":  // dep present, never answered → moot: storage=unanswered
      break;
    case "missing":     // dependsOn names an id that was never upserted
      // (use a separate fixture whose dependsOn id is "ghost")
      break;
  }
  evaluateDependsOn(state);
  return state; // assert state.getQuestion("dep").status === "moot" and .mootReason
}
```

Adapt to each file's fixtures (`choiceQ(...)` builders differ slightly per file — read them first). `unanswered`/`missing` need only appear once across the whole changeset (overview.test.ts is the natural home for the variants; short-view/panel cover `equals`).

### Per-file rewrites

1. **overview.test.ts :202-220 (`overviewMootReason` describe)**
   - `test_reason_prefers_answer_text_h229_format` — DELETE the baked-text premise. Rename to something like `renders_persisted_production_reason_after_evaluateDependsOn`: seed scenario → `overviewMootReason(state.getQuestion("dep"))` === `"moot: storage=sqlite"`.
   - :207 `falls_back_to_answer_value` and :211 `generic_default` — KEEP but rename to mark them as the **legacy field-absent fallback chain** (`legacy_fallback_to_answer_value_when_field_absent`, `legacy_generic_default…`), since after S1 those chains only serve pre-field history (optional field, optional revive). Verify they still hold against S1's precedence (`q.mootReason` first, then answer.text, then value, then default) and pin whichever fallback remains reachable on the production path — on the production path the field is ALWAYS present after evaluateDependsOn mutes, so these are legacy-only pins.
2. **overview.test.ts :270-279 (row render)** — flip the fixture: instead of `answer: answer("sqlite", "moot: storage=sqlite")`, build the scenario state and pass `state.orderedQuestions()` to `buildOverviewContent`. Expected row string unchanged (`⊘ Title m — moot: storage=sqlite` dimmed) but now derived.
3. **short-view.test.ts mootReason describe (:167-175)** — replace the two hand-built `choiceQ` cases: (a) production case — scenario → `mootReason(q)` === `"moot: storage=sqlite"`; (b) keep the fallback derivation cases renamed `legacy_...` (they pin the field-absent chain: value → default). Empty-value → default case stays.
4. **short-view.test.ts :403 (`⊘ moot — dependency changed` render pin)** — S1 flips this to `⊘ moot — moot: storage=sqlite` **when the fixture carries the field**; THIS item goes further: build it from the scenario state so the field itself is production-derived. Also keep one render pin for the legacy field-absent generic (`⊘ moot — dependency changed`) if S1 kept that fallback — name it `legacy_...`.
5. **panel.test.ts :567-586 (overview row via panel)** — replace the `state.applyAnswer("moot", {value:"a", text:"moot: storage=sqlite"})` + `setStatus("moot","moot")` hand-baking with: upsert a real dep question, answer it sqlite, `evaluateDependsOn(state)` (before panel construction), then the existing `CTRL_L` overview assertions. Expected string `⊘ Moot Q — moot: storage=sqlite` unchanged.
   - Optional stronger variant: drive the accept path instead of applyAnswer (panel accept on the dep question, which runs evaluateDependsOn in the commit tail) — do this in ONE panel-level case if cheap; otherwise applyAnswer + explicit evaluateDependsOn is fine (that IS the production mute site's caller pattern).

### Variant coverage (at least once, overview.test.ts)

- `=unanswered`: dep upserted, never answered → reason `moot: storage=unanswered`.
- `=missing`: dependsOn `[{id:"ghost", ...}]`, ghost never upserted → reason `moot: ghost=missing`.

### The gap rule (contract point 3 tail)

If any scenario reveals a precedence gap — e.g. `q.mootReason` stale after a merge rule-2 reset, or a renderer still preferring `answer.text` over the persisted field — fix **minimally within P1.M2.T2.S1's field-clearing rules** (depends-on.ts write/clear sites, merge.ts defensive clear) and note it in the test's comment. No renderer-signature or precedence redesign.

### Success Criteria

- [ ] No UI test asserts a moot-reason literal produced by a baked `answer.text`/hand-`setStatus` fixture (grep `moot: storage=sqlite` across `src/panel/*.test.ts` — every hit traces to a scenario state)
- [ ] `=unanswered` and `=missing` each asserted at least once from real derivation
- [ ] Legacy fallback pins retained, renamed `legacy_...`, and accurate against S1's precedence
- [ ] panel.test.ts row-render case goes through evaluateDependsOn (accept-path variant optional)
- [ ] `npm test` + `npm run typecheck` green; zero production-file diffs (or a noted minimal gap fix)

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets: the exact masked tests and their current bodies, the scenario recipe (state → applyAnswer → evaluateDependsOn), the reason-string grammar incl. the `=unanswered`/`=missing` forms from depends-on.ts, S1's precedence contract (field first, legacy chains behind), and the rename/gap rules. No guessing.

### Documentation & References

```yaml
- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/P1M2T2S1/PRP.md
  why: CONTRACT — Question.mootReason field, write site (depends-on.ts mute), clear rules, renderer precedence
       (field first → answer.text → value → default), legacy-tolerance rationale; its own flipped-test notes (:139-140) show which
       cases it already touches so this item does not collide
  gotcha: S1 already flips the :403 render pin and :270-279 fixture "when the fixture carries the field" — this item replaces the
       field-carrying FIXTURE with a production-derived one; coordinate so the final state is scenario-based

- file: src/depends-on.ts
  why: dependencyMet (:113-131) + failReason (:88-89) — the reason grammar: `moot: {id}=missing`, `moot: {id}=unanswered`,
       else `moot: {id}={value}`; evaluateDependsOn (:168) is the mute-site caller the scenario runs
  pattern: call evaluateDependsOn(state) directly — no panel needed for renderer-helper tests

- file: src/panel/overview.test.ts
  why: the masked tests (:202-220 overviewMootReason describe; :270-279 buildOverviewContent row) + choiceQ/answer fixture builders
- file: src/panel/short-view.test.ts
  why: mootReason describe (:167-175) + render pin (:403) + choiceQ/render helpers
- file: src/panel/panel.test.ts
  why: :567-586 row-render test with the hand-baked applyAnswer+setStatus; panelArgsFor(state) harness; CTRL_L overview entry

- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/architecture/ripple-moot-seams.md
  why: §B6 + test-flip table §3 — the authoritative list of masked tests this item de-masks
- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/prd_snapshot.md (h2.2/h3.3, h2.5 recommendation)
  why: the masking mechanism and the prescribed replacement
```

### Current Codebase tree (relevant slice)

```bash
src/panel/ overview.test.ts short-view.test.ts panel.test.ts (+ overview.ts short-view.ts layout.ts read-only reference)
src/ depends-on.ts state.ts (read-only reference: evaluateDependsOn, createInterrogationState, upsertQuestion, applyAnswer)
```

### Desired Codebase tree

```bash
# no new files; test-only diffs
src/panel/overview.test.ts    # scenario-based reasons + =unanswered/=missing variants + legacy-renamed fallbacks
src/panel/short-view.test.ts  # scenario mootReason + render pins; legacy-renamed fallbacks
src/panel/panel.test.ts       # evaluateDependsOn-driven overview row render
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// evaluateDependsOn must run AFTER the dep's applyAnswer — it is not auto-invoked by applyAnswer (panel commit tails call it; raw state calls don't).
// The renderer helper tests (overviewMootReason/mootReason) are PURE Question functions — build the Question from the scenario state via
//   state.getQuestion("dep") so the persisted field rides along; do NOT re-hand-build a Question for them.
// Reason strings are byte-exact: "moot: storage=sqlite", "moot: storage=unanswered", "moot: ghost=missing" (no spaces around =).
// notEquals with an UNANSWERED dep is still unmet → reason is "=unanswered", not a value (depends-on.ts:88-89 order).
// S1's zero-event idempotence pins (depends-on.test.ts) and delivery.test.ts:758 must stay untouched.
// coordinate with S1's own test flips: end state = every reason literal is production-derived; no duplicated legacy pins.
```

## Implementation Blueprint

### Data models and structure

None — test-only.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: READ the three test files' fixture builders + S1 PRP test sections; grep "moot: storage=sqlite" in src/panel/*.test.ts for the full mask inventory

Task 2: REWRITE overview.test.ts
  - scenario helper (equals/unanswered/missing variants)
  - overviewMootReason describe: production case + legacy-renamed fallbacks
  - :270-279 row render from scenario state's orderedQuestions()

Task 3: REWRITE short-view.test.ts
  - mootReason describe: production case via state.getQuestion; legacy renames
  - :403 render pin from scenario state (coordinate with S1's flip)

Task 4: REWRITE panel.test.ts :567-586
  - dep question + applyAnswer + evaluateDependsOn before panel; keep CTRL_L assertions; optional accept-path variant

Task 5: GAPS + GATES
  - grep sweep: no baked-literal moot reasons remain
  - npx vitest run src/panel/overview.test.ts src/panel/short-view.test.ts src/panel/panel.test.ts
  - npm test && npm run typecheck
```

### Implementation Patterns & Key Details

The one invariant: **the rendered reason string must be produced by `evaluateDependsOn` on a real state, not typed into a fixture**. Helper-level tests pass `state.getQuestion(id)`; row/panel tests pass the scenario state itself.

### Integration Points

```yaml
UPSTREAM: P1.M2.T2.S1 (field + renderer precedence) — must land first or in the same changeset
DOWNSTREAM: P1.M3.T2.S1 (README/docs sweep cites these as the test-enforced render contract)
PRODUCTION: none expected; minimal gap fixes confined to depends-on.ts/merge.ts field-clearing per S1's rules
```

## Validation Loop

### Level 1-2

```bash
npx vitest run src/panel/overview.test.ts src/panel/short-view.test.ts src/panel/panel.test.ts
npm test && npm run typecheck
```

### Level 3-4

Grep audit: `grep -n "moot: " src/panel/*.test.ts` — every hit's fixture chain traces to `evaluateDependsOn` (or is an explicitly-named legacy fallback with a field-absent Question). Review any production diff against the gap rule.

## Final Validation Checklist

- [ ] `npm test` + `npm run typecheck` green
- [ ] No fixture-baked reason literals (grep audit clean)
- [ ] `=unanswered` and `=missing` covered from real derivation
- [ ] Legacy fallback pins kept and renamed `legacy_...`
- [ ] No unexpected production diffs (any gap fix noted, minimal, within S1's clear rules)

---

## Anti-Patterns to Avoid

- ❌ Don't hand-set `q.mootReason` in a fixture and call it production-path — the field must come from evaluateDependsOn
- ❌ Don't delete the legacy fallback pins — they cover pre-field history (S1's optional-field tolerance); rename, don't remove
- ❌ Don't redesign renderer precedence if a gap appears — fix within S1's field-clearing rules and note it
- ❌ Don't collide with S1's own test flips — end state is one coherent scenario-based suite, not two overlapping patches
- ❌ Don't run evaluateDependsOn before the dep's applyAnswer (no-op mute, reason never written)

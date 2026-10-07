---
name: "P1.M2.T2.S1 — Persist h2.29 moot reason on Question; consume in short-view, overview, and layout markers (PRD BUG-004)"
description: "Option A from architecture/ripple-moot-seams.md §4: add optional `mootReason?: string` to Question (state.ts, + tolerant reviveQuestion round-trip); write it at the evaluateDependsOn mute site and for still-moot entries (idempotent same-string field writes, NO changed emit — purity pins at depends-on.test.ts zero-events and delivery.test.ts:758 byte-identical serialize); clear it wherever the question leaves moot (both reopen branches) and defensively on merge rebuilt questions; renderers read q.mootReason first — short-view mootReason, overview overviewMootReason, layout statusMarkers (existing 24-col cap) — replacing the wrong answer.value/answer.text derivations. buildCompletion keeps its recompute; add an agreement assertion. TDD failing-first. Mode A JSDoc + a decisions.md pin (persist-vs-render-time ruling)."
---

## Goal

**Feature Goal**: PRD BUG-004 / FR-17 / AC-6: every panel view renders the true dependency-derived moot reason (`moot: storage=sqlite`, h2.29 format) instead of the generic "dependency changed" or the moot question's own stale answer/elaboration presented as the cause. Chosen mechanism: persist the reason on the Question (Option A — scout report §4) rather than plumbing state into the pure renderers (Option B, rejected: changes three public pure-renderer signatures).

**Deliverable**: Modified `src/state.ts` (field + revival), `src/depends-on.ts` (write at mute, clear on reopen), `src/merge.ts` (defensive clear on rebuilt questions), `src/panel/short-view.ts` + `src/panel/overview.ts` + `src/panel/layout.ts` (consume `q.mootReason` first), flipped/extended tests in `depends-on.test.ts` / `short-view.test.ts` / `overview.test.ts` / `panel.test.ts` / `delivery.test.ts`, a `decisions.md` pin, Mode A JSDoc updates.

**Success Definition**: `npm test` + `npm run typecheck` green; scripted: fixture (storage=sqlite answered, dependent q2 dependsOn equals postgres) → evaluateDependsOn → short view renders `⊘ moot — moot: storage=sqlite`, overview row shows the reason, layout marker shows it (≤24 cols); reopening (storage→postgres) clears the field; still-moot re-passes emit zero `changed` events and leave serialize byte-identical; buildCompletion's recomputed reason equals the persisted field.

## User Persona

**Target User**: TUI user whose earlier answers get invalidated by a dependency change — they must see WHICH dependency and WHICH value caused it ("which dependency? which value?", BUG-004), not a non-explanation or their own stale answer blamed.

**Use Case**: Answer storage=sqlite → dependent "scale" greys out. Today: "⊘ moot — dependency changed". After: "⊘ moot — moot: storage=sqlite" in the short view, the same reason on the overview row and the question-line marker, and the identical string in the completion record the model reads.

**User Journey**: answer trips a dependsOn → instant grey-out WITH the h2.29 reason (FR-17) → overview scan shows consistent reasons → dependency re-met → question reopens, reason gone.

**Pain Points Addressed**: Misleading reason substitutes; audit-trail degradation (Q34=A); UI tests masked by baked fixtures that never occur on the production path.

## Why

- PRD h2.2/h3.3 (BUG-004): "No panel view ever renders it: the only consumer of the computed reason is delivery.ts:420 (the completion record)."
- PRD h2.5 recommendation: "either persist evaluateDependsOn's h2.29 reason on the question or call dependencyMet at render time … and replace the fixture-baked 'moot: storage=sqlite' strings in the tests" — Option A (persist) is the scout report's recommendation: renderers stay pure Question-only, one write site, self-healing on reconstruct (reconstruction runs evaluateDependsOn as step 5, so a persisted field cannot go stale).
- short-view.ts:144-147's docblock already anticipates this ("if state grows one" structured reason).
- Consumed by: P1.M2.T2.S2 (de-mask fixture-baked tests to production-path scenarios), P1.M3.T2.S1 (README sweep).

## What

### 1. `src/state.ts` — the field

Add to the `Question` interface (:68–91):

```ts
/**
 * [Mode A] h2.29 moot reason ("moot: {depId}={actualValue}") persisted at
 * the moment evaluateDependsOn mutes this question (FR-17). Present ONLY
 * while status === "moot" — cleared on reopen (re-met / removed dependsOn)
 * and on merge rebuilt questions; renderers additionally guard on
 * status === "moot" so a stale value can never display. Reconstruction
 * re-runs evaluateDependsOn (step 5), so the field self-heals. Optional:
 * history written before this field has none (legacy tolerance), and the
 * fallback derivations in the renderers cover it.
 */
mootReason?: string;
```

- `reviveQuestion` (:514): add the tolerant round-trip line, following the exact pattern of the other optional fields:
  `if (typeof value.mootReason === "string") q.mootReason = value.mootReason;`
- `serialize()` needs nothing (structuredClone carries it); persistence.ts has no schema allowlist (verified).

### 2. `src/depends-on.ts` — write at mute, clear on reopen

At the mute site (:199–200) and for still-moot entries:

```ts
} else {
  // Persist the h2.29 reason (FR-17/BUG-004 Option A). Field write only —
  // NO emitChanged: still-moot passes must stay event-free (idempotence
  // pins in depends-on.test.ts; delivery.test.ts:758 byte-identical
  // serialize). serialize() clones the live object, so the field reaches
  // the next emitted snapshot even when this pass emits nothing.
  q.mootReason = result.reason;                 // idempotent for same reason
  if (q.status !== "moot") state.setStatus(q.id, "moot");  // the only emitter
  mootered.push({ id: q.id, reason: result.reason });
}
```

Both reopen branches (empty-dependsOn :176–179 and re-met :186–189): clear before the setStatus("open") call —

```ts
if (q.status === "moot") {
  q.mootReason = undefined;   // a reason must never outlive moot
  state.setStatus(q.id, "open");
  reopened.push(q.id);
}
```

(Each branch appears once; keep them textually parallel. The setStatus emit carries the cleared field in its snapshot.)

Mode A JSDoc: update the evaluateDependsOn docblock (:160–166 area) — document reason persistence, the no-emit field-write discipline, and the clear-on-reopen contract.

### 3. `src/merge.ts` — defensive clear

In `applyUpsert`, the merged replacement object (:178–200 area) is built from the incoming clone, so it never inherits a stale reason today — add the explicit guard anyway (scout §5: "a lingering reason must never render on a non-moot question"):

```ts
const merged: Question = { ...structuredClone(incomingQ), rev, status, answer };
if (status !== "moot") merged.mootReason = undefined; // defensive: reasons are evaluator-owned
```

(one line + comment; the rule-2 answer-reset path is covered because `status` there is "reasked").

### 4. Renderers — consume the field first

- `src/panel/short-view.ts` `mootReason(q)` (:149–152):

```ts
export function mootReason(q: Question): string {
  // FR-17/BUG-004: prefer the persisted h2.29 reason; fall back for legacy
  // states written before the field existed.
  if (q.mootReason !== undefined && q.mootReason !== "") return q.mootReason;
  const cause = q.answer?.value;
  return cause !== undefined && cause !== "" ? cause : DEFAULT_MOOT_REASON;
}
```
  Update docblock :144–152 (it already says "if state grows one" — now it has).

- `src/panel/overview.ts` `overviewMootReason(q)` (:166–172): prepend the same field check (before the `answer.text` preference):
  `if (q.mootReason !== undefined && q.mootReason !== "") return q.mootReason;`

- `src/panel/layout.ts` `statusMarkers` moot branch (:329–333): read the field INSTEAD of `answer.text` (removes the elaboration-as-reason conflation):

```ts
if (q.status === "moot") {
  const reason = truncateVisible(q.mootReason ?? "", MARKER_REASON_CAP);
  parts.push(reason === "" ? "⊘ moot" : `⊘ moot ${reason}`);
}
```
  (Update the statusMarkers docblock's moot mention.)

All three keep their existing fallback chains for legacy/moot-without-reason states. Note the h2.29 reason string is `moot: storage=sqlite` — the short view renders it verbatim after `⊘ moot — `; the layout marker renders the truncated string after `⊘ moot `; NO prefix-stripping in the panel (only buildCompletion strips for the record format).

### 5. buildCompletion agreement (delivery.ts :410–419)

Keep the existing recompute (`evaluateDependsOn(state).mootered` map). ADD one test-level assertion (not delivery.ts logic): after evaluateDependsOn has run on a state, `buildCompletion`'s moot line reasons === the persisted `q.mootReason` values — the two sources must agree. (If they ever disagree, the persisted field is stale and the evaluator owns truth.)

### 6. Tests — TDD failing-first

- `src/depends-on.test.ts` ADD:
  - reason persisted at mute: after muting, `getQuestion(id).mootReason === "moot: storage=sqlite"` and the emitted snapshot's question carries it;
  - cleared on BOTH reopen branches (re-met; removed/emptied dependsOn): field undefined after;
  - idempotent still-moot pass: reason re-written same string, `changes() === 0`, `serialize()` byte-identical before/after the second pass;
  - changed-reason-still-moot (dep value changed while dependent stays moot, e.g. sqlite→mysql): field updates to the new reason silently (no event — document this in the test name/comment);
  - merge rule-2 rebuild: after applyUpsert with changed options, rebuilt question has `mootReason === undefined`.
- `src/panel/short-view.test.ts`: mootReason describe (:167–175) — field-first cases (persisted reason wins; legacy fallback value; DEFAULT when neither) + the render pin at :403 flips from `⊘ moot — dependency changed` to `⊘ moot — moot: storage=sqlite` when the fixture carries the field.
- `src/panel/overview.test.ts`: :204 (`test_reason_prefers_answer_text_h229_format`) — the baked-text fixture now represents the LEGACY fallback; add field-wins cases; :210/:213 fallback pins stay (they cover value/generic); :270–279 row render — flip the fixture to set `mootReason` on the question (not baked answer.text) and keep the same expected row string.
- `src/panel/panel.test.ts` :567–586: flip the fixture to set the field (same expected output) — production-path end-to-end scenarios (evaluateDependsOn → render) are P1.M2.T2.S2's scope; do not duplicate.
- `src/panel/layout.test.ts`: statusMarkers moot cases — field-based reason renders truncated to 24 cols (`MARKER_REASON_CAP`), absent field → bare `⊘ moot`.
- `src/delivery.test.ts`: the :758 byte-identical purity test must stay green (regression guard for the no-emit discipline); add the buildCompletion-vs-field agreement assertion.

### 7. Docs

- Mode A JSDoc per What §1–4 (field, mute site, three renderer helpers).
- `decisions.md` (repo convention — follow the existing pin format): record the ruling — persist-on-Question (Option A) over render-time recompute (Option B), citing: pure Question-only renderer signatures preserved, single write site, reconstruct step-5 self-heal, and the delivery recompute kept as cross-check.

### Explicitly OUT of scope (guard rails)

- De-masking UI tests to full production-path (evaluateDependsOn-driven) scenarios — P1.M2.T2.S2.
- README sweep — P1.M3.T2.S1.
- Any change to `VICTIM_STATUSES` / FR-18 gates (parallel P1.M2.T1.S2's territory — actions.ts/panel.ts seam gates).
- render-time `dependencyMet` plumbing (Option B — rejected and recorded in decisions.md).

### Success Criteria

- [ ] Mute persists reason; both reopen branches clear it; merge rebuild clears defensively
- [ ] Still-moot same-reason pass: zero changed events, byte-identical serialize
- [ ] Short view: `⊘ moot — moot: storage=sqlite`; overview row: reason present; layout marker: reason truncated ≤24 cols (`⊘ moot moot: storage=sqlite`); all three only when status === "moot"
- [ ] Legacy fallbacks intact (field absent → old chains; existing fallback pins stay green)
- [ ] buildCompletion moot line reasons === persisted fields (agreement assertion)
- [ ] `npm test` + `npm run typecheck` green (incl. delivery.test.ts:758 and all depends-on zero-event pins)

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets: exact current code of the mute/reopen sites and all three renderer helpers, the no-emit field-write discipline and WHICH purity tests enforce it, the merge defensive-clear line, the test-by-line flip map, the decisions.md obligation, and the fence against sibling S2. No guessing.

### Documentation & References

```yaml
- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/architecture/ripple-moot-seams.md
  why: §B1-B6 verified anchors, §4 Option A recommendation, §5 risks (purity traps, merge interaction) — the primary research source
  gotcha: §5's delivery.test.ts byte-identical warning is the sharpest trap; read before touching evaluateDependsOn

- file: src/depends-on.ts
  why: evaluateDependsOn (:168-206) — mute site :199-200 (write), reopen branches :176-179/:186-189 (clear), docblock :160-166 (idempotence contract)
  pattern: direct field write, never an extra setStatus/emitChanged
- file: src/state.ts
  why: Question interface :68-91 (add field), reviveQuestion :514 (tolerant revival pattern), setStatus :376 (emitter — the ONLY emit on status flips)
- file: src/merge.ts
  why: applyUpsert merged-object construction ~:178-200 — the defensive clear site
- file: src/panel/short-view.ts
  why: mootReason :149-152 (rewrite), MOOT_HEAD :89, render :324-332, docblock :144-147 ("if state grows one")
- file: src/panel/overview.ts
  why: overviewMootReason :166-172 (prepend field check)
- file: src/panel/layout.ts
  why: statusMarkers moot branch :329-333, MARKER_REASON_CAP 24 at :337
- file: src/delivery.ts
  why: buildCompletion :410-419 reason recompute + :396-403 prefix strip — UNCHANGED, cross-checked
- file: src/depends-on.test.ts
  why: zero-event pins :60/:175/:193-196/:211/:293/:314 — the discipline's enforcement; add reason persistence/clearing cases here
- file: src/delivery.test.ts
  why: :758 byte-identical serialize pin — must stay green
- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/prd_snapshot.md (h2.2/h3.3 BUG-004, h2.5 recommendations)
  why: the defect, the exact repro, the mandated remedy options
- file: plan/003_f8af1c6f6c49/bugfix/001_64331ded9ddb/P1M2T1S2/PRP.md
  why: parallel sibling (FR-18 seam gates, actions.ts/panel.ts/ripple-confirm.ts) — DISJOINT files from this item; do not touch those gates
```

### Current Codebase tree (relevant slice)

```bash
src/ state.ts depends-on.ts merge.ts delivery.ts panel/{short-view,overview,layout}.ts (+ their .test.ts)
```

### Desired Codebase tree

```bash
# no new files
src/state.ts            # MODIFIED: Question.mootReason? + revival
src/depends-on.ts       # MODIFIED: write at mute / clear on reopen + JSDoc
src/merge.ts            # MODIFIED: one defensive clear line
src/panel/short-view.ts src/panel/overview.ts src/panel/layout.ts  # MODIFIED: field-first derivations
# tests: depends-on / short-view / overview / panel / layout / delivery (.test.ts)
# decisions.md: new pin
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// NO emitChanged for the mootReason field write — depends-on.test.ts zero-event pins + delivery.test.ts:758
//   byte-identical serialize BOTH break on a stray emit (or on a value change on a stable pass).
// A still-moot question whose reason CHANGED (dep value moved while it stayed moot): field updates silently,
//   zero events — intentional, documented in the test; serialize carries it on the next natural emit.
// The reason string keeps its "moot: " prefix in the PANEL (verbatim h2.29); only buildCompletion strips it.
// Renderers guard on status === "moot" — the field alone must never trigger a moot line/marker.
// serialize() clones live objects: a field write without an event still shows in the NEXT emitted snapshot.
// answerSignature (snapshots.ts:129-132) reads answer.value/text only — mootReason cannot perturb diff entries.
// Legacy tolerance: field is optional; pre-change history/state has none — fallback chains exist for that reason.
// SKIP_EVALUATION (depends-on.ts:77) skips withdrawn/closed — their mootReason (if any) persists harmlessly;
//   they never render moot lines (renderers' status guard) and merge clears on rebuild.
```

## Implementation Blueprint

### Data models and structure

One optional string field on `Question` — plain data, serialize/revive round-trip, no events of its own.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: TDD — ADD failing tests first
  - depends-on.test.ts: persist-at-mute / clear-both-reopens / idempotent-same-string (0 events + byte-identical) /
     changed-reason-silent-update / merge-rebuild-clear
  - renderer helper tests (short-view/overview/layout): field-wins + legacy-fallback cases
  - delivery.test.ts: agreement assertion (buildCompletion reasons === persisted fields)

Task 2: MODIFY src/state.ts — field + Mode A JSDoc + reviveQuestion line

Task 3: MODIFY src/depends-on.ts — write at mute (field-only, no emit), clear in both reopen branches, docblock update

Task 4: MODIFY src/merge.ts — defensive clear on the merged rebuild

Task 5: MODIFY the three renderers (What §4) + docblocks

Task 6: FLIP the baked/masked fixtures that now fail (short-view :403; overview :270-279; panel :567-586;
  overview :204 retitles as the legacy-fallback case) — fixture-level only; production-path scenarios stay S2's

Task 7: decisions.md pin (What §7)

Task 8: GATES
  - npx vitest run src/depends-on.test.ts src/panel/ src/delivery.test.ts
  - npm test && npm run typecheck
```

### Implementation Patterns & Key Details

See What §1–§5 for exact code. Load-bearing ordering: in the mute branch the field write precedes the conditional setStatus so BOTH the flip case and the still-moot case record the reason; in reopen branches the clear precedes setStatus so the emitted reopen snapshot already shows `mootReason: undefined` (well: absent after clone — `undefined` optional fields drop in JSON, which is fine for `toEqual`).

### Integration Points

```yaml
STATE/serialization: field flows via structuredClone + reviveQuestion; persistence.ts pass-through (no allowlist)
RECONSTRUCT: step-5 evaluateDependsOn re-derives — persisted field self-heals (stale impossible by construction)
DOWNSTREAM (do NOT implement):
  - P1.M2.T2.S2: de-mask remaining fixture-baked tests to production-path (evaluateDependsOn → render) scenarios
  - P1.M3.T2.S1: README sweep
CONFIG/EVENTS: none
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npx vitest run src/depends-on.test.ts
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/short-view.test.ts src/panel/overview.test.ts src/panel/layout.test.ts src/panel/panel.test.ts src/delivery.test.ts
npm test   # full suite — the zero-event and byte-identical pins are the canaries
```

### Level 3: Integration Testing

Covered by the fixture-scenario tests (evaluateDependsOn → renderers). The PRD's scripted repro (BUG-004 steps 1–5) maps to: seed storage+dependent via createInterrogationState/upsertQuestion, answer storage=sqlite, evaluateDependsOn, then render each surface — assert the true reason everywhere. Add this as one combined test if S2 hasn't already (coordinate to avoid duplication — S2 owns the end-to-end form).

### Level 4: Domain Validation

Review the decisions.md pin against scout §4 (Option A rationale) and the JSDoc set against contract point 5.

## Final Validation Checklist

- [ ] `npm test` + `npm run typecheck` green; delivery.test.ts:758 + all depends-on zero-event pins green
- [ ] Reason persisted at mute, cleared on both reopens + merge rebuild, silent-update-on-changed-reason documented
- [ ] All three surfaces render the true `moot: storage=sqlite` (short view verbatim; layout ≤24 cols)
- [ ] Legacy fallback chains intact; field only renders while status === "moot"
- [ ] buildCompletion agreement assertion passes; buildCompletion logic unchanged
- [ ] Mode A JSDoc on field/mute-site/three helpers; decisions.md pin recorded
- [ ] No touch to FR-18 gates (parallel sibling), README (M3), or production-path UI de-masking (S2)

---

## Anti-Patterns to Avoid

- ❌ Don't route the reason write through setStatus/emitChanged — both purity suites break; field writes are silent by design
- ❌ Don't strip the "moot: " prefix in the panel renderers — that's buildCompletion's record-format concern only
- ❌ Don't delete the fallback chains "because the field always exists now" — legacy state and pre-change history lack it
- ❌ Don't plumb state into the pure renderers (Option B) — rejected and to be recorded in decisions.md
- ❌ Don't duplicate S2's production-path de-masking or touch the parallel FR-18 seam gates
- ❌ Don't add mootReason to answerSignature or any diff machinery — it must not affect submissions

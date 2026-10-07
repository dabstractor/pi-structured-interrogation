---
name: "P1.M1.T2.S6 — acceptFromDeep: no-op returns to short + advances; veto stays in deep"
task: "P1.M1.T2.S6"
parent: "P1.M1.T2 (FR-D9 — Inert same-value commits on the accept paths)"
phase: "P1 — Phase D1 Answer pinning (ANSWER-PIN-001 / FR-35, spec M9)"
---

## Goal

**Feature Goal**: `enter` in the deep view on the already-recorded option (the ANSWER-PIN-001 no-op) returns the user to the short form and advances — exactly like the short-view accept path — instead of stranding them in the deep view. Only a genuine ripple-seam VETO keeps the user in deep view (to re-decide in the pane they are reading). This is implemented by replacing `acceptFromDeep`'s reference-comparison heuristic with an explicit three-outcome signal (NO-OP | ACCEPT | VETO) returned by `acceptOptionIndex`.

**Deliverable**: (1) `src/panel/actions.ts` — exported `AcceptOutcome` type; `acceptOptionIndex` returns it (commit logic UNCHANGED — S4 already delivered the inert no-op); `accept()`/`digit()` coerce to boolean. (2) `src/panel/deep-view.ts` — `acceptFromDeep` switches on the outcome signal; purged/rewritten JSDoc stating the no-op-vs-veto distinction. (3) New deep-view test for the same-value branch; existing veto/accept tests stay green.

**Success Definition**: `npm test` and `npm run typecheck` green; the new `test_same_value_noop_returns_to_short_and_advances` passes; `test_ripple_veto_stays_in_deep_without_committing` unchanged and green; no behavior change outside deep view (short-view accept/digit semantics byte-identical; S4's actions.test.ts suite untouched).

## User Persona (if applicable)

**Target User**: The planner (human) re-entering the deep view on an already-answered question to re-read ramifications.

**Use Case**: FR-D8 (S1, complete) seeds the deep-view caret onto the RECORDED answer's section. The user re-opens the deep pane, re-reads, presses `enter` on their own recorded option to confirm-and-move-on (the Q14 rhythm).

**User Journey**: Revisit answered question → `ctrl+d` deep view → caret sits on their recorded answer (not ★) → `enter` → panel returns to short form, advances to the next unanswered question, zero state written (no `answer.at` rewrite, no modal, no auto-submit).

**Pain Points Addressed**: Today that `enter` is an inert no-op *misread as a veto* — the user is stuck in the deep pane with nothing happening, because `acceptFromDeep` detects "nothing changed" by comparing the answer object reference, and the no-op (by design) never replaces the answer object.

## Why

- Completes FR-D9's accept-path trio: S4 (`acceptOptionIndex` via accept/digit) and S5 (`writeInEnter`) are complete; `acceptFromDeep` is the last consumer still misreading the no-op.
- ANSWER-PIN-001 ruling (spec h2.65): "`enter` or a digit on the already-recorded value is a state no-op (advance only) — never a re-proposal". Staying in deep view on that gesture is neither advance nor re-proposal — it is a dead end.
- Seam doc (plan/003_f8af1c6f6c49/architecture/panel-ui-seams.md:17) mandates: "Return shape must expose a third outcome (NO-OP vs ACCEPT | VETO) for acceptFromDeep."

## What

FR-D9 deep-view leg (PRD h2.8/h3.5, h2.29, h2.34, h2.65): in the deep view, `enter` on the highlighted option commits through `acceptOptionIndex` (the single seam — S4's inert no-op and ripple routing already live there). `acceptFromDeep` then interprets the outcome:

- **NO-OP** (same-value re-commit): the advance already ran inside `acceptOptionIndex`; `acceptFromDeep` returns to the short form (`setView("short")`, `scrollOffset = 0`). NOT a veto.
- **ACCEPT** (real commit): unchanged behavior — return to short form, advance already ran.
- **VETO** (ripple seam returned false): user STAYS in deep view — dropping to short would hide the pane they are reading; nothing was committed.
- **`false`** (defensive; `opt === undefined`): propagate `false`. Unreachable in practice (the index is clamped into `[0, options.length]` and the Other index is handled earlier), but keep the fall-through honest.

### Success Criteria

- [ ] `acceptOptionIndex` returns `AcceptOutcome` (`"noop" | "accept" | "veto"` or `false` for the miss case) — exported type; commit logic, seam ordering, and advance placement byte-identical to S4's delivery.
- [ ] `accept()` and `digit()` still return `boolean` per the `PanelActions` interface (coerce: every outcome except `false` is consumed → `true`). S4's actions.test.ts assertions (`expect(accept(panel)).toBe(true)` etc.) stay green WITHOUT editing them.
- [ ] `acceptFromDeep`: NO-OP/ACCEPT → `setView("short")` + `scrollOffset = 0`; VETO → view untouched (stay deep); boolean return signature unchanged (keys.ts untouched).
- [ ] The `q.answer === before` reference-comparison heuristic and its comment block (~deep-view.ts:552-566) are GONE.
- [ ] New test: same-value enter-from-deep returns to short + advances, seam never consulted, `answer.at` untouched. Existing veto + accept deep-view tests green.
- [ ] No config/keys/state/auto-submit/overview/short-view changes (Non-goals).

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything needed to implement this successfully?" — Yes: exact files, line anchors, current code excerpts, the outcome design, fixture shapes, and test commands are all below. This is a ~2-point surgical change in two files plus tests.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/panel/deep-view.ts
  why: acceptFromDeep (~line 528) — the function being fixed; also deepSeedCursorIndex JSDoc (already ANSWER-PIN-001-correct, S1)
  pattern: the Other-section branch (index === count → writein duty) shows the established early-return style; setView("short") + scrollOffset = 0 is the return-to-short idiom
  gotcha: purge BOTH the inline heuristic comment (~559-566) AND the JSDoc "No-op paths" bullet's "ripple VETO: … the view only changes on a real commit" clause — that claim is the bug's documentation

- file: src/panel/actions.ts
  why: acceptOptionIndex (~line 244) — S4's inert no-op + ripple seam + advance tail; accept() and digit() are the boolean-returning wrappers that need coercion
  pattern: "PATTERN: single seam, shared by accept()/digit()/acceptFromDeep" (S4's comment) — keep that truth; only the return SHAPE changes
  gotcha: do NOT touch commit logic, seam ordering, advanceAfterAccept placement, or maybeAutoSubmit calls; `opt === undefined → return false` must survive (digit relies on fall-through)

- file: src/panel/deep-view.test.ts
  why: the acceptFromDeep describe (~line 471) — fixtures choiceQ/textQ (~line 64), setup(questions, statuses), and the tests to keep green + where to add the new one
  pattern: test_ripple_veto_stays_in_deep_without_committing shows the panel.rippleConfirm override idiom (assign a fn onto the panel)
  gotcha: upsert normalizes status to open — lifecycle statuses go through raw setStatus (the setup helper already does this via its `statuses` param)

- file: src/panel/keys.ts
  why: line 446 — the ONLY consumer of acceptFromDeep; confirms its boolean contract must not change
  pattern: n/a (read-only reference)
  gotcha: do not modify this file

- file: plan/003_f8af1c6f6c49/architecture/panel-ui-seams.md
  why: line 17 (acceptOptionIndex three-outcome mandate) + line 19 (acceptFromDeep :528/:552 diagnosis + "Comments ~559-566 to purge") — the authoritative seam contract for this task
  pattern: n/a
  gotcha: n/a

- docfile: plan/003_f8af1c6f6c49/P1M1T2S4/PRP.md
  why: S4's contract — defines what is already delivered and explicitly scopes S6: "S6 only adjusts the deep-view CONSUMER's outcome interpretation, not this function" (its logic)
  section: Non-goals + "Implementation Patterns & Key Details"
  gotcha: S4's same-value check is non-custom only (`recorded.custom !== true && recorded.value === opt.value`) — a write-in answer byte-equal to an option value is a DIFFERENT-KIND commit and routes through the seam; from deep view that yields veto-or-accept, never noop — do not "fix" this

- docfile: plan/003_f8af1c6f6c49/P1M1T2S6/research/research-notes.md
  why: this task's own research — verified call-site inventory, fixture facts, sibling status
  section: all
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
├── actions.ts          # acceptOptionIndex (S4 no-op), accept, digit, writeInEnter (S5), advanceAfterAccept, maybeAutoSubmit
├── deep-view.ts        # acceptFromDeep (~:528) ← THE FIX; deepSeedCursorIndex (S1, done)
├── deep-view.test.ts   # acceptFromDeep describe (~:471) ← tests
├── keys.ts             # :446 sole acceptFromDeep consumer (untouched)
├── ripple-confirm.ts   # createRippleConfirm / RippleConfirmFn (read-only context)
└── short-view.ts       # initialCursorIndex + displayOptions (S1, done — read-only context)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/panel/
├── actions.ts          # MODIFIED: + export type AcceptOutcome; acceptOptionIndex returns it; accept()/digit() coerce
├── deep-view.ts        # MODIFIED: acceptFromDeep switches on outcome; JSDoc + inline comments rewritten (Mode A)
└── deep-view.test.ts   # MODIFIED: + test_same_value_noop_returns_to_short_and_advances (in acceptFromDeep describe)
```

No new files.

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: AcceptOutcome strings are truthy — never `return acceptOptionIndex(...)` from a
// `boolean`-typed function without coercion (`!== false`); TypeScript catches it (tsc --noEmit is a gate).
// CRITICAL: the same-value no-op path ADVANCES inside acceptOptionIndex (advanceAfterAccept) BEFORE
// returning — acceptFromDeep must NOT advance again; it only switches the view.
// CRITICAL: applyAnswer assigns a FRESH answer object on real commits; the no-op path deliberately
// does not. Any reference/state-identity heuristic re-introduces this bug — that is why the outcome
// signal exists. Never compare q.answer before/after.
// GOTCHA: `opt === undefined` (out-of-range index) must keep returning `false` — digit()'s fall-through
// depends on it (n-1 past the option count must not be "consumed").
// GOTCHA: displayOptions(q) is recommended-first (D-R13) — indexes are DISPLAY positions; deep-view
// cursorIndex already speaks display positions (the mapping lives in acceptOptionIndex, the single seam).
// GOTCHA: write-in answers (answer.custom === true) never take the noop branch by design (S4) — a
// custom answer byte-equal to an option value is a different-kind commit. From deep view it returns
// "accept" (or "veto" via the seam). Do not add a custom write-in special case here.
// GOTCHA: the ✎ Other section (index === options.length) is handled BEFORE acceptOptionIndex in
// acceptFromDeep (opens write-in duty, returns to short) — untouched by this task.
// CONVENTION: this repo's tests use snake_case test names (test_...), raw setStatus for lifecycle
// statuses after upsert, and in-file fixture helpers (choiceQ/textQ/panelArgsFor). Comments are
// dense contract-style JSDoc citing PRD/decision IDs (h2.x, FR-x, ANSWER-PIN-001) — match the local voice.
```

## Implementation Blueprint

### Data models and structure

No data/state models change. One new exported type in `src/panel/actions.ts`:

```ts
/**
 * [Mode A] Three-outcome accept signal (ANSWER-PIN-001 / FR-D9, seam doc
 * panel-ui-seams.md:17) — the deep-view consumer (acceptFromDeep) must
 * distinguish "nothing happened because the recorded answer was re-entered"
 * from "nothing happened because the ripple seam vetoed the edit":
 * - "noop"   — same-value re-commit: INERT (no applyAnswer, no answer.at
 *   rewrite, no seam, no moot recompute, no auto-submit) but the Q14 advance
 *   ALREADY RAN inside acceptOptionIndex; deep view returns to short.
 * - "accept" — real commit applied (ripple passed or not applicable); advance
 *   already ran; deep view returns to short.
 * - "veto"   — the ripple-confirm seam refused the edit (answered/submitted
 *   question, different value); NOTHING applied, NO advance; deep view stays
 *   open so the user re-decides in the pane they are reading.
 * - false    — out-of-range index (opt undefined): not consumed; digit falls
 *   through. Boolean for call-site compatibility (accept/digit return boolean).
 */
export type AcceptOutcome = "noop" | "accept" | "veto" | false;
```

(Alternative shape — `"miss"` string instead of `false` — is acceptable IF you
also update `accept()`/`digit()` coercion accordingly; `false` keeps the
fall-through semantic obvious. Pick one; document it in the JSDoc.)

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/panel/actions.ts — AcceptOutcome type + return-shape change
  - ADD: `export type AcceptOutcome = "noop" | "accept" | "veto" | false;` with the JSDoc above
  - CHANGE: `acceptOptionIndex(panel, q, optionIndex): boolean` → `: AcceptOutcome`
    - `if (opt === undefined) return false;`        # UNCHANGED
    - same-value branch: `advanceAfterAccept(panel); return "noop";`   # was `return true`
    - seam veto: `return "veto";`                    # was `return true` (comment stays: seam vetoed)
    - real commit tail: `return "accept";`           # was `return true`
  - CHANGE: accept() tail → `return acceptOptionIndex(panel, q, panel.cursorIndex) !== false;`
  - CHANGE: digit() tail → `return acceptOptionIndex(panel, q, n - 1) !== false;`
  - DO NOT TOUCH: commit logic, seam invocation order, advanceAfterAccept placement, evaluateDependsOn,
    maybeAutoSubmit, writeInEnter (S5 — different function), the S4 no-op condition itself
  - VERIFY: grep -n "acceptOptionIndex" src/panel/actions.test.ts — if any test calls it DIRECTLY and
    asserts toBe(true), update those assertions to the outcome string; S4's wrapper-based tests
    (accept/digit, toBe(true)) must stay green WITHOUT edits (coercion preserves them)

Task 2: MODIFY src/panel/deep-view.ts — acceptFromDeep switches on the signal
  - REPLACE the reference heuristic block:
      BEFORE (delete):
        const before = q.answer;
        const accepted = acceptOptionIndex(panel, q, index);
        // Veto detection without re-invoking the seam: applyAnswer always assigns
        // a FRESH answer object; a vetoed edit leaves the old one in place. On a
        // veto the user stays in deep view to re-decide (dropping to short would
        // hide the pane they are reading).
        if (q.answer === before) return true;
        panel.setView("short");
        panel.scrollOffset = 0;
        return accepted;
      AFTER:
        const outcome = acceptOptionIndex(panel, q, index);
        // ANSWER-PIN-001 / FR-D9: only a ripple VETO keeps the user in deep view
        // (dropping to short would hide the pane they are reading; nothing was
        // committed). A same-value NO-OP is NOT a veto — the Q14 advance already
        // ran inside acceptOptionIndex, so the panel returns to the short form
        // exactly like a real ACCEPT.
        if (outcome === "veto") return true;
        panel.setView("short");
        panel.scrollOffset = 0;
        return outcome !== false;
  - PURGE/REWRITE the acceptFromDeep JSDoc: the "No-op paths (all consumed, true)" bullet's
    "ripple VETO: … the view only changes on a real commit" clause → state the three outcomes:
    veto stays in deep; noop AND accept return to short (advance already ran); add the Mode A
    JSDoc sentence stating the no-op-vs-veto distinction (task DOCS obligation)
  - IMPORT: AcceptOutcome is inferred — no new import needed in deep-view.ts (it compares literals);
    add one only if you reference the type name

Task 3: MODIFY src/panel/deep-view.test.ts — new branch test, keep the rest green
  - ADD inside describe("acceptFromDeep") — both branches of the fix:
    test("test_same_value_noop_returns_to_short_and_advances", () => {
      const panel = setup(
        [choiceQ("q1", { answer: { value: "postgres", at: "t0" } }), choiceQ("q2")],
        { q1: "answered" },
      );
      panel.setView("deep"); // S1/FR-D8: caret seeds to the RECORDED answer's section
      expect(panel.cursorIndex).toBe(1); // postgres display row (row 0 = ★ sqlite, D-R13)
      const seam = vi.fn(() => true); // import vi from "vitest" if not already
      panel.rippleConfirm = seam;
      expect(acceptFromDeep(panel)).toBe(true); // consumed
      expect(panel.view).toBe("short"); // NO-OP is not a veto — return to short
      expect(panel.currentId).toBe("q2"); // Q14 advance ran inside the no-op
      expect(panel.scrollOffset).toBe(0);
      expect(seam).toHaveBeenCalledTimes(0); // FR-D9: same-value never consults the seam
      const q1 = panel.state.getQuestion("q1");
      expect(q1?.answer?.value).toBe("postgres"); // unchanged, same object
      expect(q1?.answer?.at).toBe("t0"); // no answer.at rewrite
      expect(q1?.status).toBe("answered"); // not re-marked, not reset
    });
  - KEEP GREEN (no edits): test_ripple_veto_stays_in_deep_without_committing (assigns
    panel.rippleConfirm = () => false — still stays in deep under the outcome signal),
    test_accept_applies_answer_returns_to_short_and_advances, test_accept_uses_highlighted_option_not_stale_cursor,
    text/moot/withdrawn consumed no-ops (they return BEFORE acceptOptionIndex — unaffected)
  - NOTE: the subtask contract cites "deep-view.test.ts ~:420" — that line anchor predates edits;
    the real home is the acceptFromDeep describe (~:471). Locate by describe name, not line number.

Task 4: VALIDATE (see Validation Loop) — targeted suites first, then full gates
```

### Implementation Patterns & Key Details

```ts
// PATTERN: outcome coercion at the boolean boundary (actions.ts) — the PanelActions
// interface pins accept/digit to boolean; every outcome except `false` is consumed:
export function accept(panel: InterrogationPanel): boolean {
  // ... unchanged routing (text / Other row / moot / withdrawn) ...
  return acceptOptionIndex(panel, q, panel.cursorIndex) !== false;
}

// PATTERN: the deep-view consumer interprets, never re-derives (deep-view.ts):
//   state identity checks (q.answer === before) are FORBIDDEN — the no-op's whole
//   point is that the answer object is untouched; that is why this signal exists.

// CRITICAL ordering fact (do not double-advance): acceptOptionIndex's no-op branch is
//   advanceAfterAccept(panel); return "noop";
// — the advance happens INSIDE the seam. acceptFromDeep adds ONLY the view switch.
```

### Integration Points

```yaml
STATE: none — state.ts untouched; the no-op's whole point is zero state writes
CONFIG: none — no keys, caps, or toggles (Phase D1 non-goal)
KEYS: none — keys.ts:446 consumes acceptFromDeep's unchanged boolean; do not touch
AUTO-SUBMIT: none — maybeAutoSubmit body untouched; the no-op path (S4) already never calls it
SCHEMA: none — tool-schema.ts was S3 (complete); no agent-visible surface changes here
DOCS: Mode A — JSDoc on AcceptOutcome + acceptOptionIndex (return values) + acceptFromDeep
  (no-op-vs-veto distinction); purge deep-view.ts ~559-566 comments. Rides with Tasks 1-2;
  no separate docs task. The broader cross-file comment sweep is S8 (P1.M1.T4) — do not chase it.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck        # tsc --noEmit — catches the truthy-string-vs-boolean coercion mistakes
# Expected: zero errors. The AcceptOutcome return-shape change MUST surface any
# un-coerced boolean call site here — that is the point of the type change.
```

(No ruff/mypy — this is a TypeScript project; `typecheck` + vitest are the gates.)

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run src/panel/deep-view.test.ts            # the acceptFromDeep describe: new noop test + veto + accept
npx vitest run src/panel/actions.test.ts              # S4's same-value suite stays green via wrapper coercion
npx vitest run src/panel/deep-view.test.ts -t acceptFromDeep   # scoped to the touched describe
# Expected: all pass. If S4 rows fail, the coercion in accept()/digit() is wrong — fix the
# coercion, never the tests (they were asserting correct behavior before this change).
```

### Level 3: Integration Testing (System Validation)

```bash
npm test                 # full vitest run — cross-cutting suites (panel, ac-panel, two-stage, short-view,
                         # overview, keys) must all stay green; this change is behaviorally invisible
                         # outside deep view
# Expected: zero failures repo-wide.
```

### Level 4: Creative & Domain-Specific Validation

Manual TUI sanity (optional here; AC-16's scripted end-to-end belongs to P1.M1.T5.S10):
in a scratch session, answer a question with a non-recommended option, `ctrl+d`, caret
should sit on the recorded section, `enter` → back to short form, next unanswered focused,
no modal. This is exactly the new unit test — the script is the authority.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean
- [ ] `npm test` fully green
- [ ] `npx vitest run src/panel/deep-view.test.ts -t acceptFromDeep` green including the NEW noop test
- [ ] S4's actions.test.ts same-value rows untouched and green

### Feature Validation

- [ ] Same-value enter-from-deep → short form + advance, zero state writes (`answer.at` unchanged, seam unconsulted, status unchanged)
- [ ] Ripple veto from deep → stays in deep (existing test green)
- [ ] Real accept from deep → short + advance (existing test green)
- [ ] Text/moot/withdrawn deep enters still consumed no-ops before the seam
- [ ] No `q.answer` before/after reference comparison remains anywhere in deep-view.ts

### Code Quality Validation

- [ ] AcceptOutcome exported + documented; acceptOptionIndex logic untouched (return literals only)
- [ ] accept()/digit() coerce at the boolean boundary; PanelActions interface unchanged
- [ ] Purged: the heuristic comment block and the JSDoc "view only changes on a real commit" claim
- [ ] Comments match the repo's contract-JSDoc voice (FR/ANSWER-PIN-001/h2.x citations)
- [ ] No files touched beyond actions.ts, deep-view.ts, deep-view.test.ts (and, only if a direct
      acceptOptionIndex assertion exists, actions.test.ts assertions)

### Documentation & Deployment

- [ ] Mode A docs rode with Tasks 1-2 (AcceptOutcome JSDoc, acceptFromDeep JSDoc, inline rationale)
- [ ] No README/config changes (S11 owns README; Phase D1 has no config surface)

## Anti-Patterns to Avoid

- ❌ Don't re-derive the outcome from state (reference/identity comparison) — that IS the bug being removed
- ❌ Don't advance twice — the Q14 advance lives inside acceptOptionIndex; acceptFromDeep only switches views
- ❌ Don't touch acceptOptionIndex's commit logic, seam order, or S4's no-op condition — return literals only
- ❌ Don't edit S4's wrapper-based tests to make them pass — fix the coercion instead
- ❌ Don't "fix" the custom write-in byte-equals-option case — S4 deliberately routes different-kind commits through the seam
- ❌ Don't chase the S8 cross-file comment sweep, S7's ★ marker, or S10's AC-16 test — out of scope
- ❌ Don't change acceptFromDeep's boolean signature or keys.ts routing

## Confidence Score

**9/10** — surgical change in two files with the exact current code, call-site inventory, fixture
shapes, and the seam doc's prescribed design all verified in-repo; the only residual uncertainty
is whether actions.test.ts's single textual `acceptOptionIndex` occurrence is an assertion (Task 1's
VERIFY step covers it).

# PRP — P1.M5.T3.S1: Gate group — focus, dimming, submit warning

---

## Goal

**Feature Goal**: Implement **soft gate semantics** (Q32=B, h2.56, FR-9/R1): when any question carries `gate: true`, its group becomes the *gate group*. The panel (1) opens focused on the first answerable question of the gate group if one is declared, else the first question (FR-1); (2) renders questions in NON-gate groups visually dimmed while remaining fully navigable/answerable (R1 — display gating only, NEVER commit gating); (3) on `ctrl+s` submit with gate questions still unanswered AND `config.gateWarnings` on, shows a **dismissible footer warning** `⚠ {n} foundational unanswered — later answers may shift` — any key dismisses it, and **the submission proceeds regardless** (display-only; h2.56 "gate the interaction, never the commitment").

**Deliverable**:
- `src/panel/gate.ts` — pure gate helpers: gate group detection, unanswered-gate count, warning text builder, gate-aware initial-focus picker (new file).
- `src/panel/gate.test.ts` — unit tests (new file).
- Surgical edits to `src/panel/panel.ts` (gate-aware initial focus; dimming + warning state/render), `src/panel/layout.ts` (dimmed question/hint line variants), `src/panel/short-view.ts` (dimmed option lines), `src/panel/actions.ts` (submit sets the warning, delivery proceeds), `src/panel/keys.ts` (any-key dismissal seam).

**Success Definition**: With a fixture where group "foundation" contains a `gate: true` question and later groups exist: panel open lands on the foundation group's first question; later groups render dimmed in short form (and overview rows once P1.M5.T2.S1 lands) yet tab/prev/next/enter/digits all still work on them (AC-1 gate-focused + dimmed-but-answerable); submitting with gate questions unanswered ships the submission AND shows the `⚠` footer line which any key dismisses; with `gateWarnings: false` no warning appears; with no gate declared, behavior is byte-identical to today. Full suite green, `npx tsc --noEmit` clean.

## User Persona

**Target User**: The pi user being interrogated.
**Use Case**: The agent marked a foundational group ("which storage engine?") as gate; the user should answer foundations first but is never blocked from peeking at or answering later questions.
**User Journey**: panel opens on the gate group → later groups look dimmed → user tabs ahead into a dimmed group (fully functional) → hits `ctrl+s` with foundations unanswered → submission ships, footer shows `⚠ 2 foundational unanswered — later answers may shift` → any keypress dismisses the warning.
**Pain Points Addressed**: blocking wizards that trap you on one question; silent submissions built on unanswered foundations.

## Why

- h2.56 (staging philosophy): all questions ship in the first upsert; grouping is **display + focus only**. This task is the display/focus half of that resolution.
- FR-9 / R1: navigation freedom is a HARD requirement — dimming is the strongest permitted signal, never a lock.
- Consumes `q.gate` from the tool schema (P1.M1.T3.S1, `src/tool-schema.ts:60`) and state (P1.M1.T2.S1, `src/state.ts:71`), `config.gateWarnings` (P1.M1.T1.S2, `src/config.ts:84` — already loaded into `InterrogationPanelArgs.config`), the short view (P1.M3.T2.S1), navigation (P1.M3.T2.S2), and panel host (P1.M3.T1.S1).
- Output is consumed by the short view (this task), the overview row builder (P1.M5.T2.S1 — parallel, see Integration), and future terminal fallbacks (P1.M7.T5).

## What

- **Gate group detection**: a group label is a gate group when ANY question in it (effective group `q.group ?? UNGROUPED_LABEL`) has `gate === true`. A group-level attribute, computed from membership — exactly the rule the overview `▲` uses (h2.19/P1.M5.T2.S1 contract).
- **Initial focus (FR-1)**: panel open with a gate group declared → `currentId` = first question of the gate group in `orderedQuestions()` order that is answerable (`open` or `reasked` or `answered`/`submitted` — i.e., NOT `withdrawn`); if none answerable, fall back to the gate group's first question; no gate declared → today's behavior (`pickInitialQuestionId`) unchanged. `focusQuestionId` (explicit agent override) still wins over everything.
- **Dimming (R1-safe display)**: when a gate group exists and the CURRENT question's effective group is NOT a gate group, the question line, hint line, and option lines of the short view render wrapped in `theme.fg("dim", ...)`. ALL behavior unchanged — cursor, ★, preselect, digits, enter, editor, moot/withdrawn variants — only the color class changes. No gate group → no dimming anywhere. When the current question IS in the gate group, its rendering is completely unchanged (gate group renders NORMAL, h2.29).
- **Dimming stays per-render, not per-mode**: deep view (P1.M5.T1.S1) and overview (P1.M5.T2.S1) consume the same helpers (overview dims non-gate rows via the exported `gateGroupNames()`); the deep view is in flight — do NOT edit `deep-view.ts`; expose the helpers and leave a one-line integration note in JSDoc (see Integration Points).
- **Submit warning (display-only)**: in `submit()` (actions.ts), AFTER a successful delivery path is decided but BEFORE `deliverSubmission`... actually order: compute `n = countUnansweredGate(panel.state)` first; if `panel.config.gateWarnings && n > 0`, set `panel.gateWarning = { count: n, token: ++dismissSeq }` and `panel.invalidate()`. **The submission then proceeds through the existing code path completely unchanged** (delivery, note clearing, drafts shipping) — the warning NEVER gates, vetoes, or delays anything (h2.56). The zero-pending early-return (`panel.flash("nothing to submit")`) shows NO gate warning (nothing was submitted).
- **Warning rendering**: an extra line directly above the footer (same slot as `renderFlashLine`, and flashes never stack — see Gotchas): `  ⚠ {n} foundational unanswered — later answers may shift`, rendered `theme.fg("dim", ...)` with the `⚠` accent — mirror `renderFlashLine`'s style (`src/panel/layout.ts:93-100`). It does NOT auto-expire (unlike flash) — it persists until any key dismisses it.
- **Dismissal (any key)**: in `panel.handleInput`, at the very top (before note-mode stage 1): if `this.gateWarning !== null`, set it to `null` + `invalidate()`, then **continue normal key processing** — the dismissing key still performs its normal action (dismiss + act, not consume). This means one keypress both clears the warning AND e.g. moves the cursor. That is the intended "any key dismisses" semantics (FR-9 wording).
- **[Mode A] JSDoc (contract 5)**: `src/panel/gate.ts` header documents soft gate vs commit gating: soft gate = focus + dim + warn (this task, Q32=B); commit gating = blocking submission until foundations answered — explicitly REJECTED by h2.56; the first upsert always carries all questions ("anti-loss anchor").

### Success Criteria

- [ ] Gate group detected from any member's `gate: true` (group-level, ungrouped bucket included)
- [ ] Panel opens focused on the gate group's first answerable question (FR-1); `focusQuestionId` still wins; no gate → unchanged behavior
- [ ] Non-gate questions dimmed in short form (question line, hint, options) but fully navigable/answerable (AC-1)
- [ ] Submit with gate unanswered + `gateWarnings: true` → warning line appears AND submission delivers unchanged
- [ ] Warning text exactly `⚠ {n} foundational unanswered — later answers may shift`; any key dismisses it while still acting
- [ ] `gateWarnings: false` or n=0 → no warning; zero-pending submit → no warning
- [ ] No gate group anywhere → rendering byte-identical to current output (regression guard)
- [ ] All existing tests pass (`npx vitest run`, `npx tsc --noEmit`)

## All Needed Context

### Context Completeness Check

Verified: an agent with only this PRP + the listed files can implement everything. `q.gate` already flows through schema → merge → state; `config.gateWarnings` is already loaded and on the panel; the flash/footer/question-line renderers exist and show exactly where the warning and dimming slot in. Nothing needs new config, schema, or state changes.

### Documentation & References

```yaml
- file: src/state.ts
  why: Question.gate (line 71), orderedQuestions(), groupSummaries(), UNGROUPED_LABEL export
  pattern: read q.group ?? UNGROUPED_LABEL for the effective group key (groupSummaries precedent)
  gotcha: gate is a QUESTION-level flag that marks a GROUP-level attribute — never treat an individual non-gate member of a gate group as "not gate"

- file: src/config.ts
  why: gateWarnings boolean (line 84, default true, deep-merged at line 245) — already on InterrogatorConfig, already on the panel via args.config
  pattern: panel.config.gateWarnings — NO config changes needed in this task
  gotcha: do not add any new config keys; this task adds zero config surface

- file: src/panel/panel.ts
  why: pickInitialQuestionId (line 770 — replace with gate-aware version), InterrogationPanelArgs.config (line 181), handleInput (line 435 — dismissal seam), buildLines short branch (~line 722), flash()/renderFlashLine slot, currentId setter re-seeds cursorIndex
  pattern: fields + invalidate() discipline; render caching (render(width))
  gotcha: never await in render paths; dismissal must CLEAR then CONTINUE processing (not return true)

- file: src/panel/layout.ts
  why: renderFlashLine (lines 93-100 — the exact styling to mirror for the warning line), renderQuestionLine (~248), renderHintLine (~286), truncateVisible/visibleWidth, UNGROUPED_LABEL
  pattern: theme.fg("dim", `  ${truncateVisible(...)}`)
  gotcha: dimming whole lines = wrap the FINISHED line in theme.fg("dim", line) AFTER truncation so visibleWidth accounting stays honest (layout.ts:216 pattern)

- file: src/panel/short-view.ts
  why: pure options renderer to extend with a dimmed variant; INSET/CURSOR/STAR/BLANK constants; moot/withdrawn lines already dimmed
  pattern: add optional `dimmed?: boolean` to ShortViewInput; wrap each produced line in theme.fg("dim", ...) at the END of the builder (one place, purity kept)
  gotcha: moot/withdrawn lines are already dim — double-dimming is harmless but avoid it by wrapping before ANSI composition where clean; NEVER reorder or restyle content

- file: src/panel/actions.ts
  why: submit() (line 297) — where the warning is set; SubmitDeps; the zero-pending early-return at line 301
  pattern: mutation = panel field + panel.invalidate(); delivery code stays byte-identical
  gotcha: set the warning BEFORE deliverSubmission so it survives even if delivery throws in a future host; do NOT return early or veto — h2.56

- file: src/panel/keys.ts
  why: resolution order (arrows before esc; config intercepts; digits gated on views) — verify no changes needed beyond panel-level dismissal
  pattern: dismissal lives in panel.handleInput stage-0, BEFORE the key router — keys.ts likely UNTOUCHED
  gotcha: parallel tasks (deep view P1.M5.T1.S1, overview P1.M5.T2.S1) are editing keys.ts steps 1/3 — touching it here invites merge conflicts; prefer zero keys.ts edits

- file: plan/001_0d6760db6bc5/P1M5T2S1/PRP.md
  why: CONTRACT for the parallel overview task — it builds gateGroups detection ITSELF (its "Key Details" shows `new Set(ordered.filter(q => q.gate).map(...))`)
  pattern: your src/panel/gate.ts becomes the SHARED home of that helper; the overview may already have a local copy — refactor its local `gateGroups` const to import from gate.ts ONLY if it exists when you start; otherwise note the seam in JSDoc (do not break its tests)
  gotcha: identical rule, two homes = drift risk; consolidate into gate.ts when both exist

- file: plan/001_0d6760db6bc5/P1M5T1S1/PRP.md
  why: deep view contract — it reuses short-view ★/▸ styling and will render the CURRENT question; dimming must compose (a dimmed non-gate question in deep view SHOULD also be dim)
  gotcha: deep-view.ts is in flight — do NOT edit it; export the helper, document the seam, done
```

### Current Codebase tree (relevant slice)

```bash
src/
  config.ts            # gateWarnings (exists, loaded)
  state.ts             # q.gate, orderedQuestions(), groupSummaries(), UNGROUPED_LABEL
  panel/
    panel.ts           # pickInitialQuestionId, handleInput, buildLines, flash slot
    layout.ts          # renderFlashLine, renderQuestionLine, renderHintLine, theme helpers
    short-view.ts      # options renderer → dimmed variant
    actions.ts         # submit() → warning set
    keys.ts            # router (target: ZERO edits here)
```

### Desired Codebase tree with files to be added

```bash
src/panel/
  gate.ts              # NEW — gateGroupNames, countUnansweredGate, gateWarningLine,
                       #        pickGateInitialQuestionId + soft-gate JSDoc (Mode A)
  gate.test.ts         # NEW — unit tests
  layout.ts            # MODIFIED — renderGateWarningLine; dimmed variants for
                       #        renderQuestionLine/renderHintLine (optional `dim` param)
  short-view.ts        # MODIFIED — `dimmed?: boolean` on ShortViewInput, end-wrap dimming
  actions.ts           # MODIFIED — submit() sets panel.gateWarning before delivery
  panel.ts             # MODIFIED — gateWarning field + stage-0 dismissal, gate-aware
                       #        initial focus, dimming flag in buildLines, warning render
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: SOFT gate only (Q32=B / h2.56): the warning NEVER blocks, delays,
//   or vetoes a submission — ctrl+s with gate unanswered MUST still deliver.
// CRITICAL: display text is ANSI/wide-char — dimming wraps a FINISHED line:
//   theme.fg("dim", line) AFTER truncateVisible, never before (layout.ts:216
//   pattern). visibleWidth treats the wrap transparently.
// CRITICAL: "any key dismisses" = clear + CONTINUE processing. Returning
//   `true` from handleInput after clearing would swallow the key (e.g. the
//   first ↑ after submit would do nothing but dismiss) — FR-9 says the key
//   still acts.
// CRITICAL: flashes never stack (h2.37) — the warning line and
//   renderFlashLine share the slot above the footer. Warning wins while
//   active (it is more important than a 2.5s flash); when the warning is
//   dismissed, a still-live flash may resume showing. Simplest correct rule:
//   render warning line if set, else flash line.
// CRITICAL: dimming must NOT apply when NO gate group is declared —
//   regression-guard with a byte-identical render test (no-gate fixture).
// CRITICAL: an explicit focusQuestionId (agent override) beats gate focus.
// CRITICAL: unanswerable gate groups: if every gate-group question is
//   withdrawn/moot, fall back to the gate group's FIRST question (still
//   focused there, dimming still applies to others).
// CRITICAL: the gate group itself renders NORMAL (never dimmed, h2.29) —
//   dim only questions whose effective group ∉ gateGroupNames.
// CRITICAL: parallel tasks own keys.ts steps 1/3 and buildLines deep/overview
//   branches — merge your buildLines additions around theirs; zero keys.ts edits.
```

## Implementation Blueprint

### Data models and structure

No persistent/state-model changes. Panel-local additions (panel.ts):

```typescript
/** Active soft-gate submit warning (P1.M5.T3.S1). Non-expiring; any key
 *  dismisses (handleInput stage 0 clears it and continues processing). */
gateWarning: { count: number } | null = null;
```

New exports in `src/panel/gate.ts`:

```typescript
import type { InterrogationState, Question } from "../state.js";
import { UNGROUPED_LABEL } from "../state.js";

export type GateGroups = ReadonlySet<string>;

export function effectiveGroup(q: Question): string;                 // q.group ?? UNGROUPED_LABEL
export function gateGroupNames(ordered: Question[]): GateGroups;     // any q.gate marks its group
export function countUnansweredGate(ordered: Question[], gate: GateGroups): number;
// ↑ counts questions in gate groups with NO answer: status open/reasked and
//   q.answer === undefined (moot/withdrawn/closed with answers don't count;
//   answered/submitted DO have answers). open-with-no-answer && open-with-moot…
//   keep it simple: unanswered = q.answer === undefined && status !== "withdrawn" && status !== "moot".
export function gateWarningLine(count: number): string;              // `⚠ {n} foundational unanswered — later answers may shift`
export function pickGateInitialQuestionId(
  ordered: Question[], gate: GateGroups, focusQuestionId: string | undefined,
): string | undefined;                                               // FR-1 ladder (see What)
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/panel/gate.ts (pure helpers + Mode A JSDoc)
  - IMPLEMENT: the five exports above; header JSDoc = the [Mode A] soft-gate
    vs commit-gating contract note (contract 5): soft gate = focus + dim +
    warn (Q32=B, h2.56); commit gating (blocking submit until foundations
    answered) explicitly rejected — the first upsert always carries ALL
    questions (anti-loss anchor). Also document the overview/deep seams.
  - FOLLOW pattern: short-view.ts JSDoc header discipline (vocabulary/why blocks)
  - PLACEMENT: src/panel/gate.ts

Task 2: MODIFY src/panel/layout.ts — warning line + dimmed line variants
  - IMPLEMENT: renderGateWarningLine(text, theme, width): string — mirror
    renderFlashLine exactly (2-space inset, dim wrap, truncateVisible to
    width - 2); caller passes gateWarningLine(n)
  - IMPLEMENT: optional `dim?: boolean` param on renderQuestionLine and
    renderHintLine — when true, wrap the FINISHED line in theme.fg("dim", ...)
    (after truncation; default false keeps every existing call/test green)
  - GOTCHA: do not touch renderHeader/renderFooter/statusMarkers
  - PLACEMENT: layout.ts, next to renderFlashLine

Task 3: MODIFY src/panel/short-view.ts — dimmed variant
  - IMPLEMENT: `dimmed?: boolean` on ShortViewInput; when true the exported
    builder wraps each returned line in theme.fg("dim", line) at the END
    (single seam; moot/withdrawn lines may double-dim — acceptable, or skip
    wrapping lines already dimmed via a startsWith check on the plain prefix)
  - GOTCHA: content, order, prefixes, ★/✎ glyph logic byte-identical — only
    color class changes; existing tests must pass unmodified
  - PLACEMENT: short-view.ts

Task 4: MODIFY src/panel/panel.ts — focus, dimming, warning state + render, dismissal
  - FOCUS: replace pickInitialQuestionId's internal ladder with
    pickGateInitialQuestionId (compute ordered + gateGroupNames once in the
    constructor, line ~382): focusQuestionId → gate group first answerable →
    gate group first question → first open → first → undefined. NO gate
    declared ⇒ pickGateInitialQuestionId must degenerate to the current
    ladder exactly (pass-through)
  - DIMMING: in buildLines' short branch, compute
    dimmed = gateGroupNames.size > 0 && !gateGroupNames.has(effectiveGroup(currentQ))
    and pass through to renderQuestionLine(dim), renderHintLine(dim), and
    ShortViewInput.dimmed. Cache-friendly: derived per build, no new fields.
    Do NOT dim the header, footer, or flash line
  - WARNING: add gateWarning field; in buildLines render
    renderGateWarningLine ABOVE the footer when gateWarning !== null (and let
    it win over renderFlashLine in the shared slot — see gotcha)
  - DISMISSAL: handleInput stage 0 (before note-mode): if this.gateWarning
    then set null + invalidate() and FALL THROUGH to normal processing
  - GOTCHA: merge around the parallel deep/overview branches in buildLines
    (if/else chain note → short → deep → overview, per P1M5T2S1 contract)
  - PLACEMENT: panel.ts

Task 5: MODIFY src/panel/actions.ts — submit() sets the warning
  - IMPLEMENT: in submit(), after the zero-pending early-return and BEFORE
    buildSubmission: compute ordered + gate groups +
    n = countUnansweredGate(...); if (n > 0 && panel.config.gateWarnings)
    → panel.gateWarning = { count: n } (invalidate happens via the change
    events/delivery path; add panel.invalidate() defensively). Then the
    EXISTING code continues verbatim — delivery, drafts shipping, note clear
  - GOTCHA: NEVER gate the submission (h2.56); zero-pending path returns
    early above this code and shows no warning; JSDoc the display-only rule
  - PLACEMENT: actions.ts submit()

Task 6: CREATE src/panel/gate.test.ts + EXTEND panel.test.ts / actions.test.ts / layout.test.ts / short-view.test.ts
  - gate.test.ts: effectiveGroup (ungrouped → UNGROUPED_LABEL); gateGroupNames
    (any-member rule, ungrouped gate, empty, none); countUnansweredGate
    (open counts, answered/submitted don't, moot/withdrawn excluded);
    gateWarningLine exact string; pickGateInitialQuestionId full ladder
    (focusId wins, gate first-answerable, all-withdrawn fallback, no-gate
    degenerates to first-open/first)
  - panel.test.ts: gate fixture opens on gate group's first question; non-gate
    current question renders dim (assert line contains the theme dim wrap —
    theme.fg is a passthrough in tests; assert via a stub theme that tags
    dim-wrapped text); no-gate fixture renders byte-identical to pre-change
    golden; gateWarning renders above footer; any-key dismisses AND acts
    (e.g. ↑ clears warning and moves cursor); focusQuestionId beats gate
  - actions.test.ts: submit with gate unanswered + gateWarnings true →
    delivery called (unchanged) AND panel.gateWarning set; gateWarnings false
    → no warning, delivery unchanged; all gate answered → no warning;
    zero-pending → no warning
  - layout.test.ts: renderGateWarningLine truncation/inset; dim variants of
    question/hint lines (dim=false output unchanged)
  - short-view.test.ts: dimmed:true wraps lines, content identical otherwise
  - FOLLOW pattern: existing colocated vitest suites (raw key bytes in panel
    tests, vi.fn() SubmitDeps in actions tests)
  - PLACEMENT: colocated
```

### Implementation Patterns & Key Details

```typescript
// Dimming seam (layout.ts) — wrap AFTER truncation:
// return dim ? theme.fg("dim", plain) : plain;

// Initial-focus ladder (gate.ts):
// function pickGateInitialQuestionId(ordered, gate, focusQuestionId) {
//   if (focusQuestionId && ordered.some(q => q.id === focusQuestionId)) return focusQuestionId;
//   if (gate.size > 0) {
//     const gateQs = ordered.filter(q => gate.has(effectiveGroup(q)));
//     const answerable = gateQs.find(q => q.status !== "withdrawn" && q.status !== "moot");
//     if (answerable || gateQs.length > 0) return (answerable ?? gateQs[0]).id;
//   }
//   return (ordered.find(q => q.status === "open") ?? ordered[0])?.id;  // unchanged tail
// }

// handleInput stage 0 (panel.ts):
// if (this.gateWarning !== null) { this.gateWarning = null; this.invalidate(); }
// ... existing stages continue; the key still acts.

// submit() seam (actions.ts) — display-only:
// const ordered = panel.state.orderedQuestions();
// const n = countUnansweredGate(ordered, gateGroupNames(ordered));
// if (n > 0 && panel.config.gateWarnings) panel.gateWarning = { count: n };
// // h2.56: submission proceeds regardless — no early return, no veto.
```

### Integration Points

```yaml
CONFIG: none — gateWarnings already exists (default true); no new keys
STATE: none — q.gate already flows schema → merge → state
OVERVIEW (P1.M5.T2.S1, parallel): its buildOverviewContent computes the SAME
  gate-group set for the ▲ header mark; once both tasks have landed,
  refactor its local `new Set(ordered.filter(q => q.gate)…)` to import
  gateGroupNames (one-line swap; keep its tests green). Optionally dim
  non-gate overview rows via the same set — that is a nice-to-have within
  this task's "consumed by short/overview views" contract; implement ONLY if
  overview.ts exists when you start, else leave the documented seam.
DEEP VIEW (P1.M5.T1.S1, in flight): DO NOT edit deep-view.ts; the dim flag
  composes later via the exported helpers (documented in gate.ts JSDoc).
NO delivery / persistence / lifecycle changes — soft gate is presentation-only.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npx tsc --noEmit          # zero errors
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/gate.test.ts
npx vitest run src/panel/layout.test.ts src/panel/short-view.test.ts
npx vitest run src/panel/panel.test.ts src/panel/actions.test.ts
npx vitest run             # full suite — no regressions (incl. parallel M5 tasks once merged)
```

### Level 3: Integration (manual/TUI smoke — record for M7.T6.S2)

```bash
# /interrogate-debug-upsert fixture: two groups, one gate:true question in
# group "foundation", several later-group questions, gateWarnings default true.
# Manual: panel opens ON foundation; later groups dimmed when navigated to;
# tab into a dimmed group → answer works; ctrl+s with gate unanswered →
# submission delivers (agent receives it) AND `⚠ 1 foundational unanswered…`
# shows; any key dismisses while still acting; settings gateWarnings:false →
# no warning line.
```

### Level 4: Edge cases (scripted)

```bash
npx vitest run src/panel/gate.test.ts -t "no gate"      # degenerate no-gate paths
npx vitest run src/panel/panel.test.ts -t "dim"         # dimming + byte-identical no-gate golden
npx vitest run src/panel/actions.test.ts -t "warning"   # display-only submit semantics
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` full suite green
- [ ] No new dependencies, no config surface changes, no keys.ts edits

### Feature Validation

- [ ] Gate group detected via any-member `gate: true` (incl. ungrouped bucket)
- [ ] Opens on gate group (FR-1); `focusQuestionId` still wins (AC-1 gate-focused)
- [ ] Non-gate questions dimmed but fully navigable/answerable (R1, AC-1)
- [ ] Submit warning exact text; appears only when gateWarnings on AND n>0 AND something shipped
- [ ] Submission ALWAYS proceeds (h2.56); any key dismisses while still acting
- [ ] No-gate rendering byte-identical (regression golden test)

### Code Quality Validation

- [ ] gate.ts pure (no pi imports beyond types), [Mode A] JSDoc on soft vs commit gating
- [ ] Dimming implemented as color-class-only wraps; content byte-identical
- [ ] Shared slot rule: warning wins over flash while active
- [ ] Parallel-task edit sites respected (buildLines merged, keys.ts untouched)

## Anti-Patterns to Avoid

- ❌ Don't block, delay, or veto submission — that is commit gating, explicitly rejected (h2.56)
- ❌ Don't hide/disable/lock non-gate questions — dim only (R1 hard requirement)
- ❌ Don't consume the dismissing key — clear + continue
- ❌ Don't dim via string slicing/recomposition — wrap finished lines with theme.fg("dim", …)
- ❌ Don't add config keys or touch keys.ts / deep-view.ts / state.ts
- ❌ Don't duplicate gate-group detection — gate.ts is the single home; refactor the overview's local copy once both exist

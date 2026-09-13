# PRP — P1.M3.T2.S2: Navigation — option movement, digits, enter accept+advance, tab freedom

## Goal

**Feature Goal**: Implement navigation for the short view as **NAMED ACTION handlers** — `optionUp`, `optionDown`, `digitN`, `accept`, `prevQuestion`, `nextQuestion`, plus `submit` and the ripple-confirm routing — in a new module `src/panel/actions.ts`, fully independent of raw-key parsing. Keys (`tab`/`shift+tab`, digits, arrows) are bound to these actions later by `keys.ts` (P1.M3.T3.S1); this task defines and implements the action surface itself, plus a minimal internal key matcher so the panel is usable/testable before T3 lands (mirroring how panel.ts ships a minimal built-in binding set).

Hard requirement **R1** (FR-9): forward/back among questions at ALL times, nothing locks the user onto a question — `prevQuestion`/`nextQuestion` move freely across ALL questions (open, answered, re-asked, moot, withdrawn). **Q14=A**: `enter` = accept + advance.

**Deliverable**: `src/panel/actions.ts` (action registry + advance algorithm + submit flush) and `src/panel/actions.test.ts`; small modifications to `src/panel/panel.ts` (cursor mutation hook-up, footer flash field, wiring the action dispatch into `handleInput` before the existing S1 built-ins) and `src/panel/layout.ts` (footer renders a transient flash line) if needed for the flash.

**Success Definition**: All action handlers work against the live `InterrogationState` + `InterrogationPanel`; accept on an option commits `applyAnswer` (status → `answered`, the pending state) and advances to the next unanswered question with wrap; accept on an **answered** question routes through the ripple-confirm seam (no-op callback until P1.M5.T4.S1); submit flushes pending answers through `buildSubmission` + `deliverSubmission`; zero pending → footer flash `nothing to submit` (h2.37); `npm run typecheck` + `npm test` green.

## Why

R1 is a hard requirement from user tooling evaluations: any modal lock onto a question is disqualifying. This task delivers the accept+advance loop (the core interaction of the whole panel), the digit quick-select, and the submit flush path — the interactive contract between the user and the state engine built in M1/M2. The named-action indirection exists so P1.M3.T3.S1 can bind arbitrary configured keys (R5) to semantics without touching this logic.

## What

### Action surface (consumed by keys.ts, P1.M3.T3.S1)

All handlers take `(panel: InterrogationPanel)` and read `panel.currentId`, `panel.cursorIndex`, `panel.state`, `panel.config` from the instance. Each returns `boolean` = "consumed/handled" (always true for these named actions when a panel question context exists; see per-action notes).

1. **optionUp / optionDown** — move `panel.cursorIndex` within the cursor domain defined by S1: choice questions `0..q.options.length` (last index = ✎ affordance), text questions `{0}`. Clamp at both ends (no wrap). Invalidate after moving.
2. **digitN(n: 1..9)** — only when `config.digitQuickSelect` is on. If `n-1 < q.options.length`, immediately accept option `n-1` (same path as `accept`); otherwise no-op. Out of range → no-op (return false).
3. **accept** — context-dependent:
   - Cursor on an option (choice): commit the answer via `panel.state.applyAnswer(id, { value: opt.value, at: new Date().toISOString() })` — status becomes `answered` (the *pending* state, h2.38; AC-13: editing re-marks pending). Then advance (below).
   - Cursor on the ✎ affordance (index `q.options.length`): set `panel.focus = "text"` and no-op otherwise (the editor is P1.M4.T1.S2; leave a seam).
   - Text question: no-op (field composition is M4).
   - Question already `answered` or `submitted` (edit case): DO NOT applyAnswer directly — call the **ripple-confirm seam** first: `panel.confirmRippleEdit(id, proposedAnswer)`. Until P1.M5.T4.S1, the default seam is a no-op `() => true` callback, so current behavior = applyAnswer then advance. The seam invocation point is the contract; M5.T4.S1 swaps the default.
   - `moot` or `withdrawn` question: no-op.
4. **prevQuestion / nextQuestion** — move `currentId` by ±1 through `state.orderedQuestions()` (order array), clamping at the ends (no wrap for explicit navigation — wrap belongs only to advance). ALL statuses navigable (R1). Reset `cursorIndex = initialCursorIndex(newQ)` on every question change (S1's helper). Invalidate.
5. **advance (internal, after accept)** — next question with an *unanswered* status, scanning forward from the current index through the END of `orderedQuestions()`, then WRAPPING to index 0 and continuing up to (not past) the current index. "Unanswered" = status `open` or `reasked`. If none unanswered: stay on the current question (all answered). Mode A JSDoc required on this function (see Task 1).
6. **submit** — flush pending answers (see Implementation Blueprint for the diff baseline). With zero pending: set the footer flash `nothing to submit` (exact string, h2.37) — no delivery, no epoch bump.

### Minimal key matcher (temporary, until keys.ts)

Wire into `InterrogationPanel.handleInput` BEFORE the existing S1 built-ins: `↑` (`\u001b[A`) / `↓` (`\u001b[B`) → optionUp/optionDown (keys are FIXED per h2.34 — not config-driven); `1`–`9` (`\x31`–`\x39`) → digitN when `digitQuickSelect`; `enter` (`\r` and `\n`) → accept; `tab` (`\t`) → nextQuestion... **CAREFUL**: h2.34 defaults are `tab` = prev? No — table says `prev/next question: tab / shift+tab`. Per the table, `tab` → prevQuestion's default is listed first ("prev/next: tab / shift+tab" ⇒ tab = prevQuestion? Verify against config.ts defaults: `prevQuestion: "tab"`, `nextQuestion: "shift+tab"`). Follow config.ts; bind via the config string where expressible (extend the existing `ctrlSequence` approach or hardcode `\t` / `\u001b[Z` for shift+tab with a comment that keys.ts replaces this). Mark all of this clearly as TEMPORARY — keys.ts (P1.M3.T3.S1) owns final dispatch and this minimal matcher must be removable without touching actions.ts.

### Success Criteria

- [ ] accept on option → `applyAnswer` called (status `answered`), cursor advances to next unanswered question; wraps past the end (AC-1, Q14=A).
- [ ] accept on the LAST unanswered question → stays on it.
- [ ] prev/next traverse ALL statuses incl. answered/moot/withdrawn; never blocked (R1/FR-9/AC-2).
- [ ] digit `1`..`9` selects when `digitQuickSelect: true`; digits 1–9 work; disabled → digits fall through (return false).
- [ ] digit beyond option count → no-op.
- [ ] accept on answered question goes through the ripple-confirm seam (test asserts the seam callback was invoked with the right args); default no-op seam applies and advances.
- [ ] Editing an answered question re-marks it `answered(pending)` (AC-13) — accept with a different option value updates `q.answer` and status back to `answered`.
- [ ] Submit with pending → exactly one `buildSubmission` (snapshot + single epoch bump inside it) and one `deliverSubmission`; with zero pending → footer flash `nothing to submit`, NO snapshot/epoch side effects.
- [ ] Every mutation path calls `panel.invalidate()` so the render cache never goes stale.
- [ ] Mode A JSDoc on the advance algorithm (wrap semantics, "unanswered" definition).

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the panel instance fields (currentId, cursorIndex from S1, focus, state, config), the state primitives (`applyAnswer`, `orderedQuestions`, statuses), the submission path (baseline diff → buildSubmission → deliverSubmission), the S1 cursor-domain contract, and the exact config key names. All below with file anchors.

### Documentation & References

```yaml
- file: src/panel/panel.ts
  why: THE host. Fields view/focus/currentId/deepSticky; cursorIndex is added by S1 (its PRP Task 2 — treat as present). handleInput: keys seam first, then S1 built-ins — slot the minimal matcher between the keys seam and the S1 built-ins. invalidate()/render cache discipline. InterrogationPanelArgs already carries keys?: KeyHandler.
  gotcha: this.resolved guard at top of handleInput — respect it; never act on a suspended panel. The panel re-reads state on every render rebuild, so mutations need only invalidate().

- file: plan/001_0d6760db6bc5/P1M3T2S1/PRP.md
  why: CONTRACT (implementing in parallel): cursorIndex field + initialCursorIndex(q) exported from src/panel/short-view.ts; cursor domain 0..q.options.length (✎ = last); text questions domain {0}; options order = state order. Also mootReason for moot detection (or just read q.status).
  gotcha: if S1 has not landed when you start, implement against its contract and add the field yourself ONLY if missing (coordinate; do not duplicate initialCursorIndex).

- file: src/state.ts
  why: applyAnswer(id, {value, at}) (~line 334) — sets answer + status "answered", never touches rev, emits changed (which already invalidates the panel via the panel's own state.on("changed")). orderedQuestions() — state order. QuestionStatus union (~line 22): open|answered|submitted|reasked|moot|withdrawn|closed. state.snapshots: Snapshot[] ring (readonly).
  gotcha: statuses "unanswered" for advance = open + reasked. "closed" (auto-closed) should be skipped by advance but still navigable via prev/next.

- file: src/config.ts
  why: InterrogatorConfig.keys incl. prevQuestion ("tab"), nextQuestion ("shift+tab"), submit ("ctrl+s"); digitQuickSelect boolean (default true); KeyAction union includes optionUp? NO — h2.34 marks arrows/enter/esc FIXED (not in KeyAction). resolveKeyLabels for footer.
  gotcha: do NOT add arrow/enter to the config KeyAction union — they are fixed by design.

- file: src/delivery.ts
  why: buildSubmission(state, diff, note?) (~line 116) — performs takeSnapshot + state.bumpEpoch() ITSELF (exactly once; never duplicate). deliverSubmission(pi, msg, {isIdle}) (~line 465) — one sendMessage; idle probe from ctx.
  gotcha: buildSubmission does NOT flush answers — the caller must applyAnswer first; computeDiff baseline must be PRE-mutation.

- file: src/snapshots.ts
  why: computeDiff(prev: SerializedState, next: SerializedState, note?) (~line 200). Baseline for "pending since last submission" = latest snapshot's state, falling back to a fresh empty baseline BEFORE the first snapshot exists.
  gotcha: submit ordering contract (see debug-commands.ts ~line 143): baseline serialize() BEFORE any mutation; buildSubmission afterwards.

- file: src/debug-commands.ts (~lines 130–180)
  why: THE in-repo reference implementation of the exact submit path this task reuses: pre = state.serialize(); applyAnswer loop; diff = computeDiff(pre, state.serialize()); msg = buildSubmission(state, diff); deliverSubmission(pi, msg, {isIdle: () => true}). Follow this sequence.
  gotcha: zero-pending check there is pairs.length===0; here it must be diff.changed.length === 0 (answers pending since last submission).

- file: plan/001_0d6760db6bc5/docs (ui-spec.md / state-and-persistence.md if present)
  why: h2.34 fixed keys, h2.37 empty states ("nothing to submit" flash), h2.38 state machine (answered(pending)).
```

### Current Codebase tree (relevant excerpt)

```bash
src/
  state.ts            # applyAnswer, orderedQuestions, statuses, snapshot ring
  config.ts           # keys.prevQuestion/nextQuestion/submit, digitQuickSelect
  snapshots.ts        # computeDiff
  delivery.ts         # buildSubmission, deliverSubmission
  debug-commands.ts   # reference submit sequence (read-only reference)
  panel/
    panel.ts          # MODIFY: dispatch seam + footerFlash + minimal matcher
    layout.ts         # MODIFY (small): footer flash line, if renderFooter doesn't cover it
    short-view.ts     # from S1 (parallel): initialCursorIndex, cursor domain
    actions.ts        # CREATE (this task)
    actions.test.ts   # CREATE
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: buildSubmission performs takeSnapshot + bumpEpoch internally —
// calling either yourself double-bumps the epoch and corrupts stale guards.
// CRITICAL: computeDiff baseline must be captured BEFORE applyAnswer —
// serialize() is a deep copy, so capture pre first (debug-commands pattern).
// GOTCHA: state.applyAnswer emits "changed" → panel.onChanged → invalidate,
// so applyAnswer paths don't strictly need a manual invalidate — but add it
// anyway for cursor/currentId changes which do NOT touch state.
// GOTCHA: enter arrives as "\r" (0x0d) in terminal input; also accept "\n"
// defensively. shift+tab arrives as ESC [ Z ("\u001b[Z"). tab is "\t".
// GOTCHA: arrows arrive as "\u001b[A"/"\u001b[B" (also accept "\u001bOA"/"OB"
// application-mode variants). Esc-vs-arrow disambiguation matters for the S1
// built-ins — arrows are 3 bytes starting with ESC; check arrow sequences
// BEFORE any esc handling, or the esc branch eats the leading byte.
// GOTCHA: moot/withdrawn questions: render dimmed (S1) and accept is a no-op,
// but prev/next MUST still traverse them (R1).
// GOTCHA: never advance onto a question whose status is moot/withdrawn/
// closed — advance only lands on open/reasked. If the ONLY remaining
// questions are those, stay put.
// GOTCHA: ripple seam must be a panel field (constructor arg or setter), NOT
// an import from a not-yet-existing module — M5.T4.S1 wires the real flow.
// GOTCHA: footer flash needs to expire: store {text, expiresAt} on the panel;
// render checks Date.now() and re-invalidates once via setTimeout(→invalidate)
// ~2.5s. Keep the timer cancellable on dispose to avoid post-suspend repaints.
```

## Implementation Blueprint

### Data shapes

```ts
// src/panel/actions.ts
import type { InterrogationPanel } from "./panel.js";

/** Ripple-confirm seam — P1.M5.T4.S1 swaps the default (always-true no-op). */
export type RippleConfirmFn = (
  panel: InterrogationPanel,
  questionId: string,
  proposed: { value: string; at: string },
) => boolean;

export interface PanelActions {
  optionUp(panel: InterrogationPanel): boolean;
  optionDown(panel: InterrogationPanel): boolean;
  digit(panel: InterrogationPanel, n: number): boolean; // 1..9
  accept(panel: InterrogationPanel): boolean;
  prevQuestion(panel: InterrogationPanel): boolean;
  nextQuestion(panel: InterrogationPanel): boolean;
  submit(
    panel: InterrogationPanel,
    deps: SubmitDeps,
  ): boolean;
}

export interface SubmitDeps {
  /** Narrow pi surface for delivery (mirrors deliverSubmission's Pick). */
  sendMessage: (msg: unknown, opts: unknown) => void;
  isIdle: () => boolean;
}

/**
 * Next unanswered question id after accept — forward scan with wrap.
 * (Mode A JSDoc HERE — see Task 1.)
 */
export function nextUnanswered(
  ordered: Array<{ id: string; status: string }>,
  fromIndex: number,
): string | undefined;

/** Pending-answer diff baseline: latest snapshot state, else empty baseline. */
export function submissionBaseline(panel: InterrogationPanel): SerializedState;
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/panel/actions.ts — core actions
  - IMPLEMENT: optionUp/optionDown (clamp over cursor domain: domainSize = q.type==="text" ? 1 : (q.options?.length ?? 0) + 1), digit, prevQuestion/nextQuestion (±1 over orderedQuestions(), clamp, reset cursorIndex = initialCursorIndex), nextUnanswered + advance helper
  - MODE A JSDoc on nextUnanswered/advance: document (a) forward scan from current index+1 to end, (b) wrap to 0 and continue to current index inclusive, (c) "unanswered" = status open|reasked, (d) no match → undefined → stay
  - PLACEMENT: src/panel/actions.ts; import initialCursorIndex from ./short-view.js (S1 contract — if absent at implementation time, define a local fallback with a TODO comment and reconcile)

Task 2: actions.ts — accept + submit + ripple seam
  - IMPLEMENT accept per "What" §3 (option commit / ✎ focus seam / text no-op / answered→ripple seam first / moot+withdrawn no-op), then advance
  - IMPLEMENT submit: pre = submissionBaseline(panel) BEFORE any mutation — but panel submit does NOT mutate (answers were already applied by accept; pending = answered-since-last-snapshot). So: diff = computeDiff(pre, panel.state.serialize()); if diff.changed.length === 0 → panel.flash("nothing to submit"), return true; else msg = buildSubmission(panel.state, diff) (it snapshots+bumps) and deliverSubmission(deps-as-pi-shape, msg, { isIdle: deps.isIdle })
  - GOTCHA: deliverSubmission's pi param is Pick<ExtensionAPI,"sendMessage"> — SubmitDeps satisfies it structurally

Task 3: MODIFY src/panel/panel.ts
  - ADD fields: footerFlash: { text: string; timer?: ReturnType<typeof setTimeout> } | undefined; flash(text: string) method (set field, invalidate, auto-clear after ~2.5s → invalidate; clear timer in dispose()); rippleConfirm: RippleConfirmFn = () => true (constructor-arg overridable via InterrogationPanelArgs.optional confirmRipple)
  - MODIFY handleInput: after the keys seam, insert the MINIMAL matcher — arrows (check before any ESC logic!), digits, enter, tab/shift+tab, config-resolved ctrl+s — each delegating to the actions. Mark with a banner comment "TEMPORARY until keys.ts (P1.M3.T3.S1)"
  - PRESERVE: resolved guard, deep/overview built-ins, cache discipline

Task 4: MODIFY src/panel/layout.ts (small, only if needed)
  - renderFooter or panel.buildLines renders panel.footerFlash text as a transient line above the footer (dim/warning tint) — keep to ONE line, visibleWidth-bounded

Task 5: CREATE src/panel/actions.test.ts
  - FIXTURE: build InterrogationState via createInterrogationState + upsert path (see src/state.test.ts / merge.test.ts fixtures) with 4+ questions incl. answered, reasked, moot, withdrawn
  - CASES: (a) accept commits applyAnswer + advances to next open; (b) wrap: all-later answered → advances to first open at top; (c) all answered → stays; (d) prev/next traverse every status incl. withdrawn, clamp at ends, cursor resets to ★ preselect; (e) digit select on/off, in/out of range; (f) ✎ index accept → focus="text", no answer applied; (g) accept on answered → ripple seam called with proposed value, default seam re-marks answered(pending) (AC-13); (h) moot/withdrawn accept no-op; (i) submit with pending → exactly one buildSubmission side-effect pair (assert snapshots ring grew by 1 and epoch +1) and sendMessage called once with triggerTurn branch per isIdle; (j) submit with zero pending → flash set to "nothing to submit", snapshot count and epoch unchanged, no sendMessage; (k) advance never lands on moot/withdrawn/closed
  - MOCK: theme stub pattern from panel.test.ts; sendMessage as vi.fn(); fake timers for flash expiry
  - FOLLOW pattern: src/debug-commands.test.ts assertion style for the submit path
```

### Implementation Patterns & Key Details

```ts
// Advance (accept tail):
const nextId = nextUnanswered(panel.state.orderedQuestions(), currentIndex);
if (nextId !== undefined) { panel.currentId = nextId; panel.cursorIndex = initialCursorIndex(q(nextId)); }
panel.invalidate();

// Submit baseline — latest snapshot ring entry, else an "epoch 0 empty" baseline.
// Pending = answered since the LAST submission's snapshot; buildSubmission then
// takes a NEW snapshot + bumps epoch, so the next baseline is fresh. Edge: a
// question answered and re-edited still shows as one changed entry (fine).

// Minimal matcher ordering inside handleInput (order is load-bearing):
if (keys seam) return;
if (data === "\u001b[A" || data === "\u001bOA") return optionUp;
if (data === "\u001b[B" || data === "\u001bOB") return optionDown;
// ... digits, "\r"/"\n", "\t", "\u001b[Z", submit key ...
// THEN the existing S1 built-ins (deep/overview/esc) — arrows checked first
// so the esc branch can never eat an arrow prefix.
```

### Integration Points

```yaml
PANEL (panel.ts):
  - new fields footerFlash + rippleConfirm; handleInput gains the temporary matcher
KEYS (P1.M3.T3.S1, future): keys.ts binds config keys.prevQuestion/nextQuestion/submit
  and digitQuickSelect to these named actions; the temporary matcher is deleted then
RIPPLE (P1.M5.T4.S1, future): replaces the default () => true rippleConfirm seam
TEXT (P1.M4.T1.S2, future): focus === "text" composes the editor; ✎ accept already sets it
NO changes to state.ts, config.ts, delivery.ts, index.ts.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck    # zero errors
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/actions.test.ts -v
npm test             # whole suite stays green
```

### Level 3: Integration — SCRIPTED ONLY (AUTOMATION-POLICY.md)

> **Never drive a live pi session.** All behavior is assertable through the action handlers + state/delivery seams in vitest: applyAnswer effects via `state.serialize()`, submit effects via the snapshot ring + epoch + a mocked `sendMessage`. Follow the debug-commands.test.ts precedent.

```bash
npx vitest run src/panel/ src/state.test.ts src/snapshots.test.ts
```

### Level 4: Domain-specific

Assert the R1 invariant exhaustively: for a fixture with every status present, calling nextQuestion repeatedly cycles through ALL questions with zero rejections, and accept on any open/reasked question never wedges (advance always terminates — guard against infinite loop when current is the only unanswered question).

## Final Validation Checklist

- [ ] `npm run typecheck` clean; `npm test` all green.
- [ ] Named-action surface exported and keys-free (no accelerator strings in actions.ts).
- [ ] R1: prev/next traverse all statuses, nothing blocks (test d).
- [ ] Enter = accept + advance with wrap (Q14=A, tests a/b/c); never advances onto moot/withdrawn/closed (test k).
- [ ] digitQuickSelect honored; out-of-range and off-mode fall through (test e).
- [ ] Answered-question edit routes through the ripple seam and re-marks `answered(pending)` (AC-13, tests g).
- [ ] Submit: single snapshot+epoch bump, single delivery; zero-pending → flash `nothing to submit`, no side effects (tests i/j).
- [ ] Arrow sequences checked before esc handling in handleInput; matcher clearly marked TEMPORARY.
- [ ] Mode A JSDoc on the advance algorithm.
- [ ] No modifications outside panel.ts / layout.ts / actions.ts(+test).

## Anti-Patterns to Avoid

- ❌ Don't parse config accelerators inside actions.ts — actions are key-agnostic by design (keys.ts owns binding).
- ❌ Don't call takeSnapshot/bumpEpoch around buildSubmission — it does both itself.
- ❌ Don't block navigation on unanswered/moot/withdrawn questions — R1 violation.
- ❌ Don't add arrows/enter/esc to the config KeyAction union — fixed per h2.34.
- ❌ Don't implement the ripple UI, the text editor, or final key dispatch (M5.T4.S1 / M4.T1.S2 / M3.T3.S1).
- ❌ Don't let the flash timer repaint after suspend — clear it in dispose().
```

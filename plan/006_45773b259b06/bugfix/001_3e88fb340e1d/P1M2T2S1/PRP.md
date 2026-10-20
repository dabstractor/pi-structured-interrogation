---
name: "P1.M2.T2.S1 — Emit the auto-submit confirmation via the post-suspend notify channel (BUG-003)"
description: "In src/panel/actions.ts maybeAutoSubmit tail: after `const shipped = submit(panel, d)`, when shipped, keep `panel.flash('submitted — N answer(s)')` (verbatim, literal 'answer(s)') for the field-reading assertions AND additionally emit the same verbatim string through the panel's existing post-suspend channel — a new tiny `panel.notify(message)` method delegating optional-chained to the existing `sidechatNotify` closure (panel.ts:918 field, args :1140, resolveSidechatHostSeams ui.notify closure :539-548 with log-safe swallow). flash-before-submit alone does NOT make it observable (sync invalidate never paints once resolved — architecture §BUG-003). Update the maybeAutoSubmit tail comment (~:803/:1062) and any flash JSDoc claiming observability. Tests: mock ui.notify; assert one call with the verbatim string, footerFlash still set, suspend ordering unchanged, no notify on non-shipped. Keep disjoint from parallel P1.M1.T1.S3 (submit() entry seam)."
---

## Goal

**Feature Goal**: BUG-003 / AUTOSUBMIT-001 / AC-2c — the no-keypress auto-submit delivery confirmation becomes observable and test-assertable: when maybeAutoSubmit ships a submission, the user sees `submitted — {n} answer(s)` via pi's notify toast (the deterministic post-suspend channel), instead of a footerFlash staged on an already-suspended (unmounted) panel that can never repaint.

**Deliverable**: Modified `src/panel/actions.ts` (maybeAutoSubmit tail + comment) + a small `notify(message)` method on `InterrogationPanel` (`src/panel/panel.ts`) delegating to the existing `sidechatNotify` closure + tests in `src/panel/actions.test.ts`.

**Success Definition**: `npm test` + `npm run typecheck` green; answering the last open question (auto-submit fires) → the ui.notify mock is called EXACTLY ONCE with the verbatim string `submitted — 2 answer(s)`-style text (literal `answer(s)`, no pluralization); `panel.footerFlash?.text` still set (existing assertions like actions.test.ts:2686–2692 stay green); `done(null)`/suspend ordering inside submit() unchanged; non-shipped path emits nothing.

## User Persona

**Target User**: TUI user who just answered the final question — with zero keypresses beyond the answer, they must SEE that the submission shipped (the whole point of AUTOSUBMIT-001's "footer flashes `submitted — {n} answer(s)`" — today the flash is dead code because the panel suspends first).

**Use Case**: accept the last option → submit() delivers the delta and suspends the panel (FR-3d) → pi's notify toast shows `submitted — 3 answer(s)` while the transcript diff card lands — two observable confirmations instead of one.

**User Journey**: answer last question → toast appears + panel closes + diff card in transcript → resume later via /interrogate if needed.

**Pain Points Addressed**: The specified confirmation was unobservable on EVERY auto-submit firing; headless tests could only assert the dead field.

## Why

- PRD h2.3/h3.2 (BUG-003): "Either render the flash before suspending (a final frame), or route the confirmation through a post-suspend notify" — notify is deterministic; architecture §BUG-003 proves flash-before-submit alone does NOT work (same synchronous turn; invalidate-queued repaint never lands once `resolved`).
- The channel already exists and has precedent: `resolveSidechatHostSeams` builds the `ctx.ui?.notify?.(message)` closure with a log-safe swallow (panel.ts:539–548), returned as `sidechatNotify` (:598), threaded to the panel via args (:1140, field :918) — used for sidechat close notices AFTER record discard. Reusing it needs zero host-side changes.
- Consumed by P1.M3.T1.S1 (gate — must not double-notify with the gate-hold line) and P1.M3.T2.S2 (README AUTOSUBMIT-001 row: "footer flashes" → notify wording).

## What

### 1. Panel seam — `src/panel/panel.ts`

Beside `sidechatNotify`'s field declaration (:918):

```ts
/**
 * [Mode A] Post-suspend notification channel (BUG-003 / AUTOSUBMIT-001):
 * the auto-submit confirmation (`submitted — {n} answer(s)`) fires AFTER
 * submit() has suspended the panel (FR-3d post-submit exit), so a footer
 * flash can never paint — the component is unmounted. This method routes
 * through the SAME host ui.notify closure as the sidechat close notices
 * (resolveSidechatHostSeams, log-safe swallow on failure) which remains
 * callable after done(null). Optional-chained: hosts/tests without the
 * closure degrade silently.
 */
notify(message: string): void {
  this.sidechatNotify?.(message);
}
```

(If you prefer reusing `sidechatNotify` directly from actions.ts, that is equally acceptable — but the generic `notify` name keeps the channel's purpose from being sidechat-branded; pick ONE and keep the JSDoc.)

### 2. maybeAutoSubmit tail — `src/panel/actions.ts` (~:1060–1063)

Current:

```ts
const shipped = submit(panel, d);
if (shipped) {
  panel.flash(`submitted — ${pending} answer(s)`); // verbatim, literal "answer(s)"
}
```

New:

```ts
const shipped = submit(panel, d);
if (shipped) {
  // Keep the flash field (existing assertions read it; harmless) AND emit
  // through the post-suspend notify channel — submit() already suspended
  // the panel (FR-3d), so only the notify is user-observable (BUG-003).
  // Verbatim AUTOSUBMIT-001 string; literal "answer(s)", no pluralization.
  const confirmation = `submitted — ${pending} answer(s)`;
  panel.flash(confirmation);
  panel.notify(confirmation);
}
```

Update the adjacent comment(s): the maybeAutoSubmit docblock's flash claim (~:803 "maybeAutoSubmit's post-submit flash…" — grep `flash` in the function's comment region) and panel.flash's JSDoc if it claims auto-submit observability — both now describe the dual channel (field kept for tests; notify is the observable surface).

### 3. Do NOT change

- `submit()`'s tail/suspend ordering (:951–957) — FR-3d unchanged.
- The flash string, FLASH_MS machinery, or `footerFlash` typing.
- `resolveSidechatHostSeams`, host wiring, index.ts.
- Parallel P1.M1.T1.S3's territory: submit()'s ENTRY seam (different function — keep diffs disjoint; if S3 has landed when you start, re-read actions.ts first).

### 4. Explicitly OUT of scope

- Final-frame painting via pi-tui render API (the PRD-compliant alternative) — only if you can make it assertable; default to notify. Do not ship an unverifiable paint.
- Gate-hold notify interactions (P1.M3.T1.S1), README sweep (P1.M3.T2.S2).

### Success Criteria

- [ ] Auto-submit on last-answer: `ui.notify` mock called ONCE with the exact string (e.g. `submitted — 2 answer(s)` — em-dash, literal `answer(s)`)
- [ ] `panel.footerFlash?.text` still equals the same string after maybeAutoSubmit (existing field assertions green unmodified)
- [ ] `done(null)` (suspend) still happens inside submit(), before the notify fires; ordering assertable
- [ ] Non-shipped path (e.g. gate hold / probe call `commit === undefined`): NO notify call
- [ ] Hosts without the closure: `panel.notify(...)` is a silent no-op (optional chain) — no throw
- [ ] `npm test` + `npm run typecheck` green

## All Needed Context

### Context Completeness Check

An agent with no prior knowledge gets: the exact current tail code, the proof that flash-before-submit does not work, the existing channel's full path (closure → args → field → method), the verbatim string contract, the field-assertion compatibility requirement, the disjointness fence vs the parallel sibling, and the test recipe. No guessing.

### Documentation & References

```yaml
- file: plan/006_45773b259b06/bugfix/001_3e88fb340e1d/architecture/bug002-003-panel-render-flash.md
  why: §BUG-003 — verified facts: maybeAutoSubmit tail :1060-1063, submit() tail ~:951-957 (panel.suspend → done(null)), panel.flash :1660-1668 (expiry skips invalidate when resolved; never repaints post-suspend), the notify channel's existence, and the "moving flash alone does NOT work" proof
  gotcha: the PRD authorizes final-frame OR notify; notify is deterministic — don't attempt the paint unless assertable

- file: src/panel/actions.ts
  why: maybeAutoSubmit tail :1060-1063 (the edit site), its docblock ~:803 region (comment to update), submit() tail :951-957 (READ-ONLY — do not touch; P1.M1.T1.S3 edits its entry seam)
- file: src/panel/panel.ts
  why: sidechatNotify field :918 + args wiring :1140, resolveSidechatHostSeams closure :539-548 (try/catch log-safe swallow), panel.suspend :1639-1644 (resolved=true, done(null)), panel.flash :1660-1668
  gotcha: the closure is deliberately swallow-protected — do NOT add a second try/catch at the notify() method
- file: src/panel/actions.test.ts
  why: field assertions ~:2686-2692 (footerFlash?.text reads — must stay green unmodified); the delivery-mocks harness to extend with a ui.notify mock
- file: plan/006_45773b259b06/bugfix/001_3e88fb340e1d/prd_snapshot.md (h2.3/h3.2 BUG-003, h2.5 recommendation)
  why: the defect + the two authorized remedies
```

### Current Codebase tree (relevant slice)

```bash
src/panel/ actions.ts panel.ts (+ actions.test.ts)
```

### Desired Codebase tree

```bash
# no new files
src/panel/actions.ts   # MODIFIED: maybeAutoSubmit tail (flash + notify) + comment updates
src/panel/panel.ts     # MODIFIED: notify(message) method (+ JSDoc) — OR direct sidechatNotify use; pick one
src/panel/actions.test.ts  # MODIFIED: notify assertions
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// VERBATIM string: `submitted — ${pending} answer(s)` — EM-DASH (U+2014) with spaces, literal "answer(s)"
//   regardless of count. Byte-exact test strings.
// flash() before submit() alone is NOT observable (sync invalidate never lands once resolved) — the notify
//   channel is the fix; keep flash only for the field assertions.
// sidechatNotify may be undefined in tests/direct construction — the method must optional-chain, never throw.
// The notify fires AFTER done(null) — that is the point (post-suspend); the closure stays callable because it
//   captures ctx, not the panel. Precedent: sidechat close notices.
// Do not move suspend() or reorder submit()'s tail — FR-3d post-submit exit is pinned by other tests.
// Parallel sibling P1.M1.T1.S3 edits submit()'s entry seam in the same file — keep the diffs disjoint;
//   re-read actions.ts at implementation start to see what landed.
// panel.footerFlash typing/expiry untouched — dozens of existing tests read it.
```

## Implementation Blueprint

### Data models and structure

None — one tiny method + a two-line tail change.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: TDD — ADD failing tests first (actions.test.ts, alongside the existing auto-submit/delivery tests)
  - auto_submit_notifies_verbatim_string: extend the panel harness's host/ui mock with notify: vi.fn();
     answer the last open question via acceptOptionIndex → expect notify called ONCE with the exact
     `submitted — N answer(s)` string (compute N from the fixture)
  - footer_flash_field_still_set: same scenario → panel.footerFlash?.text equals the same string
  - suspend_before_notify: capture call order (done mock vs notify mock) — done(null) first
  - non_shipped_path_no_notify: gate-hold fixture or commit===undefined direct call → notify NOT called
  - notify_without_closure_is_silent: panel constructed without sidechatNotify → no throw

Task 2: ADD panel.notify(message) to src/panel/panel.ts (+ Mode A JSDoc per What §1)

Task 3: MODIFY maybeAutoSubmit tail per What §2 + update the adjacent docblock comments

Task 4: GATES
  - npx vitest run src/panel/actions.test.ts src/panel/panel.test.ts
  - npm test && npm run typecheck
```

### Implementation Patterns & Key Details

The notify fires unconditionally-on-shipped, exactly once per firing (maybeAutoSubmit's own one-firing-per-submission discipline, "epoch bumps per firing", bounds it). The gate-hold path returns before the tail — no double-notify risk today; P1.M3.T1.S1 owns keeping it that way.

### Integration Points

```yaml
HOST/WIRING: none — the sidechatNotify closure is already threaded (panel.ts :598 → args :1140 → field :918)
CONSUMERS (do NOT implement):
  - P1.M3.T1.S1 (gate): must not stack the gate-hold ⚠ notify with this confirmation
  - P1.M3.T2.S2 (README): AUTOSUBMIT-001 row wording ("footer flashes" → notify)
CONFIG/EVENTS/STATE: none
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
npx vitest run src/panel/actions.test.ts
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/panel.test.ts   # flash/footerFlash machinery untouched
npm test
```

### Level 3: Integration Testing

Headless harness IS the integration surface here (real panel + delivery mocks). Optional manual TUI check: run pi with the extension linked, upsert one question, accept it → toast appears after the panel closes.

### Level 4: Domain Validation

Walk the architecture §BUG-003 fact list against the diff: flash kept for fields ✓, notify is the observable ✓, suspend order untouched ✓, string verbatim ✓, comments updated ✓.

## Final Validation Checklist

- [ ] `npm test` + `npm run typecheck` green; existing footerFlash assertions green unmodified
- [ ] Exactly one notify per shipped auto-submit; verbatim em-dash string; none on non-shipped
- [ ] Suspend ordering unchanged (done(null) precedes notify); no changes to submit()'s tail
- [ ] notify() silent without the closure; no double try/catch
- [ ] Comments/JSDoc updated (maybeAutoSubmit tail + any flash observability claim); README untouched (P1.M3.T2.S2)

---

## Anti-Patterns to Avoid

- ❌ Don't only move flash() before submit() — proven unobservable (sync invalidate never paints once resolved)
- ❌ Don't pluralize or alter the confirmation string — `answer(s)` is literal and byte-pinned by tests
- ❌ Don't touch submit()'s suspend/FR-3d tail or its entry seam (parallel sibling's diff)
- ❌ Don't add a second swallow/try-catch in notify() — the closure already has one
- ❌ Don't fire notify on gate-hold or non-shipped paths
- ❌ Don't remove the flash call "because it's dead" — the field assertions and any future resume-visible rendering depend on it

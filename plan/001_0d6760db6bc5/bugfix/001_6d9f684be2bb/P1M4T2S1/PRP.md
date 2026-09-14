# PRP — P1.M4.T2.S1 (bugfix changeset): keys.ts — gate focusText dispatch on `panel.view === "short"` (BUG-011)

## Goal

**Feature Goal**: Fix BUG-011 (minor issue 3, h2.3/h3.10): pressing ctrl+t (`keys.focusText`) while the panel is in the deep or overview view must NOT focus the embedded text editor, because `buildLines` never renders the editor in those views — today it produces invisible focus, blind typing into a hidden editor, and silent stage-1 draft saves. After the fix, ctrl+t creates text focus ONLY in the short view; in deep/overview the keystroke falls through to normal panel key handling (arrows/enter keep their view-specific meanings).

**Deliverable**: A one-condition change in `src/panel/keys.ts` (~line 354: add `panel.view === "short" &&` to the `b.focusText` intercept, with a comment citing BUG-011) + new test cases in `src/panel/keys.test.ts` (ctrl+t in deep/overview → `onFocusText` NOT dispatched, router returns false; in short → still dispatched).

**Success Definition**: `route(ctrl+t, {view:"deep"})` and `route(ctrl+t, {view:"overview"})` return `false` with `onFocusText` never called; `route(ctrl+t, {view:"short"})` returns `true` and calls `onFocusText` (including the existing focus-already-"text" case at keys.test.ts:284); all other intercepts (`deep`, `overview`, `batchNote`, `submit`, `breakOut`, `discuss`, `prevQuestion`, `nextQuestion`, digits, externalEditor) unchanged; `npm run typecheck` + `npm test` green.

## User Persona (if applicable)

**Target User**: pi user navigating the interrogation panel's deep/overview views.

**Use Case**: The user descends into the deep view (ctrl+d) to read a question's ramification, reflexively presses ctrl+t (or fat-fingers it) — nothing happens; arrows still scroll, enter still accepts from deep. No hidden editor is armed.

**User Journey**: ctrl+d → deep view → ctrl+t (no-op, editor not reachable where it doesn't render) → arrows/enter behave normally → ctrl+d back to short → ctrl+t → editor appears and focuses with draft seeded.

**Pain Points Addressed**: FR-12's explain field becomes a hidden trap in deep/overview: focus="text" with no rendered editor means every subsequent keystroke vanishes into the invisible TextField and enter silently performs a stage-1 draft save.

## Why

- BUG-011 (bugfix PRD h2.3/h3.10, steps verified in this repo): "ui-spec h2.34 intercepts panel keys in every view, and keys.ts routes focusText (ctrl+t) with no view guard. panel.ts buildLines renders the embedded TextField only in the short view (and note mode)… Pressing ctrl+t in deep/overview sets focus='text' and seeds the editor, but the user sees no editor."
- The fix restores the invariant: the explain field (FR-12) is reachable exactly where it renders.
- Sibling precedent in the same file: `b.externalEditor` already gates on `panel.focus === "text"` (keys.ts:366-369) and digit quick-select gates on `panel.view !== "overview" && focus !== text/note` (~keys.ts:384-389) — this is the same class of context gate.

## What

### Contract (authoritative)

1. **Change exactly one intercept** in `src/panel/keys.ts` — the `b.focusText` block in the config-driven intercept section (~lines 354-357):
   ```ts
   // BUG-011: the embedded editor renders only in the short view (and note
   // mode — a separate focus). Focusing it from deep/overview would arm an
   // invisible editor (blind typing, silent stage-1 saves). In those views
   // ctrl+t falls through to normal panel handling (arrows scroll/navigate).
   if (panel.view === "short" && matchesKey(data, b.focusText)) {
     actions.onFocusText(panel);
     return true;
   }
   ```
2. **Fall-through semantics**: when `panel.view !== "short"` and data matches focusText, do NOT return `true` — let execution continue down the router (prev/next bindings, digit gate, eventual forward/return false) exactly as any non-matching key would. In deep: enter still `acceptFromDeep`, arrows scroll; in overview: enter still `overviewJump`, arrows move the cursor row (comment block at keys.ts:330-338 documents these).
3. **Defensive case**: focus already `"text"` in a non-short view is unreachable in practice (view switches blur text focus; esc from short-text returns to options before descending) — the gate makes ctrl+t a fall-through there regardless; no extra handling needed.
4. **DO NOT touch**: `b.batchNote` (ctrl+shift+m) — note mode is deliberately view-agnostic (panel.ts:978 comment; the note editor overlays from any view). `b.deep`, `b.overview`, `b.submit`, `b.breakOut`, `b.discuss`, `b.prevQuestion`, `b.nextQuestion` — all intentionally valid in every view including focus === "text" (h2.34 intercept rule, comment at keys.ts:348-349). The externalEditor gate and digit gate stay as-is.
5. **No downstream consumers / no panel changes**: `focusTextField()` (panel.ts:800-822) and the constructor seam refinement (panel.ts:483) are untouched — the fix is purely at dispatch. The ✎ affordance route (short view) calls `focusTextField` directly and remains valid.
6. **Docs**: none required (no repo doc enumerates the keymap; this is ui-spec h2.34 Hotkeys conformance).

### Success Criteria

- [ ] ctrl+t (`DEFAULT_DATA.focusText`, "\u0014") with `panel.view === "deep"` → router returns false, `onFocusText` not called.
- [ ] Same for `view === "overview"`.
- [ ] ctrl+t with `view === "short"` (options focus AND text focus) → returns true, `onFocusText` called (existing keys.test.ts:284 stays green).
- [ ] All other intercepts behave identically (existing "intercepts in every view including text focus" test unchanged).
- [ ] `npm run typecheck` + `npm test` green.

## All Needed Context

### Context Completeness Check

A fresh implementer needs: the exact intercept block, the sibling gates to imitate, the test harness (makePanel/makeActions/route) with its `view` override, and the list of what NOT to touch. All anchored below.

### Documentation & References

```yaml
- file: src/panel/keys.ts
  why: THE fix site. Intercept block at ~354-357: `if (matchesKey(data, b.focusText)) {
    actions.onFocusText(panel); return true; }` — add `panel.view === "short" &&`.
  pattern: context gates in the same section — externalEditor at ~366-369
    (`panel.focus === "text" && ...`), digits at ~384-389 (`panel.view !== "overview" &&
    panel.focus !== "text" && panel.focus !== "note"`), prev/next overview re-routing at
    ~372-381. Copy the comment style: short, cites the rule.
  gotcha: fall-through must NOT `return true` — returning true would swallow the keystroke
    without acting; false lets arrows/enter keep working in deep/overview.

- file: src/panel/keys.test.ts
  why: test harness + the case that must stay green. makePanel(overrides) (lines 62-68)
    accepts {view?: PanelView, focus?: PanelFocus, deepSticky?} — default view "short";
    makeActions() returns a spied RoutedActions (dispatchCount helper exists);
    route(data, panel) drives the router. Line 284: `route(DEFAULT_DATA.focusText,
    makePanel({ focus: "text" }))` — default view short, still dispatched after the fix.
    DEFAULT_DATA.focusText = "\u0014" (line 31).
  pattern: existing view-aware tests (e.g. enter → overviewJump/acceptFromDeep, digit
    gating in overview) show how to assert "not dispatched + returns false".

- file: src/panel/panel.ts
  why: READ-ONLY proof of the defect + the consumer. focusTextField() at 800-822 (sets
    focus="text", seeds, invalidates — the invisible-focus action); seam refinement at 483
    (`routed.onFocusText = (p) => p.focusTextField()`); PanelView/PanelFocus types ~95/98;
    buildLines renders TextField only in short/note branches (BUG-011 location line cite).
  gotcha: do NOT add a view check inside focusTextField — the gate belongs at dispatch so
    the ✎ affordance and any future short-view callers keep working; do not "fix" note mode.

- file: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/P1M4T1S2/PRP.md
  why: parallel task (resumable predicate, command.ts/index.ts) — DISJOINT from this fix;
    neither file is touched here. No conflicts expected; keep changes confined to
    keys.ts + keys.test.ts.

- file: plan/001_0d6760db6bc5/bugfix/001_6d9f684be2bb/P1M4T2S1/research/notes.md
  why: this item's research digest — verified line numbers, sibling gates, test harness
    details, and the list of intercepts that must remain view-agnostic.
```

### Current Codebase tree (relevant excerpt)

```bash
src/panel/
  keys.ts        # MODIFY: one condition on the b.focusText intercept (~354)
  keys.test.ts   # EXTEND: deep/overview fall-through cases; keep :284 green
  panel.ts       # READ-ONLY (focusTextField, seam, types)
  actions.ts     # READ-ONLY (no action changes)
```

### Desired Codebase tree

```bash
src/panel/
  keys.ts        # focusText intercept gated on panel.view === "short" + BUG-011 comment
  keys.test.ts   # new describe/it: ctrl+t fall-through in deep/overview; short still dispatches
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// GOTCHA: fall-through = returning false eventually — do NOT "return true" to
// swallow the key. The user in deep view expects arrows/enter to keep working;
// a swallowed keystroke is a new bug, not a fix.
// GOTCHA: the intercept section runs "valid whenever the panel is open
// INCLUDING focus === 'text'" (keys.ts:348-349 comment, h2.34). Your gate is a
// VIEW exception for focusText only — do not generalize it to other bindings.
// GOTCHA: batchNote (ctrl+shift+m) is intentionally view-agnostic (note mode
// overlays from any view, panel.ts:978). Do not gate it.
// GOTCHA: makePanel defaults view to "short" — the existing test at line 284
// doesn't pass a view; it stays green only because the default is short.
// New deep/overview cases MUST pass {view: "deep"} / {view: "overview"}
// explicitly.
// GOTCHA: ctrl+t data is "\u0014" (DEFAULT_DATA.focusText) — use the constant,
// never re-type the escape.
```

## Implementation Blueprint

### Data models and structure

No new types. The change is one boolean conjunct in an existing `if`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/panel/keys.ts — the gate
  - FIND: the intercept section comment "Config-driven panel-level intercepts"
    (~348) and the b.focusText block (~354-357)
  - CHANGE: `if (matchesKey(data, b.focusText)) {` →
    `if (panel.view === "short" && matchesKey(data, b.focusText)) {`
  - ADD the BUG-011 comment above it (see What §1 wording)
  - NOTHING else in the file changes (binding resolution, ordering, other gates)

Task 2: EXTEND src/panel/keys.test.ts
  - ADD a describe block (e.g. "focusText gated to the short view (BUG-011)") with:
    (1) route(DEFAULT_DATA.focusText, makePanel({ view: "deep" })) === false AND
        actions.onFocusText not called (fresh makeActions() spy; dispatchCount === 0)
    (2) same for { view: "overview" }
    (3) route(DEFAULT_DATA.focusText, makePanel()) (default short, options focus) === true
        AND onFocusText called once — pin the preserved behavior
    (4) route(DEFAULT_DATA.focusText, makePanel({ focus: "text" })) === true (line 284
        already covers this inside its block; an explicit assertion here is fine/duplicative —
        keep it only if it reads naturally)
    (5) regression: in deep view, arrows/enter still route to their view actions
        (e.g. ENTER with view "deep" → acceptFromDeep path) — one assertion that the
        fall-through didn't break the neighbor bindings
  - FOLLOW pattern: existing makeRouter/makeActions/makePanel fixtures in this file
  - NAMING: it("does not focus text in deep view...") descriptive sentences

Task 3: VALIDATE
  - npm run typecheck && npx vitest run src/panel/keys.test.ts && npm test
```

### Implementation Patterns & Key Details

```ts
// src/panel/keys.ts — before
if (matchesKey(data, b.focusText)) {
  actions.onFocusText(panel);
  return true;
}

// after — BUG-011: the embedded editor renders only in the short view (and
// note mode, a separate focus); focusing it from deep/overview would arm an
// invisible editor (blind typing, silent stage-1 draft saves). In those views
// ctrl+t falls through to normal panel handling (arrows scroll/navigate).
if (panel.view === "short" && matchesKey(data, b.focusText)) {
  actions.onFocusText(panel);
  return true;
}
```

### Integration Points

```yaml
NONE downstream: focusTextField() (panel.ts:800) and the ✎ affordance route are
  short-view callers by construction; no API or config changes; config key
  focusText (default ctrl+t) unchanged and still hotkey-remappable (R5).
DO NOT MODIFY: panel.ts, actions.ts, config.ts, text-field.ts, index.ts, note-mode paths.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
```

### Level 2: Unit Tests

```bash
npx vitest run src/panel/keys.test.ts -v
npm test
```

### Level 3: Integration (scripted only)

```bash
# None — pure dispatch logic, fully covered by the router unit tests. Live-TUI
# verification of ctrl+t in deep/overview belongs to the manual runbook if one
# is maintained for this changeset (optional; unit coverage is sufficient for a Minor fix).
```

### Level 4: Domain-specific

```bash
grep -n "focusText" src/panel/keys.ts          # gate present: `panel.view === "short" && matchesKey(data, b.focusText)`
grep -n "BUG-011" src/panel/keys.ts            # comment present
grep -c "panel.view === \"short\" &&" src/panel/keys.ts  # exactly 1 (this gate) — did not over-gate
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean; `npm test` all green.

### Feature Validation

- [ ] ctrl+t in deep/overview: no dispatch, router returns false, arrows/enter unaffected.
- [ ] ctrl+t in short (options or text focus): dispatches onFocusText as before.
- [ ] Existing keys.test.ts:284 case untouched and passing.

### Code Quality Validation

- [ ] One-condition change in keys.ts; comment cites BUG-011; sibling-gate comment style.
- [ ] No other intercepts, bindings, panel methods, or config touched.

### Documentation & Deployment

- [ ] None required (no repo doc enumerates the keymap — h2.34 conformance fix only).

## Anti-Patterns to Avoid

- ❌ Don't swallow the keystroke (`return true`) in non-short views — fall through.
- ❌ Don't gate batchNote/deep/overview/submit or any other binding — only focusText is view-scoped.
- ❌ Don't add the view check inside `focusTextField()` — the gate belongs at dispatch.
- ❌ Don't change the focusText default binding or config surface (R5 remappability intact).
- ❌ Don't touch panel.ts/actions.ts or the parallel P1.M4.T1.S2 work (command.ts/index.ts).

---

**Confidence Score**: 10/10 — one conjunct in one verified `if`, with the exact sibling pattern (externalEditor/digit gates) and test harness (`makePanel({view})`) already in place.
